//! Run operations use the attested library worker outside the global route lock.
use crate::{HttpRequest, HttpResponse, SidecarState};
use rusqlite::DatabaseName;
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{Arc, Mutex, PoisonError},
    time::{Duration, Instant, SystemTime},
};

/// Cap on job directories examined per request; the newest are kept.
const MAX_RUN_DIRECTORIES: usize = 2000;
/// A change this recent may share its timestamp with a later one, so results
/// derived from it are not reused.
const TIMESTAMP_SETTLE: Duration = Duration::from_millis(100);
/// Verified Store snapshots kept for reuse across run-detail/log requests.
const STORE_SNAPSHOT_SLOTS: usize = 2;

static STORE_SNAPSHOTS: StoreSnapshots = StoreSnapshots::new();
static RUN_JOB_INDEX: RunJobIndex = RunJobIndex::new();

#[allow(clippy::needless_pass_by_value)]
fn error(status: u16, detail: impl ToString) -> HttpResponse {
    HttpResponse::json(status, json!({"detail": detail.to_string()}).to_string())
}

pub fn has_live_training(jobs: &[Value]) -> bool {
    jobs.iter().any(|context| {
        matches!(
            context["job"]["status"].as_str(),
            Some("pending" | "queued" | "running")
        )
    })
}

/// Persisted activity is historical evidence, not proof of a surviving worker.
pub fn normalize_interrupted(runs: &mut Value, jobs: &[Value]) {
    if has_live_training(jobs) {
        return;
    }
    for run in runs["runs"].as_array_mut().into_iter().flatten() {
        if matches!(run["status"].as_str(), Some("running" | "queued")) {
            run["stored_status"] = run["status"].clone();
            run["status"] = json!("failed");
            if run["error"].is_null() {
                run["error"] = json!("Interrupted execution: the saved run has no active worker in this Studio session.");
            }
        }
    }
}

#[allow(clippy::too_many_lines)]
pub fn route(runtime: &Arc<Mutex<SidecarState>>, request: &HttpRequest) -> Option<HttpResponse> {
    // Keep the existing deletion admission and owner-response validation.
    if request.method == "DELETE" {
        return None;
    }
    if request.path == "/api/runs/execution-backends" {
        if request.method != "GET" {
            return Some(crate::method_not_allowed(
                &request.method,
                &request.path,
                "GET",
            ));
        }
        if request.query.is_some() {
            return Some(error(400, "Execution backends do not accept query fields"));
        }
        let host = runtime
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .scientific_host
            .clone();
        let available =
            engine_capabilities(host.as_deref())["supports_explicit_run_engine"] == true;
        return Some(HttpResponse::json(200, json!({"default_backend":"local-python","backends":[{
            "backend":"local-python","label":"Local native runtime","available":available,
            "mode":"bounded-cpython-stdio","supports_progress":true,"supports_cancellation":true,
            "metadata":{"engine":"dag-ml","allow_fallback":false}
        }]}).to_string()));
    }
    if request.path == "/api/runs/execution-job-records" {
        return Some(list_records(runtime, request));
    }
    let preselection = crate::workspace_run_detail_preselection_workspace(&request.path);
    let rerun_ids = request
        .path
        .strip_suffix("/rerun")
        .and_then(crate::workspace_run_detail_ids);
    let log_ids = request
        .path
        .strip_prefix("/api/workspaces/")
        .and_then(|suffix| {
            let segments = suffix.split('/').collect::<Vec<_>>();
            if segments.len() == 6
                && segments[1] == "runs"
                && segments[3] == "pipelines"
                && segments[5] == "logs"
            {
                Some((
                    crate::decoded_path_segment(segments[0])?,
                    crate::decoded_path_segment(segments[2])?,
                    crate::decoded_path_segment(segments[4])?,
                ))
            } else {
                None
            }
        });
    let ids = crate::workspace_run_detail_ids(&request.path)
        .filter(|ids| ids.1 != "enriched")
        .or_else(|| log_ids.as_ref().map(|ids| (ids.0.clone(), ids.1.clone())))
        .or_else(|| rerun_ids.clone());
    if preselection.is_none() && ids.is_none() {
        return None;
    }
    let allowed = if rerun_ids.is_some() {
        "POST"
    } else if preselection.is_some() || log_ids.is_some() {
        "GET"
    } else {
        "GET, DELETE"
    };
    if request.query.is_some() {
        return Some(error(400, "Run operations do not accept query fields"));
    }
    if !request.body.is_empty() {
        return Some(error(400, "Run operations do not accept a request body"));
    }
    if (rerun_ids.is_some() && request.method != "POST")
        || (rerun_ids.is_none() && request.method != "GET")
    {
        return Some(crate::method_not_allowed(
            &request.method,
            &request.path,
            allowed,
        ));
    }
    let (settings, host, jobs) = {
        let state = runtime
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        (
            state.app_settings.clone(),
            state.scientific_host.clone(),
            state.native_jobs.clone(),
        )
    };
    if host.is_none() && log_ids.is_none() && rerun_ids.is_none() {
        // Explicit bare-interpreter diagnostics retain their bounded bridge.
        // A configured but invalid attested host always stays on this route.
        return None;
    }
    let workspace_id = preselection
        .as_deref()
        .unwrap_or_else(|| &ids.as_ref().unwrap().0);
    let workspace = match settings.linked_workspace_access(workspace_id) {
        Ok(Some(workspace)) => workspace,
        Ok(None) => return Some(error(404, "Workspace not found")),
        Err(detail) => return Some(error(409, detail)),
    };
    let projection = workspace.store().map_or_else(
        || crate::workspace_store::preflight_run_detail_projection(workspace.path()),
        |store| crate::workspace_store::preflight_run_detail_projection_from_connection(&store),
    );
    if let Err(detail) = projection {
        return Some(crate::workspace_store_read_error_response(&detail));
    }
    let Some(host) = host else {
        return Some(error(503, "Attested run library host unavailable"));
    };
    if preselection.is_some() {
        let ready = host.adapt_document("runs.preflight", &json!({})).is_ok_and(|result| {
            result == json!({"callable":"nirs4all.pipeline.storage.studio_run_detail_http_inputs_v1", "ready":true})
        });
        let decision = crate::run_detail_preselection::RunDetailPreselection {
            target: if ready {
                crate::run_detail_preselection::RunDetailTarget::NativeSidecar
            } else {
                crate::run_detail_preselection::RunDetailTarget::Reject
            },
            verified_store_v5: true,
            reason: if ready {
                "store_v5_owner_materializer_ready"
            } else {
                "studio_run_detail_owner_preflight_failed"
            },
            status: if ready { 200 } else { 503 },
        };
        return Some(HttpResponse::json(
            decision.status,
            decision.response(workspace_id).to_string(),
        ));
    }
    let run_id = &ids.as_ref().unwrap().1;
    if !valid_id(run_id) || log_ids.as_ref().is_some_and(|ids| !valid_id(&ids.2)) {
        return Some(error(400, "Invalid run or pipeline identifier"));
    }
    let live = jobs.training_list_at(workspace.path(), Instant::now());
    let Some(store) = workspace.store() else {
        return Some(error(404, "Workspace store not found"));
    };
    let snapshot = match STORE_SNAPSHOTS.snapshot(workspace.path(), &store) {
        Ok(snapshot) => snapshot,
        Err(detail) => return Some(error(500, detail)),
    };
    drop(store);
    if let Some(ids) = log_ids {
        return Some(
            match host.adapt_document(
                "runs.logs",
                &json!({"workspace_path":snapshot.path(),"run_id":run_id,"pipeline_id":ids.2}),
            ) {
                Ok(value) => HttpResponse::json(200, value.to_string()),
                Err(detail) if detail == "Pipeline not found in run" => error(404, detail),
                Err(detail) => error(502, detail),
            },
        );
    }
    let owner = match host.adapt_document(
        "runs.detail",
        &json!({"workspace_path":snapshot.path(),"run_id":run_id}),
    ) {
        Ok(value) if !value.is_null() => value,
        Ok(_) => return Some(error(404, "Run not found")),
        Err(detail) => return Some(error(502, detail)),
    };
    if let Err(detail) = crate::run_detail_cpython::validate_owner_envelope(&owner) {
        return Some(crate::run_detail_owner_bridge_error_response(detail));
    }
    let links = match settings.dataset_links() {
        Ok(links) => links,
        Err(detail) => return Some(error(500, detail)),
    };
    Some(
        match crate::run_detail::compose_store_run_detail(&owner, &links) {
            Ok(mut value) => {
                if rerun_ids.is_some() {
                    drop(workspace);
                    return Some(rerun(&settings, &host, &jobs, workspace_id, run_id, &value));
                }
                let mut envelope = json!({"runs":[value]});
                normalize_interrupted(&mut envelope, &live);
                value = envelope["runs"][0].take();
                HttpResponse::json(200, value.to_string())
            }
            Err(detail) => error(502, detail),
        },
    )
}

fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 1024
        && !id.contains(['/', '\\', '\0'])
        && !matches!(id, "." | "..")
}

pub fn engine_capabilities(
    host: Option<&crate::scientific_cpython::CpythonScientificJobExecutor>,
) -> Value {
    let ready = host.is_some_and(
        crate::scientific_cpython::CpythonScientificJobExecutor::library_facades_available,
    );
    json!({"supports_explicit_run_engine":ready,"supported_engines":if ready {vec!["dag-ml"]} else {vec![]},
        "default_engine":"dag-ml","reason":if ready {Value::Null} else {json!("The attested scientific library host is unavailable.")}})
}

#[allow(clippy::too_many_lines)]
fn rerun(
    settings: &crate::settings::AppSettingsStore,
    host: &crate::scientific_cpython::CpythonScientificJobExecutor,
    jobs: &crate::job_http::NativeJobRuntime,
    workspace_id: &str,
    source_run_id: &str,
    detail: &Value,
) -> HttpResponse {
    if settings
        .active_linked_workspace_response()
        .ok()
        .flatten()
        .is_none_or(|workspace| workspace["id"] != workspace_id)
    {
        return error(409, "Select this workspace before relaunching its run");
    }
    if detail["rerun_ready"] != true {
        return error(
            409,
            "Relink the historical datasets before relaunching this run",
        );
    }
    let mut seen = std::collections::HashSet::new();
    let mut prepared = Vec::new();
    for pipeline in detail["pipelines"].as_array().into_iter().flatten() {
        let template = pipeline
            .get("original_template")
            .filter(|value| value.is_array() || value.is_object())
            .or_else(|| {
                pipeline
                    .get("expanded_config")
                    .filter(|value| value.is_array() || value.is_object())
            });
        let Some(template) = template else {
            continue;
        };
        if !seen.insert(template.to_string()) {
            continue;
        }
        let name = format!(
            "{} (clone)",
            pipeline["name"].as_str().unwrap_or("Historical pipeline")
        );
        let converted = match host
            .adapt_document("pipeline.import", &json!({"payload":template,"name":name}))
        {
            Ok(converted) => converted,
            Err(detail) => return error(422, detail),
        };
        prepared.push((converted, pipeline["pipeline_id"].clone()));
    }
    if prepared.is_empty() {
        return error(422, "This run has no reusable pipeline template");
    }
    let mut clones = Vec::new();
    for (document, source) in prepared {
        let response = match crate::workspace_documents::route(
            settings,
            "POST",
            "/api/pipelines",
            document.to_string().as_bytes(),
        ) {
            Some(response) if response.status == 200 => response,
            Some(response) => return response,
            None => return error(500, "Pipeline clone could not be saved"),
        };
        let saved: Value = match serde_json::from_str(&response.body) {
            Ok(saved) => saved,
            Err(detail) => return error(500, detail),
        };
        clones.push(json!({"id":saved["pipeline"]["id"],"name":saved["pipeline"]["name"],"source_pipeline_id":source}));
    }
    let name = format!(
        "{} (clone)",
        detail["name"].as_str().unwrap_or("Historical run")
    );
    let datasets = detail["datasets"].as_array().cloned().unwrap_or_default();
    let dataset_ids = datasets
        .iter()
        .map(|dataset| dataset["linked_dataset_id"].clone())
        .collect::<Vec<_>>();
    let pipeline_ids = clones
        .iter()
        .map(|pipeline| pipeline["id"].clone())
        .collect::<Vec<_>>();
    let mut specs = Vec::new();
    let mut source_ids = Vec::new();
    let mut grouping = serde_json::Map::new();
    for dataset in &datasets {
        let dataset_id = dataset["linked_dataset_id"].as_str().unwrap_or_default();
        let group = dataset
            .get("split_group_by")
            .cloned()
            .unwrap_or(Value::Null);
        if !group.is_null() {
            grouping.insert(dataset_id.into(), group.clone());
        }
        for pipeline in &clones {
            let pipeline_id = pipeline["id"].as_str().unwrap_or_default();
            let id = format!("{dataset_id}::{pipeline_id}");
            source_ids.push(id.clone());
            specs.push(json!({"id":format!("single-pair:{id}"),"sourceRunId":id,"sourceDatasetId":dataset_id,"sourcePipelineId":pipeline_id,
                "campaign":{"name":name,"mode":"paired_by_index","executionBackend":"local-python",
                    "datasets":[{"id":dataset_id,"name":dataset["name"],"splitGroupBy":group}],
                    "pipelines":[{"id":pipeline_id,"name":pipeline["name"],"source":"saved"}],
                    "runMatrix":[{"id":id,"datasetId":dataset_id,"pipelineId":pipeline_id,"datasetIndex":0,"pipelineIndex":0,"splitGroupBy":group}]}}));
        }
    }
    let payload = json!({
        "legacyConfig":{"name":name,"dataset_ids":dataset_ids,"pipeline_ids":pipeline_ids,"execution_backend":"local-python","engine":"dag-ml","allow_fallback":false,"split_group_by_by_dataset":grouping},
        "manifest":{"version":"studio.native-launch-payload.v1","legacyExperimentName":name,"legacyDatasetCount":datasets.len(),"legacyPipelineCount":clones.len(),"strictCampaignCount":specs.len(),"skippedRunCount":0,"sourceRunIds":source_ids,"skippedRunIds":[]},
        "strictCampaignSpecs":{"splitSpecs":specs,"skippedRunIds":[]}
    });
    let response =
        crate::scientific_submission_with(settings, jobs, payload.to_string().as_bytes());
    if response.status != 202 {
        return response;
    }
    let run: Value = match serde_json::from_str(&response.body) {
        Ok(run) => run,
        Err(detail) => return error(500, detail),
    };
    HttpResponse::json(
        202,
        json!({"success":true,"source_run_id":source_run_id,"run":run,"cloned_pipelines":clones})
            .to_string(),
    )
}

#[allow(clippy::too_many_lines)]
fn list_records(runtime: &Arc<Mutex<SidecarState>>, request: &HttpRequest) -> HttpResponse {
    if request.method != "GET" {
        return crate::method_not_allowed(&request.method, &request.path, "GET");
    }
    let mut filters = std::collections::BTreeMap::new();
    for (key, value) in
        url::form_urlencoded::parse(request.query.as_deref().unwrap_or("").as_bytes())
    {
        if !matches!(
            key.as_ref(),
            "include_orphaned" | "run_status" | "execution_status" | "requested_backend"
        ) || filters
            .insert(key.into_owned(), value.into_owned())
            .is_some()
        {
            return error(400, "Invalid execution record filter");
        }
    }
    if filters
        .get("include_orphaned")
        .is_some_and(|value| value != "true" && value != "false")
    {
        return error(400, "Invalid orphaned record filter");
    }
    let (settings, jobs) = {
        let state = runtime
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        (state.app_settings.clone(), state.native_jobs.clone())
    };
    let workspace = match settings.active_linked_workspace_access() {
        Ok(Some(workspace)) => workspace,
        Ok(None) => return HttpResponse::json(200, json!({"records":[],"total":0}).to_string()),
        Err(detail) => return error(409, detail),
    };
    let live = jobs.training_list_at(workspace.path(), Instant::now());
    let host = runtime
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .scientific_host
        .clone();
    if let Some(host) = host.as_deref() {
        reconcile_records(&settings, host, workspace.id(), workspace.path());
    }
    let ids = match newest_run_directories(&workspace.path().join("runs")) {
        Ok(ids) => ids,
        Err(detail) if detail.kind() == std::io::ErrorKind::NotFound => {
            return HttpResponse::json(200, json!({"records":[],"total":0}).to_string())
        }
        Err(detail) => return error(500, detail),
    };
    let mut records = Vec::new();
    let mut skipped = 0;
    for id in ids {
        let Ok(record) =
            crate::execution_job_records::read_execution_job_record(workspace.path(), &id)
        else {
            skipped += 1;
            continue;
        };
        let store = workspace.store();
        let run = record_run_projection(workspace.path(), store.as_deref(), &id, &record);
        drop(store);
        let run = match run {
            Ok(run) => run,
            Err(detail) => return crate::workspace_store_read_error_response(&detail),
        };
        if run.is_none()
            && filters
                .get("include_orphaned")
                .is_none_or(|value| value != "true")
        {
            continue;
        }
        let mut envelope = json!({"runs":run.iter().cloned().collect::<Vec<_>>()});
        normalize_interrupted(&mut envelope, &live);
        let run = envelope["runs"].as_array().and_then(|runs| runs.first());
        let mut response =
            crate::execution_job_records::compose_execution_job_record_response(&record, run);
        if !has_live_training(&live)
            && matches!(
                response["status"].as_str(),
                Some("pending" | "running" | "queued")
            )
        {
            response["status"] = json!("failed");
            response["error"] =
                json!("Interrupted execution: no active worker in this Studio session.");
        }
        if [
            ("run_status", "run_status"),
            ("execution_status", "status"),
            ("requested_backend", "requested_backend"),
        ]
        .iter()
        .any(|(filter, field)| {
            filters.get(*filter).is_some_and(|values| {
                !values
                    .split(',')
                    .any(|value| response[*field].as_str() == Some(value))
            })
        }) {
            continue;
        }
        records.push(response);
    }
    records.sort_by(|a, b| {
        b["created_at"]
            .as_str()
            .cmp(&a["created_at"].as_str())
            .then_with(|| a["job_id"].as_str().cmp(&b["job_id"].as_str()))
    });
    HttpResponse::json(
        200,
        json!({"total":records.len(),"records":records,"skipped_records":skipped}).to_string(),
    )
}

pub fn legacy_store_run_id(workspace: &std::path::Path, job_id: &str) -> Option<String> {
    use std::io::Read;
    if !valid_id(job_id) {
        return None;
    }
    let runs = workspace.join("runs");
    let directory = runs.join(job_id);
    for path in [&runs, &directory] {
        let metadata = std::fs::symlink_metadata(path).ok()?;
        if !metadata.is_dir() || metadata.file_type().is_symlink() {
            return None;
        }
    }
    let path = directory.join("manifest.json");
    let metadata = std::fs::symlink_metadata(&path).ok()?;
    if !metadata.is_file() || metadata.file_type().is_symlink() || metadata.len() > 2 * 1024 * 1024
    {
        return None;
    }
    let mut bytes = Vec::new();
    std::fs::File::open(path)
        .ok()?
        .take(2 * 1024 * 1024 + 1)
        .read_to_end(&mut bytes)
        .ok()?;
    if bytes.len() > 2 * 1024 * 1024 {
        return None;
    }
    let manifest: Value = serde_json::from_slice(&bytes).ok()?;
    if manifest["id"].as_str() != Some(job_id) {
        return None;
    }
    manifest["store_run_id"]
        .as_str()
        .filter(|id| valid_id(id))
        .map(str::to_owned)
}

fn reconcile_records(
    settings: &crate::settings::AppSettingsStore,
    host: &crate::scientific_cpython::CpythonScientificJobExecutor,
    workspace_id: &str,
    workspace: &std::path::Path,
) {
    let Ok(ids) = newest_run_directories(&workspace.join("runs")) else {
        return;
    };
    let scientific_resolver =
        crate::scientific_request_resolver::ScientificRequestResolver::new(settings.config_dir());
    for id in ids {
        let Ok(mut record) =
            crate::execution_job_records::read_execution_job_record(workspace, &id)
        else {
            continue;
        };
        if record["status"] != "completed"
            || record["job_type"] != "training"
            || !native_store_run_ids(&record).is_empty()
        {
            continue;
        }
        let preflight = crate::job_http::ScientificSubmissionPreflight {
            job_id: id.clone(),
            workspace_id: workspace_id.into(),
            workspace_path: workspace.into(),
            requested_backend: "local-python".into(),
            payload: record["request"].clone(),
        };
        let Ok(resolved) = scientific_resolver
            .resolve_general_batched(&preflight, |operation, payload| {
                host.adapt_document(operation, payload)
            })
        else {
            continue;
        };
        let configs = if resolved["dataset"].is_array() {
            resolved["dataset"].as_array().cloned().unwrap_or_default()
        } else {
            vec![resolved["dataset"].clone()]
        };
        let ids = record["request"]["legacyConfig"]["dataset_ids"]
            .as_array()
            .cloned()
            .unwrap_or_default();
        if configs.len() != ids.len() || configs.iter().any(|config| config.get("schema").is_some())
        {
            continue;
        }
        let datasets = ids
            .into_iter()
            .zip(configs)
            .map(|(dataset_id, config)| json!({"dataset_id":dataset_id,"config":config}))
            .collect::<Vec<_>>();
        let payload = json!({"workspace_path":workspace,"job_id":id,"pipeline":resolved["pipeline"],"datasets":datasets,"run_name":record["request"]["legacyConfig"]["name"],"started_at":record["started_at"],"completed_at":record["completed_at"]});
        let Ok(recovered) = host.adapt_document("runs.recover_lineage", &payload) else {
            continue;
        };
        let Some(ids) = recovered["run_ids"].as_array().filter(|ids| {
            !ids.is_empty()
                && ids.len() <= 256
                && ids.iter().all(|id| id.as_str().is_some_and(valid_id))
        }) else {
            continue;
        };
        record["driver"]["store_run_ids"] = json!(ids);
        record["driver"]["dataset_run_ids"] = recovered["dataset_run_ids"].clone();
        record["driver"]["lineage_source"] = json!("verified_owner_content_hash_and_recipe");
        let _ = crate::execution_job_records::write_execution_job_record(workspace, &id, &record);
    }
}

pub fn job_id_for_store_run(workspace: &std::path::Path, run_id: &str) -> Option<String> {
    RUN_JOB_INDEX.job_id_for_store_run(workspace, run_id)
}

/// Job directory names under `runs`. Beyond the cap the newest directories win,
/// so a large history never hides the latest jobs behind `read_dir` order.
fn settled(modified: SystemTime) -> bool {
    modified.elapsed().is_ok_and(|age| age >= TIMESTAMP_SETTLE)
}

fn newest_run_directories(runs: &Path) -> std::io::Result<Vec<String>> {
    let mut ids = std::fs::read_dir(runs)?
        .flatten()
        .filter_map(|entry| entry.file_name().to_str().map(str::to_owned))
        .collect::<Vec<_>>();
    if ids.len() > MAX_RUN_DIRECTORIES {
        let mut stamped = ids
            .into_iter()
            .map(|id| {
                let modified = std::fs::symlink_metadata(runs.join(&id))
                    .and_then(|metadata| metadata.modified())
                    .ok();
                (modified, id)
            })
            .collect::<Vec<_>>();
        stamped.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| a.1.cmp(&b.1)));
        stamped.truncate(MAX_RUN_DIRECTORIES);
        ids = stamped.into_iter().map(|(_, id)| id).collect();
    }
    Ok(ids)
}

/// Store run id to job id, rebuilt only when a job directory or one of its two
/// documents changes. Run ids are resolved per request, and rebuilding reads
/// every job directory.
struct RunJobIndex {
    slot: Mutex<Option<IndexedRuns>>,
    #[cfg(test)]
    builds: std::sync::atomic::AtomicUsize,
}

struct IndexedRuns {
    workspace: PathBuf,
    fingerprint: Vec<(String, [Option<SystemTime>; 3])>,
    jobs: HashMap<String, String>,
}

impl RunJobIndex {
    const fn new() -> Self {
        Self {
            slot: Mutex::new(None),
            #[cfg(test)]
            builds: std::sync::atomic::AtomicUsize::new(0),
        }
    }

    fn job_id_for_store_run(&self, workspace: &Path, run_id: &str) -> Option<String> {
        let mut ids = newest_run_directories(&workspace.join("runs")).ok()?;
        ids.sort();
        let fingerprint = ids
            .iter()
            .map(|id| {
                let directory = workspace.join("runs").join(id);
                let modified = |path: PathBuf| {
                    std::fs::symlink_metadata(path)
                        .and_then(|metadata| metadata.modified())
                        .ok()
                };
                (
                    id.clone(),
                    [
                        modified(directory.clone()),
                        modified(directory.join("manifest.json")),
                        modified(directory.join("execution_job_record.json")),
                    ],
                )
            })
            .collect::<Vec<_>>();
        let mut slot = self.slot.lock().unwrap_or_else(PoisonError::into_inner);
        if !slot.as_ref().is_some_and(|indexed| {
            indexed.workspace == workspace && indexed.fingerprint == fingerprint
        }) {
            #[cfg(test)]
            self.builds
                .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
            let mut jobs = HashMap::new();
            for id in &ids {
                for stored in store_run_ids(workspace, id) {
                    jobs.entry(stored).or_insert_with(|| id.clone());
                }
            }
            if !fingerprint
                .iter()
                .flat_map(|(_, times)| times)
                .all(|time| time.is_none_or(settled))
            {
                return jobs.get(run_id).cloned();
            }
            *slot = Some(IndexedRuns {
                workspace: workspace.to_path_buf(),
                fingerprint,
                jobs,
            });
        }
        slot.as_ref()?.jobs.get(run_id).cloned()
    }
}

/// Run detail and logs read a private copy of the Store taken from the
/// authenticated read transaction, so the owner sees one consistent state even
/// with a live writer. The transaction pins the file while it is open, so the
/// file's stamp identifies the copied bytes and equal stamps share one copy.
struct StoreSnapshots {
    entries: Mutex<Vec<StoredSnapshot>>,
}

struct StoredSnapshot {
    store: PathBuf,
    stamp: crate::settings::StoreStamp,
    directory: Arc<tempfile::TempDir>,
}

impl StoreSnapshots {
    const fn new() -> Self {
        Self {
            entries: Mutex::new(Vec::new()),
        }
    }

    /// A snapshot directory stays on disk while any request holds it and is
    /// deleted once evicted and released.
    fn snapshot(
        &self,
        workspace: &Path,
        connection: &rusqlite::Connection,
    ) -> Result<Arc<tempfile::TempDir>, String> {
        let key = crate::workspace_store::workspace_store_path(workspace).and_then(|store| {
            let unchanging = std::fs::metadata(&store)
                .and_then(|metadata| metadata.modified())
                .is_ok_and(settled);
            match crate::settings::store_stamp(&store) {
                Ok(Some(stamp)) if unchanging => Some((store, stamp)),
                _ => None,
            }
        });
        let mut entries = self.entries.lock().unwrap_or_else(PoisonError::into_inner);
        if let Some((store, stamp)) = &key {
            if let Some(entry) = entries
                .iter()
                .find(|entry| entry.store == *store && entry.stamp == *stamp)
            {
                return Ok(Arc::clone(&entry.directory));
            }
        }
        let directory = tempfile::Builder::new()
            .prefix("studio-run-detail-")
            .tempdir()
            .map_err(|detail| detail.to_string())?;
        let bytes = connection
            .serialize(DatabaseName::Main)
            .map_err(|detail| detail.to_string())?;
        std::fs::write(
            directory.path().join("store.sqlite"),
            bytes.as_ref() as &[u8],
        )
        .map_err(|detail| detail.to_string())?;
        drop(bytes);
        let directory = Arc::new(directory);
        if let Some((store, stamp)) = key {
            entries.insert(
                0,
                StoredSnapshot {
                    store,
                    stamp,
                    directory: Arc::clone(&directory),
                },
            );
            entries.truncate(STORE_SNAPSHOT_SLOTS);
        }
        drop(entries);
        Ok(directory)
    }
}

pub fn store_run_ids(workspace: &std::path::Path, job_id: &str) -> Vec<String> {
    if let Some(id) = legacy_store_run_id(workspace, job_id) {
        return vec![id];
    }
    crate::execution_job_records::read_execution_job_record(workspace, job_id)
        .map_or_else(|_| vec![], |record| native_store_run_ids(&record))
}

fn native_store_run_ids(record: &Value) -> Vec<String> {
    record
        .pointer("/driver/store_run_ids")
        .and_then(Value::as_array)
        .iter()
        .flat_map(|ids| ids.iter())
        .take(256)
        .filter_map(Value::as_str)
        .filter(|id| valid_id(id))
        .map(str::to_owned)
        .collect()
}

pub fn record_run_projection(
    workspace: &std::path::Path,
    connection: Option<&rusqlite::Connection>,
    job_id: &str,
    record: &Value,
) -> Result<Option<Value>, crate::workspace_store::WorkspaceStoreReadError> {
    let ids = legacy_store_run_id(workspace, job_id)
        .map_or_else(|| native_store_run_ids(record), |id| vec![id]);
    let ids = if ids.is_empty() {
        vec![job_id.to_owned()]
    } else {
        ids
    };
    for id in ids {
        let run = connection.map_or_else(
            || crate::workspace_store::read_run_detail_projection(workspace, &id),
            |connection| {
                crate::workspace_store::read_run_detail_projection_from_connection(connection, &id)
            },
        )?;
        if run.is_some() {
            return Ok(run);
        }
    }
    Ok(None)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;
    #[test]
    fn execution_backend_discovery_does_not_claim_an_unconfigured_runtime_is_ready() {
        let state = Arc::new(Mutex::new(SidecarState::default()));
        let request = HttpRequest {
            method: "GET".into(),
            path: "/api/runs/execution-backends".into(),
            query: None,
            headers: BTreeMap::default(),
            body: vec![],
        };
        let response = route(&state, &request).unwrap();
        assert_eq!(response.status, 200);
        let body: Value = serde_json::from_str(&response.body).unwrap();
        assert_eq!(body["backends"][0]["available"], false);
        assert_eq!(engine_capabilities(None)["supported_engines"], json!([]));
        assert_eq!(
            crate::route_workspace_workflows_without_global_lock(&state, &request)
                .unwrap()
                .body,
            response.body,
        );
    }
    #[test]
    fn execution_record_listing_is_wired_and_rejects_unknown_filters() {
        let settings = tempfile::tempdir().unwrap();
        let state = Arc::new(Mutex::new(SidecarState::with_app_settings_dir(
            settings.path(),
        )));
        let mut request = HttpRequest {
            method: "GET".into(),
            path: "/api/runs/execution-job-records".into(),
            query: None,
            headers: BTreeMap::default(),
            body: vec![],
        };
        let response =
            crate::route_workspace_workflows_without_global_lock(&state, &request).unwrap();
        assert_eq!(response.status, 200);
        assert_eq!(
            serde_json::from_str::<Value>(&response.body).unwrap()["records"],
            json!([])
        );
        request.query = Some("unknown=true".into());
        assert_eq!(route(&state, &request).unwrap().status, 400);
    }
    #[test]
    fn configured_invalid_attested_host_never_falls_back_to_bare_run_bridge() {
        let root = tempfile::tempdir().unwrap();
        let workspace = root.path().join("workspace");
        std::fs::create_dir(&workspace).unwrap();
        std::fs::write(
            workspace.join("store.sqlite"),
            include_bytes!("../tests/fixtures/workspace_store_v5_summary.sqlite"),
        )
        .unwrap();
        let config = root.path().join("config");
        std::fs::create_dir(&config).unwrap();
        std::fs::write(config.join("app_settings.json"), json!({"linked_workspaces":[{"id":"test","path":workspace,"name":"test","is_active":true,"linked_at":"2026-09-01T10:00:00","last_scanned":null,"discovered":{"runs_count":1}}]}).to_string()).unwrap();
        let mut state = SidecarState::with_app_settings_dir(&config);
        state.scientific_host = Some(Arc::new(crate::scientific_cpython::CpythonScientificJobExecutor::acquire_existing_with_config_dir(root.path().join("missing-python"), root.path().join("missing-packages"), &config)));
        let state = Arc::new(Mutex::new(state));
        let request = HttpRequest {
            method: "GET".into(),
            path: "/sidecar/v1/workspaces/test/run-detail-preselection".into(),
            query: None,
            headers: BTreeMap::default(),
            body: vec![],
        };
        let response = route(&state, &request).expect("invalid configured host must be handled");
        assert_eq!(response.status, 503);
    }
    #[test]
    fn durable_native_job_children_are_linked_without_guessing_from_run_names() {
        let workspace = tempfile::tempdir().unwrap();
        std::fs::create_dir(workspace.path().join("runs")).unwrap();
        let record = json!({"job_id":"native-job","job_type":"training","requested_backend":"local-python",
            "execution_backend":"dag-ml-core","execution_mode":"bounded-cpython-stdio","status":"completed",
            "progress":100,"progress_message":"","progress_unavailable":false,"created_at":"2026-10-08T10:00:00Z",
            "started_at":null,"completed_at":null,"request":{},"driver":{"store_run_ids":["child-a","child-b"]},"metrics":{},"error":null});
        crate::execution_job_records::write_execution_job_record(
            workspace.path(),
            "native-job",
            &record,
        )
        .unwrap();
        assert_eq!(
            store_run_ids(workspace.path(), "native-job"),
            vec!["child-a", "child-b"]
        );
        assert_eq!(
            job_id_for_store_run(workspace.path(), "child-b").as_deref(),
            Some("native-job")
        );
    }
    #[test]
    fn shared_job_still_resolves_a_remaining_child_after_first_child_deletion() {
        let workspace = tempfile::tempdir().unwrap();
        std::fs::write(
            workspace.path().join("store.sqlite"),
            include_bytes!("../tests/fixtures/workspace_store_v5_summary.sqlite"),
        )
        .unwrap();
        let summaries = crate::workspace_store::read_run_summaries(workspace.path(), 1, 0).unwrap();
        let id = summaries[0].response()["id"].as_str().unwrap().to_owned();
        let record = json!({"driver":{"store_run_ids":["removed-child", id]}});
        let run = record_run_projection(workspace.path(), None, "shared-job", &record)
            .unwrap()
            .unwrap();
        assert_eq!(run["run_id"], id);
    }
    #[test]
    fn run_history_route_is_not_materialized_as_a_run_id() {
        let state = Arc::new(Mutex::new(SidecarState::default()));
        let request = HttpRequest {
            method: "GET".into(),
            path: "/api/workspaces/test/runs/enriched".into(),
            query: Some("limit=100".into()),
            headers: BTreeMap::default(),
            body: vec![],
        };
        assert!(route(&state, &request).is_none());
    }
    #[test]
    fn run_documents_resolve_legacy_job_ids_in_both_directions() {
        let workspace = tempfile::tempdir().unwrap();
        let job = workspace.path().join("runs/old-job");
        std::fs::create_dir_all(&job).unwrap();
        std::fs::write(
            job.join("manifest.json"),
            r#"{"id":"old-job","store_run_id":"stored-run"}"#,
        )
        .unwrap();
        assert_eq!(
            legacy_store_run_id(workspace.path(), "old-job").as_deref(),
            Some("stored-run")
        );
        assert_eq!(
            job_id_for_store_run(workspace.path(), "stored-run").as_deref(),
            Some("old-job")
        );
        assert!(legacy_store_run_id(workspace.path(), "../old-job").is_none());
        assert!(job_id_for_store_run(workspace.path(), "missing-run").is_none());
    }
    #[test]
    fn interrupted_runs_are_historical_failures_without_fabricating_completion() {
        let mut history = json!({"runs":[{"status":"running","completed_at":null,"error":null},{"status":"failed","error":"Original error"}]});
        normalize_interrupted(&mut history, &[]);
        assert_eq!(history["runs"][0]["status"], "failed");
        assert_eq!(history["runs"][0]["stored_status"], "running");
        assert!(history["runs"][0]["completed_at"].is_null());
        assert_eq!(history["runs"][1]["error"], "Original error");
    }
    #[test]
    fn live_training_keeps_unpublished_child_runs_active() {
        let mut history = json!({"runs":[{"status":"running"}]});
        normalize_interrupted(&mut history, &[json!({"job":{"status":"running"}})]);
        assert_eq!(history["runs"][0]["status"], "running");
    }

    fn store_fixture(workspace: &Path) -> PathBuf {
        let path = workspace.join("store.sqlite");
        std::fs::write(
            &path,
            include_bytes!("../tests/fixtures/workspace_store_v5_summary.sqlite"),
        )
        .unwrap();
        path
    }

    fn settle() {
        std::thread::sleep(TIMESTAMP_SETTLE * 2);
    }

    fn snapshot_of(snapshots: &StoreSnapshots, workspace: &Path) -> Arc<tempfile::TempDir> {
        let connection = crate::workspace_store::open_read_snapshot(workspace).unwrap();
        connection
            .query_row("SELECT count(*) FROM sqlite_master", [], |row| {
                row.get::<_, i64>(0)
            })
            .unwrap();
        snapshots.snapshot(workspace, &connection).unwrap()
    }

    #[test]
    fn store_snapshots_are_reused_until_the_store_changes() {
        let workspace = tempfile::tempdir().unwrap();
        let store = store_fixture(workspace.path());
        settle();
        let snapshots = StoreSnapshots::new();
        let first = snapshot_of(&snapshots, workspace.path());
        let again = snapshot_of(&snapshots, workspace.path());
        assert!(Arc::ptr_eq(&first, &again));
        assert_eq!(
            std::fs::read(first.path().join("store.sqlite")).unwrap(),
            std::fs::read(&store).unwrap()
        );

        rusqlite::Connection::open(&store)
            .unwrap()
            .execute_batch("CREATE TABLE snapshot_probe (x)")
            .unwrap();
        settle();
        let changed = snapshot_of(&snapshots, workspace.path());
        assert!(!Arc::ptr_eq(&first, &changed));
        assert_eq!(
            std::fs::read(changed.path().join("store.sqlite")).unwrap(),
            std::fs::read(&store).unwrap()
        );
        assert!(Arc::ptr_eq(
            &changed,
            &snapshot_of(&snapshots, workspace.path())
        ));
    }

    #[test]
    fn evicted_store_snapshots_are_deleted_once_released() {
        let workspace = tempfile::tempdir().unwrap();
        let store = store_fixture(workspace.path());
        let snapshots = StoreSnapshots::new();
        let mut directories = Vec::new();
        for table in 0..=STORE_SNAPSHOT_SLOTS {
            rusqlite::Connection::open(&store)
                .unwrap()
                .execute_batch(&format!("CREATE TABLE snapshot_probe_{table} (x)"))
                .unwrap();
            settle();
            directories.push(snapshot_of(&snapshots, workspace.path()));
        }
        let oldest = directories.remove(0);
        let path = oldest.path().to_path_buf();
        assert!(path.exists(), "an in-flight request keeps its snapshot");
        drop(oldest);
        assert!(!path.exists(), "an evicted snapshot is removed on release");
        assert!(directories.iter().all(|kept| kept.path().exists()));
        assert_eq!(
            snapshots.entries.lock().unwrap().len(),
            STORE_SNAPSHOT_SLOTS
        );
    }

    #[test]
    fn a_just_modified_store_is_never_shared() {
        let workspace = tempfile::tempdir().unwrap();
        store_fixture(workspace.path());
        let snapshots = StoreSnapshots::new();
        let first = snapshot_of(&snapshots, workspace.path());
        let second = snapshot_of(&snapshots, workspace.path());
        assert!(!Arc::ptr_eq(&first, &second));
        assert_eq!(snapshots.entries.lock().unwrap().len(), 0);
    }

    #[cfg(unix)]
    #[test]
    fn oversized_run_histories_keep_the_newest_directories() {
        let workspace = tempfile::tempdir().unwrap();
        let runs = workspace.path().join("runs");
        let total = MAX_RUN_DIRECTORIES + 5;
        for index in 0..total {
            let directory = runs.join(format!("job-{index:05}"));
            std::fs::create_dir_all(&directory).unwrap();
            std::fs::File::open(&directory)
                .unwrap()
                .set_modified(
                    SystemTime::UNIX_EPOCH + Duration::from_secs(1_700_000_000 + index as u64),
                )
                .unwrap();
        }
        let kept = newest_run_directories(&runs).unwrap();
        assert_eq!(kept.len(), MAX_RUN_DIRECTORIES);
        assert_eq!(kept[0], format!("job-{:05}", total - 1));
        assert!(kept.contains(&format!("job-{:05}", total - 1)));
        assert!(!kept.contains(&"job-00000".to_owned()));
        assert!(!kept.contains(&"job-00004".to_owned()));
        assert!(kept.contains(&"job-00005".to_owned()));
    }

    #[test]
    fn small_run_histories_are_listed_without_reordering_or_loss() {
        let workspace = tempfile::tempdir().unwrap();
        for id in ["a", "b", "c"] {
            std::fs::create_dir_all(workspace.path().join("runs").join(id)).unwrap();
        }
        let mut ids = newest_run_directories(&workspace.path().join("runs")).unwrap();
        ids.sort();
        assert_eq!(ids, ["a", "b", "c"]);
        assert!(newest_run_directories(&workspace.path().join("missing")).is_err());
    }

    fn job_record(job_id: &str, store_run_ids: &[&str]) -> Value {
        json!({"job_id":job_id,"job_type":"training","requested_backend":"local-python",
            "execution_backend":"dag-ml-core","execution_mode":"bounded-cpython-stdio","status":"completed",
            "progress":100,"progress_message":"","progress_unavailable":false,"created_at":"2026-10-08T10:00:00Z",
            "started_at":null,"completed_at":null,"request":{},"driver":{"store_run_ids":store_run_ids},"metrics":{},"error":null})
    }

    #[test]
    fn run_to_job_lookups_reuse_one_index_until_a_job_changes() {
        let workspace = tempfile::tempdir().unwrap();
        std::fs::create_dir(workspace.path().join("runs")).unwrap();
        let write = |job: &str, runs: &[&str]| {
            crate::execution_job_records::write_execution_job_record(
                workspace.path(),
                job,
                &job_record(job, runs),
            )
            .unwrap();
        };
        write("job-a", &["run-a1", "run-a2"]);
        settle();
        let index = RunJobIndex::new();
        let builds = || index.builds.load(std::sync::atomic::Ordering::Relaxed);
        assert_eq!(
            index
                .job_id_for_store_run(workspace.path(), "run-a2")
                .as_deref(),
            Some("job-a")
        );
        assert!(index
            .job_id_for_store_run(workspace.path(), "run-b1")
            .is_none());
        assert_eq!(builds(), 1, "misses are answered from the index too");

        write("job-b", &["run-b1"]);
        settle();
        assert_eq!(
            index
                .job_id_for_store_run(workspace.path(), "run-b1")
                .as_deref(),
            Some("job-b")
        );
        assert_eq!(builds(), 2, "a new job directory rebuilds the index");

        write("job-b", &["run-b1", "run-b2"]);
        settle();
        assert_eq!(
            index
                .job_id_for_store_run(workspace.path(), "run-b2")
                .as_deref(),
            Some("job-b")
        );
        assert_eq!(builds(), 3, "a rewritten record rebuilds the index");
        assert_eq!(
            index
                .job_id_for_store_run(workspace.path(), "run-a1")
                .as_deref(),
            Some("job-a")
        );
        assert_eq!(builds(), 3);

        std::fs::remove_dir_all(workspace.path().join("runs/job-a")).unwrap();
        assert!(index
            .job_id_for_store_run(workspace.path(), "run-a1")
            .is_none());
        assert_eq!(builds(), 4, "a deleted job directory rebuilds the index");
    }

    #[test]
    fn freshly_written_jobs_are_resolved_but_not_cached() {
        let workspace = tempfile::tempdir().unwrap();
        std::fs::create_dir(workspace.path().join("runs")).unwrap();
        crate::execution_job_records::write_execution_job_record(
            workspace.path(),
            "job-new",
            &job_record("job-new", &["run-new"]),
        )
        .unwrap();
        let index = RunJobIndex::new();
        for _ in 0..2 {
            assert_eq!(
                index
                    .job_id_for_store_run(workspace.path(), "run-new")
                    .as_deref(),
                Some("job-new")
            );
        }
        assert_eq!(index.builds.load(std::sync::atomic::Ordering::Relaxed), 2);
    }
}
