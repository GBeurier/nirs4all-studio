//! Fail-closed resolver from Studio's saved identities to the path-free
//! scientific-library request.
//!
//! This module owns no numerical or tabular parsing. Dataset assembly is
//! delegated to the selected `nirs4all-io` role-tagged facade; this Rust layer
//! only confines catalogue/pipeline reads and selects the deliberately narrow
//! V1 slice which the bounded `CPython` callable accepts.

use std::{
    fs::{self},
    io::Read,
    path::{Path, PathBuf},
};

use cap_std::{ambient_authority, fs::Dir};
use nirs4all_io::{core::materialize::Matrix, RoleTaggedReadLimits};
use serde_json::{json, Map, Value};

use crate::job_http::ScientificSubmissionPreflight;

const DATASET_LINKS_FILE: &str = "dataset_links.json";
const MAX_DATASET_LINKS_BYTES: u64 = 2 * 1024 * 1024;
const MAX_PIPELINE_BYTES: u64 = 256 * 1024;
const MAX_DATASETS: usize = 256;
const MAX_DATASET_FILE_BYTES: u64 = 1024 * 1024;
const MAX_DATASET_TOTAL_BYTES: u64 = 2 * 1024 * 1024;
const MAX_DATASET_RECORD_BYTES: u64 = 128 * 1024;
const MAX_DATASET_FIELD_BYTES: u64 = 64 * 1024;
const MIN_SAMPLES: usize = 4;
const MAX_SAMPLES: usize = 128;
const MAX_FEATURES: usize = 256;
const MAX_CELLS: usize = 16_384;

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ScientificResolveError {
    InvalidSubmission,
    UnsupportedSubmission,
    CatalogueUnavailable,
    CatalogueUnsafe,
    CatalogueTooLarge,
    CatalogueInvalid,
    DatasetMissing,
    DatasetInvalid,
    PipelineMissing,
    PipelineUnsafe,
    PipelineTooLarge,
    PipelineInvalid,
    DatasetAssembly,
}

#[derive(Clone, Debug)]
pub struct ScientificRequestResolver {
    config_dir: PathBuf,
}

impl ScientificRequestResolver {
    #[must_use]
    pub fn new(config_dir: impl Into<PathBuf>) -> Self {
        Self {
            config_dir: config_dir.into(),
        }
    }

    /// Resolve all saved identities and materialize the bounded, path-free
    /// request before the job registry, WebSocket stream, or durable store is
    /// mutated.
    ///
    /// # Errors
    ///
    /// Refuses malformed or unsupported submissions, unsafe saved paths,
    /// incompatible saved records, and any IO assembly outside the closed
    /// single-source regression slice.
    pub fn resolve(
        &self,
        preflight: &ScientificSubmissionPreflight,
    ) -> Result<Value, ScientificResolveError> {
        if preflight.requested_backend != "local-python" {
            return Err(ScientificResolveError::UnsupportedSubmission);
        }
        let identities = submission_identities(&preflight.payload)?;
        let dataset = self.read_dataset(&identities.dataset_id)?;
        let pipeline = read_pipeline(&preflight.workspace_path, &identities.pipeline_id)?;
        let pipeline = resolve_pipeline(&pipeline, &identities.pipeline_id)?;
        let dataset = resolve_dataset(&dataset, &identities.dataset_id)?;
        let read_limits = RoleTaggedReadLimits::new(
            MAX_DATASET_FILE_BYTES,
            MAX_DATASET_TOTAL_BYTES,
            MAX_DATASET_RECORD_BYTES,
            MAX_DATASET_FIELD_BYTES,
            MAX_SAMPLES as u64,
            MAX_FEATURES as u64,
            MAX_CELLS as u64,
        )
        .map_err(|_| ScientificResolveError::DatasetAssembly)?;
        let assembled = nirs4all_io::load_role_tagged_assembled_with_limits(
            &dataset.config,
            &dataset.root,
            Some(&identities.dataset_id),
            read_limits,
        )
        .map_err(|_| ScientificResolveError::DatasetAssembly)?;
        let (x, y) = project_train_regression(&assembled)?;
        validate_components(&pipeline, x.n_rows, x.n_cols)?;

        Ok(json!({
            "schema": "nirs4all.studio-scientific-job.v1",
            "operation": "run",
            "job_id": preflight.job_id,
            "engine": "dag-ml",
            "allow_fallback": false,
            "dataset": {
                "name": identities.dataset_id,
                "task_type": "regression",
                "X": matrix_rows(x),
                "y": y.data,
            },
            "pipeline": {
                "kind": "pls_regression",
                "n_components": pipeline.n_components,
                "scale": pipeline.scale,
                "cross_validation": {
                    "kind": "kfold",
                    "n_splits": pipeline.n_splits,
                    "shuffle": pipeline.shuffle,
                },
            },
            "options": {
                "name": identities.pipeline_id,
                "random_state": pipeline.random_state,
            },
        }))
    }

    #[must_use]
    pub(crate) fn is_configured(&self) -> bool {
        self.read_catalogue().is_ok()
    }

    fn read_dataset(&self, dataset_id: &str) -> Result<Value, ScientificResolveError> {
        let value = self.read_catalogue()?;
        let datasets = value
            .get("datasets")
            .and_then(Value::as_array)
            .ok_or(ScientificResolveError::CatalogueInvalid)?;
        let mut matches = datasets
            .iter()
            .filter(|dataset| dataset.get("id").and_then(Value::as_str) == Some(dataset_id));
        let dataset = matches
            .next()
            .cloned()
            .ok_or(ScientificResolveError::DatasetMissing)?;
        if matches.next().is_some() {
            return Err(ScientificResolveError::CatalogueInvalid);
        }
        Ok(dataset)
    }

    fn read_catalogue(&self) -> Result<Value, ScientificResolveError> {
        let config_root = canonical_directory(&self.config_dir)
            .map_err(|()| ScientificResolveError::CatalogueUnavailable)?;
        let path = config_root.join(DATASET_LINKS_FILE);
        let value = read_confined_json(
            &path,
            &config_root,
            MAX_DATASET_LINKS_BYTES,
            ScientificResolveError::CatalogueUnsafe,
            ScientificResolveError::CatalogueTooLarge,
            ScientificResolveError::CatalogueInvalid,
        )?;
        let root = value
            .as_object()
            .ok_or(ScientificResolveError::CatalogueInvalid)?;
        if root.get("schema_version").and_then(Value::as_u64) != Some(2) {
            return Err(ScientificResolveError::CatalogueInvalid);
        }
        let datasets = root
            .get("datasets")
            .and_then(Value::as_array)
            .filter(|values| values.len() <= MAX_DATASETS)
            .ok_or(ScientificResolveError::CatalogueInvalid)?;
        if datasets.iter().any(|dataset| !dataset.is_object()) {
            return Err(ScientificResolveError::CatalogueInvalid);
        }
        Ok(value)
    }
}

#[derive(Debug)]
struct SubmissionIdentities {
    dataset_id: String,
    pipeline_id: String,
}

fn submission_identities(payload: &Value) -> Result<SubmissionIdentities, ScientificResolveError> {
    let legacy = object_at(payload, "legacyConfig")?;
    if legacy.get("execution_backend").and_then(Value::as_str) != Some("local-python")
        || legacy.get("engine").and_then(Value::as_str) != Some("dag-ml")
        || legacy.get("allow_fallback").and_then(Value::as_bool) != Some(false)
        || legacy
            .get("inline_pipeline")
            .is_some_and(|value| !value.is_null())
        || legacy
            .get("inline_pipelines")
            .is_some_and(|value| value.as_array().is_none_or(|values| !values.is_empty()))
        || legacy
            .get("robustness")
            .is_some_and(|value| !value.is_null())
        || legacy
            .get("test_size")
            .is_some_and(|value| !value.is_null())
        || legacy
            .get("split_group_by_by_dataset")
            .is_some_and(|value| value.as_object().is_none_or(|values| !values.is_empty()))
    {
        return Err(ScientificResolveError::UnsupportedSubmission);
    }
    let dataset_id = exact_identity_array(legacy.get("dataset_ids"))?;
    let pipeline_id = exact_identity_array(legacy.get("pipeline_ids"))?;
    let expected_run = format!("{dataset_id}::{pipeline_id}");
    validate_manifest(payload, &expected_run)?;
    let strict = object_at(payload, "strictCampaignSpecs")?;
    if strict
        .get("skippedRunIds")
        .and_then(Value::as_array)
        .is_none_or(|values| !values.is_empty())
    {
        return Err(ScientificResolveError::InvalidSubmission);
    }
    let specs = strict
        .get("splitSpecs")
        .and_then(Value::as_array)
        .filter(|values| values.len() == 1)
        .ok_or(ScientificResolveError::UnsupportedSubmission)?;
    let spec = specs[0]
        .as_object()
        .ok_or(ScientificResolveError::InvalidSubmission)?;
    if spec.get("sourceDatasetId").and_then(Value::as_str) != Some(&dataset_id)
        || spec.get("sourcePipelineId").and_then(Value::as_str) != Some(&pipeline_id)
        || spec.get("sourceRunId").and_then(Value::as_str) != Some(&expected_run)
    {
        return Err(ScientificResolveError::InvalidSubmission);
    }
    let campaign = spec
        .get("campaign")
        .and_then(Value::as_object)
        .ok_or(ScientificResolveError::InvalidSubmission)?;
    let datasets = campaign
        .get("datasets")
        .and_then(Value::as_array)
        .filter(|values| values.len() == 1)
        .ok_or(ScientificResolveError::UnsupportedSubmission)?;
    let pipelines = campaign
        .get("pipelines")
        .and_then(Value::as_array)
        .filter(|values| values.len() == 1)
        .ok_or(ScientificResolveError::UnsupportedSubmission)?;
    let runs = campaign
        .get("runMatrix")
        .and_then(Value::as_array)
        .filter(|values| values.len() == 1)
        .ok_or(ScientificResolveError::UnsupportedSubmission)?;
    if campaign.get("mode").and_then(Value::as_str) != Some("paired_by_index")
        || campaign.get("executionBackend").and_then(Value::as_str) != Some("local-python")
        || datasets[0].get("id").and_then(Value::as_str) != Some(&dataset_id)
        || datasets[0]
            .get("splitGroupBy")
            .is_some_and(|value| !value.is_null())
        || pipelines[0].get("id").and_then(Value::as_str) != Some(&pipeline_id)
        || pipelines[0].get("source").and_then(Value::as_str) != Some("saved")
        || pipelines[0].get("steps").is_some()
        || pipelines[0].get("graph").is_some()
        || runs[0].get("datasetId").and_then(Value::as_str) != Some(&dataset_id)
        || runs[0].get("pipelineId").and_then(Value::as_str) != Some(&pipeline_id)
        || runs[0].get("id").and_then(Value::as_str) != Some(&expected_run)
        || runs[0].get("datasetIndex").and_then(Value::as_u64) != Some(0)
        || runs[0].get("pipelineIndex").and_then(Value::as_u64) != Some(0)
        || runs[0]
            .get("splitGroupBy")
            .is_some_and(|value| !value.is_null())
    {
        return Err(ScientificResolveError::UnsupportedSubmission);
    }
    Ok(SubmissionIdentities {
        dataset_id,
        pipeline_id,
    })
}

fn validate_manifest(payload: &Value, expected_run: &str) -> Result<(), ScientificResolveError> {
    let manifest = object_at(payload, "manifest")?;
    let source_run_ids = manifest
        .get("sourceRunIds")
        .and_then(Value::as_array)
        .filter(|values| values.len() == 1)
        .ok_or(ScientificResolveError::InvalidSubmission)?;
    if source_run_ids[0].as_str() != Some(expected_run)
        || manifest
            .get("skippedRunIds")
            .and_then(Value::as_array)
            .is_none_or(|values| !values.is_empty())
    {
        return Err(ScientificResolveError::InvalidSubmission);
    }
    Ok(())
}

fn exact_identity_array(value: Option<&Value>) -> Result<String, ScientificResolveError> {
    let values = value
        .and_then(Value::as_array)
        .filter(|values| values.len() == 1)
        .ok_or(ScientificResolveError::UnsupportedSubmission)?;
    values[0]
        .as_str()
        .filter(|value| valid_identifier(value))
        .map(str::to_owned)
        .ok_or(ScientificResolveError::InvalidSubmission)
}

#[derive(Debug)]
struct DatasetRecord {
    root: PathBuf,
    config: Value,
}

fn resolve_dataset(
    value: &Value,
    expected_id: &str,
) -> Result<DatasetRecord, ScientificResolveError> {
    let object = value
        .as_object()
        .ok_or(ScientificResolveError::DatasetInvalid)?;
    if object.get("id").and_then(Value::as_str) != Some(expected_id)
        || !object
            .get("name")
            .and_then(Value::as_str)
            .is_some_and(|value| !value.trim().is_empty() && value.len() <= 256)
    {
        return Err(ScientificResolveError::DatasetInvalid);
    }
    let root = object
        .get("path")
        .and_then(Value::as_str)
        .map(Path::new)
        .ok_or(ScientificResolveError::DatasetInvalid)?;
    let root = canonical_directory(root).map_err(|()| ScientificResolveError::DatasetInvalid)?;
    let config = object
        .get("config")
        .filter(|value| value.is_object())
        .cloned()
        .ok_or(ScientificResolveError::DatasetInvalid)?;
    validate_role_config_slice(&config)?;
    Ok(DatasetRecord { root, config })
}

fn validate_role_config_slice(config: &Value) -> Result<(), ScientificResolveError> {
    let object = config
        .as_object()
        .ok_or(ScientificResolveError::DatasetInvalid)?;
    if object.get("task_type").and_then(Value::as_str) != Some("regression")
        || object
            .get("aggregation")
            .is_some_and(|value| !value.is_null())
        || object.get("folds").is_some_and(|value| !value.is_null())
        || object
            .get("fold_column")
            .is_some_and(|value| !value.is_null())
        || object
            .get("multi_source")
            .is_some_and(|value| !value.is_null())
    {
        return Err(ScientificResolveError::UnsupportedSubmission);
    }
    let files = object
        .get("files")
        .and_then(Value::as_array)
        .filter(|files| files.len() == 2)
        .ok_or(ScientificResolveError::UnsupportedSubmission)?;
    let mut x = 0;
    let mut y = 0;
    for file in files {
        let file = file
            .as_object()
            .ok_or(ScientificResolveError::DatasetInvalid)?;
        let path = file
            .get("path")
            .and_then(Value::as_str)
            .ok_or(ScientificResolveError::DatasetInvalid)?;
        let extension = Path::new(path)
            .extension()
            .and_then(|value| value.to_str())
            .map(str::to_ascii_lowercase);
        if !matches!(extension.as_deref(), Some("csv" | "tsv" | "txt"))
            || file.get("split").and_then(Value::as_str) != Some("train")
        {
            return Err(ScientificResolveError::UnsupportedSubmission);
        }
        match file.get("type").and_then(Value::as_str) {
            Some("X") => x += 1,
            Some("Y") => y += 1,
            _ => return Err(ScientificResolveError::UnsupportedSubmission),
        }
    }
    let targets = object
        .get("targets")
        .and_then(Value::as_array)
        .filter(|targets| targets.len() == 1)
        .ok_or(ScientificResolveError::UnsupportedSubmission)?;
    if x != 1 || y != 1 || targets[0].get("type").and_then(Value::as_str) != Some("regression") {
        return Err(ScientificResolveError::UnsupportedSubmission);
    }
    Ok(())
}

#[derive(Debug)]
struct ResolvedPipeline {
    n_components: u64,
    scale: bool,
    n_splits: u64,
    shuffle: bool,
    random_state: u64,
}

fn read_pipeline(workspace: &Path, pipeline_id: &str) -> Result<Value, ScientificResolveError> {
    let workspace =
        canonical_directory(workspace).map_err(|()| ScientificResolveError::PipelineUnsafe)?;
    let pipelines = workspace.join("pipelines");
    let metadata =
        fs::symlink_metadata(&pipelines).map_err(|_| ScientificResolveError::PipelineMissing)?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(ScientificResolveError::PipelineUnsafe);
    }
    let pipelines = pipelines
        .canonicalize()
        .map_err(|_| ScientificResolveError::PipelineUnsafe)?;
    if !pipelines.starts_with(&workspace) {
        return Err(ScientificResolveError::PipelineUnsafe);
    }
    read_confined_json(
        &pipelines.join(format!("{pipeline_id}.json")),
        &pipelines,
        MAX_PIPELINE_BYTES,
        ScientificResolveError::PipelineUnsafe,
        ScientificResolveError::PipelineTooLarge,
        ScientificResolveError::PipelineInvalid,
    )
    .map_err(|error| match error {
        ScientificResolveError::PipelineUnsafe
            if !pipelines.join(format!("{pipeline_id}.json")).exists() =>
        {
            ScientificResolveError::PipelineMissing
        }
        other => other,
    })
}

fn resolve_pipeline(
    value: &Value,
    expected_id: &str,
) -> Result<ResolvedPipeline, ScientificResolveError> {
    let root = value
        .as_object()
        .ok_or(ScientificResolveError::PipelineInvalid)?;
    if root.get("id").and_then(Value::as_str) != Some(expected_id)
        || root
            .get("taskType")
            .is_some_and(|task| task.as_str() != Some("regression"))
    {
        return Err(ScientificResolveError::PipelineInvalid);
    }
    reject_pipeline_control_fields(root)?;
    let steps = root
        .get("steps")
        .and_then(Value::as_array)
        .filter(|steps| steps.len() == 2)
        .ok_or(ScientificResolveError::UnsupportedSubmission)?;
    let split = exact_step(&steps[0], "splitting", "KFold")?;
    let model = exact_step(&steps[1], "model", "PLSRegression")
        .or_else(|_| exact_step(&steps[1], "model_pls", "PLSRegression"))?;
    let n_splits = exact_u64(split, "n_splits", 2, 10)?;
    let shuffle = split
        .get("shuffle")
        .and_then(Value::as_bool)
        .ok_or(ScientificResolveError::PipelineInvalid)?;
    let random_state = exact_u64(split, "random_state", 0, 2_147_483_647)?;
    if split.len() != 3 {
        return Err(ScientificResolveError::UnsupportedSubmission);
    }
    let n_components = exact_u64(model, "n_components", 1, 256)?;
    let scale = model
        .get("scale")
        .and_then(Value::as_bool)
        .ok_or(ScientificResolveError::PipelineInvalid)?;
    if model.len() != 2 {
        return Err(ScientificResolveError::UnsupportedSubmission);
    }
    Ok(ResolvedPipeline {
        n_components,
        scale,
        n_splits,
        shuffle,
        random_state,
    })
}

fn reject_pipeline_control_fields(root: &Map<String, Value>) -> Result<(), ScientificResolveError> {
    for key in [
        "graph",
        "branches",
        "children",
        "generator",
        "hpo",
        "search",
        "automl",
    ] {
        if root.get(key).is_some_and(|value| !value.is_null()) {
            return Err(ScientificResolveError::UnsupportedSubmission);
        }
    }
    Ok(())
}

fn exact_step<'a>(
    value: &'a Value,
    expected_type: &str,
    expected_name: &str,
) -> Result<&'a Map<String, Value>, ScientificResolveError> {
    let step = value
        .as_object()
        .ok_or(ScientificResolveError::PipelineInvalid)?;
    if step
        .keys()
        .any(|key| !matches!(key.as_str(), "id" | "type" | "name" | "params" | "enabled"))
        || step.get("type").and_then(Value::as_str) != Some(expected_type)
        || step.get("name").and_then(Value::as_str) != Some(expected_name)
        || step
            .get("enabled")
            .is_some_and(|value| value != &Value::Bool(true))
    {
        return Err(ScientificResolveError::UnsupportedSubmission);
    }
    step.get("params")
        .and_then(Value::as_object)
        .ok_or(ScientificResolveError::PipelineInvalid)
}

fn exact_u64(
    object: &Map<String, Value>,
    key: &str,
    minimum: u64,
    maximum: u64,
) -> Result<u64, ScientificResolveError> {
    object
        .get(key)
        .and_then(Value::as_u64)
        .filter(|value| (minimum..=maximum).contains(value))
        .ok_or(ScientificResolveError::PipelineInvalid)
}

fn project_train_regression(
    assembled: &nirs4all_io::core::materialize::AssembledDataset,
) -> Result<(&Matrix, &Matrix), ScientificResolveError> {
    if assembled.task_type != "regression"
        || assembled.n_sources != 1
        || assembled.blocks.len() != 1
        || !assembled.folds.is_empty()
        || !assembled.fold_provenance.is_empty()
        || assembled.repetition.is_some()
        || assembled.aggregate.is_some()
    {
        return Err(ScientificResolveError::UnsupportedSubmission);
    }
    let block = assembled
        .blocks
        .get("train")
        .ok_or(ScientificResolveError::DatasetInvalid)?;
    let x = block
        .x
        .first()
        .filter(|_| block.x.len() == 1)
        .ok_or(ScientificResolveError::UnsupportedSubmission)?;
    let y = block
        .y
        .as_ref()
        .ok_or(ScientificResolveError::DatasetInvalid)?;
    if !(MIN_SAMPLES..=MAX_SAMPLES).contains(&x.n_rows)
        || x.n_cols == 0
        || x.n_cols > MAX_FEATURES
        || x.n_rows.saturating_mul(x.n_cols) > MAX_CELLS
        || y.n_rows != x.n_rows
        || y.n_cols != 1
        || block.n_samples != x.n_rows
        || block.source_ids.len() != 1
        || block.y_headers.len() != 1
        || !block.y_categorical.is_empty()
        || block.metadata.is_some()
        || block.weights.is_some()
        || block.processings.iter().any(|values| !values.is_empty())
        || x.data.iter().chain(&y.data).any(|value| !value.is_finite())
        || !target_is_supported_regression(&y.data)
    {
        return Err(ScientificResolveError::UnsupportedSubmission);
    }
    Ok((x, y))
}

fn target_is_supported_regression(values: &[f32]) -> bool {
    let all_integral = values.iter().all(|value| value.fract() == 0.0);
    if all_integral {
        let mut unique = values.to_vec();
        unique.sort_by(f32::total_cmp);
        unique.dedup_by(|left, right| left.total_cmp(right).is_eq());
        if unique.len() <= 100 {
            return false;
        }
    }
    if values.iter().all(|value| (0.0..=1.0).contains(value)) {
        let mut unique = values.to_vec();
        unique.sort_by(f32::total_cmp);
        unique.dedup_by(|left, right| left.total_cmp(right).is_eq());
        if unique.len().saturating_mul(20) <= values.len() {
            return false;
        }
    }
    true
}

fn validate_components(
    pipeline: &ResolvedPipeline,
    samples: usize,
    features: usize,
) -> Result<(), ScientificResolveError> {
    let splits =
        usize::try_from(pipeline.n_splits).map_err(|_| ScientificResolveError::PipelineInvalid)?;
    let components = usize::try_from(pipeline.n_components)
        .map_err(|_| ScientificResolveError::PipelineInvalid)?;
    let smallest_train = samples.saturating_sub(samples.div_ceil(splits));
    if splits > samples || components > features.min(smallest_train) {
        return Err(ScientificResolveError::UnsupportedSubmission);
    }
    Ok(())
}

fn matrix_rows(matrix: &Matrix) -> Vec<Vec<f32>> {
    matrix
        .data
        .chunks_exact(matrix.n_cols)
        .map(<[f32]>::to_vec)
        .collect()
}

fn object_at<'a>(
    value: &'a Value,
    key: &str,
) -> Result<&'a Map<String, Value>, ScientificResolveError> {
    value
        .get(key)
        .and_then(Value::as_object)
        .ok_or(ScientificResolveError::InvalidSubmission)
}

fn canonical_directory(path: &Path) -> Result<PathBuf, ()> {
    let metadata = fs::symlink_metadata(path).map_err(|_| ())?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(());
    }
    path.canonicalize().map_err(|_| ())
}

fn read_confined_json(
    path: &Path,
    root: &Path,
    limit: u64,
    unsafe_error: ScientificResolveError,
    too_large_error: ScientificResolveError,
    invalid_error: ScientificResolveError,
) -> Result<Value, ScientificResolveError> {
    let metadata = fs::symlink_metadata(path).map_err(|_| unsafe_error.clone())?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err(unsafe_error);
    }
    if metadata.len() > limit {
        return Err(too_large_error);
    }
    let relative = path.strip_prefix(root).map_err(|_| unsafe_error.clone())?;
    let directory =
        Dir::open_ambient_dir(root, ambient_authority()).map_err(|_| unsafe_error.clone())?;
    // The capability-rooted open remains beneath `root` even if the directory
    // entry is replaced after the metadata check. All bytes are read from this
    // same handle; the path is never reopened.
    let cap_file = directory.open(relative).map_err(|_| unsafe_error.clone())?;
    let mut file = cap_file.into_std();
    let opened = file.metadata().map_err(|_| invalid_error.clone())?;
    if !opened.is_file() {
        return Err(unsafe_error);
    }
    if opened.len() > limit {
        return Err(too_large_error);
    }
    let mut bytes = Vec::with_capacity(usize::try_from(metadata.len()).unwrap_or(0).min(64 * 1024));
    Read::by_ref(&mut file)
        .take(limit + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| invalid_error.clone())?;
    if u64::try_from(bytes.len()).unwrap_or(u64::MAX) > limit {
        return Err(too_large_error);
    }
    if file.metadata().map_err(|_| invalid_error.clone())?.len() != opened.len() {
        return Err(invalid_error);
    }
    serde_json::from_slice(&bytes).map_err(|_| invalid_error)
}

fn valid_identifier(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 256
        && !matches!(value, "." | "..")
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b':'))
}

#[cfg(test)]
mod tests {
    use std::time::{SystemTime, UNIX_EPOCH};

    use super::*;

    fn root(name: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!(
            "studio-scientific-resolver-{name}-{}-{nonce}",
            std::process::id()
        ))
    }

    fn submission(workspace: &Path, backend: &str) -> ScientificSubmissionPreflight {
        ScientificSubmissionPreflight {
            job_id: "run_native_resolver_test".into(),
            workspace_id: "workspace-a".into(),
            workspace_path: workspace.into(),
            requested_backend: backend.into(),
            payload: json!({
                "legacyConfig": {
                    "name": "Native campaign",
                    "dataset_ids": ["dataset-a"],
                    "pipeline_ids": ["pipeline-a"],
                    "execution_backend": backend,
                    "engine": "dag-ml",
                    "allow_fallback": false
                },
                "manifest": {
                    "sourceRunIds": ["dataset-a::pipeline-a"],
                    "skippedRunIds": []
                },
                "strictCampaignSpecs": {
                    "splitSpecs": [{
                        "id": "single-pair:dataset-a::pipeline-a",
                        "sourceRunId": "dataset-a::pipeline-a",
                        "sourceDatasetId": "dataset-a",
                        "sourcePipelineId": "pipeline-a",
                        "campaign": {
                            "name": "Campaign",
                            "mode": "paired_by_index",
                            "executionBackend": backend,
                            "datasets": [{"id": "dataset-a", "name": "Dataset A", "splitGroupBy": null}],
                            "pipelines": [{"id": "pipeline-a", "name": "Pipeline A", "source": "saved"}],
                            "runMatrix": [{
                                "id": "dataset-a::pipeline-a",
                                "datasetId": "dataset-a",
                                "pipelineId": "pipeline-a",
                                "datasetIndex": 0,
                                "pipelineIndex": 0,
                                "splitGroupBy": null
                    }],
                    "skippedRunIds": []
                }
                    }],
                    "skippedRunIds": []
                }
            }),
        }
    }

    fn fixture(name: &str) -> (PathBuf, PathBuf, PathBuf) {
        let root = root(name);
        let config = root.join("config");
        let workspace = root.join("workspace");
        let dataset = root.join("dataset");
        fs::create_dir_all(&config).unwrap();
        fs::create_dir_all(workspace.join("pipelines")).unwrap();
        fs::create_dir_all(&dataset).unwrap();
        fs::write(
            dataset.join("x.csv"),
            "1000,1001\n1,2\n2,3\n3,4\n4,5\n5,6\n6,7\n",
        )
        .unwrap();
        fs::write(
            dataset.join("y.csv"),
            "protein\n1.1\n2.2\n3.4\n4.8\n5.3\n6.7\n",
        )
        .unwrap();
        fs::write(
            workspace.join("pipelines/pipeline-a.json"),
            serde_json::to_vec(&json!({
                "id": "pipeline-a",
                "name": "PLS",
                "taskType": "regression",
                "steps": [
                    {"id": "cv", "type": "splitting", "name": "KFold", "params": {"n_splits": 3, "shuffle": true, "random_state": 42}},
                    {"id": "model", "type": "model", "name": "PLSRegression", "params": {"n_components": 2, "scale": true}}
                ]
            }))
            .unwrap(),
        )
        .unwrap();
        fs::write(
            config.join(DATASET_LINKS_FILE),
            serde_json::to_vec(&json!({
                "version": "1.0",
                "schema_version": 2,
                "datasets": [{
                    "id": "dataset-a",
                    "name": "Dataset A",
                    "path": dataset,
                    "config": {
                        "delimiter": ",",
                        "decimal_separator": ".",
                        "has_header": true,
                        "header_unit": "cm-1",
                        "signal_type": "auto",
                        "task_type": "regression",
                        "files": [
                            {"path": "x.csv", "type": "X", "split": "train"},
                            {"path": "y.csv", "type": "Y", "split": "train"}
                        ],
                        "targets": [{"column": "protein", "type": "regression", "is_default": true}],
                        "target_selection": {
                            "selected_targets": ["protein"],
                            "default_target": "protein",
                            "task_by_target": {"protein": "regression"}
                        },
                        "default_target": "protein"
                    }
                }],
                "groups": []
            }))
            .unwrap(),
        )
        .unwrap();
        (root, config, workspace)
    }

    #[test]
    fn resolves_saved_ids_through_io_to_the_closed_path_free_payload() {
        let (root, config, workspace) = fixture("success");
        let payload = ScientificRequestResolver::new(&config)
            .resolve(&submission(&workspace, "local-python"))
            .unwrap();
        assert_eq!(payload["job_id"], "run_native_resolver_test");
        assert_eq!(payload["dataset"]["name"], "dataset-a");
        assert_eq!(payload["dataset"]["task_type"], "regression");
        assert_eq!(payload["dataset"]["X"].as_array().unwrap().len(), 6);
        assert_eq!(payload["dataset"]["X"][0], json!([1.0, 2.0]));
        let targets = payload["dataset"]["y"].as_array().unwrap();
        assert_eq!(targets.len(), 6);
        assert!((targets[0].as_f64().unwrap() - 1.1).abs() < 1.0e-6);
        assert!((targets[5].as_f64().unwrap() - 6.7).abs() < 1.0e-6);
        assert_eq!(payload["pipeline"]["cross_validation"]["n_splits"], 3);
        assert_eq!(payload["options"]["random_state"], 42);
        assert!(serde_json::to_vec(&payload).unwrap().len() < 65_536);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn refuses_integer_targets_that_the_selected_callable_detects_as_classification() {
        let (root, config, workspace) = fixture("integer-target");
        fs::write(root.join("dataset/y.csv"), "protein\n1\n2\n3\n4\n5\n6\n").unwrap();
        assert_eq!(
            ScientificRequestResolver::new(&config)
                .resolve(&submission(&workspace, "local-python")),
            Err(ScientificResolveError::UnsupportedSubmission)
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rejects_backend_id_mismatch_grouping_and_test_partition() {
        let (root, config, workspace) = fixture("refusals");
        let resolver = ScientificRequestResolver::new(&config);
        assert_eq!(
            resolver.resolve(&submission(&workspace, "cluster")),
            Err(ScientificResolveError::UnsupportedSubmission)
        );
        let mut mismatch = submission(&workspace, "local-python");
        mismatch.payload["legacyConfig"]["pipeline_ids"] = json!(["other"]);
        assert_eq!(
            resolver.resolve(&mismatch),
            Err(ScientificResolveError::InvalidSubmission)
        );
        let mut grouping = submission(&workspace, "local-python");
        grouping.payload["strictCampaignSpecs"]["splitSpecs"][0]["campaign"]["datasets"][0]
            ["splitGroupBy"] = json!("subject");
        assert_eq!(
            resolver.resolve(&grouping),
            Err(ScientificResolveError::UnsupportedSubmission)
        );
        let links_path = config.join(DATASET_LINKS_FILE);
        let mut links: Value = serde_json::from_slice(&fs::read(&links_path).unwrap()).unwrap();
        links["datasets"][0]["config"]["files"][1]["split"] = json!("test");
        fs::write(&links_path, serde_json::to_vec(&links).unwrap()).unwrap();
        assert_eq!(
            resolver.resolve(&submission(&workspace, "local-python")),
            Err(ScientificResolveError::UnsupportedSubmission)
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn rejects_symlinked_pipeline_and_dataset_sources() {
        use std::os::unix::fs::symlink;

        let (root, config, workspace) = fixture("symlinks");
        let pipeline = workspace.join("pipelines/pipeline-a.json");
        let outside = root.join("outside-pipeline.json");
        fs::rename(&pipeline, &outside).unwrap();
        symlink(&outside, &pipeline).unwrap();
        assert_eq!(
            ScientificRequestResolver::new(&config)
                .resolve(&submission(&workspace, "local-python")),
            Err(ScientificResolveError::PipelineUnsafe)
        );
        fs::remove_file(&pipeline).unwrap();
        fs::rename(&outside, &pipeline).unwrap();
        let x = root.join("dataset/x.csv");
        let outside_x = root.join("outside-x.csv");
        fs::rename(&x, &outside_x).unwrap();
        symlink(&outside_x, &x).unwrap();
        assert_eq!(
            ScientificRequestResolver::new(&config)
                .resolve(&submission(&workspace, "local-python")),
            Err(ScientificResolveError::DatasetAssembly)
        );
        fs::remove_dir_all(root).unwrap();
    }
}
