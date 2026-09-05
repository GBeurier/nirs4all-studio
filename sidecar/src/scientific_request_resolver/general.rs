//! General-library request construction. No matrix loading or numerical DSL.

use std::collections::{BTreeMap, BTreeSet};

use super::{
    canonical_directory, json, object_at, read_pipeline_with_limit, valid_identifier, Map, Path,
    PathBuf, ScientificRequestResolver, ScientificResolveError, ScientificSubmissionPreflight,
    Value,
};

const MAX_DOCUMENT_BYTES: usize = 2 * 1024 * 1024;
const MAX_GENERAL_BYTES: usize = 8 * 1024 * 1024;

pub(super) fn resolve(
    resolver: &ScientificRequestResolver,
    preflight: &ScientificSubmissionPreflight,
    adapt: impl Fn(&str, &Value) -> Result<Value, String>,
) -> Result<Value, ScientificResolveError> {
    let config = object_at(&preflight.payload, "legacyConfig")?;
    if preflight.requested_backend != "local-python"
        || config.get("execution_backend").and_then(Value::as_str) != Some("local-python")
        || config.get("engine").and_then(Value::as_str) != Some("dag-ml")
        || config
            .get("allow_fallback")
            .is_some_and(|value| value != &json!(false))
    {
        return Err(ScientificResolveError::UnsupportedSubmission);
    }
    let selection = selection(&preflight.payload, config)?;
    let mut datasets = Vec::new();
    for id in &selection.datasets {
        let mut record = resolver.read_dataset(id)?;
        let root = record
            .get("path")
            .and_then(Value::as_str)
            .and_then(|path| canonical_directory(Path::new(path)).ok())
            .ok_or(ScientificResolveError::DatasetInvalid)?;
        // Inspect supplied references before a document adapter can read a
        // legacy configuration file. Recheck its returned canonical config.
        confine_config(&mut record, &root, false)?;
        bounded(&record, MAX_DOCUMENT_BYTES)?;
        let mut dataset = adapt("dataset.configure", &json!({"record": record}))
            .map_err(|_| ScientificResolveError::DatasetInvalid)?;
        // The adapter must expose resolved references, not hand an opaque
        // folder/config path to a later loader which could discover new paths.
        if !dataset.is_object() {
            return Err(ScientificResolveError::DatasetInvalid);
        }
        reject_implicit_folders(&dataset)?;
        confine_config(&mut dataset, &root, true)?;
        datasets.push(dataset);
    }
    let mut pipelines = Vec::new();
    for (id, inline) in &selection.pipelines {
        let document = match inline {
            Some(value) => value.clone(),
            None => {
                read_pipeline_with_limit(&preflight.workspace_path, id, MAX_DOCUMENT_BYTES as u64)?
            }
        };
        if inline.is_none() && document.get("id").and_then(Value::as_str) != Some(id) {
            return Err(ScientificResolveError::PipelineInvalid);
        }
        bounded(&document, MAX_DOCUMENT_BYTES)?;
        let normalized = adapt("pipeline.normalize", &document)
            .map_err(|_| ScientificResolveError::PipelineInvalid)?;
        bounded(&normalized, MAX_GENERAL_BYTES)?;
        let pipeline = normalized
            .get("runtime_pipeline")
            .filter(|value| value.as_array().is_some_and(|steps| !steps.is_empty()))
            .ok_or(ScientificResolveError::PipelineInvalid)?;
        if normalized
            .get("validation")
            .and_then(|value| value.get("valid"))
            == Some(&json!(false))
        {
            return Err(ScientificResolveError::PipelineInvalid);
        }
        pipelines.push(pipeline.clone());
    }
    let workspace = canonical_directory(&preflight.workspace_path)
        .map_err(|()| ScientificResolveError::PipelineUnsafe)?;
    let mut options = json!({"workspace_path": workspace, "verbose": 0,
        "save_artifacts": true, "save_charts": false});
    for key in ["name", "random_state"] {
        if let Some(value) = config.get(key) {
            options[key] = value.clone();
        }
    }
    if let Some(project) = config.get("project_id").filter(|value| !value.is_null()) {
        options["project"] = project.clone();
    }
    let request = json!({
        "schema": "nirs4all.studio-scientific-job.v2", "operation": "run",
        "job_id": preflight.job_id, "engine": "dag-ml", "allow_fallback": false,
        "pipeline": single_or_batch(pipelines), "dataset": single_or_batch(datasets),
        "options": options,
    });
    bounded(&request, MAX_GENERAL_BYTES)?;
    Ok(request)
}

struct Selection {
    datasets: Vec<String>,
    pipelines: Vec<(String, Option<Value>)>,
}

fn selection(
    payload: &Value,
    config: &Map<String, Value>,
) -> Result<Selection, ScientificResolveError> {
    validate_options(config)?;
    let datasets = identities(config.get("dataset_ids"), false)?;
    let saved = identities(config.get("pipeline_ids"), true)?;
    let mut inline = Vec::new();
    if let Some(value) = config
        .get("inline_pipeline")
        .filter(|value| !value.is_null())
    {
        inline.push(value.clone());
    }
    if let Some(values) = config.get("inline_pipelines") {
        inline.extend(
            values
                .as_array()
                .ok_or(ScientificResolveError::InvalidSubmission)?
                .iter()
                .cloned(),
        );
    }
    let strict = object_at(payload, "strictCampaignSpecs")?;
    let specs = strict
        .get("splitSpecs")
        .and_then(Value::as_array)
        .filter(|specs| !specs.is_empty() && specs.len() <= 64)
        .ok_or(ScientificResolveError::InvalidSubmission)?;
    if !empty_array(strict.get("skippedRunIds")) {
        return Err(ScientificResolveError::InvalidSubmission);
    }
    let manifest = object_at(payload, "manifest")?;
    if !empty_array(manifest.get("skippedRunIds")) {
        return Err(ScientificResolveError::InvalidSubmission);
    }
    let mut pairs = BTreeSet::new();
    let mut source_ids = Vec::new();
    let mut pipelines = saved
        .iter()
        .map(|id| (id.clone(), None))
        .collect::<Vec<_>>();
    let mut inline_seen = BTreeMap::new();
    for spec in specs {
        let dataset = identifier_at(spec, "sourceDatasetId")?;
        let pipeline = identifier_at(spec, "sourcePipelineId")?;
        let source = format!("{dataset}::{pipeline}");
        if !datasets.contains(&dataset)
            || spec.get("sourceRunId").and_then(Value::as_str) != Some(&source)
            || !pairs.insert((dataset.clone(), pipeline.clone()))
        {
            return Err(ScientificResolveError::InvalidSubmission);
        }
        let pipeline_ref = validate_pair(spec, &dataset, &pipeline, &source)?;
        match pipeline_ref.get("source").and_then(Value::as_str) {
            Some("saved") if saved.contains(&pipeline) => {}
            Some("inline" | "inline-pruned") if !saved.contains(&pipeline) => {
                let document =
                    json!({"name": pipeline_ref.get("name"), "steps": pipeline_ref.get("steps")});
                if let Some(previous) = inline_seen.get(&pipeline) {
                    if previous != &document {
                        return Err(ScientificResolveError::InvalidSubmission);
                    }
                } else {
                    let position = inline
                        .iter()
                        .position(|value| {
                            value.get("steps") == document.get("steps")
                                && value.get("name") == document.get("name")
                        })
                        .ok_or(ScientificResolveError::InvalidSubmission)?;
                    inline.remove(position);
                    inline_seen.insert(pipeline.clone(), document.clone());
                    pipelines.push((pipeline.clone(), Some(document)));
                }
            }
            _ => return Err(ScientificResolveError::InvalidSubmission),
        }
        source_ids.push(json!(source));
    }
    if !inline.is_empty()
        || pipelines.is_empty()
        || manifest.get("sourceRunIds") != Some(&Value::Array(source_ids))
    {
        return Err(ScientificResolveError::InvalidSubmission);
    }
    // The current public multi-run contract is Cartesian. Never turn a sparse
    // selected matrix into extra scientific runs not authorized by its manifest.
    if pairs.len() != datasets.len().saturating_mul(pipelines.len()) {
        return Err(ScientificResolveError::UnsupportedSubmission);
    }
    Ok(Selection {
        datasets,
        pipelines,
    })
}

fn validate_options(config: &Map<String, Value>) -> Result<(), ScientificResolveError> {
    // These options must never be accepted and then silently ignored. Their
    // library-owned translations are independent from document normalization.
    for key in [
        "test_size",
        "robustness",
        "cv_folds",
        "cv_strategy",
        "shuffle",
    ] {
        if config.get(key).is_some_and(|value| !value.is_null()) {
            return Err(ScientificResolveError::UnsupportedSubmission);
        }
    }
    if config
        .get("split_group_by_by_dataset")
        .is_some_and(|value| {
            value
                .as_object()
                .is_none_or(|groups| groups.values().any(|group| !group.is_null()))
        })
    {
        return Err(ScientificResolveError::UnsupportedSubmission);
    }
    Ok(())
}

fn validate_pair<'a>(
    spec: &'a Value,
    dataset: &str,
    pipeline: &str,
    source: &str,
) -> Result<&'a Value, ScientificResolveError> {
    let campaign = object_at(spec, "campaign")?;
    let dataset_ref = only(campaign.get("datasets"))?;
    let pipeline_ref = only(campaign.get("pipelines"))?;
    let run = only(campaign.get("runMatrix"))?;
    if campaign.get("mode").and_then(Value::as_str) != Some("paired_by_index")
        || campaign.get("executionBackend").and_then(Value::as_str) != Some("local-python")
        || dataset_ref.get("id").and_then(Value::as_str) != Some(dataset)
        || pipeline_ref.get("id").and_then(Value::as_str) != Some(pipeline)
        || run.get("datasetId").and_then(Value::as_str) != Some(dataset)
        || run.get("pipelineId").and_then(Value::as_str) != Some(pipeline)
        || run.get("id").and_then(Value::as_str) != Some(source)
        || run.get("datasetIndex").and_then(Value::as_u64) != Some(0)
        || run.get("pipelineIndex").and_then(Value::as_u64) != Some(0)
    {
        return Err(ScientificResolveError::InvalidSubmission);
    }
    if dataset_ref
        .get("splitGroupBy")
        .is_some_and(|value| !value.is_null())
        || run
            .get("splitGroupBy")
            .is_some_and(|value| !value.is_null())
    {
        return Err(ScientificResolveError::UnsupportedSubmission);
    }
    Ok(pipeline_ref)
}

fn empty_array(value: Option<&Value>) -> bool {
    value.and_then(Value::as_array).is_some_and(Vec::is_empty)
}

fn only(value: Option<&Value>) -> Result<&Value, ScientificResolveError> {
    value
        .and_then(Value::as_array)
        .filter(|values| values.len() == 1)
        .map(|values| &values[0])
        .ok_or(ScientificResolveError::InvalidSubmission)
}

fn identifier_at(value: &Value, key: &str) -> Result<String, ScientificResolveError> {
    value
        .get(key)
        .and_then(Value::as_str)
        .filter(|value| valid_identifier(value))
        .map(str::to_owned)
        .ok_or(ScientificResolveError::InvalidSubmission)
}

fn identities(
    value: Option<&Value>,
    allow_empty: bool,
) -> Result<Vec<String>, ScientificResolveError> {
    let values = value
        .and_then(Value::as_array)
        .filter(|values| (allow_empty || !values.is_empty()) && values.len() <= 256)
        .ok_or(ScientificResolveError::InvalidSubmission)?;
    let mut seen = BTreeSet::new();
    values
        .iter()
        .map(|value| {
            let id = value
                .as_str()
                .filter(|value| valid_identifier(value))
                .ok_or(ScientificResolveError::InvalidSubmission)?;
            if !seen.insert(id) {
                return Err(ScientificResolveError::InvalidSubmission);
            }
            Ok(id.to_owned())
        })
        .collect()
}

fn bounded(value: &Value, limit: usize) -> Result<(), ScientificResolveError> {
    if serde_json::to_vec(value)
        .map_err(|_| ScientificResolveError::InvalidSubmission)?
        .len()
        > limit
    {
        return Err(ScientificResolveError::PipelineTooLarge);
    }
    Ok(())
}

fn single_or_batch(mut values: Vec<Value>) -> Value {
    if values.len() == 1 {
        values.remove(0)
    } else {
        Value::Array(values)
    }
}

/// Normalize explicit file references, including metadata/folds and nested
/// multi-source configs. Other string parameters (column names, units, etc.)
/// are not interpreted as paths.
fn confine_config(
    value: &mut Value,
    root: &Path,
    path_value: bool,
) -> Result<(), ScientificResolveError> {
    match value {
        Value::String(path) if path_value => {
            let candidate = if Path::new(path).is_absolute() {
                PathBuf::from(&*path)
            } else {
                root.join(&*path)
            };
            let resolved = candidate
                .canonicalize()
                .map_err(|_| ScientificResolveError::DatasetInvalid)?;
            if !resolved.starts_with(root) {
                return Err(ScientificResolveError::DatasetInvalid);
            }
            *path = resolved.to_string_lossy().into_owned();
        }
        Value::Array(values) => {
            for value in values {
                confine_config(value, root, path_value)?;
            }
        }
        Value::Object(values) => {
            for (key, value) in values {
                let is_path = matches!(
                    key.as_str(),
                    "path"
                        | "file"
                        | "folder"
                        | "config_file"
                        | "index_file"
                        | "folds"
                        | "input"
                        | "train_file"
                        | "test_file"
                        | "predict_file"
                ) || ["train_", "test_", "val_", "validation_"].iter().any(
                    |prefix| {
                        key.strip_prefix(prefix).is_some_and(|role| {
                            matches!(
                                role,
                                "x" | "y" | "group" | "groups" | "metadata" | "weights"
                            )
                        })
                    },
                );
                confine_config(value, root, is_path)?;
            }
        }
        _ => {}
    }
    Ok(())
}

fn reject_implicit_folders(value: &Value) -> Result<(), ScientificResolveError> {
    match value {
        Value::Object(values) => {
            for (key, value) in values {
                if matches!(key.as_str(), "folder" | "config_file") && !value.is_null() {
                    return Err(ScientificResolveError::DatasetInvalid);
                }
                reject_implicit_folders(value)?;
            }
        }
        Value::Array(values) => {
            for value in values {
                reject_implicit_folders(value)?;
            }
        }
        _ => {}
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::super::tests::{fixture, submission};
    use super::super::DATASET_LINKS_FILE;
    use super::*;
    use std::fs;

    fn adapter(operation: &str, value: &Value) -> Result<Value, String> {
        match operation {
            "dataset.configure" => Ok(json!({
                "train_x": value["record"]["config"]["files"][0]["path"],
                "train_y": value["record"]["config"]["files"][1]["path"],
                "name": value["record"]["name"],
            })),
            "pipeline.normalize" => Ok(json!({
                "runtime_pipeline": value["steps"], "validation": {"valid": true}
            })),
            _ => Err("unexpected operation".into()),
        }
    }

    #[test]
    fn saved_general_request_preserves_steps_and_does_not_load_numeric_files() {
        let (root, config, workspace) = fixture("general-saved");
        // A matrix parser would reject this. Resolution must not parse it or
        // infer task type from integral targets; the IO/science owners do that.
        fs::write(root.join("dataset/x.csv"), "not a numeric matrix").unwrap();
        let request = ScientificRequestResolver::new(config)
            .resolve_general(&submission(&workspace, "local-python"), adapter)
            .unwrap();
        assert_eq!(request["schema"], "nirs4all.studio-scientific-job.v2");
        assert_eq!(request["engine"], "dag-ml");
        assert_eq!(request["allow_fallback"], false);
        assert_eq!(request["options"]["workspace_path"], json!(workspace));
        assert_eq!(request["pipeline"][0]["name"], "KFold");
        assert_eq!(
            request["dataset"]["train_x"],
            json!(root.join("dataset/x.csv"))
        );
        assert!(request["dataset"].get("X").is_none());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn inline_general_pipeline_keeps_nested_steps_and_their_order() {
        let (root, config, workspace) = fixture("general-inline");
        let mut input = submission(&workspace, "local-python");
        let document = json!({"name": "Nested", "steps": [
            {"type": "preprocessing", "name": "StandardNormalVariate", "params": {}},
            {"type": "preprocessing", "name": "SavitzkyGolay", "params": {"window_length": 11}},
            {"type": "model", "name": "Ridge", "params": {"alpha": 0.25}}
        ]});
        input.payload["legacyConfig"]["pipeline_ids"] = json!([]);
        input.payload["legacyConfig"]["inline_pipeline"] = document.clone();
        let pipeline_ref =
            &mut input.payload["strictCampaignSpecs"]["splitSpecs"][0]["campaign"]["pipelines"][0];
        pipeline_ref["source"] = json!("inline");
        pipeline_ref["name"] = document["name"].clone();
        pipeline_ref["steps"] = document["steps"].clone();
        let resolver = ScientificRequestResolver::new(config);
        let request = resolver.resolve_general(&input, adapter).unwrap();
        assert_eq!(request["pipeline"], document["steps"]);
        // No reading of the similarly named saved document and no inserted CV.
        assert_eq!(request["pipeline"].as_array().unwrap().len(), 3);
        input.payload["legacyConfig"]["inline_pipeline"]["steps"][0]["name"] = json!("Other");
        assert_eq!(
            resolver.resolve_general(&input, adapter),
            Err(ScientificResolveError::InvalidSubmission)
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn batch_is_cartesian_only_when_every_manifest_pair_is_present() {
        let (root, config, workspace) = fixture("general-batch");
        let mut input = submission(&workspace, "local-python");
        let links_path = config.join(DATASET_LINKS_FILE);
        let mut links: Value = serde_json::from_slice(&fs::read(&links_path).unwrap()).unwrap();
        let mut second = links["datasets"][0].clone();
        second["id"] = json!("dataset-b");
        links["datasets"].as_array_mut().unwrap().push(second);
        fs::write(links_path, serde_json::to_vec(&links).unwrap()).unwrap();
        let pipeline_path = workspace.join("pipelines/pipeline-a.json");
        let mut pipeline: Value =
            serde_json::from_slice(&fs::read(pipeline_path).unwrap()).unwrap();
        pipeline["id"] = json!("pipeline-b");
        fs::write(
            workspace.join("pipelines/pipeline-b.json"),
            serde_json::to_vec(&pipeline).unwrap(),
        )
        .unwrap();
        input.payload["legacyConfig"]["dataset_ids"] = json!(["dataset-a", "dataset-b"]);
        input.payload["legacyConfig"]["pipeline_ids"] = json!(["pipeline-a", "pipeline-b"]);
        let template = input.payload["strictCampaignSpecs"]["splitSpecs"][0].clone();
        let mut specs = Vec::new();
        let mut source_ids = Vec::new();
        for dataset in ["dataset-a", "dataset-b"] {
            for pipeline in ["pipeline-a", "pipeline-b"] {
                let mut spec = template.clone();
                let source = format!("{dataset}::{pipeline}");
                spec["id"] = json!(format!("single-pair:{source}"));
                spec["sourceRunId"] = json!(source);
                spec["sourceDatasetId"] = json!(dataset);
                spec["sourcePipelineId"] = json!(pipeline);
                spec["campaign"]["datasets"][0]["id"] = json!(dataset);
                spec["campaign"]["pipelines"][0]["id"] = json!(pipeline);
                spec["campaign"]["runMatrix"][0]["id"] = json!(source);
                spec["campaign"]["runMatrix"][0]["datasetId"] = json!(dataset);
                spec["campaign"]["runMatrix"][0]["pipelineId"] = json!(pipeline);
                source_ids.push(json!(source));
                specs.push(spec);
            }
        }
        input.payload["strictCampaignSpecs"]["splitSpecs"] = json!(specs);
        input.payload["manifest"]["sourceRunIds"] = json!(source_ids);
        let resolver = ScientificRequestResolver::new(config);
        let request = resolver.resolve_general(&input, adapter).unwrap();
        assert_eq!(request["dataset"].as_array().unwrap().len(), 2);
        assert_eq!(request["pipeline"].as_array().unwrap().len(), 2);
        assert_eq!(request["pipeline"][0][0]["name"], "KFold");
        input.payload["strictCampaignSpecs"]["splitSpecs"]
            .as_array_mut()
            .unwrap()
            .pop();
        input.payload["manifest"]["sourceRunIds"]
            .as_array_mut()
            .unwrap()
            .pop();
        assert_eq!(
            resolver.resolve_general(&input, adapter),
            Err(ScientificResolveError::UnsupportedSubmission)
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn refuses_path_escape_before_adapter_and_checks_its_output() {
        let (root, config, workspace) = fixture("general-paths");
        let input = submission(&workspace, "local-python");
        let resolver = ScientificRequestResolver::new(&config);
        let outside = root.join("outside.csv");
        fs::write(&outside, "secret").unwrap();
        assert_eq!(
            resolver.resolve_general(&input, |operation, document| {
                if operation == "dataset.configure" {
                    Ok(json!({"train_x": outside}))
                } else {
                    adapter(operation, document)
                }
            }),
            Err(ScientificResolveError::DatasetInvalid)
        );
        let links_path = config.join(DATASET_LINKS_FILE);
        let mut links: Value = serde_json::from_slice(&fs::read(&links_path).unwrap()).unwrap();
        links["datasets"][0]["config"]["folds"] =
            json!({"source": "file", "file": "../outside.csv"});
        fs::write(links_path, serde_json::to_vec(&links).unwrap()).unwrap();
        assert_eq!(
            resolver.resolve_general(&input, |_, _| panic!("must reject before adapter")),
            Err(ScientificResolveError::DatasetInvalid)
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rejects_invalid_adapter_output_and_does_not_ignore_untranslated_options() {
        let (root, config, workspace) = fixture("general-errors");
        let mut input = submission(&workspace, "local-python");
        let resolver = ScientificRequestResolver::new(config);
        assert_eq!(
            resolver.resolve_general(&input, |operation, document| {
                if operation == "pipeline.normalize" {
                    Ok(json!({"runtime_pipeline": [], "validation": {"valid": true}}))
                } else {
                    adapter(operation, document)
                }
            }),
            Err(ScientificResolveError::PipelineInvalid)
        );
        for key in ["test_size", "robustness", "cv_strategy"] {
            input.payload["legacyConfig"][key] = json!("not implemented");
            assert_eq!(
                resolver.resolve_general(&input, |_, _| panic!("must fail before reading")),
                Err(ScientificResolveError::UnsupportedSubmission)
            );
            input.payload["legacyConfig"]
                .as_object_mut()
                .unwrap()
                .remove(key);
        }
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    #[ignore = "requires STUDIO_GENERAL_TEST_PYTHON with the installed corrective scientific wheel closure"]
    fn installed_library_executes_general_resolved_request() {
        use std::{
            fmt::Write as _,
            io::Write,
            process::{Command, Stdio},
        };
        let python = std::env::var("STUDIO_GENERAL_TEST_PYTHON")
            .expect("installed private Python environment");
        let (root, config, workspace) = fixture("general-installed");
        let studio = Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap();
        let invoke = |mode: &str, payload: &Value| -> Value {
            let script = r"
import contextlib, json, sys
sys.path.insert(0, sys.argv[1])
request = json.load(sys.stdin)
with contextlib.redirect_stdout(sys.stderr):
    if sys.argv[2] == 'adapt':
        from api.library_documents import adapt_document
        result = adapt_document(request['operation'], request['document'])
    else:
        from nirs4all.api.studio_scientific_general import studio_scientific_job_v2
        result = studio_scientific_job_v2(request)
json.dump(result, sys.stdout, allow_nan=False)
";
            let mut child = Command::new(&python)
                .args(["-I", "-c", script])
                .arg(studio)
                .arg(mode)
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .spawn()
                .unwrap();
            child
                .stdin
                .take()
                .unwrap()
                .write_all(&serde_json::to_vec(payload).unwrap())
                .unwrap();
            let output = child.wait_with_output().unwrap();
            assert!(
                output.status.success(),
                "{}",
                String::from_utf8_lossy(&output.stderr)
            );
            serde_json::from_slice(&output.stdout).unwrap()
        };
        let pipeline = json!({"id": "pipeline-a", "name": "General Ridge", "steps": [
            {"id":"scale", "type":"preprocessing", "name":"StandardScaler", "params":{}},
            {"id":"cv", "type":"splitting", "name":"KFold", "params":{"n_splits":3}},
            {"id":"model", "type":"model", "name":"Ridge", "params":{"alpha":0.1}}
        ]});
        fs::write(
            workspace.join("pipelines/pipeline-a.json"),
            serde_json::to_vec(&pipeline).unwrap(),
        )
        .unwrap();
        // Both dimensions exceed the old portable resolver's demonstration
        // slice. No maximum-size allocation is involved in this witness.
        let mut x = (0..300)
            .map(|column| (1000 + column).to_string())
            .collect::<Vec<_>>()
            .join(",")
            + "\n";
        let mut y = "protein\n".to_owned();
        for row in 0..150 {
            x.push_str(
                &(0..300)
                    .map(|column| format!("{}", f64::from(row * 3 + column) / 10.0))
                    .collect::<Vec<_>>()
                    .join(","),
            );
            x.push('\n');
            writeln!(y, "{}", f64::from(row).mul_add(0.2, 1.1)).unwrap();
        }
        fs::write(root.join("dataset/x.csv"), x).unwrap();
        fs::write(root.join("dataset/y.csv"), y).unwrap();
        let request = ScientificRequestResolver::new(config)
            .resolve_general(
                &submission(&workspace, "local-python"),
                |operation, document| {
                    Ok(invoke(
                        "adapt",
                        &json!({"operation": operation, "document": document}),
                    ))
                },
            )
            .unwrap();
        assert_eq!(request["pipeline"].as_array().unwrap().len(), 3);
        let response = invoke("run", &request);
        assert_eq!(
            response["schema"],
            "nirs4all.studio-scientific-job-result.v2"
        );
        assert_eq!(response["job_id"], "run_native_resolver_test");
        assert_eq!(response["result"]["run_ids"].as_array().unwrap().len(), 1);
        assert_eq!(response["result"]["native_score_sets_available"], true);
        assert!(response["result"]["validation_score"]
            .as_f64()
            .unwrap()
            .is_finite());
        fs::remove_dir_all(root).unwrap();
    }
}
