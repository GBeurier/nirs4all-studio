//! Workspace prediction table and summary orchestration. The library owns reads.
use crate::{settings::AppSettingsStore, HttpRequest, HttpResponse, SidecarState};
use serde_json::{json, Value};
use std::{
    collections::HashSet,
    sync::{Arc, Mutex},
};

fn endpoint(path: &str) -> Option<(&str, &str)> {
    let suffix = path.strip_prefix("/api/workspaces/")?;
    let (id, tail) = suffix.split_once("/predictions/")?;
    if id.is_empty() || id.contains('/') || !matches!(tail, "data" | "summary") {
        return None;
    }
    Some((id, tail))
}

pub fn route(runtime: &Arc<Mutex<SidecarState>>, request: &HttpRequest) -> Option<HttpResponse> {
    if endpoint(&request.path).is_none() && aggregated_endpoint(&request.path).is_none() {
        return None;
    }
    let (settings, host) = {
        let state = runtime
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        (state.app_settings.clone(), state.scientific_host.clone())
    };
    Some(dispatch(&settings, request, &|operation, payload| {
        host.as_deref()
            .ok_or_else(|| "Scientific library runtime is unavailable".to_owned())?
            .adapt_document(operation, payload)
    }))
}

fn dispatch(
    settings: &AppSettingsStore,
    request: &HttpRequest,
    invoke: &impl Fn(&str, &Value) -> Result<Value, String>,
) -> HttpResponse {
    let error =
        |status, detail: String| HttpResponse::json(status, json!({"detail": detail}).to_string());
    if request.method != "GET" {
        return crate::method_not_allowed(&request.method, &request.path, "GET");
    }
    if let Some((operation, identifier)) = aggregated_endpoint(&request.path) {
        return dispatch_aggregated(settings, request, operation, identifier, invoke);
    }
    let Some((raw_id, kind)) = endpoint(&request.path) else {
        return error(404, "Route not found".into());
    };
    let Ok(id) = percent_encoding::percent_decode_str(raw_id).decode_utf8() else {
        return error(400, "Invalid workspace id".into());
    };
    if id.len() > 256 || id.contains(['/', '\\', '\0']) || matches!(id.as_ref(), "." | "..") {
        return error(400, "Invalid workspace id".into());
    }
    let mut payload = match filters(request.query.as_deref(), kind == "data") {
        Ok(payload) => payload,
        Err(detail) => return error(400, detail),
    };
    let access = match settings.linked_workspace_access(&id) {
        Ok(Some(access)) => access,
        Ok(None) => return error(404, "Workspace not found".into()),
        Err(detail) => return error(409, detail),
    };
    payload["workspace_path"] = json!(access.path());
    let operation = if kind == "data" {
        "results.page"
    } else {
        "results.summary"
    };
    match invoke(operation, &payload) {
        Ok(value) => HttpResponse::json(200, value.to_string()),
        Err(detail) => error(503, detail),
    }
}

fn aggregated_endpoint(path: &str) -> Option<(&'static str, Option<&str>)> {
    let tail = path.strip_prefix("/api/aggregated-predictions")?;
    match tail {
        "" => Some(("results.chains", None)),
        "/top" => Some(("results.top", None)),
        _ => {
            let (operation, id) = if let Some(chain) = tail.strip_prefix("/chain/") {
                chain.strip_suffix("/pipeline-steps").map_or_else(
                    || {
                        chain
                            .strip_suffix("/detail")
                            .map_or(("results.chain", chain), |id| ("results.chain_detail", id))
                    },
                    |id| ("results.chain_steps", id),
                )
            } else if let Some(pipeline) = tail.strip_prefix("/pipeline/") {
                (
                    "results.pipeline_steps",
                    pipeline.strip_suffix("/pipeline-steps")?,
                )
            } else {
                (
                    "results.arrays",
                    tail.strip_prefix('/')?.strip_suffix("/arrays")?,
                )
            };
            (!id.is_empty() && !id.contains('/')).then_some((operation, Some(id)))
        }
    }
}

fn dispatch_aggregated(
    settings: &AppSettingsStore,
    request: &HttpRequest,
    operation: &str,
    identifier: Option<&str>,
    invoke: &impl Fn(&str, &Value) -> Result<Value, String>,
) -> HttpResponse {
    let error =
        |status, detail: String| HttpResponse::json(status, json!({"detail": detail}).to_string());
    let payload = aggregated_filters(request, operation, identifier);
    let mut payload = match payload {
        Ok(payload) => payload,
        Err(detail) => return error(400, detail),
    };
    let access = match settings.active_linked_workspace_access() {
        Ok(Some(access)) => access,
        Ok(None) => return error(409, "No active workspace".into()),
        Err(detail) => return error(409, detail),
    };
    payload["workspace_path"] = json!(access.path());
    match invoke(operation, &payload) {
        Ok(value) => HttpResponse::json(200, value.to_string()),
        Err(detail) if detail.starts_with("not_found:") => error(404, detail),
        Err(detail) => error(503, detail),
    }
}

fn aggregated_filters(
    request: &HttpRequest,
    operation: &str,
    identifier: Option<&str>,
) -> Result<Value, String> {
    let mut payload = json!({});
    if operation == "results.top" {
        payload["n"] = json!(10);
        payload["score_column"] = json!("cv_val_score");
    }
    if let Some(raw) = identifier {
        let id = percent_encoding::percent_decode_str(raw)
            .decode_utf8()
            .map_err(|_| "Invalid result id")?;
        if id.len() > 256 || id.contains(['/', '\\', '\0']) || matches!(id.as_ref(), "." | "..") {
            return Err("Invalid result id".into());
        }
        payload[if operation == "results.arrays" {
            "prediction_id"
        } else if operation == "results.pipeline_steps" {
            "pipeline_id"
        } else {
            "chain_id"
        }] = json!(id);
    }
    let mut seen = HashSet::new();
    for (key, value) in
        url::form_urlencoded::parse(request.query.as_deref().unwrap_or("").as_bytes())
    {
        if !seen.insert(key.to_string())
            || value.is_empty()
            || value.len() > 1024
            || value.contains('\0')
        {
            return Err("Invalid result query".into());
        }
        let permitted = match operation {
            "results.chains" => matches!(
                key.as_ref(),
                "run_id" | "pipeline_id" | "chain_id" | "dataset_name" | "model_class" | "metric"
            ),
            "results.top" => matches!(
                key.as_ref(),
                "run_id"
                    | "pipeline_id"
                    | "dataset_name"
                    | "model_class"
                    | "metric"
                    | "score_column"
                    | "n"
            ),
            "results.chain" => matches!(key.as_ref(), "dataset_name" | "metric"),
            "results.chain_detail" => matches!(key.as_ref(), "partition" | "fold_id"),
            _ => false,
        };
        if !permitted {
            return Err("Unsupported result query field".into());
        }
        if key == "n" {
            let n = value
                .parse::<u16>()
                .map_err(|_| "Invalid top result count")?;
            if !(1..=100).contains(&n) {
                return Err("Invalid top result count".into());
            }
            payload["n"] = json!(n);
        } else {
            if key == "partition" && !matches!(value.as_ref(), "train" | "val" | "test") {
                return Err("Invalid prediction partition".into());
            }
            if key == "score_column"
                && !matches!(
                    value.as_ref(),
                    "cv_val_score"
                        | "cv_test_score"
                        | "cv_train_score"
                        | "final_test_score"
                        | "final_train_score"
                )
            {
                return Err("Invalid chain score column".into());
            }
            payload[key.as_ref()] = json!(value);
        }
    }
    if operation == "results.top" && payload.get("metric").is_none() {
        return Err("Top results require a metric".into());
    }
    Ok(payload)
}

fn filters(query: Option<&str>, page: bool) -> Result<Value, String> {
    let mut payload = if page {
        json!({"limit": 500, "offset": 0})
    } else {
        json!({})
    };
    let mut seen = HashSet::new();
    for (key, value) in url::form_urlencoded::parse(query.unwrap_or("").as_bytes()) {
        if !seen.insert(key.to_string()) {
            return Err("Duplicate prediction query field".into());
        }
        match key.as_ref() {
            "limit" | "offset" if page => {
                let number = value
                    .parse::<u64>()
                    .map_err(|_| "Invalid prediction pagination")?;
                if (key == "limit" && !(1..=1000).contains(&number)) || number > i64::MAX as u64 {
                    return Err("Prediction pagination exceeds supported bounds".into());
                }
                payload[key.as_ref()] = json!(number);
            }
            "dataset" | "model_class" | "partition" if page || key == "dataset" => {
                if value.is_empty() || value.len() > 1024 || value.contains('\0') {
                    return Err("Invalid prediction filter".into());
                }
                if key == "partition" && !matches!(value.as_ref(), "train" | "val" | "test") {
                    return Err("Invalid prediction partition".into());
                }
                payload[key.as_ref()] = json!(value);
            }
            _ => return Err("Unsupported prediction query field".into()),
        }
    }
    Ok(payload)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn workspace_prediction_routes_resolve_named_workspace_and_preserve_real_records() {
        let root = tempfile::tempdir().unwrap();
        let workspace = root.path().join("workspace");
        std::fs::create_dir(&workspace).unwrap();
        std::fs::write(
            root.path().join("app_settings.json"),
            json!({"linked_workspaces": [
                {"id":"selected", "path": workspace, "is_active":false}
            ]})
            .to_string(),
        )
        .unwrap();
        let settings = AppSettingsStore::new(root.path());
        let request = HttpRequest {
            method: "GET".into(),
            path: "/api/workspaces/selected/predictions/data".into(),
            query: Some("limit=1000&offset=1000&dataset=wheat&partition=test".into()),
            headers: std::collections::BTreeMap::default(),
            body: vec![],
        };
        let response = dispatch(&settings, &request, &|operation, payload| {
            assert_eq!(operation, "results.page");
            assert_eq!(payload["limit"], 1000);
            assert_eq!(payload["offset"], 1000);
            assert_eq!(payload["dataset"], "wheat");
            assert_eq!(payload["workspace_path"], json!(workspace));
            Ok(
                json!({"records":[{"id":"real-prediction","val_score":0.25}],"total":1001,"has_more":false}),
            )
        });
        assert_eq!(response.status, 200);
        let body: Value = serde_json::from_str(&response.body).unwrap();
        assert_eq!(body["records"][0]["id"], "real-prediction");
        assert_eq!(body["total"], 1001);
    }
    #[test]
    fn invalid_filters_are_rejected_before_library_execution() {
        for query in [
            "limit=0",
            "limit=1001",
            "offset=-1",
            "dataset=a&dataset=b",
            "partition=oops",
            "path=/tmp/x",
        ] {
            assert!(filters(Some(query), true).is_err(), "{query}");
        }
        assert!(filters(Some("limit=1"), false).is_err());
    }
}
