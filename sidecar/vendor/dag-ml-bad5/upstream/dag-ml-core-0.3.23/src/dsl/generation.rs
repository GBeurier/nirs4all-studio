//! Generator compilation and expansion: variant/param-generator dimensions,
//! range/log-range/grid/pick/arrange generators, grid-row/combination/
//! permutation builders, and generated-sequence namespacing.

use super::*;

#[derive(Clone, Debug)]
pub(crate) struct GeneratedSequence {
    pub(crate) id: String,
    pub(crate) labels: Vec<String>,
    /// The STRUCTURED operator-content member ids this sequence selected: each option's branch id
    /// carried verbatim from the source `PipelineDslBranch.id`, sanitized exactly once at the build
    /// site (`sanitize_generation_label`) — the SAME canonical form constraint-ref resolution uses
    /// (`compile_operator_content_constraints`). Held as structured ids rather than re-parsed from the
    /// (display) `labels` so colon-bearing branch ids (canonical branch ids allow `:`) resolve
    /// correctly and the member set and ref both key off the identical id. Merged by extension exactly
    /// like `labels`.
    pub(crate) members: Vec<String>,
    pub(crate) steps: Vec<PipelineDslStep>,
    pub(crate) metadata: BTreeMap<String, serde_json::Value>,
}

/// Lower a single operator-level generator step (Mechanism B's `PipelineDslStep::Generator`) into
/// an [`OperatorVariantModel`]: one `active_subsequence`-only choice per operator sub-sequence plus
/// the exact set of EMITTED graph node ids each choice activates (control/metadata containers
/// excluded).
///
/// This re-runs the SAME deterministic expansion (`expand_generator_sequences`) and namespacing
/// (`namespace_generated_sequence`) that Mechanism B's compile uses, so the per-choice node sets are
/// authoritative by construction (identical code path, not prefix-matched) and contain exactly the
/// ids the compiler emits as graph nodes. It does NOT mutate the compiler or the graph; the existing
/// compile output stays byte-identical.
///
/// The choice key (`active_subsequence`) and the dimension choice `label` are the generated choice
/// id (`<generator_id>:choice<i>`) — the same stable branch id Mechanism B uses for the OOF lane
/// selector — so the operator model lines up with the structural lanes. `variant_label` is left
/// `None` (population is Phase 5); `value` carries the choice id for traceability.
pub(crate) fn lower_operator_variant_model(
    step: &PipelineDslGeneratorStep,
) -> Result<OperatorVariantModel> {
    let choices = expand_generator_sequences(step)?;
    if choices.is_empty() {
        return Err(DagMlError::GraphValidation(format!(
            "pipeline DSL generator `{}` produced no choices",
            step.id
        )));
    }
    let mut dimension_choices = Vec::with_capacity(choices.len());
    let mut active_nodes = BTreeMap::<String, BTreeSet<NodeId>>::new();
    let mut variant_labels = BTreeMap::<String, String>::new();
    for (choice_index, choice) in choices.into_iter().enumerate() {
        let (choice, minted) = namespace_generated_sequence(step, choice, choice_index)?;
        validate_branch_id(&choice.id)?;
        if choice.steps.is_empty() {
            return Err(DagMlError::GraphValidation(format!(
                "pipeline DSL generator `{}` choice `{}` has no steps",
                step.id, choice.id
            )));
        }
        if minted.is_empty() {
            return Err(DagMlError::GraphValidation(format!(
                "pipeline DSL generator `{}` choice `{}` activated no nodes",
                step.id, choice.id
            )));
        }
        // Phase 5: the cross-language content fingerprint of this choice's LOWERED operator
        // sub-sequence. Computed from `choice.steps` AFTER namespacing — but the canonical form
        // names operators by `kind`/`class`/`params` CONTENT (not by the minted node ids), so it is
        // namespace-independent and the nirs4all host can recompute the SAME bytes from its own
        // operator-choice config (see `operator_variant_label`).
        variant_labels.insert(choice.id.clone(), operator_variant_label(&choice.steps)?);
        dimension_choices.push(GenerationChoice {
            label: choice.id.clone(),
            value: serde_json::Value::String(choice.id.clone()),
            param_overrides: Vec::new(),
            active_subsequence: Some(choice.id.clone()),
        });
        active_nodes.insert(choice.id, minted);
    }
    let model = OperatorVariantModel {
        generator_id: step.id.clone(),
        dimension: GenerationDimension {
            name: format!("{}.operators", step.id),
            choices: dimension_choices,
        },
        active_nodes,
        variant_labels,
    };
    model.validate()?;
    Ok(model)
}

/// Compute a choice's `variant_label`: the cross-language content fingerprint (hex sha256) of a
/// LOWERED operator sub-sequence (Phase 5).
///
/// CANONICAL FORM (a strict cross-language CONTRACT — the nirs4all host recomputes the SAME bytes
/// to map a per-variant report back to its operator-choice config): the sub-sequence is rendered as
/// a JSON array of steps in step order, each step the object
/// `{"kind": <step-kind str>, "class": <operator FQN str>, "params": {<sorted JSON-safe params>}}`.
/// Object keys are sorted everywhere (the value is built from a `serde_json::Map`, which is
/// BTreeMap-backed in this build, and params are carried in a `BTreeMap`); numbers are finite-only
/// (no NaN/Inf — rejected defensively, though JSON-sourced params can never carry them); a bool is
/// NOT a number; and the param value forms are preserved exactly as the DSL carries them (`1` is not
/// coerced to `1.0`). `variant_label` is the hex sha256 of `serde_json::to_vec` over that canonical
/// array — the SAME `sha256(serde_json::to_vec(..))` primitive
/// `stable_json_fingerprint` uses, applied to the
/// explicitly-built canonical value (never a struct's field order).
///
/// `class` is the step's operator FQN as a string: a bare-string operator (`"SNV"`) renders to
/// itself; an object operator (`{"class": "sklearn...", ...}`) renders to its compact canonical JSON
/// text (sorted keys, no whitespace), so any operator shape yields a deterministic string both sides
/// reproduce identically. Structural steps that carry no operator (`merge`, `sequential`, `branch`,
/// `generator`, `concat_transform`) render `class` as the empty string and `params` as `{}`; a
/// `merge_model` step carries its operator like a model step.
pub fn operator_variant_label(steps: &[PipelineDslStep]) -> Result<String> {
    crate::campaign::stable_json_fingerprint(&operator_variant_canonical_value(steps)?)
}

/// Build the canonical `serde_json::Value` (the JSON array of `{"kind", "class", "params"}` steps)
/// for a lowered operator sub-sequence — the exact value [`operator_variant_label`] hashes. Exposed
/// so a host binding can render the SAME canonical text (and so callers can inspect it in tests).
pub fn operator_variant_canonical_value(steps: &[PipelineDslStep]) -> Result<serde_json::Value> {
    let mut canonical = Vec::with_capacity(steps.len());
    for step in steps {
        canonical.push(canonical_operator_step(step)?);
    }
    Ok(serde_json::Value::Array(canonical))
}

/// Cross-language entry point: compute the `variant_label` (hex sha256) of a lowered operator
/// sub-sequence supplied as JSON (`steps_json` — a JSON array of `PipelineDslStep`s, the same shape
/// each generator branch carries). The nirs4all host calls THIS through the dag-ml-py binding so it
/// computes the fingerprint over the EXACT SAME canonicalization + `serde_json::to_vec` (ryu)
/// codepath dag-ml uses to stamp reports — instead of re-deriving it in pure Python, whose
/// `json.dumps` float formatting diverges from Rust's for common params (`1e-05`, `1e-7`, 1-ULP
/// shortest decimals). Sharing this one function makes the host label byte-identical to the report
/// label by construction.
pub fn operator_variant_label_from_steps_json(steps_json: &str) -> Result<String> {
    let steps: Vec<PipelineDslStep> = serde_json::from_str(steps_json).map_err(|error| {
        DagMlError::GraphValidation(format!(
            "failed to parse operator sub-sequence steps for variant_label: {error}"
        ))
    })?;
    operator_variant_label(&steps)
}

/// Render one lowered step into its canonical `{"kind", "class", "params"}` object (see
/// [`operator_variant_label`]).
fn canonical_operator_step(step: &PipelineDslStep) -> Result<serde_json::Value> {
    let (kind, class, params): (&str, String, &BTreeMap<String, serde_json::Value>) = match step {
        PipelineDslStep::Transform(step) => {
            ("transform", operator_class(&step.operator)?, &step.params)
        }
        PipelineDslStep::YTransform(step) => {
            ("y_transform", operator_class(&step.operator)?, &step.params)
        }
        PipelineDslStep::Tag(step) => ("tag", operator_class(&step.operator)?, &step.params),
        PipelineDslStep::Exclude(step) => {
            ("exclude", operator_class(&step.operator)?, &step.params)
        }
        PipelineDslStep::Filter(step) => ("filter", operator_class(&step.operator)?, &step.params),
        PipelineDslStep::SampleFilter(step) => (
            "sample_filter",
            operator_class(&step.operator)?,
            &step.params,
        ),
        PipelineDslStep::Augmentation(step) => (
            "augmentation",
            operator_class(&step.operator)?,
            &step.params,
        ),
        PipelineDslStep::FeatureAugmentation(step) => (
            "feature_augmentation",
            operator_class(&step.operator)?,
            &step.params,
        ),
        PipelineDslStep::SampleAugmentation(step) => (
            "sample_augmentation",
            operator_class(&step.operator)?,
            &step.params,
        ),
        PipelineDslStep::DataGeneration(step) => (
            "data_generation",
            operator_class(&step.operator)?,
            &step.params,
        ),
        PipelineDslStep::Model(step) => ("model", operator_class(&step.operator)?, &step.params),
        PipelineDslStep::Tuner(step) => ("tuner", operator_class(&step.operator)?, &step.params),
        PipelineDslStep::Chart(step) => ("chart", operator_class(&step.operator)?, &step.params),
        PipelineDslStep::MergeModel(step) => {
            ("merge_model", operator_class(&step.operator)?, &step.params)
        }
        PipelineDslStep::ConcatTransform(_) => (
            "concat_transform",
            String::new(),
            EMPTY_CANONICAL_PARAMS.get_or_init(BTreeMap::new),
        ),
        PipelineDslStep::Merge(_) => (
            "merge",
            String::new(),
            EMPTY_CANONICAL_PARAMS.get_or_init(BTreeMap::new),
        ),
        PipelineDslStep::Branch(_) => (
            "branch",
            String::new(),
            EMPTY_CANONICAL_PARAMS.get_or_init(BTreeMap::new),
        ),
        PipelineDslStep::Generator(_) => (
            "generator",
            String::new(),
            EMPTY_CANONICAL_PARAMS.get_or_init(BTreeMap::new),
        ),
        PipelineDslStep::Sequential(_) => (
            "sequential",
            String::new(),
            EMPTY_CANONICAL_PARAMS.get_or_init(BTreeMap::new),
        ),
    };
    let mut params_map = serde_json::Map::new();
    for (key, value) in params {
        reject_non_finite(value, key)?;
        params_map.insert(key.clone(), value.clone());
    }
    let mut object = serde_json::Map::new();
    object.insert(
        "kind".to_string(),
        serde_json::Value::String(kind.to_string()),
    );
    object.insert("class".to_string(), serde_json::Value::String(class));
    object.insert("params".to_string(), serde_json::Value::Object(params_map));
    Ok(serde_json::Value::Object(object))
}

/// A shared empty params map for structural steps, so `canonical_operator_step` can return a
/// `&BTreeMap` reference uniformly without allocating one per call.
static EMPTY_CANONICAL_PARAMS: std::sync::OnceLock<BTreeMap<String, serde_json::Value>> =
    std::sync::OnceLock::new();

/// The canonical `class` string for an operator value: a bare-string operator renders to itself; any
/// other shape (an object like `{"class": "...", ...}`) renders to its COMPACT CANONICAL JSON text
/// (sorted keys, no whitespace), which the host reproduces with `json.dumps(op, sort_keys=True,
/// separators=(",", ":"))`.
fn operator_class(operator: &serde_json::Value) -> Result<String> {
    reject_non_finite(operator, "operator")?;
    match operator {
        serde_json::Value::String(value) => Ok(value.clone()),
        other => serde_json::to_string(other).map_err(|error| {
            DagMlError::GraphValidation(format!(
                "failed to canonicalize operator value for variant_label: {error}"
            ))
        }),
    }
}

/// Reject any non-finite number anywhere in `value` (defensive: JSON-sourced params/operators can
/// never carry NaN/Inf because `serde_json::Number::from_f64` refuses them, but the canonical form
/// is a hard cross-language contract so the guard is explicit). A bool is NOT a number.
fn reject_non_finite(value: &serde_json::Value, label: &str) -> Result<()> {
    match value {
        serde_json::Value::Number(number) => {
            if let Some(float) = number.as_f64() {
                if !float.is_finite() {
                    return Err(DagMlError::GraphValidation(format!(
                        "operator-variant canonical form rejects non-finite number at `{label}`"
                    )));
                }
            }
            Ok(())
        }
        serde_json::Value::Array(items) => {
            for (index, item) in items.iter().enumerate() {
                reject_non_finite(item, &format!("{label}[{index}]"))?;
            }
            Ok(())
        }
        serde_json::Value::Object(map) => {
            for (key, item) in map {
                reject_non_finite(item, &format!("{label}.{key}"))?;
            }
            Ok(())
        }
        serde_json::Value::Null | serde_json::Value::Bool(_) | serde_json::Value::String(_) => {
            Ok(())
        }
    }
}

/// Collect every FLAT operator-level generator step in the spec's step tree (top-level plus any
/// reached through `sequential`/`branch` containers), in encounter order — matching the order
/// Mechanism B's compile namespaces them.
///
/// Nested operator-generators (a `generator` inside another `generator`'s branch/stage sub-sequence)
/// are REJECTED: Mechanism B namespaces a nested generator inside the OUTER generator's already
/// namespaced context, so lowering it from the original un-namespaced spec would not mirror the
/// compiled graph's choice labels/active ids. Nested operator-generators are a later extension;
/// Phase 3 covers flat operator generators only.
pub(crate) fn collect_operator_generator_steps(
    steps: &[PipelineDslStep],
    out: &mut Vec<PipelineDslGeneratorStep>,
) -> Result<()> {
    for step in steps {
        match step {
            PipelineDslStep::Generator(generator) => {
                if let Some(nested) = find_nested_generator(generator) {
                    return Err(DagMlError::GraphValidation(format!(
                        "pipeline DSL operator-variant model does not support the nested operator-generator `{nested}` inside generator `{}`; nested operator-generators are not covered by this Phase-3 API (flat operator generators only)",
                        generator.id
                    )));
                }
                out.push(generator.clone());
            }
            PipelineDslStep::Sequential(sequential) => {
                collect_operator_generator_steps(&sequential.steps, out)?;
            }
            PipelineDslStep::Branch(branch_step) => {
                for branch in &branch_step.branches {
                    collect_operator_generator_steps(&branch.steps, out)?;
                }
            }
            _ => {}
        }
    }
    Ok(())
}

/// Return the id of the first operator-generator nested anywhere inside `generator`'s branch/stage
/// sub-sequences (recursively), or `None` if the generator is flat.
fn find_nested_generator(generator: &PipelineDslGeneratorStep) -> Option<NodeId> {
    fn scan(steps: &[PipelineDslStep]) -> Option<NodeId> {
        for step in steps {
            match step {
                PipelineDslStep::Generator(inner) => return Some(inner.id.clone()),
                PipelineDslStep::Sequential(sequential) => {
                    if let Some(found) = scan(&sequential.steps) {
                        return Some(found);
                    }
                }
                PipelineDslStep::Branch(branch_step) => {
                    for branch in &branch_step.branches {
                        if let Some(found) = scan(&branch.steps) {
                            return Some(found);
                        }
                    }
                }
                _ => {}
            }
        }
        None
    }
    for branch in &generator.branches {
        if let Some(found) = scan(&branch.steps) {
            return Some(found);
        }
    }
    for stage in &generator.stages {
        for branch in &stage.branches {
            if let Some(found) = scan(&branch.steps) {
                return Some(found);
            }
        }
    }
    // The fixed tail (ADR-17 item 5 slice B) terminates each survivor; a generator there would be a
    // nested operator generator just like one in a branch/stage, so scan it too.
    scan(&generator.tail)
}

/// Compile the DSL's `generation_constraints` into [`GenerationConstraints`], resolving each
/// [`PipelineDslChoiceRef`] against the already-assembled generation `dimensions`. A `None` DSL
/// value (or an empty one) compiles to the empty constraint set, so a constraint-free spec stays
/// byte-identical. Final structural/reference validation is also performed by
/// [`GenerationSpec::validate`]; resolving here gives a compile-time error at the DSL boundary.
pub(crate) fn compile_generation_constraints(
    constraints: Option<&PipelineDslGenerationConstraints>,
    dimensions: &[GenerationDimension],
) -> Result<GenerationConstraints> {
    let Some(constraints) = constraints else {
        return Ok(GenerationConstraints::default());
    };
    let valid = dimensions
        .iter()
        .flat_map(|dimension| {
            dimension
                .choices
                .iter()
                .map(move |choice| (dimension.name.clone(), choice.label.clone()))
        })
        .collect::<BTreeSet<_>>();
    let lower = |reference: &PipelineDslChoiceRef| -> Result<ChoiceRef> {
        let key = (reference.dimension.clone(), reference.label.clone());
        if !valid.contains(&key) {
            return Err(DagMlError::GraphValidation(format!(
                "pipeline DSL generation constraint references unknown choice `{}:{}`",
                reference.dimension, reference.label
            )));
        }
        Ok(ChoiceRef {
            dimension: reference.dimension.clone(),
            label: reference.label.clone(),
        })
    };
    let mutex = constraints
        .mutex
        .iter()
        .map(|group| group.iter().map(&lower).collect::<Result<Vec<_>>>())
        .collect::<Result<Vec<_>>>()?;
    let requires = constraints
        .requires
        .iter()
        .map(|[left, right]| Ok((lower(left)?, lower(right)?)))
        .collect::<Result<Vec<_>>>()?;
    let exclude = constraints
        .exclude
        .iter()
        .map(|[left, right]| Ok((lower(left)?, lower(right)?)))
        .collect::<Result<Vec<_>>>()?;
    Ok(GenerationConstraints {
        mutex,
        requires,
        exclude,
    })
}
pub(crate) fn compile_explicit_generation_dimensions(
    dimensions: &[PipelineDslGenerationDimension],
    nodes: &[NodeSpec],
) -> Result<Vec<GenerationDimension>> {
    if dimensions.is_empty() {
        return Ok(Vec::new());
    }
    let node_ids = nodes
        .iter()
        .map(|node| node.id.clone())
        .collect::<BTreeSet<_>>();
    dimensions
        .iter()
        .map(|dimension| compile_explicit_generation_dimension(dimension, &node_ids))
        .collect()
}
pub(crate) fn compile_explicit_generation_dimension(
    dimension: &PipelineDslGenerationDimension,
    node_ids: &BTreeSet<NodeId>,
) -> Result<GenerationDimension> {
    let choices = dimension
        .choices
        .iter()
        .map(|choice| compile_explicit_generation_choice(&dimension.name, choice, node_ids))
        .collect::<Result<Vec<_>>>()?;
    Ok(GenerationDimension {
        name: dimension.name.clone(),
        choices,
    })
}
pub(crate) fn compile_explicit_generation_choice(
    dimension_name: &str,
    choice: &PipelineDslGenerationChoice,
    node_ids: &BTreeSet<NodeId>,
) -> Result<GenerationChoice> {
    if choice.param_overrides.is_empty() && choice.active_subsequence.is_none() {
        return Err(DagMlError::GraphValidation(format!(
            "pipeline DSL generation choice `{}` in dimension `{dimension_name}` has neither param_overrides nor active_subsequence",
            choice.label
        )));
    }
    let param_overrides = choice
        .param_overrides
        .iter()
        .map(|override_spec| {
            if !node_ids.contains(&override_spec.node_id) {
                return Err(DagMlError::GraphValidation(format!(
                    "pipeline DSL generation choice `{}` in dimension `{dimension_name}` references unknown node `{}`",
                    choice.label, override_spec.node_id
                )));
            }
            Ok(GenerationParamOverride {
                node_id: override_spec.node_id.clone(),
                params: override_spec.params.clone(),
            })
        })
        .collect::<Result<Vec<_>>>()?;
    let value = match (&choice.value, choice.active_subsequence.as_ref()) {
        (Some(value), _) => value.clone(),
        (None, Some(active_subsequence)) => serde_json::Value::String(active_subsequence.clone()),
        (None, None) => explicit_generation_choice_value(&param_overrides)?,
    };
    Ok(GenerationChoice {
        label: choice.label.clone(),
        value,
        param_overrides,
        active_subsequence: choice.active_subsequence.clone(),
    })
}
pub(crate) fn explicit_generation_choice_value(
    param_overrides: &[GenerationParamOverride],
) -> Result<serde_json::Value> {
    let mut by_node = serde_json::Map::new();
    for override_spec in param_overrides {
        let value = serde_json::to_value(&override_spec.params).map_err(|error| {
            DagMlError::GraphValidation(format!(
                "failed to serialize DSL generation override for node `{}`: {error}",
                override_spec.node_id
            ))
        })?;
        by_node.insert(override_spec.node_id.to_string(), value);
    }
    Ok(serde_json::Value::Object(by_node))
}
pub(crate) fn compile_variant_choice_dimension(
    node_id: &NodeId,
    choices: &[PipelineDslVariantChoice],
) -> Result<GenerationDimension> {
    Ok(GenerationDimension {
        name: format!("{node_id}.params"),
        choices: choices
            .iter()
            .map(|choice| {
                if choice.params.is_empty() {
                    return Err(DagMlError::GraphValidation(format!(
                        "pipeline DSL variant `{}` for node `{node_id}` has no params",
                        choice.label
                    )));
                }
                let value = match &choice.value {
                    Some(value) => value.clone(),
                    None => serde_json::to_value(&choice.params).map_err(|error| {
                        DagMlError::GraphValidation(format!(
                            "failed to serialize pipeline DSL variant `{}` for node `{node_id}`: {error}",
                            choice.label
                        ))
                    })?,
                };
                Ok(GenerationChoice {
                    label: choice.label.clone(),
                    value,
                    param_overrides: vec![GenerationParamOverride {
                        node_id: node_id.clone(),
                        params: choice.params.clone(),
                    }],
                    active_subsequence: None,
                })
            })
            .collect::<Result<Vec<_>>>()?,
    })
}
pub(crate) fn compile_param_generator_dimension(
    node_id: &NodeId,
    generator: &PipelineDslParamGenerator,
) -> Result<GenerationDimension> {
    match generator {
        PipelineDslParamGenerator::Or {
            name,
            param,
            values,
            count,
        } => compile_or_generator(node_id, name.as_deref(), param, values, *count),
        PipelineDslParamGenerator::Range {
            name,
            param,
            start,
            stop,
            step,
            inclusive,
            count,
        } => compile_range_generator(RangeGeneratorSpec {
            node_id,
            name: name.as_deref(),
            param,
            start: *start,
            stop: *stop,
            step: *step,
            inclusive: *inclusive,
            count: *count,
        }),
        PipelineDslParamGenerator::LogRange {
            name,
            param,
            start,
            stop,
            count,
            base,
        } => compile_log_range_generator(
            node_id,
            name.as_deref(),
            param,
            *start,
            *stop,
            *count,
            *base,
        ),
        PipelineDslParamGenerator::Grid {
            name,
            params,
            count,
        } => compile_grid_generator(node_id, name.as_deref(), params, *count),
        PipelineDslParamGenerator::Pick {
            name,
            param,
            values,
            sizes,
            count,
        } => compile_pick_arrange_generator(
            node_id,
            name.as_deref(),
            param,
            values,
            sizes,
            *count,
            PickArrangeMode::Pick,
        ),
        PipelineDslParamGenerator::Arrange {
            name,
            param,
            values,
            sizes,
            count,
        } => compile_pick_arrange_generator(
            node_id,
            name.as_deref(),
            param,
            values,
            sizes,
            *count,
            PickArrangeMode::Arrange,
        ),
    }
}
pub(crate) fn compile_or_generator(
    node_id: &NodeId,
    name: Option<&str>,
    param: &str,
    values: &[PipelineDslGeneratorValue],
    count: Option<usize>,
) -> Result<GenerationDimension> {
    validate_param_name(node_id, param)?;
    validate_count(node_id, name, count)?;
    if values.is_empty() {
        return Err(DagMlError::GraphValidation(format!(
            "pipeline DSL generator `{}` for node `{node_id}` has no values",
            generator_dimension_name(node_id, name, Some(param), "or")
        )));
    }
    let mut choices = values
        .iter()
        .enumerate()
        .map(|(index, value)| single_param_generation_choice(node_id, param, index, value))
        .collect::<Result<Vec<_>>>()?;
    apply_choice_count(&mut choices, count);
    Ok(GenerationDimension {
        name: generator_dimension_name(node_id, name, Some(param), "or"),
        choices,
    })
}
pub(crate) struct RangeGeneratorSpec<'a> {
    node_id: &'a NodeId,
    name: Option<&'a str>,
    param: &'a str,
    start: f64,
    stop: f64,
    step: f64,
    inclusive: bool,
    count: Option<usize>,
}
pub(crate) fn compile_range_generator(spec: RangeGeneratorSpec<'_>) -> Result<GenerationDimension> {
    validate_param_name(spec.node_id, spec.param)?;
    validate_count(spec.node_id, spec.name, spec.count)?;
    validate_finite(spec.node_id, spec.param, "range start", spec.start)?;
    validate_finite(spec.node_id, spec.param, "range stop", spec.stop)?;
    validate_finite(spec.node_id, spec.param, "range step", spec.step)?;
    if spec.step == 0.0 {
        return Err(DagMlError::GraphValidation(format!(
            "pipeline DSL range generator for `{}.{}` has zero step",
            spec.node_id, spec.param
        )));
    }
    if spec.start < spec.stop && spec.step < 0.0 {
        return Err(DagMlError::GraphValidation(format!(
            "pipeline DSL range generator for `{}.{}` steps away from stop",
            spec.node_id, spec.param
        )));
    }
    if spec.start > spec.stop && spec.step > 0.0 {
        return Err(DagMlError::GraphValidation(format!(
            "pipeline DSL range generator for `{}.{}` steps away from stop",
            spec.node_id, spec.param
        )));
    }
    let mut values = Vec::new();
    let mut current = spec.start;
    let mut guard = 0usize;
    while range_contains(current, spec.stop, spec.step, spec.inclusive) {
        values.push(json_number(current, spec.node_id, spec.param)?);
        current += spec.step;
        guard += 1;
        if guard > 10_000 {
            return Err(DagMlError::GraphValidation(format!(
                "pipeline DSL range generator for `{}.{}` produced more than 10000 values",
                spec.node_id, spec.param
            )));
        }
    }
    if values.is_empty() {
        return Err(DagMlError::GraphValidation(format!(
            "pipeline DSL range generator for `{}.{}` produced no values",
            spec.node_id, spec.param
        )));
    }
    let wrapped = values
        .into_iter()
        .map(PipelineDslGeneratorValue::Value)
        .collect::<Vec<_>>();
    compile_or_generator(spec.node_id, spec.name, spec.param, &wrapped, spec.count).map(
        |mut dimension| {
            dimension.name =
                generator_dimension_name(spec.node_id, spec.name, Some(spec.param), "range");
            dimension
        },
    )
}
pub(crate) fn compile_log_range_generator(
    node_id: &NodeId,
    name: Option<&str>,
    param: &str,
    start: f64,
    stop: f64,
    count: usize,
    base: f64,
) -> Result<GenerationDimension> {
    validate_param_name(node_id, param)?;
    validate_finite(node_id, param, "log_range start", start)?;
    validate_finite(node_id, param, "log_range stop", stop)?;
    validate_finite(node_id, param, "log_range base", base)?;
    if start <= 0.0 || stop <= 0.0 {
        return Err(DagMlError::GraphValidation(format!(
            "pipeline DSL log_range generator for `{node_id}.{param}` requires positive start and stop"
        )));
    }
    if count == 0 {
        return Err(DagMlError::GraphValidation(format!(
            "pipeline DSL log_range generator for `{node_id}.{param}` has count=0"
        )));
    }
    if base <= 0.0 || (base - 1.0).abs() < f64::EPSILON {
        return Err(DagMlError::GraphValidation(format!(
            "pipeline DSL log_range generator for `{node_id}.{param}` requires base > 0 and != 1"
        )));
    }
    let start_log = start.log(base);
    let stop_log = stop.log(base);
    let values = if count == 1 {
        vec![json_number(start, node_id, param)?]
    } else {
        (0..count)
            .map(|index| {
                let ratio = index as f64 / (count - 1) as f64;
                json_number(
                    base.powf(start_log + (stop_log - start_log) * ratio),
                    node_id,
                    param,
                )
            })
            .collect::<Result<Vec<_>>>()?
    };
    let wrapped = values
        .into_iter()
        .map(PipelineDslGeneratorValue::Value)
        .collect::<Vec<_>>();
    compile_or_generator(node_id, name, param, &wrapped, None).map(|mut dimension| {
        dimension.name = generator_dimension_name(node_id, name, Some(param), "log_range");
        dimension
    })
}
pub(crate) fn compile_grid_generator(
    node_id: &NodeId,
    name: Option<&str>,
    params: &BTreeMap<String, Vec<PipelineDslGeneratorValue>>,
    count: Option<usize>,
) -> Result<GenerationDimension> {
    validate_count(node_id, name, count)?;
    if params.is_empty() {
        return Err(DagMlError::GraphValidation(format!(
            "pipeline DSL grid generator for node `{node_id}` has no params"
        )));
    }
    for (param, values) in params {
        validate_param_name(node_id, param)?;
        if values.is_empty() {
            return Err(DagMlError::GraphValidation(format!(
                "pipeline DSL grid generator for `{node_id}.{param}` has no values"
            )));
        }
    }
    let entries = params
        .iter()
        .map(|(param, values)| (param.as_str(), values.as_slice()))
        .collect::<Vec<_>>();
    let mut rows = Vec::<BTreeMap<String, PipelineDslGeneratorValue>>::new();
    build_grid_rows(&entries, 0, &mut BTreeMap::new(), &mut rows, count);
    let choices = rows
        .into_iter()
        .enumerate()
        .map(|(index, row)| multi_param_generation_choice(node_id, index, row))
        .collect::<Result<Vec<_>>>()?;
    Ok(GenerationDimension {
        name: generator_dimension_name(node_id, name, None, "grid"),
        choices,
    })
}
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum PickArrangeMode {
    Pick,
    Arrange,
}
pub(crate) fn compile_pick_arrange_generator(
    node_id: &NodeId,
    name: Option<&str>,
    param: &str,
    values: &[PipelineDslGeneratorValue],
    sizes: &[usize],
    count: Option<usize>,
    mode: PickArrangeMode,
) -> Result<GenerationDimension> {
    validate_param_name(node_id, param)?;
    validate_count(node_id, name, count)?;
    if values.is_empty() {
        return Err(DagMlError::GraphValidation(format!(
            "pipeline DSL {:?} generator for `{node_id}.{param}` has no values",
            mode
        )));
    }
    if sizes.is_empty() {
        return Err(DagMlError::GraphValidation(format!(
            "pipeline DSL {:?} generator for `{node_id}.{param}` has no sizes",
            mode
        )));
    }
    let mut selections = Vec::<Vec<usize>>::new();
    for size in sizes {
        if *size == 0 || *size > values.len() {
            return Err(DagMlError::GraphValidation(format!(
                "pipeline DSL {:?} generator for `{node_id}.{param}` has invalid size `{size}`",
                mode
            )));
        }
        match mode {
            PickArrangeMode::Pick => build_combinations(
                values.len(),
                *size,
                0,
                &mut Vec::new(),
                &mut selections,
                count,
            ),
            PickArrangeMode::Arrange => build_permutations(
                values.len(),
                *size,
                &mut BTreeSet::new(),
                &mut Vec::new(),
                &mut selections,
                count,
            ),
        }
        if count.is_some_and(|limit| selections.len() >= limit) {
            break;
        }
    }
    let mut choices = selections
        .into_iter()
        .enumerate()
        .map(|(index, selection)| {
            let selected_values = selection
                .iter()
                .map(|selected| values[*selected].value().clone())
                .collect::<Vec<_>>();
            let selected_labels = selection
                .iter()
                .map(|selected| values[*selected].label_fragment())
                .collect::<Vec<_>>();
            let mut params = BTreeMap::new();
            params.insert(param.to_string(), serde_json::Value::Array(selected_values));
            Ok(GenerationChoice {
                label: format!(
                    "{index:04}_{}_{}",
                    match mode {
                        PickArrangeMode::Pick => "pick",
                        PickArrangeMode::Arrange => "arrange",
                    },
                    sanitize_generation_label(&selected_labels.join("_"))
                ),
                value: serde_json::to_value(&params).map_err(|error| {
                    DagMlError::GraphValidation(format!(
                        "failed to serialize pipeline DSL {:?} generator choice for `{node_id}.{param}`: {error}",
                        mode
                    ))
                })?,
                param_overrides: vec![GenerationParamOverride {
                    node_id: node_id.clone(),
                    params,
                }],
                active_subsequence: None,
            })
        })
        .collect::<Result<Vec<_>>>()?;
    apply_choice_count(&mut choices, count);
    Ok(GenerationDimension {
        name: generator_dimension_name(
            node_id,
            name,
            Some(param),
            match mode {
                PickArrangeMode::Pick => "pick",
                PickArrangeMode::Arrange => "arrange",
            },
        ),
        choices,
    })
}
pub(crate) fn single_param_generation_choice(
    node_id: &NodeId,
    param: &str,
    index: usize,
    value: &PipelineDslGeneratorValue,
) -> Result<GenerationChoice> {
    let mut params = BTreeMap::new();
    params.insert(param.to_string(), value.value().clone());
    Ok(GenerationChoice {
        label: format!(
            "{index:04}_{}_{}",
            sanitize_generation_label(param),
            value.label_fragment()
        ),
        value: serde_json::to_value(&params).map_err(|error| {
            DagMlError::GraphValidation(format!(
                "failed to serialize pipeline DSL generator choice for `{node_id}.{param}`: {error}"
            ))
        })?,
        param_overrides: vec![GenerationParamOverride {
            node_id: node_id.clone(),
            params,
        }],
        active_subsequence: None,
    })
}
pub(crate) fn multi_param_generation_choice(
    node_id: &NodeId,
    index: usize,
    row: BTreeMap<String, PipelineDslGeneratorValue>,
) -> Result<GenerationChoice> {
    let mut params = BTreeMap::new();
    let mut label_parts = Vec::new();
    for (param, value) in row {
        label_parts.push(format!(
            "{}_{}",
            sanitize_generation_label(&param),
            value.label_fragment()
        ));
        params.insert(param, value.value().clone());
    }
    Ok(GenerationChoice {
        label: format!("{index:04}_{}", label_parts.join("__")),
        value: serde_json::to_value(&params).map_err(|error| {
            DagMlError::GraphValidation(format!(
                "failed to serialize pipeline DSL grid generator choice for node `{node_id}`: {error}"
            ))
        })?,
        param_overrides: vec![GenerationParamOverride {
            node_id: node_id.clone(),
            params,
        }],
        active_subsequence: None,
    })
}
pub(crate) fn build_grid_rows(
    entries: &[(&str, &[PipelineDslGeneratorValue])],
    entry_index: usize,
    current: &mut BTreeMap<String, PipelineDslGeneratorValue>,
    rows: &mut Vec<BTreeMap<String, PipelineDslGeneratorValue>>,
    count: Option<usize>,
) {
    if count.is_some_and(|limit| rows.len() >= limit) {
        return;
    }
    if entry_index == entries.len() {
        rows.push(current.clone());
        return;
    }
    let (param, values) = entries[entry_index];
    for value in values {
        current.insert(param.to_string(), value.clone());
        build_grid_rows(entries, entry_index + 1, current, rows, count);
        current.remove(param);
        if count.is_some_and(|limit| rows.len() >= limit) {
            break;
        }
    }
}
pub(crate) fn build_combinations(
    value_count: usize,
    size: usize,
    start: usize,
    current: &mut Vec<usize>,
    selections: &mut Vec<Vec<usize>>,
    count: Option<usize>,
) {
    if count.is_some_and(|limit| selections.len() >= limit) {
        return;
    }
    if current.len() == size {
        selections.push(current.clone());
        return;
    }
    let remaining = size - current.len();
    if value_count < remaining {
        return;
    }
    for index in start..=value_count - remaining {
        current.push(index);
        build_combinations(value_count, size, index + 1, current, selections, count);
        current.pop();
        if count.is_some_and(|limit| selections.len() >= limit) {
            break;
        }
    }
}
pub(crate) fn build_permutations(
    value_count: usize,
    size: usize,
    used: &mut BTreeSet<usize>,
    current: &mut Vec<usize>,
    selections: &mut Vec<Vec<usize>>,
    count: Option<usize>,
) {
    if count.is_some_and(|limit| selections.len() >= limit) {
        return;
    }
    if current.len() == size {
        selections.push(current.clone());
        return;
    }
    for index in 0..value_count {
        if used.contains(&index) {
            continue;
        }
        used.insert(index);
        current.push(index);
        build_permutations(value_count, size, used, current, selections, count);
        current.pop();
        used.remove(&index);
        if count.is_some_and(|limit| selections.len() >= limit) {
            break;
        }
    }
}
pub(crate) fn apply_choice_count(choices: &mut Vec<GenerationChoice>, count: Option<usize>) {
    if let Some(limit) = count {
        choices.truncate(limit);
    }
}
pub(crate) fn validate_count(
    node_id: &NodeId,
    name: Option<&str>,
    count: Option<usize>,
) -> Result<()> {
    if count == Some(0) {
        return Err(DagMlError::GraphValidation(format!(
            "pipeline DSL generator `{}` for node `{node_id}` has count=0",
            generator_dimension_name(node_id, name, None, "params")
        )));
    }
    Ok(())
}
pub(crate) fn validate_param_name(node_id: &NodeId, param: &str) -> Result<()> {
    if param.trim().is_empty() {
        return Err(DagMlError::GraphValidation(format!(
            "pipeline DSL param generator for node `{node_id}` has an empty param name"
        )));
    }
    Ok(())
}
pub(crate) fn validate_finite(
    node_id: &NodeId,
    param: &str,
    field: &str,
    value: f64,
) -> Result<()> {
    if !value.is_finite() {
        return Err(DagMlError::GraphValidation(format!(
            "pipeline DSL {field} for `{node_id}.{param}` must be finite"
        )));
    }
    Ok(())
}
pub(crate) fn range_contains(current: f64, stop: f64, step: f64, inclusive: bool) -> bool {
    let epsilon = step.abs() * 1e-12 + f64::EPSILON;
    if step > 0.0 {
        if inclusive {
            current <= stop + epsilon
        } else {
            current < stop - epsilon
        }
    } else if inclusive {
        current >= stop - epsilon
    } else {
        current > stop + epsilon
    }
}
pub(crate) fn json_number(value: f64, node_id: &NodeId, param: &str) -> Result<serde_json::Value> {
    let number = serde_json::Number::from_f64(value).ok_or_else(|| {
        DagMlError::GraphValidation(format!(
            "pipeline DSL numeric generator for `{node_id}.{param}` produced a non-finite value"
        ))
    })?;
    Ok(serde_json::Value::Number(canonical_generator_number(
        number,
    )))
}
/// Normalize a generated numeric value to its JSON round-trip *fixpoint*.
///
/// `serde_json`'s shortest-decimal float formatting is not always a round-trip
/// fixpoint: a value such as `0.010000000000000005` renders to that text, but
/// re-parsing the text and re-rendering yields `0.010000000000000004`. Generator
/// choices store the value (fingerprinted by the campaign generation spec, which
/// is re-parsed from JSON at plan time) and derive the choice label from the same
/// value at compile time (kept verbatim as a string in the graph that backs the
/// `search_space_fingerprint`). Without normalization the value drifts by one ULP
/// of decimal text across the compile→serialize→plan JSON round-trip while the
/// label string does not, so the two fingerprints disagree and planning rejects
/// the plan (`search_space_fingerprint does not match campaign generation spec`).
///
/// One parse→reserialize→parse pass reaches the fixpoint (verified: a second pass
/// is a no-op for every value), so canonicalizing here — at the single point that
/// produces every numeric generator value — makes the value its own round-trip
/// fixpoint. Both the stored value and the derived label then render identically
/// no matter how many JSON round-trips the artifact takes, so the graph-side and
/// campaign-side fingerprints agree. Integer-valued and already-stable decimals
/// (every `range`/`grid` value in practice) are fixpoints already, so this is a
/// no-op for them.
pub(crate) fn canonical_generator_number(number: serde_json::Number) -> serde_json::Number {
    let rendered = number.to_string();
    serde_json::from_str::<serde_json::Number>(&rendered).unwrap_or(number)
}
pub(crate) fn generator_dimension_name(
    node_id: &NodeId,
    name: Option<&str>,
    param: Option<&str>,
    suffix: &str,
) -> String {
    if let Some(name) = name {
        return name.to_string();
    }
    match param {
        Some(param) => format!("{node_id}.{param}.{suffix}"),
        None => format!("{node_id}.{suffix}"),
    }
}
impl PipelineDslGeneratorValue {
    fn value(&self) -> &serde_json::Value {
        match self {
            Self::Labeled { value, .. } | Self::Value(value) => value,
        }
    }

    fn label_fragment(&self) -> String {
        match self {
            Self::Labeled { label, .. } => sanitize_generation_label(label),
            Self::Value(value) => {
                let rendered = match value {
                    serde_json::Value::String(value) => value.clone(),
                    _ => serde_json::to_string(value).unwrap_or_else(|_| "value".to_string()),
                };
                sanitize_generation_label(&rendered)
            }
        }
    }
}
pub(crate) fn sanitize_generation_label(input: &str) -> String {
    let sanitized = input
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '_' | '-' | '.') {
                character
            } else {
                '_'
            }
        })
        .collect::<String>()
        .trim_matches('_')
        .to_string();
    if sanitized.is_empty() {
        "value".to_string()
    } else {
        sanitized
    }
}
pub(crate) fn build_generation_spec(
    requested_strategy: Option<GenerationStrategy>,
    max_variants: Option<usize>,
    dimensions: Vec<GenerationDimension>,
    constraints: GenerationConstraints,
) -> Result<GenerationSpec> {
    let strategy = requested_strategy.unwrap_or(if dimensions.is_empty() {
        GenerationStrategy::None
    } else {
        GenerationStrategy::Cartesian
    });
    let generation = GenerationSpec {
        strategy,
        dimensions,
        max_variants: if strategy == GenerationStrategy::None {
            Some(1)
        } else {
            max_variants
        },
        constraints,
    };
    generation.validate()?;
    Ok(generation)
}
pub(crate) fn expand_generator_sequences(
    step: &PipelineDslGeneratorStep,
) -> Result<Vec<GeneratedSequence>> {
    if step.count == Some(0) {
        return Err(DagMlError::GraphValidation(format!(
            "pipeline DSL generator `{}` count cannot be zero",
            step.id
        )));
    }
    match step.mode {
        PipelineDslGeneratorMode::Or => expand_or_generator_sequences(step),
        PipelineDslGeneratorMode::Cartesian => expand_cartesian_generator_sequences(step),
    }
}
pub(crate) fn expand_or_generator_sequences(
    step: &PipelineDslGeneratorStep,
) -> Result<Vec<GeneratedSequence>> {
    if !step.stages.is_empty() {
        return Err(DagMlError::GraphValidation(format!(
            "pipeline DSL generator `{}` uses mode `or` but declares cartesian stages",
            step.id
        )));
    }
    if step.branches.is_empty() {
        return Err(DagMlError::GraphValidation(format!(
            "pipeline DSL generator `{}` has no branches",
            step.id
        )));
    }
    let options = step
        .branches
        .iter()
        .enumerate()
        .map(|(index, branch)| {
            validate_branch_id(&branch.id)?;
            Ok(GeneratedSequence {
                id: generator_choice_id(&step.id, index),
                labels: vec![branch.id.clone()],
                members: vec![sanitize_generation_label(&branch.id)],
                steps: branch.steps.clone(),
                metadata: branch.metadata.clone(),
            })
        })
        .collect::<Result<Vec<_>>>()?;

    // ADR-17 1a/1b ORDER: `count` must truncate the POST-prune survivor list (legacy
    // `expand_spec`: prune the FULL expansion, then cap). So when constraints are present we suppress
    // the per-stage `count` cap and generate the full pick/arrange expansion; `count` is applied as the
    // single final truncate after `prune_sequences_by_constraints`. With no constraints the prune is a
    // no-op and the per-stage cap is kept (byte-identical to before).
    let has_constraints = step.constraints.as_ref().is_some_and(|c| !c.is_empty());
    let gen_count = if has_constraints { None } else { step.count };

    let choices = if let Some(sizes) = selection_sizes(step.pick)? {
        generated_pick_sequences(&options, &step.id, "pick", &sizes, gen_count)?
    } else if let Some(sizes) = selection_sizes(step.arrange)? {
        generated_arrange_sequences(&options, &step.id, "arrange", &sizes, gen_count)?
    } else {
        truncate_generated_sequences(options, gen_count)
    };

    let choices = if let Some(sizes) = selection_sizes(step.then_pick)? {
        generated_pick_sequences(&choices, &step.id, "then_pick", &sizes, gen_count)?
    } else if let Some(sizes) = selection_sizes(step.then_arrange)? {
        generated_arrange_sequences(&choices, &step.id, "then_arrange", &sizes, gen_count)?
    } else {
        choices
    };
    // Prune by operator-content constraints, THEN apply `count` as the final truncate so the cap
    // counts SURVIVORS in legacy order. Append the fixed model tail (if any) to each pruned survivor
    // LAST, so the constraint member set + `count` stay operator-content-only (the tail terminates the
    // survivor, it is not a selectable operator option).
    let choices = prune_sequences_by_constraints(choices, step)?;
    Ok(append_generator_tail(
        truncate_generated_sequences(choices, step.count),
        step,
    ))
}
pub(crate) fn expand_cartesian_generator_sequences(
    step: &PipelineDslGeneratorStep,
) -> Result<Vec<GeneratedSequence>> {
    if !step.branches.is_empty() {
        return Err(DagMlError::GraphValidation(format!(
            "pipeline DSL generator `{}` uses mode `cartesian` but declares direct branches",
            step.id
        )));
    }
    if step.stages.is_empty() {
        return Err(DagMlError::GraphValidation(format!(
            "pipeline DSL generator `{}` has no cartesian stages",
            step.id
        )));
    }
    if step.pick.is_some()
        || step.arrange.is_some()
        || step.then_pick.is_some()
        || step.then_arrange.is_some()
    {
        return Err(DagMlError::GraphValidation(format!(
            "pipeline DSL generator `{}` cannot combine cartesian mode with pick/arrange selectors",
            step.id
        )));
    }

    let mut stage_options = Vec::<Vec<GeneratedSequence>>::new();
    for (stage_index, stage) in step.stages.iter().enumerate() {
        validate_branch_id(&stage.id)?;
        if stage.branches.is_empty() {
            return Err(DagMlError::GraphValidation(format!(
                "pipeline DSL generator `{}` stage `{}` has no branches",
                step.id, stage.id
            )));
        }
        let mut options = Vec::new();
        for branch in &stage.branches {
            validate_branch_id(&branch.id)?;
            let mut metadata = branch.metadata.clone();
            if let Some(selector) = &stage.selector {
                metadata.insert("dsl_generator_stage_selector".to_string(), selector.clone());
            }
            if !stage.metadata.is_empty() {
                metadata.insert(
                    "dsl_generator_stage_metadata".to_string(),
                    serde_json::to_value(&stage.metadata).map_err(|error| {
                        DagMlError::GraphValidation(format!(
                            "failed to serialize pipeline DSL generator `{}` stage `{}` metadata: {error}",
                            step.id, stage.id
                        ))
                    })?,
                );
            }
            options.push(GeneratedSequence {
                id: format!("{stage_index}:{}", branch.id),
                labels: vec![format!("{}:{}", stage.id, branch.id)],
                members: vec![sanitize_generation_label(&branch.id)],
                steps: branch.steps.clone(),
                metadata,
            });
        }
        stage_options.push(options);
    }

    // ADR-17 1b ORDER: with constraints, `count` must cap the POST-prune survivors (legacy: prune the
    // FULL cartesian, then truncate). Suppress the in-build `count` cap so the full product is
    // enumerated, prune, then truncate. With no constraints the in-build cap is kept (byte-identical).
    let has_constraints = step.constraints.as_ref().is_some_and(|c| !c.is_empty());
    let build_count = if has_constraints { None } else { step.count };

    let mut rows = Vec::<Vec<usize>>::new();
    build_cartesian_indices(&stage_options, 0, &mut Vec::new(), &mut rows, build_count);
    let mut choices = Vec::with_capacity(rows.len());
    for (choice_index, row) in rows.into_iter().enumerate() {
        let selected = row
            .into_iter()
            .enumerate()
            .map(|(stage_index, option_index)| stage_options[stage_index][option_index].clone())
            .collect::<Vec<_>>();
        choices.push(merge_generated_sequence(
            generator_choice_id(&step.id, choice_index),
            selected,
        )?);
    }
    // Prune by operator-content constraints over the FULL cartesian (stable order), THEN truncate to
    // `count` so the cap counts survivors. With no constraints the prune is a no-op. Append the fixed
    // model tail (if any) to each survivor LAST (after prune + truncate), so the tail terminates each
    // multi-operator survivor without entering the constraint member set.
    let choices = prune_sequences_by_constraints(choices, step)?;
    Ok(append_generator_tail(
        truncate_generated_sequences(choices, step.count),
        step,
    ))
}
/// Apply a generator's operator-content constraints (`_mutex_` / `_requires_` / `_exclude_`) to the
/// already-merged multi-operator sequences, returning ONLY the survivors in their original
/// (input-stable) order — mirroring nirs4all `OrStrategy._apply_constraints` /
/// `apply_all_constraints`, which prunes the expanded operator-class lists in place.
///
/// Each sequence's operator-content MEMBER SET is the set of selected branch ids it carries (the
/// branch-id segment of each `labels` entry: bare for `_or_`, the `branch` part of `stage:branch` for
/// `_cartesian_`). A constraint ref (an operator-content label) is "present" when its sanitized form
/// is in that member set, so the SHARED [`constraints_satisfied`](crate::generation::constraints_satisfied)
/// rule core (the SAME one B's `satisfies_constraints` uses) decides each sequence with an
/// operator-class-in-set predicate. Constraint refs are validated against the union of all member
/// sets so an unknown operator-content label fails loudly at compile time (parity with the DSL
/// constraint resolver).
pub(crate) fn prune_sequences_by_constraints(
    sequences: Vec<GeneratedSequence>,
    step: &PipelineDslGeneratorStep,
) -> Result<Vec<GeneratedSequence>> {
    let Some(constraints) = &step.constraints else {
        return Ok(sequences);
    };
    if constraints.is_empty() {
        return Ok(sequences);
    }
    // The operator dimension name is synthetic — the prune is single-dimension, so every ref shares it.
    let dimension = format!("{}.operators", step.id);
    let generation_constraints =
        compile_operator_content_constraints(constraints, &dimension, &sequences, step)?;
    let survivors = sequences
        .into_iter()
        .filter(|sequence| {
            let members = sequence_member_set(sequence);
            constraints_satisfied(
                |reference: &ChoiceRef| members.contains(&reference.label),
                &generation_constraints,
            )
        })
        .collect::<Vec<_>>();
    if survivors.is_empty() {
        return Err(DagMlError::GraphValidation(format!(
            "pipeline DSL generator `{}` constraints pruned every operator sequence",
            step.id
        )));
    }
    Ok(survivors)
}
/// The operator-content member set of a merged sequence: its STRUCTURED `members` (each option's
/// sanitized source branch id), keyed identically to constraint-ref resolution. Taken from the
/// structured field, never re-parsed from the display `labels`, so colon-bearing branch ids resolve
/// correctly (canonical branch ids allow `:`).
fn sequence_member_set(sequence: &GeneratedSequence) -> BTreeSet<String> {
    sequence.members.iter().cloned().collect()
}
/// Resolve a generator's operator-content [`PipelineDslGeneratorConstraints`] into a single-dimension
/// [`GenerationConstraints`] (every ref under the synthetic operator `dimension`), validating group
/// shape (mutex >= 2 distinct refs; a requires/exclude pair has two distinct refs) and that every ref
/// is a real operator-content label (sanitized branch id present in some sequence's member set).
fn compile_operator_content_constraints(
    constraints: &PipelineDslGeneratorConstraints,
    dimension: &str,
    sequences: &[GeneratedSequence],
    step: &PipelineDslGeneratorStep,
) -> Result<GenerationConstraints> {
    let valid = sequences
        .iter()
        .flat_map(sequence_member_set)
        .collect::<BTreeSet<_>>();
    let lower = |label: &str| -> Result<ChoiceRef> {
        let sanitized = sanitize_generation_label(label);
        if !valid.contains(&sanitized) {
            return Err(DagMlError::GraphValidation(format!(
                "pipeline DSL generator `{}` constraint references unknown operator `{label}`",
                step.id
            )));
        }
        Ok(ChoiceRef {
            dimension: dimension.to_string(),
            label: sanitized,
        })
    };
    let mut mutex = Vec::with_capacity(constraints.mutex.len());
    for group in &constraints.mutex {
        if group.len() < 2 {
            return Err(DagMlError::GraphValidation(format!(
                "pipeline DSL generator `{}` mutex group requires at least two operators",
                step.id
            )));
        }
        let lowered = group
            .iter()
            .map(|label| lower(label))
            .collect::<Result<Vec<_>>>()?;
        let distinct = lowered.iter().collect::<BTreeSet<_>>();
        if distinct.len() != lowered.len() {
            return Err(DagMlError::GraphValidation(format!(
                "pipeline DSL generator `{}` mutex group repeats an operator",
                step.id
            )));
        }
        mutex.push(lowered);
    }
    let lower_pair =
        |label: &str, name: &str, pair: &[String; 2]| -> Result<(ChoiceRef, ChoiceRef)> {
            let left = lower(&pair[0])?;
            let right = lower(&pair[1])?;
            if left == right {
                return Err(DagMlError::GraphValidation(format!(
                    "pipeline DSL generator `{}` {name} pair repeats operator `{label}`",
                    step.id
                )));
            }
            Ok((left, right))
        };
    let requires = constraints
        .requires
        .iter()
        .map(|pair| lower_pair(&pair[0], "requires", pair))
        .collect::<Result<Vec<_>>>()?;
    let exclude = constraints
        .exclude
        .iter()
        .map(|pair| lower_pair(&pair[0], "exclude", pair))
        .collect::<Result<Vec<_>>>()?;
    Ok(GenerationConstraints {
        mutex,
        requires,
        exclude,
    })
}
pub(crate) fn generated_pick_sequences(
    options: &[GeneratedSequence],
    generator_id: &NodeId,
    mode: &str,
    sizes: &[usize],
    count: Option<usize>,
) -> Result<Vec<GeneratedSequence>> {
    let mut selections = Vec::<Vec<usize>>::new();
    for size in sizes {
        if *size == 0 || *size > options.len() {
            return Err(DagMlError::GraphValidation(format!(
                "pipeline DSL generator `{generator_id}` {mode} size {size} is outside 1..={}",
                options.len()
            )));
        }
        build_combinations(
            options.len(),
            *size,
            0,
            &mut Vec::new(),
            &mut selections,
            count,
        );
    }
    selections
        .into_iter()
        .enumerate()
        .map(|(index, selection)| {
            let selected = selection
                .into_iter()
                .map(|option_index| options[option_index].clone())
                .collect::<Vec<_>>();
            merge_generated_sequence(generator_choice_id(generator_id, index), selected)
        })
        .collect()
}
pub(crate) fn generated_arrange_sequences(
    options: &[GeneratedSequence],
    generator_id: &NodeId,
    mode: &str,
    sizes: &[usize],
    count: Option<usize>,
) -> Result<Vec<GeneratedSequence>> {
    let mut selections = Vec::<Vec<usize>>::new();
    for size in sizes {
        if *size == 0 || *size > options.len() {
            return Err(DagMlError::GraphValidation(format!(
                "pipeline DSL generator `{generator_id}` {mode} size {size} is outside 1..={}",
                options.len()
            )));
        }
        build_permutations(
            options.len(),
            *size,
            &mut BTreeSet::new(),
            &mut Vec::new(),
            &mut selections,
            count,
        );
    }
    selections
        .into_iter()
        .enumerate()
        .map(|(index, selection)| {
            let selected = selection
                .into_iter()
                .map(|option_index| options[option_index].clone())
                .collect::<Vec<_>>();
            merge_generated_sequence(generator_choice_id(generator_id, index), selected)
        })
        .collect()
}
pub(crate) fn merge_generated_sequence(
    id: String,
    sequences: Vec<GeneratedSequence>,
) -> Result<GeneratedSequence> {
    if sequences.is_empty() {
        return Err(DagMlError::GraphValidation(format!(
            "pipeline DSL generated sequence `{id}` has no selected options"
        )));
    }
    let mut labels = Vec::new();
    let mut members = Vec::new();
    let mut steps = Vec::new();
    let mut metadata = BTreeMap::new();
    for sequence in sequences {
        labels.extend(sequence.labels);
        members.extend(sequence.members);
        steps.extend(sequence.steps);
        if !sequence.metadata.is_empty() {
            metadata.insert(
                format!("option:{}", metadata.len()),
                serde_json::to_value(sequence.metadata).map_err(|error| {
                    DagMlError::GraphValidation(format!(
                        "failed to serialize generated sequence `{id}` metadata: {error}"
                    ))
                })?,
            );
        }
    }
    Ok(GeneratedSequence {
        id,
        labels,
        members,
        steps,
        metadata,
    })
}
pub(crate) fn truncate_generated_sequences(
    mut sequences: Vec<GeneratedSequence>,
    count: Option<usize>,
) -> Vec<GeneratedSequence> {
    if let Some(limit) = count {
        sequences.truncate(limit);
    }
    sequences
}
/// Append the generator's fixed [`tail`](PipelineDslGeneratorStep::tail) sub-sequence to EVERY
/// already-pruned, already-truncated survivor's `steps` (ADR-17 item 5 slice B — the CATCH-22 fix).
///
/// The tail terminates each multi-operator survivor EXACTLY ONCE (the host carries the downstream
/// model + any `y_processing` here), so both the graph compile and `compile_operator_variant_models`
/// — which share [`expand_generator_sequences`] — see model-terminated survivors that reused the
/// already-correct `_mutex_`/`_requires_`/`_exclude_` prune. The tail is appended AFTER the prune, so
/// it never enters the operator-content member set (`labels`/`members`): constraints stay operator-
/// only and `variant_label` is computed over `[<survivor operators>, <tail>]` exactly as the host
/// recomputes it. A tail-free generator is a no-op (byte-identical to before).
pub(crate) fn append_generator_tail(
    mut sequences: Vec<GeneratedSequence>,
    step: &PipelineDslGeneratorStep,
) -> Vec<GeneratedSequence> {
    if step.tail.is_empty() {
        return sequences;
    }
    for sequence in &mut sequences {
        sequence.steps.extend(step.tail.iter().cloned());
    }
    sequences
}
pub(crate) fn build_cartesian_indices<T>(
    stages: &[Vec<T>],
    stage_index: usize,
    current: &mut Vec<usize>,
    rows: &mut Vec<Vec<usize>>,
    count: Option<usize>,
) {
    if count.is_some_and(|limit| rows.len() >= limit) {
        return;
    }
    if stage_index == stages.len() {
        rows.push(current.clone());
        return;
    }
    for option_index in 0..stages[stage_index].len() {
        current.push(option_index);
        build_cartesian_indices(stages, stage_index + 1, current, rows, count);
        current.pop();
        if count.is_some_and(|limit| rows.len() >= limit) {
            break;
        }
    }
}
pub(crate) fn selection_sizes(
    selection: Option<PipelineDslSelectionSpec>,
) -> Result<Option<Vec<usize>>> {
    selection
        .map(|selection| match selection {
            PipelineDslSelectionSpec::Single(size) => {
                if size == 0 {
                    return Err(DagMlError::GraphValidation(
                        "pipeline DSL generator selection size cannot be zero".to_string(),
                    ));
                }
                Ok(vec![size])
            }
            PipelineDslSelectionSpec::Range([start, stop]) => {
                if start == 0 || stop == 0 || start > stop {
                    return Err(DagMlError::GraphValidation(format!(
                        "pipeline DSL generator selection range [{start}, {stop}] is invalid"
                    )));
                }
                Ok((start..=stop).collect())
            }
        })
        .transpose()
}
pub(crate) fn generator_choice_id(generator_id: &NodeId, choice_index: usize) -> String {
    format!("{generator_id}:choice{choice_index}")
}
pub(crate) fn generator_choice_metadata(
    step: &PipelineDslGeneratorStep,
    choice: &GeneratedSequence,
) -> Result<BTreeMap<String, serde_json::Value>> {
    let mut metadata = step.metadata.clone();
    metadata.insert(
        "dsl_generator".to_string(),
        serde_json::Value::String(step.id.to_string()),
    );
    metadata.insert(
        "dsl_generator_mode".to_string(),
        serde_json::to_value(step.mode).map_err(|error| {
            DagMlError::GraphValidation(format!(
                "failed to serialize pipeline DSL generator `{}` mode: {error}",
                step.id
            ))
        })?,
    );
    metadata.insert(
        "dsl_generator_choice".to_string(),
        serde_json::Value::String(choice.id.clone()),
    );
    metadata.insert(
        "dsl_generator_labels".to_string(),
        serde_json::to_value(&choice.labels).map_err(|error| {
            DagMlError::GraphValidation(format!(
                "failed to serialize pipeline DSL generator `{}` choice labels: {error}",
                step.id
            ))
        })?,
    );
    if !choice.metadata.is_empty() {
        metadata.insert(
            "dsl_generator_choice_metadata".to_string(),
            serde_json::to_value(&choice.metadata).map_err(|error| {
                DagMlError::GraphValidation(format!(
                    "failed to serialize pipeline DSL generator `{}` choice metadata: {error}",
                    step.id
                ))
            })?,
        );
    }
    Ok(metadata)
}
/// Namespace a generated choice's node ids in place, returning the rewritten choice together with
/// the EXACT set of namespaced node ids that become real EMITTED graph nodes
/// (`gen:<g>:c<i>:n<k>.<orig>`).
///
/// The returned set is the authoritative active-node-id set for the operator-variant model
/// (Phase 3), captured here at the single deterministic minting point rather than by prefix-matching
/// node id strings later. It contains ONLY the ids the compiler emits as graph nodes (operator,
/// concat-transform, merge, merge-model). Control/metadata containers — named `sequential` ids and
/// nested `generator` container ids — are namespaced for uniqueness/rewrite (unchanged behavior) but
/// are NOT emitted as graph nodes, so they are excluded from the active set. The existing Mechanism B
/// caller ignores the returned set, so its behavior and output are unchanged.
pub(crate) fn namespace_generated_sequence(
    generator: &PipelineDslGeneratorStep,
    mut choice: GeneratedSequence,
    choice_index: usize,
) -> Result<(GeneratedSequence, BTreeSet<NodeId>)> {
    let mut node_map = BTreeMap::<NodeId, NodeId>::new();
    let mut emitted = BTreeSet::<NodeId>::new();
    let mut counter = 0usize;
    for step in &mut choice.steps {
        namespace_step_ids(
            generator,
            choice_index,
            step,
            &mut counter,
            &mut node_map,
            &mut emitted,
        )?;
    }
    for step in &mut choice.steps {
        rewrite_step_node_refs(step, &node_map);
    }
    Ok((choice, emitted))
}
pub(crate) fn namespace_step_ids(
    generator: &PipelineDslGeneratorStep,
    choice_index: usize,
    step: &mut PipelineDslStep,
    counter: &mut usize,
    node_map: &mut BTreeMap<NodeId, NodeId>,
    emitted: &mut BTreeSet<NodeId>,
) -> Result<()> {
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
            namespace_operator_step_id(generator, choice_index, step, counter, node_map, emitted)?;
        }
        PipelineDslStep::ConcatTransform(step) => {
            // The concat-transform id IS emitted as a FeatureJoin node; its branch operator steps
            // are emitted too.
            namespace_node_id_field(
                generator,
                choice_index,
                &mut step.id,
                counter,
                node_map,
                Some(emitted),
            )?;
            for branch in &mut step.branches {
                for branch_step in &mut branch.steps {
                    namespace_operator_step_id(
                        generator,
                        choice_index,
                        branch_step,
                        counter,
                        node_map,
                        emitted,
                    )?;
                }
            }
        }
        PipelineDslStep::Branch(step) => {
            for branch in &mut step.branches {
                for branch_step in &mut branch.steps {
                    namespace_step_ids(
                        generator,
                        choice_index,
                        branch_step,
                        counter,
                        node_map,
                        emitted,
                    )?;
                }
            }
        }
        PipelineDslStep::Generator(step) => {
            // A nested generator id is a CONTROL container: the compiler emits only its expanded
            // child nodes, not the generator id itself — so namespace it for uniqueness/rewrite but
            // do NOT record it in the emitted set.
            namespace_node_id_field(
                generator,
                choice_index,
                &mut step.id,
                counter,
                node_map,
                None,
            )?;
            for branch in &mut step.branches {
                for branch_step in &mut branch.steps {
                    namespace_step_ids(
                        generator,
                        choice_index,
                        branch_step,
                        counter,
                        node_map,
                        emitted,
                    )?;
                }
            }
            for stage in &mut step.stages {
                for branch in &mut stage.branches {
                    for branch_step in &mut branch.steps {
                        namespace_step_ids(
                            generator,
                            choice_index,
                            branch_step,
                            counter,
                            node_map,
                            emitted,
                        )?;
                    }
                }
            }
        }
        PipelineDslStep::Sequential(step) => {
            // A named sequential id is METADATA only (`compile_sequence_container` writes no node):
            // namespace it for uniqueness/rewrite but do NOT record it in the emitted set.
            if let Some(id) = &mut step.id {
                namespace_node_id_field(generator, choice_index, id, counter, node_map, None)?;
            }
            for child in &mut step.steps {
                namespace_step_ids(generator, choice_index, child, counter, node_map, emitted)?;
            }
        }
        PipelineDslStep::Merge(step) => {
            namespace_node_id_field(
                generator,
                choice_index,
                &mut step.id,
                counter,
                node_map,
                Some(emitted),
            )?;
        }
        PipelineDslStep::MergeModel(step) => {
            namespace_node_id_field(
                generator,
                choice_index,
                &mut step.id,
                counter,
                node_map,
                Some(emitted),
            )?;
        }
    }
    Ok(())
}
pub(crate) fn namespace_operator_step_id(
    generator: &PipelineDslGeneratorStep,
    choice_index: usize,
    step: &mut PipelineDslOperatorStep,
    counter: &mut usize,
    node_map: &mut BTreeMap<NodeId, NodeId>,
    emitted: &mut BTreeSet<NodeId>,
) -> Result<()> {
    namespace_node_id_field(
        generator,
        choice_index,
        &mut step.id,
        counter,
        node_map,
        Some(emitted),
    )
}
/// Mint the namespaced id for `node_id` (in place), recording the original→namespaced mapping in
/// `node_map`. When `emitted` is `Some`, the namespaced id is also recorded as a real emitted graph
/// node; when `None`, the id is a control/metadata container that the compiler does not emit, so it
/// is mapped (for rewrite + uniqueness) but excluded from the active set.
pub(crate) fn namespace_node_id_field(
    generator: &PipelineDslGeneratorStep,
    choice_index: usize,
    node_id: &mut NodeId,
    counter: &mut usize,
    node_map: &mut BTreeMap<NodeId, NodeId>,
    emitted: Option<&mut BTreeSet<NodeId>>,
) -> Result<()> {
    let original = node_id.clone();
    if node_map.contains_key(&original) {
        return Err(DagMlError::GraphValidation(format!(
            "pipeline DSL generator `{}` choice `{}` reuses node id `{original}`; generated choices require unique node ids inside each expanded sequence",
            generator.id, choice_index
        )));
    }
    let next = namespaced_generated_node_id(&generator.id, choice_index, *counter, &original)?;
    *counter += 1;
    *node_id = next.clone();
    if let Some(emitted) = emitted {
        emitted.insert(next.clone());
    }
    node_map.insert(original, next);
    Ok(())
}
pub(crate) fn namespaced_generated_node_id(
    generator_id: &NodeId,
    choice_index: usize,
    node_index: usize,
    original: &NodeId,
) -> Result<NodeId> {
    let generator = sanitized_id_fragment(generator_id.as_str(), 32);
    let suffix = sanitized_id_fragment(original.as_str(), 28);
    NodeId::new(format!(
        "gen:{generator}:c{choice_index}:n{node_index}.{suffix}"
    ))
}
pub(crate) fn sanitized_id_fragment(input: &str, max_len: usize) -> String {
    let sanitized = sanitize_generation_label(input);
    let mut fragment = sanitized.chars().take(max_len).collect::<String>();
    if fragment.is_empty() {
        fragment = "x".to_string();
    }
    fragment
}
pub(crate) fn rewrite_step_node_refs(
    step: &mut PipelineDslStep,
    node_map: &BTreeMap<NodeId, NodeId>,
) {
    match step {
        PipelineDslStep::Transform(_)
        | PipelineDslStep::YTransform(_)
        | PipelineDslStep::Tag(_)
        | PipelineDslStep::Exclude(_)
        | PipelineDslStep::Filter(_)
        | PipelineDslStep::SampleFilter(_)
        | PipelineDslStep::Augmentation(_)
        | PipelineDslStep::FeatureAugmentation(_)
        | PipelineDslStep::SampleAugmentation(_)
        | PipelineDslStep::DataGeneration(_)
        | PipelineDslStep::Model(_)
        | PipelineDslStep::Tuner(_)
        | PipelineDslStep::Chart(_) => {}
        PipelineDslStep::ConcatTransform(step) => {
            for branch in &mut step.branches {
                for branch_step in &mut branch.steps {
                    rewrite_operator_step_refs(branch_step, node_map);
                }
            }
        }
        PipelineDslStep::Branch(step) => {
            for branch in &mut step.branches {
                for branch_step in &mut branch.steps {
                    rewrite_step_node_refs(branch_step, node_map);
                }
            }
        }
        PipelineDslStep::Generator(step) => {
            for branch in &mut step.branches {
                for branch_step in &mut branch.steps {
                    rewrite_step_node_refs(branch_step, node_map);
                }
            }
            for stage in &mut step.stages {
                for branch in &mut stage.branches {
                    for branch_step in &mut branch.steps {
                        rewrite_step_node_refs(branch_step, node_map);
                    }
                }
            }
        }
        PipelineDslStep::Sequential(step) => {
            for child in &mut step.steps {
                rewrite_step_node_refs(child, node_map);
            }
        }
        PipelineDslStep::Merge(step) => {
            rewrite_merge_selectors(&mut step.selectors, node_map);
        }
        PipelineDslStep::MergeModel(_) => {}
    }
}
pub(crate) fn rewrite_operator_step_refs(
    _step: &mut PipelineDslOperatorStep,
    _node_map: &BTreeMap<NodeId, NodeId>,
) {
}
