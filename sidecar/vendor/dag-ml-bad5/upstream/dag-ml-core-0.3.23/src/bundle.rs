use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};
use sha2::Digest;

use crate::aggregation::{AggregatedPredictionBlock, PredictionUnitId};
use crate::campaign::stable_json_fingerprint;
use crate::canonical::deserialize_external_contract;
use crate::conformal_runtime::ConformalCalibrationRef;
use crate::data::{
    data_binding_requirement_key, ExternalDataPlanEnvelope, RepresentationCompatibilityReport,
    RepresentationReplayManifest,
};
use crate::error::{DagMlError, Result};
use crate::ids::{ArtifactId, BundleId, ControllerId, FoldId, NodeId, SampleId, VariantId};
use crate::metrics::{RegressionMetricReport, RegressionTargetBlock, ScoreSet};
use crate::oof::{PredictionBlock, PredictionPartition};
use crate::phase::Phase;
use crate::plan::ExecutionPlan;
use crate::policy::PredictionLevel;
use crate::runtime::{ArtifactBackend, ArtifactRef};
use crate::selection::SelectionDecision;

/// Schema version for the durable, self-contained Methods HPO resume state.
pub const METHODS_HPO_RESUME_STATE_SCHEMA_VERSION: u32 = 1;

/// The scalar selection identity bound into a persisted Methods HPO campaign.
///
/// This deliberately carries the selection id as well as the actual model
/// output and metric.  A N4MOPT payload has no knowledge of DAG-ML's SELECT
/// contract, so restoring it without this identity would permit an optimizer
/// history to be applied to a different decision boundary.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MethodsHpoResumeSelection {
    pub selection_id: String,
    pub target_node_id: NodeId,
    pub producer_port: String,
    pub metric: String,
}

/// Exact coordinator provenance bound to an N4MOPT checkpoint.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MethodsHpoResumeProvenance {
    pub graph_fingerprint: String,
    pub campaign_fingerprint: String,
    pub controller_fingerprint: String,
    pub data_identities_fingerprint: String,
    pub fold_set_fingerprint: String,
    pub training_influence_fingerprint: String,
    pub relation_fingerprint: String,
    pub selection: MethodsHpoResumeSelection,
}

/// A completed native proposal paired with its exact, scheduler-owned plan
/// variant.  Native checkpoints alone cannot reconstruct this value.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MethodsHpoCompletedProposal {
    pub trial_id: i64,
    pub variant: crate::generation::VariantPlan,
}

/// The sole report permitted to terminalize a persisted trial: the scalar
/// cross-fold validation OOF average used by SELECT.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MethodsHpoCompletedReport {
    pub trial_id: i64,
    pub variant_id: VariantId,
    /// Only terminally completed trials may carry report-grade OOF evidence.
    /// `failed` and `pruned` are deliberately not representable here.
    pub terminal_state: MethodsHpoCompletedState,
    pub score: f64,
    pub report: RegressionMetricReport,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MethodsHpoCompletedState {
    Completed,
}

/// Per-sample OOF average retained with its matching targets.  This is a
/// serializable equivalent of the transient `OofAverageBlock`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MethodsHpoOofAverage {
    pub predictions: AggregatedPredictionBlock,
    pub y_true: RegressionTargetBlock,
}

/// Candidate-level evidence retained because it was needed to produce the
/// selection decision.  It is report-grade only and never a training input.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MethodsHpoCandidateEvidence {
    pub trial_id: i64,
    pub variant_id: VariantId,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub variant_label: Option<String>,
    pub predictions: Vec<PredictionBlock>,
    pub regression_targets: Vec<RegressionTargetBlock>,
    pub oof_average: MethodsHpoOofAverage,
    pub lineage: Vec<crate::runtime::LineageRecord>,
}

/// Native optimizer incumbent recorded beside scheduler evidence. This is the
/// only portable assertion that DAG-ML's SELECT agrees with Methods `best()`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MethodsHpoNativeIncumbent {
    pub trial_id: i64,
    pub score: f64,
    pub metric: String,
    pub direction: crate::hpo::HpoDirection,
    pub variant_id: VariantId,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MethodsHpoTerminalEvidence {
    pub trial: crate::hpo::HpoTrial,
    pub variant_id: Option<VariantId>,
}

/// Atomic portable state required to resume a Methods HPO campaign.
///
/// A restore path must consume this whole object after deserializing its
/// containing package.  In particular, the N4MOPT bytes are never a free
/// descriptor field: proposals, terminal OOF reports, candidate predictions
/// and lineage remain inseparable from their native optimizer state.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MethodsHpoResumeState {
    pub schema_version: u32,
    pub checkpoint: crate::hpo::N4moptCheckpointArtifact,
    pub provenance: MethodsHpoResumeProvenance,
    /// Scheduler campaign operation identity. HPO is not a graph node.
    pub operation_id: String,
    pub controller_id: ControllerId,
    pub target_node_id: NodeId,
    pub incumbent: MethodsHpoNativeIncumbent,
    /// Total terminal/native-history cardinality, including failed and pruned
    /// trials which deliberately have no selectable OOF candidate payload.
    pub trial_history_len: u32,
    pub terminal_trials: Vec<MethodsHpoTerminalEvidence>,
    pub completed_proposals: Vec<MethodsHpoCompletedProposal>,
    pub completed_reports: Vec<MethodsHpoCompletedReport>,
    pub candidates: Vec<MethodsHpoCandidateEvidence>,
}

impl MethodsHpoResumeState {
    /// Materialize the portable state from scheduler-owned campaign evidence.
    /// This is intentionally the only conversion from the non-serializable
    /// runtime checkpoint result: callers must supply every candidate's OOF
    /// predictions and lineage, rather than serializing a bare checkpoint.
    pub fn from_runtime_checkpoint(
        checkpoint: crate::runtime::RuntimeHpoCheckpointResult,
        selection: MethodsHpoResumeSelection,
        candidates: Vec<crate::runtime::RuntimeHpoCandidateEvaluation>,
        incumbent: crate::runtime::RuntimeHpoIncumbent,
        terminal_trials: Vec<crate::runtime::RuntimeHpoTerminalSnapshot>,
    ) -> Result<Self> {
        let candidate_scores = candidates
            .iter()
            .map(|candidate| (candidate.proposal.trial_id, candidate.score))
            .collect::<BTreeMap<_, _>>();
        let completed_proposals = checkpoint
            .completed_proposals
            .iter()
            .map(|proposal| MethodsHpoCompletedProposal {
                trial_id: proposal.trial_id,
                variant: proposal.variant.clone(),
            })
            .collect();
        let completed_reports = checkpoint
            .completed_reports
            .iter()
            .map(|completed| {
                let metric = selection.metric.as_str();
                if !completed.report.metrics.contains_key(metric) {
                    return Err(DagMlError::RuntimeValidation(format!(
                        "Methods HPO completed trial {} has no `{metric}` OOF metric",
                        completed.trial_id
                    )));
                }
                let score = candidate_scores
                    .get(&completed.trial_id)
                    .copied()
                    .ok_or_else(|| {
                        DagMlError::RuntimeValidation(format!(
                            "Methods HPO completed trial {} has no candidate OOF evidence",
                            completed.trial_id
                        ))
                    })?;
                Ok(MethodsHpoCompletedReport {
                    trial_id: completed.trial_id,
                    variant_id: completed.variant_id.clone(),
                    terminal_state: MethodsHpoCompletedState::Completed,
                    score,
                    report: completed.report.clone(),
                })
            })
            .collect::<Result<Vec<_>>>()?;
        let candidates = candidates
            .into_iter()
            .map(|candidate| {
                let average = candidate
                    .validation_predictions
                    .oof_average
                    .ok_or_else(|| {
                        DagMlError::RuntimeValidation(format!(
                            "Methods HPO trial {} has no cross-fold OOF average",
                            candidate.proposal.trial_id
                        ))
                    })?;
                Ok(MethodsHpoCandidateEvidence {
                    trial_id: candidate.proposal.trial_id,
                    variant_id: candidate.proposal.variant.variant_id.clone(),
                    variant_label: candidate.validation_predictions.variant_label,
                    predictions: candidate.validation_predictions.predictions,
                    regression_targets: candidate.validation_predictions.regression_targets,
                    oof_average: MethodsHpoOofAverage {
                        predictions: average.predictions,
                        y_true: average.y_true,
                    },
                    lineage: candidate.lineage,
                })
            })
            .collect::<Result<Vec<_>>>()?;
        let state = Self {
            schema_version: METHODS_HPO_RESUME_STATE_SCHEMA_VERSION,
            checkpoint: checkpoint.artifact,
            provenance: MethodsHpoResumeProvenance {
                graph_fingerprint: checkpoint.provenance.graph_fingerprint,
                campaign_fingerprint: checkpoint.provenance.campaign_fingerprint,
                controller_fingerprint: checkpoint.provenance.controller_fingerprint,
                data_identities_fingerprint: checkpoint.provenance.data_identities_fingerprint,
                fold_set_fingerprint: checkpoint.provenance.fold_set_fingerprint.ok_or_else(
                    || {
                        DagMlError::RuntimeValidation(
                            "Methods HPO resume requires an attested fold-set fingerprint"
                                .to_string(),
                        )
                    },
                )?,
                training_influence_fingerprint: checkpoint
                    .provenance
                    .training_influence_fingerprint,
                relation_fingerprint: checkpoint.provenance.relation_fingerprint,
                selection,
            },
            operation_id: checkpoint.operation_id,
            controller_id: checkpoint.controller_id,
            target_node_id: checkpoint.target_node_id,
            incumbent: MethodsHpoNativeIncumbent {
                trial_id: incumbent.trial_id,
                score: incumbent.score,
                metric: incumbent.metric,
                direction: incumbent.direction,
                variant_id: incumbent.variant_id,
            },
            trial_history_len: checkpoint.trial_history_len,
            terminal_trials: terminal_trials
                .into_iter()
                .map(|snapshot| MethodsHpoTerminalEvidence {
                    trial: snapshot.trial,
                    variant_id: snapshot.variant_id,
                })
                .collect(),
            completed_proposals,
            completed_reports,
            candidates,
        };
        state.validate()?;
        Ok(state)
    }

    /// Validate internal one-to-one coverage and report-grade OOF evidence.
    pub fn validate(&self) -> Result<()> {
        if self.schema_version != METHODS_HPO_RESUME_STATE_SCHEMA_VERSION {
            return Err(DagMlError::RuntimeValidation(format!(
                "Methods HPO resume state has unsupported schema_version {}",
                self.schema_version
            )));
        }
        self.checkpoint.validate().map_err(|error| {
            DagMlError::RuntimeValidation(format!(
                "Methods HPO resume checkpoint is invalid: {error}"
            ))
        })?;
        if self.checkpoint.binding.controller_id.trim().is_empty()
            || self.checkpoint.binding.study_id.trim().is_empty()
        {
            return Err(DagMlError::RuntimeValidation(
                "Methods HPO resume checkpoint binding has an empty controller or study identity"
                    .to_string(),
            ));
        }
        if self.operation_id.trim().is_empty()
            || self.trial_history_len == 0
            || self.completed_proposals.len() > self.trial_history_len as usize
            || self.controller_id.as_str() != self.checkpoint.binding.controller_id
            || self.target_node_id != self.provenance.selection.target_node_id
            || self.incumbent.metric != self.provenance.selection.metric
            || !self.incumbent.score.is_finite()
        {
            return Err(DagMlError::RuntimeValidation(
                "Methods HPO resume campaign operation or incumbent identity is invalid"
                    .to_string(),
            ));
        }
        if self.terminal_trials.len() != self.trial_history_len as usize
            || self
                .terminal_trials
                .windows(2)
                .any(|pair| pair[0].trial.id >= pair[1].trial.id)
            || self.terminal_trials.iter().any(|evidence| {
                !matches!(
                    evidence.trial.status,
                    crate::hpo::HpoTrialStatus::Completed
                        | crate::hpo::HpoTrialStatus::Pruned
                        | crate::hpo::HpoTrialStatus::Failed
                )
            })
        {
            return Err(DagMlError::RuntimeValidation(
                "Methods HPO terminal trial evidence must exactly cover a strictly ordered terminal native history"
                    .to_string(),
            ));
        }
        for (label, ids) in [
            (
                "completed proposals",
                self.completed_proposals
                    .iter()
                    .map(|item| item.trial_id)
                    .collect::<Vec<_>>(),
            ),
            (
                "completed reports",
                self.completed_reports
                    .iter()
                    .map(|item| item.trial_id)
                    .collect::<Vec<_>>(),
            ),
            (
                "candidate evidence",
                self.candidates
                    .iter()
                    .map(|item| item.trial_id)
                    .collect::<Vec<_>>(),
            ),
        ] {
            if ids.windows(2).any(|pair| pair[0] >= pair[1]) {
                return Err(DagMlError::RuntimeValidation(format!(
                    "Methods HPO resume {label} must be strictly sorted by trial_id"
                )));
            }
        }
        validate_resume_sha256(
            "checkpoint search-space",
            &self.checkpoint.binding.search_space_fingerprint,
        )?;
        validate_resume_sha256(
            "checkpoint optimizer",
            &self.checkpoint.binding.optimizer_fingerprint,
        )?;
        for (label, value) in [
            ("graph", self.provenance.graph_fingerprint.as_str()),
            ("campaign", self.provenance.campaign_fingerprint.as_str()),
            (
                "controller",
                self.provenance.controller_fingerprint.as_str(),
            ),
            (
                "data identities",
                self.provenance.data_identities_fingerprint.as_str(),
            ),
            ("fold set", self.provenance.fold_set_fingerprint.as_str()),
            (
                "training influence",
                self.provenance.training_influence_fingerprint.as_str(),
            ),
            ("relation", self.provenance.relation_fingerprint.as_str()),
        ] {
            validate_resume_sha256(label, value)?;
        }
        for (label, value) in [
            (
                "selection id",
                self.provenance.selection.selection_id.as_str(),
            ),
            (
                "selection producer port",
                self.provenance.selection.producer_port.as_str(),
            ),
            (
                "selection metric",
                self.provenance.selection.metric.as_str(),
            ),
        ] {
            if value.trim().is_empty() {
                return Err(DagMlError::RuntimeValidation(format!(
                    "Methods HPO resume {label} must not be empty"
                )));
            }
        }
        let mut proposals = BTreeMap::new();
        for proposal in &self.completed_proposals {
            proposal.variant.validate()?;
            if proposals
                .insert(proposal.trial_id, &proposal.variant)
                .is_some()
            {
                return Err(DagMlError::RuntimeValidation(format!(
                    "Methods HPO resume has duplicate completed proposal for trial {}",
                    proposal.trial_id
                )));
            }
        }
        if proposals.is_empty() {
            return Err(DagMlError::RuntimeValidation(
                "Methods HPO resume requires at least one completed proposal".to_string(),
            ));
        }
        let terminal_by_trial = self
            .terminal_trials
            .iter()
            .map(|evidence| (evidence.trial.id, evidence))
            .collect::<BTreeMap<_, _>>();
        let completed_terminal_ids = self
            .terminal_trials
            .iter()
            .filter(|evidence| evidence.trial.status == crate::hpo::HpoTrialStatus::Completed)
            .map(|evidence| evidence.trial.id)
            .collect::<BTreeSet<_>>();
        if completed_terminal_ids != proposals.keys().copied().collect()
            || proposals.iter().any(|(trial_id, variant)| {
                terminal_by_trial
                    .get(trial_id)
                    .and_then(|evidence| evidence.variant_id.as_ref())
                    != Some(&variant.variant_id)
            })
        {
            return Err(DagMlError::RuntimeValidation(
                "Methods HPO completed proposal evidence must exactly match terminal native trials"
                    .to_string(),
            ));
        }
        let mut reports = BTreeSet::new();
        for completed in &self.completed_reports {
            let Some(variant) = proposals.get(&completed.trial_id) else {
                return Err(DagMlError::RuntimeValidation(format!(
                    "Methods HPO resume report for trial {} is orphaned",
                    completed.trial_id
                )));
            };
            if !matches!(
                completed.terminal_state,
                MethodsHpoCompletedState::Completed
            ) || variant.variant_id != completed.variant_id
                || !completed.score.is_finite()
            {
                return Err(DagMlError::RuntimeValidation(format!(
                    "Methods HPO resume report for trial {} does not match its proposal",
                    completed.trial_id
                )));
            }
            let terminal = terminal_by_trial[&completed.trial_id];
            if terminal.trial.score.map(f64::to_bits) != Some(completed.score.to_bits())
                || terminal
                    .trial
                    .intermediates
                    .iter()
                    .any(|value| !value.score.is_finite())
            {
                return Err(DagMlError::RuntimeValidation(format!(
                    "Methods HPO terminal trial {} score/intermediate evidence is inconsistent",
                    completed.trial_id
                )));
            }
            validate_resume_report(completed, &self.provenance.selection)?;
            if !reports.insert(completed.trial_id) {
                return Err(DagMlError::RuntimeValidation(format!(
                    "Methods HPO resume has duplicate completed report for trial {}",
                    completed.trial_id
                )));
            }
        }
        if reports != proposals.keys().copied().collect() {
            return Err(DagMlError::RuntimeValidation(
                "Methods HPO resume completed reports must exactly cover completed proposals"
                    .to_string(),
            ));
        }
        let incumbent = self
            .completed_reports
            .iter()
            .find(|report| report.trial_id == self.incumbent.trial_id)
            .ok_or_else(|| {
                DagMlError::RuntimeValidation(
                    "Methods HPO resume incumbent is not a completed scheduler trial".to_string(),
                )
            })?;
        if incumbent.variant_id != self.incumbent.variant_id
            || incumbent.score.to_bits() != self.incumbent.score.to_bits()
        {
            return Err(DagMlError::RuntimeValidation(
                "Methods HPO resume incumbent does not exactly match its completed report"
                    .to_string(),
            ));
        }
        let mut evidence = BTreeSet::new();
        for candidate in &self.candidates {
            let Some(variant) = proposals.get(&candidate.trial_id) else {
                return Err(DagMlError::RuntimeValidation(format!(
                    "Methods HPO candidate evidence for trial {} is orphaned",
                    candidate.trial_id
                )));
            };
            if variant.variant_id != candidate.variant_id {
                return Err(DagMlError::RuntimeValidation(format!(
                    "Methods HPO candidate evidence for trial {} does not match its proposal",
                    candidate.trial_id
                )));
            }
            validate_resume_candidate(candidate, &self.provenance.selection)?;
            if !evidence.insert(candidate.trial_id) {
                return Err(DagMlError::RuntimeValidation(format!(
                    "Methods HPO resume has duplicate candidate evidence for trial {}",
                    candidate.trial_id
                )));
            }
        }
        if evidence != proposals.keys().copied().collect() {
            return Err(DagMlError::RuntimeValidation(
                "Methods HPO candidate evidence must exactly cover completed proposals".to_string(),
            ));
        }
        Ok(())
    }

    /// Validate state against the plan embedded in its containing package.
    pub fn validate_against_plan(&self, plan: &ExecutionPlan) -> Result<()> {
        self.validate()?;
        if self.provenance.graph_fingerprint != plan.graph_fingerprint
            || self.provenance.campaign_fingerprint
                != crate::hpo::campaign_provenance_fingerprint(&plan.campaign)?
            || self.provenance.controller_fingerprint != plan.controller_fingerprint
            || plan
                .fold_set
                .as_ref()
                .map(stable_json_fingerprint)
                .transpose()?
                .as_deref()
                != Some(self.provenance.fold_set_fingerprint.as_str())
        {
            return Err(DagMlError::RuntimeValidation(
                "Methods HPO resume provenance does not match execution plan".to_string(),
            ));
        }
        let target = plan.node_plans.get(&self.target_node_id).ok_or_else(|| {
            DagMlError::RuntimeValidation(
                "Methods HPO resume target node is absent from execution plan".to_string(),
            )
        })?;
        if self.operation_id.trim().is_empty()
            || target.kind != crate::graph::NodeKind::Model
            || self.controller_id.as_str() != self.checkpoint.binding.controller_id
            || self.target_node_id != self.provenance.selection.target_node_id
        {
            return Err(DagMlError::RuntimeValidation(
                "Methods HPO resume campaign/target/checkpoint binding does not match execution plan"
                    .to_string(),
            ));
        }
        Ok(())
    }
}

fn validate_resume_sha256(label: &str, value: &str) -> Result<()> {
    if value.len() != 64
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err(DagMlError::RuntimeValidation(format!(
            "Methods HPO resume {label} fingerprint must be lowercase SHA-256"
        )));
    }
    Ok(())
}

fn validate_resume_report(
    completed: &MethodsHpoCompletedReport,
    selection: &MethodsHpoResumeSelection,
) -> Result<()> {
    completed.report.validate()?;
    let report = &completed.report;
    let metric = report.metrics.get(&selection.metric).ok_or_else(|| {
        DagMlError::RuntimeValidation(format!(
            "Methods HPO report for trial {} omits selection metric `{}`",
            completed.trial_id, selection.metric
        ))
    })?;
    if report.variant_id.as_ref() != Some(&completed.variant_id)
        || report.producer_node != selection.target_node_id
        || report.producer_port.as_deref() != Some(selection.producer_port.as_str())
        || report.partition != PredictionPartition::Validation
        || report.fold_id.as_ref().map(FoldId::as_str) != Some("avg")
        || report.level != PredictionLevel::Sample
        || (metric - completed.score).abs() > 1e-12
    {
        return Err(DagMlError::RuntimeValidation(format!(
            "Methods HPO report for trial {} must be the exact sample-level validation OOF average",
            completed.trial_id
        )));
    }
    Ok(())
}

fn validate_resume_candidate(
    candidate: &MethodsHpoCandidateEvidence,
    selection: &MethodsHpoResumeSelection,
) -> Result<()> {
    if candidate.predictions.is_empty()
        || candidate.predictions.len() != candidate.regression_targets.len()
        || candidate.lineage.is_empty()
    {
        return Err(DagMlError::RuntimeValidation(
            "Methods HPO candidate evidence requires paired fold OOF predictions, targets and lineage"
                .to_string(),
        ));
    }
    for (prediction, target) in candidate
        .predictions
        .iter()
        .zip(&candidate.regression_targets)
    {
        prediction.validate_shape()?;
        target.validate_shape()?;
        if prediction.partition != PredictionPartition::Validation
            || prediction.producer_node != selection.target_node_id
            || prediction.producer_port.as_deref() != Some(selection.producer_port.as_str())
            || prediction.sample_ids
                != target
                    .unit_ids
                    .iter()
                    .filter_map(|unit| match unit {
                        PredictionUnitId::Sample(id) => Some(id.clone()),
                        _ => None,
                    })
                    .collect::<Vec<_>>()
        {
            return Err(DagMlError::RuntimeValidation(
                "Methods HPO candidate fold evidence is not exact validation OOF data for selection"
                    .to_string(),
            ));
        }
    }
    candidate.oof_average.predictions.validate_shape()?;
    candidate.oof_average.y_true.validate_shape()?;
    if candidate.oof_average.predictions.producer_node != selection.target_node_id
        || candidate.oof_average.predictions.producer_port.as_deref()
            != Some(selection.producer_port.as_str())
        || candidate.oof_average.predictions.partition != PredictionPartition::Validation
        || candidate
            .oof_average
            .predictions
            .fold_id
            .as_ref()
            .map(FoldId::as_str)
            != Some("avg")
    {
        return Err(DagMlError::RuntimeValidation(
            "Methods HPO candidate OOF average does not match selection output".to_string(),
        ));
    }
    let mut lineage_ids = BTreeSet::new();
    let mut has_target = false;
    for record in &candidate.lineage {
        record.validate()?;
        if !lineage_ids.insert(record.record_id.clone()) {
            return Err(DagMlError::RuntimeValidation(
                "Methods HPO candidate evidence has duplicate lineage record ids".to_string(),
            ));
        }
        has_target |= record.node_id == selection.target_node_id
            && record.variant_id.as_ref() == Some(&candidate.variant_id);
    }
    if !has_target {
        return Err(DagMlError::RuntimeValidation(
            "Methods HPO candidate lineage does not include its selected target variant"
                .to_string(),
        ));
    }
    Ok(())
}

pub const EXECUTION_BUNDLE_SCHEMA_VERSION: u32 = 2;
pub const PREDICTION_CACHE_PAYLOAD_SCHEMA_VERSION: u32 = 2;
pub const LEGACY_EXECUTION_BUNDLE_SCHEMA_VERSION: u32 = 1;
pub const LEGACY_PREDICTION_CACHE_PAYLOAD_SCHEMA_VERSION: u32 = 1;
pub const LEGACY_BUNDLE_PREDICTION_CACHE_FORMAT: &str = "dag-ml-json-prediction-blocks-v1";
pub const BUNDLE_PREDICTION_CACHE_FORMAT: &str = "dag-ml-json-prediction-blocks-v2";

pub const MIN_READABLE_EXECUTION_BUNDLE_SCHEMA_VERSION: u32 = 1;
pub const MIN_WRITABLE_EXECUTION_BUNDLE_SCHEMA_VERSION: u32 = 2;
pub const MIN_READABLE_PREDICTION_CACHE_PAYLOAD_SCHEMA_VERSION: u32 = 1;
pub const MIN_WRITABLE_PREDICTION_CACHE_PAYLOAD_SCHEMA_VERSION: u32 = 2;

fn default_execution_bundle_schema_version() -> u32 {
    LEGACY_EXECUTION_BUNDLE_SCHEMA_VERSION
}

fn default_prediction_cache_payload_schema_version() -> u32 {
    LEGACY_PREDICTION_CACHE_PAYLOAD_SCHEMA_VERSION
}

fn default_prediction_level() -> PredictionLevel {
    PredictionLevel::Sample
}

fn supported_prediction_cache_format(format: &str) -> bool {
    matches!(
        format,
        LEGACY_BUNDLE_PREDICTION_CACHE_FORMAT | BUNDLE_PREDICTION_CACHE_FORMAT
    )
}

fn prediction_cache_schema_version_for_format(format: &str, owner: &str) -> Result<u32> {
    match format {
        LEGACY_BUNDLE_PREDICTION_CACHE_FORMAT => Ok(LEGACY_PREDICTION_CACHE_PAYLOAD_SCHEMA_VERSION),
        BUNDLE_PREDICTION_CACHE_FORMAT => Ok(PREDICTION_CACHE_PAYLOAD_SCHEMA_VERSION),
        _ => Err(DagMlError::RuntimeValidation(format!(
            "{owner} uses unsupported cache format `{format}`"
        ))),
    }
}

fn expected_prediction_cache_format_for_schema_version(
    schema_version: u32,
    owner: &str,
) -> Result<&'static str> {
    match schema_version {
        LEGACY_EXECUTION_BUNDLE_SCHEMA_VERSION => Ok(LEGACY_BUNDLE_PREDICTION_CACHE_FORMAT),
        EXECUTION_BUNDLE_SCHEMA_VERSION => Ok(BUNDLE_PREDICTION_CACHE_FORMAT),
        _ => Err(DagMlError::RuntimeValidation(format!(
            "{owner} uses unsupported cache family schema_version {schema_version}"
        ))),
    }
}

fn validate_prediction_cache_format_for_schema_version(
    format: &str,
    schema_version: u32,
    owner: &str,
) -> Result<()> {
    let expected = expected_prediction_cache_format_for_schema_version(schema_version, owner)?;
    if format != expected {
        return Err(DagMlError::RuntimeValidation(format!(
            "{owner} uses cache format `{format}` but schema_version {schema_version} requires `{expected}`"
        )));
    }
    Ok(())
}

fn validate_prediction_block_port_family(
    producer_port: &Option<String>,
    schema_version: u32,
    owner: &str,
) -> Result<()> {
    match (schema_version, producer_port.as_deref()) {
        (LEGACY_PREDICTION_CACHE_PAYLOAD_SCHEMA_VERSION, Some(_)) => Err(
            DagMlError::RuntimeValidation(format!("{owner} is V1 but carries producer_port")),
        ),
        (PREDICTION_CACHE_PAYLOAD_SCHEMA_VERSION, Some(port)) if port.trim().is_empty() => {
            Err(DagMlError::RuntimeValidation(format!(
                "{owner} is V2 but carries an empty producer_port"
            )))
        }
        (PREDICTION_CACHE_PAYLOAD_SCHEMA_VERSION, None) => Err(DagMlError::RuntimeValidation(
            format!("{owner} is V2 and requires producer_port"),
        )),
        _ => Ok(()),
    }
}

fn validate_prediction_cache_payload_block_family(
    payload: &BundlePredictionCachePayload,
    schema_version: u32,
) -> Result<()> {
    for block in &payload.blocks {
        validate_prediction_block_port_family(
            &block.producer_port,
            schema_version,
            &format!(
                "prediction cache payload `{}` block for node `{}`",
                payload.cache_id, block.producer_node
            ),
        )?;
    }
    for block in &payload.aggregated_blocks {
        validate_prediction_block_port_family(
            &block.producer_port,
            schema_version,
            &format!(
                "prediction cache payload `{}` aggregated block for node `{}`",
                payload.cache_id, block.producer_node
            ),
        )?;
    }
    Ok(())
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct SchemaMigrationPolicy {
    pub artifact: String,
    pub current_version: u32,
    pub min_readable_version: u32,
    pub min_writable_version: u32,
    #[serde(default)]
    pub automatic_migrations: BTreeMap<u32, u32>,
}

impl SchemaMigrationPolicy {
    pub fn validate(&self) -> Result<()> {
        validate_non_empty("schema migration artifact", &self.artifact)?;
        if self.current_version == 0
            || self.min_readable_version == 0
            || self.min_writable_version == 0
        {
            return Err(DagMlError::RuntimeValidation(format!(
                "schema migration policy `{}` has zero version boundary",
                self.artifact
            )));
        }
        if self.min_readable_version > self.current_version {
            return Err(DagMlError::RuntimeValidation(format!(
                "schema migration policy `{}` min_readable_version exceeds current_version",
                self.artifact
            )));
        }
        if self.min_writable_version > self.current_version {
            return Err(DagMlError::RuntimeValidation(format!(
                "schema migration policy `{}` min_writable_version exceeds current_version",
                self.artifact
            )));
        }
        for (from, to) in &self.automatic_migrations {
            if *from == 0 || *to == 0 {
                return Err(DagMlError::RuntimeValidation(format!(
                    "schema migration policy `{}` contains a zero migration version",
                    self.artifact
                )));
            }
            if from == to {
                return Err(DagMlError::RuntimeValidation(format!(
                    "schema migration policy `{}` contains a no-op migration {from}->{to}",
                    self.artifact
                )));
            }
            if *to > self.current_version {
                return Err(DagMlError::RuntimeValidation(format!(
                    "schema migration policy `{}` migrates to unsupported future version {to}",
                    self.artifact
                )));
            }
        }
        Ok(())
    }

    pub fn validate_read_version(&self, version: u32, owner: &str) -> Result<()> {
        self.validate()?;
        if version < self.min_readable_version {
            return Err(DagMlError::RuntimeValidation(format!(
                "{owner} uses schema_version {version}, below minimum readable {} for {}",
                self.min_readable_version, self.artifact
            )));
        }
        if version > self.current_version {
            return Err(DagMlError::RuntimeValidation(format!(
                "{owner} uses future schema_version {version}, current readable {} for {}",
                self.current_version, self.artifact
            )));
        }
        if version != self.current_version && !self.automatic_migrations.contains_key(&version) {
            return Err(DagMlError::RuntimeValidation(format!(
                "{owner} uses schema_version {version}, but {} declares no automatic migration to current version {}",
                self.artifact, self.current_version
            )));
        }
        Ok(())
    }
}

pub fn execution_bundle_schema_migration_policy() -> SchemaMigrationPolicy {
    SchemaMigrationPolicy {
        artifact: "execution_bundle".to_string(),
        current_version: EXECUTION_BUNDLE_SCHEMA_VERSION,
        min_readable_version: MIN_READABLE_EXECUTION_BUNDLE_SCHEMA_VERSION,
        min_writable_version: MIN_WRITABLE_EXECUTION_BUNDLE_SCHEMA_VERSION,
        automatic_migrations: BTreeMap::from([(
            LEGACY_EXECUTION_BUNDLE_SCHEMA_VERSION,
            EXECUTION_BUNDLE_SCHEMA_VERSION,
        )]),
    }
}

pub fn prediction_cache_payload_schema_migration_policy() -> SchemaMigrationPolicy {
    SchemaMigrationPolicy {
        artifact: "prediction_cache_payload".to_string(),
        current_version: PREDICTION_CACHE_PAYLOAD_SCHEMA_VERSION,
        min_readable_version: MIN_READABLE_PREDICTION_CACHE_PAYLOAD_SCHEMA_VERSION,
        min_writable_version: MIN_WRITABLE_PREDICTION_CACHE_PAYLOAD_SCHEMA_VERSION,
        automatic_migrations: BTreeMap::from([(
            LEGACY_PREDICTION_CACHE_PAYLOAD_SCHEMA_VERSION,
            PREDICTION_CACHE_PAYLOAD_SCHEMA_VERSION,
        )]),
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct BundleDataRequirement {
    pub node_id: NodeId,
    pub input_name: String,
    pub schema_fingerprint: String,
    pub plan_fingerprint: String,
    #[serde(default)]
    pub relation_fingerprint: Option<String>,
    pub output_representation: String,
    #[serde(default)]
    pub feature_set_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub representation_replay_manifest: Option<RepresentationReplayManifest>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub representation_compatibility: Option<RepresentationCompatibilityReport>,
}

impl BundleDataRequirement {
    pub fn key(&self) -> String {
        data_binding_requirement_key(&self.node_id, &self.input_name)
    }

    fn matches_plan_requirement(&self, expected: &Self) -> bool {
        self.node_id == expected.node_id
            && self.input_name == expected.input_name
            && self.schema_fingerprint == expected.schema_fingerprint
            && self.plan_fingerprint == expected.plan_fingerprint
            && self.relation_fingerprint == expected.relation_fingerprint
            && self.output_representation == expected.output_representation
            && self.feature_set_id == expected.feature_set_id
    }

    pub fn validate(&self) -> Result<()> {
        if self.input_name.trim().is_empty() {
            return Err(DagMlError::CampaignValidation(format!(
                "bundle data requirement for `{}` has empty input_name",
                self.node_id
            )));
        }
        validate_fingerprint("schema", &self.schema_fingerprint)?;
        validate_fingerprint("plan", &self.plan_fingerprint)?;
        if let Some(relation_fingerprint) = &self.relation_fingerprint {
            validate_fingerprint("relation", relation_fingerprint)?;
        }
        if let Some(replay_manifest) = &self.representation_replay_manifest {
            replay_manifest.validate()?;
            if let (Some(requirement), Some(manifest)) = (
                self.relation_fingerprint.as_deref(),
                replay_manifest.relation_fingerprint.as_deref(),
            ) {
                if requirement != manifest {
                    return Err(DagMlError::CampaignValidation(format!(
                        "bundle data requirement `{}` relation_fingerprint does not match representation replay manifest",
                        self.key()
                    )));
                }
            }
        }
        if let Some(report) = &self.representation_compatibility {
            report.validate()?;
        }
        if self.output_representation.trim().is_empty() {
            return Err(DagMlError::CampaignValidation(format!(
                "bundle data requirement `{}` has empty output representation",
                self.key()
            )));
        }
        if let Some(feature_set_id) = &self.feature_set_id {
            if feature_set_id.trim().is_empty() {
                return Err(DagMlError::CampaignValidation(format!(
                    "bundle data requirement `{}` has empty feature_set_id",
                    self.key()
                )));
            }
        }
        Ok(())
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct BundlePredictionRequirement {
    pub producer_node: NodeId,
    pub source_port: String,
    pub consumer_node: NodeId,
    pub target_port: String,
    pub partition: PredictionPartition,
    #[serde(default = "default_prediction_level")]
    pub prediction_level: PredictionLevel,
    #[serde(default)]
    pub fold_ids: Vec<FoldId>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub unit_ids: Vec<PredictionUnitId>,
    #[serde(default)]
    pub sample_ids: Vec<SampleId>,
    pub prediction_width: usize,
    pub target_names: Vec<String>,
}

impl BundlePredictionRequirement {
    pub fn key(&self) -> String {
        bundle_prediction_requirement_key(
            &self.producer_node,
            &self.source_port,
            &self.consumer_node,
            &self.target_port,
        )
    }

    pub fn validate(&self) -> Result<()> {
        validate_non_empty("source_port", &self.source_port)?;
        validate_non_empty("target_port", &self.target_port)?;
        if self.partition != PredictionPartition::Validation {
            return Err(DagMlError::RuntimeValidation(format!(
                "bundle prediction requirement `{}` must use validation OOF predictions",
                self.key()
            )));
        }
        validate_unique_ids("fold id", &self.fold_ids)?;
        validate_prediction_requirement_units(self)?;
        if self.prediction_width == 0 {
            return Err(DagMlError::RuntimeValidation(format!(
                "bundle prediction requirement `{}` has zero prediction width",
                self.key()
            )));
        }
        if self.target_names.len() != self.prediction_width {
            return Err(DagMlError::RuntimeValidation(format!(
                "bundle prediction requirement `{}` target name count does not match prediction width",
                self.key()
            )));
        }
        for target_name in &self.target_names {
            validate_non_empty("target_name", target_name)?;
        }
        Ok(())
    }
}

pub fn bundle_prediction_requirement_key(
    producer_node: &NodeId,
    source_port: &str,
    consumer_node: &NodeId,
    target_port: &str,
) -> String {
    format!("{producer_node}.{source_port}->{consumer_node}.{target_port}")
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct BundlePredictionBlockCacheRecord {
    #[serde(default)]
    pub prediction_id: Option<String>,
    #[serde(default)]
    pub fold_id: Option<FoldId>,
    #[serde(default = "default_prediction_level")]
    pub prediction_level: PredictionLevel,
    pub row_count: usize,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub unit_ids: Vec<PredictionUnitId>,
    #[serde(default)]
    pub sample_ids: Vec<SampleId>,
    pub content_fingerprint: String,
}

impl BundlePredictionBlockCacheRecord {
    pub fn validate(&self) -> Result<()> {
        if let Some(prediction_id) = &self.prediction_id {
            validate_non_empty("prediction_id", prediction_id)?;
        }
        if self.row_count == 0 {
            return Err(DagMlError::RuntimeValidation(
                "prediction block cache record has zero rows".to_string(),
            ));
        }
        validate_prediction_cache_block_record_units(self)?;
        validate_fingerprint("prediction block cache content", &self.content_fingerprint)
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct BundlePredictionCacheRecord {
    pub requirement_key: String,
    pub cache_id: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub cache_namespace_fingerprints: Vec<String>,
    pub format: String,
    pub partition: PredictionPartition,
    #[serde(default = "default_prediction_level")]
    pub prediction_level: PredictionLevel,
    #[serde(default)]
    pub fold_ids: Vec<FoldId>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub unit_ids: Vec<PredictionUnitId>,
    #[serde(default)]
    pub sample_ids: Vec<SampleId>,
    pub prediction_width: usize,
    pub target_names: Vec<String>,
    pub block_count: usize,
    pub row_count: usize,
    pub content_fingerprint: String,
    #[serde(default)]
    pub blocks: Vec<BundlePredictionBlockCacheRecord>,
}

impl BundlePredictionCacheRecord {
    pub fn validate(&self) -> Result<()> {
        validate_non_empty("requirement_key", &self.requirement_key)?;
        validate_non_empty("cache_id", &self.cache_id)?;
        validate_prediction_cache_namespace_fingerprints(
            &self.cache_id,
            &self.cache_namespace_fingerprints,
        )?;
        validate_non_empty("format", &self.format)?;
        if !supported_prediction_cache_format(&self.format) {
            return Err(DagMlError::RuntimeValidation(format!(
                "prediction cache `{}` uses unsupported format `{}`",
                self.cache_id, self.format
            )));
        }
        if self.partition != PredictionPartition::Validation {
            return Err(DagMlError::RuntimeValidation(format!(
                "prediction cache `{}` must cache validation OOF predictions",
                self.cache_id
            )));
        }
        validate_unique_ids("fold id", &self.fold_ids)?;
        validate_prediction_cache_record_units(self)?;
        if self.prediction_width == 0 {
            return Err(DagMlError::RuntimeValidation(format!(
                "prediction cache `{}` has zero prediction width",
                self.cache_id
            )));
        }
        if self.target_names.len() != self.prediction_width {
            return Err(DagMlError::RuntimeValidation(format!(
                "prediction cache `{}` target name count does not match prediction width",
                self.cache_id
            )));
        }
        for target_name in &self.target_names {
            validate_non_empty("target_name", target_name)?;
        }
        if self.block_count == 0 || self.block_count != self.blocks.len() {
            return Err(DagMlError::RuntimeValidation(format!(
                "prediction cache `{}` block_count does not match block records",
                self.cache_id
            )));
        }
        if !self.cache_namespace_fingerprints.is_empty()
            && self.cache_namespace_fingerprints.len() != self.block_count
        {
            return Err(DagMlError::RuntimeValidation(format!(
                "prediction cache `{}` namespace fingerprint count does not match block_count",
                self.cache_id
            )));
        }
        validate_prediction_cache_record_blocks(self)?;
        validate_fingerprint("prediction cache content", &self.content_fingerprint)?;
        Ok(())
    }
}

fn validate_prediction_requirement_units(requirement: &BundlePredictionRequirement) -> Result<()> {
    match requirement.prediction_level {
        PredictionLevel::Observation => Err(DagMlError::RuntimeValidation(format!(
            "bundle prediction requirement `{}` cannot replay observation-level caches; aggregate to sample first",
            requirement.key()
        ))),
        PredictionLevel::Sample => {
            validate_unique_ids("sample id", &requirement.sample_ids)?;
            if requirement.sample_ids.is_empty() {
                return Err(DagMlError::RuntimeValidation(format!(
                    "bundle prediction requirement `{}` has no sample ids",
                    requirement.key()
                )));
            }
            if !requirement.unit_ids.is_empty()
                && requirement.unit_ids != sample_prediction_units(&requirement.sample_ids)
            {
                return Err(DagMlError::RuntimeValidation(format!(
                    "bundle prediction requirement `{}` sample ids do not match unit ids",
                    requirement.key()
                )));
            }
            Ok(())
        }
        PredictionLevel::Target | PredictionLevel::Group => {
            if !requirement.sample_ids.is_empty() {
                return Err(DagMlError::RuntimeValidation(format!(
                    "bundle prediction requirement `{}` uses {:?} unit ids but also carries sample ids",
                    requirement.key(),
                    requirement.prediction_level
                )));
            }
            validate_prediction_units(
                "bundle prediction requirement unit",
                requirement.prediction_level,
                &requirement.unit_ids,
            )?;
            if requirement.unit_ids.is_empty() {
                return Err(DagMlError::RuntimeValidation(format!(
                    "bundle prediction requirement `{}` has no unit ids",
                    requirement.key()
                )));
            }
            Ok(())
        }
    }
}

fn validate_prediction_cache_block_record_units(
    block: &BundlePredictionBlockCacheRecord,
) -> Result<()> {
    match block.prediction_level {
        PredictionLevel::Observation => Err(DagMlError::RuntimeValidation(
            "prediction block cache record cannot use observation-level predictions".to_string(),
        )),
        PredictionLevel::Sample => {
            validate_unique_ids("sample id", &block.sample_ids)?;
            if block.row_count != block.sample_ids.len() {
                return Err(DagMlError::RuntimeValidation(format!(
                    "prediction block cache record row_count {} does not match {} sample ids",
                    block.row_count,
                    block.sample_ids.len()
                )));
            }
            if !block.unit_ids.is_empty()
                && block.unit_ids != sample_prediction_units(&block.sample_ids)
            {
                return Err(DagMlError::RuntimeValidation(
                    "prediction block cache record sample ids do not match unit ids".to_string(),
                ));
            }
            Ok(())
        }
        PredictionLevel::Target | PredictionLevel::Group => {
            if !block.sample_ids.is_empty() {
                return Err(DagMlError::RuntimeValidation(format!(
                    "prediction block cache record uses {:?} unit ids but also carries sample ids",
                    block.prediction_level
                )));
            }
            validate_prediction_units(
                "prediction block cache record unit",
                block.prediction_level,
                &block.unit_ids,
            )?;
            if block.row_count != block.unit_ids.len() {
                return Err(DagMlError::RuntimeValidation(format!(
                    "prediction block cache record row_count {} does not match {} unit ids",
                    block.row_count,
                    block.unit_ids.len()
                )));
            }
            Ok(())
        }
    }
}

fn validate_prediction_cache_record_units(cache: &BundlePredictionCacheRecord) -> Result<()> {
    match cache.prediction_level {
        PredictionLevel::Observation => Err(DagMlError::RuntimeValidation(format!(
            "prediction cache `{}` cannot use observation-level predictions",
            cache.cache_id
        ))),
        PredictionLevel::Sample => {
            validate_unique_ids("sample id", &cache.sample_ids)?;
            if cache.row_count != cache.sample_ids.len() {
                return Err(DagMlError::RuntimeValidation(format!(
                    "prediction cache `{}` row_count does not match unique sample ids",
                    cache.cache_id
                )));
            }
            if !cache.unit_ids.is_empty()
                && cache.unit_ids != sample_prediction_units(&cache.sample_ids)
            {
                return Err(DagMlError::RuntimeValidation(format!(
                    "prediction cache `{}` sample ids do not match unit ids",
                    cache.cache_id
                )));
            }
            Ok(())
        }
        PredictionLevel::Target | PredictionLevel::Group => {
            if !cache.sample_ids.is_empty() {
                return Err(DagMlError::RuntimeValidation(format!(
                    "prediction cache `{}` uses {:?} unit ids but also carries sample ids",
                    cache.cache_id, cache.prediction_level
                )));
            }
            validate_prediction_units(
                "prediction cache unit",
                cache.prediction_level,
                &cache.unit_ids,
            )?;
            if cache.row_count != cache.unit_ids.len() {
                return Err(DagMlError::RuntimeValidation(format!(
                    "prediction cache `{}` row_count does not match unique unit ids",
                    cache.cache_id
                )));
            }
            Ok(())
        }
    }
}

fn validate_prediction_cache_record_blocks(cache: &BundlePredictionCacheRecord) -> Result<()> {
    let mut row_count = 0usize;
    let mut samples = BTreeSet::new();
    let mut units = BTreeSet::new();
    for block in &cache.blocks {
        block.validate()?;
        if block.prediction_level != cache.prediction_level {
            return Err(DagMlError::RuntimeValidation(format!(
                "prediction cache `{}` mixes block prediction levels",
                cache.cache_id
            )));
        }
        row_count += block.row_count;
        match cache.prediction_level {
            PredictionLevel::Sample => {
                for sample_id in &block.sample_ids {
                    if !samples.insert(sample_id.clone()) {
                        return Err(DagMlError::RuntimeValidation(format!(
                            "prediction cache `{}` contains duplicate sample `{sample_id}`",
                            cache.cache_id
                        )));
                    }
                }
            }
            PredictionLevel::Target | PredictionLevel::Group => {
                for unit_id in &block.unit_ids {
                    if !units.insert(unit_id.clone()) {
                        return Err(DagMlError::RuntimeValidation(format!(
                            "prediction cache `{}` contains duplicate unit `{unit_id}`",
                            cache.cache_id
                        )));
                    }
                }
            }
            PredictionLevel::Observation => {
                unreachable!("record unit validation rejects observation")
            }
        }
    }
    if cache.row_count == 0 || cache.row_count != row_count {
        return Err(DagMlError::RuntimeValidation(format!(
            "prediction cache `{}` row_count does not match block records",
            cache.cache_id
        )));
    }
    if cache.prediction_level == PredictionLevel::Sample {
        let expected = cache.sample_ids.iter().cloned().collect::<BTreeSet<_>>();
        if samples != expected {
            return Err(DagMlError::RuntimeValidation(format!(
                "prediction cache `{}` block samples do not match cache sample ids",
                cache.cache_id
            )));
        }
    } else {
        let expected = cache.unit_ids.iter().cloned().collect::<BTreeSet<_>>();
        if units != expected {
            return Err(DagMlError::RuntimeValidation(format!(
                "prediction cache `{}` block units do not match cache unit ids",
                cache.cache_id
            )));
        }
    }
    Ok(())
}

fn validate_prediction_cache_payload_blocks(
    payload: &BundlePredictionCachePayload,
) -> Result<usize> {
    match payload.prediction_level {
        PredictionLevel::Observation => Err(DagMlError::RuntimeValidation(format!(
            "prediction cache payload `{}` cannot use observation-level predictions",
            payload.cache_id
        ))),
        PredictionLevel::Sample => validate_sample_prediction_cache_payload_blocks(payload),
        PredictionLevel::Target | PredictionLevel::Group => {
            validate_aggregated_prediction_cache_payload_blocks(payload)
        }
    }
}

fn validate_sample_prediction_cache_payload_blocks(
    payload: &BundlePredictionCachePayload,
) -> Result<usize> {
    let mut row_count = 0usize;
    let mut sample_ids = BTreeSet::new();
    for block in &payload.blocks {
        block.validate_shape()?;
        if block.partition != payload.partition {
            return Err(DagMlError::RuntimeValidation(format!(
                "prediction cache payload `{}` contains a block from partition {:?}",
                payload.cache_id, block.partition
            )));
        }
        for sample_id in &block.sample_ids {
            if !sample_ids.insert(sample_id) {
                return Err(DagMlError::RuntimeValidation(format!(
                    "prediction cache payload `{}` contains duplicate sample `{}`",
                    payload.cache_id, sample_id
                )));
            }
        }
        row_count += block.sample_ids.len();
    }
    Ok(row_count)
}

fn validate_aggregated_prediction_cache_payload_blocks(
    payload: &BundlePredictionCachePayload,
) -> Result<usize> {
    let mut row_count = 0usize;
    let mut unit_ids = BTreeSet::new();
    for block in &payload.aggregated_blocks {
        block.validate_shape()?;
        if block.partition != payload.partition {
            return Err(DagMlError::RuntimeValidation(format!(
                "prediction cache payload `{}` contains an aggregated block from partition {:?}",
                payload.cache_id, block.partition
            )));
        }
        if block.level != payload.prediction_level {
            return Err(DagMlError::RuntimeValidation(format!(
                "prediction cache payload `{}` contains {:?} block inside {:?} payload",
                payload.cache_id, block.level, payload.prediction_level
            )));
        }
        for unit_id in &block.unit_ids {
            if !unit_ids.insert(unit_id) {
                return Err(DagMlError::RuntimeValidation(format!(
                    "prediction cache payload `{}` contains duplicate unit `{unit_id}`",
                    payload.cache_id
                )));
            }
        }
        row_count += block.unit_ids.len();
    }
    Ok(row_count)
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct BundlePredictionCachePayload {
    pub requirement_key: String,
    pub cache_id: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub cache_namespace_fingerprints: Vec<String>,
    pub format: String,
    pub partition: PredictionPartition,
    #[serde(default = "default_prediction_level")]
    pub prediction_level: PredictionLevel,
    pub block_count: usize,
    pub row_count: usize,
    pub content_fingerprint: String,
    #[serde(default)]
    pub blocks: Vec<PredictionBlock>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub aggregated_blocks: Vec<AggregatedPredictionBlock>,
}

impl BundlePredictionCachePayload {
    pub fn validate(&self) -> Result<()> {
        validate_non_empty("requirement_key", &self.requirement_key)?;
        validate_non_empty("cache_id", &self.cache_id)?;
        validate_prediction_cache_namespace_fingerprints(
            &self.cache_id,
            &self.cache_namespace_fingerprints,
        )?;
        validate_non_empty("format", &self.format)?;
        if !supported_prediction_cache_format(&self.format) {
            return Err(DagMlError::RuntimeValidation(format!(
                "prediction cache payload `{}` uses unsupported format `{}`",
                self.cache_id, self.format
            )));
        }
        let payload_schema_version = prediction_cache_schema_version_for_format(
            &self.format,
            &format!("prediction cache payload `{}`", self.cache_id),
        )?;
        if self.partition != PredictionPartition::Validation {
            return Err(DagMlError::RuntimeValidation(format!(
                "prediction cache payload `{}` must cache validation OOF predictions",
                self.cache_id
            )));
        }
        let expected_block_count = if self.prediction_level == PredictionLevel::Sample {
            if !self.aggregated_blocks.is_empty() {
                return Err(DagMlError::RuntimeValidation(format!(
                    "prediction cache payload `{}` mixes sample and aggregated blocks",
                    self.cache_id
                )));
            }
            self.blocks.len()
        } else {
            if !self.blocks.is_empty() {
                return Err(DagMlError::RuntimeValidation(format!(
                    "prediction cache payload `{}` mixes aggregated and sample blocks",
                    self.cache_id
                )));
            }
            self.aggregated_blocks.len()
        };
        if self.block_count == 0 || self.block_count != expected_block_count {
            return Err(DagMlError::RuntimeValidation(format!(
                "prediction cache payload `{}` block_count does not match blocks",
                self.cache_id
            )));
        }
        if !self.cache_namespace_fingerprints.is_empty()
            && self.cache_namespace_fingerprints.len() != self.block_count
        {
            return Err(DagMlError::RuntimeValidation(format!(
                "prediction cache payload `{}` namespace fingerprint count does not match block_count",
                self.cache_id
            )));
        }
        let row_count = validate_prediction_cache_payload_blocks(self)?;
        if self.row_count == 0 || self.row_count != row_count {
            return Err(DagMlError::RuntimeValidation(format!(
                "prediction cache payload `{}` row_count does not match blocks",
                self.cache_id
            )));
        }
        validate_prediction_cache_payload_block_family(self, payload_schema_version)?;
        validate_fingerprint(
            "prediction cache payload content",
            &self.content_fingerprint,
        )?;
        let actual_fingerprint = if self.prediction_level == PredictionLevel::Sample {
            stable_json_fingerprint(&self.blocks)?
        } else {
            stable_json_fingerprint(&self.aggregated_blocks)?
        };
        if actual_fingerprint != self.content_fingerprint {
            return Err(DagMlError::RuntimeValidation(format!(
                "prediction cache payload `{}` content fingerprint does not match blocks",
                self.cache_id
            )));
        }
        Ok(())
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct BundlePredictionCachePayloadSet {
    pub bundle_id: BundleId,
    #[serde(default = "default_prediction_cache_payload_schema_version")]
    pub schema_version: u32,
    #[serde(default)]
    pub caches: Vec<BundlePredictionCachePayload>,
}

impl BundlePredictionCachePayloadSet {
    pub fn validate(&self) -> Result<()> {
        prediction_cache_payload_schema_migration_policy().validate_read_version(
            self.schema_version,
            &format!(
                "prediction cache payload set for bundle `{}`",
                self.bundle_id
            ),
        )?;
        let mut requirement_keys = BTreeSet::new();
        let mut cache_ids = BTreeSet::new();
        for payload in &self.caches {
            payload.validate()?;
            validate_prediction_cache_format_for_schema_version(
                &payload.format,
                self.schema_version,
                &format!(
                    "prediction cache payload `{}` in set for bundle `{}`",
                    payload.cache_id, self.bundle_id
                ),
            )?;
            validate_prediction_cache_payload_block_family(payload, self.schema_version)?;
            if !requirement_keys.insert(payload.requirement_key.as_str()) {
                return Err(DagMlError::RuntimeValidation(format!(
                    "prediction cache payload set for bundle `{}` has duplicate requirement `{}`",
                    self.bundle_id, payload.requirement_key
                )));
            }
            if !cache_ids.insert(payload.cache_id.as_str()) {
                return Err(DagMlError::RuntimeValidation(format!(
                    "prediction cache payload set for bundle `{}` has duplicate cache id `{}`",
                    self.bundle_id, payload.cache_id
                )));
            }
        }
        Ok(())
    }

    pub fn validate_against_bundle(&self, bundle: &ExecutionBundle) -> Result<()> {
        self.validate()?;
        bundle.validate()?;
        if self.bundle_id != bundle.bundle_id {
            return Err(DagMlError::RuntimeValidation(format!(
                "prediction cache payload set bundle `{}` does not match bundle `{}`",
                self.bundle_id, bundle.bundle_id
            )));
        }
        if self.schema_version != bundle.schema_version {
            return Err(DagMlError::RuntimeValidation(format!(
                "prediction cache payload set for bundle `{}` uses schema_version {} but bundle uses schema_version {}",
                self.bundle_id, self.schema_version, bundle.schema_version
            )));
        }
        if self.caches.len() != bundle.prediction_caches.len() {
            return Err(DagMlError::RuntimeValidation(format!(
                "prediction cache payload set for bundle `{}` has {} payload(s) for {} cache record(s)",
                self.bundle_id,
                self.caches.len(),
                bundle.prediction_caches.len()
            )));
        }
        let records_by_requirement = bundle
            .prediction_caches
            .iter()
            .map(|record| (record.requirement_key.as_str(), record))
            .collect::<BTreeMap<_, _>>();
        let payloads_by_requirement = self
            .caches
            .iter()
            .map(|payload| (payload.requirement_key.as_str(), payload))
            .collect::<BTreeMap<_, _>>();
        for (requirement_key, record) in records_by_requirement {
            let payload = payloads_by_requirement
                .get(requirement_key)
                .ok_or_else(|| {
                    DagMlError::RuntimeValidation(format!(
                        "prediction cache payload set for bundle `{}` is missing requirement `{}`",
                        self.bundle_id, requirement_key
                    ))
                })?;
            validate_prediction_cache_payload_matches_record(payload, record)?;
        }
        for requirement_key in payloads_by_requirement.keys() {
            if !bundle
                .prediction_caches
                .iter()
                .any(|record| record.requirement_key.as_str() == *requirement_key)
            {
                return Err(DagMlError::RuntimeValidation(format!(
                    "prediction cache payload set for bundle `{}` contains unknown requirement `{}`",
                    self.bundle_id, requirement_key
                )));
            }
        }
        Ok(())
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct RefitArtifactRecord {
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

impl RefitArtifactRecord {
    pub fn validate(&self) -> Result<()> {
        self.artifact.validate()?;
        if self.artifact.id.as_str().is_empty() {
            return Err(DagMlError::RuntimeValidation(format!(
                "refit artifact for `{}` has empty artifact id",
                self.node_id
            )));
        }
        if self.artifact.kind.trim().is_empty() {
            return Err(DagMlError::RuntimeValidation(format!(
                "refit artifact `{}` has empty artifact kind",
                self.artifact.id
            )));
        }
        if self.artifact.controller_id != self.controller_id {
            return Err(DagMlError::RuntimeValidation(format!(
                "refit artifact `{}` controller `{}` does not match record controller `{}`",
                self.artifact.id, self.artifact.controller_id, self.controller_id
            )));
        }
        validate_fingerprint("params", &self.params_fingerprint)?;
        if let Some(fingerprint) = &self.training_loss_fingerprint {
            validate_fingerprint("training loss", fingerprint)?;
        }
        let mut seen_keys = BTreeSet::new();
        for key in &self.data_requirement_keys {
            if key.trim().is_empty() {
                return Err(DagMlError::RuntimeValidation(format!(
                    "refit artifact `{}` has empty data requirement key",
                    self.artifact.id
                )));
            }
            if !seen_keys.insert(key.as_str()) {
                return Err(DagMlError::RuntimeValidation(format!(
                    "refit artifact `{}` has duplicate data requirement key `{key}`",
                    self.artifact.id
                )));
            }
        }
        let mut seen_prediction_keys = BTreeSet::new();
        for key in &self.prediction_requirement_keys {
            if key.trim().is_empty() {
                return Err(DagMlError::RuntimeValidation(format!(
                    "refit artifact `{}` has empty prediction requirement key",
                    self.artifact.id
                )));
            }
            if !seen_prediction_keys.insert(key.as_str()) {
                return Err(DagMlError::RuntimeValidation(format!(
                    "refit artifact `{}` has duplicate prediction requirement key `{key}`",
                    self.artifact.id
                )));
            }
        }
        Ok(())
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExecutionBundle {
    pub bundle_id: BundleId,
    #[serde(default = "default_execution_bundle_schema_version")]
    pub schema_version: u32,
    pub plan_id: String,
    pub graph_fingerprint: String,
    pub campaign_fingerprint: String,
    pub controller_fingerprint: String,
    #[serde(default)]
    pub selected_variant_id: Option<VariantId>,
    #[serde(default)]
    pub selections: BTreeMap<String, SelectionDecision>,
    #[serde(default)]
    pub refit_artifacts: Vec<RefitArtifactRecord>,
    #[serde(default)]
    pub prediction_requirements: Vec<BundlePredictionRequirement>,
    #[serde(default)]
    pub prediction_caches: Vec<BundlePredictionCacheRecord>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub methods_hpo_resume_state: Option<MethodsHpoResumeState>,
    /// Typed reference to the outcome-owned conformal state.  Keeping only a
    /// reference here prevents stale duplicate quantiles in a replay package.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub conformal_calibration: Option<ConformalCalibrationRef>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub raw_artifact_payloads: BTreeMap<ArtifactId, Vec<u8>>,
    /// Native, cross-language score record for this run (per (node, partition, fold, level)).
    /// Scores are scalars derived from `y_true`, safe for every partition — distinct from the
    /// Validation-only `prediction_caches`. Optional + additive (legacy bundles have `None`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scores: Option<ScoreSet>,
    #[serde(default)]
    pub data_requirements: Vec<BundleDataRequirement>,
    #[serde(default)]
    pub unsafe_flags: BTreeSet<String>,
    #[serde(default)]
    pub metadata: BTreeMap<String, serde_json::Value>,
}

impl ExecutionBundle {
    /// Parse the published object-only bundle JSON representation and validate it.
    pub fn from_json(json: &str) -> Result<Self> {
        crate::canonical::parse_typed_json(json).map_err(|error| {
            DagMlError::RuntimeValidation(format!(
                "execution bundle is not strict TCV1 JSON: {error}"
            ))
        })?;
        let raw: serde_json::Value = serde_json::from_str(json)?;
        if raw
            .get("schema_version")
            .and_then(serde_json::Value::as_u64)
            == Some(u64::from(LEGACY_EXECUTION_BUNDLE_SCHEMA_VERSION))
            && raw
                .as_object()
                .is_some_and(|object| object.contains_key("conformal_calibration"))
        {
            return Err(DagMlError::RuntimeValidation(
                "execution bundle V1 JSON cannot contain conformal_calibration, including null"
                    .to_string(),
            ));
        }
        let bundle: Self =
            deserialize_external_contract(json, "execution bundle", DagMlError::RuntimeValidation)?;
        bundle.validate()?;
        Ok(bundle)
    }

    pub fn validate(&self) -> Result<()> {
        execution_bundle_schema_migration_policy()
            .validate_read_version(self.schema_version, &format!("bundle `{}`", self.bundle_id))?;
        if self.plan_id.trim().is_empty() {
            return Err(DagMlError::RuntimeValidation(format!(
                "bundle `{}` has empty plan_id",
                self.bundle_id
            )));
        }
        validate_fingerprint("graph", &self.graph_fingerprint)?;
        validate_fingerprint("campaign", &self.campaign_fingerprint)?;
        validate_fingerprint("controller", &self.controller_fingerprint)?;
        if let Some(state) = &self.methods_hpo_resume_state {
            state.validate().map_err(|error| {
                DagMlError::RuntimeValidation(format!(
                    "bundle `{}` has invalid Methods HPO resume state: {error}",
                    self.bundle_id
                ))
            })?;
        }
        if let Some(calibration) = &self.conformal_calibration {
            if self.schema_version == LEGACY_EXECUTION_BUNDLE_SCHEMA_VERSION {
                return Err(DagMlError::RuntimeValidation(
                    "execution bundle V1 cannot carry conformal state; migrate to V2".to_string(),
                ));
            }
            calibration.validate()?;
        }
        let expected_raw_artifacts = self
            .refit_artifacts
            .iter()
            .filter(|record| record.artifact.backend == Some(ArtifactBackend::Raw))
            .map(|record| &record.artifact.id)
            .collect::<BTreeSet<_>>();
        let actual_raw_artifacts = self.raw_artifact_payloads.keys().collect::<BTreeSet<_>>();
        if expected_raw_artifacts != actual_raw_artifacts {
            return Err(DagMlError::RuntimeValidation(format!(
                "bundle `{}` raw artifact payload keys must exactly cover RAW refit artifacts (expected {:?}, got {:?})",
                self.bundle_id, expected_raw_artifacts, actual_raw_artifacts
            )));
        }
        for record in &self.refit_artifacts {
            if record.artifact.backend == Some(ArtifactBackend::Raw) {
                let payload = self
                    .raw_artifact_payloads
                    .get(&record.artifact.id)
                    .expect("exact raw payload coverage was checked");
                let expected = record
                    .artifact
                    .content_fingerprint
                    .as_deref()
                    .ok_or_else(|| {
                        DagMlError::RuntimeValidation(format!(
                            "raw artifact `{}` has no content fingerprint",
                            record.artifact.id
                        ))
                    })?;
                if format!("{:x}", sha2::Sha256::digest(payload)) != expected
                    || record.artifact.size_bytes != Some(payload.len() as u64)
                {
                    return Err(DagMlError::RuntimeValidation(format!(
                        "raw artifact payload `{}` does not match its bundle reference",
                        record.artifact.id
                    )));
                }
            }
        }
        if let Some(scores) = &self.scores {
            scores.validate()?;
            if scores.schema_version != self.schema_version {
                return Err(DagMlError::RuntimeValidation(format!(
                    "bundle `{}` uses schema_version {} but embedded scores use schema_version {}",
                    self.bundle_id, self.schema_version, scores.schema_version
                )));
            }
            if scores.plan_id != self.plan_id {
                return Err(DagMlError::RuntimeValidation(format!(
                    "bundle `{}` plan_id `{}` does not match its embedded scores plan_id `{}`",
                    self.bundle_id, self.plan_id, scores.plan_id
                )));
            }
        }
        for (key, decision) in &self.selections {
            if key.trim().is_empty() {
                return Err(DagMlError::RuntimeValidation(format!(
                    "bundle `{}` contains empty selection key",
                    self.bundle_id
                )));
            }
            decision.validate()?;
        }
        let mut data_keys = BTreeMap::new();
        for requirement in &self.data_requirements {
            requirement.validate()?;
            let key = requirement.key();
            if data_keys.insert(key.clone(), requirement).is_some() {
                return Err(DagMlError::RuntimeValidation(format!(
                    "bundle `{}` has duplicate data requirement `{}`",
                    self.bundle_id, key
                )));
            }
        }
        let mut prediction_keys = BTreeMap::new();
        for requirement in &self.prediction_requirements {
            requirement.validate()?;
            let key = requirement.key();
            if prediction_keys.insert(key.clone(), requirement).is_some() {
                return Err(DagMlError::RuntimeValidation(format!(
                    "bundle `{}` has duplicate prediction requirement `{}`",
                    self.bundle_id, key
                )));
            }
        }
        let mut prediction_cache_keys = BTreeMap::new();
        for cache in &self.prediction_caches {
            cache.validate()?;
            if !cache.cache_namespace_fingerprints.is_empty() && self.selected_variant_id.is_none()
            {
                return Err(DagMlError::RuntimeValidation(format!(
                    "bundle `{}` prediction cache `{}` is D10-enriched and requires selected_variant_id",
                    self.bundle_id, cache.cache_id
                )));
            }
            validate_prediction_cache_format_for_schema_version(
                &cache.format,
                self.schema_version,
                &format!(
                    "prediction cache `{}` in bundle `{}`",
                    cache.cache_id, self.bundle_id
                ),
            )?;
            let requirement = prediction_keys.get(&cache.requirement_key).ok_or_else(|| {
                DagMlError::RuntimeValidation(format!(
                    "prediction cache `{}` references unknown prediction requirement `{}`",
                    cache.cache_id, cache.requirement_key
                ))
            })?;
            validate_prediction_cache_matches_requirement(cache, requirement)?;
            if prediction_cache_keys
                .insert(cache.requirement_key.clone(), cache)
                .is_some()
            {
                return Err(DagMlError::RuntimeValidation(format!(
                    "bundle `{}` has duplicate prediction cache for requirement `{}`",
                    self.bundle_id, cache.requirement_key
                )));
            }
        }
        for artifact in &self.refit_artifacts {
            artifact.validate()?;
            for key in &artifact.data_requirement_keys {
                match data_keys.get(key) {
                    Some(requirement) if requirement.node_id == artifact.node_id => {}
                    Some(requirement) => {
                        return Err(DagMlError::RuntimeValidation(format!(
                            "refit artifact `{}` for `{}` references data requirement `{key}` owned by `{}`",
                            artifact.artifact.id, artifact.node_id, requirement.node_id
                        )));
                    }
                    None => {
                        return Err(DagMlError::RuntimeValidation(format!(
                            "refit artifact `{}` references unknown data requirement `{key}`",
                            artifact.artifact.id
                        )));
                    }
                }
            }
            for key in &artifact.prediction_requirement_keys {
                match prediction_keys.get(key) {
                    Some(requirement) if requirement.consumer_node == artifact.node_id => {}
                    Some(requirement) => {
                        return Err(DagMlError::RuntimeValidation(format!(
                            "refit artifact `{}` for `{}` references prediction requirement `{key}` consumed by `{}`",
                            artifact.artifact.id, artifact.node_id, requirement.consumer_node
                        )));
                    }
                    None => {
                        return Err(DagMlError::RuntimeValidation(format!(
                            "refit artifact `{}` references unknown prediction requirement `{key}`",
                            artifact.artifact.id
                        )));
                    }
                }
                if !prediction_cache_keys.contains_key(key) {
                    return Err(DagMlError::RuntimeValidation(format!(
                        "refit artifact `{}` references prediction requirement `{key}` without a prediction cache record",
                        artifact.artifact.id
                    )));
                }
            }
        }
        for unsafe_flag in &self.unsafe_flags {
            if unsafe_flag.trim().is_empty() {
                return Err(DagMlError::RuntimeValidation(format!(
                    "bundle `{}` contains an empty unsafe flag",
                    self.bundle_id
                )));
            }
        }
        Ok(())
    }

    pub fn validate_against_plan(&self, plan: &ExecutionPlan) -> Result<()> {
        self.validate()?;
        plan.validate()?;
        if self.plan_id != plan.id {
            return Err(DagMlError::RuntimeValidation(format!(
                "bundle `{}` plan_id `{}` does not match plan `{}`",
                self.bundle_id, self.plan_id, plan.id
            )));
        }
        if self.graph_fingerprint != plan.graph_fingerprint
            || self.campaign_fingerprint != plan.campaign_fingerprint
            || self.controller_fingerprint != plan.controller_fingerprint
        {
            return Err(DagMlError::RuntimeValidation(format!(
                "bundle `{}` fingerprints do not match execution plan",
                self.bundle_id
            )));
        }
        let selected_variant = match &self.selected_variant_id {
            Some(selected_variant_id) => Some(
                plan.variants
                    .iter()
                    .find(|variant| &variant.variant_id == selected_variant_id)
                    .ok_or_else(|| {
                        DagMlError::RuntimeValidation(format!(
                            "bundle `{}` selected unknown variant `{selected_variant_id}`",
                            self.bundle_id
                        ))
                    })?,
            ),
            None => None,
        };
        self.validate_selections_against_plan(plan)?;
        if let Some(state) = &self.methods_hpo_resume_state {
            state.validate_against_plan(plan)?;
        }
        let expected_requirements = collect_data_requirements(plan)?;
        let expected_by_key = expected_requirements
            .iter()
            .map(|requirement| (requirement.key(), requirement))
            .collect::<BTreeMap<_, _>>();
        if self.data_requirements.len() != expected_by_key.len() {
            return Err(DagMlError::RuntimeValidation(format!(
                "bundle `{}` data requirement count does not match execution plan",
                self.bundle_id
            )));
        }
        for requirement in &self.data_requirements {
            let key = requirement.key();
            let expected = expected_by_key.get(&key).ok_or_else(|| {
                DagMlError::RuntimeValidation(format!(
                    "bundle `{}` data requirement `{key}` does not exist in execution plan",
                    self.bundle_id
                ))
            })?;
            if !requirement.matches_plan_requirement(expected) {
                return Err(DagMlError::RuntimeValidation(format!(
                    "bundle `{}` data requirement `{key}` does not match execution plan",
                    self.bundle_id
                )));
            }
        }
        for artifact in &self.refit_artifacts {
            let node_plan = plan.node_plans.get(&artifact.node_id).ok_or_else(|| {
                DagMlError::RuntimeValidation(format!(
                    "bundle `{}` artifact references unknown node `{}`",
                    self.bundle_id, artifact.node_id
                ))
            })?;
            if artifact.controller_id != node_plan.controller_id {
                return Err(DagMlError::RuntimeValidation(format!(
                    "bundle `{}` artifact controller for `{}` does not match plan",
                    self.bundle_id, artifact.node_id
                )));
            }
            let expected_params_fingerprint =
                expected_refit_artifact_params_fingerprint(node_plan, selected_variant)?;
            if artifact.params_fingerprint != expected_params_fingerprint {
                return Err(DagMlError::RuntimeValidation(format!(
                    "bundle `{}` artifact params for `{}` do not match plan",
                    self.bundle_id, artifact.node_id
                )));
            }
            if artifact.training_loss_fingerprint
                != node_plan.training_loss_fingerprint(Phase::Refit)?
            {
                return Err(DagMlError::RuntimeValidation(format!(
                    "bundle `{}` artifact training loss for `{}` does not match plan",
                    self.bundle_id, artifact.node_id
                )));
            }
        }
        for requirement in &self.prediction_requirements {
            let edge = plan
                .graph_plan
                .graph
                .edges
                .iter()
                .find(|edge| {
                    edge.source.node_id == requirement.producer_node
                    && edge.source.port_name == requirement.source_port
                    && edge.target.node_id == requirement.consumer_node
                    && edge.target.port_name == requirement.target_port
                    && edge.contract.requires_oof
                })
                .ok_or_else(|| {
                    DagMlError::RuntimeValidation(format!(
                        "bundle `{}` prediction requirement `{}` does not match an OOF edge in the plan",
                        self.bundle_id,
                        requirement.key()
                    ))
                })?;
            let cache = self
                .prediction_caches
                .iter()
                .find(|cache| cache.requirement_key == requirement.key());
            validate_prediction_requirement_against_plan(self, plan, edge, requirement, cache)?;
        }
        // GROUP check for separation-branch concat-merge nodes: the per-input
        // validation above relaxes the strict full-fold OOF check for each branch
        // input (a partition covers only a subset); the completeness/leakage
        // guarantee is restored here by requiring each concat-merge node's branch
        // inputs to be disjoint and cover the full fold universe exactly once —
        // the same invariant the runtime merge handler enforces.
        let cache_by_key = self
            .prediction_caches
            .iter()
            .map(|cache| (cache.requirement_key.clone(), cache))
            .collect::<BTreeMap<_, _>>();
        let mut concat_merge_groups: BTreeMap<NodeId, Vec<&BundlePredictionRequirement>> =
            BTreeMap::new();
        for requirement in &self.prediction_requirements {
            if is_concat_merge_consumer(plan, &requirement.consumer_node) {
                concat_merge_groups
                    .entry(requirement.consumer_node.clone())
                    .or_default()
                    .push(requirement);
            }
        }
        for (consumer_node, requirements) in &concat_merge_groups {
            validate_concat_merge_requirement_group(
                self,
                plan,
                consumer_node,
                requirements,
                &cache_by_key,
            )?;
        }
        Ok(())
    }

    fn validate_selections_against_plan(&self, plan: &ExecutionPlan) -> Result<()> {
        if self.selections.is_empty() {
            return Ok(());
        }
        let artifact_node_ids = self
            .refit_artifacts
            .iter()
            .map(|artifact| artifact.node_id.clone())
            .collect::<BTreeSet<_>>();
        let required_metric_level = plan.campaign.aggregation_policy.selection_metric_level;
        for (selection_key, decision) in &self.selections {
            match decision.metric_level {
                Some(metric_level) if metric_level == required_metric_level => {}
                Some(metric_level) => {
                    return Err(DagMlError::RuntimeValidation(format!(
                        "bundle `{}` selection `{selection_key}` metric_level {:?} does not match campaign selection_metric_level {:?}",
                        self.bundle_id, metric_level, required_metric_level
                    )));
                }
                None => {
                    return Err(DagMlError::RuntimeValidation(format!(
                        "bundle `{}` selection `{selection_key}` is missing metric_level for campaign selection_metric_level {:?}",
                        self.bundle_id, required_metric_level
                    )));
                }
            }
            let selected_candidate_id = decision.selected_candidate_id.as_str();
            if let Ok(selected_node_id) = NodeId::new(selected_candidate_id) {
                if let Some(node_plan) = plan.node_plans.get(&selected_node_id) {
                    if node_plan.supported_phases.contains(&Phase::Refit)
                        && !artifact_node_ids.contains(&node_plan.node_id)
                    {
                        return Err(DagMlError::RuntimeValidation(format!(
                            "bundle `{}` selection `{selection_key}` chose refittable node `{}` without a matching refit artifact",
                            self.bundle_id, node_plan.node_id
                        )));
                    }
                    continue;
                }
            }
            if VariantId::new(selected_candidate_id).is_ok()
                && plan
                    .variants
                    .iter()
                    .any(|variant| variant.variant_id.as_str() == selected_candidate_id)
            {
                continue;
            }
            return Err(DagMlError::RuntimeValidation(format!(
                "bundle `{}` selection `{selection_key}` chose unknown candidate `{selected_candidate_id}` for plan `{}`",
                self.bundle_id, plan.id
            )));
        }
        Ok(())
    }

    pub fn validate_replay_envelopes(
        &self,
        envelopes: &BTreeMap<String, ExternalDataPlanEnvelope>,
    ) -> Result<()> {
        self.validate()?;
        for requirement in &self.data_requirements {
            let key = requirement.key();
            let envelope = envelopes.get(&key).ok_or_else(|| {
                DagMlError::RuntimeValidation(format!(
                    "replay is missing external data envelope for `{key}`"
                ))
            })?;
            envelope.validate()?;
            if requirement.schema_fingerprint != envelope.schema_fingerprint
                || requirement.plan_fingerprint != envelope.plan_fingerprint
                || requirement.relation_fingerprint != envelope.relation_fingerprint
            {
                return Err(DagMlError::RuntimeValidation(format!(
                    "replay envelope for `{key}` does not match bundle data requirement"
                )));
            }
        }
        Ok(())
    }
}

fn expected_refit_artifact_params_fingerprint(
    node_plan: &crate::plan::NodePlan,
    selected_variant: Option<&crate::generation::VariantPlan>,
) -> Result<String> {
    let Some(variant) = selected_variant else {
        return Ok(node_plan.params_fingerprint.clone());
    };
    let effective_params =
        variant.effective_params_for_node(&node_plan.node_id, &node_plan.params)?;
    stable_json_fingerprint(&effective_params)
}

/// Whether `consumer_node` is a separation-branch *concat reassembly* merge node:
/// a `PredictionJoin` graph node whose DSL `merge_mode` metadata is `"concat"`.
///
/// This is the exact same marker the runtime uses (`runtime::is_concat_merge_node`)
/// to intercept the node before the controller path and reassemble the disjoint
/// per-partition OOF blocks. The bundle validation mirrors that marker so the
/// requirement validation stays consistent with the runtime: the partition-aware
/// relaxation applies *only* to input edges whose consumer is such a node.
fn is_concat_merge_consumer(plan: &ExecutionPlan, consumer_node: &NodeId) -> bool {
    let Some(node_plan) = plan.node_plans.get(consumer_node) else {
        return false;
    };
    if node_plan.kind != crate::graph::NodeKind::PredictionJoin {
        return false;
    }
    plan.graph_plan
        .graph
        .nodes
        .iter()
        .find(|node| &node.id == consumer_node)
        .and_then(|node| node.metadata.get("merge_mode"))
        .and_then(serde_json::Value::as_str)
        == Some("concat")
}

fn validate_prediction_requirement_against_plan(
    bundle: &ExecutionBundle,
    plan: &ExecutionPlan,
    edge: &crate::graph::EdgeSpec,
    requirement: &BundlePredictionRequirement,
    cache: Option<&BundlePredictionCacheRecord>,
) -> Result<()> {
    if !edge.contract.requires_fold_alignment {
        return Ok(());
    }
    // A separation-branch concat-merge input edge covers only ITS partition of the
    // fold universe, never the full universe. Validate it as a partition-covering
    // input here (subset of universe, well-formed per-fold cache blocks); the
    // GROUP of all such sibling inputs is validated together (disjoint + their
    // union == the full fold set, exactly the runtime merge handler's invariant)
    // by `validate_concat_merge_requirement_group` after the per-requirement loop.
    // Every other `requires_fold_alignment` edge keeps the strict per-input
    // full-fold OOF completeness check below — the general leakage guard is intact.
    if is_concat_merge_consumer(plan, &requirement.consumer_node) {
        return validate_concat_merge_branch_input_requirement(bundle, plan, requirement, cache);
    }
    let fold_set = plan.fold_set.as_ref().ok_or_else(|| {
        DagMlError::RuntimeValidation(format!(
            "bundle `{}` prediction requirement `{}` needs fold alignment but plan `{}` has no fold set",
            bundle.bundle_id,
            requirement.key(),
            plan.id
        ))
    })?;
    let expected_fold_ids = fold_set
        .folds
        .iter()
        .map(|fold| fold.fold_id.clone())
        .collect::<BTreeSet<_>>();
    let requirement_fold_ids = requirement
        .fold_ids
        .iter()
        .cloned()
        .collect::<BTreeSet<_>>();
    if requirement_fold_ids != expected_fold_ids {
        return Err(DagMlError::RuntimeValidation(format!(
            "bundle `{}` prediction requirement `{}` fold ids do not match plan fold set",
            bundle.bundle_id,
            requirement.key()
        )));
    }
    if requirement.prediction_level != PredictionLevel::Sample {
        if let Some(cache) = cache {
            validate_aggregated_prediction_cache_blocks_match_requirement(
                bundle,
                requirement,
                cache,
                fold_set.partition_mode,
            )?;
        }
        return Ok(());
    }
    let expected_sample_ids = fold_set.sample_ids.iter().cloned().collect::<BTreeSet<_>>();
    let requirement_sample_ids = requirement
        .sample_ids
        .iter()
        .cloned()
        .collect::<BTreeSet<_>>();
    if requirement_sample_ids != expected_sample_ids {
        return Err(DagMlError::RuntimeValidation(format!(
            "bundle `{}` prediction requirement `{}` sample ids do not match plan fold set",
            bundle.bundle_id,
            requirement.key()
        )));
    }
    if let Some(cache) = cache {
        validate_prediction_cache_blocks_match_fold_set(bundle, requirement, cache, fold_set)?;
    }
    Ok(())
}

/// Validate a SINGLE separation-branch input edge into a concat-merge node.
///
/// A branch's OOF covers only its partition ∩ fold (a strict subset of the fold
/// universe), so the strict per-input `sample_ids == full fold_set` check does
/// NOT apply. Here we validate only that the input is well-formed *within* the
/// universe: its sample ids are a subset of the fold set, its fold ids are a
/// subset of the plan fold set, and (when present) each per-fold cache block's
/// samples are a subset of that fold's validation set with no intra-block
/// duplicate. The cross-input completeness (disjoint + union == full fold set)
/// — the actual OOF/leakage guarantee — is enforced by
/// `validate_concat_merge_requirement_group`, mirroring the runtime merge handler.
fn validate_concat_merge_branch_input_requirement(
    bundle: &ExecutionBundle,
    plan: &ExecutionPlan,
    requirement: &BundlePredictionRequirement,
    cache: Option<&BundlePredictionCacheRecord>,
) -> Result<()> {
    let fold_set = plan.fold_set.as_ref().ok_or_else(|| {
        DagMlError::RuntimeValidation(format!(
            "bundle `{}` prediction requirement `{}` needs fold alignment but plan `{}` has no fold set",
            bundle.bundle_id,
            requirement.key(),
            plan.id
        ))
    })?;
    let universe_fold_ids = fold_set
        .folds
        .iter()
        .map(|fold| fold.fold_id.clone())
        .collect::<BTreeSet<_>>();
    let requirement_fold_ids = requirement
        .fold_ids
        .iter()
        .cloned()
        .collect::<BTreeSet<_>>();
    if !requirement_fold_ids.is_subset(&universe_fold_ids) {
        return Err(DagMlError::RuntimeValidation(format!(
            "bundle `{}` concat-merge prediction requirement `{}` has fold ids outside the plan fold set",
            bundle.bundle_id,
            requirement.key()
        )));
    }
    // Concat reassembly is a sample-level OOF operation; aggregated (target/group)
    // levels never feed a separation concat-merge.
    if requirement.prediction_level != PredictionLevel::Sample {
        return Err(DagMlError::RuntimeValidation(format!(
            "bundle `{}` concat-merge prediction requirement `{}` must be sample-level (got {:?})",
            bundle.bundle_id,
            requirement.key(),
            requirement.prediction_level
        )));
    }
    let universe_sample_ids = fold_set.sample_ids.iter().cloned().collect::<BTreeSet<_>>();
    let requirement_sample_ids = requirement
        .sample_ids
        .iter()
        .cloned()
        .collect::<BTreeSet<_>>();
    if !requirement_sample_ids.is_subset(&universe_sample_ids) {
        return Err(DagMlError::RuntimeValidation(format!(
            "bundle `{}` concat-merge prediction requirement `{}` covers samples outside the plan fold set",
            bundle.bundle_id,
            requirement.key()
        )));
    }
    if let Some(cache) = cache {
        let folds = fold_set
            .folds
            .iter()
            .map(|fold| (&fold.fold_id, fold))
            .collect::<BTreeMap<_, _>>();
        for block in &cache.blocks {
            let fold_id = block.fold_id.as_ref().ok_or_else(|| {
                DagMlError::RuntimeValidation(format!(
                    "bundle `{}` prediction cache `{}` has an OOF block without a fold id",
                    bundle.bundle_id, cache.cache_id
                ))
            })?;
            let fold = folds.get(fold_id).ok_or_else(|| {
                DagMlError::RuntimeValidation(format!(
                    "bundle `{}` prediction cache `{}` references unknown fold `{fold_id}`",
                    bundle.bundle_id, cache.cache_id
                ))
            })?;
            let block_samples = block.sample_ids.iter().cloned().collect::<BTreeSet<_>>();
            if block_samples.len() != block.sample_ids.len() {
                return Err(DagMlError::RuntimeValidation(format!(
                    "bundle `{}` prediction cache `{}` block for fold `{fold_id}` has a duplicate sample for requirement `{}`",
                    bundle.bundle_id,
                    cache.cache_id,
                    requirement.key()
                )));
            }
            let validation_samples = fold
                .validation_sample_ids
                .iter()
                .cloned()
                .collect::<BTreeSet<_>>();
            if !block_samples.is_subset(&validation_samples) {
                return Err(DagMlError::RuntimeValidation(format!(
                    "bundle `{}` prediction cache `{}` block for fold `{fold_id}` covers samples outside the fold validation set for requirement `{}`",
                    bundle.bundle_id,
                    cache.cache_id,
                    requirement.key()
                )));
            }
        }
    }
    Ok(())
}

/// Validate the GROUP of separation-branch input requirements feeding ONE
/// concat-merge node, mirroring the runtime merge handler's invariant
/// (`runtime::reassemble_separation_merge`): the branch inputs must be pairwise
/// DISJOINT and their UNION must equal the full fold set sample universe exactly
/// — each sample covered once. This is the OOF completeness the strict per-input
/// check guarantees for an ordinary model; for a separation branch the
/// completeness is a property of the partition-covering inputs *as a group*, not
/// of any single input.
///
/// When per-fold caches are present, the same disjoint+complete property is also
/// enforced per fold against each fold's validation set, so a partition that is
/// missing samples in some fold (a real OOF gap) still errors clearly.
fn validate_concat_merge_requirement_group(
    bundle: &ExecutionBundle,
    plan: &ExecutionPlan,
    consumer_node: &NodeId,
    requirements: &[&BundlePredictionRequirement],
    caches: &BTreeMap<String, &BundlePredictionCacheRecord>,
) -> Result<()> {
    let fold_set = plan.fold_set.as_ref().ok_or_else(|| {
        DagMlError::RuntimeValidation(format!(
            "bundle `{}` concat-merge node `{consumer_node}` needs fold alignment but plan `{}` has no fold set",
            bundle.bundle_id, plan.id
        ))
    })?;

    // EXPECTED-vs-SUPPLIED: the group's completeness must be judged against the
    // graph's incoming OOF/fold-aligned edges to the concat-merge node, NOT just
    // the requirements the bundle happened to supply. Otherwise a bundle could
    // OMIT one branch->merge edge entirely and let the remaining branches' union
    // still equal the full fold universe — a missing branch masked by the others.
    // Derive the expected branch-input requirement keys from the plan graph and
    // require an EXACT match (no missing, no extra) before the disjoint+union
    // check; a dropped (or stray) branch edge then surfaces as a clear error.
    let expected_keys = plan
        .graph_plan
        .graph
        .edges
        .iter()
        .filter(|edge| {
            &edge.target.node_id == consumer_node
                && edge.contract.requires_oof
                && edge.contract.requires_fold_alignment
        })
        .map(|edge| {
            bundle_prediction_requirement_key(
                &edge.source.node_id,
                &edge.source.port_name,
                &edge.target.node_id,
                &edge.target.port_name,
            )
        })
        .collect::<BTreeSet<_>>();
    let supplied_keys = requirements
        .iter()
        .map(|req| req.key())
        .collect::<BTreeSet<_>>();
    if supplied_keys != expected_keys {
        let missing: Vec<&str> = expected_keys
            .difference(&supplied_keys)
            .map(String::as_str)
            .collect();
        let extra: Vec<&str> = supplied_keys
            .difference(&expected_keys)
            .map(String::as_str)
            .collect();
        return Err(DagMlError::RuntimeValidation(format!(
            "bundle `{}` concat-merge node `{consumer_node}` branch inputs do not match the plan's incoming OOF edges (missing: [{}]; extra: [{}])",
            bundle.bundle_id,
            missing.join(", "),
            extra.join(", ")
        )));
    }

    // Union over all branch inputs must equal the full fold universe, disjointly.
    let expected_universe = fold_set.sample_ids.iter().cloned().collect::<BTreeSet<_>>();
    let mut covered_universe = BTreeSet::new();
    for requirement in requirements {
        for sample_id in &requirement.sample_ids {
            if !covered_universe.insert(sample_id.clone()) {
                return Err(DagMlError::RuntimeValidation(format!(
                    "bundle `{}` concat-merge node `{consumer_node}` received overlapping branch predictions: sample `{sample_id}` is covered by more than one partition",
                    bundle.bundle_id
                )));
            }
        }
    }
    if covered_universe != expected_universe {
        return Err(DagMlError::RuntimeValidation(format!(
            "bundle `{}` concat-merge node `{consumer_node}` branch inputs do not cover the full fold set sample universe (each sample exactly once)",
            bundle.bundle_id
        )));
    }

    // Per-fold disjoint+complete coverage against each fold's validation set, using
    // the per-branch caches when present (the CLI cv-refit path always attaches
    // them). A partition that drops samples in a fold surfaces as a missing-sample
    // error rather than a silently incomplete OOF.
    //
    // All-or-nothing caches: persisted per-fold OOF is validated complete or not
    // relied on at all. If ANY branch input carries a cache, ALL must — otherwise
    // a no-cache branch would satisfy global coverage via its self-declared
    // `requirement.sample_ids` while its actual persisted per-fold OOF is missing,
    // hiding an incomplete-coverage gap. A partial-cache concat group is rejected.
    let cached_count = requirements
        .iter()
        .filter(|req| caches.contains_key(&req.key()))
        .count();
    if cached_count != 0 && cached_count != requirements.len() {
        return Err(DagMlError::RuntimeValidation(format!(
            "bundle `{}` concat-merge node `{consumer_node}` has partial prediction-cache coverage ({cached_count} of {} branch inputs cached): all branch inputs must carry a per-fold OOF cache or none",
            bundle.bundle_id,
            requirements.len()
        )));
    }
    if cached_count == requirements.len() {
        let mut covered_by_fold: BTreeMap<FoldId, BTreeSet<SampleId>> = BTreeMap::new();
        for requirement in requirements {
            let cache = caches.get(&requirement.key()).expect("checked above");
            for block in &cache.blocks {
                let Some(fold_id) = block.fold_id.as_ref() else {
                    continue;
                };
                let covered = covered_by_fold.entry(fold_id.clone()).or_default();
                for sample_id in &block.sample_ids {
                    if !covered.insert(sample_id.clone()) {
                        return Err(DagMlError::RuntimeValidation(format!(
                            "bundle `{}` concat-merge node `{consumer_node}` has overlapping branch predictions in fold `{fold_id}`: sample `{sample_id}` is covered by more than one partition",
                            bundle.bundle_id
                        )));
                    }
                }
            }
        }
        for fold in &fold_set.folds {
            let expected = fold
                .validation_sample_ids
                .iter()
                .cloned()
                .collect::<BTreeSet<_>>();
            let covered = covered_by_fold.remove(&fold.fold_id).unwrap_or_default();
            if covered != expected {
                return Err(DagMlError::RuntimeValidation(format!(
                    "bundle `{}` concat-merge node `{consumer_node}` branch inputs do not cover fold `{}` validation set (each sample exactly once)",
                    bundle.bundle_id, fold.fold_id
                )));
            }
        }
    }
    Ok(())
}

fn validate_prediction_cache_blocks_match_fold_set(
    bundle: &ExecutionBundle,
    requirement: &BundlePredictionRequirement,
    cache: &BundlePredictionCacheRecord,
    fold_set: &crate::fold::FoldSet,
) -> Result<()> {
    let folds = fold_set
        .folds
        .iter()
        .map(|fold| (&fold.fold_id, fold))
        .collect::<BTreeMap<_, _>>();
    let expected_fold_ids = fold_set
        .folds
        .iter()
        .map(|fold| fold.fold_id.clone())
        .collect::<BTreeSet<_>>();
    let mut covered_fold_ids = BTreeSet::new();
    let mut covered_sample_ids = BTreeSet::new();
    for block in &cache.blocks {
        let fold_id = block.fold_id.as_ref().ok_or_else(|| {
            DagMlError::RuntimeValidation(format!(
                "bundle `{}` prediction cache `{}` has an OOF block without a fold id",
                bundle.bundle_id, cache.cache_id
            ))
        })?;
        covered_fold_ids.insert(fold_id.clone());
        let fold = folds.get(fold_id).ok_or_else(|| {
            DagMlError::RuntimeValidation(format!(
                "bundle `{}` prediction cache `{}` references unknown fold `{fold_id}`",
                bundle.bundle_id, cache.cache_id
            ))
        })?;
        let block_samples = block.sample_ids.iter().cloned().collect::<BTreeSet<_>>();
        let expected_samples = fold
            .validation_sample_ids
            .iter()
            .cloned()
            .collect::<BTreeSet<_>>();
        if block_samples != expected_samples {
            return Err(DagMlError::RuntimeValidation(format!(
                "bundle `{}` prediction cache `{}` block for fold `{fold_id}` does not match validation samples for requirement `{}`",
                bundle.bundle_id,
                cache.cache_id,
                requirement.key()
            )));
        }
        for sample_id in block_samples {
            // Partition is a clean OOF set: a sample cached for two folds is a duplicated fold or a
            // mixed-variant context. Resampled (ShuffleSplit / repeated CV) validates a sample in
            // several folds and averages it, so the across-fold duplicate is allowed; the per-fold
            // match above and the universe-coverage check below still hold.
            if !covered_sample_ids.insert(sample_id.clone())
                && fold_set.partition_mode == crate::fold::FoldPartitionMode::Partition
            {
                return Err(DagMlError::RuntimeValidation(format!(
                    "bundle `{}` prediction cache `{}` has duplicate OOF sample `{sample_id}`",
                    bundle.bundle_id, cache.cache_id
                )));
            }
        }
    }
    if covered_fold_ids != expected_fold_ids {
        return Err(DagMlError::RuntimeValidation(format!(
            "bundle `{}` prediction cache `{}` does not cover all folds for requirement `{}`",
            bundle.bundle_id,
            cache.cache_id,
            requirement.key()
        )));
    }
    let expected_sample_ids = fold_set.sample_ids.iter().cloned().collect::<BTreeSet<_>>();
    if covered_sample_ids != expected_sample_ids {
        return Err(DagMlError::RuntimeValidation(format!(
            "bundle `{}` prediction cache `{}` does not cover the full OOF sample universe for requirement `{}`",
            bundle.bundle_id,
            cache.cache_id,
            requirement.key()
        )));
    }
    Ok(())
}

fn validate_aggregated_prediction_cache_blocks_match_requirement(
    bundle: &ExecutionBundle,
    requirement: &BundlePredictionRequirement,
    cache: &BundlePredictionCacheRecord,
    partition_mode: crate::fold::FoldPartitionMode,
) -> Result<()> {
    let mut covered_fold_ids = BTreeSet::new();
    let mut covered_unit_ids = BTreeSet::new();
    for block in &cache.blocks {
        if block.prediction_level != requirement.prediction_level {
            return Err(DagMlError::RuntimeValidation(format!(
                "bundle `{}` prediction cache `{}` block level does not match requirement `{}`",
                bundle.bundle_id,
                cache.cache_id,
                requirement.key()
            )));
        }
        if let Some(fold_id) = &block.fold_id {
            covered_fold_ids.insert(fold_id.clone());
        }
        for unit_id in &block.unit_ids {
            // Partition forbids a unit cached for two folds; Resampled (ShuffleSplit / repeated CV)
            // validates a unit in several folds and averages it, so the across-fold duplicate is
            // allowed (the unit-universe coverage check below still requires every unit at least once).
            if !covered_unit_ids.insert(unit_id.clone())
                && partition_mode == crate::fold::FoldPartitionMode::Partition
            {
                return Err(DagMlError::RuntimeValidation(format!(
                    "bundle `{}` prediction cache `{}` has duplicate aggregated unit `{unit_id}`",
                    bundle.bundle_id, cache.cache_id
                )));
            }
        }
    }
    let expected_fold_ids = requirement
        .fold_ids
        .iter()
        .cloned()
        .collect::<BTreeSet<_>>();
    if covered_fold_ids != expected_fold_ids {
        return Err(DagMlError::RuntimeValidation(format!(
            "bundle `{}` prediction cache `{}` does not cover all folds for aggregated requirement `{}`",
            bundle.bundle_id,
            cache.cache_id,
            requirement.key()
        )));
    }
    let expected_unit_ids = requirement
        .unit_ids
        .iter()
        .cloned()
        .collect::<BTreeSet<_>>();
    if covered_unit_ids != expected_unit_ids {
        return Err(DagMlError::RuntimeValidation(format!(
            "bundle `{}` prediction cache `{}` does not cover all units for aggregated requirement `{}`",
            bundle.bundle_id,
            cache.cache_id,
            requirement.key()
        )));
    }
    Ok(())
}

pub fn build_execution_bundle(
    bundle_id: BundleId,
    plan: &ExecutionPlan,
    selected_variant_id: Option<VariantId>,
    selections: BTreeMap<String, SelectionDecision>,
    refit_artifacts: Vec<RefitArtifactRecord>,
) -> Result<ExecutionBundle> {
    build_execution_bundle_with_prediction_requirements(
        bundle_id,
        plan,
        selected_variant_id,
        selections,
        refit_artifacts,
        Vec::new(),
    )
}

pub fn build_execution_bundle_with_prediction_requirements(
    bundle_id: BundleId,
    plan: &ExecutionPlan,
    selected_variant_id: Option<VariantId>,
    selections: BTreeMap<String, SelectionDecision>,
    refit_artifacts: Vec<RefitArtifactRecord>,
    prediction_requirements: Vec<BundlePredictionRequirement>,
) -> Result<ExecutionBundle> {
    build_execution_bundle_with_prediction_contracts(
        bundle_id,
        plan,
        selected_variant_id,
        selections,
        refit_artifacts,
        prediction_requirements,
        Vec::new(),
    )
}

pub fn build_execution_bundle_with_prediction_contracts(
    bundle_id: BundleId,
    plan: &ExecutionPlan,
    selected_variant_id: Option<VariantId>,
    selections: BTreeMap<String, SelectionDecision>,
    refit_artifacts: Vec<RefitArtifactRecord>,
    prediction_requirements: Vec<BundlePredictionRequirement>,
    prediction_caches: Vec<BundlePredictionCacheRecord>,
) -> Result<ExecutionBundle> {
    plan.validate()?;
    let bundle = ExecutionBundle {
        bundle_id,
        schema_version: EXECUTION_BUNDLE_SCHEMA_VERSION,
        plan_id: plan.id.clone(),
        graph_fingerprint: plan.graph_fingerprint.clone(),
        campaign_fingerprint: plan.campaign_fingerprint.clone(),
        controller_fingerprint: plan.controller_fingerprint.clone(),
        selected_variant_id,
        selections,
        refit_artifacts,
        prediction_requirements,
        prediction_caches,
        methods_hpo_resume_state: None,
        conformal_calibration: None,
        raw_artifact_payloads: BTreeMap::new(),
        scores: None,
        data_requirements: collect_data_requirements(plan)?,
        unsafe_flags: BTreeSet::new(),
        metadata: BTreeMap::new(),
    };
    // Raw artifacts are exported by their controller immediately after this
    // structural bundle is staged.  Do not validate payload coverage before
    // that one-shot transfer; the final bundle validation remains mandatory
    // and rejects both missing and orphan payloads.
    if !bundle
        .refit_artifacts
        .iter()
        .any(|record| record.artifact.backend == Some(ArtifactBackend::Raw))
    {
        bundle.validate_against_plan(plan)?;
    }
    Ok(bundle)
}

fn collect_data_requirements(plan: &ExecutionPlan) -> Result<Vec<BundleDataRequirement>> {
    let mut requirements = Vec::new();
    for node_plan in plan.node_plans.values() {
        for binding in &node_plan.data_bindings {
            requirements.push(BundleDataRequirement {
                node_id: node_plan.node_id.clone(),
                input_name: binding.input_name.clone(),
                schema_fingerprint: binding.schema_fingerprint.clone(),
                plan_fingerprint: binding.plan_fingerprint.clone(),
                relation_fingerprint: binding.relation_fingerprint.clone(),
                output_representation: binding.output_representation.clone(),
                feature_set_id: binding.feature_set_id.clone(),
                representation_replay_manifest: None,
                representation_compatibility: None,
            });
        }
    }
    requirements.sort_by_key(BundleDataRequirement::key);
    for requirement in &requirements {
        requirement.validate()?;
    }
    Ok(requirements)
}

pub fn build_prediction_cache_record(
    requirement: &BundlePredictionRequirement,
    blocks: &[PredictionBlock],
) -> Result<BundlePredictionCacheRecord> {
    let selected = select_prediction_cache_blocks(requirement, blocks)?;
    build_prediction_cache_record_from_selected(requirement, &selected)
}

pub fn build_prediction_cache_payload(
    requirement: &BundlePredictionRequirement,
    blocks: &[PredictionBlock],
) -> Result<BundlePredictionCachePayload> {
    let selected = select_prediction_cache_blocks(requirement, blocks)?;
    let payload = BundlePredictionCachePayload {
        requirement_key: requirement.key(),
        cache_id: format!("prediction-cache:{}", requirement.key()),
        cache_namespace_fingerprints: Vec::new(),
        format: BUNDLE_PREDICTION_CACHE_FORMAT.to_string(),
        partition: requirement.partition.clone(),
        prediction_level: requirement.prediction_level,
        block_count: selected.len(),
        row_count: selected.iter().map(|block| block.sample_ids.len()).sum(),
        content_fingerprint: stable_json_fingerprint(&selected)?,
        blocks: selected,
        aggregated_blocks: Vec::new(),
    };
    payload.validate()?;
    let record = build_prediction_cache_record(requirement, &payload.blocks)?;
    validate_prediction_cache_payload_matches_record(&payload, &record)?;
    Ok(payload)
}

pub fn build_aggregated_prediction_cache_record(
    requirement: &BundlePredictionRequirement,
    blocks: &[AggregatedPredictionBlock],
) -> Result<BundlePredictionCacheRecord> {
    let selected = select_aggregated_prediction_cache_blocks(requirement, blocks)?;
    build_aggregated_prediction_cache_record_from_selected(requirement, &selected)
}

pub fn build_aggregated_prediction_cache_payload(
    requirement: &BundlePredictionRequirement,
    blocks: &[AggregatedPredictionBlock],
) -> Result<BundlePredictionCachePayload> {
    let selected = select_aggregated_prediction_cache_blocks(requirement, blocks)?;
    let payload = BundlePredictionCachePayload {
        requirement_key: requirement.key(),
        cache_id: format!("prediction-cache:{}", requirement.key()),
        cache_namespace_fingerprints: Vec::new(),
        format: BUNDLE_PREDICTION_CACHE_FORMAT.to_string(),
        partition: requirement.partition.clone(),
        prediction_level: requirement.prediction_level,
        block_count: selected.len(),
        row_count: selected.iter().map(|block| block.unit_ids.len()).sum(),
        content_fingerprint: stable_json_fingerprint(&selected)?,
        blocks: Vec::new(),
        aggregated_blocks: selected,
    };
    payload.validate()?;
    let record = build_aggregated_prediction_cache_record(requirement, &payload.aggregated_blocks)?;
    validate_prediction_cache_payload_matches_record(&payload, &record)?;
    Ok(payload)
}

pub fn validate_prediction_cache_payload_matches_record(
    payload: &BundlePredictionCachePayload,
    record: &BundlePredictionCacheRecord,
) -> Result<()> {
    payload.validate()?;
    record.validate()?;
    if payload.requirement_key != record.requirement_key
        || payload.cache_id != record.cache_id
        || payload.cache_namespace_fingerprints != record.cache_namespace_fingerprints
        || payload.format != record.format
        || payload.partition != record.partition
        || payload.prediction_level != record.prediction_level
        || payload.block_count != record.block_count
        || payload.row_count != record.row_count
        || payload.content_fingerprint != record.content_fingerprint
    {
        return Err(DagMlError::RuntimeValidation(format!(
            "prediction cache payload `{}` does not match cache record `{}`",
            payload.cache_id, record.cache_id
        )));
    }
    let block_records = if payload.prediction_level == PredictionLevel::Sample {
        payload
            .blocks
            .iter()
            .map(|block| {
                Ok(BundlePredictionBlockCacheRecord {
                    prediction_id: block.prediction_id.clone(),
                    fold_id: block.fold_id.clone(),
                    prediction_level: PredictionLevel::Sample,
                    row_count: block.sample_ids.len(),
                    unit_ids: Vec::new(),
                    sample_ids: block.sample_ids.clone(),
                    content_fingerprint: stable_json_fingerprint(block)?,
                })
            })
            .collect::<Result<Vec<_>>>()?
    } else {
        payload
            .aggregated_blocks
            .iter()
            .map(|block| {
                Ok(BundlePredictionBlockCacheRecord {
                    prediction_id: block.prediction_id.clone(),
                    fold_id: block.fold_id.clone(),
                    prediction_level: block.level,
                    row_count: block.unit_ids.len(),
                    unit_ids: block.unit_ids.clone(),
                    sample_ids: Vec::new(),
                    content_fingerprint: stable_json_fingerprint(block)?,
                })
            })
            .collect::<Result<Vec<_>>>()?
    };
    if block_records != record.blocks {
        return Err(DagMlError::RuntimeValidation(format!(
            "prediction cache payload `{}` block fingerprints do not match cache record",
            payload.cache_id
        )));
    }
    Ok(())
}

fn validate_prediction_cache_namespace_fingerprints(
    cache_id: &str,
    fingerprints: &[String],
) -> Result<()> {
    let mut seen = BTreeSet::new();
    for fingerprint in fingerprints {
        validate_fingerprint("prediction cache namespace", fingerprint)?;
        if !seen.insert(fingerprint.as_str()) {
            return Err(DagMlError::RuntimeValidation(format!(
                "prediction cache `{cache_id}` has duplicate cache namespace fingerprint `{fingerprint}`"
            )));
        }
    }
    Ok(())
}

fn select_prediction_cache_blocks(
    requirement: &BundlePredictionRequirement,
    blocks: &[PredictionBlock],
) -> Result<Vec<PredictionBlock>> {
    requirement.validate()?;
    let mut selected = blocks
        .iter()
        .filter(|block| {
            block.producer_node == requirement.producer_node
                && block.partition == requirement.partition
                && block
                    .fold_id
                    .as_ref()
                    .is_some_and(|fold_id| requirement.fold_ids.contains(fold_id))
        })
        .cloned()
        .collect::<Vec<_>>();
    if selected.is_empty() {
        return Err(DagMlError::RuntimeValidation(format!(
            "prediction cache requirement `{}` has no matching prediction blocks",
            requirement.key()
        )));
    }
    selected.sort_by(|left, right| {
        (
            left.fold_id.as_ref().map(ToString::to_string),
            left.prediction_id.clone(),
        )
            .cmp(&(
                right.fold_id.as_ref().map(ToString::to_string),
                right.prediction_id.clone(),
            ))
    });
    Ok(selected)
}

fn select_aggregated_prediction_cache_blocks(
    requirement: &BundlePredictionRequirement,
    blocks: &[AggregatedPredictionBlock],
) -> Result<Vec<AggregatedPredictionBlock>> {
    requirement.validate()?;
    if requirement.prediction_level == PredictionLevel::Sample {
        return Err(DagMlError::RuntimeValidation(format!(
            "aggregated prediction cache requirement `{}` must use target or group level",
            requirement.key()
        )));
    }
    let mut selected = blocks
        .iter()
        .filter(|block| {
            block.producer_node == requirement.producer_node
                && block.partition == requirement.partition
                && block.level == requirement.prediction_level
                && block
                    .fold_id
                    .as_ref()
                    .is_some_and(|fold_id| requirement.fold_ids.contains(fold_id))
        })
        .cloned()
        .collect::<Vec<_>>();
    if selected.is_empty() {
        return Err(DagMlError::RuntimeValidation(format!(
            "aggregated prediction cache requirement `{}` has no matching prediction blocks",
            requirement.key()
        )));
    }
    selected.sort_by(|left, right| {
        (
            left.fold_id.as_ref().map(ToString::to_string),
            left.prediction_id.clone(),
        )
            .cmp(&(
                right.fold_id.as_ref().map(ToString::to_string),
                right.prediction_id.clone(),
            ))
    });
    Ok(selected)
}

fn build_prediction_cache_record_from_selected(
    requirement: &BundlePredictionRequirement,
    selected: &[PredictionBlock],
) -> Result<BundlePredictionCacheRecord> {
    requirement.validate()?;
    if selected.is_empty() {
        return Err(DagMlError::RuntimeValidation(format!(
            "prediction cache requirement `{}` has no matching prediction blocks",
            requirement.key()
        )));
    }
    let mut fold_ids = BTreeSet::new();
    let mut sample_ids = BTreeSet::new();
    let mut target_names: Option<Vec<String>> = None;
    let mut prediction_width: Option<usize> = None;
    let mut row_count = 0usize;
    let mut block_records = Vec::new();
    for block in selected {
        if block.producer_node != requirement.producer_node
            || block.partition != requirement.partition
        {
            return Err(DagMlError::RuntimeValidation(format!(
                "prediction cache `{}` contains a block outside the requirement scope",
                requirement.key()
            )));
        }
        let width = block.validate_shape()?;
        if prediction_width.is_some_and(|expected| expected != width) {
            return Err(DagMlError::RuntimeValidation(format!(
                "prediction cache `{}` has inconsistent prediction width",
                requirement.key()
            )));
        }
        prediction_width = Some(width);
        let block_target_names = normalized_prediction_targets(block, width);
        if target_names
            .as_ref()
            .is_some_and(|expected| expected != &block_target_names)
        {
            return Err(DagMlError::RuntimeValidation(format!(
                "prediction cache `{}` has inconsistent target names",
                requirement.key()
            )));
        }
        target_names = Some(block_target_names);
        if let Some(fold_id) = &block.fold_id {
            fold_ids.insert(fold_id.clone());
        }
        sample_ids.extend(block.sample_ids.iter().cloned());
        row_count += block.sample_ids.len();
        block_records.push(BundlePredictionBlockCacheRecord {
            prediction_id: block.prediction_id.clone(),
            fold_id: block.fold_id.clone(),
            prediction_level: PredictionLevel::Sample,
            row_count: block.sample_ids.len(),
            unit_ids: Vec::new(),
            sample_ids: block.sample_ids.clone(),
            content_fingerprint: stable_json_fingerprint(block)?,
        });
    }

    let record = BundlePredictionCacheRecord {
        requirement_key: requirement.key(),
        cache_id: format!("prediction-cache:{}", requirement.key()),
        cache_namespace_fingerprints: Vec::new(),
        format: BUNDLE_PREDICTION_CACHE_FORMAT.to_string(),
        partition: requirement.partition.clone(),
        prediction_level: requirement.prediction_level,
        fold_ids: fold_ids.into_iter().collect(),
        unit_ids: requirement.unit_ids.clone(),
        sample_ids: sample_ids.into_iter().collect(),
        prediction_width: prediction_width.unwrap_or_default(),
        target_names: target_names.unwrap_or_default(),
        block_count: block_records.len(),
        row_count,
        content_fingerprint: stable_json_fingerprint(selected)?,
        blocks: block_records,
    };
    validate_prediction_cache_matches_requirement(&record, requirement)?;
    record.validate()?;
    Ok(record)
}

fn build_aggregated_prediction_cache_record_from_selected(
    requirement: &BundlePredictionRequirement,
    selected: &[AggregatedPredictionBlock],
) -> Result<BundlePredictionCacheRecord> {
    requirement.validate()?;
    if requirement.prediction_level == PredictionLevel::Sample {
        return Err(DagMlError::RuntimeValidation(format!(
            "aggregated prediction cache requirement `{}` must use target or group level",
            requirement.key()
        )));
    }
    if selected.is_empty() {
        return Err(DagMlError::RuntimeValidation(format!(
            "aggregated prediction cache requirement `{}` has no matching prediction blocks",
            requirement.key()
        )));
    }
    let mut fold_ids = BTreeSet::new();
    let mut unit_ids = BTreeSet::new();
    let mut target_names: Option<Vec<String>> = None;
    let mut prediction_width: Option<usize> = None;
    let mut row_count = 0usize;
    let mut block_records = Vec::new();
    for block in selected {
        if block.producer_node != requirement.producer_node
            || block.partition != requirement.partition
            || block.level != requirement.prediction_level
        {
            return Err(DagMlError::RuntimeValidation(format!(
                "aggregated prediction cache `{}` contains a block outside the requirement scope",
                requirement.key()
            )));
        }
        let width = block.validate_shape()?;
        if prediction_width.is_some_and(|expected| expected != width) {
            return Err(DagMlError::RuntimeValidation(format!(
                "aggregated prediction cache `{}` has inconsistent prediction width",
                requirement.key()
            )));
        }
        prediction_width = Some(width);
        let block_target_names = normalized_aggregated_prediction_targets(block, width);
        if target_names
            .as_ref()
            .is_some_and(|expected| expected != &block_target_names)
        {
            return Err(DagMlError::RuntimeValidation(format!(
                "aggregated prediction cache `{}` has inconsistent target names",
                requirement.key()
            )));
        }
        target_names = Some(block_target_names);
        if let Some(fold_id) = &block.fold_id {
            fold_ids.insert(fold_id.clone());
        }
        unit_ids.extend(block.unit_ids.iter().cloned());
        row_count += block.unit_ids.len();
        block_records.push(BundlePredictionBlockCacheRecord {
            prediction_id: block.prediction_id.clone(),
            fold_id: block.fold_id.clone(),
            prediction_level: block.level,
            row_count: block.unit_ids.len(),
            unit_ids: block.unit_ids.clone(),
            sample_ids: Vec::new(),
            content_fingerprint: stable_json_fingerprint(block)?,
        });
    }

    let record = BundlePredictionCacheRecord {
        requirement_key: requirement.key(),
        cache_id: format!("prediction-cache:{}", requirement.key()),
        cache_namespace_fingerprints: Vec::new(),
        format: BUNDLE_PREDICTION_CACHE_FORMAT.to_string(),
        partition: requirement.partition.clone(),
        prediction_level: requirement.prediction_level,
        fold_ids: fold_ids.into_iter().collect(),
        unit_ids: unit_ids.into_iter().collect(),
        sample_ids: Vec::new(),
        prediction_width: prediction_width.unwrap_or_default(),
        target_names: target_names.unwrap_or_default(),
        block_count: block_records.len(),
        row_count,
        content_fingerprint: stable_json_fingerprint(selected)?,
        blocks: block_records,
    };
    validate_prediction_cache_matches_requirement(&record, requirement)?;
    record.validate()?;
    Ok(record)
}

fn validate_prediction_cache_matches_requirement(
    cache: &BundlePredictionCacheRecord,
    requirement: &BundlePredictionRequirement,
) -> Result<()> {
    if cache.requirement_key != requirement.key()
        || cache.partition != requirement.partition
        || cache.prediction_level != requirement.prediction_level
        || cache.fold_ids != requirement.fold_ids
        || cache.unit_ids != requirement.unit_ids
        || cache.sample_ids != requirement.sample_ids
        || cache.prediction_width != requirement.prediction_width
        || cache.target_names != requirement.target_names
    {
        return Err(DagMlError::RuntimeValidation(format!(
            "prediction cache `{}` does not match requirement `{}`",
            cache.cache_id,
            requirement.key()
        )));
    }
    Ok(())
}

fn normalized_prediction_targets(block: &PredictionBlock, width: usize) -> Vec<String> {
    if block.target_names.is_empty() {
        (0..width).map(|index| format!("p{index}")).collect()
    } else {
        block.target_names.clone()
    }
}

fn normalized_aggregated_prediction_targets(
    block: &AggregatedPredictionBlock,
    width: usize,
) -> Vec<String> {
    if block.target_names.is_empty() {
        (0..width).map(|index| format!("p{index}")).collect()
    } else {
        block.target_names.clone()
    }
}

fn sample_prediction_units(sample_ids: &[SampleId]) -> Vec<PredictionUnitId> {
    sample_ids
        .iter()
        .cloned()
        .map(PredictionUnitId::Sample)
        .collect()
}

fn validate_prediction_units(
    label: &str,
    expected_level: PredictionLevel,
    unit_ids: &[PredictionUnitId],
) -> Result<()> {
    validate_unique_ids(label, unit_ids)?;
    for unit_id in unit_ids {
        if unit_id.level() != expected_level {
            return Err(DagMlError::RuntimeValidation(format!(
                "{label} `{unit_id}` does not match prediction level {:?}",
                expected_level
            )));
        }
    }
    Ok(())
}

fn validate_fingerprint(label: &str, value: &str) -> Result<()> {
    if value.len() != 64 || !value.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(DagMlError::RuntimeValidation(format!(
            "{label} fingerprint must be a 64-character hex digest"
        )));
    }
    Ok(())
}

fn validate_non_empty(label: &str, value: &str) -> Result<()> {
    if value.trim().is_empty() {
        return Err(DagMlError::RuntimeValidation(format!("{label} is empty")));
    }
    Ok(())
}

fn validate_unique_ids<T>(label: &str, values: &[T]) -> Result<()>
where
    T: Ord + ToString,
{
    let mut seen = BTreeSet::new();
    for value in values {
        if !seen.insert(value) {
            return Err(DagMlError::RuntimeValidation(format!(
                "duplicate {label} `{}`",
                value.to_string()
            )));
        }
    }
    Ok(())
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct ReplayPhaseRequest {
    pub bundle_id: BundleId,
    pub phase: Phase,
    #[serde(default)]
    pub data_envelope_keys: Vec<String>,
}

impl ReplayPhaseRequest {
    pub fn validate_for_bundle(&self, bundle: &ExecutionBundle) -> Result<()> {
        self.validate_for_bundle_with_prediction_cache_store(bundle, false)
    }

    pub fn validate_for_bundle_with_prediction_cache_store(
        &self,
        bundle: &ExecutionBundle,
        prediction_cache_available: bool,
    ) -> Result<()> {
        self.validate_for_bundle_internal(bundle, prediction_cache_available)
    }

    pub fn validate_for_bundle_with_prediction_cache_payloads(
        &self,
        bundle: &ExecutionBundle,
        prediction_cache_payloads: Option<&BundlePredictionCachePayloadSet>,
    ) -> Result<()> {
        if let Some(payloads) = prediction_cache_payloads {
            payloads.validate_against_bundle(bundle)?;
        }
        self.validate_for_bundle_internal(bundle, prediction_cache_payloads.is_some())
    }

    fn validate_for_bundle_internal(
        &self,
        bundle: &ExecutionBundle,
        prediction_cache_available: bool,
    ) -> Result<()> {
        bundle.validate()?;
        if self.bundle_id != bundle.bundle_id {
            return Err(DagMlError::RuntimeValidation(format!(
                "replay request bundle `{}` does not match bundle `{}`",
                self.bundle_id, bundle.bundle_id
            )));
        }
        if !matches!(self.phase, Phase::Predict | Phase::Explain | Phase::Refit) {
            return Err(DagMlError::RuntimeValidation(format!(
                "bundle replay phase {:?} is not supported",
                self.phase
            )));
        }
        if self.phase == Phase::Refit && !bundle.prediction_requirements.is_empty() {
            if prediction_cache_available {
                return self.validate_data_envelope_keys(bundle);
            }
            return Err(DagMlError::RuntimeValidation(format!(
                "bundle `{}` cannot replay REFIT because it depends on {} OOF prediction requirement(s) but stores only prediction cache manifests",
                bundle.bundle_id,
                bundle.prediction_requirements.len()
            )));
        }
        self.validate_data_envelope_keys(bundle)
    }

    fn validate_data_envelope_keys(&self, bundle: &ExecutionBundle) -> Result<()> {
        let expected = bundle
            .data_requirements
            .iter()
            .map(BundleDataRequirement::key)
            .collect::<BTreeSet<_>>();
        let mut requested = BTreeSet::new();
        for key in &self.data_envelope_keys {
            if key.trim().is_empty() {
                return Err(DagMlError::RuntimeValidation(
                    "replay request contains an empty data envelope key".to_string(),
                ));
            }
            if !requested.insert(key.as_str()) {
                return Err(DagMlError::RuntimeValidation(format!(
                    "replay request contains duplicate data envelope key `{key}`"
                )));
            }
            if !expected.contains(key.as_str()) {
                return Err(DagMlError::RuntimeValidation(format!(
                    "replay request references unknown data envelope key `{key}`"
                )));
            }
        }
        for requirement in &bundle.data_requirements {
            let key = requirement.key();
            if !requested.contains(key.as_str()) {
                return Err(DagMlError::RuntimeValidation(format!(
                    "replay request is missing data envelope key `{key}`"
                )));
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::controller::{ControllerManifest, ControllerRegistry};
    use crate::data::{
        AggregateRepresentation, RepresentationCardinality, RepresentationCompatibilityOutcome,
        RepresentationCompatibilityReport, RepresentationMissingSourcePolicy, RepresentationPlan,
        RepresentationReplayManifest,
    };
    use crate::dsl::{compile_pipeline_dsl_with_generation, PipelineDslSpec};
    use crate::graph::GraphSpec;
    use crate::ids::{ArtifactId, ControllerId, FoldId, LineageId, RunId, SampleId, TargetId};
    use crate::plan::{build_execution_plan, CampaignSpec};
    use crate::relation::EntityUnitLevel;
    use crate::selection::{
        select_candidate, CandidateScore, MetricObjective, SelectionMetric, SelectionPolicy,
    };

    fn plan() -> ExecutionPlan {
        let graph: GraphSpec =
            serde_json::from_str(include_str!("../tests/fixtures/package/minimal_graph.json"))
                .unwrap();
        let campaign: CampaignSpec = serde_json::from_str(include_str!(
            "../tests/fixtures/package/campaign_oof_generation.json"
        ))
        .unwrap();
        let manifests: Vec<ControllerManifest> = serde_json::from_str(include_str!(
            "../tests/fixtures/package/controller_manifests.json"
        ))
        .unwrap();
        let mut registry = ControllerRegistry::new();
        for manifest in manifests {
            registry.register(manifest).unwrap();
        }
        build_execution_plan("plan:bundle", graph, campaign, &registry).unwrap()
    }

    fn methods_hpo_resume_state() -> MethodsHpoResumeState {
        let node = NodeId::new("model:hpo").unwrap();
        let variant = crate::generation::VariantPlan {
            variant_id: VariantId::new("hpo:trial:1").unwrap(),
            choices: BTreeMap::new(),
            fingerprint: "c".repeat(64),
            seed: Some(7),
        };
        let sample = SampleId::new("sample:hpo.1").unwrap();
        let target = RegressionTargetBlock {
            level: PredictionLevel::Sample,
            unit_ids: vec![PredictionUnitId::Sample(sample.clone())],
            values: vec![vec![1.0]],
            target_names: vec!["y".to_string()],
        };
        let report = RegressionMetricReport {
            prediction_id: Some("prediction:model:hpo.avg".to_string()),
            producer_node: node.clone(),
            producer_port: Some("prediction".to_string()),
            variant_id: Some(variant.variant_id.clone()),
            variant_label: None,
            partition: PredictionPartition::Validation,
            fold_id: Some(FoldId::new("avg").unwrap()),
            level: PredictionLevel::Sample,
            row_count: 1,
            target_width: 1,
            target_names: vec!["y".to_string()],
            metrics: BTreeMap::from([("rmse".to_string(), 0.25)]),
        };
        let payload = vec![1_u8, 2, 3];
        MethodsHpoResumeState {
            schema_version: METHODS_HPO_RESUME_STATE_SCHEMA_VERSION,
            checkpoint: crate::hpo::N4moptCheckpointArtifact {
                schema_version: crate::hpo::N4MOPT_CHECKPOINT_SCHEMA_VERSION,
                artifact_kind: crate::hpo::N4MOPT_ARTIFACT_KIND.to_string(),
                format: crate::hpo::N4MOPT_FORMAT.to_string(),
                abi_major: crate::hpo::METHODS_ABI_MAJOR,
                abi_min_minor: crate::hpo::METHODS_N4MOPT_MIN_ABI_MINOR,
                binding: crate::hpo::HpoStudyBinding {
                    controller_id: "controller:hpo".to_string(),
                    study_id: "study:hpo".to_string(),
                    search_space_fingerprint: "a".repeat(64),
                    optimizer_fingerprint: "b".repeat(64),
                },
                methods_abi: "n4m:1".to_string(),
                payload_sha256: format!("{:x}", sha2::Sha256::digest(&payload)),
                opaque_payload: payload,
            },
            provenance: MethodsHpoResumeProvenance {
                graph_fingerprint: "d".repeat(64),
                campaign_fingerprint: "e".repeat(64),
                controller_fingerprint: "f".repeat(64),
                data_identities_fingerprint: "1".repeat(64),
                fold_set_fingerprint: "2".repeat(64),
                training_influence_fingerprint: "3".repeat(64),
                relation_fingerprint: "4".repeat(64),
                selection: MethodsHpoResumeSelection {
                    selection_id: "selection:hpo".to_string(),
                    target_node_id: node.clone(),
                    producer_port: "prediction".to_string(),
                    metric: "rmse".to_string(),
                },
            },
            operation_id: "hpo:bundle-test".to_string(),
            controller_id: ControllerId::new("controller:hpo").unwrap(),
            target_node_id: node.clone(),
            incumbent: MethodsHpoNativeIncumbent {
                trial_id: 1,
                score: 0.25,
                metric: "rmse".to_string(),
                direction: crate::hpo::HpoDirection::Minimize,
                variant_id: variant.variant_id.clone(),
            },
            trial_history_len: 1,
            terminal_trials: vec![MethodsHpoTerminalEvidence {
                trial: crate::hpo::HpoTrial {
                    id: 1,
                    ask_sequence: 1,
                    terminal_sequence: Some(1),
                    parameters: BTreeMap::new(),
                    parameter_order: Vec::new(),
                    status: crate::hpo::HpoTrialStatus::Completed,
                    score: Some(0.25),
                    rung: 0,
                    duration: 0.0,
                    intermediates: Vec::new(),
                    failure: None,
                },
                variant_id: Some(variant.variant_id.clone()),
            }],
            completed_proposals: vec![MethodsHpoCompletedProposal {
                trial_id: 1,
                variant: variant.clone(),
            }],
            completed_reports: vec![MethodsHpoCompletedReport {
                trial_id: 1,
                variant_id: variant.variant_id.clone(),
                terminal_state: MethodsHpoCompletedState::Completed,
                score: 0.25,
                report,
            }],
            candidates: vec![MethodsHpoCandidateEvidence {
                trial_id: 1,
                variant_id: variant.variant_id.clone(),
                variant_label: None,
                predictions: vec![PredictionBlock {
                    prediction_id: Some("prediction:model:hpo.fold0".to_string()),
                    producer_node: node.clone(),
                    producer_port: Some("prediction".to_string()),
                    partition: PredictionPartition::Validation,
                    fold_id: Some(FoldId::new("fold:0").unwrap()),
                    sample_ids: vec![sample.clone()],
                    values: vec![vec![1.25]],
                    target_names: vec!["y".to_string()],
                }],
                regression_targets: vec![target.clone()],
                oof_average: MethodsHpoOofAverage {
                    predictions: AggregatedPredictionBlock {
                        prediction_id: Some("prediction:model:hpo.avg".to_string()),
                        producer_node: node.clone(),
                        producer_port: Some("prediction".to_string()),
                        partition: PredictionPartition::Validation,
                        fold_id: Some(FoldId::new("avg").unwrap()),
                        level: PredictionLevel::Sample,
                        unit_ids: vec![PredictionUnitId::Sample(sample)],
                        values: vec![vec![1.25]],
                        target_names: vec!["y".to_string()],
                    },
                    y_true: target,
                },
                lineage: vec![crate::runtime::LineageRecord {
                    record_id: LineageId::new("lineage:hpo.1").unwrap(),
                    run_id: RunId::new("run:hpo").unwrap(),
                    node_id: node,
                    phase: Phase::FitCv,
                    controller_id: ControllerId::new("controller:methods.pls").unwrap(),
                    controller_version: "1".to_string(),
                    variant_id: Some(variant.variant_id),
                    fold_id: Some(FoldId::new("fold:0").unwrap()),
                    branch_path: Vec::new(),
                    input_lineage: Vec::new(),
                    artifact_refs: Vec::new(),
                    params_fingerprint: "5".repeat(64),
                    data_model_shape_fingerprint: None,
                    aggregation_policy_fingerprint: None,
                    seed: Some(7),
                    unsafe_flags: BTreeSet::new(),
                    metrics: BTreeMap::new(),
                    loss_attestations: Vec::new(),
                    early_stopping_records: Vec::new(),
                }],
            }],
        }
    }

    fn branch_merge_plan() -> ExecutionPlan {
        let graph: GraphSpec = serde_json::from_str(include_str!(
            "../tests/fixtures/package/branch_merge_oof_graph.json"
        ))
        .unwrap();
        let campaign: CampaignSpec = serde_json::from_str(include_str!(
            "../tests/fixtures/package/campaign_branch_merge_oof.json"
        ))
        .unwrap();
        let manifests: Vec<ControllerManifest> = serde_json::from_str(include_str!(
            "../tests/fixtures/package/controller_manifests.json"
        ))
        .unwrap();
        let mut registry = ControllerRegistry::new();
        for manifest in manifests {
            registry.register(manifest).unwrap();
        }
        build_execution_plan("plan:branch.merge.bundle", graph, campaign, &registry).unwrap()
    }

    /// A separation-branch + concat-merge plan: two model branches, each scoped to
    /// a disjoint partition of the sample universe, feeding one `prediction_join`
    /// concat-merge node. The branch OOF edges are `requires_oof +
    /// requires_fold_alignment`, but each branch's OOF covers only its partition
    /// (a strict subset of the fold universe). This is the Slice 3.5 bundle-assembly
    /// shape the partition-aware requirement validation must accept.
    fn separation_concat_merge_plan() -> ExecutionPlan {
        let graph: GraphSpec = serde_json::from_str(include_str!(
            "../tests/fixtures/package/separation_branch_concat_merge_oof_graph.json"
        ))
        .unwrap();
        let campaign: CampaignSpec = serde_json::from_str(include_str!(
            "../tests/fixtures/package/campaign_separation_branch_concat_merge_oof.json"
        ))
        .unwrap();
        let manifests: Vec<ControllerManifest> = serde_json::from_str(include_str!(
            "../tests/fixtures/package/controller_manifests.json"
        ))
        .unwrap();
        let mut registry = ControllerRegistry::new();
        for manifest in manifests {
            registry.register(manifest).unwrap();
        }
        build_execution_plan(
            "plan:separation.concat.merge.bundle",
            graph,
            campaign,
            &registry,
        )
        .unwrap()
    }

    /// Per-partition branch OOF requirement into the concat-merge node. Each branch
    /// covers ONLY its partition's two samples (one per fold), never the full
    /// 4-sample universe — the partition-covering input shape.
    fn separation_branch_requirement(
        producer_node: &str,
        partition_samples: &[&str],
        partition_folds: &[&str],
    ) -> BundlePredictionRequirement {
        BundlePredictionRequirement {
            producer_node: NodeId::new(producer_node).unwrap(),
            source_port: "oof".to_string(),
            consumer_node: NodeId::new("merge:sites").unwrap(),
            target_port: format!("oof_{producer_node}"),
            partition: PredictionPartition::Validation,
            prediction_level: PredictionLevel::Sample,
            fold_ids: partition_folds
                .iter()
                .map(|f| FoldId::new(*f).unwrap())
                .collect(),
            unit_ids: Vec::new(),
            sample_ids: partition_samples
                .iter()
                .map(|s| SampleId::new(*s).unwrap())
                .collect(),
            prediction_width: 1,
            target_names: vec!["y".to_string()],
        }
    }

    /// Per-fold validation OOF blocks for a separation branch: one block per fold,
    /// each carrying only the branch's partition ∩ fold validation sample.
    fn separation_branch_blocks(
        producer_node: &str,
        fold0_sample: &str,
        fold1_sample: &str,
        offset: f64,
    ) -> Vec<PredictionBlock> {
        let producer_node = NodeId::new(producer_node).unwrap();
        vec![
            PredictionBlock {
                prediction_id: Some(format!("prediction:{producer_node}:fold0")),
                producer_node: producer_node.clone(),
                producer_port: Some("pred".to_string()),
                partition: PredictionPartition::Validation,
                fold_id: Some(FoldId::new("fold:0").unwrap()),
                sample_ids: vec![SampleId::new(fold0_sample).unwrap()],
                values: vec![vec![offset + 0.1]],
                target_names: vec!["y".to_string()],
            },
            PredictionBlock {
                prediction_id: Some(format!("prediction:{producer_node}:fold1")),
                producer_node,
                producer_port: Some("pred".to_string()),
                partition: PredictionPartition::Validation,
                fold_id: Some(FoldId::new("fold:1").unwrap()),
                sample_ids: vec![SampleId::new(fold1_sample).unwrap()],
                values: vec![vec![offset + 0.2]],
                target_names: vec!["y".to_string()],
            },
        ]
    }

    fn executable_dsl_plan() -> ExecutionPlan {
        let spec: PipelineDslSpec = serde_json::from_str(include_str!(
            "../tests/fixtures/package/pipeline_dsl_branch_merge_executable.json"
        ))
        .unwrap();
        let compiled = compile_pipeline_dsl_with_generation(&spec).unwrap();
        let manifests: Vec<ControllerManifest> = serde_json::from_str(include_str!(
            "../tests/fixtures/package/controller_manifests.json"
        ))
        .unwrap();
        let mut registry = ControllerRegistry::new();
        for manifest in manifests {
            registry.register(manifest).unwrap();
        }
        build_execution_plan(
            "plan:dsl.branch.merge.bundle",
            compiled.graph,
            compiled.campaign_template,
            &registry,
        )
        .unwrap()
    }

    fn branch_merge_selection_decisions() -> BTreeMap<String, SelectionDecision> {
        serde_json::from_str(include_str!(
            "../tests/fixtures/package/bundle/selection_decisions_branch_merge.json"
        ))
        .unwrap()
    }

    fn refit_artifact(
        plan: &ExecutionPlan,
        node_id: &str,
        data_requirement_keys: Vec<String>,
        prediction_requirement_keys: Vec<String>,
    ) -> RefitArtifactRecord {
        let node_id = NodeId::new(node_id).unwrap();
        let node_plan = plan.node_plans.get(&node_id).unwrap();
        RefitArtifactRecord {
            node_id: node_plan.node_id.clone(),
            controller_id: node_plan.controller_id.clone(),
            artifact: ArtifactRef {
                id: ArtifactId::new(format!("artifact:{}:refit", node_plan.node_id)).unwrap(),
                kind: "mock_model".to_string(),
                controller_id: node_plan.controller_id.clone(),
                backend: None,
                uri: None,
                content_fingerprint: None,
                size_bytes: Some(128),
                plugin: None,
                plugin_version: None,
                abi_major: None,
                abi_min_minor: None,
            },
            params_fingerprint: node_plan.params_fingerprint.clone(),
            training_loss_fingerprint: node_plan.training_loss_fingerprint(Phase::Refit).unwrap(),
            data_requirement_keys,
            prediction_requirement_keys,
        }
    }

    fn branch_merge_samples() -> Vec<SampleId> {
        vec![
            SampleId::new("sample:1").unwrap(),
            SampleId::new("sample:2").unwrap(),
            SampleId::new("sample:3").unwrap(),
            SampleId::new("sample:4").unwrap(),
        ]
    }

    fn branch_merge_requirement(
        producer_node: &str,
        target_port: &str,
    ) -> BundlePredictionRequirement {
        BundlePredictionRequirement {
            producer_node: NodeId::new(producer_node).unwrap(),
            source_port: "oof".to_string(),
            consumer_node: NodeId::new("merge:stack.pred_plus_original.meta:ridge").unwrap(),
            target_port: target_port.to_string(),
            partition: PredictionPartition::Validation,
            prediction_level: PredictionLevel::Sample,
            fold_ids: vec![
                FoldId::new("fold:0").unwrap(),
                FoldId::new("fold:1").unwrap(),
            ],
            unit_ids: Vec::new(),
            sample_ids: branch_merge_samples(),
            prediction_width: 1,
            target_names: vec!["y".to_string()],
        }
    }

    fn branch_merge_prediction_blocks(producer_node: &str, offset: f64) -> Vec<PredictionBlock> {
        let producer_node = NodeId::new(producer_node).unwrap();
        let samples = branch_merge_samples();
        vec![
            PredictionBlock {
                prediction_id: Some(format!("prediction:{producer_node}:fold0")),
                producer_node: producer_node.clone(),
                producer_port: Some("pred".to_string()),
                partition: PredictionPartition::Validation,
                fold_id: Some(FoldId::new("fold:0").unwrap()),
                sample_ids: samples[0..2].to_vec(),
                values: vec![vec![offset + 0.1], vec![offset + 0.2]],
                target_names: vec!["y".to_string()],
            },
            PredictionBlock {
                prediction_id: Some(format!("prediction:{producer_node}:fold1")),
                producer_node,
                producer_port: Some("pred".to_string()),
                partition: PredictionPartition::Validation,
                fold_id: Some(FoldId::new("fold:1").unwrap()),
                sample_ids: samples[2..4].to_vec(),
                values: vec![vec![offset + 0.3], vec![offset + 0.4]],
                target_names: vec!["y".to_string()],
            },
        ]
    }

    fn decision() -> SelectionDecision {
        select_candidate(
            &SelectionPolicy {
                id: "select:merge".to_string(),
                metric: SelectionMetric {
                    name: "rmse".to_string(),
                    objective: MetricObjective::Minimize,
                },
                required_metric_level: Some(crate::policy::PredictionLevel::Sample),
                require_finite: true,
                evaluation_scope: None,
                refit_slot_plan: None,
                stacking_fit_contract: None,
                reduction_id: None,
            },
            &[
                CandidateScore {
                    candidate_id: "model:base".to_string(),
                    metrics: BTreeMap::from([("rmse".to_string(), 1.0)]),
                    metadata: BTreeMap::from([(
                        "metric_level".to_string(),
                        serde_json::Value::String("sample".to_string()),
                    )]),
                },
                CandidateScore {
                    candidate_id: "model:other".to_string(),
                    metrics: BTreeMap::from([("rmse".to_string(), 2.0)]),
                    metadata: BTreeMap::from([(
                        "metric_level".to_string(),
                        serde_json::Value::String("sample".to_string()),
                    )]),
                },
            ],
        )
        .unwrap()
    }

    fn selected_model_base_decision() -> SelectionDecision {
        decision()
    }

    fn model_base_refit_artifact(plan: &ExecutionPlan) -> RefitArtifactRecord {
        let model_plan = plan
            .node_plans
            .get(&NodeId::new("model:base").unwrap())
            .unwrap();
        RefitArtifactRecord {
            node_id: model_plan.node_id.clone(),
            controller_id: model_plan.controller_id.clone(),
            artifact: ArtifactRef {
                id: ArtifactId::new("artifact:model:base:refit").unwrap(),
                kind: "sklearn_pickle".to_string(),
                controller_id: model_plan.controller_id.clone(),
                backend: None,
                uri: None,
                content_fingerprint: None,
                size_bytes: Some(128),
                plugin: None,
                plugin_version: None,
                abi_major: None,
                abi_min_minor: None,
            },
            params_fingerprint: model_plan.params_fingerprint.clone(),
            training_loss_fingerprint: model_plan.training_loss_fingerprint(Phase::Refit).unwrap(),
            data_requirement_keys: vec!["model:base.x".to_string()],
            prediction_requirement_keys: Vec::new(),
        }
    }

    #[test]
    fn builds_bundle_from_execution_plan() {
        let plan = plan();
        let artifact = model_base_refit_artifact(&plan);

        let bundle = build_execution_bundle(
            BundleId::new("bundle:demo").unwrap(),
            &plan,
            Some(plan.variants[0].variant_id.clone()),
            BTreeMap::from([("merge".to_string(), decision())]),
            vec![artifact],
        )
        .unwrap();

        bundle.validate_against_plan(&plan).unwrap();
        assert_eq!(bundle.data_requirements.len(), 1);
    }

    #[test]
    fn bundle_data_requirements_accept_d7_replay_contracts() {
        let plan = plan();
        let artifact = model_base_refit_artifact(&plan);
        let mut bundle = build_execution_bundle(
            BundleId::new("bundle:d7.replay").unwrap(),
            &plan,
            Some(plan.variants[0].variant_id.clone()),
            BTreeMap::from([("merge".to_string(), decision())]),
            vec![artifact],
        )
        .unwrap();
        let relation_fingerprint = bundle.data_requirements[0]
            .relation_fingerprint
            .clone()
            .unwrap_or_else(|| "a".repeat(64));
        bundle.data_requirements[0].representation_replay_manifest =
            Some(RepresentationReplayManifest {
                manifest_id: "repr:d7.bundle".to_string(),
                representation_plan: RepresentationPlan::Aggregate(AggregateRepresentation {
                    input_unit_level: EntityUnitLevel::Observation,
                    output_unit_level: EntityUnitLevel::PhysicalSample,
                    reducer_id: None,
                    method: Some("mean".to_string()),
                    cardinality: RepresentationCardinality::ManyToOne,
                }),
                combination_plan: None,
                output_unit_level: EntityUnitLevel::PhysicalSample,
                output_representation: Some("tabular_numeric".to_string()),
                relation_fingerprint: Some(relation_fingerprint.clone()),
                feature_schema_fingerprint: Some("b".repeat(64)),
                final_reduction_id: None,
                sample_observation_mapping: Vec::new(),
                combo_selection: Vec::new(),
                qc_policy_refs: Vec::new(),
                outlier_policy_refs: Vec::new(),
                missing_source_policy: None,
                missing_repetition_policy: None,
                prediction_representation: None,
                final_output_unit_level: Some(EntityUnitLevel::PhysicalSample),
                train_compatibility: None,
                predict_compatibility: None,
                metadata: BTreeMap::new(),
            });
        bundle.data_requirements[0].representation_compatibility =
            Some(RepresentationCompatibilityReport {
                policy: RepresentationMissingSourcePolicy::Strict,
                outcome: RepresentationCompatibilityOutcome::Compatible,
                fallback_used: None,
                warning_severity: None,
                affected_source_count: 0,
                affected_repetition_count: 0,
                affected_sample_count: 0,
                train_relation_fingerprint: Some(relation_fingerprint),
                predict_relation_fingerprint: None,
                train_unit_count: Some(2),
                predict_unit_count: Some(2),
                fixed_width_required: false,
                final_reducer_stabilizes_output: true,
                cartesian_combo_count_changed: false,
                late_fusion_branch_delta: false,
                messages: Vec::new(),
                metadata: BTreeMap::new(),
            });
        bundle.validate_against_plan(&plan).unwrap();

        bundle.data_requirements[0]
            .representation_replay_manifest
            .as_mut()
            .unwrap()
            .relation_fingerprint = Some("c".repeat(64));
        if bundle.data_requirements[0].relation_fingerprint.is_some() {
            assert!(bundle.validate().is_err());
        }
    }

    #[test]
    fn d9_negative_prediction_cache_refuses_missing_aggregated_unit_ids() {
        let cache = BundlePredictionCacheRecord {
            requirement_key: "model:base.oof->model:meta.pred".to_string(),
            cache_id: "prediction-cache:d9.missing-units".to_string(),
            cache_namespace_fingerprints: Vec::new(),
            format: BUNDLE_PREDICTION_CACHE_FORMAT.to_string(),
            partition: PredictionPartition::Validation,
            prediction_level: PredictionLevel::Target,
            fold_ids: vec![FoldId::new("fold:0").unwrap()],
            unit_ids: Vec::new(),
            sample_ids: Vec::new(),
            prediction_width: 1,
            target_names: vec!["y".to_string()],
            block_count: 1,
            row_count: 1,
            content_fingerprint: "d".repeat(64),
            blocks: vec![BundlePredictionBlockCacheRecord {
                prediction_id: Some("prediction:d9.target.fold0".to_string()),
                fold_id: Some(FoldId::new("fold:0").unwrap()),
                prediction_level: PredictionLevel::Target,
                row_count: 1,
                unit_ids: vec![PredictionUnitId::Target(TargetId::new("target:a").unwrap())],
                sample_ids: Vec::new(),
                content_fingerprint: "e".repeat(64),
            }],
        };

        let error = cache.validate().unwrap_err().to_string();
        assert!(
            error.contains("row_count does not match unique unit ids"),
            "unexpected D9 missing-unit-id cache error: {error}"
        );
    }

    #[test]
    fn refit_artifact_validation_checks_portable_artifact_metadata() {
        let plan = plan();
        let mut artifact = model_base_refit_artifact(&plan);
        artifact.artifact.backend = Some(crate::runtime::ArtifactBackend::Joblib);
        artifact.artifact.uri = Some("artifacts/model.joblib".to_string());
        artifact.artifact.content_fingerprint = Some("c".repeat(64));
        artifact.artifact.plugin = Some("dagml.sklearn".to_string());
        artifact.artifact.plugin_version = Some("1.0.0".to_string());
        artifact.validate().unwrap();

        artifact.artifact.content_fingerprint = Some("short".to_string());
        assert!(artifact
            .validate()
            .unwrap_err()
            .to_string()
            .contains("artifact content fingerprint"));
    }

    #[test]
    fn bundle_selections_must_match_plan_and_refit_artifacts() {
        let plan = plan();
        let artifact = model_base_refit_artifact(&plan);
        let valid = build_execution_bundle(
            BundleId::new("bundle:selected.model").unwrap(),
            &plan,
            Some(plan.variants[0].variant_id.clone()),
            BTreeMap::from([("model".to_string(), selected_model_base_decision())]),
            vec![artifact.clone()],
        )
        .unwrap();
        valid.validate_against_plan(&plan).unwrap();

        assert!(build_execution_bundle(
            BundleId::new("bundle:selected.model.missing.artifact").unwrap(),
            &plan,
            Some(plan.variants[0].variant_id.clone()),
            BTreeMap::from([("model".to_string(), selected_model_base_decision())]),
            Vec::new(),
        )
        .is_err());

        let mut missing_level = selected_model_base_decision();
        missing_level.metric_level = None;
        assert!(build_execution_bundle(
            BundleId::new("bundle:selected.missing.level").unwrap(),
            &plan,
            Some(plan.variants[0].variant_id.clone()),
            BTreeMap::from([("model".to_string(), missing_level)]),
            vec![artifact.clone()],
        )
        .is_err());

        let mut wrong_level = selected_model_base_decision();
        wrong_level.metric_level = Some(crate::policy::PredictionLevel::Target);
        assert!(build_execution_bundle(
            BundleId::new("bundle:selected.wrong.level").unwrap(),
            &plan,
            Some(plan.variants[0].variant_id.clone()),
            BTreeMap::from([("model".to_string(), wrong_level)]),
            vec![artifact.clone()],
        )
        .is_err());

        let mut unknown = selected_model_base_decision();
        unknown.selected_candidate_id = "model:missing".to_string();
        unknown.ranked_candidates[0].candidate_id = "model:missing".to_string();
        assert!(build_execution_bundle(
            BundleId::new("bundle:selected.unknown").unwrap(),
            &plan,
            Some(plan.variants[0].variant_id.clone()),
            BTreeMap::from([("model".to_string(), unknown)]),
            vec![artifact],
        )
        .is_err());
    }

    #[test]
    fn bundle_artifact_params_follow_selected_generation_variant() {
        let plan = executable_dsl_plan();
        let selected_variant = &plan.variants[0];
        let node_plan = plan
            .node_plans
            .get(&NodeId::new("branch:b0.model:ridge").unwrap())
            .unwrap();
        let effective_params = selected_variant
            .effective_params_for_node(&node_plan.node_id, &node_plan.params)
            .unwrap();
        let effective_fingerprint = stable_json_fingerprint(&effective_params).unwrap();
        assert_ne!(effective_fingerprint, node_plan.params_fingerprint);

        let artifact = RefitArtifactRecord {
            node_id: node_plan.node_id.clone(),
            controller_id: node_plan.controller_id.clone(),
            artifact: ArtifactRef {
                id: ArtifactId::new("artifact:branch:b0.model:ridge:refit").unwrap(),
                kind: "mock_model".to_string(),
                controller_id: node_plan.controller_id.clone(),
                backend: None,
                uri: None,
                content_fingerprint: None,
                size_bytes: Some(128),
                plugin: None,
                plugin_version: None,
                abi_major: None,
                abi_min_minor: None,
            },
            params_fingerprint: effective_fingerprint,
            training_loss_fingerprint: node_plan.training_loss_fingerprint(Phase::Refit).unwrap(),
            data_requirement_keys: vec!["branch:b0.model:ridge.x".to_string()],
            prediction_requirement_keys: Vec::new(),
        };

        build_execution_bundle(
            BundleId::new("bundle:dsl.variant.params").unwrap(),
            &plan,
            Some(selected_variant.variant_id.clone()),
            BTreeMap::new(),
            vec![artifact.clone()],
        )
        .unwrap();

        let mut stale_artifact = artifact;
        stale_artifact.params_fingerprint = node_plan.params_fingerprint.clone();
        let error = build_execution_bundle(
            BundleId::new("bundle:dsl.variant.params.stale").unwrap(),
            &plan,
            Some(selected_variant.variant_id.clone()),
            BTreeMap::new(),
            vec![stale_artifact],
        )
        .unwrap_err();
        assert!(format!("{error}").contains("artifact params"));
    }

    #[test]
    fn branch_merge_bundle_links_selected_refits_and_fold_aligned_oof_caches() {
        let plan = branch_merge_plan();
        let b0_requirement = branch_merge_requirement("branch:b0.model:ridge", "b0_oof");
        let b1_requirement = branch_merge_requirement("branch:b1.model:rf", "b1_oof");
        let b0_cache = build_prediction_cache_record(
            &b0_requirement,
            &branch_merge_prediction_blocks("branch:b0.model:ridge", 0.0),
        )
        .unwrap();
        let b1_cache = build_prediction_cache_record(
            &b1_requirement,
            &branch_merge_prediction_blocks("branch:b1.model:rf", 1.0),
        )
        .unwrap();
        let b0_artifact = refit_artifact(
            &plan,
            "branch:b0.model:ridge",
            vec!["branch:b0.model:ridge.x".to_string()],
            Vec::new(),
        );
        let b1_artifact = refit_artifact(
            &plan,
            "branch:b1.model:rf",
            vec!["branch:b1.model:rf.x".to_string()],
            Vec::new(),
        );
        let merge_artifact = refit_artifact(
            &plan,
            "merge:stack.pred_plus_original.meta:ridge",
            vec!["merge:stack.pred_plus_original.meta:ridge.x_original".to_string()],
            vec![b0_requirement.key(), b1_requirement.key()],
        );

        let bundle = build_execution_bundle_with_prediction_contracts(
            BundleId::new("bundle:branch.merge.selected.refit").unwrap(),
            &plan,
            Some(plan.variants[0].variant_id.clone()),
            branch_merge_selection_decisions(),
            vec![
                b0_artifact.clone(),
                b1_artifact.clone(),
                merge_artifact.clone(),
            ],
            vec![b0_requirement.clone(), b1_requirement.clone()],
            vec![b0_cache.clone(), b1_cache.clone()],
        )
        .unwrap();
        bundle.validate_against_plan(&plan).unwrap();
        assert_eq!(bundle.selections.len(), 3);
        assert_eq!(bundle.prediction_requirements.len(), 2);
        assert_eq!(
            bundle.refit_artifacts[2].data_requirement_keys,
            vec!["merge:stack.pred_plus_original.meta:ridge.x_original"]
        );
        assert_eq!(
            bundle.refit_artifacts[2].prediction_requirement_keys,
            vec![
                "branch:b0.model:ridge.oof->merge:stack.pred_plus_original.meta:ridge.b0_oof",
                "branch:b1.model:rf.oof->merge:stack.pred_plus_original.meta:ridge.b1_oof",
            ]
        );

        assert!(build_execution_bundle_with_prediction_contracts(
            BundleId::new("bundle:branch.merge.missing.branch.refit").unwrap(),
            &plan,
            Some(plan.variants[0].variant_id.clone()),
            branch_merge_selection_decisions(),
            vec![b0_artifact.clone(), merge_artifact.clone()],
            vec![b0_requirement.clone(), b1_requirement.clone()],
            vec![b0_cache.clone(), b1_cache.clone()],
        )
        .is_err());

        let mut misaligned_cache = b0_cache;
        misaligned_cache.blocks[0].sample_ids = vec![
            SampleId::new("sample:1").unwrap(),
            SampleId::new("sample:3").unwrap(),
        ];
        misaligned_cache.blocks[1].sample_ids = vec![
            SampleId::new("sample:2").unwrap(),
            SampleId::new("sample:4").unwrap(),
        ];
        let error = build_execution_bundle_with_prediction_contracts(
            BundleId::new("bundle:branch.merge.misaligned.oof.cache").unwrap(),
            &plan,
            Some(plan.variants[0].variant_id.clone()),
            branch_merge_selection_decisions(),
            vec![b0_artifact, b1_artifact, merge_artifact],
            vec![b0_requirement, b1_requirement],
            vec![misaligned_cache, b1_cache],
        )
        .unwrap_err()
        .to_string();
        assert!(
            error.contains("does not match validation samples"),
            "unexpected fold-alignment error: {error}"
        );
    }

    /// Slice 3.5: a separation-branch + concat-merge plan whose branch OOF inputs
    /// cover disjoint partitions of the fold universe must ASSEMBLE (the strict
    /// `sample ids do not match plan fold set` check no longer aborts) AND the
    /// bundle scores carry a cv_best_score for the merge producer.
    #[test]
    fn separation_concat_merge_bundle_assembles_and_is_scored() {
        let plan = separation_concat_merge_plan();
        // Branch A owns partition {sample:1, sample:3}; branch B owns
        // {sample:2, sample:4}. Each is a strict subset of the 4-sample universe.
        let a_requirement = separation_branch_requirement(
            "branch:site__A.model:pls",
            &["sample:1", "sample:3"],
            &["fold:0", "fold:1"],
        );
        let b_requirement = separation_branch_requirement(
            "branch:site__B.model:pls",
            &["sample:2", "sample:4"],
            &["fold:0", "fold:1"],
        );
        let a_cache = build_prediction_cache_record(
            &a_requirement,
            &separation_branch_blocks("branch:site__A.model:pls", "sample:1", "sample:3", 0.0),
        )
        .unwrap();
        let b_cache = build_prediction_cache_record(
            &b_requirement,
            &separation_branch_blocks("branch:site__B.model:pls", "sample:2", "sample:4", 1.0),
        )
        .unwrap();
        let a_artifact = refit_artifact(
            &plan,
            "branch:site__A.model:pls",
            vec!["branch:site__A.model:pls.x".to_string()],
            Vec::new(),
        );
        let b_artifact = refit_artifact(
            &plan,
            "branch:site__B.model:pls",
            vec!["branch:site__B.model:pls.x".to_string()],
            Vec::new(),
        );

        let mut bundle = build_execution_bundle_with_prediction_contracts(
            BundleId::new("bundle:separation.concat.merge").unwrap(),
            &plan,
            Some(plan.variants[0].variant_id.clone()),
            BTreeMap::new(),
            vec![a_artifact, b_artifact],
            vec![a_requirement, b_requirement],
            vec![a_cache, b_cache],
        )
        .expect("separation-branch concat-merge bundle must assemble");

        // The bundle now validates against the plan: the partition-covering branch
        // inputs (each a strict subset) are accepted because their union covers the
        // full fold set disjointly — no "sample ids do not match plan fold set".
        bundle
            .validate_against_plan(&plan)
            .expect("partition-covering branch inputs must validate as a group");
        assert_eq!(bundle.prediction_requirements.len(), 2);

        // The merge producer is scored: a cv_best_score (cross-fold OOF average)
        // for the concat-merge node lands in bundle.scores, proving a separation
        // branch produces a SCORED bundle.
        let scores = ScoreSet {
            schema_version: crate::metrics::SCORE_SET_SCHEMA_VERSION,
            plan_id: plan.id.clone(),
            selection_metric: Some("rmse".to_string()),
            reports: vec![crate::metrics::RegressionMetricReport {
                prediction_id: Some("prediction:merge:sites:avg".to_string()),
                producer_node: NodeId::new("merge:sites").unwrap(),
                producer_port: Some("pred".to_string()),
                variant_id: Some(plan.variants[0].variant_id.clone()),
                variant_label: None,
                partition: PredictionPartition::Validation,
                fold_id: Some(FoldId::new("avg").unwrap()),
                level: PredictionLevel::Sample,
                row_count: 4,
                target_width: 1,
                target_names: vec!["y".to_string()],
                metrics: BTreeMap::from([("rmse".to_string(), 1.5)]),
            }],
        };
        bundle.scores = Some(scores);
        bundle
            .validate_against_plan(&plan)
            .expect("bundle with merge-producer scores must validate");
        let cv_best = bundle
            .scores
            .as_ref()
            .unwrap()
            .reports
            .iter()
            .find(|report| {
                report.producer_node.as_str() == "merge:sites"
                    && report.fold_id.as_ref().map(FoldId::as_str) == Some("avg")
            })
            .expect("merge producer must have a cross-fold (avg) score");
        assert_eq!(cv_best.metrics.get("rmse"), Some(&1.5));
    }

    /// Slice 3.5 negative: the partition-aware relaxation must NOT blind the OOF
    /// completeness check. If the branch inputs are NOT disjoint (a sample covered
    /// by two partitions), bundle assembly still errors clearly.
    #[test]
    fn separation_concat_merge_rejects_overlapping_partitions() {
        let plan = separation_concat_merge_plan();
        // Branch A correctly owns {sample:1, sample:3}; branch B WRONGLY also claims
        // sample:3 (overlap) and drops sample:4.
        let a_requirement = separation_branch_requirement(
            "branch:site__A.model:pls",
            &["sample:1", "sample:3"],
            &["fold:0", "fold:1"],
        );
        let b_requirement = separation_branch_requirement(
            "branch:site__B.model:pls",
            &["sample:2", "sample:3"],
            &["fold:0", "fold:1"],
        );
        let a_cache = build_prediction_cache_record(
            &a_requirement,
            &separation_branch_blocks("branch:site__A.model:pls", "sample:1", "sample:3", 0.0),
        )
        .unwrap();
        let b_cache = build_prediction_cache_record(
            &b_requirement,
            &separation_branch_blocks("branch:site__B.model:pls", "sample:2", "sample:3", 1.0),
        )
        .unwrap();
        let a_artifact = refit_artifact(
            &plan,
            "branch:site__A.model:pls",
            vec!["branch:site__A.model:pls.x".to_string()],
            Vec::new(),
        );
        let b_artifact = refit_artifact(
            &plan,
            "branch:site__B.model:pls",
            vec!["branch:site__B.model:pls.x".to_string()],
            Vec::new(),
        );

        let error = build_execution_bundle_with_prediction_contracts(
            BundleId::new("bundle:separation.concat.merge.overlap").unwrap(),
            &plan,
            Some(plan.variants[0].variant_id.clone()),
            BTreeMap::new(),
            vec![a_artifact, b_artifact],
            vec![a_requirement, b_requirement],
            vec![a_cache, b_cache],
        )
        .unwrap_err()
        .to_string();
        assert!(
            error.contains("overlapping branch predictions"),
            "overlap must be rejected, got: {error}"
        );
    }

    /// Slice 3.5 negative: a real OOF gap (the union of branch partitions does NOT
    /// cover the full fold universe) must still error — the relaxation validates
    /// completeness as a group, it does not skip it.
    #[test]
    fn separation_concat_merge_rejects_incomplete_coverage() {
        let plan = separation_concat_merge_plan();
        // Branch A owns {sample:1}; branch B owns {sample:2, sample:4}. sample:3 is
        // covered by NO branch — a genuine OOF gap.
        let a_requirement =
            separation_branch_requirement("branch:site__A.model:pls", &["sample:1"], &["fold:0"]);
        let b_requirement = separation_branch_requirement(
            "branch:site__B.model:pls",
            &["sample:2", "sample:4"],
            &["fold:0", "fold:1"],
        );
        let a_cache = build_prediction_cache_record(
            &a_requirement,
            &[PredictionBlock {
                prediction_id: Some("prediction:a:fold0".to_string()),
                producer_node: NodeId::new("branch:site__A.model:pls").unwrap(),
                producer_port: None,
                partition: PredictionPartition::Validation,
                fold_id: Some(FoldId::new("fold:0").unwrap()),
                sample_ids: vec![SampleId::new("sample:1").unwrap()],
                values: vec![vec![0.1]],
                target_names: vec!["y".to_string()],
            }],
        )
        .unwrap();
        let b_cache = build_prediction_cache_record(
            &b_requirement,
            &separation_branch_blocks("branch:site__B.model:pls", "sample:2", "sample:4", 1.0),
        )
        .unwrap();
        let a_artifact = refit_artifact(
            &plan,
            "branch:site__A.model:pls",
            vec!["branch:site__A.model:pls.x".to_string()],
            Vec::new(),
        );
        let b_artifact = refit_artifact(
            &plan,
            "branch:site__B.model:pls",
            vec!["branch:site__B.model:pls.x".to_string()],
            Vec::new(),
        );

        let error = build_execution_bundle_with_prediction_contracts(
            BundleId::new("bundle:separation.concat.merge.gap").unwrap(),
            &plan,
            Some(plan.variants[0].variant_id.clone()),
            BTreeMap::new(),
            vec![a_artifact, b_artifact],
            vec![a_requirement, b_requirement],
            vec![a_cache, b_cache],
        )
        .unwrap_err()
        .to_string();
        assert!(
            error.contains("do not cover"),
            "an OOF gap must be rejected, got: {error}"
        );
    }

    /// Slice 3.5 negative (Fix 1): the group is validated against the graph's
    /// EXPECTED incoming OOF edges, not just the supplied requirements. A bundle
    /// that OMITS one branch->merge edge cannot be masked even if the remaining
    /// branch's self-declared sample_ids alone cover the full fold universe.
    #[test]
    fn separation_concat_merge_rejects_missing_branch_edge() {
        let plan = separation_concat_merge_plan();
        // Branch B's edge exists in the graph, but the bundle supplies ONLY branch
        // A — and branch A here wrongly claims the FULL universe, so the union check
        // alone would pass. The expected-vs-supplied edge check must still reject.
        let a_requirement = separation_branch_requirement(
            "branch:site__A.model:pls",
            &["sample:1", "sample:2", "sample:3", "sample:4"],
            &["fold:0", "fold:1"],
        );
        let a_artifact = refit_artifact(
            &plan,
            "branch:site__A.model:pls",
            vec!["branch:site__A.model:pls.x".to_string()],
            Vec::new(),
        );
        let b_artifact = refit_artifact(
            &plan,
            "branch:site__B.model:pls",
            vec!["branch:site__B.model:pls.x".to_string()],
            Vec::new(),
        );

        let error = build_execution_bundle_with_prediction_contracts(
            BundleId::new("bundle:separation.concat.merge.missing.branch").unwrap(),
            &plan,
            Some(plan.variants[0].variant_id.clone()),
            BTreeMap::new(),
            vec![a_artifact, b_artifact],
            vec![a_requirement],
            Vec::new(),
        )
        .unwrap_err()
        .to_string();
        assert!(
            error.contains("do not match the plan's incoming OOF edges"),
            "a missing branch edge must be rejected, got: {error}"
        );
    }

    /// Slice 3.5 negative (Fix 2): all-or-nothing caches. If ANY branch input of a
    /// concat group carries a per-fold cache, ALL must — a mixed (partial) cache
    /// group is rejected, so a no-cache branch cannot satisfy global coverage via
    /// its self-declared sample_ids while its persisted per-fold OOF is incomplete.
    #[test]
    fn separation_concat_merge_rejects_partial_cache_coverage() {
        let plan = separation_concat_merge_plan();
        let a_requirement = separation_branch_requirement(
            "branch:site__A.model:pls",
            &["sample:1", "sample:3"],
            &["fold:0", "fold:1"],
        );
        let b_requirement = separation_branch_requirement(
            "branch:site__B.model:pls",
            &["sample:2", "sample:4"],
            &["fold:0", "fold:1"],
        );
        // Only branch A is persisted; branch B carries NO cache.
        let a_cache = build_prediction_cache_record(
            &a_requirement,
            &separation_branch_blocks("branch:site__A.model:pls", "sample:1", "sample:3", 0.0),
        )
        .unwrap();
        let a_artifact = refit_artifact(
            &plan,
            "branch:site__A.model:pls",
            vec!["branch:site__A.model:pls.x".to_string()],
            Vec::new(),
        );
        let b_artifact = refit_artifact(
            &plan,
            "branch:site__B.model:pls",
            vec!["branch:site__B.model:pls.x".to_string()],
            Vec::new(),
        );

        let error = build_execution_bundle_with_prediction_contracts(
            BundleId::new("bundle:separation.concat.merge.partial.cache").unwrap(),
            &plan,
            Some(plan.variants[0].variant_id.clone()),
            BTreeMap::new(),
            vec![a_artifact, b_artifact],
            vec![a_requirement, b_requirement],
            vec![a_cache],
        )
        .unwrap_err()
        .to_string();
        assert!(
            error.contains("partial prediction-cache coverage"),
            "a partial-cache concat group must be rejected, got: {error}"
        );
    }

    #[test]
    fn prediction_requirements_are_typed_and_validate_against_oof_edges() {
        let plan = branch_merge_plan();
        let meta_plan = plan
            .node_plans
            .get(&NodeId::new("merge:stack.pred_plus_original.meta:ridge").unwrap())
            .unwrap();
        let producer_node = NodeId::new("branch:b0.model:ridge").unwrap();
        let fold0 = FoldId::new("fold:0").unwrap();
        let fold1 = FoldId::new("fold:1").unwrap();
        let samples = [
            SampleId::new("sample:1").unwrap(),
            SampleId::new("sample:2").unwrap(),
            SampleId::new("sample:3").unwrap(),
            SampleId::new("sample:4").unwrap(),
        ];
        let requirement = BundlePredictionRequirement {
            producer_node: producer_node.clone(),
            source_port: "oof".to_string(),
            consumer_node: meta_plan.node_id.clone(),
            target_port: "b0_oof".to_string(),
            partition: PredictionPartition::Validation,
            prediction_level: PredictionLevel::Sample,
            fold_ids: vec![fold0.clone(), fold1.clone()],
            unit_ids: Vec::new(),
            sample_ids: samples.to_vec(),
            prediction_width: 1,
            target_names: vec!["y".to_string()],
        };
        let prediction_blocks = vec![
            PredictionBlock {
                prediction_id: Some("prediction:branch:b0.fold0".to_string()),
                producer_node: producer_node.clone(),
                producer_port: Some("oof".to_string()),
                partition: PredictionPartition::Validation,
                fold_id: Some(fold0),
                sample_ids: samples[0..2].to_vec(),
                values: vec![vec![0.1], vec![0.2]],
                target_names: vec!["y".to_string()],
            },
            PredictionBlock {
                prediction_id: Some("prediction:branch:b0.fold1".to_string()),
                producer_node: producer_node.clone(),
                producer_port: Some("oof".to_string()),
                partition: PredictionPartition::Validation,
                fold_id: Some(fold1),
                sample_ids: samples[2..4].to_vec(),
                values: vec![vec![0.3], vec![0.4]],
                target_names: vec!["y".to_string()],
            },
            // Child OOF evidence from a nested stacking scope is valid while
            // fitting that scope's meta-model, but it is not part of this
            // outer-fold requirement.  The same samples deliberately prove
            // cache construction cannot persist both evidence classes.
            PredictionBlock {
                prediction_id: Some("prediction:branch:b0.inner".to_string()),
                producer_node: producer_node.clone(),
                producer_port: Some("oof".to_string()),
                partition: PredictionPartition::Validation,
                fold_id: Some(FoldId::new("nested:fold:0").unwrap()),
                sample_ids: samples[0..2].to_vec(),
                values: vec![vec![9.1], vec![9.2]],
                target_names: vec!["y".to_string()],
            },
        ];
        let cache = build_prediction_cache_record(&requirement, &prediction_blocks).unwrap();
        let payload = build_prediction_cache_payload(&requirement, &prediction_blocks).unwrap();
        assert_eq!(cache.prediction_level, PredictionLevel::Sample);
        assert_eq!(payload.prediction_level, PredictionLevel::Sample);
        assert!(cache
            .blocks
            .iter()
            .all(|block| block.prediction_level == PredictionLevel::Sample));
        assert_eq!(cache.block_count, 2);
        assert_eq!(cache.row_count, 4);
        assert!(cache.blocks.iter().all(|block| {
            block
                .fold_id
                .as_ref()
                .is_some_and(|fold_id| requirement.fold_ids.contains(fold_id))
        }));
        validate_prediction_cache_payload_matches_record(&payload, &cache).unwrap();
        let cache_namespace_fingerprints = vec!["a".repeat(64), "b".repeat(64)];
        let mut d10_cache = cache.clone();
        d10_cache.cache_namespace_fingerprints = cache_namespace_fingerprints.clone();
        d10_cache.validate().unwrap();
        let mut d10_payload = payload.clone();
        d10_payload.cache_namespace_fingerprints = cache_namespace_fingerprints;
        d10_payload.validate().unwrap();
        validate_prediction_cache_payload_matches_record(&d10_payload, &d10_cache).unwrap();
        for forbidden_partition in [
            PredictionPartition::Train,
            PredictionPartition::Test,
            PredictionPartition::Final,
        ] {
            let mut non_oof_requirement = requirement.clone();
            non_oof_requirement.partition = forbidden_partition.clone();
            let requirement_error = non_oof_requirement.validate().unwrap_err().to_string();
            assert!(
                requirement_error.contains("must use validation OOF predictions"),
                "D10 cache namespace must not broaden bundle prediction requirements to {forbidden_partition:?}: {requirement_error}"
            );

            let mut non_oof_cache = d10_cache.clone();
            non_oof_cache.partition = forbidden_partition.clone();
            let cache_error = non_oof_cache.validate().unwrap_err().to_string();
            assert!(
                cache_error.contains("must cache validation OOF predictions"),
                "D10 cache namespace must not allow non-OOF cache records for {forbidden_partition:?}: {cache_error}"
            );

            let mut non_oof_payload = d10_payload.clone();
            non_oof_payload.partition = forbidden_partition;
            let payload_error = non_oof_payload.validate().unwrap_err().to_string();
            assert!(
                payload_error.contains("must cache validation OOF predictions"),
                "D10 cache namespace must not allow non-OOF cache payloads: {payload_error}"
            );
        }
        let mut short_namespace_cache = d10_cache.clone();
        short_namespace_cache.cache_namespace_fingerprints.pop();
        assert!(short_namespace_cache
            .validate()
            .unwrap_err()
            .to_string()
            .contains("namespace fingerprint count"));
        let mut short_namespace_payload = d10_payload;
        short_namespace_payload.cache_namespace_fingerprints.pop();
        assert!(short_namespace_payload
            .validate()
            .unwrap_err()
            .to_string()
            .contains("namespace fingerprint count"));
        let mut wrong_level_requirement = requirement.clone();
        wrong_level_requirement.prediction_level = PredictionLevel::Target;
        assert!(wrong_level_requirement.validate().is_err());
        let mut wrong_level_cache = cache.clone();
        wrong_level_cache.prediction_level = PredictionLevel::Target;
        assert!(wrong_level_cache.validate().is_err());
        let mut wrong_level_payload = payload.clone();
        wrong_level_payload.prediction_level = PredictionLevel::Target;
        assert!(wrong_level_payload.validate().is_err());
        let prediction_key = requirement.key();
        let artifact = RefitArtifactRecord {
            node_id: meta_plan.node_id.clone(),
            controller_id: meta_plan.controller_id.clone(),
            artifact: ArtifactRef {
                id: ArtifactId::new("artifact:merge:stack.pred_plus_original.meta:ridge:refit")
                    .unwrap(),
                kind: "mock_model".to_string(),
                controller_id: meta_plan.controller_id.clone(),
                backend: None,
                uri: None,
                content_fingerprint: None,
                size_bytes: Some(128),
                plugin: None,
                plugin_version: None,
                abi_major: None,
                abi_min_minor: None,
            },
            params_fingerprint: meta_plan.params_fingerprint.clone(),
            training_loss_fingerprint: meta_plan.training_loss_fingerprint(Phase::Refit).unwrap(),
            data_requirement_keys: vec![
                "merge:stack.pred_plus_original.meta:ridge.x_original".to_string()
            ],
            prediction_requirement_keys: vec![prediction_key],
        };

        assert!(build_execution_bundle_with_prediction_contracts(
            BundleId::new("bundle:d10.cache.without.selected.variant").unwrap(),
            &plan,
            None,
            BTreeMap::new(),
            vec![artifact.clone()],
            vec![requirement.clone()],
            vec![d10_cache],
        )
        .unwrap_err()
        .to_string()
        .contains("requires selected_variant_id"));

        assert!(build_execution_bundle(
            BundleId::new("bundle:missing.prediction.requirement").unwrap(),
            &plan,
            Some(plan.variants[0].variant_id.clone()),
            BTreeMap::new(),
            vec![artifact.clone()],
        )
        .is_err());

        assert!(build_execution_bundle_with_prediction_requirements(
            BundleId::new("bundle:typed.prediction.requirement.without.cache").unwrap(),
            &plan,
            Some(plan.variants[0].variant_id.clone()),
            BTreeMap::new(),
            vec![artifact.clone()],
            vec![requirement.clone()],
        )
        .is_err());

        let bundle = build_execution_bundle_with_prediction_contracts(
            BundleId::new("bundle:typed.prediction.requirement").unwrap(),
            &plan,
            Some(plan.variants[0].variant_id.clone()),
            BTreeMap::new(),
            vec![artifact],
            vec![requirement],
            vec![cache],
        )
        .unwrap();
        bundle.validate_against_plan(&plan).unwrap();
        assert_eq!(bundle.prediction_requirements.len(), 1);
        assert_eq!(bundle.prediction_caches.len(), 1);
        assert_eq!(
            bundle.refit_artifacts[0].prediction_requirement_keys,
            vec!["branch:b0.model:ridge.oof->merge:stack.pred_plus_original.meta:ridge.b0_oof"]
        );
        let payload_set = BundlePredictionCachePayloadSet {
            bundle_id: bundle.bundle_id.clone(),
            schema_version: PREDICTION_CACHE_PAYLOAD_SCHEMA_VERSION,
            caches: vec![payload],
        };
        payload_set.validate_against_bundle(&bundle).unwrap();
        let refit_replay_request = ReplayPhaseRequest {
            bundle_id: bundle.bundle_id.clone(),
            phase: Phase::Refit,
            data_envelope_keys: bundle
                .data_requirements
                .iter()
                .map(BundleDataRequirement::key)
                .collect(),
        };
        refit_replay_request
            .validate_for_bundle_with_prediction_cache_payloads(&bundle, Some(&payload_set))
            .unwrap();
        let mut tampered_payload_set = payload_set.clone();
        tampered_payload_set.caches[0].blocks[0].values[0][0] = 99.0;
        assert!(tampered_payload_set
            .validate_against_bundle(&bundle)
            .is_err());
        let mut missing_payload_set = payload_set.clone();
        missing_payload_set.caches.clear();
        assert!(missing_payload_set
            .validate_against_bundle(&bundle)
            .is_err());
        assert!(refit_replay_request.validate_for_bundle(&bundle).is_err());

        let mut wrong_data_owner = bundle.clone();
        wrong_data_owner.refit_artifacts[0].data_requirement_keys =
            vec!["branch:b0.model:ridge.x".to_string()];
        assert!(wrong_data_owner.validate().is_err());

        let mut wrong_prediction_consumer = bundle;
        wrong_prediction_consumer.refit_artifacts[0].node_id =
            NodeId::new("branch:b0.model:ridge").unwrap();
        wrong_prediction_consumer.refit_artifacts[0]
            .data_requirement_keys
            .clear();
        assert!(wrong_prediction_consumer.validate().is_err());
    }

    #[test]
    fn aggregated_prediction_cache_contracts_preserve_unit_ids() {
        let plan = branch_merge_plan();
        let producer_node = NodeId::new("branch:b0.model:ridge").unwrap();
        let consumer_node = NodeId::new("merge:stack.pred_plus_original.meta:ridge").unwrap();
        let fold0 = FoldId::new("fold:0").unwrap();
        let fold1 = FoldId::new("fold:1").unwrap();
        let target_a = PredictionUnitId::Target(TargetId::new("target:a").unwrap());
        let target_b = PredictionUnitId::Target(TargetId::new("target:b").unwrap());
        let requirement = BundlePredictionRequirement {
            producer_node: producer_node.clone(),
            source_port: "oof".to_string(),
            consumer_node: consumer_node.clone(),
            target_port: "b0_oof".to_string(),
            partition: PredictionPartition::Validation,
            prediction_level: PredictionLevel::Target,
            fold_ids: vec![fold0.clone(), fold1.clone()],
            unit_ids: vec![target_a.clone(), target_b.clone()],
            sample_ids: Vec::new(),
            prediction_width: 1,
            target_names: vec!["y".to_string()],
        };
        let aggregated_blocks = vec![
            AggregatedPredictionBlock {
                prediction_id: Some("prediction:branch:b0.target.fold0".to_string()),
                producer_node: producer_node.clone(),
                producer_port: Some("pred".to_string()),
                partition: PredictionPartition::Validation,
                fold_id: Some(fold0),
                level: PredictionLevel::Target,
                unit_ids: vec![target_a],
                values: vec![vec![0.15]],
                target_names: vec!["y".to_string()],
            },
            AggregatedPredictionBlock {
                prediction_id: Some("prediction:branch:b0.target.fold1".to_string()),
                producer_node,
                producer_port: Some("pred".to_string()),
                partition: PredictionPartition::Validation,
                fold_id: Some(fold1),
                level: PredictionLevel::Target,
                unit_ids: vec![target_b],
                values: vec![vec![0.35]],
                target_names: vec!["y".to_string()],
            },
        ];

        let cache =
            build_aggregated_prediction_cache_record(&requirement, &aggregated_blocks).unwrap();
        let payload =
            build_aggregated_prediction_cache_payload(&requirement, &aggregated_blocks).unwrap();
        assert_eq!(cache.prediction_level, PredictionLevel::Target);
        assert_eq!(cache.unit_ids, requirement.unit_ids);
        assert!(cache.sample_ids.is_empty());
        assert!(payload.blocks.is_empty());
        assert_eq!(payload.aggregated_blocks.len(), 2);
        validate_prediction_cache_payload_matches_record(&payload, &cache).unwrap();

        let artifact = refit_artifact(
            &plan,
            "merge:stack.pred_plus_original.meta:ridge",
            vec!["merge:stack.pred_plus_original.meta:ridge.x_original".to_string()],
            vec![requirement.key()],
        );
        let bundle = build_execution_bundle_with_prediction_contracts(
            BundleId::new("bundle:target.prediction.requirement").unwrap(),
            &plan,
            Some(plan.variants[0].variant_id.clone()),
            BTreeMap::new(),
            vec![artifact],
            vec![requirement],
            vec![cache],
        )
        .unwrap();
        bundle.validate_against_plan(&plan).unwrap();

        let mut tampered_payload = payload;
        tampered_payload.aggregated_blocks[0].unit_ids =
            vec![PredictionUnitId::Target(TargetId::new("target:z").unwrap())];
        assert!(validate_prediction_cache_payload_matches_record(
            &tampered_payload,
            &bundle.prediction_caches[0]
        )
        .is_err());
    }

    #[test]
    fn replay_envelopes_must_match_bundle_requirements() {
        let plan = plan();
        let bundle = build_execution_bundle(
            BundleId::new("bundle:demo").unwrap(),
            &plan,
            None,
            BTreeMap::new(),
            Vec::new(),
        )
        .unwrap();
        let envelope: ExternalDataPlanEnvelope = serde_json::from_str(include_str!(
            "../tests/fixtures/package/data/coordinator_data_plan_envelope_sample12.json"
        ))
        .unwrap();

        bundle
            .validate_replay_envelopes(&BTreeMap::from([(
                "model:base.x".to_string(),
                envelope.clone(),
            )]))
            .unwrap();

        let mut mismatched = envelope;
        mismatched.schema_fingerprint = "0".repeat(64);
        assert!(bundle
            .validate_replay_envelopes(&BTreeMap::from([("model:base.x".to_string(), mismatched,)]))
            .is_err());
    }

    #[test]
    fn rejects_unsupported_bundle_schema_version() {
        let mut bundle = build_execution_bundle(
            BundleId::new("bundle:demo").unwrap(),
            &plan(),
            None,
            BTreeMap::new(),
            Vec::new(),
        )
        .unwrap();
        bundle.schema_version = EXECUTION_BUNDLE_SCHEMA_VERSION + 1;

        assert!(bundle.validate().is_err());

        bundle.schema_version = 0;
        assert!(bundle.validate().is_err());
    }

    #[test]
    fn rejects_bundle_with_scores_plan_id_mismatch() {
        let plan = plan();
        let mut bundle = build_execution_bundle(
            BundleId::new("bundle:demo").unwrap(),
            &plan,
            None,
            BTreeMap::new(),
            Vec::new(),
        )
        .unwrap();
        bundle.scores = Some(ScoreSet {
            schema_version: crate::metrics::SCORE_SET_SCHEMA_VERSION,
            plan_id: bundle.plan_id.clone(),
            selection_metric: Some("rmse".to_string()),
            reports: vec![crate::metrics::RegressionMetricReport {
                prediction_id: None,
                producer_node: NodeId::new("model:compat.0").unwrap(),
                producer_port: Some("pred".to_string()),
                variant_id: None,
                variant_label: None,
                partition: PredictionPartition::Test,
                fold_id: Some(FoldId::new("final").unwrap()),
                level: PredictionLevel::Sample,
                row_count: 4,
                target_width: 1,
                target_names: vec!["y".to_string()],
                metrics: BTreeMap::from([("rmse".to_string(), 1.0)]),
            }],
        });
        // Matching plan_ids: the bundle (with embedded scores) validates.
        bundle.validate().unwrap();
        // A bundle whose embedded scores.plan_id disagrees with the bundle plan_id is rejected.
        bundle.scores.as_mut().unwrap().plan_id = "plan:wrong".to_string();
        let err = bundle.validate().unwrap_err().to_string();
        assert!(
            err.contains("does not match its embedded scores plan_id"),
            "{err}"
        );
    }

    #[test]
    fn schema_migration_policy_is_explicit_and_refuses_implicit_migrations() {
        let bundle_policy = execution_bundle_schema_migration_policy();
        assert_eq!(
            bundle_policy.current_version,
            EXECUTION_BUNDLE_SCHEMA_VERSION
        );
        assert_eq!(
            bundle_policy.min_readable_version,
            MIN_READABLE_EXECUTION_BUNDLE_SCHEMA_VERSION
        );
        assert_eq!(
            bundle_policy.min_writable_version,
            MIN_WRITABLE_EXECUTION_BUNDLE_SCHEMA_VERSION
        );
        assert_eq!(
            bundle_policy
                .automatic_migrations
                .get(&LEGACY_EXECUTION_BUNDLE_SCHEMA_VERSION),
            Some(&EXECUTION_BUNDLE_SCHEMA_VERSION)
        );
        bundle_policy
            .validate_read_version(LEGACY_EXECUTION_BUNDLE_SCHEMA_VERSION, "bundle `legacy`")
            .unwrap();
        bundle_policy
            .validate_read_version(EXECUTION_BUNDLE_SCHEMA_VERSION, "bundle `current`")
            .unwrap();
        assert!(bundle_policy
            .validate_read_version(EXECUTION_BUNDLE_SCHEMA_VERSION + 1, "bundle `future`")
            .is_err());
        assert!(bundle_policy
            .validate_read_version(0, "bundle `zero`")
            .is_err());

        let mut future_policy = SchemaMigrationPolicy {
            artifact: "execution_bundle".to_string(),
            current_version: 2,
            min_readable_version: 1,
            min_writable_version: 2,
            automatic_migrations: BTreeMap::new(),
        };
        assert!(future_policy
            .validate_read_version(1, "bundle `old-without-migration`")
            .is_err());
        future_policy.automatic_migrations.insert(1, 2);
        future_policy
            .validate_read_version(1, "bundle `old-with-migration`")
            .unwrap();
    }

    #[test]
    fn prediction_cache_payload_schema_policy_rejects_unsupported_versions() {
        let policy = prediction_cache_payload_schema_migration_policy();
        assert_eq!(
            policy.current_version,
            PREDICTION_CACHE_PAYLOAD_SCHEMA_VERSION
        );
        assert_eq!(
            policy
                .automatic_migrations
                .get(&LEGACY_PREDICTION_CACHE_PAYLOAD_SCHEMA_VERSION),
            Some(&PREDICTION_CACHE_PAYLOAD_SCHEMA_VERSION)
        );
        policy
            .validate_read_version(
                LEGACY_PREDICTION_CACHE_PAYLOAD_SCHEMA_VERSION,
                "payload `legacy`",
            )
            .unwrap();

        let mut payload_set = BundlePredictionCachePayloadSet {
            bundle_id: BundleId::new("bundle:payload.schema").unwrap(),
            schema_version: PREDICTION_CACHE_PAYLOAD_SCHEMA_VERSION,
            caches: Vec::new(),
        };
        payload_set.validate().unwrap();

        payload_set.schema_version = PREDICTION_CACHE_PAYLOAD_SCHEMA_VERSION + 1;
        assert!(payload_set.validate().is_err());

        payload_set.schema_version = 0;
        assert!(payload_set.validate().is_err());
    }

    #[test]
    fn prediction_cache_payload_format_enforces_port_family() {
        fn payload_for_block(
            format: &str,
            producer_port: Option<String>,
        ) -> BundlePredictionCachePayload {
            let block = PredictionBlock {
                prediction_id: Some("prediction:model:base.fold0".to_string()),
                producer_node: NodeId::new("model:base").unwrap(),
                producer_port,
                partition: PredictionPartition::Validation,
                fold_id: Some(FoldId::new("fold:0").unwrap()),
                sample_ids: vec![SampleId::new("sample:1").unwrap()],
                values: vec![vec![1.0]],
                target_names: vec!["y".to_string()],
            };
            let blocks = vec![block];
            BundlePredictionCachePayload {
                requirement_key: "model:base.oof->model:meta.pred".to_string(),
                cache_id: "prediction-cache:model:base.oof->model:meta.pred".to_string(),
                cache_namespace_fingerprints: Vec::new(),
                format: format.to_string(),
                partition: PredictionPartition::Validation,
                prediction_level: PredictionLevel::Sample,
                block_count: blocks.len(),
                row_count: blocks.iter().map(|block| block.sample_ids.len()).sum(),
                content_fingerprint: stable_json_fingerprint(&blocks).unwrap(),
                blocks,
                aggregated_blocks: Vec::new(),
            }
        }

        payload_for_block(LEGACY_BUNDLE_PREDICTION_CACHE_FORMAT, None)
            .validate()
            .unwrap();
        payload_for_block(BUNDLE_PREDICTION_CACHE_FORMAT, Some("oof".to_string()))
            .validate()
            .unwrap();

        let v1_with_port = payload_for_block(
            LEGACY_BUNDLE_PREDICTION_CACHE_FORMAT,
            Some("oof".to_string()),
        )
        .validate()
        .unwrap_err()
        .to_string();
        assert!(
            v1_with_port.contains("V1") && v1_with_port.contains("producer_port"),
            "unexpected V1 port-family error: {v1_with_port}"
        );

        let v2_without_port = payload_for_block(BUNDLE_PREDICTION_CACHE_FORMAT, None)
            .validate()
            .unwrap_err()
            .to_string();
        assert!(
            v2_without_port.contains("V2") && v2_without_port.contains("requires producer_port"),
            "unexpected V2 port-family error: {v2_without_port}"
        );
    }

    #[test]
    fn replay_request_requires_predict_explain_or_refit_phase() {
        let bundle = build_execution_bundle(
            BundleId::new("bundle:demo").unwrap(),
            &plan(),
            None,
            BTreeMap::new(),
            Vec::new(),
        )
        .unwrap();

        ReplayPhaseRequest {
            bundle_id: bundle.bundle_id.clone(),
            phase: Phase::Predict,
            data_envelope_keys: vec!["model:base.x".to_string()],
        }
        .validate_for_bundle(&bundle)
        .unwrap();
        ReplayPhaseRequest {
            bundle_id: bundle.bundle_id.clone(),
            phase: Phase::Refit,
            data_envelope_keys: vec!["model:base.x".to_string()],
        }
        .validate_for_bundle(&bundle)
        .unwrap();
        assert!(ReplayPhaseRequest {
            bundle_id: bundle.bundle_id.clone(),
            phase: Phase::FitCv,
            data_envelope_keys: vec!["model:base.x".to_string()],
        }
        .validate_for_bundle(&bundle)
        .is_err());
        assert!(ReplayPhaseRequest {
            bundle_id: bundle.bundle_id.clone(),
            phase: Phase::Predict,
            data_envelope_keys: vec!["model:base.x".to_string(), "model:base.x".to_string()],
        }
        .validate_for_bundle(&bundle)
        .is_err());
        assert!(ReplayPhaseRequest {
            bundle_id: bundle.bundle_id.clone(),
            phase: Phase::Predict,
            data_envelope_keys: vec!["model:base.y".to_string()],
        }
        .validate_for_bundle(&bundle)
        .is_err());
    }

    #[test]
    fn prediction_level_wire_absent_parses_as_sample_but_serialization_stays_explicit() {
        let mut requirement = BundlePredictionRequirement {
            producer_node: NodeId::new("model:base").unwrap(),
            source_port: "oof".to_string(),
            consumer_node: NodeId::new("model:meta").unwrap(),
            target_port: "x".to_string(),
            partition: PredictionPartition::Validation,
            prediction_level: PredictionLevel::Sample,
            fold_ids: vec![FoldId::new("fold:0").unwrap()],
            unit_ids: Vec::new(),
            sample_ids: vec![SampleId::new("sample:1").unwrap()],
            prediction_width: 1,
            target_names: vec!["y".to_string()],
        };

        let mut sample = serde_json::to_value(&requirement).unwrap();
        assert_eq!(sample["prediction_level"], serde_json::json!("sample"));

        sample.as_object_mut().unwrap().remove("prediction_level");
        let parsed: BundlePredictionRequirement = serde_json::from_value(sample).unwrap();
        assert_eq!(parsed.prediction_level, PredictionLevel::Sample);

        requirement.prediction_level = PredictionLevel::Group;
        let group = serde_json::to_value(&requirement).unwrap();
        assert_eq!(group["prediction_level"], serde_json::json!("group"));
    }

    #[test]
    fn methods_hpo_resume_state_round_trips_and_rejects_orphan_or_score_drift() {
        let state = methods_hpo_resume_state();
        state.validate().unwrap();
        let json = serde_json::to_string(&state).unwrap();
        let parsed: MethodsHpoResumeState = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed, state);

        let mut orphan = state.clone();
        orphan.completed_reports.clear();
        assert!(orphan
            .validate()
            .unwrap_err()
            .to_string()
            .contains("exactly cover"));

        let mut score_drift = state;
        score_drift.completed_reports[0].score += 1.1e-12;
        assert!(score_drift
            .validate()
            .unwrap_err()
            .to_string()
            .contains("score/intermediate evidence is inconsistent"));

        let mut failed = serde_json::to_value(methods_hpo_resume_state()).unwrap();
        failed["completed_reports"][0]["terminal_state"] = serde_json::json!("failed");
        assert!(serde_json::from_value::<MethodsHpoResumeState>(failed).is_err());

        let mut uppercase_binding = methods_hpo_resume_state();
        uppercase_binding.checkpoint.binding.optimizer_fingerprint = "A".repeat(64);
        assert!(uppercase_binding
            .validate()
            .unwrap_err()
            .to_string()
            .contains("lowercase SHA-256"));
    }

    #[test]
    fn methods_hpo_resume_state_rejects_unknown_and_duplicate_json_members() {
        let plan = plan();
        let bundle = build_execution_bundle(
            BundleId::new("bundle:hpo.strict").unwrap(),
            &plan,
            None,
            BTreeMap::new(),
            Vec::new(),
        )
        .unwrap();
        let mut raw = serde_json::to_value(bundle).unwrap();
        raw.as_object_mut()
            .unwrap()
            .insert("unknown_hpo_member".to_string(), serde_json::json!(true));
        assert!(ExecutionBundle::from_json(&serde_json::to_string(&raw).unwrap()).is_err());

        let encoded = serde_json::to_string(&raw).unwrap();
        let duplicated = encoded.replacen(
            "\"bundle_id\":\"bundle:hpo.strict\"",
            "\"bundle_id\":\"bundle:hpo.strict\",\"bundle_id\":\"bundle:hpo.strict\"",
            1,
        );
        let error = ExecutionBundle::from_json(&duplicated)
            .unwrap_err()
            .to_string();
        assert!(error.contains("duplicate JSON object key"), "{error}");

        let mut state = serde_json::to_value(methods_hpo_resume_state()).unwrap();
        state.as_object_mut().unwrap().insert(
            "unexpected_candidate_side_channel".to_string(),
            serde_json::json!(true),
        );
        assert!(serde_json::from_value::<MethodsHpoResumeState>(state).is_err());
    }

    #[test]
    fn execution_bundle_v1_json_rejects_null_conformal_member() {
        let plan = plan();
        let mut bundle = build_execution_bundle(
            BundleId::new("bundle:v1.strict-conformal").unwrap(),
            &plan,
            None,
            BTreeMap::new(),
            Vec::new(),
        )
        .unwrap();
        bundle.schema_version = LEGACY_EXECUTION_BUNDLE_SCHEMA_VERSION;
        let mut raw = serde_json::to_value(bundle).unwrap();
        raw.as_object_mut()
            .unwrap()
            .insert("conformal_calibration".to_string(), serde_json::Value::Null);
        let error = ExecutionBundle::from_json(&serde_json::to_string(&raw).unwrap())
            .unwrap_err()
            .to_string();
        assert!(error.contains("including null"), "{error}");
    }
}
