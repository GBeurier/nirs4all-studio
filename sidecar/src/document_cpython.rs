//! Attested pure document translations within the selected library runtime.

use std::{collections::BTreeSet, fs, path::Path};

use serde_json::{json, Value};
use sha2::{Digest, Sha256};

pub const REQUEST_SCHEMA: &str = "nirs4all.studio-document-request.v1";
pub const RESPONSE_SCHEMA: &str = "nirs4all.studio-document-response.v1";
pub const MAX_DOCUMENT_BYTES: usize = 2 * 1024 * 1024;
pub const MAX_BATCH_BYTES: usize = 8 * 1024 * 1024;
pub const MAX_INSPECTION_BYTES: usize = 32 * 1024 * 1024;
pub const MAX_PREDICTION_BYTES: usize = 32 * 1024 * 1024;
const MANIFEST: &str = include_str!("../contracts/studio_document_adapters_v1.json");
const PACKAGE: &str = "studio_document_adapters";

pub fn route(
    settings: &crate::settings::AppSettingsStore,
    host: Option<&crate::scientific_cpython::CpythonScientificJobExecutor>,
    method: &str,
    path: &str,
    body: &[u8],
) -> Option<crate::HttpResponse> {
    if matches!(
        (method, path),
        ("GET", "/api/models/available") | ("POST", "/api/predict")
    ) {
        return Some(route_prediction(settings, host, method, body));
    }
    if method != "POST" {
        return None;
    }
    let operation = match path {
        "/api/pipelines/import-preview" | "/api/pipelines/import" => "pipeline.import",
        "/api/pipelines/render-canonical" => "pipeline.render",
        _ => return None,
    };
    if body.len() > MAX_DOCUMENT_BYTES {
        return Some(crate::HttpResponse::json(
            413,
            json!({"detail":"Document exceeds 2 MiB"}).to_string(),
        ));
    }
    let Some(host) = host else {
        return Some(crate::HttpResponse::json(
            503,
            json!({"detail":"Attested document library host unavailable"}).to_string(),
        ));
    };
    let payload = match serde_json::from_slice::<Value>(body) {
        Ok(value) if value.is_object() => value,
        _ => {
            return Some(crate::HttpResponse::json(
                400,
                json!({"detail":"Expected a JSON document"}).to_string(),
            ))
        }
    };
    match host.adapt_document(operation, &payload) {
        Ok(mut value) if path == "/api/pipelines/import" => {
            value.as_object_mut()?.remove("success");
            Some(crate::workspace_documents::route(
                settings,
                "POST",
                "/api/pipelines",
                value.to_string().as_bytes(),
            )?)
        }
        Ok(value) => Some(crate::HttpResponse::json(200, value.to_string())),
        Err(detail) => Some(crate::HttpResponse::json(
            400,
            json!({"detail":detail}).to_string(),
        )),
    }
}

fn route_prediction(
    settings: &crate::settings::AppSettingsStore,
    host: Option<&crate::scientific_cpython::CpythonScientificJobExecutor>,
    method: &str,
    body: &[u8],
) -> crate::HttpResponse {
    let error = |status, detail: String| {
        crate::HttpResponse::json(status, json!({"detail":detail}).to_string())
    };
    let Some(host) = host else {
        return error(503, "Attested scientific library host unavailable".into());
    };
    let workspace = match crate::workspace_documents::active_path(settings) {
        Ok(path) => path,
        Err((status, detail)) => return error(status, detail),
    };
    let adapt = |operation: &str, payload: &Value| host.adapt_document(operation, payload);
    let (operation, payload) = if method == "GET" {
        (
            "predictions.catalogue",
            crate::general_prediction::catalogue_payload(&workspace),
        )
    } else {
        if body.len() > MAX_PREDICTION_BYTES {
            return error(413, "Prediction request exceeds 32 MiB".into());
        }
        let request = match serde_json::from_slice::<Value>(body) {
            Ok(value) if value.is_object() => value,
            _ => return error(400, "Expected a prediction request object".into()),
        };
        (
            "predictions.run",
            crate::general_prediction::prediction_payload(
                &workspace,
                &request,
                &|id| crate::workspace_documents::linked_dataset(settings, id),
                &adapt,
            ),
        )
    };
    match payload.and_then(|payload| adapt(operation, &payload)) {
        Ok(result) => crate::HttpResponse::json(200, result.to_string()),
        Err(detail) => error(400, detail),
    }
}

pub fn route_prediction_upload(
    settings: &crate::settings::AppSettingsStore,
    host: Option<&crate::scientific_cpython::CpythonScientificJobExecutor>,
    content_type: &str,
    body: &[u8],
) -> crate::HttpResponse {
    let error = |status, detail: String| {
        crate::HttpResponse::json(status, json!({"detail":detail}).to_string())
    };
    let Some(host) = host else {
        return error(503, "Attested scientific library host unavailable".into());
    };
    let workspace = match crate::workspace_documents::active_path(settings) {
        Ok(path) => path,
        Err((status, detail)) => return error(status, detail),
    };
    let upload = match crate::prediction_upload::parse(content_type, body) {
        Ok(upload) => upload,
        Err(detail) => return error(400, detail),
    };
    let result =
        crate::general_prediction::file_payload(&workspace, &upload.fields, upload.file.path())
            .and_then(|payload| host.adapt_document("predictions.file", &payload));
    // The upload is held until the synchronous library returns, then removed
    // on either success or failure by the private temporary-file owner.
    match result {
        Ok(value) => crate::HttpResponse::json(200, value.to_string()),
        Err(detail) => error(400, detail),
    }
}

pub fn request(operation: &str, payload: &Value) -> Result<Value, String> {
    if !matches!(
        operation,
        "pipeline.normalize"
            | "config.compare"
            | "pipeline.import"
            | "pipeline.render"
            | "dataset.configure"
            | "documents.batch"
            | "dataset.preview"
            | "dataset.stats"
            | "dataset.inspect_format"
            | "predictions.catalogue"
            | "predictions.run"
            | "predictions.file"
    ) {
        return Err("Unsupported document operation".into());
    }
    if !payload.is_object() {
        return Err("Document payload must be an object".into());
    }
    if operation == "documents.batch" {
        let members = payload
            .get("requests")
            .and_then(Value::as_array)
            .ok_or("Invalid document batch")?;
        if payload.as_object().is_none_or(|object| object.len() != 1)
            || members.is_empty()
            || members.len() > 128
            || members.iter().any(|member| {
                member.as_object().is_none_or(|object| object.len() != 2)
                    || !matches!(
                        member["operation"].as_str(),
                        Some("pipeline.normalize" | "dataset.configure")
                    )
                    || !member["payload"].is_object()
                    || member["payload"].to_string().len() > MAX_DOCUMENT_BYTES
            })
        {
            return Err("Document batch must contain only bounded normalization requests".into());
        }
    }
    Ok(
        json!({"schema": REQUEST_SCHEMA, "job_id": "document-translation", "operation": operation, "payload": payload}),
    )
}

pub fn validate_response(value: &Value) -> bool {
    let Some(root) = value.as_object() else {
        return false;
    };
    if root.len() != 5
        || root.get("schema").and_then(Value::as_str) != Some(RESPONSE_SCHEMA)
        || root.get("job_id").and_then(Value::as_str) != Some("document-translation")
        || !root.contains_key("result")
        || !root.contains_key("error")
    {
        return false;
    }
    match root.get("success").and_then(Value::as_bool) {
        Some(true) => root["error"].is_null(),
        Some(false) => {
            root["result"].is_null()
                && root["error"]
                    .as_str()
                    .is_some_and(|error| error.len() <= 4096)
        }
        None => false,
    }
}

/// Verify source bytes against the manifest compiled into this Rust sidecar,
/// in addition to the enclosing full-runtime closure attestation.
pub fn verify(site_packages: &Path) -> Result<(), String> {
    let root = site_packages.join(PACKAGE);
    if fs::symlink_metadata(&root)
        .map_err(|error| error.to_string())?
        .file_type()
        .is_symlink()
    {
        return Err("Document adapter package is a symlink".into());
    }
    let manifest: Value = serde_json::from_str(MANIFEST).map_err(|error| error.to_string())?;
    let files = manifest["files"]
        .as_array()
        .ok_or("Invalid compiled adapter manifest")?;
    let mut expected = BTreeSet::new();
    for file in files {
        let relative = file["path"].as_str().ok_or("Invalid adapter path")?;
        if relative
            .split('/')
            .any(|part| part.is_empty() || part == "." || part == "..")
        {
            return Err("Unsafe compiled adapter path".into());
        }
        let mut path = root.clone();
        for part in relative.split('/') {
            path.push(part);
            if fs::symlink_metadata(&path)
                .map_err(|error| error.to_string())?
                .file_type()
                .is_symlink()
            {
                return Err("Document adapter member is a symlink".into());
            }
        }
        let metadata = fs::metadata(&path).map_err(|error| error.to_string())?;
        if !metadata.is_file()
            || Some(metadata.len()) != file["size"].as_u64()
            || metadata.len() > 64 * 1024 * 1024
        {
            return Err("Document adapter size/type differs".into());
        }
        let bytes = fs::read(&path).map_err(|error| error.to_string())?;
        if Some(format!("{:x}", Sha256::digest(bytes)).as_str()) != file["sha256"].as_str() {
            return Err("Document adapter content differs".into());
        }
        expected.insert(relative.to_owned());
    }
    let mut actual = BTreeSet::new();
    let mut pending = vec![root.clone()];
    while let Some(directory) = pending.pop() {
        for entry in fs::read_dir(directory).map_err(|error| error.to_string())? {
            let entry = entry.map_err(|error| error.to_string())?;
            let kind = entry.file_type().map_err(|error| error.to_string())?;
            if kind.is_dir() {
                pending.push(entry.path());
            } else if kind.is_file() {
                let member = entry
                    .path()
                    .strip_prefix(&root)
                    .map_err(|error| error.to_string())?
                    .to_string_lossy()
                    .replace('\\', "/");
                actual.insert(member);
            } else {
                return Err("Document adapter special member refused".into());
            }
        }
    }
    if actual != expected {
        return Err("Document adapter inventory differs".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn document_protocol_refuses_unknown_operations_and_open_response_shapes() {
        assert!(request("pipeline.normalize", &json!({"steps": []})).is_ok());
        assert!(request("run", &json!({})).is_err());
        assert!(request(
            "documents.batch",
            &json!({"requests":[{"operation":"pipeline.normalize","payload":{"steps":[]}}]})
        )
        .is_ok());
        for payload in [
            json!({"requests":[]}),
            json!({"requests":[{"operation":"documents.batch","payload":{}}]}),
            json!({"requests":[{"operation":"pipeline.import","payload":{}}]}),
        ] {
            assert!(request("documents.batch", &payload).is_err());
        }
        let mut response = json!({"schema": RESPONSE_SCHEMA, "job_id": "document-translation", "success": true, "result": {}, "error": null});
        assert!(validate_response(&response));
        response["extra"] = json!(true);
        assert!(!validate_response(&response));
        response.as_object_mut().unwrap().remove("extra");
        response["error"] = json!("inconsistent");
        assert!(!validate_response(&response));
    }

    #[test]
    fn compiled_adapter_manifest_refuses_tampering_and_unlisted_modules() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path().join(PACKAGE);
        let source = Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap();
        let manifest: Value = serde_json::from_str(MANIFEST).unwrap();
        for member in manifest["files"].as_array().unwrap() {
            let relative = member["path"].as_str().unwrap();
            let destination = root.join(relative);
            fs::create_dir_all(destination.parent().unwrap()).unwrap();
            let bytes = if relative.ends_with("__init__.py") {
                b"\"\"\"Pure document translation package; no HTTP or application state.\"\"\"\n"
                    .to_vec()
            } else {
                fs::read(source.join(relative)).unwrap()
            };
            fs::write(destination, bytes).unwrap();
        }
        verify(directory.path()).unwrap();
        let extra = root.join("api/unlisted.py");
        fs::write(&extra, b"pass\n").unwrap();
        assert!(verify(directory.path())
            .unwrap_err()
            .contains("inventory differs"));
        fs::remove_file(extra).unwrap();
        fs::write(root.join("api/library_documents.py"), b"pass\n").unwrap();
        assert!(verify(directory.path())
            .unwrap_err()
            .contains("size/type differs"));
    }
}
