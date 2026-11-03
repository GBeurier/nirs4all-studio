//! Pipeline DSL spec types: the root spec, data/prediction ports, the step
//! enum and its variants, param generators, branches, sequences, generators,
//! selection, concat/merge steps, the shape plan, and `CompiledPipelineDsl`.

use super::*;

pub const PIPELINE_DSL_SCHEMA_VERSION: u32 = 1;
pub const PIPELINE_DSL_SCHEMA_ID: &str =
    "https://github.com/GBeurier/dag-ml/schemas/pipeline_dsl.v1.schema.json";
/// Typed, externally bound model inputs preserved in compiled graph metadata.
pub const DSL_MODEL_INPUT_METADATA_KEY: &str = "dsl_model_input";
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct PipelineDslSpec {
    pub id: String,
    #[serde(default)]
    pub input: PipelineDslDataPort,
    #[serde(default)]
    pub output: PipelineDslPredictionPort,
    #[serde(default)]
    pub generation_strategy: Option<GenerationStrategy>,
    #[serde(default)]
    pub max_variants: Option<usize>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub generation_dimensions: Vec<PipelineDslGenerationDimension>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub generation_constraints: Option<PipelineDslGenerationConstraints>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub campaign_id: Option<String>,
    #[serde(default)]
    pub root_seed: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub leakage_policy: Option<LeakageUnitPolicy>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub aggregation_policy: Option<AggregationPolicy>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub split_invocation: Option<SplitInvocation>,
    /// Campaign-wide default nested (inner) CV policy; a per-step `inner_cv`
    /// overrides it (compiled to `CampaignSpec.inner_cv`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub inner_cv: Option<NestedCvSpec>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub campaign_metadata: BTreeMap<String, serde_json::Value>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub data_bindings: Vec<DataBinding>,
    #[serde(default)]
    pub steps: Vec<PipelineDslStep>,
    #[serde(default)]
    pub metadata: BTreeMap<String, serde_json::Value>,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct PipelineDslDataPort {
    #[serde(default = "default_input_name")]
    pub name: String,
    #[serde(default = "default_data_representation")]
    pub representation: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub unit_level: Option<EntityUnitLevel>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub alignment_key: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target_level: Option<EntityUnitLevel>,
    #[serde(default)]
    pub description: String,
}
impl Default for PipelineDslDataPort {
    fn default() -> Self {
        Self {
            name: default_input_name(),
            representation: default_data_representation(),
            unit_level: None,
            alignment_key: None,
            target_level: None,
            description: String::new(),
        }
    }
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct PipelineDslPredictionPort {
    #[serde(default = "default_output_name")]
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub representation: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub unit_level: Option<EntityUnitLevel>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub alignment_key: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target_level: Option<EntityUnitLevel>,
    #[serde(default)]
    pub description: String,
}
impl Default for PipelineDslPredictionPort {
    fn default() -> Self {
        Self {
            name: default_output_name(),
            representation: None,
            unit_level: None,
            alignment_key: None,
            target_level: None,
            description: String::new(),
        }
    }
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum PipelineDslStep {
    Transform(PipelineDslOperatorStep),
    YTransform(PipelineDslOperatorStep),
    Tag(PipelineDslOperatorStep),
    Exclude(PipelineDslOperatorStep),
    Filter(PipelineDslOperatorStep),
    SampleFilter(PipelineDslOperatorStep),
    Augmentation(PipelineDslOperatorStep),
    FeatureAugmentation(PipelineDslOperatorStep),
    SampleAugmentation(PipelineDslOperatorStep),
    #[serde(alias = "generation")]
    DataGeneration(PipelineDslOperatorStep),
    ConcatTransform(PipelineDslConcatTransformStep),
    Model(PipelineDslOperatorStep),
    #[serde(alias = "finetune")]
    Tuner(PipelineDslOperatorStep),
    Branch(PipelineDslBranchStep),
    Generator(PipelineDslGeneratorStep),
    Sequential(PipelineDslSequenceStep),
    Merge(PipelineDslMergeStep),
    MergeModel(PipelineDslMergeModelStep),
    Chart(PipelineDslOperatorStep),
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct PipelineDslOperatorStep {
    pub id: NodeId,
    pub operator: serde_json::Value,
    /// Optional dense named-input contract. Absence preserves the single-X DSL.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model_input: Option<ModelInputSpec>,
    /// Additional prediction outputs of the same fitted operator. `oof` remains
    /// the primary scored output; these ports are available to downstream edges.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub prediction_output_ports: Vec<String>,
    #[serde(default)]
    pub params: BTreeMap<String, serde_json::Value>,
    #[serde(default)]
    pub metadata: BTreeMap<String, serde_json::Value>,
    #[serde(default)]
    pub seed_label: Option<String>,
    #[serde(default)]
    pub representation: Option<String>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub train_params: BTreeMap<String, serde_json::Value>,
    #[serde(
        default,
        alias = "finetune_params",
        skip_serializing_if = "Option::is_none"
    )]
    pub tuning: Option<PipelineDslTuningSpec>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub variants: Vec<PipelineDslVariantChoice>,
    #[serde(default, alias = "generators", skip_serializing_if = "Vec::is_empty")]
    pub param_generators: Vec<PipelineDslParamGenerator>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub shape: Option<PipelineDslShapePlan>,
    /// Node-local nested (inner) CV policy (e.g. for a finetune/tuner step);
    /// overrides the campaign-wide default. Compiled to `NodePlan.inner_cv` via
    /// the node's `dsl_inner_cv` metadata.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub inner_cv: Option<NestedCvSpec>,
}

/// Validate the first named-input profile without inspecting host-owned buffers.
/// Actual dtype, shape, finiteness and row materialization remain host duties.
pub(crate) fn validate_named_model_input_spec(spec: &ModelInputSpec) -> Result<()> {
    spec.validate()
        .map_err(|error| DagMlError::GraphValidation(error.to_string()))?;
    if !(2..=4).contains(&spec.ports.len())
        || spec.default_fusion.is_some()
        || spec.fit_influence_policy.is_some()
    {
        return Err(DagMlError::GraphValidation(
            "named model_input requires 2–4 distinct dense ports without aggregate fusion or influence policy"
                .to_string(),
        ));
    }
    let mut sources = BTreeSet::new();
    for port in &spec.ports {
        let representation = (port.accepted_representations.len() == 1)
            .then(|| port.accepted_representations[0].as_str());
        let expected = match representation {
            Some("tabular_numeric") => Some(("table", 2)),
            Some("signal_1d") => Some(("dense_signal", 2)),
            Some("gray_image") => Some(("gray_image", 3)),
            Some("rgb_image") => Some(("image_rgb", 4)),
            Some("mc_image" | "multispectral_image") => Some(("multichannel_image", 4)),
            Some("series_mv") => Some(("time_series", 3)),
            _ => None,
        };
        let valid_port_type = expected.is_some_and(|(type_id, rank)| {
            port.accepted_types == [type_id] && port.rank == Some(rank)
        });
        let mut name = port.name.bytes();
        let identifier = name
            .next()
            .is_some_and(|byte| byte.is_ascii_alphabetic() || byte == b'_')
            && name.all(|byte| byte.is_ascii_alphanumeric() || byte == b'_');
        if port.name == "y" || !identifier || !valid_port_type || port.multi_source || port.optional
        {
            return Err(DagMlError::GraphValidation(format!(
                "named model_input port `{}` must be a required fixed numeric table/signal/image/series input with its matching type and rank, distinct from target y",
                port.name
            )));
        }
        let source = port
            .metadata
            .get("source_id")
            .and_then(serde_json::Value::as_str);
        let dtype = port
            .metadata
            .get("dtype")
            .and_then(serde_json::Value::as_str);
        let shape = port
            .metadata
            .get("feature_shape")
            .and_then(serde_json::Value::as_array);
        let valid_source = source.is_some_and(|source| {
            !source.is_empty() && source.trim() == source && sources.insert(source)
        });
        let valid_shape = shape.is_some_and(|shape| {
            port.rank
                .is_some_and(|rank| shape.len() + 1 == rank as usize)
                && shape
                    .iter()
                    .try_fold(1_u64, |size, extent| {
                        let extent = extent.as_u64()?;
                        if extent == 0 {
                            return None;
                        }
                        size.checked_mul(extent).filter(|size| *size <= 16_777_216)
                    })
                    .is_some()
                && (representation != Some("rgb_image")
                    || shape.last().and_then(serde_json::Value::as_u64) == Some(3))
        });
        if port.metadata.len() != 3
            || !valid_source
            || !matches!(dtype, Some("float32" | "float64"))
            || !valid_shape
        {
            return Err(DagMlError::GraphValidation(format!(
                "named model_input port `{}` requires exactly a distinct source_id, float32/float64 dtype and positive bounded fixed feature_shape matching its rank",
                port.name
            )));
        }
    }
    Ok(())
}
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct PipelineDslTuningSpec {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub n_trials: Option<usize>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub approach: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub eval_mode: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sampler: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub metric: Option<String>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub model_params: BTreeMap<String, serde_json::Value>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub train_params: BTreeMap<String, serde_json::Value>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub metadata: BTreeMap<String, serde_json::Value>,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct PipelineDslVariantChoice {
    pub label: String,
    #[serde(default)]
    pub params: BTreeMap<String, serde_json::Value>,
    #[serde(default)]
    pub value: Option<serde_json::Value>,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum PipelineDslParamGenerator {
    Or {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        name: Option<String>,
        param: String,
        values: Vec<PipelineDslGeneratorValue>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        count: Option<usize>,
    },
    Range {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        name: Option<String>,
        param: String,
        start: f64,
        stop: f64,
        step: f64,
        #[serde(default = "default_true")]
        inclusive: bool,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        count: Option<usize>,
    },
    LogRange {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        name: Option<String>,
        param: String,
        start: f64,
        stop: f64,
        count: usize,
        #[serde(default = "default_log_base")]
        base: f64,
    },
    Grid {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        name: Option<String>,
        params: BTreeMap<String, Vec<PipelineDslGeneratorValue>>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        count: Option<usize>,
    },
    Pick {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        name: Option<String>,
        param: String,
        values: Vec<PipelineDslGeneratorValue>,
        sizes: Vec<usize>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        count: Option<usize>,
    },
    Arrange {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        name: Option<String>,
        param: String,
        values: Vec<PipelineDslGeneratorValue>,
        sizes: Vec<usize>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        count: Option<usize>,
    },
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(untagged, deny_unknown_fields)]
pub enum PipelineDslGeneratorValue {
    Labeled {
        label: String,
        value: serde_json::Value,
    },
    Value(serde_json::Value),
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct PipelineDslGenerationDimension {
    pub name: String,
    #[serde(default)]
    pub choices: Vec<PipelineDslGenerationChoice>,
}
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct PipelineDslGenerationConstraints {
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub mutex: Vec<Vec<PipelineDslChoiceRef>>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub requires: Vec<[PipelineDslChoiceRef; 2]>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub exclude: Vec<[PipelineDslChoiceRef; 2]>,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct PipelineDslChoiceRef {
    pub dimension: String,
    pub label: String,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct PipelineDslGenerationChoice {
    pub label: String,
    #[serde(default)]
    pub value: Option<serde_json::Value>,
    #[serde(default)]
    pub param_overrides: Vec<PipelineDslGenerationParamOverride>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub active_subsequence: Option<String>,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct PipelineDslGenerationParamOverride {
    pub node_id: NodeId,
    #[serde(default)]
    pub params: BTreeMap<String, serde_json::Value>,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct PipelineDslBranchStep {
    #[serde(default)]
    pub mode: PipelineDslBranchMode,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub selector: Option<serde_json::Value>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub metadata: BTreeMap<String, serde_json::Value>,
    pub branches: Vec<PipelineDslBranch>,
}
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PipelineDslBranchMode {
    #[default]
    Duplication,
    Separation,
    BySource,
    ByMetadata,
    ByTag,
    ByFilter,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct PipelineDslBranch {
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub selector: Option<serde_json::Value>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub metadata: BTreeMap<String, serde_json::Value>,
    #[serde(default)]
    pub steps: Vec<PipelineDslStep>,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct PipelineDslSequenceStep {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<NodeId>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub metadata: BTreeMap<String, serde_json::Value>,
    #[serde(default)]
    pub steps: Vec<PipelineDslStep>,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct PipelineDslGeneratorStep {
    pub id: NodeId,
    #[serde(default)]
    pub mode: PipelineDslGeneratorMode,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub branches: Vec<PipelineDslBranch>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub stages: Vec<PipelineDslGeneratorStage>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pick: Option<PipelineDslSelectionSpec>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub arrange: Option<PipelineDslSelectionSpec>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub then_pick: Option<PipelineDslSelectionSpec>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub then_arrange: Option<PipelineDslSelectionSpec>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub count: Option<usize>,
    /// CONSTRAINED operator generators (ADR-17 1a + 1b): `_mutex_`/`_requires_`/`_exclude_` over the
    /// generator's OPERATOR-CONTENT (its branch/option ids, the operator classes nirs4all references).
    /// Applied during sequence-build so the operator dimension carries only the pruned survivor set
    /// (see `expand_or_generator_sequences`). ADDITIVE:
    /// skipped when `None`, so a constraint-free generator serializes byte-identically.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub constraints: Option<PipelineDslGeneratorConstraints>,
    /// A FIXED tail sub-sequence appended to EVERY expanded survivor (after pick/arrange + the
    /// `_mutex_`/`_requires_`/`_exclude_` prune + the `count` truncate). The CATCH-22 fix for a
    /// MODEL-TERMINATED constrained/pick operator generator (ADR-17 item 5 slice B): a constrained
    /// `_or_`-pick / `_cartesian_` survivor is a multi-operator SEQUENCE, and the downstream model must
    /// terminate it EXACTLY ONCE (not once per picked branch). The host carries that downstream model
    /// (+ any `y_processing`) here, so `expand_*_generator_sequences` appends it to each pruned survivor
    /// — making `compile_operator_variant_models` (and the graph compile, which shares
    /// `expand_generator_sequences`) see model-terminated survivors that reuse the already-correct
    /// constraint prune. The tail is NOT part of the operator-content member set (it is appended AFTER
    /// the prune), so constraints + `variant_label` stay operator-only. ADDITIVE: empty by default, so a
    /// tail-free generator (every pre-existing generator, including the constraint-free fusion path)
    /// serializes + expands byte-identically.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tail: Vec<PipelineDslStep>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub metadata: BTreeMap<String, serde_json::Value>,
}
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PipelineDslGeneratorMode {
    #[default]
    Or,
    Cartesian,
}
/// Operator-content pruning constraints on a [`PipelineDslGeneratorStep`] (ADR-17 1a/1b). Each ref is
/// an operator-content label — a generator branch/option id (`_or_`) or branch id (`_cartesian_`),
/// the operator class nirs4all carries in its `_mutex_`/`_requires_`/`_exclude_`. The keywords mirror
/// the nirs4all generation oracle (`_generator/constraints.py`): `mutex` = the full group may not all
/// co-occur (issubset), `requires` = `[a, b]` means a present requires b present, `exclude` = `[a, b]`
/// is a forbidden pair. Compiled to a single-dimension [`GenerationConstraints`] over the operator
/// dimension and applied during sequence-build, NOT carried onto `OperatorVariantModel.generation_spec`.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct PipelineDslGeneratorConstraints {
    #[serde(default, alias = "_mutex_", skip_serializing_if = "Vec::is_empty")]
    pub mutex: Vec<Vec<String>>,
    #[serde(default, alias = "_requires_", skip_serializing_if = "Vec::is_empty")]
    pub requires: Vec<[String; 2]>,
    #[serde(default, alias = "_exclude_", skip_serializing_if = "Vec::is_empty")]
    pub exclude: Vec<[String; 2]>,
}
impl PipelineDslGeneratorConstraints {
    pub fn is_empty(&self) -> bool {
        self.mutex.is_empty() && self.requires.is_empty() && self.exclude.is_empty()
    }
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct PipelineDslGeneratorStage {
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub selector: Option<serde_json::Value>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub metadata: BTreeMap<String, serde_json::Value>,
    #[serde(default)]
    pub branches: Vec<PipelineDslBranch>,
}
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum PipelineDslSelectionSpec {
    Single(usize),
    Range([usize; 2]),
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct PipelineDslConcatTransformStep {
    pub id: NodeId,
    #[serde(default)]
    pub branches: Vec<PipelineDslConcatBranch>,
    #[serde(default)]
    pub metadata: BTreeMap<String, serde_json::Value>,
    #[serde(default)]
    pub seed_label: Option<String>,
    #[serde(default)]
    pub representation: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub variants: Vec<PipelineDslVariantChoice>,
    #[serde(default, alias = "generators", skip_serializing_if = "Vec::is_empty")]
    pub param_generators: Vec<PipelineDslParamGenerator>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub shape: Option<PipelineDslShapePlan>,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct PipelineDslConcatBranch {
    pub id: String,
    #[serde(default)]
    pub steps: Vec<PipelineDslOperatorStep>,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct PipelineDslMergeStep {
    pub id: NodeId,
    #[serde(default = "default_merge_mode")]
    pub merge_mode: String,
    #[serde(default)]
    pub output_as: PipelineDslMergeOutput,
    #[serde(default = "default_true")]
    pub include_original_data: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub on_missing: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub selectors: Vec<PipelineDslMergeSelector>,
    #[serde(default)]
    pub metadata: BTreeMap<String, serde_json::Value>,
    #[serde(default)]
    pub seed_label: Option<String>,
    #[serde(default)]
    pub representation: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub variants: Vec<PipelineDslVariantChoice>,
    #[serde(default, alias = "generators", skip_serializing_if = "Vec::is_empty")]
    pub param_generators: Vec<PipelineDslParamGenerator>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub shape: Option<PipelineDslShapePlan>,
}
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PipelineDslMergeOutput {
    #[default]
    Features,
    Predictions,
    Sources,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct PipelineDslMergeSelector {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub input_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub branch: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<NodeId>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub select: Option<serde_json::Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub metric: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub aggregate: Option<String>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub metadata: BTreeMap<String, serde_json::Value>,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct PipelineDslMergeModelStep {
    pub id: NodeId,
    pub operator: serde_json::Value,
    /// Explicit ordered prediction producers. Empty uses the pending predictions.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub sources: Vec<NodeId>,
    /// Optional port override for an explicit source. Missing entries use its
    /// primary prediction output, preserving legacy `sources` semantics.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub source_ports: BTreeMap<NodeId, String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub prediction_output_ports: Vec<String>,
    #[serde(default)]
    pub params: BTreeMap<String, serde_json::Value>,
    #[serde(default)]
    pub metadata: BTreeMap<String, serde_json::Value>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub selectors: Vec<PipelineDslMergeSelector>,
    #[serde(default)]
    pub seed_label: Option<String>,
    #[serde(default = "default_true")]
    pub include_original_data: bool,
    #[serde(default = "default_merge_mode")]
    pub merge_mode: String,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub train_params: BTreeMap<String, serde_json::Value>,
    #[serde(
        default,
        alias = "finetune_params",
        skip_serializing_if = "Option::is_none"
    )]
    pub tuning: Option<PipelineDslTuningSpec>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub variants: Vec<PipelineDslVariantChoice>,
    #[serde(default, alias = "generators", skip_serializing_if = "Vec::is_empty")]
    pub param_generators: Vec<PipelineDslParamGenerator>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub shape: Option<PipelineDslShapePlan>,
    /// Node-local nested (inner) CV policy for this meta-model (the meta-stacker's
    /// inner CV is nested inside the outer CV); overrides the campaign default.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub inner_cv: Option<NestedCvSpec>,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct PipelineDslShapePlan {
    #[serde(default)]
    pub input_granularity: Option<Granularity>,
    #[serde(default)]
    pub target_granularity: Option<Granularity>,
    #[serde(default)]
    pub fit_rows: Option<FitBoundary>,
    #[serde(default)]
    pub predict_rows: Option<FitBoundary>,
    #[serde(default)]
    pub feature_namespace: Option<String>,
    #[serde(default)]
    pub feature_schema_fingerprint: Option<String>,
    #[serde(default)]
    pub target_space: Option<String>,
    #[serde(default)]
    pub aggregation_policy: Option<AggregationPolicy>,
    #[serde(default)]
    pub augmentation_policy: Option<AugmentationPolicy>,
    #[serde(default)]
    pub selection_policy: Option<FeatureSelectionPolicy>,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct CompiledPipelineDsl {
    pub graph: GraphSpec,
    pub generation: GenerationSpec,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub shape_plans: BTreeMap<NodeId, DataModelShapePlan>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub data_bindings: BTreeMap<NodeId, Vec<DataBinding>>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub branch_view_plans: Vec<BranchViewPlan>,
    pub campaign_template: CampaignSpec,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub generation_fingerprint: Option<String>,
}
pub(crate) fn default_input_name() -> String {
    "x".to_string()
}
pub(crate) fn default_output_name() -> String {
    "prediction".to_string()
}
pub(crate) fn default_data_representation() -> String {
    "tabular_numeric".to_string()
}
pub(crate) fn default_true() -> bool {
    true
}
pub(crate) fn default_log_base() -> f64 {
    10.0
}
pub(crate) fn default_merge_mode() -> String {
    "predictions_plus_original".to_string()
}
