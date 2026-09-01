//! Bounded, immutable reader for Studio durable execution-job snapshots.

use std::{
    collections::BTreeSet,
    fs::{self, File},
    io::{Read, Write},
    path::Path,
    time::SystemTime,
};

use atomicwrites::{AllowOverwrite, AtomicFile};
use serde_json::{json, Map, Value};

pub const MAX_EXECUTION_JOB_RECORD_BYTES: u64 = 256 * 1024;
pub const EXECUTION_JOB_RECORD_CONTRACT: &str =
    include_str!("../contracts/studio_execution_job_record_v1.json");

const FIELDS: [&str; 16] = [
    "job_id",
    "job_type",
    "requested_backend",
    "execution_backend",
    "execution_mode",
    "status",
    "progress",
    "progress_message",
    "progress_unavailable",
    "created_at",
    "started_at",
    "completed_at",
    "request",
    "driver",
    "metrics",
    "error",
];

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum DurableExecutionJobRecordRoute {
    ByJobId,
    ByRunId,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MatchedDurableExecutionJobRecordRoute {
    pub route: DurableExecutionJobRecordRoute,
    pub id: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ExecutionJobRecordReadError {
    WorkspaceUnavailable,
    InvalidIdentifier,
    Missing,
    SymlinkOrEscape,
    TooLarge,
    ChangedDuringRead,
    Read,
    InvalidJson,
    InvalidShape,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ExecutionJobRecordWriteError {
    WorkspaceUnavailable,
    InvalidIdentifier,
    SymlinkOrEscape,
    TargetAlreadyExists,
    TooLarge,
    InvalidShape,
    Write,
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct FileStamp {
    len: u64,
    modified: Option<SystemTime>,
}

#[must_use]
pub fn match_durable_execution_job_record_route(
    path: &str,
) -> Option<MatchedDurableExecutionJobRecordRoute> {
    if let Some(id) = single_segment(path, "/api/runs/execution-job-records/", "") {
        return valid_identifier(id).then(|| MatchedDurableExecutionJobRecordRoute {
            route: DurableExecutionJobRecordRoute::ByJobId,
            id: id.into(),
        });
    }
    let id = single_segment(path, "/api/runs/", "/execution-job-record")?;
    valid_identifier(id).then(|| MatchedDurableExecutionJobRecordRoute {
        route: DurableExecutionJobRecordRoute::ByRunId,
        id: id.into(),
    })
}

/// Load and normalize one durable record without mutating the workspace.
///
/// # Errors
///
/// Returns a typed refusal for unsafe paths, oversized or changing files, and
/// every shape that differs from the frozen Studio record contract.
pub fn read_execution_job_record(
    workspace_path: &Path,
    job_id: &str,
) -> Result<Value, ExecutionJobRecordReadError> {
    validate_contract()?;
    if !valid_identifier(job_id) {
        return Err(ExecutionJobRecordReadError::InvalidIdentifier);
    }
    let workspace = workspace_path
        .canonicalize()
        .map_err(|_| ExecutionJobRecordReadError::WorkspaceUnavailable)?;
    if !workspace.is_dir() {
        return Err(ExecutionJobRecordReadError::WorkspaceUnavailable);
    }
    let runs = workspace.join("runs");
    let job_directory = runs.join(job_id);
    for directory in [&runs, &job_directory] {
        let metadata = fs::symlink_metadata(directory).map_err(|error| {
            if error.kind() == std::io::ErrorKind::NotFound {
                ExecutionJobRecordReadError::Missing
            } else {
                ExecutionJobRecordReadError::Read
            }
        })?;
        if metadata.file_type().is_symlink() || !metadata.is_dir() {
            return Err(ExecutionJobRecordReadError::SymlinkOrEscape);
        }
    }
    let path = job_directory.join("execution_job_record.json");
    let link_metadata = fs::symlink_metadata(&path).map_err(|error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            ExecutionJobRecordReadError::Missing
        } else {
            ExecutionJobRecordReadError::Read
        }
    })?;
    if link_metadata.file_type().is_symlink() || !link_metadata.is_file() {
        return Err(ExecutionJobRecordReadError::SymlinkOrEscape);
    }
    let canonical = path
        .canonicalize()
        .map_err(|_| ExecutionJobRecordReadError::Read)?;
    if !canonical.starts_with(&workspace) {
        return Err(ExecutionJobRecordReadError::SymlinkOrEscape);
    }
    let before = file_stamp(&canonical)?;
    if before.len > MAX_EXECUTION_JOB_RECORD_BYTES {
        return Err(ExecutionJobRecordReadError::TooLarge);
    }
    let mut file = File::open(&canonical).map_err(|_| ExecutionJobRecordReadError::Read)?;
    let capacity =
        usize::try_from(before.len).map_err(|_| ExecutionJobRecordReadError::TooLarge)?;
    let mut bytes = Vec::with_capacity(capacity);
    Read::by_ref(&mut file)
        .take(MAX_EXECUTION_JOB_RECORD_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| ExecutionJobRecordReadError::Read)?;
    if bytes.len() as u64 > MAX_EXECUTION_JOB_RECORD_BYTES {
        return Err(ExecutionJobRecordReadError::TooLarge);
    }
    if file_stamp(&canonical)? != before {
        return Err(ExecutionJobRecordReadError::ChangedDuringRead);
    }
    let payload: Value =
        serde_json::from_slice(&bytes).map_err(|_| ExecutionJobRecordReadError::InvalidJson)?;
    normalize_record(&payload, job_id)
}

/// Validate a future durable-record target without creating a directory or
/// file. This is the workspace preflight required before an executor is called.
///
/// # Errors
///
/// Rejects missing/non-directory workspace roots and runs directories,
/// symlinks, escapes, malformed identifiers, and an already occupied job path.
pub fn preflight_execution_job_record_write(
    workspace_path: &Path,
    job_id: &str,
) -> Result<std::path::PathBuf, ExecutionJobRecordWriteError> {
    let workspace = safe_workspace_for_write(workspace_path)?;
    if !valid_identifier(job_id) {
        return Err(ExecutionJobRecordWriteError::InvalidIdentifier);
    }
    let runs = workspace.join("runs");
    safe_existing_directory(&runs, &workspace)?;
    let job_directory = runs.join(job_id);
    match fs::symlink_metadata(&job_directory) {
        Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_dir() => {
            Err(ExecutionJobRecordWriteError::SymlinkOrEscape)
        }
        Ok(_) => Err(ExecutionJobRecordWriteError::TargetAlreadyExists),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(workspace),
        Err(_) => Err(ExecutionJobRecordWriteError::Write),
    }
}

/// Atomically persist one normalized execution record.
///
/// The workspace must be preflighted. Existing regular snapshots may be
/// replaced for later lifecycle transitions; symlinks and workspace escapes
/// are always rejected.
///
/// # Errors
///
/// Refuses unsafe paths, incompatible record shapes, oversized serialized
/// payloads, and every filesystem failure.
pub fn write_execution_job_record(
    workspace_path: &Path,
    job_id: &str,
    record: &Value,
) -> Result<(), ExecutionJobRecordWriteError> {
    validate_contract().map_err(|_| ExecutionJobRecordWriteError::InvalidShape)?;
    let workspace = safe_workspace_for_write(workspace_path)?;
    if !valid_identifier(job_id) {
        return Err(ExecutionJobRecordWriteError::InvalidIdentifier);
    }
    normalize_record(record, job_id).map_err(|_| ExecutionJobRecordWriteError::InvalidShape)?;
    let runs = workspace.join("runs");
    safe_existing_directory(&runs, &workspace)?;
    let job_directory = runs.join(job_id);
    match fs::symlink_metadata(&job_directory) {
        Ok(metadata) => {
            if metadata.file_type().is_symlink() || !metadata.is_dir() {
                return Err(ExecutionJobRecordWriteError::SymlinkOrEscape);
            }
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            fs::create_dir(&job_directory).map_err(|_| ExecutionJobRecordWriteError::Write)?;
        }
        Err(_) => return Err(ExecutionJobRecordWriteError::Write),
    }
    safe_existing_directory(&job_directory, &workspace)?;
    let path = job_directory.join("execution_job_record.json");
    if let Ok(metadata) = fs::symlink_metadata(&path) {
        if metadata.file_type().is_symlink() || !metadata.is_file() {
            return Err(ExecutionJobRecordWriteError::SymlinkOrEscape);
        }
        let canonical = path
            .canonicalize()
            .map_err(|_| ExecutionJobRecordWriteError::Write)?;
        if !canonical.starts_with(&workspace) {
            return Err(ExecutionJobRecordWriteError::SymlinkOrEscape);
        }
    }
    let mut encoded =
        serde_json::to_vec(record).map_err(|_| ExecutionJobRecordWriteError::InvalidShape)?;
    encoded.push(b'\n');
    if encoded.len() as u64 > MAX_EXECUTION_JOB_RECORD_BYTES {
        return Err(ExecutionJobRecordWriteError::TooLarge);
    }
    AtomicFile::new(&path, AllowOverwrite)
        .write(|file| file.write_all(&encoded).and_then(|()| file.sync_all()))
        .map_err(|_| ExecutionJobRecordWriteError::Write)
}

fn safe_workspace_for_write(
    workspace_path: &Path,
) -> Result<std::path::PathBuf, ExecutionJobRecordWriteError> {
    let metadata = fs::symlink_metadata(workspace_path)
        .map_err(|_| ExecutionJobRecordWriteError::WorkspaceUnavailable)?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(ExecutionJobRecordWriteError::SymlinkOrEscape);
    }
    workspace_path
        .canonicalize()
        .map_err(|_| ExecutionJobRecordWriteError::WorkspaceUnavailable)
}

fn safe_existing_directory(
    directory: &Path,
    workspace: &Path,
) -> Result<(), ExecutionJobRecordWriteError> {
    let metadata = fs::symlink_metadata(directory).map_err(|error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            ExecutionJobRecordWriteError::WorkspaceUnavailable
        } else {
            ExecutionJobRecordWriteError::Write
        }
    })?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(ExecutionJobRecordWriteError::SymlinkOrEscape);
    }
    let canonical = directory
        .canonicalize()
        .map_err(|_| ExecutionJobRecordWriteError::Write)?;
    if !canonical.starts_with(workspace) {
        return Err(ExecutionJobRecordWriteError::SymlinkOrEscape);
    }
    Ok(())
}

#[must_use]
pub fn compose_execution_job_record_response(record: &Value, run: Option<&Value>) -> Value {
    let mut response = record.as_object().cloned().unwrap_or_default();
    if let Some(run) = run {
        response.insert(
            "run_id".into(),
            run.get("run_id")
                .or_else(|| run.get("id"))
                .cloned()
                .unwrap_or(Value::Null),
        );
        response.insert(
            "run_name".into(),
            run.get("name").cloned().unwrap_or(Value::Null),
        );
        response.insert(
            "run_status".into(),
            run.get("status").cloned().unwrap_or(Value::Null),
        );
        response.insert("is_orphaned".into(), Value::Bool(false));
    } else {
        let job_id = record.get("job_id").cloned().unwrap_or(Value::Null);
        let run_name = record
            .pointer("/request/run_name")
            .filter(|value| value.is_string())
            .cloned()
            .unwrap_or_else(|| job_id.clone());
        response.insert("run_id".into(), job_id);
        response.insert("run_name".into(), run_name);
        response.insert("run_status".into(), Value::String("orphaned".into()));
        response.insert("is_orphaned".into(), Value::Bool(true));
    }
    Value::Object(response)
}

fn normalize_record(
    payload: &Value,
    requested_job_id: &str,
) -> Result<Value, ExecutionJobRecordReadError> {
    let mut object = payload
        .as_object()
        .cloned()
        .ok_or(ExecutionJobRecordReadError::InvalidShape)?;
    let allowed = FIELDS.into_iter().collect::<BTreeSet<_>>();
    if object.keys().any(|key| !allowed.contains(key.as_str())) {
        return Err(ExecutionJobRecordReadError::InvalidShape);
    }
    for key in [
        "job_id",
        "job_type",
        "requested_backend",
        "execution_backend",
        "status",
        "created_at",
    ] {
        required_string(&object, key)?;
    }
    if object.get("job_id").and_then(Value::as_str) != Some(requested_job_id) {
        return Err(ExecutionJobRecordReadError::InvalidShape);
    }
    for key in ["execution_mode", "started_at", "completed_at", "error"] {
        nullable_string(&object, key)?;
        object.entry(key).or_insert(Value::Null);
    }
    let progress_missing = object.get("progress").is_none_or(Value::is_null);
    let message_missing = object.get("progress_message").is_none_or(Value::is_null);
    if progress_missing {
        let fallback = if object.get("status").and_then(Value::as_str) == Some("completed") {
            100.0
        } else {
            0.0
        };
        object.insert("progress".into(), json!(fallback));
    } else if !object
        .get("progress")
        .and_then(Value::as_f64)
        .is_some_and(f64::is_finite)
    {
        return Err(ExecutionJobRecordReadError::InvalidShape);
    }
    if message_missing {
        object.insert(
            "progress_message".into(),
            Value::String("Progress unavailable".into()),
        );
    } else if !object.get("progress_message").is_some_and(Value::is_string) {
        return Err(ExecutionJobRecordReadError::InvalidShape);
    }
    let explicit_unavailable = match object.get("progress_unavailable") {
        Some(Value::Bool(value)) => *value,
        Some(_) => return Err(ExecutionJobRecordReadError::InvalidShape),
        None => false,
    };
    object.insert(
        "progress_unavailable".into(),
        Value::Bool(explicit_unavailable || progress_missing || message_missing),
    );
    for key in ["request", "driver", "metrics"] {
        match object.get(key) {
            Some(Value::Object(_)) => {}
            Some(_) => return Err(ExecutionJobRecordReadError::InvalidShape),
            None => {
                object.insert(key.into(), Value::Object(Map::new()));
            }
        }
    }
    Ok(Value::Object(object))
}

fn required_string(
    object: &Map<String, Value>,
    key: &str,
) -> Result<(), ExecutionJobRecordReadError> {
    object
        .get(key)
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .map(|_| ())
        .ok_or(ExecutionJobRecordReadError::InvalidShape)
}

fn nullable_string(
    object: &Map<String, Value>,
    key: &str,
) -> Result<(), ExecutionJobRecordReadError> {
    match object.get(key) {
        None | Some(Value::Null | Value::String(_)) => Ok(()),
        Some(_) => Err(ExecutionJobRecordReadError::InvalidShape),
    }
}

fn file_stamp(path: &Path) -> Result<FileStamp, ExecutionJobRecordReadError> {
    let metadata = path
        .metadata()
        .map_err(|_| ExecutionJobRecordReadError::Read)?;
    Ok(FileStamp {
        len: metadata.len(),
        modified: metadata.modified().ok(),
    })
}

fn validate_contract() -> Result<(), ExecutionJobRecordReadError> {
    let contract: Value = serde_json::from_str(EXECUTION_JOB_RECORD_CONTRACT)
        .map_err(|_| ExecutionJobRecordReadError::InvalidShape)?;
    if contract.get("schema_id").and_then(Value::as_str)
        != Some("nirs4all.studio-execution-job-record.v1")
        || contract.get("schema_version").and_then(Value::as_u64) != Some(1)
        || contract
            .pointer("/snapshot/maximum_bytes")
            .and_then(Value::as_u64)
            != Some(MAX_EXECUTION_JOB_RECORD_BYTES)
        || contract
            .pointer("/ownership/fallback_after_native_selection")
            .and_then(Value::as_str)
            != Some("none")
    {
        return Err(ExecutionJobRecordReadError::InvalidShape);
    }
    Ok(())
}

fn single_segment<'a>(path: &'a str, prefix: &str, suffix: &str) -> Option<&'a str> {
    let value = path.strip_prefix(prefix)?.strip_suffix(suffix)?;
    (!value.is_empty() && !value.contains('/')).then_some(value)
}

fn valid_identifier(value: &str) -> bool {
    !value.is_empty()
        && !matches!(value, "." | "..")
        && value.len() <= 256
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
}

#[cfg(test)]
mod tests {
    use std::{fs, path::PathBuf, time::SystemTime};

    use serde_json::json;

    use super::*;

    fn workspace() -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "studio-execution-job-record-{}-{nonce}",
            std::process::id()
        ));
        fs::create_dir_all(&path).unwrap();
        path
    }

    fn write_record(root: &Path, id: &str, payload: &Value) -> PathBuf {
        let directory = root.join("runs").join(id);
        fs::create_dir_all(&directory).unwrap();
        let path = directory.join("execution_job_record.json");
        fs::write(&path, serde_json::to_vec(payload).unwrap()).unwrap();
        path
    }

    fn record(id: &str) -> Value {
        json!({
            "job_id": id,
            "job_type": "training",
            "requested_backend": "native",
            "execution_backend": "native",
            "execution_mode": "embedded-cpython",
            "status": "running",
            "progress": 25.0,
            "progress_message": "training",
            "created_at": "2026-09-01T12:00:00Z",
            "request": {"run_name": "Native run"},
            "driver": {"backend": "native"},
            "metrics": {}
        })
    }

    #[test]
    fn matches_only_the_two_bare_durable_routes() {
        assert_eq!(
            match_durable_execution_job_record_route("/api/runs/execution-job-records/job-1"),
            Some(MatchedDurableExecutionJobRecordRoute {
                route: DurableExecutionJobRecordRoute::ByJobId,
                id: "job-1".into(),
            })
        );
        assert_eq!(
            match_durable_execution_job_record_route("/api/runs/run-1/execution-job-record"),
            Some(MatchedDurableExecutionJobRecordRoute {
                route: DurableExecutionJobRecordRoute::ByRunId,
                id: "run-1".into(),
            })
        );
        for path in [
            "/api/runs/execution-job-records",
            "/api/runs/execution-job-records/job-1/cancel",
            "/api/runs/run/extra/execution-job-record",
            "/api/runs/../execution-job-record",
        ] {
            assert_eq!(match_durable_execution_job_record_route(path), None);
        }
    }

    #[test]
    fn reads_normalizes_and_composes_known_or_orphaned_records() {
        let root = workspace();
        write_record(&root, "job-1", &record("job-1"));
        let actual = read_execution_job_record(&root, "job-1").unwrap();
        assert_eq!(actual["progress_unavailable"], false);
        assert_eq!(actual["started_at"], Value::Null);
        assert_eq!(
            compose_execution_job_record_response(&actual, None)["run_name"],
            "Native run"
        );
        let known = compose_execution_job_record_response(
            &actual,
            Some(&json!({"run_id": "job-1", "name": "Store run", "status": "running"})),
        );
        assert_eq!(known["run_name"], "Store run");
        assert_eq!(known["is_orphaned"], false);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn applies_legacy_progress_fallbacks_and_refuses_unsafe_shapes() {
        let root = workspace();
        let mut partial = record("job-1");
        partial.as_object_mut().unwrap().remove("progress");
        partial.as_object_mut().unwrap().remove("progress_message");
        write_record(&root, "job-1", &partial);
        let normalized = read_execution_job_record(&root, "job-1").unwrap();
        assert_eq!(normalized["progress"], 0.0);
        assert_eq!(normalized["progress_message"], "Progress unavailable");
        assert_eq!(normalized["progress_unavailable"], true);

        let mut mismatch = record("other");
        mismatch["unknown"] = json!(true);
        write_record(&root, "job-1", &mismatch);
        assert_eq!(
            read_execution_job_record(&root, "job-1"),
            Err(ExecutionJobRecordReadError::InvalidShape)
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn atomically_writes_a_reader_compatible_record() {
        let root = workspace();
        fs::create_dir(root.join("runs")).unwrap();
        assert_eq!(
            preflight_execution_job_record_write(&root, "job-1").unwrap(),
            root.canonicalize().unwrap()
        );
        let expected = record("job-1");
        write_execution_job_record(&root, "job-1", &expected).unwrap();
        let actual = read_execution_job_record(&root, "job-1").unwrap();
        assert_eq!(actual["job_id"], "job-1");
        assert_eq!(actual["status"], "running");
        assert_eq!(fs::read_dir(root.join("runs/job-1")).unwrap().count(), 1);
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn durable_writer_refuses_symlinked_directories_and_snapshots() {
        use std::os::unix::fs::symlink;

        let root = workspace();
        fs::create_dir(root.join("runs")).unwrap();
        let outside_directory = root.with_extension("outside-directory");
        fs::create_dir_all(&outside_directory).unwrap();
        symlink(&outside_directory, root.join("runs/job-1")).unwrap();
        assert_eq!(
            preflight_execution_job_record_write(&root, "job-1"),
            Err(ExecutionJobRecordWriteError::SymlinkOrEscape)
        );
        fs::remove_file(root.join("runs/job-1")).unwrap();

        fs::create_dir(root.join("runs/job-1")).unwrap();
        let outside_file = root.with_extension("outside-record.json");
        fs::write(&outside_file, b"outside must not change").unwrap();
        symlink(
            &outside_file,
            root.join("runs/job-1/execution_job_record.json"),
        )
        .unwrap();
        assert_eq!(
            write_execution_job_record(&root, "job-1", &record("job-1")),
            Err(ExecutionJobRecordWriteError::SymlinkOrEscape)
        );
        assert_eq!(fs::read(&outside_file).unwrap(), b"outside must not change");
        fs::remove_dir_all(root).unwrap();
        fs::remove_dir_all(outside_directory).unwrap();
        fs::remove_file(outside_file).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn refuses_symlinked_snapshots_and_oversized_files() {
        use std::os::unix::fs::symlink;

        let root = workspace();
        let outside = root.with_extension("outside.json");
        fs::write(&outside, serde_json::to_vec(&record("job-1")).unwrap()).unwrap();
        let path = root
            .join("runs")
            .join("job-1")
            .join("execution_job_record.json");
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        symlink(&outside, &path).unwrap();
        assert_eq!(
            read_execution_job_record(&root, "job-1"),
            Err(ExecutionJobRecordReadError::SymlinkOrEscape)
        );
        fs::remove_file(&path).unwrap();
        fs::write(
            &path,
            vec![b' '; usize::try_from(MAX_EXECUTION_JOB_RECORD_BYTES).unwrap() + 1],
        )
        .unwrap();
        assert_eq!(
            read_execution_job_record(&root, "job-1"),
            Err(ExecutionJobRecordReadError::TooLarge)
        );
        fs::remove_dir_all(root).unwrap();
        fs::remove_file(outside).unwrap();
    }
}
