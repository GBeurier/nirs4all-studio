//! Rust-owned authorization, job lifecycle and durable analysis results.
use crate::{
    job_http::NativeJobRuntime,
    job_http::{
        JobExecutorError, ScientificExecutionRequest, ScientificExecutorSelection,
        ScientificJobExecutor, ScientificJobTerminal, ScientificSubmissionPreflight,
    },
    scientific_cpython::CpythonScientificJobExecutor,
    settings::{AppSettingsStore, LinkedWorkspaceAccess},
    HttpRequest, HttpResponse, SidecarState,
};
use serde_json::{json, Value};
use std::{
    collections::BTreeMap,
    fs,
    io::Write,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::Instant,
};

const RESULT_LIMIT: u64 = 32 * 1024 * 1024;

pub fn owns_path(path: &str) -> bool {
    path.starts_with("/api/analysis/shap/")
        || matches!(
            path,
            "/api/synthesis/preview"
                | "/api/synthesis/generate"
                | "/api/synthesis/status"
                | "/api/synthesis/components"
                | "/api/synthesis/validate"
        )
        || (path.starts_with("/api/aggregated-predictions/")
            && (path.ends_with("/robustness-report")
                || path.ends_with("/robustness-evidence")
                || path.starts_with("/api/aggregated-predictions/robustness-reports/")))
}

fn error(status: u16, detail: impl Into<String>) -> HttpResponse {
    HttpResponse::json(status, json!({"detail": detail.into()}).to_string())
}

fn identifier(raw: &str) -> Result<String, String> {
    let id = percent_encoding::percent_decode_str(raw)
        .decode_utf8()
        .map_err(|_| "Invalid identifier")?;
    if id.is_empty()
        || id.len() > 256
        || id.contains(['/', '\\', '\0', ':'])
        || matches!(id.as_ref(), "." | "..")
    {
        return Err("Invalid identifier".into());
    }
    Ok(id.into_owned())
}

fn body(request: &HttpRequest) -> Result<Value, String> {
    if request.body.len() > 65536 {
        return Err("Analysis request exceeds 64 KiB".into());
    }
    let value: Value =
        serde_json::from_slice(&request.body).map_err(|_| "Expected a JSON object")?;
    if !value.is_object() {
        return Err("Expected a JSON object".into());
    }
    Ok(value)
}

fn result_dir(workspace: &Path, create: bool) -> Result<PathBuf, String> {
    let root = workspace
        .canonicalize()
        .map_err(|error| error.to_string())?;
    let mut path = root.clone();
    for name in ["analysis_results", "shap"] {
        path.push(name);
        if create && !path.exists() {
            fs::create_dir(&path).map_err(|error| error.to_string())?;
        }
        let metadata = fs::symlink_metadata(&path).map_err(|error| error.to_string())?;
        if !metadata.is_dir()
            || metadata.file_type().is_symlink()
            || !path
                .canonicalize()
                .map_err(|error| error.to_string())?
                .starts_with(&root)
        {
            return Err("Analysis output escaped the workspace".into());
        }
    }
    Ok(path)
}

fn load_result(workspace: &Path, id: &str) -> Result<Value, String> {
    let path = result_dir(workspace, false)?.join(format!("{id}.native.json"));
    let meta = fs::symlink_metadata(&path).map_err(|_| "not_found: SHAP result does not exist")?;
    if !meta.is_file() || meta.file_type().is_symlink() || meta.len() > RESULT_LIMIT {
        return Err("Invalid SHAP result file".into());
    }
    serde_json::from_slice(&fs::read(path).map_err(|error| error.to_string())?)
        .map_err(|error| error.to_string())
}

#[derive(Debug)]
struct AnalysisExecutor {
    host: Arc<CpythonScientificJobExecutor>,
    cancel: Arc<AtomicBool>,
}

impl ScientificJobExecutor for AnalysisExecutor {
    fn is_selected(&self) -> bool {
        self.host.is_selected()
    }
    fn preflight_submission(
        &self,
        request: &ScientificSubmissionPreflight,
    ) -> Result<ScientificExecutorSelection, JobExecutorError> {
        result_dir(&request.workspace_path, true)
            .map_err(|_| JobExecutorError::PreflightRefused)?;
        Ok(ScientificExecutorSelection {
            execution_backend: "local-python".into(),
            execution_mode: Some("shap-analysis".into()),
            prepared_payload: request.payload.clone(),
        })
    }
    fn submit_scientific(
        &self,
        request: &ScientificExecutionRequest,
        terminal: Arc<dyn ScientificJobTerminal>,
    ) -> Result<(), JobExecutorError> {
        let host = self.host.clone();
        let cancel = self.cancel.clone();
        let request = request.clone();
        std::thread::Builder::new().name("studio-shap-analysis".into()).spawn(move || {
            let mut payload = request.payload.clone();
            payload["job_id"] = json!(request.job_id);
            let _ = terminal.activity(&request.job_id, "Computing SHAP with the captured predictor; percentage unavailable");
            let outcome = host.adapt_document_cancellable("analysis.shap_compute", &payload, &cancel).and_then(|result| {
                if cancel.load(Ordering::Acquire) { return Err("cancelled".into()); }
                let bytes = serde_json::to_vec(&result).map_err(|error| error.to_string())?;
                if bytes.len() as u64 > RESULT_LIMIT { return Err("SHAP result exceeds byte budget".into()); }
                let directory = result_dir(&request.workspace_path, true)?;
                let mut staged = tempfile::NamedTempFile::new_in(&directory).map_err(|error| error.to_string())?;
                staged.write_all(&bytes).map_err(|error| error.to_string())?;
                staged.as_file().sync_all().map_err(|error| error.to_string())?;
                staged.persist_noclobber(directory.join(format!("{}.native.json", request.job_id))).map_err(|error| error.to_string())?;
                Ok(json!({"job_id":request.job_id, "n_samples":result["n_samples"], "analysis_type":"shap"}))
            });
            if cancel.load(Ordering::Acquire) {
                if let Ok(directory)=result_dir(&request.workspace_path,false){let _=fs::remove_file(directory.join(format!("{}.native.json",request.job_id)));}
                let _ = terminal.acknowledge_cancel(&request.job_id);
            }
            else { match outcome { Ok(result) => { let _ = terminal.complete(&request.job_id, result); }, Err(detail) => { let _ = terminal.fail(&request.job_id, &detail); } } }
        }).map_err(|_| JobExecutorError::SubmissionRefused)?;
        Ok(())
    }
    fn request_cooperative_cancel(&self, _id: &str) -> Result<(), JobExecutorError> {
        self.cancel.store(true, Ordering::Release);
        Ok(())
    }
}

struct Context<'a> {
    request: &'a HttpRequest,
    settings: &'a AppSettingsStore,
    access: &'a LinkedWorkspaceAccess,
    jobs: &'a NativeJobRuntime,
    host: &'a Arc<CpythonScientificJobExecutor>,
}

impl Context<'_> {
    fn invoke(&self, operation: &str, payload: &Value) -> Result<Value, String> {
        self.host.adapt_document(operation, payload)
    }

    fn dispatch(&self) -> Result<HttpResponse, String> {
        let request = self.request;
        if let Some(name) = request.path.strip_prefix("/api/synthesis/") {
            return self.synthesis(name);
        }
        if let Some(tail) = request.path.strip_prefix("/api/analysis/shap/") {
            return self.shap(tail);
        }
        self.robustness()
    }

    fn shap(&self, tail: &str) -> Result<HttpResponse, String> {
        if matches!(tail, "config" | "models") {
            return self.shap_catalogue(tail);
        }
        if tail == "compute" {
            return self.shap_compute();
        }
        if let Some(raw_id) = tail.strip_prefix("status/") {
            return self.shap_status(raw_id);
        }
        if let Some(tail) = tail.strip_prefix("results/") {
            return self.shap_results(tail);
        }
        Err("not_found: Unknown SHAP endpoint".into())
    }

    fn synthesis(&self, name: &str) -> Result<HttpResponse, String> {
        let request = self.request;
        let workspace = self.access.path();
        let method = if matches!(name, "status" | "components") {
            "GET"
        } else {
            "POST"
        };
        if request.method != method {
            return Ok(crate::method_not_allowed(
                &request.method,
                &request.path,
                method,
            ));
        }
        if request.query.is_some() {
            return Err("Synthesis does not accept query fields".into());
        }
        let mut payload = if method == "GET" {
            json!({})
        } else {
            body(request)?
        };
        validate_synthesis(name, &payload)?;
        if name == "generate" {
            return generate(self.settings, workspace, &payload, &|operation, payload| {
                self.invoke(operation, payload)
            });
        }
        payload["workspace_path"] = json!(workspace);
        Ok(HttpResponse::json(
            200,
            self.invoke(&format!("synthesis.{name}"), &payload)?
                .to_string(),
        ))
    }

    fn shap_catalogue(&self, tail: &str) -> Result<HttpResponse, String> {
        let request = self.request;
        let workspace = self.access.path();
        if request.method != "GET" {
            return Ok(crate::method_not_allowed(
                &request.method,
                &request.path,
                "GET",
            ));
        }
        if request.query.is_some() {
            return Err("Unexpected SHAP catalogue query".into());
        }
        let payload = if tail == "models" {
            crate::general_prediction::catalogue_payload(workspace)?
        } else {
            json!({})
        };
        let mut value = self.invoke(
            if tail == "models" {
                "analysis.shap_models"
            } else {
                "analysis.shap_config"
            },
            &payload,
        )?;
        if tail == "models" {
            let links = self.settings.dataset_links()?;
            let metadata = if let Some(connection) = self.access.store() {
                let mut identities = BTreeMap::new();
                crate::workspace_store::visit_results_summary_source_from_connection(
                    &connection,
                    |row| {
                        identities.insert(row.chain_id, row.run_id);
                    },
                )
                .map_err(|error| error.to_string())?;
                let run_ids = identities
                    .values()
                    .map(String::as_str)
                    .collect::<std::collections::BTreeSet<_>>();
                let records = crate::workspace_store::read_run_metadata_batch_from_connection(
                    &connection,
                    &run_ids.into_iter().collect::<Vec<_>>(),
                )
                .map_err(|error| error.to_string())?;
                (identities, records)
            } else {
                (BTreeMap::new(), Vec::new())
            };
            bind_shap_dataset_links(&mut value, &links, &metadata.0, &metadata.1);
        }
        Ok(HttpResponse::json(200, value.to_string()))
    }

    fn shap_compute(&self) -> Result<HttpResponse, String> {
        let request = self.request;
        let workspace = self.access.path();
        if request.method != "POST" {
            return Ok(crate::method_not_allowed(
                &request.method,
                &request.path,
                "POST",
            ));
        }
        if request.query.is_some() {
            return Err("Unexpected SHAP compute query".into());
        }
        let raw = body(request)?;
        validate_shap(&raw)?;
        let chain = raw
            .get("chain_id")
            .and_then(Value::as_str)
            .filter(|id| !id.is_empty());
        let bundle = raw
            .get("bundle_path")
            .and_then(Value::as_str)
            .filter(|id| !id.is_empty());
        if chain.is_some() == bundle.is_some() {
            return Err("Select exactly one chain or bundle".into());
        }
        let model = json!({"model_id":chain.or(bundle), "model_source":if chain.is_some(){"chain"}else{"bundle"},
            "data_source":"dataset", "dataset_id":raw["dataset_id"], "partition":raw.get("partition").cloned().unwrap_or_else(|| json!("test"))});
        let mut payload = crate::general_prediction::prediction_payload(
            workspace,
            &model,
            &|id| crate::workspace_documents::linked_dataset(self.settings, id),
            &|operation, payload| self.invoke(operation, payload),
        )?;
        for key in [
            "dataset_id",
            "n_samples",
            "n_background",
            "explainer_type",
            "bin_size",
            "bin_stride",
            "bin_aggregation",
        ] {
            if let Some(value) = raw.get(key) {
                payload[key] = value.clone();
            }
        }
        let executor = Arc::new(AnalysisExecutor {
            host: Arc::clone(self.host),
            cancel: Arc::new(AtomicBool::new(false)),
        });
        let receipt = self
            .jobs
            .submit_with_executor_kind_at(
                crate::job_lifecycle::JobType::Analysis,
                "SHAP explanation",
                "local-python",
                &payload,
                self.access.id(),
                workspace,
                &crate::websocket_transport::rfc3339_now(),
                Instant::now(),
                executor,
            )
            .map_err(|error| format!("Analysis submission failed: {error:?}"))?;
        Ok(HttpResponse::json(
            200,
            json!({"job_id":receipt.job_id,"status":"running","message":"SHAP analysis started"})
                .to_string(),
        ))
    }

    fn shap_status(&self, raw_id: &str) -> Result<HttpResponse, String> {
        let request = self.request;
        let workspace = self.access.path();
        if request.method != "GET" {
            return Ok(crate::method_not_allowed(
                &request.method,
                &request.path,
                "GET",
            ));
        }
        let id = identifier(raw_id)?;
        // Only the selected workspace can read this job's stored scientific input.
        let mut record = crate::execution_job_records::read_execution_job_record(workspace, &id)
            .map_err(|_| "not_found: Analysis job is not in the active workspace")?;
        if record["execution_mode"] != "shap-analysis" {
            return Err("not_found: Analysis job is not in the active workspace".into());
        }
        if request.query.is_some() {
            return Err("Unexpected SHAP status query".into());
        }
        let value = self.jobs.get_at(&id, Instant::now()).map_or_else(
            || {
                record["id"] = json!(id);
                record["type"] = json!("analysis");
                record
            },
            |job| job.public_json(),
        );
        Ok(HttpResponse::json(200, value.to_string()))
    }

    fn shap_results(&self, tail: &str) -> Result<HttpResponse, String> {
        let request = self.request;
        let workspace = self.access.path();
        let mut segments = tail.split('/');
        let id = identifier(segments.next().ok_or("Missing SHAP job id")?)?;
        let view = segments.next().unwrap_or("results");
        let mut payload = json!({"result": load_result(workspace, &id)?, "view":view});
        let expected = if view == "rebin" { "POST" } else { "GET" };
        if request.method != expected {
            return Ok(crate::method_not_allowed(
                &request.method,
                &request.path,
                expected,
            ));
        }
        if view == "sample" {
            payload["sample_idx"] = json!(segments
                .next()
                .ok_or("Missing sample index")?
                .parse::<u32>()
                .map_err(|_| "Invalid sample index")?);
        }
        if segments.next().is_some() {
            return Err("Unexpected SHAP route suffix".into());
        }
        if view == "rebin" {
            let raw = body(request)?;
            validate_shap(&raw)?;
            for (key, value) in raw.as_object().unwrap() {
                payload[key] = value.clone();
            }
        }
        apply_view_query(&mut payload, request.query.as_deref())?;
        let value = self.invoke("analysis.shap_view", &payload)?;
        if view == "rebin" {
            payload["result"]["binned_importance"] = value["binned_importance"].clone();
            let directory = result_dir(workspace, false)?;
            let bytes =
                serde_json::to_vec(&payload["result"]).map_err(|error| error.to_string())?;
            if bytes.len() as u64 > RESULT_LIMIT {
                return Err("Updated SHAP result exceeds byte budget".into());
            }
            let mut file =
                tempfile::NamedTempFile::new_in(&directory).map_err(|error| error.to_string())?;
            file.write_all(&bytes).map_err(|error| error.to_string())?;
            file.as_file()
                .sync_all()
                .map_err(|error| error.to_string())?;
            file.persist(directory.join(format!("{id}.native.json")))
                .map_err(|error| error.to_string())?;
        }
        Ok(HttpResponse::json(200, value.to_string()))
    }

    fn robustness(&self) -> Result<HttpResponse, String> {
        let request = self.request;
        let workspace = self.access.path();
        let tail = request
            .path
            .strip_prefix("/api/aggregated-predictions/")
            .ok_or("Unknown analysis path")?;
        let (operation, id, method) = if let Some(export) = tail.strip_prefix("robustness-reports/")
        {
            (
                "analysis.robustness_export",
                export
                    .strip_suffix("/export")
                    .ok_or("Unknown robustness export")?,
                "GET",
            )
        } else if let Some(id) = tail.strip_suffix("/robustness-report") {
            ("analysis.robustness_report", id, "POST")
        } else {
            (
                "analysis.robustness_evidence",
                tail.strip_suffix("/robustness-evidence")
                    .ok_or("Unknown robustness path")?,
                "GET",
            )
        };
        if request.method != method {
            return Ok(crate::method_not_allowed(
                &request.method,
                &request.path,
                method,
            ));
        }
        let mut payload = if method == "POST" {
            body(request)?
        } else {
            json!({})
        };
        if payload
            .as_object()
            .unwrap()
            .keys()
            .any(|key| !["robustness", "seed", "name", "robustness_id"].contains(&key.as_str()))
        {
            return Err("Unexpected robustness request fields".into());
        }
        payload["workspace_path"] = json!(workspace);
        payload[if operation == "analysis.robustness_export" {
            "robustness_id"
        } else {
            "prediction_id"
        }] = json!(identifier(id)?);
        let mut format = "json".to_owned();
        for (key, value) in
            url::form_urlencoded::parse(request.query.as_deref().unwrap_or("").as_bytes())
        {
            if operation != "analysis.robustness_export"
                || key != "format"
                || !matches!(value.as_ref(), "json" | "markdown" | "html")
            {
                return Err("Unexpected robustness query".into());
            }
            format = value.into_owned();
        }
        payload["format"] = json!(format);
        let value = self.invoke(operation, &payload)?;
        if operation == "analysis.robustness_export" {
            let extension = if format == "markdown" { "md" } else { &format };
            return Ok(HttpResponse::json(
                200,
                value["body"].as_str().ok_or("Invalid exported report")?,
            )
            .with_header(
                "Content-Type",
                if format == "html" {
                    "text/html; charset=utf-8"
                } else if format == "markdown" {
                    "text/markdown; charset=utf-8"
                } else {
                    "application/json"
                },
            )
            .with_header(
                "Content-Disposition",
                format!("attachment; filename=\"robustness-report.{extension}\""),
            ));
        }
        Ok(HttpResponse::json(200, value.to_string()))
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
    let Some(host) = host else {
        return Some(error(503, "Attested analysis library host unavailable"));
    };
    let access = match settings.active_linked_workspace_access() {
        Ok(Some(value)) => value,
        Ok(None) => return Some(error(409, "No active workspace")),
        Err(detail) => return Some(error(409, detail)),
    };
    let ctx = Context {
        request,
        settings: &settings,
        access: &access,
        jobs: &jobs,
        host: &host,
    };
    let outcome = ctx.dispatch();
    Some(outcome.unwrap_or_else(|detail| {
        error(
            if detail.starts_with("not_found:") {
                404
            } else {
                400
            },
            detail,
        )
    }))
}

/// A scientific display name cannot authorize a Studio dataset. Bind each chain
/// through its own run's declared identity and the current authorized catalogue.
fn bind_shap_dataset_links(
    catalogue: &mut Value,
    links: &[crate::settings::DatasetLinkIdentity],
    chain_runs: &BTreeMap<String, String>,
    records: &[Value],
) {
    let records: BTreeMap<_, _> = records
        .iter()
        .filter_map(|record| record["run_id"].as_str().map(|id| (id, record)))
        .collect();
    if let Some(groups) = catalogue["datasets"].as_array_mut() {
        for group in groups {
            if let Some(chains) = group["chains"].as_array_mut() {
                for chain in chains {
                    let run_id = chain["chain_id"].as_str().and_then(|id| chain_runs.get(id));
                    let record = run_id.and_then(|id| records.get(id.as_str()));
                    let name = chain["dataset_name"].as_str();
                    let candidates: Vec<_> = record
                        .and_then(|record| record["datasets"].as_array())
                        .into_iter()
                        .flatten()
                        .filter(|dataset| {
                            dataset["name"]
                                .as_str()
                                .or_else(|| dataset["dataset_name"].as_str())
                                == name
                        })
                        .collect();
                    let linked = if candidates.len() == 1 {
                        candidates[0]["linked_dataset_id"]
                            .as_str()
                            .filter(|id| links.iter().filter(|link| link.id == *id).count() == 1)
                    } else {
                        None
                    };
                    let linked = linked.map(str::to_owned);
                    chain["run_id"] = json!(run_id);
                    chain["linked_dataset_id"] = json!(linked);
                    chain["dataset_link_status"] = json!(if linked.is_some() {
                        "linked"
                    } else {
                        "unresolved"
                    });
                }
            }
        }
    }
    if let Some(bundles) = catalogue["bundles"].as_array_mut() {
        // Export display names do not establish a workspace dataset identity.
        for bundle in bundles {
            bundle["linked_dataset_id"] = Value::Null;
            bundle["dataset_link_status"] = json!("unresolved");
        }
    }
}

fn validate_shap(value: &Value) -> Result<(), String> {
    let allowed = [
        "chain_id",
        "bundle_path",
        "dataset_id",
        "partition",
        "explainer_type",
        "n_samples",
        "n_background",
        "bin_size",
        "bin_stride",
        "bin_aggregation",
    ];
    if value
        .as_object()
        .is_none_or(|object| object.keys().any(|key| !allowed.contains(&key.as_str())))
    {
        return Err("Unexpected SHAP fields".into());
    }
    for (key, low, high) in [
        ("n_samples", 1, 5000),
        ("n_background", 10, 500),
        ("bin_size", 5, 100),
        ("bin_stride", 1, 50),
    ] {
        if value.get(key).is_some_and(|value| {
            !value.is_null()
                && value
                    .as_u64()
                    .is_none_or(|count| count < low || count > high)
        }) {
            return Err(format!("Invalid {key}"));
        }
    }
    if value
        .get("explainer_type")
        .is_some_and(|value| !matches!(value.as_str(), Some("auto" | "kernel")))
    {
        return Err("Captured full pipelines support auto or kernel explainers".into());
    }
    if value.get("bin_aggregation").is_some_and(|value| {
        !matches!(
            value.as_str(),
            Some("sum" | "sum_abs" | "mean" | "mean_abs")
        )
    }) {
        return Err("Invalid bin aggregation".into());
    }
    Ok(())
}

fn apply_view_query(payload: &mut Value, query: Option<&str>) -> Result<(), String> {
    let mut seen = BTreeMap::new();
    for (key, value) in url::form_urlencoded::parse(query.unwrap_or("").as_bytes()) {
        if seen.insert(key.to_string(), true).is_some() {
            return Err("Duplicate SHAP query field".into());
        }
        match key.as_ref() {
            "sample_indices" if payload["view"] == "spectral-detail" => {
                let values = value
                    .split(',')
                    .map(|part| {
                        part.parse::<u32>()
                            .map_err(|_| "Invalid sample index".to_owned())
                    })
                    .collect::<Result<Vec<_>, _>>()?;
                if values.len() > 5000 {
                    return Err("Too many sample indices".into());
                }
                payload["sample_indices"] = json!(values);
            }
            "max_samples" if payload["view"] == "beeswarm" => {
                let count = value.parse::<u32>().map_err(|_| "Invalid sample count")?;
                if !(1..=1000).contains(&count) {
                    return Err("Invalid sample count".into());
                }
                payload["max_samples"] = json!(count);
            }
            "top_n" if payload["view"] == "sample" => {
                let count = value.parse::<u32>().map_err(|_| "Invalid top count")?;
                if !(1..=100).contains(&count) {
                    return Err("Invalid top count".into());
                }
                payload["top_n"] = json!(count);
            }
            _ => return Err("Unsupported SHAP query field".into()),
        }
    }
    Ok(())
}

/// Smallest whole number of grid points covering `count`, for bounded counts only.
fn grid_points(count: f64) -> Option<u64> {
    (1..=10_000_u32)
        .find(|points| f64::from(*points) >= count)
        .map(u64::from)
}

fn synthesis_features(steps: &[Value]) -> Result<u64, String> {
    let mut features = 751_u64;
    for step in steps {
        if step.get("enabled").and_then(Value::as_bool) == Some(false) || step["type"] != "features"
        {
            continue;
        }
        let parameters = &step["params"];
        if let Some(wavelengths) = parameters["wavelengths"].as_array() {
            features = wavelengths.len() as u64;
        } else if let Some(range) = parameters["wavelength_range"].as_array() {
            if range.len() != 2 {
                return Err("Wavelength range must contain two finite bounds".into());
            }
            let start = range[0]
                .as_f64()
                .filter(|value| value.is_finite())
                .ok_or("Invalid wavelength start")?;
            let end = range[1]
                .as_f64()
                .filter(|value| value.is_finite())
                .ok_or("Invalid wavelength end")?;
            let step = parameters
                .get("wavelength_step")
                .and_then(Value::as_f64)
                .unwrap_or(2.0);
            if end <= start || !step.is_finite() || step <= 0.0 {
                return Err("Invalid wavelength interval".into());
            }
            let count = ((end - start) / step).ceil() + 1.0;
            if count > 10000.0 {
                return Err("Synthetic wavelength count exceeds 10000".into());
            }
            features = grid_points(count).ok_or("Synthetic wavelength count exceeds 10000")?;
        }
    }
    for step in steps {
        if step.get("enabled").and_then(Value::as_bool) == Some(false) || step["type"] != "sources"
        {
            continue;
        }
        let sources = step["params"]["sources"]
            .as_array()
            .filter(|sources| sources.len() <= 8)
            .ok_or("At most eight bounded synthesis sources are supported")?;
        let mut total = 0_u64;
        for source in sources {
            let count = if let Some(range) = source["wavelength_range"].as_array() {
                if range.len() != 2 {
                    return Err("Invalid source wavelength range".into());
                }
                let start = range[0].as_f64().ok_or("Invalid source wavelength start")?;
                let end = range[1].as_f64().ok_or("Invalid source wavelength end")?;
                let count = (end - start) / 2.0 + 1.0;
                if !count.is_finite() || !(1.0..=10000.0).contains(&count) {
                    return Err("Unbounded source wavelength grid".into());
                }
                grid_points(count).ok_or("Unbounded source wavelength grid")?
            } else {
                source
                    .get("n_features")
                    .and_then(Value::as_u64)
                    .unwrap_or(features)
            };
            if count > 10000 {
                return Err("Unbounded source feature count".into());
            }
            total = total
                .checked_add(count)
                .ok_or("Source feature count overflow")?;
        }
        features = features.max(total);
    }

    Ok(features)
}

fn validate_synthesis(operation: &str, value: &Value) -> Result<(), String> {
    if matches!(operation, "components" | "status") {
        return Ok(());
    }
    let config = if operation == "validate" {
        value
    } else {
        &value["config"]
    };
    if !config.is_object() {
        return Err("Synthesis config must be an object".into());
    }
    if config
        .as_object()
        .unwrap()
        .keys()
        .any(|key| !["name", "n_samples", "random_state", "steps"].contains(&key.as_str()))
    {
        return Err("Unexpected synthesis configuration fields".into());
    }
    let samples = config
        .get("n_samples")
        .and_then(Value::as_u64)
        .unwrap_or(1000);
    if !(10..=100_000).contains(&samples) {
        return Err("Invalid synthesis sample count".into());
    }
    if config
        .get("steps")
        .is_some_and(|steps| steps.as_array().is_none_or(|steps| steps.len() > 32))
    {
        return Err("Invalid synthesis steps".into());
    }
    if operation == "preview"
        && value.get("preview_samples").is_some_and(|value| {
            value
                .as_u64()
                .is_none_or(|count| !(10..=500).contains(&count))
        })
    {
        return Err("Preview samples must be 10..500".into());
    }
    let features = match config["steps"].as_array() {
        Some(steps) => synthesis_features(steps)?,
        None => 751,
    };
    let count = if operation == "preview" {
        value
            .get("preview_samples")
            .and_then(Value::as_u64)
            .unwrap_or(100)
    } else {
        samples
    };
    let limit = if operation == "preview" {
        1_000_000
    } else {
        10_000_000
    };
    if count
        .checked_mul(features)
        .is_none_or(|cells| cells > limit)
    {
        return Err("Synthetic dataset exceeds the bounded cell budget; reduce samples or wavelength resolution".into());
    }
    Ok(())
}

fn export_target(
    workspace: &Path,
    custom: Option<&str>,
    name: &str,
) -> Result<(PathBuf, PathBuf), String> {
    let root = workspace
        .canonicalize()
        .map_err(|error| error.to_string())?;
    if let Some(custom) = custom {
        let target = Path::new(custom);
        if !target.is_absolute() {
            return Err("Custom export must be an absolute new directory path".into());
        }
        let parent = target
            .parent()
            .ok_or("Custom export has no parent directory")?
            .canonicalize()
            .map_err(|error| error.to_string())?;
        if !parent.is_dir() {
            return Err("Custom export parent is not a directory".into());
        }
        let leaf = target
            .file_name()
            .ok_or("Custom export requires a directory name")?;
        let final_path = parent.join(leaf);
        Ok((parent, final_path))
    } else {
        let mut directory = root.clone();
        for part in ["datasets", "synthetic"] {
            directory.push(part);
            if !directory.exists() {
                fs::create_dir(&directory).map_err(|error| error.to_string())?;
            }
            let meta = fs::symlink_metadata(&directory).map_err(|error| error.to_string())?;
            if !meta.is_dir()
                || meta.file_type().is_symlink()
                || !directory
                    .canonicalize()
                    .map_err(|error| error.to_string())?
                    .starts_with(&root)
            {
                return Err("Invalid synthesis directory".into());
            }
        }
        let final_path = directory.join(name);
        Ok((directory, final_path))
    }
}

fn generate(
    settings: &crate::settings::AppSettingsStore,
    workspace: &Path,
    payload: &Value,
    invoke: &impl Fn(&str, &Value) -> Result<Value, String>,
) -> Result<HttpResponse, String> {
    let custom = payload
        .get("export_to_csv")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty());
    let link = payload
        .get("export_to_workspace")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    if custom.is_some() && link {
        return Err("Choose either workspace or custom export".into());
    }
    let name = payload
        .get("dataset_name")
        .and_then(Value::as_str)
        .or_else(|| payload["config"]["name"].as_str())
        .unwrap_or("synthetic_nirs");
    if name.is_empty()
        || name.len() > 128
        || !name.bytes().enumerate().all(|(index, byte)| {
            byte.is_ascii_alphanumeric() || index > 0 && matches!(byte, b'_' | b'-' | b'.')
        })
    {
        return Err("Invalid synthetic dataset name".into());
    }
    if custom.is_none() && !link {
        let mut result = invoke("synthesis.generate", payload)?;
        result["success"] = json!(true);
        result["dataset_name"] = json!(name);
        result["dataset_id"] = Value::Null;
        result["linked_to_workspace"] = json!(false);
        return Ok(HttpResponse::json(200, result.to_string()));
    }
    let (directory, final_path) = export_target(workspace, custom, name)?;
    if final_path.exists() {
        return Err("Synthetic output directory already exists".into());
    }
    let stage = tempfile::tempdir_in(&directory).map_err(|error| error.to_string())?;
    let mut request = payload.clone();
    request["output_path"] = json!(stage.path().join(name));
    let mut result = invoke("synthesis.generate", &request)?;
    let staged = stage.path().join(name);
    if !staged.is_dir()
        || staged
            .symlink_metadata()
            .map_err(|error| error.to_string())?
            .file_type()
            .is_symlink()
    {
        return Err("Owner produced invalid synthesis output".into());
    }
    fs::rename(&staged, &final_path).map_err(|error| error.to_string())?;
    let mut record = json!({"path":final_path,"name":name,"config":{
        "train_x":final_path.join("Xcal.csv"),"train_y":final_path.join("Ycal.csv"),
        "test_x":final_path.join("Xval.csv"),"test_y":final_path.join("Yval.csv"),
        "global_params":{"delimiter":";","has_header":true,"header_unit":"nm"}}});
    // Use the same canonical confinement and equivalent ordinary Windows paths
    // as training/prediction. Verbatim `?` is otherwise read as a dataset glob.
    crate::scientific_request_resolver::ScientificRequestResolver::confine_dataset_config(
        &mut record["config"],
        &final_path,
    )
    .map_err(|error| format!("Invalid generated dataset references: {error:?}"))?;
    let mut configured = invoke("dataset.configure", &json!({"record":record}))?;
    crate::scientific_request_resolver::ScientificRequestResolver::confine_dataset_config(
        &mut configured,
        &final_path,
    )
    .map_err(|error| format!("Invalid configured generated dataset references: {error:?}"))?;
    let inspection = invoke(
        "dataset.preview",
        &json!({"config":configured,"max_samples":10}),
    )?;
    let linked = if link {
        Some(
            crate::workspace_documents::link_inspected_dataset(
                settings,
                record.to_string().as_bytes(),
                &inspection,
            )
            .map_err(|(_, detail)| detail)?,
        )
    } else {
        None
    };
    result["success"] = json!(true);
    result["dataset_name"] = json!(name);
    result["export_path"] = json!(final_path);
    result["dataset_id"] = linked
        .as_ref()
        .map_or(Value::Null, |value| value["dataset"]["id"].clone());
    result["linked_to_workspace"] = json!(linked.is_some());
    Ok(HttpResponse::json(200, result.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn generated_export_normalizes_verbatim_references_and_reconfines_owner_config() {
        let directory = tempfile::tempdir().unwrap();
        let settings = crate::settings::AppSettingsStore::new(directory.path().join("settings"));
        let target = directory.path().join("export");
        let seen_preview = std::cell::Cell::new(false);
        let outcome = generate(
            &settings,
            directory.path(),
            &json!({"config":{"name":"verified"},"export_to_csv":target}),
            &|operation, payload| match operation {
                "synthesis.generate" => {
                    let output = Path::new(payload["output_path"].as_str().unwrap());
                    fs::create_dir(output).unwrap();
                    for name in ["Xcal.csv", "Ycal.csv", "Xval.csv", "Yval.csv"] {
                        fs::write(output.join(name), "a;b\n1;2\n").unwrap();
                    }
                    Ok(json!({"n_samples":2}))
                }
                "dataset.configure" => {
                    let config = &payload["record"]["config"];
                    for key in ["train_x", "train_y", "test_x", "test_y"] {
                        let path = config[key].as_str().unwrap();
                        assert!(!path.starts_with(r"\\?\"));
                        assert_eq!(
                            Path::new(path).canonicalize().unwrap().parent().unwrap(),
                            target.canonicalize().unwrap()
                        );
                    }
                    #[cfg(windows)]
                    assert!(target
                        .canonicalize()
                        .unwrap()
                        .to_str()
                        .unwrap()
                        .starts_with(r"\\?\"));
                    Ok(config.clone())
                }
                "dataset.preview" => {
                    seen_preview.set(true);
                    Ok(json!({}))
                }
                _ => panic!("Unexpected operation {operation}"),
            },
        )
        .unwrap();
        assert_eq!(outcome.status, 200);
        assert!(seen_preview.get());
        assert!(target.join("Xcal.csv").is_file());
        let retry = generate(
            &settings,
            directory.path(),
            &json!({"config":{"name":"verified"},"export_to_csv":target}),
            &|_, _| panic!("An existing export must never be overwritten"),
        );
        assert!(retry.unwrap_err().contains("already exists"));
    }

    #[test]
    fn generated_export_refuses_owner_configuration_escape_before_preview() {
        let directory = tempfile::tempdir().unwrap();
        let settings = crate::settings::AppSettingsStore::new(directory.path().join("settings"));
        let outside = directory.path().join("outside.csv");
        fs::write(&outside, "a\n1\n").unwrap();
        let target = directory.path().join("export");
        let outcome = generate(
            &settings,
            directory.path(),
            &json!({"config":{"name":"verified"},"export_to_csv":target}),
            &|operation, payload| match operation {
                "synthesis.generate" => {
                    let output = Path::new(payload["output_path"].as_str().unwrap());
                    fs::create_dir(output).unwrap();
                    for name in ["Xcal.csv", "Ycal.csv", "Xval.csv", "Yval.csv"] {
                        fs::write(output.join(name), "a\n1\n").unwrap();
                    }
                    Ok(json!({}))
                }
                "dataset.configure" => Ok(json!({"train_x":outside})),
                "dataset.preview" => panic!("Escaped references must not reach the reader"),
                _ => panic!("Unexpected operation {operation}"),
            },
        );
        assert!(outcome
            .unwrap_err()
            .contains("Invalid configured generated dataset references"));
        assert!(target.join("Xcal.csv").is_file());
    }
    #[test]
    fn shap_catalogue_binds_only_authorized_run_identity_and_never_display_names() {
        let links = vec![crate::settings::DatasetLinkIdentity {
            id: "dataset-corn".into(),
            name: "corn".into(),
            path: "/corn".into(),
        }];
        let mapping = BTreeMap::from([
            ("linked".into(), "run-1".into()),
            ("old".into(), "run-2".into()),
            ("removed".into(), "run-3".into()),
            ("ambiguous".into(), "run-4".into()),
        ]);
        let records = vec![
            json!({"run_id":"run-1","datasets":[{"name":"raw","linked_dataset_id":"dataset-corn"}]}),
            json!({"run_id":"run-2","datasets":[{"name":"corn"}]}),
            json!({"run_id":"run-3","datasets":[{"name":"corn","linked_dataset_id":"dataset-removed"}]}),
            json!({"run_id":"run-4","datasets":[{"name":"raw","linked_dataset_id":"dataset-corn"},{"name":"raw","linked_dataset_id":"dataset-corn"}]}),
        ];
        let mut value = json!({"datasets":[{"chains":[{"chain_id":"linked","dataset_name":"raw"},{"chain_id":"old","dataset_name":"corn"},{"chain_id":"removed","dataset_name":"corn"},{"chain_id":"ambiguous","dataset_name":"raw"},{"chain_id":"unknown","dataset_name":"corn"}]}],"bundles":[{"bundle_path":"export.n4a","dataset_name":"corn"}]});
        bind_shap_dataset_links(&mut value, &links, &mapping, &records);
        assert_eq!(
            value["datasets"][0]["chains"][0]["linked_dataset_id"],
            "dataset-corn"
        );
        assert_eq!(
            value["datasets"][0]["chains"][0]["dataset_link_status"],
            "linked"
        );
        assert_eq!(value["datasets"][0]["chains"][0]["run_id"], "run-1");
        for index in 1..5 {
            assert!(value["datasets"][0]["chains"][index]["linked_dataset_id"].is_null());
            assert_eq!(
                value["datasets"][0]["chains"][index]["dataset_link_status"],
                "unresolved"
            );
        }
        assert_eq!(value["bundles"][0]["dataset_link_status"], "unresolved");
        let duplicate_links = [links[0].clone(), links[0].clone()];
        bind_shap_dataset_links(&mut value, &duplicate_links, &mapping, &records);
        assert_eq!(
            value["datasets"][0]["chains"][0]["dataset_link_status"],
            "unresolved"
        );
        assert!(!value.to_string().contains("/corn"));
    }
    #[test]
    fn rejects_encoded_traversal_and_unbounded_analysis() {
        for value in ["%2e%2e", "a%2fb", "a%5Cb", "C%3Afoo"] {
            assert!(identifier(value).is_err());
        }
        assert!(validate_shap(&json!({"n_samples":100_000})).is_err());
        assert!(validate_shap(&json!({"n_samples":12,"explainer_type":"kernel"})).is_ok());
        for field in [
            "dataset_name",
            "linked_dataset_id",
            "workspace_path",
            "config",
            "query",
        ] {
            let mut input = json!({"chain_id":"corn-pls","dataset_id":"dataset-corn"});
            input[field] = json!("corn");
            assert!(validate_shap(&input).is_err());
        }
    }
    #[test]
    fn projection_queries_are_bounded_and_view_specific() {
        let mut payload = json!({"view":"sample"});
        assert!(apply_view_query(&mut payload, Some("top_n=10")).is_ok());
        assert!(apply_view_query(&mut payload, Some("max_samples=10")).is_err());
        assert!(apply_view_query(&mut payload, Some("top_n=10&top_n=12")).is_err());
    }
    #[test]
    fn analysis_files_cannot_escape_by_symlink_or_identifier() {
        let root = tempfile::tempdir().unwrap();
        assert!(result_dir(root.path(), true)
            .unwrap()
            .starts_with(root.path().canonicalize().unwrap()));
        assert!(load_result(root.path(), "absent").is_err());
    }
    #[test]
    fn persisted_results_are_workspace_scoped_and_survive_reader_restart() {
        let first = tempfile::tempdir().unwrap();
        let second = tempfile::tempdir().unwrap();
        let directory = result_dir(first.path(), true).unwrap();
        fs::write(
            directory.join("run_native_1.native.json"),
            json!({"job_id":"run_native_1","n_samples":2}).to_string(),
        )
        .unwrap();
        assert_eq!(
            load_result(first.path(), "run_native_1").unwrap()["n_samples"],
            2
        );
        assert!(load_result(second.path(), "run_native_1").is_err());
    }
    #[test]
    fn synthesis_budgets_reject_pathological_feature_grids_before_host_call() {
        let mut value = json!({"config":{"n_samples":1000,"steps":[{"type":"features","params":{"wavelength_range":[1000,2500],"wavelength_step":0.000_001}}]},"preview_samples":100});
        assert!(validate_synthesis("preview", &value).is_err());
        value["config"]["steps"][0]["params"]["wavelength_step"] = json!(2);
        assert!(validate_synthesis("preview", &value).is_ok());
        value["config"]["steps"] = json!([{"type":"sources","params":{"sources":[{"type":"nir","wavelength_range":[1,1_000_000_000]}]}}]);
        assert!(validate_synthesis("preview", &value).is_err());
    }
    #[derive(Debug)]
    struct ProbeExecutor {
        cancelled: Arc<AtomicBool>,
    }
    impl ScientificJobExecutor for ProbeExecutor {
        fn is_selected(&self) -> bool {
            true
        }
        fn preflight_submission(
            &self,
            request: &ScientificSubmissionPreflight,
        ) -> Result<ScientificExecutorSelection, JobExecutorError> {
            Ok(ScientificExecutorSelection {
                execution_backend: "local-python".into(),
                execution_mode: Some("shap-analysis".into()),
                prepared_payload: request.payload.clone(),
            })
        }
        fn submit_scientific(
            &self,
            _request: &ScientificExecutionRequest,
            _terminal: Arc<dyn ScientificJobTerminal>,
        ) -> Result<(), JobExecutorError> {
            Ok(())
        }
        fn request_cooperative_cancel(&self, _id: &str) -> Result<(), JobExecutorError> {
            self.cancelled.store(true, Ordering::Release);
            Ok(())
        }
    }
    #[test]
    fn analysis_job_kind_and_cancellation_use_the_shared_durable_lifecycle() {
        use crate::job_lifecycle::{JobStatus, JobType};
        let root = tempfile::tempdir().unwrap();
        fs::create_dir(root.path().join("runs")).unwrap();
        let runtime = crate::job_http::NativeJobRuntime::default();
        let flag = Arc::new(AtomicBool::new(false));
        let receipt = runtime
            .submit_with_executor_kind_at(
                JobType::Analysis,
                "SHAP",
                "local-python",
                &json!({}),
                "qa-workspace",
                root.path(),
                "2026-10-09T00:00:00Z",
                Instant::now(),
                Arc::new(ProbeExecutor {
                    cancelled: flag.clone(),
                }),
            )
            .unwrap();
        assert_eq!(
            runtime
                .get_at(&receipt.job_id, Instant::now())
                .unwrap()
                .job_type,
            JobType::Analysis
        );
        assert_eq!(
            crate::execution_job_records::read_execution_job_record(root.path(), &receipt.job_id)
                .unwrap()["job_type"],
            "analysis"
        );
        runtime
            .request_cancel_at(&receipt.job_id, "2026-10-09T00:00:01Z", Instant::now())
            .unwrap();
        assert!(flag.load(Ordering::Acquire));
        runtime
            .acknowledge_cancel_at(&receipt.job_id, "2026-10-09T00:00:02Z", Instant::now())
            .unwrap();
        assert_eq!(
            runtime
                .get_at(&receipt.job_id, Instant::now())
                .unwrap()
                .status,
            JobStatus::Cancelled
        );
    }
}
