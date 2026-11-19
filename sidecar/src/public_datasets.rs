//! Public dataset catalogue and import jobs.
//!
//! Acquisition, parsing and serialization belong to the library adapters
//! (`datasets.public_catalogue` / `datasets.public_import`). Rust owns request
//! validation, the captured workspace destination, the shared job lifecycle and
//! the final catalogue registration of an already inspected dataset.
use crate::{
    job_http::{
        JobExecutorError, NativeJobRuntime, ScientificExecutionRequest,
        ScientificExecutorSelection, ScientificJobExecutor, ScientificJobTerminal,
        ScientificSubmissionPreflight,
    },
    job_lifecycle::{JobStatus, JobType},
    settings::AppSettingsStore,
    workspace_documents, HttpRequest, HttpResponse, SidecarState,
};
use serde_json::{json, Value};
use std::{
    collections::BTreeMap,
    fmt, fs,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::Instant,
};

const PREFIX: &str = "/api/datasets/public";
const EXECUTION_MODE: &str = "public-dataset-import";
const CATALOGUE_OPERATION: &str = "datasets.public_catalogue";
const IMPORT_OPERATION: &str = "datasets.public_import";
const MAX_BODY_BYTES: usize = 4096;
const MAX_PUBLIC_ID_BYTES: usize = 128;

/// Library document invocation: `(operation, payload, cancellation flag)`.
pub type Invoke = Arc<dyn Fn(&str, &Value, &AtomicBool) -> Result<Value, String> + Send + Sync>;

/// In-flight imports keyed by captured workspace and requested public identity,
/// so repeated clicks observe the running job instead of starting a copy.
type ImportKey = (PathBuf, String, Option<String>);
static ACTIVE_IMPORTS: Mutex<BTreeMap<ImportKey, String>> = Mutex::new(BTreeMap::new());

pub fn owns_path(path: &str) -> bool {
    path == PREFIX || path.starts_with("/api/datasets/public/")
}

fn error(status: u16, detail: impl Into<String>) -> HttpResponse {
    HttpResponse::json(status, json!({"detail": detail.into()}).to_string())
}

/// Public catalogue identifiers are plain bounded ASCII names.
fn public_identifier(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= MAX_PUBLIC_ID_BYTES
        && value.as_bytes()[0].is_ascii_alphanumeric()
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-'))
}

fn import_request(body: &[u8]) -> Result<(String, Option<String>), String> {
    if body.len() > MAX_BODY_BYTES {
        return Err("Public dataset import request exceeds 4 KiB".into());
    }
    let value: Value = serde_json::from_slice(body).map_err(|_| "Expected a JSON object")?;
    let fields = value.as_object().ok_or("Expected a JSON object")?;
    if fields
        .keys()
        .any(|key| !matches!(key.as_str(), "dataset_id" | "source_id"))
    {
        return Err("Unexpected public dataset import fields".into());
    }
    let dataset_id = fields
        .get("dataset_id")
        .and_then(Value::as_str)
        .filter(|id| public_identifier(id))
        .ok_or("Invalid public dataset identifier")?;
    let source_id = match fields.get("source_id") {
        None | Some(Value::Null) => None,
        Some(Value::String(id)) if public_identifier(id) => Some(id.clone()),
        Some(_) => return Err("Invalid public dataset source identifier".into()),
    };
    Ok((dataset_id.to_owned(), source_id))
}

/// Create or reuse a real directory below `workspace`, refusing symbolic links,
/// files and canonical escapes at every component.
fn workspace_directory(workspace: &Path, components: &[&str]) -> Result<PathBuf, String> {
    let root = workspace
        .canonicalize()
        .map_err(|error| error.to_string())?;
    let mut path = root.clone();
    for name in components {
        path.push(name);
        match fs::symlink_metadata(&path) {
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                fs::create_dir(&path).map_err(|error| error.to_string())?;
            }
            Err(error) => return Err(error.to_string()),
        }
        let metadata = fs::symlink_metadata(&path).map_err(|error| error.to_string())?;
        if !metadata.is_dir()
            || metadata.file_type().is_symlink()
            || !path
                .canonicalize()
                .map_err(|error| error.to_string())?
                .starts_with(&root)
        {
            return Err("Public dataset destination escaped the workspace".into());
        }
    }
    Ok(path)
}

fn imports_directory(workspace: &Path) -> Result<PathBuf, String> {
    workspace_directory(workspace, &["imports"])
}

fn cache_directory(workspace: &Path) -> Result<PathBuf, String> {
    workspace_directory(workspace, &[".nirs4all", "cache", "public-datasets"])
}

/// Library output must consist of real files and directories only.
fn reject_links(directory: &Path) -> Result<(), String> {
    for entry in fs::read_dir(directory).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let kind = entry.file_type().map_err(|error| error.to_string())?;
        if kind.is_dir() {
            reject_links(&entry.path())?;
        } else if !kind.is_file() {
            return Err("Imported dataset contains a link or special file".into());
        }
    }
    Ok(())
}

/// Validate the adapter result and confine every configured reference to the
/// private stage. Returns `(name, confined config, inspection, resolved source)`.
fn validated_import(
    result: &Value,
    root: &Path,
) -> Result<(String, Value, Value, Option<String>), String> {
    let name = result["name"]
        .as_str()
        .filter(|name| {
            !name.trim().is_empty() && name.len() <= 256 && !name.chars().any(char::is_control)
        })
        .ok_or("Public dataset import returned an invalid name")?;
    let mut config = result["config"].clone();
    if config
        .as_object()
        .is_none_or(|fields| fields.is_empty() || fields.contains_key("dataset_document"))
    {
        return Err("Public dataset import returned an invalid configuration".into());
    }
    let inspection = result["inspection"].clone();
    if inspection["success"] != true || !inspection["summary"].is_object() {
        return Err("Public dataset import returned no successful inspection".into());
    }
    reject_links(root)?;
    crate::scientific_request_resolver::ScientificRequestResolver::confine_dataset_config(
        &mut config,
        root,
    )
    .map_err(|_| "Public dataset configuration references files outside its import")?;
    let resolved = result["provenance"]["source_id"]
        .as_str()
        .filter(|id| public_identifier(id))
        .map(str::to_owned);
    Ok((name.to_owned(), config, inspection, resolved))
}

/// An existing linked import of the same public dataset and source whose
/// files are still present inside the captured workspace's imports directory.
fn existing_import(
    settings: &AppSettingsStore,
    workspace: &Path,
    dataset_id: &str,
    requested: Option<&str>,
    resolved: Option<&str>,
) -> Result<Option<Value>, String> {
    let catalogue = workspace_documents::catalogue(settings).map_err(|(_, detail)| detail)?;
    let imports = workspace.join("imports");
    Ok(catalogue["datasets"]
        .as_array()
        .into_iter()
        .flatten()
        .find(|dataset| {
            let public = &dataset["config"]["public_dataset"];
            public["dataset_id"] == dataset_id
                && (public["requested_source_id"] == json!(requested)
                    || resolved
                        .or(requested)
                        .is_some_and(|source| public["source_id"] == source))
                && dataset["path"]
                    .as_str()
                    .and_then(|path| Path::new(path).canonicalize().ok())
                    .is_some_and(|path| path.starts_with(&imports))
        })
        .cloned())
}

fn unlink_dataset(settings: &AppSettingsStore, id: &Value) -> Result<(), String> {
    let _guard = workspace_documents::DOCUMENT_LOCK
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    let mut catalogue = workspace_documents::catalogue(settings).map_err(|(_, detail)| detail)?;
    if let Some(datasets) = catalogue["datasets"].as_array_mut() {
        datasets.retain(|dataset| dataset["id"] != *id);
    }
    workspace_documents::save_catalogue(settings, &catalogue).map_err(|(_, detail)| detail)
}

/// Create the private stage below the captured workspace imports and the
/// adapter payload naming it and the workspace cache.
fn prepare_stage(
    workspace: &Path,
    dataset_id: &str,
    requested: Option<&str>,
) -> Result<(tempfile::TempDir, PathBuf, Value), String> {
    let stage = tempfile::Builder::new()
        .prefix("public-")
        .tempdir_in(imports_directory(workspace)?)
        .map_err(|error| error.to_string())?;
    let root = stage
        .path()
        .canonicalize()
        .map_err(|error| error.to_string())?;
    let cache = cache_directory(workspace)?;
    let path = |path: &Path| {
        crate::scientific_request_resolver::library_dataset_path(path)
            .map_err(|_| "Invalid public dataset destination".to_string())
    };
    let mut payload = json!({
        "dataset_id": dataset_id,
        "output_dir": path(&root)?,
        "cache_dir": path(&cache)?,
    });
    if let Some(source) = requested {
        payload["source_id"] = json!(source);
    }
    Ok((stage, root, payload))
}

struct ImportExecutor {
    invoke: Invoke,
    settings: AppSettingsStore,
    jobs: NativeJobRuntime,
    key: ImportKey,
    cancel: Arc<AtomicBool>,
}

impl fmt::Debug for ImportExecutor {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("ImportExecutor")
            .field("key", &self.key)
            .finish_non_exhaustive()
    }
}

enum Outcome {
    /// The terminal state was already recorded by the worker.
    Recorded,
    Completed(Value),
    Cancelled,
    Failed(String),
}

impl ImportExecutor {
    fn cancelled(&self) -> bool {
        self.cancel.load(Ordering::Acquire)
    }

    fn acquire(
        &self,
        request: &ScientificExecutionRequest,
        terminal: &dyn ScientificJobTerminal,
    ) -> Outcome {
        let (_, dataset_id, requested) = &self.key;
        match existing_import(
            &self.settings,
            &self.key.0,
            dataset_id,
            requested.as_deref(),
            None,
        ) {
            Ok(Some(dataset)) => {
                return Outcome::Completed(
                    json!({"success":true,"dataset":dataset,"already_imported":true}),
                );
            }
            Ok(None) => {}
            Err(detail) => return Outcome::Failed(detail),
        }
        let (stage, root, payload) =
            match prepare_stage(&request.workspace_path, dataset_id, requested.as_deref()) {
                Ok(value) => value,
                Err(detail) => return Outcome::Failed(detail),
            };
        let _ = terminal.activity(
            &request.job_id,
            "Downloading and preparing the public dataset; percentage unavailable",
        );
        let result = (self.invoke)(IMPORT_OPERATION, &payload, &self.cancel);
        if self.cancelled() {
            return Outcome::Cancelled;
        }
        let (name, mut config, inspection, resolved) =
            match result.and_then(|result| validated_import(&result, &root)) {
                Ok(value) => value,
                Err(detail) => return Outcome::Failed(detail),
            };
        match existing_import(
            &self.settings,
            &self.key.0,
            dataset_id,
            requested.as_deref(),
            resolved.as_deref(),
        ) {
            Ok(Some(dataset)) => {
                return Outcome::Completed(
                    json!({"success":true,"dataset":dataset,"already_imported":true}),
                );
            }
            Ok(None) => {}
            Err(detail) => return Outcome::Failed(detail),
        }
        config["public_dataset"] = json!({
            "dataset_id": dataset_id,
            "source_id": resolved.as_deref().or(requested.as_deref()),
            "requested_source_id": requested,
        });
        if self.cancelled() {
            return Outcome::Cancelled;
        }
        let record = json!({"path": root, "name": name, "config": config});
        let linked = match serde_json::to_vec(&record)
            .map_err(|error| error.to_string())
            .and_then(|body| {
                workspace_documents::link_inspected_dataset(&self.settings, &body, &inspection)
                    .map_err(|(_, detail)| detail)
            }) {
            Ok(linked) => linked,
            Err(detail) => return Outcome::Failed(detail),
        };
        // The catalogue now references these exact paths.
        let _durable = stage.keep();
        let dataset = linked["dataset"].clone();
        let completed = json!({"success":true,"dataset":dataset,"already_imported":false});
        if terminal.complete(&request.job_id, completed).is_ok()
            && self
                .jobs
                .get_at(&request.job_id, Instant::now())
                .is_none_or(|job| job.status == JobStatus::Completed)
        {
            return Outcome::Recorded;
        }
        // A cancellation or recording failure won the terminal race: the job
        // must not report cancelled/failed while its dataset remains linked.
        let _ = unlink_dataset(&self.settings, &dataset["id"]);
        let _ = fs::remove_dir_all(&root);
        Outcome::Recorded
    }

    fn run(&self, request: &ScientificExecutionRequest, terminal: &dyn ScientificJobTerminal) {
        match self.acquire(request, terminal) {
            Outcome::Recorded => {}
            Outcome::Completed(result) => {
                let _ = terminal.complete(&request.job_id, result);
            }
            Outcome::Cancelled => {
                let _ = terminal.acknowledge_cancel(&request.job_id);
            }
            Outcome::Failed(_) if self.cancelled() => {
                let _ = terminal.acknowledge_cancel(&request.job_id);
            }
            Outcome::Failed(detail) => {
                let _ = terminal.fail(&request.job_id, &detail);
            }
        }
        let mut active = ACTIVE_IMPORTS
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if active.get(&self.key) == Some(&request.job_id) {
            active.remove(&self.key);
        }
    }
}

impl ScientificJobExecutor for ImportExecutor {
    fn is_selected(&self) -> bool {
        true
    }
    fn preflight_submission(
        &self,
        request: &ScientificSubmissionPreflight,
    ) -> Result<ScientificExecutorSelection, JobExecutorError> {
        imports_directory(&request.workspace_path)
            .and_then(|_| cache_directory(&request.workspace_path))
            .map_err(|_| JobExecutorError::PreflightRefused {
                code: "public_dataset_destination_unavailable",
                detail: "the workspace import directory cannot be prepared".into(),
            })?;
        Ok(ScientificExecutorSelection {
            execution_backend: "local-python".into(),
            execution_mode: Some(EXECUTION_MODE.into()),
            prepared_payload: request.payload.clone(),
        })
    }
    fn submit_scientific(
        &self,
        request: &ScientificExecutionRequest,
        terminal: Arc<dyn ScientificJobTerminal>,
    ) -> Result<(), JobExecutorError> {
        let worker = Self {
            invoke: Arc::clone(&self.invoke),
            settings: self.settings.clone(),
            jobs: self.jobs.clone(),
            key: self.key.clone(),
            cancel: Arc::clone(&self.cancel),
        };
        let request = request.clone();
        std::thread::Builder::new()
            .name("studio-public-dataset-import".into())
            .spawn(move || worker.run(&request, terminal.as_ref()))
            .map_err(|_| JobExecutorError::SubmissionRefused)?;
        Ok(())
    }
    fn request_cooperative_cancel(&self, _id: &str) -> Result<(), JobExecutorError> {
        self.cancel.store(true, Ordering::Release);
        Ok(())
    }
}

fn snapshot_json(job: &crate::job_lifecycle::JobSnapshot) -> Value {
    let mut value = job.public_json();
    value["cancellation_requested"] = json!(job.cancellation_requested());
    value
}

/// Resolve a job only through the active workspace's durable record and this
/// route's execution mode; unrelated jobs are indistinguishable from absent.
fn scoped_record(workspace: &Path, raw_id: &str) -> Result<(String, Value), (u16, String)> {
    let missing = || {
        (
            404,
            "Public dataset import not found in the active workspace".to_owned(),
        )
    };
    let id = crate::library_analysis::identifier(raw_id).map_err(|detail| (400, detail))?;
    let record = crate::execution_job_records::read_execution_job_record(workspace, &id)
        .map_err(|_| missing())?;
    if record["execution_mode"] != EXECUTION_MODE
        || record["job_type"] != JobType::Maintenance.as_str()
    {
        return Err(missing());
    }
    Ok((id, record))
}

fn status(jobs: &NativeJobRuntime, workspace: &Path, raw_id: &str) -> Result<Value, (u16, String)> {
    let (id, record) = scoped_record(workspace, raw_id)?;
    Ok(jobs.get_at(&id, Instant::now()).map_or_else(
        || {
            json!({"id": id, "type": record["job_type"], "status": record["status"],
                "created_at": record["created_at"], "started_at": record["started_at"],
                "completed_at": record["completed_at"], "progress": record["progress"],
                "progress_message": record["progress_message"], "error": record["error"],
                "result": null, "cancellation_requested": false})
        },
        |job| snapshot_json(&job),
    ))
}

fn cancel(jobs: &NativeJobRuntime, workspace: &Path, raw_id: &str) -> Result<Value, (u16, String)> {
    let (id, _) = scoped_record(workspace, raw_id)?;
    let job = jobs
        .get_at(&id, Instant::now())
        .ok_or_else(|| (409, "Public dataset import is not running".to_owned()))?;
    if job.status.is_terminal() {
        return Ok(snapshot_json(&job));
    }
    jobs.request_cancel_at(
        &id,
        &crate::websocket_transport::rfc3339_now(),
        Instant::now(),
    )
    .map(|job| snapshot_json(&job))
    .map_err(|error| (409, format!("Cancellation was refused: {error:?}")))
}

fn submit(
    settings: &AppSettingsStore,
    jobs: &NativeJobRuntime,
    invoke: Invoke,
    body: &[u8],
) -> Result<Value, (u16, String)> {
    let (dataset_id, source_id) = import_request(body).map_err(|detail| (400, detail))?;
    let access = settings
        .active_linked_workspace_access()
        .map_err(|detail| (409, detail))?
        .ok_or_else(|| (409, "No active workspace".to_owned()))?;
    let workspace = access
        .path()
        .canonicalize()
        .map_err(|_| (409, "Active workspace is unavailable".to_owned()))?;
    let key = (workspace.clone(), dataset_id.clone(), source_id.clone());
    let mut active = ACTIVE_IMPORTS
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    if let Some(job_id) = active.get(&key) {
        if jobs
            .get_at(job_id, Instant::now())
            .is_some_and(|job| !job.status.is_terminal())
        {
            return Ok(json!({"job_id": job_id, "status": "running"}));
        }
    }
    let mut payload = json!({"dataset_id": dataset_id});
    if let Some(source) = &source_id {
        payload["source_id"] = json!(source);
    }
    let executor = Arc::new(ImportExecutor {
        invoke,
        settings: settings.clone(),
        jobs: jobs.clone(),
        key: key.clone(),
        cancel: Arc::new(AtomicBool::new(false)),
    });
    let receipt = jobs
        .submit_with_executor_kind_at(
            JobType::Maintenance,
            &format!("Public dataset {dataset_id}"),
            "local-python",
            &payload,
            access.id(),
            &workspace,
            &crate::websocket_transport::rfc3339_now(),
            Instant::now(),
            executor,
        )
        .map_err(|error| {
            (
                500,
                format!("Public dataset import submission failed: {error:?}"),
            )
        })?;
    // The worker removes its key under this same lock once terminal.
    let finished = jobs
        .get_at(&receipt.job_id, Instant::now())
        .is_some_and(|job| job.status.is_terminal());
    if !finished {
        active.insert(key, receipt.job_id.clone());
    }
    drop(active);
    Ok(json!({"job_id": receipt.job_id, "status": "running"}))
}

enum Route<'a> {
    Catalogue,
    Import,
    Status(&'a str),
    Cancel(&'a str),
}

fn parse_route(path: &str) -> Option<Route<'_>> {
    let tail = path.strip_prefix(PREFIX)?;
    match tail {
        "" => Some(Route::Catalogue),
        "/import" => Some(Route::Import),
        _ => {
            let rest = tail.strip_prefix("/imports/")?;
            let (id, cancelling) = rest
                .strip_suffix("/cancel")
                .map_or((rest, false), |id| (id, true));
            if id.is_empty() || id.contains('/') {
                return None;
            }
            Some(if cancelling {
                Route::Cancel(id)
            } else {
                Route::Status(id)
            })
        }
    }
}

fn active_workspace(settings: &AppSettingsStore) -> Result<PathBuf, (u16, String)> {
    settings
        .active_linked_workspace_access()
        .map_err(|detail| (409, detail))?
        .map(|access| access.path().to_path_buf())
        .ok_or_else(|| (409, "No active workspace".to_owned()))
}

/// Route public dataset requests. `invoke` is `None` without an attested
/// library host; status and cancellation never need the host.
pub fn handle(
    settings: &AppSettingsStore,
    jobs: &NativeJobRuntime,
    invoke: Option<Invoke>,
    request: &HttpRequest,
) -> HttpResponse {
    let Some(route) = parse_route(&request.path) else {
        return error(404, "Unknown public dataset route");
    };
    let expected = if matches!(route, Route::Catalogue | Route::Status(_)) {
        "GET"
    } else {
        "POST"
    };
    if request.method != expected {
        return crate::method_not_allowed(&request.method, &request.path, expected);
    }
    if request.query.is_some() {
        return error(400, "Public dataset routes do not accept query fields");
    }
    let unavailable = || (503, "Attested scientific runtime unavailable".to_owned());
    let outcome = match route {
        Route::Catalogue => invoke.ok_or_else(unavailable).and_then(|invoke| {
            let value = invoke(CATALOGUE_OPERATION, &json!({}), &AtomicBool::new(false))
                .map_err(|detail| (502, detail))?;
            if value["datasets"].is_array() && value["version"].is_string() {
                Ok(value)
            } else {
                Err((
                    502,
                    "Public dataset catalogue has an invalid shape".to_owned(),
                ))
            }
        }),
        Route::Import => invoke
            .ok_or_else(unavailable)
            .and_then(|invoke| submit(settings, jobs, invoke, &request.body)),
        Route::Status(id) => {
            active_workspace(settings).and_then(|workspace| status(jobs, &workspace, id))
        }
        Route::Cancel(id) => {
            if matches!(request.body.as_slice(), b"" | b"{}" | b"null") {
                active_workspace(settings).and_then(|workspace| cancel(jobs, &workspace, id))
            } else {
                Err((
                    400,
                    "Cancellation does not accept a request body".to_owned(),
                ))
            }
        }
    };
    match outcome {
        Ok(value) => HttpResponse::json(200, value.to_string()),
        Err((status, detail)) => error(status, detail),
    }
}

pub fn route(state: &Arc<Mutex<SidecarState>>, request: &HttpRequest) -> Option<HttpResponse> {
    if !owns_path(&request.path) {
        return None;
    }
    let (settings, host, jobs) = {
        let state = state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        (
            state.app_settings.clone(),
            state.scientific_host.clone(),
            state.native_jobs.clone(),
        )
    };
    let invoke = host.map(|host| -> Invoke {
        Arc::new(move |operation, payload, cancel| {
            host.adapt_document_cancellable(operation, payload, cancel)
        })
    });
    Some(handle(&settings, &jobs, invoke, request))
}

#[cfg(test)]
#[path = "public_datasets_tests.rs"]
mod tests;
