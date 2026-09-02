//! nirs4all-compat lowering: the `CompatDslLowerer` that turns nirs4all JSON
//! pipelines into a canonical [`PipelineDslSpec`].

use super::*;

#[derive(Clone, Debug, Default)]
pub(crate) struct CompatGenerationAttachment {
    variants: Vec<PipelineDslVariantChoice>,
    param_generators: Vec<PipelineDslParamGenerator>,
}
#[derive(Default)]
pub(crate) struct CompatDslLowerer {
    node_counter: usize,
    generator_counter: usize,
    split_invocation: Option<SplitInvocation>,
    metadata: BTreeMap<String, serde_json::Value>,
}
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum CompatPlainOperatorKind {
    Transform,
    Model,
    Tuner,
    Split,
    Chart,
}
impl CompatDslLowerer {
    pub(crate) fn lower_root(mut self, value: &serde_json::Value) -> Result<PipelineDslSpec> {
        let root = value.as_object();
        let pipeline = match value {
            serde_json::Value::Array(_) => value,
            serde_json::Value::Object(object) => object
                .get("pipeline")
                .or_else(|| object.get("steps"))
                .ok_or_else(|| {
                    DagMlError::GraphValidation(
                        "nirs4all-compatible pipeline DSL must be a JSON array or an object with `pipeline`/`steps`".to_string(),
                    )
                })?,
            _ => {
                return Err(DagMlError::GraphValidation(
                    "nirs4all-compatible pipeline DSL must be a JSON array or object".to_string(),
                ));
            }
        };
        let pipeline = pipeline.as_array().ok_or_else(|| {
            DagMlError::GraphValidation(
                "nirs4all-compatible pipeline field must be an array".to_string(),
            )
        })?;
        let steps = self.lower_steps(pipeline, "pipeline")?;
        let id = root
            .and_then(|object| object.get("id"))
            .and_then(serde_json::Value::as_str)
            .unwrap_or("dsl-nirs4all-compat")
            .to_string();
        let mut metadata: BTreeMap<String, serde_json::Value> =
            optional_root_field(root, "metadata")?.unwrap_or_default();
        metadata.extend(std::mem::take(&mut self.metadata));
        metadata.insert(
            "dsl_compat_profile".to_string(),
            serde_json::Value::String("nirs4all_json_v1".to_string()),
        );
        let root_split = optional_root_field(root, "split_invocation")?;
        let split_invocation = match (root_split, self.split_invocation) {
            (Some(_), Some(_)) => {
                return Err(DagMlError::GraphValidation(
                    "nirs4all-compatible pipeline declares split_invocation and a pipeline split step".to_string(),
                ));
            }
            (Some(split), None) | (None, Some(split)) => Some(split),
            (None, None) => None,
        };
        Ok(PipelineDslSpec {
            inner_cv: optional_root_field(root, "inner_cv")?,
            id,
            input: optional_root_field(root, "input")?.unwrap_or_default(),
            output: optional_root_field(root, "output")?.unwrap_or_default(),
            generation_strategy: optional_root_field(root, "generation_strategy")?,
            max_variants: optional_root_field(root, "max_variants")?,
            generation_dimensions: optional_root_field(root, "generation_dimensions")?
                .unwrap_or_default(),
            generation_constraints: optional_root_field(root, "generation_constraints")?,
            campaign_id: optional_root_field(root, "campaign_id")?,
            root_seed: optional_root_field(root, "root_seed")?,
            leakage_policy: optional_root_field(root, "leakage_policy")?,
            aggregation_policy: optional_root_field(root, "aggregation_policy")?,
            split_invocation,
            campaign_metadata: optional_root_field(root, "campaign_metadata")?.unwrap_or_default(),
            data_bindings: optional_root_field(root, "data_bindings")?.unwrap_or_default(),
            steps,
            metadata,
        })
    }

    fn lower_steps(
        &mut self,
        values: &[serde_json::Value],
        path: &str,
    ) -> Result<Vec<PipelineDslStep>> {
        let mut lowered = Vec::new();
        let mut index = 0usize;
        while index < values.len() {
            let current_path = format!("{path}[{index}]");
            if self.consume_side_effect_step(&values[index], &current_path)? {
                index += 1;
                continue;
            }
            if let Some(attachment) =
                self.parse_attached_generation(&values[index], &current_path)?
            {
                if value_can_receive_generation_attachment(&values[index]) {
                    let mut attached = self.lower_value_with_attachment(
                        &values[index],
                        &current_path,
                        attachment,
                    )?;
                    lowered.append(&mut attached);
                    index += 1;
                    continue;
                }
                let next = values.get(index + 1).ok_or_else(|| {
                    DagMlError::GraphValidation(format!(
                        "{current_path} declares a parameter generator but has no following operator/model step"
                    ))
                })?;
                let mut attached = self.lower_value_with_attachment(
                    next,
                    &format!("{path}[{}]", index + 1),
                    attachment,
                )?;
                lowered.append(&mut attached);
                index += 2;
                continue;
            }
            if let Some(merge_model) =
                self.lower_merge_followed_by_model(values, index, &current_path)?
            {
                lowered.push(PipelineDslStep::MergeModel(merge_model));
                index += 2;
                continue;
            }

            let steps = self.lower_value_as_steps(&values[index], &current_path)?;
            if let [PipelineDslStep::Generator(generator)] = steps.as_slice() {
                if !generator_step_has_prediction(generator) {
                    if let Some((combined, consumed)) = self.combine_data_generator_with_following(
                        generator.clone(),
                        &values[index + 1..],
                        path,
                        index + 1,
                    )? {
                        lowered.push(PipelineDslStep::Generator(combined));
                        index += consumed + 1;
                        continue;
                    }
                }
            }
            lowered.extend(steps);
            index += 1;
        }
        Ok(lowered)
    }

    fn consume_side_effect_step(&mut self, value: &serde_json::Value, path: &str) -> Result<bool> {
        if compat_plain_operator_kind(value) == CompatPlainOperatorKind::Split {
            self.set_split_invocation(self.lower_plain_split_invocation(value, path)?, path)?;
            return Ok(true);
        }
        let Some(object) = value.as_object() else {
            return Ok(false);
        };
        if is_comment_only_object(object) {
            return Ok(true);
        }
        if let Some(split) = object.get("split") {
            self.set_split_invocation(self.lower_split_invocation(split, object, path)?, path)?;
            return Ok(true);
        }
        if let Some(sources) = object.get("sources") {
            self.metadata
                .insert("compat_sources".to_string(), sources.clone());
            return Ok(true);
        }
        Ok(false)
    }

    fn lower_value_as_steps(
        &mut self,
        value: &serde_json::Value,
        path: &str,
    ) -> Result<Vec<PipelineDslStep>> {
        match value {
            serde_json::Value::Null => Ok(Vec::new()),
            serde_json::Value::Array(children) => {
                Ok(vec![PipelineDslStep::Sequential(PipelineDslSequenceStep {
                    id: None,
                    metadata: BTreeMap::new(),
                    steps: self.lower_steps(children, path)?,
                })])
            }
            serde_json::Value::String(_) => {
                let step = match compat_plain_operator_kind(value) {
                    CompatPlainOperatorKind::Transform => PipelineDslStep::Transform(
                        self.compat_operator_step(None, "preprocessing", value, None, None)?,
                    ),
                    CompatPlainOperatorKind::Model => PipelineDslStep::Model(
                        self.compat_operator_step(None, "model", value, None, None)?,
                    ),
                    CompatPlainOperatorKind::Tuner => PipelineDslStep::Tuner(
                        self.compat_operator_step(None, "tuner", value, None, None)?,
                    ),
                    CompatPlainOperatorKind::Chart => PipelineDslStep::Chart(
                        self.compat_operator_step(None, "chart", value, None, None)?,
                    ),
                    CompatPlainOperatorKind::Split => {
                        return Err(DagMlError::GraphValidation(format!(
                            "{path} splitter alias was not consumed as a campaign split"
                        )));
                    }
                };
                Ok(vec![step])
            }
            serde_json::Value::Object(object) => {
                if object.contains_key("kind") {
                    let step = serde_json::from_value::<PipelineDslStep>(value.clone()).map_err(
                        |error| {
                            DagMlError::GraphValidation(format!(
                                "failed to parse canonical DSL step at {path}: {error}"
                            ))
                        },
                    )?;
                    return Ok(vec![step]);
                }
                if self.consume_side_effect_step(value, path)? {
                    return Ok(Vec::new());
                }
                if let Some(operator) =
                    first_object_value(object, &["preprocessing", "processing", "transform"])
                {
                    return Ok(vec![PipelineDslStep::Transform(
                        self.compat_operator_step(
                            Some(object),
                            "preprocessing",
                            operator,
                            None,
                            None,
                        )?,
                    )]);
                }
                if let Some(operator) = first_object_value(object, &["y_processing", "y_transform"])
                {
                    return Ok(vec![PipelineDslStep::YTransform(
                        self.compat_operator_step(
                            Some(object),
                            "y_processing",
                            operator,
                            None,
                            None,
                        )?,
                    )]);
                }
                if let Some(operator) = object.get("tag") {
                    return Ok(vec![PipelineDslStep::Tag(self.compat_operator_step(
                        Some(object),
                        "tag",
                        operator,
                        None,
                        None,
                    )?)]);
                }
                if let Some(operator) = object.get("exclude") {
                    return Ok(vec![PipelineDslStep::Exclude(self.compat_operator_step(
                        Some(object),
                        "exclude",
                        operator,
                        None,
                        None,
                    )?)]);
                }
                if let Some(operator) = object.get("filter") {
                    return Ok(vec![PipelineDslStep::Filter(self.compat_operator_step(
                        Some(object),
                        "filter",
                        operator,
                        None,
                        None,
                    )?)]);
                }
                if let Some(operator) = object.get("sample_filter") {
                    return Ok(vec![PipelineDslStep::SampleFilter(
                        self.compat_operator_step(
                            Some(object),
                            "sample_filter",
                            operator,
                            None,
                            None,
                        )?,
                    )]);
                }
                if let Some(operator) = object.get("sample_augmentation") {
                    return Ok(vec![PipelineDslStep::SampleAugmentation(
                        self.compat_operator_step(
                            Some(object),
                            "sample_augmentation",
                            operator,
                            None,
                            Some(compat_augmentation_shape("sample", object)?),
                        )?,
                    )]);
                }
                if let Some(operator) = object.get("feature_augmentation") {
                    return Ok(vec![PipelineDslStep::FeatureAugmentation(
                        self.compat_operator_step(
                            Some(object),
                            "feature_augmentation",
                            operator,
                            None,
                            Some(compat_augmentation_shape("feature", object)?),
                        )?,
                    )]);
                }
                if let Some(operator) = object.get("augmentation") {
                    return Ok(vec![PipelineDslStep::Augmentation(
                        self.compat_operator_step(
                            Some(object),
                            "augmentation",
                            operator,
                            None,
                            Some(compat_augmentation_shape("both", object)?),
                        )?,
                    )]);
                }
                if let Some(operator) =
                    first_object_value(object, &["data_generation", "generation"])
                {
                    return Ok(vec![PipelineDslStep::DataGeneration(
                        self.compat_operator_step(
                            Some(object),
                            "data_generation",
                            operator,
                            None,
                            None,
                        )?,
                    )]);
                }
                if let Some(operator) = object.get("model") {
                    return Ok(vec![PipelineDslStep::Model(self.compat_operator_step(
                        Some(object),
                        "model",
                        operator,
                        None,
                        None,
                    )?)]);
                }
                if let Some(operator) = first_object_value(object, &["tuner", "finetune"]) {
                    return Ok(vec![PipelineDslStep::Tuner(self.compat_operator_step(
                        Some(object),
                        "tuner",
                        operator,
                        None,
                        None,
                    )?)]);
                }
                if let Some(operator) = object.get("chart") {
                    return Ok(vec![PipelineDslStep::Chart(self.compat_operator_step(
                        Some(object),
                        "chart",
                        operator,
                        None,
                        None,
                    )?)]);
                }
                if object.contains_key("branch") {
                    return Ok(vec![PipelineDslStep::Branch(
                        self.lower_branch_step(object, path)?,
                    )]);
                }
                if object.contains_key("concat_transform") {
                    return Ok(vec![PipelineDslStep::ConcatTransform(
                        self.lower_concat_transform_step(object, path)?,
                    )]);
                }
                if object.contains_key("merge") {
                    return Ok(vec![PipelineDslStep::Merge(
                        self.lower_merge_step(object, path)?,
                    )]);
                }
                if let Some(step_value) = object.get("step") {
                    let mut steps =
                        self.lower_pipeline_fragment(step_value, &format!("{path}.step"))?;
                    if let Some(name) = object.get("name").and_then(serde_json::Value::as_str) {
                        annotate_named_steps(&mut steps, name);
                    }
                    return Ok(steps);
                }
                if object.contains_key("_or_") {
                    return Ok(vec![PipelineDslStep::Generator(
                        self.lower_or_generator(object, "_or_", path)?,
                    )]);
                }
                if object.contains_key("_chain_") {
                    return Ok(vec![PipelineDslStep::Generator(
                        self.lower_or_generator(object, "_chain_", path)?,
                    )]);
                }
                if object.contains_key("_cartesian_") {
                    return Ok(vec![PipelineDslStep::Generator(
                        self.lower_cartesian_generator(object, path)?,
                    )]);
                }
                if object.contains_key("_grid_") {
                    return Ok(vec![PipelineDslStep::Generator(
                        self.lower_grid_generator(object, path)?,
                    )]);
                }
                if object.contains_key("_sample_") {
                    return Ok(vec![PipelineDslStep::Generator(
                        self.lower_sample_generator(object, path)?,
                    )]);
                }
                if compat_plain_operator_ref(value).is_some() {
                    let operator = compat_plain_operator_value(value)?;
                    return match compat_plain_operator_kind(value) {
                        CompatPlainOperatorKind::Transform => Ok(vec![PipelineDslStep::Transform(
                            self.compat_operator_step(
                                Some(object),
                                "preprocessing",
                                &operator,
                                None,
                                None,
                            )?,
                        )]),
                        CompatPlainOperatorKind::Model => {
                            Ok(vec![PipelineDslStep::Model(self.compat_operator_step(
                                Some(object),
                                "model",
                                &operator,
                                None,
                                None,
                            )?)])
                        }
                        CompatPlainOperatorKind::Tuner => {
                            Ok(vec![PipelineDslStep::Tuner(self.compat_operator_step(
                                Some(object),
                                "tuner",
                                &operator,
                                None,
                                None,
                            )?)])
                        }
                        CompatPlainOperatorKind::Chart => {
                            Ok(vec![PipelineDslStep::Chart(self.compat_operator_step(
                                Some(object),
                                "chart",
                                &operator,
                                None,
                                None,
                            )?)])
                        }
                        CompatPlainOperatorKind::Split => Err(DagMlError::GraphValidation(
                            format!("{path} splitter object was not consumed as a campaign split"),
                        )),
                    };
                }
                if object.contains_key("type") || object.contains_key("ref") {
                    return Ok(vec![PipelineDslStep::Transform(
                        self.compat_operator_step(None, "preprocessing", value, None, None)?,
                    )]);
                }
                Err(DagMlError::GraphValidation(format!(
                    "unsupported nirs4all-compatible DSL object at {path}"
                )))
            }
            _ => Err(DagMlError::GraphValidation(format!(
                "unsupported nirs4all-compatible DSL value at {path}"
            ))),
        }
    }

    fn lower_value_with_attachment(
        &mut self,
        value: &serde_json::Value,
        path: &str,
        attachment: CompatGenerationAttachment,
    ) -> Result<Vec<PipelineDslStep>> {
        match value {
            serde_json::Value::String(_) => match compat_plain_operator_kind(value) {
                CompatPlainOperatorKind::Transform => Ok(vec![PipelineDslStep::Transform(
                    self.compat_operator_step(
                        None,
                        "preprocessing",
                        value,
                        Some(attachment),
                        None,
                    )?,
                )]),
                CompatPlainOperatorKind::Model => Ok(vec![PipelineDslStep::Model(
                    self.compat_operator_step(None, "model", value, Some(attachment), None)?,
                )]),
                CompatPlainOperatorKind::Tuner => Ok(vec![PipelineDslStep::Tuner(
                    self.compat_operator_step(None, "tuner", value, Some(attachment), None)?,
                )]),
                CompatPlainOperatorKind::Chart => Ok(vec![PipelineDslStep::Chart(
                    self.compat_operator_step(None, "chart", value, Some(attachment), None)?,
                )]),
                CompatPlainOperatorKind::Split => Err(DagMlError::GraphValidation(format!(
                    "{path} splitter alias cannot receive a parameter generator"
                ))),
            },
            serde_json::Value::Object(object) => {
                if let Some(operator) = object.get("model") {
                    return Ok(vec![PipelineDslStep::Model(self.compat_operator_step(
                        Some(object),
                        "model",
                        operator,
                        Some(attachment),
                        None,
                    )?)]);
                }
                if let Some(operator) = first_object_value(object, &["tuner", "finetune"]) {
                    return Ok(vec![PipelineDslStep::Tuner(self.compat_operator_step(
                        Some(object),
                        "tuner",
                        operator,
                        Some(attachment),
                        None,
                    )?)]);
                }
                if let Some(operator) =
                    first_object_value(object, &["preprocessing", "processing", "transform"])
                {
                    return Ok(vec![PipelineDslStep::Transform(self.compat_operator_step(
                        Some(object),
                        "preprocessing",
                        operator,
                        Some(attachment),
                        None,
                    )?)]);
                }
                if compat_plain_operator_ref(value).is_some() {
                    let operator = compat_plain_operator_value(value)?;
                    return match compat_plain_operator_kind(value) {
                        CompatPlainOperatorKind::Transform => Ok(vec![PipelineDslStep::Transform(
                            self.compat_operator_step(
                                Some(object),
                                "preprocessing",
                                &operator,
                                Some(attachment),
                                None,
                            )?,
                        )]),
                        CompatPlainOperatorKind::Model => Ok(vec![PipelineDslStep::Model(
                            self.compat_operator_step(
                                Some(object),
                                "model",
                                &operator,
                                Some(attachment),
                                None,
                            )?,
                        )]),
                        CompatPlainOperatorKind::Tuner => Ok(vec![PipelineDslStep::Tuner(
                            self.compat_operator_step(
                                Some(object),
                                "tuner",
                                &operator,
                                Some(attachment),
                                None,
                            )?,
                        )]),
                        CompatPlainOperatorKind::Chart => Ok(vec![PipelineDslStep::Chart(
                            self.compat_operator_step(
                                Some(object),
                                "chart",
                                &operator,
                                Some(attachment),
                                None,
                            )?,
                        )]),
                        CompatPlainOperatorKind::Split => Err(DagMlError::GraphValidation(
                            format!("{path} splitter object cannot receive a parameter generator"),
                        )),
                    };
                }
                Err(DagMlError::GraphValidation(format!(
                    "{path} cannot receive a preceding nirs4all parameter generator; expected model, tuner or preprocessing"
                )))
            }
            _ => Err(DagMlError::GraphValidation(format!(
                "{path} cannot receive a preceding nirs4all parameter generator; expected model, tuner or preprocessing"
            ))),
        }
    }

    fn lower_merge_followed_by_model(
        &mut self,
        values: &[serde_json::Value],
        index: usize,
        _path: &str,
    ) -> Result<Option<PipelineDslMergeModelStep>> {
        let Some(merge_object) = values[index].as_object() else {
            return Ok(None);
        };
        if !merge_object.contains_key("merge") {
            return Ok(None);
        }
        let Some(next) = values.get(index + 1).and_then(serde_json::Value::as_object) else {
            return Ok(None);
        };
        let Some(operator) = next.get("model") else {
            return Ok(None);
        };
        let (merge_mode, include_original_data, _) = compat_merge_modes(merge_object)?;
        let operator_step = self.compat_operator_step(Some(next), "model", operator, None, None)?;
        Ok(Some(PipelineDslMergeModelStep {
            inner_cv: operator_step.inner_cv,
            id: operator_step.id,
            operator: operator_step.operator,
            params: operator_step.params,
            metadata: operator_step.metadata,
            seed_label: operator_step.seed_label,
            include_original_data,
            merge_mode,
            train_params: operator_step.train_params,
            tuning: operator_step.tuning,
            variants: operator_step.variants,
            param_generators: operator_step.param_generators,
            shape: operator_step.shape,
        }))
    }

    fn combine_data_generator_with_following(
        &mut self,
        generator: PipelineDslGeneratorStep,
        remaining: &[serde_json::Value],
        path: &str,
        absolute_start: usize,
    ) -> Result<Option<(PipelineDslGeneratorStep, usize)>> {
        let fused_id = generator.id.clone();
        let mut stages = generator_to_cartesian_stages(generator)?;
        let mut prefix_steps = Vec::new();
        let mut consumed = 0usize;
        while consumed < remaining.len() {
            let current_path = format!("{path}[{}]", absolute_start + consumed);
            if self.consume_side_effect_step(&remaining[consumed], &current_path)? {
                consumed += 1;
                continue;
            }
            let steps = if let Some(attachment) =
                self.parse_attached_generation(&remaining[consumed], &current_path)?
            {
                let next = remaining.get(consumed + 1).ok_or_else(|| {
                    DagMlError::GraphValidation(format!(
                        "{current_path} declares a parameter generator but has no following operator/model step"
                    ))
                })?;
                consumed += 1;
                self.lower_value_with_attachment(
                    next,
                    &format!("{path}[{}]", absolute_start + consumed),
                    attachment,
                )?
            } else if let Some(merge_model) =
                self.lower_merge_followed_by_model(remaining, consumed, &current_path)?
            {
                consumed += 1;
                vec![PipelineDslStep::MergeModel(merge_model)]
            } else {
                self.lower_value_as_steps(&remaining[consumed], &current_path)?
            };
            consumed += 1;
            if steps.is_empty() {
                continue;
            }
            if let [PipelineDslStep::Generator(next_generator)] = steps.as_slice() {
                // A following generator that carries a model TAIL (ADR-17 item 5 slice B) is a prediction
                // boundary: `generator_to_cartesian_stages` would DROP its tail (the tail is neither a stage
                // branch nor a fusable selector), silently losing the terminal model. So it must NOT be fused —
                // abandon the fusion entirely (`None`). The caller then emits the LEADING data-generator alone
                // and re-lowers the remaining steps (any intervening transforms + the tail-bearing generator)
                // independently, exactly as the top-level `!generator_step_has_prediction` guard keeps a
                // tail-bearing generator off the fusion path. (MUST-FIX 4.)
                if !next_generator.tail.is_empty() {
                    return Ok(None);
                }
                if !prefix_steps.is_empty() {
                    stages.push(single_stage(
                        format!("stage{}", stages.len()),
                        "prefix",
                        std::mem::take(&mut prefix_steps),
                    ));
                }
                let next_has_prediction = generator_step_has_prediction(next_generator);
                stages.extend(generator_to_cartesian_stages(next_generator.clone())?);
                if next_has_prediction {
                    return Ok(Some((
                        combined_cartesian_generator(fused_id.clone(), stages),
                        consumed,
                    )));
                }
                continue;
            }
            let has_prediction = steps.iter().any(step_has_prediction);
            prefix_steps.extend(steps);
            if has_prediction {
                stages.push(single_stage(
                    format!("stage{}", stages.len()),
                    "then",
                    std::mem::take(&mut prefix_steps),
                ));
                return Ok(Some((
                    combined_cartesian_generator(fused_id.clone(), stages),
                    consumed,
                )));
            }
        }
        Ok(None)
    }

    fn lower_branch_step(
        &mut self,
        object: &serde_json::Map<String, serde_json::Value>,
        path: &str,
    ) -> Result<PipelineDslBranchStep> {
        let branch_value = object.get("branch").expect("checked by caller");
        let mode = optional_object_field(object, "mode")?.unwrap_or_default();
        let selector = object.get("selector").cloned();
        let metadata = optional_object_field(object, "metadata")?.unwrap_or_default();
        let branches = match branch_value {
            serde_json::Value::Array(values) => values
                .iter()
                .enumerate()
                .map(|(index, value)| {
                    let id = compat_branch_id(value, index);
                    Ok(PipelineDslBranch {
                        id,
                        selector: None,
                        metadata: BTreeMap::new(),
                        steps: self
                            .lower_pipeline_fragment(value, &format!("{path}.branch[{index}]"))?,
                    })
                })
                .collect::<Result<Vec<_>>>()?,
            serde_json::Value::Object(branch_object) => {
                if let Some(values) = branch_object
                    .get("branches")
                    .and_then(serde_json::Value::as_array)
                {
                    values
                        .iter()
                        .enumerate()
                        .map(|(index, value)| {
                            self.lower_named_branch(
                                value,
                                index,
                                &format!("{path}.branch.branches[{index}]"),
                            )
                        })
                        .collect::<Result<Vec<_>>>()?
                } else {
                    branch_object
                        .iter()
                        .filter(|(key, _)| {
                            !matches!(key.as_str(), "mode" | "selector" | "metadata")
                        })
                        .enumerate()
                        .map(|(index, (key, value))| {
                            Ok(PipelineDslBranch {
                                id: sanitize_branch_id(key, index),
                                selector: None,
                                metadata: BTreeMap::new(),
                                steps: self.lower_pipeline_fragment(
                                    value,
                                    &format!("{path}.branch.{key}"),
                                )?,
                            })
                        })
                        .collect::<Result<Vec<_>>>()?
                }
            }
            _ => {
                return Err(DagMlError::GraphValidation(format!(
                    "{path}.branch must be an array or object"
                )));
            }
        };
        Ok(PipelineDslBranchStep {
            mode,
            selector,
            metadata,
            branches,
        })
    }

    fn lower_named_branch(
        &mut self,
        value: &serde_json::Value,
        index: usize,
        path: &str,
    ) -> Result<PipelineDslBranch> {
        if let Some(object) = value.as_object() {
            if object.contains_key("steps") || object.contains_key("pipeline") {
                let id = object
                    .get("id")
                    .and_then(serde_json::Value::as_str)
                    .map(|id| sanitize_branch_id(id, index))
                    .unwrap_or_else(|| format!("branch{index}"));
                let selector = object.get("selector").cloned();
                let metadata = optional_object_field(object, "metadata")?.unwrap_or_default();
                let steps_value = object
                    .get("steps")
                    .or_else(|| object.get("pipeline"))
                    .ok_or_else(|| {
                        DagMlError::GraphValidation(format!(
                            "{path} branch object must contain steps or pipeline"
                        ))
                    })?;
                return Ok(PipelineDslBranch {
                    id,
                    selector,
                    metadata,
                    steps: self.lower_pipeline_fragment(steps_value, path)?,
                });
            }
        }
        Ok(PipelineDslBranch {
            id: compat_branch_id(value, index),
            selector: None,
            metadata: BTreeMap::new(),
            steps: self.lower_pipeline_fragment(value, path)?,
        })
    }

    fn lower_concat_transform_step(
        &mut self,
        object: &serde_json::Map<String, serde_json::Value>,
        path: &str,
    ) -> Result<PipelineDslConcatTransformStep> {
        let value = object.get("concat_transform").expect("checked by caller");
        let branches = match value {
            serde_json::Value::Array(values) => values
                .iter()
                .enumerate()
                .map(|(index, value)| {
                    Ok(PipelineDslConcatBranch {
                        id: compat_branch_id(value, index),
                        steps: self.lower_concat_operator_steps(
                            value,
                            &format!("{path}.concat_transform[{index}]"),
                        )?,
                    })
                })
                .collect::<Result<Vec<_>>>()?,
            serde_json::Value::Object(map) => map
                .iter()
                .enumerate()
                .map(|(index, (key, value))| {
                    Ok(PipelineDslConcatBranch {
                        id: sanitize_branch_id(key, index),
                        steps: self.lower_concat_operator_steps(
                            value,
                            &format!("{path}.concat_transform.{key}"),
                        )?,
                    })
                })
                .collect::<Result<Vec<_>>>()?,
            _ => {
                return Err(DagMlError::GraphValidation(format!(
                    "{path}.concat_transform must be an array or object"
                )));
            }
        };
        Ok(PipelineDslConcatTransformStep {
            id: explicit_or_generated_node_id(object, "id", || self.next_node_id("join"))?,
            branches,
            metadata: optional_object_field(object, "metadata")?.unwrap_or_default(),
            seed_label: optional_object_field(object, "seed_label")?,
            representation: optional_object_field(object, "representation")?,
            variants: Vec::new(),
            param_generators: Vec::new(),
            shape: optional_object_field(object, "shape")?,
        })
    }

    fn lower_concat_operator_steps(
        &mut self,
        value: &serde_json::Value,
        path: &str,
    ) -> Result<Vec<PipelineDslOperatorStep>> {
        let steps = self.lower_pipeline_fragment(value, path)?;
        steps
            .into_iter()
            .map(|step| match step {
                PipelineDslStep::Transform(step) => Ok(step),
                _ => Err(DagMlError::GraphValidation(format!(
                    "{path} concat_transform branches currently accept only preprocessing/transform steps"
                ))),
            })
            .collect()
    }

    fn lower_merge_step(
        &mut self,
        object: &serde_json::Map<String, serde_json::Value>,
        _path: &str,
    ) -> Result<PipelineDslMergeStep> {
        let (merge_mode, include_original_data, output_as) = compat_merge_modes(object)?;
        let mut metadata: BTreeMap<String, serde_json::Value> =
            optional_object_field(object, "metadata")?.unwrap_or_default();
        if let Some(merge) = object.get("merge").filter(|merge| merge.is_object()) {
            metadata.insert("dsl_compat_merge".to_string(), merge.clone());
        }
        Ok(PipelineDslMergeStep {
            id: explicit_or_generated_node_id(object, "id", || self.next_node_id("merge"))?,
            merge_mode,
            output_as,
            include_original_data,
            on_missing: compat_merge_field(object, "on_missing")?,
            selectors: compat_merge_field(object, "selectors")?.unwrap_or_default(),
            metadata,
            seed_label: optional_object_field(object, "seed_label")?,
            representation: optional_object_field(object, "representation")?,
            variants: Vec::new(),
            param_generators: Vec::new(),
            shape: optional_object_field(object, "shape")?,
        })
    }

    fn lower_or_generator(
        &mut self,
        object: &serde_json::Map<String, serde_json::Value>,
        key: &str,
        path: &str,
    ) -> Result<PipelineDslGeneratorStep> {
        let values = object
            .get(key)
            .and_then(serde_json::Value::as_array)
            .ok_or_else(|| DagMlError::GraphValidation(format!("{path}.{key} must be an array")))?;
        let branches = values
            .iter()
            .enumerate()
            .map(|(index, value)| {
                Ok(PipelineDslBranch {
                    id: compat_branch_id(value, index),
                    selector: None,
                    metadata: BTreeMap::new(),
                    steps: self
                        .lower_pipeline_fragment(value, &format!("{path}.{key}[{index}]"))?,
                })
            })
            .collect::<Result<Vec<_>>>()?;
        Ok(PipelineDslGeneratorStep {
            id: explicit_or_generated_node_id(object, "id", || self.next_generator_id())?,
            mode: PipelineDslGeneratorMode::Or,
            branches,
            stages: Vec::new(),
            pick: optional_object_field(object, "pick")?,
            arrange: optional_object_field(object, "arrange")?,
            then_pick: optional_object_field(object, "then_pick")?,
            then_arrange: optional_object_field(object, "then_arrange")?,
            count: optional_object_field(object, "count")?,
            constraints: compat_generator_constraints(object, path)?,
            tail: Vec::new(),
            metadata: compat_generator_metadata(object, key)?,
        })
    }

    fn lower_cartesian_generator(
        &mut self,
        object: &serde_json::Map<String, serde_json::Value>,
        path: &str,
    ) -> Result<PipelineDslGeneratorStep> {
        let values = object
            .get("_cartesian_")
            .and_then(serde_json::Value::as_array)
            .ok_or_else(|| {
                DagMlError::GraphValidation(format!("{path}._cartesian_ must be an array"))
            })?;
        let stages = values
            .iter()
            .enumerate()
            .map(|(index, value)| {
                self.lower_cartesian_stage(value, index, &format!("{path}._cartesian_[{index}]"))
            })
            .collect::<Result<Vec<_>>>()?;
        Ok(PipelineDslGeneratorStep {
            id: explicit_or_generated_node_id(object, "id", || self.next_generator_id())?,
            mode: PipelineDslGeneratorMode::Cartesian,
            branches: Vec::new(),
            stages,
            pick: None,
            arrange: None,
            then_pick: None,
            then_arrange: None,
            count: optional_object_field(object, "count")?,
            constraints: compat_generator_constraints(object, path)?,
            tail: Vec::new(),
            metadata: compat_generator_metadata(object, "_cartesian_")?,
        })
    }

    fn lower_cartesian_stage(
        &mut self,
        value: &serde_json::Value,
        index: usize,
        path: &str,
    ) -> Result<PipelineDslGeneratorStage> {
        if let Some(object) = value.as_object() {
            if object.contains_key("_or_") {
                let generator = self.lower_or_generator(object, "_or_", path)?;
                return Ok(PipelineDslGeneratorStage {
                    id: format!("stage{index}"),
                    selector: None,
                    metadata: BTreeMap::new(),
                    branches: generator.branches,
                });
            }
            if object.contains_key("_chain_") {
                let generator = self.lower_or_generator(object, "_chain_", path)?;
                return Ok(PipelineDslGeneratorStage {
                    id: format!("stage{index}"),
                    selector: None,
                    metadata: BTreeMap::new(),
                    branches: generator.branches,
                });
            }
            if object.contains_key("_grid_") {
                return Ok(PipelineDslGeneratorStage {
                    id: format!("stage{index}"),
                    selector: None,
                    metadata: BTreeMap::new(),
                    branches: self.lower_grid_branches(object.get("_grid_").unwrap(), path)?,
                });
            }
            if object.contains_key("_sample_") {
                let generator = self.lower_sample_generator(object, path)?;
                return Ok(PipelineDslGeneratorStage {
                    id: format!("stage{index}"),
                    selector: None,
                    metadata: BTreeMap::new(),
                    branches: generator.branches,
                });
            }
        }
        Ok(PipelineDslGeneratorStage {
            id: format!("stage{index}"),
            selector: None,
            metadata: BTreeMap::new(),
            branches: vec![PipelineDslBranch {
                id: "option0".to_string(),
                selector: None,
                metadata: BTreeMap::new(),
                steps: self.lower_pipeline_fragment(value, path)?,
            }],
        })
    }

    fn lower_grid_generator(
        &mut self,
        object: &serde_json::Map<String, serde_json::Value>,
        path: &str,
    ) -> Result<PipelineDslGeneratorStep> {
        Ok(PipelineDslGeneratorStep {
            id: explicit_or_generated_node_id(object, "id", || self.next_generator_id())?,
            mode: PipelineDslGeneratorMode::Or,
            branches: self.lower_grid_branches(object.get("_grid_").unwrap(), path)?,
            stages: Vec::new(),
            pick: None,
            arrange: None,
            then_pick: None,
            then_arrange: None,
            count: optional_object_field(object, "count")?,
            constraints: None,
            tail: Vec::new(),
            metadata: compat_generator_metadata(object, "_grid_")?,
        })
    }

    fn lower_sample_generator(
        &mut self,
        object: &serde_json::Map<String, serde_json::Value>,
        path: &str,
    ) -> Result<PipelineDslGeneratorStep> {
        Ok(PipelineDslGeneratorStep {
            id: explicit_or_generated_node_id(object, "id", || self.next_generator_id())?,
            mode: PipelineDslGeneratorMode::Or,
            branches: self.lower_sample_branches(object.get("_sample_").unwrap(), path)?,
            stages: Vec::new(),
            pick: None,
            arrange: None,
            then_pick: None,
            then_arrange: None,
            count: optional_object_field(object, "count")?,
            constraints: None,
            tail: Vec::new(),
            metadata: compat_generator_metadata(object, "_sample_")?,
        })
    }

    fn lower_sample_branches(
        &mut self,
        value: &serde_json::Value,
        path: &str,
    ) -> Result<Vec<PipelineDslBranch>> {
        let sample = value.as_object().ok_or_else(|| {
            DagMlError::GraphValidation(format!("{path}._sample_ must be an object"))
        })?;
        let rows = compat_sample_rows(sample, path)?;
        let operator = sample
            .get("model")
            .or_else(|| sample.get("tuner"))
            .or_else(|| sample.get("finetune"))
            .or_else(|| sample.get("preprocessing"))
            .or_else(|| sample.get("transform"))
            .ok_or_else(|| {
                DagMlError::GraphValidation(format!(
                    "{path}._sample_ structural lowering requires `model`, `tuner`, `preprocessing` or `transform`"
                ))
            })?
            .clone();
        let keyword = if sample.contains_key("model") {
            "model"
        } else if sample.contains_key("tuner") || sample.contains_key("finetune") {
            "tuner"
        } else {
            "preprocessing"
        };
        let fixed_params = sample
            .iter()
            .filter(|(key, _)| {
                !matches!(
                    key.as_str(),
                    "model"
                        | "tuner"
                        | "finetune"
                        | "preprocessing"
                        | "transform"
                        | "distribution"
                        | "from"
                        | "to"
                        | "num"
                        | "count"
                        | "param"
                        | "tune"
                )
            })
            .map(|(key, value)| (key.clone(), value.clone()))
            .collect::<BTreeMap<_, _>>();
        rows.into_iter()
            .enumerate()
            .map(|(index, mut row)| {
                row.extend(fixed_params.clone());
                let step = self.compat_operator_step_from_parts(
                    keyword,
                    operator.clone(),
                    row,
                    None,
                    None,
                )?;
                Ok(PipelineDslBranch {
                    id: format!("sample{index}"),
                    selector: None,
                    metadata: BTreeMap::new(),
                    steps: vec![if keyword == "model" {
                        PipelineDslStep::Model(step)
                    } else if keyword == "tuner" {
                        PipelineDslStep::Tuner(step)
                    } else {
                        PipelineDslStep::Transform(step)
                    }],
                })
            })
            .collect()
    }

    fn lower_grid_branches(
        &mut self,
        value: &serde_json::Value,
        path: &str,
    ) -> Result<Vec<PipelineDslBranch>> {
        let rows = compat_grid_rows(value, path)?;
        rows.into_iter()
            .enumerate()
            .map(|(index, row)| {
                let metadata = BTreeMap::from([(
                    "compat_grid_row".to_string(),
                    serde_json::to_value(&row).map_err(|error| {
                        DagMlError::GraphValidation(format!(
                            "failed to serialize grid row at {path}: {error}"
                        ))
                    })?,
                )]);
                Ok(PipelineDslBranch {
                    id: format!("grid{index}"),
                    selector: None,
                    metadata,
                    steps: self.lower_grid_row(row, path)?,
                })
            })
            .collect()
    }

    fn lower_grid_row(
        &mut self,
        mut row: BTreeMap<String, serde_json::Value>,
        path: &str,
    ) -> Result<Vec<PipelineDslStep>> {
        if let Some(operator) = row.remove("model") {
            return Ok(vec![PipelineDslStep::Model(
                self.compat_operator_step_from_parts("model", operator, row, None, None)?,
            )]);
        }
        if let Some(operator) = row.remove("tuner").or_else(|| row.remove("finetune")) {
            return Ok(vec![PipelineDslStep::Tuner(
                self.compat_operator_step_from_parts("tuner", operator, row, None, None)?,
            )]);
        }
        if let Some(operator) = row
            .remove("preprocessing")
            .or_else(|| row.remove("processing"))
            .or_else(|| row.remove("transform"))
        {
            return Ok(vec![PipelineDslStep::Transform(
                self.compat_operator_step_from_parts("preprocessing", operator, row, None, None)?,
            )]);
        }
        Err(DagMlError::GraphValidation(format!(
            "{path}._grid_ rows must contain `model`, `tuner`, `preprocessing` or `transform` for structural lowering"
        )))
    }

    fn lower_pipeline_fragment(
        &mut self,
        value: &serde_json::Value,
        path: &str,
    ) -> Result<Vec<PipelineDslStep>> {
        match value {
            serde_json::Value::Null => Ok(Vec::new()),
            serde_json::Value::Array(values) => self.lower_steps(values, path),
            _ => self.lower_value_as_steps(value, path),
        }
    }

    fn parse_attached_generation(
        &mut self,
        value: &serde_json::Value,
        path: &str,
    ) -> Result<Option<CompatGenerationAttachment>> {
        let Some(object) = value.as_object() else {
            return Ok(None);
        };
        if let Some(range) = object.get("_range_") {
            return Ok(Some(CompatGenerationAttachment {
                variants: Vec::new(),
                param_generators: vec![compat_range_generator(range, object, path)?],
            }));
        }
        if let Some(range) = object.get("_log_range_") {
            return Ok(Some(CompatGenerationAttachment {
                variants: Vec::new(),
                param_generators: vec![compat_log_range_generator(range, object, path)?],
            }));
        }
        if let Some(grid) = object.get("_grid_") {
            if grid.as_object().is_some_and(|grid| {
                !grid.contains_key("model")
                    && !grid.contains_key("preprocessing")
                    && !grid.contains_key("transform")
            }) {
                return Ok(Some(CompatGenerationAttachment {
                    variants: Vec::new(),
                    param_generators: vec![compat_grid_param_generator(grid, object, path)?],
                }));
            }
        }
        if let Some(zip) = object.get("_zip_") {
            return Ok(Some(CompatGenerationAttachment {
                variants: compat_zip_variants(zip, path)?,
                param_generators: Vec::new(),
            }));
        }
        if let Some(sample) = object.get("_sample_") {
            if sample.as_object().is_some_and(|sample| {
                sample.contains_key("model")
                    || sample.contains_key("tuner")
                    || sample.contains_key("finetune")
                    || sample.contains_key("preprocessing")
                    || sample.contains_key("transform")
            }) {
                return Ok(None);
            }
            return Ok(Some(CompatGenerationAttachment {
                variants: compat_sample_variants(sample, path)?,
                param_generators: Vec::new(),
            }));
        }
        Ok(None)
    }

    fn compat_operator_step(
        &mut self,
        object: Option<&serde_json::Map<String, serde_json::Value>>,
        keyword: &str,
        operator: &serde_json::Value,
        attachment: Option<CompatGenerationAttachment>,
        fallback_shape: Option<PipelineDslShapePlan>,
    ) -> Result<PipelineDslOperatorStep> {
        let id_prefix = compat_node_prefix(keyword);
        let mut params = object
            .and_then(|object| object_value_as_map(object.get("params")))
            .unwrap_or_default();
        if let Some(object) = object {
            for alias in compat_param_aliases(keyword) {
                if let Some(alias_params) = object_value_as_map(object.get(*alias)) {
                    params.extend(alias_params);
                }
            }
            for wrapper_key in compat_wrapper_param_keys(keyword) {
                if let Some(value) = object.get(*wrapper_key) {
                    params.insert((*wrapper_key).to_string(), value.clone());
                }
            }
        }
        let shape = match object.and_then(|object| object.get("shape")) {
            Some(shape) => Some(deserialize_value(
                shape.clone(),
                "pipeline DSL compat shape",
            )?),
            None => fallback_shape,
        };
        let mut step = PipelineDslOperatorStep {
            inner_cv: optional_object_field_from_option(object, "inner_cv")?,
            id: match object {
                Some(object) => {
                    explicit_or_generated_node_id(object, "id", || self.next_node_id(id_prefix))?
                }
                None => self.next_node_id(id_prefix)?,
            },
            operator: operator.clone(),
            params,
            metadata: optional_object_field_from_option(object, "metadata")?.unwrap_or_default(),
            seed_label: optional_object_field_from_option(object, "seed_label")?,
            representation: optional_object_field_from_option(object, "representation")?,
            train_params: optional_object_field_from_option(object, "train_params")?
                .unwrap_or_default(),
            tuning: optional_object_field_from_option(object, "tuning")?.or(
                optional_object_field_from_option(object, "finetune_params")?,
            ),
            variants: optional_object_field_from_option(object, "variants")?.unwrap_or_default(),
            param_generators: optional_object_field_from_option(object, "generators")?
                .unwrap_or_default(),
            shape,
        };
        step.metadata.insert(
            "dsl_compat_keyword".to_string(),
            serde_json::Value::String(keyword.to_string()),
        );
        if is_minimal_compat_operator_alias(object, operator) {
            step.metadata.insert(
                DSL_MINIMAL_OPERATOR_ALIAS.to_string(),
                serde_json::Value::Bool(true),
            );
        }
        if let Some(policy) = object.and_then(|object| object.get("policy")) {
            step.metadata
                .insert("dsl_compat_policy".to_string(), policy.clone());
        }
        if let Some(name) = object
            .and_then(|object| object.get("name"))
            .and_then(serde_json::Value::as_str)
        {
            step.metadata.insert(
                "dsl_name".to_string(),
                serde_json::Value::String(name.to_string()),
            );
        }
        if let Some(attachment) = attachment {
            step.variants.extend(attachment.variants);
            step.param_generators.extend(attachment.param_generators);
        }
        Ok(step)
    }

    fn compat_operator_step_from_parts(
        &mut self,
        keyword: &str,
        operator: serde_json::Value,
        params: BTreeMap<String, serde_json::Value>,
        attachment: Option<CompatGenerationAttachment>,
        shape: Option<PipelineDslShapePlan>,
    ) -> Result<PipelineDslOperatorStep> {
        let mut step = PipelineDslOperatorStep {
            inner_cv: None,
            id: self.next_node_id(compat_node_prefix(keyword))?,
            operator,
            params,
            metadata: BTreeMap::from([(
                "dsl_compat_keyword".to_string(),
                serde_json::Value::String(keyword.to_string()),
            )]),
            seed_label: None,
            representation: None,
            train_params: BTreeMap::new(),
            tuning: None,
            variants: Vec::new(),
            param_generators: Vec::new(),
            shape,
        };
        if let Some(attachment) = attachment {
            step.variants.extend(attachment.variants);
            step.param_generators.extend(attachment.param_generators);
        }
        Ok(step)
    }

    fn lower_split_invocation(
        &self,
        split: &serde_json::Value,
        object: &serde_json::Map<String, serde_json::Value>,
        path: &str,
    ) -> Result<SplitInvocation> {
        let mut params = BTreeMap::new();
        let mut id = object
            .get("id")
            .and_then(serde_json::Value::as_str)
            .unwrap_or("split:compat")
            .to_string();
        let mut controller_id = optional_object_field(object, "controller_id")?;
        let mut leakage_policy =
            optional_object_field(object, "leakage_policy")?.unwrap_or_default();
        let fold_set = optional_object_field(object, "fold_set")?;
        match split {
            serde_json::Value::String(kind) => {
                params.insert("kind".to_string(), serde_json::Value::String(kind.clone()));
                id = format!("split:{}", sanitize_generation_label(kind));
            }
            serde_json::Value::Object(split_object) => {
                if let Some(split_id) = split_object.get("id").and_then(serde_json::Value::as_str) {
                    id = split_id.to_string();
                }
                if controller_id.is_none() {
                    controller_id = optional_object_field(split_object, "controller_id")?;
                }
                if let Some(policy) = optional_object_field(split_object, "leakage_policy")? {
                    leakage_policy = policy;
                }
                if let Some(explicit_params) = object_value_as_map(split_object.get("params")) {
                    params.extend(explicit_params);
                }
                for (key, value) in split_object {
                    if !matches!(
                        key.as_str(),
                        "id" | "controller_id" | "leakage_policy" | "fold_set" | "params"
                    ) {
                        params.insert(key.clone(), value.clone());
                    }
                }
            }
            _ => {
                return Err(DagMlError::GraphValidation(format!(
                    "{path}.split must be a string or object"
                )));
            }
        }
        for (key, value) in object {
            if !matches!(
                key.as_str(),
                "split" | "id" | "controller_id" | "leakage_policy" | "fold_set" | "params"
            ) {
                params.entry(key.clone()).or_insert_with(|| value.clone());
            }
        }
        Ok(SplitInvocation {
            id,
            controller_id,
            leakage_policy,
            params,
            fold_set,
        })
    }

    fn lower_plain_split_invocation(
        &self,
        value: &serde_json::Value,
        path: &str,
    ) -> Result<SplitInvocation> {
        let mut params = BTreeMap::new();
        let id;
        let mut controller_id = None;
        let mut leakage_policy = LeakageUnitPolicy::default();
        let mut fold_set = None;
        if let Some(object) = value.as_object() {
            id = object
                .get("id")
                .and_then(serde_json::Value::as_str)
                .map(str::to_string)
                .unwrap_or_else(|| {
                    compat_plain_operator_ref(value)
                        .map(|reference| format!("split:{}", sanitize_generation_label(reference)))
                        .unwrap_or_else(|| "split:compat".to_string())
                });
            controller_id = optional_object_field(object, "controller_id")?;
            leakage_policy = optional_object_field(object, "leakage_policy")?.unwrap_or_default();
            fold_set = optional_object_field(object, "fold_set")?;
            if let Some(explicit_params) = object_value_as_map(object.get("params")) {
                params.extend(explicit_params);
            }
            for (key, item) in object {
                if !matches!(
                    key.as_str(),
                    "id" | "controller_id" | "leakage_policy" | "fold_set" | "params" | "name"
                ) {
                    params.insert(key.clone(), item.clone());
                }
            }
        } else if let Some(reference) = compat_plain_operator_ref(value) {
            id = format!("split:{}", sanitize_generation_label(reference));
            params.insert(
                "class".to_string(),
                serde_json::Value::String(reference.to_string()),
            );
        } else {
            return Err(DagMlError::GraphValidation(format!(
                "{path} is not a nirs4all-compatible splitter alias"
            )));
        }
        if let Some(reference) = compat_plain_operator_ref(value) {
            params
                .entry("class".to_string())
                .or_insert_with(|| serde_json::Value::String(reference.to_string()));
        }
        Ok(SplitInvocation {
            id,
            controller_id,
            leakage_policy,
            params,
            fold_set,
        })
    }

    fn set_split_invocation(&mut self, split: SplitInvocation, path: &str) -> Result<()> {
        let Some(existing) = self.split_invocation.as_mut() else {
            self.split_invocation = Some(split);
            return Ok(());
        };
        if existing.fold_set.is_some() && split.fold_set.is_some() {
            return Err(DagMlError::GraphValidation(format!(
                "{path} declares a second split with a fold_set; only one explicit fold_set can drive campaign OOF validation"
            )));
        }
        if existing.fold_set.is_none() {
            existing.fold_set = split.fold_set.clone();
        }
        let default_policy = LeakageUnitPolicy::default();
        if existing.leakage_policy == default_policy {
            existing.leakage_policy = split.leakage_policy.clone();
        } else if split.leakage_policy != default_policy
            && existing.leakage_policy != split.leakage_policy
        {
            return Err(DagMlError::GraphValidation(format!(
                "{path} declares split leakage_policy incompatible with the existing campaign split policy"
            )));
        }
        let first = split_invocation_chain_entry(existing)?;
        let second = split_invocation_chain_entry(&split)?;
        let mut chain = existing
            .params
            .remove("compat_split_chain")
            .and_then(|value| value.as_array().cloned())
            .unwrap_or_else(|| vec![first]);
        chain.push(second);
        existing.id = "split:compat.chain".to_string();
        existing.controller_id = None;
        existing.params.clear();
        existing.params.insert(
            "kind".to_string(),
            serde_json::Value::String("compat_split_chain".to_string()),
        );
        existing.params.insert(
            "compat_split_chain".to_string(),
            serde_json::Value::Array(chain),
        );
        Ok(())
    }

    fn next_node_id(&mut self, prefix: &str) -> Result<NodeId> {
        let id = NodeId::new(format!("{prefix}:compat.{}", self.node_counter))?;
        self.node_counter += 1;
        Ok(id)
    }

    fn next_generator_id(&mut self) -> Result<NodeId> {
        let id = NodeId::new(format!("generator:compat.{}", self.generator_counter))?;
        self.generator_counter += 1;
        Ok(id)
    }
}
