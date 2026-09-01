//! Closed validation contract for the native run-group submission transport.
//!
//! Rust validates and transports this manifest but deliberately does not
//! interpret pipeline steps, dataset schema projections, or robustness
//! scenarios. Those explicitly named values remain bounded scientific payloads
//! for a separately selected executor.

use std::collections::BTreeSet;

use serde_json::{Map, Value};

use crate::MAX_REQUEST_BODY_BYTES;

pub const SCIENTIFIC_SUBMISSION_ROUTE: &str = "/api/runs/run-groups";
pub const SCIENTIFIC_SUBMISSION_CONTRACT: &str =
    include_str!("../contracts/studio_scientific_submission_v1.json");
pub const MAX_SCIENTIFIC_SPLIT_SPECS: usize = 64;
const MAX_COLLECTION_ITEMS: usize = 256;
const MAX_STRING_BYTES: usize = 4096;
const MAX_NESTING_DEPTH: usize = 16;

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ScientificSubmissionValidationError {
    BodyTooLarge,
    InvalidJson,
    InvalidShape(&'static str),
    Unsupported(&'static str),
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ValidatedScientificSubmission {
    payload: Value,
    run_name: String,
    requested_backend: String,
}

impl ValidatedScientificSubmission {
    #[must_use]
    pub const fn payload(&self) -> &Value {
        &self.payload
    }

    #[must_use]
    pub fn run_name(&self) -> &str {
        &self.run_name
    }

    #[must_use]
    pub fn requested_backend(&self) -> &str {
        &self.requested_backend
    }
}

/// Validate the exact native run-group envelope before any workspace or
/// executor access.
///
/// # Errors
///
/// Rejects oversized, malformed, unknown, inconsistent, skipped, legacy, and
/// fallback-enabled submissions.
pub fn validate_scientific_submission(
    body: &[u8],
) -> Result<ValidatedScientificSubmission, ScientificSubmissionValidationError> {
    validate_contract()?;
    if body.len() > MAX_REQUEST_BODY_BYTES {
        return Err(ScientificSubmissionValidationError::BodyTooLarge);
    }
    let payload: Value = serde_json::from_slice(body)
        .map_err(|_| ScientificSubmissionValidationError::InvalidJson)?;
    validate_bounded_json(&payload, 0)?;
    let root = object_with_exact_keys(
        &payload,
        &["legacyConfig", "manifest", "strictCampaignSpecs"],
        &["legacyConfig", "manifest", "strictCampaignSpecs"],
        "root",
    )?;
    let (run_name, requested_backend, legacy_counts) =
        validate_legacy_config(required(root, "legacyConfig")?)?;
    let split_specs =
        validate_strict_specs(required(root, "strictCampaignSpecs")?, &requested_backend)?;
    validate_manifest(
        required(root, "manifest")?,
        &run_name,
        legacy_counts,
        &split_specs,
    )?;
    Ok(ValidatedScientificSubmission {
        payload,
        run_name,
        requested_backend,
    })
}

#[derive(Clone, Copy)]
struct LegacyCounts {
    datasets: usize,
    pipelines: usize,
}

#[derive(Clone)]
struct SplitIdentity {
    source_run_id: String,
}

fn validate_legacy_config(
    value: &Value,
) -> Result<(String, String, LegacyCounts), ScientificSubmissionValidationError> {
    let object = object_with_exact_keys(
        value,
        &["name", "dataset_ids", "pipeline_ids"],
        &[
            "name",
            "description",
            "dataset_ids",
            "pipeline_ids",
            "execution_backend",
            "engine",
            "allow_fallback",
            "robustness",
            "cv_folds",
            "cv_strategy",
            "test_size",
            "shuffle",
            "random_state",
            "inline_pipeline",
            "inline_pipelines",
            "project_id",
            "split_group_by_by_dataset",
        ],
        "legacyConfig",
    )?;
    let name = text(required(object, "name")?, "legacyConfig.name")?.to_owned();
    optional_text(object.get("description"), "legacyConfig.description", true)?;
    let dataset_ids = identity_array(
        required(object, "dataset_ids")?,
        "legacyConfig.dataset_ids",
        false,
    )?;
    let pipeline_ids = identity_array(
        required(object, "pipeline_ids")?,
        "legacyConfig.pipeline_ids",
        true,
    )?;
    let requested_backend = text(
        object.get("execution_backend").ok_or(
            ScientificSubmissionValidationError::InvalidShape(
                "legacyConfig.execution_backend is required",
            ),
        )?,
        "legacyConfig.execution_backend",
    )?;
    if !matches!(requested_backend, "local-python" | "cluster" | "wasm-local") {
        return Err(ScientificSubmissionValidationError::Unsupported(
            "legacyConfig.execution_backend is not supported",
        ));
    }
    if object.get("engine").and_then(Value::as_str) != Some("dag-ml") {
        return Err(ScientificSubmissionValidationError::Unsupported(
            "legacyConfig.engine must be dag-ml",
        ));
    }
    if object
        .get("allow_fallback")
        .is_some_and(|value| value != &Value::Bool(false))
    {
        return Err(ScientificSubmissionValidationError::Unsupported(
            "legacyConfig.allow_fallback must be false",
        ));
    }
    validate_legacy_runtime_options(object)?;
    let pipeline_count = pipeline_ids.len() + validate_legacy_inline_pipelines(object)?;
    validate_robustness(object.get("robustness"))?;
    if pipeline_count == 0 {
        return Err(ScientificSubmissionValidationError::InvalidShape(
            "legacyConfig must select at least one pipeline",
        ));
    }
    Ok((
        name,
        requested_backend.to_owned(),
        LegacyCounts {
            datasets: dataset_ids.len(),
            pipelines: pipeline_count,
        },
    ))
}

fn validate_legacy_runtime_options(
    object: &Map<String, Value>,
) -> Result<(), ScientificSubmissionValidationError> {
    optional_integer_range(object.get("cv_folds"), 2, 50, "legacyConfig.cv_folds")?;
    if let Some(strategy) = object.get("cv_strategy") {
        let strategy = text(strategy, "legacyConfig.cv_strategy")?;
        if !matches!(strategy, "kfold" | "stratified" | "loo" | "holdout") {
            return Err(ScientificSubmissionValidationError::Unsupported(
                "legacyConfig.cv_strategy is not supported",
            ));
        }
    }
    if let Some(test_size) = object.get("test_size") {
        if !test_size.is_null()
            && !test_size
                .as_f64()
                .is_some_and(|value| value.is_finite() && (0.1..=0.5).contains(&value))
        {
            return Err(ScientificSubmissionValidationError::InvalidShape(
                "legacyConfig.test_size must be null or a finite number in 0.1..=0.5",
            ));
        }
    }
    optional_bool(object.get("shuffle"), "legacyConfig.shuffle")?;
    optional_nullable_integer(object.get("random_state"), "legacyConfig.random_state")?;
    optional_text(object.get("project_id"), "legacyConfig.project_id", true)?;
    validate_grouping_map(object.get("split_group_by_by_dataset"))
}

fn validate_legacy_inline_pipelines(
    object: &Map<String, Value>,
) -> Result<usize, ScientificSubmissionValidationError> {
    let inline_count = validate_inline_pipeline(object.get("inline_pipeline"))?;
    let inline_many = match object.get("inline_pipelines") {
        None => 0,
        Some(Value::Array(values)) => {
            if values.len() > MAX_COLLECTION_ITEMS {
                return Err(ScientificSubmissionValidationError::InvalidShape(
                    "legacyConfig.inline_pipelines is too large",
                ));
            }
            for value in values {
                validate_inline_pipeline(Some(value))?;
            }
            values.len()
        }
        Some(_) => {
            return Err(ScientificSubmissionValidationError::InvalidShape(
                "legacyConfig.inline_pipelines must be an array",
            ));
        }
    };
    Ok(inline_count + inline_many)
}

fn validate_inline_pipeline(
    value: Option<&Value>,
) -> Result<usize, ScientificSubmissionValidationError> {
    let Some(value) = value else { return Ok(0) };
    if value.is_null() {
        return Ok(0);
    }
    let object = object_with_exact_keys(
        value,
        &["name", "steps"],
        &["name", "steps"],
        "inline pipeline",
    )?;
    text(required(object, "name")?, "inline pipeline name")?;
    bounded_array(required(object, "steps")?, "inline pipeline steps", true)?;
    Ok(1)
}

fn validate_robustness(value: Option<&Value>) -> Result<(), ScientificSubmissionValidationError> {
    let Some(value) = value else { return Ok(()) };
    if value.is_null() {
        return Ok(());
    }
    let object = object_with_exact_keys(
        value,
        &["scenarios"],
        &["mode", "scenarios", "slice_by", "publish_evidence"],
        "legacyConfig.robustness",
    )?;
    if let Some(mode) = object.get("mode") {
        if text(mode, "legacyConfig.robustness.mode")? != "clean_frozen" {
            return Err(ScientificSubmissionValidationError::Unsupported(
                "legacyConfig.robustness.mode is not supported",
            ));
        }
    }
    bounded_array(
        required(object, "scenarios")?,
        "legacyConfig.robustness.scenarios",
        true,
    )?;
    if let Some(slice_by) = object.get("slice_by") {
        identity_array(slice_by, "legacyConfig.robustness.slice_by", true)?;
    }
    if let Some(publication) = object.get("publish_evidence") {
        if !publication.is_object() {
            return Err(ScientificSubmissionValidationError::InvalidShape(
                "legacyConfig.robustness.publish_evidence must be an object",
            ));
        }
    }
    Ok(())
}

fn validate_grouping_map(value: Option<&Value>) -> Result<(), ScientificSubmissionValidationError> {
    let Some(value) = value else { return Ok(()) };
    let object = value
        .as_object()
        .ok_or(ScientificSubmissionValidationError::InvalidShape(
            "legacyConfig.split_group_by_by_dataset must be an object",
        ))?;
    if object.len() > MAX_COLLECTION_ITEMS {
        return Err(ScientificSubmissionValidationError::InvalidShape(
            "legacyConfig.split_group_by_by_dataset is too large",
        ));
    }
    for (key, value) in object {
        identity(key, "grouping dataset id")?;
        optional_text(Some(value), "grouping column", true)?;
    }
    Ok(())
}

fn validate_strict_specs(
    value: &Value,
    requested_backend: &str,
) -> Result<Vec<SplitIdentity>, ScientificSubmissionValidationError> {
    let object = object_with_exact_keys(
        value,
        &["splitSpecs", "skippedRunIds"],
        &["splitSpecs", "skippedRunIds"],
        "strictCampaignSpecs",
    )?;
    let skipped = identity_array(
        required(object, "skippedRunIds")?,
        "strictCampaignSpecs.skippedRunIds",
        true,
    )?;
    if !skipped.is_empty() {
        return Err(ScientificSubmissionValidationError::Unsupported(
            "strictCampaignSpecs.skippedRunIds must be empty",
        ));
    }
    let specs = bounded_array(
        required(object, "splitSpecs")?,
        "strictCampaignSpecs.splitSpecs",
        false,
    )?;
    if specs.len() > MAX_SCIENTIFIC_SPLIT_SPECS {
        return Err(ScientificSubmissionValidationError::InvalidShape(
            "strictCampaignSpecs.splitSpecs exceeds 64 entries",
        ));
    }
    let mut identities = Vec::with_capacity(specs.len());
    let mut ids = BTreeSet::new();
    for spec in specs {
        let object = object_with_exact_keys(
            spec,
            &[
                "id",
                "sourceRunId",
                "sourceDatasetId",
                "sourcePipelineId",
                "campaign",
            ],
            &[
                "id",
                "sourceRunId",
                "sourceDatasetId",
                "sourcePipelineId",
                "campaign",
            ],
            "split spec",
        )?;
        let id = identity(
            text(required(object, "id")?, "split spec id")?,
            "split spec id",
        )?;
        if !ids.insert(id.to_owned()) {
            return Err(ScientificSubmissionValidationError::InvalidShape(
                "split spec ids must be unique",
            ));
        }
        let source_run_id = identity(
            text(required(object, "sourceRunId")?, "sourceRunId")?,
            "sourceRunId",
        )?;
        let source_dataset_id = identity(
            text(required(object, "sourceDatasetId")?, "sourceDatasetId")?,
            "sourceDatasetId",
        )?;
        let source_pipeline_id = identity(
            text(required(object, "sourcePipelineId")?, "sourcePipelineId")?,
            "sourcePipelineId",
        )?;
        validate_campaign(
            required(object, "campaign")?,
            source_dataset_id,
            source_pipeline_id,
            requested_backend,
        )?;
        identities.push(SplitIdentity {
            source_run_id: source_run_id.to_owned(),
        });
    }
    Ok(identities)
}

fn validate_campaign(
    value: &Value,
    source_dataset_id: &str,
    source_pipeline_id: &str,
    requested_backend: &str,
) -> Result<(), ScientificSubmissionValidationError> {
    let object = object_with_exact_keys(
        value,
        &[
            "name",
            "mode",
            "executionBackend",
            "datasets",
            "pipelines",
            "runMatrix",
        ],
        &[
            "name",
            "description",
            "mode",
            "executionBackend",
            "datasets",
            "pipelines",
            "runMatrix",
        ],
        "campaign",
    )?;
    text(required(object, "name")?, "campaign.name")?;
    optional_text(object.get("description"), "campaign.description", false)?;
    if required(object, "mode")?.as_str() != Some("paired_by_index") {
        return Err(ScientificSubmissionValidationError::Unsupported(
            "campaign.mode must be paired_by_index",
        ));
    }
    let backend = text(
        required(object, "executionBackend")?,
        "campaign.executionBackend",
    )?;
    if !matches!(backend, "local-python" | "cluster" | "wasm-local") {
        return Err(ScientificSubmissionValidationError::Unsupported(
            "campaign.executionBackend is not supported",
        ));
    }
    if backend != requested_backend {
        return Err(ScientificSubmissionValidationError::InvalidShape(
            "campaign.executionBackend does not match legacyConfig.execution_backend",
        ));
    }
    let datasets = exact_one_array(required(object, "datasets")?, "campaign.datasets")?;
    let pipelines = exact_one_array(required(object, "pipelines")?, "campaign.pipelines")?;
    let runs = exact_one_array(required(object, "runMatrix")?, "campaign.runMatrix")?;
    validate_dataset_ref(&datasets[0], source_dataset_id)?;
    validate_pipeline_ref(&pipelines[0], source_pipeline_id)?;
    validate_run_entry(&runs[0], source_dataset_id, source_pipeline_id)?;
    Ok(())
}

fn validate_dataset_ref(
    value: &Value,
    source_id: &str,
) -> Result<(), ScientificSubmissionValidationError> {
    let object = object_with_exact_keys(
        value,
        &["id", "splitGroupBy"],
        &["id", "name", "schema", "schemaRef", "splitGroupBy"],
        "campaign dataset",
    )?;
    if text(required(object, "id")?, "campaign dataset id")? != source_id {
        return Err(ScientificSubmissionValidationError::InvalidShape(
            "campaign dataset id does not match sourceDatasetId",
        ));
    }
    optional_text(object.get("name"), "campaign dataset name", false)?;
    optional_text(object.get("splitGroupBy"), "campaign splitGroupBy", true)?;
    for key in ["schema", "schemaRef"] {
        if object.get(key).is_some_and(|value| !value.is_object()) {
            return Err(ScientificSubmissionValidationError::InvalidShape(
                "campaign dataset schema projections must be objects",
            ));
        }
    }
    Ok(())
}

fn validate_pipeline_ref(
    value: &Value,
    source_id: &str,
) -> Result<(), ScientificSubmissionValidationError> {
    let object = object_with_exact_keys(
        value,
        &["id", "name", "source"],
        &[
            "id",
            "name",
            "source",
            "steps",
            "stepCount",
            "stepSummary",
            "graph",
        ],
        "campaign pipeline",
    )?;
    if text(required(object, "id")?, "campaign pipeline id")? != source_id {
        return Err(ScientificSubmissionValidationError::InvalidShape(
            "campaign pipeline id does not match sourcePipelineId",
        ));
    }
    text(required(object, "name")?, "campaign pipeline name")?;
    let source = text(required(object, "source")?, "campaign pipeline source")?;
    if !matches!(source, "saved" | "inline" | "inline-pruned") {
        return Err(ScientificSubmissionValidationError::Unsupported(
            "campaign pipeline source is not supported",
        ));
    }
    match object.get("steps") {
        Some(steps) => {
            bounded_array(steps, "campaign pipeline steps", true)?;
        }
        None if matches!(source, "inline" | "inline-pruned") => {
            return Err(ScientificSubmissionValidationError::InvalidShape(
                "inline campaign pipeline requires steps",
            ));
        }
        None => {}
    }
    optional_integer_range(object.get("stepCount"), 0, 1_000_000, "stepCount")?;
    optional_text(object.get("stepSummary"), "stepSummary", true)?;
    if object.get("graph").is_some_and(|value| !value.is_object()) {
        return Err(ScientificSubmissionValidationError::InvalidShape(
            "campaign pipeline graph must be an object",
        ));
    }
    Ok(())
}

fn validate_run_entry(
    value: &Value,
    source_dataset_id: &str,
    source_pipeline_id: &str,
) -> Result<(), ScientificSubmissionValidationError> {
    let object = object_with_exact_keys(
        value,
        &[
            "id",
            "datasetId",
            "pipelineId",
            "datasetIndex",
            "pipelineIndex",
            "splitGroupBy",
        ],
        &[
            "id",
            "datasetId",
            "pipelineId",
            "datasetIndex",
            "pipelineIndex",
            "splitGroupBy",
        ],
        "campaign run entry",
    )?;
    identity(
        text(required(object, "id")?, "campaign run id")?,
        "campaign run id",
    )?;
    if required(object, "datasetId")?.as_str() != Some(source_dataset_id)
        || required(object, "pipelineId")?.as_str() != Some(source_pipeline_id)
    {
        return Err(ScientificSubmissionValidationError::InvalidShape(
            "campaign run ids do not match source ids",
        ));
    }
    for key in ["datasetIndex", "pipelineIndex"] {
        if required(object, key)?.as_u64() != Some(0) {
            return Err(ScientificSubmissionValidationError::InvalidShape(
                "single-pair campaign indices must be zero",
            ));
        }
    }
    optional_text(
        object.get("splitGroupBy"),
        "campaign run splitGroupBy",
        true,
    )?;
    Ok(())
}

fn validate_manifest(
    value: &Value,
    run_name: &str,
    counts: LegacyCounts,
    specs: &[SplitIdentity],
) -> Result<(), ScientificSubmissionValidationError> {
    let object = object_with_exact_keys(
        value,
        &[
            "version",
            "legacyExperimentName",
            "legacyDatasetCount",
            "legacyPipelineCount",
            "strictCampaignCount",
            "skippedRunCount",
            "sourceRunIds",
            "skippedRunIds",
        ],
        &[
            "version",
            "legacyExperimentName",
            "legacyDatasetCount",
            "legacyPipelineCount",
            "robustnessEvidencePublicationHandoff",
            "strictCampaignCount",
            "skippedRunCount",
            "sourceRunIds",
            "skippedRunIds",
        ],
        "manifest",
    )?;
    if required(object, "version")?.as_str() != Some("studio.native-launch-payload.v1") {
        return Err(ScientificSubmissionValidationError::Unsupported(
            "manifest.version is not supported",
        ));
    }
    if required(object, "legacyExperimentName")?.as_str() != Some(run_name) {
        return Err(ScientificSubmissionValidationError::InvalidShape(
            "manifest legacyExperimentName does not match legacyConfig.name",
        ));
    }
    if required(object, "legacyDatasetCount")?.as_u64() != Some(counts.datasets as u64)
        || required(object, "legacyPipelineCount")?.as_u64() != Some(counts.pipelines as u64)
        || required(object, "strictCampaignCount")?.as_u64() != Some(specs.len() as u64)
    {
        return Err(ScientificSubmissionValidationError::InvalidShape(
            "manifest counts do not match the payload",
        ));
    }
    if required(object, "skippedRunCount")?.as_u64() != Some(0) {
        return Err(ScientificSubmissionValidationError::Unsupported(
            "manifest.skippedRunCount must be zero",
        ));
    }
    if !identity_array(
        required(object, "skippedRunIds")?,
        "manifest.skippedRunIds",
        true,
    )?
    .is_empty()
    {
        return Err(ScientificSubmissionValidationError::Unsupported(
            "manifest.skippedRunIds must be empty",
        ));
    }
    let source_ids = identity_array(
        required(object, "sourceRunIds")?,
        "manifest.sourceRunIds",
        true,
    )?;
    if source_ids
        != specs
            .iter()
            .map(|spec| spec.source_run_id.as_str())
            .collect::<Vec<_>>()
    {
        return Err(ScientificSubmissionValidationError::InvalidShape(
            "manifest.sourceRunIds does not match splitSpecs",
        ));
    }
    if let Some(handoff) = object.get("robustnessEvidencePublicationHandoff") {
        validate_robustness_handoff(handoff)?;
    }
    Ok(())
}

fn validate_robustness_handoff(value: &Value) -> Result<(), ScientificSubmissionValidationError> {
    let object = object_with_exact_keys(
        value,
        &[
            "kind",
            "requested",
            "destination",
            "failClosed",
            "keywordIds",
            "requiredEffects",
            "conformalArtifactPolicy",
            "alignmentStrategies",
            "publishedFields",
        ],
        &[
            "kind",
            "requested",
            "destination",
            "failClosed",
            "keywordIds",
            "requiredEffects",
            "conformalArtifactPolicy",
            "alignmentStrategies",
            "publishedFields",
        ],
        "robustnessEvidencePublicationHandoff",
    )?;
    if required(object, "kind")?.as_str() != Some("robustness_evidence_publication_handoff")
        || required(object, "requested")? != &Value::Bool(true)
        || required(object, "destination")?.as_str() != Some("result_metadata.robustness_evidence")
        || !required(object, "failClosed")?.is_boolean()
        || required(object, "conformalArtifactPolicy")?.as_str()
            != Some("prediction_publisher_does_not_persist_conformal_artifacts")
    {
        return Err(ScientificSubmissionValidationError::InvalidShape(
            "robustnessEvidencePublicationHandoff constants are invalid",
        ));
    }
    exact_string_array(
        required(object, "keywordIds")?,
        &[
            "predict.save_to_workspace",
            "predict.workspace_metadata",
            "predict.workspace_result_metadata",
        ],
        "robustnessEvidencePublicationHandoff.keywordIds",
    )?;
    exact_string_array(
        required(object, "requiredEffects")?,
        &[
            "workspace_prediction_rows",
            "prediction_arrays",
            "result_metadata",
            "workspace_prediction_id",
            "prediction_sample_metadata",
            "robustness_evidence",
        ],
        "robustnessEvidencePublicationHandoff.requiredEffects",
    )?;
    exact_string_array(
        required(object, "alignmentStrategies")?,
        &[
            "sample_indices",
            "full_dataset_length",
            "unique_metadata_identity",
            "relation_manifest_identity",
        ],
        "robustnessEvidencePublicationHandoff.alignmentStrategies",
    )?;
    exact_string_array(
        required(object, "publishedFields")?,
        &[
            "prediction_arrays.X",
            "result_metadata.robustness_evidence.X",
            "result_metadata.robustness_evidence.predictor_bundle",
        ],
        "robustnessEvidencePublicationHandoff.publishedFields",
    )?;
    Ok(())
}

fn validate_contract() -> Result<(), ScientificSubmissionValidationError> {
    let contract: Value = serde_json::from_str(SCIENTIFIC_SUBMISSION_CONTRACT)
        .map_err(|_| ScientificSubmissionValidationError::InvalidJson)?;
    if contract.get("schema_id").and_then(Value::as_str)
        != Some("nirs4all.studio-scientific-submission.v1")
        || contract.get("schema_version").and_then(Value::as_u64) != Some(1)
        || contract
            .pointer("/route/maximum_body_bytes")
            .and_then(Value::as_u64)
            != Some(MAX_REQUEST_BODY_BYTES as u64)
        || contract
            .pointer("/accepted_submission/http_status")
            .and_then(Value::as_u64)
            != Some(202)
    {
        return Err(ScientificSubmissionValidationError::InvalidShape(
            "scientific submission contract is incompatible",
        ));
    }
    Ok(())
}

fn validate_bounded_json(
    value: &Value,
    depth: usize,
) -> Result<(), ScientificSubmissionValidationError> {
    if depth > MAX_NESTING_DEPTH {
        return Err(ScientificSubmissionValidationError::InvalidShape(
            "JSON nesting exceeds the native limit",
        ));
    }
    match value {
        Value::Object(object) => {
            if object.len() > MAX_COLLECTION_ITEMS {
                return Err(ScientificSubmissionValidationError::InvalidShape(
                    "JSON object exceeds the native field limit",
                ));
            }
            for (key, value) in object {
                if key.is_empty() || key.len() > 128 || key.chars().any(char::is_control) {
                    return Err(ScientificSubmissionValidationError::InvalidShape(
                        "JSON object contains an invalid key",
                    ));
                }
                validate_bounded_json(value, depth + 1)?;
            }
        }
        Value::Array(values) => {
            if values.len() > MAX_COLLECTION_ITEMS {
                return Err(ScientificSubmissionValidationError::InvalidShape(
                    "JSON array exceeds the native item limit",
                ));
            }
            for value in values {
                validate_bounded_json(value, depth + 1)?;
            }
        }
        Value::String(value) if value.len() > MAX_STRING_BYTES => {
            return Err(ScientificSubmissionValidationError::InvalidShape(
                "JSON string exceeds the native byte limit",
            ));
        }
        Value::Number(number) if !number.as_f64().is_some_and(f64::is_finite) => {
            return Err(ScientificSubmissionValidationError::InvalidShape(
                "JSON number must be finite",
            ));
        }
        Value::Null | Value::Bool(_) | Value::Number(_) | Value::String(_) => {}
    }
    Ok(())
}

fn object_with_exact_keys<'a>(
    value: &'a Value,
    required_keys: &[&str],
    allowed_keys: &[&str],
    label: &'static str,
) -> Result<&'a Map<String, Value>, ScientificSubmissionValidationError> {
    let object = value
        .as_object()
        .ok_or(ScientificSubmissionValidationError::InvalidShape(label))?;
    if required_keys.iter().any(|key| !object.contains_key(*key))
        || object
            .keys()
            .any(|key| !allowed_keys.contains(&key.as_str()))
    {
        return Err(ScientificSubmissionValidationError::InvalidShape(label));
    }
    Ok(object)
}

fn required<'a>(
    object: &'a Map<String, Value>,
    key: &'static str,
) -> Result<&'a Value, ScientificSubmissionValidationError> {
    object
        .get(key)
        .ok_or(ScientificSubmissionValidationError::InvalidShape(key))
}

fn text<'a>(
    value: &'a Value,
    label: &'static str,
) -> Result<&'a str, ScientificSubmissionValidationError> {
    value
        .as_str()
        .filter(|value| !value.is_empty() && !value.chars().any(char::is_control))
        .ok_or(ScientificSubmissionValidationError::InvalidShape(label))
}

fn identity<'a>(
    value: &'a str,
    label: &'static str,
) -> Result<&'a str, ScientificSubmissionValidationError> {
    if value.len() <= 256
        && !matches!(value, "." | "..")
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b':'))
    {
        Ok(value)
    } else {
        Err(ScientificSubmissionValidationError::InvalidShape(label))
    }
}

fn optional_text(
    value: Option<&Value>,
    label: &'static str,
    nullable: bool,
) -> Result<(), ScientificSubmissionValidationError> {
    match value {
        None => Ok(()),
        Some(Value::Null) if nullable => Ok(()),
        Some(value) => text(value, label).map(|_| ()),
    }
}

const fn optional_bool(
    value: Option<&Value>,
    label: &'static str,
) -> Result<(), ScientificSubmissionValidationError> {
    match value {
        None | Some(Value::Bool(_)) => Ok(()),
        Some(_) => Err(ScientificSubmissionValidationError::InvalidShape(label)),
    }
}

fn optional_nullable_integer(
    value: Option<&Value>,
    label: &'static str,
) -> Result<(), ScientificSubmissionValidationError> {
    match value {
        None | Some(Value::Null) => Ok(()),
        Some(value) if value.as_i64().is_some() || value.as_u64().is_some() => Ok(()),
        Some(_) => Err(ScientificSubmissionValidationError::InvalidShape(label)),
    }
}

fn optional_integer_range(
    value: Option<&Value>,
    minimum: u64,
    maximum: u64,
    label: &'static str,
) -> Result<(), ScientificSubmissionValidationError> {
    match value {
        None => Ok(()),
        Some(value)
            if value
                .as_u64()
                .is_some_and(|value| (minimum..=maximum).contains(&value)) =>
        {
            Ok(())
        }
        Some(_) => Err(ScientificSubmissionValidationError::InvalidShape(label)),
    }
}

fn identity_array<'a>(
    value: &'a Value,
    label: &'static str,
    allow_empty: bool,
) -> Result<Vec<&'a str>, ScientificSubmissionValidationError> {
    let values = bounded_array(value, label, allow_empty)?;
    let mut seen = BTreeSet::new();
    let mut output = Vec::with_capacity(values.len());
    for value in values {
        let value = identity(text(value, label)?, label)?;
        if !seen.insert(value) {
            return Err(ScientificSubmissionValidationError::InvalidShape(label));
        }
        output.push(value);
    }
    Ok(output)
}

fn bounded_array<'a>(
    value: &'a Value,
    label: &'static str,
    allow_empty: bool,
) -> Result<&'a [Value], ScientificSubmissionValidationError> {
    let values = value
        .as_array()
        .ok_or(ScientificSubmissionValidationError::InvalidShape(label))?;
    if values.len() > MAX_COLLECTION_ITEMS || (!allow_empty && values.is_empty()) {
        return Err(ScientificSubmissionValidationError::InvalidShape(label));
    }
    Ok(values)
}

fn exact_one_array<'a>(
    value: &'a Value,
    label: &'static str,
) -> Result<&'a [Value], ScientificSubmissionValidationError> {
    let values = bounded_array(value, label, false)?;
    if values.len() != 1 {
        return Err(ScientificSubmissionValidationError::InvalidShape(label));
    }
    Ok(values)
}

fn exact_string_array(
    value: &Value,
    expected: &[&str],
    label: &'static str,
) -> Result<(), ScientificSubmissionValidationError> {
    let values = bounded_array(value, label, expected.is_empty())?;
    if values.len() != expected.len()
        || values
            .iter()
            .zip(expected)
            .any(|(actual, expected)| actual.as_str() != Some(expected))
    {
        return Err(ScientificSubmissionValidationError::InvalidShape(label));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn payload() -> Value {
        json!({
            "legacyConfig": {
                "name": "Native campaign",
                "dataset_ids": ["dataset-a"],
                "pipeline_ids": ["pipeline-a"],
                "execution_backend": "cluster",
                "engine": "dag-ml",
                "allow_fallback": false,
                "cv_folds": 5
            },
            "manifest": {
                "version": "studio.native-launch-payload.v1",
                "legacyExperimentName": "Native campaign",
                "legacyDatasetCount": 1,
                "legacyPipelineCount": 1,
                "strictCampaignCount": 1,
                "skippedRunCount": 0,
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
                        "name": "Native campaign / Dataset A / Pipeline A",
                        "mode": "paired_by_index",
                        "executionBackend": "cluster",
                        "datasets": [{"id": "dataset-a", "name": "Dataset A", "splitGroupBy": null}],
                        "pipelines": [{"id": "pipeline-a", "name": "Pipeline A", "source": "saved"}],
                        "runMatrix": [{
                            "id": "dataset-a::pipeline-a",
                            "datasetId": "dataset-a",
                            "pipelineId": "pipeline-a",
                            "datasetIndex": 0,
                            "pipelineIndex": 0,
                            "splitGroupBy": null
                        }]
                    }
                }],
                "skippedRunIds": []
            }
        })
    }

    #[test]
    fn accepts_the_closed_native_shape() {
        let payload = payload();
        let validated =
            validate_scientific_submission(&serde_json::to_vec(&payload).unwrap()).unwrap();
        assert_eq!(validated.run_name(), "Native campaign");
        assert_eq!(validated.requested_backend(), "cluster");
    }

    #[test]
    fn rejects_unknown_legacy_fallback_and_skipped_fields() {
        let mut unknown = payload();
        unknown["legacyConfig"]["mystery"] = json!(true);
        assert!(matches!(
            validate_scientific_submission(&serde_json::to_vec(&unknown).unwrap()),
            Err(ScientificSubmissionValidationError::InvalidShape(_))
        ));

        let mut legacy = payload();
        legacy["legacyConfig"]["engine"] = json!("legacy");
        assert!(matches!(
            validate_scientific_submission(&serde_json::to_vec(&legacy).unwrap()),
            Err(ScientificSubmissionValidationError::Unsupported(_))
        ));

        let mut fallback = payload();
        fallback["legacyConfig"]["allow_fallback"] = json!(true);
        assert!(matches!(
            validate_scientific_submission(&serde_json::to_vec(&fallback).unwrap()),
            Err(ScientificSubmissionValidationError::Unsupported(_))
        ));

        let mut skipped = payload();
        skipped["manifest"]["skippedRunCount"] = json!(1);
        skipped["manifest"]["skippedRunIds"] = json!(["skipped"]);
        assert!(matches!(
            validate_scientific_submission(&serde_json::to_vec(&skipped).unwrap()),
            Err(ScientificSubmissionValidationError::Unsupported(_))
        ));

        let mut invalid_identity = payload();
        invalid_identity["legacyConfig"]["dataset_ids"] = json!(["../dataset-a"]);
        assert!(matches!(
            validate_scientific_submission(&serde_json::to_vec(&invalid_identity).unwrap()),
            Err(ScientificSubmissionValidationError::InvalidShape(_))
        ));
    }
}
