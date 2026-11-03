//! Pure product recipe/envelope contracts, reusable in CPU and WASM bindings.
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NativePipelineStep {
    pub method_id: String,
    pub role: String,
    #[serde(default)]
    pub params: BTreeMap<String, Value>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NativePipelineRecipe {
    pub steps: Vec<NativePipelineStep>,
    pub candidates: Vec<BTreeMap<String, Value>>,
}

/// Validate the product envelope and its signed upstream package/outcome closure.
pub fn validate_pipeline(record: &Value) -> Result<dag_ml_core::PortablePredictorPackage, String> {
    let keys = [
        "schema",
        "schema_version",
        "config",
        "training_outcome",
        "package",
    ];
    if record
        .as_object()
        .is_none_or(|o| o.len() != keys.len() || keys.iter().any(|k| !o.contains_key(*k)))
        || record["schema"] != "nirs4all.native-pipeline.v1"
        || record["schema_version"] != 1
    {
        return Err("unsupported native pipeline envelope".into());
    }
    let package = dag_ml_core::PortablePredictorPackage::from_json(
        &serde_json::to_string(&record["package"]).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    let outcome = dag_ml_core::TrainingOutcome::from_json(
        &serde_json::to_string(&record["training_outcome"]).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    outcome.validate().map_err(|e| e.to_string())?;
    if package.training_outcome != outcome.to_reference().map_err(|e| e.to_string())?
        || package.execution_bundle != outcome.execution_bundle
        || package.effective_plan != outcome.effective_plan
    {
        return Err("pipeline package differs from its native training outcome".into());
    }
    let config = &record["config"];
    let recipe: NativePipelineRecipe =
        serde_json::from_value(config["pipeline"].clone()).map_err(|e| e.to_string())?;
    if recipe.steps.is_empty()
        || recipe.steps.len() > 32
        || recipe.candidates.is_empty()
        || recipe.candidates.len() > 32
    {
        return Err("invalid native recipe dimensions".into());
    }
    if config
        .as_object()
        .is_none_or(|o| o.len() != 2 || !o.contains_key("source_id") || !o.contains_key("pipeline"))
        || package
            .template
            .campaign
            .metadata
            .get("native_pipeline_recipe")
            != Some(&config["pipeline"])
    {
        return Err("pipeline choices differ from signed training recipe".into());
    }
    validate_recipe_closure(record, &recipe)?;
    let sources: Vec<_> = package
        .template
        .campaign
        .data_bindings
        .values()
        .flatten()
        .flat_map(|b| b.source_ids.iter())
        .collect();
    if sources.len() != 1 || config["source_id"].as_str() != Some(sources[0].as_str()) {
        return Err("pipeline source differs from signed IO binding".into());
    }
    if package
        .execution_bundle
        .refit_artifacts
        .iter()
        .any(|r| r.artifact.kind != "n4m_estimator")
    {
        return Err("native pipeline accepts only native N4ME estimator states".into());
    }
    Ok(package)
}

/// Native parse/validation preserves uint64 values before any host presentation.
pub fn parse_native_pipeline_record(input: &str) -> Result<Value, String> {
    let record: Value = serde_json::from_str(input).map_err(|e| e.to_string())?;
    validate_pipeline(&record)?;
    Ok(record)
}

/// The public recipe is executable on retrain: bind it to the actual native DAG,
/// rather than treating matching metadata as proof of the execution contract.
fn validate_recipe_closure(record: &Value, recipe: &NativePipelineRecipe) -> Result<(), String> {
    let fail = || "pipeline graph differs from signed training recipe".to_string();
    let package = &record["package"];
    let graph = &package["template"]["graph"];
    let nodes = graph["nodes"].as_array().ok_or_else(fail)?;
    let edges = graph["edges"].as_array().ok_or_else(fail)?;
    let plans = package["effective_plan"]["node_plans"]
        .as_object()
        .ok_or_else(fail)?;
    let artifacts = package["execution_bundle"]["refit_artifacts"]
        .as_array()
        .ok_or_else(fail)?;
    if nodes.len() != recipe.steps.len()
        || edges.len() + 1 != nodes.len()
        || plans.len() != nodes.len()
        || artifacts.len() != nodes.len()
    {
        return Err(fail());
    }
    let last = nodes.len() - 1;
    let mut ids = Vec::with_capacity(nodes.len());
    for (i, step) in recipe.steps.iter().enumerate() {
        let final_node = i == last;
        if (final_node && !matches!(step.role.as_str(), "regressor" | "classifier"))
            || (!final_node && !matches!(step.role.as_str(), "transformer" | "selector"))
            || step.method_id.is_empty()
            || step.params.contains_key("method_id")
            || step.params.contains_key("unsafe_flags")
            || (!final_node && step.params.contains_key("native_target_index"))
        {
            return Err(fail());
        }
        let id = if final_node {
            "model:pls".to_string()
        } else {
            format!("transform:{i}")
        };
        let mut params = step.params.clone();
        params.insert("method_id".into(), Value::String(step.method_id.clone()));
        let params = serde_json::to_value(params).map_err(|_| fail())?;
        let node = &nodes[i];
        let plan = plans.get(&id).ok_or_else(fail)?;
        let controller = format!("controller:n4m.{}", step.role);
        if node["id"] != id
            || node["kind"] != if final_node { "model" } else { "transform" }
            || node["operator"] != format!("n4m:{}", step.method_id)
            || node["params"] != params
            || plan["controller_id"] != controller
        {
            return Err(fail());
        }
        if !final_node && plan["params"] != params {
            return Err(fail());
        }
        if final_node
            && !recipe.candidates.iter().any(|candidate| {
                if candidate.contains_key("method_id")
                    || candidate.contains_key("unsafe_flags")
                    || candidate.contains_key("native_target_index")
                {
                    return false;
                }
                let mut effective = step.params.clone();
                effective.extend(candidate.clone());
                effective.insert("method_id".into(), Value::String(step.method_id.clone()));
                serde_json::to_value(effective).is_ok_and(|value| value == plan["params"])
            })
        {
            return Err(fail());
        }
        let matching: Vec<_> = artifacts
            .iter()
            .filter(|artifact| artifact["node_id"] == id)
            .collect();
        if matching.len() != 1
            || matching[0]["controller_id"] != controller
            || matching[0]["artifact"]["native_estimator_descriptor"]["method_id"] != step.method_id
        {
            return Err(fail());
        }
        ids.push(id);
    }
    for (i, edge) in edges.iter().enumerate() {
        let expected = serde_json::json!({
            "source": {"node_id": ids[i], "port_name": "x_out"},
            "target": {"node_id": ids[i+1], "port_name": "x"},
            "contract": {"kind":"data", "representation":"tabular_numeric",
                "requires_oof":false,"requires_fold_alignment":true,"propagates_lineage":true}
        });
        if edge != &expected {
            return Err(fail());
        }
    }
    let choices: Vec<_> = recipe.candidates.iter().enumerate().map(|(i, params)| {
        let overrides = if params.is_empty() { vec![] } else {
            vec![serde_json::json!({"node_id":"model:pls", "params":params})]
        };
        serde_json::json!({"label":format!("candidate_{i}"), "value":i, "param_overrides":overrides})
    }).collect();
    let expected_generation = serde_json::json!({"strategy":"cartesian",
        "dimensions":[{"name":"native_model_params", "choices":choices}],
        "max_variants":recipe.candidates.len()});
    let mut generation = package["template"]["campaign"]["generation"].clone();
    // Native serializers may omit default empty overrides and null optional
    // subsequences. Normalize these defaults, while rejecting nonempty closure
    // extensions through exact equality below.
    if let Some(dimensions) = generation["dimensions"].as_array_mut() {
        for dimension in dimensions {
            if let Some(choices) = dimension["choices"].as_array_mut() {
                for choice in choices {
                    if let Some(object) = choice.as_object_mut() {
                        object
                            .entry("param_overrides")
                            .or_insert_with(|| serde_json::json!([]));
                        if object.get("active_subsequence").is_some_and(Value::is_null) {
                            object.remove("active_subsequence");
                        }
                    }
                }
            }
        }
    }
    if generation != expected_generation {
        return Err(fail());
    }
    let bindings = package["template"]["campaign"]["data_bindings"]
        .as_object()
        .ok_or_else(fail)?;
    if bindings.len() != 1
        || bindings
            .get(&ids[0])
            .and_then(Value::as_array)
            .is_none_or(|b| b.len() != 1 || b[0]["node_id"] != ids[0] || b[0]["input_name"] != "x")
    {
        return Err(fail());
    }
    let outputs = package["output_bindings"].as_array().ok_or_else(fail)?;
    let kind = if recipe.steps[last].role == "classifier" {
        "class_label"
    } else {
        "regression_point"
    };
    if outputs.len() != 1
        || outputs[0]["node_id"] != "model:pls"
        || outputs[0]["port_name"] != "oof"
        || outputs[0]["prediction_kind"] != kind
        || outputs[0]["refit_strategy"] != "refit_one"
    {
        return Err(fail());
    }
    let mut predictor_ids: Vec<_> = package["predictor_node_ids"]
        .as_array()
        .ok_or_else(fail)?
        .iter()
        .map(|value| value.as_str().ok_or_else(fail))
        .collect::<Result<_, _>>()?;
    predictor_ids.sort_unstable();
    ids.sort_unstable();
    if predictor_ids != ids.iter().map(String::as_str).collect::<Vec<_>>() {
        return Err(fail());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn fixture() -> (Value, NativePipelineRecipe) {
        let recipe = NativePipelineRecipe {
            steps: vec![NativePipelineStep {
                method_id: "models.regularized.ridge".into(),
                role: "regressor".into(),
                params: BTreeMap::new(),
            }],
            candidates: vec![BTreeMap::new()],
        };
        let params = json!({"method_id":"models.regularized.ridge"});
        let record = json!({"package":{
            "template":{
                "graph":{"nodes":[{"id":"model:pls","kind":"model",
                    "operator":"n4m:models.regularized.ridge","params":params}],"edges":[]},
                "campaign":{"data_bindings":{"model:pls":[{"node_id":"model:pls","input_name":"x"}]},
                    "generation":{"strategy":"cartesian","dimensions":[{"name":"native_model_params",
                        "choices":[{"label":"candidate_0","value":0,"param_overrides":[]}]}],"max_variants":1}}
            },
            "effective_plan":{"node_plans":{"model:pls":{"controller_id":"controller:n4m.regressor","params":params}}},
            "execution_bundle":{"refit_artifacts":[{"node_id":"model:pls","controller_id":"controller:n4m.regressor",
                "artifact":{"native_estimator_descriptor":{"method_id":"models.regularized.ridge"}}}]},
            "output_bindings":[{"node_id":"model:pls","port_name":"oof","prediction_kind":"regression_point","refit_strategy":"refit_one"}],
            "predictor_node_ids":["model:pls"]
        }});
        (record, recipe)
    }

    #[test]
    fn closure_binds_retrain_recipe_to_execution_not_matching_metadata() {
        let (record, recipe) = fixture();
        validate_recipe_closure(&record, &recipe).unwrap();
        let mut omitted = record.clone();
        omitted["package"]["template"]["campaign"]["generation"]["dimensions"][0]["choices"][0]
            .as_object_mut()
            .unwrap()
            .remove("param_overrides");
        validate_recipe_closure(&omitted, &recipe).unwrap();
        let mut changed = recipe.clone();
        changed.steps[0].method_id = "models.pls.pls_nipals".into();
        assert!(validate_recipe_closure(&record, &changed).is_err());
        let mut changed = recipe.clone();
        changed.candidates[0].insert("alpha".into(), json!(9));
        assert!(validate_recipe_closure(&record, &changed).is_err());
        for path in [
            "/package/template/graph/nodes/0/operator",
            "/package/effective_plan/node_plans/model:pls/controller_id",
            "/package/execution_bundle/refit_artifacts/0/artifact/native_estimator_descriptor/method_id",
            "/package/output_bindings/0/node_id",
        ] {
            let mut tampered = record.clone();
            *tampered.pointer_mut(path).unwrap() = json!("forged");
            assert!(validate_recipe_closure(&tampered, &recipe).is_err(), "{path}");
        }
        let mut duplicated = record.clone();
        let artifact = duplicated["package"]["execution_bundle"]["refit_artifacts"][0].clone();
        duplicated["package"]["execution_bundle"]["refit_artifacts"]
            .as_array_mut()
            .unwrap()
            .push(artifact);
        assert!(validate_recipe_closure(&duplicated, &recipe).is_err());
    }
}
