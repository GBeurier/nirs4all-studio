//! Bounded `CPython` library-host bridge for Store-v5 run detail.
//!
//! Rust owns HTTP routing, workspace identity, Store preselection, response
//! composition, and error mapping.  This module starts one isolated `CPython`
//! process solely to call the nirs4all-owned materializer.  It is not an HTTP,
//! job, scheduler, or storage backend.

use std::{
    collections::BTreeSet,
    error::Error,
    fmt,
    io::{Read, Write},
    path::Path,
    process::{ChildStderr, ChildStdout, Command, Stdio},
    time::{Duration, Instant},
};

use serde_json::{json, Value};

pub const RUN_DETAIL_OWNER_PREFLIGHT_TIMEOUT: Duration = Duration::from_secs(15);
pub const RUN_DETAIL_OWNER_TIMEOUT: Duration = Duration::from_secs(15);
pub const MAX_RUN_DETAIL_OWNER_INPUT_BYTES: usize = 8 * 1024;
pub const MAX_RUN_DETAIL_OWNER_OUTPUT_BYTES: usize = 4 * 1024 * 1024;
pub const MAX_RUN_DETAIL_OWNER_STDERR_BYTES: usize = 64 * 1024;

const PREFLIGHT_SCRIPT: &str = r#"import json
from nirs4all.pipeline.storage import studio_run_detail_http_inputs_v1
if not callable(studio_run_detail_http_inputs_v1):
    raise TypeError("owner materializer is not callable")
print(json.dumps({"callable":"nirs4all.pipeline.storage.studio_run_detail_http_inputs_v1","ready":True}, separators=(",",":"), sort_keys=True))
"#;

const MATERIALIZE_SCRIPT: &str = r#"import json,sys
from nirs4all.pipeline.storage import studio_run_detail_http_inputs_v1
raw=sys.stdin.buffer.read(8193)
if len(raw)>8192:
    raise ValueError("bridge request exceeds the fixed input bound")
request=json.loads(raw)
if set(request)!={"workspace_path","run_id"} or not isinstance(request["workspace_path"],str) or not isinstance(request["run_id"],str):
    raise ValueError("invalid bridge request")
output=studio_run_detail_http_inputs_v1(request["workspace_path"],request["run_id"])
sys.stdout.write(json.dumps(output, allow_nan=False, separators=(",",":"), sort_keys=True))
"#;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RunDetailOwnerBridgeFailure {
    InvalidInput,
    SpawnFailed,
    InputWriteFailed,
    TimedOut,
    ProcessFailed,
    OutputReadFailed,
    StdoutTooLarge,
    StderrTooLarge,
    MalformedResponse,
}

impl RunDetailOwnerBridgeFailure {
    #[must_use]
    pub const fn reason(self) -> &'static str {
        match self {
            Self::InvalidInput => "invalid_bridge_input",
            Self::SpawnFailed => "python_plugin_spawn_failed",
            Self::InputWriteFailed => "python_plugin_input_failed",
            Self::TimedOut => "python_plugin_timeout",
            Self::ProcessFailed => "python_plugin_process_failed",
            Self::OutputReadFailed => "python_plugin_output_failed",
            Self::StdoutTooLarge => "python_plugin_stdout_too_large",
            Self::StderrTooLarge => "python_plugin_stderr_too_large",
            Self::MalformedResponse => "python_plugin_malformed_response",
        }
    }
}

impl fmt::Display for RunDetailOwnerBridgeFailure {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.reason())
    }
}

impl Error for RunDetailOwnerBridgeFailure {}

#[derive(Clone, Copy)]
struct BridgeLimits {
    timeout: Duration,
    stdout: usize,
    stderr: usize,
}

/// Verify that the configured interpreter exposes the exact owner callable.
///
/// A successful preflight has no durable state: the target request starts a
/// fresh process and imports the callable again, closing the preselection TOCTOU
/// window without a Python fallback.
///
/// # Errors
///
/// Fails closed when the interpreter cannot be started, times out, exceeds a
/// stream bound, or does not expose the exact qualified callable.
pub fn preflight_run_detail_owner(
    python_plugin_host: &Path,
) -> Result<(), RunDetailOwnerBridgeFailure> {
    let output = run_python(
        python_plugin_host,
        PREFLIGHT_SCRIPT,
        None,
        BridgeLimits {
            timeout: RUN_DETAIL_OWNER_PREFLIGHT_TIMEOUT,
            stdout: 1024,
            stderr: MAX_RUN_DETAIL_OWNER_STDERR_BYTES,
        },
    )?;
    let value: Value = serde_json::from_slice(&output)
        .map_err(|_| RunDetailOwnerBridgeFailure::MalformedResponse)?;
    if value
        != json!({
            "callable": "nirs4all.pipeline.storage.studio_run_detail_http_inputs_v1",
            "ready": true,
        })
    {
        return Err(RunDetailOwnerBridgeFailure::MalformedResponse);
    }
    Ok(())
}

/// Call the nirs4all-owned immutable Store-v5 input materializer.
///
/// # Errors
///
/// Fails closed for invalid identifiers, process failures, bounds, malformed
/// JSON, or an owner envelope that differs from the frozen seven-field shape.
pub fn materialize_run_detail_owner(
    python_plugin_host: &Path,
    workspace_path: &Path,
    run_id: &str,
) -> Result<Option<Value>, RunDetailOwnerBridgeFailure> {
    let workspace_path = workspace_path
        .to_str()
        .filter(|path| !path.is_empty() && path.len() <= 4096 && !path.contains('\0'))
        .ok_or(RunDetailOwnerBridgeFailure::InvalidInput)?;
    if run_id.is_empty()
        || run_id.len() > 1024
        || run_id.contains('\0')
        || run_id.contains('/')
        || run_id.contains('\\')
    {
        return Err(RunDetailOwnerBridgeFailure::InvalidInput);
    }
    let input = serde_json::to_vec(&json!({
        "workspace_path": workspace_path,
        "run_id": run_id,
    }))
    .map_err(|_| RunDetailOwnerBridgeFailure::InvalidInput)?;
    if input.len() > MAX_RUN_DETAIL_OWNER_INPUT_BYTES {
        return Err(RunDetailOwnerBridgeFailure::InvalidInput);
    }
    let output = run_python(
        python_plugin_host,
        MATERIALIZE_SCRIPT,
        Some(&input),
        BridgeLimits {
            timeout: RUN_DETAIL_OWNER_TIMEOUT,
            stdout: MAX_RUN_DETAIL_OWNER_OUTPUT_BYTES,
            stderr: MAX_RUN_DETAIL_OWNER_STDERR_BYTES,
        },
    )?;
    let value: Value = serde_json::from_slice(&output)
        .map_err(|_| RunDetailOwnerBridgeFailure::MalformedResponse)?;
    if value.is_null() {
        return Ok(None);
    }
    validate_owner_envelope(&value)?;
    Ok(Some(value))
}

fn validate_owner_envelope(value: &Value) -> Result<(), RunDetailOwnerBridgeFailure> {
    const FIELDS: [&str; 7] = [
        "pipeline_runtime",
        "pipeline_splitters",
        "results",
        "results_count",
        "run_detail",
        "runtime_column_provenance",
        "source_branch",
    ];
    let object = value
        .as_object()
        .ok_or(RunDetailOwnerBridgeFailure::MalformedResponse)?;
    let keys = object.keys().map(String::as_str).collect::<BTreeSet<_>>();
    if keys != FIELDS.into_iter().collect()
        || object.get("source_branch").and_then(Value::as_str) != Some("store_v5")
        || !object.get("run_detail").is_some_and(Value::is_object)
        || !object
            .get("pipeline_splitters")
            .is_some_and(Value::is_array)
        || !object.get("pipeline_runtime").is_some_and(Value::is_array)
        || !object
            .get("runtime_column_provenance")
            .is_some_and(Value::is_object)
        || !object.get("results").is_some_and(Value::is_array)
        || !object.get("results_count").is_some_and(Value::is_u64)
    {
        return Err(RunDetailOwnerBridgeFailure::MalformedResponse);
    }
    Ok(())
}

fn run_python(
    python_plugin_host: &Path,
    script: &str,
    input: Option<&[u8]>,
    limits: BridgeLimits,
) -> Result<Vec<u8>, RunDetailOwnerBridgeFailure> {
    let mut child = Command::new(python_plugin_host)
        .args(["-I", "-c", script])
        .stdin(if input.is_some() {
            Stdio::piped()
        } else {
            Stdio::null()
        })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|_| RunDetailOwnerBridgeFailure::SpawnFailed)?;

    if let Some(input) = input {
        let Some(mut stdin) = child.stdin.take() else {
            let _ = child.kill();
            let _ = child.wait();
            return Err(RunDetailOwnerBridgeFailure::InputWriteFailed);
        };
        if stdin.write_all(input).is_err() {
            let _ = child.kill();
            let _ = child.wait();
            return Err(RunDetailOwnerBridgeFailure::InputWriteFailed);
        }
    }

    let (Some(stdout), Some(stderr)) = (child.stdout.take(), child.stderr.take()) else {
        let _ = child.kill();
        let _ = child.wait();
        return Err(RunDetailOwnerBridgeFailure::OutputReadFailed);
    };
    let stdout_reader = std::thread::spawn(move || read_bounded_stdout(stdout, limits.stdout));
    let stderr_reader = std::thread::spawn(move || read_bounded_stderr(stderr, limits.stderr));

    let started_at = Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if started_at.elapsed() >= limits.timeout => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(RunDetailOwnerBridgeFailure::TimedOut);
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(10)),
            Err(_) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(RunDetailOwnerBridgeFailure::ProcessFailed);
            }
        }
    };

    let (stdout, stdout_exceeded) = stdout_reader
        .join()
        .map_err(|_| RunDetailOwnerBridgeFailure::OutputReadFailed)?
        .map_err(|_| RunDetailOwnerBridgeFailure::OutputReadFailed)?;
    let (_, stderr_exceeded) = stderr_reader
        .join()
        .map_err(|_| RunDetailOwnerBridgeFailure::OutputReadFailed)?
        .map_err(|_| RunDetailOwnerBridgeFailure::OutputReadFailed)?;
    if stdout_exceeded {
        return Err(RunDetailOwnerBridgeFailure::StdoutTooLarge);
    }
    if stderr_exceeded {
        return Err(RunDetailOwnerBridgeFailure::StderrTooLarge);
    }
    if !status.success() {
        return Err(RunDetailOwnerBridgeFailure::ProcessFailed);
    }
    Ok(stdout)
}

fn read_bounded_stdout(stdout: ChildStdout, limit: usize) -> std::io::Result<(Vec<u8>, bool)> {
    read_bounded(stdout, limit)
}

fn read_bounded_stderr(stderr: ChildStderr, limit: usize) -> std::io::Result<(Vec<u8>, bool)> {
    read_bounded(stderr, limit)
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
        retained.extend_from_slice(&buffer[..copied]);
        exceeded |= copied < count;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(unix)]
    fn shell_host(name: &str, body: &str) -> std::path::PathBuf {
        use std::{fs, os::unix::fs::PermissionsExt, time::SystemTime};

        let nonce = SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "studio-run-detail-host-{name}-{}-{nonce}",
            std::process::id()
        ));
        fs::write(&path, format!("#!/bin/sh\n{body}\n")).unwrap();
        let mut permissions = fs::metadata(&path).unwrap().permissions();
        permissions.set_mode(0o700);
        fs::set_permissions(&path, permissions).unwrap();
        path
    }

    #[test]
    fn exact_owner_shape_is_required() {
        let fixture: Value = serde_json::from_str(include_str!(
            "../tests/fixtures/workspace_store_v5_run_detail_http_inputs.response.json"
        ))
        .unwrap();
        validate_owner_envelope(&fixture).unwrap();

        let mut extra = fixture.clone();
        extra["workspace_path"] = Value::String("secret".into());
        assert_eq!(
            validate_owner_envelope(&extra),
            Err(RunDetailOwnerBridgeFailure::MalformedResponse)
        );
        let mut tampered = fixture;
        tampered["source_branch"] = Value::String("legacy".into());
        assert_eq!(
            validate_owner_envelope(&tampered),
            Err(RunDetailOwnerBridgeFailure::MalformedResponse)
        );
    }

    #[test]
    fn bounded_reader_drains_but_retains_only_the_limit() {
        let (output, exceeded) = read_bounded(&b"abcdefgh"[..], 3).unwrap();
        assert_eq!(output, b"abc");
        assert!(exceeded);
    }

    #[cfg(unix)]
    #[test]
    fn process_bridge_refuses_timeout_malformed_and_bounded_streams() {
        let limits = BridgeLimits {
            timeout: Duration::from_millis(100),
            stdout: 4,
            stderr: 8,
        };

        let timeout = shell_host("timeout", "sleep 2");
        assert_eq!(
            run_python(&timeout, "ignored", None, limits),
            Err(RunDetailOwnerBridgeFailure::TimedOut)
        );

        let stdout = shell_host("stdout", "printf 12345");
        assert_eq!(
            run_python(&stdout, "ignored", None, limits),
            Err(RunDetailOwnerBridgeFailure::StdoutTooLarge)
        );

        let stderr = shell_host("stderr", "printf 123456789 >&2; exit 1");
        assert_eq!(
            run_python(&stderr, "ignored", None, limits),
            Err(RunDetailOwnerBridgeFailure::StderrTooLarge)
        );

        let malformed = shell_host("malformed", "printf nope");
        assert_eq!(
            materialize_run_detail_owner(&malformed, Path::new("/workspace"), "run-a"),
            Err(RunDetailOwnerBridgeFailure::MalformedResponse)
        );

        for path in [timeout, stdout, stderr, malformed] {
            std::fs::remove_file(path).unwrap();
        }
    }

    #[cfg(unix)]
    #[test]
    fn each_materialization_uses_a_fresh_process_and_rejects_tamper() {
        let fixture = include_str!(
            "../tests/fixtures/workspace_store_v5_run_detail_http_inputs.response.json"
        );
        let pid_log =
            std::env::temp_dir().join(format!("studio-run-detail-pids-{}", std::process::id()));
        let host = shell_host(
            "fresh",
            &format!(
                "cat >/dev/null\necho $$ >> {}\nprintf %s '{}'",
                pid_log.display(),
                fixture.replace('\'', "'\\''")
            ),
        );
        for _ in 0..2 {
            materialize_run_detail_owner(&host, Path::new("/workspace"), "run-a").unwrap();
        }
        let pids = std::fs::read_to_string(&pid_log).unwrap();
        let pids = pids.lines().collect::<Vec<_>>();
        assert_eq!(pids.len(), 2);
        assert_ne!(pids[0], pids[1]);

        let tampered = fixture.replace(
            "\"source_branch\": \"store_v5\"",
            "\"source_branch\": \"legacy\"",
        );
        let tampered_host = shell_host(
            "tampered",
            &format!(
                "cat >/dev/null\nprintf %s '{}'",
                tampered.replace('\'', "'\\''")
            ),
        );
        assert_eq!(
            materialize_run_detail_owner(&tampered_host, Path::new("/workspace"), "run-a"),
            Err(RunDetailOwnerBridgeFailure::MalformedResponse)
        );

        for path in [host, tampered_host, pid_log] {
            std::fs::remove_file(path).unwrap();
        }
    }
}
