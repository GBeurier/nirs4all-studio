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
    io::Write,
    path::{Path, PathBuf},
    process,
    time::{SystemTime, UNIX_EPOCH},
};

use atomicwrites::{replace_atomic, AllowOverwrite, AtomicFile};
use serde_json::{json, Map, Value};

const APP_SETTINGS_FILE: &str = "app_settings.json";
const CONFIG_ENV: &str = "NIRS4ALL_CONFIG";
const PORTABLE_ROOT_ENV: &str = "NIRS4ALL_PORTABLE_ROOT";
const PORTABLE_EXE_ENV: &str = "NIRS4ALL_PORTABLE_EXE";
const CONFIG_REDIRECT_FILE: &str = "config_redirect.txt";

#[derive(Debug)]
pub struct AppSettingsStore {
    config_dir: PathBuf,
    default_config_dir: PathBuf,
}

#[derive(Debug)]
pub enum ConfigPathError {
    DoesNotExist(String),
    NotDirectory(String),
    Storage(String),
}

impl AppSettingsStore {
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

    pub fn update_ui_preferences(&self, updates: &Value) -> Result<(), String> {
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

    /// Mark a persisted linked workspace as active without loading its data or
    /// invoking a Python workspace manager.  This is intentionally limited to
    /// catalogue state; scanning and scientific-store access stay outside this
    /// settings store until their native contracts are available.
    pub fn activate_linked_workspace(&self, workspace_id: &str) -> Result<Option<Value>, String> {
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

    /// Remove one linked workspace from the local catalogue.  No workspace
    /// files are deleted.  When the active entry is removed, preserve the
    /// legacy behaviour by selecting the first remaining workspace.
    pub fn unlink_linked_workspace(&self, workspace_id: &str) -> Result<bool, String> {
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
        fs::create_dir_all(&self.config_dir).map_err(|error| {
            format!(
                "could not create settings directory {}: {error}",
                self.config_dir.display()
            )
        })?;
        let path = self.config_dir.join(APP_SETTINGS_FILE);
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let temporary = self.config_dir.join(format!(
            ".{APP_SETTINGS_FILE}.{}-{nonce}.tmp",
            process::id()
        ));
        let encoded = serde_json::to_vec_pretty(settings)
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

fn default_discovered() -> Value {
    json!({
        "runs_count": 0,
        "datasets_count": 0,
        "exports_count": 0,
        "templates_count": 0,
    })
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
        path::PathBuf,
        time::{SystemTime, UNIX_EPOCH},
    };

    use serde_json::{json, Value};

    use super::AppSettingsStore;

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
}
