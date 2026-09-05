//! Product request/source authorization for captured general-model inference.
//!
//! The portable Archive V2 route remains separate. This module never parses a
//! numerical dataset or deserializes a model; the attested library owns both.

use std::{
    collections::BTreeSet,
    io::Read,
    path::{Component, Path, PathBuf},
};

use cap_std::{ambient_authority, fs::Dir};
use nirs4all_io::core::infer::describe::describe_text;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use crate::scientific_request_resolver::ScientificRequestResolver;

const MAX_ENTRIES: usize = 10000;
const MAX_ARCHIVE_BYTES: u64 = 512 * 1024 * 1024;
const MAX_CATALOGUE_MODEL_BYTES: u64 = 8 * 1024 * 1024 * 1024;

fn text<'a>(value: &'a Value, key: &str) -> Result<&'a str, String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty() && value.len() <= 1024 && !value.contains('\0'))
        .ok_or_else(|| format!("{key} must be a nonempty bounded string"))
}

fn root(path: &Path) -> Result<PathBuf, String> {
    let path = path.canonicalize().map_err(|error| error.to_string())?;
    if !path.is_dir() {
        return Err("Selected workspace is not a directory".into());
    }
    Ok(path)
}

fn archive_record(workspace: &Path, relative: &Path) -> Result<Value, String> {
    let parts: Vec<_> = relative.components().collect();
    if parts.is_empty()
        || parts
            .iter()
            .any(|part| !matches!(part, Component::Normal(_)))
        || !(relative.starts_with("exports") || relative.starts_with("workspace/exports"))
        || relative.extension().and_then(|value| value.to_str()) != Some("n4a")
    {
        return Err("Model bundle must identify a file within workspace exports".into());
    }
    let directory =
        Dir::open_ambient_dir(workspace, ambient_authority()).map_err(|error| error.to_string())?;
    let metadata = directory
        .symlink_metadata(relative)
        .map_err(|error| error.to_string())?;
    if !metadata.is_file()
        || metadata.file_type().is_symlink()
        || metadata.len() > MAX_ARCHIVE_BYTES
    {
        return Err("Model bundle is not a regular bounded archive".into());
    }
    // Read through a capability-confined handle and hash incrementally. Python
    // must verify this fingerprint on its own immutable snapshot before pickle.
    let mut file = directory
        .open(relative)
        .map_err(|error| error.to_string())?
        .take(MAX_ARCHIVE_BYTES + 1);
    let mut hash = Sha256::new();
    let mut buffer = vec![0_u8; 65536];
    let mut size = 0_u64;
    loop {
        let count = file.read(&mut buffer).map_err(|error| error.to_string())?;
        if count == 0 {
            break;
        }
        size += u64::try_from(count).map_err(|_| "Archive byte count overflow")?;
        if size > MAX_ARCHIVE_BYTES {
            return Err("Model archive exceeds byte budget".into());
        }
        hash.update(&buffer[..count]);
    }
    Ok(json!({"id":relative.to_string_lossy().replace('\\',"/"),
        "path":workspace.join(relative),"size":size,"fingerprint":format!("sha256:{:x}",hash.finalize())}))
}

/// Prepare a bounded catalogue of authorized exports without loading models.
pub fn catalogue_payload(workspace: &Path) -> Result<Value, String> {
    let workspace = root(workspace)?;
    let directory = Dir::open_ambient_dir(&workspace, ambient_authority())
        .map_err(|error| error.to_string())?;
    let mut pending = vec![PathBuf::from("exports"), PathBuf::from("workspace/exports")];
    let mut visited = BTreeSet::new();
    let mut exports = Vec::new();
    let mut entries = 0_usize;
    let mut total = 0_u64;
    while let Some(relative) = pending.pop() {
        if !directory.exists(&relative) {
            continue;
        }
        let child = directory
            .open_dir(&relative)
            .map_err(|error| error.to_string())?;
        for entry in child.entries().map_err(|error| error.to_string())? {
            entries += 1;
            if entries > MAX_ENTRIES {
                return Err("Model catalogue exceeds directory-entry budget".into());
            }
            let entry = entry.map_err(|error| error.to_string())?;
            let path = relative.join(entry.file_name());
            let kind = entry.file_type().map_err(|error| error.to_string())?;
            if kind.is_dir() {
                pending.push(path);
            } else if path.extension().and_then(|value| value.to_str()) == Some("n4a")
                && visited.insert(path.clone())
            {
                let record = archive_record(&workspace, &path)?;
                total += record["size"].as_u64().ok_or("Invalid archive size")?;
                if total > MAX_CATALOGUE_MODEL_BYTES {
                    return Err("Model catalogue exceeds aggregate byte budget".into());
                }
                exports.push(record);
            }
        }
    }
    Ok(json!({"workspace_path":workspace,"exports":exports}))
}

fn model_payload(workspace: &Path, request: &Value) -> Result<Value, String> {
    if request
        .get("engine")
        .is_some_and(|value| !value.is_null() && value != "dag-ml")
        || request
            .get("allow_fallback")
            .is_some_and(|value| value != false)
    {
        return Err("General prediction requires its explicit DAG host profile; no native or legacy fallback".into());
    }
    let workspace = root(workspace)?;
    let id = text(request, "model_id")?;
    let source = text(request, "model_source")?;
    let mut payload = json!({"workspace_path":workspace,"model_id":id,"model_source":source});
    match source {
        "chain" => {
            if id.len() > 256 || id.contains(['/', '\\']) || id == ".." {
                return Err("Invalid workspace chain id".into());
            }
        }
        "bundle" => {
            let record = archive_record(&workspace, Path::new(id))?;
            if request
                .get("archive_fingerprint")
                .is_some_and(|expected| expected != &record["fingerprint"])
            {
                return Err("Model archive changed after catalogue selection".into());
            }
            payload["bundle_path"] = record["path"].clone();
            payload["archive_fingerprint"] = record["fingerprint"].clone();
        }
        _ => return Err("Unknown general model source".into()),
    }
    if let Some(index) = request.get("output_index") {
        if index.as_u64().is_none_or(|index| index > 1024) {
            return Err("Invalid target output_index".into());
        }
        payload["output_index"] = index.clone();
    }
    Ok(payload)
}

/// Resolve one array or linked dataset before invoking scientific prediction.
pub fn prediction_payload(
    workspace: &Path,
    request: &Value,
    dataset_lookup: &impl Fn(&str) -> Result<Value, String>,
    adapt: &impl Fn(&str, &Value) -> Result<Value, String>,
) -> Result<Value, String> {
    let fields = [
        "model_id",
        "model_source",
        "data_source",
        "dataset_id",
        "partition",
        "spectra",
        "engine",
        "allow_fallback",
        "archive_fingerprint",
        "output_index",
    ];
    if request
        .as_object()
        .is_none_or(|object| object.keys().any(|key| !fields.contains(&key.as_str())))
    {
        return Err("Unexpected prediction request fields".into());
    }
    let mut payload = model_payload(workspace, request)?;
    let source = text(request, "data_source")?;
    payload["data_source"] = json!(source);
    match source {
        "array" => {
            let rows = request["spectra"]
                .as_array()
                .filter(|rows| !rows.is_empty())
                .ok_or("Nonempty spectra matrix required")?;
            let width = rows[0].as_array().map_or(0, Vec::len);
            if width == 0
                || rows
                    .len()
                    .checked_mul(width)
                    .is_none_or(|cells| cells > crate::matrix_limits::MAX_PREDICTION_CELLS)
                || rows.iter().any(|row| {
                    row.as_array().is_none_or(|row| {
                        row.len() != width
                            || row
                                .iter()
                                .any(|value| value.as_f64().is_none_or(|value| !value.is_finite()))
                    })
                })
            {
                return Err(
                    "Spectra must be finite rectangular values within the cell budget".into(),
                );
            }
            payload["spectra"] = request["spectra"].clone();
        }
        "dataset" => {
            let id = text(request, "dataset_id")?;
            let mut record = dataset_lookup(id)?;
            if record["id"] != id {
                return Err("Dataset catalogue identity mismatch".into());
            }
            let directory = root(Path::new(text(&record, "path")?))?;
            ScientificRequestResolver::confine_dataset_config(&mut record["config"], &directory)
                .map_err(|error| format!("{error:?}"))?;
            let mut config = adapt("dataset.configure", &json!({"record":record}))?;
            ScientificRequestResolver::confine_dataset_config(&mut config, &directory)
                .map_err(|error| format!("{error:?}"))?;
            let partition = request
                .get("partition")
                .and_then(Value::as_str)
                .unwrap_or("all");
            if !matches!(partition, "train" | "val" | "test" | "all") {
                return Err("Invalid prediction partition".into());
            }
            payload["config"] = config;
            payload["partition"] = json!(partition);
        }
        _ => return Err("Unknown general prediction data source".into()),
    }
    Ok(payload)
}

/// The caller owns multipart decoding, bounded upload lifetime and path authority.
pub fn file_payload(
    workspace: &Path,
    fields: &Value,
    authorized_upload: &Path,
) -> Result<Value, String> {
    let allowed = [
        "model_id",
        "model_source",
        "engine",
        "allow_fallback",
        "archive_fingerprint",
        "output_index",
        "has_header",
    ];
    if fields
        .as_object()
        .is_none_or(|object| object.keys().any(|key| !allowed.contains(&key.as_str())))
    {
        return Err("Unexpected uploaded prediction fields".into());
    }
    let mut payload = model_payload(workspace, fields)?;
    let path = authorized_upload
        .canonicalize()
        .map_err(|error| error.to_string())?;
    if !path.is_file() {
        return Err("Prediction upload must be a regular file".into());
    }
    payload["data_source"] = json!("file");
    // Format selection happens before execution. Delimiter/header inference
    // belongs to IO, not a Studio CSV parser or a retry loop after failure.
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    let mut params = if matches!(extension.as_str(), "csv" | "tsv" | "txt") {
        let mut prefix = Vec::new();
        std::fs::File::open(&path)
            .map_err(|error| error.to_string())?
            .take(65536)
            .read_to_end(&mut prefix)
            .map_err(|error| error.to_string())?;
        let description = describe_text(&String::from_utf8_lossy(&prefix), 50);
        json!({"delimiter":description.delimiter.to_string(),
            "decimal_separator":description.decimal_separator.to_string(),
            "has_header":description.has_header,"header_unit":description.header_unit})
    } else {
        json!({})
    };
    if let Some(header) = fields.get("has_header") {
        if !header.is_boolean() {
            return Err("has_header must be a boolean".into());
        }
        params["has_header"] = header.clone();
    }
    payload["file_path"] = json!(path);
    payload["params"] = params;
    payload["partition"] = json!("all");
    Ok(payload)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn admits_150_by_300_and_refuses_ambiguous_or_nonfinite_input_before_host() {
        let root = tempfile::tempdir().unwrap();
        let request = json!({"model_id":"chain1","model_source":"chain","data_source":"array","spectra":vec![vec![1.0;300];150]});
        let lookup = |_: &str| panic!("array request consulted dataset catalogue");
        let adapt = |_: &str, _: &Value| panic!("array request invoked a document host");
        assert_eq!(
            prediction_payload(root.path(), &request, &lookup, &adapt).unwrap()["spectra"],
            request["spectra"]
        );
        for patch in [
            json!({"engine":"native"}),
            json!({"allow_fallback":true}),
            json!({"spectra":[[1],[1,2]]}),
            json!({"spectra":[[null]]}),
            json!({"workspace_path":"/"}),
        ] {
            let mut invalid = request.clone();
            invalid
                .as_object_mut()
                .unwrap()
                .extend(patch.as_object().unwrap().clone());
            assert!(prediction_payload(root.path(), &invalid, &lookup, &adapt).is_err());
        }
    }

    #[test]
    fn catalogue_and_prediction_bind_same_export_bytes_without_model_parser() {
        let root = tempfile::tempdir().unwrap();
        std::fs::create_dir(root.path().join("exports")).unwrap();
        let path = root.path().join("exports/fitted.n4a");
        std::fs::write(&path, b"opaque model bytes").unwrap();
        let catalogue = catalogue_payload(root.path()).unwrap();
        let record = &catalogue["exports"][0];
        let request = json!({"model_id":record["id"],"model_source":"bundle","archive_fingerprint":record["fingerprint"]});
        assert_eq!(
            model_payload(root.path(), &request).unwrap()["archive_fingerprint"],
            record["fingerprint"]
        );
        std::fs::write(path, b"different model").unwrap();
        assert!(model_payload(root.path(), &request).is_err());
        for id in [
            "../outside.n4a",
            "/tmp/outside.n4a",
            "exports/../outside.n4a",
        ] {
            assert!(
                model_payload(root.path(), &json!({"model_id":id,"model_source":"bundle"}))
                    .is_err()
            );
        }
    }

    #[cfg(unix)]
    #[test]
    fn refuses_export_symlink_escaping_workspace() {
        let root = tempfile::tempdir().unwrap();
        let outside = tempfile::NamedTempFile::new().unwrap();
        std::fs::create_dir(root.path().join("exports")).unwrap();
        std::os::unix::fs::symlink(outside.path(), root.path().join("exports/link.n4a")).unwrap();
        assert!(catalogue_payload(root.path()).is_err());
    }

    #[test]
    fn dataset_paths_are_confined_before_and_after_document_adaptation() {
        let root = tempfile::tempdir().unwrap();
        let data = tempfile::tempdir().unwrap();
        let outside = tempfile::NamedTempFile::new().unwrap();
        std::fs::write(data.path().join("X.csv"), b"1,2\n3,4\n").unwrap();
        let request = json!({"model_id":"chain1","model_source":"chain",
            "data_source":"dataset","dataset_id":"linked","partition":"test"});
        let record = json!({"id":"linked","path":data.path(),"config":{"train_x":"X.csv"}});
        let adapt = |operation: &str, input: &Value| {
            assert_eq!(operation, "dataset.configure");
            Ok(input["record"]["config"].clone())
        };
        let result =
            prediction_payload(root.path(), &request, &|_| Ok(record.clone()), &adapt).unwrap();
        assert_eq!(
            result["config"]["train_x"],
            json!(data.path().join("X.csv"))
        );
        assert_eq!(result["partition"], "test");
        let escaped = json!({"train_x":outside.path()});
        assert!(
            prediction_payload(root.path(), &request, &|_| Ok(record.clone()), &|_, _| Ok(
                escaped.clone()
            ))
            .is_err()
        );
        let mut unsafe_record = record;
        unsafe_record["config"] = escaped;
        assert!(prediction_payload(
            root.path(),
            &request,
            &|_| Ok(unsafe_record.clone()),
            &|_, _| panic!("unsafe input reached document adapter")
        )
        .is_err());
    }

    #[test]
    fn upload_csv_description_is_inferred_by_io_before_execution() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("upload.csv");
        std::fs::write(&path, b"sample;band_a;band_b\na;1.5;2.5\nb;3.5;4.5\n").unwrap();
        let payload = file_payload(
            root.path(),
            &json!({"model_id":"chain1","model_source":"chain"}),
            &path,
        )
        .unwrap();
        assert_eq!(payload["data_source"], "file");
        assert_eq!(payload["file_path"], json!(path));
        assert_eq!(payload["params"]["delimiter"], ";");
        assert_eq!(payload["params"]["has_header"], true);
        assert!(payload.get("spectra").is_none());
    }

    #[test]
    fn numeric_spectral_headers_have_an_explicit_user_override() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("spectra.csv");
        std::fs::write(&path, b"sample;1100;1102\na;1.5;2.5\nb;3.5;4.5\n").unwrap();
        let fields = json!({"model_id":"chain1","model_source":"chain","has_header":true});
        let payload = file_payload(root.path(), &fields, &path).unwrap();
        assert_eq!(payload["params"]["has_header"], true);
        let mut invalid = fields;
        invalid["has_header"] = json!("yes");
        assert!(file_payload(root.path(), &invalid, &path).is_err());
    }
}
