//! Pipeline DSL spec types: the root spec, data/prediction ports, the step
//! enum and its variants, param generators, branches, sequences, generators,
//! selection, concat/merge steps, the shape plan, and `CompiledPipelineDsl`.

use super::*;

pub const PIPELINE_DSL_SCHEMA_VERSION: u32 = 1;
pub const PIPELINE_DSL_SCHEMA_ID: &str =
    "https://github.com/GBeurier/dag-ml/schemas/pipeline_dsl.v1.schema.json";
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
#[serde(untagged)]
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
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub metadata: BTreeMap<String, serde_json::Value>,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct PipelineDslMergeModelStep {
    pub id: NodeId,
    pub operator: serde_json::Value,
    #[serde(default)]
    pub params: BTreeMap<String, serde_json::Value>,
    #[serde(default)]
    pub metadata: BTreeMap<String, serde_json::Value>,
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
