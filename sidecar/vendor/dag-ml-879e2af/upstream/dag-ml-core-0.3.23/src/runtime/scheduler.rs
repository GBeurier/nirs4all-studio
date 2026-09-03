// Auto-split from the former monolithic `runtime.rs` (pure refactor).
use super::*;

#[derive(Clone, Debug, Default)]
pub struct SequentialScheduler;

#[derive(Clone, Debug)]
pub struct ParallelScheduler {
    max_workers: usize,
}

impl ParallelScheduler {
    pub fn new(max_workers: usize) -> Result<Self> {
        if max_workers == 0 {
            return Err(DagMlError::RuntimeValidation(
                "parallel scheduler max_workers must be at least 1".to_string(),
            ));
        }
        Ok(Self { max_workers })
    }

    pub fn max_workers(&self) -> usize {
        self.max_workers
    }
}

#[derive(Clone, Debug)]
pub(crate) struct PhaseScope {
    pub(crate) phase: Phase,
    pub(crate) variant_id: Option<VariantId>,
    pub(crate) variant: Option<VariantExecutionSpec>,
    pub(crate) fold_id: Option<FoldId>,
    pub(crate) seed_root: Option<u64>,
}

#[derive(Clone, Debug)]
pub(crate) struct ReplayPredictionCacheContract {
    pub(crate) requirement: BundlePredictionRequirement,
    pub(crate) cache: BundlePredictionCacheRecord,
}

pub(crate) struct MaterializedReplayArtifacts {
    pub(crate) handles: BTreeMap<NodeId, BTreeMap<String, HandleRef>>,
    pub(crate) inputs: BTreeMap<NodeId, BTreeMap<String, ArtifactInputSpec>>,
}

fn prediction_output_ports_for_node(plan: &ExecutionPlan, node_id: &NodeId) -> Result<Vec<String>> {
    let node = plan
        .graph_plan
        .graph
        .nodes
        .iter()
        .find(|node| node.id == *node_id)
        .ok_or_else(|| {
            DagMlError::RuntimeValidation(format!(
                "node `{node_id}` is absent from the execution graph"
            ))
        })?;
    let mut ports = node
        .ports
        .outputs
        .iter()
        .filter(|port| port.kind == PortKind::Prediction)
        .map(|port| port.name.clone())
        .collect::<Vec<_>>();
    ports.sort();
    Ok(ports)
}

fn normalize_prediction_result_port(
    node_id: &NodeId,
    block_kind: &str,
    producer_port: &mut Option<String>,
    prediction_ports: &[String],
) -> Result<()> {
    if let Some(port) = producer_port.as_ref() {
        if port.trim().is_empty() {
            return Err(DagMlError::RuntimeValidation(format!(
                "node `{node_id}` emitted {block_kind} with blank producer_port"
            )));
        }
        if !prediction_ports.iter().any(|candidate| candidate == port) {
            return Err(DagMlError::RuntimeValidation(format!(
                "node `{node_id}` emitted {block_kind} for undeclared or non-prediction output port `{port}`; declared prediction ports are {:?}",
                prediction_ports
            )));
        }
        return Ok(());
    }
    match prediction_ports {
        [only] => {
            *producer_port = Some(only.clone());
            Ok(())
        }
        [] => Err(DagMlError::RuntimeValidation(format!(
            "node `{node_id}` emitted {block_kind} without producer_port but declares no prediction output port"
        ))),
        _ => Err(DagMlError::RuntimeValidation(format!(
            "node `{node_id}` emitted {block_kind} without producer_port but declares {} prediction output ports {:?}; multi-output controllers must emit producer_port explicitly",
            prediction_ports.len(),
            prediction_ports
        ))),
    }
}

pub(crate) fn normalize_result_prediction_ports(
    plan: &ExecutionPlan,
    task: &NodeTask,
    result: &mut NodeResult,
) -> Result<()> {
    if result.predictions.is_empty()
        && result.observation_predictions.is_empty()
        && result.aggregated_predictions.is_empty()
        && result.explanations.is_empty()
    {
        return Ok(());
    }
    let prediction_ports = prediction_output_ports_for_node(plan, &task.node_plan.node_id)?;
    for block in &mut result.predictions {
        normalize_prediction_result_port(
            &task.node_plan.node_id,
            "prediction block",
            &mut block.producer_port,
            &prediction_ports,
        )?;
    }
    for block in &mut result.observation_predictions {
        normalize_prediction_result_port(
            &task.node_plan.node_id,
            "observation prediction block",
            &mut block.producer_port,
            &prediction_ports,
        )?;
    }
    for block in &mut result.aggregated_predictions {
        normalize_prediction_result_port(
            &task.node_plan.node_id,
            "aggregated prediction block",
            &mut block.producer_port,
            &prediction_ports,
        )?;
    }
    for block in &mut result.explanations {
        normalize_prediction_result_port(
            &task.node_plan.node_id,
            "explanation block",
            &mut block.producer_port,
            &prediction_ports,
        )?;
    }
    Ok(())
}

/// Reject non-direct prediction outputs before the scheduler can aggregate
/// them.  A terminal external cohort must never fall back to coordinator
/// relations or a custom aggregation controller simply because a controller
/// returned observation-level output.
fn validate_direct_sample_prediction_result(task: &NodeTask, result: &NodeResult) -> Result<()> {
    if !result.observation_predictions.is_empty() {
        return Err(DagMlError::RuntimeValidation(format!(
            "direct terminal PREDICT node `{}` emitted observation-level predictions; relation aggregation is not permitted",
            task.node_plan.node_id
        )));
    }
    if !result.aggregated_predictions.is_empty() {
        return Err(DagMlError::RuntimeValidation(format!(
            "direct terminal PREDICT node `{}` emitted aggregated predictions; relation aggregation is not permitted",
            task.node_plan.node_id
        )));
    }
    Ok(())
}

#[derive(Default)]
pub(crate) struct PhaseScopeResources<'a> {
    pub(crate) data_provider: Option<&'a dyn RuntimeDataProvider>,
    /// Scheduler-owned fold universe for a nested execution scope.  It is
    /// never inferred from a fold-id string: callers retain the parent-bound
    /// `NestedFoldSet` and pass only its validated inner set here.
    pub(crate) fold_set_override: Option<&'a FoldSet>,
    /// Restrict execution to one dependency-closed subgraph.  Nested stacking
    /// uses this for its base branches before invoking the meta node; ordinary
    /// phases leave it empty and keep the full plan topology.
    pub(crate) node_filter: Option<&'a BTreeSet<NodeId>>,
    /// An inner base pass must not recursively apply the plan's ordinary
    /// `inner_cv` policy.  Nested stacking owns that one level explicitly.
    pub(crate) suppress_inner_cv: bool,
    /// Explicit inner-OOF/outer-evaluation split for the one declared nested
    /// stacking meta node.  This is scheduler-private evidence, never a graph
    /// edge or a controller-selected policy.
    pub(crate) nested_stacking: Option<NestedStackingInput<'a>>,
    pub(crate) replay_artifact_handles: Option<&'a BTreeMap<NodeId, BTreeMap<String, HandleRef>>>,
    pub(crate) replay_artifact_inputs:
        Option<&'a BTreeMap<NodeId, BTreeMap<String, ArtifactInputSpec>>>,
    pub(crate) replay_bundle_id: Option<&'a BundleId>,
    pub(crate) data_envelopes: Option<&'a BTreeMap<String, ExternalDataPlanEnvelope>>,
    pub(crate) prediction_cache_store: Option<&'a dyn RuntimePredictionCacheStore>,
    pub(crate) prediction_cache_contracts:
        Option<&'a BTreeMap<String, ReplayPredictionCacheContract>>,
    /// Terminal replay is deliberately narrower than generic PREDICT: its
    /// selected result must be emitted as a direct sample-level block.  This
    /// prevents the scheduler from reading coordinator relations or invoking
    /// a custom aggregation controller for an external V2 cohort.
    pub(crate) direct_sample_prediction_only: bool,
    pub(crate) artifact_store: Option<&'a mut InMemoryArtifactStore>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum HpoCandidateFitCvOutcome {
    Completed,
    Pruned,
}

struct HpoFoldFeedback<'a> {
    trial_id: i64,
    selection: &'a RuntimeHpoSelectionTarget,
    session: &'a mut dyn RuntimeTunerSession,
}

fn validate_hpo_progressive_fold_topology(plan: &ExecutionPlan) -> Result<()> {
    if nested_stacking_campaign_plan(plan)?.is_some() {
        return Err(DagMlError::RuntimeValidation(
            "runtime HPO progressive pruning does not support nested-stacking FIT_CV; the scheduler cannot attest one report-grade intermediate per outer fold"
                .to_string(),
        ));
    }
    let fold_set = plan.fold_set.as_ref().ok_or_else(|| {
        DagMlError::RuntimeValidation(
            "runtime HPO progressive pruning requires an explicit validated fold set".to_string(),
        )
    })?;
    if fold_set.partition_mode != FoldPartitionMode::Partition {
        return Err(DagMlError::RuntimeValidation(
            "runtime HPO progressive pruning requires FoldPartitionMode::Partition; resampled folds cannot attest one stable validation resource step per sample"
                .to_string(),
        ));
    }
    i32::try_from(fold_set.folds.len()).map_err(|_| {
        DagMlError::RuntimeValidation(
            "runtime HPO fold count exceeds the native intermediate step range".to_string(),
        )
    })?;
    Ok(())
}

impl SequentialScheduler {
    /// Run one local tuner session and evaluate every proposal through the
    /// ordinary FIT_CV scheduler.  The session remains on this thread; only a
    /// portable [`RuntimeHpoProposal`] and OOF-derived scalar feedback cross
    /// the controller boundary. SELECT and REFIT deliberately do not occur
    /// here, so callers can make exactly one selection and one refit after the
    /// returned report-grade candidate evidence has been audited.
    pub fn execute_hpo_campaign(
        &self,
        plan: &ExecutionPlan,
        controllers: &RuntimeControllerRegistry,
        data_provider: &dyn RuntimeDataProvider,
        ctx: &RunContext,
        hpo: &RuntimeHpoExecutionContext,
    ) -> Result<RuntimeHpoCampaignResult> {
        plan.validate()?;
        hpo.validate_for_plan(plan)?;
        validate_hpo_progressive_fold_topology(plan)?;
        let controller = controllers.get(&hpo.controller_id).ok_or_else(|| {
            DagMlError::RuntimeValidation(format!(
                "runtime HPO campaign controller `{}` is not registered",
                hpo.controller_id
            ))
        })?;
        let task = RuntimeHpoCampaignTask {
            run_id: ctx.run_id.clone(),
            operation_id: hpo.operation_id.clone(),
            controller_id: hpo.controller_id.clone(),
            target_node_id: hpo.target_node_id.clone(),
            seed: ctx.root_seed,
        };
        let mut session = controller.create_tuner_session(&task, hpo)?;
        let history_at_start = session.trial_history_len()?;
        if history_at_start > hpo.trial_budget_total {
            return Err(DagMlError::RuntimeValidation(format!(
                "runtime HPO restored native history ({history_at_start}) exceeds total trial budget ({})",
                hpo.trial_budget_total
            )));
        }
        let remaining_trials = hpo.trial_budget_total - history_at_start;
        let mut candidates = Vec::new();
        let mut proposed_variant_ids = BTreeSet::new();
        // Fresh proposals are checkpointed by this call.  The native study can
        // nevertheless retain an incumbent from a restored terminal trial, so
        // keep its persisted trial->variant binding separate from the new
        // checkpoint evidence and extend it as we ask new trials.
        let mut trial_variants = BTreeMap::new();
        let mut incumbent_variants = hpo.resume_variants.clone();
        let mut terminal_trials = BTreeMap::new();
        let mut completed_proposals = Vec::new();
        let mut completed_reports = Vec::new();

        for _ in 0..remaining_trials {
            let Some(proposal) = session.ask()? else {
                break;
            };
            if trial_variants
                .insert(proposal.trial_id, proposal.variant.variant_id.clone())
                .is_some()
            {
                return Err(DagMlError::RuntimeValidation(format!(
                    "runtime HPO session proposed duplicate trial `{}`",
                    proposal.trial_id
                )));
            }
            if incumbent_variants
                .insert(proposal.trial_id, proposal.variant.variant_id.clone())
                .is_some()
            {
                return Err(DagMlError::RuntimeValidation(format!(
                    "runtime HPO session reused restored trial `{}`",
                    proposal.trial_id
                )));
            }
            if !proposed_variant_ids.insert(proposal.variant.variant_id.clone()) {
                return Err(DagMlError::RuntimeValidation(format!(
                    "runtime HPO session proposed duplicate variant `{}`",
                    proposal.variant.variant_id
                )));
            }
            let mut candidate_plan = plan.clone();
            candidate_plan.variants = vec![proposal.variant.clone()];
            candidate_plan.validate()?;
            let mut candidate_ctx =
                RunContext::new(ctx.run_id.clone(), proposal.variant.seed.or(ctx.root_seed));
            candidate_ctx.variant_id = Some(proposal.variant.variant_id.clone());

            let evaluation = {
                let mut feedback = HpoFoldFeedback {
                    trial_id: proposal.trial_id,
                    selection: &hpo.selection,
                    session: session.as_mut(),
                };
                self.execute_hpo_candidate_fit_cv(
                    &candidate_plan,
                    controllers,
                    data_provider,
                    &mut candidate_ctx,
                    &mut feedback,
                )
            };
            let evaluation = match evaluation {
                Ok(evaluation) => evaluation,
                Err(error) => {
                    session.tell(
                        proposal.trial_id,
                        RuntimeHpoTerminal::Failed {
                            failure: RuntimeHpoFailure {
                                code: "DAGML_CV_ERROR".to_string(),
                                message: error.to_string(),
                                retryable: false,
                            },
                        },
                    )?;
                    terminal_trials.insert(proposal.trial_id, HpoTrialTerminalState::Failed);
                    continue;
                }
            };
            if evaluation == HpoCandidateFitCvOutcome::Pruned {
                terminal_trials.insert(proposal.trial_id, HpoTrialTerminalState::Pruned);
                continue;
            }
            if let Err(error) = candidate_ctx
                .collect_cross_fold_validation_scores(plan_oof_partition_mode(&candidate_plan))
            {
                session.tell(
                    proposal.trial_id,
                    RuntimeHpoTerminal::Failed {
                        failure: RuntimeHpoFailure {
                            code: "DAGML_SCORE_ERROR".to_string(),
                            message: error.to_string(),
                            retryable: false,
                        },
                    },
                )?;
                terminal_trials.insert(proposal.trial_id, HpoTrialTerminalState::Failed);
                continue;
            }
            let report = candidate_ctx
                .score_collector
                .iter()
                .find(|report| {
                    report.producer_node == hpo.selection.producer_node
                        && report.producer_port.as_deref()
                            == Some(hpo.selection.producer_port.as_str())
                        && report.partition == PredictionPartition::Validation
                        && report
                            .fold_id
                            .as_ref()
                            .is_some_and(|fold| fold.as_str() == "avg")
                })
                .cloned();
            let Some(mut report) = report else {
                session.tell(
                    proposal.trial_id,
                    RuntimeHpoTerminal::Failed {
                        failure: RuntimeHpoFailure {
                            code: "DAGML_SCORE_MISSING".to_string(),
                            message: format!(
                                "runtime HPO trial `{}` emitted no target OOF average",
                                proposal.trial_id
                            ),
                            retryable: false,
                        },
                    },
                )?;
                terminal_trials.insert(proposal.trial_id, HpoTrialTerminalState::Failed);
                continue;
            };
            report.variant_id = Some(proposal.variant.variant_id.clone());
            let score = report
                .metrics
                .get(hpo.selection.metric.name())
                .copied()
                .filter(|score| score.is_finite());
            let Some(score) = score else {
                session.tell(
                    proposal.trial_id,
                    RuntimeHpoTerminal::Failed {
                        failure: RuntimeHpoFailure {
                            code: "DAGML_SCORE_NONFINITE".to_string(),
                            message: format!(
                                "runtime HPO trial `{}` emitted no finite `{}` score",
                                proposal.trial_id,
                                hpo.selection.metric.name()
                            ),
                            retryable: false,
                        },
                    },
                )?;
                terminal_trials.insert(proposal.trial_id, HpoTrialTerminalState::Failed);
                continue;
            };
            session.tell(proposal.trial_id, RuntimeHpoTerminal::Completed { score })?;
            terminal_trials.insert(proposal.trial_id, HpoTrialTerminalState::Completed);
            completed_proposals.push(proposal.clone());
            completed_reports.push(RuntimeHpoCompletedReport {
                trial_id: proposal.trial_id,
                variant_id: proposal.variant.variant_id.clone(),
                report: report.clone(),
            });

            let mut validation_reports = candidate_ctx
                .score_collector
                .iter()
                .filter(|item| item.partition == PredictionPartition::Validation)
                .cloned()
                .collect::<Vec<_>>();
            for item in &mut validation_reports {
                item.variant_id = Some(proposal.variant.variant_id.clone());
            }
            candidates.push(RuntimeHpoCandidateEvaluation {
                validation_predictions: capture_variant_validation_predictions(
                    &proposal.variant.variant_id,
                    None,
                    &candidate_ctx,
                ),
                lineage: candidate_ctx.lineage.records().cloned().collect(),
                proposal,
                score,
                validation_reports,
            });
        }

        let history_at_checkpoint = session.trial_history_len()?;
        if history_at_checkpoint != hpo.trial_budget_total {
            return Err(DagMlError::RuntimeValidation(format!(
                "runtime HPO native history ended at {history_at_checkpoint}, expected total trial budget {}",
                hpo.trial_budget_total
            )));
        }

        let checkpoint = RuntimeHpoCheckpointResult {
            artifact: session.checkpoint()?,
            provenance: hpo.provenance.clone(),
            operation_id: hpo.operation_id.clone(),
            controller_id: hpo.controller_id.clone(),
            target_node_id: hpo.target_node_id.clone(),
            completed_proposals,
            completed_reports,
            trial_history_len: history_at_checkpoint,
        };
        validate_hpo_checkpoint_result(
            &checkpoint,
            hpo,
            &trial_variants,
            &terminal_trials,
            history_at_start,
        )?;
        let incumbent = session.incumbent(&incumbent_variants)?.ok_or_else(|| {
            DagMlError::RuntimeValidation(
                "native HPO campaign has no completed native incumbent after terminalization"
                    .to_string(),
            )
        })?;
        if incumbent.metric != hpo.selection.metric.name()
            || incumbent.direction != hpo.selection.direction
            || incumbent_variants.get(&incumbent.trial_id) != Some(&incumbent.variant_id)
            || !incumbent.score.is_finite()
        {
            return Err(DagMlError::RuntimeValidation(
                "native HPO incumbent is not bound to this scheduler campaign's metric, direction, trial, and variant"
                    .to_string(),
            ));
        }
        let terminal_trials = session.terminal_trial_snapshots(&incumbent_variants)?;
        if terminal_trials.len() != history_at_checkpoint as usize
            || terminal_trials
                .windows(2)
                .any(|pair| pair[0].trial.id >= pair[1].trial.id)
        {
            return Err(DagMlError::RuntimeValidation(
                "native HPO terminal ledger is not a complete strictly ordered history".to_string(),
            ));
        }
        Ok(RuntimeHpoCampaignResult {
            operation_id: hpo.operation_id.clone(),
            controller_id: hpo.controller_id.clone(),
            target_node_id: hpo.target_node_id.clone(),
            candidates,
            checkpoint,
            incumbent,
            terminal_trials,
        })
    }

    fn execute_hpo_candidate_fit_cv(
        &self,
        plan: &ExecutionPlan,
        controllers: &RuntimeControllerRegistry,
        data_provider: &dyn RuntimeDataProvider,
        ctx: &mut RunContext,
        feedback: &mut HpoFoldFeedback<'_>,
    ) -> Result<HpoCandidateFitCvOutcome> {
        let candidate_plan = plan;
        ctx.configure_global_oof_aggregation(candidate_plan, data_provider)?;
        let fold_ids = candidate_plan
            .fold_set
            .as_ref()
            .expect("progressive HPO topology was preflighted")
            .folds
            .iter()
            .map(|fold| Some(fold.fold_id.clone()))
            .collect::<Vec<_>>();
        let variant = candidate_plan
            .variants
            .first()
            .expect("candidate plan has exactly one variant");
        for (step, fold_id) in fold_ids.into_iter().enumerate() {
            let score_start = ctx.score_collector.len();
            self.execute_phase_scope(
                candidate_plan,
                controllers,
                ctx,
                PhaseScope {
                    phase: Phase::FitCv,
                    variant_id: Some(variant.variant_id.clone()),
                    variant: Some(VariantExecutionSpec::from_plan(variant)),
                    fold_id: fold_id.clone(),
                    seed_root: variant.seed.or(ctx.root_seed),
                },
                PhaseScopeResources {
                    data_provider: Some(data_provider),
                    ..Default::default()
                },
            )?;
            let fold_reports = ctx.score_collector[score_start..]
                .iter()
                .filter(|report| {
                    report.producer_node == feedback.selection.producer_node
                        && report.producer_port.as_deref()
                            == Some(feedback.selection.producer_port.as_str())
                        && report.partition == PredictionPartition::Validation
                        && report.fold_id == fold_id
                })
                .collect::<Vec<_>>();
            let [fold_report] = fold_reports.as_slice() else {
                return Err(DagMlError::RuntimeValidation(format!(
                    "runtime HPO trial `{}` must emit exactly one target validation report per fold; fold {fold_id:?} emitted {}",
                    feedback.trial_id,
                    fold_reports.len()
                )));
            };
            let score = fold_report
                .metrics
                .get(feedback.selection.metric.name())
                .copied()
                .filter(|score| score.is_finite())
                .ok_or_else(|| {
                    DagMlError::RuntimeValidation(format!(
                        "runtime HPO trial `{}` fold {fold_id:?} emitted no finite `{}` intermediate score",
                        feedback.trial_id,
                        feedback.selection.metric.name()
                    ))
                })?;
            let step = i32::try_from(step).map_err(|_| {
                DagMlError::RuntimeValidation(
                    "runtime HPO fold intermediate count exceeds i32".to_string(),
                )
            })?;
            if feedback
                .session
                .report_intermediate(RuntimeHpoIntermediate {
                    trial_id: feedback.trial_id,
                    step,
                    score,
                })?
                == RuntimeHpoIntermediateOutcome::Pruned
            {
                return Ok(HpoCandidateFitCvOutcome::Pruned);
            }
        }
        Ok(HpoCandidateFitCvOutcome::Completed)
    }

    pub fn execute_phase(
        &self,
        plan: &ExecutionPlan,
        controllers: &RuntimeControllerRegistry,
        ctx: &mut RunContext,
        phase: Phase,
    ) -> Result<Vec<NodeResult>> {
        plan.validate()?;
        let variant_id = ctx.variant_id.clone();
        let seed_root = ctx.root_seed;
        self.execute_phase_scope(
            plan,
            controllers,
            ctx,
            PhaseScope {
                phase,
                variant_id,
                variant: None,
                fold_id: None,
                seed_root,
            },
            PhaseScopeResources::default(),
        )
    }

    pub fn execute_phase_with_data_provider(
        &self,
        plan: &ExecutionPlan,
        controllers: &RuntimeControllerRegistry,
        data_provider: &dyn RuntimeDataProvider,
        ctx: &mut RunContext,
        phase: Phase,
    ) -> Result<Vec<NodeResult>> {
        plan.validate()?;
        let variant_id = ctx.variant_id.clone();
        let seed_root = ctx.root_seed;
        self.execute_phase_scope(
            plan,
            controllers,
            ctx,
            PhaseScope {
                phase,
                variant_id,
                variant: None,
                fold_id: None,
                seed_root,
            },
            PhaseScopeResources {
                data_provider: Some(data_provider),
                ..Default::default()
            },
        )
    }

    pub fn execute_campaign_phase(
        &self,
        plan: &ExecutionPlan,
        controllers: &RuntimeControllerRegistry,
        ctx: &mut RunContext,
        phase: Phase,
    ) -> Result<Vec<NodeResult>> {
        plan.validate()?;
        if phase == Phase::FitCv && nested_stacking_campaign_plan(plan)?.is_some() {
            return Err(DagMlError::RuntimeValidation(
                "nested stacking FIT_CV requires execute_campaign_phase_with_data_provider so the scheduler can materialize parent-bound inner folds"
                    .to_string(),
            ));
        }
        let mut results = Vec::new();
        let fold_ids = if phase == Phase::FitCv {
            plan.fold_set
                .as_ref()
                .map(|fold_set| {
                    fold_set
                        .folds
                        .iter()
                        .map(|fold| Some(fold.fold_id.clone()))
                        .collect::<Vec<_>>()
                })
                .unwrap_or_else(|| vec![None])
        } else {
            vec![None]
        };
        for variant in &plan.variants {
            if ctx
                .variant_id
                .as_ref()
                .is_some_and(|requested| requested != &variant.variant_id)
            {
                continue;
            }
            for fold_id in &fold_ids {
                let seed_root = variant.seed.or(ctx.root_seed);
                results.extend(self.execute_phase_scope(
                    plan,
                    controllers,
                    ctx,
                    PhaseScope {
                        phase,
                        variant_id: Some(variant.variant_id.clone()),
                        variant: Some(VariantExecutionSpec::from_plan(variant)),
                        fold_id: fold_id.clone(),
                        seed_root,
                    },
                    PhaseScopeResources::default(),
                )?);
            }
        }
        Ok(results)
    }

    pub fn execute_campaign_phase_with_data_provider(
        &self,
        plan: &ExecutionPlan,
        controllers: &RuntimeControllerRegistry,
        data_provider: &dyn RuntimeDataProvider,
        ctx: &mut RunContext,
        phase: Phase,
    ) -> Result<Vec<NodeResult>> {
        plan.validate()?;
        if phase == Phase::FitCv {
            ctx.configure_global_oof_aggregation(plan, data_provider)?;
            if let Some(nested) = nested_stacking_campaign_plan(plan)? {
                return self.execute_nested_stacking_fit_cv(
                    plan,
                    controllers,
                    data_provider,
                    ctx,
                    &nested,
                );
            }
        }
        let mut results = Vec::new();
        let fold_ids = if phase == Phase::FitCv {
            plan.fold_set
                .as_ref()
                .map(|fold_set| {
                    fold_set
                        .folds
                        .iter()
                        .map(|fold| Some(fold.fold_id.clone()))
                        .collect::<Vec<_>>()
                })
                .unwrap_or_else(|| vec![None])
        } else {
            vec![None]
        };
        for variant in &plan.variants {
            if ctx
                .variant_id
                .as_ref()
                .is_some_and(|requested| requested != &variant.variant_id)
            {
                continue;
            }
            for fold_id in &fold_ids {
                let seed_root = variant.seed.or(ctx.root_seed);
                results.extend(self.execute_phase_scope(
                    plan,
                    controllers,
                    ctx,
                    PhaseScope {
                        phase,
                        variant_id: Some(variant.variant_id.clone()),
                        variant: Some(VariantExecutionSpec::from_plan(variant)),
                        fold_id: fold_id.clone(),
                        seed_root,
                    },
                    PhaseScopeResources {
                        data_provider: Some(data_provider),
                        ..Default::default()
                    },
                )?);
            }
        }
        Ok(results)
    }

    pub fn execute_campaign_phase_with_data_provider_and_artifact_store(
        &self,
        plan: &ExecutionPlan,
        controllers: &RuntimeControllerRegistry,
        data_provider: &dyn RuntimeDataProvider,
        artifact_store: &mut InMemoryArtifactStore,
        ctx: &mut RunContext,
        phase: Phase,
    ) -> Result<Vec<NodeResult>> {
        plan.validate()?;
        if phase == Phase::FitCv {
            ctx.configure_global_oof_aggregation(plan, data_provider)?;
            if let Some(nested) = nested_stacking_campaign_plan(plan)? {
                // FIT_CV produces no refit artifacts. Keep the data-provider
                // route canonical rather than silently using an artifact store
                // that cannot participate in the inner-OOF proof.
                return self.execute_nested_stacking_fit_cv(
                    plan,
                    controllers,
                    data_provider,
                    ctx,
                    &nested,
                );
            }
        }
        let mut results = Vec::new();
        let fold_ids = if phase == Phase::FitCv {
            plan.fold_set
                .as_ref()
                .map(|fold_set| {
                    fold_set
                        .folds
                        .iter()
                        .map(|fold| Some(fold.fold_id.clone()))
                        .collect::<Vec<_>>()
                })
                .unwrap_or_else(|| vec![None])
        } else {
            vec![None]
        };
        for variant in &plan.variants {
            if ctx
                .variant_id
                .as_ref()
                .is_some_and(|requested| requested != &variant.variant_id)
            {
                continue;
            }
            for fold_id in &fold_ids {
                let seed_root = variant.seed.or(ctx.root_seed);
                results.extend(self.execute_phase_scope(
                    plan,
                    controllers,
                    ctx,
                    PhaseScope {
                        phase,
                        variant_id: Some(variant.variant_id.clone()),
                        variant: Some(VariantExecutionSpec::from_plan(variant)),
                        fold_id: fold_id.clone(),
                        seed_root,
                    },
                    PhaseScopeResources {
                        data_provider: Some(data_provider),
                        artifact_store: Some(&mut *artifact_store),
                        ..Default::default()
                    },
                )?);
            }
        }
        Ok(results)
    }

    /// Execute one explicitly declared nested-stacking FIT_CV campaign.
    ///
    /// For every outer fold, base nodes first produce their OOF predictions on
    /// the parent-bound inner folds (the only rows used to fit the meta-model),
    /// then independently produce outer-validation predictions (the only rows
    /// scored by the meta-model).  The meta invocation receives both evidence
    /// classes under separate keys; it cannot accidentally train on the outer
    /// validation rows through the generic OOF collector.
    fn execute_nested_stacking_fit_cv(
        &self,
        plan: &ExecutionPlan,
        controllers: &RuntimeControllerRegistry,
        data_provider: &dyn RuntimeDataProvider,
        ctx: &mut RunContext,
        nested: &NestedStackingCampaignPlan,
    ) -> Result<Vec<NodeResult>> {
        let parent_fold_ids = nested
            .outer_scopes
            .iter()
            .map(|outer| outer.outer_fold_id.clone())
            .collect::<BTreeSet<_>>();
        if let Some(existing) = &ctx.validation_scoring_fold_ids {
            if existing != &parent_fold_ids {
                return Err(DagMlError::RuntimeValidation(
                    "nested stacking cannot reuse a run context with a different report-grade outer fold set"
                        .to_string(),
                ));
            }
        } else {
            ctx.validation_scoring_fold_ids = Some(parent_fold_ids);
        }
        let mut results = Vec::new();
        for variant in &plan.variants {
            if ctx
                .variant_id
                .as_ref()
                .is_some_and(|requested| requested != &variant.variant_id)
            {
                continue;
            }
            let seed_root = variant.seed.or(ctx.root_seed);
            let variant_id = Some(variant.variant_id.clone());
            let variant_spec = Some(VariantExecutionSpec::from_plan(variant));
            for outer in &nested.outer_scopes {
                for inner_fold in &outer.inner.inner_fold_set.folds {
                    results.extend(self.execute_phase_scope(
                        plan,
                        controllers,
                        ctx,
                        PhaseScope {
                            phase: Phase::FitCv,
                            variant_id: variant_id.clone(),
                            variant: variant_spec.clone(),
                            fold_id: Some(inner_fold.fold_id.clone()),
                            seed_root,
                        },
                        PhaseScopeResources {
                            data_provider: Some(data_provider),
                            fold_set_override: Some(&outer.inner.inner_fold_set),
                            node_filter: Some(&nested.base_node_ids),
                            suppress_inner_cv: true,
                            ..Default::default()
                        },
                    )?);
                }

                // Materialize outer-validation base features in a distinct
                // scope.  They stay out of the unsuffixed meta inputs.
                results.extend(self.execute_phase_scope(
                    plan,
                    controllers,
                    ctx,
                    PhaseScope {
                        phase: Phase::FitCv,
                        variant_id: variant_id.clone(),
                        variant: variant_spec.clone(),
                        fold_id: Some(outer.outer_fold_id.clone()),
                        seed_root,
                    },
                    PhaseScopeResources {
                        data_provider: Some(data_provider),
                        node_filter: Some(&nested.base_node_ids),
                        suppress_inner_cv: true,
                        ..Default::default()
                    },
                )?);

                let meta_only = BTreeSet::from([nested.meta_node_id.clone()]);
                results.extend(self.execute_phase_scope(
                    plan,
                    controllers,
                    ctx,
                    PhaseScope {
                        phase: Phase::FitCv,
                        variant_id: variant_id.clone(),
                        variant: variant_spec.clone(),
                        fold_id: Some(outer.outer_fold_id.clone()),
                        seed_root,
                    },
                    PhaseScopeResources {
                        data_provider: Some(data_provider),
                        node_filter: Some(&meta_only),
                        suppress_inner_cv: true,
                        nested_stacking: Some(NestedStackingInput {
                            meta_node_id: &nested.meta_node_id,
                            inner: &outer.inner,
                        }),
                        ..Default::default()
                    },
                )?);
            }
        }
        Ok(results)
    }

    pub fn execute_bundle_replay(
        &self,
        replay: BundleReplayExecution<'_>,
        ctx: &mut RunContext,
    ) -> Result<Vec<NodeResult>> {
        self.execute_bundle_replay_with_prediction_mode(replay, ctx, false)
    }

    /// Execute a PREDICT replay whose controller output is required to be a
    /// direct sample-level block.  This is an internal terminal boundary, not
    /// a change to the generic replay contract.
    pub(crate) fn execute_direct_sample_bundle_replay(
        &self,
        replay: BundleReplayExecution<'_>,
        ctx: &mut RunContext,
    ) -> Result<Vec<NodeResult>> {
        if replay.replay_request.phase != Phase::Predict {
            return Err(DagMlError::RuntimeValidation(
                "direct sample bundle replay is valid only for PREDICT".to_string(),
            ));
        }
        self.execute_bundle_replay_with_prediction_mode(replay, ctx, true)
    }

    fn execute_bundle_replay_with_prediction_mode(
        &self,
        replay: BundleReplayExecution<'_>,
        ctx: &mut RunContext,
        direct_sample_prediction_only: bool,
    ) -> Result<Vec<NodeResult>> {
        replay.bundle.validate_against_plan(replay.plan)?;
        replay
            .replay_request
            .validate_for_bundle_with_prediction_cache_store(
                replay.bundle,
                replay.prediction_cache_store.is_some(),
            )?;
        replay
            .bundle
            .validate_replay_envelopes(replay.data_envelopes)?;
        let prediction_cache_contracts = if replay.replay_request.phase == Phase::Refit {
            Some(replay_prediction_cache_contracts(replay.bundle)?)
        } else {
            None
        };
        if replay.replay_request.phase == Phase::Refit {
            preload_replay_prediction_cache_store(
                replay.bundle,
                replay.prediction_cache_store,
                ctx,
            )?;
        }
        let replay_artifacts = materialize_replay_artifact_handles(
            replay.plan,
            replay.bundle,
            replay.replay_request,
            replay.artifact_store,
            ctx,
        )?;
        let selected_variant = replay
            .bundle
            .selected_variant_id
            .as_ref()
            .map(|selected| {
                replay
                    .plan
                    .variants
                    .iter()
                    .find(|variant| &variant.variant_id == selected)
                    .map(VariantExecutionSpec::from_plan)
                    .ok_or_else(|| {
                        DagMlError::RuntimeValidation(format!(
                            "bundle `{}` selected unknown variant `{selected}`",
                            replay.bundle.bundle_id
                        ))
                    })
            })
            .transpose()?;
        let seed_root = selected_variant
            .as_ref()
            .and_then(|variant| variant.seed)
            .or(ctx.root_seed);

        self.execute_phase_scope(
            replay.plan,
            replay.controllers,
            ctx,
            PhaseScope {
                phase: replay.replay_request.phase,
                variant_id: replay.bundle.selected_variant_id.clone(),
                variant: selected_variant,
                fold_id: None,
                seed_root,
            },
            PhaseScopeResources {
                data_provider: Some(replay.data_provider),
                replay_artifact_handles: Some(&replay_artifacts.handles),
                replay_artifact_inputs: Some(&replay_artifacts.inputs),
                replay_bundle_id: Some(&replay.bundle.bundle_id),
                data_envelopes: Some(replay.data_envelopes),
                prediction_cache_store: replay.prediction_cache_store,
                prediction_cache_contracts: prediction_cache_contracts.as_ref(),
                direct_sample_prediction_only,
                ..Default::default()
            },
        )
    }

    fn execute_phase_scope(
        &self,
        plan: &ExecutionPlan,
        controllers: &RuntimeControllerRegistry,
        ctx: &mut RunContext,
        scope: PhaseScope,
        mut resources: PhaseScopeResources<'_>,
    ) -> Result<Vec<NodeResult>> {
        let _phase_span = crate::observability::phase_span(
            ctx.run_id.as_str(),
            plan.id.as_str(),
            scope.phase.as_str(),
            scope.variant_id.as_ref().map(VariantId::as_str),
            scope.fold_id.as_ref().map(FoldId::as_str),
        )
        .entered();
        let mut results = Vec::new();
        let mut output_handles = BTreeMap::<NodeId, BTreeMap<String, HandleRef>>::new();
        let mut output_data_views =
            BTreeMap::<NodeId, BTreeMap<String, DataProviderViewSpec>>::new();
        let mut input_lineage = BTreeMap::<NodeId, LineageId>::new();

        for level in plan.node_parallel_levels_for_phase(scope.phase)? {
            for node_id in &level {
                if resources
                    .node_filter
                    .is_some_and(|allowed| !allowed.contains(node_id))
                {
                    continue;
                }
                let node_plan = plan
                    .node_plans
                    .get(node_id)
                    .expect("execution plan was validated");
                // Cross-branch merge reassembly (concat or late-fusion) is a
                // scheduler/runtime handler, not a controller call: it reads the
                // upstream branch OOF blocks from the prediction store and emits
                // one merged per-sample OOF block. Intercept it before the
                // controller path (and before the `requires_oof` edge collection,
                // which is a stacking contract the branch inputs do not satisfy).
                if let Some(reduction) = merge_reduction_mode(plan, node_plan) {
                    if let Some(mut result) =
                        reassemble_branch_merge(plan, node_plan, ctx, &scope, reduction)?
                    {
                        let task_node_plan = effective_node_plan_for_scope(node_plan, &scope)?;
                        let task = NodeTask {
                            inner_fold_set: None,
                            run_id: ctx.run_id.clone(),
                            node_plan: task_node_plan.clone(),
                            phase: scope.phase,
                            variant_id: scope.variant_id.clone(),
                            variant: scope.variant.clone(),
                            fold_id: scope.fold_id.clone(),
                            branch_path: Vec::new(),
                            input_handles: BTreeMap::new(),
                            data_views: BTreeMap::new(),
                            prediction_inputs: BTreeMap::new(),
                            artifact_inputs: BTreeMap::new(),
                            required_loss_attestations: NodeTask::required_loss_attestations_for(
                                &task_node_plan,
                                scope.phase,
                            )?,
                            fit_influence: FitInfluenceTask::default(),
                            seed: None,
                        };
                        normalize_result_prediction_ports(plan, &task, &mut result)?;
                        result.validate_for_task(&task)?;
                        for prediction in &result.predictions {
                            ctx.prediction_store.append(prediction.clone())?;
                        }
                        apply_result_scoring(
                            &result,
                            &mut ctx.score_collector,
                            &mut ctx.regression_target_records,
                        )?;
                        ctx.lineage.record(result.lineage.clone())?;
                        output_handles.insert(node_id.clone(), result.outputs.clone());
                        input_lineage.insert(node_id.clone(), result.lineage.record_id.clone());
                        results.push(result);
                    }
                    continue;
                }
                let controller = controllers.get(&node_plan.controller_id).ok_or_else(|| {
                    DagMlError::RuntimeValidation(format!(
                        "runtime controller `{}` is not registered",
                        node_plan.controller_id
                    ))
                })?;
                let collected_inputs = collect_input_handles(
                    plan,
                    node_plan,
                    &output_handles,
                    &output_data_views,
                    &resources,
                    ctx,
                    &scope,
                )?;
                if collected_inputs.skip_node {
                    continue;
                }
                let mut input_handles = collected_inputs.handles;
                let mut prediction_inputs = collected_inputs.prediction_inputs;
                if let Some(nested) = resources.nested_stacking.as_ref() {
                    replace_nested_stacking_fit_cv_inputs(
                        plan,
                        node_plan,
                        ctx,
                        &scope,
                        nested,
                        &mut input_handles,
                        &mut prediction_inputs,
                    )?;
                }
                let mut artifact_inputs = BTreeMap::new();
                if let Some(node_artifact_handles) = resources
                    .replay_artifact_handles
                    .and_then(|handles| handles.get(node_id))
                {
                    for (key, handle) in node_artifact_handles {
                        if input_handles.insert(key.clone(), handle.clone()).is_some() {
                            return Err(DagMlError::RuntimeValidation(format!(
                                "node `{node_id}` received duplicate replay artifact input `{key}`"
                            )));
                        }
                    }
                }
                if let Some(node_artifact_inputs) = resources
                    .replay_artifact_inputs
                    .and_then(|inputs| inputs.get(node_id))
                {
                    for (key, spec) in node_artifact_inputs {
                        if artifact_inputs.insert(key.clone(), spec.clone()).is_some() {
                            return Err(DagMlError::RuntimeValidation(format!(
                                "node `{node_id}` received duplicate replay artifact metadata `{key}`"
                            )));
                        }
                    }
                }
                let task_node_plan = effective_node_plan_for_scope(node_plan, &scope)?;
                let inner_fold_set = (!resources.suppress_inner_cv)
                    .then(|| {
                        inner_fold_set_for_scope(
                            &plan.campaign,
                            plan.fold_set.as_ref(),
                            node_plan,
                            &scope,
                        )
                    })
                    .transpose()?
                    .flatten();
                let fit_influence = fit_influence_task_for_node(
                    plan,
                    &task_node_plan,
                    &collected_inputs.data_views,
                )?;
                let task = NodeTask {
                    inner_fold_set,
                    run_id: ctx.run_id.clone(),
                    node_plan: task_node_plan.clone(),
                    phase: scope.phase,
                    variant_id: scope.variant_id.clone(),
                    variant: scope.variant.clone(),
                    fold_id: scope.fold_id.clone(),
                    branch_path: Vec::new(),
                    input_handles,
                    data_views: collected_inputs.data_views,
                    prediction_inputs,
                    artifact_inputs,
                    required_loss_attestations: NodeTask::required_loss_attestations_for(
                        &task_node_plan,
                        scope.phase,
                    )?,
                    fit_influence,
                    seed: derive_task_seed(
                        scope.seed_root,
                        scope.variant_id.as_ref(),
                        scope.fold_id.as_ref(),
                        &task_node_plan,
                        scope.phase,
                    ),
                };
                let _node_span = crate::observability::node_span(
                    task.run_id.as_str(),
                    plan.id.as_str(),
                    task.phase.as_str(),
                    task.node_plan.node_id.as_str(),
                    task.node_plan.controller_id.as_str(),
                )
                .entered();
                let mut result = if task.node_plan.kind == NodeKind::Tuner {
                    return Err(DagMlError::RuntimeValidation(format!(
                        "tuner node `{}` requires execute_hpo_campaign with an explicit RuntimeHpoExecutionContext",
                        task.node_plan.node_id
                    )));
                } else {
                    match resources.data_provider {
                        Some(data_provider) => {
                            controller.invoke_with_data_provider(&task, data_provider)?
                        }
                        None => controller.invoke(&task)?,
                    }
                };
                record_fit_influence_diagnostic(&task, &mut result);
                normalize_result_prediction_ports(plan, &task, &mut result)?;
                result.validate_for_task(&task)?;
                if resources.direct_sample_prediction_only {
                    validate_direct_sample_prediction_result(&task, &result)?;
                } else {
                    apply_result_prediction_aggregation(
                        plan,
                        controllers,
                        &task,
                        &mut result,
                        &resources,
                    )?;
                }
                if let Some(nested) = resources.nested_stacking.as_ref() {
                    attach_nested_stacking_input_lineage(&mut result, plan, &task, ctx, nested)?;
                } else {
                    attach_coordinator_input_lineage(
                        &mut result,
                        plan,
                        &task.node_plan.node_id,
                        &input_lineage,
                    )?;
                }
                if let Some(store) = resources.artifact_store.as_deref_mut() {
                    if scope.phase == Phase::Refit {
                        store.capture_refit_artifacts(&task, &result)?;
                    }
                }
                for prediction in &result.predictions {
                    ctx.prediction_store.append(prediction.clone())?;
                }
                for prediction in &result.aggregated_predictions {
                    ctx.aggregated_prediction_store.append(prediction.clone())?;
                }
                apply_result_scoring(
                    &result,
                    &mut ctx.score_collector,
                    &mut ctx.regression_target_records,
                )?;
                ctx.lineage.record(result.lineage.clone())?;
                let data_views = derive_output_data_views(plan, &task, &result)?;
                output_handles.insert(node_id.clone(), result.outputs.clone());
                output_data_views.insert(node_id.clone(), data_views);
                input_lineage.insert(node_id.clone(), result.lineage.record_id.clone());
                results.push(result);
            }
        }

        Ok(results)
    }
}

impl ParallelScheduler {
    pub fn execute_phase(
        &self,
        plan: &ExecutionPlan,
        controllers: &RuntimeControllerRegistry,
        ctx: &mut RunContext,
        phase: Phase,
    ) -> Result<Vec<NodeResult>> {
        plan.validate()?;
        let variant_id = ctx.variant_id.clone();
        let seed_root = ctx.root_seed;
        self.execute_phase_scope(
            plan,
            controllers,
            ctx,
            PhaseScope {
                phase,
                variant_id,
                variant: None,
                fold_id: None,
                seed_root,
            },
            PhaseScopeResources::default(),
        )
    }

    pub fn execute_phase_with_data_provider(
        &self,
        plan: &ExecutionPlan,
        controllers: &RuntimeControllerRegistry,
        data_provider: &dyn RuntimeDataProvider,
        ctx: &mut RunContext,
        phase: Phase,
    ) -> Result<Vec<NodeResult>> {
        plan.validate()?;
        let variant_id = ctx.variant_id.clone();
        let seed_root = ctx.root_seed;
        self.execute_phase_scope(
            plan,
            controllers,
            ctx,
            PhaseScope {
                phase,
                variant_id,
                variant: None,
                fold_id: None,
                seed_root,
            },
            PhaseScopeResources {
                data_provider: Some(data_provider),
                ..Default::default()
            },
        )
    }

    pub fn execute_campaign_phase(
        &self,
        plan: &ExecutionPlan,
        controllers: &RuntimeControllerRegistry,
        ctx: &mut RunContext,
        phase: Phase,
    ) -> Result<Vec<NodeResult>> {
        plan.validate()?;
        if phase == Phase::FitCv && nested_stacking_campaign_plan(plan)?.is_some() {
            return Err(DagMlError::RuntimeValidation(
                "nested stacking FIT_CV is scheduler-serial by construction; use SequentialScheduler so inner OOF evidence is retained before outer evaluation"
                    .to_string(),
            ));
        }
        let mut results = Vec::new();
        let fold_ids = if phase == Phase::FitCv {
            plan.fold_set
                .as_ref()
                .map(|fold_set| {
                    fold_set
                        .folds
                        .iter()
                        .map(|fold| Some(fold.fold_id.clone()))
                        .collect::<Vec<_>>()
                })
                .unwrap_or_else(|| vec![None])
        } else {
            vec![None]
        };
        for variant in &plan.variants {
            if ctx
                .variant_id
                .as_ref()
                .is_some_and(|requested| requested != &variant.variant_id)
            {
                continue;
            }
            for fold_id in &fold_ids {
                let seed_root = variant.seed.or(ctx.root_seed);
                results.extend(self.execute_phase_scope(
                    plan,
                    controllers,
                    ctx,
                    PhaseScope {
                        phase,
                        variant_id: Some(variant.variant_id.clone()),
                        variant: Some(VariantExecutionSpec::from_plan(variant)),
                        fold_id: fold_id.clone(),
                        seed_root,
                    },
                    PhaseScopeResources::default(),
                )?);
            }
        }
        Ok(results)
    }

    pub fn execute_campaign_phase_with_data_provider(
        &self,
        plan: &ExecutionPlan,
        controllers: &RuntimeControllerRegistry,
        data_provider: &dyn RuntimeDataProvider,
        ctx: &mut RunContext,
        phase: Phase,
    ) -> Result<Vec<NodeResult>> {
        plan.validate()?;
        if phase == Phase::FitCv {
            ctx.configure_global_oof_aggregation(plan, data_provider)?;
        }
        if phase == Phase::FitCv && nested_stacking_campaign_plan(plan)?.is_some() {
            return Err(DagMlError::RuntimeValidation(
                "nested stacking FIT_CV is scheduler-serial by construction; use SequentialScheduler so inner OOF evidence is retained before outer evaluation"
                    .to_string(),
            ));
        }
        let mut results = Vec::new();
        let fold_ids = if phase == Phase::FitCv {
            plan.fold_set
                .as_ref()
                .map(|fold_set| {
                    fold_set
                        .folds
                        .iter()
                        .map(|fold| Some(fold.fold_id.clone()))
                        .collect::<Vec<_>>()
                })
                .unwrap_or_else(|| vec![None])
        } else {
            vec![None]
        };
        for variant in &plan.variants {
            if ctx
                .variant_id
                .as_ref()
                .is_some_and(|requested| requested != &variant.variant_id)
            {
                continue;
            }
            for fold_id in &fold_ids {
                let seed_root = variant.seed.or(ctx.root_seed);
                results.extend(self.execute_phase_scope(
                    plan,
                    controllers,
                    ctx,
                    PhaseScope {
                        phase,
                        variant_id: Some(variant.variant_id.clone()),
                        variant: Some(VariantExecutionSpec::from_plan(variant)),
                        fold_id: fold_id.clone(),
                        seed_root,
                    },
                    PhaseScopeResources {
                        data_provider: Some(data_provider),
                        ..Default::default()
                    },
                )?);
            }
        }
        Ok(results)
    }

    pub fn execute_campaign_phase_with_data_provider_and_artifact_store(
        &self,
        plan: &ExecutionPlan,
        controllers: &RuntimeControllerRegistry,
        data_provider: &dyn RuntimeDataProvider,
        artifact_store: &mut InMemoryArtifactStore,
        ctx: &mut RunContext,
        phase: Phase,
    ) -> Result<Vec<NodeResult>> {
        plan.validate()?;
        if phase == Phase::FitCv && nested_stacking_campaign_plan(plan)?.is_some() {
            return Err(DagMlError::RuntimeValidation(
                "nested stacking FIT_CV is scheduler-serial by construction; use SequentialScheduler so inner OOF evidence is retained before outer evaluation"
                    .to_string(),
            ));
        }
        let mut results = Vec::new();
        let fold_ids = if phase == Phase::FitCv {
            plan.fold_set
                .as_ref()
                .map(|fold_set| {
                    fold_set
                        .folds
                        .iter()
                        .map(|fold| Some(fold.fold_id.clone()))
                        .collect::<Vec<_>>()
                })
                .unwrap_or_else(|| vec![None])
        } else {
            vec![None]
        };
        for variant in &plan.variants {
            if ctx
                .variant_id
                .as_ref()
                .is_some_and(|requested| requested != &variant.variant_id)
            {
                continue;
            }
            for fold_id in &fold_ids {
                let seed_root = variant.seed.or(ctx.root_seed);
                results.extend(self.execute_phase_scope(
                    plan,
                    controllers,
                    ctx,
                    PhaseScope {
                        phase,
                        variant_id: Some(variant.variant_id.clone()),
                        variant: Some(VariantExecutionSpec::from_plan(variant)),
                        fold_id: fold_id.clone(),
                        seed_root,
                    },
                    PhaseScopeResources {
                        data_provider: Some(data_provider),
                        artifact_store: Some(&mut *artifact_store),
                        ..Default::default()
                    },
                )?);
            }
        }
        Ok(results)
    }

    pub fn execute_bundle_replay(
        &self,
        replay: BundleReplayExecution<'_>,
        ctx: &mut RunContext,
    ) -> Result<Vec<NodeResult>> {
        replay.bundle.validate_against_plan(replay.plan)?;
        replay
            .replay_request
            .validate_for_bundle_with_prediction_cache_store(
                replay.bundle,
                replay.prediction_cache_store.is_some(),
            )?;
        replay
            .bundle
            .validate_replay_envelopes(replay.data_envelopes)?;
        let prediction_cache_contracts = if replay.replay_request.phase == Phase::Refit {
            Some(replay_prediction_cache_contracts(replay.bundle)?)
        } else {
            None
        };
        if replay.replay_request.phase == Phase::Refit {
            preload_replay_prediction_cache_store(
                replay.bundle,
                replay.prediction_cache_store,
                ctx,
            )?;
        }
        let replay_artifacts = materialize_replay_artifact_handles(
            replay.plan,
            replay.bundle,
            replay.replay_request,
            replay.artifact_store,
            ctx,
        )?;
        let selected_variant = replay
            .bundle
            .selected_variant_id
            .as_ref()
            .map(|selected| {
                replay
                    .plan
                    .variants
                    .iter()
                    .find(|variant| &variant.variant_id == selected)
                    .map(VariantExecutionSpec::from_plan)
                    .ok_or_else(|| {
                        DagMlError::RuntimeValidation(format!(
                            "bundle `{}` selected unknown variant `{selected}`",
                            replay.bundle.bundle_id
                        ))
                    })
            })
            .transpose()?;
        let seed_root = selected_variant
            .as_ref()
            .and_then(|variant| variant.seed)
            .or(ctx.root_seed);

        self.execute_phase_scope(
            replay.plan,
            replay.controllers,
            ctx,
            PhaseScope {
                phase: replay.replay_request.phase,
                variant_id: replay.bundle.selected_variant_id.clone(),
                variant: selected_variant,
                fold_id: None,
                seed_root,
            },
            PhaseScopeResources {
                data_provider: Some(replay.data_provider),
                replay_artifact_handles: Some(&replay_artifacts.handles),
                replay_artifact_inputs: Some(&replay_artifacts.inputs),
                replay_bundle_id: Some(&replay.bundle.bundle_id),
                data_envelopes: Some(replay.data_envelopes),
                prediction_cache_store: replay.prediction_cache_store,
                prediction_cache_contracts: prediction_cache_contracts.as_ref(),
                ..Default::default()
            },
        )
    }

    fn execute_phase_scope(
        &self,
        plan: &ExecutionPlan,
        controllers: &RuntimeControllerRegistry,
        ctx: &mut RunContext,
        scope: PhaseScope,
        mut resources: PhaseScopeResources<'_>,
    ) -> Result<Vec<NodeResult>> {
        // Hold the phase span on the scheduler thread, and clone it into each
        // worker so worker-thread telemetry nests under the phase (tracing spans
        // are thread-local and do not auto-propagate across `thread::scope`).
        let phase_span = crate::observability::phase_span(
            ctx.run_id.as_str(),
            plan.id.as_str(),
            scope.phase.as_str(),
            scope.variant_id.as_ref().map(VariantId::as_str),
            scope.fold_id.as_ref().map(FoldId::as_str),
        );
        let _phase_entered = phase_span.clone().entered();
        // Borrowed for the `thread::scope` below; workers join before it ends.
        let plan_id = plan.id.as_str();
        plan.validate_parallel_controller_capabilities(self.max_workers, scope.phase)?;
        let mut results = Vec::new();
        let mut output_handles = BTreeMap::<NodeId, BTreeMap<String, HandleRef>>::new();
        let mut output_data_views =
            BTreeMap::<NodeId, BTreeMap<String, DataProviderViewSpec>>::new();
        let mut input_lineage = BTreeMap::<NodeId, LineageId>::new();

        for level in plan.node_parallel_levels_for_phase(scope.phase)? {
            let mut prepared = Vec::<PreparedNodeTask>::new();
            // Cross-branch merge nodes (concat or late-fusion) are not controller
            // tasks: they read the upstream branch OOF blocks from the prediction
            // store and reassemble them on the scheduler thread (no worker), AFTER
            // this level's worker tasks have populated the store. They are in a
            // later level than their branches, so the store already holds the
            // branch OOF by the time we reassemble — see `reassemble_branch_merge`.
            let mut merge_nodes = Vec::<(NodeId, MergeReduction)>::new();
            for node_id in &level {
                let node_plan = plan
                    .node_plans
                    .get(node_id)
                    .expect("execution plan was validated");
                if let Some(reduction) = merge_reduction_mode(plan, node_plan) {
                    merge_nodes.push((node_id.clone(), reduction));
                    continue;
                }
                let collected_inputs = collect_input_handles(
                    plan,
                    node_plan,
                    &output_handles,
                    &output_data_views,
                    &resources,
                    ctx,
                    &scope,
                )?;
                if collected_inputs.skip_node {
                    continue;
                }
                let mut input_handles = collected_inputs.handles;
                let mut artifact_inputs = BTreeMap::new();
                if let Some(node_artifact_handles) = resources
                    .replay_artifact_handles
                    .and_then(|handles| handles.get(node_id))
                {
                    for (key, handle) in node_artifact_handles {
                        if input_handles.insert(key.clone(), handle.clone()).is_some() {
                            return Err(DagMlError::RuntimeValidation(format!(
                                "node `{node_id}` received duplicate replay artifact input `{key}`"
                            )));
                        }
                    }
                }
                if let Some(node_artifact_inputs) = resources
                    .replay_artifact_inputs
                    .and_then(|inputs| inputs.get(node_id))
                {
                    for (key, spec) in node_artifact_inputs {
                        if artifact_inputs.insert(key.clone(), spec.clone()).is_some() {
                            return Err(DagMlError::RuntimeValidation(format!(
                                "node `{node_id}` received duplicate replay artifact metadata `{key}`"
                            )));
                        }
                    }
                }
                let task_node_plan = effective_node_plan_for_scope(node_plan, &scope)?;
                let inner_fold_set = inner_fold_set_for_scope(
                    &plan.campaign,
                    plan.fold_set.as_ref(),
                    node_plan,
                    &scope,
                )?;
                let fit_influence = fit_influence_task_for_node(
                    plan,
                    &task_node_plan,
                    &collected_inputs.data_views,
                )?;
                prepared.push(PreparedNodeTask {
                    node_id: node_id.clone(),
                    task: NodeTask {
                        inner_fold_set,
                        run_id: ctx.run_id.clone(),
                        node_plan: task_node_plan.clone(),
                        phase: scope.phase,
                        variant_id: scope.variant_id.clone(),
                        variant: scope.variant.clone(),
                        fold_id: scope.fold_id.clone(),
                        branch_path: Vec::new(),
                        input_handles,
                        data_views: collected_inputs.data_views,
                        prediction_inputs: collected_inputs.prediction_inputs,
                        artifact_inputs,
                        required_loss_attestations: NodeTask::required_loss_attestations_for(
                            &task_node_plan,
                            scope.phase,
                        )?,
                        fit_influence,
                        seed: derive_task_seed(
                            scope.seed_root,
                            scope.variant_id.as_ref(),
                            scope.fold_id.as_ref(),
                            &task_node_plan,
                            scope.phase,
                        ),
                    },
                });
            }

            for chunk in prepared.chunks(self.max_workers) {
                let chunk_results = std::thread::scope(
                    |thread_scope| -> Result<Vec<NodeResult>> {
                        let mut handles = Vec::with_capacity(chunk.len());
                        for prepared_task in chunk {
                            let controller = controllers
                                .get(&prepared_task.task.node_plan.controller_id)
                                .ok_or_else(|| {
                                    DagMlError::RuntimeValidation(format!(
                                        "runtime controller `{}` is not registered",
                                        prepared_task.task.node_plan.controller_id
                                    ))
                                })?;
                            let worker_span = phase_span.clone();
                            handles.push(thread_scope.spawn(move || {
                                let _worker_span = worker_span.entered();
                                let _node_span = crate::observability::node_span(
                                    prepared_task.task.run_id.as_str(),
                                    plan_id,
                                    prepared_task.task.phase.as_str(),
                                    prepared_task.task.node_plan.node_id.as_str(),
                                    prepared_task.task.node_plan.controller_id.as_str(),
                                )
                                .entered();
                                let mut result =
                                    if prepared_task.task.node_plan.kind == NodeKind::Tuner {
                                        return Err(DagMlError::RuntimeValidation(format!(
                                            "tuner node `{}` requires execute_hpo_campaign with an explicit RuntimeHpoExecutionContext",
                                            prepared_task.task.node_plan.node_id
                                        )));
                                    } else {
                                        // A provider-aware controller may require a
                                        // non-Sync host provider.  Parallel native
                                        // Methods PLS is deliberately refused by its
                                        // HPO preflight; ordinary controllers keep
                                        // their opaque-handle invocation here.
                                        controller.invoke(&prepared_task.task)?
                                    };
                                record_fit_influence_diagnostic(&prepared_task.task, &mut result);
                                normalize_result_prediction_ports(
                                    plan,
                                    &prepared_task.task,
                                    &mut result,
                                )?;
                                result.validate_for_task(&prepared_task.task)?;
                                Ok(result)
                            }));
                        }
                        handles
                            .into_iter()
                            .map(|handle| {
                                handle.join().map_err(|_| {
                                    DagMlError::RuntimeValidation(
                                        "parallel scheduler worker panicked".to_string(),
                                    )
                                })?
                            })
                            .collect()
                    },
                )?;

                for (prepared_task, mut result) in chunk.iter().zip(chunk_results) {
                    apply_result_prediction_aggregation(
                        plan,
                        controllers,
                        &prepared_task.task,
                        &mut result,
                        &resources,
                    )?;
                    if let Some(nested) = resources.nested_stacking.as_ref() {
                        attach_nested_stacking_input_lineage(
                            &mut result,
                            plan,
                            &prepared_task.task,
                            ctx,
                            nested,
                        )?;
                    } else {
                        attach_coordinator_input_lineage(
                            &mut result,
                            plan,
                            &prepared_task.task.node_plan.node_id,
                            &input_lineage,
                        )?;
                    }
                    if let Some(store) = resources.artifact_store.as_deref_mut() {
                        if scope.phase == Phase::Refit {
                            store.capture_refit_artifacts(&prepared_task.task, &result)?;
                        }
                    }
                    for prediction in &result.predictions {
                        ctx.prediction_store.append(prediction.clone())?;
                    }
                    for prediction in &result.aggregated_predictions {
                        ctx.aggregated_prediction_store.append(prediction.clone())?;
                    }
                    apply_result_scoring(
                        &result,
                        &mut ctx.score_collector,
                        &mut ctx.regression_target_records,
                    )?;
                    ctx.lineage.record(result.lineage.clone())?;
                    let data_views = derive_output_data_views(plan, &prepared_task.task, &result)?;
                    output_handles.insert(prepared_task.node_id.clone(), result.outputs.clone());
                    output_data_views.insert(prepared_task.node_id.clone(), data_views);
                    input_lineage.insert(
                        prepared_task.node_id.clone(),
                        result.lineage.record_id.clone(),
                    );
                    results.push(result);
                }
            }

            // Reassemble any cross-branch merge nodes in this level now that the
            // level's worker tasks have populated the prediction store. Merge nodes
            // sit in a later level than the branches they consume, so the upstream
            // branch OOF is already present.
            for (node_id, reduction) in &merge_nodes {
                let node_plan = plan
                    .node_plans
                    .get(node_id)
                    .expect("execution plan was validated");
                if let Some(mut result) =
                    reassemble_branch_merge(plan, node_plan, ctx, &scope, *reduction)?
                {
                    let task_node_plan = effective_node_plan_for_scope(node_plan, &scope)?;
                    let task = NodeTask {
                        inner_fold_set: None,
                        run_id: ctx.run_id.clone(),
                        node_plan: task_node_plan.clone(),
                        phase: scope.phase,
                        variant_id: scope.variant_id.clone(),
                        variant: scope.variant.clone(),
                        fold_id: scope.fold_id.clone(),
                        branch_path: Vec::new(),
                        input_handles: BTreeMap::new(),
                        data_views: BTreeMap::new(),
                        prediction_inputs: BTreeMap::new(),
                        artifact_inputs: BTreeMap::new(),
                        required_loss_attestations: NodeTask::required_loss_attestations_for(
                            &task_node_plan,
                            scope.phase,
                        )?,
                        fit_influence: FitInfluenceTask::default(),
                        seed: None,
                    };
                    normalize_result_prediction_ports(plan, &task, &mut result)?;
                    result.validate_for_task(&task)?;
                    for prediction in &result.predictions {
                        ctx.prediction_store.append(prediction.clone())?;
                    }
                    apply_result_scoring(
                        &result,
                        &mut ctx.score_collector,
                        &mut ctx.regression_target_records,
                    )?;
                    ctx.lineage.record(result.lineage.clone())?;
                    output_handles.insert(node_id.clone(), result.outputs.clone());
                    input_lineage.insert(node_id.clone(), result.lineage.record_id.clone());
                    results.push(result);
                }
            }
        }

        Ok(results)
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum HpoTrialTerminalState {
    Completed,
    Pruned,
    Failed,
}

fn validate_hpo_checkpoint_result(
    checkpoint: &RuntimeHpoCheckpointResult,
    hpo: &RuntimeHpoExecutionContext,
    trial_variants: &BTreeMap<i64, VariantId>,
    terminal_trials: &BTreeMap<i64, HpoTrialTerminalState>,
    history_at_start: u32,
) -> Result<()> {
    checkpoint.artifact.validate().map_err(|error| {
        DagMlError::RuntimeValidation(format!(
            "runtime HPO checkpoint artifact is invalid: {error}"
        ))
    })?;
    if checkpoint.operation_id != hpo.operation_id
        || checkpoint.controller_id != hpo.controller_id
        || checkpoint.target_node_id != hpo.target_node_id
        || checkpoint.provenance != hpo.provenance
    {
        return Err(DagMlError::RuntimeValidation(
            "runtime HPO checkpoint provenance does not exactly match its execution context"
                .to_string(),
        ));
    }
    let proposed_count = u32::try_from(trial_variants.len()).map_err(|_| {
        DagMlError::RuntimeValidation(
            "runtime HPO scheduler proposal count does not fit u32".to_string(),
        )
    })?;
    if checkpoint.trial_history_len != hpo.trial_budget_total
        || checkpoint.trial_history_len < history_at_start
        || checkpoint.trial_history_len - history_at_start != proposed_count
    {
        return Err(DagMlError::RuntimeValidation(
            "runtime HPO checkpoint native history is inconsistent with scheduler-observed trials"
                .to_string(),
        ));
    }
    if checkpoint.artifact.binding.controller_id != hpo.controller_id.as_str()
        || checkpoint.artifact.binding.controller_id != hpo.study.controller_id
        || checkpoint.artifact.binding.study_id != hpo.study.study_id
        || checkpoint.artifact.methods_abi != hpo.study.methods_abi
    {
        return Err(DagMlError::RuntimeValidation(
            "runtime HPO checkpoint binding/controller/study does not match the active tuner"
                .to_string(),
        ));
    }
    let expected_search_space = hpo.study.search_space.fingerprint().map_err(|error| {
        DagMlError::RuntimeValidation(format!(
            "runtime HPO cannot fingerprint the configured search space: {error}"
        ))
    })?;
    if checkpoint.artifact.binding.search_space_fingerprint != expected_search_space {
        return Err(DagMlError::RuntimeValidation(
            "runtime HPO checkpoint search-space binding does not match the active study"
                .to_string(),
        ));
    }

    let completed_trial_ids = terminal_trials
        .iter()
        .filter_map(|(trial_id, state)| {
            (*state == HpoTrialTerminalState::Completed).then_some(*trial_id)
        })
        .collect::<BTreeSet<_>>();
    let mut proposal_trial_ids = BTreeSet::new();
    for proposal in &checkpoint.completed_proposals {
        if !proposal_trial_ids.insert(proposal.trial_id) {
            return Err(DagMlError::RuntimeValidation(format!(
                "runtime HPO checkpoint has duplicate completed proposal for trial `{}`",
                proposal.trial_id
            )));
        }
        if trial_variants.get(&proposal.trial_id) != Some(&proposal.variant.variant_id) {
            return Err(DagMlError::RuntimeValidation(format!(
                "runtime HPO checkpoint proposal for trial `{}` does not exactly match its scheduler proposal",
                proposal.trial_id
            )));
        }
    }
    if proposal_trial_ids != completed_trial_ids {
        return Err(DagMlError::RuntimeValidation(
            "runtime HPO checkpoint proposals must cover exactly the completed trials".to_string(),
        ));
    }

    let mut report_trial_ids = BTreeSet::new();
    for completed in &checkpoint.completed_reports {
        if !report_trial_ids.insert(completed.trial_id) {
            return Err(DagMlError::RuntimeValidation(format!(
                "runtime HPO checkpoint has duplicate completed report for trial `{}`",
                completed.trial_id
            )));
        }
        if trial_variants.get(&completed.trial_id) != Some(&completed.variant_id)
            || !proposal_trial_ids.contains(&completed.trial_id)
        {
            return Err(DagMlError::RuntimeValidation(format!(
                "runtime HPO checkpoint report for trial `{}` does not match a completed proposal",
                completed.trial_id
            )));
        }
        let report = &completed.report;
        if report.producer_node != hpo.selection.producer_node
            || report.producer_port.as_deref() != Some(hpo.selection.producer_port.as_str())
            || report.partition != PredictionPartition::Validation
            || report
                .fold_id
                .as_ref()
                .is_none_or(|fold| fold.as_str() != "avg")
            || report.variant_id.as_ref() != Some(&completed.variant_id)
            || !report
                .metrics
                .get(hpo.selection.metric.name())
                .is_some_and(|score| score.is_finite())
        {
            return Err(DagMlError::RuntimeValidation(format!(
                "runtime HPO checkpoint report for trial `{}` is not its one finite target OOF average",
                completed.trial_id
            )));
        }
    }
    if report_trial_ids != completed_trial_ids {
        return Err(DagMlError::RuntimeValidation(
            "runtime HPO checkpoint reports must cover exactly one OOF average per completed trial"
                .to_string(),
        ));
    }
    Ok(())
}

pub(crate) struct PreparedNodeTask {
    pub(crate) node_id: NodeId,
    pub(crate) task: NodeTask,
}

// This module stays adjacent to the scheduler-owned task preparation it
// exercises; the remaining helpers below are shared by both schedulers.
#[cfg(test)]
#[allow(clippy::items_after_test_module)]
mod hpo_scheduler_tests {
    use std::collections::{BTreeMap, BTreeSet};
    use std::sync::{Arc, Mutex};

    use sha2::{Digest, Sha256};

    use super::*;
    use crate::controller::{
        ArtifactPolicy, ControllerCapability, ControllerFitScope, ControllerManifest,
        ControllerRegistry, RngPolicy,
    };
    use crate::data::InMemoryDataProvider;
    use crate::fold::{FoldAssignment, FoldPartitionMode, KFoldSpec, NestedCvSpec};
    use crate::graph::{
        EdgeContract, EdgeSpec, GraphInterface, GraphSpec, NodeSpec, PortRef, PortSchema, PortSpec,
    };
    use crate::hpo::{
        HpoDirection, HpoMetric, HpoOptimizerConfig, HpoParameter, HpoPruner, HpoSampler,
        HpoSearchSpace, HpoStudyBinding, MethodsHpoStudyConfig, N4moptCheckpointArtifact,
        N4MOPT_ARTIFACT_KIND, N4MOPT_CHECKPOINT_SCHEMA_VERSION, N4MOPT_FORMAT,
    };
    #[cfg(feature = "methods-optimizer-local")]
    use crate::hpo::{MethodsHpoController, MethodsRuntime};
    use crate::metrics::RegressionTargetBlock;
    use crate::oof::PredictionBlock;
    use crate::plan::{build_execution_plan, SplitInvocation};

    struct HpoTestModel {
        id: ControllerId,
        trace: Arc<Mutex<Vec<String>>>,
        fail_variant: Option<VariantId>,
        score_by_trial: bool,
    }

    impl RuntimeController for HpoTestModel {
        fn controller_id(&self) -> &ControllerId {
            &self.id
        }

        fn invoke(&self, task: &NodeTask) -> Result<NodeResult> {
            self.trace.lock().unwrap().push("model_cv".to_string());
            if task.variant_id.as_ref() == self.fail_variant.as_ref() {
                return Err(DagMlError::RuntimeValidation(
                    "controlled HPO fold failure".to_string(),
                ));
            }
            let sample_id = match task.fold_id.as_ref().map(FoldId::as_str) {
                Some("fold:0") => SampleId::new("sample:one").unwrap(),
                Some("fold:1") => SampleId::new("sample:two").unwrap(),
                other => {
                    return Err(DagMlError::RuntimeValidation(format!(
                        "HPO test model received unexpected fold {other:?}"
                    )));
                }
            };
            let prediction = if self.score_by_trial {
                let trial_id = task
                    .variant_id
                    .as_ref()
                    .and_then(|variant| variant.as_str().strip_prefix("hpo:trial:"))
                    .and_then(|value| value.parse::<i64>().ok())
                    .ok_or_else(|| {
                        DagMlError::RuntimeValidation(
                            "native HPO test model received no trial variant".to_string(),
                        )
                    })?;
                let magnitude = (trial_id + 1) as f64;
                1.0 + magnitude * magnitude
            } else {
                1.0
            };
            Ok(NodeResult {
                schema_version: None,
                node_id: task.node_plan.node_id.clone(),
                outputs: BTreeMap::from([(
                    "prediction".to_string(),
                    HandleRef {
                        handle: 2,
                        kind: HandleKind::Prediction,
                        owner_controller: self.id.clone(),
                    },
                )]),
                predictions: vec![PredictionBlock {
                    prediction_id: Some(format!("prediction:{}", task.fold_id.as_ref().unwrap())),
                    producer_node: task.node_plan.node_id.clone(),
                    producer_port: None,
                    partition: PredictionPartition::Validation,
                    fold_id: task.fold_id.clone(),
                    sample_ids: vec![sample_id.clone()],
                    values: vec![vec![prediction]],
                    target_names: vec!["target".to_string()],
                }],
                observation_predictions: Vec::new(),
                aggregated_predictions: Vec::new(),
                explanations: Vec::new(),
                shape_deltas: Vec::new(),
                artifacts: Vec::new(),
                artifact_handles: BTreeMap::new(),
                fit_influence_diagnostics: Vec::new(),
                regression_targets: vec![RegressionTargetBlock {
                    level: PredictionLevel::Sample,
                    unit_ids: vec![PredictionUnitId::Sample(sample_id)],
                    values: vec![vec![1.0]],
                    target_names: vec!["target".to_string()],
                }],
                lineage: LineageRecord {
                    record_id: LineageId::new(format!(
                        "lineage:hpo-model:{}",
                        task.fold_id.as_ref().unwrap()
                    ))
                    .unwrap(),
                    run_id: task.run_id.clone(),
                    node_id: task.node_plan.node_id.clone(),
                    phase: task.phase,
                    controller_id: self.id.clone(),
                    controller_version: task.node_plan.controller_version.clone(),
                    variant_id: task.variant_id.clone(),
                    fold_id: task.fold_id.clone(),
                    branch_path: Vec::new(),
                    input_lineage: Vec::new(),
                    artifact_refs: Vec::new(),
                    params_fingerprint: task.node_plan.params_fingerprint.clone(),
                    data_model_shape_fingerprint: None,
                    aggregation_policy_fingerprint: None,
                    seed: task.seed,
                    unsafe_flags: BTreeSet::new(),
                    metrics: BTreeMap::new(),
                    loss_attestations: Vec::new(),
                    early_stopping_records: Vec::new(),
                },
            })
        }
    }

    struct HpoTestTuner {
        id: ControllerId,
        trace: Arc<Mutex<Vec<String>>>,
        history_len: u32,
        proposal_count: u32,
        prune_at: Option<(i64, i32)>,
    }

    struct HpoTestSession {
        proposals: Vec<RuntimeHpoProposal>,
        trace: Arc<Mutex<Vec<String>>>,
        checkpoint: N4moptCheckpointArtifact,
        history_len: u32,
        completed: BTreeMap<i64, f64>,
        failed: BTreeMap<i64, RuntimeHpoFailure>,
        prune_at: Option<(i64, i32)>,
        pruned: BTreeSet<i64>,
        intermediates: BTreeMap<i64, Vec<crate::hpo::HpoIntermediate>>,
    }

    impl RuntimeController for HpoTestTuner {
        fn controller_id(&self) -> &ControllerId {
            &self.id
        }

        fn invoke(&self, task: &NodeTask) -> Result<NodeResult> {
            Err(DagMlError::RuntimeValidation(format!(
                "HPO test tuner `{}` was dispatched through generic invoke",
                task.node_plan.node_id
            )))
        }

        fn create_tuner_session(
            &self,
            task: &RuntimeHpoCampaignTask,
            context: &RuntimeHpoExecutionContext,
        ) -> Result<Box<dyn RuntimeTunerSession>> {
            assert_eq!(task.operation_id, context.operation_id);
            self.trace
                .lock()
                .unwrap()
                .push("session_factory".to_string());
            let payload = vec![7_u8];
            let proposals = (0..self.proposal_count)
                .map(|offset| {
                    let trial_id = i64::from(self.history_len + offset + 1);
                    let mut variant = context.base_variant.clone();
                    if self.history_len != 0 || self.proposal_count != 1 {
                        variant.variant_id = VariantId::new(format!("hpo:trial:{trial_id}"))
                            .map_err(|error| DagMlError::RuntimeValidation(error.to_string()))?;
                        variant.fingerprint = format!("hpo-test-{trial_id}");
                    }
                    Ok(RuntimeHpoProposal { trial_id, variant })
                })
                .collect::<Result<Vec<_>>>()?;
            Ok(Box::new(HpoTestSession {
                proposals: proposals.into_iter().rev().collect(),
                trace: Arc::clone(&self.trace),
                history_len: self.history_len,
                completed: BTreeMap::new(),
                failed: BTreeMap::new(),
                prune_at: self.prune_at,
                pruned: BTreeSet::new(),
                intermediates: BTreeMap::new(),
                checkpoint: N4moptCheckpointArtifact {
                    schema_version: N4MOPT_CHECKPOINT_SCHEMA_VERSION,
                    artifact_kind: N4MOPT_ARTIFACT_KIND.to_string(),
                    format: N4MOPT_FORMAT.to_string(),
                    abi_major: crate::hpo::METHODS_ABI_MAJOR,
                    abi_min_minor: crate::hpo::METHODS_N4MOPT_MIN_ABI_MINOR,
                    binding: HpoStudyBinding {
                        controller_id: context.study.controller_id.clone(),
                        study_id: context.study.study_id.clone(),
                        search_space_fingerprint: context
                            .study
                            .search_space
                            .fingerprint()
                            .map_err(|error| DagMlError::RuntimeValidation(error.to_string()))?,
                        optimizer_fingerprint: "optimizer:test".to_string(),
                    },
                    methods_abi: context.study.methods_abi.clone(),
                    payload_sha256: format!("{:x}", Sha256::digest(&payload)),
                    opaque_payload: payload,
                },
            }))
        }
    }

    impl RuntimeTunerSession for HpoTestSession {
        fn trial_history_len(&self) -> Result<u32> {
            Ok(self.history_len)
        }

        fn ask(&mut self) -> Result<Option<RuntimeHpoProposal>> {
            self.trace.lock().unwrap().push("ask".to_string());
            let proposal = self.proposals.pop();
            if proposal.is_some() {
                self.history_len += 1;
            }
            Ok(proposal)
        }

        fn report_intermediate(
            &mut self,
            intermediate: RuntimeHpoIntermediate,
        ) -> Result<RuntimeHpoIntermediateOutcome> {
            assert!(intermediate.score.is_finite());
            let should_prune = self.prune_at == Some((intermediate.trial_id, intermediate.step));
            self.trace.lock().unwrap().push(format!(
                "intermediate:{}:{}",
                intermediate.trial_id, intermediate.step
            ));
            self.intermediates
                .entry(intermediate.trial_id)
                .or_default()
                .push(crate::hpo::HpoIntermediate {
                    sequence: i64::from(intermediate.step) + 1,
                    step: intermediate.step,
                    score: intermediate.score,
                    should_prune,
                });
            if should_prune {
                self.pruned.insert(intermediate.trial_id);
                Ok(RuntimeHpoIntermediateOutcome::Pruned)
            } else {
                Ok(RuntimeHpoIntermediateOutcome::Continue)
            }
        }

        fn tell(&mut self, trial_id: i64, terminal: RuntimeHpoTerminal) -> Result<()> {
            assert!(trial_id > 0);
            match terminal {
                RuntimeHpoTerminal::Completed { score } if score.is_finite() => {
                    self.trace.lock().unwrap().push("tell".to_string());
                    self.completed.insert(trial_id, score);
                }
                RuntimeHpoTerminal::Failed { failure } => {
                    self.trace.lock().unwrap().push("tell_failed".to_string());
                    self.failed.insert(trial_id, failure);
                }
                other => {
                    return Err(DagMlError::RuntimeValidation(format!(
                        "test HPO session received unsupported terminal state {other:?}"
                    )));
                }
            }
            Ok(())
        }

        fn checkpoint(&self) -> Result<N4moptCheckpointArtifact> {
            self.trace.lock().unwrap().push("checkpoint".to_string());
            Ok(self.checkpoint.clone())
        }

        fn incumbent(
            &self,
            variants: &BTreeMap<i64, VariantId>,
        ) -> Result<Option<RuntimeHpoIncumbent>> {
            let Some((&trial_id, &score)) = self
                .completed
                .iter()
                .min_by(|left, right| left.1.total_cmp(right.1).then_with(|| left.0.cmp(right.0)))
            else {
                return Ok(None);
            };
            Ok(Some(RuntimeHpoIncumbent {
                trial_id,
                score,
                metric: "rmse".to_string(),
                direction: HpoDirection::Minimize,
                variant_id: variants.get(&trial_id).cloned().unwrap(),
            }))
        }

        fn terminal_trial_snapshots(
            &self,
            variants: &BTreeMap<i64, VariantId>,
        ) -> Result<Vec<RuntimeHpoTerminalSnapshot>> {
            if self.completed.is_empty() {
                return Err(DagMlError::RuntimeValidation(
                    "test HPO session has no completed trial".to_string(),
                ));
            }
            let completed = &self.completed;
            let failed = &self.failed;
            Ok((1..=i64::from(self.history_len))
                .map(|id| {
                    let score = completed.get(&id).copied();
                    let is_completed = score.is_some();
                    let pruned = self.pruned.contains(&id);
                    let failure = failed
                        .get(&id)
                        .map(|failure| crate::hpo::HpoFailure {
                            code: failure.code.clone(),
                            message: failure.message.clone(),
                            retryable: failure.retryable,
                        })
                        .or_else(|| {
                            (!is_completed && !pruned).then(|| crate::hpo::HpoFailure {
                                code: "RESTORED_TEST_FAILURE".to_string(),
                                message: "synthetic restored terminal".to_string(),
                                retryable: false,
                            })
                        });
                    RuntimeHpoTerminalSnapshot {
                        trial: crate::hpo::HpoTrial {
                            id,
                            ask_sequence: id,
                            terminal_sequence: Some(id),
                            parameters: BTreeMap::new(),
                            parameter_order: Vec::new(),
                            status: if is_completed {
                                crate::hpo::HpoTrialStatus::Completed
                            } else if pruned {
                                crate::hpo::HpoTrialStatus::Pruned
                            } else {
                                crate::hpo::HpoTrialStatus::Failed
                            },
                            score,
                            rung: 0,
                            duration: 0.0,
                            intermediates: self.intermediates.get(&id).cloned().unwrap_or_default(),
                            failure,
                        },
                        variant_id: variants.get(&id).cloned(),
                    }
                })
                .collect())
        }
    }

    fn node(id: &str, kind: NodeKind, outputs: Vec<PortSpec>) -> NodeSpec {
        NodeSpec {
            id: NodeId::new(id).unwrap(),
            kind,
            operator: None,
            params: BTreeMap::new(),
            ports: PortSchema {
                inputs: Vec::new(),
                outputs,
            },
            metadata: BTreeMap::new(),
            seed_label: None,
        }
    }

    fn prediction_port(name: &str) -> PortSpec {
        PortSpec {
            name: name.to_string(),
            kind: PortKind::Prediction,
            representation: None,
            cardinality: crate::graph::PortCardinality::One,
            unit_level: None,
            alignment_key: None,
            target_level: None,
            description: String::new(),
        }
    }

    fn manifest(id: &str, kind: NodeKind) -> ControllerManifest {
        ControllerManifest {
            controller_id: ControllerId::new(id).unwrap(),
            controller_version: "test".to_string(),
            operator_kind: kind,
            priority: 0,
            supported_phases: BTreeSet::from([Phase::FitCv]),
            input_ports: Vec::new(),
            output_ports: Vec::new(),
            data_requirements: None,
            capabilities: BTreeSet::from([
                ControllerCapability::Deterministic,
                ControllerCapability::EmitsPredictions,
            ]),
            operator_selectors: Vec::new(),
            fit_scope: ControllerFitScope::FoldTrain,
            rng_policy: RngPolicy::UsesCoreSeed,
            artifact_policy: ArtifactPolicy::Serializable,
        }
    }

    #[test]
    fn hpo_campaign_invokes_registered_session_and_routes_oof_feedback() {
        let target = NodeId::new("model:score").unwrap();
        let graph = GraphSpec {
            id: "graph:hpo.scheduler".to_string(),
            interface: GraphInterface::default(),
            nodes: vec![node(
                "model:score",
                NodeKind::Model,
                vec![PortSpec {
                    name: "prediction".to_string(),
                    kind: PortKind::Prediction,
                    representation: None,
                    cardinality: crate::graph::PortCardinality::One,
                    unit_level: None,
                    alignment_key: None,
                    target_level: None,
                    description: String::new(),
                }],
            )],
            edges: Vec::new(),
            search_space_fingerprint: None,
            metadata: BTreeMap::new(),
        };
        let fold_set = FoldSet {
            id: "folds:hpo".to_string(),
            sample_ids: vec![
                SampleId::new("sample:one").unwrap(),
                SampleId::new("sample:two").unwrap(),
            ],
            folds: vec![
                FoldAssignment {
                    fold_id: FoldId::new("fold:0").unwrap(),
                    train_sample_ids: vec![SampleId::new("sample:two").unwrap()],
                    validation_sample_ids: vec![SampleId::new("sample:one").unwrap()],
                    metadata: BTreeMap::new(),
                },
                FoldAssignment {
                    fold_id: FoldId::new("fold:1").unwrap(),
                    train_sample_ids: vec![SampleId::new("sample:one").unwrap()],
                    validation_sample_ids: vec![SampleId::new("sample:two").unwrap()],
                    metadata: BTreeMap::new(),
                },
            ],
            sample_groups: BTreeMap::new(),
            partition_mode: FoldPartitionMode::Partition,
        };
        let mut registry = ControllerRegistry::new();
        registry
            .register(manifest("controller:model", NodeKind::Model))
            .unwrap();
        let plan = build_execution_plan(
            "plan:hpo.scheduler",
            graph,
            CampaignSpec {
                inner_cv: None,
                id: "campaign:hpo.scheduler".to_string(),
                root_seed: Some(13),
                leakage_policy: Default::default(),
                aggregation_policy: Default::default(),
                split_invocation: Some(SplitInvocation {
                    id: "split:hpo".to_string(),
                    controller_id: None,
                    leakage_policy: Default::default(),
                    params: BTreeMap::new(),
                    fold_set: Some(fold_set),
                }),
                generation: Default::default(),
                shape_plans: BTreeMap::new(),
                data_bindings: BTreeMap::new(),
                branch_view_plans: Vec::new(),
                metadata: BTreeMap::new(),
            },
            &registry,
        )
        .unwrap();
        let trace = Arc::new(Mutex::new(Vec::new()));
        let mut controllers = RuntimeControllerRegistry::new();
        controllers
            .register(Box::new(HpoTestTuner {
                id: ControllerId::new("controller:tuner").unwrap(),
                trace: Arc::clone(&trace),
                history_len: 0,
                proposal_count: 1,
                prune_at: None,
            }))
            .unwrap();
        controllers
            .register(Box::new(HpoTestModel {
                id: ControllerId::new("controller:model").unwrap(),
                trace: Arc::clone(&trace),
                fail_variant: None,
                score_by_trial: false,
            }))
            .unwrap();
        let hpo = RuntimeHpoExecutionContext {
            operation_id: "hpo:test".to_string(),
            controller_id: ControllerId::new("controller:tuner").unwrap(),
            target_node_id: target.clone(),
            base_variant: plan.variants[0].clone(),
            trial_budget_total: 1,
            study: MethodsHpoStudyConfig {
                controller_id: "controller:tuner".to_string(),
                study_id: "study:hpo.scheduler".to_string(),
                methods_abi: "test-abi".to_string(),
                search_space: HpoSearchSpace {
                    parameters: vec![HpoParameter::Int {
                        name: "n_components".to_string(),
                        low: 1,
                        high: 1,
                        step: 1,
                        log: false,
                    }],
                },
                optimizer: HpoOptimizerConfig {
                    sampler: HpoSampler::Random,
                    pruner: HpoPruner::None,
                    direction: HpoDirection::Minimize,
                    metric: HpoMetric::Rmse,
                    seed: 13,
                    n_startup_trials: 1,
                    max_resource: 0,
                    reduction_factor: 1,
                },
            },
            parameter_paths: BTreeMap::from([(
                "n_components".to_string(),
                "n_components".to_string(),
            )]),
            resume_checkpoint: None,
            resume_variants: BTreeMap::new(),
            resume_terminal_trials: Vec::new(),
            selection: RuntimeHpoSelectionTarget {
                producer_node: target,
                producer_port: "prediction".to_string(),
                metric: RegressionMetricKind::Rmse,
                direction: HpoDirection::Minimize,
            },
            provenance: RuntimeHpoProvenance {
                graph_fingerprint: plan.graph_fingerprint.clone(),
                campaign_fingerprint: plan.campaign_fingerprint.clone(),
                controller_fingerprint: plan.controller_fingerprint.clone(),
                data_identities_fingerprint: "identity:test".to_string(),
                fold_set_fingerprint: plan
                    .fold_set
                    .as_ref()
                    .map(stable_json_fingerprint)
                    .transpose()
                    .unwrap(),
                training_influence_fingerprint: "influence:test".to_string(),
                relation_fingerprint: "relation:test".to_string(),
            },
        };
        let provider = InMemoryDataProvider::new(ControllerId::new("controller:data").unwrap());
        let ctx = RunContext::new(RunId::new("run:hpo.scheduler").unwrap(), Some(13));

        let result = SequentialScheduler
            .execute_hpo_campaign(&plan, &controllers, &provider, &ctx, &hpo)
            .unwrap();

        assert_eq!(result.operation_id, "hpo:test");
        assert_eq!(result.candidates.len(), 1);
        assert_eq!(result.checkpoint.completed_proposals.len(), 1);
        assert_eq!(result.checkpoint.completed_reports.len(), 1);
        assert_eq!(result.candidates[0].lineage.len(), 2);
        assert_eq!(result.incumbent.variant_id, plan.variants[0].variant_id);
        let mut selected_ctx = RunContext::new(RunId::new("run:hpo.scheduler").unwrap(), Some(13));
        selected_ctx.variant_id = Some(plan.variants[0].variant_id.clone());
        let selected_results = SequentialScheduler
            .execute_campaign_phase_with_data_provider(
                &plan,
                &controllers,
                &provider,
                &mut selected_ctx,
                Phase::FitCv,
            )
            .unwrap();
        assert_eq!(selected_results.len(), 2);
        assert_eq!(selected_ctx.lineage.len(), 2);
        assert_eq!(
            trace.lock().unwrap().as_slice(),
            [
                "session_factory",
                "ask",
                "model_cv",
                "intermediate:1:0",
                "model_cv",
                "intermediate:1:1",
                "tell",
                "checkpoint",
                "model_cv",
                "model_cv"
            ]
        );

        // A native prune decision after the first validation fold must stop
        // the candidate before the second fold is materialized.  The prior
        // completed trial remains the native incumbent and the pruned trial
        // never enters report-grade candidate evidence.
        let prune_trace = Arc::new(Mutex::new(Vec::new()));
        let mut prune_controllers = RuntimeControllerRegistry::new();
        prune_controllers
            .register(Box::new(HpoTestTuner {
                id: ControllerId::new("controller:tuner").unwrap(),
                trace: Arc::clone(&prune_trace),
                history_len: 0,
                proposal_count: 2,
                prune_at: Some((2, 0)),
            }))
            .unwrap();
        prune_controllers
            .register(Box::new(HpoTestModel {
                id: ControllerId::new("controller:model").unwrap(),
                trace: Arc::clone(&prune_trace),
                fail_variant: None,
                score_by_trial: false,
            }))
            .unwrap();
        let mut pruning_hpo = hpo.clone();
        pruning_hpo.trial_budget_total = 2;
        let pruned = SequentialScheduler
            .execute_hpo_campaign(
                &plan,
                &prune_controllers,
                &provider,
                &RunContext::new(RunId::new("run:hpo.pruned").unwrap(), Some(13)),
                &pruning_hpo,
            )
            .unwrap();
        assert_eq!(pruned.candidates.len(), 1);
        assert_eq!(pruned.checkpoint.completed_proposals.len(), 1);
        assert_eq!(pruned.checkpoint.completed_reports.len(), 1);
        assert_eq!(pruned.incumbent.trial_id, 1);
        assert_eq!(
            pruned
                .terminal_trials
                .iter()
                .map(|entry| (entry.trial.id, entry.trial.status))
                .collect::<Vec<_>>(),
            vec![
                (1, crate::hpo::HpoTrialStatus::Completed),
                (2, crate::hpo::HpoTrialStatus::Pruned),
            ]
        );
        assert_eq!(
            prune_trace
                .lock()
                .unwrap()
                .iter()
                .filter(|event| event.as_str() == "model_cv")
                .count(),
            3,
            "the pruned second trial must execute one fold, not both"
        );

        // A controller/data failure after ask is terminalized as FAILED in
        // the native session.  It contributes neither candidate evidence nor
        // completed checkpoint entries, and no later fold/opaque output
        // handle from that variant can be scheduled.
        let failed_trace = Arc::new(Mutex::new(Vec::new()));
        let mut failed_controllers = RuntimeControllerRegistry::new();
        failed_controllers
            .register(Box::new(HpoTestTuner {
                id: ControllerId::new("controller:tuner").unwrap(),
                trace: Arc::clone(&failed_trace),
                history_len: 0,
                proposal_count: 2,
                prune_at: None,
            }))
            .unwrap();
        failed_controllers
            .register(Box::new(HpoTestModel {
                id: ControllerId::new("controller:model").unwrap(),
                trace: Arc::clone(&failed_trace),
                fail_variant: Some(VariantId::new("hpo:trial:2").unwrap()),
                score_by_trial: false,
            }))
            .unwrap();
        let failed = SequentialScheduler
            .execute_hpo_campaign(
                &plan,
                &failed_controllers,
                &provider,
                &RunContext::new(RunId::new("run:hpo.failed").unwrap(), Some(13)),
                &pruning_hpo,
            )
            .unwrap();
        assert_eq!(failed.candidates.len(), 1);
        assert_eq!(
            failed.candidates[0]
                .validation_predictions
                .predictions
                .len(),
            2
        );
        assert_eq!(failed.checkpoint.completed_proposals.len(), 1);
        assert_eq!(failed.checkpoint.completed_reports.len(), 1);
        assert_eq!(
            failed
                .terminal_trials
                .iter()
                .map(|entry| (entry.trial.id, entry.trial.status))
                .collect::<Vec<_>>(),
            vec![
                (1, crate::hpo::HpoTrialStatus::Completed),
                (2, crate::hpo::HpoTrialStatus::Failed),
            ]
        );
        let failed_trial = &failed.terminal_trials[1].trial;
        assert_eq!(
            failed_trial.failure.as_ref().unwrap().code,
            "DAGML_CV_ERROR"
        );
        assert!(failed_trial.intermediates.is_empty());
        assert_eq!(
            failed_trace
                .lock()
                .unwrap()
                .iter()
                .filter(|event| event.as_str() == "model_cv")
                .count(),
            3,
            "the failed second trial must not schedule another fold or output handle"
        );
        assert!(failed_trace
            .lock()
            .unwrap()
            .iter()
            .any(|event| event == "tell_failed"));

        // A resampled fold set has no stable resource meaning across steps:
        // refuse it before the session factory, model or intermediate path.
        let mut resampled_plan = plan.clone();
        resampled_plan.fold_set.as_mut().unwrap().partition_mode = FoldPartitionMode::Resampled;
        let mut resampled_hpo = hpo.clone();
        resampled_hpo.provenance.fold_set_fingerprint =
            Some(stable_json_fingerprint(resampled_plan.fold_set.as_ref().unwrap()).unwrap());
        let trace_len_before = trace.lock().unwrap().len();
        let error = SequentialScheduler
            .execute_hpo_campaign(
                &resampled_plan,
                &controllers,
                &provider,
                &ctx,
                &resampled_hpo,
            )
            .unwrap_err();
        assert!(error
            .to_string()
            .contains("requires FoldPartitionMode::Partition"));
        assert_eq!(trace.lock().unwrap().len(), trace_len_before);

        // An empty fold topology is rejected by plan validation even earlier,
        // with the same zero-session/zero-model/zero-intermediate guarantee.
        let mut empty_plan = plan.clone();
        empty_plan.fold_set.as_mut().unwrap().folds.clear();
        let trace_len_before = trace.lock().unwrap().len();
        let error = SequentialScheduler
            .execute_hpo_campaign(&empty_plan, &controllers, &provider, &ctx, &hpo)
            .unwrap_err();
        assert!(error.to_string().contains("fold set contains no folds"));
        assert_eq!(trace.lock().unwrap().len(), trace_len_before);

        // Refuse a no-CV topology before the tuner session is constructed:
        // a final aggregate is not a substitute for real fold progression.
        let mut no_fold_plan = plan.clone();
        no_fold_plan.fold_set = None;
        let mut no_fold_hpo = hpo.clone();
        no_fold_hpo.provenance.fold_set_fingerprint = None;
        let trace_len_before = trace.lock().unwrap().len();
        let error = SequentialScheduler
            .execute_hpo_campaign(&no_fold_plan, &controllers, &provider, &ctx, &no_fold_hpo)
            .unwrap_err();
        assert!(error
            .to_string()
            .contains("requires an explicit validated fold set"));
        assert_eq!(trace.lock().unwrap().len(), trace_len_before);

        // Nested stacking has inner and outer fold identities. Until the HPO
        // contract can bind one exact report-grade outer resource sequence,
        // it too must be refused before any native handle is constructed.
        let samples = (1..=6)
            .map(|index| SampleId::new(format!("nested:{index}")).unwrap())
            .collect::<Vec<_>>();
        let outer_folds = KFoldSpec {
            n_splits: 3,
            shuffle: false,
            seed: Some(7),
        }
        .split("folds:hpo.nested", &samples)
        .unwrap();
        let base_a = NodeId::new("model:nested.base.a").unwrap();
        let base_b = NodeId::new("model:nested.base.b").unwrap();
        let meta = NodeId::new("model:nested.meta").unwrap();
        let mut meta_node = NodeSpec {
            id: meta.clone(),
            kind: NodeKind::Model,
            operator: None,
            params: BTreeMap::new(),
            ports: PortSchema {
                inputs: vec![prediction_port("a"), prediction_port("b")],
                outputs: vec![prediction_port("prediction")],
            },
            metadata: BTreeMap::new(),
            seed_label: None,
        };
        meta_node.metadata.insert(
            NESTED_STACKING_EXECUTION_METADATA_KEY.to_string(),
            serde_json::json!(NESTED_STACKING_EXECUTION_V1),
        );
        let nested_graph = GraphSpec {
            id: "graph:hpo.nested".to_string(),
            interface: GraphInterface::default(),
            nodes: vec![
                node(
                    base_a.as_str(),
                    NodeKind::Model,
                    vec![prediction_port("prediction")],
                ),
                node(
                    base_b.as_str(),
                    NodeKind::Model,
                    vec![prediction_port("prediction")],
                ),
                meta_node,
            ],
            edges: vec![
                EdgeSpec {
                    source: PortRef {
                        node_id: base_a,
                        port_name: "prediction".to_string(),
                    },
                    target: PortRef {
                        node_id: meta.clone(),
                        port_name: "a".to_string(),
                    },
                    contract: EdgeContract {
                        requires_oof: true,
                        requires_fold_alignment: true,
                        ..EdgeContract::new(PortKind::Prediction, None)
                    },
                },
                EdgeSpec {
                    source: PortRef {
                        node_id: base_b,
                        port_name: "prediction".to_string(),
                    },
                    target: PortRef {
                        node_id: meta.clone(),
                        port_name: "b".to_string(),
                    },
                    contract: EdgeContract {
                        requires_oof: true,
                        requires_fold_alignment: true,
                        ..EdgeContract::new(PortKind::Prediction, None)
                    },
                },
            ],
            search_space_fingerprint: None,
            metadata: BTreeMap::new(),
        };
        let mut nested_campaign = plan.campaign.clone();
        nested_campaign.id = "campaign:hpo.nested".to_string();
        nested_campaign.inner_cv = Some(NestedCvSpec::KFold(KFoldSpec {
            n_splits: 2,
            shuffle: false,
            seed: Some(11),
        }));
        nested_campaign.split_invocation.as_mut().unwrap().fold_set = Some(outer_folds);
        let mut nested_registry = ControllerRegistry::new();
        let mut nested_model_manifest = manifest("controller:model", NodeKind::Model);
        nested_model_manifest
            .capabilities
            .insert(ControllerCapability::ConsumesOofPredictions);
        nested_registry.register(nested_model_manifest).unwrap();
        let nested_plan = build_execution_plan(
            "plan:hpo.nested",
            nested_graph,
            nested_campaign,
            &nested_registry,
        )
        .unwrap();
        let mut nested_hpo = hpo.clone();
        nested_hpo.target_node_id = meta.clone();
        nested_hpo.base_variant = nested_plan.variants[0].clone();
        nested_hpo.selection.producer_node = meta;
        nested_hpo.provenance.graph_fingerprint = nested_plan.graph_fingerprint.clone();
        nested_hpo.provenance.campaign_fingerprint = nested_plan.campaign_fingerprint.clone();
        nested_hpo.provenance.controller_fingerprint = nested_plan.controller_fingerprint.clone();
        nested_hpo.provenance.fold_set_fingerprint = nested_plan
            .fold_set
            .as_ref()
            .map(stable_json_fingerprint)
            .transpose()
            .unwrap();
        let trace_len_before = trace.lock().unwrap().len();
        let error = SequentialScheduler
            .execute_hpo_campaign(&nested_plan, &controllers, &provider, &ctx, &nested_hpo)
            .unwrap_err();
        assert!(error
            .to_string()
            .contains("does not support nested-stacking FIT_CV"));
        assert_eq!(trace.lock().unwrap().len(), trace_len_before);

        // The native study may restore failed/pruned history that has no
        // completed proposal evidence. Its local count, not the coordinator's
        // persisted completed list, determines the remaining global budget.
        let resumed_trace = Arc::new(Mutex::new(Vec::new()));
        let mut resumed_controllers = RuntimeControllerRegistry::new();
        resumed_controllers
            .register(Box::new(HpoTestTuner {
                id: ControllerId::new("controller:tuner").unwrap(),
                trace: Arc::clone(&resumed_trace),
                history_len: 2,
                proposal_count: 2,
                prune_at: None,
            }))
            .unwrap();
        resumed_controllers
            .register(Box::new(HpoTestModel {
                id: ControllerId::new("controller:model").unwrap(),
                trace: Arc::clone(&resumed_trace),
                fail_variant: None,
                score_by_trial: false,
            }))
            .unwrap();
        let mut resumed_hpo = hpo.clone();
        resumed_hpo.trial_budget_total = 4;
        let resumed_ctx = RunContext::new(RunId::new("run:hpo.resumed").unwrap(), Some(13));
        let resumed = SequentialScheduler
            .execute_hpo_campaign(
                &plan,
                &resumed_controllers,
                &provider,
                &resumed_ctx,
                &resumed_hpo,
            )
            .unwrap();
        assert_eq!(resumed.candidates.len(), 2);
        assert_eq!(resumed.checkpoint.trial_history_len, 4);
        assert_eq!(
            resumed_trace
                .lock()
                .unwrap()
                .iter()
                .filter(|event| event.as_str() == "ask")
                .count(),
            2
        );

        let mut over_budget_controllers = RuntimeControllerRegistry::new();
        over_budget_controllers
            .register(Box::new(HpoTestTuner {
                id: ControllerId::new("controller:tuner").unwrap(),
                trace: Arc::new(Mutex::new(Vec::new())),
                history_len: 5,
                proposal_count: 0,
                prune_at: None,
            }))
            .unwrap();
        let error = SequentialScheduler
            .execute_hpo_campaign(
                &plan,
                &over_budget_controllers,
                &provider,
                &resumed_ctx,
                &resumed_hpo,
            )
            .unwrap_err();
        assert!(error.to_string().contains("exceeds total trial budget"));

        #[cfg(feature = "methods-optimizer-local")]
        {
            // Vertical native gate: the ordinary scheduler supplies the fold
            // scores, while the selected Methods C ABI alone owns TPE,
            // pruning, terminal state, opaque handles and N4MOPT resume.
            let library_path = std::env::var_os("N4M_LIBRARY_PATH")
                .expect("native HPO scheduler test requires N4M_LIBRARY_PATH");
            let runtime = MethodsRuntime::configure(library_path).unwrap();
            let native_trace = Arc::new(Mutex::new(Vec::new()));
            let mut native_controllers = RuntimeControllerRegistry::new();
            native_controllers
                .register(Box::new(MethodsHpoController::new(
                    ControllerId::new("controller:tuner").unwrap(),
                    runtime,
                )))
                .unwrap();
            native_controllers
                .register(Box::new(HpoTestModel {
                    id: ControllerId::new("controller:model").unwrap(),
                    trace: Arc::clone(&native_trace),
                    fail_variant: None,
                    score_by_trial: true,
                }))
                .unwrap();
            let mut native_hpo = hpo.clone();
            native_hpo.trial_budget_total = 3;
            native_hpo.study.study_id = "study:hpo.scheduler.native".to_string();
            native_hpo.study.methods_abi = "n4m-abi-2.2".to_string();
            native_hpo.study.optimizer.sampler = HpoSampler::Tpe;
            native_hpo.study.optimizer.pruner = HpoPruner::Median;
            native_hpo.study.optimizer.n_startup_trials = 2;
            native_hpo.study.optimizer.seed = 51;
            native_hpo.study.optimizer.reduction_factor = 0;
            native_hpo.study.search_space.parameters = vec![HpoParameter::Int {
                name: "n_components".to_string(),
                low: 1,
                high: 3,
                step: 1,
                log: false,
            }];
            let native = SequentialScheduler
                .execute_hpo_campaign(
                    &plan,
                    &native_controllers,
                    &provider,
                    &RunContext::new(RunId::new("run:hpo.native").unwrap(), Some(13)),
                    &native_hpo,
                )
                .unwrap();
            assert_eq!(native.checkpoint.trial_history_len, 3);
            assert_eq!(native.checkpoint.artifact.format, N4MOPT_FORMAT);
            assert_eq!(native.candidates.len(), 2);
            assert_eq!(
                native
                    .terminal_trials
                    .iter()
                    .map(|entry| entry.trial.status)
                    .collect::<Vec<_>>(),
                vec![
                    crate::hpo::HpoTrialStatus::Completed,
                    crate::hpo::HpoTrialStatus::Completed,
                    crate::hpo::HpoTrialStatus::Pruned,
                ]
            );
            assert!(native.terminal_trials[2]
                .trial
                .intermediates
                .iter()
                .any(|item| item.step == 0 && item.should_prune));
            assert_eq!(
                native_trace
                    .lock()
                    .unwrap()
                    .iter()
                    .filter(|event| event.as_str() == "model_cv")
                    .count(),
                5,
                "native pruning must stop the third trial after its first fold"
            );

            let prior_checkpoint = native.checkpoint.artifact.clone();
            native_hpo.resume_checkpoint = Some(prior_checkpoint.clone());
            native_hpo.resume_variants = native
                .terminal_trials
                .iter()
                .filter_map(|snapshot| {
                    snapshot
                        .variant_id
                        .clone()
                        .map(|variant| (snapshot.trial.id, variant))
                })
                .collect();
            native_hpo.resume_terminal_trials = native.terminal_trials.clone();
            native_hpo.trial_budget_total = 4;
            let resumed = SequentialScheduler
                .execute_hpo_campaign(
                    &plan,
                    &native_controllers,
                    &provider,
                    &RunContext::new(RunId::new("run:hpo.native.resume").unwrap(), Some(13)),
                    &native_hpo,
                )
                .unwrap();
            assert_eq!(resumed.checkpoint.trial_history_len, 4);
            assert_eq!(resumed.terminal_trials.len(), 4);
            assert_eq!(
                &resumed.terminal_trials[..3],
                native.terminal_trials.as_slice()
            );
            assert_ne!(
                resumed.checkpoint.artifact.opaque_payload,
                prior_checkpoint.opaque_payload
            );
        }
    }
}

pub(crate) fn attach_coordinator_input_lineage(
    result: &mut NodeResult,
    plan: &ExecutionPlan,
    node_id: &NodeId,
    upstream_lineage: &BTreeMap<NodeId, LineageId>,
) -> Result<()> {
    let inferred = inferred_input_lineage_for_node(plan, node_id, upstream_lineage);
    if result.lineage.input_lineage.is_empty() {
        result.lineage.input_lineage = inferred;
        return Ok(());
    }

    let declared = result
        .lineage
        .input_lineage
        .iter()
        .cloned()
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect::<Vec<_>>();
    if declared != inferred {
        return Err(DagMlError::RuntimeValidation(format!(
            "lineage for node `{}` declared input lineage {:?}, expected {:?}",
            result.node_id, declared, inferred
        )));
    }
    result.lineage.input_lineage = declared;
    Ok(())
}

/// The meta invocation in a nested-stacking FIT_CV scope consumes parent-bound
/// *inner* OOF blocks, not the outer blocks emitted immediately before it. The
/// ordinary per-scope lineage map cannot represent those records because every
/// inner fold ran in its own prior scope. Reconstruct the exact dependency set
/// from scheduler-owned nested evidence and attach it before recording the
/// meta result.
fn attach_nested_stacking_input_lineage(
    result: &mut NodeResult,
    plan: &ExecutionPlan,
    task: &NodeTask,
    ctx: &RunContext,
    nested: &NestedStackingInput<'_>,
) -> Result<()> {
    if task.phase != Phase::FitCv || task.node_plan.node_id != *nested.meta_node_id {
        return Ok(());
    }
    let inner_fold_ids = nested
        .inner
        .inner_fold_set
        .folds
        .iter()
        .map(|fold| fold.fold_id.clone())
        .collect::<BTreeSet<_>>();
    let source_nodes = incoming_oof_edges(plan, &task.node_plan)?
        .into_iter()
        .map(|edge| edge.source.node_id.clone())
        .collect::<BTreeSet<_>>();
    let expected = source_nodes
        .iter()
        .flat_map(|node_id| {
            inner_fold_ids
                .iter()
                .cloned()
                .map(move |fold_id| (node_id.clone(), fold_id))
        })
        .collect::<BTreeSet<_>>();
    let mut actual = BTreeMap::new();
    for record in ctx.lineage.records().filter(|record| {
        record.phase == Phase::FitCv
            && record.variant_id == task.variant_id
            && source_nodes.contains(&record.node_id)
            && record
                .fold_id
                .as_ref()
                .is_some_and(|fold_id| inner_fold_ids.contains(fold_id))
    }) {
        let fold_id = record
            .fold_id
            .clone()
            .expect("inner-fold predicate requires a fold id");
        if actual
            .insert((record.node_id.clone(), fold_id), record.record_id.clone())
            .is_some()
        {
            return Err(DagMlError::RuntimeValidation(
                "nested stacking meta input lineage contains duplicate inner-fold evidence"
                    .to_string(),
            ));
        }
    }
    if actual.keys().cloned().collect::<BTreeSet<_>>() != expected {
        return Err(DagMlError::RuntimeValidation(
            "nested stacking meta input lineage does not exactly cover inner OOF evidence"
                .to_string(),
        ));
    }
    let inferred = actual.into_values().collect::<Vec<_>>();
    if result.lineage.input_lineage.is_empty() {
        result.lineage.input_lineage = inferred;
        return Ok(());
    }
    let declared = result
        .lineage
        .input_lineage
        .iter()
        .cloned()
        .collect::<BTreeSet<_>>();
    if declared.into_iter().collect::<Vec<_>>() != inferred {
        return Err(DagMlError::RuntimeValidation(format!(
            "nested stacking meta lineage for node `{}` does not match inner OOF evidence",
            task.node_plan.node_id
        )));
    }
    result.lineage.input_lineage = inferred;
    Ok(())
}

pub(crate) fn inferred_input_lineage_for_node(
    plan: &ExecutionPlan,
    node_id: &NodeId,
    upstream_lineage: &BTreeMap<NodeId, LineageId>,
) -> Vec<LineageId> {
    plan.graph_plan
        .graph
        .edges
        .iter()
        .filter(|edge| &edge.target.node_id == node_id && edge.contract.propagates_lineage)
        .filter_map(|edge| upstream_lineage.get(&edge.source.node_id).cloned())
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect()
}
pub(crate) fn collect_input_handles(
    plan: &ExecutionPlan,
    node_plan: &NodePlan,
    output_handles: &BTreeMap<NodeId, BTreeMap<String, HandleRef>>,
    output_data_views: &BTreeMap<NodeId, BTreeMap<String, DataProviderViewSpec>>,
    resources: &PhaseScopeResources<'_>,
    ctx: &RunContext,
    scope: &PhaseScope,
) -> Result<CollectedInputs> {
    let mut inputs = BTreeMap::new();
    let mut data_views = BTreeMap::new();
    let mut prediction_inputs = BTreeMap::new();
    let training_oof_edges = incoming_training_oof_edges(plan, node_plan, scope)?;
    // An OOF edge replaces exactly one raw producer port. Do not hide sibling
    // outputs from the same producer: a meta-node may legally consume both an
    // OOF prediction port and an auxiliary non-OOF port. PREDICT has no
    // Validation-OOF input, but its raw prediction port must still be masked so
    // only the explicit `:predict` off-fold input reaches the controller.
    let masked_oof_source_ports = if scope.phase == Phase::Predict {
        incoming_oof_edges(plan, node_plan)?
    } else {
        training_oof_edges.clone()
    }
    .into_iter()
    .map(|edge| (edge.source.node_id.clone(), edge.source.port_name.clone()))
    .collect::<BTreeSet<_>>();
    let bound_data_inputs = node_plan
        .data_bindings
        .iter()
        .map(|binding| binding.input_name.clone())
        .collect::<BTreeSet<_>>();
    // Only forward upstream handles for ports this node DECLARES an edge to.
    // A controller must never see a handle outside its declared port contract,
    // so a sibling consumer of the same producer cannot expose extra ports here.
    let declared_source_ports = plan
        .graph_plan
        .graph
        .edges
        .iter()
        .filter(|edge| edge.target.node_id == node_plan.node_id)
        .map(|edge| (edge.source.node_id.clone(), edge.source.port_name.clone()))
        .collect::<BTreeSet<_>>();
    for upstream in &node_plan.input_nodes {
        if let Some(handles) = output_handles.get(upstream) {
            for (port, handle) in handles {
                if !declared_source_ports.contains(&(upstream.clone(), port.clone())) {
                    continue;
                }
                if masked_oof_source_ports.contains(&(upstream.clone(), port.clone())) {
                    continue;
                }
                inputs.insert(format!("{upstream}.{port}"), handle.clone());
            }
        }
    }
    for edge in plan
        .graph_plan
        .graph
        .edges
        .iter()
        .filter(|edge| edge.target.node_id == node_plan.node_id)
        .filter(|edge| edge.contract.kind == PortKind::Data && !edge.contract.requires_oof)
    {
        if bound_data_inputs.contains(&edge.target.port_name) {
            continue;
        }
        let Some(handles) = output_handles.get(&edge.source.node_id) else {
            continue;
        };
        let Some(handle) = handles.get(&edge.source.port_name) else {
            continue;
        };
        let key = data_view_key(&edge.target.port_name);
        if inputs.insert(key.clone(), handle.clone()).is_some() {
            return Err(DagMlError::RuntimeValidation(format!(
                "node `{}` received duplicate data edge input `{key}`",
                node_plan.node_id
            )));
        }
        if let Some(source_views) = output_data_views.get(&edge.source.node_id) {
            if let Some(view) = source_views.get(&edge.source.port_name) {
                if data_views.insert(key.clone(), view.clone()).is_some() {
                    return Err(DagMlError::RuntimeValidation(format!(
                        "node `{}` received duplicate data edge view `{key}`",
                        node_plan.node_id
                    )));
                }
            }
            let source_validation_key = validation_data_view_key(&edge.source.port_name);
            if let Some(view) = source_views.get(&source_validation_key) {
                let validation_key = format!("{key}:validation");
                if data_views
                    .insert(validation_key.clone(), view.clone())
                    .is_some()
                {
                    return Err(DagMlError::RuntimeValidation(format!(
                        "node `{}` received duplicate data edge validation view `{validation_key}`",
                        node_plan.node_id
                    )));
                }
            }
        }
    }
    for edge in training_oof_edges {
        let key = format!("{}.{}", edge.source.node_id, edge.source.port_name);
        let Some(input) = collect_oof_prediction_input(plan, edge, ctx, scope, resources)? else {
            return Ok(CollectedInputs {
                handles: BTreeMap::new(),
                data_views: BTreeMap::new(),
                prediction_inputs: BTreeMap::new(),
                skip_node: true,
            });
        };
        if inputs.insert(key.clone(), input.handle).is_some() {
            return Err(DagMlError::RuntimeValidation(format!(
                "node `{}` received duplicate OOF prediction input `{key}`",
                node_plan.node_id
            )));
        }
        if prediction_inputs.insert(key.clone(), input.spec).is_some() {
            return Err(DagMlError::RuntimeValidation(format!(
                "node `{}` received duplicate OOF prediction spec `{key}`",
                node_plan.node_id
            )));
        }
    }
    // REFIT / PREDICT: deliver each base producer's off-fold (test / predict)
    // predictions to the stacking meta-node as a SEPARATE prediction input (suffixed
    // `:test` / `:predict`) so the host meta-model predicts from them. The FIT_CV
    // Validation-OOF input above is the meta-features the meta-model trains on; this
    // off-fold input is used ONLY for REFIT/PREDICT scoring/prediction, never FIT_CV
    // training — keeping the leakage invariant intact.
    if matches!(scope.phase, Phase::Refit | Phase::Predict) {
        let off_fold_suffix = scope.phase.as_str().to_ascii_lowercase();
        for edge in incoming_oof_edges(plan, node_plan)? {
            let Some(input) = collect_off_fold_prediction_input(plan, edge, ctx, scope)? else {
                continue;
            };
            let key = format!(
                "{}.{}:{off_fold_suffix}",
                edge.source.node_id, edge.source.port_name
            );
            if inputs.insert(key.clone(), input.handle).is_some() {
                return Err(DagMlError::RuntimeValidation(format!(
                    "node `{}` received duplicate off-fold prediction input `{key}`",
                    node_plan.node_id
                )));
            }
            if prediction_inputs.insert(key.clone(), input.spec).is_some() {
                return Err(DagMlError::RuntimeValidation(format!(
                    "node `{}` received duplicate off-fold prediction spec `{key}`",
                    node_plan.node_id
                )));
            }
        }
    }
    if !node_plan.data_bindings.is_empty() && resources.data_provider.is_none() {
        return Err(DagMlError::RuntimeValidation(format!(
            "node `{}` requires {} data binding(s) but no runtime data provider is registered",
            node_plan.node_id,
            node_plan.data_bindings.len()
        )));
    }
    if let Some(data_provider) = resources.data_provider {
        // Samples excluded from training (sample-local) are relevant only to
        // fitting scopes. A top-level PREDICT must not even resolve the CV
        // relation authority: its separately attested cohort below owns the
        // complete identity universe for that read.
        let excluded_samples = if scope.phase == Phase::Predict {
            BTreeSet::new()
        } else {
            coordinator_relations_for_node(node_plan, resources)?
                .map(|relations| relations.excluded_sample_ids())
                .unwrap_or_default()
        };
        let scope_fold_set = resources.fold_set_override.or(plan.fold_set.as_ref());
        for binding in &node_plan.data_bindings {
            let predict_cohort = if scope.phase == Phase::Predict {
                data_provider.predict_cohort(binding, scope.phase)?
            } else {
                None
            };
            let materialized = data_provider.materialize(&DataMaterializationRequest {
                run_id: ctx.run_id.clone(),
                node_id: node_plan.node_id.clone(),
                input_name: binding.input_name.clone(),
                phase: scope.phase,
                variant_id: scope.variant_id.clone(),
                fold_id: scope.fold_id.clone(),
                binding: binding.clone(),
                predict_cohort: predict_cohort.clone(),
            })?;
            let branch_view_for_node = branch_view_from_node_metadata(plan, &node_plan.node_id)?;
            let mut view = data_view_for_scope(
                binding,
                scope_fold_set,
                scope,
                branch_view_for_node.as_ref(),
                &excluded_samples,
            )?;
            if let Some(cohort) = predict_cohort.as_ref() {
                bind_predict_cohort_to_view(&mut view, cohort)?;
            }
            let key = data_view_key(&binding.input_name);
            let view_handle = make_data_view_handle(
                data_provider,
                ctx,
                node_plan,
                scope,
                binding,
                DataViewHandleInput {
                    data_handle: &materialized,
                    view: &view,
                    predict_cohort: predict_cohort.as_ref(),
                },
            )?;
            if data_views.insert(key.clone(), view).is_some() {
                return Err(DagMlError::RuntimeValidation(format!(
                    "node `{}` received duplicate data view `{key}`",
                    node_plan.node_id
                )));
            }
            if inputs.insert(key.clone(), view_handle).is_some() {
                return Err(DagMlError::RuntimeValidation(format!(
                    "node `{}` received duplicate data input `{key}`",
                    node_plan.node_id
                )));
            }

            if let Some(validation_view) = validation_data_view_for_scope(
                binding,
                scope_fold_set,
                scope,
                branch_view_for_node.as_ref(),
                &excluded_samples,
            )? {
                let validation_key = format!("{key}:validation");
                let validation_handle = make_data_view_handle(
                    data_provider,
                    ctx,
                    node_plan,
                    scope,
                    binding,
                    DataViewHandleInput {
                        data_handle: &materialized,
                        view: &validation_view,
                        predict_cohort: None,
                    },
                )?;
                if data_views
                    .insert(validation_key.clone(), validation_view)
                    .is_some()
                {
                    return Err(DagMlError::RuntimeValidation(format!(
                        "node `{}` received duplicate validation data view `{validation_key}`",
                        node_plan.node_id
                    )));
                }
                if inputs
                    .insert(validation_key.clone(), validation_handle)
                    .is_some()
                {
                    return Err(DagMlError::RuntimeValidation(format!(
                        "node `{}` received duplicate validation data input `{validation_key}`",
                        node_plan.node_id
                    )));
                }
            }
        }
    }
    Ok(CollectedInputs {
        handles: inputs,
        data_views,
        prediction_inputs,
        skip_node: false,
    })
}
pub(crate) fn preload_replay_prediction_cache_store(
    bundle: &ExecutionBundle,
    prediction_cache_store: Option<&dyn RuntimePredictionCacheStore>,
    ctx: &mut RunContext,
) -> Result<()> {
    if bundle.prediction_requirements.is_empty() {
        return Ok(());
    }
    let store = prediction_cache_store.ok_or_else(|| {
        DagMlError::RuntimeValidation(format!(
            "bundle `{}` cannot preload OOF prediction caches without a prediction cache store",
            bundle.bundle_id
        ))
    })?;
    if !ctx.prediction_store.blocks().is_empty() {
        return Err(DagMlError::RuntimeValidation(format!(
            "bundle `{}` cannot preload OOF prediction caches into a non-empty prediction store",
            bundle.bundle_id
        )));
    }
    let contracts = replay_prediction_cache_contracts(bundle)?;
    for contract in contracts.values() {
        if contract.requirement.prediction_level == PredictionLevel::Sample {
            let blocks = store.load_blocks(&contract.cache.requirement_key)?;
            if blocks.iter().any(|block| {
                block.producer_node != contract.requirement.producer_node
                    || block.partition != contract.requirement.partition
            }) {
                return Err(DagMlError::RuntimeValidation(format!(
                    "prediction cache store returned blocks outside requirement `{}`",
                    contract.cache.requirement_key
                )));
            }
            let mut payload = build_prediction_cache_payload(&contract.requirement, &blocks)?;
            payload.cache_namespace_fingerprints =
                contract.cache.cache_namespace_fingerprints.clone();
            validate_prediction_cache_payload_matches_record(&payload, &contract.cache)?;
            for block in &payload.blocks {
                ctx.prediction_store.append(block.clone())?;
            }
        } else {
            let blocks = store.load_aggregated_blocks(&contract.cache.requirement_key)?;
            if blocks.iter().any(|block| {
                block.producer_node != contract.requirement.producer_node
                    || block.partition != contract.requirement.partition
                    || block.level != contract.requirement.prediction_level
            }) {
                return Err(DagMlError::RuntimeValidation(format!(
                    "prediction cache store returned aggregated blocks outside requirement `{}`",
                    contract.cache.requirement_key
                )));
            }
            let mut payload =
                build_aggregated_prediction_cache_payload(&contract.requirement, &blocks)?;
            payload.cache_namespace_fingerprints =
                contract.cache.cache_namespace_fingerprints.clone();
            validate_prediction_cache_payload_matches_record(&payload, &contract.cache)?;
        }
    }
    Ok(())
}

pub(crate) fn replay_prediction_cache_contracts(
    bundle: &ExecutionBundle,
) -> Result<BTreeMap<String, ReplayPredictionCacheContract>> {
    bundle.validate()?;
    let requirements = bundle
        .prediction_requirements
        .iter()
        .map(|requirement| (requirement.key(), requirement))
        .collect::<BTreeMap<_, _>>();
    let mut contracts = BTreeMap::new();
    for cache in &bundle.prediction_caches {
        let requirement = requirements.get(&cache.requirement_key).ok_or_else(|| {
            DagMlError::RuntimeValidation(format!(
                "prediction cache `{}` references unknown prediction requirement `{}`",
                cache.cache_id, cache.requirement_key
            ))
        })?;
        contracts.insert(
            cache.requirement_key.clone(),
            ReplayPredictionCacheContract {
                requirement: (*requirement).clone(),
                cache: cache.clone(),
            },
        );
    }
    Ok(contracts)
}

pub(crate) fn materialize_replay_artifact_handles(
    plan: &ExecutionPlan,
    bundle: &ExecutionBundle,
    replay_request: &ReplayPhaseRequest,
    artifact_store: &dyn RuntimeArtifactStore,
    ctx: &RunContext,
) -> Result<MaterializedReplayArtifacts> {
    let mut handles = BTreeMap::<NodeId, BTreeMap<String, HandleRef>>::new();
    let mut inputs = BTreeMap::<NodeId, BTreeMap<String, ArtifactInputSpec>>::new();
    for artifact in &bundle.refit_artifacts {
        artifact.validate()?;
        let node_plan = plan.node_plans.get(&artifact.node_id).ok_or_else(|| {
            DagMlError::RuntimeValidation(format!(
                "bundle `{}` artifact references unknown node `{}`",
                bundle.bundle_id, artifact.node_id
            ))
        })?;
        if !node_plan.supported_phases.contains(&replay_request.phase) {
            return Err(DagMlError::RuntimeValidation(format!(
                "bundle `{}` artifact node `{}` does not support replay phase {:?}",
                bundle.bundle_id, artifact.node_id, replay_request.phase
            )));
        }
        let handle = artifact_store.materialize(&ArtifactMaterializationRequest {
            run_id: ctx.run_id.clone(),
            bundle_id: bundle.bundle_id.clone(),
            node_id: artifact.node_id.clone(),
            phase: replay_request.phase,
            variant_id: bundle.selected_variant_id.clone(),
            controller_id: artifact.controller_id.clone(),
            artifact: artifact.artifact.clone(),
            params_fingerprint: artifact.params_fingerprint.clone(),
            training_loss_fingerprint: artifact.training_loss_fingerprint.clone(),
        })?;
        if !matches!(handle.kind, HandleKind::Model | HandleKind::Artifact) {
            return Err(DagMlError::RuntimeValidation(format!(
                "artifact `{}` materialized as unsupported handle kind {:?}",
                artifact.artifact.id, handle.kind
            )));
        }
        if handle.owner_controller != artifact.controller_id {
            return Err(DagMlError::RuntimeValidation(format!(
                "artifact `{}` handle owner `{}` does not match controller `{}`",
                artifact.artifact.id, handle.owner_controller, artifact.controller_id
            )));
        }
        let key = refit_artifact_input_key(&artifact.artifact.id);
        if handles
            .entry(artifact.node_id.clone())
            .or_default()
            .insert(key.clone(), handle)
            .is_some()
        {
            return Err(DagMlError::RuntimeValidation(format!(
                "duplicate replay artifact input `{key}` for node `{}`",
                artifact.node_id
            )));
        }
        if inputs
            .entry(artifact.node_id.clone())
            .or_default()
            .insert(key.clone(), ArtifactInputSpec::from_refit_record(artifact)?)
            .is_some()
        {
            return Err(DagMlError::RuntimeValidation(format!(
                "duplicate replay artifact metadata `{key}` for node `{}`",
                artifact.node_id
            )));
        }
    }
    Ok(MaterializedReplayArtifacts { handles, inputs })
}

pub(crate) fn derive_task_seed(
    root_seed: Option<u64>,
    variant_id: Option<&VariantId>,
    fold_id: Option<&FoldId>,
    node_plan: &NodePlan,
    phase: Phase,
) -> Option<u64> {
    root_seed.map(|root| {
        let mut context = SeedContext::root(root);
        if let Some(variant_id) = variant_id {
            context = context.child(format!("variant:{variant_id}"));
        }
        if let Some(fold_id) = fold_id {
            context = context.child(format!("fold:{fold_id}"));
        }
        context
            .child(format!("node:{}", node_plan.node_id))
            .child(format!("phase:{phase:?}"))
            .derive_u64("task")
    })
}
