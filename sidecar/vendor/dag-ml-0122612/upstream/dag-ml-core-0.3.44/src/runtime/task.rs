// Auto-split from the former monolithic `runtime.rs` (pure refactor).
use super::*;
use crate::TrainingLossRoleReference;

fn valid_sha256_fingerprint(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

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
    /// Missing prediction features, distinct from target-label validity and
    /// authentic probability distributions. Both fields are absent on legacy
    /// complete inputs; false cells must contain explicit zero placeholders.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub feature_validity_masks: Option<Vec<Vec<bool>>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_presence: Option<Vec<bool>>,
    pub prediction_width: usize,
    #[serde(default)]
    pub target_names: Vec<String>,
}

impl PredictionInputSpec {
    pub fn validate_feature_availability(&self) -> Result<()> {
        match (&self.feature_validity_masks, &self.source_presence) {
            (None, None) => Ok(()),
            (Some(masks), Some(presence)) => {
                if self.prediction_level != PredictionLevel::Sample
                    || self.prediction_width == 0
                    || masks.len() != self.sample_ids.len()
                    || presence.len() != self.sample_ids.len()
                    || self.values.len() != self.sample_ids.len()
                    || masks
                        .iter()
                        .zip(&self.values)
                        .zip(presence)
                        .any(|((mask, row), present)| {
                            mask.len() != self.prediction_width
                                || row.len() != self.prediction_width
                                || mask.iter().any(|cell| cell != present)
                                || row.iter().any(|value| !value.is_finite())
                                || (!*present && row.iter().any(|value| *value != 0.0))
                        })
                {
                    return Err(DagMlError::OofValidation(format!(
                        "prediction input `{}.{}` has invalid feature availability",
                        self.producer_node, self.source_port
                    )));
                }
                Ok(())
            }
            _ => Err(DagMlError::OofValidation(
                "prediction feature validity and source presence must be supplied together".into(),
            )),
        }
    }
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

/// Operation observed by the Python host at a model wrapper call boundary.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ModelInputOperation {
    Fit,
    Predict,
    PredictProba,
}

/// Host report captured at the model call boundary. Digests describe the
/// supplied X/options and, for fit, y; they are not independently recomputed
/// by the native scheduler from Python-owned buffers.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ModelInputCall {
    pub operation: ModelInputOperation,
    pub sample_ids: Vec<SampleId>,
    pub input_fingerprint: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target_fingerprint: Option<String>,
}

/// Host-reported reads and model calls for an attested view. Read batches can
/// include mask checks; model calls describe the wrapper's supplied arguments.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DataViewConsumption {
    pub receipt: DataViewReceipt,
    pub read_batches: Vec<Vec<SampleId>>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub model_calls: Vec<ModelInputCall>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct NodeTask {
    pub run_id: RunId,
    pub node_plan: NodePlan,
    pub phase: Phase,
    /// Training-wide limits selected by the caller. Hosts enforce device use;
    /// absence preserves non-training and legacy task wire compatibility.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub resources: Option<TrainingResourceLimits>,
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
    /// Optional host feature-content receipts for scheduler-selected views.
    /// Legacy fixed providers emit none; dynamic providers must pair these
    /// with evidence of the buffers actually consumed before fitting.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub data_view_receipts: BTreeMap<String, DataViewReceipt>,
    #[serde(default)]
    pub prediction_inputs: BTreeMap<String, PredictionInputSpec>,
    /// Native, sample-keyed prediction features for a PredictionJoin Data
    /// output. The host only materializes this attested matrix as a handle.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub prediction_feature_matrix: Option<crate::oof::OofMatrix>,
    /// Separately attested outer-validation or external-test feature rows.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub prediction_feature_off_fold_matrix: Option<crate::oof::OofMatrix>,
    /// Scheduler-derived `y - base OOF` target rows for a declared residual
    /// learner. Rows are keyed by sample identity and scoped to inner folds.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub residual_targets: Option<crate::residual::ResidualTargetSet>,
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
    pub fn validate_data_view_receipts(&self) -> Result<()> {
        for (key, receipt) in &self.data_view_receipts {
            let view = self.data_views.get(key).ok_or_else(|| {
                DagMlError::RuntimeValidation(format!(
                    "task for node `{}` has a receipt without data view `{key}`",
                    self.node_plan.node_id
                ))
            })?;
            if self.input_handles.get(key) != Some(&receipt.handle)
                || view.sample_ids.as_ref() != Some(&receipt.sample_ids)
            {
                return Err(DagMlError::RuntimeValidation(format!(
                    "task for node `{}` has a data view receipt unrelated to input `{key}`",
                    self.node_plan.node_id
                )));
            }
            if receipt.sample_ids.is_empty()
                || receipt.sample_ids.iter().collect::<BTreeSet<_>>().len()
                    != receipt.sample_ids.len()
                || !valid_sha256_fingerprint(&receipt.schema_fingerprint)
                || !valid_sha256_fingerprint(&receipt.content_fingerprint)
            {
                return Err(DagMlError::RuntimeValidation(format!(
                    "task for node `{}` has invalid ordered IDs or fingerprints in data view receipt `{key}`",
                    self.node_plan.node_id
                )));
            }
        }
        Ok(())
    }

    /// Permit only supported fit/predict phases to reach a controller with dynamic views.
    /// Admission still depends on the returned NodeResult's consumption proof.
    pub fn validate_dynamic_view_training_gate(&self) -> Result<()> {
        if self.data_view_receipts.is_empty() {
            return Ok(());
        }
        if !matches!(self.node_plan.kind, NodeKind::Model | NodeKind::Transform) {
            return Err(DagMlError::RuntimeValidation(format!(
                "node `{}` cannot execute a dynamic data view outside a model or transform task",
                self.node_plan.node_id
            )));
        }
        if !(matches!(self.phase, Phase::FitCv | Phase::Refit)
            || self.node_plan.kind == NodeKind::Model && self.phase == Phase::Predict)
        {
            let kind = if self.node_plan.kind == NodeKind::Transform {
                "transform"
            } else {
                "model"
            };
            return Err(DagMlError::RuntimeValidation(format!(
                "node `{}` has a dynamic data view in unsupported {kind} phase {:?}",
                self.node_plan.node_id, self.phase
            )));
        }
        if self.node_plan.kind == NodeKind::Transform
            && !self.data_views.values().any(|view| {
                matches!(
                    (self.phase, view.partition),
                    (Phase::FitCv, DataRequestPartition::FoldTrain)
                        | (Phase::Refit, DataRequestPartition::FullTrain)
                )
            })
        {
            return Err(DagMlError::RuntimeValidation(format!(
                "node `{}` requires a dynamic transform training view",
                self.node_plan.node_id
            )));
        }
        // A partially attested task could use an unreceipted sibling for
        // fitting or prediction. Check every view before invoking the host.
        for (key, view) in &self.data_views {
            let receipt = self.data_view_receipts.get(key).ok_or_else(|| {
                DagMlError::RuntimeValidation(format!(
                    "node `{}` has no receipt for data view `{key}` in dynamic model execution",
                    self.node_plan.node_id
                ))
            })?;
            let ordered_ids = view.sample_ids.as_ref().ok_or_else(|| {
                DagMlError::RuntimeValidation(format!(
                    "node `{}` has no ordered IDs for dynamic data view `{key}`",
                    self.node_plan.node_id
                ))
            })?;
            if ordered_ids != &receipt.sample_ids {
                return Err(DagMlError::RuntimeValidation(format!(
                    "node `{}` has ordered IDs different from the receipt for dynamic data view `{key}`",
                    self.node_plan.node_id
                )));
            }
            let supported = match self.node_plan.kind {
                NodeKind::Transform => matches!(
                    (self.phase, view.partition),
                    (Phase::FitCv, DataRequestPartition::FoldTrain)
                        | (Phase::FitCv, DataRequestPartition::FoldValidation)
                        | (Phase::FitCv | Phase::Refit, DataRequestPartition::Predict)
                        | (Phase::Refit, DataRequestPartition::FullTrain)
                ),
                NodeKind::Model => matches!(
                    (self.phase, view.partition),
                    (Phase::FitCv, DataRequestPartition::FoldTrain)
                        | (Phase::FitCv, DataRequestPartition::FoldValidation)
                        | (
                            Phase::FitCv | Phase::Refit | Phase::Predict,
                            DataRequestPartition::Predict
                        )
                        | (Phase::Refit, DataRequestPartition::FullTrain)
                ),
                _ => false,
            };
            if !supported {
                let kind = if self.node_plan.kind == NodeKind::Transform {
                    "transform"
                } else {
                    "model"
                };
                return Err(DagMlError::RuntimeValidation(format!(
                    "node `{}` has unsupported dynamic {kind} view `{key}` in phase {:?} with partition {:?}",
                    self.node_plan.node_id, self.phase, view.partition
                )));
            }
        }
        self.validate_data_view_receipts()
    }

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
    /// Optional additive identity namespace for independent local studies.
    pub proposal_namespace: Option<String>,
    /// Explicit additive closed Methods profile; None retains HPOv1.
    pub portable_profile: Option<String>,
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
        if self.proposal_namespace.as_ref().is_some_and(|value| {
            value.len() != 64
                || !value
                    .bytes()
                    .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
        }) {
            return Err(DagMlError::RuntimeValidation(
                "runtime HPO proposal namespace must be lowercase SHA-256".into(),
            ));
        }
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
        let expected_direction = match self.selection.metric.objective() {
            crate::MetricObjective::Minimize => crate::HpoDirection::Minimize,
            crate::MetricObjective::Maximize => crate::HpoDirection::Maximize,
        };
        if serde_json::to_value(self.study.optimizer.metric)?
            != serde_json::to_value(self.selection.metric)?
            || (self.study.optimizer.direction != crate::HpoDirection::Auto
                && self.study.optimizer.direction != self.selection.direction)
            || self.selection.direction != expected_direction
        {
            return Err(DagMlError::RuntimeValidation(
                "runtime HPO metric/direction do not match the study and selection".into(),
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
        if let Some(profile) = &self.portable_profile {
            if profile != crate::METHODS_PLS_ROLE_PROFILE
                || target.controller_id.as_str() != crate::METHODS_NATIVE_REGRESSION_CONTROLLER
            {
                return Err(DagMlError::RuntimeValidation(
                    "runtime HPO portable profile/target controller mismatch".into(),
                ));
            }
        }
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
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub fit_sample_ids: Vec<SampleId>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub independent_unit_ids: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub target_names: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target_row_weights: Option<Vec<Vec<f64>>>,
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
            fit_sample_ids: Vec::new(),
            independent_unit_ids: Vec::new(),
            target_names: Vec::new(),
            target_row_weights: None,
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
        if !self.fit_sample_ids.is_empty()
            || !self.independent_unit_ids.is_empty()
            || self.target_row_weights.is_some()
        {
            if self.fit_sample_ids.is_empty()
                || self.fit_sample_ids.len() != self.row_weights.len()
                || self.fit_sample_ids.len() != self.independent_unit_ids.len()
                || self.fit_sample_ids.iter().collect::<BTreeSet<_>>().len()
                    != self.fit_sample_ids.len()
                || self
                    .independent_unit_ids
                    .iter()
                    .any(|id| id.trim().is_empty())
                || self.requested_policy != FitInfluencePolicy::EqualSampleInfluence
                || self.mechanism != FitInfluenceMechanism::SampleWeights
            {
                return Err(DagMlError::RuntimeValidation(
                    "invalid independent-unit fit influence identity".into(),
                ));
            }
            let mut counts = BTreeMap::<&str, usize>::new();
            for unit in &self.independent_unit_ids {
                *counts.entry(unit).or_default() += 1;
            }
            if self
                .row_weights
                .iter()
                .zip(&self.independent_unit_ids)
                .any(|(weight, unit)| *weight != 1.0 / counts[unit.as_str()] as f64)
            {
                return Err(DagMlError::RuntimeValidation(
                    "independent-unit row weights differ from attested scope counts".into(),
                ));
            }
            if let Some(weights) = &self.target_row_weights {
                if self.target_names.is_empty()
                    || weights.len() != self.fit_sample_ids.len()
                    || weights.iter().any(|row| {
                        row.len() != self.target_names.len()
                            || row
                                .iter()
                                .any(|weight| !weight.is_finite() || *weight < 0.0)
                    })
                {
                    return Err(DagMlError::RuntimeValidation(
                        "invalid per-target independent-unit weights".into(),
                    ));
                }
                let mut counts = BTreeMap::<(&str, usize), usize>::new();
                for (unit, row) in self.independent_unit_ids.iter().zip(weights) {
                    for (column, weight) in row.iter().enumerate() {
                        if *weight > 0.0 {
                            *counts.entry((unit, column)).or_default() += 1;
                        }
                    }
                }
                if weights
                    .iter()
                    .zip(&self.independent_unit_ids)
                    .any(|(row, unit)| {
                        row.iter().enumerate().any(|(column, weight)| {
                            *weight > 0.0
                                && *weight != 1.0 / counts[&(unit.as_str(), column)] as f64
                        })
                    })
                {
                    return Err(DagMlError::RuntimeValidation(
                        "independent-unit target weights differ from selected target scopes".into(),
                    ));
                }
            }
        }
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

/// Class-aligned probabilities for one labelled CV prediction block. Validation
/// probabilities also attest the class score of a projected stacking feature;
/// they never replace the prediction values delivered across the graph edge.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ClassificationProbabilityBlock {
    pub producer_node: NodeId,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub producer_port: Option<String>,
    pub partition: PredictionPartition,
    pub fold_id: Option<FoldId>,
    pub sample_ids: Vec<SampleId>,
    pub class_labels: Vec<f64>,
    pub values: Vec<Vec<f64>>,
}

impl ClassificationProbabilityBlock {
    pub fn validate(&self) -> Result<()> {
        if !matches!(
            self.partition,
            PredictionPartition::Train
                | PredictionPartition::TrainPool
                | PredictionPartition::Validation
                | PredictionPartition::Test
        ) || (self.partition != PredictionPartition::Test && self.fold_id.is_none())
        {
            return Err(DagMlError::RuntimeValidation(
                "classification probabilities require a CV train, train-pool or validation fold, or a test block"
                    .to_string(),
            ));
        }
        if self.class_labels.is_empty()
            || self.class_labels.iter().any(|label| !label.is_finite())
            || self.class_labels.iter().any(|label| {
                self.class_labels
                    .iter()
                    .filter(|other| *other == label)
                    .count()
                    != 1
            })
            || self.sample_ids.is_empty()
            || self.sample_ids.len() != self.values.len()
            || self.sample_ids.iter().collect::<BTreeSet<_>>().len() != self.sample_ids.len()
        {
            return Err(DagMlError::RuntimeValidation(
                "classification probabilities have invalid class or sample identities".to_string(),
            ));
        }
        for row in &self.values {
            if row.len() != self.class_labels.len()
                || row
                    .iter()
                    .any(|p| !p.is_finite() || !(0.0..=1.0).contains(p))
                || (row.iter().sum::<f64>() - 1.0).abs() > 1e-6
            {
                return Err(DagMlError::RuntimeValidation(
                    "classification probabilities must be finite, non-negative and sum to one"
                        .to_string(),
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
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub classification_probabilities: Vec<ClassificationProbabilityBlock>,
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
    /// Host-reported reads of scheduler-selected feature views. This is
    /// validated against `NodeTask`; it does not prove estimator consumption
    /// and does not by itself open dynamic fit.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub consumed_data_views: BTreeMap<String, DataViewConsumption>,
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
    /// Whether `partition` trains on or scores its rows (train, train-pool, validation).
    fn scores_partition(partition: &PredictionPartition) -> bool {
        matches!(
            partition,
            PredictionPartition::Train
                | PredictionPartition::TrainPool
                | PredictionPartition::Validation
        )
    }

    /// Whether checking this result against a target-missing declaration needs coordinator
    /// relations: it carries scored observation rows or scored group/target units.
    pub fn target_missing_needs_relations(&self) -> bool {
        self.observation_predictions
            .iter()
            .any(|block| Self::scores_partition(&block.partition))
            || self.aggregated_predictions.iter().any(|block| {
                Self::scores_partition(&block.partition) && block.level != PredictionLevel::Sample
            })
    }

    /// Target-missing samples declared on the plan fold set never train and are never scored.
    ///
    /// Train, train-pool and validation rows may not carry them: sample rows directly,
    /// observation rows and group/target units through the CV `relations` (groups follow the
    /// active `grouping_key`, else relation `group_id`). A scored unit without attested members,
    /// or whose members are all target-missing, is refused. Test and final predictions may carry
    /// them (PREDICT / inference cohorts) but are never scored for them: a sample-level scoring
    /// target for a declared sample is refused, and group/target-level scoring of test or final
    /// predictions is refused while a declaration exists, because those units resolve through a
    /// predict cohort rather than the CV relations.
    pub fn validate_target_missing(
        &self,
        fold_set: &FoldSet,
        relations: Option<&SampleRelationSet>,
        grouping_key: Option<&crate::policy::AggregationGroupingKey>,
    ) -> Result<()> {
        if fold_set.target_missing_sample_ids.is_empty() {
            return Ok(());
        }
        let scored = Self::scores_partition;
        let mut samples = Vec::new();
        for block in self.predictions.iter().filter(|b| scored(&b.partition)) {
            samples.extend(block.sample_ids.iter().cloned());
        }
        for block in self
            .classification_probabilities
            .iter()
            .filter(|b| scored(&b.partition))
        {
            samples.extend(block.sample_ids.iter().cloned());
        }
        for block in &self.regression_targets {
            for unit in &block.unit_ids {
                if let PredictionUnitId::Sample(sample_id) = unit {
                    samples.push(sample_id.clone());
                }
            }
            let units = block.unit_ids.iter().collect::<BTreeSet<_>>();
            // Same pairing rule as native aggregated scoring.
            if block.level != PredictionLevel::Sample
                && self.aggregated_predictions.iter().any(|prediction| {
                    !scored(&prediction.partition)
                        && prediction.level == block.level
                        && (prediction.target_names.is_empty()
                            || block.target_names.is_empty()
                            || prediction.target_names == block.target_names)
                        && prediction.unit_ids.iter().collect::<BTreeSet<_>>() == units
                })
            {
                return Err(DagMlError::RuntimeValidation(format!(
                    "node `{}` emitted group/target-level scoring targets for test or final predictions, which cannot be checked against declared target-missing samples",
                    self.node_id
                )));
            }
        }
        let units = self
            .aggregated_predictions
            .iter()
            .filter(|b| scored(&b.partition))
            .flat_map(|b| &b.unit_ids)
            .collect::<Vec<_>>();
        let observations = self
            .observation_predictions
            .iter()
            .filter(|b| scored(&b.partition))
            .flat_map(|b| &b.observation_ids)
            .collect::<BTreeSet<_>>();
        let records = match relations {
            Some(relations) => relations.records.as_slice(),
            None if self.target_missing_needs_relations() => {
                return Err(DagMlError::RuntimeValidation(format!(
                    "node `{}` emitted observation, group or target rows that cannot be checked against target-missing samples without coordinator relations",
                    self.node_id
                )));
            }
            None => &[],
        };
        let declared = fold_set
            .target_missing_sample_ids
            .iter()
            .collect::<BTreeSet<_>>();
        let members_by = |matches: &dyn Fn(&crate::SampleRelation) -> bool| {
            records
                .iter()
                .filter(|record| matches(record))
                .map(|record| &record.sample_id)
                .collect::<BTreeSet<_>>()
        };
        for unit in units {
            let members = match unit {
                PredictionUnitId::Sample(sample_id) => {
                    samples.push(sample_id.clone());
                    continue;
                }
                PredictionUnitId::Group(group_id) => match grouping_key {
                    Some(crate::policy::AggregationGroupingKey::RelationMetadata { key }) => {
                        members_by(&|record| {
                            record.metadata.get(key).and_then(serde_json::Value::as_str)
                                == Some(group_id.as_str())
                        })
                    }
                    None => members_by(&|record| record.group_id.as_ref() == Some(group_id)),
                },
                PredictionUnitId::Target(target_id) => {
                    members_by(&|record| record.target_id.as_ref() == Some(target_id))
                }
            };
            if members.is_empty() {
                return Err(DagMlError::RuntimeValidation(format!(
                    "node `{}` emitted a scored {unit:?} unit without attested relation members while target-missing samples are declared",
                    self.node_id
                )));
            }
            if members.iter().all(|id| declared.contains(id)) {
                samples.extend(members.into_iter().cloned());
            }
        }
        samples.extend(
            records
                .iter()
                .filter(|record| observations.contains(&record.observation_id))
                .map(|record| record.sample_id.clone()),
        );
        fold_set.refuse_scored_target_missing(&samples)
    }

    /// Require a full, ordered read and model call for every dynamic fit or
    /// prediction view. These are host-reported call-boundary facts, not native
    /// inspection of the estimator's internal consumption.
    pub fn validate_required_model_calls_for_task(&self, task: &NodeTask) -> Result<()> {
        if !matches!(task.node_plan.kind, NodeKind::Model | NodeKind::Transform)
            || task.data_view_receipts.is_empty()
        {
            return Ok(());
        }
        for (key, view) in &task.data_views {
            let (operation, purpose) = match (task.phase, view.partition) {
                (Phase::FitCv, DataRequestPartition::FoldTrain)
                | (Phase::Refit, DataRequestPartition::FullTrain) => {
                    (ModelInputOperation::Fit, "training")
                }
                (Phase::FitCv, DataRequestPartition::FoldValidation)
                | (Phase::FitCv | Phase::Refit, DataRequestPartition::Predict)
                    if task.node_plan.kind == NodeKind::Transform =>
                {
                    continue;
                }
                (Phase::FitCv, DataRequestPartition::FoldValidation)
                | (Phase::FitCv | Phase::Refit | Phase::Predict, DataRequestPartition::Predict)
                    if task.node_plan.kind == NodeKind::Model =>
                {
                    (ModelInputOperation::Predict, "prediction")
                }
                _ => {
                    let kind = if task.node_plan.kind == NodeKind::Transform {
                        "transform"
                    } else {
                        "model"
                    };
                    return Err(DagMlError::RuntimeValidation(format!(
                        "node `{}` has unsupported dynamic {kind} view `{key}` in phase {:?} with partition {:?}",
                        task.node_plan.node_id, task.phase, view.partition
                    )));
                }
            };
            if !task.data_view_receipts.contains_key(key) {
                return Err(DagMlError::RuntimeValidation(format!(
                    "node `{}` has no receipt for dynamic {purpose} view `{key}`",
                    task.node_plan.node_id
                )));
            }
            let expected_ids = view.sample_ids.as_ref().ok_or_else(|| {
                DagMlError::RuntimeValidation(format!(
                    "node `{}` has no ordered IDs for dynamic {purpose} view `{key}`",
                    task.node_plan.node_id
                ))
            })?;
            let witnessed = self
                .consumed_data_views
                .get(key)
                .is_some_and(|consumption| {
                    consumption
                        .read_batches
                        .iter()
                        .any(|batch| batch == expected_ids)
                        && consumption.model_calls.iter().any(|call| {
                            call.operation == operation && &call.sample_ids == expected_ids
                        })
                });
            if !witnessed {
                return Err(DagMlError::RuntimeValidation(format!(
                    "node `{}` has no full ordered read and {} call bound to dynamic {purpose} view `{key}`",
                    task.node_plan.node_id,
                    if operation == ModelInputOperation::Fit { "fit" } else { "predict" }
                )));
            }
        }
        Ok(())
    }

    pub fn validate_consumed_data_views_for_task(&self, task: &NodeTask) -> Result<()> {
        task.validate_data_view_receipts()?;
        for (key, consumption) in &self.consumed_data_views {
            let expected = task.data_view_receipts.get(key).ok_or_else(|| {
                DagMlError::RuntimeValidation(format!(
                    "node `{}` reported consumption of unreceipted data view `{key}`",
                    task.node_plan.node_id
                ))
            })?;
            if &consumption.receipt != expected {
                return Err(DagMlError::RuntimeValidation(format!(
                    "node `{}` consumed data view `{key}` with a receipt different from its native task",
                    task.node_plan.node_id
                )));
            }
            if consumption.read_batches.is_empty() {
                return Err(DagMlError::RuntimeValidation(format!(
                    "node `{}` consumed data view `{key}` without read batches",
                    task.node_plan.node_id
                )));
            }
            let permitted = expected.sample_ids.iter().collect::<BTreeSet<_>>();
            for batch in &consumption.read_batches {
                let unique = batch.iter().collect::<BTreeSet<_>>();
                if batch.is_empty() || unique.len() != batch.len() || !unique.is_subset(&permitted)
                {
                    return Err(DagMlError::RuntimeValidation(format!(
                        "node `{}` consumed data view `{key}` with invalid ordered read IDs",
                        task.node_plan.node_id
                    )));
                }
            }
            let view = task.data_views.get(key).ok_or_else(|| {
                DagMlError::RuntimeValidation(format!(
                    "node `{}` reported a model call for view `{key}` without a native selector",
                    task.node_plan.node_id
                ))
            })?;
            for call in &consumption.model_calls {
                let unique = call.sample_ids.iter().collect::<BTreeSet<_>>();
                let read_in_order = consumption.read_batches.iter().any(|batch| {
                    let mut remaining = batch.iter();
                    call.sample_ids
                        .iter()
                        .all(|sample| remaining.any(|candidate| candidate == sample))
                });
                if call.sample_ids.is_empty()
                    || unique.len() != call.sample_ids.len()
                    || !read_in_order
                {
                    return Err(DagMlError::RuntimeValidation(format!(
                        "node `{}` reported a model call on view `{key}` outside its ordered reads",
                        task.node_plan.node_id
                    )));
                }
                if !valid_sha256_fingerprint(&call.input_fingerprint)
                    || call
                        .target_fingerprint
                        .as_deref()
                        .is_some_and(|value| !valid_sha256_fingerprint(value))
                {
                    return Err(DagMlError::RuntimeValidation(format!(
                        "node `{}` reported a model call on view `{key}` without valid SHA-256 digests",
                        task.node_plan.node_id
                    )));
                }
                if matches!(call.operation, ModelInputOperation::Fit) {
                    if !matches!(
                        (task.phase, view.partition),
                        (Phase::FitCv, DataRequestPartition::FoldTrain)
                            | (Phase::Refit, DataRequestPartition::FullTrain)
                    ) || call.target_fingerprint.is_none()
                    {
                        return Err(DagMlError::RuntimeValidation(format!(
                            "node `{}` reported a fit call on view `{key}` outside a training scope",
                            task.node_plan.node_id
                        )));
                    }
                } else if call.target_fingerprint.is_some() {
                    return Err(DagMlError::RuntimeValidation(format!(
                        "node `{}` reported prediction targets on view `{key}`",
                        task.node_plan.node_id
                    )));
                }
            }
        }
        Ok(())
    }

    pub fn validate_for_task(&self, task: &NodeTask) -> Result<()> {
        self.validate_consumed_data_views_for_task(task)?;
        task.validate_dynamic_view_training_gate()?;
        self.validate_required_model_calls_for_task(task)?;
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
        for block in &self.classification_probabilities {
            block.validate()?;
            if !matches!(task.phase, Phase::FitCv | Phase::Refit)
                || block.producer_node != self.node_id
                || block.fold_id != task.fold_id
                || (task.phase == Phase::Refit && block.partition != PredictionPartition::Test)
                || !self.predictions.iter().any(|prediction| {
                    matches!(
                        prediction.partition,
                        PredictionPartition::Train
                            | PredictionPartition::TrainPool
                            | PredictionPartition::Validation
                            | PredictionPartition::Test
                    ) && prediction.fold_id == block.fold_id
                        && prediction.producer_port == block.producer_port
                        && prediction.sample_ids.iter().collect::<BTreeSet<_>>()
                            == block.sample_ids.iter().collect::<BTreeSet<_>>()
                        && prediction.values.iter().all(|row| row.len() == 1)
                })
            {
                return Err(DagMlError::RuntimeValidation(
                    "classification probabilities require a matching single-target CV prediction"
                        .to_string(),
                ));
            }
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
    if prediction.partition == PredictionPartition::TrainPool {
        if task.phase != Phase::FitCv || prediction.fold_id != task.fold_id {
            return Err(DagMlError::RuntimeValidation(format!(
                "node `{}` emitted train-pool predictions outside its FIT_CV fold",
                task.node_plan.node_id
            )));
        }
        // This report-only view can include both fit and validation rows, but
        // never an external test row. The two attested fold views define its
        // allowed population; it cannot be used as OOF training input.
        let pool_ids: BTreeSet<_> = task
            .data_views
            .values()
            .filter(|view| {
                matches!(
                    view.partition,
                    DataRequestPartition::FoldTrain | DataRequestPartition::FoldValidation
                )
            })
            .filter_map(|view| view.sample_ids.as_ref())
            .flat_map(|ids| ids.iter().cloned())
            .collect();
        if pool_ids.is_empty()
            || prediction
                .sample_ids
                .iter()
                .any(|id| !pool_ids.contains(id))
        {
            return Err(DagMlError::RuntimeValidation(format!(
                "node `{}` emitted train-pool predictions outside its attested fold population",
                task.node_plan.node_id
            )));
        }
        return Ok(());
    }
    if prediction.partition == PredictionPartition::Train && task.phase == Phase::FitCv {
        if prediction.fold_id != task.fold_id {
            return Err(DagMlError::RuntimeValidation(format!(
                "node `{}` emitted train predictions for fold {:?}, expected {:?}",
                task.node_plan.node_id, prediction.fold_id, task.fold_id
            )));
        }
        if !task.data_views.is_empty() {
            let mut train_ids: BTreeSet<_> = task
                .data_views
                .values()
                .filter(|view| view.partition == DataRequestPartition::FoldTrain)
                .filter_map(|view| view.sample_ids.as_ref())
                .flat_map(|ids| ids.iter().cloned())
                .collect();
            for view in task.data_views.values().filter(|view| {
                view.partition == DataRequestPartition::FoldTrain
                    && view.extra.get("include_augmented_cv_train_predictions")
                        == Some(&serde_json::Value::Bool(true))
            }) {
                let children: Vec<SampleId> = serde_json::from_value(
                    view.extra
                        .get("augmented_cv_train_prediction_ids")
                        .cloned()
                        .ok_or_else(|| {
                            DagMlError::RuntimeValidation(format!(
                                "node `{}` has no declared augmented CV train prediction IDs",
                                task.node_plan.node_id
                            ))
                        })?,
                )
                .map_err(|error| {
                    DagMlError::RuntimeValidation(format!(
                        "node `{}` has malformed augmented CV train prediction IDs: {error}",
                        task.node_plan.node_id
                    ))
                })?;
                train_ids.extend(children);
            }
            if train_ids.is_empty()
                || prediction
                    .sample_ids
                    .iter()
                    .any(|id| !train_ids.contains(id))
            {
                return Err(DagMlError::RuntimeValidation(format!(
                    "node `{}` emitted FIT_CV train predictions outside its fold-train data view",
                    task.node_plan.node_id
                )));
            }
        }
        return Ok(());
    }
    if prediction.partition == PredictionPartition::Test && task.phase == Phase::FitCv {
        if prediction.fold_id != task.fold_id {
            return Err(DagMlError::RuntimeValidation(format!(
                "node `{}` emitted test predictions for fold {:?}, expected {:?}",
                task.node_plan.node_id, prediction.fold_id, task.fold_id
            )));
        }
        let mut test_ids: BTreeSet<_> = task
            .data_views
            .values()
            .filter(|view| view.partition == DataRequestPartition::Predict)
            .filter_map(|view| view.sample_ids.as_ref())
            .flat_map(|ids| ids.iter().cloned())
            .collect();
        // A prediction-only stacking learner has no raw data binding. Its
        // current-fold `:test` inputs were already attested against each
        // producer's external Test view; intersect their identities so the
        // downstream learner can emit only rows every source actually supplied.
        if test_ids.is_empty() {
            let mut fold_inputs = task.prediction_inputs.iter().filter(|(key, spec)| {
                key.ends_with(":test")
                    && spec.partition == PredictionPartition::Test
                    && spec.fold_id == task.fold_id
            });
            if let Some((_, first)) = fold_inputs.next() {
                test_ids = first.sample_ids.iter().cloned().collect();
                for (_, input) in fold_inputs {
                    test_ids.retain(|id| input.sample_ids.contains(id));
                }
            }
        }
        if test_ids.is_empty()
            || prediction
                .sample_ids
                .iter()
                .any(|id| !test_ids.contains(id))
        {
            return Err(DagMlError::RuntimeValidation(format!(
                "node `{}` emitted FIT_CV test predictions outside an attested external-test data view",
                task.node_plan.node_id
            )));
        }
        return Ok(());
    }
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
    prediction_inputs: &BTreeMap<String, PredictionInputSpec>,
    phase: Phase,
) -> Result<FitInfluenceTask> {
    if let Some(units) = experimental_units(plan)? {
        if matches!(phase, Phase::FitCv | Phase::Refit) {
            return units.fit_task(plan, node_plan, data_views, prediction_inputs);
        }
        return Ok(FitInfluenceTask::default());
    }
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
            fit_sample_ids: Vec::new(),
            independent_unit_ids: Vec::new(),
            target_names: Vec::new(),
            target_row_weights: None,
            requested_policy,
            effective_policy: FitInfluencePolicy::UniformRows,
            mechanism: FitInfluenceMechanism::UniformRows,
            row_weights: Vec::new(),
            warnings: Vec::new(),
        }),
        FitInfluencePolicy::ScorerOnly => Ok(FitInfluenceTask {
            fit_sample_ids: Vec::new(),
            independent_unit_ids: Vec::new(),
            target_names: Vec::new(),
            target_row_weights: None,
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
                fit_sample_ids: Vec::new(),
                independent_unit_ids: Vec::new(),
                target_names: Vec::new(),
                target_row_weights: None,
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
                fit_sample_ids: Vec::new(),
                independent_unit_ids: Vec::new(),
                target_names: Vec::new(),
                target_row_weights: None,
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
                fit_sample_ids: Vec::new(),
                independent_unit_ids: Vec::new(),
                target_names: Vec::new(),
                target_row_weights: None,
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
            fit_sample_ids: Vec::new(),
            independent_unit_ids: Vec::new(),
            target_names: Vec::new(),
            target_row_weights: None,
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
            fit_sample_ids: Vec::new(),
            independent_unit_ids: Vec::new(),
            target_names: Vec::new(),
            target_row_weights: None,
            requested_policy,
            effective_policy: FitInfluencePolicy::EqualSampleInfluence,
            mechanism: FitInfluenceMechanism::SampleWeights,
            row_weights: weights,
            warnings: Vec::new(),
        });
    }
    Ok(FitInfluenceTask {
        fit_sample_ids: Vec::new(),
        independent_unit_ids: Vec::new(),
        target_names: Vec::new(),
        target_row_weights: None,
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
                fit_sample_ids: Vec::new(),
                independent_unit_ids: Vec::new(),
                target_names: Vec::new(),
                target_row_weights: None,
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
            fit_sample_ids: Vec::new(),
            independent_unit_ids: Vec::new(),
            target_names: Vec::new(),
            target_row_weights: None,
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
                fit_sample_ids: Vec::new(),
                independent_unit_ids: Vec::new(),
                target_names: Vec::new(),
                target_row_weights: None,
                requested_policy: FitInfluencePolicy::Auto,
                effective_policy: FitInfluencePolicy::BackendLossWeight,
                mechanism: FitInfluenceMechanism::BackendLossWeights,
                row_weights: weights,
                warnings: Vec::new(),
            };
        }
    }
    FitInfluenceTask {
        fit_sample_ids: Vec::new(),
        independent_unit_ids: Vec::new(),
        target_names: Vec::new(),
        target_row_weights: None,
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
                DataRequestPartition::FoldTrain
                    | DataRequestPartition::FullTrain
                    | DataRequestPartition::AllObservations
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

/// Explicit statistical units, signed independently of physical row and splitter identities.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct ExperimentalUnits {
    schema_version: u32,
    sample_ids: Vec<SampleId>,
    independent_unit_ids: Vec<String>,
    fit_influence_policy: FitInfluencePolicy,
    task_type: String,
    target_names: Vec<String>,
    target_values: Vec<Vec<Option<f64>>>,
}

pub(crate) fn experimental_units(plan: &ExecutionPlan) -> Result<Option<ExperimentalUnits>> {
    plan.graph_plan
        .graph
        .metadata
        .get("experimental_unit")
        .map(|value| {
            serde_json::from_value(value.clone()).map_err(|error| {
                DagMlError::RuntimeValidation(format!(
                    "invalid experimental_unit contract: {error}"
                ))
            })
        })
        .transpose()
}

impl ExperimentalUnits {
    fn validate(&self) -> Result<()> {
        if self.schema_version != 1
            || self.sample_ids.is_empty()
            || self.sample_ids.len() != self.independent_unit_ids.len()
            || self.sample_ids.iter().collect::<BTreeSet<_>>().len() != self.sample_ids.len()
            || self
                .independent_unit_ids
                .iter()
                .any(|id| id.trim().is_empty())
            || self.fit_influence_policy != FitInfluencePolicy::EqualSampleInfluence
            || !matches!(self.task_type.as_str(), "regression" | "classification")
            || self.target_names.is_empty()
            || self.target_names.iter().any(|name| name.trim().is_empty())
            || self.target_names.iter().collect::<BTreeSet<_>>().len() != self.target_names.len()
            || self.target_values.len() != self.sample_ids.len()
            || self.target_values.iter().any(|row| {
                row.len() != self.target_names.len()
                    || row.iter().flatten().any(|value| !value.is_finite())
            })
        {
            return Err(DagMlError::RuntimeValidation(
                "invalid signed experimental-unit identities/targets".into(),
            ));
        }
        if self.task_type == "classification"
            && (self.target_names.len() != 1
                || self.target_values.iter().any(|row| row[0].is_none()))
        {
            return Err(DagMlError::RuntimeValidation(
                "experimental-unit classification requires complete mono-y".into(),
            ));
        }
        for unit in &self.independent_unit_ids {
            crate::ids::GroupId::new(unit.clone())?;
        }
        let mut truth = BTreeMap::<(&str, usize), f64>::new();
        for (unit, row) in self.independent_unit_ids.iter().zip(&self.target_values) {
            for (target, value) in row.iter().enumerate() {
                if let Some(value) = value {
                    if truth
                        .insert((unit, target), *value)
                        .is_some_and(|previous| previous != *value)
                    {
                        return Err(DagMlError::RuntimeValidation(
                            "independent unit has conflicting observed targets".into(),
                        ));
                    }
                }
            }
        }
        Ok(())
    }

    fn position(&self, id: &SampleId) -> Result<usize> {
        self.sample_ids
            .iter()
            .position(|sample| sample == id)
            .ok_or_else(|| {
                DagMlError::RuntimeValidation(format!(
                    "experimental-unit scope contains foreign sample `{id}`"
                ))
            })
    }

    fn validate_fold_set(&self, folds: &FoldSet) -> Result<()> {
        folds.validate()?;
        if self.task_type == "classification" {
            let mut seen = BTreeSet::new();
            if folds
                .folds
                .iter()
                .flat_map(|fold| fold.validation_sample_ids.iter())
                .any(|id| !seen.insert(id))
            {
                return Err(DagMlError::RuntimeValidation("independent-unit classification requires disjoint native validation folds; overlapping label-feature averages are unsupported".into()));
            }
        }
        for fold in &folds.folds {
            let train = fold
                .train_sample_ids
                .iter()
                .map(|id| {
                    self.position(id)
                        .map(|position| &self.independent_unit_ids[position])
                })
                .collect::<Result<BTreeSet<_>>>()?;
            for id in &fold.validation_sample_ids {
                if train.contains(&self.independent_unit_ids[self.position(id)?]) {
                    return Err(DagMlError::RuntimeValidation(format!(
                        "fold `{}` leaks an independent unit between training and validation",
                        fold.fold_id
                    )));
                }
            }
        }
        Ok(())
    }

    fn selected_positions(
        &self,
        plan: &ExecutionPlan,
        node: &NodePlan,
        scope: &[SampleId],
    ) -> Result<Vec<usize>> {
        let availability = prediction_availability(plan)?;
        let source = availability_source(plan, &node.node_id)?;
        let mut selected = Vec::new();
        for id in scope {
            let position = self.position(id)?;
            let present = if let (Some(availability), Some(source)) = (&availability, source) {
                availability.presence(source, std::slice::from_ref(id))?[0]
            } else {
                true
            };
            if present && self.target_values[position].iter().any(Option::is_some) {
                selected.push(position);
            }
        }
        if selected.is_empty() {
            return Err(DagMlError::RuntimeValidation(format!(
                "model `{}` has no observed independent-unit fit rows",
                node.node_id
            )));
        }
        for target in 0..self.target_names.len() {
            if !selected
                .iter()
                .any(|position| self.target_values[*position][target].is_some())
            {
                return Err(DagMlError::RuntimeValidation(format!(
                    "model `{}` has no observed rows for target `{}`",
                    node.node_id, self.target_names[target]
                )));
            }
        }
        if self.task_type == "classification" {
            let class_bits = |value: f64| if value == 0.0 { 0 } else { value.to_bits() };
            let classes = self
                .target_values
                .iter()
                .map(|row| class_bits(row[0].expect("validated class target")))
                .collect::<BTreeSet<_>>();
            let observed = selected
                .iter()
                .map(|position| {
                    class_bits(self.target_values[*position][0].expect("validated class target"))
                })
                .collect::<BTreeSet<_>>();
            if classes.len() < 2 || observed != classes {
                return Err(DagMlError::RuntimeValidation(
                    "independent-unit training scope is missing a declared class".into(),
                ));
            }
        }
        Ok(selected)
    }

    fn validate_scored_scope(
        &self,
        plan: &ExecutionPlan,
        node: &NodePlan,
        scope: &[SampleId],
    ) -> Result<()> {
        let availability = prediction_availability(plan)?;
        let source = availability_source(plan, &node.node_id)?;
        let mut present = Vec::new();
        for id in scope {
            if let (Some(availability), Some(source)) = (&availability, source) {
                if !availability.presence(source, std::slice::from_ref(id))?[0] {
                    continue;
                }
            }
            present.push(self.position(id)?);
        }
        if present.is_empty() && source.is_some() {
            return Ok(());
        } // no genuine raw prediction block
        for column in 0..self.target_names.len() {
            if !present
                .iter()
                .any(|position| self.target_values[*position][column].is_some())
            {
                return Err(DagMlError::RuntimeValidation(format!(
                    "independent-unit scored native scope has no observed target `{}`",
                    self.target_names[column]
                )));
            }
        }
        Ok(())
    }

    fn fit_task(
        &self,
        plan: &ExecutionPlan,
        node: &NodePlan,
        data_views: &BTreeMap<String, DataProviderViewSpec>,
        prediction_inputs: &BTreeMap<String, PredictionInputSpec>,
    ) -> Result<FitInfluenceTask> {
        if !plan
            .graph_plan
            .graph
            .nodes
            .iter()
            .any(|candidate| candidate.id == node.node_id && candidate.kind == NodeKind::Model)
        {
            return Ok(FitInfluenceTask::default());
        }
        self.validate()?;
        if !node
            .controller_capabilities
            .contains(&ControllerCapability::SupportsSampleWeights)
        {
            return Err(DagMlError::RuntimeValidation(
                "experimental-unit model requires sample-weight support".into(),
            ));
        }
        let scope = data_views
            .values()
            .filter(|view| {
                matches!(
                    view.partition,
                    DataRequestPartition::FoldTrain
                        | DataRequestPartition::FullTrain
                        | DataRequestPartition::AllObservations
                )
            })
            .filter_map(|view| view.sample_ids.as_ref())
            .find(|ids| !ids.is_empty())
            .or_else(|| {
                prediction_inputs
                    .values()
                    .find(|input| {
                        matches!(
                            input.partition,
                            PredictionPartition::Validation | PredictionPartition::Train
                        )
                    })
                    .map(|input| &input.sample_ids)
            })
            .ok_or_else(|| {
                DagMlError::RuntimeValidation(
                    "experimental-unit FIT has no authoritative training row scope".into(),
                )
            })?;
        let positions = self.selected_positions(plan, node, scope)?;
        let units = positions
            .iter()
            .map(|position| self.independent_unit_ids[*position].clone())
            .collect::<Vec<_>>();
        let mut counts = BTreeMap::<&str, usize>::new();
        let mut target_counts = BTreeMap::<(&str, usize), usize>::new();
        for (position, unit) in positions.iter().zip(&units) {
            *counts.entry(unit).or_default() += 1;
            for (target, value) in self.target_values[*position].iter().enumerate() {
                if value.is_some() {
                    *target_counts.entry((unit, target)).or_default() += 1;
                }
            }
        }
        let task = FitInfluenceTask {
            requested_policy: FitInfluencePolicy::EqualSampleInfluence,
            effective_policy: FitInfluencePolicy::EqualSampleInfluence,
            mechanism: FitInfluenceMechanism::SampleWeights,
            row_weights: units
                .iter()
                .map(|unit| 1.0 / counts[unit.as_str()] as f64)
                .collect(),
            fit_sample_ids: positions
                .iter()
                .map(|position| self.sample_ids[*position].clone())
                .collect(),
            independent_unit_ids: units.clone(),
            target_names: self.target_names.clone(),
            // Per-target regression fitting also needs this matrix when a
            // particular native fold/source intersection is fully observed.
            target_row_weights: (self.task_type == "regression").then(|| {
                positions
                    .iter()
                    .zip(&units)
                    .map(|(position, unit)| {
                        self.target_values[*position]
                            .iter()
                            .enumerate()
                            .map(|(target, value)| {
                                if value.is_some() {
                                    1.0 / target_counts[&(unit.as_str(), target)] as f64
                                } else {
                                    0.0
                                }
                            })
                            .collect()
                    })
                    .collect()
            }),
            warnings: Vec::new(),
        };
        task.validate()?;
        Ok(task)
    }

    pub(crate) fn class_labels(&self) -> Option<Vec<f64>> {
        (self.task_type == "classification").then(|| {
            let mut labels = self
                .target_values
                .iter()
                .map(|row| row[0].expect("validated class labels"))
                .collect::<Vec<_>>();
            labels.sort_by(f64::total_cmp);
            labels.dedup();
            labels
        })
    }

    pub(crate) fn validate_relations(&self, relations: &SampleRelationSet) -> Result<()> {
        let key = crate::policy::AggregationGroupingKey::RelationMetadata {
            key: "independent_unit_id".into(),
        };
        for (id, unit) in self.sample_ids.iter().zip(&self.independent_unit_ids) {
            if key.group_for_sample(relations, id)?.as_str() != unit {
                return Err(DagMlError::RuntimeValidation(
                    "relation independent units differ from the signed training descriptor".into(),
                ));
            }
        }
        Ok(())
    }
    pub(crate) fn validate_test_cohort(&self, cohort: &crate::data::PredictCohort) -> Result<()> {
        cohort.validate()?;
        if cohort.role != crate::data::PredictCohortRole::ExternalTest {
            return Err(DagMlError::RuntimeValidation(
                "independent-unit CV test authority has a wrong role".into(),
            ));
        }
        let key = crate::policy::AggregationGroupingKey::RelationMetadata {
            key: "independent_unit_id".into(),
        };
        let train = self
            .independent_unit_ids
            .iter()
            .map(String::as_str)
            .collect::<BTreeSet<_>>();
        for id in &cohort.physical_sample_ids {
            let unit = key.group_for_sample(&cohort.relations, id)?;
            if train.contains(unit.as_str()) {
                return Err(DagMlError::RuntimeValidation(
                    "independent unit leaks between Train and external Test".into(),
                ));
            }
        }
        Ok(())
    }
}

impl ExecutionPlan {
    pub(crate) fn validate_experimental_units(&self) -> Result<()> {
        let Some(units) = experimental_units(self)? else {
            if self.campaign.aggregation_policy.grouping_key.is_some()
                || self.node_plans.values().any(|node| {
                    node.shape_plan
                        .as_ref()
                        .is_some_and(|shape| shape.aggregation_policy.grouping_key.is_some())
                })
            {
                return Err(DagMlError::RuntimeValidation(
                    "independent-unit grouping requires a signed experimental_unit descriptor"
                        .into(),
                ));
            }
            return Ok(());
        };
        units.validate()?;
        if let Some(availability) = prediction_availability(self)? {
            if availability.target_names != units.target_names {
                return Err(DagMlError::RuntimeValidation(
                    "independent-unit targets differ from availability contract".into(),
                ));
            }
            for (index, id) in units.sample_ids.iter().enumerate() {
                let position = availability
                    .sample_ids
                    .iter()
                    .position(|sample| sample == id)
                    .ok_or_else(|| {
                        DagMlError::RuntimeValidation(
                            "independent-unit sample absent from availability".into(),
                        )
                    })?;
                if availability.target_validity_masks[position]
                    .iter()
                    .zip(&units.target_values[index])
                    .any(|(valid, value)| *valid != value.is_some())
                {
                    return Err(DagMlError::RuntimeValidation(
                        "independent-unit target mask differs from availability".into(),
                    ));
                }
                if availability
                    .sample_labels
                    .as_ref()
                    .is_some_and(|labels| labels[position] != units.target_values[index][0])
                {
                    return Err(DagMlError::RuntimeValidation(
                        "independent-unit class labels differ from availability".into(),
                    ));
                }
            }
        }
        let policy = &self.campaign.aggregation_policy;
        let expected_key = crate::policy::AggregationGroupingKey::RelationMetadata {
            key: "independent_unit_id".into(),
        };
        if policy.grouping_key.as_ref() != Some(&expected_key)
            || policy.aggregation_level != PredictionLevel::Group
            || policy.selection_metric_level != PredictionLevel::Group
            || policy.method
                != if units.task_type == "classification" {
                    crate::policy::AggregationMethod::Vote
                } else {
                    crate::policy::AggregationMethod::Mean
                }
        {
            return Err(DagMlError::RuntimeValidation(
                "experimental-unit scoring requires the explicit native Group policy".into(),
            ));
        }
        if let Some(folds) = &self.fold_set {
            if folds.sample_ids.iter().collect::<BTreeSet<_>>()
                != units.sample_ids.iter().collect::<BTreeSet<_>>()
            {
                return Err(DagMlError::RuntimeValidation(
                    "experimental-unit universe differs from FoldSet".into(),
                ));
            }
            units.validate_fold_set(folds)?;
        }
        let nested = nested_stacking_campaign_plans(self)?;
        for campaign in &nested {
            for outer in &campaign.outer_scopes {
                units.validate_fold_set(&outer.inner.inner_fold_set)?;
            }
            if let Some(refit) = &campaign.refit_fold_set {
                units.validate_fold_set(refit)?;
            }
        }
        for graph_node in &self.graph_plan.graph.nodes {
            let node = &self.node_plans[&graph_node.id];
            if graph_node.kind != NodeKind::Model {
                if matches!(
                    node.fit_scope,
                    crate::controller::ControllerFitScope::FoldTrain
                        | crate::controller::ControllerFitScope::FullTrain
                ) {
                    return Err(DagMlError::RuntimeValidation("independent-unit profile requires weighted preprocessing inside the model owner; separate fitting nodes are unsupported".into()));
                }
                continue;
            }
            if units.task_type == "classification"
                && graph_node
                    .metadata
                    .get("nirs4all_prediction_output")
                    .and_then(serde_json::Value::as_str)
                    == Some("proba")
                && !(prediction_availability(self)?
                    .is_some_and(|availability| availability.class_labels.is_some())
                    && availability_source(self, &node.node_id)?.is_some())
            {
                return Err(DagMlError::RuntimeValidation("independent-unit classification cannot score a legacy probability-only prediction projection".into()));
            }
            if !node
                .controller_capabilities
                .contains(&ControllerCapability::SupportsSampleWeights)
            {
                return Err(DagMlError::RuntimeValidation(format!(
                    "model `{}` cannot honor independent-unit sample weights",
                    node.node_id
                )));
            }
            if node.shape_plan.as_ref().is_some_and(|shape| {
                shape.aggregation_policy.grouping_key.is_some()
                    || shape.aggregation_policy.aggregation_level != PredictionLevel::Sample
            }) {
                return Err(DagMlError::RuntimeValidation(
                    "independent-unit scoring must not alter sample-keyed model/OOF features"
                        .into(),
                ));
            }
            units.selected_positions(self, node, &units.sample_ids)?;
            if let Some(folds) = &self.fold_set {
                for fold in &folds.folds {
                    units.selected_positions(self, node, &fold.train_sample_ids)?;
                    units.validate_scored_scope(self, node, &fold.validation_sample_ids)?;
                }
            }
            for campaign in &nested {
                if campaign.base_node_ids.contains(&node.node_id) {
                    for outer in &campaign.outer_scopes {
                        for fold in &outer.inner.inner_fold_set.folds {
                            units.selected_positions(self, node, &fold.train_sample_ids)?;
                        }
                    }
                    if let Some(refit) = &campaign.refit_fold_set {
                        for fold in &refit.folds {
                            units.selected_positions(self, node, &fold.train_sample_ids)?;
                        }
                    }
                }
            }
        }
        Ok(())
    }
}
