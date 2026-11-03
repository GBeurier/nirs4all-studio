//! Closed Python classifier codecs and exact signed-plan portable identity.
use std::collections::BTreeSet;

use serde_json::Value;
use sha2::{Digest, Sha256};

use crate::{ArtifactBackend, DagMlError, ExecutionPlan, RefitArtifactRecord, Result};

pub const METHODS_MULTIMODAL_CLASSIFIER_SEMANTIC_PROFILE: &str =
    "dagml_methods_multimodal_classifier_pipeline_raw_sha256";
pub const METHODS_ROLE_CLASSIFIER_SEMANTIC_PROFILE: &str =
    "dagml_methods_role_classifier_pipeline_raw_sha256";

fn refuse<T>(message: &str) -> Result<T> {
    Err(DagMlError::RuntimeValidation(message.into()))
}

fn state(value: &Value) -> Result<Vec<u8>> {
    let bytes: Vec<u8> = serde_json::from_value(value.clone())?;
    if !(28..=67_108_864).contains(&bytes.len()) {
        return refuse("classifier state exceeds the bounded codec");
    }
    Ok(bytes)
}

/// Only the implemented Python owners may publish this profile. Portable bytes
/// do not imply a fitting or replay controller exists in another host.
pub fn validate_methods_classifier_payload(
    record: &RefitArtifactRecord,
    bytes: &[u8],
    plan: &ExecutionPlan,
) -> Result<()> {
    let raw = record.artifact.kind == "methods_multimodal_classifier_pipeline";
    if !raw && record.artifact.kind != "methods_role_classifier_pipeline" {
        return refuse("unknown classifier artifact kind");
    }
    let owner = if raw {
        "controller:methods.python.multimodal.classification"
    } else {
        "controller:methods.python.classification"
    };
    let plugin = if raw {
        "dagml.methods.python.multimodal.classification"
    } else {
        "dagml.methods.python.classification"
    };
    let artifact = &record.artifact;
    artifact.validate_portable()?;
    let hash = format!("{:x}", Sha256::digest(bytes));
    if artifact.controller_id.as_str() != owner
        || record.controller_id.as_str() != owner
        || artifact.backend != Some(ArtifactBackend::Raw)
        || artifact.plugin.as_deref() != Some(plugin)
        || artifact.plugin_version.as_deref() != Some("1.0.0")
        || artifact.native_predictor_descriptor.is_some()
        || artifact.native_estimator_descriptor.is_some()
        || bytes.is_empty()
        || bytes.len() > 134_217_728
        || artifact.content_fingerprint.as_deref() != Some(hash.as_str())
        || artifact.size_bytes != Some(bytes.len() as u64)
        || artifact.uri.as_deref() != Some(format!("artifacts/{hash}.json").as_str())
    {
        return refuse("classifier RAW owner, URI, size or exact byte identity mismatch");
    }
    let text = std::str::from_utf8(bytes)
        .map_err(|_| DagMlError::RuntimeValidation("classifier wrapper is not UTF-8".into()))?;
    crate::canonical::parse_typed_json(text).map_err(|error| {
        DagMlError::RuntimeValidation(format!(
            "classifier wrapper is outside strict TCV1: {error}"
        ))
    })?;
    let saved: Value = serde_json::from_str(text)?;
    let expected_keys = if raw {
        BTreeSet::from([
            "schema",
            "node_id",
            "params_fingerprint",
            "target_names",
            "recipe",
            "source_schemas",
            "classification",
            "state",
        ])
    } else {
        BTreeSet::from([
            "schema",
            "node_id",
            "params_fingerprint",
            "target_names",
            "steps",
            "source_order",
            "classification",
            "feature_names",
            "states",
        ])
    };
    let keys = saved
        .as_object()
        .ok_or_else(|| {
            DagMlError::RuntimeValidation("classifier wrapper must be an object".into())
        })?
        .keys()
        .map(String::as_str)
        .collect::<BTreeSet<_>>();
    let schema = if raw {
        "dagml.methods.multimodal.classification.v1"
    } else {
        "dagml.methods.classification.v1"
    };
    let node_plan = plan.node_plans.get(&record.node_id).ok_or_else(|| {
        DagMlError::RuntimeValidation("classifier has no selected node plan".into())
    })?;
    let operator = plan
        .graph_plan
        .graph
        .nodes
        .iter()
        .find(|node| node.id == record.node_id)
        .and_then(|node| node.operator.as_ref())
        .ok_or_else(|| {
            DagMlError::RuntimeValidation("classifier has no signed graph operator".into())
        })?;
    let kind = if raw {
        crate::METHODS_RAW_CLASSIFIER
    } else {
        crate::METHODS_META_CLASSIFIER
    };
    if keys != expected_keys
        || saved["schema"] != schema
        || saved["node_id"] != record.node_id.as_str()
        || saved["target_names"] != serde_json::json!(["y"])
        || saved["params_fingerprint"] != record.params_fingerprint
        || record.params_fingerprint != node_plan.params_fingerprint
        || node_plan.controller_id != record.controller_id
        || operator["type"] != kind
        || saved["classification"] != operator["classification"]
    {
        return refuse("classifier wrapper differs from its exact signed selected graph identity");
    }
    let vocabulary = crate::methods_operator_classification(operator)?
        .ok_or_else(|| DagMlError::RuntimeValidation("classifier class identity missing".into()))?;
    let recipe =
        crate::methods_classification::methods_classifier_recipe(operator, &node_plan.params)?;
    if raw {
        if saved["recipe"] != recipe || saved["source_schemas"] != operator["source_schemas"] {
            return refuse(
                "classifier saved raw recipe or source identities differ from selected parameters",
            );
        }
        crate::methods_classification_state::validate_classifier_n4mc(
            &state(&saved["state"])?,
            &recipe,
            &saved["source_schemas"],
            &vocabulary.class_labels,
        )?;
    } else {
        let producers =
            crate::methods_classification::classifier_input_nodes(plan, &record.node_id)?;
        let names = producers
            .iter()
            .flat_map(|producer| {
                vocabulary
                    .class_labels
                    .iter()
                    .map(move |class| format!("{producer}/class:{class}"))
            })
            .collect::<Vec<_>>();
        let states = saved["states"].as_array().ok_or_else(|| {
            DagMlError::RuntimeValidation("classifier meta states missing".into())
        })?;
        if saved["steps"] != recipe
            || saved["source_order"] != operator["source_order"]
            || saved["feature_names"] != serde_json::to_value(&names)?
            || states.len() != 1
        {
            return refuse("classifier meta recipe or ordered branch/class features differ from signed topology");
        }
        crate::methods_classification_state::validate_classifier_n4me(
            &state(&states[0])?,
            &recipe[0]["params"],
            names.len(),
            &vocabulary.class_labels,
        )?;
    }
    Ok(())
}
