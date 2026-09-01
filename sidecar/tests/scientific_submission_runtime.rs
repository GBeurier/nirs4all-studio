use std::{
    collections::BTreeSet,
    fs,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc, Mutex,
    },
    time::{Instant, SystemTime, UNIX_EPOCH},
};

use serde_json::{json, Value};
use studio_sidecar::{
    execution_job_records::read_execution_job_record,
    job_http::{
        JobExecutorError, NativeJobRuntime, ScientificExecutionRequest,
        ScientificExecutorSelection, ScientificJobExecutor, ScientificJobTerminal,
        ScientificSubmissionPreflight,
    },
    route_request, route_request_with_body,
    scientific_request_resolver::ScientificRequestResolver,
    SidecarState, MAX_REQUEST_BODY_BYTES,
};

#[derive(Debug, Default)]
struct RecordingScientificExecutor {
    preflights: AtomicUsize,
    submissions: AtomicUsize,
    cancellations: AtomicUsize,
    workspace_paths: Mutex<Vec<PathBuf>>,
}

#[derive(Debug, Default)]
struct CompletingScientificExecutor;

impl ScientificJobExecutor for CompletingScientificExecutor {
    fn is_selected(&self) -> bool {
        true
    }

    fn preflight_submission(
        &self,
        _request: &ScientificSubmissionPreflight,
    ) -> Result<ScientificExecutorSelection, JobExecutorError> {
        Ok(ScientificExecutorSelection {
            execution_backend: "dag-ml-core".into(),
            execution_mode: Some("bounded-library-host".into()),
            prepared_payload: json!({}),
        })
    }

    fn submit_scientific(
        &self,
        request: &ScientificExecutionRequest,
        terminal: Arc<dyn ScientificJobTerminal>,
    ) -> Result<(), JobExecutorError> {
        terminal
            .complete(
                &request.job_id,
                json!({
                    "schema": "nirs4all.studio-scientific-job-result.v1",
                    "job_id": request.job_id,
                    "engine": "dag-ml",
                    "result": {
                        "model": "pls_regression",
                        "task_type": "regression",
                        "metric": "rmse",
                        "validation_score": 0.25,
                        "training_score": 0.125,
                        "prediction_count": 8
                    }
                }),
            )
            .map_err(|_| JobExecutorError::SubmissionRefused)
    }

    fn request_cooperative_cancel(&self, _job_id: &str) -> Result<(), JobExecutorError> {
        Err(JobExecutorError::CancellationRefused)
    }
}

#[derive(Debug, Default)]
struct ImmediateCancelAckExecutor {
    terminal: Mutex<Option<Arc<dyn ScientificJobTerminal>>>,
}

#[derive(Debug)]
struct ResolvingExecutor {
    resolver: ScientificRequestResolver,
}

impl ScientificJobExecutor for ResolvingExecutor {
    fn is_selected(&self) -> bool {
        true
    }

    fn preflight_submission(
        &self,
        request: &ScientificSubmissionPreflight,
    ) -> Result<ScientificExecutorSelection, JobExecutorError> {
        let prepared_payload = self
            .resolver
            .resolve(request)
            .map_err(|_| JobExecutorError::PreflightRefused)?;
        Ok(ScientificExecutorSelection {
            execution_backend: "dag-ml-core".into(),
            execution_mode: Some("bounded-cpython-stdio".into()),
            prepared_payload,
        })
    }

    fn submit_scientific(
        &self,
        _request: &ScientificExecutionRequest,
        _terminal: Arc<dyn ScientificJobTerminal>,
    ) -> Result<(), JobExecutorError> {
        panic!("a refused resolver preflight must never submit")
    }

    fn request_cooperative_cancel(&self, _job_id: &str) -> Result<(), JobExecutorError> {
        Err(JobExecutorError::CancellationRefused)
    }
}

impl ScientificJobExecutor for ImmediateCancelAckExecutor {
    fn is_selected(&self) -> bool {
        true
    }

    fn preflight_submission(
        &self,
        _request: &ScientificSubmissionPreflight,
    ) -> Result<ScientificExecutorSelection, JobExecutorError> {
        Ok(ScientificExecutorSelection {
            execution_backend: "dag-ml-core".into(),
            execution_mode: Some("bounded-library-host".into()),
            prepared_payload: json!({}),
        })
    }

    fn submit_scientific(
        &self,
        _request: &ScientificExecutionRequest,
        terminal: Arc<dyn ScientificJobTerminal>,
    ) -> Result<(), JobExecutorError> {
        self.terminal.lock().unwrap().replace(terminal);
        Ok(())
    }

    fn request_cooperative_cancel(&self, job_id: &str) -> Result<(), JobExecutorError> {
        self.terminal
            .lock()
            .unwrap()
            .as_ref()
            .ok_or(JobExecutorError::CancellationRefused)?
            .acknowledge_cancel(job_id)
            .map_err(|_| JobExecutorError::CancellationRefused)
    }
}

impl ScientificJobExecutor for RecordingScientificExecutor {
    fn is_selected(&self) -> bool {
        true
    }

    fn preflight_submission(
        &self,
        request: &ScientificSubmissionPreflight,
    ) -> Result<ScientificExecutorSelection, JobExecutorError> {
        self.preflights.fetch_add(1, Ordering::Relaxed);
        self.workspace_paths
            .lock()
            .unwrap()
            .push(request.workspace_path.clone());
        Ok(ScientificExecutorSelection {
            execution_backend: "dag-ml-core".into(),
            execution_mode: Some("bounded-library-host".into()),
            prepared_payload: json!({}),
        })
    }

    fn submit_scientific(
        &self,
        request: &ScientificExecutionRequest,
        _terminal: Arc<dyn ScientificJobTerminal>,
    ) -> Result<(), JobExecutorError> {
        assert!(request.job_id.starts_with("run_native_"));
        assert_eq!(request.requested_backend, "cluster");
        self.submissions.fetch_add(1, Ordering::Relaxed);
        Ok(())
    }

    fn request_cooperative_cancel(&self, _job_id: &str) -> Result<(), JobExecutorError> {
        self.cancellations.fetch_add(1, Ordering::Relaxed);
        Ok(())
    }
}

fn test_directory(name: &str) -> PathBuf {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    std::env::temp_dir().join(format!(
        "studio-scientific-submission-{name}-{}-{nonce}",
        std::process::id()
    ))
}

fn configure_active_workspace(config: &Path, workspace: &Path) {
    fs::create_dir_all(config).unwrap();
    fs::create_dir_all(workspace.join("runs")).unwrap();
    fs::write(
        config.join("app_settings.json"),
        serde_json::to_vec(&json!({
            "version": 1,
            "linked_workspaces": [{
                "id": "workspace-a",
                "path": workspace.to_string_lossy(),
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
}

fn valid_payload() -> Value {
    json!({
        "legacyConfig": {
            "name": "Native campaign",
            "description": "Rust-owned submission transport",
            "dataset_ids": ["dataset-a"],
            "pipeline_ids": ["pipeline-a"],
            "execution_backend": "cluster",
            "engine": "dag-ml",
            "allow_fallback": false,
            "cv_folds": 5,
            "cv_strategy": "kfold",
            "shuffle": true,
            "random_state": 42,
            "split_group_by_by_dataset": {"dataset-a": "subject"}
        },
        "manifest": {
            "version": "studio.native-launch-payload.v1",
            "legacyExperimentName": "Native campaign",
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
                    "name": "Native campaign / Dataset A / Pipeline A",
                    "description": "Rust-owned submission transport",
                    "mode": "paired_by_index",
                    "executionBackend": "cluster",
                    "datasets": [{
                        "id": "dataset-a",
                        "name": "Dataset A",
                        "splitGroupBy": "subject"
                    }],
                    "pipelines": [{
                        "id": "pipeline-a",
                        "name": "Pipeline A",
                        "source": "saved"
                    }],
                    "runMatrix": [{
                        "id": "dataset-a::pipeline-a",
                        "datasetId": "dataset-a",
                        "pipelineId": "pipeline-a",
                        "datasetIndex": 0,
                        "pipelineIndex": 0,
                        "splitGroupBy": "subject"
                    }]
                }
            }],
            "skippedRunIds": []
        }
    })
}

fn body(response: &studio_sidecar::HttpResponse) -> Value {
    serde_json::from_str(&response.body).unwrap()
}

#[test]
fn submission_contract_is_anchored_to_the_product_route_and_capabilities_are_honest() {
    let studio_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .to_path_buf();
    let contract: Value = serde_json::from_str(
        &fs::read_to_string(
            studio_root.join("sidecar/contracts/studio_scientific_submission_v1.json"),
        )
        .unwrap(),
    )
    .unwrap();
    assert_eq!(contract["route"]["method"], "POST");
    assert_eq!(contract["route"]["path"], "/api/runs/run-groups");
    assert_eq!(contract["route"]["maximum_body_bytes"], 65_536);
    let route_oracle: Value = serde_json::from_str(
        &fs::read_to_string(
            studio_root.join("docs/contracts/studio-v1/fixtures/routes.snapshot.json"),
        )
        .unwrap(),
    )
    .unwrap();
    let frozen = route_oracle["routes"]
        .as_array()
        .unwrap()
        .iter()
        .find(|route| route["path"] == "/api/runs/run-groups")
        .unwrap();
    assert_eq!(frozen["methods"], json!(["POST"]));

    let mut state = SidecarState::default();
    let capabilities = body(&route_request(
        &mut state,
        "GET",
        "/sidecar/v1/capabilities",
    ));
    assert_eq!(
        capabilities["features"]["native_scientific_submission_routes"],
        true
    );
    assert_eq!(
        capabilities["features"]["scientific_submission_transport"],
        true
    );
    assert_eq!(capabilities["features"]["scientific_execution"], false);
    assert_eq!(capabilities["features"]["python_plugin_execution"], false);
}

#[test]
fn default_executor_refuses_before_body_workspace_or_registry_mutation() {
    let root = test_directory("unselected");
    let config = root.join("config");
    fs::create_dir_all(config.join("app_settings.json")).unwrap();
    let runtime = Arc::new(NativeJobRuntime::default());
    let mut state =
        SidecarState::with_native_jobs_and_app_settings_dir(Arc::clone(&runtime), &config);

    let response = route_request_with_body(
        &mut state,
        "POST",
        "/api/runs/run-groups",
        b"not json and must not be parsed",
    );
    assert_eq!(response.status, 503);
    assert_eq!(
        body(&response),
        json!({"detail": "Scientific job executor is not selected; submission was not accepted"})
    );
    assert!(runtime.get_at("must-not-exist", Instant::now()).is_none());
    assert!(config.join("app_settings.json").is_dir());
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn invalid_and_oversized_submissions_never_call_the_executor_or_write_a_job() {
    let root = test_directory("invalid");
    let config = root.join("config");
    let workspace = root.join("workspace");
    configure_active_workspace(&config, &workspace);
    let executor = Arc::new(RecordingScientificExecutor::default());
    let runtime = Arc::new(NativeJobRuntime::with_executor(executor.clone()));
    let mut state = SidecarState::with_native_jobs_and_app_settings_dir(runtime, &config);

    let mut invalid = valid_payload();
    invalid["legacyConfig"]["unknown"] = json!(true);
    let response = route_request_with_body(
        &mut state,
        "POST",
        "/api/runs/run-groups",
        &serde_json::to_vec(&invalid).unwrap(),
    );
    assert_eq!(response.status, 422);

    let oversized = vec![b' '; MAX_REQUEST_BODY_BYTES + 1];
    let response = route_request_with_body(&mut state, "POST", "/api/runs/run-groups", &oversized);
    assert_eq!(response.status, 413);
    assert_eq!(executor.preflights.load(Ordering::Relaxed), 0);
    assert_eq!(executor.submissions.load(Ordering::Relaxed), 0);
    assert_eq!(fs::read_dir(workspace.join("runs")).unwrap().count(), 0);
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn resolver_id_mismatch_is_refused_before_registry_events_or_durable_mutation() {
    let root = test_directory("resolver-id-mismatch");
    let config = root.join("config");
    let workspace = root.join("workspace");
    configure_active_workspace(&config, &workspace);
    let runtime = Arc::new(NativeJobRuntime::with_executor(Arc::new(
        ResolvingExecutor {
            resolver: ScientificRequestResolver::new(&config),
        },
    )));
    let mut state =
        SidecarState::with_native_jobs_and_app_settings_dir(Arc::clone(&runtime), &config);
    let mut payload = valid_payload();
    payload["legacyConfig"]["execution_backend"] = json!("local-python");
    payload["legacyConfig"]["pipeline_ids"] = json!(["pipeline-other"]);
    payload["legacyConfig"]["split_group_by_by_dataset"] = json!({});
    payload["strictCampaignSpecs"]["splitSpecs"][0]["campaign"]["executionBackend"] =
        json!("local-python");

    let response = route_request_with_body(
        &mut state,
        "POST",
        "/api/runs/run-groups",
        &serde_json::to_vec(&payload).unwrap(),
    );
    assert_eq!(response.status, 503);
    assert_eq!(runtime.published_event_count(), 0);
    assert_eq!(runtime.durable_write_count(), 0);
    assert_eq!(fs::read_dir(workspace.join("runs")).unwrap().count(), 0);
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn selected_submission_registers_publishes_persists_and_submits_once() {
    let root = test_directory("accepted");
    let config = root.join("config");
    let workspace = root.join("workspace");
    configure_active_workspace(&config, &workspace);
    let executor = Arc::new(RecordingScientificExecutor::default());
    let runtime = Arc::new(NativeJobRuntime::with_executor(executor.clone()));
    let mut state =
        SidecarState::with_native_jobs_and_app_settings_dir(Arc::clone(&runtime), &config);

    let response = route_request_with_body(
        &mut state,
        "POST",
        "/api/runs/run-groups",
        &serde_json::to_vec(&valid_payload()).unwrap(),
    );
    assert_eq!(response.status, 202);
    let response_body = body(&response);
    let keys = response_body
        .as_object()
        .unwrap()
        .keys()
        .map(String::as_str)
        .collect::<BTreeSet<_>>();
    assert_eq!(
        keys,
        BTreeSet::from([
            "created_at",
            "execution_backend",
            "id",
            "job_id",
            "name",
            "requested_backend",
            "status",
            "submission_transport",
            "type",
            "workspace_id",
        ])
    );
    assert_eq!(response_body["id"], response_body["job_id"]);
    assert_eq!(response_body["name"], "Native campaign");
    assert_eq!(response_body["status"], "running");
    assert_eq!(response_body["type"], "training");
    assert_eq!(response_body["requested_backend"], "cluster");
    assert_eq!(response_body["execution_backend"], "dag-ml-core");
    assert_eq!(response_body["submission_transport"], "studio-sidecar-rust");
    assert_eq!(response_body["workspace_id"], "workspace-a");
    assert_eq!(executor.preflights.load(Ordering::Relaxed), 1);
    assert_eq!(executor.submissions.load(Ordering::Relaxed), 1);
    assert_eq!(runtime.published_event_count(), 1);
    assert_eq!(runtime.durable_write_count(), 1);
    assert_eq!(
        executor.workspace_paths.lock().unwrap().as_slice(),
        [workspace.canonicalize().unwrap()]
    );

    let job_id = response_body["job_id"].as_str().unwrap();
    let snapshot = runtime.get_at(job_id, Instant::now()).unwrap();
    assert_eq!(snapshot.status.as_str(), "running");
    let job_directory = workspace.join("runs").join(job_id);
    assert_eq!(fs::read_dir(&job_directory).unwrap().count(), 1);
    let record = read_execution_job_record(&workspace, job_id).unwrap();
    assert_eq!(record["status"], "running");
    assert_eq!(record["requested_backend"], "cluster");
    assert_eq!(record["execution_backend"], "dag-ml-core");
    assert_eq!(record["execution_mode"], "bounded-library-host");
    assert_eq!(record["request"], valid_payload());

    let cancel = route_request(&mut state, "POST", &format!("/api/runs/{job_id}/stop"));
    assert_eq!(cancel.status, 200);
    assert_eq!(
        body(&cancel),
        json!({
            "success": true,
            "message": format!("Run {job_id} stopped"),
            "run_id": job_id,
        })
    );
    assert_eq!(executor.cancellations.load(Ordering::Relaxed), 1);
    assert_eq!(runtime.published_event_count(), 1);
    assert_eq!(runtime.durable_write_count(), 1);
    assert!(runtime
        .get_at(job_id, Instant::now())
        .unwrap()
        .cancellation_requested());
    runtime
        .acknowledge_cancel_at(job_id, "2026-09-01T12:01:00Z", Instant::now())
        .unwrap();
    assert_eq!(runtime.published_event_count(), 2);
    assert_eq!(runtime.durable_write_count(), 2);
    assert_eq!(
        read_execution_job_record(&workspace, job_id).unwrap()["status"],
        "cancelled"
    );
    assert_eq!(fs::read_dir(job_directory).unwrap().count(), 1);
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn terminal_callback_completes_publishes_and_persists_under_rust_ownership() {
    let root = test_directory("terminal");
    let config = root.join("config");
    let workspace = root.join("workspace");
    configure_active_workspace(&config, &workspace);
    let runtime = Arc::new(NativeJobRuntime::with_executor(Arc::new(
        CompletingScientificExecutor,
    )));
    let mut state =
        SidecarState::with_native_jobs_and_app_settings_dir(Arc::clone(&runtime), &config);

    let response = route_request_with_body(
        &mut state,
        "POST",
        "/api/runs/run-groups",
        &serde_json::to_vec(&valid_payload()).unwrap(),
    );
    assert_eq!(response.status, 202);
    let job_id = body(&response)["job_id"].as_str().unwrap().to_owned();
    let snapshot = runtime.get_at(&job_id, Instant::now()).unwrap();
    assert_eq!(snapshot.status.as_str(), "completed");
    assert_eq!(runtime.published_event_count(), 2);
    assert_eq!(runtime.durable_write_count(), 2);
    let record = read_execution_job_record(&workspace, &job_id).unwrap();
    assert_eq!(record["status"], "completed");
    assert_eq!(record["execution_backend"], "dag-ml-core");
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn immediate_worker_cancel_ack_cannot_race_ahead_of_rust_intent() {
    let root = test_directory("cancel-race");
    let config = root.join("config");
    let workspace = root.join("workspace");
    configure_active_workspace(&config, &workspace);
    let runtime = Arc::new(NativeJobRuntime::with_executor(Arc::new(
        ImmediateCancelAckExecutor::default(),
    )));
    let mut state =
        SidecarState::with_native_jobs_and_app_settings_dir(Arc::clone(&runtime), &config);
    let response = route_request_with_body(
        &mut state,
        "POST",
        "/api/runs/run-groups",
        &serde_json::to_vec(&valid_payload()).unwrap(),
    );
    assert_eq!(response.status, 202);
    let job_id = body(&response)["job_id"].as_str().unwrap().to_owned();

    let cancel = route_request(&mut state, "POST", &format!("/api/runs/{job_id}/stop"));
    assert_eq!(cancel.status, 200);
    assert_eq!(
        runtime
            .get_at(&job_id, Instant::now())
            .unwrap()
            .status
            .as_str(),
        "cancelled"
    );
    assert_eq!(runtime.published_event_count(), 2);
    assert_eq!(runtime.durable_write_count(), 2);
    assert_eq!(
        read_execution_job_record(&workspace, &job_id).unwrap()["status"],
        "cancelled"
    );
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn method_and_query_refusals_are_exact_and_do_not_call_the_executor() {
    let root = test_directory("method");
    let config = root.join("config");
    let workspace = root.join("workspace");
    configure_active_workspace(&config, &workspace);
    let executor = Arc::new(RecordingScientificExecutor::default());
    let runtime = Arc::new(NativeJobRuntime::with_executor(executor.clone()));
    let mut state = SidecarState::with_native_jobs_and_app_settings_dir(runtime, &config);

    let method = route_request(&mut state, "GET", "/api/runs/run-groups");
    assert_eq!(method.status, 405);
    let method_body = body(&method);
    assert_eq!(method_body["error"]["code"], "method_not_allowed");
    assert_eq!(method_body["error"]["details"]["allowed_methods"], "POST");
    assert_eq!(executor.preflights.load(Ordering::Relaxed), 0);
    assert_eq!(executor.submissions.load(Ordering::Relaxed), 0);
    fs::remove_dir_all(root).unwrap();
}

#[cfg(unix)]
#[test]
fn workspace_symlinks_are_rejected_before_executor_preflight() {
    use std::os::unix::fs::symlink;

    let root = test_directory("symlink");
    let config = root.join("config");
    let real_workspace = root.join("real-workspace");
    let linked_workspace = root.join("linked-workspace");
    fs::create_dir_all(real_workspace.join("runs")).unwrap();
    symlink(&real_workspace, &linked_workspace).unwrap();
    configure_active_workspace(&config, &linked_workspace);
    let executor = Arc::new(RecordingScientificExecutor::default());
    let runtime = Arc::new(NativeJobRuntime::with_executor(executor.clone()));
    let mut state = SidecarState::with_native_jobs_and_app_settings_dir(runtime, &config);

    let response = route_request_with_body(
        &mut state,
        "POST",
        "/api/runs/run-groups",
        &serde_json::to_vec(&valid_payload()).unwrap(),
    );
    assert_eq!(response.status, 409);
    assert_eq!(executor.preflights.load(Ordering::Relaxed), 0);
    assert_eq!(executor.submissions.load(Ordering::Relaxed), 0);
    assert_eq!(
        fs::read_dir(real_workspace.join("runs")).unwrap().count(),
        0
    );
    fs::remove_dir_all(root).unwrap();
}
