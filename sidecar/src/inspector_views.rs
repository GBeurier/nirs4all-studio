//! Rust-owned Inspector routes; scientific diagnostics belong to nirs4all.
use crate::{settings::AppSettingsStore, HttpRequest, HttpResponse, SidecarState};
use serde_json::{json, Value};
use std::{
    collections::HashSet,
    sync::{Arc, Mutex},
};

fn endpoint(path: &str) -> Option<(&'static str, &'static str)> {
    Some(match path.strip_prefix("/api/inspector/")? {
        "data" => ("inspector.data", "GET"),
        "histogram" => ("inspector.histogram", "GET"),
        "rankings" => ("inspector.rankings", "GET"),
        "branch-topology" => ("inspector.branch-topology", "GET"),
        "scatter" => ("inspector.scatter", "POST"),
        "heatmap" => ("inspector.heatmap", "POST"),
        "candlestick" => ("inspector.candlestick", "POST"),
        "branch-comparison" => ("inspector.branch-comparison", "POST"),
        "fold-stability" => ("inspector.fold-stability", "POST"),
        "confusion" => ("inspector.confusion", "POST"),
        "preprocessing-impact" => ("inspector.preprocessing-impact", "POST"),
        "hyperparameter" => ("inspector.hyperparameter", "POST"),
        "bias-variance" => ("inspector.bias-variance", "POST"),
        _ => return None,
    })
}

pub fn route(runtime: &Arc<Mutex<SidecarState>>, request: &HttpRequest) -> Option<HttpResponse> {
    endpoint(&request.path)?;
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

fn error(status: u16, detail: impl Into<String>) -> HttpResponse {
    HttpResponse::json(status, json!({"detail":detail.into()}).to_string())
}

fn dispatch(
    settings: &AppSettingsStore,
    request: &HttpRequest,
    invoke: &impl Fn(&str, &Value) -> Result<Value, String>,
) -> HttpResponse {
    let Some((operation, method)) = endpoint(&request.path) else {
        return error(404, "Route not found");
    };
    if request.method != method {
        return crate::method_not_allowed(&request.method, &request.path, method);
    }
    let selection = match payload(request, operation, method) {
        Ok(value) => value,
        Err(detail) => return error(400, detail),
    };
    let access = match settings.active_linked_workspace_access() {
        Ok(Some(access)) => access,
        Ok(None) => return error(409, "No active workspace"),
        Err(detail) => return error(409, detail),
    };
    let payload = json!({"workspace_path":access.path(),"request":selection});
    match invoke(operation, &payload) {
        Ok(value) => HttpResponse::json(200, value.to_string()),
        Err(detail) if detail.starts_with("not_found:") => error(404, detail),
        Err(detail) => error(400, detail),
    }
}

fn payload(request: &HttpRequest, operation: &str, method: &str) -> Result<Value, String> {
    if method == "POST" {
        return post_payload(request);
    }
    get_payload(request, operation)
}

fn post_payload(request: &HttpRequest) -> Result<Value, String> {
    if request
        .query
        .as_deref()
        .is_some_and(|query| !query.is_empty())
    {
        return Err("Inspector POST does not accept query fields".into());
    }
    if request.body.len() > 128 * 1024 {
        return Err("Inspector request exceeds 128 KiB".into());
    }
    let value: Value = serde_json::from_slice(&request.body)
        .map_err(|_| "Expected an Inspector request object")?;
    if !value.is_object()
        || value
            .as_object()
            .is_some_and(|items| items.contains_key("workspace_path"))
    {
        return Err("Invalid Inspector request fields".into());
    }
    if let Some(ids) = value.get("chain_ids") {
        let ids = ids.as_array().ok_or("chain_ids must be an array")?;
        if ids.len() > 256
            || ids.iter().any(|id| {
                id.as_str()
                    .is_none_or(|id| id.is_empty() || id.len() > 256 || id.contains('\0'))
            })
        {
            return Err("Invalid Inspector chain identifiers".into());
        }
    }
    Ok(value)
}

fn get_payload(request: &HttpRequest, operation: &str) -> Result<Value, String> {
    if !request.body.is_empty() {
        return Err("Inspector GET takes no body".into());
    }
    let allowed: &[&str] = match operation {
        "inspector.data" => &[
            "run_id",
            "dataset_name",
            "model_class",
            "preprocessings",
            "task_type",
            "metric",
        ],
        "inspector.histogram" => &["run_id", "dataset_name", "score_column", "n_bins"],
        "inspector.rankings" => &[
            "run_id",
            "dataset_name",
            "score_column",
            "sort_ascending",
            "limit",
            "offset",
        ],
        "inspector.branch-topology" => &["pipeline_id", "score_column", "score_ref"],
        _ => return Err("Unknown Inspector query".into()),
    };
    let mut result = json!({});
    let mut seen = HashSet::new();
    for (key, value) in
        url::form_urlencoded::parse(request.query.as_deref().unwrap_or_default().as_bytes())
    {
        if !allowed.contains(&key.as_ref())
            || value.is_empty()
            || value.len() > 2048
            || value.contains('\0')
        {
            return Err("Invalid Inspector query field".into());
        }
        if matches!(
            key.as_ref(),
            "run_id" | "dataset_name" | "model_class" | "preprocessings"
        ) {
            let items = result
                .as_object_mut()
                .unwrap()
                .entry(key.to_string())
                .or_insert_with(|| json!([]))
                .as_array_mut()
                .unwrap();
            if items.len() >= 256 || value.len() > 256 {
                return Err("Inspector filter exceeds bounds".into());
            }
            items.push(json!(value));
            continue;
        }
        if !seen.insert(key.to_string()) {
            return Err("Duplicate Inspector query field".into());
        }
        result[key.as_ref()] = if matches!(key.as_ref(), "n_bins" | "limit" | "offset") {
            if !value.bytes().all(|byte| byte.is_ascii_digit()) {
                return Err("Inspector index must be an unsigned integer".into());
            }
            json!(value
                .parse::<u32>()
                .map_err(|_| "Inspector index exceeds bounds")?)
        } else if key == "sort_ascending" {
            match value.as_ref() {
                "true" => json!(true),
                "false" => json!(false),
                _ => return Err("sort_ascending must be boolean".into()),
            }
        } else {
            json!(value)
        };
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn request(method: &str, path: &str, query: Option<&str>, body: &str) -> HttpRequest {
        HttpRequest {
            method: method.into(),
            path: path.into(),
            query: query.map(str::to_owned),
            body: body.as_bytes().to_vec(),
            headers: std::collections::BTreeMap::default(),
        }
    }
    #[test]
    fn filter_lists_preserve_multi_selection_but_reject_duplicate_scalar_or_workspace() {
        let value = payload(
            &request(
                "GET",
                "/api/inspector/data",
                Some("run_id=a&run_id=b&dataset_name=Corn"),
                "",
            ),
            "inspector.data",
            "GET",
        )
        .unwrap();
        assert_eq!(value, json!({"run_id":["a","b"],"dataset_name":["Corn"]}));
        assert!(payload(
            &request("GET", "", Some("metric=a&metric=b"), ""),
            "inspector.data",
            "GET"
        )
        .is_err());
        assert!(payload(
            &request("POST", "", None, r#"{"workspace_path":"/foreign"}"#),
            "inspector.scatter",
            "POST"
        )
        .is_err());
    }
    #[test]
    fn query_numbers_and_native_endpoint_allowlist_are_strict() {
        for query in ["n_bins=-1", "n_bins=1.5", "other=1"] {
            assert!(payload(
                &request("GET", "", Some(query), ""),
                "inspector.histogram",
                "GET"
            )
            .is_err());
        }
        assert!(endpoint("/api/inspector/scatter").is_some());
        assert!(endpoint("/api/inspector/scatter/extra").is_none());
    }
}
