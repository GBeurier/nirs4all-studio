//! Portable, scope-bound evidence for native local HPO. No numerical work lives here.

use crate::bundle::{MethodsHpoResumeProvenance, MethodsHpoResumeState};
use crate::campaign::stable_json_fingerprint;
use crate::error::{DagMlError, Result};
use crate::fold::{FoldPartitionMode, FoldSet, NestedFoldSet};
use crate::ids::{FoldId, NodeId, VariantId};
use crate::phase::Phase;
use crate::plan::ExecutionPlan;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};

fn invalid(message: impl Into<String>) -> DagMlError {
    DagMlError::RuntimeValidation(format!("native fold HPO: {}", message.into()))
}

/// Immutable input folds, supplied structurally by the public splitter adapter.
pub fn validate_methods_fold_hpo_folds(
    plan: &ExecutionPlan,
    inner: &BTreeMap<FoldId, NestedFoldSet>,
    refit: &FoldSet,
) -> Result<()> {
    let outer = plan
        .fold_set
        .as_ref()
        .ok_or_else(|| invalid("requires outer folds"))?;
    outer.validate()?;
    if outer.partition_mode != FoldPartitionMode::Partition || outer.folds.len() < 2 {
        return Err(invalid("requires at least two partition outer folds"));
    }
    if inner.keys().collect::<BTreeSet<_>>() != outer.folds.iter().map(|f| &f.fold_id).collect() {
        return Err(invalid(
            "inner folds must exactly cover the outer fold identities",
        ));
    }
    let mut ids = outer
        .folds
        .iter()
        .map(|f| f.fold_id.clone())
        .collect::<BTreeSet<_>>();
    for assignment in &outer.folds {
        let nested = &inner[&assignment.fold_id];
        nested.validate_for_outer(assignment)?;
        validate_study_universe(&nested.inner_fold_set, outer, &assignment.train_sample_ids)?;
        for fold in &nested.inner_fold_set.folds {
            if !ids.insert(fold.fold_id.clone()) {
                return Err(invalid("inner fold identifiers must be globally unique"));
            }
        }
    }
    validate_study_universe(refit, outer, &outer.sample_ids)?;
    for fold in &refit.folds {
        if !ids.insert(fold.fold_id.clone()) {
            return Err(invalid(
                "REFIT inner fold identifier collides with another scope",
            ));
        }
    }
    Ok(())
}

fn validate_study_universe(
    inner: &FoldSet,
    root: &FoldSet,
    samples: &[crate::SampleId],
) -> Result<()> {
    inner.validate()?;
    let expected = samples.iter().collect::<BTreeSet<_>>();
    let groups = root
        .sample_groups
        .iter()
        .filter(|(id, _)| expected.contains(id))
        .map(|(id, group)| (id.clone(), group.clone()))
        .collect::<BTreeMap<_, _>>();
    if inner.partition_mode != FoldPartitionMode::Partition
        || inner.folds.len() < 2
        || inner.sample_ids.iter().collect::<BTreeSet<_>>() != expected
        || inner.sample_groups != groups
        || inner.train_exclusion != root.train_exclusion
        || inner
            .target_missing_sample_ids
            .iter()
            .collect::<BTreeSet<_>>()
            != root
                .target_missing_sample_ids
                .iter()
                .collect::<BTreeSet<_>>()
    {
        return Err(invalid("study universe, groups, exclusion authority, target-missing declaration or partition differs from its training scope"));
    }
    Ok(())
}

/// Scope identities are explicit; readers never infer parents from fold names.
pub fn methods_fold_hpo_scope_id(operation: &str, outer: Option<&FoldId>) -> String {
    match outer {
        Some(fold) => format!("{operation}:scope:fit_cv:{fold}"),
        None => format!("{operation}:scope:refit"),
    }
}

/// Coordinator identities only. Numerical buffers remain provider-owned.
pub fn methods_fold_hpo_scope_relations(
    root: &crate::relation::SampleRelationSet,
    folds: &FoldSet,
) -> crate::relation::SampleRelationSet {
    let ids = folds.sample_ids.iter().collect::<BTreeSet<_>>();
    crate::relation::SampleRelationSet {
        records: root
            .records
            .iter()
            .filter(|record| ids.contains(&record.sample_id))
            .cloned()
            .collect(),
    }
}

/// Reconstruct the exact inner-study plan from the attested root plan.
pub fn methods_fold_hpo_study_plan(
    base: &ExecutionPlan,
    scope_id: &str,
    folds: &FoldSet,
) -> Result<ExecutionPlan> {
    let mut plan = base.clone();
    plan.fold_set = Some(folds.clone());
    if let Some(split) = &mut plan.campaign.split_invocation {
        split.fold_set = Some(folds.clone());
    }
    plan.campaign.inner_cv = None;
    for node in plan.node_plans.values_mut() {
        node.inner_cv = None;
    }
    let operation = plan
        .campaign
        .metadata
        .get_mut("methods_hpo_operation")
        .ok_or_else(|| invalid("missing signed operation"))?;
    let raw = operation
        .as_object_mut()
        .ok_or_else(|| invalid("missing signed operation"))?;
    raw.insert("schema_version".into(), Value::from(2));
    raw.insert("operation_id".into(), Value::from(scope_id));
    raw.remove("scope");
    raw.remove("inner_fold_sets");
    raw.remove("refit_inner_fold_set");
    raw.remove("resume_package_json");
    let study = raw
        .get_mut("study")
        .and_then(Value::as_object_mut)
        .ok_or_else(|| invalid("missing native study configuration"))?;
    let root_study = study
        .get("study_id")
        .and_then(Value::as_str)
        .ok_or_else(|| invalid("missing native study identity"))?;
    study.insert(
        "study_id".into(),
        Value::from(format!("{root_study}:{scope_id}")),
    );
    // Canonicalize only dynamic JSON, retaining the typed campaign field order
    // and all ordered folds/parameters. Python's sorted JSON must replay this
    // exact native scope without changing its fingerprint.
    operation.sort_all_objects();
    plan.campaign_fingerprint = stable_json_fingerprint(&plan.campaign)?;
    plan.validate()?;
    Ok(plan)
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MethodsFoldHpoScopeState {
    pub scope_id: String,
    pub phase: Phase,
    pub outer_fold_id: Option<FoldId>,
    pub inner_fold_set: FoldSet,
    pub scope_plan_fingerprint: String,
    pub winner_variant_id: VariantId,
    pub winner_params: BTreeMap<String, Value>,
    pub params_fingerprint: String,
    pub resume_state: MethodsHpoResumeState,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MethodsFoldHpoState {
    pub schema_version: u32,
    pub operation_id: String,
    pub target_node_id: NodeId,
    pub base_plan: ExecutionPlan,
    pub selected_variant_id: VariantId,
    pub provenance: MethodsHpoResumeProvenance,
    pub relations: crate::relation::SampleRelationSet,
    pub outer_scopes: Vec<MethodsFoldHpoScopeState>,
    pub refit_scope: MethodsFoldHpoScopeState,
}

impl MethodsFoldHpoScopeState {
    pub fn effective_params(
        &self,
        base: &ExecutionPlan,
        target: &NodeId,
    ) -> Result<BTreeMap<String, Value>> {
        let mut params = base
            .node_plans
            .get(target)
            .ok_or_else(|| invalid("missing target"))?
            .params
            .clone();
        params.extend(self.winner_params.clone());
        Ok(params)
    }
    fn validate_for(
        &self,
        state: &MethodsFoldHpoState,
        folds: &FoldSet,
        outer: Option<&FoldId>,
    ) -> Result<()> {
        if self.resume_state.target_node_id != state.target_node_id {
            return Err(invalid("scope target differs from its root authority"));
        }
        let target = state
            .base_plan
            .node_plans
            .get(&state.target_node_id)
            .ok_or_else(|| invalid("root target is absent from the base plan"))?;
        let scope_id = methods_fold_hpo_scope_id(&state.operation_id, outer);
        let plan = methods_fold_hpo_study_plan(&state.base_plan, &scope_id, folds)?;
        if self.scope_id != scope_id
            || self.outer_fold_id.as_ref() != outer
            || self.phase
                != if outer.is_some() {
                    Phase::FitCv
                } else {
                    Phase::Refit
                }
            || self.inner_fold_set != *folds
            || self.scope_plan_fingerprint != stable_json_fingerprint(&plan)?
        {
            return Err(invalid(
                "scope ownership or reconstructed study-plan fingerprint differs",
            ));
        }
        self.resume_state.validate_against_plan(&plan)?;
        let relations = methods_fold_hpo_scope_relations(&state.relations, folds);
        relations.validate_against_fold_set(folds, &plan.campaign.leakage_policy)?;
        if let Some(split) = &plan.campaign.split_invocation {
            relations.validate_against_fold_set(folds, &split.leakage_policy)?;
        }
        let raw = &plan.campaign.metadata["methods_hpo_operation"];
        let study: crate::hpo::MethodsHpoStudyConfig =
            serde_json::from_value(raw["study"].clone())?;
        let paths: BTreeMap<String, String> =
            serde_json::from_value(raw["parameter_paths"].clone())?;
        if target.controller_id.as_str()
            != crate::methods_phase_controls::METHODS_NATIVE_REGRESSION_CONTROLLER
        {
            return Err(invalid(
                "scope target is not the closed native PLS controller",
            ));
        }
        crate::methods_phase_controls::validate_native_pls_hpo_space(&study.search_space, &paths)?;
        let provenance = &self.resume_state.provenance;
        if self.resume_state.operation_id != scope_id
            || self.resume_state.target_node_id != state.target_node_id
            || self.resume_state.checkpoint.binding.study_id != study.study_id
            || self.resume_state.checkpoint.binding.controller_id != study.controller_id
            || provenance.data_identities_fingerprint
                != state.provenance.data_identities_fingerprint
            || provenance.training_influence_fingerprint
                != state.provenance.training_influence_fingerprint
            || provenance.relation_fingerprint != state.provenance.relation_fingerprint
            || provenance.selection != state.provenance.selection
        {
            return Err(invalid(
                "scope checkpoint/provenance/selection does not match its authority",
            ));
        }
        let search_fingerprint = study
            .search_space
            .fingerprint()
            .map_err(|e| invalid(e.to_string()))?;
        let optimizer_fingerprint =
            crate::canonical::parse_typed_json(&serde_json::to_string(&study.optimizer)?)
                .and_then(|v| v.fingerprint())
                .map_err(|e| invalid(e.to_string()))?;
        if self
            .resume_state
            .checkpoint
            .binding
            .search_space_fingerprint
            != search_fingerprint
            || self.resume_state.checkpoint.binding.optimizer_fingerprint != optimizer_fingerprint
            || self.resume_state.checkpoint.methods_abi != study.methods_abi
            || u64::from(self.resume_state.trial_history_len) > raw["trials"].as_u64().unwrap_or(0)
        {
            return Err(invalid(
                "scope checkpoint configuration or total history budget differs",
            ));
        }
        let base_variant = &state.base_plan.variants[0];
        let namespace = stable_json_fingerprint(&(&scope_id, &base_variant.variant_id))?;
        for proposal in &self.resume_state.completed_proposals {
            let terminal = self
                .resume_state
                .terminal_trials
                .iter()
                .find(|t| t.trial.id == proposal.trial_id)
                .ok_or_else(|| invalid("proposal has no native terminal trial"))?;
            if terminal.trial.parameters.keys().collect::<BTreeSet<_>>() != paths.keys().collect() {
                return Err(invalid(
                    "native trial axes differ from the signed search space",
                ));
            }
            let mut params = BTreeMap::new();
            for (name, target_name) in &paths {
                let p = &terminal.trial.parameters[name];
                let value = match name.as_str() {
                    "n_components"
                        if p.active
                            && p.integer
                            && p.value.fract() == 0.0
                            && (1.0..=3.0).contains(&p.value) =>
                    {
                        Value::from(p.value as i64)
                    }
                    "scale"
                        if p.active
                            && p.native_kind
                                == Some(crate::hpo::HpoNativeParameterKind::Categorical)
                            && p.category_type == Some(crate::hpo::HpoCategoryType::Boolean)
                            && matches!(p.category_index, Some(0 | 1)) =>
                    {
                        Value::from(p.category_index == Some(1))
                    }
                    _ => {
                        return Err(invalid(
                            "native trial parameter is not a typed closed PLS value",
                        ))
                    }
                };
                params.insert(target_name.clone(), value);
            }
            let mut expected = base_variant.clone();
            expected.choices.insert(
                "native_methods_hpo".into(),
                crate::generation::GenerationChoice {
                    label: format!("trial:{}", proposal.trial_id),
                    value: serde_json::json!({"trial_id":proposal.trial_id}),
                    param_overrides: vec![crate::generation::GenerationParamOverride {
                        node_id: state.target_node_id.clone(),
                        params,
                    }],
                    active_subsequence: None,
                },
            );
            expected.variant_id =
                VariantId::new(format!("hpo:scope:{namespace}:trial:{}", proposal.trial_id))?;
            expected.fingerprint = stable_json_fingerprint(&(
                base_variant.fingerprint.as_str(),
                &namespace,
                &expected.choices,
                proposal.trial_id,
            ))?;
            if expected != proposal.variant {
                return Err(invalid(
                    "proposal parameters/identity differ from its native scoped trial",
                ));
            }
        }
        let proposal = self
            .resume_state
            .completed_proposals
            .iter()
            .find(|p| p.variant.variant_id == self.winner_variant_id)
            .ok_or_else(|| invalid("winner is not a completed scoped proposal"))?;
        let choice = proposal
            .variant
            .choices
            .get("native_methods_hpo")
            .ok_or_else(|| invalid("winner lacks typed native parameters"))?;
        let [overrides] = choice.param_overrides.as_slice() else {
            return Err(invalid("winner parameter ownership is ambiguous"));
        };
        if overrides.node_id != state.target_node_id
            || overrides.params != self.winner_params
            || self.winner_params.keys().collect::<BTreeSet<_>>() != paths.values().collect()
            || self.params_fingerprint
                != stable_json_fingerprint(
                    &self.effective_params(&state.base_plan, &state.target_node_id)?,
                )?
        {
            return Err(invalid(
                "winner parameters or effective parameter fingerprint differs",
            ));
        }
        crate::methods_phase_controls::validate_native_pls_model_controls(&self.winner_params)?;
        let report = self
            .resume_state
            .completed_reports
            .iter()
            .find(|r| r.variant_id == self.winner_variant_id)
            .ok_or_else(|| invalid("winner lacks its inner OOF report"))?;
        if report.score.to_bits() != self.resume_state.incumbent.score.to_bits() {
            return Err(invalid(
                "DAG winner differs from the native best inner score",
            ));
        }
        let folds_by_id = folds
            .folds
            .iter()
            .map(|f| (&f.fold_id, f))
            .collect::<BTreeMap<_, _>>();
        for candidate in &self.resume_state.candidates {
            let proposed = self
                .resume_state
                .completed_proposals
                .iter()
                .find(|p| p.trial_id == candidate.trial_id)
                .ok_or_else(|| invalid("candidate is orphaned"))?;
            let params = proposed.variant.choices["native_methods_hpo"].param_overrides[0]
                .params
                .clone();
            let mut effective = target.params.clone();
            effective.extend(params);
            let fingerprint = stable_json_fingerprint(&effective)?;
            let mut seen = BTreeSet::new();
            for prediction in &candidate.predictions {
                let id = prediction
                    .fold_id
                    .as_ref()
                    .ok_or_else(|| invalid("inner prediction lacks fold"))?;
                let fold = folds_by_id
                    .get(id)
                    .ok_or_else(|| invalid("inner prediction crosses scope"))?;
                if prediction.sample_ids.iter().collect::<BTreeSet<_>>()
                    != fold.validation_sample_ids.iter().collect()
                    || !seen.insert(id)
                {
                    return Err(invalid(
                        "inner OOF does not exactly cover its validation fold",
                    ));
                }
            }
            if seen != folds_by_id.keys().copied().collect() {
                return Err(invalid("inner candidate misses a validation fold"));
            }
            let mut lineage_folds = BTreeSet::new();
            for record in &candidate.lineage {
                if record.node_id == state.target_node_id
                    && (record.params_fingerprint != fingerprint
                        || record.phase != Phase::FitCv
                        || record.variant_id.as_ref() != Some(&candidate.variant_id)
                        || record
                            .fold_id
                            .as_ref()
                            .is_none_or(|id| !folds_by_id.contains_key(id)))
                {
                    return Err(invalid(
                        "inner candidate lineage parameters/fold cross scope",
                    ));
                }
                if record.node_id == state.target_node_id {
                    lineage_folds.insert(record.fold_id.as_ref().expect("validated fold"));
                }
            }
            if lineage_folds != folds_by_id.keys().copied().collect() {
                return Err(invalid("inner target lineage misses a fit fold"));
            }
        }
        Ok(())
    }
}

impl MethodsFoldHpoState {
    pub fn validate(&self) -> Result<()> {
        self.base_plan.validate()?;
        let raw = self
            .base_plan
            .campaign
            .metadata
            .get("methods_hpo_operation")
            .ok_or_else(|| invalid("base plan lacks operation"))?;
        if self.schema_version != 1
            || raw["schema_version"] != 3
            || raw["scope"] != "fold"
            || raw["native_profile"] != crate::methods_phase_controls::METHODS_PLS_ROLE_PROFILE
            || raw["operation_id"].as_str() != Some(self.operation_id.as_str())
            || raw["target_node_id"].as_str() != Some(self.target_node_id.as_str())
            || self.base_plan.variants.len() != 1
        {
            return Err(invalid("unsupported state/base-plan identity"));
        }
        self.base_plan
            .node_plans
            .get(&self.target_node_id)
            .ok_or_else(|| invalid("root target is absent from the base plan"))?;
        crate::methods_phase_controls::validate_native_pls_phase_plan(&self.base_plan)?;
        let inner: BTreeMap<FoldId, NestedFoldSet> =
            serde_json::from_value(raw["inner_fold_sets"].clone())?;
        let refit: FoldSet = serde_json::from_value(raw["refit_inner_fold_set"].clone())?;
        validate_methods_fold_hpo_folds(&self.base_plan, &inner, &refit)?;
        if self.relations.fingerprint()? != self.provenance.relation_fingerprint {
            return Err(invalid(
                "durable coordinator relation table differs from root authority",
            ));
        }
        let outer = self.base_plan.fold_set.as_ref().expect("validated folds");
        self.relations
            .validate_against_fold_set(outer, &self.base_plan.campaign.leakage_policy)?;
        if let Some(split) = &self.base_plan.campaign.split_invocation {
            self.relations
                .validate_against_fold_set(outer, &split.leakage_policy)?;
        }
        if self.provenance.graph_fingerprint != self.base_plan.graph_fingerprint
            || self.provenance.campaign_fingerprint
                != crate::hpo::campaign_provenance_fingerprint(&self.base_plan.campaign)?
            || self.provenance.controller_fingerprint != self.base_plan.controller_fingerprint
            || self.provenance.fold_set_fingerprint
                != stable_json_fingerprint(
                    self.base_plan.fold_set.as_ref().expect("validated folds"),
                )?
            || self.provenance.selection.target_node_id != self.target_node_id
        {
            return Err(invalid("root provenance differs from base plan"));
        }
        if self.outer_scopes.len() != inner.len()
            || self
                .outer_scopes
                .windows(2)
                .any(|p| p[0].outer_fold_id >= p[1].outer_fold_id)
        {
            return Err(invalid(
                "outer scopes must be sorted and exactly cover folds",
            ));
        }
        for scope in &self.outer_scopes {
            let outer = scope
                .outer_fold_id
                .as_ref()
                .ok_or_else(|| invalid("outer scope lacks parent"))?;
            let folds = inner
                .get(outer)
                .ok_or_else(|| invalid("unknown outer scope"))?;
            scope.validate_for(self, &folds.inner_fold_set, Some(outer))?;
        }
        self.refit_scope.validate_for(self, &refit, None)?;
        if self.selected_variant_id != self.refit_scope.winner_variant_id {
            return Err(invalid(
                "selected variant is not the independent REFIT winner",
            ));
        }
        Ok(())
    }
    pub fn validate_against_plan(&self, plan: &ExecutionPlan) -> Result<()> {
        self.validate()?;
        let mut expected = self.base_plan.clone();
        expected.variants = self
            .refit_scope
            .resume_state
            .completed_proposals
            .iter()
            .filter(|p| p.variant.variant_id == self.selected_variant_id)
            .map(|p| p.variant.clone())
            .collect();
        expected = crate::training_runtime::materialize_selected_variant(
            expected,
            &self.selected_variant_id,
        )?;
        if expected != *plan {
            return Err(invalid(
                "final plan differs from independent REFIT selection",
            ));
        }
        Ok(())
    }
    pub fn cv_params_fingerprint(&self, fold: &FoldId) -> Result<String> {
        if let Some(scope) = self
            .outer_scopes
            .iter()
            .find(|s| s.outer_fold_id.as_ref() == Some(fold))
        {
            Ok(scope.params_fingerprint.clone())
        } else if matches!(fold.as_str(), "avg" | "w_avg") {
            stable_json_fingerprint(
                &self
                    .outer_scopes
                    .iter()
                    .map(|s| (&s.outer_fold_id, &s.params_fingerprint))
                    .collect::<Vec<_>>(),
            )
        } else {
            Err(invalid("unknown outer fold for parameter fingerprint"))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{KFoldSpec, ObservationId, SampleId, SampleRelation, SampleRelationSet};

    #[test]
    fn study_universe_requires_the_root_target_missing_declaration_as_a_set() {
        let ids = (0..7)
            .map(|i| SampleId::new(format!("sample:{i}")).unwrap())
            .collect::<Vec<_>>();
        let (m0, m1) = (ids[5].clone(), ids[6].clone());
        let mut root = KFoldSpec {
            n_splits: 2,
            shuffle: false,
            seed: None,
        }
        .split("scope:root", &ids[..5])
        .unwrap();
        root.target_missing_sample_ids = vec![m1.clone(), m0.clone()];
        let mut study = KFoldSpec {
            n_splits: 2,
            shuffle: false,
            seed: None,
        }
        .split("scope:study", &ids[..5])
        .unwrap();
        assert!(validate_study_universe(&study, &root, &ids[..5]).is_err());
        study.target_missing_sample_ids = vec![m0, m1];
        validate_study_universe(&study, &root, &ids[..5]).unwrap();
    }

    #[test]
    fn scoped_relation_table_preserves_identity_authority_and_refuses_origin_leakage() {
        let ids = (0..8)
            .map(|i| SampleId::new(format!("sample:{i}")).unwrap())
            .collect::<Vec<_>>();
        let root = SampleRelationSet {
            records: ids
                .iter()
                .enumerate()
                .map(|(i, id)| {
                    SampleRelation::new(
                        ObservationId::new(format!("observation:{i}")).unwrap(),
                        id.clone(),
                    )
                })
                .collect(),
        };
        let folds = KFoldSpec {
            n_splits: 2,
            shuffle: false,
            seed: None,
        }
        .split("scope:inner", &ids[..4])
        .unwrap();
        let mut scoped = methods_fold_hpo_scope_relations(&root, &folds);
        assert_eq!(scoped.records.len(), 4);
        let policy = crate::LeakageUnitPolicy::default();
        scoped.validate_against_fold_set(&folds, &policy).unwrap();
        let validation = &folds.folds[0].validation_sample_ids[0];
        let train = &folds.folds[0].train_sample_ids[0];
        scoped
            .records
            .iter_mut()
            .find(|r| &r.sample_id == validation)
            .unwrap()
            .origin_sample_id = Some(train.clone());
        let mut strict = policy;
        strict.forbid_origin_cross_fold = true;
        assert!(scoped.validate_against_fold_set(&folds, &strict).is_err());
        assert!(root.records.iter().all(|r| r.origin_sample_id.is_none()));
    }

    #[test]
    fn scoped_relation_table_retains_exclusions_and_group_authority() {
        let ids = (0..4)
            .map(|i| SampleId::new(format!("sample:{i}")).unwrap())
            .collect::<Vec<_>>();
        let mut root = SampleRelationSet {
            records: ids
                .iter()
                .enumerate()
                .map(|(i, id)| {
                    let mut record = SampleRelation::new(
                        ObservationId::new(format!("observation:{i}")).unwrap(),
                        id.clone(),
                    );
                    record.group_id = Some(crate::GroupId::new(format!("group:{i}")).unwrap());
                    record.excluded = i == 0;
                    record
                })
                .collect(),
        };
        let mut folds = KFoldSpec {
            n_splits: 2,
            shuffle: false,
            seed: None,
        }
        .split("scope:inner", &ids)
        .unwrap();
        folds.sample_groups = root
            .records
            .iter()
            .map(|r| (r.sample_id.clone(), r.group_id.clone().unwrap()))
            .collect();
        let scoped = methods_fold_hpo_scope_relations(&root, &folds);
        assert!(scoped.records[0].excluded);
        let policy = crate::LeakageUnitPolicy {
            split_unit: crate::SplitUnit::Group,
            require_group_ids: true,
            ..crate::LeakageUnitPolicy::default()
        };
        scoped.validate_against_fold_set(&folds, &policy).unwrap();
        root.records[0].group_id = None;
        let invalid = methods_fold_hpo_scope_relations(&root, &folds);
        assert!(invalid.validate_against_fold_set(&folds, &policy).is_err());
    }
}
