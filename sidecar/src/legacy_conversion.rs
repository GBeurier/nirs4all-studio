//! Rust-owned Studio adapter for the offline legacy-workspace converter.
//!
//! Detection, HTTP validation, exit-code policy, and workspace activation are
//! owned by the sidecar.  The only Python boundary is one bounded stdio
//! invocation of the separately shipped `nirs4all-tools` converter.  It never
//! starts or contacts a Python HTTP server and it never converts in place.

use std::{
    collections::BTreeSet,
    fmt::Debug,
    io::Read,
    path::{Component, Path, PathBuf},
    process::{ChildStderr, ChildStdout, Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::{Duration, Instant},
};

use rusqlite::{Connection, OpenFlags};
use serde_json::Value;

pub const LEGACY_TRANSITION_STATUS_ROUTE: &str = "/api/workspace/transition-status";
pub const LEGACY_CONVERSION_ROUTE: &str = "/api/workspace/legacy-convert";
pub const LEGACY_CONVERSION_TIMEOUT: Duration = Duration::from_secs(30 * 60);
pub const MAX_CONVERTER_STDOUT_BYTES: usize = 256 * 1024;
pub const MAX_CONVERTER_STDERR_BYTES: usize = 256 * 1024;
const MAX_WORKSPACE_PATH_BYTES: usize = 4096;
const MAX_RUN_TREE_ENTRIES: usize = 4096;
const REQUEST_FIELDS: [&str; 5] = [
    "dry_run",
    "link_converted_workspace",
    "output_path",
    "strict",
    "verify",
];

#[derive(Clone, Debug, Eq, PartialEq)]
#[expect(
    clippy::struct_excessive_bools,
    reason = "the fields are the frozen renderer request contract, not internal state"
)]
pub struct LegacyConversionRequest {
    pub workspace_path: PathBuf,
    pub output_path: PathBuf,
    pub verify: bool,
    pub dry_run: bool,
    pub strict: bool,
    pub link_converted_workspace: bool,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LegacyConversionProcessOutput {
    pub return_code: i32,
    pub stdout: String,
    pub stderr: String,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum LegacyConversionFailure {
    Busy,
    SpawnFailed,
    TimedOut,
    ProcessFailed,
    OutputReadFailed,
    StdoutTooLarge,
    StderrTooLarge,
    InvalidUtf8,
}

impl LegacyConversionFailure {
    #[must_use]
    pub const fn reason(self) -> &'static str {
        match self {
            Self::Busy => "legacy_conversion_already_running",
            Self::SpawnFailed => "legacy_converter_spawn_failed",
            Self::TimedOut => "legacy_converter_timeout",
            Self::ProcessFailed => "legacy_converter_process_failed",
            Self::OutputReadFailed => "legacy_converter_output_failed",
            Self::StdoutTooLarge => "legacy_converter_stdout_too_large",
            Self::StderrTooLarge => "legacy_converter_stderr_too_large",
            Self::InvalidUtf8 => "legacy_converter_invalid_utf8",
        }
    }
}

pub trait LegacyConverter: Debug + Send + Sync {
    fn is_available(&self) -> bool;
    fn command(&self, request: &LegacyConversionRequest) -> Vec<String>;

    /// Execute one already validated offline migration request.
    ///
    /// # Errors
    ///
    /// Returns only the closed process-boundary failures declared above.
    fn run(
        &self,
        request: &LegacyConversionRequest,
    ) -> Result<LegacyConversionProcessOutput, LegacyConversionFailure>;
}

#[derive(Debug)]
struct UnselectedLegacyConverter;

impl LegacyConverter for UnselectedLegacyConverter {
    fn is_available(&self) -> bool {
        false
    }

    fn command(&self, request: &LegacyConversionRequest) -> Vec<String> {
        let mut command = vec!["nirs4all-tools".into()];
        command.extend(converter_arguments(request));
        command
    }

    fn run(
        &self,
        _request: &LegacyConversionRequest,
    ) -> Result<LegacyConversionProcessOutput, LegacyConversionFailure> {
        Err(LegacyConversionFailure::SpawnFailed)
    }
}

#[derive(Debug)]
struct PythonModuleLegacyConverter {
    python_plugin_host: PathBuf,
}

impl LegacyConverter for PythonModuleLegacyConverter {
    fn is_available(&self) -> bool {
        self.python_plugin_host.is_file()
    }

    fn command(&self, request: &LegacyConversionRequest) -> Vec<String> {
        build_python_module_command(&self.python_plugin_host, request)
    }

    fn run(
        &self,
        request: &LegacyConversionRequest,
    ) -> Result<LegacyConversionProcessOutput, LegacyConversionFailure> {
        run_bounded_command(
            &self.python_plugin_host,
            &self.command(request)[1..],
            LEGACY_CONVERSION_TIMEOUT,
        )
    }
}

/// Shared one-at-a-time converter boundary used by all HTTP connections.
#[derive(Clone, Debug)]
pub struct LegacyConversionRuntime {
    converter: Arc<dyn LegacyConverter>,
    running: Arc<AtomicBool>,
}

impl Default for LegacyConversionRuntime {
    fn default() -> Self {
        Self {
            converter: Arc::new(UnselectedLegacyConverter),
            running: Arc::new(AtomicBool::new(false)),
        }
    }
}

impl LegacyConversionRuntime {
    #[must_use]
    pub fn from_python_plugin_host(python_plugin_host: Option<PathBuf>) -> Self {
        python_plugin_host.map_or_else(Self::default, |python_plugin_host| Self {
            converter: Arc::new(PythonModuleLegacyConverter { python_plugin_host }),
            running: Arc::new(AtomicBool::new(false)),
        })
    }

    #[must_use]
    pub fn with_converter(converter: Arc<dyn LegacyConverter>) -> Self {
        Self {
            converter,
            running: Arc::new(AtomicBool::new(false)),
        }
    }

    #[must_use]
    pub fn is_available(&self) -> bool {
        self.converter.is_available()
    }

    #[must_use]
    pub fn command(&self, request: &LegacyConversionRequest) -> Vec<String> {
        self.converter.command(request)
    }

    /// Run one converter process while refusing concurrent conversions.
    ///
    /// # Errors
    ///
    /// Returns a closed process-boundary failure or `Busy` when another
    /// conversion already owns the singleton converter slot.
    pub fn run(
        &self,
        request: &LegacyConversionRequest,
    ) -> Result<LegacyConversionProcessOutput, LegacyConversionFailure> {
        if self
            .running
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Relaxed)
            .is_err()
        {
            return Err(LegacyConversionFailure::Busy);
        }
        let _permit = ConversionPermit(&self.running);
        self.converter.run(request)
    }
}

struct ConversionPermit<'a>(&'a AtomicBool);

impl Drop for ConversionPermit<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct WorkspaceTransitionStatus {
    pub path: PathBuf,
    pub format: &'static str,
    pub conversion_required: bool,
    pub message: &'static str,
    pub default_output_path: Option<PathBuf>,
}

/// Inspect only the bounded workspace markers needed by Studio's transition
/// card.  Deep parsing remains exclusively owned by `nirs4all-tools`.
///
/// # Errors
///
/// Returns an error when the active workspace cannot be inspected safely.
pub fn inspect_workspace_transition(
    workspace_path: &Path,
) -> Result<WorkspaceTransitionStatus, String> {
    validate_workspace_path(workspace_path)?;
    let output = default_output_path(workspace_path)?;
    let sqlite_path = workspace_path.join("store.sqlite");
    let duckdb_path = workspace_path.join("store.duckdb");

    if duckdb_path.is_file() && !sqlite_path.exists() {
        return Ok(required_status(
            workspace_path,
            output,
            "duckdb-workspace",
            "Legacy DuckDB workspace detected. Convert it to the V1 workspace format before switching runtimes.",
        ));
    }
    if sqlite_path.is_file() {
        match sqlite_has_prediction_arrays(&sqlite_path) {
            Ok(true) => {
                return Ok(required_status(
                    workspace_path,
                    output,
                    "sqlite-workspace-legacy-arrays",
                    "Workspace uses legacy prediction_arrays storage. Convert it to the V1 workspace format before publishing or sharing.",
                ));
            }
            Ok(false) => {}
            Err(()) => {
                return Ok(required_status(
                    workspace_path,
                    output,
                    "sqlite-workspace-unreadable",
                    "Workspace store cannot be classified safely. Run the converter preflight before switching runtimes.",
                ));
            }
        }
    }
    if has_legacy_runs_tree(workspace_path)? {
        return Ok(required_status(
            workspace_path,
            output,
            "fs-runs-legacy",
            "Legacy filesystem run manifests detected. Convert them into a fresh V1 workspace before opening in new runtimes.",
        ));
    }
    Ok(WorkspaceTransitionStatus {
        path: workspace_path.to_path_buf(),
        format: if sqlite_path.is_file() {
            "sqlite-workspace-v2"
        } else {
            "new-or-empty"
        },
        conversion_required: false,
        message: "Workspace is compatible with the V1 runtime format.",
        default_output_path: None,
    })
}

fn required_status(
    workspace_path: &Path,
    output: PathBuf,
    format: &'static str,
    message: &'static str,
) -> WorkspaceTransitionStatus {
    WorkspaceTransitionStatus {
        path: workspace_path.to_path_buf(),
        format,
        conversion_required: true,
        message,
        default_output_path: Some(output),
    }
}

fn validate_workspace_path(workspace_path: &Path) -> Result<(), String> {
    let encoded = workspace_path
        .to_str()
        .filter(|path| !path.is_empty() && !path.contains('\0'))
        .ok_or_else(|| "active workspace path is invalid".to_string())?;
    if encoded.len() > MAX_WORKSPACE_PATH_BYTES {
        return Err("active workspace path exceeds the fixed path limit".into());
    }
    if !workspace_path.is_absolute() {
        return Err("active workspace path must be absolute".into());
    }
    if !workspace_path.is_dir() {
        return Err("active workspace path is not an existing directory".into());
    }
    Ok(())
}

fn default_output_path(workspace_path: &Path) -> Result<PathBuf, String> {
    let name = workspace_path
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.is_empty())
        .ok_or_else(|| "active workspace path has no portable final component".to_string())?;
    Ok(workspace_path.with_file_name(format!("{name}-workspace-v2")))
}

fn sqlite_has_prediction_arrays(sqlite_path: &Path) -> Result<bool, ()> {
    let connection = Connection::open_with_flags(
        sqlite_path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|_| ())?;
    connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='prediction_arrays')",
            [],
            |row| row.get::<_, bool>(0),
        )
        .map_err(|_| ())
}

fn has_legacy_runs_tree(workspace_path: &Path) -> Result<bool, String> {
    let runs = workspace_path.join("runs");
    if !runs.is_dir() {
        return Ok(false);
    }
    let mut inspected = 0_usize;
    for run in std::fs::read_dir(&runs)
        .map_err(|error| format!("could not inspect {}: {error}", runs.display()))?
    {
        let run = run.map_err(|error| format!("could not inspect runs directory: {error}"))?;
        inspected = inspected.saturating_add(1);
        if inspected > MAX_RUN_TREE_ENTRIES {
            return Err("legacy runs preflight exceeds the fixed entry limit".into());
        }
        if !run
            .file_type()
            .map_err(|error| format!("could not inspect run entry: {error}"))?
            .is_dir()
        {
            continue;
        }
        for pipeline in std::fs::read_dir(run.path())
            .map_err(|error| format!("could not inspect {}: {error}", run.path().display()))?
        {
            let pipeline = pipeline
                .map_err(|error| format!("could not inspect pipeline directory: {error}"))?;
            inspected = inspected.saturating_add(1);
            if inspected > MAX_RUN_TREE_ENTRIES {
                return Err("legacy runs preflight exceeds the fixed entry limit".into());
            }
            if pipeline
                .file_type()
                .map_err(|error| format!("could not inspect pipeline entry: {error}"))?
                .is_dir()
                && pipeline.path().join("manifest.yaml").is_file()
            {
                return Ok(true);
            }
        }
    }
    Ok(false)
}

/// Parse the exact renderer request fields into a resolved converter request.
///
/// # Errors
///
/// Rejects malformed JSON, unknown or incorrectly typed fields, and unsafe
/// relative or unbounded output paths.
pub fn parse_request(
    body: &[u8],
    workspace_path: &Path,
    default_output: &Path,
) -> Result<LegacyConversionRequest, &'static str> {
    let value: Value =
        serde_json::from_slice(body).map_err(|_| "request body must be valid JSON")?;
    let request = value
        .as_object()
        .ok_or("request body must be a JSON object")?;
    let allowed = REQUEST_FIELDS.into_iter().collect::<BTreeSet<_>>();
    if request.keys().any(|key| !allowed.contains(key.as_str())) {
        return Err("request body contains an unsupported field");
    }
    let boolean = |name: &str, default: bool| {
        request.get(name).map_or(Ok(default), |value| {
            value
                .as_bool()
                .ok_or("request boolean field has an invalid type")
        })
    };
    let verify = boolean("verify", true)?;
    let dry_run = boolean("dry_run", false)?;
    let strict = boolean("strict", false)?;
    let link_requested = boolean("link_converted_workspace", true)?;
    let output_path = match request.get("output_path") {
        None | Some(Value::Null) => default_output.to_path_buf(),
        Some(Value::String(path))
            if !path.is_empty()
                && path.len() <= MAX_WORKSPACE_PATH_BYTES
                && !path.contains('\0') =>
        {
            PathBuf::from(path)
        }
        Some(Value::String(_)) => {
            return Err("output_path is empty or exceeds the fixed path limit")
        }
        Some(_) => return Err("output_path must be a string or null"),
    };
    if !output_path.is_absolute() {
        return Err("output_path must be absolute");
    }
    if paths_overlap(workspace_path, &output_path) {
        return Err("output_path must be disjoint from the active workspace");
    }
    Ok(LegacyConversionRequest {
        workspace_path: workspace_path.to_path_buf(),
        output_path,
        verify,
        dry_run,
        strict,
        link_converted_workspace: link_requested && !dry_run,
    })
}

fn paths_overlap(workspace_path: &Path, output_path: &Path) -> bool {
    let Some(workspace_path) = resolve_for_overlap_check(workspace_path) else {
        return true;
    };
    let Some(output_path) = resolve_for_overlap_check(output_path) else {
        return true;
    };
    workspace_path.starts_with(&output_path) || output_path.starts_with(&workspace_path)
}

fn resolve_for_overlap_check(path: &Path) -> Option<PathBuf> {
    let normalized = normalize_absolute_path(path)?;
    let mut existing = normalized.as_path();
    let mut suffix = Vec::new();
    while !existing.exists() {
        suffix.push(existing.file_name()?.to_owned());
        existing = existing.parent()?;
    }
    let mut resolved = existing.canonicalize().ok()?;
    for component in suffix.into_iter().rev() {
        resolved.push(component);
    }
    Some(resolved)
}

fn normalize_absolute_path(path: &Path) -> Option<PathBuf> {
    if !path.is_absolute() {
        return None;
    }
    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            Component::Prefix(prefix) => normalized.push(prefix.as_os_str()),
            Component::RootDir => normalized.push(component.as_os_str()),
            Component::CurDir => {}
            Component::ParentDir => {
                if !normalized.pop() {
                    return None;
                }
            }
            Component::Normal(value) => normalized.push(value),
        }
    }
    Some(normalized)
}

fn build_python_module_command(
    python_plugin_host: &Path,
    request: &LegacyConversionRequest,
) -> Vec<String> {
    let mut command = vec![
        python_plugin_host.to_string_lossy().into_owned(),
        "-I".into(),
        "-B".into(),
        "-m".into(),
        "nirs4all_tools".into(),
    ];
    command.extend(converter_arguments(request));
    command
}

fn converter_arguments(request: &LegacyConversionRequest) -> Vec<String> {
    let mut arguments = vec![
        "legacy".into(),
        "migrate".into(),
        request.workspace_path.to_string_lossy().into_owned(),
        "--output".into(),
        request.output_path.to_string_lossy().into_owned(),
        "--target".into(),
        "nirs4all-workspace-v2".into(),
    ];
    if request.verify && !request.dry_run {
        arguments.push("--verify".into());
    }
    if request.dry_run {
        arguments.push("--dry-run".into());
    }
    if request.strict {
        arguments.push("--strict".into());
    }
    arguments
}

fn run_bounded_command(
    executable: &Path,
    arguments: &[String],
    timeout: Duration,
) -> Result<LegacyConversionProcessOutput, LegacyConversionFailure> {
    let mut child = Command::new(executable)
        .args(arguments)
        .env("PYTHONDONTWRITEBYTECODE", "1")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|_| LegacyConversionFailure::SpawnFailed)?;
    let (Some(stdout), Some(stderr)) = (child.stdout.take(), child.stderr.take()) else {
        let _ = child.kill();
        let _ = child.wait();
        return Err(LegacyConversionFailure::OutputReadFailed);
    };
    let stdout_exceeded = Arc::new(AtomicBool::new(false));
    let stderr_exceeded = Arc::new(AtomicBool::new(false));
    let stdout_flag = Arc::clone(&stdout_exceeded);
    let stderr_flag = Arc::clone(&stderr_exceeded);
    let stdout_reader = std::thread::spawn(move || {
        read_bounded_stdout(stdout, MAX_CONVERTER_STDOUT_BYTES, &stdout_flag)
    });
    let stderr_reader = std::thread::spawn(move || {
        read_bounded_stderr(stderr, MAX_CONVERTER_STDERR_BYTES, &stderr_flag)
    });

    let started_at = Instant::now();
    let status = loop {
        if stdout_exceeded.load(Ordering::Acquire) || stderr_exceeded.load(Ordering::Acquire) {
            let _ = child.kill();
            let _ = child.wait();
            break None;
        }
        match child.try_wait() {
            Ok(Some(status)) => break Some(status),
            Ok(None) if started_at.elapsed() >= timeout => {
                let _ = child.kill();
                let _ = child.wait();
                let _ = stdout_reader.join();
                let _ = stderr_reader.join();
                return Err(LegacyConversionFailure::TimedOut);
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(25)),
            Err(_) => {
                let _ = child.kill();
                let _ = child.wait();
                let _ = stdout_reader.join();
                let _ = stderr_reader.join();
                return Err(LegacyConversionFailure::ProcessFailed);
            }
        }
    };
    let stdout = stdout_reader
        .join()
        .map_err(|_| LegacyConversionFailure::OutputReadFailed)?
        .map_err(|_| LegacyConversionFailure::OutputReadFailed)?;
    let stderr = stderr_reader
        .join()
        .map_err(|_| LegacyConversionFailure::OutputReadFailed)?
        .map_err(|_| LegacyConversionFailure::OutputReadFailed)?;
    if stdout_exceeded.load(Ordering::Acquire) {
        return Err(LegacyConversionFailure::StdoutTooLarge);
    }
    if stderr_exceeded.load(Ordering::Acquire) {
        return Err(LegacyConversionFailure::StderrTooLarge);
    }
    let status = status.ok_or(LegacyConversionFailure::ProcessFailed)?;
    let return_code = status
        .code()
        .ok_or(LegacyConversionFailure::ProcessFailed)?;
    Ok(LegacyConversionProcessOutput {
        return_code,
        stdout: String::from_utf8(stdout).map_err(|_| LegacyConversionFailure::InvalidUtf8)?,
        stderr: String::from_utf8(stderr).map_err(|_| LegacyConversionFailure::InvalidUtf8)?,
    })
}

fn read_bounded_stdout(
    stdout: ChildStdout,
    limit: usize,
    exceeded: &AtomicBool,
) -> std::io::Result<Vec<u8>> {
    read_bounded(stdout, limit, exceeded)
}

fn read_bounded_stderr(
    stderr: ChildStderr,
    limit: usize,
    exceeded: &AtomicBool,
) -> std::io::Result<Vec<u8>> {
    read_bounded(stderr, limit, exceeded)
}

fn read_bounded(
    mut reader: impl Read,
    limit: usize,
    exceeded: &AtomicBool,
) -> std::io::Result<Vec<u8>> {
    let mut retained = Vec::with_capacity(limit.min(64 * 1024));
    let mut buffer = [0_u8; 4096];
    loop {
        let count = reader.read(&mut buffer)?;
        if count == 0 {
            return Ok(retained);
        }
        let remaining = limit.saturating_sub(retained.len());
        let copied = remaining.min(count);
        retained.extend_from_slice(&buffer[..copied]);
        if copied < count {
            exceeded.store(true, Ordering::Release);
        }
    }
}

#[must_use]
pub fn display_command(command: &[String]) -> String {
    command
        .iter()
        .map(|part| {
            if !part.is_empty()
                && part.bytes().all(|byte| {
                    byte.is_ascii_alphanumeric()
                        || matches!(byte, b'/' | b'\\' | b'.' | b'_' | b'-' | b':')
                })
            {
                part.clone()
            } else {
                format!("'{}'", part.replace('\'', "'\\''"))
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{env, fs, time::SystemTime};

    fn temporary_directory(name: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = env::temp_dir().join(format!(
            "studio-sidecar-conversion-{name}-{}-{nonce}",
            std::process::id()
        ));
        fs::create_dir_all(&path).unwrap();
        path
    }

    #[test]
    fn detects_all_three_legacy_workspace_markers_without_writing_source() {
        let root = temporary_directory("detect");
        let duckdb = root.join("duckdb");
        fs::create_dir(&duckdb).unwrap();
        fs::write(duckdb.join("store.duckdb"), b"legacy").unwrap();
        assert_eq!(
            inspect_workspace_transition(&duckdb).unwrap().format,
            "duckdb-workspace"
        );

        let sqlite = root.join("sqlite");
        fs::create_dir(&sqlite).unwrap();
        let connection = Connection::open(sqlite.join("store.sqlite")).unwrap();
        connection
            .execute("CREATE TABLE prediction_arrays(id TEXT)", [])
            .unwrap();
        drop(connection);
        assert_eq!(
            inspect_workspace_transition(&sqlite).unwrap().format,
            "sqlite-workspace-legacy-arrays"
        );
        assert!(!sqlite.join("store.sqlite-wal").exists());
        assert!(!sqlite.join("store.sqlite-shm").exists());

        let runs = root.join("runs");
        fs::create_dir(&runs).unwrap();
        let manifest = runs.join("runs/run-a/pipeline-a/manifest.yaml");
        fs::create_dir_all(manifest.parent().unwrap()).unwrap();
        fs::write(&manifest, b"run_id: run-a\n").unwrap();
        assert_eq!(
            inspect_workspace_transition(&runs).unwrap().format,
            "fs-runs-legacy"
        );
        assert_eq!(fs::read(manifest).unwrap(), b"run_id: run-a\n");
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn request_and_command_keep_dry_run_non_writing_and_verification_explicit() {
        let root = temporary_directory("request");
        let workspace = root.join("legacy");
        fs::create_dir(&workspace).unwrap();
        let output = root.join("converted");
        let request = parse_request(
            br#"{"dry_run":true,"verify":true,"strict":true,"link_converted_workspace":true}"#,
            &workspace,
            &output,
        )
        .unwrap();
        assert!(request.dry_run);
        assert!(!request.link_converted_workspace);
        let command = build_python_module_command(Path::new("/python"), &request);
        assert!(command.contains(&"--dry-run".into()));
        assert!(command.contains(&"--strict".into()));
        assert!(!command.contains(&"--verify".into()));
        assert_eq!(command[4], "nirs4all_tools");
        let external = LegacyConversionRuntime::default().command(&request);
        assert_eq!(external[0], "nirs4all-tools");
        assert_eq!(&external[1..3], ["legacy", "migrate"]);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rejects_relative_output_and_unknown_renderer_fields() {
        let root = temporary_directory("invalid-request");
        assert_eq!(
            parse_request(br#"{"output_path":"relative"}"#, &root, &root.join("out")),
            Err("output_path must be absolute")
        );
        assert_eq!(
            parse_request(br#"{"executor":"python-http"}"#, &root, &root.join("out")),
            Err("request body contains an unsupported field")
        );
        assert_eq!(
            parse_request(
                serde_json::to_string(&serde_json::json!({"output_path": root.join("nested")}))
                    .unwrap()
                    .as_bytes(),
                &root,
                &root.join("out"),
            ),
            Err("output_path must be disjoint from the active workspace")
        );
        assert_eq!(
            parse_request(
                serde_json::to_string(&serde_json::json!({"output_path": root.parent().unwrap()}))
                    .unwrap()
                    .as_bytes(),
                &root,
                &root.join("out"),
            ),
            Err("output_path must be disjoint from the active workspace")
        );
        fs::remove_dir_all(root).unwrap();
    }
}
