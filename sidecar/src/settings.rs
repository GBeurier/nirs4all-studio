//! Persistent Studio application settings owned by the native sidecar.
//!
//! The store deliberately preserves the existing `app_settings.json` shape so
//! a desktop upgrade can move these routes to Rust without requiring a data
//! migration or a Python process.  Workspace and dataset state are out of
//! scope here; this module owns only UI preferences and favourite pipelines.

use std::{
    env,
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    process,
    time::{SystemTime, UNIX_EPOCH},
};

use atomicwrites::replace_atomic;
use serde_json::{json, Map, Value};

const APP_SETTINGS_FILE: &str = "app_settings.json";
const CONFIG_ENV: &str = "NIRS4ALL_CONFIG";
const PORTABLE_ROOT_ENV: &str = "NIRS4ALL_PORTABLE_ROOT";
const PORTABLE_EXE_ENV: &str = "NIRS4ALL_PORTABLE_EXE";
const CONFIG_REDIRECT_FILE: &str = "config_redirect.txt";

#[derive(Debug)]
pub struct AppSettingsStore {
    config_dir: PathBuf,
}

impl AppSettingsStore {
    #[must_use]
    pub fn from_environment() -> Self {
        Self::new(resolve_config_dir())
    }

    #[must_use]
    pub fn new(config_dir: impl Into<PathBuf>) -> Self {
        Self {
            config_dir: config_dir.into(),
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

    use serde_json::json;

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
}
