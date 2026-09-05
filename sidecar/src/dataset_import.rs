//! Dataset uploads persist bytes only. Configuration and scientific metadata
//! are produced by the attested library, outside the global sidecar lock.
use crate::{
    dataset_inspection::DatasetInspection, prediction_upload::multipart_parts,
    scientific_request_resolver::ScientificRequestResolver, settings::AppSettingsStore,
    workspace_documents, HttpRequest, HttpResponse, SidecarState,
};
use nirs4all_io::materialize::LoadLimits;
use serde_json::{json, Value};
use std::{
    collections::BTreeMap,
    fs,
    io::Write,
    path::Path,
    sync::{Arc, Mutex},
};

pub const MAX_UPLOAD_BYTES: usize = 64 * 1024 * 1024;
const MAX_FILES: usize = 256;

struct ImportError(u16, String);
impl From<String> for ImportError {
    fn from(value: String) -> Self {
        Self(400, value)
    }
}
impl From<&str> for ImportError {
    fn from(value: &str) -> Self {
        Self(400, value.into())
    }
}
impl From<(u16, String)> for ImportError {
    fn from((status, detail): (u16, String)) -> Self {
        Self(status, detail)
    }
}

pub fn owns_path(path: &str) -> bool {
    matches!(
        path,
        "/api/datasets/upload" | "/api/datasets/preview-upload" | "/api/datasets/link"
    ) || path
        .strip_prefix("/api/datasets/")
        .and_then(|tail| tail.split_once('/'))
        .is_some_and(|(id, operation)| !id.is_empty() && operation == "refresh")
}

pub fn route(state: &Arc<Mutex<SidecarState>>, request: &HttpRequest) -> Option<HttpResponse> {
    if !owns_path(&request.path) {
        return None;
    }
    if request.method != "POST" {
        return Some(crate::method_not_allowed(
            &request.method,
            &request.path,
            "POST",
        ));
    }
    let (settings, host) = {
        let state = state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        (state.app_settings.clone(), state.scientific_host.clone())
    };
    // Offline catalogue linking remains possible, with explicitly unknown
    // metadata. A configured-but-invalid host never falls back to that path.
    if host.is_none() && request.path == "/api/datasets/link" {
        return None;
    }
    Some(handle(&settings, request, &|operation, payload| {
        host.as_ref()
            .ok_or("No attested scientific runtime configured")?
            .adapt_document(operation, payload)
    }))
}

fn object(bytes: &[u8]) -> Result<Value, String> {
    if bytes.len() > 2 * 1024 * 1024 {
        return Err("Dataset metadata exceeds 2 MiB".into());
    }
    let value: Value = serde_json::from_slice(bytes).map_err(|error| error.to_string())?;
    if !value.is_object() {
        return Err("Dataset metadata must be an object".into());
    }
    Ok(value)
}

fn filename(value: &str) -> Result<(), String> {
    if value.is_empty()
        || value.len() > 255
        || value == "."
        || value == ".."
        || value.contains(['/', '\\', ':'])
        || value.chars().any(char::is_control)
        || value.ends_with(['.', ' '])
    {
        return Err("Upload filename must be a bounded plain filename".into());
    }
    Ok(())
}

struct Upload<'a> {
    document: Value,
    files: BTreeMap<String, &'a [u8]>,
}

fn parse(request: &HttpRequest) -> Result<Upload<'_>, String> {
    let mut document = None;
    for (key, value) in
        url::form_urlencoded::parse(request.query.as_deref().unwrap_or("").as_bytes())
    {
        if key != "metadata" || document.is_some() {
            return Err("Unexpected or duplicate upload query".into());
        }
        document = Some(object(value.as_bytes())?);
    }
    let content_type = request
        .headers
        .get("content-type")
        .ok_or("Upload content type is missing")?;
    let mut files = BTreeMap::new();
    let mut names = std::collections::BTreeSet::new();
    for part in multipart_parts(content_type, &request.body, MAX_UPLOAD_BYTES, MAX_FILES + 1)? {
        if part.name == "metadata" && part.filename.is_none() && document.is_none() {
            document = Some(object(part.payload)?);
        } else if part.name == "files" {
            let name = part.filename.ok_or("Upload filename is missing")?;
            filename(&name)?;
            if !names.insert(name.to_lowercase())
                || part.payload.is_empty()
                || files.len() >= MAX_FILES
            {
                return Err("Dataset upload requires unique nonempty files".into());
            }
            files.insert(name, part.payload);
        } else {
            return Err("Unexpected or duplicate upload field".into());
        }
    }
    if files.is_empty() {
        return Err("No dataset files uploaded".into());
    }
    Ok(Upload {
        document: document.ok_or("Dataset upload metadata is missing")?,
        files,
    })
}

fn materialize(upload: &Upload<'_>, root: &Path, config: &mut Value) -> Result<(), String> {
    let files = config["files"]
        .as_array_mut()
        .filter(|files| !files.is_empty() && files.len() <= MAX_FILES)
        .ok_or("Dataset upload requires selected file roles")?;
    let mut selected = std::collections::BTreeSet::new();
    for file in files {
        let name = file["path"]
            .as_str()
            .ok_or("Selected file requires a filename")?
            .to_owned();
        filename(&name)?;
        if !upload.files.contains_key(&name) {
            return Err(format!("Selected file was not uploaded: {name}"));
        }
        selected.insert(name.clone());
        file["path"] = json!(root.join(name));
    }
    if selected.len() != upload.files.len() {
        return Err("Upload includes unselected files".into());
    }
    // All names and references were checked before opening any destination.
    for (name, bytes) in &upload.files {
        let mut file = fs::OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(root.join(name))
            .map_err(|error| error.to_string())?;
        file.write_all(bytes)
            .and_then(|()| file.sync_all())
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn inspect(
    root: &Path,
    config: &Value,
    max_samples: usize,
    adapt: &impl Fn(&str, &Value) -> Result<Value, String>,
) -> Result<Value, String> {
    let mut config = config.clone();
    ScientificRequestResolver::confine_dataset_config(&mut config, root)
        .map_err(|error| format!("{error:?}"))?;
    let result = DatasetInspection::new(
        root,
        LoadLimits {
            max_file_bytes: 256 * 1024 * 1024,
            max_total_bytes: 512 * 1024 * 1024,
            ..LoadLimits::default()
        },
    )?
    .preview(&config, max_samples, adapt)?;
    if result["success"] != true {
        return Err(result["error"]
            .as_str()
            .unwrap_or("Dataset inspection failed")
            .into());
    }
    Ok(result)
}

fn import_parent(settings: &AppSettingsStore) -> Result<std::path::PathBuf, String> {
    let workspace = workspace_documents::active_path(settings).map_err(|(_, error)| error)?;
    let parent = workspace.join("imports");
    match fs::symlink_metadata(&parent) {
        Ok(info) if info.is_dir() && !info.file_type().is_symlink() => {}
        Ok(_) => return Err("Workspace imports must be a real directory".into()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            fs::create_dir(&parent).map_err(|error| error.to_string())?;
        }
        Err(error) => return Err(error.to_string()),
    }
    Ok(parent)
}

fn upload(
    settings: &AppSettingsStore,
    request: &HttpRequest,
    adapt: &impl Fn(&str, &Value) -> Result<Value, String>,
) -> Result<Value, ImportError> {
    let upload = parse(request)?;
    let preview = request.path.ends_with("preview-upload");
    let allowed: &[&str] = if preview {
        &["files", "parsing", "max_samples"]
    } else {
        &["config", "max_samples"]
    };
    if upload.document.as_object().is_none_or(|fields| {
        fields
            .keys()
            .any(|field| !allowed.contains(&field.as_str()))
    }) {
        return Err("Unknown dataset upload metadata field".into());
    }
    let directory = if preview {
        tempfile::Builder::new().prefix("studio-preview-").tempdir()
    } else {
        tempfile::Builder::new()
            .prefix("dataset-")
            .tempdir_in(import_parent(settings)?)
    }
    .map_err(|error| error.to_string())?;
    let root = directory
        .path()
        .canonicalize()
        .map_err(|error| error.to_string())?;
    let mut config = if preview {
        let mut config = upload
            .document
            .get("parsing")
            .cloned()
            .unwrap_or_else(|| json!({}));
        if !config.is_object() {
            return Err("Dataset parsing must be an object".into());
        }
        config["files"] = upload.document["files"].clone();
        config
    } else {
        upload.document["config"].clone()
    };
    materialize(&upload, &root, &mut config)?;
    let max = upload.document.get("max_samples").map_or(Ok(5), |value| {
        value
            .as_u64()
            .and_then(|value| usize::try_from(value).ok())
            .ok_or("max_samples must be a positive integer")
    })?;
    let inspection = inspect(&root, &config, max, adapt)?;
    if preview {
        return Ok(inspection);
    }
    let result = workspace_documents::link_inspected_dataset(
        settings,
        &serde_json::to_vec(&json!({"path":root,"config":config}))
            .map_err(|error| error.to_string())?,
        &inspection,
    )
    .map_err(ImportError::from)?;
    // The catalogue now refers to these exact paths. Only newly created files
    // become durable; failed imports and previews are removed by TempDir.
    let _persisted = directory.keep();
    Ok(result)
}

fn link(
    settings: &AppSettingsStore,
    request: &HttpRequest,
    adapt: &impl Fn(&str, &Value) -> Result<Value, String>,
) -> Result<Value, ImportError> {
    if request.query.is_some() {
        return Err("Dataset link/refresh does not accept query fields".into());
    }
    let refresh_id = request
        .path
        .strip_prefix("/api/datasets/")
        .and_then(|tail| tail.strip_suffix("/refresh"));
    let record = match refresh_id {
        Some(id) => workspace_documents::linked_dataset(settings, id)?,
        None => object(&request.body)?,
    };
    let path = Path::new(record["path"].as_str().ok_or("Dataset path is missing")?);
    if !path.is_absolute() {
        return Err("Dataset path must be absolute".into());
    }
    let path = path.canonicalize().map_err(|error| error.to_string())?;
    let root = if path.is_dir() {
        path.as_path()
    } else {
        path.parent().ok_or("Dataset has no parent directory")?
    };
    let mut config = record
        .get("config")
        .filter(|value| !value.is_null())
        .cloned()
        .unwrap_or_else(|| json!({}));
    if config.as_object().is_some_and(serde_json::Map::is_empty) && path.is_file() {
        config = json!({"train_x":path});
    }
    let inspection = inspect(root, &config, 5, adapt)?;
    refresh_id
        .map_or_else(
            || workspace_documents::link_inspected_dataset(settings, &request.body, &inspection),
            |id| workspace_documents::refresh_inspected_dataset(settings, id, &record, &inspection),
        )
        .map_err(ImportError::from)
}

fn handle(
    settings: &AppSettingsStore,
    request: &HttpRequest,
    adapt: &impl Fn(&str, &Value) -> Result<Value, String>,
) -> HttpResponse {
    let result = if request.path.ends_with("upload") {
        upload(settings, request, adapt)
    } else {
        link(settings, request, adapt)
    };
    match result {
        Ok(value) => HttpResponse::json(200, value.to_string()),
        Err(ImportError(status, detail)) => {
            HttpResponse::json(status, json!({"detail":detail}).to_string())
        }
    }
}

#[cfg(test)]
#[path = "dataset_import_tests.rs"]
mod tests;
