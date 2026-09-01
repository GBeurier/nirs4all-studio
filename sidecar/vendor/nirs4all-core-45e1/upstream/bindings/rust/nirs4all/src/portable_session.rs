//! Bounded native portable-pipeline sessions backed by libn4m `N4MM` models.

use std::fmt;
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use crate::{
    predict_exported_portable_model_with_library, run_portable_pipeline_with_exported_model,
    validate_exported_portable_model_with_library, PortableDataset, PortablePipelineResult,
};

pub const PORTABLE_SESSION_EXPORT_SCHEMA: &str = "nirs4all-core.portable-session-export.v1";
const MAX_EXPORT_BYTES: u64 = 64 * 1024 * 1024;
const MAX_TEMP_ATTEMPTS: u64 = 64;
static TEMP_SEQUENCE: AtomicU64 = AtomicU64::new(0);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PortableSessionState {
    Open,
    Closed,
}

#[derive(Debug)]
pub enum PortableSessionError {
    Io(std::io::Error),
    Format(String),
    Closed,
    AlreadyExists,
    PublishedWithCleanupError { path: PathBuf, detail: String },
    Run(String),
    Prediction(String),
}
impl fmt::Display for PortableSessionError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Io(e) => write!(f, "portable session I/O error: {e}"),
            Self::Format(e) => write!(f, "portable session format refusal: {e}"),
            Self::Closed => write!(f, "portable session is closed"),
            Self::AlreadyExists => write!(f, "portable session export target already exists"),
            Self::PublishedWithCleanupError { path, detail } => write!(
                f,
                "portable session export was published at {} but temporary cleanup failed: {detail}",
                path.display()
            ),
            Self::Run(e) => write!(f, "portable session run failed: {e}"),
            Self::Prediction(e) => write!(f, "portable session prediction failed: {e}"),
        }
    }
}
impl std::error::Error for PortableSessionError {}
impl From<std::io::Error> for PortableSessionError {
    fn from(e: std::io::Error) -> Self {
        Self::Io(e)
    }
}

/// A closeable selected-model session. Its export contains the exact validated
/// portable definition and an opaque libn4m `N4MM` selected-model payload.
#[derive(Debug, Clone, PartialEq)]
pub struct PortableSession {
    export: Value,
    library_path: PathBuf,
    state: PortableSessionState,
}

impl PortableSession {
    pub fn run_with_library(
        input: &str,
        dataset: &PortableDataset,
        library_path: impl AsRef<Path>,
    ) -> Result<Self, PortableSessionError> {
        let library_path = library_path.as_ref().to_path_buf();
        let (result, model_n4mm) =
            run_portable_pipeline_with_exported_model(input, dataset, &library_path)
                .map_err(PortableSessionError::Run)?;
        let definition =
            crate::load_pipeline_definition_str(input).map_err(PortableSessionError::Run)?;
        Ok(Self {
            export: export_from_result(definition, model_n4mm, result, dataset),
            library_path,
            state: PortableSessionState::Open,
        })
    }

    /// Load a persisted native session. The caller supplies the libn4m runtime;
    /// no Python or host fallback is ever attempted.
    pub fn load_with_library(
        path: impl AsRef<Path>,
        library_path: impl AsRef<Path>,
    ) -> Result<Self, PortableSessionError> {
        let path = path.as_ref();
        let file = File::open(path)?;
        let metadata = file.metadata()?;
        if !metadata.is_file() || metadata.len() > MAX_EXPORT_BYTES {
            return Err(PortableSessionError::Format(
                "session export must be a regular file no larger than 64 MiB".into(),
            ));
        }
        let mut bytes = Vec::with_capacity(metadata.len() as usize);
        file.take(MAX_EXPORT_BYTES + 1).read_to_end(&mut bytes)?;
        if bytes.len() as u64 > MAX_EXPORT_BYTES {
            return Err(PortableSessionError::Format(
                "session export exceeds 64 MiB".into(),
            ));
        }
        let export: Value = serde_json::from_slice(&bytes)
            .map_err(|e| PortableSessionError::Format(format!("invalid JSON: {e}")))?;
        validate_export(&export)?;
        let root = export.as_object().expect("validated export");
        let model = root["selected_model_n4mm"]
            .as_array()
            .expect("validated export")
            .iter()
            .map(|value| value.as_u64().expect("validated export") as u8)
            .collect::<Vec<_>>();
        let cols = root["result"]["cols"].as_u64().expect("validated export") as usize;
        validate_exported_portable_model_with_library(
            root["definition"].as_str().expect("validated export"),
            &model,
            cols,
            library_path.as_ref(),
        )
        .map_err(PortableSessionError::Format)?;
        Ok(Self {
            export,
            library_path: library_path.as_ref().to_path_buf(),
            state: PortableSessionState::Open,
        })
    }

    pub fn save(&self, path: impl AsRef<Path>) -> Result<(), PortableSessionError> {
        self.open()?;
        let path = path.as_ref();
        let bytes = serde_json::to_vec_pretty(&self.export)
            .map_err(|e| PortableSessionError::Format(e.to_string()))?;
        if bytes.len() as u64 > MAX_EXPORT_BYTES {
            return Err(PortableSessionError::Format(
                "serialized session export exceeds 64 MiB".into(),
            ));
        }
        atomic_create(path, &bytes)
    }
    pub fn close(&mut self) {
        self.state = PortableSessionState::Closed;
    }
    pub fn state(&self) -> PortableSessionState {
        self.state
    }
    pub fn export(&self) -> Result<&Value, PortableSessionError> {
        self.open()?;
        Ok(&self.export)
    }
    pub fn can_predict(&self) -> bool {
        self.state == PortableSessionState::Open
    }
    pub fn predict(
        &self,
        x: &[f64],
        rows: usize,
        cols: usize,
    ) -> Result<Vec<f64>, PortableSessionError> {
        self.open()?;
        let root = self.export.as_object().expect("validated export");
        let expected_cols = root["result"]["cols"].as_u64().expect("validated export") as usize;
        if cols != expected_cols {
            return Err(PortableSessionError::Prediction(format!(
                "prediction feature width {cols} does not match session width {expected_cols}"
            )));
        }
        let definition = root["definition"].as_str().expect("validated export");
        let model = root["selected_model_n4mm"]
            .as_array()
            .expect("validated export")
            .iter()
            .map(|v| v.as_u64().expect("validated export") as u8)
            .collect::<Vec<_>>();
        predict_exported_portable_model_with_library(
            definition,
            &model,
            x,
            rows,
            cols,
            &self.library_path,
        )
        .map_err(PortableSessionError::Prediction)
    }
    fn open(&self) -> Result<(), PortableSessionError> {
        if self.state == PortableSessionState::Open {
            Ok(())
        } else {
            Err(PortableSessionError::Closed)
        }
    }
}

fn atomic_create(path: &Path, bytes: &[u8]) -> Result<(), PortableSessionError> {
    let parent = path.parent().unwrap_or_else(|| Path::new("."));
    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| {
            PortableSessionError::Format("session export target must name a UTF-8 file".into())
        })?;
    for _ in 0..MAX_TEMP_ATTEMPTS {
        let nonce = TEMP_SEQUENCE.fetch_add(1, Ordering::Relaxed);
        let temporary = parent.join(format!(".{name}.tmp-{}-{nonce}", std::process::id()));
        let mut file = match OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)
        {
            Ok(file) => file,
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error.into()),
        };
        if let Err(error) = file.write_all(bytes).and_then(|()| file.sync_all()) {
            drop(file);
            let _ = fs::remove_file(&temporary);
            return Err(error.into());
        }
        drop(file);
        match fs::hard_link(&temporary, path) {
            Ok(()) => match fs::remove_file(&temporary) {
                Ok(()) => return Ok(()),
                Err(error) => {
                    return Err(PortableSessionError::PublishedWithCleanupError {
                        path: path.to_path_buf(),
                        detail: error.to_string(),
                    })
                }
            },
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                let _ = fs::remove_file(&temporary);
                return Err(PortableSessionError::AlreadyExists);
            }
            Err(error) => {
                let _ = fs::remove_file(&temporary);
                return Err(error.into());
            }
        }
    }
    Err(PortableSessionError::Io(std::io::Error::new(
        std::io::ErrorKind::AlreadyExists,
        "could not allocate a unique temporary session export path",
    )))
}

fn export_from_result(
    definition: Value,
    model: Vec<u8>,
    result: PortablePipelineResult,
    dataset: &PortableDataset,
) -> Value {
    let definition = serde_json::to_string(&definition).expect("JSON definition");
    json!({"schema": PORTABLE_SESSION_EXPORT_SCHEMA, "definition": definition, "definition_sha256": sha256(definition.as_bytes()), "dataset_sha256": dataset_sha256(dataset), "selected_model_n4mm": model, "result": {"name": result.name, "rows": result.rows, "cols": result.cols, "selected": {"n_components": result.selected.n_components, "rmse": result.selected.rmse, "predictions": result.selected.predictions}, "targets": result.targets}})
}
fn validate_export(export: &Value) -> Result<(), PortableSessionError> {
    let root = export
        .as_object()
        .ok_or_else(|| PortableSessionError::Format("export root must be an object".into()))?;
    if root.get("schema").and_then(Value::as_str) != Some(PORTABLE_SESSION_EXPORT_SCHEMA) {
        return Err(PortableSessionError::Format(
            "unsupported session schema".into(),
        ));
    }
    let definition = root
        .get("definition")
        .and_then(Value::as_str)
        .ok_or_else(|| PortableSessionError::Format("definition must be a string".into()))?;
    crate::load_pipeline_definition_str(definition).map_err(PortableSessionError::Format)?;
    crate::parse_execution_plan_str(definition).map_err(PortableSessionError::Format)?;
    if root.get("definition_sha256").and_then(Value::as_str)
        != Some(sha256(definition.as_bytes()).as_str())
    {
        return Err(PortableSessionError::Format(
            "definition_sha256 does not match definition".into(),
        ));
    }
    if root
        .get("dataset_sha256")
        .and_then(Value::as_str)
        .filter(|value| value.len() == 64)
        .is_none()
    {
        return Err(PortableSessionError::Format(
            "dataset_sha256 must be a SHA-256 string".into(),
        ));
    }
    let model = root
        .get("selected_model_n4mm")
        .and_then(Value::as_array)
        .ok_or_else(|| {
            PortableSessionError::Format("selected_model_n4mm must be a byte array".into())
        })?;
    if model.is_empty()
        || model.len() > MAX_EXPORT_BYTES as usize
        || model
            .iter()
            .any(|v| v.as_u64().filter(|n| *n <= 255).is_none())
    {
        return Err(PortableSessionError::Format(
            "selected_model_n4mm must be a bounded byte array".into(),
        ));
    }
    let result = root
        .get("result")
        .and_then(Value::as_object)
        .ok_or_else(|| PortableSessionError::Format("result must be an object".into()))?;
    for key in ["name", "rows", "cols", "selected", "targets"] {
        if !result.contains_key(key) {
            return Err(PortableSessionError::Format(format!(
                "result.{key} is required"
            )));
        }
    }
    if !result["name"].is_string()
        || result["rows"].as_u64().filter(|value| *value > 0).is_none()
        || result["cols"].as_u64().filter(|value| *value > 0).is_none()
        || !result["targets"].is_array()
    {
        return Err(PortableSessionError::Format(
            "result has invalid scalar fields".into(),
        ));
    }
    Ok(())
}

fn sha256(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn dataset_sha256(dataset: &PortableDataset) -> String {
    let mut hasher = Sha256::new();
    hasher.update((dataset.rows as u64).to_le_bytes());
    hasher.update((dataset.cols as u64).to_le_bytes());
    for value in dataset.x.iter().chain(&dataset.y) {
        hasher.update(value.to_bits().to_le_bytes());
    }
    format!("{:x}", hasher.finalize())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::sync::atomic::{AtomicU64, Ordering};
    static NEXT: AtomicU64 = AtomicU64::new(0);
    fn path() -> PathBuf {
        std::env::temp_dir().join(format!(
            "n4-session-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ))
    }
    #[test]
    fn native_run_save_load_and_predict_round_trip() {
        let Ok(lib) = std::env::var("NIRS4ALL_METHODS_LIB") else {
            return;
        };
        let oracle: Value = serde_json::from_str(include_str!(
            "../tests/parity/expected/portable_python_oracle.json"
        ))
        .unwrap();
        let dataset = PortableDataset::from_json_value(&oracle["dataset"]).unwrap();
        let input = include_str!("../tests/parity/fixtures/portable_methods_pipeline.json");
        let run = crate::run_portable_pipeline_with_library(input, &dataset, &lib).unwrap();
        let expected = run.selected.predictions;
        let mut x_test = Vec::new();
        for index in run.split.test_indices {
            x_test.extend_from_slice(&dataset.x[index * dataset.cols..(index + 1) * dataset.cols]);
        }
        let mut session = PortableSession::run_with_library(input, &dataset, &lib).unwrap();
        let p = path();
        session.save(&p).unwrap();
        session.close();
        let loaded = PortableSession::load_with_library(&p, &lib).unwrap();
        let actual = loaded
            .predict(&x_test, expected.len(), dataset.cols)
            .unwrap();
        assert_eq!(actual.len(), expected.len());
        assert!(actual
            .iter()
            .zip(expected)
            .all(|(actual, expected)| (actual - expected).abs() <= 1e-12));
        fs::remove_file(p).unwrap();
    }

    #[test]
    fn atomic_create_publishes_once_and_never_replaces() {
        let p = path();
        atomic_create(&p, b"first").unwrap();
        assert!(matches!(
            atomic_create(&p, b"second"),
            Err(PortableSessionError::AlreadyExists)
        ));
        assert_eq!(fs::read(&p).unwrap(), b"first");
        fs::remove_file(p).unwrap();
    }
}
