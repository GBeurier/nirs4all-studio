#![cfg(unix)]

use std::{
    fs,
    os::unix::fs::PermissionsExt,
    path::{Path, PathBuf},
    sync::Arc,
    time::{SystemTime, UNIX_EPOCH},
};

use serde_json::{json, Value};
use studio_sidecar::{
    job_http::NativeJobRuntime, route_request_with_body,
    scientific_cpython::CpythonScientificJobExecutor, SidecarState,
};

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
            shell_host(&root, "timeout", "sleep 4"),
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
        r#"printf '%s' '{"callable":"nirs4all.studio_scientific_job_v1","implementation":"cpython","isolated":true,"network_bind_denied":true,"network_ownership":"forbidden","ready":false,"schema":"nirs4all.studio-scientific-cpython-host.v1","version":[3,11,0]}'"#,
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
    let host = shell_host(
        &root,
        "future-callable",
        r#"printf '%s' '{"callable":"nirs4all.studio_scientific_job_v1","implementation":"cpython","isolated":true,"network_bind_denied":true,"network_ownership":"forbidden","ready":true,"schema":"nirs4all.studio-scientific-cpython-host.v1","version":[3,11,0]}'"#,
    );
    let (body, runtime) = refusal(&root, &host);
    assert_eq!(
        body,
        json!({
            "error": {
                "code": "scientific_executor_unavailable",
                "message": "The bounded scientific executor is unavailable",
                "retryable": false,
                "details": {"reason": "scientific_execution_bridge_unavailable"}
            }
        })
    );
    assert_eq!(runtime.published_event_count(), 0);
    assert_eq!(runtime.durable_write_count(), 0);
    fs::remove_dir_all(root).unwrap();
}
