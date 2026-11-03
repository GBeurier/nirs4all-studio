//! DAG-owned native high-level raw U07 replay preparation.
//! Receives an IO-owned current cohort, never a host-authored request/manifest.
use crate::{
    ExternalDataPlanEnvelope, Phase, PortablePredictorPackage, PredictCohort, PredictCohortRole,
    SampleRelationSet, TrainingReplayRequest,
};
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};

type Result<T> = std::result::Result<T, Box<dyn std::error::Error>>;

/// Independently installed fixed manifest. Its fields are not read from a package.
pub fn multimodal_manifest(host: &str) -> Result<Value> {
    if !["python", "wasm", "r", "octave"].contains(&host) {
        return Err("Unsupported multimodal producer host".into());
    }
    Ok(
        json!({"controller_id":format!("controller:methods.{host}.multimodal"),"controller_version":"1.0.0","operator_kind":"model","priority":0,"supported_phases":["FIT_CV","REFIT","PREDICT"],
        "input_ports":[{"name":"x","kind":"data","representation":"feature_block_set","cardinality":"one","description":""}],
        "output_ports":[{"name":"y_hat","kind":"prediction","representation":null,"cardinality":"one","description":""},{"name":"model","kind":"artifact","representation":null,"cardinality":"one","description":""}],
        "data_requirements":{"schema_version":1,"default_fusion":{"mode":"dict_by_source","alignment":"sample_id","adapter_id":null,"params":{}},"metadata":{},"ports":[{"name":"x","accepted_representations":["feature_block_set"],"accepted_types":["multi_block"],"rank":null,"multi_source":true,"optional":false,"metadata":{}}]},
        "capabilities":["deterministic","thread_safe","process_safe","emits_predictions","emits_artifacts","stateful","uses_core_rng"],"fit_scope":"fold_train","rng_policy":"externally_deterministic","artifact_policy":"serializable"}),
    )
}

fn semantic_schema(mut value: Value) -> Result<Value> {
    value["identity"] = serde_json::from_str(
        value["identity"]
            .as_str()
            .ok_or("Source identity missing")?,
    )?;
    Ok(value)
}

fn semantic_equal(a: &Value, b: &Value) -> bool {
    match (a, b) {
        (Value::Number(a), Value::Number(b)) => {
            if a.is_f64() == b.is_f64() {
                a == b
            } else {
                let integer = if a.is_f64() { b } else { a };
                integer
                    .as_f64()
                    .is_some_and(|value| value.abs() <= 9_007_199_254_740_991.0)
                    && a.as_f64() == b.as_f64()
            }
        }
        (Value::Array(a), Value::Array(b)) => {
            a.len() == b.len() && a.iter().zip(b).all(|(a, b)| semantic_equal(a, b))
        }
        (Value::Object(a), Value::Object(b)) => {
            a.len() == b.len()
                && a.iter()
                    .all(|(key, a)| b.get(key).is_some_and(|b| semantic_equal(a, b)))
        }
        _ => a == b,
    }
}

fn prepare_sources(
    current: &Value,
    saved: &serde_json::Map<String, Value>,
    supplied: &serde_json::Map<String, Value>,
) -> Result<Value> {
    let mut sources = current
        .get("sources")
        .and_then(Value::as_object)
        .ok_or("Raw sources must be an object")?
        .clone();
    if sources.keys().collect::<BTreeSet<_>>() != saved.keys().collect::<BTreeSet<_>>() {
        return Err("Raw source names differ from the declared schemas".into());
    }
    for (name, schema) in saved {
        if !semantic_equal(
            &semantic_schema(schema.clone())?,
            &semantic_schema(supplied[name].clone())?,
        ) {
            return Err(format!("Raw source schema differs: {name}").into());
        }
        let source = sources
            .get_mut(name)
            .and_then(Value::as_object_mut)
            .ok_or_else(|| format!("Raw source must be an object: {name}"))?;
        source.insert("descriptor".into(), schema.clone());
    }
    Ok(Value::Object(sources))
}

/// Validate a portable package and create an inference-only signed native request.
/// `current` is the result of IO `multimodal_runtime_input`, not archive metadata.
pub fn prepare_multimodal_replay(
    package: &PortablePredictorPackage,
    current: &Value,
) -> Result<Value> {
    package.validate()?;
    let document = serde_json::to_value(package)?;
    let plan = &document["effective_plan"];
    let nodes = plan["graph_plan"]["graph"]["nodes"]
        .as_array()
        .ok_or("Missing native graph")?;
    let [node] = nodes.as_slice() else {
        return Err("Raw replay requires one complete native multimodal node".into());
    };
    if node["kind"] != "model" || node["operator"]["type"] != "N4mMultimodalPipeline" {
        return Err("Unsupported native raw replay profile".into());
    }
    let node_id = node["id"].as_str().ok_or("Missing node ID")?;
    let selected = &plan["node_plans"][node_id];
    let owner = selected["controller_id"]
        .as_str()
        .ok_or("Missing native producer")?;
    let host = ["python", "wasm", "r", "octave"]
        .into_iter()
        .find(|host| owner == format!("controller:methods.{host}.multimodal"))
        .ok_or("Unknown native producer")?;
    if node["metadata"]["controller_id"] != owner {
        return Err("Native producer declaration mismatch".into());
    }
    let bindings = selected["data_bindings"]
        .as_array()
        .ok_or("Missing native bindings")?;
    if bindings.len() != 1 || bindings[0]["source_ids"] != current["source_ids"] {
        return Err("Raw source binding order differs".into());
    }
    let saved = node["operator"]["source_schemas"]
        .as_object()
        .ok_or("Missing source schemas")?;
    let supplied = current["source_schemas"]
        .as_object()
        .ok_or("Missing current schemas")?;
    if saved.len() != 4
        || saved.keys().collect::<BTreeSet<_>>() != supplied.keys().collect::<BTreeSet<_>>()
    {
        return Err("Raw source names differ".into());
    }
    let sources = prepare_sources(current, saved, supplied)?;
    let [output] = package.output_bindings.as_slice() else {
        return Err("Raw replay requires one native output".into());
    };
    if serde_json::to_value(&output.target_names)? != json!(["y"]) {
        return Err("U07 requires one target named y".into());
    }
    let relations: SampleRelationSet =
        serde_json::from_value(current["coordinator_relations"].clone())?;
    relations.validate()?;
    let content = current["data_content_fingerprint"]
        .as_str()
        .ok_or("Missing current content identity")?
        .to_owned();
    let cohort = PredictCohort::from_relations(
        PredictCohortRole::Inference,
        relations.clone(),
        output.target_names.clone(),
        content.clone(),
        None,
    )?;
    let mut envelopes = BTreeMap::new();
    for requirement in &package.execution_bundle.data_requirements {
        let key = format!("{}.{}", requirement.node_id, requirement.input_name);
        let envelope = ExternalDataPlanEnvelope {
            schema_version: 2,
            schema_fingerprint: requirement.schema_fingerprint.clone(),
            plan_fingerprint: requirement.plan_fingerprint.clone(),
            relation_fingerprint: Some(relations.fingerprint()?),
            data_content_fingerprint: Some(content.clone()),
            target_content_fingerprint: None,
            coordinator_relations: Some(relations.clone()),
            predict_cohort: Some(cohort.clone()),
        };
        envelope.validate()?;
        if envelopes.insert(key, envelope).is_some() {
            return Err("Repeated native replay data requirement".into());
        }
    }
    if envelopes.is_empty() {
        return Err("Native predictor has no raw requirements".into());
    }
    let mut request = TrainingReplayRequest {
        schema_version: 1,
        request_id: "replay:public.multimodal".into(),
        source_outcome_fingerprint: package.training_outcome.outcome_fingerprint.clone(),
        phase: Phase::Predict,
        data_envelope_keys: envelopes.keys().cloned().collect(),
        output_binding_ids: vec![output.binding_id.clone()],
        request_fingerprint: String::new(),
    };
    request.request_fingerprint = request.compute_fingerprint()?;
    request.validate()?;
    let manifest = multimodal_manifest(host)?;
    let mut params = serde_json::Map::new();
    params.insert(
        node_id.into(),
        selected.get("params").cloned().unwrap_or_else(|| json!({})),
    );
    Ok(
        json!({"request":request,"envelopes":envelopes,"trusted_controllers":[manifest.clone()],"sample_ids":current["sample_ids"],
        "config":{"sources":sources,"operators":{node_id:node["operator"]},"node_params":params,"source_ids":current["source_ids"],"targets":null,"target_names":output.target_names,
            "allow_fit":false,"controller_id":owner,"manifest":manifest.clone(),"trusted_manifest":manifest},"training_performed":false}),
    )
}

#[cfg(test)]
mod schema_tests {
    use super::{prepare_sources, semantic_equal};
    use serde_json::json;

    #[test]
    fn coordinates_do_not_collapse_distinct_large_integers() {
        assert!(semantic_equal(&json!([900]), &json!([900.0])));
        assert!(!semantic_equal(
            &json!([9_007_199_254_740_992_u64]),
            &json!([9_007_199_254_740_993_u64])
        ));
        assert!(!semantic_equal(
            &json!([9_007_199_254_740_993_u64]),
            &json!([9_007_199_254_740_992.0])
        ));
    }

    #[test]
    fn raw_sources_reject_invalid_containers_and_missing_names_without_panicking() {
        let schema = json!({"nir": {"kind": "signal", "axis": [900, 901], "identity": "{}"}});
        let schemas = schema.as_object().unwrap();
        for current in [
            json!({}),
            json!({"sources": null}),
            json!({"sources": []}),
            json!({"sources": 42}),
            json!({"sources": {}}),
            json!({"sources": {"nir": null}}),
            json!({"sources": {"nir": 42}}),
            json!({"sources": {"nir": []}}),
            json!({"sources": {"nir": { }, "extra": {}}}),
        ] {
            assert!(
                prepare_sources(&current, schemas, schemas).is_err(),
                "{current}"
            );
        }
        let current = json!({"sources": {"nir": {"values": [[1.0, 2.0]]}}});
        let prepared = prepare_sources(&current, schemas, schemas).unwrap();
        assert_eq!(prepared["nir"]["descriptor"], schema["nir"]);
        assert_eq!(
            prepared["nir"]["values"],
            current["sources"]["nir"]["values"]
        );
        assert!(current["sources"]["nir"].get("descriptor").is_none());
    }
}
