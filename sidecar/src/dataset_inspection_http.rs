//! Dataset wizard transport. Release global state before IO or `CPython` calls.

use crate::{
    dataset_inspection::DatasetInspection, scientific_request_resolver::ScientificRequestResolver,
    settings::AppSettingsStore, workspace_documents, HttpRequest, HttpResponse, SidecarState,
};
use nirs4all_io::materialize::LoadLimits;
use serde_json::{json, Value};
use std::{
    collections::BTreeMap,
    io::Read,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};

const PREFIX: &str = "/api/datasets/";

fn matches_route(request: &HttpRequest) -> bool {
    let Some(tail) = request.path.strip_prefix(PREFIX) else {
        return false;
    };
    if request.method == "POST" {
        matches!(
            tail,
            "detect-files"
                | "detect-unified"
                | "detect-files-list"
                | "scan-folder"
                | "detect-format"
                | "auto-detect"
                | "validate-files"
                | "preview"
        )
    } else {
        request.method == "GET"
            && tail.split_once('/').is_some_and(|(id, operation)| {
                !id.is_empty() && matches!(operation, "preview" | "stats")
            })
    }
}

pub fn route(state: &Arc<Mutex<SidecarState>>, request: &HttpRequest) -> Option<HttpResponse> {
    if !matches_route(request) {
        return None;
    }
    let (settings, host) = {
        let state = state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        (state.app_settings.clone(), state.scientific_host.clone())
    };
    Some(handle(&settings, request, &|operation, payload| {
        host.as_ref()
            .ok_or("No attested scientific runtime configured")?
            .adapt_document(operation, payload)
    }))
}

fn text<'a>(body: &'a Value, key: &str) -> Result<&'a str, String> {
    body[key]
        .as_str()
        .filter(|value| !value.is_empty() && value.len() <= 32768 && !value.contains('\0'))
        .ok_or_else(|| format!("{key} must be a nonempty bounded string"))
}

fn fields(body: &Value, allowed: &[&str]) -> Result<(), String> {
    if body
        .as_object()
        .is_none_or(|object| object.keys().any(|key| !allowed.contains(&key.as_str())))
    {
        return Err("Unexpected dataset inspection fields".into());
    }
    Ok(())
}

fn count(body: &Value, key: &str, default: usize) -> Result<usize, String> {
    body.get(key).map_or(Ok(default), |value| {
        value
            .as_u64()
            .and_then(|value| usize::try_from(value).ok())
            .ok_or_else(|| format!("{key} must be a nonnegative integer"))
    })
}

fn object(body: &Value, key: &str) -> Result<Value, String> {
    match body.get(key) {
        None | Some(Value::Null) => Ok(json!({})),
        Some(value) if value.is_object() => Ok(value.clone()),
        _ => Err(format!("{key} must be an object")),
    }
}

fn inspector(root: &Path) -> Result<DatasetInspection, String> {
    DatasetInspection::new(
        root,
        LoadLimits {
            max_file_bytes: 256 * 1024 * 1024,
            max_total_bytes: 512 * 1024 * 1024,
            ..LoadLimits::default()
        },
    )
}

fn paths(value: &Value) -> Result<Vec<PathBuf>, String> {
    let values = value
        .as_array()
        .filter(|values| !values.is_empty() && values.len() <= 4096)
        .ok_or("files must be a nonempty bounded list")?;
    values
        .iter()
        .map(|value| {
            let path = value
                .as_str()
                .or_else(|| value["path"].as_str())
                .ok_or("Each file requires a path")?;
            if path.is_empty() || path.len() > 32768 || path.contains('\0') {
                return Err("Invalid input path".into());
            }
            Ok(PathBuf::from(path))
        })
        .collect()
}

fn file_root(path: &Path) -> Result<PathBuf, String> {
    path.canonicalize()
        .map_err(|error| error.to_string())?
        .parent()
        .map(Path::to_path_buf)
        .ok_or_else(|| "File requires a parent directory".into())
}

fn common_root(paths: &[PathBuf]) -> Result<PathBuf, String> {
    let mut root = file_root(paths.first().ok_or("No files selected")?)?;
    for path in paths {
        let path = path.canonicalize().map_err(|error| error.to_string())?;
        while !path.starts_with(&root) {
            if !root.pop() {
                return Err("Selected files have no common directory".into());
            }
        }
    }
    Ok(root)
}

fn selection_root(body: &Value, selected: &[PathBuf]) -> Result<PathBuf, String> {
    match body.get("path").and_then(Value::as_str) {
        Some("") | None => common_root(selected),
        Some(value) => Path::new(value)
            .canonicalize()
            .map_err(|error| error.to_string()),
    }
}

fn project_format(mut result: Value, path: &Path) -> Value {
    if let Some(extension) = path.extension().and_then(|value| value.to_str()) {
        if ["xlsx", "xls", "npy", "npz"].contains(&extension.to_lowercase().as_str()) {
            result["format"] = json!(extension.to_lowercase());
        }
    }
    result
}

fn linked_projection(
    settings: &AppSettingsStore,
    tail: &str,
    query: &BTreeMap<String, String>,
    adapt: &impl Fn(&str, &Value) -> Result<Value, String>,
) -> Result<Value, String> {
    let (id, operation) = tail.split_once('/').ok_or("Dataset id required")?;
    let allowed = if operation == "preview" {
        "max_samples"
    } else {
        "partition"
    };
    if query.keys().any(|key| key != allowed) {
        return Err("Unknown dataset query field".into());
    }
    let record = workspace_documents::linked_dataset(settings, id)?;
    let path = Path::new(text(&record, "path")?)
        .canonicalize()
        .map_err(|error| error.to_string())?;
    let root = if path.is_dir() {
        path.clone()
    } else {
        file_root(&path)?
    };
    let service = inspector(&root)?;
    let mut config = object(&record, "config")?;
    if config.as_object().is_some_and(serde_json::Map::is_empty) && path.is_file() {
        config = json!({"train_x":path});
    }
    ScientificRequestResolver::confine_dataset_config(&mut config, &root)
        .map_err(|error| format!("{error:?}"))?;
    // A stored empty config resolves only the selected folder through
    // the library owner, then every returned reference is confined.
    let mut result = if operation == "preview" {
        let max = query.get("max_samples").map_or(Ok(100), |value| {
            value.parse::<usize>().map_err(|e| e.to_string())
        })?;
        service.preview(&config, max, adapt)?
    } else {
        service.statistics(
            &config,
            query.get("partition").map_or("train", String::as_str),
            adapt,
        )?
    };
    result["dataset_id"] = json!(id);
    Ok(result)
}

fn format_response(
    tail: &str,
    body: &Value,
    adapt: &impl Fn(&str, &Value) -> Result<Value, String>,
) -> Result<Value, String> {
    fields(
        body,
        &[
            "path",
            "sample_rows",
            "delimiter",
            "decimal_separator",
            "has_header",
            "attempt_load",
        ],
    )?;
    if body
        .get("attempt_load")
        .is_some_and(|value| !value.is_boolean())
    {
        return Err("attempt_load must be boolean".into());
    }
    let path = Path::new(text(body, "path")?);
    let service = inspector(&file_root(path)?)?;
    let mut params = json!({});
    for key in ["delimiter", "decimal_separator", "has_header"] {
        if let Some(value) = body.get(key) {
            params[key] = value.clone();
        }
    }
    if params
        .get("has_header")
        .is_some_and(|value| !value.is_boolean())
    {
        return Err("has_header must be boolean".into());
    }
    if tail == "auto-detect"
        && body.get("attempt_load") == Some(&Value::Bool(false))
        && path.extension().is_some_and(|extension| {
            ["csv", "tsv", "txt"]
                .iter()
                .any(|value| extension.eq_ignore_ascii_case(value))
        })
    {
        service.admit_files(&[path.to_path_buf()])?;
        let mut bytes = Vec::new();
        std::fs::File::open(path)
            .map_err(|error| error.to_string())?
            .take(65536)
            .read_to_end(&mut bytes)
            .map_err(|error| error.to_string())?;
        let description =
            nirs4all_io::core::infer::describe::describe_text(&String::from_utf8_lossy(&bytes), 50);
        let mut result = json!({"success":true,"delimiter":description.delimiter.to_string(),
            "decimal_separator":description.decimal_separator.to_string(),"has_header":description.has_header,
            "header_unit":description.header_unit,"encoding":"utf-8","confidence":description.confidence,
            "warnings":[],"reader":{"backend":"nirs4all-io.describe_text","scope":"bounded_prefix","matrix_loaded":false}});
        for (key, value) in params.as_object().ok_or("Invalid params")? {
            result[key] = value.clone();
        }
        return Ok(result);
    }
    let result = service.inspect_file(path, &params, count(body, "sample_rows", 10)?, adapt)?;
    if tail == "detect-format" {
        return Ok(project_format(result, path));
    }
    Ok(
        json!({"success":true,"delimiter":result["detected_delimiter"],
        "decimal_separator":result["detected_decimal"],"has_header":result["has_header"],
        "header_unit":result["header_unit"],"encoding":"utf-8","confidence":result["confidence"],
        "num_rows":result["num_rows"],"num_columns":result["num_columns"],
        "warnings":if body.get("attempt_load") == Some(&Value::Bool(false)) {
            vec!["This format's metadata inspection requires its registered reader"]
        } else { vec![] },"reader":result["reader"]}),
    )
}

fn handle(
    settings: &AppSettingsStore,
    request: &HttpRequest,
    adapt: &impl Fn(&str, &Value) -> Result<Value, String>,
) -> HttpResponse {
    let result = (|| -> Result<Value, String> {
        let mut query = BTreeMap::new();
        for (key, value) in
            url::form_urlencoded::parse(request.query.as_deref().unwrap_or("").as_bytes())
        {
            if query.insert(key.into_owned(), value.into_owned()).is_some() {
                return Err("Duplicate query field".into());
            }
        }
        let tail = request
            .path
            .strip_prefix(PREFIX)
            .ok_or("Unknown dataset route")?;
        if request.method == "GET" {
            return linked_projection(settings, tail, &query, adapt);
        }
        if !query.is_empty() || request.body.len() > 2 * 1024 * 1024 {
            return Err("Dataset POST requires a bounded body and no query fields".into());
        }
        let body: Value =
            serde_json::from_slice(&request.body).map_err(|error| error.to_string())?;
        match tail {
            "detect-files" | "detect-unified" | "scan-folder" => {
                fields(&body, &["path", "recursive"])?;
                let service = inspector(Path::new(text(&body, "path")?))?;
                let recursive = body.get("recursive").map_or(Ok(false), |value| {
                    value.as_bool().ok_or("recursive must be boolean")
                })?;
                if tail == "scan-folder" {
                    service.scan_folder(adapt)
                } else {
                    service.detect_files(recursive, adapt)
                }
            }
            "detect-files-list" => {
                fields(&body, &["paths"])?;
                let paths = paths(&body["paths"])?;
                inspector(&common_root(&paths)?)?.detect_files_list(&paths, adapt)
            }
            "detect-format" | "auto-detect" => format_response(tail, &body, adapt),
            "validate-files" => {
                fields(&body, &["path", "files", "parsing", "per_file_overrides"])?;
                let requested = paths(&body["files"])?;
                let root = selection_root(&body, &requested)?;
                let service = inspector(&root)?;
                service.admit_files(&requested)?;
                let parsing = object(&body, "parsing")?;
                let overrides = object(&body, "per_file_overrides")?;
                let mut shapes = json!({});
                for file in body["files"].as_array().ok_or("files must be a list")? {
                    if !matches!(file["type"].as_str(), Some("X" | "Y" | "metadata")) {
                        continue;
                    }
                    let path = text(file, "path")?;
                    let mut params = parsing.clone();
                    for extra in [file.get("overrides"), overrides.get(path)]
                        .into_iter()
                        .flatten()
                        .filter(|value| !value.is_null())
                    {
                        for (key, value) in
                            extra.as_object().ok_or("Invalid file parsing overrides")?
                        {
                            params[key] = value.clone();
                        }
                    }
                    shapes[path] = match service.inspect_file(Path::new(path), &params, 0, adapt) {
                        Ok(info) => {
                            json!({"path":path,"num_rows":info["num_rows"],"num_columns":info["num_columns"]})
                        }
                        Err(error) => json!({"path":path,"error":error}),
                    };
                }
                Ok(json!({"success":true,"shapes":shapes}))
            }
            "preview" => {
                fields(&body, &["path", "files", "parsing", "max_samples"])?;
                let selected = paths(&body["files"])?;
                let root = selection_root(&body, &selected)?;
                let service = inspector(&root)?;
                service.admit_files(&selected)?;
                let mut document = body.clone();
                document["path"] = json!(root);
                // Authorization is repeated after the library converts the
                // wizard's declarative roles into the canonical dataset config.
                ScientificRequestResolver::confine_dataset_config(&mut document, &root)
                    .map_err(|error| format!("{error:?}"))?;
                let mut config = adapt("dataset.configure", &document)?;
                ScientificRequestResolver::confine_dataset_config(&mut config, &root)
                    .map_err(|error| format!("{error:?}"))?;
                service.preview(&config, count(&body, "max_samples", 100)?, adapt)
            }
            _ => Err("Unknown dataset inspection operation".into()),
        }
    })();
    match result {
        Ok(value) => HttpResponse::json(200, value.to_string()),
        Err(detail) => HttpResponse::json(400, json!({"detail":detail}).to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn request(operation: &str, body: &Value) -> HttpRequest {
        HttpRequest {
            method: "POST".into(),
            path: format!("{PREFIX}{operation}"),
            query: None,
            headers: BTreeMap::new(),
            body: body.to_string().into_bytes(),
        }
    }
    #[test]
    fn selected_files_do_not_inspect_unselected_broken_sibling_and_keep_client_shape() {
        let root = tempfile::tempdir().unwrap();
        let settings = AppSettingsStore::new(root.path().join("config"));
        let path = root.path().join("Xcal.csv");
        std::fs::write(&path, "a;b\n1;2\n3;4\n").unwrap();
        std::fs::write(root.path().join("unselected.xlsx"), "broken").unwrap();
        let response = handle(
            &settings,
            &request("detect-files-list", &json!({"paths":[path]})),
            &|_, _| panic!("No Python or unselected file read"),
        );
        assert_eq!(response.status, 200);
        let body: Value = serde_json::from_str(&response.body).unwrap();
        assert_eq!(body["files"].as_array().unwrap().len(), 1);
        assert_eq!(body["files"][0]["detected"], true);
        assert_eq!(body["files"][0]["type"], "X");
    }
    #[test]
    fn validation_applies_explicit_header_override_to_all_roles() {
        let root = tempfile::tempdir().unwrap();
        let settings = AppSettingsStore::new(root.path().join("config"));
        std::fs::write(root.path().join("Ycal.csv"), "1\n2\n3\n").unwrap();
        let response = handle(
            &settings,
            &request(
                "validate-files",
                &json!({"path":root.path(),
            "files":[{"path":"Ycal.csv","type":"Y"}],"parsing":{"has_header":true},
            "per_file_overrides":{"Ycal.csv":{"has_header":false}}}),
            ),
            &|_, _| panic!("Native CSV only"),
        );
        assert_eq!(response.status, 200);
        let body: Value = serde_json::from_str(&response.body).unwrap();
        assert_eq!(body["shapes"]["Ycal.csv"]["num_rows"], 3);
    }
    #[test]
    fn preview_escape_is_rejected_before_attested_adapter() {
        let root = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let path = outside.path().join("X.csv");
        std::fs::write(&path, "a\n1\n").unwrap();
        let settings = AppSettingsStore::new(root.path().join("config"));
        let response = handle(
            &settings,
            &request(
                "preview",
                &json!({"path":root.path(),
            "files":[{"path":path,"type":"X","split":"train"}],"parsing":{}}),
            ),
            &|_, _| panic!("No adapter before confinement"),
        );
        assert_eq!(response.status, 400);
    }

    #[test]
    fn file_selection_preview_delegates_canonical_config_without_fabricating_counts() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("Xcal.csv");
        std::fs::write(&path, "a;b\n1;2\n3;4\n").unwrap();
        let canonical_path = path.canonicalize().unwrap();
        let settings = AppSettingsStore::new(root.path().join("settings"));
        let response = handle(
            &settings,
            &request(
                "preview",
                &json!({"path":"",
            "files":[{"path":path,"type":"X","split":"train"}],
            "parsing":{"has_header":true},"max_samples":7}),
            ),
            &|operation, payload| {
                if operation == "dataset.configure" {
                    if payload.get("record").is_some() {
                        return Ok(payload["record"]["config"].clone());
                    }
                    assert_eq!(payload["files"][0]["path"], json!(canonical_path));
                    return Ok(json!({"train_x":path,"global_params":{"has_header":true}}));
                }
                assert_eq!(operation, "dataset.preview");
                assert_eq!(payload["config"]["train_x"], json!(canonical_path));
                assert_eq!(payload["max_samples"], 7);
                Ok(
                    json!({"success":true,"summary":{"num_samples":2,"num_features":2},
                "reader":{"backend":"nirs4all-io.native"}}),
                )
            },
        );
        assert_eq!(response.status, 200, "{}", response.body);
        let body: Value = serde_json::from_str(&response.body).unwrap();
        assert_eq!(body["summary"]["num_samples"], 2);
    }

    #[test]
    fn actual_http_reaches_native_format_route_without_scientific_host() {
        use std::{
            io::{Read, Write},
            net::{TcpListener, TcpStream},
        };
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("Xcal.csv");
        std::fs::write(&path, "1100;1102\n1.5;2.5\n3.5;4.5\n").unwrap();
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let state = Arc::new(Mutex::new(SidecarState::with_app_settings_dir(
            root.path().join("settings"),
        )));
        let server = std::thread::spawn(move || {
            let (stream, _) = listener.accept().unwrap();
            crate::handle_connection_with_limits(stream, &state, crate::ServerLimits::default())
                .unwrap();
        });
        let body = json!({"path":path,"has_header":true,"sample_rows":2}).to_string();
        let mut stream = TcpStream::connect(address).unwrap();
        stream
            .set_read_timeout(Some(std::time::Duration::from_secs(10)))
            .unwrap();
        write!(stream,"POST /api/datasets/detect-format HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{body}",body.len()).unwrap();
        let mut response = String::new();
        stream.read_to_string(&mut response).unwrap();
        server.join().unwrap();
        assert!(response.starts_with("HTTP/1.1 200"), "{response}");
        let result: Value =
            serde_json::from_str(response.split_once("\r\n\r\n").unwrap().1).unwrap();
        assert_eq!(result["num_rows"], 2);
        assert_eq!(result["sample_data"][0][0], "1.5");
    }

    #[test]
    fn linked_file_preview_and_stats_reuse_saved_config_and_validate_query() {
        let root = tempfile::tempdir().unwrap();
        let settings = AppSettingsStore::new(root.path().join("settings"));
        let workspace = root.path().join("workspace");
        let file = root.path().join("Xcal.csv");
        std::fs::write(&file, "a;b\n1;2\n3;4\n").unwrap();
        let canonical_file = file.canonicalize().unwrap();
        for (path, body) in [
            (
                "/api/workspace/create",
                json!({"path":workspace,"name":"inspection"}),
            ),
            ("/api/workspace/select", json!({"path":workspace})),
        ] {
            let response =
                workspace_documents::route(&settings, "POST", path, body.to_string().as_bytes())
                    .unwrap();
            assert_eq!(response.status, 200, "{}", response.body);
        }
        let linked = workspace_documents::route(
            &settings,
            "POST",
            "/api/datasets/link",
            json!({"path":file,"config":{"train_x":file,"global_params":{"has_header":true}}})
                .to_string()
                .as_bytes(),
        )
        .unwrap();
        assert_eq!(linked.status, 200, "{}", linked.body);
        let linked: Value = serde_json::from_str(&linked.body).unwrap();
        let id = linked["dataset"]["id"].as_str().unwrap();
        let mut request = HttpRequest {
            method: "GET".into(),
            path: format!("{PREFIX}{id}/stats"),
            query: Some("partition=all".into()),
            headers: BTreeMap::new(),
            body: Vec::new(),
        };
        let adapt = |operation: &str, payload: &Value| {
            if operation == "dataset.configure" {
                return Ok(payload["record"]["config"].clone());
            }
            assert_eq!(payload["config"]["train_x"], json!(canonical_file));
            assert_eq!(operation, "dataset.stats");
            assert_eq!(payload["partition"], "all");
            Ok(json!({"partition":"all","global":{"num_samples":2}}))
        };
        let result = handle(&settings, &request, &adapt);
        assert_eq!(result.status, 200, "{}", result.body);
        assert_eq!(
            serde_json::from_str::<Value>(&result.body).unwrap()["dataset_id"],
            id
        );
        request.query = Some("partition=train&partition=test".into());
        assert_eq!(
            handle(&settings, &request, &|_, _| panic!(
                "query rejection precedes callback"
            ))
            .status,
            400
        );
    }

    #[test]
    fn text_auto_detect_without_loading_reads_only_prefix_and_claims_no_exact_rows() {
        let root = tempfile::tempdir().unwrap();
        let file = root.path().join("X.csv");
        std::fs::write(&file, "sample;1100;1102\na;1;2\nb;3;4\n").unwrap();
        let settings = AppSettingsStore::new(root.path().join("settings"));
        let response = handle(
            &settings,
            &request("auto-detect", &json!({"path":file,"attempt_load":false})),
            &|_, _| panic!("No full file loader"),
        );
        assert_eq!(response.status, 200);
        let result: Value = serde_json::from_str(&response.body).unwrap();
        assert_eq!(result["reader"]["matrix_loaded"], false);
        assert!(result.get("num_rows").is_none());
    }
}
