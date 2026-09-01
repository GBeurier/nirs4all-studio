use std::{
    collections::BTreeSet,
    sync::{Arc, Mutex},
    thread,
    time::{Duration, Instant},
};

use serde_json::{json, Value};
use studio_sidecar::job_lifecycle::{
    JobLifecycleError, JobRegistry, JobStatus, JobType, LegacyJobEventType,
};

const CREATED: &str = "2026-08-20T12:00:00";
const STARTED: &str = "2026-08-20T12:00:01Z";
const UPDATED: &str = "2026-08-20T12:00:02.250+02:00";
const FINISHED: &str = "2026-08-20T12:00:03Z";

fn create_training(registry: &mut JobRegistry, now: Instant, id: &str) {
    registry
        .create_with_id_at(id, JobType::Training, json!({"folds": 5}), CREATED, now)
        .unwrap();
}

fn event_json(mutation: &studio_sidecar::job_lifecycle::JobMutation) -> Value {
    mutation.event.as_ref().unwrap().legacy_json()
}

#[test]
fn implementation_enums_and_event_reachability_match_the_frozen_contract() {
    let contract: Value =
        serde_json::from_str(include_str!("../contracts/studio_job_lifecycle_v1.json")).unwrap();
    assert_eq!(
        contract["job"]["statuses"],
        json!(JobStatus::ALL.map(JobStatus::as_str))
    );
    assert_eq!(
        contract["job"]["types"],
        json!(JobType::ALL.map(JobType::as_str))
    );
    assert_eq!(
        contract["legacy_websocket"]["required_emitted_job_events"],
        json!([
            LegacyJobEventType::Started.as_str(),
            LegacyJobEventType::Progress.as_str(),
            LegacyJobEventType::Metrics.as_str(),
            LegacyJobEventType::Completed.as_str(),
            LegacyJobEventType::Failed.as_str(),
        ])
    );
    assert_eq!(
        contract["legacy_websocket"]["declared_unreachable_job_events"],
        json!(["job_cancelled"])
    );
}

#[test]
fn frozen_statuses_types_and_public_fields_are_complete() {
    assert_eq!(
        JobStatus::ALL.map(JobStatus::as_str),
        ["pending", "running", "completed", "failed", "cancelled"]
    );
    assert_eq!(
        JobType::ALL.map(JobType::as_str),
        [
            "analysis",
            "automl",
            "evaluation",
            "export",
            "maintenance",
            "prediction",
            "training",
            "update_apply",
            "update_download",
            "venv_create",
            "venv_install",
        ]
    );

    let now = Instant::now();
    let mut registry = JobRegistry::default();
    let job = registry
        .create_at(JobType::Analysis, json!({}), CREATED, now)
        .unwrap();
    let public = job.public_json();
    let keys = public
        .as_object()
        .unwrap()
        .keys()
        .map(String::as_str)
        .collect::<BTreeSet<_>>();
    assert_eq!(
        keys,
        BTreeSet::from([
            "id",
            "type",
            "status",
            "created_at",
            "started_at",
            "completed_at",
            "progress",
            "progress_message",
            "config",
            "result",
            "error",
            "metrics",
            "duration_seconds",
        ])
    );
    assert_eq!(public["type"], "analysis");
    assert_eq!(public["status"], "pending");
    assert_eq!(public["duration_seconds"], Value::Null);
}

#[test]
fn happy_path_emits_exact_legacy_shapes_in_strict_sequence() {
    let base = Instant::now();
    let mut registry = JobRegistry::default();
    create_training(&mut registry, base, "contract-job");

    let started = registry
        .start_at("contract-job", STARTED, base + Duration::from_secs(1))
        .unwrap();
    assert_eq!(started.event.as_ref().unwrap().sequence(), 1);
    assert_eq!(
        started.event.as_ref().unwrap().event_type(),
        LegacyJobEventType::Started
    );
    let started_json = event_json(&started);
    assert_eq!(
        started_json
            .as_object()
            .unwrap()
            .keys()
            .map(String::as_str)
            .collect::<BTreeSet<_>>(),
        BTreeSet::from(["type", "channel", "data", "timestamp"])
    );
    assert_eq!(started_json["type"], "job_started");
    assert_eq!(started_json["channel"], "job:contract-job");
    assert_eq!(started_json["data"]["id"], "contract-job");
    assert_eq!(started_json["data"]["status"], "running");

    let progress = registry
        .progress_at(
            "contract-job",
            50.0,
            "half",
            UPDATED,
            base + Duration::from_secs(2),
        )
        .unwrap();
    assert_eq!(progress.event.as_ref().unwrap().sequence(), 2);
    assert_eq!(
        event_json(&progress)["data"],
        json!({
            "job_id": "contract-job",
            "progress": 50.0,
            "message": "half",
            "metrics": {},
        })
    );

    let metrics = registry
        .metrics_at(
            "contract-job",
            json!({"score": 0.75}),
            UPDATED,
            base + Duration::from_millis(2500),
        )
        .unwrap();
    assert_eq!(metrics.event.as_ref().unwrap().sequence(), 3);
    assert_eq!(
        metrics.event.as_ref().unwrap().event_type(),
        LegacyJobEventType::Metrics
    );
    assert_eq!(
        event_json(&metrics)["data"],
        json!({"job_id": "contract-job", "metrics": {"score": 0.75}})
    );

    let completed = registry
        .complete_at(
            "contract-job",
            json!({"outcome": "ok"}),
            FINISHED,
            base + Duration::from_secs(3),
        )
        .unwrap();
    assert_eq!(completed.event.as_ref().unwrap().sequence(), 4);
    assert_eq!(completed.job.status, JobStatus::Completed);
    assert!((completed.job.progress - 100.0).abs() < f64::EPSILON);
    assert_eq!(completed.job.duration_seconds, Some(2.0));
    assert_eq!(
        event_json(&completed)["data"],
        json!({"job_id": "contract-job", "result": {"outcome": "ok"}})
    );
}

#[test]
fn metrics_are_shallow_merged_and_progress_preserves_the_complete_snapshot() {
    let base = Instant::now();
    let mut registry = JobRegistry::default();
    create_training(&mut registry, base, "metrics-merge");
    registry.start_at("metrics-merge", STARTED, base).unwrap();

    registry
        .metrics_at(
            "metrics-merge",
            json!({"kept": 1, "replaced": "old"}),
            UPDATED,
            base,
        )
        .unwrap();
    let merged = registry
        .metrics_at(
            "metrics-merge",
            json!({"replaced": "new", "added": true}),
            UPDATED,
            base,
        )
        .unwrap();
    let expected = json!({"kept": 1, "replaced": "new", "added": true});
    assert_eq!(merged.job.metrics, expected);
    assert_eq!(event_json(&merged)["data"]["metrics"], expected);
    assert_eq!(merged.event.as_ref().unwrap().sequence(), 3);

    let progress = registry
        .progress_at("metrics-merge", 25.0, "quarter", UPDATED, base)
        .unwrap();
    assert_eq!(progress.job.metrics, expected);
    assert_eq!(event_json(&progress)["data"]["metrics"], expected);
    assert_eq!(progress.event.as_ref().unwrap().sequence(), 4);
}

#[test]
fn transitions_are_strict_and_terminal_jobs_are_immutable() {
    let base = Instant::now();
    let mut registry = JobRegistry::default();
    create_training(&mut registry, base, "strict");
    assert_eq!(
        registry.complete_at("strict", json!({}), FINISHED, base),
        Err(JobLifecycleError::InvalidTransition {
            from: JobStatus::Pending,
            operation: "complete",
        })
    );
    assert_eq!(
        registry.progress_at("strict", 1.0, "", UPDATED, base),
        Err(JobLifecycleError::InvalidTransition {
            from: JobStatus::Pending,
            operation: "progress",
        })
    );

    registry.start_at("strict", STARTED, base).unwrap();
    let terminal = registry
        .fail_at("strict", "boom", Some("trace".into()), FINISHED, base)
        .unwrap();
    assert_eq!(terminal.job.status, JobStatus::Failed);
    assert_eq!(
        event_json(&terminal)["data"],
        json!({"job_id": "strict", "error": "boom", "traceback": "trace"})
    );
    let before = registry.get_at("strict", base).unwrap();
    assert_eq!(
        registry.fail_at("strict", "again", None, FINISHED, base),
        Err(JobLifecycleError::TerminalState(JobStatus::Failed))
    );
    assert_eq!(
        registry.progress_at("strict", 10.0, "late", UPDATED, base),
        Err(JobLifecycleError::TerminalState(JobStatus::Failed))
    );
    assert_eq!(
        registry.request_cancel_at("strict", FINISHED, base),
        Err(JobLifecycleError::TerminalState(JobStatus::Failed))
    );
    assert_eq!(registry.get_at("strict", base).unwrap(), before);
}

#[test]
fn pending_and_running_cancellation_preserve_legacy_behavior() {
    let base = Instant::now();
    let mut registry = JobRegistry::default();
    create_training(&mut registry, base, "pending");
    let cancelled = registry
        .request_cancel_at("pending", FINISHED, base + Duration::from_secs(1))
        .unwrap();
    assert_eq!(cancelled.job.status, JobStatus::Cancelled);
    assert_eq!(cancelled.job.error.as_deref(), Some("Job was cancelled"));
    assert_eq!(
        cancelled.event.as_ref().unwrap().event_type(),
        LegacyJobEventType::Failed
    );
    let cancelled_json = event_json(&cancelled);
    assert_eq!(cancelled_json["type"], "job_failed");
    assert_eq!(
        cancelled_json["data"],
        json!({
            "job_id": "pending",
            "error": "Job was cancelled",
            "traceback": null,
        })
    );
    assert_ne!(cancelled_json["type"], "job_cancelled");

    create_training(&mut registry, base, "running");
    registry.start_at("running", STARTED, base).unwrap();
    let requested = registry
        .request_cancel_at("running", UPDATED, base + Duration::from_secs(1))
        .unwrap();
    assert_eq!(requested.job.status, JobStatus::Running);
    assert!(requested.job.cancellation_requested());
    assert!(requested.event.is_none());
    let repeated = registry
        .request_cancel_at("running", UPDATED, base + Duration::from_secs(1))
        .unwrap();
    assert!(repeated.event.is_none());

    let acknowledged = registry
        .acknowledge_cancel_at("running", FINISHED, base + Duration::from_secs(2))
        .unwrap();
    assert_eq!(acknowledged.job.status, JobStatus::Cancelled);
    assert_eq!(acknowledged.event.as_ref().unwrap().sequence(), 2);
    assert_eq!(event_json(&acknowledged)["type"], "job_failed");
    assert_eq!(
        registry.acknowledge_cancel_at("running", FINISHED, base),
        Err(JobLifecycleError::TerminalState(JobStatus::Cancelled))
    );
}

#[test]
fn normal_completion_cooperatively_honors_a_running_cancel_request() {
    let base = Instant::now();
    let mut registry = JobRegistry::default();
    create_training(&mut registry, base, "cooperative");
    registry.start_at("cooperative", STARTED, base).unwrap();
    registry
        .request_cancel_at("cooperative", UPDATED, base)
        .unwrap();
    let finished = registry
        .complete_at(
            "cooperative",
            json!({"must_be_discarded": true}),
            FINISHED,
            base,
        )
        .unwrap();
    assert_eq!(finished.job.status, JobStatus::Cancelled);
    assert!(finished.job.result.is_none());
    assert_eq!(event_json(&finished)["type"], "job_failed");
}

#[test]
fn finite_progress_is_clamped_and_may_move_backwards() {
    let base = Instant::now();
    let mut registry = JobRegistry::default();
    create_training(&mut registry, base, "progress");
    registry.start_at("progress", STARTED, base).unwrap();
    let high = registry
        .progress_at("progress", 125.0, "high", UPDATED, base)
        .unwrap()
        .job
        .progress;
    assert!((high - 100.0).abs() < f64::EPSILON);
    let backwards = registry
        .progress_at("progress", 10.0, "back", UPDATED, base)
        .unwrap()
        .job
        .progress;
    assert!((backwards - 10.0).abs() < f64::EPSILON);
    let low = registry
        .progress_at("progress", -5.0, "low", UPDATED, base)
        .unwrap()
        .job
        .progress;
    assert!(low.abs() < f64::EPSILON);
    for invalid in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
        assert_eq!(
            registry.progress_at("progress", invalid, "bad", UPDATED, base),
            Err(JobLifecycleError::InvalidProgress)
        );
    }
}

#[test]
fn result_metrics_config_ids_and_timestamps_are_fail_closed() {
    let base = Instant::now();
    let mut registry = JobRegistry::default();
    for value in [Value::Null, json!([]), json!("text"), json!(1)] {
        assert_eq!(
            registry.create_at(JobType::Analysis, value, CREATED, base),
            Err(JobLifecycleError::InvalidJsonObject("config"))
        );
    }
    assert_eq!(
        registry.create_with_id_at("bad/id", JobType::Analysis, json!({}), CREATED, base),
        Err(JobLifecycleError::InvalidJobId)
    );
    assert_eq!(
        registry.create_at(JobType::Analysis, json!({}), "not-a-date", base),
        Err(JobLifecycleError::InvalidTimestamp)
    );
    let oversized_timestamp = format!("2026-08-20T12:00:00.{}Z", "1".repeat(64));
    assert_eq!(
        registry.create_at(JobType::Analysis, json!({}), &oversized_timestamp, base,),
        Err(JobLifecycleError::InvalidTimestamp)
    );

    create_training(&mut registry, base, "json");
    registry.start_at("json", STARTED, base).unwrap();
    assert_eq!(
        registry.metrics_at("json", json!([1]), UPDATED, base),
        Err(JobLifecycleError::InvalidJsonObject("metrics"))
    );
    assert_eq!(
        registry.complete_at("json", json!(true), FINISHED, base),
        Err(JobLifecycleError::InvalidJsonObject("result"))
    );
    assert_eq!(
        registry.get_at("json", base).unwrap().status,
        JobStatus::Running
    );
}

#[test]
fn capacity_prunes_or_evicts_only_terminal_jobs_and_never_active_jobs() {
    let base = Instant::now();
    let mut registry = JobRegistry::with_limits(2, Duration::from_secs(10)).unwrap();
    create_training(&mut registry, base, "active");
    registry.start_at("active", STARTED, base).unwrap();
    create_training(&mut registry, base, "terminal");
    registry
        .request_cancel_at("terminal", FINISHED, base + Duration::from_secs(1))
        .unwrap();

    registry
        .create_with_id_at(
            "replacement",
            JobType::Export,
            json!({}),
            FINISHED,
            base + Duration::from_secs(2),
        )
        .unwrap();
    assert!(registry.get_at("active", base).is_some());
    assert!(registry.get_at("terminal", base).is_none());
    assert!(registry.get_at("replacement", base).is_some());
    assert_eq!(
        registry.create_with_id_at(
            "refused",
            JobType::Analysis,
            json!({}),
            FINISHED,
            base + Duration::from_secs(3),
        ),
        Err(JobLifecycleError::CapacityExceeded)
    );

    let mut ttl = JobRegistry::with_limits(1, Duration::from_secs(1)).unwrap();
    create_training(&mut ttl, base, "old");
    ttl.request_cancel_at("old", FINISHED, base).unwrap();
    assert!(ttl
        .create_with_id_at(
            "new",
            JobType::Analysis,
            json!({}),
            FINISHED,
            base + Duration::from_secs(1),
        )
        .is_ok());
    assert!(ttl.get_at("old", base + Duration::from_secs(1)).is_none());

    let mut active_ttl = JobRegistry::with_limits(1, Duration::ZERO).unwrap();
    create_training(&mut active_ttl, base, "never-pruned");
    assert_eq!(active_ttl.len(), 1);
    assert!(active_ttl
        .get_at("never-pruned", base + Duration::from_secs(10_000))
        .is_some());
}

#[test]
fn mutex_wrapped_registry_preserves_unique_bounded_jobs_under_concurrency() {
    let base = Instant::now();
    let registry = Arc::new(Mutex::new(
        JobRegistry::with_limits(16, Duration::MAX).unwrap(),
    ));
    let threads = (0..16)
        .map(|index| {
            let registry = Arc::clone(&registry);
            thread::spawn(move || {
                registry
                    .lock()
                    .unwrap()
                    .create_with_id_at(
                        format!("concurrent-{index}"),
                        JobType::Analysis,
                        json!({"index": index}),
                        CREATED,
                        base,
                    )
                    .unwrap();
            })
        })
        .collect::<Vec<_>>();
    for handle in threads {
        handle.join().unwrap();
    }
    let jobs = registry.lock().unwrap().list_at(base);
    assert_eq!(jobs.len(), 16);
    assert_eq!(
        jobs.iter()
            .map(|job| job.id.as_str())
            .collect::<BTreeSet<_>>()
            .len(),
        16
    );
}
