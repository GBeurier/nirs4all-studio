//! Native training orchestration outcome and common runtime entry point.
//!
//! The portable contracts in this module use Typed Canonical Value v1 (TCV1).
//! Historical graph, plan, controller, parameter, and bundle fingerprints keep
//! their pre-existing algorithms.

use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::aggregation::{AggregatedPredictionBlock, ObservationPredictionBlock, PredictionUnitId};
#[cfg(feature = "methods-optimizer")]
use crate::bundle::MethodsHpoResumeSelection;
use crate::bundle::{
    build_aggregated_prediction_cache_payload, build_aggregated_prediction_cache_record,
    build_execution_bundle_with_prediction_contracts, build_prediction_cache_payload,
    build_prediction_cache_record, validate_prediction_cache_payload_matches_record,
    BundlePredictionCachePayload, BundlePredictionCachePayloadSet, BundlePredictionCacheRecord,
    BundlePredictionRequirement, ExecutionBundle, MethodsHpoResumeState, RefitArtifactRecord,
    EXECUTION_BUNDLE_SCHEMA_VERSION, LEGACY_EXECUTION_BUNDLE_SCHEMA_VERSION,
    LEGACY_PREDICTION_CACHE_PAYLOAD_SCHEMA_VERSION, PREDICTION_CACHE_PAYLOAD_SCHEMA_VERSION,
};
use crate::campaign::stable_json_fingerprint;
use crate::canonical::parse_typed_json;
use crate::conformal_runtime::ConformalCalibration;
use crate::controller::{ControllerCapability, ControllerFitScope};
use crate::data::data_binding_requirement_key;
use crate::error::{DagMlError, Result};
use crate::fold::fold_set_fingerprint;
use crate::graph::{NodeKind, PortKind};
use crate::hpo::{methods_optimizer_preflight, MethodsHpoStudyConfig};
use crate::ids::{ArtifactId, BundleId, FoldId, LineageId, NodeId, RunId, SampleId, VariantId};
use crate::metrics::{
    RegressionMetricKind, ScoreSet, LEGACY_SCORE_SET_SCHEMA_VERSION, SCORE_SET_SCHEMA_VERSION,
};
use crate::oof::{PredictionBlock, PredictionPartition};
use crate::phase::Phase;
use crate::plan::ExecutionPlan;
use crate::policy::PredictionLevel;
#[cfg(feature = "methods-optimizer")]
use crate::replay::methods_hpo_resume_state_from_package_json;
use crate::replay::{replay_request_from_outcome, TrainingReplayOutcome};
use crate::runtime::{
    is_nested_stacking_meta_node, nested_stacking_campaign_plan, plan_oof_partition_mode,
    select_best_variant_outcome_by_cv_for_target, InMemoryArtifactStore, LineageRecord, NodeResult,
    ParallelScheduler, RunContext, RuntimeControllerRegistry, RuntimeDataProvider,
    SequentialScheduler, VariantExecutionSpec,
};
#[cfg(feature = "methods-optimizer")]
use crate::runtime::{
    RuntimeHpoExecutionContext, RuntimeHpoProvenance, RuntimeHpoSelectionTarget, VariantSelection,
    VariantSelectionOutcome,
};
use crate::selection::{
    select_candidate, EvaluationScope, RefitStrategy, SelectionDecision, SelectionMetric,
    SelectionPolicy,
};
use crate::training::{
    contains_runtime_handle, ArtifactLoadMode, CacheNamespace, CvArtifactRetention,
    FittedArtifactMode, OutputBinding, PackageArtifactBinding, ParameterNamespace, ParameterPatch,
    PortablePredictorPackage, PortableRefitProvenance, PortableRefitRecipe,
    PredictionCacheRetention, PredictionKind, PredictionSource, PredictorTemplate,
    ResolvedTrainingOutput, TrainingContractProjection, TrainingDataIdentity,
    TrainingInfluenceKind, TrainingInfluenceManifest, TrainingOutcomeRef, TrainingRequest,
    TrainingSchedulerBackend, TrainingSchedulerKind, OUTPUT_BINDING_SCHEMA_VERSION,
    PARAMETER_PATCH_SCHEMA_VERSION, PORTABLE_PREDICTOR_PACKAGE_SCHEMA_VERSION,
};

pub const TRAINING_OUTCOME_SCHEMA_VERSION: u32 = 2;
pub const LEGACY_TRAINING_OUTCOME_SCHEMA_VERSION: u32 = 1;
pub const MIN_READABLE_TRAINING_OUTCOME_SCHEMA_VERSION: u32 = 1;
pub const BOUND_TRAINING_OUTPUT_SCHEMA_VERSION: u32 = 2;
pub const TRAINING_OUTCOME_SCHEMA_ID: &str =
    "https://github.com/GBeurier/dag-ml/schemas/training_outcome.v2.schema.json";
/// V3 is a new refit-child family, not a readable variant of `TrainingOutcome`
/// or `PortablePredictorPackage` V1/V2.
pub const PORTABLE_REFIT_OUTCOME_V3_SCHEMA_VERSION: u32 = 3;
pub const PORTABLE_REFIT_EXECUTION_BUNDLE_V3_SCHEMA_VERSION: u32 = 3;
pub const PORTABLE_REFIT_PACKAGE_V3_SCHEMA_VERSION: u32 = 3;

/// One resolved output binding and the actual portable blocks it selected.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BoundTrainingOutput {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub schema_version: Option<u32>,
    pub binding: OutputBinding,
    pub predictions: Vec<PredictionBlock>,
    pub observation_predictions: Vec<ObservationPredictionBlock>,
    pub aggregated_predictions: Vec<AggregatedPredictionBlock>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TrainingRefitStatus {
    Completed,
    Skipped,
}

/// Exact W0 refit state embedded in [`TrainingOutcome`].
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TrainingRefitOutcome {
    pub requested: bool,
    pub status: TrainingRefitStatus,
    pub strategy: Option<RefitStrategy>,
}

/// Portable result of COMPILE/PLAN/FIT_CV/SELECT and optional REFIT.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TrainingOutcome {
    pub schema_version: u32,
    pub outcome_id: String,
    pub run_id: RunId,
    pub training_request_fingerprint: String,
    pub data_identities: Vec<TrainingDataIdentity>,
    pub selection_output_id: String,
    pub effective_plan: ExecutionPlan,
    pub effective_plan_fingerprint: String,
    pub selected_variant_id: VariantId,
    pub selected_variant_fingerprint: String,
    pub parameter_patches: Vec<ParameterPatch>,
    pub refit: TrainingRefitOutcome,
    pub score_set: ScoreSet,
    pub outputs: Vec<BoundTrainingOutput>,
    pub lineage: Vec<LineageRecord>,
    pub portable_prediction_caches: Option<BundlePredictionCachePayloadSet>,
    pub training_influence: TrainingInfluenceManifest,
    pub execution_bundle: ExecutionBundle,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub conformal_calibration: Option<ConformalCalibration>,
    /// Complete pre-calibration replay evidence. V2 calibration attachment
    /// retains this beside the derived quantiles so a loaded package can
    /// independently revalidate the replay/source/sample closure.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub conformal_calibration_replay: Option<TrainingReplayOutcome>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub methods_hpo_resume_state: Option<MethodsHpoResumeState>,
    pub replayable_phases: Vec<Phase>,
    pub warnings: Vec<String>,
    pub diagnostics: BTreeMap<String, serde_json::Value>,
    pub outcome_fingerprint: String,
}

/// Host-owned resources and portable identifiers for one native training run.
///
/// The operation deliberately accepts controllers and data through the same
/// runtime abstractions as ordinary phase execution. It never invokes a
/// controller directly and never implements a second fold/node loop.
pub struct TrainingExecutionInput<'a> {
    pub request: &'a TrainingRequest,
    pub outcome_id: String,
    pub run_id: RunId,
    pub bundle_id: BundleId,
    pub controllers: &'a RuntimeControllerRegistry,
    pub data_provider: &'a dyn RuntimeDataProvider,
    pub relations: &'a crate::relation::SampleRelationSet,
    pub training_influence: &'a TrainingInfluenceManifest,
    pub artifact_store: &'a mut InMemoryArtifactStore,
    pub warnings: Vec<String>,
    pub diagnostics: BTreeMap<String, serde_json::Value>,
}

/// Training-owned state for a native Methods HPO invocation.
///
/// This object is deliberately constructed by [`execute_training`] and never
/// stored in [`RuntimeControllerRegistry`].  A Methods `Context`/`Optimizer`
/// is thread-affine, while the registry is long-lived and `Send + Sync`.  The
/// context therefore gives the eventual native session the exact invocation
/// evidence it is allowed to use without making any of it controller-global.
///
/// Native HPO is a typed campaign operation in `CampaignSpec.metadata`, bound
/// to a target model and a registered controller. It is intentionally outside
/// the predictor graph: candidate model tasks remain ordinary scheduler work.
struct HpoExecutionContext<'a> {
    request: &'a TrainingRequest,
    projection: &'a TrainingContractProjection,
    controllers: &'a RuntimeControllerRegistry,
    data_provider: &'a dyn RuntimeDataProvider,
    relations: &'a crate::relation::SampleRelationSet,
    training_influence: &'a TrainingInfluenceManifest,
    selection: &'a SelectionPolicy,
}

#[cfg(feature = "methods-optimizer")]
impl HpoExecutionContext<'_> {
    /// Assemble the explicit, attested scheduler contract for one native HPO
    /// campaign.  This is deliberately the only route from training into an
    /// execution-local tuner session: no native study is created or restored
    /// by training itself.
    fn runtime_context(
        &self,
        descriptor: &PortableMethodsHpoDescriptor,
        selection_metric: RegressionMetricKind,
        producer: &NodeId,
        producer_port: &str,
    ) -> Result<(RuntimeHpoExecutionContext, Option<MethodsHpoResumeState>)> {
        if self.projection.plan.variants.len() != 1 {
            return Err(DagMlError::RuntimeValidation(
                "native Methods HPO v1 requires a single unexpanded base variant".to_string(),
            ));
        }
        let controller_id = crate::ControllerId::new(descriptor.study.controller_id.clone())
            .map_err(|error| {
                DagMlError::RuntimeValidation(format!(
                    "native Methods HPO has an invalid controller id: {error}"
                ))
            })?;
        let provenance = RuntimeHpoProvenance {
            graph_fingerprint: self.projection.plan.graph_fingerprint.clone(),
            campaign_fingerprint: crate::hpo::campaign_provenance_fingerprint(
                &self.projection.plan.campaign,
            )?,
            controller_fingerprint: self.projection.plan.controller_fingerprint.clone(),
            data_identities_fingerprint: tcv1_fingerprint(
                &self.request.data_identities,
                "native Methods HPO data identities",
            )?,
            fold_set_fingerprint: self
                .projection
                .plan
                .fold_set
                .as_ref()
                .map(stable_json_fingerprint)
                .transpose()?,
            training_influence_fingerprint: self.training_influence.manifest_fingerprint.clone(),
            relation_fingerprint: self.relations.fingerprint()?,
        };
        let resume_state = descriptor
            .resume_package_json
            .as_deref()
            .map(methods_hpo_resume_state_from_package_json)
            .transpose()?;
        if let Some(state) = &resume_state {
            validate_methods_hpo_resume_state(
                state,
                &self.projection.plan,
                descriptor.operation_id.as_str(),
                &controller_id,
                descriptor,
                self.selection.id.as_str(),
                selection_metric,
                producer,
                producer_port,
                &provenance,
            )?;
        }
        Ok((
            RuntimeHpoExecutionContext {
                operation_id: descriptor.operation_id.clone(),
                controller_id,
                target_node_id: descriptor.target_node_id.clone(),
                base_variant: self.projection.plan.variants[0].clone(),
                // This is the global optimizer budget, including trials held
                // only in the opaque restored checkpoint (failed/pruned
                // trials have no selectable proposal evidence). The scheduler
                // owns the typed history-count query and derives remaining
                // work; training must never subtract completed candidates.
                trial_budget_total: descriptor.trials,
                study: descriptor.study.clone(),
                parameter_paths: descriptor.parameter_paths.clone(),
                resume_checkpoint: resume_state.as_ref().map(|state| state.checkpoint.clone()),
                resume_variants: resume_state
                    .as_ref()
                    .map(|state| {
                        state
                            .completed_proposals
                            .iter()
                            .map(|proposal| {
                                (proposal.trial_id, proposal.variant.variant_id.clone())
                            })
                            .collect()
                    })
                    .unwrap_or_default(),
                resume_terminal_trials: resume_state
                    .as_ref()
                    .map(|state| {
                        state
                            .terminal_trials
                            .iter()
                            .map(|evidence| crate::runtime::RuntimeHpoTerminalSnapshot {
                                trial: evidence.trial.clone(),
                                variant_id: evidence.variant_id.clone(),
                            })
                            .collect()
                    })
                    .unwrap_or_default(),
                selection: RuntimeHpoSelectionTarget {
                    producer_node: producer.clone(),
                    producer_port: producer_port.to_string(),
                    metric: selection_metric,
                    direction: match self.selection.metric.objective {
                        crate::selection::MetricObjective::Minimize => {
                            crate::hpo::HpoDirection::Minimize
                        }
                        crate::selection::MetricObjective::Maximize => {
                            crate::hpo::HpoDirection::Maximize
                        }
                    },
                },
                provenance,
            },
            resume_state,
        ))
    }

    /// Select once from the scheduler's completed candidate evidence.  Native
    /// optimizer state has already been terminalized by the session; this
    /// method only makes the normal DAG-ML selection decision and retains the
    /// report-grade OOF evidence it was based on.
    fn selection_from_campaign(
        &self,
        context: &RuntimeHpoExecutionContext,
        previous_resume_state: Option<MethodsHpoResumeState>,
        campaign: crate::runtime::RuntimeHpoCampaignResult,
    ) -> Result<(
        ExecutionPlan,
        VariantSelectionOutcome,
        MethodsHpoResumeState,
    )> {
        if campaign.operation_id != context.operation_id
            || campaign.controller_id != context.controller_id
            || campaign.target_node_id != context.target_node_id
        {
            return Err(DagMlError::RuntimeValidation(
                "native Methods HPO campaign operation identity mismatch".to_string(),
            ));
        }
        if campaign.checkpoint.provenance != context.provenance {
            return Err(DagMlError::RuntimeValidation(
                "native Methods HPO campaign checkpoint provenance does not match attested training evidence"
                    .to_string(),
            ));
        }
        let resume_selection = MethodsHpoResumeSelection {
            selection_id: self.selection.id.clone(),
            target_node_id: context.target_node_id.clone(),
            producer_port: context.selection.producer_port.clone(),
            metric: context.selection.metric.name().to_string(),
        };
        // Native checkpoint/history evidence is cumulative, whereas the
        // scheduler intentionally returns proposal/report/candidate evidence
        // only for this invocation. Join both halves before enforcing exact
        // completed-trial coverage; the constructor retains the strict final
        // validation and rejects incompatible or non-prefix prior state.
        let resume_state = MethodsHpoResumeState::from_runtime_checkpoint_with_previous(
            campaign.checkpoint.clone(),
            resume_selection,
            campaign.candidates.clone(),
            campaign.incumbent.clone(),
            campaign.terminal_trials.clone(),
            previous_resume_state,
        )?;
        let mut variants = resume_state
            .completed_proposals
            .iter()
            .map(|proposal| proposal.variant.clone())
            .collect::<Vec<_>>();
        variants.sort_by(|left, right| left.variant_id.cmp(&right.variant_id));
        if variants.is_empty() {
            return Err(DagMlError::RuntimeValidation(
                "native Methods HPO campaign completed no selectable candidates".to_string(),
            ));
        }
        let mut candidate_scores = resume_state
            .completed_reports
            .iter()
            .map(|completed| {
                completed
                    .report
                    .clone()
                    .into_candidate_score(completed.variant_id.as_str())
            })
            .collect::<Result<Vec<_>>>()?;
        candidate_scores.sort_by(|left, right| left.candidate_id.cmp(&right.candidate_id));
        if candidate_scores.len() != variants.len()
            || candidate_scores
                .iter()
                .map(|candidate| candidate.candidate_id.as_str())
                .collect::<BTreeSet<_>>()
                != variants
                    .iter()
                    .map(|variant| variant.variant_id.as_str())
                    .collect::<BTreeSet<_>>()
        {
            return Err(DagMlError::RuntimeValidation(
                "native Methods HPO completed reports do not exactly cover scheduler candidate variants"
                    .to_string(),
            ));
        }
        let decision = select_candidate(self.selection, &candidate_scores)?;
        let selected_variant_id =
            VariantId::new(decision.selected_candidate_id.clone()).map_err(|error| {
                DagMlError::RuntimeValidation(format!(
                    "native Methods HPO selected invalid candidate variant: {error}"
                ))
            })?;
        let incumbent = &resume_state.incumbent;
        if incumbent.metric != self.selection.metric.name
            || incumbent.direction
                != match self.selection.metric.objective {
                    crate::selection::MetricObjective::Minimize => {
                        crate::hpo::HpoDirection::Minimize
                    }
                    crate::selection::MetricObjective::Maximize => {
                        crate::hpo::HpoDirection::Maximize
                    }
                }
            || incumbent.variant_id != selected_variant_id
        {
            return Err(DagMlError::RuntimeValidation(
                "native Methods HPO incumbent does not exactly match DAG-ML selection metric, direction, and variant"
                    .to_string(),
            ));
        }
        let incumbent_report = resume_state
            .completed_reports
            .iter()
            .find(|report| report.trial_id == incumbent.trial_id)
            .ok_or_else(|| {
                DagMlError::RuntimeValidation(
                    "native Methods HPO incumbent has no completed scheduler report".to_string(),
                )
            })?;
        if incumbent_report.variant_id != incumbent.variant_id
            || incumbent_report.score.to_bits() != incumbent.score.to_bits()
            || candidate_scores
                .iter()
                .filter(|candidate| {
                    candidate
                        .metrics
                        .get(&self.selection.metric.name)
                        .is_some_and(|score| score.to_bits() == incumbent.score.to_bits())
                })
                .count()
                != 1
        {
            return Err(DagMlError::RuntimeValidation(
                "native Methods HPO incumbent score is tied, drifted, or not uniquely attested by scheduler evidence"
                    .to_string(),
            ));
        }
        let validation_reports = resume_state
            .completed_reports
            .iter()
            .map(|completed| completed.report.clone())
            .collect::<Vec<_>>();
        let validation_predictions = campaign
            .candidates
            .iter()
            .map(|candidate| candidate.validation_predictions.clone())
            .collect::<Vec<_>>();
        let mut plan = self.projection.plan.clone();
        plan.variants = variants;
        plan.validate()?;
        Ok((
            plan,
            VariantSelectionOutcome {
                selection: VariantSelection {
                    selected_variant_id,
                    validation_reports,
                    variant_validation_predictions: validation_predictions,
                },
                decision,
            },
            resume_state,
        ))
    }
}

#[cfg(feature = "methods-optimizer")]
#[allow(clippy::too_many_arguments)]
fn validate_methods_hpo_resume_state(
    state: &MethodsHpoResumeState,
    plan: &ExecutionPlan,
    operation_id: &str,
    controller_id: &crate::ControllerId,
    descriptor: &PortableMethodsHpoDescriptor,
    selection_id: &str,
    selection_metric: RegressionMetricKind,
    producer: &NodeId,
    producer_port: &str,
    provenance: &RuntimeHpoProvenance,
) -> Result<()> {
    state.validate_against_plan(plan)?;
    let expected_fold = provenance.fold_set_fingerprint.as_deref().ok_or_else(|| {
        DagMlError::RuntimeValidation(
            "native Methods HPO resume requires an attested execution-plan fold set".to_string(),
        )
    })?;
    if state.operation_id != operation_id
        || state.controller_id != *controller_id
        || state.target_node_id != descriptor.target_node_id
        || state.checkpoint.binding.controller_id != descriptor.study.controller_id
        || state.checkpoint.binding.study_id != descriptor.study.study_id
        || state.provenance.graph_fingerprint != provenance.graph_fingerprint
        || state.provenance.campaign_fingerprint != provenance.campaign_fingerprint
        || state.provenance.controller_fingerprint != provenance.controller_fingerprint
        || state.provenance.data_identities_fingerprint != provenance.data_identities_fingerprint
        || state.provenance.fold_set_fingerprint != expected_fold
        || state.provenance.training_influence_fingerprint
            != provenance.training_influence_fingerprint
        || state.provenance.relation_fingerprint != provenance.relation_fingerprint
        || state.provenance.selection.selection_id != selection_id
        || state.provenance.selection.target_node_id != *producer
        || state.provenance.selection.producer_port != producer_port
        || state.provenance.selection.metric != selection_metric.name()
    {
        return Err(DagMlError::RuntimeValidation(
            "native Methods HPO resume state does not match this attested plan, data, fold, influence, or selection identity"
                .to_string(),
        ));
    }
    Ok(())
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct PortableMethodsHpoDescriptor {
    operation_id: String,
    study: MethodsHpoStudyConfig,
    trials: u32,
    /// Optional complete portable predictor package from a previous,
    /// compatible campaign. A resume is accepted only after the package's
    /// cross-links validate through the replay-owned loader; callers cannot
    /// inject a free checkpoint, report, or proposal list here.
    #[serde(default)]
    #[cfg_attr(not(feature = "methods-optimizer"), allow(dead_code))]
    resume_package_json: Option<String>,
    target_node_id: NodeId,
    /// Native parameter name -> direct model parameter key.  Nested paths are
    /// deliberately not accepted in v1: a candidate patch must remain a
    /// replayable ordinary model parameter override.
    parameter_paths: BTreeMap<String, String>,
}

impl HpoExecutionContext<'_> {
    /// Validate native-HPO ownership before any provider attestation or data
    /// view can be requested.  This is a hard preflight, not a soft fallback:
    /// an unsupported tuner must never be silently delegated to generic
    /// controller state.
    fn preflight(&self) -> Result<Option<PortableMethodsHpoDescriptor>> {
        let Some(raw) = self
            .projection
            .plan
            .campaign
            .metadata
            .get("methods_hpo_operation")
        else {
            return Ok(None);
        };
        let descriptor: PortableMethodsHpoDescriptor = serde_json::from_value(raw.clone())
            .map_err(|error| {
                DagMlError::RuntimeValidation(format!(
                    "campaign methods_hpo_operation descriptor is invalid: {error}",
                ))
            })?;
        validate_portable_methods_hpo_descriptor(&descriptor, &self.projection.plan)?;
        validate_methods_hpo_selection_alignment(&descriptor, self.selection)?;

        // Check the feature-owned native runtime before consulting controller
        // registration or any provider capability.  A portable HPO descriptor
        // must fail closed when the local Methods overlay is absent, and that
        // refusal must not be masked by unrelated host state.
        methods_optimizer_preflight().map_err(|error| {
            DagMlError::RuntimeValidation(format!(
                "native Methods HPO preflight failed before data access: {error}"
            ))
        })?;

        let controller_id = crate::ControllerId::new(descriptor.study.controller_id.clone())
            .map_err(|error| {
                DagMlError::RuntimeValidation(format!(
                    "native Methods HPO descriptor has invalid controller id: {error}"
                ))
            })?;
        if self.controllers.get(&controller_id).is_none() {
            return Err(DagMlError::RuntimeValidation(format!(
                "native Methods HPO campaign controller `{controller_id}` is not registered",
            )));
        }

        let target = self
            .projection
            .plan
            .node_plans
            .get(&descriptor.target_node_id)
            .expect("portable Methods HPO descriptor target was validated");
        if target.controller_id.as_str() != crate::hpo::METHODS_PLS_CONTROLLER_ID {
            return Err(DagMlError::RuntimeValidation(format!(
                "native Methods HPO target `{}` must resolve to `{}`; host/plugin model controllers are refused",
                descriptor.target_node_id,
                crate::hpo::METHODS_PLS_CONTROLLER_ID,
            )));
        }
        if self.request.options.scheduler.kind != TrainingSchedulerKind::Sequential {
            return Err(DagMlError::RuntimeValidation(
                "native Methods HPO v1 requires the sequential scheduler because its approved provider numerical view is not Sync".to_string(),
            ));
        }
        self.data_provider.methods_pls_capability()?;

        // Keep all borrowed execution evidence live in this local context.
        // These accesses make the ownership relationship explicit and prevent
        // accidental construction from detached controller state.
        let _ = (
            self.request.request_id.as_str(),
            self.controllers,
            self.data_provider,
            self.relations,
            self.training_influence,
            self.selection.id.as_str(),
        );
        Ok(Some(descriptor))
    }
}

fn validate_portable_methods_hpo_descriptor(
    descriptor: &PortableMethodsHpoDescriptor,
    plan: &ExecutionPlan,
) -> Result<()> {
    if descriptor.trials == 0 {
        return Err(DagMlError::RuntimeValidation(
            "native Methods HPO descriptor trials must be positive".to_string(),
        ));
    }
    if descriptor.operation_id.trim().is_empty() {
        return Err(DagMlError::RuntimeValidation(
            "native Methods HPO operation_id must be non-empty".to_string(),
        ));
    }
    descriptor.study.search_space.validate().map_err(|error| {
        DagMlError::RuntimeValidation(format!(
            "native Methods HPO search space is invalid: {error}"
        ))
    })?;
    let target = plan
        .node_plans
        .get(&descriptor.target_node_id)
        .ok_or_else(|| {
            DagMlError::RuntimeValidation(format!(
                "native Methods HPO target model `{}` is absent from the execution plan",
                descriptor.target_node_id
            ))
        })?;
    if target.kind != NodeKind::Model {
        return Err(DagMlError::RuntimeValidation(format!(
            "native Methods HPO target `{}` must be a model node",
            descriptor.target_node_id
        )));
    }
    let graph_node = plan
        .graph_plan
        .graph
        .nodes
        .iter()
        .find(|node| node.id == descriptor.target_node_id)
        .ok_or_else(|| {
            DagMlError::RuntimeValidation(format!(
                "native Methods HPO target `{}` is absent from the graph",
                descriptor.target_node_id
            ))
        })?;
    let portable_pls = graph_node
        .operator
        .as_ref()
        .and_then(serde_json::Value::as_str)
        .is_some_and(|operator| operator.eq_ignore_ascii_case("pls"));
    if !portable_pls {
        return Err(DagMlError::RuntimeValidation(format!(
            "native Methods HPO v1 supports only a portable `pls` target; `{}` is not one",
            descriptor.target_node_id
        )));
    }
    // This is an intentionally narrow portable projection.  The Methods PLS
    // controller and its execution-local tuner session can attest only the
    // direct `n_components` model parameter today; accepting an arbitrary
    // native search space here would create variants whose parameter effects
    // cannot be proven in the normal scheduler task/lineage path.
    let [crate::hpo::HpoParameter::Int {
        name,
        low,
        high,
        step,
        log,
    }] = descriptor.study.search_space.parameters.as_slice()
    else {
        return Err(DagMlError::RuntimeValidation(
            "native Methods HPO v1 supports exactly one integer `n_components` search parameter"
                .to_string(),
        ));
    };
    if name != "n_components" || *low != 1 || *high != 3 || *step != 1 || *log {
        return Err(DagMlError::RuntimeValidation(
            "native Methods HPO v1 requires active `n_components` integer bounds 1..=3, step=1, log=false"
                .to_string(),
        ));
    }
    if descriptor.parameter_paths
        != BTreeMap::from([("n_components".to_string(), "n_components".to_string())])
    {
        return Err(DagMlError::RuntimeValidation(
            "native Methods HPO v1 requires parameter_paths {`n_components`: `n_components`}"
                .to_string(),
        ));
    }
    Ok(())
}

fn validate_methods_hpo_selection_alignment(
    descriptor: &PortableMethodsHpoDescriptor,
    selection: &SelectionPolicy,
) -> Result<()> {
    let expected_metric = match selection.metric.name.as_str() {
        "rmse" => crate::hpo::HpoMetric::Rmse,
        "mse" => crate::hpo::HpoMetric::Mse,
        "mae" => crate::hpo::HpoMetric::Mae,
        "r2" => crate::hpo::HpoMetric::R2,
        "accuracy" => crate::hpo::HpoMetric::Accuracy,
        "balanced_accuracy" => crate::hpo::HpoMetric::BalancedAccuracy,
        other => {
            return Err(DagMlError::RuntimeValidation(format!(
                "native Methods HPO cannot align unsupported selection metric `{other}`"
            )))
        }
    };
    if descriptor.study.optimizer.metric != expected_metric {
        return Err(DagMlError::RuntimeValidation(format!(
            "native Methods HPO metric {:?} disagrees with selection metric `{}`",
            descriptor.study.optimizer.metric, selection.metric.name
        )));
    }
    let expected_direction = match selection.metric.objective {
        crate::selection::MetricObjective::Minimize => crate::hpo::HpoDirection::Minimize,
        crate::selection::MetricObjective::Maximize => crate::hpo::HpoDirection::Maximize,
    };
    if !matches!(
        descriptor.study.optimizer.direction,
        crate::hpo::HpoDirection::Auto
    ) && descriptor.study.optimizer.direction != expected_direction
    {
        return Err(DagMlError::RuntimeValidation(format!(
            "native Methods HPO direction {:?} disagrees with selection objective {:?}",
            descriptor.study.optimizer.direction, selection.metric.objective
        )));
    }
    Ok(())
}

#[derive(Clone, Debug)]
enum NativeTrainingScheduler {
    Sequential(SequentialScheduler),
    Parallel(ParallelScheduler),
}

impl NativeTrainingScheduler {
    fn from_request(request: &TrainingRequest) -> Result<Self> {
        let options = &request.options.scheduler;
        if options.backend == Some(TrainingSchedulerBackend::Processes) {
            return Err(DagMlError::RuntimeValidation(
                "native training does not yet implement the processes scheduler backend"
                    .to_string(),
            ));
        }
        match options.kind {
            TrainingSchedulerKind::Sequential => Ok(Self::Sequential(SequentialScheduler)),
            TrainingSchedulerKind::Parallel => Ok(Self::Parallel(ParallelScheduler::new(
                usize::try_from(options.workers).map_err(|_| {
                    DagMlError::RuntimeValidation(
                        "training scheduler worker count does not fit usize".to_string(),
                    )
                })?,
            )?)),
        }
    }

    fn fit_cv(
        &self,
        plan: &ExecutionPlan,
        controllers: &RuntimeControllerRegistry,
        data_provider: &dyn RuntimeDataProvider,
        ctx: &mut RunContext,
    ) -> Result<Vec<NodeResult>> {
        // Register target/group aggregation before executing the folds.  The runtime applies this
        // only after the raw sample OOF rows have been reassembled, so an aggregate unit is never
        // accidentally reduced one fold at a time.
        ctx.configure_global_oof_aggregation(plan, data_provider)?;
        match self {
            Self::Sequential(scheduler) => scheduler.execute_campaign_phase_with_data_provider(
                plan,
                controllers,
                data_provider,
                ctx,
                Phase::FitCv,
            ),
            Self::Parallel(scheduler) => scheduler.execute_campaign_phase_with_data_provider(
                plan,
                controllers,
                data_provider,
                ctx,
                Phase::FitCv,
            ),
        }
    }

    fn refit(
        &self,
        plan: &ExecutionPlan,
        controllers: &RuntimeControllerRegistry,
        data_provider: &dyn RuntimeDataProvider,
        artifact_store: &mut InMemoryArtifactStore,
        ctx: &mut RunContext,
    ) -> Result<Vec<NodeResult>> {
        match self {
            Self::Sequential(scheduler) => scheduler
                .execute_campaign_phase_with_data_provider_and_artifact_store(
                    plan,
                    controllers,
                    data_provider,
                    artifact_store,
                    ctx,
                    Phase::Refit,
                ),
            Self::Parallel(scheduler) => scheduler
                .execute_campaign_phase_with_data_provider_and_artifact_store(
                    plan,
                    controllers,
                    data_provider,
                    artifact_store,
                    ctx,
                    Phase::Refit,
                ),
        }
    }
}

/// Target-bound input for the scheduler-owned full-refit half of Package V3.
/// This is deliberately not a replay request: it accepts a new training
/// cohort attestation and never touches a source execution bundle, source
/// scores, source predictions, or source artifacts.
pub struct PortableFullRefitExecutionInput<'a> {
    pub recipe: &'a PortableRefitRecipe,
    pub source_package: &'a PortablePredictorPackage,
    pub target_plan: &'a ExecutionPlan,
    pub target_training_request: &'a TrainingRequest,
    pub target_training_request_fingerprint: String,
    pub target_data_identities: &'a [TrainingDataIdentity],
    pub target_training_influence: &'a TrainingInfluenceManifest,
    pub run_id: RunId,
    pub controllers: &'a RuntimeControllerRegistry,
    pub data_provider: &'a dyn RuntimeDataProvider,
}

/// Refit-only child execution bundle for Package V3.
///
/// Unlike [`ExecutionBundle`], this contract cannot carry a prior selection,
/// CV score, OOF cache, calibration state, or process-local handle.  Its only
/// durable payloads are the artifacts produced by the newly requested REFIT.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PortableRefitExecutionBundleV3 {
    pub schema_version: u32,
    pub bundle_id: BundleId,
    pub effective_plan_fingerprint: String,
    pub selected_variant_id: VariantId,
    pub refit_artifacts: Vec<RefitArtifactRecord>,
    pub raw_artifact_payloads: BTreeMap<ArtifactId, Vec<u8>>,
    pub bundle_fingerprint: String,
}

impl PortableRefitExecutionBundleV3 {
    pub fn compute_fingerprint(&self) -> Result<String> {
        tcv1_fingerprint_without(
            self,
            "bundle_fingerprint",
            "portable refit execution bundle V3",
        )
    }

    pub fn validate(
        &self,
        recipe: &PortableRefitRecipe,
        effective_plan: &ExecutionPlan,
    ) -> Result<()> {
        if self.schema_version != PORTABLE_REFIT_EXECUTION_BUNDLE_V3_SCHEMA_VERSION {
            return contract_error(format!(
                "portable refit execution bundle V3 has unsupported schema_version {}; expected {}",
                self.schema_version, PORTABLE_REFIT_EXECUTION_BUNDLE_V3_SCHEMA_VERSION
            ));
        }
        BundleId::new(self.bundle_id.as_str().to_string()).map_err(|error| {
            DagMlError::RuntimeValidation(format!(
                "portable refit execution bundle id is not portable: {error}"
            ))
        })?;
        recipe.validate()?;
        effective_plan.validate()?;
        validate_sha256(
            "portable refit execution bundle plan",
            &self.effective_plan_fingerprint,
        )?;
        validate_sha256("portable refit execution bundle", &self.bundle_fingerprint)?;
        if self.effective_plan_fingerprint
            != tcv1_fingerprint(effective_plan, "portable refit execution bundle plan")?
        {
            return contract_error(
                "portable refit execution bundle does not exactly bind its effective plan"
                    .to_string(),
            );
        }
        validate_portable_refit_target_plan(recipe, effective_plan)?;
        if self.selected_variant_id != recipe.selected_variant_id {
            return contract_error(
                "portable refit execution bundle selected variant does not match recipe"
                    .to_string(),
            );
        }
        if self.refit_artifacts.is_empty()
            || !self.refit_artifacts.windows(2).all(|pair| {
                (pair[0].node_id.clone(), pair[0].artifact.id.clone())
                    < (pair[1].node_id.clone(), pair[1].artifact.id.clone())
            })
        {
            return contract_error(
                "portable refit execution bundle artifacts must be non-empty and strictly sorted by node and artifact"
                    .to_string(),
            );
        }
        let expected_artifact_ids = self
            .refit_artifacts
            .iter()
            .map(|record| record.artifact.id.clone())
            .collect::<BTreeSet<_>>();
        if expected_artifact_ids.len() != self.refit_artifacts.len()
            || expected_artifact_ids.len() != self.raw_artifact_payloads.len()
            || expected_artifact_ids != self.raw_artifact_payloads.keys().cloned().collect()
        {
            return contract_error(
                "portable refit execution bundle raw artifacts do not exactly cover refit records"
                    .to_string(),
            );
        }
        for record in &self.refit_artifacts {
            record.validate()?;
            record.artifact.validate_portable()?;
            let node = effective_plan
                .node_plans
                .get(&record.node_id)
                .ok_or_else(|| {
                    DagMlError::RuntimeValidation(format!(
                        "portable refit artifact `{}` references node absent from effective plan",
                        record.artifact.id
                    ))
                })?;
            if node.controller_id != record.controller_id
                || node.controller_id != record.artifact.controller_id
            {
                return contract_error(format!(
                    "portable refit artifact `{}` controller does not match effective plan",
                    record.artifact.id
                ));
            }
            if !recipe.controllers.iter().any(|controller| {
                controller.node_id == record.node_id
                    && controller.controller_id == record.controller_id
            }) {
                return contract_error(format!(
                    "portable refit artifact `{}` is not owned by a recipe controller",
                    record.artifact.id
                ));
            }
            let payload = self
                .raw_artifact_payloads
                .get(&record.artifact.id)
                .ok_or_else(|| {
                    DagMlError::RuntimeValidation(format!(
                        "portable refit artifact `{}` has no detached raw payload",
                        record.artifact.id
                    ))
                })?;
            if payload.is_empty() {
                return contract_error(format!(
                    "portable refit artifact `{}` has an empty raw payload",
                    record.artifact.id
                ));
            }
            if record.artifact.size_bytes != Some(payload.len() as u64)
                || record.artifact.content_fingerprint.as_deref()
                    != Some(format!("{:x}", Sha256::digest(payload)).as_str())
            {
                return contract_error(format!(
                    "portable refit artifact `{}` raw payload does not match its durable descriptor",
                    record.artifact.id
                ));
            }
        }
        if self.bundle_fingerprint != self.compute_fingerprint()? {
            return contract_error(
                "portable refit execution bundle fingerprint does not match TCV1 content"
                    .to_string(),
            );
        }
        Ok(())
    }

    /// Recreate the scheduler's internal bundle shape for a V3 PREDICT or
    /// EXPLAIN invocation.  This projection is deliberately process-local:
    /// it is derived anew from the V3 child and is never persisted as a V2
    /// `ExecutionBundle` or exposed through a V1/V2 package reader.
    pub fn to_runtime_replay_bundle(
        &self,
        recipe: &PortableRefitRecipe,
        effective_plan: &ExecutionPlan,
    ) -> Result<ExecutionBundle> {
        self.validate(recipe, effective_plan)?;
        let mut bundle = build_execution_bundle_with_prediction_contracts(
            self.bundle_id.clone(),
            effective_plan,
            Some(self.selected_variant_id.clone()),
            BTreeMap::new(),
            self.refit_artifacts.clone(),
            Vec::new(),
            Vec::new(),
        )?;
        bundle.raw_artifact_payloads = self.raw_artifact_payloads.clone();
        // Validate the concrete runtime projection against the V3 plan.  This
        // is an execution-only conversion; it cannot serialize the result.
        bundle.validate_against_plan(effective_plan)?;
        Ok(bundle)
    }
}

/// A new V3 training outcome produced by a target-bound full refit.
///
/// It deliberately omits selection reports, OOF predictions, source lineage,
/// and conformal state.  Those prove the parent selection, not the new cohort.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PortableRefitOutcomeV3 {
    pub schema_version: u32,
    pub outcome_id: String,
    pub run_id: RunId,
    pub recipe: PortableRefitRecipe,
    pub provenance: PortableRefitProvenance,
    pub target_training_request: TrainingRequest,
    pub effective_plan: ExecutionPlan,
    pub effective_plan_fingerprint: String,
    pub selected_variant_id: VariantId,
    pub selected_variant_fingerprint: String,
    pub output_bindings: Vec<OutputBinding>,
    pub predictor_node_ids: Vec<NodeId>,
    pub data_identities: Vec<TrainingDataIdentity>,
    pub training_influence: TrainingInfluenceManifest,
    pub execution_bundle: PortableRefitExecutionBundleV3,
    pub outcome_fingerprint: String,
}

impl PortableRefitOutcomeV3 {
    pub fn compute_fingerprint(&self) -> Result<String> {
        tcv1_fingerprint_without(self, "outcome_fingerprint", "portable refit outcome V3")
    }

    pub fn validate(&self) -> Result<()> {
        if self.schema_version != PORTABLE_REFIT_OUTCOME_V3_SCHEMA_VERSION {
            return contract_error(format!(
                "portable refit outcome V3 has unsupported schema_version {}; expected {}",
                self.schema_version, PORTABLE_REFIT_OUTCOME_V3_SCHEMA_VERSION
            ));
        }
        RunId::new(self.outcome_id.clone()).map_err(|error| {
            DagMlError::RuntimeValidation(format!(
                "portable refit outcome id is not portable: {error}"
            ))
        })?;
        self.recipe.validate()?;
        self.provenance.validate_against_recipe(&self.recipe)?;
        self.target_training_request.validate()?;
        if self.target_training_request.request_fingerprint
            != self.provenance.target_training_request_fingerprint
            || self.target_training_request.data_identities != self.data_identities
        {
            return contract_error(
                "portable refit outcome target training request does not exactly match target provenance"
                    .to_string(),
            );
        }
        self.effective_plan.validate()?;
        validate_sha256(
            "portable refit outcome effective plan",
            &self.effective_plan_fingerprint,
        )?;
        validate_sha256("portable refit outcome", &self.outcome_fingerprint)?;
        if self.effective_plan_fingerprint
            != tcv1_fingerprint(
                &self.effective_plan,
                "portable refit outcome effective plan",
            )?
        {
            return contract_error(
                "portable refit outcome effective plan fingerprint does not match its content"
                    .to_string(),
            );
        }
        validate_portable_refit_target_plan(&self.recipe, &self.effective_plan)?;
        let selected = self
            .effective_plan
            .variants
            .iter()
            .find(|variant| variant.variant_id == self.selected_variant_id)
            .ok_or_else(|| {
                DagMlError::RuntimeValidation(
                    "portable refit outcome selected variant is absent from effective plan"
                        .to_string(),
                )
            })?;
        if self.selected_variant_id != self.recipe.selected_variant_id
            || self.selected_variant_fingerprint != selected.fingerprint
            || self.selected_variant_fingerprint != self.recipe.selected_variant_fingerprint
        {
            return contract_error(
                "portable refit outcome selected variant does not exactly match its recipe"
                    .to_string(),
            );
        }
        if self.output_bindings.is_empty() || self.predictor_node_ids.is_empty() {
            return contract_error(
                "portable refit outcome requires output bindings and predictor nodes".to_string(),
            );
        }
        let mut binding_fingerprints = Vec::with_capacity(self.output_bindings.len());
        for binding in &self.output_bindings {
            binding.validate(&self.effective_plan.graph_plan.graph)?;
            binding_fingerprints.push(binding.binding_fingerprint.clone());
        }
        binding_fingerprints.sort();
        if binding_fingerprints != self.recipe.target_binding_fingerprints {
            return contract_error(
                "portable refit outcome output bindings do not exactly match recipe targets"
                    .to_string(),
            );
        }
        if self
            .predictor_node_ids
            .windows(2)
            .any(|pair| pair[0] >= pair[1])
            || self
                .predictor_node_ids
                .iter()
                .any(|node_id| !self.effective_plan.node_plans.contains_key(node_id))
        {
            return contract_error(
                "portable refit outcome predictor nodes must be strictly sorted plan nodes"
                    .to_string(),
            );
        }
        if self.data_identities.is_empty()
            || !self
                .data_identities
                .windows(2)
                .all(|pair| pair[0].requirement_key < pair[1].requirement_key)
        {
            return contract_error(
                "portable refit outcome data identities must be non-empty and strictly sorted"
                    .to_string(),
            );
        }
        for identity in &self.data_identities {
            identity.validate()?;
        }
        self.training_influence.validate()?;
        if tcv1_fingerprint(
            &self.data_identities,
            "portable refit outcome data identities",
        )? != self.provenance.target_data_identities_fingerprint
            || self.training_influence.manifest_fingerprint
                != self.provenance.target_training_influence_fingerprint
            || self.training_influence.relation_fingerprint
                != self.provenance.target_relation_fingerprint
            || self.data_identities.iter().any(|identity| {
                identity.relation_fingerprint != self.provenance.target_relation_fingerprint
            })
        {
            return contract_error(
                "portable refit outcome target cohort does not exactly match its provenance"
                    .to_string(),
            );
        }
        self.execution_bundle
            .validate(&self.recipe, &self.effective_plan)?;
        if self.execution_bundle.selected_variant_id != self.selected_variant_id {
            return contract_error(
                "portable refit outcome bundle selected variant does not match outcome".to_string(),
            );
        }
        if self.outcome_fingerprint != self.compute_fingerprint()? {
            return contract_error(
                "portable refit outcome fingerprint does not match TCV1 content".to_string(),
            );
        }
        Ok(())
    }

    /// Derive the scheduler-only replay bundle from this validated V3 child.
    /// The returned object is an internal execution projection and must not be
    /// serialized as an `ExecutionBundle` package artifact.
    pub fn to_runtime_replay_bundle(&self) -> Result<ExecutionBundle> {
        self.validate()?;
        self.execution_bundle
            .to_runtime_replay_bundle(&self.recipe, &self.effective_plan)
    }
}

/// Closed Package V3 child created by a successful full refit.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PortableRefitPackageV3 {
    pub schema_version: u32,
    pub package_id: String,
    pub outcome: PortableRefitOutcomeV3,
    pub package_fingerprint: String,
}

impl PortableRefitPackageV3 {
    pub fn compute_fingerprint(&self) -> Result<String> {
        tcv1_fingerprint_without(self, "package_fingerprint", "portable refit package V3")
    }

    pub fn from_json(json: &str) -> Result<Self> {
        let raw_fingerprint = parse_typed_json(json)
            .map_err(|error| {
                DagMlError::RuntimeValidation(format!(
                    "portable refit package V3 is not strict TCV1 JSON: {error}"
                ))
            })?
            .fingerprint_without("package_fingerprint")
            .map_err(|error| {
                DagMlError::RuntimeValidation(format!(
                    "portable refit package V3 fingerprint preimage is invalid: {error}"
                ))
            })?;
        let package: Self = serde_json::from_str(json)?;
        if package.package_fingerprint != raw_fingerprint {
            return contract_error(
                "portable refit package V3 fingerprint does not match original TCV1 JSON"
                    .to_string(),
            );
        }
        package.validate()?;
        Ok(package)
    }

    pub fn validate(&self) -> Result<()> {
        if self.schema_version != PORTABLE_REFIT_PACKAGE_V3_SCHEMA_VERSION {
            return contract_error(format!(
                "portable refit package V3 has unsupported schema_version {}; expected {}",
                self.schema_version, PORTABLE_REFIT_PACKAGE_V3_SCHEMA_VERSION
            ));
        }
        RunId::new(self.package_id.clone()).map_err(|error| {
            DagMlError::RuntimeValidation(format!(
                "portable refit package id is not portable: {error}"
            ))
        })?;
        validate_sha256("portable refit package", &self.package_fingerprint)?;
        self.outcome.validate()?;
        if self.package_fingerprint != self.compute_fingerprint()? {
            return contract_error(
                "portable refit package V3 fingerprint does not match TCV1 content".to_string(),
            );
        }
        Ok(())
    }
}

/// Input for the DAG-ML-owned V3 child writer.  The caller supplies only
/// fresh execution evidence and identifiers; source-package content is used
/// exclusively to revalidate the closed parent recipe and output projection.
pub struct PortableRefitPackageV3BuildInput<'a> {
    pub package_id: String,
    pub outcome_id: String,
    pub bundle_id: BundleId,
    pub recipe: &'a PortableRefitRecipe,
    pub source_package: &'a PortablePredictorPackage,
    pub target_plan: &'a ExecutionPlan,
    pub target_training_request: &'a TrainingRequest,
    pub target_data_identities: &'a [TrainingDataIdentity],
    pub target_training_influence: &'a TrainingInfluenceManifest,
    pub execution: &'a PortableFullRefitExecution,
}

/// Atomically construct the outcome, execution bundle and package child of a
/// successful full refit.  No V2 score, selection, prediction cache,
/// conformal state or process-local handle is copied into this V3 family.
pub fn build_portable_refit_package_v3(
    input: PortableRefitPackageV3BuildInput<'_>,
) -> Result<PortableRefitPackageV3> {
    input
        .recipe
        .validate_against_source_package(input.source_package)?;
    if input.source_package.schema_version != PORTABLE_PREDICTOR_PACKAGE_SCHEMA_VERSION {
        return contract_error(
            "portable refit package V3 requires an exact Package V2 parent".to_string(),
        );
    }
    input
        .execution
        .provenance
        .validate_against_recipe(input.recipe)?;
    input.target_training_request.validate()?;
    if input.target_training_request.request_fingerprint
        != input
            .execution
            .provenance
            .target_training_request_fingerprint
        || input.target_training_request.data_identities != input.target_data_identities
    {
        return contract_error(
            "portable refit package V3 target request does not exactly bind target cohort evidence"
                .to_string(),
        );
    }
    if input
        .execution
        .provenance
        .target_training_request_fingerprint
        == input.recipe.parent_outcome.training_request_fingerprint
    {
        return contract_error(
            "portable refit package V3 execution reuses its parent training request".to_string(),
        );
    }
    let expected_target_plan = derive_portable_full_refit_target_plan(
        input.recipe,
        input.source_package,
        input.target_training_request,
    )?;
    if input.target_plan != &expected_target_plan
        || input.execution.effective_plan != expected_target_plan
    {
        return contract_error(
            "portable refit package V3 plan is not the deterministic parent-plus-cohort derivation"
                .to_string(),
        );
    }
    // A V3 child is an already-trained REFIT artifact package.  Validation
    // OOF inputs were necessary to fit a stacking meta-estimator, but they
    // are neither a PREDICT dependency nor part of V3's deliberately
    // cache-free contract.  Persisting their V2 cache keys would make the
    // derived runtime bundle demand source-CV evidence that V3 correctly
    // does not carry.
    let mut refit_artifacts = input.execution.refit_artifacts.clone();
    for record in &mut refit_artifacts {
        record.prediction_requirement_keys.clear();
    }
    let mut bundle = PortableRefitExecutionBundleV3 {
        schema_version: PORTABLE_REFIT_EXECUTION_BUNDLE_V3_SCHEMA_VERSION,
        bundle_id: input.bundle_id,
        effective_plan_fingerprint: tcv1_fingerprint(
            input.target_plan,
            "portable refit package V3 effective plan",
        )?,
        selected_variant_id: input.recipe.selected_variant_id.clone(),
        refit_artifacts,
        raw_artifact_payloads: input.execution.raw_artifact_payloads.clone(),
        bundle_fingerprint: zero_fingerprint(),
    };
    bundle.bundle_fingerprint = bundle.compute_fingerprint()?;
    let mut outcome = PortableRefitOutcomeV3 {
        schema_version: PORTABLE_REFIT_OUTCOME_V3_SCHEMA_VERSION,
        outcome_id: input.outcome_id,
        run_id: input.execution.run_id.clone(),
        recipe: input.recipe.clone(),
        provenance: input.execution.provenance.clone(),
        target_training_request: input.target_training_request.clone(),
        effective_plan: input.target_plan.clone(),
        effective_plan_fingerprint: bundle.effective_plan_fingerprint.clone(),
        selected_variant_id: input.recipe.selected_variant_id.clone(),
        selected_variant_fingerprint: input.recipe.selected_variant_fingerprint.clone(),
        output_bindings: input.source_package.output_bindings.clone(),
        predictor_node_ids: input.source_package.predictor_node_ids.clone(),
        data_identities: input.target_data_identities.to_vec(),
        training_influence: input.target_training_influence.clone(),
        execution_bundle: bundle,
        outcome_fingerprint: zero_fingerprint(),
    };
    outcome.outcome_fingerprint = outcome.compute_fingerprint()?;
    let mut package = PortableRefitPackageV3 {
        schema_version: PORTABLE_REFIT_PACKAGE_V3_SCHEMA_VERSION,
        package_id: input.package_id,
        outcome,
        package_fingerprint: zero_fingerprint(),
    };
    package.package_fingerprint = package.compute_fingerprint()?;
    package.validate()?;
    Ok(package)
}

/// Native artifacts and execution evidence produced by the first, scheduler
/// only step of a V3 full refit.  The V3 outcome/package writer consumes this
/// result to create a new durable child; it must not mutate the parent.
#[derive(Clone, Debug)]
pub struct PortableFullRefitExecution {
    pub run_id: RunId,
    pub provenance: PortableRefitProvenance,
    /// Exact target-cohort plan derived from the parent recipe.  The child
    /// writer cross-checks this value so execution evidence cannot be paired
    /// with a different plan after REFIT completed.
    pub effective_plan: ExecutionPlan,
    pub results: Vec<NodeResult>,
    pub refit_artifacts: Vec<crate::bundle::RefitArtifactRecord>,
    /// Raw bytes are detached from their process-local controller immediately
    /// after the refit phase.  A future Package/Archive V3 writer consumes
    /// this map atomically with `refit_artifacts`; it must never ask a source
    /// controller to re-export an artifact after the execution has ended.
    pub raw_artifact_payloads: BTreeMap<ArtifactId, Vec<u8>>,
}

/// Derive the only execution plan a V3 full REFIT may use for a new cohort.
///
/// The parent Package V2 remains the authority for graph topology, selected
/// parameters, variants and controller policy.  A freshly signed target
/// request is authoritative only for the cohort-bound data bindings and fold
/// universe.  This is deliberately a derivation rather than a permissive
/// comparison: callers cannot choose a plan that happens to look compatible.
pub fn derive_portable_full_refit_target_plan(
    recipe: &PortableRefitRecipe,
    source_package: &PortablePredictorPackage,
    target_training_request: &TrainingRequest,
) -> Result<ExecutionPlan> {
    recipe.validate_against_source_package(source_package)?;
    if !target_training_request.parameter_patches.is_empty()
        || !target_training_request.patch_policies.is_empty()
    {
        return contract_error(
            "portable full refit target request must not carry parameter patches".to_string(),
        );
    }
    let target_projection = target_training_request.project()?;
    let target_plan = target_projection.plan;
    let source_plan = &source_package.effective_plan;

    if source_plan.graph_plan.graph != target_plan.graph_plan.graph
        || source_plan.controller_manifests != target_plan.controller_manifests
    {
        return contract_error(
            "portable full refit target request does not match the parent graph/controller topology"
                .to_string(),
        );
    }
    validate_portable_refit_node_shape(source_plan, &target_plan)?;
    validate_portable_refit_binding_shape(source_plan, &target_plan)?;

    let mut derived = source_plan.clone();
    derived.campaign.data_bindings = target_plan.campaign.data_bindings.clone();
    derived.fold_set = target_plan.fold_set.clone();
    match (
        derived.campaign.split_invocation.as_mut(),
        target_plan.campaign.split_invocation.as_ref(),
    ) {
        (Some(source_split), Some(target_split)) => {
            source_split.fold_set = target_split.fold_set.clone();
        }
        (None, None) => {}
        _ => {
            return contract_error(
                "portable full refit target request changes whether the parent has a fold universe"
                    .to_string(),
            );
        }
    }
    for (node_id, node) in &mut derived.node_plans {
        node.data_bindings = target_plan
            .node_plans
            .get(node_id)
            .ok_or_else(|| {
                DagMlError::RuntimeValidation(format!(
                    "portable full refit target plan is missing parent node `{node_id}`"
                ))
            })?
            .data_bindings
            .clone();
    }
    derived.campaign_fingerprint = stable_json_fingerprint(&derived.campaign)?;
    derived.validate()?;
    validate_portable_refit_target_plan(recipe, &derived)?;
    Ok(derived)
}

/// Validate a persisted V3 target plan against the parent recipe without
/// reusing the parent's cohort-specific plan fingerprint.
pub fn validate_portable_refit_target_plan(
    recipe: &PortableRefitRecipe,
    plan: &ExecutionPlan,
) -> Result<()> {
    recipe.validate()?;
    plan.validate()?;
    let selected_variant = plan
        .variants
        .iter()
        .find(|variant| variant.variant_id == recipe.selected_variant_id)
        .ok_or_else(|| {
            DagMlError::RuntimeValidation(
                "portable full refit selected variant is absent from target plan".to_string(),
            )
        })?;
    let selected_parameters = plan
        .node_plans
        .iter()
        .map(|(node_id, node)| (node_id.clone(), node.params.clone()))
        .collect::<BTreeMap<_, _>>();
    if selected_variant.fingerprint != recipe.selected_variant_fingerprint
        || tcv1_fingerprint(
            &(selected_variant.fingerprint.clone(), selected_parameters),
            "portable refit selected parameter projection",
        )? != recipe.selected_parameter_projection_fingerprint
    {
        return contract_error(
            "portable full refit target selected parameters do not match the parent recipe"
                .to_string(),
        );
    }
    for controller in &recipe.controllers {
        let node = plan.node_plans.get(&controller.node_id).ok_or_else(|| {
            DagMlError::RuntimeValidation(format!(
                "portable full refit recipe controller node `{}` is absent from target plan",
                controller.node_id
            ))
        })?;
        let manifest = plan
            .controller_manifests
            .get(&node.controller_id)
            .ok_or_else(|| {
                DagMlError::RuntimeValidation(format!(
                    "portable full refit target node `{}` has no controller manifest",
                    node.node_id
                ))
            })?;
        if node.controller_id != controller.controller_id
            || node.controller_version != controller.controller_version
            || node.controller_capabilities != controller.capabilities
            || tcv1_fingerprint(manifest, "portable refit controller manifest")?
                != controller.manifest_fingerprint
        {
            return contract_error(format!(
                "portable full refit target controller `{}` does not match the parent recipe",
                controller.node_id
            ));
        }
    }
    Ok(())
}

fn validate_portable_refit_node_shape(
    source: &ExecutionPlan,
    target: &ExecutionPlan,
) -> Result<()> {
    if source.node_plans.keys().collect::<BTreeSet<_>>()
        != target.node_plans.keys().collect::<BTreeSet<_>>()
    {
        return contract_error(
            "portable full refit target request node set differs from the parent".to_string(),
        );
    }
    for node_id in source.node_plans.keys() {
        let mut parent = source.node_plans[node_id].clone();
        let mut candidate = target.node_plans[node_id].clone();
        // Parent parameter values are the selected model.  The new cohort's
        // request is not allowed to override them, so they are intentionally
        // excluded from the target-request shape comparison.
        parent.params.clear();
        candidate.params.clear();
        parent.params_fingerprint = stable_json_fingerprint(&parent.params)?;
        candidate.params_fingerprint = stable_json_fingerprint(&candidate.params)?;
        parent.data_bindings.clear();
        candidate.data_bindings.clear();
        if parent != candidate {
            return contract_error(format!(
                "portable full refit target node `{node_id}` changes parent execution shape"
            ));
        }
    }
    Ok(())
}

fn validate_portable_refit_binding_shape(
    source: &ExecutionPlan,
    target: &ExecutionPlan,
) -> Result<()> {
    let source_bindings = portable_refit_binding_map(source)?;
    let target_bindings = portable_refit_binding_map(target)?;
    if source_bindings.keys().collect::<BTreeSet<_>>()
        != target_bindings.keys().collect::<BTreeSet<_>>()
    {
        return contract_error(
            "portable full refit target request data-binding coordinates differ from the parent"
                .to_string(),
        );
    }
    for (key, parent) in source_bindings {
        let candidate = &target_bindings[&key];
        let mut parent = parent.clone();
        let mut candidate = candidate.clone();
        // Cohort identity is deliberately re-attested by the target request,
        // data identities and influence manifest.  All actual execution/data
        // view semantics remain exact below.
        parent.request_id = "portable_refit:target_cohort".to_string();
        candidate.request_id = parent.request_id.clone();
        parent.schema_fingerprint = "0".repeat(64);
        candidate.schema_fingerprint = parent.schema_fingerprint.clone();
        parent.relation_fingerprint = parent.relation_fingerprint.as_ref().map(|_| "0".repeat(64));
        candidate.relation_fingerprint = candidate
            .relation_fingerprint
            .as_ref()
            .map(|_| "0".repeat(64));
        if parent != candidate {
            return contract_error(format!(
                "portable full refit target binding `{key}` changes parent data-view semantics"
            ));
        }
    }
    Ok(())
}

fn portable_refit_binding_map(
    plan: &ExecutionPlan,
) -> Result<BTreeMap<String, crate::data::DataBinding>> {
    let mut bindings = BTreeMap::new();
    for binding in plan.campaign.data_bindings.values().flatten() {
        let key = data_binding_requirement_key(&binding.node_id, &binding.input_name);
        if bindings.insert(key.clone(), binding.clone()).is_some() {
            return contract_error(format!(
                "portable full refit plan has duplicate data-binding key `{key}`"
            ));
        }
    }
    Ok(bindings)
}

/// Execute exactly one portable native full refit from a closed recipe.
///
/// The function has no V2 replay input. A declared nested-stacking target
/// first rebuilds its own selected-variant inner/outer OOF evidence, then runs
/// the ordinary `REFIT` phase. This is target-cohort execution only: it never
/// resumes source CV, selection, scores, caches, or artifacts. Non-stacking
/// plans retain the direct REFIT path. All source/recipe/cohort checks occur
/// before the data provider is queried. It intentionally returns execution
/// evidence rather than synthesising a TrainingOutcome: V3 persistence must
/// add the new outcome/bundle/package atomically in its owning writer.
pub fn execute_portable_full_refit(
    input: PortableFullRefitExecutionInput<'_>,
) -> Result<PortableFullRefitExecution> {
    input
        .recipe
        .validate_against_source_package(input.source_package)?;
    input.target_training_request.validate()?;
    if input.target_training_request.request_fingerprint
        != input.target_training_request_fingerprint
        || input.target_training_request.data_identities != input.target_data_identities
    {
        return contract_error(
            "portable full refit target request does not exactly bind provided cohort evidence"
                .to_string(),
        );
    }
    let provenance = PortableRefitProvenance::from_target_cohort(
        input.recipe,
        input.target_training_request_fingerprint,
        input.target_data_identities,
        input.target_training_influence,
    )?;
    let derived_target_plan = derive_portable_full_refit_target_plan(
        input.recipe,
        input.source_package,
        input.target_training_request,
    )?;
    if input.target_plan != &derived_target_plan {
        return contract_error(
            "portable full refit target plan is not the deterministic parent-plus-cohort derivation"
                .to_string(),
        );
    }
    let selected_variant = input
        .target_plan
        .variants
        .iter()
        .find(|variant| variant.variant_id == input.recipe.selected_variant_id)
        .ok_or_else(|| {
            DagMlError::RuntimeValidation(
                "portable full refit selected variant is absent from target plan".to_string(),
            )
        })?;
    if selected_variant.fingerprint != input.recipe.selected_variant_fingerprint {
        return contract_error(
            "portable full refit target selected variant does not match parent recipe".to_string(),
        );
    }
    let mut ctx = RunContext::new(input.run_id.clone(), derived_target_plan.campaign.root_seed);
    ctx.variant_id = Some(input.recipe.selected_variant_id.clone());
    if let Some(nested) = nested_stacking_campaign_plan(&derived_target_plan)? {
        // Ridge's full refit trains only from target-cohort OOF base features.
        // Recreate those scheduler-owned nested scopes for the already selected
        // variant; this is not a CV/SELECT replay of the parent package.
        SequentialScheduler.execute_campaign_phase_with_data_provider(
            &derived_target_plan,
            input.controllers,
            input.data_provider,
            &mut ctx,
            Phase::FitCv,
        )?;
        // The following REFIT consumes only report-grade outer OOF rows. Check
        // their presence at the phase boundary so a nested target cannot fall
        // through to a less actionable generic OOF failure while rebuilding a
        // stack on a fresh cohort.
        let expected_outer_folds = nested
            .outer_scopes
            .iter()
            .map(|scope| scope.outer_fold_id.clone())
            .collect::<BTreeSet<_>>();
        for edge in derived_target_plan
            .graph_plan
            .graph
            .edges
            .iter()
            .filter(|edge| edge.target.node_id == nested.meta_node_id && edge.contract.requires_oof)
        {
            let observed_outer_folds = ctx
                .prediction_store
                .find(
                    Some(&edge.source.node_id),
                    Some(&PredictionPartition::Validation),
                    None,
                )
                .into_iter()
                .filter(|block| {
                    block
                        .fold_id
                        .as_ref()
                        .is_some_and(|fold_id| expected_outer_folds.contains(fold_id))
                })
                .map(|block| block.fold_id.clone().expect("filtered above"))
                .collect::<BTreeSet<_>>();
            if observed_outer_folds != expected_outer_folds {
                return Err(DagMlError::OofValidation(format!(
                    "portable full refit nested FIT_CV did not retain exact outer OOF folds for `{}.{}` -> `{}.{}`; expected {:?}, observed {:?}",
                    edge.source.node_id,
                    edge.source.port_name,
                    edge.target.node_id,
                    edge.target.port_name,
                    expected_outer_folds,
                    observed_outer_folds,
                )));
            }
        }
    }
    let mut artifact_store = InMemoryArtifactStore::new();
    let results = SequentialScheduler
        .execute_campaign_phase_with_data_provider_and_artifact_store(
            &derived_target_plan,
            input.controllers,
            input.data_provider,
            &mut artifact_store,
            &mut ctx,
            Phase::Refit,
        )?;
    let refit_artifacts = artifact_store.refit_artifacts();
    if refit_artifacts.is_empty() {
        return contract_error(
            "portable full refit produced no durable native artifact".to_string(),
        );
    }
    let mut raw_artifact_payloads = BTreeMap::new();
    for record in &refit_artifacts {
        record.validate()?;
        let controller = input
            .controllers
            .get(&record.controller_id)
            .ok_or_else(|| {
                DagMlError::RuntimeValidation(format!(
                "portable full refit artifact `{}` has no registered controller `{}` for export",
                record.artifact.id, record.controller_id
            ))
            })?;
        let payload = controller
            .export_artifact_payload(&record.artifact.id)?
            .ok_or_else(|| {
                DagMlError::RuntimeValidation(format!(
                    "portable full refit controller `{}` did not export durable payload `{}`",
                    record.controller_id, record.artifact.id
                ))
            })?;
        if raw_artifact_payloads
            .insert(record.artifact.id.clone(), payload)
            .is_some()
        {
            return contract_error(
                "portable full refit produced duplicate durable artifact identifiers".to_string(),
            );
        }
    }
    Ok(PortableFullRefitExecution {
        run_id: input.run_id,
        provenance,
        effective_plan: derived_target_plan,
        results,
        refit_artifacts,
        raw_artifact_payloads,
    })
}

/// Execute COMPILE/PLAN -> FIT_CV -> SELECT -> optional REFIT and return the
/// complete portable W0 outcome.
///
/// Variant candidates are evaluated by the existing native selection helper;
/// the winner is then rerun once in a retained context so its lineage, OOF
/// caches, bound outputs, and optional refit artifacts all originate from one
/// auditable execution. `SELECT` is called exactly once and `REFIT` at most once.
pub fn execute_training(input: TrainingExecutionInput<'_>) -> Result<TrainingOutcome> {
    if !input.artifact_store.is_empty() {
        return Err(DagMlError::RuntimeValidation(
            "native training requires an empty artifact store for an isolated outcome".to_string(),
        ));
    }
    RunId::new(input.outcome_id.clone()).map_err(|error| {
        DagMlError::RuntimeValidation(format!(
            "native training outcome_id is not a portable identifier: {error}"
        ))
    })?;
    validate_sorted_unique_text("training execution warnings", &input.warnings)?;
    if contains_runtime_handle(&serde_json::Value::Object(
        input.diagnostics.clone().into_iter().collect(),
    )) {
        return Err(DagMlError::RuntimeValidation(
            "native training diagnostics cannot contain runtime handles".to_string(),
        ));
    }

    let mut projection = input.request.project()?;
    projection.plan = materialize_request_parameter_patches(projection.plan, input.request)?;
    projection.validate()?;
    validate_native_training_options(input.request)?;
    input.training_influence.validate_for_projection(
        &projection,
        input.request,
        input.relations,
    )?;
    let runtime_training_influence = TrainingInfluenceManifest::derive_for_projection(
        &projection,
        input.request,
        input.relations,
    )?;
    if input.training_influence != &runtime_training_influence {
        return Err(DagMlError::RuntimeValidation(
            "native training influence manifest does not match runtime-derived evidence"
                .to_string(),
        ));
    }
    // Native HPO is preflighted before provider attestation/materialization so
    // unsupported model or tuning descriptors cannot incur any data cost.
    let native_hpo_descriptor = HpoExecutionContext {
        request: input.request,
        projection: &projection,
        controllers: input.controllers,
        data_provider: input.data_provider,
        relations: input.relations,
        training_influence: &runtime_training_influence,
        selection: &input.request.options.selection,
    }
    .preflight()?;
    validate_provider_attestations(
        &projection,
        input.request,
        input.data_provider,
        input.relations,
    )?;
    for node_plan in projection.plan.node_plans.values() {
        if input.controllers.get(&node_plan.controller_id).is_none() {
            return Err(DagMlError::RuntimeValidation(format!(
                "native training controller `{}` for node `{}` is not registered",
                node_plan.controller_id, node_plan.node_id
            )));
        }
    }
    let executable_nodes = projection
        .plan
        .node_plans
        .values()
        .filter(|node| !node.supported_phases.is_empty())
        .map(|node| node.node_id.clone())
        .collect::<BTreeSet<_>>();
    if projection.predictor_node_ids != executable_nodes {
        return Err(DagMlError::RuntimeValidation(
            "native training currently requires the predictor closure to equal the executable plan; refusing to persist unrelated nodes"
                .to_string(),
        ));
    }
    if projection.plan.variants.iter().any(|variant| {
        variant
            .choices
            .values()
            .any(|choice| !choice.param_overrides.is_empty())
    }) && !input
        .training_influence
        .entries
        .iter()
        .any(|entry| entry.kind == TrainingInfluenceKind::HpoSelection)
    {
        return Err(DagMlError::RuntimeValidation(
            "selectable parameter overrides require predeclared hpo_selection influence"
                .to_string(),
        ));
    }
    let scheduler = NativeTrainingScheduler::from_request(input.request)?;
    let selection_metric = parse_selection_metric(input.request)?;
    let metric_level = effective_selection_metric_level(input.request)?;
    let selection_output = projection
        .outputs
        .iter()
        .find(|output| output.output_id == input.request.options.selection_output_id)
        .ok_or_else(|| {
            DagMlError::RuntimeValidation(
                "training selection output was not resolved by projection".to_string(),
            )
        })?;
    let selection_output_id = selection_output.output_id.clone();
    let selection_producer = selection_output.node_id.clone();
    let selection_producer_port = selection_output.port_name.clone();
    validate_selection_prediction_kind(selection_metric, selection_output.prediction_kind)?;
    #[cfg(feature = "methods-optimizer")]
    let mut methods_hpo_resume_state = None;
    #[cfg(feature = "methods-optimizer")]
    #[cfg(feature = "methods-optimizer")]
    let selection = if let Some(descriptor) = native_hpo_descriptor.as_ref() {
        let hpo_execution = HpoExecutionContext {
            request: input.request,
            projection: &projection,
            controllers: input.controllers,
            data_provider: input.data_provider,
            relations: input.relations,
            training_influence: &runtime_training_influence,
            selection: &input.request.options.selection,
        };
        let (context, previous_resume_state) = hpo_execution.runtime_context(
            descriptor,
            selection_metric,
            &selection_producer,
            &selection_producer_port,
        )?;
        let campaign_context =
            RunContext::new(input.run_id.clone(), Some(input.request.options.seed));
        let campaign = SequentialScheduler.execute_hpo_campaign(
            &projection.plan,
            input.controllers,
            input.data_provider,
            &campaign_context,
            &context,
        )?;
        let (plan, selection, resume_state) =
            hpo_execution.selection_from_campaign(&context, previous_resume_state, campaign)?;
        projection.plan = plan;
        methods_hpo_resume_state = Some(resume_state);
        selection
    } else {
        select_best_variant_outcome_by_cv_for_target(
            &projection.plan,
            &input.run_id,
            Some(input.request.options.seed),
            selection_metric,
            &selection_producer,
            Some(selection_producer_port.as_str()),
            metric_level,
            |candidate_plan, candidate_ctx| {
                scheduler
                    .fit_cv(candidate_plan, input.controllers, input.data_provider, candidate_ctx)
                    .map(|_| ())
            },
        )?
        .ok_or_else(|| DagMlError::RuntimeValidation(
            "native training SELECT received no scored candidate; controllers must emit targets".to_string(),
        ))?
    };
    #[cfg(not(feature = "methods-optimizer"))]
    let selection = {
        let _ = native_hpo_descriptor;
        select_best_variant_outcome_by_cv_for_target(
            &projection.plan,
            &input.run_id,
            Some(input.request.options.seed),
            selection_metric,
            &selection_producer,
            Some(selection_producer_port.as_str()),
            metric_level,
            |candidate_plan, candidate_ctx| {
                scheduler
                    .fit_cv(candidate_plan, input.controllers, input.data_provider, candidate_ctx)
                    .map(|_| ())
            },
        )?
        .ok_or_else(|| DagMlError::RuntimeValidation(
            "native training SELECT received no scored candidate; controllers must emit targets".to_string(),
        ))?
    };

    validate_selection_report_levels(
        &selection.selection.validation_reports,
        &selection_producer,
        &Some(selection_producer_port.clone()),
        metric_level,
    )?;
    let mut decision = selection.decision;
    bind_selection_decision(&mut decision, input.request, metric_level)?;
    let selected_variant_id = selection.selection.selected_variant_id;
    let effective_plan = materialize_selected_variant(projection.plan, &selected_variant_id)?;
    // Keep the original union variants for replay/identity while pinning every
    // retained execution through RunContext.variant_id.
    let selected_variant = effective_plan
        .variants
        .iter()
        .find(|variant| variant.variant_id == selected_variant_id)
        .cloned()
        .ok_or_else(|| {
            DagMlError::RuntimeValidation(
                "selected variant disappeared while materializing the plan".to_string(),
            )
        })?;
    effective_plan.validate()?;

    let mut selected_ctx = RunContext::new(input.run_id.clone(), Some(input.request.options.seed));
    selected_ctx.variant_id = Some(selected_variant_id.clone());
    let fit_cv_results = scheduler.fit_cv(
        &effective_plan,
        input.controllers,
        input.data_provider,
        &mut selected_ctx,
    )?;
    selected_ctx.collect_cross_fold_validation_scores(plan_oof_partition_mode(&effective_plan))?;
    validate_selected_rerun_reports(
        &selection.selection.validation_reports,
        &selected_ctx.score_collector,
        &selected_variant_id,
    )?;

    let score_set = ScoreSet {
        schema_version: SCORE_SET_SCHEMA_VERSION,
        plan_id: effective_plan.id.clone(),
        selection_metric: Some(selection_metric.name().to_string()),
        reports: selection.selection.validation_reports,
    };
    score_set.validate()?;

    let prediction_requirements = build_oof_prediction_requirements(
        &effective_plan,
        selected_ctx.prediction_store.blocks(),
        selected_ctx.aggregated_prediction_store.blocks(),
    )?;
    let retain_caches =
        input.request.options.artifacts.prediction_caches == PredictionCacheRetention::Retain;
    let (prediction_caches, portable_prediction_caches) = if retain_caches {
        let mut records = build_oof_prediction_cache_records(
            &prediction_requirements,
            selected_ctx.prediction_store.blocks(),
            selected_ctx.aggregated_prediction_store.blocks(),
        )?;
        let mut payloads = build_oof_prediction_cache_payloads(
            &prediction_requirements,
            selected_ctx.prediction_store.blocks(),
            selected_ctx.aggregated_prediction_store.blocks(),
        )?;
        attach_oof_prediction_cache_namespaces(
            &effective_plan,
            &input.request.data_identities,
            &selected_variant_id,
            input.request.options.seed,
            &prediction_requirements,
            &mut records,
            &mut payloads,
        )?;
        (
            records,
            Some(BundlePredictionCachePayloadSet {
                bundle_id: input.bundle_id.clone(),
                schema_version: PREDICTION_CACHE_PAYLOAD_SCHEMA_VERSION,
                caches: payloads,
            }),
        )
    } else {
        (Vec::new(), None)
    };

    let mut staged_artifact_store = InMemoryArtifactStore::new();
    let refit_results = if input.request.options.refit {
        scheduler.refit(
            &effective_plan,
            input.controllers,
            input.data_provider,
            &mut staged_artifact_store,
            &mut selected_ctx,
        )?
    } else {
        Vec::new()
    };

    let mut execution_bundle = build_execution_bundle_with_prediction_contracts(
        input.bundle_id.clone(),
        &effective_plan,
        Some(selected_variant_id.clone()),
        BTreeMap::from([(input.request.options.selection.id.clone(), decision)]),
        staged_artifact_store.refit_artifacts(),
        prediction_requirements,
        prediction_caches,
    )?;
    #[cfg(feature = "methods-optimizer")]
    {
        execution_bundle.methods_hpo_resume_state = methods_hpo_resume_state.clone();
        for record in &execution_bundle.refit_artifacts {
            if record.artifact.kind != "n4m_model" {
                continue;
            }
            let controller = input
                .controllers
                .get(&record.controller_id)
                .ok_or_else(|| {
                    DagMlError::RuntimeValidation(format!(
                        "missing controller `{}` for N4MM export",
                        record.controller_id
                    ))
                })?;
            let bytes = controller
                .export_artifact_payload(&record.artifact.id)?
                .ok_or_else(|| {
                    DagMlError::RuntimeValidation(format!(
                        "Methods controller did not export durable N4MM payload `{}`",
                        record.artifact.id
                    ))
                })?;
            execution_bundle
                .raw_artifact_payloads
                .insert(record.artifact.id.clone(), bytes);
        }
    }
    execution_bundle.scores = Some(score_set.clone());
    execution_bundle.validate_against_plan(&effective_plan)?;
    if let Some(caches) = &portable_prediction_caches {
        caches.validate_against_bundle(&execution_bundle)?;
    }

    let outputs = bind_training_outputs(
        &projection.outputs,
        input.request,
        &effective_plan,
        &fit_cv_results,
        &refit_results,
        &selected_ctx,
    )?;
    let mut lineage = selected_ctx
        .lineage
        .records()
        .filter(|record| projection.predictor_node_ids.contains(&record.node_id))
        .cloned()
        .collect::<Vec<_>>();
    for record in &mut lineage {
        record.input_lineage.sort();
        record
            .artifact_refs
            .sort_by(|left, right| left.id.cmp(&right.id));
    }
    lineage.sort_by(|left, right| left.record_id.cmp(&right.record_id));

    let effective_plan_fingerprint =
        tcv1_fingerprint(&effective_plan, "training outcome effective plan")?;
    let parameter_patches =
        merge_training_parameter_patches(&input.request.parameter_patches, &selected_variant)?;
    // Derive the honest replayable phases from the *full effective predictor
    // closure* and the artifacts/caches actually retained by this run, never
    // from the refit flag alone. `derive_replayable_phases` is the single shared
    // helper that standalone validation re-runs, so construction cannot advertise
    // a capability the closure and retained state do not support.
    let predictor_closure_nodes = predictor_closure(
        &effective_plan,
        outputs.iter().map(|output| output.binding.node_id.clone()),
    )?;
    let refit_outcome = TrainingRefitOutcome {
        requested: input.request.options.refit,
        status: if input.request.options.refit {
            TrainingRefitStatus::Completed
        } else {
            TrainingRefitStatus::Skipped
        },
        strategy: input.request.options.refit_strategy,
    };
    let replayable_phases = derive_replayable_phases(
        &effective_plan,
        &predictor_closure_nodes,
        &refit_outcome,
        &execution_bundle,
        portable_prediction_caches.as_ref(),
    )?;
    let mut outcome = TrainingOutcome {
        schema_version: TRAINING_OUTCOME_SCHEMA_VERSION,
        outcome_id: input.outcome_id,
        run_id: input.run_id,
        training_request_fingerprint: projection.request_fingerprint,
        data_identities: input.request.data_identities.clone(),
        selection_output_id,
        effective_plan,
        effective_plan_fingerprint,
        selected_variant_id,
        selected_variant_fingerprint: selected_variant.fingerprint,
        parameter_patches,
        refit: refit_outcome,
        score_set,
        outputs,
        lineage,
        portable_prediction_caches,
        training_influence: runtime_training_influence,
        execution_bundle,
        conformal_calibration: None,
        conformal_calibration_replay: None,
        #[cfg(feature = "methods-optimizer")]
        methods_hpo_resume_state,
        #[cfg(not(feature = "methods-optimizer"))]
        methods_hpo_resume_state: None,
        replayable_phases,
        warnings: input.warnings,
        diagnostics: input.diagnostics,
        outcome_fingerprint: zero_fingerprint(),
    };
    outcome = stabilize_training_outcome_for_tcv1(outcome)?;
    outcome.validate()?;
    *input.artifact_store = staged_artifact_store;
    Ok(outcome)
}

fn stabilize_training_outcome_for_tcv1(mut outcome: TrainingOutcome) -> Result<TrainingOutcome> {
    // TCV1 signs the lexical JSON number token, whereas serde first parses a
    // metric into binary64 and may subsequently select a different shortest
    // spelling for that same value. Sign only the fixed point that a strict
    // reader will itself obtain after deserialize/serialize; otherwise a newly
    // produced package can fail its own `TrainingOutcome::from_json` boundary.
    outcome.outcome_fingerprint = zero_fingerprint();
    for _ in 0..8 {
        let json = serde_json::to_string(&outcome)?;
        let before = parse_typed_json(&json).map_err(|error| {
            DagMlError::CampaignValidation(format!(
                "training outcome is not strict TCV1 JSON while normalizing: {error}"
            ))
        })?;
        let mut normalized = serde_json::from_str::<TrainingOutcome>(&json)?;
        normalized.outcome_fingerprint = zero_fingerprint();
        if let Some(calibration) = normalized.conformal_calibration.as_mut() {
            // A nested conformal record has its own TCV1 self-fingerprint.
            // Outcome normalization can canonicalize its binary64 lexical
            // representation, so re-sign it before emitting the enclosing
            // outcome and refresh the matching bundle reference atomically.
            calibration.calibration_fingerprint = calibration.compute_fingerprint()?;
            normalized.execution_bundle.conformal_calibration = Some(calibration.reference()?);
        }
        let normalized_json = serde_json::to_string(&normalized)?;
        let after = parse_typed_json(&normalized_json).map_err(|error| {
            DagMlError::CampaignValidation(format!(
                "training outcome is not strict TCV1 JSON after normalization: {error}"
            ))
        })?;
        if before != after {
            outcome = normalized;
            continue;
        }

        normalized.outcome_fingerprint =
            after
                .fingerprint_without("outcome_fingerprint")
                .map_err(|error| {
                    DagMlError::CampaignValidation(format!(
                        "training outcome TCV1 fingerprint failed after normalization: {error}"
                    ))
                })?;
        let signed_json = serde_json::to_string(&normalized)?;
        let signed = TrainingOutcome::from_json(&signed_json)?;
        return Ok(signed);
    }
    Err(DagMlError::CampaignValidation(
        "training outcome TCV1 JSON did not reach a serde canonical fixed point".to_string(),
    ))
}

fn zero_fingerprint() -> String {
    "0".repeat(64)
}

fn validate_native_training_options(request: &TrainingRequest) -> Result<()> {
    let resources = &request.options.resources;
    if resources.cpu_threads != request.options.scheduler.workers
        || resources.memory_bytes.is_some()
        || !resources.gpu_devices.is_empty()
        || resources.wall_time_ms.is_some()
    {
        return Err(DagMlError::RuntimeValidation(
            "native training V1 supports only cpu_threads=scheduler.workers with memory_bytes=null, gpu_devices=[], and wall_time_ms=null"
                .to_string(),
        ));
    }
    if request.options.artifacts.cv_artifacts != CvArtifactRetention::Discard {
        return Err(DagMlError::RuntimeValidation(
            "native training V1 supports only artifacts.cv_artifacts=discard".to_string(),
        ));
    }
    if !matches!(
        request.options.artifacts.fitted_artifacts,
        FittedArtifactMode::AllowHostSidecar | FittedArtifactMode::PortableRequired
    ) {
        return Err(DagMlError::RuntimeValidation(
            "native training V1 requires artifacts.fitted_artifacts=allow_host_sidecar or portable_required"
                .to_string(),
        ));
    }
    if request.options.artifacts.prediction_caches == PredictionCacheRetention::Discard
        && request
            .graph
            .edges
            .iter()
            .any(|edge| edge.contract.requires_oof)
    {
        return Err(DagMlError::RuntimeValidation(
            "native training V1 requires retained prediction caches for a stacking/requires_oof graph"
                .to_string(),
        ));
    }
    Ok(())
}

fn materialize_request_parameter_patches(
    mut plan: ExecutionPlan,
    request: &TrainingRequest,
) -> Result<ExecutionPlan> {
    for patch in &request.parameter_patches {
        match patch.namespace {
            ParameterNamespace::Operator => {}
            ParameterNamespace::Structural => {
                return Err(DagMlError::RuntimeValidation(
                    "native training requires recompilation for structural parameter patches; D6 runtime accepts only operator value patches"
                        .to_string(),
                ));
            }
            ParameterNamespace::Fit | ParameterNamespace::Control => {
                return Err(DagMlError::RuntimeValidation(format!(
                    "native training does not expose {:?} parameter patches to controllers yet; refusing to ignore them",
                    patch.namespace
                )));
            }
        }
        let node_plan = plan.node_plans.get_mut(&patch.node_id).ok_or_else(|| {
            DagMlError::RuntimeValidation(format!(
                "parameter patch references absent node `{}`",
                patch.node_id
            ))
        })?;
        deep_set_plan_param(
            &mut node_plan.params,
            &patch.path,
            patch.value.clone(),
            &patch.node_id,
        )?;
        node_plan.params_fingerprint = stable_json_fingerprint(&node_plan.params)?;
    }
    plan.validate()?;
    Ok(plan)
}

fn deep_set_plan_param(
    root: &mut BTreeMap<String, serde_json::Value>,
    path: &[String],
    value: serde_json::Value,
    node_id: &NodeId,
) -> Result<()> {
    if path.is_empty() {
        return contract_error("parameter patch path cannot be empty");
    }
    if path.len() == 1 {
        root.insert(path[0].clone(), value);
        return Ok(());
    }
    let first = root.get_mut(&path[0]).ok_or_else(|| {
        DagMlError::RuntimeValidation(format!(
            "parameter patch for `{node_id}` is missing intermediate path `{}`",
            path[0]
        ))
    })?;
    let mut cursor = first;
    for segment in &path[1..path.len() - 1] {
        let object = cursor.as_object_mut().ok_or_else(|| {
            DagMlError::RuntimeValidation(format!(
                "parameter patch for `{node_id}` crosses a scalar or array at `{segment}`"
            ))
        })?;
        cursor = object.get_mut(segment).ok_or_else(|| {
            DagMlError::RuntimeValidation(format!(
                "parameter patch for `{node_id}` is missing intermediate path `{segment}`"
            ))
        })?;
    }
    let object = cursor.as_object_mut().ok_or_else(|| {
        DagMlError::RuntimeValidation(format!(
            "parameter patch for `{node_id}` crosses a scalar or array before final key"
        ))
    })?;
    object.insert(path[path.len() - 1].clone(), value);
    Ok(())
}

fn validate_provider_attestations(
    projection: &TrainingContractProjection,
    request: &TrainingRequest,
    provider: &dyn RuntimeDataProvider,
    relations: &crate::relation::SampleRelationSet,
) -> Result<()> {
    relations.validate()?;
    let relation_fingerprint = relations.fingerprint()?;
    let identities = request
        .data_identities
        .iter()
        .map(|identity| (identity.requirement_key.as_str(), identity))
        .collect::<BTreeMap<_, _>>();
    for node_plan in projection.plan.node_plans.values() {
        for binding in &node_plan.data_bindings {
            let key = data_binding_requirement_key(&binding.node_id, &binding.input_name);
            let expected = identities.get(key.as_str()).ok_or_else(|| {
                DagMlError::RuntimeValidation(format!(
                    "native training request has no data identity for `{key}`"
                ))
            })?;
            let actual = provider.training_data_identity(binding)?.ok_or_else(|| {
                DagMlError::RuntimeValidation(format!(
                    "runtime data provider did not attest feature/target content for `{key}`"
                ))
            })?;
            actual.validate()?;
            if &actual != *expected {
                return Err(DagMlError::RuntimeValidation(format!(
                    "runtime data provider identity for `{key}` does not match signed training request"
                )));
            }
            let provider_relations = provider.coordinator_relations(binding)?;
            if binding.require_relations && provider_relations.is_none() {
                return Err(DagMlError::RuntimeValidation(format!(
                    "runtime data provider omitted required relations for `{key}`"
                )));
            }
            if let Some(provider_relations) = provider_relations {
                provider_relations.validate()?;
                if provider_relations.fingerprint()? != relation_fingerprint
                    || actual.relation_fingerprint != relation_fingerprint
                {
                    return Err(DagMlError::RuntimeValidation(format!(
                        "runtime data provider relations for `{key}` differ from training influence relations"
                    )));
                }
            }
        }
    }
    Ok(())
}

fn parse_selection_metric(request: &TrainingRequest) -> Result<RegressionMetricKind> {
    let metric = regression_metric_by_name(&request.options.selection.metric.name)?;
    if request.options.selection.metric.objective != metric.objective() {
        return Err(DagMlError::RuntimeValidation(format!(
            "selection metric `{}` has objective {:?}, expected {:?}",
            metric.name(),
            request.options.selection.metric.objective,
            metric.objective()
        )));
    }
    Ok(metric)
}

fn regression_metric_by_name(name: &str) -> Result<RegressionMetricKind> {
    RegressionMetricKind::from_name(name).ok_or_else(|| {
        DagMlError::RuntimeValidation(format!(
            "native training does not support selection metric `{name}`"
        ))
    })
}

fn validate_selection_prediction_kind(
    metric: RegressionMetricKind,
    prediction_kind: PredictionKind,
) -> Result<()> {
    RegressionMetricKind::resolve_for_prediction_kind(
        metric.name(),
        metric.objective(),
        prediction_kind,
    )
    .map(|_| ())
}

fn effective_selection_metric_level(request: &TrainingRequest) -> Result<PredictionLevel> {
    let campaign_level = request.campaign.aggregation_policy.selection_metric_level;
    if request
        .options
        .selection
        .required_metric_level
        .is_some_and(|level| level != campaign_level)
    {
        return Err(DagMlError::RuntimeValidation(
            "selection required_metric_level differs from campaign selection_metric_level"
                .to_string(),
        ));
    }
    if request.options.selection.evaluation_scope != Some(EvaluationScope::Oof) {
        return Err(DagMlError::RuntimeValidation(
            "native training V1 requires selection.evaluation_scope=oof".to_string(),
        ));
    }
    if request.options.selection.reduction_id.is_some() {
        return Err(DagMlError::RuntimeValidation(
            "native training V1 does not execute selection reduction_id".to_string(),
        ));
    }
    if request.options.selection.stacking_fit_contract.is_some() {
        return Err(DagMlError::RuntimeValidation(
            "native training V1 does not execute selection stacking_fit_contract".to_string(),
        ));
    }
    if !request.options.selection.require_finite {
        return Err(DagMlError::RuntimeValidation(
            "native training V1 requires selection.require_finite=true".to_string(),
        ));
    }
    if request.options.refit_strategy == Some(RefitStrategy::RefitEnsemble) {
        return Err(DagMlError::RuntimeValidation(
            "native training V1 does not implement refit_ensemble".to_string(),
        ));
    }
    match (
        request.options.refit,
        request.options.selection.refit_slot_plan.as_ref(),
    ) {
        (false, Some(_)) => Err(DagMlError::RuntimeValidation(
            "no-refit native training forbids selection.refit_slot_plan".to_string(),
        )),
        (true, Some(slot))
            if slot.strategy != RefitStrategy::RefitOne
                || slot.member_count != 1
                || slot.selection_level != campaign_level
                || slot.selection_metric != request.options.selection.metric
                || slot.reduction_id.is_some() =>
        {
            Err(DagMlError::RuntimeValidation(
                "selection.refit_slot_plan is not the exact native refit_one slot".to_string(),
            ))
        }
        _ => Ok(campaign_level),
    }
}

fn validate_selected_rerun_reports(
    retained: &[crate::metrics::RegressionMetricReport],
    rerun: &[crate::metrics::RegressionMetricReport],
    selected_variant_id: &VariantId,
) -> Result<()> {
    let mut retained = retained
        .iter()
        .filter(|report| report.variant_id.as_ref() == Some(selected_variant_id))
        .cloned()
        .collect::<Vec<_>>();
    let mut rerun = rerun
        .iter()
        .filter(|report| report.partition == PredictionPartition::Validation)
        .cloned()
        .map(|mut report| {
            report.variant_id = Some(selected_variant_id.clone());
            report.variant_label = None;
            report
        })
        .collect::<Vec<_>>();
    // A durable Methods HPO resume state records the one sample-level OOF
    // average that terminalized each native trial, rather than inventing a
    // free per-fold score transcript.  In that explicit contract, compare the
    // selected rerun against precisely those terminal report identities.  The
    // ordinary path retains every validation report and therefore continues to
    // require exact full-report coverage below.
    let terminal_oof_only = retained.iter().all(|report| {
        report.partition == PredictionPartition::Validation
            && report
                .fold_id
                .as_ref()
                .is_some_and(|fold| fold.as_str() == "avg")
            && report.level == PredictionLevel::Sample
    });
    if terminal_oof_only {
        rerun.retain(|actual| {
            retained.iter().any(|expected| {
                expected.producer_node == actual.producer_node
                    && expected.producer_port == actual.producer_port
                    && expected.fold_id == actual.fold_id
                    && expected.prediction_id == actual.prediction_id
                    && expected.level == actual.level
            })
        });
    }
    let sort = |reports: &mut Vec<crate::metrics::RegressionMetricReport>| {
        reports.sort_by(|left, right| {
            (
                &left.producer_node,
                &left.producer_port,
                &left.fold_id,
                &left.prediction_id,
                &left.level,
            )
                .cmp(&(
                    &right.producer_node,
                    &right.producer_port,
                    &right.fold_id,
                    &right.prediction_id,
                    &right.level,
                ))
        });
    };
    sort(&mut retained);
    sort(&mut rerun);
    if retained.is_empty()
        || retained.len() != rerun.len()
        || retained
            .iter()
            .zip(&rerun)
            .any(|(left, right)| !reports_match_rerun_tolerance(left, right))
    {
        return Err(DagMlError::RuntimeValidation(
            "selected variant FIT_CV rerun diverged from the reports that justified SELECT"
                .to_string(),
        ));
    }
    Ok(())
}

/// Native numerical libraries may differ by one rounding unit across a fresh
/// process/context.  Preserve report identity exactly, while comparing the
/// numeric evidence with the same tight tolerance used for portable replay.
fn reports_match_rerun_tolerance(
    left: &crate::metrics::RegressionMetricReport,
    right: &crate::metrics::RegressionMetricReport,
) -> bool {
    left.prediction_id == right.prediction_id
        && left.producer_node == right.producer_node
        && left.producer_port == right.producer_port
        && left.variant_id == right.variant_id
        && left.variant_label == right.variant_label
        && left.partition == right.partition
        && left.fold_id == right.fold_id
        && left.level == right.level
        && left.row_count == right.row_count
        && left.target_width == right.target_width
        && left.target_names == right.target_names
        && left.metrics.len() == right.metrics.len()
        && left.metrics.iter().all(|(name, value)| {
            right
                .metrics
                .get(name)
                .is_some_and(|other| (value - other).abs() <= 1.0e-12)
        })
}

fn validate_selection_report_levels(
    reports: &[crate::metrics::RegressionMetricReport],
    producer: &NodeId,
    producer_port: &Option<String>,
    expected: PredictionLevel,
) -> Result<()> {
    let target_reports = reports
        .iter()
        .filter(|report| {
            &report.producer_node == producer
                && &report.producer_port == producer_port
                && report.level == expected
        })
        .collect::<Vec<_>>();
    if target_reports.is_empty() {
        return Err(DagMlError::RuntimeValidation(format!(
            "native SELECT target `{producer}` port {producer_port:?} has no reports at required metric level {expected:?}"
        )));
    }
    Ok(())
}

fn bind_selection_decision(
    decision: &mut SelectionDecision,
    request: &TrainingRequest,
    metric_level: PredictionLevel,
) -> Result<()> {
    decision.policy_id = request.options.selection.id.clone();
    decision.metric_level = Some(metric_level);
    decision.evaluation_scope = Some(EvaluationScope::Oof);
    decision.refit_slot_plan = request.options.selection.refit_slot_plan.clone();
    decision.reduction_id = None;
    decision.validate()
}

fn materialize_selected_variant(
    mut plan: ExecutionPlan,
    selected_variant_id: &VariantId,
) -> Result<ExecutionPlan> {
    let selected = plan
        .variants
        .iter()
        .find(|variant| &variant.variant_id == selected_variant_id)
        .cloned()
        .ok_or_else(|| {
            DagMlError::RuntimeValidation(format!(
                "selected variant `{selected_variant_id}` is absent from plan"
            ))
        })?;
    let variant = VariantExecutionSpec::from_plan(&selected);
    variant.validate()?;
    for (node_id, node_plan) in &mut plan.node_plans {
        node_plan.params = variant.effective_params_for_node(node_id, &node_plan.params)?;
        node_plan.params_fingerprint = stable_json_fingerprint(&node_plan.params)?;
    }
    plan.validate()?;
    Ok(plan)
}

fn is_cv_ensemble_partition(partition: &PredictionPartition) -> bool {
    match partition {
        PredictionPartition::Validation => true,
        PredictionPartition::Train | PredictionPartition::Test | PredictionPartition::Final => {
            false
        }
    }
}

fn producer_port_matches_graph_output(
    plan: &ExecutionPlan,
    node_id: &NodeId,
    port_name: &str,
    producer_port: &Option<String>,
) -> bool {
    if let Some(producer_port) = producer_port {
        return producer_port == port_name;
    }
    let Some(node) = plan
        .graph_plan
        .graph
        .nodes
        .iter()
        .find(|node| &node.id == node_id)
    else {
        return false;
    };
    let prediction_ports = node
        .ports
        .outputs
        .iter()
        .filter(|port| port.kind == PortKind::Prediction)
        .collect::<Vec<_>>();
    prediction_ports.len() == 1 && prediction_ports[0].name == port_name
}

fn bind_training_outputs(
    outputs: &[ResolvedTrainingOutput],
    request: &TrainingRequest,
    plan: &ExecutionPlan,
    fit_cv_results: &[NodeResult],
    refit_results: &[NodeResult],
    ctx: &RunContext,
) -> Result<Vec<BoundTrainingOutput>> {
    let source = if request.options.refit {
        refit_results
    } else {
        fit_cv_results
    };
    let aggregation_fingerprint = tcv1_fingerprint(
        &plan.campaign.aggregation_policy,
        "training output aggregation policy",
    )?;
    let mut bound = Vec::with_capacity(outputs.len());
    for output in outputs {
        let mut binding = OutputBinding {
            schema_version: OUTPUT_BINDING_SCHEMA_VERSION,
            binding_id: output.output_id.clone(),
            node_id: output.node_id.clone(),
            port_name: output.port_name.clone(),
            prediction_level: output.prediction_level,
            unit_level: output.unit_level,
            prediction_kind: output.prediction_kind,
            prediction_source: if request.options.refit {
                PredictionSource::FinalRefit
            } else {
                PredictionSource::CvEnsemble
            },
            refit_strategy: request.options.refit_strategy,
            aggregation_fingerprint: aggregation_fingerprint.clone(),
            target_names: output.target_names.clone(),
            target_units: output.target_units.clone(),
            class_labels: output.class_labels.clone(),
            output_order: output.output_order,
            target_space: output.target_space.clone(),
            binding_fingerprint: zero_fingerprint(),
        };
        binding.binding_fingerprint = binding.compute_fingerprint()?;

        let node_results = source
            .iter()
            .filter(|result| result.node_id == output.node_id)
            .collect::<Vec<_>>();
        let mut predictions = Vec::new();
        let mut observation_predictions = Vec::new();
        let mut aggregated_predictions = Vec::new();
        match output.prediction_level {
            PredictionLevel::Observation => {
                for result in node_results {
                    observation_predictions.extend(
                        result
                            .observation_predictions
                            .iter()
                            .filter(|block| {
                                producer_port_matches_graph_output(
                                    plan,
                                    &output.node_id,
                                    &output.port_name,
                                    &block.producer_port,
                                ) && (request.options.refit
                                    || is_cv_ensemble_partition(&block.partition))
                            })
                            .cloned(),
                    );
                }
            }
            PredictionLevel::Sample => {
                for result in node_results {
                    predictions.extend(
                        result
                            .predictions
                            .iter()
                            .filter(|block| {
                                producer_port_matches_graph_output(
                                    plan,
                                    &output.node_id,
                                    &output.port_name,
                                    &block.producer_port,
                                ) && (request.options.refit
                                    || is_cv_ensemble_partition(&block.partition))
                            })
                            .cloned(),
                    );
                    aggregated_predictions.extend(
                        result
                            .aggregated_predictions
                            .iter()
                            .filter(|block| {
                                producer_port_matches_graph_output(
                                    plan,
                                    &output.node_id,
                                    &output.port_name,
                                    &block.producer_port,
                                ) && block.level == PredictionLevel::Sample
                                    && (request.options.refit
                                        || is_cv_ensemble_partition(&block.partition))
                            })
                            .cloned(),
                    );
                }
                if !request.options.refit {
                    aggregated_predictions.extend(
                        ctx.oof_average_blocks
                            .iter()
                            .filter(|average| {
                                average.predictions.producer_node == output.node_id
                                    && producer_port_matches_graph_output(
                                        plan,
                                        &output.node_id,
                                        &output.port_name,
                                        &average.predictions.producer_port,
                                    )
                                    && is_cv_ensemble_partition(&average.predictions.partition)
                            })
                            .map(|average| average.predictions.clone()),
                    );
                }
            }
            PredictionLevel::Target | PredictionLevel::Group => {
                for result in node_results {
                    aggregated_predictions.extend(
                        result
                            .aggregated_predictions
                            .iter()
                            .filter(|block| {
                                producer_port_matches_graph_output(
                                    plan,
                                    &output.node_id,
                                    &output.port_name,
                                    &block.producer_port,
                                ) && block.level == output.prediction_level
                                    && (request.options.refit
                                        || is_cv_ensemble_partition(&block.partition))
                            })
                            .cloned(),
                    );
                }
            }
        }
        predictions.sort_by(|left, right| {
            (
                &left.partition,
                &left.fold_id,
                &left.prediction_id,
                &left.sample_ids,
            )
                .cmp(&(
                    &right.partition,
                    &right.fold_id,
                    &right.prediction_id,
                    &right.sample_ids,
                ))
        });
        observation_predictions.sort_by(|left, right| {
            (
                &left.partition,
                &left.fold_id,
                &left.prediction_id,
                &left.observation_ids,
            )
                .cmp(&(
                    &right.partition,
                    &right.fold_id,
                    &right.prediction_id,
                    &right.observation_ids,
                ))
        });
        aggregated_predictions.sort_by(|left, right| {
            (
                &left.partition,
                &left.fold_id,
                &left.prediction_id,
                &left.unit_ids,
            )
                .cmp(&(
                    &right.partition,
                    &right.fold_id,
                    &right.prediction_id,
                    &right.unit_ids,
                ))
        });
        aggregated_predictions.dedup();
        let output = BoundTrainingOutput {
            schema_version: Some(BOUND_TRAINING_OUTPUT_SCHEMA_VERSION),
            binding,
            predictions,
            observation_predictions,
            aggregated_predictions,
        };
        output.validate(plan)?;
        bound.push(output);
    }
    Ok(bound)
}

/// Derive portable OOF requirements from the blocks produced by an existing
/// FIT_CV execution. Shared by the training operation and host capture paths.
pub fn build_oof_prediction_requirements(
    plan: &ExecutionPlan,
    blocks: &[PredictionBlock],
    aggregated_blocks: &[AggregatedPredictionBlock],
) -> Result<Vec<BundlePredictionRequirement>> {
    let mut requirements = Vec::new();
    for edge in plan
        .graph_plan
        .graph
        .edges
        .iter()
        .filter(|edge| edge.contract.requires_oof)
    {
        // Nested stacking retains two validation-OOF evidence classes in one
        // run context: parent outer-fold rows for report/refit, and child
        // inner-fold rows used solely to train each outer-fold meta model.
        // Portable caches are the refit pool, so they must retain only the
        // report-grade outer rows.  Keeping child rows here would duplicate
        // sample ids across outer scopes and violate the cache's exact OOF
        // identity contract.
        let report_fold_ids = if is_nested_stacking_meta_node(plan, &edge.target.node_id)? {
            Some(
                plan.fold_set
                    .as_ref()
                    .ok_or_else(|| {
                        DagMlError::RuntimeValidation(
                            "nested stacking requires an attested outer fold set".to_string(),
                        )
                    })?
                    .folds
                    .iter()
                    .map(|fold| fold.fold_id.clone())
                    .collect::<BTreeSet<_>>(),
            )
        } else {
            None
        };
        let source_plan = plan.node_plans.get(&edge.source.node_id).ok_or_else(|| {
            DagMlError::RuntimeValidation(format!(
                "OOF edge source `{}` has no node plan",
                edge.source.node_id
            ))
        })?;
        let prediction_level = source_plan
            .shape_plan
            .as_ref()
            .map(|shape| shape.aggregation_policy.aggregation_level)
            .unwrap_or(PredictionLevel::Sample);
        let mut fold_ids = BTreeSet::<FoldId>::new();
        let mut sample_ids = BTreeSet::<SampleId>::new();
        let mut unit_ids = BTreeSet::<PredictionUnitId>::new();
        let mut width = None;
        let mut target_names: Option<Vec<String>> = None;

        match prediction_level {
            PredictionLevel::Sample => {
                let selected = blocks
                    .iter()
                    .filter(|block| {
                        block.producer_node == edge.source.node_id
                            && producer_port_matches_graph_output(
                                plan,
                                &edge.source.node_id,
                                &edge.source.port_name,
                                &block.producer_port,
                            )
                            && block.partition == PredictionPartition::Validation
                            && report_fold_ids.as_ref().is_none_or(|fold_ids| {
                                block
                                    .fold_id
                                    .as_ref()
                                    .is_some_and(|fold_id| fold_ids.contains(fold_id))
                            })
                    })
                    .collect::<Vec<_>>();
                if selected.is_empty() {
                    return Err(DagMlError::RuntimeValidation(format!(
                        "OOF requirement `{}` -> `{}` has no validation sample blocks",
                        edge.source.node_id, edge.target.node_id
                    )));
                }
                for block in selected {
                    let block_width = block.validate_shape()?;
                    merge_oof_shape(
                        &edge.source.node_id,
                        &mut width,
                        &mut target_names,
                        block_width,
                        &block.target_names,
                    )?;
                    if let Some(fold_id) = &block.fold_id {
                        fold_ids.insert(fold_id.clone());
                    }
                    sample_ids.extend(block.sample_ids.iter().cloned());
                }
            }
            PredictionLevel::Target | PredictionLevel::Group => {
                let selected = aggregated_blocks
                    .iter()
                    .filter(|block| {
                        block.producer_node == edge.source.node_id
                            && producer_port_matches_graph_output(
                                plan,
                                &edge.source.node_id,
                                &edge.source.port_name,
                                &block.producer_port,
                            )
                            && block.partition == PredictionPartition::Validation
                            && block.level == prediction_level
                            && report_fold_ids.as_ref().is_none_or(|fold_ids| {
                                block
                                    .fold_id
                                    .as_ref()
                                    .is_some_and(|fold_id| fold_ids.contains(fold_id))
                            })
                    })
                    .collect::<Vec<_>>();
                if selected.is_empty() {
                    return Err(DagMlError::RuntimeValidation(format!(
                        "OOF requirement `{}` -> `{}` has no validation {prediction_level:?} blocks",
                        edge.source.node_id, edge.target.node_id
                    )));
                }
                for block in selected {
                    let block_width = block.validate_shape()?;
                    merge_oof_shape(
                        &edge.source.node_id,
                        &mut width,
                        &mut target_names,
                        block_width,
                        &block.target_names,
                    )?;
                    if let Some(fold_id) = &block.fold_id {
                        fold_ids.insert(fold_id.clone());
                    }
                    unit_ids.extend(block.unit_ids.iter().cloned());
                }
            }
            PredictionLevel::Observation => {
                return Err(DagMlError::RuntimeValidation(format!(
                    "OOF requirement `{}` -> `{}` cannot persist observation-level predictions; aggregate before refit",
                    edge.source.node_id, edge.target.node_id
                )));
            }
        }
        let requirement = BundlePredictionRequirement {
            producer_node: edge.source.node_id.clone(),
            source_port: edge.source.port_name.clone(),
            consumer_node: edge.target.node_id.clone(),
            target_port: edge.target.port_name.clone(),
            partition: PredictionPartition::Validation,
            prediction_level,
            fold_ids: fold_ids.into_iter().collect(),
            unit_ids: unit_ids.into_iter().collect(),
            sample_ids: sample_ids.into_iter().collect(),
            prediction_width: width.unwrap_or_default(),
            target_names: target_names.unwrap_or_default(),
        };
        requirement.validate()?;
        requirements.push(requirement);
    }
    requirements.sort_by_key(BundlePredictionRequirement::key);
    Ok(requirements)
}

fn merge_oof_shape(
    producer: &NodeId,
    expected_width: &mut Option<usize>,
    expected_names: &mut Option<Vec<String>>,
    width: usize,
    names: &[String],
) -> Result<()> {
    if expected_width.is_some_and(|expected| expected != width) {
        return Err(DagMlError::RuntimeValidation(format!(
            "OOF requirement for `{producer}` has inconsistent prediction width"
        )));
    }
    *expected_width = Some(width);
    let names = if names.is_empty() {
        (0..width).map(|index| format!("p{index}")).collect()
    } else {
        names.to_vec()
    };
    if expected_names
        .as_ref()
        .is_some_and(|expected| expected != &names)
    {
        return Err(DagMlError::RuntimeValidation(format!(
            "OOF requirement for `{producer}` has inconsistent target names"
        )));
    }
    *expected_names = Some(names);
    Ok(())
}

pub fn build_oof_prediction_cache_records(
    requirements: &[BundlePredictionRequirement],
    blocks: &[PredictionBlock],
    aggregated_blocks: &[AggregatedPredictionBlock],
) -> Result<Vec<BundlePredictionCacheRecord>> {
    requirements
        .iter()
        .map(|requirement| match requirement.prediction_level {
            PredictionLevel::Sample => build_prediction_cache_record(requirement, blocks),
            PredictionLevel::Target | PredictionLevel::Group => {
                build_aggregated_prediction_cache_record(requirement, aggregated_blocks)
            }
            PredictionLevel::Observation => Err(DagMlError::RuntimeValidation(format!(
                "prediction cache requirement `{}` cannot use observation-level predictions",
                requirement.key()
            ))),
        })
        .collect()
}

pub fn build_oof_prediction_cache_payloads(
    requirements: &[BundlePredictionRequirement],
    blocks: &[PredictionBlock],
    aggregated_blocks: &[AggregatedPredictionBlock],
) -> Result<Vec<BundlePredictionCachePayload>> {
    requirements
        .iter()
        .map(|requirement| match requirement.prediction_level {
            PredictionLevel::Sample => build_prediction_cache_payload(requirement, blocks),
            PredictionLevel::Target | PredictionLevel::Group => {
                build_aggregated_prediction_cache_payload(requirement, aggregated_blocks)
            }
            PredictionLevel::Observation => Err(DagMlError::RuntimeValidation(format!(
                "prediction cache requirement `{}` cannot use observation-level predictions",
                requirement.key()
            ))),
        })
        .collect()
}

fn attach_oof_prediction_cache_namespaces(
    plan: &ExecutionPlan,
    data_identities: &[TrainingDataIdentity],
    selected_variant_id: &VariantId,
    seed: u64,
    requirements: &[BundlePredictionRequirement],
    records: &mut [BundlePredictionCacheRecord],
    payloads: &mut [BundlePredictionCachePayload],
) -> Result<()> {
    let requirements_by_key = requirements
        .iter()
        .map(|requirement| (requirement.key(), requirement))
        .collect::<BTreeMap<_, _>>();
    for record in records {
        let requirement = requirements_by_key
            .get(&record.requirement_key)
            .ok_or_else(|| {
                DagMlError::RuntimeValidation(format!(
                    "prediction cache `{}` references unknown OOF requirement `{}`",
                    record.cache_id, record.requirement_key
                ))
            })?;
        let fingerprints = oof_cache_namespace_fingerprints(
            plan,
            data_identities,
            selected_variant_id,
            seed,
            requirement,
            record,
        )?;
        record.cache_namespace_fingerprints = fingerprints.clone();
        let payload = payloads
            .iter_mut()
            .find(|payload| payload.requirement_key == record.requirement_key)
            .ok_or_else(|| {
                DagMlError::RuntimeValidation(format!(
                    "prediction cache `{}` has no portable payload for requirement `{}`",
                    record.cache_id, record.requirement_key
                ))
            })?;
        payload.cache_namespace_fingerprints = fingerprints;
        validate_prediction_cache_payload_matches_record(payload, record)?;
    }
    Ok(())
}

fn oof_cache_namespace_fingerprints(
    plan: &ExecutionPlan,
    data_identities: &[TrainingDataIdentity],
    selected_variant_id: &VariantId,
    seed: u64,
    requirement: &BundlePredictionRequirement,
    record: &BundlePredictionCacheRecord,
) -> Result<Vec<String>> {
    let producer_plan = plan
        .node_plans
        .get(&requirement.producer_node)
        .ok_or_else(|| {
            DagMlError::RuntimeValidation(format!(
                "prediction cache `{}` producer node `{}` is absent from plan",
                record.cache_id, requirement.producer_node
            ))
        })?;
    let consumer_plan = plan
        .node_plans
        .get(&requirement.consumer_node)
        .ok_or_else(|| {
            DagMlError::RuntimeValidation(format!(
                "prediction cache `{}` consumer node `{}` is absent from plan",
                record.cache_id, requirement.consumer_node
            ))
        })?;
    let identity_binding = match (
        producer_plan.data_bindings.as_slice(),
        consumer_plan.data_bindings.as_slice(),
    ) {
        ([binding], _) => binding,
        ([], [binding]) => binding,
        (producer_bindings, consumer_bindings) => {
            let producer_count = producer_bindings.len();
            let consumer_count = consumer_bindings.len();
            return Err(DagMlError::RuntimeValidation(format!(
                "prediction cache `{}` cannot derive a unique CacheNamespace for edge `{}.{}` -> `{}.{}` with {producer_count} producer data binding(s) and {consumer_count} consumer data binding(s)",
                record.cache_id,
                requirement.producer_node,
                requirement.source_port,
                requirement.consumer_node,
                requirement.target_port
            )));
        }
    };
    if producer_plan.data_bindings.len() > 1 || consumer_plan.data_bindings.len() > 1 {
        return Err(DagMlError::RuntimeValidation(format!(
            "prediction cache `{}` cannot derive a unique CacheNamespace for edge `{}.{}` -> `{}.{}` with ambiguous data bindings",
            record.cache_id,
            requirement.producer_node,
            requirement.source_port,
            requirement.consumer_node,
            requirement.target_port
        )));
    }
    let data_requirement_key =
        data_binding_requirement_key(&identity_binding.node_id, &identity_binding.input_name);
    let identity = data_identities
        .iter()
        .find(|identity| identity.requirement_key == data_requirement_key)
        .ok_or_else(|| {
            DagMlError::RuntimeValidation(format!(
                "prediction cache `{}` has no training data identity for `{data_requirement_key}`",
                record.cache_id
            ))
        })?;
    let mut fingerprints = Vec::with_capacity(record.blocks.len());
    for block in &record.blocks {
        let fold_id = block.fold_id.clone().ok_or_else(|| {
            DagMlError::RuntimeValidation(format!(
                "prediction cache `{}` has a cache block without fold_id",
                record.cache_id
            ))
        })?;
        let namespace = CacheNamespace::new(
            requirement.key(),
            identity.requirement_key.clone(),
            requirement.producer_node.clone(),
            requirement.source_port.clone(),
            requirement.consumer_node.clone(),
            requirement.target_port.clone(),
            producer_plan.params_fingerprint.clone(),
            identity.identity_fingerprint.clone(),
            fold_id,
            selected_variant_id.to_string(),
            seed,
        )?;
        namespace.validate_for_identity(identity)?;
        fingerprints.push(namespace.namespace_fingerprint);
    }
    Ok(fingerprints)
}

impl TrainingOutcome {
    /// Strictly parse a self-fingerprinted W0 outcome without losing the JSON
    /// integer-versus-binary64 token distinction before verification.
    pub fn from_json(json: &str) -> Result<Self> {
        let typed = parse_typed_json(json).map_err(|error| {
            DagMlError::CampaignValidation(format!(
                "training outcome is not strict TCV1 JSON: {error}"
            ))
        })?;
        let raw_fingerprint =
            typed
                .fingerprint_without("outcome_fingerprint")
                .map_err(|error| {
                    DagMlError::CampaignValidation(format!(
                        "training outcome fingerprint preimage is invalid: {error}"
                    ))
                })?;
        let outcome: Self = serde_json::from_str(json)?;
        if outcome.outcome_fingerprint != raw_fingerprint {
            return contract_error(
                "training outcome fingerprint does not match original TCV1 JSON",
            );
        }
        outcome.validate()?;
        Ok(outcome)
    }

    pub fn compute_fingerprint(&self) -> Result<String> {
        tcv1_fingerprint_without(self, "outcome_fingerprint", "training outcome")
    }

    pub fn data_identities_fingerprint(&self) -> Result<String> {
        tcv1_fingerprint(&self.data_identities, "training outcome data identities")
    }

    pub fn execution_bundle_fingerprint(&self) -> Result<String> {
        tcv1_fingerprint(&self.execution_bundle, "training outcome execution bundle")
    }

    fn pre_conformal_outcome(&self) -> Result<Self> {
        let mut source = self.clone();
        source.conformal_calibration = None;
        source.conformal_calibration_replay = None;
        source.execution_bundle.conformal_calibration = None;
        stabilize_training_outcome_for_tcv1(source)
    }

    fn pre_conformal_outcome_fingerprint(&self) -> Result<String> {
        Ok(self.pre_conformal_outcome()?.outcome_fingerprint)
    }

    /// Attach native split-conformal state after an ordinary identity-attested
    /// calibration replay.  The bundle retains a typed reference and the
    /// outcome owns the complete signed quantiles.
    pub(crate) fn attach_conformal_calibration(
        &mut self,
        calibration: ConformalCalibration,
        replay: TrainingReplayOutcome,
    ) -> Result<()> {
        self.validate()?;
        calibration.validate()?;
        let request = replay_request_from_outcome(&replay);
        replay.validate_against(self, &request)?;
        let binding = self
            .outputs
            .iter()
            .find(|output| output.binding.binding_id == calibration.binding_id)
            .ok_or_else(|| {
                DagMlError::RuntimeValidation(
                    "conformal calibration binding is absent from training outcome".to_string(),
                )
            })?;
        if binding.binding.target_names != calibration.target_names {
            return Err(DagMlError::RuntimeValidation(
                "conformal calibration target order does not match training outcome binding"
                    .to_string(),
            ));
        }
        let fold_set = self.effective_plan.fold_set.as_ref().ok_or_else(|| {
            DagMlError::RuntimeValidation(
                "conformal calibration requires a source FoldSet".to_string(),
            )
        })?;
        let context = &calibration.context;
        if context.predictor_binding_fingerprint != binding.binding.binding_fingerprint
            || context.source_training_outcome_fingerprint != self.outcome_fingerprint
            || context.data_identities_fingerprint != self.data_identities_fingerprint()?
            || context.fold_set_fingerprint != fold_set_fingerprint(fold_set)?
            || context.training_influence_fingerprint
                != self.training_influence.manifest_fingerprint
        {
            return Err(DagMlError::RuntimeValidation(
                "conformal calibration context does not exactly match its training outcome"
                    .to_string(),
            ));
        }
        let training_ids = self
            .training_influence
            .entries
            .iter()
            .flat_map(|entry| {
                entry
                    .physical_sample_ids
                    .iter()
                    .chain(entry.origin_sample_ids.iter())
            })
            .collect::<BTreeSet<_>>();
        if context
            .calibration_cohort
            .physical_sample_ids
            .iter()
            .chain(context.calibration_cohort.origin_sample_ids.iter())
            .any(|id| training_ids.contains(id))
        {
            return Err(DagMlError::RuntimeValidation(
                "conformal calibration cohort overlaps training influence closure".to_string(),
            ));
        }
        self.execution_bundle.conformal_calibration = Some(calibration.reference()?);
        self.conformal_calibration = Some(calibration);
        self.conformal_calibration_replay = Some(replay);
        *self = stabilize_training_outcome_for_tcv1(self.clone())?;
        self.validate()
    }

    /// Build the compact cross-link embedded by a portable predictor package.
    pub fn to_reference(&self) -> Result<TrainingOutcomeRef> {
        self.validate()?;
        validate_sha256(
            "training outcome request",
            &self.training_request_fingerprint,
        )?;
        Ok(TrainingOutcomeRef {
            outcome_id: self.outcome_id.clone(),
            outcome_fingerprint: self.outcome_fingerprint.clone(),
            pre_conformal_outcome_fingerprint: self
                .conformal_calibration
                .as_ref()
                .map(|_| self.pre_conformal_outcome_fingerprint())
                .transpose()?,
            training_request_fingerprint: self.training_request_fingerprint.clone(),
            effective_plan_fingerprint: self.effective_plan_fingerprint.clone(),
            execution_bundle_id: self.execution_bundle.bundle_id.clone(),
            execution_bundle_fingerprint: self.execution_bundle_fingerprint()?,
            data_identities_fingerprint: self.data_identities_fingerprint()?,
            output_binding_fingerprints: self
                .outputs
                .iter()
                .map(|output| output.binding.binding_fingerprint.clone())
                .collect(),
            training_influence_fingerprint: self.training_influence.manifest_fingerprint.clone(),
        })
    }

    /// Export a self-contained portable predictor package contract from this
    /// training outcome. Runtime handles are never serialized; host-sidecar
    /// artifacts are represented only by their signed artifact descriptors and
    /// must be resolved into process-local handles by `PortablePredictorPackage::load_with`.
    pub fn to_portable_predictor_package(
        &self,
        package_id: impl Into<String>,
        fitted_artifact_mode: FittedArtifactMode,
        artifact_load_mode: ArtifactLoadMode,
    ) -> Result<PortablePredictorPackage> {
        self.validate()?;
        let mut template = PredictorTemplate {
            graph: self.effective_plan.graph_plan.graph.clone(),
            campaign: self.effective_plan.campaign.clone(),
            controller_manifests: self.effective_plan.controller_manifests.clone(),
            template_fingerprint: zero_fingerprint(),
        };
        template.template_fingerprint = template.compute_fingerprint()?;

        let output_bindings = self
            .outputs
            .iter()
            .map(|output| output.binding.clone())
            .collect::<Vec<_>>();
        let predictor_node_ids = predictor_closure(
            &self.effective_plan,
            output_bindings
                .iter()
                .map(|binding| binding.node_id.clone()),
        )?
        .into_iter()
        .collect::<Vec<_>>();
        let mut artifact_bindings = self
            .execution_bundle
            .refit_artifacts
            .iter()
            .map(|record| PackageArtifactBinding {
                artifact_id: record.artifact.id.clone(),
                load_mode: artifact_load_mode,
            })
            .collect::<Vec<_>>();
        artifact_bindings.sort_by(|left, right| left.artifact_id.cmp(&right.artifact_id));
        let mut package = PortablePredictorPackage {
            schema_version: PORTABLE_PREDICTOR_PACKAGE_SCHEMA_VERSION,
            package_id: package_id.into(),
            template,
            training_request_fingerprint: self.training_request_fingerprint.clone(),
            training_outcome: self.to_reference()?,
            effective_plan: self.effective_plan.clone(),
            execution_bundle: self.execution_bundle.clone(),
            conformal_calibration: self.conformal_calibration.clone(),
            conformal_calibration_replay: self.conformal_calibration_replay.clone(),
            output_bindings,
            predictor_node_ids,
            training_influence: self.training_influence.clone(),
            data_identities: self.data_identities.clone(),
            fitted_artifact_mode,
            artifact_bindings,
            package_fingerprint: zero_fingerprint(),
        };
        package.package_fingerprint = package.compute_fingerprint()?;
        package.validate()?;
        Ok(package)
    }

    pub fn validate(&self) -> Result<()> {
        if self.schema_version < MIN_READABLE_TRAINING_OUTCOME_SCHEMA_VERSION
            || self.schema_version > TRAINING_OUTCOME_SCHEMA_VERSION
        {
            return contract_error(format!(
                "training outcome schema_version {} is unsupported; maximum readable version is {}",
                self.schema_version, TRAINING_OUTCOME_SCHEMA_VERSION
            ));
        }
        RunId::new(self.outcome_id.clone()).map_err(|error| {
            DagMlError::CampaignValidation(format!(
                "training outcome_id is not a portable identifier: {error}"
            ))
        })?;
        validate_sha256(
            "training outcome request",
            &self.training_request_fingerprint,
        )?;
        validate_sha256("training outcome plan", &self.effective_plan_fingerprint)?;
        validate_sha256(
            "training outcome selected variant",
            &self.selected_variant_fingerprint,
        )?;
        validate_sha256("training outcome", &self.outcome_fingerprint)?;
        self.effective_plan.validate()?;
        if self.effective_plan_fingerprint
            != tcv1_fingerprint(&self.effective_plan, "training outcome effective plan")?
        {
            return contract_error(
                "training outcome effective_plan_fingerprint does not match TCV1 plan content",
            );
        }

        let selected = self
            .effective_plan
            .variants
            .iter()
            .filter(|variant| variant.variant_id == self.selected_variant_id)
            .collect::<Vec<_>>();
        let [selected] = selected.as_slice() else {
            return contract_error(
                "training outcome selected_variant_id is absent or duplicated in effective plan",
            );
        };
        if selected.fingerprint != self.selected_variant_fingerprint {
            return contract_error(
                "training outcome selected_variant_fingerprint does not match effective plan",
            );
        }
        let expected_patches = selected_variant_parameter_patches(selected)?;
        validate_outcome_parameter_patches(
            &self.effective_plan,
            &self.parameter_patches,
            &expected_patches,
        )?;
        if !self.parameter_patches.is_empty()
            && !self
                .training_influence
                .entries
                .iter()
                .any(|entry| entry.kind == TrainingInfluenceKind::HpoSelection)
        {
            return contract_error(
                "training outcome parameter patches require hpo_selection influence",
            );
        }

        self.validate_refit()?;
        self.score_set.validate()?;
        self.validate_version_family()?;
        if self.schema_version == LEGACY_TRAINING_OUTCOME_SCHEMA_VERSION
            && (self.conformal_calibration.is_some() || self.conformal_calibration_replay.is_some())
        {
            return contract_error(
                "training outcome V1 cannot carry conformal state; migrate to V2",
            );
        }
        if self.score_set.plan_id != self.effective_plan.id {
            return contract_error("training outcome score_set.plan_id does not match plan");
        }
        if !self
            .score_set
            .reports
            .iter()
            .any(|report| report.variant_id.as_ref() == Some(&self.selected_variant_id))
        {
            return contract_error("training outcome score_set has no report for selected variant");
        }
        self.validate_selection_decision()?;

        let closure = self.validate_outputs()?;
        let expected_predictor_execution_closure = self
            .effective_plan
            .node_plans
            .keys()
            .cloned()
            .collect::<BTreeSet<_>>();
        if closure != expected_predictor_execution_closure {
            return contract_error(
                "training outcome predictor closure does not equal the explicit V1 predictor execution closure",
            );
        }
        self.training_influence.validate()?;
        validate_influence_against_closure(
            &self.training_influence,
            &self.effective_plan,
            &closure,
        )?;
        let base_fit_nodes = self
            .training_influence
            .entries
            .iter()
            .filter(|entry| {
                matches!(
                    entry.kind,
                    TrainingInfluenceKind::TransformFit
                        | TrainingInfluenceKind::ModelFit
                        | TrainingInfluenceKind::TrainedMetaAggregation
                )
            })
            .filter_map(|entry| entry.node_id.clone())
            .collect::<BTreeSet<_>>();
        if self
            .outputs
            .iter()
            .any(|output| !base_fit_nodes.contains(&output.binding.node_id))
        {
            return contract_error("training outcome output node has no fitting influence");
        }

        self.execution_bundle
            .validate_against_plan(&self.effective_plan)?;
        if self.execution_bundle.selected_variant_id.as_ref() != Some(&self.selected_variant_id) {
            return contract_error(
                "training outcome execution bundle selected variant does not match outcome",
            );
        }
        if self.execution_bundle.scores.as_ref() != Some(&self.score_set) {
            return contract_error(
                "training outcome execution bundle scores do not equal score_set",
            );
        }
        if self.execution_bundle.methods_hpo_resume_state != self.methods_hpo_resume_state {
            return contract_error(
                "training outcome Methods HPO resume state does not equal execution bundle state",
            );
        }
        match (
            &self.conformal_calibration,
            &self.conformal_calibration_replay,
            &self.execution_bundle.conformal_calibration,
        ) {
            (Some(calibration), Some(replay), Some(reference)) => {
                reference.validate_against(calibration)?;
                let pre_conformal_source = self.pre_conformal_outcome()?;
                let replay_request = replay_request_from_outcome(replay);
                replay.validate_against(&pre_conformal_source, &replay_request)?;
                let binding = self
                    .outputs
                    .iter()
                    .find(|output| output.binding.binding_id == calibration.binding_id)
                    .ok_or_else(|| {
                        DagMlError::RuntimeValidation(
                            "conformal calibration binding is absent from training outcome"
                                .to_string(),
                        )
                    })?;
                let fold_set = self.effective_plan.fold_set.as_ref().ok_or_else(|| {
                    DagMlError::RuntimeValidation(
                        "conformal calibration requires a source FoldSet".to_string(),
                    )
                })?;
                let context = &calibration.context;
                if binding.binding.target_names != calibration.target_names
                    || context.predictor_binding_fingerprint != binding.binding.binding_fingerprint
                    || context.source_training_outcome_fingerprint
                        != pre_conformal_source.outcome_fingerprint
                    || context.calibration_replay_outcome_fingerprint != replay.outcome_fingerprint
                    || context.data_identities_fingerprint != self.data_identities_fingerprint()?
                    || context.fold_set_fingerprint != fold_set_fingerprint(fold_set)?
                    || context.training_influence_fingerprint
                        != self.training_influence.manifest_fingerprint
                {
                    return contract_error(
                        "training outcome conformal context does not exactly cross-link its pre-calibration source",
                    );
                }
                if context.relation_fingerprint == self.training_influence.relation_fingerprint {
                    return contract_error(
                        "training outcome calibration relation authority must be distinct from development relations",
                    );
                }
                let replay_output = replay
                    .outputs
                    .iter()
                    .find(|output| output.binding.binding_id == calibration.binding_id)
                    .ok_or_else(|| {
                        DagMlError::RuntimeValidation(
                            "conformal calibration replay is missing its selected binding"
                                .to_string(),
                        )
                    })?;
                let [point] = replay_output.predictions.as_slice() else {
                    return contract_error(
                        "conformal calibration replay requires exactly one selected point block",
                    );
                };
                if replay.phase != Phase::Predict
                    || replay_output.binding != binding.binding
                    || point.sample_ids != calibration.sample_ids
                    || point.sample_ids != context.calibration_cohort.physical_sample_ids
                    || replay.input_data_identities.iter().any(|identity| {
                        identity.relation_fingerprint != context.relation_fingerprint
                    })
                {
                    return contract_error(
                        "conformal calibration replay evidence does not match its selected binding, samples, or relation authority",
                    );
                }
                let training_ids = self
                    .training_influence
                    .entries
                    .iter()
                    .flat_map(|entry| {
                        entry
                            .physical_sample_ids
                            .iter()
                            .chain(entry.origin_sample_ids.iter())
                    })
                    .collect::<BTreeSet<_>>();
                if context
                    .calibration_cohort
                    .physical_sample_ids
                    .iter()
                    .chain(context.calibration_cohort.origin_sample_ids.iter())
                    .any(|id| training_ids.contains(id))
                {
                    return contract_error(
                        "conformal calibration cohort overlaps training influence closure",
                    );
                }
            }
            (None, None, None) => {}
            _ => {
                return contract_error(
                    "training outcome and execution bundle conformal state disagree",
                )
            }
        }
        if let Some(state) = &self.methods_hpo_resume_state {
            let terminal_reports = state
                .completed_reports
                .iter()
                .map(|completed| completed.report.clone())
                .collect::<Vec<_>>();
            if self.score_set.reports != terminal_reports {
                return contract_error(
                    "training outcome score_set does not exactly retain Methods HPO terminal OOF reports",
                );
            }
        }
        self.validate_data_identities()?;
        validate_all_identity_relations(
            &self.data_identities,
            &self.training_influence.relation_fingerprint,
        )?;
        self.validate_artifacts(&closure)?;
        self.validate_lineage(&closure)?;
        match &self.portable_prediction_caches {
            Some(caches) => caches.validate_against_bundle(&self.execution_bundle)?,
            None if !self.execution_bundle.prediction_caches.is_empty() => {
                return contract_error(
                    "training outcome portable caches are null while bundle announces caches",
                );
            }
            None => {}
        }

        let expected_replay = derive_replayable_phases(
            &self.effective_plan,
            &closure,
            &self.refit,
            &self.execution_bundle,
            self.portable_prediction_caches.as_ref(),
        )?;
        if self.replayable_phases != expected_replay {
            return contract_error(
                "training outcome replayable_phases do not match the phases derivable from the full predictor closure and retained state",
            );
        }
        validate_sorted_unique_text("training outcome warnings", &self.warnings)?;
        let portable = serde_json::to_value(self)?;
        if contains_runtime_handle(&portable) {
            return contract_error("training outcome must not contain runtime handles");
        }
        if self.outcome_fingerprint != self.compute_fingerprint()? {
            return contract_error("training outcome fingerprint does not match TCV1 content");
        }
        Ok(())
    }

    fn validate_version_family(&self) -> Result<()> {
        let expected_score_version = match self.schema_version {
            LEGACY_TRAINING_OUTCOME_SCHEMA_VERSION => LEGACY_SCORE_SET_SCHEMA_VERSION,
            TRAINING_OUTCOME_SCHEMA_VERSION => SCORE_SET_SCHEMA_VERSION,
            _ => unreachable!("training outcome schema_version was range-checked"),
        };
        if self.score_set.schema_version != expected_score_version {
            return contract_error(format!(
                "training outcome schema_version {} requires score_set schema_version {}, got {}",
                self.schema_version, expected_score_version, self.score_set.schema_version
            ));
        }
        let expected_bundle_version = match self.schema_version {
            LEGACY_TRAINING_OUTCOME_SCHEMA_VERSION => LEGACY_EXECUTION_BUNDLE_SCHEMA_VERSION,
            TRAINING_OUTCOME_SCHEMA_VERSION => EXECUTION_BUNDLE_SCHEMA_VERSION,
            _ => unreachable!("training outcome schema_version was range-checked"),
        };
        if self.execution_bundle.schema_version != expected_bundle_version {
            return contract_error(format!(
                "training outcome schema_version {} requires execution_bundle schema_version {}, got {}",
                self.schema_version,
                expected_bundle_version,
                self.execution_bundle.schema_version
            ));
        }
        let expected_cache_version = match self.schema_version {
            LEGACY_TRAINING_OUTCOME_SCHEMA_VERSION => {
                LEGACY_PREDICTION_CACHE_PAYLOAD_SCHEMA_VERSION
            }
            TRAINING_OUTCOME_SCHEMA_VERSION => PREDICTION_CACHE_PAYLOAD_SCHEMA_VERSION,
            _ => unreachable!("training outcome schema_version was range-checked"),
        };
        if let Some(caches) = &self.portable_prediction_caches {
            if caches.schema_version != expected_cache_version {
                return contract_error(format!(
                    "training outcome schema_version {} requires prediction cache payload set schema_version {}, got {}",
                    self.schema_version, expected_cache_version, caches.schema_version
                ));
            }
        }
        for output in &self.outputs {
            match (self.schema_version, output.schema_version) {
                (LEGACY_TRAINING_OUTCOME_SCHEMA_VERSION, None) => {}
                (LEGACY_TRAINING_OUTCOME_SCHEMA_VERSION, Some(version)) => {
                    return contract_error(format!(
                        "training outcome V1 requires absent bound output schema_version, got {version}"
                    ));
                }
                (TRAINING_OUTCOME_SCHEMA_VERSION, Some(BOUND_TRAINING_OUTPUT_SCHEMA_VERSION)) => {}
                (TRAINING_OUTCOME_SCHEMA_VERSION, Some(version)) => {
                    return contract_error(format!(
                        "training outcome V2 requires bound output schema_version {}, got {version}",
                        BOUND_TRAINING_OUTPUT_SCHEMA_VERSION
                    ));
                }
                (TRAINING_OUTCOME_SCHEMA_VERSION, None) => {
                    return contract_error(
                        "training outcome V2 requires bound output schema_version",
                    );
                }
                _ => unreachable!("training outcome schema_version was range-checked"),
            }
        }
        Ok(())
    }

    fn validate_data_identities(&self) -> Result<()> {
        if self.data_identities.is_empty() {
            return contract_error("training outcome requires data identities");
        }
        let mut previous: Option<&str> = None;
        for identity in &self.data_identities {
            identity.validate()?;
            if previous.is_some_and(|key| key >= identity.requirement_key.as_str()) {
                return contract_error(
                    "training outcome data identities must be sorted and unique",
                );
            }
            previous = Some(identity.requirement_key.as_str());
            let requirement = self
                .execution_bundle
                .data_requirements
                .iter()
                .find(|requirement| requirement.key() == identity.requirement_key)
                .ok_or_else(|| {
                    DagMlError::CampaignValidation(format!(
                        "training outcome data identity `{}` has no bundle requirement",
                        identity.requirement_key
                    ))
                })?;
            if requirement.schema_fingerprint != identity.schema_fingerprint
                || requirement.plan_fingerprint != identity.plan_fingerprint
                || requirement.relation_fingerprint.as_ref() != Some(&identity.relation_fingerprint)
            {
                return contract_error(
                    "training outcome data identity does not match execution bundle requirement",
                );
            }
        }
        if self.data_identities.len() != self.execution_bundle.data_requirements.len() {
            return contract_error(
                "training outcome data identities do not exactly cover bundle data requirements",
            );
        }
        Ok(())
    }

    fn validate_selection_decision(&self) -> Result<()> {
        if self.selection_output_id.trim().is_empty() {
            return contract_error("training outcome selection_output_id is empty");
        }
        let bindings = self
            .outputs
            .iter()
            .filter(|output| output.binding.binding_id == self.selection_output_id)
            .collect::<Vec<_>>();
        let [selected_output] = bindings.as_slice() else {
            return contract_error(
                "training outcome selection_output_id does not resolve exactly one output",
            );
        };
        if self.execution_bundle.selections.len() != 1 {
            return contract_error(
                "training outcome execution bundle must contain exactly one SELECT decision",
            );
        }
        let (selection_key, decision) = self
            .execution_bundle
            .selections
            .iter()
            .next()
            .expect("selection length was checked");
        if selection_key != &decision.policy_id
            || decision.selected_candidate_id != self.selected_variant_id.as_str()
            || decision.metric_level != Some(selected_output.binding.prediction_level)
            || decision.evaluation_scope != Some(EvaluationScope::Oof)
            || self.score_set.selection_metric.as_deref() != Some(decision.metric_name.as_str())
            || selected_output.binding.prediction_level
                != self
                    .effective_plan
                    .campaign
                    .aggregation_policy
                    .selection_metric_level
        {
            return contract_error(
                "training outcome SELECT decision metadata is inconsistent with selected output",
            );
        }
        RegressionMetricKind::resolve_for_prediction_kind(
            &decision.metric_name,
            decision.objective,
            selected_output.binding.prediction_kind,
        )?;
        let mut reports_by_variant = BTreeMap::<VariantId, _>::new();
        for report in self.score_set.reports.iter().filter(|report| {
            report.producer_node == selected_output.binding.node_id
                && producer_port_matches_graph_output(
                    &self.effective_plan,
                    &selected_output.binding.node_id,
                    &selected_output.binding.port_name,
                    &report.producer_port,
                )
                && report.partition == PredictionPartition::Validation
                && report.level == selected_output.binding.prediction_level
                && report
                    .fold_id
                    .as_ref()
                    .is_some_and(|fold| fold.as_str() == "avg")
        }) {
            let variant_id = report.variant_id.clone().ok_or_else(|| {
                DagMlError::CampaignValidation(
                    "selection output average report has no variant_id".to_string(),
                )
            })?;
            if reports_by_variant
                .insert(variant_id, report.clone())
                .is_some()
            {
                return contract_error(
                    "training outcome has multiple selection average reports for one variant",
                );
            }
        }
        let expected_variants = self
            .effective_plan
            .variants
            .iter()
            .map(|variant| variant.variant_id.clone())
            .collect::<BTreeSet<_>>();
        if reports_by_variant.keys().cloned().collect::<BTreeSet<_>>() != expected_variants {
            return contract_error(
                "training outcome selection reports do not exactly cover plan variants",
            );
        }
        let candidates = reports_by_variant
            .into_iter()
            .map(|(variant_id, report)| report.into_candidate_score(variant_id.as_str()))
            .collect::<Result<Vec<_>>>()?;
        let reconstructed = select_candidate(
            &SelectionPolicy {
                id: decision.policy_id.clone(),
                metric: SelectionMetric {
                    name: decision.metric_name.clone(),
                    objective: decision.objective,
                },
                required_metric_level: decision.metric_level,
                require_finite: true,
                evaluation_scope: decision.evaluation_scope,
                refit_slot_plan: decision.refit_slot_plan.clone(),
                stacking_fit_contract: None,
                reduction_id: decision.reduction_id.clone(),
            },
            &candidates,
        )?;
        if &reconstructed != decision {
            return contract_error(
                "training outcome SELECT decision does not equal ranking reconstructed from scores",
            );
        }
        Ok(())
    }

    fn validate_refit(&self) -> Result<()> {
        match (self.refit.requested, self.refit.status, self.refit.strategy) {
            (true, TrainingRefitStatus::Completed, Some(_)) => {
                if self
                    .outputs
                    .iter()
                    .any(|output| output.binding.prediction_source != PredictionSource::FinalRefit)
                {
                    return contract_error(
                        "completed refit outputs must use final_refit prediction source",
                    );
                }
            }
            (false, TrainingRefitStatus::Skipped, None) => {
                if self
                    .outputs
                    .iter()
                    .any(|output| output.binding.prediction_source == PredictionSource::FinalRefit)
                {
                    return contract_error("no-refit outputs cannot use final_refit");
                }
            }
            _ => return contract_error("training outcome refit state is inconsistent"),
        }
        Ok(())
    }

    fn validate_outputs(&self) -> Result<BTreeSet<NodeId>> {
        if self.outputs.is_empty() {
            return contract_error("training outcome requires at least one bound output");
        }
        let mut previous: Option<&str> = None;
        let mut roots = Vec::new();
        for output in &self.outputs {
            if previous.is_some_and(|value| value >= output.binding.binding_id.as_str()) {
                return contract_error(
                    "training outcome outputs must be strictly sorted by binding_id",
                );
            }
            previous = Some(output.binding.binding_id.as_str());
            output.validate(&self.effective_plan)?;
            roots.push(output.binding.node_id.clone());
        }
        predictor_closure(&self.effective_plan, roots)
    }

    fn validate_artifacts(&self, closure: &BTreeSet<NodeId>) -> Result<()> {
        if !self.refit.requested {
            if !self.execution_bundle.refit_artifacts.is_empty() {
                return contract_error("no-refit training outcome contains refit artifacts");
            }
            return Ok(());
        }
        if self.execution_bundle.refit_artifacts.is_empty() {
            return contract_error("completed refit requires at least one artifact");
        }
        let expected_artifact_nodes = closure
            .iter()
            .filter(|node_id| {
                let plan = &self.effective_plan.node_plans[*node_id];
                plan.supported_phases.contains(&Phase::Refit)
                    && plan
                        .controller_capabilities
                        .contains(&ControllerCapability::EmitsArtifacts)
            })
            .cloned()
            .collect::<BTreeSet<_>>();
        let artifact_nodes = self
            .execution_bundle
            .refit_artifacts
            .iter()
            .map(|record| record.node_id.clone())
            .collect::<BTreeSet<_>>();
        if artifact_nodes != expected_artifact_nodes {
            return contract_error(
                "refit artifact nodes do not exactly match predictor closure REFIT artifact emitters",
            );
        }
        for output in &self.outputs {
            if !artifact_nodes.contains(&output.binding.node_id) {
                return contract_error("final output node has no refit artifact");
            }
        }
        Ok(())
    }

    fn validate_lineage(&self, closure: &BTreeSet<NodeId>) -> Result<()> {
        if self.lineage.is_empty() {
            return contract_error("training outcome requires portable lineage");
        }
        let record_ids = self
            .lineage
            .iter()
            .map(|record| record.record_id.clone())
            .collect::<Vec<_>>();
        if record_ids.windows(2).any(|pair| pair[0] >= pair[1]) {
            return contract_error("training outcome lineage must be sorted by record_id");
        }
        let by_id = self
            .lineage
            .iter()
            .map(|record| (record.record_id.clone(), record))
            .collect::<BTreeMap<_, _>>();
        if by_id.len() != self.lineage.len() {
            return contract_error("training outcome lineage contains duplicate record ids");
        }
        let mut coordinates = BTreeMap::new();
        for record in &self.lineage {
            record.validate()?;
            if record.run_id != self.run_id
                || record.variant_id.as_ref() != Some(&self.selected_variant_id)
                || !closure.contains(&record.node_id)
            {
                return contract_error(
                    "training outcome lineage run, variant, or predictor closure is inconsistent",
                );
            }
            if !matches!(record.phase, Phase::FitCv | Phase::Select | Phase::Refit) {
                return contract_error("training outcome lineage contains a non-training phase");
            }
            let plan = &self.effective_plan.node_plans[&record.node_id];
            if record.controller_id != plan.controller_id
                || record.controller_version != plan.controller_version
                || record.params_fingerprint != plan.params_fingerprint
            {
                return contract_error("training outcome lineage does not match node plan");
            }
            let key = (record.phase, record.fold_id.clone(), record.node_id.clone());
            if coordinates.insert(key, record).is_some() {
                return contract_error("training outcome lineage duplicates phase/fold/node");
            }
            if record
                .input_lineage
                .iter()
                .any(|input| !by_id.contains_key(input))
            {
                return contract_error("training outcome lineage references an unknown input");
            }
        }
        validate_lineage_coordinates(self, closure, &coordinates)
    }
}

impl BoundTrainingOutput {
    pub(crate) fn validate(&self, plan: &ExecutionPlan) -> Result<()> {
        if let Some(schema_version) = self.schema_version {
            if schema_version != BOUND_TRAINING_OUTPUT_SCHEMA_VERSION {
                return contract_error(format!(
                    "bound training output schema_version {schema_version} is unsupported; current {}",
                    BOUND_TRAINING_OUTPUT_SCHEMA_VERSION
                ));
            }
        }
        self.binding.validate(&plan.graph_plan.graph)?;
        if self.predictions.is_empty()
            && self.observation_predictions.is_empty()
            && self.aggregated_predictions.is_empty()
        {
            return contract_error("bound training output contains no prediction block");
        }
        match self.binding.prediction_level {
            PredictionLevel::Observation
                if !self.predictions.is_empty() || !self.aggregated_predictions.is_empty() =>
            {
                return contract_error(
                    "observation output binding cannot contain sample or aggregated predictions",
                );
            }
            PredictionLevel::Sample if !self.observation_predictions.is_empty() => {
                return contract_error(
                    "sample output binding cannot contain observation predictions",
                );
            }
            PredictionLevel::Target | PredictionLevel::Group
                if !self.predictions.is_empty() || !self.observation_predictions.is_empty() =>
            {
                return contract_error(
                    "target/group output binding cannot contain sample or observation predictions",
                );
            }
            _ => {}
        }
        let expected_names = expected_output_columns(&self.binding);
        for block in &self.predictions {
            block.validate_shape()?;
            validate_bound_block(
                plan,
                &self.binding,
                &block.producer_node,
                &block.producer_port,
                &block.partition,
                block.fold_id.as_ref(),
                &block.target_names,
                &expected_names,
            )?;
        }
        for block in &self.observation_predictions {
            block.validate_shape()?;
            validate_bound_block(
                plan,
                &self.binding,
                &block.producer_node,
                &block.producer_port,
                &block.partition,
                block.fold_id.as_ref(),
                &block.target_names,
                &expected_names,
            )?;
        }
        for block in &self.aggregated_predictions {
            block.validate_shape()?;
            if block.level != self.binding.prediction_level {
                return contract_error(
                    "bound aggregated prediction level does not match output binding",
                );
            }
            validate_bound_block(
                plan,
                &self.binding,
                &block.producer_node,
                &block.producer_port,
                &block.partition,
                block.fold_id.as_ref(),
                &block.target_names,
                &expected_names,
            )?;
        }
        match self.binding.prediction_level {
            PredictionLevel::Observation if self.observation_predictions.is_empty() => {
                return contract_error(
                    "observation output binding requires observation predictions",
                );
            }
            PredictionLevel::Target | PredictionLevel::Group
                if self.aggregated_predictions.is_empty() =>
            {
                return contract_error(
                    "target/group output binding requires aggregated predictions",
                );
            }
            _ => {}
        }
        Ok(())
    }
}

#[allow(clippy::too_many_arguments)]
fn validate_bound_block(
    plan: &ExecutionPlan,
    binding: &OutputBinding,
    producer: &NodeId,
    producer_port: &Option<String>,
    partition: &PredictionPartition,
    fold_id: Option<&crate::ids::FoldId>,
    target_names: &[String],
    expected_names: &[String],
) -> Result<()> {
    if producer != &binding.node_id
        || !producer_port_matches_graph_output(
            plan,
            &binding.node_id,
            &binding.port_name,
            producer_port,
        )
        || target_names != expected_names
    {
        return contract_error(
            "bound prediction producer, producer_port or target order does not match output binding",
        );
    }
    if binding.prediction_source == PredictionSource::FinalRefit
        && (partition != &PredictionPartition::Final || fold_id.is_some())
    {
        return contract_error("final_refit output blocks must use final partition without fold");
    }
    if binding.prediction_source == PredictionSource::CvEnsemble
        && (!is_cv_ensemble_partition(partition) || fold_id.is_none())
    {
        return contract_error(
            "cv_ensemble output blocks must use validation partition with a fold id",
        );
    }
    Ok(())
}

fn expected_output_columns(binding: &OutputBinding) -> Vec<String> {
    if binding.prediction_kind == PredictionKind::ClassProbability {
        binding
            .target_names
            .iter()
            .zip(&binding.class_labels)
            .flat_map(|(target, labels)| {
                labels.iter().map(move |label| format!("{target}:{label}"))
            })
            .collect()
    } else {
        binding.target_names.clone()
    }
}

fn selected_variant_parameter_patches(
    variant: &crate::generation::VariantPlan,
) -> Result<Vec<ParameterPatch>> {
    let mut patches = Vec::new();
    for choice in variant.choices.values() {
        for override_spec in &choice.param_overrides {
            for (key, value) in &override_spec.params {
                append_parameter_leaves(
                    &override_spec.node_id,
                    vec![key.clone()],
                    value,
                    &mut patches,
                )?;
            }
        }
    }
    patches.sort_by(|left, right| {
        (&left.node_id, left.namespace, &left.path).cmp(&(
            &right.node_id,
            right.namespace,
            &right.path,
        ))
    });
    if patches.windows(2).any(|pair| {
        pair[0].node_id == pair[1].node_id
            && pair[0].namespace == pair[1].namespace
            && pair[0].path == pair[1].path
    }) {
        return contract_error("selected variant overrides contain duplicate leaf paths");
    }
    Ok(patches)
}

fn merge_training_parameter_patches(
    request_patches: &[ParameterPatch],
    selected_variant: &crate::generation::VariantPlan,
) -> Result<Vec<ParameterPatch>> {
    let mut patches = request_patches.to_vec();
    patches.extend(selected_variant_parameter_patches(selected_variant)?);
    sort_and_validate_training_parameter_patch_keys(&mut patches, false)?;
    Ok(patches)
}

fn validate_outcome_parameter_patches(
    plan: &ExecutionPlan,
    patches: &[ParameterPatch],
    selected_variant_patches: &[ParameterPatch],
) -> Result<()> {
    let mut patches = patches.to_vec();
    sort_and_validate_training_parameter_patch_keys(&mut patches, true)?;
    let keys = patches
        .iter()
        .map(parameter_patch_key)
        .collect::<BTreeSet<_>>();
    for selected in selected_variant_patches {
        if !keys.contains(&parameter_patch_key(selected)) {
            return contract_error(
                "training outcome parameter_patches are missing a selected variant override",
            );
        }
    }
    for patch in &patches {
        validate_materialized_patch(plan, patch)?;
    }
    Ok(())
}

fn sort_and_validate_training_parameter_patch_keys(
    patches: &mut [ParameterPatch],
    require_already_sorted: bool,
) -> Result<()> {
    for patch in patches.iter() {
        patch.validate()?;
        if patch.namespace != ParameterNamespace::Operator {
            return contract_error(
                "training outcome parameter_patches must use operator namespace",
            );
        }
    }
    let original = patches.to_vec();
    patches.sort_by(|left, right| parameter_patch_key(left).cmp(&parameter_patch_key(right)));
    if require_already_sorted && patches != original {
        return contract_error(
            "training outcome parameter_patches must be sorted by (node_id, namespace, path)",
        );
    }
    for pair in patches.windows(2) {
        let left = &pair[0];
        let right = &pair[1];
        if parameter_patch_key(left) == parameter_patch_key(right) {
            return contract_error(
                "training outcome parameter_patches contain duplicate leaf paths",
            );
        }
        if left.node_id == right.node_id
            && left.namespace == right.namespace
            && (right.path.starts_with(&left.path) || left.path.starts_with(&right.path))
        {
            return contract_error(
                "training outcome parameter_patches contain a conflicting parent/child path",
            );
        }
    }
    Ok(())
}

fn parameter_patch_key(patch: &ParameterPatch) -> (&NodeId, ParameterNamespace, &[String]) {
    (&patch.node_id, patch.namespace, patch.path.as_slice())
}

fn append_parameter_leaves(
    node_id: &NodeId,
    path: Vec<String>,
    value: &serde_json::Value,
    output: &mut Vec<ParameterPatch>,
) -> Result<()> {
    if let serde_json::Value::Object(object) = value {
        for (key, child) in object {
            let mut child_path = path.clone();
            child_path.push(key.clone());
            append_parameter_leaves(node_id, child_path, child, output)?;
        }
        return Ok(());
    }
    output.push(ParameterPatch {
        schema_version: PARAMETER_PATCH_SCHEMA_VERSION,
        node_id: node_id.clone(),
        namespace: ParameterNamespace::Operator,
        path,
        value: value.clone(),
    });
    Ok(())
}

fn validate_materialized_patch(plan: &ExecutionPlan, patch: &ParameterPatch) -> Result<()> {
    patch.validate()?;
    if patch.namespace != ParameterNamespace::Operator {
        return contract_error("selected variant patches must use operator namespace");
    }
    let node = plan.node_plans.get(&patch.node_id).ok_or_else(|| {
        DagMlError::CampaignValidation(format!(
            "selected parameter patch references absent node `{}`",
            patch.node_id
        ))
    })?;
    let mut current = serde_json::Value::Object(node.params.clone().into_iter().collect());
    for segment in &patch.path {
        current = current
            .as_object()
            .and_then(|object| object.get(segment))
            .cloned()
            .ok_or_else(|| {
                DagMlError::CampaignValidation(format!(
                    "selected parameter patch path for `{}` is not materialized",
                    patch.node_id
                ))
            })?;
    }
    if current != patch.value {
        return contract_error("selected parameter patch value is not materialized in plan");
    }
    Ok(())
}

fn predictor_closure(
    plan: &ExecutionPlan,
    roots: impl IntoIterator<Item = NodeId>,
) -> Result<BTreeSet<NodeId>> {
    let mut pending = roots.into_iter().collect::<Vec<_>>();
    let mut closure = BTreeSet::new();
    while let Some(node_id) = pending.pop() {
        if !closure.insert(node_id.clone()) {
            continue;
        }
        let node = plan.node_plans.get(&node_id).ok_or_else(|| {
            DagMlError::CampaignValidation(format!(
                "training outcome closure references absent node `{node_id}`"
            ))
        })?;
        pending.extend(node.input_nodes.iter().cloned());
    }
    Ok(closure)
}

/// Per-node facts the replay derivation reads for one predictor-closure node.
struct NodeReplayFacts {
    supported_phases: BTreeSet<Phase>,
    /// Node carries fitted inference state that a later PREDICT/EXPLAIN must
    /// reload: it is `stateful` or emits artifacts (capabilities
    /// `Stateful || EmitsArtifacts`). This is deliberately NOT inferred from
    /// `artifact_policy`/`ReplayRequired` or from `fit_scope`: a stateless
    /// deterministic operator — e.g. a seeded augmentation, or a
    /// `replay_required` transform that simply recomputes at inference — carries
    /// no reloadable state, needs no retained artifact, and must not block
    /// forward replay.
    requires_retained_state: bool,
    /// A retained refit artifact for this node is present in the bundle.
    has_retained_artifact: bool,
}

/// Per-edge facts for one `requires_oof` dependency wholly inside the closure.
struct OofEdgeReplayFacts {
    has_bundle_requirement: bool,
    has_cache_record: bool,
    has_portable_payload: bool,
}

/// Everything the pure replay decision needs, extracted from the plan/bundle so
/// the decision itself is unit-testable in isolation without a full plan.
struct ClosureReplayFacts {
    nodes: Vec<NodeReplayFacts>,
    oof_edges: Vec<OofEdgeReplayFacts>,
}

/// Pure replay decision over already-extracted closure facts.
///
/// Canonical order is `[REFIT, PREDICT, EXPLAIN]`. A completed refit never
/// re-advertises REFIT; it exposes forward inference only when *every* closure
/// node supports the phase and every state-retaining closure node has a retained
/// refit artifact. A skipped refit exposes REFIT only when every closure node
/// supports REFIT and every closure OOF dependency is backed by an exact bundle
/// requirement, a retained cache record and a portable payload. An empty result
/// is a valid, honest "no replay mode" answer.
fn derive_replayable_phases_from_facts(
    completed_refit: bool,
    facts: &ClosureReplayFacts,
) -> Vec<Phase> {
    let all_support = |phase: Phase| {
        facts
            .nodes
            .iter()
            .all(|node| node.supported_phases.contains(&phase))
    };
    let inference_state_present = facts
        .nodes
        .iter()
        .all(|node| !node.requires_retained_state || node.has_retained_artifact);
    let oof_self_contained = facts.oof_edges.iter().all(|edge| {
        edge.has_bundle_requirement && edge.has_cache_record && edge.has_portable_payload
    });

    let mut phases = Vec::new();
    if completed_refit {
        if all_support(Phase::Predict) && inference_state_present {
            phases.push(Phase::Predict);
        }
        if all_support(Phase::Explain) && inference_state_present {
            phases.push(Phase::Explain);
        }
    } else if all_support(Phase::Refit) && oof_self_contained {
        phases.push(Phase::Refit);
    }
    phases
}

/// Extract the minimal per-node and per-OOF-edge facts the replay decision reads
/// from the portable outcome state. Shared by both `derive_replayable_phases`
/// (full derivation) and `closure_predict_replayable` (package PREDICT gate).
/// Fallible: a closure node absent from `node_plans` is a contract error, never a
/// panic.
fn closure_replay_facts(
    plan: &ExecutionPlan,
    closure: &BTreeSet<NodeId>,
    execution_bundle: &ExecutionBundle,
    portable_prediction_caches: Option<&BundlePredictionCachePayloadSet>,
) -> Result<ClosureReplayFacts> {
    let artifact_nodes = execution_bundle
        .refit_artifacts
        .iter()
        .map(|record| record.node_id.clone())
        .collect::<BTreeSet<_>>();
    let requirement_keys = execution_bundle
        .prediction_requirements
        .iter()
        .map(|requirement| requirement.key())
        .collect::<BTreeSet<_>>();
    let cache_keys = execution_bundle
        .prediction_caches
        .iter()
        .map(|record| record.requirement_key.clone())
        .collect::<BTreeSet<_>>();
    let payload_keys = portable_prediction_caches
        .map(|set| {
            set.caches
                .iter()
                .map(|payload| payload.requirement_key.clone())
                .collect::<BTreeSet<_>>()
        })
        .unwrap_or_default();

    let nodes = closure
        .iter()
        .map(|node_id| {
            let node_plan = plan.node_plans.get(node_id).ok_or_else(|| {
                DagMlError::CampaignValidation(format!(
                    "replay derivation references absent node `{node_id}`"
                ))
            })?;
            // A node carries fitted state that PREDICT/EXPLAIN must reload only
            // when it is `stateful` or emits artifacts. `artifact_policy` is not
            // used: a stateless `replay_required` operator (e.g. prospectr)
            // re-runs its deterministic transform at inference with no artifact.
            let requires_retained_state = node_plan
                .controller_capabilities
                .contains(&ControllerCapability::Stateful)
                || node_plan
                    .controller_capabilities
                    .contains(&ControllerCapability::EmitsArtifacts);
            Ok(NodeReplayFacts {
                supported_phases: node_plan.supported_phases.clone(),
                requires_retained_state,
                has_retained_artifact: artifact_nodes.contains(node_id),
            })
        })
        .collect::<Result<Vec<_>>>()?;
    let oof_edges = plan
        .graph_plan
        .graph
        .edges
        .iter()
        .filter(|edge| {
            edge.contract.requires_oof
                && closure.contains(&edge.source.node_id)
                && closure.contains(&edge.target.node_id)
        })
        .map(|edge| {
            let key = crate::bundle::bundle_prediction_requirement_key(
                &edge.source.node_id,
                &edge.source.port_name,
                &edge.target.node_id,
                &edge.target.port_name,
            );
            OofEdgeReplayFacts {
                has_bundle_requirement: requirement_keys.contains(&key),
                has_cache_record: cache_keys.contains(&key),
                has_portable_payload: payload_keys.contains(&key),
            }
        })
        .collect::<Vec<_>>();

    Ok(ClosureReplayFacts { nodes, oof_edges })
}

/// Deterministically derive the phases a training outcome can honestly replay.
///
/// This is the single shared helper used by both construction and standalone
/// validation. It reads only portable outcome state (the effective plan's
/// node/controller support, the predictor closure, the retained refit artifacts,
/// the OOF prediction requirements/cache records and the portable payloads), so
/// re-running it during validation reproduces the exact vector a producer must
/// have emitted and rejects any forged claim.
fn derive_replayable_phases(
    plan: &ExecutionPlan,
    closure: &BTreeSet<NodeId>,
    refit: &TrainingRefitOutcome,
    execution_bundle: &ExecutionBundle,
    portable_prediction_caches: Option<&BundlePredictionCachePayloadSet>,
) -> Result<Vec<Phase>> {
    let facts = closure_replay_facts(plan, closure, execution_bundle, portable_prediction_caches)?;
    Ok(derive_replayable_phases_from_facts(
        matches!(refit.status, TrainingRefitStatus::Completed),
        &facts,
    ))
}

/// True when the full predictor `closure` can honestly replay PREDICT given the
/// artifacts retained in `execution_bundle`: every closure node supports PREDICT
/// and every state-retaining closure node has a retained refit artifact. A
/// [`PortablePredictorPackage`](crate::training::PortablePredictorPackage) is a
/// deployable predictor, so its construction requires this independently — it
/// must not infer portability from a merely non-empty claimed phase set. PREDICT
/// replay never consumes OOF payloads, so the OOF cache facts are irrelevant.
pub(crate) fn closure_predict_replayable(
    plan: &ExecutionPlan,
    closure: &BTreeSet<NodeId>,
    execution_bundle: &ExecutionBundle,
) -> Result<bool> {
    let facts = closure_replay_facts(plan, closure, execution_bundle, None)?;
    Ok(derive_replayable_phases_from_facts(true, &facts).contains(&Phase::Predict))
}

fn expected_base_influence_kind(
    plan: &ExecutionPlan,
    node_id: &NodeId,
) -> Option<TrainingInfluenceKind> {
    let node_plan = &plan.node_plans[node_id];
    if matches!(
        node_plan.fit_scope,
        ControllerFitScope::Stateless | ControllerFitScope::InferenceOnly
    ) {
        return None;
    }
    let oof_consumer = plan
        .graph_plan
        .graph
        .edges
        .iter()
        .any(|edge| edge.contract.requires_oof && edge.target.node_id == *node_id);
    Some(
        if oof_consumer
            || node_plan
                .controller_capabilities
                .contains(&ControllerCapability::TrainsAggregation)
        {
            TrainingInfluenceKind::TrainedMetaAggregation
        } else if node_plan.kind == NodeKind::Model {
            TrainingInfluenceKind::ModelFit
        } else if node_plan.kind == NodeKind::Tuner {
            TrainingInfluenceKind::HpoSelection
        } else {
            TrainingInfluenceKind::TransformFit
        },
    )
}

fn validate_influence_against_closure(
    influence: &TrainingInfluenceManifest,
    plan: &ExecutionPlan,
    closure: &BTreeSet<NodeId>,
) -> Result<()> {
    let mut actual_base = BTreeMap::<NodeId, BTreeSet<TrainingInfluenceKind>>::new();
    for entry in &influence.entries {
        let Some(node_id) = &entry.node_id else {
            continue;
        };
        if !closure.contains(node_id) {
            return contract_error("training influence node is outside predictor closure");
        }
        if !influence_kind_allowed_by_node_role_or_capability(plan, node_id, entry.kind) {
            return contract_error(
                "training influence kind is not allowed by node role or capability",
            );
        }
        if expected_base_influence_kind(plan, node_id) == Some(entry.kind) {
            actual_base
                .entry(node_id.clone())
                .or_default()
                .insert(entry.kind);
        }
    }
    let expected = closure
        .iter()
        .filter(|node_id| {
            plan.node_plans[*node_id]
                .supported_phases
                .contains(&Phase::FitCv)
                && expected_base_influence_kind(plan, node_id).is_some()
        })
        .cloned()
        .collect::<BTreeSet<_>>();
    if actual_base.keys().cloned().collect::<BTreeSet<_>>() != expected {
        return contract_error(
            "training influence fitting nodes do not exactly match predictor closure",
        );
    }
    for node_id in expected {
        if actual_base[&node_id]
            != BTreeSet::from([expected_base_influence_kind(plan, &node_id)
                .expect("expected fitting nodes have a base influence kind")])
        {
            return contract_error("training influence fitting kind does not match node role");
        }
    }
    Ok(())
}

fn influence_kind_allowed_by_node_role_or_capability(
    plan: &ExecutionPlan,
    node_id: &NodeId,
    kind: TrainingInfluenceKind,
) -> bool {
    if expected_base_influence_kind(plan, node_id) == Some(kind) {
        return true;
    }
    let capabilities = &plan.node_plans[node_id].controller_capabilities;
    match kind {
        TrainingInfluenceKind::HpoSelection => {
            capabilities.contains(&ControllerCapability::PerformsInternalTuning)
        }
        TrainingInfluenceKind::EarlyStopping => {
            capabilities.contains(&ControllerCapability::UsesEarlyStopping)
        }
        TrainingInfluenceKind::WeightingResampling => {
            capabilities.contains(&ControllerCapability::UsesTrainingWeights)
        }
        TrainingInfluenceKind::TransformFit
        | TrainingInfluenceKind::ModelFit
        | TrainingInfluenceKind::TrainedMetaAggregation => false,
    }
}

fn validate_lineage_coordinates(
    outcome: &TrainingOutcome,
    closure: &BTreeSet<NodeId>,
    coordinates: &BTreeMap<(Phase, Option<crate::ids::FoldId>, NodeId), &LineageRecord>,
) -> Result<()> {
    let fold_set = outcome.effective_plan.fold_set.as_ref().ok_or_else(|| {
        DagMlError::CampaignValidation(
            "training outcome FIT_CV lineage requires a fold_set".to_string(),
        )
    })?;
    let expected_fit = closure
        .iter()
        .filter(|node_id| {
            outcome.effective_plan.node_plans[*node_id]
                .supported_phases
                .contains(&Phase::FitCv)
        })
        .flat_map(|node_id| {
            fold_set
                .folds
                .iter()
                .map(move |fold| (Phase::FitCv, Some(fold.fold_id.clone()), node_id.clone()))
        })
        .collect::<BTreeSet<_>>();
    let mut expected_fit = expected_fit;
    if let Some(nested) = nested_stacking_campaign_plan(&outcome.effective_plan)? {
        // A nested stacking campaign has two explicit FIT_CV scopes. Every
        // closure node still runs once on each report-grade outer fold, while
        // base dependencies additionally run on each parent-bound inner fold
        // to build the meta-model's training features. Those inner records are
        // required evidence, not duplicate outer-fold lineage.
        for outer in &nested.outer_scopes {
            for inner_fold in &outer.inner.inner_fold_set.folds {
                for node_id in nested.base_node_ids.intersection(closure) {
                    if outcome.effective_plan.node_plans[node_id]
                        .supported_phases
                        .contains(&Phase::FitCv)
                    {
                        expected_fit.insert((
                            Phase::FitCv,
                            Some(inner_fold.fold_id.clone()),
                            node_id.clone(),
                        ));
                    }
                }
            }
        }
    }
    let actual_fit = coordinates
        .keys()
        .filter(|(phase, _, _)| *phase == Phase::FitCv)
        .cloned()
        .collect::<BTreeSet<_>>();
    if actual_fit != expected_fit {
        return contract_error(
            "training outcome FIT_CV lineage does not exactly cover closure folds",
        );
    }
    let expected_refit = if outcome.refit.requested {
        closure
            .iter()
            .filter(|node_id| {
                outcome.effective_plan.node_plans[*node_id]
                    .supported_phases
                    .contains(&Phase::Refit)
            })
            .map(|node_id| (Phase::Refit, None, node_id.clone()))
            .collect::<BTreeSet<_>>()
    } else {
        BTreeSet::new()
    };
    let actual_refit = coordinates
        .keys()
        .filter(|(phase, _, _)| *phase == Phase::Refit)
        .cloned()
        .collect::<BTreeSet<_>>();
    if actual_refit != expected_refit {
        return contract_error("training outcome REFIT lineage does not exactly cover closure");
    }

    for ((phase, fold, node_id), record) in coordinates {
        if *phase == Phase::Select {
            continue;
        }
        let plan = &outcome.effective_plan.node_plans[node_id];
        if *phase == Phase::FitCv {
            if let Some(nested) = nested_stacking_campaign_plan(&outcome.effective_plan)? {
                if *node_id == nested.meta_node_id {
                    let outer_fold = fold.as_ref().ok_or_else(|| {
                        DagMlError::CampaignValidation(
                            "nested stacking meta FIT_CV lineage has no outer fold".to_string(),
                        )
                    })?;
                    let outer = nested
                        .outer_scopes
                        .iter()
                        .find(|outer| outer.outer_fold_id == *outer_fold)
                        .ok_or_else(|| {
                            DagMlError::CampaignValidation(format!(
                                "nested stacking meta FIT_CV lineage uses unknown outer fold `{outer_fold}`"
                            ))
                        })?;
                    let mut expected_inputs = outcome
                        .effective_plan
                        .graph_plan
                        .graph
                        .edges
                        .iter()
                        .filter(|edge| {
                            edge.target.node_id == *node_id && edge.contract.requires_oof
                        })
                        .flat_map(|edge| {
                            outer.inner.inner_fold_set.folds.iter().map(move |inner| {
                                coordinates
                                    .get(&(
                                        Phase::FitCv,
                                        Some(inner.fold_id.clone()),
                                        edge.source.node_id.clone(),
                                    ))
                                    .map(|upstream| upstream.record_id.clone())
                                    .ok_or_else(|| {
                                        DagMlError::CampaignValidation(format!(
                                            "nested stacking lineage is missing inner upstream `{}` for outer fold `{outer_fold}`",
                                            edge.source.node_id
                                        ))
                                    })
                            })
                        })
                        .collect::<Result<Vec<LineageId>>>()?;
                    expected_inputs.sort();
                    if record.input_lineage != expected_inputs {
                        return contract_error(
                            "nested stacking meta lineage does not exactly match inner OOF inputs",
                        );
                    }
                    if !record.artifact_refs.is_empty() {
                        return contract_error("FIT_CV lineage must not retain refit artifacts");
                    }
                    continue;
                }
            }
        }
        let expected_inputs = plan
            .input_nodes
            .iter()
            .filter(|input| {
                outcome.effective_plan.node_plans[*input]
                    .supported_phases
                    .contains(phase)
            })
            .map(|input| {
                coordinates
                    .get(&(*phase, fold.clone(), input.clone()))
                    .map(|upstream| upstream.record_id.clone())
                    .ok_or_else(|| {
                        DagMlError::CampaignValidation(format!(
                            "training lineage is missing upstream `{input}`"
                        ))
                    })
            })
            .collect::<Result<Vec<LineageId>>>()?;
        let mut expected_inputs = expected_inputs;
        expected_inputs.sort();
        if record.input_lineage != expected_inputs {
            return contract_error(
                "training outcome lineage input_lineage does not exactly match plan",
            );
        }
        if *phase == Phase::FitCv && !record.artifact_refs.is_empty() {
            return contract_error("FIT_CV lineage must not retain refit artifacts");
        }
        if *phase == Phase::Refit {
            let mut expected_artifacts = outcome
                .execution_bundle
                .refit_artifacts
                .iter()
                .filter(|artifact| artifact.node_id == *node_id)
                .map(|artifact| artifact.artifact.clone())
                .collect::<Vec<_>>();
            expected_artifacts.sort_by(|left, right| left.id.cmp(&right.id));
            let mut actual_artifacts = record.artifact_refs.clone();
            actual_artifacts.sort_by(|left, right| left.id.cmp(&right.id));
            if actual_artifacts != expected_artifacts {
                return contract_error("REFIT lineage artifact_refs do not match execution bundle");
            }
        }
    }
    Ok(())
}

fn tcv1_fingerprint<T: Serialize + ?Sized>(value: &T, label: &str) -> Result<String> {
    let json = serde_json::to_string(value)?;
    parse_typed_json(&json)
        .map_err(|error| {
            DagMlError::CampaignValidation(format!("{label} is not valid TCV1: {error}"))
        })?
        .fingerprint()
        .map_err(|error| {
            DagMlError::CampaignValidation(format!("{label} TCV1 fingerprint failed: {error}"))
        })
}

fn tcv1_fingerprint_without<T: Serialize>(value: &T, field: &str, label: &str) -> Result<String> {
    let json = serde_json::to_string(value)?;
    parse_typed_json(&json)
        .map_err(|error| {
            DagMlError::CampaignValidation(format!("{label} is not valid TCV1: {error}"))
        })?
        .fingerprint_without(field)
        .map_err(|error| {
            DagMlError::CampaignValidation(format!("{label} TCV1 fingerprint failed: {error}"))
        })
}

fn validate_sha256(label: &str, value: &str) -> Result<()> {
    if value.len() != 64
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return contract_error(format!("{label} must be lowercase sha256"));
    }
    Ok(())
}

fn validate_all_identity_relations(
    identities: &[TrainingDataIdentity],
    relation_fingerprint: &str,
) -> Result<()> {
    if identities
        .iter()
        .any(|identity| identity.relation_fingerprint != relation_fingerprint)
    {
        return contract_error(
            "training outcome data identities do not all bind the influence relation",
        );
    }
    Ok(())
}

fn validate_sorted_unique_text(label: &str, values: &[String]) -> Result<()> {
    if values.iter().any(|value| value.trim().is_empty()) {
        return contract_error(format!("{label} contains an empty value"));
    }
    if values.windows(2).any(|pair| pair[0] >= pair[1]) {
        return contract_error(format!("{label} must be strictly sorted and unique"));
    }
    Ok(())
}

fn contract_error<T>(message: impl Into<String>) -> Result<T> {
    Err(DagMlError::CampaignValidation(message.into()))
}

#[cfg(test)]
mod replay_phase_tests {
    use super::{
        derive_replayable_phases_from_facts, ClosureReplayFacts, NodeReplayFacts,
        OofEdgeReplayFacts,
    };
    use crate::phase::Phase;
    use std::collections::BTreeSet;

    fn node(
        supported: &[Phase],
        requires_retained_state: bool,
        has_retained_artifact: bool,
    ) -> NodeReplayFacts {
        NodeReplayFacts {
            supported_phases: supported.iter().copied().collect::<BTreeSet<_>>(),
            requires_retained_state,
            has_retained_artifact,
        }
    }

    fn oof(
        has_bundle_requirement: bool,
        has_cache_record: bool,
        has_portable_payload: bool,
    ) -> OofEdgeReplayFacts {
        OofEdgeReplayFacts {
            has_bundle_requirement,
            has_cache_record,
            has_portable_payload,
        }
    }

    // Completed refit whose full closure supports both forward phases and whose
    // state-retaining nodes (`Stateful || EmitsArtifacts`) all have a retained
    // artifact exposes PREDICT then EXPLAIN in canonical order and never
    // re-advertises REFIT.
    #[test]
    fn completed_refit_full_support_matrix_predict_then_explain() {
        let facts = ClosureReplayFacts {
            nodes: vec![
                node(
                    &[Phase::FitCv, Phase::Refit, Phase::Predict, Phase::Explain],
                    true,
                    true,
                ),
                node(
                    &[Phase::FitCv, Phase::Refit, Phase::Predict, Phase::Explain],
                    true,
                    true,
                ),
            ],
            oof_edges: vec![],
        };
        assert_eq!(
            derive_replayable_phases_from_facts(true, &facts),
            vec![Phase::Predict, Phase::Explain]
        );
    }

    // The current completed-refit fixture: every closure node supports
    // FIT_CV/REFIT/PREDICT but not EXPLAIN, so only PREDICT is honest.
    #[test]
    fn completed_refit_predict_only_when_explain_unsupported() {
        let facts = ClosureReplayFacts {
            nodes: vec![
                node(&[Phase::FitCv, Phase::Refit, Phase::Predict], true, true),
                // A train-only augmentation node emits no artifact, so it does not
                // require retained inference state and must not block PREDICT.
                node(&[Phase::FitCv, Phase::Refit, Phase::Predict], false, false),
            ],
            oof_edges: vec![],
        };
        assert_eq!(
            derive_replayable_phases_from_facts(true, &facts),
            vec![Phase::Predict]
        );
    }

    // A downstream node supporting PREDICT cannot rescue an upstream required
    // node that does not support it: the whole closure must support the phase.
    #[test]
    fn upstream_node_missing_phase_blocks_whole_closure() {
        let facts = ClosureReplayFacts {
            nodes: vec![
                // downstream predictor supports PREDICT and EXPLAIN
                node(
                    &[Phase::FitCv, Phase::Refit, Phase::Predict, Phase::Explain],
                    true,
                    true,
                ),
                // upstream required transform supports neither
                node(&[Phase::FitCv, Phase::Refit], false, false),
            ],
            oof_edges: vec![],
        };
        assert_eq!(
            derive_replayable_phases_from_facts(true, &facts),
            Vec::<Phase>::new()
        );
    }

    // A completed refit whose closure supports PREDICT but is missing the
    // retained artifact of a state-retaining node (here `requires_retained_state`)
    // has no honest replay mode: [] is the correct, preferable answer.
    #[test]
    fn completed_refit_missing_artifact_yields_empty() {
        let facts = ClosureReplayFacts {
            nodes: vec![node(
                &[Phase::FitCv, Phase::Refit, Phase::Predict],
                true,
                false,
            )],
            oof_edges: vec![],
        };
        assert_eq!(
            derive_replayable_phases_from_facts(true, &facts),
            Vec::<Phase>::new()
        );
    }

    // No-refit outcome never advertises PREDICT/EXPLAIN even when supported, and
    // advertises REFIT only when every OOF dependency is fully self-contained
    // (exact bundle requirement + cache record + portable payload).
    #[test]
    fn no_refit_refit_requires_self_contained_oof_payload() {
        let supported = [Phase::FitCv, Phase::Refit, Phase::Predict, Phase::Explain];
        let backed = ClosureReplayFacts {
            nodes: vec![node(&supported, true, false), node(&supported, true, false)],
            oof_edges: vec![oof(true, true, true)],
        };
        assert_eq!(
            derive_replayable_phases_from_facts(false, &backed),
            vec![Phase::Refit]
        );

        // Missing portable payload -> not self-contained -> [].
        let missing_payload = ClosureReplayFacts {
            nodes: vec![node(&supported, true, false), node(&supported, true, false)],
            oof_edges: vec![oof(true, true, false)],
        };
        assert_eq!(
            derive_replayable_phases_from_facts(false, &missing_payload),
            Vec::<Phase>::new()
        );

        // Missing cache record -> [].
        let missing_record = ClosureReplayFacts {
            nodes: vec![node(&supported, true, false)],
            oof_edges: vec![oof(true, false, true)],
        };
        assert_eq!(
            derive_replayable_phases_from_facts(false, &missing_record),
            Vec::<Phase>::new()
        );
    }

    // A no-refit outcome with no OOF edges is vacuously self-contained: REFIT can
    // re-fit from data alone, so REFIT is honest when every node supports it.
    #[test]
    fn no_refit_without_oof_edges_is_vacuously_refit() {
        let facts = ClosureReplayFacts {
            nodes: vec![node(
                &[Phase::FitCv, Phase::Refit, Phase::Predict],
                false,
                false,
            )],
            oof_edges: vec![],
        };
        assert_eq!(
            derive_replayable_phases_from_facts(false, &facts),
            vec![Phase::Refit]
        );
    }

    // A no-refit closure that does not fully support REFIT yields [].
    #[test]
    fn no_refit_without_refit_support_yields_empty() {
        let facts = ClosureReplayFacts {
            nodes: vec![
                node(&[Phase::FitCv, Phase::Refit], false, false),
                node(&[Phase::FitCv, Phase::Predict], false, false),
            ],
            oof_edges: vec![],
        };
        assert_eq!(
            derive_replayable_phases_from_facts(false, &facts),
            Vec::<Phase>::new()
        );
    }

    // A stateless `replay_required` operator (e.g. prospectr): it is neither
    // `stateful` nor an artifact emitter, so `requires_retained_state` is false
    // and it stays PREDICT-replayable with no retained artifact — the operation
    // simply replays its deterministic transform at inference time.
    #[test]
    fn stateless_replay_required_operator_without_artifact_stays_predict_replayable() {
        let facts = ClosureReplayFacts {
            nodes: vec![node(
                &[Phase::FitCv, Phase::Refit, Phase::Predict],
                false,
                false,
            )],
            oof_edges: vec![],
        };
        assert_eq!(
            derive_replayable_phases_from_facts(true, &facts),
            vec![Phase::Predict]
        );
    }

    // A `stateful` (or artifact-emitting) node that has no retained artifact
    // carries no reloadable inference state, so PREDICT must not be advertised.
    #[test]
    fn stateful_non_emitter_without_artifact_cannot_advertise_predict() {
        let facts = ClosureReplayFacts {
            nodes: vec![node(
                &[Phase::FitCv, Phase::Refit, Phase::Predict],
                true,
                false,
            )],
            oof_edges: vec![],
        };
        assert_eq!(
            derive_replayable_phases_from_facts(true, &facts),
            Vec::<Phase>::new()
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(dag_ml_workspace_contract_fixtures)]
    const REFIT_FIXTURE: &str =
        include_str!("../../../examples/fixtures/estimator/training_outcome_refit.v1.json");
    #[cfg(dag_ml_workspace_contract_fixtures)]
    const NO_REFIT_FIXTURE: &str =
        include_str!("../../../examples/fixtures/estimator/training_outcome_no_refit.v1.json");

    #[test]
    fn cv_ensemble_partition_truth_table_retains_validation_only() {
        for (partition, expected) in [
            (PredictionPartition::Validation, true),
            (PredictionPartition::Train, false),
            (PredictionPartition::Test, false),
            (PredictionPartition::Final, false),
        ] {
            assert_eq!(
                is_cv_ensemble_partition(&partition),
                expected,
                "unexpected CvEnsemble retention decision for {partition:?}"
            );
        }
    }

    #[cfg(dag_ml_workspace_contract_fixtures)]
    #[test]
    fn independent_w0_training_outcomes_parse_and_round_trip_fingerprint() {
        for fixture in [REFIT_FIXTURE, NO_REFIT_FIXTURE] {
            let outcome = TrainingOutcome::from_json(fixture).expect("valid W0 outcome");
            assert_eq!(
                outcome.compute_fingerprint().unwrap(),
                outcome.outcome_fingerprint
            );
            let serialized = serde_json::to_string(&outcome).unwrap();
            let reparsed = TrainingOutcome::from_json(&serialized).unwrap();
            assert_eq!(reparsed, outcome);
        }
    }

    #[cfg(dag_ml_workspace_contract_fixtures)]
    #[test]
    fn strict_parser_rejects_tamper_and_unknown_field() {
        let mut tampered: serde_json::Value = serde_json::from_str(REFIT_FIXTURE).unwrap();
        tampered["warnings"] = serde_json::json!(["tampered"]);
        assert!(TrainingOutcome::from_json(&serde_json::to_string(&tampered).unwrap()).is_err());

        let mut unknown: serde_json::Value = serde_json::from_str(REFIT_FIXTURE).unwrap();
        unknown["unknown_field"] = serde_json::json!(true);
        assert!(TrainingOutcome::from_json(&serde_json::to_string(&unknown).unwrap()).is_err());
    }

    #[cfg(dag_ml_workspace_contract_fixtures)]
    #[test]
    fn outcome_rejects_nested_runtime_handle_keys_defense_in_depth() {
        let mut outcome = TrainingOutcome::from_json(REFIT_FIXTURE).unwrap();
        outcome.diagnostics.insert(
            "nested".to_string(),
            serde_json::json!({"runtime_handle": "process-local"}),
        );
        outcome.outcome_fingerprint = outcome.compute_fingerprint().unwrap();
        let error = outcome.validate().unwrap_err();
        assert!(error.to_string().contains("runtime handles"), "{error}");
    }

    #[cfg(dag_ml_workspace_contract_fixtures)]
    #[test]
    fn strict_parser_rejects_future_version_even_when_resigned() {
        let mut future: serde_json::Value = serde_json::from_str(REFIT_FIXTURE).unwrap();
        future["schema_version"] = serde_json::json!(2);
        let mut provisional: TrainingOutcome = serde_json::from_value(future.clone()).unwrap();
        provisional.outcome_fingerprint = provisional.compute_fingerprint().unwrap();
        future["outcome_fingerprint"] =
            serde_json::Value::String(provisional.outcome_fingerprint.clone());
        assert!(TrainingOutcome::from_json(&serde_json::to_string(&future).unwrap()).is_err());
    }

    #[cfg(dag_ml_workspace_contract_fixtures)]
    #[test]
    fn select_lineage_is_portable_but_foreign_phase_is_rejected() {
        let mut outcome = TrainingOutcome::from_json(REFIT_FIXTURE).unwrap();
        let mut select = outcome.lineage[0].clone();
        select.record_id = LineageId::new("lineage:select:audit").unwrap();
        select.phase = Phase::Select;
        select.fold_id = None;
        select.input_lineage.clear();
        select.artifact_refs.clear();
        outcome.lineage.push(select.clone());
        outcome
            .lineage
            .sort_by(|left, right| left.record_id.cmp(&right.record_id));
        outcome.outcome_fingerprint = zero_fingerprint();
        outcome.outcome_fingerprint = outcome.compute_fingerprint().unwrap();
        outcome.validate().unwrap();

        let added = outcome
            .lineage
            .iter_mut()
            .find(|record| record.record_id.as_str() == "lineage:select:audit")
            .unwrap();
        added.phase = Phase::Predict;
        added.record_id = LineageId::new("lineage:predict:foreign").unwrap();
        outcome
            .lineage
            .sort_by(|left, right| left.record_id.cmp(&right.record_id));
        outcome.outcome_fingerprint = zero_fingerprint();
        outcome.outcome_fingerprint = outcome.compute_fingerprint().unwrap();
        assert!(outcome.validate().is_err());
    }

    #[test]
    fn every_data_identity_must_bind_the_global_relation() {
        let relation = "a".repeat(64);
        let identity = |key: &str, relation_fingerprint: String| TrainingDataIdentity {
            requirement_key: key.to_string(),
            schema_fingerprint: "b".repeat(64),
            plan_fingerprint: "c".repeat(64),
            relation_fingerprint,
            data_content_fingerprint: "d".repeat(64),
            target_content_fingerprint: "e".repeat(64),
            identity_fingerprint: "f".repeat(64),
        };
        let identities = vec![
            identity("model:a.x", relation.clone()),
            identity("model:b.x", "9".repeat(64)),
        ];
        assert!(validate_all_identity_relations(&identities, &relation).is_err());
        let identities = vec![
            identity("model:a.x", relation.clone()),
            identity("model:b.x", relation.clone()),
        ];
        validate_all_identity_relations(&identities, &relation).unwrap();
    }

    #[test]
    fn auxiliary_report_levels_do_not_override_selection_target_level() {
        let report = |producer: &str, level| crate::metrics::RegressionMetricReport {
            prediction_id: Some(format!("prediction:{producer}")),
            producer_node: NodeId::new(producer).unwrap(),
            producer_port: None,
            variant_id: Some(VariantId::new("variant:test").unwrap()),
            variant_label: None,
            partition: PredictionPartition::Validation,
            fold_id: Some(crate::ids::FoldId::new("avg").unwrap()),
            level,
            row_count: 2,
            target_width: 1,
            target_names: vec!["y".to_string()],
            metrics: BTreeMap::from([("rmse".to_string(), 0.1)]),
        };
        let reports = vec![
            report("model:target", PredictionLevel::Sample),
            report("model:target", PredictionLevel::Group),
            report("model:aux", PredictionLevel::Group),
        ];
        validate_selection_report_levels(
            &reports,
            &NodeId::new("model:target").unwrap(),
            &None,
            PredictionLevel::Sample,
        )
        .unwrap();
        assert!(validate_selection_report_levels(
            &reports,
            &NodeId::new("model:target").unwrap(),
            &None,
            PredictionLevel::Target,
        )
        .is_err());
    }
}
