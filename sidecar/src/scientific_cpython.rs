//! Bounded `CPython` host: fresh training jobs and reusable interactive workers.
//!
//! The stdio worker and Rust-owned terminal callback are implemented here,
//! with explicit native job lifecycle and document translation through the
//! adapters shipped with the application. Python never owns HTTP, jobs, events, cancellation or scheduling.
//! The scientific library may persist its own WorkspaceStore/results only to
//! the workspace authorized by the Rust request resolver.

use std::{
    collections::BTreeMap,
    ffi::OsStr,
    fs,
    io::{Read, Write},
    path::{Component, Path, PathBuf},
    process::{Command, Stdio},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant, SystemTime},
};

use serde_json::Value;

use crate::job_http::{
    JobExecutorError, ScientificExecutionRequest, ScientificExecutorSelection,
    ScientificJobExecutor, ScientificJobTerminal, ScientificSubmissionPreflight,
};
use crate::scientific_request_resolver::ScientificRequestResolver;

#[path = "warm_library_host.rs"]
mod warm_library_host;

static NEXT_DATASET_CACHE_SCOPE: AtomicU64 = AtomicU64::new(1);

/// Opt-in timing: static phase names, no scientific data or paths.
pub(crate) struct BoundaryTiming {
    phase: &'static str,
    started: Option<Instant>,
}

impl BoundaryTiming {
    pub(crate) fn start(phase: &'static str) -> Self {
        Self {
            phase,
            started: (performance_diagnostics_enabled()
                || matches!(std::env::var("CI").as_deref(), Ok("true" | "1")))
            .then(Instant::now),
        }
    }
}

fn performance_diagnostics_enabled() -> bool {
    matches!(
        std::env::var("NIRS4ALL_STUDIO_PERF").as_deref(),
        Ok("true" | "1")
    )
}

impl Drop for BoundaryTiming {
    fn drop(&mut self) {
        if let Some(started) = self.started {
            // Diagnostic I/O failure must not change the guarded operation.
            let _ = writeln!(
                std::io::stderr().lock(),
                "Studio boundary timing phase={} elapsed_us={}",
                self.phase,
                started.elapsed().as_micros()
            );
        }
    }
}

pub const SCIENTIFIC_CPYTHON_EXECUTOR_ID: &str = "cpython-stdio-v1";
pub const WINDOWS_SCIENTIFIC_JOB_LAUNCHER_ARGUMENT: &str = "--internal-scientific-cpython-job";
/// Budget for acquiring the scientific host: one cold import of nirs4all.
///
/// Antivirus scans and a cold disk cache made valid first imports take 38 s on
/// Windows (and minutes in field reports). Acquisition runs after the sidecar
/// is ready, so this budget never delays the window; a timeout is retried.
pub const SCIENTIFIC_CPYTHON_ACQUISITION_TIMEOUT: Duration = Duration::from_secs(180);
/// Document adapters import the same scientific stack in each fresh worker.
pub const SCIENTIFIC_CPYTHON_DOCUMENT_TIMEOUT: Duration = Duration::from_secs(45);
pub const SCIENTIFIC_CPYTHON_EXECUTION_TIMEOUT: Duration = Duration::from_secs(120);
// Training campaigns are cancellable, isolated from interactive readers and
// report progress through the heartbeat. Their budget must accommodate the
// shipped benchmark presets (Complex PLS runs for several hours).
pub const SCIENTIFIC_CPYTHON_TRAINING_TIMEOUT: Duration = Duration::from_secs(86_400);
pub const MAX_SCIENTIFIC_CPYTHON_STDIN_BYTES: usize = 64 * 1024;
pub const MAX_SCIENTIFIC_CPYTHON_STDOUT_BYTES: usize = 8 * 1024;
pub const MAX_SCIENTIFIC_CPYTHON_STDERR_BYTES: usize = 64 * 1024;
pub const MAX_GENERAL_SCIENTIFIC_STDIN_BYTES: usize = 8 * 1024 * 1024;
pub const MAX_GENERAL_SCIENTIFIC_STDOUT_BYTES: usize = 256 * 1024;

/// Shared start of every host script: the process audit, then the environment.
///
/// Arguments: `argv[1]` is the environment's site-packages and `argv[2]` the
/// directory holding the `studio_document_adapters` package shipped with the
/// application. The adapters directory comes first on `sys.path`, so a copy
/// left in the environment by an older Studio is never imported.
macro_rules! host_bootstrap {
    () => {
        r#"import importlib.metadata,json,platform,site,sys
def bounded_library_error_message(error):
    sanitized="".join(" " if ord(char)<32 or 127<=ord(char)<=159 else char for char in str(error))
    return sanitized.encode("utf-8")[:4000].decode("utf-8",errors="ignore")
def deny_product_network(event,args):
    if event == "socket.bind":
        raise RuntimeError("CPython library host cannot own a listening socket")
    if event in {"subprocess.Popen","os.system","os.spawn","os.posix_spawn","os.fork","os.forkpty","os.exec","pty.spawn"}:
        raise PermissionError("CPython library host cannot spawn child processes")
if sys.platform == "win32":
    platform.machine()
sys.addaudithook(deny_product_network)
# Load the selected environment only after the process audit is active.
site.main()
site.addsitedir(sys.argv[1])
sys.path.insert(0,sys.argv[1])
sys.path.insert(0,sys.argv[2])
"#
    };
}

/// Admission probe: interpreter facts, the nirs4all version from distribution
/// metadata, and whether nirs4all and its Studio callables import.
const PREFLIGHT_SCRIPT: &str = concat!(
    host_bootstrap!(),
    r#"import socket
probe=socket.socket()
bind_denied=False
try:
    probe.bind(("127.0.0.1",0))
except RuntimeError:
    bind_denied=True
finally:
    probe.close()
distribution_version=None
import_error=None
ready=False
try:
    distribution_version=importlib.metadata.version("nirs4all")
except importlib.metadata.PackageNotFoundError:
    pass
if distribution_version is not None:
    try:
        import nirs4all
        ready=all(callable(getattr(nirs4all,name,None)) for name in ("studio_scientific_job_v1","studio_scientific_job_v2"))
    except Exception as error:
        import_error=(type(error).__name__+": "+bounded_library_error_message(error))[:500]
print(json.dumps({"schema":"nirs4all.studio-scientific-cpython-host.v2","implementation":sys.implementation.name,"version":list(sys.version_info[:3]),"isolated":bool(sys.flags.isolated),"network_bind_denied":bind_denied,"distribution_version":distribution_version,"import_error":import_error,"ready":ready},separators=(",",":"),sort_keys=True))
"#
);

/// Worker: `argv[3]` is the nirs4all version admitted at acquisition.
const EXECUTION_SCRIPT: &str = concat!(
    host_bootstrap!(),
    r#"raw=sys.stdin.buffer.read(33554433)
if len(raw)>33554432:
    raise RuntimeError("scientific request exceeds stdin budget")
request=json.loads(raw)
if importlib.metadata.version("nirs4all") != sys.argv[3]:
    raise RuntimeError("the nirs4all distribution changed since the scientific host was admitted")
import nirs4all
target=getattr(nirs4all,"studio_scientific_job_v1",None)
if not callable(target):
    raise RuntimeError("scientific callable unavailable")
import contextlib
with contextlib.redirect_stdout(sys.stderr):
    if request.get("schema") == "nirs4all.studio-document-request.v1":
        document_limit=33554432 if request.get("operation") in {"predictions.run","predictions.file","analysis.shap_view"} else (8388608 if request.get("operation") == "documents.batch" else 2097152)
        if len(raw)>document_limit:
            raise RuntimeError("document request exceeds stdin budget")
        from studio_document_adapters.api.library_documents import adapt_document
        try:
            result=adapt_document(request["operation"],request["payload"])
            response={"schema":"nirs4all.studio-document-response.v1","job_id":"document-translation","success":True,"result":result,"error":None}
        except Exception as error:
            response={"schema":"nirs4all.studio-document-response.v1","job_id":"document-translation","success":False,"result":None,"error":str(error).encode("utf-8")[:4000].decode("utf-8",errors="ignore")}
        response_limit=33554432 if request.get("operation") in {"spectra.data","spectra.stats","playground.operators","playground.presets","dataset.preview","dataset.stats","dataset.inspect_format","results.chain_steps","results.pipeline_steps","results.chains","results.dataset_chains","results.top","results.chain","results.chain_detail","results.arrays","results.page","results.summary","predictions.catalogue","predictions.run","predictions.file","operators.availability","results.export","inspector.data","inspector.histogram","inspector.rankings","inspector.branch-topology","inspector.scatter","inspector.heatmap","inspector.candlestick","inspector.branch-comparison","inspector.fold-stability","inspector.confusion","inspector.preprocessing-impact","inspector.hyperparameter","inspector.bias-variance","analysis.shap_compute","analysis.shap_view","synthesis.preview"} else document_limit
    elif request.get("schema") == "nirs4all.studio-scientific-job.v2":
        general=getattr(nirs4all,"studio_scientific_job_v2",None)
        if not callable(general):
            raise RuntimeError("general scientific callable unavailable")
        from nirs4all.pipeline.dagml.progress import observe_progress
        import threading,time
        progress_lock=threading.Lock()
        progress_state={"event":None,"received":0.0,"written":0.0,"pending":False}
        def write_progress(event,suffix=""):
            # Callers hold progress_lock. One bounded line per frame; never raises.
            try:
                message=str(event["message"])[:500-len(suffix)]+suffix
                frame={"schema":"nirs4all.studio-progress.v1","job_id":request["job_id"],"progress":event.get("progress"),"message":message}
                encoded_event=json.dumps(frame,ensure_ascii=True,allow_nan=False,separators=(",",":"))
                if len(encoded_event)+18>8192:
                    return
                sys.stderr.write("NIRS4ALL_PROGRESS "+encoded_event+"\n")
                sys.stderr.flush()
                progress_state["written"]=time.monotonic()
            except Exception:
                pass
        def publish_progress(event,force=False):
            with progress_lock:
                now=time.monotonic()
                progress_state["event"]=event
                progress_state["received"]=now
                if not force and now-progress_state["written"]<1.0:
                    # Throttled: progress_tick delivers the newest event once the window closes.
                    progress_state["pending"]=True
                    return
                progress_state["pending"]=False
                write_progress(event)
        def progress_tick():
            # Trailing flush of a throttled event, then a liveness heartbeat. A heartbeat repeats the
            # latest event with the seconds since it arrived and never invents progress.
            with progress_lock:
                event=progress_state["event"]
                if event is None:
                    return
                now=time.monotonic()
                if progress_state["pending"]:
                    if now-progress_state["written"]>=1.0:
                        progress_state["pending"]=False
                        write_progress(event)
                elif now-progress_state["written"]>=2.0:
                    write_progress(event," · %ds elapsed"%int(now-progress_state["received"]))
        publish_progress({"progress":None,"message":"Loading dataset and preparing scientific execution"})
        stop_heartbeat=threading.Event()
        def heartbeat_loop():
            while not stop_heartbeat.wait(0.25):
                progress_tick()
        heartbeat=threading.Thread(target=heartbeat_loop,name="progress-heartbeat",daemon=True)
        heartbeat.start()
        try:
            with observe_progress(publish_progress):
                response=general(request)
        finally:
            stop_heartbeat.set()
            heartbeat.join(1.0)
            with progress_lock:
                if progress_state["pending"]:
                    write_progress(progress_state["event"])
        response_limit=262144
    elif request.get("schema") in {"nirs4all.studio-synthetic-dataset-job.v1","nirs4all.studio-playground-job.v1"}:
        from nirs4all.api.studio_scientific import StudioScientificJobError
        if request["schema"] == "nirs4all.studio-synthetic-dataset-job.v1":
            if len(raw)>65536:
                raise RuntimeError("synthetic dataset request exceeds stdin budget")
            from nirs4all.api.general_synthesis import studio_synthetic_dataset_job_v1 as facade
            response_limit=65536
        else:
            if len(raw)>8388608:
                raise RuntimeError("Playground request exceeds stdin budget")
            from nirs4all.api.library_playground import studio_playground_job_v1 as facade
            response_limit=33554432
        try:
            response=facade(request)
        except StudioScientificJobError as error:
            response={"schema":"nirs4all.studio-library-error.v1","request_id":request.get("request_id"),"error":{"code":error.code,"message":bounded_library_error_message(error)}}
    else:
        if len(raw)>65536:
            raise RuntimeError("scientific V1 request exceeds stdin budget")
        response=target(request)
        response_limit=8192
encoded=bytearray()
for text_chunk in json.JSONEncoder(allow_nan=False,ensure_ascii=False,separators=(",",":"),sort_keys=True).iterencode(response):
    chunk=text_chunk.encode("utf-8")
    if len(chunk)>response_limit-len(encoded):
        raise RuntimeError("scientific response exceeds stdout budget")
    encoded.extend(chunk)
sys.stdout.buffer.write(encoded)
"#
);

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ScientificCpythonUnavailable {
    HostUnavailable,
    AdaptersUnavailable,
    SpawnFailed,
    TimedOut,
    ProcessFailed,
    OutputReadFailed,
    StdoutTooLarge,
    StderrTooLarge,
    MalformedResponse,
    NotCpython,
    UnsupportedPythonVersion,
    IsolationDisabled,
    NetworkGuardFailed,
    DistributionMissing,
    DistributionVersionUnsupported,
    LibraryImportFailed,
    CallableUnavailable,
    WindowsSystemRootUnavailable,
    RequestResolverUnavailable,
    PlatformKillTreeUnqualified,
    TerminalCallbackFailed,
    InvalidRequest,
    Cancelled,
}

impl ScientificCpythonUnavailable {
    #[must_use]
    pub const fn reason(self) -> &'static str {
        match self {
            Self::HostUnavailable => "python_host_unavailable",
            Self::AdaptersUnavailable => "studio_adapters_unavailable",
            Self::SpawnFailed => "python_host_spawn_failed",
            Self::TimedOut => "python_host_timed_out",
            Self::ProcessFailed => "python_host_process_failed",
            Self::OutputReadFailed => "python_host_output_read_failed",
            Self::StdoutTooLarge => "python_host_stdout_too_large",
            Self::StderrTooLarge => "python_host_stderr_too_large",
            Self::MalformedResponse => "python_host_malformed_response",
            Self::NotCpython => "python_host_not_cpython",
            Self::UnsupportedPythonVersion => "python_host_version_unsupported",
            Self::IsolationDisabled => "python_host_isolation_disabled",
            Self::NetworkGuardFailed => "python_host_network_guard_failed",
            Self::DistributionMissing => "scientific_distribution_missing",
            Self::DistributionVersionUnsupported => "scientific_distribution_version_unsupported",
            Self::LibraryImportFailed => "scientific_library_import_failed",
            Self::CallableUnavailable => "scientific_callable_unavailable",
            Self::WindowsSystemRootUnavailable => "python_host_windows_system_root_unavailable",
            Self::RequestResolverUnavailable => "scientific_request_resolver_unavailable",
            Self::PlatformKillTreeUnqualified => "scientific_platform_kill_tree_unqualified",
            Self::TerminalCallbackFailed => "scientific_terminal_callback_failed",
            Self::InvalidRequest => "scientific_request_invalid",
            Self::Cancelled => "scientific_execution_cancelled",
        }
    }
}

/// The interpreter and directories handed over by the application, with the
/// nirs4all release found when the host was admitted.
#[derive(Clone, Debug, Eq, PartialEq)]
struct ScientificHost {
    python: PathBuf,
    site_packages: PathBuf,
    adapters: PathBuf,
    distribution_version: String,
}

/// Acquisition record for the `CPython` stdio host the application selected.
///
/// Admission requires `CPython` 3.11 or newer, a nirs4all release within the
/// catalogue range, and a worker bootstrap that imports nirs4all and its Studio
/// callables. Execution additionally needs a qualified Unix process group or
/// Windows kill-on-close Job Object, and the Rust-owned saved-run resolver that
/// prepares the callable's path-free matrix contract before any job mutation.
#[derive(Debug)]
pub struct CpythonScientificJobExecutor {
    host: Option<ScientificHost>,
    dataset_cache_scope: u64,
    #[cfg_attr(not(any(unix, windows)), allow(dead_code))]
    acquisition: ScientificCpythonUnavailable,
    resolver: ScientificRequestResolver,
    running: Arc<Mutex<BTreeMap<String, Arc<AtomicBool>>>>,
    terminal_callback_failed: Arc<AtomicBool>,
    warm_workers: [Mutex<Option<warm_library_host::Worker>>; 2],
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct LibraryFacadeError {
    pub code: String,
    pub message: String,
}

impl CpythonScientificJobExecutor {
    pub(crate) const fn dataset_cache_scope(&self) -> u64 {
        self.dataset_cache_scope
    }

    /// The nirs4all release found when this host was acquired.
    #[must_use]
    pub fn distribution_version(&self) -> Option<&str> {
        self.host
            .as_ref()
            .map(|host| host.distribution_version.as_str())
    }

    /// Whether the admitted host can serve interactive library requests.
    pub(crate) const fn library_facades_available(&self) -> bool {
        platform_kill_tree_qualified() && self.host.is_some()
    }

    pub(crate) fn invoke_library_facade(
        &self,
        request: &Value,
    ) -> Result<Value, LibraryFacadeError> {
        let fail = |code: &str, message: &str| LibraryFacadeError {
            code: code.into(),
            message: message.into(),
        };
        let schema = request.get("schema").and_then(Value::as_str);
        if !matches!(
            schema,
            Some("nirs4all.studio-synthetic-dataset-job.v1" | "nirs4all.studio-playground-job.v1")
        ) {
            return Err(fail(
                "unsupported_contract",
                "Unsupported Studio library facade contract",
            ));
        }
        let Some(host) = &self.host else {
            return Err(fail(
                "host_unavailable",
                "Scientific library host unavailable",
            ));
        };
        let bytes = serde_json::to_vec(request)
            .map_err(|_| fail("invalid_request", "Library facade request is not JSON"))?;
        let response = self
            .run_interactive_request(host, &bytes, SCIENTIFIC_CPYTHON_EXECUTION_TIMEOUT)
            .map_err(|error| {
                if matches!(std::env::var("CI").as_deref(), Ok("true" | "1")) {
                    eprintln!("Scientific library facade unavailable: {}", error.reason());
                }
                fail(error.reason(), "Scientific library facade failed")
            })?;
        if response.get("schema").and_then(Value::as_str)
            == Some("nirs4all.studio-library-error.v1")
        {
            if matches!(std::env::var("CI").as_deref(), Ok("true" | "1")) {
                // Log only the closed refusal code, never the request or message.
                eprintln!(
                    "Scientific library facade refused: {}",
                    response["error"]["code"]
                        .as_str()
                        .unwrap_or("library_refused")
                );
            }
            return Err(LibraryFacadeError {
                code: response["error"]["code"]
                    .as_str()
                    .unwrap_or("library_refused")
                    .into(),
                message: response["error"]["message"]
                    .as_str()
                    .unwrap_or("Scientific library facade refused the request")
                    .into(),
            });
        }
        Ok(response)
    }

    pub(crate) fn adapt_document(&self, operation: &str, payload: &Value) -> Result<Value, String> {
        self.adapt_document_cancellable(operation, payload, &AtomicBool::new(false))
    }

    pub(crate) fn adapt_document_cancellable(
        &self,
        operation: &str,
        payload: &Value,
        cancelled: &AtomicBool,
    ) -> Result<Value, String> {
        let _timing = BoundaryTiming::start(match operation {
            "dataset.configure" => "document_configure",
            "dataset.preview" => "document_preview",
            _ => "document_other",
        });
        let Some(host) = &self.host else {
            return Err("Document library host unavailable".into());
        };
        let request = crate::document_cpython::request(operation, payload)?;
        let bytes = serde_json::to_vec(&request).map_err(|error| error.to_string())?;
        let dedicated = matches!(
            operation,
            "workspace.upgrade"
                | "predictions.run"
                | "predictions.file"
                | "runs.delete"
                | "analysis.shap_compute"
        );
        let response = if dedicated {
            // Heavy operations must not occupy either interactive worker.
            run_scientific_process_with_timeout(
                host,
                &bytes,
                cancelled,
                if operation == "analysis.shap_compute" {
                    SCIENTIFIC_CPYTHON_TRAINING_TIMEOUT
                } else {
                    SCIENTIFIC_CPYTHON_EXECUTION_TIMEOUT
                },
            )
        } else {
            self.run_interactive_request(host, &bytes, SCIENTIFIC_CPYTHON_DOCUMENT_TIMEOUT)
        }
        .map_err(|error| error.reason().to_owned())?;
        if response["success"] == true {
            Ok(response["result"].clone())
        } else {
            Err(response["error"]
                .as_str()
                .unwrap_or("Document translation failed")
                .into())
        }
    }

    /// Admit the interpreter the application selected.
    ///
    /// `site_packages` is that environment's package directory and
    /// `adapters_dir` the application directory that contains the
    /// `studio_document_adapters` package.
    #[must_use]
    pub fn acquire(
        python: impl AsRef<Path>,
        site_packages: impl AsRef<Path>,
        adapters_dir: impl AsRef<Path>,
        config_dir: impl Into<PathBuf>,
    ) -> Self {
        Self::acquire_within(
            python.as_ref(),
            site_packages.as_ref(),
            adapters_dir.as_ref(),
            config_dir.into(),
            SCIENTIFIC_CPYTHON_ACQUISITION_TIMEOUT,
        )
    }

    fn acquire_within(
        python: &Path,
        site_packages: &Path,
        adapters_dir: &Path,
        config_dir: PathBuf,
        timeout: Duration,
    ) -> Self {
        let started = Instant::now();
        let acquired = acquire_host(python, site_packages, adapters_dir, timeout);
        log_acquisition(acquired.as_ref().map(|(host, _)| host), started.elapsed());
        match acquired {
            Ok((host, worker)) => Self {
                host: Some(host),
                dataset_cache_scope: NEXT_DATASET_CACHE_SCOPE.fetch_add(1, Ordering::Relaxed),
                acquisition: ScientificCpythonUnavailable::RequestResolverUnavailable,
                resolver: ScientificRequestResolver::new(config_dir),
                running: Arc::new(Mutex::new(BTreeMap::new())),
                terminal_callback_failed: Arc::new(AtomicBool::new(false)),
                warm_workers: [Mutex::new(Some(worker)), Mutex::new(None)],
            },
            Err(error) => Self::unavailable(error, config_dir),
        }
    }

    /// A host whose acquisition ran out of time, for tests of the retry path.
    #[cfg(test)]
    pub(crate) fn timed_out_for_test(config_dir: PathBuf) -> Self {
        Self::unavailable(ScientificCpythonUnavailable::TimedOut, config_dir)
    }

    /// Whether acquisition ran out of time, rather than finding an unusable host.
    #[must_use]
    pub fn acquisition_timed_out(&self) -> bool {
        self.host.is_none() && self.acquisition == ScientificCpythonUnavailable::TimedOut
    }

    fn unavailable(error: ScientificCpythonUnavailable, config_dir: PathBuf) -> Self {
        Self {
            host: None,
            dataset_cache_scope: NEXT_DATASET_CACHE_SCOPE.fetch_add(1, Ordering::Relaxed),
            acquisition: error,
            resolver: ScientificRequestResolver::new(config_dir),
            running: Arc::new(Mutex::new(BTreeMap::new())),
            terminal_callback_failed: Arc::new(AtomicBool::new(false)),
            warm_workers: std::array::from_fn(|_| Mutex::new(None)),
        }
    }

    #[must_use]
    pub fn unavailable_reason(&self) -> &'static str {
        #[cfg(not(any(unix, windows)))]
        {
            ScientificCpythonUnavailable::PlatformKillTreeUnqualified.reason()
        }
        #[cfg(any(unix, windows))]
        {
            if self.terminal_callback_failed.load(Ordering::Acquire) {
                return ScientificCpythonUnavailable::TerminalCallbackFailed.reason();
            }
            self.acquisition.reason()
        }
    }
}

impl ScientificJobExecutor for CpythonScientificJobExecutor {
    fn is_selected(&self) -> bool {
        platform_kill_tree_qualified()
            && self.host.is_some()
            && self.resolver.is_configured()
            && !self.terminal_callback_failed.load(Ordering::Acquire)
    }

    fn unavailability_reason(&self) -> &'static str {
        self.unavailable_reason()
    }

    fn preflight_submission(
        &self,
        request: &ScientificSubmissionPreflight,
    ) -> Result<ScientificExecutorSelection, JobExecutorError> {
        if !self.is_selected() {
            return Err(JobExecutorError::PreflightRefused {
                code: self.unavailable_reason(),
                detail: "the scientific Python host is not available",
            });
        }
        // The host was admitted at acquisition: do not run a second cold import
        // for the same admission boundary.
        let payload = self
            .resolver
            .resolve_general_batched(request, |operation, payload| {
                self.adapt_document(operation, payload)
            })
            .map_err(|error| match error {
                crate::scientific_request_resolver::ScientificResolveError::ExecutionUnavailable { code, message } =>
                    JobExecutorError::PreflightBlocked { code, detail: message },
                other => {
                    let (code, detail) = other.refusal();
                    JobExecutorError::PreflightRefused { code, detail }
                }
            })?;
        validate_scientific_request(&payload, &request.job_id).map_err(|error| {
            JobExecutorError::PreflightRefused {
                code: error.reason(),
                detail: "the resolved scientific request does not satisfy the executor contract",
            }
        })?;
        Ok(ScientificExecutorSelection {
            execution_backend: "dag-ml-core".into(),
            execution_mode: Some("bounded-cpython-stdio".into()),
            prepared_payload: payload,
        })
    }

    fn submit_scientific(
        &self,
        request: &ScientificExecutionRequest,
        terminal: Arc<dyn ScientificJobTerminal>,
    ) -> Result<(), JobExecutorError> {
        let Some(host) = &self.host else {
            return Err(JobExecutorError::SubmissionRefused);
        };
        validate_scientific_request(&request.payload, &request.job_id)
            .map_err(|_| JobExecutorError::SubmissionRefused)?;
        let encoded = serde_json::to_vec(&request.payload)
            .map_err(|_| JobExecutorError::SubmissionRefused)?;
        let cancelled = Arc::new(AtomicBool::new(false));
        {
            let mut running = self
                .running
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            if running.contains_key(&request.job_id) {
                return Err(JobExecutorError::SubmissionRefused);
            }
            running.insert(request.job_id.clone(), Arc::clone(&cancelled));
        }
        let job_id = request.job_id.clone();
        let host = host.clone();
        let running = Arc::clone(&self.running);
        let terminal_callback_failed = Arc::clone(&self.terminal_callback_failed);
        std::thread::spawn(move || {
            let _ = terminal.activity(&job_id, "Preparing the scientific runtime");
            let (outcome, diagnostic) =
                run_scientific_process(&host, &encoded, &cancelled, Some(Arc::clone(&terminal)));
            running
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .remove(&job_id);
            let callback = match outcome {
                Ok(result) => terminal.complete(&job_id, result),
                Err(ScientificCpythonUnavailable::Cancelled) => {
                    terminal.acknowledge_cancel(&job_id)
                }
                Err(error) => terminal.fail(
                    &job_id,
                    diagnostic.as_deref().unwrap_or_else(|| error.reason()),
                ),
            };
            if callback.is_err() {
                terminal_callback_failed.store(true, Ordering::Release);
            }
        });
        Ok(())
    }

    fn request_cooperative_cancel(&self, job_id: &str) -> Result<(), JobExecutorError> {
        let cancelled = {
            let running = self
                .running
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            running
                .get(job_id)
                .cloned()
                .ok_or(JobExecutorError::CancellationRefused)?
        };
        cancelled.store(true, Ordering::Release);
        Ok(())
    }
}

const fn platform_kill_tree_qualified() -> bool {
    cfg!(any(unix, windows))
}

/// Admit the selected interpreter; the probe process becomes the first worker.
fn acquire_host(
    python: &Path,
    site_packages: &Path,
    adapters_dir: &Path,
    timeout: Duration,
) -> Result<(ScientificHost, warm_library_host::Worker), ScientificCpythonUnavailable> {
    // Workers run in a scratch directory, so every path is made absolute. A
    // venv interpreter is a link to its base interpreter: keep the selected
    // path, since resolving it would leave the environment.
    let absolute = |path: &Path, refusal| std::path::absolute(path).map_err(|_| refusal);
    let mut host = ScientificHost {
        python: absolute(python, ScientificCpythonUnavailable::HostUnavailable)?,
        site_packages: absolute(site_packages, ScientificCpythonUnavailable::HostUnavailable)?,
        adapters: absolute(
            adapters_dir,
            ScientificCpythonUnavailable::AdaptersUnavailable,
        )?,
        distribution_version: String::new(),
    };
    if !host.python.is_file() || !host.site_packages.is_dir() {
        return Err(ScientificCpythonUnavailable::HostUnavailable);
    }
    // The adapters are the application's own files: verified here, once.
    crate::document_cpython::verify(&host.adapters).map_err(|error| {
        eprintln!("Studio scientific host refused: document adapters: {error}");
        ScientificCpythonUnavailable::AdaptersUnavailable
    })?;
    let (worker, output) = warm_library_host::Worker::acquire(&host, timeout)?;
    let range = crate::recommended_config::nirs4all_range()
        .ok_or(ScientificCpythonUnavailable::DistributionVersionUnsupported)?;
    host.distribution_version = admitted_distribution(&output, &range)?;
    Ok((host, worker))
}

/// One diagnostic line per acquisition; Electron records it in the main log.
fn log_acquisition(
    acquired: Result<&ScientificHost, &ScientificCpythonUnavailable>,
    elapsed: Duration,
) {
    let outcome = match acquired {
        Ok(host) => format!("ready nirs4all={}", host.distribution_version),
        Err(error) => format!("unavailable reason={}", error.reason()),
    };
    let _ = writeln!(
        std::io::stderr().lock(),
        "Studio scientific host {outcome} elapsed_ms={}",
        elapsed.as_millis()
    );
}

/// Numeric release and pre-release marker of a PEP 440 version.
fn version_release(value: &str) -> Option<(Vec<u64>, bool)> {
    let value = value.trim();
    let value = value
        .strip_prefix('v')
        .or_else(|| value.strip_prefix('V'))
        .unwrap_or(value);
    let end = value
        .find(|character: char| !(character.is_ascii_digit() || character == '.'))
        .unwrap_or(value.len());
    let numeric = value[..end].trim_end_matches('.');
    let release = numeric
        .split('.')
        .map(|part| part.parse::<u64>().ok())
        .collect::<Option<Vec<_>>>()?;
    let marker = value[numeric.len()..]
        .trim()
        .trim_start_matches(['-', '_', '.'])
        .to_ascii_lowercase();
    let prerelease = [
        "a", "b", "c", "rc", "alpha", "beta", "pre", "preview", "dev",
    ]
    .iter()
    .any(|prefix| marker.starts_with(prefix));
    Some((release, prerelease))
}

fn compare_releases(left: &[u64], right: &[u64]) -> std::cmp::Ordering {
    let length = left.len().max(right.len());
    (0..length)
        .map(|index| {
            left.get(index)
                .copied()
                .unwrap_or(0)
                .cmp(&right.get(index).copied().unwrap_or(0))
        })
        .find(|ordering| ordering.is_ne())
        .unwrap_or(std::cmp::Ordering::Equal)
}

/// Whether `version` satisfies the catalogue range, a comma-separated list of
/// `>=`, `>`, `<=`, `<`, `==` and `!=` clauses over plain releases (an empty
/// range accepts any release). As in PEP 440, a pre-release sorts before its
/// release and `<` excludes the pre-releases of its bound. Any other clause
/// refuses.
fn distribution_version_supported(version: &str, range: &str) -> bool {
    use std::cmp::Ordering::{Equal, Greater, Less};
    let Some((release, prerelease)) = version_release(version) else {
        return false;
    };
    range
        .split(',')
        .map(str::trim)
        .filter(|clause| !clause.is_empty())
        .all(|clause| {
            let operator_end = clause
                .find(|character| !matches!(character, '<' | '>' | '=' | '!'))
                .unwrap_or(clause.len());
            let (operator, bound) = clause.split_at(operator_end);
            let bound = bound.trim();
            if !bound
                .chars()
                .all(|character| character.is_ascii_digit() || character == '.')
            {
                return false;
            }
            let Some((bound, _)) = version_release(bound) else {
                return false;
            };
            let ordering = compare_releases(&release, &bound);
            let exact = ordering == Equal && !prerelease;
            match operator {
                ">=" => ordering == Greater || exact,
                ">" => ordering == Greater,
                "<=" => ordering != Greater,
                "<" => ordering == Less,
                "==" => exact,
                "!=" => !exact,
                _ => false,
            }
        })
}

/// Check the admission probe's report; return the admitted nirs4all version.
fn admitted_distribution(
    output: &[u8],
    range: &str,
) -> Result<String, ScientificCpythonUnavailable> {
    let response: Value = serde_json::from_slice(output)
        .map_err(|_| ScientificCpythonUnavailable::MalformedResponse)?;
    let version = response["version"]
        .as_array()
        .filter(|version| version.len() == 3)
        .and_then(|version| Some((version[0].as_u64()?, version[1].as_u64()?)));
    let (Some("nirs4all.studio-scientific-cpython-host.v2"), Some(implementation), Some(version)) = (
        response["schema"].as_str(),
        response["implementation"].as_str(),
        version,
    ) else {
        return Err(ScientificCpythonUnavailable::MalformedResponse);
    };
    if implementation != "cpython" {
        return Err(ScientificCpythonUnavailable::NotCpython);
    }
    if version.0 != 3 || version.1 < 11 {
        return Err(ScientificCpythonUnavailable::UnsupportedPythonVersion);
    }
    if response["isolated"] != true {
        return Err(ScientificCpythonUnavailable::IsolationDisabled);
    }
    if response["network_bind_denied"] != true {
        return Err(ScientificCpythonUnavailable::NetworkGuardFailed);
    }
    let Some(distribution_version) = response["distribution_version"].as_str() else {
        return Err(ScientificCpythonUnavailable::DistributionMissing);
    };
    if !distribution_version_supported(distribution_version, range) {
        eprintln!(
            "Studio scientific host refused: nirs4all {distribution_version} is outside {range}"
        );
        return Err(ScientificCpythonUnavailable::DistributionVersionUnsupported);
    }
    if let Some(error) = response["import_error"].as_str() {
        eprintln!(
            "Studio scientific host refused: nirs4all {distribution_version} did not import: {}",
            bounded_process_diagnostic(error.as_bytes())
        );
        return Err(ScientificCpythonUnavailable::LibraryImportFailed);
    }
    if response["ready"] != true {
        return Err(ScientificCpythonUnavailable::CallableUnavailable);
    }
    Ok(distribution_version.to_owned())
}

fn bounded_process_diagnostic(bytes: &[u8]) -> String {
    let bounded = &bytes[..bytes.len().min(4096)];
    let sanitized = String::from_utf8_lossy(bounded)
        .chars()
        .map(|character| {
            if character == '\n'
                || character == '\r'
                || character == '\t'
                || !character.is_control()
            {
                character
            } else {
                '\u{fffd}'
            }
        })
        .collect::<String>();
    if sanitized.is_empty() {
        "(empty stderr)".into()
    } else {
        sanitized
    }
}

#[cfg(windows)]
fn configure_windows_runtime_environment(
    command: &mut Command,
) -> Result<(), ScientificCpythonUnavailable> {
    let configured = std::env::var_os("SystemRoot")
        .ok_or(ScientificCpythonUnavailable::WindowsSystemRootUnavailable)?;
    let requested = PathBuf::from(configured);
    let trusted = studio_windows_job::system_windows_directory()
        .map_err(|_| ScientificCpythonUnavailable::WindowsSystemRootUnavailable)?;
    let canonical = validated_windows_system_root(&requested, &trusted)?;
    let architecture = windows_processor_architecture()
        .ok_or(ScientificCpythonUnavailable::PlatformKillTreeUnqualified)?;
    command
        .env("SystemRoot", canonical)
        .env("PROCESSOR_ARCHITECTURE", architecture);
    Ok(())
}

#[cfg(windows)]
fn validated_windows_system_root(
    requested: &Path,
    trusted: &Path,
) -> Result<PathBuf, ScientificCpythonUnavailable> {
    if !requested.is_absolute() {
        return Err(ScientificCpythonUnavailable::WindowsSystemRootUnavailable);
    }
    let metadata = fs::symlink_metadata(requested)
        .map_err(|_| ScientificCpythonUnavailable::WindowsSystemRootUnavailable)?;
    let canonical = fs::canonicalize(trusted)
        .map_err(|_| ScientificCpythonUnavailable::WindowsSystemRootUnavailable)?;
    let system32 = canonical.join("System32");
    if metadata.file_type().is_symlink()
        || !metadata.is_dir()
        || !system32.is_dir()
        || canonical.components().count() != 3
        || !same_file::is_same_file(requested, trusted)
            .map_err(|_| ScientificCpythonUnavailable::WindowsSystemRootUnavailable)?
    {
        return Err(ScientificCpythonUnavailable::WindowsSystemRootUnavailable);
    }
    Ok(canonical)
}

#[cfg(not(windows))]
#[allow(clippy::unnecessary_wraps)]
const fn configure_windows_runtime_environment(
    _command: &mut Command,
) -> Result<(), ScientificCpythonUnavailable> {
    Ok(())
}

#[cfg(any(windows, test))]
const fn windows_processor_architecture() -> Option<&'static str> {
    if cfg!(target_arch = "x86_64") {
        Some("AMD64")
    } else if cfg!(target_arch = "aarch64") {
        Some("ARM64")
    } else if cfg!(target_arch = "x86") {
        Some("x86")
    } else {
        None
    }
}

#[cfg(not(windows))]
#[allow(clippy::unnecessary_wraps)]
fn contained_scientific_command(path: &Path) -> Result<Command, ScientificCpythonUnavailable> {
    Ok(Command::new(path))
}

#[cfg(windows)]
fn contained_scientific_command(path: &Path) -> Result<Command, ScientificCpythonUnavailable> {
    let launcher =
        std::env::current_exe().map_err(|_| ScientificCpythonUnavailable::SpawnFailed)?;
    let mut command = Command::new(launcher);
    command
        .arg(WINDOWS_SCIENTIFIC_JOB_LAUNCHER_ARGUMENT)
        .arg(path);
    Ok(command)
}

#[cfg(windows)]
/// Run the scientific worker inside the current process' kill-on-close Job Object.
///
/// # Errors
///
/// Returns an error when the launcher cannot assign itself to the Job Object.
pub fn run_windows_job_launcher(
    executable: &std::ffi::OsStr,
    arguments: impl IntoIterator<Item = std::ffi::OsString>,
) -> Result<std::convert::Infallible, String> {
    let _job = studio_windows_job::KillOnCloseJob::assign_current_process()?;
    let code = Command::new(executable)
        .args(arguments)
        .stdin(std::process::Stdio::inherit())
        .stdout(std::process::Stdio::inherit())
        .stderr(std::process::Stdio::inherit())
        .status()
        .map_or_else(
            |error| {
                eprintln!("studio-sidecar: could not start contained scientific worker: {error}");
                70
            },
            |status| status.code().unwrap_or(70),
        );
    // `process::exit` deliberately skips Drop. The OS closes the last Job
    // handle while terminating this launcher, which atomically kills any
    // descendants that outlived Python without replacing Python's exit code.
    std::process::exit(code)
}

fn run_scientific_process(
    host: &ScientificHost,
    input: &[u8],
    cancelled: &AtomicBool,
    progress_terminal: Option<Arc<dyn ScientificJobTerminal>>,
) -> (Result<Value, ScientificCpythonUnavailable>, Option<String>) {
    let mut diagnostic = None;
    let result = run_scientific_process_with_progress(
        host,
        input,
        cancelled,
        SCIENTIFIC_CPYTHON_TRAINING_TIMEOUT,
        &mut diagnostic,
        progress_terminal,
    );
    (result, diagnostic)
}

fn request_limits(request: &Value) -> (usize, usize) {
    match request.get("schema").and_then(Value::as_str) {
        Some("nirs4all.studio-synthetic-dataset-job.v1") => (65_536, 65_536),
        Some("nirs4all.studio-playground-job.v1") => (8 * 1024 * 1024, 32 * 1024 * 1024),
        Some(crate::document_cpython::REQUEST_SCHEMA) => {
            let limit = if matches!(
                request["operation"].as_str(),
                Some("predictions.run" | "predictions.file" | "analysis.shap_view")
            ) {
                crate::document_cpython::MAX_PREDICTION_BYTES
            } else if request["operation"] == "documents.batch" {
                crate::document_cpython::MAX_BATCH_BYTES
            } else {
                crate::document_cpython::MAX_DOCUMENT_BYTES
            };
            let output_limit = if matches!(
                request["operation"].as_str(),
                Some(
                    "spectra.data"
                        | "spectra.stats"
                        | "playground.operators"
                        | "playground.presets"
                        | "dataset.preview"
                        | "dataset.stats"
                        | "dataset.inspect_format"
                        | "results.chain_steps"
                        | "results.pipeline_steps"
                        | "results.chains"
                        | "results.dataset_chains"
                        | "results.top"
                        | "results.chain"
                        | "results.chain_detail"
                        | "results.arrays"
                        | "results.page"
                        | "results.summary"
                        | "predictions.catalogue"
                        | "predictions.run"
                        | "predictions.file"
                        | "operators.availability"
                        | "results.export"
                        | "inspector.data"
                        | "inspector.histogram"
                        | "inspector.rankings"
                        | "inspector.branch-topology"
                        | "inspector.scatter"
                        | "inspector.heatmap"
                        | "inspector.candlestick"
                        | "inspector.branch-comparison"
                        | "inspector.fold-stability"
                        | "inspector.confusion"
                        | "inspector.preprocessing-impact"
                        | "inspector.hyperparameter"
                        | "inspector.bias-variance"
                        | "analysis.shap_compute"
                        | "analysis.shap_view"
                        | "synthesis.preview"
                )
            ) {
                crate::document_cpython::MAX_INSPECTION_BYTES
            } else {
                limit
            };
            (limit, output_limit)
        }
        Some("nirs4all.studio-scientific-job.v2") => (
            MAX_GENERAL_SCIENTIFIC_STDIN_BYTES,
            MAX_GENERAL_SCIENTIFIC_STDOUT_BYTES,
        ),
        _ => (
            MAX_SCIENTIFIC_CPYTHON_STDIN_BYTES,
            MAX_SCIENTIFIC_CPYTHON_STDOUT_BYTES,
        ),
    }
}

fn run_scientific_process_with_timeout(
    host: &ScientificHost,
    input: &[u8],
    cancelled: &AtomicBool,
    execution_timeout: Duration,
) -> Result<Value, ScientificCpythonUnavailable> {
    run_scientific_process_with_progress(host, input, cancelled, execution_timeout, &mut None, None)
}

#[allow(clippy::too_many_lines)] // One bounded child lifecycle: spawn, stream, cancel, reap.
fn run_scientific_process_with_progress(
    host: &ScientificHost,
    input: &[u8],
    cancelled: &AtomicBool,
    execution_timeout: Duration,
    diagnostic: &mut Option<String>,
    progress_terminal: Option<Arc<dyn ScientificJobTerminal>>,
) -> Result<Value, ScientificCpythonUnavailable> {
    let request: Value =
        serde_json::from_slice(input).map_err(|_| ScientificCpythonUnavailable::InvalidRequest)?;
    let (input_limit, output_limit) = request_limits(&request);
    if input.len() > input_limit {
        return Err(ScientificCpythonUnavailable::InvalidRequest);
    }
    let expected_job_id = request
        .get(
            if matches!(
                request.get("schema").and_then(Value::as_str),
                Some(
                    "nirs4all.studio-synthetic-dataset-job.v1"
                        | "nirs4all.studio-playground-job.v1"
                )
            ) {
                "request_id"
            } else {
                "job_id"
            },
        )
        .and_then(Value::as_str)
        .map(str::to_owned)
        .ok_or(ScientificCpythonUnavailable::InvalidRequest)?;
    let scratch = ScratchDirectory::create()?;
    let mut command = scientific_worker_command(host, &scratch.path, EXECUTION_SCRIPT)?;
    let mut child = command
        .spawn()
        .map_err(|_| ScientificCpythonUnavailable::SpawnFailed)?;
    let (Some(mut stdin), Some(stdout), Some(stderr)) =
        (child.stdin.take(), child.stdout.take(), child.stderr.take())
    else {
        let _ = child.kill();
        let _ = child.wait();
        return Err(ScientificCpythonUnavailable::OutputReadFailed);
    };
    let input = input.to_vec();
    let stdin_writer = std::thread::spawn(move || stdin.write_all(&input));
    let stdout_reader = std::thread::spawn(move || read_bounded(stdout, output_limit));
    // Training diagnostics are not the JSON protocol. A large campaign can
    // emit repeated estimator warnings while producing a valid result. Drain
    // that stream without growing memory, retaining its tail for failures.
    let training_diagnostics = request.get("schema").and_then(Value::as_str)
        == Some("nirs4all.studio-scientific-job.v2")
        && request.get("operation").and_then(Value::as_str) == Some("run");
    let progress_job_id = expected_job_id.clone();
    let stderr_reader = std::thread::spawn(move || {
        if training_diagnostics {
            read_training_stderr(
                stderr,
                MAX_SCIENTIFIC_CPYTHON_STDERR_BYTES,
                &progress_job_id,
                progress_terminal.as_deref(),
            )
        } else {
            read_bounded(stderr, MAX_SCIENTIFIC_CPYTHON_STDERR_BYTES)
        }
    });
    let (status, cancellation_observed, timed_out) =
        wait_for_worker(&mut child, cancelled, execution_timeout)?;
    let stdin_result = stdin_writer
        .join()
        .map_err(|_| ScientificCpythonUnavailable::ProcessFailed)?;
    let (stdout, stdout_exceeded) = join_reader(stdout_reader)?;
    let (stderr, stderr_exceeded) = join_reader(stderr_reader)?;
    if stdout_exceeded {
        return Err(ScientificCpythonUnavailable::StdoutTooLarge);
    }
    if stderr_exceeded && !training_diagnostics {
        return Err(ScientificCpythonUnavailable::StderrTooLarge);
    }
    if stderr_exceeded {
        eprintln!("Training job {expected_job_id}: diagnostics truncated to the final 64 KiB");
    }
    if cancellation_observed {
        return Err(ScientificCpythonUnavailable::Cancelled);
    }
    if timed_out {
        return Err(ScientificCpythonUnavailable::TimedOut);
    }
    if stdin_result.is_err() || !status.success() {
        // Keep the end of stderr: Python's exception and its explanation follow
        // the traceback. Persist this bounded diagnostic with the Rust-owned job
        // so polling and reopened run details can explain the failure too.
        let tail = &stderr[stderr.len().saturating_sub(4096)..];
        *diagnostic = Some(format!(
            "{} ({status}):\n{}",
            ScientificCpythonUnavailable::ProcessFailed.reason(),
            bounded_process_diagnostic(tail)
        ));
        return Err(ScientificCpythonUnavailable::ProcessFailed);
    }
    let response = validate_worker_response(&request, &stdout, &expected_job_id)?;
    // Dag-ML may use an internal temporary file. It is permitted only because
    // cwd and every standard temporary-directory variable point at this
    // Rust-created 0700 directory. Successful execution includes synchronous
    // removal and verification; Drop remains the error-path fallback.
    scratch.cleanup()?;
    Ok(response)
}

fn validate_worker_response(
    request: &Value,
    stdout: &[u8],
    expected_job_id: &str,
) -> Result<Value, ScientificCpythonUnavailable> {
    let response: Value = serde_json::from_slice(stdout)
        .map_err(|_| ScientificCpythonUnavailable::MalformedResponse)?;
    let request_schema = request.get("schema").and_then(Value::as_str);
    if request_schema == Some(crate::document_cpython::REQUEST_SCHEMA) {
        if !crate::document_cpython::validate_response(&response) {
            return Err(ScientificCpythonUnavailable::MalformedResponse);
        }
    } else if matches!(
        request_schema,
        Some("nirs4all.studio-synthetic-dataset-job.v1" | "nirs4all.studio-playground-job.v1")
    ) {
        validate_library_facade_response(request_schema.unwrap_or_default(), &response)?;
    } else {
        let authorized_workspace = (request_schema == Some("nirs4all.studio-scientific-job.v2"))
            .then(|| request["options"]["workspace_path"].as_str().map(Path::new))
            .flatten();
        validate_scientific_response(&response, authorized_workspace)?;
    }
    let response_id = if matches!(
        request_schema,
        Some("nirs4all.studio-synthetic-dataset-job.v1" | "nirs4all.studio-playground-job.v1")
    ) {
        response.get("request_id")
    } else {
        response.get("job_id")
    };
    if response_id.and_then(Value::as_str) != Some(expected_job_id) {
        return Err(ScientificCpythonUnavailable::MalformedResponse);
    }
    if request.get("schema").and_then(Value::as_str) == Some("nirs4all.studio-scientific-job.v2")
        && response["result"]["workspace_path"] != request["options"]["workspace_path"]
    {
        return Err(ScientificCpythonUnavailable::MalformedResponse);
    }
    Ok(response)
}

fn validate_library_facade_response(
    request_schema: &str,
    response: &Value,
) -> Result<(), ScientificCpythonUnavailable> {
    let object = response
        .as_object()
        .ok_or(ScientificCpythonUnavailable::MalformedResponse)?;
    let schema = response.get("schema").and_then(Value::as_str);
    if schema == Some("nirs4all.studio-library-error.v1") {
        let error = response
            .get("error")
            .and_then(Value::as_object)
            .ok_or(ScientificCpythonUnavailable::MalformedResponse)?;
        let code = error.get("code").and_then(Value::as_str);
        let message = error.get("message").and_then(Value::as_str);
        if object.len() == 3
            && error.len() == 2
            && code.is_some_and(|value| {
                !value.is_empty()
                    && value.len() <= 64
                    && value
                        .bytes()
                        .all(|byte| byte.is_ascii_lowercase() || byte == b'_')
            })
            && message
                .is_some_and(|value| value.len() <= 4096 && !value.chars().any(char::is_control))
        {
            return Ok(());
        }
        return Err(ScientificCpythonUnavailable::MalformedResponse);
    }
    let expected = match request_schema {
        "nirs4all.studio-synthetic-dataset-job.v1" => "nirs4all.studio-synthetic-dataset-result.v1",
        "nirs4all.studio-playground-job.v1" => "nirs4all.studio-playground-result.v1",
        _ => return Err(ScientificCpythonUnavailable::MalformedResponse),
    };
    if schema != Some(expected) || !response.get("result").is_some_and(Value::is_object) {
        return Err(ScientificCpythonUnavailable::MalformedResponse);
    }
    if request_schema == "nirs4all.studio-synthetic-dataset-job.v1" {
        if object.len() != 3 {
            return Err(ScientificCpythonUnavailable::MalformedResponse);
        }
    } else if object.len() != 4
        && !(object.len() == 5
            && response
                .get("wire_diagnostics")
                .is_some_and(Value::is_object))
    {
        return Err(ScientificCpythonUnavailable::MalformedResponse);
    }
    Ok(())
}

/// One isolated host process running `script` with the selected environment,
/// the application's adapters and the admitted nirs4all version as arguments.
fn scientific_worker_command(
    host: &ScientificHost,
    scratch: &Path,
    script: &str,
) -> Result<Command, ScientificCpythonUnavailable> {
    let mut command = contained_scientific_command(&host.python)?;
    command
        .args(["-I", "-S", "-B", "-c", script])
        .args([
            host.site_packages.as_os_str(),
            host.adapters.as_os_str(),
            OsStr::new(&host.distribution_version),
        ])
        .env_clear()
        .env("PYTHONDONTWRITEBYTECODE", "1")
        .env("PYTHONNOUSERSITE", "1")
        .env("N4A_DAGML_INPROCESS", "1")
        .env("MPLBACKEND", "Agg")
        .env("MPLCONFIGDIR", scratch.join("matplotlib"))
        .env("XDG_CACHE_HOME", scratch.join("cache"))
        .env("TMPDIR", scratch)
        .env("TMP", scratch)
        .env("TEMP", scratch)
        .current_dir(scratch)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    configure_windows_runtime_environment(&mut command)?;
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    Ok(command)
}

fn wait_for_worker(
    child: &mut std::process::Child,
    cancelled: &AtomicBool,
    execution_timeout: Duration,
) -> Result<(std::process::ExitStatus, bool, bool), ScientificCpythonUnavailable> {
    let started_at = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(status)) => return Ok((status, false, false)),
            Ok(None) if cancelled.load(Ordering::Acquire) => {
                return Ok((terminate_worker(child)?, true, false));
            }
            Ok(None) if started_at.elapsed() >= execution_timeout => {
                return Ok((terminate_worker(child)?, false, true));
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(10)),
            Err(_) => {
                let _ = terminate_worker(child);
                return Err(ScientificCpythonUnavailable::ProcessFailed);
            }
        }
    }
}

fn terminate_worker(
    child: &mut std::process::Child,
) -> Result<std::process::ExitStatus, ScientificCpythonUnavailable> {
    #[cfg(unix)]
    {
        use nix::{
            sys::signal::{killpg, Signal},
            unistd::Pid,
        };
        let process_group = i32::try_from(child.id())
            .map(Pid::from_raw)
            .map_err(|_| ScientificCpythonUnavailable::ProcessFailed)?;
        if let Err(error) = killpg(process_group, Signal::SIGKILL) {
            if error != nix::errno::Errno::ESRCH {
                return Err(ScientificCpythonUnavailable::ProcessFailed);
            }
        }
    }
    #[cfg(windows)]
    {
        // The direct child is the internal launcher. Killing it closes the
        // sole kill-on-close Job Object handle and terminates the full worker
        // tree before the launcher is reaped.
        child
            .kill()
            .map_err(|_| ScientificCpythonUnavailable::ProcessFailed)?;
    }
    #[cfg(not(any(unix, windows)))]
    {
        child
            .kill()
            .map_err(|_| ScientificCpythonUnavailable::ProcessFailed)?;
    }
    child
        .wait()
        .map_err(|_| ScientificCpythonUnavailable::ProcessFailed)
}

#[derive(Debug)]
struct ScratchDirectory {
    path: PathBuf,
}

impl ScratchDirectory {
    fn create() -> Result<Self, ScientificCpythonUnavailable> {
        for attempt in 0_u8..16 {
            let nonce = SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos();
            let path = std::env::temp_dir().join(format!(
                "nirs4all-studio-host-{}-{nonce}-{attempt}",
                std::process::id()
            ));
            #[cfg(unix)]
            let created = {
                use std::os::unix::fs::DirBuilderExt;
                let mut builder = fs::DirBuilder::new();
                builder.mode(0o700).create(&path)
            };
            #[cfg(not(unix))]
            let created = fs::create_dir(&path);
            match created {
                Ok(()) => return Ok(Self { path }),
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
                Err(_) => return Err(ScientificCpythonUnavailable::SpawnFailed),
            }
        }
        Err(ScientificCpythonUnavailable::SpawnFailed)
    }

    fn cleanup(&self) -> Result<(), ScientificCpythonUnavailable> {
        let metadata = fs::symlink_metadata(&self.path)
            .map_err(|_| ScientificCpythonUnavailable::ProcessFailed)?;
        if metadata.file_type().is_symlink() || !metadata.is_dir() {
            return Err(ScientificCpythonUnavailable::ProcessFailed);
        }
        fs::remove_dir_all(&self.path).map_err(|_| ScientificCpythonUnavailable::ProcessFailed)?;
        if self.path.exists() {
            return Err(ScientificCpythonUnavailable::ProcessFailed);
        }
        Ok(())
    }
}

impl Drop for ScratchDirectory {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.path);
    }
}

fn validate_scientific_request(
    request: &Value,
    expected_job_id: &str,
) -> Result<(), ScientificCpythonUnavailable> {
    if request.get("schema").and_then(Value::as_str) == Some("nirs4all.studio-scientific-job.v2") {
        return validate_general_request(request, expected_job_id);
    }
    let root = exact_object(
        request,
        &[
            "schema",
            "operation",
            "job_id",
            "engine",
            "allow_fallback",
            "dataset",
            "pipeline",
            "options",
        ],
    )?;
    if root.get("schema").and_then(Value::as_str) != Some("nirs4all.studio-scientific-job.v1")
        || root.get("operation").and_then(Value::as_str) != Some("run")
        || root.get("job_id").and_then(Value::as_str) != Some(expected_job_id)
        || !valid_identifier(expected_job_id)
        || root.get("engine").and_then(Value::as_str) != Some("dag-ml")
        || root.get("allow_fallback").and_then(Value::as_bool) != Some(false)
    {
        return Err(ScientificCpythonUnavailable::InvalidRequest);
    }
    let (samples, features) = validate_request_dataset(
        root.get("dataset")
            .ok_or(ScientificCpythonUnavailable::InvalidRequest)?,
    )?;
    validate_request_pipeline(
        root.get("pipeline")
            .ok_or(ScientificCpythonUnavailable::InvalidRequest)?,
        samples,
        features,
    )?;
    validate_request_options(
        root.get("options")
            .ok_or(ScientificCpythonUnavailable::InvalidRequest)?,
    )?;
    let encoded =
        serde_json::to_vec(request).map_err(|_| ScientificCpythonUnavailable::InvalidRequest)?;
    if encoded.len() > MAX_SCIENTIFIC_CPYTHON_STDIN_BYTES {
        return Err(ScientificCpythonUnavailable::InvalidRequest);
    }
    Ok(())
}

fn validate_request_dataset(value: &Value) -> Result<(usize, usize), ScientificCpythonUnavailable> {
    let dataset = exact_object(value, &["name", "task_type", "X", "y"])?;
    if !dataset
        .get("name")
        .and_then(Value::as_str)
        .is_some_and(valid_identifier)
        || dataset.get("task_type").and_then(Value::as_str) != Some("regression")
    {
        return Err(ScientificCpythonUnavailable::InvalidRequest);
    }
    let rows = dataset
        .get("X")
        .and_then(Value::as_array)
        .filter(|rows| (4..=128).contains(&rows.len()))
        .ok_or(ScientificCpythonUnavailable::InvalidRequest)?;
    let width = rows
        .first()
        .and_then(Value::as_array)
        .map(Vec::len)
        .filter(|width| (1..=256).contains(width))
        .ok_or(ScientificCpythonUnavailable::InvalidRequest)?;
    if rows.len().saturating_mul(width) > 16_384
        || rows.iter().any(|row| {
            row.as_array().is_none_or(|values| {
                values.len() != width || values.iter().any(|value| !finite_number(value))
            })
        })
    {
        return Err(ScientificCpythonUnavailable::InvalidRequest);
    }
    let targets = dataset
        .get("y")
        .and_then(Value::as_array)
        .filter(|values| values.len() == rows.len())
        .ok_or(ScientificCpythonUnavailable::InvalidRequest)?;
    if targets.iter().any(|value| !finite_number(value)) {
        return Err(ScientificCpythonUnavailable::InvalidRequest);
    }
    Ok((rows.len(), width))
}

fn validate_request_pipeline(
    value: &Value,
    samples: usize,
    features: usize,
) -> Result<(), ScientificCpythonUnavailable> {
    let pipeline = exact_object(
        value,
        &["kind", "n_components", "scale", "cross_validation"],
    )?;
    let components = integer_in(
        pipeline
            .get("n_components")
            .ok_or(ScientificCpythonUnavailable::InvalidRequest)?,
        1,
        256,
    )?;
    if pipeline.get("kind").and_then(Value::as_str) != Some("pls_regression")
        || !pipeline.get("scale").is_some_and(Value::is_boolean)
    {
        return Err(ScientificCpythonUnavailable::InvalidRequest);
    }
    let cv = exact_object(
        pipeline
            .get("cross_validation")
            .ok_or(ScientificCpythonUnavailable::InvalidRequest)?,
        &["kind", "n_splits", "shuffle"],
    )?;
    let splits = integer_in(
        cv.get("n_splits")
            .ok_or(ScientificCpythonUnavailable::InvalidRequest)?,
        2,
        10,
    )?;
    let splits =
        usize::try_from(splits).map_err(|_| ScientificCpythonUnavailable::InvalidRequest)?;
    let smallest_train = samples - samples.div_ceil(splits);
    if cv.get("kind").and_then(Value::as_str) != Some("kfold")
        || !cv.get("shuffle").is_some_and(Value::is_boolean)
        || splits > samples
        || usize::try_from(components)
            .map_or(true, |components| components > features.min(smallest_train))
    {
        return Err(ScientificCpythonUnavailable::InvalidRequest);
    }
    Ok(())
}

fn validate_request_options(value: &Value) -> Result<(), ScientificCpythonUnavailable> {
    let options = exact_object(value, &["name", "random_state"])?;
    if !options
        .get("name")
        .and_then(Value::as_str)
        .is_some_and(valid_identifier)
    {
        return Err(ScientificCpythonUnavailable::InvalidRequest);
    }
    integer_in(
        options
            .get("random_state")
            .ok_or(ScientificCpythonUnavailable::InvalidRequest)?,
        0,
        2_147_483_647,
    )?;
    Ok(())
}

fn validate_scientific_response(
    response: &Value,
    authorized_workspace: Option<&Path>,
) -> Result<(), ScientificCpythonUnavailable> {
    if response.get("schema").and_then(Value::as_str)
        == Some("nirs4all.studio-scientific-job-result.v2")
    {
        return validate_general_response(response, authorized_workspace);
    }
    let root = exact_object(response, &["schema", "job_id", "engine", "result"])
        .map_err(|_| ScientificCpythonUnavailable::MalformedResponse)?;
    if root.get("schema").and_then(Value::as_str)
        != Some("nirs4all.studio-scientific-job-result.v1")
        || !root
            .get("job_id")
            .and_then(Value::as_str)
            .is_some_and(valid_identifier)
        || root.get("engine").and_then(Value::as_str) != Some("dag-ml")
    {
        return Err(ScientificCpythonUnavailable::MalformedResponse);
    }
    let result = exact_object(
        root.get("result")
            .ok_or(ScientificCpythonUnavailable::MalformedResponse)?,
        &[
            "model",
            "task_type",
            "metric",
            "validation_score",
            "training_score",
            "prediction_count",
        ],
    )
    .map_err(|_| ScientificCpythonUnavailable::MalformedResponse)?;
    if result.get("model").and_then(Value::as_str) != Some("pls_regression")
        || result.get("task_type").and_then(Value::as_str) != Some("regression")
        || !result
            .get("metric")
            .and_then(Value::as_str)
            .is_some_and(|value| {
                !value.is_empty()
                    && value.len() <= 256
                    && !value.bytes().any(|byte| byte.is_ascii_control())
            })
        || !result.get("validation_score").is_some_and(finite_number)
        || !result.get("training_score").is_some_and(finite_number)
        || integer_in(
            result
                .get("prediction_count")
                .ok_or(ScientificCpythonUnavailable::MalformedResponse)?,
            1,
            1_000_000,
        )
        .is_err()
    {
        return Err(ScientificCpythonUnavailable::MalformedResponse);
    }
    Ok(())
}

fn validate_general_request(
    request: &Value,
    job_id: &str,
) -> Result<(), ScientificCpythonUnavailable> {
    let root = exact_object(
        request,
        &[
            "schema",
            "operation",
            "job_id",
            "engine",
            "allow_fallback",
            "pipeline",
            "dataset",
            "options",
        ],
    )?;
    let valid = root["operation"] == "run"
        && root["job_id"] == job_id
        && valid_identifier(job_id)
        && root["engine"] == "dag-ml"
        && root["allow_fallback"] == false
        && root["pipeline"]
            .as_array()
            .is_some_and(|steps| !steps.is_empty())
        && matches!(
            root["dataset"],
            Value::String(_) | Value::Object(_) | Value::Array(_)
        );
    let options = root["options"]
        .as_object()
        .ok_or(ScientificCpythonUnavailable::InvalidRequest)?;
    let allowed = [
        "workspace_path",
        "name",
        "random_state",
        "verbose",
        "save_charts",
        "save_artifacts",
        "project",
        "refit",
        "cache",
        "report_naming",
        "keep_datasets",
        "n_jobs",
        "max_generation_count",
        "continue_on_error",
        "results_path",
        "studio_provenance",
    ];
    if !valid
        || options.keys().any(|key| !allowed.contains(&key.as_str()))
        || !options
            .get("workspace_path")
            .and_then(Value::as_str)
            .is_some_and(|path| Path::new(path).is_absolute())
        || serde_json::to_vec(request)
            .map_err(|_| ScientificCpythonUnavailable::InvalidRequest)?
            .len()
            > MAX_GENERAL_SCIENTIFIC_STDIN_BYTES
    {
        return Err(ScientificCpythonUnavailable::InvalidRequest);
    }
    Ok(())
}

fn validate_general_response(
    response: &Value,
    authorized_workspace: Option<&Path>,
) -> Result<(), ScientificCpythonUnavailable> {
    let invalid = ScientificCpythonUnavailable::MalformedResponse;
    let root =
        exact_object(response, &["schema", "job_id", "engine", "result"]).map_err(|_| invalid)?;
    let archive_result = root["result"].get("archive_path").is_some();
    let provenance_result = root["result"].get("dataset_run_ids").is_some();
    let result = exact_object(
        &root["result"],
        &[
            "run_ids",
            "workspace_path",
            "native_results_dirs",
            "metric",
            "validation_score",
            "evaluations",
            "chart_reports",
            "prediction_count",
            "model_names",
            "dataset_names",
            "native_score_sets_available",
        ]
        .iter()
        .copied()
        .chain(archive_result.then_some("archive_path"))
        .chain(provenance_result.then_some("dataset_run_ids"))
        .collect::<Vec<_>>(),
    )
    .map_err(|_| invalid)?;
    if provenance_result
        && !result["dataset_run_ids"]
            .as_object()
            .is_some_and(|mapping| {
                mapping.len() <= 256
                    && mapping.iter().all(|(run, dataset)| {
                        valid_identifier(run)
                            && dataset.as_str().is_some_and(valid_identifier)
                            && result["run_ids"]
                                .as_array()
                                .is_some_and(|runs| runs.contains(&serde_json::json!(run)))
                    })
            })
    {
        return Err(invalid);
    }
    if root["engine"] != "dag-ml"
        || !root["job_id"].as_str().is_some_and(valid_identifier)
        || !result["workspace_path"]
            .as_str()
            .is_some_and(|path| Path::new(path).is_absolute())
        || !result["prediction_count"].is_u64()
        || (!archive_result && result["native_score_sets_available"] != true)
        || (archive_result && !result["native_score_sets_available"].is_boolean())
        || !result["metric"]
            .as_str()
            .is_some_and(|metric| !metric.is_empty() && metric.len() <= 256)
        || !(result["validation_score"].is_null() || finite_number(&result["validation_score"]))
        || !result["evaluations"]
            .as_array()
            .is_some_and(|values| values.iter().all(Value::is_object))
    {
        return Err(invalid);
    }
    for field in [
        "run_ids",
        "native_results_dirs",
        "chart_reports",
        "model_names",
        "dataset_names",
    ] {
        let values = result[field].as_array().ok_or(invalid)?;
        if (field == "run_ids" && values.is_empty() && !archive_result)
            || values.iter().any(|value| {
                !value.as_str().is_some_and(|text| {
                    !text.is_empty() && text.len() <= 4096 && !text.chars().any(char::is_control)
                })
            })
        {
            return Err(invalid);
        }
    }
    if archive_result {
        validate_general_archive_path(&root["result"], authorized_workspace)?;
    }
    Ok(())
}

fn validate_general_archive_path(
    result: &Value,
    authorized_workspace: Option<&Path>,
) -> Result<(), ScientificCpythonUnavailable> {
    let invalid = ScientificCpythonUnavailable::MalformedResponse;
    if !result["run_ids"].as_array().is_some_and(Vec::is_empty)
        || !result["native_results_dirs"]
            .as_array()
            .is_some_and(Vec::is_empty)
    {
        return Err(invalid);
    }
    let workspace = authorized_workspace.ok_or(invalid)?;
    let workspace = fs::canonicalize(workspace).map_err(|_| invalid)?;
    let reported_workspace = result["workspace_path"]
        .as_str()
        .map(Path::new)
        .ok_or(invalid)?;
    if fs::canonicalize(reported_workspace).map_err(|_| invalid)? != workspace {
        return Err(invalid);
    }
    let archive = result["archive_path"]
        .as_str()
        .map(Path::new)
        .ok_or(invalid)?;
    if !archive.is_absolute() || archive.extension().is_none_or(|ext| ext != "n4a") {
        return Err(invalid);
    }
    let relative_archive = archive
        .strip_prefix(reported_workspace)
        .map_err(|_| invalid)?;
    if relative_archive
        .components()
        .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err(invalid);
    }
    let canonical_archive = fs::canonicalize(archive).map_err(|_| invalid)?;
    let metadata = fs::symlink_metadata(archive).map_err(|_| invalid)?;
    if canonical_archive != workspace.join(relative_archive) || !metadata.is_file() {
        return Err(invalid);
    }
    Ok(())
}

fn exact_object<'a>(
    value: &'a Value,
    keys: &[&str],
) -> Result<&'a serde_json::Map<String, Value>, ScientificCpythonUnavailable> {
    let object = value
        .as_object()
        .ok_or(ScientificCpythonUnavailable::InvalidRequest)?;
    if object.len() != keys.len() || keys.iter().any(|key| !object.contains_key(*key)) {
        return Err(ScientificCpythonUnavailable::InvalidRequest);
    }
    Ok(object)
}

fn integer_in(
    value: &Value,
    minimum: i64,
    maximum: i64,
) -> Result<i64, ScientificCpythonUnavailable> {
    value
        .as_i64()
        .filter(|number| (minimum..=maximum).contains(number))
        .ok_or(ScientificCpythonUnavailable::InvalidRequest)
}

fn finite_number(value: &Value) -> bool {
    value.as_f64().is_some_and(f64::is_finite)
}

fn valid_identifier(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 256
        && !matches!(value, "." | "..")
        && !value
            .bytes()
            .any(|byte| byte.is_ascii_control() || matches!(byte, b'/' | b'\\'))
}

fn join_reader(
    reader: std::thread::JoinHandle<std::io::Result<(Vec<u8>, bool)>>,
) -> Result<(Vec<u8>, bool), ScientificCpythonUnavailable> {
    reader
        .join()
        .map_err(|_| ScientificCpythonUnavailable::OutputReadFailed)?
        .map_err(|_| ScientificCpythonUnavailable::OutputReadFailed)
}

fn read_training_stderr(
    mut reader: impl Read,
    limit: usize,
    job_id: &str,
    terminal: Option<&dyn ScientificJobTerminal>,
) -> std::io::Result<(Vec<u8>, bool)> {
    let mut retained = Vec::with_capacity(limit.min(65_536));
    let mut line = Vec::with_capacity(8192);
    let mut oversized = false;
    let mut exceeded = false;
    let mut buffer = [0_u8; 4096];
    loop {
        let count = reader.read(&mut buffer)?;
        if count == 0 {
            break;
        }
        exceeded |= retained.len().saturating_add(count) > limit;
        if count >= limit {
            retained.clear();
            retained.extend_from_slice(&buffer[count.saturating_sub(limit)..count]);
        } else {
            let discard = retained.len().saturating_add(count).saturating_sub(limit);
            retained.drain(..discard);
            retained.extend_from_slice(&buffer[..count]);
        }
        for byte in &buffer[..count] {
            if *byte == b'\n' {
                if !oversized {
                    if let (Some(terminal), Some(payload)) =
                        (terminal, line.strip_prefix(b"NIRS4ALL_PROGRESS "))
                    {
                        publish_progress_frame(payload, job_id, terminal);
                    }
                }
                line.clear();
                oversized = false;
            } else if line.len() < 8192 {
                line.push(*byte);
            } else {
                oversized = true;
            }
        }
    }
    Ok((retained, exceeded))
}

fn publish_progress_frame(payload: &[u8], job_id: &str, terminal: &dyn ScientificJobTerminal) {
    let Ok(frame) = serde_json::from_slice::<Value>(payload) else {
        return;
    };
    if frame["schema"] != "nirs4all.studio-progress.v1" || frame["job_id"] != job_id {
        return;
    }
    let Some(message) = frame["message"].as_str().filter(|text| {
        !text.is_empty() && text.len() <= 4096 && !text.chars().any(char::is_control)
    }) else {
        return;
    };
    let progress = if frame["progress"].is_null() {
        None
    } else {
        let Some(value) = frame["progress"]
            .as_f64()
            .filter(|value| value.is_finite() && (0.0..=100.0).contains(value))
        else {
            return;
        };
        Some(value)
    };
    let _ = terminal.progress(job_id, progress, message);
}

#[cfg(test)]
fn read_bounded_tail(mut reader: impl Read, limit: usize) -> std::io::Result<(Vec<u8>, bool)> {
    let mut retained = Vec::with_capacity(limit.min(64 * 1024));
    let mut buffer = [0_u8; 4096];
    let mut exceeded = false;
    loop {
        let count = reader.read(&mut buffer)?;
        if count == 0 {
            return Ok((retained, exceeded));
        }
        exceeded |= retained.len().saturating_add(count) > limit;
        if count >= limit {
            retained.clear();
            retained.extend_from_slice(&buffer[count.saturating_sub(limit)..count]);
        } else {
            let discard = retained.len().saturating_add(count).saturating_sub(limit);
            retained.drain(..discard);
            retained.extend_from_slice(&buffer[..count]);
        }
    }
}

fn read_bounded(mut reader: impl Read, limit: usize) -> std::io::Result<(Vec<u8>, bool)> {
    let mut retained = Vec::with_capacity(limit.min(64 * 1024));
    let mut buffer = [0_u8; 4096];
    let mut exceeded = false;
    loop {
        let count = reader.read(&mut buffer)?;
        if count == 0 {
            return Ok((retained, exceeded));
        }
        let remaining = limit.saturating_sub(retained.len());
        let copied = remaining.min(count);
        retained.write_all(&buffer[..copied])?;
        exceeded |= copied < count;
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn training_diagnostic_tail_stays_bounded_and_preserves_final_exception() {
        let mut output = vec![b'w'; 100_000];
        output.extend_from_slice(b"\nValueError: final diagnostic\n");
        let (retained, exceeded) = read_bounded_tail(output.as_slice(), 65_536).unwrap();
        assert!(exceeded);
        assert_eq!(retained.len(), 65_536);
        assert!(retained.ends_with(b"ValueError: final diagnostic\n"));
        let (small, exceeded) = read_bounded_tail(b"warning".as_slice(), 65_536).unwrap();
        assert_eq!(small, b"warning");
        assert!(!exceeded);
        assert_eq!(
            read_bounded_tail(b"warning".as_slice(), 0).unwrap(),
            (vec![], true)
        );
    }

    use crate::job_http::NativeJobRuntimeError;

    #[derive(Debug, Default)]
    struct RecordingTerminal {
        frames: std::sync::Mutex<Vec<(Option<f64>, String)>>,
    }

    impl ScientificJobTerminal for RecordingTerminal {
        fn progress(
            &self,
            _job_id: &str,
            progress: Option<f64>,
            message: &str,
        ) -> Result<(), NativeJobRuntimeError> {
            self.frames
                .lock()
                .unwrap()
                .push((progress, message.to_owned()));
            Ok(())
        }

        fn complete(&self, _job_id: &str, _result: Value) -> Result<(), NativeJobRuntimeError> {
            Ok(())
        }

        fn fail(&self, _job_id: &str, _reason: &str) -> Result<(), NativeJobRuntimeError> {
            Ok(())
        }

        fn acknowledge_cancel(&self, _job_id: &str) -> Result<(), NativeJobRuntimeError> {
            Ok(())
        }
    }

    /// The progress publisher exactly as the worker executes it, de-indented from its dispatcher branch.
    fn progress_publisher_source(until: &str) -> String {
        let start = EXECUTION_SCRIPT
            .find("        import threading,time\n")
            .expect("progress publisher");
        let end = start
            + EXECUTION_SCRIPT[start..]
                .find(until)
                .expect("progress publisher end");
        EXECUTION_SCRIPT[start..end]
            .lines()
            .map(|line| line.strip_prefix("        ").unwrap_or(line))
            .collect::<Vec<_>>()
            .join("\n")
    }

    /// Run `body` after the publisher and return the frames the Rust reader would publish.
    fn run_progress_publisher(
        until: &str,
        prelude: &str,
        body: &str,
    ) -> (Vec<(Option<f64>, String)>, Vec<u8>) {
        let script = format!(
            "import json,sys,time\n{prelude}\nrequest={{'job_id':'job-1'}}\n{}\n{body}\n",
            progress_publisher_source(until)
        );
        let python = if cfg!(windows) { "python" } else { "python3" };
        let output = Command::new(python)
            .args(["-I", "-S", "-c", &script])
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        let terminal = RecordingTerminal::default();
        read_training_stderr(output.stderr.as_slice(), 65_536, "job-1", Some(&terminal)).unwrap();
        let frames = terminal.frames.lock().unwrap().clone();
        (frames, output.stderr)
    }

    const PUBLISHER_DEFINITIONS_END: &str =
        "        publish_progress({\"progress\":None,\"message\":\"Loading";

    #[test]
    fn progress_publisher_flushes_the_trailing_event_and_heartbeats_without_inventing_progress() {
        let (frames, _) = run_progress_publisher(
            PUBLISHER_DEFINITIONS_END,
            "clock=[1000.0]\ntime.monotonic=lambda:clock[0]",
            r#"
def at(seconds):
    clock[0]=1000.0+seconds
at(0.0); publish_progress({"progress":10.0,"message":"Fold 1/3 (completed)"})
at(0.125); publish_progress({"progress":20.0,"message":"Fold 2/3 (running)"})
at(0.25); publish_progress({"progress":30.0,"message":"Fold 2/3 (completed)"})
at(0.875); progress_tick()
at(1.125); progress_tick()
at(2.5); progress_tick()
at(3.25); progress_tick()
at(5.5); progress_tick()
at(5.625); publish_progress({"progress":None,"message":"Refit (running)"})
at(8.0); progress_tick()
"#,
        );
        let expected: Vec<(Option<f64>, &str)> = vec![
            // Leading edge, then the newest throttled event once the window closes; the superseded one is dropped.
            (Some(10.0), "Fold 1/3 (completed)"),
            (Some(30.0), "Fold 2/3 (completed)"),
            // Silence of 2 s or more repeats the latest event with the age of that event, same progress.
            (Some(30.0), "Fold 2/3 (completed) · 3s elapsed"),
            (Some(30.0), "Fold 2/3 (completed) · 5s elapsed"),
            // A new event with unknown progress is throttled, flushed, and keeps its unknown progress.
            (None, "Refit (running)"),
        ];
        assert_eq!(
            frames,
            expected
                .into_iter()
                .map(|(progress, message)| (progress, message.to_owned()))
                .collect::<Vec<_>>()
        );
    }

    #[test]
    fn progress_publisher_flushes_a_throttled_event_before_any_heartbeat() {
        let (frames, _) = run_progress_publisher(
            PUBLISHER_DEFINITIONS_END,
            "clock=[1000.0]\ntime.monotonic=lambda:clock[0]",
            r#"
def at(seconds):
    clock[0]=1000.0+seconds
at(0.0); publish_progress({"progress":1.0,"message":"first"})
at(0.5); publish_progress({"progress":2.0,"message":"burst"})
at(1.25); progress_tick()
at(3.5); progress_tick()
"#,
        );
        assert_eq!(
            frames,
            vec![
                (Some(1.0), "first".to_owned()),
                (Some(2.0), "burst".to_owned()),
                (Some(2.0), "burst · 3s elapsed".to_owned()),
            ]
        );
    }

    #[test]
    fn progress_frames_stay_bounded_and_ascii_whatever_the_message() {
        let (frames, stderr) = run_progress_publisher(
            PUBLISHER_DEFINITIONS_END,
            "clock=[1000.0]\ntime.monotonic=lambda:clock[0]",
            r#"
long={"progress":50.0,"message":"é\U0001f600\"\\"*5000}
publish_progress(long)
clock[0]=1003.0
progress_tick()
publish_progress({"progress":float('nan'),"message":"rejected"})
clock[0]=1009.0
progress_tick()
"#,
        );
        assert_eq!(frames.len(), 2, "{frames:?}");
        for line in stderr
            .split(|byte| *byte == b'\n')
            .filter(|line| !line.is_empty())
        {
            assert!(line.len() <= 8192, "{}", line.len());
            assert!(line.is_ascii());
        }
        for (_, message) in &frames {
            assert!(
                message.chars().count() <= 500,
                "{}",
                message.chars().count()
            );
        }
        assert!(frames[1].1.ends_with(" · 3s elapsed"));
        assert_eq!(frames[0].0, Some(50.0));
    }

    #[test]
    fn progress_heartbeat_thread_republishes_during_a_long_silence_and_stops() {
        let (frames, _) = run_progress_publisher(
            "        try:\n            with observe_progress",
            "",
            "time.sleep(3.2)\nstop_heartbeat.set()\nheartbeat.join(1.0)\nassert not heartbeat.is_alive()",
        );
        assert_eq!(
            frames[0],
            (
                None,
                "Loading dataset and preparing scientific execution".to_owned()
            )
        );
        assert!(
            frames.len() >= 2 && frames.len() <= 3,
            "heartbeats are rate limited: {frames:?}"
        );
        for (progress, message) in &frames[1..] {
            assert_eq!(*progress, None);
            assert!(
                message.starts_with("Loading dataset and preparing scientific execution · "),
                "{message}"
            );
            assert!(message.ends_with("s elapsed"), "{message}");
        }
    }
    use super::*;

    #[cfg(unix)]
    #[test]
    fn document_adapters_survive_slow_cold_imports() {
        let directory = tempfile::tempdir().unwrap();
        let host = slow_document_host(directory.path());
        // Both interactive workers must survive their initial cold import:
        // preview and pipeline rendering wait beyond 15 seconds. No optional
        // Python is needed by this fixture.
        let results = std::thread::scope(|scope| {
            let handles = ["dataset.preview", "pipeline.render"].map(|operation| {
                let host = &host;
                scope.spawn(move || host.adapt_document(operation, &serde_json::json!({})))
            });
            handles.map(|handle| handle.join().unwrap())
        });
        let [preview, rendering] = results;
        let preview = preview.unwrap();
        assert_eq!(preview["success"], true);
        assert_eq!(preview["summary"]["num_samples"], 1);
        assert_eq!(rendering.unwrap()["filename"], "pipeline.yaml");
    }

    #[test]
    fn general_contract_keeps_batches_and_honest_absent_validation_scores() {
        let directory = tempfile::tempdir().unwrap();
        let workspace = directory.path().join("workspace");
        let dataset_a = directory.path().join("a.csv");
        let dataset_b = directory.path().join("b.csv");
        let mut request = serde_json::json!({"schema":"nirs4all.studio-scientific-job.v2", "operation":"run", "job_id":"general-run", "engine":"dag-ml", "allow_fallback":false,
            "pipeline":[[{"class":"sklearn.linear_model.Ridge"}],[{"class":"sklearn.ensemble.RandomForestRegressor"}]],
            "dataset":[{"train_x":dataset_a},{"train_x":dataset_b}],
            "options":{"workspace_path":workspace, "name":"General workflow", "random_state":7}});
        validate_scientific_request(&request, "general-run").unwrap();
        assert_eq!(request_limits(&request), (8 * 1024 * 1024, 256 * 1024));
        request["allow_fallback"] = serde_json::json!(true);
        assert!(validate_scientific_request(&request, "general-run").is_err());
        let mut response = serde_json::json!({"schema":"nirs4all.studio-scientific-job-result.v2", "job_id":"general-run", "engine":"dag-ml", "result":{
            "run_ids":["run-1"], "workspace_path":workspace, "native_results_dirs":[workspace.join("results/run-1")],
            "metric":"rmse", "validation_score":null, "evaluations":[], "chart_reports":[], "prediction_count":10,
            "model_names":["Ridge"], "dataset_names":["a"], "native_score_sets_available":true}});
        validate_scientific_response(&response, Some(&workspace)).unwrap();
        response["result"]["native_score_sets_available"] = serde_json::json!(false);
        assert!(validate_scientific_response(&response, Some(&workspace)).is_err());
    }

    #[test]
    fn general_archive_response_is_confined_to_the_authorized_workspace() {
        let directory = tempfile::tempdir().unwrap();
        let workspace = directory.path().join("workspace");
        fs::create_dir(&workspace).unwrap();
        let archive = workspace.join("multimodal.n4a");
        fs::write(&archive, b"archive").unwrap();
        let response = serde_json::json!({
            "schema":"nirs4all.studio-scientific-job-result.v2", "job_id":"general-run", "engine":"dag-ml",
            "result":{
                "run_ids":[], "workspace_path":workspace, "native_results_dirs":[],
                "archive_path":archive, "metric":"rmse", "validation_score":null,
                "evaluations":[], "chart_reports":[], "prediction_count":0,
                "model_names":[], "dataset_names":[], "native_score_sets_available":false
            }
        });
        assert!(validate_scientific_response(&response, Some(&workspace)).is_ok());
        let mut with_native_scores = response.clone();
        with_native_scores["result"]["native_score_sets_available"] = serde_json::json!(true);
        assert!(validate_scientific_response(&with_native_scores, Some(&workspace)).is_ok());

        let mut invalid = response.clone();
        invalid["result"]["run_ids"] = serde_json::json!(["run-1"]);
        assert!(validate_scientific_response(&invalid, Some(&workspace)).is_err());
        invalid = response.clone();
        invalid["result"]["native_results_dirs"] = serde_json::json!([workspace.join("results")]);
        assert!(validate_scientific_response(&invalid, Some(&workspace)).is_err());
        invalid = response.clone();
        invalid["result"]
            .as_object_mut()
            .unwrap()
            .remove("archive_path");
        assert!(validate_scientific_response(&invalid, Some(&workspace)).is_err());
        invalid = response.clone();
        invalid["result"]["workspace_path"] = serde_json::json!(directory.path());
        assert!(validate_scientific_response(&invalid, Some(&workspace)).is_err());

        let outside = directory.path().join("outside.n4a");
        fs::write(&outside, b"archive").unwrap();
        for path in [
            outside,
            workspace.join("missing.n4a"),
            workspace.join("../workspace/multimodal.n4a"),
            workspace.clone(),
        ] {
            invalid = response.clone();
            invalid["result"]["archive_path"] = serde_json::json!(path);
            assert!(validate_scientific_response(&invalid, Some(&workspace)).is_err());
        }
        let wrong_extension = workspace.join("multimodal.zip");
        fs::write(&wrong_extension, b"archive").unwrap();
        invalid = response;
        invalid["result"]["archive_path"] = serde_json::json!(wrong_extension);
        assert!(validate_scientific_response(&invalid, Some(&workspace)).is_err());
        #[cfg(unix)]
        {
            let symlink = workspace.join("alias.n4a");
            std::os::unix::fs::symlink(&archive, &symlink).unwrap();
            invalid["result"]["archive_path"] = serde_json::json!(symlink);
            assert!(validate_scientific_response(&invalid, Some(&workspace)).is_err());
        }
    }
    #[test]
    fn document_batch_and_inspection_have_distinct_bounded_wire_budgets() {
        use serde_json::json;
        for (operation, expected) in [
            ("pipeline.normalize", (2 * 1024 * 1024, 2 * 1024 * 1024)),
            ("documents.batch", (8 * 1024 * 1024, 8 * 1024 * 1024)),
            ("dataset.preview", (2 * 1024 * 1024, 32 * 1024 * 1024)),
            ("dataset.stats", (2 * 1024 * 1024, 32 * 1024 * 1024)),
            ("predictions.catalogue", (2 * 1024 * 1024, 32 * 1024 * 1024)),
            ("predictions.run", (32 * 1024 * 1024, 32 * 1024 * 1024)),
            ("predictions.file", (32 * 1024 * 1024, 32 * 1024 * 1024)),
        ] {
            assert_eq!(
                request_limits(
                    &json!({"schema":crate::document_cpython::REQUEST_SCHEMA,"operation":operation})
                ),
                expected
            );
        }
        assert!(EXECUTION_SCRIPT.contains("JSONEncoder(allow_nan=False"));
        assert!(EXECUTION_SCRIPT.contains("response_limit-len(encoded)"));
    }

    #[test]
    fn closed_library_facades_have_distinct_limits_and_typed_responses() {
        let synthesis = serde_json::json!({
            "schema":"nirs4all.studio-synthetic-dataset-job.v1",
            "request_id":"synthetic-1"
        });
        let playground = serde_json::json!({
            "schema":"nirs4all.studio-playground-job.v1",
            "request_id":"playground-1"
        });
        assert_eq!(request_limits(&synthesis), (65_536, 65_536));
        assert_eq!(
            request_limits(&playground),
            (8 * 1024 * 1024, 32 * 1024 * 1024)
        );
        validate_library_facade_response(
            "nirs4all.studio-synthetic-dataset-job.v1",
            &serde_json::json!({
                "schema":"nirs4all.studio-synthetic-dataset-result.v1",
                "request_id":"synthetic-1",
                "result":{}
            }),
        )
        .unwrap();
        validate_library_facade_response(
            "nirs4all.studio-playground-job.v1",
            &serde_json::json!({
                "schema":"nirs4all.studio-playground-result.v1",
                "request_id":"playground-1",
                "operation":"capabilities",
                "result":{},
                "wire_diagnostics":{}
            }),
        )
        .unwrap();
        validate_library_facade_response(
            "nirs4all.studio-playground-job.v1",
            &serde_json::json!({
                "schema":"nirs4all.studio-library-error.v1",
                "request_id":"playground-1",
                "error":{"code":"invalid_shape","message":"closed refusal"}
            }),
        )
        .unwrap();
        assert!(EXECUTION_SCRIPT.contains("studio_synthetic_dataset_job_v1 as facade"));
        assert!(EXECUTION_SCRIPT.contains("studio_playground_job_v1 as facade"));
    }

    #[test]
    fn worker_serializes_multiline_library_refusals_without_relaxing_validation() {
        let helper = EXECUTION_SCRIPT
            .split("def deny_product_network")
            .next()
            .unwrap();
        let script = format!(
            "{helper}\nresponse={{'schema':'nirs4all.studio-library-error.v1','request_id':'multiline','error':{{'code':'dataset_load_failed','message':bounded_library_error_message(ValueError('validation\\nfailed\\t'+'é'*5000+'\\u0085'))}}}}\nsys.stdout.buffer.write(json.dumps(response,ensure_ascii=False).encode('utf-8'))"
        );
        let python = if cfg!(windows) { "python" } else { "python3" };
        let output = Command::new(python)
            .args(["-I", "-S", "-c", &script])
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        let request = serde_json::json!({"schema":"nirs4all.studio-playground-job.v1","request_id":"multiline"});
        let response = validate_worker_response(&request, &output.stdout, "multiline").unwrap();
        let message = response["error"]["message"].as_str().unwrap();
        assert!(message.starts_with("validation failed "));
        assert!(message.len() <= 4000);
        assert!(!message.chars().any(char::is_control));
        let mut invalid = response.clone();
        invalid["error"]["message"] = serde_json::json!("validation\nfailed");
        assert_eq!(
            validate_worker_response(
                &request,
                &serde_json::to_vec(&invalid).unwrap(),
                "multiline"
            ),
            Err(ScientificCpythonUnavailable::MalformedResponse)
        );
        assert_eq!(
            validate_worker_response(&request, &output.stdout, "wrong-id"),
            Err(ScientificCpythonUnavailable::MalformedResponse)
        );
    }

    #[test]
    fn windows_platform_probe_precedes_the_subprocess_deny_hook() {
        for script in [PREFLIGHT_SCRIPT, EXECUTION_SCRIPT] {
            let platform_guard = script
                .find("if sys.platform == \"win32\":\n    platform.machine()")
                .expect("Windows platform preheat must remain explicit");
            let audit_hook = script
                .find("sys.addaudithook(deny_product_network)")
                .expect("the subprocess-denying audit hook must remain installed");
            assert!(platform_guard < audit_hook);
        }
    }

    #[cfg(unix)]
    #[test]
    fn selected_venv_reuses_preflight_process_for_interactive_requests() {
        let Some(python) = std::env::var_os("N4A_STUDIO_REAL_PYTHON").map(PathBuf::from) else {
            return;
        };
        let Some(site_packages) =
            std::env::var_os("N4A_STUDIO_REAL_SITE_PACKAGES").map(PathBuf::from)
        else {
            return;
        };
        let config = tempfile::tempdir().unwrap();
        let executor = CpythonScientificJobExecutor::acquire(
            &python,
            site_packages,
            adapters_fixture(config.path()),
            config.path().join("config"),
        );
        assert!(
            executor.library_facades_available(),
            "{}",
            executor.unavailable_reason()
        );
        assert_eq!(
            executor.host.as_ref().unwrap().python,
            std::path::absolute(&python).unwrap()
        );
        let process_id = executor.warm_workers[0]
            .lock()
            .unwrap()
            .as_ref()
            .unwrap()
            .process_id();
        let request = serde_json::json!({
            "schema":"nirs4all.studio-playground-job.v1", "request_id":"warm-test",
            "operation":"capabilities", "payload":{}
        });
        let first = executor.invoke_library_facade(&request).unwrap();
        for _ in 0..5 {
            assert_eq!(executor.invoke_library_facade(&request).unwrap(), first);
            assert_eq!(
                executor.warm_workers[0]
                    .lock()
                    .unwrap()
                    .as_ref()
                    .unwrap()
                    .process_id(),
                process_id
            );
        }
        assert!(executor.warm_workers[1].lock().unwrap().is_some());
        // Simulate a crashed interpreter without changing the selected venv.
        nix::sys::signal::kill(
            nix::unistd::Pid::from_raw(i32::try_from(process_id).unwrap()),
            nix::sys::signal::Signal::SIGKILL,
        )
        .unwrap();
        // A process holding the scientific stack takes a moment to be torn down.
        std::thread::sleep(Duration::from_millis(500));
        assert_eq!(executor.invoke_library_facade(&request).unwrap(), first);
        assert_ne!(
            executor.warm_workers[0]
                .lock()
                .unwrap()
                .as_ref()
                .unwrap()
                .process_id(),
            process_id
        );
    }

    #[cfg(unix)]
    use std::{fs, net::TcpListener, time::SystemTime};

    #[cfg(unix)]
    fn test_directory(name: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!(
            "studio-scientific-cpython-{name}-{}-{nonce}",
            std::process::id()
        ))
    }

    #[cfg(unix)]
    fn shell_host(directory: &Path, name: &str, body: &str) -> PathBuf {
        use std::os::unix::fs::PermissionsExt;

        fs::create_dir_all(directory).unwrap();
        let path = directory.join(name);
        fs::write(&path, format!("#!/bin/sh\n{body}\n")).unwrap();
        let mut permissions = fs::metadata(&path).unwrap().permissions();
        permissions.set_mode(0o700);
        fs::set_permissions(&path, permissions).unwrap();
        std::thread::sleep(Duration::from_millis(10));
        path
    }

    /// The application's adapters directory, written from the compiled manifest.
    #[cfg(unix)]
    fn adapters_fixture(root: &Path) -> PathBuf {
        let directory = root.join("adapters");
        let repository = Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap();
        let manifest: Value = serde_json::from_str(include_str!(
            "../contracts/studio_document_adapters_v1.json"
        ))
        .unwrap();
        for entry in manifest["files"].as_array().unwrap() {
            let relative = entry["path"].as_str().unwrap();
            let target = directory.join("studio_document_adapters").join(relative);
            std::fs::create_dir_all(target.parent().unwrap()).unwrap();
            if relative.ends_with("__init__.py") {
                std::fs::write(
                    target,
                    "\"\"\"Pure document translation package; no HTTP or application state.\"\"\"\n",
                )
                .unwrap();
            } else {
                std::fs::copy(repository.join(relative), target).unwrap();
            }
        }
        directory
    }

    /// An executor whose host was admitted, without running a probe.
    #[cfg(unix)]
    fn admitted_executor(python: &Path, root: &Path) -> CpythonScientificJobExecutor {
        CpythonScientificJobExecutor {
            host: Some(test_host(python, root)),
            dataset_cache_scope: NEXT_DATASET_CACHE_SCOPE.fetch_add(1, Ordering::Relaxed),
            acquisition: ScientificCpythonUnavailable::RequestResolverUnavailable,
            resolver: ScientificRequestResolver::new(root.join("config")),
            running: Arc::new(Mutex::new(BTreeMap::new())),
            terminal_callback_failed: Arc::new(AtomicBool::new(false)),
            warm_workers: std::array::from_fn(|_| Mutex::new(None)),
        }
    }

    #[cfg(unix)]
    fn test_host(python: &Path, root: &Path) -> ScientificHost {
        ScientificHost {
            python: python.to_path_buf(),
            site_packages: root.join("site-packages"),
            adapters: root.join("adapters"),
            distribution_version: "2.3.4".into(),
        }
    }

    #[cfg(unix)]
    fn slow_document_host(root: &Path) -> CpythonScientificJobExecutor {
        let host = shell_host(
            &root.join("bin"),
            "python3",
            r#"sleep 16
while IFS= read -r request; do
case "$request" in
  *dataset.preview*) result='{"success":true,"error":null,"summary":{"num_samples":1,"num_features":2},"spectra_preview":null}' ;;
  *) result='{"json":"{}","yaml":"{}","filename":"pipeline.yaml"}' ;;
esac
printf '{"schema":"nirs4all.studio-document-response.v1","job_id":"document-translation","success":true,"result":%s,"error":null}' "$result" | /usr/bin/python3 -c 'import sys; data=sys.stdin.buffer.read(); sys.stdout.buffer.write(len(data).to_bytes(4,"little")+data);sys.stdout.buffer.flush()'
done"#,
        );
        admitted_executor(&host, root)
    }

    /// An admission report as the probe prints it, with selected fields replaced.
    fn probe_report(changes: &Value) -> Vec<u8> {
        let mut report = serde_json::json!({
            "schema": "nirs4all.studio-scientific-cpython-host.v2",
            "implementation": "cpython",
            "version": [3, 11, 13],
            "isolated": true,
            "network_bind_denied": true,
            "distribution_version": "2.3.4",
            "import_error": null,
            "ready": true,
        });
        for (key, value) in changes.as_object().unwrap() {
            report[key] = value.clone();
        }
        serde_json::to_vec(&report).unwrap()
    }

    #[test]
    fn range_check_follows_pep_440_ordering_for_the_supported_clauses() {
        for (version, supported) in [
            ("2.3.2", false),
            ("2.3.3", false),
            ("2.3.4", true),
            ("2.3.5", true),
            ("2.3.5rc1", true),
            ("2.3.99.post1", true),
            ("2.3.4.0", true),
            ("2.3.4+local.build", true),
            ("2.3.4rc1", false),
            ("2.3.4.dev0", false),
            ("2.4", false),
            ("2.4.0", false),
            ("2.4.0rc1", false),
            ("3.0.0", false),
            ("unknown", false),
        ] {
            assert_eq!(
                distribution_version_supported(version, ">=2.3.4,<2.4"),
                supported,
                "{version}"
            );
        }
        assert!(distribution_version_supported("0.1", ""));
        assert!(distribution_version_supported(
            "2.0",
            ">1.9, <=2.0, !=1.9.5"
        ));
        assert!(!distribution_version_supported("4.9.5", ">4.9,!=4.9.5"));
        assert!(distribution_version_supported("2.3.4", "==2.3.4"));
        for unsupported in ["~=2.3", "==2.3.*", "===2.3.4", "2.3.4", ">=latest"] {
            assert!(
                !distribution_version_supported("2.3.4", unsupported),
                "{unsupported}"
            );
        }
    }

    #[test]
    fn admitted_range_comes_from_the_embedded_catalogue() {
        let catalogue: Value =
            serde_json::from_str(include_str!("../../recommended-config.json")).unwrap();
        let required = catalogue["required"]
            .as_array()
            .unwrap()
            .iter()
            .find(|package| package["name"] == "nirs4all")
            .unwrap();
        let range = crate::recommended_config::nirs4all_range().unwrap();
        assert_eq!(required["range"], range.as_str());
        assert!(!range.is_empty());
        // The version Studio installs is one it admits.
        let install = required["install"].as_str().unwrap();
        assert_eq!(
            admitted_distribution(
                &probe_report(&serde_json::json!({"distribution_version": install})),
                &range
            )
            .as_deref(),
            Ok(install)
        );
        // No host script repeats a version: the worker receives the admitted one.
        for script in [PREFLIGHT_SCRIPT, EXECUTION_SCRIPT] {
            assert!(!script.contains(install), "{install} repeated in a script");
        }
        assert!(
            EXECUTION_SCRIPT.contains("importlib.metadata.version(\"nirs4all\") != sys.argv[3]")
        );
    }

    #[test]
    fn admission_reports_the_first_real_refusal() {
        use ScientificCpythonUnavailable as Refusal;
        let range = ">=2.3.4,<2.4";
        for (changes, expected) in [
            (
                serde_json::json!({"implementation": "pypy"}),
                Refusal::NotCpython,
            ),
            (
                serde_json::json!({"version": [3, 10, 12]}),
                Refusal::UnsupportedPythonVersion,
            ),
            (
                serde_json::json!({"isolated": false}),
                Refusal::IsolationDisabled,
            ),
            (
                serde_json::json!({"network_bind_denied": false}),
                Refusal::NetworkGuardFailed,
            ),
            (
                serde_json::json!({"distribution_version": null, "ready": false}),
                Refusal::DistributionMissing,
            ),
            (
                serde_json::json!({"distribution_version": "2.4.0"}),
                Refusal::DistributionVersionUnsupported,
            ),
            (
                serde_json::json!({"distribution_version": "2.3.3"}),
                Refusal::DistributionVersionUnsupported,
            ),
            (
                serde_json::json!({"import_error": "ImportError: missing dependency", "ready": false}),
                Refusal::LibraryImportFailed,
            ),
            (
                serde_json::json!({"ready": false}),
                Refusal::CallableUnavailable,
            ),
            (
                serde_json::json!({"schema": "other"}),
                Refusal::MalformedResponse,
            ),
            (
                serde_json::json!({"version": "3.11"}),
                Refusal::MalformedResponse,
            ),
        ] {
            assert_eq!(
                admitted_distribution(&probe_report(&changes), range),
                Err(expected),
                "{changes}"
            );
        }
        assert_eq!(
            admitted_distribution(b"nope", range),
            Err(Refusal::MalformedResponse)
        );
        assert_eq!(
            admitted_distribution(&probe_report(&serde_json::json!({})), range).as_deref(),
            Ok("2.3.4")
        );
        assert_eq!(
            Refusal::DistributionMissing.reason(),
            "scientific_distribution_missing"
        );
        assert_eq!(
            Refusal::DistributionVersionUnsupported.reason(),
            "scientific_distribution_version_unsupported"
        );
    }

    /// A real virtual environment without pip, on a supported interpreter.
    #[cfg(unix)]
    fn virtual_environment(root: &Path) -> Option<(PathBuf, PathBuf)> {
        let base = ["python3.13", "python3.12", "python3.11", "python3"]
            .into_iter()
            .find(|name| {
                Command::new(name)
                    .args([
                        "-I",
                        "-B",
                        "-c",
                        "import sys; sys.exit(sys.version_info < (3, 11))",
                    ])
                    .status()
                    .is_ok_and(|status| status.success())
            })?;
        let venv = root.join("venv");
        let created = Command::new(base)
            .args(["-I", "-m", "venv", "--without-pip"])
            .arg(&venv)
            .status()
            .unwrap();
        assert!(created.success());
        let site_packages = std::fs::read_dir(venv.join("lib"))
            .unwrap()
            .next()
            .unwrap()
            .unwrap()
            .path()
            .join("site-packages");
        Some((venv.join("bin/python"), site_packages))
    }

    /// Distribution metadata for a nirs4all release, without any module.
    #[cfg(unix)]
    fn write_nirs4all_metadata(site_packages: &Path, version: &str) -> PathBuf {
        let metadata = site_packages.join(format!("nirs4all-{version}.dist-info"));
        std::fs::create_dir_all(&metadata).unwrap();
        std::fs::write(
            metadata.join("METADATA"),
            format!("Metadata-Version: 2.1\nName: nirs4all\nVersion: {version}\n"),
        )
        .unwrap();
        metadata
    }

    #[cfg(unix)]
    const STUDIO_CALLABLES: &str =
        "def studio_scientific_job_v1(request): return request\ndef studio_scientific_job_v2(request): return request\n";

    #[cfg(unix)]
    fn write_nirs4all_package(directory: &Path, source: &str) {
        std::fs::create_dir_all(directory.join("nirs4all")).unwrap();
        std::fs::write(directory.join("nirs4all/__init__.py"), source).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn admission_accepts_in_range_and_editable_installs_and_names_each_refusal() {
        let root = tempfile::tempdir().unwrap();
        let Some((python, site_packages)) = virtual_environment(root.path()) else {
            return;
        };
        let adapters = adapters_fixture(root.path());
        let acquire = || {
            CpythonScientificJobExecutor::acquire(
                &python,
                &site_packages,
                &adapters,
                root.path().join("config"),
            )
        };

        // No nirs4all distribution at all.
        assert_eq!(
            acquire().unavailable_reason(),
            "scientific_distribution_missing"
        );

        // A release outside the catalogue range, read from metadata only.
        let outside = write_nirs4all_metadata(&site_packages, "0.0.1");
        write_nirs4all_package(
            &site_packages,
            "raise RuntimeError('must not be imported')\n",
        );
        assert_eq!(
            acquire().unavailable_reason(),
            "scientific_distribution_version_unsupported"
        );
        std::fs::remove_dir_all(outside).unwrap();

        // The version Studio installs, as a regular wheel layout.
        let catalogue: Value =
            serde_json::from_str(include_str!("../../recommended-config.json")).unwrap();
        let install = catalogue["required"][0]["install"].as_str().unwrap();
        assert_eq!(catalogue["required"][0]["name"], "nirs4all");
        let wheel = write_nirs4all_metadata(&site_packages, install);
        assert_eq!(
            acquire().unavailable_reason(),
            "scientific_library_import_failed"
        );
        write_nirs4all_package(&site_packages, "VALUE = 1\n");
        assert_eq!(
            acquire().unavailable_reason(),
            "scientific_callable_unavailable"
        );
        write_nirs4all_package(&site_packages, STUDIO_CALLABLES);
        let admitted = acquire();
        assert!(
            admitted.library_facades_available(),
            "{}",
            admitted.unavailable_reason()
        );
        assert_eq!(admitted.distribution_version(), Some(install));
        // The selected environment is kept: a venv interpreter is a link.
        assert_eq!(admitted.host.as_ref().unwrap().python, python);
        assert!(admitted.warm_workers[0].lock().unwrap().is_some());
        drop(admitted);
        std::fs::remove_dir_all(wheel).unwrap();
        std::fs::remove_dir_all(site_packages.join("nirs4all")).unwrap();

        // The same release as an editable install: the package lives in a source
        // checkout, site-packages holds only metadata and a path file.
        let checkout = root.path().join("checkout");
        write_nirs4all_package(&checkout, STUDIO_CALLABLES);
        let editable = write_nirs4all_metadata(&site_packages, install);
        std::fs::write(
            editable.join("direct_url.json"),
            serde_json::json!({"url": format!("file://{}", checkout.display()), "dir_info": {"editable": true}})
                .to_string(),
        )
        .unwrap();
        std::fs::write(
            site_packages.join("__editable__.nirs4all.pth"),
            format!("{}\n", checkout.display()),
        )
        .unwrap();
        let admitted = acquire();
        assert!(
            admitted.library_facades_available(),
            "{}",
            admitted.unavailable_reason()
        );
        assert_eq!(admitted.distribution_version(), Some(install));
    }

    #[cfg(unix)]
    #[test]
    fn adapters_are_imported_from_the_application_directory() {
        let root = tempfile::tempdir().unwrap();
        let Some((python, site_packages)) = virtual_environment(root.path()) else {
            return;
        };
        // A copy left in the environment by an older Studio must not win.
        let stale = site_packages.join("studio_document_adapters");
        std::fs::create_dir_all(&stale).unwrap();
        std::fs::write(stale.join("__init__.py"), "SOURCE = 'environment'\n").unwrap();
        let adapters = root.path().join("application-adapters");
        std::fs::create_dir_all(adapters.join("studio_document_adapters")).unwrap();
        std::fs::write(
            adapters.join("studio_document_adapters/__init__.py"),
            "SOURCE = 'application'\n",
        )
        .unwrap();
        let host = ScientificHost {
            python,
            site_packages,
            adapters,
            distribution_version: String::new(),
        };
        let scratch = ScratchDirectory::create().unwrap();
        let script = concat!(
            host_bootstrap!(),
            "import studio_document_adapters\nprint(studio_document_adapters.SOURCE)\n"
        );
        let output = scientific_worker_command(&host, &scratch.path, script)
            .unwrap()
            .stdin(Stdio::null())
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        assert_eq!(
            String::from_utf8_lossy(&output.stdout).trim(),
            "application"
        );
    }

    #[cfg(unix)]
    #[test]
    fn acquisition_refuses_missing_or_altered_application_adapters() {
        let root = tempfile::tempdir().unwrap();
        let host = shell_host(&root.path().join("bin"), "python3", "exit 0");
        let site_packages = root.path().join("site-packages");
        std::fs::create_dir_all(&site_packages).unwrap();
        let adapters = adapters_fixture(root.path());
        let member = adapters.join("studio_document_adapters/api/library_documents.py");
        let original = std::fs::read(&member).unwrap();
        std::fs::write(&member, b"pass\n").unwrap();
        for directory in [adapters.clone(), root.path().join("missing-adapters")] {
            assert_eq!(
                CpythonScientificJobExecutor::acquire(
                    &host,
                    &site_packages,
                    directory,
                    root.path().join("config")
                )
                .unavailable_reason(),
                "studio_adapters_unavailable"
            );
        }
        // With the application's own bytes the probe is reached.
        std::fs::write(&member, original).unwrap();
        assert_eq!(
            CpythonScientificJobExecutor::acquire(
                &host,
                &site_packages,
                &adapters,
                root.path().join("config")
            )
            .unavailable_reason(),
            "python_host_output_read_failed"
        );
    }

    #[cfg(windows)]
    #[test]
    fn windows_scientific_command_routes_through_the_job_launcher() {
        use std::ffi::OsStr;

        let command = contained_scientific_command(Path::new(r"C:\Python311\python.exe")).unwrap();
        let arguments = command.get_args().collect::<Vec<_>>();
        assert_eq!(arguments.len(), 2);
        assert_eq!(
            arguments[0],
            OsStr::new(WINDOWS_SCIENTIFIC_JOB_LAUNCHER_ARGUMENT)
        );
        assert_eq!(arguments[1], OsStr::new(r"C:\Python311\python.exe"));
        assert!(platform_kill_tree_qualified());
    }

    #[cfg(unix)]
    #[test]
    fn worker_scratch_is_created_with_private_unix_permissions() {
        use std::os::unix::fs::PermissionsExt;

        let scratch = ScratchDirectory::create().unwrap();
        assert_eq!(
            fs::metadata(&scratch.path).unwrap().permissions().mode() & 0o777,
            0o700
        );
    }

    #[test]
    fn closed_stdio_shapes_reject_workspace_manifest_and_result_extensions() {
        let job_id = "run_native_closed_shape";
        let request = serde_json::json!({
            "schema": "nirs4all.studio-scientific-job.v1",
            "operation": "run",
            "job_id": job_id,
            "engine": "dag-ml",
            "allow_fallback": false,
            "dataset": {
                "name": "closed-shape",
                "task_type": "regression",
                "X": [[0.0], [1.0], [2.0], [3.0]],
                "y": [0.1, 1.2, 2.1, 3.4]
            },
            "pipeline": {
                "kind": "pls_regression",
                "n_components": 1,
                "scale": true,
                "cross_validation": {"kind": "kfold", "n_splits": 2, "shuffle": false}
            },
            "options": {"name": "closed-shape", "random_state": 42}
        });
        validate_scientific_request(&request, job_id).unwrap();
        for forbidden in ["workspace_path", "manifest", "legacyConfig"] {
            let mut invalid = request.clone();
            invalid[forbidden] = Value::String("must-not-cross-stdio".into());
            assert_eq!(
                validate_scientific_request(&invalid, job_id),
                Err(ScientificCpythonUnavailable::InvalidRequest)
            );
        }

        let mut response = serde_json::json!({
            "schema": "nirs4all.studio-scientific-job-result.v1",
            "job_id": job_id,
            "engine": "dag-ml",
            "result": {
                "model": "pls_regression",
                "task_type": "regression",
                "metric": "rmse",
                "validation_score": 0.25,
                "training_score": 0.125,
                "prediction_count": 4
            }
        });
        validate_scientific_response(&response, None).unwrap();
        response["workspace"] = serde_json::json!({"path": "/forbidden"});
        assert_eq!(
            validate_scientific_response(&response, None),
            Err(ScientificCpythonUnavailable::MalformedResponse)
        );
    }

    #[cfg(unix)]
    #[test]
    fn missing_interpreter_or_environment_is_reported_as_unavailable() {
        let root = tempfile::tempdir().unwrap();
        let adapters = adapters_fixture(root.path());
        let site_packages = root.path().join("site-packages");
        std::fs::create_dir_all(&site_packages).unwrap();
        let missing = CpythonScientificJobExecutor::acquire(
            root.path().join("missing-python"),
            &site_packages,
            &adapters,
            root.path().join("config"),
        );
        assert_eq!(missing.unavailable_reason(), "python_host_unavailable");
        assert!(!missing.library_facades_available());
        assert!(!missing.acquisition_timed_out());
        let host = shell_host(&root.path().join("bin"), "python3", "exit 0");
        assert_eq!(
            CpythonScientificJobExecutor::acquire(
                &host,
                root.path().join("missing-site-packages"),
                &adapters,
                root.path().join("config"),
            )
            .unavailable_reason(),
            "python_host_unavailable"
        );
    }

    #[cfg(unix)]
    fn framed_host_response(json_printf: &str) -> String {
        format!("{json_printf} | /usr/bin/python3 -c 'import sys; data=sys.stdin.buffer.read(); sys.stdout.buffer.write(len(data).to_bytes(4, chr(108)+chr(105)+chr(116)+chr(116)+chr(108)+chr(101))); sys.stdout.buffer.write(data)'")
    }

    #[cfg(unix)]
    #[test]
    fn first_launch_library_readiness_does_not_require_a_saved_dataset_catalogue() {
        let directory = tempfile::tempdir().unwrap();
        let host = shell_host(&directory.path().join("bin"), "python3", "exit 0");
        let config = directory.path().join("config");
        // Model an admitted host on the very first launch. The saved-run
        // resolver is deliberately absent: inline library features and setup
        // must be usable before the user registers any datasets.
        let scientific_host = Arc::new(admitted_executor(&host, directory.path()));
        assert!(!scientific_host.resolver.is_configured());
        assert!(!scientific_host.is_selected());
        assert!(scientific_host.library_facades_available());
        let executor: Arc<dyn ScientificJobExecutor> = scientific_host.clone();
        let native_jobs = Arc::new(crate::NativeJobRuntime::with_executor(executor));
        let mut state =
            crate::SidecarState::with_native_jobs_and_app_settings_dir(native_jobs, config.clone());
        state.scientific_host = Some(scientific_host);

        let readiness: Value = serde_json::from_str(&state.legacy_readiness_json()).unwrap();
        assert_eq!(readiness["ml_ready"], true);
        assert_eq!(readiness["ml_error"], Value::Null);
        let capabilities: Value = serde_json::from_str(&state.capabilities_json()).unwrap();
        assert_eq!(capabilities["features"]["scientific_execution"], false);

        // A refused host blocks setup and inline features, with its reason.
        let refused = Arc::new(CpythonScientificJobExecutor::unavailable(
            ScientificCpythonUnavailable::DistributionVersionUnsupported,
            config.clone(),
        ));
        let executor: Arc<dyn ScientificJobExecutor> = refused.clone();
        let native_jobs = Arc::new(crate::NativeJobRuntime::with_executor(executor));
        let mut state =
            crate::SidecarState::with_native_jobs_and_app_settings_dir(native_jobs, config);
        state.scientific_host = Some(refused);
        let readiness: Value = serde_json::from_str(&state.legacy_readiness_json()).unwrap();
        assert_eq!(readiness["ml_ready"], false);
        assert_eq!(
            readiness["ml_error"],
            "scientific_distribution_version_unsupported"
        );
    }

    #[cfg(unix)]
    #[test]
    fn capability_projection_keeps_rust_polling_independent_of_the_scientific_host() {
        let directory = tempfile::tempdir().unwrap();
        let host = shell_host(&directory.path().join("bin"), "python3", "exit 0");
        let scientific_host = Arc::new(admitted_executor(&host, directory.path()));
        let executor: Arc<dyn ScientificJobExecutor> = scientific_host.clone();
        let native_jobs = Arc::new(crate::NativeJobRuntime::with_executor(executor));
        let mut state = crate::SidecarState::with_native_jobs_and_app_settings_dir(
            native_jobs,
            directory.path().join("config"),
        );
        state.scientific_host = Some(scientific_host);
        let before: Value = serde_json::from_str(&state.capabilities_json()).unwrap();
        assert_eq!(before["features"]["playground_routes"], true);

        let projection = crate::route_request(
            &mut state,
            "GET",
            "/sidecar/v1/capabilities?capability=readiness",
        );
        assert_eq!(projection.status, 200);
        let projection: Value = serde_json::from_str(&projection.body).unwrap();
        assert_eq!(projection["capability_projection"], "readiness");
        assert_eq!(projection["features"]["readiness"], true);
        assert!(projection["features"].get("playground_routes").is_none());
        assert_eq!(
            projection["features"]["implicit_python_http_fallback"],
            false
        );

        // Without an admitted host, Rust polling still answers and science is off.
        state.scientific_host = Some(Arc::new(CpythonScientificJobExecutor::unavailable(
            ScientificCpythonUnavailable::DistributionMissing,
            directory.path().join("config"),
        )));
        let polling = crate::route_request(
            &mut state,
            "GET",
            "/sidecar/v1/capabilities?capability=readiness",
        );
        assert_eq!(polling.status, 200);
        let polling: Value = serde_json::from_str(&polling.body).unwrap();
        assert_eq!(polling["features"]["readiness"], true);
        assert!(polling["features"]
            .get("aggregated_prediction_result_routes")
            .is_none());
        let science = crate::route_request(
            &mut state,
            "GET",
            "/sidecar/v1/capabilities?capability=aggregated_prediction_result_routes",
        );
        assert_eq!(science.status, 200);
        let science: Value = serde_json::from_str(&science.body).unwrap();
        assert_eq!(
            science["features"]["aggregated_prediction_result_routes"],
            false
        );
        let after: Value = serde_json::from_str(&state.capabilities_json()).unwrap();
        assert_eq!(after["features"]["playground_routes"], false);
        assert_eq!(
            before["features"]
                .as_object()
                .unwrap()
                .keys()
                .collect::<Vec<_>>(),
            after["features"]
                .as_object()
                .unwrap()
                .keys()
                .collect::<Vec<_>>()
        );
        for query in [
            "",
            "capability=",
            "capability=unknown",
            "capability=readiness&capability=health",
            "capability=readiness&other=1",
        ] {
            let refused = crate::route_request(
                &mut state,
                "GET",
                &format!("/sidecar/v1/capabilities?{query}"),
            );
            assert_eq!(refused.status, 400, "{query}");
        }
    }

    #[cfg(unix)]
    #[test]
    fn failed_training_worker_retains_bounded_exception_diagnostic() {
        let root = test_directory("training-diagnostic");
        let host = shell_host(
            &root,
            "python",
            "cat >/dev/null; head -c 6000 /dev/zero | tr '\\000' x >&2; printf '\\nModuleNotFoundError: No module named tabpfn\\n' >&2; exit 1",
        );
        let (result, diagnostic) = run_scientific_process(
            &test_host(&host, &root),
            br#"{"job_id":"diagnostic-job"}"#,
            &AtomicBool::new(false),
            None,
        );
        assert_eq!(result, Err(ScientificCpythonUnavailable::ProcessFailed));
        let diagnostic = diagnostic.unwrap();
        assert!(diagnostic.starts_with("python_host_process_failed"));
        assert!(diagnostic.contains("ModuleNotFoundError: No module named tabpfn"));
        assert!(diagnostic.len() < 4300);
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn acquisition_refuses_malformed_impostor_slow_and_oversized_probes() {
        let root = tempfile::tempdir().unwrap();
        let adapters = adapters_fixture(root.path());
        let site_packages = root.path().join("site-packages");
        std::fs::create_dir_all(&site_packages).unwrap();
        let impostor =
            String::from_utf8(probe_report(&serde_json::json!({"implementation": "pypy"})))
                .unwrap();
        for (name, body, timeout, expected) in [
            (
                "malformed",
                framed_host_response("printf nope"),
                Duration::from_secs(5),
                "python_host_malformed_response",
            ),
            (
                "impostor",
                framed_host_response(&format!("printf '%s' '{impostor}'")),
                Duration::from_secs(5),
                "python_host_not_cpython",
            ),
            (
                "oversized",
                framed_host_response("head -c 9000 /dev/zero | tr '\\000' x"),
                Duration::from_secs(5),
                "python_host_stdout_too_large",
            ),
            (
                "silent",
                "exit 3".to_owned(),
                Duration::from_secs(5),
                "python_host_output_read_failed",
            ),
            (
                "slow",
                "sleep 2".to_owned(),
                Duration::from_millis(50),
                "python_host_timed_out",
            ),
        ] {
            let host = shell_host(&root.path().join("bin"), name, &body);
            let started = Instant::now();
            let executor = CpythonScientificJobExecutor::acquire_within(
                &host,
                &site_packages,
                &adapters,
                root.path().join("config"),
                timeout,
            );
            assert_eq!(executor.unavailable_reason(), expected, "{name}");
            assert_eq!(executor.acquisition_timed_out(), name == "slow");
            // A timeout ends the probe instead of waiting for the host to exit.
            assert!(name != "slow" || started.elapsed() < Duration::from_secs(2));
        }
    }

    #[test]
    fn preflight_process_diagnostic_is_bounded_and_removes_controls() {
        let mut stderr = vec![b'x'; 5000];
        stderr[1] = 0;
        let diagnostic = bounded_process_diagnostic(&stderr);
        assert!(diagnostic.starts_with("x\u{fffd}x"));
        assert_eq!(diagnostic.chars().count(), 4096);
        assert_eq!(bounded_process_diagnostic(b""), "(empty stderr)");
    }

    #[test]
    fn windows_runtime_architecture_is_derived_from_the_compiled_target() {
        assert_eq!(
            windows_processor_architecture(),
            if cfg!(target_arch = "x86_64") {
                Some("AMD64")
            } else if cfg!(target_arch = "aarch64") {
                Some("ARM64")
            } else if cfg!(target_arch = "x86") {
                Some("x86")
            } else {
                None
            }
        );
    }

    #[cfg(windows)]
    #[test]
    fn windows_runtime_environment_preserves_only_trusted_os_inputs() {
        let mut command = Command::new("ignored.exe");
        command.env_clear();
        configure_windows_runtime_environment(&mut command).unwrap();
        let environment = command
            .get_envs()
            .map(|(key, value)| {
                (
                    key.to_string_lossy().to_ascii_uppercase(),
                    value.map(std::ffi::OsStr::to_os_string),
                )
            })
            .collect::<BTreeMap<_, _>>();
        assert_eq!(
            environment.keys().cloned().collect::<Vec<_>>(),
            vec!["PROCESSOR_ARCHITECTURE", "SYSTEMROOT"]
        );
        assert_eq!(
            environment["PROCESSOR_ARCHITECTURE"].as_deref(),
            windows_processor_architecture().map(std::ffi::OsStr::new)
        );
        assert!(environment["SYSTEMROOT"]
            .as_deref()
            .is_some_and(|root| Path::new(root).join("System32").is_dir()));
    }

    #[cfg(windows)]
    #[test]
    fn windows_runtime_environment_rejects_fake_system_root() {
        let fake = tempfile::tempdir().unwrap();
        fs::create_dir(fake.path().join("System32")).unwrap();
        let trusted = studio_windows_job::system_windows_directory().unwrap();
        assert_eq!(
            validated_windows_system_root(fake.path(), &trusted),
            Err(ScientificCpythonUnavailable::WindowsSystemRootUnavailable)
        );
    }

    #[cfg(unix)]
    #[test]
    fn execution_timeout_and_cancel_remove_worker_temp_roots() {
        let root = test_directory("worker-cleanup");
        fs::create_dir_all(&root).unwrap();
        let request = br#"{"job_id":"run_native_cleanup"}"#;

        let timeout_witness = root.join("timeout-witness");
        let timeout_host_path = shell_host(
            &root,
            "timeout-worker",
            &format!(
                "printf '%s' \"$TMPDIR\" > '{}'; touch \"$TMPDIR/residue\"; sleep 2",
                timeout_witness.display()
            ),
        );
        assert_eq!(
            run_scientific_process_with_timeout(
                &test_host(&timeout_host_path, &root),
                request,
                &AtomicBool::new(false),
                Duration::from_millis(50),
            ),
            Err(ScientificCpythonUnavailable::TimedOut)
        );
        let timeout_scratch = PathBuf::from(fs::read_to_string(&timeout_witness).unwrap());
        assert!(!timeout_scratch.exists());

        let cancel_witness = root.join("cancel-witness");
        let cancel_host_path = shell_host(
            &root,
            "cancel-worker",
            &format!(
                "printf '%s' \"$TMPDIR\" > '{}'; touch \"$TMPDIR/residue\"; sleep 2",
                cancel_witness.display()
            ),
        );
        let cancelled = Arc::new(AtomicBool::new(false));
        let signal = Arc::clone(&cancelled);
        let cancel_thread = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(50));
            signal.store(true, Ordering::Release);
        });
        assert_eq!(
            run_scientific_process_with_timeout(
                &test_host(&cancel_host_path, &root),
                request,
                &cancelled,
                Duration::from_secs(1),
            ),
            Err(ScientificCpythonUnavailable::Cancelled)
        );
        cancel_thread.join().unwrap();
        let cancel_scratch = PathBuf::from(fs::read_to_string(&cancel_witness).unwrap());
        assert!(!cancel_scratch.exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn real_cpython_audit_hook_denies_listener_ownership() {
        if !Command::new("python3")
            .args(["-I", "-B", "-c", "pass"])
            .status()
            .is_ok_and(|status| status.success())
        {
            return;
        }
        let run = |script: &str| {
            let output = Command::new("python3")
                .args(["-I", "-S", "-B", "-c", script])
                .output()
                .unwrap();
            assert!(
                output.status.success(),
                "{}",
                String::from_utf8_lossy(&output.stderr)
            );
            serde_json::from_slice::<Value>(&output.stdout).unwrap()
        };
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        drop(listener);
        let script = format!(
            "import json,socket,sys\n\
             def deny(event,args):\n if event=='socket.bind': raise RuntimeError('denied')\n\
             sys.addaudithook(deny)\n\
             s=socket.socket(); denied=False\n\
             try: s.bind(('127.0.0.1',{}))\n\
             except RuntimeError: denied=True\n\
             print(json.dumps({{'denied':denied}}))\n",
            address.port()
        );
        assert_eq!(run(&script), serde_json::json!({"denied": true}));
        TcpListener::bind(address).unwrap();

        let http_script = "import http.server,json,sys\n\
            def deny(event,args):\n if event=='socket.bind': raise RuntimeError('denied')\n\
            sys.addaudithook(deny)\n\
            denied=False\n\
            try: http.server.HTTPServer(('127.0.0.1',0),http.server.BaseHTTPRequestHandler)\n\
            except RuntimeError: denied=True\n\
            print(json.dumps({'http_listener_denied':denied}))\n";
        assert_eq!(
            run(http_script),
            serde_json::json!({"http_listener_denied": true})
        );

        // Exercise the actual production hook. Optional font discovery catches
        // OSError and falls back to bundled fonts; no subprocess is permitted.
        let hook = host_bootstrap!()
            .split("# Load the selected environment")
            .next()
            .unwrap();
        for script in [PREFLIGHT_SCRIPT, EXECUTION_SCRIPT] {
            assert!(script.starts_with(hook));
        }
        let script = format!(
            "{hook}\nimport subprocess\ndenied=False\ntry: subprocess.check_output(['fc-list'])\nexcept OSError: denied=True\nprint(json.dumps({{'spawn_denied':denied}}))\n"
        );
        assert_eq!(run(&script), serde_json::json!({"spawn_denied": true}));

        let spawn_script = "import json,os,sys\n\
            def deny(event,args):\n if event in {'subprocess.Popen','os.system','os.spawn','os.posix_spawn','os.fork','os.forkpty','os.exec','pty.spawn'}: raise RuntimeError('denied')\n\
            sys.addaudithook(deny)\n\
            denied=False\n\
            try: os.spawnv(os.P_WAIT,'/bin/true',['true'])\n\
            except RuntimeError: denied=True\n\
            print(json.dumps({'spawnv_denied':denied}))\n";
        assert_eq!(
            run(spawn_script),
            serde_json::json!({"spawnv_denied": true})
        );
    }
}
