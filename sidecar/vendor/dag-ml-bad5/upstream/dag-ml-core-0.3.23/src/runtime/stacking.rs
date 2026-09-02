//! Scheduler-owned planning for nested prediction stacking.
//!
//! A stacking meta-model must train on OOF rows built inside an outer fold's
//! training universe, then predict that outer fold's validation universe.  This
//! module describes those scopes before the scheduler materializes any data.

use super::*;

pub(crate) const NESTED_STACKING_EXECUTION_METADATA_KEY: &str = "stacking_oof_execution";
pub(crate) const NESTED_STACKING_EXECUTION_V1: &str = "nested_oof_v1";

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct NestedStackingOuterScope {
    pub(crate) outer_fold_id: FoldId,
    pub(crate) inner: crate::fold::NestedFoldSet,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct NestedStackingCampaignPlan {
    pub(crate) meta_node_id: NodeId,
    /// Every dependency needed to produce base predictions for either the
    /// inner or outer scope. The meta node itself is deliberately excluded.
    pub(crate) base_node_ids: BTreeSet<NodeId>,
    pub(crate) outer_scopes: Vec<NestedStackingOuterScope>,
}

/// Per-outer-fold evidence made available only while the scheduler invokes the
/// declared stacking meta node.  The generic OOF collector first obtains the
/// outer-validation blocks, then this scope atomically replaces the ordinary
/// training inputs with inner-fold OOF and keeps the outer blocks under the
/// explicit `:outer` delivery key.
pub(crate) struct NestedStackingInput<'a> {
    pub(crate) meta_node_id: &'a NodeId,
    pub(crate) inner: &'a crate::fold::NestedFoldSet,
}

/// Whether one graph node opted into the exact V1 nested-stacking contract.
/// Parsing the metadata in one place makes unsupported/non-string values fail
/// in FIT_CV and REFIT alike, rather than only when a campaign is first
/// planned.
pub(crate) fn is_nested_stacking_meta_node(plan: &ExecutionPlan, node_id: &NodeId) -> Result<bool> {
    let node = plan
        .graph_plan
        .graph
        .nodes
        .iter()
        .find(|node| node.id == *node_id)
        .ok_or_else(|| {
            DagMlError::RuntimeValidation(format!(
                "nested stacking node `{node_id}` is absent from the execution graph"
            ))
        })?;
    let Some(value) = node.metadata.get(NESTED_STACKING_EXECUTION_METADATA_KEY) else {
        return Ok(false);
    };
    let Some(value) = value.as_str() else {
        return Err(DagMlError::RuntimeValidation(format!(
            "node `{}` has non-string `{NESTED_STACKING_EXECUTION_METADATA_KEY}` metadata",
            node.id
        )));
    };
    if value != NESTED_STACKING_EXECUTION_V1 {
        return Err(DagMlError::RuntimeValidation(format!(
            "node `{}` declares unsupported `{NESTED_STACKING_EXECUTION_METADATA_KEY}` value `{value}`",
            node.id
        )));
    }
    Ok(true)
}

/// Return the explicit nested-stacking schedule declared by `plan`.
///
/// No ordinary `requires_oof` edge opts into this path implicitly: its target
/// graph node must carry [`NESTED_STACKING_EXECUTION_METADATA_KEY`] with the
/// exact V1 value. That prevents an old stacking graph from silently changing
/// CV semantics when nested execution is introduced.
pub(crate) fn nested_stacking_campaign_plan(
    plan: &ExecutionPlan,
) -> Result<Option<NestedStackingCampaignPlan>> {
    let mut requested = Vec::new();
    for node in &plan.graph_plan.graph.nodes {
        if is_nested_stacking_meta_node(plan, &node.id)? {
            requested.push(node.id.clone());
        }
    }
    if requested.is_empty() {
        return Ok(None);
    }
    if requested.len() != 1 {
        return Err(DagMlError::RuntimeValidation(
            "nested stacking V1 supports exactly one declared meta node per execution plan"
                .to_string(),
        ));
    }
    let meta_node_id = requested.pop().expect("checked non-empty singleton");
    let meta_plan = plan.node_plans.get(&meta_node_id).ok_or_else(|| {
        DagMlError::RuntimeValidation(format!(
            "nested stacking meta node `{meta_node_id}` has no execution plan"
        ))
    })?;
    if !meta_plan.supported_phases.contains(&Phase::FitCv) {
        return Err(DagMlError::RuntimeValidation(format!(
            "nested stacking meta node `{meta_node_id}` does not support FIT_CV"
        )));
    }

    let oof_sources = plan
        .graph_plan
        .graph
        .edges
        .iter()
        .filter(|edge| edge.target.node_id == meta_node_id && edge.contract.requires_oof)
        .map(|edge| edge.source.node_id.clone())
        .collect::<BTreeSet<_>>();
    if oof_sources.len() < 2 {
        return Err(DagMlError::RuntimeValidation(format!(
            "nested stacking meta node `{meta_node_id}` requires at least two OOF base producers"
        )));
    }
    if plan
        .graph_plan
        .graph
        .edges
        .iter()
        .any(|edge| edge.target.node_id == meta_node_id && !edge.contract.requires_oof)
    {
        return Err(DagMlError::RuntimeValidation(format!(
            "nested stacking meta node `{meta_node_id}` has a non-OOF graph input; V1 accepts only explicit OOF base edges"
        )));
    }
    let base_node_ids = dependency_closure(plan, &oof_sources);
    if base_node_ids.contains(&meta_node_id) {
        return Err(DagMlError::RuntimeValidation(format!(
            "nested stacking meta node `{meta_node_id}` is in its base dependency closure"
        )));
    }

    let fold_set = plan.fold_set.as_ref().ok_or_else(|| {
        DagMlError::RuntimeValidation(
            "nested stacking requires an attested outer fold set".to_string(),
        )
    })?;
    if fold_set.partition_mode != FoldPartitionMode::Partition {
        return Err(DagMlError::RuntimeValidation(
            "nested stacking V1 requires a partitioned outer fold set".to_string(),
        ));
    }
    let inner_spec =
        crate::fold::resolve_inner_cv(meta_plan.inner_cv.as_ref(), plan.campaign.inner_cv.as_ref())
            .ok_or_else(|| {
                DagMlError::RuntimeValidation(format!(
                    "nested stacking meta node `{meta_node_id}` has no inner_cv policy"
                ))
            })?;
    let outer_scopes = fold_set
        .folds
        .iter()
        .map(|outer| {
            Ok(NestedStackingOuterScope {
                outer_fold_id: outer.fold_id.clone(),
                inner: inner_spec.build_nested_fold_set(outer, &fold_set.sample_groups)?,
            })
        })
        .collect::<Result<Vec<_>>>()?;
    if outer_scopes.is_empty() {
        return Err(DagMlError::RuntimeValidation(
            "nested stacking requires at least one outer fold".to_string(),
        ));
    }
    Ok(Some(NestedStackingCampaignPlan {
        meta_node_id,
        base_node_ids,
        outer_scopes,
    }))
}

/// Replace the generic outer-fold OOF inputs for a nested stacking meta-node
/// with exact inner-OOF training inputs, retaining the original outer blocks
/// under `:outer` exclusively for evaluation.  No averaging/imputation is
/// permitted: every outer-train sample must occur exactly once in every base
/// producer's inner OOF evidence.
pub(crate) fn replace_nested_stacking_fit_cv_inputs(
    plan: &ExecutionPlan,
    node_plan: &NodePlan,
    ctx: &RunContext,
    scope: &PhaseScope,
    nested: &NestedStackingInput<'_>,
    handles: &mut BTreeMap<String, HandleRef>,
    prediction_inputs: &mut BTreeMap<String, PredictionInputSpec>,
) -> Result<()> {
    if scope.phase != Phase::FitCv || &node_plan.node_id != nested.meta_node_id {
        return Ok(());
    }
    if scope.fold_id.as_ref() != Some(&nested.inner.parent_outer_fold_id) {
        return Err(DagMlError::RuntimeValidation(format!(
            "nested stacking meta node `{}` received outer fold {:?}, expected `{}`",
            node_plan.node_id, scope.fold_id, nested.inner.parent_outer_fold_id
        )));
    }
    nested.inner.validate_for_outer(
        plan.fold_set
            .as_ref()
            .ok_or_else(|| {
                DagMlError::RuntimeValidation("nested stacking has no outer fold set".to_string())
            })?
            .folds
            .iter()
            .find(|fold| fold.fold_id == nested.inner.parent_outer_fold_id)
            .ok_or_else(|| {
                DagMlError::RuntimeValidation(format!(
                    "nested stacking parent fold `{}` is absent from the plan",
                    nested.inner.parent_outer_fold_id
                ))
            })?,
    )?;
    let outer = plan
        .fold_set
        .as_ref()
        .expect("checked above")
        .folds
        .iter()
        .find(|fold| fold.fold_id == nested.inner.parent_outer_fold_id)
        .expect("checked above");
    let expected_samples = outer
        .train_sample_ids
        .iter()
        .cloned()
        .collect::<BTreeSet<_>>();
    let inner_fold_ids = nested
        .inner
        .inner_fold_set
        .folds
        .iter()
        .map(|fold| fold.fold_id.clone())
        .collect::<BTreeSet<_>>();

    for edge in incoming_oof_edges(plan, node_plan)? {
        let base_key = format!("{}.{}", edge.source.node_id, edge.source.port_name);
        let outer_input = prediction_inputs.remove(&base_key).ok_or_else(|| {
            DagMlError::OofValidation(format!(
                "nested stacking meta node `{}` has no outer OOF input `{base_key}`",
                node_plan.node_id
            ))
        })?;
        let outer_handle = handles.remove(&base_key).ok_or_else(|| {
            DagMlError::RuntimeValidation(format!(
                "nested stacking meta node `{}` has no outer OOF handle `{base_key}`",
                node_plan.node_id
            ))
        })?;
        let outer_key = format!("{base_key}:outer");
        if handles.insert(outer_key.clone(), outer_handle).is_some()
            || prediction_inputs
                .insert(outer_key.clone(), outer_input)
                .is_some()
        {
            return Err(DagMlError::RuntimeValidation(format!(
                "nested stacking meta node `{}` received duplicate outer OOF key `{outer_key}`",
                node_plan.node_id
            )));
        }

        let raw_blocks = ctx
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
                    .is_some_and(|fold_id| inner_fold_ids.contains(fold_id))
            });
        let inner_blocks = filter_prediction_blocks_for_edge_source_port(plan, edge, raw_blocks)?;
        if inner_blocks.is_empty() {
            return Err(DagMlError::OofValidation(format!(
                "nested stacking meta node `{}` has no inner OOF evidence for `{}`.{}",
                node_plan.node_id, edge.source.node_id, edge.source.port_name
            )));
        }
        let input = prediction_input_spec(edge, scope, &inner_blocks, false)?;
        let actual_samples = input.sample_ids.iter().cloned().collect::<BTreeSet<_>>();
        if actual_samples != expected_samples {
            return Err(DagMlError::OofValidation(format!(
                "nested stacking inner OOF for `{}.{}` does not exactly cover outer-train samples of fold `{}`",
                edge.source.node_id, edge.source.port_name, nested.inner.parent_outer_fold_id
            )));
        }
        if input.fold_ids != inner_fold_ids.iter().cloned().collect::<Vec<_>>() {
            return Err(DagMlError::OofValidation(format!(
                "nested stacking inner OOF for `{}.{}` does not contain exactly one block for every inner fold",
                edge.source.node_id, edge.source.port_name
            )));
        }
        let source_plan = plan
            .node_plans
            .get(&edge.source.node_id)
            .expect("execution plan validates edge sources");
        let handle_fingerprint = stable_json_fingerprint(&(
            "nested-stacking-inner-oof-v1",
            &plan.id,
            &ctx.run_id,
            &edge.source.node_id,
            &edge.source.port_name,
            &edge.target.node_id,
            &edge.target.port_name,
            &nested.inner.parent_outer_fold_id,
            &nested.inner.inner_fold_set.id,
            &scope.variant_id,
        ))?;
        let handle = HandleRef {
            handle: u64::from_str_radix(&handle_fingerprint[..16], 16)
                .expect("sha256 hex prefix should fit into u64"),
            kind: HandleKind::Prediction,
            owner_controller: source_plan.controller_id.clone(),
        };
        if handles.insert(base_key.clone(), handle).is_some()
            || prediction_inputs.insert(base_key.clone(), input).is_some()
        {
            return Err(DagMlError::RuntimeValidation(format!(
                "nested stacking meta node `{}` received duplicate inner OOF key `{base_key}`",
                node_plan.node_id
            )));
        }
    }
    Ok(())
}

fn dependency_closure(plan: &ExecutionPlan, seeds: &BTreeSet<NodeId>) -> BTreeSet<NodeId> {
    let mut closure = seeds.clone();
    let mut pending = seeds.iter().cloned().collect::<Vec<_>>();
    while let Some(node_id) = pending.pop() {
        for edge in plan
            .graph_plan
            .graph
            .edges
            .iter()
            .filter(|edge| edge.target.node_id == node_id)
        {
            if closure.insert(edge.source.node_id.clone()) {
                pending.push(edge.source.node_id.clone());
            }
        }
    }
    closure
}
