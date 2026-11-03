//! Additive multi-model topology declarations for compiler-owned host HPO.
use super::*;
use crate::dsl::{collect_operator_generator_steps, operator_generator_node_maps};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct HostHpoTopologyContract {
    pub parameter_bindings: BTreeMap<String, Vec<HostHpoParameterBinding>>,
    pub scored_nodes: Vec<NodeId>,
}

/// Prepare V2 recipes with explicit logical scored sinks and conditional bindings.
/// Logical IDs are resolved using the compiler's exact namespacing path. Every
/// active recipe has one terminal model and every active model reaches that sink.
pub fn prepare_host_hpo_topology_catalogue(
    dsl: &PipelineDslSpec,
    registry: &ControllerRegistry,
    parameter_bindings: BTreeMap<String, Vec<HostHpoParameterBinding>>,
    scored_nodes: Vec<NodeId>,
    selector_path: String,
) -> Result<HostHpoStructuralCatalogue> {
    let refuse = |message: &str| DagMlError::RuntimeValidation(message.into());
    if selector_path.trim().is_empty()
        || parameter_bindings.is_empty()
        || parameter_bindings.contains_key(&selector_path)
        || scored_nodes.is_empty()
        || parameter_bindings.iter().any(|(path, bindings)| {
            path.trim().is_empty()
                || bindings.is_empty()
                || bindings.iter().any(|b| b.param_path.trim().is_empty())
        })
        || scored_nodes.iter().collect::<BTreeSet<_>>().len() != scored_nodes.len()
    {
        return Err(refuse("topology HPO requires distinct selector, explicit scored nodes and nonempty node bindings"));
    }
    let mut destinations = BTreeSet::new();
    for bindings in parameter_bindings.values() {
        for binding in bindings {
            if !destinations.insert((binding.node_id.clone(), binding.param_path.clone())) {
                return Err(refuse("topology HPO declared parameter bindings collide"));
            }
        }
    }
    let source_dsl = resolve_pipeline_dsl_minimal_aliases(dsl, registry)?;
    let models = compile_operator_variant_models(&source_dsl)?;
    let [model] = models.as_slice() else {
        return Err(refuse(
            "topology HPO requires exactly one native operator generator",
        ));
    };
    let mut generators = Vec::new();
    collect_operator_generator_steps(&source_dsl.steps, &mut generators)?;
    let mappings = operator_generator_node_maps(&generators[0])?;
    let compiled =
        compile_pipeline_dsl_with_generation_and_controller_registry(&source_dsl, registry)?;
    let plan = crate::build_execution_plan(
        format!("plan:{}:host_hpo", source_dsl.id),
        compiled.graph,
        compiled.campaign_template,
        registry,
    )?;
    if plan.fold_set.is_none() || plan.variants.len() != 1 || !plan.variants[0].choices.is_empty() {
        return Err(refuse(
            "topology HPO requires explicit shared folds and no additional numeric generation",
        ));
    }
    let variants = enumerate_operator_variants(&models, plan.campaign.root_seed)?;
    if variants.is_empty() || variants.len() > 4096 {
        return Err(refuse(
            "topology HPO catalogue must contain between one and 4096 recipes",
        ));
    }
    let mut entries = Vec::with_capacity(variants.len());
    let mut covered_bindings = BTreeSet::new();
    let mut covered_sinks = BTreeSet::new();
    for variant in variants {
        let candidate = pruned_plan_for_operator_models(&plan, &models, &variant)?;
        let choice = operator_variant_active_subsequence(model, &variant)?;
        let mapping = mappings
            .get(choice)
            .ok_or_else(|| refuse("topology HPO lacks authoritative node mapping"))?;
        let active_id = |logical: &NodeId| {
            mapping
                .get(logical)
                .filter(|id| candidate.node_plans.contains_key(*id))
        };
        let sinks = scored_nodes
            .iter()
            .filter_map(|logical| active_id(logical).map(|id| (logical, id)))
            .collect::<Vec<_>>();
        if sinks.len() != 1 {
            return Err(refuse(
                "topology HPO recipes require exactly one active explicit scored sink",
            ));
        }
        let (logical_sink, sink) = sinks[0];
        let target = &candidate.node_plans[sink];
        if target.kind != NodeKind::Model
            || !target.supported_phases.contains(&Phase::FitCv)
            || candidate
                .graph_plan
                .graph
                .edges
                .iter()
                .any(|edge| edge.source.node_id == *sink)
        {
            return Err(refuse(
                "topology HPO scored sink must be a terminal FIT_CV model",
            ));
        }
        // Refuse an omitted competing sink or a disconnected active model.
        let mut closure = BTreeSet::from([sink.clone()]);
        loop {
            let before = closure.len();
            for edge in &candidate.graph_plan.graph.edges {
                if closure.contains(&edge.target.node_id) {
                    closure.insert(edge.source.node_id.clone());
                }
            }
            if closure.len() == before {
                break;
            }
        }
        if candidate.node_plans.values().any(|node| {
            node.kind == NodeKind::Model
                && node.supported_phases.contains(&Phase::FitCv)
                && !closure.contains(&node.node_id)
        }) {
            return Err(refuse(
                "topology HPO active models must all reach the explicit scored sink",
            ));
        }
        // Building the native nested campaign validates grouped inner CV,
        // complete OOF scope and REFIT policy before any callback can execute.
        let nested = super::super::stacking::nested_stacking_campaign_plans(&candidate)?;
        validate_pca_fit_scopes(&candidate, &nested)?;
        crate::methods_classification::validate_methods_classification_plan(&candidate)?;
        if closure.len() > 1
            && (nested.len() != 1
                || nested[0].meta_node_id != *sink
                || !matches!(
                    &nested[0].inner_cv,
                    crate::fold::NestedCvSpec::GroupKFold(_)
                )
                || nested[0].refit_fold_set.is_none())
        {
            return Err(refuse(
                "topology HPO late recipes require explicit grouped nested and REFIT OOF execution",
            ));
        }
        covered_sinks.insert(logical_sink.clone());
        let mut bindings = BTreeMap::new();
        for (path, declared) in &parameter_bindings {
            let active = declared
                .iter()
                .filter_map(|binding| active_id(&binding.node_id).map(|id| (binding, id)))
                .collect::<Vec<_>>();
            if active.len() > 1 {
                return Err(refuse(
                    "topology HPO public parameter has multiple active destinations",
                ));
            }
            if let Some(&(binding, id)) = active.first() {
                let node = &candidate.node_plans[id];
                if node.kind != NodeKind::Model
                    || !node.supported_phases.contains(&Phase::FitCv)
                    || node
                        .params
                        .get(&binding.param_path)
                        .and_then(serde_json::Value::as_f64)
                        .is_none_or(|v| !v.is_finite())
                {
                    return Err(refuse("topology HPO bindings require declared finite numeric FIT_CV model parameters"));
                }
                covered_bindings.insert((binding.node_id.clone(), binding.param_path.clone()));
                bindings.insert(
                    path.clone(),
                    HostHpoParameterBinding {
                        node_id: id.clone(),
                        param_path: binding.param_path.clone(),
                    },
                );
            }
        }
        let variant_label = stable_json_fingerprint(&(
            "host_hpo_topology_v2",
            &candidate.graph_plan.graph,
            &candidate.campaign,
            &bindings,
            &target.node_id,
        ))?;
        entries.push(HostHpoStructuralRecipe {
            recipe_id: variant.variant_id.clone(),
            variant,
            variant_label,
            target_node: target.node_id.clone(),
            graph_fingerprint: candidate.graph_fingerprint,
            controller_fingerprint: candidate.controller_fingerprint,
            graph: candidate.graph_plan.graph,
            parameter_bindings: bindings,
        });
    }
    if covered_bindings != destinations || covered_sinks != scored_nodes.iter().cloned().collect() {
        return Err(refuse(
            "topology HPO bindings and scored nodes must occur in the declared recipes",
        ));
    }
    let mut catalogue = HostHpoStructuralCatalogue {
        schema_version: 2,
        selector_path,
        source_dsl,
        parameter_paths: BTreeMap::new(),
        entries,
        catalogue_fingerprint: String::new(),
        topology_contract: Some(HostHpoTopologyContract {
            parameter_bindings,
            scored_nodes,
        }),
    };
    catalogue.catalogue_fingerprint = catalogue.compute_fingerprint()?;
    Ok(catalogue)
}

/// Encoder capacity is checked against the actual native scheduled folds,
/// including every outer-train's inner folds and independent REFIT OOF folds.
fn validate_pca_fit_scopes(
    plan: &ExecutionPlan,
    nested: &[super::super::stacking::NestedStackingCampaignPlan],
) -> Result<()> {
    let folds = plan.fold_set.as_ref().expect("validated explicit folds");
    if folds.sample_groups.is_empty() {
        return Err(DagMlError::RuntimeValidation(
            "topology HPO requires explicit cohort groups".into(),
        ));
    }
    for node in &plan.graph_plan.graph.nodes {
        let Some(operator) = node.operator.as_ref().filter(|op| {
            op["type"] == "N4mMultimodalPipeline" || op["type"] == crate::METHODS_RAW_CLASSIFIER
        }) else {
            continue;
        };
        let mut minimum = folds
            .folds
            .iter()
            .map(|fold| fold.train_sample_ids.len())
            .min()
            .unwrap_or(0);
        for campaign in nested
            .iter()
            .filter(|campaign| campaign.base_node_ids.contains(&node.id))
        {
            for scope in &campaign.outer_scopes {
                for fold in &scope.inner.inner_fold_set.folds {
                    minimum = minimum.min(fold.train_sample_ids.len());
                }
            }
            if let Some(refit) = &campaign.refit_fold_set {
                for fold in &refit.folds {
                    minimum = minimum.min(fold.train_sample_ids.len());
                }
            }
        }
        let encoders = operator["recipe"]["encoders"].as_object().ok_or_else(|| {
            DagMlError::RuntimeValidation(
                "topology HPO raw predictor lacks declared encoders".into(),
            )
        })?;
        for (source, encoder) in encoders {
            if encoder["kind"] != "tensor_pca" {
                continue;
            }
            let count = encoder["n_components"].as_u64().filter(|n| *n > 0);
            let width = operator["source_schemas"][source]["input_shape"]
                .as_array()
                .and_then(|shape| {
                    shape
                        .iter()
                        .try_fold(1_u64, |width, n| width.checked_mul(n.as_u64()?))
                });
            if count.is_none()
                || width.is_none()
                || count > width
                || count.is_some_and(|n| n > minimum as u64)
            {
                return Err(DagMlError::RuntimeValidation(format!(
                    "topology HPO node `{}` source `{source}` PCA components exceed raw width or native training scope", node.id,
                )));
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn fixture() -> (
        PipelineDslSpec,
        ControllerRegistry,
        BTreeMap<String, Vec<HostHpoParameterBinding>>,
        Vec<NodeId>,
    ) {
        let samples = (0..12).map(|n| format!("s{n}")).collect::<Vec<_>>();
        let groups = (0..12)
            .map(|n| (format!("s{n}"), format!("g{}", n / 2)))
            .collect::<BTreeMap<_, _>>();
        let folds = (0..3).map(|n| json!({
            "fold_id": format!("outer{n}"),
            "train_sample_ids": samples.iter().enumerate().filter(|(i, _)| i / 4 != n).map(|(_, s)| s).collect::<Vec<_>>(),
            "validation_sample_ids": samples.iter().enumerate().filter(|(i, _)| i / 4 == n).map(|(_, s)| s).collect::<Vec<_>>(),
        })).collect::<Vec<_>>();
        let raw = |id: &str| {
            json!({"kind":"model", "id":id,
            "operator":{"type":"N4mMultimodalPipeline", "recipe":{"encoders":{"image":{"kind":"tensor_pca", "n_components":2}}},
                        "source_schemas":{"image":{"input_shape":[8]}}},
            "params":{"alpha":1.0}})
        };
        let late = |index: usize, count: usize, reversed: bool| {
            let mut ids = (0..count)
                .map(|n| format!("a{index}:source:{n}"))
                .collect::<Vec<_>>();
            if reversed {
                ids.reverse();
            }
            json!({"id":format!("late{index}"), "steps":[
                {"kind":"branch", "branches":ids.iter().map(|id| json!({"id":id, "steps":[raw(id)]})).collect::<Vec<_>>()},
                {"kind":"merge_model", "id":format!("a{index}:meta"), "sources":ids,
                 "include_original_data":false, "operator":{"type":"N4mRolePipeline"}, "params":{"alpha":1.0},
                 "metadata":{"stacking_oof_execution":"nested_oof_v1", "stacking_refit_oof":"partitioned_inner_v1"},
                 "inner_cv":{"kind":"group_kfold", "n_splits":2}}
            ]})
        };
        let dsl = serde_json::from_value(json!({
            "id":"dsl:topology", "root_seed":17,
            "split_invocation":{"id":"split:shared", "fold_set":{"id":"folds:shared", "sample_ids":samples,
                "sample_groups":groups, "folds":folds}},
            "steps":[{"kind":"generator", "id":"generator:topology", "mode":"cartesian", "stages":[
                {"id":"topology", "branches":[{"id":"early", "steps":[raw("a0:early")]}, late(1, 2, false), late(2, 4, false)]}
            ]}]
        })).unwrap();
        let mut spec = crate::controller_adapter::HostControllerSpec::new(
            "controller:topology",
            "1.0.0",
            NodeKind::Model,
        );
        spec.added_capabilities
            .insert(crate::controller::ControllerCapability::ConsumesOofPredictions);
        let mut registry = ControllerRegistry::new();
        registry.register(spec.derive().unwrap()).unwrap();
        let bindings = BTreeMap::from([
            (
                "early.alpha".into(),
                vec![HostHpoParameterBinding {
                    node_id: NodeId::new("a0:early").unwrap(),
                    param_path: "alpha".into(),
                }],
            ),
            (
                "late.source.alpha".into(),
                vec![1, 2]
                    .into_iter()
                    .map(|n| HostHpoParameterBinding {
                        node_id: NodeId::new(format!("a{n}:source:0")).unwrap(),
                        param_path: "alpha".into(),
                    })
                    .collect(),
            ),
            (
                "late.meta.alpha".into(),
                vec![1, 2]
                    .into_iter()
                    .map(|n| HostHpoParameterBinding {
                        node_id: NodeId::new(format!("a{n}:meta")).unwrap(),
                        param_path: "alpha".into(),
                    })
                    .collect(),
            ),
        ]);
        (
            dsl,
            registry,
            bindings,
            ["a0:early", "a1:meta", "a2:meta"]
                .into_iter()
                .map(|id| NodeId::new(id).unwrap())
                .collect(),
        )
    }

    fn prepare(
        dsl: &PipelineDslSpec,
        registry: &ControllerRegistry,
        bindings: BTreeMap<String, Vec<HostHpoParameterBinding>>,
        sinks: Vec<NodeId>,
    ) -> Result<HostHpoStructuralCatalogue> {
        prepare_host_hpo_topology_catalogue(dsl, registry, bindings, sinks, "__recipe__".into())
    }

    fn plan(
        catalogue: &HostHpoStructuralCatalogue,
        registry: &ControllerRegistry,
    ) -> ExecutionPlan {
        let artifact = compile_pipeline_dsl_with_generation_and_controller_registry(
            &catalogue.source_dsl,
            registry,
        )
        .unwrap();
        crate::build_execution_plan(
            "plan:topology",
            artifact.graph,
            artifact.campaign_template,
            registry,
        )
        .unwrap()
    }

    fn request(catalogue: HostHpoStructuralCatalogue) -> HostHpoSearchRequest {
        serde_json::from_value(json!({"target_node":catalogue.entries[0].target_node,
            "trial_budget":3, "metric":"rmse", "direction":"minimize", "optimizer_descriptor":{},
            "structural_catalogue":catalogue}))
        .unwrap()
    }

    fn parallel_descriptor(workers: usize) -> BTreeMap<String, serde_json::Value> {
        serde_json::from_value(json!({
            "sampler":"random", "pruner":null, "n_jobs":workers,
            "parallel_execution": {
                "schema_version":1, "profile":"methods_sequential_cpu_v1",
                "workers":workers, "cpu_threads":1, "gpu_devices":[],
                "methods_build":{"schema_version":1, "blas":false, "openmp":false, "cuda":false}
            }
        }))
        .unwrap()
    }

    #[test]
    fn topology_parallel_profile_requires_exact_resource_and_build_admission() {
        let (dsl, registry, bindings, sinks) = fixture();
        let mut request = request(prepare(&dsl, &registry, bindings, sinks).unwrap());
        // Serial absence stays unchanged; every bounded parallel budget must
        // bind the same descriptor and one-thread/no-GPU candidate resources.
        assert!(request.validate_parallel_execution(1).unwrap().is_none());
        assert!(request.validate_parallel_execution(2).is_err());
        for workers in 2..=4 {
            request.optimizer_descriptor = parallel_descriptor(workers);
            let resources = request
                .validate_parallel_execution(workers)
                .unwrap()
                .unwrap();
            assert_eq!(resources.cpu_threads, 1);
            assert!(resources.gpu_devices.is_empty());
            assert!(resources.memory_bytes.is_none());
            assert!(request.validate_parallel_execution(1).is_err());
        }
        let valid = parallel_descriptor(2);
        for (path, value) in [
            ("/n_jobs", json!(-1)),
            ("/n_jobs", json!(3)),
            ("/sampler", json!("tpe")),
            ("/pruner", json!("median")),
            ("/parallel_execution/schema_version", json!(2)),
            ("/parallel_execution/profile", json!("accelerated")),
            ("/parallel_execution/workers", json!(3)),
            ("/parallel_execution/workers", json!(true)),
            ("/parallel_execution/cpu_threads", json!(2)),
            ("/parallel_execution/gpu_devices", json!(["0"])),
            ("/parallel_execution/methods_build/schema_version", json!(2)),
            ("/parallel_execution/methods_build/blas", json!(true)),
            ("/parallel_execution/methods_build/openmp", json!(true)),
            ("/parallel_execution/methods_build/cuda", json!(true)),
            ("/parallel_execution/methods_build/blas", json!(0)),
        ] {
            let mut document = serde_json::to_value(&valid).unwrap();
            *document.pointer_mut(path).unwrap() = value;
            request.optimizer_descriptor = serde_json::from_value(document).unwrap();
            assert!(
                request.validate_parallel_execution(2).is_err(),
                "accepted {path}"
            );
        }
        for object in ["/parallel_execution", "/parallel_execution/methods_build"] {
            let mut document = serde_json::to_value(&valid).unwrap();
            document
                .pointer_mut(object)
                .unwrap()
                .as_object_mut()
                .unwrap()
                .insert("unknown".into(), json!(false));
            request.optimizer_descriptor = serde_json::from_value(document).unwrap();
            assert!(request.validate_parallel_execution(2).is_err());
        }
        request.optimizer_descriptor = valid.clone();
        request.optimizer_descriptor.insert(
            "generated_view_mode".into(),
            json!("checkpoint_manifest_v1"),
        );
        assert!(request.validate_parallel_execution(2).is_err());
        request.optimizer_descriptor = valid;
        request.metric = RegressionMetricKind::Accuracy;
        assert!(request.validate_parallel_execution(2).is_err());
        request.metric = RegressionMetricKind::Rmse;
        request.progressive_pruning = true;
        assert!(request.validate_parallel_execution(2).is_err());
    }

    #[test]
    fn classifier_catalogue_refuses_parallel_rmse_even_with_a_regression_plan() {
        let (dsl, registry, bindings, sinks) = fixture();
        let catalogue = prepare(&dsl, &registry, bindings, sinks).unwrap();
        let effective = plan(&catalogue, &registry);
        for kind in [
            crate::METHODS_RAW_CLASSIFIER,
            crate::METHODS_META_CLASSIFIER,
        ] {
            let mut request = request(catalogue.clone());
            request.optimizer_descriptor = parallel_descriptor(2);
            let entry = &mut request.structural_catalogue.as_mut().unwrap().entries[0];
            let node = entry
                .graph
                .nodes
                .iter_mut()
                .find(|node| node.kind == crate::NodeKind::Model)
                .unwrap();
            node.operator = Some(json!({"type":kind}));
            // Refuse the classifier declaration before interpreting its forged
            // catalogue, rather than allowing the regression metric to admit it.
            assert!(request
                .validate_parallel_execution(2)
                .unwrap_err()
                .to_string()
                .contains("classification requires serial"));
            assert!(request
                .validate_parallel_execution_for_plan(2, &effective)
                .unwrap_err()
                .to_string()
                .contains("classification requires serial"));
        }
    }

    #[test]
    fn topology_parallel_admission_precedes_callbacks_and_browser_remains_refused() {
        use crate::{
            HostHpoCandidateControllerFactory, HostHpoCandidateProviderFactory, HostHpoProgress,
            HostHpoProposalSource, HostHpoResumeOptions, HostHpoSearchStatus,
            RuntimeControllerRegistry, RuntimeDataProvider, SequentialScheduler,
        };
        struct NoCandidates;
        impl HostHpoCandidateControllerFactory for NoCandidates {
            fn create(&self, _: u32) -> Result<RuntimeControllerRegistry> {
                panic!("no candidate controller should be created")
            }
        }
        impl HostHpoCandidateProviderFactory for NoCandidates {
            fn create(&self, _: u32) -> Result<Box<dyn RuntimeDataProvider + Send>> {
                panic!("no candidate provider should be created")
            }
        }
        struct Exhausted(usize);
        impl HostHpoProposalSource for Exhausted {
            fn ask(&mut self, _: u32) -> Result<Option<BTreeMap<String, serde_json::Value>>> {
                self.0 += 1;
                Ok(None)
            }
            fn tell(&mut self, _: u32, _: f64) -> Result<()> {
                panic!("no terminal feedback expected")
            }
        }
        struct Progress(usize);
        impl HostHpoProgress for Progress {
            fn checkpoint(
                &mut self,
                _: &crate::HostHpoCheckpoint,
                _: HostHpoSearchStatus,
            ) -> Result<bool> {
                self.0 += 1;
                Ok(true)
            }
        }
        let (dsl, registry, bindings, sinks) = fixture();
        let catalogue = prepare(&dsl, &registry, bindings, sinks).unwrap();
        let plan = plan(&catalogue, &registry);
        let mut request = request(catalogue);
        let options = HostHpoResumeOptions {
            data_fingerprint: "typed:parallel".into(),
            checkpoint: None,
        };
        let mut proposals = Exhausted(0);
        let mut progress = Progress(0);
        // An unsigned/missing resource profile never reaches even the initial
        // progress callback, optimizer ask or either candidate factory.
        assert!(SequentialScheduler
            .execute_resumable_parallel_host_hpo_search_with_candidate_factories(
                &plan,
                &NoCandidates,
                &NoCandidates,
                &request,
                &mut proposals,
                2,
                &options,
                &mut progress,
            )
            .is_err());
        assert_eq!((proposals.0, progress.0), (0, 0));
        request.optimizer_descriptor = parallel_descriptor(2);
        let result = SequentialScheduler
            .execute_resumable_parallel_host_hpo_search_with_candidate_factories(
                &plan,
                &NoCandidates,
                &NoCandidates,
                &request,
                &mut proposals,
                2,
                &options,
                &mut progress,
            )
            .unwrap();
        assert_eq!(result.status, HostHpoSearchStatus::Exhausted);
        assert_eq!(proposals.0, 1);
        let checkpoint = result.checkpoint.unwrap();
        assert!(checkpoint.trials.is_empty());
        let callbacks = (proposals.0, progress.0);
        request.optimizer_descriptor = parallel_descriptor(3);
        assert!(SequentialScheduler
            .execute_resumable_parallel_host_hpo_search_with_candidate_factories(
                &plan,
                &NoCandidates,
                &NoCandidates,
                &request,
                &mut proposals,
                3,
                &HostHpoResumeOptions {
                    checkpoint: Some(checkpoint),
                    data_fingerprint: options.data_fingerprint.clone()
                },
                &mut progress,
            )
            .is_err());
        assert_eq!((proposals.0, progress.0), callbacks);
        request.optimizer_descriptor = parallel_descriptor(2);
        let asked = proposals.0;
        assert!(crate::prepare_host_hpo_worker_window(
            &plan,
            &request,
            &options,
            &mut proposals,
            2,
        )
        .unwrap_err()
        .to_string()
        .contains("serial candidate execution"));
        assert_eq!(proposals.0, asked);
    }

    fn evidence(
        catalogue: &HostHpoStructuralCatalogue,
        trial_index: u32,
        recipe_index: usize,
        score: f64,
    ) -> super::super::super::host_hpo::HostHpoTrialEvidence {
        let recipe = &catalogue.entries[recipe_index];
        let mut params = recipe
            .parameter_bindings
            .keys()
            .map(|path| (path.clone(), json!(1.0)))
            .collect::<BTreeMap<_, _>>();
        params.insert(catalogue.selector_path.clone(), json!(recipe.recipe_id));
        serde_json::from_value(json!({
            "trial_index":trial_index, "params":params, "score":score,
            "variant_id":format!("host_hpo:trial:{trial_index:010}"),
            "scores":{"schema_version":2, "plan_id":"plan:topology",
                "reports":recipe.graph.nodes.iter().filter(|node| node.kind == NodeKind::Model).map(|node| json!({
                    "producer_node":node.id, "producer_port":"y_hat",
                    "variant_id":format!("host_hpo:trial:{trial_index:010}"),
                    "partition":"validation", "fold_id":"avg", "level":"sample",
                    "row_count":12, "target_width":1,
                    "metrics":{"rmse":if node.id == recipe.target_node {score} else {0.0}}
                })).collect::<Vec<_>>()}
        }))
        .unwrap()
    }

    #[cfg(dag_ml_workspace_contract_fixtures)]
    #[test]
    fn topology_branch_scores_survive_resume_and_winner_but_foreign_producers_do_not() {
        use super::super::super::host_hpo::{
            host_hpo_candidate, prepare_host_hpo_checkpoint, HostHpoResumeOptions,
            HostHpoSearchResult, HostHpoTerminalTrial,
        };
        let (dsl, mut registry, bindings, sinks) = fixture();
        // The profile fixture contains only model nodes. Add a real active
        // preprocessing ancestor to cover a forged non-prediction producer.
        let mut document = serde_json::to_value(dsl).unwrap();
        document["steps"][0]["stages"][0]["branches"][1]["steps"][0]["branches"][0]["steps"]
            .as_array_mut()
            .unwrap()
            .insert(
                0,
                json!({
                    "kind":"transform", "id":"a1:preprocess", "operator":{"type":"Identity"}
                }),
            );
        let dsl = serde_json::from_value(document).unwrap();
        let transform = crate::controller_adapter::HostControllerSpec::new(
            "controller:topology.transform",
            "1.0.0",
            NodeKind::Transform,
        );
        registry.register(transform.derive().unwrap()).unwrap();
        let catalogue = prepare(&dsl, &registry, bindings, sinks).unwrap();
        let plan = plan(&catalogue, &registry);
        let request = request(catalogue.clone());
        let mut template: TrainingRequest = serde_json::from_str(include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../examples/fixtures/training/training_request_refit.v1.json"
        )))
        .unwrap();
        template.graph = plan.graph_plan.graph.clone();
        template.campaign = plan.campaign.clone();
        template.controller_manifests = registry.manifests().cloned().collect();
        template.data_identities.clear();
        template.options.seed = 17;
        template.options.outputs[0].node_id = request.target_node.clone();

        // Validate every completed late trial, including when early fusion
        // wins. Branch metrics must never become the sink's objective.
        for (early_score, selected_trial_index) in [(0.5, 0), (2.0, 1)] {
            let trials = vec![
                evidence(&catalogue, 0, 0, early_score),
                evidence(&catalogue, 1, 1, 1.0),
            ];
            for trial in &trials {
                host_hpo_candidate(&plan, &request, trial).unwrap();
            }
            let options = HostHpoResumeOptions {
                data_fingerprint: "cohort:exact".into(),
                checkpoint: None,
            };
            let mut checkpoint = prepare_host_hpo_checkpoint(&plan, &request, &options).unwrap();
            checkpoint.trials = trials
                .iter()
                .cloned()
                .map(|evidence| HostHpoTerminalTrial::Complete { evidence })
                .collect();
            checkpoint.fingerprint = stable_json_fingerprint(&(
                checkpoint.schema_version,
                &checkpoint.binding,
                &checkpoint.trials,
            ))
            .unwrap();
            let mut options = HostHpoResumeOptions {
                checkpoint: Some(checkpoint),
                ..options
            };
            prepare_host_hpo_checkpoint(&plan, &request, &options).unwrap();
            let result = HostHpoSearchResult {
                profile: "host_optimizer_search_v1".into(),
                portable: false,
                request_fingerprint: stable_json_fingerprint(&request).unwrap(),
                graph_fingerprint: plan.graph_fingerprint.clone(),
                controller_fingerprint: plan.controller_fingerprint.clone(),
                campaign_fingerprint: stable_json_fingerprint(&plan.campaign).unwrap(),
                fold_set_fingerprint: stable_json_fingerprint(plan.fold_set.as_ref().unwrap())
                    .unwrap(),
                selected_params: trials[selected_trial_index as usize].params.clone(),
                selected_trial_index,
                trials,
                pruned_trials: vec![],
            };
            let winner = resolve_host_hpo_structural_winner(&request, &result, &template).unwrap();
            assert_eq!(
                winner.graph.nodes.len(),
                if selected_trial_index == 0 { 1 } else { 4 }
            );

            for producer in [
                NodeId::new("foreign:model").unwrap(),
                catalogue.entries[2].target_node.clone(),
                catalogue.entries[1]
                    .graph
                    .nodes
                    .iter()
                    .find(|node| node.kind == NodeKind::Transform)
                    .unwrap()
                    .id
                    .clone(),
            ] {
                let mut forged = result.clone();
                forged.trials[1].scores.reports[0].producer_node = producer;
                assert!(host_hpo_candidate(&plan, &request, &forged.trials[1])
                    .unwrap_err()
                    .to_string()
                    .contains("outside selected recipe"));
                assert!(resolve_host_hpo_structural_winner(&request, &forged, &template).is_err());
                let checkpoint = options.checkpoint.as_mut().unwrap();
                checkpoint.trials[1] = HostHpoTerminalTrial::Complete {
                    evidence: forged.trials[1].clone(),
                };
                checkpoint.fingerprint = stable_json_fingerprint(&(
                    checkpoint.schema_version,
                    &checkpoint.binding,
                    &checkpoint.trials,
                ))
                .unwrap();
                assert!(prepare_host_hpo_checkpoint(&plan, &request, &options)
                    .unwrap_err()
                    .to_string()
                    .contains("outside selected recipe"));
            }
            let mut missing_sink = result.trials[1].clone();
            missing_sink
                .scores
                .reports
                .retain(|report| report.producer_node != catalogue.entries[1].target_node);
            assert!(host_hpo_candidate(&plan, &request, &missing_sink)
                .unwrap_err()
                .to_string()
                .contains("exactly one native target OOF report"));
        }
    }

    #[test]
    fn topology_catalogue_resolves_early_two_four_branches_and_active_node_axes() {
        let (dsl, registry, bindings, sinks) = fixture();
        let catalogue = prepare(&dsl, &registry, bindings, sinks).unwrap();
        assert_eq!(catalogue.schema_version, 2);
        assert_eq!(
            catalogue
                .entries
                .iter()
                .map(|entry| entry.graph.nodes.len())
                .collect::<Vec<_>>(),
            vec![1, 3, 5]
        );
        assert_eq!(catalogue.entries[0].parameter_bindings.len(), 1);
        assert_eq!(catalogue.entries[1].parameter_bindings.len(), 2);
        let mut generators = Vec::new();
        collect_operator_generator_steps(&catalogue.source_dsl.steps, &mut generators).unwrap();
        let mappings = operator_generator_node_maps(&generators[0]).unwrap();
        let logical = NodeId::new("a1:source:0").unwrap();
        let expected = mappings
            .values()
            .filter_map(|mapping| mapping.get(&logical))
            .collect::<Vec<_>>();
        assert_eq!(expected.len(), 1);
        let actual = &catalogue.entries[1].parameter_bindings["late.source.alpha"].node_id;
        assert_eq!(actual, expected[0]);
        let producer = catalogue.entries[1]
            .graph
            .nodes
            .iter()
            .find(|node| &node.id == actual)
            .unwrap();
        assert_eq!(producer.kind, NodeKind::Model);
        assert_eq!(
            producer.operator.as_ref().unwrap()["type"],
            "N4mMultimodalPipeline"
        );
        catalogue
            .validate_for_plan(&plan(&catalogue, &registry))
            .unwrap();
        let request = request(catalogue.clone());
        let params = BTreeMap::from([
            ("__recipe__".into(), json!(catalogue.entries[1].recipe_id)),
            ("late.source.alpha".into(), json!(2.0)),
            ("late.meta.alpha".into(), json!(3.0)),
        ]);
        assert_eq!(request.parameter_overrides(&params).unwrap().len(), 2);
        let mut inactive = params.clone();
        inactive.insert("early.alpha".into(), json!(9.0));
        assert!(catalogue.recipe(&inactive).is_err());
        let mut missing = params.clone();
        missing.remove("late.meta.alpha");
        assert!(catalogue.recipe(&missing).is_err());
        let mut nonnumeric = params;
        nonnumeric.insert("late.meta.alpha".into(), json!("3"));
        assert!(catalogue.recipe(&nonnumeric).is_err());
    }

    #[test]
    fn topology_declared_bindings_and_sinks_refuse_ambiguity_or_unknown_nodes() {
        let (dsl, registry, bindings, sinks) = fixture();
        let mut colliding = bindings.clone();
        colliding.insert("other.alpha".into(), bindings["early.alpha"].clone());
        assert!(prepare(&dsl, &registry, colliding, sinks.clone()).is_err());
        let mut unknown = bindings.clone();
        unknown.get_mut("early.alpha").unwrap()[0].node_id = NodeId::new("missing").unwrap();
        assert!(prepare(&dsl, &registry, unknown, sinks.clone()).is_err());
        let mut ambiguous = bindings.clone();
        ambiguous
            .get_mut("late.source.alpha")
            .unwrap()
            .push(HostHpoParameterBinding {
                node_id: NodeId::new("a1:source:1").unwrap(),
                param_path: "alpha".into(),
            });
        assert!(prepare(&dsl, &registry, ambiguous, sinks.clone()).is_err());
        let mut wrong = sinks.clone();
        wrong[1] = NodeId::new("a1:source:0").unwrap();
        assert!(prepare(&dsl, &registry, bindings.clone(), wrong).is_err());
        assert!(prepare(&dsl, &registry, bindings, sinks[..2].to_vec()).is_err());
        let (dsl, registry, bindings, sinks) = fixture();
        let mut unknown_source = serde_json::to_value(dsl).unwrap();
        unknown_source["steps"][0]["stages"][0]["branches"][1]["steps"][1]["sources"][0] =
            json!("unknown:producer");
        assert!(prepare(
            &serde_json::from_value(unknown_source).unwrap(),
            &registry,
            bindings,
            sinks
        )
        .unwrap_err()
        .to_string()
        .contains("must precede it"));
    }

    #[test]
    fn topology_labels_sign_branch_order_and_resealed_derived_tampering_is_refused() {
        let (dsl, registry, bindings, sinks) = fixture();
        let catalogue = prepare(&dsl, &registry, bindings.clone(), sinks.clone()).unwrap();
        let mut document = serde_json::to_value(&dsl).unwrap();
        let branches =
            &mut document["steps"][0]["stages"][0]["branches"][1]["steps"][0]["branches"];
        branches.as_array_mut().unwrap().reverse();
        document["steps"][0]["stages"][0]["branches"][1]["steps"][1]["sources"]
            .as_array_mut()
            .unwrap()
            .reverse();
        let reordered: PipelineDslSpec = serde_json::from_value(document).unwrap();
        let changed = prepare(&reordered, &registry, bindings, sinks).unwrap();
        assert_ne!(
            catalogue.entries[1].variant_label,
            changed.entries[1].variant_label
        );
        let plan = plan(&catalogue, &registry);
        let mut tampered = catalogue.clone();
        tampered.entries[1].variant_label = "0".repeat(64);
        tampered.catalogue_fingerprint = tampered.compute_fingerprint().unwrap();
        assert!(tampered.validate_for_plan(&plan).is_err());
        let mut tampered = catalogue;
        tampered.entries[1]
            .parameter_bindings
            .get_mut("late.meta.alpha")
            .unwrap()
            .param_path = "absent".into();
        tampered.catalogue_fingerprint = tampered.compute_fingerprint().unwrap();
        assert!(tampered.validate_for_plan(&plan).is_err());
    }

    #[test]
    fn topology_pca_capacity_uses_native_inner_train_and_pruning_refuses_upfront() {
        let (dsl, registry, bindings, sinks) = fixture();
        let catalogue = prepare(&dsl, &registry, bindings.clone(), sinks.clone()).unwrap();
        let mut document = serde_json::to_value(&dsl).unwrap();
        document["steps"][0]["stages"][0]["branches"][1]["steps"][0]["branches"][0]["steps"][0]
            ["operator"]["recipe"]["encoders"]["image"]["n_components"] = json!(5);
        let oversized: PipelineDslSpec = serde_json::from_value(document).unwrap();
        assert!(prepare(&oversized, &registry, bindings, sinks)
            .unwrap_err()
            .to_string()
            .contains("native training scope"));
        let plan = plan(&catalogue, &registry);
        let mut request = request(catalogue);
        request.progressive_pruning = true;
        assert!(request
            .validate_parameter_bindings(&plan)
            .unwrap_err()
            .to_string()
            .contains("progressive pruning"));
    }

    #[test]
    fn catalogue_v1_wire_and_fingerprint_preimage_are_unchanged() {
        let (dsl, registry, _, _) = fixture();
        let mut document = serde_json::to_value(&dsl).unwrap();
        document["steps"][0]["stages"][0]["branches"]
            .as_array_mut()
            .unwrap()
            .truncate(1);
        let early: PipelineDslSpec = serde_json::from_value(document).unwrap();
        let catalogue = prepare_host_hpo_structural_catalogue(
            &early,
            &registry,
            BTreeMap::from([("model.alpha".into(), "alpha".into())]),
            "__recipe__".into(),
        )
        .unwrap();
        assert_eq!(catalogue.schema_version, 1);
        assert!(!serde_json::to_value(&catalogue)
            .unwrap()
            .as_object()
            .unwrap()
            .contains_key("topology_contract"));
        assert_eq!(
            catalogue.catalogue_fingerprint,
            stable_json_fingerprint(&(
                catalogue.schema_version,
                &catalogue.selector_path,
                &catalogue.source_dsl,
                &catalogue.parameter_paths,
                &catalogue.entries,
            ))
            .unwrap()
        );
        let plan = plan(&catalogue, &registry);
        let request = request(catalogue.clone());
        let mut trial = evidence(&catalogue, 0, 0, 1.0);
        super::super::super::host_hpo::host_hpo_candidate(&plan, &request, &trial).unwrap();
        let mut foreign = trial.scores.reports[0].clone();
        foreign.producer_node = NodeId::new("foreign:model").unwrap();
        trial.scores.reports.push(foreign);
        assert!(
            super::super::super::host_hpo::host_hpo_candidate(&plan, &request, &trial)
                .unwrap_err()
                .to_string()
                .contains("outside selected recipe")
        );
    }
}
