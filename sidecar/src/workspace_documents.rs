//! Studio-owned workspace and editor documents. Scientific stores, dataset
//! parsing and pipeline execution remain owned by their library runtimes.
//! Files retain the pre-migration JSON shapes; writes publish atomically.

use std::{
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::Mutex,
};

use atomicwrites::{AllowOverwrite, AtomicFile, DisallowOverwrite};
use serde_json::{json, Value};

use crate::{settings::AppSettingsStore, websocket_transport::rfc3339_now, HttpResponse};

pub const MAX_DOCUMENT_BYTES: u64 = 2 * 1024 * 1024;
const MAX_PIPELINES: usize = 256;
static DOCUMENT_LOCK: Mutex<()> = Mutex::new(());
type DocumentResult<T> = Result<T, (u16, String)>;

fn invalid(message: impl Into<String>) -> (u16, String) {
    (400, message.into())
}
fn storage(error: impl std::fmt::Display) -> (u16, String) {
    (500, error.to_string())
}

fn read_document(path: &Path) -> DocumentResult<Value> {
    let metadata = fs::symlink_metadata(path).map_err(|error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            (404, "Document not found".into())
        } else {
            storage(error)
        }
    })?;
    if !metadata.is_file() || metadata.file_type().is_symlink() {
        return Err(invalid(
            "Document must be a regular file, not a symbolic link",
        ));
    }
    let mut bytes = Vec::new();
    fs::File::open(path)
        .map_err(storage)?
        .take(MAX_DOCUMENT_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(storage)?;
    if bytes.len() as u64 > MAX_DOCUMENT_BYTES {
        return Err((413, "Document exceeds the 2 MiB limit".into()));
    }
    let document: Value = serde_json::from_slice(&bytes).map_err(storage)?;
    if !document.is_object() {
        return Err(storage("Document must be a JSON object"));
    }
    Ok(document)
}

fn write_document(path: &Path, document: &Value, replace: bool) -> DocumentResult<()> {
    if fs::symlink_metadata(path).is_ok_and(|metadata| metadata.file_type().is_symlink()) {
        return Err(invalid("Refusing to replace a symbolic link"));
    }
    let bytes = serde_json::to_vec_pretty(document).map_err(storage)?;
    if bytes.len() as u64 > MAX_DOCUMENT_BYTES {
        return Err((413, "Document exceeds the 2 MiB limit".into()));
    }
    AtomicFile::new(
        path,
        if replace {
            AllowOverwrite
        } else {
            DisallowOverwrite
        },
    )
    .write(|file| {
        file.write_all(&bytes)?;
        file.sync_all()
    })
    .map_err(storage)
}

fn request(body: &[u8]) -> DocumentResult<Value> {
    let value: Value =
        serde_json::from_slice(body).map_err(|_| invalid("Expected a JSON object"))?;
    if !value.is_object() {
        return Err(invalid("Expected a JSON object"));
    }
    Ok(value)
}

fn string<'a>(value: &'a Value, key: &str) -> DocumentResult<&'a str> {
    value
        .get(key)
        .and_then(Value::as_str)
        .filter(|text| !text.trim().is_empty())
        .ok_or_else(|| invalid(format!("{key} must be a nonempty string")))
}

fn catalogue(settings: &AppSettingsStore) -> DocumentResult<Value> {
    match read_document(&settings.config_dir().join("dataset_links.json")) {
        Err((404, _)) => Ok(json!({"schema_version": 2, "datasets": [], "groups": []})),
        value => value,
    }
}

fn save_catalogue(settings: &AppSettingsStore, catalogue: &Value) -> DocumentResult<()> {
    fs::create_dir_all(settings.config_dir()).map_err(storage)?;
    write_document(
        &settings.config_dir().join("dataset_links.json"),
        catalogue,
        true,
    )
}

fn link_dataset(settings: &AppSettingsStore, body: &[u8]) -> DocumentResult<Value> {
    let request = request(body)?;
    let requested_path = Path::new(string(&request, "path")?);
    if !requested_path.is_absolute() {
        return Err(invalid("Dataset path must be absolute"));
    }
    let path = requested_path
        .canonicalize()
        .map_err(|_| invalid("Dataset path does not exist"))?;
    let metadata = fs::metadata(&path).map_err(storage)?;
    if !metadata.is_dir() && !metadata.is_file() {
        return Err(invalid("Dataset must be a regular file or directory"));
    }
    let config = request
        .get("config")
        .filter(|value| !value.is_null())
        .cloned()
        .unwrap_or_else(|| json!({}));
    if !config.is_object() {
        return Err(invalid("Dataset config must be an object"));
    }
    let mut catalogue = catalogue(settings)?;
    let datasets = catalogue
        .get_mut("datasets")
        .and_then(Value::as_array_mut)
        .ok_or_else(|| storage("Invalid dataset catalogue"))?;
    if datasets
        .iter()
        .any(|dataset| dataset["path"] == json!(path))
    {
        return Err((409, "Dataset already linked".into()));
    }
    if datasets.len() >= 256 {
        return Err((413, "Dataset catalogue exceeds 256 records".into()));
    }
    let nonce = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(storage)?
        .as_nanos();
    let now = rfc3339_now();
    let dataset = json!({"id": format!("dataset_{}_{nonce}", std::process::id()),
        "path": path, "name": path.file_name().and_then(|name| name.to_str()).unwrap_or("Dataset"),
        "linked_at": now, "created_at": now, "config": config, "hash": "", "version": 1,
        "version_status": "unchecked", "last_verified": "", "stats": {}, "group_ids": [],
        "num_samples": null, "num_features": null, "train_samples": null, "test_samples": null,
        "targets": [], "default_target": null, "metadata_columns": [], "signal_types": []});
    datasets.push(dataset.clone());
    save_catalogue(settings, &catalogue)?;
    Ok(json!({"success": true, "dataset": dataset}))
}

fn dataset_record(
    settings: &AppSettingsStore,
    method: &str,
    id: &str,
    body: &[u8],
) -> DocumentResult<Value> {
    let mut catalogue = catalogue(settings)?;
    let datasets = catalogue
        .get_mut("datasets")
        .and_then(Value::as_array_mut)
        .ok_or_else(|| storage("Invalid dataset catalogue"))?;
    let index = datasets
        .iter()
        .position(|dataset| dataset["id"] == id)
        .ok_or_else(|| (404, "Dataset not found".into()))?;
    if method == "GET" {
        return Ok(json!({"dataset": datasets[index]}));
    }
    if method == "DELETE" {
        datasets.remove(index);
        save_catalogue(settings, &catalogue)?;
        return Ok(json!({"success": true}));
    }
    let update = request(body)?;
    let dataset = &mut datasets[index];
    for field in [
        "name",
        "description",
        "default_target",
        "task_type",
        "signal_types",
    ] {
        if let Some(value) = update.get(field) {
            dataset[field] = value.clone();
        }
    }
    if let Some(config) = update.get("config") {
        let updates = config
            .as_object()
            .ok_or_else(|| invalid("Dataset config must be an object"))?;
        let current = dataset["config"]
            .as_object_mut()
            .ok_or_else(|| storage("Stored dataset config is invalid"))?;
        current.extend(updates.clone());
    }
    string(dataset, "name")?;
    let response = json!({"success": true, "dataset": dataset});
    save_catalogue(settings, &catalogue)?;
    Ok(response)
}

fn workspace(settings: &AppSettingsStore) -> DocumentResult<Option<Value>> {
    let Some(linked) = settings
        .active_linked_workspace_response()
        .map_err(storage)?
    else {
        return Ok(None);
    };
    let path = Path::new(string(&linked, "path")?);
    let mut document = match read_document(&path.join("workspace.json")) {
        Err((404, _)) => json!({}),
        result => result?,
    };
    let datasets = catalogue(settings)?;
    document["path"] = linked["path"].clone();
    document["name"] = linked["name"].clone();
    if document.get("created_at").is_none() {
        document["created_at"] = linked["linked_at"].clone();
    }
    document["datasets"] = datasets
        .get("datasets")
        .cloned()
        .unwrap_or_else(|| json!([]));
    document["groups"] = datasets.get("groups").cloned().unwrap_or_else(|| json!([]));
    Ok(Some(document))
}

fn active_path(settings: &AppSettingsStore) -> DocumentResult<PathBuf> {
    let access = settings
        .active_linked_workspace_access()
        .map_err(storage)?
        .ok_or_else(|| (409, "No workspace selected".into()))?;
    access.path().canonicalize().map_err(storage)
}

fn ensure_directory(workspace: &Path, relative: &str) -> DocumentResult<()> {
    let mut directory = workspace.to_path_buf();
    for component in relative.split('/') {
        directory.push(component);
        match fs::symlink_metadata(&directory) {
            Ok(metadata) if metadata.is_dir() && !metadata.file_type().is_symlink() => {}
            Ok(_) => {
                return Err(invalid(
                    "Workspace subdirectories must not be symbolic links or files",
                ))
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                fs::create_dir(&directory).map_err(storage)?;
            }
            Err(error) => return Err(storage(error)),
        }
    }
    Ok(())
}

fn list_workspaces(settings: &AppSettingsStore) -> DocumentResult<Value> {
    let mut result = settings.linked_workspaces_response().map_err(storage)?;
    if let Some(workspaces) = result["workspaces"].as_array_mut() {
        for workspace in workspaces {
            workspace["created_at"] = workspace["linked_at"].clone();
            workspace["last_accessed"] = workspace
                .get("last_scanned")
                .filter(|value| !value.is_null())
                .unwrap_or_else(|| &workspace["linked_at"])
                .clone();
        }
    }
    Ok(result)
}

fn create_workspace(settings: &AppSettingsStore, body: &[u8]) -> DocumentResult<Value> {
    let request = request(body)?;
    let path = Path::new(string(&request, "path")?);
    let name = string(&request, "name")?;
    if !path.is_absolute() {
        return Err(invalid("Workspace path must be absolute"));
    }
    if request
        .get("create_dir")
        .is_some_and(|value| !value.is_boolean())
    {
        return Err(invalid("create_dir must be a boolean"));
    }
    if request
        .get("create_dir")
        .and_then(Value::as_bool)
        .unwrap_or(true)
    {
        fs::create_dir_all(path).map_err(storage)?;
    }
    if !path.is_dir() {
        return Err(invalid("Workspace path is not an existing directory"));
    }
    let path = path.canonicalize().map_err(storage)?;
    if path.join("workspace.json").try_exists().map_err(storage)? {
        return Err((409, "Workspace already exists at this path".into()));
    }
    let now = rfc3339_now();
    let document = json!({"path": path, "name": name, "description": request.get("description"),
        "created_at": now, "last_accessed": now, "datasets": [], "pipelines": [], "groups": []});
    for directory in [
        "runs",
        "exports",
        "library/templates",
        "library/trained",
        "results",
        "pipelines",
        "models",
        "predictions",
    ] {
        ensure_directory(&path, directory)?;
    }
    write_document(&path.join("workspace.json"), &document, false)?;
    settings
        .register_workspace(&path, name, &now, false)
        .map_err(storage)?;
    let mut response = document;
    response["num_datasets"] = json!(0);
    response["num_pipelines"] = json!(0);
    Ok(response)
}

fn select_workspace(settings: &AppSettingsStore, body: &[u8]) -> DocumentResult<Value> {
    let request = request(body)?;
    let path = Path::new(string(&request, "path")?);
    if !path.is_absolute() || !path.is_dir() {
        return Err(invalid(
            "Workspace path must be an existing absolute directory",
        ));
    }
    let config = match read_document(&path.join("workspace.json")) {
        Err((404, _)) => json!({}),
        result => result?,
    };
    let name = config
        .get("name")
        .and_then(Value::as_str)
        .unwrap_or_else(|| {
            path.file_name()
                .and_then(|name| name.to_str())
                .unwrap_or("Workspace")
        });
    settings
        .register_workspace(path, name, &rfc3339_now(), true)
        .map_err(storage)?;
    Ok(json!({"success": true, "workspace": workspace(settings)?}))
}

fn pipeline_directory(settings: &AppSettingsStore) -> DocumentResult<PathBuf> {
    let workspace = active_path(settings)?;
    let directory = workspace.join("pipelines");
    ensure_directory(&workspace, "pipelines")?;
    if directory.canonicalize().map_err(storage)? != directory {
        return Err(invalid("Pipeline directory must not be a symbolic link"));
    }
    Ok(directory)
}

fn list_pipelines(settings: &AppSettingsStore) -> DocumentResult<Value> {
    let mut pipelines = Vec::new();
    let mut warnings = Vec::new();
    let mut examined = 0;
    for entry in fs::read_dir(pipeline_directory(settings)?).map_err(storage)? {
        let path = entry.map_err(storage)?.path();
        if path
            .extension()
            .is_some_and(|extension| extension == "json")
        {
            if examined >= MAX_PIPELINES {
                return Err((413, "Pipeline catalogue exceeds 256 documents".into()));
            }
            examined += 1;
            match read_document(&path) {
                Ok(document) => pipelines.push(document),
                Err((_, detail)) => warnings.push(json!({"file": path.file_name().and_then(|name| name.to_str()), "detail": detail})),
            }
        }
    }
    pipelines.sort_by(|left, right| {
        right["updated_at"]
            .as_str()
            .cmp(&left["updated_at"].as_str())
    });
    Ok(json!({"pipelines": pipelines, "warnings": warnings}))
}

fn valid_identifier(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 256
        && id != "."
        && id != ".."
        && id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"._-".contains(&byte))
}

fn save_pipeline(
    settings: &AppSettingsStore,
    id: Option<&str>,
    body: &[u8],
) -> DocumentResult<Value> {
    let update = request(body)?;
    let directory = pipeline_directory(settings)?;
    let nonce = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(storage)?
        .as_nanos();
    let generated = format!("pipeline_{}_{nonce}", std::process::id());
    let key = id.unwrap_or(&generated);
    let file = directory.join(format!("{key}.json"));
    let now = rfc3339_now();
    let mut document = if id.is_some() {
        read_document(&file)?
    } else {
        json!({"id": key, "created_at": now, "description": "", "category": "custom", "is_favorite": false})
    };
    for field in [
        "name",
        "description",
        "category",
        "task_type",
        "steps",
        "is_favorite",
    ] {
        if let Some(value) = update.get(field) {
            document[field] = value.clone();
        }
    }
    string(&document, "name")?;
    let steps = document
        .get("steps")
        .and_then(Value::as_array)
        .ok_or_else(|| invalid("steps must be an array"))?;
    if steps.iter().any(|step| !step.is_object()) {
        return Err(invalid("Every editor step must be an object"));
    }
    // Preserve all editor fields, including branches, generators and finetuning.
    // Semantic/numerical validation belongs to the canonical library at execution.
    document["updated_at"] = json!(now);
    write_document(&file, &document, id.is_some())?;
    Ok(json!({"success": true, "pipeline": document}))
}

fn dispatch(
    settings: &AppSettingsStore,
    method: &str,
    path: &str,
    body: &[u8],
) -> Option<DocumentResult<Value>> {
    Some(match (method, path) {
        ("GET", "/api/workspace") => workspace(settings).map(|workspace| json!({"datasets": workspace.as_ref().map_or_else(|| json!([]), |workspace| workspace["datasets"].clone()), "workspace": workspace})),
        ("POST", "/api/workspace/create") => create_workspace(settings, body),
        ("POST", "/api/workspace/select") => select_workspace(settings, body),
        ("POST", "/api/workspace/reload") => workspace(settings).map(|workspace| json!({"success": workspace.is_some(), "message": "Workspace configuration reloaded from disk", "workspace": workspace})),
        ("GET", "/api/workspace/list") => list_workspaces(settings),
        ("GET", "/api/workspace/groups") => catalogue(settings).map(|catalogue| json!({"groups": catalogue.get("groups").cloned().unwrap_or_else(|| json!([]))})),
        ("GET", "/api/pipelines") => list_pipelines(settings),
        ("POST", "/api/pipelines") => save_pipeline(settings, None, body),
        ("GET", "/api/datasets") => catalogue(settings).map(|catalogue| json!({
            "total": catalogue["datasets"].as_array().map_or(0, Vec::len),
            "datasets": catalogue["datasets"], "groups": catalogue.get("groups").cloned().unwrap_or_else(|| json!([]))
        })),
        ("POST", "/api/datasets/link") => link_dataset(settings, body),
        _ => {
            if let Some(id) = path.strip_prefix("/api/datasets/") {
                if valid_identifier(id) && ["GET", "PUT", "DELETE"].contains(&method)
                    && !["link", "preview", "detect-unified", "detect-files", "detect-format", "detect-files-list", "scan-folder", "auto-detect", "validate-files"].contains(&id) {
                    return Some(dataset_record(settings, method, id, body));
                }
                return None;
            }
            let id = path.strip_prefix("/api/pipelines/")?;
            if !valid_identifier(id) || ["presets", "samples", "import", "import-preview", "render-canonical", "propagate-shape"].contains(&id) { return None; }
            match method {
                "GET" => pipeline_directory(settings).and_then(|directory| read_document(&directory.join(format!("{id}.json")))).map(|pipeline| json!({"pipeline": pipeline})),
                "PUT" => save_pipeline(settings, Some(id), body),
                "DELETE" => pipeline_directory(settings).and_then(|directory| {
                    let path = directory.join(format!("{id}.json"));
                    read_document(&path)?;
                    fs::remove_file(path).map_err(storage)?;
                    Ok(json!({"success": true}))
                }),
                _ => return None,
            }
        }
    })
}

pub fn route(
    settings: &AppSettingsStore,
    method: &str,
    path: &str,
    body: &[u8],
) -> Option<HttpResponse> {
    if !owns_path(path) {
        return None;
    }
    let _guard = DOCUMENT_LOCK
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    dispatch(settings, method, path, body).map(|result| match result {
        Ok(value) => HttpResponse::json(200, value.to_string()),
        Err((status, detail)) => HttpResponse::json(status, json!({"detail": detail}).to_string()),
    })
}

pub fn owns_path(path: &str) -> bool {
    matches!(
        path,
        "/api/workspace"
            | "/api/workspace/create"
            | "/api/workspace/select"
            | "/api/workspace/reload"
            | "/api/workspace/list"
            | "/api/workspace/groups"
            | "/api/pipelines"
            | "/api/datasets"
    ) || path.starts_with("/api/pipelines/")
        || path.starts_with("/api/datasets/")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{route_request_with_body, SidecarState};

    #[test]
    fn real_http_links_dataset_and_preserves_config_across_restart_without_deleting_source() {
        use std::{
            net::{TcpListener, TcpStream},
            sync::Arc,
        };
        let root = tempfile::tempdir().unwrap();
        let config = root.path().join("config");
        let workspace = root.path().join("workspace");
        let dataset_path = root.path().join("Xtrain.csv");
        fs::write(&dataset_path, "x1;x2\n1;2\n3;4\n").unwrap();
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let state = Arc::new(Mutex::new(SidecarState::with_app_settings_dir(&config)));
        let server = std::thread::spawn(move || {
            for _ in 0..5 {
                let (stream, _) = listener.accept().unwrap();
                crate::handle_connection_with_limits(
                    stream,
                    &state,
                    crate::ServerLimits::default(),
                )
                .unwrap();
            }
        });
        let http = |method: &str, path: &str, body: &Value| {
            let body = body.to_string();
            let mut stream = TcpStream::connect(address).unwrap();
            stream
                .set_read_timeout(Some(std::time::Duration::from_secs(5)))
                .unwrap();
            write!(stream, "{method} {path} HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{body}", body.len()).unwrap();
            let mut response = String::new();
            stream.read_to_string(&mut response).unwrap();
            assert!(response.starts_with("HTTP/1.1 200"), "{response}");
            serde_json::from_str::<Value>(response.split_once("\r\n\r\n").unwrap().1).unwrap()
        };
        http(
            "POST",
            "/api/workspace/create",
            &json!({"path": workspace, "name": "HTTP workspace"}),
        );
        http("POST", "/api/workspace/select", &json!({"path": workspace}));
        let dataset_config = json!({"files": [{"path": dataset_path, "type": "X", "split": "train", "overrides": {"delimiter": ";"}}], "default_target": "protein"});
        let linked = http(
            "POST",
            "/api/datasets/link",
            &json!({"path": dataset_path, "config": dataset_config}),
        );
        assert_eq!(
            http("GET", "/api/datasets", &json!({}))["datasets"][0]["config"],
            dataset_config
        );
        let id = linked["dataset"]["id"].as_str().unwrap();
        http(
            "PUT",
            &format!("/api/datasets/{id}"),
            &json!({"name": "Renamed spectra", "config": {"task_type": "regression"}}),
        );
        server.join().unwrap();
        let mut restarted = SidecarState::with_app_settings_dir(&config);
        let loaded = call(
            &mut restarted,
            "GET",
            &format!("/api/datasets/{id}"),
            json!({}),
        );
        assert_eq!(
            loaded.1["dataset"]["config"]["files"],
            dataset_config["files"]
        );
        assert_eq!(loaded.1["dataset"]["name"], "Renamed spectra");
        assert_eq!(loaded.1["dataset"]["version_status"], "unchecked");
        assert_eq!(
            call(
                &mut restarted,
                "DELETE",
                &format!("/api/datasets/{id}"),
                json!({})
            )
            .0,
            200
        );
        assert!(dataset_path.exists(), "Unlink must never delete user data");
        assert_eq!(
            call(&mut restarted, "GET", "/api/datasets", json!({})).1["total"],
            0
        );
    }

    fn call(state: &mut SidecarState, method: &str, path: &str, body: Value) -> (u16, Value) {
        let encoded = body.to_string().into_bytes();
        drop(body);
        let response = route_request_with_body(state, method, path, &encoded);
        (
            response.status,
            serde_json::from_str(&response.body).unwrap(),
        )
    }

    #[test]
    fn workspace_create_select_and_general_editor_documents_survive_restart() {
        let root = tempfile::tempdir().unwrap();
        let config = root.path().join("config");
        let workspace = root.path().join("workspace");
        let mut state = SidecarState::with_app_settings_dir(&config);
        assert_eq!(
            call(&mut state, "GET", "/api/workspace", json!({})).1["workspace"],
            Value::Null
        );
        assert_eq!(call(&mut state, "GET", "/api/pipelines", json!({})).0, 409);
        let request = json!({"path": workspace, "name": "Parity workspace", "description": "Preserved description"});
        assert_eq!(
            call(&mut state, "POST", "/api/workspace/create", request.clone()).0,
            200
        );
        assert_eq!(
            call(&mut state, "POST", "/api/workspace/create", request).0,
            409
        );
        assert_eq!(
            call(
                &mut state,
                "POST",
                "/api/workspace/select",
                json!({"path": workspace, "persist_global": true})
            )
            .0,
            200
        );
        let steps = json!([
            {"id": "branch", "type": "branch", "branches": [[{"type": "preprocessing", "classPath": "sklearn.preprocessing.StandardScaler"}]], "generator": {"_or_": [1, 2]}},
            {"id": "model", "type": "model", "name": "PLSRegression", "params": {"n_components": 2}, "finetune": {"n_components": [1, 2]}}
        ]);
        let (status, created) = call(
            &mut state,
            "POST",
            "/api/pipelines",
            json!({"name": "General editor pipeline", "steps": steps}),
        );
        assert_eq!(status, 200, "{created}");
        let id = created["pipeline"]["id"].as_str().unwrap();
        let pipeline_route = format!("/api/pipelines/{id}");
        let mut restarted = SidecarState::with_app_settings_dir(&config);
        let current = call(&mut restarted, "GET", "/api/workspace", json!({})).1;
        assert_eq!(current["workspace"]["name"], "Parity workspace");
        assert_eq!(current["workspace"]["description"], "Preserved description");
        let loaded = call(&mut restarted, "GET", &pipeline_route, json!({})).1;
        assert_eq!(loaded["pipeline"]["steps"], steps);
        let updated = call(
            &mut restarted,
            "PUT",
            &pipeline_route,
            json!({"name": "Renamed", "is_favorite": true}),
        );
        assert_eq!(updated.0, 200);
        assert_eq!(updated.1["pipeline"]["steps"], steps);
        assert_eq!(
            call(&mut restarted, "GET", "/api/pipelines", json!({})).1["pipelines"][0]["name"],
            "Renamed"
        );
        assert_eq!(
            call(&mut restarted, "DELETE", &pipeline_route, json!({})).0,
            200
        );
        assert_eq!(
            call(&mut restarted, "GET", &pipeline_route, json!({})).0,
            404
        );
        assert!(
            !workspace.join("store.sqlite").exists(),
            "Studio must not synthesize a scientific Store"
        );
    }

    #[test]
    fn malformed_edits_and_path_traversal_leave_pipeline_untouched() {
        let root = tempfile::tempdir().unwrap();
        let mut state = SidecarState::with_app_settings_dir(root.path().join("config"));
        let workspace = root.path().join("workspace");
        call(
            &mut state,
            "POST",
            "/api/workspace/create",
            json!({"path": workspace, "name": "Test"}),
        );
        call(
            &mut state,
            "POST",
            "/api/workspace/select",
            json!({"path": workspace}),
        );
        let (_, created) = call(
            &mut state,
            "POST",
            "/api/pipelines",
            json!({"name": "Original", "steps": []}),
        );
        let id = created["pipeline"]["id"].as_str().unwrap();
        let path = format!("/api/pipelines/{id}");
        assert_eq!(call(&mut state, "PUT", &path, json!({"steps": [1]})).0, 400);
        assert_eq!(
            call(&mut state, "GET", &path, json!({})).1["pipeline"]["name"],
            "Original"
        );
        for path in [
            "/api/pipelines/../workspace",
            "/api/pipelines/%2e%2e",
            "/api/pipelines/..",
        ] {
            assert_ne!(call(&mut state, "DELETE", path, json!({})).0, 200);
        }
        assert!(workspace.join("workspace.json").exists());
        fs::write(workspace.join("pipelines/damaged.json"), "not JSON").unwrap();
        let listed = call(&mut state, "GET", "/api/pipelines", json!({}));
        assert_eq!(listed.0, 200);
        assert_eq!(listed.1["pipelines"].as_array().unwrap().len(), 1);
        assert_eq!(listed.1["warnings"].as_array().unwrap().len(), 1);
        #[cfg(unix)]
        {
            let external = root.path().join("external.json");
            fs::write(&external, b"{\"name\":\"external\"}").unwrap();
            std::os::unix::fs::symlink(&external, workspace.join("pipelines/linked.json")).unwrap();
            assert_eq!(
                call(&mut state, "DELETE", "/api/pipelines/linked", json!({})).0,
                400
            );
            assert!(external.exists());
        }
    }

    #[test]
    fn network_preserves_route_specific_prediction_and_document_budgets() {
        use std::net::{TcpListener, TcpStream};
        for path in [
            "/api/predict/archive-v2",
            "/api/pipelines",
            "/api/app/settings",
        ] {
            let listener = TcpListener::bind("127.0.0.1:0").unwrap();
            let address = listener.local_addr().unwrap();
            let reader = std::thread::spawn(move || {
                let (mut stream, _) = listener.accept().unwrap();
                crate::read_http_request(&mut stream, std::time::Duration::from_secs(5))
            });
            let body = json!({"wide_payload": "x".repeat(70_000)}).to_string();
            let mut stream = TcpStream::connect(address).unwrap();
            let _ = write!(stream, "POST {path} HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{body}", body.len());
            drop(stream);
            let result = reader.join().unwrap();
            if path == "/api/app/settings" {
                assert!(matches!(
                    result,
                    Err(crate::RequestReadError::BodyTooLarge { .. })
                ));
            } else {
                assert_eq!(result.unwrap().body.len(), body.len());
            }
        }
    }
}
