//! Workspace prediction table and summary orchestration. The library owns reads.
use crate::{settings::AppSettingsStore, HttpRequest, HttpResponse, SidecarState};
use serde_json::{json, Value};
use std::{
    collections::HashSet,
    sync::{Arc, Mutex},
};

/// Stored prediction partitions. `prediction` rows hold model outputs for
/// samples whose target is missing: no `y_true` and no scores.
fn is_prediction_partition(value: &str) -> bool {
    matches!(value, "train" | "val" | "test" | "prediction")
}

fn endpoint(path: &str) -> Option<(&str, &str)> {
    let suffix = path.strip_prefix("/api/workspaces/")?;
    let (id, tail) = suffix.split_once("/predictions/")?;
    let scatter = tail
        .strip_suffix("/scatter")
        .is_some_and(|prediction| !prediction.is_empty() && !prediction.contains('/'));
    if id.is_empty() || id.contains('/') || (!matches!(tail, "data" | "summary") && !scatter) {
        return None;
    }
    Some((id, tail))
}

/// Every chain of one dataset: `/api/workspaces/{id}/runs/{run}/datasets/{name}/chains`
/// (one run) or `/api/workspaces/{id}/results/datasets/{name}/chains` (all runs).
fn dataset_chains_endpoint(path: &str) -> Option<(&str, Option<&str>, &str)> {
    let (id, tail) = path.strip_prefix("/api/workspaces/")?.split_once('/')?;
    let tail = tail.strip_suffix("/chains")?;
    let (run, dataset) = match tail.strip_prefix("runs/") {
        Some(rest) => {
            let (run, dataset) = rest.split_once("/datasets/")?;
            (Some(run), dataset)
        }
        None => (None, tail.strip_prefix("results/datasets/")?),
    };
    let segment = |value: &str| !value.is_empty() && !value.contains('/');
    (segment(id) && run.is_none_or(segment) && segment(dataset)).then_some((id, run, dataset))
}

fn decoded_segment(raw: &str, max_len: usize) -> Option<String> {
    let value = percent_encoding::percent_decode_str(raw)
        .decode_utf8()
        .ok()?;
    (!value.is_empty()
        && value.len() <= max_len
        && !value.contains(['/', '\\', '\0'])
        && !matches!(value.as_ref(), "." | ".."))
    .then(|| value.into_owned())
}

pub fn route(runtime: &Arc<Mutex<SidecarState>>, request: &HttpRequest) -> Option<HttpResponse> {
    if endpoint(&request.path).is_none()
        && aggregated_endpoint(&request.path).is_none()
        && dataset_chains_endpoint(&request.path).is_none()
    {
        return None;
    }
    let (settings, host) = {
        let state = runtime
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        (state.app_settings.clone(), state.scientific_host.clone())
    };
    // Cover the complete HTTP read, including adapter verification and JSON
    // response construction. This activity token holds no admission readlock:
    // the existing warm exchange still owns its unchanged pre/post guards.
    let operation = if dataset_chains_endpoint(&request.path).is_some() {
        Some("results.dataset_chains")
    } else {
        aggregated_endpoint(&request.path).map_or_else(
            || {
                endpoint(&request.path).map(|(_, kind)| {
                    if kind.ends_with("/scatter") {
                        "results.arrays"
                    } else if kind == "data" {
                        "results.page"
                    } else {
                        "results.summary"
                    }
                })
            },
            |(operation, _)| Some(operation),
        )
    }?;
    let _activity = if request.method == "GET" {
        match host
            .as_deref()
            .map(|host| host.prediction_read_activity(operation))
            .transpose()
        {
            Ok(activity) => activity.flatten(),
            Err(error) => {
                return Some(HttpResponse::json(
                    503,
                    json!({"detail": error.reason()}).to_string(),
                ));
            }
        }
    } else {
        None
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
    if let Some((raw_id, run, dataset)) = dataset_chains_endpoint(&request.path) {
        return dispatch_dataset_chains(settings, request, (raw_id, run, dataset), invoke);
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
    let scatter_id = kind.strip_suffix("/scatter");
    let mut payload = match scatter_id.map_or_else(
        || filters(request.query.as_deref(), kind == "data"),
        |prediction| aggregated_filters(request, "results.arrays", Some(prediction)),
    ) {
        Ok(payload) => payload,
        Err(detail) => return error(400, detail),
    };
    let access = match settings.linked_workspace_access(&id) {
        Ok(Some(access)) => access,
        Ok(None) => return error(404, "Workspace not found".into()),
        Err(detail) => return error(409, detail),
    };
    payload["workspace_path"] = json!(access.path());
    let operation = if scatter_id.is_some() {
        "results.arrays"
    } else if kind == "data" {
        "results.page"
    } else {
        "results.summary"
    };
    match invoke(operation, &payload) {
        Ok(value) => HttpResponse::json(200, value.to_string()),
        Err(detail) if detail.starts_with("not_found:") => error(404, detail),
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

fn dispatch_dataset_chains(
    settings: &AppSettingsStore,
    request: &HttpRequest,
    (raw_id, raw_run, raw_dataset): (&str, Option<&str>, &str),
    invoke: &impl Fn(&str, &Value) -> Result<Value, String>,
) -> HttpResponse {
    let error =
        |status, detail: &str| HttpResponse::json(status, json!({"detail": detail}).to_string());
    if request
        .query
        .as_deref()
        .is_some_and(|query| !query.is_empty())
    {
        return error(400, "Unsupported dataset chains query");
    }
    let Some(id) = decoded_segment(raw_id, 256) else {
        return error(400, "Invalid workspace id");
    };
    let Some(dataset) = decoded_segment(raw_dataset, 1024) else {
        return error(400, "Invalid dataset name");
    };
    let run = match raw_run.map(|run| decoded_segment(run, 256)) {
        Some(None) => return error(400, "Invalid run id"),
        Some(Some(run)) => Some(run),
        None => None,
    };
    let access = match settings.linked_workspace_access(&id) {
        Ok(Some(access)) => access,
        Ok(None) => return error(404, "Workspace not found"),
        Err(detail) => return error(409, &detail),
    };
    let mut payload = json!({"workspace_path": access.path(), "dataset_name": dataset});
    if let Some(run) = run {
        payload["run_id"] = json!(run);
    }
    match invoke("results.dataset_chains", &payload) {
        Ok(value) => HttpResponse::json(200, value.to_string()),
        Err(detail) => error(503, &detail),
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
            if key == "partition" && !is_prediction_partition(&value) {
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
                if key == "partition" && !is_prediction_partition(&value) {
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
    fn partition_filters_accept_target_missing_prediction_rows() {
        let page = filters(Some("partition=prediction"), true).unwrap();
        assert_eq!(page["partition"], "prediction");
        assert!(filters(Some("partition=oops"), true).is_err());
        let request = HttpRequest {
            method: "GET".into(),
            path: "/api/aggregated-predictions/chain/chain-1/detail".into(),
            query: Some("partition=prediction&fold_id=final".into()),
            headers: std::collections::BTreeMap::default(),
            body: vec![],
        };
        let detail = aggregated_filters(&request, "results.chain_detail", Some("chain-1")).unwrap();
        assert_eq!(detail["partition"], "prediction");
        assert_eq!(detail["fold_id"], "final");
    }
    #[test]
    fn dataset_chain_listings_reach_the_owner_for_one_run_or_all_runs() {
        let root = tempfile::tempdir().unwrap();
        let workspace = root.path().join("workspace");
        std::fs::create_dir(&workspace).unwrap();
        std::fs::write(
            root.path().join("app_settings.json"),
            json!({"linked_workspaces":[{"id":"ws-1","path":workspace,"is_active":true}]})
                .to_string(),
        )
        .unwrap();
        let settings = AppSettingsStore::new(root.path());
        let get = |path: &str, query: Option<&str>| HttpRequest {
            method: "GET".into(),
            path: path.into(),
            query: query.map(Into::into),
            headers: std::collections::BTreeMap::default(),
            body: vec![],
        };
        for (path, run) in [
            (
                "/api/workspaces/ws-1/runs/run-7/datasets/Missing%20target%20run/chains",
                Some("run-7"),
            ),
            (
                "/api/workspaces/ws-1/results/datasets/Missing%20target%20run/chains",
                None,
            ),
        ] {
            let response = dispatch(&settings, &get(path, None), &|operation, payload| {
                assert_eq!(operation, "results.dataset_chains");
                assert_eq!(payload["workspace_path"], json!(workspace));
                assert_eq!(payload["dataset_name"], "Missing target run");
                assert_eq!(payload.get("run_id").and_then(Value::as_str), run);
                Ok(json!({"chains":[{"chain_id":"chain-1"}],"total":1,"metric":"rmse"}))
            });
            assert_eq!(response.status, 200, "{}", response.body);
            assert_eq!(
                serde_json::from_str::<Value>(&response.body).unwrap()["chains"][0]["chain_id"],
                "chain-1"
            );
        }
        let refuse = |_: &str, _: &Value| -> Result<Value, String> {
            panic!("refused requests never reach the owner")
        };
        let status = |path: &str, query: Option<&str>| {
            dispatch(&settings, &get(path, query), &refuse).status
        };
        assert_eq!(
            status(
                "/api/workspaces/ws-1/results/datasets/a/chains",
                Some("x=1")
            ),
            400
        );
        assert_eq!(
            status("/api/workspaces/ws-1/results/datasets/%2E%2E/chains", None),
            400
        );
        assert_eq!(
            status("/api/workspaces/missing/results/datasets/a/chains", None),
            404
        );
        assert!(
            dataset_chains_endpoint("/api/workspaces/ws-1/results/datasets/a/b/chains").is_none()
        );
        assert!(dataset_chains_endpoint("/api/workspaces/ws-1/runs//datasets/a/chains").is_none());
        assert!(dataset_chains_endpoint("/api/workspaces/ws-1/runs/r/datasets/a/scores").is_none());
    }

    #[test]
    fn editor_reload_routes_keep_the_object_contract_on_the_http_wire() {
        use std::{
            io::Read,
            net::{TcpListener, TcpStream},
            thread,
            time::Duration,
        };

        let root = tempfile::tempdir().unwrap();
        let workspace = root.path().join("workspace");
        std::fs::create_dir(&workspace).unwrap();
        std::fs::write(
            root.path().join("app_settings.json"),
            json!({"linked_workspaces":[{"id":"selected","path":workspace,"is_active":true}]})
                .to_string(),
        )
        .unwrap();
        let settings = AppSettingsStore::new(root.path());
        let steps = json!([
            {"class":"sklearn.model_selection.KFold","params":{"n_splits":3}},
            {"y_processing":"sklearn.preprocessing.StandardScaler"},
            {"class":"nirs4all.operators.transforms.StandardNormalVariate"},
            {"class":"sklearn.preprocessing.StandardScaler"},
            {"model":{"class":"sklearn.cross_decomposition.PLSRegression","params":{"n_components":4}}}
        ]);
        for (kind, operation, id_key, reload) in [
            (
                "chain",
                "results.chain_steps",
                "chain_id",
                json!({"source":"chain_snapshot","selection_scope":"preprocessing_chain_plus_selected_model","is_editable_template":false}),
            ),
            (
                "pipeline",
                "results.pipeline_steps",
                "pipeline_id",
                json!({"source":"authoring_template","is_editable_template":true,"is_legacy_fallback":false}),
            ),
        ] {
            let request = HttpRequest {
                method: "GET".into(),
                path: format!("/api/aggregated-predictions/{kind}/stored-id/pipeline-steps"),
                query: None,
                headers: std::collections::BTreeMap::default(),
                body: vec![],
            };
            let response = dispatch(&settings, &request, &|actual_operation, payload| {
                assert_eq!(actual_operation, operation);
                assert_eq!(payload[id_key], "stored-id");
                assert_eq!(payload["workspace_path"], json!(workspace));
                let mut result = json!({"name":"Corn PLS","pipeline":steps,"reload":reload});
                result[id_key] = json!("stored-id");
                Ok(result)
            });
            let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
            let address = listener.local_addr().unwrap();
            let server = thread::spawn(move || {
                let (mut socket, _) = listener.accept().unwrap();
                crate::write_response(&mut socket, &response).unwrap();
            });
            let mut client = TcpStream::connect(address).unwrap();
            client
                .set_read_timeout(Some(Duration::from_secs(5)))
                .unwrap();
            let mut wire = Vec::new();
            client.read_to_end(&mut wire).unwrap();
            server.join().unwrap();
            let boundary = wire
                .windows(4)
                .position(|window| window == b"\r\n\r\n")
                .unwrap();
            let headers = std::str::from_utf8(&wire[..boundary]).unwrap();
            assert!(headers.starts_with("HTTP/1.1 200 OK\r\n"));
            assert!(headers.contains("Content-Type: application/json"));
            let result: Value = serde_json::from_slice(&wire[boundary + 4..]).unwrap();
            assert!(result.is_object());
            assert_eq!(result[id_key], "stored-id");
            assert_eq!(result["name"], "Corn PLS");
            assert_eq!(result["pipeline"], steps);
            assert_eq!(result["reload"], reload);
        }
    }

    #[test]
    fn scatter_uses_the_named_workspace_and_rejects_unbounded_fields() {
        let root = tempfile::tempdir().unwrap();
        let workspace = root.path().join("workspace");
        std::fs::create_dir(&workspace).unwrap();
        std::fs::write(
            root.path().join("app_settings.json"),
            json!({"linked_workspaces":[{"id":"selected","path":workspace,"is_active":false}]})
                .to_string(),
        )
        .unwrap();
        let settings = AppSettingsStore::new(root.path());
        let mut request = HttpRequest {
            method: "GET".into(),
            path: "/api/workspaces/selected/predictions/real-prediction/scatter".into(),
            query: None,
            headers: std::collections::BTreeMap::default(),
            body: vec![],
        };
        let response = dispatch(&settings, &request, &|operation, payload| {
            assert_eq!(operation, "results.arrays");
            assert_eq!(payload["workspace_path"], json!(workspace));
            assert_eq!(payload["prediction_id"], "real-prediction");
            Ok(json!({"y_true":[1.0],"y_pred":[1.1]}))
        });
        assert_eq!(response.status, 200);
        assert_eq!(
            serde_json::from_str::<Value>(&response.body).unwrap()["y_pred"],
            json!([1.1])
        );
        request.query = Some("path=/unauthorized".into());
        assert_eq!(
            dispatch(&settings, &request, &|_, _| panic!(
                "invalid input reached the library"
            ))
            .status,
            400
        );
        request.query = None;
        request.path = "/api/workspaces/selected/predictions/a%2Fb/scatter".into();
        assert_eq!(
            dispatch(&settings, &request, &|_, _| panic!(
                "invalid identifier reached the library"
            ))
            .status,
            400
        );
    }
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
