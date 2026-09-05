//! Rust-owned HTTP orchestration for the attested Playground library facade.

use crate::{
    scientific_cpython::LibraryFacadeError, scientific_request_resolver::ScientificRequestResolver,
    settings::AppSettingsStore, HttpRequest, HttpResponse, SidecarState,
};
use serde_json::{json, Map, Value};
use std::{
    path::Path,
    sync::{Arc, Mutex},
    time::{SystemTime, UNIX_EPOCH},
};

const REQUEST_SCHEMA: &str = "nirs4all.studio-playground-job.v1";
const RESPONSE_SCHEMA: &str = "nirs4all.studio-playground-result.v1";
const MAX_REQUEST_BYTES: usize = 8 * 1024 * 1024;

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
    Some(dispatch(&settings, request, &|document| {
        host.as_ref().map_or_else(
            || {
                Err(LibraryFacadeError {
                    code: "host_unavailable".into(),
                    message: "Attested Playground library host unavailable".into(),
                })
            },
            |host| host.invoke_library_facade(document),
        )
    }))
}

fn dispatch(
    settings: &AppSettingsStore,
    request: &HttpRequest,
    invoke: &impl Fn(&Value) -> Result<Value, LibraryFacadeError>,
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
    if request.body.len() > MAX_REQUEST_BYTES {
        return error(413, "Playground request exceeds 8 MiB");
    }
    let prepared = match prepare(settings, request) {
        Ok(value) => value,
        Err((status, detail)) => return error(status, &detail),
    };
    let response = match invoke(&prepared.document) {
        Ok(value) => value,
        Err(failure) => return error(facade_error_status(&failure.code), &failure.message),
    };
    match project_response(
        &response,
        &prepared.request_id,
        prepared.operation,
        prepared.projection,
    ) {
        Ok(value) => HttpResponse::json(200, value.to_string()),
        Err(detail) => error(500, &detail),
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

fn prepare(settings: &AppSettingsStore, request: &HttpRequest) -> Result<Prepared, (u16, String)> {
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
            prepare_dataset_execute(settings, parse_object(&request.body)?)?,
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
            let dataset = confined_dataset(settings, id)?;
            (
                "metadata_columns",
                json!({"dataset":{"config":dataset},"partition":"train","max_unique_values":200}),
                Projection::Result,
            )
        }
        _ => return Err((404, "Unknown Playground route".into())),
    };
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
) -> Result<Value, (u16, String)> {
    let dataset_id = body
        .remove("dataset_id")
        .and_then(|value| value.as_str().map(str::to_owned))
        .ok_or_else(|| (400, "Missing dataset_id".into()))?;
    let config = confined_dataset(settings, &dataset_id)?;
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

fn confined_dataset(settings: &AppSettingsStore, id: &str) -> Result<Value, (u16, String)> {
    let mut record =
        crate::workspace_documents::linked_dataset(settings, id).map_err(|detail| (404, detail))?;
    let root = record
        .get("path")
        .and_then(Value::as_str)
        .and_then(|value| Path::new(value).canonicalize().ok())
        .filter(|path| path.is_dir())
        .ok_or_else(|| (400, "Linked dataset directory is unavailable".into()))?;
    ScientificRequestResolver::confine_dataset_config(&mut record, &root)
        .map_err(|_| (400, "Linked dataset config escaped its directory".into()))?;
    record
        .get("config")
        .filter(|value| value.is_object())
        .cloned()
        .ok_or_else(|| (400, "Linked dataset has no canonical config".into()))
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

fn project_response(
    response: &Value,
    request_id: &str,
    operation: &str,
    projection: Projection,
) -> Result<Value, String> {
    let root = response
        .as_object()
        .ok_or("Playground library returned a non-object")?;
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
    let result = root["result"].clone();
    if matches!(projection, Projection::Capabilities) {
        return Ok(json!({
            "umap_available":false,
            "nirs4all_available":true,
            "features":{"pca":true,"umap":false,"filters":true,"preprocessing":true,"splitting":true,"augmentation":true},
            "stateless":result["stateless"],
            "cache":result["cache"],
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
        );
        assert_eq!(response.status, 200, "{}", response.body);
        assert_eq!(
            serde_json::from_str::<Value>(&response.body).unwrap()["success"],
            true
        );
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
        );
        assert_eq!(response.status, 500);
        assert!(response.body.contains("wrong response identity"));
    }
}
