#![cfg(unix)]

use std::{
    fs,
    os::unix::fs::{symlink, PermissionsExt},
    path::{Path, PathBuf},
    sync::{mpsc, Arc, Mutex},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use serde_json::{json, Value};
use studio_sidecar::{
    execution_job_records::read_execution_job_record,
    job_http::{
        NativeJobRuntime, NativeJobRuntimeError, ScientificExecutionRequest, ScientificJobExecutor,
        ScientificJobTerminal,
    },
    route_request_with_body,
    scientific_cpython::{
        CpythonScientificJobExecutor, SCIENTIFIC_CPYTHON_HOST_CONTRACT,
        SCIENTIFIC_CPYTHON_PREFLIGHT_TIMEOUT,
    },
    SidecarState,
};

#[derive(Debug)]
struct ChannelTerminal {
    sender: Mutex<mpsc::SyncSender<Result<Value, String>>>,
}

#[derive(Debug)]
struct RejectingTerminal;

impl ScientificJobTerminal for RejectingTerminal {
    fn complete(&self, _job_id: &str, _result: Value) -> Result<(), NativeJobRuntimeError> {
        Err(NativeJobRuntimeError::Executor(
            studio_sidecar::job_http::JobExecutorError::SubmissionRefused,
        ))
    }

    fn fail(&self, _job_id: &str, _reason: &str) -> Result<(), NativeJobRuntimeError> {
        Err(NativeJobRuntimeError::Executor(
            studio_sidecar::job_http::JobExecutorError::SubmissionRefused,
        ))
    }

    fn acknowledge_cancel(&self, _job_id: &str) -> Result<(), NativeJobRuntimeError> {
        Err(NativeJobRuntimeError::Executor(
            studio_sidecar::job_http::JobExecutorError::SubmissionRefused,
        ))
    }
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

fn configured_resolver(root: &Path) -> PathBuf {
    let config = root.join("config");
    fs::create_dir_all(&config).unwrap();
    fs::write(
        config.join("dataset_links.json"),
        br#"{"version":"1.0","schema_version":2,"datasets":[],"groups":[]}"#,
    )
    .unwrap();
    config
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
fn scientific_host_contract_tracks_the_product_preflight_budget() {
    let contract: Value = serde_json::from_str(SCIENTIFIC_CPYTHON_HOST_CONTRACT).unwrap();
    assert_eq!(
        contract["preflight_timeout_ms"],
        u64::try_from(SCIENTIFIC_CPYTHON_PREFLIGHT_TIMEOUT.as_millis()).unwrap()
    );
    assert!(SCIENTIFIC_CPYTHON_PREFLIGHT_TIMEOUT < Duration::from_secs(75));
}

#[test]
fn copied_interpreter_files_are_inspected_but_venv_symlinks_are_unsupported() {
    let root = test_directory("copied-host");
    let source = shell_host(&root, "source-python", "printf nope");
    let copied = root.join("embedded-python-copy");
    fs::copy(&source, &copied).unwrap();
    let copied_executor = CpythonScientificJobExecutor::acquire(&copied);
    assert_eq!(
        copied_executor.unavailable_reason(),
        "python_host_malformed_response"
    );

    let venv_link = root.join("venv-python");
    symlink(&copied, &venv_link).unwrap();
    let linked_executor = CpythonScientificJobExecutor::acquire(&venv_link);
    assert_eq!(
        linked_executor.unavailable_reason(),
        "python_host_symlink_unsupported"
    );
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
    assert_eq!(
        body["error"]["details"]["reason"],
        "python_host_malformed_response"
    );
    assert_eq!(runtime.published_event_count(), 0);
    assert_eq!(runtime.durable_write_count(), 0);
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn unattested_callable_cannot_select_scientific_execution() {
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
    let config = root.join("config");
    fs::create_dir_all(config.join("app_settings.json")).unwrap();
    let runtime = Arc::new(NativeJobRuntime::with_executor(Arc::new(
        CpythonScientificJobExecutor::acquire_with_config_dir(&host, &config),
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
    let body: Value = serde_json::from_str(&response.body).unwrap();
    assert_eq!(
        body["error"]["details"]["reason"],
        "python_host_malformed_response"
    );
    assert_eq!(runtime.published_event_count(), 0);
    assert_eq!(runtime.durable_write_count(), 0);
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn terminal_callback_failure_is_observed_and_disables_future_selection() {
    let Some(python) = std::env::var_os("N4A_STUDIO_REAL_PYTHON").map(PathBuf::from) else {
        return;
    };
    let root = test_directory("terminal-callback");
    fs::create_dir_all(&root).unwrap();
    let config = configured_resolver(&root);
    let executor = CpythonScientificJobExecutor::acquire_with_config_dir(&python, &config);
    assert!(executor.is_selected(), "{}", executor.unavailable_reason());
    let request = ScientificExecutionRequest {
        job_id: "run_native_callback_failure".into(),
        workspace_id: "workspace-a".into(),
        workspace_path: root.clone(),
        requested_backend: "local-python".into(),
        payload: json!({
            "schema": "nirs4all.studio-scientific-job.v1",
            "operation": "run",
            "job_id": "run_native_callback_failure",
            "engine": "dag-ml",
            "allow_fallback": false,
            "dataset": {
                "name": "dataset-a",
                "task_type": "regression",
                "X": [[0.0], [1.0], [2.0], [3.0]],
                "y": [0.0, 1.0, 2.0, 3.0]
            },
            "pipeline": {
                "kind": "pls_regression",
                "n_components": 1,
                "scale": true,
                "cross_validation": {"kind": "kfold", "n_splits": 2, "shuffle": false}
            },
            "options": {"name": "pipeline-a", "random_state": 42}
        }),
    };
    executor
        .submit_scientific(&request, Arc::new(RejectingTerminal))
        .unwrap();
    let deadline = std::time::Instant::now() + Duration::from_secs(30);
    while executor.is_selected() && std::time::Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(10));
    }
    assert!(!executor.is_selected());
    assert_eq!(
        executor.unavailable_reason(),
        "scientific_terminal_callback_failed"
    );
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn selected_wheel_executes_closed_path_free_request_through_real_stdio_host() {
    let Some(python) = std::env::var_os("N4A_STUDIO_REAL_PYTHON").map(PathBuf::from) else {
        return;
    };
    let root = test_directory("real-wheel");
    let config = configured_resolver(&root);
    let executor = CpythonScientificJobExecutor::acquire_with_config_dir(&python, &config);
    assert!(executor.is_selected(), "{}", executor.unavailable_reason());
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
    fs::remove_dir_all(root).unwrap();
}

#[test]
#[allow(clippy::too_many_lines)]
fn selected_wheel_resolves_saved_route_and_persists_only_the_original_request() {
    let Some(python) = std::env::var_os("N4A_STUDIO_REAL_PYTHON").map(PathBuf::from) else {
        return;
    };
    let root = test_directory("saved-route");
    let config = root.join("config");
    let workspace = root.join("workspace");
    let dataset = root.join("dataset");
    fs::create_dir_all(&config).unwrap();
    fs::create_dir_all(workspace.join("runs")).unwrap();
    fs::create_dir_all(workspace.join("pipelines")).unwrap();
    fs::create_dir_all(&dataset).unwrap();
    fs::write(
        config.join("app_settings.json"),
        serde_json::to_vec(&json!({
            "version": "3.0",
            "linked_workspaces": [{
                "id": "workspace-a",
                "path": workspace,
                "name": "Workspace A",
                "is_active": true,
                "linked_at": "2026-09-01T12:00:00Z",
                "last_scanned": null,
                "discovered": {"runs_count": 0}
            }]
        }))
        .unwrap(),
    )
    .unwrap();
    fs::write(
        dataset.join("x.csv"),
        "1000,1001\n1,2\n2,3\n3,4\n4,5\n5,6\n6,7\n7,8\n8,9\n",
    )
    .unwrap();
    fs::write(
        dataset.join("y.csv"),
        "protein\n1.1\n2.2\n3.4\n4.8\n5.3\n6.7\n7.9\n8.6\n",
    )
    .unwrap();
    fs::write(
        config.join("dataset_links.json"),
        serde_json::to_vec(&json!({
            "version": "1.0",
            "schema_version": 2,
            "datasets": [{
                "id": "dataset-a",
                "name": "Dataset A",
                "path": dataset,
                "config": {
                    "delimiter": ",",
                    "decimal_separator": ".",
                    "has_header": true,
                    "header_unit": "cm-1",
                    "signal_type": "auto",
                    "task_type": "regression",
                    "files": [
                        {"path": "x.csv", "type": "X", "split": "train"},
                        {"path": "y.csv", "type": "Y", "split": "train"}
                    ],
                    "targets": [{"column": "protein", "type": "regression", "is_default": true}],
                    "target_selection": {
                        "selected_targets": ["protein"],
                        "default_target": "protein",
                        "task_by_target": {"protein": "regression"}
                    },
                    "default_target": "protein"
                }
            }],
            "groups": []
        }))
        .unwrap(),
    )
    .unwrap();
    fs::write(
        workspace.join("pipelines/pipeline-a.json"),
        serde_json::to_vec(&json!({
            "id": "pipeline-a",
            "name": "PLS",
            "taskType": "regression",
            "steps": [
                {"id": "cv", "type": "splitting", "name": "KFold", "params": {"n_splits": 2, "shuffle": true, "random_state": 42}},
                {"id": "model", "type": "model", "name": "PLSRegression", "params": {"n_components": 1, "scale": true}}
            ]
        }))
        .unwrap(),
    )
    .unwrap();
    let executor = CpythonScientificJobExecutor::acquire_with_config_dir(&python, &config);
    assert!(executor.is_selected(), "{}", executor.unavailable_reason());
    let runtime = Arc::new(NativeJobRuntime::with_executor(Arc::new(executor)));
    let mut state =
        SidecarState::with_native_jobs_and_app_settings_dir(Arc::clone(&runtime), &config);
    let original_request = json!({
        "legacyConfig": {
            "name": "Native saved campaign",
            "dataset_ids": ["dataset-a"],
            "pipeline_ids": ["pipeline-a"],
            "execution_backend": "local-python",
            "engine": "dag-ml",
            "allow_fallback": false,
            "split_group_by_by_dataset": {}
        },
        "manifest": {
            "version": "studio.native-launch-payload.v1",
            "legacyExperimentName": "Native saved campaign",
            "legacyDatasetCount": 1,
            "legacyPipelineCount": 1,
            "strictCampaignCount": 1,
            "skippedRunCount": 0,
            "sourceRunIds": ["dataset-a::pipeline-a"],
            "skippedRunIds": []
        },
        "strictCampaignSpecs": {
            "splitSpecs": [{
                "id": "single-pair:dataset-a::pipeline-a",
                "sourceRunId": "dataset-a::pipeline-a",
                "sourceDatasetId": "dataset-a",
                "sourcePipelineId": "pipeline-a",
                "campaign": {
                    "name": "Native saved campaign / Dataset A / Pipeline A",
                    "mode": "paired_by_index",
                    "executionBackend": "local-python",
                    "datasets": [{"id": "dataset-a", "name": "Dataset A", "splitGroupBy": null}],
                    "pipelines": [{"id": "pipeline-a", "name": "Pipeline A", "source": "saved"}],
                    "runMatrix": [{
                        "id": "dataset-a::pipeline-a",
                        "datasetId": "dataset-a",
                        "pipelineId": "pipeline-a",
                        "datasetIndex": 0,
                        "pipelineIndex": 0,
                        "splitGroupBy": null
                    }]
                }
            }],
            "skippedRunIds": []
        }
    });
    let response = route_request_with_body(
        &mut state,
        "POST",
        "/api/runs/run-groups",
        &serde_json::to_vec(&original_request).unwrap(),
    );
    assert_eq!(response.status, 202, "{}", response.body);
    let response: Value = serde_json::from_str(&response.body).unwrap();
    let job_id = response["job_id"].as_str().unwrap();
    let deadline = std::time::Instant::now() + Duration::from_secs(120);
    loop {
        let snapshot = runtime.get_at(job_id, std::time::Instant::now()).unwrap();
        if snapshot.status.as_str() != "running" {
            assert_eq!(
                snapshot.status.as_str(),
                "completed",
                "{:?}",
                snapshot.error
            );
            break;
        }
        assert!(
            std::time::Instant::now() < deadline,
            "scientific route timed out"
        );
        std::thread::sleep(Duration::from_millis(20));
    }
    let record = read_execution_job_record(&workspace, job_id).unwrap();
    assert_eq!(record["status"], "completed");
    assert_eq!(record["request"], original_request);
    assert!(!record["request"].to_string().contains("\"X\""));
    assert!(!record["request"].to_string().contains("\"y\""));
    assert_eq!(runtime.published_event_count(), 2);
    assert_eq!(runtime.durable_write_count(), 2);
    fs::remove_dir_all(root).unwrap();
}
