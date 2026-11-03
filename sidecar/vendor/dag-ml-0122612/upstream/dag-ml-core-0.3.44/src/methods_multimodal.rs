//! Bounded declarative validation for a complete Methods U07 predictor.
//! Feature buffers and learned encoder state remain Methods-owned.

use std::collections::{BTreeMap, BTreeSet};

use serde::Deserialize;
use serde_json::Value;
use sha2::{Digest, Sha256};

use crate::{ArtifactBackend, DagMlError, ExecutionPlan, RefitArtifactRecord, Result};

pub const METHODS_MULTIMODAL_SEMANTIC_PROFILE: &str =
    "dagml_methods_multimodal_pipeline_raw_sha256";
pub const METHODS_MULTIMODAL_SCHEMA: &str = "dagml.methods.multimodal.v1";

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
struct SourceSchema {
    representation_id: String,
    input_shape: Vec<usize>,
    dtype: String,
    identity: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
struct RidgeParams {
    alpha: f64,
    center_x: bool,
    center_y: bool,
    scale_x: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
struct ModelRecipe {
    method_id: String,
    params: RidgeParams,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
struct Recipe {
    schema_version: u32,
    fusion: String,
    source_order: Vec<String>,
    encoders: BTreeMap<String, Value>,
    source_weights: BTreeMap<String, f64>,
    model: ModelRecipe,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Payload {
    schema: String,
    node_id: String,
    params_fingerprint: String,
    target_names: Vec<String>,
    recipe: Recipe,
    source_schemas: BTreeMap<String, SourceSchema>,
    state: Vec<u8>,
}

fn refuse<T>(message: &str) -> Result<T> {
    Err(DagMlError::RuntimeValidation(message.into()))
}

fn validate_recipe(recipe: &Recipe, schemas: &BTreeMap<String, SourceSchema>) -> Result<()> {
    let order = ["nir", "image", "series", "metadata"];
    let names = order.into_iter().collect::<BTreeSet<_>>();
    let selected = recipe
        .source_order
        .iter()
        .map(String::as_str)
        .collect::<BTreeSet<_>>();
    if recipe.schema_version != 1
        || recipe.fusion != "early"
        || selected.is_empty()
        || selected.len() != recipe.source_order.len()
        || !selected.is_subset(&names)
        || recipe
            .encoders
            .keys()
            .map(String::as_str)
            .collect::<BTreeSet<_>>()
            != selected
        || recipe
            .source_weights
            .keys()
            .map(String::as_str)
            .collect::<BTreeSet<_>>()
            != selected
        || schemas.keys().map(String::as_str).collect::<BTreeSet<_>>() != names
        || recipe
            .source_weights
            .values()
            .any(|weight| !weight.is_finite() || *weight < 0.0)
        || recipe.model.method_id != "models.regularized.ridge"
        || !recipe.model.params.alpha.is_finite()
        || recipe.model.params.alpha < 0.0
        || !recipe.model.params.center_x
        || !recipe.model.params.center_y
        || recipe.model.params.scale_x
    {
        return refuse("Methods multimodal requires a declared ordered U07 subset and complete raw source schemas");
    }
    let standard = serde_json::json!({"kind":"standard_scaler", "with_mean":true, "with_std":true});
    let mixed = serde_json::json!({"kind":"column_transformer", "numeric_columns":[0],
        "categorical_columns":[1], "with_mean":true, "with_std":true,
        "handle_unknown":"ignore", "sparse_output":false, "drop":null});
    if recipe
        .encoders
        .get("nir")
        .is_some_and(|encoder| *encoder != standard)
        || recipe
            .encoders
            .get("metadata")
            .is_some_and(|encoder| *encoder != mixed)
    {
        return refuse("Methods multimodal scaler and mixed-column recipe is unsupported");
    }
    for source in ["image", "series"] {
        if !selected.contains(source) {
            continue;
        }
        let encoder = recipe.encoders[source].as_object().ok_or_else(|| {
            DagMlError::RuntimeValidation("Methods tensor PCA encoder is not an object".into())
        })?;
        let count = encoder.get("n_components").and_then(Value::as_u64);
        let width = schemas[source]
            .input_shape
            .iter()
            .try_fold(1_u64, |count, size| count.checked_mul(*size as u64));
        if encoder.len() != 4
            || encoder.get("kind").and_then(Value::as_str) != Some("tensor_pca")
            || encoder.get("whiten") != Some(&Value::Bool(false))
            || encoder
                .get("random_state")
                .and_then(Value::as_u64)
                .is_none_or(|seed| seed > u32::MAX as u64)
            || !count.is_some_and(|count| count > 0 && count <= i32::MAX as u64)
            || !count
                .zip(width)
                .is_some_and(|(count, width)| count <= width && width <= 1_048_576)
        {
            return refuse(
                "Methods multimodal tensor PCA requires its declared dense unwhitened U07 profile",
            );
        }
    }
    for (name, representation) in [
        ("nir", "signal_1d"),
        ("image", "rgb_image"),
        ("series", "series_mv"),
        ("metadata", "tabular_mixed"),
    ] {
        let schema = &schemas[name];
        if schema.representation_id != representation
            || schema.input_shape.is_empty()
            || schema.input_shape.len() > 7
            || schema.input_shape.contains(&0)
            || schema
                .input_shape
                .iter()
                .try_fold(1_usize, |count, size| count.checked_mul(*size))
                .is_none_or(|count| count > 1_048_576)
            || (name == "metadata" && schema.input_shape != vec![2])
            || schema.dtype.is_empty()
            || schema.dtype.len() > 128
            || schema.identity.is_empty()
            || schema.identity.len() > 1_048_576
        {
            return refuse(
                "Methods multimodal source shape, representation or identity is outside U07",
            );
        }
        crate::canonical::parse_typed_json(&schema.identity).map_err(|error| {
            DagMlError::RuntimeValidation(format!(
                "Methods multimodal source identity is outside strict TCV1 JSON: {error}"
            ))
        })?;
    }
    Ok(())
}

/// Shared raw encoder/schema validator; the caller validates its own head separately.
/// The existing V1 encoder profile is conserved, without constructing or fitting a model.
pub(crate) fn validate_methods_raw_encoder_profile(recipe: &Value, schemas: &Value) -> Result<()> {
    let mut profile = recipe.clone();
    profile["model"] = serde_json::json!({"method_id":"models.regularized.ridge", "params":{"alpha":1.0,"center_x":true,"center_y":true,"scale_x":false}});
    let profile: Recipe = serde_json::from_value(profile)?;
    let schemas: BTreeMap<String, SourceSchema> = serde_json::from_value(schemas.clone())?;
    validate_recipe(&profile, &schemas)
}

fn parse_payload(record: &RefitArtifactRecord, bytes: &[u8]) -> Result<Payload> {
    let artifact = &record.artifact;
    artifact.validate_portable()?;
    let owners = ["python", "wasm", "r", "octave"];
    let owner = owners.into_iter().find(|host| {
        artifact.plugin.as_deref() == Some(format!("dagml.methods.{host}.multimodal").as_str())
            && artifact.controller_id.as_str() == format!("controller:methods.{host}.multimodal")
            && record.controller_id == artifact.controller_id
    });
    let digest = format!("{:x}", Sha256::digest(bytes));
    if owner.is_none()
        || artifact.kind != "methods_multimodal_pipeline"
        || artifact.backend != Some(ArtifactBackend::Raw)
        || artifact.plugin_version.as_deref() != Some("1.0.0")
        || artifact.native_predictor_descriptor.is_some()
        || artifact.native_estimator_descriptor.is_some()
        || bytes.is_empty()
        || bytes.len() > 134_217_728
        || artifact.content_fingerprint.as_deref() != Some(digest.as_str())
        || artifact.size_bytes != Some(bytes.len() as u64)
        || artifact.uri.as_deref() != Some(format!("artifacts/{digest}.json").as_str())
    {
        return refuse("Methods multimodal requires a bounded trusted RAW payload and exact owner");
    }
    let text = std::str::from_utf8(bytes).map_err(|error| {
        DagMlError::RuntimeValidation(format!("Methods multimodal payload is not UTF-8: {error}"))
    })?;
    crate::canonical::parse_bounded_typed_json(text, 4_000_000).map_err(|error| {
        DagMlError::RuntimeValidation(format!(
            "Methods multimodal payload is outside strict TCV1 JSON: {error}"
        ))
    })?;
    let payload: Payload = serde_json::from_str(text)?;
    if payload.schema != METHODS_MULTIMODAL_SCHEMA
        || payload.node_id != record.node_id.as_str()
        || payload.params_fingerprint != record.params_fingerprint
        || payload.target_names.len() != 1
        || payload.target_names[0].is_empty()
        || payload.target_names[0].len() > 4096
        || payload.state.len() < 28
        || payload.state.len() > 67_108_864
        || &payload.state[..4] != b"N4MF"
        || payload.state[4..8] != 1_u32.to_le_bytes()
        || payload.state[8..12] != 2_u32.to_le_bytes()
    {
        return refuse("Methods multimodal wrapper must bind one complete native N4MF predictor");
    }
    validate_recipe(&payload.recipe, &payload.source_schemas)?;
    Ok(payload)
}

/// Validate bounds and declarative identity without importing native learned state.
pub fn validate_methods_multimodal_pipeline_payload(
    record: &RefitArtifactRecord,
    bytes: &[u8],
) -> Result<()> {
    parse_payload(record, bytes).map(|_| ())
}

/// Bind recipe and raw source schemas to the selected effective signed plan.
pub fn validate_methods_multimodal_pipeline_recipe(
    record: &RefitArtifactRecord,
    bytes: &[u8],
    plan: &ExecutionPlan,
) -> Result<()> {
    let payload = parse_payload(record, bytes)?;
    let node = plan.node_plans.get(&record.node_id).ok_or_else(|| {
        DagMlError::RuntimeValidation("Methods multimodal has no effective node plan".into())
    })?;
    let operator = plan
        .graph_plan
        .graph
        .nodes
        .iter()
        .find(|node| node.id == record.node_id)
        .and_then(|node| node.operator.as_ref())
        .ok_or_else(|| {
            DagMlError::RuntimeValidation(
                "Methods multimodal has no explicit graph operator".into(),
            )
        })?;
    if operator
        .as_object()
        .is_none_or(|operator| operator.len() != 3)
        || operator.get("type").and_then(Value::as_str) != Some("N4mMultimodalPipeline")
    {
        return refuse("Methods multimodal graph operator does not declare its native profile");
    }
    let mut expected: Recipe =
        serde_json::from_value(operator.get("recipe").cloned().ok_or_else(|| {
            DagMlError::RuntimeValidation("Methods multimodal graph operator has no recipe".into())
        })?)?;
    let schemas: BTreeMap<String, SourceSchema> =
        serde_json::from_value(operator.get("source_schemas").cloned().ok_or_else(|| {
            DagMlError::RuntimeValidation(
                "Methods multimodal graph operator has no source schemas".into(),
            )
        })?)?;
    if node.params.contains_key("recipe") != node.params.contains_key("source_schemas") {
        return refuse(
            "Methods multimodal structural parameters require both immutable declarations",
        );
    }
    if node.params.contains_key("recipe")
        && node
            .params
            .keys()
            .any(|key| !matches!(key.as_str(), "recipe" | "source_schemas" | "model__alpha"))
    {
        return refuse("Methods multimodal structural tuning permits alpha only");
    }
    for (key, value) in &node.params {
        match key.as_str() {
            "recipe" | "source_schemas" => {
                if operator.get(key) != Some(value) {
                    return refuse(
                        "Methods multimodal structural declarations differ from the signed graph operator",
                    );
                }
            }
            "model__alpha" => {
                expected.model.params.alpha = value.as_f64().ok_or_else(|| {
                    DagMlError::RuntimeValidation("Methods multimodal alpha must be numeric".into())
                })?
            }
            "source_weights__image" => {
                let weight = expected.source_weights.get_mut("image").ok_or_else(|| {
                    DagMlError::RuntimeValidation(
                        "Methods multimodal image weight is inactive".into(),
                    )
                })?;
                *weight = value.as_f64().ok_or_else(|| {
                    DagMlError::RuntimeValidation(
                        "Methods multimodal image weight must be numeric".into(),
                    )
                })?;
            }
            "transformers__image__n_components" => {
                let count = value.as_u64().ok_or_else(|| {
                    DagMlError::RuntimeValidation(
                        "Methods multimodal PCA count must be an integer".into(),
                    )
                })?;
                expected
                    .encoders
                    .get_mut("image")
                    .ok_or_else(|| {
                        DagMlError::RuntimeValidation(
                            "Methods multimodal has no image encoder".into(),
                        )
                    })?
                    .as_object_mut()
                    .ok_or_else(|| {
                        DagMlError::RuntimeValidation(
                            "Methods image encoder must be an object".into(),
                        )
                    })?
                    .insert("n_components".into(), Value::from(count));
            }
            _ => {
                return refuse(
                    "Methods multimodal effective parameters are outside the fixed U07 profile",
                )
            }
        }
    }
    validate_recipe(&expected, &schemas)?;
    if payload.recipe != expected
        || payload.source_schemas != schemas
        || payload.params_fingerprint != node.params_fingerprint
    {
        return refuse("Methods multimodal saved recipe or source schemas differ from the selected effective plan");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> (RefitArtifactRecord, Value, ExecutionPlan) {
        let outcome = crate::TrainingOutcome::from_json(include_str!(
            "../tests/fixtures/package/archive/training_outcome_port_explicit.json"
        ))
        .unwrap();
        let mut record = outcome.execution_bundle.refit_artifacts[0].clone();
        record.controller_id =
            crate::ControllerId::new("controller:methods.python.multimodal").unwrap();
        record.artifact.controller_id = record.controller_id.clone();
        record.artifact.kind = "methods_multimodal_pipeline".into();
        record.artifact.backend = Some(ArtifactBackend::Raw);
        record.artifact.plugin = Some("dagml.methods.python.multimodal".into());
        record.artifact.plugin_version = Some("1.0.0".into());
        record.artifact.native_predictor_descriptor = None;
        record.artifact.native_estimator_descriptor = None;
        let recipe = serde_json::json!({"schema_version":1,"fusion":"early",
            "source_order":["nir","image","series","metadata"],
            "encoders":{"nir":{"kind":"standard_scaler","with_mean":true,"with_std":true},
                "image":{"kind":"tensor_pca","n_components":2,"whiten":false,"random_state":17},
                "series":{"kind":"tensor_pca","n_components":2,"whiten":false,"random_state":17},
                "metadata":{"kind":"column_transformer","numeric_columns":[0],"categorical_columns":[1],
                    "with_mean":true,"with_std":true,"handle_unknown":"ignore","sparse_output":false,"drop":null}},
            "source_weights":{"nir":1.0,"image":1.0,"series":1.0,"metadata":1.0},
            "model":{"method_id":"models.regularized.ridge","params":{"alpha":1.0,"center_x":true,"center_y":true,"scale_x":false}}});
        let mut schemas = serde_json::Map::new();
        for (name, representation, shape) in [
            ("nir", "signal_1d", vec![24]),
            ("image", "rgb_image", vec![8, 8, 3]),
            ("series", "series_mv", vec![16, 2]),
            ("metadata", "tabular_mixed", vec![2]),
        ] {
            schemas.insert(name.into(), serde_json::json!({"representation_id":representation,
                "input_shape":shape,"dtype":"float64","identity":format!("{{\"source_id\":\"{name}\"}}") }));
        }
        // Only a transport witness. Native learned-state/checksum qualification
        // requires the real Methods campaign, never this opaque byte sequence.
        let mut state = b"N4MF".to_vec();
        state.extend(1_u32.to_le_bytes());
        state.extend(2_u32.to_le_bytes());
        state.resize(28, 0);
        let saved = serde_json::json!({"schema":METHODS_MULTIMODAL_SCHEMA,
            "node_id":record.node_id,"params_fingerprint":record.params_fingerprint,
            "target_names":["y"],"recipe":recipe,"source_schemas":schemas,"state":state});
        let mut plan = outcome.effective_plan;
        plan.node_plans
            .get_mut(&record.node_id)
            .unwrap()
            .params
            .clear();
        plan.graph_plan
            .graph
            .nodes
            .iter_mut()
            .find(|node| node.id == record.node_id)
            .unwrap()
            .operator = Some(
            serde_json::json!({"type":"N4mMultimodalPipeline","recipe":saved["recipe"],"source_schemas":saved["source_schemas"]}),
        );
        (record, saved, plan)
    }

    fn seal(record: &mut RefitArtifactRecord, saved: &Value) -> Vec<u8> {
        let bytes = serde_json::to_vec(saved).unwrap();
        let digest = format!("{:x}", Sha256::digest(&bytes));
        record.artifact.content_fingerprint = Some(digest.clone());
        record.artifact.uri = Some(format!("artifacts/{digest}.json"));
        record.artifact.size_bytes = Some(bytes.len() as u64);
        bytes
    }

    #[test]
    fn complete_transport_owners_bind_exact_declared_profile() {
        for host in ["python", "wasm", "r", "octave"] {
            let (mut record, saved, plan) = fixture();
            record.controller_id =
                crate::ControllerId::new(format!("controller:methods.{host}.multimodal")).unwrap();
            record.artifact.controller_id = record.controller_id.clone();
            record.artifact.plugin = Some(format!("dagml.methods.{host}.multimodal"));
            let bytes = seal(&mut record, &saved);
            validate_methods_multimodal_pipeline_recipe(&record, &bytes, &plan).unwrap();
            record.artifact.controller_id = crate::ControllerId::new("controller:foreign").unwrap();
            assert!(validate_methods_multimodal_pipeline_payload(&record, &bytes).is_err());
        }
    }

    #[test]
    fn resigned_wrapper_cannot_change_shape_identity_recipe_or_order() {
        for mutation in [
            "shape", "identity", "order", "alpha", "scale", "column", "unknown", "magic", "format",
        ] {
            let (mut record, mut saved, plan) = fixture();
            match mutation {
                "shape" => {
                    saved["source_schemas"]["image"]["input_shape"] = serde_json::json!([8, 8, 1])
                }
                "identity" => {
                    saved["source_schemas"]["nir"]["identity"] =
                        Value::String("{\"unit\":\"foreign\"}".into())
                }
                "order" => {
                    saved["recipe"]["source_order"] =
                        serde_json::json!(["image", "nir", "series", "metadata"])
                }
                "alpha" => saved["recipe"]["model"]["params"]["alpha"] = Value::from(0.2),
                "scale" => saved["recipe"]["model"]["params"]["scale_x"] = Value::Bool(true),
                "column" => {
                    saved["recipe"]["encoders"]["metadata"]["numeric_columns"] =
                        serde_json::json!([1])
                }
                "unknown" => saved["untrusted"] = Value::Bool(true),
                "magic" => saved["state"][0] = Value::from(0),
                "format" => saved["state"][4] = Value::from(2),
                _ => unreachable!(),
            }
            let bytes = seal(&mut record, &saved);
            assert!(
                validate_methods_multimodal_pipeline_recipe(&record, &bytes, &plan).is_err(),
                "{mutation}"
            );
        }
    }

    #[test]
    fn selected_parameters_are_bound_to_the_complete_recipe() {
        let (mut record, mut saved, mut plan) = fixture();
        plan.node_plans.get_mut(&record.node_id).unwrap().params = BTreeMap::from([
            ("model__alpha".into(), Value::from(0.1)),
            ("source_weights__image".into(), Value::from(0.5)),
            ("transformers__image__n_components".into(), Value::from(4)),
        ]);
        let stale = seal(&mut record, &saved);
        assert!(validate_methods_multimodal_pipeline_recipe(&record, &stale, &plan).is_err());
        saved["recipe"]["model"]["params"]["alpha"] = Value::from(0.1);
        saved["recipe"]["source_weights"]["image"] = Value::from(0.5);
        saved["recipe"]["encoders"]["image"]["n_components"] = Value::from(4);
        let bytes = seal(&mut record, &saved);
        validate_methods_multimodal_pipeline_recipe(&record, &bytes, &plan).unwrap();
        plan.node_plans
            .get_mut(&record.node_id)
            .unwrap()
            .params
            .insert("unsupported".into(), Value::from(1));
        assert!(validate_methods_multimodal_pipeline_recipe(&record, &bytes, &plan).is_err());
    }

    #[test]
    fn selected_modalities_bind_full_raw_schemas_and_immutable_base_recipe() {
        for order in [
            vec!["nir"],
            vec!["series", "nir"],
            vec!["metadata", "image"],
        ] {
            let (mut record, mut saved, mut plan) = fixture();
            saved["recipe"]["source_order"] = serde_json::json!(order);
            for field in ["encoders", "source_weights"] {
                saved["recipe"][field]
                    .as_object_mut()
                    .unwrap()
                    .retain(|name, _| order.contains(&name.as_str()));
            }
            saved["recipe"]["source_weights"][order[0]] = Value::from(0.0);
            let operator = plan
                .graph_plan
                .graph
                .nodes
                .iter_mut()
                .find(|node| node.id == record.node_id)
                .unwrap()
                .operator
                .as_mut()
                .unwrap();
            operator["recipe"] = saved["recipe"].clone();
            let base = saved["recipe"].clone();
            plan.node_plans.get_mut(&record.node_id).unwrap().params = BTreeMap::from([
                ("recipe".into(), base),
                ("source_schemas".into(), saved["source_schemas"].clone()),
                ("model__alpha".into(), Value::from(0.25)),
            ]);
            saved["recipe"]["model"]["params"]["alpha"] = Value::from(0.25);
            let bytes = seal(&mut record, &saved);
            validate_methods_multimodal_pipeline_recipe(&record, &bytes, &plan).unwrap();
            saved["source_schemas"]["image"]["identity"] = Value::from("{\"excluded\":true}");
            let changed = seal(&mut record, &saved);
            assert!(validate_methods_multimodal_pipeline_recipe(&record, &changed, &plan).is_err());
        }
    }

    #[test]
    fn structural_declarations_refuse_partial_mutated_and_legacy_numeric_profiles() {
        for mutation in ["partial", "recipe", "schemas", "legacy"] {
            let (mut record, saved, mut plan) = fixture();
            let params = &mut plan.node_plans.get_mut(&record.node_id).unwrap().params;
            params.insert("recipe".into(), saved["recipe"].clone());
            params.insert("source_schemas".into(), saved["source_schemas"].clone());
            match mutation {
                "partial" => {
                    params.remove("source_schemas");
                }
                "recipe" => {
                    params.get_mut("recipe").unwrap()["source_weights"]["nir"] = Value::from(0.5)
                }
                "schemas" => {
                    params.get_mut("source_schemas").unwrap()["series"]["identity"] =
                        Value::from("{}")
                }
                "legacy" => {
                    params.insert("source_weights__image".into(), Value::from(1.0));
                }
                _ => unreachable!(),
            }
            let bytes = seal(&mut record, &saved);
            assert!(
                validate_methods_multimodal_pipeline_recipe(&record, &bytes, &plan).is_err(),
                "{mutation}"
            );
        }
    }

    #[test]
    fn raw_member_binding_and_closed_state_are_required() {
        let (mut record, mut saved, plan) = fixture();
        let bytes = seal(&mut record, &saved);
        record.artifact.uri = Some("artifacts/foreign.json".into());
        assert!(validate_methods_multimodal_pipeline_payload(&record, &bytes).is_err());
        saved["state"] = serde_json::json!([]);
        let bytes = seal(&mut record, &saved);
        assert!(validate_methods_multimodal_pipeline_recipe(&record, &bytes, &plan).is_err());
        saved["state"] = serde_json::to_value(vec![256; 28]).unwrap();
        let bytes = seal(&mut record, &saved);
        assert!(validate_methods_multimodal_pipeline_payload(&record, &bytes).is_err());
    }
}
