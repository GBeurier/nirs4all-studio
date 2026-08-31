//! Studio's deliberately small, local-only R1 sidecar contract.
//!
//! This crate owns control-plane scaffolding, not NIRS computation or the
//! legacy `FastAPI` surface. See `../README.md` for the external contract.

use std::{
    collections::BTreeMap,
    env,
    fmt::Write as _,
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};

use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde_json::{json, Value};

mod settings;

use settings::AppSettingsStore;

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
pub const PYTHON_PLUGIN_HOST_ENV: &str = "NIRS4ALL_PYTHON_PLUGIN_HOST";
pub const PYTHON_PLUGIN_HOST_BUNDLED_ENV: &str = "NIRS4ALL_PYTHON_PLUGIN_HOST_BUNDLED";
pub const RUNTIME_KIND_ENV: &str = "NIRS4ALL_RUNTIME_KIND";
pub const PYTHON_PLUGIN_PREFLIGHT_TIMEOUT: Duration = Duration::from_secs(3);
pub const PYTHON_PLUGIN_CAPABILITIES_TIMEOUT: Duration = Duration::from_secs(15);
pub const MAX_PYTHON_PLUGIN_OUTPUT_BYTES: usize = 8 * 1024;
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
    runtime_kind: String,
    app_settings: AppSettingsStore,
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
            runtime_kind: "python_plugin_host".into(),
            app_settings: AppSettingsStore::from_environment(),
        }
    }
}

impl SidecarState {
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
        let runtime_kind = env::var(RUNTIME_KIND_ENV)
            .ok()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| "python_plugin_host".into());
        Self {
            python_plugin_host,
            python_plugin_host_bundled,
            runtime_kind,
            app_settings: AppSettingsStore::from_environment(),
            ..Self::default()
        }
    }

    #[must_use]
    pub fn with_python_plugin_host(path: impl Into<PathBuf>) -> Self {
        Self {
            python_plugin_host: Some(path.into()),
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

    #[must_use]
    pub fn readiness_json(&self) -> String {
        format!(
            "{{\"sidecar_ready\":true,\"protocol_version\":\"{PROTOCOL_VERSION}\",\"legacy_contract_baseline\":\"{LEGACY_CONTRACT_BASELINE}\",\"legacy_route_parity\":\"{LEGACY_ROUTE_PARITY}\",\"scientific_execution\":\"unavailable\",\"job_execution\":\"unavailable\",\"uptime_ms\":{}}}",
            self.started_at.elapsed().as_millis()
        )
    }

    #[must_use]
    pub fn health_json(&self) -> String {
        format!(
            "{{\"status\":\"healthy\",\"sidecar_ready\":true,\"protocol_version\":\"{PROTOCOL_VERSION}\",\"legacy_contract_baseline\":\"{LEGACY_CONTRACT_BASELINE}\",\"scientific_execution\":\"unavailable\"}}"
        )
    }

    #[must_use]
    pub fn capabilities_json(&self) -> String {
        let python_plugin_configured = self.python_plugin_host.is_some();
        format!(
            "{{\"protocol_version\":\"{PROTOCOL_VERSION}\",\"legacy_contract_baseline\":\"{LEGACY_CONTRACT_BASELINE}\",\"legacy_route_parity\":\"{LEGACY_ROUTE_PARITY}\",\"api_route_coverage\":\"bootstrap_system_and_app_settings\",\"python_plugin_host\":\"{}\",\"features\":{{\"health\":true,\"readiness\":true,\"control_jobs\":true,\"websocket_upgrade\":false,\"scientific_execution\":false,\"legacy_api_routes\":false,\"unmigrated_api_routes_require_legacy_backend\":true,\"app_settings_routes\":true,\"system_capabilities_route\":true,\"system_info_route\":true,\"system_env_coherence_route\":true,\"python_plugin_preflight\":{python_plugin_configured},\"python_plugin_execution\":false}}}}",
            if python_plugin_configured {
                "configured"
            } else {
                "unconfigured"
            },
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
pub fn route_request_with_body(
    state: &mut SidecarState,
    method: &str,
    path: &str,
    body: &[u8],
) -> HttpResponse {
    match (method, path) {
        ("GET", "/api/health") => HttpResponse::json(200, SidecarState::legacy_health_json()),
        ("GET", "/api/system/readiness") => HttpResponse::json(200, state.legacy_readiness_json()),
        ("GET", "/api/app/settings") => app_settings_response(state),
        ("PUT", "/api/app/settings") => update_app_settings_response(state, body),
        ("GET", "/api/app/favorites") => app_favourites_response(state),
        ("POST", "/api/app/favorites") => add_app_favourite_response(state, body),
        ("GET", "/sidecar/v1/health") => HttpResponse::json(200, state.health_json()),
        ("GET", "/sidecar/v1/readiness") => HttpResponse::json(200, state.readiness_json()),
        ("GET", "/sidecar/v1/capabilities") => HttpResponse::json(200, state.capabilities_json()),
        ("GET", "/sidecar/v1/python/preflight") => python_plugin_preflight_response(state),
        ("GET", "/api/system/capabilities") => python_capabilities_response(state),
        ("GET", "/api/system/info") => python_system_info_response(state),
        ("GET", "/api/system/env-coherence") => python_env_coherence_response(state),
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
            | "/api/system/readiness"
            | "/sidecar/v1/health"
            | "/sidecar/v1/readiness"
            | "/sidecar/v1/capabilities"
            | "/sidecar/v1/python/preflight"
            | "/api/system/capabilities"
            | "/api/system/info"
            | "/api/system/env-coherence"
            | "/sidecar/v1/ws",
        ) => method_not_allowed(method, path, "GET"),
        (_, "/api/app/settings") => method_not_allowed(method, path, "GET, PUT"),
        (_, "/api/app/favorites") => method_not_allowed(method, path, "GET, POST"),
        (_, "/sidecar/v1/jobs") => method_not_allowed(method, path, "POST"),
        _ if path.starts_with("/api/app/favorites/") => route_app_favourite(state, method, path),
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

fn app_settings_response(state: &SidecarState) -> HttpResponse {
    match state.app_settings.response() {
        Ok(settings) => HttpResponse::json(200, settings.to_string()),
        Err(error) => app_settings_storage_error("get app settings", &error),
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
        .args(["-I", "-c", "import nirs4all"])
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
    let mut child = Command::new(python_plugin_host)
        .args(["-I", "-c", script])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|_| PythonPluginBridgeFailure::SpawnFailed)?;
    let stdout = child
        .stdout
        .take()
        .ok_or(PythonPluginBridgeFailure::OutputReadFailed)?;
    let reader = std::thread::spawn(move || read_bounded_stdout(stdout));
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

fn read_bounded_stdout(mut stdout: std::process::ChildStdout) -> std::io::Result<(Vec<u8>, bool)> {
    let mut retained = Vec::with_capacity(MAX_PYTHON_PLUGIN_OUTPUT_BYTES);
    let mut buffer = [0_u8; 1024];
    let mut exceeded = false;
    loop {
        let read = stdout.read(&mut buffer)?;
        if read == 0 {
            return Ok((retained, exceeded));
        }
        let remaining = MAX_PYTHON_PLUGIN_OUTPUT_BYTES.saturating_sub(retained.len());
        let copied = remaining.min(read);
        retained.extend_from_slice(&buffer[..copied]);
        exceeded |= copied < read;
    }
}

fn route_http_request(state: &mut SidecarState, request: &HttpRequest) -> HttpResponse {
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
                std::thread::spawn(move || {
                    let _permit = permit;
                    if let Err(error) = handle_connection_with_limits(stream, &state, limits) {
                        eprintln!("studio-sidecar connection error: {error}");
                    }
                });
            }
            Err(error) => eprintln!("studio-sidecar accept error: {error}"),
        }
    }
    Ok(())
}

fn handle_connection_with_limits(
    mut stream: TcpStream,
    state: &Arc<Mutex<SidecarState>>,
    limits: ServerLimits,
) -> std::io::Result<()> {
    stream.set_read_timeout(Some(limits.read_timeout))?;
    stream.set_write_timeout(Some(limits.write_timeout))?;
    let response = match read_http_request(&mut stream, limits.header_timeout) {
        Ok(request) => {
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
        Err(RequestReadError::BodyTooLarge) => error_response(
            400,
            ErrorCode::InvalidRequest,
            "Request body exceeds the configured limit",
            BTreeMap::new(),
        ),
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
    BodyTooLarge,
    Invalid,
    Io(std::io::Error),
}

#[derive(Debug)]
struct HttpRequest {
    method: String,
    path: String,
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
            return Err(RequestReadError::BodyTooLarge);
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
    Ok(HttpRequest {
        method: method.to_owned(),
        path: target.split('?').next().unwrap_or(target).to_owned(),
        headers,
        body: Vec::new(),
    })
}

fn write_response(stream: &mut TcpStream, response: &HttpResponse) -> std::io::Result<()> {
    let reason = match response.status {
        200 => "OK",
        202 => "Accepted",
        400 => "Bad Request",
        408 => "Request Timeout",
        422 => "Unprocessable Content",
        429 => "Too Many Requests",
        404 => "Not Found",
        405 => "Method Not Allowed",
        426 => "Upgrade Required",
        503 => "Service Unavailable",
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
    use std::{
        fs,
        net::TcpListener,
        thread,
        time::{SystemTime, UNIX_EPOCH},
    };

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
    fn python_plugin_preflight_is_explicit_and_never_enables_scientific_execution() {
        let mut unconfigured = SidecarState::default();
        let capabilities: Value = serde_json::from_str(&unconfigured.capabilities_json()).unwrap();
        assert_eq!(capabilities["python_plugin_host"], "unconfigured");
        assert_eq!(
            capabilities["api_route_coverage"],
            "bootstrap_system_and_app_settings"
        );
        assert_eq!(capabilities["features"]["app_settings_routes"], true);
        assert_eq!(capabilities["features"]["legacy_api_routes"], false);
        assert_eq!(
            capabilities["features"]["unmigrated_api_routes_require_legacy_backend"],
            true
        );
        assert_eq!(capabilities["features"]["system_info_route"], true);
        assert_eq!(capabilities["features"]["python_plugin_preflight"], false);
        assert_eq!(capabilities["features"]["python_plugin_execution"], false);

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

        let unavailable_runtime =
            route_request(&mut unconfigured, "GET", "/api/system/env-coherence");
        assert_eq!(unavailable_runtime.status, 503);

        let missing_host = std::env::temp_dir().join(format!(
            "n4a-sidecar-missing-python-host-{}",
            std::process::id()
        ));
        let mut configured = SidecarState::with_python_plugin_host(missing_host);
        let configured_capabilities: Value =
            serde_json::from_str(&configured.capabilities_json()).unwrap();
        assert_eq!(configured_capabilities["python_plugin_host"], "configured");
        assert_eq!(
            configured_capabilities["features"]["python_plugin_preflight"],
            true
        );
        assert_eq!(
            configured_capabilities["features"]["scientific_execution"],
            false
        );

        let failed = route_request(&mut configured, "GET", "/sidecar/v1/python/preflight");
        assert_eq!(failed.status, 503);
        let failed_body: Value = serde_json::from_str(&failed.body).unwrap();
        assert_eq!(
            failed_body["error"]["code"],
            "python_plugin_preflight_failed"
        );
        assert_eq!(failed_body["error"]["details"]["reason"], "spawn_failed");
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
            ("POST", "/sidecar/v1/health", "GET"),
            ("DELETE", "/sidecar/v1/readiness", "GET"),
            ("POST", "/sidecar/v1/capabilities", "GET"),
            ("POST", "/sidecar/v1/python/preflight", "GET"),
            ("POST", "/api/system/capabilities", "GET"),
            ("POST", "/api/system/info", "GET"),
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
    fn websocket_426_requires_a_valid_upgrade_and_is_not_retryable() {
        let mut state = SidecarState::default();
        let ordinary = route_request(&mut state, "GET", "/sidecar/v1/ws");
        assert_eq!(ordinary.status, 400);
        let valid_upgrade = HttpRequest {
            method: "GET".into(),
            path: "/sidecar/v1/ws".into(),
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
}
