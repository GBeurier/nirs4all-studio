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
    io::{Read, Seek, Write},
    path::{Path, PathBuf},
    process,
    sync::{Arc, Mutex},
    time::{SystemTime, UNIX_EPOCH},
};

use atomicwrites::{replace_atomic, AllowOverwrite, AtomicFile};
use cap_std::{ambient_authority, fs::Dir};
use rusqlite::{Connection, DatabaseName, OpenFlags};
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
const STORE_CONTENT_SHA256_FIELD: &str = "store_content_sha256";

#[derive(Clone, Debug)]
pub struct AppSettingsStore {
    config_dir: PathBuf,
    default_config_dir: PathBuf,
    write_lock: Arc<Mutex<()>>,
}

/// A linked workspace resolution whose content-addressed Store, when present,
/// is held by the exact `SQLite` connection whose bytes were authenticated.
pub struct LinkedWorkspaceAccess {
    path: PathBuf,
    store: Option<Connection>,
}

impl LinkedWorkspaceAccess {
    pub fn path(&self) -> &Path {
        &self.path
    }

    pub const fn store(&self) -> Option<&Connection> {
        self.store.as_ref()
    }
}

struct WorkspaceActivationGuard {
    workspace_path: PathBuf,
    store_path: PathBuf,
    workspace_metadata: fs::Metadata,
    store_metadata: fs::Metadata,
    workspace_handle: Dir,
    store_handle: fs::File,
}

impl WorkspaceActivationGuard {
    fn capture(workspace_path: &Path, store_path: &Path) -> Result<Self, String> {
        let workspace_metadata = fs::symlink_metadata(workspace_path)
            .map_err(|error| format!("could not identify converted workspace: {error}"))?;
        if workspace_metadata.file_type().is_symlink() || !workspace_metadata.is_dir() {
            return Err("converted workspace identity changed before activation".into());
        }
        let workspace_handle = Dir::open_ambient_dir(workspace_path, ambient_authority())
            .map_err(|error| format!("could not hold converted workspace directory: {error}"))?;
        let opened_workspace = workspace_handle
            .try_clone()
            .map(Dir::into_std_file)
            .map_err(|error| {
                format!("could not clone held converted workspace directory: {error}")
            })?;
        let opened_workspace_metadata = opened_workspace.metadata().map_err(|error| {
            format!("could not identify held converted workspace directory: {error}")
        })?;
        if !metadata_attributes_unchanged(&workspace_metadata, &opened_workspace_metadata)
            || !crate::legacy_conversion::path_matches_open_file(workspace_path, &opened_workspace)
        {
            return Err("converted workspace identity changed before activation".into());
        }
        let store_handle = fs::File::open(store_path)
            .map_err(|error| format!("could not hold converted workspace store: {error}"))?;
        let store_metadata = store_handle
            .metadata()
            .map_err(|error| format!("could not identify converted workspace store: {error}"))?;
        let guard = Self {
            workspace_path: workspace_path.to_path_buf(),
            store_path: store_path.to_path_buf(),
            workspace_metadata,
            store_metadata,
            workspace_handle,
            store_handle,
        };
        guard.revalidate()?;
        Ok(guard)
    }

    fn revalidate(&self) -> Result<(), String> {
        let workspace_metadata = fs::symlink_metadata(&self.workspace_path)
            .map_err(|error| format!("converted workspace changed before activation: {error}"))?;
        let store_metadata = fs::symlink_metadata(&self.store_path).map_err(|error| {
            format!("converted workspace store changed before activation: {error}")
        })?;
        if workspace_metadata.file_type().is_symlink()
            || !workspace_metadata.is_dir()
            || store_metadata.file_type().is_symlink()
            || !store_metadata.is_file()
            || fs::canonicalize(&self.workspace_path).ok().as_deref()
                != Some(self.workspace_path.as_path())
            || fs::canonicalize(&self.store_path).ok().as_deref() != Some(self.store_path.as_path())
            || !workspace_path_matches_handle(&self.workspace_path, &self.workspace_handle)
            || !crate::legacy_conversion::path_matches_open_file(
                &self.store_path,
                &self.store_handle,
            )
            || !metadata_attributes_unchanged(&self.workspace_metadata, &workspace_metadata)
            || !metadata_attributes_unchanged(&self.store_metadata, &store_metadata)
        {
            return Err("converted workspace identity changed before atomic activation".into());
        }
        Ok(())
    }

    fn final_validate(&self) -> Result<String, String> {
        self.revalidate()?;
        let before_digest = sha256_file_handle(&self.store_handle)?;
        let connection = crate::legacy_conversion::open_validated_workspace_v2_store(
            &self.workspace_path,
            &self.store_path,
        )
        .map_err(|reason| format!("converted workspace failed final V2 validation: {reason}"))?;
        self.revalidate()?;
        let after_digest = sha256_file_handle(&self.store_handle)?;
        self.revalidate()?;
        if before_digest != after_digest {
            return Err("converted workspace content changed during final validation".into());
        }
        let authenticated = sha256_connection(&connection)?;
        drop(connection);
        Ok(authenticated)
    }
}

fn metadata_attributes_unchanged(before: &fs::Metadata, after: &fs::Metadata) -> bool {
    before.len() == after.len() && before.modified().ok() == after.modified().ok()
}

fn workspace_path_matches_handle(path: &Path, handle: &Dir) -> bool {
    handle.try_clone().is_ok_and(|held| {
        crate::legacy_conversion::path_matches_open_file(path, &held.into_std_file())
    })
}

fn sha256_file_handle(file: &fs::File) -> Result<String, String> {
    let mut file = file
        .try_clone()
        .map_err(|error| format!("could not clone converted workspace store handle: {error}"))?;
    file.rewind()
        .map_err(|error| format!("could not rewind converted workspace store: {error}"))?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 16 * 1024];
    loop {
        let count = file
            .read(&mut buffer)
            .map_err(|error| format!("could not hash converted workspace store: {error}"))?;
        if count == 0 {
            return Ok(format!("{:x}", hasher.finalize()));
        }
        hasher.update(&buffer[..count]);
    }
}

fn open_verified_persisted_store(
    workspace_path: &Path,
    expected: &str,
) -> Result<Connection, String> {
    if expected.len() != 64
        || !expected
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err("linked workspace has an invalid persisted store content identity".into());
    }
    let workspace_metadata = fs::symlink_metadata(workspace_path)
        .map_err(|error| format!("linked workspace is unavailable: {error}"))?;
    if workspace_metadata.file_type().is_symlink() || !workspace_metadata.is_dir() {
        return Err("linked workspace content identity cannot be verified safely".into());
    }
    let canonical_workspace = fs::canonicalize(workspace_path)
        .map_err(|error| format!("linked workspace cannot be resolved: {error}"))?;
    if canonical_workspace != workspace_path {
        return Err("linked workspace path changed after content-addressed activation".into());
    }
    let store_path = workspace_path.join("store.sqlite");
    let path_before = fs::symlink_metadata(&store_path)
        .map_err(|error| format!("linked workspace store is unavailable: {error}"))?;
    if path_before.file_type().is_symlink() || !path_before.is_file() {
        return Err("linked workspace store content identity cannot be verified safely".into());
    }
    refuse_store_journals(&store_path)?;
    before_linked_store_open();
    let mut uri = url::Url::from_file_path(&store_path)
        .map_err(|()| "linked workspace Store URI cannot be represented".to_string())?;
    uri.set_query(Some("mode=ro&immutable=1"));
    let connection = Connection::open_with_flags(
        uri.as_str(),
        OpenFlags::SQLITE_OPEN_READ_ONLY
            | OpenFlags::SQLITE_OPEN_URI
            | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|error| format!("linked workspace store cannot be opened: {error}"))?;
    let actual = sha256_connection(&connection)?;
    let path_after = fs::symlink_metadata(&store_path)
        .map_err(|error| format!("linked workspace store changed: {error}"))?;
    if path_after.file_type().is_symlink()
        || !path_after.is_file()
        || fs::canonicalize(&store_path).ok().as_deref() != Some(store_path.as_path())
    {
        return Err("linked workspace store changed during content verification".into());
    }
    refuse_store_journals(&store_path)?;
    if actual != expected {
        return Err("linked workspace store content does not match its activated identity".into());
    }
    Ok(connection)
}

fn sha256_connection(connection: &Connection) -> Result<String, String> {
    let bytes = connection
        .serialize(DatabaseName::Main)
        .map_err(|error| format!("could not serialize authenticated workspace Store: {error}"))?;
    let bytes: &[u8] = bytes.as_ref();
    Ok(format!("{:x}", Sha256::digest(bytes)))
}

fn refuse_store_journals(store_path: &Path) -> Result<(), String> {
    for suffix in ["-wal", "-shm", "-journal"] {
        let mut candidate = store_path.as_os_str().to_os_string();
        candidate.push(suffix);
        let candidate = PathBuf::from(candidate);
        match fs::symlink_metadata(&candidate) {
            Ok(_) => return Err("linked workspace Store has a live journal sidecar".into()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(format!("could not inspect Store journal sidecar: {error}")),
        }
    }
    Ok(())
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
        Self::with_config_paths(resolve_config_dir(), default_config_dir())
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
        let path = self.config_dir.join(SETUP_STATUS_FILE);
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
        verified_linked_workspace_access(workspace)?;
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
        Ok(Some(verified_linked_workspace_access(workspace)?))
    }

    /// Resolve a linked workspace and retain the exact authenticated `SQLite`
    /// connection for content-addressed converted entries.
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
        Ok(Some(verified_linked_workspace_access(workspace)?))
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

    /// Link and activate one verified converted workspace in a single atomic
    /// settings replacement.  The previous workspace remains in the catalogue
    /// as the non-destructive rollback target, and a failed save leaves the
    /// prior active selection untouched on disk.
    pub fn link_and_activate_workspace(
        &self,
        workspace_path: &Path,
        linked_at: &str,
        expected_active_workspace_id: &str,
    ) -> Result<Value, String> {
        self.link_and_activate_workspace_with_hooks(
            workspace_path,
            linked_at,
            expected_active_workspace_id,
            || {},
            || {},
        )
    }

    #[cfg(test)]
    fn link_and_activate_workspace_with_hook(
        &self,
        workspace_path: &Path,
        linked_at: &str,
        expected_active_workspace_id: &str,
        before_atomic_activation: impl FnOnce(),
    ) -> Result<Value, String> {
        self.link_and_activate_workspace_with_hooks(
            workspace_path,
            linked_at,
            expected_active_workspace_id,
            before_atomic_activation,
            || {},
        )
    }

    #[expect(
        clippy::too_many_lines,
        reason = "one locked transaction keeps CAS, catalogue mutation, final content validation, and atomic save inseparable"
    )]
    fn link_and_activate_workspace_with_hooks(
        &self,
        workspace_path: &Path,
        linked_at: &str,
        expected_active_workspace_id: &str,
        before_final_validation: impl FnOnce(),
        after_final_validation: impl FnOnce(),
    ) -> Result<Value, String> {
        let _write_guard = self
            .write_lock
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let metadata = fs::symlink_metadata(workspace_path).map_err(|error| {
            format!(
                "converted workspace is unavailable at {}: {error}",
                workspace_path.display()
            )
        })?;
        if metadata.file_type().is_symlink() || !metadata.is_dir() {
            return Err("converted workspace must be a real directory, not a link".into());
        }
        let workspace_path = fs::canonicalize(workspace_path).map_err(|error| {
            format!(
                "could not resolve converted workspace {}: {error}",
                workspace_path.display()
            )
        })?;
        let store = workspace_path.join("store.sqlite");
        let store_metadata = fs::symlink_metadata(&store).map_err(|error| {
            format!("verified converted workspace has no store.sqlite: {error}")
        })?;
        if store_metadata.file_type().is_symlink() || !store_metadata.is_file() {
            return Err("verified converted workspace store.sqlite must be a real file".into());
        }
        let activation_guard = WorkspaceActivationGuard::capture(&workspace_path, &store)?;
        let mut settings = self.load()?;
        let current_active_workspace_id = active_workspace_id(&settings);
        if current_active_workspace_id != Some(expected_active_workspace_id) {
            return Err(
                "active workspace changed while conversion was running; activation was skipped"
                    .into(),
            );
        }
        crate::legacy_conversion::validate_workspace_v2_store(&workspace_path, &store).map_err(
            |reason| format!("converted workspace failed strict V2 validation: {reason}"),
        )?;
        let confirmed_workspace_path = fs::canonicalize(&workspace_path)
            .map_err(|error| format!("could not re-resolve converted workspace: {error}"))?;
        if confirmed_workspace_path != workspace_path {
            return Err("converted workspace changed during validation".into());
        }
        let canonical_path = display_path(&workspace_path);
        let root = settings
            .as_object_mut()
            .ok_or_else(|| "app settings root must be a JSON object".to_string())?;
        let workspaces = root
            .entry("linked_workspaces")
            .or_insert_with(|| Value::Array(Vec::new()))
            .as_array_mut()
            .ok_or_else(|| "stored linked_workspaces must be a JSON array".to_string())?;

        let existing_index = workspaces.iter().position(|workspace| {
            workspace
                .get("path")
                .and_then(Value::as_str)
                .is_some_and(|path| paths_refer_to_same_location(path, &workspace_path))
        });
        let target_index = existing_index.unwrap_or_else(|| {
            let id = converted_workspace_id(&canonical_path, linked_at, workspaces);
            let name = workspace_path
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or("Converted Workspace");
            workspaces.push(json!({
                "id": id,
                "path": canonical_path,
                "name": name,
                "is_active": false,
                "linked_at": linked_at,
                "last_scanned": linked_at,
                "discovered": default_discovered(),
            }));
            workspaces.len() - 1
        });

        let mut activated = None;
        for (index, workspace) in workspaces.iter_mut().enumerate() {
            let workspace = workspace.as_object_mut().ok_or_else(|| {
                "stored linked_workspaces entries must be JSON objects".to_string()
            })?;
            let is_active = index == target_index;
            workspace.insert("is_active".into(), Value::Bool(is_active));
            if is_active {
                workspace.insert("path".into(), Value::String(canonical_path.clone()));
                let id = workspace
                    .get("id")
                    .and_then(Value::as_str)
                    .filter(|id| !id.is_empty())
                    .ok_or_else(|| "converted workspace entry is missing an id".to_string())?;
                activated = Some(linked_workspace_response(workspace, id));
            }
        }
        let activated =
            activated.ok_or_else(|| "converted workspace activation failed".to_string())?;
        before_final_validation();
        let store_content_sha256 = activation_guard.final_validate()?;
        after_final_validation();
        workspaces[target_index]
            .as_object_mut()
            .ok_or_else(|| "stored linked_workspaces entries must be JSON objects".to_string())?
            .insert(
                STORE_CONTENT_SHA256_FIELD.into(),
                Value::String(store_content_sha256),
            );
        self.save(&settings)?;
        Ok(activated)
    }

    /// Remove one linked workspace from the local catalogue.  No workspace
    /// files are deleted.  When the active entry is removed, preserve the
    /// legacy behaviour by selecting the first remaining workspace.
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

fn active_workspace_id(settings: &Value) -> Option<&str> {
    settings
        .get("linked_workspaces")
        .and_then(Value::as_array)
        .and_then(|workspaces| {
            workspaces.iter().find_map(|workspace| {
                workspace
                    .get("is_active")
                    .and_then(Value::as_bool)
                    .unwrap_or(false)
                    .then(|| workspace.get("id").and_then(Value::as_str))
                    .flatten()
            })
        })
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
    workspace: &Map<String, Value>,
) -> Result<LinkedWorkspaceAccess, String> {
    let path = workspace
        .get("path")
        .and_then(Value::as_str)
        .filter(|path| !path.trim().is_empty())
        .ok_or_else(|| "linked workspace is missing a path".to_string())?;
    let path = PathBuf::from(path);
    let store = if let Some(expected) = workspace
        .get(STORE_CONTENT_SHA256_FIELD)
        .and_then(Value::as_str)
    {
        Some(open_verified_persisted_store(&path, expected)?)
    } else if workspace.contains_key(STORE_CONTENT_SHA256_FIELD) {
        return Err("linked workspace has a malformed persisted store content identity".into());
    } else {
        None
    };
    Ok(LinkedWorkspaceAccess { path, store })
}

fn default_discovered() -> Value {
    json!({
        "runs_count": 0,
        "datasets_count": 0,
        "exports_count": 0,
        "templates_count": 0,
    })
}

fn paths_refer_to_same_location(stored_path: &str, candidate: &Path) -> bool {
    fs::canonicalize(stored_path).is_ok_and(|stored| stored == candidate)
}

fn converted_workspace_id(path: &str, linked_at: &str, workspaces: &[Value]) -> String {
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
        AppSettingsStore, Connection, DatasetLinkIdentity, BEFORE_LINKED_STORE_OPEN,
        MAX_DATASET_LINKS_BYTES, STORE_CONTENT_SHA256_FIELD,
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

    fn write_strict_v2_store(workspace: &Path) {
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

        assert!(store.dataset_links().unwrap().is_empty());
        for malformed in [
            b"not-json".as_slice(),
            br"[]".as_slice(),
            br#"{"datasets": null}"#.as_slice(),
            br#"{"datasets": [{"id": "valid"}, 7]}"#.as_slice(),
        ] {
            fs::write(&path, malformed).unwrap();
            assert!(store.dataset_links().unwrap().is_empty());
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
    fn converted_workspace_activation_is_atomic_and_keeps_the_source_for_rollback() {
        let directory = temporary_directory("converted-workspace-activation");
        let source = directory.join("legacy");
        let converted = directory.join("converted");
        fs::create_dir_all(&source).unwrap();
        fs::create_dir_all(&converted).unwrap();
        fs::write(source.join("store.duckdb"), b"immutable legacy source").unwrap();
        write_strict_v2_store(&converted);
        fs::write(
            directory.join("app_settings.json"),
            serde_json::to_string(&json!({
                "linked_workspaces": [{
                    "id": "workspace-legacy",
                    "path": source.canonicalize().unwrap(),
                    "name": "Legacy",
                    "is_active": true,
                    "linked_at": "2026-08-31T12:00:00Z",
                    "last_scanned": null,
                    "discovered": {},
                }],
            }))
            .unwrap(),
        )
        .unwrap();
        let store = AppSettingsStore::new(&directory);

        let activated = store
            .link_and_activate_workspace(&converted, "2026-09-02T12:00:00Z", "workspace-legacy")
            .unwrap();
        assert_eq!(
            activated["path"],
            converted.canonicalize().unwrap().to_string_lossy().as_ref()
        );
        assert_eq!(activated["is_active"], true);
        let catalogue = store.linked_workspaces_response().unwrap();
        assert_eq!(catalogue["total"], 2);
        assert_eq!(catalogue["workspaces"][0]["id"], "workspace-legacy");
        assert_eq!(catalogue["workspaces"][0]["is_active"], false);
        let converted_id = activated["id"].as_str().unwrap();
        assert_eq!(catalogue["active_workspace_id"], converted_id);
        assert_eq!(
            store
                .linked_workspace_access(converted_id)
                .unwrap()
                .map(|access| access.path),
            Some(converted.canonicalize().unwrap())
        );
        let persisted = store.load().unwrap();
        let content_identity = persisted["linked_workspaces"]
            .as_array()
            .unwrap()
            .iter()
            .find(|workspace| workspace["id"] == converted_id)
            .unwrap()[STORE_CONTENT_SHA256_FIELD]
            .as_str()
            .unwrap();
        assert_eq!(content_identity.len(), 64);

        assert!(store
            .activate_linked_workspace("workspace-legacy")
            .unwrap()
            .is_some());
        assert_eq!(
            store.linked_workspaces_response().unwrap()["active_workspace_id"],
            "workspace-legacy"
        );
        assert_eq!(
            fs::read(source.join("store.duckdb")).unwrap(),
            b"immutable legacy source"
        );
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn converted_workspace_activation_refuses_links_and_missing_verified_store() {
        let directory = temporary_directory("converted-workspace-refusal");
        let store = AppSettingsStore::new(&directory);
        let missing_store = directory.join("missing-store");
        fs::create_dir(&missing_store).unwrap();
        assert!(
            store
                .link_and_activate_workspace(
                    &missing_store,
                    "2026-09-02T12:00:00Z",
                    "workspace-legacy",
                )
                .unwrap_err()
                .contains("store.sqlite")
        );

        #[cfg(unix)]
        {
            use std::os::unix::fs::symlink;
            let real = directory.join("real");
            fs::create_dir(&real).unwrap();
            write_strict_v2_store(&real);
            let linked = directory.join("linked");
            symlink(&real, &linked).unwrap();
            assert!(store
                .link_and_activate_workspace(&linked, "2026-09-02T12:00:00Z", "workspace-legacy",)
                .unwrap_err()
                .contains("not a link"));

            let store_link_workspace = directory.join("store-link-workspace");
            fs::create_dir(&store_link_workspace).unwrap();
            symlink(
                real.join("store.sqlite"),
                store_link_workspace.join("store.sqlite"),
            )
            .unwrap();
            assert!(store
                .link_and_activate_workspace(
                    &store_link_workspace,
                    "2026-09-02T12:00:00Z",
                    "workspace-legacy",
                )
                .unwrap_err()
                .contains("store.sqlite must be a real file"));
        }
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn atomic_activation_guard_refuses_store_change_in_final_window() {
        let directory = temporary_directory("activation-final-window-store-change");
        let source = directory.join("legacy");
        let converted = directory.join("converted");
        fs::create_dir(&source).unwrap();
        fs::create_dir(&converted).unwrap();
        write_strict_v2_store(&converted);
        fs::write(
            directory.join("app_settings.json"),
            serde_json::to_vec(&json!({
                "linked_workspaces": [{
                    "id": "workspace-legacy",
                    "path": source.canonicalize().unwrap(),
                    "name": "Legacy",
                    "is_active": true
                }]
            }))
            .unwrap(),
        )
        .unwrap();
        let store = AppSettingsStore::new(&directory);
        let sqlite = converted.join("store.sqlite");
        let error = store
            .link_and_activate_workspace_with_hook(
                &converted,
                "2026-09-02T12:00:00Z",
                "workspace-legacy",
                || fs::write(&sqlite, b"replacement bytes").unwrap(),
            )
            .unwrap_err();
        assert!(error.contains("identity changed"));
        let catalogue = store.linked_workspaces_response().unwrap();
        assert_eq!(catalogue["active_workspace_id"], "workspace-legacy");
        assert_eq!(catalogue["total"], 1);
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn content_identity_blocks_substitution_after_final_validation_before_save() {
        let directory = temporary_directory("activation-post-validation-substitution");
        let source = directory.join("legacy");
        let converted = directory.join("converted");
        fs::create_dir(&source).unwrap();
        fs::create_dir(&converted).unwrap();
        write_strict_v2_store(&converted);
        fs::write(
            directory.join("app_settings.json"),
            serde_json::to_vec(&json!({
                "linked_workspaces": [{
                    "id": "workspace-legacy",
                    "path": source.canonicalize().unwrap(),
                    "name": "Legacy",
                    "is_active": true
                }]
            }))
            .unwrap(),
        )
        .unwrap();
        let settings = AppSettingsStore::new(&directory);
        let sqlite = converted.join("store.sqlite");
        let activated = settings
            .link_and_activate_workspace_with_hooks(
                &converted,
                "2026-09-02T12:00:00Z",
                "workspace-legacy",
                || {},
                || fs::write(&sqlite, b"substituted after final validation").unwrap(),
            )
            .unwrap();
        let converted_id = activated["id"].as_str().unwrap();

        assert!(settings.linked_workspace_access(converted_id).is_err());
        assert!(settings.active_linked_workspace_response().is_err());
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn authenticated_connection_rejects_substitution_in_exact_pre_open_window() {
        let directory = temporary_directory("linked-store-exact-open-window");
        let source = directory.join("legacy");
        let converted = directory.join("converted");
        fs::create_dir(&source).unwrap();
        fs::create_dir(&converted).unwrap();
        write_strict_v2_store(&converted);
        fs::write(
            directory.join("app_settings.json"),
            serde_json::to_vec(&json!({"linked_workspaces": [{
                "id": "workspace-legacy", "path": source.canonicalize().unwrap(),
                "name": "Legacy", "is_active": true
            }]}))
            .unwrap(),
        )
        .unwrap();
        let settings = AppSettingsStore::new(&directory);
        let activated = settings
            .link_and_activate_workspace(&converted, "2026-09-02T12:00:00Z", "workspace-legacy")
            .unwrap();
        let converted_id = activated["id"].as_str().unwrap().to_owned();
        let replacement_dir = directory.join("replacement");
        fs::create_dir(&replacement_dir).unwrap();
        write_strict_v2_store(&replacement_dir);
        let replacement = replacement_dir.join("store.sqlite");
        let connection = Connection::open(&replacement).unwrap();
        connection
            .execute(
                "INSERT INTO projects(project_id, name) VALUES ('substituted', 'Substituted')",
                [],
            )
            .unwrap();
        drop(connection);
        let active_store = converted.join("store.sqlite");
        let displaced = converted.join("store.original.sqlite");
        BEFORE_LINKED_STORE_OPEN.with(|hook| {
            *hook.borrow_mut() = Some(Box::new(move || {
                fs::rename(&active_store, &displaced).unwrap();
                fs::rename(&replacement, &active_store).unwrap();
            }));
        });

        let error = settings
            .linked_workspace_access(&converted_id)
            .err()
            .expect("substituted Store must never become consumable");
        assert!(error.contains("does not match its activated identity"));
        fs::remove_dir_all(directory).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn atomic_activation_guard_refuses_directory_replacement_in_final_window() {
        let directory = temporary_directory("activation-final-window-directory-swap");
        let source = directory.join("legacy");
        let converted = directory.join("converted");
        let displaced = directory.join("displaced");
        fs::create_dir(&source).unwrap();
        fs::create_dir(&converted).unwrap();
        write_strict_v2_store(&converted);
        fs::write(
            directory.join("app_settings.json"),
            serde_json::to_vec(&json!({
                "linked_workspaces": [{
                    "id": "workspace-legacy",
                    "path": source.canonicalize().unwrap(),
                    "name": "Legacy",
                    "is_active": true
                }]
            }))
            .unwrap(),
        )
        .unwrap();
        let store = AppSettingsStore::new(&directory);
        let error = store
            .link_and_activate_workspace_with_hook(
                &converted,
                "2026-09-02T12:00:00Z",
                "workspace-legacy",
                || {
                    fs::rename(&converted, &displaced).unwrap();
                    fs::create_dir(&converted).unwrap();
                    write_strict_v2_store(&converted);
                },
            )
            .unwrap_err();
        assert!(error.contains("identity changed"));
        let catalogue = store.linked_workspaces_response().unwrap();
        assert_eq!(catalogue["active_workspace_id"], "workspace-legacy");
        assert_eq!(catalogue["total"], 1);
        fs::remove_dir_all(directory).unwrap();
    }
}
