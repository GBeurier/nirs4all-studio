//! Persistent Studio application settings owned by the native sidecar.
//!
//! The store deliberately preserves the existing `app_settings.json` shape so
//! a desktop upgrade can move these routes to Rust without requiring a data
//! migration or a Python process. It owns UI preferences, favourite pipelines,
//! and the linked-workspace catalogue only; workspace contents, scans, and
//! datasets remain outside this module.

use std::{
    collections::HashSet,
    env,
    fs::{self, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
    process,
    sync::{Arc, Mutex, MutexGuard},
    time::{SystemTime, UNIX_EPOCH},
};

use atomicwrites::{replace_atomic, AllowOverwrite, AtomicFile};
use rusqlite::Connection;
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};

const APP_SETTINGS_FILE: &str = "app_settings.json";
const SETUP_STATUS_FILE: &str = "setup_status.json";
const DATASET_LINKS_FILE: &str = "dataset_links.json";
const MAX_DATASET_LINKS_BYTES: u64 = 2 * 1024 * 1024;
const CONFIG_ENV: &str = "NIRS4ALL_CONFIG";
const PORTABLE_ROOT_ENV: &str = "NIRS4ALL_PORTABLE_ROOT";
const PORTABLE_EXE_ENV: &str = "NIRS4ALL_PORTABLE_EXE";
const CONFIG_REDIRECT_FILE: &str = "config_redirect.txt";

#[derive(Clone, Debug)]
pub struct AppSettingsStore {
    config_dir: PathBuf,
    default_config_dir: PathBuf,
    legacy_setup_path: Option<PathBuf>,
    write_lock: Arc<Mutex<()>>,
}

/// A linked workspace and its request-scoped read-only `SQLite` transaction.
pub struct LinkedWorkspaceAccess {
    id: String,
    path: PathBuf,
    store: Option<Arc<Mutex<Connection>>>,
}

impl LinkedWorkspaceAccess {
    pub fn id(&self) -> &str {
        &self.id
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn store(&self) -> Option<MutexGuard<'_, Connection>> {
        self.store.as_ref().map(|store| {
            store
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
        })
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct StoreStamp {
    device: u64,
    inode: u128,
    size: u64,
    modified: i128,
    changed: i128,
}

pub fn store_stamp(path: &Path) -> Result<Option<StoreStamp>, String> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        let metadata = fs::symlink_metadata(path).map_err(|error| error.to_string())?;
        if metadata.file_type().is_symlink() || !metadata.is_file() {
            return Err("Store is not a regular file".into());
        }
        Ok(Some(StoreStamp {
            device: metadata.dev(),
            inode: u128::from(metadata.ino()),
            size: metadata.len(),
            modified: i128::from(metadata.mtime()) * 1_000_000_000
                + i128::from(metadata.mtime_nsec()),
            changed: i128::from(metadata.ctime()) * 1_000_000_000
                + i128::from(metadata.ctime_nsec()),
        }))
    }
    #[cfg(windows)]
    {
        let stamp =
            studio_windows_job::file_change_stamp(path).map_err(|error| error.to_string())?;
        Ok((stamp.changed > 0).then_some(StoreStamp {
            device: stamp.volume,
            inode: stamp.file_id,
            size: stamp.size,
            modified: i128::from(stamp.modified),
            changed: i128::from(stamp.changed),
        }))
    }
    #[cfg(not(any(unix, windows)))]
    {
        let _ = path;
        Ok(None)
    }
}

fn open_linked_store(workspace_path: &Path) -> Result<Option<Connection>, String> {
    let Some(store_path) = crate::workspace_store::workspace_store_path(workspace_path) else {
        return Ok(None);
    };
    let metadata = fs::symlink_metadata(&store_path).map_err(|error| error.to_string())?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err("linked workspace Store must be a regular file".into());
    }
    let held_file = fs::File::open(&store_path).map_err(|error| error.to_string())?;
    before_linked_store_open();
    let connection = crate::workspace_store::open_read_snapshot(workspace_path)
        .map_err(|error| error.to_string())?;
    if !path_matches_open_file(&store_path, &held_file) {
        return Err("linked workspace Store file identity changed during open".into());
    }
    Ok(Some(connection))
}

/// Compare a live path with an already-open file identity.
///
/// `same-file` obtains the platform identity from live handles (volume/file
/// index on Windows, device/inode on Unix). Keeping `file` open for the whole
/// operation prevents an attacker from satisfying this check by recycling a
/// stale metadata identifier after replacing the path.
fn path_matches_open_file(path: &Path, file: &fs::File) -> bool {
    let Ok(open_file) = file.try_clone().and_then(same_file::Handle::from_file) else {
        return false;
    };
    same_file::Handle::from_path(path).is_ok_and(|path_file| path_file == open_file)
}

#[cfg(not(test))]
const fn before_linked_store_open() {}

#[cfg(test)]
thread_local! {
    static BEFORE_LINKED_STORE_OPEN: std::cell::RefCell<Option<Box<dyn FnOnce()>>> =
        std::cell::RefCell::new(None);
}

#[cfg(test)]
fn before_linked_store_open() {
    BEFORE_LINKED_STORE_OPEN.with(|hook| {
        if let Some(hook) = hook.borrow_mut().take() {
            hook();
        }
    });
}

/// The only dataset-link fields used to associate a Store result with the
/// global Studio dataset catalogue. Scientific loader configuration remains
/// owned by nirs4all and is deliberately not exposed here.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DatasetLinkIdentity {
    pub id: String,
    pub name: String,
    pub path: String,
}

#[derive(Debug)]
pub enum ConfigPathError {
    DoesNotExist(String),
    NotDirectory(String),
    Storage(String),
}

impl AppSettingsStore {
    #[must_use]
    pub fn config_dir(&self) -> &Path {
        &self.config_dir
    }

    #[must_use]
    pub fn from_environment() -> Self {
        let mut settings = Self::with_config_paths(resolve_config_dir(), default_config_dir());
        // Explicit config roots (tests, portable profiles, server deployments)
        // must remain isolated from the user's other installations.
        if nonempty_env(CONFIG_ENV).is_none()
            && nonempty_env(PORTABLE_ROOT_ENV).is_none()
            && nonempty_env(PORTABLE_EXE_ENV).is_none()
        {
            settings.legacy_setup_path = legacy_setup_path();
        }
        settings
    }

    #[must_use]
    pub fn new(config_dir: impl Into<PathBuf>) -> Self {
        Self::with_config_paths(config_dir, default_config_dir())
    }

    #[must_use]
    pub(crate) fn with_config_paths(
        config_dir: impl Into<PathBuf>,
        default_config_dir: impl Into<PathBuf>,
    ) -> Self {
        Self {
            config_dir: config_dir.into(),
            default_config_dir: default_config_dir.into(),
            legacy_setup_path: None,
            write_lock: Arc::new(Mutex::new(())),
        }
    }

    pub fn response(&self) -> Result<Value, String> {
        let settings = self.load()?;
        let linked_workspaces_count = settings
            .get("linked_workspaces")
            .and_then(Value::as_array)
            .map_or(0, Vec::len);
        Ok(json!({
            "version": settings.get("version").and_then(Value::as_str).unwrap_or("1.0"),
            "linked_workspaces_count": linked_workspaces_count,
            "favorite_pipelines": favourite_pipelines(&settings),
            "ui_preferences": settings.get("ui_preferences").cloned().filter(Value::is_object).unwrap_or_else(|| json!({})),
        }))
    }

    /// Read the first-launch marker shared with existing Studio installs.
    /// Missing or malformed state is treated as setup not yet completed.
    pub fn setup_status(&self) -> Result<Value, String> {
        let native_path = self.config_dir.join(SETUP_STATUS_FILE);
        // Python stored this marker in its platformdirs data directory, not
        // beside app_settings.json. Preserve that decision across the upgrade.
        let path = if native_path.exists() {
            native_path
        } else {
            self.legacy_setup_path.clone().unwrap_or(native_path)
        };
        if !path.exists() {
            return Ok(default_setup_status());
        }
        let content = fs::read_to_string(&path)
            .map_err(|error| format!("could not read {}: {error}", path.display()))?;
        let Ok(status) = serde_json::from_str::<Value>(&content) else {
            return Ok(default_setup_status());
        };
        let Some(status) = status.as_object() else {
            return Ok(default_setup_status());
        };
        if status.get("setup_completed").and_then(Value::as_bool) != Some(true) {
            return Ok(default_setup_status());
        }
        let selected_profile = status
            .get("selected_profile")
            .and_then(Value::as_str)
            .filter(|profile| !profile.trim().is_empty());
        let Some(selected_profile) = selected_profile else {
            return Ok(default_setup_status());
        };
        Ok(json!({
            "setup_completed": true,
            "selected_profile": selected_profile,
            "completed_at": status.get("completed_at").and_then(Value::as_str),
        }))
    }

    /// Persist a selected first-launch profile without acquiring a Python
    /// runtime. Package installation remains an explicit plugin-host action.
    pub fn complete_setup(&self, profile: &str) -> Result<Value, String> {
        let _write_guard = self
            .write_lock
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let profile = profile.trim();
        if profile.is_empty() {
            return Err("setup profile must not be empty".into());
        }
        let status = json!({
            "setup_completed": true,
            "selected_profile": profile,
            "completed_at": null,
        });
        self.save_named_json(SETUP_STATUS_FILE, &status)?;
        Ok(status)
    }

    pub fn update_ui_preferences(&self, updates: &Value) -> Result<(), String> {
        let _write_guard = self
            .write_lock
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let preferences = updates
            .get("ui_preferences")
            .ok_or_else(|| "request body must contain ui_preferences".to_string())?;
        if preferences.is_null() {
            return Ok(());
        }
        let updates = preferences
            .as_object()
            .ok_or_else(|| "ui_preferences must be a JSON object or null".to_string())?;
        let mut settings = self.load()?;
        let root = settings
            .as_object_mut()
            .ok_or_else(|| "app settings root must be a JSON object".to_string())?;
        let current = root
            .entry("ui_preferences")
            .or_insert_with(|| Value::Object(Map::new()));
        let current = current
            .as_object_mut()
            .ok_or_else(|| "stored ui_preferences must be a JSON object".to_string())?;
        deep_merge(current, updates);
        self.save(&settings)
    }

    pub fn favourites_response(&self) -> Result<Value, String> {
        let favourites = favourite_pipelines(&self.load()?);
        Ok(json!({"favorites": favourites, "count": favourites.len()}))
    }

    pub fn add_favourite(&self, pipeline_id: &str) -> Result<bool, String> {
        let _write_guard = self
            .write_lock
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let mut settings = self.load()?;
        let root = settings
            .as_object_mut()
            .ok_or_else(|| "app settings root must be a JSON object".to_string())?;
        let favourites = root
            .entry("favorite_pipelines")
            .or_insert_with(|| Value::Array(Vec::new()));
        let favourites = favourites
            .as_array_mut()
            .ok_or_else(|| "stored favorite_pipelines must be a JSON array".to_string())?;
        if favourites
            .iter()
            .any(|value| value.as_str() == Some(pipeline_id))
        {
            return Ok(false);
        }
        favourites.push(Value::String(pipeline_id.into()));
        self.save(&settings)?;
        Ok(true)
    }

    pub fn remove_favourite(&self, pipeline_id: &str) -> Result<bool, String> {
        let _write_guard = self
            .write_lock
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let mut settings = self.load()?;
        let root = settings
            .as_object_mut()
            .ok_or_else(|| "app settings root must be a JSON object".to_string())?;
        let Some(favourites) = root.get_mut("favorite_pipelines") else {
            return Ok(false);
        };
        let favourites = favourites
            .as_array_mut()
            .ok_or_else(|| "stored favorite_pipelines must be a JSON array".to_string())?;
        let original_len = favourites.len();
        favourites.retain(|value| value.as_str() != Some(pipeline_id));
        let removed = favourites.len() != original_len;
        if removed {
            self.save(&settings)?;
        }
        Ok(removed)
    }

    /// Return the persisted linked-workspace catalogue without scanning a
    /// workspace or loading its scientific artifacts. Missing or duplicate IDs
    /// are repaired in place so callers always receive stable unique keys,
    /// matching the legacy manager's read-time migration.
    pub fn linked_workspaces_response(&self) -> Result<Value, String> {
        let _write_guard = self
            .write_lock
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let mut settings = self.load()?;
        let (workspaces, active_workspace_id, mutated) = {
            let root = settings
                .as_object_mut()
                .ok_or_else(|| "app settings root must be a JSON object".to_string())?;
            let workspaces = root
                .entry("linked_workspaces")
                .or_insert_with(|| Value::Array(Vec::new()))
                .as_array_mut()
                .ok_or_else(|| "stored linked_workspaces must be a JSON array".to_string())?;
            let mut seen_ids = HashSet::new();
            let mut response = Vec::with_capacity(workspaces.len());
            let mut active_workspace_id = None;
            let mut mutated = false;

            for (index, workspace) in workspaces.iter_mut().enumerate() {
                let workspace = workspace.as_object_mut().ok_or_else(|| {
                    "stored linked_workspaces entries must be JSON objects".to_string()
                })?;
                let id = workspace
                    .get("id")
                    .and_then(Value::as_str)
                    .filter(|id| !id.is_empty())
                    .map(str::to_owned)
                    .filter(|id| seen_ids.insert(id.clone()))
                    .unwrap_or_else(|| {
                        mutated = true;
                        next_workspace_id(index, &seen_ids)
                    });
                if workspace.get("id").and_then(Value::as_str) != Some(&id) {
                    workspace.insert("id".into(), Value::String(id.clone()));
                }
                seen_ids.insert(id.clone());
                let is_active = workspace
                    .get("is_active")
                    .and_then(Value::as_bool)
                    .unwrap_or(false);
                if is_active && active_workspace_id.is_none() {
                    active_workspace_id = Some(id.clone());
                }
                response.push(linked_workspace_response(workspace, &id));
            }
            (response, active_workspace_id, mutated)
        };
        if mutated {
            self.save(&settings)?;
        }
        Ok(json!({
            "workspaces": workspaces,
            "active_workspace_id": active_workspace_id,
            "total": workspaces.len(),
        }))
    }

    /// Return the active linked-workspace record without scanning or mutating
    /// either the workspace or the persisted catalogue.
    pub fn active_linked_workspace_response(&self) -> Result<Option<Value>, String> {
        self.active_linked_workspace_record(true)
    }

    /// Persist an explicit native scan without changing workspace identity or activation.
    pub(crate) fn record_workspace_scan(
        &self,
        workspace_id: &str,
        discovered: &Value,
        scanned_at: &str,
    ) -> Result<(), String> {
        let _guard = self
            .write_lock
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let mut settings = self.load()?;
        let workspace = settings
            .get_mut("linked_workspaces")
            .and_then(Value::as_array_mut)
            .and_then(|items| {
                items
                    .iter_mut()
                    .find(|item| item["id"].as_str() == Some(workspace_id))
            })
            .ok_or_else(|| "Workspace not found".to_owned())?;
        workspace["discovered"] = discovered.clone();
        workspace["last_scanned"] = json!(scanned_at);
        self.save(&settings)
    }

    /// Readiness reports catalogue initialization, not Store content validation.
    /// Authentication belongs to data access; polling must never read a Store.
    pub(crate) fn workspace_catalogue_ready(&self) -> bool {
        self.active_linked_workspace_record(false).is_ok()
    }

    pub(crate) fn active_linked_workspace_record(
        &self,
        verify_store: bool,
    ) -> Result<Option<Value>, String> {
        let settings = self.load()?;
        let Some(workspaces) = settings.get("linked_workspaces") else {
            return Ok(None);
        };
        let workspaces = workspaces
            .as_array()
            .ok_or_else(|| "stored linked_workspaces must be a JSON array".to_string())?;
        let Some(workspace) = workspaces.iter().find(|workspace| {
            workspace
                .get("is_active")
                .and_then(Value::as_bool)
                .unwrap_or(false)
        }) else {
            return Ok(None);
        };
        let workspace = workspace
            .as_object()
            .ok_or_else(|| "stored linked_workspaces entries must be JSON objects".to_string())?;
        let id = workspace
            .get("id")
            .and_then(Value::as_str)
            .filter(|id| !id.is_empty())
            .ok_or_else(|| "active linked workspace is missing an id".to_string())?;
        if verify_store {
            verified_linked_workspace_access(self, workspace)?;
        }
        Ok(Some(linked_workspace_response(workspace, id)))
    }

    pub(crate) fn active_linked_workspace_access(
        &self,
    ) -> Result<Option<LinkedWorkspaceAccess>, String> {
        let settings = self.load()?;
        let Some(workspaces) = settings.get("linked_workspaces") else {
            return Ok(None);
        };
        let workspaces = workspaces
            .as_array()
            .ok_or_else(|| "stored linked_workspaces must be a JSON array".to_string())?;
        let Some(workspace) = workspaces.iter().find(|workspace| {
            workspace
                .get("is_active")
                .and_then(Value::as_bool)
                .unwrap_or(false)
        }) else {
            return Ok(None);
        };
        let workspace = workspace
            .as_object()
            .ok_or_else(|| "stored linked_workspaces entries must be JSON objects".to_string())?;
        Ok(Some(verified_linked_workspace_access(self, workspace)?))
    }

    /// Resolve a linked workspace and hold one committed `SQLite` snapshot per request.
    pub(crate) fn linked_workspace_access(
        &self,
        workspace_id: &str,
    ) -> Result<Option<LinkedWorkspaceAccess>, String> {
        let settings = self.load()?;
        let Some(workspaces) = settings.get("linked_workspaces") else {
            return Ok(None);
        };
        let workspaces = workspaces
            .as_array()
            .ok_or_else(|| "stored linked_workspaces must be a JSON array".to_string())?;
        let Some(workspace) = workspaces.iter().find(|workspace| {
            workspace
                .get("id")
                .and_then(Value::as_str)
                .is_some_and(|id| id == workspace_id)
        }) else {
            return Ok(None);
        };
        let workspace = workspace
            .as_object()
            .ok_or_else(|| "stored linked_workspaces entries must be JSON objects".to_string())?;
        Ok(Some(verified_linked_workspace_access(self, workspace)?))
    }

    /// Load the minimal, read-only dataset catalogue used by native result
    /// projections. Missing or malformed JSON has the same effective default
    /// as the legacy `AppConfig` loader: no linked datasets. The bounded reader
    /// rejects an oversized file instead of parsing a prefix or allocating
    /// without limit.
    pub fn dataset_links(&self) -> Result<Vec<DatasetLinkIdentity>, String> {
        let path = self.config_dir.join(DATASET_LINKS_FILE);
        let mut file = match fs::File::open(&path) {
            Ok(file) => file,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(error) => return Err(format!("could not read {}: {error}", path.display())),
        };
        let capacity = usize::try_from(MAX_DATASET_LINKS_BYTES)
            .unwrap_or(usize::MAX)
            .saturating_add(1);
        let mut encoded = Vec::with_capacity(capacity.min(64 * 1024));
        Read::by_ref(&mut file)
            .take(MAX_DATASET_LINKS_BYTES.saturating_add(1))
            .read_to_end(&mut encoded)
            .map_err(|error| format!("could not read {}: {error}", path.display()))?;
        if u64::try_from(encoded.len()).unwrap_or(u64::MAX) > MAX_DATASET_LINKS_BYTES {
            return Err(format!(
                "{} exceeds the {} byte dataset-links limit",
                path.display(),
                MAX_DATASET_LINKS_BYTES
            ));
        }

        let Ok(root) = serde_json::from_slice::<Value>(&encoded) else {
            return Ok(Vec::new());
        };
        let Some(datasets) = root.get("datasets").and_then(Value::as_array) else {
            return Ok(Vec::new());
        };
        if datasets.iter().any(|dataset| !dataset.is_object()) {
            return Ok(Vec::new());
        }

        Ok(datasets
            .iter()
            .filter_map(Value::as_object)
            .map(|dataset| DatasetLinkIdentity {
                id: dataset
                    .get("id")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_owned(),
                name: dataset
                    .get("name")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_owned(),
                path: dataset
                    .get("path")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_owned(),
            })
            .collect())
    }

    /// Register a user-selected workspace. No scientific Store is created here.
    pub(crate) fn register_workspace(
        &self,
        path: &Path,
        name: &str,
        timestamp: &str,
        activate: bool,
    ) -> Result<Value, String> {
        let canonical = path.canonicalize().map_err(|error| error.to_string())?;
        if !canonical.is_dir() {
            return Err("Workspace path is not a directory".into());
        }
        let canonical = canonical.to_str().ok_or("Workspace path is not UTF-8")?;
        let _guard = self
            .write_lock
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let mut settings = self.load()?;
        let workspaces = settings
            .as_object_mut()
            .ok_or("Invalid app settings")?
            .entry("linked_workspaces")
            .or_insert_with(|| json!([]))
            .as_array_mut()
            .ok_or("Invalid workspace catalogue")?;
        let index = if let Some(index) = workspaces
            .iter()
            .position(|entry| entry["path"] == canonical)
        {
            verified_linked_workspace_access(
                self,
                workspaces[index]
                    .as_object()
                    .ok_or("Invalid workspace record")?,
            )?;
            index
        } else {
            if workspaces.len() >= 256 {
                return Err("Workspace catalogue limit reached (256)".into());
            }
            let id = new_workspace_id(canonical, timestamp, workspaces);
            workspaces.push(json!({"id": id, "path": canonical, "name": name,
                "linked_at": timestamp, "is_active": false, "discovered": {}}));
            workspaces.len() - 1
        };
        if activate {
            for (position, entry) in workspaces.iter_mut().enumerate() {
                entry
                    .as_object_mut()
                    .ok_or("Invalid workspace record")?
                    .insert("is_active".into(), json!(position == index));
            }
        }
        let entry = workspaces[index]
            .as_object()
            .ok_or("Invalid workspace record")?;
        let id = entry
            .get("id")
            .and_then(Value::as_str)
            .ok_or("Workspace ID is missing")?;
        let response = linked_workspace_response(entry, id);
        self.save(&settings)?;
        Ok(response)
    }

    /// Mark a persisted linked workspace as active without loading its data or
    /// invoking a Python workspace manager.  This is intentionally limited to
    /// catalogue state; scanning and scientific-store access stay outside this
    /// settings store until their native contracts are available.
    pub fn activate_linked_workspace(&self, workspace_id: &str) -> Result<Option<Value>, String> {
        let _write_guard = self
            .write_lock
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let mut settings = self.load()?;
        let root = settings
            .as_object_mut()
            .ok_or_else(|| "app settings root must be a JSON object".to_string())?;
        let workspaces = root
            .entry("linked_workspaces")
            .or_insert_with(|| Value::Array(Vec::new()))
            .as_array_mut()
            .ok_or_else(|| "stored linked_workspaces must be a JSON array".to_string())?;

        if !workspaces.iter().any(|workspace| {
            workspace
                .get("id")
                .and_then(Value::as_str)
                .is_some_and(|id| id == workspace_id)
        }) {
            return Ok(None);
        }

        let mut activated = None;
        for workspace in workspaces {
            let workspace = workspace.as_object_mut().ok_or_else(|| {
                "stored linked_workspaces entries must be JSON objects".to_string()
            })?;
            let is_active = workspace.get("id").and_then(Value::as_str) == Some(workspace_id);
            workspace.insert("is_active".into(), Value::Bool(is_active));
            if is_active {
                activated = Some(linked_workspace_response(workspace, workspace_id));
            }
        }
        self.save(&settings)?;
        Ok(activated)
    }

    pub fn unlink_linked_workspace(&self, workspace_id: &str) -> Result<bool, String> {
        let _write_guard = self
            .write_lock
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let mut settings = self.load()?;
        let root = settings
            .as_object_mut()
            .ok_or_else(|| "app settings root must be a JSON object".to_string())?;
        let workspaces = root
            .entry("linked_workspaces")
            .or_insert_with(|| Value::Array(Vec::new()))
            .as_array_mut()
            .ok_or_else(|| "stored linked_workspaces must be a JSON array".to_string())?;
        let was_active = workspaces.iter().any(|workspace| {
            workspace.as_object().is_some_and(|workspace| {
                workspace.get("id").and_then(Value::as_str) == Some(workspace_id)
                    && workspace
                        .get("is_active")
                        .and_then(Value::as_bool)
                        .unwrap_or(false)
            })
        });
        let original_len = workspaces.len();
        workspaces.retain(|workspace| {
            workspace
                .get("id")
                .and_then(Value::as_str)
                .is_none_or(|id| id != workspace_id)
        });
        let removed = workspaces.len() != original_len;
        if !removed {
            return Ok(false);
        }
        if was_active {
            if let Some(workspace) = workspaces.first_mut().and_then(Value::as_object_mut) {
                workspace.insert("is_active".into(), Value::Bool(true));
            }
        }
        self.save(&settings)?;
        Ok(true)
    }

    #[must_use]
    pub fn config_path_response(&self) -> Value {
        json!({
            "current_path": display_path(&self.config_dir),
            "default_path": display_path(&self.default_config_dir),
            "is_custom": self.config_dir != self.default_config_dir,
        })
    }

    pub fn set_config_path(&mut self, path: &str) -> Result<PathBuf, ConfigPathError> {
        let _write_guard = self
            .write_lock
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let config_dir = Path::new(path)
            .canonicalize()
            .map_err(|_| ConfigPathError::DoesNotExist(path.to_owned()))?;
        if !config_dir.is_dir() {
            return Err(ConfigPathError::NotDirectory(path.to_owned()));
        }
        fs::create_dir_all(&self.default_config_dir).map_err(|error| {
            ConfigPathError::Storage(format!(
                "could not create config directory {}: {error}",
                self.default_config_dir.display()
            ))
        })?;
        let redirect = self.default_config_dir.join(CONFIG_REDIRECT_FILE);
        let target = display_path(&config_dir);
        AtomicFile::new(&redirect, AllowOverwrite)
            .write(|file| file.write_all(target.as_bytes()))
            .map_err(|error| {
                ConfigPathError::Storage(format!("could not write {}: {error}", redirect.display()))
            })?;
        self.config_dir.clone_from(&config_dir);
        Ok(config_dir)
    }

    pub fn reset_config_path(&mut self) -> Result<PathBuf, ConfigPathError> {
        let _write_guard = self
            .write_lock
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let redirect = self.default_config_dir.join(CONFIG_REDIRECT_FILE);
        if redirect.exists() {
            fs::remove_file(&redirect).map_err(|error| {
                ConfigPathError::Storage(format!(
                    "could not remove {}: {error}",
                    redirect.display()
                ))
            })?;
        }
        fs::create_dir_all(&self.default_config_dir).map_err(|error| {
            ConfigPathError::Storage(format!(
                "could not create config directory {}: {error}",
                self.default_config_dir.display()
            ))
        })?;
        self.config_dir = self.default_config_dir.clone();
        Ok(self.config_dir.clone())
    }

    fn load(&self) -> Result<Value, String> {
        let path = self.config_dir.join(APP_SETTINGS_FILE);
        if !path.exists() {
            return Ok(default_settings());
        }
        let content = fs::read_to_string(&path)
            .map_err(|error| format!("could not read {}: {error}", path.display()))?;
        match serde_json::from_str::<Value>(&content) {
            Ok(settings) if settings.is_object() => Ok(settings),
            Ok(_) | Err(_) => Ok(default_settings()),
        }
    }

    fn save(&self, settings: &Value) -> Result<(), String> {
        self.save_named_json(APP_SETTINGS_FILE, settings)
    }

    fn save_named_json(&self, file_name: &str, document: &Value) -> Result<(), String> {
        fs::create_dir_all(&self.config_dir).map_err(|error| {
            format!(
                "could not create settings directory {}: {error}",
                self.config_dir.display()
            )
        })?;
        let path = self.config_dir.join(file_name);
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let temporary = self
            .config_dir
            .join(format!(".{file_name}.{}-{nonce}.tmp", process::id()));
        let encoded = serde_json::to_vec_pretty(document)
            .map_err(|error| format!("could not encode app settings: {error}"))?;
        let write_result = (|| -> Result<(), String> {
            let mut file = OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&temporary)
                .map_err(|error| format!("could not create {}: {error}", temporary.display()))?;
            file.write_all(&encoded)
                .and_then(|()| file.write_all(b"\n"))
                .and_then(|()| file.sync_all())
                .map_err(|error| format!("could not write {}: {error}", temporary.display()))?;
            replace_atomic(&temporary, &path).map_err(|error| {
                format!(
                    "could not atomically replace app settings at {}: {error}",
                    path.display()
                )
            })
        })();
        if write_result.is_err() {
            let _ = fs::remove_file(&temporary);
        }
        write_result
    }
}

fn resolve_config_dir() -> PathBuf {
    if let Some(path) = nonempty_env(CONFIG_ENV) {
        return PathBuf::from(path);
    }
    if let Some(root) = nonempty_env(PORTABLE_ROOT_ENV) {
        return PathBuf::from(root).join("config");
    }
    if let Some(portable_exe) = nonempty_env(PORTABLE_EXE_ENV) {
        if let Some(parent) = Path::new(&portable_exe).parent() {
            return parent.join(".nirs4all").join("config");
        }
    }
    let default = default_config_dir();
    let redirect = default.join(CONFIG_REDIRECT_FILE);
    if let Ok(path) = fs::read_to_string(redirect) {
        let path = PathBuf::from(path.trim());
        if !path.as_os_str().is_empty() && path.is_dir() {
            return path;
        }
    }
    default
}

fn legacy_setup_path() -> Option<PathBuf> {
    let data_dir = if cfg!(windows) {
        nonempty_env("LOCALAPPDATA")
            .map(|root| PathBuf::from(root).join("nirs4all/nirs4all-webapp"))
    } else if cfg!(target_os = "macos") {
        nonempty_env("HOME")
            .map(|root| PathBuf::from(root).join("Library/Application Support/nirs4all-webapp"))
    } else {
        nonempty_env("XDG_DATA_HOME")
            .map(PathBuf::from)
            .or_else(|| nonempty_env("HOME").map(|root| PathBuf::from(root).join(".local/share")))
            .map(|root| root.join("nirs4all-webapp"))
    };
    data_dir.map(|root| root.join(SETUP_STATUS_FILE))
}

fn default_config_dir() -> PathBuf {
    if cfg!(windows) {
        nonempty_env("APPDATA")
            .map(PathBuf::from)
            .or_else(|| {
                nonempty_env("USERPROFILE").map(|home| PathBuf::from(home).join("AppData/Roaming"))
            })
            .unwrap_or_else(|| PathBuf::from(".").join("AppData/Roaming"))
            .join("nirs4all")
    } else {
        nonempty_env("HOME")
            .map_or_else(|| PathBuf::from("."), PathBuf::from)
            .join(".nirs4all")
    }
}

fn nonempty_env(name: &str) -> Option<String> {
    env::var(name).ok().filter(|value| !value.trim().is_empty())
}

fn display_path(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

fn default_settings() -> Value {
    json!({
        "version": "3.0",
        "linked_workspaces": [],
        "favorite_pipelines": [],
        "ui_preferences": {
            "theme": "system",
            "density": "comfortable",
            "language": "en",
        },
    })
}

fn default_setup_status() -> Value {
    json!({
        "setup_completed": false,
        "selected_profile": null,
        "completed_at": null,
    })
}

fn linked_workspace_response(workspace: &Map<String, Value>, id: &str) -> Value {
    let discovered = workspace
        .get("discovered")
        .filter(|value| value.is_object())
        .filter(|value| value.as_object().is_some_and(|items| !items.is_empty()))
        .cloned()
        .unwrap_or_else(default_discovered);
    json!({
        "id": id,
        "path": workspace.get("path").and_then(Value::as_str).unwrap_or_default(),
        "name": workspace.get("name").and_then(Value::as_str).unwrap_or_default(),
        "is_active": workspace.get("is_active").and_then(Value::as_bool).unwrap_or(false),
        "linked_at": workspace.get("linked_at").and_then(Value::as_str).unwrap_or_default(),
        "last_scanned": workspace.get("last_scanned").and_then(Value::as_str),
        "discovered": discovered,
    })
}

fn verified_linked_workspace_access(
    _settings: &AppSettingsStore,
    workspace: &Map<String, Value>,
) -> Result<LinkedWorkspaceAccess, String> {
    let path = workspace
        .get("path")
        .and_then(Value::as_str)
        .filter(|path| !path.trim().is_empty())
        .ok_or_else(|| "linked workspace is missing a path".to_string())?;
    let path = PathBuf::from(path);
    let store = open_linked_store(&path)?.map(|connection| Arc::new(Mutex::new(connection)));
    let id = workspace
        .get("id")
        .and_then(Value::as_str)
        .filter(|id| !id.is_empty())
        .ok_or_else(|| "linked workspace is missing an id".to_string())?
        .to_owned();
    Ok(LinkedWorkspaceAccess { id, path, store })
}

fn default_discovered() -> Value {
    json!({
        "runs_count": 0,
        "datasets_count": 0,
        "exports_count": 0,
        "templates_count": 0,
    })
}

fn new_workspace_id(path: &str, linked_at: &str, workspaces: &[Value]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(path.as_bytes());
    hasher.update([0]);
    hasher.update(linked_at.as_bytes());
    let digest = format!("{:x}", hasher.finalize());
    let existing = workspaces
        .iter()
        .filter_map(|workspace| workspace.get("id").and_then(Value::as_str))
        .collect::<HashSet<_>>();
    for suffix in 0_u32.. {
        let candidate = if suffix == 0 {
            format!("ws_{}", &digest[..16])
        } else {
            format!("ws_{}_{suffix}", &digest[..16])
        };
        if !existing.contains(candidate.as_str()) {
            return candidate;
        }
    }
    unreachable!("the finite workspace catalogue cannot exhaust u32 identifiers")
}

fn next_workspace_id(index: usize, seen_ids: &HashSet<String>) -> String {
    let mut suffix = index.saturating_add(1);
    loop {
        let id = format!("ws_r1_{suffix:016x}");
        if !seen_ids.contains(&id) {
            return id;
        }
        suffix = suffix.saturating_add(1);
    }
}

fn favourite_pipelines(settings: &Value) -> Vec<String> {
    settings
        .get("favorite_pipelines")
        .and_then(Value::as_array)
        .map(|values| {
            values
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_owned)
                .collect()
        })
        .unwrap_or_default()
}

fn deep_merge(current: &mut Map<String, Value>, updates: &Map<String, Value>) {
    for (key, update) in updates {
        match (current.get_mut(key), update) {
            (Some(Value::Object(current)), Value::Object(updates)) => deep_merge(current, updates),
            _ => {
                current.insert(key.clone(), update.clone());
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use std::{
        env, fs,
        path::{Path, PathBuf},
        time::{SystemTime, UNIX_EPOCH},
    };

    use serde_json::{json, Value};

    use super::{
        path_matches_open_file, AppSettingsStore, Connection, DatasetLinkIdentity,
        BEFORE_LINKED_STORE_OPEN, MAX_DATASET_LINKS_BYTES,
    };

    fn temporary_directory(name: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = env::temp_dir().join(format!(
            "studio-sidecar-{name}-{}-{nonce}",
            std::process::id()
        ));
        fs::create_dir_all(&path).unwrap();
        path
    }

    fn write_test_store(workspace: &Path) {
        let connection = rusqlite::Connection::open(workspace.join("store.sqlite")).unwrap();
        connection
            .execute_batch(
                "PRAGMA user_version = 2;
                 CREATE TABLE projects(project_id TEXT PRIMARY KEY, name TEXT NOT NULL);
                 CREATE TABLE runs(run_id TEXT PRIMARY KEY, name TEXT NOT NULL, status TEXT);
                 CREATE TABLE pipelines(pipeline_id TEXT PRIMARY KEY, run_id TEXT NOT NULL, name TEXT NOT NULL, dataset_name TEXT NOT NULL);
                 CREATE TABLE chains(chain_id TEXT PRIMARY KEY, pipeline_id TEXT NOT NULL, steps TEXT NOT NULL, model_step_idx INTEGER NOT NULL, model_class TEXT NOT NULL);
                 CREATE TABLE predictions(prediction_id TEXT PRIMARY KEY, pipeline_id TEXT NOT NULL, dataset_name TEXT NOT NULL, model_name TEXT NOT NULL, model_class TEXT NOT NULL, fold_id TEXT NOT NULL, partition TEXT NOT NULL, metric TEXT NOT NULL, task_type TEXT NOT NULL);
                 CREATE TABLE artifacts(artifact_id TEXT PRIMARY KEY, artifact_path TEXT NOT NULL, content_hash TEXT NOT NULL);
                 CREATE TABLE logs(log_id TEXT PRIMARY KEY, pipeline_id TEXT NOT NULL, step_idx INTEGER NOT NULL, event TEXT NOT NULL);",
            )
            .unwrap();
    }

    #[test]
    fn reads_the_existing_python_settings_shape_and_updates_preferences() {
        let directory = temporary_directory("settings");
        fs::write(
            directory.join("app_settings.json"),
            serde_json::to_string(&json!({
                "version": "3.0",
                "linked_workspaces": [{"id": "workspace-a"}],
                "favorite_pipelines": ["pipeline-a"],
                "ui_preferences": {"theme": "dark", "nested": {"retained": true}},
            }))
            .unwrap(),
        )
        .unwrap();
        let store = AppSettingsStore::new(&directory);

        assert_eq!(
            store.response().unwrap(),
            json!({
                "version": "3.0",
                "linked_workspaces_count": 1,
                "favorite_pipelines": ["pipeline-a"],
                "ui_preferences": {"theme": "dark", "nested": {"retained": true}},
            })
        );
        store
            .update_ui_preferences(
                &json!({"ui_preferences": {"nested": {"added": true}, "density": "compact"}}),
            )
            .unwrap();
        let settings: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(directory.join("app_settings.json")).unwrap())
                .unwrap();
        assert_eq!(settings["ui_preferences"]["theme"], "dark");
        assert_eq!(
            settings["ui_preferences"]["nested"],
            json!({"retained": true, "added": true})
        );
        assert_eq!(settings["ui_preferences"]["density"], "compact");
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn adds_and_removes_favourites_without_duplicates() {
        let directory = temporary_directory("favourites");
        let store = AppSettingsStore::new(&directory);

        assert!(store.add_favourite("pipeline-a").unwrap());
        assert!(!store.add_favourite("pipeline-a").unwrap());
        assert_eq!(
            store.favourites_response().unwrap(),
            json!({"favorites": ["pipeline-a"], "count": 1})
        );
        assert!(store.remove_favourite("pipeline-a").unwrap());
        assert!(!store.remove_favourite("pipeline-a").unwrap());
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn setup_status_preserves_python_installation_marker_and_native_precedence() {
        let directory = temporary_directory("python-setup-migration");
        let legacy = directory.join("python-data/setup_status.json");
        fs::create_dir_all(legacy.parent().unwrap()).unwrap();
        let original =
            r#"{"setup_completed":true,"selected_profile":"cpu-lite","completed_at":"2026-08-07"}"#;
        fs::write(&legacy, original).unwrap();
        let mut store = AppSettingsStore::new(directory.join("native-config"));
        store.legacy_setup_path = Some(legacy.clone());
        assert_eq!(
            store.setup_status().unwrap()["selected_profile"],
            "cpu-lite"
        );
        assert!(!store.config_dir.join("app_settings.json").exists());
        store.complete_setup("cpu").unwrap();
        assert_eq!(store.setup_status().unwrap()["selected_profile"], "cpu");
        assert_eq!(fs::read_to_string(legacy).unwrap(), original);
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn setup_status_round_trips_in_the_legacy_file_without_python() {
        let directory = temporary_directory("setup-status");
        let store = AppSettingsStore::new(&directory);

        assert_eq!(
            store.setup_status().unwrap(),
            json!({
                "setup_completed": false,
                "selected_profile": null,
                "completed_at": null,
            })
        );
        assert_eq!(
            store.complete_setup("cpu").unwrap(),
            json!({
                "setup_completed": true,
                "selected_profile": "cpu",
                "completed_at": null,
            })
        );
        assert_eq!(store.setup_status().unwrap()["selected_profile"], "cpu");
        assert!(store.complete_setup("  ").is_err());
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn reads_only_dataset_link_identity_fields_without_rewriting_the_catalogue() {
        let directory = temporary_directory("dataset-links");
        let path = directory.join("dataset_links.json");
        let encoded = serde_json::to_vec_pretty(&json!({
            "version": "1.0",
            "schema_version": 1,
            "datasets": [
                {
                    "id": "dataset-a",
                    "name": "Dataset A",
                    "path": "/datasets/a",
                    "config": {"na_policy": "Drop"},
                    "stats": {"samples": 12},
                },
                {"id": "dataset-b", "name": "Dataset B"},
                {"id": 42, "name": null, "path": ["not", "a", "path"]},
            ],
        }))
        .unwrap();
        fs::write(&path, &encoded).unwrap();
        let store = AppSettingsStore::new(&directory);

        assert_eq!(
            store.dataset_links().unwrap(),
            vec![
                DatasetLinkIdentity {
                    id: "dataset-a".into(),
                    name: "Dataset A".into(),
                    path: "/datasets/a".into(),
                },
                DatasetLinkIdentity {
                    id: "dataset-b".into(),
                    name: "Dataset B".into(),
                    path: String::new(),
                },
                DatasetLinkIdentity {
                    id: String::new(),
                    name: String::new(),
                    path: String::new(),
                },
            ]
        );
        assert_eq!(fs::read(path).unwrap(), encoded);
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn dataset_links_use_the_empty_legacy_default_for_missing_or_malformed_json() {
        let directory = temporary_directory("dataset-links-default");
        let path = directory.join("dataset_links.json");
        let store = AppSettingsStore::new(&directory);

        assert_eq!(
            store.dataset_links().unwrap(),
            Vec::<DatasetLinkIdentity>::new()
        );
        for malformed in [
            b"not-json".as_slice(),
            br"[]".as_slice(),
            br#"{"datasets": null}"#.as_slice(),
            br#"{"datasets": [{"id": "valid"}, 7]}"#.as_slice(),
        ] {
            fs::write(&path, malformed).unwrap();
            assert_eq!(
                store.dataset_links().unwrap(),
                Vec::<DatasetLinkIdentity>::new()
            );
        }
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn rejects_oversized_dataset_links_without_parsing_a_prefix() {
        let directory = temporary_directory("dataset-links-size");
        let path = directory.join("dataset_links.json");
        let oversized_len = usize::try_from(MAX_DATASET_LINKS_BYTES).unwrap() + 1;
        fs::write(&path, vec![b' '; oversized_len]).unwrap();
        let store = AppSettingsStore::new(&directory);

        let error = store.dataset_links().unwrap_err();
        assert!(error.contains("exceeds the"));
        assert!(error.contains("dataset-links limit"));
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn redirects_and_resets_the_config_directory_without_losing_app_settings_shape() {
        let directory = temporary_directory("config-path");
        let initial = directory.join("initial");
        let default = directory.join("default");
        let custom = directory.join("custom");
        fs::create_dir_all(&initial).unwrap();
        fs::create_dir_all(&custom).unwrap();
        let mut store = AppSettingsStore::with_config_paths(&initial, &default);

        let custom = custom.canonicalize().unwrap();
        assert_eq!(
            store.set_config_path(&custom.to_string_lossy()).unwrap(),
            custom
        );
        assert_eq!(
            fs::read_to_string(default.join("config_redirect.txt")).unwrap(),
            custom.to_string_lossy()
        );
        assert_eq!(
            store.config_path_response()["current_path"],
            custom.to_string_lossy().as_ref()
        );
        store
            .update_ui_preferences(&json!({"ui_preferences": {"theme": "dark"}}))
            .unwrap();
        assert!(custom.join("app_settings.json").exists());

        assert_eq!(store.reset_config_path().unwrap(), default);
        assert!(!default.join("config_redirect.txt").exists());
        assert_eq!(store.config_path_response()["is_custom"], false);
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn lists_linked_workspaces_and_repairs_duplicate_ids() {
        let directory = temporary_directory("linked-workspaces");
        fs::write(
            directory.join("app_settings.json"),
            serde_json::to_string(&json!({
                "linked_workspaces": [
                    {"id": "workspace-a", "path": "/workspaces/a", "name": "A", "is_active": false},
                    {"id": "workspace-a", "path": "/workspaces/b", "name": "B", "is_active": true, "discovered": {}},
                ],
            }))
            .unwrap(),
        )
        .unwrap();
        let store = AppSettingsStore::new(&directory);

        assert_eq!(
            store.linked_workspaces_response().unwrap(),
            json!({
                "workspaces": [
                    {
                        "id": "workspace-a",
                        "path": "/workspaces/a",
                        "name": "A",
                        "is_active": false,
                        "linked_at": "",
                        "last_scanned": null,
                        "discovered": {"runs_count": 0, "datasets_count": 0, "exports_count": 0, "templates_count": 0},
                    },
                    {
                        "id": "ws_r1_0000000000000002",
                        "path": "/workspaces/b",
                        "name": "B",
                        "is_active": true,
                        "linked_at": "",
                        "last_scanned": null,
                        "discovered": {"runs_count": 0, "datasets_count": 0, "exports_count": 0, "templates_count": 0},
                    },
                ],
                "active_workspace_id": "ws_r1_0000000000000002",
                "total": 2,
            })
        );
        let settings: Value =
            serde_json::from_str(&fs::read_to_string(directory.join("app_settings.json")).unwrap())
                .unwrap();
        assert_eq!(
            settings["linked_workspaces"][1]["id"],
            "ws_r1_0000000000000002"
        );
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn activates_and_unlinks_linked_workspaces_without_touching_workspace_files() {
        let directory = temporary_directory("linked-workspace-mutations");
        fs::write(
            directory.join("app_settings.json"),
            serde_json::to_string(&json!({
                "linked_workspaces": [
                    {
                        "id": "workspace-a",
                        "path": "/workspaces/a",
                        "name": "A",
                        "is_active": true,
                        "linked_at": "2026-08-31T12:00:00",
                        "last_scanned": null,
                        "discovered": {"runs_count": 1},
                    },
                    {
                        "id": "workspace-b",
                        "path": "/workspaces/b",
                        "name": "B",
                        "is_active": false,
                        "linked_at": "2026-08-31T12:01:00",
                        "last_scanned": "2026-08-31T12:02:00",
                        "discovered": {"datasets_count": 2},
                    },
                ],
            }))
            .unwrap(),
        )
        .unwrap();
        let store = AppSettingsStore::new(&directory);

        assert_eq!(store.activate_linked_workspace("missing").unwrap(), None);
        assert_eq!(
            store.activate_linked_workspace("workspace-b").unwrap(),
            Some(json!({
                "id": "workspace-b",
                "path": "/workspaces/b",
                "name": "B",
                "is_active": true,
                "linked_at": "2026-08-31T12:01:00",
                "last_scanned": "2026-08-31T12:02:00",
                "discovered": {"datasets_count": 2},
            }))
        );
        assert_eq!(
            store.linked_workspaces_response().unwrap()["active_workspace_id"],
            "workspace-b"
        );
        assert!(store.unlink_linked_workspace("workspace-b").unwrap());
        assert!(!store.unlink_linked_workspace("workspace-b").unwrap());
        let listed = store.linked_workspaces_response().unwrap();
        assert_eq!(listed["active_workspace_id"], "workspace-a");
        assert_eq!(listed["total"], 1);
        assert_eq!(listed["workspaces"][0]["is_active"], true);
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn readiness_never_opens_or_hashes_the_workspace_store() {
        let directory = temporary_directory("readiness-store-cost");
        let workspace = directory.join("workspace");
        fs::create_dir(&workspace).unwrap();
        let database = workspace.join("store.sqlite");
        let connection = Connection::open(&database).unwrap();
        connection
            .execute_batch("PRAGMA user_version=5; CREATE TABLE spectra (data BLOB)")
            .unwrap();
        connection
            .execute("INSERT INTO spectra VALUES (zeroblob(67108864))", [])
            .unwrap();
        drop(connection);
        fs::write(
            directory.join("app_settings.json"),
            json!({"linked_workspaces": [{
                "id": "large", "path": workspace.canonicalize().unwrap(), "is_active": true
            }]})
            .to_string(),
        )
        .unwrap();
        let settings = AppSettingsStore::new(&directory);
        BEFORE_LINKED_STORE_OPEN.with(|hook| {
            *hook.borrow_mut() = Some(Box::new(|| panic!("readiness opened the Store")));
        });
        let start = std::time::Instant::now();
        for _ in 0..100 {
            assert!(settings.workspace_catalogue_ready());
        }
        let elapsed = start.elapsed();
        BEFORE_LINKED_STORE_OPEN.with(|hook| {
            hook.borrow_mut().take();
        });
        eprintln!("100 readiness catalogue reads, 64 MiB Store: {elapsed:?}");
        assert!(elapsed < std::time::Duration::from_secs(2));
        let start = std::time::Instant::now();
        for _ in 0..100 {
            let access = settings.active_linked_workspace_access().unwrap().unwrap();
            let length: u64 = access
                .store()
                .unwrap()
                .query_row("SELECT length(data) FROM spectra", [], |row| row.get(0))
                .unwrap();
            assert_eq!(length, 67_108_864);
        }
        eprintln!(
            "100 transaction Store reads, 64 MiB Store: {:?}",
            start.elapsed()
        );
        assert!(start.elapsed() < std::time::Duration::from_secs(2));
        // A long-lived writer and WAL commits are normal during training.
        let writer = Connection::open(&database).unwrap();
        writer.execute_batch("PRAGMA journal_mode=WAL; CREATE TABLE results (score REAL); INSERT INTO results VALUES (0.9)").unwrap();
        let first = settings.active_linked_workspace_access().unwrap().unwrap();
        let count = |access: &super::LinkedWorkspaceAccess| {
            access
                .store()
                .unwrap()
                .query_row("SELECT COUNT(*) FROM results", [], |row| {
                    row.get::<_, i64>(0)
                })
                .unwrap()
        };
        assert_eq!(count(&first), 1);
        writer
            .execute("INSERT INTO results VALUES (0.8)", [])
            .unwrap();
        assert_eq!(count(&first), 1, "one request keeps its snapshot");
        let next = settings.active_linked_workspace_access().unwrap().unwrap();
        assert_eq!(
            count(&next),
            2,
            "next poll sees the committed training result"
        );
        drop(first);
        drop(next);
        drop(writer);
        drop(settings);
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn live_handle_identity_rejects_path_replacement() {
        let root = temporary_directory("live-handle-identity");
        let path = root.join("candidate");
        let held_path = root.join("held-candidate");
        fs::write(&path, b"original").unwrap();
        let held = fs::File::open(&path).unwrap();
        assert!(path_matches_open_file(&path, &held));

        fs::rename(&path, &held_path).unwrap();
        fs::write(&path, b"replacement").unwrap();
        assert!(!path_matches_open_file(&path, &held));

        drop(held);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn authenticated_connection_rejects_substitution_in_exact_pre_open_window() {
        let directory = temporary_directory("linked-store-exact-open-window");
        let workspace = directory.join("workspace");
        fs::create_dir(&workspace).unwrap();
        write_test_store(&workspace);
        fs::write(
            directory.join("app_settings.json"),
            serde_json::to_vec(&json!({"linked_workspaces": [{
                "id": "workspace-a", "path": workspace.canonicalize().unwrap(),
                "name": "Workspace", "is_active": true
            }]}))
            .unwrap(),
        )
        .unwrap();
        let settings = AppSettingsStore::new(&directory);
        let replacement_dir = directory.join("replacement");
        fs::create_dir(&replacement_dir).unwrap();
        write_test_store(&replacement_dir);
        let replacement = replacement_dir.join("store.sqlite");
        let connection = Connection::open(&replacement).unwrap();
        connection
            .execute(
                "INSERT INTO projects(project_id, name) VALUES ('substituted', 'Substituted')",
                [],
            )
            .unwrap();
        drop(connection);
        let active_store = workspace.join("store.sqlite");
        let displaced = workspace.join("store.original.sqlite");
        BEFORE_LINKED_STORE_OPEN.with(|hook| {
            *hook.borrow_mut() = Some(Box::new(move || {
                fs::rename(&active_store, &displaced).unwrap();
                fs::rename(&replacement, &active_store).unwrap();
            }));
        });

        let error = settings
            .linked_workspace_access("workspace-a")
            .err()
            .expect("substituted Store must never become consumable");
        assert!(error.contains("file identity changed"));
        fs::remove_dir_all(directory).unwrap();
    }
}
