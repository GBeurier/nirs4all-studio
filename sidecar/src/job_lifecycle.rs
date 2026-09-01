//! Bounded, execution-agnostic lifecycle registry for native Studio jobs.
//!
//! This module owns only job state and legacy event projection. It deliberately
//! has no task runner, Python bridge, HTTP route, or WebSocket transport.

use std::{
    collections::BTreeMap,
    time::{Duration, Instant},
};

use serde_json::{Map, Value};

/// Default maximum number of retained jobs.
pub const DEFAULT_JOB_CAPACITY: usize = 64;
/// Default time a terminal job remains retained before it is eligible for TTL pruning.
pub const DEFAULT_TERMINAL_TTL: Duration = Duration::from_secs(24 * 60 * 60);
/// Maximum serialized size accepted for a JSON object stored by the registry.
pub const MAX_JOB_JSON_BYTES: usize = 1024 * 1024;
/// Maximum UTF-8 byte length accepted for an opaque job identifier.
pub const MAX_JOB_ID_BYTES: usize = 256;
/// Maximum UTF-8 byte length accepted for progress and failure text.
pub const MAX_JOB_TEXT_BYTES: usize = 64 * 1024;
/// Maximum byte length accepted for an ISO-8601 wall-clock timestamp.
pub const MAX_JOB_TIMESTAMP_BYTES: usize = 64;

const CANCELLED_ERROR: &str = "Job was cancelled";

/// The five frozen Studio V1 job states.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum JobStatus {
    Pending,
    Running,
    Completed,
    Failed,
    Cancelled,
}

impl JobStatus {
    /// All statuses in frozen contract order.
    pub const ALL: [Self; 5] = [
        Self::Pending,
        Self::Running,
        Self::Completed,
        Self::Failed,
        Self::Cancelled,
    ];

    /// Return the frozen wire value.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Running => "running",
            Self::Completed => "completed",
            Self::Failed => "failed",
            Self::Cancelled => "cancelled",
        }
    }

    /// Whether this state rejects every later mutation and event.
    #[must_use]
    pub const fn is_terminal(self) -> bool {
        matches!(self, Self::Completed | Self::Failed | Self::Cancelled)
    }
}

/// The eleven frozen Studio V1 job kinds.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum JobType {
    Analysis,
    Automl,
    Evaluation,
    Export,
    Maintenance,
    Prediction,
    Training,
    UpdateApply,
    UpdateDownload,
    VenvCreate,
    VenvInstall,
}

impl JobType {
    /// All job kinds in frozen contract order.
    pub const ALL: [Self; 11] = [
        Self::Analysis,
        Self::Automl,
        Self::Evaluation,
        Self::Export,
        Self::Maintenance,
        Self::Prediction,
        Self::Training,
        Self::UpdateApply,
        Self::UpdateDownload,
        Self::VenvCreate,
        Self::VenvInstall,
    ];

    /// Return the frozen wire value.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Analysis => "analysis",
            Self::Automl => "automl",
            Self::Evaluation => "evaluation",
            Self::Export => "export",
            Self::Maintenance => "maintenance",
            Self::Prediction => "prediction",
            Self::Training => "training",
            Self::UpdateApply => "update_apply",
            Self::UpdateDownload => "update_download",
            Self::VenvCreate => "venv_create",
            Self::VenvInstall => "venv_install",
        }
    }
}

/// Failure from a rejected lifecycle mutation.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum JobLifecycleError {
    InvalidCapacity,
    CapacityExceeded,
    InvalidJobId,
    DuplicateJobId,
    JobNotFound,
    InvalidTimestamp,
    InvalidJsonObject(&'static str),
    JsonObjectTooLarge(&'static str),
    InvalidProgress,
    TextTooLarge(&'static str),
    InvalidTransition {
        from: JobStatus,
        operation: &'static str,
    },
    TerminalState(JobStatus),
    CancellationNotRequested,
}

/// Public, immutable Studio V1 view of one job.
#[derive(Clone, Debug, PartialEq)]
pub struct JobSnapshot {
    pub id: String,
    pub job_type: JobType,
    pub status: JobStatus,
    pub created_at: String,
    pub started_at: Option<String>,
    pub completed_at: Option<String>,
    pub progress: f64,
    pub progress_message: String,
    pub config: Value,
    pub result: Option<Value>,
    pub error: Option<String>,
    pub metrics: Value,
    pub duration_seconds: Option<f64>,
    cancellation_requested: bool,
}

impl JobSnapshot {
    /// Whether a running worker has been asked to stop cooperatively.
    #[must_use]
    pub const fn cancellation_requested(&self) -> bool {
        self.cancellation_requested
    }

    /// Project the exact public field names retained from Studio V1.
    #[must_use]
    pub fn public_json(&self) -> Value {
        Value::Object(Map::from_iter([
            ("id".into(), Value::String(self.id.clone())),
            ("type".into(), Value::String(self.job_type.as_str().into())),
            ("status".into(), Value::String(self.status.as_str().into())),
            ("created_at".into(), Value::String(self.created_at.clone())),
            (
                "started_at".into(),
                self.started_at.clone().map_or(Value::Null, Value::String),
            ),
            (
                "completed_at".into(),
                self.completed_at.clone().map_or(Value::Null, Value::String),
            ),
            ("progress".into(), value_from_finite(self.progress)),
            (
                "progress_message".into(),
                Value::String(self.progress_message.clone()),
            ),
            ("config".into(), self.config.clone()),
            ("result".into(), self.result.clone().unwrap_or(Value::Null)),
            (
                "error".into(),
                self.error.clone().map_or(Value::Null, Value::String),
            ),
            ("metrics".into(), self.metrics.clone()),
            (
                "duration_seconds".into(),
                self.duration_seconds.map_or(Value::Null, value_from_finite),
            ),
        ]))
    }
}

/// Legacy event kinds reachable from the frozen Python job manager.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum LegacyJobEventType {
    Started,
    Progress,
    Metrics,
    Completed,
    Failed,
}

impl LegacyJobEventType {
    /// Return the exact Studio V1 message type.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Started => "job_started",
            Self::Progress => "job_progress",
            Self::Metrics => "job_metrics",
            Self::Completed => "job_completed",
            Self::Failed => "job_failed",
        }
    }
}

/// One immutable legacy event plus its internal per-job ordering sequence.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LegacyJobEvent {
    sequence: u64,
    event_type: LegacyJobEventType,
    channel: String,
    data: Value,
    timestamp: String,
}

impl LegacyJobEvent {
    /// Internal strictly increasing sequence for deterministic dispatch.
    #[must_use]
    pub const fn sequence(&self) -> u64 {
        self.sequence
    }

    /// Exact legacy message kind. A `job_cancelled` variant intentionally does not exist.
    #[must_use]
    pub const fn event_type(&self) -> LegacyJobEventType {
        self.event_type
    }

    /// Project the exact four-key renderer envelope retained from Studio V1.
    #[must_use]
    pub fn legacy_json(&self) -> Value {
        Value::Object(Map::from_iter([
            (
                "type".into(),
                Value::String(self.event_type.as_str().into()),
            ),
            ("channel".into(), Value::String(self.channel.clone())),
            ("data".into(), self.data.clone()),
            ("timestamp".into(), Value::String(self.timestamp.clone())),
        ]))
    }
}

/// Result of a state mutation and, when applicable, its sole ordered event.
#[derive(Clone, Debug, PartialEq)]
pub struct JobMutation {
    pub job: JobSnapshot,
    pub event: Option<LegacyJobEvent>,
}

#[derive(Clone, Debug)]
struct JobRecord {
    snapshot: JobSnapshot,
    created_mono: Instant,
    started_mono: Option<Instant>,
    completed_mono: Option<Instant>,
    order: u64,
    event_sequence: u64,
    error_traceback: Option<String>,
}

impl JobRecord {
    fn snapshot_at(&self, now: Instant) -> JobSnapshot {
        let mut snapshot = self.snapshot.clone();
        snapshot.duration_seconds = self.started_mono.map(|started| {
            self.completed_mono
                .unwrap_or(now)
                .saturating_duration_since(started)
                .as_secs_f64()
        });
        snapshot
    }

    fn next_event(
        &mut self,
        event_type: LegacyJobEventType,
        data: Value,
        timestamp: &str,
    ) -> LegacyJobEvent {
        self.event_sequence = self.event_sequence.saturating_add(1);
        LegacyJobEvent {
            sequence: self.event_sequence,
            event_type,
            channel: format!("job:{}", self.snapshot.id),
            data,
            timestamp: timestamp.into(),
        }
    }
}

/// Bounded native job-state registry with terminal-only eviction.
#[derive(Clone, Debug)]
pub struct JobRegistry {
    jobs: BTreeMap<String, JobRecord>,
    capacity: usize,
    terminal_ttl: Duration,
    next_job_id: u64,
    next_order: u64,
}

impl Default for JobRegistry {
    fn default() -> Self {
        Self {
            jobs: BTreeMap::new(),
            capacity: DEFAULT_JOB_CAPACITY,
            terminal_ttl: DEFAULT_TERMINAL_TTL,
            next_job_id: 1,
            next_order: 1,
        }
    }
}

impl JobRegistry {
    /// Construct a registry with explicit retention bounds.
    ///
    /// # Errors
    ///
    /// Returns [`JobLifecycleError::InvalidCapacity`] when `capacity` is zero.
    pub const fn with_limits(
        capacity: usize,
        terminal_ttl: Duration,
    ) -> Result<Self, JobLifecycleError> {
        if capacity == 0 {
            return Err(JobLifecycleError::InvalidCapacity);
        }
        Ok(Self {
            jobs: BTreeMap::new(),
            capacity,
            terminal_ttl,
            next_job_id: 1,
            next_order: 1,
        })
    }

    /// Number of retained jobs, including terminal records still inside retention.
    #[must_use]
    pub fn len(&self) -> usize {
        self.jobs.len()
    }

    /// Whether no jobs are retained.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.jobs.is_empty()
    }

    /// Create a pending job with a generated opaque identifier.
    ///
    /// # Errors
    ///
    /// Rejects malformed timestamps or JSON objects and refuses capacity when
    /// every retained job is active.
    pub fn create_at(
        &mut self,
        job_type: JobType,
        config: Value,
        timestamp: &str,
        now: Instant,
    ) -> Result<JobSnapshot, JobLifecycleError> {
        let id = format!("{}_{}", job_type.as_str(), self.next_job_id);
        self.next_job_id = self.next_job_id.saturating_add(1);
        self.create_with_id_at(id, job_type, config, timestamp, now)
    }

    /// Create a pending job with a caller-owned opaque identifier.
    ///
    /// # Errors
    ///
    /// Rejects duplicate/invalid identifiers, malformed timestamps or JSON
    /// objects, and refuses capacity when every retained job is active.
    pub fn create_with_id_at(
        &mut self,
        id: impl Into<String>,
        job_type: JobType,
        config: Value,
        timestamp: &str,
        now: Instant,
    ) -> Result<JobSnapshot, JobLifecycleError> {
        validate_timestamp(timestamp)?;
        validate_json_object(&config, "config")?;
        let id = id.into();
        validate_job_id(&id)?;
        self.prune_expired_terminal(now);
        if self.jobs.contains_key(&id) {
            return Err(JobLifecycleError::DuplicateJobId);
        }
        if self.jobs.len() >= self.capacity {
            self.evict_oldest_terminal();
        }
        if self.jobs.len() >= self.capacity {
            return Err(JobLifecycleError::CapacityExceeded);
        }

        let snapshot = JobSnapshot {
            id: id.clone(),
            job_type,
            status: JobStatus::Pending,
            created_at: timestamp.into(),
            started_at: None,
            completed_at: None,
            progress: 0.0,
            progress_message: String::new(),
            config,
            result: None,
            error: None,
            metrics: Value::Object(Map::new()),
            duration_seconds: None,
            cancellation_requested: false,
        };
        let record = JobRecord {
            snapshot: snapshot.clone(),
            created_mono: now,
            started_mono: None,
            completed_mono: None,
            order: self.next_order,
            event_sequence: 0,
            error_traceback: None,
        };
        self.next_order = self.next_order.saturating_add(1);
        self.jobs.insert(id, record);
        Ok(snapshot)
    }

    /// Read authoritative state, pruning only expired terminal jobs first.
    #[must_use]
    pub fn get_at(&mut self, id: &str, now: Instant) -> Option<JobSnapshot> {
        self.prune_expired_terminal(now);
        self.jobs.get(id).map(|record| record.snapshot_at(now))
    }

    /// List authoritative state newest-first with deterministic ID tie-breaking.
    #[must_use]
    pub fn list_at(&mut self, now: Instant) -> Vec<JobSnapshot> {
        self.prune_expired_terminal(now);
        let mut records = self.jobs.values().collect::<Vec<_>>();
        records.sort_by(|left, right| {
            right
                .order
                .cmp(&left.order)
                .then_with(|| left.snapshot.id.cmp(&right.snapshot.id))
        });
        records
            .into_iter()
            .map(|record| record.snapshot_at(now))
            .collect()
    }

    /// Transition a pending job to running and emit one `job_started` event.
    ///
    /// # Errors
    ///
    /// Rejects missing jobs, malformed timestamps, and every state other than pending.
    pub fn start_at(
        &mut self,
        id: &str,
        timestamp: &str,
        now: Instant,
    ) -> Result<JobMutation, JobLifecycleError> {
        validate_timestamp(timestamp)?;
        let record = self.active_record(id, "start")?;
        if record.snapshot.status != JobStatus::Pending {
            return Err(JobLifecycleError::InvalidTransition {
                from: record.snapshot.status,
                operation: "start",
            });
        }
        record.snapshot.status = JobStatus::Running;
        record.snapshot.started_at = Some(timestamp.into());
        record.started_mono = Some(now);
        let snapshot = record.snapshot_at(now);
        let event = record.next_event(
            LegacyJobEventType::Started,
            snapshot.public_json(),
            timestamp,
        );
        Ok(JobMutation {
            job: snapshot,
            event: Some(event),
        })
    }

    /// Update finite progress on a running job and emit one legacy progress event.
    ///
    /// Finite values are clamped into `0..=100`; progress may move backwards.
    ///
    /// # Errors
    ///
    /// Rejects missing/non-running jobs, non-finite progress, oversized text,
    /// and malformed timestamps. Like the legacy progress callback, this does
    /// not mutate metrics and publishes the complete metrics snapshot already
    /// stored on the job.
    pub fn progress_at(
        &mut self,
        id: &str,
        progress: f64,
        message: impl Into<String>,
        timestamp: &str,
        now: Instant,
    ) -> Result<JobMutation, JobLifecycleError> {
        validate_timestamp(timestamp)?;
        if !progress.is_finite() {
            return Err(JobLifecycleError::InvalidProgress);
        }
        let message = message.into();
        validate_text(&message, "progress_message")?;
        let record = self.running_record(id, "progress")?;
        record.snapshot.progress = progress.clamp(0.0, 100.0);
        record.snapshot.progress_message.clone_from(&message);
        let snapshot = record.snapshot_at(now);
        let event = record.next_event(
            LegacyJobEventType::Progress,
            Value::Object(Map::from_iter([
                ("job_id".into(), Value::String(id.into())),
                ("progress".into(), value_from_finite(snapshot.progress)),
                ("message".into(), Value::String(message)),
                ("metrics".into(), snapshot.metrics.clone()),
            ])),
            timestamp,
        );
        Ok(JobMutation {
            job: snapshot,
            event: Some(event),
        })
    }

    /// Shallow-merge metrics on a pending or running job and emit `job_metrics`.
    /// Existing keys are retained unless the incoming object supplies the same
    /// key, matching legacy `job.metrics.update(metrics)` behavior. The event
    /// and returned state both expose the complete merged object.
    ///
    /// # Errors
    ///
    /// Rejects missing/terminal jobs, malformed metrics, and malformed timestamps.
    pub fn metrics_at(
        &mut self,
        id: &str,
        metrics: Value,
        timestamp: &str,
        now: Instant,
    ) -> Result<JobMutation, JobLifecycleError> {
        validate_timestamp(timestamp)?;
        validate_json_object(&metrics, "metrics")?;
        let Value::Object(incoming) = metrics else {
            return Err(JobLifecycleError::InvalidJsonObject("metrics"));
        };
        let mut merged = self
            .jobs
            .get(id)
            .ok_or(JobLifecycleError::JobNotFound)?
            .snapshot
            .metrics
            .clone();
        let Value::Object(merged_object) = &mut merged else {
            return Err(JobLifecycleError::InvalidJsonObject("metrics"));
        };
        for (key, value) in incoming {
            merged_object.insert(key, value);
        }
        validate_json_object(&merged, "metrics")?;
        let record = self.active_record(id, "metrics")?;
        record.snapshot.metrics.clone_from(&merged);
        let snapshot = record.snapshot_at(now);
        let event = record.next_event(
            LegacyJobEventType::Metrics,
            Value::Object(Map::from_iter([
                ("job_id".into(), Value::String(id.into())),
                ("metrics".into(), merged),
            ])),
            timestamp,
        );
        Ok(JobMutation {
            job: snapshot,
            event: Some(event),
        })
    }

    /// Complete a running job, or cooperatively cancel it when cancellation was requested.
    ///
    /// # Errors
    ///
    /// Rejects missing/non-running jobs, malformed result JSON, and malformed timestamps.
    pub fn complete_at(
        &mut self,
        id: &str,
        result: Value,
        timestamp: &str,
        now: Instant,
    ) -> Result<JobMutation, JobLifecycleError> {
        validate_timestamp(timestamp)?;
        validate_json_object(&result, "result")?;
        let cancellation_requested = self
            .running_record(id, "complete")?
            .snapshot
            .cancellation_requested;
        if cancellation_requested {
            return self.cancel_running_at(id, timestamp, now);
        }
        let record = self.running_record(id, "complete")?;
        record.snapshot.status = JobStatus::Completed;
        record.snapshot.completed_at = Some(timestamp.into());
        record.snapshot.progress = 100.0;
        record.snapshot.result = Some(result.clone());
        record.completed_mono = Some(now);
        let snapshot = record.snapshot_at(now);
        let event = record.next_event(
            LegacyJobEventType::Completed,
            Value::Object(Map::from_iter([
                ("job_id".into(), Value::String(id.into())),
                ("result".into(), result),
            ])),
            timestamp,
        );
        Ok(JobMutation {
            job: snapshot,
            event: Some(event),
        })
    }

    /// Fail a running job and emit one `job_failed` event.
    ///
    /// # Errors
    ///
    /// Rejects missing/non-running jobs, oversized text, and malformed timestamps.
    pub fn fail_at(
        &mut self,
        id: &str,
        error: impl Into<String>,
        traceback: Option<String>,
        timestamp: &str,
        now: Instant,
    ) -> Result<JobMutation, JobLifecycleError> {
        validate_timestamp(timestamp)?;
        let error = error.into();
        validate_text(&error, "error")?;
        if let Some(value) = &traceback {
            validate_text(value, "traceback")?;
        }
        let record = self.running_record(id, "fail")?;
        record.snapshot.status = JobStatus::Failed;
        record.snapshot.completed_at = Some(timestamp.into());
        record.snapshot.error = Some(error.clone());
        record.error_traceback.clone_from(&traceback);
        record.completed_mono = Some(now);
        let snapshot = record.snapshot_at(now);
        let event = record.next_event(
            LegacyJobEventType::Failed,
            failed_event_data(id, error, traceback),
            timestamp,
        );
        Ok(JobMutation {
            job: snapshot,
            event: Some(event),
        })
    }

    /// Request cancellation from pending or running.
    ///
    /// Pending cancellation is terminal immediately and emits legacy
    /// `job_failed`. Running cancellation is cooperative and emits nothing
    /// until the worker acknowledges or completes.
    ///
    /// # Errors
    ///
    /// Rejects missing/terminal jobs and malformed timestamps.
    pub fn request_cancel_at(
        &mut self,
        id: &str,
        timestamp: &str,
        now: Instant,
    ) -> Result<JobMutation, JobLifecycleError> {
        validate_timestamp(timestamp)?;
        let status = self
            .jobs
            .get(id)
            .ok_or(JobLifecycleError::JobNotFound)?
            .snapshot
            .status;
        match status {
            JobStatus::Pending => {
                let record = self.active_record(id, "cancel")?;
                record.snapshot.cancellation_requested = true;
                record.snapshot.status = JobStatus::Cancelled;
                record.snapshot.completed_at = Some(timestamp.into());
                record.snapshot.error = Some(CANCELLED_ERROR.into());
                record.completed_mono = Some(now);
                let snapshot = record.snapshot_at(now);
                let event = record.next_event(
                    LegacyJobEventType::Failed,
                    failed_event_data(id, CANCELLED_ERROR.into(), None),
                    timestamp,
                );
                Ok(JobMutation {
                    job: snapshot,
                    event: Some(event),
                })
            }
            JobStatus::Running => {
                let record = self.active_record(id, "cancel")?;
                record.snapshot.cancellation_requested = true;
                Ok(JobMutation {
                    job: record.snapshot_at(now),
                    event: None,
                })
            }
            terminal => Err(JobLifecycleError::TerminalState(terminal)),
        }
    }

    /// Acknowledge a cooperative cancellation from a running worker.
    ///
    /// # Errors
    ///
    /// Rejects missing/non-running jobs, jobs without a cancellation request,
    /// and malformed timestamps.
    pub fn acknowledge_cancel_at(
        &mut self,
        id: &str,
        timestamp: &str,
        now: Instant,
    ) -> Result<JobMutation, JobLifecycleError> {
        validate_timestamp(timestamp)?;
        let record = self.running_record(id, "acknowledge_cancel")?;
        if !record.snapshot.cancellation_requested {
            return Err(JobLifecycleError::CancellationNotRequested);
        }
        self.cancel_running_at(id, timestamp, now)
    }

    fn cancel_running_at(
        &mut self,
        id: &str,
        timestamp: &str,
        now: Instant,
    ) -> Result<JobMutation, JobLifecycleError> {
        let record = self.running_record(id, "cancel")?;
        record.snapshot.status = JobStatus::Cancelled;
        record.snapshot.completed_at = Some(timestamp.into());
        record.snapshot.error = Some(CANCELLED_ERROR.into());
        record.completed_mono = Some(now);
        let snapshot = record.snapshot_at(now);
        let event = record.next_event(
            LegacyJobEventType::Failed,
            failed_event_data(id, CANCELLED_ERROR.into(), None),
            timestamp,
        );
        Ok(JobMutation {
            job: snapshot,
            event: Some(event),
        })
    }

    fn active_record(
        &mut self,
        id: &str,
        operation: &'static str,
    ) -> Result<&mut JobRecord, JobLifecycleError> {
        let record = self
            .jobs
            .get_mut(id)
            .ok_or(JobLifecycleError::JobNotFound)?;
        if record.snapshot.status.is_terminal() {
            return Err(JobLifecycleError::TerminalState(record.snapshot.status));
        }
        if matches!(
            record.snapshot.status,
            JobStatus::Pending | JobStatus::Running
        ) {
            Ok(record)
        } else {
            Err(JobLifecycleError::InvalidTransition {
                from: record.snapshot.status,
                operation,
            })
        }
    }

    fn running_record(
        &mut self,
        id: &str,
        operation: &'static str,
    ) -> Result<&mut JobRecord, JobLifecycleError> {
        let record = self.active_record(id, operation)?;
        if record.snapshot.status != JobStatus::Running {
            return Err(JobLifecycleError::InvalidTransition {
                from: record.snapshot.status,
                operation,
            });
        }
        Ok(record)
    }

    fn prune_expired_terminal(&mut self, now: Instant) {
        let ttl = self.terminal_ttl;
        self.jobs.retain(|_, record| {
            !record.snapshot.status.is_terminal()
                || record
                    .completed_mono
                    .is_some_and(|completed| now.saturating_duration_since(completed) < ttl)
        });
    }

    fn evict_oldest_terminal(&mut self) {
        let oldest = self
            .jobs
            .iter()
            .filter(|(_, record)| record.snapshot.status.is_terminal())
            .min_by_key(|(id, record)| {
                (
                    record.completed_mono.unwrap_or(record.created_mono),
                    record.order,
                    *id,
                )
            })
            .map(|(id, _)| id.clone());
        if let Some(id) = oldest {
            self.jobs.remove(&id);
        }
    }
}

fn failed_event_data(id: &str, error: String, traceback: Option<String>) -> Value {
    Value::Object(Map::from_iter([
        ("job_id".into(), Value::String(id.into())),
        ("error".into(), Value::String(error)),
        (
            "traceback".into(),
            traceback.map_or(Value::Null, Value::String),
        ),
    ]))
}

fn validate_job_id(id: &str) -> Result<(), JobLifecycleError> {
    if id.is_empty()
        || id.len() > MAX_JOB_ID_BYTES
        || id
            .bytes()
            .any(|byte| byte.is_ascii_control() || byte.is_ascii_whitespace() || byte == b'/')
    {
        return Err(JobLifecycleError::InvalidJobId);
    }
    Ok(())
}

const fn validate_text(value: &str, field: &'static str) -> Result<(), JobLifecycleError> {
    if value.len() > MAX_JOB_TEXT_BYTES {
        return Err(JobLifecycleError::TextTooLarge(field));
    }
    Ok(())
}

fn validate_json_object(value: &Value, field: &'static str) -> Result<(), JobLifecycleError> {
    if !value.is_object() {
        return Err(JobLifecycleError::InvalidJsonObject(field));
    }
    let serialized =
        serde_json::to_vec(value).map_err(|_| JobLifecycleError::InvalidJsonObject(field))?;
    if serialized.len() > MAX_JOB_JSON_BYTES {
        return Err(JobLifecycleError::JsonObjectTooLarge(field));
    }
    let round_trip: Value = serde_json::from_slice(&serialized)
        .map_err(|_| JobLifecycleError::InvalidJsonObject(field))?;
    if round_trip != *value {
        return Err(JobLifecycleError::InvalidJsonObject(field));
    }
    Ok(())
}

fn value_from_finite(value: f64) -> Value {
    debug_assert!(value.is_finite());
    Value::from(value)
}

fn validate_timestamp(value: &str) -> Result<(), JobLifecycleError> {
    let bytes = value.as_bytes();
    if bytes.len() < 19
        || bytes.len() > MAX_JOB_TIMESTAMP_BYTES
        || bytes.get(4) != Some(&b'-')
        || bytes.get(7) != Some(&b'-')
        || bytes.get(10) != Some(&b'T')
        || bytes.get(13) != Some(&b':')
        || bytes.get(16) != Some(&b':')
    {
        return Err(JobLifecycleError::InvalidTimestamp);
    }
    for index in [0, 1, 2, 3, 5, 6, 8, 9, 11, 12, 14, 15, 17, 18] {
        if !bytes[index].is_ascii_digit() {
            return Err(JobLifecycleError::InvalidTimestamp);
        }
    }
    let month = parse_two(bytes[5], bytes[6]);
    let day = parse_two(bytes[8], bytes[9]);
    let hour = parse_two(bytes[11], bytes[12]);
    let minute = parse_two(bytes[14], bytes[15]);
    let second = parse_two(bytes[17], bytes[18]);
    if !(1..=12).contains(&month)
        || day == 0
        || day > days_in_month(parse_four(&bytes[..4]), month)
        || hour > 23
        || minute > 59
        || second > 59
        || !valid_timestamp_suffix(&bytes[19..])
    {
        return Err(JobLifecycleError::InvalidTimestamp);
    }
    Ok(())
}

fn valid_timestamp_suffix(suffix: &[u8]) -> bool {
    if suffix.is_empty() || suffix == b"Z" {
        return true;
    }
    let (fraction, zone) = if suffix.first() == Some(&b'.') {
        let digits = suffix[1..]
            .iter()
            .take_while(|byte| byte.is_ascii_digit())
            .count();
        if digits == 0 {
            return false;
        }
        (&suffix[1..=digits], &suffix[digits + 1..])
    } else {
        (&[][..], suffix)
    };
    if !fraction.iter().all(u8::is_ascii_digit) {
        return false;
    }
    if zone.is_empty() || zone == b"Z" {
        return true;
    }
    zone.len() == 6
        && matches!(zone[0], b'+' | b'-')
        && zone[1].is_ascii_digit()
        && zone[2].is_ascii_digit()
        && zone[3] == b':'
        && zone[4].is_ascii_digit()
        && zone[5].is_ascii_digit()
        && parse_two(zone[1], zone[2]) <= 23
        && parse_two(zone[4], zone[5]) <= 59
}

const fn parse_two(first: u8, second: u8) -> u8 {
    (first - b'0') * 10 + second - b'0'
}

fn parse_four(value: &[u8]) -> u16 {
    value.iter().fold(0, |year, digit| {
        year.saturating_mul(10) + u16::from(*digit - b'0')
    })
}

const fn days_in_month(year: u16, month: u8) -> u8 {
    match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if year % 400 == 0 || (year % 4 == 0 && year % 100 != 0) => 29,
        2 => 28,
        _ => 0,
    }
}
