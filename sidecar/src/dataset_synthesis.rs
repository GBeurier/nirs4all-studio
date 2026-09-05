//! Synthetic dataset presets and Rust-owned generation orchestration.

use crate::{
    scientific_cpython::LibraryFacadeError, settings::AppSettingsStore, HttpRequest, HttpResponse,
    SidecarState,
};
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::{SystemTime, UNIX_EPOCH},
};

const PRESETS: &str = include_str!("../../api/synthetic_datasets.json");
const REQUEST_SCHEMA: &str = "nirs4all.studio-synthetic-dataset-job.v1";
const RESPONSE_SCHEMA: &str = "nirs4all.studio-synthetic-dataset-result.v1";
const MAX_REQUEST_BYTES: usize = 65_536;
const EXPECTED_FILES: [&str; 4] = ["Xcal.csv", "Xval.csv", "Ycal.csv", "Yval.csv"];

pub fn owns_path(path: &str) -> bool {
    matches!(
        path,
        "/api/datasets/synthetic-presets" | "/api/datasets/generate-synthetic"
    )
}

pub fn route(state: &Arc<Mutex<SidecarState>>, request: &HttpRequest) -> Option<HttpResponse> {
    if !owns_path(&request.path) {
        return None;
    }
    if request.path == "/api/datasets/synthetic-presets" {
        if request.method != "GET" {
            return Some(crate::method_not_allowed(
                &request.method,
                &request.path,
                "GET",
            ));
        }
        if request.query.is_some() {
            return Some(HttpResponse::json(
                400,
                r#"{"detail":"Synthetic presets do not accept query fields"}"#,
            ));
        }
        return Some(HttpResponse::json(200, PRESETS));
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
    Some(handle(&settings, request, &|document| {
        host.as_ref().map_or_else(
            || {
                Err(LibraryFacadeError {
                    code: "host_unavailable".into(),
                    message: "Attested synthetic dataset library host unavailable".into(),
                })
            },
            |host| host.invoke_library_facade(document),
        )
    }))
}

fn handle(
    settings: &AppSettingsStore,
    request: &HttpRequest,
    invoke: &impl Fn(&Value) -> Result<Value, LibraryFacadeError>,
) -> HttpResponse {
    let error =
        |status, detail: String| HttpResponse::json(status, json!({"detail":detail}).to_string());
    let prepared = match prepare_request(request) {
        Ok(value) => value,
        Err((status, detail)) => return error(status, detail),
    };
    let workspace = match crate::workspace_documents::active_path(settings) {
        Ok(path) => path,
        Err((status, detail)) => return error(status, detail),
    };
    let output_root = match ensure_output_root(&workspace) {
        Ok(path) => path,
        Err((status, detail)) => return error(status, detail),
    };
    let stage = match tempfile::Builder::new()
        .prefix(".synthetic-stage-")
        .tempdir_in(&output_root)
    {
        Ok(stage) => stage,
        Err(cause) => return error(500, cause.to_string()),
    };
    let request_document = json!({
        "schema":REQUEST_SCHEMA,
        "operation":"generate",
        "request_id":prepared.request_id,
        "output_dir":stage.path(),
        "payload":prepared.payload,
    });
    let response = match invoke(&request_document) {
        Ok(value) => value,
        Err(failure) => return error(facade_error_status(&failure.code), failure.message),
    };
    let generated = match verify_generated_response(&response, &prepared.request_id, stage.path()) {
        Ok(value) => value,
        Err(detail) => return error(500, detail),
    };
    let final_path = output_root.join(&generated.name);
    if fs::symlink_metadata(&final_path).is_ok() {
        return error(409, "Synthetic dataset name already exists".into());
    }
    if let Err(cause) = fs::rename(&generated.staged_path, &final_path) {
        return error(
            if fs::symlink_metadata(&final_path).is_ok() {
                409
            } else {
                500
            },
            cause.to_string(),
        );
    }
    let canonical = match final_path.canonicalize() {
        Ok(path) if path.starts_with(&output_root) => path,
        _ => {
            return error(
                500,
                "Generated dataset escaped its workspace boundary".into(),
            )
        }
    };

    let (linked, dataset_id, link_error) = if prepared.auto_link {
        link_generated_dataset(settings, &canonical, &generated)
    } else {
        (false, Value::Null, None)
    };
    let mut summary = json!({
        "task_type":generated.summary["task"],
        "n_samples":generated.summary["samples"],
        "complexity":generated.generation["complexity"],
        "train_ratio":generated.generation["train_ratio"],
        "n_classes":generated.summary["classes"],
        "target_range":prepared.payload.get("target_range").cloned().unwrap_or(Value::Null),
        "wavelength_range":generated.generation["wavelength_range"],
        "generated_at":crate::websocket_transport::rfc3339_now(),
        "num_features":generated.summary["features"],
        "train_samples":generated.summary["train"],
        "test_samples":generated.summary["test"],
    });
    if let Some(detail) = link_error {
        summary["link_error"] = json!(detail);
    }
    HttpResponse::json(
        200,
        json!({
            "success":true,
            "dataset_id":dataset_id,
            "name":generated.name,
            "path":canonical,
            "summary":summary,
            "linked":linked,
            "message":format!("Synthetic dataset '{}' generated successfully{}", generated.name, if linked { " and linked" } else { "" }),
        })
        .to_string(),
    )
}

fn link_generated_dataset(
    settings: &AppSettingsStore,
    canonical: &Path,
    generated: &GeneratedDataset,
) -> (bool, Value, Option<String>) {
    let config = canonical_dataset_config(canonical);
    let inspection = trusted_inspection(&generated.summary);
    let link_body = json!({"path":canonical,"name":generated.name,"config":config});
    match crate::workspace_documents::link_inspected_dataset(
        settings,
        link_body.to_string().as_bytes(),
        &inspection,
    ) {
        Ok(value) => (true, value["dataset"]["id"].clone(), None),
        Err((_, detail)) => (false, Value::Null, Some(detail)),
    }
}

struct PreparedRequest {
    payload: Map<String, Value>,
    auto_link: bool,
    request_id: String,
}

fn prepare_request(request: &HttpRequest) -> Result<PreparedRequest, (u16, String)> {
    if request.query.is_some() {
        return Err((
            400,
            "Synthetic generation does not accept query fields".into(),
        ));
    }
    if request.body.len() > MAX_REQUEST_BYTES {
        return Err((413, "Synthetic generation request exceeds 64 KiB".into()));
    }
    let Ok(Value::Object(mut payload)) = serde_json::from_slice::<Value>(&request.body) else {
        return Err((400, "Expected a synthetic generation object".into()));
    };
    let auto_link = match payload.remove("auto_link") {
        None => true,
        Some(Value::Bool(value)) => value,
        Some(_) => return Err((400, "auto_link must be boolean".into())),
    };
    if payload.contains_key("random_state") {
        return Err((400, "random_state is owned by Studio".into()));
    }
    let allowed = BTreeSet::from([
        "task_type",
        "n_samples",
        "complexity",
        "n_classes",
        "target_range",
        "train_ratio",
        "wavelength_range",
        "name",
    ]);
    let unknown = payload
        .keys()
        .filter(|key| !allowed.contains(key.as_str()))
        .cloned()
        .collect::<Vec<_>>();
    if !unknown.is_empty() {
        return Err((
            400,
            format!(
                "Unsupported synthetic generation fields: {}",
                unknown.join(", ")
            ),
        ));
    }
    for required in ["task_type", "n_samples", "complexity"] {
        if !payload.contains_key(required) {
            return Err((
                400,
                format!("Missing synthetic generation field: {required}"),
            ));
        }
    }
    payload.entry("train_ratio").or_insert_with(|| json!(0.8));
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|cause| (500, cause.to_string()))?
        .as_nanos();
    let random_state =
        u64::try_from(nonce & u128::from(u32::MAX)).map_err(|cause| (500, cause.to_string()))?;
    payload.insert("random_state".into(), json!(random_state));
    Ok(PreparedRequest {
        payload,
        auto_link,
        request_id: format!("synthetic-{}-{nonce}", std::process::id()),
    })
}

fn facade_error_status(code: &str) -> u16 {
    match code {
        "host_unavailable" | "runtime_contract_tampered" | "python_host_spawn_failed" => 503,
        "output_exists" => 409,
        "request_too_large" | "response_too_large" | "resource_limit" => 413,
        "generation_failed" => 500,
        _ => 400,
    }
}

fn ensure_output_root(workspace: &Path) -> Result<PathBuf, (u16, String)> {
    let mut current = workspace.to_path_buf();
    for component in ["datasets", "synthetic"] {
        current.push(component);
        match fs::symlink_metadata(&current) {
            Ok(metadata) if metadata.is_dir() && !metadata.file_type().is_symlink() => {}
            Ok(_) => {
                return Err((
                    400,
                    "Synthetic dataset directory is not a real directory".into(),
                ))
            }
            Err(cause) if cause.kind() == std::io::ErrorKind::NotFound => {
                fs::create_dir(&current).map_err(|error| (500, error.to_string()))?;
            }
            Err(cause) => return Err((500, cause.to_string())),
        }
    }
    current
        .canonicalize()
        .map_err(|error| (500, error.to_string()))
}

struct GeneratedDataset {
    name: String,
    staged_path: PathBuf,
    summary: Value,
    generation: Value,
}

fn verify_generated_response(
    response: &Value,
    request_id: &str,
    stage: &Path,
) -> Result<GeneratedDataset, String> {
    let root = exact_object(response, &["schema", "request_id", "result"])?;
    if root["schema"] != RESPONSE_SCHEMA || root["request_id"] != request_id {
        return Err("Synthetic library returned the wrong response identity".into());
    }
    let result = exact_object(
        &root["result"],
        &["name", "relative_path", "files", "summary", "generation"],
    )?;
    let name = safe_name(&result["name"])?;
    if result["relative_path"].as_str() != Some(&name) {
        return Err("Synthetic library returned an unsafe relative path".into());
    }
    let summary = exact_object(
        &result["summary"],
        &["samples", "features", "train", "test", "task", "classes"],
    )?;
    let generation = exact_object(
        &result["generation"],
        &[
            "random_state",
            "complexity",
            "train_ratio",
            "wavelength_range",
        ],
    )?;
    if !valid_summary(summary, generation) {
        return Err("Synthetic library returned an invalid summary".into());
    }
    let staged_path = stage.join(&name);
    let metadata = fs::symlink_metadata(&staged_path).map_err(|error| error.to_string())?;
    if !metadata.is_dir() || metadata.file_type().is_symlink() {
        return Err("Synthetic library output is not a real directory".into());
    }
    let expected = declared_artifacts(&result["files"])?;
    let mut actual = BTreeSet::new();
    for entry in fs::read_dir(&staged_path).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let path = entry.path();
        let metadata = fs::symlink_metadata(&path).map_err(|error| error.to_string())?;
        let name = entry
            .file_name()
            .into_string()
            .map_err(|_| "Synthetic artifact name is not UTF-8")?;
        if !metadata.is_file()
            || metadata.file_type().is_symlink()
            || !EXPECTED_FILES.contains(&name.as_str())
        {
            return Err("Synthetic library output contains an unexpected member".into());
        }
        let (expected_bytes, expected_digest) = expected
            .get(name.as_str())
            .ok_or("Synthetic artifact was not declared")?;
        let bytes = fs::read(&path).map_err(|error| error.to_string())?;
        if u64::try_from(bytes.len()).ok() != Some(*expected_bytes)
            || format!("{:x}", Sha256::digest(bytes)) != *expected_digest
        {
            return Err("Synthetic artifact differs from its owner manifest".into());
        }
        actual.insert(name);
    }
    if actual != EXPECTED_FILES.into_iter().map(str::to_owned).collect() {
        return Err("Synthetic library output is incomplete".into());
    }
    Ok(GeneratedDataset {
        name,
        staged_path,
        summary: Value::Object(summary.clone()),
        generation: Value::Object(generation.clone()),
    })
}

fn valid_summary(summary: &Map<String, Value>, generation: &Map<String, Value>) -> bool {
    ["samples", "features", "train", "test"]
        .iter()
        .all(|key| summary[*key].is_u64())
        && matches!(
            summary["task"].as_str(),
            Some("regression" | "binary_classification" | "multiclass_classification")
        )
        && generation["random_state"].is_u64()
        && generation["train_ratio"]
            .as_f64()
            .is_some_and(f64::is_finite)
        && generation["wavelength_range"]
            .as_array()
            .is_some_and(|values| {
                values.len() == 2
                    && values
                        .iter()
                        .all(|value| value.as_f64().is_some_and(f64::is_finite))
            })
}

fn declared_artifacts(files: &Value) -> Result<BTreeMap<&str, (u64, &str)>, String> {
    let files = files
        .as_array()
        .filter(|values| values.len() == EXPECTED_FILES.len())
        .ok_or("Synthetic library returned the wrong artifact count")?;
    let mut expected = BTreeMap::new();
    for file in files {
        let fields = exact_object(file, &["path", "bytes", "sha256"])?;
        let path = fields["path"]
            .as_str()
            .filter(|path| EXPECTED_FILES.contains(path))
            .ok_or("Synthetic library returned an unexpected artifact")?;
        let bytes = fields["bytes"]
            .as_u64()
            .ok_or("Synthetic library returned an invalid artifact size")?;
        let digest = fields["sha256"]
            .as_str()
            .filter(|value| {
                value.len() == 64
                    && value
                        .bytes()
                        .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
            })
            .ok_or("Synthetic library returned an invalid artifact digest")?;
        if expected.insert(path, (bytes, digest)).is_some() {
            return Err("Synthetic library returned a duplicate artifact".into());
        }
    }
    Ok(expected)
}

fn exact_object<'a>(value: &'a Value, keys: &[&str]) -> Result<&'a Map<String, Value>, String> {
    let object = value.as_object().ok_or("Expected a JSON object")?;
    if object.len() != keys.len() || keys.iter().any(|key| !object.contains_key(*key)) {
        return Err("Library response contains unexpected fields".into());
    }
    Ok(object)
}

fn safe_name(value: &Value) -> Result<String, String> {
    value
        .as_str()
        .filter(|name| {
            !name.is_empty()
                && name.len() <= 128
                && !matches!(*name, "." | "..")
                && name.bytes().enumerate().all(|(index, byte)| {
                    byte.is_ascii_alphanumeric()
                        || (index > 0 && matches!(byte, b'.' | b'_' | b'-'))
                })
        })
        .map(str::to_owned)
        .ok_or_else(|| "Synthetic library returned an unsafe dataset name".into())
}

fn canonical_dataset_config(path: &Path) -> Value {
    json!({
        "train_x":path.join("Xcal.csv"),
        "train_y":path.join("Ycal.csv"),
        "test_x":path.join("Xval.csv"),
        "test_y":path.join("Yval.csv"),
        "global_params":{"delimiter":";","decimal_separator":".","has_header":true,"header_unit":"nm"},
    })
}

fn trusted_inspection(summary: &Value) -> Value {
    let task = summary["task"].as_str().unwrap_or_default();
    json!({
        "summary":{
            "num_samples":summary["samples"],
            "num_features":summary["features"],
            "train_samples":summary["train"],
            "test_samples":summary["test"],
            "n_sources":1,
            "has_targets":true,
            "has_metadata":false,
            "metadata_columns":[],
        },
        "target_distribution":{"type":if task == "regression" { "regression" } else { "classification" }},
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(body: &Value) -> HttpRequest {
        HttpRequest {
            method: "POST".into(),
            path: "/api/datasets/generate-synthetic".into(),
            query: None,
            headers: BTreeMap::new(),
            body: body.to_string().into_bytes(),
        }
    }

    #[test]
    fn six_historical_presets_have_closed_distinct_valid_documents() {
        let document: Value = serde_json::from_str(PRESETS).unwrap();
        let rows = document["presets"].as_array().unwrap();
        assert_eq!(rows.len(), 6);
        let mut ids = BTreeSet::new();
        for row in rows {
            assert_eq!(row.as_object().unwrap().len(), 7);
            assert!(ids.insert(row["id"].as_str().unwrap()));
            assert!((50..=10000).contains(&row["n_samples"].as_u64().unwrap()));
        }
        assert_eq!(rows[0]["n_samples"], 250);
        assert_eq!(rows[3]["task_type"], "binary_classification");
    }

    #[test]
    fn generation_confines_verifies_publishes_and_links_owner_artifacts() {
        let root = tempfile::tempdir().unwrap();
        let settings = AppSettingsStore::new(root.path().join("settings"));
        let workspace = root.path().join("workspace");
        for (path, body) in [
            (
                "/api/workspace/create",
                json!({"path":workspace,"name":"synthesis"}),
            ),
            ("/api/workspace/select", json!({"path":workspace})),
        ] {
            assert_eq!(
                crate::workspace_documents::route(
                    &settings,
                    "POST",
                    path,
                    body.to_string().as_bytes()
                )
                .unwrap()
                .status,
                200
            );
        }
        let response = handle(
            &settings,
            &request(
                &json!({"task_type":"regression","n_samples":50,"complexity":"simple","name":"verified"}),
            ),
            &|document| {
                assert_eq!(document["payload"]["train_ratio"], 0.8);
                assert!(document["payload"]["random_state"].is_u64());
                let output = Path::new(document["output_dir"].as_str().unwrap()).join("verified");
                fs::create_dir(&output).unwrap();
                let mut files = Vec::new();
                for name in EXPECTED_FILES {
                    let bytes = b"a;b\n1;2\n";
                    fs::write(output.join(name), bytes).unwrap();
                    files.push(json!({"path":name,"bytes":bytes.len(),"sha256":format!("{:x}",Sha256::digest(bytes))}));
                }
                Ok(
                    json!({"schema":RESPONSE_SCHEMA,"request_id":document["request_id"],"result":{
                        "name":"verified","relative_path":"verified","files":files,
                        "summary":{"samples":50,"features":2,"train":40,"test":10,"task":"regression","classes":null},
                        "generation":{"random_state":document["payload"]["random_state"],"complexity":"simple","train_ratio":0.8,"wavelength_range":[1000.0,2500.0]}
                    }}),
                )
            },
        );
        assert_eq!(response.status, 200, "{}", response.body);
        let body: Value = serde_json::from_str(&response.body).unwrap();
        assert_eq!(body["linked"], true);
        assert!(body["dataset_id"].as_str().unwrap().starts_with("dataset_"));
        assert_eq!(body["summary"]["num_features"], 2);
        assert!(workspace
            .join("datasets/synthetic/verified/Xcal.csv")
            .is_file());
    }

    #[test]
    fn generation_rejects_legacy_noop_fields_instead_of_silently_ignoring_them() {
        let root = tempfile::tempdir().unwrap();
        let settings = AppSettingsStore::new(root.path().join("settings"));
        let response = handle(
            &settings,
            &request(
                &json!({"task_type":"regression","n_samples":50,"complexity":"simple","noise_level":0.5}),
            ),
            &|_| panic!("invalid UI request must not reach Python"),
        );
        assert_eq!(response.status, 400);
        assert!(response.body.contains("noise_level"));
    }
}
