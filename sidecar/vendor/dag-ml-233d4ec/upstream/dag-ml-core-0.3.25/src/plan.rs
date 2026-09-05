use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};

use crate::campaign::stable_json_fingerprint;
use crate::canonical::deserialize_external_contract;
use crate::controller::{
    ArtifactPolicy, ControllerCapability, ControllerFitScope, ControllerManifest,
    ControllerRegistry, RngPolicy,
};
use crate::controller_adapter::representation_type_id;
use crate::criteria::{
    CriterionInput, ImplementationCapability, LossCapability, SemanticSpecKind,
    TrainingLossRoleReference,
};
use crate::data::{
    BranchViewMode, BranchViewPlan, DataBinding, ExternalDataPlanEnvelope, ModelInputFusionMode,
    ModelInputPortSpec, ModelInputSpec, RepresentationPlan, SOURCE_INDEX_METADATA_KEY,
};
use crate::error::{DagMlError, Result};
use crate::fold::{FoldSet, NestedCvSpec};
use crate::generation::{
    enumerate_variants, generation_spec_fingerprint, GenerationSpec, VariantPlan,
};
use crate::graph::{GraphSpec, NodeKind, NodeSpec, PortKind};
use crate::ids::{ControllerId, FoldId, NodeId, VariantId};
use crate::phase::Phase;
use crate::policy::{AggregationPolicy, DataModelShapePlan, LeakageUnitPolicy};

pub const CAMPAIGN_SPEC_SCHEMA_VERSION: u32 = 1;
pub const CAMPAIGN_SPEC_SCHEMA_ID: &str =
    "https://github.com/GBeurier/dag-ml/schemas/campaign_spec.v1.schema.json";
pub const EXECUTION_PLAN_SCHEMA_VERSION: u32 = 1;
pub const EXECUTION_PLAN_SCHEMA_ID: &str =
    "https://github.com/GBeurier/dag-ml/schemas/execution_plan.v1.schema.json";

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct SplitInvocation {
    pub id: String,
    #[serde(default)]
    pub controller_id: Option<ControllerId>,
    #[serde(default)]
    pub leakage_policy: LeakageUnitPolicy,
    #[serde(default)]
    pub params: BTreeMap<String, serde_json::Value>,
    #[serde(default)]
    pub fold_set: Option<FoldSet>,
}

impl SplitInvocation {
    pub fn validate(&self) -> Result<()> {
        if self.id.trim().is_empty() {
            return Err(DagMlError::CampaignValidation(
                "split invocation id is empty".to_string(),
            ));
        }
        self.leakage_policy.validate()?;
        if let Some(fold_set) = &self.fold_set {
            fold_set.validate()?;
        }
        Ok(())
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct CampaignSpec {
    pub id: String,
    pub root_seed: Option<u64>,
    #[serde(default)]
    pub leakage_policy: LeakageUnitPolicy,
    #[serde(default)]
    pub aggregation_policy: AggregationPolicy,
    #[serde(default)]
    pub split_invocation: Option<SplitInvocation>,
    #[serde(default)]
    pub generation: GenerationSpec,
    #[serde(default)]
    pub shape_plans: BTreeMap<NodeId, DataModelShapePlan>,
    #[serde(default)]
    pub data_bindings: BTreeMap<NodeId, Vec<DataBinding>>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub branch_view_plans: Vec<BranchViewPlan>,
    /// Campaign-wide default nested (inner) CV policy. A node-level
    /// `NodePlan.inner_cv` overrides it; see [`crate::fold::resolve_inner_cv`].
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub inner_cv: Option<NestedCvSpec>,
    #[serde(default)]
    pub metadata: BTreeMap<String, serde_json::Value>,
}

impl CampaignSpec {
    /// Parse the published object-only campaign JSON representation and validate it.
    pub fn from_json(json: &str) -> Result<Self> {
        let campaign: Self =
            deserialize_external_contract(json, "campaign", DagMlError::CampaignValidation)?;
        campaign.validate()?;
        Ok(campaign)
    }

    pub fn validate(&self) -> Result<()> {
        if self.id.trim().is_empty() {
            return Err(DagMlError::CampaignValidation(
                "campaign id is empty".to_string(),
            ));
        }
        self.leakage_policy.validate()?;
        self.aggregation_policy.validate()?;
        if let Some(inner_cv) = &self.inner_cv {
            inner_cv.validate()?;
        }
        if let Some(split) = &self.split_invocation {
            split.validate()?;
        }
        self.generation.validate()?;
        for (node_id, shape_plan) in &self.shape_plans {
            if node_id != &shape_plan.node_id {
                return Err(DagMlError::CampaignValidation(format!(
                    "shape plan key `{node_id}` does not match node_id `{}`",
                    shape_plan.node_id
                )));
            }
            shape_plan.validate()?;
        }
        for (node_id, bindings) in &self.data_bindings {
            for binding in bindings {
                if node_id != &binding.node_id {
                    return Err(DagMlError::CampaignValidation(format!(
                        "data binding key `{node_id}` does not match node_id `{}`",
                        binding.node_id
                    )));
                }
                binding.validate()?;
            }
        }
        let mut branch_views = BTreeSet::new();
        for plan in &self.branch_view_plans {
            plan.validate()?;
            if !branch_views.insert(plan.view_id.as_str()) {
                return Err(DagMlError::CampaignValidation(format!(
                    "campaign `{}` contains duplicate branch view `{}`",
                    self.id, plan.view_id
                )));
            }
        }
        Ok(())
    }

    pub fn validate_data_envelope_relations(
        &self,
        envelope: &ExternalDataPlanEnvelope,
    ) -> Result<()> {
        envelope.validate()?;
        let Some(relations) = &envelope.coordinator_relations else {
            return Ok(());
        };
        let Some(split) = &self.split_invocation else {
            return Ok(());
        };
        let Some(fold_set) = &split.fold_set else {
            return Ok(());
        };
        relations.validate_against_fold_set(fold_set, &self.leakage_policy)?;
        relations.validate_against_fold_set(fold_set, &split.leakage_policy)?;
        if let Some(predict_cohort) = &envelope.predict_cohort {
            predict_cohort.validate_against_cv_fold_set(fold_set)?;
            predict_cohort.validate_against_cv_relations(relations)?;
        }
        Ok(())
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct GraphPlan {
    pub graph: GraphSpec,
    pub topological_order: Vec<NodeId>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub parallel_levels: Vec<Vec<NodeId>>,
}

impl GraphPlan {
    pub fn from_graph(graph: GraphSpec) -> Result<Self> {
        let topological_order = graph.topological_order()?;
        let parallel_levels = graph.parallel_levels()?;
        Ok(Self {
            graph,
            topological_order,
            parallel_levels,
        })
    }

    pub fn parallel_levels(&self) -> Result<Vec<Vec<NodeId>>> {
        if self.parallel_levels.is_empty() {
            return self.graph.parallel_levels();
        }
        Ok(self.parallel_levels.clone())
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct NodePlan {
    pub node_id: NodeId,
    pub kind: NodeKind,
    pub controller_id: ControllerId,
    pub controller_version: String,
    pub supported_phases: BTreeSet<Phase>,
    #[serde(default)]
    pub controller_capabilities: BTreeSet<ControllerCapability>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub training_losses: Vec<TrainingLossRoleReference>,
    pub fit_scope: ControllerFitScope,
    pub rng_policy: RngPolicy,
    pub artifact_policy: ArtifactPolicy,
    pub input_nodes: Vec<NodeId>,
    pub output_nodes: Vec<NodeId>,
    pub shape_plan: Option<DataModelShapePlan>,
    #[serde(default)]
    pub data_bindings: Vec<DataBinding>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub params: BTreeMap<String, serde_json::Value>,
    /// Node-local nested (inner) CV policy (e.g. for a finetune/tuner or branch
    /// node); overrides the campaign-wide default.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub inner_cv: Option<NestedCvSpec>,
    pub params_fingerprint: String,
}

impl NodePlan {
    pub fn training_losses_for_phase(
        &self,
        phase: Phase,
    ) -> impl Iterator<Item = &TrainingLossRoleReference> {
        self.training_losses
            .iter()
            .filter(move |role| role.phases.contains(&phase))
    }

    pub fn training_loss_fingerprint(&self, phase: Phase) -> Result<Option<String>> {
        let roles = self.training_losses_for_phase(phase).collect::<Vec<_>>();
        if roles.is_empty() {
            Ok(None)
        } else {
            stable_json_fingerprint(&roles).map(Some)
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ExecutionPlan {
    pub id: String,
    pub graph_plan: GraphPlan,
    pub campaign: CampaignSpec,
    pub node_plans: BTreeMap<NodeId, NodePlan>,
    pub controller_manifests: BTreeMap<ControllerId, ControllerManifest>,
    pub variants: Vec<VariantPlan>,
    pub fold_set: Option<FoldSet>,
    pub graph_fingerprint: String,
    pub campaign_fingerprint: String,
    pub controller_fingerprint: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct ExecutionScopePlan {
    pub scope_id: String,
    pub phase: Phase,
    pub variant_id: Option<VariantId>,
    pub variant_seed: Option<u64>,
    pub fold_id: Option<FoldId>,
    pub node_levels: Vec<Vec<NodeId>>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct PhaseExecutionSchedule {
    pub plan_id: String,
    pub phase: Phase,
    pub scopes: Vec<ExecutionScopePlan>,
}

impl ExecutionPlan {
    /// Parse and validate an external execution-plan JSON document.
    ///
    /// Serde's derived struct visitors also accept positional JSON arrays. That
    /// representation is an implementation detail, is not part of the published
    /// object-only JSON Schema, and would otherwise make standalone Rust readers
    /// more permissive than the C, Python and validation-oracle boundaries. The
    /// container-shape comparison keeps legitimate serde defaults and BTree
    /// ordering normalization, while refusing a sequence wherever the typed wire
    /// representation is an object (and vice versa).
    pub fn from_json(json: &str) -> Result<Self> {
        let plan: Self =
            deserialize_external_contract(json, "execution plan", DagMlError::Planning)?;
        plan.validate()?;
        Ok(plan)
    }

    /// Replace the plan's training-loss roles with a validated canonical set.
    /// Roles are grouped by node and sorted so every binding receives the same
    /// `NodeTask` requirement ordering.
    pub fn with_training_losses(mut self, roles: Vec<TrainingLossRoleReference>) -> Result<Self> {
        self.validate()?;
        let mut roles_by_node = BTreeMap::<NodeId, Vec<TrainingLossRoleReference>>::new();
        for role in roles {
            role.validate()?;
            if !self.node_plans.contains_key(&role.node_id) {
                return Err(DagMlError::Planning(format!(
                    "training loss references unknown plan node `{}`",
                    role.node_id
                )));
            }
            roles_by_node
                .entry(role.node_id.clone())
                .or_default()
                .push(role);
        }
        for node_roles in roles_by_node.values_mut() {
            node_roles.sort_by(|left, right| {
                (&left.output_id, &left.phases).cmp(&(&right.output_id, &right.phases))
            });
        }
        for (node_id, node_plan) in &mut self.node_plans {
            node_plan.training_losses = roles_by_node.remove(node_id).unwrap_or_default();
        }
        self.validate()?;
        Ok(self)
    }

    pub fn validate(&self) -> Result<()> {
        self.graph_plan.graph.validate()?;
        self.campaign.validate()?;
        // Retain the historical parallel-levels compatibility: an empty cached
        // level list is allowed (recomputed on demand), a present one must match.
        if !self.graph_plan.parallel_levels.is_empty()
            && self.graph_plan.parallel_levels != self.graph_plan.graph.parallel_levels()?
        {
            return Err(DagMlError::Planning(
                "graph plan parallel levels do not match graph".to_string(),
            ));
        }

        // Every controller manifest must be self-valid and keyed by its own id,
        // so a forged registry entry cannot masquerade under another id or ship
        // an internally inconsistent contract that later checks trust.
        for (controller_id, manifest) in &self.controller_manifests {
            manifest.validate()?;
            if controller_id != &manifest.controller_id {
                return Err(DagMlError::Planning(format!(
                    "controller manifest keyed `{controller_id}` declares id `{}`",
                    manifest.controller_id
                )));
            }
        }

        // Fail-closed embedded-fingerprint verification. Recompute each embedded
        // fingerprint from the canonical content — exactly as `build_execution_plan`
        // does at construction — and require exact equality with the serialized
        // top-level field. Without this a caller could mutate embedded
        // graph/campaign/manifest content, retain the stale fingerprint strings,
        // and re-sign the outer plan/outcome/package: the bundle layer only compares
        // fingerprint STRINGS, so the embedded content is the sole source of truth
        // here and its serialized fingerprint field must never be trusted on its own.
        // Structural validation above runs first so recomputation is over
        // well-formed content.
        let recomputed_graph_fingerprint = stable_json_fingerprint(&self.graph_plan.graph)?;
        if recomputed_graph_fingerprint != self.graph_fingerprint {
            return Err(DagMlError::Planning(
                "execution plan graph_fingerprint does not match the embedded graph".to_string(),
            ));
        }
        let recomputed_campaign_fingerprint = stable_json_fingerprint(&self.campaign)?;
        if recomputed_campaign_fingerprint != self.campaign_fingerprint {
            return Err(DagMlError::Planning(
                "execution plan campaign_fingerprint does not match the embedded campaign"
                    .to_string(),
            ));
        }
        let recomputed_controller_fingerprint =
            stable_json_fingerprint(&self.controller_manifests)?;
        if recomputed_controller_fingerprint != self.controller_fingerprint {
            return Err(DagMlError::Planning(
                "execution plan controller_fingerprint does not match the embedded controller manifests"
                    .to_string(),
            ));
        }

        // The node-plan map must key each plan by its own node id and cover
        // exactly the graph node-id set — no missing, extra or mis-keyed plan.
        // A bare length check is insufficient: it would accept a duplicated key
        // masking a missing node.
        let graph_node_ids = self
            .graph_plan
            .graph
            .nodes
            .iter()
            .map(|node| node.id.clone())
            .collect::<BTreeSet<_>>();
        for (node_id, plan) in &self.node_plans {
            if node_id != &plan.node_id {
                return Err(DagMlError::Planning(format!(
                    "node plan keyed `{node_id}` declares node_id `{}`",
                    plan.node_id
                )));
            }
        }
        let plan_node_ids = self.node_plans.keys().cloned().collect::<BTreeSet<_>>();
        if plan_node_ids != graph_node_ids {
            return Err(DagMlError::Planning(
                "execution plan node_plans do not exactly cover the graph node-id set".to_string(),
            ));
        }

        // The cached topological order must be exactly the graph's canonical
        // order, so a forged or stale order cannot omit a node from phase
        // scheduling. Per-node validation below iterates `node_plans` directly
        // and therefore no longer depends on this order for completeness.
        if self.graph_plan.topological_order != self.graph_plan.graph.topological_order()? {
            return Err(DagMlError::Planning(
                "execution plan topological_order does not match the graph".to_string(),
            ));
        }

        let graph_nodes_by_id = self
            .graph_plan
            .graph
            .nodes
            .iter()
            .map(|node| (node.id.clone(), node))
            .collect::<BTreeMap<_, _>>();
        for (node_id, plan) in &self.node_plans {
            let graph_node = graph_nodes_by_id
                .get(node_id)
                .expect("node_plans keys equal graph node ids");
            // The plan's own node kind must match the graph node, and its
            // adjacency must be exactly the graph's upstream/downstream sets so a
            // forged plan cannot manufacture or trim the predictor closure that
            // replay derivation walks through `input_nodes`.
            if plan.kind != graph_node.kind {
                return Err(DagMlError::Planning(format!(
                    "node plan `{node_id}` kind does not match graph node kind"
                )));
            }
            if plan.input_nodes != self.graph_plan.graph.upstream_nodes(node_id)
                || plan.output_nodes != self.graph_plan.graph.downstream_nodes(node_id)
            {
                return Err(DagMlError::Planning(format!(
                    "node plan `{node_id}` input/output adjacency does not match the graph"
                )));
            }
            let manifest = self
                .controller_manifests
                .get(&plan.controller_id)
                .ok_or_else(|| {
                    DagMlError::Planning(format!(
                        "missing controller manifest `{}` for node `{node_id}`",
                        plan.controller_id
                    ))
                })?;
            // Every capability-bearing field the plan copies from its manifest
            // must match exactly. `supported_phases` and `controller_version` are
            // load-bearing for replay-phase truthfulness, so they are enforced
            // alongside kind, capabilities and the policy triple.
            if manifest.operator_kind != plan.kind
                || manifest.controller_version != plan.controller_version
                || manifest.supported_phases != plan.supported_phases
                || manifest.capabilities != plan.controller_capabilities
                || manifest.fit_scope != plan.fit_scope
                || manifest.rng_policy != plan.rng_policy
                || manifest.artifact_policy != plan.artifact_policy
            {
                return Err(DagMlError::Planning(format!(
                    "node `{node_id}` node plan does not match controller manifest `{}`",
                    manifest.controller_id
                )));
            }
            for binding in &plan.data_bindings {
                if binding.node_id != *node_id {
                    return Err(DagMlError::Planning(format!(
                        "node plan `{node_id}` contains data binding for `{}`",
                        binding.node_id
                    )));
                }
                binding.validate()?;
            }
            validate_data_binding_requirements(node_id, plan, manifest, graph_node)?;
            validate_node_training_losses(plan)?;
            let actual_params_fingerprint = stable_json_fingerprint(&plan.params)?;
            if actual_params_fingerprint != plan.params_fingerprint {
                return Err(DagMlError::Planning(format!(
                    "node plan `{node_id}` params fingerprint does not match params"
                )));
            }
            // Validate every node-local inner_cv while iterating ALL node plans
            // (not the cached order), so a stale/tampered order cannot defer a
            // malformed inner_cv to FIT_CV fold building.
            if let Some(inner_cv) = &plan.inner_cv {
                inner_cv.validate().map_err(|error| {
                    DagMlError::Planning(format!(
                        "node plan `{node_id}` has invalid inner_cv: {error}"
                    ))
                })?;
            }
        }
        self.validate_oof_controller_capabilities()?;
        if let Some(fold_set) = &self.fold_set {
            fold_set.validate()?;
        }
        if self.variants.is_empty() {
            return Err(DagMlError::Planning(
                "execution plan has no variants".to_string(),
            ));
        }
        for variant in &self.variants {
            variant.validate()?;
        }
        Ok(())
    }

    pub fn validate_parallel_controller_capabilities(
        &self,
        max_workers: usize,
        phase: Phase,
    ) -> Result<()> {
        if max_workers <= 1 {
            return Ok(());
        }
        let node_ids = self
            .node_parallel_levels_for_phase(phase)?
            .into_iter()
            .flatten()
            .collect::<Vec<_>>();
        for node_id in node_ids {
            let node_plan = self.node_plans.get(&node_id).ok_or_else(|| {
                DagMlError::Planning(format!("missing node plan for `{node_id}`"))
            })?;
            let manifest = self
                .controller_manifests
                .get(&node_plan.controller_id)
                .ok_or_else(|| {
                    DagMlError::Planning(format!(
                        "missing controller manifest `{}` for node `{}`",
                        node_plan.controller_id, node_plan.node_id
                    ))
                })?;
            if !manifest.supports_parallel_invocation() {
                return Err(DagMlError::Planning(format!(
                    "parallel scheduler with {max_workers} workers requires controller `{}` for node `{}` to declare thread_safe or process_safe",
                    manifest.controller_id, node_plan.node_id
                )));
            }
        }
        Ok(())
    }

    fn validate_oof_controller_capabilities(&self) -> Result<()> {
        for edge in &self.graph_plan.graph.edges {
            if edge.contract.kind != PortKind::Prediction {
                continue;
            }
            let target_plan = self.node_plans.get(&edge.target.node_id).ok_or_else(|| {
                DagMlError::Planning(format!(
                    "prediction edge target node `{}` has no node plan",
                    edge.target.node_id
                ))
            })?;
            let target_fits = matches!(
                target_plan.fit_scope,
                ControllerFitScope::FoldTrain | ControllerFitScope::FullTrain
            ) && target_plan
                .supported_phases
                .iter()
                .any(|phase| matches!(phase, Phase::FitCv | Phase::Refit));
            if target_fits && !edge.contract.requires_oof {
                return Err(DagMlError::Planning(format!(
                    "prediction edge `{}.{}` -> `{}.{}` enters fitting controller `{}` and must require OOF",
                    edge.source.node_id,
                    edge.source.port_name,
                    edge.target.node_id,
                    edge.target.port_name,
                    target_plan.controller_id
                )));
            }
            if !edge.contract.requires_oof {
                continue;
            }
            let source_plan = self.node_plans.get(&edge.source.node_id).ok_or_else(|| {
                DagMlError::Planning(format!(
                    "OOF edge source node `{}` has no node plan",
                    edge.source.node_id
                ))
            })?;
            if !source_plan
                .controller_capabilities
                .contains(&ControllerCapability::EmitsPredictions)
            {
                return Err(DagMlError::Planning(format!(
                    "OOF edge `{}.{}` -> `{}.{}` requires source controller `{}` to declare emits_predictions",
                    edge.source.node_id,
                    edge.source.port_name,
                    edge.target.node_id,
                    edge.target.port_name,
                    source_plan.controller_id
                )));
            }
            if !target_plan
                .controller_capabilities
                .contains(&ControllerCapability::ConsumesOofPredictions)
            {
                return Err(DagMlError::Planning(format!(
                    "OOF edge `{}.{}` -> `{}.{}` requires target controller `{}` to declare consumes_oof_predictions",
                    edge.source.node_id,
                    edge.source.port_name,
                    edge.target.node_id,
                    edge.target.port_name,
                    target_plan.controller_id
                )));
            }
        }
        Ok(())
    }

    pub fn node_parallel_levels_for_phase(&self, phase: Phase) -> Result<Vec<Vec<NodeId>>> {
        let levels = self
            .graph_plan
            .parallel_levels()?
            .into_iter()
            .map(|level| {
                level
                    .into_iter()
                    .filter(|node_id| {
                        self.node_plans
                            .get(node_id)
                            .is_some_and(|node_plan| node_plan.supported_phases.contains(&phase))
                    })
                    .collect::<Vec<_>>()
            })
            .filter(|level| !level.is_empty())
            .collect::<Vec<_>>();
        Ok(levels)
    }

    pub fn campaign_phase_schedule(&self, phase: Phase) -> Result<PhaseExecutionSchedule> {
        self.validate()?;
        let node_levels = self.node_parallel_levels_for_phase(phase)?;
        let fold_ids = if phase == Phase::FitCv {
            self.fold_set
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
        let mut scopes = Vec::new();
        for variant in &self.variants {
            for fold_id in &fold_ids {
                scopes.push(ExecutionScopePlan {
                    scope_id: execution_scope_id(
                        phase,
                        Some(&variant.variant_id),
                        fold_id.as_ref(),
                    ),
                    phase,
                    variant_id: Some(variant.variant_id.clone()),
                    variant_seed: variant.seed,
                    fold_id: fold_id.clone(),
                    node_levels: node_levels.clone(),
                });
            }
        }
        Ok(PhaseExecutionSchedule {
            plan_id: self.id.clone(),
            phase,
            scopes,
        })
    }

    /// Returns the `BranchViewPlan` whose `branch_id` matches `branch_id`,
    /// if any. The match is exact; callers that need fuzzy or prefix matching
    /// must iterate `self.campaign.branch_view_plans` themselves.
    pub fn branch_view_for(&self, branch_id: &str) -> Option<&BranchViewPlan> {
        branch_view_for_in(&self.campaign.branch_view_plans, branch_id)
    }

    /// Returns the `BranchViewPlan` for the deepest branch in `branch_path`
    /// that has a matching plan, if any. The path is walked tip-first so the
    /// closest enclosing branch wins; an empty path returns `None`. The
    /// returned reference borrows the plan from the campaign; the caller can
    /// `.clone()` it into a `DataProviderViewSpec.branch_view` field when
    /// constructing a provider view for an in-branch node.
    pub fn branch_view_for_path(&self, branch_path: &[String]) -> Option<&BranchViewPlan> {
        branch_view_for_path_in(&self.campaign.branch_view_plans, branch_path)
    }
}

fn validate_data_binding_requirements(
    node_id: &NodeId,
    plan: &NodePlan,
    manifest: &ControllerManifest,
    node: &NodeSpec,
) -> Result<()> {
    let branch_view = branch_view_plan_from_node_metadata(node)?;
    let Some(model_input) = manifest.model_input_spec()? else {
        for binding in &plan.data_bindings {
            let effective_source_ids = effective_binding_source_ids(binding, branch_view.as_ref())?;
            if effective_source_ids.len() > 1 {
                return Err(data_requirement_refusal(
                    "dagml.data_requirement.missing_data_requirements",
                    node_id,
                    binding,
                    manifest,
                    "multisource",
                    &effective_source_ids,
                    "multi-source data binding requires controller data_requirements".to_string(),
                ));
            }
        }
        return Ok(());
    };
    for binding in &plan.data_bindings {
        let Some(port) = model_input
            .ports
            .iter()
            .find(|port| port.name == binding.input_name)
        else {
            return Err(DagMlError::Planning(format!(
                "node `{node_id}` data binding `{}` is not declared by controller `{}` data_requirements",
                binding.input_name, manifest.controller_id
            )));
        };
        if !port
            .accepted_representations
            .iter()
            .any(|representation| representation == &binding.output_representation)
        {
            return Err(DagMlError::Planning(format!(
                "node `{node_id}` data binding `{}` output representation `{}` is not accepted by controller `{}` data_requirements port `{}`",
                binding.input_name,
                binding.output_representation,
                manifest.controller_id,
                port.name
            )));
        }
        if let Some(type_id) = representation_type_id(&binding.output_representation) {
            if !port
                .accepted_types
                .iter()
                .any(|accepted_type| accepted_type.as_str() == type_id)
            {
                return Err(DagMlError::Planning(format!(
                    "node `{node_id}` data binding `{}` output representation `{}` has registered type `{type_id}` but controller `{}` data_requirements port `{}` accepts types {:?}",
                    binding.input_name,
                    binding.output_representation,
                    manifest.controller_id,
                    port.name,
                    port.accepted_types
                )));
            }
        }
        validate_data_binding_source_shape(
            node_id,
            binding,
            port,
            &model_input,
            manifest,
            branch_view.as_ref(),
        )?;
    }
    Ok(())
}

fn validate_node_training_losses(plan: &NodePlan) -> Result<()> {
    let mut previous_key: Option<(Option<String>, BTreeSet<Phase>)> = None;
    let mut occupied_phases = BTreeSet::new();
    for role in &plan.training_losses {
        role.validate()?;
        if role.node_id != plan.node_id {
            return Err(DagMlError::Planning(format!(
                "node plan `{}` contains training loss for `{}`",
                plan.node_id, role.node_id
            )));
        }
        let key = (role.output_id.clone(), role.phases.clone());
        if previous_key
            .as_ref()
            .is_some_and(|previous| previous >= &key)
        {
            return Err(DagMlError::Planning(format!(
                "node plan `{}` training losses must be strictly sorted by output_id and phases",
                plan.node_id
            )));
        }
        previous_key = Some(key);
        for phase in &role.phases {
            if !plan.supported_phases.contains(phase) {
                return Err(DagMlError::Planning(format!(
                    "node `{}` has a training loss for unsupported phase {phase:?}",
                    plan.node_id
                )));
            }
            if !occupied_phases.insert((role.output_id.clone(), *phase)) {
                return Err(DagMlError::Planning(format!(
                    "node `{}` has overlapping training losses for output {:?} in phase {phase:?}",
                    plan.node_id, role.output_id
                )));
            }
        }
        if !plan
            .controller_capabilities
            .contains(&ControllerCapability::SupportsConfigurableLoss)
        {
            return Err(DagMlError::Planning(format!(
                "node `{}` configures a training loss but its controller does not support configurable loss",
                plan.node_id
            )));
        }
        if role.loss.spec.kind == SemanticSpecKind::Custom
            && !plan
                .controller_capabilities
                .contains(&ControllerCapability::SupportsCustomLoss)
        {
            return Err(DagMlError::Planning(format!(
                "node `{}` configures a custom loss but its controller does not support custom loss",
                plan.node_id
            )));
        }
        if role
            .loss
            .spec
            .capabilities
            .contains(&LossCapability::Differentiable)
            && !plan
                .controller_capabilities
                .contains(&ControllerCapability::SupportsDifferentiableLoss)
        {
            return Err(DagMlError::Planning(format!(
                "node `{}` configures a differentiable loss but its controller does not support differentiable loss",
                plan.node_id
            )));
        }
        if role
            .loss
            .spec
            .required_inputs
            .contains(&CriterionInput::SampleWeight)
            && !plan
                .controller_capabilities
                .contains(&ControllerCapability::SupportsSampleWeights)
        {
            return Err(DagMlError::Planning(format!(
                "node `{}` loss requires sample weights but its controller does not support them",
                plan.node_id
            )));
        }
        if role
            .loss
            .spec
            .required_inputs
            .contains(&CriterionInput::MissingMask)
            && !plan
                .controller_capabilities
                .contains(&ControllerCapability::SupportsMissingMasks)
        {
            return Err(DagMlError::Planning(format!(
                "node `{}` loss requires missing masks but its controller does not support them",
                plan.node_id
            )));
        }
        if role
            .loss
            .implementation
            .capabilities
            .contains(&ImplementationCapability::NeedsGil)
            && !plan
                .controller_capabilities
                .contains(&ControllerCapability::NeedsPythonGil)
        {
            return Err(DagMlError::Planning(format!(
                "node `{}` loss implementation needs the Python GIL but its controller does not declare it",
                plan.node_id
            )));
        }
    }
    Ok(())
}

fn branch_view_plan_from_node_metadata(node: &NodeSpec) -> Result<Option<BranchViewPlan>> {
    let Some(value) = node.metadata.get("dsl_branch_view_plan") else {
        return Ok(None);
    };
    let plan: BranchViewPlan = serde_json::from_value(value.clone()).map_err(|error| {
        DagMlError::Planning(format!(
            "node `{}` carries malformed `dsl_branch_view_plan` metadata: {error}",
            node.id
        ))
    })?;
    plan.validate()
        .map_err(|error| DagMlError::Planning(error.to_string()))?;
    Ok(Some(plan))
}

fn validate_data_binding_source_shape(
    node_id: &NodeId,
    binding: &DataBinding,
    port: &ModelInputPortSpec,
    model_input: &ModelInputSpec,
    manifest: &ControllerManifest,
    branch_view: Option<&BranchViewPlan>,
) -> Result<()> {
    let effective_source_ids = effective_binding_source_ids(binding, branch_view)?;
    if effective_source_ids.len() < 2 {
        return Ok(());
    }
    if !port.multi_source {
        return Err(data_requirement_refusal(
            "dagml.data_requirement.multi_source_port_not_supported",
            node_id,
            binding,
            manifest,
            "multisource",
            &effective_source_ids,
            format!(
                "controller `{}` data_requirements port `{}` does not declare multi_source=true",
                manifest.controller_id, port.name
            ),
        ));
    }
    let Some(fusion) = &model_input.default_fusion else {
        return Err(data_requirement_refusal(
            "dagml.data_requirement.missing_multisource_fusion",
            node_id,
            binding,
            manifest,
            "multisource",
            &effective_source_ids,
            "multi-source data binding requires an explicit default_fusion policy".to_string(),
        ));
    };
    validate_fusion_sources_match_binding(
        node_id,
        binding,
        manifest,
        fusion.representation_plan.as_ref(),
        &effective_source_ids,
    )?;
    match fusion.mode {
        ModelInputFusionMode::ConcatenateFeatures => {
            if binding
                .metadata
                .get(SOURCE_INDEX_METADATA_KEY)
                .and_then(serde_json::Value::as_object)
                .is_none()
            {
                return Err(data_requirement_refusal(
                    "dagml.data_requirement.source_concat_requires_source_index",
                    node_id,
                    binding,
                    manifest,
                    "source_concat",
                    &effective_source_ids,
                    "source-concat feature fusion requires data binding metadata.source_index so feature-axis blocks are explicit".to_string(),
                ));
            }
        }
        ModelInputFusionMode::DictBySource | ModelInputFusionMode::Custom => {}
        ModelInputFusionMode::SingleSource | ModelInputFusionMode::StackSamples => {
            let fusion_mode = fusion_mode_label(fusion.mode);
            return Err(data_requirement_refusal(
                "dagml.data_requirement.unsupported_multisource_fusion_mode",
                node_id,
                binding,
                manifest,
                fusion_mode,
                &effective_source_ids,
                format!(
                    "multi-source data binding cannot be planned with default_fusion.mode={fusion_mode}"
                ),
            ));
        }
    }
    Ok(())
}

fn fusion_mode_label(mode: ModelInputFusionMode) -> &'static str {
    match mode {
        ModelInputFusionMode::SingleSource => "single_source",
        ModelInputFusionMode::ConcatenateFeatures => "concatenate_features",
        ModelInputFusionMode::StackSamples => "stack_samples",
        ModelInputFusionMode::DictBySource => "dict_by_source",
        ModelInputFusionMode::Custom => "custom",
    }
}

fn effective_binding_source_ids(
    binding: &DataBinding,
    branch_view: Option<&BranchViewPlan>,
) -> Result<Vec<String>> {
    let Some(branch_view) = branch_view else {
        return Ok(binding.source_ids.clone());
    };
    if branch_view.mode != BranchViewMode::BySource {
        return Ok(binding.source_ids.clone());
    }
    if branch_view.selector.source_ids.len() != 1 {
        return Err(data_requirement_refusal_for_branch(
            "dagml.data_requirement.unsupported_by_source_shape",
            binding,
            branch_view,
            "by_source branch views must select exactly one source_id for per-source X-chain fit semantics".to_string(),
        ));
    }
    if !binding.source_ids.is_empty() {
        let declared = binding.source_ids.iter().collect::<BTreeSet<_>>();
        for source_id in &branch_view.selector.source_ids {
            if !declared.contains(source_id) {
                return Err(data_requirement_refusal_for_branch(
                    "dagml.data_requirement.by_source_selector_outside_binding",
                    binding,
                    branch_view,
                    format!(
                        "by_source branch selector source `{source_id}` is not declared by data binding source_ids"
                    ),
                ));
            }
        }
    }
    Ok(branch_view.selector.source_ids.clone())
}

fn validate_fusion_sources_match_binding(
    node_id: &NodeId,
    binding: &DataBinding,
    manifest: &ControllerManifest,
    representation_plan: Option<&RepresentationPlan>,
    effective_source_ids: &[String],
) -> Result<()> {
    let Some(representation_plan) = representation_plan else {
        return Ok(());
    };
    let component_sources = representation_plan_component_sources(representation_plan);
    if component_sources.is_empty() {
        return Ok(());
    }
    let declared = component_sources.iter().cloned().collect::<BTreeSet<_>>();
    let effective = effective_source_ids.iter().collect::<BTreeSet<_>>();
    if declared != effective {
        return Err(data_requirement_refusal(
            "dagml.data_requirement.representation_sources_mismatch",
            node_id,
            binding,
            manifest,
            "multisource",
            effective_source_ids,
            format!(
                "default_fusion.representation_plan component_source_ids {:?} do not match binding source_ids {:?}",
                component_sources, effective_source_ids
            ),
        ));
    }
    Ok(())
}

fn representation_plan_component_sources(plan: &RepresentationPlan) -> Vec<&String> {
    match plan {
        RepresentationPlan::Aggregate(_) => Vec::new(),
        RepresentationPlan::CartesianProduct(plan) => {
            plan.combination_plan.component_source_ids.iter().collect()
        }
        RepresentationPlan::MonteCarloCartesian(plan) => {
            plan.combination_plan.component_source_ids.iter().collect()
        }
        RepresentationPlan::StackFixed(plan) => plan.component_source_ids.iter().collect(),
        RepresentationPlan::StackPaddedMasked(plan) => plan.component_source_ids.iter().collect(),
    }
}

fn data_requirement_refusal(
    code: &'static str,
    node_id: &NodeId,
    binding: &DataBinding,
    manifest: &ControllerManifest,
    shape: &str,
    source_ids: &[String],
    message: String,
) -> DagMlError {
    DagMlError::Planning(format!(
        "data requirement refusal: {}",
        serde_json::json!({
            "schema_version": 1,
            "code": code,
            "node_id": node_id.to_string(),
            "input_name": binding.input_name.as_str(),
            "controller_id": manifest.controller_id.to_string(),
            "shape": shape,
            "source_ids": source_ids,
            "message": message
        })
    ))
}

fn data_requirement_refusal_for_branch(
    code: &'static str,
    binding: &DataBinding,
    branch_view: &BranchViewPlan,
    message: String,
) -> DagMlError {
    DagMlError::Planning(format!(
        "data requirement refusal: {}",
        serde_json::json!({
            "schema_version": 1,
            "code": code,
            "node_id": binding.node_id.to_string(),
            "input_name": binding.input_name.as_str(),
            "branch_view_id": branch_view.view_id.as_str(),
            "branch_id": branch_view.branch_id.as_str(),
            "shape": "by_source",
            "source_ids": &branch_view.selector.source_ids,
            "message": message
        })
    ))
}

fn branch_view_for_in<'a>(
    plans: &'a [BranchViewPlan],
    branch_id: &str,
) -> Option<&'a BranchViewPlan> {
    plans.iter().find(|plan| plan.branch_id == branch_id)
}

fn branch_view_for_path_in<'a>(
    plans: &'a [BranchViewPlan],
    branch_path: &[String],
) -> Option<&'a BranchViewPlan> {
    for branch_id in branch_path.iter().rev() {
        if let Some(plan) = branch_view_for_in(plans, branch_id) {
            return Some(plan);
        }
    }
    None
}

fn execution_scope_id(
    phase: Phase,
    variant_id: Option<&VariantId>,
    fold_id: Option<&FoldId>,
) -> String {
    format!(
        "scope:{}:{}:{}",
        phase_scope_label(phase),
        variant_id
            .map(ToString::to_string)
            .unwrap_or_else(|| "base".to_string()),
        fold_id
            .map(ToString::to_string)
            .unwrap_or_else(|| "nofold".to_string())
    )
}

fn phase_scope_label(phase: Phase) -> &'static str {
    match phase {
        Phase::Compile => "COMPILE",
        Phase::Plan => "PLAN",
        Phase::FitCv => "FIT_CV",
        Phase::Select => "SELECT",
        Phase::Refit => "REFIT",
        Phase::Predict => "PREDICT",
        Phase::Explain => "EXPLAIN",
    }
}

pub fn build_execution_plan(
    id: impl Into<String>,
    graph: GraphSpec,
    campaign: CampaignSpec,
    registry: &ControllerRegistry,
) -> Result<ExecutionPlan> {
    let id = id.into();
    if id.trim().is_empty() {
        return Err(DagMlError::Planning(
            "execution plan id is empty".to_string(),
        ));
    }
    campaign.validate()?;
    let graph_plan = GraphPlan::from_graph(graph)?;
    validate_campaign_node_targets(&graph_plan.graph, &campaign)?;

    let mut node_plans = BTreeMap::new();
    let mut controller_manifests = BTreeMap::new();
    for node_id in &graph_plan.topological_order {
        let node = graph_plan
            .graph
            .nodes
            .iter()
            .find(|node| &node.id == node_id)
            .expect("topological node exists");
        let manifest = registry.resolve_for_node(node)?;
        let params = node.params.clone();
        let params_fingerprint = stable_json_fingerprint(&params)?;
        // Lower a node-local nested-CV policy carried by the DSL compiler in the
        // graph node metadata into the typed NodePlan field. Malformed metadata
        // fails the plan rather than silently dropping nested CV.
        let inner_cv = match node.metadata.get("dsl_inner_cv") {
            Some(value) => {
                let spec =
                    serde_json::from_value::<NestedCvSpec>(value.clone()).map_err(|error| {
                        DagMlError::Planning(format!(
                            "node `{}` has invalid dsl_inner_cv metadata: {error}",
                            node.id
                        ))
                    })?;
                // Reject semantically malformed specs (e.g. n_splits < 2) here, at
                // the plan boundary, rather than deferring to FIT_CV fold building.
                spec.validate().map_err(|error| {
                    DagMlError::Planning(format!(
                        "node `{}` has invalid dsl_inner_cv metadata: {error}",
                        node.id
                    ))
                })?;
                Some(spec)
            }
            None => None,
        };
        let shape_plan = campaign.shape_plans.get(&node.id).cloned();
        let data_bindings = campaign
            .data_bindings
            .get(&node.id)
            .cloned()
            .unwrap_or_default();
        node_plans.insert(
            node.id.clone(),
            NodePlan {
                inner_cv,
                node_id: node.id.clone(),
                kind: node.kind.clone(),
                controller_id: manifest.controller_id.clone(),
                controller_version: manifest.controller_version.clone(),
                supported_phases: manifest.supported_phases.clone(),
                controller_capabilities: manifest.capabilities.clone(),
                training_losses: Vec::new(),
                fit_scope: manifest.fit_scope,
                rng_policy: manifest.rng_policy,
                artifact_policy: manifest.artifact_policy,
                input_nodes: graph_plan.graph.upstream_nodes(&node.id),
                output_nodes: graph_plan.graph.downstream_nodes(&node.id),
                shape_plan,
                data_bindings,
                params,
                params_fingerprint,
            },
        );
        controller_manifests.insert(manifest.controller_id.clone(), manifest);
    }

    let fold_set = campaign
        .split_invocation
        .as_ref()
        .and_then(|split| split.fold_set.clone());
    validate_search_space_fingerprint(&graph_plan.graph, &campaign)?;
    let variants = enumerate_variants(&campaign.generation, campaign.root_seed)?;
    validate_generation_override_targets(&graph_plan.graph, &variants)?;
    let graph_fingerprint = stable_json_fingerprint(&graph_plan.graph)?;
    let campaign_fingerprint = stable_json_fingerprint(&campaign)?;
    let controller_fingerprint = stable_json_fingerprint(&controller_manifests)?;
    let plan = ExecutionPlan {
        id,
        graph_plan,
        campaign,
        node_plans,
        controller_manifests,
        variants,
        fold_set,
        graph_fingerprint,
        campaign_fingerprint,
        controller_fingerprint,
    };
    plan.validate()?;
    Ok(plan)
}

fn validate_search_space_fingerprint(graph: &GraphSpec, campaign: &CampaignSpec) -> Result<()> {
    let Some(expected_fingerprint) = &graph.search_space_fingerprint else {
        return Ok(());
    };
    if expected_fingerprint.trim().is_empty() {
        return Err(DagMlError::Planning(format!(
            "graph `{}` has empty search_space_fingerprint",
            graph.id
        )));
    }
    let actual_fingerprint = generation_spec_fingerprint(&campaign.generation)?;
    if expected_fingerprint != &actual_fingerprint {
        return Err(DagMlError::Planning(format!(
            "graph `{}` search_space_fingerprint does not match campaign generation spec",
            graph.id
        )));
    }
    Ok(())
}

fn validate_generation_override_targets(graph: &GraphSpec, variants: &[VariantPlan]) -> Result<()> {
    let node_ids = graph
        .nodes
        .iter()
        .map(|node| node.id.clone())
        .collect::<BTreeSet<_>>();
    for variant in variants {
        for node_id in variant.param_override_targets()? {
            if !node_ids.contains(&node_id) {
                return Err(DagMlError::Planning(format!(
                    "variant `{}` overrides params for unknown node `{node_id}`",
                    variant.variant_id
                )));
            }
        }
    }
    Ok(())
}

fn validate_campaign_node_targets(graph: &GraphSpec, campaign: &CampaignSpec) -> Result<()> {
    let node_ids = graph
        .nodes
        .iter()
        .map(|node| &node.id)
        .collect::<BTreeSet<_>>();
    for node_id in campaign.shape_plans.keys() {
        if !node_ids.contains(node_id) {
            return Err(DagMlError::Planning(format!(
                "shape plan references unknown node `{node_id}`"
            )));
        }
    }
    for node_id in campaign.data_bindings.keys() {
        if !node_ids.contains(node_id) {
            return Err(DagMlError::Planning(format!(
                "data binding references unknown node `{node_id}`"
            )));
        }
    }
    Ok(())
}

/// Prune `plan` (a Mechanism-B operator-generator UNION plan, compiled as a STACKING graph:
/// every choice's terminal model fans into `merge:generator_predictions -> model:meta`) down to a
/// single operator-SELECT candidate: the one operator choice in `active_nodes` plus the prefix it
/// shares with the other choices, with the generator merge + meta-model + every inactive choice
/// physically removed (C Phase 4, #23).
///
/// `active_nodes` is the chosen choice's active set (`OperatorVariantModel::active_nodes[choice]`);
/// `all_choice_nodes` is the union of EVERY choice's active set. The kept set is computed by
/// structure, not by id-prefix matching:
///
/// 1. `shared_prefix` = the transitive ANCESTORS of `active_nodes` in the compiled graph (walked via
///    [`GraphSpec::upstream_nodes`], graph.rs), MINUS `all_choice_nodes`. The subtraction is the
///    crux: ancestors that are themselves choice nodes (this choice's own upstream operators) stay
///    in via `active_nodes`, but a sibling choice's nodes are never pulled in, and — because the
///    merge + meta sit DOWNSTREAM of the choice models, never upstream — they are never ancestors,
///    so they are elided.
/// 2. `keep` = `shared_prefix ∪ active_nodes`.
/// 3. graph nodes/edges are filtered to `keep` (an edge survives only when BOTH endpoints are kept,
///    which drops the now-dangling stacking edges into the elided merge).
/// 4. a fresh [`GraphPlan::from_graph`] recomputes the topo order + parallel levels for the pruned
///    graph, `node_plans` are filtered to `keep`, and EACH surviving node plan's
///    `input_nodes`/`output_nodes` are REBUILT from the pruned graph (the scheduler reads
///    `input_nodes` to decide handle forwarding — a stale entry would silently reintroduce an
///    inactive edge).
/// 5. `graph_fingerprint` is recomputed from the pruned graph; `variants` is set to exactly the
///    SELECT candidate's variant; the result is `validate`d and then run through
///    `validate_active_inputs` (Invariant P4-1).
///
/// The campaign is carried unchanged (its `shape_plans`/`data_bindings`/`generation` are validated
/// per-object, not re-checked against the pruned node set), so the pruned candidate replays exactly
/// the chosen operator sub-sequence with no stacking residue.
pub fn prune_plan_to_active(
    plan: &ExecutionPlan,
    active_nodes: &BTreeSet<NodeId>,
    all_choice_nodes: &BTreeSet<NodeId>,
    variant: &VariantPlan,
) -> Result<ExecutionPlan> {
    plan.validate()?;
    variant.validate()?;
    for node_id in active_nodes {
        if !plan.node_plans.contains_key(node_id) {
            return Err(DagMlError::Planning(format!(
                "operator-SELECT prune: active node `{node_id}` is not in the union plan"
            )));
        }
    }
    if active_nodes.is_empty() {
        return Err(DagMlError::Planning(
            "operator-SELECT prune: active node set is empty".to_string(),
        ));
    }

    // shared_prefix = transitive ancestors of the active nodes, MINUS every choice's active nodes
    // (so sibling choices, the stacking merge, and the meta-model are all excluded).
    let graph = &plan.graph_plan.graph;
    let mut ancestors = BTreeSet::<NodeId>::new();
    let mut stack: Vec<NodeId> = active_nodes.iter().cloned().collect();
    while let Some(node_id) = stack.pop() {
        for upstream in graph.upstream_nodes(&node_id) {
            if ancestors.insert(upstream.clone()) {
                stack.push(upstream);
            }
        }
    }
    let shared_prefix = ancestors
        .into_iter()
        .filter(|node_id| !all_choice_nodes.contains(node_id))
        .collect::<BTreeSet<_>>();

    let keep = shared_prefix
        .iter()
        .chain(active_nodes.iter())
        .cloned()
        .collect::<BTreeSet<_>>();

    // Filter the graph to `keep`; an edge survives only when BOTH endpoints survive, which drops the
    // dangling edges into the elided merge/meta-model.
    let mut pruned_graph = graph.clone();
    pruned_graph.nodes.retain(|node| keep.contains(&node.id));
    pruned_graph
        .edges
        .retain(|edge| keep.contains(&edge.source.node_id) && keep.contains(&edge.target.node_id));

    let graph_plan = GraphPlan::from_graph(pruned_graph)?;

    // Filter node plans to `keep` and rebuild every surviving plan's input/output nodes from the
    // pruned graph (the scheduler reads `input_nodes`; stale entries reintroduce inactive edges).
    let mut node_plans = BTreeMap::new();
    for (node_id, node_plan) in &plan.node_plans {
        if !keep.contains(node_id) {
            continue;
        }
        let mut pruned_node_plan = node_plan.clone();
        pruned_node_plan.input_nodes = graph_plan.graph.upstream_nodes(node_id);
        pruned_node_plan.output_nodes = graph_plan.graph.downstream_nodes(node_id);
        node_plans.insert(node_id.clone(), pruned_node_plan);
    }

    let graph_fingerprint = stable_json_fingerprint(&graph_plan.graph)?;
    let pruned = ExecutionPlan {
        id: plan.id.clone(),
        graph_plan,
        campaign: plan.campaign.clone(),
        node_plans,
        controller_manifests: plan.controller_manifests.clone(),
        variants: vec![variant.clone()],
        fold_set: plan.fold_set.clone(),
        graph_fingerprint,
        campaign_fingerprint: plan.campaign_fingerprint.clone(),
        controller_fingerprint: plan.controller_fingerprint.clone(),
    };
    pruned.validate()?;
    validate_active_inputs(&pruned, graph)?;
    Ok(pruned)
}

/// Invariant P4-1: after an operator-SELECT prune, every kept node's edge-fed input port is still
/// fed by exactly one surviving source.
///
/// The edge-driven scheduler / OOF traversals only ever see the surviving nodes+edges — the inactive
/// choices, the merge, and the meta-model are physically gone — so the active-edge gate is otherwise
/// IMPLICIT; this is the only residual check. It is strictly additive: it weakens no OOF/leakage
/// validator.
///
/// For each input port of each kept node it compares the union graph's per-port edge count
/// (`union_graph`) with the pruned graph's. A port that was edge-fed in the union but now has NO
/// surviving source is DANGLING — its sole producer was pruned away, which is a malformed prune. A
/// port with MORE THAN ONE surviving source is AMBIGUOUS. Ports that were never edge-fed in the union
/// (graph-interface / data-binding inputs) carry no edge by design and are left alone.
fn validate_active_inputs(plan: &ExecutionPlan, union_graph: &GraphSpec) -> Result<()> {
    let pruned_graph = &plan.graph_plan.graph;
    let kept: BTreeSet<&NodeId> = pruned_graph.nodes.iter().map(|node| &node.id).collect();

    let mut union_port_sources = BTreeMap::<(NodeId, String), usize>::new();
    for edge in &union_graph.edges {
        if !kept.contains(&edge.target.node_id) {
            continue;
        }
        *union_port_sources
            .entry((edge.target.node_id.clone(), edge.target.port_name.clone()))
            .or_insert(0) += 1;
    }
    let mut pruned_port_sources = BTreeMap::<(NodeId, String), usize>::new();
    for edge in &pruned_graph.edges {
        *pruned_port_sources
            .entry((edge.target.node_id.clone(), edge.target.port_name.clone()))
            .or_insert(0) += 1;
    }

    for (key, union_count) in &union_port_sources {
        let pruned_count = pruned_port_sources.get(key).copied().unwrap_or(0);
        let (node_id, port_name) = key;
        if *union_count >= 1 && pruned_count == 0 {
            return Err(DagMlError::Planning(format!(
                "operator-SELECT prune left node `{node_id}` required input port `{port_name}` with zero surviving sources (dangling): its producer was pruned away"
            )));
        }
        if pruned_count > 1 {
            return Err(DagMlError::Planning(format!(
                "operator-SELECT prune left node `{node_id}` input port `{port_name}` fed by {pruned_count} surviving sources (ambiguous)"
            )));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::collections::{BTreeMap, BTreeSet};
    use std::time::{Duration, Instant};

    use super::*;
    use crate::controller::{
        ArtifactPolicy, ControllerCapability, ControllerFitScope, ControllerManifest, RngPolicy,
    };
    use crate::fold::FoldPartitionMode;

    #[test]
    fn params_fingerprint_pins_serde_json_binary64_spelling() {
        let params = BTreeMap::from([
            (
                "scope".to_string(),
                serde_json::Value::String("train_only".to_string()),
            ),
            ("std".to_string(), serde_json::Value::from(1e-7_f64)),
        ]);
        assert_eq!(
            stable_json_fingerprint(&params).unwrap(),
            "3f417903752f65005bc9b69bcd23dfcf3ede2cda010e4f1ead6090a1a407b851"
        );

        // Pin both fixed/scientific cutovers and special finite spellings used
        // by the independent Python serde encoder.
        for (value, expected) in [
            (1e-7_f64, "1e-7"),
            (1e-6_f64, "1e-6"),
            (1e-5_f64, "0.00001"),
            (1e20_f64, "1e+20"),
            (1e21_f64, "1e+21"),
            (-0.0_f64, "-0.0"),
            (0.1_f64, "0.1"),
            (2.0_f64, "2.0"),
            (f64::from_bits(1), "5e-324"),
        ] {
            assert_eq!(serde_json::to_string(&value).unwrap(), expected);
        }
    }

    #[test]
    fn inner_cv_is_declarable_at_campaign_and_node_level() {
        // Campaign-level (global) declaration round-trips through JSON.
        let campaign_json = r#"{"id":"c","root_seed":null,"inner_cv":{"kind":"kfold","n_splits":3,"shuffle":false,"seed":5}}"#;
        let campaign: CampaignSpec = serde_json::from_str(campaign_json).unwrap();
        campaign.validate().unwrap();
        assert!(campaign.inner_cv.is_some());

        // A node-local declaration overrides the campaign default.
        let node_inner = crate::fold::NestedCvSpec::KFold(crate::fold::KFoldSpec {
            n_splits: 4,
            shuffle: false,
            seed: Some(6),
        });
        let resolved = crate::fold::resolve_inner_cv(Some(&node_inner), campaign.inner_cv.as_ref());
        assert_eq!(resolved, Some(&node_inner));

        // Absent on both campaign and node serializes away (skip_serializing_if).
        let bare = r#"{"id":"c","root_seed":null}"#;
        let bare_campaign: CampaignSpec = serde_json::from_str(bare).unwrap();
        assert!(bare_campaign.inner_cv.is_none());
        let reserialized = serde_json::to_string(&bare_campaign).unwrap();
        assert!(!reserialized.contains("inner_cv"));

        // A semantically-malformed campaign-global inner_cv (n_splits < 2) is
        // rejected by CampaignSpec::validate (the plan boundary), not deferred.
        let bad: CampaignSpec = serde_json::from_str(
            r#"{"id":"c","root_seed":null,"inner_cv":{"kind":"kfold","n_splits":1,"shuffle":false,"seed":null}}"#,
        )
        .unwrap();
        let error = bad.validate().unwrap_err();
        assert!(error.to_string().contains("at least two splits"));
    }

    #[test]
    fn execution_plan_validate_rejects_invalid_node_local_inner_cv() {
        // A canonical ExecutionPlan loaded from JSON (bypassing DSL lowering) can
        // carry a malformed node-local inner_cv; ExecutionPlan::validate must
        // refuse it rather than deferring to FIT_CV fold building.
        let campaign = CampaignSpec {
            inner_cv: None,
            id: "campaign:plan-validate".to_string(),
            root_seed: Some(7),
            leakage_policy: LeakageUnitPolicy::default(),
            aggregation_policy: AggregationPolicy::default(),
            split_invocation: None,
            generation: Default::default(),
            shape_plans: BTreeMap::new(),
            data_bindings: BTreeMap::new(),
            branch_view_plans: Vec::new(),
            metadata: BTreeMap::new(),
        };
        let mut plan =
            build_execution_plan("plan:validate", graph(), campaign, &registry()).unwrap();
        plan.validate().unwrap();
        plan.node_plans
            .get_mut(&NodeId::new("model:pls").unwrap())
            .unwrap()
            .inner_cv = Some(crate::fold::NestedCvSpec::KFold(crate::fold::KFoldSpec {
            n_splits: 1,
            shuffle: false,
            seed: None,
        }));
        let error = plan.validate().unwrap_err();
        assert!(matches!(error, DagMlError::Planning(_)));
        assert!(error.to_string().contains("invalid inner_cv"));
        assert!(error.to_string().contains("at least two splits"));
    }

    fn hardening_plan() -> ExecutionPlan {
        let campaign = CampaignSpec {
            inner_cv: None,
            id: "campaign:harden".to_string(),
            root_seed: Some(7),
            leakage_policy: LeakageUnitPolicy::default(),
            aggregation_policy: AggregationPolicy::default(),
            split_invocation: None,
            generation: Default::default(),
            shape_plans: BTreeMap::new(),
            data_bindings: BTreeMap::new(),
            branch_view_plans: Vec::new(),
            metadata: BTreeMap::new(),
        };
        build_execution_plan("plan:harden", graph(), campaign, &registry()).unwrap()
    }

    #[test]
    fn execution_plan_external_reader_rejects_positional_struct_sequences() {
        let plan = hardening_plan();
        let mut wire = serde_json::to_value(&plan).unwrap();
        wire["campaign"]["leakage_policy"] = serde_json::json!([]);

        // Serde's derived struct visitor accepts this internal positional form,
        // and the resulting typed plan is otherwise semantically valid.
        let permissive: ExecutionPlan = serde_json::from_value(wire.clone()).unwrap();
        permissive.validate().unwrap();

        // The published standalone JSON boundary is object-only and refuses it.
        let error = ExecutionPlan::from_json(&serde_json::to_string(&wire).unwrap()).unwrap_err();
        assert!(error.to_string().contains("must use a JSON object"));
        assert!(error.to_string().contains("campaign.leakage_policy"));
    }

    #[test]
    fn execution_plan_external_reader_preserves_typed_serde_compatibility() {
        let plan = hardening_plan();
        let mut wire = serde_json::to_value(&plan).unwrap();
        wire["graph_plan"]
            .as_object_mut()
            .unwrap()
            .remove("parallel_levels");
        wire["graph_plan"]["graph"]
            .as_object_mut()
            .unwrap()
            .insert("forward_compatible".to_string(), serde_json::json!(true));

        let parsed = ExecutionPlan::from_json(&serde_json::to_string(&wire).unwrap()).unwrap();
        assert!(parsed.graph_plan.parallel_levels.is_empty());
        assert_eq!(parsed.graph_plan.graph, plan.graph_plan.graph);
    }

    #[test]
    fn validate_rejects_manifest_keyed_under_foreign_controller_id() {
        let mut plan = hardening_plan();
        plan.validate().unwrap();
        plan.controller_manifests
            .get_mut(&ControllerId::new("controller:model").unwrap())
            .unwrap()
            .controller_id = ControllerId::new("controller:imposter").unwrap();
        let error = plan.validate().unwrap_err();
        assert!(matches!(error, DagMlError::Planning(_)));
        assert!(error.to_string().contains("declares id"));
    }

    #[test]
    fn validate_rejects_node_plan_keyed_under_foreign_node_id() {
        let mut plan = hardening_plan();
        plan.validate().unwrap();
        plan.node_plans
            .get_mut(&NodeId::new("model:pls").unwrap())
            .unwrap()
            .node_id = NodeId::new("transform:snv").unwrap();
        let error = plan.validate().unwrap_err();
        assert!(matches!(error, DagMlError::Planning(_)));
        assert!(error.to_string().contains("declares node_id"));
    }

    #[test]
    fn validate_rejects_node_plans_not_covering_graph_node_set() {
        let mut plan = hardening_plan();
        plan.validate().unwrap();
        // Re-key an existing plan under a node id absent from the graph. The
        // count is unchanged, so only an exact set check catches the mismatch.
        let mut ghost = plan
            .node_plans
            .remove(&NodeId::new("model:pls").unwrap())
            .unwrap();
        let bogus = NodeId::new("model:ghost").unwrap();
        ghost.node_id = bogus.clone();
        plan.node_plans.insert(bogus, ghost);
        let error = plan.validate().unwrap_err();
        assert!(matches!(error, DagMlError::Planning(_)));
        assert!(error
            .to_string()
            .contains("do not exactly cover the graph node-id set"));
    }

    #[test]
    fn validate_rejects_topological_order_that_omits_a_node() {
        let mut plan = hardening_plan();
        plan.validate().unwrap();
        // A forged order that drops `model:pls` must not let it skip per-node
        // validation or phase scheduling.
        plan.graph_plan.topological_order = vec![NodeId::new("transform:snv").unwrap()];
        let error = plan.validate().unwrap_err();
        assert!(matches!(error, DagMlError::Planning(_)));
        assert!(error
            .to_string()
            .contains("topological_order does not match"));
    }

    #[test]
    fn validate_rejects_node_plan_kind_that_differs_from_graph_node() {
        let mut plan = hardening_plan();
        plan.validate().unwrap();
        plan.node_plans
            .get_mut(&NodeId::new("model:pls").unwrap())
            .unwrap()
            .kind = NodeKind::Transform;
        let error = plan.validate().unwrap_err();
        assert!(matches!(error, DagMlError::Planning(_)));
        assert!(error
            .to_string()
            .contains("kind does not match graph node kind"));
    }

    #[test]
    fn validate_rejects_forged_input_adjacency() {
        let mut plan = hardening_plan();
        plan.validate().unwrap();
        // Trimming `model:pls`'s real upstream would shrink the predictor closure
        // replay derivation walks through `input_nodes`.
        plan.node_plans
            .get_mut(&NodeId::new("model:pls").unwrap())
            .unwrap()
            .input_nodes = vec![];
        let error = plan.validate().unwrap_err();
        assert!(matches!(error, DagMlError::Planning(_)));
        assert!(error
            .to_string()
            .contains("adjacency does not match the graph"));
    }

    #[test]
    fn validate_rejects_node_plan_supported_phases_that_diverge_from_manifest() {
        let mut plan = hardening_plan();
        plan.validate().unwrap();
        // Injecting EXPLAIN into the node plan without the manifest backing it is
        // exactly the forgery that could otherwise manufacture an EXPLAIN replay.
        plan.node_plans
            .get_mut(&NodeId::new("model:pls").unwrap())
            .unwrap()
            .supported_phases
            .insert(Phase::Explain);
        let error = plan.validate().unwrap_err();
        assert!(matches!(error, DagMlError::Planning(_)));
        assert!(error
            .to_string()
            .contains("does not match controller manifest"));
    }

    #[test]
    fn validate_rejects_node_plan_controller_version_that_diverges_from_manifest() {
        let mut plan = hardening_plan();
        plan.validate().unwrap();
        plan.node_plans
            .get_mut(&NodeId::new("model:pls").unwrap())
            .unwrap()
            .controller_version = "9.9.9".to_string();
        let error = plan.validate().unwrap_err();
        assert!(matches!(error, DagMlError::Planning(_)));
        assert!(error
            .to_string()
            .contains("does not match controller manifest"));
    }

    #[test]
    fn validate_rejects_stale_graph_fingerprint_after_graph_mutation() {
        let mut plan = hardening_plan();
        plan.validate().unwrap();
        // Mutate embedded graph content but RETAIN the stale graph_fingerprint —
        // exactly the tamper a caller would attempt before re-signing the outer
        // plan (whose bundle layer only compares fingerprint strings). Validation
        // must recompute from content and refuse.
        plan.graph_plan
            .graph
            .metadata
            .insert("tampered".to_string(), serde_json::json!(true));
        let error = plan.validate().unwrap_err();
        assert!(matches!(error, DagMlError::Planning(_)));
        assert!(error
            .to_string()
            .contains("graph_fingerprint does not match"));
    }

    #[test]
    fn validate_rejects_forged_graph_fingerprint_field() {
        let mut plan = hardening_plan();
        plan.validate().unwrap();
        // Direct fingerprint-field forgery with unchanged content is refused: the
        // recomputation from canonical content is the source of truth.
        plan.graph_fingerprint = "sha256:forged".to_string();
        let error = plan.validate().unwrap_err();
        assert!(matches!(error, DagMlError::Planning(_)));
        assert!(error
            .to_string()
            .contains("graph_fingerprint does not match"));
    }

    #[test]
    fn validate_rejects_stale_campaign_fingerprint_after_campaign_mutation() {
        let mut plan = hardening_plan();
        plan.validate().unwrap();
        // Mutate embedded campaign content, keep the stale campaign_fingerprint.
        plan.campaign
            .metadata
            .insert("tampered".to_string(), serde_json::json!("x"));
        let error = plan.validate().unwrap_err();
        assert!(matches!(error, DagMlError::Planning(_)));
        assert!(error
            .to_string()
            .contains("campaign_fingerprint does not match"));
    }

    #[test]
    fn validate_rejects_forged_campaign_fingerprint_field() {
        let mut plan = hardening_plan();
        plan.validate().unwrap();
        plan.campaign_fingerprint = "sha256:forged".to_string();
        let error = plan.validate().unwrap_err();
        assert!(matches!(error, DagMlError::Planning(_)));
        assert!(error
            .to_string()
            .contains("campaign_fingerprint does not match"));
    }

    #[test]
    fn validate_rejects_stale_controller_fingerprint_after_manifest_mutation() {
        let mut plan = hardening_plan();
        plan.validate().unwrap();
        // `priority` is embedded in the controller fingerprint but is NOT copied
        // into any NodePlan, so only the recomputed controller_fingerprint — never
        // a node-plan cross-copy check — can catch this manifest mutation. Keeping
        // the stale fingerprint string models an outer re-sign that leaves the
        // embedded string untouched.
        plan.controller_manifests
            .get_mut(&ControllerId::new("controller:model").unwrap())
            .unwrap()
            .priority = 7;
        let error = plan.validate().unwrap_err();
        assert!(matches!(error, DagMlError::Planning(_)));
        assert!(error
            .to_string()
            .contains("controller_fingerprint does not match"));
    }

    #[test]
    fn validate_rejects_forged_controller_fingerprint_field() {
        let mut plan = hardening_plan();
        plan.validate().unwrap();
        plan.controller_fingerprint = "sha256:forged".to_string();
        let error = plan.validate().unwrap_err();
        assert!(matches!(error, DagMlError::Planning(_)));
        assert!(error
            .to_string()
            .contains("controller_fingerprint does not match"));
    }

    #[test]
    fn build_execution_plan_lowers_dsl_inner_cv_metadata_into_node_plan() {
        let mut graph = graph();
        graph
            .nodes
            .iter_mut()
            .find(|node| node.id.as_str() == "model:pls")
            .unwrap()
            .metadata
            .insert(
                "dsl_inner_cv".to_string(),
                serde_json::json!({"kind": "kfold", "n_splits": 3, "shuffle": false, "seed": 9}),
            );

        let campaign = CampaignSpec {
            inner_cv: None,
            id: "campaign:inner-cv".to_string(),
            root_seed: Some(7),
            leakage_policy: LeakageUnitPolicy::default(),
            aggregation_policy: AggregationPolicy::default(),
            split_invocation: None,
            generation: Default::default(),
            shape_plans: BTreeMap::new(),
            data_bindings: BTreeMap::new(),
            branch_view_plans: Vec::new(),
            metadata: BTreeMap::new(),
        };

        let plan = build_execution_plan("plan:inner-cv", graph, campaign, &registry()).unwrap();
        match &plan.node_plans[&NodeId::new("model:pls").unwrap()].inner_cv {
            Some(crate::fold::NestedCvSpec::KFold(k)) => {
                assert_eq!(k.n_splits, 3);
                assert_eq!(k.seed, Some(9));
            }
            other => panic!("expected lowered KFold inner_cv, got {other:?}"),
        }
        assert!(plan.node_plans[&NodeId::new("transform:snv").unwrap()]
            .inner_cv
            .is_none());
    }

    #[test]
    fn build_execution_plan_rejects_malformed_dsl_inner_cv_metadata() {
        let mut graph = graph();
        graph
            .nodes
            .iter_mut()
            .find(|node| node.id.as_str() == "model:pls")
            .unwrap()
            .metadata
            .insert(
                "dsl_inner_cv".to_string(),
                serde_json::json!({"kind": "not_a_real_kind"}),
            );

        let campaign = CampaignSpec {
            inner_cv: None,
            id: "campaign:inner-cv.bad".to_string(),
            root_seed: Some(7),
            leakage_policy: LeakageUnitPolicy::default(),
            aggregation_policy: AggregationPolicy::default(),
            split_invocation: None,
            generation: Default::default(),
            shape_plans: BTreeMap::new(),
            data_bindings: BTreeMap::new(),
            branch_view_plans: Vec::new(),
            metadata: BTreeMap::new(),
        };

        let error =
            build_execution_plan("plan:inner-cv.bad", graph, campaign, &registry()).unwrap_err();
        assert!(matches!(error, DagMlError::Planning(_)));
        assert!(error.to_string().contains("invalid dsl_inner_cv metadata"));
    }

    #[test]
    fn build_execution_plan_rejects_semantically_invalid_dsl_inner_cv() {
        // Right discriminator, invalid value: a single split is rejected at the
        // plan boundary rather than deferred to FIT_CV fold building.
        let mut graph = graph();
        graph
            .nodes
            .iter_mut()
            .find(|node| node.id.as_str() == "model:pls")
            .unwrap()
            .metadata
            .insert(
                "dsl_inner_cv".to_string(),
                serde_json::json!({"kind": "kfold", "n_splits": 1, "shuffle": false, "seed": null}),
            );

        let campaign = CampaignSpec {
            inner_cv: None,
            id: "campaign:inner-cv.nsplits".to_string(),
            root_seed: Some(7),
            leakage_policy: LeakageUnitPolicy::default(),
            aggregation_policy: AggregationPolicy::default(),
            split_invocation: None,
            generation: Default::default(),
            shape_plans: BTreeMap::new(),
            data_bindings: BTreeMap::new(),
            branch_view_plans: Vec::new(),
            metadata: BTreeMap::new(),
        };

        let error = build_execution_plan("plan:inner-cv.nsplits", graph, campaign, &registry())
            .unwrap_err();
        assert!(matches!(error, DagMlError::Planning(_)));
        assert!(error.to_string().contains("at least two splits"));
    }
    use crate::data::{
        BranchViewMode, BranchViewPlan, DataBinding, DataViewSelector, SOURCE_INDEX_METADATA_KEY,
    };
    use crate::generation::{
        GenerationChoice, GenerationConstraints, GenerationDimension, GenerationParamOverride,
        GenerationStrategy,
    };
    use crate::graph::{
        EdgeContract, EdgeSpec, GraphInterface, NodeSpec, PortCardinality, PortKind, PortRef,
        PortSchema, PortSpec,
    };
    use crate::ids::{ControllerId, FoldId, ObservationId, SampleId, TargetId};
    use crate::phase::Phase;
    use crate::policy::{DataModelShapePlan, Granularity};
    use crate::relation::{SampleRelation, SampleRelationSet};

    fn port(name: &str, kind: PortKind) -> PortSpec {
        PortSpec {
            name: name.to_string(),
            kind,
            representation: None,
            cardinality: PortCardinality::One,
            unit_level: None,
            alignment_key: None,
            target_level: None,
            description: String::new(),
        }
    }

    fn node(id: &str, kind: NodeKind, inputs: Vec<PortSpec>, outputs: Vec<PortSpec>) -> NodeSpec {
        NodeSpec {
            id: NodeId::new(id).unwrap(),
            kind,
            operator: None,
            params: BTreeMap::new(),
            ports: PortSchema { inputs, outputs },
            metadata: BTreeMap::new(),
            seed_label: None,
        }
    }

    fn graph() -> GraphSpec {
        GraphSpec {
            id: "g".to_string(),
            interface: GraphInterface::default(),
            nodes: vec![
                node(
                    "transform:snv",
                    NodeKind::Transform,
                    vec![],
                    vec![port("x", PortKind::Data)],
                ),
                node(
                    "model:pls",
                    NodeKind::Model,
                    vec![port("x", PortKind::Data)],
                    vec![port("pred", PortKind::Prediction)],
                ),
            ],
            edges: vec![EdgeSpec {
                source: PortRef {
                    node_id: NodeId::new("transform:snv").unwrap(),
                    port_name: "x".to_string(),
                },
                target: PortRef {
                    node_id: NodeId::new("model:pls").unwrap(),
                    port_name: "x".to_string(),
                },
                contract: EdgeContract {
                    requires_oof: false,
                    requires_fold_alignment: false,
                    ..EdgeContract::new(PortKind::Data, None)
                },
            }],
            search_space_fingerprint: None,
            metadata: BTreeMap::new(),
        }
    }

    fn manifest(id: &str, kind: NodeKind) -> ControllerManifest {
        let mut capabilities = BTreeSet::from([
            ControllerCapability::Deterministic,
            ControllerCapability::ThreadSafe,
            ControllerCapability::ProcessSafe,
        ]);
        if kind == NodeKind::Model {
            capabilities.insert(ControllerCapability::EmitsPredictions);
            capabilities.insert(ControllerCapability::ConsumesOofPredictions);
        }
        ControllerManifest {
            controller_id: ControllerId::new(id).unwrap(),
            controller_version: "0.1.0".to_string(),
            operator_kind: kind,
            priority: 0,
            supported_phases: BTreeSet::from([Phase::FitCv, Phase::Refit, Phase::Predict]),
            input_ports: Vec::new(),
            output_ports: Vec::new(),
            data_requirements: None,
            capabilities,
            operator_selectors: Vec::new(),
            fit_scope: ControllerFitScope::FoldTrain,
            rng_policy: RngPolicy::UsesCoreSeed,
            artifact_policy: ArtifactPolicy::Serializable,
        }
    }

    fn registry() -> ControllerRegistry {
        let mut registry = ControllerRegistry::new();
        registry
            .register(manifest("controller:transform", NodeKind::Transform))
            .unwrap();
        registry
            .register(manifest("controller:model", NodeKind::Model))
            .unwrap();
        registry
    }

    fn registry_with_model_data_requirements(
        accepted_representations: &[&str],
        accepted_types: &[&str],
    ) -> ControllerRegistry {
        let mut registry = ControllerRegistry::new();
        registry
            .register(manifest("controller:transform", NodeKind::Transform))
            .unwrap();
        let mut model = manifest("controller:model", NodeKind::Model);
        model.data_requirements = Some(serde_json::json!({
            "schema_version": 1,
            "ports": [
                {
                    "name": "x",
                    "accepted_representations": accepted_representations,
                    "accepted_types": accepted_types,
                    "rank": 2,
                    "multi_source": true,
                    "optional": false
                }
            ],
            "metadata": {
                "source": "plan-test"
            }
        }));
        registry.register(model).unwrap();
        registry
    }

    fn registry_with_model_data_requirements_json(
        data_requirements: serde_json::Value,
    ) -> ControllerRegistry {
        let mut registry = ControllerRegistry::new();
        registry
            .register(manifest("controller:transform", NodeKind::Transform))
            .unwrap();
        let mut model = manifest("controller:model", NodeKind::Model);
        model.data_requirements = Some(data_requirements);
        registry.register(model).unwrap();
        registry
    }

    fn model_data_requirements(
        multi_source: bool,
        default_fusion: Option<serde_json::Value>,
    ) -> serde_json::Value {
        let mut spec = serde_json::json!({
            "schema_version": 1,
            "ports": [
                {
                    "name": "x",
                    "accepted_representations": ["tabular_numeric"],
                    "accepted_types": ["table"],
                    "rank": 2,
                    "multi_source": multi_source,
                    "optional": false
                }
            ],
            "metadata": {
                "source": "plan-test"
            }
        });
        if let Some(default_fusion) = default_fusion {
            spec.as_object_mut()
                .unwrap()
                .insert("default_fusion".to_string(), default_fusion);
        }
        spec
    }

    fn multisource_binding(node_id: &NodeId) -> DataBinding {
        let mut binding = data_binding(node_id);
        binding.request_id = "nir-chem-source-concat".to_string();
        binding.feature_set_id = Some("x_fused".to_string());
        binding.source_ids = vec!["nir".to_string(), "chem".to_string()];
        binding
    }

    fn add_source_index(binding: &mut DataBinding) {
        binding.metadata.insert(
            SOURCE_INDEX_METADATA_KEY.to_string(),
            serde_json::json!({
                "nir": 0,
                "chem": 1
            }),
        );
    }

    fn source_concat_fusion() -> serde_json::Value {
        serde_json::json!({
            "mode": "concatenate_features",
            "alignment": "sample_id",
            "adapter_id": null,
            "params": {
                "namespace_columns": true
            }
        })
    }

    fn by_source_graph(source_ids: Vec<&str>) -> GraphSpec {
        let mut graph = graph();
        let branch_view = BranchViewPlan {
            view_id: "branch_view:source".to_string(),
            branch_id: "branch:source".to_string(),
            mode: BranchViewMode::BySource,
            selector: DataViewSelector {
                source_ids: source_ids.into_iter().map(str::to_string).collect(),
                ..Default::default()
            },
            allow_overlap: false,
            metadata: BTreeMap::new(),
        };
        graph
            .nodes
            .iter_mut()
            .find(|node| node.id.as_str() == "model:pls")
            .unwrap()
            .metadata
            .insert(
                "dsl_branch_view_plan".to_string(),
                serde_json::to_value(branch_view).unwrap(),
            );
        graph
    }

    fn refusal_payload(error: DagMlError) -> serde_json::Value {
        let message = error.to_string();
        let payload = message
            .split_once("data requirement refusal: ")
            .unwrap_or_else(|| panic!("missing structured refusal payload in: {message}"))
            .1;
        serde_json::from_str(payload).unwrap()
    }

    fn campaign(id: &str) -> CampaignSpec {
        CampaignSpec {
            id: id.to_string(),
            root_seed: Some(7),
            leakage_policy: LeakageUnitPolicy::default(),
            aggregation_policy: AggregationPolicy::default(),
            split_invocation: None,
            generation: Default::default(),
            shape_plans: BTreeMap::new(),
            data_bindings: BTreeMap::new(),
            branch_view_plans: Vec::new(),
            inner_cv: None,
            metadata: BTreeMap::new(),
        }
    }

    #[cfg(dag_ml_workspace_contract_fixtures)]
    fn custom_loss_role(node_id: &str, output_id: &str) -> TrainingLossRoleReference {
        let fixture: serde_json::Value = serde_json::from_str(include_str!(
            "../../../examples/fixtures/criteria/javascript_local_implementations.v1.json"
        ))
        .unwrap();
        let mut role: TrainingLossRoleReference =
            serde_json::from_value(fixture["training_loss_role"].clone()).unwrap();
        role.node_id = NodeId::new(node_id).unwrap();
        role.output_id = Some(output_id.to_string());
        role
    }

    #[cfg(dag_ml_workspace_contract_fixtures)]
    #[test]
    fn execution_plan_lowers_training_losses_in_canonical_order() {
        let mut loss_registry = ControllerRegistry::new();
        loss_registry
            .register(manifest("controller:transform", NodeKind::Transform))
            .unwrap();
        let mut model_manifest = manifest("controller:model", NodeKind::Model);
        model_manifest.capabilities.extend([
            ControllerCapability::SupportsConfigurableLoss,
            ControllerCapability::SupportsCustomLoss,
            ControllerCapability::SupportsDifferentiableLoss,
        ]);
        loss_registry.register(model_manifest).unwrap();

        let plan = build_execution_plan(
            "plan:training-loss-lowering",
            graph(),
            campaign("campaign:training-loss-lowering"),
            &loss_registry,
        )
        .unwrap();
        let role_b = custom_loss_role("model:pls", "b");
        let role_a = custom_loss_role("model:pls", "a");
        let bound = plan
            .clone()
            .with_training_losses(vec![role_b, role_a.clone()])
            .unwrap();
        let model = bound
            .node_plans
            .get(&NodeId::new("model:pls").unwrap())
            .unwrap();
        assert_eq!(
            model
                .training_losses
                .iter()
                .map(|role| role.output_id.as_deref())
                .collect::<Vec<_>>(),
            vec![Some("a"), Some("b")]
        );

        let cleared = bound.with_training_losses(Vec::new()).unwrap();
        assert!(cleared
            .node_plans
            .values()
            .all(|node| node.training_losses.is_empty()));

        let mut unknown = role_a.clone();
        unknown.node_id = NodeId::new("model:unknown").unwrap();
        assert!(plan
            .clone()
            .with_training_losses(vec![unknown])
            .unwrap_err()
            .to_string()
            .contains("unknown plan node"));

        let incapable = build_execution_plan(
            "plan:training-loss-incapable",
            graph(),
            campaign("campaign:training-loss-incapable"),
            &registry(),
        )
        .unwrap();
        assert!(incapable
            .with_training_losses(vec![role_a])
            .unwrap_err()
            .to_string()
            .contains("does not support configurable loss"));
    }

    #[test]
    fn build_execution_plan_consumes_controller_data_requirements_for_bindings() {
        let model_id = NodeId::new("model:pls").unwrap();
        let mut campaign = campaign("campaign:datareq.ok");
        campaign.data_bindings = BTreeMap::from([(
            model_id,
            vec![data_binding(&NodeId::new("model:pls").unwrap())],
        )]);
        let plan = build_execution_plan(
            "plan:datareq.ok",
            graph(),
            campaign,
            &registry_with_model_data_requirements(&["tabular_numeric"], &["table"]),
        )
        .unwrap();
        assert_eq!(
            plan.node_plans[&NodeId::new("model:pls").unwrap()].data_bindings[0]
                .output_representation,
            "tabular_numeric"
        );
    }

    #[test]
    fn build_execution_plan_rejects_binding_representation_outside_data_requirements() {
        let model_id = NodeId::new("model:pls").unwrap();
        let mut campaign = campaign("campaign:datareq.representation");
        campaign.data_bindings =
            BTreeMap::from([(model_id.clone(), vec![data_binding(&model_id)])]);
        let error = build_execution_plan(
            "plan:datareq.representation",
            graph(),
            campaign,
            &registry_with_model_data_requirements(&["signal_1d"], &["dense_signal"]),
        )
        .unwrap_err();
        assert!(
            error.to_string().contains("output representation"),
            "unexpected error: {error}"
        );
    }

    #[test]
    fn build_execution_plan_rejects_binding_registered_type_outside_data_requirements() {
        let model_id = NodeId::new("model:pls").unwrap();
        let mut campaign = campaign("campaign:datareq.type");
        campaign.data_bindings =
            BTreeMap::from([(model_id.clone(), vec![data_binding(&model_id)])]);
        let error = build_execution_plan(
            "plan:datareq.type",
            graph(),
            campaign,
            &registry_with_model_data_requirements(&["tabular_numeric"], &["dense_signal"]),
        )
        .unwrap_err();
        assert!(
            error.to_string().contains("registered type `table`"),
            "unexpected error: {error}"
        );
    }

    #[test]
    fn build_execution_plan_rejects_source_concat_without_source_index() {
        let model_id = NodeId::new("model:pls").unwrap();
        let mut campaign = campaign("campaign:datareq.source-concat.no-index");
        campaign.data_bindings =
            BTreeMap::from([(model_id.clone(), vec![multisource_binding(&model_id)])]);

        let error = build_execution_plan(
            "plan:datareq.source-concat.no-index",
            graph(),
            campaign,
            &registry_with_model_data_requirements_json(model_data_requirements(
                true,
                Some(source_concat_fusion()),
            )),
        )
        .unwrap_err();
        let payload = refusal_payload(error);

        assert_eq!(
            payload["code"],
            "dagml.data_requirement.source_concat_requires_source_index"
        );
        assert_eq!(payload["shape"], "source_concat");
        assert_eq!(payload["source_ids"], serde_json::json!(["nir", "chem"]));
    }

    #[test]
    fn build_execution_plan_rejects_multisource_binding_without_data_requirements() {
        let model_id = NodeId::new("model:pls").unwrap();
        let mut campaign = campaign("campaign:datareq.multisource.no-requirements");
        campaign.data_bindings =
            BTreeMap::from([(model_id.clone(), vec![multisource_binding(&model_id)])]);

        let error = build_execution_plan(
            "plan:datareq.multisource.no-requirements",
            graph(),
            campaign,
            &registry(),
        )
        .unwrap_err();
        let payload = refusal_payload(error);

        assert_eq!(
            payload["code"],
            "dagml.data_requirement.missing_data_requirements"
        );
        assert_eq!(payload["source_ids"], serde_json::json!(["nir", "chem"]));
    }

    #[test]
    fn build_execution_plan_accepts_source_concat_with_source_index() {
        let model_id = NodeId::new("model:pls").unwrap();
        let mut binding = multisource_binding(&model_id);
        add_source_index(&mut binding);
        let mut campaign = campaign("campaign:datareq.source-concat.index");
        campaign.data_bindings = BTreeMap::from([(model_id.clone(), vec![binding])]);

        let plan = build_execution_plan(
            "plan:datareq.source-concat.index",
            graph(),
            campaign,
            &registry_with_model_data_requirements_json(model_data_requirements(
                true,
                Some(source_concat_fusion()),
            )),
        )
        .unwrap();

        assert_eq!(
            plan.node_plans[&model_id].data_bindings[0].metadata[SOURCE_INDEX_METADATA_KEY],
            serde_json::json!({"nir": 0, "chem": 1})
        );
    }

    #[test]
    fn by_source_branch_allows_single_source_fit_from_multisource_binding() {
        let model_id = NodeId::new("model:pls").unwrap();
        let mut campaign = campaign("campaign:datareq.by-source.single");
        campaign.data_bindings =
            BTreeMap::from([(model_id.clone(), vec![multisource_binding(&model_id)])]);

        let plan = build_execution_plan(
            "plan:datareq.by-source.single",
            by_source_graph(vec!["nir"]),
            campaign,
            &registry_with_model_data_requirements_json(model_data_requirements(false, None)),
        )
        .unwrap();

        assert_eq!(
            plan.node_plans[&model_id].data_bindings[0].source_ids.len(),
            2
        );
    }

    #[test]
    fn by_source_branch_refuses_multi_source_selector_shape() {
        let model_id = NodeId::new("model:pls").unwrap();
        let mut campaign = campaign("campaign:datareq.by-source.multi");
        campaign.data_bindings =
            BTreeMap::from([(model_id.clone(), vec![multisource_binding(&model_id)])]);

        let error = build_execution_plan(
            "plan:datareq.by-source.multi",
            by_source_graph(vec!["nir", "chem"]),
            campaign,
            &registry_with_model_data_requirements_json(model_data_requirements(true, None)),
        )
        .unwrap_err();
        let payload = refusal_payload(error);

        assert_eq!(
            payload["code"],
            "dagml.data_requirement.unsupported_by_source_shape"
        );
        assert_eq!(payload["shape"], "by_source");
        assert_eq!(payload["source_ids"], serde_json::json!(["nir", "chem"]));
    }

    fn large_linear_graph(transform_count: usize) -> GraphSpec {
        let mut nodes = Vec::new();
        let mut edges = Vec::new();
        for node_idx in 0..transform_count {
            let node_id = format!("transform:t{node_idx:04}");
            nodes.push(node(
                &node_id,
                NodeKind::Transform,
                vec![port("x", PortKind::Data)],
                vec![port("x", PortKind::Data)],
            ));
            if node_idx > 0 {
                edges.push(EdgeSpec {
                    source: PortRef {
                        node_id: NodeId::new(format!("transform:t{:04}", node_idx - 1)).unwrap(),
                        port_name: "x".to_string(),
                    },
                    target: PortRef {
                        node_id: NodeId::new(&node_id).unwrap(),
                        port_name: "x".to_string(),
                    },
                    contract: EdgeContract::new(PortKind::Data, None),
                });
            }
        }
        nodes.push(node(
            "model:final",
            NodeKind::Model,
            vec![port("x", PortKind::Data)],
            vec![port("pred", PortKind::Prediction)],
        ));
        edges.push(EdgeSpec {
            source: PortRef {
                node_id: NodeId::new(format!("transform:t{:04}", transform_count - 1)).unwrap(),
                port_name: "x".to_string(),
            },
            target: PortRef {
                node_id: NodeId::new("model:final").unwrap(),
                port_name: "x".to_string(),
            },
            contract: EdgeContract::new(PortKind::Data, None),
        });

        GraphSpec {
            id: "g:perf.linear".to_string(),
            interface: GraphInterface::default(),
            nodes,
            edges,
            search_space_fingerprint: None,
            metadata: BTreeMap::new(),
        }
    }

    fn oof_graph() -> GraphSpec {
        GraphSpec {
            id: "g:oof.capabilities".to_string(),
            interface: GraphInterface::default(),
            nodes: vec![
                node(
                    "model:base",
                    NodeKind::Model,
                    vec![],
                    vec![port("pred", PortKind::Prediction)],
                ),
                node(
                    "model:meta",
                    NodeKind::Model,
                    vec![port("pred", PortKind::Prediction)],
                    vec![port("pred", PortKind::Prediction)],
                ),
            ],
            edges: vec![EdgeSpec {
                source: PortRef {
                    node_id: NodeId::new("model:base").unwrap(),
                    port_name: "pred".to_string(),
                },
                target: PortRef {
                    node_id: NodeId::new("model:meta").unwrap(),
                    port_name: "pred".to_string(),
                },
                contract: EdgeContract {
                    requires_oof: true,
                    requires_fold_alignment: true,
                    ..EdgeContract::new(PortKind::Prediction, None)
                },
            }],
            search_space_fingerprint: None,
            metadata: BTreeMap::new(),
        }
    }

    fn data_binding(node_id: &NodeId) -> DataBinding {
        DataBinding {
            node_id: node_id.clone(),
            input_name: "x".to_string(),
            request_id: "nir-to-tabular".to_string(),
            schema_fingerprint: "f97b37872fa22134b508f98fd8e207e5b776b52594fb8f6f5c3e15bee212246b"
                .to_string(),
            plan_fingerprint: "7c5431d85574b3f337022fa5d25971d5b5cf445b90331b49938f573ff6901e4d"
                .to_string(),
            relation_fingerprint: Some(
                "a3a7e329df35db9f2883a17b8611b7fae6dcaa031875e3ec2c9be1b9e29cbe10".to_string(),
            ),
            output_representation: "tabular_numeric".to_string(),
            feature_set_id: Some("x".to_string()),
            source_ids: vec!["nir".to_string()],
            require_relations: true,
            view_policy: Default::default(),
            metadata: BTreeMap::new(),
        }
    }

    fn levels_as_strings(levels: &[Vec<NodeId>]) -> Vec<Vec<String>> {
        levels
            .iter()
            .map(|level| level.iter().map(ToString::to_string).collect())
            .collect()
    }

    #[cfg(dag_ml_workspace_contract_fixtures)]
    #[test]
    fn published_campaign_spec_schema_declares_current_contract() {
        let schema: serde_json::Value = serde_json::from_str(include_str!(
            "../../../docs/contracts/campaign_spec.schema.json"
        ))
        .unwrap();

        assert_eq!(schema["$id"], CAMPAIGN_SPEC_SCHEMA_ID);
        assert!(schema["required"]
            .as_array()
            .unwrap()
            .iter()
            .any(|field| field.as_str() == Some("id")));
        assert!(schema["$defs"]["split_invocation"]["properties"]
            .as_object()
            .unwrap()
            .contains_key("fold_set"));
        assert!(schema["$defs"]["aggregation_policy"]["properties"]
            .as_object()
            .unwrap()
            .contains_key("selection_metric_level"));
        assert!(schema["$defs"]["aggregation_policy"]["properties"]
            .as_object()
            .unwrap()
            .contains_key("custom_controller"));
        assert!(schema["$defs"]["data_binding"]["properties"]
            .as_object()
            .unwrap()
            .contains_key("view_policy"));
        assert!(schema["properties"]
            .as_object()
            .unwrap()
            .contains_key("branch_view_plans"));
        assert!(schema["$defs"]["branch_view_plan"]["properties"]
            .as_object()
            .unwrap()
            .contains_key("selector"));
    }

    #[cfg(dag_ml_workspace_contract_fixtures)]
    #[test]
    fn published_execution_plan_schema_declares_current_contract() {
        let schema: serde_json::Value = serde_json::from_str(include_str!(
            "../../../docs/contracts/execution_plan.schema.json"
        ))
        .unwrap();

        assert_eq!(schema["$id"], EXECUTION_PLAN_SCHEMA_ID);
        assert!(schema["required"]
            .as_array()
            .unwrap()
            .iter()
            .any(|field| field.as_str() == Some("node_plans")));
        assert!(schema["properties"]
            .as_object()
            .unwrap()
            .contains_key("controller_fingerprint"));
        assert!(schema["$defs"]["node_plan"]["properties"]
            .as_object()
            .unwrap()
            .contains_key("shape_plan"));
        assert!(schema["$defs"]["variant_plan"]["properties"]
            .as_object()
            .unwrap()
            .contains_key("choices"));
    }

    #[cfg(dag_ml_workspace_contract_fixtures)]
    #[test]
    fn published_execution_plan_fixture_validates_current_contract() {
        let plan: ExecutionPlan = serde_json::from_str(include_str!(
            "../../../examples/fixtures/runtime/execution_plan_branch_merge_executable.json"
        ))
        .unwrap();

        plan.validate().unwrap();
        assert_eq!(plan.id, "plan:fixture.execution.branch_merge");
        assert_eq!(plan.variants.len(), 2);
        assert_eq!(plan.node_plans.len(), plan.graph_plan.graph.nodes.len());
    }

    #[test]
    #[ignore = "perf sanity probe; run with --release --ignored --nocapture"]
    fn build_execution_plan_large_linear_graph_under_1500ms() {
        let started = Instant::now();
        let plan = build_execution_plan(
            "plan:perf.linear",
            large_linear_graph(400),
            campaign("campaign:perf.linear"),
            &registry(),
        )
        .unwrap();
        let elapsed = started.elapsed();

        assert_eq!(plan.graph_plan.topological_order.len(), 401);
        assert_eq!(plan.node_plans.len(), 401);
        assert!(
            elapsed <= Duration::from_millis(1_500),
            "large execution-plan build took {elapsed:?}"
        );
    }

    #[test]
    fn builds_execution_plan_with_shape_and_fold_contracts() {
        let model_id = NodeId::new("model:pls").unwrap();
        let campaign = CampaignSpec {
            inner_cv: None,
            id: "campaign:oof".to_string(),
            root_seed: Some(7),
            leakage_policy: LeakageUnitPolicy::default(),
            aggregation_policy: AggregationPolicy::default(),
            split_invocation: Some(SplitInvocation {
                id: "split:outer".to_string(),
                controller_id: None,
                leakage_policy: LeakageUnitPolicy::default(),
                params: BTreeMap::new(),
                fold_set: Some(FoldSet {
                    id: "outer".to_string(),
                    sample_ids: vec![SampleId::new("s1").unwrap(), SampleId::new("s2").unwrap()],
                    folds: vec![
                        crate::fold::FoldAssignment {
                            fold_id: FoldId::new("fold0").unwrap(),
                            train_sample_ids: vec![SampleId::new("s2").unwrap()],
                            validation_sample_ids: vec![SampleId::new("s1").unwrap()],
                            metadata: BTreeMap::new(),
                        },
                        crate::fold::FoldAssignment {
                            fold_id: FoldId::new("fold1").unwrap(),
                            train_sample_ids: vec![SampleId::new("s1").unwrap()],
                            validation_sample_ids: vec![SampleId::new("s2").unwrap()],
                            metadata: BTreeMap::new(),
                        },
                    ],
                    sample_groups: BTreeMap::new(),
                    partition_mode: FoldPartitionMode::Partition,
                }),
            }),
            generation: Default::default(),
            shape_plans: BTreeMap::from([(
                model_id.clone(),
                DataModelShapePlan {
                    node_id: model_id.clone(),
                    input_granularity: Granularity::Observation,
                    ..DataModelShapePlan {
                        node_id: model_id.clone(),
                        input_granularity: Granularity::Sample,
                        target_granularity: Granularity::Sample,
                        fit_rows: crate::policy::FitBoundary::FoldTrain,
                        predict_rows: crate::policy::FitBoundary::FoldValidation,
                        feature_namespace: None,
                        feature_schema_fingerprint: None,
                        target_space: "raw".to_string(),
                        aggregation_policy: AggregationPolicy::default(),
                        augmentation_policy: crate::policy::AugmentationPolicy::default(),
                        selection_policy: crate::policy::FeatureSelectionPolicy::default(),
                    }
                },
            )]),
            data_bindings: BTreeMap::from([(model_id.clone(), vec![data_binding(&model_id)])]),
            branch_view_plans: Vec::new(),
            metadata: BTreeMap::new(),
        };

        let plan = build_execution_plan("plan:oof", graph(), campaign, &registry()).unwrap();

        assert_eq!(
            plan.graph_plan
                .topological_order
                .iter()
                .map(ToString::to_string)
                .collect::<Vec<_>>(),
            vec!["transform:snv", "model:pls"]
        );
        assert_eq!(
            levels_as_strings(&plan.graph_plan.parallel_levels),
            vec![vec!["transform:snv"], vec!["model:pls"]]
        );
        assert!(plan.node_plans[&model_id]
            .controller_capabilities
            .contains(&ControllerCapability::EmitsPredictions));
        assert!(plan.fold_set.is_some());
        let schedule = plan.campaign_phase_schedule(Phase::FitCv).unwrap();
        assert_eq!(schedule.scopes.len(), 2);
        assert!(schedule.scopes[0].scope_id.starts_with("scope:FIT_CV:"));
        assert!(schedule
            .scopes
            .iter()
            .all(|scope| levels_as_strings(&scope.node_levels)
                == vec![vec!["transform:snv"], vec!["model:pls"]]));
        assert_eq!(
            schedule
                .scopes
                .iter()
                .filter_map(|scope| scope.fold_id.as_ref().map(ToString::to_string))
                .collect::<Vec<_>>(),
            vec!["fold0", "fold1"]
        );
        assert_eq!(
            plan.node_plans
                .get(&model_id)
                .unwrap()
                .controller_id
                .as_str(),
            "controller:model"
        );
        assert_eq!(
            plan.node_plans.get(&model_id).unwrap().data_bindings.len(),
            1
        );

        let mut bad_plan = plan.clone();
        bad_plan.graph_plan.parallel_levels =
            vec![vec![model_id], vec![NodeId::new("transform:snv").unwrap()]];
        assert!(bad_plan
            .validate()
            .unwrap_err()
            .to_string()
            .contains("parallel levels"));

        let bad_envelope = ExternalDataPlanEnvelope {
            schema_version: crate::data::EXTERNAL_DATA_PLAN_ENVELOPE_SCHEMA_VERSION,
            schema_fingerprint: "f97b37872fa22134b508f98fd8e207e5b776b52594fb8f6f5c3e15bee212246b"
                .to_string(),
            plan_fingerprint: "7c5431d85574b3f337022fa5d25971d5b5cf445b90331b49938f573ff6901e4d"
                .to_string(),
            relation_fingerprint: None,
            data_content_fingerprint: None,
            target_content_fingerprint: None,
            coordinator_relations: Some(SampleRelationSet {
                records: vec![{
                    let mut relation = SampleRelation::new(
                        ObservationId::new("obs:outside").unwrap(),
                        SampleId::new("sample:outside").unwrap(),
                    );
                    relation.target_id = Some(TargetId::new("target:outside").unwrap());
                    relation.source_id = Some("nir".to_string());
                    relation
                }],
            }),
            predict_cohort: None,
        };
        assert!(plan
            .campaign
            .validate_data_envelope_relations(&bad_envelope)
            .unwrap_err()
            .to_string()
            .contains("outside fold set"));
    }

    #[test]
    fn planning_refuses_shape_plan_for_unknown_node() {
        let campaign = CampaignSpec {
            inner_cv: None,
            id: "campaign:oof".to_string(),
            root_seed: Some(7),
            leakage_policy: LeakageUnitPolicy::default(),
            aggregation_policy: AggregationPolicy::default(),
            split_invocation: None,
            generation: Default::default(),
            shape_plans: BTreeMap::from([(
                NodeId::new("model:missing").unwrap(),
                DataModelShapePlan {
                    node_id: NodeId::new("model:missing").unwrap(),
                    input_granularity: Granularity::Sample,
                    target_granularity: Granularity::Sample,
                    fit_rows: crate::policy::FitBoundary::FoldTrain,
                    predict_rows: crate::policy::FitBoundary::FoldValidation,
                    feature_namespace: None,
                    feature_schema_fingerprint: None,
                    target_space: "raw".to_string(),
                    aggregation_policy: AggregationPolicy::default(),
                    augmentation_policy: crate::policy::AugmentationPolicy::default(),
                    selection_policy: crate::policy::FeatureSelectionPolicy::default(),
                },
            )]),
            data_bindings: BTreeMap::new(),
            branch_view_plans: Vec::new(),
            metadata: BTreeMap::new(),
        };

        assert!(build_execution_plan("plan:oof", graph(), campaign, &registry()).is_err());
    }

    #[test]
    fn planning_refuses_oof_edge_without_controller_capabilities() {
        let mut registry = ControllerRegistry::new();
        let mut model_manifest = manifest("controller:model", NodeKind::Model);
        model_manifest
            .capabilities
            .remove(&ControllerCapability::ConsumesOofPredictions);
        registry.register(model_manifest).unwrap();

        let err = build_execution_plan(
            "plan:oof.capability",
            oof_graph(),
            CampaignSpec {
                inner_cv: None,
                id: "campaign:oof.capability".to_string(),
                root_seed: Some(11),
                leakage_policy: Default::default(),
                aggregation_policy: Default::default(),
                split_invocation: None,
                generation: Default::default(),
                shape_plans: BTreeMap::new(),
                data_bindings: BTreeMap::new(),
                branch_view_plans: Vec::new(),
                metadata: BTreeMap::new(),
            },
            &registry,
        )
        .unwrap_err();

        assert!(err.to_string().contains("consumes_oof_predictions"));
    }

    #[test]
    fn planning_refuses_raw_prediction_sibling_port_into_fitting_node() {
        let mut graph = oof_graph();
        graph.id = "g:oof.raw-sibling".to_string();
        let base = graph
            .nodes
            .iter_mut()
            .find(|node| node.id.as_str() == "model:base")
            .unwrap();
        base.ports.outputs.push(port("aux", PortKind::Prediction));
        let meta = graph
            .nodes
            .iter_mut()
            .find(|node| node.id.as_str() == "model:meta")
            .unwrap();
        meta.ports.inputs.push(port("aux", PortKind::Prediction));
        graph.edges.push(EdgeSpec {
            source: PortRef {
                node_id: NodeId::new("model:base").unwrap(),
                port_name: "aux".to_string(),
            },
            target: PortRef {
                node_id: NodeId::new("model:meta").unwrap(),
                port_name: "aux".to_string(),
            },
            contract: EdgeContract::new(PortKind::Prediction, None),
        });

        let error = build_execution_plan(
            "plan:oof.raw-sibling",
            graph,
            campaign("campaign:oof.raw-sibling"),
            &registry(),
        )
        .unwrap_err()
        .to_string();

        assert!(error.contains("enters fitting controller"));
        assert!(error.contains("must require OOF"));
    }

    #[test]
    fn parallel_controller_capability_validation_requires_safe_manifest() {
        let mut registry = ControllerRegistry::new();
        let mut transform_manifest = manifest("controller:transform", NodeKind::Transform);
        transform_manifest
            .capabilities
            .remove(&ControllerCapability::ThreadSafe);
        transform_manifest
            .capabilities
            .remove(&ControllerCapability::ProcessSafe);
        registry.register(transform_manifest).unwrap();
        registry
            .register(manifest("controller:model", NodeKind::Model))
            .unwrap();
        let plan = build_execution_plan(
            "plan:parallel.capability",
            graph(),
            CampaignSpec {
                inner_cv: None,
                id: "campaign:parallel.capability".to_string(),
                root_seed: Some(11),
                leakage_policy: Default::default(),
                aggregation_policy: Default::default(),
                split_invocation: None,
                generation: Default::default(),
                shape_plans: BTreeMap::new(),
                data_bindings: BTreeMap::new(),
                branch_view_plans: Vec::new(),
                metadata: BTreeMap::new(),
            },
            &registry,
        )
        .unwrap();

        assert!(plan
            .validate_parallel_controller_capabilities(1, Phase::FitCv)
            .is_ok());
        let err = plan
            .validate_parallel_controller_capabilities(2, Phase::FitCv)
            .unwrap_err();
        assert!(err.to_string().contains("thread_safe or process_safe"));
    }

    #[test]
    fn planning_refuses_generation_override_for_unknown_node() {
        let campaign = CampaignSpec {
            inner_cv: None,
            id: "campaign:oof".to_string(),
            root_seed: Some(7),
            leakage_policy: LeakageUnitPolicy::default(),
            aggregation_policy: AggregationPolicy::default(),
            split_invocation: None,
            generation: GenerationSpec {
                strategy: GenerationStrategy::Cartesian,
                dimensions: vec![GenerationDimension {
                    name: "model_family".to_string(),
                    choices: vec![GenerationChoice {
                        label: "pls".to_string(),
                        value: serde_json::json!("pls"),
                        param_overrides: vec![GenerationParamOverride {
                            node_id: NodeId::new("model:missing").unwrap(),
                            params: BTreeMap::from([(
                                "n_components".to_string(),
                                serde_json::json!(8),
                            )]),
                        }],
                        active_subsequence: None,
                    }],
                }],
                max_variants: Some(1),
                constraints: GenerationConstraints::default(),
            },
            shape_plans: BTreeMap::new(),
            data_bindings: BTreeMap::new(),
            branch_view_plans: Vec::new(),
            metadata: BTreeMap::new(),
        };

        let error = build_execution_plan("plan:oof", graph(), campaign, &registry())
            .unwrap_err()
            .to_string();

        assert!(error.contains("overrides params for unknown node"));
    }

    #[test]
    fn planning_validates_declared_search_space_fingerprint() {
        let campaign = CampaignSpec {
            inner_cv: None,
            id: "campaign:search.fingerprint".to_string(),
            root_seed: Some(7),
            leakage_policy: LeakageUnitPolicy::default(),
            aggregation_policy: AggregationPolicy::default(),
            split_invocation: None,
            generation: GenerationSpec {
                strategy: GenerationStrategy::Cartesian,
                dimensions: vec![GenerationDimension {
                    name: "model_family".to_string(),
                    choices: vec![GenerationChoice {
                        label: "pls".to_string(),
                        value: serde_json::json!("pls"),
                        param_overrides: vec![GenerationParamOverride {
                            node_id: NodeId::new("model:pls").unwrap(),
                            params: BTreeMap::from([(
                                "n_components".to_string(),
                                serde_json::json!(8),
                            )]),
                        }],
                        active_subsequence: None,
                    }],
                }],
                max_variants: Some(1),
                constraints: GenerationConstraints::default(),
            },
            shape_plans: BTreeMap::new(),
            data_bindings: BTreeMap::new(),
            branch_view_plans: Vec::new(),
            metadata: BTreeMap::new(),
        };
        let mut graph = graph();
        graph.search_space_fingerprint =
            Some(generation_spec_fingerprint(&campaign.generation).unwrap());

        let plan = build_execution_plan(
            "plan:search.fingerprint",
            graph.clone(),
            campaign.clone(),
            &registry(),
        )
        .unwrap();
        assert_eq!(plan.variants.len(), 1);

        graph.search_space_fingerprint = Some("sha256:not-the-generation-spec".to_string());
        let error = build_execution_plan("plan:search.fingerprint", graph, campaign, &registry())
            .unwrap_err()
            .to_string();
        assert!(error.contains("search_space_fingerprint"));
    }

    #[test]
    fn branch_view_lookup_helpers_match_by_branch_id_and_innermost_path() {
        use crate::data::{BranchViewMode, DataViewSelector};

        let outer = BranchViewPlan {
            view_id: "branch_view:outer".to_string(),
            branch_id: "branch:outer".to_string(),
            mode: BranchViewMode::BySource,
            selector: DataViewSelector {
                source_ids: vec!["nir".to_string()],
                ..Default::default()
            },
            allow_overlap: false,
            metadata: BTreeMap::new(),
        };
        let inner = BranchViewPlan {
            view_id: "branch_view:inner".to_string(),
            branch_id: "branch:inner".to_string(),
            mode: BranchViewMode::Separation,
            selector: DataViewSelector {
                source_ids: vec!["chem".to_string()],
                ..Default::default()
            },
            allow_overlap: false,
            metadata: BTreeMap::new(),
        };
        let plans = vec![outer.clone(), inner.clone()];

        assert_eq!(
            super::branch_view_for_in(&plans, "branch:outer"),
            Some(&outer)
        );
        assert_eq!(
            super::branch_view_for_in(&plans, "branch:inner"),
            Some(&inner)
        );
        assert_eq!(super::branch_view_for_in(&plans, "branch:missing"), None);

        let path = vec!["branch:outer".to_string(), "branch:inner".to_string()];
        // tip-first: innermost matching branch wins
        assert_eq!(super::branch_view_for_path_in(&plans, &path), Some(&inner));

        let path_outer_only = vec!["branch:outer".to_string()];
        assert_eq!(
            super::branch_view_for_path_in(&plans, &path_outer_only),
            Some(&outer)
        );

        let empty_path: Vec<String> = Vec::new();
        assert_eq!(super::branch_view_for_path_in(&plans, &empty_path), None);

        let path_no_match = vec!["branch:other".to_string()];
        assert_eq!(super::branch_view_for_path_in(&plans, &path_no_match), None);
    }
}
