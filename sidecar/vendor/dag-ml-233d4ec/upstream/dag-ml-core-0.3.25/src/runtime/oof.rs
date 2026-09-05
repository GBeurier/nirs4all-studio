// Auto-split from the former monolithic `runtime.rs` (pure refactor).
use super::*;

pub(crate) fn effective_node_plan_for_scope(
    node_plan: &NodePlan,
    scope: &PhaseScope,
) -> Result<NodePlan> {
    let Some(variant) = &scope.variant else {
        return Ok(node_plan.clone());
    };
    let params = variant.effective_params_for_node(&node_plan.node_id, &node_plan.params)?;
    if params == node_plan.params {
        return Ok(node_plan.clone());
    }
    let mut node_plan = node_plan.clone();
    node_plan.params = params;
    node_plan.params_fingerprint = stable_json_fingerprint(&node_plan.params)?;
    Ok(node_plan)
}

pub(crate) fn incoming_oof_edges<'a>(
    plan: &'a ExecutionPlan,
    node_plan: &NodePlan,
) -> Result<Vec<&'a EdgeSpec>> {
    plan.graph_plan
        .graph
        .edges
        .iter()
        .filter(|edge| edge.target.node_id == node_plan.node_id && edge.contract.requires_oof)
        .map(|edge| {
            if edge.contract.kind != PortKind::Prediction {
                return Err(DagMlError::RuntimeValidation(format!(
                    "edge `{}.{}` -> `{}.{}` requires OOF but is not a prediction edge",
                    edge.source.node_id,
                    edge.source.port_name,
                    edge.target.node_id,
                    edge.target.port_name
                )));
            }
            Ok(edge)
        })
        .collect()
}

pub(crate) fn incoming_training_oof_edges<'a>(
    plan: &'a ExecutionPlan,
    node_plan: &NodePlan,
    scope: &PhaseScope,
) -> Result<Vec<&'a EdgeSpec>> {
    if !scope.phase.is_training() {
        return Ok(Vec::new());
    }
    incoming_oof_edges(plan, node_plan)
}

/// Validate that a graph edge's source port is a prediction output. Stored block
/// provenance itself is checked by [`prediction_block_matches_edge_source_port`]
/// and [`aggregated_prediction_block_matches_edge_source_port`], which can use
/// the R1 `producer_port` field while preserving the legacy single-port fallback.
pub(crate) fn validate_oof_source_port_provenance(
    plan: &ExecutionPlan,
    edge: &EdgeSpec,
) -> Result<()> {
    let source = plan
        .graph_plan
        .graph
        .nodes
        .iter()
        .find(|node| node.id == edge.source.node_id)
        .ok_or_else(|| {
            DagMlError::RuntimeValidation(format!(
                "OOF edge source node `{}` is absent from the execution graph",
                edge.source.node_id
            ))
        })?;
    let mut prediction_ports = source
        .ports
        .outputs
        .iter()
        .filter(|port| port.kind == PortKind::Prediction)
        .map(|port| port.name.as_str())
        .collect::<Vec<_>>();
    prediction_ports.sort_unstable();
    if !prediction_ports
        .iter()
        .any(|port| *port == edge.source.port_name)
    {
        return Err(DagMlError::OofValidation(format!(
            "OOF edge source `{}.{}` is not a declared Prediction output; declared prediction ports are {:?}",
            edge.source.node_id,
            edge.source.port_name,
            prediction_ports
        )));
    }
    Ok(())
}

fn legacy_absent_port_matches_single_prediction_output(
    plan: &ExecutionPlan,
    edge: &EdgeSpec,
    block_kind: &str,
) -> Result<bool> {
    let source = plan
        .graph_plan
        .graph
        .nodes
        .iter()
        .find(|node| node.id == edge.source.node_id)
        .ok_or_else(|| {
            DagMlError::OofValidation(format!(
                "OOF edge source node `{}` is absent from the execution graph",
                edge.source.node_id
            ))
        })?;
    let mut prediction_ports = source
        .ports
        .outputs
        .iter()
        .filter(|port| port.kind == PortKind::Prediction)
        .map(|port| port.name.as_str())
        .collect::<Vec<_>>();
    prediction_ports.sort_unstable();
    if prediction_ports.len() == 1 {
        return Ok(prediction_ports[0] == edge.source.port_name);
    }
    Err(DagMlError::OofValidation(format!(
        "cannot bind legacy {block_kind} without producer_port to `{}.{}`: producer `{}` exposes {} Prediction output ports {:?}; multi-output producers must store producer_port explicitly",
        edge.source.node_id,
        edge.source.port_name,
        edge.source.node_id,
        prediction_ports.len(),
        prediction_ports
    )))
}

pub(crate) fn producer_port_matches_edge_source_port(
    plan: &ExecutionPlan,
    edge: &EdgeSpec,
    producer_node: &NodeId,
    producer_port: Option<&str>,
    block_kind: &str,
) -> Result<bool> {
    match producer_port {
        Some(port) if port.trim().is_empty() => Err(DagMlError::OofValidation(format!(
            "{block_kind} from `{producer_node}` has blank producer_port"
        ))),
        Some(port) => Ok(port == edge.source.port_name),
        None => legacy_absent_port_matches_single_prediction_output(plan, edge, block_kind),
    }
}

pub(crate) fn prediction_block_matches_edge_source_port(
    plan: &ExecutionPlan,
    edge: &EdgeSpec,
    block: &PredictionBlock,
) -> Result<bool> {
    producer_port_matches_edge_source_port(
        plan,
        edge,
        &block.producer_node,
        block.producer_port.as_deref(),
        "prediction block",
    )
}

pub(crate) fn aggregated_prediction_block_matches_edge_source_port(
    plan: &ExecutionPlan,
    edge: &EdgeSpec,
    block: &AggregatedPredictionBlock,
) -> Result<bool> {
    producer_port_matches_edge_source_port(
        plan,
        edge,
        &block.producer_node,
        block.producer_port.as_deref(),
        "aggregated prediction block",
    )
}

pub(crate) fn filter_prediction_blocks_for_edge_source_port<'a>(
    plan: &ExecutionPlan,
    edge: &EdgeSpec,
    blocks: impl IntoIterator<Item = &'a PredictionBlock>,
) -> Result<Vec<&'a PredictionBlock>> {
    blocks
        .into_iter()
        .filter_map(
            |block| match prediction_block_matches_edge_source_port(plan, edge, block) {
                Ok(true) => Some(Ok(block)),
                Ok(false) => None,
                Err(error) => Some(Err(error)),
            },
        )
        .collect()
}

pub(crate) fn filter_aggregated_prediction_blocks_for_edge_source_port<'a>(
    plan: &ExecutionPlan,
    edge: &EdgeSpec,
    blocks: impl IntoIterator<Item = &'a AggregatedPredictionBlock>,
) -> Result<Vec<&'a AggregatedPredictionBlock>> {
    blocks
        .into_iter()
        .filter_map(|block| {
            match aggregated_prediction_block_matches_edge_source_port(plan, edge, block) {
                Ok(true) => Some(Ok(block)),
                Ok(false) => None,
                Err(error) => Some(Err(error)),
            }
        })
        .collect()
}

/// The base producer's off-fold (test / predict) predictions delivered to a
/// stacking meta-node as a SEPARATE prediction input in REFIT / PREDICT, so the
/// host meta-model can predict from them. This is the prediction-stacking analogue
/// of the concat/fusion off-fold reassembly: the FIT_CV `requires_oof` path stays
/// Validation-OOF-only (the meta-features the meta-model trains on), and these
/// test/predict base predictions are a distinct input used ONLY in REFIT/PREDICT
/// scoring — never in FIT_CV training.
///
/// Reads the base producer's `fold_id == None` block in the phase-expected
/// partition (`Test` in REFIT / `Final` in PREDICT) scoped to the active variant,
/// and builds a [`CollectedPredictionInput`] (a prediction handle + a
/// [`PredictionInputSpec`] carrying its per-sample `values`), mirroring the
/// FIT_CV OOF input so the host adapter sees a handle alongside the spec. Returns
/// `None` when the base produced no such block (a phase with no base prediction).
///
/// LEAKAGE INVARIANT: never reads a `Validation` block, so the Validation-OOF
/// meta-features are untouched. Only runs in REFIT/PREDICT (the caller guards it),
/// and the phase-expected-partition filter keeps a stale `Final`/`Train` block
/// from a prior phase in the same context out of the meta-features.
pub(crate) fn collect_off_fold_prediction_input(
    plan: &ExecutionPlan,
    edge: &EdgeSpec,
    ctx: &RunContext,
    scope: &PhaseScope,
) -> Result<Option<CollectedPredictionInput>> {
    validate_oof_source_port_provenance(plan, edge)?;
    let expected_partition = expected_off_fold_partition(scope.phase);
    let raw_blocks: Vec<&PredictionBlock> = ctx
        .prediction_store
        .find(Some(&edge.source.node_id), Some(&expected_partition), None)
        .into_iter()
        .filter(|block| block.fold_id.is_none())
        .collect();
    let blocks = filter_prediction_blocks_for_edge_source_port(plan, edge, raw_blocks.clone())?;
    if !raw_blocks.is_empty() && blocks.is_empty() {
        return Err(DagMlError::OofValidation(format!(
            "meta node `{}` found off-fold ({expected_partition:?}) blocks for producer `{}` but none for source port `{}`",
            edge.target.node_id, edge.source.node_id, edge.source.port_name
        )));
    }
    if blocks.is_empty() {
        return Ok(None);
    }
    if blocks.len() > 1 {
        return Err(DagMlError::OofValidation(format!(
            "meta node `{}` found {} off-fold ({expected_partition:?}) blocks for base `{}`: the run context mixes several variants — predict each variant in its own context (native SELECT does this)",
            edge.target.node_id,
            blocks.len(),
            edge.source.node_id,
        )));
    }
    let block = blocks[0];
    let width = block.validate_shape()?;
    let target_names = if block.target_names.is_empty() {
        (0..width).map(|index| format!("p{index}")).collect()
    } else {
        block.target_names.clone()
    };
    let source_plan = plan
        .node_plans
        .get(&edge.source.node_id)
        .expect("edge source has a node plan");
    let handle = HandleRef {
        handle: deterministic_oof_handle(plan, edge, ctx, scope)?,
        kind: HandleKind::Prediction,
        owner_controller: source_plan.controller_id.clone(),
    };
    Ok(Some(CollectedPredictionInput {
        handle,
        spec: PredictionInputSpec {
            producer_node: edge.source.node_id.clone(),
            source_port: edge.source.port_name.clone(),
            target_port: edge.target.port_name.clone(),
            partition: block.partition.clone(),
            prediction_level: PredictionLevel::Sample,
            fold_id: None,
            fold_ids: Vec::new(),
            unit_ids: block
                .sample_ids
                .iter()
                .cloned()
                .map(PredictionUnitId::Sample)
                .collect(),
            sample_ids: block.sample_ids.clone(),
            values: block.values.clone(),
            prediction_width: width,
            target_names,
        },
    }))
}

pub(crate) struct CollectedPredictionInput {
    pub(crate) handle: HandleRef,
    pub(crate) spec: PredictionInputSpec,
}

pub(crate) fn collect_oof_prediction_input(
    plan: &ExecutionPlan,
    edge: &EdgeSpec,
    ctx: &RunContext,
    scope: &PhaseScope,
    resources: &PhaseScopeResources<'_>,
) -> Result<Option<CollectedPredictionInput>> {
    validate_oof_source_port_provenance(plan, edge)?;
    if scope.phase == Phase::Refit {
        if let Some(contract) = replay_prediction_cache_contract_for_edge(resources, edge) {
            if contract.requirement.prediction_level != PredictionLevel::Sample {
                let source_plan = plan
                    .node_plans
                    .get(&edge.source.node_id)
                    .expect("edge source has a node plan");
                let handle = materialize_oof_prediction_handle(
                    plan,
                    edge,
                    ctx,
                    scope,
                    resources,
                    &source_plan.controller_id,
                )?;
                return Ok(Some(CollectedPredictionInput {
                    handle,
                    spec: prediction_input_spec_from_requirement(&contract.requirement, scope)?,
                }));
            }
        }
    }
    let source_plan = plan
        .node_plans
        .get(&edge.source.node_id)
        .expect("edge source has a node plan");
    let prediction_level = oof_prediction_level_for_source(source_plan);
    if prediction_level != PredictionLevel::Sample {
        let blocks = match scope.phase {
            Phase::FitCv => validate_fit_cv_aggregated_oof_edge(
                plan,
                edge,
                ctx,
                scope,
                resources,
                prediction_level,
            )?,
            Phase::Refit => {
                validate_refit_aggregated_oof_edge(plan, edge, ctx, resources, prediction_level)?
            }
            _ => Vec::new(),
        };
        let handle = materialize_oof_prediction_handle(
            plan,
            edge,
            ctx,
            scope,
            resources,
            &source_plan.controller_id,
        )?;
        return Ok(Some(CollectedPredictionInput {
            handle,
            spec: aggregated_prediction_input_spec(edge, scope, prediction_level, &blocks)?,
        }));
    }
    let blocks = match scope.phase {
        Phase::FitCv => Some(validate_fit_cv_oof_edge(plan, edge, ctx, scope)?),
        Phase::Refit => validate_refit_oof_edge(plan, edge, ctx)?,
        _ => Some(Vec::new()),
    };
    let Some(blocks) = blocks else {
        return Ok(None);
    };
    let handle = materialize_oof_prediction_handle(
        plan,
        edge,
        ctx,
        scope,
        resources,
        &source_plan.controller_id,
    )?;
    Ok(Some(CollectedPredictionInput {
        handle,
        spec: prediction_input_spec(
            edge,
            scope,
            &blocks,
            scope.phase == Phase::Refit
                && plan_oof_partition_mode(plan) == FoldPartitionMode::Resampled,
        )?,
    }))
}

pub(crate) fn oof_prediction_level_for_source(source_plan: &NodePlan) -> PredictionLevel {
    source_plan
        .shape_plan
        .as_ref()
        .map(|shape_plan| shape_plan.aggregation_policy.aggregation_level)
        .unwrap_or(PredictionLevel::Sample)
}

pub(crate) fn replay_prediction_cache_contract_for_edge<'a>(
    resources: &'a PhaseScopeResources<'_>,
    edge: &EdgeSpec,
) -> Option<&'a ReplayPredictionCacheContract> {
    let contracts = resources.prediction_cache_contracts?;
    let key = bundle_prediction_requirement_key(
        &edge.source.node_id,
        &edge.source.port_name,
        &edge.target.node_id,
        &edge.target.port_name,
    );
    contracts.get(&key)
}

pub(crate) fn materialize_oof_prediction_handle(
    plan: &ExecutionPlan,
    edge: &EdgeSpec,
    ctx: &RunContext,
    scope: &PhaseScope,
    resources: &PhaseScopeResources<'_>,
    producer_controller_id: &ControllerId,
) -> Result<HandleRef> {
    if scope.phase == Phase::Refit {
        if let (Some(store), Some(bundle_id), Some(contracts)) = (
            resources.prediction_cache_store,
            resources.replay_bundle_id,
            resources.prediction_cache_contracts,
        ) {
            let key = bundle_prediction_requirement_key(
                &edge.source.node_id,
                &edge.source.port_name,
                &edge.target.node_id,
                &edge.target.port_name,
            );
            let contract = contracts.get(&key).ok_or_else(|| {
                DagMlError::RuntimeValidation(format!(
                    "replay prediction cache store cannot materialize missing requirement `{key}`"
                ))
            })?;
            let handle = store.materialize(&PredictionCacheMaterializationRequest {
                run_id: ctx.run_id.clone(),
                bundle_id: bundle_id.clone(),
                phase: scope.phase,
                variant_id: scope.variant_id.clone(),
                requirement: contract.requirement.clone(),
                cache: contract.cache.clone(),
                producer_controller_id: producer_controller_id.clone(),
            })?;
            if handle.kind != HandleKind::Prediction {
                return Err(DagMlError::RuntimeValidation(format!(
                    "prediction cache store materialized requirement `{key}` as {:?}",
                    handle.kind
                )));
            }
            if &handle.owner_controller != producer_controller_id {
                return Err(DagMlError::RuntimeValidation(format!(
                    "prediction cache store materialized requirement `{key}` for controller `{}`, expected `{}`",
                    handle.owner_controller, producer_controller_id
                )));
            }
            return Ok(handle);
        }
    }
    Ok(HandleRef {
        handle: deterministic_oof_handle(plan, edge, ctx, scope)?,
        kind: HandleKind::Prediction,
        owner_controller: producer_controller_id.clone(),
    })
}

pub(crate) fn validate_fit_cv_oof_edge<'a>(
    plan: &ExecutionPlan,
    edge: &EdgeSpec,
    ctx: &'a RunContext,
    scope: &PhaseScope,
) -> Result<Vec<&'a PredictionBlock>> {
    let fold_id = scope.fold_id.as_ref().ok_or_else(|| {
        DagMlError::RuntimeValidation(format!(
            "edge `{}.{}` -> `{}.{}` requires OOF predictions but FIT_CV has no fold scope",
            edge.source.node_id, edge.source.port_name, edge.target.node_id, edge.target.port_name
        ))
    })?;
    let blocks = ctx.prediction_store.find(
        Some(&edge.source.node_id),
        Some(&PredictionPartition::Validation),
        Some(fold_id),
    );
    let blocks = filter_prediction_blocks_for_edge_source_port(plan, edge, blocks)?;
    if blocks.is_empty() {
        return Err(missing_oof_edge_error(edge, Some(fold_id)));
    }
    // MANDATORY exact OOF coverage (spec rule 3 + audit R-P0-2): a `requires_oof` stacking edge that
    // reaches here must have exactly one validation prediction per fold-validation sample, exact and
    // unique. This was previously gated by `requires_fold_alignment` — making completeness conditional,
    // so an edge that left the flag unset (a future builder or adversarial JSON) admitted blocks that
    // merely *exist*. The branch-merge concat partition exception ("unless an explicit aggregation
    // policy says otherwise"), where a branch legitimately covers only its partition, is intercepted
    // before this code path (the separation-merge handler) and so is never over-rejected here.
    let fold_set = required_fold_set_for_oof(plan, edge)?;
    validate_oof_blocks_match_fold(edge, fold_set, fold_id, &blocks)?;
    Ok(blocks)
}

pub(crate) fn validate_refit_oof_edge<'a>(
    plan: &ExecutionPlan,
    edge: &EdgeSpec,
    ctx: &'a RunContext,
) -> Result<Option<Vec<&'a PredictionBlock>>> {
    let contract = stacking_oof_refit_contract_for_edge(plan, edge)?;
    let blocks = ctx.prediction_store.find(
        Some(&edge.source.node_id),
        Some(&PredictionPartition::Validation),
        None,
    );
    // Nested execution retains outer evaluation OOF, per-outer inner OOF,
    // and optionally separately declared REFIT OOF. Select exactly the
    // declared REFIT pool (outer OOF by default), never combine evidence
    // classes or average duplicate/foreign folds to manufacture coverage.
    let nested = if is_nested_stacking_meta_node(plan, &edge.target.node_id)? {
        nested_stacking_campaign_plan(plan)?
    } else {
        None
    };
    let refit_fold_set = nested
        .as_ref()
        .and_then(|nested| nested.refit_fold_set.as_ref());
    let fold_set = match refit_fold_set {
        Some(folds) => folds,
        None => required_fold_set_for_oof(plan, edge)?,
    };
    let blocks = if nested.is_some() {
        let refit_fold_ids = fold_set
            .folds
            .iter()
            .map(|fold| fold.fold_id.clone())
            .collect::<BTreeSet<_>>();
        blocks
            .into_iter()
            .filter(|block| {
                block
                    .fold_id
                    .as_ref()
                    .is_some_and(|fold_id| refit_fold_ids.contains(fold_id))
            })
            .collect::<Vec<_>>()
    } else {
        blocks
    };
    let blocks = filter_prediction_blocks_for_edge_source_port(plan, edge, blocks)?;
    // No validation OOF at all, under the default full-coverage policy, means the CV phase was never
    // run for this producer (e.g. a direct REFIT without a prior FIT_CV). Report it as a missing-OOF
    // edge — matching `validate_fit_cv_oof_edge` and `validate_refit_aggregated_oof_edge`, which both
    // guard `blocks.is_empty()` up front — rather than routing an empty set through the partial-coverage
    // contract validator, which would mislabel "no OOF at all" as `partial_oof_without_policy`. The
    // explicit `cv_only` / `skip_refit_on_incomplete_oof` policies still legitimately skip REFIT with
    // zero OOF, so this guard is scoped to `RequireFullCoverage`.
    if blocks.is_empty() && contract.policy == StackingOofRefitPolicy::RequireFullCoverage {
        return Err(missing_oof_edge_error(edge, None));
    }
    // MANDATORY exact OOF coverage — see `validate_fit_cv_oof_edge`. The branch-merge concat partition
    // exception is handled by the separation-merge handler, which never reaches this stacking path.
    let decision = crate::oof::validate_stacking_oof_refit_contract(
        &edge.source.node_id,
        &blocks,
        fold_set,
        &contract,
    )?;
    match decision {
        StackingOofRefitDecision::RefitAllowed(_) => Ok(Some(blocks)),
        StackingOofRefitDecision::SkipRefit(_) => Ok(None),
    }
}

pub(crate) fn stacking_oof_refit_contract_for_edge(
    plan: &ExecutionPlan,
    edge: &EdgeSpec,
) -> Result<StackingOofRefitContract> {
    let node = plan
        .graph_plan
        .graph
        .nodes
        .iter()
        .find(|node| node.id == edge.target.node_id)
        .ok_or_else(|| {
            DagMlError::RuntimeValidation(format!(
                "edge `{}.{}` -> `{}.{}` targets unknown node `{}`",
                edge.source.node_id,
                edge.source.port_name,
                edge.target.node_id,
                edge.target.port_name,
                edge.target.node_id
            ))
        })?;
    StackingOofRefitContract::from_metadata(&node.metadata).map_err(|error| {
        DagMlError::RuntimeValidation(format!(
            "node `{}` carries invalid stacking OOF refit contract: {}",
            node.id, error
        ))
    })
}

pub(crate) fn validate_fit_cv_aggregated_oof_edge<'a>(
    plan: &ExecutionPlan,
    edge: &EdgeSpec,
    ctx: &'a RunContext,
    scope: &PhaseScope,
    resources: &PhaseScopeResources<'_>,
    prediction_level: PredictionLevel,
) -> Result<Vec<&'a AggregatedPredictionBlock>> {
    let fold_id = scope.fold_id.as_ref().ok_or_else(|| {
        DagMlError::RuntimeValidation(format!(
            "edge `{}.{}` -> `{}.{}` requires aggregated OOF predictions but FIT_CV has no fold scope",
            edge.source.node_id, edge.source.port_name, edge.target.node_id, edge.target.port_name
        ))
    })?;
    let blocks = ctx.aggregated_prediction_store.find(
        Some(&edge.source.node_id),
        Some(&PredictionPartition::Validation),
        Some(fold_id),
        Some(prediction_level),
    );
    let blocks = filter_aggregated_prediction_blocks_for_edge_source_port(plan, edge, blocks)?;
    if blocks.is_empty() {
        return Err(missing_oof_edge_error(edge, Some(fold_id)));
    }
    validate_aggregated_blocks_basic(edge, prediction_level, &blocks)?;
    // MANDATORY exact aggregated-OOF coverage — see `validate_fit_cv_oof_edge` (audit R-P0-2). The
    // concat-merge partition exception is intercepted by the separation-merge handler upstream.
    let fold_set = required_fold_set_for_oof(plan, edge)?;
    let relations = coordinator_relations_for_edge(plan, edge, resources)?;
    validate_aggregated_oof_blocks_match_fold(
        edge,
        fold_set,
        &relations,
        prediction_level,
        fold_id,
        &blocks,
    )?;
    Ok(blocks)
}

pub(crate) fn validate_refit_aggregated_oof_edge<'a>(
    plan: &ExecutionPlan,
    edge: &EdgeSpec,
    ctx: &'a RunContext,
    resources: &PhaseScopeResources<'_>,
    prediction_level: PredictionLevel,
) -> Result<Vec<&'a AggregatedPredictionBlock>> {
    let blocks = ctx.aggregated_prediction_store.find(
        Some(&edge.source.node_id),
        Some(&PredictionPartition::Validation),
        None,
        Some(prediction_level),
    );
    let blocks = filter_aggregated_prediction_blocks_for_edge_source_port(plan, edge, blocks)?;
    if blocks.is_empty() {
        return Err(missing_oof_edge_error(edge, None));
    }
    validate_aggregated_blocks_basic(edge, prediction_level, &blocks)?;
    // MANDATORY exact aggregated-OOF coverage — see `validate_fit_cv_oof_edge` (audit R-P0-2). The
    // concat-merge partition exception is intercepted by the separation-merge handler upstream.
    let fold_set = required_fold_set_for_oof(plan, edge)?;
    let relations = coordinator_relations_for_edge(plan, edge, resources)?;
    validate_aggregated_oof_blocks_cover_fold_set(
        edge,
        fold_set,
        &relations,
        prediction_level,
        &blocks,
    )?;
    Ok(blocks)
}

pub(crate) fn validate_aggregated_blocks_basic(
    edge: &EdgeSpec,
    prediction_level: PredictionLevel,
    blocks: &[&AggregatedPredictionBlock],
) -> Result<()> {
    for block in blocks {
        block.validate_shape()?;
        if block.partition != PredictionPartition::Validation {
            return Err(DagMlError::OofValidation(format!(
                "edge `{}.{}` -> `{}.{}` selected non-validation aggregated predictions",
                edge.source.node_id,
                edge.source.port_name,
                edge.target.node_id,
                edge.target.port_name
            )));
        }
        if block.level != prediction_level {
            return Err(DagMlError::OofValidation(format!(
                "edge `{}.{}` -> `{}.{}` selected {:?} aggregated predictions, expected {:?}",
                edge.source.node_id,
                edge.source.port_name,
                edge.target.node_id,
                edge.target.port_name,
                block.level,
                prediction_level
            )));
        }
    }
    Ok(())
}

pub(crate) fn prediction_input_spec(
    edge: &EdgeSpec,
    scope: &PhaseScope,
    blocks: &[&PredictionBlock],
    allow_cross_fold_duplicates: bool,
) -> Result<PredictionInputSpec> {
    let fold_ids = blocks
        .iter()
        .filter_map(|block| block.fold_id.clone())
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect::<Vec<_>>();
    // Validation OOF rows keyed by sample, so the meta-node host can build a
    // stacking feature matrix in FIT_CV/REFIT. Blocks are Validation-only (the
    // leakage guards in `validate_fit_cv_oof_edge` / `validate_refit_oof_edge`
    // already refused any Train partition). Partition fold sets keep one row per
    // sample; Resampled REFIT may average repeated validation rows after the
    // contract validator has accepted that multiplicity.
    let mut rows_by_sample: BTreeMap<&SampleId, Vec<&[f64]>> = BTreeMap::new();
    let mut prediction_width = None;
    let mut target_names = None;
    for block in blocks {
        let width = block.validate_shape()?;
        for (sample_id, row) in block.sample_ids.iter().zip(block.values.iter()) {
            let rows = rows_by_sample.entry(sample_id).or_default();
            if !allow_cross_fold_duplicates && !rows.is_empty() {
                return Err(DagMlError::OofValidation(format!(
                    "edge `{}.{}` -> `{}.{}` has duplicate OOF prediction for sample `{sample_id}`",
                    edge.source.node_id,
                    edge.source.port_name,
                    edge.target.node_id,
                    edge.target.port_name
                )));
            }
            rows.push(row.as_slice());
        }
        let block_target_names = if block.target_names.is_empty() {
            (0..width)
                .map(|index| format!("p{index}"))
                .collect::<Vec<_>>()
        } else {
            block.target_names.clone()
        };
        if prediction_width.is_some_and(|expected| expected != width) {
            return Err(DagMlError::OofValidation(format!(
                "edge `{}.{}` -> `{}.{}` OOF prediction width is not stable across folds",
                edge.source.node_id,
                edge.source.port_name,
                edge.target.node_id,
                edge.target.port_name
            )));
        }
        if target_names
            .as_ref()
            .is_some_and(|expected| expected != &block_target_names)
        {
            return Err(DagMlError::OofValidation(format!(
                "edge `{}.{}` -> `{}.{}` OOF target names are not stable across folds",
                edge.source.node_id,
                edge.source.port_name,
                edge.target.node_id,
                edge.target.port_name
            )));
        }
        prediction_width = Some(width);
        target_names = Some(block_target_names);
    }
    let sample_ids = rows_by_sample
        .keys()
        .map(|sample_id| (*sample_id).clone())
        .collect::<Vec<_>>();
    let values = sample_ids
        .iter()
        .map(|sample_id| {
            rows_by_sample
                .get(sample_id)
                .map(|rows| average_prediction_rows(rows, prediction_width.unwrap_or_default()))
                .ok_or_else(|| {
                    DagMlError::OofValidation(format!(
                        "edge `{}.{}` -> `{}.{}` has no OOF prediction row for sample `{sample_id}`",
                        edge.source.node_id,
                        edge.source.port_name,
                        edge.target.node_id,
                        edge.target.port_name
                    ))
                })
        })
        .collect::<Result<Vec<_>>>()?;
    Ok(PredictionInputSpec {
        producer_node: edge.source.node_id.clone(),
        source_port: edge.source.port_name.clone(),
        target_port: edge.target.port_name.clone(),
        partition: PredictionPartition::Validation,
        prediction_level: PredictionLevel::Sample,
        fold_id: scope.fold_id.clone(),
        fold_ids,
        unit_ids: sample_ids
            .iter()
            .cloned()
            .map(PredictionUnitId::Sample)
            .collect(),
        sample_ids,
        values,
        prediction_width: prediction_width.unwrap_or_default(),
        target_names: target_names.unwrap_or_default(),
    })
}

fn average_prediction_rows(rows: &[&[f64]], width: usize) -> Vec<f64> {
    if rows.len() == 1 {
        return rows[0].to_vec();
    }
    let mut averaged = vec![0.0; width];
    for row in rows {
        for (index, value) in row.iter().enumerate() {
            averaged[index] += value;
        }
    }
    let denominator = rows.len() as f64;
    for value in &mut averaged {
        *value /= denominator;
    }
    averaged
}

pub(crate) fn aggregated_prediction_input_spec(
    edge: &EdgeSpec,
    scope: &PhaseScope,
    prediction_level: PredictionLevel,
    blocks: &[&AggregatedPredictionBlock],
) -> Result<PredictionInputSpec> {
    let unit_ids = collect_unique_aggregated_oof_units(edge, prediction_level, blocks)?
        .into_iter()
        .collect::<Vec<_>>();
    let fold_ids = blocks
        .iter()
        .filter_map(|block| block.fold_id.clone())
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect::<Vec<_>>();
    let mut prediction_width = None;
    let mut target_names = None;
    for block in blocks {
        let width = block.validate_shape()?;
        let block_target_names = if block.target_names.is_empty() {
            (0..width)
                .map(|index| format!("p{index}"))
                .collect::<Vec<_>>()
        } else {
            block.target_names.clone()
        };
        if prediction_width.is_some_and(|expected| expected != width) {
            return Err(DagMlError::OofValidation(format!(
                "edge `{}.{}` -> `{}.{}` aggregated OOF prediction width is not stable across folds",
                edge.source.node_id,
                edge.source.port_name,
                edge.target.node_id,
                edge.target.port_name
            )));
        }
        if target_names
            .as_ref()
            .is_some_and(|expected| expected != &block_target_names)
        {
            return Err(DagMlError::OofValidation(format!(
                "edge `{}.{}` -> `{}.{}` aggregated OOF target names are not stable across folds",
                edge.source.node_id,
                edge.source.port_name,
                edge.target.node_id,
                edge.target.port_name
            )));
        }
        prediction_width = Some(width);
        target_names = Some(block_target_names);
    }
    Ok(PredictionInputSpec {
        producer_node: edge.source.node_id.clone(),
        source_port: edge.source.port_name.clone(),
        target_port: edge.target.port_name.clone(),
        partition: PredictionPartition::Validation,
        prediction_level,
        fold_id: scope.fold_id.clone(),
        fold_ids,
        unit_ids,
        sample_ids: Vec::new(),
        // Aggregated (unit-level) OOF crosses as opaque handle, not per-sample rows.
        values: Vec::new(),
        prediction_width: prediction_width.unwrap_or_default(),
        target_names: target_names.unwrap_or_default(),
    })
}

pub(crate) fn prediction_input_spec_from_requirement(
    requirement: &BundlePredictionRequirement,
    scope: &PhaseScope,
) -> Result<PredictionInputSpec> {
    requirement.validate()?;
    Ok(PredictionInputSpec {
        producer_node: requirement.producer_node.clone(),
        source_port: requirement.source_port.clone(),
        target_port: requirement.target_port.clone(),
        partition: requirement.partition.clone(),
        prediction_level: requirement.prediction_level,
        fold_id: scope.fold_id.clone(),
        fold_ids: requirement.fold_ids.clone(),
        unit_ids: requirement.unit_ids.clone(),
        sample_ids: requirement.sample_ids.clone(),
        // Replay-cache requirement: OOF rows are materialized by the host via the
        // prediction-cache handle, not carried inline in the spec.
        values: Vec::new(),
        prediction_width: requirement.prediction_width,
        target_names: requirement.target_names.clone(),
    })
}

pub(crate) fn missing_oof_edge_error(edge: &EdgeSpec, fold_id: Option<&FoldId>) -> DagMlError {
    DagMlError::OofValidation(format!(
        "edge `{}.{}` -> `{}.{}` requires OOF validation predictions from `{}`{}",
        edge.source.node_id,
        edge.source.port_name,
        edge.target.node_id,
        edge.target.port_name,
        edge.source.node_id,
        fold_id
            .map(|fold_id| format!(" for fold `{fold_id}`"))
            .unwrap_or_default()
    ))
}

/// The OOF [`FoldPartitionMode`] for a plan: its fold set's mode, or `Partition` (the clean-OOF
/// default) when the plan carries no fold set. Used to make the cross-fold scoring gate mode-aware so
/// `Resampled` (ShuffleSplit / repeated CV) campaigns, where a sample is validated in several folds,
/// are not rejected by the `Partition` exactly-once uniqueness rule.
pub fn plan_oof_partition_mode(plan: &ExecutionPlan) -> FoldPartitionMode {
    plan.fold_set
        .as_ref()
        .map(|fold_set| fold_set.partition_mode)
        .unwrap_or_default()
}

pub(crate) fn required_fold_set_for_oof<'a>(
    plan: &'a ExecutionPlan,
    edge: &EdgeSpec,
) -> Result<&'a FoldSet> {
    plan.fold_set.as_ref().ok_or_else(|| {
        DagMlError::RuntimeValidation(format!(
            "edge `{}.{}` -> `{}.{}` requires fold-aligned OOF predictions but the plan has no fold set",
            edge.source.node_id,
            edge.source.port_name,
            edge.target.node_id,
            edge.target.port_name
        ))
    })
}

pub(crate) fn validate_oof_blocks_match_fold(
    edge: &EdgeSpec,
    fold_set: &FoldSet,
    fold_id: &FoldId,
    blocks: &[&PredictionBlock],
) -> Result<()> {
    let fold = fold_set
        .folds
        .iter()
        .find(|fold| &fold.fold_id == fold_id)
        .ok_or_else(|| {
            DagMlError::OofValidation(format!(
                "edge `{}.{}` -> `{}.{}` references unknown fold `{fold_id}`",
                edge.source.node_id,
                edge.source.port_name,
                edge.target.node_id,
                edge.target.port_name
            ))
        })?;
    let actual = collect_unique_oof_samples(edge, blocks)?;
    let expected = fold
        .validation_sample_ids
        .iter()
        .cloned()
        .collect::<BTreeSet<_>>();
    if actual != expected {
        return Err(DagMlError::OofValidation(format!(
            "edge `{}.{}` -> `{}.{}` OOF predictions do not match validation samples for fold `{fold_id}`",
            edge.source.node_id,
            edge.source.port_name,
            edge.target.node_id,
            edge.target.port_name
        )));
    }
    Ok(())
}

#[cfg(test)]
pub(crate) fn validate_oof_blocks_cover_fold_set(
    edge: &EdgeSpec,
    fold_set: &FoldSet,
    blocks: &[&PredictionBlock],
) -> Result<()> {
    let folds = fold_set
        .folds
        .iter()
        .map(|fold| (&fold.fold_id, fold))
        .collect::<BTreeMap<_, _>>();
    let mut all_samples = BTreeSet::new();
    for block in blocks {
        let fold_id = block.fold_id.as_ref().ok_or_else(|| {
            DagMlError::OofValidation(format!(
                "edge `{}.{}` -> `{}.{}` has OOF predictions without a fold id",
                edge.source.node_id,
                edge.source.port_name,
                edge.target.node_id,
                edge.target.port_name
            ))
        })?;
        let fold = folds.get(fold_id).ok_or_else(|| {
            DagMlError::OofValidation(format!(
                "edge `{}.{}` -> `{}.{}` references unknown fold `{fold_id}`",
                edge.source.node_id,
                edge.source.port_name,
                edge.target.node_id,
                edge.target.port_name
            ))
        })?;
        let block_samples = collect_unique_oof_samples(edge, &[*block])?;
        let expected = fold
            .validation_sample_ids
            .iter()
            .cloned()
            .collect::<BTreeSet<_>>();
        if block_samples != expected {
            return Err(DagMlError::OofValidation(format!(
                "edge `{}.{}` -> `{}.{}` OOF predictions do not match validation samples for fold `{fold_id}`",
                edge.source.node_id,
                edge.source.port_name,
                edge.target.node_id,
                edge.target.port_name
            )));
        }
        for sample_id in block_samples {
            // Partition is a clean OOF set: a sample covered by two folds is a duplicated fold or a
            // mixed-variant context. Resampled (ShuffleSplit / repeated CV) legitimately validates a
            // sample in several folds and averages its predictions, so the across-fold duplicate is
            // expected; the per-fold match above + per-block uniqueness (`collect_unique_oof_samples`)
            // still hold, and the universe-coverage check below still requires every sample at least
            // once.
            if !all_samples.insert(sample_id.clone())
                && fold_set.partition_mode == FoldPartitionMode::Partition
            {
                return Err(DagMlError::OofValidation(format!(
                    "edge `{}.{}` -> `{}.{}` has duplicate OOF prediction for sample `{sample_id}`",
                    edge.source.node_id,
                    edge.source.port_name,
                    edge.target.node_id,
                    edge.target.port_name
                )));
            }
        }
    }
    let expected_all = fold_set.sample_ids.iter().cloned().collect::<BTreeSet<_>>();
    if all_samples != expected_all {
        return Err(DagMlError::OofValidation(format!(
            "edge `{}.{}` -> `{}.{}` OOF predictions do not cover the refit sample universe",
            edge.source.node_id, edge.source.port_name, edge.target.node_id, edge.target.port_name
        )));
    }
    Ok(())
}

pub(crate) fn validate_aggregated_oof_blocks_match_fold(
    edge: &EdgeSpec,
    fold_set: &FoldSet,
    relations: &SampleRelationSet,
    prediction_level: PredictionLevel,
    fold_id: &FoldId,
    blocks: &[&AggregatedPredictionBlock],
) -> Result<()> {
    let fold = fold_set
        .folds
        .iter()
        .find(|fold| &fold.fold_id == fold_id)
        .ok_or_else(|| {
            DagMlError::OofValidation(format!(
                "edge `{}.{}` -> `{}.{}` references unknown fold `{fold_id}`",
                edge.source.node_id,
                edge.source.port_name,
                edge.target.node_id,
                edge.target.port_name
            ))
        })?;
    validate_aggregated_fold_unit_safety(edge, relations, prediction_level, fold)?;
    for block in blocks {
        if block.fold_id.as_ref() != Some(fold_id) {
            return Err(DagMlError::OofValidation(format!(
                "edge `{}.{}` -> `{}.{}` selected aggregated OOF predictions outside fold `{fold_id}`",
                edge.source.node_id,
                edge.source.port_name,
                edge.target.node_id,
                edge.target.port_name
            )));
        }
    }
    let actual = collect_unique_aggregated_oof_units(edge, prediction_level, blocks)?;
    let expected = expected_prediction_units_for_samples(
        edge,
        relations,
        prediction_level,
        &fold.validation_sample_ids,
    )?;
    if actual != expected {
        return Err(DagMlError::OofValidation(format!(
            "edge `{}.{}` -> `{}.{}` aggregated OOF predictions do not match {:?} validation units for fold `{fold_id}`",
            edge.source.node_id,
            edge.source.port_name,
            edge.target.node_id,
            edge.target.port_name,
            prediction_level
        )));
    }
    Ok(())
}

pub(crate) fn validate_aggregated_oof_blocks_cover_fold_set(
    edge: &EdgeSpec,
    fold_set: &FoldSet,
    relations: &SampleRelationSet,
    prediction_level: PredictionLevel,
    blocks: &[&AggregatedPredictionBlock],
) -> Result<()> {
    let folds = fold_set
        .folds
        .iter()
        .map(|fold| (fold.fold_id.clone(), fold))
        .collect::<BTreeMap<_, _>>();
    let mut blocks_by_fold = BTreeMap::<FoldId, Vec<&AggregatedPredictionBlock>>::new();
    for block in blocks {
        let fold_id = block.fold_id.as_ref().ok_or_else(|| {
            DagMlError::OofValidation(format!(
                "edge `{}.{}` -> `{}.{}` has aggregated OOF predictions without a fold id",
                edge.source.node_id,
                edge.source.port_name,
                edge.target.node_id,
                edge.target.port_name
            ))
        })?;
        if !folds.contains_key(fold_id) {
            return Err(DagMlError::OofValidation(format!(
                "edge `{}.{}` -> `{}.{}` references unknown fold `{fold_id}`",
                edge.source.node_id,
                edge.source.port_name,
                edge.target.node_id,
                edge.target.port_name
            )));
        }
        blocks_by_fold
            .entry(fold_id.clone())
            .or_default()
            .push(*block);
    }
    for fold_id in folds.keys() {
        if !blocks_by_fold.contains_key(fold_id) {
            return Err(DagMlError::OofValidation(format!(
                "edge `{}.{}` -> `{}.{}` is missing aggregated OOF predictions for fold `{fold_id}`",
                edge.source.node_id,
                edge.source.port_name,
                edge.target.node_id,
                edge.target.port_name
            )));
        }
    }

    let mut all_units = BTreeSet::new();
    for (fold_id, fold_blocks) in blocks_by_fold {
        let fold = folds.get(&fold_id).expect("fold id was validated above");
        validate_aggregated_fold_unit_safety(edge, relations, prediction_level, fold)?;
        let fold_units = collect_unique_aggregated_oof_units(edge, prediction_level, &fold_blocks)?;
        let expected = expected_prediction_units_for_samples(
            edge,
            relations,
            prediction_level,
            &fold.validation_sample_ids,
        )?;
        if fold_units != expected {
            return Err(DagMlError::OofValidation(format!(
                "edge `{}.{}` -> `{}.{}` aggregated OOF predictions do not match {:?} validation units for fold `{fold_id}`",
                edge.source.node_id,
                edge.source.port_name,
                edge.target.node_id,
                edge.target.port_name,
                prediction_level
            )));
        }
        for unit_id in fold_units {
            // See `validate_oof_blocks_cover_fold_set`: Partition forbids a unit covered by two folds;
            // Resampled (ShuffleSplit / repeated CV) validates a unit in several folds and averages it,
            // so the across-fold duplicate is allowed while the universe-coverage check below still
            // requires every unit at least once.
            if !all_units.insert(unit_id.clone())
                && fold_set.partition_mode == FoldPartitionMode::Partition
            {
                return Err(DagMlError::OofValidation(format!(
                    "edge `{}.{}` -> `{}.{}` has duplicate aggregated OOF prediction for unit `{unit_id}`",
                    edge.source.node_id,
                    edge.source.port_name,
                    edge.target.node_id,
                    edge.target.port_name
                )));
            }
        }
    }

    let expected_all = expected_prediction_units_for_samples(
        edge,
        relations,
        prediction_level,
        &fold_set.sample_ids,
    )?;
    if all_units != expected_all {
        return Err(DagMlError::OofValidation(format!(
            "edge `{}.{}` -> `{}.{}` aggregated OOF predictions do not cover the refit {:?} unit universe",
            edge.source.node_id,
            edge.source.port_name,
            edge.target.node_id,
            edge.target.port_name,
            prediction_level
        )));
    }
    Ok(())
}

pub(crate) fn validate_aggregated_fold_unit_safety(
    edge: &EdgeSpec,
    relations: &SampleRelationSet,
    prediction_level: PredictionLevel,
    fold: &FoldAssignment,
) -> Result<()> {
    let train_units = expected_prediction_units_for_samples(
        edge,
        relations,
        prediction_level,
        &fold.train_sample_ids,
    )?;
    let validation_units = expected_prediction_units_for_samples(
        edge,
        relations,
        prediction_level,
        &fold.validation_sample_ids,
    )?;
    if let Some(unit_id) = train_units.intersection(&validation_units).next() {
        return Err(DagMlError::OofValidation(format!(
            "edge `{}.{}` -> `{}.{}` fold `{}` has {:?} unit `{unit_id}` in both train and validation partitions",
            edge.source.node_id,
            edge.source.port_name,
            edge.target.node_id,
            edge.target.port_name,
            fold.fold_id,
            prediction_level
        )));
    }
    Ok(())
}

pub(crate) fn collect_unique_oof_samples(
    edge: &EdgeSpec,
    blocks: &[&PredictionBlock],
) -> Result<BTreeSet<SampleId>> {
    let mut samples = BTreeSet::new();
    for block in blocks {
        if block.partition != PredictionPartition::Validation {
            return Err(DagMlError::OofValidation(format!(
                "edge `{}.{}` -> `{}.{}` selected non-validation predictions",
                edge.source.node_id,
                edge.source.port_name,
                edge.target.node_id,
                edge.target.port_name
            )));
        }
        for sample_id in &block.sample_ids {
            if !samples.insert(sample_id.clone()) {
                return Err(DagMlError::OofValidation(format!(
                    "edge `{}.{}` -> `{}.{}` has duplicate OOF prediction for sample `{sample_id}`",
                    edge.source.node_id,
                    edge.source.port_name,
                    edge.target.node_id,
                    edge.target.port_name
                )));
            }
        }
    }
    Ok(samples)
}

pub(crate) fn collect_unique_aggregated_oof_units(
    edge: &EdgeSpec,
    prediction_level: PredictionLevel,
    blocks: &[&AggregatedPredictionBlock],
) -> Result<BTreeSet<PredictionUnitId>> {
    let mut unit_ids = BTreeSet::new();
    for block in blocks {
        block.validate_shape()?;
        if block.partition != PredictionPartition::Validation {
            return Err(DagMlError::OofValidation(format!(
                "edge `{}.{}` -> `{}.{}` selected non-validation aggregated predictions",
                edge.source.node_id,
                edge.source.port_name,
                edge.target.node_id,
                edge.target.port_name
            )));
        }
        if block.level != prediction_level {
            return Err(DagMlError::OofValidation(format!(
                "edge `{}.{}` -> `{}.{}` selected {:?} aggregated predictions, expected {:?}",
                edge.source.node_id,
                edge.source.port_name,
                edge.target.node_id,
                edge.target.port_name,
                block.level,
                prediction_level
            )));
        }
        for unit_id in &block.unit_ids {
            if !unit_ids.insert(unit_id.clone()) {
                return Err(DagMlError::OofValidation(format!(
                    "edge `{}.{}` -> `{}.{}` has duplicate aggregated OOF prediction for unit `{unit_id}`",
                    edge.source.node_id,
                    edge.source.port_name,
                    edge.target.node_id,
                    edge.target.port_name
                )));
            }
        }
    }
    Ok(unit_ids)
}

pub(crate) fn expected_prediction_units_for_samples(
    edge: &EdgeSpec,
    relations: &SampleRelationSet,
    prediction_level: PredictionLevel,
    sample_ids: &[SampleId],
) -> Result<BTreeSet<PredictionUnitId>> {
    sample_ids
        .iter()
        .map(|sample_id| prediction_unit_for_sample(edge, relations, prediction_level, sample_id))
        .collect()
}

pub(crate) fn prediction_unit_for_sample(
    edge: &EdgeSpec,
    relations: &SampleRelationSet,
    prediction_level: PredictionLevel,
    sample_id: &SampleId,
) -> Result<PredictionUnitId> {
    match prediction_level {
        PredictionLevel::Sample => Ok(PredictionUnitId::Sample(sample_id.clone())),
        PredictionLevel::Target => relations
            .target_for_sample(sample_id)
            .cloned()
            .map(PredictionUnitId::Target)
            .ok_or_else(|| {
                DagMlError::OofValidation(format!(
                    "edge `{}.{}` -> `{}.{}` needs target-level OOF predictions but sample `{sample_id}` has no target relation",
                    edge.source.node_id,
                    edge.source.port_name,
                    edge.target.node_id,
                    edge.target.port_name
                ))
            }),
        PredictionLevel::Group => relations
            .group_for_sample(sample_id)
            .cloned()
            .map(PredictionUnitId::Group)
            .ok_or_else(|| {
                DagMlError::OofValidation(format!(
                    "edge `{}.{}` -> `{}.{}` needs group-level OOF predictions but sample `{sample_id}` has no group relation",
                    edge.source.node_id,
                    edge.source.port_name,
                    edge.target.node_id,
                    edge.target.port_name
                ))
            }),
        PredictionLevel::Observation => Err(DagMlError::OofValidation(format!(
            "edge `{}.{}` -> `{}.{}` cannot consume observation-level OOF predictions from sample folds",
            edge.source.node_id, edge.source.port_name, edge.target.node_id, edge.target.port_name
        ))),
    }
}

pub(crate) fn deterministic_oof_handle(
    plan: &ExecutionPlan,
    edge: &EdgeSpec,
    ctx: &RunContext,
    scope: &PhaseScope,
) -> Result<u64> {
    let fingerprint = stable_json_fingerprint(&(
        &plan.id,
        &ctx.run_id,
        &edge.source.node_id,
        &edge.source.port_name,
        &edge.target.node_id,
        &edge.target.port_name,
        scope.phase,
        &scope.variant_id,
        &scope.fold_id,
    ))?;
    Ok(u64::from_str_radix(&fingerprint[..16], 16).expect("sha256 hex prefix should fit into u64"))
}
