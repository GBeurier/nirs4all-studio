//! Scheduler-owned planning for nested prediction stacking.
//!
//! A stacking meta-model must train on OOF rows built inside an outer fold's
//! training universe, then predict that outer fold's validation universe.  This
//! module describes those scopes before the scheduler materializes any data.

use super::*;

pub(crate) const NESTED_STACKING_EXECUTION_METADATA_KEY: &str = "stacking_oof_execution";
pub(crate) const NESTED_STACKING_EXECUTION_V1: &str = "nested_oof_v1";
pub(crate) const STACKING_REFIT_OOF_METADATA_KEY: &str = "stacking_refit_oof";
pub(crate) const STACKING_REFIT_PARTITIONED_INNER_V1: &str = "partitioned_inner_v1";
pub(crate) const RESIDUAL_TARGET_EXECUTION_METADATA_KEY: &str = "residual_target_execution";
pub(crate) const RESIDUAL_TARGET_EXECUTION_V1: &str = "nested_oof_v1";

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum NestedMetaKind {
    Stacking,
    Residual,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct NestedStackingOuterScope {
    pub(crate) outer_fold_id: FoldId,
    pub(crate) inner: crate::fold::NestedFoldSet,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct NestedStackingCampaignPlan {
    pub(crate) meta_node_id: NodeId,
    pub(crate) kind: NestedMetaKind,
    /// The resolved policy used by every nested scope in this campaign.
    pub(crate) inner_cv: crate::fold::NestedCvSpec,
    /// Every dependency needed to produce base predictions for either the
    /// inner or outer scope. The meta node itself is deliberately excluded.
    pub(crate) base_node_ids: BTreeSet<NodeId>,
    /// Data-only dependencies to materialize again when a residual learner is
    /// scheduled separately from its base OOF producer.
    pub(crate) meta_data_node_ids: BTreeSet<NodeId>,
    pub(crate) outer_scopes: Vec<NestedStackingOuterScope>,
    /// Explicit, independently partitioned OOF preparation for meta REFIT.
    /// These folds never contribute to report-grade outer CV scores.
    pub(crate) refit_fold_set: Option<FoldSet>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct PredictionFeatureJoinPlan {
    pub(crate) join_node_id: NodeId,
    /// All ancestors that must run once per lower-level fold before the join.
    pub(crate) source_node_ids: BTreeSet<NodeId>,
    /// Base prediction producers after the joined Data output is cached.
    pub(crate) downstream_node_ids: BTreeSet<NodeId>,
}

#[derive(Clone, Debug)]
struct CapacityRequirements {
    base: Vec<(NodeId, usize)>,
    source: Vec<(NodeId, usize)>,
    learner: Vec<(NodeId, usize)>,
    auto_gate: bool,
    prediction_join: bool,
}

fn declared_fit_capacity(
    plan: &ExecutionPlan,
    node_ids: &BTreeSet<NodeId>,
) -> Result<Vec<(NodeId, usize)>> {
    let mut requirements = Vec::new();
    for node_id in node_ids {
        let node = plan
            .graph_plan
            .graph
            .nodes
            .iter()
            .find(|node| node.id == *node_id)
            .expect("validated graph node");
        if node.kind != NodeKind::Model {
            continue;
        }
        let minimum = node
            .metadata
            .get("fit_capacity")
            .and_then(serde_json::Value::as_object)
            .and_then(|hint| hint.get("min_fit_samples"))
            .and_then(serde_json::Value::as_u64)
            .filter(|value| *value > 0)
            .and_then(|value| usize::try_from(value).ok())
            .ok_or_else(|| {
                DagMlError::RuntimeValidation(format!(
                    "capacity KFold requires model `{node_id}` metadata.fit_capacity.min_fit_samples >= 1"
                ))
            })?;
        requirements.push((node_id.clone(), minimum));
    }
    Ok(requirements)
}

fn check_fit_capacity(
    requirements: &[(NodeId, usize)],
    fit_rows: usize,
    scope: &str,
) -> Result<()> {
    for (node_id, minimum) in requirements {
        if fit_rows < *minimum {
            return Err(DagMlError::RuntimeValidation(format!(
                "capacity KFold model `{node_id}` has {fit_rows} fit samples in `{scope}`; requires at least {minimum}"
            )));
        }
    }
    Ok(())
}

fn check_prediction_join_capacity(
    policy: &crate::fold::NestedCvSpec,
    parent_set: &FoldSet,
    parent: &FoldAssignment,
    requirements: &CapacityRequirements,
) -> Result<()> {
    if !requirements.prediction_join {
        return Ok(());
    }
    check_fit_capacity(
        &requirements.source,
        parent.train_sample_ids.len(),
        "prediction source parent",
    )?;
    let source_oof = parent_set.nested_fold_set(policy, parent)?;
    for source_fold in &source_oof.inner_fold_set.folds {
        check_fit_capacity(
            &requirements.source,
            source_fold.train_sample_ids.len(),
            "prediction source OOF",
        )?;
    }
    Ok(())
}

fn check_capacity_scopes(
    policy: &crate::fold::NestedCvSpec,
    parent_set: &FoldSet,
    parent: &FoldAssignment,
    requirements: &CapacityRequirements,
) -> Result<()> {
    check_fit_capacity(
        &requirements.base,
        parent.train_sample_ids.len(),
        "outer base",
    )?;
    check_fit_capacity(
        &requirements.learner,
        parent.train_sample_ids.len(),
        "outer learner",
    )?;
    check_prediction_join_capacity(policy, parent_set, parent, requirements)?;

    let residual_oof = parent_set.nested_fold_set(policy, parent)?;
    for residual_fold in &residual_oof.inner_fold_set.folds {
        check_fit_capacity(
            &requirements.base,
            residual_fold.train_sample_ids.len(),
            "residual base OOF",
        )?;
        check_prediction_join_capacity(
            policy,
            &residual_oof.inner_fold_set,
            residual_fold,
            requirements,
        )?;
        if requirements.auto_gate {
            check_fit_capacity(
                &requirements.learner,
                residual_fold.train_sample_ids.len(),
                "automatic-gate learner",
            )?;
            let gate_oof = residual_oof
                .inner_fold_set
                .nested_fold_set(policy, residual_fold)?;
            for gate_fold in &gate_oof.inner_fold_set.folds {
                check_fit_capacity(
                    &requirements.base,
                    gate_fold.train_sample_ids.len(),
                    "automatic-gate base OOF",
                )?;
                check_prediction_join_capacity(
                    policy,
                    &gate_oof.inner_fold_set,
                    gate_fold,
                    requirements,
                )?;
            }
        }
    }
    Ok(())
}

fn resolve_capacity_kfold(
    requested: &crate::fold::CapacityKFoldSpec,
    fold_set: &FoldSet,
    requirements: &CapacityRequirements,
) -> Result<crate::fold::NestedCvSpec> {
    if !fold_set.sample_groups.is_empty() {
        return Err(DagMlError::RuntimeValidation(
            "capacity KFold does not support grouped samples; declare a group-aware inner CV policy"
                .to_string(),
        ));
    }
    let mut last_error = String::new();
    let max_splits = fold_set
        .folds
        .iter()
        .map(|fold| fold.train_sample_ids.len())
        .chain(std::iter::once(fold_set.sample_ids.len()))
        .min()
        .unwrap_or(0)
        .min(requested.max_splits);
    for splits in requested.min_splits..=max_splits {
        let policy = crate::fold::NestedCvSpec::KFold(crate::fold::KFoldSpec {
            n_splits: splits,
            shuffle: requested.shuffle,
            seed: requested.seed,
        });
        let attempt = (|| {
            for outer in &fold_set.folds {
                check_capacity_scopes(&policy, fold_set, outer, requirements)?;
            }
            let full_train = FoldAssignment {
                fold_id: FoldId::new("capacity.refit")?,
                train_sample_ids: fold_set.sample_ids.clone(),
                validation_sample_ids: Vec::new(),
                metadata: BTreeMap::new(),
            };
            check_capacity_scopes(&policy, fold_set, &full_train, requirements)
        })();
        match attempt {
            Ok(()) => return Ok(policy),
            Err(error) => last_error = error.to_string(),
        }
    }
    Err(DagMlError::RuntimeValidation(format!(
        "capacity KFold found no feasible split count in {}..={}: {last_error}",
        requested.min_splits, requested.max_splits
    )))
}

pub(crate) fn prediction_feature_join_plan(
    plan: &ExecutionPlan,
    nested: &NestedStackingCampaignPlan,
) -> Result<Option<PredictionFeatureJoinPlan>> {
    let joins = plan
        .graph_plan
        .graph
        .nodes
        .iter()
        .filter(|node| {
            nested.base_node_ids.contains(&node.id)
                && node.kind == NodeKind::PredictionJoin
                && node
                    .metadata
                    .get("prediction_feature_execution")
                    .and_then(serde_json::Value::as_str)
                    == Some("native_oof_v1")
        })
        .collect::<Vec<_>>();
    if joins.is_empty() {
        return Ok(None);
    }
    if joins.len() != 1 {
        return Err(DagMlError::RuntimeValidation(
            "nested prediction-feature execution currently requires one join node".to_string(),
        ));
    }
    let join = joins[0];
    let sources = plan
        .graph_plan
        .graph
        .edges
        .iter()
        .filter(|edge| edge.target.node_id == join.id && edge.contract.requires_oof)
        .map(|edge| edge.source.node_id.clone())
        .collect::<BTreeSet<_>>();
    if sources.is_empty() {
        return Err(DagMlError::RuntimeValidation(format!(
            "prediction feature join `{}` needs OOF source models",
            join.id
        )));
    }
    let source_node_ids = dependency_closure(plan, &sources);
    if source_node_ids.contains(&join.id) {
        return Err(DagMlError::RuntimeValidation(format!(
            "prediction feature join `{}` depends on itself",
            join.id
        )));
    }
    let downstream_node_ids = nested
        .base_node_ids
        .difference(&source_node_ids)
        .filter(|node_id| **node_id != join.id)
        .cloned()
        .collect::<BTreeSet<_>>();
    if downstream_node_ids.is_empty()
        || !plan.graph_plan.graph.edges.iter().any(|edge| {
            edge.source.node_id == join.id
                && edge.contract.kind == PortKind::Data
                && downstream_node_ids.contains(&edge.target.node_id)
        })
    {
        return Err(DagMlError::RuntimeValidation(format!(
            "prediction feature join `{}` must feed a downstream base model through Data",
            join.id
        )));
    }
    Ok(Some(PredictionFeatureJoinPlan {
        join_node_id: join.id.clone(),
        source_node_ids,
        downstream_node_ids,
    }))
}

/// Re-entering a parent scope must reuse, not rerun, its already-attested
/// branch OOF blocks: duplicate producer/fold lineage is ambiguous evidence.
pub(crate) fn prediction_feature_sources_ready(
    plan: &ExecutionPlan,
    join: &PredictionFeatureJoinPlan,
    ctx: &RunContext,
    fold_id: &FoldId,
) -> Result<bool> {
    let mut present = 0usize;
    let mut total = 0usize;
    for edge in plan
        .graph_plan
        .graph
        .edges
        .iter()
        .filter(|edge| edge.target.node_id == join.join_node_id && edge.contract.requires_oof)
    {
        total += 1;
        let raw = ctx.prediction_store.find(
            Some(&edge.source.node_id),
            Some(&PredictionPartition::Validation),
            Some(fold_id),
        );
        let blocks = filter_prediction_blocks_for_edge_source_port(plan, edge, raw)?;
        if blocks.len() > 1 {
            return Err(DagMlError::OofValidation(format!(
                "prediction feature join `{}` found duplicate source `{}.{}` evidence for fold `{fold_id}`",
                join.join_node_id, edge.source.node_id, edge.source.port_name
            )));
        }
        present += blocks.len();
    }
    if present != 0 && present != total {
        return Err(DagMlError::OofValidation(format!(
            "prediction feature join `{}` has partial source evidence for fold `{fold_id}`",
            join.join_node_id
        )));
    }
    Ok(present == total)
}

/// Per-outer-fold evidence made available only while the scheduler invokes the
/// declared stacking meta node.  The generic OOF collector first obtains the
/// outer-validation blocks, then this scope atomically replaces the ordinary
/// training inputs with inner-fold OOF and keeps the outer blocks under the
/// explicit `:outer` delivery key.
pub(crate) struct NestedStackingInput<'a> {
    pub(crate) meta_node_id: &'a NodeId,
    pub(crate) inner: &'a crate::fold::NestedFoldSet,
    pub(crate) parent_fold_set: &'a FoldSet,
    pub(crate) kind: NestedMetaKind,
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
    let stacking = node.metadata.get(NESTED_STACKING_EXECUTION_METADATA_KEY);
    let residual = node.metadata.get(RESIDUAL_TARGET_EXECUTION_METADATA_KEY);
    if stacking.is_some() && residual.is_some() {
        return Err(DagMlError::RuntimeValidation(format!(
            "node `{node_id}` cannot declare both nested stacking and residual targets"
        )));
    }
    let Some(value) = stacking.or(residual) else {
        return Ok(false);
    };
    let (key, expected) = if stacking.is_some() {
        (
            NESTED_STACKING_EXECUTION_METADATA_KEY,
            NESTED_STACKING_EXECUTION_V1,
        )
    } else {
        (
            RESIDUAL_TARGET_EXECUTION_METADATA_KEY,
            RESIDUAL_TARGET_EXECUTION_V1,
        )
    };
    let Some(value) = value.as_str() else {
        return Err(DagMlError::RuntimeValidation(format!(
            "node `{}` has non-string `{key}` metadata",
            node.id
        )));
    };
    if value != expected {
        return Err(DagMlError::RuntimeValidation(format!(
            "node `{}` declares unsupported `{key}` value `{value}`",
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
    let mut plans = nested_stacking_campaign_plans(plan)?;
    if plans.len() > 1 {
        return Err(DagMlError::RuntimeValidation(
            "this single-output operation requires one terminal meta node".to_string(),
        ));
    }
    Ok(plans.pop())
}

/// Independent terminal meta nodes are separate report-grade outputs of one
/// graph. Each keeps its own nested OOF campaign and REFIT preparation; a
/// terminal never silently wins merely because it appears last in the DSL.
pub(crate) fn nested_stacking_campaign_plans(
    plan: &ExecutionPlan,
) -> Result<Vec<NestedStackingCampaignPlan>> {
    let mut requested = Vec::new();
    for node in &plan.graph_plan.graph.nodes {
        if is_nested_stacking_meta_node(plan, &node.id)? {
            requested.push(node.id.clone());
        }
    }
    if requested.is_empty() {
        return Ok(Vec::new());
    }
    let terminal = requested
        .iter()
        .filter(|candidate| {
            !requested.iter().any(|other| {
                other != *candidate
                    && dependency_closure(plan, &BTreeSet::from([other.clone()]))
                        .contains(*candidate)
            })
        })
        .cloned()
        .collect::<Vec<_>>();
    terminal
        .into_iter()
        .map(|node_id| {
            nested_stacking_campaign_plan_for_node(plan, node_id)
                .map(|campaign| campaign.expect("terminal is a validated meta node"))
        })
        .collect()
}

pub(crate) fn nested_stacking_campaign_plan_for_node(
    plan: &ExecutionPlan,
    meta_node_id: NodeId,
) -> Result<Option<NestedStackingCampaignPlan>> {
    if !is_nested_stacking_meta_node(plan, &meta_node_id)? {
        return Ok(None);
    }
    let kind = if plan
        .graph_plan
        .graph
        .nodes
        .iter()
        .find(|node| node.id == meta_node_id)
        .expect("validated meta node")
        .metadata
        .contains_key(RESIDUAL_TARGET_EXECUTION_METADATA_KEY)
    {
        NestedMetaKind::Residual
    } else {
        NestedMetaKind::Stacking
    };
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
    if (kind == NestedMetaKind::Stacking && oof_sources.is_empty())
        || (kind == NestedMetaKind::Residual && oof_sources.len() != 1)
    {
        return Err(DagMlError::RuntimeValidation(format!(
            "nested {:?} meta node `{meta_node_id}` requires {} OOF base producer(s)",
            kind,
            if kind == NestedMetaKind::Stacking {
                "at least one"
            } else {
                "exactly one"
            },
        )));
    }
    if plan.graph_plan.graph.edges.iter().any(|edge| {
        edge.target.node_id == meta_node_id
            && !edge.contract.requires_oof
            && (kind == NestedMetaKind::Stacking || edge.contract.kind != PortKind::Data)
    }) {
        return Err(DagMlError::RuntimeValidation(format!(
            "nested {:?} meta node `{meta_node_id}` has an unsupported non-OOF graph input",
            kind,
        )));
    }
    let base_node_ids = dependency_closure(plan, &oof_sources);
    if base_node_ids.contains(&meta_node_id) {
        return Err(DagMlError::RuntimeValidation(format!(
            "nested stacking meta node `{meta_node_id}` is in its base dependency closure"
        )));
    }
    let data_sources = plan
        .graph_plan
        .graph
        .edges
        .iter()
        .filter(|edge| {
            edge.target.node_id == meta_node_id
                && edge.contract.kind == PortKind::Data
                && !edge.contract.requires_oof
        })
        .map(|edge| edge.source.node_id.clone())
        .collect::<BTreeSet<_>>();
    let meta_data_node_ids = if kind == NestedMetaKind::Residual {
        dependency_closure(plan, &data_sources)
    } else {
        BTreeSet::new()
    };
    if meta_data_node_ids.contains(&meta_node_id) {
        return Err(DagMlError::RuntimeValidation(format!(
            "residual learner `{meta_node_id}` is in its own data dependency closure"
        )));
    }

    let fold_set = plan.fold_set.as_ref().ok_or_else(|| {
        DagMlError::RuntimeValidation(
            "nested stacking requires an attested outer fold set".to_string(),
        )
    })?;
    let requested_inner_cv =
        crate::fold::resolve_inner_cv(meta_plan.inner_cv.as_ref(), plan.campaign.inner_cv.as_ref())
            .ok_or_else(|| {
                DagMlError::RuntimeValidation(format!(
                    "nested stacking meta node `{meta_node_id}` has no inner_cv policy"
                ))
            })?;
    let inner_spec = match requested_inner_cv {
        crate::fold::NestedCvSpec::CapacityKFold(requested) => {
            if kind != NestedMetaKind::Residual {
                return Err(DagMlError::RuntimeValidation(
                    "capacity KFold currently supports residual meta nodes only".to_string(),
                ));
            }
            for node_id in &base_node_ids {
                if is_nested_stacking_meta_node(plan, node_id)? {
                    return Err(DagMlError::RuntimeValidation(
                        "capacity KFold does not yet support dependent meta nodes".to_string(),
                    ));
                }
            }
            let provisional = NestedStackingCampaignPlan {
                meta_node_id: meta_node_id.clone(),
                kind,
                inner_cv: requested_inner_cv.clone(),
                base_node_ids: base_node_ids.clone(),
                meta_data_node_ids: meta_data_node_ids.clone(),
                outer_scopes: Vec::new(),
                refit_fold_set: None,
            };
            let join = prediction_feature_join_plan(plan, &provisional)?;
            let (base_nodes, source_nodes) = if let Some(join) = &join {
                (
                    join.downstream_node_ids.clone(),
                    join.source_node_ids.clone(),
                )
            } else {
                (base_node_ids.clone(), BTreeSet::new())
            };
            let meta_node = plan
                .graph_plan
                .graph
                .nodes
                .iter()
                .find(|node| node.id == meta_node_id)
                .expect("validated meta node");
            let requirements = CapacityRequirements {
                base: declared_fit_capacity(plan, &base_nodes)?,
                source: declared_fit_capacity(plan, &source_nodes)?,
                learner: declared_fit_capacity(plan, &BTreeSet::from([meta_node_id.clone()]))?,
                auto_gate: meta_node
                    .metadata
                    .get("residual_gate")
                    .and_then(serde_json::Value::as_str)
                    == Some("auto"),
                prediction_join: join.is_some(),
            };
            resolve_capacity_kfold(requested, fold_set, &requirements)?
        }
        fixed => fixed.clone(),
    };
    let outer_scopes = fold_set
        .folds
        .iter()
        .map(|outer| {
            Ok(NestedStackingOuterScope {
                outer_fold_id: outer.fold_id.clone(),
                inner: fold_set.nested_fold_set(&inner_spec, outer)?,
            })
        })
        .collect::<Result<Vec<_>>>()?;
    if outer_scopes.is_empty() {
        return Err(DagMlError::RuntimeValidation(
            "nested stacking requires at least one outer fold".to_string(),
        ));
    }
    let meta_node = plan
        .graph_plan
        .graph
        .nodes
        .iter()
        .find(|node| node.id == meta_node_id)
        .expect("validated meta node");
    let refit_fold_set = match meta_node.metadata.get(STACKING_REFIT_OOF_METADATA_KEY) {
        None => None,
        Some(value) if value.as_str() == Some(STACKING_REFIT_PARTITIONED_INNER_V1) => {
            let root_fold_id = if plan
                .campaign
                .split_invocation
                .as_ref()
                .and_then(|split| split.fold_set.as_ref())
                .is_some_and(|root| root.id == fold_set.id)
                && !fold_set
                    .folds
                    .iter()
                    .any(|fold| fold.fold_id.as_str().starts_with("stacking.refit"))
            {
                "stacking.refit".to_string()
            } else {
                // Recursive FIT_CV can enter a parent-bound inner or REFIT
                // fold set. Its optional REFIT namespace must never collide
                // with folds already serving as this invocation's outer CV.
                format!(
                    "stacking.refit:{}",
                    &stable_json_fingerprint(&fold_set.id)?[..12]
                )
            };
            let full_train = crate::fold::FoldAssignment {
                fold_id: FoldId::new(root_fold_id)?,
                train_sample_ids: fold_set.sample_ids.clone(),
                validation_sample_ids: Vec::new(),
                metadata: BTreeMap::new(),
            };
            let mut refit =
                inner_spec.build_inner_fold_set(&full_train, &fold_set.sample_groups)?;
            // The REFIT folds become the scoped plan fold set: keep the declaration that
            // refuses target-missing rows at result admission.
            refit
                .target_missing_sample_ids
                .clone_from(&fold_set.target_missing_sample_ids);
            let occupied = outer_scopes
                .iter()
                .flat_map(|outer| {
                    std::iter::once(&outer.outer_fold_id).chain(
                        outer
                            .inner
                            .inner_fold_set
                            .folds
                            .iter()
                            .map(|fold| &fold.fold_id),
                    )
                })
                .collect::<BTreeSet<_>>();
            if refit
                .folds
                .iter()
                .any(|fold| occupied.contains(&fold.fold_id))
            {
                return Err(DagMlError::RuntimeValidation(
                    "stacking REFIT OOF fold identity collides with an evaluation fold".to_string(),
                ));
            }
            Some(refit)
        }
        Some(value) => {
            return Err(DagMlError::RuntimeValidation(format!(
                "unsupported `{STACKING_REFIT_OOF_METADATA_KEY}` metadata: {value}"
            )))
        }
    };
    if kind == NestedMetaKind::Residual && refit_fold_set.is_none() {
        return Err(DagMlError::RuntimeValidation(format!(
            "residual learner `{meta_node_id}` requires partitioned inner OOF preparation for REFIT"
        )));
    }
    Ok(Some(NestedStackingCampaignPlan {
        meta_node_id,
        kind,
        inner_cv: inner_spec,
        base_node_ids,
        meta_data_node_ids,
        outer_scopes,
        refit_fold_set,
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
        nested
            .parent_fold_set
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
    let outer = nested
        .parent_fold_set
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
        let input = match available_oof_input(
            plan,
            edge,
            scope,
            &inner_blocks,
            &nested.inner.inner_fold_set,
            &outer.train_sample_ids,
        )? {
            Some(input) => input,
            None => {
                if inner_blocks.is_empty() {
                    return Err(DagMlError::OofValidation(format!(
                        "nested stacking meta node `{}` has no inner OOF evidence for `{}`.{}",
                        node_plan.node_id, edge.source.node_id, edge.source.port_name
                    )));
                }
                prediction_input_spec(edge, scope, &inner_blocks, false)?
            }
        };
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

/// Produce the learner's target inside the scheduler from inner-fold base OOF
/// and the corresponding scored y_true records. Neither row order nor a host
/// callback may decide which base predictions define the residual target.
pub(crate) fn nested_residual_targets(
    plan: &ExecutionPlan,
    node_plan: &NodePlan,
    ctx: &RunContext,
    scope: &PhaseScope,
    nested: Option<&NestedStackingInput<'_>>,
) -> Result<Option<crate::residual::ResidualTargetSet>> {
    let campaign = match nested_stacking_campaign_plan_for_node(plan, node_plan.node_id.clone())? {
        Some(campaign)
            if campaign.kind == NestedMetaKind::Residual
                && campaign.meta_node_id == node_plan.node_id =>
        {
            campaign
        }
        _ => return Ok(None),
    };
    let fold_set = match scope.phase {
        Phase::FitCv => match nested {
            Some(input)
                if input.kind == NestedMetaKind::Residual
                    && input.meta_node_id == &node_plan.node_id =>
            {
                &input.inner.inner_fold_set
            }
            _ => {
                return Err(DagMlError::RuntimeValidation(format!(
                    "residual learner `{}` requires nested inner OOF scope in FIT_CV",
                    node_plan.node_id
                )))
            }
        },
        Phase::Refit => campaign
            .refit_fold_set
            .as_ref()
            .expect("validated residual REFIT OOF"),
        _ => return Ok(None),
    };
    let edges = incoming_oof_edges(plan, node_plan)?;
    let edge = edges.first().expect("validated single residual base edge");
    let fold_ids = fold_set
        .folds
        .iter()
        .map(|fold| fold.fold_id.clone())
        .collect::<BTreeSet<_>>();
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
                .is_some_and(|id| fold_ids.contains(id))
        });
    let blocks = filter_prediction_blocks_for_edge_source_port(plan, edge, raw_blocks)?
        .into_iter()
        .cloned()
        .collect::<Vec<_>>();
    let mut observed = BTreeMap::new();
    for record in &ctx.regression_target_records {
        if record.producer_node != edge.source.node_id
            || record.partition != PredictionPartition::Validation
            || record.variant_id != scope.variant_id
            || !record
                .fold_id
                .as_ref()
                .is_some_and(|id| fold_ids.contains(id))
            || !producer_port_matches_edge_source_port(
                plan,
                edge,
                &record.producer_node,
                record.producer_port.as_deref(),
                "residual target record",
            )?
        {
            continue;
        }
        record
            .block
            .require_complete_targets("residual target derivation")?;
        for (unit_id, values) in record.block.unit_ids.iter().zip(&record.block.values) {
            let PredictionUnitId::Sample(sample) = unit_id else {
                return Err(DagMlError::OofValidation(
                    "residual target derivation requires sample-level targets".to_string(),
                ));
            };
            if let Some(previous) = observed.insert(sample.clone(), values.clone()) {
                if previous != *values {
                    return Err(DagMlError::OofValidation(format!(
                        "residual target disagrees across folds for sample `{sample}`"
                    )));
                }
            }
        }
    }
    crate::residual::derive_residual_targets(fold_set, &edge.source.node_id, &blocks, &observed)
        .map(Some)
}

/// Read exactly one held-out learner block for each fold of a calibration
/// universe. Extra and duplicate rows are rejected before gate estimation.
pub(crate) fn residual_learner_oof(
    ctx: &RunContext,
    learner_id: &NodeId,
    folds: &FoldSet,
) -> Result<BTreeMap<SampleId, Vec<f64>>> {
    let mut oof = BTreeMap::new();
    for fold in &folds.folds {
        let blocks = ctx.prediction_store.find(
            Some(learner_id),
            Some(&PredictionPartition::Validation),
            Some(&fold.fold_id),
        );
        if blocks.len() != 1 {
            return Err(DagMlError::OofValidation(format!(
                "automatic residual gate needs one learner OOF block for fold `{}`",
                fold.fold_id
            )));
        }
        let block = blocks[0];
        if block.sample_ids.iter().cloned().collect::<BTreeSet<_>>()
            != fold
                .validation_sample_ids
                .iter()
                .cloned()
                .collect::<BTreeSet<_>>()
        {
            return Err(DagMlError::OofValidation(format!(
                "automatic residual gate learner OOF has wrong validation scope for fold `{}`",
                fold.fold_id
            )));
        }
        for (sample, value) in block.sample_ids.iter().zip(&block.values) {
            if oof.insert(sample.clone(), value.clone()).is_some() {
                return Err(DagMlError::OofValidation(
                    "automatic residual gate learner OOF repeats a sample".to_string(),
                ));
            }
        }
    }
    Ok(oof)
}

pub(crate) fn dependency_closure(
    plan: &ExecutionPlan,
    seeds: &BTreeSet<NodeId>,
) -> BTreeSet<NodeId> {
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

#[cfg(test)]
mod capacity_tests {
    use super::*;

    fn thirty_row_folds() -> FoldSet {
        let samples = (0..30)
            .map(|index| SampleId::new(format!("s{index}")).unwrap())
            .collect::<Vec<_>>();
        crate::fold::KFoldSpec {
            n_splits: 2,
            shuffle: false,
            seed: None,
        }
        .split("outer", &samples)
        .unwrap()
    }

    fn residual_with_prediction_join(base_minimum: usize) -> CapacityRequirements {
        CapacityRequirements {
            base: vec![(NodeId::new("base").unwrap(), base_minimum)],
            source: vec![(NodeId::new("source").unwrap(), 1)],
            learner: vec![(NodeId::new("learner").unwrap(), 1)],
            auto_gate: true,
            prediction_join: true,
        }
    }

    #[test]
    fn capacity_kfold_resolves_from_actual_nested_fit_scopes() {
        let folds = thirty_row_folds();
        let requested = crate::fold::CapacityKFoldSpec {
            min_splits: 2,
            max_splits: 4,
            shuffle: false,
            seed: None,
        };
        let resolved =
            resolve_capacity_kfold(&requested, &folds, &residual_with_prediction_join(4)).unwrap();
        assert!(matches!(resolved, crate::fold::NestedCvSpec::KFold(spec) if spec.n_splits == 3));

        let higher =
            resolve_capacity_kfold(&requested, &folds, &residual_with_prediction_join(8)).unwrap();
        assert!(matches!(higher, crate::fold::NestedCvSpec::KFold(spec) if spec.n_splits == 4));
    }

    #[test]
    fn capacity_kfold_fails_before_fit_when_budget_cannot_meet_hint() {
        let folds = thirty_row_folds();
        let requested = crate::fold::CapacityKFoldSpec {
            min_splits: 2,
            max_splits: 3,
            shuffle: false,
            seed: None,
        };
        let error = resolve_capacity_kfold(&requested, &folds, &residual_with_prediction_join(8))
            .unwrap_err();
        assert!(error.to_string().contains("no feasible split count"));
        assert!(error.to_string().contains("base"));
    }
}
