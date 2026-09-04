//! Bounded fresh-process `CPython` scientific-library host.
//!
//! The stdio worker and Rust-owned terminal callback are implemented here,
//! but product selection remains closed until Studio can resolve its current
//! saved dataset/pipeline payload into the callable's path-free matrix
//! contract. Python never owns HTTP, jobs, events, cancellation, scheduling,
//! or durable storage.

use std::{
    collections::BTreeMap,
    fs::{self, File},
    io::{Read, Write},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant, SystemTime},
};

use serde_json::Value;
use sha2::{Digest, Sha256};

use crate::job_http::{
    JobExecutorError, ScientificExecutionRequest, ScientificExecutorSelection,
    ScientificJobExecutor, ScientificJobTerminal, ScientificSubmissionPreflight,
};
use crate::scientific_request_resolver::ScientificRequestResolver;

pub const SCIENTIFIC_CPYTHON_HOST_CONTRACT: &str =
    include_str!("../contracts/studio_scientific_cpython_host_v1.json");
pub const SCIENTIFIC_CPYTHON_EXECUTOR_ID: &str = "cpython-stdio-v1";
pub const SCIENTIFIC_CPYTHON_PREFLIGHT_TIMEOUT: Duration = Duration::from_secs(15);
pub const SCIENTIFIC_CPYTHON_EXECUTION_TIMEOUT: Duration = Duration::from_secs(120);
pub const MAX_SCIENTIFIC_CPYTHON_STDIN_BYTES: usize = 64 * 1024;
pub const MAX_SCIENTIFIC_CPYTHON_STDOUT_BYTES: usize = 8 * 1024;
pub const MAX_SCIENTIFIC_CPYTHON_STDERR_BYTES: usize = 64 * 1024;
pub const MAX_SCIENTIFIC_CPYTHON_HOST_BYTES: u64 = 64 * 1024 * 1024;
pub const SCIENTIFIC_DISTRIBUTION_VERSION: &str = "1.0.0rc2";
pub const SCIENTIFIC_DISTRIBUTION_MANIFEST_SHA256: &str =
    "52767f7b8fdfaf1443873070f1e0cc1a4b22f5668c9a7baa6faf22e2a45f3fa5";
pub const SCIENTIFIC_WHEEL_SHA256: &str =
    "7387eb80516c98a8d01e5ac5743ed058035fcb69cd22cc4d162c57b7a32e7259";
pub const SCIENTIFIC_SOURCE_COMMIT: &str = "6429974a88cccc3fbf8dbe8aeb060435381f2bd4";
pub const SCIENTIFIC_CALLABLE_SHA256: &str =
    "7eb38aacfee0964db24d5bf2be577078883018d0f8bd603cda10cddd2a61df19";

const PREFLIGHT_SCRIPT: &str = r#"import base64,csv,hashlib,importlib.metadata,inspect,io,json,socket,sys
SCHEMA="nirs4all.studio-scientific-cpython-host.v1"
def deny_product_network(event,args):
    if event == "socket.bind":
        raise RuntimeError("CPython library host cannot own a listening socket")
    if event in {"subprocess.Popen","os.system","os.spawn","os.posix_spawn","os.fork","os.forkpty","os.exec","pty.spawn"}:
        raise RuntimeError("CPython library host cannot spawn child processes")
sys.addaudithook(deny_product_network)
if sys.argv[1]:
    sys.path.insert(0,sys.argv[1])
probe=socket.socket()
bind_denied=False
try:
    distribution_error=None
    probe.bind(("127.0.0.1",0))
except RuntimeError:
    bind_denied=True
finally:
    probe.close()
try:
    import nirs4all
    target=getattr(nirs4all,"studio_scientific_job_v1",None)
    ready=callable(target)
    callable_path=inspect.getsourcefile(target) if ready else None
    callable_sha256=hashlib.sha256(open(callable_path,"rb").read()).hexdigest() if callable_path else None
    distribution=importlib.metadata.distribution("nirs4all")
    distribution_version=distribution.version
    record_entry=next((entry for entry in distribution.files or [] if str(entry).endswith(".dist-info/RECORD")),None)
    record_path=distribution.locate_file(record_entry) if record_entry else None
    record_bytes=open(record_path,"rb").read() if record_path else b""
    distribution_record_sha256=hashlib.sha256(record_bytes).hexdigest() if record_bytes else None
    record_rows=sorted(set(tuple(row) for row in csv.reader(io.StringIO(record_bytes.decode("utf-8"))) if row[1] and not row[0].endswith(".pyc") and not row[0].startswith("../../../") and row[0].rsplit("/",1)[-1] not in {"INSTALLER","REQUESTED","direct_url.json"}))
    manifest_bytes="".join(",".join(row)+"\n" for row in record_rows).encode("utf-8")
    distribution_manifest_sha256=hashlib.sha256(manifest_bytes).hexdigest() if manifest_bytes else None
    distribution_files_verified=bool(record_rows)
    if distribution_files_verified:
        for relative,encoded,size in record_rows:
            algorithm,expected=encoded.split("=",1)
            member=distribution.locate_file(relative)
            payload=open(member,"rb").read()
            actual=base64.urlsafe_b64encode(hashlib.new(algorithm,payload).digest()).decode("ascii").rstrip("=")
            if actual != expected or (size and len(payload) != int(size)):
                distribution_files_verified=False
                break
except Exception as error:
    ready=False
    callable_path=None
    callable_sha256=None
    distribution_version=None
    distribution_manifest_sha256=None
    distribution_record_sha256=None
    distribution_files_verified=False
    distribution_error=type(error).__name__
print(json.dumps({"schema":SCHEMA,"callable":"nirs4all.studio_scientific_job_v1","callable_path":callable_path,"callable_sha256":callable_sha256,"ready":ready,"network_ownership":"forbidden","implementation":sys.implementation.name,"version":list(sys.version_info[:3]),"isolated":bool(sys.flags.isolated),"network_bind_denied":bind_denied,"distribution":"nirs4all","distribution_version":distribution_version,"distribution_record_sha256":distribution_record_sha256,"distribution_manifest_sha256":distribution_manifest_sha256,"distribution_files_verified":distribution_files_verified,"distribution_error":distribution_error,"selected_wheel_sha256":"7387eb80516c98a8d01e5ac5743ed058035fcb69cd22cc4d162c57b7a32e7259","source_commit":"6429974a88cccc3fbf8dbe8aeb060435381f2bd4"},separators=(",",":"),sort_keys=True))
"#;

const EXECUTION_SCRIPT: &str = r#"import base64,csv,hashlib,importlib.metadata,inspect,io,json,os,socket,sys
def deny_product_network(event,args):
    if event == "socket.bind":
        raise RuntimeError("CPython library host cannot own a listening socket")
    if event in {"subprocess.Popen","os.system","os.spawn","os.posix_spawn","os.fork","os.forkpty","os.exec","pty.spawn"}:
        raise RuntimeError("CPython library host cannot spawn child processes")
sys.addaudithook(deny_product_network)
if sys.argv[1]:
    sys.path.insert(0,sys.argv[1])
raw=sys.stdin.buffer.read(65537)
if len(raw)>65536:
    raise RuntimeError("scientific request exceeds stdin budget")
request=json.loads(raw)
distribution=importlib.metadata.distribution("nirs4all")
if distribution.version != "1.0.0rc2":
    raise RuntimeError("scientific distribution version changed")
record_entry=next((entry for entry in distribution.files or [] if str(entry).endswith(".dist-info/RECORD")),None)
record_path=distribution.locate_file(record_entry) if record_entry else None
record_bytes=open(record_path,"rb").read() if record_path else b""
record_rows=sorted(set(tuple(row) for row in csv.reader(io.StringIO(record_bytes.decode("utf-8"))) if row[1] and not row[0].endswith(".pyc") and not row[0].startswith("../../../") and row[0].rsplit("/",1)[-1] not in {"INSTALLER","REQUESTED","direct_url.json"}))
manifest_bytes="".join(",".join(row)+"\n" for row in record_rows).encode("utf-8")
if hashlib.sha256(manifest_bytes).hexdigest() != "52767f7b8fdfaf1443873070f1e0cc1a4b22f5668c9a7baa6faf22e2a45f3fa5":
    raise RuntimeError("scientific distribution identity changed")
for relative,encoded,size in record_rows:
    algorithm,expected=encoded.split("=",1)
    payload=open(distribution.locate_file(relative),"rb").read()
    actual=base64.urlsafe_b64encode(hashlib.new(algorithm,payload).digest()).decode("ascii").rstrip("=")
    if actual != expected or (size and len(payload) != int(size)):
        raise RuntimeError("scientific distribution member changed")
import nirs4all
target=getattr(nirs4all,"studio_scientific_job_v1",None)
if not callable(target):
    raise RuntimeError("scientific callable unavailable")
actual_path=os.path.realpath(inspect.getsourcefile(target))
if actual_path != sys.argv[2] or hashlib.sha256(open(actual_path,"rb").read()).hexdigest() != sys.argv[3]:
    raise RuntimeError("scientific callable identity changed")
response=target(request)
encoded=json.dumps(response,allow_nan=False,ensure_ascii=False,separators=(",",":"),sort_keys=True).encode("utf-8")
if len(encoded)>8192:
    raise RuntimeError("scientific response exceeds stdout budget")
sys.stdout.buffer.write(encoded)
"#;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ScientificCpythonUnavailable {
    HostUnavailable,
    HostSymlinkUnsupported,
    HostTooLarge,
    HostTampered,
    SpawnFailed,
    TimedOut,
    ProcessFailed,
    OutputReadFailed,
    StdoutTooLarge,
    StderrTooLarge,
    MalformedResponse,
    NotCpython,
    UnsupportedPythonVersion,
    IsolationDisabled,
    NetworkGuardFailed,
    CallableUnavailable,
    CallableTampered,
    DistributionTampered,
    RuntimeContractUnavailable,
    RuntimeContractTampered,
    RequestResolverUnavailable,
    PlatformKillTreeUnqualified,
    TerminalCallbackFailed,
    InvalidRequest,
    Cancelled,
}

impl ScientificCpythonUnavailable {
    #[must_use]
    pub const fn reason(self) -> &'static str {
        match self {
            Self::HostUnavailable => "python_host_unavailable",
            Self::HostSymlinkUnsupported => "python_host_symlink_unsupported",
            Self::HostTooLarge => "python_host_too_large",
            Self::HostTampered => "python_host_tampered",
            Self::SpawnFailed => "python_host_spawn_failed",
            Self::TimedOut => "python_host_timed_out",
            Self::ProcessFailed => "python_host_process_failed",
            Self::OutputReadFailed => "python_host_output_read_failed",
            Self::StdoutTooLarge => "python_host_stdout_too_large",
            Self::StderrTooLarge => "python_host_stderr_too_large",
            Self::MalformedResponse => "python_host_malformed_response",
            Self::NotCpython => "python_host_not_cpython",
            Self::UnsupportedPythonVersion => "python_host_version_unsupported",
            Self::IsolationDisabled => "python_host_isolation_disabled",
            Self::NetworkGuardFailed => "python_host_network_guard_failed",
            Self::CallableUnavailable => "scientific_callable_unavailable",
            Self::CallableTampered => "scientific_callable_tampered",
            Self::DistributionTampered => "scientific_distribution_tampered",
            Self::RuntimeContractUnavailable => "python_runtime_contract_unavailable",
            Self::RuntimeContractTampered => "python_runtime_contract_tampered",
            Self::RequestResolverUnavailable => "scientific_request_resolver_unavailable",
            Self::PlatformKillTreeUnqualified => "scientific_platform_kill_tree_unqualified",
            Self::TerminalCallbackFailed => "scientific_terminal_callback_failed",
            Self::InvalidRequest => "scientific_request_invalid",
            Self::Cancelled => "scientific_execution_cancelled",
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct HostIdentity {
    canonical_path: PathBuf,
    size: u64,
    sha256: [u8; 32],
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct RuntimeClosureFile {
    relative_path: String,
    size: u64,
    sha256: [u8; 32],
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct PackagedRuntimeIdentity {
    runtime_root: PathBuf,
    site_packages: PathBuf,
    closure: HostIdentity,
    directories: Vec<String>,
    files: Vec<RuntimeClosureFile>,
}

/// Sticky acquisition record for an explicitly selected `CPython` stdio host.
///
/// Selection requires the exact attested distribution and callable, a Unix
/// process-group kill tree, and the Rust-owned saved-run resolver that prepares
/// the callable's path-free matrix contract before any job mutation.
#[derive(Debug)]
pub struct CpythonScientificJobExecutor {
    identity: Option<HostIdentity>,
    callable_identity: Option<HostIdentity>,
    packaged_runtime: Option<PackagedRuntimeIdentity>,
    #[cfg_attr(not(unix), allow(dead_code))]
    acquisition: ScientificCpythonUnavailable,
    resolver: ScientificRequestResolver,
    running: Arc<Mutex<BTreeMap<String, Arc<AtomicBool>>>>,
    terminal_callback_failed: Arc<AtomicBool>,
}

impl CpythonScientificJobExecutor {
    #[must_use]
    pub fn acquire(path: impl AsRef<Path>) -> Self {
        let config_dir = std::env::var_os("NIRS4ALL_CONFIG")
            .map(PathBuf::from)
            .unwrap_or_default();
        Self::acquire_with_config_dir(path, config_dir)
    }

    #[must_use]
    pub fn acquire_with_config_dir(path: impl AsRef<Path>, config_dir: impl Into<PathBuf>) -> Self {
        Self::acquire_inner(path.as_ref(), None, config_dir.into())
    }

    /// Acquire only an adjacent packaged runtime already selected by Electron's
    /// content contract. Product startup uses this path; user venvs and PATH
    /// discovery never reach it.
    #[must_use]
    pub fn acquire_packaged_with_config_dir(
        path: impl AsRef<Path>,
        closure: impl AsRef<Path>,
        runtime_root: impl AsRef<Path>,
        site_packages: impl AsRef<Path>,
        config_dir: impl Into<PathBuf>,
    ) -> Self {
        let packaged_runtime = packaged_runtime_identity(
            path.as_ref(),
            closure.as_ref(),
            runtime_root.as_ref(),
            site_packages.as_ref(),
        );
        match packaged_runtime {
            Ok(identity) => Self::acquire_inner(path.as_ref(), Some(identity), config_dir.into()),
            Err(error) => Self::unavailable(error, config_dir.into()),
        }
    }

    fn acquire_inner(
        path: &Path,
        packaged_runtime: Option<PackagedRuntimeIdentity>,
        config_dir: PathBuf,
    ) -> Self {
        let resolver = ScientificRequestResolver::new(config_dir);
        let site_packages = packaged_runtime
            .as_ref()
            .map(|identity| identity.site_packages.as_path());
        match acquire_host(path, site_packages) {
            Ok((identity, callable_identity)) => {
                let callable_ready = callable_identity.is_some();
                Self {
                    identity: Some(identity),
                    callable_identity,
                    packaged_runtime,
                    acquisition: if callable_ready {
                        ScientificCpythonUnavailable::RequestResolverUnavailable
                    } else {
                        ScientificCpythonUnavailable::CallableUnavailable
                    },
                    resolver,
                    running: Arc::new(Mutex::new(BTreeMap::new())),
                    terminal_callback_failed: Arc::new(AtomicBool::new(false)),
                }
            }
            Err(error) => Self {
                identity: None,
                callable_identity: None,
                packaged_runtime,
                acquisition: error,
                resolver,
                running: Arc::new(Mutex::new(BTreeMap::new())),
                terminal_callback_failed: Arc::new(AtomicBool::new(false)),
            },
        }
    }

    fn unavailable(error: ScientificCpythonUnavailable, config_dir: PathBuf) -> Self {
        Self {
            identity: None,
            callable_identity: None,
            packaged_runtime: None,
            acquisition: error,
            resolver: ScientificRequestResolver::new(config_dir),
            running: Arc::new(Mutex::new(BTreeMap::new())),
            terminal_callback_failed: Arc::new(AtomicBool::new(false)),
        }
    }

    #[must_use]
    pub fn unavailable_reason(&self) -> &'static str {
        #[cfg(not(unix))]
        {
            ScientificCpythonUnavailable::PlatformKillTreeUnqualified.reason()
        }
        #[cfg(unix)]
        {
            if self.terminal_callback_failed.load(Ordering::Acquire) {
                return ScientificCpythonUnavailable::TerminalCallbackFailed.reason();
            }
            if let Some(identity) = &self.identity {
                if verify_identity(identity).is_err() {
                    return ScientificCpythonUnavailable::HostTampered.reason();
                }
            }
            if let Some(identity) = &self.callable_identity {
                if verify_identity(identity).is_err() {
                    return ScientificCpythonUnavailable::CallableTampered.reason();
                }
            }
            if let Some(identity) = &self.packaged_runtime {
                if verify_packaged_runtime_anchor(identity).is_err() {
                    return ScientificCpythonUnavailable::RuntimeContractTampered.reason();
                }
            }
            if self.callable_identity.is_some() && !self.resolver.is_configured() {
                return ScientificCpythonUnavailable::RequestResolverUnavailable.reason();
            }
            self.acquisition.reason()
        }
    }
}

impl ScientificJobExecutor for CpythonScientificJobExecutor {
    fn is_selected(&self) -> bool {
        cfg!(unix)
            && self.identity.is_some()
            && self.callable_identity.is_some()
            && self.resolver.is_configured()
            && !self.terminal_callback_failed.load(Ordering::Acquire)
    }

    fn unavailability_reason(&self) -> &'static str {
        self.unavailable_reason()
    }

    fn preflight_submission(
        &self,
        request: &ScientificSubmissionPreflight,
    ) -> Result<ScientificExecutorSelection, JobExecutorError> {
        if !self.is_selected() {
            return Err(JobExecutorError::PreflightRefused);
        }
        let (Some(host), Some(callable)) = (&self.identity, &self.callable_identity) else {
            return Err(JobExecutorError::PreflightRefused);
        };
        if let Some(packaged_runtime) = &self.packaged_runtime {
            verify_packaged_runtime_identity(packaged_runtime)
                .map_err(|_| JobExecutorError::PreflightRefused)?;
        }
        let site_packages = self
            .packaged_runtime
            .as_ref()
            .map(|identity| identity.site_packages.as_path());
        let (current_host, current_callable) = acquire_host(&host.canonical_path, site_packages)
            .map_err(|_| JobExecutorError::PreflightRefused)?;
        if &current_host != host || current_callable.as_ref() != Some(callable) {
            return Err(JobExecutorError::PreflightRefused);
        }
        let payload = self
            .resolver
            .resolve(request)
            .map_err(|_| JobExecutorError::PreflightRefused)?;
        validate_scientific_request(&payload, &request.job_id)
            .map_err(|_| JobExecutorError::PreflightRefused)?;
        Ok(ScientificExecutorSelection {
            execution_backend: "dag-ml-core".into(),
            execution_mode: Some("bounded-cpython-stdio".into()),
            prepared_payload: payload,
        })
    }

    fn submit_scientific(
        &self,
        request: &ScientificExecutionRequest,
        terminal: Arc<dyn ScientificJobTerminal>,
    ) -> Result<(), JobExecutorError> {
        let (Some(host), Some(callable)) = (&self.identity, &self.callable_identity) else {
            return Err(JobExecutorError::SubmissionRefused);
        };
        if let Some(packaged_runtime) = &self.packaged_runtime {
            verify_packaged_runtime_identity(packaged_runtime)
                .map_err(|_| JobExecutorError::SubmissionRefused)?;
        }
        verify_identity(host).map_err(|_| JobExecutorError::SubmissionRefused)?;
        verify_identity(callable).map_err(|_| JobExecutorError::SubmissionRefused)?;
        validate_scientific_request(&request.payload, &request.job_id)
            .map_err(|_| JobExecutorError::SubmissionRefused)?;
        let encoded = serde_json::to_vec(&request.payload)
            .map_err(|_| JobExecutorError::SubmissionRefused)?;
        let cancelled = Arc::new(AtomicBool::new(false));
        {
            let mut running = self
                .running
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            if running.contains_key(&request.job_id) {
                return Err(JobExecutorError::SubmissionRefused);
            }
            running.insert(request.job_id.clone(), Arc::clone(&cancelled));
        }
        let job_id = request.job_id.clone();
        let host = host.clone();
        let callable = callable.clone();
        let packaged_runtime = self.packaged_runtime.clone();
        let running = Arc::clone(&self.running);
        let terminal_callback_failed = Arc::clone(&self.terminal_callback_failed);
        std::thread::spawn(move || {
            let outcome = run_scientific_process(
                &host,
                &callable,
                packaged_runtime.as_ref(),
                &encoded,
                &cancelled,
            );
            running
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .remove(&job_id);
            let callback = match outcome {
                Ok(result) => terminal.complete(&job_id, result),
                Err(ScientificCpythonUnavailable::Cancelled) => {
                    terminal.acknowledge_cancel(&job_id)
                }
                Err(error) => terminal.fail(&job_id, error.reason()),
            };
            if callback.is_err() {
                terminal_callback_failed.store(true, Ordering::Release);
            }
        });
        Ok(())
    }

    fn request_cooperative_cancel(&self, job_id: &str) -> Result<(), JobExecutorError> {
        let cancelled = {
            let running = self
                .running
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            running
                .get(job_id)
                .cloned()
                .ok_or(JobExecutorError::CancellationRefused)?
        };
        cancelled.store(true, Ordering::Release);
        Ok(())
    }
}

fn acquire_host(
    path: &Path,
    site_packages: Option<&Path>,
) -> Result<(HostIdentity, Option<HostIdentity>), ScientificCpythonUnavailable> {
    let identity = host_identity(path)?;
    let output = run_preflight(&identity.canonical_path, site_packages)?;
    let response: Value = serde_json::from_slice(&output)
        .map_err(|_| ScientificCpythonUnavailable::MalformedResponse)?;
    let object = response
        .as_object()
        .ok_or(ScientificCpythonUnavailable::MalformedResponse)?;
    if object.len() != 18
        || object.get("schema").and_then(Value::as_str)
            != Some("nirs4all.studio-scientific-cpython-host.v1")
        || object.get("callable").and_then(Value::as_str)
            != Some("nirs4all.studio_scientific_job_v1")
        || object.get("network_ownership").and_then(Value::as_str) != Some("forbidden")
        || !object.get("distribution_error").is_some_and(Value::is_null)
    {
        return Err(ScientificCpythonUnavailable::MalformedResponse);
    }
    if object.get("distribution").and_then(Value::as_str) != Some("nirs4all")
        || object.get("distribution_version").and_then(Value::as_str)
            != Some(SCIENTIFIC_DISTRIBUTION_VERSION)
        || object
            .get("distribution_manifest_sha256")
            .and_then(Value::as_str)
            != Some(SCIENTIFIC_DISTRIBUTION_MANIFEST_SHA256)
        || !object
            .get("distribution_record_sha256")
            .and_then(Value::as_str)
            .is_some_and(valid_lower_sha256)
        || object
            .get("distribution_files_verified")
            .and_then(Value::as_bool)
            != Some(true)
        || object.get("selected_wheel_sha256").and_then(Value::as_str)
            != Some(SCIENTIFIC_WHEEL_SHA256)
        || object.get("source_commit").and_then(Value::as_str) != Some(SCIENTIFIC_SOURCE_COMMIT)
    {
        return Err(ScientificCpythonUnavailable::DistributionTampered);
    }
    if object.get("implementation").and_then(Value::as_str) != Some("cpython") {
        return Err(ScientificCpythonUnavailable::NotCpython);
    }
    let version = object
        .get("version")
        .and_then(Value::as_array)
        .ok_or(ScientificCpythonUnavailable::MalformedResponse)?;
    if version.len() != 3 || !version.iter().all(Value::is_u64) {
        return Err(ScientificCpythonUnavailable::MalformedResponse);
    }
    let major = version[0]
        .as_u64()
        .ok_or(ScientificCpythonUnavailable::MalformedResponse)?;
    let minor = version[1]
        .as_u64()
        .ok_or(ScientificCpythonUnavailable::MalformedResponse)?;
    if major != 3 || minor < 11 {
        return Err(ScientificCpythonUnavailable::UnsupportedPythonVersion);
    }
    if object.get("isolated").and_then(Value::as_bool) != Some(true) {
        return Err(ScientificCpythonUnavailable::IsolationDisabled);
    }
    if object.get("network_bind_denied").and_then(Value::as_bool) != Some(true) {
        return Err(ScientificCpythonUnavailable::NetworkGuardFailed);
    }
    let ready = object
        .get("ready")
        .and_then(Value::as_bool)
        .ok_or(ScientificCpythonUnavailable::MalformedResponse)?;
    let callable_identity = if ready {
        let callable_path = object
            .get("callable_path")
            .and_then(Value::as_str)
            .ok_or(ScientificCpythonUnavailable::MalformedResponse)?;
        let expected_digest = object
            .get("callable_sha256")
            .and_then(Value::as_str)
            .ok_or(ScientificCpythonUnavailable::MalformedResponse)?;
        if expected_digest != SCIENTIFIC_CALLABLE_SHA256 {
            return Err(ScientificCpythonUnavailable::CallableTampered);
        }
        let callable_identity =
            host_identity_with_limit(Path::new(callable_path), MAX_SCIENTIFIC_CPYTHON_HOST_BYTES)?;
        if hex_digest(&callable_identity.sha256) != expected_digest {
            return Err(ScientificCpythonUnavailable::CallableTampered);
        }
        Some(callable_identity)
    } else {
        if !object.get("callable_path").is_some_and(Value::is_null)
            || !object.get("callable_sha256").is_some_and(Value::is_null)
        {
            return Err(ScientificCpythonUnavailable::MalformedResponse);
        }
        None
    };
    Ok((identity, callable_identity))
}

fn valid_lower_sha256(digest: &str) -> bool {
    digest.len() == 64
        && digest
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn host_identity(path: &Path) -> Result<HostIdentity, ScientificCpythonUnavailable> {
    let metadata =
        fs::symlink_metadata(path).map_err(|_| ScientificCpythonUnavailable::HostUnavailable)?;
    if metadata.file_type().is_symlink() {
        return Err(ScientificCpythonUnavailable::HostSymlinkUnsupported);
    }
    host_identity_with_limit(path, MAX_SCIENTIFIC_CPYTHON_HOST_BYTES)
}

fn packaged_runtime_identity(
    host: &Path,
    closure: &Path,
    runtime_root: &Path,
    site_packages: &Path,
) -> Result<PackagedRuntimeIdentity, ScientificCpythonUnavailable> {
    let runtime_root_path = absolute_path(runtime_root)?;
    let package_root = runtime_root_path
        .parent()
        .ok_or(ScientificCpythonUnavailable::RuntimeContractUnavailable)?;
    let host_path = absolute_path(host)?;
    let closure_path = absolute_path(closure)?;
    let site_packages_path = absolute_path(site_packages)?;
    reject_symlink_below(package_root, &runtime_root_path)?;
    reject_symlink_below(package_root, &host_path)?;
    reject_symlink_below(package_root, &closure_path)?;
    reject_symlink_below(package_root, &site_packages_path)?;
    let runtime_root = runtime_root_path
        .canonicalize()
        .map_err(|_| ScientificCpythonUnavailable::RuntimeContractUnavailable)?;
    let runtime_metadata = fs::metadata(&runtime_root)
        .map_err(|_| ScientificCpythonUnavailable::RuntimeContractUnavailable)?;
    if !runtime_metadata.is_dir() {
        return Err(ScientificCpythonUnavailable::RuntimeContractUnavailable);
    }
    let site_packages = site_packages_path
        .canonicalize()
        .map_err(|_| ScientificCpythonUnavailable::RuntimeContractUnavailable)?;
    let site_metadata = fs::metadata(&site_packages)
        .map_err(|_| ScientificCpythonUnavailable::RuntimeContractUnavailable)?;
    let host = host_path
        .canonicalize()
        .map_err(|_| ScientificCpythonUnavailable::RuntimeContractUnavailable)?;
    let closure = host_identity_with_limit(&closure_path, 32 * 1024 * 1024)
        .map_err(|_| ScientificCpythonUnavailable::RuntimeContractUnavailable)?;
    if !site_metadata.is_dir()
        || !site_packages.starts_with(&runtime_root)
        || !host.starts_with(&runtime_root)
        || closure.canonical_path.parent() != runtime_root.parent()
        || runtime_root.file_name().and_then(std::ffi::OsStr::to_str) != Some("python")
        || runtime_root
            .parent()
            .and_then(Path::file_name)
            .and_then(std::ffi::OsStr::to_str)
            != Some("python-runtime")
        || closure
            .canonical_path
            .file_name()
            .and_then(std::ffi::OsStr::to_str)
            != Some("PYTHON_PLUGIN_CLOSURE.json")
    {
        return Err(ScientificCpythonUnavailable::RuntimeContractUnavailable);
    }
    let (directories, files) = parse_runtime_closure(&closure, &runtime_root, &site_packages)?;
    let identity = PackagedRuntimeIdentity {
        runtime_root,
        site_packages,
        closure,
        directories,
        files,
    };
    verify_packaged_runtime_identity(&identity)?;
    Ok(identity)
}

fn parse_runtime_closure(
    closure: &HostIdentity,
    runtime_root: &Path,
    site_packages: &Path,
) -> Result<(Vec<String>, Vec<RuntimeClosureFile>), ScientificCpythonUnavailable> {
    let encoded = fs::read(&closure.canonical_path)
        .map_err(|_| ScientificCpythonUnavailable::RuntimeContractUnavailable)?;
    let value: Value = serde_json::from_slice(&encoded)
        .map_err(|_| ScientificCpythonUnavailable::RuntimeContractTampered)?;
    let object = value
        .as_object()
        .ok_or(ScientificCpythonUnavailable::RuntimeContractTampered)?;
    let backend_root = runtime_root
        .parent()
        .and_then(Path::parent)
        .ok_or(ScientificCpythonUnavailable::RuntimeContractUnavailable)?;
    let site_packages_relative = manifest_relative_path(
        site_packages
            .strip_prefix(backend_root)
            .map_err(|_| ScientificCpythonUnavailable::RuntimeContractUnavailable)?,
    )?;
    if object.len() != 5
        || object.get("schema").and_then(Value::as_str)
            != Some("nirs4all.studio-python-plugin-closure.v1")
        || object.get("root").and_then(Value::as_str) != Some("python-runtime/python")
        || object.get("site_packages").and_then(Value::as_str)
            != Some(site_packages_relative.as_str())
    {
        return Err(ScientificCpythonUnavailable::RuntimeContractTampered);
    }
    let directories = object
        .get("directories")
        .and_then(Value::as_array)
        .ok_or(ScientificCpythonUnavailable::RuntimeContractTampered)?;
    let files = object
        .get("files")
        .and_then(Value::as_array)
        .ok_or(ScientificCpythonUnavailable::RuntimeContractTampered)?;
    if directories.is_empty()
        || directories.len() > 100_000
        || files.is_empty()
        || files.len() > 100_000
    {
        return Err(ScientificCpythonUnavailable::RuntimeContractTampered);
    }
    let directories = directories
        .iter()
        .map(|entry| {
            let relative = entry
                .as_str()
                .ok_or(ScientificCpythonUnavailable::RuntimeContractTampered)?;
            validate_manifest_path(relative, true)?;
            Ok(relative.to_owned())
        })
        .collect::<Result<Vec<_>, ScientificCpythonUnavailable>>()?;
    if directories.windows(2).any(|pair| pair[0] >= pair[1]) || !directories[0].is_empty() {
        return Err(ScientificCpythonUnavailable::RuntimeContractTampered);
    }
    let files = files
        .iter()
        .map(parse_runtime_closure_file)
        .collect::<Result<Vec<_>, ScientificCpythonUnavailable>>()?;
    if files
        .windows(2)
        .any(|pair| pair[0].relative_path >= pair[1].relative_path)
    {
        return Err(ScientificCpythonUnavailable::RuntimeContractTampered);
    }
    Ok((directories, files))
}

fn parse_runtime_closure_file(
    value: &Value,
) -> Result<RuntimeClosureFile, ScientificCpythonUnavailable> {
    let object = value
        .as_object()
        .ok_or(ScientificCpythonUnavailable::RuntimeContractTampered)?;
    let relative_path = object
        .get("path")
        .and_then(Value::as_str)
        .ok_or(ScientificCpythonUnavailable::RuntimeContractTampered)?;
    let size = object
        .get("size")
        .and_then(Value::as_u64)
        .ok_or(ScientificCpythonUnavailable::RuntimeContractTampered)?;
    let digest = object
        .get("sha256")
        .and_then(Value::as_str)
        .ok_or(ScientificCpythonUnavailable::RuntimeContractTampered)?;
    if object.len() != 3 {
        return Err(ScientificCpythonUnavailable::RuntimeContractTampered);
    }
    validate_manifest_path(relative_path, false)?;
    Ok(RuntimeClosureFile {
        relative_path: relative_path.to_owned(),
        size,
        sha256: parse_hex_digest(digest)?,
    })
}

fn validate_manifest_path(
    relative: &str,
    allow_root: bool,
) -> Result<(), ScientificCpythonUnavailable> {
    if (relative.is_empty() && allow_root)
        || (!relative.is_empty()
            && !relative.starts_with('/')
            && !relative.contains('\\')
            && relative
                .split('/')
                .all(|component| !component.is_empty() && component != "." && component != ".."))
    {
        Ok(())
    } else {
        Err(ScientificCpythonUnavailable::RuntimeContractTampered)
    }
}

fn parse_hex_digest(digest: &str) -> Result<[u8; 32], ScientificCpythonUnavailable> {
    if digest.len() != 64 || !digest.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(ScientificCpythonUnavailable::RuntimeContractTampered);
    }
    let mut decoded = [0_u8; 32];
    for (index, chunk) in digest.as_bytes().chunks_exact(2).enumerate() {
        decoded[index] = (hex_nibble(chunk[0])? << 4) | hex_nibble(chunk[1])?;
    }
    Ok(decoded)
}

const fn hex_nibble(byte: u8) -> Result<u8, ScientificCpythonUnavailable> {
    match byte {
        b'0'..=b'9' => Ok(byte - b'0'),
        b'a'..=b'f' => Ok(byte - b'a' + 10),
        _ => Err(ScientificCpythonUnavailable::RuntimeContractTampered),
    }
}

fn manifest_relative_path(path: &Path) -> Result<String, ScientificCpythonUnavailable> {
    let mut parts = Vec::new();
    for component in path.components() {
        let std::path::Component::Normal(part) = component else {
            return Err(ScientificCpythonUnavailable::RuntimeContractTampered);
        };
        parts.push(
            part.to_str()
                .ok_or(ScientificCpythonUnavailable::RuntimeContractTampered)?,
        );
    }
    Ok(parts.join("/"))
}

fn absolute_path(path: &Path) -> Result<PathBuf, ScientificCpythonUnavailable> {
    if path.is_absolute() {
        Ok(path.to_path_buf())
    } else {
        Ok(std::env::current_dir()
            .map_err(|_| ScientificCpythonUnavailable::RuntimeContractUnavailable)?
            .join(path))
    }
}

fn reject_symlink_below(boundary: &Path, path: &Path) -> Result<(), ScientificCpythonUnavailable> {
    let relative = path
        .strip_prefix(boundary)
        .map_err(|_| ScientificCpythonUnavailable::RuntimeContractUnavailable)?;
    let mut current = boundary.to_path_buf();
    for component in relative.components() {
        match component {
            std::path::Component::Normal(_) => current.push(component),
            std::path::Component::CurDir => continue,
            _ => return Err(ScientificCpythonUnavailable::RuntimeContractTampered),
        }
        let metadata = fs::symlink_metadata(&current)
            .map_err(|_| ScientificCpythonUnavailable::RuntimeContractUnavailable)?;
        if metadata.file_type().is_symlink() {
            return Err(ScientificCpythonUnavailable::RuntimeContractTampered);
        }
    }
    let boundary_metadata = fs::symlink_metadata(boundary)
        .map_err(|_| ScientificCpythonUnavailable::RuntimeContractUnavailable)?;
    if boundary_metadata.file_type().is_symlink() || !boundary_metadata.is_dir() {
        return Err(ScientificCpythonUnavailable::RuntimeContractTampered);
    }
    Ok(())
}

fn canonical_directory_identity(path: &Path) -> Result<PathBuf, ScientificCpythonUnavailable> {
    let metadata = fs::symlink_metadata(path)
        .map_err(|_| ScientificCpythonUnavailable::RuntimeContractTampered)?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(ScientificCpythonUnavailable::RuntimeContractTampered);
    }
    path.canonicalize()
        .map_err(|_| ScientificCpythonUnavailable::RuntimeContractTampered)
}

fn verify_packaged_runtime_identity(
    identity: &PackagedRuntimeIdentity,
) -> Result<(), ScientificCpythonUnavailable> {
    verify_packaged_runtime_anchor(identity)?;
    let (directories, files) = collect_runtime_inventory(&identity.runtime_root)?;
    if directories != identity.directories || files != identity.files {
        return Err(ScientificCpythonUnavailable::RuntimeContractTampered);
    }
    Ok(())
}

fn verify_packaged_runtime_anchor(
    identity: &PackagedRuntimeIdentity,
) -> Result<(), ScientificCpythonUnavailable> {
    let runtime_root = canonical_directory_identity(&identity.runtime_root)?;
    let site_packages = canonical_directory_identity(&identity.site_packages)?;
    let closure_metadata = fs::symlink_metadata(&identity.closure.canonical_path)
        .map_err(|_| ScientificCpythonUnavailable::RuntimeContractTampered)?;
    if runtime_root != identity.runtime_root
        || site_packages != identity.site_packages
        || closure_metadata.file_type().is_symlink()
        || !closure_metadata.is_file()
        || !site_packages.starts_with(&runtime_root)
    {
        return Err(ScientificCpythonUnavailable::RuntimeContractTampered);
    }
    verify_identity(&identity.closure)
        .map_err(|_| ScientificCpythonUnavailable::RuntimeContractTampered)
}

fn collect_runtime_inventory(
    runtime_root: &Path,
) -> Result<(Vec<String>, Vec<RuntimeClosureFile>), ScientificCpythonUnavailable> {
    let mut pending = vec![runtime_root.to_path_buf()];
    let mut directories = Vec::new();
    let mut files = Vec::new();
    while let Some(directory) = pending.pop() {
        let relative = directory
            .strip_prefix(runtime_root)
            .map_err(|_| ScientificCpythonUnavailable::RuntimeContractTampered)?;
        directories.push(manifest_relative_path(relative)?);
        let entries = fs::read_dir(&directory)
            .map_err(|_| ScientificCpythonUnavailable::RuntimeContractTampered)?;
        for entry in entries {
            let entry = entry.map_err(|_| ScientificCpythonUnavailable::RuntimeContractTampered)?;
            let path = entry.path();
            let metadata = fs::symlink_metadata(&path)
                .map_err(|_| ScientificCpythonUnavailable::RuntimeContractTampered)?;
            if metadata.file_type().is_symlink() {
                return Err(ScientificCpythonUnavailable::RuntimeContractTampered);
            }
            if metadata.is_dir() {
                if directories.len() + pending.len() >= 100_000 {
                    return Err(ScientificCpythonUnavailable::RuntimeContractTampered);
                }
                pending.push(path);
            } else if metadata.is_file() {
                if files.len() >= 100_000 {
                    return Err(ScientificCpythonUnavailable::RuntimeContractTampered);
                }
                let relative = path
                    .strip_prefix(runtime_root)
                    .map_err(|_| ScientificCpythonUnavailable::RuntimeContractTampered)?;
                files.push(RuntimeClosureFile {
                    relative_path: manifest_relative_path(relative)?,
                    size: metadata.len(),
                    sha256: hash_file(&path)
                        .map_err(|_| ScientificCpythonUnavailable::RuntimeContractTampered)?,
                });
            } else {
                return Err(ScientificCpythonUnavailable::RuntimeContractTampered);
            }
        }
    }
    directories.sort();
    files.sort_by(|left, right| left.relative_path.cmp(&right.relative_path));
    Ok((directories, files))
}

fn host_identity_with_limit(
    path: &Path,
    maximum_bytes: u64,
) -> Result<HostIdentity, ScientificCpythonUnavailable> {
    let canonical_path = path
        .canonicalize()
        .map_err(|_| ScientificCpythonUnavailable::HostUnavailable)?;
    let metadata =
        fs::metadata(&canonical_path).map_err(|_| ScientificCpythonUnavailable::HostUnavailable)?;
    if !metadata.is_file() || metadata.len() == 0 {
        return Err(ScientificCpythonUnavailable::HostUnavailable);
    }
    if metadata.len() > maximum_bytes {
        return Err(ScientificCpythonUnavailable::HostTooLarge);
    }
    let sha256 = hash_file(&canonical_path)?;
    Ok(HostIdentity {
        canonical_path,
        size: metadata.len(),
        sha256,
    })
}

fn hex_digest(digest: &[u8; 32]) -> String {
    use std::fmt::Write as _;

    digest
        .iter()
        .fold(String::with_capacity(64), |mut hex, byte| {
            write!(&mut hex, "{byte:02x}").expect("writing to String cannot fail");
            hex
        })
}

fn verify_identity(identity: &HostIdentity) -> Result<(), ScientificCpythonUnavailable> {
    let metadata = fs::metadata(&identity.canonical_path)
        .map_err(|_| ScientificCpythonUnavailable::HostTampered)?;
    if !metadata.is_file()
        || metadata.len() != identity.size
        || hash_file(&identity.canonical_path)
            .map_err(|_| ScientificCpythonUnavailable::HostTampered)?
            != identity.sha256
    {
        return Err(ScientificCpythonUnavailable::HostTampered);
    }
    Ok(())
}

fn hash_file(path: &Path) -> Result<[u8; 32], ScientificCpythonUnavailable> {
    let mut file = File::open(path).map_err(|_| ScientificCpythonUnavailable::HostUnavailable)?;
    let mut digest = Sha256::new();
    let mut buffer = [0_u8; 8 * 1024];
    loop {
        let count = file
            .read(&mut buffer)
            .map_err(|_| ScientificCpythonUnavailable::HostUnavailable)?;
        if count == 0 {
            break;
        }
        digest.update(&buffer[..count]);
    }
    Ok(digest.finalize().into())
}

fn run_preflight(
    path: &Path,
    site_packages: Option<&Path>,
) -> Result<Vec<u8>, ScientificCpythonUnavailable> {
    let scratch = ScratchDirectory::create()?;
    let mut command = Command::new(path);
    let isolated_packaged = site_packages.is_some();
    let site_packages = site_packages
        .and_then(Path::to_str)
        .ok_or(ScientificCpythonUnavailable::RuntimeContractUnavailable)
        .or_else(|error| {
            if site_packages.is_none() {
                Ok("")
            } else {
                Err(error)
            }
        })?;
    if isolated_packaged {
        command.args(["-I", "-S", "-B", "-c", PREFLIGHT_SCRIPT, site_packages]);
    } else {
        command.args(["-I", "-B", "-c", PREFLIGHT_SCRIPT, site_packages]);
    }
    command
        .env_clear()
        .env("PYTHONDONTWRITEBYTECODE", "1")
        .env("PYTHONNOUSERSITE", "1")
        .env("TMPDIR", &scratch.path)
        .env("TMP", &scratch.path)
        .env("TEMP", &scratch.path)
        .current_dir(&scratch.path)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    run_configured_process(
        command,
        SCIENTIFIC_CPYTHON_PREFLIGHT_TIMEOUT,
        MAX_SCIENTIFIC_CPYTHON_STDOUT_BYTES,
        MAX_SCIENTIFIC_CPYTHON_STDERR_BYTES,
    )
}

#[cfg(test)]
fn run_process(
    path: &Path,
    script: &str,
    timeout: Duration,
    stdout_limit: usize,
    stderr_limit: usize,
) -> Result<Vec<u8>, ScientificCpythonUnavailable> {
    let scratch = ScratchDirectory::create()?;
    let mut command = Command::new(path);
    command
        .args(["-I", "-S", "-B", "-c", script])
        .env_clear()
        .env("PYTHONDONTWRITEBYTECODE", "1")
        .env("PYTHONNOUSERSITE", "1")
        .env("TMPDIR", &scratch.path)
        .env("TMP", &scratch.path)
        .env("TEMP", &scratch.path)
        .current_dir(&scratch.path)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    run_configured_process(command, timeout, stdout_limit, stderr_limit)
}

fn run_configured_process(
    mut command: Command,
    timeout: Duration,
    stdout_limit: usize,
    stderr_limit: usize,
) -> Result<Vec<u8>, ScientificCpythonUnavailable> {
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    let mut child = command
        .spawn()
        .map_err(|_| ScientificCpythonUnavailable::SpawnFailed)?;
    let (Some(stdout), Some(stderr)) = (child.stdout.take(), child.stderr.take()) else {
        let _ = terminate_worker(&mut child);
        return Err(ScientificCpythonUnavailable::OutputReadFailed);
    };
    let stdout_reader = std::thread::spawn(move || read_bounded(stdout, stdout_limit));
    let stderr_reader = std::thread::spawn(move || read_bounded(stderr, stderr_limit));
    let started_at = Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if started_at.elapsed() >= timeout => {
                let _ = terminate_worker(&mut child);
                return Err(ScientificCpythonUnavailable::TimedOut);
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(10)),
            Err(_) => {
                let _ = terminate_worker(&mut child);
                return Err(ScientificCpythonUnavailable::ProcessFailed);
            }
        }
    };
    let (stdout, stdout_exceeded) = join_reader(stdout_reader)?;
    let (_, stderr_exceeded) = join_reader(stderr_reader)?;
    if stdout_exceeded {
        return Err(ScientificCpythonUnavailable::StdoutTooLarge);
    }
    if stderr_exceeded {
        return Err(ScientificCpythonUnavailable::StderrTooLarge);
    }
    if !status.success() {
        return Err(ScientificCpythonUnavailable::ProcessFailed);
    }
    Ok(stdout)
}

fn run_scientific_process(
    host: &HostIdentity,
    callable: &HostIdentity,
    packaged_runtime: Option<&PackagedRuntimeIdentity>,
    input: &[u8],
    cancelled: &AtomicBool,
) -> Result<Value, ScientificCpythonUnavailable> {
    run_scientific_process_with_timeout(
        host,
        callable,
        packaged_runtime,
        input,
        cancelled,
        SCIENTIFIC_CPYTHON_EXECUTION_TIMEOUT,
    )
}

fn run_scientific_process_with_timeout(
    host: &HostIdentity,
    callable: &HostIdentity,
    packaged_runtime: Option<&PackagedRuntimeIdentity>,
    input: &[u8],
    cancelled: &AtomicBool,
    execution_timeout: Duration,
) -> Result<Value, ScientificCpythonUnavailable> {
    verify_identity(host)?;
    verify_identity(callable).map_err(|_| ScientificCpythonUnavailable::CallableTampered)?;
    if let Some(identity) = packaged_runtime {
        verify_packaged_runtime_identity(identity)?;
    }
    if input.len() > MAX_SCIENTIFIC_CPYTHON_STDIN_BYTES {
        return Err(ScientificCpythonUnavailable::InvalidRequest);
    }
    let expected_job_id = serde_json::from_slice::<Value>(input)
        .ok()
        .and_then(|request| {
            request
                .get("job_id")
                .and_then(Value::as_str)
                .map(str::to_owned)
        })
        .ok_or(ScientificCpythonUnavailable::InvalidRequest)?;
    let scratch = ScratchDirectory::create()?;
    let site_packages = packaged_runtime.map(|identity| identity.site_packages.as_path());
    let mut command = scientific_worker_command(host, callable, site_packages, &scratch.path)?;
    let mut child = command
        .spawn()
        .map_err(|_| ScientificCpythonUnavailable::SpawnFailed)?;
    if let Some(identity) = packaged_runtime {
        if let Err(error) = verify_packaged_runtime_identity(identity) {
            let _ = terminate_worker(&mut child);
            return Err(error);
        }
    }
    let (Some(mut stdin), Some(stdout), Some(stderr)) =
        (child.stdin.take(), child.stdout.take(), child.stderr.take())
    else {
        let _ = child.kill();
        let _ = child.wait();
        return Err(ScientificCpythonUnavailable::OutputReadFailed);
    };
    let input = input.to_vec();
    let stdin_writer = std::thread::spawn(move || stdin.write_all(&input));
    let stdout_reader =
        std::thread::spawn(move || read_bounded(stdout, MAX_SCIENTIFIC_CPYTHON_STDOUT_BYTES));
    let stderr_reader =
        std::thread::spawn(move || read_bounded(stderr, MAX_SCIENTIFIC_CPYTHON_STDERR_BYTES));
    let (status, cancellation_observed, timed_out) =
        wait_for_worker(&mut child, cancelled, execution_timeout)?;
    if let Some(identity) = packaged_runtime {
        verify_packaged_runtime_identity(identity)?;
    }
    let stdin_result = stdin_writer
        .join()
        .map_err(|_| ScientificCpythonUnavailable::ProcessFailed)?;
    let (stdout, stdout_exceeded) = join_reader(stdout_reader)?;
    let (_, stderr_exceeded) = join_reader(stderr_reader)?;
    if stdout_exceeded {
        return Err(ScientificCpythonUnavailable::StdoutTooLarge);
    }
    if stderr_exceeded {
        return Err(ScientificCpythonUnavailable::StderrTooLarge);
    }
    if cancellation_observed {
        return Err(ScientificCpythonUnavailable::Cancelled);
    }
    if timed_out {
        return Err(ScientificCpythonUnavailable::TimedOut);
    }
    stdin_result.map_err(|_| ScientificCpythonUnavailable::ProcessFailed)?;
    if !status.success() {
        return Err(ScientificCpythonUnavailable::ProcessFailed);
    }
    let response: Value = serde_json::from_slice(&stdout)
        .map_err(|_| ScientificCpythonUnavailable::MalformedResponse)?;
    validate_scientific_response(&response)?;
    if response.get("job_id").and_then(Value::as_str) != Some(&expected_job_id) {
        return Err(ScientificCpythonUnavailable::MalformedResponse);
    }
    // Dag-ML may use an internal temporary file. It is permitted only because
    // cwd and every standard temporary-directory variable point at this
    // Rust-created 0700 directory. Successful execution includes synchronous
    // removal and verification; Drop remains the error-path fallback.
    scratch.cleanup()?;
    Ok(response)
}

fn scientific_worker_command(
    host: &HostIdentity,
    callable: &HostIdentity,
    site_packages: Option<&Path>,
    scratch: &Path,
) -> Result<Command, ScientificCpythonUnavailable> {
    let mut command = Command::new(&host.canonical_path);
    let isolated_packaged = site_packages.is_some();
    let site_packages = site_packages
        .and_then(Path::to_str)
        .ok_or(ScientificCpythonUnavailable::RuntimeContractUnavailable)
        .or_else(|error| {
            if site_packages.is_none() {
                Ok("")
            } else {
                Err(error)
            }
        })?;
    let callable_path = callable
        .canonical_path
        .to_str()
        .ok_or(ScientificCpythonUnavailable::CallableTampered)?;
    let callable_digest = hex_digest(&callable.sha256);
    if isolated_packaged {
        command.args([
            "-I",
            "-S",
            "-B",
            "-c",
            EXECUTION_SCRIPT,
            site_packages,
            callable_path,
            &callable_digest,
        ]);
    } else {
        command.args([
            "-I",
            "-B",
            "-c",
            EXECUTION_SCRIPT,
            site_packages,
            callable_path,
            &callable_digest,
        ]);
    }
    command
        .env_clear()
        .env("PYTHONDONTWRITEBYTECODE", "1")
        .env("PYTHONNOUSERSITE", "1")
        .env("N4A_DAGML_INPROCESS", "1")
        .env("TMPDIR", scratch)
        .env("TMP", scratch)
        .env("TEMP", scratch)
        .current_dir(scratch)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    Ok(command)
}

fn wait_for_worker(
    child: &mut std::process::Child,
    cancelled: &AtomicBool,
    execution_timeout: Duration,
) -> Result<(std::process::ExitStatus, bool, bool), ScientificCpythonUnavailable> {
    let started_at = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(status)) => return Ok((status, false, false)),
            Ok(None) if cancelled.load(Ordering::Acquire) => {
                return Ok((terminate_worker(child)?, true, false));
            }
            Ok(None) if started_at.elapsed() >= execution_timeout => {
                return Ok((terminate_worker(child)?, false, true));
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(10)),
            Err(_) => {
                let _ = terminate_worker(child);
                return Err(ScientificCpythonUnavailable::ProcessFailed);
            }
        }
    }
}

fn terminate_worker(
    child: &mut std::process::Child,
) -> Result<std::process::ExitStatus, ScientificCpythonUnavailable> {
    #[cfg(unix)]
    {
        use nix::{
            sys::signal::{killpg, Signal},
            unistd::Pid,
        };
        let process_group = i32::try_from(child.id())
            .map(Pid::from_raw)
            .map_err(|_| ScientificCpythonUnavailable::ProcessFailed)?;
        if let Err(error) = killpg(process_group, Signal::SIGKILL) {
            if error != nix::errno::Errno::ESRCH {
                return Err(ScientificCpythonUnavailable::ProcessFailed);
            }
        }
    }
    #[cfg(not(unix))]
    {
        child
            .kill()
            .map_err(|_| ScientificCpythonUnavailable::ProcessFailed)?;
    }
    child
        .wait()
        .map_err(|_| ScientificCpythonUnavailable::ProcessFailed)
}

#[derive(Debug)]
struct ScratchDirectory {
    path: PathBuf,
}

impl ScratchDirectory {
    fn create() -> Result<Self, ScientificCpythonUnavailable> {
        for attempt in 0_u8..16 {
            let nonce = SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos();
            let path = std::env::temp_dir().join(format!(
                "nirs4all-studio-host-{}-{nonce}-{attempt}",
                std::process::id()
            ));
            #[cfg(unix)]
            let created = {
                use std::os::unix::fs::DirBuilderExt;
                let mut builder = fs::DirBuilder::new();
                builder.mode(0o700).create(&path)
            };
            #[cfg(not(unix))]
            let created = fs::create_dir(&path);
            match created {
                Ok(()) => return Ok(Self { path }),
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
                Err(_) => return Err(ScientificCpythonUnavailable::SpawnFailed),
            }
        }
        Err(ScientificCpythonUnavailable::SpawnFailed)
    }

    fn cleanup(&self) -> Result<(), ScientificCpythonUnavailable> {
        let metadata = fs::symlink_metadata(&self.path)
            .map_err(|_| ScientificCpythonUnavailable::ProcessFailed)?;
        if metadata.file_type().is_symlink() || !metadata.is_dir() {
            return Err(ScientificCpythonUnavailable::ProcessFailed);
        }
        fs::remove_dir_all(&self.path).map_err(|_| ScientificCpythonUnavailable::ProcessFailed)?;
        if self.path.exists() {
            return Err(ScientificCpythonUnavailable::ProcessFailed);
        }
        Ok(())
    }
}

impl Drop for ScratchDirectory {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.path);
    }
}

fn validate_scientific_request(
    request: &Value,
    expected_job_id: &str,
) -> Result<(), ScientificCpythonUnavailable> {
    let root = exact_object(
        request,
        &[
            "schema",
            "operation",
            "job_id",
            "engine",
            "allow_fallback",
            "dataset",
            "pipeline",
            "options",
        ],
    )?;
    if root.get("schema").and_then(Value::as_str) != Some("nirs4all.studio-scientific-job.v1")
        || root.get("operation").and_then(Value::as_str) != Some("run")
        || root.get("job_id").and_then(Value::as_str) != Some(expected_job_id)
        || !valid_identifier(expected_job_id)
        || root.get("engine").and_then(Value::as_str) != Some("dag-ml")
        || root.get("allow_fallback").and_then(Value::as_bool) != Some(false)
    {
        return Err(ScientificCpythonUnavailable::InvalidRequest);
    }
    let (samples, features) = validate_request_dataset(
        root.get("dataset")
            .ok_or(ScientificCpythonUnavailable::InvalidRequest)?,
    )?;
    validate_request_pipeline(
        root.get("pipeline")
            .ok_or(ScientificCpythonUnavailable::InvalidRequest)?,
        samples,
        features,
    )?;
    validate_request_options(
        root.get("options")
            .ok_or(ScientificCpythonUnavailable::InvalidRequest)?,
    )?;
    let encoded =
        serde_json::to_vec(request).map_err(|_| ScientificCpythonUnavailable::InvalidRequest)?;
    if encoded.len() > MAX_SCIENTIFIC_CPYTHON_STDIN_BYTES {
        return Err(ScientificCpythonUnavailable::InvalidRequest);
    }
    Ok(())
}

fn validate_request_dataset(value: &Value) -> Result<(usize, usize), ScientificCpythonUnavailable> {
    let dataset = exact_object(value, &["name", "task_type", "X", "y"])?;
    if !dataset
        .get("name")
        .and_then(Value::as_str)
        .is_some_and(valid_identifier)
        || dataset.get("task_type").and_then(Value::as_str) != Some("regression")
    {
        return Err(ScientificCpythonUnavailable::InvalidRequest);
    }
    let rows = dataset
        .get("X")
        .and_then(Value::as_array)
        .filter(|rows| (4..=128).contains(&rows.len()))
        .ok_or(ScientificCpythonUnavailable::InvalidRequest)?;
    let width = rows
        .first()
        .and_then(Value::as_array)
        .map(Vec::len)
        .filter(|width| (1..=256).contains(width))
        .ok_or(ScientificCpythonUnavailable::InvalidRequest)?;
    if rows.len().saturating_mul(width) > 16_384
        || rows.iter().any(|row| {
            row.as_array().is_none_or(|values| {
                values.len() != width || values.iter().any(|value| !finite_number(value))
            })
        })
    {
        return Err(ScientificCpythonUnavailable::InvalidRequest);
    }
    let targets = dataset
        .get("y")
        .and_then(Value::as_array)
        .filter(|values| values.len() == rows.len())
        .ok_or(ScientificCpythonUnavailable::InvalidRequest)?;
    if targets.iter().any(|value| !finite_number(value)) {
        return Err(ScientificCpythonUnavailable::InvalidRequest);
    }
    Ok((rows.len(), width))
}

fn validate_request_pipeline(
    value: &Value,
    samples: usize,
    features: usize,
) -> Result<(), ScientificCpythonUnavailable> {
    let pipeline = exact_object(
        value,
        &["kind", "n_components", "scale", "cross_validation"],
    )?;
    let components = integer_in(
        pipeline
            .get("n_components")
            .ok_or(ScientificCpythonUnavailable::InvalidRequest)?,
        1,
        256,
    )?;
    if pipeline.get("kind").and_then(Value::as_str) != Some("pls_regression")
        || !pipeline.get("scale").is_some_and(Value::is_boolean)
    {
        return Err(ScientificCpythonUnavailable::InvalidRequest);
    }
    let cv = exact_object(
        pipeline
            .get("cross_validation")
            .ok_or(ScientificCpythonUnavailable::InvalidRequest)?,
        &["kind", "n_splits", "shuffle"],
    )?;
    let splits = integer_in(
        cv.get("n_splits")
            .ok_or(ScientificCpythonUnavailable::InvalidRequest)?,
        2,
        10,
    )?;
    let splits =
        usize::try_from(splits).map_err(|_| ScientificCpythonUnavailable::InvalidRequest)?;
    let smallest_train = samples - samples.div_ceil(splits);
    if cv.get("kind").and_then(Value::as_str) != Some("kfold")
        || !cv.get("shuffle").is_some_and(Value::is_boolean)
        || splits > samples
        || usize::try_from(components)
            .map_or(true, |components| components > features.min(smallest_train))
    {
        return Err(ScientificCpythonUnavailable::InvalidRequest);
    }
    Ok(())
}

fn validate_request_options(value: &Value) -> Result<(), ScientificCpythonUnavailable> {
    let options = exact_object(value, &["name", "random_state"])?;
    if !options
        .get("name")
        .and_then(Value::as_str)
        .is_some_and(valid_identifier)
    {
        return Err(ScientificCpythonUnavailable::InvalidRequest);
    }
    integer_in(
        options
            .get("random_state")
            .ok_or(ScientificCpythonUnavailable::InvalidRequest)?,
        0,
        2_147_483_647,
    )?;
    Ok(())
}

fn validate_scientific_response(response: &Value) -> Result<(), ScientificCpythonUnavailable> {
    let root = exact_object(response, &["schema", "job_id", "engine", "result"])
        .map_err(|_| ScientificCpythonUnavailable::MalformedResponse)?;
    if root.get("schema").and_then(Value::as_str)
        != Some("nirs4all.studio-scientific-job-result.v1")
        || !root
            .get("job_id")
            .and_then(Value::as_str)
            .is_some_and(valid_identifier)
        || root.get("engine").and_then(Value::as_str) != Some("dag-ml")
    {
        return Err(ScientificCpythonUnavailable::MalformedResponse);
    }
    let result = exact_object(
        root.get("result")
            .ok_or(ScientificCpythonUnavailable::MalformedResponse)?,
        &[
            "model",
            "task_type",
            "metric",
            "validation_score",
            "training_score",
            "prediction_count",
        ],
    )
    .map_err(|_| ScientificCpythonUnavailable::MalformedResponse)?;
    if result.get("model").and_then(Value::as_str) != Some("pls_regression")
        || result.get("task_type").and_then(Value::as_str) != Some("regression")
        || !result
            .get("metric")
            .and_then(Value::as_str)
            .is_some_and(|value| {
                !value.is_empty()
                    && value.len() <= 256
                    && !value.bytes().any(|byte| byte.is_ascii_control())
            })
        || !result.get("validation_score").is_some_and(finite_number)
        || !result.get("training_score").is_some_and(finite_number)
        || integer_in(
            result
                .get("prediction_count")
                .ok_or(ScientificCpythonUnavailable::MalformedResponse)?,
            1,
            1_000_000,
        )
        .is_err()
    {
        return Err(ScientificCpythonUnavailable::MalformedResponse);
    }
    Ok(())
}

fn exact_object<'a>(
    value: &'a Value,
    keys: &[&str],
) -> Result<&'a serde_json::Map<String, Value>, ScientificCpythonUnavailable> {
    let object = value
        .as_object()
        .ok_or(ScientificCpythonUnavailable::InvalidRequest)?;
    if object.len() != keys.len() || keys.iter().any(|key| !object.contains_key(*key)) {
        return Err(ScientificCpythonUnavailable::InvalidRequest);
    }
    Ok(object)
}

fn integer_in(
    value: &Value,
    minimum: i64,
    maximum: i64,
) -> Result<i64, ScientificCpythonUnavailable> {
    value
        .as_i64()
        .filter(|number| (minimum..=maximum).contains(number))
        .ok_or(ScientificCpythonUnavailable::InvalidRequest)
}

fn finite_number(value: &Value) -> bool {
    value.as_f64().is_some_and(f64::is_finite)
}

fn valid_identifier(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 256
        && !matches!(value, "." | "..")
        && !value
            .bytes()
            .any(|byte| byte.is_ascii_control() || matches!(byte, b'/' | b'\\'))
}

fn join_reader(
    reader: std::thread::JoinHandle<std::io::Result<(Vec<u8>, bool)>>,
) -> Result<(Vec<u8>, bool), ScientificCpythonUnavailable> {
    reader
        .join()
        .map_err(|_| ScientificCpythonUnavailable::OutputReadFailed)?
        .map_err(|_| ScientificCpythonUnavailable::OutputReadFailed)
}

fn read_bounded(mut reader: impl Read, limit: usize) -> std::io::Result<(Vec<u8>, bool)> {
    let mut retained = Vec::with_capacity(limit.min(64 * 1024));
    let mut buffer = [0_u8; 4096];
    let mut exceeded = false;
    loop {
        let count = reader.read(&mut buffer)?;
        if count == 0 {
            return Ok((retained, exceeded));
        }
        let remaining = limit.saturating_sub(retained.len());
        let copied = remaining.min(count);
        retained.write_all(&buffer[..copied])?;
        exceeded |= copied < count;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{fs, net::TcpListener, time::SystemTime};

    fn test_directory(name: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!(
            "studio-scientific-cpython-{name}-{}-{nonce}",
            std::process::id()
        ))
    }

    #[cfg(unix)]
    fn shell_host(directory: &Path, name: &str, body: &str) -> PathBuf {
        use std::os::unix::fs::PermissionsExt;

        fs::create_dir_all(directory).unwrap();
        let path = directory.join(name);
        fs::write(&path, format!("#!/bin/sh\n{body}\n")).unwrap();
        let mut permissions = fs::metadata(&path).unwrap().permissions();
        permissions.set_mode(0o700);
        fs::set_permissions(&path, permissions).unwrap();
        std::thread::sleep(Duration::from_millis(10));
        path
    }

    fn write_runtime_closure(runtime_root: &Path, site_packages: &Path, closure: &Path) {
        let (directories, files) = collect_runtime_inventory(runtime_root).unwrap();
        let encoded_files = files
            .iter()
            .map(|file| {
                serde_json::json!({
                    "path": file.relative_path,
                    "size": file.size,
                    "sha256": hex_digest(&file.sha256),
                })
            })
            .collect::<Vec<_>>();
        fs::write(
            closure,
            serde_json::to_vec(&serde_json::json!({
                "schema": "nirs4all.studio-python-plugin-closure.v1",
                "root": "python-runtime/python",
                "site_packages": format!(
                    "python-runtime/python/{}",
                    manifest_relative_path(site_packages.strip_prefix(runtime_root).unwrap()).unwrap()
                ),
                "directories": directories,
                "files": encoded_files,
            }))
            .unwrap(),
        )
        .unwrap();
    }

    fn attested_unready_host_response(implementation: &str) -> String {
        format!(
            r#"printf '%s' '{{"callable":"nirs4all.studio_scientific_job_v1","callable_path":null,"callable_sha256":null,"distribution":"nirs4all","distribution_error":null,"distribution_files_verified":true,"distribution_manifest_sha256":"{SCIENTIFIC_DISTRIBUTION_MANIFEST_SHA256}","distribution_record_sha256":"0000000000000000000000000000000000000000000000000000000000000000","distribution_version":"{SCIENTIFIC_DISTRIBUTION_VERSION}","implementation":"{implementation}","isolated":true,"network_bind_denied":true,"network_ownership":"forbidden","ready":false,"schema":"nirs4all.studio-scientific-cpython-host.v1","selected_wheel_sha256":"{SCIENTIFIC_WHEEL_SHA256}","source_commit":"{SCIENTIFIC_SOURCE_COMMIT}","version":[3,11,0]}}'"#
        )
    }

    #[test]
    fn contract_is_honest_about_the_bounded_platform_capability() {
        let contract: Value = serde_json::from_str(SCIENTIFIC_CPYTHON_HOST_CONTRACT).unwrap();
        assert_eq!(
            contract["schema"],
            "nirs4all.studio-scientific-cpython-host.v1"
        );
        assert_eq!(contract["product_owner"], "studio-sidecar-rust");
        assert_eq!(contract["python_role"], "library-plugin-host-only");
        assert_eq!(contract["required_implementation"], "cpython");
        assert_eq!(contract["minimum_python_version"], "3.11");
        assert_eq!(contract["runtime_discovery"], "packaged_contract_only");
        assert_eq!(
            contract["runtime_closure"],
            "exact_path_size_sha256_inventory_without_symlinks_or_special_files"
        );
        assert_eq!(
            contract["python_flags"],
            serde_json::json!(["-I", "-S", "-B"])
        );
        assert_eq!(
            contract["stdlib_gui"],
            "tkinter_and__tkinter_pruned_from_headless_plugin_closure"
        );
        assert_eq!(contract["selected_source_commit"], SCIENTIFIC_SOURCE_COMMIT);
        assert_eq!(contract["selected_wheel_sha256"], SCIENTIFIC_WHEEL_SHA256);
        assert!(contract
            .get("selected_distribution_record_sha256")
            .is_none());
        assert_eq!(
            contract["selected_installed_manifest_sha256"],
            SCIENTIFIC_DISTRIBUTION_MANIFEST_SHA256
        );
        assert_eq!(
            contract["selected_callable_sha256"],
            SCIENTIFIC_CALLABLE_SHA256
        );
        assert_eq!(contract["network_ownership"], "forbidden");
        assert_eq!(contract["network_bind_self_test"], "required");
        assert_eq!(contract["http_backend"], "forbidden");
        assert_eq!(contract["terminal_callback_owner"], "studio-sidecar-rust");
        assert_eq!(contract["execution_bridge_implemented"], true);
        assert_eq!(contract["studio_payload_resolver_implemented"], true);
        assert_eq!(
            contract["scientific_execution_capability"],
            "unix_only_with_exact_host_callable_io_and_saved_slice_preflight"
        );
        assert_eq!(contract["windows_capability"], false);
    }

    #[cfg(unix)]
    #[test]
    fn worker_scratch_is_created_with_private_unix_permissions() {
        use std::os::unix::fs::PermissionsExt;

        let scratch = ScratchDirectory::create().unwrap();
        assert_eq!(
            fs::metadata(&scratch.path).unwrap().permissions().mode() & 0o777,
            0o700
        );
    }

    #[test]
    fn closed_stdio_shapes_reject_workspace_manifest_and_result_extensions() {
        let job_id = "run_native_closed_shape";
        let request = serde_json::json!({
            "schema": "nirs4all.studio-scientific-job.v1",
            "operation": "run",
            "job_id": job_id,
            "engine": "dag-ml",
            "allow_fallback": false,
            "dataset": {
                "name": "closed-shape",
                "task_type": "regression",
                "X": [[0.0], [1.0], [2.0], [3.0]],
                "y": [0.1, 1.2, 2.1, 3.4]
            },
            "pipeline": {
                "kind": "pls_regression",
                "n_components": 1,
                "scale": true,
                "cross_validation": {"kind": "kfold", "n_splits": 2, "shuffle": false}
            },
            "options": {"name": "closed-shape", "random_state": 42}
        });
        validate_scientific_request(&request, job_id).unwrap();
        for forbidden in ["workspace_path", "manifest", "legacyConfig"] {
            let mut invalid = request.clone();
            invalid[forbidden] = Value::String("must-not-cross-stdio".into());
            assert_eq!(
                validate_scientific_request(&invalid, job_id),
                Err(ScientificCpythonUnavailable::InvalidRequest)
            );
        }

        let mut response = serde_json::json!({
            "schema": "nirs4all.studio-scientific-job-result.v1",
            "job_id": job_id,
            "engine": "dag-ml",
            "result": {
                "model": "pls_regression",
                "task_type": "regression",
                "metric": "rmse",
                "validation_score": 0.25,
                "training_score": 0.125,
                "prediction_count": 4
            }
        });
        validate_scientific_response(&response).unwrap();
        response["workspace"] = serde_json::json!({"path": "/forbidden"});
        assert_eq!(
            validate_scientific_response(&response),
            Err(ScientificCpythonUnavailable::MalformedResponse)
        );
    }

    #[cfg(unix)]
    #[test]
    fn acquisition_is_sticky_and_detects_later_host_tamper() {
        let root = test_directory("identity");
        let missing = root.join("missing-python");
        let unavailable = CpythonScientificJobExecutor::acquire(&missing);
        assert_eq!(unavailable.unavailable_reason(), "python_host_unavailable");
        let valid_json = attested_unready_host_response("cpython");
        let host = shell_host(&root, "python-host", &valid_json);
        fs::rename(&host, &missing).unwrap();
        assert_eq!(unavailable.unavailable_reason(), "python_host_unavailable");

        let acquired = CpythonScientificJobExecutor::acquire(&missing);
        assert_eq!(
            acquired.unavailable_reason(),
            "scientific_callable_unavailable"
        );
        fs::write(&missing, "tampered-host").unwrap();
        assert_eq!(acquired.unavailable_reason(), "python_host_tampered");
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn packaged_runtime_contract_is_adjacent_sticky_and_symlink_closed() {
        let root = test_directory("packaged-runtime");
        let runtime = root.join("python-runtime");
        let python_root = runtime.join("python");
        let site_packages = python_root.join("lib/python3.11/site-packages");
        fs::create_dir_all(&site_packages).unwrap();
        let valid_json = attested_unready_host_response("cpython");
        let host = shell_host(&python_root.join("bin"), "python3", &valid_json);
        let package_member = site_packages.join("attested_plugin.py");
        fs::write(&package_member, "ATTESTED = True\n").unwrap();
        let closure = runtime.join("PYTHON_PLUGIN_CLOSURE.json");
        write_runtime_closure(&python_root, &site_packages, &closure);
        let acquired = CpythonScientificJobExecutor::acquire_packaged_with_config_dir(
            &host,
            &closure,
            &python_root,
            &site_packages,
            root.join("config"),
        );
        assert_eq!(
            acquired.unavailable_reason(),
            "scientific_callable_unavailable"
        );
        fs::write(&package_member, "ATTESTED = False\n").unwrap();
        assert_eq!(
            verify_packaged_runtime_identity(acquired.packaged_runtime.as_ref().unwrap()),
            Err(ScientificCpythonUnavailable::RuntimeContractTampered)
        );
        fs::write(&package_member, "ATTESTED = True\n").unwrap();
        fs::write(&closure, "tampered-closure").unwrap();
        assert_eq!(
            acquired.unavailable_reason(),
            "python_runtime_contract_tampered"
        );

        let absent = CpythonScientificJobExecutor::acquire_packaged_with_config_dir(
            &host,
            runtime.join("absent.json"),
            &python_root,
            &site_packages,
            root.join("config"),
        );
        assert_eq!(
            absent.unavailable_reason(),
            "python_runtime_contract_unavailable"
        );

        let outside_site = root.join("outside-site");
        fs::create_dir_all(&outside_site).unwrap();
        fs::remove_dir_all(&site_packages).unwrap();
        std::os::unix::fs::symlink(&outside_site, &site_packages).unwrap();
        let substituted = CpythonScientificJobExecutor::acquire_packaged_with_config_dir(
            &host,
            &closure,
            &python_root,
            &site_packages,
            root.join("config"),
        );
        assert_eq!(
            substituted.unavailable_reason(),
            "python_runtime_contract_tampered"
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn worker_revalidates_runtime_before_spawn_and_after_execution() {
        let root = test_directory("worker-runtime-drift");
        let runtime = root.join("python-runtime");
        let python_root = runtime.join("python");
        let site_packages = python_root.join("lib/python3.11/site-packages");
        fs::create_dir_all(&site_packages).unwrap();
        let host = shell_host(
            &python_root.join("bin"),
            "python3",
            "sleep 0.2; printf '%s' '{\"engine\":\"dag-ml\",\"job_id\":\"drift-job\",\"result\":{\"metric\":\"rmse\",\"model\":\"pls_regression\",\"prediction_count\":4,\"task_type\":\"regression\",\"training_score\":0.1,\"validation_score\":0.2},\"schema\":\"nirs4all.studio-scientific-job-result.v1\"}'",
        );
        let callable_path = site_packages.join("studio_scientific.py");
        fs::write(
            &callable_path,
            "def studio_scientific_job_v1(request): pass\n",
        )
        .unwrap();
        let member = site_packages.join("attested_member.py");
        fs::write(&member, "ATTESTED = True\n").unwrap();
        let closure = runtime.join("PYTHON_PLUGIN_CLOSURE.json");
        write_runtime_closure(&python_root, &site_packages, &closure);
        let packaged =
            packaged_runtime_identity(&host, &closure, &python_root, &site_packages).unwrap();
        let acquired_host = host_identity(&host).unwrap();
        let callable_identity = host_identity(&callable_path).unwrap();
        let request = serde_json::to_vec(&serde_json::json!({"job_id": "drift-job"})).unwrap();
        let cancelled = AtomicBool::new(false);

        fs::write(&member, "ATTESTED = False\n").unwrap();
        assert_eq!(
            run_scientific_process_with_timeout(
                &acquired_host,
                &callable_identity,
                Some(&packaged),
                &request,
                &cancelled,
                Duration::from_secs(1),
            ),
            Err(ScientificCpythonUnavailable::RuntimeContractTampered)
        );

        fs::write(&member, "ATTESTED = True\n").unwrap();
        let member_for_thread = member;
        let mutation = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(50));
            fs::write(member_for_thread, "ATTESTED = False\n").unwrap();
        });
        assert_eq!(
            run_scientific_process_with_timeout(
                &acquired_host,
                &callable_identity,
                Some(&packaged),
                &request,
                &cancelled,
                Duration::from_secs(1),
            ),
            Err(ScientificCpythonUnavailable::RuntimeContractTampered)
        );
        mutation.join().unwrap();
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn process_boundary_refuses_timeout_malformed_and_oversized_streams() {
        let root = test_directory("limits");
        let malformed = shell_host(&root, "malformed", "printf nope");
        assert_eq!(
            CpythonScientificJobExecutor::acquire(&malformed).unavailable_reason(),
            "python_host_malformed_response"
        );
        let impostor = shell_host(&root, "impostor", &attested_unready_host_response("pypy"));
        assert_eq!(
            CpythonScientificJobExecutor::acquire(&impostor).unavailable_reason(),
            "python_host_not_cpython"
        );
        let timeout = shell_host(&root, "timeout", "sleep 2");
        assert_eq!(
            run_process(&timeout, "ignored", Duration::from_millis(50), 32, 32),
            Err(ScientificCpythonUnavailable::TimedOut)
        );
        let stdout = shell_host(&root, "stdout", "printf 12345");
        assert_eq!(
            run_process(&stdout, "ignored", Duration::from_secs(1), 4, 32),
            Err(ScientificCpythonUnavailable::StdoutTooLarge)
        );
        let stderr = shell_host(&root, "stderr", "printf 12345 >&2; exit 1");
        assert_eq!(
            run_process(&stderr, "ignored", Duration::from_secs(1), 32, 4),
            Err(ScientificCpythonUnavailable::StderrTooLarge)
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn execution_timeout_and_cancel_remove_worker_temp_roots() {
        let root = test_directory("worker-cleanup");
        fs::create_dir_all(&root).unwrap();
        let callable_path = root.join("callable.py");
        fs::write(
            &callable_path,
            "def studio_scientific_job_v1(value): return value\n",
        )
        .unwrap();
        let callable = host_identity(&callable_path).unwrap();
        let request = br#"{"job_id":"run_native_cleanup"}"#;

        let timeout_witness = root.join("timeout-witness");
        let timeout_host_path = shell_host(
            &root,
            "timeout-worker",
            &format!(
                "printf '%s' \"$TMPDIR\" > '{}'; touch \"$TMPDIR/residue\"; sleep 2",
                timeout_witness.display()
            ),
        );
        let timeout_host = host_identity(&timeout_host_path).unwrap();
        assert_eq!(
            run_scientific_process_with_timeout(
                &timeout_host,
                &callable,
                None,
                request,
                &AtomicBool::new(false),
                Duration::from_millis(50),
            ),
            Err(ScientificCpythonUnavailable::TimedOut)
        );
        let timeout_scratch = PathBuf::from(fs::read_to_string(&timeout_witness).unwrap());
        assert!(!timeout_scratch.exists());

        let cancel_witness = root.join("cancel-witness");
        let cancel_host_path = shell_host(
            &root,
            "cancel-worker",
            &format!(
                "printf '%s' \"$TMPDIR\" > '{}'; touch \"$TMPDIR/residue\"; sleep 2",
                cancel_witness.display()
            ),
        );
        let cancel_host = host_identity(&cancel_host_path).unwrap();
        let cancelled = Arc::new(AtomicBool::new(false));
        let signal = Arc::clone(&cancelled);
        let cancel_thread = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(50));
            signal.store(true, Ordering::Release);
        });
        assert_eq!(
            run_scientific_process_with_timeout(
                &cancel_host,
                &callable,
                None,
                request,
                &cancelled,
                Duration::from_secs(1),
            ),
            Err(ScientificCpythonUnavailable::Cancelled)
        );
        cancel_thread.join().unwrap();
        let cancel_scratch = PathBuf::from(fs::read_to_string(&cancel_witness).unwrap());
        assert!(!cancel_scratch.exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn real_cpython_audit_hook_denies_listener_ownership() {
        let supported = Command::new("sh")
            .args(["-c", "command -v python3.11"])
            .output()
            .unwrap();
        let supported_available = supported.status.success();
        let discovered = if supported_available {
            supported
        } else {
            Command::new("sh")
                .args(["-c", "command -v python3"])
                .output()
                .unwrap()
        };
        if !discovered.status.success() {
            return;
        }
        let python = PathBuf::from(String::from_utf8(discovered.stdout).unwrap().trim());
        let acquired = CpythonScientificJobExecutor::acquire(&python);
        if supported_available {
            assert!(matches!(
                acquired.unavailable_reason(),
                "scientific_callable_unavailable"
                    | "scientific_request_resolver_unavailable"
                    | "scientific_distribution_tampered"
                    | "python_host_malformed_response"
            ));
        } else {
            assert!(matches!(
                acquired.unavailable_reason(),
                "scientific_callable_unavailable"
                    | "scientific_request_resolver_unavailable"
                    | "scientific_distribution_tampered"
                    | "python_host_malformed_response"
                    | "python_host_version_unsupported"
            ));
        }
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        drop(listener);
        let script = format!(
            "import json,socket,sys\n\
             def deny(event,args):\n if event=='socket.bind': raise RuntimeError('denied')\n\
             sys.addaudithook(deny)\n\
             s=socket.socket(); denied=False\n\
             try: s.bind(('127.0.0.1',{}))\n\
             except RuntimeError: denied=True\n\
             print(json.dumps({{'denied':denied}}))\n",
            address.port()
        );
        let output = run_process(&python, &script, Duration::from_secs(2), 1024, 1024).unwrap();
        assert_eq!(
            serde_json::from_slice::<Value>(&output).unwrap(),
            serde_json::json!({"denied": true})
        );
        TcpListener::bind(address).unwrap();

        let http_script = "import http.server,json,sys\n\
            def deny(event,args):\n if event=='socket.bind': raise RuntimeError('denied')\n\
            sys.addaudithook(deny)\n\
            denied=False\n\
            try: http.server.HTTPServer(('127.0.0.1',0),http.server.BaseHTTPRequestHandler)\n\
            except RuntimeError: denied=True\n\
            print(json.dumps({'http_listener_denied':denied}))\n";
        let output = run_process(&python, http_script, Duration::from_secs(2), 1024, 1024).unwrap();
        assert_eq!(
            serde_json::from_slice::<Value>(&output).unwrap(),
            serde_json::json!({"http_listener_denied": true})
        );

        let spawn_script = "import json,os,sys\n\
            def deny(event,args):\n if event in {'subprocess.Popen','os.system','os.spawn','os.posix_spawn','os.fork','os.forkpty','os.exec','pty.spawn'}: raise RuntimeError('denied')\n\
            sys.addaudithook(deny)\n\
            denied=False\n\
            try: os.spawnv(os.P_WAIT,'/bin/true',['true'])\n\
            except RuntimeError: denied=True\n\
            print(json.dumps({'spawnv_denied':denied}))\n";
        let output =
            run_process(&python, spawn_script, Duration::from_secs(2), 1024, 1024).unwrap();
        assert_eq!(
            serde_json::from_slice::<Value>(&output).unwrap(),
            serde_json::json!({"spawnv_denied": true})
        );
    }
}
