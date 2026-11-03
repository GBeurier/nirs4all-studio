//! Compiler-owned structural candidates for host HPO. The catalogue contains
//! declarations only; every consumer reconstructs its plans before execution.

use super::*;
use crate::{
    compile_operator_variant_models, compile_pipeline_dsl_with_generation_and_controller_registry,
    resolve_pipeline_dsl_minimal_aliases, ControllerRegistry, GenerationDimension, GenerationSpec,
    GenerationStrategy, PipelineDslSpec, TrainingRequest,
};

#[path = "host_hpo_topology.rs"]
mod topology;
pub use topology::{prepare_host_hpo_topology_catalogue, HostHpoTopologyContract};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct HostHpoStructuralRecipe {
    pub recipe_id: VariantId,
    pub variant: VariantPlan,
    pub variant_label: String,
    pub target_node: NodeId,
    pub graph_fingerprint: String,
    pub controller_fingerprint: String,
    pub graph: crate::GraphSpec,
    pub parameter_bindings: BTreeMap<String, HostHpoParameterBinding>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct HostHpoStructuralCatalogue {
    pub schema_version: u32,
    pub selector_path: String,
    pub source_dsl: PipelineDslSpec,
    pub parameter_paths: BTreeMap<String, String>,
    pub entries: Vec<HostHpoStructuralRecipe>,
    pub catalogue_fingerprint: String,
    /// Additive V2 declaration. Its absence preserves V1 JSON and hash preimages.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub topology_contract: Option<HostHpoTopologyContract>,
}

/// Compile the existing operator generator, preserving its native choice
/// order, IDs, active subsequences and content labels. The first profile has
/// one cartesian generator (which may contain several declared stages), one
/// scored model per recipe, and explicit shared folds.
pub fn prepare_host_hpo_structural_catalogue(
    dsl: &PipelineDslSpec,
    registry: &ControllerRegistry,
    parameter_paths: BTreeMap<String, String>,
    selector_path: String,
) -> Result<HostHpoStructuralCatalogue> {
    if selector_path.trim().is_empty()
        || parameter_paths.is_empty()
        || parameter_paths.contains_key(&selector_path)
        || parameter_paths
            .iter()
            .any(|(path, local)| path.trim().is_empty() || local.trim().is_empty())
    {
        return Err(DagMlError::RuntimeValidation(
            "structural HPO requires a distinct selector and nonempty parameter paths".into(),
        ));
    }
    let source_dsl = resolve_pipeline_dsl_minimal_aliases(dsl, registry)?;
    let models = compile_operator_variant_models(&source_dsl)?;
    let [model] = models.as_slice() else {
        return Err(DagMlError::RuntimeValidation(
            "structural HPO requires one native cartesian operator generator".into(),
        ));
    };
    if model.dimension.choices.len() > 4096 {
        return Err(DagMlError::RuntimeValidation(
            "structural HPO catalogue exceeds 4096 recipes".into(),
        ));
    }
    let compiled =
        compile_pipeline_dsl_with_generation_and_controller_registry(&source_dsl, registry)?;
    let plan = crate::build_execution_plan(
        format!("plan:{}:host_hpo", source_dsl.id),
        compiled.graph,
        compiled.campaign_template,
        registry,
    )?;
    if plan.fold_set.is_none() || plan.variants.len() != 1 || !plan.variants[0].choices.is_empty() {
        return Err(DagMlError::RuntimeValidation(
            "structural HPO requires explicit shared folds and no additional numeric generation"
                .into(),
        ));
    }
    let variants = enumerate_operator_variants(&models, plan.campaign.root_seed)?;
    if variants.is_empty() || variants.len() > 4096 {
        return Err(DagMlError::RuntimeValidation(
            "structural HPO catalogue must contain between one and 4096 recipes".into(),
        ));
    }
    let mut entries = Vec::with_capacity(variants.len());
    let mut covered = BTreeSet::new();
    for variant in variants {
        let candidate = pruned_plan_for_operator_models(&plan, &models, &variant)?;
        crate::methods_classification::validate_methods_classification_plan(&candidate)?;
        let targets = candidate
            .node_plans
            .values()
            .filter(|node| {
                node.kind == NodeKind::Model && node.supported_phases.contains(&Phase::FitCv)
            })
            .collect::<Vec<_>>();
        let [target] = targets.as_slice() else {
            return Err(DagMlError::RuntimeValidation(
                "structural HPO recipes require exactly one FIT_CV model target".into(),
            ));
        };
        let mut bindings = BTreeMap::new();
        for (path, local) in &parameter_paths {
            if target.params.contains_key(local) {
                if bindings
                    .values()
                    .any(|binding: &HostHpoParameterBinding| binding.param_path == *local)
                {
                    return Err(DagMlError::RuntimeValidation(
                        "structural HPO parameter bindings collide".into(),
                    ));
                }
                covered.insert(path.clone());
                bindings.insert(
                    path.clone(),
                    HostHpoParameterBinding {
                        node_id: target.node_id.clone(),
                        param_path: local.clone(),
                    },
                );
            }
        }
        let subsequence = operator_variant_active_subsequence(model, &variant)?;
        let variant_label = model
            .variant_labels
            .get(subsequence)
            .ok_or_else(|| {
                DagMlError::RuntimeValidation(
                    "structural HPO recipe lacks a native content label".into(),
                )
            })?
            .clone();
        entries.push(HostHpoStructuralRecipe {
            recipe_id: variant.variant_id.clone(),
            variant,
            variant_label,
            target_node: target.node_id.clone(),
            graph_fingerprint: candidate.graph_fingerprint,
            controller_fingerprint: candidate.controller_fingerprint,
            parameter_bindings: bindings,
            graph: candidate.graph_plan.graph,
        });
    }
    if covered != parameter_paths.keys().cloned().collect() {
        return Err(DagMlError::RuntimeValidation(
            "structural HPO parameter paths must occur on at least one declared model".into(),
        ));
    }
    let mut catalogue = HostHpoStructuralCatalogue {
        schema_version: 1,
        selector_path,
        source_dsl,
        parameter_paths,
        entries,
        catalogue_fingerprint: String::new(),
        topology_contract: None,
    };
    catalogue.catalogue_fingerprint = catalogue.compute_fingerprint()?;
    Ok(catalogue)
}

impl HostHpoStructuralCatalogue {
    fn compute_fingerprint(&self) -> Result<String> {
        if let Some(contract) = &self.topology_contract {
            return stable_json_fingerprint(&(
                self.schema_version,
                &self.selector_path,
                &self.source_dsl,
                &self.parameter_paths,
                &self.entries,
                contract,
            ));
        }
        stable_json_fingerprint(&(
            self.schema_version,
            &self.selector_path,
            &self.source_dsl,
            &self.parameter_paths,
            &self.entries,
        ))
    }

    /// Recompile from declarations, then compare all derived fields and the
    /// union graph/campaign/controllers. An outer reseal cannot legitimize a
    /// changed active-node set, model, binding, ordering or content label.
    pub fn validate_for_plan(&self, plan: &ExecutionPlan) -> Result<()> {
        let mut registry = ControllerRegistry::new();
        for manifest in plan.controller_manifests.values() {
            registry.register(manifest.clone())?;
        }
        let expected = match (self.schema_version, &self.topology_contract) {
            (1, None) => prepare_host_hpo_structural_catalogue(
                &self.source_dsl,
                &registry,
                self.parameter_paths.clone(),
                self.selector_path.clone(),
            )?,
            (2, Some(contract)) if self.parameter_paths.is_empty() => {
                prepare_host_hpo_topology_catalogue(
                    &self.source_dsl,
                    &registry,
                    contract.parameter_bindings.clone(),
                    contract.scored_nodes.clone(),
                    self.selector_path.clone(),
                )?
            }
            _ => {
                return Err(DagMlError::RuntimeValidation(
                    "structural HPO catalogue schema/declaration mismatch".into(),
                ))
            }
        };
        let compiled = compile_pipeline_dsl_with_generation_and_controller_registry(
            &self.source_dsl,
            &registry,
        )?;
        if self.catalogue_fingerprint != self.compute_fingerprint()?
            || stable_json_fingerprint(self)? != stable_json_fingerprint(&expected)?
            || stable_json_fingerprint(&compiled.graph)? != plan.graph_fingerprint
            || stable_json_fingerprint(&compiled.campaign_template)?
                != stable_json_fingerprint(&plan.campaign)?
        {
            return Err(DagMlError::RuntimeValidation(
                "structural HPO catalogue declaration/plan/controller binding mismatch".into(),
            ));
        }
        Ok(())
    }

    pub(crate) fn recipe<'a>(
        &'a self,
        params: &BTreeMap<String, serde_json::Value>,
    ) -> Result<&'a HostHpoStructuralRecipe> {
        let selector = params
            .get(&self.selector_path)
            .and_then(serde_json::Value::as_str)
            .ok_or_else(|| {
                DagMlError::RuntimeValidation(
                    "structural HPO proposal requires its recipe selector".into(),
                )
            })?;
        let recipe = self
            .entries
            .iter()
            .find(|entry| entry.recipe_id.as_str() == selector)
            .ok_or_else(|| {
                DagMlError::RuntimeValidation(format!("structural HPO unknown recipe `{selector}`"))
            })?;
        for path in params.keys().filter(|path| *path != &self.selector_path) {
            if !recipe.parameter_bindings.contains_key(path) {
                return Err(DagMlError::RuntimeValidation(format!(
                    "structural HPO parameter `{path}` is inactive for recipe `{selector}`"
                )));
            }
            if params[path].as_f64().is_none_or(|value| !value.is_finite()) {
                return Err(DagMlError::RuntimeValidation(
                    "structural HPO active parameters must be finite numeric values".into(),
                ));
            }
        }
        if recipe
            .parameter_bindings
            .keys()
            .any(|path| !params.contains_key(path))
        {
            return Err(DagMlError::RuntimeValidation(
                "structural HPO proposal is missing an active parameter".into(),
            ));
        }
        Ok(recipe)
    }

    pub(crate) fn candidate_plan(
        &self,
        plan: &ExecutionPlan,
        params: &BTreeMap<String, serde_json::Value>,
    ) -> Result<ExecutionPlan> {
        let recipe = self.recipe(params)?;
        let models = compile_operator_variant_models(&self.source_dsl)?;
        let candidate = pruned_plan_for_operator_models(plan, &models, &recipe.variant)?;
        if candidate.graph_fingerprint != recipe.graph_fingerprint
            || candidate.controller_fingerprint != recipe.controller_fingerprint
        {
            return Err(DagMlError::RuntimeValidation(
                "structural HPO candidate plan binding mismatch".into(),
            ));
        }
        Ok(candidate)
    }
}

/// Turn the validated native SELECT result into an ordinary signed W1 request.
/// The host supplies its data/output/resource template; Rust owns pruning,
/// effective parameters and the retained native recipe VariantPlan.
pub fn resolve_host_hpo_structural_winner(
    request: &HostHpoSearchRequest,
    result: &HostHpoSearchResult,
    template: &TrainingRequest,
) -> Result<TrainingRequest> {
    let catalogue = request.structural_catalogue.as_ref().ok_or_else(|| {
        DagMlError::RuntimeValidation(
            "winner resolution requires a structural HPO catalogue".into(),
        )
    })?;
    let mut registry = ControllerRegistry::new();
    for manifest in &template.controller_manifests {
        registry.register(manifest.clone())?;
    }
    let search_plan_id = result
        .trials
        .first()
        .map(|trial| trial.scores.plan_id.clone())
        .ok_or_else(|| {
            DagMlError::RuntimeValidation(
                "structural winner requires an observed complete trial".into(),
            )
        })?;
    let plan = crate::build_execution_plan(
        search_plan_id,
        template.graph.clone(),
        template.campaign.clone(),
        &registry,
    )?;
    request.validate_parameter_bindings(&plan)?;
    if result.profile != "host_optimizer_search_v1"
        || result.portable
        || result.request_fingerprint != stable_json_fingerprint(request)?
        || result.graph_fingerprint != plan.graph_fingerprint
        || result.controller_fingerprint != plan.controller_fingerprint
        || result.campaign_fingerprint != stable_json_fingerprint(&plan.campaign)?
        || result.fold_set_fingerprint
            != stable_json_fingerprint(plan.fold_set.as_ref().ok_or_else(|| {
                DagMlError::RuntimeValidation("structural winner lacks folds".into())
            })?)?
    {
        return Err(DagMlError::RuntimeValidation(
            "structural winner search/template identity mismatch".into(),
        ));
    }
    let candidates = result
        .trials
        .iter()
        .map(|trial| super::host_hpo::host_hpo_candidate(&plan, request, trial))
        .collect::<Result<Vec<_>>>()?;
    let selected = select_candidate(
        &SelectionPolicy {
            metric: SelectionMetric {
                name: request.metric.name().to_owned(),
                objective: request.direction,
            },
            id: "select:host_hpo".into(),
            required_metric_level: None,
            require_finite: true,
            evaluation_scope: None,
            refit_slot_plan: None,
            requested_rank: None,
            stacking_fit_contract: None,
            reduction_id: None,
        },
        &candidates,
    )?;
    let winner = result
        .trials
        .iter()
        .find(|trial| trial.trial_index == result.selected_trial_index)
        .ok_or_else(|| {
            DagMlError::RuntimeValidation(
                "structural winner is not an observed complete trial".into(),
            )
        })?;
    if selected.selected_candidate_id != winner.variant_id.as_str()
        || result.selected_params != winner.params
    {
        return Err(DagMlError::RuntimeValidation(
            "structural winner differs from native SELECT".into(),
        ));
    }
    let recipe = catalogue.recipe(&winner.params)?;
    let candidate = catalogue.candidate_plan(&plan, &winner.params)?;
    let keep = candidate
        .node_plans
        .keys()
        .cloned()
        .collect::<BTreeSet<_>>();
    if catalogue.topology_contract.is_some()
        && template
            .parameter_patches
            .iter()
            .any(|patch| !keep.contains(&patch.node_id))
    {
        return Err(DagMlError::RuntimeValidation(
            "topology HPO winner template patches an inactive node".into(),
        ));
    }
    let mut resolved = template.clone();
    resolved.graph = candidate.graph_plan.graph;
    for node in &mut resolved.graph.nodes {
        for (path, binding) in &recipe.parameter_bindings {
            if binding.node_id == node.id {
                node.params
                    .insert(binding.param_path.clone(), winner.params[path].clone());
            }
        }
    }
    resolved.campaign.generation = GenerationSpec {
        strategy: GenerationStrategy::Cartesian,
        dimensions: recipe
            .variant
            .choices
            .iter()
            .map(|(name, choice)| GenerationDimension {
                name: name.clone(),
                choices: vec![choice.clone()],
            })
            .collect(),
        max_variants: Some(1),
        constraints: Default::default(),
    };
    if resolved.graph.search_space_fingerprint.is_some() {
        resolved.graph.search_space_fingerprint = Some(crate::generation_spec_fingerprint(
            &resolved.campaign.generation,
        )?);
    }
    resolved
        .campaign
        .shape_plans
        .retain(|id, _| keep.contains(id));
    resolved
        .campaign
        .data_bindings
        .retain(|id, _| keep.contains(id));
    let keys = resolved
        .campaign
        .data_bindings
        .values()
        .flatten()
        .map(|binding| crate::data_binding_requirement_key(&binding.node_id, &binding.input_name))
        .collect::<BTreeSet<_>>();
    resolved
        .data_identities
        .retain(|identity| keys.contains(&identity.requirement_key));
    resolved
        .parameter_patches
        .retain(|patch| keep.contains(&patch.node_id));
    // A template must not change a selected constructor or topology after HPO.
    // Fit/control declarations retain their ordinary typed W1 contracts.
    if resolved.parameter_patches.iter().any(|patch| {
        matches!(
            patch.namespace,
            crate::ParameterNamespace::Operator | crate::ParameterNamespace::Structural
        )
    }) {
        return Err(DagMlError::RuntimeValidation(
            "structural winner forbids template operator/structural parameter patches".into(),
        ));
    }
    resolved
        .patch_policies
        .retain(|policy| keep.contains(&policy.node_id));
    resolved
        .influence_requirements
        .retain(|requirement| keep.contains(&requirement.node_id));
    resolved
        .training_losses
        .retain(|role| keep.contains(&role.node_id));
    for output in &mut resolved.options.outputs {
        if output.node_id == request.target_node {
            output.node_id = recipe.target_node.clone();
        }
        if !keep.contains(&output.node_id) {
            return Err(DagMlError::RuntimeValidation(
                "structural winner template output is outside selected recipe".into(),
            ));
        }
    }
    resolved.campaign.metadata.insert(
        "host_hpo_structural_selection".into(),
        serde_json::json!({
            "catalogue_fingerprint": catalogue.catalogue_fingerprint,
            "request_fingerprint": result.request_fingerprint,
            "selected_trial_index": winner.trial_index,
            "selected_trial_variant_id": winner.variant_id,
            "recipe_id": recipe.recipe_id, "variant_label": recipe.variant_label,
            "target_node": recipe.target_node, "selected_params": winner.params,
        }),
    );
    resolved.request_fingerprint = resolved.compute_fingerprint()?;
    resolved.validate()?;
    let projection = resolved.project()?;
    if projection.plan.variants != vec![recipe.variant.clone()] {
        return Err(DagMlError::RuntimeValidation(
            "structural winner lost its native VariantPlan".into(),
        ));
    }
    Ok(resolved)
}
