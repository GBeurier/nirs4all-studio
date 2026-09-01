//! Pure Studio composition for the Store-owned run-detail input.
//!
//! The nirs4all owner materializes splitter metadata and optional runtime
//! columns before this boundary.  This module only applies the frozen Studio
//! presentation policies; it never parses `expanded_config`, opens a database,
//! writes a cache, or selects the HTTP route.

use std::{
    collections::{BTreeSet, HashSet},
    error::Error,
    fmt,
    path::Path,
};

use serde_json::{json, Map, Value};

use crate::{settings::DatasetLinkIdentity, workspace_store::validate_run_detail_http_contract};

type JsonObject = Map<String, Value>;

pub const STUDIO_RUN_DETAIL_COMPOSITION_CONTRACT: &str =
    include_str!("../contracts/studio_run_detail_composition_v1.json");

const RUNTIME_FIELDS: [&str; 6] = [
    "engine",
    "engine_requested",
    "engine_diagnostics",
    "runtime_manifest",
    "fallback_policy",
    "native_result_refs",
];
const SPLITTER_FIELDS: [&str; 7] = [
    "splitter_class",
    "reference",
    "n_splits",
    "shuffle",
    "random_state",
    "test_size",
    "group_by",
];

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RunDetailCompositionError(String);

impl RunDetailCompositionError {
    fn invalid(detail: impl Into<String>) -> Self {
        Self(detail.into())
    }
}

impl fmt::Display for RunDetailCompositionError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            formatter,
            "invalid Studio run-detail owner input: {}",
            self.0
        )
    }
}

impl Error for RunDetailCompositionError {}

/// Compose the exact Store-v5 branch of the Studio run-detail response.
///
/// `owner_output` must be the immutable value returned by
/// `nirs4all.pipeline.storage.studio_run_detail_http_inputs_v1`. The function
/// rejects malformed, reordered, or provenance-inconsistent input rather than
/// reconstructing missing library-owned data.
///
/// # Errors
///
/// Returns [`RunDetailCompositionError`] when either frozen contract or the
/// owner value is incompatible with this consumer.
pub fn compose_store_run_detail(
    owner_output: &Value,
    linked_datasets: &[DatasetLinkIdentity],
) -> Result<Value, RunDetailCompositionError> {
    validate_contracts()?;
    let owner = object(owner_output, "owner output")?;
    if owner.get("source_branch").and_then(Value::as_str) != Some("store_v5") {
        return Err(RunDetailCompositionError::invalid(
            "source_branch must be store_v5",
        ));
    }

    let mut run = object(required(owner, "run_detail")?, "run_detail")?.clone();
    let pipeline_ids = pipeline_ids(&run)?;
    let splitters = aligned_rows(owner, "pipeline_splitters", &pipeline_ids)?;
    let runtimes = aligned_rows(owner, "pipeline_runtime", &pipeline_ids)?;
    validate_splitters(&splitters)?;
    validate_runtimes(&runtimes)?;
    let provenance = validate_runtime_provenance(owner, &runtimes)?;

    let results = array(required(owner, "results")?, "results")?;
    let results_count = required(owner, "results_count")?
        .as_u64()
        .and_then(|count| usize::try_from(count).ok())
        .ok_or_else(|| {
            RunDetailCompositionError::invalid("results_count must be a non-negative integer")
        })?;
    if results_count != results.len() {
        return Err(RunDetailCompositionError::invalid(
            "results_count must equal the owner results length",
        ));
    }
    validate_results(results, &run, &pipeline_ids)?;

    apply_splitter_policy(&mut run, &splitters)?;
    apply_runtime_policy(&mut run, &runtimes, &provenance)?;
    apply_dataset_policy(&mut run, linked_datasets)?;

    run.insert("results".into(), Value::Array(results.clone()));
    run.insert("results_count".into(), json!(results_count));
    Ok(Value::Object(run))
}

fn validate_contracts() -> Result<(), RunDetailCompositionError> {
    validate_run_detail_http_contract()
        .map_err(|error| RunDetailCompositionError::invalid(error.to_string()))?;
    let contract: Value = serde_json::from_str(STUDIO_RUN_DETAIL_COMPOSITION_CONTRACT)
        .map_err(|error| RunDetailCompositionError::invalid(error.to_string()))?;
    let expected_owner = json!({
        "contract": "nirs4all.studio-run-detail-http.v1",
        "contract_sha256": "8230963eeb317ccacf5fa83a29fec730a830ebbb81ead9d16629251a1993ab1e",
        "owner_commit": "f3d83a98e00847fc7bcb1904033a4316f3408a18",
        "required_source_branch": "store_v5",
        "splitter_materialization": "owner_output_only_consumer_must_not_parse_expanded_config",
        "ordered_arrays": ["run_detail.pipelines", "pipeline_splitters", "pipeline_runtime"],
        "alignment_key": "pipeline_id",
        "runtime_provenance_values": ["stored_column", "absent_in_store_v5"],
        "malformed_or_misaligned_input": "reject",
    });
    let expected_cutover = json!({
        "store_branch_composition_proven": true,
        "route_selection": "per_request_store_v5_and_owner_host_preflight",
        "blocked_on": [],
        "legacy_manifest_branch_proven": "selected_scientific_plugin_before_target_http",
        "fallback_after_native_selection": "none",
    });
    if contract.get("schema_id").and_then(Value::as_str)
        != Some("nirs4all.studio-run-detail-composition.v1")
        || contract.get("schema_version").and_then(Value::as_u64) != Some(1)
        || contract.get("owner_input") != Some(&expected_owner)
        || contract.get("cutover") != Some(&expected_cutover)
        || contract
            .pointer("/response_policy/writes_or_cache")
            .and_then(Value::as_str)
            != Some("forbidden")
        || contract
            .pointer("/response_policy/fallback_after_native_selection")
            .and_then(Value::as_str)
            != Some("none")
    {
        return Err(RunDetailCompositionError::invalid(
            "Studio composition contract differs from v1",
        ));
    }
    Ok(())
}

fn required<'a>(
    object: &'a Map<String, Value>,
    key: &str,
) -> Result<&'a Value, RunDetailCompositionError> {
    object
        .get(key)
        .ok_or_else(|| RunDetailCompositionError::invalid(format!("{key} is missing")))
}

fn object<'a>(
    value: &'a Value,
    field: &str,
) -> Result<&'a Map<String, Value>, RunDetailCompositionError> {
    value
        .as_object()
        .ok_or_else(|| RunDetailCompositionError::invalid(format!("{field} must be an object")))
}

fn array<'a>(value: &'a Value, field: &str) -> Result<&'a Vec<Value>, RunDetailCompositionError> {
    value
        .as_array()
        .ok_or_else(|| RunDetailCompositionError::invalid(format!("{field} must be an array")))
}

fn pipeline_ids(run: &Map<String, Value>) -> Result<Vec<String>, RunDetailCompositionError> {
    let pipelines = array(required(run, "pipelines")?, "run_detail.pipelines")?;
    pipelines
        .iter()
        .enumerate()
        .map(|(index, pipeline)| {
            object(pipeline, &format!("run_detail.pipelines[{index}]"))?
                .get("pipeline_id")
                .and_then(Value::as_str)
                .filter(|id| !id.is_empty())
                .map(str::to_owned)
                .ok_or_else(|| {
                    RunDetailCompositionError::invalid(format!(
                        "run_detail.pipelines[{index}].pipeline_id must be a non-empty string"
                    ))
                })
        })
        .collect()
}

fn aligned_rows(
    owner: &Map<String, Value>,
    field: &str,
    pipeline_ids: &[String],
) -> Result<Vec<Map<String, Value>>, RunDetailCompositionError> {
    let rows = array(required(owner, field)?, field)?;
    if rows.len() != pipeline_ids.len() {
        return Err(RunDetailCompositionError::invalid(format!(
            "{field} must align with run_detail.pipelines"
        )));
    }
    rows.iter()
        .zip(pipeline_ids)
        .enumerate()
        .map(|(index, (row, expected_id))| {
            let row = object(row, &format!("{field}[{index}]"))?;
            if row.get("pipeline_id").and_then(Value::as_str) != Some(expected_id) {
                return Err(RunDetailCompositionError::invalid(format!(
                    "{field}[{index}].pipeline_id is reordered or mismatched"
                )));
            }
            Ok(row.clone())
        })
        .collect()
}

fn validate_splitters(rows: &[Map<String, Value>]) -> Result<(), RunDetailCompositionError> {
    let expected_row_keys = BTreeSet::from(["pipeline_id", "splitter"]);
    let expected_splitter_keys = SPLITTER_FIELDS.into_iter().collect::<BTreeSet<_>>();
    for (index, row) in rows.iter().enumerate() {
        if row.keys().map(String::as_str).collect::<BTreeSet<_>>() != expected_row_keys {
            return Err(RunDetailCompositionError::invalid(format!(
                "pipeline_splitters[{index}] fields differ from the owner contract"
            )));
        }
        let Some(splitter) = row.get("splitter") else {
            unreachable!("the exact key set was already checked")
        };
        if splitter.is_null() {
            continue;
        }
        let splitter = object(splitter, &format!("pipeline_splitters[{index}].splitter"))?;
        if splitter.keys().map(String::as_str).collect::<BTreeSet<_>>() != expected_splitter_keys {
            return Err(RunDetailCompositionError::invalid(format!(
                "pipeline_splitters[{index}].splitter fields differ from the owner contract"
            )));
        }
        optional_string(splitter, "splitter_class", index, "pipeline_splitters")?;
        optional_string(splitter, "reference", index, "pipeline_splitters")?;
        optional_integer(splitter, "n_splits", index, "pipeline_splitters")?;
        optional_bool(splitter, "shuffle", index, "pipeline_splitters")?;
        optional_integer(splitter, "random_state", index, "pipeline_splitters")?;
        optional_number(splitter, "test_size", index, "pipeline_splitters")?;
        optional_string(splitter, "group_by", index, "pipeline_splitters")?;
    }
    Ok(())
}

fn validate_runtimes(rows: &[Map<String, Value>]) -> Result<(), RunDetailCompositionError> {
    let expected_keys = BTreeSet::from([
        "pipeline_id",
        "engine",
        "engine_requested",
        "engine_diagnostics",
        "runtime_manifest",
        "fallback_policy",
        "native_result_refs",
    ]);
    for (index, row) in rows.iter().enumerate() {
        if row.keys().map(String::as_str).collect::<BTreeSet<_>>() != expected_keys {
            return Err(RunDetailCompositionError::invalid(format!(
                "pipeline_runtime[{index}] fields differ from the owner contract"
            )));
        }
        optional_string(row, "engine", index, "pipeline_runtime")?;
        optional_string(row, "engine_requested", index, "pipeline_runtime")?;
        optional_array(row, "engine_diagnostics", index, "pipeline_runtime")?;
        optional_object(row, "runtime_manifest", index, "pipeline_runtime")?;
        optional_object(row, "fallback_policy", index, "pipeline_runtime")?;
        optional_array(row, "native_result_refs", index, "pipeline_runtime")?;
    }
    Ok(())
}

fn validate_runtime_provenance(
    owner: &Map<String, Value>,
    rows: &[Map<String, Value>],
) -> Result<Map<String, Value>, RunDetailCompositionError> {
    let provenance = object(
        required(owner, "runtime_column_provenance")?,
        "runtime_column_provenance",
    )?;
    if provenance
        .keys()
        .map(String::as_str)
        .collect::<BTreeSet<_>>()
        != RUNTIME_FIELDS.into_iter().collect::<BTreeSet<_>>()
    {
        return Err(RunDetailCompositionError::invalid(
            "runtime_column_provenance fields differ from the owner contract",
        ));
    }
    for field in RUNTIME_FIELDS {
        let value = provenance.get(field).and_then(Value::as_str);
        if !matches!(value, Some("stored_column" | "absent_in_store_v5")) {
            return Err(RunDetailCompositionError::invalid(format!(
                "runtime_column_provenance.{field} has an unsupported value"
            )));
        }
        if value == Some("absent_in_store_v5")
            && rows
                .iter()
                .any(|row| row.get(field).is_some_and(|value| !value.is_null()))
        {
            return Err(RunDetailCompositionError::invalid(format!(
                "pipeline_runtime.{field} must be null when the column is absent"
            )));
        }
    }
    Ok(provenance.clone())
}

fn validate_results(
    results: &[Value],
    run: &Map<String, Value>,
    pipeline_ids: &[String],
) -> Result<(), RunDetailCompositionError> {
    let pipelines = array(required(run, "pipelines")?, "run_detail.pipelines")?;
    if results.len() != pipeline_ids.len() {
        return Err(RunDetailCompositionError::invalid(
            "results must align with run_detail.pipelines",
        ));
    }
    for (index, (result, pipeline)) in results.iter().zip(pipelines).enumerate() {
        let pipeline = object(pipeline, &format!("run_detail.pipelines[{index}]"))?;
        let created_at = pipeline
            .get("created_at")
            .filter(|value| python_truthy(value))
            .cloned()
            .unwrap_or_else(|| Value::String(String::new()));
        let expected = json!({
            "id": pipeline_ids[index],
            "run_id": pipeline.get("run_id").cloned().unwrap_or_else(|| json!("")),
            "dataset": pipeline.get("dataset_name").cloned().unwrap_or_else(|| json!("")),
            "pipeline_config": pipeline.get("name").cloned().unwrap_or_else(|| json!("")),
            "pipeline_config_id": pipeline_ids[index],
            "created_at": created_at,
            "best_score": pipeline.get("best_val").cloned().unwrap_or(Value::Null),
            "best_test_score": pipeline.get("best_test").cloned().unwrap_or(Value::Null),
            "metric": pipeline.get("metric").cloned().unwrap_or_else(|| json!("")),
            "status": pipeline.get("status").cloned().unwrap_or_else(|| json!("")),
            "duration_ms": pipeline.get("duration_ms").cloned().unwrap_or(Value::Null),
            "format": "store",
        });
        if result != &expected {
            return Err(RunDetailCompositionError::invalid(format!(
                "results[{index}] differs from the owner pipeline mapping"
            )));
        }
    }
    Ok(())
}

fn optional_string(
    object: &Map<String, Value>,
    field: &str,
    index: usize,
    parent: &str,
) -> Result<(), RunDetailCompositionError> {
    validate_optional(object, field, index, parent, Value::is_string, "string")
}

fn optional_integer(
    object: &Map<String, Value>,
    field: &str,
    index: usize,
    parent: &str,
) -> Result<(), RunDetailCompositionError> {
    validate_optional(
        object,
        field,
        index,
        parent,
        |value| value.as_i64().is_some(),
        "integer",
    )
}

fn optional_number(
    object: &Map<String, Value>,
    field: &str,
    index: usize,
    parent: &str,
) -> Result<(), RunDetailCompositionError> {
    validate_optional(object, field, index, parent, Value::is_number, "number")
}

fn optional_bool(
    object: &Map<String, Value>,
    field: &str,
    index: usize,
    parent: &str,
) -> Result<(), RunDetailCompositionError> {
    validate_optional(object, field, index, parent, Value::is_boolean, "boolean")
}

fn optional_array(
    object: &Map<String, Value>,
    field: &str,
    index: usize,
    parent: &str,
) -> Result<(), RunDetailCompositionError> {
    validate_optional(object, field, index, parent, Value::is_array, "array")
}

fn optional_object(
    object: &Map<String, Value>,
    field: &str,
    index: usize,
    parent: &str,
) -> Result<(), RunDetailCompositionError> {
    validate_optional(object, field, index, parent, Value::is_object, "object")
}

fn validate_optional(
    object: &Map<String, Value>,
    field: &str,
    index: usize,
    parent: &str,
    predicate: impl Fn(&Value) -> bool,
    expected: &str,
) -> Result<(), RunDetailCompositionError> {
    let value = object.get(field).ok_or_else(|| {
        RunDetailCompositionError::invalid(format!("{parent}[{index}].{field} is missing"))
    })?;
    if value.is_null() || predicate(value) {
        Ok(())
    } else {
        Err(RunDetailCompositionError::invalid(format!(
            "{parent}[{index}].{field} must be {expected} or null"
        )))
    }
}

fn apply_splitter_policy(
    run: &mut Map<String, Value>,
    splitter_rows: &[Map<String, Value>],
) -> Result<(), RunDetailCompositionError> {
    let stored_config = object(required(run, "config")?, "run_detail.config")?.clone();
    let first = splitter_rows
        .iter()
        .find_map(|row| row.get("splitter").and_then(Value::as_object));
    let mut config = first.map_or_else(Map::new, inferred_splitter_config);
    config.extend(
        stored_config
            .into_iter()
            .filter(|(_, value)| !value.is_null()),
    );
    run.insert("config".into(), Value::Object(config));

    let pipelines = run
        .get_mut("pipelines")
        .and_then(Value::as_array_mut)
        .ok_or_else(|| {
            RunDetailCompositionError::invalid("run_detail.pipelines must be an array")
        })?;
    for (pipeline, splitter_row) in pipelines.iter_mut().zip(splitter_rows) {
        let pipeline = pipeline.as_object_mut().ok_or_else(|| {
            RunDetailCompositionError::invalid("run_detail pipeline must be an object")
        })?;
        let splitter_class = splitter_row
            .get("splitter")
            .and_then(Value::as_object)
            .and_then(splitter_class_or_reference)
            .map_or(Value::Null, Value::String);
        pipeline.insert("splitter_class".into(), splitter_class);
    }
    Ok(())
}

fn inferred_splitter_config(splitter: &Map<String, Value>) -> Map<String, Value> {
    let mut inferred = Map::new();
    let reference = nonempty_string(splitter.get("reference"));
    let splitter_class = splitter_class_or_reference(splitter);
    let strategy = reference
        .as_deref()
        .and_then(strategy_key_from_reference)
        .or_else(|| splitter_class.clone())
        .or(reference);
    for (field, value) in [
        ("cv_strategy", strategy.map(Value::String)),
        ("splitter_class", splitter_class.map(Value::String)),
        ("cv_folds", splitter.get("n_splits").cloned()),
        ("random_state", splitter.get("random_state").cloned()),
        ("shuffle", splitter.get("shuffle").cloned()),
        ("test_size", splitter.get("test_size").cloned()),
        ("group_by", splitter.get("group_by").cloned()),
    ] {
        if let Some(value) = value.filter(|value| !value.is_null()) {
            inferred.insert(field.into(), value);
        }
    }
    inferred
}

fn splitter_class_or_reference(splitter: &Map<String, Value>) -> Option<String> {
    nonempty_string(splitter.get("splitter_class"))
        .or_else(|| nonempty_string(splitter.get("reference")))
}

fn strategy_key_from_reference(reference: &str) -> Option<String> {
    let mut normalized = reference.trim();
    if let Some(inner) = normalized
        .strip_prefix('<')
        .and_then(|value| value.strip_suffix('>'))
    {
        if let Some(marker) = inner.rfind("object at 0x") {
            let path = &inner[..marker];
            let address = &inner[marker + "object at 0x".len()..];
            if path.chars().last().is_some_and(char::is_whitespace)
                && !address.is_empty()
                && address
                    .chars()
                    .all(|character| character.is_ascii_hexdigit())
            {
                normalized = path.trim();
            }
        }
    }
    let leaf = normalized
        .rsplit_once('.')
        .map_or(normalized, |(_, leaf)| leaf)
        .trim_start_matches('_')
        .to_lowercase();
    let strategy = match leaf.as_str() {
        "kfold" => "kfold",
        "stratifiedkfold" => "stratified_kfold",
        "groupkfold" => "group_kfold",
        "stratifiedgroupkfold" => "stratified_group_kfold",
        "repeatedkfold" => "repeated_kfold",
        "repeatedstratifiedkfold" => "repeated_stratified_kfold",
        "leaveoneout" => "loo",
        "leavepout" => "leave_p_out",
        "shufflesplit" => "shuffle_split",
        "stratifiedshufflesplit" => "stratified_shuffle_split",
        "groupshufflesplit" => "group_shuffle_split",
        "timeseriessplit" => "time_series_split",
        "holdout" => "holdout",
        _ => return None,
    };
    Some(strategy.into())
}

fn apply_runtime_policy(
    run: &mut Map<String, Value>,
    runtime_rows: &[Map<String, Value>],
    provenance: &Map<String, Value>,
) -> Result<(), RunDetailCompositionError> {
    {
        let pipelines = run
            .get_mut("pipelines")
            .and_then(Value::as_array_mut)
            .ok_or_else(|| {
                RunDetailCompositionError::invalid("run_detail.pipelines must be an array")
            })?;
        for (pipeline, runtime) in pipelines.iter_mut().zip(runtime_rows) {
            let pipeline = pipeline.as_object_mut().ok_or_else(|| {
                RunDetailCompositionError::invalid("run_detail pipeline must be an object")
            })?;
            for field in RUNTIME_FIELDS {
                if provenance.get(field).and_then(Value::as_str) == Some("stored_column") {
                    pipeline.insert(field.into(), runtime[field].clone());
                }
            }
        }
    }

    let config = run
        .get("config")
        .and_then(Value::as_object)
        .ok_or_else(|| RunDetailCompositionError::invalid("run_detail.config must be an object"))?;
    let run_seed = json!({"config": config});
    let run_seed = normalize_runtime_fields(run_seed.as_object().expect("json object"));
    let pipeline_runtimes = run
        .get("pipelines")
        .and_then(Value::as_array)
        .expect("pipelines remained an array")
        .iter()
        .filter_map(Value::as_object)
        .map(normalize_runtime_fields)
        .filter(|runtime| !runtime.is_empty())
        .collect::<Vec<_>>();
    let run_runtime = aggregate_runtime_fields(run_seed, &pipeline_runtimes);
    run.extend(run_runtime.clone());

    let pipelines = run
        .get_mut("pipelines")
        .and_then(Value::as_array_mut)
        .expect("pipelines remained an array");
    let inherited_requested = run_runtime.get("engine_requested").cloned();
    let inherited_policy = run_runtime.get("fallback_policy").cloned();
    let inherited_allow = run_runtime.get("allow_fallback").cloned();
    for pipeline in pipelines {
        let pipeline = pipeline
            .as_object_mut()
            .expect("validated pipeline remained an object");
        pipeline.extend(normalize_runtime_fields(pipeline));
        propagate_if_null(pipeline, "engine_requested", inherited_requested.as_ref());
        propagate_if_null(pipeline, "fallback_policy", inherited_policy.as_ref());
        propagate_if_null(pipeline, "allow_fallback", inherited_allow.as_ref());
    }
    Ok(())
}

fn normalize_runtime_fields(record: &Map<String, Value>) -> Map<String, Value> {
    let (candidates, config) = runtime_candidates(record);
    let policy = first_object(
        candidates.iter().chain(config.as_ref()),
        &["fallback_policy", "fallbackPolicy"],
    );
    let manifest = first_object(
        candidates.iter(),
        &["runtime_manifest", "runtimeManifest", "manifest"],
    );
    let engine = read_string(
        candidates.iter(),
        &[
            "engine_actual",
            "actual_engine",
            "engineActual",
            "actualEngine",
        ],
    )
    .or_else(|| {
        manifest
            .as_ref()
            .and_then(|value| nonempty_string(value.get("engine")))
    })
    .or_else(|| read_string(candidates.iter(), &["engine"]));
    let requested = read_string(
        candidates.iter().chain(config.as_ref()),
        &[
            "engine_requested",
            "requested_engine",
            "engineRequested",
            "requestedEngine",
        ],
    )
    .or_else(|| {
        config
            .as_ref()
            .and_then(|value| nonempty_string(value.get("engine")))
    })
    .or_else(|| {
        policy.as_ref().and_then(|value| {
            read_string(
                std::iter::once(value),
                &[
                    "engine_requested",
                    "requested_engine",
                    "engineRequested",
                    "requestedEngine",
                ],
            )
        })
    });
    let diagnostics = first_array(
        candidates.iter(),
        &[
            "engine_diagnostics",
            "engineDiagnostics",
            "diagnostics",
            "rt_errors",
            "rtErrors",
        ],
    );
    let native_refs = first_array(
        candidates.iter(),
        &["native_result_refs", "nativeResultRefs", "artifacts"],
    );
    let runtime_source = read_string(
        candidates.iter(),
        &["runtime_source", "runtimeSource", "source"],
    );

    materialize_runtime_fields(
        engine,
        requested,
        diagnostics.as_ref(),
        runtime_source,
        manifest.as_ref(),
        policy.as_ref(),
        native_refs.as_ref(),
    )
}

fn runtime_candidates(record: &Map<String, Value>) -> (Vec<JsonObject>, Option<JsonObject>) {
    let mut root = record.clone();
    for key in [
        "engine_diagnostics",
        "runtime_manifest",
        "fallback_policy",
        "native_result_refs",
        "rt_result",
        "runtime_result",
        "execution_metadata",
        "metadata",
    ] {
        if let Some(parsed) = root.get(key).and_then(parse_json_string) {
            root.insert(key.into(), parsed);
        }
    }
    let mut candidates = vec![root.clone()];
    for key in ["execution_metadata", "executionMetadata", "metadata"] {
        if let Some(candidate) = root.get(key).and_then(runtime_object) {
            candidates.push(candidate);
        }
    }
    for key in [
        "rt_result",
        "rtResult",
        "runtime_result",
        "runtimeResult",
        "runtime",
    ] {
        if let Some(candidate) = root.get(key).and_then(runtime_object) {
            let result = candidate.get("result").and_then(runtime_object);
            candidates.push(candidate);
            if let Some(result) = result {
                candidates.push(result);
            }
        }
    }
    let config = root.get("config").and_then(runtime_object);
    (candidates, config)
}

fn parse_json_string(value: &Value) -> Option<Value> {
    value
        .as_str()
        .and_then(|raw| serde_json::from_str::<Value>(raw).ok())
}

fn runtime_object(value: &Value) -> Option<Map<String, Value>> {
    value
        .as_object()
        .cloned()
        .or_else(|| parse_json_string(value)?.as_object().cloned())
}

fn runtime_array(value: &Value) -> Option<Vec<Value>> {
    value
        .as_array()
        .cloned()
        .or_else(|| parse_json_string(value)?.as_array().cloned())
}

fn materialize_runtime_fields(
    engine: Option<String>,
    requested: Option<String>,
    diagnostics: Option<&Vec<Value>>,
    runtime_source: Option<String>,
    manifest: Option<&Map<String, Value>>,
    policy: Option<&Map<String, Value>>,
    native_refs: Option<&Vec<Value>>,
) -> Map<String, Value> {
    let mut fields = Map::new();
    insert_string(&mut fields, "engine", engine);
    insert_string(&mut fields, "engine_requested", requested);
    if let Some(values) = diagnostics.filter(|values| !values.is_empty()) {
        fields.insert("engine_diagnostics".into(), Value::Array(values.clone()));
    }
    insert_string(&mut fields, "runtime_source", runtime_source);
    if let Some(manifest) = manifest {
        fields.insert("runtime_manifest".into(), Value::Object(manifest.clone()));
    }
    if let Some(policy) = policy {
        fields.insert("fallback_policy".into(), Value::Object(policy.clone()));
        if let Some(allow) = policy.get("allow_fallback").and_then(Value::as_bool) {
            fields.insert("allow_fallback".into(), Value::Bool(allow));
        }
    }
    if let Some(values) = native_refs.filter(|values| !values.is_empty()) {
        fields.insert("native_result_refs".into(), Value::Array(values.clone()));
    }
    fields
}

fn aggregate_runtime_fields(
    mut fields: Map<String, Value>,
    pipeline_runtimes: &[Map<String, Value>],
) -> Map<String, Value> {
    let mut requested = nonempty_string(fields.get("engine_requested"));
    for runtime in pipeline_runtimes {
        requested = requested.or_else(|| nonempty_string(runtime.get("engine_requested")));
    }
    let selected = pipeline_runtimes
        .iter()
        .find(|runtime| {
            let engine = nonempty_string(runtime.get("engine"));
            engine.is_some() && requested.is_some() && engine != requested
        })
        .or_else(|| {
            pipeline_runtimes
                .iter()
                .find(|runtime| nonempty_string(runtime.get("engine")).is_some())
        });
    if let Some(selected) = selected {
        for field in [
            "engine",
            "runtime_source",
            "runtime_manifest",
            "native_result_refs",
        ] {
            if let Some(value) = selected.get(field).filter(|value| !value.is_null()) {
                fields.insert(field.into(), value.clone());
            }
        }
        requested = requested.or_else(|| nonempty_string(selected.get("engine_requested")));
        if fields
            .get("fallback_policy")
            .is_none_or(|value| !python_truthy(value))
        {
            if let Some(policy) = selected
                .get("fallback_policy")
                .filter(|value| python_truthy(value))
            {
                fields.insert("fallback_policy".into(), policy.clone());
            }
        }
        if !fields.contains_key("allow_fallback") {
            if let Some(allow) = selected.get("allow_fallback") {
                fields.insert("allow_fallback".into(), allow.clone());
            }
        }
    }

    let mut diagnostics = Vec::new();
    let mut seen = HashSet::new();
    for runtime in pipeline_runtimes {
        let Some(values) = runtime.get("engine_diagnostics").and_then(Value::as_array) else {
            continue;
        };
        for diagnostic in values {
            let key = serde_json::to_string(diagnostic).expect("owner input is valid JSON");
            if seen.insert(key) {
                diagnostics.push(diagnostic.clone());
            }
        }
    }
    if !diagnostics.is_empty() {
        fields.insert("engine_diagnostics".into(), Value::Array(diagnostics));
    }
    insert_string(&mut fields, "engine_requested", requested);
    fields
}

fn first_object<'a>(
    records: impl Iterator<Item = &'a Map<String, Value>>,
    keys: &[&str],
) -> Option<Map<String, Value>> {
    for record in records {
        for key in keys {
            if let Some(value) = record.get(*key).and_then(runtime_object) {
                return Some(value);
            }
        }
    }
    None
}

fn first_array<'a>(
    records: impl Iterator<Item = &'a Map<String, Value>>,
    keys: &[&str],
) -> Option<Vec<Value>> {
    for record in records {
        for key in keys {
            if let Some(value) = record.get(*key).and_then(runtime_array) {
                return Some(value);
            }
        }
    }
    None
}

fn read_string<'a>(
    records: impl Iterator<Item = &'a Map<String, Value>>,
    keys: &[&str],
) -> Option<String> {
    for record in records {
        for key in keys {
            if let Some(value) = nonempty_string(record.get(*key)) {
                return Some(value);
            }
        }
    }
    None
}

fn nonempty_string(value: Option<&Value>) -> Option<String> {
    value
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
}

fn insert_string(fields: &mut Map<String, Value>, key: &str, value: Option<String>) {
    if let Some(value) = value {
        fields.insert(key.into(), Value::String(value));
    }
}

fn propagate_if_null(pipeline: &mut Map<String, Value>, field: &str, inherited: Option<&Value>) {
    if pipeline.get(field).is_none_or(Value::is_null) {
        if let Some(value) = inherited {
            pipeline.insert(field.into(), value.clone());
        }
    }
}

fn apply_dataset_policy(
    run: &mut Map<String, Value>,
    linked: &[DatasetLinkIdentity],
) -> Result<(), RunDetailCompositionError> {
    let raw = array(required(run, "datasets")?, "run_detail.datasets")?;
    let mut datasets = normalize_dataset_entries(raw);
    resolve_dataset_mapping(&mut datasets, linked);
    let unresolved = datasets
        .iter()
        .filter(|dataset| {
            dataset
                .get("linked_dataset_id")
                .is_none_or(|value| !python_truthy(value))
        })
        .map(|dataset| python_string(dataset.get("name").filter(|value| python_truthy(value))))
        .collect::<Vec<_>>();
    let pipeline_count = run
        .get("pipelines")
        .and_then(Value::as_array)
        .map_or(0, Vec::len);
    run.insert(
        "datasets".into(),
        Value::Array(datasets.into_iter().map(Value::Object).collect()),
    );
    run.insert(
        "rerun_ready".into(),
        Value::Bool(unresolved.is_empty() && pipeline_count > 0),
    );
    run.insert(
        "unresolved_dataset_names".into(),
        Value::Array(unresolved.into_iter().map(Value::String).collect()),
    );
    Ok(())
}

fn normalize_dataset_entries(raw: &[Value]) -> Vec<Map<String, Value>> {
    raw.iter()
        .filter_map(|entry| match entry {
            Value::Object(object) => {
                let mut normalized = object.clone();
                let dataset_name = ["dataset_name", "name", "dataset"]
                    .into_iter()
                    .filter_map(|key| object.get(key))
                    .find(|value| python_truthy(value));
                if let Some(name) = dataset_name
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|name| !name.is_empty())
                {
                    normalized
                        .entry("name")
                        .or_insert_with(|| Value::String(name.into()));
                    normalized
                        .entry("dataset_name")
                        .or_insert_with(|| Value::String(name.into()));
                }
                Some(normalized)
            }
            Value::String(name) if !name.trim().is_empty() => {
                let name = name.trim().to_owned();
                Some(Map::from_iter([
                    ("name".into(), Value::String(name.clone())),
                    ("dataset_name".into(), Value::String(name)),
                ]))
            }
            _ => None,
        })
        .collect()
}

fn resolve_dataset_mapping(datasets: &mut [Map<String, Value>], linked: &[DatasetLinkIdentity]) {
    if linked.is_empty() {
        return;
    }
    let linked_ids = linked
        .iter()
        .map(|dataset| dataset.id.as_str())
        .collect::<HashSet<_>>();
    let linked_info = linked
        .iter()
        .map(|dataset| {
            let folder = Path::new(&dataset.path)
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or_default();
            (
                dataset.id.as_str(),
                dataset.name.to_lowercase(),
                dataset_match_key(&dataset.name),
                dataset_match_key(folder),
            )
        })
        .collect::<Vec<_>>();

    for dataset in datasets {
        let store_value = ["dataset_name", "name", "dataset"]
            .into_iter()
            .filter_map(|key| dataset.get(key))
            .find(|value| python_truthy(value));
        let store_name = python_string(store_value);
        if store_name.is_empty() {
            continue;
        }
        dataset
            .entry("name")
            .or_insert_with(|| Value::String(store_name.clone()));
        dataset
            .entry("dataset_name")
            .or_insert_with(|| Value::String(store_name.clone()));

        let existing = dataset
            .get("linked_dataset_id")
            .filter(|value| python_truthy(value))
            .map(|value| python_string(Some(value)));
        if existing
            .as_deref()
            .is_some_and(|id| linked_ids.contains(id))
        {
            continue;
        }

        let store_lower = store_name.to_lowercase();
        let store_key = dataset_match_key(&store_name);
        let exact = linked_info
            .iter()
            .find_map(|(id, name_lower, name_key, _)| {
                (store_lower == *name_lower || (!store_key.is_empty() && store_key == *name_key))
                    .then_some(*id)
            });
        if let Some(id) = exact.filter(|id| !id.is_empty()) {
            dataset.insert("linked_dataset_id".into(), Value::String(id.into()));
            continue;
        }

        let mut best_id = None;
        let mut best_len = 0;
        for (id, _, _, folder_key) in &linked_info {
            if !folder_key.is_empty()
                && store_key.starts_with(folder_key)
                && folder_key.len() > best_len
            {
                best_id = Some(*id);
                best_len = folder_key.len();
            }
        }
        if let Some(id) = best_id.filter(|id| !id.is_empty()) {
            dataset.insert("linked_dataset_id".into(), Value::String(id.into()));
            continue;
        }
        for (id, _, name_key, _) in &linked_info {
            if !name_key.is_empty() && store_key.starts_with(name_key) && name_key.len() > best_len
            {
                best_id = Some(*id);
                best_len = name_key.len();
            }
        }
        if let Some(id) = best_id.filter(|id| !id.is_empty()) {
            dataset.insert("linked_dataset_id".into(), Value::String(id.into()));
        }
    }
}

fn dataset_match_key(value: &str) -> String {
    value
        .chars()
        .flat_map(|character| {
            if character.is_alphanumeric() {
                character.to_lowercase().collect::<Vec<_>>()
            } else {
                vec!['_']
            }
        })
        .collect()
}

fn python_truthy(value: &Value) -> bool {
    match value {
        Value::Null => false,
        Value::Bool(value) => *value,
        Value::Number(value) => value.as_f64() != Some(0.0),
        Value::String(value) => !value.is_empty(),
        Value::Array(value) => !value.is_empty(),
        Value::Object(value) => !value.is_empty(),
    }
}

fn python_string(value: Option<&Value>) -> String {
    match value {
        None | Some(Value::Null) => String::new(),
        Some(Value::String(value)) => value.clone(),
        Some(Value::Bool(true)) => "True".into(),
        Some(Value::Bool(false)) => "False".into(),
        Some(value) => value.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use serde_json::{json, Value};

    use super::{
        compose_store_run_detail, strategy_key_from_reference, RunDetailCompositionError,
        RUNTIME_FIELDS, STUDIO_RUN_DETAIL_COMPOSITION_CONTRACT,
    };
    use crate::settings::DatasetLinkIdentity;

    const OWNER_INPUT: &str =
        include_str!("../tests/fixtures/workspace_store_v5_run_detail_http_inputs.response.json");

    fn linked() -> Vec<DatasetLinkIdentity> {
        vec![DatasetLinkIdentity {
            id: "linked-corn".into(),
            name: "Corn".into(),
            path: "/datasets/corn".into(),
        }]
    }

    #[test]
    fn contract_allows_only_preselected_store_v5_and_keeps_legacy_external() {
        let contract: Value = serde_json::from_str(STUDIO_RUN_DETAIL_COMPOSITION_CONTRACT).unwrap();
        assert_eq!(contract["cutover"]["store_branch_composition_proven"], true);
        assert_eq!(
            contract["cutover"]["route_selection"],
            "per_request_store_v5_and_owner_host_preflight"
        );
        assert_eq!(contract["cutover"]["blocked_on"], json!([]));
        assert_eq!(
            contract["cutover"]["legacy_manifest_branch_proven"],
            "selected_scientific_plugin_before_target_http"
        );
    }

    #[test]
    fn freezes_the_complete_fastapi_splitter_strategy_vocabulary() {
        for (reference, expected) in [
            ("KFold", "kfold"),
            ("StratifiedKFold", "stratified_kfold"),
            ("GroupKFold", "group_kfold"),
            ("StratifiedGroupKFold", "stratified_group_kfold"),
            ("RepeatedKFold", "repeated_kfold"),
            ("RepeatedStratifiedKFold", "repeated_stratified_kfold"),
            ("LeaveOneOut", "loo"),
            ("LeavePOut", "leave_p_out"),
            ("ShuffleSplit", "shuffle_split"),
            ("StratifiedShuffleSplit", "stratified_shuffle_split"),
            ("GroupShuffleSplit", "group_shuffle_split"),
            ("TimeSeriesSplit", "time_series_split"),
            ("Holdout", "holdout"),
        ] {
            assert_eq!(
                strategy_key_from_reference(&format!("sklearn.model_selection.{reference}")),
                Some(expected.into())
            );
        }
        assert_eq!(
            strategy_key_from_reference("<pkg._KFold\tobject at 0xA17>"),
            Some("kfold".into())
        );
        assert_eq!(strategy_key_from_reference("pkg.CustomSplitter"), None);
    }

    #[test]
    fn composes_the_owner_runtime_splitter_dataset_and_rerun_golden() {
        let owner: Value = serde_json::from_str(OWNER_INPUT).unwrap();
        let before = owner.clone();
        let actual = compose_store_run_detail(&owner, &linked()).unwrap();
        let expected: Value = serde_json::from_str(include_str!(
            "../tests/fixtures/workspace_store_v5_run_detail_composed.response.json"
        ))
        .unwrap();

        assert_eq!(actual, expected);
        assert_eq!(owner, before, "composition must not mutate owner input");
    }

    #[test]
    fn rejects_reordered_runtime_and_absent_column_payloads() {
        let mut owner: Value = serde_json::from_str(OWNER_INPUT).unwrap();
        owner["pipeline_runtime"].as_array_mut().unwrap().reverse();
        assert!(matches!(
            compose_store_run_detail(&owner, &linked()),
            Err(RunDetailCompositionError(detail)) if detail.contains("reordered or mismatched")
        ));

        let mut owner: Value = serde_json::from_str(OWNER_INPUT).unwrap();
        owner["runtime_column_provenance"]["engine"] = json!("absent_in_store_v5");
        assert!(matches!(
            compose_store_run_detail(&owner, &linked()),
            Err(RunDetailCompositionError(detail)) if detail.contains("must be null when the column is absent")
        ));

        let mut owner: Value = serde_json::from_str(OWNER_INPUT).unwrap();
        owner["results"][0]["pipeline_config_id"] = json!("mismatched");
        assert!(matches!(
            compose_store_run_detail(&owner, &linked()),
            Err(RunDetailCompositionError(detail)) if detail.contains("owner pipeline mapping")
        ));
    }

    #[test]
    fn preserves_historical_store_v5_when_all_runtime_columns_are_absent() {
        let mut owner: Value = serde_json::from_str(OWNER_INPUT).unwrap();
        for field in RUNTIME_FIELDS {
            owner["runtime_column_provenance"][field] = json!("absent_in_store_v5");
            for runtime in owner["pipeline_runtime"].as_array_mut().unwrap() {
                runtime[field] = Value::Null;
            }
        }

        let actual = compose_store_run_detail(&owner, &linked()).unwrap();
        assert!(actual.get("engine").is_none());
        assert!(actual.get("engine_requested").is_none());
        assert!(actual["pipelines"][0].get("engine").is_none());
        assert!(actual["pipelines"][0].get("runtime_manifest").is_none());
        assert_eq!(actual["rerun_ready"], true);
    }

    #[test]
    fn uses_only_owner_splitters_and_preserves_stored_config_precedence() {
        let mut owner: Value = serde_json::from_str(OWNER_INPUT).unwrap();
        owner["run_detail"]["pipelines"][0]["expanded_config"] = json!([{
            "class": "this.must.not.be.parsed"
        }]);
        owner["run_detail"]["config"]["cv_strategy"] = json!("stored-choice");
        owner["pipeline_splitters"][0]["splitter"]["reference"] =
            json!("sklearn.model_selection.StratifiedGroupKFold");

        let actual = compose_store_run_detail(&owner, &linked()).unwrap();
        assert_eq!(actual["config"]["cv_strategy"], "stored-choice");
        assert_eq!(actual["config"]["splitter_class"], "KFold");
        assert_eq!(actual["pipelines"][0]["splitter_class"], "KFold");
    }

    #[test]
    fn runtime_selection_deduplicates_and_propagates_without_engine_fallback() {
        let mut owner: Value = serde_json::from_str(OWNER_INPUT).unwrap();
        owner["pipeline_runtime"][1]["engine"] = json!("dag-ml");
        owner["pipeline_runtime"][1]["engine_requested"] = json!("dag-ml");
        owner["pipeline_runtime"][1]["engine_diagnostics"] =
            owner["pipeline_runtime"][0]["engine_diagnostics"].clone();
        owner["pipeline_runtime"][1]["fallback_policy"] = json!({});

        let actual = compose_store_run_detail(&owner, &linked()).unwrap();
        assert_eq!(actual["engine"], "legacy", "actual fallback engine wins");
        assert_eq!(actual["engine_requested"], "dag-ml");
        assert_eq!(actual["engine_diagnostics"].as_array().unwrap().len(), 1);
        assert_eq!(actual["pipelines"][1]["engine"], "dag-ml");
        assert_eq!(actual["pipelines"][1]["allow_fallback"], true);
    }

    #[test]
    fn parses_the_fastapi_run_config_runtime_aliases_before_propagation() {
        let mut owner: Value = serde_json::from_str(OWNER_INPUT).unwrap();
        owner["run_detail"]["config"]["requestedEngine"] = json!("configured-native");
        owner["run_detail"]["config"]["fallback_policy"] =
            json!(r#"{"engine_requested":"configured-native","allow_fallback":false}"#);

        let actual = compose_store_run_detail(&owner, &linked()).unwrap();
        assert_eq!(actual["engine_requested"], "configured-native");
        assert_eq!(actual["allow_fallback"], false);
        assert_eq!(actual["fallback_policy"]["allow_fallback"], false);
        assert_eq!(actual["pipelines"][0]["engine_requested"], "dag-ml");
        assert_eq!(
            actual["pipelines"][1]["engine_requested"],
            "configured-native"
        );
        assert_eq!(actual["pipelines"][1]["allow_fallback"], false);
    }

    #[test]
    fn normalizes_dataset_names_uses_longest_prefix_and_preserves_valid_links() {
        let mut owner: Value = serde_json::from_str(OWNER_INPUT).unwrap();
        owner["run_detail"]["datasets"] = json!([
            "  Sample A  ",
            {"dataset": "foo_bar_variant"},
            {"name": "already", "linked_dataset_id": "keep"},
        ]);
        let links = vec![
            DatasetLinkIdentity {
                id: "sample-a".into(),
                name: "sample a".into(),
                path: "/datasets/sample_a".into(),
            },
            DatasetLinkIdentity {
                id: "short".into(),
                name: "foo".into(),
                path: "/datasets/foo".into(),
            },
            DatasetLinkIdentity {
                id: "long".into(),
                name: "other".into(),
                path: "/datasets/foo_bar".into(),
            },
            DatasetLinkIdentity {
                id: "keep".into(),
                name: "renamed".into(),
                path: "/datasets/renamed".into(),
            },
        ];

        let actual = compose_store_run_detail(&owner, &links).unwrap();
        assert_eq!(actual["datasets"][0]["name"], "Sample A");
        assert_eq!(actual["datasets"][0]["linked_dataset_id"], "sample-a");
        assert_eq!(actual["datasets"][1]["dataset_name"], "foo_bar_variant");
        assert_eq!(actual["datasets"][1]["linked_dataset_id"], "long");
        assert_eq!(actual["datasets"][2]["linked_dataset_id"], "keep");
        assert_eq!(actual["rerun_ready"], true);
        assert_eq!(actual["unresolved_dataset_names"], json!([]));
    }
}
