//! Acquisition boundary for a future bounded `CPython` scientific host.
//!
//! The current nirs4all library does not expose the closed Studio job
//! callable named by the contract. This module therefore performs a real,
//! bounded process acquisition but deliberately never selects scientific
//! execution. Rust remains the HTTP, job, event, cancellation, scheduler, and
//! store owner. The acquisition result is immutable for the executor's
//! lifetime; changing runtimes requires constructing a new executor.

use std::{
    fs::{self, File},
    io::{Read, Write},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    time::{Duration, Instant},
};

use serde_json::Value;
use sha2::{Digest, Sha256};

use crate::job_http::{JobExecutorError, ScientificExecutionRequest, ScientificJobExecutor};

pub const SCIENTIFIC_CPYTHON_HOST_CONTRACT: &str =
    include_str!("../contracts/studio_scientific_cpython_host_v1.json");
pub const SCIENTIFIC_CPYTHON_EXECUTOR_ID: &str = "cpython-stdio-v1";
pub const SCIENTIFIC_CPYTHON_PREFLIGHT_TIMEOUT: Duration = Duration::from_secs(3);
pub const MAX_SCIENTIFIC_CPYTHON_STDOUT_BYTES: usize = 8 * 1024;
pub const MAX_SCIENTIFIC_CPYTHON_STDERR_BYTES: usize = 64 * 1024;
pub const MAX_SCIENTIFIC_CPYTHON_HOST_BYTES: u64 = 64 * 1024 * 1024;

const PREFLIGHT_SCRIPT: &str = r#"import json,socket,sys
SCHEMA="nirs4all.studio-scientific-cpython-host.v1"
def deny_product_network(event,args):
    if event == "socket.bind":
        raise RuntimeError("CPython library host cannot own a listening socket")
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
except Exception:
    ready=False
print(json.dumps({"schema":SCHEMA,"callable":"nirs4all.studio_scientific_job_v1","ready":ready,"network_ownership":"forbidden","implementation":sys.implementation.name,"version":list(sys.version_info[:3]),"isolated":bool(sys.flags.isolated),"network_bind_denied":bind_denied},separators=(",",":"),sort_keys=True))
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
    ExecutionBridgeUnavailable,
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
            Self::ExecutionBridgeUnavailable => "scientific_execution_bridge_unavailable",
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
/// Even if a future library exposes the named callable, this migration slice
/// remains unselected until the result/event completion bridge is implemented.
/// This prevents accepting a job which Rust cannot honestly drive to a durable
/// terminal state.
#[derive(Debug)]
pub struct CpythonScientificJobExecutor {
    identity: Option<HostIdentity>,
    acquisition: ScientificCpythonUnavailable,
}

impl CpythonScientificJobExecutor {
    #[must_use]
    pub fn acquire(path: impl AsRef<Path>) -> Self {
        match acquire_host(path.as_ref()) {
            Ok((identity, callable_ready)) => Self {
                identity: Some(identity),
                acquisition: if callable_ready {
                    ScientificCpythonUnavailable::ExecutionBridgeUnavailable
                } else {
                    ScientificCpythonUnavailable::CallableUnavailable
                },
            },
            Err(error) => Self {
                identity: None,
                acquisition: error,
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
        _request: &ScientificExecutionRequest,
    ) -> Result<(), JobExecutorError> {
        Err(JobExecutorError::SubmissionRefused)
    }

    fn request_cooperative_cancel(&self, _job_id: &str) -> Result<(), JobExecutorError> {
        Err(JobExecutorError::Unselected)
    }
}

fn acquire_host(path: &Path) -> Result<(HostIdentity, bool), ScientificCpythonUnavailable> {
    let identity = host_identity(path)?;
    let output = run_preflight(&identity.canonical_path)?;
    let response: Value = serde_json::from_slice(&output)
        .map_err(|_| ScientificCpythonUnavailable::MalformedResponse)?;
    let object = response
        .as_object()
        .ok_or(ScientificCpythonUnavailable::MalformedResponse)?;
    if object.len() != 8
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
    Ok((identity, ready))
}

fn host_identity(path: &Path) -> Result<HostIdentity, ScientificCpythonUnavailable> {
    let canonical_path = path
        .canonicalize()
        .map_err(|_| ScientificCpythonUnavailable::HostUnavailable)?;
    let metadata =
        fs::metadata(&canonical_path).map_err(|_| ScientificCpythonUnavailable::HostUnavailable)?;
    if !metadata.is_file() || metadata.len() == 0 {
        return Err(ScientificCpythonUnavailable::HostUnavailable);
    }
    if metadata.len() > MAX_SCIENTIFIC_CPYTHON_HOST_BYTES {
        return Err(ScientificCpythonUnavailable::HostTooLarge);
    }
    let sha256 = hash_file(&canonical_path)?;
    Ok(HostIdentity {
        canonical_path,
        size: metadata.len(),
        sha256,
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
        assert_eq!(contract["scientific_execution_capability"], false);
    }

    #[cfg(unix)]
    #[test]
    fn acquisition_is_sticky_and_detects_later_host_tamper() {
        let root = test_directory("identity");
        let missing = root.join("missing-python");
        let unavailable = CpythonScientificJobExecutor::acquire(&missing);
        assert_eq!(unavailable.unavailable_reason(), "python_host_unavailable");
        let valid_json = r#"printf '%s' '{"callable":"nirs4all.studio_scientific_job_v1","implementation":"cpython","isolated":true,"network_bind_denied":true,"network_ownership":"forbidden","ready":false,"schema":"nirs4all.studio-scientific-cpython-host.v1","version":[3,11,0]}'"#;
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
            r#"printf '%s' '{"callable":"nirs4all.studio_scientific_job_v1","implementation":"pypy","isolated":true,"network_bind_denied":true,"network_ownership":"forbidden","ready":false,"schema":"nirs4all.studio-scientific-cpython-host.v1","version":[3,11,0]}'"#,
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
                "scientific_callable_unavailable" | "scientific_execution_bridge_unavailable"
            ));
        } else {
            assert!(matches!(
                acquired.unavailable_reason(),
                "scientific_callable_unavailable"
                    | "scientific_execution_bridge_unavailable"
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
