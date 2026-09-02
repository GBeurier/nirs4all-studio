//! Plan-time, data-aware branch fan-out: expanding auto-separation branches
//! into one explicit branch per discovered partition value, with the id
//! rewrite/suffix helpers and the unsupported-construct guards.

use super::*;

/// Metadata key under which [`fan_out_data_aware_branches`] records the
/// deterministic fingerprint of the discovered partition set, so identical
/// data always expands to a byte-identical spec (and therefore a byte-identical
/// graph/campaign fingerprint downstream).
pub const DSL_DATA_AWARE_FANOUT_METADATA_KEY: &str = "dsl_data_aware_fanout";
/// Branch-step metadata flag that opts a single-template branch step into
/// plan-time, data-aware fan-out. Without it a one-branch step is treated as an
/// ordinary explicit branch and left untouched.
pub(crate) const DSL_AUTO_SEPARATE_METADATA_KEY: &str = "auto_separate";
/// Plan-time, data-aware branch fan-out (the keystone of native branch
/// support). Given a parsed pipeline DSL spec and the coordinator data-plan
/// envelope, this turns each *auto-separation* branch step — a single-template
/// branch over a `by_metadata` key or `by_tag` criterion, marked
/// `metadata.auto_separate=true` — into an explicit branch step with **one
/// concrete branch per discovered partition value**, retaining ALL of them.
///
/// This is fan-out, NOT variant generation: variants SELECT one; branches keep
/// every partition. The expansion mirrors the shape of an author-written
/// explicit branch step ([`PipelineDslBranch`] with a per-branch `selector`),
/// so the normal compile path ([`compile_pipeline_dsl_with_generation`]) lowers
/// each branch into its own model node + `BranchViewPlan` with no special
/// handling — the same machinery that backs explicit branches.
///
/// Discovery reads the SORTED distinct values of the criterion from
/// `envelope.coordinator_relations`; the branches are generated in that sorted
/// order so the result is deterministic. The discovered set is fingerprinted
/// (criterion + sorted values + `relation_fingerprint`) into the spec metadata
/// under [`DSL_DATA_AWARE_FANOUT_METADATA_KEY`], so identical data yields a
/// byte-identical expanded spec.
///
/// Specs without any auto-separation branch step are returned unchanged.
///
/// The host calls this AFTER reading the envelope and BEFORE compiling: the
/// envelope (which carries the metadata/tag VALUES) is not available at compile
/// or plan-build time — only at the data-provider boundary — so the fan-out is
/// plan-time-adjacent rather than inside `build_execution_plan`.
pub fn fan_out_data_aware_branches(
    spec: &PipelineDslSpec,
    envelope: &crate::data::ExternalDataPlanEnvelope,
) -> Result<PipelineDslSpec> {
    envelope.validate()?;
    let mut expanded = spec.clone();
    let mut fanouts: Vec<DataAwareFanoutRecord> = Vec::new();
    // old template node id -> the per-clone suffixed ids it expanded into. Every
    // place a template node id can appear (top-level data_bindings, generation
    // param_overrides) is rewritten/validated against this map so no reference
    // dangles or collides after fan-out.
    let mut id_map: NodeIdRewriteMap = BTreeMap::new();
    expanded.steps = fan_out_steps(&spec.steps, envelope, &mut fanouts, &mut id_map)?;
    if fanouts.is_empty() {
        return Ok(expanded);
    }
    // Top-level data bindings (the executable DSL keys these by node id) must be
    // cloned + rewritten per discovered branch, or they dangle/collide at compile.
    expanded.data_bindings = rewrite_top_level_data_bindings(&spec.data_bindings, &id_map)?;
    // Generation param_overrides referencing a fanned template node are NOT
    // supported in a fanned template this slice — reject rather than dangle.
    reject_generation_overrides_for_fanned_nodes(&spec.generation_dimensions, &id_map)?;
    // Deterministic provenance: record the discovered partition sets so identical
    // data expands identically and the change is traceable in the spec metadata.
    // The relation_fingerprint is folded into the canonical fingerprint string so
    // the same partition values from a different relation set still fingerprint
    // distinctly.
    let canonical = serde_json::json!({
        "branches": fanouts,
        "relation_fingerprint": envelope.relation_fingerprint,
    });
    let fingerprint = crate::campaign::stable_json_fingerprint(&canonical)?;
    expanded.metadata.insert(
        DSL_DATA_AWARE_FANOUT_METADATA_KEY.to_string(),
        serde_json::json!({
            "fingerprint": fingerprint,
            "relation_fingerprint": envelope.relation_fingerprint,
            "branches": fanouts,
        }),
    );
    Ok(expanded)
}
/// Maps each original template node id to the list of suffixed ids it expanded
/// into across the discovered branches (one per partition value).
pub(crate) type NodeIdRewriteMap = BTreeMap<NodeId, Vec<NodeId>>;
/// Clone + rewrite the top-level data bindings so that, for every template node
/// id that fan-out replaced with N suffixed ids, there is one binding per
/// suffixed id (same payload, retargeted node id). Bindings for nodes untouched
/// by fan-out are carried through unchanged.
pub(crate) fn rewrite_top_level_data_bindings(
    bindings: &[DataBinding],
    id_map: &NodeIdRewriteMap,
) -> Result<Vec<DataBinding>> {
    let mut out = Vec::new();
    for binding in bindings {
        match id_map.get(&binding.node_id) {
            Some(new_ids) => {
                for new_id in new_ids {
                    let mut clone = binding.clone();
                    clone.node_id = new_id.clone();
                    out.push(clone);
                }
            }
            None => out.push(binding.clone()),
        }
    }
    Ok(out)
}
/// A generation `param_override` targeting a node that fan-out multiplied has no
/// single destination after expansion (it would silently dangle), so reject it
/// with a clear error. Generation × data-aware fan-out is out of scope this slice.
pub(crate) fn reject_generation_overrides_for_fanned_nodes(
    dimensions: &[PipelineDslGenerationDimension],
    id_map: &NodeIdRewriteMap,
) -> Result<()> {
    for dimension in dimensions {
        for choice in &dimension.choices {
            for override_spec in &choice.param_overrides {
                if id_map.contains_key(&override_spec.node_id) {
                    return Err(DagMlError::GraphValidation(format!(
                        "data-aware fan-out cannot rewrite generation param_override targeting \
                         node `{}` (generation overrides on a fanned-out template node are not \
                         supported in this slice)",
                        override_spec.node_id
                    )));
                }
            }
        }
    }
    Ok(())
}
/// Canonical, serialized record of one fan-out expansion. Sorted values keep it
/// deterministic; it feeds both the spec-metadata provenance and the fan-out
/// fingerprint.
#[derive(Clone, Debug, Serialize)]
pub(crate) struct DataAwareFanoutRecord {
    branch_step_id: String,
    mode: PipelineDslBranchMode,
    #[serde(skip_serializing_if = "Option::is_none")]
    metadata_key: Option<String>,
    /// Sorted distinct partition values discovered from the relations.
    values: Vec<serde_json::Value>,
}
pub(crate) fn fan_out_steps(
    steps: &[PipelineDslStep],
    envelope: &crate::data::ExternalDataPlanEnvelope,
    fanouts: &mut Vec<DataAwareFanoutRecord>,
    id_map: &mut NodeIdRewriteMap,
) -> Result<Vec<PipelineDslStep>> {
    let mut out = Vec::with_capacity(steps.len());
    for step in steps {
        out.push(fan_out_step(step, envelope, fanouts, id_map)?);
    }
    Ok(out)
}
pub(crate) fn fan_out_step(
    step: &PipelineDslStep,
    envelope: &crate::data::ExternalDataPlanEnvelope,
    fanouts: &mut Vec<DataAwareFanoutRecord>,
    id_map: &mut NodeIdRewriteMap,
) -> Result<PipelineDslStep> {
    match step {
        PipelineDslStep::Branch(branch_step) => {
            if is_auto_separation_branch(branch_step) {
                return Ok(PipelineDslStep::Branch(expand_auto_separation_branch(
                    branch_step,
                    envelope,
                    fanouts,
                    id_map,
                )?));
            }
            // Explicit branch: recurse into each branch's nested steps so a
            // nested auto-separation branch still expands, but leave the
            // explicit branches themselves untouched.
            let mut expanded = branch_step.clone();
            for branch in &mut expanded.branches {
                branch.steps = fan_out_steps(&branch.steps, envelope, fanouts, id_map)?;
            }
            Ok(PipelineDslStep::Branch(expanded))
        }
        PipelineDslStep::Sequential(sequence) => {
            let mut expanded = sequence.clone();
            expanded.steps = fan_out_steps(&sequence.steps, envelope, fanouts, id_map)?;
            Ok(PipelineDslStep::Sequential(expanded))
        }
        other => Ok(other.clone()),
    }
}
/// A branch step is an auto-separation template iff it is explicitly marked
/// `metadata.auto_separate=true`, is a `by_metadata`/`by_tag`/`separation`
/// criterion, and carries exactly one template branch with no per-branch
/// selector (the body to replicate per discovered value). The explicit marker
/// keeps a one-branch *explicit* branch from being misread as a template.
pub(crate) fn is_auto_separation_branch(step: &PipelineDslBranchStep) -> bool {
    let marked = step
        .metadata
        .get(DSL_AUTO_SEPARATE_METADATA_KEY)
        .and_then(serde_json::Value::as_bool)
        .unwrap_or(false);
    marked
        && matches!(
            step.mode,
            PipelineDslBranchMode::ByMetadata
                | PipelineDslBranchMode::ByTag
                | PipelineDslBranchMode::Separation
        )
        && step.branches.len() == 1
        && step.branches[0].selector.is_none()
}
pub(crate) fn expand_auto_separation_branch(
    step: &PipelineDslBranchStep,
    envelope: &crate::data::ExternalDataPlanEnvelope,
    fanouts: &mut Vec<DataAwareFanoutRecord>,
    id_map: &mut NodeIdRewriteMap,
) -> Result<PipelineDslBranchStep> {
    let template = &step.branches[0];
    // Reject template bodies that carry node-id CROSS-references this slice does
    // not fully rewrite (merge selector `model` refs, concat inner operator ids),
    // rather than silently leaving them dangling after the per-branch rename.
    reject_unsupported_template_constructs(&template.id, &template.steps)?;
    let relations = envelope.coordinator_relations.as_ref().ok_or_else(|| {
        DagMlError::GraphValidation(format!(
            "data-aware fan-out of branch `{}` requires coordinator relations in the envelope",
            template.id
        ))
    })?;
    let (mode, metadata_key, values) = discover_partition_values(step, template, relations)?;
    if values.is_empty() {
        return Err(DagMlError::GraphValidation(format!(
            "data-aware fan-out of branch `{}` discovered no partition values in the relations",
            template.id
        )));
    }

    let mut branches = Vec::with_capacity(values.len());
    let mut seen_ids = BTreeSet::new();
    for value in &values {
        let mut branch = template.clone();
        let suffix = fanout_value_suffix(value);
        branch.id = format!("{}__{suffix}", template.id);
        if !seen_ids.insert(branch.id.clone()) {
            return Err(DagMlError::GraphValidation(format!(
                "data-aware fan-out of branch `{}` produced duplicate branch id `{}` \
                 (distinct partition values render to the same id)",
                template.id, branch.id
            )));
        }
        branch.selector = Some(branch_selector_for_value(
            mode,
            metadata_key.as_deref(),
            value,
        ));
        // Each cloned branch needs unique node ids — the template body is reused
        // verbatim, so suffix every node id. The collected old->new ids feed the
        // top-level data_bindings/param_override rewrite + validation.
        rewrite_branch_step_ids(&mut branch.steps, &suffix, id_map)?;
        branches.push(branch);
    }

    fanouts.push(DataAwareFanoutRecord {
        branch_step_id: template.id.clone(),
        mode: step.mode,
        metadata_key: metadata_key.clone(),
        values,
    });

    let mut expanded = step.clone();
    // Drop the auto_separate marker from the now-explicit step so the compiler
    // sees an ordinary enumerated branch step and re-running fan-out is a no-op.
    expanded.metadata.remove(DSL_AUTO_SEPARATE_METADATA_KEY);
    expanded.branches = branches;
    Ok(expanded)
}
/// Discover the SORTED distinct values of the branch criterion from the
/// coordinator relations. Returns `(resolved_mode, metadata_key, values)`.
pub(crate) fn discover_partition_values(
    step: &PipelineDslBranchStep,
    template: &PipelineDslBranch,
    relations: &crate::relation::SampleRelationSet,
) -> Result<(BranchViewMode, Option<String>, Vec<serde_json::Value>)> {
    // For Separation (auto) we resolve to by_metadata when a key is present,
    // else by_tag.
    let metadata_key = step
        .selector
        .as_ref()
        .and_then(selector_metadata_key)
        .or_else(|| template.selector.as_ref().and_then(selector_metadata_key));
    let resolved_mode = match step.mode {
        PipelineDslBranchMode::ByMetadata => BranchViewMode::ByMetadata,
        PipelineDslBranchMode::ByTag => BranchViewMode::ByTag,
        PipelineDslBranchMode::Separation => {
            if metadata_key.is_some() {
                BranchViewMode::ByMetadata
            } else {
                BranchViewMode::ByTag
            }
        }
        // Only by_metadata / by_tag / separation reach here (is_auto_separation_branch).
        other => {
            return Err(DagMlError::GraphValidation(format!(
                "data-aware fan-out of branch `{}` does not support mode {other:?}",
                template.id
            )));
        }
    };

    match resolved_mode {
        BranchViewMode::ByMetadata => {
            let key = metadata_key.ok_or_else(|| {
                DagMlError::GraphValidation(format!(
                    "data-aware by_metadata fan-out of branch `{}` requires a metadata key on the \
                     branch step or template selector",
                    template.id
                ))
            })?;
            let mut values: Vec<serde_json::Value> = relations
                .records
                .iter()
                .filter_map(|record| record.metadata.get(&key).cloned())
                .collect();
            sort_dedup_json_values(&mut values);
            Ok((resolved_mode, Some(key), values))
        }
        BranchViewMode::ByTag => {
            let mut tags: Vec<String> = relations
                .records
                .iter()
                .flat_map(|record| record.tags.iter().cloned())
                .collect();
            tags.sort();
            tags.dedup();
            let values = tags.into_iter().map(serde_json::Value::String).collect();
            Ok((resolved_mode, None, values))
        }
        other => Err(DagMlError::GraphValidation(format!(
            "data-aware fan-out of branch `{}` does not support resolved mode {other:?}",
            template.id
        ))),
    }
}
/// Per-branch selector targeting exactly one discovered value, in the shape the
/// explicit-branch selector lowering already understands
/// (`branch_view_selector_by_metadata` / `_by_tag`).
pub(crate) fn branch_selector_for_value(
    mode: BranchViewMode,
    metadata_key: Option<&str>,
    value: &serde_json::Value,
) -> serde_json::Value {
    match mode {
        BranchViewMode::ByMetadata => {
            let key = metadata_key.unwrap_or_default();
            serde_json::json!({ "metadata": { key: value.clone() } })
        }
        // by_tag values are always strings (discovered from `tags`).
        _ => serde_json::json!({ "tags": [value.clone()] }),
    }
}
/// Deterministic, identifier-safe suffix for a discovered partition value, used
/// for both the branch id and the per-branch node-id rewrites.
pub(crate) fn fanout_value_suffix(value: &serde_json::Value) -> String {
    let rendered = match value {
        serde_json::Value::String(text) => text.clone(),
        other => other.to_string(),
    };
    let sanitized = rendered
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || character == '_' {
                character
            } else {
                '_'
            }
        })
        .collect::<String>();
    let sanitized = sanitized.trim_matches('_');
    if sanitized.is_empty() {
        "empty".to_string()
    } else {
        sanitized.to_string()
    }
}
/// Reject template bodies that contain node-id cross-referencing constructs
/// (merge / merge_model / concat_transform) which this slice does not fully
/// rewrite. Leaving their internal refs (merge selector `model`, concat inner
/// operator ids) unrewritten after the per-branch rename would dangle, so fail
/// loud instead. Plain operator/model/transform bodies, nested sequences,
/// generators and nested branches are supported (their ids carry no sibling
/// cross-references).
pub(crate) fn reject_unsupported_template_constructs(
    template_id: &str,
    steps: &[PipelineDslStep],
) -> Result<()> {
    for step in steps {
        let unsupported = match step {
            PipelineDslStep::Merge(_) => Some("merge"),
            PipelineDslStep::MergeModel(_) => Some("merge_model"),
            PipelineDslStep::ConcatTransform(_) => Some("concat_transform"),
            _ => None,
        };
        if let Some(kind) = unsupported {
            return Err(DagMlError::GraphValidation(format!(
                "data-aware fan-out of branch `{template_id}` does not support a `{kind}` step \
                 inside the auto-separation template (its node-id cross-references cannot be \
                 safely cloned per partition in this slice)"
            )));
        }
        // Recurse into containers so a deeply-nested merge/concat is also caught.
        match step {
            PipelineDslStep::Sequential(sequence) => {
                reject_unsupported_template_constructs(template_id, &sequence.steps)?;
            }
            PipelineDslStep::Branch(branch) => {
                for nested in &branch.branches {
                    reject_unsupported_template_constructs(template_id, &nested.steps)?;
                }
            }
            PipelineDslStep::Generator(generator) => {
                for nested in &generator.branches {
                    reject_unsupported_template_constructs(template_id, &nested.steps)?;
                }
                for stage in &generator.stages {
                    for nested in &stage.branches {
                        reject_unsupported_template_constructs(template_id, &nested.steps)?;
                    }
                }
            }
            _ => {}
        }
    }
    Ok(())
}
/// Suffix every node id inside a cloned template branch so the per-partition
/// copies have unique node ids, recording each old->new mapping into `id_map`
/// so the caller can rewrite top-level references (data_bindings) and reject
/// unrewritable ones (generation param_overrides). DSL steps connect by
/// sequential data flow, not by id cross-reference, so suffixing the node ids is
/// sufficient for the supported template constructs.
pub(crate) fn rewrite_branch_step_ids(
    steps: &mut [PipelineDslStep],
    suffix: &str,
    id_map: &mut NodeIdRewriteMap,
) -> Result<()> {
    for step in steps.iter_mut() {
        rewrite_step_id(step, suffix, id_map)?;
    }
    Ok(())
}
pub(crate) fn record_rewrite(id_map: &mut NodeIdRewriteMap, old_id: &NodeId, new_id: &NodeId) {
    id_map
        .entry(old_id.clone())
        .or_default()
        .push(new_id.clone());
}
pub(crate) fn suffix_and_record(
    id: &NodeId,
    suffix: &str,
    id_map: &mut NodeIdRewriteMap,
) -> Result<NodeId> {
    let new_id = NodeId::new(format!("{}__{suffix}", id.as_str()))?;
    record_rewrite(id_map, id, &new_id);
    Ok(new_id)
}
pub(crate) fn rewrite_step_id(
    step: &mut PipelineDslStep,
    suffix: &str,
    id_map: &mut NodeIdRewriteMap,
) -> Result<()> {
    match step {
        PipelineDslStep::Transform(op)
        | PipelineDslStep::YTransform(op)
        | PipelineDslStep::Tag(op)
        | PipelineDslStep::Exclude(op)
        | PipelineDslStep::Filter(op)
        | PipelineDslStep::SampleFilter(op)
        | PipelineDslStep::Augmentation(op)
        | PipelineDslStep::FeatureAugmentation(op)
        | PipelineDslStep::SampleAugmentation(op)
        | PipelineDslStep::DataGeneration(op)
        | PipelineDslStep::Model(op)
        | PipelineDslStep::Tuner(op)
        | PipelineDslStep::Chart(op) => {
            op.id = suffix_and_record(&op.id, suffix, id_map)?;
        }
        // merge / merge_model / concat are rejected upstream by
        // reject_unsupported_template_constructs; keep their id rewrite for
        // completeness if that gate ever relaxes.
        PipelineDslStep::ConcatTransform(concat) => {
            concat.id = suffix_and_record(&concat.id, suffix, id_map)?;
        }
        PipelineDslStep::Merge(merge) => {
            merge.id = suffix_and_record(&merge.id, suffix, id_map)?;
        }
        PipelineDslStep::MergeModel(merge) => {
            merge.id = suffix_and_record(&merge.id, suffix, id_map)?;
        }
        PipelineDslStep::Sequential(sequence) => {
            if let Some(id) = sequence.id.as_ref() {
                sequence.id = Some(suffix_and_record(id, suffix, id_map)?);
            }
            rewrite_branch_step_ids(&mut sequence.steps, suffix, id_map)?;
        }
        PipelineDslStep::Branch(branch) => {
            for nested in branch.branches.iter_mut() {
                rewrite_branch_step_ids(&mut nested.steps, suffix, id_map)?;
            }
        }
        PipelineDslStep::Generator(generator) => {
            generator.id = suffix_and_record(&generator.id, suffix, id_map)?;
            for nested in generator.branches.iter_mut() {
                rewrite_branch_step_ids(&mut nested.steps, suffix, id_map)?;
            }
            for stage in generator.stages.iter_mut() {
                for nested in stage.branches.iter_mut() {
                    rewrite_branch_step_ids(&mut nested.steps, suffix, id_map)?;
                }
            }
            rewrite_branch_step_ids(&mut generator.tail, suffix, id_map)?;
        }
    }
    Ok(())
}
/// Sort + dedup JSON values deterministically by their canonical string form
/// (relations carry heterogeneous JSON; a stable string key gives a total,
/// reproducible order without imposing a numeric/string type assumption).
pub(crate) fn sort_dedup_json_values(values: &mut Vec<serde_json::Value>) {
    values.sort_by_key(|value| value.to_string());
    values.dedup_by_key(|value| value.to_string());
}
