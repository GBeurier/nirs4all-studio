//! Free helpers backing the nirs4all-compat lowering: field extraction,
//! operator recognition, merge-mode inference, augmentation shape, generator
//! cartesian/range/log-range/grid/zip/sample expansion.

use super::*;

pub(crate) fn optional_root_field<T>(
    root: Option<&serde_json::Map<String, serde_json::Value>>,
    key: &str,
) -> Result<Option<T>>
where
    T: DeserializeOwned,
{
    match root.and_then(|object| object.get(key)) {
        Some(value) => Ok(Some(deserialize_value(value.clone(), key)?)),
        None => Ok(None),
    }
}
pub(crate) fn optional_object_field<T>(
    object: &serde_json::Map<String, serde_json::Value>,
    key: &str,
) -> Result<Option<T>>
where
    T: DeserializeOwned,
{
    match object.get(key) {
        Some(value) => Ok(Some(deserialize_value(value.clone(), key)?)),
        None => Ok(None),
    }
}
pub(crate) fn optional_object_field_from_option<T>(
    object: Option<&serde_json::Map<String, serde_json::Value>>,
    key: &str,
) -> Result<Option<T>>
where
    T: DeserializeOwned,
{
    match object.and_then(|object| object.get(key)) {
        Some(value) => Ok(Some(deserialize_value(value.clone(), key)?)),
        None => Ok(None),
    }
}
pub(crate) fn compat_merge_field<T>(
    object: &serde_json::Map<String, serde_json::Value>,
    key: &str,
) -> Result<Option<T>>
where
    T: DeserializeOwned,
{
    let value = object.get(key).or_else(|| {
        object
            .get("merge")
            .and_then(serde_json::Value::as_object)
            .and_then(|merge| merge.get(key))
    });
    match value {
        Some(value) => Ok(Some(deserialize_value(value.clone(), key)?)),
        None => Ok(None),
    }
}
pub(crate) fn deserialize_value<T>(value: serde_json::Value, label: &str) -> Result<T>
where
    T: DeserializeOwned,
{
    serde_json::from_value(value)
        .map_err(|error| DagMlError::GraphValidation(format!("failed to parse {label}: {error}")))
}
pub(crate) fn explicit_or_generated_node_id<F>(
    object: &serde_json::Map<String, serde_json::Value>,
    key: &str,
    generated: F,
) -> Result<NodeId>
where
    F: FnOnce() -> Result<NodeId>,
{
    match object.get(key).and_then(serde_json::Value::as_str) {
        Some(id) => NodeId::new(id),
        None => generated(),
    }
}
pub(crate) fn first_object_value<'a>(
    object: &'a serde_json::Map<String, serde_json::Value>,
    keys: &[&str],
) -> Option<&'a serde_json::Value> {
    keys.iter().find_map(|key| object.get(*key))
}
pub(crate) fn is_comment_only_object(object: &serde_json::Map<String, serde_json::Value>) -> bool {
    !object.is_empty()
        && object
            .keys()
            .all(|key| matches!(key.as_str(), "_comment" | "comment" | "description"))
}
pub(crate) fn value_can_receive_generation_attachment(value: &serde_json::Value) -> bool {
    let Some(object) = value.as_object() else {
        return false;
    };
    object.contains_key("model")
        || object.contains_key("tuner")
        || object.contains_key("finetune")
        || first_object_value(object, &["preprocessing", "processing", "transform"]).is_some()
        || compat_plain_operator_ref(value).is_some()
}
pub(crate) fn object_value_as_map(
    value: Option<&serde_json::Value>,
) -> Option<BTreeMap<String, serde_json::Value>> {
    value.and_then(|value| {
        value.as_object().map(|object| {
            object
                .iter()
                .map(|(key, value)| (key.clone(), value.clone()))
                .collect()
        })
    })
}
pub(crate) fn is_minimal_compat_operator_alias(
    object: Option<&serde_json::Map<String, serde_json::Value>>,
    operator: &serde_json::Value,
) -> bool {
    match object {
        None => compat_plain_operator_ref(operator).is_some(),
        Some(object) => {
            ["class", "function", "ref", "type"]
                .iter()
                .any(|key| object.contains_key(*key))
                && compat_plain_operator_ref(operator).is_some()
        }
    }
}
pub(crate) fn annotate_named_steps(steps: &mut [PipelineDslStep], name: &str) {
    for step in steps {
        annotate_named_step(step, name);
    }
}
pub(crate) fn annotate_named_step(step: &mut PipelineDslStep, name: &str) {
    let value = serde_json::Value::String(name.to_string());
    match step {
        PipelineDslStep::Transform(step)
        | PipelineDslStep::YTransform(step)
        | PipelineDslStep::Tag(step)
        | PipelineDslStep::Exclude(step)
        | PipelineDslStep::Filter(step)
        | PipelineDslStep::SampleFilter(step)
        | PipelineDslStep::Augmentation(step)
        | PipelineDslStep::FeatureAugmentation(step)
        | PipelineDslStep::SampleAugmentation(step)
        | PipelineDslStep::DataGeneration(step)
        | PipelineDslStep::Model(step)
        | PipelineDslStep::Tuner(step)
        | PipelineDslStep::Chart(step) => {
            step.metadata.insert("dsl_name".to_string(), value);
        }
        PipelineDslStep::ConcatTransform(step) => {
            step.metadata.insert("dsl_name".to_string(), value);
        }
        PipelineDslStep::Branch(step) => {
            step.metadata.insert("dsl_name".to_string(), value);
        }
        PipelineDslStep::Generator(step) => {
            step.metadata.insert("dsl_name".to_string(), value);
        }
        PipelineDslStep::Sequential(step) => {
            step.metadata.insert("dsl_name".to_string(), value);
        }
        PipelineDslStep::Merge(step) => {
            step.metadata.insert("dsl_name".to_string(), value);
        }
        PipelineDslStep::MergeModel(step) => {
            step.metadata.insert("dsl_name".to_string(), value);
        }
    }
}
pub(crate) fn compat_plain_operator_ref(value: &serde_json::Value) -> Option<&str> {
    match value {
        serde_json::Value::String(reference) => Some(reference),
        serde_json::Value::Object(object) => ["class", "function", "ref", "type"]
            .into_iter()
            .find_map(|key| object.get(key).and_then(serde_json::Value::as_str)),
        _ => None,
    }
}
pub(crate) fn compat_plain_operator_value(value: &serde_json::Value) -> Result<serde_json::Value> {
    match value {
        serde_json::Value::String(_) => Ok(value.clone()),
        serde_json::Value::Object(object) => {
            let mut operator = serde_json::Map::new();
            for key in ["class", "function", "ref", "type"] {
                if let Some(value) = object.get(key) {
                    operator.insert(key.to_string(), value.clone());
                }
            }
            if operator.is_empty() {
                return Err(DagMlError::GraphValidation(
                    "nirs4all-compatible plain operator object must contain class, function, ref or type"
                        .to_string(),
                ));
            }
            Ok(serde_json::Value::Object(operator))
        }
        _ => Err(DagMlError::GraphValidation(
            "nirs4all-compatible plain operator must be a string or object".to_string(),
        )),
    }
}
pub(crate) fn compat_plain_operator_kind(value: &serde_json::Value) -> CompatPlainOperatorKind {
    let Some(reference) = compat_plain_operator_ref(value) else {
        return CompatPlainOperatorKind::Transform;
    };
    let lower = reference.to_ascii_lowercase();
    if compat_is_chart_alias(&lower) {
        CompatPlainOperatorKind::Chart
    } else if compat_is_tuner_alias(&lower) {
        CompatPlainOperatorKind::Tuner
    } else if compat_is_splitter_alias(&lower) {
        CompatPlainOperatorKind::Split
    } else if compat_is_model_alias(&lower) {
        CompatPlainOperatorKind::Model
    } else {
        CompatPlainOperatorKind::Transform
    }
}
pub(crate) fn compat_is_chart_alias(lower: &str) -> bool {
    lower.starts_with("chart_")
        || lower == "chart"
        || lower.contains(".charts.")
        || lower.contains(".visualization.")
}
pub(crate) fn compat_is_tuner_alias(lower: &str) -> bool {
    let short = lower.rsplit(['.', ':']).next().unwrap_or(lower);
    lower.contains(".tuners.")
        || lower.contains(".tuning.")
        || lower.contains("operators.tuners")
        || lower.contains("optuna")
        || lower.contains("ray.tune")
        || lower.contains("hyperopt")
        || short.ends_with("tuner")
        || short.ends_with("searchcv")
        || matches!(
            short,
            "gridsearchcv"
                | "randomizedsearchcv"
                | "halvinggridsearchcv"
                | "halvingrandomsearchcv"
                | "bayesiantuner"
                | "optunatuner"
        )
}
pub(crate) fn compat_is_splitter_alias(lower: &str) -> bool {
    let short = lower.rsplit(['.', ':']).next().unwrap_or(lower);
    lower.contains("model_selection")
        || lower.contains(".splitters.")
        || lower.contains("operators.splitters")
        || short.contains("splitter")
        || short.ends_with("kfold")
        || short.ends_with("gfold")
        || short.ends_with("fold")
        || short.ends_with("split")
        || matches!(
            short,
            "leaveoneout" | "leavepout" | "predefinedsplit" | "timeseriessplit"
        )
}
pub(crate) fn compat_is_model_alias(lower: &str) -> bool {
    let short = lower.rsplit(['.', ':']).next().unwrap_or(lower);
    lower.contains(".models.")
        || lower.contains("operators.models")
        || lower.contains("linear_model")
        || lower.contains("cross_decomposition")
        || lower.contains(".ensemble.")
        || lower.contains(".svm.")
        || lower.contains(".tree.")
        || lower.contains(".neighbors.")
        || lower.contains(".neural_network.")
        || lower.contains("xgboost")
        || lower.contains("lightgbm")
        || lower.contains("catboost")
        || short.ends_with("regressor")
        || short.ends_with("classifier")
        || short.ends_with("regression")
        || matches!(
            short,
            "ridge"
                | "lasso"
                | "elasticnet"
                | "svr"
                | "svc"
                | "linearsvr"
                | "linearsvc"
                | "pls"
                | "plsr"
                | "plsregression"
                | "metamodel"
        )
}
pub(crate) fn compat_node_prefix(keyword: &str) -> &'static str {
    match keyword {
        "model" => "model",
        "tuner" | "finetune" => "tuner",
        "y_processing" | "y_transform" => "target",
        "tag" => "tag",
        "exclude" | "filter" | "sample_filter" => "filter",
        "sample_augmentation" | "feature_augmentation" | "augmentation" => "augment",
        "data_generation" | "generation" => "generator",
        "chart" => "chart",
        _ => "transform",
    }
}
pub(crate) fn compat_param_aliases(keyword: &str) -> &'static [&'static str] {
    match keyword {
        "model" => &["model_params"],
        "tuner" | "finetune" => &["tuner_params", "finetune_params"],
        "preprocessing" | "processing" | "transform" => &[
            "preprocessing_params",
            "processing_params",
            "transform_params",
        ],
        "sample_augmentation" | "feature_augmentation" | "augmentation" => &["augmentation_params"],
        "data_generation" | "generation" => &["generation_params"],
        _ => &[],
    }
}
pub(crate) fn compat_wrapper_param_keys(keyword: &str) -> &'static [&'static str] {
    match keyword {
        "tag" | "exclude" | "filter" | "sample_filter" => &["mode", "report", "tag_name"],
        "sample_augmentation" => &[
            "count",
            "selection",
            "random_state",
            "mode",
            "action",
            "report",
        ],
        "feature_augmentation" | "augmentation" => &[
            "size",
            "count",
            "selection",
            "random_state",
            "mode",
            "action",
            "report",
        ],
        "data_generation" | "generation" => &["size", "count", "random_state", "mode", "report"],
        "tuner" | "finetune" => &["n_trials", "metric", "direction", "timeout", "random_state"],
        _ => &[],
    }
}
pub(crate) fn split_invocation_chain_entry(split: &SplitInvocation) -> Result<serde_json::Value> {
    let mut object = serde_json::Map::new();
    object.insert(
        "id".to_string(),
        serde_json::Value::String(split.id.clone()),
    );
    if let Some(controller_id) = &split.controller_id {
        object.insert(
            "controller_id".to_string(),
            serde_json::to_value(controller_id).map_err(|error| {
                DagMlError::GraphValidation(format!(
                    "failed to serialize split controller_id for compat split chain: {error}"
                ))
            })?,
        );
    }
    if split.leakage_policy != LeakageUnitPolicy::default() {
        object.insert(
            "leakage_policy".to_string(),
            serde_json::to_value(&split.leakage_policy).map_err(|error| {
                DagMlError::GraphValidation(format!(
                    "failed to serialize split leakage_policy for compat split chain: {error}"
                ))
            })?,
        );
    }
    if !split.params.is_empty() {
        object.insert(
            "params".to_string(),
            serde_json::to_value(&split.params).map_err(|error| {
                DagMlError::GraphValidation(format!(
                    "failed to serialize split params for compat split chain: {error}"
                ))
            })?,
        );
    }
    if let Some(fold_set) = &split.fold_set {
        object.insert(
            "fold_set".to_string(),
            serde_json::to_value(fold_set).map_err(|error| {
                DagMlError::GraphValidation(format!(
                    "failed to serialize split fold_set for compat split chain: {error}"
                ))
            })?,
        );
    }
    Ok(serde_json::Value::Object(object))
}
pub(crate) fn compat_augmentation_shape(
    kind: &str,
    object: &serde_json::Map<String, serde_json::Value>,
) -> Result<PipelineDslShapePlan> {
    if let Some(shape) = object.get("shape") {
        return deserialize_value(shape.clone(), "augmentation shape");
    }
    let mut sample_scope = crate::policy::AugmentationScope::None;
    let mut feature_scope = crate::policy::AugmentationScope::None;
    match kind {
        "sample" => sample_scope = crate::policy::AugmentationScope::TrainOnly,
        "feature" => feature_scope = crate::policy::AugmentationScope::TrainOnly,
        _ => {
            sample_scope = crate::policy::AugmentationScope::TrainOnly;
            feature_scope = crate::policy::AugmentationScope::TrainOnly;
        }
    }
    if let Some(apply_to) = object
        .get("policy")
        .and_then(serde_json::Value::as_object)
        .and_then(|policy| policy.get("apply_to"))
        .and_then(serde_json::Value::as_str)
    {
        match apply_to {
            "train_only" => {}
            "all" | "all_partitions" => {
                if sample_scope != crate::policy::AugmentationScope::None {
                    sample_scope = crate::policy::AugmentationScope::AllPartitions;
                }
                if feature_scope != crate::policy::AugmentationScope::None {
                    feature_scope = crate::policy::AugmentationScope::AllPartitions;
                }
            }
            "none" => {
                sample_scope = crate::policy::AugmentationScope::None;
                feature_scope = crate::policy::AugmentationScope::None;
            }
            other => {
                return Err(DagMlError::GraphValidation(format!(
                    "unsupported nirs4all augmentation policy apply_to `{other}`"
                )));
            }
        }
    }
    Ok(PipelineDslShapePlan {
        input_granularity: None,
        target_granularity: None,
        fit_rows: Some(FitBoundary::FoldTrain),
        predict_rows: Some(FitBoundary::FoldValidation),
        feature_namespace: None,
        feature_schema_fingerprint: None,
        target_space: None,
        aggregation_policy: None,
        augmentation_policy: Some(AugmentationPolicy {
            sample_scope,
            feature_scope,
            require_origin_id: true,
            inherit_group: true,
            inherit_target: true,
            unsafe_flags: BTreeSet::new(),
        }),
        selection_policy: None,
    })
}
pub(crate) fn compat_merge_modes(
    object: &serde_json::Map<String, serde_json::Value>,
) -> Result<(String, bool, PipelineDslMergeOutput)> {
    let merge = object
        .get("merge")
        .ok_or_else(|| DagMlError::GraphValidation("merge step lacks `merge`".to_string()))?;
    let merge_object = merge.as_object();
    let mode = merge
        .as_str()
        .or_else(|| {
            merge_object
                .and_then(|object| object.get("mode").or_else(|| object.get("strategy")))
                .and_then(serde_json::Value::as_str)
        })
        .map(str::to_string)
        .unwrap_or_else(|| infer_compat_merge_mode(merge_object));
    validate_compat_merge_mode(&mode)?;
    let include_original_data = object
        .get("include_original_data")
        .or_else(|| object.get("include_original"))
        .or_else(|| {
            merge_object.and_then(|object| {
                object
                    .get("include_original_data")
                    .or_else(|| object.get("include_original"))
            })
        })
        .and_then(serde_json::Value::as_bool)
        .unwrap_or(matches!(
            mode.as_str(),
            "all" | "mixed" | "predictions_plus_original"
        ));
    let output_as = object
        .get("output_as")
        .or_else(|| merge_object.and_then(|object| object.get("output_as")))
        .and_then(serde_json::Value::as_str)
        .map(compat_merge_output_as)
        .transpose()?
        .unwrap_or_else(|| compat_merge_output_for_mode(&mode));
    Ok((mode, include_original_data, output_as))
}
pub(crate) fn infer_compat_merge_mode(
    merge_object: Option<&serde_json::Map<String, serde_json::Value>>,
) -> String {
    let Some(object) = merge_object else {
        return "predictions".to_string();
    };
    let has_predictions = object.contains_key("predictions") || object.contains_key("prediction");
    let has_features = object.contains_key("features") || object.contains_key("feature");
    let has_sources = object.contains_key("sources") || object.contains_key("source");
    match (has_predictions, has_features, has_sources) {
        (true, true, _) => "all",
        (true, false, _) => "predictions",
        (false, true, _) => "features",
        (false, false, true) => "sources",
        _ => "predictions",
    }
    .to_string()
}
pub(crate) fn compat_merge_output_for_mode(mode: &str) -> PipelineDslMergeOutput {
    match mode {
        "predictions" | "prediction" => PipelineDslMergeOutput::Predictions,
        "sources" | "source" => PipelineDslMergeOutput::Sources,
        _ => PipelineDslMergeOutput::Features,
    }
}
pub(crate) fn compat_merge_output_as(value: &str) -> Result<PipelineDslMergeOutput> {
    match value {
        "features" | "feature" => Ok(PipelineDslMergeOutput::Features),
        "predictions" | "prediction" => Ok(PipelineDslMergeOutput::Predictions),
        "sources" | "source" => Ok(PipelineDslMergeOutput::Sources),
        other => Err(DagMlError::GraphValidation(format!(
            "unsupported nirs4all merge output_as `{other}`"
        ))),
    }
}
pub(crate) fn validate_compat_merge_mode(mode: &str) -> Result<()> {
    match mode {
        "predictions"
        | "prediction"
        | "sources"
        | "source"
        | "features"
        | "feature"
        | "concat"
        | "all"
        | "mixed"
        | "predictions_plus_original" => {}
        other => {
            return Err(DagMlError::GraphValidation(format!(
                "unsupported nirs4all merge mode `{other}`"
            )));
        }
    }
    Ok(())
}
pub(crate) fn compat_generator_metadata(
    object: &serde_json::Map<String, serde_json::Value>,
    key: &str,
) -> Result<BTreeMap<String, serde_json::Value>> {
    let mut metadata: BTreeMap<String, serde_json::Value> =
        optional_object_field(object, "metadata")?.unwrap_or_default();
    metadata.insert(
        "dsl_compat_generator".to_string(),
        serde_json::Value::String(key.to_string()),
    );
    Ok(metadata)
}
/// Lower the nirs4all operator-content constraint keywords (`_mutex_` / `_requires_` / `_exclude_`)
/// off a generator node into a [`PipelineDslGeneratorConstraints`]. Returns `None` when none are
/// present so a constraint-free generator stays byte-identical. The refs are operator-content labels
/// (operator-class / branch ids), matched against the generated sequences' selected branch ids at
/// sequence-build (`expand_*_generator_sequences`).
pub(crate) fn compat_generator_constraints(
    object: &serde_json::Map<String, serde_json::Value>,
    path: &str,
) -> Result<Option<PipelineDslGeneratorConstraints>> {
    let mutex: Vec<Vec<String>> = optional_object_field(object, "_mutex_")?.unwrap_or_default();
    let requires: Vec<[String; 2]> =
        optional_object_field(object, "_requires_")?.unwrap_or_default();
    let exclude: Vec<[String; 2]> = optional_object_field(object, "_exclude_")?.unwrap_or_default();
    let constraints = PipelineDslGeneratorConstraints {
        mutex,
        requires,
        exclude,
    };
    if constraints.is_empty() {
        if object.contains_key("_mutex_")
            || object.contains_key("_requires_")
            || object.contains_key("_exclude_")
        {
            return Err(DagMlError::GraphValidation(format!(
                "{path} declares an empty generator constraint keyword"
            )));
        }
        return Ok(None);
    }
    Ok(Some(constraints))
}
pub(crate) fn compat_branch_id(value: &serde_json::Value, index: usize) -> String {
    value
        .as_object()
        .and_then(|object| object.get("id"))
        .and_then(serde_json::Value::as_str)
        .map(|id| sanitize_branch_id(id, index))
        .unwrap_or_else(|| format!("choice{index}"))
}
pub(crate) fn sanitize_branch_id(input: &str, index: usize) -> String {
    let sanitized = sanitize_generation_label(input);
    if sanitized == "value" {
        format!("branch{index}")
    } else {
        sanitized
    }
}
pub(crate) fn step_has_prediction(step: &PipelineDslStep) -> bool {
    match step {
        PipelineDslStep::Model(_) | PipelineDslStep::Tuner(_) | PipelineDslStep::MergeModel(_) => {
            true
        }
        PipelineDslStep::Merge(step) => step.output_as == PipelineDslMergeOutput::Predictions,
        PipelineDslStep::Branch(step) => step
            .branches
            .iter()
            .any(|branch| branch.steps.iter().any(step_has_prediction)),
        PipelineDslStep::Generator(step) => generator_step_has_prediction(step),
        PipelineDslStep::Sequential(step) => step.steps.iter().any(step_has_prediction),
        _ => false,
    }
}
pub(crate) fn generator_step_has_prediction(generator: &PipelineDslGeneratorStep) -> bool {
    generator
        .branches
        .iter()
        .any(|branch| branch.steps.iter().any(step_has_prediction))
        || generator.stages.iter().any(|stage| {
            stage
                .branches
                .iter()
                .any(|branch| branch.steps.iter().any(step_has_prediction))
        })
        // A generator that carries a fixed model tail (ADR-17 item 5 slice B) already terminates each
        // survivor in a prediction, so it is NOT a data-only generator — it must never be fused with a
        // following model (the fusion drops constraints + rejects pick). Treat the tail like a branch.
        || generator.tail.iter().any(step_has_prediction)
}
pub(crate) fn generator_to_cartesian_stages(
    generator: PipelineDslGeneratorStep,
) -> Result<Vec<PipelineDslGeneratorStage>> {
    match generator.mode {
        PipelineDslGeneratorMode::Cartesian => Ok(generator.stages),
        PipelineDslGeneratorMode::Or => {
            if generator.pick.is_some()
                || generator.arrange.is_some()
                || generator.then_pick.is_some()
                || generator.then_arrange.is_some()
            {
                return Err(DagMlError::GraphValidation(format!(
                    "nirs4all-compatible data-only generator `{}` cannot be fused across downstream models when pick/arrange selectors are present",
                    generator.id
                )));
            }
            Ok(vec![PipelineDslGeneratorStage {
                id: sanitize_generation_label(generator.id.as_str()),
                selector: None,
                metadata: generator.metadata,
                branches: generator.branches,
            }])
        }
    }
}
pub(crate) fn single_stage(
    id: String,
    branch_id: &str,
    steps: Vec<PipelineDslStep>,
) -> PipelineDslGeneratorStage {
    PipelineDslGeneratorStage {
        id,
        selector: None,
        metadata: BTreeMap::new(),
        branches: vec![PipelineDslBranch {
            id: branch_id.to_string(),
            selector: None,
            metadata: BTreeMap::new(),
            steps,
        }],
    }
}
pub(crate) fn combined_cartesian_generator(
    id: NodeId,
    stages: Vec<PipelineDslGeneratorStage>,
) -> PipelineDslGeneratorStep {
    PipelineDslGeneratorStep {
        id,
        mode: PipelineDslGeneratorMode::Cartesian,
        branches: Vec::new(),
        stages,
        pick: None,
        arrange: None,
        then_pick: None,
        then_arrange: None,
        count: None,
        constraints: None,
        tail: Vec::new(),
        metadata: BTreeMap::from([(
            "dsl_compat_generator".to_string(),
            serde_json::Value::String("fused_data_to_prediction".to_string()),
        )]),
    }
}
pub(crate) fn compat_grid_rows(
    value: &serde_json::Value,
    path: &str,
) -> Result<Vec<BTreeMap<String, serde_json::Value>>> {
    let object = value
        .as_object()
        .ok_or_else(|| DagMlError::GraphValidation(format!("{path}._grid_ must be an object")))?;
    if object.is_empty() {
        return Err(DagMlError::GraphValidation(format!(
            "{path}._grid_ must contain at least one parameter"
        )));
    }
    let entries = object
        .iter()
        .map(|(key, value)| {
            let values = match value {
                serde_json::Value::Array(values) => values.clone(),
                _ => vec![value.clone()],
            };
            if values.is_empty() {
                return Err(DagMlError::GraphValidation(format!(
                    "{path}._grid_.{key} has no values"
                )));
            }
            Ok((key.clone(), values))
        })
        .collect::<Result<Vec<_>>>()?;
    let mut rows = Vec::new();
    build_compat_grid_rows(&entries, 0, &mut BTreeMap::new(), &mut rows);
    Ok(rows)
}
pub(crate) fn build_compat_grid_rows(
    entries: &[(String, Vec<serde_json::Value>)],
    index: usize,
    current: &mut BTreeMap<String, serde_json::Value>,
    rows: &mut Vec<BTreeMap<String, serde_json::Value>>,
) {
    if index == entries.len() {
        rows.push(current.clone());
        return;
    }
    let (key, values) = &entries[index];
    for value in values {
        current.insert(key.clone(), value.clone());
        build_compat_grid_rows(entries, index + 1, current, rows);
        current.remove(key);
    }
}
pub(crate) fn compat_range_generator(
    value: &serde_json::Value,
    object: &serde_json::Map<String, serde_json::Value>,
    path: &str,
) -> Result<PipelineDslParamGenerator> {
    let param = object
        .get("param")
        .and_then(serde_json::Value::as_str)
        .unwrap_or("n_components")
        .to_string();
    let (start, stop, step) = if let Some(values) = value.as_array() {
        if values.len() != 3 {
            return Err(DagMlError::GraphValidation(format!(
                "{path}._range_ array must be [start, stop, step]"
            )));
        }
        (
            json_f64(&values[0], path, "_range_[0]")?,
            json_f64(&values[1], path, "_range_[1]")?,
            json_f64(&values[2], path, "_range_[2]")?,
        )
    } else if let Some(spec) = value.as_object() {
        (
            json_f64(
                spec.get("start").ok_or_else(|| {
                    DagMlError::GraphValidation(format!("{path}._range_ lacks start"))
                })?,
                path,
                "start",
            )?,
            json_f64(
                spec.get("stop").ok_or_else(|| {
                    DagMlError::GraphValidation(format!("{path}._range_ lacks stop"))
                })?,
                path,
                "stop",
            )?,
            json_f64(
                spec.get("step").ok_or_else(|| {
                    DagMlError::GraphValidation(format!("{path}._range_ lacks step"))
                })?,
                path,
                "step",
            )?,
        )
    } else {
        return Err(DagMlError::GraphValidation(format!(
            "{path}._range_ must be an array or object"
        )));
    };
    Ok(PipelineDslParamGenerator::Range {
        name: optional_object_field(object, "name")?,
        param,
        start,
        stop,
        step,
        inclusive: object
            .get("inclusive")
            .and_then(serde_json::Value::as_bool)
            .unwrap_or(true),
        count: optional_object_field(object, "count")?,
    })
}
pub(crate) fn compat_log_range_generator(
    value: &serde_json::Value,
    object: &serde_json::Map<String, serde_json::Value>,
    path: &str,
) -> Result<PipelineDslParamGenerator> {
    let param = object
        .get("param")
        .and_then(serde_json::Value::as_str)
        .unwrap_or("alpha")
        .to_string();
    let spec = value.as_object().ok_or_else(|| {
        DagMlError::GraphValidation(format!("{path}._log_range_ must be an object"))
    })?;
    let start = json_f64(
        spec.get("start")
            .or_else(|| spec.get("from"))
            .ok_or_else(|| {
                DagMlError::GraphValidation(format!("{path}._log_range_ lacks start/from"))
            })?,
        path,
        "start",
    )?;
    let stop = json_f64(
        spec.get("stop").or_else(|| spec.get("to")).ok_or_else(|| {
            DagMlError::GraphValidation(format!("{path}._log_range_ lacks stop/to"))
        })?,
        path,
        "stop",
    )?;
    let count = spec
        .get("count")
        .or_else(|| spec.get("num"))
        .and_then(serde_json::Value::as_u64)
        .ok_or_else(|| DagMlError::GraphValidation(format!("{path}._log_range_ lacks count/num")))?
        as usize;
    Ok(PipelineDslParamGenerator::LogRange {
        name: optional_object_field(object, "name")?,
        param,
        start,
        stop,
        count,
        base: spec
            .get("base")
            .map(|value| json_f64(value, path, "base"))
            .transpose()?
            .unwrap_or(10.0),
    })
}
pub(crate) fn compat_grid_param_generator(
    value: &serde_json::Value,
    object: &serde_json::Map<String, serde_json::Value>,
    path: &str,
) -> Result<PipelineDslParamGenerator> {
    let grid = value
        .as_object()
        .ok_or_else(|| DagMlError::GraphValidation(format!("{path}._grid_ must be an object")))?;
    let params = grid
        .iter()
        .map(|(key, value)| {
            let values = match value {
                serde_json::Value::Array(values) => values.clone(),
                _ => vec![value.clone()],
            };
            Ok((
                key.clone(),
                values
                    .into_iter()
                    .map(PipelineDslGeneratorValue::Value)
                    .collect::<Vec<_>>(),
            ))
        })
        .collect::<Result<BTreeMap<_, _>>>()?;
    Ok(PipelineDslParamGenerator::Grid {
        name: optional_object_field(object, "name")?,
        params,
        count: optional_object_field(object, "count")?,
    })
}
pub(crate) fn compat_zip_variants(
    value: &serde_json::Value,
    path: &str,
) -> Result<Vec<PipelineDslVariantChoice>> {
    let object = value
        .as_object()
        .ok_or_else(|| DagMlError::GraphValidation(format!("{path}._zip_ must be an object")))?;
    let mut length = None;
    let mut columns = Vec::new();
    for (key, value) in object {
        let values = value.as_array().ok_or_else(|| {
            DagMlError::GraphValidation(format!("{path}._zip_.{key} must be an array"))
        })?;
        if let Some(expected) = length {
            if values.len() != expected {
                return Err(DagMlError::GraphValidation(format!(
                    "{path}._zip_ arrays must have equal lengths"
                )));
            }
        } else {
            length = Some(values.len());
        }
        columns.push((key.clone(), values.clone()));
    }
    let length = length.unwrap_or(0);
    if length == 0 {
        return Err(DagMlError::GraphValidation(format!(
            "{path}._zip_ must contain non-empty arrays"
        )));
    }
    Ok((0..length)
        .map(|index| {
            let params = columns
                .iter()
                .map(|(key, values)| (key.clone(), values[index].clone()))
                .collect::<BTreeMap<_, _>>();
            PipelineDslVariantChoice {
                label: format!("zip{index}"),
                params,
                value: None,
            }
        })
        .collect())
}
pub(crate) fn compat_sample_rows(
    object: &serde_json::Map<String, serde_json::Value>,
    path: &str,
) -> Result<Vec<BTreeMap<String, serde_json::Value>>> {
    let param_names = if let Some(param) = object.get("param").and_then(serde_json::Value::as_str) {
        vec![param.to_string()]
    } else if let Some(tune) = object.get("tune").and_then(serde_json::Value::as_array) {
        let params = tune
            .iter()
            .map(|value| {
                value.as_str().map(str::to_string).ok_or_else(|| {
                    DagMlError::GraphValidation(format!(
                        "{path}._sample_.tune entries must be strings"
                    ))
                })
            })
            .collect::<Result<Vec<_>>>()?;
        if params.is_empty() {
            return Err(DagMlError::GraphValidation(format!(
                "{path}._sample_.tune cannot be empty"
            )));
        }
        params
    } else {
        return Err(DagMlError::GraphValidation(format!(
            "{path}._sample_ requires `param` or `tune` for deterministic JSON lowering"
        )));
    };
    let from = json_f64(
        object
            .get("from")
            .ok_or_else(|| DagMlError::GraphValidation(format!("{path}._sample_ lacks from")))?,
        path,
        "from",
    )?;
    let to = json_f64(
        object
            .get("to")
            .ok_or_else(|| DagMlError::GraphValidation(format!("{path}._sample_ lacks to")))?,
        path,
        "to",
    )?;
    let count = object
        .get("num")
        .or_else(|| object.get("count"))
        .and_then(serde_json::Value::as_u64)
        .ok_or_else(|| DagMlError::GraphValidation(format!("{path}._sample_ lacks num/count")))?
        as usize;
    if count == 0 {
        return Err(DagMlError::GraphValidation(format!(
            "{path}._sample_ count cannot be zero"
        )));
    }
    let distribution = object
        .get("distribution")
        .and_then(serde_json::Value::as_str)
        .unwrap_or("uniform");
    if distribution == "log_uniform" && (from <= 0.0 || to <= 0.0) {
        return Err(DagMlError::GraphValidation(format!(
            "{path}._sample_ log_uniform requires positive from/to"
        )));
    }
    (0..count)
        .map(|index| {
            let ratio = if count == 1 {
                0.0
            } else {
                index as f64 / (count - 1) as f64
            };
            let sampled = match distribution {
                "uniform" => from + (to - from) * ratio,
                "log_uniform" => {
                    let start = from.log10();
                    let stop = to.log10();
                    10f64.powf(start + (stop - start) * ratio)
                }
                other => {
                    return Err(DagMlError::GraphValidation(format!(
                        "{path}._sample_ unsupported deterministic distribution `{other}`"
                    )));
                }
            };
            let mut row = BTreeMap::new();
            let value = serde_json::Value::Number(
                serde_json::Number::from_f64(sampled).ok_or_else(|| {
                    DagMlError::GraphValidation(format!(
                        "{path}._sample_ produced non-finite value"
                    ))
                })?,
            );
            for param in &param_names {
                row.insert(param.clone(), value.clone());
            }
            Ok(row)
        })
        .collect()
}
pub(crate) fn compat_sample_variants(
    value: &serde_json::Value,
    path: &str,
) -> Result<Vec<PipelineDslVariantChoice>> {
    let object = value
        .as_object()
        .ok_or_else(|| DagMlError::GraphValidation(format!("{path}._sample_ must be an object")))?;
    compat_sample_rows(object, path)?
        .into_iter()
        .enumerate()
        .map(|(index, params)| {
            Ok(PipelineDslVariantChoice {
                label: format!("sample{index}"),
                params,
                value: None,
            })
        })
        .collect()
}
pub(crate) fn json_f64(value: &serde_json::Value, path: &str, field: &str) -> Result<f64> {
    value
        .as_f64()
        .ok_or_else(|| DagMlError::GraphValidation(format!("{path}.{field} must be numeric")))
}
