// Auto-split from the former monolithic `runtime.rs` (pure refactor).
use super::*;

/// The native cross-branch reduction a `PredictionJoin` merge node performs in
/// the scheduler, decoded from its DSL `merge_mode` metadata. These are the
/// merge kinds the scheduler reassembles itself (no controller call); any other
/// `merge_mode` (e.g. the default stacking semantics) is NOT a native reduction:
/// it stays an ordinary controller node joined through the `requires_oof` edge
/// path. So stacking (predictions-as-meta-features, a meta-model node) is out of
/// scope here.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum MergeReduction {
    /// Separation-branch *concat* reassembly: N branches each cover a DISJOINT
    /// partition of the fold validation set; the merge concatenates them by
    /// `sample_id` into one full-fold OOF block (overlap is an error). DSL
    /// `merge_mode == "concat"`.
    Concat,
    /// Duplication-branch *late-fusion* averaging (regression / value mean): N
    /// models on the FULL data; the merge averages each sample's branch
    /// predictions over the branches that covered it (asymmetric-coverage safe).
    /// DSL `merge_mode == "fusion"`.
    Fusion,
    /// Duplication-branch *probability-mean* fusion (classification): like
    /// [`MergeReduction::Fusion`] but each branch row is a per-class probability
    /// vector, averaged and renormalized to a valid distribution. DSL
    /// `merge_mode == "fusion_proba_mean"`.
    FusionProbaMean,
}

/// Decode the native cross-branch reduction `node_plan` performs, if any. A node
/// is a native reduction merge iff it is a `PredictionJoin` whose graph
/// `merge_mode` metadata names one of the reductions above; otherwise `None`
/// (the node takes the ordinary controller / `requires_oof` path).
pub(crate) fn merge_reduction_mode(
    plan: &ExecutionPlan,
    node_plan: &NodePlan,
) -> Option<MergeReduction> {
    if node_plan.kind != crate::graph::NodeKind::PredictionJoin {
        return None;
    }
    match plan
        .graph_plan
        .graph
        .nodes
        .iter()
        .find(|node| node.id == node_plan.node_id)
        .and_then(|node| node.metadata.get("merge_mode"))
        .and_then(serde_json::Value::as_str)
    {
        Some("concat") => Some(MergeReduction::Concat),
        Some("fusion") => Some(MergeReduction::Fusion),
        Some("fusion_proba_mean") => Some(MergeReduction::FusionProbaMean),
        _ => None,
    }
}

fn native_merge_prediction_edge<'a>(
    plan: &'a ExecutionPlan,
    node_plan: &NodePlan,
    branch_id: &NodeId,
) -> Result<&'a EdgeSpec> {
    let edges = plan
        .graph_plan
        .graph
        .edges
        .iter()
        .filter(|edge| {
            edge.source.node_id == *branch_id
                && edge.target.node_id == node_plan.node_id
                && edge.contract.kind == PortKind::Prediction
        })
        .collect::<Vec<_>>();
    match edges.as_slice() {
        [edge] => Ok(edge),
        [] => Err(DagMlError::OofValidation(format!(
            "merge node `{}` has no prediction edge from branch `{branch_id}`",
            node_plan.node_id
        ))),
        _ => Err(DagMlError::OofValidation(format!(
            "merge node `{}` has {} prediction edges from branch `{branch_id}`; native merge reduction requires a single source port",
            node_plan.node_id,
            edges.len()
        ))),
    }
}

/// Reassemble the native cross-branch reduction `node_plan` performs (concat or
/// late-fusion averaging), dispatching on the decoded [`MergeReduction`]. Both
/// schedulers call this for any node `merge_reduction_mode` matched, so the
/// scheduler dispatch stays a single branch.
pub(crate) fn reassemble_branch_merge(
    plan: &ExecutionPlan,
    node_plan: &NodePlan,
    ctx: &RunContext,
    scope: &PhaseScope,
    reduction: MergeReduction,
) -> Result<Option<NodeResult>> {
    // FIT_CV is the OOF (Validation, per-fold) reassembly the merge handlers were
    // built for. REFIT and PREDICT have no fold scope: the base branches predicted
    // the held-out test set (REFIT) / new data (PREDICT) into the prediction store
    // under a non-Validation partition (`Test` / `Final`) with `fold_id == None`,
    // and `reassemble_branch_merge_off_fold` reassembles THOSE into one scored
    // test/predict block under the merge producer. The Validation OOF path is left
    // untouched, so the FIT_CV meta-features stay Validation-only (the leakage
    // invariant): the test/predict reassembly only ever reads non-fold blocks.
    if scope.phase != Phase::FitCv {
        return reassemble_branch_merge_off_fold(plan, node_plan, ctx, scope, reduction);
    }
    match reduction {
        MergeReduction::Concat => reassemble_separation_merge(plan, node_plan, ctx, scope),
        MergeReduction::Fusion | MergeReduction::FusionProbaMean => {
            reassemble_fusion_merge(plan, node_plan, ctx, scope, reduction)
        }
    }
}

/// The off-fold prediction partition a given non-FIT_CV phase consumes / produces:
/// REFIT predicts the held-out test set (`Test`); PREDICT new data (`Final`). Any
/// other phase that reaches the off-fold path defaults to `Test`. This pins the
/// off-fold reads (merge reassembly + stacking meta-feature delivery) to exactly
/// one partition so a stale block from a prior phase in the same `RunContext` is
/// never consumed. FIT_CV never uses this (it is Validation/per-fold).
pub(crate) fn expected_off_fold_partition(phase: Phase) -> PredictionPartition {
    match phase {
        Phase::Predict => PredictionPartition::Final,
        _ => PredictionPartition::Test,
    }
}

/// The non-FIT_CV (REFIT / PREDICT) analogue of [`reassemble_branch_merge`]:
/// reassemble the base branches' off-fold (test / predict) predictions into one
/// scored block under the merge producer, so concat/fusion merges produce a
/// `best_rmse` and can predict — not just FIT_CV Validation OOF.
///
/// In REFIT each base branch predicts the held-out TEST set; in PREDICT, new
/// data. Those base blocks are stored with `fold_id == None` and a non-Validation
/// partition (`Test` for REFIT, `Final` for PREDICT). This handler reads exactly
/// those `fold_id == None`, non-`Validation` branch blocks (scoped to the active
/// variant), reassembles them — concat keeps disjoint partitions (overlap is an
/// error), fusion averages each sample over the branches that covered it — and
/// emits a block carrying the SAME partition the branches used, with reassembled
/// `y_true` so `apply_result_scoring` scores it. The universe is the UNION of
/// branch coverage (there is no fold validation set to define it off-fold).
///
/// LEAKAGE INVARIANT: this path is a NO-OP in FIT_CV (the caller routes FIT_CV to
/// the Validation OOF handlers) and only ever reads `fold_id == None`,
/// non-`Validation` blocks. The FIT_CV Validation-OOF meta-features are never
/// touched, and a Validation block (whether OOF or accidentally off-fold) is
/// never reassembled here.
pub(crate) fn reassemble_branch_merge_off_fold(
    plan: &ExecutionPlan,
    node_plan: &NodePlan,
    ctx: &RunContext,
    scope: &PhaseScope,
    reduction: MergeReduction,
) -> Result<Option<NodeResult>> {
    let variant_id = scope.variant_id.clone();
    // The phase pins EXACTLY which off-fold partition to consume: REFIT predicts
    // the held-out test set (`Test`), PREDICT new data (`Final`). Filtering by the
    // phase-expected partition (not just "non-Validation") keeps a stale `Final`
    // (from a prior REFIT/PREDICT in the same context) or any `Train` block out of
    // a REFIT merge, and lets a PREDICT-after-REFIT in one context pick `Final`
    // cleanly without tripping the multi-block "mixes variants" guard.
    let expected_partition = expected_off_fold_partition(scope.phase);

    // Gather each branch's off-fold (test / predict) block: `fold_id == None`,
    // partition == the phase-expected partition, scoped to the active variant. A
    // branch may emit none (a modelless / sparse branch); coverage is the union of
    // what is present.
    let mut branch_blocks: Vec<PredictionBlock> = Vec::new();
    let mut partition: Option<PredictionPartition> = None;
    let mut by_sample_target: BTreeMap<SampleId, Vec<f64>> = BTreeMap::new();
    let mut target_block_names: Option<Vec<String>> = None;

    for branch_id in &node_plan.input_nodes {
        let edge = native_merge_prediction_edge(plan, node_plan, branch_id)?;
        let blocks: Vec<&PredictionBlock> = ctx
            .prediction_store
            .find(Some(branch_id), Some(&expected_partition), None)
            .into_iter()
            .filter(|block| block.fold_id.is_none())
            .collect();
        let blocks = filter_prediction_blocks_for_edge_source_port(plan, edge, blocks)?;
        if blocks.is_empty() {
            continue;
        }
        if blocks.len() > 1 {
            return Err(DagMlError::OofValidation(format!(
                "merge node `{}` found {} off-fold ({expected_partition:?}) blocks for branch `{branch_id}`: the run context mixes several variants — reassemble each variant in its own context (native SELECT does this)",
                node_plan.node_id,
                blocks.len(),
            )));
        }
        let block = blocks[0];
        block.validate_shape()?;
        match &partition {
            None => partition = Some(block.partition.clone()),
            Some(existing) if existing != &block.partition => {
                return Err(DagMlError::OofValidation(format!(
                    "merge node `{}` received mismatched off-fold partitions ({existing:?} vs {:?}) from branch `{branch_id}`",
                    node_plan.node_id, block.partition
                )));
            }
            _ => {}
        }
        branch_blocks.push(block.clone());

        // Reassemble this branch's off-fold y_true (same phase-expected partition /
        // variant, no fold). The branches predict the SAME samples, so a per-sample
        // insert is correct (concat partitions are disjoint; fusion targets are
        // identical).
        for record in &ctx.regression_target_records {
            if &record.producer_node != branch_id
                || record.fold_id.is_some()
                || record.partition != expected_partition
                || record.variant_id != variant_id
                || !producer_port_matches_edge_source_port(
                    plan,
                    edge,
                    &record.producer_node,
                    record.producer_port.as_deref(),
                    "regression target record",
                )?
            {
                continue;
            }
            if target_block_names.is_none() && !record.block.target_names.is_empty() {
                target_block_names = Some(record.block.target_names.clone());
            }
            for (unit_id, row) in record.block.unit_ids.iter().zip(&record.block.values) {
                let PredictionUnitId::Sample(sample_id) = unit_id else {
                    continue;
                };
                by_sample_target.insert(sample_id.clone(), row.clone());
            }
        }
    }

    // No branch produced an off-fold block: nothing to reassemble (a modelless
    // merge, or a phase where the branches do not predict).
    if branch_blocks.is_empty() {
        return Ok(None);
    }
    let partition = partition.expect("at least one branch block present");

    let reassembled = match reduction {
        MergeReduction::Concat => reassemble_off_fold_concat(&branch_blocks, &node_plan.node_id)?,
        MergeReduction::Fusion => {
            reduce_predictions_across_branches(&branch_blocks, None, &node_plan.node_id)?
        }
        MergeReduction::FusionProbaMean => {
            reduce_proba_mean_across_branches(&branch_blocks, &node_plan.node_id)?
        }
    };

    // Deterministic order: emit samples sorted by id (no fold order to follow
    // off-fold). Targets are emitted only when EVERY merged sample has a y_true
    // row, so `apply_result_scoring` pairs the block 1:1 with its targets.
    let mut sample_ids: Vec<SampleId> = reassembled.sample_ids.clone();
    sample_ids.sort();
    let by_sample: BTreeMap<&SampleId, &Vec<f64>> = reassembled
        .sample_ids
        .iter()
        .zip(&reassembled.values)
        .collect();
    let values: Vec<Vec<f64>> = sample_ids
        .iter()
        .map(|sample_id| by_sample[sample_id].clone())
        .collect();

    let regression_targets = reassemble_merge_targets(
        &node_plan.node_id,
        &sample_ids,
        &mut by_sample_target,
        target_block_names.unwrap_or_default(),
    )?
    .into_iter()
    .collect();

    // Lineage links every contributing branch (for this variant, off-fold).
    let branch_inputs: BTreeSet<&NodeId> = node_plan.input_nodes.iter().collect();
    let mut input_lineage: Vec<LineageId> = Vec::new();
    for record in ctx.lineage.records() {
        if branch_inputs.contains(&record.node_id)
            && record.phase == scope.phase
            && record.fold_id.is_none()
            && record.variant_id == variant_id
        {
            input_lineage.push(record.record_id.clone());
        }
    }

    let variant_suffix = variant_id
        .as_ref()
        .map(|variant| format!(":{variant}"))
        .unwrap_or_default();
    let phase_label = scope.phase.as_str();
    let merged = PredictionBlock {
        prediction_id: Some(format!(
            "merge:{}:{phase_label}{variant_suffix}",
            node_plan.node_id
        )),
        producer_node: node_plan.node_id.clone(),
        producer_port: None,
        partition,
        fold_id: None,
        sample_ids,
        values,
        target_names: reassembled.target_names.clone(),
    };
    merged.validate_shape()?;

    let lineage = LineageRecord {
        record_id: LineageId::new(format!(
            "lineage:{}:{phase_label}{variant_suffix}",
            node_plan.node_id
        ))?,
        run_id: ctx.run_id.clone(),
        node_id: node_plan.node_id.clone(),
        phase: scope.phase,
        controller_id: node_plan.controller_id.clone(),
        controller_version: node_plan.controller_version.clone(),
        variant_id,
        fold_id: None,
        branch_path: Vec::new(),
        input_lineage,
        artifact_refs: Vec::new(),
        params_fingerprint: node_plan.params_fingerprint.clone(),
        data_model_shape_fingerprint: None,
        aggregation_policy_fingerprint: None,
        seed: None,
        unsafe_flags: BTreeSet::new(),
        metrics: BTreeMap::new(),
        loss_attestations: Vec::new(),
        early_stopping_records: Vec::new(),
    };

    Ok(Some(NodeResult {
        schema_version: None,
        node_id: node_plan.node_id.clone(),
        outputs: BTreeMap::new(),
        predictions: vec![merged],
        observation_predictions: Vec::new(),
        aggregated_predictions: Vec::new(),
        explanations: Vec::new(),
        shape_deltas: Vec::new(),
        artifacts: Vec::new(),
        artifact_handles: BTreeMap::new(),
        fit_influence_diagnostics: Vec::new(),
        regression_targets,
        lineage,
    }))
}

/// Concatenate disjoint off-fold (test / predict) branch blocks by `sample_id`
/// into one block under `merge_node`. The off-fold analogue of the concat half of
/// [`reassemble_separation_merge`]: branches cover DISJOINT partitions of the
/// universe (separation never shares a sample), so an overlapping sample is a hard
/// error. Width, target names and partition must agree across branches. Unlike the
/// FIT_CV concat there is no fold validation set to check completeness against —
/// the universe is simply the disjoint union of the branch coverage.
pub(crate) fn reassemble_off_fold_concat(
    branch_blocks: &[PredictionBlock],
    merge_node: &NodeId,
) -> Result<PredictionBlock> {
    let first = branch_blocks
        .first()
        .expect("at least one branch block present");
    let width = first.validate_shape()?;
    let target_names = if first.target_names.is_empty() {
        (0..width).map(|idx| format!("p{idx}")).collect::<Vec<_>>()
    } else {
        first.target_names.clone()
    };
    let mut by_sample: BTreeMap<SampleId, Vec<f64>> = BTreeMap::new();
    for block in branch_blocks {
        let block_width = block.validate_shape()?;
        if block_width != width {
            return Err(DagMlError::OofValidation(format!(
                "merge node `{merge_node}` received mismatched off-fold prediction widths ({width} vs {block_width})"
            )));
        }
        let block_targets = if block.target_names.is_empty() {
            (0..block_width).map(|idx| format!("p{idx}")).collect()
        } else {
            block.target_names.clone()
        };
        if block_targets != target_names {
            return Err(DagMlError::OofValidation(format!(
                "merge node `{merge_node}` received inconsistent off-fold target names across branches"
            )));
        }
        for (sample_id, row) in block.sample_ids.iter().zip(&block.values) {
            if by_sample.insert(sample_id.clone(), row.clone()).is_some() {
                return Err(DagMlError::OofValidation(format!(
                    "merge node `{merge_node}` received overlapping off-fold branch predictions: sample `{sample_id}` is covered by more than one partition"
                )));
            }
        }
    }
    let sample_ids: Vec<SampleId> = by_sample.keys().cloned().collect();
    let values: Vec<Vec<f64>> = sample_ids
        .iter()
        .map(|sample_id| by_sample[sample_id].clone())
        .collect();
    Ok(PredictionBlock {
        prediction_id: None,
        producer_node: merge_node.clone(),
        producer_port: None,
        partition: first.partition.clone(),
        fold_id: None,
        sample_ids,
        values,
        target_names,
    })
}

/// Reassemble the per-partition OOF blocks of a separation branch into ONE
/// per-sample OOF block (and its targets) for a concat merge node.
///
/// Slice 3 of native branch support. The fan-out (Slice 2) turns one separation
/// criterion into N branch model nodes; each branch's FIT_CV emits a `Validation`
/// `PredictionBlock` covering ONLY its partition's slice of the current fold's
/// validation set. Nothing reassembled them, so a separation branch could not
/// produce a scored full-universe result. This handler is the reassembly: it
/// reads the merge node's upstream branch OOF blocks (and the per-partition
/// `y_true` the branch models emitted) from the run context, validates them,
/// concatenates by `sample_id`, and emits one merged `Validation` block — with
/// its reassembled targets — whose producer is the merge node.
///
/// Validation is *partition-aware on the inputs* but *full-fold on the output*:
///   - each branch input legitimately covers a SUBSET (its partition) of the
///     fold validation set — never the full set (that is the stacking contract,
///     not concat), so the normal full-fold OOF edge validation does not apply
///     to the inputs;
///   - the inputs must be DISJOINT by sample (separation partitions never share
///     a sample) — an overlap is a hard error;
///   - the reassembled OUTPUT must cover the fold's full validation set, each
///     sample present exactly once (the union of the partitions). This is the
///     completeness the rest of the OOF machinery expects of a producer.
///
/// Scoring (so a separation branch yields a scored full-universe result):
///   - the merged `NodeResult.regression_targets` are reassembled from each
///     branch's per-partition `y_true` (the records `apply_result_scoring`
///     collected from the branch FIT_CV results). This makes the per-fold
///     `apply_result_scoring` score the MERGE producer, AND attributes target
///     records to the merge node so the cross-fold OOF average
///     (`cross_fold_validation_reports`) scores the merge like a normal model.
///     When the branches emit NO targets (mock controllers), the merge emits no
///     targets and stays unscored — exactly as an unscored model node would.
///
/// Variant scoping: a branch model that ALSO carries a generator/sweep produces
/// one block per variant in the same run context. Blocks carry no variant tag,
/// so reads are scoped to the active variant via `scope.variant_id`: a branch's
/// per-fold target records are filtered by variant, and more than one
/// `Validation` block for a (branch, fold) — which only arises when several
/// variants accumulate in one context (the unsupported direct multi-variant
/// path; SELECT isolates each variant in its own context) — is a hard error
/// rather than a silent cross-variant mix. The emitted block id and lineage
/// record id are variant-distinguished so per-variant merges never collide.
///
/// Runs once per fold scope (the campaign phase loops folds, so the handler
/// reassembles within the current fold's validation universe). An empty fold
/// scope (`scope.fold_id == None`) yields no merged block.
pub(crate) fn reassemble_separation_merge(
    plan: &ExecutionPlan,
    node_plan: &NodePlan,
    ctx: &RunContext,
    scope: &PhaseScope,
) -> Result<Option<NodeResult>> {
    // Concat reassembly is an OOF (validation) operation; it only runs inside a
    // FIT_CV fold scope. Other phases have no per-fold OOF to reassemble.
    let Some(fold_id) = scope.fold_id.clone() else {
        return Ok(None);
    };
    let fold = plan
        .fold_set
        .as_ref()
        .and_then(|fold_set| fold_set.folds.iter().find(|fold| fold.fold_id == fold_id))
        .ok_or_else(|| {
            DagMlError::RuntimeValidation(format!(
                "merge node `{}` references unknown fold `{fold_id}`",
                node_plan.node_id
            ))
        })?;
    let expected: BTreeSet<&SampleId> = fold.validation_sample_ids.iter().collect();

    // A genuinely empty fold (no validation samples) has nothing to reassemble.
    // This is the ONLY skip: any NON-empty fold always runs the union/coverage
    // check below, so an all-empty or partial set of branch inputs surfaces the
    // missing samples as an error instead of silently dropping the merge output.
    if expected.is_empty() {
        return Ok(None);
    }

    // Concatenate every branch's validation OOF block for this fold, keyed by
    // sample id, refusing any sample that two branches both claim. Each branch
    // contributes at most one block per fold (per-variant isolation); two blocks
    // for one (branch, fold) means several variants are mixed in this context.
    let variant_id = scope.variant_id.clone();
    let mut by_sample: BTreeMap<SampleId, Vec<f64>> = BTreeMap::new();
    let mut by_sample_target: BTreeMap<SampleId, Vec<f64>> = BTreeMap::new();
    let mut target_names: Option<Vec<String>> = None;
    let mut target_block_names: Option<Vec<String>> = None;
    let mut width: Option<usize> = None;

    for branch_id in &node_plan.input_nodes {
        let edge = native_merge_prediction_edge(plan, node_plan, branch_id)?;
        let blocks = ctx.prediction_store.find(
            Some(branch_id),
            Some(&PredictionPartition::Validation),
            Some(&fold_id),
        );
        let blocks = filter_prediction_blocks_for_edge_source_port(plan, edge, blocks)?;
        if blocks.is_empty() {
            // The branch had an empty partition ∩ fold (skipped, no OOF block).
            // That is legitimate for a sparse partition; coverage is rechecked
            // against the full fold validation set below.
            continue;
        }
        if blocks.len() > 1 {
            return Err(DagMlError::OofValidation(format!(
                "merge node `{}` found {} validation blocks for branch `{branch_id}` in fold `{fold_id}`: the run context mixes several variants — reassemble each variant in its own context (native SELECT does this)",
                node_plan.node_id,
                blocks.len()
            )));
        }
        let block = blocks[0];
        let block_width = block.validate_shape()?;
        match width {
            None => width = Some(block_width),
            Some(existing) if existing != block_width => {
                return Err(DagMlError::OofValidation(format!(
                    "merge node `{}` received mismatched prediction widths ({existing} vs {block_width}) from branch `{branch_id}`",
                    node_plan.node_id
                )));
            }
            _ => {}
        }
        let block_targets = if block.target_names.is_empty() {
            (0..block_width).map(|idx| format!("p{idx}")).collect()
        } else {
            block.target_names.clone()
        };
        match &target_names {
            None => target_names = Some(block_targets),
            Some(existing) if existing != &block_targets => {
                return Err(DagMlError::OofValidation(format!(
                    "merge node `{}` received inconsistent target names across branches",
                    node_plan.node_id
                )));
            }
            _ => {}
        }
        for (sample_id, values) in block.sample_ids.iter().zip(block.values.iter()) {
            if !expected.contains(sample_id) {
                return Err(DagMlError::OofValidation(format!(
                    "merge node `{}` branch `{branch_id}` emitted sample `{sample_id}` outside fold `{fold_id}` validation set",
                    node_plan.node_id
                )));
            }
            if by_sample
                .insert(sample_id.clone(), values.clone())
                .is_some()
            {
                return Err(DagMlError::OofValidation(format!(
                    "merge node `{}` received overlapping branch predictions: sample `{sample_id}` is covered by more than one partition",
                    node_plan.node_id
                )));
            }
        }

        // Reassemble this branch's per-partition y_true (the records collected
        // from the branch FIT_CV result), scoped to the active variant, so the
        // merge producer can be scored per-fold and cross-fold.
        for record in &ctx.regression_target_records {
            if &record.producer_node != branch_id
                || record.partition != PredictionPartition::Validation
                || record.fold_id.as_ref() != Some(&fold_id)
                || record.variant_id != variant_id
                || !producer_port_matches_edge_source_port(
                    plan,
                    edge,
                    &record.producer_node,
                    record.producer_port.as_deref(),
                    "regression target record",
                )?
            {
                continue;
            }
            if target_block_names.is_none() && !record.block.target_names.is_empty() {
                target_block_names = Some(record.block.target_names.clone());
            }
            for (unit_id, row) in record.block.unit_ids.iter().zip(&record.block.values) {
                let PredictionUnitId::Sample(sample_id) = unit_id else {
                    continue;
                };
                by_sample_target.insert(sample_id.clone(), row.clone());
            }
        }
    }

    // Full-fold output completeness: the union of partitions must be exactly the
    // fold validation set — no missing sample, none extra. A NON-empty fold with
    // no (or partial) branch inputs lands here and reports the missing samples.
    let covered: BTreeSet<&SampleId> = by_sample.keys().collect();
    if covered != expected {
        let missing: Vec<String> = expected
            .difference(&covered)
            .map(|sample| sample.to_string())
            .collect();
        return Err(DagMlError::OofValidation(format!(
            "merge node `{}` reassembled OOF does not cover fold `{fold_id}` validation set (missing {} sample(s): {})",
            node_plan.node_id,
            missing.len(),
            missing.join(", ")
        )));
    }

    // Deterministic order: emit samples in the fold's declared validation order.
    let sample_ids: Vec<SampleId> = fold.validation_sample_ids.clone();
    let values: Vec<Vec<f64>> = sample_ids
        .iter()
        .map(|sample_id| by_sample.remove(sample_id).expect("sample covered"))
        .collect();
    let target_names = target_names.unwrap_or_default();

    // Reassembled targets: emit a 1:1 target block only when EVERY merged sample
    // has a target row (so `apply_result_scoring` pairs block↔targets exactly). The
    // central R-P1-9 gate makes PARTIAL coverage (some branches emitted y_true,
    // others not) a hard error instead of a silent no-score; no branch emitting
    // targets stays the legitimate unscored case.
    let regression_targets = reassemble_merge_targets(
        &node_plan.node_id,
        &sample_ids,
        &mut by_sample_target,
        target_block_names.unwrap_or_default(),
    )?
    .into_iter()
    .collect();

    // Lineage links every contributing branch (for this variant + fold), so the
    // merge is fully traceable.
    let branch_inputs: BTreeSet<&NodeId> = node_plan.input_nodes.iter().collect();
    let mut input_lineage: Vec<LineageId> = Vec::new();
    for record in ctx.lineage.records() {
        if branch_inputs.contains(&record.node_id)
            && record.phase == scope.phase
            && record.fold_id.as_ref() == Some(&fold_id)
            && record.variant_id == variant_id
        {
            input_lineage.push(record.record_id.clone());
        }
    }

    // Variant-distinguish the emitted id + lineage id so per-variant merges in
    // one context never collide (an empty suffix for the common single-variant
    // case keeps ids stable).
    let variant_suffix = variant_id
        .as_ref()
        .map(|variant| format!(":{variant}"))
        .unwrap_or_default();
    let merged = PredictionBlock {
        prediction_id: Some(format!(
            "merge:{}:{fold_id}{variant_suffix}",
            node_plan.node_id
        )),
        producer_node: node_plan.node_id.clone(),
        producer_port: None,
        partition: PredictionPartition::Validation,
        fold_id: Some(fold_id.clone()),
        sample_ids,
        values,
        target_names,
    };
    merged.validate_shape()?;

    let lineage = LineageRecord {
        record_id: LineageId::new(format!(
            "lineage:{}:{fold_id}{variant_suffix}",
            node_plan.node_id
        ))?,
        run_id: ctx.run_id.clone(),
        node_id: node_plan.node_id.clone(),
        phase: scope.phase,
        controller_id: node_plan.controller_id.clone(),
        controller_version: node_plan.controller_version.clone(),
        variant_id,
        fold_id: Some(fold_id),
        branch_path: Vec::new(),
        input_lineage,
        artifact_refs: Vec::new(),
        params_fingerprint: node_plan.params_fingerprint.clone(),
        data_model_shape_fingerprint: None,
        aggregation_policy_fingerprint: None,
        seed: None,
        unsafe_flags: BTreeSet::new(),
        metrics: BTreeMap::new(),
        loss_attestations: Vec::new(),
        early_stopping_records: Vec::new(),
    };

    Ok(Some(NodeResult {
        schema_version: None,
        node_id: node_plan.node_id.clone(),
        outputs: BTreeMap::new(),
        predictions: vec![merged],
        observation_predictions: Vec::new(),
        aggregated_predictions: Vec::new(),
        explanations: Vec::new(),
        shape_deltas: Vec::new(),
        artifacts: Vec::new(),
        artifact_handles: BTreeMap::new(),
        fit_influence_diagnostics: Vec::new(),
        regression_targets,
        lineage,
    }))
}

/// Average (fuse) the per-branch OOF blocks of a *duplication* branch into ONE
/// per-sample OOF block (and its targets) for a late-fusion merge node.
///
/// The cross-branch analogue of [`reassemble_separation_merge`] for the
/// duplication shape (`[[A], [B]]`, the default branch mode): instead of N
/// branches each covering a DISJOINT partition (concat), N models are fit on the
/// FULL data and the merge AVERAGES their held-out predictions per sample. This
/// is distinct from concat (disjoint reassembly) and from stacking (a meta-model
/// node). [`MergeReduction::Fusion`] averages raw values
/// ([`reduce_predictions_across_branches`]); [`MergeReduction::FusionProbaMean`]
/// averages per-class probability rows and renormalizes
/// ([`reduce_proba_mean_across_branches`]).
///
/// LEAKAGE INVARIANT: fusion averages each branch's HELD-OUT predictions — the
/// `Validation` OOF block of the *current fold* (per fold, never train). It reads
/// exactly the same partition/fold-scoped `Validation` blocks the concat handler
/// reads and emits a `Validation` block under the merge producer, so the
/// CV-scored output is built from out-of-fold predictions only; train
/// predictions never enter the average.
///
/// Asymmetric coverage: a branch that did not predict a sample (a modelless or
/// sparse branch emits no row for it) simply does not contribute — the reducers
/// average each sample over exactly the branches that covered it, never a fixed
/// denominator. The union of branch coverage must still equal the fold
/// validation set (full-fold output completeness); a non-empty fold with missing
/// samples is a hard error, exactly as in concat.
///
/// Targets, variant scoping, lineage and emitted ids mirror
/// [`reassemble_separation_merge`]; the only difference is the value reduction
/// (average vs concatenate) and that branches legitimately OVERLAP on samples
/// (the whole point of fusion) rather than being rejected for overlap.
pub(crate) fn reassemble_fusion_merge(
    plan: &ExecutionPlan,
    node_plan: &NodePlan,
    ctx: &RunContext,
    scope: &PhaseScope,
    reduction: MergeReduction,
) -> Result<Option<NodeResult>> {
    // Fusion averaging is an OOF (validation) operation; it only runs inside a
    // FIT_CV fold scope. Other phases have no per-fold OOF to fuse.
    let Some(fold_id) = scope.fold_id.clone() else {
        return Ok(None);
    };
    let fold = plan
        .fold_set
        .as_ref()
        .and_then(|fold_set| fold_set.folds.iter().find(|fold| fold.fold_id == fold_id))
        .ok_or_else(|| {
            DagMlError::RuntimeValidation(format!(
                "fusion merge node `{}` references unknown fold `{fold_id}`",
                node_plan.node_id
            ))
        })?;
    let expected: BTreeSet<&SampleId> = fold.validation_sample_ids.iter().collect();

    // A genuinely empty fold (no validation samples) has nothing to fuse.
    if expected.is_empty() {
        return Ok(None);
    }

    // Gather each branch's Validation OOF block for this fold, scoped to the
    // active variant (one block per (branch, fold); >1 means several variants are
    // mixed in this context). Branches legitimately overlap on samples — that is
    // what fusion averages — so unlike concat we collect, not deduplicate.
    let variant_id = scope.variant_id.clone();
    let mut branch_blocks: Vec<PredictionBlock> = Vec::new();
    let mut by_sample_target: BTreeMap<SampleId, Vec<f64>> = BTreeMap::new();
    let mut target_block_names: Option<Vec<String>> = None;

    for branch_id in &node_plan.input_nodes {
        let edge = native_merge_prediction_edge(plan, node_plan, branch_id)?;
        let blocks = ctx.prediction_store.find(
            Some(branch_id),
            Some(&PredictionPartition::Validation),
            Some(&fold_id),
        );
        let blocks = filter_prediction_blocks_for_edge_source_port(plan, edge, blocks)?;
        if blocks.is_empty() {
            // Modelless / sparse branch: no OOF block this fold. Coverage is
            // rechecked against the full fold validation set below.
            continue;
        }
        if blocks.len() > 1 {
            return Err(DagMlError::OofValidation(format!(
                "fusion merge node `{}` found {} validation blocks for branch `{branch_id}` in fold `{fold_id}`: the run context mixes several variants — reassemble each variant in its own context (native SELECT does this)",
                node_plan.node_id,
                blocks.len()
            )));
        }
        let block = blocks[0];
        block.validate_shape()?;
        for sample_id in &block.sample_ids {
            if !expected.contains(sample_id) {
                return Err(DagMlError::OofValidation(format!(
                    "fusion merge node `{}` branch `{branch_id}` emitted sample `{sample_id}` outside fold `{fold_id}` validation set",
                    node_plan.node_id
                )));
            }
        }
        branch_blocks.push(block.clone());

        // Reassemble this branch's per-sample y_true (scoped to the active
        // variant). Each branch predicts the SAME samples, so its targets are the
        // sample's fold-independent ground truth — identical across branches, so a
        // plain per-sample insert (last write wins) is correct.
        for record in &ctx.regression_target_records {
            if &record.producer_node != branch_id
                || record.partition != PredictionPartition::Validation
                || record.fold_id.as_ref() != Some(&fold_id)
                || record.variant_id != variant_id
                || !producer_port_matches_edge_source_port(
                    plan,
                    edge,
                    &record.producer_node,
                    record.producer_port.as_deref(),
                    "regression target record",
                )?
            {
                continue;
            }
            if target_block_names.is_none() && !record.block.target_names.is_empty() {
                target_block_names = Some(record.block.target_names.clone());
            }
            for (unit_id, row) in record.block.unit_ids.iter().zip(&record.block.values) {
                let PredictionUnitId::Sample(sample_id) = unit_id else {
                    continue;
                };
                by_sample_target.insert(sample_id.clone(), row.clone());
            }
        }
    }

    // Average the branch blocks per sample (over covering branches only). The
    // reducer keys by sample_id, validates uniform width/target-names/partition,
    // and produces the merge producer's fused block.
    let fused = match reduction {
        MergeReduction::Fusion => {
            reduce_predictions_across_branches(&branch_blocks, None, &node_plan.node_id)?
        }
        MergeReduction::FusionProbaMean => {
            reduce_proba_mean_across_branches(&branch_blocks, &node_plan.node_id)?
        }
        MergeReduction::Concat => unreachable!("concat is handled by reassemble_separation_merge"),
    };

    // Full-fold output completeness: the union of branch coverage must be exactly
    // the fold validation set — no missing sample, none extra.
    let covered: BTreeSet<&SampleId> = fused.sample_ids.iter().collect();
    if covered != expected {
        let missing: Vec<String> = expected
            .difference(&covered)
            .map(|sample| sample.to_string())
            .collect();
        return Err(DagMlError::OofValidation(format!(
            "fusion merge node `{}` fused OOF does not cover fold `{fold_id}` validation set (missing {} sample(s): {})",
            node_plan.node_id,
            missing.len(),
            missing.join(", ")
        )));
    }

    // Deterministic order: emit samples in the fold's declared validation order,
    // carrying the fused values for each.
    let fused_by_sample: BTreeMap<&SampleId, &Vec<f64>> =
        fused.sample_ids.iter().zip(&fused.values).collect();
    let sample_ids: Vec<SampleId> = fold.validation_sample_ids.clone();
    let values: Vec<Vec<f64>> = sample_ids
        .iter()
        .map(|sample_id| fused_by_sample[sample_id].clone())
        .collect();
    let target_names = fused.target_names.clone();

    // Reassembled targets: emit a 1:1 target block only when EVERY merged sample
    // has a target row. The central R-P1-9 gate turns PARTIAL coverage into a hard
    // error (never a silent no-score); no branch emitting targets is the legitimate
    // unscored case.
    let regression_targets = reassemble_merge_targets(
        &node_plan.node_id,
        &sample_ids,
        &mut by_sample_target,
        target_block_names.unwrap_or_default(),
    )?
    .into_iter()
    .collect();

    // Lineage links every contributing branch (for this variant + fold).
    let branch_inputs: BTreeSet<&NodeId> = node_plan.input_nodes.iter().collect();
    let mut input_lineage: Vec<LineageId> = Vec::new();
    for record in ctx.lineage.records() {
        if branch_inputs.contains(&record.node_id)
            && record.phase == scope.phase
            && record.fold_id.as_ref() == Some(&fold_id)
            && record.variant_id == variant_id
        {
            input_lineage.push(record.record_id.clone());
        }
    }

    let variant_suffix = variant_id
        .as_ref()
        .map(|variant| format!(":{variant}"))
        .unwrap_or_default();
    let merged = PredictionBlock {
        prediction_id: Some(format!(
            "merge:{}:{fold_id}{variant_suffix}",
            node_plan.node_id
        )),
        producer_node: node_plan.node_id.clone(),
        producer_port: None,
        partition: PredictionPartition::Validation,
        fold_id: Some(fold_id.clone()),
        sample_ids,
        values,
        target_names,
    };
    merged.validate_shape()?;

    let lineage = LineageRecord {
        record_id: LineageId::new(format!(
            "lineage:{}:{fold_id}{variant_suffix}",
            node_plan.node_id
        ))?,
        run_id: ctx.run_id.clone(),
        node_id: node_plan.node_id.clone(),
        phase: scope.phase,
        controller_id: node_plan.controller_id.clone(),
        controller_version: node_plan.controller_version.clone(),
        variant_id,
        fold_id: Some(fold_id),
        branch_path: Vec::new(),
        input_lineage,
        artifact_refs: Vec::new(),
        params_fingerprint: node_plan.params_fingerprint.clone(),
        data_model_shape_fingerprint: None,
        aggregation_policy_fingerprint: None,
        seed: None,
        unsafe_flags: BTreeSet::new(),
        metrics: BTreeMap::new(),
        loss_attestations: Vec::new(),
        early_stopping_records: Vec::new(),
    };

    Ok(Some(NodeResult {
        schema_version: None,
        node_id: node_plan.node_id.clone(),
        outputs: BTreeMap::new(),
        predictions: vec![merged],
        observation_predictions: Vec::new(),
        aggregated_predictions: Vec::new(),
        explanations: Vec::new(),
        shape_deltas: Vec::new(),
        artifacts: Vec::new(),
        artifact_handles: BTreeMap::new(),
        fit_influence_diagnostics: Vec::new(),
        regression_targets,
        lineage,
    }))
}

/// Extract the `BranchViewPlan` that the DSL compiler stashed in the graph
/// node's metadata under `dsl_branch_view_plan`, if any. Returns `None` when
/// the node was not produced by a separation branch; returns `Err` when the
/// stored value cannot be deserialized as a `BranchViewPlan`. This is the
/// scheduler-side bridge that activates the BranchView wiring at runtime;
/// without it, every `DataProviderViewSpec.branch_view` would stay `None`
/// even when the DSL compiled `branch_view_plans` into the campaign.
pub(crate) fn branch_view_from_node_metadata(
    plan: &ExecutionPlan,
    node_id: &NodeId,
) -> Result<Option<crate::data::BranchViewPlan>> {
    let node = match plan
        .graph_plan
        .graph
        .nodes
        .iter()
        .find(|node| &node.id == node_id)
    {
        Some(node) => node,
        None => return Ok(None),
    };
    let Some(value) = node.metadata.get("dsl_branch_view_plan") else {
        return Ok(None);
    };
    let plan: crate::data::BranchViewPlan =
        serde_json::from_value(value.clone()).map_err(|error| {
            DagMlError::RuntimeValidation(format!(
                "node `{node_id}` carries malformed `dsl_branch_view_plan` metadata: {error}"
            ))
        })?;
    plan.validate()?;
    Ok(Some(plan))
}

/// Whether a data view is the FIT (training) input for its scope, or a
/// non-fit (validation / predict / explain) read.
///
/// Exclusion is keyed off this role, not the partition name: `exclude` drops
/// outlier samples from any TRAINING read (even an unsafe
/// `fit_partition=fold_validation` one), while genuine validation/predict reads
/// keep excluded samples so OOF/test coverage stays complete.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum DataViewRole {
    Fit,
    NonFit,
}

pub(crate) fn data_view_for_partition(
    binding: &DataBinding,
    fold_set: Option<&FoldSet>,
    scope: &PhaseScope,
    partition: DataRequestPartition,
    branch_view: Option<&crate::data::BranchViewPlan>,
    role: DataViewRole,
    excluded_samples: &BTreeSet<SampleId>,
) -> Result<DataProviderViewSpec> {
    let fold = fold_for_scope(fold_set, scope.fold_id.as_ref())?;
    let mut sample_ids = sample_ids_for_partition(partition, fold_set, fold);
    // FIT role: enforce exclusion at the SPEC level (sample-local), so the
    // spec, the materialized view, and `equal_sample_influence_weights`
    // row_weights all agree on the same training rows. The policy escape hatch
    // `include_excluded` (+ `allow_excluded_rows`) keeps excluded rows when a
    // user explicitly opts in.
    if role == DataViewRole::Fit
        && !binding.view_policy.include_excluded
        && !excluded_samples.is_empty()
    {
        if let Some(ids) = sample_ids.as_mut() {
            ids.retain(|sample_id| !excluded_samples.contains(sample_id));
        }
    }
    if binding.view_policy.require_sample_ids
        && matches!(
            partition,
            DataRequestPartition::FoldTrain | DataRequestPartition::FoldValidation
        )
        && scope.fold_id.is_some()
        && sample_ids.as_ref().is_none_or(Vec::is_empty)
    {
        return Err(DagMlError::RuntimeValidation(format!(
            "data binding `{}` on `{}` requires sample ids for {:?}",
            binding.input_name, binding.node_id, partition
        )));
    }
    let include_augmented = match partition {
        DataRequestPartition::FoldTrain | DataRequestPartition::FullTrain => {
            binding.view_policy.include_augmented_train
        }
        DataRequestPartition::FoldValidation | DataRequestPartition::Predict => {
            binding.view_policy.include_augmented_validation
        }
    };
    // Exclusion is keyed off the FIT role, not the partition name. A fit
    // (training) read drops excluded rows by default (the policy escape hatch
    // `include_excluded` + `allow_excluded_rows` can keep them); a genuine
    // validation/predict read always retains them so they are still validated
    // and predicted. `filter_relations` honors this `include_excluded` flag as
    // defense-in-depth, but the filtered spec sample_ids above are authoritative.
    let include_excluded = match role {
        DataViewRole::Fit => binding.view_policy.include_excluded,
        DataViewRole::NonFit => true,
    };
    let mut extra = BTreeMap::new();
    extra.insert(
        "feature_set_id".to_string(),
        serde_json::Value::String(binding.feature_set_id().to_string()),
    );
    if let Some(source_index) = binding
        .metadata
        .get(crate::data::SOURCE_INDEX_METADATA_KEY)
        .cloned()
    {
        extra.insert(
            crate::data::SOURCE_INDEX_METADATA_KEY.to_string(),
            source_index,
        );
    }
    if !binding.view_policy.unsafe_flags.is_empty() {
        extra.insert(
            "unsafe_flags".to_string(),
            serde_json::Value::Array(
                binding
                    .view_policy
                    .unsafe_flags
                    .iter()
                    .cloned()
                    .map(serde_json::Value::String)
                    .collect(),
            ),
        );
    }
    let view = DataProviderViewSpec {
        sample_ids,
        partition,
        fold_id: match partition {
            DataRequestPartition::FoldTrain | DataRequestPartition::FoldValidation => {
                scope.fold_id.clone()
            }
            DataRequestPartition::FullTrain | DataRequestPartition::Predict => None,
        },
        source_ids: source_ids_for_view(binding, branch_view)?,
        columns: None,
        include_augmented,
        include_excluded,
        branch_view: branch_view.cloned(),
        extra,
    };
    view.validate()?;
    Ok(view)
}

fn source_ids_for_view(
    binding: &DataBinding,
    branch_view: Option<&crate::data::BranchViewPlan>,
) -> Result<Option<Vec<String>>> {
    let Some(branch_view) = branch_view else {
        return Ok((!binding.source_ids.is_empty()).then(|| binding.source_ids.clone()));
    };
    if branch_view.mode != crate::data::BranchViewMode::BySource {
        return Ok((!binding.source_ids.is_empty()).then(|| binding.source_ids.clone()));
    }
    if branch_view.selector.source_ids.len() != 1 {
        return Err(DagMlError::RuntimeValidation(format!(
            "by_source branch view `{}` must select exactly one source_id for `{}` on `{}`",
            branch_view.view_id, binding.input_name, binding.node_id
        )));
    }
    let source_id = branch_view.selector.source_ids[0].clone();
    if !binding.source_ids.is_empty() && !binding.source_ids.iter().any(|item| item == &source_id) {
        return Err(DagMlError::RuntimeValidation(format!(
            "by_source branch view `{}` selects source `{source_id}` outside data binding source_ids {:?} for `{}` on `{}`",
            branch_view.view_id, binding.source_ids, binding.input_name, binding.node_id
        )));
    }
    Ok(Some(vec![source_id]))
}

pub(crate) fn data_partition_for_scope(
    binding: &DataBinding,
    scope: &PhaseScope,
) -> DataRequestPartition {
    match scope.phase {
        Phase::FitCv => binding.view_policy.fit_partition,
        Phase::Refit => DataRequestPartition::FullTrain,
        Phase::Predict | Phase::Explain if scope.fold_id.is_none() => DataRequestPartition::Predict,
        Phase::Predict | Phase::Explain => binding.view_policy.predict_partition,
        Phase::Compile | Phase::Plan | Phase::Select => DataRequestPartition::FullTrain,
    }
}

pub(crate) fn fold_for_scope<'a>(
    fold_set: Option<&'a FoldSet>,
    fold_id: Option<&FoldId>,
) -> Result<Option<&'a FoldAssignment>> {
    let Some(fold_id) = fold_id else {
        return Ok(None);
    };
    let fold_set = fold_set.ok_or_else(|| {
        DagMlError::RuntimeValidation(format!(
            "fold `{fold_id}` requested but execution plan has no fold set"
        ))
    })?;
    fold_set
        .folds
        .iter()
        .find(|fold| &fold.fold_id == fold_id)
        .map(Some)
        .ok_or_else(|| {
            DagMlError::RuntimeValidation(format!(
                "fold `{fold_id}` requested but is not present in fold set `{}`",
                fold_set.id
            ))
        })
}

/// Build the parent-bound nested fold set for `node_plan` in `scope`, when an
/// effective inner-CV policy applies. Gated to FIT_CV with an outer fold in
/// scope; returns `Ok(None)` otherwise (no inner CV, or no outer fold to nest
/// within). Keeping the parent identity intact is required by the nested
/// stacking scheduler before it may materialize/cache any OOF block.
pub(crate) fn nested_fold_set_for_scope(
    campaign: &CampaignSpec,
    outer_fold_set: Option<&FoldSet>,
    node_plan: &NodePlan,
    scope: &PhaseScope,
) -> Result<Option<crate::fold::NestedFoldSet>> {
    if scope.phase != Phase::FitCv {
        return Ok(None);
    }
    let Some(spec) =
        crate::fold::resolve_inner_cv(node_plan.inner_cv.as_ref(), campaign.inner_cv.as_ref())
    else {
        return Ok(None);
    };
    // Nested CV needs an outer fold to nest within. `fold_for_scope` yields
    // `None` only when there is no outer fold in scope (skip), and errors if a
    // fold was requested but is missing from the fold set.
    let Some(outer) = fold_for_scope(outer_fold_set, scope.fold_id.as_ref())? else {
        return Ok(None);
    };
    let outer_groups = &outer_fold_set
        .expect("fold_for_scope returned a fold, so the outer fold set is present")
        .sample_groups;
    Ok(Some(spec.build_nested_fold_set(outer, outer_groups)?))
}

/// Compatibility projection for controller `NodeTask` JSON. Existing
/// controllers receive the historical bare inner set; a nested stacking
/// campaign must use [`nested_fold_set_for_scope`] instead so its parent cannot
/// be lost before cache and lineage validation.
pub(crate) fn inner_fold_set_for_scope(
    campaign: &CampaignSpec,
    outer_fold_set: Option<&FoldSet>,
    node_plan: &NodePlan,
    scope: &PhaseScope,
) -> Result<Option<FoldSet>> {
    Ok(
        nested_fold_set_for_scope(campaign, outer_fold_set, node_plan, scope)?
            .map(|nested| nested.inner_fold_set),
    )
}

pub(crate) fn sample_ids_for_partition(
    partition: DataRequestPartition,
    fold_set: Option<&FoldSet>,
    fold: Option<&FoldAssignment>,
) -> Option<Vec<SampleId>> {
    match partition {
        DataRequestPartition::FoldTrain => fold.map(|fold| fold.train_sample_ids.clone()),
        DataRequestPartition::FoldValidation => fold.map(|fold| fold.validation_sample_ids.clone()),
        DataRequestPartition::FullTrain => fold_set.map(|fold_set| {
            // R-P2-22 invariant (REFIT-EXCLUDES-TEST): the REFIT final-fit boundary
            // (COORDINATOR_SPEC §REFIT.1) is the selected *training universe*, EXCLUDING
            // held-out test samples. REFIT resolves to `FullTrain`, whose universe is
            // exactly `fold_set.sample_ids` — the pool the splitter partitioned into
            // train/validation folds. The held-out TEST partition is never passed to the
            // splitter: it is a SEPARATE, host-resolved request (`DataRequestPartition::Predict`,
            // sample_ids `None`) and so cannot appear in `fold_set.sample_ids` by construction.
            // This defense-in-depth assertion names that invariant: every FullTrain sample must
            // be accounted for by some fold's train∪validation set (`FoldSet::validate()` only
            // guarantees the ⊆ direction), so an out-of-fold (test/leakage) sample can never
            // silently enter the refit universe.
            debug_assert!(
                {
                    let in_a_fold: BTreeSet<&SampleId> = fold_set
                        .folds
                        .iter()
                        .flat_map(|fold| {
                            fold.train_sample_ids
                                .iter()
                                .chain(fold.validation_sample_ids.iter())
                        })
                        .collect();
                    fold_set
                        .sample_ids
                        .iter()
                        .all(|sample_id| in_a_fold.contains(sample_id))
                },
                "REFIT FullTrain universe must be fully fold-accounted (train∪validation); a sample outside every fold would be a held-out/test leakage into the refit training set"
            );
            fold_set.sample_ids.clone()
        }),
        DataRequestPartition::Predict => None,
    }
}
