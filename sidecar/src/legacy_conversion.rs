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
        mpsc, Arc,
    },
    time::{Duration, Instant},
};

#[cfg(unix)]
use std::os::unix::process::CommandExt;

#[cfg(unix)]
use nix::{
    sys::signal::{killpg, Signal},
    unistd::Pid,
};

use rusqlite::{Connection, OpenFlags};
use serde_json::Value;
use sha2::{Digest, Sha256};
use url::Url;

pub const LEGACY_TRANSITION_STATUS_ROUTE: &str = "/api/workspace/transition-status";
pub const LEGACY_CONVERSION_ROUTE: &str = "/api/workspace/legacy-convert";
pub const LEGACY_CONVERSION_TIMEOUT: Duration = Duration::from_secs(30 * 60);
pub const MAX_CONVERTER_STDOUT_BYTES: usize = 256 * 1024;
pub const MAX_CONVERTER_STDERR_BYTES: usize = 256 * 1024;
const MAX_WORKSPACE_PATH_BYTES: usize = 4096;
const MAX_RUN_TREE_ENTRIES: usize = 4096;
const WORKSPACE_V2_USER_VERSION: i64 = 2;
const WORKSPACE_V2_TABLES: [&str; 7] = [
    "artifacts",
    "chains",
    "logs",
    "pipelines",
    "predictions",
    "projects",
    "runs",
];
const WORKSPACE_V2_REQUIRED_COLUMNS: [(&str, &[&str]); 7] = [
    (
        "artifacts",
        &["artifact_id", "artifact_path", "content_hash"],
    ),
    (
        "chains",
        &[
            "chain_id",
            "pipeline_id",
            "steps",
            "model_step_idx",
            "model_class",
        ],
    ),
    ("logs", &["log_id", "pipeline_id", "step_idx", "event"]),
    (
        "pipelines",
        &["pipeline_id", "run_id", "name", "dataset_name"],
    ),
    (
        "predictions",
        &[
            "prediction_id",
            "pipeline_id",
            "dataset_name",
            "model_name",
            "model_class",
            "fold_id",
            "partition",
            "metric",
            "task_type",
        ],
    ),
    ("projects", &["project_id", "name"]),
    ("runs", &["run_id", "name", "status"]),
];
const TOOLS_PREFLIGHT_TIMEOUT: Duration = Duration::from_secs(20);
const PROCESS_CLEANUP_TIMEOUT: Duration = Duration::from_secs(2);
const TOOLS_VERSION: &str = "0.0.7";
const TOOLS_MANIFEST_SHA256: &str =
    "cd0311a57c4be4cd99f84b8ae750eb2f97d4edf765bb0e8717a9ea181724ae07";
pub const WINDOWS_JOB_LAUNCHER_ARGUMENT: &str = "--internal-legacy-converter-job";
const TOOLS_PREFLIGHT: &str = r#"import base64,csv,hashlib,importlib.metadata,io,json,os,socket,subprocess,sys
def deny(event,args):
 if event == "socket.bind": raise RuntimeError("listener denied")
 if event in {"subprocess.Popen","os.system","os.spawn","os.posix_spawn","os.fork","os.forkpty","os.exec","pty.spawn"}: raise RuntimeError("spawn denied")
sys.addaudithook(deny)
d=importlib.metadata.distribution("nirs4all-tools")
r=next(x for x in d.files or [] if str(x).endswith(".dist-info/RECORD"))
b=open(d.locate_file(r),"rb").read()
rows=sorted(set(tuple(row) for row in csv.reader(io.StringIO(b.decode("utf-8"))) if row[1] and not row[0].endswith(".pyc") and not row[0].startswith("../../../") and row[0].rsplit("/",1)[-1] not in {"INSTALLER","REQUESTED","direct_url.json"}))
m="".join(",".join(row)+"\n" for row in rows).encode("utf-8")
verified=True
for relative,encoded,size in rows:
 algorithm,expected=encoded.split("=",1); payload=open(d.locate_file(relative),"rb").read(); actual=base64.urlsafe_b64encode(hashlib.new(algorithm,payload).digest()).decode("ascii").rstrip("=")
 if actual != expected or (size and len(payload) != int(size)): verified=False; break
record=hashlib.sha256(b).hexdigest(); manifest=hashlib.sha256(m).hexdigest()
identity_ok=d.version=="0.0.7" and manifest=="cd0311a57c4be4cd99f84b8ae750eb2f97d4edf765bb0e8717a9ea181724ae07" and verified
duckdb_functional=pyarrow_functional=False
if identity_ok:
 import nirs4all_tools,duckdb,pyarrow,pyarrow.parquet as parquet
 dc=duckdb.connect(":memory:"); duckdb_functional=dc.execute("SELECT 40 + 2").fetchone()==(42,); dc.close()
 table=pyarrow.table({"value":[1,2,3]}); sink=pyarrow.BufferOutputStream(); parquet.write_table(table,sink); payload=sink.getvalue(); restored=parquet.read_table(pyarrow.BufferReader(payload)); pyarrow_functional=restored.equals(table)
else: nirs4all_tools=duckdb=pyarrow=None
print(json.dumps({"version":d.version,"record":record,"manifest":manifest,"verified":verified,"module":getattr(nirs4all_tools,"__name__",None),"duckdb":getattr(duckdb,"__version__",None),"pyarrow":getattr(pyarrow,"__version__",None),"duckdb_functional":duckdb_functional,"pyarrow_parquet_functional":pyarrow_functional},sort_keys=True,separators=(",",":")))"#;
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
    Unavailable,
    SpawnFailed,
    TimedOut,
    ProcessFailed,
    OutputReadFailed,
    StdoutTooLarge,
    StderrTooLarge,
    InvalidUtf8,
    CleanupFailed,
}

impl LegacyConversionFailure {
    #[must_use]
    pub const fn reason(self) -> &'static str {
        match self {
            Self::Busy => "legacy_conversion_already_running",
            Self::Unavailable => "legacy_converter_unavailable",
            Self::SpawnFailed => "legacy_converter_spawn_failed",
            Self::TimedOut => "legacy_converter_timeout",
            Self::ProcessFailed => "legacy_converter_process_failed",
            Self::OutputReadFailed => "legacy_converter_output_failed",
            Self::StdoutTooLarge => "legacy_converter_stdout_too_large",
            Self::StderrTooLarge => "legacy_converter_stderr_too_large",
            Self::InvalidUtf8 => "legacy_converter_invalid_utf8",
            Self::CleanupFailed => "legacy_converter_cleanup_failed",
        }
    }
}

pub(crate) trait LegacyConverter: Debug + Send + Sync {
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
        Err(LegacyConversionFailure::Unavailable)
    }
}

#[derive(Debug)]
struct PythonModuleLegacyConverter {
    python_plugin_host: PathBuf,
    python_host_sha256: Option<String>,
    poisoned: AtomicBool,
}

impl PythonModuleLegacyConverter {
    fn run_with_timeouts(
        &self,
        request: &LegacyConversionRequest,
        timeout: Duration,
        cleanup_timeout: Duration,
    ) -> Result<LegacyConversionProcessOutput, LegacyConversionFailure> {
        // Availability is deliberately not cached: the interpreter or its
        // installed closure may have been replaced since Studio startup.
        if !self.python_host_identity_matches()
            || !attest_python_tools_runtime(&self.python_plugin_host)
            || !self.python_host_identity_matches()
        {
            return Err(LegacyConversionFailure::Unavailable);
        }
        if self.poisoned.load(Ordering::Acquire) {
            return Err(LegacyConversionFailure::CleanupFailed);
        }
        let result = run_bounded_command_with_cleanup_timeout(
            &self.python_plugin_host,
            &self.command(request)[1..],
            timeout,
            cleanup_timeout,
        );
        if result == Err(LegacyConversionFailure::CleanupFailed) {
            self.poisoned.store(true, Ordering::Release);
        }
        result
    }
}

impl LegacyConverter for PythonModuleLegacyConverter {
    fn is_available(&self) -> bool {
        !self.poisoned.load(Ordering::Acquire)
            && self.python_host_identity_matches()
            && attest_python_tools_runtime(&self.python_plugin_host)
            && self.python_host_identity_matches()
    }

    fn command(&self, request: &LegacyConversionRequest) -> Vec<String> {
        build_python_module_command(&self.python_plugin_host, request)
    }

    fn run(
        &self,
        request: &LegacyConversionRequest,
    ) -> Result<LegacyConversionProcessOutput, LegacyConversionFailure> {
        self.run_with_timeouts(request, LEGACY_CONVERSION_TIMEOUT, PROCESS_CLEANUP_TIMEOUT)
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
            converter: Arc::new(PythonModuleLegacyConverter {
                python_host_sha256: sha256_regular_file(&python_plugin_host),
                python_plugin_host,
                poisoned: AtomicBool::new(false),
            }),
            running: Arc::new(AtomicBool::new(false)),
        })
    }

    #[must_use]
    #[cfg(test)]
    pub(crate) fn with_converter(converter: Arc<dyn LegacyConverter>) -> Self {
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
        if !self.converter.is_available() {
            return Err(LegacyConversionFailure::Unavailable);
        }
        if self
            .running
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Relaxed)
            .is_err()
        {
            return Err(LegacyConversionFailure::Busy);
        }
        let _permit = ConversionPermit(&self.running);
        if !self.converter.is_available() {
            return Err(LegacyConversionFailure::Unavailable);
        }
        self.converter.run(request)
    }
}

impl PythonModuleLegacyConverter {
    fn python_host_identity_matches(&self) -> bool {
        self.python_host_sha256
            .as_deref()
            .zip(sha256_regular_file(&self.python_plugin_host).as_deref())
            .is_some_and(|(expected, actual)| expected == actual)
    }
}

fn sha256_regular_file(path: &Path) -> Option<String> {
    let before = std::fs::symlink_metadata(path).ok()?;
    if before.file_type().is_symlink() || !before.is_file() {
        return None;
    }
    let mut file = std::fs::File::open(path).ok()?;
    let opened = file.metadata().ok()?;
    if !path_matches_open_file(path, &file) {
        return None;
    }
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 16 * 1024];
    loop {
        let count = file.read(&mut buffer).ok()?;
        if count == 0 {
            break;
        }
        hasher.update(&buffer[..count]);
    }
    let after = file.metadata().ok()?;
    let path_after = std::fs::symlink_metadata(path).ok()?;
    if path_after.file_type().is_symlink()
        || !path_matches_open_file(path, &file)
        || opened.len() != after.len()
        || opened.modified().ok() != after.modified().ok()
    {
        return None;
    }
    Some(format!("{:x}", hasher.finalize()))
}

fn valid_lower_sha256(digest: &str) -> bool {
    digest.len() == 64
        && digest
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn attest_python_tools_runtime(python_plugin_host: &Path) -> bool {
    if !std::fs::symlink_metadata(python_plugin_host)
        .is_ok_and(|metadata| !metadata.file_type().is_symlink() && metadata.is_file())
    {
        return false;
    }
    let arguments = vec![
        "-I".into(),
        "-B".into(),
        "-c".into(),
        TOOLS_PREFLIGHT.into(),
    ];
    let Ok(output) = run_bounded_command(python_plugin_host, &arguments, TOOLS_PREFLIGHT_TIMEOUT)
    else {
        return false;
    };
    if output.return_code != 0 || !output.stderr.is_empty() {
        return false;
    }
    let Ok(value) = serde_json::from_str::<Value>(output.stdout.trim()) else {
        return false;
    };
    value.get("version").and_then(Value::as_str) == Some(TOOLS_VERSION)
        && value
            .get("record")
            .and_then(Value::as_str)
            .is_some_and(valid_lower_sha256)
        && value.get("manifest").and_then(Value::as_str) == Some(TOOLS_MANIFEST_SHA256)
        && value.get("verified").and_then(Value::as_bool) == Some(true)
        && value.get("module").and_then(Value::as_str) == Some("nirs4all_tools")
        && value.get("duckdb").and_then(Value::as_str) == Some("1.5.5")
        && value.get("pyarrow").and_then(Value::as_str) == Some("25.0.1")
        && value.get("duckdb_functional").and_then(Value::as_bool) == Some(true)
        && value
            .get("pyarrow_parquet_functional")
            .and_then(Value::as_bool)
            == Some(true)
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
    if let Some((format, message)) = detect_legacy_marker(workspace_path)? {
        return Ok(required_status(workspace_path, output, format, message));
    }
    if candidate_metadata(&sqlite_path)?.is_some() {
        return match validate_workspace_v2_store(workspace_path, &sqlite_path) {
            Ok(()) => Ok(WorkspaceTransitionStatus {
                path: workspace_path.to_path_buf(),
                format: "sqlite-workspace-v2",
                conversion_required: false,
                message: "Workspace is a strictly validated nirs4all-workspace-v2 output.",
                default_output_path: None,
            }),
            Err(detail) => Ok(required_status(
                workspace_path,
                output,
                if detail == "legacy-arrays" {
                    "sqlite-workspace-legacy-arrays"
                } else {
                    "sqlite-workspace-unreadable-or-incompatible"
                },
                if detail == "legacy-arrays" {
                    "Workspace uses legacy prediction_arrays storage and requires conversion."
                } else {
                    "Workspace store is not a strictly valid nirs4all-workspace-v2 output; conversion preflight is required."
                },
            )),
        };
    }
    Ok(WorkspaceTransitionStatus {
        path: workspace_path.to_path_buf(),
        format: "new-or-empty",
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
    let metadata = std::fs::symlink_metadata(workspace_path)
        .map_err(|error| format!("active workspace path cannot be inspected: {error}"))?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
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

fn detect_legacy_marker(
    workspace_path: &Path,
) -> Result<Option<(&'static str, &'static str)>, String> {
    reject_recursive_symlinks(workspace_path)?;
    for (name, expected_directory, format, message) in [
        (
            "store.duckdb",
            false,
            "duckdb-workspace",
            "Legacy DuckDB workspace detected.",
        ),
        (
            "arrays",
            true,
            "legacy-arrays-directory",
            "Legacy array sidecars detected.",
        ),
    ] {
        let path = workspace_path.join(name);
        if let Some(metadata) = candidate_metadata(&path)? {
            let correct_type = if expected_directory {
                metadata.is_dir()
            } else {
                metadata.is_file()
            };
            if !correct_type {
                return Err(format!(
                    "workspace marker has an invalid type: {}",
                    path.display()
                ));
            }
            return Ok(Some((format, message)));
        }
    }
    if has_native_results_triplet(workspace_path)? {
        return Ok(Some((
            "native-results-v1",
            "Native results bundle requires converter compatibility preflight.",
        )));
    }
    let mut inspected = 0_usize;
    for entry in std::fs::read_dir(workspace_path)
        .map_err(|error| format!("could not inspect workspace directory: {error}"))?
    {
        let entry = entry.map_err(|error| format!("could not inspect workspace entry: {error}"))?;
        inspected = inspected.saturating_add(1);
        if inspected > MAX_RUN_TREE_ENTRIES {
            return Err("workspace detector exceeds the fixed entry limit".into());
        }
        let file_type = entry
            .file_type()
            .map_err(|error| format!("could not inspect workspace entry type: {error}"))?;
        reject_symlinked_subtree(file_type, &entry.path(), "workspace")?;
        let name = entry.file_name();
        let Some(name) = name.to_str() else {
            return Err("workspace contains a non-UTF-8 entry name".into());
        };
        let lower = name.to_ascii_lowercase();
        let is_n4a = Path::new(name)
            .extension()
            .is_some_and(|extension| extension.eq_ignore_ascii_case("n4a"));
        let legacy_file = is_n4a
            || lower.ends_with(".n4a.py")
            || lower.ends_with(".meta.parquet")
            || lower.ends_with("_predictions.json");
        if legacy_file {
            let metadata = candidate_metadata(&entry.path())?
                .ok_or_else(|| "workspace marker disappeared during inspection".to_string())?;
            if !metadata.is_file() {
                return Err(format!(
                    "legacy marker must be a regular file: {}",
                    entry.path().display()
                ));
            }
            let format = if lower.ends_with(".n4a.py") {
                "n4a-py-bundle"
            } else if is_n4a {
                "n4a-bundle"
            } else {
                "loose-predictions"
            };
            return Ok(Some((
                format,
                "Legacy portable or loose prediction artifact detected.",
            )));
        }
        if file_type.is_dir() && has_native_results_triplet(&entry.path())? {
            return Ok(Some((
                "native-results-v1",
                "Native results bundle requires converter compatibility preflight.",
            )));
        }
    }
    if let Some(format) = runs_tree_format(workspace_path)? {
        let message = if format == "fs-runs-v2" {
            "Filesystem V2 run manifests require conversion into a workspace store."
        } else {
            "Legacy filesystem run manifests detected."
        };
        return Ok(Some((format, message)));
    }
    Ok(None)
}

fn reject_recursive_symlinks(workspace_path: &Path) -> Result<(), String> {
    let mut pending = vec![workspace_path.to_path_buf()];
    let mut inspected = 0_usize;
    while let Some(directory) = pending.pop() {
        for entry in std::fs::read_dir(&directory)
            .map_err(|error| format!("could not inspect {}: {error}", directory.display()))?
        {
            let entry = entry.map_err(|error| {
                format!(
                    "could not inspect entry below {}: {error}",
                    directory.display()
                )
            })?;
            inspected = inspected.saturating_add(1);
            if inspected > MAX_RUN_TREE_ENTRIES {
                return Err("workspace detector exceeds the fixed recursive entry limit".into());
            }
            let path = entry.path();
            let metadata = std::fs::symlink_metadata(&path)
                .map_err(|error| format!("could not inspect {}: {error}", path.display()))?;
            if metadata.file_type().is_symlink() {
                return Err(format!(
                    "workspace detector refuses a symlink at any depth: {}",
                    path.display()
                ));
            }
            if metadata.is_dir() {
                pending.push(path);
            }
        }
    }
    Ok(())
}

fn candidate_metadata(path: &Path) -> Result<Option<std::fs::Metadata>, String> {
    match std::fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() => Err(format!(
            "workspace marker must not be a symlink: {}",
            path.display()
        )),
        Ok(metadata) => Ok(Some(metadata)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(format!("could not inspect {}: {error}", path.display())),
    }
}

fn has_native_results_triplet(directory: &Path) -> Result<bool, String> {
    let mut complete = true;
    for member in ["manifest.json", "score_set.json", "predictions.parquet"] {
        match candidate_metadata(&directory.join(member))? {
            Some(metadata) if metadata.is_file() => {}
            Some(_) => {
                return Err(format!(
                    "native results marker must be a regular file: {}",
                    directory.join(member).display()
                ));
            }
            None => complete = false,
        }
    }
    Ok(complete)
}

fn runs_tree_format(workspace_path: &Path) -> Result<Option<&'static str>, String> {
    let runs = workspace_path.join("runs");
    let Some(runs_metadata) = candidate_metadata(&runs)? else {
        return Ok(None);
    };
    if !runs_metadata.is_dir() {
        return Err("workspace runs marker must be a directory".into());
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
        let run_type = run
            .file_type()
            .map_err(|error| format!("could not inspect run entry: {error}"))?;
        reject_symlinked_subtree(run_type, &run.path(), "legacy runs")?;
        if !run_type.is_dir() {
            continue;
        }
        let run_manifest = run.path().join("run_manifest.yaml");
        if let Some(metadata) = candidate_metadata(&run_manifest)? {
            if !metadata.is_file() {
                return Err("run manifest marker must be a regular file".into());
            }
            return Ok(Some("fs-runs-v2"));
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
            let pipeline_type = pipeline
                .file_type()
                .map_err(|error| format!("could not inspect pipeline entry: {error}"))?;
            reject_symlinked_subtree(pipeline_type, &pipeline.path(), "legacy runs")?;
            if pipeline_type.is_dir() {
                let manifest = pipeline.path().join("manifest.yaml");
                if let Some(metadata) = candidate_metadata(&manifest)? {
                    if !metadata.is_file() {
                        return Err("pipeline manifest marker must be a regular file".into());
                    }
                    return Ok(Some("fs-runs-legacy"));
                }
            }
        }
    }
    Ok(None)
}

fn reject_symlinked_subtree(
    file_type: std::fs::FileType,
    path: &Path,
    detector: &str,
) -> Result<(), String> {
    if file_type.is_symlink() {
        return Err(format!(
            "{detector} detector refuses a symlinked subtree entry: {}",
            path.display()
        ));
    }
    Ok(())
}

pub(crate) fn validate_workspace_v2_store(
    workspace_path: &Path,
    sqlite_path: &Path,
) -> Result<(), &'static str> {
    open_validated_workspace_v2_store(workspace_path, sqlite_path).map(drop)
}

pub(crate) fn open_validated_workspace_v2_store(
    workspace_path: &Path,
    sqlite_path: &Path,
) -> Result<Connection, &'static str> {
    let root = workspace_path.canonicalize().map_err(|_| "root")?;
    let metadata = strict_candidate_metadata(sqlite_path)?.ok_or("store")?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err("store");
    }
    for suffix in ["-wal", "-shm", "-journal"] {
        if strict_candidate_metadata(&workspace_path.join(format!("store.sqlite{suffix}")))?
            .is_some()
        {
            return Err("live-journal");
        }
    }
    let store = sqlite_path.canonicalize().map_err(|_| "store")?;
    if !store.starts_with(&root) {
        return Err("store");
    }
    let identity_file = std::fs::File::open(&store).map_err(|_| "store")?;
    let before = identity_file.metadata().map_err(|_| "store")?;
    if !path_matches_open_file(&store, &identity_file) {
        return Err("changed");
    }
    let mut uri = Url::from_file_path(&store).map_err(|()| "store")?;
    uri.set_query(Some("mode=ro&immutable=1"));
    let connection = Connection::open_with_flags(
        uri.as_str(),
        OpenFlags::SQLITE_OPEN_READ_ONLY
            | OpenFlags::SQLITE_OPEN_URI
            | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|_| "sqlite")?;
    let integrity = connection
        .query_row("PRAGMA integrity_check", [], |row| row.get::<_, String>(0))
        .map_err(|_| "integrity")?;
    if integrity != "ok" {
        return Err("integrity");
    }
    let version = connection
        .query_row("PRAGMA user_version", [], |row| row.get::<_, i64>(0))
        .map_err(|_| "version")?;
    let mut statement = connection
        .prepare("SELECT name FROM sqlite_master WHERE type='table'")
        .map_err(|_| "schema")?;
    let tables = statement
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|_| "schema")?
        .collect::<Result<BTreeSet<_>, _>>()
        .map_err(|_| "schema")?;
    if tables.contains("prediction_arrays") {
        return Err("legacy-arrays");
    }
    if version != WORKSPACE_V2_USER_VERSION
        || WORKSPACE_V2_TABLES
            .iter()
            .any(|table| !tables.contains(*table))
    {
        return Err("schema");
    }
    drop(statement);
    for (table, required) in WORKSPACE_V2_REQUIRED_COLUMNS {
        let mut statement = connection
            .prepare(&format!("PRAGMA table_info({table})"))
            .map_err(|_| "schema")?;
        let columns = statement
            .query_map([], |row| row.get::<_, String>(1))
            .map_err(|_| "schema")?
            .collect::<Result<BTreeSet<_>, _>>()
            .map_err(|_| "schema")?;
        if required.iter().any(|column| !columns.contains(*column)) {
            return Err("schema");
        }
    }
    let path_after = std::fs::symlink_metadata(&store).map_err(|_| "store")?;
    let after = identity_file.metadata().map_err(|_| "store")?;
    if path_after.file_type().is_symlink()
        || store.canonicalize().map_err(|_| "store")? != store
        || !path_matches_open_file(&store, &identity_file)
        || before.len() != after.len()
        || before.modified().ok() != after.modified().ok()
    {
        return Err("changed");
    }
    Ok(connection)
}

fn strict_candidate_metadata(path: &Path) -> Result<Option<std::fs::Metadata>, &'static str> {
    match std::fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() => Err("symlink"),
        Ok(metadata) => Ok(Some(metadata)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(_) => Err("metadata"),
    }
}

/// Compare a live path with an already-open file identity.
///
/// `same-file` obtains the platform identity from live handles (volume/file
/// index on Windows, device/inode on Unix). Keeping `file` open for the whole
/// operation prevents an attacker from satisfying this check by recycling a
/// stale metadata identifier after replacing the path.
pub(crate) fn path_matches_open_file(path: &Path, file: &std::fs::File) -> bool {
    let Ok(open_file) = file.try_clone().and_then(same_file::Handle::from_file) else {
        return false;
    };
    same_file::Handle::from_path(path).is_ok_and(|path_file| path_file == open_file)
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
    loop {
        match std::fs::symlink_metadata(existing) {
            Ok(metadata) if metadata.file_type().is_symlink() => return None,
            Ok(_) => break,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                suffix.push(existing.file_name()?.to_owned());
                existing = existing.parent()?;
            }
            Err(_) => return None,
        }
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
        "-c".into(),
        tools_converter_bootstrap(),
        "--".into(),
    ];
    command.extend(converter_arguments(request));
    command
}

fn tools_converter_bootstrap() -> String {
    format!(
        r#"import contextlib,io,json,runpy,sys
_capture=io.StringIO()
with contextlib.redirect_stdout(_capture):
 exec({TOOLS_PREFLIGHT:?},{{}})
_attestation=json.loads(_capture.getvalue())
_record=_attestation.pop("record",None)
_expected={{"version":"{TOOLS_VERSION}","manifest":"{TOOLS_MANIFEST_SHA256}","verified":True,"module":"nirs4all_tools","duckdb":"1.5.5","pyarrow":"25.0.1","duckdb_functional":True,"pyarrow_parquet_functional":True}}
if not isinstance(_record,str) or len(_record)!=64 or any(c not in "0123456789abcdef" for c in _record) or _attestation != _expected:
 raise RuntimeError("unqualified nirs4all-tools runtime")
sys.argv=["nirs4all_tools",*sys.argv[2:]]
runpy.run_module("nirs4all_tools",run_name="__main__",alter_sys=True)
"#
    )
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
    run_bounded_command_with_cleanup_timeout(
        executable,
        arguments,
        timeout,
        PROCESS_CLEANUP_TIMEOUT,
    )
}

fn run_bounded_command_with_cleanup_timeout(
    executable: &Path,
    arguments: &[String],
    timeout: Duration,
    cleanup_timeout: Duration,
) -> Result<LegacyConversionProcessOutput, LegacyConversionFailure> {
    let mut command = bounded_process_command(executable, arguments)?;
    command
        .env("PYTHONDONTWRITEBYTECODE", "1")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    configure_process_tree(&mut command);
    let mut child = command
        .spawn()
        .map_err(|_| LegacyConversionFailure::SpawnFailed)?;
    let (Some(stdout), Some(stderr)) = (child.stdout.take(), child.stderr.take()) else {
        terminate_process_tree(&mut child);
        let _ = reap_child_bounded(&mut child, cleanup_timeout);
        return Err(LegacyConversionFailure::OutputReadFailed);
    };
    let stdout_exceeded = Arc::new(AtomicBool::new(false));
    let stderr_exceeded = Arc::new(AtomicBool::new(false));
    let stdout_flag = Arc::clone(&stdout_exceeded);
    let stderr_flag = Arc::clone(&stderr_exceeded);
    let (stdout_sender, stdout_receiver) = mpsc::channel();
    let (stderr_sender, stderr_receiver) = mpsc::channel();
    std::thread::spawn(move || {
        let _ = stdout_sender.send(read_bounded_stdout(
            stdout,
            MAX_CONVERTER_STDOUT_BYTES,
            &stdout_flag,
        ));
    });
    std::thread::spawn(move || {
        let _ = stderr_sender.send(read_bounded_stderr(
            stderr,
            MAX_CONVERTER_STDERR_BYTES,
            &stderr_flag,
        ));
    });

    let started_at = Instant::now();
    let outcome = loop {
        if stdout_exceeded.load(Ordering::Acquire) || stderr_exceeded.load(Ordering::Acquire) {
            let failure = check_output_limits(
                stdout_exceeded.load(Ordering::Acquire),
                stderr_exceeded.load(Ordering::Acquire),
            )
            .expect_err("at least one output bound is exceeded");
            break Err(failure);
        }
        match child.try_wait() {
            Ok(Some(status)) => break Ok(status),
            Ok(None) if started_at.elapsed() >= timeout => {
                break Err(LegacyConversionFailure::TimedOut);
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(25)),
            Err(_) => {
                break Err(LegacyConversionFailure::ProcessFailed);
            }
        }
    };
    if outcome.is_err() {
        terminate_process_tree(&mut child);
        if !reap_child_bounded(&mut child, cleanup_timeout) {
            return Err(LegacyConversionFailure::CleanupFailed);
        }
    }
    let (stdout, stderr) =
        match receive_reader_outputs(&stdout_receiver, &stderr_receiver, cleanup_timeout) {
            Ok(outputs) => outputs,
            Err(error) => {
                terminate_orphaned_process_group(&child);
                return Err(error);
            }
        };
    let status = outcome?;
    let return_code = status
        .code()
        .ok_or(LegacyConversionFailure::ProcessFailed)?;
    decode_process_output(return_code, stdout, stderr)
}

#[cfg(not(windows))]
#[expect(
    clippy::unnecessary_wraps,
    reason = "the platform implementations share one fallible command-construction boundary"
)]
fn bounded_process_command(
    executable: &Path,
    arguments: &[String],
) -> Result<Command, LegacyConversionFailure> {
    let mut command = Command::new(executable);
    command.args(arguments);
    Ok(command)
}

#[cfg(windows)]
fn bounded_process_command(
    executable: &Path,
    arguments: &[String],
) -> Result<Command, LegacyConversionFailure> {
    let launcher = std::env::current_exe().map_err(|_| LegacyConversionFailure::SpawnFailed)?;
    let mut command = Command::new(launcher);
    command
        .arg(WINDOWS_JOB_LAUNCHER_ARGUMENT)
        .arg(executable)
        .args(arguments);
    Ok(command)
}

fn receive_reader_outputs(
    stdout: &mpsc::Receiver<std::io::Result<Vec<u8>>>,
    stderr: &mpsc::Receiver<std::io::Result<Vec<u8>>>,
    timeout: Duration,
) -> Result<(Vec<u8>, Vec<u8>), LegacyConversionFailure> {
    let deadline = Instant::now() + timeout;
    let receive = |receiver: &mpsc::Receiver<std::io::Result<Vec<u8>>>| {
        let remaining = deadline.saturating_duration_since(Instant::now());
        receiver
            .recv_timeout(remaining)
            .map_err(|_| LegacyConversionFailure::CleanupFailed)?
            .map_err(|_| LegacyConversionFailure::OutputReadFailed)
    };
    Ok((receive(stdout)?, receive(stderr)?))
}

fn reap_child_bounded(child: &mut std::process::Child, timeout: Duration) -> bool {
    let deadline = Instant::now() + timeout;
    loop {
        match child.try_wait() {
            Ok(Some(_)) => return true,
            Ok(None) if Instant::now() < deadline => {
                std::thread::sleep(Duration::from_millis(10));
            }
            Ok(None) | Err(_) => return false,
        }
    }
}

const fn check_output_limits(
    stdout_exceeded: bool,
    stderr_exceeded: bool,
) -> Result<(), LegacyConversionFailure> {
    if stdout_exceeded {
        Err(LegacyConversionFailure::StdoutTooLarge)
    } else if stderr_exceeded {
        Err(LegacyConversionFailure::StderrTooLarge)
    } else {
        Ok(())
    }
}

fn decode_process_output(
    return_code: i32,
    stdout: Vec<u8>,
    stderr: Vec<u8>,
) -> Result<LegacyConversionProcessOutput, LegacyConversionFailure> {
    Ok(LegacyConversionProcessOutput {
        return_code,
        stdout: String::from_utf8(stdout).map_err(|_| LegacyConversionFailure::InvalidUtf8)?,
        stderr: String::from_utf8(stderr).map_err(|_| LegacyConversionFailure::InvalidUtf8)?,
    })
}

#[cfg(unix)]
fn configure_process_tree(command: &mut Command) {
    command.process_group(0);
}

#[cfg(windows)]
fn configure_process_tree(_command: &mut Command) {}

#[cfg(not(any(unix, windows)))]
fn configure_process_tree(_command: &mut Command) {}

fn terminate_process_tree(child: &mut std::process::Child) {
    #[cfg(unix)]
    if let Ok(pid) = i32::try_from(child.id()) {
        let _ = killpg(Pid::from_raw(pid), Signal::SIGKILL);
    }
    // On Windows the direct child is the internal launcher. It assigned itself
    // to a kill-on-close Job Object before spawning Python, so terminating the
    // launcher closes the only job handle and contains the complete tree.
    let _ = child.kill();
}

#[cfg(unix)]
fn terminate_orphaned_process_group(child: &std::process::Child) {
    if let Ok(pid) = i32::try_from(child.id()) {
        let _ = killpg(Pid::from_raw(pid), Signal::SIGKILL);
    }
}

#[cfg(not(unix))]
fn terminate_orphaned_process_group(_child: &std::process::Child) {
    // The Windows launcher owns a kill-on-close Job Object. Once it exits, the
    // OS terminates every remaining member before the bounded pipe deadline.
}

#[cfg(windows)]
pub fn run_windows_job_launcher(
    executable: &std::ffi::OsStr,
    arguments: impl IntoIterator<Item = std::ffi::OsString>,
) -> Result<std::convert::Infallible, String> {
    let _job = studio_windows_job::KillOnCloseJob::assign_current_process()?;
    let code = Command::new(executable)
        .args(arguments)
        .stdin(Stdio::inherit())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit())
        .status()
        .map_or_else(
            |error| {
                eprintln!("studio-sidecar: could not start contained legacy converter: {error}");
                70
            },
            |status| status.code().unwrap_or(70),
        );
    // `process::exit` deliberately skips Drop. The OS closes the last Job
    // handle while terminating this launcher, which atomically kills any
    // descendants that outlived Python without replacing Python's exit code.
    std::process::exit(code)
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
            return Ok(retained);
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

    fn write_strict_v2_store(workspace: &Path) {
        let connection = Connection::open(workspace.join("store.sqlite")).unwrap();
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
    fn detector_covers_lock_mig_markers_and_accepts_only_strict_v2() {
        let root = temporary_directory("lock-mig-markers");
        for (name, directory, expected) in [
            ("store.duckdb", false, "duckdb-workspace"),
            ("arrays", true, "legacy-arrays-directory"),
            ("model.n4a", false, "n4a-bundle"),
            ("model.n4a.py", false, "n4a-py-bundle"),
            ("sample.meta.parquet", false, "loose-predictions"),
            ("run_predictions.json", false, "loose-predictions"),
        ] {
            let workspace = root.join(name.replace('.', "-"));
            fs::create_dir(&workspace).unwrap();
            if directory {
                fs::create_dir(workspace.join(name)).unwrap();
            } else {
                fs::write(workspace.join(name), b"opaque").unwrap();
            }
            assert_eq!(
                inspect_workspace_transition(&workspace).unwrap().format,
                expected
            );
        }

        let strict = root.join("strict-v2");
        fs::create_dir(&strict).unwrap();
        write_strict_v2_store(&strict);
        let status = inspect_workspace_transition(&strict).unwrap();
        assert_eq!(status.format, "sqlite-workspace-v2");
        assert!(!status.conversion_required);

        let incomplete = root.join("incomplete-v2");
        fs::create_dir(&incomplete).unwrap();
        let connection = Connection::open(incomplete.join("store.sqlite")).unwrap();
        connection.execute_batch("PRAGMA user_version = 2").unwrap();
        drop(connection);
        assert_eq!(
            inspect_workspace_transition(&incomplete).unwrap().format,
            "sqlite-workspace-unreadable-or-incompatible"
        );

        let native_root = root.join("native-root");
        fs::create_dir(&native_root).unwrap();
        for member in ["manifest.json", "score_set.json", "predictions.parquet"] {
            fs::write(native_root.join(member), b"opaque").unwrap();
        }
        assert_eq!(
            inspect_workspace_transition(&native_root).unwrap().format,
            "native-results-v1"
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn detector_rejects_root_and_marker_symlink_substitution() {
        use std::os::unix::fs::symlink;

        let root = temporary_directory("detector-symlinks");
        let real = root.join("real");
        fs::create_dir(&real).unwrap();
        fs::write(real.join("store.duckdb"), b"legacy").unwrap();
        let linked_root = root.join("linked-root");
        symlink(&real, &linked_root).unwrap();
        assert!(inspect_workspace_transition(&linked_root).is_err());

        let marker_root = root.join("marker-root");
        fs::create_dir(&marker_root).unwrap();
        symlink(real.join("store.duckdb"), marker_root.join("store.duckdb")).unwrap();
        assert!(inspect_workspace_transition(&marker_root)
            .unwrap_err()
            .contains("symlink at any depth"));

        for (index, candidate) in [
            "store.duckdb",
            "store.sqlite",
            "arrays",
            "model.n4a",
            "model.n4a.py",
            "sample.meta.parquet",
            "run_predictions.json",
            "manifest.json",
            "score_set.json",
            "predictions.parquet",
            "runs",
        ]
        .into_iter()
        .enumerate()
        {
            let workspace = root.join(format!("dangling-{index}"));
            fs::create_dir(&workspace).unwrap();
            symlink(workspace.join("missing-target"), workspace.join(candidate)).unwrap();
            assert!(inspect_workspace_transition(&workspace)
                .unwrap_err()
                .contains("symlink"));
        }

        let run_manifest_root = root.join("dangling-run-manifest");
        fs::create_dir_all(run_manifest_root.join("runs/run-a")).unwrap();
        symlink(
            run_manifest_root.join("missing-manifest"),
            run_manifest_root.join("runs/run-a/run_manifest.yaml"),
        )
        .unwrap();
        assert!(inspect_workspace_transition(&run_manifest_root)
            .unwrap_err()
            .contains("symlink"));

        let native_target = root.join("native-target");
        fs::create_dir(&native_target).unwrap();
        for member in ["manifest.json", "score_set.json", "predictions.parquet"] {
            fs::write(native_target.join(member), b"opaque").unwrap();
        }
        for (name, target) in [
            ("native-valid-link", native_target.clone()),
            ("native-dangling-link", root.join("missing-native-target")),
        ] {
            let workspace = root.join(format!("workspace-{name}"));
            fs::create_dir(&workspace).unwrap();
            symlink(target, workspace.join(name)).unwrap();
            assert!(inspect_workspace_transition(&workspace)
                .unwrap_err()
                .contains("symlink"));
        }

        for (name, target) in [
            ("valid", native_target),
            ("dangling", root.join("missing-run-target")),
        ] {
            let workspace = root.join(format!("runs-{name}"));
            fs::create_dir_all(workspace.join("runs")).unwrap();
            symlink(target, workspace.join("runs/run-a")).unwrap();
            assert!(inspect_workspace_transition(&workspace)
                .unwrap_err()
                .contains("symlink"));
        }
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn detector_rejects_valid_and_dangling_symlinks_below_arbitrary_depth() {
        use std::os::unix::fs::symlink;

        let root = temporary_directory("detector-deep-symlinks");
        let target = root.join("target");
        fs::create_dir(&target).unwrap();
        for (name, destination) in [("valid", target), ("dangling", root.join("missing-target"))] {
            let workspace = root.join(name);
            let deep = workspace.join("one/two/three/four");
            fs::create_dir_all(&deep).unwrap();
            symlink(destination, deep.join("candidate")).unwrap();
            let error = inspect_workspace_transition(&workspace).unwrap_err();
            assert!(error.contains("symlink at any depth"));
        }
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
        assert_eq!(&command[1..4], ["-I", "-B", "-c"]);
        assert!(command[4].contains("runpy.run_module(\"nirs4all_tools\""));
        assert_eq!(command[5], "--");
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

    #[test]
    fn bounded_reader_flags_overflow_and_utf8_decoder_fails_closed() {
        let exceeded = AtomicBool::new(false);
        let retained = read_bounded(std::io::Cursor::new(vec![b'x'; 65]), 64, &exceeded).unwrap();
        assert_eq!(retained.len(), 64);
        assert!(exceeded.load(Ordering::Acquire));
        assert_eq!(
            check_output_limits(true, false),
            Err(LegacyConversionFailure::StdoutTooLarge)
        );
        assert_eq!(
            check_output_limits(false, true),
            Err(LegacyConversionFailure::StderrTooLarge)
        );
        assert_eq!(
            decode_process_output(0, vec![0xff], Vec::new()),
            Err(LegacyConversionFailure::InvalidUtf8)
        );
        assert_eq!(
            decode_process_output(0, Vec::new(), vec![0xff]),
            Err(LegacyConversionFailure::InvalidUtf8)
        );
    }

    #[test]
    fn runtime_never_executes_an_unattested_converter() {
        #[derive(Debug)]
        struct UnattestedProbe {
            ran: Arc<AtomicBool>,
        }

        impl LegacyConverter for UnattestedProbe {
            fn is_available(&self) -> bool {
                false
            }

            fn command(&self, _request: &LegacyConversionRequest) -> Vec<String> {
                vec!["unattested".into()]
            }

            fn run(
                &self,
                _request: &LegacyConversionRequest,
            ) -> Result<LegacyConversionProcessOutput, LegacyConversionFailure> {
                self.ran.store(true, Ordering::Release);
                Err(LegacyConversionFailure::SpawnFailed)
            }
        }

        let ran = Arc::new(AtomicBool::new(false));
        let runtime = LegacyConversionRuntime::with_converter(Arc::new(UnattestedProbe {
            ran: Arc::clone(&ran),
        }));
        let request = LegacyConversionRequest {
            workspace_path: PathBuf::from("/unattested-source"),
            output_path: PathBuf::from("/unattested-output"),
            verify: true,
            dry_run: false,
            strict: true,
            link_converted_workspace: false,
        };

        assert_eq!(
            runtime.run(&request),
            Err(LegacyConversionFailure::Unavailable)
        );
        assert!(!ran.load(Ordering::Acquire));

        let direct = PythonModuleLegacyConverter {
            python_plugin_host: PathBuf::from("/must-not-spawn"),
            python_host_sha256: None,
            poisoned: AtomicBool::new(false),
        };
        assert_eq!(
            direct.run(&request),
            Err(LegacyConversionFailure::Unavailable)
        );
    }

    #[cfg(unix)]
    #[test]
    fn runtime_reattests_host_replaced_after_initial_capability_check() {
        use std::os::unix::fs::PermissionsExt;

        let root = temporary_directory("runtime-host-replacement");
        let host = root.join("python-host");
        let expected = format!(
            "{{\"duckdb\":\"1.5.5\",\"duckdb_functional\":true,\"manifest\":\"{TOOLS_MANIFEST_SHA256}\",\"module\":\"nirs4all_tools\",\"pyarrow\":\"25.0.1\",\"pyarrow_parquet_functional\":true,\"record\":\"0000000000000000000000000000000000000000000000000000000000000000\",\"verified\":true,\"version\":\"{TOOLS_VERSION}\"}}"
        );
        fs::write(&host, format!("#!/bin/sh\nprintf '%s\\n' '{expected}'\n")).unwrap();
        let mut permissions = fs::metadata(&host).unwrap().permissions();
        permissions.set_mode(0o700);
        fs::set_permissions(&host, permissions.clone()).unwrap();
        let runtime = LegacyConversionRuntime::from_python_plugin_host(Some(host.clone()));
        assert!(runtime.is_available());

        let invoked = root.join("replacement-invoked");
        fs::write(
            &host,
            format!("#!/bin/sh\nprintf x >> '{}'\nexit 1\n", invoked.display()),
        )
        .unwrap();
        fs::set_permissions(&host, permissions).unwrap();
        let request = LegacyConversionRequest {
            workspace_path: root.join("source"),
            output_path: root.join("output"),
            verify: true,
            dry_run: false,
            strict: true,
            link_converted_workspace: false,
        };
        assert_eq!(
            runtime.run(&request),
            Err(LegacyConversionFailure::Unavailable)
        );
        assert!(!invoked.exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn windows_command_is_always_routed_through_internal_job_launcher() {
        use std::ffi::OsStr;

        let command = bounded_process_command(
            Path::new(r"C:\qualified\python.exe"),
            &["-I".into(), "-m".into(), "nirs4all_tools".into()],
        )
        .unwrap();
        let arguments = command.get_args().collect::<Vec<_>>();
        assert_eq!(
            arguments,
            [
                OsStr::new(WINDOWS_JOB_LAUNCHER_ARGUMENT),
                OsStr::new(r"C:\qualified\python.exe"),
                OsStr::new("-I"),
                OsStr::new("-m"),
                OsStr::new("nirs4all_tools"),
            ]
        );
    }

    #[cfg(unix)]
    #[test]
    fn converter_timeout_is_strictly_bounded() {
        let (executable, arguments) = (
            Path::new("/bin/sh"),
            vec!["-c".to_string(), "sleep 30".to_string()],
        );
        let started = Instant::now();
        assert_eq!(
            run_bounded_command(executable, &arguments, Duration::from_millis(50)),
            Err(LegacyConversionFailure::TimedOut)
        );
        assert!(started.elapsed() < Duration::from_secs(5));
    }

    #[test]
    fn reader_collection_deadline_never_waits_for_open_pipe_senders() {
        let (_stdout_sender, stdout_receiver) = mpsc::channel();
        let (_stderr_sender, stderr_receiver) = mpsc::channel();
        let started = Instant::now();
        assert_eq!(
            receive_reader_outputs(
                &stdout_receiver,
                &stderr_receiver,
                Duration::from_millis(25),
            ),
            Err(LegacyConversionFailure::CleanupFailed)
        );
        assert!(started.elapsed() < Duration::from_secs(1));
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn escaped_descendant_holding_pipes_fails_cleanup_within_deadline() {
        let arguments = vec!["-c".to_string(), "setsid sh -c 'sleep 1' &".to_string()];
        let started = Instant::now();
        assert_eq!(
            run_bounded_command_with_cleanup_timeout(
                Path::new("/bin/sh"),
                &arguments,
                Duration::from_secs(1),
                Duration::from_millis(50),
            ),
            Err(LegacyConversionFailure::CleanupFailed)
        );
        assert!(started.elapsed() < Duration::from_millis(500));
    }
}
