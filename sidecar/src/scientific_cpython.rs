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
    JobExecutorError, ScientificExecutionRequest, ScientificJobExecutor, ScientificJobTerminal,
};

pub const SCIENTIFIC_CPYTHON_HOST_CONTRACT: &str =
    include_str!("../contracts/studio_scientific_cpython_host_v1.json");
pub const SCIENTIFIC_CPYTHON_EXECUTOR_ID: &str = "cpython-stdio-v1";
pub const SCIENTIFIC_CPYTHON_PREFLIGHT_TIMEOUT: Duration = Duration::from_secs(5);
pub const SCIENTIFIC_CPYTHON_EXECUTION_TIMEOUT: Duration = Duration::from_secs(120);
pub const MAX_SCIENTIFIC_CPYTHON_STDIN_BYTES: usize = 64 * 1024;
pub const MAX_SCIENTIFIC_CPYTHON_STDOUT_BYTES: usize = 8 * 1024;
pub const MAX_SCIENTIFIC_CPYTHON_STDERR_BYTES: usize = 64 * 1024;
pub const MAX_SCIENTIFIC_CPYTHON_HOST_BYTES: u64 = 64 * 1024 * 1024;

const PREFLIGHT_SCRIPT: &str = r#"import hashlib,inspect,json,socket,sys
SCHEMA="nirs4all.studio-scientific-cpython-host.v1"
def deny_product_network(event,args):
    if event == "socket.bind":
        raise RuntimeError("CPython library host cannot own a listening socket")
    if event in {"subprocess.Popen","os.system","os.posix_spawn"}:
        raise RuntimeError("CPython library host cannot spawn child processes")
sys.addaudithook(deny_product_network)
probe=socket.socket()
bind_denied=False
try:
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
except Exception:
    ready=False
    callable_path=None
    callable_sha256=None
print(json.dumps({"schema":SCHEMA,"callable":"nirs4all.studio_scientific_job_v1","callable_path":callable_path,"callable_sha256":callable_sha256,"ready":ready,"network_ownership":"forbidden","implementation":sys.implementation.name,"version":list(sys.version_info[:3]),"isolated":bool(sys.flags.isolated),"network_bind_denied":bind_denied},separators=(",",":"),sort_keys=True))
"#;

const EXECUTION_SCRIPT: &str = r#"import hashlib,inspect,json,os,socket,sys
def deny_product_network(event,args):
    if event == "socket.bind":
        raise RuntimeError("CPython library host cannot own a listening socket")
    if event in {"subprocess.Popen","os.system","os.posix_spawn"}:
        raise RuntimeError("CPython library host cannot spawn child processes")
sys.addaudithook(deny_product_network)
raw=sys.stdin.buffer.read(65537)
if len(raw)>65536:
    raise RuntimeError("scientific request exceeds stdin budget")
request=json.loads(raw)
import nirs4all
target=getattr(nirs4all,"studio_scientific_job_v1",None)
if not callable(target):
    raise RuntimeError("scientific callable unavailable")
actual_path=os.path.realpath(inspect.getsourcefile(target))
if actual_path != sys.argv[1] or hashlib.sha256(open(actual_path,"rb").read()).hexdigest() != sys.argv[2]:
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
    RequestResolverUnavailable,
    InvalidRequest,
    Cancelled,
}

impl ScientificCpythonUnavailable {
    #[must_use]
    pub const fn reason(self) -> &'static str {
        match self {
            Self::HostUnavailable => "python_host_unavailable",
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
            Self::RequestResolverUnavailable => "scientific_request_resolver_unavailable",
            Self::InvalidRequest => "scientific_request_invalid",
            Self::Cancelled => "scientific_execution_cancelled",
        }
    }
}

#[derive(Clone, Debug)]
struct HostIdentity {
    canonical_path: PathBuf,
    size: u64,
    sha256: [u8; 32],
}

/// Sticky acquisition record for an explicitly selected `CPython` stdio host.
///
/// The execution and Rust-owned terminal callback bridge are implemented. The
/// product remains unselected because its saved run-group payload cannot yet
/// be resolved by an authoritative Rust IO/pipeline adapter into the callable's
/// path-free matrix contract.
#[derive(Debug)]
pub struct CpythonScientificJobExecutor {
    identity: Option<HostIdentity>,
    callable_identity: Option<HostIdentity>,
    acquisition: ScientificCpythonUnavailable,
    running: Arc<Mutex<BTreeMap<String, Arc<AtomicBool>>>>,
}

impl CpythonScientificJobExecutor {
    #[must_use]
    pub fn acquire(path: impl AsRef<Path>) -> Self {
        match acquire_host(path.as_ref()) {
            Ok((identity, callable_identity)) => {
                let callable_ready = callable_identity.is_some();
                Self {
                    identity: Some(identity),
                    callable_identity,
                    acquisition: if callable_ready {
                        ScientificCpythonUnavailable::RequestResolverUnavailable
                    } else {
                        ScientificCpythonUnavailable::CallableUnavailable
                    },
                    running: Arc::new(Mutex::new(BTreeMap::new())),
                }
            }
            Err(error) => Self {
                identity: None,
                callable_identity: None,
                acquisition: error,
                running: Arc::new(Mutex::new(BTreeMap::new())),
            },
        }
    }

    #[must_use]
    pub fn unavailable_reason(&self) -> &'static str {
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
        self.acquisition.reason()
    }
}

impl ScientificJobExecutor for CpythonScientificJobExecutor {
    fn is_selected(&self) -> bool {
        false
    }

    fn unavailability_reason(&self) -> &'static str {
        self.unavailable_reason()
    }

    fn submit_scientific(
        &self,
        request: &ScientificExecutionRequest,
        terminal: Arc<dyn ScientificJobTerminal>,
    ) -> Result<(), JobExecutorError> {
        let (Some(host), Some(callable)) = (&self.identity, &self.callable_identity) else {
            return Err(JobExecutorError::SubmissionRefused);
        };
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
        let running = Arc::clone(&self.running);
        std::thread::spawn(move || {
            let outcome = run_scientific_process(&host, &callable, &encoded, &cancelled);
            running
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .remove(&job_id);
            match outcome {
                Ok(result) => {
                    let _ = terminal.complete(&job_id, result);
                }
                Err(ScientificCpythonUnavailable::Cancelled) => {
                    let _ = terminal.acknowledge_cancel(&job_id);
                }
                Err(error) => {
                    let _ = terminal.fail(&job_id, error.reason());
                }
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
) -> Result<(HostIdentity, Option<HostIdentity>), ScientificCpythonUnavailable> {
    let identity = host_identity(path)?;
    let output = run_preflight(&identity.canonical_path)?;
    let response: Value = serde_json::from_slice(&output)
        .map_err(|_| ScientificCpythonUnavailable::MalformedResponse)?;
    let object = response
        .as_object()
        .ok_or(ScientificCpythonUnavailable::MalformedResponse)?;
    if object.len() != 10
        || object.get("schema").and_then(Value::as_str)
            != Some("nirs4all.studio-scientific-cpython-host.v1")
        || object.get("callable").and_then(Value::as_str)
            != Some("nirs4all.studio_scientific_job_v1")
        || object.get("network_ownership").and_then(Value::as_str) != Some("forbidden")
    {
        return Err(ScientificCpythonUnavailable::MalformedResponse);
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

fn host_identity(path: &Path) -> Result<HostIdentity, ScientificCpythonUnavailable> {
    host_identity_with_limit(path, MAX_SCIENTIFIC_CPYTHON_HOST_BYTES)
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

fn run_preflight(path: &Path) -> Result<Vec<u8>, ScientificCpythonUnavailable> {
    run_process(
        path,
        PREFLIGHT_SCRIPT,
        SCIENTIFIC_CPYTHON_PREFLIGHT_TIMEOUT,
        MAX_SCIENTIFIC_CPYTHON_STDOUT_BYTES,
        MAX_SCIENTIFIC_CPYTHON_STDERR_BYTES,
    )
}

fn run_process(
    path: &Path,
    script: &str,
    timeout: Duration,
    stdout_limit: usize,
    stderr_limit: usize,
) -> Result<Vec<u8>, ScientificCpythonUnavailable> {
    let mut child = Command::new(path)
        .args(["-I", "-c", script])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|_| ScientificCpythonUnavailable::SpawnFailed)?;
    let (Some(stdout), Some(stderr)) = (child.stdout.take(), child.stderr.take()) else {
        let _ = child.kill();
        let _ = child.wait();
        return Err(ScientificCpythonUnavailable::OutputReadFailed);
    };
    let stdout_reader = std::thread::spawn(move || read_bounded(stdout, stdout_limit));
    let stderr_reader = std::thread::spawn(move || read_bounded(stderr, stderr_limit));
    let started_at = Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if started_at.elapsed() >= timeout => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(ScientificCpythonUnavailable::TimedOut);
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(10)),
            Err(_) => {
                let _ = child.kill();
                let _ = child.wait();
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
    input: &[u8],
    cancelled: &AtomicBool,
) -> Result<Value, ScientificCpythonUnavailable> {
    run_scientific_process_with_timeout(
        host,
        callable,
        input,
        cancelled,
        SCIENTIFIC_CPYTHON_EXECUTION_TIMEOUT,
    )
}

fn run_scientific_process_with_timeout(
    host: &HostIdentity,
    callable: &HostIdentity,
    input: &[u8],
    cancelled: &AtomicBool,
    execution_timeout: Duration,
) -> Result<Value, ScientificCpythonUnavailable> {
    verify_identity(host)?;
    verify_identity(callable).map_err(|_| ScientificCpythonUnavailable::CallableTampered)?;
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
    let mut command = Command::new(&host.canonical_path);
    command
        .args([
            "-I",
            "-c",
            EXECUTION_SCRIPT,
            callable
                .canonical_path
                .to_str()
                .ok_or(ScientificCpythonUnavailable::CallableTampered)?,
            &hex_digest(&callable.sha256),
        ])
        .env_clear()
        .env("PYTHONDONTWRITEBYTECODE", "1")
        .env("PYTHONNOUSERSITE", "1")
        .env("N4A_DAGML_INPROCESS", "1")
        .env("TMPDIR", &scratch.path)
        .env("TMP", &scratch.path)
        .env("TEMP", &scratch.path)
        .current_dir(&scratch.path)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    let mut child = command
        .spawn()
        .map_err(|_| ScientificCpythonUnavailable::SpawnFailed)?;
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
    if fs::read_dir(&scratch.path)
        .map_err(|_| ScientificCpythonUnavailable::ProcessFailed)?
        .next()
        .is_some()
    {
        return Err(ScientificCpythonUnavailable::ProcessFailed);
    }
    let response: Value = serde_json::from_slice(&stdout)
        .map_err(|_| ScientificCpythonUnavailable::MalformedResponse)?;
    validate_scientific_response(&response)?;
    if response.get("job_id").and_then(Value::as_str) != Some(&expected_job_id) {
        return Err(ScientificCpythonUnavailable::MalformedResponse);
    }
    Ok(response)
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
            match fs::create_dir(&path) {
                Ok(()) => return Ok(Self { path }),
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
                Err(_) => return Err(ScientificCpythonUnavailable::SpawnFailed),
            }
        }
        Err(ScientificCpythonUnavailable::SpawnFailed)
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

    #[test]
    fn contract_is_honest_about_the_current_non_capability() {
        let contract: Value = serde_json::from_str(SCIENTIFIC_CPYTHON_HOST_CONTRACT).unwrap();
        assert_eq!(
            contract["schema"],
            "nirs4all.studio-scientific-cpython-host.v1"
        );
        assert_eq!(contract["product_owner"], "studio-sidecar-rust");
        assert_eq!(contract["python_role"], "library-plugin-host-only");
        assert_eq!(contract["required_implementation"], "cpython");
        assert_eq!(contract["minimum_python_version"], "3.11");
        assert_eq!(contract["network_ownership"], "forbidden");
        assert_eq!(contract["network_bind_self_test"], "required");
        assert_eq!(contract["http_backend"], "forbidden");
        assert_eq!(contract["terminal_callback_owner"], "studio-sidecar-rust");
        assert_eq!(contract["execution_bridge_implemented"], true);
        assert_eq!(contract["studio_payload_resolver_implemented"], false);
        assert_eq!(contract["scientific_execution_capability"], false);
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
        let valid_json = r#"printf '%s' '{"callable":"nirs4all.studio_scientific_job_v1","callable_path":null,"callable_sha256":null,"implementation":"cpython","isolated":true,"network_bind_denied":true,"network_ownership":"forbidden","ready":false,"schema":"nirs4all.studio-scientific-cpython-host.v1","version":[3,11,0]}'"#;
        let host = shell_host(&root, "python-host", valid_json);
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
    fn process_boundary_refuses_timeout_malformed_and_oversized_streams() {
        let root = test_directory("limits");
        let malformed = shell_host(&root, "malformed", "printf nope");
        assert_eq!(
            CpythonScientificJobExecutor::acquire(&malformed).unavailable_reason(),
            "python_host_malformed_response"
        );
        let impostor = shell_host(
            &root,
            "impostor",
            r#"printf '%s' '{"callable":"nirs4all.studio_scientific_job_v1","callable_path":null,"callable_sha256":null,"implementation":"pypy","isolated":true,"network_bind_denied":true,"network_ownership":"forbidden","ready":false,"schema":"nirs4all.studio-scientific-cpython-host.v1","version":[3,11,0]}'"#,
        );
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
                "scientific_callable_unavailable" | "scientific_request_resolver_unavailable"
            ));
        } else {
            assert!(matches!(
                acquired.unavailable_reason(),
                "scientific_callable_unavailable"
                    | "scientific_request_resolver_unavailable"
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
    }
}
