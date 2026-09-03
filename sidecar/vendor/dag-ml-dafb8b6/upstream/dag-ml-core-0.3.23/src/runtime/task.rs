// Auto-split from the former monolithic `runtime.rs` (pure refactor).
use super::*;
use crate::TrainingLossRoleReference;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct PredictionInputSpec {
    pub producer_node: NodeId,
    pub source_port: String,
    pub target_port: String,
    pub partition: PredictionPartition,
    #[serde(default = "default_runtime_prediction_level")]
    pub prediction_level: PredictionLevel,
    pub fold_id: Option<FoldId>,
    #[serde(default)]
    pub fold_ids: Vec<FoldId>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub unit_ids: Vec<PredictionUnitId>,
    #[serde(default)]
    pub sample_ids: Vec<SampleId>,
    /// Per-sample OOF prediction rows, aligned 1:1 with `sample_ids`
    /// (width == `prediction_width`). Sourced only from Validation OOF blocks
    /// so a host can build a stacking meta-feature matrix during FIT_CV/REFIT.
    #[serde(default)]
    pub values: Vec<Vec<f64>>,
    pub prediction_width: usize,
    #[serde(default)]
    pub target_names: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ArtifactInputSpec {
    pub node_id: NodeId,
    pub controller_id: ControllerId,
    pub artifact: ArtifactRef,
    pub params_fingerprint: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub training_loss_fingerprint: Option<String>,
    #[serde(default)]
    pub data_requirement_keys: Vec<String>,
    #[serde(default)]
    pub prediction_requirement_keys: Vec<String>,
}

impl ArtifactInputSpec {
    pub(crate) fn from_refit_record(record: &RefitArtifactRecord) -> Result<Self> {
        record.validate()?;
        Ok(Self {
            node_id: record.node_id.clone(),
            controller_id: record.controller_id.clone(),
            artifact: record.artifact.clone(),
            params_fingerprint: record.params_fingerprint.clone(),
            training_loss_fingerprint: record.training_loss_fingerprint.clone(),
            data_requirement_keys: record.data_requirement_keys.clone(),
            prediction_requirement_keys: record.prediction_requirement_keys.clone(),
        })
    }
}

pub(crate) fn default_runtime_prediction_level() -> PredictionLevel {
    PredictionLevel::Sample
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct NodeTask {
    pub run_id: RunId,
    pub node_plan: NodePlan,
    pub phase: Phase,
    pub variant_id: Option<VariantId>,
    #[serde(default)]
    pub variant: Option<VariantExecutionSpec>,
    pub fold_id: Option<FoldId>,
    #[serde(default)]
    pub branch_path: Vec<BranchId>,
    #[serde(default)]
    pub input_handles: BTreeMap<String, HandleRef>,
    #[serde(default)]
    pub data_views: BTreeMap<String, DataProviderViewSpec>,
    #[serde(default)]
    pub prediction_inputs: BTreeMap<String, PredictionInputSpec>,
    #[serde(default)]
    pub artifact_inputs: BTreeMap<String, ArtifactInputSpec>,
    /// Native-produced attestation templates for the training losses that must
    /// execute in this task. The order matches `node_plan.training_losses`
    /// after filtering for `phase`. A controller may copy an entry into its
    /// lineage only after the corresponding local or built-in loss succeeds.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub required_loss_attestations: Vec<LossExecutionAttestation>,
    /// Nested (inner) CV fold set for this node in the current outer fold, built
    /// by the runtime from the outer fold's training samples when an effective
    /// `inner_cv` policy applies (FIT_CV only). `None` otherwise. Leakage-safe by
    /// construction (inner ⊆ outer-train); see [`crate::fold::NestedCvSpec`].
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub inner_fold_set: Option<FoldSet>,
    #[serde(default, skip_serializing_if = "FitInfluenceTask::is_default")]
    pub fit_influence: FitInfluenceTask,
    pub seed: Option<u64>,
}

impl NodeTask {
    pub fn required_loss_attestations_for(
        node_plan: &NodePlan,
        phase: Phase,
    ) -> Result<Vec<LossExecutionAttestation>> {
        node_plan
            .training_losses_for_phase(phase)
            .map(|role| LossExecutionAttestation::for_role(role, phase))
            .collect()
    }

    pub fn validate_required_loss_attestations(&self) -> Result<()> {
        let expected = Self::required_loss_attestations_for(&self.node_plan, self.phase)?;
        if self.required_loss_attestations != expected {
            return Err(DagMlError::RuntimeValidation(format!(
                "task for node `{}` has loss execution requirements that do not match its ordered training losses for phase {:?}",
                self.node_plan.node_id, self.phase
            )));
        }
        Ok(())
    }

    /// Return one active training-loss role and its exact native attestation.
    /// The index addresses losses after filtering the node plan for the task's
    /// phase, avoiding any host-side reconstruction of role ordering.
    pub fn training_loss_binding(
        &self,
        role_index: usize,
    ) -> Result<(&TrainingLossRoleReference, &LossExecutionAttestation)> {
        if !matches!(self.phase, Phase::FitCv | Phase::Refit) {
            return Err(DagMlError::RuntimeValidation(
                "training loss phase must be FIT_CV or REFIT".to_string(),
            ));
        }
        self.validate_required_loss_attestations()?;
        let role = self
            .node_plan
            .training_losses_for_phase(self.phase)
            .nth(role_index)
            .ok_or_else(|| {
                DagMlError::RuntimeValidation(format!(
                    "role_index {role_index} is outside the active training loss range"
                ))
            })?;
        let attestation = self
            .required_loss_attestations
            .get(role_index)
            .ok_or_else(|| {
                DagMlError::RuntimeValidation(
                    "validated training loss role has no matching attestation".to_string(),
                )
            })?;
        Ok((role, attestation))
    }
}

/// Typed scheduler operation used to create one invocation-local HPO session.
/// It deliberately contains no graph `NodePlan`: the session controls variant
/// campaigns for `target_node_id`, while all predictor work remains in the
/// ordinary graph execution plan.
#[derive(Clone, Debug, PartialEq)]
pub struct RuntimeHpoCampaignTask {
    pub run_id: RunId,
    pub operation_id: String,
    pub controller_id: ControllerId,
    pub target_node_id: NodeId,
    pub seed: Option<u64>,
}

/// Immutable coordinator evidence for one execution-local HPO campaign.
///
/// This is deliberately passed beside the tuner [`NodeTask`] rather than
/// stored in the controller registry or serialized through a generic
/// controller invocation.  A tuner session may retain thread-affine native
/// state, but this context contains only portable coordinator facts.
#[derive(Clone, Debug, PartialEq)]
pub struct RuntimeHpoExecutionContext {
    /// Stable identity of this scheduler-owned campaign operation.  This is
    /// deliberately not a graph node: HPO controls variants of a predictor,
    /// it is not part of the predictor topology.
    pub operation_id: String,
    /// Registered controller which owns the invocation-local native session.
    pub controller_id: ControllerId,
    /// The model node evaluated for every proposal.
    pub target_node_id: NodeId,
    /// The unexpanded variant from which the tuner proposes candidates.
    pub base_variant: VariantPlan,
    /// Total native study budget across the initial run and every resumed
    /// scheduler call. This is never a per-call proposal count.
    pub trial_budget_total: u32,
    /// Typed native-study configuration owned by the registered tuner
    /// controller.  The scheduler never constructs or restores this study.
    pub study: crate::hpo::MethodsHpoStudyConfig,
    /// Native search-space output name -> direct target-model parameter key.
    /// The controller converts each proposal through this explicit mapping;
    /// the scheduler only receives the resulting normal [`VariantPlan`].
    pub parameter_paths: BTreeMap<String, String>,
    /// Optional opaque native state from a prior compatible campaign.  It is
    /// consumed only by the controller-local session factory and is never
    /// sent to scheduler workers.
    pub resume_checkpoint: Option<crate::hpo::N4moptCheckpointArtifact>,
    /// Completed scheduler proposals restored with the opaque optimizer. They
    /// give a native `best()` result its stable variant identity on resume.
    pub resume_variants: BTreeMap<i64, VariantId>,
    /// Full controller-attested native terminal ledger from the package being
    /// restored. The session compares this before it may ask another trial.
    pub resume_terminal_trials: Vec<RuntimeHpoTerminalSnapshot>,
    /// The OOF report produced by the scheduler which is fed back to the
    /// session after each candidate evaluation.
    pub selection: RuntimeHpoSelectionTarget,
    /// Immutable fingerprints which bind this campaign to the already
    /// attested plan, data identities, fold set and influence manifest.
    pub provenance: RuntimeHpoProvenance,
}

#[derive(Clone, Debug, PartialEq)]
pub struct RuntimeHpoSelectionTarget {
    pub producer_node: NodeId,
    pub producer_port: String,
    pub metric: RegressionMetricKind,
    pub direction: crate::hpo::HpoDirection,
}

#[derive(Clone, Debug, PartialEq)]
pub struct RuntimeHpoProvenance {
    pub graph_fingerprint: String,
    pub campaign_fingerprint: String,
    pub controller_fingerprint: String,
    pub data_identities_fingerprint: String,
    pub fold_set_fingerprint: Option<String>,
    pub training_influence_fingerprint: String,
    pub relation_fingerprint: String,
}

impl RuntimeHpoExecutionContext {
    pub fn validate_for_plan(&self, plan: &ExecutionPlan) -> Result<()> {
        if self.trial_budget_total == 0 {
            return Err(DagMlError::RuntimeValidation(
                "runtime HPO trial_budget_total must be positive".to_string(),
            ));
        }
        if self.study.controller_id.trim().is_empty()
            || self.study.study_id.trim().is_empty()
            || self.study.methods_abi.trim().is_empty()
        {
            return Err(DagMlError::RuntimeValidation(
                "runtime HPO study identity must not be empty".to_string(),
            ));
        }
        self.study.search_space.validate().map_err(|error| {
            DagMlError::RuntimeValidation(format!("runtime HPO search space is invalid: {error}"))
        })?;
        if self.parameter_paths.is_empty()
            || self.parameter_paths.keys().any(|key| key.trim().is_empty())
            || self
                .parameter_paths
                .values()
                .any(|value| value.trim().is_empty())
            || self.parameter_paths.values().collect::<BTreeSet<_>>().len()
                != self.parameter_paths.len()
        {
            return Err(DagMlError::RuntimeValidation(
                "runtime HPO parameter_paths must be non-empty and map each target parameter once"
                    .to_string(),
            ));
        }
        if let Some(checkpoint) = &self.resume_checkpoint {
            checkpoint.validate().map_err(|error| {
                DagMlError::RuntimeValidation(format!(
                    "runtime HPO resume checkpoint is invalid: {error}"
                ))
            })?;
        }
        if self.operation_id.trim().is_empty() {
            return Err(DagMlError::RuntimeValidation(
                "runtime HPO operation_id must not be empty".to_string(),
            ));
        }
        if self.selection.producer_port.trim().is_empty() {
            return Err(DagMlError::RuntimeValidation(
                "runtime HPO selection producer_port must not be empty".to_string(),
            ));
        }
        if self.selection.producer_node != self.target_node_id {
            return Err(DagMlError::RuntimeValidation(
                "runtime HPO selection producer must be the evaluated target node".to_string(),
            ));
        }
        if self.study.controller_id != self.controller_id.as_str() {
            return Err(DagMlError::RuntimeValidation(format!(
                "runtime HPO study controller `{}` does not match campaign controller `{}`",
                self.study.controller_id, self.controller_id
            )));
        }
        let target = plan.node_plans.get(&self.target_node_id).ok_or_else(|| {
            DagMlError::RuntimeValidation(format!(
                "runtime HPO target node `{}` is absent from the execution plan",
                self.target_node_id
            ))
        })?;
        if target.kind != crate::graph::NodeKind::Model {
            return Err(DagMlError::RuntimeValidation(format!(
                "runtime HPO target `{}` must be a model node",
                self.target_node_id
            )));
        }
        if !plan
            .variants
            .iter()
            .any(|variant| variant == &self.base_variant)
        {
            return Err(DagMlError::RuntimeValidation(
                "runtime HPO base_variant is not present in the execution plan".to_string(),
            ));
        }
        self.provenance.validate_for_plan(plan)
    }
}

impl RuntimeHpoProvenance {
    pub fn validate_for_plan(&self, plan: &ExecutionPlan) -> Result<()> {
        let campaign_fingerprint = crate::hpo::campaign_provenance_fingerprint(&plan.campaign)?;
        for (label, actual, expected) in [
            (
                "graph",
                plan.graph_fingerprint.as_str(),
                self.graph_fingerprint.as_str(),
            ),
            (
                "campaign",
                campaign_fingerprint.as_str(),
                self.campaign_fingerprint.as_str(),
            ),
            (
                "controller",
                plan.controller_fingerprint.as_str(),
                self.controller_fingerprint.as_str(),
            ),
        ] {
            if expected.trim().is_empty() || actual != expected {
                return Err(DagMlError::RuntimeValidation(format!(
                    "runtime HPO provenance does not match the execution-plan {label} fingerprint"
                )));
            }
        }
        for (label, value) in [
            ("data identities", self.data_identities_fingerprint.as_str()),
            (
                "training influence",
                self.training_influence_fingerprint.as_str(),
            ),
            ("relation", self.relation_fingerprint.as_str()),
        ] {
            if value.trim().is_empty() {
                return Err(DagMlError::RuntimeValidation(format!(
                    "runtime HPO provenance has an empty {label} fingerprint"
                )));
            }
        }
        let actual_fold_fingerprint = plan
            .fold_set
            .as_ref()
            .map(stable_json_fingerprint)
            .transpose()?;
        if self.fold_set_fingerprint != actual_fold_fingerprint {
            return Err(DagMlError::RuntimeValidation(
                "runtime HPO provenance does not match the execution-plan fold set".to_string(),
            ));
        }
        Ok(())
    }
}

/// One candidate proposed by a local tuner session.  It contains a normal
/// plan variant only; no native optimizer/context can cross the scheduler
/// boundary.
#[derive(Clone, Debug, PartialEq)]
pub struct RuntimeHpoProposal {
    pub trial_id: i64,
    pub variant: VariantPlan,
}

#[derive(Clone, Debug, PartialEq)]
pub struct RuntimeHpoIntermediate {
    pub trial_id: i64,
    pub step: i32,
    pub score: f64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RuntimeHpoFailure {
    pub code: String,
    pub message: String,
    pub retryable: bool,
}

#[derive(Clone, Debug, PartialEq)]
pub enum RuntimeHpoTerminal {
    Completed { score: f64 },
    Failed { failure: RuntimeHpoFailure },
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RuntimeHpoIntermediateOutcome {
    Continue,
    Pruned,
}

/// Scheduler-owned evidence retained for a successfully completed trial.
/// Candidate OOF data remains report-only and is never reused as a training
/// input; final SELECT/REFIT is intentionally outside this campaign call.
#[derive(Clone, Debug)]
pub struct RuntimeHpoCandidateEvaluation {
    pub proposal: RuntimeHpoProposal,
    pub score: f64,
    pub validation_reports: Vec<RegressionMetricReport>,
    pub validation_predictions: VariantValidationPredictions,
    pub lineage: Vec<LineageRecord>,
}

/// The one cross-fold OOF report which terminalized a completed native trial.
/// Keeping the native trial id beside report-grade scheduler evidence makes a
/// checkpoint resumable without asking libn4m to invent coordinator scores.
#[derive(Clone, Debug)]
pub struct RuntimeHpoCompletedReport {
    pub trial_id: i64,
    pub variant_id: VariantId,
    pub report: RegressionMetricReport,
}

/// Durable native optimizer state paired with exact coordinator evidence. No
/// native Context or Optimizer object crosses this boundary.
#[derive(Clone, Debug)]
pub struct RuntimeHpoCheckpointResult {
    pub artifact: crate::hpo::N4moptCheckpointArtifact,
    pub provenance: RuntimeHpoProvenance,
    pub operation_id: String,
    pub controller_id: ControllerId,
    pub target_node_id: NodeId,
    /// Exact completed proposals, including their patched model parameters and
    /// content fingerprints. A resumed coordinator must consume these values
    /// directly; reconstructing trial variants from a checkpoint is refused.
    pub completed_proposals: Vec<RuntimeHpoProposal>,
    pub completed_reports: Vec<RuntimeHpoCompletedReport>,
    /// Native study trial count after this scheduler call, including opaque
    /// historical failed/pruned trials restored by the local session.
    pub trial_history_len: u32,
}

/// One typed native incumbent, derived from the optimizer's `best()` only
/// after every scheduler-observed proposal has reached a terminal state.
#[derive(Clone, Debug, PartialEq)]
pub struct RuntimeHpoIncumbent {
    pub trial_id: i64,
    pub score: f64,
    pub metric: String,
    pub direction: crate::hpo::HpoDirection,
    pub variant_id: VariantId,
}

/// A controller-attested terminal native trial.  The native record is never
/// reconstructed from checkpoint bytes by DAG-ML; it is obtained only from
/// the invocation-local session which owns that checkpoint.
#[derive(Clone, Debug, PartialEq)]
pub struct RuntimeHpoTerminalSnapshot {
    pub trial: crate::hpo::HpoTrial,
    pub variant_id: Option<VariantId>,
}

#[derive(Clone, Debug)]
pub struct RuntimeHpoCampaignResult {
    pub operation_id: String,
    pub controller_id: ControllerId,
    pub target_node_id: NodeId,
    pub candidates: Vec<RuntimeHpoCandidateEvaluation>,
    /// Emitted only after all proposed trials have a scheduler-observed
    /// terminal state and their report evidence validates.
    pub checkpoint: RuntimeHpoCheckpointResult,
    pub incumbent: RuntimeHpoIncumbent,
    pub terminal_trials: Vec<RuntimeHpoTerminalSnapshot>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Ord, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FitInfluenceMechanism {
    UniformRows,
    SampleWeights,
    RowResampling,
    BackendLossWeights,
    ScorerOnly,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct FitInfluenceTask {
    pub requested_policy: FitInfluencePolicy,
    pub effective_policy: FitInfluencePolicy,
    pub mechanism: FitInfluenceMechanism,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub row_weights: Vec<f64>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub warnings: Vec<String>,
}

impl Default for FitInfluenceTask {
    fn default() -> Self {
        Self {
            requested_policy: FitInfluencePolicy::UniformRows,
            effective_policy: FitInfluencePolicy::UniformRows,
            mechanism: FitInfluenceMechanism::UniformRows,
            row_weights: Vec::new(),
            warnings: Vec::new(),
        }
    }
}

impl FitInfluenceTask {
    fn is_default(&self) -> bool {
        self == &Self::default()
    }

    pub fn diagnostic(&self) -> FitInfluenceDiagnostic {
        FitInfluenceDiagnostic {
            requested_policy: self.requested_policy,
            effective_policy: self.effective_policy,
            mechanism: self.mechanism,
            fallback_used: !self.warnings.is_empty(),
            row_weight_count: self.row_weights.len(),
            warnings: self.warnings.clone(),
        }
    }

    pub fn validate(&self) -> Result<()> {
        if !self
            .row_weights
            .iter()
            .all(|weight| weight.is_finite() && *weight > 0.0)
        {
            return Err(DagMlError::RuntimeValidation(
                "fit influence row_weights must be finite and > 0".to_string(),
            ));
        }
        if self
            .warnings
            .iter()
            .any(|warning| warning.trim().is_empty())
        {
            return Err(DagMlError::RuntimeValidation(
                "fit influence warnings must not be empty".to_string(),
            ));
        }
        match self.effective_policy {
            FitInfluencePolicy::EqualSampleInfluence | FitInfluencePolicy::BackendLossWeight
                if self.row_weights.is_empty() =>
            {
                return Err(DagMlError::RuntimeValidation(format!(
                    "fit influence {:?} requires row_weights",
                    self.effective_policy
                )));
            }
            _ => {}
        }
        if self.requested_policy == FitInfluencePolicy::StrictWeightSupport
            && self.effective_policy == FitInfluencePolicy::UniformRows
        {
            return Err(DagMlError::RuntimeValidation(
                "strict fit influence cannot fall back to uniform_rows".to_string(),
            ));
        }
        Ok(())
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FitInfluenceDiagnostic {
    pub requested_policy: FitInfluencePolicy,
    pub effective_policy: FitInfluencePolicy,
    pub mechanism: FitInfluenceMechanism,
    #[serde(default)]
    pub fallback_used: bool,
    #[serde(default)]
    pub row_weight_count: usize,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub warnings: Vec<String>,
}

impl FitInfluenceDiagnostic {
    pub fn validate(&self, task: &NodeTask) -> Result<()> {
        if self.requested_policy != task.fit_influence.requested_policy {
            return Err(DagMlError::RuntimeValidation(format!(
                "fit influence diagnostic requested_policy {:?} does not match task {:?}",
                self.requested_policy, task.fit_influence.requested_policy
            )));
        }
        if self.effective_policy != task.fit_influence.effective_policy {
            return Err(DagMlError::RuntimeValidation(format!(
                "fit influence diagnostic effective_policy {:?} does not match task {:?}",
                self.effective_policy, task.fit_influence.effective_policy
            )));
        }
        if self.mechanism != task.fit_influence.mechanism {
            return Err(DagMlError::RuntimeValidation(format!(
                "fit influence diagnostic mechanism {:?} does not match task {:?}",
                self.mechanism, task.fit_influence.mechanism
            )));
        }
        if self.row_weight_count != task.fit_influence.row_weights.len() {
            return Err(DagMlError::RuntimeValidation(format!(
                "fit influence diagnostic row_weight_count {} does not match task {}",
                self.row_weight_count,
                task.fit_influence.row_weights.len()
            )));
        }
        if self.fallback_used == task.fit_influence.warnings.is_empty() {
            return Err(DagMlError::RuntimeValidation(
                "fit influence diagnostic fallback_used does not match task warnings".to_string(),
            ));
        }
        if self.warnings != task.fit_influence.warnings {
            return Err(DagMlError::RuntimeValidation(
                "fit influence diagnostic warnings do not match task warnings".to_string(),
            ));
        }
        if self
            .warnings
            .iter()
            .any(|warning| warning.trim().is_empty())
        {
            return Err(DagMlError::RuntimeValidation(
                "fit influence diagnostic warnings must not be empty".to_string(),
            ));
        }
        Ok(())
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct VariantExecutionSpec {
    pub variant_id: VariantId,
    #[serde(default)]
    pub choices: BTreeMap<String, GenerationChoice>,
    pub fingerprint: String,
    pub seed: Option<u64>,
}

impl VariantExecutionSpec {
    pub fn from_plan(variant: &VariantPlan) -> Self {
        Self {
            variant_id: variant.variant_id.clone(),
            choices: variant.choices.clone(),
            fingerprint: variant.fingerprint.clone(),
            seed: variant.seed,
        }
    }

    pub fn validate(&self) -> Result<()> {
        if self.fingerprint.trim().is_empty() {
            return Err(DagMlError::RuntimeValidation(format!(
                "variant `{}` has an empty fingerprint in task context",
                self.variant_id
            )));
        }
        for (dimension_name, choice) in &self.choices {
            if dimension_name.trim().is_empty() {
                return Err(DagMlError::RuntimeValidation(format!(
                    "variant `{}` has an empty generation dimension name",
                    self.variant_id
                )));
            }
            if choice.label.trim().is_empty() {
                return Err(DagMlError::RuntimeValidation(format!(
                    "variant `{}` has an empty choice label for dimension `{dimension_name}`",
                    self.variant_id
                )));
            }
            for override_spec in &choice.param_overrides {
                if override_spec.params.is_empty() {
                    return Err(DagMlError::RuntimeValidation(format!(
                        "variant `{}` has an empty param override for node `{}`",
                        self.variant_id, override_spec.node_id
                    )));
                }
                for param_key in override_spec.params.keys() {
                    if param_key.trim().is_empty() {
                        return Err(DagMlError::RuntimeValidation(format!(
                            "variant `{}` has an empty param override key for node `{}`",
                            self.variant_id, override_spec.node_id
                        )));
                    }
                }
            }
        }
        self.param_overrides_by_node()?;
        Ok(())
    }

    pub fn effective_params_for_node(
        &self,
        node_id: &NodeId,
        base_params: &BTreeMap<String, serde_json::Value>,
    ) -> Result<BTreeMap<String, serde_json::Value>> {
        let overrides_by_node = self.param_overrides_by_node()?;
        let Some(overrides) = overrides_by_node.get(node_id) else {
            return Ok(base_params.clone());
        };
        let mut params = base_params.clone();
        params.extend(overrides.clone());
        Ok(params)
    }

    fn param_overrides_by_node(
        &self,
    ) -> Result<BTreeMap<NodeId, BTreeMap<String, serde_json::Value>>> {
        let mut overrides = BTreeMap::<NodeId, BTreeMap<String, serde_json::Value>>::new();
        let mut owners = BTreeMap::<(NodeId, String), String>::new();
        for (dimension_name, choice) in &self.choices {
            for override_spec in &choice.param_overrides {
                for (param_key, value) in &override_spec.params {
                    let owner_key = (override_spec.node_id.clone(), param_key.clone());
                    if let Some(previous) =
                        owners.insert(owner_key, format!("{dimension_name}:{}", choice.label))
                    {
                        return Err(DagMlError::RuntimeValidation(format!(
                            "variant `{}` has conflicting generation overrides for `{}.{}` from `{previous}` and `{}:{}`",
                            self.variant_id,
                            override_spec.node_id,
                            param_key,
                            dimension_name,
                            choice.label
                        )));
                    }
                    overrides
                        .entry(override_spec.node_id.clone())
                        .or_default()
                        .insert(param_key.clone(), value.clone());
                }
            }
        }
        Ok(overrides)
    }
}

/// An EXPLAIN-phase output block (ADR-12 explain contract). Explanations are a
/// node *output* returned in the [`NodeResult`] — like predictions, they cross as
/// data, not as an opaque host handle. The `payload` shape is controller-defined
/// (e.g. per-feature importances); the core does not interpret it. Explanations
/// are only valid in the `EXPLAIN` phase.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExplanationBlock {
    /// Node whose model the explanation describes (must equal the producing node).
    pub producer_node: NodeId,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub producer_port: Option<String>,
    /// Stable explanation method identifier, e.g. `shap`, `permutation_importance`.
    pub method: String,
    /// Optional target/output name the explanation pertains to.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target_name: Option<String>,
    /// Controller-defined explanation payload as canonical JSON.
    pub payload: serde_json::Value,
}

impl ExplanationBlock {
    /// Validate the intrinsic shape of the explanation block (method/target_name
    /// non-empty). Producer identity is checked against the node in
    /// [`NodeResult::validate_for_task`].
    pub fn validate(&self) -> Result<()> {
        if self.method.trim().is_empty() {
            return Err(DagMlError::RuntimeValidation(
                "explanation method must be a non-empty identifier".to_string(),
            ));
        }
        if let Some(name) = &self.target_name {
            if name.trim().is_empty() {
                return Err(DagMlError::RuntimeValidation(
                    "explanation target_name must be non-empty when present".to_string(),
                ));
            }
        }
        Ok(())
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NodeResult {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub schema_version: Option<u32>,
    pub node_id: NodeId,
    #[serde(default)]
    pub outputs: BTreeMap<String, HandleRef>,
    #[serde(default)]
    pub predictions: Vec<PredictionBlock>,
    #[serde(default)]
    pub observation_predictions: Vec<ObservationPredictionBlock>,
    #[serde(default)]
    pub aggregated_predictions: Vec<AggregatedPredictionBlock>,
    #[serde(default)]
    pub explanations: Vec<ExplanationBlock>,
    #[serde(default)]
    pub shape_deltas: Vec<ShapeDelta>,
    #[serde(default)]
    pub artifacts: Vec<ArtifactRef>,
    #[serde(default)]
    pub artifact_handles: BTreeMap<ArtifactId, HandleRef>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub fit_influence_diagnostics: Vec<FitInfluenceDiagnostic>,
    /// Optional ground-truth targets the host controller emits alongside predictions so the core
    /// can score natively (the runtime never sees feature matrices; `y_true` is data-tier and may
    /// cross the ABI per the ownership table). Each block is identity-keyed by `unit_ids`.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub regression_targets: Vec<RegressionTargetBlock>,
    pub lineage: LineageRecord,
}

impl NodeResult {
    pub fn validate_for_task(&self, task: &NodeTask) -> Result<()> {
        if self.node_id != task.node_plan.node_id {
            return Err(DagMlError::RuntimeValidation(format!(
                "task for `{}` returned result for `{}`",
                task.node_plan.node_id, self.node_id
            )));
        }
        if self.lineage.node_id != task.node_plan.node_id {
            return Err(DagMlError::RuntimeValidation(format!(
                "lineage for task `{}` references node `{}`",
                task.node_plan.node_id, self.lineage.node_id
            )));
        }
        if self.lineage.phase != task.phase {
            return Err(DagMlError::RuntimeValidation(format!(
                "lineage for node `{}` has phase {:?}, expected {:?}",
                task.node_plan.node_id, self.lineage.phase, task.phase
            )));
        }
        if self.lineage.run_id != task.run_id {
            return Err(DagMlError::RuntimeValidation(format!(
                "lineage for node `{}` has run `{}`, expected `{}`",
                task.node_plan.node_id, self.lineage.run_id, task.run_id
            )));
        }
        if self.lineage.controller_id != task.node_plan.controller_id {
            return Err(DagMlError::RuntimeValidation(format!(
                "lineage for node `{}` has controller `{}`, expected `{}`",
                task.node_plan.node_id, self.lineage.controller_id, task.node_plan.controller_id
            )));
        }
        if self.lineage.controller_version != task.node_plan.controller_version {
            return Err(DagMlError::RuntimeValidation(format!(
                "lineage for node `{}` has controller version `{}`, expected `{}`",
                task.node_plan.node_id,
                self.lineage.controller_version,
                task.node_plan.controller_version
            )));
        }
        if self.lineage.variant_id != task.variant_id {
            return Err(DagMlError::RuntimeValidation(format!(
                "lineage for node `{}` has variant {:?}, expected {:?}",
                task.node_plan.node_id, self.lineage.variant_id, task.variant_id
            )));
        }
        if let Some(variant) = &task.variant {
            variant.validate()?;
            if Some(&variant.variant_id) != task.variant_id.as_ref() {
                return Err(DagMlError::RuntimeValidation(format!(
                    "task for node `{}` has variant context `{}` but variant_id {:?}",
                    task.node_plan.node_id, variant.variant_id, task.variant_id
                )));
            }
        }
        if self.lineage.fold_id != task.fold_id {
            return Err(DagMlError::RuntimeValidation(format!(
                "lineage for node `{}` has fold {:?}, expected {:?}",
                task.node_plan.node_id, self.lineage.fold_id, task.fold_id
            )));
        }
        if self.lineage.branch_path != task.branch_path {
            return Err(DagMlError::RuntimeValidation(format!(
                "lineage for node `{}` has branch path {:?}, expected {:?}",
                task.node_plan.node_id, self.lineage.branch_path, task.branch_path
            )));
        }
        if self.lineage.seed != task.seed {
            return Err(DagMlError::RuntimeValidation(format!(
                "lineage for node `{}` has seed {:?}, expected {:?}",
                task.node_plan.node_id, self.lineage.seed, task.seed
            )));
        }
        if self.lineage.params_fingerprint != task.node_plan.params_fingerprint {
            return Err(DagMlError::RuntimeValidation(format!(
                "lineage for node `{}` has params fingerprint `{}`, expected `{}`",
                task.node_plan.node_id,
                self.lineage.params_fingerprint,
                task.node_plan.params_fingerprint
            )));
        }
        task.validate_required_loss_attestations()?;
        let expected_losses = task
            .node_plan
            .training_losses_for_phase(task.phase)
            .collect::<Vec<_>>();
        if self.lineage.loss_attestations.len() != expected_losses.len() {
            return Err(DagMlError::RuntimeValidation(format!(
                "node `{}` returned {} loss attestations for {} resolved losses in phase {:?}",
                task.node_plan.node_id,
                self.lineage.loss_attestations.len(),
                expected_losses.len(),
                task.phase
            )));
        }
        for (attestation, role) in self.lineage.loss_attestations.iter().zip(expected_losses) {
            attestation.validate_against(role, &task.node_plan.node_id, task.phase)?;
        }
        if self.lineage.loss_attestations != task.required_loss_attestations {
            return Err(DagMlError::RuntimeValidation(format!(
                "node `{}` returned loss attestations that do not match the task requirements",
                task.node_plan.node_id
            )));
        }
        task.fit_influence.validate()?;
        for diagnostic in &self.fit_influence_diagnostics {
            diagnostic.validate(task)?;
        }
        validate_lineage_shape_fingerprints(&self.lineage, task)?;
        if !self.explanations.is_empty() && task.phase != Phase::Explain {
            return Err(DagMlError::RuntimeValidation(format!(
                "node `{}` returned explanations outside the EXPLAIN phase",
                task.node_plan.node_id
            )));
        }
        for explanation in &self.explanations {
            explanation.validate()?;
            if explanation.producer_node != self.node_id {
                return Err(DagMlError::RuntimeValidation(format!(
                    "node `{}` returned an explanation produced by `{}`",
                    self.node_id, explanation.producer_node
                )));
            }
        }
        for (port, handle) in &self.outputs {
            if handle.owner_controller != task.node_plan.controller_id {
                return Err(DagMlError::RuntimeValidation(format!(
                    "node `{}` output `{port}` is owned by `{}`, expected `{}`",
                    task.node_plan.node_id, handle.owner_controller, task.node_plan.controller_id
                )));
            }
        }
        let mut artifact_ids = BTreeSet::new();
        for artifact in &self.artifacts {
            artifact.validate()?;
            if !artifact_ids.insert(artifact.id.clone()) {
                return Err(DagMlError::RuntimeValidation(format!(
                    "node `{}` emitted duplicate artifact `{}`",
                    task.node_plan.node_id, artifact.id
                )));
            }
            if artifact.controller_id != task.node_plan.controller_id {
                return Err(DagMlError::RuntimeValidation(format!(
                    "node `{}` emitted artifact `{}` for controller `{}`, expected `{}`",
                    task.node_plan.node_id,
                    artifact.id,
                    artifact.controller_id,
                    task.node_plan.controller_id
                )));
            }
            let handle = self.artifact_handles.get(&artifact.id).ok_or_else(|| {
                DagMlError::RuntimeValidation(format!(
                    "node `{}` emitted artifact `{}` without artifact handle",
                    task.node_plan.node_id, artifact.id
                ))
            })?;
            if !matches!(handle.kind, HandleKind::Model | HandleKind::Artifact) {
                return Err(DagMlError::RuntimeValidation(format!(
                    "node `{}` emitted artifact `{}` with non-artifact/model handle kind {:?}",
                    task.node_plan.node_id, artifact.id, handle.kind
                )));
            }
            if handle.owner_controller != task.node_plan.controller_id {
                return Err(DagMlError::RuntimeValidation(format!(
                    "node `{}` emitted artifact `{}` owned by `{}`, expected `{}`",
                    task.node_plan.node_id,
                    artifact.id,
                    handle.owner_controller,
                    task.node_plan.controller_id
                )));
            }
        }
        for artifact_id in self.artifact_handles.keys() {
            if !self
                .artifacts
                .iter()
                .any(|artifact| &artifact.id == artifact_id)
            {
                return Err(DagMlError::RuntimeValidation(format!(
                    "node `{}` emitted artifact handle for undeclared artifact `{artifact_id}`",
                    task.node_plan.node_id
                )));
            }
        }
        for artifact in &self.artifacts {
            if !self
                .lineage
                .artifact_refs
                .iter()
                .any(|lineage_artifact| lineage_artifact == artifact)
            {
                return Err(DagMlError::RuntimeValidation(format!(
                    "node `{}` emitted artifact `{}` without matching lineage artifact ref",
                    task.node_plan.node_id, artifact.id
                )));
            }
        }
        for artifact in &self.lineage.artifact_refs {
            if !self
                .artifacts
                .iter()
                .any(|emitted_artifact| emitted_artifact == artifact)
            {
                return Err(DagMlError::RuntimeValidation(format!(
                    "node `{}` lineage references undeclared artifact `{}`",
                    task.node_plan.node_id, artifact.id
                )));
            }
        }
        for prediction in &self.predictions {
            prediction.validate_shape()?;
            if prediction.producer_node != task.node_plan.node_id {
                return Err(DagMlError::RuntimeValidation(format!(
                    "node `{}` emitted prediction for producer `{}`",
                    task.node_plan.node_id, prediction.producer_node
                )));
            }
            validate_prediction_scope(prediction, task)?;
        }
        for prediction in &self.observation_predictions {
            prediction.validate_shape()?;
            if prediction.producer_node != task.node_plan.node_id {
                return Err(DagMlError::RuntimeValidation(format!(
                    "node `{}` emitted observation prediction for producer `{}`",
                    task.node_plan.node_id, prediction.producer_node
                )));
            }
            validate_observation_prediction_scope(prediction, task)?;
        }
        for prediction in &self.aggregated_predictions {
            prediction.validate_shape()?;
            if prediction.producer_node != task.node_plan.node_id {
                return Err(DagMlError::RuntimeValidation(format!(
                    "node `{}` emitted aggregated prediction for producer `{}`",
                    task.node_plan.node_id, prediction.producer_node
                )));
            }
            validate_aggregated_prediction_scope(prediction, task)?;
        }
        for delta in &self.shape_deltas {
            delta.validate()?;
            if delta.node_id != task.node_plan.node_id {
                return Err(DagMlError::RuntimeValidation(format!(
                    "node `{}` emitted shape delta for `{}`",
                    task.node_plan.node_id, delta.node_id
                )));
            }
            validate_shape_delta_for_task(delta, task)?;
        }
        for target in &self.regression_targets {
            target.validate_shape()?;
        }
        self.lineage.validate()
    }
}

pub(crate) fn validate_lineage_shape_fingerprints(
    lineage: &LineageRecord,
    task: &NodeTask,
) -> Result<()> {
    let Some(shape_plan) = &task.node_plan.shape_plan else {
        if lineage.data_model_shape_fingerprint.is_some()
            || lineage.aggregation_policy_fingerprint.is_some()
        {
            return Err(DagMlError::RuntimeValidation(format!(
                "lineage for node `{}` carries shape fingerprints but the node has no shape plan",
                task.node_plan.node_id
            )));
        }
        return Ok(());
    };

    if let Some(actual) = &lineage.data_model_shape_fingerprint {
        let expected = stable_json_fingerprint(shape_plan)?;
        if actual != &expected {
            return Err(DagMlError::RuntimeValidation(format!(
                "lineage for node `{}` has data/model shape fingerprint `{actual}`, expected `{expected}`",
                task.node_plan.node_id
            )));
        }
    }
    if let Some(actual) = &lineage.aggregation_policy_fingerprint {
        let expected = stable_json_fingerprint(&shape_plan.aggregation_policy)?;
        if actual != &expected {
            return Err(DagMlError::RuntimeValidation(format!(
                "lineage for node `{}` has aggregation policy fingerprint `{actual}`, expected `{expected}`",
                task.node_plan.node_id
            )));
        }
    }
    Ok(())
}

pub(crate) fn validate_shape_delta_for_task(delta: &ShapeDelta, task: &NodeTask) -> Result<()> {
    let Some(shape_plan) = &task.node_plan.shape_plan else {
        return Ok(());
    };
    if delta.kind == ShapeDeltaKind::Feature {
        if let Some(expected) = &shape_plan.feature_schema_fingerprint {
            if &delta.before_fingerprint != expected {
                return Err(DagMlError::RuntimeValidation(format!(
                    "node `{}` emitted feature shape delta from `{}`, expected current schema `{expected}`",
                    task.node_plan.node_id, delta.before_fingerprint
                )));
            }
        }
    }
    Ok(())
}

pub(crate) fn validate_prediction_scope(
    prediction: &PredictionBlock,
    task: &NodeTask,
) -> Result<()> {
    if prediction.partition != PredictionPartition::Validation {
        return Ok(());
    }
    if prediction.fold_id != task.fold_id {
        return Err(DagMlError::RuntimeValidation(format!(
            "node `{}` emitted validation predictions for fold {:?}, expected {:?}",
            task.node_plan.node_id, prediction.fold_id, task.fold_id
        )));
    }
    if task.phase == Phase::FitCv
        && task.fold_id.is_some()
        && (!task.node_plan.data_bindings.is_empty() || !task.data_views.is_empty())
    {
        let validation_sample_ids = validation_view_sample_ids(task).ok_or_else(|| {
            DagMlError::RuntimeValidation(format!(
                "node `{}` emitted validation predictions without a fold-validation data view",
                task.node_plan.node_id
            ))
        })?;
        for sample_id in &prediction.sample_ids {
            if !validation_sample_ids.contains(sample_id) {
                return Err(DagMlError::RuntimeValidation(format!(
                    "node `{}` emitted validation prediction for sample `{}` outside its validation view",
                    task.node_plan.node_id, sample_id
                )));
            }
        }
    }
    Ok(())
}

pub(crate) fn validate_observation_prediction_scope(
    prediction: &ObservationPredictionBlock,
    task: &NodeTask,
) -> Result<()> {
    if prediction.partition != PredictionPartition::Validation {
        return Ok(());
    }
    if prediction.fold_id != task.fold_id {
        return Err(DagMlError::RuntimeValidation(format!(
            "node `{}` emitted observation validation predictions for fold {:?}, expected {:?}",
            task.node_plan.node_id, prediction.fold_id, task.fold_id
        )));
    }
    Ok(())
}

pub(crate) fn validate_aggregated_prediction_scope(
    prediction: &AggregatedPredictionBlock,
    task: &NodeTask,
) -> Result<()> {
    if prediction.partition != PredictionPartition::Validation {
        return Ok(());
    }
    if prediction.fold_id != task.fold_id {
        return Err(DagMlError::RuntimeValidation(format!(
            "node `{}` emitted aggregated validation predictions for fold {:?}, expected {:?}",
            task.node_plan.node_id, prediction.fold_id, task.fold_id
        )));
    }
    // Sample-level aggregated validation units must stay inside this fold's
    // validation view, mirroring `validate_prediction_scope`. Target / group
    // units are checked against their relation set in the aggregation path.
    if prediction.level == PredictionLevel::Sample
        && task.phase == Phase::FitCv
        && task.fold_id.is_some()
        && (!task.node_plan.data_bindings.is_empty() || !task.data_views.is_empty())
    {
        if let Some(validation_sample_ids) = validation_view_sample_ids(task) {
            for unit_id in &prediction.unit_ids {
                if let PredictionUnitId::Sample(sample_id) = unit_id {
                    if !validation_sample_ids.contains(sample_id) {
                        return Err(DagMlError::RuntimeValidation(format!(
                            "node `{}` emitted aggregated validation prediction for sample `{}` outside its validation view",
                            task.node_plan.node_id, sample_id
                        )));
                    }
                }
            }
        }
    }
    Ok(())
}

pub(crate) fn validation_view_sample_ids(task: &NodeTask) -> Option<BTreeSet<SampleId>> {
    let mut sample_ids = BTreeSet::new();
    for view in task
        .data_views
        .values()
        .filter(|view| view.partition == DataRequestPartition::FoldValidation)
    {
        if let Some(view_sample_ids) = &view.sample_ids {
            sample_ids.extend(view_sample_ids.iter().cloned());
        }
    }
    (!sample_ids.is_empty()).then_some(sample_ids)
}

pub(crate) fn fit_influence_task_for_node(
    plan: &ExecutionPlan,
    node_plan: &NodePlan,
    data_views: &BTreeMap<String, DataProviderViewSpec>,
) -> Result<FitInfluenceTask> {
    let manifest = plan
        .controller_manifests
        .get(&node_plan.controller_id)
        .ok_or_else(|| {
            DagMlError::RuntimeValidation(format!(
                "node `{}` references missing controller manifest `{}`",
                node_plan.node_id, node_plan.controller_id
            ))
        })?;
    let Some(model_input_spec) = manifest.model_input_spec()? else {
        return Ok(FitInfluenceTask::default());
    };
    let Some(requested_policy) = model_input_spec.fit_influence_policy else {
        return Ok(FitInfluenceTask::default());
    };
    resolve_fit_influence_task(
        requested_policy,
        &node_plan.controller_capabilities,
        data_views,
    )
}

pub(crate) fn resolve_fit_influence_task(
    requested_policy: FitInfluencePolicy,
    capabilities: &BTreeSet<ControllerCapability>,
    data_views: &BTreeMap<String, DataProviderViewSpec>,
) -> Result<FitInfluenceTask> {
    let row_weights = equal_sample_influence_weights(data_views);
    match requested_policy {
        FitInfluencePolicy::UniformRows => Ok(FitInfluenceTask {
            requested_policy,
            effective_policy: FitInfluencePolicy::UniformRows,
            mechanism: FitInfluenceMechanism::UniformRows,
            row_weights: Vec::new(),
            warnings: Vec::new(),
        }),
        FitInfluencePolicy::ScorerOnly => Ok(FitInfluenceTask {
            requested_policy,
            effective_policy: FitInfluencePolicy::ScorerOnly,
            mechanism: FitInfluenceMechanism::ScorerOnly,
            row_weights: Vec::new(),
            warnings: Vec::new(),
        }),
        FitInfluencePolicy::EqualSampleInfluence => {
            require_fit_influence_support(capabilities, requested_policy)?;
            let weights = row_weights.ok_or_else(|| {
                DagMlError::RuntimeValidation(
                    "equal_sample_influence requires task row sample ids".to_string(),
                )
            })?;
            Ok(FitInfluenceTask {
                requested_policy,
                effective_policy: FitInfluencePolicy::EqualSampleInfluence,
                mechanism: FitInfluenceMechanism::SampleWeights,
                row_weights: weights,
                warnings: Vec::new(),
            })
        }
        FitInfluencePolicy::ResampleEqualized => {
            require_fit_influence_support(capabilities, requested_policy)?;
            Ok(FitInfluenceTask {
                requested_policy,
                effective_policy: FitInfluencePolicy::ResampleEqualized,
                mechanism: FitInfluenceMechanism::RowResampling,
                row_weights: Vec::new(),
                warnings: Vec::new(),
            })
        }
        FitInfluencePolicy::BackendLossWeight => {
            require_fit_influence_support(capabilities, requested_policy)?;
            let weights = row_weights.ok_or_else(|| {
                DagMlError::RuntimeValidation(
                    "backend_loss_weight requires task row sample ids".to_string(),
                )
            })?;
            Ok(FitInfluenceTask {
                requested_policy,
                effective_policy: FitInfluencePolicy::BackendLossWeight,
                mechanism: FitInfluenceMechanism::BackendLossWeights,
                row_weights: weights,
                warnings: Vec::new(),
            })
        }
        FitInfluencePolicy::StrictWeightSupport => {
            require_fit_influence_support(capabilities, requested_policy)?;
            strict_fit_influence_task(capabilities, row_weights, requested_policy)
        }
        FitInfluencePolicy::Auto => Ok(auto_fit_influence_task(capabilities, row_weights)),
    }
}

pub(crate) fn require_fit_influence_support(
    capabilities: &BTreeSet<ControllerCapability>,
    policy: FitInfluencePolicy,
) -> Result<()> {
    if capabilities_support_fit_influence(capabilities, policy) {
        return Ok(());
    }
    Err(DagMlError::RuntimeValidation(format!(
        "controller capabilities do not support requested fit influence policy {:?}",
        policy
    )))
}

pub(crate) fn strict_fit_influence_task(
    capabilities: &BTreeSet<ControllerCapability>,
    row_weights: Option<Vec<f64>>,
    requested_policy: FitInfluencePolicy,
) -> Result<FitInfluenceTask> {
    if capabilities.contains(&ControllerCapability::SupportsBackendLossWeights) {
        let weights = row_weights.ok_or_else(|| {
            DagMlError::RuntimeValidation(
                "strict_weight_support with backend loss weights requires task row sample ids"
                    .to_string(),
            )
        })?;
        return Ok(FitInfluenceTask {
            requested_policy,
            effective_policy: FitInfluencePolicy::BackendLossWeight,
            mechanism: FitInfluenceMechanism::BackendLossWeights,
            row_weights: weights,
            warnings: Vec::new(),
        });
    }
    if capabilities.contains(&ControllerCapability::SupportsSampleWeights) {
        let weights = row_weights.ok_or_else(|| {
            DagMlError::RuntimeValidation(
                "strict_weight_support with sample weights requires task row sample ids"
                    .to_string(),
            )
        })?;
        return Ok(FitInfluenceTask {
            requested_policy,
            effective_policy: FitInfluencePolicy::EqualSampleInfluence,
            mechanism: FitInfluenceMechanism::SampleWeights,
            row_weights: weights,
            warnings: Vec::new(),
        });
    }
    Ok(FitInfluenceTask {
        requested_policy,
        effective_policy: FitInfluencePolicy::ResampleEqualized,
        mechanism: FitInfluenceMechanism::RowResampling,
        row_weights: Vec::new(),
        warnings: Vec::new(),
    })
}

pub(crate) fn auto_fit_influence_task(
    capabilities: &BTreeSet<ControllerCapability>,
    row_weights: Option<Vec<f64>>,
) -> FitInfluenceTask {
    if capabilities.contains(&ControllerCapability::SupportsSampleWeights) {
        if let Some(weights) = row_weights.clone() {
            return FitInfluenceTask {
                requested_policy: FitInfluencePolicy::Auto,
                effective_policy: FitInfluencePolicy::EqualSampleInfluence,
                mechanism: FitInfluenceMechanism::SampleWeights,
                row_weights: weights,
                warnings: Vec::new(),
            };
        }
    }
    if capabilities.contains(&ControllerCapability::SupportsRowResampling) {
        return FitInfluenceTask {
            requested_policy: FitInfluencePolicy::Auto,
            effective_policy: FitInfluencePolicy::ResampleEqualized,
            mechanism: FitInfluenceMechanism::RowResampling,
            row_weights: Vec::new(),
            warnings: Vec::new(),
        };
    }
    if capabilities.contains(&ControllerCapability::SupportsBackendLossWeights) {
        if let Some(weights) = row_weights {
            return FitInfluenceTask {
                requested_policy: FitInfluencePolicy::Auto,
                effective_policy: FitInfluencePolicy::BackendLossWeight,
                mechanism: FitInfluenceMechanism::BackendLossWeights,
                row_weights: weights,
                warnings: Vec::new(),
            };
        }
    }
    FitInfluenceTask {
        requested_policy: FitInfluencePolicy::Auto,
        effective_policy: FitInfluencePolicy::UniformRows,
        mechanism: FitInfluenceMechanism::UniformRows,
        row_weights: Vec::new(),
        warnings: vec![
            "auto fit influence fell back to uniform_rows because no supported weighting capability was usable".to_string(),
        ],
    }
}

pub(crate) fn equal_sample_influence_weights(
    data_views: &BTreeMap<String, DataProviderViewSpec>,
) -> Option<Vec<f64>> {
    let row_sample_ids = data_views
        .values()
        .filter(|view| {
            matches!(
                view.partition,
                DataRequestPartition::FoldTrain | DataRequestPartition::FullTrain
            )
        })
        .filter_map(|view| view.sample_ids.as_ref())
        .find(|sample_ids| !sample_ids.is_empty())
        .or_else(|| {
            data_views
                .values()
                .filter_map(|view| view.sample_ids.as_ref())
                .find(|sample_ids| !sample_ids.is_empty())
        })?;
    let mut counts = BTreeMap::<&SampleId, usize>::new();
    for sample_id in row_sample_ids {
        *counts.entry(sample_id).or_default() += 1;
    }
    Some(
        row_sample_ids
            .iter()
            .map(|sample_id| 1.0 / *counts.get(sample_id).expect("counted sample id") as f64)
            .collect(),
    )
}

pub(crate) fn record_fit_influence_diagnostic(task: &NodeTask, result: &mut NodeResult) {
    if task.fit_influence.is_default() || !result.fit_influence_diagnostics.is_empty() {
        return;
    }
    result
        .fit_influence_diagnostics
        .push(task.fit_influence.diagnostic());
}
