//! Runtime execution: schedulers, controllers, stores, OOF/merge logic.
//!
//! Split from the former monolithic `runtime.rs` into cohesive submodules
//! (pure refactor — code moved verbatim). `mod.rs` owns the run context,
//! the controller registry, the custom-aggregation dispatch entry points,
//! native variant selection, and re-exports the full runtime surface so
//! `pub use runtime::*` in `lib.rs` resolves identically.

pub(crate) use std::cell::RefCell;
pub(crate) use std::collections::{BTreeMap, BTreeSet};
pub(crate) use std::fs;
pub(crate) use std::io::Read;
pub(crate) use std::path::{Path, PathBuf};

pub(crate) use serde::{Deserialize, Serialize};
pub(crate) use sha2::{Digest, Sha256};

pub(crate) use crate::aggregation::{
    aggregate_observation_predictions, aggregate_sample_predictions_by_unit,
    reduce_predictions_across_branches, reduce_proba_mean_across_branches,
    AggregatedPredictionBlock, AggregationControllerInput, AggregationControllerOutput,
    AggregationControllerResult, AggregationControllerTask, ObservationPredictionBlock,
    PredictionUnitId,
};
pub(crate) use crate::bundle::{
    build_aggregated_prediction_cache_payload, build_prediction_cache_payload,
    bundle_prediction_requirement_key, validate_prediction_cache_payload_matches_record,
    BundlePredictionCachePayload, BundlePredictionCachePayloadSet, BundlePredictionCacheRecord,
    BundlePredictionRequirement, ExecutionBundle, RefitArtifactRecord, ReplayPhaseRequest,
};
pub(crate) use crate::campaign::stable_json_fingerprint;
pub(crate) use crate::controller::{capabilities_support_fit_influence, ControllerCapability};
pub(crate) use crate::criteria::{EarlyStoppingRecord, LossExecutionAttestation};
pub(crate) use crate::data::{
    data_binding_requirement_key, DataBinding, DataRequestPartition, ExternalDataPlanEnvelope,
    RepresentationCompatibilityReport, RepresentationPlan, RepresentationReplayManifest,
};
pub(crate) use crate::error::{DagMlError, Result};
pub(crate) use crate::fold::{FoldAssignment, FoldPartitionMode, FoldSet};
pub(crate) use crate::generation::{
    enumerate_variants, GenerationChoice, OperatorVariantModel, VariantPlan,
};
pub(crate) use crate::graph::{EdgeSpec, NodeKind, PortKind};
pub(crate) use crate::ids::{
    ArtifactId, BranchId, BundleId, ControllerId, FoldId, LineageId, NodeId, RunId, SampleId,
    VariantId,
};
pub(crate) use crate::metrics::{
    cross_fold_validation_reports, reassemble_merge_targets, score_regression_aggregated_block,
    score_regression_prediction_block, OofAverageBlock, RegressionMetricKind,
    RegressionMetricReport, RegressionTargetBlock, RegressionTargetRecord, ScoreSet,
    SCORE_SET_SCHEMA_VERSION,
};
pub(crate) use crate::oof::{
    PredictionBlock, PredictionPartition, StackingOofRefitContract, StackingOofRefitDecision,
    StackingOofRefitPolicy,
};
pub(crate) use crate::phase::Phase;
pub(crate) use crate::plan::{prune_plan_to_active, CampaignSpec, ExecutionPlan, NodePlan};
pub(crate) use crate::policy::{
    AggregationPolicy, FitInfluencePolicy, PredictionLevel, ShapeDelta, ShapeDeltaKind,
};
pub(crate) use crate::relation::SampleRelationSet;
pub(crate) use crate::rng::SeedContext;
pub(crate) use crate::selection::{
    select_candidate, CandidateScore, SelectionDecision, SelectionMetric, SelectionPolicy,
};

mod artifact;
mod dataview;
mod merge;
mod methods_replay;
mod oof;
mod prediction_store;
mod scheduler;
mod scoring;
mod stacking;
mod task;

pub use artifact::*;
pub use dataview::*;
pub(crate) use merge::*;
#[cfg(feature = "methods-optimizer")]
pub use methods_replay::*;
pub use oof::*;
pub use prediction_store::*;
pub use scheduler::*;
pub(crate) use scoring::*;
pub(crate) use stacking::*;
pub use task::*;

pub struct BundleReplayExecution<'a> {
    pub plan: &'a ExecutionPlan,
    pub bundle: &'a ExecutionBundle,
    pub replay_request: &'a ReplayPhaseRequest,
    pub prediction_cache_store: Option<&'a dyn RuntimePredictionCacheStore>,
    pub controllers: &'a RuntimeControllerRegistry,
    pub data_provider: &'a dyn RuntimeDataProvider,
    pub artifact_store: &'a dyn RuntimeArtifactStore,
    pub data_envelopes: &'a BTreeMap<String, ExternalDataPlanEnvelope>,
}

#[derive(Default)]
pub struct RuntimeControllerRegistry {
    controllers: BTreeMap<ControllerId, Box<dyn RuntimeController>>,
}

impl RuntimeControllerRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn register(&mut self, controller: Box<dyn RuntimeController>) -> Result<()> {
        let id = controller.controller_id().clone();
        if self.controllers.insert(id.clone(), controller).is_some() {
            return Err(DagMlError::RuntimeValidation(format!(
                "duplicate runtime controller `{id}`"
            )));
        }
        Ok(())
    }

    pub fn get(&self, controller_id: &ControllerId) -> Option<&dyn RuntimeController> {
        self.controllers.get(controller_id).map(Box::as_ref)
    }
}

pub fn dispatch_custom_observation_aggregation(
    plan: &ExecutionPlan,
    controllers: &RuntimeControllerRegistry,
    task_id: impl Into<String>,
    block: ObservationPredictionBlock,
    relations: SampleRelationSet,
    policy: AggregationPolicy,
    requested_sample_order: Vec<SampleId>,
) -> Result<PredictionBlock> {
    let controller_id = custom_aggregation_controller_id(&policy)?;
    ensure_aggregation_controller_capability(plan, controller_id)?;
    let task = AggregationControllerTask {
        schema_version: crate::aggregation::AGGREGATION_CONTROLLER_TASK_SCHEMA_VERSION,
        task_id: task_id.into(),
        controller_id: controller_id.clone(),
        policy,
        reduction_plan: None,
        input: AggregationControllerInput::ObservationToSample {
            block,
            relations,
            requested_sample_order,
        },
    };
    let result = dispatch_custom_aggregation_task(controllers, &task)?;
    match result.output {
        AggregationControllerOutput::Sample { block } => Ok(block),
        AggregationControllerOutput::Unit { .. } => Err(DagMlError::RuntimeValidation(format!(
            "aggregation controller task `{}` returned unit output for observation input",
            task.task_id
        ))),
    }
}

pub fn dispatch_custom_sample_aggregation(
    plan: &ExecutionPlan,
    controllers: &RuntimeControllerRegistry,
    task_id: impl Into<String>,
    block: PredictionBlock,
    relations: SampleRelationSet,
    policy: AggregationPolicy,
    requested_unit_order: Vec<PredictionUnitId>,
) -> Result<AggregatedPredictionBlock> {
    let controller_id = custom_aggregation_controller_id(&policy)?;
    ensure_aggregation_controller_capability(plan, controller_id)?;
    let task = AggregationControllerTask {
        schema_version: crate::aggregation::AGGREGATION_CONTROLLER_TASK_SCHEMA_VERSION,
        task_id: task_id.into(),
        controller_id: controller_id.clone(),
        policy,
        reduction_plan: None,
        input: AggregationControllerInput::SampleToUnit {
            block,
            relations,
            requested_unit_order,
        },
    };
    let result = dispatch_custom_aggregation_task(controllers, &task)?;
    match result.output {
        AggregationControllerOutput::Unit { block } => Ok(block),
        AggregationControllerOutput::Sample { .. } => Err(DagMlError::RuntimeValidation(format!(
            "aggregation controller task `{}` returned sample output for sample input",
            task.task_id
        ))),
    }
}

pub fn dispatch_custom_aggregation_task(
    controllers: &RuntimeControllerRegistry,
    task: &AggregationControllerTask,
) -> Result<AggregationControllerResult> {
    task.validate()?;
    let controller = controllers.get(&task.controller_id).ok_or_else(|| {
        DagMlError::RuntimeValidation(format!(
            "aggregation runtime controller `{}` is not registered",
            task.controller_id
        ))
    })?;
    let result = controller.invoke_aggregation(task)?;
    result.validate_for_task(task)?;
    Ok(result)
}

pub(crate) fn custom_aggregation_controller_id(
    policy: &AggregationPolicy,
) -> Result<&ControllerId> {
    policy.validate()?;
    policy
        .custom_controller
        .as_ref()
        .map(|controller| &controller.controller_id)
        .ok_or_else(|| {
            DagMlError::RuntimeValidation(
                "custom aggregation dispatch requires a custom_controller policy".to_string(),
            )
        })
}

pub(crate) fn ensure_aggregation_controller_capability(
    plan: &ExecutionPlan,
    controller_id: &ControllerId,
) -> Result<()> {
    let manifest = plan
        .controller_manifests
        .get(controller_id)
        .ok_or_else(|| {
            DagMlError::Planning(format!(
                "missing aggregation controller manifest `{controller_id}`"
            ))
        })?;
    if !manifest
        .capabilities
        .contains(&ControllerCapability::AggregatesPredictions)
    {
        return Err(DagMlError::Planning(format!(
            "aggregation controller `{controller_id}` must declare aggregates_predictions"
        )));
    }
    Ok(())
}

#[derive(Clone, Debug)]
pub struct RunContext {
    pub run_id: RunId,
    pub root_seed: Option<u64>,
    pub variant_id: Option<VariantId>,
    pub prediction_store: InMemoryPredictionStore,
    pub aggregated_prediction_store: InMemoryAggregatedPredictionStore,
    pub lineage: InMemoryLineageRecorder,
    /// Native per-fold/per-partition score reports collected during the run (when the host emits
    /// `regression_targets`).
    pub score_collector: Vec<RegressionMetricReport>,
    /// Per-fold `y_true` records, kept so cross-fold ensembles (the OOF average) can be scored.
    pub regression_target_records: Vec<RegressionTargetRecord>,
    /// The per-sample cross-fold OOF average blocks (+ `y_true`) collected alongside the scalar OOF
    /// average reports — one per scored producer. Surfaced so the host can fill the `(validation, avg)`
    /// row's per-sample y_pred; populated by `collect_cross_fold_validation_scores`, empty otherwise.
    pub oof_average_blocks: Vec<OofAverageBlock>,
    /// Declarative per-producer aggregation contracts that are applied only after every
    /// validation fold has contributed its raw sample-level OOF block.  This is deliberately
    /// separate from the per-task aggregation path: a semantic unit may span CV folds, so
    /// reducing it inside one fold would change the experiment being scored.
    pub(crate) global_oof_aggregation: BTreeMap<NodeId, GlobalOofAggregationSpec>,
    /// When nested stacking retains child-fold evidence in this shared context,
    /// only the listed parent folds are report-grade CV evidence.  Child OOF is
    /// still available to the scheduler/meta learner, but can never enter
    /// selection or cross-fold score aggregation.
    pub(crate) validation_scoring_fold_ids: Option<BTreeSet<FoldId>>,
}

#[derive(Clone, Debug)]
pub(crate) struct GlobalOofAggregationSpec {
    pub(crate) policy: AggregationPolicy,
    pub(crate) relations: SampleRelationSet,
}

impl RunContext {
    pub fn new(run_id: RunId, root_seed: Option<u64>) -> Self {
        Self {
            run_id,
            root_seed,
            variant_id: None,
            prediction_store: InMemoryPredictionStore::new(),
            aggregated_prediction_store: InMemoryAggregatedPredictionStore::new(),
            lineage: InMemoryLineageRecorder::new(),
            score_collector: Vec::new(),
            regression_target_records: Vec::new(),
            oof_average_blocks: Vec::new(),
            global_oof_aggregation: BTreeMap::new(),
            validation_scoring_fold_ids: None,
        }
    }

    /// Bind the relation-attested aggregation policies needed for global OOF scoring before the
    /// caller executes `FIT_CV`.  The provider remains the authority for relations; this method
    /// only records a validated, immutable snapshot in the run context so finalisation cannot
    /// silently use a different grouping from execution.
    pub(crate) fn configure_global_oof_aggregation(
        &mut self,
        plan: &ExecutionPlan,
        data_provider: &dyn RuntimeDataProvider,
    ) -> Result<()> {
        self.global_oof_aggregation = global_oof_aggregation_specs(plan, data_provider)?;
        Ok(())
    }

    /// Score the cross-fold OOF average from the collected per-fold validation predictions + targets
    /// and append the reports (one per producer, `fold_id = "avg"`) to the score collector, plus —
    /// additively — the per-sample OOF average block + `y_true` each report was computed from to
    /// [`oof_average_blocks`](Self::oof_average_blocks) (so the host can fill the `(validation, avg)`
    /// row's per-sample y_pred). Call after FIT_CV; a no-op when nothing was scored or no producer has
    /// more than one fold.
    ///
    /// `partition_mode` is the campaign's [`FoldPartitionMode`]: `Partition` (KFold) requires a unique
    /// per-producer OOF set, while `Resampled` (ShuffleSplit / repeated CV) permits a sample to be
    /// validated in multiple folds (averaged when scored). Pass the plan's
    /// [`fold_set`](ExecutionPlan::fold_set) mode (default `Partition` when there is no fold set).
    pub fn collect_cross_fold_validation_scores(
        &mut self,
        partition_mode: FoldPartitionMode,
    ) -> Result<()> {
        let scoring_blocks = self
            .prediction_store
            .blocks()
            .iter()
            .filter(|block| {
                block.partition != PredictionPartition::Validation
                    || self
                        .validation_scoring_fold_ids
                        .as_ref()
                        .is_none_or(|allowed| {
                            block
                                .fold_id
                                .as_ref()
                                .is_some_and(|fold_id| allowed.contains(fold_id))
                        })
            })
            .cloned()
            .collect::<Vec<_>>();
        let outcome = cross_fold_validation_reports(
            &scoring_blocks,
            &self.regression_target_records,
            SCORE_METRICS,
            partition_mode,
        )?;
        let outcome = apply_global_oof_aggregation(outcome, &self.global_oof_aggregation)?;
        self.score_collector.extend(outcome.reports);
        self.oof_average_blocks.extend(outcome.oof_averages);
        Ok(())
    }

    /// Build a [`ScoreSet`] from the collected reports (or `None` if scoring was off / produced
    /// nothing), e.g. to attach to the [`ExecutionBundle`].
    pub fn build_score_set(
        &self,
        plan_id: impl Into<String>,
        selection_metric: Option<String>,
    ) -> Option<ScoreSet> {
        if self.score_collector.is_empty() {
            return None;
        }
        Some(ScoreSet {
            schema_version: SCORE_SET_SCHEMA_VERSION,
            plan_id: plan_id.into(),
            selection_metric,
            reports: self.score_collector.clone(),
        })
    }
}

/// Outcome of native variant selection: the winning variant plus EVERY scored variant's
/// cross-validation reports, each tagged with its own `variant_id`.
///
/// The reports are the per-fold + cross-fold-OOF-average VALIDATION (OOF) reports collected while
/// ranking. They are emitted so a generated sweep can surface every variant's CV score — not only
/// the winner's — to match the legacy per-variant `num_predictions`. These are REPORT-ONLY
/// validation scores of non-selected models: they never feed any downstream training/feature path
/// (no prediction blocks, no `RegressionTargetRecord`s, no handles leave selection — see
/// [`select_best_variant_by_cv`]), so the OOF/leakage invariants are unaffected.
#[derive(Clone, Debug)]
pub struct VariantSelection {
    /// The winning variant, ranked by `selection_metric`. The SELECT DECISION is identical to the
    /// pre-existing behavior; `validation_reports` is purely additive context.
    pub selected_variant_id: VariantId,
    /// Per-variant VALIDATION (OOF) reports for ALL ranked variants (winner included), each tagged
    /// with its `variant_id`. The cross-fold OOF average per producer is re-tagged with the variant
    /// id (its native form has `variant_id = None`); the per-fold reports already carry it.
    pub validation_reports: Vec<RegressionMetricReport>,
    /// Per-variant VALIDATION (OOF) PREDICTIONS for ALL ranked variants (winner included), captured
    /// from each variant's transient FIT_CV [`RunContext`] BEFORE it is dropped, re-tagged with the
    /// variant's id + content fingerprint. The scalar [`validation_reports`](Self::validation_reports)
    /// above carry only the score; these carry the per-sample y_pred (+ id-matched y_true) so a host
    /// can fill a non-selected variant's per-fold prediction rows, not just its CV score.
    ///
    /// LEAKAGE: these are each variant's OWN validation (OOF) predictions, re-tagged with that
    /// variant's id (which prevents cross-variant mixing). They are surfaced for host
    /// persistence/display only — every transient CV run executes FIT_CV ONLY (no Final/Test/refit),
    /// so by construction this carries no train/refit predictions, and the captured blocks never feed
    /// a training/feature path or cross a `requires_oof` edge. This is strictly ADDITIVE — the same
    /// values the scalar reports were computed from, exposed per sample — analogous to the additive
    /// OOF-average block surfacing; no leakage validator is relaxed.
    pub variant_validation_predictions: Vec<VariantValidationPredictions>,
}

/// Extended result of native variant selection.
///
/// The historical [`VariantSelection`] remains source-compatible for callers
/// that construct or destructure it. Training orchestration uses this additive
/// result to retain the exact [`SelectionDecision`] produced by the one and
/// only ranking pass.
#[derive(Clone, Debug)]
pub struct VariantSelectionOutcome {
    pub selection: VariantSelection,
    pub decision: SelectionDecision,
}

/// One scored variant's VALIDATION (OOF) predictions, captured from its transient FIT_CV
/// [`RunContext`] and re-tagged with the variant's id + content fingerprint so a host can fill that
/// variant's per-sample prediction rows. REPORT-grade output paired with
/// [`VariantSelection::validation_reports`]: it never feeds a training/feature path (see the field
/// docs on [`VariantSelection::variant_validation_predictions`]).
#[derive(Clone, Debug)]
pub struct VariantValidationPredictions {
    /// The variant these predictions belong to — the re-tag that keeps them from mixing with another
    /// variant's predictions.
    pub variant_id: VariantId,
    /// The variant's Phase-5 content fingerprint (`variant_label`), `None` for param-variant /
    /// single-variant SELECT (which carry no operator-variant fingerprint).
    pub variant_label: Option<String>,
    /// Per-fold VALIDATION (OOF) prediction blocks (`partition = Validation`), one per `(producer,
    /// fold)`, paired POSITION-FOR-POSITION with [`regression_targets`](Self::regression_targets) (the
    /// matching y_true for the same producer/fold/samples).
    pub predictions: Vec<PredictionBlock>,
    /// The id-matched y_true blocks for [`predictions`](Self::predictions), one per prediction block in
    /// the SAME order.
    pub regression_targets: Vec<RegressionTargetBlock>,
    /// The per-sample cross-fold OOF AVERAGE block (+ id-matched y_true), if the variant produced one
    /// (`None` for a single-fold splitter). The same averaged values the variant's scalar `avg` report
    /// was computed from, exposed per sample.
    pub oof_average: Option<OofAverageBlock>,
}

/// Pick the best variant of a multi-variant plan by its cross-validation score, natively.
///
/// "Option A": each variant is scored with its OWN single-variant FIT_CV — the plan is cloned with
/// `variants = vec![variant]` so the existing per-producer cross-fold OOF averaging
/// ([`RunContext::collect_cross_fold_validation_scores`]) is unambiguous (one variant in scope, so a
/// validation `PredictionBlock` belongs to exactly one variant). The OOF-average report per variant
/// becomes a [`CandidateScore`], and [`select_candidate`] ranks them by `selection_metric` (the
/// metric's [`objective`](RegressionMetricKind::objective) drives the direction — RMSE minimizes,
/// accuracy maximizes). The winning candidate id maps back to its [`VariantId`].
///
/// Beyond ranking, every scored variant's VALIDATION (OOF) reports — the per-fold reports and the
/// cross-fold OOF average, each tagged with its `variant_id` — are accumulated and returned in
/// [`VariantSelection::validation_reports`] so the caller can surface ALL variants' CV scores (not
/// just the winner's) in the final bundle. This is OOF-safe: the per-variant CV runs happen in
/// transient `RunContext`s whose prediction stores and `RegressionTargetRecord`s are dropped here;
/// only the scalar score reports (derived from `y_true`) survive, so a non-selected variant's OOF
/// predictions can NEVER reach any downstream training/feature path.
///
/// Native scoring is opt-in: it only happens when the host emits `regression_targets`. So this
/// returns `Ok(None)` when NO variant produced a cross-fold OOF average (scoring is off, the normal
/// case today) — the caller should then fall back to its default variant, behaving exactly as before.
/// When EVERY variant scored, it returns `Ok(Some(best))`. A partially-scored set (some variants
/// scored, others not) is an inconsistent host and is rejected so variants are never ranked unfairly.
///
/// `run_single_variant_fit_cv` runs FIT_CV for the single-variant plan into the supplied context
/// (the caller supplies the scheduler/data-provider wiring); this keeps the selection logic free of
/// host runtime details and unit-testable with mock controllers. Cloning a one-variant plan is
/// valid: `node_plans`/`fold_set` are plan-level (not keyed per variant) and variant params are
/// applied per-node at task build time, so the per-variant CV is isolated.
pub fn select_best_variant_by_cv<F>(
    plan: &ExecutionPlan,
    run_id: &RunId,
    root_seed: Option<u64>,
    selection_metric: RegressionMetricKind,
    run_single_variant_fit_cv: F,
) -> Result<Option<VariantSelection>>
where
    F: FnMut(&ExecutionPlan, &mut RunContext) -> Result<()>,
{
    Ok(select_best_variant_outcome_by_cv(
        plan,
        run_id,
        root_seed,
        selection_metric,
        run_single_variant_fit_cv,
    )?
    .map(|outcome| outcome.selection))
}

/// Select the best plan variant and retain the exact decision produced by the
/// shared native ranking pass.
///
/// This is the training-operation counterpart of
/// [`select_best_variant_by_cv`]. It does not perform an additional SELECT;
/// the legacy helper simply projects this result back to its historical type.
pub fn select_best_variant_outcome_by_cv<F>(
    plan: &ExecutionPlan,
    run_id: &RunId,
    root_seed: Option<u64>,
    selection_metric: RegressionMetricKind,
    mut run_single_variant_fit_cv: F,
) -> Result<Option<VariantSelectionOutcome>>
where
    F: FnMut(&ExecutionPlan, &mut RunContext) -> Result<()>,
{
    plan.validate()?;
    if plan.variants.is_empty() {
        return Err(DagMlError::RuntimeValidation(
            "cannot select a variant for a plan with no variants".to_string(),
        ));
    }
    // Mechanism A: each variant is the FULL union plan narrowed to that single variant — params are
    // applied per-node at task-build time, so cloning a one-variant plan is the per-variant scope.
    score_and_rank_variants_by_cv(
        &plan.variants,
        run_id,
        root_seed,
        selection_metric,
        plan_oof_partition_mode(plan),
        None,
        |variant| {
            Ok(ExecutionPlan {
                variants: vec![variant.clone()],
                ..plan.clone()
            })
        },
        // Param-variant SELECT (Mechanism A) has no operator-variant content fingerprint, so reports
        // carry `variant_id` only (no `variant_label`) — exactly the pre-Phase-5 shape.
        |_variant| Ok(None),
        &mut run_single_variant_fit_cv,
    )
}

/// Select a plan variant using only the cross-fold OOF average emitted by one
/// explicitly resolved score-target producer. All producers' validation
/// reports remain retained in the returned outcome for audit.
#[allow(clippy::too_many_arguments)]
pub fn select_best_variant_outcome_by_cv_for_target<F>(
    plan: &ExecutionPlan,
    run_id: &RunId,
    root_seed: Option<u64>,
    selection_metric: RegressionMetricKind,
    score_target: &NodeId,
    score_target_port: Option<&str>,
    score_target_level: PredictionLevel,
    mut run_single_variant_fit_cv: F,
) -> Result<Option<VariantSelectionOutcome>>
where
    F: FnMut(&ExecutionPlan, &mut RunContext) -> Result<()>,
{
    plan.validate()?;
    if !plan.node_plans.contains_key(score_target) {
        return Err(DagMlError::RuntimeValidation(format!(
            "native SELECT score target `{score_target}` is absent from plan"
        )));
    }
    score_and_rank_variants_by_cv(
        &plan.variants,
        run_id,
        root_seed,
        selection_metric,
        plan_oof_partition_mode(plan),
        Some((score_target, score_target_port, score_target_level)),
        |variant| {
            Ok(ExecutionPlan {
                variants: vec![variant.clone()],
                ..plan.clone()
            })
        },
        |_variant| Ok(None),
        &mut run_single_variant_fit_cv,
    )
}

/// Pick the best OPERATOR variant of an operator-generator UNION plan by its cross-validation score.
///
/// Where [`select_best_variant_by_cv`] narrows the SAME union plan to one variant (Mechanism A: param
/// variants), operator-SELECT scores each candidate on its PRUNED plan: the Mechanism-B union
/// compiles an operator generator as a STACKING graph (`choice -> merge:generator_predictions ->
/// model:meta`), but operator `_or_` is SELECT, not stacking — so each candidate is the union pruned
/// down to one choice's sub-sequence + the shared prefix, with the generator merge + meta-model +
/// every inactive choice ELIDED (see [`prune_plan_to_active`]). The pruned candidate has exactly ONE
/// terminal producer, so the single-producer guard in the shared ranking loop is satisfied.
///
/// `model` is the [`OperatorVariantModel`] lowered from the (single, flat) operator generator;
/// `union_plan` is the compiled UNION plan; `selection_metric` drives the ranking direction
/// (`RegressionMetricKind::objective`). MULTIPLE operator generators are REJECTED here (consistent
/// with the Phase-3 nested-rejection: this phase scopes to a flat single operator generator).
///
/// LEAKAGE: each variant runs in a fresh, variant-pinned [`RunContext`] over its PRUNED graph — the
/// inactive choices' models are physically absent, so they are never fit and no `requires_oof` edge
/// can pull an inactive variant's OOF. The non-selected variants' OOF predictions never leave their
/// transient contexts (only their scalar VALIDATION reports survive), exactly as in
/// [`select_best_variant_by_cv`].
///
/// Returns `Ok(None)` when scoring is off (no host targets) — the caller keeps its default — and
/// `Ok(Some(best))` when every variant scored.
pub fn select_best_operator_variant_by_cv<F>(
    union_plan: &ExecutionPlan,
    model: &OperatorVariantModel,
    run_id: &RunId,
    root_seed: Option<u64>,
    selection_metric: RegressionMetricKind,
    mut run_single_variant_fit_cv: F,
) -> Result<Option<VariantSelection>>
where
    F: FnMut(&ExecutionPlan, &mut RunContext) -> Result<()>,
{
    union_plan.validate()?;
    model.validate()?;
    let variants = enumerate_variants(&model.generation_spec(), root_seed)?;
    if variants.is_empty() {
        return Err(DagMlError::RuntimeValidation(format!(
            "operator variant model `{}` produced no variants",
            model.generator_id
        )));
    }
    // The union of every choice's active set: subtracted from each candidate's ancestors so a prune
    // never pulls in a sibling choice (or the elided merge/meta).
    let all_choice_nodes = model
        .active_nodes
        .values()
        .flatten()
        .cloned()
        .collect::<BTreeSet<NodeId>>();
    // Map each enumerated variant back to its operator choice (the choice's `active_subsequence`
    // keys `active_nodes`) via `operator_variant_active_subsequence`. The model is a single operator
    // dimension, so each variant carries exactly one choice.
    Ok(score_and_rank_variants_by_cv(
        &variants,
        run_id,
        root_seed,
        selection_metric,
        plan_oof_partition_mode(union_plan),
        None,
        |variant| {
            let active_subsequence = operator_variant_active_subsequence(model, variant)?;
            let active_nodes = model.active_nodes.get(active_subsequence).ok_or_else(|| {
                DagMlError::RuntimeValidation(format!(
                    "operator variant model `{}` has no active-node set for `{active_subsequence}`",
                    model.generator_id
                ))
            })?;
            prune_plan_to_active(union_plan, active_nodes, &all_choice_nodes, variant)
        },
        // Phase 5: stamp the choice's cross-language content fingerprint on every report. The
        // operator model's `variant_labels` is the choice-keyed sha256; when a model was hand-built
        // without labels (the older execution fixtures), the map is empty and reports carry no label.
        |variant| {
            let active_subsequence = operator_variant_active_subsequence(model, variant)?;
            Ok(model.variant_labels.get(active_subsequence).cloned())
        },
        &mut run_single_variant_fit_cv,
    )?
    .map(|outcome| outcome.selection))
}

/// Resolve the `active_subsequence` (choice key) of an enumerated operator variant against its
/// model's single operator dimension. Shared by the prune-plan and the `variant_label` resolvers so
/// both agree on the choice a variant names.
fn operator_variant_active_subsequence<'a>(
    model: &OperatorVariantModel,
    variant: &'a VariantPlan,
) -> Result<&'a str> {
    let dimension_name = &model.dimension.name;
    let choice = variant.choices.get(dimension_name).ok_or_else(|| {
        DagMlError::RuntimeValidation(format!(
            "operator variant `{}` is missing the operator dimension `{dimension_name}`",
            variant.variant_id
        ))
    })?;
    choice.active_subsequence.as_deref().ok_or_else(|| {
        DagMlError::RuntimeValidation(format!(
            "operator variant `{}` choice `{}` has no active_subsequence",
            variant.variant_id, choice.label
        ))
    })
}

/// Route operator-SELECT from the operator-variant models lowered off a pipeline DSL
/// ([`compile_operator_variant_models`](crate::compile_operator_variant_models)).
///
/// This phase scopes to a FLAT, SINGLE operator generator (consistent with the Phase-3
/// nested-generator rejection), so MORE THAN ONE operator generator is rejected with a clear error.
/// An empty slice means the spec has no operator generator at all — there is nothing to operator-SELECT,
/// so it returns `Ok(None)` (the caller keeps its default variant). Exactly one model delegates to
/// [`select_best_operator_variant_by_cv`].
pub fn select_best_operator_variant_from_models<F>(
    union_plan: &ExecutionPlan,
    models: &[OperatorVariantModel],
    run_id: &RunId,
    root_seed: Option<u64>,
    selection_metric: RegressionMetricKind,
    run_single_variant_fit_cv: F,
) -> Result<Option<VariantSelection>>
where
    F: FnMut(&ExecutionPlan, &mut RunContext) -> Result<()>,
{
    match models {
        [] => Ok(None),
        [model] => select_best_operator_variant_by_cv(
            union_plan,
            model,
            run_id,
            root_seed,
            selection_metric,
            run_single_variant_fit_cv,
        ),
        _ => Err(DagMlError::RuntimeValidation(format!(
            "operator-SELECT does not support {} operator generators in one pipeline; this phase scopes to a flat single operator generator (generators: {})",
            models.len(),
            models
                .iter()
                .map(|model| model.generator_id.to_string())
                .collect::<Vec<_>>()
                .join(", ")
        ))),
    }
}

/// The shared scoring + ranking loop behind [`select_best_variant_by_cv`] and
/// [`select_best_operator_variant_by_cv`]: per variant, build its per-variant plan (`make_variant_plan`),
/// run FIT_CV into a fresh variant-pinned [`RunContext`], collect the cross-fold OOF average, and
/// rank by `selection_metric`. The two callers differ ONLY in `make_variant_plan` (clone-the-union
/// vs. prune-to-active); everything below — the single-producer guard, the all-or-nothing scoring
/// gate, the loser-report retention, and [`select_candidate`] ranking — is identical and lives here.
/// `resolve_variant_label` resolves each variant's Phase-5 content fingerprint (the two closures
/// keep the shared loop free of caller-specific plumbing).
#[allow(clippy::too_many_arguments)]
fn score_and_rank_variants_by_cv<M, L, F>(
    variants: &[VariantPlan],
    run_id: &RunId,
    root_seed: Option<u64>,
    selection_metric: RegressionMetricKind,
    partition_mode: FoldPartitionMode,
    score_target: Option<(&NodeId, Option<&str>, PredictionLevel)>,
    mut make_variant_plan: M,
    mut resolve_variant_label: L,
    run_single_variant_fit_cv: &mut F,
) -> Result<Option<VariantSelectionOutcome>>
where
    M: FnMut(&VariantPlan) -> Result<ExecutionPlan>,
    L: FnMut(&VariantPlan) -> Result<Option<String>>,
    F: FnMut(&ExecutionPlan, &mut RunContext) -> Result<()>,
{
    if variants.is_empty() {
        return Err(DagMlError::RuntimeValidation(
            "cannot select a variant for a plan with no variants".to_string(),
        ));
    }

    let mut candidates: Vec<CandidateScore> = Vec::with_capacity(variants.len());
    // Every ranked variant's VALIDATION (OOF) reports, each tagged with its variant_id, accumulated
    // so the caller can emit ALL variants' CV scores (not just the winner's) in the bundle.
    let mut variant_validation_reports: Vec<RegressionMetricReport> = Vec::new();
    // Every ranked variant's VALIDATION (OOF) PREDICTIONS, captured from its transient ctx and
    // re-tagged with its variant id + content fingerprint, so the caller can fill a non-selected
    // variant's per-sample prediction rows (not just its scalar CV score). Captured per variant; the
    // caller filters to the LOSERS (the winner's predictions come fresh from the real FIT_CV pass).
    let mut variant_validation_predictions: Vec<VariantValidationPredictions> = Vec::new();
    // Tracks whether ANY variant emitted scores at all (host targets present), so an empty candidate
    // set can be told apart from "scoring genuinely off" (no targets) — see the post-loop branch.
    let mut any_scores_seen = false;
    for variant in variants {
        let variant_plan = make_variant_plan(variant)?;
        // Phase 5: the operator-variant content fingerprint for this variant (the choice's
        // `variant_label`), resolved the SAME way `variant_id` is — `None` for param-variant /
        // single-variant SELECT, `Some(<sha256>)` for an operator choice.
        let variant_label = resolve_variant_label(variant)?;
        let mut ctx = RunContext::new(run_id.clone(), root_seed);
        ctx.variant_id = Some(variant.variant_id.clone());
        run_single_variant_fit_cv(&variant_plan, &mut ctx)?;
        ctx.collect_cross_fold_validation_scores(partition_mode)?;
        if !ctx.score_collector.is_empty() {
            any_scores_seen = true;
        }
        // ADDITIVE prediction capture (paired with the scalar report retention below). Each per-fold
        // VALIDATION (OOF) `PredictionBlock` in this variant's transient store is captured together
        // with its id-matched y_true, plus the cross-fold OOF AVERAGE block — re-tagged with the
        // variant's id + content fingerprint. Only `Validation` blocks are captured: the transient run
        // executes FIT_CV ONLY (no Final/Test/refit), so this is OOF-only by construction, and the
        // re-tag prevents cross-variant mixing. The same values the scalar reports were computed from,
        // exposed per sample — strictly additive (the captured blocks never feed a training/feature
        // path or cross a `requires_oof` edge).
        let captured = capture_variant_validation_predictions(
            &variant.variant_id,
            variant_label.clone(),
            &ctx,
        );
        if !captured.predictions.is_empty() || captured.oof_average.is_some() {
            variant_validation_predictions.push(captured);
        }
        // `cross_fold_validation_reports` emits one cross-fold OOF average PER producer. Native SELECT
        // ranks a variant by a single score, so a multi-producer DAG is ambiguous and refused rather
        // than silently ranked on whichever producer happened to be first (an explicit score-target
        // producer is a future extension). For operator-SELECT the pruned candidate has exactly one
        // terminal producer, so this guard is satisfied by construction.
        let avg_reports = ctx
            .score_collector
            .iter()
            .filter(|report| {
                report.partition == PredictionPartition::Validation
                    && score_target.is_none_or(|(target, target_port, level)| {
                        &report.producer_node == target
                            && target_port
                                .is_none_or(|port| report.producer_port.as_deref() == Some(port))
                            && report.level == level
                    })
                    && report
                        .fold_id
                        .as_ref()
                        .is_some_and(|fold| fold.as_str() == "avg")
            })
            .collect::<Vec<_>>();
        match avg_reports.as_slice() {
            [] => {}
            [report] => candidates.push(
                (*report)
                    .clone()
                    .into_candidate_score(variant.variant_id.as_str())?,
            ),
            _ => {
                return Err(DagMlError::RuntimeValidation(format!(
                    "variant `{}` produced {} cross-fold OOF averages (multiple prediction producers); native SELECT needs a single score target",
                    variant.variant_id,
                    avg_reports.len()
                )));
            }
        }
        // Retain this variant's VALIDATION reports (per-fold + cross-fold avg) tagged with its own
        // variant_id. The avg report's native form has `variant_id = None`, so stamp it here; the
        // per-fold reports already carry it from `apply_result_scoring`. Only Validation reports are
        // kept — the transient CV runs FIT_CV only (no Final/Test), so this is OOF-only by
        // construction, but the filter makes the report-only guarantee explicit.
        for mut report in ctx.score_collector {
            if report.partition != PredictionPartition::Validation {
                continue;
            }
            report.variant_id = Some(variant.variant_id.clone());
            report.variant_label = variant_label.clone();
            variant_validation_reports.push(report);
        }
    }

    if candidates.is_empty() {
        if any_scores_seen {
            // Targets WERE emitted, but no producer yielded a cross-fold average (e.g. a single fold,
            // where the average is skipped). We cannot rank — surface it instead of falling back.
            return Err(DagMlError::RuntimeValidation(
                "variants produced scores but no cross-fold OOF average; cannot rank — need >=2 folds or an explicit score target".to_string(),
            ));
        }
        // Native scoring is genuinely off (no host targets) — let the caller keep its default variant.
        return Ok(None);
    }
    if candidates.len() != variants.len() {
        return Err(DagMlError::RuntimeValidation(format!(
            "native variant SELECT scored only {} of {} variants; cannot rank variants fairly",
            candidates.len(),
            variants.len()
        )));
    }

    let policy = SelectionPolicy {
        id: format!("select:variant:{}", selection_metric.name()),
        metric: SelectionMetric {
            name: selection_metric.name().to_string(),
            objective: selection_metric.objective(),
        },
        required_metric_level: None,
        require_finite: true,
        evaluation_scope: None,
        refit_slot_plan: None,
        stacking_fit_contract: None,
        reduction_id: None,
    };
    let decision = select_candidate(&policy, &candidates)?;
    let selected_variant_id =
        VariantId::new(decision.selected_candidate_id.clone()).map_err(|error| {
            DagMlError::RuntimeValidation(format!("selected variant id is invalid: {error}"))
        })?;
    Ok(Some(VariantSelectionOutcome {
        selection: VariantSelection {
            selected_variant_id,
            validation_reports: variant_validation_reports,
            variant_validation_predictions,
        },
        decision,
    }))
}

/// Capture one variant's per-fold VALIDATION (OOF) predictions (paired with id-matched y_true) and
/// its cross-fold OOF AVERAGE block from a transient FIT_CV [`RunContext`], re-tagged with the
/// variant's id + content fingerprint. ADDITIVE + leakage-safe: only `Validation` blocks are read (a
/// transient run is FIT_CV-only, so no Final/Test/refit block exists), and the captured blocks are
/// copies surfaced for host display — they never feed a training/feature path. The per-fold y_true is
/// the same record `apply_result_scoring` retained for the score, found by `(producer, fold)`; a
/// prediction with no matching record is skipped (it could not have been scored either).
///
/// The matched target record covers exactly the prediction block's SAMPLE SET (see
/// `sample_targets_match_block`) but its rows may be in a DIFFERENT ORDER than `block.sample_ids` — a
/// host controller may validly emit its `regression_targets` in any order. The scoring path realigns
/// by unit id, but the host surfaces these blocks POSITIONALLY (y_pred from `block.sample_ids`/`values`
/// paired row-for-row with `regression_targets.values`), so the y_true is REBUILT in `block.sample_ids`
/// order here — exactly as [`oof_average_block`](crate::metrics) does for the avg — so a host pairs
/// y_pred ↔ y_true per sample without re-sorting.
pub(crate) fn capture_variant_validation_predictions(
    variant_id: &VariantId,
    variant_label: Option<String>,
    ctx: &RunContext,
) -> VariantValidationPredictions {
    let mut predictions = Vec::new();
    let mut regression_targets = Vec::new();
    for block in ctx.prediction_store.blocks() {
        if block.partition != PredictionPartition::Validation {
            continue;
        }
        let Some(record) = ctx.regression_target_records.iter().find(|record| {
            record.producer_node == block.producer_node
                && record.producer_port == block.producer_port
                && record.partition == PredictionPartition::Validation
                && record.fold_id == block.fold_id
        }) else {
            continue;
        };
        predictions.push(block.clone());
        regression_targets.push(target_block_aligned_to_samples(
            &block.sample_ids,
            &record.block,
        ));
    }
    VariantValidationPredictions {
        variant_id: variant_id.clone(),
        variant_label,
        predictions,
        regression_targets,
        // A target/group global OOF aggregate is appended after its source sample average.  Prefer
        // that semantic score surface when present; legacy/sample-only executions retain the
        // historical first average unchanged.
        oof_average: ctx
            .oof_average_blocks
            .iter()
            .rev()
            .find(|block| block.predictions.level != PredictionLevel::Sample)
            .cloned()
            .or_else(|| ctx.oof_average_blocks.first().cloned()),
    }
}

/// Rebuild a per-fold VALIDATION `y_true` block in `sample_ids` ORDER so a host can pair it
/// POSITIONALLY with the prediction block's `values` (the host surfaces direct prediction/target pairs
/// by row position, not by id). `targets` covers exactly the same SAMPLE SET as `sample_ids` (the
/// `sample_targets_match_block` precondition under which this record was retained), so every sample has
/// a row; a missing one would indicate a broken invariant, so the original block is returned unchanged
/// rather than dropping rows. Mirrors the avg realignment in [`oof_average_block`](crate::metrics).
fn target_block_aligned_to_samples(
    sample_ids: &[SampleId],
    targets: &RegressionTargetBlock,
) -> RegressionTargetBlock {
    let value_by_sample: BTreeMap<&SampleId, &Vec<f64>> = targets
        .unit_ids
        .iter()
        .zip(&targets.values)
        .filter_map(|(unit_id, row)| match unit_id {
            PredictionUnitId::Sample(sample_id) => Some((sample_id, row)),
            _ => None,
        })
        .collect();
    if sample_ids
        .iter()
        .any(|sample_id| !value_by_sample.contains_key(sample_id))
    {
        return targets.clone();
    }
    RegressionTargetBlock {
        level: PredictionLevel::Sample,
        unit_ids: sample_ids
            .iter()
            .cloned()
            .map(PredictionUnitId::Sample)
            .collect(),
        values: sample_ids
            .iter()
            .map(|sample_id| value_by_sample[sample_id].clone())
            .collect(),
        target_names: targets.target_names.clone(),
    }
}

#[cfg(test)]
mod explain_contract_tests {
    use super::*;

    fn block(method: &str) -> ExplanationBlock {
        ExplanationBlock {
            producer_node: NodeId::new("model:base").unwrap(),
            producer_port: None,
            method: method.to_string(),
            target_name: Some("y".to_string()),
            payload: serde_json::json!({"feature_importance": [0.5, 0.3, 0.2]}),
        }
    }

    #[test]
    fn validates_well_formed_explanation() {
        assert!(block("shap").validate().is_ok());
    }

    #[test]
    fn rejects_empty_method() {
        assert!(block("  ").validate().is_err());
    }

    #[test]
    fn rejects_empty_target_name() {
        let mut b = block("shap");
        b.target_name = Some(String::new());
        assert!(b.validate().is_err());
    }

    #[test]
    fn round_trips_through_json() {
        let b = block("permutation_importance");
        let json = serde_json::to_string(&b).expect("serialize");
        let parsed: ExplanationBlock = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(parsed, b);
        // `target_name` is omitted when absent.
        let mut without = block("shap");
        without.target_name = None;
        let json = serde_json::to_string(&without).expect("serialize");
        assert!(!json.contains("target_name"));
    }
}

#[cfg(test)]
mod tests;
