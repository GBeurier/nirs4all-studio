//! Admission for the declared Python CPU Torch topology; computation stays external.
use crate::{DagMlError, ExecutionPlan, HostHpoSearchRequest, NodeKind, Result};
use serde::Deserialize;
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};

pub(crate) const TORCH_ESTIMATOR: &str =
    "nirs4all.pipeline.dagml.torch_estimator.DagMLTorchEstimator";
pub(crate) const TORCH_FACTORY: &str = "nirs4all.operators.models.pytorch.mlp.structural_mlp";
const RIDGE: &str = "sklearn.linear_model._ridge.Ridge";
const MATRIX_LIMIT: u64 = 16_777_216;

#[derive(Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct TorchProfile {
    schema_version: u32,
    profile: String,
    source_order: Vec<String>,
    source_widths: BTreeMap<String, u64>,
    seed: u64,
    cpu_threads: u32,
    gpu_devices: Vec<String>,
    training_policy: TrainingPolicy,
    target_names: Vec<String>,
}

#[derive(Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct TrainingPolicy {
    validation: String,
    shuffle: bool,
    early_stopping: bool,
}

fn refuse<T>(message: &str) -> Result<T> {
    Err(DagMlError::RuntimeValidation(format!(
        "Python Torch topology: {message}"
    )))
}

fn operator_class(value: &Value) -> Option<&str> {
    value.as_str().or_else(|| {
        value
            .as_object()
            .filter(|object| object.len() == 1)?
            .get("class")?
            .as_str()
    })
}

pub(crate) fn has_torch_profile(plan: &ExecutionPlan) -> bool {
    plan.graph_plan
        .graph
        .metadata
        .contains_key("python_torch_profile")
        || plan.node_plans.values().any(|node| {
            node.params.get("factory_path").and_then(Value::as_str) == Some(TORCH_FACTORY)
        })
}

fn profile(plan: &ExecutionPlan) -> Result<Option<TorchProfile>> {
    if !has_torch_profile(plan) {
        return Ok(None);
    }
    let graph = &plan.graph_plan.graph;
    let Some(value) = graph.metadata.get("python_torch_profile") else {
        return refuse("structural_mlp requires its signed CPU profile");
    };
    let declaration: TorchProfile = serde_json::from_value(value.clone())?;
    let names = declaration.source_order.iter().collect::<BTreeSet<_>>();
    if declaration.schema_version != 1
        || declaration.profile != "cpu_serial_regression_v1"
        || names.len() != 4
        || declaration.source_order.len() != 4
        || declaration
            .source_order
            .iter()
            .any(|name| name.trim().is_empty())
        || names != declaration.source_widths.keys().collect()
        || declaration
            .source_widths
            .values()
            .any(|width| *width == 0 || *width > MATRIX_LIMIT)
        || declaration.cpu_threads != 1
        || !declaration.gpu_devices.is_empty()
        || declaration.training_policy.validation != "none"
        || !declaration.training_policy.shuffle
        || declaration.training_policy.early_stopping
        || declaration.target_names.len() != 1
        || declaration
            .target_names
            .iter()
            .any(|name| name.trim().is_empty())
        || plan.campaign.root_seed != Some(declaration.seed)
    {
        return refuse("exact four-source, seeded, serial CPU declaration required");
    }
    let schemas = graph
        .metadata
        .get("source_schemas")
        .and_then(Value::as_object)
        .ok_or_else(|| DagMlError::RuntimeValidation("Torch source schemas missing".into()))?;
    if schemas.keys().collect::<BTreeSet<_>>() != names {
        return refuse("source schema inventory differs from signed source order");
    }
    for (name, width) in &declaration.source_widths {
        let schema = &schemas[name];
        if schema.as_object().is_none_or(|schema| schema.len() != 4)
            || schema["input_shape"] != serde_json::json!([width])
            || !matches!(schema["dtype"].as_str(), Some("float32" | "float64"))
            || schema["representation_id"]
                .as_str()
                .is_none_or(str::is_empty)
            || schema["identity"].as_str().is_none_or(str::is_empty)
        {
            return refuse("closed dense source schema required");
        }
    }
    Ok(Some(declaration))
}

fn bounded_integer(params: &BTreeMap<String, Value>, name: &str, max: u64) -> Result<u64> {
    params
        .get(name)
        .and_then(Value::as_u64)
        .filter(|value| *value > 0 && *value <= max)
        .ok_or_else(|| {
            DagMlError::RuntimeValidation(format!(
                "Torch {name} must be a positive integer <= {max}"
            ))
        })
}

fn bounded_real(value: &Value, low: f64, high: f64) -> Result<()> {
    if value
        .as_f64()
        .is_none_or(|value| !value.is_finite() || value < low || value > high)
    {
        return refuse("numeric parameter outside its closed finite domain");
    }
    Ok(())
}

fn check_product(values: &[u64], limit: u64, label: &str) -> Result<()> {
    let mut product = 1;
    for value in values {
        if *value == 0 || product > limit / value {
            return refuse(label);
        }
        product *= value;
    }
    Ok(())
}

fn validate_raw(params: &BTreeMap<String, Value>, rows: u64, width: u64) -> Result<()> {
    let keys = [
        "factory_path",
        "template_blob",
        "factory_params",
        "force_layout",
        "task_type",
        "num_classes",
        "epochs",
        "batch_size",
        "patience",
        "optimizer",
        "lr",
        "learning_rate",
        "loss",
        "device",
    ];
    if params.keys().map(String::as_str).collect::<BTreeSet<_>>() != keys.into_iter().collect()
        || params["factory_path"] != TORCH_FACTORY
        || !params["template_blob"].is_null()
        || params["force_layout"] != "2d"
        || params["task_type"] != "regression"
        || !params["num_classes"].is_null()
        || params["optimizer"] != "Adam"
        || params["loss"] != "MSELoss"
        || params["device"] != "cpu"
        || !params["learning_rate"].is_null()
    {
        return refuse("closed real structural_mlp CPU regression parameters required");
    }
    let factory = params["factory_params"]
        .as_object()
        .filter(|params| params.len() == 1)
        .ok_or_else(|| {
            DagMlError::RuntimeValidation(
                "Torch factory parameters must contain hidden_units only".into(),
            )
        })?;
    let hidden = factory
        .get("hidden_units")
        .and_then(Value::as_u64)
        .filter(|value| (1..=128).contains(value))
        .ok_or_else(|| DagMlError::RuntimeValidation("Torch hidden_units outside 1..128".into()))?;
    let epochs = bounded_integer(params, "epochs", 100)?;
    bounded_integer(params, "batch_size", 1024)?;
    bounded_integer(params, "patience", 100)?;
    bounded_real(&params["lr"], 1e-6, 0.1)?;
    let parameters = width
        .checked_add(2)
        .and_then(|width| width.checked_mul(hidden))
        .and_then(|value| value.checked_add(1))
        .ok_or_else(|| DagMlError::RuntimeValidation("Torch parameter count overflow".into()))?;
    if parameters > 1_000_000 {
        return refuse("model exceeds 1000000 parameters");
    }
    check_product(
        &[rows, width],
        MATRIX_LIMIT,
        "dense input exceeds 16777216 cells",
    )?;
    check_product(
        &[rows, epochs, hidden, width + 1],
        100_000_000,
        "declared training work exceeds 100000000 units",
    )
}

/// Called by ordinary plan validation and consequently by fixed run, package
/// reload, catalogue preparation and candidate validation before callbacks.
pub(crate) fn validate_torch_plan(plan: &ExecutionPlan) -> Result<()> {
    let Some(profile) = profile(plan)? else {
        return Ok(());
    };
    let graph = &plan.graph_plan.graph;
    let folds = plan.fold_set.as_ref().ok_or_else(|| {
        DagMlError::RuntimeValidation("Torch topology requires signed grouped folds".into())
    })?;
    if folds.folds.len() != 3
        || folds.sample_ids.is_empty()
        || folds.sample_groups.keys().collect::<BTreeSet<_>>() != folds.sample_ids.iter().collect()
    {
        return refuse("three native grouped outer folds with complete Train groups required");
    }
    for fold in &folds.folds {
        let train = fold
            .train_sample_ids
            .iter()
            .map(|id| &folds.sample_groups[id])
            .collect::<BTreeSet<_>>();
        if fold
            .validation_sample_ids
            .iter()
            .any(|id| train.contains(&folds.sample_groups[id]))
        {
            return refuse("outer training and Validation groups overlap");
        }
    }
    if graph.nodes.iter().any(|node| {
        !matches!(
            node.kind,
            NodeKind::Model | NodeKind::Split | NodeKind::Fork | NodeKind::Generator
        )
    }) {
        return refuse(
            "profile does not admit preprocessing, augmentation or alternate model scopes",
        );
    }
    let rows = folds.sample_ids.len() as u64;
    for width in profile.source_widths.values() {
        check_product(
            &[rows, *width],
            MATRIX_LIMIT,
            "raw source buffer exceeds 16777216 cells",
        )?;
    }
    let mut raw = BTreeMap::new();
    let mut metas = Vec::new();
    for node in graph
        .nodes
        .iter()
        .filter(|node| node.kind == NodeKind::Model)
    {
        let node_plan = &plan.node_plans[&node.id];
        if node.metadata.contains_key("nirs4all_finetune_params")
            || node.metadata.contains_key("nirs4all_train_params")
            || node.metadata.contains_key("nirs4all_refit_params")
        {
            return refuse(
                "model-local HPO and unsigned training control overrides are unsupported",
            );
        }
        match node.operator.as_ref().and_then(operator_class) {
            Some(TORCH_ESTIMATOR) => {
                if node_plan.controller_id.as_str() != "controller:nirs4all.model" {
                    return refuse("raw model has a foreign owner");
                }
                let selection: Vec<String> = serde_json::from_value(
                    node.metadata
                        .get("source_selection")
                        .cloned()
                        .ok_or_else(|| {
                            DagMlError::RuntimeValidation("Torch source selection missing".into())
                        })?,
                )?;
                if (!(1..=4).contains(&selection.len()))
                    || selection.iter().collect::<BTreeSet<_>>().len() != selection.len()
                    || selection
                        .iter()
                        .any(|name| !profile.source_widths.contains_key(name))
                {
                    return refuse("early requires an ordered named source subset; late branches require one named source");
                }
                let expected_index = if selection.len() == 1 {
                    profile
                        .source_order
                        .iter()
                        .position(|name| name == &selection[0])
                        .map(|index| serde_json::json!(index))
                } else {
                    None
                };
                if node.metadata.get("source_index") != expected_index.as_ref() {
                    return refuse("source index differs from signed source selection");
                }
                if node_plan.data_bindings.len() != 1
                    || node_plan.data_bindings[0].source_ids.len() != 4
                {
                    return refuse("each raw model must attest the complete four-source binding");
                }
                let width = selection.iter().try_fold(0u64, |sum, name| {
                    sum.checked_add(profile.source_widths[name]).ok_or_else(|| {
                        DagMlError::RuntimeValidation("Torch selected width overflow".into())
                    })
                })?;
                validate_raw(&node_plan.params, rows, width)?;
                for variant in &plan.variants {
                    validate_raw(
                        &crate::VariantExecutionSpec::from_plan(variant)
                            .effective_params_for_node(&node.id, &node_plan.params)?,
                        rows,
                        width,
                    )?;
                }
                raw.insert(node.id.clone(), selection);
            }
            Some(RIDGE) => {
                if node_plan.controller_id.as_str() != "controller:nirs4all.meta_model"
                    || !node_plan.data_bindings.is_empty()
                    || node
                        .metadata
                        .get("stacking_oof_execution")
                        .and_then(Value::as_str)
                        != Some("nested_oof_v1")
                    || node
                        .metadata
                        .get("stacking_refit_oof")
                        .and_then(Value::as_str)
                        != Some("partitioned_inner_v1")
                {
                    return refuse("meta Ridge must consume native nested OOF only");
                }
                for params in std::iter::once(node_plan.params.clone()).chain(
                    plan.variants
                        .iter()
                        .map(|variant| {
                            crate::VariantExecutionSpec::from_plan(variant)
                                .effective_params_for_node(&node.id, &node_plan.params)
                        })
                        .collect::<Result<Vec<_>>>()?,
                ) {
                    if params.keys().map(String::as_str).collect::<BTreeSet<_>>()
                        != [
                            "alpha",
                            "copy_X",
                            "fit_intercept",
                            "max_iter",
                            "positive",
                            "random_state",
                            "solver",
                            "tol",
                        ]
                        .into_iter()
                        .collect()
                        || params["copy_X"] != true
                        || params["fit_intercept"] != true
                        || params["positive"] != false
                        || !params["max_iter"].is_null()
                        || !params["random_state"].is_null()
                        || params["solver"] != "svd"
                    {
                        return refuse("closed deterministic Ridge meta parameters required");
                    }
                    bounded_real(&params["alpha"], 0.0, 1e6)?;
                    bounded_real(&params["tol"], 1e-12, 1.0)?;
                }
                metas.push(node.id.clone());
            }
            _ => {
                return refuse(
                    "profile admits only real Torch raw models and Ridge OOF meta models",
                )
            }
        }
    }
    if raw.is_empty() {
        return refuse("profile contains no real Torch model");
    }
    for meta in metas {
        let incoming = graph
            .edges
            .iter()
            .filter(|edge| edge.target.node_id == meta)
            .collect::<Vec<_>>();
        if !(2..=4).contains(&incoming.len())
            || incoming.iter().any(|edge| {
                !edge.contract.requires_oof
                    || edge.contract.kind != crate::PortKind::Prediction
                    || raw
                        .get(&edge.source.node_id)
                        .is_none_or(|selection| selection.len() != 1)
            })
        {
            return refuse("meta must receive two to four signed raw-branch Validation OOF inputs");
        }
        if incoming
            .iter()
            .map(|edge| &raw[&edge.source.node_id][0])
            .collect::<BTreeSet<_>>()
            .len()
            != incoming.len()
        {
            return refuse("late branches select distinct named sources");
        }
    }
    // This constructs every actual native outer/inner/full-refit scope, and
    // refuses deficient group partitions before fitting. No host fold is used.
    for nested in crate::runtime::nested_stacking_campaign_plans(plan)? {
        if !matches!(
            nested.inner_cv,
            crate::fold::NestedCvSpec::GroupKFold(crate::fold::GroupKFoldSpec { n_splits: 2 })
        ) {
            return refuse("two grouped inner folds required");
        }
        if nested.refit_fold_set.is_none() {
            return refuse("independent full-train REFIT OOF required");
        }
    }
    Ok(())
}

fn domain_values(value: &Value) -> Result<Vec<&Value>> {
    if let Some(values) = value.as_array() {
        if values.len() == 2 && values[0] == "categorical" {
            return domain_values(&values[1]);
        }
        if values.len() == 3
            && values[0].as_str().is_some_and(|kind| {
                matches!(
                    kind,
                    "float" | "float_log" | "log_float" | "int" | "int_log" | "log_int"
                )
            })
        {
            if values[1]
                .as_f64()
                .zip(values[2].as_f64())
                .is_none_or(|(low, high)| low > high)
            {
                return refuse("reversed numeric search domain");
            }
            return Ok(vec![&values[1], &values[2]]);
        }
        if values.is_empty() {
            return refuse("empty numeric search domain");
        }
        return Ok(values.iter().collect());
    }
    if let Some(object) = value.as_object() {
        if object.get("type").and_then(Value::as_str) == Some("categorical") {
            return domain_values(
                object
                    .get("choices")
                    .or_else(|| object.get("values"))
                    .or_else(|| object.get("options"))
                    .ok_or_else(|| {
                        DagMlError::RuntimeValidation(
                            "Torch categorical domain missing choices".into(),
                        )
                    })?,
            );
        }
        let low = object
            .get("low")
            .or_else(|| object.get("min"))
            .ok_or_else(|| DagMlError::RuntimeValidation("Torch lower bound missing".into()))?;
        let high = object
            .get("high")
            .or_else(|| object.get("max"))
            .ok_or_else(|| DagMlError::RuntimeValidation("Torch upper bound missing".into()))?;
        if low
            .as_f64()
            .zip(high.as_f64())
            .is_none_or(|(low, high)| low > high)
        {
            return refuse("reversed numeric search domain");
        }
        return Ok(vec![low, high]);
    }
    refuse("bounded numeric search domain required")
}

pub(crate) fn validate_torch_search(
    plan: &ExecutionPlan,
    request: &HostHpoSearchRequest,
) -> Result<()> {
    if !has_torch_profile(plan) {
        return Ok(());
    }
    if request.progressive_pruning
        || request
            .optimizer_descriptor
            .get("n_jobs")
            .and_then(Value::as_u64)
            != Some(1)
        || request
            .optimizer_descriptor
            .get("sampler")
            .and_then(Value::as_str)
            != Some("random")
        || request
            .optimizer_descriptor
            .contains_key("parallel_execution")
        || request
            .optimizer_descriptor
            .contains_key("generated_view_mode")
        || request
            .optimizer_descriptor
            .get("pruner")
            .is_some_and(|value| !value.is_null() && value != "none")
        || !matches!(
            request.metric,
            crate::RegressionMetricKind::Mse
                | crate::RegressionMetricKind::Rmse
                | crate::RegressionMetricKind::Mae
                | crate::RegressionMetricKind::R2
        )
    {
        return refuse("serial regression search without pruning or generated views required");
    }
    let catalogue = request
        .structural_catalogue
        .as_ref()
        .filter(|catalogue| catalogue.topology_contract.is_some())
        .ok_or_else(|| {
            DagMlError::RuntimeValidation(
                "Torch search requires native topology catalogue V2".into(),
            )
        })?;
    let space = request
        .optimizer_descriptor
        .get("space")
        .and_then(Value::as_object)
        .ok_or_else(|| {
            DagMlError::RuntimeValidation("Torch signed conditional search space missing".into())
        })?;
    let mut axes = BTreeSet::new();
    for entry in &catalogue.entries {
        for (path, binding) in &entry.parameter_bindings {
            let node = entry
                .graph
                .nodes
                .iter()
                .find(|node| node.id == binding.node_id)
                .ok_or_else(|| {
                    DagMlError::RuntimeValidation(
                        "Torch conditional binding has foreign node".into(),
                    )
                })?;
            let raw = node.operator.as_ref().and_then(operator_class) == Some(TORCH_ESTIMATOR);
            if binding.param_path != if raw { "lr" } else { "alpha" } {
                return refuse("only raw lr and meta alpha axes are supported");
            }
            let declaration = space.get(path).ok_or_else(|| {
                DagMlError::RuntimeValidation("Torch axis lacks signed domain".into())
            })?;
            for value in domain_values(declaration)? {
                bounded_real(
                    value,
                    if raw { 1e-6 } else { 0.0 },
                    if raw { 0.1 } else { 1e6 },
                )?;
            }
            axes.insert(path.as_str());
        }
    }
    if axes != space.keys().map(String::as_str).collect() {
        return refuse("search space contains foreign or unused axes");
    }
    if let Some(force) = request
        .optimizer_descriptor
        .get("force_params")
        .filter(|value| !value.is_null())
    {
        let force = force.as_object().ok_or_else(|| {
            DagMlError::RuntimeValidation("Torch force_params must be an object".into())
        })?;
        for (path, value) in force {
            if !axes.contains(path.as_str()) {
                return refuse("forced parameter references an unknown axis");
            }
            let raw = catalogue
                .entries
                .iter()
                .flat_map(|entry| entry.parameter_bindings.iter())
                .any(|(axis, binding)| axis == path && binding.param_path == "lr");
            bounded_real(
                value,
                if raw { 1e-6 } else { 0.0 },
                if raw { 0.1 } else { 1e6 },
            )?;
        }
    }
    Ok(())
}

pub(crate) fn validate_torch_outputs(
    plan: &ExecutionPlan,
    request: &crate::TrainingRequest,
) -> Result<()> {
    let Some(profile) = profile(plan)? else {
        return Ok(());
    };
    if request
        .options
        .outputs
        .iter()
        .any(|output| output.target_names != profile.target_names)
    {
        return refuse("requested outputs differ from the signed scalar target name");
    }
    Ok(())
}

pub(crate) fn torch_resources(plan: &ExecutionPlan) -> Option<crate::TrainingResourceLimits> {
    has_torch_profile(plan).then(|| crate::TrainingResourceLimits {
        cpu_threads: 1,
        memory_bytes: None,
        gpu_devices: Vec::new(),
        wall_time_ms: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn raw_params() -> BTreeMap<String, Value> {
        serde_json::from_value(json!({"factory_path":TORCH_FACTORY,"template_blob":null,
            "factory_params":{"hidden_units":8},"force_layout":"2d","task_type":"regression",
            "num_classes":null,"epochs":2,"batch_size":8,"patience":2,"optimizer":"Adam",
            "lr":0.001,"learning_rate":null,"loss":"MSELoss","device":"cpu"}))
        .unwrap()
    }

    #[test]
    fn real_torch_controls_are_closed_and_work_bounds_are_checked_without_fitting() {
        let baseline = raw_params();
        validate_raw(&baseline, 24, 16).unwrap();
        for (key, value) in [
            ("device", json!("cuda")),
            ("epochs", json!(101)),
            ("learning_rate", json!(0.2)),
            ("lr", json!(0.0)),
            ("optimizer", json!("SGD")),
            ("template_blob", json!("pickle")),
        ] {
            let mut forged = baseline.clone();
            forged.insert(key.into(), value);
            assert!(
                validate_raw(&forged, 24, 16).is_err(),
                "must reject unsigned {key} before owner callbacks"
            );
        }
        assert!(validate_raw(&baseline, u64::MAX, 16).is_err());
        assert!(validate_raw(&baseline, 24, u64::MAX).is_err());
        let mut oversized = baseline.clone();
        oversized.insert("factory_params".into(), json!({"hidden_units":128}));
        assert!(validate_raw(&oversized, 3072, 4096).is_err());
        assert!(check_product(&[u64::MAX, 2], 100_000_000, "overflow").is_err());
    }

    #[test]
    fn learning_rate_domains_and_forced_values_remain_finite_and_bounded() {
        let valid = json!(["float_log", 0.00001, 0.01]);
        for value in domain_values(&valid).unwrap() {
            bounded_real(value, 1e-6, 0.1).unwrap();
        }
        assert!(domain_values(&json!(["float", 0.1, 0.01])).is_err());
        assert!(domain_values(&json!([])).is_err());
        assert!(bounded_real(&json!(0.2), 1e-6, 0.1).is_err());
        assert!(bounded_real(&json!(true), 1e-6, 0.1).is_err());
    }
}
