//! Bounded native regression workflow over one IO package source.
//!
//! IO owns rows and identities, DAG-ML owns CV/OOF selection and refit, and
//! Methods owns SNV, Savitzky-Golay and PLS. This module only configures their
//! existing typed contracts and returns the native outcome with Archive V2.

use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::path::Path;

use dag_ml_core::generation::{
    GenerationChoice, GenerationDimension, GenerationParamOverride, GenerationStrategy,
};
use dag_ml_core::{BundleId, NodeId, RunId, TrainingRequest};

use crate::io_training::{
    canonical_pls_training_request, train_dataset_package_methods_archive_v2, CanonicalPlsProfile,
    DatasetPackage, DatasetPackageMethodsArchiveV2Outcome, DatasetPackageMethodsArchiveV2Request,
    DatasetPackageMethodsProvider,
};

/// Native preprocessing profiles backed by Methods fitted-state transport.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum DenseRegressionPreprocessing {
    /// PLS over raw numeric features, without spectral preprocessing.
    Raw,
    /// Methods SNV, then Savitzky-Golay with window five and degree two.
    SnvSavitzkyGolay,
}

/// User-facing workflow choices; no caller-authored DAG manifests are needed.
pub struct DenseRegressionWorkflowRequest<'a> {
    pub dataset: &'a DatasetPackage,
    pub source_id: &'a str,
    pub components: &'a [u32],
    pub preprocessing: DenseRegressionPreprocessing,
    pub methods_library_path: &'a Path,
    pub archive_path: &'a Path,
    pub run_id: &'a str,
}

/// Build the native CV request with Methods preprocessing inside every fold.
pub fn dense_regression_training_request(
    dataset: &DatasetPackage,
    source_id: &str,
    components: &[u32],
    preprocessing: DenseRegressionPreprocessing,
) -> Result<TrainingRequest, String> {
    if components.len() < 2 || components.len() > 32 {
        return Err("workflow requires 2 to 32 PLS component candidates".into());
    }
    let mut unique = std::collections::BTreeSet::new();
    for &count in components {
        if count == 0 || count > i32::MAX as u32 || !unique.insert(count) {
            return Err("PLS components must be distinct positive i32 values".into());
        }
    }
    let provider = DatasetPackageMethodsProvider::new(dataset, source_id)?;
    if !dataset.folds.is_empty() || !dataset.fold_provenance.is_empty() {
        return Err("this bounded two-fold workflow does not accept declared folds".into());
    }
    if provider.relations().records.iter().any(|relation| {
        relation
            .group_id
            .as_ref()
            .is_some_and(|group| group.as_str() != relation.sample_id.as_str())
            || relation.origin_sample_id.is_some()
    }) {
        return Err(
            "this bounded workflow requires independent samples without groups or origins".into(),
        );
    }
    let profile = match preprocessing {
        DenseRegressionPreprocessing::Raw => CanonicalPlsProfile::Raw,
        DenseRegressionPreprocessing::SnvSavitzkyGolay => CanonicalPlsProfile::SnvSavitzkyGolay,
    };
    let mut request = canonical_pls_training_request(&provider, profile)?;
    if request.options.outputs.len() != 1 || request.options.outputs[0].target_names.len() != 1 {
        return Err("this bounded workflow requires exactly one numeric target".into());
    }
    if let Some(schema) = dataset
        .audits
        .iter()
        .find_map(|audit| audit.get("raw_source_schema"))
    {
        request
            .campaign
            .metadata
            .insert("raw_source_schema".into(), schema.clone());
    }
    let input_sample_ids = if let Some(ids) = dataset
        .audits
        .iter()
        .find_map(|audit| audit.get("input_sample_ids"))
    {
        ids.clone()
    } else {
        let assembled = dataset.to_assembled();
        let cohort = nirs4all_io_dagml::methods_pls_predict_cohort(&assembled, "train", source_id)
            .map_err(|error| error.to_string())?;
        json!(cohort.sample_ids)
    };
    let ids = input_sample_ids
        .as_array()
        .ok_or("input_sample_ids must be an array")?;
    let actual_ids: std::collections::BTreeSet<_> = provider
        .relations()
        .records
        .iter()
        .map(|record| record.sample_id.to_string())
        .collect();
    let declared_ids: std::collections::BTreeSet<_> = ids
        .iter()
        .map(|id| id.as_str().ok_or("input_sample_ids must contain strings"))
        .collect::<Result<_, _>>()?;
    if ids.len() != actual_ids.len()
        || declared_ids.len() != ids.len()
        || declared_ids
            .iter()
            .copied()
            .ne(actual_ids.iter().map(String::as_str))
    {
        return Err("input_sample_ids must exactly cover the independent training cohort".into());
    }
    request
        .campaign
        .metadata
        .insert("input_sample_ids".into(), input_sample_ids);
    let node_id = NodeId::new("model:pls").map_err(|error| error.to_string())?;
    request.campaign.generation.strategy = GenerationStrategy::Cartesian;
    request.campaign.generation.max_variants = Some(components.len());
    request.campaign.generation.dimensions = vec![GenerationDimension {
        name: "pls_components".into(),
        choices: components
            .iter()
            .map(|&count| GenerationChoice {
                label: format!("pls_{count}"),
                value: serde_json::json!(count),
                param_overrides: vec![GenerationParamOverride {
                    node_id: node_id.clone(),
                    params: BTreeMap::from([("n_components".into(), serde_json::json!(count))]),
                }],
                active_subsequence: None,
            })
            .collect(),
    }];
    request.request_fingerprint = request
        .compute_fingerprint()
        .map_err(|error| error.to_string())?;
    request.validate().map_err(|error| error.to_string())?;
    Ok(request)
}

/// Execute native CV/OOF selection, full-data refit and Archive V2 export.
pub fn run_dense_regression_workflow(
    input: DenseRegressionWorkflowRequest<'_>,
) -> Result<DatasetPackageMethodsArchiveV2Outcome, String> {
    preflight_workflow_archive_path(input.archive_path)?;
    let request = dense_regression_training_request(
        input.dataset,
        input.source_id,
        input.components,
        input.preprocessing,
    )?;
    let run_id = RunId::new(input.run_id).map_err(|error| error.to_string())?;
    let bundle_id =
        BundleId::new(format!("bundle:{}", input.run_id)).map_err(|error| error.to_string())?;
    let archive_id = format!("archive:{}", input.run_id);
    let package_id = format!("package:{}", input.run_id);
    let outcome_id = format!("outcome:{}", input.run_id);
    train_dataset_package_methods_archive_v2(DatasetPackageMethodsArchiveV2Request {
        dataset: input.dataset,
        source_id: input.source_id,
        training_request: &request,
        outcome_id: &outcome_id,
        run_id,
        bundle_id,
        package_id: &package_id,
        archive_id: &archive_id,
        archive_path: input.archive_path,
        methods_library_path: input.methods_library_path,
    })
}

/// Refuse output collisions or an invalid parent before native training starts.
pub fn preflight_workflow_archive_path(path: &Path) -> Result<(), String> {
    if path.file_name().is_none() {
        return Err("workflow archive must name a new file".into());
    }
    match std::fs::symlink_metadata(path) {
        Ok(_) => {
            return Err(format!(
                "workflow archive already exists: {}",
                path.display()
            ))
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(format!("cannot inspect workflow archive: {error}")),
    }
    let parent = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));
    if !parent.is_dir() {
        return Err(format!(
            "workflow archive parent must be an existing directory: {}",
            parent.display()
        ));
    }
    Ok(())
}

/// Derive choices only for this exact CPU workflow after native archive validation.
///
/// This is a product-profile guard, not a replacement for DAG package/payload
/// validation. Other valid DAG profiles can still use the common replay APIs.
pub fn dense_regression_workflow_config(
    package: &dag_ml_core::PortablePredictorPackage,
) -> Result<Value, String> {
    bounded_workflow_config(&serde_json::to_value(package).map_err(|error| error.to_string())?)
}

fn bounded_workflow_config(package: &Value) -> Result<Value, String> {
    let unsupported =
        || "archive does not contain the bounded CPU dense workflow profile".to_string();
    let template = &package["template"];
    let nodes = template["graph"]["nodes"]
        .as_array()
        .ok_or_else(unsupported)?;
    if nodes.len() != 1
        || template["graph"]["edges"] != json!([])
        || package["predictor_node_ids"] != json!(["model:pls"])
    {
        return Err(unsupported());
    }
    let node = &nodes[0];
    let params = node["params"].as_object().ok_or_else(unsupported)?;
    if node["id"] != "model:pls"
        || node["kind"] != "model"
        || node["operator"] != "pls"
        || node["params"]["n_components"] != 1
        || package["effective_plan"]["node_plans"]["model:pls"]["controller_id"]
            != "controller:methods.pls"
    {
        return Err(unsupported());
    }
    let preprocessing = if params.len() == 1 && !params.contains_key("pipeline") {
        "raw"
    } else if params.len() == 2
        && node["params"]["pipeline"]
            == json!({
                "schema_version": 1, "pipeline_type": "n4m.snv_savgol_smooth.v1",
                "savgol_window": 5, "savgol_poly_degree": 2
            })
    {
        "snv_savgol"
    } else {
        return Err(unsupported());
    };
    let campaign = &template["campaign"];
    let selections = package["execution_bundle"]["selections"]
        .as_object()
        .ok_or_else(unsupported)?;
    let selection = &package["execution_bundle"]["selections"]["selection:rmse"];
    if selections.len() != 1
        || selection["policy_id"] != "selection:rmse"
        || selection["metric_name"] != "rmse"
        || selection["objective"] != "minimize"
        || selection["metric_level"] != "sample"
        || selection["evaluation_scope"] != "oof"
        || selection["requested_rank"] != Value::Null
        || selection["refit_slot_plan"] != Value::Null
        || selection["reduction_id"] != Value::Null
        || campaign["aggregation_policy"]
            != json!({"aggregation_level": "sample", "method": "mean", "weights": "none",
                "emit_parallel_metrics": true, "selection_metric_level": "sample",
                "store_raw_predictions": true, "store_aggregated_predictions": true})
    {
        return Err(unsupported());
    }
    let split = &campaign["split_invocation"];
    let folds = &split["fold_set"];
    let ids = folds["sample_ids"].as_array().ok_or_else(unsupported)?;
    if campaign["root_seed"] != 91
        || split["controller_id"] != Value::Null
        || split["params"] != json!({"kind": "precomputed"})
        || ids.len() < 4
        || folds["sample_groups"] != json!({})
        || campaign["leakage_policy"]
            != json!({"split_unit": "sample", "forbid_origin_cross_fold": true,
            "allow_observation_split_with_shared_target": false, "require_group_ids": false, "unsafe_flags": []})
    {
        return Err(unsupported());
    }
    let even: Vec<_> = ids.iter().step_by(2).cloned().collect();
    let odd: Vec<_> = ids.iter().skip(1).step_by(2).cloned().collect();
    if folds["id"] != "core:canonical:two-fold"
        || split["id"] != "core:canonical:two-fold"
        || folds["folds"]
            != json!([
            {"fold_id": "core.fold.0", "train_sample_ids": odd, "validation_sample_ids": even, "metadata": {}},
            {"fold_id": "core.fold.1", "train_sample_ids": even, "validation_sample_ids": odd, "metadata": {}}])
    {
        return Err(unsupported());
    }
    let generation = &campaign["generation"];
    let dimensions = generation["dimensions"]
        .as_array()
        .ok_or_else(unsupported)?;
    if generation["strategy"] != "cartesian"
        || dimensions.len() != 1
        || dimensions[0]["name"] != "pls_components"
    {
        return Err(unsupported());
    }
    let choices = dimensions[0]["choices"]
        .as_array()
        .ok_or_else(unsupported)?;
    if !(2..=32).contains(&choices.len()) || generation["max_variants"] != json!(choices.len()) {
        return Err(unsupported());
    }
    let mut components = Vec::new();
    let mut seen = std::collections::BTreeSet::new();
    for choice in choices {
        let count = choice["value"].as_u64().ok_or_else(unsupported)?;
        if count == 0
            || count > i32::MAX as u64
            || !seen.insert(count)
            || choice["active_subsequence"] != Value::Null
            || choice["param_overrides"]
                != json!([{"node_id": "model:pls", "params": {"n_components": count}}])
        {
            return Err(unsupported());
        }
        components.push(count);
    }
    let bindings = campaign["data_bindings"]
        .as_object()
        .ok_or_else(unsupported)?;
    let source_bindings = bindings
        .get("model:pls")
        .and_then(Value::as_array)
        .ok_or_else(unsupported)?;
    if bindings.len() != 1 || source_bindings.len() != 1 {
        return Err(unsupported());
    }
    if source_bindings[0]["node_id"] != "model:pls" || source_bindings[0]["input_name"] != "x" {
        return Err(unsupported());
    }
    let sources = source_bindings[0]["source_ids"]
        .as_array()
        .ok_or_else(unsupported)?;
    if sources.len() != 1 || sources[0].as_str().is_none_or(str::is_empty) {
        return Err(unsupported());
    }
    let outputs = package["output_bindings"]
        .as_array()
        .ok_or_else(unsupported)?;
    if outputs.len() != 1
        || outputs[0]["node_id"] != "model:pls"
        || outputs[0]["port_name"] != "oof"
        || outputs[0]["target_names"]
            .as_array()
            .is_none_or(|names| names.len() != 1)
        || outputs[0]["prediction_kind"] != "regression_point"
        || outputs[0]["prediction_source"] != "final_refit"
        || outputs[0]["refit_strategy"] != "refit_one"
        || outputs[0]["prediction_level"] != "sample"
        || outputs[0]["unit_level"] != "physical_sample"
        || outputs[0]["output_order"] != "target_order"
        || outputs[0]["target_space"] != "raw"
    {
        return Err(unsupported());
    }
    Ok(json!({"source_id": sources[0], "components": components, "preprocessing": preprocessing}))
}
