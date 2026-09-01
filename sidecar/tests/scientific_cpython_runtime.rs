#![cfg(unix)]

use std::{
    fs,
    os::unix::fs::PermissionsExt,
    path::{Path, PathBuf},
    sync::{mpsc, Arc, Mutex},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use serde_json::{json, Value};
use studio_sidecar::{
    job_http::{
        NativeJobRuntime, NativeJobRuntimeError, ScientificExecutionRequest, ScientificJobExecutor,
        ScientificJobTerminal,
    },
    route_request_with_body,
    scientific_cpython::CpythonScientificJobExecutor,
    SidecarState,
};

#[derive(Debug)]
struct ChannelTerminal {
    sender: Mutex<mpsc::SyncSender<Result<Value, String>>>,
}

impl ScientificJobTerminal for ChannelTerminal {
    fn complete(&self, _job_id: &str, result: Value) -> Result<(), NativeJobRuntimeError> {
        let _ = self.sender.lock().unwrap().send(Ok(result));
        Ok(())
    }

    fn fail(&self, _job_id: &str, reason: &str) -> Result<(), NativeJobRuntimeError> {
        let _ = self.sender.lock().unwrap().send(Err(reason.to_owned()));
        Ok(())
    }

    fn acknowledge_cancel(&self, _job_id: &str) -> Result<(), NativeJobRuntimeError> {
        let _ = self.sender.lock().unwrap().send(Err("cancelled".into()));
        Ok(())
    }
}

fn test_directory(name: &str) -> PathBuf {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    std::env::temp_dir().join(format!(
        "studio-scientific-cpython-runtime-{name}-{}-{nonce}",
        std::process::id()
    ))
}

fn shell_host(root: &Path, name: &str, body: &str) -> PathBuf {
    fs::create_dir_all(root).unwrap();
    let path = root.join(name);
    fs::write(&path, format!("#!/bin/sh\n{body}\n")).unwrap();
    let mut permissions = fs::metadata(&path).unwrap().permissions();
    permissions.set_mode(0o700);
    fs::set_permissions(&path, permissions).unwrap();
    std::thread::sleep(std::time::Duration::from_millis(10));
    path
}

fn refusal(root: &Path, host: &Path) -> (Value, Arc<NativeJobRuntime>) {
    let config = root.join("config");
    fs::create_dir_all(config.join("app_settings.json")).unwrap();
    let runtime = Arc::new(NativeJobRuntime::with_executor(Arc::new(
        CpythonScientificJobExecutor::acquire(host),
    )));
    let mut state =
        SidecarState::with_native_jobs_and_app_settings_dir(Arc::clone(&runtime), &config);
    let response = route_request_with_body(
        &mut state,
        "POST",
        "/api/runs/run-groups",
        b"not-json-must-not-be-parsed",
    );
    assert_eq!(response.status, 503);
    (serde_json::from_str(&response.body).unwrap(), runtime)
}

#[test]
fn absent_malformed_and_oversized_hosts_are_typed_before_mutation() {
    let root = test_directory("typed");
    let cases = [
        (root.join("missing"), "python_host_unavailable"),
        (
            shell_host(&root, "malformed", "printf nope"),
            "python_host_malformed_response",
        ),
        (
            shell_host(&root, "oversized", "head -c 9000 /dev/zero | tr '\\000' x"),
            "python_host_stdout_too_large",
        ),
        (
            shell_host(&root, "timeout", "sleep 6"),
            "python_host_timed_out",
        ),
    ];
    for (host, expected) in cases {
        let (body, runtime) = refusal(&root, &host);
        assert_eq!(body["error"]["code"], "scientific_executor_unavailable");
        assert_eq!(body["error"]["details"]["reason"], expected);
        assert_eq!(runtime.published_event_count(), 0);
        assert_eq!(runtime.durable_write_count(), 0);
    }
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn acquired_host_tamper_is_typed_before_body_or_workspace_access() {
    let root = test_directory("tamper");
    let host = shell_host(
        &root,
        "host",
        r#"printf '%s' '{"callable":"nirs4all.studio_scientific_job_v1","callable_path":null,"callable_sha256":null,"implementation":"cpython","isolated":true,"network_bind_denied":true,"network_ownership":"forbidden","ready":false,"schema":"nirs4all.studio-scientific-cpython-host.v1","version":[3,11,0]}'"#,
    );
    let executor = Arc::new(CpythonScientificJobExecutor::acquire(&host));
    fs::write(&host, "tampered").unwrap();
    let runtime = Arc::new(NativeJobRuntime::with_executor(executor));
    let config = root.join("config");
    fs::create_dir_all(config.join("app_settings.json")).unwrap();
    let mut state =
        SidecarState::with_native_jobs_and_app_settings_dir(Arc::clone(&runtime), &config);
    let response = route_request_with_body(
        &mut state,
        "POST",
        "/api/runs/run-groups",
        b"not-json-must-not-be-parsed",
    );
    assert_eq!(response.status, 503);
    let body: Value = serde_json::from_str(&response.body).unwrap();
    assert_eq!(body["error"]["details"]["reason"], "python_host_tampered");
    assert_eq!(runtime.published_event_count(), 0);
    assert_eq!(runtime.durable_write_count(), 0);
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn current_protocol_callable_is_not_claimed_as_scientific_execution() {
    let root = test_directory("honesty");
    fs::create_dir_all(&root).unwrap();
    let callable = root.join("studio_scientific.py");
    fs::write(
        &callable,
        "def studio_scientific_job_v1(request): return request\n",
    )
    .unwrap();
    let digest = {
        use sha2::{Digest, Sha256};
        format!("{:x}", Sha256::digest(fs::read(&callable).unwrap()))
    };
    let host = shell_host(
        &root,
        "future-callable",
        &format!(
            r#"printf '%s' '{{"callable":"nirs4all.studio_scientific_job_v1","callable_path":"{}","callable_sha256":"{}","implementation":"cpython","isolated":true,"network_bind_denied":true,"network_ownership":"forbidden","ready":true,"schema":"nirs4all.studio-scientific-cpython-host.v1","version":[3,11,0]}}'"#,
            callable.display(),
            digest
        ),
    );
    let (body, runtime) = refusal(&root, &host);
    assert_eq!(
        body,
        json!({
            "error": {
                "code": "scientific_executor_unavailable",
                "message": "The bounded scientific executor is unavailable",
                "retryable": false,
                "details": {"reason": "scientific_request_resolver_unavailable"}
            }
        })
    );
    assert_eq!(runtime.published_event_count(), 0);
    assert_eq!(runtime.durable_write_count(), 0);
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn selected_wheel_executes_closed_path_free_request_through_real_stdio_host() {
    let Some(python) = std::env::var_os("N4A_STUDIO_REAL_PYTHON").map(PathBuf::from) else {
        return;
    };
    let executor = CpythonScientificJobExecutor::acquire(&python);
    assert!(!executor.is_selected());
    assert_eq!(
        executor.unavailable_reason(),
        "scientific_request_resolver_unavailable"
    );
    let job_id = "run_native_real_wheel";
    let request = ScientificExecutionRequest {
        job_id: job_id.into(),
        workspace_id: "must-not-cross-stdio".into(),
        workspace_path: PathBuf::from("/must/not/cross/stdio"),
        requested_backend: "local-python".into(),
        payload: json!({
            "schema": "nirs4all.studio-scientific-job.v1",
            "operation": "run",
            "job_id": job_id,
            "engine": "dag-ml",
            "allow_fallback": false,
            "dataset": {
                "name": "studio-real-wheel",
                "task_type": "regression",
                "X": [
                    [0.0, 1.0], [1.0, 0.0], [2.0, 1.0], [3.0, 1.5],
                    [4.0, 2.0], [5.0, 3.0], [6.0, 5.0], [7.0, 8.0]
                ],
                "y": [0.2, 1.1, 1.9, 3.2, 4.1, 5.3, 5.8, 7.4]
            },
            "pipeline": {
                "kind": "pls_regression",
                "n_components": 1,
                "scale": true,
                "cross_validation": {"kind": "kfold", "n_splits": 2, "shuffle": false}
            },
            "options": {"name": "studio-real-wheel", "random_state": 42}
        }),
    };
    let (sender, receiver) = mpsc::sync_channel(1);
    executor
        .submit_scientific(
            &request,
            Arc::new(ChannelTerminal {
                sender: Mutex::new(sender),
            }),
        )
        .unwrap();
    let result = receiver
        .recv_timeout(Duration::from_secs(120))
        .expect("real stdio worker must report one terminal outcome")
        .expect("real stdio worker must complete successfully");
    assert_eq!(result["schema"], "nirs4all.studio-scientific-job-result.v1");
    assert_eq!(result["job_id"], job_id);
    assert_eq!(result["engine"], "dag-ml");
    assert_eq!(result["result"]["model"], "pls_regression");
    assert!(result["result"]["prediction_count"]
        .as_u64()
        .is_some_and(|count| count > 0));
}
