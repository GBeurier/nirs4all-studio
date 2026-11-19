//! Rust-owned HTTP orchestration for the attested Playground library facade.

use crate::{
    scientific_cpython::{CpythonScientificJobExecutor, LibraryFacadeError},
    scientific_request_resolver::ScientificRequestResolver,
    settings::AppSettingsStore,
    HttpRequest, HttpResponse, SidecarState,
};
use serde_json::{json, Map, Value};
use std::{
    path::Path,
    sync::{Arc, Mutex},
    time::{SystemTime, UNIX_EPOCH},
};

const REQUEST_SCHEMA: &str = "nirs4all.studio-playground-job.v1";
const RESPONSE_SCHEMA: &str = "nirs4all.studio-playground-result.v1";
/// The library's Playground admission bounds (samples, features, cells, input
/// bytes, response and covariance cells) are defaults its host may raise.
/// Studio raises them out of reach: only the memory of the worker and of the
/// host bounds a Playground workload, never a fixed count.
const LIBRARY_ADMISSION_BOUND: u64 = (1 << 53) - 1;

pub fn owns_path(path: &str) -> bool {
    matches!(
        path,
        "/api/playground/execute"
            | "/api/playground/execute-dataset"
            | "/api/playground/capabilities"
            | "/api/playground/validate"
            | "/api/playground/diff/compute"
            | "/api/playground/diff/repetition-variance"
    ) || path
        .strip_prefix("/api/playground/metadata-columns/")
        .is_some_and(|id| !id.is_empty() && !id.contains('/'))
}

pub fn route(state: &Arc<Mutex<SidecarState>>, request: &HttpRequest) -> Option<HttpResponse> {
    if !owns_path(&request.path) {
        return None;
    }
    let (settings, host) = {
        let state = state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        (state.app_settings.clone(), state.scientific_host.clone())
    };
    Some(dispatch(
        &settings,
        request,
        &|document| {
            host.as_ref().map_or_else(
                || {
                    Err(LibraryFacadeError {
                        code: "host_unavailable".into(),
                        message: "Attested Playground library host unavailable".into(),
                    })
                },
                |host| {
                    if document["operation"] != "execute"
                        || !cacheable_execution(&document["payload"])
                    {
                        return host.invoke_library_facade(document);
                    }
                    invoke_cached_execution(
                        host.dataset_cache_scope(),
                        document,
                        &|document| host.invoke_library_facade(document),
                        &|| {
                            if host.library_facades_available() {
                                Ok(())
                            } else {
                                Err(LibraryFacadeError {
                                    code: "host_unavailable".into(),
                                    message: "Attested Playground library host unavailable".into(),
                                })
                            }
                        },
                    )
                },
            )
        },
        &|operation, payload| adapt_dataset_document(host.as_deref(), operation, payload),
    ))
}

fn invoke_cached_execution(
    scope: u64,
    document: &Value,
    invoke: &impl Fn(&Value) -> Result<Value, LibraryFacadeError>,
    validate_hit: &impl Fn() -> Result<(), LibraryFacadeError>,
) -> Result<Value, LibraryFacadeError> {
    if !cacheable_execution(&document["payload"]) {
        return invoke(document);
    }
    let failure = std::cell::RefCell::new(None);
    let mut used = true;
    // Cache only validated result bodies, never request-specific envelopes.
    let mut result = crate::dataset_inspection::cache::invoke_with_validation(
        scope,
        "playground.execute",
        &document["payload"],
        || {
            used = false;
            let response = invoke(document).map_err(|error| {
                let message = error.message.clone();
                *failure.borrow_mut() = Some(error);
                message
            })?;
            project_response(
                response,
                document["request_id"].as_str().unwrap_or(""),
                "execute",
                Projection::Result,
            )
        },
        || {
            validate_hit().map_err(|error| {
                let message = error.message.clone();
                *failure.borrow_mut() = Some(error);
                message
            })
        },
    )
    .map_err(|message| {
        failure.into_inner().unwrap_or_else(|| LibraryFacadeError {
            code: "invalid_playground_response".into(),
            message,
        })
    })?;
    if result.is_object() {
        result["cache"] = json!({"used":used,"scope":"studio_session"});
    }
    Ok(
        json!({"schema":RESPONSE_SCHEMA,"operation":"execute", "request_id":document["request_id"], "result":result}),
    )
}

fn cacheable_execution(payload: &Value) -> bool {
    if payload["options"]["use_cache"] == false {
        return false;
    }
    // The SDK does not yet declare operator determinism. Be conservative:
    // reuse only known deterministic transformations and raw-data responses.
    // Unknown/custom operators, splitters and augmentations always execute.
    payload["steps"].as_array().is_some_and(|steps| {
        steps.iter().all(|step| {
            if step["enabled"] == false {
                return true;
            }
            if step["type"] == "filter" && step["name"] == "SampleIndexFilter" {
                return true;
            }
            step["type"] == "preprocessing"
                && matches!(
                    step["operator"]["class"].as_str(),
                    Some(
                        "nirs4all.operators.transforms.nirs.SavitzkyGolay"
                            | "nirs4all.operators.transforms.scalers.StandardNormalVariate"
                            | "nirs4all.operators.transforms.nirs.MultiplicativeScatterCorrection"
                            | "nirs4all.operators.transforms.signal.Detrend"
                            | "sklearn.preprocessing.StandardScaler"
                            | "sklearn.preprocessing._data.StandardScaler"
                            | "sklearn.preprocessing.MinMaxScaler"
                            | "sklearn.preprocessing._data.MinMaxScaler"
                            | "sklearn.preprocessing.RobustScaler"
                            | "sklearn.preprocessing._data.RobustScaler"
                            | "sklearn.preprocessing.MaxAbsScaler"
                            | "sklearn.preprocessing._data.MaxAbsScaler"
                            | "sklearn.preprocessing.Normalizer"
                            | "sklearn.preprocessing._data.Normalizer"
                            | "sklearn.preprocessing.PowerTransformer"
                            | "sklearn.preprocessing._data.PowerTransformer"
                    )
                )
        })
    }) && payload["options"]["compute_umap"] != true
        && payload["sampling"]["method"].as_str().is_none_or(|method| {
            method == "all"
                || (matches!(method, "random" | "stratified" | "kmeans")
                    && payload["sampling"]["seed"].is_u64())
        })
}

fn dispatch(
    settings: &AppSettingsStore,
    request: &HttpRequest,
    invoke: &impl Fn(&Value) -> Result<Value, LibraryFacadeError>,
    adapt: &impl Fn(&str, &Value) -> Result<Value, (u16, String)>,
) -> HttpResponse {
    let required_method = if request.path == "/api/playground/capabilities"
        || request
            .path
            .starts_with("/api/playground/metadata-columns/")
    {
        "GET"
    } else {
        "POST"
    };
    if request.method != required_method {
        return crate::method_not_allowed(&request.method, &request.path, required_method);
    }
    let prepared = match prepare(settings, request, adapt) {
        Ok(value) => value,
        Err((status, detail)) => return error(status, &detail),
    };
    let response = match invoke(&prepared.document) {
        Ok(value) => value,
        Err(failure) => return error(facade_error_status(&failure.code), &failure.message),
    };
    match project_response(
        response,
        &prepared.request_id,
        prepared.operation,
        prepared.projection,
    ) {
        Ok(mut value) => {
            if prepared.operation == "execute" && matches!(prepared.projection, Projection::Result)
            {
                project_complete_samples(&mut value, &prepared, invoke);
            }
            HttpResponse::json(200, value.to_string())
        }
        Err(detail) => error(500, &detail),
    }
}

const PROJECTIONS: [&str; 2] = ["pca", "umap"];

/// The library's own filter for the samples whose processed spectrum holds a
/// missing or infinite value. Its other criteria are switched off.
fn complete_samples_step() -> Value {
    json!({
        "id":"studio-complete-samples", "type":"filter", "name":"SpectralQualityFilter",
        "params":{"filter_mode":"remove"}, "enabled":true,
        "operator":{"class":"nirs4all.operators.filters.SpectralQualityFilter",
            "params":{"max_nan_ratio":0,"max_zero_ratio":1,"min_variance":0,"check_inf":true}},
    })
}

/// The same request, followed by the filter of incomplete spectra, asking
/// only for the projections.
fn complete_samples_document(document: &Value) -> Value {
    let mut document = document.clone();
    let payload = &mut document["payload"];
    if !payload["steps"].is_array() {
        payload["steps"] = json!([]);
    }
    payload["steps"]
        .as_array_mut()
        .unwrap()
        .push(complete_samples_step());
    if !payload["options"].is_object() {
        payload["options"] = json!({});
    }
    for (option, value) in [
        ("compute_statistics", json!(false)),
        ("compute_metrics", json!(false)),
        ("compute_repetitions", json!(false)),
        ("max_wavelengths_returned", json!(8)),
    ] {
        payload["options"][option] = value;
    }
    document
}

/// A projection needs complete spectra. When the library could not project
/// the processed matrix, ask it for the projection of the complete samples
/// only: the same steps, then its filter of incomplete spectra. Nothing else
/// of the answer changes; the samples left out keep their row, with an empty
/// coordinate list, and the projection states how many they are.
fn project_complete_samples(
    result: &mut Value,
    prepared: &Prepared,
    invoke: &impl Fn(&Value) -> Result<Value, LibraryFacadeError>,
) {
    let failed = PROJECTIONS
        .into_iter()
        .filter(|field| result[*field]["error"].is_string())
        .collect::<Vec<_>>();
    let Some(rows) = result["processed"]["sample_ids"]
        .as_array()
        .filter(|_| !failed.is_empty())
        .cloned()
    else {
        return;
    };
    let document = complete_samples_document(&prepared.document);
    let Ok(complete) = invoke(&document).and_then(|response| {
        project_response(
            response,
            &prepared.request_id,
            "execute",
            Projection::Result,
        )
        .map_err(|message| LibraryFacadeError {
            code: "invalid_playground_response".into(),
            message,
        })
    }) else {
        return;
    };
    let Some(kept) = complete["processed"]["sample_ids"].as_array() else {
        return;
    };
    // Rows are matched by sample identity, never by position.
    let key = |id: &Value| id.to_string();
    let positions = kept
        .iter()
        .enumerate()
        .map(|(position, id)| (key(id), position))
        .collect::<std::collections::BTreeMap<_, _>>();
    let unique = rows
        .iter()
        .map(key)
        .collect::<std::collections::BTreeSet<_>>();
    if kept.len() >= rows.len()
        || positions.len() != kept.len()
        || unique.len() != rows.len()
        || !positions.keys().all(|id| unique.contains(id))
    {
        return;
    }
    let left_out = rows
        .iter()
        .enumerate()
        .filter(|(_, id)| !positions.contains_key(&key(id)))
        .map(|(index, _)| index)
        .collect::<Vec<_>>();
    for field in failed {
        let mut projection = complete[field].clone();
        if projection["coordinates"]
            .as_array()
            .is_none_or(|coordinates| coordinates.len() != kept.len())
        {
            continue;
        }
        // The other per-sample arrays of a projection only repeat the
        // processed rows' own values: keep the complete ones of that section.
        let coordinates = projection["coordinates"].as_array().cloned().unwrap();
        projection["coordinates"] = rows
            .iter()
            .map(|id| {
                positions
                    .get(&key(id))
                    .map_or_else(|| json!([]), |position| coordinates[*position].clone())
            })
            .collect();
        let object = projection.as_object_mut().unwrap();
        object.remove("fold_labels");
        object.remove("y");
        if result["processed"]["y"]
            .as_array()
            .is_some_and(|y| y.len() == rows.len())
        {
            projection["y"] = result["processed"]["y"].clone();
        }
        projection["left_out"] =
            json!({"reason":"missing_values","count":left_out.len(),"sample_indices":left_out});
        result[field] = projection;
    }
}

#[derive(Clone, Copy)]
enum Projection {
    Result,
    Capabilities,
}

struct Prepared {
    document: Value,
    request_id: String,
    operation: &'static str,
    projection: Projection,
}

fn prepare(
    settings: &AppSettingsStore,
    request: &HttpRequest,
    adapt: &impl Fn(&str, &Value) -> Result<Value, (u16, String)>,
) -> Result<Prepared, (u16, String)> {
    if request.query.is_some() {
        return Err((400, "Playground route does not accept query fields".into()));
    }
    let request_id = request_id()?;
    let (operation, payload, projection) = match request.path.as_str() {
        "/api/playground/capabilities" => ("capabilities", json!({}), Projection::Capabilities),
        "/api/playground/execute" => (
            "execute",
            prepare_inline_execute(parse_object(&request.body)?)?,
            Projection::Result,
        ),
        "/api/playground/execute-dataset" => (
            "execute",
            prepare_dataset_execute(settings, parse_object(&request.body)?, adapt)?,
            Projection::Result,
        ),
        "/api/playground/validate" => (
            "validate",
            json!({"steps":serde_json::from_slice::<Value>(&request.body).map_err(|_| (400, "Expected a JSON step array".into()))?}),
            Projection::Result,
        ),
        "/api/playground/diff/compute" => {
            let mut body = parse_object(&request.body)?;
            let reference = body
                .remove("X_ref")
                .ok_or_else(|| (400, "Missing X_ref".into()))?;
            let final_value = body
                .remove("X_final")
                .ok_or_else(|| (400, "Missing X_final".into()))?;
            let mut payload = json!({"reference":reference,"final":final_value});
            copy_optional(&body, &mut payload, &["metric", "scale"]);
            ("diff", payload, Projection::Result)
        }
        "/api/playground/diff/repetition-variance" => {
            let mut body = parse_object(&request.body)?;
            let x = body.remove("X").ok_or_else(|| (400, "Missing X".into()))?;
            let groups = body
                .remove("group_ids")
                .ok_or_else(|| (400, "Missing group_ids".into()))?;
            let mut payload = json!({"x":x,"group_ids":groups});
            copy_optional(&body, &mut payload, &["reference", "metric"]);
            ("repetition_variance", payload, Projection::Result)
        }
        path if path.starts_with("/api/playground/metadata-columns/") => {
            let id = path.trim_start_matches("/api/playground/metadata-columns/");
            let dataset = confined_dataset(settings, id, adapt)?;
            (
                "metadata_columns",
                json!({"dataset":{"config":dataset},"partition":"train","max_unique_values":200}),
                Projection::Result,
            )
        }
        _ => return Err((404, "Unknown Playground route".into())),
    };
    let mut payload = payload;
    raise_library_admission(operation, &mut payload);
    Ok(Prepared {
        document: json!({
            "schema":REQUEST_SCHEMA,
            "operation":operation,
            "request_id":request_id,
            "payload":payload,
        }),
        request_id,
        operation,
        projection,
    })
}

fn raise_library_admission(operation: &str, payload: &mut Value) {
    let Some(payload) = payload.as_object_mut() else {
        return;
    };
    if let Some(dataset) = payload.get_mut("dataset").and_then(Value::as_object_mut) {
        dataset
            .entry("max_input_bytes")
            .or_insert(json!(LIBRARY_ADMISSION_BOUND));
    }
    if operation != "execute" {
        return;
    }
    let limits = payload.entry("limits").or_insert_with(|| json!({}));
    if let Some(limits) = limits.as_object_mut() {
        for key in ["max_samples", "max_features", "max_cells"] {
            limits.entry(key).or_insert(json!(LIBRARY_ADMISSION_BOUND));
        }
    }
    let options = payload.entry("options").or_insert_with(|| json!({}));
    if let Some(options) = options.as_object_mut() {
        for key in ["max_response_cells", "max_covariance_cells"] {
            options.entry(key).or_insert(json!(LIBRARY_ADMISSION_BOUND));
        }
    }
}

fn prepare_inline_execute(mut body: Map<String, Value>) -> Result<Value, (u16, String)> {
    let data = body
        .remove("data")
        .filter(Value::is_object)
        .ok_or_else(|| (400, "Inline execution requires a JSON data object".into()))?;
    let steps = body.remove("steps").unwrap_or_else(|| json!([]));
    let mut payload = json!({"data":data,"steps":steps});
    for key in ["sampling", "options", "limits"] {
        if let Some(value) = body.remove(key) {
            payload[key] = value;
        }
    }
    if let Some(field) = body.keys().next() {
        return Err((400, format!("Unexpected inline execution field: {field}")));
    }
    Ok(payload)
}

fn prepare_dataset_execute(
    settings: &AppSettingsStore,
    mut body: Map<String, Value>,
    adapt: &impl Fn(&str, &Value) -> Result<Value, (u16, String)>,
) -> Result<Value, (u16, String)> {
    let dataset_id = body
        .remove("dataset_id")
        .and_then(|value| value.as_str().map(str::to_owned))
        .ok_or_else(|| (400, "Missing dataset_id".into()))?;
    let config = confined_dataset(settings, &dataset_id, adapt)?;
    let partition = body.remove("partition").unwrap_or_else(|| json!("all"));
    let source_index = body
        .remove("source_index")
        .or_else(|| body.remove("source"))
        .unwrap_or_else(|| json!(0));
    let target_index = body.remove("target_index").unwrap_or_else(|| json!(0));
    let steps = body.remove("steps").unwrap_or_else(|| json!([]));
    let mut payload = json!({
        "dataset":{"config":config},
        "selection":{"partition":partition,"source_index":source_index,"target_index":target_index},
        "steps":steps,
    });
    copy_optional(&body, &mut payload, &["sampling", "options"]);
    if body
        .keys()
        .any(|key| !matches!(key.as_str(), "sampling" | "options"))
    {
        return Err((400, "Unexpected dataset execution field".into()));
    }
    Ok(payload)
}

pub fn confined_dataset(
    settings: &AppSettingsStore,
    id: &str,
    adapt: &impl Fn(&str, &Value) -> Result<Value, (u16, String)>,
) -> Result<Value, (u16, String)> {
    let record =
        crate::workspace_documents::linked_dataset(settings, id).map_err(|detail| (404, detail))?;
    let root = record
        .get("path")
        .and_then(Value::as_str)
        .and_then(|value| Path::new(value).canonicalize().ok())
        .filter(|path| path.is_dir())
        .ok_or_else(|| (400, "Linked dataset directory is unavailable".into()))?;
    translated_dataset_config(record, &root, adapt)
}

pub fn adapt_dataset_document(
    host: Option<&CpythonScientificJobExecutor>,
    operation: &str,
    payload: &Value,
) -> Result<Value, (u16, String)> {
    let host = host
        .filter(|host| host.library_facades_available())
        .ok_or_else(|| (503, "Attested dataset document adapter unavailable".into()))?;
    crate::dataset_inspection::cache::adapt(
        host.dataset_cache_scope(),
        operation,
        payload,
        || host.adapt_document(operation, payload),
        || {
            if host.library_facades_available() {
                Ok(())
            } else {
                Err("Attested dataset document adapter unavailable".into())
            }
        },
    )
    .map_err(|_| (400, "Linked dataset config translation failed".into()))
}

fn translated_dataset_config(
    mut record: Value,
    root: &Path,
    adapt: &impl Fn(&str, &Value) -> Result<Value, (u16, String)>,
) -> Result<Value, (u16, String)> {
    ScientificRequestResolver::confine_dataset_config(&mut record, root)
        .map_err(|_| (400, "Linked dataset config escaped its directory".into()))?;
    let mut config = adapt("dataset.configure", &json!({"record": record}))?;
    if !config.is_object() {
        return Err((400, "Dataset adapter returned no explicit config".into()));
    }
    ScientificRequestResolver::confine_dataset_config(&mut config, root).map_err(|_| {
        (
            400,
            "Translated dataset config escaped its directory".into(),
        )
    })?;
    Ok(config)
}

fn parse_object(body: &[u8]) -> Result<Map<String, Value>, (u16, String)> {
    let Ok(Value::Object(value)) = serde_json::from_slice::<Value>(body) else {
        return Err((400, "Expected a JSON object".into()));
    };
    Ok(value)
}

fn copy_optional(source: &Map<String, Value>, target: &mut Value, keys: &[&str]) {
    for key in keys {
        if let Some(value) = source.get(*key) {
            target[*key] = value.clone();
        }
    }
}

/// Takes the response by value: a Playground result carries complete spectra,
/// and is moved into the HTTP body rather than copied.
fn project_response(
    response: Value,
    request_id: &str,
    operation: &str,
    projection: Projection,
) -> Result<Value, String> {
    let Value::Object(mut root) = response else {
        return Err("Playground library returned a non-object".into());
    };
    if root.get("schema") != Some(&json!(RESPONSE_SCHEMA))
        || root.get("request_id") != Some(&json!(request_id))
        || root.get("operation") != Some(&json!(operation))
        || !root.contains_key("result")
        || root.keys().any(|key| {
            !matches!(
                key.as_str(),
                "schema" | "request_id" | "operation" | "result" | "wire_diagnostics"
            )
        })
    {
        return Err("Playground library returned the wrong response identity".into());
    }
    let result = root.remove("result").unwrap_or_default();
    if matches!(projection, Projection::Capabilities) {
        return Ok(json!({
            "umap_available":false,
            "nirs4all_available":true,
            "features":{"pca":true,"umap":false,"filters":true,"preprocessing":true,"splitting":true,"augmentation":true},
            "stateless":result["stateless"],
            "cache":true,
        }));
    }
    Ok(result)
}

fn request_id() -> Result<String, (u16, String)> {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|cause| (500, cause.to_string()))?
        .as_nanos();
    Ok(format!("playground-{}-{nonce}", std::process::id()))
}

fn facade_error_status(code: &str) -> u16 {
    match code {
        "invalid_playground_response" => 500,
        "host_unavailable" | "runtime_contract_tampered" | "python_host_spawn_failed" => 503,
        "request_too_large" | "response_too_large" | "resource_limit" => 413,
        _ => 400,
    }
}

fn error(status: u16, detail: &str) -> HttpResponse {
    HttpResponse::json(status, json!({"detail":detail}).to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;

    #[test]
    fn cached_execution_preserves_values_and_uses_current_request_identity() {
        let root = tempfile::tempdir().unwrap();
        let x = root.path().join("X.csv");
        let y = root.path().join("Y.csv");
        std::fs::write(&x, "1;2\n3;4\n").unwrap();
        std::fs::write(&y, "5\n6\n").unwrap();
        let mut document = json!({"schema":REQUEST_SCHEMA,"operation":"execute","request_id":"first",
            "payload":{"dataset":{"config":{"train_x":x,"train_y":y}},"steps":[],
            "selection":{"partition":"all","source_index":0,"target_index":0},"options":{"use_cache":true}}});
        let calls = Cell::new(0);
        let invoke = |request: &Value| {
            calls.set(calls.get() + 1);
            Ok(
                json!({"schema":RESPONSE_SCHEMA,"operation":"execute","request_id":request["request_id"],
                "result":{"success":true,"original":{"spectra":[[1,2],[3,4]],"y":[5,6],
                    "sample_ids":["a","b"],"metadata":{"batch":["B","A"]}},
                    "source_partitions":{"has_test":true,"n_train":1,"n_test":1}}}),
            )
        };
        let first = invoke_cached_execution(800, &document, &invoke, &|| Ok(())).unwrap();
        document["request_id"] = json!("second");
        let second = invoke_cached_execution(800, &document, &invoke, &|| Ok(())).unwrap();
        assert_eq!(calls.get(), 1);
        assert_eq!(second["request_id"], "second");
        assert_eq!(first["result"]["original"], second["result"]["original"]);
        assert_eq!(
            first["result"]["source_partitions"],
            second["result"]["source_partitions"]
        );
        assert_eq!(first["result"]["cache"]["used"], false);
        assert_eq!(second["result"]["cache"]["used"], true);
        std::fs::write(&y, "7\n8\n").unwrap();
        invoke_cached_execution(800, &document, &invoke, &|| Ok(())).unwrap();
        assert_eq!(calls.get(), 2);
        document["payload"]["options"]["use_cache"] = json!(false);
        invoke_cached_execution(800, &document, &invoke, &|| Ok(())).unwrap();
        invoke_cached_execution(800, &document, &invoke, &|| Ok(())).unwrap();
        assert_eq!(
            calls.get(),
            4,
            "use_cache=false must bypass the session cache"
        );
    }

    #[test]
    fn cache_refuses_random_unknown_operators_and_keys_complete_inline_inputs() {
        let mut document = json!({"schema":REQUEST_SCHEMA,"operation":"execute","request_id":"inline",
            "payload":{"data":{"x":[[1,2],[3,4],[5,6]],"y":[7,8,9],"metadata":{"group":["A","B","C"]}},
                "steps":[],"options":{"use_cache":true}}});
        let calls = Cell::new(0);
        let invoke = |request: &Value| {
            calls.set(calls.get() + 1);
            Ok(
                json!({"schema":RESPONSE_SCHEMA,"operation":"execute","request_id":request["request_id"],"result":{"success":true}}),
            )
        };
        invoke_cached_execution(801, &document, &invoke, &|| Ok(())).unwrap();
        document["payload"]["data"]["x"][1][0] = json!(100);
        invoke_cached_execution(801, &document, &invoke, &|| Ok(())).unwrap();
        document["payload"]["data"]["metadata"]["group"][1] = json!("D");
        invoke_cached_execution(801, &document, &invoke, &|| Ok(())).unwrap();
        assert_eq!(calls.get(), 3);
        for step in [
            json!({"type":"augmentation","name":"GaussianAdditiveNoise","operator":{"class":"nirs4all.operators.augmentation.GaussianAdditiveNoise"}}),
            json!({"type":"preprocessing","name":"SavitzkyGolay","operator":{"class":"custom.SavitzkyGolay"}}),
            json!({"type":"splitting","name":"ShuffleSplit","operator":{"class":"sklearn.model_selection.ShuffleSplit"}}),
        ] {
            document["payload"]["steps"] = json!([step]);
            assert!(!cacheable_execution(&document["payload"]));
            invoke_cached_execution(801, &document, &invoke, &|| Ok(())).unwrap();
            invoke_cached_execution(801, &document, &invoke, &|| Ok(())).unwrap();
        }
        assert_eq!(calls.get(), 9);
        document["payload"]["steps"] = json!([{"type":"preprocessing","operator":{"class":"nirs4all.operators.transforms.nirs.SavitzkyGolay"}}]);
        assert!(cacheable_execution(&document["payload"]));
        document["payload"]["options"]["compute_umap"] = json!(true);
        assert!(!cacheable_execution(&document["payload"]));
    }

    #[test]
    fn cache_retains_facade_errors_and_rejects_mismatched_identity() {
        let document = json!({"schema":REQUEST_SCHEMA,"operation":"execute","request_id":"expected",
            "payload":{"data":{"x":[[1]]},"steps":[]}});
        let failure = invoke_cached_execution(
            802,
            &document,
            &|_| {
                Err(LibraryFacadeError {
                    code: "host_unavailable".into(),
                    message: "Host stopped".into(),
                })
            },
            &|| Ok(()),
        )
        .unwrap_err();
        assert_eq!(failure.code, "host_unavailable");
        assert!(invoke_cached_execution(802, &document, &|_| Ok(json!({
            "schema":RESPONSE_SCHEMA,"operation":"execute","request_id":"other","result":{"success":true}
        })), &|| Ok(())).is_err());
    }
    use std::{
        collections::BTreeMap,
        sync::atomic::{AtomicUsize, Ordering},
    };

    fn request(path: &str, method: &str, body: &Value) -> HttpRequest {
        HttpRequest {
            method: method.into(),
            path: path.into(),
            query: None,
            headers: BTreeMap::new(),
            body: body.to_string().into_bytes(),
        }
    }

    #[test]
    fn inline_execution_wraps_exact_owner_contract_and_projects_result() {
        let root = tempfile::tempdir().unwrap();
        let settings = AppSettingsStore::new(root.path().join("settings"));
        let response = dispatch(
            &settings,
            &request(
                "/api/playground/execute",
                "POST",
                &json!({
                    "data":{"x":[[1.0,2.0]]},
                    "steps":[],
                    "sampling":{"n_samples":1},
                    "options":{"compute_pca":false},
                    "limits":{"max_samples":1}
                }),
            ),
            &|document| {
                assert_eq!(document["schema"], REQUEST_SCHEMA);
                assert_eq!(document["operation"], "execute");
                assert_eq!(document["payload"]["data"]["x"][0][1], 2.0);
                assert_eq!(document["payload"]["sampling"]["n_samples"], 1);
                assert_eq!(document["payload"]["options"]["compute_pca"], false);
                assert_eq!(document["payload"]["limits"]["max_samples"], 1);
                Ok(json!({
                    "schema":RESPONSE_SCHEMA,"request_id":document["request_id"],
                    "operation":"execute","result":{"success":true}
                }))
            },
            &|_, _| unreachable!("inline requests must not translate datasets"),
        );
        assert_eq!(response.status, 200, "{}", response.body);
        assert_eq!(
            serde_json::from_str::<Value>(&response.body).unwrap()["success"],
            true
        );
    }

    #[test]
    fn a_projection_refused_for_missing_values_is_computed_on_the_complete_samples() {
        let root = tempfile::tempdir().unwrap();
        let settings = AppSettingsStore::new(root.path().join("settings"));
        let calls = Cell::new(0);
        let run = |second: Value| {
            calls.set(0);
            let response = dispatch(
                &settings,
                &request(
                    "/api/playground/execute",
                    "POST",
                    &json!({"data":{"x":[[1.0,2.0],[1.0,null],[3.0,4.0]]},"steps":[],"options":{"compute_pca":true}}),
                ),
                &|document| {
                    calls.set(calls.get() + 1);
                    let steps = document["payload"]["steps"].as_array().unwrap();
                    let result = if steps.is_empty() {
                        // The library keeps every row and reports why it cannot project them.
                        json!({"success":true,"processed":{"sample_ids":["a","b","c"],"y":[1.0,null,3.0]},
                            "pca":{"error":"Input X contains NaN."},"umap":null})
                    } else {
                        assert_eq!(steps.len(), 1);
                        assert_eq!(
                            steps[0]["operator"]["class"],
                            "nirs4all.operators.filters.SpectralQualityFilter"
                        );
                        assert_eq!(steps[0]["operator"]["params"]["max_nan_ratio"], 0);
                        assert_eq!(document["payload"]["options"]["compute_pca"], true);
                        assert_eq!(document["payload"]["options"]["compute_statistics"], false);
                        second.clone()
                    };
                    Ok(
                        json!({"schema":RESPONSE_SCHEMA,"request_id":document["request_id"],"operation":"execute","result":result}),
                    )
                },
                &|_, _| unreachable!("inline requests must not translate datasets"),
            );
            assert_eq!(response.status, 200, "{}", response.body);
            serde_json::from_str::<Value>(&response.body).unwrap()
        };
        // Complete samples are returned out of order on purpose: rows are matched by identity.
        let result = run(json!({"success":true,"processed":{"sample_ids":["c","a"]},
            "pca":{"coordinates":[[3.0,4.0],[1.0,2.0]],"explained_variance_ratio":[1.0,0.0],"y":[3.0,1.0],"fold_labels":[0,1]}}));
        assert_eq!(calls.get(), 2);
        assert_eq!(
            result["pca"]["coordinates"],
            json!([[1.0, 2.0], [], [3.0, 4.0]])
        );
        assert_eq!(
            result["pca"]["left_out"],
            json!({"reason":"missing_values","count":1,"sample_indices":[1]})
        );
        assert_eq!(result["pca"]["y"], json!([1.0, null, 3.0]));
        assert!(result["pca"].get("fold_labels").is_none());
        assert_eq!(result["pca"]["explained_variance_ratio"], json!([1.0, 0.0]));
        // The rest of the first answer is untouched: no sample left the dataset.
        assert_eq!(result["processed"]["sample_ids"], json!(["a", "b", "c"]));
        // Nothing was left out: missing values were not the reason, the library's error stays.
        for unchanged in [
            json!({"success":true,"processed":{"sample_ids":["a","b","c"]},"pca":{"coordinates":[[1.0],[2.0],[3.0]]}}),
            json!({"success":true,"processed":{"sample_ids":["a","z"]},"pca":{"coordinates":[[1.0],[2.0]]}}),
            json!({"success":true,"processed":{"sample_ids":["a","c"]},"pca":{"error":"still failing"}}),
        ] {
            assert_eq!(
                run(unchanged)["pca"],
                json!({"error":"Input X contains NaN."})
            );
        }
    }

    #[test]
    fn inline_execution_rejects_dataset_selection_paths_and_unknown_fields_before_host() {
        let root = tempfile::tempdir().unwrap();
        let settings = AppSettingsStore::new(root.path().join("settings"));
        for body in [
            json!({"dataset":{"config":{"path":"/tmp/escaped.csv"}},"steps":[]}),
            json!({"data":{"x":[[1.0]]},"selection":{"partition":"all"}}),
            json!({"data":{"x":[[1.0]]},"config":{"path":"/tmp/escaped.csv"}}),
            json!({"data":{"x":[[1.0]]},"path":"/tmp/escaped.csv"}),
            json!({"data":{"x":[[1.0]]},"unknown":true}),
            json!({"steps":[]}),
        ] {
            let invocations = AtomicUsize::new(0);
            let response = dispatch(
                &settings,
                &request("/api/playground/execute", "POST", &body),
                &|_| {
                    invocations.fetch_add(1, Ordering::SeqCst);
                    unreachable!("invalid inline requests must not acquire the library host")
                },
                &|_, _| unreachable!("inline requests must not translate datasets"),
            );
            assert_eq!(response.status, 400, "{}", response.body);
            assert_eq!(invocations.load(Ordering::SeqCst), 0, "{body}");
        }
    }

    #[test]
    fn valid_inline_execution_without_a_selected_host_is_explicitly_unavailable() {
        let root = tempfile::tempdir().unwrap();
        let settings = AppSettingsStore::new(root.path().join("settings"));
        let invocations = AtomicUsize::new(0);
        let response = dispatch(
            &settings,
            &request(
                "/api/playground/execute",
                "POST",
                &json!({"data":{"x":[[1.0]]},"steps":[]}),
            ),
            &|_| {
                invocations.fetch_add(1, Ordering::SeqCst);
                Err(LibraryFacadeError {
                    code: "host_unavailable".into(),
                    message: "Attested Playground library host unavailable".into(),
                })
            },
            &|_, _| unreachable!("inline requests must not translate datasets"),
        );
        assert_eq!(response.status, 503, "{}", response.body);
        assert_eq!(invocations.load(Ordering::SeqCst), 1);
        assert!(response.body.contains("host unavailable"));
    }

    #[test]
    fn facade_errors_remain_visible_and_never_become_empty_successes() {
        let root = tempfile::tempdir().unwrap();
        let settings = AppSettingsStore::new(root.path().join("settings"));
        let response = dispatch(
            &settings,
            &request("/api/playground/validate", "POST", &json!([])),
            &|_| {
                Err(LibraryFacadeError {
                    code: "missing_operator".into(),
                    message: "canonical declaration required".into(),
                })
            },
            &|_, _| unreachable!("inline requests must not translate datasets"),
        );
        assert_eq!(response.status, 400);
        assert!(response.body.contains("canonical declaration required"));
    }

    #[test]
    fn wrong_response_operation_is_rejected() {
        let root = tempfile::tempdir().unwrap();
        let settings = AppSettingsStore::new(root.path().join("settings"));
        let response = dispatch(
            &settings,
            &request("/api/playground/validate", "POST", &json!([])),
            &|document| {
                Ok(json!({
                    "schema": RESPONSE_SCHEMA,
                    "request_id": document["request_id"],
                    "operation": "execute",
                    "result": {"valid": true, "steps": []},
                }))
            },
            &|_, _| unreachable!("inline requests must not translate datasets"),
        );
        assert_eq!(response.status, 500);
        assert!(response.body.contains("wrong response identity"));
    }
    #[test]
    fn linked_wizard_configuration_uses_attested_adapter_and_rechecks_paths() {
        let root = tempfile::tempdir().unwrap();
        let file = root.path().join("Xtrain.csv");
        std::fs::write(&file, "1000;1100\n1;2\n3;4\n").unwrap();
        let record = json!({"path":root.path(),"config":{"files":[{"path":file,"type":"X","split":"train"}],"aggregation":{"enabled":false,"method":"mean"}}});
        let result =
            translated_dataset_config(record.clone(), root.path(), &|operation, payload| {
                assert_eq!(operation, "dataset.configure");
                assert_eq!(payload["record"]["config"]["aggregation"]["enabled"], false);
                Ok(json!({"train_x":payload["record"]["config"]["files"][0]["path"]}))
            })
            .unwrap();
        assert_eq!(
            Path::new(result["train_x"].as_str().unwrap())
                .canonicalize()
                .unwrap(),
            file.canonicalize().unwrap()
        );
        assert_eq!(
            translated_dataset_config(record.clone(), root.path(), &|_, _| Err((
                503,
                "unavailable".into()
            )))
            .unwrap_err()
            .0,
            503
        );
        assert!(
            translated_dataset_config(record.clone(), root.path(), &|_, _| Ok(json!([]))).is_err()
        );
        let outside = tempfile::NamedTempFile::new().unwrap();
        assert!(translated_dataset_config(record, root.path(), &|_, _| Ok(
            json!({"train_x":outside.path()})
        ))
        .is_err());
        let unsafe_record = json!({"config":{"train_x":outside.path()}});
        assert!(
            translated_dataset_config(unsafe_record, root.path(), &|_, _| panic!(
                "escape must fail before adapter"
            ))
            .is_err()
        );
    }
    #[test]
    fn linked_dataset_routes_keep_host_unavailability_as_http_503() {
        let root = tempfile::tempdir().unwrap();
        let settings = root.path().join("settings");
        let workspace = root.path().join("workspace");
        let dataset = root.path().join("dataset");
        std::fs::create_dir(&dataset).unwrap();
        std::fs::write(dataset.join("Xtrain.csv"), "1000;1100\n1;2\n3;4\n").unwrap();
        let state = Arc::new(Mutex::new(SidecarState::with_app_settings_dir(&settings)));
        let app_settings = state.lock().unwrap().app_settings.clone();
        let document = |path: &str, body: Value| {
            let response = crate::workspace_documents::route(
                &app_settings,
                "POST",
                path,
                body.to_string().as_bytes(),
            )
            .unwrap();
            assert_eq!(response.status, 200, "{}", response.body);
            serde_json::from_str::<Value>(&response.body).unwrap()
        };
        document(
            "/api/workspace/create",
            json!({"path":workspace,"name":"Playground witness"}),
        );
        document("/api/workspace/select", json!({"path":workspace}));
        let linked = document(
            "/api/datasets/link",
            json!({"path":dataset,"config":{"files":[{"path":"Xtrain.csv","type":"X","split":"train"}],"aggregation":{"enabled":false,"method":"mean"}}}),
        );
        let id = linked["dataset"]["id"].as_str().unwrap();
        let unavailable = CpythonScientificJobExecutor::acquire(
            root.path().join("missing-python"),
            root.path().join("missing-packages"),
            root.path().join("missing-adapters"),
            &settings,
        );
        assert!(!unavailable.library_facades_available());
        assert_eq!(
            adapt_dataset_document(Some(&unavailable), "dataset.configure", &json!({}))
                .unwrap_err()
                .0,
            503
        );
        let response = route(
            &state,
            &request(
                "/api/playground/execute-dataset",
                "POST",
                &json!({"dataset_id":id}),
            ),
        )
        .unwrap();
        assert_eq!(response.status, 503, "{}", response.body);
        // The chart-only routes are gone: the execute response carries every chart.
        for path in ["/api/playground/pca", "/api/playground/repetitions"] {
            assert!(route(&state, &request(path, "POST", &json!({"dataset_id":id}))).is_none());
        }
        let response = route(
            &state,
            &request(
                &format!("/api/playground/metadata-columns/{id}"),
                "GET",
                &json!({}),
            ),
        )
        .unwrap();
        assert_eq!(response.status, 503, "{}", response.body);
        for path in [
            format!("/api/spectra/{id}"),
            format!("/api/spectra/{id}/stats"),
        ] {
            let response =
                crate::playground_views::route(&state, &request(&path, "GET", &json!({}))).unwrap();
            assert_eq!(response.status, 503, "{path}: {}", response.body);
        }
    }
}
