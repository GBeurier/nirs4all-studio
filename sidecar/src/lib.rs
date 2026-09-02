//! Studio's deliberately small, local-only R1 sidecar contract.
//!
//! This crate owns control-plane scaffolding, not NIRS computation or the
//! legacy `FastAPI` surface. See `../README.md` for the external contract.

use std::{
    collections::BTreeMap,
    env,
    fmt::Write as _,
    fs::{self, OpenOptions},
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    path::{Path, PathBuf},
    process::{self, Command, Stdio},
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use atomicwrites::replace_atomic;
use base64::{engine::general_purpose::STANDARD, Engine as _};
use percent_encoding::percent_decode_str;
use serde_json::{json, Value};

mod archive_v2_prediction;
pub mod conformal_store;
pub mod execution_job_records;
pub mod job_http;
pub mod job_lifecycle;
pub mod legacy_conversion;
mod results_summary;
pub mod run_detail;
pub mod run_detail_cpython;
pub mod run_detail_preselection;
pub mod scientific_cpython;
pub mod scientific_request_resolver;
pub mod scientific_submission;
mod settings;
pub mod websocket_transport;
pub mod workspace_store;

use archive_v2_prediction::{
    parse_request as parse_archive_v2_prediction_request, ArchiveV2PredictionError,
    ArchiveV2PredictionRuntime, ARCHIVE_V2_PREDICTION_ROUTE,
};
use execution_job_records::{
    compose_execution_job_record_response, match_durable_execution_job_record_route,
    read_execution_job_record, DurableExecutionJobRecordRoute, ExecutionJobRecordReadError,
};
use job_http::{is_native_job_http_path, route_native_job_request, NativeJobRuntime};
use legacy_conversion::{
    display_command, inspect_workspace_transition,
    parse_request as parse_legacy_conversion_request, LegacyConversionFailure,
    LegacyConversionProcessOutput, LegacyConversionRequest, LegacyConversionRuntime,
    LEGACY_CONVERSION_ROUTE, LEGACY_TRANSITION_STATUS_ROUTE,
};
use results_summary::read_results_summary;
use run_detail::compose_store_run_detail;
use run_detail_cpython::{materialize_run_detail_owner, RunDetailOwnerBridgeFailure};
use run_detail_preselection::preselect_run_detail;
use scientific_submission::{
    validate_scientific_submission, ScientificSubmissionValidationError,
    SCIENTIFIC_SUBMISSION_ROUTE,
};
pub use settings::DatasetLinkIdentity;
use settings::{AppSettingsStore, ConfigPathError};
use websocket_transport::{
    handle_websocket_connection, LegacyWebSocketEndpoint, WebSocketConnectionManager,
};
use workspace_store::{
    preflight_run_detail_projection, read_pipeline_summaries, read_run_detail_projection,
    read_run_summaries, WorkspaceStorePipelineSummary, WorkspaceStoreReadError,
    WorkspaceStoreRunSummary, DEFAULT_PIPELINE_SUMMARIES_LIMIT, MAX_RUN_SUMMARIES,
};

pub const PROTOCOL_VERSION: &str = "studio-sidecar-r1";
pub const LEGACY_CONTRACT_BASELINE: &str = "studio-v1";
pub const LEGACY_ROUTE_PARITY: &str = "bootstrap";
pub const API_PREFIX: &str = "/sidecar/v1";
pub const MAX_REQUEST_HEADER_BYTES: usize = 8 * 1024;
pub const MAX_REQUEST_BODY_BYTES: usize = 64 * 1024;
pub const MAX_REQUEST_HEADERS: usize = 32;
pub const MAX_CONCURRENT_CONNECTIONS: usize = 32;
pub const MAX_CONTROL_JOBS: usize = 64;
pub const CONTROL_JOB_TTL: Duration = Duration::from_secs(5 * 60);
pub const MAX_WS_CHANNELS: usize = 64;
pub const MAX_WS_DATA_BYTES: usize = 16 * 1024;
pub const MAX_WS_DATA_KEYS: usize = 16;

/// Load the minimal read-only dataset-link catalogue from a Studio config
/// directory.
///
/// # Errors
///
/// Returns an error when the file cannot be read safely or exceeds its bounded
/// size. Missing and malformed JSON use the legacy empty-catalogue default.
pub fn read_dataset_links(
    config_dir: impl Into<PathBuf>,
) -> Result<Vec<DatasetLinkIdentity>, String> {
    AppSettingsStore::new(config_dir).dataset_links()
}

pub const PYTHON_PLUGIN_HOST_ENV: &str = "NIRS4ALL_PYTHON_PLUGIN_HOST";
pub const PYTHON_PLUGIN_HOST_BUNDLED_ENV: &str = "NIRS4ALL_PYTHON_PLUGIN_HOST_BUNDLED";
pub const PYTHON_PLUGIN_CLOSURE_ENV: &str = "NIRS4ALL_PYTHON_PLUGIN_CLOSURE";
pub const PYTHON_PLUGIN_RUNTIME_ROOT_ENV: &str = "NIRS4ALL_PYTHON_PLUGIN_RUNTIME_ROOT";
pub const PYTHON_PLUGIN_SITE_PACKAGES_ENV: &str = "NIRS4ALL_PYTHON_PLUGIN_SITE_PACKAGES";
pub const SCIENTIFIC_EXECUTOR_ENV: &str = "NIRS4ALL_SCIENTIFIC_EXECUTOR";
pub const RUNTIME_MODE_ENV: &str = "NIRS4ALL_RUNTIME_MODE";
pub const RUNTIME_KIND_ENV: &str = "NIRS4ALL_RUNTIME_KIND";
pub const BUILD_INFO_PATH_ENV: &str = "NIRS4ALL_BUILD_INFO_PATH";
pub const APP_VERSION_ENV: &str = "NIRS4ALL_APP_VERSION";
pub const OFFLINE_ENV: &str = "NIRS4ALL_OFFLINE";
pub const BACKEND_DATA_DIR_ENV: &str = "NIRS4ALL_BACKEND_DATA_DIR";
pub const UPDATE_SETTINGS_FILE: &str = "update_settings.yaml";
pub const MAX_UPDATE_SETTINGS_BYTES: u64 = 16 * 1024;
pub const VENV_METADATA_FILE: &str = "venv_metadata.json";
pub const MAX_VENV_METADATA_BYTES: u64 = 16 * 1024;
pub const PYTHON_PLUGIN_PREFLIGHT_TIMEOUT: Duration = Duration::from_secs(15);
pub const PYTHON_PLUGIN_CAPABILITIES_TIMEOUT: Duration = Duration::from_secs(15);
pub const MAX_PYTHON_PLUGIN_OUTPUT_BYTES: usize = 8 * 1024;
pub const MAX_PYTHON_PLUGIN_RUNTIME_STATUS_OUTPUT_BYTES: usize = 256 * 1024;
pub const MAX_PYTHON_PLUGIN_RUNTIME_PACKAGES: usize = 4 * 1024;
const DEFAULT_UPDATE_CHECK_INTERVAL_HOURS: i64 = 24;
const DEFAULT_UPDATE_GITHUB_REPO: &str = "GBeurier/nirs4all-studio";
const DEFAULT_UPDATE_PYPI_PACKAGE: &str = "nirs4all";
pub const PYTHON_CAPABILITY_MODULES: &[&str] = &[
    "nirs4all",
    "tensorflow",
    "torch",
    "jax",
    "shap",
    "umap",
    "autogluon",
];
pub const PYTHON_INFO_PACKAGES: &[&str] = &[
    "numpy",
    "pandas",
    "scikit-learn",
    "scipy",
    "matplotlib",
    "tensorflow",
    "torch",
    "fastapi",
    "uvicorn",
    "webview",
];

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ErrorCode {
    InvalidRequest,
    RouteNotFound,
    MethodNotAllowed,
    JobNotFound,
    JobCapacityExceeded,
    RequestTimeout,
    WebSocketUpgradeRequired,
    PythonPluginUnavailable,
    PythonPluginPreflightFailed,
    ScientificExecutorUnavailable,
    ArchiveV2PredictionUnavailable,
    ArchiveV2PredictionInvalid,
    ArchiveV2PredictionWorkspaceUnavailable,
    ArchiveV2PredictionArchiveNotFound,
    ArchiveV2PredictionArchiveUnsafe,
    ArchiveV2PredictionArchiveTooLarge,
    ArchiveV2PredictionDigestMismatch,
    ArchiveV2PredictionExecutionFailed,
}

impl ErrorCode {
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::InvalidRequest => "invalid_request",
            Self::RouteNotFound => "route_not_found",
            Self::MethodNotAllowed => "method_not_allowed",
            Self::JobNotFound => "job_not_found",
            Self::JobCapacityExceeded => "job_capacity_exceeded",
            Self::RequestTimeout => "request_timeout",
            Self::WebSocketUpgradeRequired => "websocket_upgrade_required",
            Self::PythonPluginUnavailable => "python_plugin_unavailable",
            Self::PythonPluginPreflightFailed => "python_plugin_preflight_failed",
            Self::ScientificExecutorUnavailable => "scientific_executor_unavailable",
            Self::ArchiveV2PredictionUnavailable => "archive_v2_prediction_unavailable",
            Self::ArchiveV2PredictionInvalid => "archive_v2_prediction_invalid",
            Self::ArchiveV2PredictionWorkspaceUnavailable => {
                "archive_v2_prediction_workspace_unavailable"
            }
            Self::ArchiveV2PredictionArchiveNotFound => "archive_v2_prediction_archive_not_found",
            Self::ArchiveV2PredictionArchiveUnsafe => "archive_v2_prediction_archive_unsafe",
            Self::ArchiveV2PredictionArchiveTooLarge => "archive_v2_prediction_archive_too_large",
            Self::ArchiveV2PredictionDigestMismatch => "archive_v2_prediction_digest_mismatch",
            Self::ArchiveV2PredictionExecutionFailed => "archive_v2_prediction_execution_failed",
        }
    }

    #[must_use]
    pub const fn retryable(self) -> bool {
        false
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ErrorEnvelope {
    pub code: ErrorCode,
    pub message: String,
    pub details: BTreeMap<String, String>,
}

impl ErrorEnvelope {
    #[must_use]
    pub fn json(&self) -> String {
        let mut details = String::from("{");
        for (index, (key, value)) in self.details.iter().enumerate() {
            if index > 0 {
                details.push(',');
            }
            write!(
                details,
                "\"{}\":\"{}\"",
                escape_json(key),
                escape_json(value)
            )
            .expect("writing to String cannot fail");
        }
        details.push('}');
        format!(
            "{{\"error\":{{\"code\":\"{}\",\"message\":\"{}\",\"retryable\":{},\"details\":{details}}}}}",
            self.code.as_str(),
            escape_json(&self.message),
            self.code.retryable(),
        )
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum JobStatus {
    Pending,
    Cancelled,
}

impl JobStatus {
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Cancelled => "cancelled",
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ControlJob {
    pub id: String,
    pub status: JobStatus,
    created_at: Instant,
    order: u64,
}

/// Per-channel sequence memory used to validate future WebSocket frames.
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct WsSequenceTracker {
    sequences: BTreeMap<String, u64>,
}

impl WsSequenceTracker {
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum WsFrameError {
    InvalidProtocolVersion,
    InvalidChannel,
    NonPositiveSequence,
    NonMonotonicSequence,
    TooManyChannels,
    InvalidTimestamp,
    InvalidEventType,
    InvalidData,
}

/// A validated future WebSocket frame. R1 never accepts upgrades or publishes
/// frames, but this type prevents invalid protocol data from becoming public API.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct WsFrame {
    protocol_version: &'static str,
    channel: String,
    sequence: u64,
    timestamp: String,
    event_type: String,
    data: Value,
}

impl WsFrame {
    /// Construct a frame only after validating all fixed R1 protocol fields.
    ///
    /// The sequence tracker is deliberately required: positivity alone cannot
    /// establish the per-channel monotonicity promised by the protocol.
    ///
    /// # Errors
    ///
    /// Returns a [`WsFrameError`] when any protocol field is invalid, bounded
    /// data is not a JSON object, or the sequence does not advance its channel.
    pub fn new(
        tracker: &mut WsSequenceTracker,
        protocol_version: &str,
        channel: impl Into<String>,
        sequence: u64,
        timestamp: impl Into<String>,
        event_type: impl Into<String>,
        data: Value,
    ) -> Result<Self, WsFrameError> {
        let channel = channel.into();
        let timestamp = timestamp.into();
        let event_type = event_type.into();
        if protocol_version != PROTOCOL_VERSION {
            return Err(WsFrameError::InvalidProtocolVersion);
        }
        if !valid_ws_channel(&channel) {
            return Err(WsFrameError::InvalidChannel);
        }
        if sequence == 0 {
            return Err(WsFrameError::NonPositiveSequence);
        }
        if !valid_utc_timestamp(&timestamp) {
            return Err(WsFrameError::InvalidTimestamp);
        }
        if !matches!(
            event_type.as_str(),
            "job.created" | "job.progress" | "job.completed" | "job.failed" | "job.cancelled"
        ) {
            return Err(WsFrameError::InvalidEventType);
        }
        if !valid_ws_data(&data) {
            return Err(WsFrameError::InvalidData);
        }
        if let Some(previous) = tracker.sequences.get(&channel) {
            if sequence <= *previous {
                return Err(WsFrameError::NonMonotonicSequence);
            }
        } else if tracker.sequences.len() >= MAX_WS_CHANNELS {
            return Err(WsFrameError::TooManyChannels);
        }
        tracker.sequences.insert(channel.clone(), sequence);
        Ok(Self {
            protocol_version: PROTOCOL_VERSION,
            channel,
            sequence,
            timestamp,
            event_type,
            data,
        })
    }

    #[must_use]
    pub fn json(&self) -> String {
        format!(
            "{{\"protocol_version\":\"{}\",\"channel\":\"{}\",\"sequence\":{},\"timestamp\":\"{}\",\"type\":\"{}\",\"data\":{}}}",
            self.protocol_version,
            escape_json(&self.channel),
            self.sequence,
            escape_json(&self.timestamp),
            escape_json(&self.event_type),
            self.data,
        )
    }
}

/// Compatibility name retained for callers that adopted the initial scaffold.
pub type WsEnvelope = WsFrame;

#[derive(Debug)]
pub struct SidecarState {
    started_at: Instant,
    next_job: u64,
    jobs: BTreeMap<String, ControlJob>,
    job_limit: usize,
    job_ttl: Duration,
    python_plugin_host: Option<PathBuf>,
    python_plugin_host_bundled: bool,
    runtime_mode: String,
    runtime_kind: String,
    build_info_path: Option<PathBuf>,
    app_settings: AppSettingsStore,
    update_settings: UpdateSettingsStore,
    native_jobs: Arc<NativeJobRuntime>,
    archive_v2_prediction: ArchiveV2PredictionRuntime,
    legacy_conversion: LegacyConversionRuntime,
}

impl Default for SidecarState {
    fn default() -> Self {
        Self {
            started_at: Instant::now(),
            next_job: 1,
            jobs: BTreeMap::new(),
            job_limit: MAX_CONTROL_JOBS,
            job_ttl: CONTROL_JOB_TTL,
            python_plugin_host: None,
            python_plugin_host_bundled: false,
            runtime_mode: "development".into(),
            runtime_kind: "python_plugin_host".into(),
            build_info_path: None,
            app_settings: AppSettingsStore::from_environment(),
            update_settings: UpdateSettingsStore::from_environment(),
            native_jobs: Arc::new(NativeJobRuntime::default()),
            archive_v2_prediction: ArchiveV2PredictionRuntime::default(),
            legacy_conversion: LegacyConversionRuntime::default(),
        }
    }
}

impl SidecarState {
    /// Share the native job runtime with execution adapters and tests.
    #[must_use]
    pub fn native_jobs(&self) -> Arc<NativeJobRuntime> {
        Arc::clone(&self.native_jobs)
    }

    /// Install an explicit native job runtime for a controlled launch.
    #[must_use]
    pub fn with_native_jobs(native_jobs: Arc<NativeJobRuntime>) -> Self {
        Self {
            native_jobs,
            ..Self::default()
        }
    }

    /// Configure both the Rust job runtime and app-settings catalogue for a
    /// controlled native scientific-submission launch.
    #[must_use]
    pub fn with_native_jobs_and_app_settings_dir(
        native_jobs: Arc<NativeJobRuntime>,
        app_settings_dir: impl Into<PathBuf>,
    ) -> Self {
        Self {
            native_jobs,
            app_settings: AppSettingsStore::new(app_settings_dir),
            ..Self::default()
        }
    }

    #[must_use]
    pub fn with_job_limits(job_limit: usize, job_ttl: Duration) -> Self {
        Self {
            job_limit,
            job_ttl,
            ..Self::default()
        }
    }

    /// Capture the product-owned Python plugin host at sidecar startup. The
    /// value is only used by the explicit preflight route; it never selects a
    /// Python HTTP backend or authorizes scientific execution.
    #[must_use]
    pub fn from_environment() -> Self {
        let python_plugin_host = env::var_os(PYTHON_PLUGIN_HOST_ENV)
            .filter(|value| !value.is_empty())
            .map(PathBuf::from);
        let python_plugin_host_bundled = env::var(PYTHON_PLUGIN_HOST_BUNDLED_ENV)
            .is_ok_and(|value| value.eq_ignore_ascii_case("true"));
        let python_plugin_closure = env::var_os(PYTHON_PLUGIN_CLOSURE_ENV)
            .filter(|value| !value.is_empty())
            .map(PathBuf::from);
        let python_plugin_runtime_root = env::var_os(PYTHON_PLUGIN_RUNTIME_ROOT_ENV)
            .filter(|value| !value.is_empty())
            .map(PathBuf::from);
        let python_plugin_site_packages = env::var_os(PYTHON_PLUGIN_SITE_PACKAGES_ENV)
            .filter(|value| !value.is_empty())
            .map(PathBuf::from);
        let runtime_mode = env::var(RUNTIME_MODE_ENV)
            .ok()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| "development".into());
        let runtime_kind = env::var(RUNTIME_KIND_ENV)
            .ok()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| "python_plugin_host".into());
        let app_settings = AppSettingsStore::from_environment();
        let native_jobs = if env::var(SCIENTIFIC_EXECUTOR_ENV).as_deref()
            == Ok(scientific_cpython::SCIENTIFIC_CPYTHON_EXECUTOR_ID)
        {
            let empty = Path::new("");
            Arc::new(NativeJobRuntime::with_executor(Arc::new(
                scientific_cpython::CpythonScientificJobExecutor::acquire_packaged_with_config_dir(
                    python_plugin_host_bundled
                        .then_some(python_plugin_host.as_deref())
                        .flatten()
                        .unwrap_or(empty),
                    python_plugin_host_bundled
                        .then_some(python_plugin_closure.as_deref())
                        .flatten()
                        .unwrap_or(empty),
                    python_plugin_host_bundled
                        .then_some(python_plugin_runtime_root.as_deref())
                        .flatten()
                        .unwrap_or(empty),
                    python_plugin_host_bundled
                        .then_some(python_plugin_site_packages.as_deref())
                        .flatten()
                        .unwrap_or(empty),
                    app_settings.config_dir(),
                ),
            )))
        } else {
            Arc::new(NativeJobRuntime::default())
        };
        Self {
            python_plugin_host: python_plugin_host.clone(),
            python_plugin_host_bundled,
            runtime_mode,
            runtime_kind,
            build_info_path: env::var_os(BUILD_INFO_PATH_ENV)
                .filter(|value| !value.is_empty())
                .map(PathBuf::from),
            native_jobs,
            app_settings,
            update_settings: UpdateSettingsStore::from_environment(),
            legacy_conversion: LegacyConversionRuntime::from_python_plugin_host(python_plugin_host),
            ..Self::default()
        }
    }

    #[must_use]
    pub fn with_python_plugin_host(path: impl Into<PathBuf>) -> Self {
        let path = path.into();
        Self {
            python_plugin_host: Some(path.clone()),
            legacy_conversion: LegacyConversionRuntime::from_python_plugin_host(Some(path)),
            ..Self::default()
        }
    }

    /// Configure both halves of the native run-detail boundary explicitly.
    /// The interpreter is a library host; the settings directory remains
    /// Rust-owned and is never passed to the renderer.
    #[must_use]
    pub fn with_run_detail_host(
        python_plugin_host: impl Into<PathBuf>,
        app_settings_dir: impl Into<PathBuf>,
    ) -> Self {
        let python_plugin_host = python_plugin_host.into();
        Self {
            python_plugin_host: Some(python_plugin_host.clone()),
            legacy_conversion: LegacyConversionRuntime::from_python_plugin_host(Some(
                python_plugin_host,
            )),
            app_settings: AppSettingsStore::new(app_settings_dir),
            ..Self::default()
        }
    }

    /// Configure a converter seam and settings catalogue for native route
    /// integration tests and controlled non-product launches.
    #[must_use]
    pub fn with_legacy_converter_and_app_settings_dir(
        converter: Arc<dyn legacy_conversion::LegacyConverter>,
        app_settings_dir: impl Into<PathBuf>,
    ) -> Self {
        Self {
            legacy_conversion: LegacyConversionRuntime::with_converter(converter),
            app_settings: AppSettingsStore::new(app_settings_dir),
            ..Self::default()
        }
    }

    /// Use an explicit app-settings directory in tests and controlled desktop
    /// launches.  The store still keeps the legacy `app_settings.json` shape.
    #[must_use]
    pub fn with_app_settings_dir(path: impl Into<PathBuf>) -> Self {
        Self {
            app_settings: AppSettingsStore::new(path),
            ..Self::default()
        }
    }

    #[cfg(test)]
    #[must_use]
    fn with_archive_v2_prediction_executor_and_app_settings_dir(
        executor: Arc<dyn archive_v2_prediction::ArchiveV2PredictionExecutor>,
        app_settings_dir: impl Into<PathBuf>,
    ) -> Self {
        Self {
            archive_v2_prediction: ArchiveV2PredictionRuntime::with_executor(executor),
            app_settings: AppSettingsStore::new(app_settings_dir),
            ..Self::default()
        }
    }

    #[cfg(test)]
    #[must_use]
    pub fn with_update_settings_path(path: impl Into<PathBuf>) -> Self {
        Self {
            update_settings: UpdateSettingsStore::new(path),
            ..Self::default()
        }
    }

    #[cfg(test)]
    #[must_use]
    pub fn with_app_settings_paths(
        config_dir: impl Into<PathBuf>,
        default_config_dir: impl Into<PathBuf>,
    ) -> Self {
        Self {
            app_settings: AppSettingsStore::with_config_paths(config_dir, default_config_dir),
            ..Self::default()
        }
    }

    #[must_use]
    pub fn readiness_json(&self) -> String {
        let scientific_execution = if self.native_jobs.execution_selected() {
            "available"
        } else {
            "unavailable"
        };
        format!(
            "{{\"sidecar_ready\":true,\"protocol_version\":\"{PROTOCOL_VERSION}\",\"legacy_contract_baseline\":\"{LEGACY_CONTRACT_BASELINE}\",\"legacy_route_parity\":\"{LEGACY_ROUTE_PARITY}\",\"scientific_execution\":\"{scientific_execution}\",\"job_execution\":\"{scientific_execution}\",\"uptime_ms\":{}}}",
            self.started_at.elapsed().as_millis()
        )
    }

    #[must_use]
    pub fn health_json(&self) -> String {
        let scientific_execution = if self.native_jobs.execution_selected() {
            "available"
        } else {
            "unavailable"
        };
        format!(
            "{{\"status\":\"healthy\",\"sidecar_ready\":true,\"protocol_version\":\"{PROTOCOL_VERSION}\",\"legacy_contract_baseline\":\"{LEGACY_CONTRACT_BASELINE}\",\"scientific_execution\":\"{scientific_execution}\"}}"
        )
    }

    #[must_use]
    pub fn capabilities_json(&self) -> String {
        let python_plugin_configured = self.python_plugin_host.is_some();
        let scientific_execution = self.native_jobs.execution_selected();
        format!(
            "{{\"protocol_version\":\"{PROTOCOL_VERSION}\",\"legacy_contract_baseline\":\"{LEGACY_CONTRACT_BASELINE}\",\"legacy_route_parity\":\"{LEGACY_ROUTE_PARITY}\",\"api_route_coverage\":\"bootstrap_system_and_app_catalog\",\"python_plugin_host\":\"{}\",\"features\":{{\"health\":true,\"readiness\":true,\"control_jobs\":true,\"websocket_upgrade\":true,\"renderer_transport_selection\":true,\"renderer_http_transport\":true,\"renderer_websocket_transport\":true,\"renderer_rust_only_default\":true,\"implicit_python_http_fallback\":false,\"unmigrated_renderer_routes_fail_closed\":true,\"native_job_status_routes\":true,\"native_job_cancellation_routes\":true,\"native_scientific_submission_routes\":true,\"scientific_submission_transport\":true,\"native_archive_v2_prediction\":{},\"durable_execution_job_record_reads\":true,\"scientific_execution\":{scientific_execution},\"legacy_api_routes\":false,\"unmigrated_api_routes_require_legacy_backend\":false,\"app_settings_routes\":true,\"app_config_path_routes\":true,\"linked_workspace_catalog_route\":true,\"linked_workspace_state_routes\":true,\"workspace_transition_status_route\":true,\"legacy_workspace_conversion_route\":{},\"workspace_store_v5_run_summary_route\":true,\"workspace_store_v5_run_detail_preselection\":true,\"workspace_store_v5_run_detail_route\":true,\"run_detail_owner_host_configured\":{python_plugin_configured},\"run_detail_owner_preflight_per_request\":true,\"workspace_store_v5_pipeline_summary_route\":true,\"workspace_store_v5_results_summary_route\":true,\"system_status_route\":true,\"system_capabilities_route\":true,\"system_info_route\":true,\"system_build_route\":true,\"system_network_route\":true,\"system_env_coherence_route\":true,\"updates_version_route\":true,\"updates_runtime_status_route\":true,\"updates_settings_routes\":true,\"python_plugin_preflight\":{python_plugin_configured},\"python_plugin_execution\":{scientific_execution}}}}}",
            if python_plugin_configured {
                "configured"
            } else {
                "unconfigured"
            },
            self.archive_v2_prediction.is_selected(),
            self.legacy_conversion.is_available(),
        )
    }

    /// Frozen Studio V1 health response for the native bootstrap control plane.
    #[must_use]
    pub const fn legacy_health_json() -> &'static str {
        "{\"core_ready\":true,\"message\":\"nirs4all webapp is running\",\"ml_loading\":false,\"ml_ready\":false,\"ready\":true,\"status\":\"healthy\"}"
    }

    /// Frozen Studio V1 post-lifespan readiness response for the native
    /// bootstrap control plane. Python plugins and scientific execution remain
    /// unavailable until a later migration wave wires their explicit bridge.
    #[must_use]
    pub fn legacy_readiness_json(&self) -> String {
        format!(
            "{{\"core_ready\":true,\"elapsed_seconds\":{},\"ml_error\":null,\"ml_loading\":false,\"ml_ready\":false,\"workspace_ready\":false}}",
            self.started_at.elapsed().as_secs_f64()
        )
    }

    fn create_control_job(&mut self) -> Result<ControlJob, ()> {
        self.create_control_job_at(Instant::now())
    }

    fn create_control_job_at(&mut self, now: Instant) -> Result<ControlJob, ()> {
        self.prune_jobs(now);
        if self.jobs.len() >= self.job_limit {
            self.evict_oldest_cancelled();
        }
        if self.jobs.len() >= self.job_limit {
            return Err(());
        }
        let id = format!("job-r1-{}", self.next_job);
        self.next_job = self.next_job.saturating_add(1);
        let job = ControlJob {
            id: id.clone(),
            status: JobStatus::Pending,
            created_at: now,
            order: self.next_job,
        };
        self.jobs.insert(id, job.clone());
        Ok(job)
    }

    fn job(&mut self, job_id: &str) -> Option<ControlJob> {
        self.prune_jobs(Instant::now());
        self.jobs.get(job_id).cloned()
    }

    fn cancel_job(&mut self, job_id: &str) -> Option<ControlJob> {
        self.prune_jobs(Instant::now());
        let job = self.jobs.get_mut(job_id)?;
        job.status = JobStatus::Cancelled;
        Some(job.clone())
    }

    fn prune_jobs(&mut self, now: Instant) {
        let ttl = self.job_ttl;
        self.jobs
            .retain(|_, job| now.saturating_duration_since(job.created_at) < ttl);
    }

    fn evict_oldest_cancelled(&mut self) {
        let oldest = self
            .jobs
            .iter()
            .filter(|(_, job)| job.status == JobStatus::Cancelled)
            .min_by_key(|(id, job)| (job.created_at, job.order, *id))
            .map(|(id, _)| id.clone());
        if let Some(id) = oldest {
            self.jobs.remove(&id);
        }
    }
}

#[derive(Debug, Eq, PartialEq)]
pub struct HttpResponse {
    pub status: u16,
    pub body: String,
    headers: Vec<(&'static str, String)>,
}

impl HttpResponse {
    #[must_use]
    pub fn json(status: u16, body: impl Into<String>) -> Self {
        Self {
            status,
            body: body.into(),
            headers: Vec::new(),
        }
    }

    #[must_use]
    pub fn with_header(mut self, name: &'static str, value: impl Into<String>) -> Self {
        self.headers.push((name, value.into()));
        self
    }
}

#[must_use]
pub fn route_request(state: &mut SidecarState, method: &str, path: &str) -> HttpResponse {
    route_request_with_body(state, method, path, &[])
}

/// Route one local HTTP request, including a bounded JSON request body for
/// native state routes.  The body-free wrapper remains public for the frozen
/// R1 contract tests and diagnostics.
#[must_use]
#[expect(
    clippy::too_many_lines,
    reason = "the explicit route table is intentionally kept in one auditable match"
)]
pub fn route_request_with_body(
    state: &mut SidecarState,
    method: &str,
    path: &str,
    body: &[u8],
) -> HttpResponse {
    if let Some(response) = route_archive_v2_prediction_match(state, method, path, body) {
        return response;
    }
    if let Some(response) = route_scientific_submission_match(state, method, path, body) {
        return response;
    }
    match (method, path) {
        ("GET", "/api/health") => HttpResponse::json(200, SidecarState::legacy_health_json()),
        ("GET", "/api/system/readiness") => HttpResponse::json(200, state.legacy_readiness_json()),
        ("GET", "/api/system/status") => system_status_response(state),
        ("GET", "/api/app/settings") => app_settings_response(state),
        ("PUT", "/api/app/settings") => update_app_settings_response(state, body),
        ("GET", "/api/config/setup-status") => setup_status_response(state),
        ("POST", "/api/config/skip-setup") => complete_setup_response(state, "cpu"),
        ("POST", "/api/config/complete-setup") => complete_setup_request_response(state, body),
        ("GET", "/api/app/favorites") => app_favourites_response(state),
        ("POST", "/api/app/favorites") => add_app_favourite_response(state, body),
        ("GET", "/api/app/config-path") => app_config_path_response(state),
        ("POST", "/api/app/config-path") => set_app_config_path_response(state, body),
        ("DELETE", "/api/app/config-path") => reset_app_config_path_response(state),
        ("GET", "/api/workspaces") => app_linked_workspaces_response(state),
        ("GET", LEGACY_TRANSITION_STATUS_ROUTE) => workspace_transition_status_response(state),
        ("POST", LEGACY_CONVERSION_ROUTE) => legacy_workspace_conversion_response(state, body),
        ("GET", "/sidecar/v1/health") => HttpResponse::json(200, state.health_json()),
        ("GET", "/sidecar/v1/readiness") => HttpResponse::json(200, state.readiness_json()),
        ("GET", "/sidecar/v1/capabilities") => HttpResponse::json(200, state.capabilities_json()),
        ("GET", "/sidecar/v1/python/preflight") => python_plugin_preflight_response(state),
        ("GET", "/api/system/capabilities") => python_capabilities_response(state),
        ("GET", "/api/system/info") => python_system_info_response(state),
        ("GET", "/api/system/build") => python_system_build_response(state),
        ("GET", "/api/system/network") => system_network_response(),
        ("GET", "/api/system/env-coherence") => python_env_coherence_response(state),
        ("GET", "/api/updates/version") => python_updates_version_response(state),
        ("GET", "/api/updates/runtime/status") => python_updates_runtime_status_response(state),
        ("GET", "/api/updates/settings") => update_settings_response(state),
        ("PUT", "/api/updates/settings") => save_update_settings_response(state, body),
        ("POST", "/sidecar/v1/jobs") => create_job_response(state),
        ("GET", "/sidecar/v1/ws") => error_response(
            400,
            ErrorCode::InvalidRequest,
            "WebSocket endpoint requires a valid Upgrade request",
            BTreeMap::from([("path".into(), path.into())]),
        ),
        (
            _,
            "/api/health"
            | "/api/config/setup-status"
            | "/api/system/readiness"
            | "/api/system/status"
            | "/sidecar/v1/health"
            | "/sidecar/v1/readiness"
            | "/sidecar/v1/capabilities"
            | "/sidecar/v1/python/preflight"
            | "/api/system/capabilities"
            | "/api/system/info"
            | "/api/system/build"
            | "/api/system/network"
            | "/api/system/env-coherence"
            | "/api/updates/version"
            | "/api/updates/runtime/status"
            | "/api/workspaces"
            | LEGACY_TRANSITION_STATUS_ROUTE
            | "/sidecar/v1/ws",
        ) => method_not_allowed(method, path, "GET"),
        (_, "/api/updates/settings" | "/api/app/settings") => {
            method_not_allowed(method, path, "GET, PUT")
        }
        (
            _,
            "/api/config/skip-setup"
            | "/api/config/complete-setup"
            | LEGACY_CONVERSION_ROUTE
            | "/sidecar/v1/jobs",
        ) => method_not_allowed(method, path, "POST"),
        (_, "/api/app/favorites") => method_not_allowed(method, path, "GET, POST"),
        (_, "/api/app/config-path") => method_not_allowed(method, path, "GET, POST, DELETE"),
        _ if workspace_run_detail_preselection_path(path) => {
            route_workspace_run_detail_preselection(state, method, path)
        }
        _ if workspace_run_detail_path(path) => route_workspace_run_detail(state, method, path),
        _ if workspace_runs_path(path) => route_workspace_run_summaries(state, method, path),
        _ if workspace_results_summary_path(path) => {
            route_workspace_results_summary(state, method, path)
        }
        _ if workspace_results_path(path) => {
            route_workspace_pipeline_summaries(state, method, path)
        }
        _ if path.starts_with("/api/app/favorites/") => route_app_favourite(state, method, path),
        _ if path.starts_with("/api/workspaces/") => {
            route_linked_workspace_state(state, method, path)
        }
        _ if match_durable_execution_job_record_route(path).is_some() => {
            route_durable_execution_job_record(state, method, path)
        }
        _ if is_native_job_http_path(path) => {
            route_native_job_request(&state.native_jobs, method, path)
        }
        _ if path.starts_with("/sidecar/v1/jobs/") => route_job(state, method, path),
        _ if path.starts_with(API_PREFIX) => error_response(
            404,
            ErrorCode::RouteNotFound,
            "No native sidecar route matches this path",
            BTreeMap::from([
                ("method".into(), method.into()),
                ("path".into(), path.into()),
            ]),
        ),
        _ => error_response(
            404,
            ErrorCode::RouteNotFound,
            "This native sidecar does not serve this Studio route",
            BTreeMap::from([
                ("method".into(), method.into()),
                ("path".into(), path.into()),
            ]),
        ),
    }
}

fn route_archive_v2_prediction_match(
    state: &SidecarState,
    method: &str,
    path: &str,
    body: &[u8],
) -> Option<HttpResponse> {
    (path == ARCHIVE_V2_PREDICTION_ROUTE).then(|| {
        if method != "POST" {
            return method_not_allowed(method, path, "POST");
        }
        archive_v2_prediction_response(state, body)
    })
}

fn archive_v2_prediction_response(state: &SidecarState, body: &[u8]) -> HttpResponse {
    // A runtime without an attested packaged libn4m closure refuses before JSON
    // parsing or persisted workspace resolution. A successfully preflighted
    // closure selects the Core-backed executor during product-state creation.
    if !state.archive_v2_prediction.is_selected() {
        return archive_v2_prediction_error_response(
            &ArchiveV2PredictionError::ExecutorUnavailable,
        );
    }
    let request = match parse_archive_v2_prediction_request(body) {
        Ok(request) => request,
        Err(error) => return archive_v2_prediction_error_response(&error),
    };
    let Ok(Some(workspace_path)) = state
        .app_settings
        .linked_workspace_path(&request.workspace_id)
    else {
        return archive_v2_prediction_error_response(
            &ArchiveV2PredictionError::WorkspaceUnavailable,
        );
    };
    match state
        .archive_v2_prediction
        .execute(request, &workspace_path)
    {
        Ok(response) => HttpResponse::json(200, response),
        Err(error) => archive_v2_prediction_error_response(&error),
    }
}

fn archive_v2_prediction_error_response(error: &ArchiveV2PredictionError) -> HttpResponse {
    let (status, code, message, reason) = match error {
        ArchiveV2PredictionError::ExecutorUnavailable => (
            503,
            ErrorCode::ArchiveV2PredictionUnavailable,
            "Native Archive V2 prediction is unavailable",
            "executor_not_selected",
        ),
        ArchiveV2PredictionError::BodyTooLarge => (
            413,
            ErrorCode::ArchiveV2PredictionInvalid,
            "Archive V2 prediction request exceeds 65536 bytes",
            "body_too_large",
        ),
        ArchiveV2PredictionError::InvalidJson => (
            400,
            ErrorCode::ArchiveV2PredictionInvalid,
            "Archive V2 prediction request must be valid JSON",
            "invalid_json",
        ),
        ArchiveV2PredictionError::InvalidShape(detail) => (
            422,
            ErrorCode::ArchiveV2PredictionInvalid,
            *detail,
            "invalid_shape",
        ),
        ArchiveV2PredictionError::Unsupported(detail) => (
            422,
            ErrorCode::ArchiveV2PredictionInvalid,
            *detail,
            "unsupported_contract",
        ),
        ArchiveV2PredictionError::WorkspaceUnavailable => (
            409,
            ErrorCode::ArchiveV2PredictionWorkspaceUnavailable,
            "Persisted linked workspace is unavailable",
            "workspace_unavailable",
        ),
        ArchiveV2PredictionError::WorkspaceUnsafe => (
            422,
            ErrorCode::ArchiveV2PredictionWorkspaceUnavailable,
            "Persisted linked workspace path is unsafe",
            "workspace_unsafe",
        ),
        ArchiveV2PredictionError::ArchiveNotFound => (
            404,
            ErrorCode::ArchiveV2PredictionArchiveNotFound,
            "Referenced workspace export does not exist",
            "archive_not_found",
        ),
        ArchiveV2PredictionError::ArchiveUnsafe => (
            422,
            ErrorCode::ArchiveV2PredictionArchiveUnsafe,
            "Referenced workspace export is unsafe",
            "archive_unsafe",
        ),
        ArchiveV2PredictionError::ArchiveTooLarge => (
            413,
            ErrorCode::ArchiveV2PredictionArchiveTooLarge,
            "Referenced workspace export exceeds 67108864 bytes",
            "archive_too_large",
        ),
        ArchiveV2PredictionError::ArchiveDigestMismatch => (
            422,
            ErrorCode::ArchiveV2PredictionDigestMismatch,
            "Referenced workspace export SHA-256 differs from the request",
            "archive_digest_mismatch",
        ),
        ArchiveV2PredictionError::ExecutionFailed => (
            500,
            ErrorCode::ArchiveV2PredictionExecutionFailed,
            "Native Archive V2 executor failed",
            "executor_failed",
        ),
        ArchiveV2PredictionError::InvalidExecutorOutput => (
            500,
            ErrorCode::ArchiveV2PredictionExecutionFailed,
            "Native Archive V2 executor returned an invalid closed response",
            "invalid_executor_output",
        ),
        ArchiveV2PredictionError::ResponseTooLarge => (
            500,
            ErrorCode::ArchiveV2PredictionExecutionFailed,
            "Native Archive V2 response exceeds 2097152 bytes",
            "response_too_large",
        ),
    };
    error_response(
        status,
        code,
        message,
        BTreeMap::from([("reason".into(), reason.into())]),
    )
}

fn route_scientific_submission_match(
    state: &SidecarState,
    method: &str,
    path: &str,
    body: &[u8],
) -> Option<HttpResponse> {
    (path == SCIENTIFIC_SUBMISSION_ROUTE).then(|| {
        if method == "POST" {
            scientific_submission_response(state, body)
        } else {
            method_not_allowed(method, path, "POST")
        }
    })
}

fn app_settings_response(state: &SidecarState) -> HttpResponse {
    match state.app_settings.response() {
        Ok(settings) => HttpResponse::json(200, settings.to_string()),
        Err(error) => app_settings_storage_error("get app settings", &error),
    }
}

fn setup_status_response(state: &SidecarState) -> HttpResponse {
    match state.app_settings.setup_status() {
        Ok(status) => HttpResponse::json(200, status.to_string()),
        Err(error) => app_settings_storage_error("get setup status", &error),
    }
}

fn complete_setup_request_response(state: &SidecarState, body: &[u8]) -> HttpResponse {
    let request = match app_settings_request_body(body) {
        Ok(request) => request,
        Err(response) => return response,
    };
    let Some(profile) = request.get("profile").and_then(Value::as_str) else {
        return app_settings_validation_error("request body must contain a string profile");
    };
    complete_setup_response(state, profile)
}

fn complete_setup_response(state: &SidecarState, profile: &str) -> HttpResponse {
    match state.app_settings.complete_setup(profile) {
        Ok(status) => HttpResponse::json(200, status.to_string()),
        Err(error) if profile.trim().is_empty() => app_settings_validation_error(&error),
        Err(error) => app_settings_storage_error("complete setup", &error),
    }
}

fn update_app_settings_response(state: &SidecarState, body: &[u8]) -> HttpResponse {
    let request = match app_settings_request_body(body) {
        Ok(request) => request,
        Err(response) => return response,
    };
    match state.app_settings.update_ui_preferences(&request) {
        Ok(()) => HttpResponse::json(
            200,
            json!({"success": true, "message": "App settings updated"}).to_string(),
        ),
        Err(error) => app_settings_storage_error("update app settings", &error),
    }
}

fn app_favourites_response(state: &SidecarState) -> HttpResponse {
    match state.app_settings.favourites_response() {
        Ok(favourites) => HttpResponse::json(200, favourites.to_string()),
        Err(error) => app_settings_storage_error("get favorites", &error),
    }
}

fn add_app_favourite_response(state: &SidecarState, body: &[u8]) -> HttpResponse {
    let request = match app_settings_request_body(body) {
        Ok(request) => request,
        Err(response) => return response,
    };
    let Some(pipeline_id) = request.get("pipeline_id").and_then(Value::as_str) else {
        return app_settings_validation_error("request body must contain a string pipeline_id");
    };
    match state.app_settings.add_favourite(pipeline_id) {
        Ok(added) => HttpResponse::json(
            200,
            json!({
                "success": true,
                "added": added,
                "message": if added { "Added to favorites" } else { "Already in favorites" },
            })
            .to_string(),
        ),
        Err(error) => app_settings_storage_error("add favorite", &error),
    }
}

fn route_app_favourite(state: &SidecarState, method: &str, path: &str) -> HttpResponse {
    let Some(pipeline_id) = path.strip_prefix("/api/app/favorites/") else {
        return error_response(
            404,
            ErrorCode::RouteNotFound,
            "No native sidecar route matches this path",
            BTreeMap::from([("path".into(), path.into())]),
        );
    };
    if pipeline_id.is_empty() || pipeline_id.contains('/') {
        return error_response(
            404,
            ErrorCode::RouteNotFound,
            "No native sidecar route matches this path",
            BTreeMap::from([("path".into(), path.into())]),
        );
    }
    if method != "DELETE" {
        return method_not_allowed(method, path, "DELETE");
    }
    match state.app_settings.remove_favourite(pipeline_id) {
        Ok(removed) => HttpResponse::json(
            200,
            json!({
                "success": true,
                "removed": removed,
                "message": if removed { "Removed from favorites" } else { "Not in favorites" },
            })
            .to_string(),
        ),
        Err(error) => app_settings_storage_error("remove favorite", &error),
    }
}

fn app_settings_request_body(body: &[u8]) -> Result<Value, HttpResponse> {
    match serde_json::from_slice::<Value>(body) {
        Ok(request) if request.is_object() => Ok(request),
        Ok(_) => Err(app_settings_validation_error(
            "request body must be a JSON object",
        )),
        Err(_) => Err(app_settings_validation_error(
            "request body must be valid JSON",
        )),
    }
}

fn app_settings_validation_error(message: &str) -> HttpResponse {
    HttpResponse::json(422, json!({"detail": message}).to_string())
}

fn app_settings_storage_error(operation: &str, error: &str) -> HttpResponse {
    HttpResponse::json(
        500,
        json!({"detail": format!("Failed to {operation}: {error}")}).to_string(),
    )
}

fn app_config_path_response(state: &SidecarState) -> HttpResponse {
    HttpResponse::json(200, state.app_settings.config_path_response().to_string())
}

fn set_app_config_path_response(state: &mut SidecarState, body: &[u8]) -> HttpResponse {
    let request = match app_settings_request_body(body) {
        Ok(request) => request,
        Err(response) => return response,
    };
    let Some(path) = request.get("path").and_then(Value::as_str) else {
        return app_settings_validation_error("request body must contain a string path");
    };
    match state.app_settings.set_config_path(path) {
        Ok(config_dir) => HttpResponse::json(
            200,
            json!({
                "success": true,
                "message": "Config path updated",
                "current_path": config_dir.to_string_lossy(),
                "requires_restart": true,
            })
            .to_string(),
        ),
        Err(ConfigPathError::DoesNotExist(path)) => HttpResponse::json(
            400,
            json!({"detail": format!("Config path does not exist: {path}")}).to_string(),
        ),
        Err(ConfigPathError::NotDirectory(path)) => HttpResponse::json(
            400,
            json!({"detail": format!("Config path is not a directory: {path}")}).to_string(),
        ),
        Err(ConfigPathError::Storage(error)) => {
            app_settings_storage_error("set config path", &error)
        }
    }
}

fn reset_app_config_path_response(state: &mut SidecarState) -> HttpResponse {
    match state.app_settings.reset_config_path() {
        Ok(config_dir) => HttpResponse::json(
            200,
            json!({
                "success": true,
                "message": "Config path reset to default",
                "current_path": config_dir.to_string_lossy(),
                "requires_restart": true,
            })
            .to_string(),
        ),
        Err(ConfigPathError::DoesNotExist(_) | ConfigPathError::NotDirectory(_)) => {
            unreachable!("reset does not validate a path")
        }
        Err(ConfigPathError::Storage(error)) => {
            app_settings_storage_error("reset config path", &error)
        }
    }
}

fn app_linked_workspaces_response(state: &SidecarState) -> HttpResponse {
    match state.app_settings.linked_workspaces_response() {
        Ok(workspaces) => HttpResponse::json(200, workspaces.to_string()),
        Err(error) => app_settings_storage_error("get linked workspaces", &error),
    }
}

fn active_workspace_identity(
    app_settings: &AppSettingsStore,
) -> Result<(String, PathBuf), HttpResponse> {
    let active = app_settings
        .active_linked_workspace_response()
        .map_err(|error| app_settings_storage_error("resolve active linked workspace", &error))?
        .ok_or_else(|| {
            HttpResponse::json(409, json!({"detail": "No workspace selected"}).to_string())
        })?;
    let id = active
        .get("id")
        .and_then(Value::as_str)
        .filter(|id| !id.is_empty())
        .ok_or_else(|| {
            HttpResponse::json(
                409,
                json!({"detail": "Active linked workspace identity is invalid"}).to_string(),
            )
        })?;
    let path = active
        .get("path")
        .and_then(Value::as_str)
        .filter(|path| !path.is_empty())
        .ok_or_else(|| {
            HttpResponse::json(
                409,
                json!({"detail": "Active linked workspace path is invalid"}).to_string(),
            )
        })?;
    Ok((id.to_owned(), PathBuf::from(path)))
}

fn workspace_transition_status_response(state: &SidecarState) -> HttpResponse {
    let (_, workspace_path) = match active_workspace_identity(&state.app_settings) {
        Ok(active) => active,
        Err(response) => return response,
    };
    let status = match inspect_workspace_transition(&workspace_path) {
        Ok(status) => status,
        Err(error) => {
            return HttpResponse::json(
                409,
                json!({"detail": format!("Failed to get transition status: {error}")}).to_string(),
            );
        }
    };
    let default_output_path = status
        .default_output_path
        .as_ref()
        .map(|path| path.to_string_lossy().into_owned());
    let conversion_command = default_output_path.as_ref().map(|output_path| {
        let request = LegacyConversionRequest {
            workspace_path: status.path.clone(),
            output_path: PathBuf::from(output_path),
            verify: true,
            dry_run: false,
            strict: false,
            link_converted_workspace: true,
        };
        display_command(&state.legacy_conversion.command(&request))
    });
    HttpResponse::json(
        200,
        json!({
            "path": status.path.to_string_lossy(),
            "format": status.format,
            "conversion_required": status.conversion_required,
            "message": status.message,
            "conversion_command": conversion_command,
            "default_output_path": default_output_path,
            "converter_available": state.legacy_conversion.is_available(),
        })
        .to_string(),
    )
}

fn legacy_workspace_conversion_response(state: &SidecarState, body: &[u8]) -> HttpResponse {
    legacy_workspace_conversion_with(&state.app_settings, &state.legacy_conversion, body)
}

fn legacy_workspace_conversion_with(
    app_settings: &AppSettingsStore,
    legacy_conversion: &LegacyConversionRuntime,
    body: &[u8],
) -> HttpResponse {
    let (source_workspace_id, workspace_path) = match active_workspace_identity(app_settings) {
        Ok(active) => active,
        Err(response) => return response,
    };
    let status = match inspect_workspace_transition(&workspace_path) {
        Ok(status) => status,
        Err(error) => {
            return HttpResponse::json(
                409,
                json!({"detail": format!("Failed to inspect active workspace: {error}")})
                    .to_string(),
            );
        }
    };
    if !status.conversion_required {
        return HttpResponse::json(
            409,
            json!({"detail": "Active workspace does not require legacy conversion"}).to_string(),
        );
    }
    if !legacy_conversion.is_available() {
        return HttpResponse::json(
            503,
            json!({"detail": "The bounded nirs4all-tools converter is unavailable"}).to_string(),
        );
    }
    let default_output = status
        .default_output_path
        .as_deref()
        .expect("a required conversion always has a default output");
    let request = match parse_legacy_conversion_request(body, &workspace_path, default_output) {
        Ok(request) => request,
        Err(detail) => return HttpResponse::json(422, json!({"detail": detail}).to_string()),
    };
    let command = legacy_conversion.command(&request);
    let result = match legacy_conversion.run(&request) {
        Ok(result) => result,
        Err(error) => return legacy_conversion_bridge_error_response(error),
    };
    legacy_conversion_process_response(
        app_settings,
        &source_workspace_id,
        &request,
        &command,
        &result,
    )
}

fn legacy_conversion_bridge_error_response(error: LegacyConversionFailure) -> HttpResponse {
    let status = match error {
        LegacyConversionFailure::Busy => 409,
        LegacyConversionFailure::TimedOut => 504,
        LegacyConversionFailure::SpawnFailed => 503,
        LegacyConversionFailure::ProcessFailed
        | LegacyConversionFailure::OutputReadFailed
        | LegacyConversionFailure::StdoutTooLarge
        | LegacyConversionFailure::StderrTooLarge
        | LegacyConversionFailure::InvalidUtf8
        | LegacyConversionFailure::CleanupFailed => 502,
    };
    HttpResponse::json(
        status,
        json!({
            "detail": "The bounded nirs4all-tools converter process failed",
            "reason": error.reason(),
        })
        .to_string(),
    )
}

fn legacy_conversion_process_response(
    app_settings: &AppSettingsStore,
    source_workspace_id: &str,
    request: &LegacyConversionRequest,
    command: &[String],
    result: &LegacyConversionProcessOutput,
) -> HttpResponse {
    let code = result.return_code;
    let success = matches!(code, 0 | 10);
    let best_effort = code == 10;
    let mut activation_skipped = false;
    let mut linked_workspace_id: Option<String> = None;
    let mut active_workspace_path: Option<String> = None;
    let mut link_error: Option<String> = None;

    if success && !request.dry_run && request.link_converted_workspace {
        if best_effort {
            activation_skipped = true;
            link_error = Some(
                "Conversion completed in best-effort mode; the converted workspace was not activated automatically."
                    .into(),
            );
        } else if !request.verify {
            activation_skipped = true;
            link_error = Some(
                "Conversion was not verified; the converted workspace was not activated automatically."
                    .into(),
            );
        } else {
            let timestamp = websocket_transport::rfc3339_now();
            match app_settings.link_and_activate_workspace(
                &request.output_path,
                &timestamp,
                source_workspace_id,
            ) {
                Ok(workspace) => {
                    linked_workspace_id = workspace
                        .get("id")
                        .and_then(Value::as_str)
                        .map(str::to_owned);
                    active_workspace_path = workspace
                        .get("path")
                        .and_then(Value::as_str)
                        .map(str::to_owned);
                }
                Err(error) => {
                    activation_skipped = true;
                    link_error = Some(error);
                }
            }
        }
    }

    let payload = json!({
        "job_id": null,
        "command": command,
        "output_path": request.output_path.to_string_lossy(),
        "dry_run": request.dry_run,
        "return_code": code,
        "stdout": result.stdout,
        "stderr": result.stderr,
        "success": success,
        "best_effort": best_effort,
        "activation_skipped": activation_skipped,
        "link_converted_workspace": request.link_converted_workspace,
        "linked_workspace_id": linked_workspace_id,
        "active_workspace_path": active_workspace_path,
        "link_error": link_error,
    });
    match code {
        0 | 10 => HttpResponse::json(200, payload.to_string()),
        20 => legacy_conversion_refusal_response(
            422,
            "Legacy workspace conversion refused unsupported input",
            payload,
        ),
        30 => legacy_conversion_refusal_response(
            422,
            "Legacy workspace conversion verification failed",
            payload,
        ),
        40 => legacy_conversion_refusal_response(
            409,
            "Legacy workspace conversion was refused by safety policy",
            payload,
        ),
        70 => legacy_conversion_refusal_response(
            500,
            "Legacy workspace converter reported an internal error",
            payload,
        ),
        _ => legacy_conversion_refusal_response(
            502,
            "Legacy workspace converter returned an unknown exit code",
            payload,
        ),
    }
}

fn legacy_conversion_refusal_response(
    status: u16,
    detail: &str,
    mut payload: Value,
) -> HttpResponse {
    if let Some(payload) = payload.as_object_mut() {
        payload.insert("detail".into(), Value::String(detail.into()));
    }
    HttpResponse::json(status, payload.to_string())
}

fn system_status_response(state: &SidecarState) -> HttpResponse {
    match state.app_settings.active_linked_workspace_response() {
        Ok(active_workspace) => {
            let workspace = active_workspace.map(|workspace| {
                json!({
                    "name": workspace["name"],
                    "path": workspace["path"],
                    "datasets_count": workspace["discovered"]["datasets_count"],
                    "last_accessed": workspace["last_scanned"],
                })
            });
            HttpResponse::json(
                200,
                json!({
                    "status": {
                        "workspace_loaded": workspace.is_some(),
                        "workspace": workspace,
                        "nirs4all_available": state.python_plugin_host.is_some(),
                    }
                })
                .to_string(),
            )
        }
        Err(error) => app_settings_storage_error("get native system status", &error),
    }
}

fn workspace_runs_path(path: &str) -> bool {
    let Some(suffix) = path.strip_prefix("/api/workspaces/") else {
        return false;
    };
    let mut segments = suffix.split('/');
    matches!(
        (segments.next(), segments.next(), segments.next()),
        (Some(workspace_id), Some("runs"), None) if !workspace_id.is_empty()
    )
}

fn decoded_path_segment(value: &str) -> Option<String> {
    percent_decode_str(value)
        .decode_utf8()
        .ok()
        .map(std::borrow::Cow::into_owned)
        .filter(|value| !value.is_empty() && !value.contains('/'))
}

fn workspace_run_detail_preselection_workspace(path: &str) -> Option<String> {
    let suffix = path.strip_prefix("/sidecar/v1/workspaces/")?;
    let mut segments = suffix.split('/');
    match (segments.next(), segments.next(), segments.next()) {
        (Some(workspace_id), Some("run-detail-preselection"), None) if !workspace_id.is_empty() => {
            decoded_path_segment(workspace_id)
        }
        _ => None,
    }
}

fn workspace_run_detail_preselection_path(path: &str) -> bool {
    workspace_run_detail_preselection_workspace(path).is_some()
}

fn workspace_run_detail_ids(path: &str) -> Option<(String, String)> {
    let suffix = path.strip_prefix("/api/workspaces/")?;
    let mut segments = suffix.split('/');
    match (
        segments.next(),
        segments.next(),
        segments.next(),
        segments.next(),
    ) {
        (Some(workspace_id), Some("runs"), Some(run_id), None) => Some((
            decoded_path_segment(workspace_id)?,
            decoded_path_segment(run_id)?,
        )),
        _ => None,
    }
}

fn workspace_run_detail_path(path: &str) -> bool {
    workspace_run_detail_ids(path).is_some()
}

fn workspace_run_discovery_query_supported(query: Option<&str>) -> bool {
    let Some(query) = query else {
        return true;
    };
    if query.is_empty() {
        return false;
    }
    let mut source_seen = false;
    let mut refresh_seen = false;
    for parameter in query.split('&') {
        let Some((name, value)) = parameter.split_once('=') else {
            return false;
        };
        match name {
            "source" if !source_seen && matches!(value, "unified" | "manifests" | "parquet") => {
                source_seen = true;
            }
            "refresh" if !refresh_seen && matches!(value, "true" | "false") => {
                refresh_seen = true;
            }
            _ => return false,
        }
    }
    source_seen || refresh_seen
}

fn workspace_results_path(path: &str) -> bool {
    let Some(suffix) = path.strip_prefix("/api/workspaces/") else {
        return false;
    };
    let mut segments = suffix.split('/');
    matches!(
        (segments.next(), segments.next(), segments.next()),
        (Some(workspace_id), Some("results"), None) if !workspace_id.is_empty()
    )
}

fn workspace_results_summary_path(path: &str) -> bool {
    let Some(suffix) = path.strip_prefix("/api/workspaces/") else {
        return false;
    };
    let mut segments = suffix.split('/');
    matches!(
        (
            segments.next(),
            segments.next(),
            segments.next(),
            segments.next()
        ),
        (Some(workspace_id), Some("results"), Some("summary"), None)
            if !workspace_id.is_empty()
    )
}

fn route_workspace_run_summaries(state: &SidecarState, method: &str, path: &str) -> HttpResponse {
    if method != "GET" {
        return method_not_allowed(method, path, "GET");
    }
    let Some(workspace_id) = path
        .strip_prefix("/api/workspaces/")
        .and_then(|suffix| suffix.strip_suffix("/runs"))
        .filter(|workspace_id| !workspace_id.is_empty())
    else {
        return linked_workspace_route_not_found(path);
    };
    let workspace_path = match state.app_settings.linked_workspace_path(workspace_id) {
        Ok(Some(workspace_path)) => workspace_path,
        Ok(None) => {
            return HttpResponse::json(404, json!({"detail": "Workspace not found"}).to_string());
        }
        Err(error) => return app_settings_storage_error("resolve linked workspace", &error),
    };
    match read_run_summaries(&workspace_path, MAX_RUN_SUMMARIES, 0) {
        Ok(runs) => {
            let runs = runs
                .iter()
                .map(WorkspaceStoreRunSummary::response)
                .collect::<Vec<_>>();
            let total = runs.len();
            HttpResponse::json(
                200,
                json!({"workspace_id": workspace_id, "runs": runs, "total": total}).to_string(),
            )
        }
        Err(error) => workspace_store_read_error_response(&error),
    }
}

fn route_workspace_run_detail_preselection(
    state: &SidecarState,
    method: &str,
    path: &str,
) -> HttpResponse {
    if method != "GET" {
        return method_not_allowed(method, path, "GET");
    }
    let Some(workspace_id) = workspace_run_detail_preselection_workspace(path) else {
        return linked_workspace_route_not_found(path);
    };
    let workspace_path = match state.app_settings.linked_workspace_path(&workspace_id) {
        Ok(Some(workspace_path)) => workspace_path,
        Ok(None) => {
            return HttpResponse::json(
                404,
                json!({
                    "schema_id": "nirs4all.studio-run-detail-preselection-decision.v1",
                    "workspace_id": workspace_id,
                    "target": "reject",
                    "verified_store_v5": false,
                    "store_schema_version": null,
                    "reason": "workspace_not_found",
                    "fallback_after_native_selection": "none",
                })
                .to_string(),
            );
        }
        Err(error) => return app_settings_storage_error("preselect run detail", &error),
    };
    let decision = preselect_run_detail(&workspace_path, state.python_plugin_host.as_deref());
    HttpResponse::json(
        decision.status,
        decision.response(&workspace_id).to_string(),
    )
}

fn route_workspace_run_detail(state: &SidecarState, method: &str, path: &str) -> HttpResponse {
    if method != "GET" {
        return method_not_allowed(method, path, "GET");
    }
    let Some((workspace_id, run_id)) = workspace_run_detail_ids(path) else {
        return linked_workspace_route_not_found(path);
    };
    let workspace_path = match state.app_settings.linked_workspace_path(&workspace_id) {
        Ok(Some(workspace_path)) => workspace_path,
        Ok(None) => {
            return HttpResponse::json(404, json!({"detail": "Workspace not found"}).to_string());
        }
        Err(error) => return app_settings_storage_error("resolve linked workspace", &error),
    };

    if let Err(error) = preflight_run_detail_projection(&workspace_path) {
        return workspace_store_read_error_response(&error);
    }

    let Some(python_plugin_host) = state.python_plugin_host.as_deref() else {
        return error_response(
            503,
            ErrorCode::PythonPluginUnavailable,
            "The configured Python library host is unavailable",
            BTreeMap::new(),
        );
    };
    let owner_output =
        match materialize_run_detail_owner(python_plugin_host, &workspace_path, &run_id) {
            Ok(Some(output)) => output,
            Ok(None) => {
                return HttpResponse::json(
                    404,
                    json!({"detail": format!("Run '{run_id}' not found")}).to_string(),
                );
            }
            Err(error) => return run_detail_owner_bridge_error_response(error),
        };
    let linked_datasets = match state.app_settings.dataset_links() {
        Ok(datasets) => datasets,
        Err(error) => return app_settings_storage_error("read linked datasets", &error),
    };
    compose_store_run_detail(&owner_output, &linked_datasets).map_or_else(
        |_| {
            error_response(
                409,
                ErrorCode::InvalidRequest,
                "The Store-v5 owner output is incompatible with the native run-detail contract",
                BTreeMap::from([("workspace_id".into(), workspace_id)]),
            )
        },
        |response| HttpResponse::json(200, response.to_string()),
    )
}

fn run_detail_owner_bridge_error_response(error: RunDetailOwnerBridgeFailure) -> HttpResponse {
    let (status, code, message) = match error {
        RunDetailOwnerBridgeFailure::InvalidInput => (
            400,
            ErrorCode::InvalidRequest,
            "The native run-detail request contains an invalid identifier",
        ),
        RunDetailOwnerBridgeFailure::TimedOut => (
            504,
            ErrorCode::RequestTimeout,
            "The Python library host exceeded the native run-detail deadline",
        ),
        RunDetailOwnerBridgeFailure::SpawnFailed => (
            503,
            ErrorCode::PythonPluginUnavailable,
            "The configured Python library host could not be started",
        ),
        _ => (
            502,
            ErrorCode::PythonPluginPreflightFailed,
            "The Python library host returned an invalid native run-detail result",
        ),
    };
    error_response(
        status,
        code,
        message,
        BTreeMap::from([("reason".into(), error.reason().into())]),
    )
}

fn route_workspace_pipeline_summaries(
    state: &SidecarState,
    method: &str,
    path: &str,
) -> HttpResponse {
    if method != "GET" {
        return method_not_allowed(method, path, "GET");
    }
    let Some(workspace_id) = path
        .strip_prefix("/api/workspaces/")
        .and_then(|suffix| suffix.strip_suffix("/results"))
        .filter(|workspace_id| !workspace_id.is_empty())
    else {
        return linked_workspace_route_not_found(path);
    };
    let workspace_path = match state.app_settings.linked_workspace_path(workspace_id) {
        Ok(Some(workspace_path)) => workspace_path,
        Ok(None) => {
            return HttpResponse::json(404, json!({"detail": "Workspace not found"}).to_string());
        }
        Err(error) => return app_settings_storage_error("resolve linked workspace", &error),
    };
    match read_pipeline_summaries(&workspace_path, DEFAULT_PIPELINE_SUMMARIES_LIMIT, 0) {
        Ok(page) => {
            let results = page
                .results
                .iter()
                .map(WorkspaceStorePipelineSummary::response)
                .collect::<Vec<_>>();
            let limit = usize::from(DEFAULT_PIPELINE_SUMMARIES_LIMIT);
            HttpResponse::json(
                200,
                json!({
                    "workspace_id": workspace_id,
                    "results": results,
                    "total": page.total,
                    "limit": limit,
                    "offset": 0,
                    "has_more": limit < page.total,
                })
                .to_string(),
            )
        }
        Err(error) => workspace_store_read_error_response(&error),
    }
}

fn route_workspace_results_summary(state: &SidecarState, method: &str, path: &str) -> HttpResponse {
    if method != "GET" {
        return method_not_allowed(method, path, "GET");
    }
    let Some(workspace_id) = path
        .strip_prefix("/api/workspaces/")
        .and_then(|suffix| suffix.strip_suffix("/results/summary"))
        .filter(|workspace_id| !workspace_id.is_empty())
    else {
        return linked_workspace_route_not_found(path);
    };
    let workspace_path = match state.app_settings.linked_workspace_path(workspace_id) {
        Ok(Some(workspace_path)) => workspace_path,
        Ok(None) => {
            return HttpResponse::json(404, json!({"detail": "Workspace not found"}).to_string());
        }
        Err(error) => return app_settings_storage_error("resolve linked workspace", &error),
    };
    let linked_datasets = match state.app_settings.dataset_links() {
        Ok(linked_datasets) => linked_datasets,
        Err(error) => return app_settings_storage_error("read dataset links", &error),
    };
    match read_results_summary(&workspace_path, workspace_id, &linked_datasets) {
        Ok(payload) => HttpResponse::json(200, payload.to_string()),
        Err(error) => workspace_store_read_error_response(&error),
    }
}

fn route_durable_execution_job_record(
    state: &SidecarState,
    method: &str,
    path: &str,
) -> HttpResponse {
    if method != "GET" {
        return method_not_allowed(method, path, "GET");
    }
    let Some(route) = match_durable_execution_job_record_route(path) else {
        return error_response(
            404,
            ErrorCode::RouteNotFound,
            "No native durable execution-job route matches this path",
            BTreeMap::from([("path".into(), path.into())]),
        );
    };
    let active = match state.app_settings.active_linked_workspace_response() {
        Ok(Some(active)) => active,
        Ok(None) => return missing_durable_execution_record(route.route, &route.id),
        Err(error) => return app_settings_storage_error("resolve active linked workspace", &error),
    };
    let Some(workspace_path) = active
        .get("path")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .map(PathBuf::from)
    else {
        return app_settings_storage_error(
            "resolve active linked workspace",
            "active linked workspace is missing a path",
        );
    };

    let run = match read_run_detail_projection(&workspace_path, &route.id) {
        Ok(run) => run,
        Err(error) => return workspace_store_read_error_response(&error),
    };
    if route.route == DurableExecutionJobRecordRoute::ByRunId && run.is_none() {
        return HttpResponse::json(
            404,
            json!({"detail": format!("Run {} not found", route.id)}).to_string(),
        );
    }
    let record = match read_execution_job_record(&workspace_path, &route.id) {
        Ok(record) => record,
        Err(ExecutionJobRecordReadError::Missing) => {
            return missing_durable_execution_record(route.route, &route.id);
        }
        Err(error) => return execution_job_record_read_error_response(&error),
    };
    HttpResponse::json(
        200,
        compose_execution_job_record_response(&record, run.as_ref()).to_string(),
    )
}

fn missing_durable_execution_record(
    route: DurableExecutionJobRecordRoute,
    id: &str,
) -> HttpResponse {
    let detail = match route {
        DurableExecutionJobRecordRoute::ByJobId => {
            format!("Execution job record {id} not found")
        }
        DurableExecutionJobRecordRoute::ByRunId => {
            format!("Execution job record for run {id} not found")
        }
    };
    HttpResponse::json(404, json!({"detail": detail}).to_string())
}

fn execution_job_record_read_error_response(error: &ExecutionJobRecordReadError) -> HttpResponse {
    let reason = match error {
        ExecutionJobRecordReadError::WorkspaceUnavailable => "workspace_unavailable",
        ExecutionJobRecordReadError::InvalidIdentifier => "invalid_identifier",
        ExecutionJobRecordReadError::Missing => "missing",
        ExecutionJobRecordReadError::SymlinkOrEscape => "symlink_or_escape",
        ExecutionJobRecordReadError::TooLarge => "too_large",
        ExecutionJobRecordReadError::ChangedDuringRead => "changed_during_read",
        ExecutionJobRecordReadError::Read => "read_failed",
        ExecutionJobRecordReadError::InvalidJson => "invalid_json",
        ExecutionJobRecordReadError::InvalidShape => "invalid_shape",
    };
    HttpResponse::json(
        409,
        json!({
            "detail": "Workspace execution job record is not compatible with the native contract",
            "code": "execution_job_record_incompatible",
            "reason": reason,
        })
        .to_string(),
    )
}

fn workspace_store_read_error_response(error: &WorkspaceStoreReadError) -> HttpResponse {
    match error {
        WorkspaceStoreReadError::StoreNotFound => HttpResponse::json(
            409,
            json!({
                "detail": "Workspace has no compatible native WorkspaceStore v5",
                "code": "workspace_store_unavailable",
            })
            .to_string(),
        ),
        WorkspaceStoreReadError::SchemaVersion { expected, actual } => HttpResponse::json(
            409,
            json!({
                "detail": format!("WorkspaceStore schema v{actual} is unsupported; exact v{expected} is required"),
                "code": "workspace_store_schema_incompatible",
            })
            .to_string(),
        ),
        WorkspaceStoreReadError::MissingColumns { .. } => HttpResponse::json(
            409,
            json!({
                "detail": "WorkspaceStore v5 does not provide the required native summary projections",
                "code": "workspace_store_projection_incompatible",
            })
            .to_string(),
        ),
        WorkspaceStoreReadError::LiveJournal(_) | WorkspaceStoreReadError::ChangedDuringRead => {
            HttpResponse::json(
                409,
                json!({
                    "detail": "WorkspaceStore is changing and cannot be read as an immutable snapshot",
                    "code": "workspace_store_busy",
                })
                .to_string(),
            )
        }
        #[cfg(windows)]
        WorkspaceStoreReadError::UnsupportedPath(_) => HttpResponse::json(
            409,
            json!({
                "detail": "WorkspaceStore must be on a local volume supported by bundled SQLite",
                "code": "workspace_store_path_unsupported",
            })
            .to_string(),
        ),
        _ => HttpResponse::json(
            500,
            json!({
                "detail": "Native WorkspaceStore run-summary read failed",
                "code": "workspace_store_read_failed",
            })
            .to_string(),
        ),
    }
}

fn route_linked_workspace_state(state: &SidecarState, method: &str, path: &str) -> HttpResponse {
    let Some(suffix) = path.strip_prefix("/api/workspaces/") else {
        return linked_workspace_route_not_found(path);
    };
    let mut segments = suffix.split('/');
    let Some(workspace_id) = segments.next().filter(|id| !id.is_empty()) else {
        return linked_workspace_route_not_found(path);
    };
    let action = segments.next();
    if segments.next().is_some() || action.is_some_and(|action| action != "activate") {
        return linked_workspace_route_not_found(path);
    }

    match (method, action) {
        ("DELETE", None) => match state.app_settings.unlink_linked_workspace(workspace_id) {
            Ok(true) => HttpResponse::json(
                200,
                json!({"success": true, "message": "Workspace unlinked"}).to_string(),
            ),
            Ok(false) => {
                HttpResponse::json(404, json!({"detail": "Workspace not found"}).to_string())
            }
            Err(error) => app_settings_storage_error("unlink workspace", &error),
        },
        ("POST", Some("activate")) => {
            match state.app_settings.activate_linked_workspace(workspace_id) {
                Ok(Some(workspace)) => HttpResponse::json(200, workspace.to_string()),
                Ok(None) => {
                    HttpResponse::json(404, json!({"detail": "Workspace not found"}).to_string())
                }
                Err(error) => app_settings_storage_error("activate workspace", &error),
            }
        }
        (_, None) => method_not_allowed(method, path, "DELETE"),
        (_, Some("activate")) => method_not_allowed(method, path, "POST"),
        _ => linked_workspace_route_not_found(path),
    }
}

fn linked_workspace_route_not_found(path: &str) -> HttpResponse {
    error_response(
        404,
        ErrorCode::RouteNotFound,
        "No native sidecar route matches this path",
        BTreeMap::from([("path".into(), path.into())]),
    )
}

fn system_network_response() -> HttpResponse {
    HttpResponse::json(
        200,
        native_network_state_json(
            native_update_settings_path().as_deref(),
            environment_forces_offline(),
        )
        .to_string(),
    )
}

fn native_network_state_json(update_settings_path: Option<&Path>, env_forced: bool) -> Value {
    let mode = offline_mode_from_update_settings(update_settings_path).unwrap_or("auto");
    let forced = env_forced || mode == "on";
    json!({
        "online": !forced,
        "forced": forced,
        "mode": mode,
        "env_forced": env_forced,
    })
}

fn environment_forces_offline() -> bool {
    env::var(OFFLINE_ENV).is_ok_and(|value| {
        matches!(
            value.trim().to_ascii_lowercase().as_str(),
            "1" | "true" | "yes" | "on"
        )
    })
}

fn native_update_settings_path() -> Option<PathBuf> {
    if let Some(path) = env::var_os(BACKEND_DATA_DIR_ENV).filter(|value| !value.is_empty()) {
        return Some(PathBuf::from(path).join(UPDATE_SETTINGS_FILE));
    }

    #[cfg(target_os = "windows")]
    {
        let base = env::var_os("LOCALAPPDATA").map(PathBuf::from).or_else(|| {
            env::var_os("USERPROFILE")
                .map(PathBuf::from)
                .map(|home| home.join("AppData").join("Local"))
        })?;
        // `platformdirs.user_data_dir(appname, appauthor)` uses the author on
        // Windows, unlike Linux and macOS. Retain the project's documented
        // fallback location when the optional Python `platformdirs` package
        // was absent when the existing preference was written.
        let platformdirs_path = base
            .join("nirs4all")
            .join("nirs4all-webapp")
            .join(UPDATE_SETTINGS_FILE);
        let fallback_path = base.join("nirs4all-webapp").join(UPDATE_SETTINGS_FILE);
        return Some(if platformdirs_path.exists() || !fallback_path.exists() {
            platformdirs_path
        } else {
            fallback_path
        });
    }

    #[cfg(target_os = "macos")]
    {
        return env::var_os("HOME").map(|home| {
            PathBuf::from(home)
                .join("Library")
                .join("Application Support")
                .join("nirs4all-webapp")
                .join(UPDATE_SETTINGS_FILE)
        });
    }

    #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
    {
        let base = env::var_os("XDG_DATA_HOME")
            .map(PathBuf::from)
            .or_else(|| env::var_os("HOME").map(|home| PathBuf::from(home).join(".local/share")))?;
        Some(base.join("nirs4all-webapp").join(UPDATE_SETTINGS_FILE))
    }
}

fn offline_mode_from_update_settings(update_settings_path: Option<&Path>) -> Option<&'static str> {
    let path = update_settings_path?;
    if fs::metadata(path).ok()?.len() > MAX_UPDATE_SETTINGS_BYTES {
        return None;
    }
    let settings = fs::read_to_string(path).ok()?;
    settings.lines().find_map(|line| {
        let line = line.trim_start();
        if line.starts_with('#') {
            return None;
        }
        let (key, value) = line.split_once(':')?;
        if key.trim() != "offline_mode" {
            return None;
        }
        let value = value
            .split_once('#')
            .map_or(value, |(value, _)| value)
            .trim()
            .trim_matches('"')
            .trim_matches('\'');
        match value {
            "auto" => Some("auto"),
            "on" => Some("on"),
            "off" => Some("off"),
            _ => None,
        }
    })
}

/// Persist the legacy update-settings shape without invoking `FastAPI` or a
/// Python configuration loader.  The file remains YAML so existing Studio
/// installations retain their preferences when this route becomes native.
#[derive(Debug)]
struct UpdateSettingsStore {
    path: Option<PathBuf>,
}

impl UpdateSettingsStore {
    fn from_environment() -> Self {
        Self {
            path: native_update_settings_path(),
        }
    }

    #[cfg(test)]
    fn new(path: impl Into<PathBuf>) -> Self {
        Self {
            path: Some(path.into()),
        }
    }

    fn load(&self) -> Value {
        let Some(path) = self.path.as_deref() else {
            return default_update_settings();
        };
        let Ok(metadata) = fs::metadata(path) else {
            return default_update_settings();
        };
        if metadata.len() > MAX_UPDATE_SETTINGS_BYTES {
            return default_update_settings();
        }
        fs::read_to_string(path)
            .ok()
            .and_then(|contents| serde_yaml::from_str::<Value>(&contents).ok())
            .and_then(|settings| normalize_update_settings(&settings).ok())
            .unwrap_or_else(default_update_settings)
    }

    fn update(&self, request: &Value) -> Result<Value, String> {
        let current = self.load();
        let merged = merge_update_settings(&current, request)?;
        self.save(&merged)?;
        Ok(merged)
    }

    fn save(&self, settings: &Value) -> Result<(), String> {
        let path = self
            .path
            .as_deref()
            .ok_or_else(|| "could not resolve the native update settings path".to_string())?;
        let parent = path.parent().ok_or_else(|| {
            format!(
                "could not resolve a parent directory for {}",
                path.display()
            )
        })?;
        fs::create_dir_all(parent).map_err(|error| {
            format!(
                "could not create update settings directory {}: {error}",
                parent.display()
            )
        })?;
        let encoded = serde_yaml::to_string(settings)
            .map_err(|error| format!("could not encode update settings: {error}"))?;
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let temporary = parent.join(format!(
            ".{UPDATE_SETTINGS_FILE}.{}-{nonce}.tmp",
            process::id()
        ));
        let write_result = (|| -> Result<(), String> {
            let mut file = OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&temporary)
                .map_err(|error| format!("could not create {}: {error}", temporary.display()))?;
            file.write_all(encoded.as_bytes())
                .and_then(|()| file.sync_all())
                .map_err(|error| format!("could not write {}: {error}", temporary.display()))?;
            replace_atomic(&temporary, path).map_err(|error| {
                format!(
                    "could not atomically replace update settings at {}: {error}",
                    path.display()
                )
            })
        })();
        if write_result.is_err() {
            let _ = fs::remove_file(&temporary);
        }
        write_result
    }
}

fn update_settings_response(state: &SidecarState) -> HttpResponse {
    HttpResponse::json(200, state.update_settings.load().to_string())
}

fn save_update_settings_response(state: &SidecarState, body: &[u8]) -> HttpResponse {
    let request = match app_settings_request_body(body) {
        Ok(request) => request,
        Err(response) => return response,
    };
    match state.update_settings.update(&request) {
        Ok(settings) => HttpResponse::json(200, settings.to_string()),
        Err(error) if error.starts_with("invalid update setting") => {
            app_settings_validation_error(&error)
        }
        Err(error) => app_settings_storage_error("update update settings", &error),
    }
}

fn default_update_settings() -> Value {
    json!({
        "auto_check": true,
        "check_interval_hours": DEFAULT_UPDATE_CHECK_INTERVAL_HOURS,
        "prerelease_channel": false,
        "github_repo": DEFAULT_UPDATE_GITHUB_REPO,
        "pypi_package": DEFAULT_UPDATE_PYPI_PACKAGE,
        "dismissed_versions": [],
        "offline_mode": "auto",
    })
}

fn merge_update_settings(current: &Value, updates: &Value) -> Result<Value, String> {
    let mut merged = current
        .as_object()
        .cloned()
        .ok_or_else(|| "invalid update setting storage shape".to_string())?;
    let updates = updates
        .as_object()
        .ok_or_else(|| "invalid update setting request body".to_string())?;
    for key in [
        "auto_check",
        "check_interval_hours",
        "prerelease_channel",
        "github_repo",
        "pypi_package",
        "dismissed_versions",
        "offline_mode",
    ] {
        if let Some(value) = updates.get(key) {
            merged.insert(key.into(), value.clone());
        }
    }
    normalize_update_settings(&Value::Object(merged))
}

fn normalize_update_settings(settings: &Value) -> Result<Value, String> {
    let settings = settings
        .as_object()
        .ok_or_else(|| "invalid update setting storage shape".to_string())?;
    let defaults = default_update_settings();
    let default_values = defaults
        .as_object()
        .expect("default update settings is a JSON object");
    let auto_check = update_setting_bool(settings, default_values, "auto_check")?;
    let check_interval_hours =
        update_setting_integer(settings, default_values, "check_interval_hours")?;
    let prerelease_channel = update_setting_bool(settings, default_values, "prerelease_channel")?;
    let github_repo = update_setting_string(settings, default_values, "github_repo")?;
    let pypi_package = update_setting_string(settings, default_values, "pypi_package")?;
    let offline_mode = update_setting_string(settings, default_values, "offline_mode")?;
    let dismissed_versions = match settings.get("dismissed_versions") {
        Some(Value::Array(values)) if values.iter().all(Value::is_string) => {
            Value::Array(values.clone())
        }
        Some(_) => return Err("invalid update setting dismissed_versions".into()),
        None => default_values["dismissed_versions"].clone(),
    };
    Ok(json!({
        "auto_check": auto_check,
        "check_interval_hours": check_interval_hours,
        "prerelease_channel": prerelease_channel,
        "github_repo": github_repo,
        "pypi_package": pypi_package,
        "dismissed_versions": dismissed_versions,
        "offline_mode": offline_mode,
    }))
}

fn update_setting_bool(
    settings: &serde_json::Map<String, Value>,
    defaults: &serde_json::Map<String, Value>,
    key: &str,
) -> Result<Value, String> {
    match settings.get(key) {
        Some(Value::Bool(value)) => Ok(Value::Bool(*value)),
        Some(_) => Err(format!("invalid update setting {key}")),
        None => Ok(defaults[key].clone()),
    }
}

fn update_setting_integer(
    settings: &serde_json::Map<String, Value>,
    defaults: &serde_json::Map<String, Value>,
    key: &str,
) -> Result<Value, String> {
    match settings.get(key) {
        Some(Value::Number(value)) if value.as_i64().is_some() => Ok(Value::Number(value.clone())),
        Some(_) => Err(format!("invalid update setting {key}")),
        None => Ok(defaults[key].clone()),
    }
}

fn update_setting_string(
    settings: &serde_json::Map<String, Value>,
    defaults: &serde_json::Map<String, Value>,
    key: &str,
) -> Result<Value, String> {
    match settings.get(key) {
        Some(Value::String(value)) => Ok(Value::String(value.clone())),
        Some(_) => Err(format!("invalid update setting {key}")),
        None => Ok(defaults[key].clone()),
    }
}

fn python_capabilities_response(state: &SidecarState) -> HttpResponse {
    let Some(python_plugin_host) = state.python_plugin_host.as_deref() else {
        return error_response(
            503,
            ErrorCode::PythonPluginUnavailable,
            "No Python plugin host is configured for this native sidecar",
            BTreeMap::from([("reason".into(), "not_configured".into())]),
        );
    };
    match read_python_capabilities(python_plugin_host) {
        Ok(body) => HttpResponse::json(200, body),
        Err(reason) => error_response(
            503,
            ErrorCode::PythonPluginPreflightFailed,
            "The configured Python plugin host could not report capabilities",
            BTreeMap::from([("reason".into(), reason.as_str().into())]),
        ),
    }
}

fn python_system_info_response(state: &SidecarState) -> HttpResponse {
    let Some(python_plugin_host) = state.python_plugin_host.as_deref() else {
        return error_response(
            503,
            ErrorCode::PythonPluginUnavailable,
            "No Python plugin host is configured for this native sidecar",
            BTreeMap::from([("reason".into(), "not_configured".into())]),
        );
    };
    match read_python_system_info(python_plugin_host) {
        Ok(body) => HttpResponse::json(200, body),
        Err(reason) => error_response(
            503,
            ErrorCode::PythonPluginPreflightFailed,
            "The configured Python plugin host could not report system information",
            BTreeMap::from([("reason".into(), reason.as_str().into())]),
        ),
    }
}

/// Return product version inventory from Rust-owned launch metadata and a
/// bounded Python-library inspection. The interpreter is never an HTTP
/// backend: it only supplies the installed nirs4all distribution version.
fn python_updates_version_response(state: &SidecarState) -> HttpResponse {
    let Some(python_plugin_host) = state.python_plugin_host.as_deref() else {
        return error_response(
            503,
            ErrorCode::PythonPluginUnavailable,
            "No Python plugin host is configured for this native sidecar",
            BTreeMap::from([("reason".into(), "not_configured".into())]),
        );
    };
    match read_python_updates_version(python_plugin_host)
        .and_then(|probe| native_updates_version_json(&native_app_version(), &probe))
    {
        Ok(body) => HttpResponse::json(200, body),
        Err(reason) => error_response(
            503,
            ErrorCode::PythonPluginPreflightFailed,
            "The configured Python plugin host could not report version inventory",
            BTreeMap::from([("reason".into(), reason.as_str().into())]),
        ),
    }
}

fn native_app_version() -> String {
    env::var(APP_VERSION_ENV)
        .ok()
        .filter(|version| !version.trim().is_empty())
        .unwrap_or_else(|| "unknown".into())
}

fn native_updates_version_json(
    webapp_version: &str,
    probe: &Value,
) -> Result<String, PythonPluginBridgeFailure> {
    let python_version = probe
        .get("python_version")
        .and_then(Value::as_str)
        .ok_or(PythonPluginBridgeFailure::MalformedResponse)?;
    let platform = probe
        .get("platform")
        .and_then(Value::as_str)
        .ok_or(PythonPluginBridgeFailure::MalformedResponse)?;
    let machine = probe
        .get("machine")
        .and_then(Value::as_str)
        .ok_or(PythonPluginBridgeFailure::MalformedResponse)?;
    let nirs4all_version = probe
        .get("nirs4all_version")
        .filter(|value| value.is_string() || value.is_null())
        .cloned()
        .ok_or(PythonPluginBridgeFailure::MalformedResponse)?;
    Ok(json!({
        "webapp_version": webapp_version,
        "nirs4all_version": nirs4all_version,
        "python_version": python_version,
        "platform": platform,
        "machine": machine,
    })
    .to_string())
}

/// Return runtime and installed-package diagnostics through the native HTTP
/// route. Rust owns response assembly, metadata loading, and optional runtime
/// size calculation; the Python host only reports its interpreter facts and
/// installed distributions.
fn python_updates_runtime_status_response(state: &SidecarState) -> HttpResponse {
    let Some(python_plugin_host) = state.python_plugin_host.as_deref() else {
        return error_response(
            503,
            ErrorCode::PythonPluginUnavailable,
            "No Python plugin host is configured for this native sidecar",
            BTreeMap::from([("reason".into(), "not_configured".into())]),
        );
    };
    match read_python_updates_runtime_status(python_plugin_host)
        .and_then(|probe| native_updates_runtime_status_json(&probe))
    {
        Ok(body) => HttpResponse::json(200, body),
        Err(reason) => error_response(
            503,
            ErrorCode::PythonPluginPreflightFailed,
            "The configured Python plugin host could not report runtime status",
            BTreeMap::from([("reason".into(), reason.as_str().into())]),
        ),
    }
}

fn native_updates_runtime_status_json(probe: &Value) -> Result<String, PythonPluginBridgeFailure> {
    let runtime_path = probe
        .get("path")
        .and_then(Value::as_str)
        .filter(|path| !path.is_empty())
        .ok_or(PythonPluginBridgeFailure::MalformedResponse)?;
    let base_prefix = probe
        .get("base_prefix")
        .and_then(Value::as_str)
        .filter(|path| !path.is_empty())
        .ok_or(PythonPluginBridgeFailure::MalformedResponse)?;
    let python_executable = probe
        .get("python_executable")
        .and_then(Value::as_str)
        .filter(|path| !path.is_empty())
        .ok_or(PythonPluginBridgeFailure::MalformedResponse)?;
    let python_version = probe
        .get("python_version")
        .and_then(Value::as_str)
        .ok_or(PythonPluginBridgeFailure::MalformedResponse)?;
    let pip_version = nullable_string(probe.get("pip_version"))?;
    let nirs4all_version = nullable_string(probe.get("nirs4all_version"))?;
    let packages = probe
        .get("packages")
        .and_then(Value::as_array)
        .filter(|packages| packages.len() <= MAX_PYTHON_PLUGIN_RUNTIME_PACKAGES)
        .ok_or(PythonPluginBridgeFailure::MalformedResponse)?;
    let packages = packages
        .iter()
        .map(native_runtime_package_json)
        .collect::<Result<Vec<_>, _>>()?;

    let path = Path::new(runtime_path);
    let exists = path.is_dir();
    let is_valid = exists && Path::new(python_executable).is_file();
    let metadata = native_runtime_metadata(path);
    let should_measure_size = path.join("pyvenv.cfg").exists()
        || path != Path::new(base_prefix)
        || matches!(
            env::var(RUNTIME_MODE_ENV)
                .ok()
                .as_deref()
                .map(str::to_ascii_lowercase)
                .as_deref(),
            Some("bundled" | "portable" | "standalone")
        );
    let size_bytes = if is_valid && should_measure_size {
        runtime_directory_size(path)
    } else {
        0
    };
    let runtime = json!({
        "path": runtime_path,
        "exists": exists,
        "is_valid": is_valid,
        "python_executable": python_executable,
        "python_version": if is_valid { Value::String(python_version.into()) } else { Value::Null },
        "pip_version": if is_valid { pip_version } else { Value::Null },
        "created_at": metadata.get("created_at").cloned().unwrap_or(Value::Null),
        "last_updated": metadata.get("last_updated").cloned().unwrap_or(Value::Null),
        "size_bytes": size_bytes,
    });
    Ok(json!({
        "runtime": runtime,
        "venv": runtime,
        "packages": packages,
        "nirs4all_version": nirs4all_version,
    })
    .to_string())
}

fn nullable_string(value: Option<&Value>) -> Result<Value, PythonPluginBridgeFailure> {
    match value {
        Some(Value::String(value)) => Ok(Value::String(value.clone())),
        Some(Value::Null) => Ok(Value::Null),
        _ => Err(PythonPluginBridgeFailure::MalformedResponse),
    }
}

fn native_runtime_package_json(package: &Value) -> Result<Value, PythonPluginBridgeFailure> {
    let package = package
        .as_object()
        .ok_or(PythonPluginBridgeFailure::MalformedResponse)?;
    let name = package
        .get("name")
        .and_then(Value::as_str)
        .filter(|name| !name.is_empty())
        .ok_or(PythonPluginBridgeFailure::MalformedResponse)?;
    let version = package
        .get("version")
        .and_then(Value::as_str)
        .filter(|version| !version.is_empty())
        .ok_or(PythonPluginBridgeFailure::MalformedResponse)?;
    Ok(json!({"name": name, "version": version, "location": null}))
}

fn native_runtime_metadata(runtime_path: &Path) -> Value {
    let metadata_path = runtime_path.join(VENV_METADATA_FILE);
    let Ok(metadata) = fs::metadata(&metadata_path) else {
        return json!({});
    };
    if metadata.len() > MAX_VENV_METADATA_BYTES {
        return json!({});
    }
    fs::read(&metadata_path)
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .filter(Value::is_object)
        .unwrap_or_else(|| json!({}))
}

fn runtime_directory_size(runtime_path: &Path) -> u64 {
    let mut total = 0_u64;
    let mut pending = vec![runtime_path.to_path_buf()];
    while let Some(directory) = pending.pop() {
        let Ok(entries) = fs::read_dir(directory) else {
            continue;
        };
        for entry in entries.flatten() {
            let Ok(file_type) = entry.file_type() else {
                continue;
            };
            if file_type.is_dir() {
                pending.push(entry.path());
            } else if file_type.is_file() {
                if let Ok(metadata) = entry.metadata() {
                    total = total.saturating_add(metadata.len());
                }
            }
        }
    }
    total
}

/// Return build metadata from the Rust-owned launch configuration and a
/// bounded Python-library probe for optional GPU runtime facts.  The sidecar
/// owns the HTTP route and response assembly; the configured interpreter is
/// only a library host for `torch` inspection and never serves HTTP or starts
/// scientific execution.
fn python_system_build_response(state: &SidecarState) -> HttpResponse {
    let Some(python_plugin_host) = state.python_plugin_host.as_deref() else {
        return error_response(
            503,
            ErrorCode::PythonPluginUnavailable,
            "No Python plugin host is configured for this native sidecar",
            BTreeMap::from([("reason".into(), "not_configured".into())]),
        );
    };
    match read_python_system_build(python_plugin_host) {
        Ok(probe) => HttpResponse::json(200, native_system_build_json(state, &probe)),
        Err(reason) => error_response(
            503,
            ErrorCode::PythonPluginPreflightFailed,
            "The configured Python plugin host could not report build GPU availability",
            BTreeMap::from([("reason".into(), reason.as_str().into())]),
        ),
    }
}

fn native_system_build_json(state: &SidecarState, probe: &Value) -> String {
    let gpu = probe
        .get("gpu")
        .cloned()
        .expect("read_python_system_build validates gpu");
    let is_frozen = probe
        .get("is_frozen")
        .and_then(Value::as_bool)
        .expect("read_python_system_build validates is_frozen");
    let cuda_available = gpu["cuda_available"]
        .as_bool()
        .expect("read_python_system_build validates cuda_available");
    let metal_available = gpu["metal_available"]
        .as_bool()
        .expect("read_python_system_build validates metal_available");
    let gpu_type = if metal_available {
        Value::String("metal".into())
    } else if cuda_available {
        Value::String("cuda".into())
    } else {
        Value::Null
    };
    let gpu_device = gpu.get("device_name").cloned().unwrap_or(Value::Null);
    let build = native_build_info(state);
    let flavor = build
        .get("flavor")
        .cloned()
        .expect("native_build_info always provides flavor");
    let gpu_build = build
        .get("gpu_enabled")
        .cloned()
        .expect("native_build_info always provides gpu_enabled");

    json!({
        "build": build,
        "gpu": gpu,
        "runtime_mode": state.runtime_mode.clone(),
        "is_frozen": is_frozen,
        "summary": {
            "flavor": flavor,
            "gpu_build": gpu_build,
            "gpu_available": cuda_available || metal_available,
            "gpu_type": gpu_type,
            "gpu_device": gpu_device,
            "runtime_mode": state.runtime_mode.clone(),
        },
    })
    .to_string()
}

fn native_build_info(state: &SidecarState) -> Value {
    let mut default = serde_json::Map::new();
    default.insert("flavor".into(), Value::String("development".into()));
    default.insert("gpu_enabled".into(), Value::Bool(false));
    let Some(path) = state.build_info_path.as_deref() else {
        return Value::Object(default);
    };
    let Ok(raw) = std::fs::read_to_string(path) else {
        return Value::Object(default);
    };
    let Ok(Value::Object(mut build)) = serde_json::from_str::<Value>(&raw) else {
        return Value::Object(default);
    };

    let flavor = build
        .get("flavor")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("development");
    let gpu_enabled = build
        .get("gpu_enabled")
        .and_then(Value::as_bool)
        .unwrap_or(matches!(flavor, "gpu" | "gpu-metal"));
    default.insert("flavor".into(), Value::String(flavor.into()));
    default.insert("gpu_enabled".into(), Value::Bool(gpu_enabled));
    build.extend(default);
    Value::Object(build)
}

/// Return Studio's runtime alignment contract from the explicit Python plugin
/// host. The native sidecar owns this HTTP response; Python only reports its
/// own interpreter facts and verifies that the library host can import
/// `nirs4all`.
fn python_env_coherence_response(state: &SidecarState) -> HttpResponse {
    let Some(python_plugin_host) = state.python_plugin_host.as_deref() else {
        return error_response(
            503,
            ErrorCode::PythonPluginUnavailable,
            "No Python plugin host is configured for this native sidecar",
            BTreeMap::from([("reason".into(), "not_configured".into())]),
        );
    };
    match read_python_env_coherence(python_plugin_host, state) {
        Ok(body) => HttpResponse::json(200, body),
        Err(reason) => error_response(
            503,
            ErrorCode::PythonPluginPreflightFailed,
            "The configured Python plugin host could not report runtime coherence",
            BTreeMap::from([("reason".into(), reason.as_str().into())]),
        ),
    }
}

fn python_plugin_preflight_response(state: &SidecarState) -> HttpResponse {
    let Some(python_plugin_host) = state.python_plugin_host.as_deref() else {
        return error_response(
            503,
            ErrorCode::PythonPluginUnavailable,
            "No Python plugin host is configured for this native sidecar",
            BTreeMap::from([("reason".into(), "not_configured".into())]),
        );
    };

    match preflight_python_plugin_host(python_plugin_host) {
        Ok(()) => HttpResponse::json(
            200,
            "{\"bridge\":\"python-subprocess\",\"python_plugin_host\":\"ready\",\"nirs4all_import\":true,\"scientific_execution\":\"unavailable\"}",
        ),
        Err(reason) => error_response(
            503,
            ErrorCode::PythonPluginPreflightFailed,
            "The configured Python plugin host did not pass the nirs4all import preflight",
            BTreeMap::from([("reason".into(), reason.as_str().into())]),
        ),
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum PythonPluginPreflightFailure {
    SpawnFailed,
    TimedOut,
    ImportFailed,
}

impl PythonPluginPreflightFailure {
    const fn as_str(self) -> &'static str {
        match self {
            Self::SpawnFailed => "spawn_failed",
            Self::TimedOut => "timed_out",
            Self::ImportFailed => "nirs4all_import_failed",
        }
    }
}

fn preflight_python_plugin_host(
    python_plugin_host: &Path,
) -> Result<(), PythonPluginPreflightFailure> {
    let mut child = Command::new(python_plugin_host)
        .args(["-I", "-B", "-c", "import nirs4all"])
        .env("PYTHONDONTWRITEBYTECODE", "1")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|_| PythonPluginPreflightFailure::SpawnFailed)?;
    let started_at = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(status)) if status.success() => return Ok(()),
            Ok(Some(_)) | Err(_) => return Err(PythonPluginPreflightFailure::ImportFailed),
            Ok(None) if started_at.elapsed() >= PYTHON_PLUGIN_PREFLIGHT_TIMEOUT => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(PythonPluginPreflightFailure::TimedOut);
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(10)),
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum PythonPluginBridgeFailure {
    SpawnFailed,
    TimedOut,
    ScriptFailed,
    OutputTooLarge,
    OutputReadFailed,
    MalformedResponse,
}

impl PythonPluginBridgeFailure {
    const fn as_str(self) -> &'static str {
        match self {
            Self::SpawnFailed => "spawn_failed",
            Self::TimedOut => "timed_out",
            Self::ScriptFailed => "script_failed",
            Self::OutputTooLarge => "output_too_large",
            Self::OutputReadFailed => "output_read_failed",
            Self::MalformedResponse => "malformed_response",
        }
    }
}

fn read_python_capabilities(
    python_plugin_host: &Path,
) -> Result<String, PythonPluginBridgeFailure> {
    let module_names = serde_json::to_string(PYTHON_CAPABILITY_MODULES)
        .map_err(|_| PythonPluginBridgeFailure::ScriptFailed)?;
    let script = format!(
        "import importlib,json; names={module_names}; capabilities={{}}\nfor name in names:\n try: importlib.import_module(name); capabilities[name]=True\n except Exception: capabilities[name]=False\nprint(json.dumps({{'capabilities':capabilities}}, separators=(',',':'), sort_keys=True))"
    );
    let output = run_python_plugin_json(
        python_plugin_host,
        &script,
        PYTHON_PLUGIN_CAPABILITIES_TIMEOUT,
    )?;
    let capabilities = output
        .get("capabilities")
        .and_then(Value::as_object)
        .ok_or(PythonPluginBridgeFailure::MalformedResponse)?;
    if capabilities.len() != PYTHON_CAPABILITY_MODULES.len()
        || PYTHON_CAPABILITY_MODULES
            .iter()
            .any(|name| !capabilities.get(*name).is_some_and(Value::is_boolean))
    {
        return Err(PythonPluginBridgeFailure::MalformedResponse);
    }
    Ok(serde_json::json!({ "capabilities": capabilities }).to_string())
}

fn read_python_system_info(python_plugin_host: &Path) -> Result<String, PythonPluginBridgeFailure> {
    let package_names = serde_json::to_string(PYTHON_INFO_PACKAGES)
        .map_err(|_| PythonPluginBridgeFailure::ScriptFailed)?;
    let script = format!(
        "import json,platform,sys\npackages={{}}\nfor name in {package_names}:\n try:\n  module=__import__(name); packages[name]=str(getattr(module,'__version__','unknown'))\n except ImportError: pass\ntry:\n import nirs4all; nirs4all_version=str(getattr(nirs4all,'__version__','unknown'))\nexcept ImportError: nirs4all_version='not installed'\nprint(json.dumps({{'python':{{'version':sys.version,'platform':sys.platform,'executable':sys.executable}},'system':{{'os':platform.system(),'release':platform.release(),'machine':platform.machine(),'processor':platform.processor()}},'nirs4all_version':nirs4all_version,'packages':packages}}, separators=(',',':'), sort_keys=True))"
    );
    let output = run_python_plugin_json(
        python_plugin_host,
        &script,
        PYTHON_PLUGIN_CAPABILITIES_TIMEOUT,
    )?;
    let python = output
        .get("python")
        .and_then(Value::as_object)
        .ok_or(PythonPluginBridgeFailure::MalformedResponse)?;
    let system = output
        .get("system")
        .and_then(Value::as_object)
        .ok_or(PythonPluginBridgeFailure::MalformedResponse)?;
    let packages = output
        .get("packages")
        .and_then(Value::as_object)
        .ok_or(PythonPluginBridgeFailure::MalformedResponse)?;
    if ["version", "platform", "executable"]
        .iter()
        .any(|key| !python.get(*key).is_some_and(Value::is_string))
        || ["os", "release", "machine", "processor"]
            .iter()
            .any(|key| !system.get(*key).is_some_and(Value::is_string))
        || !output.get("nirs4all_version").is_some_and(Value::is_string)
        || !packages.values().all(Value::is_string)
    {
        return Err(PythonPluginBridgeFailure::MalformedResponse);
    }
    Ok(output.to_string())
}

fn read_python_updates_version(
    python_plugin_host: &Path,
) -> Result<Value, PythonPluginBridgeFailure> {
    let script = "import json,os,platform,sys\ncwd=os.getcwd(); sys.path=[entry for entry in sys.path if entry not in ('',cwd)]\nversion=None\ntry:\n import nirs4all; version=getattr(nirs4all,'__version__',None)\nexcept Exception: pass\nif not version:\n try:\n  from importlib import metadata; version=metadata.version('nirs4all')\n except Exception: pass\nprint(json.dumps({'nirs4all_version':version,'python_version':sys.version,'platform':platform.system(),'machine':platform.machine()}, separators=(',',':'), sort_keys=True))";
    let output = run_python_plugin_json(
        python_plugin_host,
        script,
        PYTHON_PLUGIN_CAPABILITIES_TIMEOUT,
    )?;
    if !["python_version", "platform", "machine"]
        .iter()
        .all(|key| output.get(*key).is_some_and(Value::is_string))
        || !matches!(
            output.get("nirs4all_version"),
            Some(Value::String(_) | Value::Null)
        )
    {
        return Err(PythonPluginBridgeFailure::MalformedResponse);
    }
    Ok(output)
}

fn read_python_updates_runtime_status(
    python_plugin_host: &Path,
) -> Result<Value, PythonPluginBridgeFailure> {
    let script = "import importlib.metadata as metadata,json,sys\npackages=[]\nfor distribution in metadata.distributions():\n try:\n  name=distribution.metadata.get('Name') or distribution.name; version=distribution.version\n  if name and version: packages.append({'name':str(name),'version':str(version)})\n except Exception: pass\npackages.sort(key=lambda package:package['name'].lower())\ndef version_of(name):\n try: return metadata.version(name)\n except Exception: return None\nprint(json.dumps({'path':sys.prefix,'base_prefix':getattr(sys,'base_prefix',sys.prefix),'python_executable':sys.executable,'python_version':'.'.join(map(str,sys.version_info[:3])),'pip_version':version_of('pip'),'nirs4all_version':version_of('nirs4all'),'packages':packages}, separators=(',',':'), sort_keys=True))";
    let output = run_python_plugin_json_with_limit(
        python_plugin_host,
        script,
        PYTHON_PLUGIN_CAPABILITIES_TIMEOUT,
        MAX_PYTHON_PLUGIN_RUNTIME_STATUS_OUTPUT_BYTES,
    )?;
    if !["path", "base_prefix", "python_executable", "python_version"]
        .iter()
        .all(|key| output.get(*key).is_some_and(Value::is_string))
        || !["pip_version", "nirs4all_version"]
            .iter()
            .all(|key| matches!(output.get(*key), Some(Value::String(_) | Value::Null)))
        || !output.get("packages").is_some_and(Value::is_array)
    {
        return Err(PythonPluginBridgeFailure::MalformedResponse);
    }
    Ok(output)
}

fn read_python_system_build(python_plugin_host: &Path) -> Result<Value, PythonPluginBridgeFailure> {
    const GPU_BOOLEAN_FIELDS: &[&str] = &[
        "cuda_available",
        "mps_available",
        "metal_available",
        "torch_cuda_available",
    ];
    const GPU_NULLABLE_STRING_FIELDS: &[&str] = &[
        "device_name",
        "cuda_version",
        "driver_version",
        "torch_version",
    ];
    let script = "import json,sys\ngpu={'cuda_available':False,'mps_available':False,'metal_available':False,'device_name':None,'device_count':0,'cuda_version':None,'driver_version':None,'torch_cuda_available':False,'torch_version':None,'detection_source':'python_plugin_no_torch','backends':{}}\ntry:\n import torch\n gpu['detection_source']='python_plugin_torch'\n gpu['torch_version']=str(getattr(torch,'__version__','unknown'))\n gpu['cuda_version']=getattr(getattr(torch,'version',None),'cuda',None)\n cuda=bool(torch.cuda.is_available())\n mps=bool(getattr(getattr(torch,'backends',None),'mps',None) and torch.backends.mps.is_available())\n gpu['cuda_available']=cuda\n gpu['torch_cuda_available']=cuda\n gpu['mps_available']=mps\n gpu['metal_available']=mps\n if cuda:\n  count=int(torch.cuda.device_count()); gpu['device_count']=count\n  device=str(torch.cuda.get_device_name(0)) if count else None\n  gpu['device_name']=device\n  gpu['backends']['pytorch_cuda']={'available':True,'device_name':device,'cuda_version':gpu['cuda_version']}\n if mps: gpu['backends']['pytorch_mps']={'available':True}\nexcept Exception: pass\nprint(json.dumps({'gpu':gpu,'is_frozen':bool(hasattr(sys,'_MEIPASS'))}, separators=(',',':'), sort_keys=True))";
    let output = run_python_plugin_json(
        python_plugin_host,
        script,
        PYTHON_PLUGIN_CAPABILITIES_TIMEOUT,
    )?;
    let gpu = output
        .get("gpu")
        .and_then(Value::as_object)
        .ok_or(PythonPluginBridgeFailure::MalformedResponse)?;
    if GPU_BOOLEAN_FIELDS
        .iter()
        .any(|key| !gpu.get(*key).is_some_and(Value::is_boolean))
        || GPU_NULLABLE_STRING_FIELDS.iter().any(|key| {
            !gpu.get(*key)
                .is_some_and(|value| value.is_null() || value.is_string())
        })
        || !gpu.get("device_count").is_some_and(Value::is_u64)
        || !gpu.get("detection_source").is_some_and(Value::is_string)
        || !gpu.get("backends").is_some_and(Value::is_object)
        || !output.get("is_frozen").is_some_and(Value::is_boolean)
    {
        return Err(PythonPluginBridgeFailure::MalformedResponse);
    }
    Ok(output)
}

fn read_python_env_coherence(
    python_plugin_host: &Path,
    state: &SidecarState,
) -> Result<String, PythonPluginBridgeFailure> {
    let script = "import json,sys\ntry:\n import nirs4all; nirs4all_import=True\nexcept Exception:\n nirs4all_import=False\nprint(json.dumps({'python':sys.executable,'prefix':sys.prefix,'version':f'{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}','nirs4all_import':nirs4all_import}, separators=(',',':'), sort_keys=True))";
    let output =
        run_python_plugin_json(python_plugin_host, script, PYTHON_PLUGIN_PREFLIGHT_TIMEOUT)?;
    let runtime_python = output
        .get("python")
        .and_then(Value::as_str)
        .ok_or(PythonPluginBridgeFailure::MalformedResponse)?;
    let runtime_prefix = output
        .get("prefix")
        .and_then(Value::as_str)
        .ok_or(PythonPluginBridgeFailure::MalformedResponse)?;
    let runtime_version = output
        .get("version")
        .and_then(Value::as_str)
        .ok_or(PythonPluginBridgeFailure::MalformedResponse)?;
    let nirs4all_import = output
        .get("nirs4all_import")
        .and_then(Value::as_bool)
        .ok_or(PythonPluginBridgeFailure::MalformedResponse)?;
    let configured_python = python_plugin_host.to_string_lossy();
    let configured_matches_running = Path::new(runtime_python) == python_plugin_host;
    let missing_core_packages = if nirs4all_import {
        Vec::new()
    } else {
        vec!["nirs4all"]
    };

    Ok(serde_json::json!({
        "coherent": configured_matches_running,
        "configured_python": configured_python,
        "running_python": runtime_python,
        "running_prefix": runtime_prefix,
        "runtime_kind": state.runtime_kind,
        "is_bundled_default": state.python_plugin_host_bundled,
        "bundled_runtime_available": state.python_plugin_host_bundled,
        "configured_matches_running": configured_matches_running,
        "core_ready": nirs4all_import,
        "missing_core_packages": missing_core_packages,
        "missing_optional_packages": [],
        "python_match": configured_matches_running,
        "prefix_match": true,
        "runtime": {
            "python": runtime_python,
            "prefix": runtime_prefix,
            "version": runtime_version,
        },
        "venv_manager": {
            "python": runtime_python,
            "prefix": runtime_prefix,
        },
        "electron_expected_python": configured_python,
        "electron_match": configured_matches_running,
    })
    .to_string())
}

fn run_python_plugin_json(
    python_plugin_host: &Path,
    script: &str,
    timeout: Duration,
) -> Result<Value, PythonPluginBridgeFailure> {
    run_python_plugin_json_with_limit(
        python_plugin_host,
        script,
        timeout,
        MAX_PYTHON_PLUGIN_OUTPUT_BYTES,
    )
}

fn run_python_plugin_json_with_limit(
    python_plugin_host: &Path,
    script: &str,
    timeout: Duration,
    output_limit: usize,
) -> Result<Value, PythonPluginBridgeFailure> {
    let mut child = Command::new(python_plugin_host)
        .args(["-I", "-B", "-c", script])
        .env("PYTHONDONTWRITEBYTECODE", "1")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|_| PythonPluginBridgeFailure::SpawnFailed)?;
    let stdout = child
        .stdout
        .take()
        .ok_or(PythonPluginBridgeFailure::OutputReadFailed)?;
    let reader = std::thread::spawn(move || read_bounded_stdout(stdout, output_limit));
    let started_at = Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Err(_) => {
                let _ = child.kill();
                let _ = child.wait();
                let _ = reader.join();
                return Err(PythonPluginBridgeFailure::ScriptFailed);
            }
            Ok(None) if started_at.elapsed() >= timeout => {
                let _ = child.kill();
                let _ = child.wait();
                let _ = reader.join();
                return Err(PythonPluginBridgeFailure::TimedOut);
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(10)),
        }
    };
    let (stdout, exceeded) = reader
        .join()
        .map_err(|_| PythonPluginBridgeFailure::OutputReadFailed)?
        .map_err(|_| PythonPluginBridgeFailure::OutputReadFailed)?;
    if !status.success() {
        return Err(PythonPluginBridgeFailure::ScriptFailed);
    }
    if exceeded {
        return Err(PythonPluginBridgeFailure::OutputTooLarge);
    }
    serde_json::from_slice(&stdout).map_err(|_| PythonPluginBridgeFailure::MalformedResponse)
}

fn read_bounded_stdout(
    mut stdout: std::process::ChildStdout,
    output_limit: usize,
) -> std::io::Result<(Vec<u8>, bool)> {
    let mut retained = Vec::with_capacity(output_limit);
    let mut buffer = [0_u8; 1024];
    let mut exceeded = false;
    loop {
        let read = stdout.read(&mut buffer)?;
        if read == 0 {
            return Ok((retained, exceeded));
        }
        let remaining = output_limit.saturating_sub(retained.len());
        let copied = remaining.min(read);
        retained.extend_from_slice(&buffer[..copied]);
        exceeded |= copied < read;
    }
}

fn route_http_request(state: &mut SidecarState, request: &HttpRequest) -> HttpResponse {
    if request.query.is_some()
        && (is_native_job_http_path(&request.path)
            || match_durable_execution_job_record_route(&request.path).is_some()
            || request.path == SCIENTIFIC_SUBMISSION_ROUTE
            || request.path == ARCHIVE_V2_PREDICTION_ROUTE
            || request.path == LEGACY_TRANSITION_STATUS_ROUTE
            || request.path == LEGACY_CONVERSION_ROUTE)
    {
        return error_response(
            404,
            ErrorCode::RouteNotFound,
            "Native job routes accept only a bare request path",
            BTreeMap::from([("path".into(), request.path.clone())]),
        );
    }
    if workspace_runs_path(&request.path)
        && !workspace_run_discovery_query_supported(request.query.as_deref())
    {
        return error_response(
            404,
            ErrorCode::RouteNotFound,
            "This native WorkspaceStore run discovery query is outside the explicit allowlist",
            BTreeMap::from([("path".into(), request.path.clone())]),
        );
    }
    if request.query.is_some()
        && (workspace_run_detail_preselection_path(&request.path)
            || workspace_run_detail_path(&request.path)
            || workspace_results_path(&request.path)
            || workspace_results_summary_path(&request.path))
    {
        return error_response(
            404,
            ErrorCode::RouteNotFound,
            "This native WorkspaceStore projection accepts only a bare request path",
            BTreeMap::from([("path".into(), request.path.clone())]),
        );
    }
    if request.path == "/sidecar/v1/ws" && request.method == "GET" {
        if !request.is_websocket_upgrade() {
            return route_request(state, &request.method, &request.path);
        }
        return error_response(
            426,
            ErrorCode::WebSocketUpgradeRequired,
            "WebSocket upgrades are not available in R1",
            BTreeMap::from([
                ("path".into(), request.path.clone()),
                ("websocket_upgrade".into(), "unavailable".into()),
            ]),
        );
    }
    route_request_with_body(state, &request.method, &request.path, &request.body)
}

fn create_job_response(state: &mut SidecarState) -> HttpResponse {
    match state.create_control_job() {
        Ok(job) => HttpResponse::json(202, job_json(&job)),
        Err(()) => error_response(
            429,
            ErrorCode::JobCapacityExceeded,
            "Control job storage is full; retry after jobs expire or are cancelled",
            BTreeMap::from([("job_limit".into(), state.job_limit.to_string())]),
        ),
    }
}

fn route_job(state: &mut SidecarState, method: &str, path: &str) -> HttpResponse {
    let suffix = path.trim_start_matches("/sidecar/v1/jobs/");
    let (job_id, cancel) = match suffix.strip_suffix("/cancel") {
        Some(job_id) if !job_id.is_empty() => (job_id, true),
        _ if !suffix.is_empty() && !suffix.contains('/') => (suffix, false),
        _ => {
            return error_response(
                404,
                ErrorCode::RouteNotFound,
                "No R1 sidecar route matches this path",
                BTreeMap::from([
                    ("method".into(), method.into()),
                    ("path".into(), path.into()),
                ]),
            );
        }
    };
    match (method, cancel) {
        ("GET", false) => state.job(job_id).map_or_else(
            || job_not_found(job_id),
            |job| HttpResponse::json(200, job_json(&job)),
        ),
        ("POST", true) => state.cancel_job(job_id).map_or_else(
            || job_not_found(job_id),
            |job| HttpResponse::json(200, job_json(&job)),
        ),
        (_, false) => method_not_allowed(method, path, "GET"),
        (_, true) => method_not_allowed(method, path, "POST"),
    }
}

fn scientific_submission_response(state: &SidecarState, body: &[u8]) -> HttpResponse {
    // Product default must refuse before even parsing the body or reading the
    // linked-workspace catalogue. This prevents hidden scientific or storage
    // work when no executor was explicitly selected.
    if !state.native_jobs.execution_selected() {
        let reason = state
            .native_jobs
            .execution_unavailability_reason()
            .unwrap_or("executor_not_selected");
        if reason != "executor_not_selected" {
            return error_response(
                503,
                ErrorCode::ScientificExecutorUnavailable,
                "The bounded scientific executor is unavailable",
                BTreeMap::from([("reason".into(), reason.into())]),
            );
        }
        return HttpResponse::json(
            503,
            json!({
                "detail": "Scientific job executor is not selected; submission was not accepted"
            })
            .to_string(),
        );
    }
    let submission = match validate_scientific_submission(body) {
        Ok(submission) => submission,
        Err(error) => return scientific_submission_validation_error(&error),
    };
    let active = match state.app_settings.active_linked_workspace_response() {
        Ok(Some(active)) => active,
        Ok(None) => {
            return HttpResponse::json(409, json!({"detail": "No workspace selected"}).to_string())
        }
        Err(_) => {
            return HttpResponse::json(
                409,
                json!({"detail": "Active linked workspace is unavailable"}).to_string(),
            );
        }
    };
    let Some(workspace_id) = active.get("id").and_then(Value::as_str) else {
        return HttpResponse::json(
            409,
            json!({"detail": "Active linked workspace identity is invalid"}).to_string(),
        );
    };
    let Some(workspace_path) = active.get("path").and_then(Value::as_str) else {
        return HttpResponse::json(
            409,
            json!({"detail": "Active linked workspace path is invalid"}).to_string(),
        );
    };
    let timestamp = websocket_transport::rfc3339_now();
    scientific_submission_runtime_response(state.native_jobs.submit_scientific_at(
        &submission,
        workspace_id,
        Path::new(workspace_path),
        &timestamp,
        Instant::now(),
    ))
}

fn scientific_submission_runtime_response(
    result: Result<job_http::ScientificSubmissionReceipt, job_http::NativeJobRuntimeError>,
) -> HttpResponse {
    match result {
        Ok(receipt) => HttpResponse::json(
            202,
            json!({
                "id": receipt.job_id,
                "job_id": receipt.job_id,
                "name": receipt.run_name,
                "status": "running",
                "type": "training",
                "created_at": receipt.created_at,
                "requested_backend": receipt.requested_backend,
                "execution_backend": receipt.execution_backend,
                "submission_transport": "studio-sidecar-rust",
                "workspace_id": receipt.workspace_id,
            })
            .to_string(),
        ),
        Err(job_http::NativeJobRuntimeError::Executor(job_http::JobExecutorError::Unselected)) => {
            HttpResponse::json(
                503,
                json!({
                    "detail": "Scientific job executor is not selected; submission was not accepted"
                })
                .to_string(),
            )
        }
        Err(job_http::NativeJobRuntimeError::Executor(
            job_http::JobExecutorError::InvalidCapability
            | job_http::JobExecutorError::PreflightRefused,
        )) => HttpResponse::json(
            503,
            json!({"detail": "Scientific job executor preflight failed"}).to_string(),
        ),
        Err(job_http::NativeJobRuntimeError::Executor(
            job_http::JobExecutorError::SubmissionRefused,
        )) => HttpResponse::json(
            503,
            json!({"detail": "Scientific job executor refused submission"}).to_string(),
        ),
        Err(job_http::NativeJobRuntimeError::Executor(
            job_http::JobExecutorError::CancellationRefused,
        )) => HttpResponse::json(
            500,
            json!({"detail": "Scientific executor returned an invalid submission error"})
                .to_string(),
        ),
        Err(job_http::NativeJobRuntimeError::Persistence(_)) => HttpResponse::json(
            409,
            json!({"detail": "Native execution job record cannot be persisted safely"}).to_string(),
        ),
        Err(
            job_http::NativeJobRuntimeError::Lifecycle(_)
            | job_http::NativeJobRuntimeError::WebSocket(_),
        ) => HttpResponse::json(
            500,
            json!({"detail": "Native scientific job registration failed"}).to_string(),
        ),
    }
}

fn scientific_submission_validation_error(
    error: &ScientificSubmissionValidationError,
) -> HttpResponse {
    match error {
        ScientificSubmissionValidationError::BodyTooLarge => HttpResponse::json(
            413,
            json!({"detail": "Scientific submission body exceeds 65536 bytes"}).to_string(),
        ),
        ScientificSubmissionValidationError::InvalidJson => HttpResponse::json(
            400,
            json!({"detail": "Scientific submission body must be valid JSON"}).to_string(),
        ),
        ScientificSubmissionValidationError::InvalidShape(detail)
        | ScientificSubmissionValidationError::Unsupported(detail) => {
            HttpResponse::json(422, json!({"detail": detail}).to_string())
        }
    }
}

fn job_not_found(job_id: &str) -> HttpResponse {
    error_response(
        404,
        ErrorCode::JobNotFound,
        "No R1 control job has this opaque identifier",
        BTreeMap::from([("job_id".into(), job_id.into())]),
    )
}

fn job_json(job: &ControlJob) -> String {
    format!(
        "{{\"job_id\":\"{}\",\"status\":\"{}\",\"job_kind\":\"control\",\"execution\":\"unavailable\",\"cancellation_idempotent\":true}}",
        escape_json(&job.id),
        job.status.as_str(),
    )
}

fn method_not_allowed(method: &str, path: &str, allowed: &str) -> HttpResponse {
    error_response(
        405,
        ErrorCode::MethodNotAllowed,
        "Method is not allowed for this R1 sidecar route",
        BTreeMap::from([
            ("method".into(), method.into()),
            ("path".into(), path.into()),
            ("allowed_methods".into(), allowed.into()),
        ]),
    )
    .with_header("Allow", allowed)
}

fn error_response(
    status: u16,
    code: ErrorCode,
    message: &str,
    details: BTreeMap<String, String>,
) -> HttpResponse {
    HttpResponse::json(
        status,
        ErrorEnvelope {
            code,
            message: message.into(),
            details,
        }
        .json(),
    )
}

#[derive(Clone, Copy, Debug)]
struct ServerLimits {
    header_timeout: Duration,
    read_timeout: Duration,
    write_timeout: Duration,
    max_connections: usize,
}

impl Default for ServerLimits {
    fn default() -> Self {
        Self {
            header_timeout: Duration::from_secs(5),
            read_timeout: Duration::from_secs(2),
            write_timeout: Duration::from_secs(2),
            max_connections: MAX_CONCURRENT_CONNECTIONS,
        }
    }
}

#[derive(Debug)]
struct ConnectionGate {
    active: AtomicUsize,
    limit: usize,
}

impl ConnectionGate {
    fn try_acquire(self: &Arc<Self>) -> Option<ConnectionPermit> {
        let mut current = self.active.load(Ordering::Relaxed);
        loop {
            if current >= self.limit {
                return None;
            }
            match self.active.compare_exchange_weak(
                current,
                current + 1,
                Ordering::AcqRel,
                Ordering::Relaxed,
            ) {
                Ok(_) => return Some(ConnectionPermit(Arc::clone(self))),
                Err(observed) => current = observed,
            }
        }
    }
}

struct ConnectionPermit(Arc<ConnectionGate>);

impl Drop for ConnectionPermit {
    fn drop(&mut self) {
        self.0.active.fetch_sub(1, Ordering::Release);
    }
}

/// Bind and serve the R1 local HTTP control surface until the process exits.
///
/// # Errors
///
/// Returns a socket bind, listener, or stream I/O error to the caller.
pub fn serve(host: &str, port: u16) -> std::io::Result<()> {
    let listener = TcpListener::bind((host, port))?;
    let address = listener.local_addr()?;
    println!(
        "STUDIO_SIDECAR_READY {{\"protocol_version\":\"{PROTOCOL_VERSION}\",\"host\":\"{}\",\"port\":{}}}",
        address.ip(),
        address.port()
    );
    let state = Arc::new(Mutex::new(SidecarState::from_environment()));
    let websocket_manager = state
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .native_jobs
        .websocket_manager();
    let limits = ServerLimits::default();
    let connections = Arc::new(ConnectionGate {
        active: AtomicUsize::new(0),
        limit: limits.max_connections,
    });
    for stream in listener.incoming() {
        match stream {
            Ok(stream) => {
                let Some(permit) = connections.try_acquire() else {
                    reject_overloaded(stream, limits.write_timeout);
                    continue;
                };
                let state = Arc::clone(&state);
                let websocket_manager = Arc::clone(&websocket_manager);
                std::thread::spawn(move || {
                    let _permit = permit;
                    if let Err(error) = handle_connection_with_limits_and_websocket(
                        stream,
                        &state,
                        &websocket_manager,
                        limits,
                    ) {
                        eprintln!("studio-sidecar connection error: {error}");
                    }
                });
            }
            Err(error) => eprintln!("studio-sidecar accept error: {error}"),
        }
    }
    Ok(())
}

#[cfg(test)]
fn handle_connection_with_limits(
    stream: TcpStream,
    state: &Arc<Mutex<SidecarState>>,
    limits: ServerLimits,
) -> std::io::Result<()> {
    handle_connection_with_limits_and_websocket(
        stream,
        state,
        &WebSocketConnectionManager::new(),
        limits,
    )
}

fn handle_connection_with_limits_and_websocket(
    mut stream: TcpStream,
    state: &Arc<Mutex<SidecarState>>,
    websocket_manager: &WebSocketConnectionManager,
    limits: ServerLimits,
) -> std::io::Result<()> {
    stream.set_read_timeout(Some(limits.read_timeout))?;
    stream.set_write_timeout(Some(limits.write_timeout))?;
    let response = match read_http_request(&mut stream, limits.header_timeout) {
        Ok(request) => {
            if request.method == "GET" {
                if let Some(endpoint) =
                    LegacyWebSocketEndpoint::parse(&request.path, request.query.as_deref())
                {
                    if request.is_websocket_upgrade() {
                        let websocket_key = request
                            .headers
                            .get("sec-websocket-key")
                            .expect("validated WebSocket request must retain its key");
                        return handle_websocket_connection(
                            stream,
                            websocket_key,
                            &endpoint,
                            websocket_manager,
                        );
                    }
                }
            }
            if request.method == "POST"
                && request.path == LEGACY_CONVERSION_ROUTE
                && request.query.is_none()
            {
                // A migration may legitimately take minutes. Snapshot the two
                // cloneable, internally synchronized owners and release the
                // global route-table mutex before starting the bounded process
                // so health, progress, and refusal routes remain responsive.
                let (app_settings, legacy_conversion) = {
                    let state = state.lock().expect("sidecar state mutex poisoned");
                    (state.app_settings.clone(), state.legacy_conversion.clone())
                };
                return write_response(
                    &mut stream,
                    &legacy_workspace_conversion_with(
                        &app_settings,
                        &legacy_conversion,
                        &request.body,
                    ),
                );
            }
            let mut state = state.lock().expect("sidecar state mutex poisoned");
            route_http_request(&mut state, &request)
        }
        Err(RequestReadError::Timeout) => error_response(
            408,
            ErrorCode::RequestTimeout,
            "Timed out while reading request headers",
            BTreeMap::new(),
        ),
        Err(RequestReadError::TooLarge) => error_response(
            400,
            ErrorCode::InvalidRequest,
            "Request headers exceed the configured limit",
            BTreeMap::new(),
        ),
        Err(RequestReadError::BodyTooLarge { path }) => request_body_too_large_response(&path),
        Err(RequestReadError::Invalid) => error_response(
            400,
            ErrorCode::InvalidRequest,
            "Request must contain a valid HTTP/1.1 request line and headers",
            BTreeMap::new(),
        ),
        Err(RequestReadError::Io(error)) => return Err(error),
    };
    write_response(&mut stream, &response)
}

fn request_body_too_large_response(path: &str) -> HttpResponse {
    if path == SCIENTIFIC_SUBMISSION_ROUTE {
        scientific_submission_validation_error(&ScientificSubmissionValidationError::BodyTooLarge)
    } else if path == ARCHIVE_V2_PREDICTION_ROUTE {
        archive_v2_prediction_error_response(&ArchiveV2PredictionError::BodyTooLarge)
    } else {
        error_response(
            400,
            ErrorCode::InvalidRequest,
            "Request body exceeds the configured limit",
            BTreeMap::new(),
        )
    }
}

fn reject_overloaded(mut stream: TcpStream, timeout: Duration) {
    let _ = stream.set_write_timeout(Some(timeout));
    let response = error_response(
        503,
        ErrorCode::JobCapacityExceeded,
        "Sidecar connection limit is reached",
        BTreeMap::from([(
            "connection_limit".into(),
            MAX_CONCURRENT_CONNECTIONS.to_string(),
        )]),
    );
    let _ = write_response(&mut stream, &response);
}

#[derive(Debug)]
enum RequestReadError {
    Timeout,
    TooLarge,
    BodyTooLarge { path: String },
    Invalid,
    Io(std::io::Error),
}

#[derive(Debug)]
struct HttpRequest {
    method: String,
    path: String,
    query: Option<String>,
    headers: BTreeMap<String, String>,
    body: Vec<u8>,
}

impl HttpRequest {
    fn is_websocket_upgrade(&self) -> bool {
        self.headers
            .get("upgrade")
            .is_some_and(|value| value.eq_ignore_ascii_case("websocket"))
            && self.headers.get("connection").is_some_and(|value| {
                value
                    .split(',')
                    .any(|token| token.trim().eq_ignore_ascii_case("upgrade"))
            })
            && self
                .headers
                .get("sec-websocket-key")
                .is_some_and(|key| valid_websocket_key(key))
            && self
                .headers
                .get("sec-websocket-version")
                .is_some_and(|value| value == "13")
    }
}

fn valid_websocket_key(value: &str) -> bool {
    !value.is_empty() && STANDARD.decode(value).is_ok_and(|nonce| nonce.len() == 16)
}

fn read_http_request(
    stream: &mut TcpStream,
    header_timeout: Duration,
) -> Result<HttpRequest, RequestReadError> {
    let started = Instant::now();
    let mut bytes = Vec::with_capacity(1024);
    let mut buffer = [0_u8; 1024];
    loop {
        if started.elapsed() >= header_timeout {
            return Err(RequestReadError::Timeout);
        }
        let read = match stream.read(&mut buffer) {
            Ok(read) => read,
            Err(error)
                if matches!(
                    error.kind(),
                    std::io::ErrorKind::TimedOut | std::io::ErrorKind::WouldBlock
                ) =>
            {
                return Err(RequestReadError::Timeout);
            }
            Err(error) => return Err(RequestReadError::Io(error)),
        };
        if read == 0 {
            return Err(RequestReadError::Invalid);
        }
        bytes.extend_from_slice(&buffer[..read]);
        let Some(header_end) = bytes
            .windows(4)
            .position(|window| window == b"\r\n\r\n")
            .map(|position| position + 4)
        else {
            if bytes.len() > MAX_REQUEST_HEADER_BYTES {
                return Err(RequestReadError::TooLarge);
            }
            continue;
        };
        if header_end > MAX_REQUEST_HEADER_BYTES {
            return Err(RequestReadError::TooLarge);
        }
        let mut request = parse_http_request(&bytes[..header_end])?;
        let content_length = request_content_length(&request.headers)?;
        if content_length > MAX_REQUEST_BODY_BYTES {
            return Err(RequestReadError::BodyTooLarge { path: request.path });
        }
        request.body.extend_from_slice(&bytes[header_end..]);
        if request.body.len() > content_length {
            return Err(RequestReadError::Invalid);
        }
        while request.body.len() < content_length {
            let read = match stream.read(&mut buffer) {
                Ok(read) => read,
                Err(error)
                    if matches!(
                        error.kind(),
                        std::io::ErrorKind::TimedOut | std::io::ErrorKind::WouldBlock
                    ) =>
                {
                    return Err(RequestReadError::Timeout);
                }
                Err(error) => return Err(RequestReadError::Io(error)),
            };
            if read == 0 {
                return Err(RequestReadError::Invalid);
            }
            let remaining = content_length - request.body.len();
            if read > remaining {
                return Err(RequestReadError::Invalid);
            }
            request.body.extend_from_slice(&buffer[..read]);
        }
        return Ok(request);
    }
}

fn request_content_length(headers: &BTreeMap<String, String>) -> Result<usize, RequestReadError> {
    if headers.contains_key("transfer-encoding") {
        return Err(RequestReadError::Invalid);
    }
    headers.get("content-length").map_or(Ok(0), |value| {
        value.parse().map_err(|_| RequestReadError::Invalid)
    })
}

fn parse_http_request(bytes: &[u8]) -> Result<HttpRequest, RequestReadError> {
    let header_end = bytes
        .windows(4)
        .position(|window| window == b"\r\n\r\n")
        .ok_or(RequestReadError::Invalid)?;
    let text = std::str::from_utf8(&bytes[..header_end]).map_err(|_| RequestReadError::Invalid)?;
    let mut lines = text.split("\r\n");
    let request_line = lines.next().ok_or(RequestReadError::Invalid)?;
    let mut parts = request_line.split_whitespace();
    let method = parts.next().ok_or(RequestReadError::Invalid)?;
    let target = parts.next().ok_or(RequestReadError::Invalid)?;
    let version = parts.next().ok_or(RequestReadError::Invalid)?;
    if parts.next().is_some()
        || method.is_empty()
        || !target.starts_with('/')
        || version != "HTTP/1.1"
    {
        return Err(RequestReadError::Invalid);
    }
    let mut headers = BTreeMap::new();
    for line in lines {
        let (name, value) = line.split_once(':').ok_or(RequestReadError::Invalid)?;
        let name = name.trim();
        if name.is_empty()
            || !name
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
        {
            return Err(RequestReadError::Invalid);
        }
        if headers.len() >= MAX_REQUEST_HEADERS && !headers.contains_key(&name.to_ascii_lowercase())
        {
            return Err(RequestReadError::TooLarge);
        }
        headers.insert(name.to_ascii_lowercase(), value.trim().to_owned());
    }
    let (path, query) = target.split_once('?').map_or_else(
        || (target.to_owned(), None),
        |(path, query)| (path.to_owned(), Some(query.to_owned())),
    );
    Ok(HttpRequest {
        method: method.to_owned(),
        path,
        query,
        headers,
        body: Vec::new(),
    })
}

fn write_response(stream: &mut TcpStream, response: &HttpResponse) -> std::io::Result<()> {
    let reason = match response.status {
        200 => "OK",
        202 => "Accepted",
        400 => "Bad Request",
        409 => "Conflict",
        408 => "Request Timeout",
        422 => "Unprocessable Content",
        429 => "Too Many Requests",
        404 => "Not Found",
        405 => "Method Not Allowed",
        426 => "Upgrade Required",
        502 => "Bad Gateway",
        503 => "Service Unavailable",
        504 => "Gateway Timeout",
        _ => "Internal Server Error",
    };
    write!(
        stream,
        "HTTP/1.1 {} {reason}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n",
        response.status,
        response.body.len(),
    )?;
    for (name, value) in &response.headers {
        write!(stream, "{name}: {value}\r\n")?;
    }
    write!(stream, "\r\n{}", response.body)?;
    stream.flush()
}

#[must_use]
pub fn smoke_readiness_json() -> String {
    SidecarState::default().readiness_json()
}

fn escape_json(value: &str) -> String {
    let mut escaped = String::with_capacity(value.len());
    for character in value.chars() {
        match character {
            '"' => escaped.push_str("\\\""),
            '\\' => escaped.push_str("\\\\"),
            '\n' => escaped.push_str("\\n"),
            '\r' => escaped.push_str("\\r"),
            '\t' => escaped.push_str("\\t"),
            character if character.is_control() => {
                write!(escaped, "\\u{:04x}", u32::from(character))
                    .expect("writing to String cannot fail");
            }
            character => escaped.push(character),
        }
    }
    escaped
}

fn valid_ws_channel(channel: &str) -> bool {
    channel.strip_prefix("job:").is_some_and(|id| {
        !id.is_empty()
            && id.len() <= 96
            && id
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    })
}

fn valid_utc_timestamp(timestamp: &str) -> bool {
    let bytes = timestamp.as_bytes();
    let Some(time_separator) = bytes.iter().position(|byte| *byte == b'T') else {
        return false;
    };
    let Some(fraction_or_zone) = bytes[time_separator + 1..]
        .iter()
        .position(|byte| matches!(*byte, b'.' | b'Z'))
        .map(|index| index + time_separator + 1)
    else {
        return false;
    };
    let time_end = fraction_or_zone;
    if bytes.get(time_end) == Some(&b'.') {
        let Some(zone) = bytes[time_end + 1..]
            .iter()
            .position(|byte| *byte == b'Z')
            .map(|index| index + time_end + 1)
        else {
            return false;
        };
        if zone == time_end + 1 || zone + 1 != bytes.len() {
            return false;
        }
        if !bytes[time_end + 1..zone].iter().all(u8::is_ascii_digit) {
            return false;
        }
    } else if time_end + 1 != bytes.len() {
        return false;
    }
    if time_separator != 10
        || time_end != 19
        || bytes.get(4) != Some(&b'-')
        || bytes.get(7) != Some(&b'-')
        || bytes.get(13) != Some(&b':')
        || bytes.get(16) != Some(&b':')
    {
        return false;
    }
    let Some(year) = decimal(&bytes[0..4]) else {
        return false;
    };
    let Some(month) = decimal(&bytes[5..7]) else {
        return false;
    };
    let Some(day) = decimal(&bytes[8..10]) else {
        return false;
    };
    let Some(hour) = decimal(&bytes[11..13]) else {
        return false;
    };
    let Some(minute) = decimal(&bytes[14..16]) else {
        return false;
    };
    let Some(second) = decimal(&bytes[17..19]) else {
        return false;
    };
    let days = match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if year % 4 == 0 && (year % 100 != 0 || year % 400 == 0) => 29,
        2 => 28,
        _ => return false,
    };
    day >= 1 && day <= days && hour < 24 && minute < 60 && second < 60
}

fn decimal(bytes: &[u8]) -> Option<u32> {
    bytes.iter().try_fold(0_u32, |value, byte| {
        byte.is_ascii_digit()
            .then_some(value * 10 + u32::from(byte - b'0'))
    })
}

fn valid_ws_data(data: &Value) -> bool {
    data.is_object() && data.to_string().len() <= MAX_WS_DATA_BYTES && valid_json_value(data, 0)
}

fn valid_json_value(value: &Value, depth: usize) -> bool {
    if depth > 4 {
        return false;
    }
    match value {
        Value::Object(object) => {
            object.len() <= MAX_WS_DATA_KEYS
                && object.keys().all(|key| !key.is_empty() && key.len() <= 64)
                && object
                    .values()
                    .all(|value| valid_json_value(value, depth + 1))
        }
        Value::Array(values) => {
            values.len() <= 64
                && values
                    .iter()
                    .all(|value| valid_json_value(value, depth + 1))
        }
        Value::String(value) => value.len() <= 4096,
        Value::Null | Value::Bool(_) | Value::Number(_) => true,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use sha2::{Digest, Sha256};
    use std::{
        fs,
        net::TcpListener,
        thread,
        time::{SystemTime, UNIX_EPOCH},
    };

    fn write_strict_v2_store(workspace: &Path) {
        fs::create_dir_all(workspace).unwrap();
        let connection = rusqlite::Connection::open(workspace.join("store.sqlite")).unwrap();
        connection
            .execute_batch(
                "PRAGMA user_version = 2;
                 CREATE TABLE projects(project_id TEXT PRIMARY KEY, name TEXT NOT NULL);
                 CREATE TABLE runs(run_id TEXT PRIMARY KEY, name TEXT NOT NULL, status TEXT);
                 CREATE TABLE pipelines(pipeline_id TEXT PRIMARY KEY, run_id TEXT NOT NULL, name TEXT NOT NULL, dataset_name TEXT NOT NULL);
                 CREATE TABLE chains(chain_id TEXT PRIMARY KEY, pipeline_id TEXT NOT NULL, steps TEXT NOT NULL, model_step_idx INTEGER NOT NULL, model_class TEXT NOT NULL);
                 CREATE TABLE predictions(prediction_id TEXT PRIMARY KEY, pipeline_id TEXT NOT NULL, dataset_name TEXT NOT NULL, model_name TEXT NOT NULL, model_class TEXT NOT NULL, fold_id TEXT NOT NULL, partition TEXT NOT NULL, metric TEXT NOT NULL, task_type TEXT NOT NULL);
                 CREATE TABLE artifacts(artifact_id TEXT PRIMARY KEY, artifact_path TEXT NOT NULL, content_hash TEXT NOT NULL);
                 CREATE TABLE logs(log_id TEXT PRIMARY KEY, pipeline_id TEXT NOT NULL, step_idx INTEGER NOT NULL, event TEXT NOT NULL);",
            )
            .unwrap();
    }

    #[derive(Debug)]
    struct SelectedTestJobExecutor;

    impl job_http::ScientificJobExecutor for SelectedTestJobExecutor {
        fn is_selected(&self) -> bool {
            true
        }

        fn request_cooperative_cancel(
            &self,
            _job_id: &str,
        ) -> Result<(), job_http::JobExecutorError> {
            Ok(())
        }
    }

    #[derive(Debug)]
    struct SelectedArchiveV2TestExecutor;

    impl archive_v2_prediction::ArchiveV2PredictionExecutor for SelectedArchiveV2TestExecutor {
        fn is_selected(&self) -> bool {
            true
        }

        fn execute(
            &self,
            request: &archive_v2_prediction::ResolvedArchiveV2PredictionRequest,
        ) -> Result<
            archive_v2_prediction::ArchiveV2PredictionOutput,
            archive_v2_prediction::ArchiveV2PredictionExecutorError,
        > {
            assert_eq!(request.archive_bytes, b"fake-archive-v2");
            Ok(archive_v2_prediction::ArchiveV2PredictionOutput {
                archive_id: "archive-a".into(),
                sample_ids: request.request.sample_ids.clone(),
                target_names: request.request.expected_target_names.clone(),
                values: vec![vec![1.5, 13.0], vec![2.5, 15.0]],
                provenance_executor: "fake-core-route-unit-only".into(),
            })
        }
    }

    #[derive(Debug)]
    struct TestLegacyConverter {
        return_code: i32,
    }

    impl legacy_conversion::LegacyConverter for TestLegacyConverter {
        fn is_available(&self) -> bool {
            true
        }

        fn command(&self, request: &LegacyConversionRequest) -> Vec<String> {
            let mut command = vec![
                "/attested/python".into(),
                "-I".into(),
                "-B".into(),
                "-m".into(),
                "nirs4all_tools".into(),
                "legacy".into(),
                "migrate".into(),
                request.workspace_path.to_string_lossy().into_owned(),
                "--output".into(),
                request.output_path.to_string_lossy().into_owned(),
                "--target".into(),
                "nirs4all-workspace-v2".into(),
            ];
            if request.verify && !request.dry_run {
                command.push("--verify".into());
            }
            if request.dry_run {
                command.push("--dry-run".into());
            }
            if request.strict {
                command.push("--strict".into());
            }
            command
        }

        fn run(
            &self,
            request: &LegacyConversionRequest,
        ) -> Result<LegacyConversionProcessOutput, LegacyConversionFailure> {
            if !request.dry_run && matches!(self.return_code, 0 | 10) {
                write_strict_v2_store(&request.output_path);
            }
            Ok(LegacyConversionProcessOutput {
                return_code: self.return_code,
                stdout: if self.return_code == 10 {
                    "opaque legacy items preserved".into()
                } else {
                    "conversion complete".into()
                },
                stderr: String::new(),
            })
        }
    }

    #[derive(Debug)]
    struct BlockingLegacyConverter {
        gate: Arc<(Mutex<(bool, bool)>, std::sync::Condvar)>,
    }

    impl legacy_conversion::LegacyConverter for BlockingLegacyConverter {
        fn is_available(&self) -> bool {
            true
        }

        fn command(&self, request: &LegacyConversionRequest) -> Vec<String> {
            vec![
                "/attested/python".into(),
                "-m".into(),
                "nirs4all_tools".into(),
                request.workspace_path.to_string_lossy().into_owned(),
            ]
        }

        fn run(
            &self,
            request: &LegacyConversionRequest,
        ) -> Result<LegacyConversionProcessOutput, LegacyConversionFailure> {
            let (lock, wake) = &*self.gate;
            let mut state = lock
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            state.0 = true;
            wake.notify_all();
            while !state.1 {
                state = wake
                    .wait(state)
                    .unwrap_or_else(std::sync::PoisonError::into_inner);
            }
            drop(state);
            write_strict_v2_store(&request.output_path);
            Ok(LegacyConversionProcessOutput {
                return_code: 0,
                stdout: "conversion complete".into(),
                stderr: String::new(),
            })
        }
    }

    fn test_directory(name: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!(
            "studio-sidecar-{name}-{}-{nonce}",
            std::process::id()
        ))
    }

    fn linked_workspace_record(id: &str, path: &Path, active: bool, runs_count: usize) -> Value {
        json!({
            "id": id,
            "path": path.to_string_lossy(),
            "name": id,
            "is_active": active,
            "linked_at": "2026-09-01T10:00:00",
            "last_scanned": null,
            "discovered": {"runs_count": runs_count},
        })
    }

    fn legacy_conversion_state(root: &Path, return_code: i32) -> (SidecarState, PathBuf) {
        let config = root.join("config");
        let source = root.join("legacy");
        fs::create_dir_all(&config).unwrap();
        fs::create_dir_all(&source).unwrap();
        fs::write(source.join("store.duckdb"), b"immutable source").unwrap();
        fs::write(
            config.join("app_settings.json"),
            serde_json::to_vec_pretty(&json!({
                "version": "3.0",
                "linked_workspaces": [linked_workspace_record(
                    "workspace-legacy",
                    &source.canonicalize().unwrap(),
                    true,
                    1,
                )],
                "favorite_pipelines": [],
                "ui_preferences": {},
            }))
            .unwrap(),
        )
        .unwrap();
        (
            SidecarState::with_legacy_converter_and_app_settings_dir(
                Arc::new(TestLegacyConverter { return_code }),
                config,
            ),
            source,
        )
    }

    fn assert_route_code(state: &mut SidecarState, path: &str, status: u16, code: &str) {
        let response = route_request(state, "GET", path);
        assert_eq!(response.status, status);
        assert_eq!(
            serde_json::from_str::<Value>(&response.body).unwrap()["code"],
            code
        );
    }

    fn assert_workspace_not_found(state: &mut SidecarState, path: &str) {
        let response = route_request(state, "GET", path);
        assert_eq!(response.status, 404);
        assert_eq!(
            serde_json::from_str::<Value>(&response.body).unwrap(),
            json!({"detail": "Workspace not found"})
        );
    }

    fn assert_run_discovery_queries_match_oracle(state: &mut SidecarState, expected: &Value) {
        for target in [
            "/api/workspaces/workspace-a/runs?source=unified",
            "/api/workspaces/workspace-a/runs?source=manifests",
            "/api/workspaces/workspace-a/runs?source=parquet",
            "/api/workspaces/workspace-a/runs?refresh=true",
            "/api/workspaces/workspace-a/runs?refresh=false",
            "/api/workspaces/workspace-a/runs?source=unified&refresh=true",
            "/api/workspaces/workspace-a/runs?refresh=false&source=parquet",
        ] {
            let raw = format!("GET {target} HTTP/1.1\r\nHost: localhost\r\n\r\n");
            let request = parse_http_request(raw.as_bytes()).unwrap();
            let response = route_http_request(state, &request);
            assert_eq!(response.status, 200, "{target}");
            assert_eq!(
                serde_json::from_str::<Value>(&response.body).unwrap(),
                *expected,
                "{target}",
            );
        }
    }

    #[test]
    fn readiness_stays_explicitly_non_parity() {
        let state = SidecarState::default();
        let body: Value = serde_json::from_str(&state.readiness_json()).unwrap();
        assert_eq!(body["protocol_version"], PROTOCOL_VERSION);
        assert_eq!(body["legacy_contract_baseline"], LEGACY_CONTRACT_BASELINE);
        assert_eq!(body["legacy_route_parity"], LEGACY_ROUTE_PARITY);
        assert_eq!(body["scientific_execution"], "unavailable");
    }

    #[test]
    fn scientific_submission_transport_rejects_query_and_network_body_overflow_exactly() {
        let runtime = Arc::new(job_http::NativeJobRuntime::with_executor(Arc::new(
            SelectedTestJobExecutor,
        )));
        let mut state = SidecarState::with_native_jobs(runtime);
        let raw = b"POST /api/runs/run-groups?retry=true HTTP/1.1\r\nHost: localhost\r\nContent-Length: 0\r\n\r\n";
        let request = parse_http_request(raw).unwrap();
        let query = route_http_request(&mut state, &request);
        assert_eq!(query.status, 404);
        assert_eq!(
            serde_json::from_str::<Value>(&query.body).unwrap()["error"]["code"],
            "route_not_found"
        );

        let oversized = request_body_too_large_response(SCIENTIFIC_SUBMISSION_ROUTE);
        assert_eq!(oversized.status, 413);
        assert_eq!(
            serde_json::from_str::<Value>(&oversized.body).unwrap(),
            json!({"detail": "Scientific submission body exceeds 65536 bytes"})
        );
    }

    fn assert_python_plugin_capabilities(state: &SidecarState, configured: bool) {
        let capabilities: Value = serde_json::from_str(&state.capabilities_json()).unwrap();
        assert_eq!(
            capabilities["python_plugin_host"],
            if configured {
                "configured"
            } else {
                "unconfigured"
            }
        );
        assert_eq!(
            capabilities["api_route_coverage"],
            "bootstrap_system_and_app_catalog"
        );
        for feature in [
            "app_settings_routes",
            "app_config_path_routes",
            "linked_workspace_catalog_route",
            "workspace_transition_status_route",
            "workspace_store_v5_run_summary_route",
            "workspace_store_v5_run_detail_route",
            "run_detail_owner_preflight_per_request",
            "workspace_store_v5_pipeline_summary_route",
            "workspace_store_v5_results_summary_route",
            "system_status_route",
            "system_info_route",
            "system_build_route",
            "updates_settings_routes",
            "native_job_status_routes",
            "native_job_cancellation_routes",
            "native_scientific_submission_routes",
            "scientific_submission_transport",
            "durable_execution_job_record_reads",
            "renderer_transport_selection",
            "renderer_http_transport",
            "renderer_websocket_transport",
            "renderer_rust_only_default",
            "unmigrated_renderer_routes_fail_closed",
        ] {
            assert_eq!(capabilities["features"][feature], true, "{feature}");
        }
        for feature in [
            "legacy_api_routes",
            "scientific_execution",
            "python_plugin_execution",
            "implicit_python_http_fallback",
            "unmigrated_api_routes_require_legacy_backend",
        ] {
            assert_eq!(capabilities["features"][feature], false, "{feature}");
        }
        assert_eq!(
            capabilities["features"]["run_detail_owner_host_configured"],
            configured
        );
        assert_eq!(
            capabilities["features"]["python_plugin_preflight"],
            configured
        );
        assert_eq!(
            capabilities["features"]["legacy_workspace_conversion_route"],
            state.legacy_conversion.is_available()
        );
    }

    #[test]
    fn python_plugin_preflight_is_explicit_and_never_enables_scientific_execution() {
        let mut unconfigured = SidecarState::default();
        assert_python_plugin_capabilities(&unconfigured, false);

        let unavailable = route_request(&mut unconfigured, "GET", "/sidecar/v1/python/preflight");
        assert_eq!(unavailable.status, 503);
        let unavailable_body: Value = serde_json::from_str(&unavailable.body).unwrap();
        assert_eq!(
            unavailable_body["error"]["code"],
            "python_plugin_unavailable"
        );
        assert_eq!(
            unavailable_body["error"]["details"]["reason"],
            "not_configured"
        );

        let unavailable_capabilities =
            route_request(&mut unconfigured, "GET", "/api/system/capabilities");
        assert_eq!(unavailable_capabilities.status, 503);
        let unavailable_capabilities_body: Value =
            serde_json::from_str(&unavailable_capabilities.body).unwrap();
        assert_eq!(
            unavailable_capabilities_body["error"]["code"],
            "python_plugin_unavailable"
        );

        let unavailable_info = route_request(&mut unconfigured, "GET", "/api/system/info");
        assert_eq!(unavailable_info.status, 503);

        let unavailable_build = route_request(&mut unconfigured, "GET", "/api/system/build");
        assert_eq!(unavailable_build.status, 503);

        let unavailable_runtime =
            route_request(&mut unconfigured, "GET", "/api/system/env-coherence");
        assert_eq!(unavailable_runtime.status, 503);

        let missing_host = std::env::temp_dir().join(format!(
            "n4a-sidecar-missing-python-host-{}",
            std::process::id()
        ));
        let mut configured = SidecarState::with_python_plugin_host(missing_host);
        assert_python_plugin_capabilities(&configured, true);

        let failed = route_request(&mut configured, "GET", "/sidecar/v1/python/preflight");
        assert_eq!(failed.status, 503);
        let failed_body: Value = serde_json::from_str(&failed.body).unwrap();
        assert_eq!(
            failed_body["error"]["code"],
            "python_plugin_preflight_failed"
        );
        assert_eq!(failed_body["error"]["details"]["reason"], "spawn_failed");
    }

    #[cfg(unix)]
    #[test]
    fn python_plugin_routes_cannot_write_bytecode_into_the_runtime() {
        use std::os::unix::fs::PermissionsExt;

        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let runtime = std::env::temp_dir().join(format!(
            "studio-sidecar-python-preflight-bytecode-{}-{nonce}",
            std::process::id()
        ));
        fs::create_dir_all(&runtime).unwrap();
        let host = runtime.join("python3");
        fs::write(
            &host,
            format!(
                "#!/bin/sh\ncase \" $* \" in *\" -B \"*) ;; *) mkdir -p '{0}/__pycache__'; touch '{0}/__pycache__/mutated.pyc' ;; esac\nif [ \"${{PYTHONDONTWRITEBYTECODE:-}}\" != 1 ]; then mkdir -p '{0}/__pycache__'; touch '{0}/__pycache__/mutated.pyc'; fi\nprintf '{{}}'\nexit 0\n",
                runtime.display()
            ),
        )
        .unwrap();
        let mut permissions = fs::metadata(&host).unwrap().permissions();
        permissions.set_mode(0o700);
        fs::set_permissions(&host, permissions).unwrap();

        let mut state = SidecarState::with_python_plugin_host(host);
        for route in [
            "/sidecar/v1/python/preflight",
            "/api/system/capabilities",
            "/api/system/info",
            "/api/system/build",
            "/api/system/env-coherence",
            "/api/updates/version",
            "/api/updates/runtime/status",
        ] {
            let response = route_request(&mut state, "GET", route);
            assert_ne!(response.status, 404, "{route}");
            assert!(
                !runtime.join("__pycache__").exists(),
                "{route} launched CPython without disabling bytecode writes"
            );
        }

        fs::remove_dir_all(runtime).unwrap();
    }

    #[test]
    fn every_product_cpython_launch_disables_bytecode_writes_statically() {
        let manifest = Path::new(env!("CARGO_MANIFEST_DIR"));
        for relative in [
            "src/lib.rs",
            "src/run_detail_cpython.rs",
            "src/scientific_cpython.rs",
        ] {
            let source = fs::read_to_string(manifest.join(relative)).unwrap();
            assert!(
                !source.contains(".args([\"-I\", \"-c\""),
                "{relative} contains a CPython launch that permits bytecode writes"
            );
        }
    }

    #[test]
    fn native_build_metadata_is_normalized_without_trusting_an_invalid_file() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let directory = std::env::temp_dir().join(format!(
            "studio-sidecar-build-info-{}-{nonce}",
            std::process::id()
        ));
        fs::create_dir_all(&directory).unwrap();
        let valid = directory.join("build_info.json");
        fs::write(&valid, r#"{"flavor":"gpu-metal","profile":"gpu"}"#).unwrap();
        let mut state = SidecarState {
            runtime_mode: "bundled".into(),
            build_info_path: Some(valid),
            ..SidecarState::default()
        };

        let build = native_build_info(&state);
        assert_eq!(build["flavor"], "gpu-metal");
        assert_eq!(build["gpu_enabled"], true);
        assert_eq!(build["profile"], "gpu");

        let invalid = directory.join("invalid-build-info.json");
        fs::write(&invalid, "[]").unwrap();
        state.build_info_path = Some(invalid);
        let fallback = native_build_info(&state);
        assert_eq!(
            fallback,
            json!({"flavor":"development","gpu_enabled":false})
        );
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn app_settings_routes_persist_without_a_python_plugin_host() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let directory = std::env::temp_dir().join(format!(
            "studio-sidecar-routes-{}-{nonce}",
            std::process::id()
        ));
        let mut state = SidecarState::with_app_settings_dir(&directory);

        let initial = route_request(&mut state, "GET", "/api/app/settings");
        assert_eq!(initial.status, 200);
        let initial: Value = serde_json::from_str(&initial.body).unwrap();
        assert_eq!(initial["linked_workspaces_count"], 0);
        assert_eq!(initial["ui_preferences"]["theme"], "system");

        let updated = route_request_with_body(
            &mut state,
            "PUT",
            "/api/app/settings",
            br#"{"ui_preferences":{"theme":"dark"}}"#,
        );
        assert_eq!(updated.status, 200);
        let added = route_request_with_body(
            &mut state,
            "POST",
            "/api/app/favorites",
            br#"{"pipeline_id":"pipeline-a"}"#,
        );
        assert_eq!(added.status, 200);
        assert_eq!(
            serde_json::from_str::<Value>(&added.body).unwrap()["added"],
            true
        );
        let favourites = route_request(&mut state, "GET", "/api/app/favorites");
        assert_eq!(
            serde_json::from_str::<Value>(&favourites.body).unwrap(),
            json!({"favorites": ["pipeline-a"], "count": 1})
        );
        let removed = route_request(&mut state, "DELETE", "/api/app/favorites/pipeline-a");
        assert_eq!(
            serde_json::from_str::<Value>(&removed.body).unwrap()["removed"],
            true
        );
        assert_eq!(
            route_request_with_body(&mut state, "PUT", "/api/app/settings", b"[]").status,
            422
        );

        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn setup_routes_persist_without_acquiring_a_python_http_backend() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let directory = std::env::temp_dir().join(format!(
            "studio-sidecar-setup-routes-{}-{nonce}",
            std::process::id()
        ));
        let mut state = SidecarState::with_app_settings_dir(&directory);

        let initial = route_request(&mut state, "GET", "/api/config/setup-status");
        assert_eq!(initial.status, 200);
        assert_eq!(
            serde_json::from_str::<Value>(&initial.body).unwrap(),
            json!({
                "setup_completed": false,
                "selected_profile": null,
                "completed_at": null,
            })
        );

        let skipped = route_request(&mut state, "POST", "/api/config/skip-setup");
        assert_eq!(skipped.status, 200);
        assert_eq!(
            serde_json::from_str::<Value>(&skipped.body).unwrap()["selected_profile"],
            "cpu"
        );
        let persisted = route_request(&mut state, "GET", "/api/config/setup-status");
        assert_eq!(
            serde_json::from_str::<Value>(&persisted.body).unwrap()["setup_completed"],
            true
        );

        let completed = route_request_with_body(
            &mut state,
            "POST",
            "/api/config/complete-setup",
            br#"{"profile":"gpu-cuda-torch"}"#,
        );
        assert_eq!(completed.status, 200);
        assert_eq!(
            serde_json::from_str::<Value>(&completed.body).unwrap()["selected_profile"],
            "gpu-cuda-torch"
        );
        assert_eq!(
            route_request_with_body(
                &mut state,
                "POST",
                "/api/config/complete-setup",
                br#"{"profile":""}"#,
            )
            .status,
            422
        );

        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn app_config_path_routes_redirect_and_reset_without_a_python_plugin_host() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let directory = std::env::temp_dir().join(format!(
            "studio-sidecar-config-path-{}-{nonce}",
            std::process::id()
        ));
        let initial = directory.join("initial");
        let default = directory.join("default");
        let custom = directory.join("custom");
        fs::create_dir_all(&initial).unwrap();
        fs::create_dir_all(&custom).unwrap();
        let mut state = SidecarState::with_app_settings_paths(&initial, &default);

        let initial_response = route_request(&mut state, "GET", "/api/app/config-path");
        assert_eq!(initial_response.status, 200);
        assert_eq!(
            serde_json::from_str::<Value>(&initial_response.body).unwrap()["is_custom"],
            true
        );
        let custom = custom.canonicalize().unwrap();
        let request = json!({"path": custom.to_string_lossy()}).to_string();
        let updated = route_request_with_body(
            &mut state,
            "POST",
            "/api/app/config-path",
            request.as_bytes(),
        );
        assert_eq!(updated.status, 200);
        assert_eq!(
            fs::read_to_string(default.join("config_redirect.txt")).unwrap(),
            custom.to_string_lossy()
        );
        assert_eq!(
            route_request_with_body(
                &mut state,
                "POST",
                "/api/app/config-path",
                br#"{"path":"missing"}"#,
            )
            .status,
            400
        );
        let non_directory = directory.join("not-a-directory");
        fs::write(&non_directory, "not a directory").unwrap();
        let non_directory_request = json!({"path": non_directory.to_string_lossy()}).to_string();
        assert_eq!(
            route_request_with_body(
                &mut state,
                "POST",
                "/api/app/config-path",
                non_directory_request.as_bytes(),
            )
            .status,
            400
        );
        let reset = route_request(&mut state, "DELETE", "/api/app/config-path");
        assert_eq!(reset.status, 200);
        assert!(!default.join("config_redirect.txt").exists());
        assert_eq!(
            serde_json::from_str::<Value>(&reset.body).unwrap()["current_path"],
            default.to_string_lossy().as_ref()
        );
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn linked_workspace_catalog_is_available_without_a_python_plugin_host() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let directory = std::env::temp_dir().join(format!(
            "studio-sidecar-linked-workspaces-{}-{nonce}",
            std::process::id()
        ));
        fs::create_dir_all(&directory).unwrap();
        fs::write(
            directory.join("app_settings.json"),
            r#"{"linked_workspaces":[{"id":"workspace-a","path":"/workspace/a","name":"A","is_active":true,"linked_at":"2026-08-31T12:00:00","last_scanned":null,"discovered":{"runs_count":1}}]}"#,
        )
        .unwrap();
        let mut state = SidecarState::with_app_settings_dir(&directory);

        let response = route_request(&mut state, "GET", "/api/workspaces");
        assert_eq!(response.status, 200);
        assert_eq!(
            serde_json::from_str::<Value>(&response.body).unwrap(),
            json!({
                "workspaces": [{
                    "id": "workspace-a",
                    "path": "/workspace/a",
                    "name": "A",
                    "is_active": true,
                    "linked_at": "2026-08-31T12:00:00",
                    "last_scanned": null,
                    "discovered": {"runs_count": 1},
                }],
                "active_workspace_id": "workspace-a",
                "total": 1,
            })
        );
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn transition_and_verified_conversion_routes_are_rust_owned_and_rollback_safe() {
        let root = test_directory("legacy-conversion-code-zero");
        fs::create_dir_all(&root).unwrap();
        let (mut state, source) = legacy_conversion_state(&root, 0);

        let transition = route_request(&mut state, "GET", LEGACY_TRANSITION_STATUS_ROUTE);
        assert_eq!(transition.status, 200, "{}", transition.body);
        let transition: Value = serde_json::from_str(&transition.body).unwrap();
        assert_eq!(transition["format"], "duckdb-workspace");
        assert_eq!(transition["conversion_required"], true);
        assert_eq!(transition["converter_available"], true);
        assert!(transition["conversion_command"]
            .as_str()
            .unwrap()
            .contains("-m nirs4all_tools legacy migrate"));

        let output = root.join("converted");
        let response = route_request_with_body(
            &mut state,
            "POST",
            LEGACY_CONVERSION_ROUTE,
            serde_json::to_string(&json!({
                "output_path": output,
                "verify": true,
                "link_converted_workspace": true,
            }))
            .unwrap()
            .as_bytes(),
        );
        assert_eq!(response.status, 200, "{}", response.body);
        let response: Value = serde_json::from_str(&response.body).unwrap();
        assert_eq!(response["return_code"], 0);
        assert_eq!(response["success"], true);
        assert_eq!(response["best_effort"], false);
        assert_eq!(
            response["active_workspace_path"],
            output.canonicalize().unwrap().to_string_lossy().as_ref()
        );
        assert_eq!(
            fs::read(source.join("store.duckdb")).unwrap(),
            b"immutable source"
        );

        let restored = route_request(
            &mut state,
            "POST",
            "/api/workspaces/workspace-legacy/activate",
        );
        assert_eq!(restored.status, 200, "{}", restored.body);
        assert_eq!(
            state
                .app_settings
                .active_linked_workspace_response()
                .unwrap()
                .unwrap()["id"],
            "workspace-legacy"
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn conversion_exit_policy_is_closed_for_every_declared_and_unknown_code() {
        for (code, expected_status, detail) in [
            (10, 200, "best-effort"),
            (20, 422, "unsupported input"),
            (30, 422, "verification failed"),
            (40, 409, "safety policy"),
            (70, 500, "internal error"),
            (99, 502, "unknown exit code"),
        ] {
            let root = test_directory(&format!("legacy-conversion-code-{code}"));
            fs::create_dir_all(&root).unwrap();
            let (mut state, source) = legacy_conversion_state(&root, code);
            let output = root.join("converted");
            let response = route_request_with_body(
                &mut state,
                "POST",
                LEGACY_CONVERSION_ROUTE,
                serde_json::to_string(&json!({
                    "output_path": output,
                    "verify": true,
                    "link_converted_workspace": true,
                }))
                .unwrap()
                .as_bytes(),
            );
            assert_eq!(response.status, expected_status, "{}", response.body);
            let response: Value = serde_json::from_str(&response.body).unwrap();
            assert_eq!(response["return_code"], code);
            assert_eq!(response["success"], code == 10);
            assert_eq!(response["best_effort"], code == 10);
            assert_eq!(response["linked_workspace_id"], Value::Null);
            assert_eq!(response["active_workspace_path"], Value::Null);
            if code == 10 {
                assert_eq!(response["activation_skipped"], true);
                assert!(response["link_error"]
                    .as_str()
                    .unwrap()
                    .contains("best-effort"));
            } else {
                assert!(response["detail"].as_str().unwrap().contains(detail));
            }
            assert_eq!(
                state
                    .app_settings
                    .active_linked_workspace_response()
                    .unwrap()
                    .unwrap()["id"],
                "workspace-legacy"
            );
            assert_eq!(
                fs::read(source.join("store.duckdb")).unwrap(),
                b"immutable source"
            );
            fs::remove_dir_all(root).unwrap();
        }
    }

    #[test]
    fn conversion_process_boundary_failures_have_closed_http_mappings() {
        for (failure, status) in [
            (LegacyConversionFailure::Busy, 409),
            (LegacyConversionFailure::SpawnFailed, 503),
            (LegacyConversionFailure::TimedOut, 504),
            (LegacyConversionFailure::ProcessFailed, 502),
            (LegacyConversionFailure::OutputReadFailed, 502),
            (LegacyConversionFailure::StdoutTooLarge, 502),
            (LegacyConversionFailure::StderrTooLarge, 502),
            (LegacyConversionFailure::InvalidUtf8, 502),
            (LegacyConversionFailure::CleanupFailed, 502),
        ] {
            let response = legacy_conversion_bridge_error_response(failure);
            assert_eq!(response.status, status);
            assert_eq!(
                serde_json::from_str::<Value>(&response.body).unwrap()["reason"],
                failure.reason()
            );
        }
    }

    #[test]
    #[expect(
        clippy::too_many_lines,
        reason = "one end-to-end concurrency test keeps the gate, health probe, CAS mutation, and response assertions together"
    )]
    fn live_conversion_releases_the_route_mutex_while_the_converter_runs() {
        let root = test_directory("legacy-conversion-live-concurrency");
        fs::create_dir_all(&root).unwrap();
        let (mut state, _) = legacy_conversion_state(&root, 0);
        let alternate = root.join("alternate");
        fs::create_dir_all(&alternate).unwrap();
        let settings_path = root.join("config/app_settings.json");
        let mut settings: Value =
            serde_json::from_slice(&fs::read(&settings_path).unwrap()).unwrap();
        settings["linked_workspaces"]
            .as_array_mut()
            .unwrap()
            .push(linked_workspace_record(
                "workspace-alternate",
                &alternate.canonicalize().unwrap(),
                false,
                0,
            ));
        fs::write(
            &settings_path,
            serde_json::to_vec_pretty(&settings).unwrap(),
        )
        .unwrap();
        let gate = Arc::new((Mutex::new((false, false)), std::sync::Condvar::new()));
        state.legacy_conversion =
            LegacyConversionRuntime::with_converter(Arc::new(BlockingLegacyConverter {
                gate: Arc::clone(&gate),
            }));

        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let state = Arc::new(Mutex::new(state));
        let server_state = Arc::clone(&state);
        let server = thread::spawn(move || {
            let mut handlers = Vec::new();
            for _ in 0..2 {
                let (stream, _) = listener.accept().unwrap();
                let state = Arc::clone(&server_state);
                handlers.push(thread::spawn(move || {
                    handle_connection_with_limits(stream, &state, ServerLimits::default()).unwrap();
                }));
            }
            for handler in handlers {
                handler.join().unwrap();
            }
        });

        let output = root.join("converted");
        let body = serde_json::to_string(&json!({
            "output_path": output,
            "verify": true,
            "link_converted_workspace": true,
        }))
        .unwrap();
        let conversion = thread::spawn(move || {
            let mut client = TcpStream::connect(address).unwrap();
            client
                .write_all(
                    format!(
                        "POST {LEGACY_CONVERSION_ROUTE} HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{body}",
                        body.len()
                    )
                    .as_bytes(),
                )
                .unwrap();
            let mut response = String::new();
            client.read_to_string(&mut response).unwrap();
            response
        });

        let (lock, wake) = &*gate;
        let mut gate_state = lock
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        while !gate_state.0 {
            gate_state = wake
                .wait(gate_state)
                .unwrap_or_else(std::sync::PoisonError::into_inner);
        }
        drop(gate_state);

        let mut health = TcpStream::connect(address).unwrap();
        health
            .set_read_timeout(Some(Duration::from_secs(2)))
            .unwrap();
        health
            .write_all(b"GET /sidecar/v1/health HTTP/1.1\r\nHost: localhost\r\n\r\n")
            .unwrap();
        let mut health_response = String::new();
        let health_result = health.read_to_string(&mut health_response);

        assert!(state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .app_settings
            .activate_linked_workspace("workspace-alternate")
            .unwrap()
            .is_some());

        let mut gate_state = lock
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        gate_state.1 = true;
        wake.notify_all();
        drop(gate_state);

        health_result.unwrap();
        assert!(health_response.starts_with("HTTP/1.1 200 OK\r\n"));
        let conversion_response = conversion.join().unwrap();
        assert!(conversion_response.starts_with("HTTP/1.1 200 OK\r\n"));
        let conversion_body: Value =
            serde_json::from_str(conversion_response.split("\r\n\r\n").nth(1).unwrap()).unwrap();
        assert_eq!(conversion_body["activation_skipped"], true);
        assert!(conversion_body["link_error"]
            .as_str()
            .unwrap()
            .contains("active workspace changed"));
        assert_eq!(
            state
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .app_settings
                .active_linked_workspace_response()
                .unwrap()
                .unwrap()["id"],
            "workspace-alternate"
        );
        server.join().unwrap();
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn conversion_dry_run_never_writes_or_activates_and_routes_reject_query_drift() {
        let root = test_directory("legacy-conversion-dry-run");
        fs::create_dir_all(&root).unwrap();
        let (mut state, source) = legacy_conversion_state(&root, 0);
        let output = root.join("converted");
        let response = route_request_with_body(
            &mut state,
            "POST",
            LEGACY_CONVERSION_ROUTE,
            serde_json::to_string(&json!({
                "output_path": output,
                "dry_run": true,
                "verify": true,
                "link_converted_workspace": true,
            }))
            .unwrap()
            .as_bytes(),
        );
        assert_eq!(response.status, 200, "{}", response.body);
        let response: Value = serde_json::from_str(&response.body).unwrap();
        assert_eq!(response["dry_run"], true);
        assert_eq!(response["link_converted_workspace"], false);
        let command = response["command"].as_array().unwrap();
        assert!(command.contains(&json!("--dry-run")));
        assert!(!command.contains(&json!("--verify")));
        assert!(!output.exists());
        assert_eq!(
            fs::read(source.join("store.duckdb")).unwrap(),
            b"immutable source"
        );

        for raw in [
            b"GET /api/workspace/transition-status?deep=true HTTP/1.1\r\nHost: localhost\r\n\r\n".as_slice(),
            b"POST /api/workspace/legacy-convert?retry=true HTTP/1.1\r\nHost: localhost\r\nContent-Length: 2\r\n\r\n{}".as_slice(),
        ] {
            let request = parse_http_request(raw).unwrap();
            assert_eq!(route_http_request(&mut state, &request).status, 404);
        }
        assert_eq!(
            route_request(&mut state, "POST", LEGACY_TRANSITION_STATUS_ROUTE).status,
            405
        );
        assert_eq!(
            route_request(&mut state, "GET", LEGACY_CONVERSION_ROUTE).status,
            405
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn workspace_summary_routes_read_the_python_written_v5_store_without_a_python_host() {
        let directory = test_directory("workspace-run-summary");
        let settings_directory = directory.join("config");
        let workspace = directory.join("workspace");
        let empty_workspace = directory.join("empty-workspace");
        let busy_workspace = directory.join("busy-workspace");
        let v4_workspace = directory.join("v4-workspace");
        fs::create_dir_all(&settings_directory).unwrap();
        fs::create_dir_all(&workspace).unwrap();
        fs::create_dir_all(&empty_workspace).unwrap();
        fs::create_dir_all(&busy_workspace).unwrap();
        fs::create_dir_all(&v4_workspace).unwrap();
        fs::write(
            workspace.join("store.sqlite"),
            include_bytes!("../tests/fixtures/workspace_store_v5.sqlite"),
        )
        .unwrap();
        fs::write(
            busy_workspace.join("store.sqlite"),
            include_bytes!("../tests/fixtures/workspace_store_v5.sqlite"),
        )
        .unwrap();
        fs::write(busy_workspace.join("store.sqlite-wal"), b"active writer").unwrap();
        fs::write(
            v4_workspace.join("store.sqlite"),
            include_bytes!("../tests/fixtures/workspace_store_v5.sqlite"),
        )
        .unwrap();
        let v4 = rusqlite::Connection::open(v4_workspace.join("store.sqlite")).unwrap();
        v4.execute_batch("PRAGMA user_version = 4").unwrap();
        drop(v4);
        fs::write(
            settings_directory.join("app_settings.json"),
            json!({
                "linked_workspaces": [
                    linked_workspace_record("workspace-a", &workspace, true, 1),
                    linked_workspace_record("workspace-empty", &empty_workspace, false, 0),
                    linked_workspace_record("workspace-busy", &busy_workspace, false, 1),
                    linked_workspace_record("workspace-v4", &v4_workspace, false, 1),
                ],
            })
            .to_string(),
        )
        .unwrap();
        let mut state = SidecarState::with_app_settings_dir(&settings_directory);
        let response = route_request(&mut state, "GET", "/api/workspaces/workspace-a/runs");
        assert_eq!(response.status, 200);
        let payload: Value = serde_json::from_str(&response.body).unwrap();
        let expected: Value = serde_json::from_str(include_str!(
            "../tests/fixtures/workspace_store_v5_runs.response.json"
        ))
        .unwrap();
        assert_eq!(payload, expected);
        assert_run_discovery_queries_match_oracle(&mut state, &expected);
        assert!(!workspace.join("store.sqlite-wal").exists());
        assert!(!workspace.join("store.sqlite-shm").exists());
        let results_response =
            route_request(&mut state, "GET", "/api/workspaces/workspace-a/results");
        assert_eq!(results_response.status, 200);
        let results_payload: Value = serde_json::from_str(&results_response.body).unwrap();
        let expected_results: Value = serde_json::from_str(include_str!(
            "../tests/fixtures/workspace_store_v5_results.response.json"
        ))
        .unwrap();
        assert_eq!(results_payload, expected_results);
        assert_eq!(
            route_request(&mut state, "POST", "/api/workspaces/workspace-a/runs").status,
            405
        );
        assert_eq!(
            route_request(&mut state, "POST", "/api/workspaces/workspace-a/results").status,
            405
        );
        assert_route_code(
            &mut state,
            "/api/workspaces/workspace-empty/runs",
            409,
            "workspace_store_unavailable",
        );
        assert_route_code(
            &mut state,
            "/api/workspaces/workspace-busy/runs",
            409,
            "workspace_store_busy",
        );
        assert_route_code(
            &mut state,
            "/api/workspaces/workspace-busy/results",
            409,
            "workspace_store_busy",
        );
        assert_route_code(
            &mut state,
            "/api/workspaces/workspace-v4/runs",
            409,
            "workspace_store_schema_incompatible",
        );
        assert_workspace_not_found(&mut state, "/api/workspaces/missing/runs");
        assert_workspace_not_found(&mut state, "/api/workspaces/missing/results");
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn run_detail_route_fails_closed_without_a_linked_workspace() {
        let mut state = SidecarState::default();
        let response = route_request(
            &mut state,
            "GET",
            "/api/workspaces/workspace-a/runs/run-detail-001",
        );
        assert_eq!(response.status, 404);
        assert_eq!(
            serde_json::from_str::<Value>(&response.body).unwrap()["detail"],
            "Workspace not found"
        );
    }

    #[test]
    fn results_summary_route_matches_the_python_oracle_and_fails_closed() {
        let directory = test_directory("workspace-results-summary-route");
        let settings_directory = directory.join("config");
        let workspace = directory.join("workspace");
        let empty_workspace = directory.join("empty-workspace");
        let busy_workspace = directory.join("busy-workspace");
        fs::create_dir_all(&settings_directory).unwrap();
        fs::create_dir_all(&workspace).unwrap();
        fs::create_dir_all(&empty_workspace).unwrap();
        fs::create_dir_all(&busy_workspace).unwrap();
        fs::write(
            workspace.join("store.sqlite"),
            include_bytes!("../tests/fixtures/workspace_store_v5_summary.sqlite"),
        )
        .unwrap();
        fs::write(
            busy_workspace.join("store.sqlite"),
            include_bytes!("../tests/fixtures/workspace_store_v5_summary.sqlite"),
        )
        .unwrap();
        fs::write(busy_workspace.join("store.sqlite-wal"), b"active writer").unwrap();
        fs::write(
            settings_directory.join("dataset_links.json"),
            include_str!("../tests/fixtures/workspace_store_v5_summary_dataset_links.json"),
        )
        .unwrap();
        fs::write(
            settings_directory.join("app_settings.json"),
            json!({
                "linked_workspaces": [
                    linked_workspace_record("workspace-summary-v5", &workspace, true, 1),
                    linked_workspace_record("workspace-empty", &empty_workspace, false, 0),
                    linked_workspace_record("workspace-busy", &busy_workspace, false, 1),
                ],
            })
            .to_string(),
        )
        .unwrap();
        let mut state = SidecarState::with_app_settings_dir(&settings_directory);

        let response = route_request(
            &mut state,
            "GET",
            "/api/workspaces/workspace-summary-v5/results/summary",
        );
        assert_eq!(response.status, 200);
        let actual: Value = serde_json::from_str(&response.body).unwrap();
        let expected: Value = serde_json::from_str(include_str!(
            "../tests/fixtures/workspace_store_v5_summary.response.json"
        ))
        .unwrap();
        assert_eq!(actual, expected);
        assert!(!workspace.join("store.sqlite-wal").exists());
        assert!(!workspace.join("store.sqlite-shm").exists());
        assert_eq!(
            route_request(
                &mut state,
                "POST",
                "/api/workspaces/workspace-summary-v5/results/summary",
            )
            .status,
            405
        );
        assert_route_code(
            &mut state,
            "/api/workspaces/workspace-empty/results/summary",
            409,
            "workspace_store_unavailable",
        );
        assert_route_code(
            &mut state,
            "/api/workspaces/workspace-busy/results/summary",
            409,
            "workspace_store_busy",
        );
        assert_workspace_not_found(&mut state, "/api/workspaces/missing/results/summary");
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn system_status_uses_only_the_active_linked_workspace_catalogue() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let directory = std::env::temp_dir().join(format!(
            "studio-sidecar-system-status-{}-{nonce}",
            std::process::id()
        ));
        fs::create_dir_all(&directory).unwrap();
        let mut empty_state = SidecarState::with_app_settings_dir(&directory);
        let empty = route_request(&mut empty_state, "GET", "/api/system/status");
        assert_eq!(empty.status, 200);
        assert_eq!(
            serde_json::from_str::<Value>(&empty.body).unwrap(),
            json!({
                "status": {
                    "workspace_loaded": false,
                    "workspace": null,
                    "nirs4all_available": false,
                }
            })
        );
        fs::write(
            directory.join("app_settings.json"),
            r#"{"linked_workspaces":[{"id":"workspace-a","path":"/workspace/a","name":"A","is_active":true,"last_scanned":"2026-08-31T12:00:00","discovered":{"datasets_count":2}}]}"#,
        )
        .unwrap();
        let mut state = SidecarState::with_app_settings_dir(&directory);

        let response = route_request(&mut state, "GET", "/api/system/status");
        assert_eq!(response.status, 200);
        assert_eq!(
            serde_json::from_str::<Value>(&response.body).unwrap(),
            json!({
                "status": {
                    "workspace_loaded": true,
                    "workspace": {
                        "name": "A",
                        "path": "/workspace/a",
                        "datasets_count": 2,
                        "last_accessed": "2026-08-31T12:00:00",
                    },
                    "nirs4all_available": false,
                }
            })
        );
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn linked_workspace_state_mutations_are_native_and_persisted() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let directory = std::env::temp_dir().join(format!(
            "studio-sidecar-linked-workspace-state-{}-{nonce}",
            std::process::id()
        ));
        fs::create_dir_all(&directory).unwrap();
        fs::write(
            directory.join("app_settings.json"),
            r#"{"linked_workspaces":[{"id":"workspace-a","path":"/workspace/a","name":"A","is_active":true,"linked_at":"2026-08-31T12:00:00","last_scanned":null,"discovered":{"runs_count":1}},{"id":"workspace-b","path":"/workspace/b","name":"B","is_active":false,"linked_at":"2026-08-31T12:01:00","last_scanned":null,"discovered":{"datasets_count":2}}]}"#,
        )
        .unwrap();
        let mut state = SidecarState::with_app_settings_dir(&directory);

        let activated = route_request(&mut state, "POST", "/api/workspaces/workspace-b/activate");
        assert_eq!(activated.status, 200);
        assert_eq!(
            serde_json::from_str::<Value>(&activated.body).unwrap()["id"],
            "workspace-b"
        );
        assert_eq!(
            serde_json::from_str::<Value>(&activated.body).unwrap()["is_active"],
            true
        );
        let listed = route_request(&mut state, "GET", "/api/workspaces");
        assert_eq!(
            serde_json::from_str::<Value>(&listed.body).unwrap()["active_workspace_id"],
            "workspace-b"
        );

        let unlinked = route_request(&mut state, "DELETE", "/api/workspaces/workspace-b");
        assert_eq!(unlinked.status, 200);
        assert_eq!(
            serde_json::from_str::<Value>(&unlinked.body).unwrap(),
            json!({"success": true, "message": "Workspace unlinked"})
        );
        let relisted = route_request(&mut state, "GET", "/api/workspaces");
        let relisted: Value = serde_json::from_str(&relisted.body).unwrap();
        assert_eq!(relisted["active_workspace_id"], "workspace-a");
        assert_eq!(relisted["total"], 1);

        let missing = route_request(&mut state, "POST", "/api/workspaces/missing/activate");
        assert_eq!(missing.status, 404);
        assert_eq!(
            serde_json::from_str::<Value>(&missing.body).unwrap(),
            json!({"detail": "Workspace not found"})
        );
        assert_eq!(
            route_request(&mut state, "GET", "/api/workspaces/workspace-a/activate",).status,
            405
        );
        assert_eq!(
            route_request(&mut state, "POST", "/api/workspaces/workspace-a").status,
            405
        );
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn native_network_state_uses_only_the_legacy_preference_contract() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let directory = std::env::temp_dir().join(format!(
            "studio-sidecar-network-state-{}-{nonce}",
            std::process::id()
        ));
        fs::create_dir_all(&directory).unwrap();
        let settings = directory.join(UPDATE_SETTINGS_FILE);

        fs::write(&settings, "offline_mode: 'on'\n").unwrap();
        assert_eq!(
            native_network_state_json(Some(&settings), false),
            json!({"online": false, "forced": true, "mode": "on", "env_forced": false})
        );
        assert_eq!(
            native_network_state_json(Some(&settings), true),
            json!({"online": false, "forced": true, "mode": "on", "env_forced": true})
        );

        fs::write(&settings, "offline_mode: unsupported\n").unwrap();
        assert_eq!(
            native_network_state_json(Some(&settings), false),
            json!({"online": true, "forced": false, "mode": "auto", "env_forced": false})
        );
        fs::write(&settings, "offline_mode: off # a user override\n").unwrap();
        assert_eq!(
            native_network_state_json(Some(&settings), false)["mode"],
            "off"
        );
        let oversized_settings = usize::try_from(MAX_UPDATE_SETTINGS_BYTES)
            .expect("the bounded settings size fits every supported platform")
            + 1;
        fs::write(&settings, "x".repeat(oversized_settings)).unwrap();
        assert_eq!(offline_mode_from_update_settings(Some(&settings)), None);
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn native_network_route_is_available_without_a_python_plugin_host() {
        let mut state = SidecarState::default();
        let response = route_request(&mut state, "GET", "/api/system/network");
        assert_eq!(response.status, 200);
        let body: Value = serde_json::from_str(&response.body).unwrap();
        assert!(body["online"].is_boolean());
        assert!(body["forced"].is_boolean());
        assert!(matches!(body["mode"].as_str(), Some("auto" | "on" | "off")));
        assert!(body["env_forced"].is_boolean());
        assert_eq!(
            route_request(&mut state, "POST", "/api/system/network").status,
            405
        );
    }

    #[test]
    fn native_update_settings_preserve_the_legacy_shape_and_patch_semantics() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let directory = std::env::temp_dir().join(format!(
            "studio-sidecar-update-settings-{}-{nonce}",
            std::process::id()
        ));
        let settings_path = directory.join(UPDATE_SETTINGS_FILE);
        let mut state = SidecarState::with_update_settings_path(&settings_path);

        let defaults = route_request(&mut state, "GET", "/api/updates/settings");
        assert_eq!(defaults.status, 200);
        let defaults: Value = serde_json::from_str(&defaults.body).unwrap();
        assert_eq!(defaults["auto_check"], true);
        assert_eq!(defaults["check_interval_hours"], 24);
        assert_eq!(defaults["offline_mode"], "auto");

        let updated = route_request_with_body(
            &mut state,
            "PUT",
            "/api/updates/settings",
            br#"{"offline_mode":"on","dismissed_versions":["1.0.0"],"unknown":true}"#,
        );
        assert_eq!(updated.status, 200);
        let updated: Value = serde_json::from_str(&updated.body).unwrap();
        assert_eq!(updated["offline_mode"], "on");
        assert_eq!(updated["dismissed_versions"], json!(["1.0.0"]));
        assert_eq!(updated["github_repo"], DEFAULT_UPDATE_GITHUB_REPO);
        assert_eq!(
            offline_mode_from_update_settings(Some(&settings_path)),
            Some("on")
        );
        let serialized: Value =
            serde_yaml::from_str(&fs::read_to_string(&settings_path).unwrap()).unwrap();
        assert_eq!(serialized["offline_mode"], "on");

        let invalid = route_request_with_body(
            &mut state,
            "PUT",
            "/api/updates/settings",
            br#"{"check_interval_hours":"hourly"}"#,
        );
        assert_eq!(invalid.status, 422);
        let persisted = route_request(&mut state, "GET", "/api/updates/settings");
        assert_eq!(
            serde_json::from_str::<Value>(&persisted.body).unwrap()["offline_mode"],
            "on"
        );

        let wrong_method = route_request(&mut state, "POST", "/api/updates/settings");
        assert_eq!(wrong_method.status, 405);
        assert_eq!(
            wrong_method
                .headers
                .iter()
                .find(|(name, _)| *name == "Allow")
                .map(|(_, value)| value.as_str()),
            Some("GET, PUT")
        );

        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn native_updates_version_preserves_the_legacy_response_shape() {
        let response = native_updates_version_json(
            "0.9.1",
            &json!({
                "nirs4all_version": "0.12.0",
                "python_version": "3.11.9 (main, Apr  2 2024, 12:00:00)",
                "platform": "Linux",
                "machine": "x86_64",
            }),
        )
        .unwrap();
        assert_eq!(
            serde_json::from_str::<Value>(&response).unwrap(),
            json!({
                "webapp_version": "0.9.1",
                "nirs4all_version": "0.12.0",
                "python_version": "3.11.9 (main, Apr  2 2024, 12:00:00)",
                "platform": "Linux",
                "machine": "x86_64",
            })
        );

        let mut state = SidecarState::default();
        assert_eq!(
            route_request(&mut state, "GET", "/api/updates/version").status,
            503
        );
        assert_eq!(
            route_request(&mut state, "POST", "/api/updates/version").status,
            405
        );
    }

    #[test]
    fn native_runtime_status_preserves_the_legacy_response_shape() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let runtime = std::env::temp_dir().join(format!(
            "studio-sidecar-runtime-status-{}-{nonce}",
            std::process::id()
        ));
        let executable = runtime.join("bin/python");
        fs::create_dir_all(executable.parent().unwrap()).unwrap();
        fs::write(&executable, "placeholder runtime executable").unwrap();
        fs::write(runtime.join("pyvenv.cfg"), "home = /base\n").unwrap();
        fs::write(
            runtime.join(VENV_METADATA_FILE),
            r#"{"created_at":"2026-08-20T12:00:00","last_updated":"2026-08-30T12:00:00"}"#,
        )
        .unwrap();

        let response = native_updates_runtime_status_json(&json!({
            "path": runtime,
            "base_prefix": "/base",
            "python_executable": executable,
            "python_version": "3.11.9",
            "pip_version": "24.0",
            "nirs4all_version": null,
            "packages": [{"name": "nirs4all", "version": "0.12.0"}],
        }))
        .unwrap();
        let response: Value = serde_json::from_str(&response).unwrap();
        assert_eq!(response["runtime"], response["venv"]);
        assert_eq!(
            response["runtime"]["path"],
            runtime.to_string_lossy().as_ref()
        );
        assert_eq!(
            response["runtime"]["python_executable"],
            executable.to_string_lossy().as_ref()
        );
        assert_eq!(response["runtime"]["python_version"], "3.11.9");
        assert_eq!(response["runtime"]["pip_version"], "24.0");
        assert_eq!(response["runtime"]["created_at"], "2026-08-20T12:00:00");
        assert_eq!(response["runtime"]["last_updated"], "2026-08-30T12:00:00");
        assert!(response["runtime"]["size_bytes"].as_u64().unwrap() > 0);
        assert_eq!(
            response["packages"],
            json!([{"name": "nirs4all", "version": "0.12.0", "location": null}])
        );
        assert_eq!(response["nirs4all_version"], Value::Null);
        fs::remove_dir_all(runtime).unwrap();

        let mut state = SidecarState::default();
        assert_eq!(
            route_request(&mut state, "GET", "/api/updates/runtime/status").status,
            503
        );
        assert_eq!(
            route_request(&mut state, "POST", "/api/updates/runtime/status").status,
            405
        );
    }

    #[test]
    fn live_http_body_is_routed_to_native_app_settings() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let directory = std::env::temp_dir().join(format!(
            "studio-sidecar-http-body-{}-{nonce}",
            std::process::id()
        ));
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let state = Arc::new(Mutex::new(SidecarState::with_app_settings_dir(&directory)));
        let server_state = Arc::clone(&state);
        let server = thread::spawn(move || {
            let (stream, _) = listener.accept().unwrap();
            handle_connection_with_limits(stream, &server_state, ServerLimits::default()).unwrap();
        });
        let body = r#"{"ui_preferences":{"theme":"dark"}}"#;
        let mut client = TcpStream::connect(address).unwrap();
        client
            .write_all(
                format!(
                    "PUT /api/app/settings HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{body}",
                    body.len()
                )
                .as_bytes(),
            )
            .unwrap();
        let mut response = String::new();
        client.read_to_string(&mut response).unwrap();
        server.join().unwrap();
        assert!(response.starts_with("HTTP/1.1 200 OK\r\n"));
        let stored: Value =
            serde_json::from_str(&fs::read_to_string(directory.join("app_settings.json")).unwrap())
                .unwrap();
        assert_eq!(stored["ui_preferences"]["theme"], "dark");
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn cancellation_is_idempotent_for_an_opaque_control_job() {
        let mut state = SidecarState::default();
        let created = route_request(&mut state, "POST", "/sidecar/v1/jobs");
        assert_eq!(created.status, 202);
        assert!(created.body.contains("\"job_id\":\"job-r1-1\""));

        let first = route_request(&mut state, "POST", "/sidecar/v1/jobs/job-r1-1/cancel");
        let second = route_request(&mut state, "POST", "/sidecar/v1/jobs/job-r1-1/cancel");
        assert_eq!(first.status, 200);
        assert_eq!(first.body, second.body);
        let retrieved = route_request(&mut state, "GET", "/sidecar/v1/jobs/job-r1-1");
        assert_eq!(retrieved.status, 200);
        assert_eq!(retrieved.body, first.body);
        assert_eq!(
            serde_json::from_str::<Value>(&retrieved.body).unwrap()["cancellation_idempotent"],
            true
        );
    }

    #[test]
    fn errors_have_machine_readable_code_retryability_and_details() {
        let mut state = SidecarState::default();
        let response = route_request(&mut state, "GET", "/api/not-a-route");
        assert_eq!(response.status, 404);
        assert_eq!(
            response.body,
            "{\"error\":{\"code\":\"route_not_found\",\"message\":\"This native sidecar does not serve this Studio route\",\"retryable\":false,\"details\":{\"method\":\"GET\",\"path\":\"/api/not-a-route\"}}}"
        );
    }

    #[test]
    fn websocket_frame_constructor_enforces_fixed_validated_protocol() {
        let mut tracker = WsSequenceTracker::new();
        let envelope = WsFrame::new(
            &mut tracker,
            PROTOCOL_VERSION,
            "job:opaque",
            1,
            "2026-08-20T12:00:00Z",
            "job.cancelled",
            serde_json::json!({}),
        )
        .unwrap();
        assert_eq!(
            envelope.json(),
            "{\"protocol_version\":\"studio-sidecar-r1\",\"channel\":\"job:opaque\",\"sequence\":1,\"timestamp\":\"2026-08-20T12:00:00Z\",\"type\":\"job.cancelled\",\"data\":{}}"
        );
        assert_eq!(
            WsFrame::new(
                &mut tracker,
                PROTOCOL_VERSION,
                "job:opaque",
                1,
                "2026-08-20T12:00:01Z",
                "job.cancelled",
                serde_json::json!({}),
            ),
            Err(WsFrameError::NonMonotonicSequence)
        );
        assert_eq!(
            WsFrame::new(
                &mut tracker,
                "other",
                "job:opaque",
                2,
                "2026-08-20T12:00:01Z",
                "job.cancelled",
                serde_json::json!({}),
            ),
            Err(WsFrameError::InvalidProtocolVersion)
        );
        assert_eq!(
            WsFrame::new(
                &mut tracker,
                PROTOCOL_VERSION,
                "job:opaque",
                2,
                "not-a-timestamp",
                "job.cancelled",
                serde_json::json!({}),
            ),
            Err(WsFrameError::InvalidTimestamp)
        );
        assert_eq!(
            WsFrame::new(
                &mut tracker,
                PROTOCOL_VERSION,
                "job:opaque",
                2,
                "2026-08-20T12:00:01Z",
                "job.cancelled",
                serde_json::json!("not structured"),
            ),
            Err(WsFrameError::InvalidData)
        );
    }

    #[test]
    fn known_routes_reject_wrong_methods_with_405_and_allow_header() {
        let mut state = SidecarState::default();
        for (method, path, allow) in [
            ("POST", "/api/health", "GET"),
            ("DELETE", "/api/system/readiness", "GET"),
            ("POST", "/api/system/status", "GET"),
            ("POST", "/sidecar/v1/health", "GET"),
            ("DELETE", "/sidecar/v1/readiness", "GET"),
            ("POST", "/sidecar/v1/capabilities", "GET"),
            ("POST", "/sidecar/v1/python/preflight", "GET"),
            ("POST", "/api/system/capabilities", "GET"),
            ("POST", "/api/system/info", "GET"),
            ("POST", "/api/system/build", "GET"),
            ("POST", "/api/system/env-coherence", "GET"),
            ("GET", "/sidecar/v1/jobs", "POST"),
            ("PUT", "/sidecar/v1/jobs/job-r1-1", "GET"),
            ("GET", "/sidecar/v1/jobs/job-r1-1/cancel", "POST"),
            ("POST", "/sidecar/v1/ws", "GET"),
        ] {
            let response = route_request(&mut state, method, path);
            assert_eq!(response.status, 405, "{method} {path}");
            assert!(response
                .headers
                .iter()
                .any(|(name, value)| *name == "Allow" && value == allow));
        }
    }

    #[test]
    fn native_workspace_store_routes_reject_queries_outside_the_public_policy() {
        let mut state = SidecarState::default();
        for target in [
            "/api/workspaces/workspace-a/runs?source=unknown",
            "/api/workspaces/workspace-a/runs?refresh=yes",
            "/api/workspaces/workspace-a/runs?source=unified&source=parquet",
            "/api/workspaces/workspace-a/runs?unexpected=true",
            "/api/workspaces/workspace-a/results?limit=1",
            "/api/workspaces/workspace-a/results/summary?n=1",
        ] {
            let raw = format!("GET {target} HTTP/1.1\r\nHost: localhost\r\n\r\n");
            let request = parse_http_request(raw.as_bytes()).unwrap();
            assert!(request.query.is_some());
            let response = route_http_request(&mut state, &request);
            assert_eq!(response.status, 404);
            assert_eq!(
                serde_json::from_str::<Value>(&response.body).unwrap()["error"]["code"],
                "route_not_found"
            );
        }
    }

    #[test]
    fn native_job_routes_reject_queries_and_submission_stays_unselected() {
        let mut state = SidecarState::default();
        for target in [
            "/api/training/opaque?refresh=true",
            "/api/automl/opaque?wait=true",
            "/api/updates/webapp/download-status/opaque?poll=1",
            "/api/training/opaque/stop?force=true",
            "/api/runs/execution-job-records/opaque?refresh=true",
            "/api/runs/run-1/execution-job-record?refresh=true",
        ] {
            let raw = format!("GET {target} HTTP/1.1\r\nHost: localhost\r\n\r\n");
            let request = parse_http_request(raw.as_bytes()).unwrap();
            let response = route_http_request(&mut state, &request);
            assert_eq!(response.status, 404, "{target}");
            assert_eq!(
                serde_json::from_str::<Value>(&response.body).unwrap()["error"]["code"],
                "route_not_found"
            );
        }
        for (method, path) in [
            ("POST", "/api/training/start"),
            ("GET", "/api/training/jobs"),
            ("GET", "/api/automl/jobs"),
        ] {
            let response = route_request(&mut state, method, path);
            assert_eq!(response.status, 404, "{method} {path}");
        }
    }

    #[test]
    fn durable_execution_job_reads_use_active_store_and_never_the_memory_registry() {
        let root = test_directory("durable-execution-record");
        let config = root.join("config");
        let workspace = root.join("workspace-a");
        let run_id = "12345678-1234-5678-1234-567812345678";
        let orphan_id = "orphan-job";
        fs::create_dir_all(&config).unwrap();
        fs::create_dir_all(workspace.join("runs").join(run_id)).unwrap();
        fs::create_dir_all(workspace.join("runs").join(orphan_id)).unwrap();
        fs::copy(
            Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/workspace_store_v5.sqlite"),
            workspace.join("store.sqlite"),
        )
        .unwrap();
        let record = |id: &str, name: &str| {
            json!({
                "job_id": id,
                "job_type": "training",
                "requested_backend": "native",
                "execution_backend": "native",
                "execution_mode": "embedded-cpython",
                "status": "running",
                "progress": 25.0,
                "progress_message": "training",
                "progress_unavailable": false,
                "created_at": "2026-09-01T12:00:00Z",
                "started_at": "2026-09-01T12:00:01Z",
                "completed_at": null,
                "request": {"run_name": name},
                "driver": {"backend": "native"},
                "metrics": {},
                "error": null
            })
        };
        fs::write(
            workspace
                .join("runs")
                .join(run_id)
                .join("execution_job_record.json"),
            serde_json::to_vec(&record(run_id, "request name")).unwrap(),
        )
        .unwrap();
        fs::write(
            workspace
                .join("runs")
                .join(orphan_id)
                .join("execution_job_record.json"),
            serde_json::to_vec(&record(orphan_id, "Orphaned scheduler job")).unwrap(),
        )
        .unwrap();
        fs::write(
            config.join("app_settings.json"),
            json!({
                "linked_workspaces": [linked_workspace_record("workspace-a", &workspace, true, 1)]
            })
            .to_string(),
        )
        .unwrap();
        let mut state = SidecarState::with_app_settings_dir(&config);

        let by_job = route_request(
            &mut state,
            "GET",
            &format!("/api/runs/execution-job-records/{run_id}"),
        );
        assert_eq!(by_job.status, 200);
        let by_job: Value = serde_json::from_str(&by_job.body).unwrap();
        assert_eq!(by_job["run_id"], run_id);
        assert_eq!(by_job["run_name"], "native scanner parity");
        assert_eq!(by_job["run_status"], "completed");
        assert_eq!(by_job["is_orphaned"], false);

        let by_run = route_request(
            &mut state,
            "GET",
            &format!("/api/runs/{run_id}/execution-job-record"),
        );
        assert_eq!(by_run.status, 200);
        assert_eq!(serde_json::from_str::<Value>(&by_run.body).unwrap(), by_job);

        let orphan = route_request(
            &mut state,
            "GET",
            &format!("/api/runs/execution-job-records/{orphan_id}"),
        );
        assert_eq!(orphan.status, 200);
        let orphan: Value = serde_json::from_str(&orphan.body).unwrap();
        assert_eq!(orphan["run_name"], "Orphaned scheduler job");
        assert_eq!(orphan["run_status"], "orphaned");
        assert_eq!(orphan["is_orphaned"], true);

        let missing_run =
            route_request(&mut state, "GET", "/api/runs/missing/execution-job-record");
        assert_eq!(missing_run.status, 404);
        let wrong_method = route_request(
            &mut state,
            "POST",
            &format!("/api/runs/{run_id}/execution-job-record"),
        );
        assert_eq!(wrong_method.status, 405);
        assert_eq!(wrong_method.headers[0], ("Allow", "GET".into()));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn websocket_426_requires_a_valid_upgrade_and_is_not_retryable() {
        let mut state = SidecarState::default();
        let ordinary = route_request(&mut state, "GET", "/sidecar/v1/ws");
        assert_eq!(ordinary.status, 400);
        let valid_upgrade = HttpRequest {
            method: "GET".into(),
            path: "/sidecar/v1/ws".into(),
            query: None,
            headers: BTreeMap::from([
                ("upgrade".into(), "websocket".into()),
                ("connection".into(), "keep-alive, Upgrade".into()),
                (
                    "sec-websocket-key".into(),
                    "dGhlIHNhbXBsZSBub25jZQ==".into(),
                ),
                ("sec-websocket-version".into(), "13".into()),
            ]),
            body: Vec::new(),
        };
        let response = route_http_request(&mut state, &valid_upgrade);
        assert_eq!(response.status, 426);
        let json: Value = serde_json::from_str(&response.body).unwrap();
        assert_eq!(json["error"]["code"], "websocket_upgrade_required");
        assert_eq!(json["error"]["retryable"], false);
        assert_eq!(json["error"]["details"]["websocket_upgrade"], "unavailable");
    }

    #[test]
    fn websocket_invalid_keys_are_ordinary_400_responses_in_the_unit_route() {
        for key in [None, Some(""), Some("not-base64"), Some("aGVsbG8=")] {
            let mut headers = BTreeMap::from([
                ("upgrade".into(), "websocket".into()),
                ("connection".into(), "Upgrade".into()),
                ("sec-websocket-version".into(), "13".into()),
            ]);
            if let Some(key) = key {
                headers.insert("sec-websocket-key".into(), key.into());
            }
            let request = HttpRequest {
                method: "GET".into(),
                path: "/sidecar/v1/ws".into(),
                query: None,
                headers,
                body: Vec::new(),
            };
            let mut state = SidecarState::default();
            let response = route_http_request(&mut state, &request);
            assert_eq!(response.status, 400, "invalid key: {key:?}");
            let body: Value = serde_json::from_str(&response.body).unwrap();
            assert_eq!(body["error"]["code"], "invalid_request");
            assert_eq!(body["error"]["retryable"], false);
        }
    }

    #[test]
    fn websocket_invalid_keys_are_ordinary_400_responses_over_live_tcp() {
        for key in ["", "not-base64", "aGVsbG8="] {
            let listener = TcpListener::bind("127.0.0.1:0").unwrap();
            let address = listener.local_addr().unwrap();
            let state = Arc::new(Mutex::new(SidecarState::default()));
            let server = thread::spawn(move || {
                let (stream, _) = listener.accept().unwrap();
                handle_connection_with_limits(stream, &state, ServerLimits::default()).unwrap();
            });

            let mut client = TcpStream::connect(address).unwrap();
            let request = format!(
                "GET /sidecar/v1/ws HTTP/1.1\r\nHost: localhost\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: {key}\r\n\r\n"
            );
            client.write_all(request.as_bytes()).unwrap();
            let mut response = String::new();
            client.read_to_string(&mut response).unwrap();
            server.join().unwrap();
            assert!(
                response.starts_with("HTTP/1.1 400 Bad Request\r\n"),
                "invalid key: {key}"
            );
            assert!(response.contains("\"code\":\"invalid_request\""));
            assert!(response.contains("\"retryable\":false"));
        }
    }

    #[test]
    fn legacy_job_websocket_upgrade_is_live_through_the_http_accept_path() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let state = Arc::new(Mutex::new(SidecarState::default()));
        let manager = Arc::new(WebSocketConnectionManager::new());
        let server_manager = Arc::clone(&manager);
        let server = thread::spawn(move || {
            let (stream, _) = listener.accept().unwrap();
            handle_connection_with_limits_and_websocket(
                stream,
                &state,
                &server_manager,
                ServerLimits::default(),
            )
            .unwrap();
        });

        let stream = TcpStream::connect(address).unwrap();
        let (mut client, response) =
            tungstenite::client(format!("ws://{address}/ws/job/opaque-1"), stream).unwrap();
        assert_eq!(response.status(), 101);
        let connected: Value =
            serde_json::from_str(client.read().unwrap().into_text().unwrap().as_str()).unwrap();
        assert_eq!(connected["type"], "connected");
        assert_eq!(connected["data"]["client_id"], "job-opaque-1");
        let subscribed: Value =
            serde_json::from_str(client.read().unwrap().into_text().unwrap().as_str()).unwrap();
        assert_eq!(subscribed["type"], "subscribed");
        assert_eq!(subscribed["channel"], "job:opaque-1");
        client.close(None).unwrap();
        server.join().unwrap();
        assert_eq!(manager.connection_count(), 0);
    }

    #[test]
    fn live_http_cancellation_publishes_one_exact_failure_on_the_shared_job_socket() {
        let runtime = Arc::new(job_http::NativeJobRuntime::with_executor(Arc::new(
            SelectedTestJobExecutor,
        )));
        runtime
            .register_with_id_at(
                "pending-live",
                job_lifecycle::JobType::Training,
                json!({"folds": 5}),
                "2026-09-01T12:00:00Z",
                Instant::now(),
            )
            .unwrap();
        let manager = runtime.websocket_manager();
        let state = Arc::new(Mutex::new(SidecarState::with_native_jobs(Arc::clone(
            &runtime,
        ))));
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let server_state = Arc::clone(&state);
        let server_manager = Arc::clone(&manager);
        let server = thread::spawn(move || {
            let (websocket_stream, _) = listener.accept().unwrap();
            let websocket_state = Arc::clone(&server_state);
            let websocket_manager = Arc::clone(&server_manager);
            let websocket = thread::spawn(move || {
                handle_connection_with_limits_and_websocket(
                    websocket_stream,
                    &websocket_state,
                    &websocket_manager,
                    ServerLimits::default(),
                )
                .unwrap();
            });
            let (http_stream, _) = listener.accept().unwrap();
            handle_connection_with_limits_and_websocket(
                http_stream,
                &server_state,
                &server_manager,
                ServerLimits::default(),
            )
            .unwrap();
            websocket.join().unwrap();
        });

        let stream = TcpStream::connect(address).unwrap();
        let (mut websocket, response) =
            tungstenite::client(format!("ws://{address}/ws/job/pending-live"), stream).unwrap();
        assert_eq!(response.status(), 101);
        let _: Value =
            serde_json::from_str(websocket.read().unwrap().into_text().unwrap().as_str()).unwrap();
        let _: Value =
            serde_json::from_str(websocket.read().unwrap().into_text().unwrap().as_str()).unwrap();

        let mut http = TcpStream::connect(address).unwrap();
        http.write_all(
            b"POST /api/training/pending-live/stop HTTP/1.1\r\nHost: localhost\r\nContent-Length: 0\r\n\r\n",
        )
        .unwrap();
        let mut http_response = String::new();
        http.read_to_string(&mut http_response).unwrap();
        assert!(http_response.starts_with("HTTP/1.1 200 OK\r\n"));
        assert!(http_response.contains("\"status\":\"cancelled\""));

        let terminal: Value =
            serde_json::from_str(websocket.read().unwrap().into_text().unwrap().as_str()).unwrap();
        assert_eq!(terminal["type"], "job_failed");
        assert_ne!(terminal["type"], "job_cancelled");
        assert_eq!(terminal["channel"], "job:pending-live");
        assert_eq!(terminal["data"]["error"], "Job was cancelled");
        assert_eq!(
            terminal
                .as_object()
                .unwrap()
                .keys()
                .map(String::as_str)
                .collect::<std::collections::BTreeSet<_>>(),
            std::collections::BTreeSet::from(["type", "channel", "data", "timestamp"])
        );
        assert!(terminal.get("sequence").is_none());
        assert!(terminal.get("protocol_version").is_none());

        websocket.close(None).unwrap();
        server.join().unwrap();
        assert_eq!(manager.connection_count(), 0);
        assert_eq!(
            runtime
                .get_at("pending-live", Instant::now())
                .unwrap()
                .status,
            job_lifecycle::JobStatus::Cancelled
        );
    }

    #[test]
    fn job_storage_evicts_expired_or_cancelled_records_then_refuses_pending_records() {
        let now = Instant::now();
        let mut state = SidecarState::with_job_limits(2, Duration::from_secs(10));
        let first = state.create_control_job_at(now).unwrap();
        let second = state.create_control_job_at(now).unwrap();
        state.cancel_job(&first.id).unwrap();
        let third = state
            .create_control_job_at(now + Duration::from_secs(1))
            .unwrap();
        assert_eq!(third.id, "job-r1-3");
        assert!(!state.jobs.contains_key(&first.id));
        assert!(state.jobs.contains_key(&second.id));
        assert!(state
            .create_control_job_at(now + Duration::from_secs(2))
            .is_err());

        let mut expiring = SidecarState::with_job_limits(1, Duration::from_secs(1));
        let expired = expiring.create_control_job_at(now).unwrap();
        let replacement = expiring
            .create_control_job_at(now + Duration::from_secs(1))
            .unwrap();
        assert_ne!(expired.id, replacement.id);
        assert!(!expiring.jobs.contains_key(&expired.id));
    }

    #[test]
    fn parser_handles_a_live_fragmented_request_and_times_out_slow_headers() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let state = Arc::new(Mutex::new(SidecarState::default()));
        let state_for_server = Arc::clone(&state);
        let server = thread::spawn(move || {
            let (stream, _) = listener.accept().unwrap();
            handle_connection_with_limits(
                stream,
                &state_for_server,
                ServerLimits {
                    header_timeout: Duration::from_millis(250),
                    read_timeout: Duration::from_millis(100),
                    write_timeout: Duration::from_millis(100),
                    max_connections: 1,
                },
            )
            .unwrap();
        });
        let mut client = TcpStream::connect(address).unwrap();
        client.write_all(b"GET /sidecar/v1/hea").unwrap();
        thread::sleep(Duration::from_millis(10));
        client
            .write_all(b"lth HTTP/1.1\r\nHost: localhost\r\n\r\n")
            .unwrap();
        let mut response = String::new();
        client.read_to_string(&mut response).unwrap();
        server.join().unwrap();
        assert!(response.starts_with("HTTP/1.1 200 OK\r\n"));

        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let state = Arc::new(Mutex::new(SidecarState::default()));
        let slow_server = thread::spawn(move || {
            let (stream, _) = listener.accept().unwrap();
            handle_connection_with_limits(
                stream,
                &state,
                ServerLimits {
                    header_timeout: Duration::from_millis(100),
                    read_timeout: Duration::from_millis(25),
                    write_timeout: Duration::from_millis(100),
                    max_connections: 1,
                },
            )
            .unwrap();
        });
        let mut client = TcpStream::connect(address).unwrap();
        client.write_all(b"GET /sidecar/v1/health").unwrap();
        let mut response = String::new();
        client.read_to_string(&mut response).unwrap();
        slow_server.join().unwrap();
        assert!(response.starts_with("HTTP/1.1 408 Request Timeout\r\n"));
    }

    #[test]
    fn connection_gate_never_exceeds_its_configured_limit() {
        let gate = Arc::new(ConnectionGate {
            active: AtomicUsize::new(0),
            limit: 1,
        });
        let permit = gate.try_acquire().unwrap();
        assert!(gate.try_acquire().is_none());
        drop(permit);
        assert!(gate.try_acquire().is_some());
    }

    #[test]
    fn archive_v2_prediction_product_default_is_typed_unavailable_before_parsing() {
        let mut state = SidecarState::default();
        let response = route_request_with_body(
            &mut state,
            "POST",
            ARCHIVE_V2_PREDICTION_ROUTE,
            b"not-json-and-must-not-be-parsed",
        );
        assert_eq!(response.status, 503);
        let body: Value = serde_json::from_str(&response.body).unwrap();
        assert_eq!(body["error"]["code"], "archive_v2_prediction_unavailable");
        assert_eq!(body["error"]["details"]["reason"], "executor_not_selected");
        assert_eq!(
            serde_json::from_str::<Value>(&state.capabilities_json()).unwrap()["features"]
                ["native_archive_v2_prediction"],
            false
        );

        let method = route_request(&mut state, "GET", ARCHIVE_V2_PREDICTION_ROUTE);
        assert_eq!(method.status, 405);
        let near_match = route_request(&mut state, "POST", "/api/predict/archive-v2/");
        assert_eq!(near_match.status, 404);

        let query = parse_http_request(
            b"POST /api/predict/archive-v2?retry=true HTTP/1.1\r\nHost: localhost\r\nContent-Length: 0\r\n\r\n",
        )
        .unwrap();
        let query = route_http_request(&mut state, &query);
        assert_eq!(query.status, 404);
        assert_eq!(
            serde_json::from_str::<Value>(&query.body).unwrap()["error"]["code"],
            "route_not_found"
        );
    }

    #[test]
    fn archive_v2_route_preserves_legacy_predict_refusals_byte_for_byte() {
        let mut state = SidecarState::default();
        let predict = route_request_with_body(&mut state, "POST", "/api/predict", b"{}");
        let predict_file = route_request_with_body(&mut state, "POST", "/api/predict/file", b"{}");

        assert_eq!(predict.status, 404);
        assert_eq!(
            predict.body,
            "{\"error\":{\"code\":\"route_not_found\",\"message\":\"This native sidecar does not serve this Studio route\",\"retryable\":false,\"details\":{\"method\":\"POST\",\"path\":\"/api/predict\"}}}"
        );
        assert_eq!(predict_file.status, 404);
        assert_eq!(
            predict_file.body,
            "{\"error\":{\"code\":\"route_not_found\",\"message\":\"This native sidecar does not serve this Studio route\",\"retryable\":false,\"details\":{\"method\":\"POST\",\"path\":\"/api/predict/file\"}}}"
        );
    }

    #[test]
    fn archive_v2_fake_route_uses_persisted_workspace_and_exact_export_ref() {
        let root = test_directory("archive-v2-fake-route");
        let config = root.join("config");
        let workspace = root.join("workspace");
        let archive = workspace.join("exports/models/model-a.n4a");
        fs::create_dir_all(&config).unwrap();
        fs::create_dir_all(archive.parent().unwrap()).unwrap();
        fs::write(&archive, b"fake-archive-v2").unwrap();
        fs::write(
            config.join("app_settings.json"),
            json!({
                "linked_workspaces": [linked_workspace_record("workspace-a", &workspace, true, 0)]
            })
            .to_string(),
        )
        .unwrap();
        let digest = format!("{:x}", Sha256::digest(b"fake-archive-v2"));
        let body = json!({
            "schema_version": 1,
            "operation": "archive_v2_predict",
            "workspace_id": "workspace-a",
            "archive": {"ref": "models/model-a.n4a", "sha256": digest},
            "input": {
                "kind": "array",
                "sample_ids": ["s1", "s2"],
                "x": [[1.0, 2.0], [3.0, 4.0]],
                "expected_target_names": ["protein", "moisture"]
            },
            "execution": {"engine": "core_rust_methods", "allow_fallback": false}
        })
        .to_string();
        let mut state = SidecarState::with_archive_v2_prediction_executor_and_app_settings_dir(
            Arc::new(SelectedArchiveV2TestExecutor),
            &config,
        );

        let response = route_request_with_body(
            &mut state,
            "POST",
            ARCHIVE_V2_PREDICTION_ROUTE,
            body.as_bytes(),
        );

        assert_eq!(response.status, 200);
        let response: Value = serde_json::from_str(&response.body).unwrap();
        assert_eq!(response["engine"], "core_rust_methods");
        assert_eq!(response["fallback_used"], false);
        assert_eq!(response["sample_ids"], json!(["s1", "s2"]));
        assert_eq!(response["target_names"], json!(["protein", "moisture"]));
        assert_eq!(response["values"], json!([[1.5, 13.0], [2.5, 15.0]]));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    #[ignore = "requires N4A_RT_PRED_ARCHIVE_V2, N4A_RT_PRED_METHODS_LIBRARY and N4A_RT_PRED_METHODS_SHA256"]
    fn archive_v2_real_core_route_predicts_multitarget_without_python_or_fallback() {
        let source_archive = PathBuf::from(
            std::env::var("N4A_RT_PRED_ARCHIVE_V2")
                .expect("N4A_RT_PRED_ARCHIVE_V2 must name the Core Archive V2 witness"),
        );
        let methods_path = PathBuf::from(
            std::env::var("N4A_RT_PRED_METHODS_LIBRARY")
                .expect("N4A_RT_PRED_METHODS_LIBRARY must name the packaged libn4m witness"),
        );
        let methods_sha256 = std::env::var("N4A_RT_PRED_METHODS_SHA256")
            .expect("N4A_RT_PRED_METHODS_SHA256 must attest the libn4m witness");
        let methods_size = fs::metadata(&methods_path).unwrap().len();
        let root = test_directory("archive-v2-real-core-route");
        let config = root.join("config");
        let workspace = root.join("workspace");
        let archive = workspace.join("exports/models/model-a.n4a");
        fs::create_dir_all(&config).unwrap();
        fs::create_dir_all(archive.parent().unwrap()).unwrap();
        fs::copy(source_archive, &archive).unwrap();
        fs::write(
            config.join("app_settings.json"),
            json!({
                "linked_workspaces": [linked_workspace_record("workspace-a", &workspace, true, 0)]
            })
            .to_string(),
        )
        .unwrap();
        let archive_bytes = fs::read(&archive).unwrap();
        let archive_sha256 = format!("{:x}", Sha256::digest(&archive_bytes));
        let executor = archive_v2_prediction::CoreArchiveV2PredictionExecutor::acquire(
            archive_v2_prediction::PackagedMethodsLibraryIdentity {
                path: methods_path,
                size: methods_size,
                sha256: methods_sha256.clone(),
                abi_major: 2,
                abi_minor: 3,
            },
        )
        .expect("the exact ABI 2.3 libn4m witness must preflight");
        let mut state = SidecarState::with_archive_v2_prediction_executor_and_app_settings_dir(
            Arc::new(executor),
            &config,
        );
        let body = json!({
            "schema_version": 1,
            "operation": "archive_v2_predict",
            "workspace_id": "workspace-a",
            "archive": {"ref": "models/model-a.n4a", "sha256": archive_sha256},
            "input": {
                "kind": "array",
                "sample_ids": ["predict.0", "predict.1"],
                "x": [[1.5, 0.5], [3.5, 1.5]],
                "expected_target_names": ["protein", "moisture"]
            },
            "execution": {"engine": "core_rust_methods", "allow_fallback": false}
        })
        .to_string();

        let response = route_request_with_body(
            &mut state,
            "POST",
            ARCHIVE_V2_PREDICTION_ROUTE,
            body.as_bytes(),
        );

        assert_eq!(response.status, 200, "{}", response.body);
        let response: Value = serde_json::from_str(&response.body).unwrap();
        assert_eq!(response["engine"], "core_rust_methods");
        assert_eq!(response["fallback_used"], false);
        assert_eq!(response["sample_ids"], json!(["predict.0", "predict.1"]));
        assert_eq!(response["target_names"], json!(["protein", "moisture"]));
        assert_eq!(
            response["provenance"]["executor"],
            format!("nirs4all-core@0.3.25+libn4m-abi-2.3:{methods_sha256}")
        );
        let expected = [
            [1.636_363_636_363_636_5, 13.272_727_272_727_273],
            [2.499_999_999_999_999_6, 15.0],
        ];
        for (actual_row, expected_row) in
            response["values"].as_array().unwrap().iter().zip(expected)
        {
            for (actual, expected) in actual_row.as_array().unwrap().iter().zip(expected_row) {
                assert!((actual.as_f64().unwrap() - expected).abs() <= 1.0e-9);
            }
        }
        assert_eq!(
            serde_json::from_str::<Value>(&state.capabilities_json()).unwrap()["features"]
                ["native_archive_v2_prediction"],
            true
        );
        fs::remove_dir_all(root).unwrap();
    }
}
