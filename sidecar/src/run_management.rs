//! Run operations use the attested library worker outside the global route lock.
use crate::{HttpRequest, HttpResponse, SidecarState};
use rusqlite::DatabaseName;
use serde_json::{json, Value};
use std::{
    sync::{Arc, Mutex},
    time::Instant,
};

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
    // Materialize a private snapshot from the authenticated connection, so the
    // owner sees the same read transaction even with a live WAL.
    let snapshot = match tempfile::Builder::new()
        .prefix("studio-run-detail-")
        .tempdir()
    {
        Ok(snapshot) => snapshot,
        Err(detail) => return Some(error(500, detail)),
    };
    let Some(store) = workspace.store() else {
        return Some(error(404, "Workspace store not found"));
    };
    let bytes = match store.serialize(DatabaseName::Main) {
        Ok(bytes) => bytes,
        Err(detail) => return Some(error(500, detail)),
    };
    if let Err(detail) = std::fs::write(
        snapshot.path().join("store.sqlite"),
        bytes.as_ref() as &[u8],
    ) {
        return Some(error(500, detail));
    }
    drop(bytes);
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
    let entries = match std::fs::read_dir(workspace.path().join("runs")) {
        Ok(entries) => entries,
        Err(detail) if detail.kind() == std::io::ErrorKind::NotFound => {
            return HttpResponse::json(200, json!({"records":[],"total":0}).to_string())
        }
        Err(detail) => return error(500, detail),
    };
    let mut records = Vec::new();
    let mut skipped = 0;
    for entry in entries.take(2000).flatten() {
        let Some(id) = entry.file_name().to_str().map(str::to_owned) else {
            continue;
        };
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

pub fn job_id_for_store_run(workspace: &std::path::Path, run_id: &str) -> Option<String> {
    std::fs::read_dir(workspace.join("runs"))
        .ok()?
        .take(2000)
        .flatten()
        .filter_map(|entry| entry.file_name().to_str().map(str::to_owned))
        .find(|id| {
            store_run_ids(workspace, id)
                .iter()
                .any(|stored| stored == run_id)
        })
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
    #[test]
    fn execution_backend_discovery_does_not_claim_an_unconfigured_runtime_is_ready() {
        let state = Arc::new(Mutex::new(SidecarState::default()));
        let request = HttpRequest {
            method: "GET".into(),
            path: "/api/runs/execution-backends".into(),
            query: None,
            headers: Default::default(),
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
        let state = Arc::new(Mutex::new(SidecarState::with_app_settings_dir(settings.path())));
        let mut request = HttpRequest {
            method: "GET".into(),
            path: "/api/runs/execution-job-records".into(),
            query: None,
            headers: Default::default(),
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
            headers: Default::default(),
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
            headers: Default::default(),
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
}
