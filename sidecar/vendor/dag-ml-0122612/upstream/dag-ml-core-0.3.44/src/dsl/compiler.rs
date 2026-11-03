//! `PipelineCompiler` and the public compile entry points: lowering each step
//! into `NodeSpec`/`EdgeSpec`, building the campaign template, merge/branch
//! wiring, validation, and the port/data-source helpers.

use super::*;

pub fn compile_pipeline_dsl(spec: &PipelineDslSpec) -> Result<GraphSpec> {
    Ok(compile_pipeline_dsl_with_generation(spec)?.graph)
}
/// Opt-in: lower the spec's operator-level generators (Mechanism B's `PipelineDslStep::Generator`)
/// into one [`OperatorVariantModel`] each — an `active_subsequence`-only operator dimension plus the
/// exact per-choice active-node-id set.
///
/// This is a SEPARATE, additive derivation: it does not run or change
/// `compile_pipeline_dsl_with_generation`, the graph, the OOF lanes, `CompiledPipelineDsl.generation`,
/// or `search_space_fingerprint`. Existing specs (which never call this) compile byte-identically.
/// Returns an empty vec when the spec has no operator-level generators.
pub fn compile_operator_variant_models(
    spec: &PipelineDslSpec,
) -> Result<Vec<OperatorVariantModel>> {
    validate_pipeline_dsl(spec)?;
    let mut generators = Vec::new();
    collect_operator_generator_steps(&spec.steps, &mut generators)?;
    generators
        .iter()
        .map(lower_operator_variant_model)
        .collect()
}
pub fn compile_pipeline_dsl_with_controller_registry(
    spec: &PipelineDslSpec,
    registry: &ControllerRegistry,
) -> Result<GraphSpec> {
    Ok(compile_pipeline_dsl_with_generation_and_controller_registry(spec, registry)?.graph)
}
pub fn parse_pipeline_dsl_json(data: &[u8]) -> Result<PipelineDslSpec> {
    match serde_json::from_slice::<PipelineDslSpec>(data) {
        Ok(spec) if validate_pipeline_dsl(&spec).is_ok() => Ok(spec),
        Ok(spec) => {
            let strict_error = validate_pipeline_dsl(&spec)
                .err()
                .map(|error| error.to_string())
                .unwrap_or_else(|| "unknown validation error".to_string());
            let value = serde_json::from_slice::<serde_json::Value>(data).map_err(|error| {
                DagMlError::GraphValidation(format!("failed to parse pipeline DSL JSON: {error}"))
            })?;
            lower_nirs4all_compat_pipeline_dsl(&value).map_err(|compat_error| {
                DagMlError::GraphValidation(format!(
                    "failed to parse pipeline DSL as valid canonical PipelineDslSpec ({strict_error}) or nirs4all-compatible JSON ({compat_error})"
                ))
            })
        }
        Err(strict_error) => {
            let value = serde_json::from_slice::<serde_json::Value>(data).map_err(|error| {
                DagMlError::GraphValidation(format!("failed to parse pipeline DSL JSON: {error}"))
            })?;
            lower_nirs4all_compat_pipeline_dsl(&value).map_err(|compat_error| {
                DagMlError::GraphValidation(format!(
                    "failed to parse pipeline DSL as canonical PipelineDslSpec ({strict_error}) or nirs4all-compatible JSON ({compat_error})"
                ))
            })
        }
    }
}
pub fn lower_nirs4all_compat_pipeline_dsl(value: &serde_json::Value) -> Result<PipelineDslSpec> {
    CompatDslLowerer::default().lower_root(value)
}
pub fn resolve_pipeline_dsl_minimal_aliases(
    spec: &PipelineDslSpec,
    registry: &ControllerRegistry,
) -> Result<PipelineDslSpec> {
    let mut resolved = spec.clone();
    for step in &mut resolved.steps {
        resolve_step_minimal_aliases(step, registry)?;
    }
    validate_pipeline_dsl(&resolved)?;
    Ok(resolved)
}
pub fn compile_pipeline_dsl_with_generation_and_controller_registry(
    spec: &PipelineDslSpec,
    registry: &ControllerRegistry,
) -> Result<CompiledPipelineDsl> {
    let resolved = resolve_pipeline_dsl_minimal_aliases(spec, registry)?;
    compile_pipeline_dsl_with_generation(&resolved)
}
pub fn compile_pipeline_dsl_with_generation(spec: &PipelineDslSpec) -> Result<CompiledPipelineDsl> {
    validate_pipeline_dsl(spec)?;
    let input_representation = Some(spec.input.representation.clone());
    let external_data = DataSource {
        node_id: None,
        port_name: spec.input.name.clone(),
        representation: input_representation.clone(),
    };
    let mut compiler = PipelineCompiler {
        graph_id: spec.id.clone(),
        input_representation: input_representation.clone(),
        nodes: Vec::new(),
        edges: Vec::new(),
        generation_dimensions: Vec::new(),
        shape_plans: BTreeMap::new(),
        branch_view_plans: Vec::new(),
        named_interface_inputs: Vec::new(),
        consumes_default_input: false,
    };
    let mut sequence_state = SequenceCompileState::new(external_data.clone());

    for step in &spec.steps {
        compiler.compile_top_level_step(step, &external_data, &mut sequence_state)?;
    }

    let mut generation_dimensions =
        compile_explicit_generation_dimensions(&spec.generation_dimensions, &compiler.nodes)?;
    generation_dimensions.extend(compiler.generation_dimensions);
    let generation_constraints = compile_generation_constraints(
        spec.generation_constraints.as_ref(),
        &generation_dimensions,
    )?;
    let generation = build_generation_spec(
        spec.generation_strategy,
        spec.max_variants,
        generation_dimensions,
        generation_constraints,
    )?;
    let generation_fingerprint = if generation.strategy == GenerationStrategy::None {
        None
    } else {
        Some(generation_spec_fingerprint(&generation)?)
    };
    let mut interface_input = data_port(
        &spec.input.name,
        input_representation.clone(),
        &spec.input.description,
    );
    apply_data_unit_contract(&mut interface_input, &spec.input);
    let mut interface_inputs = Vec::new();
    if compiler.named_interface_inputs.is_empty() || compiler.consumes_default_input {
        interface_inputs.push(interface_input);
    }
    for (port, _) in compiler.named_interface_inputs {
        if interface_inputs.iter().any(|input| input.name == port.name) {
            return Err(DagMlError::GraphValidation(format!(
                "named model_input interface port `{}` collides with the default pipeline input",
                port.name
            )));
        }
        interface_inputs.push(port);
    }
    let mut interface_output = prediction_port(&spec.output.name, &spec.output.description);
    apply_prediction_unit_contract(&mut interface_output, &spec.output);

    let graph = GraphSpec {
        id: spec.id.clone(),
        interface: GraphInterface {
            inputs: interface_inputs,
            outputs: vec![interface_output],
        },
        nodes: compiler.nodes,
        edges: compiler.edges,
        search_space_fingerprint: generation_fingerprint.clone(),
        metadata: spec.metadata.clone(),
    };
    graph.validate()?;
    validate_shape_plan_targets(&compiler.shape_plans, &graph)?;
    let data_bindings = compile_data_bindings(&spec.data_bindings, &graph)?;
    let campaign_template = build_campaign_template(
        spec,
        &generation,
        &compiler.shape_plans,
        &data_bindings,
        &compiler.branch_view_plans,
    )?;
    Ok(CompiledPipelineDsl {
        graph,
        generation,
        shape_plans: compiler.shape_plans,
        data_bindings,
        branch_view_plans: compiler.branch_view_plans,
        campaign_template,
        generation_fingerprint,
    })
}
pub(crate) fn validate_pipeline_dsl(spec: &PipelineDslSpec) -> Result<()> {
    if spec.id.trim().is_empty() {
        return Err(DagMlError::GraphValidation(
            "pipeline DSL graph id must not be empty".to_string(),
        ));
    }
    if spec.input.name.trim().is_empty() {
        return Err(DagMlError::GraphValidation(
            "pipeline DSL input name must not be empty".to_string(),
        ));
    }
    if spec.input.representation.trim().is_empty() {
        return Err(DagMlError::GraphValidation(
            "pipeline DSL input representation must not be empty".to_string(),
        ));
    }
    if spec.output.name.trim().is_empty() {
        return Err(DagMlError::GraphValidation(
            "pipeline DSL output name must not be empty".to_string(),
        ));
    }
    if spec.steps.is_empty() {
        return Err(DagMlError::GraphValidation(
            "pipeline DSL must contain at least one step".to_string(),
        ));
    }
    Ok(())
}
pub(crate) struct PipelineCompiler {
    graph_id: String,
    input_representation: Option<String>,
    nodes: Vec<NodeSpec>,
    edges: Vec<EdgeSpec>,
    generation_dimensions: Vec<GenerationDimension>,
    shape_plans: BTreeMap<NodeId, DataModelShapePlan>,
    branch_view_plans: Vec<BranchViewPlan>,
    named_interface_inputs: Vec<(PortSpec, ModelInputPortSpec)>,
    consumes_default_input: bool,
}
#[derive(Clone, Debug)]
pub(crate) struct DataSource {
    node_id: Option<NodeId>,
    port_name: String,
    representation: Option<String>,
}
#[derive(Clone, Debug)]
pub(crate) struct PredictionSource {
    node_id: NodeId,
    port_name: String,
    input_name: String,
    branch_id: Option<String>,
}
#[derive(Clone, Debug)]
pub(crate) struct BranchDataSource {
    source: DataSource,
    input_name: String,
    branch_id: Option<String>,
}
#[derive(Clone, Debug, Default)]
pub(crate) struct BranchCompileOutput {
    predictions: Vec<PredictionSource>,
    data_sources: Vec<BranchDataSource>,
}
#[derive(Clone, Debug)]
pub(crate) struct SequenceCompileState {
    current_data: DataSource,
    current_target: Option<PortRef>,
    pending_predictions: Vec<PredictionSource>,
    pending_branch_data: Vec<BranchDataSource>,
}
impl SequenceCompileState {
    fn new(current_data: DataSource) -> Self {
        Self {
            current_data,
            current_target: None,
            pending_predictions: Vec::new(),
            pending_branch_data: Vec::new(),
        }
    }

    fn with_target(current_data: DataSource, current_target: Option<PortRef>) -> Self {
        Self {
            current_target,
            ..Self::new(current_data)
        }
    }

    fn clear_pending(&mut self) {
        self.pending_predictions.clear();
        self.pending_branch_data.clear();
    }
}
#[derive(Clone, Debug)]
pub(crate) enum MergeOutputSource {
    Data(DataSource),
    Prediction(PredictionSource),
}
impl PipelineCompiler {
    fn compile_top_level_step(
        &mut self,
        step: &PipelineDslStep,
        external_data: &DataSource,
        state: &mut SequenceCompileState,
    ) -> Result<()> {
        self.compile_sequence_step(step, external_data, state, None, BTreeMap::new())
    }

    fn compile_sequence_step(
        &mut self,
        step: &PipelineDslStep,
        original_data: &DataSource,
        state: &mut SequenceCompileState,
        branch_id: Option<&str>,
        extra_metadata: BTreeMap<String, serde_json::Value>,
    ) -> Result<()> {
        match step {
            PipelineDslStep::Transform(step) => {
                state.current_data = self.compile_data_operator_with_extra(
                    NodeKind::Transform,
                    step,
                    &state.current_data,
                    extra_metadata,
                )?;
                state.clear_pending();
                Ok(())
            }
            PipelineDslStep::YTransform(step) => {
                state.current_target = Some(self.compile_y_transform_with_extra(
                    step,
                    state.current_target.as_ref(),
                    extra_metadata,
                )?);
                state.clear_pending();
                Ok(())
            }
            PipelineDslStep::Tag(step) => {
                state.current_data = self.compile_data_operator_with_extra(
                    NodeKind::Tag,
                    step,
                    &state.current_data,
                    extra_metadata,
                )?;
                state.clear_pending();
                Ok(())
            }
            PipelineDslStep::Exclude(step) => {
                state.current_data = self.compile_data_operator_with_extra(
                    NodeKind::Exclude,
                    step,
                    &state.current_data,
                    extra_metadata,
                )?;
                state.clear_pending();
                Ok(())
            }
            PipelineDslStep::Filter(step) => {
                state.current_data = self.compile_filter_operator(
                    "filter",
                    step,
                    &state.current_data,
                    extra_metadata,
                )?;
                state.clear_pending();
                Ok(())
            }
            PipelineDslStep::SampleFilter(step) => {
                state.current_data = self.compile_filter_operator(
                    "sample",
                    step,
                    &state.current_data,
                    extra_metadata,
                )?;
                state.clear_pending();
                Ok(())
            }
            PipelineDslStep::Augmentation(step) => {
                state.current_data = self.compile_data_operator_with_extra(
                    NodeKind::Augmentation,
                    step,
                    &state.current_data,
                    extra_metadata,
                )?;
                state.clear_pending();
                Ok(())
            }
            PipelineDslStep::FeatureAugmentation(step) => {
                state.current_data = self.compile_augmentation_operator_with_extra(
                    "feature",
                    step,
                    &state.current_data,
                    extra_metadata,
                )?;
                state.clear_pending();
                Ok(())
            }
            PipelineDslStep::SampleAugmentation(step) => {
                state.current_data = self.compile_augmentation_operator_with_extra(
                    "sample",
                    step,
                    &state.current_data,
                    extra_metadata,
                )?;
                state.clear_pending();
                Ok(())
            }
            PipelineDslStep::DataGeneration(step) => {
                state.current_data = self.compile_data_generation_with_extra(
                    step,
                    &state.current_data,
                    extra_metadata,
                )?;
                state.clear_pending();
                Ok(())
            }
            PipelineDslStep::ConcatTransform(step) => {
                state.current_data = self.compile_concat_transform_with_extra(
                    step,
                    &state.current_data,
                    extra_metadata,
                )?;
                state.clear_pending();
                Ok(())
            }
            PipelineDslStep::Model(step) => {
                state
                    .pending_predictions
                    .push(self.compile_model_with_extra(
                        step,
                        &state.current_data,
                        state.current_target.as_ref(),
                        branch_id,
                        extra_metadata,
                    )?);
                Ok(())
            }
            PipelineDslStep::Tuner(step) => {
                state
                    .pending_predictions
                    .push(self.compile_tuner_with_extra(
                        step,
                        &state.current_data,
                        state.current_target.as_ref(),
                        branch_id,
                        extra_metadata,
                    )?);
                Ok(())
            }
            PipelineDslStep::Branch(step) => {
                let output = self.compile_branch_with_extra(
                    step,
                    &state.current_data,
                    state.current_target.as_ref(),
                    extra_metadata,
                )?;
                state.pending_predictions = output.predictions;
                state.pending_branch_data = output.data_sources;
                Ok(())
            }
            PipelineDslStep::Generator(step) => {
                state.pending_predictions = self.compile_generator_with_extra(
                    step,
                    &state.current_data,
                    state.current_target.as_ref(),
                    extra_metadata,
                )?;
                state.pending_branch_data.clear();
                Ok(())
            }
            PipelineDslStep::Sequential(step) => {
                self.compile_sequence_container(
                    step,
                    original_data,
                    state,
                    branch_id,
                    extra_metadata,
                )?;
                Ok(())
            }
            PipelineDslStep::Merge(step) => {
                match self.compile_merge_with_extra(
                    step,
                    &state.pending_predictions,
                    &state.pending_branch_data,
                    original_data,
                    extra_metadata,
                )? {
                    MergeOutputSource::Data(data) => {
                        state.current_data = data;
                        state.clear_pending();
                    }
                    MergeOutputSource::Prediction(prediction) => {
                        state.clear_pending();
                        state.pending_predictions.push(prediction);
                    }
                }
                Ok(())
            }
            PipelineDslStep::MergeModel(step) => {
                // A residual learner predicts from the same feature stream as
                // its base branch.  Ordinary stacking keeps its historical
                // `include_original_data` input instead.
                let data = if step.metadata.contains_key("residual_target_execution") {
                    &state.current_data
                } else {
                    original_data
                };
                let available = if step.sources.is_empty() {
                    state
                        .pending_predictions
                        .iter()
                        .map(|source| &source.node_id)
                        .collect::<BTreeSet<_>>()
                } else {
                    step.sources.iter().collect::<BTreeSet<_>>()
                };
                if step.source_ports.keys().any(|id| !available.contains(id)) {
                    return Err(DagMlError::GraphValidation(format!(
                        "pipeline DSL merge_model `{}` source_ports names an undeclared source",
                        step.id
                    )));
                }
                let predictions = if step.sources.is_empty() {
                    state.pending_predictions.iter().map(|pending| {
                        let mut source = pending.clone();
                        if let Some(requested_port) = step.source_ports.get(&source.node_id) {
                            let node = self.nodes.iter().find(|node| node.id == source.node_id)
                                .expect("pending prediction source is compiled");
                            if !node.ports.outputs.iter().any(|port| {
                                port.kind == PortKind::Prediction && port.name == *requested_port
                            }) {
                                return Err(DagMlError::GraphValidation(format!(
                                    "pipeline DSL merge_model `{}` source `{}` has no prediction output `{requested_port}`",
                                    step.id, source.node_id
                                )));
                            }
                            source.port_name = requested_port.clone();
                        }
                        Ok(source)
                    }).collect::<Result<Vec<_>>>()?
                } else {
                    if step.sources.iter().collect::<BTreeSet<_>>().len() != step.sources.len() {
                        return Err(DagMlError::GraphValidation(format!(
                            "pipeline DSL merge_model `{}` sources must be distinct",
                            step.id
                        )));
                    }
                    step.sources.iter().enumerate().map(|(index, source_id)| {
                        let source = self.nodes.iter().find(|node| node.id == *source_id)
                            .ok_or_else(|| DagMlError::GraphValidation(format!(
                                "pipeline DSL merge_model `{}` source `{source_id}` must precede it",
                                step.id
                            )))?;
                        let requested_port = step.source_ports.get(source_id);
                        let output = source.ports.outputs.iter().find(|port| {
                            port.kind == PortKind::Prediction
                                && requested_port.is_none_or(|requested| &port.name == requested)
                        })
                            .ok_or_else(|| DagMlError::GraphValidation(format!(
                                "pipeline DSL merge_model `{}` source `{source_id}` has no prediction output{}",
                                step.id,
                                requested_port.map_or_else(String::new, |port| format!(" `{port}`")),
                            )))?;
                        Ok(PredictionSource {
                            node_id: source_id.clone(),
                            port_name: output.name.clone(),
                            input_name: format!("source_{index}_oof"),
                            branch_id: source
                                .metadata
                                .get("dsl_branch")
                                .and_then(serde_json::Value::as_str)
                                .map(str::to_string),
                        })
                    }).collect::<Result<Vec<_>>>()?
                };
                let prediction =
                    self.compile_merge_model_with_extra(step, &predictions, data, extra_metadata)?;
                state.clear_pending();
                state.pending_predictions.push(prediction);
                Ok(())
            }
            PipelineDslStep::Chart(step) => {
                state.current_data = self.compile_data_operator_with_extra(
                    NodeKind::Chart,
                    step,
                    &state.current_data,
                    extra_metadata,
                )?;
                state.clear_pending();
                Ok(())
            }
        }
    }

    fn compile_sequence_container(
        &mut self,
        step: &PipelineDslSequenceStep,
        original_data: &DataSource,
        state: &mut SequenceCompileState,
        branch_id: Option<&str>,
        mut extra_metadata: BTreeMap<String, serde_json::Value>,
    ) -> Result<()> {
        if step.steps.is_empty() {
            return Err(DagMlError::GraphValidation(
                "pipeline DSL sequential step has no child steps".to_string(),
            ));
        }
        if let Some(sequence_id) = &step.id {
            extra_metadata.insert(
                "dsl_sequence".to_string(),
                serde_json::Value::String(sequence_id.to_string()),
            );
        }
        if !step.metadata.is_empty() {
            extra_metadata.insert(
                "dsl_sequence_metadata".to_string(),
                serde_json::to_value(&step.metadata).map_err(|error| {
                    DagMlError::GraphValidation(format!(
                        "failed to serialize pipeline DSL sequential metadata: {error}"
                    ))
                })?,
            );
        }
        for child in &step.steps {
            self.compile_sequence_step(
                child,
                original_data,
                state,
                branch_id,
                extra_metadata.clone(),
            )?;
        }
        Ok(())
    }

    fn compile_branch_with_extra(
        &mut self,
        step: &PipelineDslBranchStep,
        current_data: &DataSource,
        current_target: Option<&PortRef>,
        extra_metadata: BTreeMap<String, serde_json::Value>,
    ) -> Result<BranchCompileOutput> {
        if step.branches.is_empty() {
            return Err(DagMlError::GraphValidation(format!(
                "pipeline DSL graph `{}` has a branch step without branches",
                self.graph_id
            )));
        }
        let mut predictions = Vec::new();
        let mut data_sources = Vec::new();
        for (index, branch) in step.branches.iter().enumerate() {
            validate_branch_id(&branch.id)?;
            if branch.steps.is_empty() {
                return Err(DagMlError::GraphValidation(format!(
                    "pipeline DSL branch `{}` has no steps",
                    branch.id
                )));
            }
            let branch_view_plan = compile_branch_view_plan(step, branch)?;
            let mut branch_state =
                SequenceCompileState::with_target(current_data.clone(), current_target.cloned());
            let mut branch_metadata = branch_context_metadata(step, branch)?;
            if let Some(plan) = &branch_view_plan {
                branch_metadata.insert(
                    "dsl_branch_view_plan".to_string(),
                    serde_json::to_value(plan).map_err(|error| {
                        DagMlError::GraphValidation(format!(
                            "failed to serialize branch view plan for `{}`: {error}",
                            branch.id
                        ))
                    })?,
                );
            }
            for (key, value) in &extra_metadata {
                branch_metadata
                    .entry(key.clone())
                    .or_insert_with(|| value.clone());
            }
            for branch_step in &branch.steps {
                self.compile_sequence_step(
                    branch_step,
                    current_data,
                    &mut branch_state,
                    Some(&branch.id),
                    branch_metadata.clone(),
                )?;
            }
            if branch_state.pending_predictions.is_empty()
                && branch_state.pending_branch_data.is_empty()
                && same_data_source(&branch_state.current_data, current_data)
            {
                return Err(DagMlError::GraphValidation(format!(
                    "pipeline DSL branch `{}` must produce at least one model, merge prediction or transformed data output",
                    branch.id
                )));
            }
            if let Some(plan) = branch_view_plan {
                self.collect_branch_view_plan(plan)?;
            }
            let data_input_name = format!("{}_x", branch_input_prefix(&branch.id, index));
            data_sources.push(BranchDataSource {
                source: branch_state.current_data,
                input_name: data_input_name,
                branch_id: Some(branch.id.clone()),
            });
            data_sources.extend(branch_state.pending_branch_data);
            let prediction_count = branch_state.pending_predictions.len();
            for (prediction_index, prediction) in
                branch_state.pending_predictions.into_iter().enumerate()
            {
                let input_name = if prediction_count == 1 {
                    format!("{}_oof", branch_input_prefix(&branch.id, index))
                } else {
                    branch_prediction_input_name(
                        &branch.id,
                        index,
                        prediction_index,
                        &prediction.node_id,
                    )
                };
                predictions.push(PredictionSource {
                    input_name,
                    ..prediction
                });
            }
        }
        Ok(BranchCompileOutput {
            predictions,
            data_sources,
        })
    }

    fn compile_generator_with_extra(
        &mut self,
        step: &PipelineDslGeneratorStep,
        current_data: &DataSource,
        current_target: Option<&PortRef>,
        extra_metadata: BTreeMap<String, serde_json::Value>,
    ) -> Result<Vec<PredictionSource>> {
        let choices = expand_generator_sequences(step)?;
        if choices.is_empty() {
            return Err(DagMlError::GraphValidation(format!(
                "pipeline DSL generator `{}` produced no choices",
                step.id
            )));
        }
        let mut predictions = Vec::new();
        for (choice_index, choice) in choices.into_iter().enumerate() {
            let (choice, _minted_nodes) = namespace_generated_sequence(step, choice, choice_index)?;
            validate_branch_id(&choice.id)?;
            if choice.steps.is_empty() {
                return Err(DagMlError::GraphValidation(format!(
                    "pipeline DSL generator `{}` choice `{}` has no steps",
                    step.id, choice.id
                )));
            }
            let mut choice_state =
                SequenceCompileState::with_target(current_data.clone(), current_target.cloned());
            let mut choice_metadata = generator_choice_metadata(step, &choice)?;
            for (key, value) in &extra_metadata {
                choice_metadata
                    .entry(key.clone())
                    .or_insert_with(|| value.clone());
            }
            for choice_step in &choice.steps {
                self.compile_sequence_step(
                    choice_step,
                    current_data,
                    &mut choice_state,
                    Some(&choice.id),
                    choice_metadata.clone(),
                )?;
            }
            if choice_state.pending_predictions.is_empty() {
                return Err(DagMlError::GraphValidation(format!(
                    "pipeline DSL generator `{}` choice `{}` must produce at least one model or merge prediction",
                    step.id, choice.id
                )));
            }
            let prediction_count = choice_state.pending_predictions.len();
            for (prediction_index, prediction) in
                choice_state.pending_predictions.into_iter().enumerate()
            {
                let input_name = if prediction_count == 1 {
                    format!("{}_oof", branch_input_prefix(&choice.id, choice_index))
                } else {
                    branch_prediction_input_name(
                        &choice.id,
                        choice_index,
                        prediction_index,
                        &prediction.node_id,
                    )
                };
                predictions.push(PredictionSource {
                    input_name,
                    ..prediction
                });
            }
        }
        Ok(predictions)
    }

    fn compile_data_operator(
        &mut self,
        kind: NodeKind,
        step: &PipelineDslOperatorStep,
        input: &DataSource,
    ) -> Result<DataSource> {
        self.compile_data_operator_with_extra(kind, step, input, BTreeMap::new())
    }

    fn compile_filter_operator(
        &mut self,
        filter_kind: &str,
        step: &PipelineDslOperatorStep,
        input: &DataSource,
        mut extra: BTreeMap<String, serde_json::Value>,
    ) -> Result<DataSource> {
        extra.insert(
            "dsl_filter_kind".to_string(),
            serde_json::Value::String(filter_kind.to_string()),
        );
        self.compile_data_operator_with_extra(NodeKind::Exclude, step, input, extra)
    }

    fn compile_augmentation_operator_with_extra(
        &mut self,
        augmentation_kind: &str,
        step: &PipelineDslOperatorStep,
        input: &DataSource,
        mut extra: BTreeMap<String, serde_json::Value>,
    ) -> Result<DataSource> {
        extra.insert(
            "dsl_augmentation_kind".to_string(),
            serde_json::Value::String(augmentation_kind.to_string()),
        );
        self.compile_data_operator_with_extra(NodeKind::Augmentation, step, input, extra)
    }

    fn compile_data_generation_with_extra(
        &mut self,
        step: &PipelineDslOperatorStep,
        input: &DataSource,
        mut extra: BTreeMap<String, serde_json::Value>,
    ) -> Result<DataSource> {
        if step.shape.is_none() {
            return Err(DagMlError::GraphValidation(format!(
                "pipeline DSL data_generation `{}` requires a shape plan for leakage-safe runtime generation",
                step.id
            )));
        }
        extra.insert(
            "dsl_generation_kind".to_string(),
            serde_json::Value::String("data".to_string()),
        );
        self.compile_data_operator_with_extra(NodeKind::Generator, step, input, extra)
    }

    fn compile_data_operator_with_extra(
        &mut self,
        kind: NodeKind,
        step: &PipelineDslOperatorStep,
        input: &DataSource,
        extra_metadata: BTreeMap<String, serde_json::Value>,
    ) -> Result<DataSource> {
        if step.model_input.is_some() {
            return Err(DagMlError::GraphValidation(format!(
                "pipeline DSL data operator `{}` cannot declare model_input",
                step.id
            )));
        }
        if !step.prediction_output_ports.is_empty() {
            return Err(DagMlError::GraphValidation(format!(
                "pipeline DSL data operator `{}` cannot declare prediction output ports",
                step.id
            )));
        }
        if kind == NodeKind::Augmentation && step.shape.is_none() {
            return Err(DagMlError::GraphValidation(format!(
                "pipeline DSL augmentation `{}` requires a shape plan for leakage-safe scope validation",
                step.id
            )));
        }
        let representation = step
            .representation
            .clone()
            .or_else(|| input.representation.clone())
            .or_else(|| self.input_representation.clone());
        let mut metadata = operator_runtime_metadata(step, None)?;
        metadata.extend(extra_metadata);
        let node = NodeSpec {
            id: step.id.clone(),
            kind,
            operator: Some(step.operator.clone()),
            params: step.params.clone(),
            ports: PortSchema {
                inputs: vec![data_port("x", input.representation.clone(), "")],
                outputs: vec![data_port("x_out", representation.clone(), "")],
            },
            metadata,
            seed_label: step.seed_label.clone(),
        };
        self.push_node(node)?;
        self.collect_operator_generation(&step.id, &step.variants, &step.param_generators)?;
        self.collect_shape_plan(&step.id, step.shape.as_ref())?;
        self.connect_data(input, &step.id, "x")?;
        Ok(DataSource {
            node_id: Some(step.id.clone()),
            port_name: "x_out".to_string(),
            representation,
        })
    }

    fn compile_y_transform_with_extra(
        &mut self,
        step: &PipelineDslOperatorStep,
        input: Option<&PortRef>,
        extra_metadata: BTreeMap<String, serde_json::Value>,
    ) -> Result<PortRef> {
        if step.model_input.is_some() {
            return Err(DagMlError::GraphValidation(format!(
                "pipeline DSL target operator `{}` cannot declare model_input",
                step.id
            )));
        }
        let mut metadata = operator_runtime_metadata(step, None)?;
        metadata.extend(extra_metadata);
        let node = NodeSpec {
            id: step.id.clone(),
            kind: NodeKind::YTransform,
            operator: Some(step.operator.clone()),
            params: step.params.clone(),
            ports: PortSchema {
                inputs: vec![target_port("y", "")],
                outputs: vec![target_port("y_out", "")],
            },
            metadata,
            seed_label: step.seed_label.clone(),
        };
        self.push_node(node)?;
        self.collect_operator_generation(&step.id, &step.variants, &step.param_generators)?;
        self.collect_shape_plan(&step.id, step.shape.as_ref())?;
        self.connect_target(input, &step.id, "y")?;
        Ok(PortRef {
            node_id: step.id.clone(),
            port_name: "y_out".to_string(),
        })
    }

    fn compile_concat_transform_with_extra(
        &mut self,
        step: &PipelineDslConcatTransformStep,
        input: &DataSource,
        extra_metadata: BTreeMap<String, serde_json::Value>,
    ) -> Result<DataSource> {
        if step.branches.is_empty() {
            return Err(DagMlError::GraphValidation(format!(
                "pipeline DSL concat_transform `{}` has no branches",
                step.id
            )));
        }
        let representation = step
            .representation
            .clone()
            .or_else(|| input.representation.clone())
            .or_else(|| self.input_representation.clone());
        let mut branch_outputs = Vec::with_capacity(step.branches.len());
        for (index, branch) in step.branches.iter().enumerate() {
            validate_branch_id(&branch.id)?;
            let mut branch_data = input.clone();
            for branch_step in &branch.steps {
                branch_data =
                    self.compile_data_operator(NodeKind::Transform, branch_step, &branch_data)?;
            }
            let input_name = format!("{}_x", branch_input_prefix(&branch.id, index));
            branch_outputs.push((input_name, branch_data));
        }
        let node = NodeSpec {
            id: step.id.clone(),
            kind: NodeKind::FeatureJoin,
            operator: None,
            params: BTreeMap::new(),
            ports: PortSchema {
                inputs: branch_outputs
                    .iter()
                    .map(|(name, source)| data_port(name, source.representation.clone(), ""))
                    .collect(),
                outputs: vec![data_port("x_out", representation.clone(), "")],
            },
            metadata: {
                let mut metadata = step.metadata.clone();
                metadata.extend(extra_metadata);
                metadata
            },
            seed_label: step.seed_label.clone(),
        };
        self.push_node(node)?;
        self.collect_operator_generation(&step.id, &step.variants, &step.param_generators)?;
        self.collect_shape_plan(&step.id, step.shape.as_ref())?;
        for (input_name, source) in &branch_outputs {
            self.connect_data_to_port(source, &step.id, input_name)?;
        }
        Ok(DataSource {
            node_id: Some(step.id.clone()),
            port_name: "x_out".to_string(),
            representation,
        })
    }

    fn compile_model_with_extra(
        &mut self,
        step: &PipelineDslOperatorStep,
        input: &DataSource,
        target: Option<&PortRef>,
        branch_id: Option<&str>,
        extra_metadata: BTreeMap<String, serde_json::Value>,
    ) -> Result<PredictionSource> {
        self.compile_prediction_operator_with_extra(
            NodeKind::Model,
            step,
            input,
            target,
            branch_id,
            extra_metadata,
        )
    }

    fn compile_tuner_with_extra(
        &mut self,
        step: &PipelineDslOperatorStep,
        input: &DataSource,
        target: Option<&PortRef>,
        branch_id: Option<&str>,
        extra_metadata: BTreeMap<String, serde_json::Value>,
    ) -> Result<PredictionSource> {
        self.compile_prediction_operator_with_extra(
            NodeKind::Tuner,
            step,
            input,
            target,
            branch_id,
            extra_metadata,
        )
    }

    fn compile_prediction_operator_with_extra(
        &mut self,
        kind: NodeKind,
        step: &PipelineDslOperatorStep,
        input: &DataSource,
        target: Option<&PortRef>,
        branch_id: Option<&str>,
        extra_metadata: BTreeMap<String, serde_json::Value>,
    ) -> Result<PredictionSource> {
        let mut metadata = operator_runtime_metadata(step, branch_id)?;
        metadata.extend(extra_metadata);
        let inputs = if let Some(model_input) = &step.model_input {
            validate_named_model_input_spec(model_input)?;
            if input.node_id.is_some() {
                return Err(DagMlError::GraphValidation(format!(
                    "named model_input on `{}` requires external per-source bindings; an upstream X chain cannot be silently bypassed",
                    step.id
                )));
            }
            let declaration = serde_json::to_value(model_input).map_err(|error| {
                DagMlError::GraphValidation(format!(
                    "failed to serialize model_input for `{}`: {error}",
                    step.id
                ))
            })?;
            if metadata.contains_key(DSL_MODEL_INPUT_METADATA_KEY) {
                return Err(DagMlError::GraphValidation(format!(
                    "pipeline DSL `{}` metadata cannot override {DSL_MODEL_INPUT_METADATA_KEY}",
                    step.id
                )));
            }
            metadata.insert(DSL_MODEL_INPUT_METADATA_KEY.to_string(), declaration);
            let mut ports = Vec::with_capacity(model_input.ports.len() + 1);
            for requirement in &model_input.ports {
                let port = data_port(
                    &requirement.name,
                    Some(requirement.accepted_representations[0].clone()),
                    "",
                );
                if let Some((_, existing)) = self
                    .named_interface_inputs
                    .iter()
                    .find(|(input, _)| input.name == port.name)
                {
                    if existing != requirement {
                        return Err(DagMlError::GraphValidation(format!(
                            "named model_input interface port `{}` has conflicting source/type declarations",
                            port.name
                        )));
                    }
                } else {
                    self.named_interface_inputs
                        .push((port.clone(), requirement.clone()));
                }
                ports.push(port);
            }
            ports.push(target_port("y", ""));
            ports
        } else if target.is_some() {
            vec![
                data_port("x", input.representation.clone(), ""),
                target_port("y", ""),
            ]
        } else {
            vec![data_port("x", input.representation.clone(), "")]
        };
        if !step.prediction_output_ports.is_empty() {
            metadata.insert(
                "auxiliary_prediction_ports".to_string(),
                serde_json::to_value(&step.prediction_output_ports).expect("string port list"),
            );
        }
        let node = NodeSpec {
            id: step.id.clone(),
            kind,
            operator: Some(step.operator.clone()),
            params: step.params.clone(),
            ports: PortSchema {
                inputs,
                outputs: prediction_output_schema(&step.id, &step.prediction_output_ports)?,
            },
            metadata,
            seed_label: step.seed_label.clone(),
        };
        self.push_node(node)?;
        self.collect_operator_generation(&step.id, &step.variants, &step.param_generators)?;
        self.collect_shape_plan(&step.id, step.shape.as_ref())?;
        if step.model_input.is_none() {
            self.connect_data(input, &step.id, "x")?;
        }
        self.connect_target(target, &step.id, "y")?;
        Ok(PredictionSource {
            node_id: step.id.clone(),
            port_name: "oof".to_string(),
            input_name: "oof".to_string(),
            branch_id: branch_id.map(str::to_string),
        })
    }

    fn compile_merge_with_extra(
        &mut self,
        step: &PipelineDslMergeStep,
        predictions: &[PredictionSource],
        branch_data: &[BranchDataSource],
        original_data: &DataSource,
        extra_metadata: BTreeMap<String, serde_json::Value>,
    ) -> Result<MergeOutputSource> {
        let consumes_predictions = merge_consumes_predictions(step);
        let consumes_branch_data = merge_consumes_branch_data(step);
        let prediction_inputs = if consumes_predictions {
            predictions
        } else {
            &[]
        };
        let branch_data_inputs = if consumes_branch_data {
            branch_data
        } else {
            &[]
        };
        if prediction_inputs.is_empty()
            && branch_data_inputs.is_empty()
            && !step.include_original_data
        {
            return Err(DagMlError::GraphValidation(format!(
                "pipeline DSL merge `{}` has no pending predictions, branch data or original data input",
                step.id
            )));
        }
        validate_merge_selectors(&step.id, &step.selectors, prediction_inputs)?;
        let outputs_prediction = step.output_as == PipelineDslMergeOutput::Predictions;
        let representation = step
            .representation
            .clone()
            .or_else(|| original_data.representation.clone())
            .or_else(|| self.input_representation.clone());
        let mut input_ports =
            Vec::with_capacity(prediction_inputs.len() + branch_data_inputs.len() + 1);
        for prediction in prediction_inputs {
            input_ports.push(prediction_port(&prediction.input_name, ""));
        }
        for branch_source in branch_data_inputs {
            input_ports.push(data_port(
                &branch_source.input_name,
                branch_source.source.representation.clone(),
                "",
            ));
        }
        if step.include_original_data {
            input_ports.push(data_port(
                "x_original",
                original_data.representation.clone(),
                "",
            ));
        }
        let mut metadata = step.metadata.clone();
        metadata.insert(
            "merge_mode".to_string(),
            serde_json::Value::String(step.merge_mode.clone()),
        );
        metadata.insert(
            "output_as".to_string(),
            serde_json::to_value(step.output_as).map_err(|error| {
                DagMlError::GraphValidation(format!(
                    "failed to serialize pipeline DSL merge `{}` output mode: {error}",
                    step.id
                ))
            })?,
        );
        metadata.insert(
            "include_original_data".to_string(),
            serde_json::Value::Bool(step.include_original_data),
        );
        if let Some(on_missing) = &step.on_missing {
            metadata.insert(
                "on_missing".to_string(),
                serde_json::Value::String(on_missing.clone()),
            );
        }
        if !step.selectors.is_empty() {
            metadata.insert(
                "selectors".to_string(),
                serde_json::to_value(&step.selectors).map_err(|error| {
                    DagMlError::GraphValidation(format!(
                        "failed to serialize pipeline DSL merge `{}` selectors: {error}",
                        step.id
                    ))
                })?,
            );
        }
        if !branch_data_inputs.is_empty() {
            metadata.insert(
                "branch_data_inputs".to_string(),
                serde_json::to_value(
                    branch_data_inputs
                        .iter()
                        .map(|source| {
                            BTreeMap::from([
                                (
                                    "input_name".to_string(),
                                    serde_json::Value::String(source.input_name.clone()),
                                ),
                                (
                                    "branch".to_string(),
                                    source
                                        .branch_id
                                        .as_ref()
                                        .map(|branch| serde_json::Value::String(branch.clone()))
                                        .unwrap_or(serde_json::Value::Null),
                                ),
                            ])
                        })
                        .collect::<Vec<_>>(),
                )
                .map_err(|error| {
                    DagMlError::GraphValidation(format!(
                        "failed to serialize pipeline DSL merge `{}` branch data inputs: {error}",
                        step.id
                    ))
                })?,
            );
        }
        let branch_id = branch_id_from_metadata(&extra_metadata);
        metadata.extend(extra_metadata);
        let node = NodeSpec {
            id: step.id.clone(),
            kind: merge_node_kind(
                step,
                !prediction_inputs.is_empty(),
                !branch_data_inputs.is_empty(),
            ),
            operator: None,
            params: BTreeMap::new(),
            ports: PortSchema {
                inputs: input_ports,
                outputs: if outputs_prediction {
                    vec![prediction_port("prediction", "")]
                } else {
                    vec![data_port("x_out", representation.clone(), "")]
                },
            },
            metadata,
            seed_label: step.seed_label.clone(),
        };
        self.push_node(node)?;
        self.collect_operator_generation(&step.id, &step.variants, &step.param_generators)?;
        self.collect_shape_plan(&step.id, step.shape.as_ref())?;
        for prediction in prediction_inputs {
            self.edges.push(EdgeSpec {
                source: PortRef {
                    node_id: prediction.node_id.clone(),
                    port_name: prediction.port_name.clone(),
                },
                target: PortRef {
                    node_id: step.id.clone(),
                    port_name: prediction.input_name.clone(),
                },
                contract: EdgeContract {
                    requires_oof: true,
                    requires_fold_alignment: true,
                    ..EdgeContract::new(PortKind::Prediction, None)
                },
            });
        }
        for branch_source in branch_data_inputs {
            self.connect_data_to_port(&branch_source.source, &step.id, &branch_source.input_name)?;
        }
        if step.include_original_data {
            self.connect_data_to_port(original_data, &step.id, "x_original")?;
        }
        if outputs_prediction {
            Ok(MergeOutputSource::Prediction(PredictionSource {
                node_id: step.id.clone(),
                port_name: "prediction".to_string(),
                input_name: "oof".to_string(),
                branch_id,
            }))
        } else {
            Ok(MergeOutputSource::Data(DataSource {
                node_id: Some(step.id.clone()),
                port_name: "x_out".to_string(),
                representation,
            }))
        }
    }

    fn compile_merge_model_with_extra(
        &mut self,
        step: &PipelineDslMergeModelStep,
        predictions: &[PredictionSource],
        external_data: &DataSource,
        extra_metadata: BTreeMap<String, serde_json::Value>,
    ) -> Result<PredictionSource> {
        if predictions.is_empty() {
            return Err(DagMlError::GraphValidation(format!(
                "pipeline DSL merge_model `{}` has no pending branch predictions",
                step.id
            )));
        }
        validate_merge_selectors(&step.id, &step.selectors, predictions)?;
        for (index, selector) in step.selectors.iter().enumerate() {
            let global_candidate_selection = selector
                .select
                .as_ref()
                .and_then(|value| value.as_object())
                .is_some_and(|select| {
                    select.contains_key("fold_candidates_top_k")
                        || select.contains_key("diverse_fold_candidates")
                });
            if !matches!(
                selector.aggregate.as_deref(),
                None | Some("mean" | "weighted_mean" | "proba_mean")
            ) || (selector.branch.is_none()
                && selector.model.is_none()
                && !global_candidate_selection)
                || selector.input_name.is_some()
                || (selector.aggregate.is_some() && selector.branch.is_none())
            {
                return Err(DagMlError::GraphValidation(format!(
                    "pipeline DSL merge_model `{}` selector {index} requires a branch or model (except global fold candidate selection) and aggregate=mean/weighted_mean/proba_mean when present",
                    step.id
                )));
            }
        }
        let mut input_ports = Vec::with_capacity(predictions.len() + 1);
        for prediction in predictions {
            input_ports.push(prediction_port(&prediction.input_name, ""));
        }
        if step.include_original_data {
            input_ports.push(data_port(
                "x_original",
                external_data.representation.clone(),
                "",
            ));
        }
        let mut metadata = step.metadata.clone();
        insert_training_metadata(
            &mut metadata,
            &step.train_params,
            step.tuning.as_ref(),
            step.inner_cv.as_ref(),
            &step.id,
        )?;
        metadata.insert(
            "merge_mode".to_string(),
            serde_json::Value::String(step.merge_mode.clone()),
        );
        if !step.selectors.is_empty() {
            metadata.insert(
                "selectors".to_string(),
                serde_json::to_value(&step.selectors).map_err(|error| {
                    DagMlError::GraphValidation(format!(
                        "failed to serialize pipeline DSL merge_model `{}` selectors: {error}",
                        step.id
                    ))
                })?,
            );
        }
        if !step.sources.is_empty() {
            metadata.insert(
                "prediction_source_order".to_string(),
                serde_json::to_value(&step.sources).map_err(|error| {
                    DagMlError::GraphValidation(format!(
                        "failed to serialize pipeline DSL merge_model `{}` sources: {error}",
                        step.id
                    ))
                })?,
            );
        }
        if !step.source_ports.is_empty() {
            metadata.insert(
                "prediction_source_ports".to_string(),
                serde_json::to_value(&step.source_ports).expect("source port map"),
            );
        }
        let branch_id = branch_id_from_metadata(&extra_metadata);
        metadata.extend(extra_metadata);
        if !step.prediction_output_ports.is_empty() {
            metadata.insert(
                "auxiliary_prediction_ports".to_string(),
                serde_json::to_value(&step.prediction_output_ports).expect("string port list"),
            );
        }
        let node = NodeSpec {
            id: step.id.clone(),
            kind: NodeKind::Model,
            operator: Some(step.operator.clone()),
            params: step.params.clone(),
            ports: PortSchema {
                inputs: input_ports,
                outputs: prediction_output_schema(&step.id, &step.prediction_output_ports)?,
            },
            metadata,
            seed_label: step.seed_label.clone(),
        };
        self.push_node(node)?;
        self.collect_operator_generation(&step.id, &step.variants, &step.param_generators)?;
        self.collect_shape_plan(&step.id, step.shape.as_ref())?;
        for prediction in predictions {
            self.edges.push(EdgeSpec {
                source: PortRef {
                    node_id: prediction.node_id.clone(),
                    port_name: prediction.port_name.clone(),
                },
                target: PortRef {
                    node_id: step.id.clone(),
                    port_name: prediction.input_name.clone(),
                },
                contract: EdgeContract {
                    requires_oof: true,
                    requires_fold_alignment: true,
                    ..EdgeContract::new(PortKind::Prediction, None)
                },
            });
        }
        if step.include_original_data {
            self.connect_data_to_port(external_data, &step.id, "x_original")?;
        }
        let learner_prediction = PredictionSource {
            node_id: step.id.clone(),
            port_name: "oof".to_string(),
            input_name: "oof".to_string(),
            branch_id,
        };
        if step.metadata.contains_key("residual_target_execution") {
            if predictions.len() != 1 || !step.include_original_data {
                return Err(DagMlError::GraphValidation(format!(
                    "residual learner `{}` requires exactly one base prediction and original data",
                    step.id
                )));
            }
            let base = &predictions[0];
            let fusion_id = NodeId::new(format!("{}.residual_fusion", step.id))?;
            let mut fusion_metadata = BTreeMap::from([
                (
                    "merge_mode".to_string(),
                    serde_json::json!("residual_fusion"),
                ),
                (
                    "residual_fusion_for".to_string(),
                    serde_json::json!(step.id.as_str()),
                ),
                (
                    "residual_base".to_string(),
                    serde_json::json!(base.node_id.as_str()),
                ),
                (
                    "residual_learner".to_string(),
                    serde_json::json!(step.id.as_str()),
                ),
            ]);
            for key in ["residual_lambda", "residual_gate", "residual_rli_threshold"] {
                if let Some(value) = step.metadata.get(key) {
                    fusion_metadata.insert(key.to_string(), value.clone());
                }
            }
            self.push_node(NodeSpec {
                id: fusion_id.clone(),
                kind: NodeKind::PredictionJoin,
                operator: None,
                params: BTreeMap::new(),
                ports: PortSchema {
                    inputs: vec![prediction_port("base", ""), prediction_port("learner", "")],
                    outputs: vec![prediction_port("prediction", "")],
                },
                metadata: fusion_metadata,
                seed_label: None,
            })?;
            for (source, target_port) in [(base, "base"), (&learner_prediction, "learner")] {
                self.edges.push(EdgeSpec {
                    source: PortRef {
                        node_id: source.node_id.clone(),
                        port_name: source.port_name.clone(),
                    },
                    target: PortRef {
                        node_id: fusion_id.clone(),
                        port_name: target_port.to_string(),
                    },
                    contract: EdgeContract {
                        requires_oof: true,
                        requires_fold_alignment: true,
                        ..EdgeContract::new(PortKind::Prediction, None)
                    },
                });
            }
            return Ok(PredictionSource {
                node_id: fusion_id,
                port_name: "prediction".to_string(),
                input_name: "prediction".to_string(),
                branch_id: None,
            });
        }
        Ok(learner_prediction)
    }

    fn push_node(&mut self, node: NodeSpec) -> Result<()> {
        if self.nodes.iter().any(|existing| existing.id == node.id) {
            return Err(DagMlError::GraphValidation(format!(
                "pipeline DSL graph `{}` produced duplicate node `{}`",
                self.graph_id, node.id
            )));
        }
        self.nodes.push(node);
        Ok(())
    }

    fn collect_operator_generation(
        &mut self,
        node_id: &NodeId,
        choices: &[PipelineDslVariantChoice],
        generators: &[PipelineDslParamGenerator],
    ) -> Result<()> {
        if !choices.is_empty() {
            self.generation_dimensions
                .push(compile_variant_choice_dimension(node_id, choices)?);
        }
        for generator in generators {
            self.generation_dimensions
                .push(compile_param_generator_dimension(node_id, generator)?);
        }
        Ok(())
    }

    fn collect_shape_plan(
        &mut self,
        node_id: &NodeId,
        shape: Option<&PipelineDslShapePlan>,
    ) -> Result<()> {
        let Some(shape) = shape else {
            return Ok(());
        };
        let plan = shape.to_data_model_shape_plan(node_id)?;
        if self.shape_plans.insert(node_id.clone(), plan).is_some() {
            return Err(DagMlError::GraphValidation(format!(
                "pipeline DSL graph `{}` produced duplicate shape plan for `{node_id}`",
                self.graph_id
            )));
        }
        Ok(())
    }

    fn collect_branch_view_plan(&mut self, plan: BranchViewPlan) -> Result<()> {
        plan.validate()
            .map_err(|error| DagMlError::GraphValidation(error.to_string()))?;
        if self
            .branch_view_plans
            .iter()
            .any(|existing| existing.view_id == plan.view_id)
        {
            return Err(DagMlError::GraphValidation(format!(
                "pipeline DSL graph `{}` produced duplicate branch view `{}`",
                self.graph_id, plan.view_id
            )));
        }
        self.branch_view_plans.push(plan);
        Ok(())
    }

    fn connect_data(
        &mut self,
        input: &DataSource,
        target_id: &NodeId,
        target_port: &str,
    ) -> Result<()> {
        self.connect_data_to_port(input, target_id, target_port)
    }

    fn connect_data_to_port(
        &mut self,
        input: &DataSource,
        target_id: &NodeId,
        target_port: &str,
    ) -> Result<()> {
        if let Some(source_id) = &input.node_id {
            self.edges.push(EdgeSpec {
                source: PortRef {
                    node_id: source_id.clone(),
                    port_name: input.port_name.clone(),
                },
                target: PortRef {
                    node_id: target_id.clone(),
                    port_name: target_port.to_string(),
                },
                contract: EdgeContract {
                    requires_oof: false,
                    requires_fold_alignment: true,
                    ..EdgeContract::new(PortKind::Data, input.representation.clone())
                },
            });
        } else {
            self.consumes_default_input = true;
        }
        Ok(())
    }

    fn connect_target(
        &mut self,
        input: Option<&PortRef>,
        target_id: &NodeId,
        target_port: &str,
    ) -> Result<()> {
        if let Some(source) = input {
            self.edges.push(EdgeSpec {
                source: source.clone(),
                target: PortRef {
                    node_id: target_id.clone(),
                    port_name: target_port.to_string(),
                },
                contract: EdgeContract {
                    requires_fold_alignment: true,
                    ..EdgeContract::new(PortKind::Target, None)
                },
            });
        }
        Ok(())
    }
}
impl PipelineDslShapePlan {
    fn to_data_model_shape_plan(&self, node_id: &NodeId) -> Result<DataModelShapePlan> {
        let plan = DataModelShapePlan {
            node_id: node_id.clone(),
            input_granularity: self.input_granularity.unwrap_or(Granularity::Sample),
            target_granularity: self.target_granularity.unwrap_or(Granularity::Sample),
            fit_rows: self.fit_rows.unwrap_or(FitBoundary::FoldTrain),
            predict_rows: self.predict_rows.unwrap_or(FitBoundary::FoldValidation),
            feature_namespace: self.feature_namespace.clone(),
            feature_schema_fingerprint: self.feature_schema_fingerprint.clone(),
            target_space: self
                .target_space
                .clone()
                .unwrap_or_else(|| "raw".to_string()),
            aggregation_policy: self.aggregation_policy.clone().unwrap_or_default(),
            augmentation_policy: self.augmentation_policy.clone().unwrap_or_default(),
            selection_policy: self.selection_policy.clone().unwrap_or_default(),
        };
        plan.validate()?;
        Ok(plan)
    }
}
pub(crate) fn validate_shape_plan_targets(
    shape_plans: &BTreeMap<NodeId, DataModelShapePlan>,
    graph: &GraphSpec,
) -> Result<()> {
    for (node_id, plan) in shape_plans {
        if node_id != &plan.node_id {
            return Err(DagMlError::GraphValidation(format!(
                "pipeline DSL shape plan key `{node_id}` does not match node_id `{}`",
                plan.node_id
            )));
        }
        if !graph.nodes.iter().any(|node| &node.id == node_id) {
            return Err(DagMlError::GraphValidation(format!(
                "pipeline DSL shape plan references unknown node `{node_id}`"
            )));
        }
    }
    Ok(())
}
pub(crate) fn build_campaign_template(
    spec: &PipelineDslSpec,
    generation: &GenerationSpec,
    shape_plans: &BTreeMap<NodeId, DataModelShapePlan>,
    data_bindings: &BTreeMap<NodeId, Vec<DataBinding>>,
    branch_view_plans: &[BranchViewPlan],
) -> Result<CampaignSpec> {
    let campaign = CampaignSpec {
        inner_cv: spec.inner_cv.clone(),
        id: spec
            .campaign_id
            .clone()
            .unwrap_or_else(|| format!("campaign:{}", spec.id)),
        root_seed: spec.root_seed,
        leakage_policy: spec.leakage_policy.clone().unwrap_or_default(),
        aggregation_policy: spec.aggregation_policy.clone().unwrap_or_default(),
        split_invocation: spec.split_invocation.clone(),
        generation: generation.clone(),
        shape_plans: shape_plans.clone(),
        data_bindings: data_bindings.clone(),
        branch_view_plans: branch_view_plans.to_vec(),
        metadata: spec.campaign_metadata.clone(),
    };
    campaign.validate()?;
    Ok(campaign)
}
pub(crate) fn compile_data_bindings(
    bindings: &[DataBinding],
    graph: &GraphSpec,
) -> Result<BTreeMap<NodeId, Vec<DataBinding>>> {
    let mut by_node = BTreeMap::<NodeId, Vec<DataBinding>>::new();
    for binding in bindings {
        validate_dsl_data_binding(binding, graph)?;
        by_node
            .entry(binding.node_id.clone())
            .or_default()
            .push(binding.clone());
    }
    Ok(by_node)
}
pub(crate) fn validate_dsl_data_binding(binding: &DataBinding, graph: &GraphSpec) -> Result<()> {
    binding.validate()?;
    let node = graph
        .nodes
        .iter()
        .find(|node| node.id == binding.node_id)
        .ok_or_else(|| {
            DagMlError::GraphValidation(format!(
                "pipeline DSL data binding references unknown node `{}`",
                binding.node_id
            ))
        })?;
    let Some(input_port) = node
        .ports
        .inputs
        .iter()
        .find(|port| port.name == binding.input_name)
    else {
        return Err(DagMlError::GraphValidation(format!(
            "pipeline DSL data binding `{}` references unknown input port `{}` on node `{}`",
            binding.request_id, binding.input_name, binding.node_id
        )));
    };
    if input_port.kind != PortKind::Data {
        return Err(DagMlError::GraphValidation(format!(
            "pipeline DSL data binding `{}` targets non-data input `{}.{}`",
            binding.request_id, binding.node_id, binding.input_name
        )));
    }
    Ok(())
}
pub(crate) fn operator_runtime_metadata(
    step: &PipelineDslOperatorStep,
    branch_id: Option<&str>,
) -> Result<BTreeMap<String, serde_json::Value>> {
    let mut metadata = step.metadata.clone();
    if let Some(branch_id) = branch_id {
        metadata.insert(
            "dsl_branch".to_string(),
            serde_json::Value::String(branch_id.to_string()),
        );
    }
    insert_training_metadata(
        &mut metadata,
        &step.train_params,
        step.tuning.as_ref(),
        step.inner_cv.as_ref(),
        &step.id,
    )?;
    Ok(metadata)
}
pub(crate) fn branch_context_metadata(
    branch_step: &PipelineDslBranchStep,
    branch: &PipelineDslBranch,
) -> Result<BTreeMap<String, serde_json::Value>> {
    let mut metadata = BTreeMap::new();
    metadata.insert(
        "dsl_branch".to_string(),
        serde_json::Value::String(branch.id.clone()),
    );
    metadata.insert(
        "dsl_branch_mode".to_string(),
        serde_json::to_value(branch_step.mode).map_err(|error| {
            DagMlError::GraphValidation(format!(
                "failed to serialize pipeline DSL branch mode for `{}`: {error}",
                branch.id
            ))
        })?,
    );
    if let Some(selector) = &branch_step.selector {
        metadata.insert("dsl_branch_step_selector".to_string(), selector.clone());
    }
    if !branch_step.metadata.is_empty() {
        metadata.insert(
            "dsl_branch_step_metadata".to_string(),
            serde_json::to_value(&branch_step.metadata).map_err(|error| {
                DagMlError::GraphValidation(format!(
                    "failed to serialize pipeline DSL branch step metadata for `{}`: {error}",
                    branch.id
                ))
            })?,
        );
    }
    if let Some(selector) = &branch.selector {
        metadata.insert("dsl_branch_selector".to_string(), selector.clone());
    }
    if !branch.metadata.is_empty() {
        metadata.insert(
            "dsl_branch_metadata".to_string(),
            serde_json::to_value(&branch.metadata).map_err(|error| {
                DagMlError::GraphValidation(format!(
                    "failed to serialize pipeline DSL branch metadata for `{}`: {error}",
                    branch.id
                ))
            })?,
        );
    }
    Ok(metadata)
}
pub(crate) fn compile_branch_view_plan(
    branch_step: &PipelineDslBranchStep,
    branch: &PipelineDslBranch,
) -> Result<Option<BranchViewPlan>> {
    let Some(mode) = branch_view_mode(branch_step.mode) else {
        return Ok(None);
    };
    let selector = branch_view_selector(mode, branch_step.selector.as_ref(), branch)?;
    let mut metadata = branch.metadata.clone();
    if let Some(step_selector) = &branch_step.selector {
        metadata.insert(
            "dsl_branch_step_selector".to_string(),
            step_selector.clone(),
        );
    }
    if let Some(branch_selector) = &branch.selector {
        metadata.insert("dsl_branch_selector".to_string(), branch_selector.clone());
    }
    if !branch_step.metadata.is_empty() {
        metadata.insert(
            "dsl_branch_step_metadata".to_string(),
            serde_json::to_value(&branch_step.metadata).map_err(|error| {
                DagMlError::GraphValidation(format!(
                    "failed to serialize pipeline DSL branch step metadata for `{}`: {error}",
                    branch.id
                ))
            })?,
        );
    }
    let plan = BranchViewPlan {
        view_id: format!("branch_view:{}", branch.id),
        branch_id: branch.id.clone(),
        mode,
        selector,
        allow_overlap: branch_overlap_allowed(branch_step, branch),
        metadata,
    };
    plan.validate()
        .map_err(|error| DagMlError::GraphValidation(error.to_string()))?;
    Ok(Some(plan))
}
pub(crate) fn branch_view_mode(mode: PipelineDslBranchMode) -> Option<BranchViewMode> {
    match mode {
        PipelineDslBranchMode::Duplication => None,
        PipelineDslBranchMode::Separation => Some(BranchViewMode::Separation),
        PipelineDslBranchMode::BySource => Some(BranchViewMode::BySource),
        PipelineDslBranchMode::ByMetadata => Some(BranchViewMode::ByMetadata),
        PipelineDslBranchMode::ByTag => Some(BranchViewMode::ByTag),
        PipelineDslBranchMode::ByFilter => Some(BranchViewMode::ByFilter),
    }
}
pub(crate) fn branch_view_selector(
    mode: BranchViewMode,
    step_selector: Option<&serde_json::Value>,
    branch: &PipelineDslBranch,
) -> Result<DataViewSelector> {
    match mode {
        BranchViewMode::BySource => branch_view_selector_by_source(branch),
        BranchViewMode::ByMetadata => branch_view_selector_by_metadata(step_selector, branch),
        BranchViewMode::ByTag => branch_view_selector_by_tag(branch),
        BranchViewMode::ByFilter => branch_view_selector_by_filter(branch),
        BranchViewMode::Separation => branch_view_selector_generic(step_selector, branch),
    }
}
pub(crate) fn branch_view_selector_by_source(
    branch: &PipelineDslBranch,
) -> Result<DataViewSelector> {
    let Some(selector) = &branch.selector else {
        return Err(DagMlError::GraphValidation(format!(
            "pipeline DSL by_source branch `{}` requires a selector",
            branch.id
        )));
    };
    let source_ids = selector_strings(selector, &["source", "source_id"], &["sources", "source_ids"])
        .or_else(|| selector.as_str().map(|value| vec![value.to_string()]))
        .ok_or_else(|| {
            DagMlError::GraphValidation(format!(
                "pipeline DSL by_source branch `{}` selector must be a source string or object with source/source_ids",
                branch.id
            ))
        })?;
    Ok(DataViewSelector {
        source_ids,
        ..DataViewSelector::default()
    })
}
pub(crate) fn branch_view_selector_by_metadata(
    step_selector: Option<&serde_json::Value>,
    branch: &PipelineDslBranch,
) -> Result<DataViewSelector> {
    let Some(selector) = &branch.selector else {
        return Err(DagMlError::GraphValidation(format!(
            "pipeline DSL by_metadata branch `{}` requires a selector",
            branch.id
        )));
    };
    if let Some(metadata) = selector_metadata_map(selector)? {
        return Ok(DataViewSelector {
            metadata,
            ..DataViewSelector::default()
        });
    }
    let branch_key = selector
        .as_object()
        .and_then(|_| selector_metadata_key(selector));
    let key = branch_key
        .or_else(|| step_selector.and_then(selector_metadata_key))
        .ok_or_else(|| {
            DagMlError::GraphValidation(format!(
                "pipeline DSL by_metadata branch `{}` requires a metadata key on the branch or branch step selector",
                branch.id
            ))
        })?;
    let value = selector_value(selector).ok_or_else(|| {
        DagMlError::GraphValidation(format!(
            "pipeline DSL by_metadata branch `{}` requires a metadata value",
            branch.id
        ))
    })?;
    Ok(DataViewSelector {
        metadata: BTreeMap::from([(key, value)]),
        ..DataViewSelector::default()
    })
}
pub(crate) fn branch_view_selector_by_tag(branch: &PipelineDslBranch) -> Result<DataViewSelector> {
    let Some(selector) = &branch.selector else {
        return Err(DagMlError::GraphValidation(format!(
            "pipeline DSL by_tag branch `{}` requires a selector",
            branch.id
        )));
    };
    let tags = selector_strings(selector, &["tag"], &["tags"])
        .or_else(|| selector.as_str().map(|value| vec![value.to_string()]))
        .ok_or_else(|| {
            DagMlError::GraphValidation(format!(
                "pipeline DSL by_tag branch `{}` selector must be a tag string or object with tag/tags",
                branch.id
            ))
        })?;
    Ok(DataViewSelector {
        tags,
        ..DataViewSelector::default()
    })
}
pub(crate) fn branch_view_selector_by_filter(
    branch: &PipelineDslBranch,
) -> Result<DataViewSelector> {
    let Some(selector) = &branch.selector else {
        return Err(DagMlError::GraphValidation(format!(
            "pipeline DSL by_filter branch `{}` requires a selector",
            branch.id
        )));
    };
    let filter = selector
        .as_object()
        .and_then(|object| object.get("filter").cloned())
        .unwrap_or_else(|| selector.clone());
    Ok(DataViewSelector {
        filter: Some(filter),
        ..DataViewSelector::default()
    })
}
pub(crate) fn branch_view_selector_generic(
    step_selector: Option<&serde_json::Value>,
    branch: &PipelineDslBranch,
) -> Result<DataViewSelector> {
    let Some(selector) = &branch.selector else {
        return Err(DagMlError::GraphValidation(format!(
            "pipeline DSL separation branch `{}` requires a selector",
            branch.id
        )));
    };
    if selector_strings(
        selector,
        &["source", "source_id"],
        &["sources", "source_ids"],
    )
    .is_some()
        || selector
            .as_object()
            .is_some_and(|object| object.contains_key("source") || object.contains_key("sources"))
    {
        return branch_view_selector_by_source(branch);
    }
    if selector_metadata_map(selector)?.is_some()
        || selector
            .as_object()
            .and_then(|_| selector_metadata_key(selector))
            .is_some()
        || step_selector.and_then(selector_metadata_key).is_some()
    {
        return branch_view_selector_by_metadata(step_selector, branch);
    }
    if selector_strings(selector, &["tag"], &["tags"]).is_some() {
        return branch_view_selector_by_tag(branch);
    }
    if selector
        .as_object()
        .is_some_and(|object| object.contains_key("filter"))
    {
        return branch_view_selector_by_filter(branch);
    }
    Err(DagMlError::GraphValidation(format!(
        "pipeline DSL separation branch `{}` selector must declare source_ids, metadata, tags or filter",
        branch.id
    )))
}
pub(crate) fn selector_strings(
    value: &serde_json::Value,
    singular_keys: &[&str],
    plural_keys: &[&str],
) -> Option<Vec<String>> {
    let object = value.as_object()?;
    for key in singular_keys {
        if let Some(text) = object.get(*key).and_then(serde_json::Value::as_str) {
            return Some(vec![text.to_string()]);
        }
    }
    for key in plural_keys {
        if let Some(values) = object.get(*key).and_then(serde_json::Value::as_array) {
            let parsed = values
                .iter()
                .filter_map(serde_json::Value::as_str)
                .map(str::to_string)
                .collect::<Vec<_>>();
            if parsed.len() == values.len() {
                return Some(parsed);
            }
        }
    }
    None
}
pub(crate) fn selector_metadata_map(
    value: &serde_json::Value,
) -> Result<Option<BTreeMap<String, serde_json::Value>>> {
    let Some(object) = value.as_object() else {
        return Ok(None);
    };
    let Some(metadata) = object.get("metadata") else {
        return Ok(None);
    };
    let Some(metadata) = metadata.as_object() else {
        return Err(DagMlError::GraphValidation(
            "pipeline DSL branch metadata selector must be an object".to_string(),
        ));
    };
    Ok(Some(
        metadata
            .iter()
            .map(|(key, value)| (key.clone(), value.clone()))
            .collect(),
    ))
}
pub(crate) fn selector_metadata_key(value: &serde_json::Value) -> Option<String> {
    if let Some(text) = value.as_str() {
        return Some(text.to_string());
    }
    let object = value.as_object()?;
    ["metadata_key", "column", "key", "by_metadata"]
        .into_iter()
        .find_map(|key| object.get(key).and_then(serde_json::Value::as_str))
        .map(str::to_string)
}
pub(crate) fn selector_value(value: &serde_json::Value) -> Option<serde_json::Value> {
    match value {
        serde_json::Value::String(_)
        | serde_json::Value::Bool(_)
        | serde_json::Value::Number(_) => Some(value.clone()),
        serde_json::Value::Object(object) => object
            .get("value")
            .or_else(|| object.get("equals"))
            .cloned(),
        _ => None,
    }
}
pub(crate) fn branch_overlap_allowed(
    branch_step: &PipelineDslBranchStep,
    branch: &PipelineDslBranch,
) -> bool {
    branch
        .metadata
        .get("allow_overlap")
        .or_else(|| branch_step.metadata.get("allow_overlap"))
        .and_then(serde_json::Value::as_bool)
        .unwrap_or(false)
}
pub(crate) fn branch_id_from_metadata(
    metadata: &BTreeMap<String, serde_json::Value>,
) -> Option<String> {
    metadata
        .get("dsl_branch")
        .and_then(|value| value.as_str())
        .map(str::to_string)
}
pub(crate) fn rewrite_merge_selectors(
    selectors: &mut [PipelineDslMergeSelector],
    node_map: &BTreeMap<NodeId, NodeId>,
) {
    for selector in selectors {
        if let Some(model) = &selector.model {
            if let Some(rewritten) = node_map.get(model) {
                selector.model = Some(rewritten.clone());
            }
        }
    }
}
pub(crate) fn validate_merge_selectors(
    merge_id: &NodeId,
    selectors: &[PipelineDslMergeSelector],
    predictions: &[PredictionSource],
) -> Result<()> {
    if selectors.is_empty() {
        return Ok(());
    }
    if predictions.is_empty() {
        return Err(DagMlError::GraphValidation(format!(
            "pipeline DSL merge `{merge_id}` declares selectors but has no prediction inputs"
        )));
    }
    for (selector_index, selector) in selectors.iter().enumerate() {
        let mut matched = predictions.iter().collect::<Vec<_>>();
        if let Some(input_name) = &selector.input_name {
            if input_name.trim().is_empty() {
                return Err(DagMlError::GraphValidation(format!(
                    "pipeline DSL merge `{merge_id}` selector {selector_index} has an empty input_name"
                )));
            }
            matched.retain(|prediction| prediction.input_name == *input_name);
        }
        if let Some(branch) = &selector.branch {
            if branch.trim().is_empty() {
                return Err(DagMlError::GraphValidation(format!(
                    "pipeline DSL merge `{merge_id}` selector {selector_index} has an empty branch"
                )));
            }
            matched.retain(|prediction| prediction.branch_id.as_deref() == Some(branch.as_str()));
        }
        if let Some(model) = &selector.model {
            matched.retain(|prediction| prediction.node_id == *model);
        }
        if matched.is_empty() {
            return Err(DagMlError::GraphValidation(format!(
                "pipeline DSL merge `{merge_id}` selector {selector_index} does not match any pending prediction input"
            )));
        }
        validate_merge_selector_select(merge_id, selector_index, selector, &matched)?;
    }
    Ok(())
}
pub(crate) fn validate_merge_selector_select(
    merge_id: &NodeId,
    selector_index: usize,
    selector: &PipelineDslMergeSelector,
    matched: &[&PredictionSource],
) -> Result<()> {
    let Some(select) = &selector.select else {
        return Ok(());
    };
    if let Some(mode) = select.as_str() {
        match mode {
            "all" => return Ok(()),
            "best" => {
                require_selector_metric(merge_id, selector_index, selector, mode)?;
                return Ok(());
            }
            _ => {
                return Err(DagMlError::GraphValidation(format!(
                    "pipeline DSL merge `{merge_id}` selector {selector_index} has unsupported select mode `{mode}`"
                )));
            }
        }
    }
    let Some(object) = select.as_object() else {
        return Err(DagMlError::GraphValidation(format!(
            "pipeline DSL merge `{merge_id}` selector {selector_index} select must be `all`, `best` or an object with `top_k`, `fold_candidates_top_k` or `models`"
        )));
    };
    if object.len() == 1 && object.contains_key("models") {
        let Some(models) = object.get("models").and_then(|value| value.as_array()) else {
            return Err(DagMlError::GraphValidation(format!(
                "pipeline DSL merge `{merge_id}` selector {selector_index} models must be an array of producer node ids"
            )));
        };
        let selected = models
            .iter()
            .map(|value| value.as_str())
            .collect::<Option<Vec<_>>>()
            .ok_or_else(|| DagMlError::GraphValidation(format!(
                "pipeline DSL merge `{merge_id}` selector {selector_index} models must contain producer node ids"
            )))?;
        if selected.is_empty() || selected.iter().collect::<BTreeSet<_>>().len() != selected.len() {
            return Err(DagMlError::GraphValidation(format!(
                "pipeline DSL merge `{merge_id}` selector {selector_index} models must be non-empty and distinct"
            )));
        }
        if selected
            .iter()
            .any(|id| !matched.iter().any(|source| source.node_id.as_str() == *id))
        {
            return Err(DagMlError::GraphValidation(format!(
                "pipeline DSL merge `{merge_id}` selector {selector_index} models must be producers in the matched prediction scope"
            )));
        }
        return Ok(());
    }
    if object.contains_key("fold_candidates_top_k") {
        if object
            .keys()
            .any(|key| key != "fold_candidates_top_k" && key != "ascending")
            || object
                .get("ascending")
                .is_some_and(|value| !value.is_boolean())
            || object
                .get("fold_candidates_top_k")
                .and_then(|value| value.as_u64())
                .is_none_or(|value| value == 0)
        {
            return Err(DagMlError::GraphValidation(format!(
                "pipeline DSL merge `{merge_id}` selector {selector_index} fold_candidates_top_k must be a positive integer with optional boolean ascending"
            )));
        }
        return require_selector_metric(
            merge_id,
            selector_index,
            selector,
            "fold_candidates_top_k",
        );
    }
    if object.len() == 1 && object.contains_key("diverse_fold_candidates") {
        let Some(diverse) = object["diverse_fold_candidates"].as_object() else {
            return Err(DagMlError::GraphValidation(format!(
                "pipeline DSL merge `{merge_id}` selector {selector_index} diverse_fold_candidates must be an object"
            )));
        };
        let max_per_class = diverse
            .get("max_per_class")
            .and_then(|value| value.as_u64());
        let preferred = diverse
            .get("preferred_classes")
            .and_then(|value| value.as_array());
        if diverse
            .keys()
            .any(|key| key != "max_per_class" && key != "preferred_classes" && key != "ascending")
            || max_per_class.is_none_or(|value| value == 0)
            || diverse
                .get("ascending")
                .is_some_and(|value| !value.is_boolean())
            || preferred.is_none_or(|values| {
                values
                    .iter()
                    .any(|value| value.as_str().is_none_or(str::is_empty))
            })
        {
            return Err(DagMlError::GraphValidation(format!(
                "pipeline DSL merge `{merge_id}` selector {selector_index} diverse_fold_candidates needs positive max_per_class and preferred_classes strings"
            )));
        }
        return require_selector_metric(
            merge_id,
            selector_index,
            selector,
            "diverse_fold_candidates",
        );
    }
    if object.len() != 1 || !object.contains_key("top_k") {
        return Err(DagMlError::GraphValidation(format!(
            "pipeline DSL merge `{merge_id}` selector {selector_index} object select supports only `top_k` or `models`"
        )));
    }
    let Some(top_k) = object.get("top_k").and_then(|value| value.as_u64()) else {
        return Err(DagMlError::GraphValidation(format!(
            "pipeline DSL merge `{merge_id}` selector {selector_index} top_k must be a positive integer"
        )));
    };
    if top_k == 0 {
        return Err(DagMlError::GraphValidation(format!(
            "pipeline DSL merge `{merge_id}` selector {selector_index} top_k must be positive"
        )));
    }
    if usize::try_from(top_k).map_or(true, |limit| limit > matched.len()) {
        return Err(DagMlError::GraphValidation(format!(
            "pipeline DSL merge `{merge_id}` selector {selector_index} top_k={top_k} exceeds {} matched prediction inputs", matched.len()
        )));
    }
    require_selector_metric(merge_id, selector_index, selector, "top_k")
}
pub(crate) fn require_selector_metric(
    merge_id: &NodeId,
    selector_index: usize,
    selector: &PipelineDslMergeSelector,
    select_mode: &str,
) -> Result<()> {
    if selector
        .metric
        .as_ref()
        .is_some_and(|metric| !metric.trim().is_empty())
    {
        return Ok(());
    }
    Err(DagMlError::GraphValidation(format!(
        "pipeline DSL merge `{merge_id}` selector {selector_index} select `{select_mode}` requires a non-empty metric"
    )))
}
pub(crate) fn insert_training_metadata(
    metadata: &mut BTreeMap<String, serde_json::Value>,
    train_params: &BTreeMap<String, serde_json::Value>,
    tuning: Option<&PipelineDslTuningSpec>,
    inner_cv: Option<&NestedCvSpec>,
    node_id: &NodeId,
) -> Result<()> {
    if let Some(inner_cv) = inner_cv {
        // Carry the node-local nested-CV policy on the graph node so
        // build_execution_plan can lower it into NodePlan.inner_cv.
        metadata.insert(
            "dsl_inner_cv".to_string(),
            serde_json::to_value(inner_cv).map_err(|error| {
                DagMlError::GraphValidation(format!(
                    "failed to serialize pipeline DSL inner_cv for node `{node_id}`: {error}"
                ))
            })?,
        );
    }
    if !train_params.is_empty() {
        metadata.insert(
            "dsl_train_params".to_string(),
            serde_json::to_value(train_params).map_err(|error| {
                DagMlError::GraphValidation(format!(
                    "failed to serialize pipeline DSL train params for node `{node_id}`: {error}"
                ))
            })?,
        );
    }
    if let Some(tuning) = tuning {
        metadata.insert(
            "dsl_tuning".to_string(),
            serde_json::to_value(tuning).map_err(|error| {
                DagMlError::GraphValidation(format!(
                    "failed to serialize pipeline DSL tuning for node `{node_id}`: {error}"
                ))
            })?,
        );
    }
    Ok(())
}
pub(crate) fn same_data_source(left: &DataSource, right: &DataSource) -> bool {
    left.node_id == right.node_id
        && left.port_name == right.port_name
        && left.representation == right.representation
}
pub(crate) fn merge_consumes_predictions(step: &PipelineDslMergeStep) -> bool {
    match step.output_as {
        PipelineDslMergeOutput::Predictions => true,
        PipelineDslMergeOutput::Sources => false,
        PipelineDslMergeOutput::Features => {
            matches!(
                step.merge_mode.as_str(),
                "predictions" | "prediction" | "all" | "mixed" | "predictions_plus_original"
            ) || !step.selectors.is_empty()
        }
    }
}
pub(crate) fn merge_consumes_branch_data(step: &PipelineDslMergeStep) -> bool {
    match step.output_as {
        PipelineDslMergeOutput::Predictions => false,
        PipelineDslMergeOutput::Sources => true,
        PipelineDslMergeOutput::Features => matches!(
            step.merge_mode.as_str(),
            "features" | "feature" | "concat" | "all" | "mixed" | "sources" | "source"
        ),
    }
}
pub(crate) fn merge_node_kind(
    step: &PipelineDslMergeStep,
    has_predictions: bool,
    has_branch_data: bool,
) -> NodeKind {
    match step.output_as {
        PipelineDslMergeOutput::Predictions => NodeKind::PredictionJoin,
        PipelineDslMergeOutput::Sources => NodeKind::SourceJoin,
        PipelineDslMergeOutput::Features => {
            if has_predictions && (step.include_original_data || has_branch_data) {
                NodeKind::MixedJoin
            } else if has_predictions {
                NodeKind::PredictionJoin
            } else {
                NodeKind::FeatureJoin
            }
        }
    }
}
pub(crate) fn data_port(name: &str, representation: Option<String>, description: &str) -> PortSpec {
    PortSpec {
        name: name.to_string(),
        kind: PortKind::Data,
        representation,
        cardinality: PortCardinality::One,
        unit_level: None,
        alignment_key: None,
        target_level: None,
        description: description.to_string(),
    }
}
pub(crate) fn apply_data_unit_contract(port: &mut PortSpec, contract: &PipelineDslDataPort) {
    port.unit_level = contract.unit_level;
    port.alignment_key = contract.alignment_key.clone();
    port.target_level = contract.target_level;
}
pub(crate) fn target_port(name: &str, description: &str) -> PortSpec {
    PortSpec {
        name: name.to_string(),
        kind: PortKind::Target,
        representation: None,
        cardinality: PortCardinality::One,
        unit_level: None,
        alignment_key: None,
        target_level: None,
        description: description.to_string(),
    }
}
fn prediction_output_schema(node_id: &NodeId, additional: &[String]) -> Result<Vec<PortSpec>> {
    let mut seen = BTreeSet::from(["oof"]);
    let mut outputs = vec![prediction_port("oof", "")];
    for name in additional {
        if name.trim().is_empty() || name != name.trim() || !seen.insert(name.as_str()) {
            return Err(DagMlError::GraphValidation(format!(
                "pipeline DSL model `{node_id}` has a blank, duplicate, or reserved prediction output port `{name}`"
            )));
        }
        outputs.push(prediction_port(name, ""));
    }
    Ok(outputs)
}
pub(crate) fn prediction_port(name: &str, description: &str) -> PortSpec {
    PortSpec {
        name: name.to_string(),
        kind: PortKind::Prediction,
        representation: None,
        cardinality: PortCardinality::One,
        unit_level: None,
        alignment_key: None,
        target_level: None,
        description: description.to_string(),
    }
}
pub(crate) fn apply_prediction_unit_contract(
    port: &mut PortSpec,
    contract: &PipelineDslPredictionPort,
) {
    port.representation = contract.representation.clone();
    port.unit_level = contract.unit_level;
    port.alignment_key = contract.alignment_key.clone();
    port.target_level = contract.target_level;
}
pub(crate) fn validate_branch_id(branch_id: &str) -> Result<()> {
    if branch_id.trim().is_empty() {
        return Err(DagMlError::GraphValidation(
            "pipeline DSL branch id must not be empty".to_string(),
        ));
    }
    if !branch_id
        .bytes()
        .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-' | b'.' | b':'))
    {
        return Err(DagMlError::GraphValidation(format!(
            "pipeline DSL branch id `{branch_id}` contains unsupported characters"
        )));
    }
    Ok(())
}
pub(crate) fn branch_input_prefix(branch_id: &str, index: usize) -> String {
    let sanitized = branch_id
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || character == '_' {
                character
            } else {
                '_'
            }
        })
        .collect::<String>()
        .trim_matches('_')
        .to_string();
    if sanitized.is_empty() {
        format!("branch{index}")
    } else if sanitized != branch_id {
        format!(
            "{sanitized}_{}",
            &crate::stable_json_fingerprint(&branch_id).expect("string fingerprint")[..8]
        )
    } else {
        sanitized
    }
}
pub(crate) fn branch_prediction_input_name(
    branch_id: &str,
    branch_index: usize,
    prediction_index: usize,
    node_id: &NodeId,
) -> String {
    let branch = branch_input_prefix(branch_id, branch_index);
    let model = node_id
        .as_str()
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || character == '_' {
                character
            } else {
                '_'
            }
        })
        .collect::<String>()
        .trim_matches('_')
        .to_string();
    if model.is_empty() {
        format!("{branch}_model{prediction_index}_oof")
    } else if model != node_id.as_str() {
        let fingerprint =
            crate::campaign::stable_json_fingerprint(node_id.as_str()).expect("string fingerprint");
        format!("{branch}_{model}_{}_oof", &fingerprint[..8])
    } else {
        format!("{branch}_{model}_oof")
    }
}
