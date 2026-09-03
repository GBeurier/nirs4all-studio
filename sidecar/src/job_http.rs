//! Native HTTP adapters and execution seam for Studio's frozen job surface.
//!
//! The registry is authoritative for the three legacy polling routes and five
//! cancellation aliases listed in [`JOB_HTTP_ROUTES`]. Durable execution-job
//! record reads remain a `WorkspaceStore` concern and are deliberately excluded.

use std::{
    collections::BTreeMap,
    fmt::Debug,
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
    sync::{Arc, Mutex},
    time::{Instant, SystemTime, UNIX_EPOCH},
};

use serde_json::{json, Value};

use crate::{
    execution_job_records::{
        preflight_execution_job_record_write, write_execution_job_record,
        ExecutionJobRecordWriteError,
    },
    job_lifecycle::{JobLifecycleError, JobMutation, JobRegistry, JobSnapshot, JobStatus, JobType},
    scientific_submission::ValidatedScientificSubmission,
    websocket_transport::{
        rfc3339_now, LegacyEnvelopeError, WebSocketConnectionManager, MAX_CLIENT_MESSAGE_BYTES,
    },
    HttpResponse,
};

/// Exact HTTP route classification used by the frozen Studio V1 adapters.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum JobHttpSurface {
    TrainingStatus,
    AutomlStatus,
    UpdateDownloadStatus,
    TrainingCancel,
    AutomlCancel,
    ExecutionRecordCancel,
    RunCancel,
    UpdateDownloadCancel,
}

/// One reviewed mapping from a frozen HTTP path template to native job state.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct JobHttpRouteMapping {
    pub method: &'static str,
    pub path: &'static str,
    pub surface: JobHttpSurface,
}

/// The only legacy job-manager routes selected by this native adapter.
pub const JOB_HTTP_ROUTES: [JobHttpRouteMapping; 8] = [
    JobHttpRouteMapping {
        method: "GET",
        path: "/api/training/{job_id}",
        surface: JobHttpSurface::TrainingStatus,
    },
    JobHttpRouteMapping {
        method: "GET",
        path: "/api/automl/{job_id}",
        surface: JobHttpSurface::AutomlStatus,
    },
    JobHttpRouteMapping {
        method: "GET",
        path: "/api/updates/webapp/download-status/{job_id}",
        surface: JobHttpSurface::UpdateDownloadStatus,
    },
    JobHttpRouteMapping {
        method: "POST",
        path: "/api/training/{job_id}/stop",
        surface: JobHttpSurface::TrainingCancel,
    },
    JobHttpRouteMapping {
        method: "POST",
        path: "/api/automl/{job_id}/stop",
        surface: JobHttpSurface::AutomlCancel,
    },
    JobHttpRouteMapping {
        method: "POST",
        path: "/api/runs/execution-job-records/{job_id}/cancel",
        surface: JobHttpSurface::ExecutionRecordCancel,
    },
    JobHttpRouteMapping {
        method: "POST",
        path: "/api/runs/{run_id}/stop",
        surface: JobHttpSurface::RunCancel,
    },
    JobHttpRouteMapping {
        method: "POST",
        path: "/api/updates/webapp/download-cancel/{job_id}",
        surface: JobHttpSurface::UpdateDownloadCancel,
    },
];

/// Store-owned reads which must never be confused with in-memory job polling.
pub const DURABLE_WORKSPACE_JOB_READ_ROUTES: [&str; 2] = [
    "/api/runs/execution-job-records/{job_id}",
    "/api/runs/{run_id}/execution-job-record",
];

/// Conservative data budget which guarantees room for the four-key envelope.
pub const MAX_JOB_EVENT_DATA_BYTES: usize = MAX_CLIENT_MESSAGE_BYTES - 1024;

/// Explicit scientific execution boundary. The product default is unselected.
pub trait ScientificJobExecutor: Debug + Send + Sync {
    /// Whether this executor was explicitly selected and preflighted.
    fn is_selected(&self) -> bool;

    /// Stable machine-readable reason for refusing selection. Implementations
    /// may re-check an acquired runtime identity, but must not retry a failed
    /// acquisition implicitly.
    fn unavailability_reason(&self) -> &'static str {
        "executor_not_selected"
    }

    /// Preflight one already validated submission and return the bounded
    /// execution identity which will be persisted by Rust.
    ///
    /// # Errors
    ///
    /// Returns an explicit capability or preflight refusal.
    fn preflight_submission(
        &self,
        _request: &ScientificSubmissionPreflight,
    ) -> Result<ScientificExecutorSelection, JobExecutorError> {
        Err(JobExecutorError::SubmissionRefused)
    }

    /// Accept one job only after Rust registered, started, published, and
    /// durably persisted it.
    ///
    /// # Errors
    ///
    /// Returns an explicit submission refusal.
    fn submit_scientific(
        &self,
        _request: &ScientificExecutionRequest,
        _terminal: Arc<dyn ScientificJobTerminal>,
    ) -> Result<(), JobExecutorError> {
        Err(JobExecutorError::SubmissionRefused)
    }

    /// Ask a running executor to observe cooperative cancellation.
    ///
    /// # Errors
    ///
    /// Returns an executor-specific refusal without mutating registry state.
    fn request_cooperative_cancel(&self, job_id: &str) -> Result<(), JobExecutorError>;
}

/// Rust-owned terminal callback handed to a bounded scientific worker.
///
/// Implementations may report only the scientific outcome. Registry state,
/// WebSocket publication, cancellation acknowledgement, and durable storage
/// remain owned by [`NativeJobRuntime`].
pub trait ScientificJobTerminal: Debug + Send + Sync {
    /// Publish and persist a validated scientific result as completed.
    ///
    /// # Errors
    ///
    /// Returns a Rust lifecycle, event, or durable-write failure.
    fn complete(&self, job_id: &str, result: Value) -> Result<(), NativeJobRuntimeError>;

    /// Publish and persist a bounded worker failure.
    ///
    /// # Errors
    ///
    /// Returns a Rust lifecycle, event, or durable-write failure.
    fn fail(&self, job_id: &str, reason: &str) -> Result<(), NativeJobRuntimeError>;

    /// Publish and persist acknowledgement of Rust's cancellation request.
    ///
    /// # Errors
    ///
    /// Returns a Rust lifecycle, event, or durable-write failure.
    fn acknowledge_cancel(&self, job_id: &str) -> Result<(), NativeJobRuntimeError>;
}

/// Default executor used until Core or a bounded `CPython` plugin is selected.
#[derive(Debug, Default)]
pub struct UnselectedScientificJobExecutor;

impl ScientificJobExecutor for UnselectedScientificJobExecutor {
    fn is_selected(&self) -> bool {
        false
    }

    fn request_cooperative_cancel(&self, _job_id: &str) -> Result<(), JobExecutorError> {
        Err(JobExecutorError::Unselected)
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ScientificSubmissionPreflight {
    pub job_id: String,
    pub workspace_id: String,
    pub workspace_path: PathBuf,
    pub requested_backend: String,
    pub payload: Value,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ScientificExecutorSelection {
    pub execution_backend: String,
    pub execution_mode: Option<String>,
    /// Fully resolved path-free worker payload. The original Studio request
    /// remains the only request persisted in the durable record.
    pub prepared_payload: Value,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ScientificExecutionRequest {
    pub job_id: String,
    pub workspace_id: String,
    pub workspace_path: PathBuf,
    pub requested_backend: String,
    pub payload: Value,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ScientificSubmissionReceipt {
    pub job_id: String,
    pub run_name: String,
    pub created_at: String,
    pub requested_backend: String,
    pub execution_backend: String,
    pub workspace_id: String,
}

/// Failure at the explicit executor boundary.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum JobExecutorError {
    Unselected,
    InvalidCapability,
    PreflightRefused,
    SubmissionRefused,
    CancellationRefused,
}

/// Failure from the shared native job runtime.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum NativeJobRuntimeError {
    Lifecycle(JobLifecycleError),
    Executor(JobExecutorError),
    Persistence(ExecutionJobRecordWriteError),
    WebSocket(LegacyEnvelopeError),
}

impl From<JobLifecycleError> for NativeJobRuntimeError {
    fn from(value: JobLifecycleError) -> Self {
        Self::Lifecycle(value)
    }
}

/// Thread-safe registry, event broadcaster, and bounded execution seam.
#[derive(Clone, Debug)]
pub struct NativeJobRuntime {
    registry: Arc<Mutex<JobRegistry>>,
    websocket: Arc<WebSocketConnectionManager>,
    executor: Arc<dyn ScientificJobExecutor>,
    durable_jobs: Arc<Mutex<BTreeMap<String, DurableScientificJob>>>,
    next_submission_id: Arc<AtomicU64>,
    published_events: Arc<AtomicU64>,
    durable_writes: Arc<AtomicU64>,
}

#[derive(Clone, Debug)]
struct DurableScientificJob {
    workspace_path: PathBuf,
    requested_backend: String,
    execution_backend: String,
    execution_mode: Option<String>,
    request: Value,
    executor: Arc<dyn ScientificJobExecutor>,
}

impl Default for NativeJobRuntime {
    fn default() -> Self {
        Self::with_executor(Arc::new(UnselectedScientificJobExecutor))
    }
}

impl NativeJobRuntime {
    /// Construct a runtime around an explicitly supplied executor seam.
    #[must_use]
    pub fn with_executor(executor: Arc<dyn ScientificJobExecutor>) -> Self {
        Self {
            registry: Arc::new(Mutex::new(JobRegistry::default())),
            websocket: Arc::new(WebSocketConnectionManager::new()),
            executor,
            durable_jobs: Arc::new(Mutex::new(BTreeMap::new())),
            next_submission_id: Arc::new(AtomicU64::new(1)),
            published_events: Arc::new(AtomicU64::new(0)),
            durable_writes: Arc::new(AtomicU64::new(0)),
        }
    }

    /// Shared WebSocket manager used by both upgrade and lifecycle paths.
    #[must_use]
    pub fn websocket_manager(&self) -> Arc<WebSocketConnectionManager> {
        Arc::clone(&self.websocket)
    }

    /// Whether scientific submission may be registered in this runtime.
    #[must_use]
    pub fn execution_selected(&self) -> bool {
        self.executor.is_selected()
    }

    /// Explain why submission cannot be selected without parsing its body or
    /// touching workspace state.
    #[must_use]
    pub fn execution_unavailability_reason(&self) -> Option<&'static str> {
        (!self.executor.is_selected()).then(|| self.executor.unavailability_reason())
    }

    /// Number of successfully published lifecycle events since launch.
    #[must_use]
    pub fn published_event_count(&self) -> u64 {
        self.published_events.load(Ordering::Relaxed)
    }

    /// Number of successful atomic durable-record replacements since launch.
    #[must_use]
    pub fn durable_write_count(&self) -> u64 {
        self.durable_writes.load(Ordering::Relaxed)
    }

    /// Preflight, register, publish, persist, and submit one validated
    /// scientific job through the explicitly injected executor.
    ///
    /// # Errors
    ///
    /// Refuses an unselected/invalid executor, unsafe workspace, lifecycle or
    /// WebSocket failure, durable-write failure, and executor refusal.
    pub fn submit_scientific_at(
        &self,
        submission: &ValidatedScientificSubmission,
        workspace_id: &str,
        workspace_path: &Path,
        timestamp: &str,
        now: Instant,
    ) -> Result<ScientificSubmissionReceipt, NativeJobRuntimeError> {
        self.submit_with_executor_at(
            submission.run_name(),
            submission.requested_backend(),
            submission.payload(),
            workspace_id,
            workspace_path,
            timestamp,
            now,
            Arc::clone(&self.executor),
        )
    }

    /// Submit a bounded native operation through an explicitly selected Rust
    /// executor while retaining the shared job lifecycle and durable record.
    #[allow(clippy::too_many_arguments)]
    pub fn submit_with_executor_at(
        &self,
        run_name: &str,
        requested_backend: &str,
        payload: &Value,
        workspace_id: &str,
        workspace_path: &Path,
        timestamp: &str,
        now: Instant,
        executor: Arc<dyn ScientificJobExecutor>,
    ) -> Result<ScientificSubmissionReceipt, NativeJobRuntimeError> {
        if !executor.is_selected() {
            return Err(NativeJobRuntimeError::Executor(
                JobExecutorError::Unselected,
            ));
        }
        let job_id = self.next_scientific_job_id();
        let workspace_path = preflight_execution_job_record_write(workspace_path, &job_id)
            .map_err(NativeJobRuntimeError::Persistence)?;
        let preflight = ScientificSubmissionPreflight {
            job_id: job_id.clone(),
            workspace_id: workspace_id.into(),
            workspace_path: workspace_path.clone(),
            requested_backend: requested_backend.into(),
            payload: payload.clone(),
        };
        let selection = executor
            .preflight_submission(&preflight)
            .map_err(NativeJobRuntimeError::Executor)?;
        validate_executor_selection(&selection).map_err(NativeJobRuntimeError::Executor)?;
        let config = json!({
            "run_id": job_id,
            "run_name": run_name,
            "requested_backend": requested_backend,
            "execution_backend": selection.execution_backend,
            "submission_transport": "studio-sidecar-rust",
        });
        self.register_with_selected_executor_at(
            executor.is_selected(),
            &job_id,
            JobType::Training,
            config,
            timestamp,
            now,
        )?;
        self.durable_jobs
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .insert(
                job_id.clone(),
                DurableScientificJob {
                    workspace_path: workspace_path.clone(),
                    requested_backend: requested_backend.into(),
                    execution_backend: selection.execution_backend.clone(),
                    execution_mode: selection.execution_mode.clone(),
                    request: payload.clone(),
                    executor: Arc::clone(&executor),
                },
            );
        if let Err(error) = self.start_at(&job_id, timestamp, now) {
            self.durable_jobs
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .remove(&job_id);
            return Err(error);
        }
        let execution_request = ScientificExecutionRequest {
            job_id: job_id.clone(),
            workspace_id: workspace_id.into(),
            workspace_path,
            requested_backend: requested_backend.into(),
            payload: selection.prepared_payload.clone(),
        };
        let terminal: Arc<dyn ScientificJobTerminal> = Arc::new(self.clone());
        if let Err(error) = executor.submit_scientific(&execution_request, terminal) {
            let _ = self.fail_at(
                &job_id,
                "Scientific executor refused the registered submission",
                None,
                timestamp,
                now,
            );
            return Err(NativeJobRuntimeError::Executor(error));
        }
        Ok(ScientificSubmissionReceipt {
            job_id,
            run_name: run_name.into(),
            created_at: timestamp.into(),
            requested_backend: requested_backend.into(),
            execution_backend: selection.execution_backend,
            workspace_id: workspace_id.into(),
        })
    }

    /// Register a caller-owned job only after explicit executor selection.
    ///
    /// # Errors
    ///
    /// Refuses the default unselected executor and every invalid registry input.
    pub fn register_with_id_at(
        &self,
        id: impl Into<String>,
        job_type: JobType,
        config: Value,
        timestamp: &str,
        now: Instant,
    ) -> Result<JobSnapshot, NativeJobRuntimeError> {
        self.register_with_selected_executor_at(
            self.executor.is_selected(),
            id,
            job_type,
            config,
            timestamp,
            now,
        )
    }

    fn register_with_selected_executor_at(
        &self,
        executor_selected: bool,
        id: impl Into<String>,
        job_type: JobType,
        config: Value,
        timestamp: &str,
        now: Instant,
    ) -> Result<JobSnapshot, NativeJobRuntimeError> {
        if !executor_selected {
            return Err(NativeJobRuntimeError::Executor(
                JobExecutorError::Unselected,
            ));
        }
        let id = id.into();
        ensure_event_data_bounded(&json!({
            "id": id,
            "type": job_type.as_str(),
            "status": "running",
            "created_at": timestamp,
            "started_at": timestamp,
            "completed_at": null,
            "progress": 0.0,
            "progress_message": "",
            "config": config,
            "result": null,
            "error": null,
            "metrics": {},
            "duration_seconds": 0.0,
        }))?;
        self.registry
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .create_with_id_at(id, job_type, config, timestamp, now)
            .map_err(Into::into)
    }

    /// Read one authoritative retained job.
    #[must_use]
    pub fn get_at(&self, id: &str, now: Instant) -> Option<JobSnapshot> {
        self.registry
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .get_at(id, now)
    }

    /// Start an already registered job and publish its exact legacy event.
    ///
    /// # Errors
    ///
    /// Returns lifecycle validation or event-projection failures.
    pub fn start_at(
        &self,
        id: &str,
        timestamp: &str,
        now: Instant,
    ) -> Result<JobSnapshot, NativeJobRuntimeError> {
        let mut preview = self
            .get_at(id, now)
            .ok_or(JobLifecycleError::JobNotFound)?
            .public_json();
        preview["status"] = Value::String("running".into());
        preview["started_at"] = Value::String(timestamp.into());
        preview["duration_seconds"] = json!(0.0);
        ensure_event_data_bounded(&preview)?;
        self.mutate(|registry| registry.start_at(id, timestamp, now))
    }

    /// Update progress and publish the exact legacy event.
    ///
    /// # Errors
    ///
    /// Returns lifecycle validation or event-projection failures.
    pub fn progress_at(
        &self,
        id: &str,
        progress: f64,
        message: impl Into<String>,
        timestamp: &str,
        now: Instant,
    ) -> Result<JobSnapshot, NativeJobRuntimeError> {
        let message = message.into();
        let metrics = self
            .get_at(id, now)
            .ok_or(JobLifecycleError::JobNotFound)?
            .metrics;
        ensure_event_data_bounded(&json!({
            "job_id": id,
            "progress": progress,
            "message": message,
            "metrics": metrics,
        }))?;
        self.mutate(|registry| registry.progress_at(id, progress, message, timestamp, now))
    }

    /// Merge metrics and publish the exact legacy event.
    ///
    /// # Errors
    ///
    /// Returns lifecycle validation or event-projection failures.
    pub fn metrics_at(
        &self,
        id: &str,
        metrics: Value,
        timestamp: &str,
        now: Instant,
    ) -> Result<JobSnapshot, NativeJobRuntimeError> {
        let mut merged = self
            .get_at(id, now)
            .ok_or(JobLifecycleError::JobNotFound)?
            .metrics;
        if let (Some(current), Some(incoming)) = (merged.as_object_mut(), metrics.as_object()) {
            for (key, value) in incoming {
                current.insert(key.clone(), value.clone());
            }
            ensure_event_data_bounded(&json!({"job_id": id, "metrics": merged}))?;
        }
        self.mutate(|registry| registry.metrics_at(id, metrics, timestamp, now))
    }

    /// Complete a job, honoring cooperative cancellation, and publish once.
    ///
    /// # Errors
    ///
    /// Returns lifecycle validation or event-projection failures.
    pub fn complete_at(
        &self,
        id: &str,
        result: Value,
        timestamp: &str,
        now: Instant,
    ) -> Result<JobSnapshot, NativeJobRuntimeError> {
        ensure_event_data_bounded(&json!({"job_id": id, "result": result}))?;
        self.mutate_terminal(|registry| registry.complete_at(id, result, timestamp, now))
    }

    /// Fail a job and publish the exact legacy failure event.
    ///
    /// # Errors
    ///
    /// Returns lifecycle validation or event-projection failures.
    pub fn fail_at(
        &self,
        id: &str,
        error: impl Into<String>,
        traceback: Option<String>,
        timestamp: &str,
        now: Instant,
    ) -> Result<JobSnapshot, NativeJobRuntimeError> {
        let error = error.into();
        ensure_event_data_bounded(&json!({
            "job_id": id,
            "error": error,
            "traceback": traceback,
        }))?;
        self.mutate_terminal(|registry| registry.fail_at(id, error, traceback, timestamp, now))
    }

    /// Request pending or cooperative running cancellation.
    ///
    /// # Errors
    ///
    /// Returns lifecycle, executor refusal, or event-projection failures.
    pub fn request_cancel_at(
        &self,
        id: &str,
        timestamp: &str,
        now: Instant,
    ) -> Result<JobSnapshot, NativeJobRuntimeError> {
        let mut registry = self
            .registry
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let snapshot = registry
            .get_at(id, now)
            .ok_or(JobLifecycleError::JobNotFound)?;
        let persist_terminal_cancellation = snapshot.status == JobStatus::Pending;
        if snapshot.status == JobStatus::Running {
            // Record Rust's cancellation intent before notifying the worker.
            // A fresh process may observe its kill token immediately and call
            // back from another thread; the acknowledgement must never race
            // ahead of the authoritative lifecycle flag.
            let mutation = registry.request_cancel_at(id, timestamp, now)?;
            drop(registry);
            let executor = self
                .durable_jobs
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .get(id)
                .map_or_else(|| Arc::clone(&self.executor), |job| Arc::clone(&job.executor));
            executor
                .request_cooperative_cancel(id)
                .map_err(NativeJobRuntimeError::Executor)?;
            return self.publish(mutation);
        }
        let mutation = registry.request_cancel_at(id, timestamp, now)?;
        drop(registry);
        let snapshot = self.publish(mutation)?;
        if persist_terminal_cancellation {
            self.persist_if_durable(&snapshot)?;
        }
        Ok(snapshot)
    }

    /// Acknowledge a worker's cooperative cancellation and publish once.
    ///
    /// # Errors
    ///
    /// Returns lifecycle validation or event-projection failures.
    pub fn acknowledge_cancel_at(
        &self,
        id: &str,
        timestamp: &str,
        now: Instant,
    ) -> Result<JobSnapshot, NativeJobRuntimeError> {
        self.mutate_terminal(|registry| registry.acknowledge_cancel_at(id, timestamp, now))
    }

    fn mutate(
        &self,
        operation: impl FnOnce(&mut JobRegistry) -> Result<JobMutation, JobLifecycleError>,
    ) -> Result<JobSnapshot, NativeJobRuntimeError> {
        let mutation = operation(
            &mut self
                .registry
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner),
        )?;
        let snapshot = self.publish(mutation)?;
        self.persist_if_durable(&snapshot)?;
        Ok(snapshot)
    }

    fn mutate_terminal(
        &self,
        operation: impl FnOnce(&mut JobRegistry) -> Result<JobMutation, JobLifecycleError>,
    ) -> Result<JobSnapshot, NativeJobRuntimeError> {
        let mut registry = self
            .registry
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let mut candidate = registry.clone();
        let mutation = operation(&mut candidate)?;
        // Commit durable terminal state first. A worker callback can therefore never
        // leave the record stale after the authoritative registry is terminal.
        self.persist_if_durable(&mutation.job)?;
        *registry = candidate;
        drop(registry);
        self.publish(mutation)
    }

    fn publish(&self, mutation: JobMutation) -> Result<JobSnapshot, NativeJobRuntimeError> {
        if let Some(event) = mutation.event {
            self.websocket
                .broadcast_legacy(&event.legacy_json())
                .map_err(NativeJobRuntimeError::WebSocket)?;
            self.published_events.fetch_add(1, Ordering::Relaxed);
        }
        Ok(mutation.job)
    }

    fn next_scientific_job_id(&self) -> String {
        let sequence = self.next_submission_id.fetch_add(1, Ordering::Relaxed);
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        format!("run_native_{}_{}_{}", std::process::id(), nonce, sequence)
    }

    fn persist_if_durable(&self, snapshot: &JobSnapshot) -> Result<(), NativeJobRuntimeError> {
        let context = self
            .durable_jobs
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .get(&snapshot.id)
            .cloned();
        let Some(context) = context else {
            return Ok(());
        };
        let record = durable_record(snapshot, &context);
        write_execution_job_record(&context.workspace_path, &snapshot.id, &record)
            .map_err(NativeJobRuntimeError::Persistence)?;
        self.durable_writes.fetch_add(1, Ordering::Relaxed);
        Ok(())
    }
}

impl ScientificJobTerminal for NativeJobRuntime {
    fn complete(&self, job_id: &str, result: Value) -> Result<(), NativeJobRuntimeError> {
        self.complete_at(job_id, result, &rfc3339_now(), Instant::now())?;
        Ok(())
    }

    fn fail(&self, job_id: &str, reason: &str) -> Result<(), NativeJobRuntimeError> {
        self.fail_at(job_id, reason, None, &rfc3339_now(), Instant::now())?;
        Ok(())
    }

    fn acknowledge_cancel(&self, job_id: &str) -> Result<(), NativeJobRuntimeError> {
        self.acknowledge_cancel_at(job_id, &rfc3339_now(), Instant::now())?;
        Ok(())
    }
}

fn validate_executor_selection(
    selection: &ScientificExecutorSelection,
) -> Result<(), JobExecutorError> {
    let valid = |value: &str| {
        !value.is_empty()
            && value.len() <= 64
            && value
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
    };
    if !valid(&selection.execution_backend)
        || selection
            .execution_mode
            .as_deref()
            .is_some_and(|value| !valid(value))
        || !selection.prepared_payload.is_object()
    {
        return Err(JobExecutorError::InvalidCapability);
    }
    Ok(())
}

fn durable_record(snapshot: &JobSnapshot, context: &DurableScientificJob) -> Value {
    json!({
        "job_id": snapshot.id,
        "job_type": snapshot.job_type.as_str(),
        "requested_backend": context.requested_backend,
        "execution_backend": context.execution_backend,
        "execution_mode": context.execution_mode,
        "status": snapshot.status.as_str(),
        "progress": snapshot.progress,
        "progress_message": snapshot.progress_message,
        "progress_unavailable": false,
        "created_at": snapshot.created_at,
        "started_at": snapshot.started_at,
        "completed_at": snapshot.completed_at,
        "request": context.request,
        "driver": {
            "backend": context.execution_backend,
            "mode": context.execution_mode,
            "submission_transport": "studio-sidecar-rust"
        },
        "metrics": snapshot.metrics,
        "error": snapshot.error,
    })
}

fn ensure_event_data_bounded(data: &Value) -> Result<(), NativeJobRuntimeError> {
    if data.to_string().len() > MAX_JOB_EVENT_DATA_BYTES {
        return Err(NativeJobRuntimeError::WebSocket(
            LegacyEnvelopeError::TooLarge,
        ));
    }
    Ok(())
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct MatchedJobRoute {
    surface: JobHttpSurface,
    job_id: String,
}

/// Whether this path is one of the eight selected native job aliases.
#[must_use]
pub fn is_native_job_http_path(path: &str) -> bool {
    match_job_route(path).is_some()
}

/// Route one selected native job request.
#[must_use]
pub fn route_native_job_request(
    runtime: &NativeJobRuntime,
    method: &str,
    path: &str,
) -> HttpResponse {
    let Some(route) = match_job_route(path) else {
        return legacy_detail(404, "Job route not found");
    };
    let expected = route_method(route.surface);
    if method != expected {
        return legacy_detail(405, "Method Not Allowed").with_header("Allow", expected);
    }
    match route.surface {
        JobHttpSurface::TrainingStatus => status_training(runtime, &route.job_id),
        JobHttpSurface::AutomlStatus => status_automl(runtime, &route.job_id),
        JobHttpSurface::UpdateDownloadStatus => status_download(runtime, &route.job_id),
        JobHttpSurface::TrainingCancel => cancel_training(runtime, &route.job_id),
        JobHttpSurface::AutomlCancel => cancel_automl(runtime, &route.job_id),
        JobHttpSurface::ExecutionRecordCancel => cancel_execution_record(runtime, &route.job_id),
        JobHttpSurface::RunCancel => cancel_run(runtime, &route.job_id),
        JobHttpSurface::UpdateDownloadCancel => cancel_download(runtime, &route.job_id),
    }
}

fn status_training(runtime: &NativeJobRuntime, job_id: &str) -> HttpResponse {
    let Some(job) = runtime.get_at(job_id, Instant::now()) else {
        return missing_typed_job(job_id);
    };
    if job.job_type != JobType::Training {
        return legacy_detail(400, format!("Job '{job_id}' is not a training job"));
    }
    HttpResponse::json(
        200,
        json!({
            "job_id": job.id,
            "status": job.status.as_str(),
            "progress": job.progress,
            "progress_message": job.progress_message,
            "created_at": job.created_at,
            "started_at": job.started_at,
            "completed_at": job.completed_at,
            "duration_seconds": job.duration_seconds,
            "config": job.config,
            "metrics": job.metrics,
            "error": job.error,
        })
        .to_string(),
    )
}

fn status_automl(runtime: &NativeJobRuntime, job_id: &str) -> HttpResponse {
    let Some(job) = runtime.get_at(job_id, Instant::now()) else {
        return missing_typed_job(job_id);
    };
    if job.job_type != JobType::Automl {
        return legacy_detail(400, format!("Job '{job_id}' is not an AutoML job"));
    }
    let trials_completed = job
        .metrics
        .get("trials_completed")
        .cloned()
        .unwrap_or_else(|| json!(0));
    let trials_total = job
        .config
        .get("n_trials")
        .cloned()
        .unwrap_or_else(|| json!(0));
    let best_score = job
        .metrics
        .get("best_score")
        .cloned()
        .unwrap_or(Value::Null);
    let best_model = job
        .metrics
        .get("best_model")
        .cloned()
        .unwrap_or(Value::Null);
    if !is_json_integer(&trials_completed)
        || !is_json_integer(&trials_total)
        || !(best_score.is_null() || best_score.is_number())
        || !(best_model.is_null() || best_model.is_string())
    {
        return legacy_detail(500, "Native AutoML job state has an invalid public shape");
    }
    HttpResponse::json(
        200,
        json!({
            "job_id": job.id,
            "status": job.status.as_str(),
            "progress": job.progress,
            "progress_message": job.progress_message,
            "trials_completed": trials_completed,
            "trials_total": trials_total,
            "best_score": best_score,
            "best_model": best_model,
            "elapsed_seconds": job.duration_seconds.unwrap_or(0.0),
            "created_at": job.created_at,
        })
        .to_string(),
    )
}

fn is_json_integer(value: &Value) -> bool {
    value.as_i64().is_some() || value.as_u64().is_some()
}

fn status_download(runtime: &NativeJobRuntime, job_id: &str) -> HttpResponse {
    let Some(job) = runtime.get_at(job_id, Instant::now()) else {
        return legacy_detail(404, "Job not found");
    };
    HttpResponse::json(
        200,
        json!({
            "job_id": job.id,
            "status": job.status.as_str(),
            "progress": job.progress,
            "message": job.progress_message,
            "result": job.result,
            "error": job.error,
        })
        .to_string(),
    )
}

fn cancel_training(runtime: &NativeJobRuntime, job_id: &str) -> HttpResponse {
    let Some(job) = runtime.get_at(job_id, Instant::now()) else {
        return missing_typed_job(job_id);
    };
    if job.job_type != JobType::Training {
        return legacy_detail(400, format!("Job '{job_id}' is not a training job"));
    }
    if job.status.is_terminal() {
        return not_running(job_id, job.status);
    }
    match cancel_now(runtime, job_id) {
        Ok(job) => HttpResponse::json(
            200,
            json!({
                "success": true,
                "job_id": job_id,
                "status": job.status.as_str(),
                "message": "Cancellation requested",
            })
            .to_string(),
        ),
        Err(error) => cancellation_failure(job_id, &error),
    }
}

fn cancel_automl(runtime: &NativeJobRuntime, job_id: &str) -> HttpResponse {
    let Some(job) = runtime.get_at(job_id, Instant::now()) else {
        return missing_typed_job(job_id);
    };
    if job.job_type != JobType::Automl {
        return legacy_detail(400, format!("Job '{job_id}' is not an AutoML job"));
    }
    if job.status.is_terminal() {
        return not_running(job_id, job.status);
    }
    match cancel_now(runtime, job_id) {
        Ok(job) => HttpResponse::json(
            200,
            json!({
                "success": true,
                "job_id": job_id,
                "status": job.status.as_str(),
                "message": "Search stop requested",
            })
            .to_string(),
        ),
        Err(error) => cancellation_failure(job_id, &error),
    }
}

fn cancel_execution_record(runtime: &NativeJobRuntime, job_id: &str) -> HttpResponse {
    let Some(job) = runtime.get_at(job_id, Instant::now()) else {
        return legacy_detail(404, format!("Execution job record {job_id} not found"));
    };
    let backend = job
        .config
        .get("execution_backend")
        .and_then(Value::as_str)
        .unwrap_or("native-rust");
    let run_id = job.config.get("run_id").cloned().unwrap_or(Value::Null);
    if job.status.is_terminal() {
        return HttpResponse::json(
            200,
            json!({
                "action": "cancel",
                "job_id": job_id,
                "success": false,
                "message": format!("Execution job {job_id} was not found or cannot be cancelled"),
                "backend": backend,
                "run_id": run_id,
                "metadata": {"scheduler": "studio-sidecar-rust"},
            })
            .to_string(),
        );
    }
    match cancel_now(runtime, job_id) {
        Ok(_) => HttpResponse::json(
            200,
            json!({
                "action": "cancel",
                "job_id": job_id,
                "success": true,
                "message": format!("Cancellation requested for job {job_id}"),
                "backend": backend,
                "run_id": run_id,
                "metadata": {"scheduler": "studio-sidecar-rust"},
            })
            .to_string(),
        ),
        Err(error) => cancellation_failure(job_id, &error),
    }
}

fn cancel_run(runtime: &NativeJobRuntime, run_id: &str) -> HttpResponse {
    let Some(job) = runtime.get_at(run_id, Instant::now()) else {
        return legacy_detail(404, format!("Run {run_id} not found"));
    };
    if job.status.is_terminal() {
        return legacy_detail(
            400,
            format!("Cannot stop run with status {}", job.status.as_str()),
        );
    }
    match cancel_now(runtime, run_id) {
        Ok(_) => HttpResponse::json(
            200,
            json!({"success": true, "message": format!("Run {run_id} stopped"), "run_id": run_id})
                .to_string(),
        ),
        Err(error) => cancellation_failure(run_id, &error),
    }
}

fn cancel_download(runtime: &NativeJobRuntime, job_id: &str) -> HttpResponse {
    let Some(job) = runtime.get_at(job_id, Instant::now()) else {
        return legacy_detail(404, "Job not found");
    };
    if job.status.is_terminal() {
        return HttpResponse::json(
            200,
            json!({"success": false, "message": "Job is already completed or cannot be cancelled"})
                .to_string(),
        );
    }
    match cancel_now(runtime, job_id) {
        Ok(_) => HttpResponse::json(
            200,
            json!({"success": true, "message": "Cancellation requested"}).to_string(),
        ),
        Err(error) => cancellation_failure(job_id, &error),
    }
}

fn cancel_now(
    runtime: &NativeJobRuntime,
    job_id: &str,
) -> Result<JobSnapshot, NativeJobRuntimeError> {
    runtime.request_cancel_at(job_id, &rfc3339_now(), Instant::now())
}

fn cancellation_failure(job_id: &str, error: &NativeJobRuntimeError) -> HttpResponse {
    match error {
        NativeJobRuntimeError::Lifecycle(JobLifecycleError::JobNotFound) => {
            missing_typed_job(job_id)
        }
        NativeJobRuntimeError::Lifecycle(JobLifecycleError::TerminalState(status)) => {
            not_running(job_id, *status)
        }
        NativeJobRuntimeError::Executor(JobExecutorError::Unselected) => legacy_detail(
            409,
            "Scientific job executor is not selected; cancellation was not requested",
        ),
        NativeJobRuntimeError::Executor(
            JobExecutorError::InvalidCapability
            | JobExecutorError::PreflightRefused
            | JobExecutorError::SubmissionRefused,
        ) => legacy_detail(503, "Scientific job executor is unavailable"),
        NativeJobRuntimeError::Executor(JobExecutorError::CancellationRefused) => {
            legacy_detail(503, "Scientific job executor refused cancellation")
        }
        NativeJobRuntimeError::Lifecycle(_)
        | NativeJobRuntimeError::Persistence(_)
        | NativeJobRuntimeError::WebSocket(_) => legacy_detail(500, "Failed to cancel job"),
    }
}

fn missing_typed_job(job_id: &str) -> HttpResponse {
    legacy_detail(404, format!("Job '{job_id}' not found"))
}

fn not_running(job_id: &str, status: JobStatus) -> HttpResponse {
    legacy_detail(
        400,
        format!(
            "Job '{job_id}' is not running (status: {})",
            status.as_str()
        ),
    )
}

fn legacy_detail(status: u16, detail: impl Into<String>) -> HttpResponse {
    HttpResponse::json(status, json!({"detail": detail.into()}).to_string())
}

const fn route_method(surface: JobHttpSurface) -> &'static str {
    match surface {
        JobHttpSurface::TrainingStatus
        | JobHttpSurface::AutomlStatus
        | JobHttpSurface::UpdateDownloadStatus => "GET",
        JobHttpSurface::TrainingCancel
        | JobHttpSurface::AutomlCancel
        | JobHttpSurface::ExecutionRecordCancel
        | JobHttpSurface::RunCancel
        | JobHttpSurface::UpdateDownloadCancel => "POST",
    }
}

fn match_job_route(path: &str) -> Option<MatchedJobRoute> {
    if let Some(job_id) = single_segment(path, "/api/training/", "") {
        if !matches!(job_id, "start" | "jobs") {
            return matched(JobHttpSurface::TrainingStatus, job_id);
        }
    }
    if let Some(job_id) = single_segment(path, "/api/automl/", "") {
        if job_id != "jobs" {
            return matched(JobHttpSurface::AutomlStatus, job_id);
        }
    }
    if let Some(job_id) = single_segment(path, "/api/updates/webapp/download-status/", "") {
        return matched(JobHttpSurface::UpdateDownloadStatus, job_id);
    }
    if let Some(job_id) = single_segment(path, "/api/training/", "/stop") {
        return matched(JobHttpSurface::TrainingCancel, job_id);
    }
    if let Some(job_id) = single_segment(path, "/api/automl/", "/stop") {
        return matched(JobHttpSurface::AutomlCancel, job_id);
    }
    if let Some(job_id) = single_segment(path, "/api/runs/execution-job-records/", "/cancel") {
        return matched(JobHttpSurface::ExecutionRecordCancel, job_id);
    }
    if let Some(run_id) = single_segment(path, "/api/runs/", "/stop") {
        return matched(JobHttpSurface::RunCancel, run_id);
    }
    if let Some(job_id) = single_segment(path, "/api/updates/webapp/download-cancel/", "") {
        return matched(JobHttpSurface::UpdateDownloadCancel, job_id);
    }
    None
}

fn matched(surface: JobHttpSurface, job_id: &str) -> Option<MatchedJobRoute> {
    valid_job_id(job_id).then(|| MatchedJobRoute {
        surface,
        job_id: job_id.into(),
    })
}

fn single_segment<'a>(path: &'a str, prefix: &str, suffix: &str) -> Option<&'a str> {
    let value = path.strip_prefix(prefix)?.strip_suffix(suffix)?;
    (!value.is_empty() && !value.contains('/')).then_some(value)
}

fn valid_job_id(value: &str) -> bool {
    value.len() <= 256
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
}
