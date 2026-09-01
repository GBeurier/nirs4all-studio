use std::{
    collections::BTreeSet,
    fs,
    path::PathBuf,
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    },
    time::Instant,
};

use serde_json::{json, Value};
use studio_sidecar::{
    job_http::{
        route_native_job_request, JobExecutorError, JobHttpSurface, NativeJobRuntime,
        NativeJobRuntimeError, ScientificJobExecutor, DURABLE_WORKSPACE_JOB_READ_ROUTES,
        JOB_HTTP_ROUTES, MAX_JOB_EVENT_DATA_BYTES,
    },
    job_lifecycle::{JobStatus, JobType},
};

const CREATED: &str = "2026-09-01T12:00:00Z";

#[derive(Debug, Default)]
struct RecordingExecutor {
    cancellations: AtomicUsize,
}

impl ScientificJobExecutor for RecordingExecutor {
    fn is_selected(&self) -> bool {
        true
    }

    fn request_cooperative_cancel(&self, _job_id: &str) -> Result<(), JobExecutorError> {
        self.cancellations.fetch_add(1, Ordering::Relaxed);
        Ok(())
    }
}

fn studio_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("sidecar crate must be inside Studio")
        .to_path_buf()
}

fn body(response: &studio_sidecar::HttpResponse) -> Value {
    serde_json::from_str(&response.body).unwrap()
}

fn keys(value: &Value) -> BTreeSet<&str> {
    value
        .as_object()
        .unwrap()
        .keys()
        .map(String::as_str)
        .collect()
}

#[test]
fn route_mapping_matches_the_frozen_oracle_and_excludes_durable_reads() {
    let root = studio_root();
    let contract: Value = serde_json::from_str(
        &fs::read_to_string(root.join("sidecar/contracts/studio_job_lifecycle_v1.json")).unwrap(),
    )
    .unwrap();
    let oracle: Value = serde_json::from_str(
        &fs::read_to_string(root.join("docs/contracts/studio-v1/fixtures/behavior.snapshot.json"))
            .unwrap(),
    )
    .unwrap();
    let route_oracle: Value = serde_json::from_str(
        &fs::read_to_string(root.join("docs/contracts/studio-v1/fixtures/routes.snapshot.json"))
            .unwrap(),
    )
    .unwrap();
    let frozen_routes = route_oracle["routes"].as_array().unwrap();

    for mapping in JOB_HTTP_ROUTES {
        let frozen = frozen_routes
            .iter()
            .find(|route| route["path"] == mapping.path)
            .unwrap_or_else(|| panic!("missing frozen route {}", mapping.path));
        assert_eq!(
            frozen["methods"],
            json!([mapping.method]),
            "{} method drifted",
            mapping.path
        );
    }

    let mapped_cancellations = JOB_HTTP_ROUTES
        .iter()
        .filter(|route| route.method == "POST")
        .map(|route| route.path)
        .collect::<BTreeSet<_>>();
    let oracle_cancellations = oracle["jobs"]["cancellation_endpoints"]
        .as_array()
        .unwrap()
        .iter()
        .map(|entry| entry["path"].as_str().unwrap())
        .collect::<BTreeSet<_>>();
    assert_eq!(mapped_cancellations, oracle_cancellations);

    let mapped_status = JOB_HTTP_ROUTES
        .iter()
        .filter(|route| route.method == "GET")
        .map(|route| route.path)
        .collect::<Vec<_>>();
    assert_eq!(
        mapped_status,
        contract["job"]["http_status"]["legacy_endpoints"]
            .as_array()
            .unwrap()
            .iter()
            .map(|value| value.as_str().unwrap())
            .collect::<Vec<_>>()
    );
    assert_eq!(
        DURABLE_WORKSPACE_JOB_READ_ROUTES,
        contract["job"]["http_status"]["durable_workspace_reads_excluded"]
            .as_array()
            .unwrap()
            .iter()
            .map(|value| value.as_str().unwrap())
            .collect::<Vec<_>>()
            .as_slice()
    );
    assert!(JOB_HTTP_ROUTES
        .iter()
        .all(|route| { !DURABLE_WORKSPACE_JOB_READ_ROUTES.contains(&route.path) }));
    assert_eq!(JOB_HTTP_ROUTES.len(), 8);
    assert_eq!(
        JOB_HTTP_ROUTES
            .iter()
            .filter(|route| matches!(
                route.surface,
                JobHttpSurface::TrainingStatus
                    | JobHttpSurface::AutomlStatus
                    | JobHttpSurface::UpdateDownloadStatus
            ))
            .count(),
        3
    );
    for durable in DURABLE_WORKSPACE_JOB_READ_ROUTES {
        let frozen = frozen_routes
            .iter()
            .find(|route| route["path"] == durable)
            .unwrap_or_else(|| panic!("missing durable frozen route {durable}"));
        assert_eq!(frozen["methods"], json!(["GET"]));
    }
}

#[test]
fn default_runtime_refuses_scientific_registration() {
    let runtime = NativeJobRuntime::default();
    assert!(!runtime.execution_selected());
    assert_eq!(
        runtime.register_with_id_at(
            "must-not-exist",
            JobType::Training,
            json!({}),
            CREATED,
            Instant::now(),
        ),
        Err(NativeJobRuntimeError::Executor(
            JobExecutorError::Unselected
        ))
    );
    assert!(runtime.get_at("must-not-exist", Instant::now()).is_none());
}

#[test]
fn three_status_aliases_project_the_frozen_legacy_shapes() {
    let runtime = NativeJobRuntime::with_executor(Arc::new(RecordingExecutor::default()));
    let now = Instant::now();
    runtime
        .register_with_id_at(
            "training-1",
            JobType::Training,
            json!({"folds": 5}),
            CREATED,
            now,
        )
        .unwrap();
    runtime
        .register_with_id_at(
            "automl-1",
            JobType::Automl,
            json!({"n_trials": 12}),
            CREATED,
            now,
        )
        .unwrap();
    runtime
        .register_with_id_at(
            "download-1",
            JobType::UpdateDownload,
            json!({"asset_name": "studio.zip"}),
            CREATED,
            now,
        )
        .unwrap();

    let training = route_native_job_request(&runtime, "GET", "/api/training/training-1");
    assert_eq!(training.status, 200);
    assert_eq!(
        body(&training)
            .as_object()
            .unwrap()
            .keys()
            .map(String::as_str)
            .collect::<BTreeSet<_>>(),
        BTreeSet::from([
            "job_id",
            "status",
            "progress",
            "progress_message",
            "created_at",
            "started_at",
            "completed_at",
            "duration_seconds",
            "config",
            "metrics",
            "error",
        ])
    );
    let automl = body(&route_native_job_request(
        &runtime,
        "GET",
        "/api/automl/automl-1",
    ));
    assert_eq!(automl["trials_total"], 12);
    assert_eq!(automl["trials_completed"], 0);
    assert_eq!(
        keys(&automl),
        BTreeSet::from([
            "job_id",
            "status",
            "progress",
            "progress_message",
            "trials_completed",
            "trials_total",
            "best_score",
            "best_model",
            "elapsed_seconds",
            "created_at",
        ])
    );
    let download = body(&route_native_job_request(
        &runtime,
        "GET",
        "/api/updates/webapp/download-status/download-1",
    ));
    assert_eq!(download["job_id"], "download-1");
    assert_eq!(download["result"], Value::Null);
    assert_eq!(
        keys(&download),
        BTreeSet::from(["job_id", "status", "progress", "message", "result", "error"])
    );

    assert_eq!(
        route_native_job_request(&runtime, "GET", "/api/training/automl-1").status,
        400
    );
}

#[test]
fn automl_status_fails_closed_on_an_invalid_public_shape() {
    let runtime = NativeJobRuntime::with_executor(Arc::new(RecordingExecutor::default()));
    let now = Instant::now();
    runtime
        .register_with_id_at("automl", JobType::Automl, json!({}), CREATED, now)
        .unwrap();
    runtime
        .metrics_at(
            "automl",
            json!({"trials_completed": "invalid"}),
            "2026-09-01T12:00:01Z",
            now,
        )
        .unwrap();
    assert_eq!(
        route_native_job_request(&runtime, "GET", "/api/automl/automl").status,
        500
    );
}

#[test]
fn pending_and_running_cancellation_have_exact_cooperative_semantics() {
    let executor = Arc::new(RecordingExecutor::default());
    let runtime = NativeJobRuntime::with_executor(executor.clone());
    let now = Instant::now();
    runtime
        .register_with_id_at("pending", JobType::Training, json!({}), CREATED, now)
        .unwrap();
    let pending = route_native_job_request(&runtime, "POST", "/api/training/pending/stop");
    assert_eq!(pending.status, 200);
    assert_eq!(body(&pending)["status"], "cancelled");
    assert_eq!(
        runtime.get_at("pending", now).unwrap().error.as_deref(),
        Some("Job was cancelled")
    );

    runtime
        .register_with_id_at(
            "running",
            JobType::Automl,
            json!({"n_trials": 3}),
            CREATED,
            now,
        )
        .unwrap();
    runtime
        .start_at("running", "2026-09-01T12:00:01Z", now)
        .unwrap();
    let running = route_native_job_request(&runtime, "POST", "/api/automl/running/stop");
    assert_eq!(running.status, 200);
    assert_eq!(body(&running)["status"], "running");
    let requested = runtime.get_at("running", now).unwrap();
    assert_eq!(requested.status, JobStatus::Running);
    assert!(requested.cancellation_requested());
    assert_eq!(executor.cancellations.load(Ordering::Relaxed), 1);
    runtime
        .acknowledge_cancel_at("running", "2026-09-01T12:00:02Z", now)
        .unwrap();
    assert_eq!(
        runtime.get_at("running", now).unwrap().status,
        JobStatus::Cancelled
    );
}

#[test]
fn all_five_cancellation_aliases_reach_the_same_authoritative_registry() {
    let runtime = NativeJobRuntime::with_executor(Arc::new(RecordingExecutor::default()));
    let now = Instant::now();
    for (id, job_type, config) in [
        ("training-cancel", JobType::Training, json!({})),
        ("automl-cancel", JobType::Automl, json!({"n_trials": 2})),
        (
            "execution-cancel",
            JobType::Training,
            json!({"execution_backend": "native-rust", "run_id": "run-a"}),
        ),
        (
            "run-cancel",
            JobType::Training,
            json!({"run_id": "run-cancel"}),
        ),
        ("download-cancel", JobType::UpdateDownload, json!({})),
    ] {
        runtime
            .register_with_id_at(id, job_type, config, CREATED, now)
            .unwrap();
    }

    let cases = [
        (
            "/api/training/training-cancel/stop",
            "training-cancel",
            &["success", "job_id", "status", "message"][..],
        ),
        (
            "/api/automl/automl-cancel/stop",
            "automl-cancel",
            &["success", "job_id", "status", "message"][..],
        ),
        (
            "/api/runs/execution-job-records/execution-cancel/cancel",
            "execution-cancel",
            &[
                "action", "job_id", "success", "message", "backend", "run_id", "metadata",
            ][..],
        ),
        (
            "/api/runs/run-cancel/stop",
            "run-cancel",
            &["success", "message", "run_id"][..],
        ),
        (
            "/api/updates/webapp/download-cancel/download-cancel",
            "download-cancel",
            &["success", "message"][..],
        ),
    ];
    for (path, id, expected_keys) in cases {
        let response = route_native_job_request(&runtime, "POST", path);
        assert_eq!(response.status, 200, "{path}: {}", response.body);
        assert_eq!(
            keys(&body(&response)),
            expected_keys.iter().copied().collect(),
            "{path}"
        );
        assert_eq!(
            runtime.get_at(id, now).unwrap().status,
            JobStatus::Cancelled,
            "{path}"
        );
    }

    let execution = body(&route_native_job_request(
        &runtime,
        "POST",
        "/api/runs/execution-job-records/execution-cancel/cancel",
    ));
    assert_eq!(execution["success"], false);
    assert_eq!(execution["backend"], "native-rust");
    assert_eq!(execution["run_id"], "run-a");
    let download = body(&route_native_job_request(
        &runtime,
        "POST",
        "/api/updates/webapp/download-cancel/download-cancel",
    ));
    assert_eq!(download["success"], false);
}

#[test]
fn known_aliases_reject_wrong_methods_without_mutating_state() {
    let runtime = NativeJobRuntime::with_executor(Arc::new(RecordingExecutor::default()));
    let now = Instant::now();
    runtime
        .register_with_id_at("method", JobType::Training, json!({}), CREATED, now)
        .unwrap();
    assert_eq!(
        route_native_job_request(&runtime, "POST", "/api/training/method").status,
        405
    );
    assert_eq!(
        route_native_job_request(&runtime, "GET", "/api/training/method/stop").status,
        405
    );
    assert_eq!(
        runtime.get_at("method", now).unwrap().status,
        JobStatus::Pending
    );
}

#[test]
fn event_size_is_refused_before_any_unpublishable_state_mutation() {
    let runtime = NativeJobRuntime::with_executor(Arc::new(RecordingExecutor::default()));
    let now = Instant::now();
    let oversized = "x".repeat(MAX_JOB_EVENT_DATA_BYTES + 1);
    assert_eq!(
        runtime.register_with_id_at(
            "oversized-create",
            JobType::Training,
            json!({"payload": oversized}),
            CREATED,
            now,
        ),
        Err(NativeJobRuntimeError::WebSocket(
            studio_sidecar::websocket_transport::LegacyEnvelopeError::TooLarge
        ))
    );
    assert!(runtime.get_at("oversized-create", now).is_none());

    runtime
        .register_with_id_at("bounded", JobType::Training, json!({}), CREATED, now)
        .unwrap();
    runtime
        .start_at("bounded", "2026-09-01T12:00:01Z", now)
        .unwrap();
    assert_eq!(
        runtime.progress_at(
            "bounded",
            50.0,
            "x".repeat(MAX_JOB_EVENT_DATA_BYTES + 1),
            "2026-09-01T12:00:02Z",
            now,
        ),
        Err(NativeJobRuntimeError::WebSocket(
            studio_sidecar::websocket_transport::LegacyEnvelopeError::TooLarge
        ))
    );
    let unchanged = runtime.get_at("bounded", now).unwrap();
    assert!(unchanged.progress.abs() < f64::EPSILON);
    assert!(unchanged.progress_message.is_empty());
}

#[test]
fn scientific_submission_and_durable_reads_stay_outside_the_memory_adapter() {
    let runtime = NativeJobRuntime::default();
    for path in [
        "/api/training/start",
        "/api/runs/execution-job-records/opaque",
        "/api/runs/run-1/execution-job-record",
    ] {
        let response = route_native_job_request(&runtime, "GET", path);
        assert_eq!(response.status, 404, "{path}");
    }
}
