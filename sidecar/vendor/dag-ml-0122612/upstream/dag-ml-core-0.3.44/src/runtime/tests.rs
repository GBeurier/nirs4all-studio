use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc, Mutex,
    },
};

use super::*;
use crate::aggregation::{aggregate_observation_predictions, ObservationPredictionBlock};
use crate::bundle::{
    build_aggregated_prediction_cache_payload, build_aggregated_prediction_cache_record,
    build_execution_bundle, build_execution_bundle_with_prediction_contracts,
    build_prediction_cache_payload, build_prediction_cache_record, BundlePredictionCachePayloadSet,
    BundlePredictionRequirement, RefitArtifactRecord, ReplayPhaseRequest,
    PREDICTION_CACHE_PAYLOAD_SCHEMA_VERSION,
};
use crate::controller::{
    ArtifactPolicy, ControllerCapability, ControllerFitScope, ControllerManifest,
    ControllerRegistry, RngPolicy,
};
#[cfg(dag_ml_workspace_contract_fixtures)]
use crate::criteria::{ImplementationCapability, TrainingLossRoleReference};
use crate::data::{
    DataViewPolicy, ExternalDataPlanEnvelope, InMemoryDataProvider, PredictCohort,
    PredictCohortRole, SOURCE_INDEX_METADATA_KEY,
};
use crate::fold::{FoldAssignment, FoldPartitionMode, FoldSet, FoldTrainExclusion};
use crate::generation::{
    GenerationChoice, GenerationConstraints, GenerationDimension, GenerationSpec,
    GenerationStrategy,
};
use crate::graph::{
    EdgeContract, EdgeSpec, GraphInterface, GraphSpec, NodeKind, NodeSpec, PortCardinality,
    PortKind, PortRef, PortSchema, PortSpec,
};
use crate::ids::{
    ArtifactId, ControllerId, FoldId, GroupId, NodeId, ObservationId, SampleId, TargetId,
};
#[cfg(dag_ml_workspace_contract_fixtures)]
use crate::implementation_registry::LocalImplementationRegistry;
use crate::oof::{PredictionBlock, PredictionPartition, STACKING_OOF_REFIT_CONTRACT_METADATA_KEY};
use crate::plan::{build_execution_plan, CampaignSpec, SplitInvocation};
use crate::policy::{
    AggregationControllerSpec, AggregationMethod, AggregationPolicy, DataModelShapePlan,
    FitBoundary, FitInfluencePolicy, Granularity, LeakageUnitPolicy, ShapeDelta, ShapeDeltaKind,
    SplitUnit,
};
use crate::relation::{SampleRelation, SampleRelationSet};
use serde_json::json;

#[path = "tests/structural_source_subsets/tests.rs"]
mod structural_source_subsets;

#[cfg(dag_ml_workspace_contract_fixtures)]
mod named_dense_inputs {
    use std::cell::{Cell, RefCell};

    use super::*;
    use crate::campaign::stable_json_fingerprint;
    use crate::controller_adapter::HostControllerSpec;

    // These matrices belong to the fixture host. Production coordination never
    // materializes or interprets their numeric values.
    struct NamedMatrixProvider {
        owner: ControllerId,
        sources: BTreeMap<String, (Vec<SampleId>, Vec<Vec<f64>>)>,
        matrices: RefCell<BTreeMap<u64, Vec<Vec<f64>>>>,
        relations: SampleRelationSet,
        cohort: PredictCohort,
        next_handle: Cell<u64>,
        forbid_training_relations: Cell<bool>,
        advertise_receipts: Cell<bool>,
        reverse_receipt: bool,
    }

    impl NamedMatrixProvider {
        fn new(reverse_receipt: bool) -> Self {
            let relations = sample_relations(&["s1", "s2"]);
            let cohort = PredictCohort::from_relations(
                PredictCohortRole::Inference,
                sample_relations(&["heldout2", "heldout1"]),
                vec!["y".into()],
                "d".repeat(64),
                None,
            )
            .unwrap();
            Self {
                owner: ControllerId::new("controller:host.named-data").unwrap(),
                sources: BTreeMap::from([
                    (
                        "src0".into(),
                        (
                            ids(&["heldout2", "s2", "heldout1", "s1"]),
                            vec![
                                vec![21., 22., 23., 24.],
                                vec![11., 12., 13., 14.],
                                vec![31., 32., 33., 34.],
                                vec![1., 2., 3., 4.],
                            ],
                        ),
                    ),
                    (
                        "src1".into(),
                        (
                            ids(&["s1", "heldout1", "s2", "heldout2"]),
                            vec![
                                vec![100., 101., 102.],
                                vec![300., 301., 302.],
                                vec![200., 201., 202.],
                                vec![400., 401., 402.],
                            ],
                        ),
                    ),
                ]),
                matrices: RefCell::new(BTreeMap::new()),
                relations,
                cohort,
                next_handle: Cell::new(100),
                forbid_training_relations: Cell::new(false),
                advertise_receipts: Cell::new(true),
                reverse_receipt,
            }
        }
    }

    fn ids(values: &[&str]) -> Vec<SampleId> {
        values
            .iter()
            .map(|value| SampleId::new(*value).unwrap())
            .collect()
    }

    fn sample_relations(values: &[&str]) -> SampleRelationSet {
        SampleRelationSet {
            records: values
                .iter()
                .map(|value| {
                    SampleRelation::new(
                        ObservationId::new(format!("obs:{value}")).unwrap(),
                        SampleId::new(*value).unwrap(),
                    )
                })
                .collect(),
        }
    }

    impl RuntimeDataProvider for NamedMatrixProvider {
        fn generated_views_enabled(&self) -> bool {
            self.advertise_receipts.get()
        }

        fn materialize(&self, request: &DataMaterializationRequest) -> Result<HandleRef> {
            assert_eq!(request.binding.output_representation, "tabular_numeric");
            assert_eq!(request.binding.source_ids.len(), 1);
            assert!(self.sources.contains_key(&request.binding.source_ids[0]));
            Ok(HandleRef {
                handle: if request.binding.source_ids[0] == "src0" {
                    10
                } else {
                    20
                },
                kind: HandleKind::Data,
                owner_controller: self.owner.clone(),
            })
        }

        fn make_view(&self, request: &DataViewRequest) -> Result<HandleRef> {
            let source = &request.binding.source_ids[0];
            assert_eq!(
                request.view.source_ids.as_ref(),
                Some(&request.binding.source_ids)
            );
            let (available_ids, values) = &self.sources[source];
            let wanted = request
                .view
                .sample_ids
                .as_ref()
                .expect("native ordered scope IDs");
            let selected = wanted
                .iter()
                .map(|sample| {
                    let position = available_ids
                        .iter()
                        .position(|available| available == sample)
                        .unwrap();
                    values[position].clone()
                })
                .collect();
            let handle = self.next_handle.get();
            self.next_handle.set(handle + 1);
            self.matrices.borrow_mut().insert(handle, selected);
            Ok(HandleRef {
                handle,
                kind: HandleKind::DataView,
                owner_controller: self.owner.clone(),
            })
        }

        fn make_view_attested(&self, request: &DataViewRequest) -> Result<AttestedDataView> {
            let handle = self.make_view(request)?;
            let mut sample_ids = request.view.sample_ids.clone().unwrap();
            if self.reverse_receipt && request.binding.source_ids[0] == "src1" {
                sample_ids.reverse();
            }
            let content = stable_json_fingerprint(&self.matrices.borrow()[&handle.handle])?;
            Ok(AttestedDataView {
                receipt: Some(DataViewReceipt {
                    handle: handle.clone(),
                    view_key: request.view_key.clone(),
                    sample_ids,
                    schema_fingerprint: request.binding.schema_fingerprint.clone(),
                    content_fingerprint: content,
                }),
                handle,
            })
        }

        fn coordinator_relations(
            &self,
            _binding: &DataBinding,
        ) -> Result<Option<SampleRelationSet>> {
            if self.forbid_training_relations.get() {
                return Err(DagMlError::RuntimeValidation(
                    "PREDICT cannot read training relations".into(),
                ));
            }
            Ok(Some(self.relations.clone()))
        }

        fn predict_cohort(
            &self,
            _binding: &DataBinding,
            phase: Phase,
        ) -> Result<Option<PredictCohort>> {
            assert_eq!(phase, Phase::Predict);
            Ok(Some(self.cohort.clone()))
        }
    }

    fn plan(provider: &NamedMatrixProvider) -> ExecutionPlan {
        let mut contract: serde_json::Value = serde_json::from_str(include_str!(
            "../../../../examples/fixtures/data/model_input_spec_named_dense.json"
        ))
        .unwrap();
        // This fixture host stores both sources in actual float64 matrices.
        contract["ports"][1]["metadata"]["dtype"] = json!("float64");
        let dsl: crate::dsl::PipelineDslSpec = serde_json::from_value(json!({
            "id":"named-runtime", "root_seed":19,
            "split_invocation":{"id":"split:named","fold_set":two_fold_set()},
            "steps":[{"kind":"model","id":"model:named","operator":{"type":"UserModule"},"model_input":contract}]
        })).unwrap();
        let mut compiled = crate::dsl::compile_pipeline_dsl_with_generation(&dsl).unwrap();
        let node = &compiled.graph.nodes[0];
        let mut controller =
            HostControllerSpec::new("controller:host.named-model", "1", NodeKind::Model);
        controller.input_ports = Some(node.ports.inputs.clone());
        controller.output_ports = Some(node.ports.outputs.clone());
        controller.data_requirements =
            Some(node.metadata[crate::dsl::DSL_MODEL_INPUT_METADATA_KEY].clone());
        let mut registry = ControllerRegistry::new();
        registry.register(controller.derive().unwrap()).unwrap();
        compiled.campaign_template.data_bindings.insert(
            node.id.clone(),
            [("nir", "src0"), ("clinical", "src1")]
                .into_iter()
                .map(|(name, source)| {
                    let mut binding = data_binding(&node.id);
                    binding.input_name = name.into();
                    binding.feature_set_id = Some(format!("features:{source}"));
                    binding.source_ids = vec![source.into()];
                    binding.relation_fingerprint = Some(provider.relations.fingerprint().unwrap());
                    binding
                })
                .collect(),
        );
        build_execution_plan(
            "plan:named-runtime",
            compiled.graph,
            compiled.campaign_template,
            &registry,
        )
        .unwrap()
    }

    fn collect(
        plan: &ExecutionPlan,
        provider: &NamedMatrixProvider,
        phase: Phase,
    ) -> Result<CollectedInputs> {
        let resources = PhaseScopeResources {
            data_provider: Some(provider),
            ..Default::default()
        };
        let context = RunContext::new(RunId::new("run:named-runtime").unwrap(), Some(19));
        let node = &plan.node_plans[&NodeId::new("model:named").unwrap()];
        collect_input_handles(
            plan,
            node,
            &BTreeMap::new(),
            &BTreeMap::new(),
            &resources,
            &context,
            &PhaseScope {
                phase,
                variant_id: Some(VariantId::new("variant:base").unwrap()),
                variant: None,
                fold_id: (phase == Phase::FitCv).then(|| FoldId::new("fold:0").unwrap()),
                seed_root: Some(19),
            },
        )
    }

    #[test]
    fn named_cv_and_refit_views_align_real_host_matrices_without_cross_source_concat() {
        let provider = NamedMatrixProvider::new(false);
        let plan = plan(&provider);
        let cv = collect(&plan, &provider, Phase::FitCv).unwrap();
        assert_eq!(cv.data_views.len(), 4);
        assert_eq!(cv.data_view_receipts.len(), 4);
        for name in ["nir", "clinical"] {
            assert_eq!(
                cv.data_views[&format!("data:{name}")].sample_ids,
                Some(ids(&["s2"]))
            );
            assert_eq!(
                cv.data_views[&format!("data:{name}:validation")].sample_ids,
                Some(ids(&["s1"]))
            );
        }
        let matrices = provider.matrices.borrow();
        assert_eq!(
            matrices[&cv.handles["data:nir"].handle][0],
            [11., 12., 13., 14.]
        );
        assert_eq!(
            matrices[&cv.handles["data:clinical"].handle][0],
            [200., 201., 202.]
        );
        drop(matrices);
        let refit = collect(&plan, &provider, Phase::Refit).unwrap();
        assert_eq!(refit.data_view_receipts.len(), 2);
        for view in refit.data_views.values() {
            assert_eq!(view.partition, DataRequestPartition::FullTrain);
            assert_eq!(view.sample_ids, Some(ids(&["s1", "s2"])));
        }
        assert!(refit.data_views.keys().all(|key| key != "data:x"));
    }

    #[test]
    fn named_fit_receipts_require_provider_opt_in() {
        let provider = NamedMatrixProvider::new(false);
        let plan = plan(&provider);
        provider.advertise_receipts.set(false);
        for phase in [Phase::FitCv, Phase::Refit] {
            let error = collect(&plan, &provider, phase)
                .err()
                .expect("a receipt-producing provider must advertise scoped views");
            assert!(
                error
                    .to_string()
                    .contains("generated-view capability and receipt disagree"),
                "unexpected {error}"
            );
        }
    }

    #[test]
    fn named_predict_views_keep_distinct_attestations_and_refuse_reordered_receipt() {
        let provider = NamedMatrixProvider::new(false);
        let plan = plan(&provider);
        provider.forbid_training_relations.set(true);
        let predicted = collect(&plan, &provider, Phase::Predict).unwrap();
        assert_eq!(predicted.data_views.len(), 2);
        assert_eq!(predicted.data_view_receipts.len(), 2);
        let matrices = provider.matrices.borrow();
        let nir = &matrices[&predicted.handles["data:nir"].handle];
        let clinical = &matrices[&predicted.handles["data:clinical"].handle];
        let host_prediction: Vec<_> = nir
            .iter()
            .zip(clinical)
            .map(|(left, right)| left[0] + right[0])
            .collect();
        assert_eq!(host_prediction, [331., 421.]);
        assert_eq!(
            predicted.data_view_receipts["data:nir"].sample_ids,
            ids(&["heldout1", "heldout2"])
        );
        assert_ne!(
            predicted.handles["data:nir"],
            predicted.handles["data:clinical"]
        );
        assert_ne!(
            predicted.data_view_receipts["data:nir"].content_fingerprint,
            predicted.data_view_receipts["data:clinical"].content_fingerprint
        );
        assert_ne!(
            predicted.data_view_receipts["data:nir"].view_key,
            predicted.data_view_receipts["data:clinical"].view_key
        );
        assert!(provider.cohort.target_content_fingerprint.is_none());
        drop(matrices);
        let corrupt = NamedMatrixProvider::new(true);
        corrupt.forbid_training_relations.set(true);
        let error = collect(&plan, &corrupt, Phase::Predict)
            .err()
            .expect("reordered source receipt must fail");
        assert!(
            error.to_string().contains("ordered sample IDs"),
            "unexpected {error}"
        );
    }
}

fn structural_host_fixture() -> (ExecutionPlan, HostHpoSearchRequest) {
    let dsl: crate::PipelineDslSpec = serde_json::from_value(json!({
        "id": "dsl:structural.hpo", "root_seed": 17,
        "split_invocation": {"id": "split:shared", "fold_set": two_fold_set()},
        "steps": [{"kind": "generator", "id": "generator:preproc", "mode": "cartesian", "stages": [
            {"id": "stage0", "branches": [
                {"id": "raw", "steps": []},
                {"id": "scaled", "steps": [{"kind": "transform", "id": "scale", "operator": {"class": "sklearn.preprocessing.StandardScaler"}}]}
            ]},
            {"id": "stage1", "branches": [
                {"id": "ridge", "steps": [{"kind": "model", "id": "ridge", "operator": {"class": "sklearn.linear_model.Ridge"}, "params": {"alpha": 1.0}}]},
                {"id": "pls", "steps": [{"kind": "model", "id": "pls", "operator": {"class": "sklearn.cross_decomposition.PLSRegression"}, "params": {"n_components": 2, "scale": false}}]}
            ]}
        ]}]
    })).unwrap();
    let registry = manifests();
    let catalogue = prepare_host_hpo_structural_catalogue(
        &dsl,
        &registry,
        BTreeMap::from([
            ("model.alpha".into(), "alpha".into()),
            ("model.n_components".into(), "n_components".into()),
        ]),
        "__recipe__".into(),
    )
    .unwrap();
    let compiled = crate::compile_pipeline_dsl_with_generation_and_controller_registry(
        &catalogue.source_dsl,
        &registry,
    )
    .unwrap();
    let plan = build_execution_plan(
        "plan:dsl:structural.hpo:host_hpo",
        compiled.graph,
        compiled.campaign_template,
        &registry,
    )
    .unwrap();
    let request = HostHpoSearchRequest {
        target_node: catalogue.entries[0].target_node.clone(),
        trial_budget: 4,
        metric: RegressionMetricKind::Rmse,
        direction: crate::selection::MetricObjective::Minimize,
        optimizer_descriptor: BTreeMap::from([("owner".into(), json!("structural.fixture"))]),
        phase_trial_budgets: Vec::new(),
        progressive_pruning: false,
        fold_score_reduction: Some(HostHpoFoldReduction::Mean),
        parameter_bindings: BTreeMap::new(),
        structural_catalogue: Some(catalogue),
    };
    (plan, request)
}

struct StructuralHostProposals {
    params: Vec<BTreeMap<String, serde_json::Value>>,
    asked: Vec<u32>,
    told: Vec<(u32, f64)>,
}

impl StructuralHostProposals {
    fn from_request(request: &HostHpoSearchRequest) -> Self {
        let catalogue = request.structural_catalogue.as_ref().unwrap();
        let params = catalogue
            .entries
            .iter()
            .enumerate()
            .map(|(index, entry)| {
                let mut params =
                    BTreeMap::from([(catalogue.selector_path.clone(), json!(entry.recipe_id))]);
                for path in entry.parameter_bindings.keys() {
                    params.insert(path.clone(), json!(index as f64 + 1.0));
                }
                params
            })
            .collect();
        Self {
            params,
            asked: Vec::new(),
            told: Vec::new(),
        }
    }
}

impl HostHpoProposalSource for StructuralHostProposals {
    fn ask(&mut self, index: u32) -> Result<Option<BTreeMap<String, serde_json::Value>>> {
        self.asked.push(index);
        Ok(self.params.get(index as usize).cloned())
    }
    fn tell(&mut self, index: u32, score: f64) -> Result<()> {
        self.told.push((index, score));
        Ok(())
    }
}

struct StructuralScoreController {
    inner: VariantScoringController,
    calls: Arc<Mutex<Vec<(NodeId, VariantId)>>>,
}

impl RuntimeController for StructuralScoreController {
    fn controller_id(&self) -> &ControllerId {
        self.inner.controller_id()
    }
    fn invoke(&self, task: &NodeTask) -> Result<NodeResult> {
        self.calls.lock().unwrap().push((
            task.node_plan.node_id.clone(),
            task.variant_id.clone().unwrap(),
        ));
        let mut result = self.inner.invoke(task)?;
        if let Some(alpha) = task
            .node_plan
            .params
            .get("alpha")
            .and_then(serde_json::Value::as_f64)
        {
            for block in &mut result.predictions {
                for row in &mut block.values {
                    row[0] += alpha;
                }
            }
        }
        let prediction_handle = result.outputs.remove("pred").unwrap();
        result.outputs.insert("oof".into(), prediction_handle);
        Ok(result)
    }
}

fn structural_score_controllers(
    calls: Arc<Mutex<Vec<(NodeId, VariantId)>>>,
) -> RuntimeControllerRegistry {
    let mut registry = RuntimeControllerRegistry::new();
    registry
        .register(Box::new(MockController {
            id: ControllerId::new("controller:transform").unwrap(),
            handle: 1,
            emit_prediction: false,
        }))
        .unwrap();
    registry
        .register(Box::new(StructuralScoreController {
            inner: VariantScoringController {
                id: ControllerId::new("controller:model").unwrap(),
                handle: 2,
                emit_targets: true,
            },
            calls,
        }))
        .unwrap();
    registry
}

fn reseal_structural_catalogue(catalogue: &mut HostHpoStructuralCatalogue) {
    catalogue.catalogue_fingerprint = stable_json_fingerprint(&(
        catalogue.schema_version,
        &catalogue.selector_path,
        &catalogue.source_dsl,
        &catalogue.parameter_paths,
        &catalogue.entries,
    ))
    .unwrap();
}

#[test]
fn structural_host_catalogue_reuses_native_cartesian_ids_labels_and_pruned_graphs() {
    let (plan, request) = structural_host_fixture();
    let catalogue = request.structural_catalogue.as_ref().unwrap();
    catalogue.validate_for_plan(&plan).unwrap();
    let models = crate::compile_operator_variant_models(&catalogue.source_dsl).unwrap();
    let variants = enumerate_operator_variants(&models, plan.campaign.root_seed).unwrap();
    assert_eq!(variants.len(), 4);
    for (index, (entry, variant)) in catalogue.entries.iter().zip(variants).enumerate() {
        assert_eq!(entry.variant, variant);
        assert_eq!(entry.recipe_id, entry.variant.variant_id);
        let pruned = pruned_plan_for_operator_models(&plan, &models, &entry.variant).unwrap();
        assert_eq!(entry.graph, pruned.graph_plan.graph);
        assert_eq!(entry.graph_fingerprint, pruned.graph_fingerprint);
        assert_eq!(
            entry
                .graph
                .nodes
                .iter()
                .filter(|node| node.kind == NodeKind::Model)
                .count(),
            1
        );
        assert_eq!(
            entry
                .graph
                .nodes
                .iter()
                .filter(|node| node.kind == NodeKind::Transform)
                .count(),
            usize::from(index >= 2)
        );
        let key = if index % 2 == 0 {
            "model.alpha"
        } else {
            "model.n_components"
        };
        assert_eq!(
            entry
                .parameter_bindings
                .keys()
                .map(String::as_str)
                .collect::<Vec<_>>(),
            [key]
        );
    }
}

#[test]
fn structural_host_rejects_resealed_catalogue_order_nodes_labels_and_binding_changes() {
    let (plan, request) = structural_host_fixture();
    for mutation in 0..5 {
        let mut catalogue = request.structural_catalogue.clone().unwrap();
        match mutation {
            0 => catalogue.entries.swap(0, 1),
            1 => catalogue.entries[0].target_node = catalogue.entries[1].target_node.clone(),
            2 => catalogue.entries[0].variant_label = "f".repeat(64),
            3 => {
                catalogue.entries[0]
                    .parameter_bindings
                    .get_mut("model.alpha")
                    .unwrap()
                    .param_path = "n_components".into()
            }
            _ => catalogue.entries[0].graph.nodes.clear(),
        }
        reseal_structural_catalogue(&mut catalogue);
        assert!(catalogue
            .validate_for_plan(&plan)
            .unwrap_err()
            .to_string()
            .contains("binding mismatch"));
    }
}

#[test]
fn structural_host_invalid_proposals_refuse_before_operator_callback() {
    let (plan, request) = structural_host_fixture();
    for mutation in 0..3 {
        let mut proposals = StructuralHostProposals::from_request(&request);
        match mutation {
            0 => {
                proposals.params[0].insert("__recipe__".into(), json!("variant:unknown"));
            }
            1 => {
                proposals.params[0].insert("model.n_components".into(), json!(2));
            }
            _ => {
                proposals.params[0].remove("model.alpha");
            }
        }
        let calls = Arc::new(Mutex::new(Vec::new()));
        let controllers = structural_score_controllers(calls.clone());
        let provider = InMemoryDataProvider::new(ControllerId::new("controller:data").unwrap());
        assert!(SequentialScheduler
            .execute_host_hpo_search(&plan, &controllers, &provider, &request, &mut proposals)
            .is_err());
        assert!(calls.lock().unwrap().is_empty());
        assert!(proposals.told.is_empty());
    }
}

#[test]
fn structural_host_cv_scores_each_selected_target_and_resume_keeps_history() {
    let (plan, request) = structural_host_fixture();
    let calls = Arc::new(Mutex::new(Vec::new()));
    let controllers = structural_score_controllers(calls.clone());
    let provider = InMemoryDataProvider::new(ControllerId::new("controller:data").unwrap());
    let options = HostHpoResumeOptions {
        data_fingerprint: "data:structural".into(),
        checkpoint: None,
    };
    let mut proposals = StructuralHostProposals::from_request(&request);
    let mut progress = DurableHostProgress {
        stop_after: 2,
        checkpoints: Vec::new(),
    };
    let first = SequentialScheduler
        .execute_resumable_host_hpo_search(
            &plan,
            &controllers,
            &provider,
            &request,
            &mut proposals,
            &options,
            &mut progress,
        )
        .unwrap();
    assert_eq!(first.status, HostHpoSearchStatus::Cancelled);
    assert_eq!(calls.lock().unwrap().len(), 4);
    let checkpoint = first.checkpoint.unwrap();
    assert_eq!(
        checkpoint.binding.structural_catalogue_fingerprint.as_ref(),
        Some(
            &request
                .structural_catalogue
                .as_ref()
                .unwrap()
                .catalogue_fingerprint
        )
    );
    let original = serde_json::to_value(&checkpoint.trials).unwrap();
    progress.stop_after = usize::MAX;
    let mut resumed = StructuralHostProposals::from_request(&request);
    let result = SequentialScheduler
        .execute_resumable_host_hpo_search(
            &plan,
            &controllers,
            &provider,
            &request,
            &mut resumed,
            &HostHpoResumeOptions {
                checkpoint: Some(checkpoint),
                ..options
            },
            &mut progress,
        )
        .unwrap();
    assert_eq!(resumed.asked, [2, 3]);
    assert_eq!(
        serde_json::to_value(&result.checkpoint.as_ref().unwrap().trials[..2]).unwrap(),
        original
    );
    let evidence = result.result.unwrap();
    assert_eq!(
        evidence
            .trials
            .iter()
            .map(|trial| trial.score)
            .collect::<Vec<_>>(),
        [1.0, 2.0, 3.0, 4.0]
    );
    assert_eq!(evidence.selected_trial_index, 0);
    for (index, entry) in request
        .structural_catalogue
        .as_ref()
        .unwrap()
        .entries
        .iter()
        .enumerate()
    {
        let native_trial = VariantId::new(format!("host_hpo:trial:{index:010}")).unwrap();
        let actual = calls
            .lock()
            .unwrap()
            .iter()
            .filter(|(_, id)| *id == native_trial)
            .map(|(node, _)| node.clone())
            .collect::<Vec<_>>();
        assert_eq!(
            actual,
            [entry.target_node.clone(), entry.target_node.clone()]
        );
        assert!(evidence.trials[index]
            .scores
            .reports
            .iter()
            .all(|report| report.producer_node == entry.target_node));
    }
}

#[test]
fn structural_host_checkpoint_catalogue_and_fixed_profile_refuse_before_ask() {
    let (plan, request) = structural_host_fixture();
    let options = HostHpoResumeOptions {
        data_fingerprint: "data:structural".into(),
        checkpoint: None,
    };
    let checkpoint = prepare_host_hpo_checkpoint(&plan, &request, &options).unwrap();
    for change in 0..3 {
        let mut current = request.clone();
        match change {
            0 => current.structural_catalogue = None,
            1 => {
                let catalogue = current.structural_catalogue.as_mut().unwrap();
                catalogue.entries.reverse();
                reseal_structural_catalogue(catalogue);
            }
            _ => {
                current
                    .optimizer_descriptor
                    .insert("seed".into(), json!(999));
            }
        }
        let mut proposals = StructuralHostProposals::from_request(&request);
        let mut progress = DurableHostProgress {
            stop_after: usize::MAX,
            checkpoints: Vec::new(),
        };
        let calls = Arc::new(Mutex::new(Vec::new()));
        let controllers = structural_score_controllers(calls.clone());
        let provider = InMemoryDataProvider::new(ControllerId::new("controller:data").unwrap());
        assert!(SequentialScheduler
            .execute_resumable_host_hpo_search(
                &plan,
                &controllers,
                &provider,
                &current,
                &mut proposals,
                &HostHpoResumeOptions {
                    checkpoint: Some(checkpoint.clone()),
                    data_fingerprint: options.data_fingerprint.clone()
                },
                &mut progress
            )
            .is_err());
        assert!(proposals.asked.is_empty());
        assert!(calls.lock().unwrap().is_empty());
    }
}

#[test]
fn structural_host_worker_plans_are_pruned_and_validate_before_execution() {
    let (plan, mut request) = structural_host_fixture();
    request.trial_budget = 2;
    let options = HostHpoResumeOptions {
        data_fingerprint: "worker:structural".into(),
        checkpoint: None,
    };
    let mut proposals = StructuralHostProposals::from_request(&request);
    let window =
        prepare_host_hpo_worker_window(&plan, &request, &options, &mut proposals, 2).unwrap();
    let calls = Arc::new(Mutex::new(Vec::new()));
    let controllers = structural_score_controllers(calls.clone());
    let provider = InMemoryDataProvider::new(ControllerId::new("controller:data").unwrap());
    let mut results = Vec::new();
    for task in &window.tasks {
        assert_eq!(
            task.candidate_plan
                .node_plans
                .values()
                .filter(|node| node.kind == NodeKind::Model)
                .count(),
            1
        );
        let evidence =
            evaluate_host_hpo_worker_task(task, &request, &controllers, &provider).unwrap();
        results.push(HostHpoWorkerResult::Complete {
            evidence,
            data_fingerprint: options.data_fingerprint.clone(),
            fold_evidence: Vec::new(),
        });
    }
    let previous = calls.lock().unwrap().len();
    let mut changed = window.tasks[0].clone();
    changed.params.insert("model.alpha".into(), json!(10));
    assert!(evaluate_host_hpo_worker_task(&changed, &request, &controllers, &provider).is_err());
    assert_eq!(calls.lock().unwrap().len(), previous);
    results.reverse();
    let mut progress = DurableHostProgress {
        stop_after: usize::MAX,
        checkpoints: Vec::new(),
    };
    let outcome = complete_host_hpo_worker_window(
        &plan,
        &request,
        &options,
        window,
        results,
        &mut proposals,
        &mut progress,
    )
    .unwrap();
    assert_eq!(outcome.result.unwrap().selected_trial_index, 0);
    assert_eq!(proposals.told, [(0, 1.0), (1, 2.0)]);
}

#[test]
fn structural_v1_browser_refuses_native_parallel_descriptor_before_callbacks() {
    let (plan, mut request) = structural_host_fixture();
    assert!(request
        .structural_catalogue
        .as_ref()
        .unwrap()
        .topology_contract
        .is_none());
    request.trial_budget = 2;
    request
        .optimizer_descriptor
        .insert("sampler".into(), json!("random"));
    request
        .optimizer_descriptor
        .insert("n_jobs".into(), json!(2));
    let options = HostHpoResumeOptions {
        data_fingerprint: "worker:structural.native-profile".into(),
        checkpoint: None,
    };
    let mut original_proposals = StructuralHostProposals::from_request(&request);
    let window =
        prepare_host_hpo_worker_window(&plan, &request, &options, &mut original_proposals, 2)
            .unwrap();
    assert_eq!(original_proposals.asked, [0, 1]);
    let original_wire = serde_json::to_value(&request).unwrap();
    let calls = Arc::new(Mutex::new(Vec::new()));
    let controllers = structural_score_controllers(calls.clone());
    let provider = InMemoryDataProvider::new(ControllerId::new("controller:data").unwrap());
    let valid = json!({
        "schema_version": 1, "profile": "methods_sequential_cpu_v1", "workers": 2,
        "cpu_threads": 1, "gpu_devices": [],
        "methods_build": {"schema_version": 1, "blas": false, "openmp": false, "cuda": false}
    });
    let mut accelerated = valid.clone();
    accelerated["methods_build"]["blas"] = json!(true);
    let mut oversized = valid.clone();
    oversized["workers"] = json!(5);
    for (index, (descriptor, workers)) in [
        (valid, 2),
        (json!(null), 2),
        (json!({"unknown": true}), 2),
        (accelerated, 2),
        (oversized, 5),
    ]
    .into_iter()
    .enumerate()
    {
        request
            .optimizer_descriptor
            .insert("parallel_execution".into(), descriptor);
        request
            .optimizer_descriptor
            .insert("n_jobs".into(), json!(workers));
        if index == 0 {
            assert!(request.validate_parallel_execution(workers).is_ok());
        }
        let mut proposals = StructuralHostProposals::from_request(&request);
        let error =
            prepare_host_hpo_worker_window(&plan, &request, &options, &mut proposals, workers)
                .unwrap_err();
        assert!(error.to_string().contains("native-only profile"));
        assert!(proposals.asked.is_empty());
        for error in [
            evaluate_host_hpo_worker_task(&window.tasks[0], &request, &controllers, &provider)
                .unwrap_err(),
            evaluate_host_hpo_worker_fold(
                &window.tasks[0],
                &request,
                0,
                &controllers,
                &provider,
                &options.data_fingerprint,
            )
            .unwrap_err(),
        ] {
            assert!(error.to_string().contains("native-only profile"));
        }
        let mut progress = DurableHostProgress {
            stop_after: usize::MAX,
            checkpoints: Vec::new(),
        };
        let error = complete_host_hpo_worker_window(
            &plan,
            &request,
            &options,
            window.clone(),
            Vec::new(),
            &mut proposals,
            &mut progress,
        )
        .unwrap_err();
        assert!(error.to_string().contains("native-only profile"));
        assert!(proposals.asked.is_empty());
        assert!(proposals.told.is_empty());
        assert!(progress.checkpoints.is_empty());
        assert!(calls.lock().unwrap().is_empty());
    }
    request.optimizer_descriptor.remove("parallel_execution");
    request
        .optimizer_descriptor
        .insert("n_jobs".into(), json!(2));
    assert_eq!(serde_json::to_value(&request).unwrap(), original_wire);
}

#[test]
fn fixed_host_hpo_omits_all_new_structural_wire_fields() {
    let (_, _, _, request) = durable_host_fixture(false);
    let value = serde_json::to_value(&request).unwrap();
    assert!(!value
        .as_object()
        .unwrap()
        .contains_key("structural_catalogue"));
    let (plan, _, _, _) = durable_host_fixture(false);
    let checkpoint = prepare_host_hpo_checkpoint(
        &plan,
        &request,
        &HostHpoResumeOptions {
            data_fingerprint: "fixed:data".into(),
            checkpoint: None,
        },
    )
    .unwrap();
    assert!(!serde_json::to_value(&checkpoint.binding)
        .unwrap()
        .as_object()
        .unwrap()
        .contains_key("structural_catalogue_fingerprint"));
}

#[test]
fn structural_host_worker_pruning_scores_the_recipe_target_per_fold() {
    let (plan, mut request) = structural_host_fixture();
    request.trial_budget = 2;
    request.progressive_pruning = true;
    let options = HostHpoResumeOptions {
        data_fingerprint: "worker:structural.pruning".into(),
        checkpoint: None,
    };
    let mut proposals = StructuralHostProposals::from_request(&request);
    let window =
        prepare_host_hpo_worker_window(&plan, &request, &options, &mut proposals, 2).unwrap();
    let controllers = structural_score_controllers(Arc::new(Mutex::new(Vec::new())));
    let provider = InMemoryDataProvider::new(ControllerId::new("controller:data").unwrap());
    let folds = (0..2)
        .map(|index| {
            evaluate_host_hpo_worker_fold(
                &window.tasks[0],
                &request,
                index,
                &controllers,
                &provider,
                &options.data_fingerprint,
            )
            .unwrap()
        })
        .collect::<Vec<_>>();
    assert_eq!(
        host_hpo_worker_intermediate_score(
            &window.tasks[0],
            &request,
            &options.data_fingerprint,
            &folds
        )
        .unwrap(),
        1.0
    );
    let complete =
        evaluate_host_hpo_worker_task(&window.tasks[0], &request, &controllers, &provider).unwrap();
    let observed = vec![evaluate_host_hpo_worker_fold(
        &window.tasks[1],
        &request,
        0,
        &controllers,
        &provider,
        &options.data_fingerprint,
    )
    .unwrap()];
    assert_eq!(observed[0].score, 2.0);
    let pruned = host_hpo_worker_pruned_evidence(
        &window.tasks[1],
        &request,
        &options.data_fingerprint,
        &observed,
    )
    .unwrap();
    let result = complete_host_hpo_worker_window(
        &plan,
        &request,
        &options,
        window,
        vec![
            HostHpoWorkerResult::Complete {
                evidence: complete,
                data_fingerprint: options.data_fingerprint.clone(),
                fold_evidence: folds,
            },
            HostHpoWorkerResult::Pruned {
                evidence: pruned,
                data_fingerprint: options.data_fingerprint.clone(),
                fold_evidence: observed,
            },
        ],
        &mut proposals,
        &mut DurableHostProgress {
            stop_after: usize::MAX,
            checkpoints: Vec::new(),
        },
    )
    .unwrap();
    let result = result.result.unwrap();
    assert_eq!(result.trials.len(), 1);
    assert_eq!(result.pruned_trials.len(), 1);
    assert_eq!(result.pruned_trials[0].intermediate_scores, [2.0]);
    assert_eq!(proposals.told, [(0, 1.0)]);
}

#[test]
fn structural_host_parallel_and_sequential_factories_return_identical_native_evidence() {
    struct Providers;
    impl HostHpoCandidateProviderFactory for Providers {
        fn create(&self, _index: u32) -> Result<Box<dyn RuntimeDataProvider + Send>> {
            Ok(Box::new(InMemoryDataProvider::new(
                ControllerId::new("controller:data").unwrap(),
            )))
        }
    }
    struct Controllers(Arc<Mutex<Vec<(NodeId, VariantId)>>>);
    impl HostHpoCandidateControllerFactory for Controllers {
        fn create(&self, _index: u32) -> Result<RuntimeControllerRegistry> {
            Ok(structural_score_controllers(self.0.clone()))
        }
    }
    let (plan, request) = structural_host_fixture();
    let sequential_calls = Arc::new(Mutex::new(Vec::new()));
    let sequential = SequentialScheduler
        .execute_host_hpo_search_with_candidate_factories(
            &plan,
            &structural_score_controllers(sequential_calls.clone()),
            &InMemoryDataProvider::new(ControllerId::new("controller:data").unwrap()),
            &Providers,
            &Controllers(sequential_calls.clone()),
            &request,
            &mut StructuralHostProposals::from_request(&request),
        )
        .unwrap();
    let parallel_calls = Arc::new(Mutex::new(Vec::new()));
    let parallel = SequentialScheduler
        .execute_parallel_host_hpo_search_with_candidate_factories(
            &plan,
            &Providers,
            &Controllers(parallel_calls.clone()),
            &request,
            &mut StructuralHostProposals::from_request(&request),
            2,
        )
        .unwrap();
    assert_eq!(
        serde_json::to_value(&sequential).unwrap(),
        serde_json::to_value(&parallel).unwrap()
    );
    let mut sequential_tasks = sequential_calls.lock().unwrap().clone();
    sequential_tasks.sort();
    let mut parallel_tasks = parallel_calls.lock().unwrap().clone();
    parallel_tasks.sort();
    assert_eq!(sequential_tasks, parallel_tasks);
    assert_eq!(parallel_tasks.len(), 8);
}

#[cfg(dag_ml_workspace_contract_fixtures)]
#[test]
fn structural_host_winner_request_preserves_output_alias_and_target_order_for_nonfirst_recipe() {
    let (old_plan, old_request) = structural_host_fixture();
    let mut registry = ControllerRegistry::new();
    for manifest in old_plan.controller_manifests.values() {
        let mut manifest = manifest.clone();
        manifest
            .supported_phases
            .extend([Phase::Refit, Phase::Predict]);
        registry.register(manifest).unwrap();
    }
    let old_catalogue = old_request.structural_catalogue.as_ref().unwrap();
    let catalogue = prepare_host_hpo_structural_catalogue(
        &old_catalogue.source_dsl,
        &registry,
        old_catalogue.parameter_paths.clone(),
        old_catalogue.selector_path.clone(),
    )
    .unwrap();
    let compiled = crate::compile_pipeline_dsl_with_generation_and_controller_registry(
        &catalogue.source_dsl,
        &registry,
    )
    .unwrap();
    let plan = build_execution_plan(
        old_plan.id,
        compiled.graph,
        compiled.campaign_template,
        &registry,
    )
    .unwrap();
    let request = HostHpoSearchRequest {
        structural_catalogue: Some(catalogue),
        ..old_request
    };
    let mut proposals = StructuralHostProposals::from_request(&request);
    for (index, params) in proposals.params.iter_mut().enumerate() {
        for (path, value) in params {
            if path != "__recipe__" {
                *value = json!(4 - index);
            }
        }
    }
    let controllers = structural_score_controllers(Arc::new(Mutex::new(Vec::new())));
    let provider = InMemoryDataProvider::new(ControllerId::new("controller:data").unwrap());
    let result = SequentialScheduler
        .execute_host_hpo_search(&plan, &controllers, &provider, &request, &mut proposals)
        .unwrap();
    assert_eq!(result.selected_trial_index, 3);
    let mut template: crate::TrainingRequest = serde_json::from_str(include_str!(
        "../../../../examples/fixtures/training/training_request_package_refit.v1.json"
    ))
    .unwrap();
    template.graph = plan.graph_plan.graph.clone();
    template.campaign = plan.campaign.clone();
    template.controller_manifests = plan.controller_manifests.values().cloned().collect();
    template.data_identities.clear();
    template.parameter_patches.clear();
    template.patch_policies.clear();
    template.influence_requirements.clear();
    template.training_losses.clear();
    template.options.seed = 17;
    template.options.outputs.truncate(1);
    template.options.outputs[0].output_id = "output:structural.winner.capture".into();
    template.options.outputs[0].node_id = request.target_node.clone();
    template.options.outputs[0].port_name = None;
    template.options.outputs[0].target_names = vec!["protein".into(), "moisture".into()];
    template.options.outputs[0].target_units = vec![Some("percent".into()), None];
    template.options.outputs[0].class_labels = vec![Vec::new(), Vec::new()];
    template.options.selection_output_id = template.options.outputs[0].output_id.clone();
    let winner = resolve_host_hpo_structural_winner(&request, &result, &template).unwrap();
    let recipe = &request.structural_catalogue.as_ref().unwrap().entries[3];
    assert_ne!(recipe.target_node, request.target_node);
    let mut expected_output = template.options.outputs[0].clone();
    expected_output.node_id = recipe.target_node.clone();
    assert_eq!(
        winner.options.outputs.as_slice(),
        std::slice::from_ref(&expected_output)
    );
    assert_eq!(
        winner.options.selection_output_id,
        "output:structural.winner.capture"
    );
    let projection = winner.project().unwrap();
    assert_eq!(projection.outputs.len(), 1);
    let projected_output = &projection.outputs[0];
    assert_eq!(projected_output.output_id, expected_output.output_id);
    assert_eq!(projected_output.node_id, recipe.target_node);
    assert_eq!(projected_output.port_name, "oof");
    assert_eq!(projected_output.target_names, expected_output.target_names);
    assert_eq!(projected_output.target_units, expected_output.target_units);
    assert_eq!(projected_output.class_labels, expected_output.class_labels);
    assert!(!winner
        .graph
        .nodes
        .iter()
        .any(|node| node.id == request.target_node));
    assert_eq!(
        projection.plan.variants.as_slice(),
        std::slice::from_ref(&recipe.variant)
    );
    assert_eq!(winner.options.outputs[0].node_id, recipe.target_node);
    assert_eq!(winner.graph.edges, recipe.graph.edges);
    assert_eq!(
        winner
            .graph
            .nodes
            .iter()
            .map(|node| node.id.clone())
            .collect::<Vec<_>>(),
        recipe
            .graph
            .nodes
            .iter()
            .map(|node| node.id.clone())
            .collect::<Vec<_>>()
    );
    assert_eq!(
        projection.plan.node_plans[&recipe.target_node].params["n_components"],
        json!(1)
    );
    assert_eq!(
        winner.campaign.metadata["host_hpo_structural_selection"]["recipe_id"],
        json!(recipe.recipe_id)
    );
    assert_eq!(
        winner.campaign.metadata["host_hpo_structural_selection"]["selected_trial_index"],
        json!(3)
    );
    let mut forged = result.clone();
    forged.selected_trial_index = 0;
    forged.selected_params = forged.trials[0].params.clone();
    assert!(
        resolve_host_hpo_structural_winner(&request, &forged, &template)
            .unwrap_err()
            .to_string()
            .contains("native SELECT")
    );
    template.graph.nodes[0]
        .params
        .insert("forged".into(), json!(true));
    assert!(resolve_host_hpo_structural_winner(&request, &result, &template).is_err());
}

#[cfg(dag_ml_workspace_contract_fixtures)]
#[test]
fn lineage_rejects_duplicate_or_out_of_scope_early_stopping_records() {
    let fixture: serde_json::Value = serde_json::from_str(include_str!(
        "../../../../examples/fixtures/criteria/criteria_contracts.v1.json"
    ))
    .unwrap();
    let record =
        EarlyStoppingRecord::from_json(&fixture["valid"]["early_stopping_record"].to_string())
            .unwrap();
    let mut lineage = LineageRecord {
        record_id: LineageId::new("lineage:early-stopping").unwrap(),
        run_id: RunId::new("run:early-stopping").unwrap(),
        node_id: record.node_id.clone(),
        phase: record.phase,
        controller_id: ControllerId::new("controller:early-stopping").unwrap(),
        controller_version: "1.0.0".to_string(),
        variant_id: None,
        fold_id: record.fold_id.clone(),
        branch_path: Vec::new(),
        input_lineage: Vec::new(),
        artifact_refs: Vec::new(),
        params_fingerprint: "params:early-stopping".to_string(),
        data_model_shape_fingerprint: None,
        aggregation_policy_fingerprint: None,
        seed: Some(42),
        unsafe_flags: BTreeSet::new(),
        metrics: BTreeMap::new(),
        loss_attestations: Vec::new(),
        early_stopping_records: vec![record.clone()],
        target_domain: None,
    };
    lineage.validate().unwrap();

    lineage.early_stopping_records.push(record.clone());
    assert!(lineage
        .validate()
        .unwrap_err()
        .to_string()
        .contains("duplicate early-stopping role"));

    lineage.early_stopping_records = vec![record];
    lineage.node_id = NodeId::new("model:other").unwrap();
    assert!(lineage
        .validate()
        .unwrap_err()
        .to_string()
        .contains("does not match lineage task scope"));
}

#[test]
fn residual_gate_bundle_records_restore_one_portable_refit_scope() {
    let mut ctx = RunContext::new(RunId::new("run:residual.gate.replay").unwrap(), Some(17));
    let records = serde_json::json!([{
        "variant_id": "variant:base", "fold_id": null, "gate": 0.625, "rli": 0.18
    }]);
    ctx.import_residual_gate_records(&records).unwrap();
    assert_eq!(ctx.residual_gate_records()[0].gate, 0.625);
    ctx.import_residual_gate_records(&records).unwrap();
    assert_eq!(ctx.residual_gate_records().len(), 1);
    let tampered = serde_json::json!([{
        "variant_id": "variant:base", "fold_id": null, "gate": 0.75, "rli": 0.18
    }]);
    assert!(ctx.import_residual_gate_records(&tampered).is_err());
    let invalid = serde_json::json!([{
        "variant_id": "variant:base", "fold_id": null, "gate": 1.1, "rli": 0.18
    }]);
    assert!(ctx.import_residual_gate_records(&invalid).is_err());
}

struct MockController {
    id: ControllerId,
    handle: u64,
    emit_prediction: bool,
}

struct VariantProbeController {
    id: ControllerId,
    handle: u64,
    variants: Arc<Mutex<Vec<Option<VariantExecutionSpec>>>>,
    node_plans: Arc<Mutex<Vec<NodePlan>>>,
}

impl RuntimeController for VariantProbeController {
    fn controller_id(&self) -> &ControllerId {
        &self.id
    }

    fn invoke(&self, task: &NodeTask) -> Result<NodeResult> {
        self.variants.lock().unwrap().push(task.variant.clone());
        self.node_plans.lock().unwrap().push(task.node_plan.clone());
        let variant_label = task
            .variant_id
            .as_ref()
            .map(ToString::to_string)
            .unwrap_or_else(|| "base".to_string());
        Ok(NodeResult {
            schema_version: None,
            classification_probabilities: Vec::new(),
            consumed_data_views: std::collections::BTreeMap::new(),
            node_id: task.node_plan.node_id.clone(),
            outputs: BTreeMap::from([(
                "out".to_string(),
                HandleRef {
                    handle: self.handle,
                    kind: HandleKind::Data,
                    owner_controller: self.id.clone(),
                },
            )]),
            predictions: Vec::new(),
            observation_predictions: Vec::new(),
            aggregated_predictions: Vec::new(),
            explanations: Vec::new(),
            shape_deltas: Vec::new(),
            artifacts: Vec::new(),
            artifact_handles: BTreeMap::new(),
            fit_influence_diagnostics: Vec::new(),
            regression_targets: Vec::new(),
            lineage: LineageRecord {
                record_id: LineageId::new(format!(
                    "lineage:{}:{:?}:{variant_label}",
                    task.node_plan.node_id, task.phase
                ))
                .unwrap(),
                run_id: task.run_id.clone(),
                node_id: task.node_plan.node_id.clone(),
                phase: task.phase,
                controller_id: self.id.clone(),
                controller_version: task.node_plan.controller_version.clone(),
                variant_id: task.variant_id.clone(),
                fold_id: task.fold_id.clone(),
                branch_path: task.branch_path.clone(),
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
                target_domain: None,
            },
        })
    }
}

struct ShapeDataController {
    id: ControllerId,
    handle: u64,
    before_feature_schema: String,
    after_feature_schema: String,
}

impl RuntimeController for ShapeDataController {
    fn controller_id(&self) -> &ControllerId {
        &self.id
    }

    fn invoke(&self, task: &NodeTask) -> Result<NodeResult> {
        let shape_plan = task.node_plan.shape_plan.as_ref().ok_or_else(|| {
            DagMlError::RuntimeValidation(format!(
                "shape data controller `{}` expected a shape plan",
                task.node_plan.node_id
            ))
        })?;
        let output = HandleRef {
            handle: self.handle,
            kind: HandleKind::Data,
            owner_controller: self.id.clone(),
        };
        let shape_delta = ShapeDelta {
            node_id: task.node_plan.node_id.clone(),
            kind: ShapeDeltaKind::Feature,
            before_fingerprint: self.before_feature_schema.clone(),
            after_fingerprint: self.after_feature_schema.clone(),
            metadata: BTreeMap::from([(
                "feature_namespace".to_string(),
                serde_json::Value::String("augmented.noise".to_string()),
            )]),
        };
        Ok(NodeResult {
            schema_version: None,
            classification_probabilities: Vec::new(),
            consumed_data_views: std::collections::BTreeMap::new(),
            node_id: task.node_plan.node_id.clone(),
            outputs: BTreeMap::from([("x_out".to_string(), output)]),
            predictions: Vec::new(),
            observation_predictions: Vec::new(),
            aggregated_predictions: Vec::new(),
            explanations: Vec::new(),
            shape_deltas: vec![shape_delta],
            artifacts: Vec::new(),
            artifact_handles: BTreeMap::new(),
            fit_influence_diagnostics: Vec::new(),
            regression_targets: Vec::new(),
            lineage: LineageRecord {
                record_id: LineageId::new(format!(
                    "lineage:{}:{:?}:{}:shape",
                    task.node_plan.node_id,
                    task.phase,
                    task.fold_id
                        .as_ref()
                        .map(ToString::to_string)
                        .unwrap_or_else(|| "nofold".to_string())
                ))
                .unwrap(),
                run_id: task.run_id.clone(),
                node_id: task.node_plan.node_id.clone(),
                phase: task.phase,
                controller_id: self.id.clone(),
                controller_version: task.node_plan.controller_version.clone(),
                variant_id: task.variant_id.clone(),
                fold_id: task.fold_id.clone(),
                branch_path: task.branch_path.clone(),
                input_lineage: Vec::new(),
                artifact_refs: Vec::new(),
                params_fingerprint: task.node_plan.params_fingerprint.clone(),
                data_model_shape_fingerprint: Some(stable_json_fingerprint(shape_plan)?),
                aggregation_policy_fingerprint: Some(stable_json_fingerprint(
                    &shape_plan.aggregation_policy,
                )?),
                seed: task.seed,
                unsafe_flags: BTreeSet::new(),
                metrics: BTreeMap::new(),
                loss_attestations: Vec::new(),
                early_stopping_records: Vec::new(),
                target_domain: None,
            },
        })
    }
}

struct DataViewProbeController {
    id: ControllerId,
    observed_views: Arc<Mutex<Vec<BTreeMap<String, DataProviderViewSpec>>>>,
    prediction_sample_ids: Option<Vec<SampleId>>,
}

impl RuntimeController for DataViewProbeController {
    fn controller_id(&self) -> &ControllerId {
        &self.id
    }

    fn invoke(&self, task: &NodeTask) -> Result<NodeResult> {
        self.observed_views
            .lock()
            .unwrap()
            .push(task.data_views.clone());
        let prediction_sample_ids = self.prediction_sample_ids.clone().unwrap_or_else(|| {
            validation_view_sample_ids(task)
                .map(|ids| ids.into_iter().collect::<Vec<_>>())
                .unwrap_or_else(|| vec![SampleId::new("s1").unwrap()])
        });
        Ok(NodeResult {
            schema_version: None,
            classification_probabilities: Vec::new(),
            consumed_data_views: std::collections::BTreeMap::new(),
            node_id: task.node_plan.node_id.clone(),
            outputs: BTreeMap::from([(
                "oof".to_string(),
                HandleRef {
                    handle: 44,
                    kind: HandleKind::Prediction,
                    owner_controller: self.id.clone(),
                },
            )]),
            predictions: vec![PredictionBlock {
                prediction_id: Some(format!("pred:{}", task.node_plan.node_id)),
                producer_node: task.node_plan.node_id.clone(),
                producer_port: None,
                partition: PredictionPartition::Validation,
                fold_id: task.fold_id.clone(),
                sample_ids: prediction_sample_ids.clone(),
                values: vec![vec![1.0]; prediction_sample_ids.len()],
                target_names: vec!["y".to_string()],
            }],
            observation_predictions: Vec::new(),
            aggregated_predictions: Vec::new(),
            explanations: Vec::new(),
            shape_deltas: Vec::new(),
            artifacts: Vec::new(),
            artifact_handles: BTreeMap::new(),
            fit_influence_diagnostics: Vec::new(),
            regression_targets: Vec::new(),
            lineage: LineageRecord {
                record_id: LineageId::new(format!(
                    "lineage:{}:{:?}:{}:probe",
                    task.node_plan.node_id,
                    task.phase,
                    task.fold_id
                        .as_ref()
                        .map(ToString::to_string)
                        .unwrap_or_else(|| "nofold".to_string())
                ))
                .unwrap(),
                run_id: task.run_id.clone(),
                node_id: task.node_plan.node_id.clone(),
                phase: task.phase,
                controller_id: self.id.clone(),
                controller_version: task.node_plan.controller_version.clone(),
                variant_id: task.variant_id.clone(),
                fold_id: task.fold_id.clone(),
                branch_path: task.branch_path.clone(),
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
                target_domain: None,
            },
        })
    }
}

impl RuntimeController for MockController {
    fn controller_id(&self) -> &ControllerId {
        &self.id
    }

    fn invoke(&self, task: &NodeTask) -> Result<NodeResult> {
        for binding in &task.node_plan.data_bindings {
            let key = format!("data:{}", binding.input_name);
            let handle = task.input_handles.get(&key).ok_or_else(|| {
                DagMlError::RuntimeValidation(format!(
                    "node `{}` did not receive data handle `{key}`",
                    task.node_plan.node_id
                ))
            })?;
            if !matches!(handle.kind, HandleKind::Data | HandleKind::DataView) {
                return Err(DagMlError::RuntimeValidation(format!(
                    "node `{}` received non-data/data-view handle for `{key}`",
                    task.node_plan.node_id
                )));
            }
            if !task.data_views.contains_key(&key) {
                return Err(DagMlError::RuntimeValidation(format!(
                    "node `{}` did not receive data view spec for `{key}`",
                    task.node_plan.node_id
                )));
            }
            if task.phase == Phase::FitCv && task.fold_id.is_some() {
                let validation_key = format!("{key}:validation");
                let validation_view = task.data_views.get(&validation_key).ok_or_else(|| {
                        DagMlError::RuntimeValidation(format!(
                            "node `{}` did not receive validation data view spec for `{validation_key}`",
                            task.node_plan.node_id
                        ))
                    })?;
                if validation_view.partition != DataRequestPartition::FoldValidation {
                    return Err(DagMlError::RuntimeValidation(format!(
                        "node `{}` received non-validation data view for `{validation_key}`",
                        task.node_plan.node_id
                    )));
                }
            }
        }
        let variant_label = task
            .variant_id
            .as_ref()
            .map(ToString::to_string)
            .unwrap_or_else(|| "base".to_string());
        let fold_label = task
            .fold_id
            .as_ref()
            .map(ToString::to_string)
            .unwrap_or_else(|| "nofold".to_string());
        let output = HandleRef {
            handle: self.handle,
            kind: HandleKind::Data,
            owner_controller: self.id.clone(),
        };
        let prediction_output = HandleRef {
            handle: self.handle,
            kind: HandleKind::Prediction,
            owner_controller: self.id.clone(),
        };
        let prediction_sample_ids = validation_view_sample_ids(task)
            .map(|ids| ids.into_iter().collect::<Vec<_>>())
            .unwrap_or_else(|| vec![SampleId::new("s1").unwrap()]);
        let predictions = self
            .emit_prediction
            .then(|| PredictionBlock {
                prediction_id: Some(format!("pred:{}", task.node_plan.node_id)),
                producer_node: task.node_plan.node_id.clone(),
                producer_port: None,
                partition: PredictionPartition::Validation,
                fold_id: task.fold_id.clone(),
                sample_ids: prediction_sample_ids.clone(),
                values: vec![vec![1.0]; prediction_sample_ids.len()],
                target_names: vec!["y".to_string()],
            })
            .into_iter()
            .collect::<Vec<_>>();
        Ok(NodeResult {
            schema_version: None,
            classification_probabilities: Vec::new(),
            consumed_data_views: std::collections::BTreeMap::new(),
            node_id: task.node_plan.node_id.clone(),
            outputs: BTreeMap::from([
                ("out".to_string(), output.clone()),
                ("x".to_string(), output.clone()),
                ("x_out".to_string(), output),
                ("pred".to_string(), prediction_output.clone()),
                ("oof".to_string(), prediction_output),
            ]),
            predictions,
            observation_predictions: Vec::new(),
            aggregated_predictions: Vec::new(),
            explanations: Vec::new(),
            shape_deltas: Vec::new(),
            artifacts: Vec::new(),
            artifact_handles: BTreeMap::new(),
            fit_influence_diagnostics: Vec::new(),
            regression_targets: Vec::new(),
            lineage: LineageRecord {
                record_id: LineageId::new(format!(
                    "lineage:{}:{:?}:{variant_label}:{fold_label}",
                    task.node_plan.node_id, task.phase
                ))
                .unwrap(),
                run_id: task.run_id.clone(),
                node_id: task.node_plan.node_id.clone(),
                phase: task.phase,
                controller_id: self.id.clone(),
                controller_version: task.node_plan.controller_version.clone(),
                variant_id: task.variant_id.clone(),
                fold_id: task.fold_id.clone(),
                branch_path: task.branch_path.clone(),
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
                target_domain: None,
            },
        })
    }
}

#[cfg(dag_ml_workspace_contract_fixtures)]
struct LossRequirementEchoController {
    inner: MockController,
}

#[cfg(dag_ml_workspace_contract_fixtures)]
impl RuntimeController for LossRequirementEchoController {
    fn controller_id(&self) -> &ControllerId {
        self.inner.controller_id()
    }

    fn invoke(&self, task: &NodeTask) -> Result<NodeResult> {
        let mut result = self.inner.invoke(task)?;
        result.lineage.loss_attestations = task.required_loss_attestations.clone();
        Ok(result)
    }
}

#[cfg(dag_ml_workspace_contract_fixtures)]
type RustLossFn = Arc<dyn Fn(f64, f64) -> f64 + Send + Sync>;
#[cfg(dag_ml_workspace_contract_fixtures)]
type RustLossCalls = Arc<Mutex<Vec<(Phase, Option<FoldId>, f64)>>>;

#[cfg(dag_ml_workspace_contract_fixtures)]
struct RustLocalLossController {
    inner: MockController,
    registry: Arc<Mutex<LocalImplementationRegistry<RustLossFn>>>,
    calls: RustLossCalls,
}

#[cfg(dag_ml_workspace_contract_fixtures)]
impl RuntimeController for RustLocalLossController {
    fn controller_id(&self) -> &ControllerId {
        self.inner.controller_id()
    }

    fn invoke(&self, task: &NodeTask) -> Result<NodeResult> {
        let (role, attestation) = task.training_loss_binding(0)?;
        let loss = {
            let registry = self.registry.lock().unwrap();
            Arc::clone(registry.resolve_loss(&role.loss)?)
        };
        let value = loss(2.0, 5.5);
        if !value.is_finite() {
            return Err(DagMlError::RuntimeValidation(
                "Rust local training loss returned a non-finite scalar".to_string(),
            ));
        }
        self.calls
            .lock()
            .unwrap()
            .push((task.phase, task.fold_id.clone(), value));
        let mut result = self.inner.invoke(task)?;
        result.lineage.loss_attestations = vec![attestation.clone()];
        Ok(result)
    }
}

struct ReplayMockController {
    id: ControllerId,
    handle: u64,
    require_artifact: bool,
    emit_prediction: bool,
    emit_refit_artifact: bool,
}

impl RuntimeController for ReplayMockController {
    fn controller_id(&self) -> &ControllerId {
        &self.id
    }

    fn invoke(&self, task: &NodeTask) -> Result<NodeResult> {
        for binding in &task.node_plan.data_bindings {
            let key = format!("data:{}", binding.input_name);
            let handle = task.input_handles.get(&key).ok_or_else(|| {
                DagMlError::RuntimeValidation(format!(
                    "node `{}` did not receive data handle `{key}`",
                    task.node_plan.node_id
                ))
            })?;
            if !matches!(handle.kind, HandleKind::Data | HandleKind::DataView) {
                return Err(DagMlError::RuntimeValidation(format!(
                    "node `{}` received non-data/data-view handle for `{key}`",
                    task.node_plan.node_id
                )));
            }
            if !task.data_views.contains_key(&key) {
                return Err(DagMlError::RuntimeValidation(format!(
                    "node `{}` did not receive data view spec for `{key}`",
                    task.node_plan.node_id
                )));
            }
            if task.phase == Phase::FitCv && task.fold_id.is_some() {
                let validation_key = format!("{key}:validation");
                let validation_view = task.data_views.get(&validation_key).ok_or_else(|| {
                        DagMlError::RuntimeValidation(format!(
                            "node `{}` did not receive validation data view spec for `{validation_key}`",
                            task.node_plan.node_id
                        ))
                    })?;
                if validation_view.partition != DataRequestPartition::FoldValidation {
                    return Err(DagMlError::RuntimeValidation(format!(
                        "node `{}` received non-validation data view for `{validation_key}`",
                        task.node_plan.node_id
                    )));
                }
            }
        }
        if self.require_artifact {
            let artifact_id = ArtifactId::new("artifact:model:base:refit").unwrap();
            let key = refit_artifact_input_key(&artifact_id);
            let handle = task.input_handles.get(&key).ok_or_else(|| {
                DagMlError::RuntimeValidation(format!(
                    "node `{}` did not receive refit artifact handle `{key}`",
                    task.node_plan.node_id
                ))
            })?;
            if handle.kind != HandleKind::Model {
                return Err(DagMlError::RuntimeValidation(format!(
                    "node `{}` received non-model refit handle for `{key}`",
                    task.node_plan.node_id
                )));
            }
            let artifact_input = task.artifact_inputs.get(&key).ok_or_else(|| {
                DagMlError::RuntimeValidation(format!(
                    "node `{}` did not receive refit artifact metadata `{key}`",
                    task.node_plan.node_id
                ))
            })?;
            if artifact_input.artifact.id != artifact_id
                || artifact_input.node_id != task.node_plan.node_id
                || artifact_input.controller_id != task.node_plan.controller_id
            {
                return Err(DagMlError::RuntimeValidation(format!(
                    "node `{}` received mismatched refit artifact metadata `{key}`",
                    task.node_plan.node_id
                )));
            }
        }

        let output = HandleRef {
            handle: self.handle,
            kind: HandleKind::Data,
            owner_controller: self.id.clone(),
        };
        let predictions = self
            .emit_prediction
            .then(|| PredictionBlock {
                prediction_id: Some(format!("pred:{}", task.node_plan.node_id)),
                producer_node: task.node_plan.node_id.clone(),
                producer_port: None,
                partition: PredictionPartition::Final,
                fold_id: None,
                sample_ids: vec![SampleId::new("sample:mock").unwrap()],
                values: vec![vec![self.handle as f64]],
                target_names: vec!["y".to_string()],
            })
            .into_iter()
            .collect::<Vec<_>>();
        let artifacts = if self.emit_refit_artifact && task.phase == Phase::Refit {
            vec![ArtifactRef {
                id: ArtifactId::new(format!("artifact:{}:refit", task.node_plan.node_id)).unwrap(),
                kind: "mock_model".to_string(),
                controller_id: self.id.clone(),
                backend: None,
                uri: None,
                content_fingerprint: None,
                size_bytes: Some(128),
                plugin: None,
                plugin_version: None,
                abi_major: None,
                abi_min_minor: None,
                native_predictor_descriptor: None,
                native_estimator_descriptor: None,
            }]
        } else {
            Vec::new()
        };
        let artifact_handles = artifacts
            .iter()
            .map(|artifact| {
                (
                    artifact.id.clone(),
                    HandleRef {
                        handle: self.handle + 10_000,
                        kind: HandleKind::Model,
                        owner_controller: self.id.clone(),
                    },
                )
            })
            .collect::<BTreeMap<_, _>>();
        Ok(NodeResult {
            schema_version: None,
            classification_probabilities: Vec::new(),
            consumed_data_views: std::collections::BTreeMap::new(),
            node_id: task.node_plan.node_id.clone(),
            outputs: BTreeMap::from([("out".to_string(), output)]),
            predictions,
            observation_predictions: Vec::new(),
            aggregated_predictions: Vec::new(),
            explanations: Vec::new(),
            shape_deltas: Vec::new(),
            artifacts: artifacts.clone(),
            artifact_handles,
            fit_influence_diagnostics: Vec::new(),
            regression_targets: Vec::new(),
            lineage: LineageRecord {
                record_id: LineageId::new(format!(
                    "lineage:replay:{}:{:?}",
                    task.node_plan.node_id, task.phase
                ))
                .unwrap(),
                run_id: task.run_id.clone(),
                node_id: task.node_plan.node_id.clone(),
                phase: task.phase,
                controller_id: self.id.clone(),
                controller_version: task.node_plan.controller_version.clone(),
                variant_id: task.variant_id.clone(),
                fold_id: task.fold_id.clone(),
                branch_path: task.branch_path.clone(),
                input_lineage: Vec::new(),
                artifact_refs: artifacts,
                params_fingerprint: task.node_plan.params_fingerprint.clone(),
                data_model_shape_fingerprint: None,
                aggregation_policy_fingerprint: None,
                seed: task.seed,
                unsafe_flags: BTreeSet::new(),
                metrics: BTreeMap::new(),
                loss_attestations: Vec::new(),
                early_stopping_records: Vec::new(),
                target_domain: None,
            },
        })
    }
}

#[derive(Clone, Copy)]
enum OofSampleMode {
    Aligned,
    Swapped,
}

struct OofEdgeController {
    id: ControllerId,
    base_partition: Option<PredictionPartition>,
    sample_mode: OofSampleMode,
}

impl RuntimeController for OofEdgeController {
    fn controller_id(&self) -> &ControllerId {
        &self.id
    }

    fn invoke(&self, task: &NodeTask) -> Result<NodeResult> {
        if task.node_plan.node_id.as_str() == "model:meta" {
            let handle = task.input_handles.get("model:base.pred").ok_or_else(|| {
                DagMlError::RuntimeValidation(
                    "meta node did not receive OOF prediction input".to_string(),
                )
            })?;
            if handle.kind != HandleKind::Prediction {
                return Err(DagMlError::RuntimeValidation(format!(
                    "meta node received {:?} instead of OOF prediction input",
                    handle.kind
                )));
            }
            let prediction_input =
                task.prediction_inputs
                    .get("model:base.pred")
                    .ok_or_else(|| {
                        DagMlError::RuntimeValidation(
                            "meta node did not receive OOF prediction input spec".to_string(),
                        )
                    })?;
            if prediction_input.producer_node.as_str() != "model:base"
                || prediction_input.partition != PredictionPartition::Validation
                || prediction_input.prediction_level != PredictionLevel::Sample
                || prediction_input.prediction_width != 1
            {
                return Err(DagMlError::RuntimeValidation(
                    "meta node received invalid OOF prediction input spec".to_string(),
                ));
            }
            if task.phase == Phase::FitCv {
                if prediction_input.fold_id != task.fold_id {
                    return Err(DagMlError::RuntimeValidation(
                        "meta node received OOF prediction spec for the wrong fold".to_string(),
                    ));
                }
                if prediction_input.sample_ids != aligned_validation_samples(task) {
                    return Err(DagMlError::RuntimeValidation(
                        "meta node received OOF prediction spec for wrong samples".to_string(),
                    ));
                }
            }
            if task.phase == Phase::Refit
                && (prediction_input.fold_id.is_some()
                    || prediction_input.fold_ids
                        != vec![
                            FoldId::new("fold:0").unwrap(),
                            FoldId::new("fold:1").unwrap(),
                        ]
                    || prediction_input.sample_ids
                        != vec![SampleId::new("s1").unwrap(), SampleId::new("s2").unwrap()])
            {
                return Err(DagMlError::RuntimeValidation(
                    "meta node received invalid refit OOF coverage spec".to_string(),
                ));
            }
        }

        let predictions = if task.node_plan.node_id.as_str() == "model:base" {
            self.base_partition
                .clone()
                .map(|partition| {
                    let sample_ids = match self.sample_mode {
                        OofSampleMode::Aligned => aligned_validation_samples(task),
                        OofSampleMode::Swapped => swapped_validation_samples(task),
                    };
                    let fold_id = matches!(
                        partition,
                        PredictionPartition::Train | PredictionPartition::Validation
                    )
                    .then(|| task.fold_id.clone())
                    .flatten();
                    PredictionBlock {
                        prediction_id: Some(format!("pred:{}", task.node_plan.node_id)),
                        producer_node: task.node_plan.node_id.clone(),
                        producer_port: None,
                        partition,
                        fold_id,
                        sample_ids: sample_ids.clone(),
                        values: vec![vec![0.5]; sample_ids.len()],
                        target_names: vec!["y".to_string()],
                    }
                })
                .into_iter()
                .collect::<Vec<_>>()
        } else {
            Vec::new()
        };

        let handle_id = if task.node_plan.node_id.as_str() == "model:base" {
            101
        } else {
            202
        };
        Ok(NodeResult {
            schema_version: None,
            classification_probabilities: Vec::new(),
            consumed_data_views: std::collections::BTreeMap::new(),
            node_id: task.node_plan.node_id.clone(),
            outputs: BTreeMap::from([(
                "pred".to_string(),
                HandleRef {
                    handle: handle_id,
                    kind: HandleKind::Data,
                    owner_controller: self.id.clone(),
                },
            )]),
            predictions,
            observation_predictions: Vec::new(),
            aggregated_predictions: Vec::new(),
            explanations: Vec::new(),
            shape_deltas: Vec::new(),
            artifacts: Vec::new(),
            artifact_handles: BTreeMap::new(),
            fit_influence_diagnostics: Vec::new(),
            regression_targets: Vec::new(),
            lineage: LineageRecord {
                record_id: LineageId::new(format!(
                    "lineage:oof:{}:{}",
                    task.node_plan.node_id,
                    task.fold_id
                        .as_ref()
                        .map(ToString::to_string)
                        .unwrap_or_else(|| "nofold".to_string())
                ))
                .unwrap(),
                run_id: task.run_id.clone(),
                node_id: task.node_plan.node_id.clone(),
                phase: task.phase,
                controller_id: self.id.clone(),
                controller_version: task.node_plan.controller_version.clone(),
                variant_id: task.variant_id.clone(),
                fold_id: task.fold_id.clone(),
                branch_path: task.branch_path.clone(),
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
                target_domain: None,
            },
        })
    }
}

/// Captured `(sample_ids, values, prediction_width)` from a FIT_CV `PredictionInputSpec`.
type CapturedOofSpec = (Vec<SampleId>, Vec<Vec<f64>>, usize);

/// Emits a Validation OOF block at `model:base` and, at `model:meta`, records the
/// `(sample_ids, values, width)` carried by the FIT_CV `PredictionInputSpec` so a
/// test can assert the host can build a stacking matrix from spec values alone.
struct CaptureOofValuesController {
    id: ControllerId,
    captured: Arc<Mutex<Vec<CapturedOofSpec>>>,
}

impl RuntimeController for CaptureOofValuesController {
    fn controller_id(&self) -> &ControllerId {
        &self.id
    }

    fn invoke(&self, task: &NodeTask) -> Result<NodeResult> {
        if task.node_plan.node_id.as_str() == "model:meta" && task.phase == Phase::FitCv {
            let spec = task
                .prediction_inputs
                .get("model:base.pred")
                .ok_or_else(|| {
                    DagMlError::RuntimeValidation(
                        "meta node did not receive OOF prediction input spec".to_string(),
                    )
                })?;
            self.captured.lock().unwrap().push((
                spec.sample_ids.clone(),
                spec.values.clone(),
                spec.prediction_width,
            ));
        }

        let predictions = if task.node_plan.node_id.as_str() == "model:base" {
            let sample_ids = aligned_validation_samples(task);
            // Per-sample value carries the sample ordinal, so the test can assert
            // the spec rows stay aligned 1:1 with `sample_ids`.
            let values = sample_ids
                .iter()
                .map(|sample_id| {
                    vec![if sample_id.as_str() == "s1" {
                        0.25
                    } else {
                        0.75
                    }]
                })
                .collect::<Vec<_>>();
            vec![PredictionBlock {
                prediction_id: Some(format!("pred:{}", task.node_plan.node_id)),
                producer_node: task.node_plan.node_id.clone(),
                producer_port: None,
                partition: PredictionPartition::Validation,
                fold_id: task.fold_id.clone(),
                sample_ids,
                values,
                target_names: vec!["y".to_string()],
            }]
        } else {
            Vec::new()
        };

        let handle_id = if task.node_plan.node_id.as_str() == "model:base" {
            505
        } else {
            606
        };
        Ok(NodeResult {
            schema_version: None,
            classification_probabilities: Vec::new(),
            consumed_data_views: std::collections::BTreeMap::new(),
            node_id: task.node_plan.node_id.clone(),
            outputs: BTreeMap::from([(
                "pred".to_string(),
                HandleRef {
                    handle: handle_id,
                    kind: HandleKind::Data,
                    owner_controller: self.id.clone(),
                },
            )]),
            predictions,
            observation_predictions: Vec::new(),
            aggregated_predictions: Vec::new(),
            explanations: Vec::new(),
            shape_deltas: Vec::new(),
            artifacts: Vec::new(),
            artifact_handles: BTreeMap::new(),
            fit_influence_diagnostics: Vec::new(),
            regression_targets: Vec::new(),
            lineage: LineageRecord {
                record_id: LineageId::new(format!(
                    "lineage:oof.values:{}:{}",
                    task.node_plan.node_id,
                    task.fold_id
                        .as_ref()
                        .map(ToString::to_string)
                        .unwrap_or_else(|| "nofold".to_string())
                ))
                .unwrap(),
                run_id: task.run_id.clone(),
                node_id: task.node_plan.node_id.clone(),
                phase: task.phase,
                controller_id: self.id.clone(),
                controller_version: task.node_plan.controller_version.clone(),
                variant_id: task.variant_id.clone(),
                fold_id: task.fold_id.clone(),
                branch_path: task.branch_path.clone(),
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
                target_domain: None,
            },
        })
    }
}

struct ExpectedRefitOofController {
    id: ControllerId,
    expected_fold_ids: Vec<FoldId>,
    expected_sample_ids: Vec<SampleId>,
    expected_target_names: Vec<String>,
}

impl RuntimeController for ExpectedRefitOofController {
    fn controller_id(&self) -> &ControllerId {
        &self.id
    }

    fn invoke(&self, task: &NodeTask) -> Result<NodeResult> {
        if task.node_plan.node_id.as_str() == "model:meta" && task.phase == Phase::Refit {
            let handle = task.input_handles.get("model:base.pred").ok_or_else(|| {
                DagMlError::RuntimeValidation(
                    "meta node did not receive grouped OOF prediction input".to_string(),
                )
            })?;
            if handle.kind != HandleKind::Prediction {
                return Err(DagMlError::RuntimeValidation(format!(
                    "meta node received {:?} instead of grouped OOF prediction input",
                    handle.kind
                )));
            }
            let prediction_input =
                task.prediction_inputs
                    .get("model:base.pred")
                    .ok_or_else(|| {
                        DagMlError::RuntimeValidation(
                            "meta node did not receive grouped OOF prediction input spec"
                                .to_string(),
                        )
                    })?;
            if prediction_input.producer_node.as_str() != "model:base"
                || prediction_input.source_port != "pred"
                || prediction_input.target_port != "pred"
                || prediction_input.partition != PredictionPartition::Validation
                || prediction_input.prediction_level != PredictionLevel::Sample
                || prediction_input.fold_id.is_some()
                || prediction_input.fold_ids != self.expected_fold_ids
                || prediction_input.sample_ids != self.expected_sample_ids
                || prediction_input.prediction_width != 1
                || prediction_input.target_names != self.expected_target_names
            {
                return Err(DagMlError::RuntimeValidation(format!(
                    "meta node received invalid grouped refit OOF spec: {:?}",
                    prediction_input
                )));
            }
        }

        let handle_id = if task.node_plan.node_id.as_str() == "model:base" {
            303
        } else {
            404
        };
        Ok(NodeResult {
            schema_version: None,
            classification_probabilities: Vec::new(),
            consumed_data_views: std::collections::BTreeMap::new(),
            node_id: task.node_plan.node_id.clone(),
            outputs: BTreeMap::from([(
                "pred".to_string(),
                HandleRef {
                    handle: handle_id,
                    kind: HandleKind::Prediction,
                    owner_controller: self.id.clone(),
                },
            )]),
            predictions: Vec::new(),
            observation_predictions: Vec::new(),
            aggregated_predictions: Vec::new(),
            explanations: Vec::new(),
            shape_deltas: Vec::new(),
            artifacts: Vec::new(),
            artifact_handles: BTreeMap::new(),
            fit_influence_diagnostics: Vec::new(),
            regression_targets: Vec::new(),
            lineage: LineageRecord {
                record_id: LineageId::new(format!(
                    "lineage:grouped-oof:{}:{:?}",
                    task.node_plan.node_id, task.phase
                ))
                .unwrap(),
                run_id: task.run_id.clone(),
                node_id: task.node_plan.node_id.clone(),
                phase: task.phase,
                controller_id: self.id.clone(),
                controller_version: task.node_plan.controller_version.clone(),
                variant_id: task.variant_id.clone(),
                fold_id: task.fold_id.clone(),
                branch_path: task.branch_path.clone(),
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
                target_domain: None,
            },
        })
    }
}

struct GroupAggregatedOofController {
    id: ControllerId,
}

impl RuntimeController for GroupAggregatedOofController {
    fn controller_id(&self) -> &ControllerId {
        &self.id
    }

    fn invoke(&self, task: &NodeTask) -> Result<NodeResult> {
        if task.node_plan.node_id.as_str() == "model:meta" {
            validate_group_oof_prediction_input(task)?;
        }

        let observation_predictions =
            if task.node_plan.node_id.as_str() == "model:base" && task.phase == Phase::FitCv {
                let (observation_ids, values) =
                    match task.fold_id.as_ref().map(ToString::to_string).as_deref() {
                        Some("fold:0") => (
                            vec![
                                ObservationId::new("obs.S001.base").unwrap(),
                                ObservationId::new("obs.S001.rep1").unwrap(),
                            ],
                            vec![vec![2.0], vec![6.0]],
                        ),
                        Some("fold:1") => (
                            vec![ObservationId::new("obs.S002.base").unwrap()],
                            vec![vec![10.0]],
                        ),
                        _ => (Vec::new(), Vec::new()),
                    };
                if observation_ids.is_empty() {
                    Vec::new()
                } else {
                    vec![ObservationPredictionBlock {
                        prediction_id: Some(format!(
                            "pred:group-oof:{}",
                            task.fold_id
                                .as_ref()
                                .map(ToString::to_string)
                                .unwrap_or_else(|| "nofold".to_string())
                        )),
                        producer_node: task.node_plan.node_id.clone(),
                        producer_port: None,
                        partition: PredictionPartition::Validation,
                        fold_id: task.fold_id.clone(),
                        observation_ids,
                        values,
                        weights: Vec::new(),
                        target_names: vec!["y".to_string()],
                    }]
                }
            } else {
                Vec::new()
            };

        let handle_id = if task.node_plan.node_id.as_str() == "model:base" {
            707
        } else {
            808
        };
        Ok(NodeResult {
            schema_version: None,
            classification_probabilities: Vec::new(),
            consumed_data_views: std::collections::BTreeMap::new(),
            node_id: task.node_plan.node_id.clone(),
            outputs: BTreeMap::from([(
                "pred".to_string(),
                HandleRef {
                    handle: handle_id,
                    kind: HandleKind::Prediction,
                    owner_controller: self.id.clone(),
                },
            )]),
            predictions: Vec::new(),
            observation_predictions,
            aggregated_predictions: Vec::new(),
            explanations: Vec::new(),
            shape_deltas: Vec::new(),
            artifacts: Vec::new(),
            artifact_handles: BTreeMap::new(),
            fit_influence_diagnostics: Vec::new(),
            regression_targets: Vec::new(),
            lineage: LineageRecord {
                record_id: LineageId::new(format!(
                    "lineage:group-oof:{}:{}:{:?}",
                    task.node_plan.node_id,
                    task.fold_id
                        .as_ref()
                        .map(ToString::to_string)
                        .unwrap_or_else(|| "nofold".to_string()),
                    task.phase
                ))
                .unwrap(),
                run_id: task.run_id.clone(),
                node_id: task.node_plan.node_id.clone(),
                phase: task.phase,
                controller_id: self.id.clone(),
                controller_version: task.node_plan.controller_version.clone(),
                variant_id: task.variant_id.clone(),
                fold_id: task.fold_id.clone(),
                branch_path: task.branch_path.clone(),
                input_lineage: Vec::new(),
                artifact_refs: Vec::new(),
                params_fingerprint: task.node_plan.params_fingerprint.clone(),
                data_model_shape_fingerprint: task
                    .node_plan
                    .shape_plan
                    .as_ref()
                    .map(stable_json_fingerprint)
                    .transpose()?,
                aggregation_policy_fingerprint: task
                    .node_plan
                    .shape_plan
                    .as_ref()
                    .map(|shape_plan| stable_json_fingerprint(&shape_plan.aggregation_policy))
                    .transpose()?,
                seed: task.seed,
                unsafe_flags: BTreeSet::new(),
                metrics: BTreeMap::new(),
                loss_attestations: Vec::new(),
                early_stopping_records: Vec::new(),
                target_domain: None,
            },
        })
    }
}

fn validate_group_oof_prediction_input(task: &NodeTask) -> Result<()> {
    let handle = task.input_handles.get("model:base.pred").ok_or_else(|| {
        DagMlError::RuntimeValidation(
            "meta node did not receive group OOF prediction input".to_string(),
        )
    })?;
    if handle.kind != HandleKind::Prediction {
        return Err(DagMlError::RuntimeValidation(format!(
            "meta node received {:?} instead of group OOF prediction input",
            handle.kind
        )));
    }
    let prediction_input = task
        .prediction_inputs
        .get("model:base.pred")
        .ok_or_else(|| {
            DagMlError::RuntimeValidation(
                "meta node did not receive group OOF prediction input spec".to_string(),
            )
        })?;
    let fold0 = FoldId::new("fold:0").unwrap();
    let fold1 = FoldId::new("fold:1").unwrap();
    let plant_a = PredictionUnitId::Group(GroupId::new("plant.A").unwrap());
    let plant_b = PredictionUnitId::Group(GroupId::new("plant.B").unwrap());
    let (expected_fold_id, expected_fold_ids, expected_unit_ids) = match task.phase {
        Phase::FitCv => match task.fold_id.as_ref().map(ToString::to_string).as_deref() {
            Some("fold:0") => (Some(fold0.clone()), vec![fold0], vec![plant_a]),
            Some("fold:1") => (Some(fold1.clone()), vec![fold1], vec![plant_b]),
            other => {
                return Err(DagMlError::RuntimeValidation(format!(
                    "unexpected group OOF fold scope {other:?}"
                )));
            }
        },
        Phase::Refit => (None, vec![fold0, fold1], vec![plant_a, plant_b]),
        _ => {
            return Err(DagMlError::RuntimeValidation(format!(
                "unexpected group OOF phase {:?}",
                task.phase
            )));
        }
    };
    if prediction_input.producer_node.as_str() != "model:base"
        || prediction_input.source_port != "pred"
        || prediction_input.target_port != "pred"
        || prediction_input.partition != PredictionPartition::Validation
        || prediction_input.prediction_level != PredictionLevel::Group
        || prediction_input.fold_id != expected_fold_id
        || prediction_input.fold_ids != expected_fold_ids
        || prediction_input.unit_ids != expected_unit_ids
        || !prediction_input.sample_ids.is_empty()
        || prediction_input.prediction_width != 1
        || prediction_input.target_names != vec!["y".to_string()]
    {
        return Err(DagMlError::RuntimeValidation(format!(
            "meta node received invalid group OOF spec: {:?}",
            prediction_input
        )));
    }
    Ok(())
}

struct CustomAggregationController {
    id: ControllerId,
    task_ids: Arc<Mutex<Vec<String>>>,
}

impl RuntimeController for CustomAggregationController {
    fn controller_id(&self) -> &ControllerId {
        &self.id
    }

    fn invoke(&self, task: &NodeTask) -> Result<NodeResult> {
        Err(DagMlError::RuntimeValidation(format!(
            "custom aggregation controller received unexpected node task `{}`",
            task.node_plan.node_id
        )))
    }

    fn invoke_aggregation(
        &self,
        task: &AggregationControllerTask,
    ) -> Result<AggregationControllerResult> {
        self.task_ids.lock().unwrap().push(task.task_id.clone());
        match &task.input {
            AggregationControllerInput::ObservationToSample {
                block,
                relations,
                requested_sample_order,
            } => {
                let mut by_sample = BTreeMap::<SampleId, Vec<Vec<f64>>>::new();
                for (observation_id, row) in block.observation_ids.iter().zip(block.values.iter()) {
                    let sample_id = relations
                        .sample_for_observation(observation_id)
                        .ok_or_else(|| {
                            DagMlError::OofValidation(format!(
                                "missing relation for `{observation_id}`"
                            ))
                        })?;
                    by_sample
                        .entry(sample_id.clone())
                        .or_default()
                        .push(row.clone());
                }
                let values = requested_sample_order
                    .iter()
                    .map(|sample_id| {
                        let rows = by_sample.get(sample_id).ok_or_else(|| {
                            DagMlError::OofValidation(format!(
                                "missing sample `{sample_id}` for custom aggregation"
                            ))
                        })?;
                        let width = rows.first().map_or(0, Vec::len);
                        Ok((0..width)
                            .map(|col| {
                                rows.iter().map(|row| row[col]).sum::<f64>() / rows.len() as f64
                            })
                            .collect::<Vec<_>>())
                    })
                    .collect::<Result<Vec<_>>>()?;
                Ok(AggregationControllerResult {
                    schema_version:
                        crate::aggregation::AGGREGATION_CONTROLLER_RESULT_SCHEMA_VERSION,
                    task_id: task.task_id.clone(),
                    reduction_plan: None,
                    output: AggregationControllerOutput::Sample {
                        block: PredictionBlock {
                            prediction_id: block.prediction_id.clone(),
                            producer_node: block.producer_node.clone(),
                            producer_port: None,
                            partition: block.partition.clone(),
                            fold_id: block.fold_id.clone(),
                            sample_ids: requested_sample_order.clone(),
                            values,
                            target_names: block.target_names.clone(),
                        },
                    },
                })
            }
            AggregationControllerInput::SampleToUnit {
                block,
                relations,
                requested_unit_order,
            } => {
                let mut by_unit = BTreeMap::<PredictionUnitId, Vec<Vec<f64>>>::new();
                for (sample_id, row) in block.sample_ids.iter().zip(block.values.iter()) {
                    let unit_id = relations
                        .group_for_sample(sample_id)
                        .cloned()
                        .map(PredictionUnitId::Group)
                        .ok_or_else(|| {
                            DagMlError::OofValidation(format!(
                                "missing group relation for `{sample_id}`"
                            ))
                        })?;
                    by_unit.entry(unit_id).or_default().push(row.clone());
                }
                let values = requested_unit_order
                    .iter()
                    .map(|unit_id| {
                        let rows = by_unit.get(unit_id).ok_or_else(|| {
                            DagMlError::OofValidation(format!(
                                "missing unit `{unit_id}` for custom aggregation"
                            ))
                        })?;
                        let width = rows.first().map_or(0, Vec::len);
                        Ok((0..width)
                            .map(|col| rows.iter().map(|row| row[col]).fold(f64::MIN, f64::max))
                            .collect::<Vec<_>>())
                    })
                    .collect::<Result<Vec<_>>>()?;
                Ok(AggregationControllerResult {
                    schema_version:
                        crate::aggregation::AGGREGATION_CONTROLLER_RESULT_SCHEMA_VERSION,
                    task_id: task.task_id.clone(),
                    reduction_plan: None,
                    output: AggregationControllerOutput::Unit {
                        block: AggregatedPredictionBlock {
                            prediction_id: block.prediction_id.clone(),
                            producer_node: block.producer_node.clone(),
                            producer_port: None,
                            partition: block.partition.clone(),
                            fold_id: block.fold_id.clone(),
                            level: PredictionLevel::Group,
                            unit_ids: requested_unit_order.clone(),
                            values,
                            target_names: block.target_names.clone(),
                        },
                    },
                })
            }
        }
    }
}

struct ObservationPredictionRuntimeController {
    id: ControllerId,
}

impl RuntimeController for ObservationPredictionRuntimeController {
    fn controller_id(&self) -> &ControllerId {
        &self.id
    }

    fn invoke(&self, task: &NodeTask) -> Result<NodeResult> {
        let (observation_ids, values) =
            match task.fold_id.as_ref().map(ToString::to_string).as_deref() {
                Some("fold:0") => (
                    vec![
                        ObservationId::new("obs.S001.base").unwrap(),
                        ObservationId::new("obs.S001.rep1").unwrap(),
                    ],
                    vec![vec![2.0], vec![6.0]],
                ),
                Some("fold:1") => (
                    vec![ObservationId::new("obs.S002.base").unwrap()],
                    vec![vec![10.0]],
                ),
                _ => (
                    vec![ObservationId::new("obs.S001.base").unwrap()],
                    vec![vec![2.0]],
                ),
            };
        Ok(NodeResult {
            schema_version: None,
            classification_probabilities: Vec::new(),
            consumed_data_views: std::collections::BTreeMap::new(),
            node_id: task.node_plan.node_id.clone(),
            outputs: BTreeMap::from([(
                "pred".to_string(),
                HandleRef {
                    handle: 515,
                    kind: HandleKind::Prediction,
                    owner_controller: self.id.clone(),
                },
            )]),
            predictions: Vec::new(),
            observation_predictions: vec![ObservationPredictionBlock {
                prediction_id: Some("pred:obs.runtime".to_string()),
                producer_node: task.node_plan.node_id.clone(),
                producer_port: None,
                partition: PredictionPartition::Validation,
                fold_id: task.fold_id.clone(),
                observation_ids,
                values,
                weights: Vec::new(),
                target_names: vec!["y".to_string()],
            }],
            aggregated_predictions: Vec::new(),
            explanations: Vec::new(),
            shape_deltas: Vec::new(),
            artifacts: Vec::new(),
            artifact_handles: BTreeMap::new(),
            fit_influence_diagnostics: Vec::new(),
            regression_targets: Vec::new(),
            lineage: LineageRecord {
                record_id: LineageId::new(format!(
                    "lineage:obs-runtime:{}:{}",
                    task.node_plan.node_id,
                    task.fold_id
                        .as_ref()
                        .map(ToString::to_string)
                        .unwrap_or_else(|| "nofold".to_string())
                ))
                .unwrap(),
                run_id: task.run_id.clone(),
                node_id: task.node_plan.node_id.clone(),
                phase: task.phase,
                controller_id: self.id.clone(),
                controller_version: task.node_plan.controller_version.clone(),
                variant_id: task.variant_id.clone(),
                fold_id: task.fold_id.clone(),
                branch_path: task.branch_path.clone(),
                input_lineage: Vec::new(),
                artifact_refs: Vec::new(),
                params_fingerprint: task.node_plan.params_fingerprint.clone(),
                data_model_shape_fingerprint: task
                    .node_plan
                    .shape_plan
                    .as_ref()
                    .map(stable_json_fingerprint)
                    .transpose()?,
                aggregation_policy_fingerprint: task
                    .node_plan
                    .shape_plan
                    .as_ref()
                    .map(|shape_plan| stable_json_fingerprint(&shape_plan.aggregation_policy))
                    .transpose()?,
                seed: task.seed,
                unsafe_flags: BTreeSet::new(),
                metrics: BTreeMap::new(),
                loss_attestations: Vec::new(),
                early_stopping_records: Vec::new(),
                target_domain: None,
            },
        })
    }
}

fn aligned_validation_samples(task: &NodeTask) -> Vec<SampleId> {
    match task.fold_id.as_ref().map(ToString::to_string).as_deref() {
        Some("fold:0") => vec![SampleId::new("s1").unwrap()],
        Some("fold:1") => vec![SampleId::new("s2").unwrap()],
        _ => vec![SampleId::new("s1").unwrap()],
    }
}

fn swapped_validation_samples(task: &NodeTask) -> Vec<SampleId> {
    match task.fold_id.as_ref().map(ToString::to_string).as_deref() {
        Some("fold:0") => vec![SampleId::new("s2").unwrap()],
        Some("fold:1") => vec![SampleId::new("s1").unwrap()],
        _ => vec![SampleId::new("s2").unwrap()],
    }
}

fn temp_prediction_cache_dir(label: &str) -> PathBuf {
    let suffix = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("system clock is after UNIX_EPOCH")
        .as_nanos();
    std::env::temp_dir().join(format!("{label}_{}_{}", std::process::id(), suffix))
}

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

fn controller_manifest(id: &str, kind: NodeKind) -> ControllerManifest {
    let mut capabilities = BTreeSet::from([
        ControllerCapability::Deterministic,
        ControllerCapability::ThreadSafe,
        ControllerCapability::ProcessSafe,
    ]);
    if kind == NodeKind::Model {
        capabilities.insert(ControllerCapability::EmitsPredictions);
        capabilities.insert(ControllerCapability::ConsumesOofPredictions);
        capabilities.insert(ControllerCapability::EmitsArtifacts);
        capabilities.insert(ControllerCapability::Stateful);
    }
    ControllerManifest {
        controller_id: ControllerId::new(id).unwrap(),
        controller_version: "0.1.0".to_string(),
        operator_kind: kind,
        priority: 0,
        supported_phases: BTreeSet::from([Phase::FitCv]),
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

fn aggregation_dispatch_plan(with_capability: bool) -> ExecutionPlan {
    let graph = GraphSpec {
        id: "graph:aggregation.dispatch".to_string(),
        interface: GraphInterface::default(),
        nodes: vec![node(
            "aggregate:custom",
            NodeKind::Aggregator,
            Vec::new(),
            Vec::new(),
        )],
        edges: Vec::new(),
        search_space_fingerprint: None,
        metadata: BTreeMap::new(),
    };
    let campaign = CampaignSpec {
        inner_cv: None,
        id: "campaign:aggregation.dispatch".to_string(),
        root_seed: Some(7),
        leakage_policy: Default::default(),
        aggregation_policy: Default::default(),
        split_invocation: None,
        generation: Default::default(),
        shape_plans: BTreeMap::new(),
        data_bindings: BTreeMap::new(),
        branch_view_plans: Vec::new(),
        metadata: BTreeMap::new(),
    };
    let mut manifest = controller_manifest("controller:agg.custom", NodeKind::Aggregator);
    if with_capability {
        manifest
            .capabilities
            .insert(ControllerCapability::AggregatesPredictions);
    }
    let mut registry = ControllerRegistry::new();
    registry.register(manifest).unwrap();
    build_execution_plan("plan:aggregation.dispatch", graph, campaign, &registry).unwrap()
}

fn observation_prediction_runtime_plan() -> ExecutionPlan {
    let model_id = NodeId::new("model:obs").unwrap();
    let graph = GraphSpec {
        id: "graph:observation.prediction.runtime".to_string(),
        interface: GraphInterface::default(),
        nodes: vec![
            node(
                model_id.as_str(),
                NodeKind::Model,
                vec![port("x", PortKind::Data)],
                vec![port("pred", PortKind::Prediction)],
            ),
            node(
                "aggregate:custom",
                NodeKind::Aggregator,
                Vec::new(),
                Vec::new(),
            ),
        ],
        edges: Vec::new(),
        search_space_fingerprint: None,
        metadata: BTreeMap::new(),
    };
    let mut shape_plans = BTreeMap::new();
    shape_plans.insert(
        model_id.clone(),
        DataModelShapePlan {
            node_id: model_id.clone(),
            input_granularity: Granularity::Observation,
            target_granularity: Granularity::Sample,
            fit_rows: FitBoundary::FoldTrain,
            predict_rows: FitBoundary::FoldValidation,
            feature_namespace: Some("nir".to_string()),
            feature_schema_fingerprint: None,
            target_space: "regression:y".to_string(),
            aggregation_policy: custom_aggregation_policy(PredictionLevel::Sample),
            augmentation_policy: Default::default(),
            selection_policy: Default::default(),
        },
    );
    let mut data_bindings = BTreeMap::new();
    data_bindings.insert(model_id.clone(), vec![data_binding(&model_id)]);
    let campaign = CampaignSpec {
        inner_cv: None,
        id: "campaign:observation.prediction.runtime".to_string(),
        root_seed: Some(17),
        leakage_policy: Default::default(),
        aggregation_policy: Default::default(),
        split_invocation: Some(SplitInvocation {
            id: "split:single".to_string(),
            controller_id: None,
            leakage_policy: Default::default(),
            params: BTreeMap::new(),
            fold_set: Some(FoldSet {
                id: "folds:single".to_string(),
                sample_ids: vec![
                    SampleId::new("sample:1").unwrap(),
                    SampleId::new("sample:2").unwrap(),
                ],
                folds: vec![
                    FoldAssignment {
                        fold_id: FoldId::new("fold:0").unwrap(),
                        train_sample_ids: vec![SampleId::new("sample:2").unwrap()],
                        validation_sample_ids: vec![SampleId::new("sample:1").unwrap()],
                        metadata: BTreeMap::new(),
                    },
                    FoldAssignment {
                        fold_id: FoldId::new("fold:1").unwrap(),
                        train_sample_ids: vec![SampleId::new("sample:1").unwrap()],
                        validation_sample_ids: vec![SampleId::new("sample:2").unwrap()],
                        metadata: BTreeMap::new(),
                    },
                ],
                sample_groups: BTreeMap::new(),
                partition_mode: FoldPartitionMode::Partition,
                train_exclusion: FoldTrainExclusion::Relations,
                target_missing_sample_ids: Vec::new(),
            }),
        }),
        generation: Default::default(),
        shape_plans,
        data_bindings,
        branch_view_plans: Vec::new(),
        metadata: BTreeMap::new(),
    };
    let mut model_manifest = controller_manifest("controller:model.obs", NodeKind::Model);
    model_manifest.supported_phases = BTreeSet::from([Phase::FitCv]);
    let mut agg_manifest = controller_manifest("controller:agg.custom", NodeKind::Aggregator);
    agg_manifest.supported_phases = BTreeSet::from([Phase::Plan]);
    agg_manifest.fit_scope = ControllerFitScope::InferenceOnly;
    agg_manifest
        .capabilities
        .insert(ControllerCapability::AggregatesPredictions);
    let mut registry = ControllerRegistry::new();
    registry.register(model_manifest).unwrap();
    registry.register(agg_manifest).unwrap();
    build_execution_plan(
        "plan:observation.prediction.runtime",
        graph,
        campaign,
        &registry,
    )
    .unwrap()
}

fn live_group_oof_runtime_plan() -> ExecutionPlan {
    let base_id = NodeId::new("model:base").unwrap();
    let graph = GraphSpec {
        id: "graph:live.group.oof".to_string(),
        interface: GraphInterface::default(),
        nodes: vec![
            node(
                "model:base",
                NodeKind::Model,
                vec![port("x", PortKind::Data)],
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
    };
    let aggregation_policy = AggregationPolicy {
        aggregation_level: PredictionLevel::Group,
        method: AggregationMethod::Mean,
        ..AggregationPolicy::default()
    };
    let shape_plan = DataModelShapePlan {
        node_id: base_id.clone(),
        input_granularity: Granularity::Observation,
        target_granularity: Granularity::Sample,
        fit_rows: FitBoundary::FoldTrain,
        predict_rows: FitBoundary::FoldValidation,
        feature_namespace: Some("nir".to_string()),
        feature_schema_fingerprint: None,
        target_space: "regression:y".to_string(),
        aggregation_policy,
        augmentation_policy: Default::default(),
        selection_policy: Default::default(),
    };
    let leakage_policy = LeakageUnitPolicy {
        split_unit: SplitUnit::Group,
        require_group_ids: true,
        ..LeakageUnitPolicy::default()
    };
    let campaign = CampaignSpec {
        inner_cv: None,
        id: "campaign:live.group.oof".to_string(),
        root_seed: Some(19),
        leakage_policy: leakage_policy.clone(),
        aggregation_policy: Default::default(),
        split_invocation: Some(SplitInvocation {
            id: "split:live.group.oof".to_string(),
            controller_id: None,
            leakage_policy,
            params: BTreeMap::new(),
            fold_set: Some(FoldSet {
                id: "folds:live.group.oof".to_string(),
                sample_ids: vec![
                    SampleId::new("sample:1").unwrap(),
                    SampleId::new("sample:2").unwrap(),
                ],
                folds: vec![
                    FoldAssignment {
                        fold_id: FoldId::new("fold:0").unwrap(),
                        train_sample_ids: vec![SampleId::new("sample:2").unwrap()],
                        validation_sample_ids: vec![SampleId::new("sample:1").unwrap()],
                        metadata: BTreeMap::new(),
                    },
                    FoldAssignment {
                        fold_id: FoldId::new("fold:1").unwrap(),
                        train_sample_ids: vec![SampleId::new("sample:1").unwrap()],
                        validation_sample_ids: vec![SampleId::new("sample:2").unwrap()],
                        metadata: BTreeMap::new(),
                    },
                ],
                sample_groups: BTreeMap::from([
                    (
                        SampleId::new("sample:1").unwrap(),
                        GroupId::new("plant.A").unwrap(),
                    ),
                    (
                        SampleId::new("sample:2").unwrap(),
                        GroupId::new("plant.B").unwrap(),
                    ),
                ]),
                partition_mode: FoldPartitionMode::Partition,
                train_exclusion: FoldTrainExclusion::Relations,
                target_missing_sample_ids: Vec::new(),
            }),
        }),
        generation: Default::default(),
        shape_plans: BTreeMap::from([(base_id.clone(), shape_plan)]),
        data_bindings: BTreeMap::from([(base_id.clone(), vec![data_binding(&base_id)])]),
        branch_view_plans: Vec::new(),
        metadata: BTreeMap::new(),
    };
    let mut manifest = controller_manifest("controller:model", NodeKind::Model);
    manifest.supported_phases = BTreeSet::from([Phase::FitCv, Phase::Refit]);
    let mut registry = ControllerRegistry::new();
    registry.register(manifest).unwrap();
    build_execution_plan("plan:live.group.oof", graph, campaign, &registry).unwrap()
}

fn custom_aggregation_policy(level: PredictionLevel) -> AggregationPolicy {
    AggregationPolicy {
        aggregation_level: level,
        method: AggregationMethod::CustomController,
        custom_controller: Some(AggregationControllerSpec {
            controller_id: ControllerId::new("controller:agg.custom").unwrap(),
            params: json!({"trim": 0.1}),
        }),
        ..AggregationPolicy::default()
    }
}

fn simple_graph() -> GraphSpec {
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

fn independent_parallel_graph() -> GraphSpec {
    GraphSpec {
        id: "g:parallel".to_string(),
        interface: GraphInterface::default(),
        nodes: vec![
            node(
                "transform:left",
                NodeKind::Transform,
                vec![],
                vec![port("x", PortKind::Data)],
            ),
            node(
                "transform:right",
                NodeKind::Transform,
                vec![],
                vec![port("x", PortKind::Data)],
            ),
        ],
        edges: Vec::new(),
        search_space_fingerprint: None,
        metadata: BTreeMap::new(),
    }
}

fn parallel_stress_graph() -> GraphSpec {
    const WIDTH: usize = 6;

    let mut nodes = Vec::new();
    let mut edges = Vec::new();
    let mut merge_inputs = Vec::new();
    for idx in 0..WIDTH {
        let transform_id = format!("transform:stress.{idx}");
        let model_id = format!("model:stress.{idx}");
        let merge_port = format!("pred{idx}");
        nodes.push(node(
            &transform_id,
            NodeKind::Transform,
            vec![],
            vec![port("x", PortKind::Data)],
        ));
        nodes.push(node(
            &model_id,
            NodeKind::Model,
            vec![port("x", PortKind::Data)],
            vec![port("pred", PortKind::Prediction)],
        ));
        merge_inputs.push(port(&merge_port, PortKind::Prediction));
        edges.push(EdgeSpec {
            source: PortRef {
                node_id: NodeId::new(transform_id).unwrap(),
                port_name: "x".to_string(),
            },
            target: PortRef {
                node_id: NodeId::new(&model_id).unwrap(),
                port_name: "x".to_string(),
            },
            contract: EdgeContract {
                requires_oof: false,
                requires_fold_alignment: false,
                ..EdgeContract::new(PortKind::Data, None)
            },
        });
        edges.push(EdgeSpec {
            source: PortRef {
                node_id: NodeId::new(model_id).unwrap(),
                port_name: "pred".to_string(),
            },
            target: PortRef {
                node_id: NodeId::new("merge:stress").unwrap(),
                port_name: merge_port,
            },
            contract: EdgeContract {
                requires_oof: false,
                requires_fold_alignment: true,
                ..EdgeContract::new(PortKind::Prediction, None)
            },
        });
    }
    nodes.push(node(
        "merge:stress",
        NodeKind::MixedJoin,
        merge_inputs,
        vec![port("merged", PortKind::Data)],
    ));

    GraphSpec {
        id: "g:parallel.stress".to_string(),
        interface: GraphInterface::default(),
        nodes,
        edges,
        search_space_fingerprint: None,
        metadata: BTreeMap::new(),
    }
}

fn oof_edge_graph() -> GraphSpec {
    GraphSpec {
        id: "g:oof.edge".to_string(),
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

fn oof_edge_graph_with_auxiliary_port() -> GraphSpec {
    let mut graph = oof_edge_graph();
    graph.id = "g:oof.edge.auxiliary".to_string();
    let base = graph
        .nodes
        .iter_mut()
        .find(|node| node.id.as_str() == "model:base")
        .expect("base node exists");
    base.ports.outputs.push(port("aux", PortKind::Artifact));
    let meta = graph
        .nodes
        .iter_mut()
        .find(|node| node.id.as_str() == "model:meta")
        .expect("meta node exists");
    meta.ports.inputs.push(port("aux", PortKind::Artifact));
    graph.edges.push(EdgeSpec {
        source: PortRef {
            node_id: NodeId::new("model:base").unwrap(),
            port_name: "aux".to_string(),
        },
        target: PortRef {
            node_id: NodeId::new("model:meta").unwrap(),
            port_name: "aux".to_string(),
        },
        contract: EdgeContract::new(PortKind::Artifact, None),
    });
    graph
}

fn oof_edge_graph_with_ambiguous_prediction_port() -> GraphSpec {
    let mut graph = oof_edge_graph();
    graph.id = "g:oof.edge.ambiguous.prediction.port".to_string();
    let base = graph
        .nodes
        .iter_mut()
        .find(|node| node.id.as_str() == "model:base")
        .expect("base node exists");
    base.ports.outputs.push(port("aux", PortKind::Prediction));
    let meta = graph
        .nodes
        .iter_mut()
        .find(|node| node.id.as_str() == "model:meta")
        .expect("meta node exists");
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
        contract: EdgeContract {
            requires_oof: true,
            requires_fold_alignment: true,
            ..EdgeContract::new(PortKind::Prediction, None)
        },
    });
    graph
}

fn oof_edge_graph_with_refit_policy(policy: &str) -> GraphSpec {
    let mut graph = oof_edge_graph();
    graph.id = format!("g:oof.edge.{policy}");
    let meta = graph
        .nodes
        .iter_mut()
        .find(|node| node.id.as_str() == "model:meta")
        .expect("meta node exists");
    meta.metadata.insert(
        STACKING_OOF_REFIT_CONTRACT_METADATA_KEY.to_string(),
        json!({ "policy": policy }),
    );
    graph
}

fn runtime_controllers() -> RuntimeControllerRegistry {
    let mut controllers = RuntimeControllerRegistry::new();
    controllers
        .register(Box::new(MockController {
            id: ControllerId::new("controller:transform").unwrap(),
            handle: 1,
            emit_prediction: false,
        }))
        .unwrap();
    controllers
        .register(Box::new(MockController {
            id: ControllerId::new("controller:model").unwrap(),
            handle: 2,
            emit_prediction: true,
        }))
        .unwrap();
    controllers
}

fn oof_edge_runtime_controllers(
    base_partition: Option<PredictionPartition>,
    sample_mode: OofSampleMode,
) -> RuntimeControllerRegistry {
    let mut controllers = RuntimeControllerRegistry::new();
    controllers
        .register(Box::new(OofEdgeController {
            id: ControllerId::new("controller:model").unwrap(),
            base_partition,
            sample_mode,
        }))
        .unwrap();
    controllers
}

fn expected_refit_oof_runtime_controllers(
    expected_fold_ids: Vec<FoldId>,
    expected_sample_ids: Vec<SampleId>,
    expected_target_names: Vec<String>,
) -> RuntimeControllerRegistry {
    let mut controllers = RuntimeControllerRegistry::new();
    controllers
        .register(Box::new(ExpectedRefitOofController {
            id: ControllerId::new("controller:model").unwrap(),
            expected_fold_ids,
            expected_sample_ids,
            expected_target_names,
        }))
        .unwrap();
    controllers
}

fn replay_runtime_controllers() -> RuntimeControllerRegistry {
    let mut controllers = RuntimeControllerRegistry::new();
    controllers
        .register(Box::new(ReplayMockController {
            id: ControllerId::new("controller:transform.mock").unwrap(),
            handle: 11,
            require_artifact: false,
            emit_prediction: false,
            emit_refit_artifact: false,
        }))
        .unwrap();
    controllers
        .register(Box::new(ReplayMockController {
            id: ControllerId::new("controller:model.mock").unwrap(),
            handle: 22,
            require_artifact: true,
            emit_prediction: true,
            emit_refit_artifact: false,
        }))
        .unwrap();
    controllers
}

fn two_fold_set() -> FoldSet {
    FoldSet {
        id: "outer".to_string(),
        sample_ids: vec![SampleId::new("s1").unwrap(), SampleId::new("s2").unwrap()],
        folds: vec![
            FoldAssignment {
                fold_id: FoldId::new("fold:0").unwrap(),
                train_sample_ids: vec![SampleId::new("s2").unwrap()],
                validation_sample_ids: vec![SampleId::new("s1").unwrap()],
                metadata: BTreeMap::new(),
            },
            FoldAssignment {
                fold_id: FoldId::new("fold:1").unwrap(),
                train_sample_ids: vec![SampleId::new("s1").unwrap()],
                validation_sample_ids: vec![SampleId::new("s2").unwrap()],
                metadata: BTreeMap::new(),
            },
        ],
        sample_groups: BTreeMap::new(),
        partition_mode: FoldPartitionMode::Partition,
        train_exclusion: FoldTrainExclusion::Relations,
        target_missing_sample_ids: Vec::new(),
    }
}

fn three_fold_stress_set() -> FoldSet {
    let samples = (0..6)
        .map(|idx| SampleId::new(format!("s{idx}")).unwrap())
        .collect::<Vec<_>>();
    let folds = (0..3)
        .map(|fold_idx| {
            let validation_sample_ids = samples
                .iter()
                .enumerate()
                .filter_map(|(idx, sample_id)| (idx % 3 == fold_idx).then_some(sample_id.clone()))
                .collect::<Vec<_>>();
            let train_sample_ids = samples
                .iter()
                .filter(|sample_id| !validation_sample_ids.contains(sample_id))
                .cloned()
                .collect::<Vec<_>>();
            FoldAssignment {
                fold_id: FoldId::new(format!("fold:{fold_idx}")).unwrap(),
                train_sample_ids,
                validation_sample_ids,
                metadata: BTreeMap::new(),
            }
        })
        .collect::<Vec<_>>();
    FoldSet {
        id: "outer:stress".to_string(),
        sample_ids: samples,
        folds,
        sample_groups: BTreeMap::new(),
        partition_mode: FoldPartitionMode::Partition,
        train_exclusion: FoldTrainExclusion::Relations,
        target_missing_sample_ids: Vec::new(),
    }
}

fn grouped_repetition_fold_set() -> FoldSet {
    let s1 = SampleId::new("s1").unwrap();
    let s1_rep = SampleId::new("s1_rep").unwrap();
    let s2 = SampleId::new("s2").unwrap();
    let s3 = SampleId::new("s3").unwrap();
    FoldSet {
        id: "outer:grouped-repetition".to_string(),
        sample_ids: vec![s1.clone(), s1_rep.clone(), s2.clone(), s3.clone()],
        folds: vec![
            FoldAssignment {
                fold_id: FoldId::new("fold:0").unwrap(),
                train_sample_ids: vec![s2.clone(), s3.clone()],
                validation_sample_ids: vec![s1.clone(), s1_rep.clone()],
                metadata: BTreeMap::new(),
            },
            FoldAssignment {
                fold_id: FoldId::new("fold:1").unwrap(),
                train_sample_ids: vec![s1.clone(), s1_rep.clone(), s3.clone()],
                validation_sample_ids: vec![s2.clone()],
                metadata: BTreeMap::new(),
            },
            FoldAssignment {
                fold_id: FoldId::new("fold:2").unwrap(),
                train_sample_ids: vec![s1.clone(), s1_rep.clone(), s2.clone()],
                validation_sample_ids: vec![s3.clone()],
                metadata: BTreeMap::new(),
            },
        ],
        sample_groups: BTreeMap::from([
            (s1, GroupId::new("group:product1").unwrap()),
            (s1_rep, GroupId::new("group:product1").unwrap()),
            (s2, GroupId::new("group:product2").unwrap()),
            (s3, GroupId::new("group:product3").unwrap()),
        ]),
        partition_mode: FoldPartitionMode::Partition,
        train_exclusion: FoldTrainExclusion::Relations,
        target_missing_sample_ids: Vec::new(),
    }
}

fn grouped_leakage_policy() -> LeakageUnitPolicy {
    LeakageUnitPolicy {
        split_unit: SplitUnit::Group,
        require_group_ids: true,
        ..LeakageUnitPolicy::default()
    }
}

fn sample_relation(
    observation_id: &str,
    sample_id: &str,
    target_id: &str,
    group_id: &str,
    origin_sample_id: Option<&str>,
    is_augmented: bool,
) -> SampleRelation {
    let mut relation = SampleRelation::new(
        ObservationId::new(observation_id).unwrap(),
        SampleId::new(sample_id).unwrap(),
    );
    relation.target_id = Some(TargetId::new(target_id).unwrap());
    relation.group_id = Some(GroupId::new(group_id).unwrap());
    relation.origin_sample_id = origin_sample_id.map(|value| SampleId::new(value).unwrap());
    relation.source_id = Some("nir".to_string());
    relation.is_augmented = is_augmented;
    relation
}

fn grouped_repetition_relations() -> SampleRelationSet {
    SampleRelationSet {
        records: vec![
            sample_relation(
                "obs:s1:a",
                "s1",
                "target:product1",
                "group:product1",
                None,
                false,
            ),
            sample_relation(
                "obs:s1:b",
                "s1",
                "target:product1",
                "group:product1",
                None,
                false,
            ),
            sample_relation(
                "obs:s1:aug0",
                "s1",
                "target:product1",
                "group:product1",
                Some("s1"),
                true,
            ),
            sample_relation(
                "obs:s1rep:a",
                "s1_rep",
                "target:product1",
                "group:product1",
                None,
                false,
            ),
            sample_relation(
                "obs:s2:a",
                "s2",
                "target:product2",
                "group:product2",
                None,
                false,
            ),
            sample_relation(
                "obs:s2:b",
                "s2",
                "target:product2",
                "group:product2",
                None,
                false,
            ),
            sample_relation(
                "obs:s3:a",
                "s3",
                "target:product3",
                "group:product3",
                None,
                false,
            ),
        ],
    }
}

fn grouped_oof_campaign(fold_set: FoldSet) -> CampaignSpec {
    let leakage_policy = grouped_leakage_policy();
    CampaignSpec {
        inner_cv: None,
        id: "campaign:oof.grouped-repetition".to_string(),
        root_seed: Some(11),
        leakage_policy: leakage_policy.clone(),
        aggregation_policy: AggregationPolicy::default(),
        split_invocation: Some(SplitInvocation {
            id: "split:outer.grouped-repetition".to_string(),
            controller_id: None,
            leakage_policy,
            params: BTreeMap::new(),
            fold_set: Some(fold_set),
        }),
        generation: Default::default(),
        shape_plans: BTreeMap::new(),
        data_bindings: BTreeMap::new(),
        branch_view_plans: Vec::new(),
        metadata: BTreeMap::new(),
    }
}

fn data_binding(node_id: &NodeId) -> crate::data::DataBinding {
    crate::data::DataBinding {
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

fn oof_edge_campaign() -> CampaignSpec {
    CampaignSpec {
        inner_cv: None,
        id: "campaign:oof.edge".to_string(),
        root_seed: Some(11),
        leakage_policy: Default::default(),
        aggregation_policy: Default::default(),
        split_invocation: Some(SplitInvocation {
            id: "split:outer".to_string(),
            controller_id: None,
            leakage_policy: Default::default(),
            params: BTreeMap::new(),
            fold_set: Some(two_fold_set()),
        }),
        generation: Default::default(),
        shape_plans: BTreeMap::new(),
        data_bindings: BTreeMap::new(),
        branch_view_plans: Vec::new(),
        metadata: BTreeMap::new(),
    }
}

fn parallel_stress_campaign() -> CampaignSpec {
    CampaignSpec {
        inner_cv: None,
        id: "campaign:parallel.stress".to_string(),
        root_seed: Some(31),
        leakage_policy: Default::default(),
        aggregation_policy: Default::default(),
        split_invocation: Some(SplitInvocation {
            id: "split:parallel.stress".to_string(),
            controller_id: None,
            leakage_policy: Default::default(),
            params: BTreeMap::new(),
            fold_set: Some(three_fold_stress_set()),
        }),
        generation: GenerationSpec {
            strategy: GenerationStrategy::Cartesian,
            dimensions: vec![GenerationDimension {
                name: "model_family".to_string(),
                choices: ["linear", "tree", "kernel"]
                    .into_iter()
                    .enumerate()
                    .map(|(rank, label)| GenerationChoice {
                        label: label.to_string(),
                        value: json!(label),
                        param_overrides: (0..6)
                            .map(|idx| crate::generation::GenerationParamOverride {
                                node_id: NodeId::new(format!("model:stress.{idx}")).unwrap(),
                                params: BTreeMap::from([
                                    ("family".to_string(), json!(label)),
                                    ("variant_rank".to_string(), json!(rank)),
                                ]),
                            })
                            .collect(),
                        active_subsequence: None,
                    })
                    .collect(),
            }],
            max_variants: Some(3),
            constraints: GenerationConstraints::default(),
        },
        shape_plans: BTreeMap::new(),
        data_bindings: BTreeMap::new(),
        branch_view_plans: Vec::new(),
        metadata: BTreeMap::new(),
    }
}

fn parallel_stress_manifests() -> crate::controller::ControllerRegistry {
    let mut registry = manifests();
    let mut mixed_join = controller_manifest("controller:mixed_join", NodeKind::MixedJoin);
    mixed_join.fit_scope = ControllerFitScope::Stateless;
    registry.register(mixed_join).unwrap();
    registry
}

fn manifests() -> crate::controller::ControllerRegistry {
    let mut manifests = crate::controller::ControllerRegistry::new();
    manifests
        .register(controller_manifest(
            "controller:transform",
            NodeKind::Transform,
        ))
        .unwrap();
    manifests
        .register(controller_manifest("controller:model", NodeKind::Model))
        .unwrap();
    manifests
}

fn oof_edge_manifests(phases: BTreeSet<Phase>) -> crate::controller::ControllerRegistry {
    let mut manifest = controller_manifest("controller:model", NodeKind::Model);
    manifest.supported_phases = phases;
    let mut manifests = crate::controller::ControllerRegistry::new();
    manifests.register(manifest).unwrap();
    manifests
}

fn fixture_plan(plan_id: &str) -> ExecutionPlan {
    let graph: GraphSpec = serde_json::from_str(include_str!(
        "../../tests/fixtures/package/minimal_graph.json"
    ))
    .unwrap();
    let campaign: CampaignSpec = serde_json::from_str(include_str!(
        "../../tests/fixtures/package/campaign_oof_generation.json"
    ))
    .unwrap();
    let manifests: Vec<ControllerManifest> = serde_json::from_str(include_str!(
        "../../tests/fixtures/package/controller_manifests.json"
    ))
    .unwrap();
    let mut registry = ControllerRegistry::new();
    for manifest in manifests {
        registry.register(manifest).unwrap();
    }
    build_execution_plan(plan_id, graph, campaign, &registry).unwrap()
}

#[test]
fn stacking_probability_selector_reduces_inner_and_outer_inputs_by_identity() {
    let mut plan = fixture_plan("plan:branch-proba");
    let first = NodeId::new("model:base").unwrap();
    let second = NodeId::new("model:second").unwrap();
    let meta = NodeId::new("model:meta").unwrap();
    let base_node = plan
        .graph_plan
        .graph
        .nodes
        .iter_mut()
        .find(|node| node.id == first)
        .unwrap();
    base_node
        .metadata
        .insert("dsl_branch".to_string(), json!("branch_0"));
    let mut second_node = base_node.clone();
    second_node.id = second.clone();
    let mut meta_node = base_node.clone();
    meta_node.id = meta.clone();
    meta_node.metadata.remove("dsl_branch");
    meta_node
        .metadata
        .insert("merge_mode".to_string(), json!("predictions"));
    meta_node.metadata.insert(
        "selectors".to_string(),
        json!([
            {"branch": "branch_0", "select": "all", "aggregate": "proba_mean"}
        ]),
    );
    plan.graph_plan.graph.nodes.extend([second_node, meta_node]);
    let mut meta_plan = plan.node_plans[&first].clone();
    meta_plan.node_id = meta.clone();

    let input = |producer: NodeId, sample_ids: &[&str], values: &[[f64; 2]]| PredictionInputSpec {
        producer_node: producer,
        source_port: "oof".to_string(),
        target_port: "oof".to_string(),
        partition: PredictionPartition::Validation,
        prediction_level: PredictionLevel::Sample,
        fold_id: None,
        fold_ids: vec![FoldId::new("fold:0").unwrap()],
        unit_ids: sample_ids
            .iter()
            .map(|id| PredictionUnitId::Sample(SampleId::new(*id).unwrap()))
            .collect(),
        sample_ids: sample_ids
            .iter()
            .map(|id| SampleId::new(*id).unwrap())
            .collect(),
        values: values.iter().map(|row| row.to_vec()).collect(),
        feature_validity_masks: None,
        source_presence: None,
        prediction_width: 2,
        target_names: vec!["0".to_string(), "1".to_string()],
    };
    let mut inputs = BTreeMap::new();
    for suffix in ["", ":outer"] {
        inputs.insert(
            format!("{first}.oof{suffix}"),
            input(first.clone(), &["s1", "s2"], &[[0.2, 0.8], [0.7, 0.3]]),
        );
        inputs.insert(
            format!("{second}.oof{suffix}"),
            input(second.clone(), &["s2", "s1"], &[[0.5, 0.5], [0.6, 0.4]]),
        );
    }
    apply_stacking_prediction_aggregations(&plan, &meta_plan, &mut inputs, &[], None, None)
        .unwrap();
    assert_eq!(inputs.len(), 2);
    for suffix in ["", ":outer"] {
        let spec = &inputs[&format!("model:meta.branch.branch_0.oof{suffix}")];
        assert_eq!(
            spec.sample_ids,
            vec![SampleId::new("s1").unwrap(), SampleId::new("s2").unwrap()]
        );
        for (actual, expected) in spec.values.iter().zip([[0.4, 0.6], [0.6, 0.4]]) {
            for (actual, expected) in actual.iter().zip(expected) {
                assert!((actual - expected).abs() < 1e-12);
            }
        }
    }
}

#[test]
fn stacking_best_selector_uses_validation_score_before_meta_fit() {
    let mut plan = fixture_plan("plan:stacking.best");
    let first = NodeId::new("model:base").unwrap();
    let second = NodeId::new("model:second").unwrap();
    let meta = NodeId::new("model:meta").unwrap();
    let base_node = plan
        .graph_plan
        .graph
        .nodes
        .iter_mut()
        .find(|node| node.id == first)
        .unwrap();
    base_node
        .metadata
        .insert("dsl_branch".to_string(), json!("branch_0"));
    let mut second_node = base_node.clone();
    second_node.id = second.clone();
    let mut meta_node = base_node.clone();
    meta_node.id = meta.clone();
    meta_node.metadata.remove("dsl_branch");
    meta_node
        .metadata
        .insert("merge_mode".to_string(), json!("predictions"));
    meta_node.metadata.insert(
        "selectors".to_string(),
        json!([{"branch": "branch_0", "select": "best", "metric": "rmse"}]),
    );
    plan.graph_plan.graph.nodes.extend([second_node, meta_node]);
    let mut meta_plan = plan.node_plans[&first].clone();
    meta_plan.node_id = meta;
    let input = |producer: NodeId, value: f64| PredictionInputSpec {
        producer_node: producer,
        source_port: "oof".to_string(),
        target_port: "oof".to_string(),
        partition: PredictionPartition::Validation,
        prediction_level: PredictionLevel::Sample,
        fold_id: Some(FoldId::new("fold:0").unwrap()),
        fold_ids: vec![FoldId::new("fold:0").unwrap()],
        unit_ids: vec![PredictionUnitId::Sample(SampleId::new("s1").unwrap())],
        sample_ids: vec![SampleId::new("s1").unwrap()],
        values: vec![vec![value]],
        feature_validity_masks: None,
        source_presence: None,
        prediction_width: 1,
        target_names: vec!["y".to_string()],
    };
    let mut inputs = BTreeMap::from([
        (format!("{first}.oof"), input(first.clone(), 1.0)),
        (format!("{second}.oof"), input(second.clone(), 2.0)),
    ]);
    let report = |producer_node, rmse| crate::metrics::RegressionMetricReport {
        target_domain: None,
        grouping_key: None,
        prediction_id: None,
        producer_node,
        producer_port: None,
        variant_id: None,
        variant_label: None,
        partition: PredictionPartition::Validation,
        fold_id: Some(FoldId::new("fold:0").unwrap()),
        level: PredictionLevel::Sample,
        row_count: 1,
        target_width: 1,
        target_names: vec!["y".to_string()],
        metrics: BTreeMap::from([("rmse".to_string(), rmse)]),
    };
    apply_stacking_prediction_aggregations(
        &plan,
        &meta_plan,
        &mut inputs,
        &[report(first, 4.0), report(second.clone(), 2.0)],
        None,
        None,
    )
    .unwrap();
    assert_eq!(inputs.len(), 1);
    assert_eq!(inputs.values().next().unwrap().producer_node, second);
}

#[test]
fn stacking_fold_candidate_top_k_uses_only_inner_validation_scores() {
    let mut plan = fixture_plan("plan:stacking.fold-candidates");
    let first = NodeId::new("model:base").unwrap();
    let second = NodeId::new("model:second").unwrap();
    let meta = NodeId::new("model:meta").unwrap();
    let base_node = plan
        .graph_plan
        .graph
        .nodes
        .iter()
        .find(|node| node.id == first)
        .unwrap()
        .clone();
    let mut second_node = base_node.clone();
    second_node.id = second.clone();
    let mut meta_node = base_node;
    meta_node.id = meta.clone();
    meta_node
        .metadata
        .insert("merge_mode".to_string(), json!("predictions"));
    meta_node.metadata.insert(
        "selectors".to_string(),
        json!([{
            "select": {"fold_candidates_top_k": 1}, "metric": "rmse"
        }]),
    );
    plan.graph_plan.graph.nodes.extend([second_node, meta_node]);
    let mut meta_plan = plan.node_plans[&first].clone();
    meta_plan.node_id = meta;
    let input = |producer_node: NodeId| PredictionInputSpec {
        producer_node,
        source_port: "oof".to_string(),
        target_port: "oof".to_string(),
        partition: PredictionPartition::Validation,
        prediction_level: PredictionLevel::Sample,
        fold_id: None,
        fold_ids: vec![FoldId::new("fold:inner").unwrap()],
        unit_ids: vec![PredictionUnitId::Sample(SampleId::new("s1").unwrap())],
        sample_ids: vec![SampleId::new("s1").unwrap()],
        values: vec![vec![1.0]],
        feature_validity_masks: None,
        source_presence: None,
        prediction_width: 1,
        target_names: vec!["y".to_string()],
    };
    let report = |producer_node, fold, rmse| crate::metrics::RegressionMetricReport {
        target_domain: None,
        grouping_key: None,
        prediction_id: None,
        producer_node,
        producer_port: None,
        variant_id: None,
        variant_label: None,
        partition: PredictionPartition::Validation,
        fold_id: Some(FoldId::new(fold).unwrap()),
        level: PredictionLevel::Sample,
        row_count: 1,
        target_width: 1,
        target_names: vec!["y".to_string()],
        metrics: BTreeMap::from([("rmse".to_string(), rmse)]),
    };
    let reports = [
        report(second.clone(), "fold:outer", 0.001),
        report(first.clone(), "fold:inner", 0.2),
        report(second.clone(), "fold:inner", 0.4),
    ];
    let allowed = BTreeSet::from([FoldId::new("fold:inner").unwrap()]);
    let mut inputs = BTreeMap::from([
        (format!("{first}.oof"), input(first.clone())),
        (format!("{second}.oof"), input(second.clone())),
    ]);
    apply_stacking_prediction_aggregations(
        &plan,
        &meta_plan,
        &mut inputs,
        &reports,
        Some(&allowed),
        None,
    )
    .unwrap();
    assert_eq!(inputs.len(), 1);
    assert_eq!(inputs.values().next().unwrap().producer_node, first);
}

#[test]
fn stacking_diverse_fold_candidates_are_ranked_per_operator_class() {
    let report = |producer_node: &str, fold_id: &str, rmse: f64| {
        json!({
            "producer_node": producer_node,
            "partition": "validation",
            "fold_id": fold_id,
            "level": "sample",
            "row_count": 1,
            "target_width": 1,
            "metrics": {"rmse": rmse},
        })
    };
    let mut request: StackingProducerSelectionRequest = serde_json::from_value(json!({
        "producer_nodes": ["model:ridge1", "model:ridge2", "model:pls"],
        "select": {"diverse_fold_candidates": {
            "max_per_class": 1,
            "preferred_classes": ["Ridge"],
        }},
        "metric": "rmse",
        "fold_ids": ["fold:inner"],
        "producer_classes": {
            "model:ridge1": "Ridge",
            "model:ridge2": "Ridge",
            "model:pls": "PLSRegression",
        },
        "reports": [
            report("model:ridge1", "fold:inner", 0.4),
            report("model:ridge2", "fold:inner", 0.2),
            report("model:pls", "fold:inner", 0.5),
            report("model:ridge1", "fold:outer", 0.001),
        ],
    }))
    .unwrap();
    assert_eq!(
        request.selected_producer_nodes().unwrap(),
        vec![
            NodeId::new("model:ridge2").unwrap(),
            NodeId::new("model:pls").unwrap(),
        ]
    );
    request.select["diverse_fold_candidates"]["ascending"] = json!(false);
    assert_eq!(
        request.selected_producer_nodes().unwrap(),
        vec![
            NodeId::new("model:ridge1").unwrap(),
            NodeId::new("model:pls").unwrap()
        ]
    );
}

#[test]
fn stacking_selection_ignores_test_scores_and_rejects_duplicate_producers() {
    let mut request: StackingProducerSelectionRequest = serde_json::from_value(json!({
        "producer_nodes": ["model:a", "model:b"], "select": "best", "metric": "rmse",
        "reports": [{"producer_node": "model:b", "partition": "test", "fold_id": "fold:0",
            "level": "sample", "row_count": 1, "target_width": 1, "metrics": {"rmse": 0.01}}]
    }))
    .unwrap();
    assert_eq!(
        request.selected_producer_nodes().unwrap(),
        vec![NodeId::new("model:a").unwrap()]
    );
    request.producer_nodes.push(NodeId::new("model:a").unwrap());
    assert!(request
        .selected_producer_nodes()
        .unwrap_err()
        .to_string()
        .contains("distinct producer"));
}

#[test]
fn stacking_selection_accepts_only_explicit_producers_in_scope() {
    let mut request: StackingProducerSelectionRequest = serde_json::from_value(json!({
        "producer_nodes": ["model:a", "model:b", "model:c"],
        "select": {"models": ["model:c", "model:a"]}, "metric": "rmse",
        "reports": []
    }))
    .unwrap();
    assert_eq!(
        request.selected_producer_nodes().unwrap(),
        vec![
            NodeId::new("model:c").unwrap(),
            NodeId::new("model:a").unwrap()
        ]
    );
    request.select = json!({"models": ["model:other"]});
    assert!(request.selected_producer_nodes().is_err());
    request.select = json!({"models": ["model:a", "model:a"]});
    assert!(request.selected_producer_nodes().is_err());
}

#[test]
fn stacking_best_fold_uses_validation_score_only_and_stable_ties() {
    let mut request: StackingFoldSelectionRequest = serde_json::from_value(json!({
        "producer_node": "model:base", "fold_ids": ["fold:0", "fold:1", "fold:2"],
        "metric": "rmse",
        "reports": [
            {"producer_node": "model:base", "partition": "test", "fold_id": "fold:0",
             "level": "sample", "row_count": 1, "target_width": 1,
             "metrics": {"rmse": 0.001}},
            {"producer_node": "model:base", "partition": "validation", "fold_id": "fold:0",
             "level": "sample", "row_count": 1, "target_width": 1,
             "metrics": {"rmse": 4.0}},
            {"producer_node": "model:base", "partition": "validation", "fold_id": "fold:1",
             "level": "sample", "row_count": 1, "target_width": 1,
             "metrics": {"rmse": 2.0}},
            {"producer_node": "model:base", "partition": "validation", "fold_id": "fold:2",
             "level": "sample", "row_count": 1, "target_width": 1,
             "metrics": {"rmse": 2.0}}
        ]
    }))
    .unwrap();
    assert_eq!(request.selected_fold_id().unwrap().as_str(), "fold:1");
    let weights = request.normalized_weights().unwrap();
    assert!(weights[1] > weights[0]);
    assert_eq!(weights[1], weights[2]);
    assert!((weights.iter().sum::<f64>() - 1.0).abs() < 1e-12);
    request.metric = "r2".to_string();
    assert_eq!(request.selected_fold_id().unwrap().as_str(), "fold:0");
    request.fold_ids.push(FoldId::new("fold:0").unwrap());
    assert!(request
        .selected_fold_id()
        .unwrap_err()
        .to_string()
        .contains("distinct fold ids"));
}

fn replay_bundle(plan: &ExecutionPlan) -> crate::bundle::ExecutionBundle {
    let model_plan = plan
        .node_plans
        .get(&NodeId::new("model:base").unwrap())
        .unwrap();
    build_execution_bundle(
        crate::ids::BundleId::new("bundle:replay").unwrap(),
        plan,
        Some(plan.variants[0].variant_id.clone()),
        BTreeMap::new(),
        vec![RefitArtifactRecord {
            node_id: model_plan.node_id.clone(),
            controller_id: model_plan.controller_id.clone(),
            artifact: ArtifactRef {
                id: ArtifactId::new("artifact:model:base:refit").unwrap(),
                kind: "mock_model".to_string(),
                controller_id: model_plan.controller_id.clone(),
                backend: None,
                uri: None,
                content_fingerprint: None,
                size_bytes: Some(128),
                plugin: None,
                plugin_version: None,
                abi_major: None,
                abi_min_minor: None,
                native_predictor_descriptor: None,
                native_estimator_descriptor: None,
            },
            params_fingerprint: model_plan.params_fingerprint.clone(),
            training_loss_fingerprint: model_plan.training_loss_fingerprint(Phase::Refit).unwrap(),
            data_requirement_keys: vec!["model:base.x".to_string()],
            prediction_requirement_keys: Vec::new(),
        }],
    )
    .unwrap()
}

fn replay_request(bundle: &crate::bundle::ExecutionBundle, phase: Phase) -> ReplayPhaseRequest {
    ReplayPhaseRequest {
        bundle_id: bundle.bundle_id.clone(),
        phase,
        data_envelope_keys: vec!["model:base.x".to_string()],
    }
}

fn replay_envelopes() -> BTreeMap<String, ExternalDataPlanEnvelope> {
    BTreeMap::from([(
        "model:base.x".to_string(),
        serde_json::from_str(include_str!(
            "../../tests/fixtures/package/data/coordinator_data_plan_envelope_sample12.json"
        ))
        .unwrap(),
    )])
}

fn replay_data_provider() -> InMemoryDataProvider {
    InMemoryDataProvider::with_envelope(
        ControllerId::new("controller:data.provider").unwrap(),
        replay_envelopes().remove("model:base.x").unwrap(),
    )
    .unwrap()
}

fn replay_artifact_store(bundle: &crate::bundle::ExecutionBundle) -> InMemoryArtifactStore {
    let mut store = InMemoryArtifactStore::new();
    let artifact = &bundle.refit_artifacts[0];
    store
        .register(
            artifact,
            HandleRef {
                handle: 9001,
                kind: HandleKind::Model,
                owner_controller: artifact.controller_id.clone(),
            },
        )
        .unwrap();
    store
}

#[test]
fn sequential_scheduler_invokes_mock_controllers_in_topological_order() {
    let plan = build_execution_plan(
        "plan:fitcv",
        simple_graph(),
        CampaignSpec {
            inner_cv: None,
            id: "campaign:fitcv".to_string(),
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
        &manifests(),
    )
    .unwrap();
    let controllers = runtime_controllers();
    let mut ctx = RunContext::new(RunId::new("run:1").unwrap(), Some(11));

    let results = SequentialScheduler
        .execute_phase(&plan, &controllers, &mut ctx, Phase::FitCv)
        .unwrap();

    assert_eq!(results.len(), 2);
    assert_eq!(ctx.lineage.len(), 2);
    assert_eq!(ctx.prediction_store.blocks().len(), 1);
    assert_eq!(results[1].node_id.as_str(), "model:pls");
    let transform_lineage = ctx
        .lineage
        .records()
        .find(|record| record.node_id.as_str() == "transform:snv")
        .expect("transform lineage exists");
    let model_lineage = ctx
        .lineage
        .records()
        .find(|record| record.node_id.as_str() == "model:pls")
        .expect("model lineage exists");
    assert_eq!(
        model_lineage.input_lineage,
        vec![transform_lineage.record_id.clone()]
    );
}

#[test]
fn parallel_scheduler_invokes_independent_level_concurrently() {
    struct ConcurrencyProbeController {
        id: ControllerId,
        active: Arc<AtomicUsize>,
        max_active: Arc<AtomicUsize>,
    }

    impl RuntimeController for ConcurrencyProbeController {
        fn controller_id(&self) -> &ControllerId {
            &self.id
        }

        fn invoke(&self, task: &NodeTask) -> Result<NodeResult> {
            let active = self.active.fetch_add(1, Ordering::SeqCst) + 1;
            let mut observed = self.max_active.load(Ordering::SeqCst);
            while active > observed
                && self
                    .max_active
                    .compare_exchange(observed, active, Ordering::SeqCst, Ordering::SeqCst)
                    .is_err()
            {
                observed = self.max_active.load(Ordering::SeqCst);
            }
            std::thread::sleep(std::time::Duration::from_millis(50));
            self.active.fetch_sub(1, Ordering::SeqCst);
            Ok(NodeResult {
                schema_version: None,
                classification_probabilities: Vec::new(),
                consumed_data_views: std::collections::BTreeMap::new(),
                node_id: task.node_plan.node_id.clone(),
                outputs: BTreeMap::from([(
                    "x".to_string(),
                    HandleRef {
                        handle: task.node_plan.node_id.as_str().len() as u64,
                        kind: HandleKind::Data,
                        owner_controller: self.id.clone(),
                    },
                )]),
                predictions: Vec::new(),
                observation_predictions: Vec::new(),
                aggregated_predictions: Vec::new(),
                explanations: Vec::new(),
                shape_deltas: Vec::new(),
                artifacts: Vec::new(),
                artifact_handles: BTreeMap::new(),
                fit_influence_diagnostics: Vec::new(),
                regression_targets: Vec::new(),
                lineage: LineageRecord {
                    record_id: LineageId::new(format!(
                        "lineage:parallel:{}",
                        task.node_plan.node_id
                    ))
                    .unwrap(),
                    run_id: task.run_id.clone(),
                    node_id: task.node_plan.node_id.clone(),
                    phase: task.phase,
                    controller_id: self.id.clone(),
                    controller_version: task.node_plan.controller_version.clone(),
                    variant_id: task.variant_id.clone(),
                    fold_id: task.fold_id.clone(),
                    branch_path: task.branch_path.clone(),
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
                    target_domain: None,
                },
            })
        }
    }

    assert!(ParallelScheduler::new(0).is_err());
    let plan = build_execution_plan(
        "plan:parallel",
        independent_parallel_graph(),
        CampaignSpec {
            inner_cv: None,
            id: "campaign:parallel".to_string(),
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
        &manifests(),
    )
    .unwrap();
    let active = Arc::new(AtomicUsize::new(0));
    let max_active = Arc::new(AtomicUsize::new(0));
    let mut controllers = RuntimeControllerRegistry::new();
    controllers
        .register(Box::new(ConcurrencyProbeController {
            id: ControllerId::new("controller:transform").unwrap(),
            active: Arc::clone(&active),
            max_active: Arc::clone(&max_active),
        }))
        .unwrap();
    let mut ctx = RunContext::new(RunId::new("run:parallel").unwrap(), Some(11));

    let results = ParallelScheduler::new(2)
        .unwrap()
        .execute_phase(&plan, &controllers, &mut ctx, Phase::FitCv)
        .unwrap();

    assert_eq!(results.len(), 2);
    assert_eq!(ctx.lineage.len(), 2);
    assert!(max_active.load(Ordering::SeqCst) >= 2);
}

#[test]
fn parallel_campaign_scheduler_stress_matches_sequential_across_variants_and_folds() {
    struct StressProbeController {
        id: ControllerId,
        active: Arc<AtomicUsize>,
        max_active: Arc<AtomicUsize>,
        invocations: Arc<Mutex<Vec<String>>>,
        pause: bool,
    }

    impl RuntimeController for StressProbeController {
        fn controller_id(&self) -> &ControllerId {
            &self.id
        }

        fn invoke(&self, task: &NodeTask) -> Result<NodeResult> {
            assert_stress_inputs(task)?;
            let task_key = stress_task_key(task);
            self.invocations.lock().unwrap().push(task_key.clone());
            let active = self.active.fetch_add(1, Ordering::SeqCst) + 1;
            update_max_active(&self.max_active, active);
            if self.pause {
                std::thread::sleep(std::time::Duration::from_millis(8));
            }
            self.active.fetch_sub(1, Ordering::SeqCst);

            let (output_name, output_kind) = match &task.node_plan.kind {
                NodeKind::Model => ("pred", HandleKind::Prediction),
                NodeKind::MixedJoin => ("merged", HandleKind::Data),
                _ => ("x", HandleKind::Data),
            };
            let prediction_value = (stable_test_handle(&task_key) % 10_000) as f64 / 100.0;
            let predictions = matches!(&task.node_plan.kind, NodeKind::Model)
                .then(|| {
                    let sample_ids = stress_validation_samples(task.fold_id.as_ref());
                    PredictionBlock {
                        prediction_id: Some(format!(
                            "prediction:{}:{}:{}",
                            task.node_plan.node_id,
                            task.variant_id
                                .as_ref()
                                .map(ToString::to_string)
                                .unwrap_or_else(|| "variant:base".to_string()),
                            task.fold_id
                                .as_ref()
                                .map(ToString::to_string)
                                .unwrap_or_else(|| "nofold".to_string())
                        )),
                        producer_node: task.node_plan.node_id.clone(),
                        producer_port: None,
                        partition: PredictionPartition::Validation,
                        fold_id: task.fold_id.clone(),
                        values: sample_ids
                            .iter()
                            .enumerate()
                            .map(|(idx, _)| vec![prediction_value + idx as f64])
                            .collect(),
                        sample_ids,
                        target_names: vec!["y".to_string()],
                    }
                })
                .into_iter()
                .collect::<Vec<_>>();
            Ok(NodeResult {
                schema_version: None,
                classification_probabilities: Vec::new(),
                consumed_data_views: std::collections::BTreeMap::new(),
                node_id: task.node_plan.node_id.clone(),
                outputs: BTreeMap::from([(
                    output_name.to_string(),
                    HandleRef {
                        handle: stable_test_handle(&task_key),
                        kind: output_kind,
                        owner_controller: self.id.clone(),
                    },
                )]),
                predictions,
                observation_predictions: Vec::new(),
                aggregated_predictions: Vec::new(),
                explanations: Vec::new(),
                shape_deltas: Vec::new(),
                artifacts: Vec::new(),
                artifact_handles: BTreeMap::new(),
                fit_influence_diagnostics: Vec::new(),
                regression_targets: Vec::new(),
                lineage: LineageRecord {
                    record_id: LineageId::new(format!(
                        "lineage:stress:{}:{}:{}",
                        task.node_plan.node_id,
                        task.variant_id
                            .as_ref()
                            .map(ToString::to_string)
                            .unwrap_or_else(|| "variant:base".to_string()),
                        task.fold_id
                            .as_ref()
                            .map(ToString::to_string)
                            .unwrap_or_else(|| "nofold".to_string())
                    ))
                    .unwrap(),
                    run_id: task.run_id.clone(),
                    node_id: task.node_plan.node_id.clone(),
                    phase: task.phase,
                    controller_id: self.id.clone(),
                    controller_version: task.node_plan.controller_version.clone(),
                    variant_id: task.variant_id.clone(),
                    fold_id: task.fold_id.clone(),
                    branch_path: task.branch_path.clone(),
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
                    target_domain: None,
                },
            })
        }
    }

    fn stress_runtime_controllers(
        active: Arc<AtomicUsize>,
        max_active: Arc<AtomicUsize>,
        invocations: Arc<Mutex<Vec<String>>>,
        pause: bool,
    ) -> RuntimeControllerRegistry {
        let mut controllers = RuntimeControllerRegistry::new();
        for id in [
            "controller:transform",
            "controller:model",
            "controller:mixed_join",
        ] {
            controllers
                .register(Box::new(StressProbeController {
                    id: ControllerId::new(id).unwrap(),
                    active: Arc::clone(&active),
                    max_active: Arc::clone(&max_active),
                    invocations: Arc::clone(&invocations),
                    pause,
                }))
                .unwrap();
        }
        controllers
    }

    fn update_max_active(max_active: &AtomicUsize, active: usize) {
        let mut observed = max_active.load(Ordering::SeqCst);
        while active > observed
            && max_active
                .compare_exchange(observed, active, Ordering::SeqCst, Ordering::SeqCst)
                .is_err()
        {
            observed = max_active.load(Ordering::SeqCst);
        }
    }

    fn stress_task_key(task: &NodeTask) -> String {
        format!(
            "{}|{}|{}|{}|{}",
            task.node_plan.node_id,
            task.variant_id
                .as_ref()
                .map(ToString::to_string)
                .unwrap_or_else(|| "variant:base".to_string()),
            task.fold_id
                .as_ref()
                .map(ToString::to_string)
                .unwrap_or_else(|| "nofold".to_string()),
            task.seed
                .map(|seed| seed.to_string())
                .unwrap_or_else(|| "noseed".to_string()),
            task.node_plan.params_fingerprint,
        )
    }

    fn stable_test_handle(label: &str) -> u64 {
        label
            .bytes()
            .fold(14_695_981_039_346_656_037, |hash, byte| {
                (hash ^ byte as u64).wrapping_mul(1_099_511_628_211)
            })
    }

    fn stress_validation_samples(fold_id: Option<&FoldId>) -> Vec<SampleId> {
        match fold_id.map(FoldId::as_str) {
            Some("fold:0") => vec![SampleId::new("s0").unwrap(), SampleId::new("s3").unwrap()],
            Some("fold:1") => vec![SampleId::new("s1").unwrap(), SampleId::new("s4").unwrap()],
            Some("fold:2") => vec![SampleId::new("s2").unwrap(), SampleId::new("s5").unwrap()],
            _ => vec![SampleId::new("s0").unwrap()],
        }
    }

    fn assert_stress_inputs(task: &NodeTask) -> Result<()> {
        let node_id = task.node_plan.node_id.as_str();
        if node_id.starts_with("transform:stress.") && !task.input_handles.is_empty() {
            return Err(DagMlError::RuntimeValidation(format!(
                "source node `{node_id}` received unexpected inputs"
            )));
        }
        if node_id.starts_with("model:stress.")
            && !task
                .input_handles
                .keys()
                .any(|key| key.starts_with("transform:stress.") && key.ends_with(".x"))
        {
            return Err(DagMlError::RuntimeValidation(format!(
                "model node `{node_id}` did not receive its transform input"
            )));
        }
        if node_id == "merge:stress" {
            let model_inputs = task
                .input_handles
                .keys()
                .filter(|key| key.starts_with("model:stress.") && key.ends_with(".pred"))
                .count();
            if model_inputs != 6 {
                return Err(DagMlError::RuntimeValidation(format!(
                    "merge node received {model_inputs} model inputs, expected 6"
                )));
            }
        }
        Ok(())
    }

    fn lineage_records(ctx: &RunContext) -> Vec<LineageRecord> {
        ctx.lineage.records().cloned().collect::<Vec<_>>()
    }

    let plan = build_execution_plan(
        "plan:parallel.stress",
        parallel_stress_graph(),
        parallel_stress_campaign(),
        &parallel_stress_manifests(),
    )
    .unwrap();
    let levels = plan.node_parallel_levels_for_phase(Phase::FitCv).unwrap();
    assert_eq!(
        levels.iter().map(Vec::len).collect::<Vec<_>>(),
        vec![6, 6, 1]
    );
    assert_eq!(plan.variants.len(), 3);
    assert_eq!(plan.fold_set.as_ref().unwrap().folds.len(), 3);

    let sequential_active = Arc::new(AtomicUsize::new(0));
    let sequential_max_active = Arc::new(AtomicUsize::new(0));
    let sequential_invocations = Arc::new(Mutex::new(Vec::new()));
    let sequential_controllers = stress_runtime_controllers(
        Arc::clone(&sequential_active),
        Arc::clone(&sequential_max_active),
        Arc::clone(&sequential_invocations),
        false,
    );
    let mut sequential_ctx = RunContext::new(RunId::new("run:parallel.stress").unwrap(), Some(31));
    let sequential_results = SequentialScheduler
        .execute_campaign_phase(
            &plan,
            &sequential_controllers,
            &mut sequential_ctx,
            Phase::FitCv,
        )
        .unwrap();

    let parallel_active = Arc::new(AtomicUsize::new(0));
    let parallel_max_active = Arc::new(AtomicUsize::new(0));
    let parallel_invocations = Arc::new(Mutex::new(Vec::new()));
    let parallel_controllers = stress_runtime_controllers(
        Arc::clone(&parallel_active),
        Arc::clone(&parallel_max_active),
        Arc::clone(&parallel_invocations),
        true,
    );
    let mut parallel_ctx = RunContext::new(RunId::new("run:parallel.stress").unwrap(), Some(31));
    let parallel_results = ParallelScheduler::new(4)
        .unwrap()
        .execute_campaign_phase(
            &plan,
            &parallel_controllers,
            &mut parallel_ctx,
            Phase::FitCv,
        )
        .unwrap();

    assert_eq!(sequential_results.len(), 117);
    assert_eq!(parallel_results, sequential_results);
    assert_eq!(
        parallel_ctx.prediction_store.blocks(),
        sequential_ctx.prediction_store.blocks()
    );
    assert_eq!(
        lineage_records(&parallel_ctx),
        lineage_records(&sequential_ctx)
    );
    assert_eq!(parallel_ctx.prediction_store.blocks().len(), 54);
    assert_eq!(parallel_ctx.lineage.len(), 117);
    assert_eq!(
        parallel_results
            .iter()
            .filter_map(|result| result.lineage.seed)
            .collect::<BTreeSet<_>>()
            .len(),
        parallel_results.len()
    );
    assert_eq!(
        parallel_invocations
            .lock()
            .unwrap()
            .iter()
            .cloned()
            .collect::<BTreeSet<_>>(),
        sequential_invocations
            .lock()
            .unwrap()
            .iter()
            .cloned()
            .collect::<BTreeSet<_>>()
    );
    let observed_parallelism = parallel_max_active.load(Ordering::SeqCst);
    assert!((2..=4).contains(&observed_parallelism));
    assert_eq!(parallel_active.load(Ordering::SeqCst), 0);
    assert_eq!(sequential_max_active.load(Ordering::SeqCst), 1);
}

#[test]
fn campaign_scheduler_expands_variants_and_cv_folds() {
    let plan = build_execution_plan(
        "plan:campaign",
        simple_graph(),
        CampaignSpec {
            inner_cv: None,
            id: "campaign:fitcv".to_string(),
            root_seed: Some(11),
            leakage_policy: Default::default(),
            aggregation_policy: Default::default(),
            split_invocation: Some(SplitInvocation {
                id: "split:outer".to_string(),
                controller_id: None,
                leakage_policy: Default::default(),
                params: BTreeMap::new(),
                fold_set: Some(two_fold_set()),
            }),
            generation: GenerationSpec {
                strategy: GenerationStrategy::Cartesian,
                dimensions: vec![GenerationDimension {
                    name: "model_family".to_string(),
                    choices: vec![
                        GenerationChoice {
                            label: "pls".to_string(),
                            value: json!("pls"),
                            param_overrides: Vec::new(),
                            active_subsequence: None,
                        },
                        GenerationChoice {
                            label: "rf".to_string(),
                            value: json!("rf"),
                            param_overrides: Vec::new(),
                            active_subsequence: None,
                        },
                    ],
                }],
                max_variants: Some(2),
                constraints: GenerationConstraints::default(),
            },
            shape_plans: BTreeMap::new(),
            data_bindings: BTreeMap::new(),
            branch_view_plans: Vec::new(),
            metadata: BTreeMap::new(),
        },
        &manifests(),
    )
    .unwrap();
    let controllers = runtime_controllers();
    let mut ctx = RunContext::new(RunId::new("run:campaign").unwrap(), Some(11));

    let results = SequentialScheduler
        .execute_campaign_phase(&plan, &controllers, &mut ctx, Phase::FitCv)
        .unwrap();

    assert_eq!(results.len(), 8);
    assert_eq!(ctx.lineage.len(), 8);
    assert_eq!(ctx.prediction_store.blocks().len(), 4);
    assert!(ctx
        .lineage
        .records()
        .all(|record| record.variant_id.is_some() && record.fold_id.is_some()));
    assert_eq!(
        ctx.lineage
            .records()
            .filter_map(|record| record.seed)
            .collect::<BTreeSet<_>>()
            .len(),
        8
    );
}

#[test]
fn node_tasks_expose_generation_variant_context() {
    let plan = build_execution_plan(
        "plan:generation.task.context",
        simple_graph(),
        CampaignSpec {
            inner_cv: None,
            id: "campaign:generation.task.context".to_string(),
            root_seed: Some(23),
            leakage_policy: Default::default(),
            aggregation_policy: Default::default(),
            split_invocation: None,
            generation: GenerationSpec {
                strategy: GenerationStrategy::Cartesian,
                dimensions: vec![GenerationDimension {
                    name: "model_family".to_string(),
                    choices: vec![
                        GenerationChoice {
                            label: "pls".to_string(),
                            value: json!("pls"),
                            param_overrides: vec![crate::generation::GenerationParamOverride {
                                node_id: NodeId::new("model:pls").unwrap(),
                                params: BTreeMap::from([("n_components".to_string(), json!(4))]),
                            }],
                            active_subsequence: None,
                        },
                        GenerationChoice {
                            label: "rf".to_string(),
                            value: json!("rf"),
                            param_overrides: vec![crate::generation::GenerationParamOverride {
                                node_id: NodeId::new("model:pls").unwrap(),
                                params: BTreeMap::from([("trees".to_string(), json!(64))]),
                            }],
                            active_subsequence: None,
                        },
                    ],
                }],
                max_variants: Some(2),
                constraints: GenerationConstraints::default(),
            },
            shape_plans: BTreeMap::new(),
            data_bindings: BTreeMap::new(),
            branch_view_plans: Vec::new(),
            metadata: BTreeMap::new(),
        },
        &manifests(),
    )
    .unwrap();
    let observed_variants = Arc::new(Mutex::new(Vec::new()));
    let observed_node_plans = Arc::new(Mutex::new(Vec::new()));
    let mut controllers = RuntimeControllerRegistry::new();
    controllers
        .register(Box::new(MockController {
            id: ControllerId::new("controller:transform").unwrap(),
            handle: 1,
            emit_prediction: false,
        }))
        .unwrap();
    controllers
        .register(Box::new(VariantProbeController {
            id: ControllerId::new("controller:model").unwrap(),
            handle: 2,
            variants: Arc::clone(&observed_variants),
            node_plans: Arc::clone(&observed_node_plans),
        }))
        .unwrap();
    let mut ctx = RunContext::new(RunId::new("run:generation.task.context").unwrap(), Some(23));

    let results = SequentialScheduler
        .execute_campaign_phase(&plan, &controllers, &mut ctx, Phase::FitCv)
        .unwrap();

    assert_eq!(results.len(), 4);
    let observed = observed_variants.lock().unwrap();
    assert_eq!(observed.len(), 2);
    let mut labels = BTreeSet::new();
    for variant in observed.iter().map(|variant| variant.as_ref().unwrap()) {
        variant.validate().unwrap();
        let expected = plan
            .variants
            .iter()
            .find(|planned| planned.variant_id == variant.variant_id)
            .unwrap();
        assert_eq!(variant.choices, expected.choices);
        assert_eq!(variant.fingerprint, expected.fingerprint);
        assert_eq!(variant.seed, expected.seed);
        labels.insert(variant.choices["model_family"].label.as_str());
    }
    assert_eq!(labels, BTreeSet::from(["pls", "rf"]));
    let observed_plans = observed_node_plans.lock().unwrap();
    assert_eq!(observed_plans.len(), 2);
    let base_plan = plan
        .node_plans
        .get(&NodeId::new("model:pls").unwrap())
        .unwrap();
    assert!(observed_plans
        .iter()
        .all(|node_plan| node_plan.params_fingerprint != base_plan.params_fingerprint));
    assert!(observed_plans
        .iter()
        .any(|node_plan| node_plan.params.get("n_components") == Some(&json!(4))));
    assert!(observed_plans
        .iter()
        .any(|node_plan| node_plan.params.get("trees") == Some(&json!(64))));
}

#[test]
fn requires_oof_prediction_edge_supplies_validated_prediction_handle() {
    let plan = build_execution_plan(
        "plan:oof.edge.success",
        oof_edge_graph(),
        oof_edge_campaign(),
        &manifests(),
    )
    .unwrap();
    let controllers = oof_edge_runtime_controllers(
        Some(PredictionPartition::Validation),
        OofSampleMode::Aligned,
    );
    let mut ctx = RunContext::new(RunId::new("run:oof.edge.success").unwrap(), Some(11));

    let results = SequentialScheduler
        .execute_campaign_phase(&plan, &controllers, &mut ctx, Phase::FitCv)
        .unwrap();

    assert_eq!(results.len(), 4);
    assert_eq!(ctx.prediction_store.blocks().len(), 2);
    assert_eq!(
        results
            .iter()
            .filter(|result| result.node_id.as_str() == "model:meta")
            .count(),
        2
    );
}

#[test]
fn requires_oof_prediction_edge_rejects_missing_validation_predictions() {
    let plan = build_execution_plan(
        "plan:oof.edge.missing",
        oof_edge_graph(),
        oof_edge_campaign(),
        &manifests(),
    )
    .unwrap();
    let controllers = oof_edge_runtime_controllers(None, OofSampleMode::Aligned);
    let mut ctx = RunContext::new(RunId::new("run:oof.edge.missing").unwrap(), Some(11));

    let error = SequentialScheduler
        .execute_campaign_phase(&plan, &controllers, &mut ctx, Phase::FitCv)
        .unwrap_err();

    assert!(matches!(&error, DagMlError::OofValidation(_)));
    assert_eq!(error.category(), "validation");
    assert_eq!(error.code(), "oof_validation");
    assert_eq!(error.error_code(), 4);
    let message = error.to_string();
    assert!(message.contains("requires OOF validation predictions"));
    assert!(message.contains("model:base"));
}

#[test]
fn requires_oof_prediction_edge_rejects_train_predictions_as_features() {
    let plan = build_execution_plan(
        "plan:oof.edge.train",
        oof_edge_graph(),
        oof_edge_campaign(),
        &manifests(),
    )
    .unwrap();
    let controllers =
        oof_edge_runtime_controllers(Some(PredictionPartition::Train), OofSampleMode::Aligned);
    let mut ctx = RunContext::new(RunId::new("run:oof.edge.train").unwrap(), Some(11));

    let error = SequentialScheduler
        .execute_campaign_phase(&plan, &controllers, &mut ctx, Phase::FitCv)
        .unwrap_err()
        .to_string();

    assert!(error.contains("requires OOF validation predictions"));
}

#[test]
fn requires_oof_prediction_edge_carries_validation_oof_values_in_fit_cv() {
    // Option A: the meta-node `PredictionInputSpec` carries the Validation OOF
    // value rows so a host can build the stacking matrix during FIT_CV.
    let plan = build_execution_plan(
        "plan:oof.edge.values",
        oof_edge_graph(),
        oof_edge_campaign(),
        &manifests(),
    )
    .unwrap();

    let captured = Arc::new(Mutex::new(Vec::new()));
    let mut controllers = RuntimeControllerRegistry::new();
    controllers
        .register(Box::new(CaptureOofValuesController {
            id: ControllerId::new("controller:model").unwrap(),
            captured: Arc::clone(&captured),
        }))
        .unwrap();
    let mut ctx = RunContext::new(RunId::new("run:oof.edge.values").unwrap(), Some(11));

    SequentialScheduler
        .execute_campaign_phase(&plan, &controllers, &mut ctx, Phase::FitCv)
        .unwrap();

    let observed = captured.lock().unwrap();
    // One meta-node invocation per fold (fold:0 -> s1, fold:1 -> s2).
    assert_eq!(observed.len(), 2);
    let by_sample = observed
        .iter()
        .map(|(sample_ids, values, width)| {
            // Values stay aligned 1:1 with sample_ids at the declared width.
            assert_eq!(values.len(), sample_ids.len());
            assert_eq!(*width, 1);
            assert!(values.iter().all(|row| row.len() == *width));
            (sample_ids[0].to_string(), values[0][0])
        })
        .collect::<BTreeMap<_, _>>();
    assert_eq!(by_sample.get("s1"), Some(&0.25));
    assert_eq!(by_sample.get("s2"), Some(&0.75));
}

#[test]
fn requires_oof_prediction_edge_rejects_fold_misalignment() {
    let plan = build_execution_plan(
        "plan:oof.edge.misaligned",
        oof_edge_graph(),
        oof_edge_campaign(),
        &manifests(),
    )
    .unwrap();
    let controllers = oof_edge_runtime_controllers(
        Some(PredictionPartition::Validation),
        OofSampleMode::Swapped,
    );
    let mut ctx = RunContext::new(RunId::new("run:oof.edge.misaligned").unwrap(), Some(11));

    let error = SequentialScheduler
        .execute_campaign_phase(&plan, &controllers, &mut ctx, Phase::FitCv)
        .unwrap_err();

    assert!(matches!(&error, DagMlError::OofValidation(_)));
    assert!(error
        .to_string()
        .contains("do not match validation samples"));
}

#[test]
fn requires_oof_edge_exact_coverage_is_mandatory_even_without_fold_alignment_flag() {
    // R-P0-2: exact OOF coverage used to be gated by `requires_fold_alignment`, making completeness
    // CONDITIONAL — a `requires_oof` edge that left the flag unset admitted blocks that merely exist.
    // The check is now mandatory for every `requires_oof` stacking edge reaching the runtime, so a
    // fold-misaligned OOF block is rejected even with `requires_fold_alignment: false`.
    let mut graph = oof_edge_graph();
    graph.id = "g:oof.edge.no.align".to_string();
    graph.edges[0].contract.requires_fold_alignment = false;
    assert!(graph.edges[0].contract.requires_oof);

    let plan = build_execution_plan(
        "plan:oof.edge.no.align",
        graph,
        oof_edge_campaign(),
        &manifests(),
    )
    .unwrap();
    let controllers = oof_edge_runtime_controllers(
        Some(PredictionPartition::Validation),
        OofSampleMode::Swapped,
    );
    let mut ctx = RunContext::new(RunId::new("run:oof.edge.no.align").unwrap(), Some(11));

    let error = SequentialScheduler
        .execute_campaign_phase(&plan, &controllers, &mut ctx, Phase::FitCv)
        .unwrap_err()
        .to_string();

    assert!(
        error.contains("do not match validation samples"),
        "exact OOF coverage must fire without the fold-alignment flag: {error}"
    );
}

#[test]
fn requires_oof_prediction_edge_refit_uses_cv_oof_coverage() {
    let plan = build_execution_plan(
        "plan:oof.edge.refit",
        oof_edge_graph(),
        oof_edge_campaign(),
        &oof_edge_manifests(BTreeSet::from([Phase::FitCv, Phase::Refit])),
    )
    .unwrap();
    let fit_controllers = oof_edge_runtime_controllers(
        Some(PredictionPartition::Validation),
        OofSampleMode::Aligned,
    );
    let mut ctx = RunContext::new(RunId::new("run:oof.edge.refit").unwrap(), Some(11));
    SequentialScheduler
        .execute_campaign_phase(&plan, &fit_controllers, &mut ctx, Phase::FitCv)
        .unwrap();
    assert_eq!(ctx.prediction_store.blocks().len(), 2);

    let refit_controllers = oof_edge_runtime_controllers(None, OofSampleMode::Aligned);
    let refit_results = SequentialScheduler
        .execute_campaign_phase(&plan, &refit_controllers, &mut ctx, Phase::Refit)
        .unwrap();

    assert_eq!(refit_results.len(), 2);
    assert_eq!(
        refit_results
            .iter()
            .filter(|result| result.node_id.as_str() == "model:meta")
            .count(),
        1
    );
}

#[test]
fn d9_golden_oof_refit_and_predict_replay_mock_run() {
    #[derive(serde::Deserialize)]
    struct D9GoldenFixture {
        golden_scenarios: Vec<D9GoldenScenario>,
    }

    #[derive(serde::Deserialize)]
    struct D9GoldenScenario {
        scenario_id: String,
        mock_phase_path: Vec<String>,
    }

    let fixture: D9GoldenFixture = serde_json::from_str(include_str!(
        "../../tests/fixtures/package/data/d9_golden_multisource_scenarios.json"
    ))
    .unwrap();
    assert_eq!(fixture.golden_scenarios.len(), 7);

    for (index, scenario) in fixture.golden_scenarios.iter().enumerate() {
        assert_eq!(scenario.mock_phase_path, ["fit_cv", "refit", "predict"]);
        let oof_plan = build_execution_plan(
            format!("plan:d9.oof.refit.{index}"),
            oof_edge_graph(),
            oof_edge_campaign(),
            &oof_edge_manifests(BTreeSet::from([Phase::FitCv, Phase::Refit])),
        )
        .unwrap();
        let mut oof_ctx = RunContext::new(
            RunId::new(format!("run:d9.oof.refit.{index}")).unwrap(),
            Some(11),
        );
        let fit_controllers = oof_edge_runtime_controllers(
            Some(PredictionPartition::Validation),
            OofSampleMode::Aligned,
        );
        let fit_results = SequentialScheduler
            .execute_campaign_phase(&oof_plan, &fit_controllers, &mut oof_ctx, Phase::FitCv)
            .unwrap();
        assert_eq!(
            fit_results.len(),
            4,
            "{} did not mock-run fit_cv through OOF",
            scenario.scenario_id
        );
        assert_eq!(
            oof_ctx.prediction_store.blocks().len(),
            2,
            "{} did not emit complete validation OOF",
            scenario.scenario_id
        );

        let refit_controllers = oof_edge_runtime_controllers(None, OofSampleMode::Aligned);
        let refit_results = SequentialScheduler
            .execute_campaign_phase(&oof_plan, &refit_controllers, &mut oof_ctx, Phase::Refit)
            .unwrap();
        assert_eq!(
            refit_results
                .iter()
                .filter(|result| result.node_id.as_str() == "model:meta")
                .count(),
            1,
            "{} did not mock-run refit with full OOF coverage",
            scenario.scenario_id
        );

        let replay_plan = fixture_plan(&format!("plan:d9.predict.replay.{index}"));
        let bundle = replay_bundle(&replay_plan);
        let request = replay_request(&bundle, Phase::Predict);
        let envelopes = replay_envelopes();
        let provider = replay_data_provider();
        let store = replay_artifact_store(&bundle);
        let controllers = replay_runtime_controllers();
        let mut replay_ctx = RunContext::new(
            RunId::new(format!("run:d9.predict.replay.{index}")).unwrap(),
            Some(11),
        );
        let replay_results = SequentialScheduler
            .execute_bundle_replay(
                BundleReplayExecution {
                    plan: &replay_plan,
                    bundle: &bundle,
                    replay_request: &request,
                    prediction_cache_store: None,
                    controllers: &controllers,
                    data_provider: &provider,
                    artifact_store: &store,
                    data_envelopes: &envelopes,
                },
                &mut replay_ctx,
            )
            .unwrap();

        assert_eq!(
            replay_results.len(),
            2,
            "{} did not mock-run predict replay",
            scenario.scenario_id
        );
        assert_eq!(provider.view_records().len(), 1);
        assert_eq!(
            provider.view_records()[0].view.partition,
            DataRequestPartition::Predict
        );
        assert_eq!(replay_ctx.prediction_store.blocks().len(), 1);
        assert_eq!(
            replay_ctx.prediction_store.blocks()[0].partition,
            PredictionPartition::Final
        );
    }
}

#[test]
fn requires_oof_prediction_edge_feeds_live_group_units_to_fit_cv_and_refit() {
    let plan = live_group_oof_runtime_plan();
    let mut controllers = RuntimeControllerRegistry::new();
    controllers
        .register(Box::new(GroupAggregatedOofController {
            id: ControllerId::new("controller:model").unwrap(),
        }))
        .unwrap();
    let envelope: ExternalDataPlanEnvelope = serde_json::from_str(include_str!(
        "../../tests/fixtures/package/data/coordinator_data_plan_envelope_sample12.json"
    ))
    .unwrap();
    let data_provider = InMemoryDataProvider::with_envelope(
        ControllerId::new("controller:data").unwrap(),
        envelope,
    )
    .unwrap();
    let mut ctx = RunContext::new(RunId::new("run:live.group.oof").unwrap(), Some(19));

    let fit_results = SequentialScheduler
        .execute_campaign_phase_with_data_provider(
            &plan,
            &controllers,
            &data_provider,
            &mut ctx,
            Phase::FitCv,
        )
        .unwrap();

    assert_eq!(fit_results.len(), 4);
    assert!(ctx.prediction_store.blocks().is_empty());
    assert_eq!(ctx.aggregated_prediction_store.blocks().len(), 2);
    assert_eq!(
        ctx.aggregated_prediction_store
            .blocks()
            .iter()
            .map(|block| (&block.fold_id, block.level, block.unit_ids.clone()))
            .collect::<Vec<_>>(),
        vec![
            (
                &Some(FoldId::new("fold:0").unwrap()),
                PredictionLevel::Group,
                vec![PredictionUnitId::Group(GroupId::new("plant.A").unwrap())],
            ),
            (
                &Some(FoldId::new("fold:1").unwrap()),
                PredictionLevel::Group,
                vec![PredictionUnitId::Group(GroupId::new("plant.B").unwrap())],
            ),
        ]
    );

    let refit_results = SequentialScheduler
        .execute_campaign_phase_with_data_provider(
            &plan,
            &controllers,
            &data_provider,
            &mut ctx,
            Phase::Refit,
        )
        .unwrap();

    assert_eq!(refit_results.len(), 2);
    assert_eq!(
        refit_results
            .iter()
            .filter(|result| result.node_id.as_str() == "model:meta")
            .count(),
        1
    );
}

#[test]
fn aggregated_oof_edge_rejects_relation_level_train_validation_overlap() {
    let plan = live_group_oof_runtime_plan();
    let mut controllers = RuntimeControllerRegistry::new();
    controllers
        .register(Box::new(GroupAggregatedOofController {
            id: ControllerId::new("controller:model").unwrap(),
        }))
        .unwrap();
    let mut envelope: ExternalDataPlanEnvelope = serde_json::from_str(include_str!(
        "../../tests/fixtures/package/data/coordinator_data_plan_envelope_sample12.json"
    ))
    .unwrap();
    for record in &mut envelope
        .coordinator_relations
        .as_mut()
        .expect("fixture carries coordinator relations")
        .records
    {
        if record.sample_id.as_str() == "sample:2" {
            record.group_id = Some(GroupId::new("plant.A").unwrap());
        }
    }
    let data_provider = InMemoryDataProvider::with_envelope(
        ControllerId::new("controller:data").unwrap(),
        envelope,
    )
    .unwrap();
    let mut ctx = RunContext::new(
        RunId::new("run:live.group.oof.relation-overlap").unwrap(),
        Some(19),
    );

    let error = SequentialScheduler
        .execute_campaign_phase_with_data_provider(
            &plan,
            &controllers,
            &data_provider,
            &mut ctx,
            Phase::FitCv,
        )
        .unwrap_err();

    assert!(matches!(&error, DagMlError::OofValidation(_)));
    let message = error.to_string();
    assert!(
        message.contains("both train and validation partitions"),
        "unexpected overlap error: {message}"
    );
}

#[test]
fn runtime_dispatches_custom_observation_aggregation_controller() {
    let plan = aggregation_dispatch_plan(true);
    let task_ids = Arc::new(Mutex::new(Vec::new()));
    let mut controllers = RuntimeControllerRegistry::new();
    controllers
        .register(Box::new(CustomAggregationController {
            id: ControllerId::new("controller:agg.custom").unwrap(),
            task_ids: Arc::clone(&task_ids),
        }))
        .unwrap();
    let relations = SampleRelationSet {
        records: vec![
            sample_relation("obs:s1:a", "s1", "target:s1", "group:left", None, false),
            sample_relation("obs:s1:b", "s1", "target:s1", "group:left", None, false),
            sample_relation("obs:s2:a", "s2", "target:s2", "group:right", None, false),
        ],
    };

    let block = dispatch_custom_observation_aggregation(
        &plan,
        &controllers,
        "agg-task:obs-to-sample",
        ObservationPredictionBlock {
            prediction_id: Some("pred:obs".to_string()),
            producer_node: NodeId::new("model:base").unwrap(),
            producer_port: None,
            partition: PredictionPartition::Validation,
            fold_id: Some(FoldId::new("fold:0").unwrap()),
            observation_ids: vec![
                ObservationId::new("obs:s1:a").unwrap(),
                ObservationId::new("obs:s1:b").unwrap(),
                ObservationId::new("obs:s2:a").unwrap(),
            ],
            values: vec![vec![1.0], vec![5.0], vec![10.0]],
            weights: Vec::new(),
            target_names: vec!["y".to_string()],
        },
        relations,
        custom_aggregation_policy(PredictionLevel::Sample),
        vec![SampleId::new("s1").unwrap(), SampleId::new("s2").unwrap()],
    )
    .unwrap();

    assert_eq!(
        block.sample_ids,
        vec![SampleId::new("s1").unwrap(), SampleId::new("s2").unwrap()]
    );
    assert_eq!(block.values, vec![vec![3.0], vec![10.0]]);
    assert_eq!(
        task_ids.lock().unwrap().as_slice(),
        &["agg-task:obs-to-sample".to_string()]
    );
}

#[test]
fn runtime_dispatches_custom_sample_to_group_aggregation_controller() {
    let plan = aggregation_dispatch_plan(true);
    let task_ids = Arc::new(Mutex::new(Vec::new()));
    let mut controllers = RuntimeControllerRegistry::new();
    controllers
        .register(Box::new(CustomAggregationController {
            id: ControllerId::new("controller:agg.custom").unwrap(),
            task_ids: Arc::clone(&task_ids),
        }))
        .unwrap();
    let relations = SampleRelationSet {
        records: vec![
            sample_relation("obs:s1:a", "s1", "target:s1", "group:left", None, false),
            sample_relation("obs:s2:a", "s2", "target:s2", "group:left", None, false),
            sample_relation("obs:s3:a", "s3", "target:s3", "group:right", None, false),
        ],
    };
    let left = PredictionUnitId::Group(GroupId::new("group:left").unwrap());
    let right = PredictionUnitId::Group(GroupId::new("group:right").unwrap());

    let block = dispatch_custom_sample_aggregation(
        &plan,
        &controllers,
        "agg-task:sample-to-group",
        PredictionBlock {
            prediction_id: Some("pred:sample".to_string()),
            producer_node: NodeId::new("model:base").unwrap(),
            producer_port: None,
            partition: PredictionPartition::Validation,
            fold_id: Some(FoldId::new("fold:0").unwrap()),
            sample_ids: vec![
                SampleId::new("s1").unwrap(),
                SampleId::new("s2").unwrap(),
                SampleId::new("s3").unwrap(),
            ],
            values: vec![vec![1.0], vec![8.0], vec![3.0]],
            target_names: vec!["y".to_string()],
        },
        relations,
        custom_aggregation_policy(PredictionLevel::Group),
        vec![left.clone(), right.clone()],
    )
    .unwrap();

    assert_eq!(block.level, PredictionLevel::Group);
    assert_eq!(block.unit_ids, vec![left, right]);
    assert_eq!(block.values, vec![vec![8.0], vec![3.0]]);
    assert_eq!(
        task_ids.lock().unwrap().as_slice(),
        &["agg-task:sample-to-group".to_string()]
    );
}

#[test]
fn custom_aggregation_dispatch_requires_controller_capability() {
    let plan = aggregation_dispatch_plan(false);
    let mut controllers = RuntimeControllerRegistry::new();
    controllers
        .register(Box::new(CustomAggregationController {
            id: ControllerId::new("controller:agg.custom").unwrap(),
            task_ids: Arc::new(Mutex::new(Vec::new())),
        }))
        .unwrap();
    let error = dispatch_custom_observation_aggregation(
        &plan,
        &controllers,
        "agg-task:no-capability",
        ObservationPredictionBlock {
            prediction_id: None,
            producer_node: NodeId::new("model:base").unwrap(),
            producer_port: None,
            partition: PredictionPartition::Validation,
            fold_id: Some(FoldId::new("fold:0").unwrap()),
            observation_ids: vec![ObservationId::new("obs:s1:a").unwrap()],
            values: vec![vec![1.0]],
            weights: Vec::new(),
            target_names: vec!["y".to_string()],
        },
        SampleRelationSet {
            records: vec![sample_relation(
                "obs:s1:a",
                "s1",
                "target:s1",
                "group:left",
                None,
                false,
            )],
        },
        custom_aggregation_policy(PredictionLevel::Sample),
        vec![SampleId::new("s1").unwrap()],
    )
    .unwrap_err()
    .to_string();

    assert!(
        error.contains("aggregates_predictions"),
        "unexpected capability error: {error}"
    );
}

#[test]
fn scheduler_aggregates_observation_predictions_with_custom_controller() {
    let plan = observation_prediction_runtime_plan();
    let task_ids = Arc::new(Mutex::new(Vec::new()));
    let mut controllers = RuntimeControllerRegistry::new();
    controllers
        .register(Box::new(ObservationPredictionRuntimeController {
            id: ControllerId::new("controller:model.obs").unwrap(),
        }))
        .unwrap();
    controllers
        .register(Box::new(CustomAggregationController {
            id: ControllerId::new("controller:agg.custom").unwrap(),
            task_ids: Arc::clone(&task_ids),
        }))
        .unwrap();
    let envelope: ExternalDataPlanEnvelope = serde_json::from_str(include_str!(
        "../../tests/fixtures/package/data/coordinator_data_plan_envelope_sample12.json"
    ))
    .unwrap();
    let data_provider = InMemoryDataProvider::with_envelope(
        ControllerId::new("controller:data").unwrap(),
        envelope,
    )
    .unwrap();
    let mut ctx = RunContext::new(
        RunId::new("run:observation.prediction.runtime").unwrap(),
        Some(17),
    );

    let results = SequentialScheduler
        .execute_campaign_phase_with_data_provider(
            &plan,
            &controllers,
            &data_provider,
            &mut ctx,
            Phase::FitCv,
        )
        .unwrap();

    assert_eq!(results.len(), 2);
    assert!(results
        .iter()
        .all(|result| result.observation_predictions.len() == 1));
    assert!(results.iter().all(|result| result.predictions.len() == 1));
    let blocks = ctx.prediction_store.blocks();
    assert_eq!(
        blocks
            .iter()
            .flat_map(|block| block.sample_ids.iter().cloned())
            .collect::<Vec<_>>(),
        vec![
            SampleId::new("sample:1").unwrap(),
            SampleId::new("sample:2").unwrap()
        ]
    );
    assert_eq!(
        blocks
            .iter()
            .flat_map(|block| block.values.iter().cloned())
            .collect::<Vec<_>>(),
        vec![vec![4.0], vec![10.0]]
    );
    assert_eq!(task_ids.lock().unwrap().len(), 2);
}

#[test]
fn refit_oof_accepts_grouped_repeated_aggregation_and_refuses_origin_leakage() {
    let fold_set = grouped_repetition_fold_set();
    let relations = grouped_repetition_relations();
    let leakage_policy = grouped_leakage_policy();
    relations
        .validate_against_fold_set(&fold_set, &leakage_policy)
        .unwrap();

    let mut leaky_relations = relations.clone();
    leaky_relations.records.push(sample_relation(
        "obs:s1:leaky_aug",
        "s1",
        "target:product1",
        "group:product1",
        Some("s2"),
        true,
    ));
    let leak_error = leaky_relations
        .validate_against_fold_set(&fold_set, &leakage_policy)
        .unwrap_err()
        .to_string();
    assert!(
        leak_error.contains("leaks origin sample"),
        "unexpected leakage error: {leak_error}"
    );

    let plan = build_execution_plan(
        "plan:oof.edge.grouped-repetition.refit",
        oof_edge_graph(),
        grouped_oof_campaign(fold_set.clone()),
        &oof_edge_manifests(BTreeSet::from([Phase::Refit])),
    )
    .unwrap();
    let mut ctx = RunContext::new(
        RunId::new("run:oof.edge.grouped-repetition.refit").unwrap(),
        Some(11),
    );

    let fold0 = aggregate_observation_predictions(
        &ObservationPredictionBlock {
            prediction_id: Some("pred:model:base:fold0:obs".to_string()),
            producer_node: NodeId::new("model:base").unwrap(),
            producer_port: None,
            partition: PredictionPartition::Validation,
            fold_id: Some(FoldId::new("fold:0").unwrap()),
            observation_ids: vec![
                ObservationId::new("obs:s1:a").unwrap(),
                ObservationId::new("obs:s1:b").unwrap(),
                ObservationId::new("obs:s1rep:a").unwrap(),
            ],
            values: vec![vec![1.0], vec![3.0], vec![4.0]],
            weights: Vec::new(),
            target_names: vec!["y".to_string()],
        },
        &relations,
        &AggregationPolicy::default(),
        &[
            SampleId::new("s1").unwrap(),
            SampleId::new("s1_rep").unwrap(),
        ],
    )
    .unwrap();
    assert_eq!(fold0.values, vec![vec![2.0], vec![4.0]]);
    ctx.prediction_store.append(fold0).unwrap();

    let fold1 = aggregate_observation_predictions(
        &ObservationPredictionBlock {
            prediction_id: Some("pred:model:base:fold1:obs".to_string()),
            producer_node: NodeId::new("model:base").unwrap(),
            producer_port: None,
            partition: PredictionPartition::Validation,
            fold_id: Some(FoldId::new("fold:1").unwrap()),
            observation_ids: vec![
                ObservationId::new("obs:s2:a").unwrap(),
                ObservationId::new("obs:s2:b").unwrap(),
            ],
            values: vec![vec![10.0], vec![14.0]],
            weights: Vec::new(),
            target_names: vec!["y".to_string()],
        },
        &relations,
        &AggregationPolicy::default(),
        &[SampleId::new("s2").unwrap()],
    )
    .unwrap();
    assert_eq!(fold1.values, vec![vec![12.0]]);
    ctx.prediction_store.append(fold1).unwrap();

    let fold2 = aggregate_observation_predictions(
        &ObservationPredictionBlock {
            prediction_id: Some("pred:model:base:fold2:obs".to_string()),
            producer_node: NodeId::new("model:base").unwrap(),
            producer_port: None,
            partition: PredictionPartition::Validation,
            fold_id: Some(FoldId::new("fold:2").unwrap()),
            observation_ids: vec![ObservationId::new("obs:s3:a").unwrap()],
            values: vec![vec![20.0]],
            weights: Vec::new(),
            target_names: vec!["y".to_string()],
        },
        &relations,
        &AggregationPolicy::default(),
        &[SampleId::new("s3").unwrap()],
    )
    .unwrap();
    assert_eq!(fold2.values, vec![vec![20.0]]);
    ctx.prediction_store.append(fold2).unwrap();
    assert_eq!(ctx.prediction_store.blocks().len(), 3);

    let controllers = expected_refit_oof_runtime_controllers(
        vec![
            FoldId::new("fold:0").unwrap(),
            FoldId::new("fold:1").unwrap(),
            FoldId::new("fold:2").unwrap(),
        ],
        vec![
            SampleId::new("s1").unwrap(),
            SampleId::new("s1_rep").unwrap(),
            SampleId::new("s2").unwrap(),
            SampleId::new("s3").unwrap(),
        ],
        vec!["y".to_string()],
    );
    let refit_results = SequentialScheduler
        .execute_campaign_phase(&plan, &controllers, &mut ctx, Phase::Refit)
        .unwrap();

    assert_eq!(refit_results.len(), 2);
    assert_eq!(
        refit_results
            .iter()
            .filter(|result| result.node_id.as_str() == "model:meta")
            .count(),
        1
    );
}

#[test]
fn in_memory_prediction_cache_store_loads_and_materializes_oof_payloads() {
    let plan = build_execution_plan(
        "plan:oof.edge.cache.store",
        oof_edge_graph(),
        oof_edge_campaign(),
        &oof_edge_manifests(BTreeSet::from([Phase::FitCv, Phase::Refit])),
    )
    .unwrap();
    let fit_controllers = oof_edge_runtime_controllers(
        Some(PredictionPartition::Validation),
        OofSampleMode::Aligned,
    );
    let mut ctx = RunContext::new(RunId::new("run:oof.edge.cache.store").unwrap(), Some(11));
    SequentialScheduler
        .execute_campaign_phase(&plan, &fit_controllers, &mut ctx, Phase::FitCv)
        .unwrap();

    let requirement = BundlePredictionRequirement {
        producer_node: NodeId::new("model:base").unwrap(),
        source_port: "pred".to_string(),
        consumer_node: NodeId::new("model:meta").unwrap(),
        target_port: "pred".to_string(),
        partition: PredictionPartition::Validation,
        prediction_level: PredictionLevel::Sample,
        fold_ids: vec![
            FoldId::new("fold:0").unwrap(),
            FoldId::new("fold:1").unwrap(),
        ],
        unit_ids: Vec::new(),
        sample_ids: vec![SampleId::new("s1").unwrap(), SampleId::new("s2").unwrap()],
        prediction_width: 1,
        target_names: vec!["y".to_string()],
    };
    let mut cache =
        build_prediction_cache_record(&requirement, ctx.prediction_store.blocks()).unwrap();
    let mut payload =
        build_prediction_cache_payload(&requirement, ctx.prediction_store.blocks()).unwrap();
    let cache_namespace_fingerprints = vec!["a".repeat(64), "b".repeat(64)];
    cache.cache_namespace_fingerprints = cache_namespace_fingerprints.clone();
    payload.cache_namespace_fingerprints = cache_namespace_fingerprints.clone();
    let bundle = build_execution_bundle_with_prediction_contracts(
        BundleId::new("bundle:oof.edge.cache.store").unwrap(),
        &plan,
        Some(plan.variants[0].variant_id.clone()),
        BTreeMap::new(),
        Vec::new(),
        vec![requirement.clone()],
        vec![cache.clone()],
    )
    .unwrap();
    let payload_set = BundlePredictionCachePayloadSet {
        bundle_id: bundle.bundle_id.clone(),
        schema_version: PREDICTION_CACHE_PAYLOAD_SCHEMA_VERSION,
        caches: vec![payload],
    };
    let store = InMemoryPredictionCacheStore::from_payloads(&bundle, payload_set).unwrap();
    assert_eq!(store.payload_count(), 1);
    assert_eq!(store.load_blocks(&requirement.key()).unwrap().len(), 2);
    let mut preload_ctx = RunContext::new(
        RunId::new("run:oof.edge.cache.store.preload").unwrap(),
        Some(11),
    );
    preload_replay_prediction_cache_store(&bundle, Some(&store), &mut preload_ctx).unwrap();
    assert_eq!(preload_ctx.prediction_store.blocks().len(), 2);

    ReplayPhaseRequest {
        bundle_id: bundle.bundle_id.clone(),
        phase: Phase::Refit,
        data_envelope_keys: Vec::new(),
    }
    .validate_for_bundle_with_prediction_cache_store(&bundle, true)
    .unwrap();

    let request = PredictionCacheMaterializationRequest {
        run_id: RunId::new("run:oof.edge.cache.store.replay").unwrap(),
        bundle_id: bundle.bundle_id.clone(),
        phase: Phase::Refit,
        variant_id: bundle.selected_variant_id.clone(),
        requirement: requirement.clone(),
        cache: cache.clone(),
        producer_controller_id: ControllerId::new("controller:model").unwrap(),
    };
    let handle = store.materialize(&request).unwrap();
    assert_eq!(handle.kind, HandleKind::Prediction);
    assert_eq!(
        handle.owner_controller,
        ControllerId::new("controller:model").unwrap()
    );
    let records = store.materialization_records();
    assert_eq!(records.len(), 1);
    assert_eq!(records[0].requirement_key, requirement.key());
    assert_eq!(
        records[0].cache_namespace_fingerprints,
        cache_namespace_fingerprints
    );
    assert_eq!(records[0].handle, handle);
    records[0].validate_against_request(&request).unwrap();
    let mut missing_variant_request = request.clone();
    missing_variant_request.variant_id = None;
    assert!(store
        .materialize(&missing_variant_request)
        .unwrap_err()
        .to_string()
        .contains("requires variant_id"));
    let mut dropped_namespace = records[0].clone();
    dropped_namespace.cache_namespace_fingerprints.clear();
    assert!(dropped_namespace
        .validate_against_request(&request)
        .unwrap_err()
        .to_string()
        .contains("dropped or changed"));
    let mut wrong_handle_kind = records[0].clone();
    wrong_handle_kind.handle.kind = HandleKind::Artifact;
    assert!(wrong_handle_kind
        .validate()
        .unwrap_err()
        .to_string()
        .contains("non-prediction handle"));

    let alternate_cache_namespace_fingerprints = vec!["c".repeat(64), "d".repeat(64)];
    let mut alternate_cache = cache.clone();
    alternate_cache.cache_namespace_fingerprints = alternate_cache_namespace_fingerprints.clone();
    let mut alternate_payload =
        build_prediction_cache_payload(&requirement, ctx.prediction_store.blocks()).unwrap();
    alternate_payload.cache_namespace_fingerprints = alternate_cache_namespace_fingerprints;
    let alternate_bundle = build_execution_bundle_with_prediction_contracts(
        bundle.bundle_id.clone(),
        &plan,
        bundle.selected_variant_id.clone(),
        BTreeMap::new(),
        Vec::new(),
        vec![requirement.clone()],
        vec![alternate_cache.clone()],
    )
    .unwrap();
    let alternate_payload_set = BundlePredictionCachePayloadSet {
        bundle_id: alternate_bundle.bundle_id.clone(),
        schema_version: PREDICTION_CACHE_PAYLOAD_SCHEMA_VERSION,
        caches: vec![alternate_payload],
    };
    let alternate_store =
        InMemoryPredictionCacheStore::from_payloads(&alternate_bundle, alternate_payload_set)
            .unwrap();
    let alternate_handle = alternate_store
        .materialize(&PredictionCacheMaterializationRequest {
            run_id: request.run_id.clone(),
            bundle_id: request.bundle_id.clone(),
            phase: request.phase,
            variant_id: request.variant_id.clone(),
            requirement,
            cache: alternate_cache,
            producer_controller_id: request.producer_controller_id.clone(),
        })
        .unwrap();
    assert_ne!(
        alternate_handle.handle, handle.handle,
        "D10 namespace fingerprints must participate in materialized cache handle identity"
    );
}

#[test]
fn prediction_cache_stores_load_and_materialize_aggregated_payloads() {
    let plan = build_execution_plan(
        "plan:oof.edge.aggregated.cache.store",
        oof_edge_graph(),
        oof_edge_campaign(),
        &oof_edge_manifests(BTreeSet::from([Phase::FitCv, Phase::Refit])),
    )
    .unwrap();
    let target_a = PredictionUnitId::Target(TargetId::new("target:a").unwrap());
    let target_b = PredictionUnitId::Target(TargetId::new("target:b").unwrap());
    let requirement = BundlePredictionRequirement {
        producer_node: NodeId::new("model:base").unwrap(),
        source_port: "pred".to_string(),
        consumer_node: NodeId::new("model:meta").unwrap(),
        target_port: "pred".to_string(),
        partition: PredictionPartition::Validation,
        prediction_level: PredictionLevel::Target,
        fold_ids: vec![
            FoldId::new("fold:0").unwrap(),
            FoldId::new("fold:1").unwrap(),
        ],
        unit_ids: vec![target_a.clone(), target_b.clone()],
        sample_ids: Vec::new(),
        prediction_width: 1,
        target_names: vec!["y".to_string()],
    };
    let aggregated_blocks = vec![
        AggregatedPredictionBlock {
            prediction_id: Some("prediction:model:base.target.fold0".to_string()),
            producer_node: requirement.producer_node.clone(),
            producer_port: Some("pred".to_string()),
            partition: PredictionPartition::Validation,
            fold_id: Some(FoldId::new("fold:0").unwrap()),
            level: PredictionLevel::Target,
            unit_ids: vec![target_a],
            values: vec![vec![0.5]],
            target_names: vec!["y".to_string()],
        },
        AggregatedPredictionBlock {
            prediction_id: Some("prediction:model:base.target.fold1".to_string()),
            producer_node: requirement.producer_node.clone(),
            producer_port: Some("pred".to_string()),
            partition: PredictionPartition::Validation,
            fold_id: Some(FoldId::new("fold:1").unwrap()),
            level: PredictionLevel::Target,
            unit_ids: vec![target_b],
            values: vec![vec![0.7]],
            target_names: vec!["y".to_string()],
        },
    ];
    let cache = build_aggregated_prediction_cache_record(&requirement, &aggregated_blocks).unwrap();
    let payload =
        build_aggregated_prediction_cache_payload(&requirement, &aggregated_blocks).unwrap();
    let bundle = build_execution_bundle_with_prediction_contracts(
        BundleId::new("bundle:aggregated.prediction.cache").unwrap(),
        &plan,
        Some(plan.variants[0].variant_id.clone()),
        BTreeMap::new(),
        Vec::new(),
        vec![requirement.clone()],
        vec![cache.clone()],
    )
    .unwrap();
    let payload_set = BundlePredictionCachePayloadSet {
        bundle_id: bundle.bundle_id.clone(),
        schema_version: PREDICTION_CACHE_PAYLOAD_SCHEMA_VERSION,
        caches: vec![payload.clone()],
    };

    let in_memory =
        InMemoryPredictionCacheStore::from_payloads(&bundle, payload_set.clone()).unwrap();
    assert!(in_memory.load_blocks(&requirement.key()).is_err());
    assert_eq!(
        in_memory
            .load_aggregated_blocks(&requirement.key())
            .unwrap(),
        aggregated_blocks
    );
    let handle = in_memory
        .materialize(&PredictionCacheMaterializationRequest {
            run_id: RunId::new("run:oof.edge.aggregated.cache.store.replay").unwrap(),
            bundle_id: bundle.bundle_id.clone(),
            phase: Phase::Refit,
            variant_id: bundle.selected_variant_id.clone(),
            requirement: requirement.clone(),
            cache: cache.clone(),
            producer_controller_id: ControllerId::new("controller:model").unwrap(),
        })
        .unwrap();
    assert_eq!(handle.kind, HandleKind::Prediction);

    let columnar =
        ColumnarPredictionCacheStore::from_payloads(&bundle, payload_set.clone()).unwrap();
    assert_eq!(columnar.entry_count(), 1);
    let manifest = columnar.manifests();
    assert_eq!(manifest.len(), 1);
    assert_eq!(manifest[0].prediction_level, PredictionLevel::Target);
    assert_eq!(manifest[0].value_count, 2);
    assert!(columnar.load_blocks(&requirement.key()).is_err());
    assert_eq!(
        columnar.load_aggregated_blocks(&requirement.key()).unwrap(),
        aggregated_blocks
    );
    let columnar_handle = columnar
        .materialize(&PredictionCacheMaterializationRequest {
            run_id: RunId::new("run:oof.edge.aggregated.columnar.cache.store.replay").unwrap(),
            bundle_id: bundle.bundle_id.clone(),
            phase: Phase::Refit,
            variant_id: bundle.selected_variant_id.clone(),
            requirement: requirement.clone(),
            cache: cache.clone(),
            producer_controller_id: ControllerId::new("controller:model").unwrap(),
        })
        .unwrap();
    assert_eq!(columnar_handle.kind, HandleKind::Prediction);

    let root = temp_prediction_cache_dir("dag_ml_aggregated_prediction_cache_store");
    let manifest =
        FilePredictionCacheStore::write_payload_set(&root, &bundle, &payload_set).unwrap();
    assert_eq!(manifest.caches[0].prediction_level, PredictionLevel::Target);
    assert_eq!(manifest.caches[0].unit_ids, requirement.unit_ids);
    let file_store = FilePredictionCacheStore::open(root.clone(), &bundle).unwrap();
    assert_eq!(
        file_store
            .load_aggregated_blocks(&requirement.key())
            .unwrap(),
        aggregated_blocks
    );
    let _ = fs::remove_dir_all(root);
}

#[test]
fn columnar_prediction_cache_block_round_trips_multi_target_rows() {
    let block = PredictionBlock {
        prediction_id: Some("pred:wide".to_string()),
        producer_node: NodeId::new("model:wide").unwrap(),
        producer_port: Some("pred".to_string()),
        partition: PredictionPartition::Validation,
        fold_id: Some(FoldId::new("fold:0").unwrap()),
        sample_ids: vec![SampleId::new("s1").unwrap(), SampleId::new("s2").unwrap()],
        values: vec![vec![1.0, 10.0], vec![2.0, 20.0]],
        target_names: vec!["y0".to_string(), "y1".to_string()],
    };

    let columnar = ColumnarPredictionCacheBlock::from_prediction_block(&block).unwrap();
    assert_eq!(columnar.width, 2);
    assert_eq!(columnar.row_count(), 2);
    assert_eq!(columnar.value_count(), 4);
    assert_eq!(columnar.columns, vec![vec![1.0, 2.0], vec![10.0, 20.0]]);
    assert_eq!(columnar.to_prediction_block().unwrap(), block);
}

#[test]
fn columnar_prediction_cache_block_round_trips_aggregated_units() {
    let block = AggregatedPredictionBlock {
        prediction_id: Some("pred:target".to_string()),
        producer_node: NodeId::new("model:target").unwrap(),
        producer_port: None,
        partition: PredictionPartition::Validation,
        fold_id: Some(FoldId::new("fold:0").unwrap()),
        level: PredictionLevel::Target,
        unit_ids: vec![
            PredictionUnitId::Target(TargetId::new("target:a").unwrap()),
            PredictionUnitId::Target(TargetId::new("target:b").unwrap()),
        ],
        values: vec![vec![1.0, 10.0], vec![2.0, 20.0]],
        target_names: vec!["y0".to_string(), "y1".to_string()],
    };

    let columnar = ColumnarPredictionCacheBlock::from_aggregated_prediction_block(&block).unwrap();
    assert_eq!(columnar.prediction_level, PredictionLevel::Target);
    assert_eq!(columnar.row_count(), 2);
    assert_eq!(columnar.value_count(), 4);
    assert_eq!(columnar.columns, vec![vec![1.0, 2.0], vec![10.0, 20.0]]);
    assert!(columnar.to_prediction_block().is_err());
    assert_eq!(columnar.to_aggregated_prediction_block().unwrap(), block);
}

#[test]
fn columnar_prediction_cache_store_loads_and_materializes_oof_payloads() {
    let plan = build_execution_plan(
        "plan:oof.edge.columnar.cache.store",
        oof_edge_graph(),
        oof_edge_campaign(),
        &oof_edge_manifests(BTreeSet::from([Phase::FitCv, Phase::Refit])),
    )
    .unwrap();
    let fit_controllers = oof_edge_runtime_controllers(
        Some(PredictionPartition::Validation),
        OofSampleMode::Aligned,
    );
    let mut ctx = RunContext::new(
        RunId::new("run:oof.edge.columnar.cache.store").unwrap(),
        Some(11),
    );
    SequentialScheduler
        .execute_campaign_phase(&plan, &fit_controllers, &mut ctx, Phase::FitCv)
        .unwrap();

    let requirement = BundlePredictionRequirement {
        producer_node: NodeId::new("model:base").unwrap(),
        source_port: "pred".to_string(),
        consumer_node: NodeId::new("model:meta").unwrap(),
        target_port: "pred".to_string(),
        partition: PredictionPartition::Validation,
        prediction_level: PredictionLevel::Sample,
        fold_ids: vec![
            FoldId::new("fold:0").unwrap(),
            FoldId::new("fold:1").unwrap(),
        ],
        unit_ids: Vec::new(),
        sample_ids: vec![SampleId::new("s1").unwrap(), SampleId::new("s2").unwrap()],
        prediction_width: 1,
        target_names: vec!["y".to_string()],
    };
    let mut cache =
        build_prediction_cache_record(&requirement, ctx.prediction_store.blocks()).unwrap();
    let mut payload =
        build_prediction_cache_payload(&requirement, ctx.prediction_store.blocks()).unwrap();
    let cache_namespace_fingerprints = vec!["c".repeat(64), "d".repeat(64)];
    cache.cache_namespace_fingerprints = cache_namespace_fingerprints.clone();
    payload.cache_namespace_fingerprints = cache_namespace_fingerprints.clone();
    let bundle = build_execution_bundle_with_prediction_contracts(
        BundleId::new("bundle:oof.edge.columnar.cache.store").unwrap(),
        &plan,
        Some(plan.variants[0].variant_id.clone()),
        BTreeMap::new(),
        Vec::new(),
        vec![requirement.clone()],
        vec![cache.clone()],
    )
    .unwrap();
    let payload_set = BundlePredictionCachePayloadSet {
        bundle_id: bundle.bundle_id.clone(),
        schema_version: PREDICTION_CACHE_PAYLOAD_SCHEMA_VERSION,
        caches: vec![payload],
    };
    let store = ColumnarPredictionCacheStore::from_payloads(&bundle, payload_set).unwrap();
    assert_eq!(store.entry_count(), 1);
    let manifest = store.manifests();
    assert_eq!(manifest.len(), 1);
    assert_eq!(manifest[0].requirement_key, requirement.key());
    assert_eq!(
        manifest[0].cache_namespace_fingerprints,
        cache_namespace_fingerprints
    );
    assert_eq!(manifest[0].prediction_level, PredictionLevel::Sample);
    assert_eq!(manifest[0].value_count, 2);
    assert_eq!(manifest[0].estimated_value_bytes, 16);
    assert_eq!(store.load_blocks(&requirement.key()).unwrap().len(), 2);

    let request = PredictionCacheMaterializationRequest {
        run_id: RunId::new("run:oof.edge.columnar.cache.store.replay").unwrap(),
        bundle_id: bundle.bundle_id.clone(),
        phase: Phase::Refit,
        variant_id: bundle.selected_variant_id.clone(),
        requirement: requirement.clone(),
        cache,
        producer_controller_id: ControllerId::new("controller:model").unwrap(),
    };
    let handle = store.materialize(&request).unwrap();
    assert_eq!(handle.kind, HandleKind::Prediction);
    assert_eq!(
        handle.owner_controller,
        ControllerId::new("controller:model").unwrap()
    );
    let records = store.materialization_records();
    assert_eq!(records.len(), 1);
    assert_eq!(records[0].requirement_key, requirement.key());
    assert_eq!(
        records[0].cache_namespace_fingerprints,
        cache_namespace_fingerprints
    );
    assert_eq!(records[0].handle, handle);
    records[0].validate_against_request(&request).unwrap();
}

#[test]
fn file_prediction_cache_store_round_trips_oof_payloads_and_detects_tampering() {
    let plan = build_execution_plan(
        "plan:oof.edge.file.cache.store",
        oof_edge_graph(),
        oof_edge_campaign(),
        &oof_edge_manifests(BTreeSet::from([Phase::FitCv, Phase::Refit])),
    )
    .unwrap();
    let fit_controllers = oof_edge_runtime_controllers(
        Some(PredictionPartition::Validation),
        OofSampleMode::Aligned,
    );
    let mut ctx = RunContext::new(
        RunId::new("run:oof.edge.file.cache.store").unwrap(),
        Some(11),
    );
    SequentialScheduler
        .execute_campaign_phase(&plan, &fit_controllers, &mut ctx, Phase::FitCv)
        .unwrap();

    let requirement = BundlePredictionRequirement {
        producer_node: NodeId::new("model:base").unwrap(),
        source_port: "pred".to_string(),
        consumer_node: NodeId::new("model:meta").unwrap(),
        target_port: "pred".to_string(),
        partition: PredictionPartition::Validation,
        prediction_level: PredictionLevel::Sample,
        fold_ids: vec![
            FoldId::new("fold:0").unwrap(),
            FoldId::new("fold:1").unwrap(),
        ],
        unit_ids: Vec::new(),
        sample_ids: vec![SampleId::new("s1").unwrap(), SampleId::new("s2").unwrap()],
        prediction_width: 1,
        target_names: vec!["y".to_string()],
    };
    let mut cache =
        build_prediction_cache_record(&requirement, ctx.prediction_store.blocks()).unwrap();
    let mut payload =
        build_prediction_cache_payload(&requirement, ctx.prediction_store.blocks()).unwrap();
    let cache_namespace_fingerprints = vec!["e".repeat(64), "f".repeat(64)];
    cache.cache_namespace_fingerprints = cache_namespace_fingerprints.clone();
    payload.cache_namespace_fingerprints = cache_namespace_fingerprints.clone();
    let bundle = build_execution_bundle_with_prediction_contracts(
        BundleId::new("bundle:oof.edge.file.cache.store").unwrap(),
        &plan,
        Some(plan.variants[0].variant_id.clone()),
        BTreeMap::new(),
        Vec::new(),
        vec![requirement.clone()],
        vec![cache.clone()],
    )
    .unwrap();
    let payload_set = BundlePredictionCachePayloadSet {
        bundle_id: bundle.bundle_id.clone(),
        schema_version: PREDICTION_CACHE_PAYLOAD_SCHEMA_VERSION,
        caches: vec![payload],
    };
    let root = temp_prediction_cache_dir("dag_ml_file_prediction_cache_store");

    let manifest =
        FilePredictionCacheStore::write_payload_set(&root, &bundle, &payload_set).unwrap();
    assert_eq!(manifest.caches.len(), 1);
    assert_eq!(manifest.caches[0].prediction_level, PredictionLevel::Sample);
    assert_eq!(
        manifest.caches[0].cache_namespace_fingerprints,
        cache_namespace_fingerprints
    );
    assert!(root.join(FILE_PREDICTION_CACHE_MANIFEST_FILE).exists());
    assert!(root.join(&manifest.caches[0].file_name).exists());

    let alternate_cache_namespace_fingerprints = vec!["1".repeat(64), "2".repeat(64)];
    let mut alternate_cache = cache.clone();
    alternate_cache.cache_namespace_fingerprints = alternate_cache_namespace_fingerprints.clone();
    let mut alternate_payload =
        build_prediction_cache_payload(&requirement, ctx.prediction_store.blocks()).unwrap();
    alternate_payload.cache_namespace_fingerprints = alternate_cache_namespace_fingerprints;
    let alternate_bundle = build_execution_bundle_with_prediction_contracts(
        bundle.bundle_id.clone(),
        &plan,
        bundle.selected_variant_id.clone(),
        BTreeMap::new(),
        Vec::new(),
        vec![requirement.clone()],
        vec![alternate_cache],
    )
    .unwrap();
    let alternate_payload_set = BundlePredictionCachePayloadSet {
        bundle_id: alternate_bundle.bundle_id.clone(),
        schema_version: PREDICTION_CACHE_PAYLOAD_SCHEMA_VERSION,
        caches: vec![alternate_payload],
    };
    let alternate_root =
        temp_prediction_cache_dir("dag_ml_file_prediction_cache_store_alternate_namespace");
    let alternate_manifest = FilePredictionCacheStore::write_payload_set(
        &alternate_root,
        &alternate_bundle,
        &alternate_payload_set,
    )
    .unwrap();
    assert_ne!(
        alternate_manifest.caches[0].file_name, manifest.caches[0].file_name,
        "D10 namespace fingerprints must participate in file payload identity"
    );

    let store = FilePredictionCacheStore::open(root.clone(), &bundle).unwrap();
    assert_eq!(store.manifest().caches, manifest.caches);
    assert_eq!(store.load_blocks(&requirement.key()).unwrap().len(), 2);
    let request = PredictionCacheMaterializationRequest {
        run_id: RunId::new("run:oof.edge.file.cache.store.replay").unwrap(),
        bundle_id: bundle.bundle_id.clone(),
        phase: Phase::Refit,
        variant_id: bundle.selected_variant_id.clone(),
        requirement: requirement.clone(),
        cache: cache.clone(),
        producer_controller_id: ControllerId::new("controller:model").unwrap(),
    };
    let handle = store.materialize(&request).unwrap();
    assert_eq!(handle.kind, HandleKind::Prediction);
    let records = store.materialization_records();
    assert_eq!(records.len(), 1);
    assert_eq!(
        records[0].cache_namespace_fingerprints,
        cache_namespace_fingerprints
    );
    records[0].validate_against_request(&request).unwrap();

    let payload_path = root.join(&manifest.caches[0].file_name);
    let mut tampered: serde_json::Value =
        serde_json::from_slice(&fs::read(&payload_path).unwrap()).unwrap();
    tampered["blocks"][0]["values"][0][0] = json!(123456.0);
    fs::write(&payload_path, serde_json::to_vec_pretty(&tampered).unwrap()).unwrap();
    let err = store.load_blocks(&requirement.key()).unwrap_err();
    assert!(
        err.to_string().contains("content fingerprint"),
        "unexpected tamper error: {err}"
    );

    let _ = fs::remove_dir_all(root);
    let _ = fs::remove_dir_all(alternate_root);
}

fn portable_artifact_bundle(plan: &ExecutionPlan) -> crate::bundle::ExecutionBundle {
    let model_plan = plan
        .node_plans
        .get(&NodeId::new("model:base").unwrap())
        .unwrap();
    let content_fingerprint = "a".repeat(64);
    build_execution_bundle(
        crate::ids::BundleId::new("bundle:artifact.manifest").unwrap(),
        plan,
        Some(plan.variants[0].variant_id.clone()),
        BTreeMap::new(),
        vec![RefitArtifactRecord {
            node_id: model_plan.node_id.clone(),
            controller_id: model_plan.controller_id.clone(),
            artifact: ArtifactRef {
                id: ArtifactId::new("artifact:model:base:refit").unwrap(),
                kind: "mock_model".to_string(),
                controller_id: model_plan.controller_id.clone(),
                backend: Some(ArtifactBackend::Joblib),
                uri: Some(format!("artifacts/{content_fingerprint}.joblib")),
                content_fingerprint: Some(content_fingerprint),
                size_bytes: Some(128),
                plugin: Some("dagml.mock".to_string()),
                plugin_version: Some("1.0.0".to_string()),
                abi_major: None,
                abi_min_minor: None,
                native_predictor_descriptor: None,
                native_estimator_descriptor: None,
            },
            params_fingerprint: model_plan.params_fingerprint.clone(),
            training_loss_fingerprint: model_plan.training_loss_fingerprint(Phase::Refit).unwrap(),
            data_requirement_keys: vec!["model:base.x".to_string()],
            prediction_requirement_keys: Vec::new(),
        }],
    )
    .unwrap()
}

fn portable_artifact_bundle_with_payload(
    plan: &ExecutionPlan,
    payload: &[u8],
) -> crate::bundle::ExecutionBundle {
    let mut bundle = portable_artifact_bundle(plan);
    let content_fingerprint = sha256_bytes_hex(payload);
    let artifact = &mut bundle.refit_artifacts[0].artifact;
    artifact.uri = Some(format!("artifacts/{content_fingerprint}.joblib"));
    artifact.content_fingerprint = Some(content_fingerprint);
    artifact.size_bytes = Some(payload.len() as u64);
    bundle.validate().unwrap();
    bundle
}

fn write_artifact_payload(root: &Path, bundle: &ExecutionBundle, payload: &[u8]) -> PathBuf {
    let uri = bundle.refit_artifacts[0].artifact.uri.as_deref().unwrap();
    let path = root.join(uri);
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(&path, payload).unwrap();
    path
}

#[test]
fn artifact_ref_validate_portable_rejects_unsafe_uris_and_legacy() {
    let content_fingerprint = "c".repeat(64);
    let base = ArtifactRef {
        id: ArtifactId::new("artifact:model:portable").unwrap(),
        kind: "model".to_string(),
        controller_id: ControllerId::new("controller:sklearn").unwrap(),
        backend: Some(ArtifactBackend::Joblib),
        uri: Some(format!("artifacts/{content_fingerprint}.joblib")),
        content_fingerprint: Some(content_fingerprint),
        size_bytes: Some(4096),
        plugin: Some("dagml.sklearn".to_string()),
        plugin_version: Some("1.0.0".to_string()),
        abi_major: None,
        abi_min_minor: None,
        native_predictor_descriptor: None,
        native_estimator_descriptor: None,
    };
    base.validate_portable().unwrap();

    let mut incomplete_abi = base.clone();
    incomplete_abi.abi_major = Some(2);
    assert!(incomplete_abi
        .validate()
        .unwrap_err()
        .to_string()
        .contains("together with abi_min_minor"));

    let mut zero_abi_major = base.clone();
    zero_abi_major.abi_major = Some(0);
    zero_abi_major.abi_min_minor = Some(0);
    assert!(zero_abi_major
        .validate()
        .unwrap_err()
        .to_string()
        .contains("non-zero abi_major"));

    // Legacy artifact: still passes `validate` but is refused as non-portable.
    let legacy = ArtifactRef {
        backend: None,
        uri: None,
        content_fingerprint: None,
        ..base.clone()
    };
    legacy.validate().unwrap();
    assert!(legacy
        .validate_portable()
        .unwrap_err()
        .to_string()
        .contains("not portable"));

    let mut absolute = base.clone();
    absolute.uri = Some("/etc/passwd".to_string());
    assert!(absolute
        .validate_portable()
        .unwrap_err()
        .to_string()
        .contains("must be a relative path"));

    let mut traversal = base.clone();
    traversal.uri = Some("artifacts/../../secret.joblib".to_string());
    assert!(traversal
        .validate_portable()
        .unwrap_err()
        .to_string()
        .contains("`..`"));

    let mut drive = base.clone();
    drive.uri = Some("C:\\models\\model.joblib".to_string());
    assert!(drive
        .validate_portable()
        .unwrap_err()
        .to_string()
        .contains("must be a relative path"));

    // URI schemes and any other colon in the leading path segment are
    // rejected: a strictly relative artifact path never carries a scheme.
    for scheme_uri in [
        "http://example.com/model.joblib",
        "s3://bucket/model.joblib",
        "file:///models/model.joblib",
        "weird:thing/model.joblib",
    ] {
        let mut scheme = base.clone();
        scheme.uri = Some(scheme_uri.to_string());
        let err = scheme.validate_portable().unwrap_err().to_string();
        assert!(
            err.contains("first path segment"),
            "unexpected scheme error for `{scheme_uri}`: {err}"
        );
    }

    // A colon outside the first segment is allowed (not a scheme/drive).
    let mut later_colon = base;
    later_colon.uri = Some("artifacts/model:v1.joblib".to_string());
    later_colon.validate_portable().unwrap();
}

#[test]
fn file_artifact_manifest_round_trips_portable_artifacts() {
    let plan = fixture_plan("plan:artifact.manifest.round.trip");
    let bundle = portable_artifact_bundle(&plan);
    let root = temp_prediction_cache_dir("dag_ml_file_artifact_manifest");

    let manifest = FileArtifactManifestStore::write(&root, &bundle).unwrap();
    assert_eq!(
        manifest.schema_version,
        FILE_ARTIFACT_MANIFEST_SCHEMA_VERSION
    );
    assert_eq!(manifest.artifacts.len(), 1);
    assert_eq!(
        manifest.artifacts[0].artifact.id,
        ArtifactId::new("artifact:model:base:refit").unwrap()
    );
    assert_eq!(
        manifest.artifacts[0].artifact.backend,
        Some(ArtifactBackend::Joblib)
    );
    assert_eq!(
        manifest.artifacts[0].node_id,
        bundle.refit_artifacts[0].node_id
    );
    assert!(root.join(FILE_ARTIFACT_MANIFEST_FILE).exists());

    let store = FileArtifactManifestStore::open(root.clone(), &bundle).unwrap();
    assert_eq!(store.root(), root.as_path());
    assert_eq!(store.manifest().bundle_id, bundle.bundle_id);
    assert_eq!(store.manifest().artifacts, manifest.artifacts);

    let _ = fs::remove_dir_all(root);
}

#[test]
fn file_artifact_manifest_refuses_legacy_non_portable_artifacts() {
    let plan = fixture_plan("plan:artifact.manifest.legacy");
    // `replay_bundle` carries a legacy artifact (no backend/uri/content fingerprint).
    let bundle = replay_bundle(&plan);
    let root = temp_prediction_cache_dir("dag_ml_file_artifact_manifest_legacy");

    let err = FileArtifactManifestStore::write(&root, &bundle).unwrap_err();
    assert!(
        err.to_string().contains("not portable"),
        "unexpected legacy error: {err}"
    );
    assert!(!root.join(FILE_ARTIFACT_MANIFEST_FILE).exists());

    let _ = fs::remove_dir_all(root);
}

#[test]
fn file_artifact_manifest_open_refuses_tampered_entries() {
    let plan = fixture_plan("plan:artifact.manifest.tampered");
    let bundle = portable_artifact_bundle(&plan);
    let root = temp_prediction_cache_dir("dag_ml_file_artifact_manifest_tampered");

    FileArtifactManifestStore::write(&root, &bundle).unwrap();
    let manifest_path = root.join(FILE_ARTIFACT_MANIFEST_FILE);
    let mut tampered: serde_json::Value =
        serde_json::from_slice(&fs::read(&manifest_path).unwrap()).unwrap();
    let tampered_fingerprint = "b".repeat(64);
    tampered["artifacts"][0]["params_fingerprint"] = json!(tampered_fingerprint);
    fs::write(
        &manifest_path,
        serde_json::to_vec_pretty(&tampered).unwrap(),
    )
    .unwrap();

    let err = FileArtifactManifestStore::open(root.clone(), &bundle).unwrap_err();
    assert!(
        err.to_string()
            .contains("does not match bundle refit artifact"),
        "unexpected tamper error: {err}"
    );

    let _ = fs::remove_dir_all(root);
}

#[test]
fn file_artifact_payload_store_validates_payloads_and_materializes_handles() {
    let plan = fixture_plan("plan:artifact.payload.round.trip");
    let payload = b"portable dag-ml artifact payload\n";
    let bundle = portable_artifact_bundle_with_payload(&plan, payload);
    let source_root = temp_prediction_cache_dir("dag_ml_file_artifact_payload_source");
    let store_root = temp_prediction_cache_dir("dag_ml_file_artifact_payload_store");
    let source_path = write_artifact_payload(&source_root, &bundle, payload);

    let store =
        FileArtifactPayloadStore::write_from_source(&store_root, &source_root, &bundle).unwrap();
    assert_eq!(store.root(), store_root.as_path());
    assert_eq!(store.payload_count(), 1);
    assert!(store_root
        .join(bundle.refit_artifacts[0].artifact.uri.as_deref().unwrap())
        .exists());
    assert!(source_path.exists());
    assert_eq!(store.manifest().bundle_id, bundle.bundle_id);

    let artifact = &bundle.refit_artifacts[0];
    let handle = store
        .materialize(&ArtifactMaterializationRequest {
            run_id: RunId::new("run:artifact.payload.materialize").unwrap(),
            bundle_id: bundle.bundle_id.clone(),
            node_id: artifact.node_id.clone(),
            phase: Phase::Predict,
            variant_id: bundle.selected_variant_id.clone(),
            controller_id: artifact.controller_id.clone(),
            artifact: artifact.artifact.clone(),
            params_fingerprint: artifact.params_fingerprint.clone(),
            training_loss_fingerprint: artifact.training_loss_fingerprint.clone(),
        })
        .unwrap();
    assert_eq!(handle.kind, HandleKind::Artifact);
    assert_eq!(handle.owner_controller, artifact.controller_id);
    let records = store.materialization_records();
    assert_eq!(records.len(), 1);
    assert_eq!(records[0].artifact_id, artifact.artifact.id);
    assert_eq!(records[0].size_bytes, payload.len() as u64);
    assert_eq!(
        records[0].content_fingerprint,
        artifact.artifact.content_fingerprint.clone().unwrap()
    );

    let reopened = FileArtifactPayloadStore::open(store_root.clone(), &bundle).unwrap();
    reopened.validate_payloads().unwrap();

    let _ = fs::remove_dir_all(source_root);
    let _ = fs::remove_dir_all(store_root);
}

#[test]
fn file_artifact_payload_store_refuses_tampered_payloads() {
    let plan = fixture_plan("plan:artifact.payload.tampered");
    let payload = b"portable dag-ml artifact payload\n";
    let bundle = portable_artifact_bundle_with_payload(&plan, payload);
    let source_root = temp_prediction_cache_dir("dag_ml_file_artifact_payload_source_tamper");
    let store_root = temp_prediction_cache_dir("dag_ml_file_artifact_payload_store_tamper");
    write_artifact_payload(&source_root, &bundle, payload);
    FileArtifactPayloadStore::write_from_source(&store_root, &source_root, &bundle).unwrap();

    let payload_path = store_root.join(bundle.refit_artifacts[0].artifact.uri.as_deref().unwrap());
    fs::write(&payload_path, vec![b'x'; payload.len()]).unwrap();
    let err = FileArtifactPayloadStore::open(store_root.clone(), &bundle).unwrap_err();
    assert!(
        err.to_string().contains("content fingerprint mismatch"),
        "unexpected tamper error: {err}"
    );

    let _ = fs::remove_dir_all(source_root);
    let _ = fs::remove_dir_all(store_root);
}

#[test]
fn requires_oof_prediction_edge_refit_rejects_incomplete_oof_coverage() {
    let plan = build_execution_plan(
        "plan:oof.edge.refit.incomplete",
        oof_edge_graph(),
        oof_edge_campaign(),
        &oof_edge_manifests(BTreeSet::from([Phase::FitCv, Phase::Refit])),
    )
    .unwrap();
    let mut ctx = RunContext::new(
        RunId::new("run:oof.edge.refit.incomplete").unwrap(),
        Some(11),
    );
    ctx.prediction_store
        .append(PredictionBlock {
            prediction_id: Some("pred:model:base:fold0".to_string()),
            producer_node: NodeId::new("model:base").unwrap(),
            producer_port: None,
            partition: PredictionPartition::Validation,
            fold_id: Some(FoldId::new("fold:0").unwrap()),
            sample_ids: vec![SampleId::new("s1").unwrap()],
            values: vec![vec![0.5]],
            target_names: vec!["y".to_string()],
        })
        .unwrap();
    let controllers = oof_edge_runtime_controllers(None, OofSampleMode::Aligned);

    let error = SequentialScheduler
        .execute_campaign_phase(&plan, &controllers, &mut ctx, Phase::Refit)
        .unwrap_err()
        .to_string();

    assert!(error.contains("do not cover the refit sample universe"));
    assert!(error.contains("cause=partial_oof_without_policy"));
}

#[test]
fn requires_oof_prediction_edge_refit_skips_incomplete_oof_when_explicit() {
    let plan = build_execution_plan(
        "plan:oof.edge.refit.incomplete.skip",
        oof_edge_graph_with_refit_policy("skip_refit_on_incomplete_oof"),
        oof_edge_campaign(),
        &oof_edge_manifests(BTreeSet::from([Phase::FitCv, Phase::Refit])),
    )
    .unwrap();
    let mut ctx = RunContext::new(
        RunId::new("run:oof.edge.refit.incomplete.skip").unwrap(),
        Some(11),
    );
    ctx.prediction_store
        .append(PredictionBlock {
            prediction_id: Some("pred:model:base:fold0".to_string()),
            producer_node: NodeId::new("model:base").unwrap(),
            producer_port: None,
            partition: PredictionPartition::Validation,
            fold_id: Some(FoldId::new("fold:0").unwrap()),
            sample_ids: vec![SampleId::new("s1").unwrap()],
            values: vec![vec![0.5]],
            target_names: vec!["y".to_string()],
        })
        .unwrap();
    let controllers = oof_edge_runtime_controllers(None, OofSampleMode::Aligned);

    let results = SequentialScheduler
        .execute_campaign_phase(&plan, &controllers, &mut ctx, Phase::Refit)
        .unwrap();

    assert_eq!(
        results
            .iter()
            .filter(|result| result.node_id.as_str() == "model:meta")
            .count(),
        0
    );
    assert_eq!(
        results
            .iter()
            .filter(|result| result.node_id.as_str() == "model:base")
            .count(),
        1
    );
}

#[test]
fn requires_oof_prediction_edge_refit_cv_only_skips_without_oof() {
    let plan = build_execution_plan(
        "plan:oof.edge.refit.cv_only",
        oof_edge_graph_with_refit_policy("cv_only"),
        oof_edge_campaign(),
        &oof_edge_manifests(BTreeSet::from([Phase::FitCv, Phase::Refit])),
    )
    .unwrap();
    let controllers = oof_edge_runtime_controllers(None, OofSampleMode::Aligned);
    let mut ctx = RunContext::new(RunId::new("run:oof.edge.refit.cv_only").unwrap(), Some(11));

    let results = SequentialScheduler
        .execute_campaign_phase(&plan, &controllers, &mut ctx, Phase::Refit)
        .unwrap();

    assert_eq!(
        results
            .iter()
            .filter(|result| result.node_id.as_str() == "model:meta")
            .count(),
        0
    );
    assert_eq!(
        results
            .iter()
            .filter(|result| result.node_id.as_str() == "model:base")
            .count(),
        1
    );
}

#[test]
fn requires_oof_prediction_edge_refit_rejects_missing_validation_predictions() {
    // REGRESSION (0681cc6 dropped the empty-OOF guard from `validate_refit_oof_edge`): a direct REFIT
    // with NO validation OOF at all — the FIT_CV phase was never run for the producer — must report the
    // missing-OOF edge ("requires OOF validation predictions"), the same contract `validate_fit_cv_oof_edge`
    // and `validate_refit_aggregated_oof_edge` enforce, instead of mislabeling zero coverage as
    // `partial_oof_without_policy`. Only the default full-coverage policy turns empty into this error;
    // `cv_only` / `skip_refit_on_incomplete_oof` still skip REFIT with zero OOF (see the two tests above).
    let plan = build_execution_plan(
        "plan:oof.edge.refit.missing",
        oof_edge_graph(),
        oof_edge_campaign(),
        &oof_edge_manifests(BTreeSet::from([Phase::FitCv, Phase::Refit])),
    )
    .unwrap();
    let controllers = oof_edge_runtime_controllers(None, OofSampleMode::Aligned);
    let mut ctx = RunContext::new(RunId::new("run:oof.edge.refit.missing").unwrap(), Some(11));

    let error = SequentialScheduler
        .execute_campaign_phase(&plan, &controllers, &mut ctx, Phase::Refit)
        .unwrap_err()
        .to_string();

    assert!(
        error.contains("requires OOF validation predictions"),
        "got: {error}"
    );
    assert!(error.contains("model:base"), "got: {error}");
    assert!(
        !error.contains("partial_oof_without_policy"),
        "empty OOF must not be reported as partial coverage, got: {error}"
    );
}

#[test]
fn refit_oof_cover_is_partition_mode_aware() {
    // REGRESSION (8dd4c6e over-rejected ShuffleSplit): the refit OOF-coverage edge validator must be
    // FoldPartitionMode-aware. Under Partition (KFold) a sample covered by two folds is a duplicated
    // fold and stays REJECTED; under Resampled (ShuffleSplit / repeated CV) a sample is legitimately
    // validated in several folds (its predictions are averaged), so the across-fold multiplicity PASSES.
    let edge = EdgeSpec {
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
    };
    let val_block = |fold: &str, samples: &[&str]| PredictionBlock {
        prediction_id: None,
        producer_node: NodeId::new("model:base").unwrap(),
        producer_port: None,
        partition: PredictionPartition::Validation,
        fold_id: Some(FoldId::new(fold).unwrap()),
        sample_ids: samples.iter().map(|s| SampleId::new(*s).unwrap()).collect(),
        values: samples.iter().map(|_| vec![0.5]).collect(),
        target_names: vec!["y".to_string()],
    };

    // Resampled fold set: two ShuffleSplit folds both validate s1 (legitimate cross-fold overlap), and
    // together cover the universe {s1, s2, s3}.
    let resampled = FoldSet {
        id: "resampled".to_string(),
        sample_ids: ["s1", "s2", "s3"]
            .iter()
            .map(|s| SampleId::new(*s).unwrap())
            .collect(),
        folds: vec![
            FoldAssignment {
                fold_id: FoldId::new("fold:0").unwrap(),
                train_sample_ids: vec![SampleId::new("s3").unwrap()],
                validation_sample_ids: ["s1", "s2"]
                    .iter()
                    .map(|s| SampleId::new(*s).unwrap())
                    .collect(),
                metadata: BTreeMap::new(),
            },
            FoldAssignment {
                fold_id: FoldId::new("fold:1").unwrap(),
                train_sample_ids: vec![SampleId::new("s2").unwrap()],
                validation_sample_ids: ["s1", "s3"]
                    .iter()
                    .map(|s| SampleId::new(*s).unwrap())
                    .collect(),
                metadata: BTreeMap::new(),
            },
        ],
        sample_groups: BTreeMap::new(),
        partition_mode: FoldPartitionMode::Resampled,
        train_exclusion: FoldTrainExclusion::Relations,
        target_missing_sample_ids: Vec::new(),
    };
    resampled
        .validate()
        .expect("resampled fold set is well-formed");
    let mut resampled_blocks = [
        val_block("fold:0", &["s1", "s2"]),
        val_block("fold:1", &["s1", "s3"]),
    ];
    resampled_blocks[0].values[0] = vec![0.25];
    resampled_blocks[1].values[0] = vec![0.75];
    let resampled_refs = resampled_blocks.iter().collect::<Vec<_>>();
    validate_oof_blocks_cover_fold_set(&edge, &resampled, &resampled_refs)
        .expect("Resampled multiply-validated sample must pass refit OOF coverage");
    let refit_scope = PhaseScope {
        phase: Phase::Refit,
        variant_id: None,
        variant: None,
        fold_id: None,
        seed_root: Some(11),
    };
    let resampled_spec = prediction_input_spec(&edge, &refit_scope, &resampled_refs, true)
        .expect("resampled refit spec should average repeated OOF rows");
    assert_eq!(
        resampled_spec.sample_ids,
        vec![
            SampleId::new("s1").unwrap(),
            SampleId::new("s2").unwrap(),
            SampleId::new("s3").unwrap()
        ]
    );
    assert_eq!(resampled_spec.values[0], vec![0.5]);
    assert!(prediction_input_spec(&edge, &refit_scope, &resampled_refs, false).is_err());

    // Partition fold set with the SAME cross-fold duplicate (s1 in both folds): still rejected.
    let partition = FoldSet {
        partition_mode: FoldPartitionMode::Partition,
        train_exclusion: FoldTrainExclusion::Relations,
        target_missing_sample_ids: Vec::new(),
        ..resampled.clone()
    };
    let err = validate_oof_blocks_cover_fold_set(&edge, &partition, &resampled_refs).unwrap_err();
    assert!(
        err.to_string().contains("duplicate OOF prediction")
            || err.to_string().contains("do not match validation samples"),
        "Partition cross-fold duplicate must still be rejected: {err}"
    );
}

#[test]
fn data_bindings_require_runtime_provider_and_materialize_handles() {
    let model_id = NodeId::new("model:pls").unwrap();
    let plan = build_execution_plan(
        "plan:data",
        simple_graph(),
        CampaignSpec {
            inner_cv: None,
            id: "campaign:data".to_string(),
            root_seed: Some(11),
            leakage_policy: Default::default(),
            aggregation_policy: Default::default(),
            split_invocation: None,
            generation: Default::default(),
            shape_plans: BTreeMap::new(),
            data_bindings: BTreeMap::from([(model_id.clone(), vec![data_binding(&model_id)])]),
            branch_view_plans: Vec::new(),
            metadata: BTreeMap::new(),
        },
        &manifests(),
    )
    .unwrap();
    let controllers = runtime_controllers();
    let mut ctx = RunContext::new(RunId::new("run:data").unwrap(), Some(11));

    assert!(SequentialScheduler
        .execute_phase(&plan, &controllers, &mut ctx, Phase::FitCv)
        .is_err());

    let envelope: ExternalDataPlanEnvelope = serde_json::from_str(include_str!(
        "../../tests/fixtures/package/data/coordinator_data_plan_envelope_sample12.json"
    ))
    .unwrap();
    let provider = InMemoryDataProvider::with_envelope(
        ControllerId::new("controller:data.provider").unwrap(),
        envelope,
    )
    .unwrap();
    let mut ctx = RunContext::new(RunId::new("run:data.provider").unwrap(), Some(11));
    let results = SequentialScheduler
        .execute_phase_with_data_provider(&plan, &controllers, &provider, &mut ctx, Phase::FitCv)
        .unwrap();

    assert_eq!(results.len(), 2);
    assert_eq!(provider.handle_records().len(), 1);
    assert_eq!(provider.view_records().len(), 1);
    assert_eq!(provider.handle_records()[0].input_name, "x");
    assert_eq!(provider.handle_records()[0].relation_record_count, Some(4));
    assert_eq!(provider.view_records()[0].handle.kind, HandleKind::DataView);
    assert_eq!(
        provider.view_records()[0].parent_handle,
        provider.handle_records()[0].handle
    );
}

#[test]
fn campaign_data_bindings_create_fold_train_views() {
    let model_id = NodeId::new("model:pls").unwrap();
    let plan = build_execution_plan(
        "plan:data.folds",
        simple_graph(),
        CampaignSpec {
            inner_cv: None,
            id: "campaign:data.folds".to_string(),
            root_seed: Some(11),
            leakage_policy: Default::default(),
            aggregation_policy: Default::default(),
            split_invocation: Some(SplitInvocation {
                id: "split:outer".to_string(),
                controller_id: None,
                leakage_policy: Default::default(),
                params: BTreeMap::new(),
                fold_set: Some(two_fold_set()),
            }),
            generation: Default::default(),
            shape_plans: BTreeMap::new(),
            data_bindings: BTreeMap::from([(
                model_id,
                vec![data_binding(&NodeId::new("model:pls").unwrap())],
            )]),
            branch_view_plans: Vec::new(),
            metadata: BTreeMap::new(),
        },
        &manifests(),
    )
    .unwrap();
    let envelope: ExternalDataPlanEnvelope = serde_json::from_str(include_str!(
        "../../tests/fixtures/package/data/coordinator_data_plan_envelope_sample12.json"
    ))
    .unwrap();
    let provider = InMemoryDataProvider::with_envelope(
        ControllerId::new("controller:data.provider").unwrap(),
        envelope,
    )
    .unwrap();
    let controllers = runtime_controllers();
    let mut ctx = RunContext::new(RunId::new("run:data.folds").unwrap(), Some(11));

    let results = SequentialScheduler
        .execute_campaign_phase_with_data_provider(
            &plan,
            &controllers,
            &provider,
            &mut ctx,
            Phase::FitCv,
        )
        .unwrap();

    assert_eq!(results.len(), 4);
    assert_eq!(provider.handle_records().len(), 2);
    let views = provider.view_records();
    assert_eq!(views.len(), 4);
    assert!(views
        .iter()
        .all(|view| view.handle.kind == HandleKind::DataView));
    let train_views = views
        .iter()
        .filter(|view| view.view.partition == DataRequestPartition::FoldTrain)
        .collect::<Vec<_>>();
    let validation_views = views
        .iter()
        .filter(|view| view.view.partition == DataRequestPartition::FoldValidation)
        .collect::<Vec<_>>();
    assert_eq!(train_views.len(), 2);
    assert_eq!(validation_views.len(), 2);
    assert_eq!(
        train_views[0].view.sample_ids,
        Some(vec![SampleId::new("s2").unwrap()])
    );
    assert_eq!(
        validation_views[0].view.sample_ids,
        Some(vec![SampleId::new("s1").unwrap()])
    );
    assert_eq!(
        train_views[1].view.sample_ids,
        Some(vec![SampleId::new("s1").unwrap()])
    );
    assert_eq!(
        validation_views[1].view.sample_ids,
        Some(vec![SampleId::new("s2").unwrap()])
    );
}

#[test]
fn data_edges_propagate_fold_views_from_data_producing_nodes() {
    let augment_id = NodeId::new("augment:noise").unwrap();
    let model_id = NodeId::new("model:branch").unwrap();
    let before_feature_schema = "a".repeat(64);
    let after_feature_schema = "b".repeat(64);
    let shape_plan = DataModelShapePlan {
        node_id: augment_id.clone(),
        input_granularity: Granularity::Sample,
        target_granularity: Granularity::Sample,
        fit_rows: FitBoundary::FoldTrain,
        predict_rows: FitBoundary::FoldValidation,
        feature_namespace: Some("augmented.noise".to_string()),
        feature_schema_fingerprint: Some(before_feature_schema.clone()),
        target_space: "raw".to_string(),
        aggregation_policy: AggregationPolicy::default(),
        augmentation_policy: Default::default(),
        selection_policy: Default::default(),
    };
    let shape_plan_fingerprint = stable_json_fingerprint(&shape_plan).unwrap();
    let graph = GraphSpec {
        id: "g:data.edge.views".to_string(),
        interface: GraphInterface::default(),
        nodes: vec![
            node(
                augment_id.as_str(),
                NodeKind::Augmentation,
                vec![port("x", PortKind::Data)],
                vec![port("x_out", PortKind::Data)],
            ),
            node(
                model_id.as_str(),
                NodeKind::Model,
                vec![port("x", PortKind::Data)],
                vec![port("oof", PortKind::Prediction)],
            ),
        ],
        edges: vec![EdgeSpec {
            source: PortRef {
                node_id: augment_id.clone(),
                port_name: "x_out".to_string(),
            },
            target: PortRef {
                node_id: model_id.clone(),
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
    };
    let mut manifest_registry = ControllerRegistry::new();
    manifest_registry
        .register(controller_manifest(
            "controller:augmentation",
            NodeKind::Augmentation,
        ))
        .unwrap();
    manifest_registry
        .register(controller_manifest(
            "controller:model.probe",
            NodeKind::Model,
        ))
        .unwrap();
    let plan = build_execution_plan(
        "plan:data.edge.views",
        graph,
        CampaignSpec {
            inner_cv: None,
            id: "campaign:data.edge.views".to_string(),
            root_seed: Some(11),
            leakage_policy: Default::default(),
            aggregation_policy: Default::default(),
            split_invocation: Some(SplitInvocation {
                id: "split:outer".to_string(),
                controller_id: None,
                leakage_policy: Default::default(),
                params: BTreeMap::new(),
                fold_set: Some(two_fold_set()),
            }),
            generation: Default::default(),
            shape_plans: BTreeMap::from([(augment_id.clone(), shape_plan)]),
            data_bindings: BTreeMap::from([(augment_id.clone(), vec![data_binding(&augment_id)])]),
            branch_view_plans: Vec::new(),
            metadata: BTreeMap::new(),
        },
        &manifest_registry,
    )
    .unwrap();
    let envelope: ExternalDataPlanEnvelope = serde_json::from_str(include_str!(
        "../../tests/fixtures/package/data/coordinator_data_plan_envelope_sample12.json"
    ))
    .unwrap();
    let provider = InMemoryDataProvider::with_envelope(
        ControllerId::new("controller:data.provider").unwrap(),
        envelope,
    )
    .unwrap();
    let observed_views = Arc::new(Mutex::new(Vec::new()));
    let mut controllers = RuntimeControllerRegistry::new();
    controllers
        .register(Box::new(ShapeDataController {
            id: ControllerId::new("controller:augmentation").unwrap(),
            handle: 3,
            before_feature_schema: before_feature_schema.clone(),
            after_feature_schema: after_feature_schema.clone(),
        }))
        .unwrap();
    controllers
        .register(Box::new(DataViewProbeController {
            id: ControllerId::new("controller:model.probe").unwrap(),
            observed_views: observed_views.clone(),
            prediction_sample_ids: None,
        }))
        .unwrap();
    let mut ctx = RunContext::new(RunId::new("run:data.edge.views").unwrap(), Some(11));

    let results = SequentialScheduler
        .execute_campaign_phase_with_data_provider(
            &plan,
            &controllers,
            &provider,
            &mut ctx,
            Phase::FitCv,
        )
        .unwrap();

    assert_eq!(results.len(), 4);
    assert_eq!(provider.view_records().len(), 4);
    let observed_views = observed_views.lock().unwrap();
    assert_eq!(observed_views.len(), 2);
    for views in observed_views.iter() {
        let primary = views.get("data:x").expect("primary propagated data view");
        let validation = views
            .get("data:x:validation")
            .expect("validation propagated data view");
        for view in [primary, validation] {
            let provenance = view
                .output_provenance()
                .unwrap()
                .expect("output data provenance metadata");
            assert_eq!(
                provenance.producer_node,
                NodeId::new("augment:noise").unwrap()
            );
            assert_eq!(provenance.producer_port, "x_out");
            assert_eq!(
                provenance.shape_plan_fingerprint,
                Some(shape_plan_fingerprint.clone())
            );
            assert_eq!(
                provenance.feature_schema_fingerprint,
                Some(after_feature_schema.clone())
            );
            assert_eq!(provenance.shape_deltas.len(), 1);
        }
    }
    let samples_by_fold = ctx
        .prediction_store
        .blocks()
        .iter()
        .filter(|block| block.producer_node == model_id)
        .map(|block| {
            (
                block.fold_id.as_ref().unwrap().to_string(),
                block.sample_ids.clone(),
            )
        })
        .collect::<BTreeMap<_, _>>();
    assert_eq!(
        samples_by_fold["fold:0"],
        vec![SampleId::new("s1").unwrap()]
    );
    assert_eq!(
        samples_by_fold["fold:1"],
        vec![SampleId::new("s2").unwrap()]
    );

    let mut bad_controllers = RuntimeControllerRegistry::new();
    bad_controllers
        .register(Box::new(ShapeDataController {
            id: ControllerId::new("controller:augmentation").unwrap(),
            handle: 5,
            before_feature_schema,
            after_feature_schema,
        }))
        .unwrap();
    bad_controllers
        .register(Box::new(DataViewProbeController {
            id: ControllerId::new("controller:model.probe").unwrap(),
            observed_views: Arc::new(Mutex::new(Vec::new())),
            prediction_sample_ids: Some(vec![SampleId::new("s-outside").unwrap()]),
        }))
        .unwrap();
    let mut bad_ctx = RunContext::new(
        RunId::new("run:data.edge.views.bad-prediction").unwrap(),
        Some(11),
    );
    let error = SequentialScheduler
        .execute_campaign_phase_with_data_provider(
            &plan,
            &bad_controllers,
            &provider,
            &mut bad_ctx,
            Phase::FitCv,
        )
        .unwrap_err()
        .to_string();
    assert!(
        error.contains("outside its validation view"),
        "unexpected propagated-view validation error: {error}"
    );
}

#[test]
fn data_provider_view_validates_typed_output_provenance() {
    let producer = NodeId::new("augment:noise").unwrap();
    let before_feature_schema = "a".repeat(64);
    let after_feature_schema = "b".repeat(64);
    let provenance = DataOutputProvenance {
        schema_version: DATA_OUTPUT_PROVENANCE_SCHEMA_VERSION,
        producer_node: producer.clone(),
        producer_port: "x_out".to_string(),
        producer_phase: Phase::FitCv,
        variant_id: Some(VariantId::new("variant:base").unwrap()),
        fold_id: Some(FoldId::new("fold:0").unwrap()),
        shape_plan_fingerprint: Some("c".repeat(64)),
        aggregation_policy_fingerprint: Some("d".repeat(64)),
        feature_namespace: Some("augmented.noise".to_string()),
        feature_schema_fingerprint: Some(after_feature_schema.clone()),
        representation_plan: None,
        representation_replay_manifest: None,
        representation_compatibility: None,
        relation_delta_fingerprint: None,
        shape_deltas: vec![ShapeDelta {
            node_id: producer.clone(),
            kind: ShapeDeltaKind::Feature,
            before_fingerprint: before_feature_schema,
            after_fingerprint: after_feature_schema,
            metadata: BTreeMap::new(),
        }],
    };
    let mut view = DataProviderViewSpec {
        sample_ids: Some(vec![SampleId::new("s1").unwrap()]),
        partition: DataRequestPartition::FoldTrain,
        fold_id: Some(FoldId::new("fold:0").unwrap()),
        source_ids: None,
        columns: None,
        include_augmented: true,
        include_excluded: false,
        branch_view: None,
        extra: BTreeMap::from([(
            DATA_OUTPUT_PROVENANCE_KEY.to_string(),
            serde_json::to_value(&provenance).unwrap(),
        )]),
    };

    assert_eq!(view.output_provenance().unwrap(), Some(provenance.clone()));
    view.validate().unwrap();

    let mut empty_port = provenance.clone();
    empty_port.producer_port.clear();
    view.extra.insert(
        DATA_OUTPUT_PROVENANCE_KEY.to_string(),
        serde_json::to_value(empty_port).unwrap(),
    );
    let error = view.validate().unwrap_err().to_string();
    assert!(
        error.contains("empty producer_port"),
        "unexpected empty-port provenance error: {error}"
    );

    let mut wrong_delta_node = provenance.clone();
    wrong_delta_node.shape_deltas[0].node_id = NodeId::new("augment:other").unwrap();
    view.extra.insert(
        DATA_OUTPUT_PROVENANCE_KEY.to_string(),
        serde_json::to_value(wrong_delta_node).unwrap(),
    );
    let error = view.validate().unwrap_err().to_string();
    assert!(
        error.contains("contains shape delta"),
        "unexpected wrong-delta-node provenance error: {error}"
    );

    let mut wrong_feature_fingerprint = provenance.clone();
    wrong_feature_fingerprint.feature_schema_fingerprint = Some("e".repeat(64));
    view.extra.insert(
        DATA_OUTPUT_PROVENANCE_KEY.to_string(),
        serde_json::to_value(wrong_feature_fingerprint).unwrap(),
    );
    let error = view.validate().unwrap_err().to_string();
    assert!(
        error.contains("last feature delta"),
        "unexpected feature-fingerprint provenance error: {error}"
    );

    let mut unsupported_schema = provenance;
    unsupported_schema.schema_version = DATA_OUTPUT_PROVENANCE_SCHEMA_VERSION + 1;
    view.extra.insert(
        DATA_OUTPUT_PROVENANCE_KEY.to_string(),
        serde_json::to_value(unsupported_schema).unwrap(),
    );
    let error = view.validate().unwrap_err().to_string();
    assert!(
        error.contains("unsupported schema_version"),
        "unexpected provenance schema-version error: {error}"
    );
}

#[test]
fn data_provider_view_spec_propagates_branch_view_validation() {
    use crate::data::{BranchViewMode, BranchViewPlan, DataViewSelector};

    let view = DataProviderViewSpec {
        sample_ids: None,
        partition: DataRequestPartition::FullTrain,
        fold_id: None,
        source_ids: None,
        columns: None,
        include_augmented: true,
        include_excluded: false,
        branch_view: Some(BranchViewPlan {
            view_id: "branch_view:nir_only".to_string(),
            branch_id: "branch:nir".to_string(),
            mode: BranchViewMode::BySource,
            selector: DataViewSelector {
                source_ids: vec!["nir".to_string()],
                ..Default::default()
            },
            allow_overlap: false,
            metadata: BTreeMap::new(),
        }),
        extra: BTreeMap::new(),
    };
    view.validate().unwrap();

    let invalid = DataProviderViewSpec {
        branch_view: Some(BranchViewPlan {
            view_id: "branch_view:bad".to_string(),
            branch_id: "branch:bad".to_string(),
            mode: BranchViewMode::BySource,
            selector: DataViewSelector::default(),
            allow_overlap: false,
            metadata: BTreeMap::new(),
        }),
        ..view
    };
    let error = invalid.validate().unwrap_err().to_string();
    assert!(
        error.contains("selector must constrain source_ids, metadata, tags or filter"),
        "unexpected: {error}"
    );
}

#[test]
fn scheduler_extracts_branch_view_from_node_metadata() {
    use crate::data::{BranchViewMode, BranchViewPlan, DataViewSelector};
    use crate::graph::NodeSpec;

    let plan_with_branch = BranchViewPlan {
        view_id: "branch_view:nir_only".to_string(),
        branch_id: "branch:nir".to_string(),
        mode: BranchViewMode::BySource,
        selector: DataViewSelector {
            source_ids: vec!["nir".to_string()],
            ..Default::default()
        },
        allow_overlap: false,
        metadata: BTreeMap::new(),
    };

    let node_id = NodeId::new("model:branched").unwrap();
    let mut node_spec_metadata = BTreeMap::new();
    node_spec_metadata.insert(
        "dsl_branch_view_plan".to_string(),
        serde_json::to_value(&plan_with_branch).unwrap(),
    );
    let node_spec = NodeSpec {
        id: node_id.clone(),
        kind: crate::graph::NodeKind::Model,
        operator: None,
        params: BTreeMap::new(),
        ports: Default::default(),
        metadata: node_spec_metadata,
        seed_label: None,
    };

    let other_node = NodeSpec {
        id: NodeId::new("model:plain").unwrap(),
        kind: crate::graph::NodeKind::Model,
        operator: None,
        params: BTreeMap::new(),
        ports: Default::default(),
        metadata: BTreeMap::new(),
        seed_label: None,
    };

    let graph = crate::graph::GraphSpec {
        id: "g".to_string(),
        interface: Default::default(),
        nodes: vec![node_spec, other_node],
        edges: Vec::new(),
        metadata: BTreeMap::new(),
        search_space_fingerprint: None,
    };
    let plan = ExecutionPlan {
        id: "plan:test".to_string(),
        graph_plan: crate::plan::GraphPlan {
            graph,
            topological_order: vec![node_id.clone(), NodeId::new("model:plain").unwrap()],
            parallel_levels: Vec::new(),
        },
        campaign: crate::plan::CampaignSpec {
            inner_cv: None,
            id: "campaign:test".to_string(),
            root_seed: None,
            leakage_policy: Default::default(),
            aggregation_policy: Default::default(),
            split_invocation: None,
            generation: Default::default(),
            shape_plans: BTreeMap::new(),
            data_bindings: BTreeMap::new(),
            branch_view_plans: Vec::new(),
            metadata: BTreeMap::new(),
        },
        node_plans: BTreeMap::new(),
        controller_manifests: BTreeMap::new(),
        variants: Vec::new(),
        fold_set: None,
        graph_fingerprint: String::new(),
        campaign_fingerprint: String::new(),
        controller_fingerprint: String::new(),
    };

    let resolved = super::branch_view_from_node_metadata(&plan, &node_id).unwrap();
    assert_eq!(resolved.as_ref(), Some(&plan_with_branch));

    let plain_resolved =
        super::branch_view_from_node_metadata(&plan, &NodeId::new("model:plain").unwrap()).unwrap();
    assert_eq!(plain_resolved, None);

    let missing_resolved =
        super::branch_view_from_node_metadata(&plan, &NodeId::new("model:unknown").unwrap())
            .unwrap();
    assert_eq!(missing_resolved, None);
}

#[cfg(dag_ml_workspace_contract_fixtures)]
#[test]
fn published_data_output_provenance_schema_declares_current_version() {
    let schema: serde_json::Value = serde_json::from_str(include_str!(
        "../../../../docs/contracts/data_output_provenance.schema.json"
    ))
    .unwrap();
    assert_eq!(
        schema["properties"]["schema_version"]["const"].as_u64(),
        Some(u64::from(DATA_OUTPUT_PROVENANCE_SCHEMA_VERSION))
    );
    assert_eq!(schema["$id"], DATA_OUTPUT_PROVENANCE_SCHEMA_ID);
    let required = schema["required"].as_array().unwrap();
    assert!(required
        .iter()
        .any(|field| field.as_str() == Some("schema_version")));
    assert!(required
        .iter()
        .any(|field| field.as_str() == Some("producer_node")));
    let properties = schema["properties"].as_object().unwrap();
    assert!(properties.contains_key("representation_plan"));
    assert!(properties.contains_key("representation_replay_manifest"));
    assert!(properties.contains_key("representation_compatibility"));
    assert!(properties.contains_key("relation_delta_fingerprint"));
    let defs = schema["$defs"].as_object().unwrap();
    assert!(defs.contains_key("combination_plan"));
    assert!(defs.contains_key("representation_plan"));
    assert!(defs.contains_key("representation_replay_manifest"));
    assert!(defs.contains_key("representation_compatibility_report"));
    assert!(defs.contains_key("representation_sample_observation_mapping"));
    assert!(defs.contains_key("representation_combo_selection_record"));
}

#[cfg(dag_ml_workspace_contract_fixtures)]
#[test]
fn published_node_task_and_result_schemas_declare_current_contracts() {
    let task_schema: serde_json::Value = serde_json::from_str(include_str!(
        "../../../../docs/contracts/node_task.schema.json"
    ))
    .unwrap();
    let result_schema: serde_json::Value = serde_json::from_str(include_str!(
        "../../../../docs/contracts/node_result.schema.json"
    ))
    .unwrap();

    assert_eq!(task_schema["$id"], NODE_TASK_SCHEMA_ID);
    assert_eq!(result_schema["$id"], NODE_RESULT_SCHEMA_ID);
    assert!(task_schema["required"]
        .as_array()
        .unwrap()
        .iter()
        .any(|field| field.as_str() == Some("node_plan")));
    assert!(result_schema["required"]
        .as_array()
        .unwrap()
        .iter()
        .any(|field| field.as_str() == Some("lineage")));
    assert_eq!(
        task_schema["$defs"]["artifact_ref"]["additionalProperties"].as_bool(),
        Some(false)
    );
    assert_eq!(result_schema["additionalProperties"].as_bool(), Some(false));
    for definition in [
        "fit_influence_diagnostic",
        "handle_ref",
        "prediction_block",
        "observation_prediction_block",
        "regression_target_block",
        "aggregated_prediction_block",
        "explanation_block",
        "prediction_unit_id",
        "shape_delta",
        "artifact_ref",
        "lineage_record",
    ] {
        assert_eq!(
            result_schema["$defs"][definition]["additionalProperties"].as_bool(),
            Some(false),
            "node-result schema definition `{definition}` must be closed"
        );
    }
}

#[cfg(dag_ml_workspace_contract_fixtures)]
#[test]
fn published_node_task_result_fixtures_validate_current_contract() {
    let task: NodeTask = serde_json::from_str(include_str!(
        "../../../../examples/fixtures/runtime/node_task_transform_scale.json"
    ))
    .unwrap();
    let result: NodeResult = serde_json::from_str(include_str!(
        "../../../../examples/fixtures/runtime/node_result_transform_scale.json"
    ))
    .unwrap();

    result.validate_for_task(&task).unwrap();
    assert_eq!(
        task.node_plan.node_id,
        NodeId::new("transform:scale").unwrap()
    );
    assert_eq!(result.outputs.len(), 1);
}

#[cfg(dag_ml_workspace_contract_fixtures)]
#[cfg(dag_ml_workspace_contract_fixtures)]
#[cfg(dag_ml_workspace_contract_fixtures)]
#[test]
fn node_result_deserialization_rejects_unknown_contract_fields_and_keeps_opaque_maps() {
    let mut document: serde_json::Value = serde_json::from_str(include_str!(
        "../../../../examples/fixtures/runtime/node_result_transform_scale.json"
    ))
    .unwrap();
    let object = document.as_object_mut().unwrap();
    object.insert(
        "predictions".to_string(),
        json!([{
            "prediction_id": "prediction:strict",
            "producer_node": "model:strict",
            "partition": "validation",
            "fold_id": "fold:0",
            "sample_ids": ["sample:1"],
            "values": [[1.0]],
            "target_names": ["y"]
        }]),
    );
    object.insert(
        "observation_predictions".to_string(),
        json!([{
            "prediction_id": "prediction:observation.strict",
            "producer_node": "model:strict",
            "partition": "validation",
            "fold_id": "fold:0",
            "observation_ids": ["observation:1"],
            "values": [[1.0]],
            "weights": [1.0],
            "target_names": ["y"]
        }]),
    );
    object.insert(
        "aggregated_predictions".to_string(),
        json!([{
            "prediction_id": "prediction:aggregate.strict",
            "producer_node": "model:strict",
            "partition": "validation",
            "fold_id": "fold:0",
            "level": "sample",
            "unit_ids": [{"level": "sample", "id": "sample:1"}],
            "values": [[1.0]],
            "target_names": ["y"]
        }]),
    );
    object.insert(
        "explanations".to_string(),
        json!([{
            "producer_node": "model:strict",
            "method": "strict_test",
            "payload": {"unexpected_contract_field": "opaque payload remains open"}
        }]),
    );
    object.insert(
        "shape_deltas".to_string(),
        json!([{
            "node_id": "model:strict",
            "kind": "feature",
            "before_fingerprint": "before",
            "after_fingerprint": "after",
            "metadata": {"unexpected_contract_field": "opaque metadata remains open"}
        }]),
    );
    object.insert(
        "artifacts".to_string(),
        json!([{
            "id": "artifact:strict",
            "kind": "model",
            "controller_id": "controller:strict",
            "backend": "raw",
            "uri": null,
            "content_fingerprint": null,
            "size_bytes": 8,
            "plugin": null,
            "plugin_version": null
        }]),
    );
    object.insert(
        "fit_influence_diagnostics".to_string(),
        json!([{
            "requested_policy": "uniform_rows",
            "effective_policy": "uniform_rows",
            "mechanism": "uniform_rows",
            "fallback_used": false,
            "row_weight_count": 0,
            "warnings": []
        }]),
    );
    object.insert(
        "regression_targets".to_string(),
        json!([{
            "level": "sample",
            "unit_ids": [{"level": "sample", "id": "sample:1"}],
            "values": [[1.0]],
            "target_names": ["y"]
        }]),
    );
    document["lineage"]["metrics"]["unexpected_contract_field"] = json!(1.0);

    serde_json::from_value::<NodeResult>(document.clone())
        .expect("closed node-result types still accept opaque payload/metadata/metrics maps");

    for (label, pointer) in [
        ("node result", ""),
        ("output handle", "/outputs/x_out"),
        ("prediction block", "/predictions/0"),
        ("observation prediction block", "/observation_predictions/0"),
        ("aggregated prediction block", "/aggregated_predictions/0"),
        (
            "aggregated prediction unit id",
            "/aggregated_predictions/0/unit_ids/0",
        ),
        ("explanation block", "/explanations/0"),
        ("shape delta", "/shape_deltas/0"),
        ("fit influence diagnostic", "/fit_influence_diagnostics/0"),
        ("regression target block", "/regression_targets/0"),
        (
            "regression target unit id",
            "/regression_targets/0/unit_ids/0",
        ),
        ("lineage record", "/lineage"),
    ] {
        let mut tampered = document.clone();
        tampered
            .pointer_mut(pointer)
            .unwrap()
            .as_object_mut()
            .unwrap()
            .insert("unexpected_contract_field".to_string(), json!(true));
        let error = serde_json::from_value::<NodeResult>(tampered)
            .expect_err("unknown node-result contract field must be rejected");
        assert!(
            error.to_string().contains("unexpected_contract_field"),
            "{label} returned an unexpected error: {error}"
        );
    }
}

#[cfg(dag_ml_workspace_contract_fixtures)]
#[test]
fn node_result_deserialization_rejects_unknown_contract_fields_but_keeps_opaque_maps() {
    let mut document: serde_json::Value = serde_json::from_str(include_str!(
        "../../../../examples/fixtures/runtime/node_result_transform_scale.json"
    ))
    .unwrap();
    let object = document.as_object_mut().unwrap();
    object.insert(
        "predictions".to_string(),
        json!([{
            "prediction_id": "prediction:strict",
            "producer_node": "model:strict",
            "partition": "validation",
            "fold_id": "fold:0",
            "sample_ids": ["sample:1"],
            "values": [[1.0]],
            "target_names": ["y"]
        }]),
    );
    object.insert(
        "observation_predictions".to_string(),
        json!([{
            "prediction_id": "prediction:observation.strict",
            "producer_node": "model:strict",
            "partition": "validation",
            "fold_id": "fold:0",
            "observation_ids": ["observation:1"],
            "values": [[1.0]],
            "weights": [1.0],
            "target_names": ["y"]
        }]),
    );
    object.insert(
        "aggregated_predictions".to_string(),
        json!([{
            "prediction_id": "prediction:aggregate.strict",
            "producer_node": "model:strict",
            "partition": "validation",
            "fold_id": "fold:0",
            "level": "sample",
            "unit_ids": [{"level": "sample", "id": "sample:1"}],
            "values": [[1.0]],
            "target_names": ["y"]
        }]),
    );
    object.insert(
        "explanations".to_string(),
        json!([{
            "producer_node": "model:strict",
            "method": "strict_test",
            "payload": {"unexpected_contract_field": "opaque payload remains open"}
        }]),
    );
    object.insert(
        "shape_deltas".to_string(),
        json!([{
            "node_id": "model:strict",
            "kind": "feature",
            "before_fingerprint": "before",
            "after_fingerprint": "after",
            "metadata": {"unexpected_contract_field": "opaque metadata remains open"}
        }]),
    );
    object.insert(
        "artifacts".to_string(),
        json!([{
            "id": "artifact:strict",
            "kind": "model",
            "controller_id": "controller:strict",
            "backend": "raw",
            "uri": null,
            "content_fingerprint": null,
            "size_bytes": 8,
            "plugin": null,
            "plugin_version": null
        }]),
    );
    object.insert(
        "fit_influence_diagnostics".to_string(),
        json!([{
            "requested_policy": "uniform_rows",
            "effective_policy": "uniform_rows",
            "mechanism": "uniform_rows",
            "fallback_used": false,
            "row_weight_count": 0,
            "warnings": []
        }]),
    );
    object.insert(
        "regression_targets".to_string(),
        json!([{
            "level": "sample",
            "unit_ids": [{"level": "sample", "id": "sample:1"}],
            "values": [[1.0]],
            "target_names": ["y"]
        }]),
    );
    document["lineage"]["metrics"]["unexpected_contract_field"] = json!(1.0);

    serde_json::from_value::<NodeResult>(document.clone())
        .expect("closed node-result types still accept opaque payload/metadata/metrics maps");

    for (label, pointer) in [
        ("node result", ""),
        ("output handle", "/outputs/x_out"),
        ("prediction block", "/predictions/0"),
        ("observation prediction block", "/observation_predictions/0"),
        ("aggregated prediction block", "/aggregated_predictions/0"),
        (
            "aggregated prediction unit id",
            "/aggregated_predictions/0/unit_ids/0",
        ),
        ("explanation block", "/explanations/0"),
        ("shape delta", "/shape_deltas/0"),
        ("fit influence diagnostic", "/fit_influence_diagnostics/0"),
        ("regression target block", "/regression_targets/0"),
        (
            "regression target unit id",
            "/regression_targets/0/unit_ids/0",
        ),
        ("lineage record", "/lineage"),
    ] {
        let mut tampered = document.clone();
        tampered
            .pointer_mut(pointer)
            .unwrap()
            .as_object_mut()
            .unwrap()
            .insert("unexpected_contract_field".to_string(), json!(true));
        let error = serde_json::from_value::<NodeResult>(tampered)
            .expect_err("unknown node-result contract field must be rejected");
        assert!(
            error.to_string().contains("unexpected_contract_field"),
            "{label} returned an unexpected error: {error}"
        );
    }

    let mut legacy_artifact = document;
    legacy_artifact["artifacts"][0]["host_metadata"] = json!({"legacy": true});
    serde_json::from_value::<NodeResult>(legacy_artifact)
        .expect("artifact extensions remain readable for legacy workspaces");
}

#[test]
fn campaign_data_bindings_require_unsafe_flags_for_full_train_cv_views() {
    let model_id = NodeId::new("model:pls").unwrap();
    let mut unsafe_binding = data_binding(&model_id);
    unsafe_binding.view_policy.fit_partition = DataRequestPartition::FullTrain;
    unsafe_binding.view_policy.unsafe_flags =
        BTreeSet::from([DataViewPolicy::ALLOW_FIT_CV_FULL_TRAIN_VIEW.to_string()]);

    let mut unsafe_campaign = oof_edge_campaign();
    unsafe_campaign.data_bindings =
        BTreeMap::from([(model_id.clone(), vec![unsafe_binding.clone()])]);
    let plan = build_execution_plan(
        "plan:data.full-train.unsafe",
        simple_graph(),
        unsafe_campaign,
        &manifests(),
    )
    .unwrap();

    let mut missing_flag = unsafe_binding;
    missing_flag.view_policy.unsafe_flags.clear();
    let mut invalid_campaign = oof_edge_campaign();
    invalid_campaign.data_bindings = BTreeMap::from([(model_id.clone(), vec![missing_flag])]);
    assert!(build_execution_plan(
        "plan:data.full-train.missing-flag",
        simple_graph(),
        invalid_campaign,
        &manifests(),
    )
    .is_err());

    let envelope: ExternalDataPlanEnvelope = serde_json::from_str(include_str!(
        "../../tests/fixtures/package/data/coordinator_data_plan_envelope_sample12.json"
    ))
    .unwrap();
    let provider = InMemoryDataProvider::with_envelope(
        ControllerId::new("controller:data.provider").unwrap(),
        envelope,
    )
    .unwrap();
    let controllers = runtime_controllers();
    let mut ctx = RunContext::new(RunId::new("run:data.full-train.unsafe").unwrap(), Some(11));

    SequentialScheduler
        .execute_campaign_phase_with_data_provider(
            &plan,
            &controllers,
            &provider,
            &mut ctx,
            Phase::FitCv,
        )
        .unwrap();

    let full_train_ids = plan.fold_set.as_ref().unwrap().sample_ids.clone();
    let views = provider.view_records();
    let full_train_views = views
        .iter()
        .filter(|view| view.view.partition == DataRequestPartition::FullTrain)
        .collect::<Vec<_>>();
    let validation_views = views
        .iter()
        .filter(|view| view.view.partition == DataRequestPartition::FoldValidation)
        .collect::<Vec<_>>();
    assert_eq!(full_train_views.len(), 2);
    assert_eq!(validation_views.len(), 2);
    assert!(full_train_views.iter().all(|view| {
        view.view.sample_ids == Some(full_train_ids.clone())
            && view.view.fold_id.is_none()
            && view.view.extra["unsafe_flags"]
                .as_array()
                .unwrap()
                .iter()
                .any(|flag| flag.as_str() == Some(DataViewPolicy::ALLOW_FIT_CV_FULL_TRAIN_VIEW))
    }));
    assert!(validation_views
        .iter()
        .all(|view| !view.view.include_augmented));
}

#[test]
fn all_observations_fit_scope_is_explicit_and_visible_in_cv_and_refit_views() {
    let model_id = NodeId::new("model:pls").unwrap();
    let mut binding = data_binding(&model_id);
    binding.view_policy.fit_partition = DataRequestPartition::AllObservations;
    let mut invalid_campaign = oof_edge_campaign();
    invalid_campaign.data_bindings = BTreeMap::from([(model_id.clone(), vec![binding.clone()])]);
    let error = build_execution_plan(
        "plan:data.all-observations.missing-flag",
        simple_graph(),
        invalid_campaign,
        &manifests(),
    )
    .unwrap_err();
    assert!(error
        .to_string()
        .contains("allow_fit_cv_all_observations_view"));

    binding.view_policy.unsafe_flags =
        BTreeSet::from([DataViewPolicy::ALLOW_FIT_CV_ALL_OBSERVATIONS_VIEW.to_string()]);
    let mut campaign = oof_edge_campaign();
    campaign.data_bindings = BTreeMap::from([(model_id, vec![binding.clone()])]);
    let plan = build_execution_plan(
        "plan:data.all-observations.opt-in",
        simple_graph(),
        campaign,
        &manifests(),
    )
    .unwrap();
    let envelope: ExternalDataPlanEnvelope = serde_json::from_str(include_str!(
        "../../tests/fixtures/package/data/coordinator_data_plan_envelope_sample12.json"
    ))
    .unwrap();
    let provider = InMemoryDataProvider::with_envelope(
        ControllerId::new("controller:data.provider").unwrap(),
        envelope,
    )
    .unwrap();
    let mut ctx = RunContext::new(
        RunId::new("run:data.all-observations.opt-in").unwrap(),
        Some(11),
    );
    SequentialScheduler
        .execute_campaign_phase_with_data_provider(
            &plan,
            &runtime_controllers(),
            &provider,
            &mut ctx,
            Phase::FitCv,
        )
        .unwrap();
    let views = provider.view_records();
    let all_views = views
        .iter()
        .filter(|record| record.view.partition == DataRequestPartition::AllObservations)
        .collect::<Vec<_>>();
    assert_eq!(all_views.len(), 2);
    assert!(all_views.iter().all(|record| {
        record.view.sample_ids.is_none()
            && record.view.fold_id.is_none()
            && record.view.include_augmented
            && record.view.extra["unsafe_flags"]
                .as_array()
                .unwrap()
                .iter()
                .any(|flag| {
                    flag.as_str() == Some(DataViewPolicy::ALLOW_FIT_CV_ALL_OBSERVATIONS_VIEW)
                })
    }));
    let refit_scope = PhaseScope {
        phase: Phase::Refit,
        variant_id: None,
        variant: None,
        fold_id: None,
        seed_root: Some(11),
    };
    let refit_view = data_view_for_scope(
        &binding,
        plan.fold_set.as_ref(),
        &refit_scope,
        None,
        &BTreeSet::new(),
    )
    .unwrap();
    assert_eq!(refit_view.partition, DataRequestPartition::AllObservations);
    assert!(refit_view.sample_ids.is_none());
}

#[test]
fn campaign_refit_data_bindings_create_full_train_views() {
    let plan = fixture_plan("plan:refit.views");
    let provider = replay_data_provider();
    let mut controllers = RuntimeControllerRegistry::new();
    controllers
        .register(Box::new(ReplayMockController {
            id: ControllerId::new("controller:transform.mock").unwrap(),
            handle: 11,
            require_artifact: false,
            emit_prediction: false,
            emit_refit_artifact: false,
        }))
        .unwrap();
    controllers
        .register(Box::new(ReplayMockController {
            id: ControllerId::new("controller:model.mock").unwrap(),
            handle: 22,
            require_artifact: false,
            emit_prediction: true,
            emit_refit_artifact: false,
        }))
        .unwrap();
    let mut ctx = RunContext::new(RunId::new("run:refit.views").unwrap(), Some(11));
    ctx.variant_id = Some(plan.variants[0].variant_id.clone());

    let results = SequentialScheduler
        .execute_campaign_phase_with_data_provider(
            &plan,
            &controllers,
            &provider,
            &mut ctx,
            Phase::Refit,
        )
        .unwrap();

    assert!(!results.is_empty());
    let views = provider.view_records();
    assert_eq!(views.len(), 1);
    let full_train_ids = plan.fold_set.as_ref().unwrap().sample_ids.clone();
    assert!(views.iter().all(|view| {
        view.view.partition == DataRequestPartition::FullTrain
            && view.view.sample_ids == Some(full_train_ids.clone())
            && view.fold_id.is_none()
    }));
}

#[test]
fn campaign_refit_captures_emitted_artifact_handles() {
    let plan = fixture_plan("plan:refit.artifact.capture");
    let provider = replay_data_provider();
    let mut artifact_store = InMemoryArtifactStore::new();
    let mut controllers = RuntimeControllerRegistry::new();
    controllers
        .register(Box::new(ReplayMockController {
            id: ControllerId::new("controller:transform.mock").unwrap(),
            handle: 11,
            require_artifact: false,
            emit_prediction: false,
            emit_refit_artifact: false,
        }))
        .unwrap();
    controllers
        .register(Box::new(ReplayMockController {
            id: ControllerId::new("controller:model.mock").unwrap(),
            handle: 22,
            require_artifact: false,
            emit_prediction: true,
            emit_refit_artifact: true,
        }))
        .unwrap();
    let mut ctx = RunContext::new(RunId::new("run:refit.artifact.capture").unwrap(), Some(11));
    ctx.variant_id = Some(plan.variants[0].variant_id.clone());

    let results = SequentialScheduler
        .execute_campaign_phase_with_data_provider_and_artifact_store(
            &plan,
            &controllers,
            &provider,
            &mut artifact_store,
            &mut ctx,
            Phase::Refit,
        )
        .unwrap();

    assert_eq!(results.len(), 2);
    assert_eq!(
        results
            .iter()
            .filter(|result| !result.artifacts.is_empty())
            .count(),
        1
    );
    assert_eq!(artifact_store.len(), 1);
    let records = artifact_store.refit_artifacts();
    assert_eq!(records.len(), 1);
    let artifact = &records[0];
    artifact.validate().unwrap();
    assert_eq!(artifact.node_id.as_str(), "model:base");
    assert_eq!(artifact.controller_id.as_str(), "controller:model.mock");
    assert_eq!(artifact.artifact.id.as_str(), "artifact:model:base:refit");
    assert_eq!(artifact.data_requirement_keys, vec!["model:base.x"]);

    let handle = artifact_store
        .materialize(&ArtifactMaterializationRequest {
            run_id: ctx.run_id.clone(),
            bundle_id: crate::ids::BundleId::new("bundle:refit.capture").unwrap(),
            node_id: artifact.node_id.clone(),
            phase: Phase::Predict,
            variant_id: ctx.variant_id.clone(),
            controller_id: artifact.controller_id.clone(),
            artifact: artifact.artifact.clone(),
            params_fingerprint: artifact.params_fingerprint.clone(),
            training_loss_fingerprint: artifact.training_loss_fingerprint.clone(),
        })
        .unwrap();
    assert_eq!(
        handle,
        HandleRef {
            handle: 10_022,
            kind: HandleKind::Model,
            owner_controller: ControllerId::new("controller:model.mock").unwrap(),
        }
    );
}

#[test]
fn parallel_campaign_refit_captures_emitted_artifact_handles() {
    let plan = fixture_plan("plan:parallel.refit.artifact.capture");
    let provider = replay_data_provider();
    let mut artifact_store = InMemoryArtifactStore::new();
    let mut controllers = RuntimeControllerRegistry::new();
    controllers
        .register(Box::new(ReplayMockController {
            id: ControllerId::new("controller:transform.mock").unwrap(),
            handle: 11,
            require_artifact: false,
            emit_prediction: false,
            emit_refit_artifact: false,
        }))
        .unwrap();
    controllers
        .register(Box::new(ReplayMockController {
            id: ControllerId::new("controller:model.mock").unwrap(),
            handle: 22,
            require_artifact: false,
            emit_prediction: true,
            emit_refit_artifact: true,
        }))
        .unwrap();
    let mut ctx = RunContext::new(
        RunId::new("run:parallel.refit.artifact.capture").unwrap(),
        Some(11),
    );
    ctx.variant_id = Some(plan.variants[0].variant_id.clone());

    let results = ParallelScheduler::new(2)
        .unwrap()
        .execute_campaign_phase_with_data_provider_and_artifact_store(
            &plan,
            &controllers,
            &provider,
            &mut artifact_store,
            &mut ctx,
            Phase::Refit,
        )
        .unwrap();

    assert_eq!(results.len(), 2);
    assert_eq!(artifact_store.len(), 1);
    assert_eq!(
        artifact_store.refit_artifacts()[0].artifact.id.as_str(),
        "artifact:model:base:refit"
    );
}

fn fit_influence_view(sample_ids: Vec<&str>) -> BTreeMap<String, DataProviderViewSpec> {
    BTreeMap::from([(
        "data:x:train".to_string(),
        DataProviderViewSpec {
            sample_ids: Some(
                sample_ids
                    .into_iter()
                    .map(|sample_id| SampleId::new(sample_id).unwrap())
                    .collect(),
            ),
            partition: DataRequestPartition::FoldTrain,
            fold_id: Some(FoldId::new("fold:0").unwrap()),
            source_ids: None,
            columns: None,
            include_augmented: false,
            include_excluded: false,
            branch_view: None,
            extra: BTreeMap::new(),
        },
    )])
}

fn fit_influence_validation_task(fit_influence: FitInfluenceTask) -> NodeTask {
    let plan = build_execution_plan(
        "plan:fit.influence.validation",
        simple_graph(),
        CampaignSpec {
            inner_cv: None,
            id: "campaign:fit.influence.validation".to_string(),
            root_seed: Some(7),
            leakage_policy: Default::default(),
            aggregation_policy: Default::default(),
            split_invocation: None,
            generation: Default::default(),
            shape_plans: BTreeMap::new(),
            data_bindings: BTreeMap::new(),
            branch_view_plans: Vec::new(),
            metadata: BTreeMap::new(),
        },
        &manifests(),
    )
    .unwrap();
    let node_plan = plan
        .node_plans
        .get(&NodeId::new("model:pls").unwrap())
        .unwrap()
        .clone();
    NodeTask {
        inner_fold_set: None,
        residual_targets: None,
        run_id: RunId::new("run:fit.influence.validation").unwrap(),
        node_plan,
        phase: Phase::FitCv,
        resources: None,
        variant_id: None,
        variant: None,
        fold_id: Some(FoldId::new("fold:0").unwrap()),
        branch_path: Vec::new(),
        input_handles: BTreeMap::new(),
        data_views: BTreeMap::new(),
        data_view_receipts: BTreeMap::new(),
        prediction_inputs: BTreeMap::new(),
        prediction_feature_matrix: None,
        prediction_feature_off_fold_matrix: None,
        artifact_inputs: BTreeMap::new(),
        required_loss_attestations: Vec::new(),
        fit_influence,
        seed: Some(7),
    }
}

#[test]
fn node_task_receipt_round_trips_and_refuses_an_unrelated_view() {
    let mut task = fit_influence_validation_task(FitInfluenceTask::default());
    let key = "data:x".to_string();
    let sample_id = SampleId::new("sample:receipt").unwrap();
    let handle = HandleRef {
        handle: 82,
        kind: HandleKind::DataView,
        owner_controller: ControllerId::new("controller:data.provider").unwrap(),
    };
    task.input_handles.insert(key.clone(), handle.clone());
    task.data_views.insert(
        key.clone(),
        DataProviderViewSpec {
            sample_ids: Some(vec![sample_id.clone()]),
            partition: DataRequestPartition::FoldTrain,
            fold_id: task.fold_id.clone(),
            source_ids: None,
            columns: None,
            include_augmented: false,
            include_excluded: false,
            branch_view: None,
            extra: BTreeMap::new(),
        },
    );
    task.data_view_receipts.insert(
        key.clone(),
        DataViewReceipt {
            handle,
            view_key: format!("view:v1:{}", "a".repeat(64)),
            sample_ids: vec![sample_id],
            schema_fingerprint: "b".repeat(64),
            content_fingerprint: "c".repeat(64),
        },
    );
    task.validate_data_view_receipts().unwrap();
    let encoded = serde_json::to_value(&task).unwrap();
    assert!(encoded["data_view_receipts"]["data:x"].is_object());
    let decoded: NodeTask = serde_json::from_value(encoded).unwrap();
    assert_eq!(decoded, task);
    task.validate_dynamic_view_training_gate().unwrap();
    task.node_plan.kind = NodeKind::Transform;
    task.validate_dynamic_view_training_gate().unwrap();
    let mut non_model_predict = task.clone();
    non_model_predict.phase = Phase::Predict;
    non_model_predict.fold_id = None;
    let predict_view = non_model_predict.data_views.get_mut(&key).unwrap();
    predict_view.partition = DataRequestPartition::Predict;
    predict_view.fold_id = None;
    assert!(non_model_predict
        .validate_dynamic_view_training_gate()
        .unwrap_err()
        .to_string()
        .contains("unsupported transform phase"));
    task.node_plan.kind = NodeKind::FeatureJoin;
    assert!(task
        .validate_dynamic_view_training_gate()
        .unwrap_err()
        .to_string()
        .contains("outside a model or transform task"));
    task.node_plan.kind = NodeKind::Model;
    let mut unsupported_phase = task.clone();
    unsupported_phase.phase = Phase::Explain;
    assert!(unsupported_phase
        .validate_dynamic_view_training_gate()
        .unwrap_err()
        .to_string()
        .contains("unsupported model phase"));

    let mut unsupported_partition = task.clone();
    unsupported_partition
        .data_views
        .get_mut(&key)
        .unwrap()
        .partition = DataRequestPartition::FullTrain;
    assert!(unsupported_partition
        .validate_dynamic_view_training_gate()
        .unwrap_err()
        .to_string()
        .contains("unsupported dynamic model view"));

    let mut missing_ids = task.clone();
    missing_ids.data_views.get_mut(&key).unwrap().sample_ids = None;
    assert!(missing_ids
        .validate_dynamic_view_training_gate()
        .unwrap_err()
        .to_string()
        .contains("no ordered IDs for dynamic data view"));

    let mut reordered_ids = task.clone();
    let second_id = SampleId::new("sample:receipt:second").unwrap();
    reordered_ids
        .data_views
        .get_mut(&key)
        .unwrap()
        .sample_ids
        .as_mut()
        .unwrap()
        .push(second_id.clone());
    reordered_ids
        .data_view_receipts
        .get_mut(&key)
        .unwrap()
        .sample_ids
        .push(second_id);
    reordered_ids.validate_dynamic_view_training_gate().unwrap();
    reordered_ids
        .data_views
        .get_mut(&key)
        .unwrap()
        .sample_ids
        .as_mut()
        .unwrap()
        .reverse();
    assert!(reordered_ids
        .validate_dynamic_view_training_gate()
        .unwrap_err()
        .to_string()
        .contains("ordered IDs different from the receipt"));

    for (missing_key, partition) in [
        ("data:y", DataRequestPartition::FoldTrain),
        ("data:x:validation", DataRequestPartition::FoldValidation),
    ] {
        let mut partial = task.clone();
        let mut sibling_view = partial.data_views.get(&key).unwrap().clone();
        sibling_view.partition = partition;
        let sibling_handle = HandleRef {
            handle: 83,
            kind: HandleKind::DataView,
            owner_controller: ControllerId::new("controller:data.provider").unwrap(),
        };
        partial
            .data_views
            .insert(missing_key.to_string(), sibling_view);
        partial
            .input_handles
            .insert(missing_key.to_string(), sibling_handle.clone());
        assert!(partial
            .validate_dynamic_view_training_gate()
            .unwrap_err()
            .to_string()
            .contains(&format!("no receipt for data view `{missing_key}`")));
        let mut sibling_receipt = partial.data_view_receipts.get(&key).unwrap().clone();
        sibling_receipt.handle = sibling_handle;
        sibling_receipt.view_key = format!("view:v1:{}", "d".repeat(64));
        partial
            .data_view_receipts
            .insert(missing_key.to_string(), sibling_receipt);
        partial.validate_dynamic_view_training_gate().unwrap();
    }

    task.data_view_receipts
        .get_mut(&key)
        .unwrap()
        .content_fingerprint = "not-sha256".to_string();
    assert!(task
        .validate_data_view_receipts()
        .unwrap_err()
        .to_string()
        .contains("invalid ordered IDs or fingerprints"));
    task.data_view_receipts
        .get_mut(&key)
        .unwrap()
        .content_fingerprint = "c".repeat(64);

    task.data_views.get_mut(&key).unwrap().sample_ids =
        Some(vec![SampleId::new("sample:other").unwrap()]);
    assert!(task
        .validate_data_view_receipts()
        .unwrap_err()
        .to_string()
        .contains("unrelated to input"));
}

#[test]
fn node_result_consumption_binds_a_successful_read_to_its_native_receipt() {
    let mut task = fit_influence_validation_task(FitInfluenceTask::default());
    let key = "data:x".to_string();
    let sample_ids = ["sample:a", "sample:b", "sample:c"]
        .into_iter()
        .map(|id| SampleId::new(id).unwrap())
        .collect::<Vec<_>>();
    let handle = HandleRef {
        handle: 82,
        kind: HandleKind::DataView,
        owner_controller: ControllerId::new("controller:data.provider").unwrap(),
    };
    let receipt = DataViewReceipt {
        handle: handle.clone(),
        view_key: format!("view:v1:{}", "a".repeat(64)),
        sample_ids: sample_ids.clone(),
        schema_fingerprint: "b".repeat(64),
        content_fingerprint: "c".repeat(64),
    };
    task.input_handles.insert(key.clone(), handle);
    task.data_views.insert(
        key.clone(),
        DataProviderViewSpec {
            sample_ids: Some(sample_ids.clone()),
            partition: DataRequestPartition::FoldTrain,
            fold_id: task.fold_id.clone(),
            source_ids: None,
            columns: None,
            include_augmented: false,
            include_excluded: false,
            branch_view: None,
            extra: BTreeMap::new(),
        },
    );
    task.data_view_receipts.insert(key.clone(), receipt.clone());
    let mut result = NodeResult {
        schema_version: None,
        node_id: task.node_plan.node_id.clone(),
        outputs: BTreeMap::new(),
        predictions: Vec::new(),
        classification_probabilities: Vec::new(),
        observation_predictions: Vec::new(),
        aggregated_predictions: Vec::new(),
        explanations: Vec::new(),
        shape_deltas: Vec::new(),
        artifacts: Vec::new(),
        artifact_handles: BTreeMap::new(),
        consumed_data_views: BTreeMap::from([(
            key.clone(),
            DataViewConsumption {
                receipt: receipt.clone(),
                read_batches: vec![sample_ids.clone()],
                model_calls: vec![ModelInputCall {
                    operation: ModelInputOperation::Fit,
                    sample_ids: sample_ids.clone(),
                    input_fingerprint: "a".repeat(64),
                    target_fingerprint: Some("b".repeat(64)),
                }],
            },
        )]),
        fit_influence_diagnostics: Vec::new(),
        regression_targets: Vec::new(),
        lineage: LineageRecord {
            record_id: LineageId::new("lineage:consumed.view").unwrap(),
            run_id: task.run_id.clone(),
            node_id: task.node_plan.node_id.clone(),
            phase: task.phase,
            controller_id: task.node_plan.controller_id.clone(),
            controller_version: task.node_plan.controller_version.clone(),
            variant_id: task.variant_id.clone(),
            fold_id: task.fold_id.clone(),
            branch_path: task.branch_path.clone(),
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
            target_domain: None,
        },
    };
    result.validate_consumed_data_views_for_task(&task).unwrap();
    result
        .validate_required_model_calls_for_task(&task)
        .unwrap();
    result.validate_for_task(&task).unwrap();

    let mut transform_task = task.clone();
    transform_task.node_plan.kind = NodeKind::Transform;
    transform_task
        .validate_dynamic_view_training_gate()
        .unwrap();
    result
        .validate_required_model_calls_for_task(&transform_task)
        .unwrap();
    let mut no_transform_fit = result.clone();
    no_transform_fit
        .consumed_data_views
        .get_mut(&key)
        .unwrap()
        .model_calls
        .clear();
    assert!(no_transform_fit
        .validate_required_model_calls_for_task(&transform_task)
        .unwrap_err()
        .to_string()
        .contains("no full ordered read and fit call"));
    transform_task.data_views.get_mut(&key).unwrap().partition =
        DataRequestPartition::FoldValidation;
    assert!(transform_task
        .validate_dynamic_view_training_gate()
        .unwrap_err()
        .to_string()
        .contains("requires a dynamic transform training view"));

    let mut refit_task = task.clone();
    refit_task.phase = Phase::Refit;
    refit_task.fold_id = None;
    let refit_view = refit_task.data_views.get_mut(&key).unwrap();
    refit_view.partition = DataRequestPartition::FullTrain;
    refit_view.fold_id = None;
    let mut refit_result = result.clone();
    refit_result.lineage.phase = Phase::Refit;
    refit_result.lineage.fold_id = None;
    refit_task.validate_dynamic_view_training_gate().unwrap();
    refit_result.validate_for_task(&refit_task).unwrap();

    let validation_key = "data:x:validation".to_string();
    let validation_ids = ["sample:validation:a", "sample:validation:b"]
        .into_iter()
        .map(|id| SampleId::new(id).unwrap())
        .collect::<Vec<_>>();
    let validation_handle = HandleRef {
        handle: 83,
        kind: HandleKind::DataView,
        owner_controller: ControllerId::new("controller:data.provider").unwrap(),
    };
    let validation_receipt = DataViewReceipt {
        handle: validation_handle.clone(),
        view_key: format!("view:v1:{}", "d".repeat(64)),
        sample_ids: validation_ids.clone(),
        schema_fingerprint: "e".repeat(64),
        content_fingerprint: "f".repeat(64),
    };
    let mut cv_prediction_task = task.clone();
    let mut validation_view = cv_prediction_task.data_views.get(&key).unwrap().clone();
    validation_view.partition = DataRequestPartition::FoldValidation;
    validation_view.sample_ids = Some(validation_ids.clone());
    cv_prediction_task
        .input_handles
        .insert(validation_key.clone(), validation_handle);
    cv_prediction_task
        .data_views
        .insert(validation_key.clone(), validation_view);
    cv_prediction_task
        .data_view_receipts
        .insert(validation_key.clone(), validation_receipt.clone());
    let mut cv_prediction_result = result.clone();
    let missing_predict = cv_prediction_result
        .validate_for_task(&cv_prediction_task)
        .unwrap_err();
    assert!(
        missing_predict
            .to_string()
            .contains("no full ordered read and predict call"),
        "{missing_predict}"
    );
    cv_prediction_result.consumed_data_views.insert(
        validation_key.clone(),
        DataViewConsumption {
            receipt: validation_receipt,
            read_batches: vec![validation_ids.clone()],
            model_calls: vec![ModelInputCall {
                operation: ModelInputOperation::Predict,
                sample_ids: validation_ids.clone(),
                input_fingerprint: "a".repeat(64),
                target_fingerprint: None,
            }],
        },
    );
    cv_prediction_result
        .validate_for_task(&cv_prediction_task)
        .unwrap();
    cv_prediction_result
        .consumed_data_views
        .get_mut(&validation_key)
        .unwrap()
        .read_batches = vec![vec![validation_ids[0].clone()]];
    assert!(cv_prediction_result
        .validate_for_task(&cv_prediction_task)
        .unwrap_err()
        .to_string()
        .contains("outside its ordered reads"));
    let validation_consumption = cv_prediction_result
        .consumed_data_views
        .get_mut(&validation_key)
        .unwrap();
    validation_consumption.read_batches = vec![validation_ids.clone()];
    validation_consumption.model_calls[0].sample_ids = vec![validation_ids[0].clone()];
    assert!(cv_prediction_result
        .validate_for_task(&cv_prediction_task)
        .unwrap_err()
        .to_string()
        .contains("no full ordered read and predict call"));
    let validation_consumption = cv_prediction_result
        .consumed_data_views
        .get_mut(&validation_key)
        .unwrap();
    validation_consumption.model_calls[0].sample_ids = validation_ids.clone();
    validation_consumption.model_calls[0].operation = ModelInputOperation::PredictProba;
    assert!(cv_prediction_result
        .validate_for_task(&cv_prediction_task)
        .unwrap_err()
        .to_string()
        .contains("no full ordered read and predict call"));

    let mut predict_task = task.clone();
    predict_task.phase = Phase::Predict;
    predict_task.fold_id = None;
    let predict_view = predict_task.data_views.get_mut(&key).unwrap();
    predict_view.partition = DataRequestPartition::Predict;
    predict_view.fold_id = None;
    let mut predict_result = result.clone();
    predict_result.lineage.phase = Phase::Predict;
    predict_result.lineage.fold_id = None;
    let predict_consumption = predict_result.consumed_data_views.get_mut(&key).unwrap();
    predict_consumption.model_calls[0].operation = ModelInputOperation::Predict;
    predict_consumption.model_calls[0].target_fingerprint = None;
    predict_result.validate_for_task(&predict_task).unwrap();
    predict_task.data_views.get_mut(&key).unwrap().partition = DataRequestPartition::FoldValidation;
    assert!(predict_task
        .validate_dynamic_view_training_gate()
        .unwrap_err()
        .to_string()
        .contains("unsupported dynamic model view"));
    assert!(predict_result
        .validate_for_task(&predict_task)
        .unwrap_err()
        .to_string()
        .contains("unsupported dynamic model view"));
    predict_task.data_views.get_mut(&key).unwrap().partition = DataRequestPartition::Predict;
    predict_result
        .consumed_data_views
        .get_mut(&key)
        .unwrap()
        .model_calls
        .clear();
    assert!(predict_result
        .validate_for_task(&predict_task)
        .unwrap_err()
        .to_string()
        .contains("no full ordered read and predict call"));
    let encoded = serde_json::to_value(&result).unwrap();
    assert_eq!(
        encoded["consumed_data_views"][&key]["read_batches"],
        serde_json::json!([["sample:a", "sample:b", "sample:c"]])
    );
    assert_eq!(
        encoded["consumed_data_views"][&key]["model_calls"][0]["operation"],
        "fit"
    );
    assert_eq!(
        serde_json::from_value::<NodeResult>(encoded).unwrap(),
        result
    );

    result
        .consumed_data_views
        .get_mut(&key)
        .unwrap()
        .model_calls
        .clear();
    assert!(result
        .validate_required_model_calls_for_task(&task)
        .unwrap_err()
        .to_string()
        .contains("no full ordered read and fit call bound to dynamic training view"));
    result.consumed_data_views.clear();
    assert!(result
        .validate_required_model_calls_for_task(&task)
        .unwrap_err()
        .to_string()
        .contains("no full ordered read and fit call bound to dynamic training view"));
    result.consumed_data_views.insert(
        key.clone(),
        DataViewConsumption {
            receipt: receipt.clone(),
            read_batches: vec![sample_ids.clone()],
            model_calls: vec![ModelInputCall {
                operation: ModelInputOperation::Fit,
                sample_ids: sample_ids.clone(),
                input_fingerprint: "a".repeat(64),
                target_fingerprint: Some("b".repeat(64)),
            }],
        },
    );

    result
        .consumed_data_views
        .get_mut(&key)
        .unwrap()
        .read_batches = vec![vec![sample_ids[0].clone(), sample_ids[2].clone()]];
    assert!(result
        .validate_for_task(&task)
        .unwrap_err()
        .to_string()
        .contains("outside its ordered reads"));
    result
        .consumed_data_views
        .get_mut(&key)
        .unwrap()
        .read_batches = vec![sample_ids.clone()];
    result
        .consumed_data_views
        .get_mut(&key)
        .unwrap()
        .model_calls[0]
        .sample_ids = vec![sample_ids[0].clone(), sample_ids[2].clone()];
    assert!(result
        .validate_for_task(&task)
        .unwrap_err()
        .to_string()
        .contains("no full ordered read and fit call"));
    result
        .consumed_data_views
        .get_mut(&key)
        .unwrap()
        .model_calls[0]
        .sample_ids = sample_ids.clone();
    result.validate_for_task(&task).unwrap();

    let consumed = result.consumed_data_views.get_mut(&key).unwrap();
    consumed.model_calls[0].sample_ids = vec![sample_ids[1].clone(), sample_ids[0].clone()];
    assert!(result
        .validate_consumed_data_views_for_task(&task)
        .unwrap_err()
        .to_string()
        .contains("outside its ordered reads"));
    let consumed = result.consumed_data_views.get_mut(&key).unwrap();
    consumed.model_calls[0].sample_ids = vec![sample_ids[0].clone(), sample_ids[2].clone()];
    consumed.model_calls[0].input_fingerprint = "not-sha256".to_string();
    assert!(result
        .validate_consumed_data_views_for_task(&task)
        .unwrap_err()
        .to_string()
        .contains("valid SHA-256"));
    let consumed = result.consumed_data_views.get_mut(&key).unwrap();
    consumed.model_calls[0].input_fingerprint = "a".repeat(64);
    consumed.model_calls[0].target_fingerprint = None;
    assert!(result
        .validate_consumed_data_views_for_task(&task)
        .unwrap_err()
        .to_string()
        .contains("outside a training scope"));
    result
        .consumed_data_views
        .get_mut(&key)
        .unwrap()
        .model_calls[0]
        .target_fingerprint = Some("b".repeat(64));
    task.data_views.get_mut(&key).unwrap().partition = DataRequestPartition::FullTrain;
    assert!(result
        .validate_consumed_data_views_for_task(&task)
        .unwrap_err()
        .to_string()
        .contains("outside a training scope"));
    task.data_views.get_mut(&key).unwrap().partition = DataRequestPartition::FoldTrain;

    let consumed = result.consumed_data_views.get_mut(&key).unwrap();
    consumed
        .read_batches
        .push(vec![sample_ids[0].clone(), sample_ids[0].clone()]);
    assert!(result
        .validate_consumed_data_views_for_task(&task)
        .unwrap_err()
        .to_string()
        .contains("invalid ordered read IDs"));
    result
        .consumed_data_views
        .get_mut(&key)
        .unwrap()
        .read_batches = vec![vec![SampleId::new("sample:alien").unwrap()]];
    assert!(result
        .validate_consumed_data_views_for_task(&task)
        .unwrap_err()
        .to_string()
        .contains("invalid ordered read IDs"));
    result
        .consumed_data_views
        .get_mut(&key)
        .unwrap()
        .read_batches = Vec::new();
    assert!(result
        .validate_consumed_data_views_for_task(&task)
        .unwrap_err()
        .to_string()
        .contains("without read batches"));
    result
        .consumed_data_views
        .get_mut(&key)
        .unwrap()
        .read_batches = vec![Vec::new()];
    assert!(result
        .validate_consumed_data_views_for_task(&task)
        .unwrap_err()
        .to_string()
        .contains("invalid ordered read IDs"));
    result
        .consumed_data_views
        .get_mut(&key)
        .unwrap()
        .read_batches = vec![vec![sample_ids[0].clone()]];
    result
        .consumed_data_views
        .get_mut(&key)
        .unwrap()
        .receipt
        .content_fingerprint = "d".repeat(64);
    assert!(result
        .validate_consumed_data_views_for_task(&task)
        .unwrap_err()
        .to_string()
        .contains("different from its native task"));
    result.consumed_data_views.clear();
    result.consumed_data_views.insert(
        "data:other".to_string(),
        DataViewConsumption {
            receipt,
            read_batches: vec![vec![sample_ids[0].clone()]],
            model_calls: Vec::new(),
        },
    );
    assert!(result
        .validate_consumed_data_views_for_task(&task)
        .unwrap_err()
        .to_string()
        .contains("unreceipted data view"));
}

#[test]
fn feature_partition_join_restores_fold_identity_and_rejects_mismatched_inputs() {
    let mut task = fit_influence_validation_task(FitInfluenceTask::default());
    let ids = vec![
        SampleId::new("sample:a").unwrap(),
        SampleId::new("sample:b").unwrap(),
    ];
    for (index, value) in ["A", "B"].into_iter().enumerate() {
        let branch_view = crate::data::BranchViewPlan {
            view_id: format!("view:{value}"),
            branch_id: format!("branch:{value}"),
            mode: crate::data::BranchViewMode::ByMetadata,
            selector: crate::data::DataViewSelector {
                metadata: BTreeMap::from([("group".to_string(), serde_json::json!(value))]),
                ..Default::default()
            },
            allow_overlap: false,
            metadata: BTreeMap::new(),
        };
        task.data_views.insert(
            format!("data:branch_{index}_x"),
            DataProviderViewSpec {
                sample_ids: Some(ids.clone()),
                partition: DataRequestPartition::FoldTrain,
                fold_id: task.fold_id.clone(),
                source_ids: None,
                columns: None,
                include_augmented: false,
                include_excluded: false,
                branch_view: Some(branch_view),
                extra: BTreeMap::new(),
            },
        );
    }
    let joined = super::joined_feature_partition_view(&task, false)
        .unwrap()
        .unwrap();
    assert_eq!(joined.sample_ids, Some(ids));
    assert!(joined.branch_view.is_none());

    task.data_views
        .get_mut("data:branch_1_x")
        .unwrap()
        .sample_ids = Some(vec![SampleId::new("sample:b").unwrap()]);
    assert!(super::joined_feature_partition_view(&task, false)
        .unwrap_err()
        .to_string()
        .contains("identity universe"));
}

#[test]
fn fit_cv_test_predictions_require_attested_test_view_and_current_fold() {
    let mut task = fit_influence_validation_task(FitInfluenceTask::default());
    let test_id = SampleId::new("test:0").unwrap();
    let mut prediction = PredictionBlock {
        prediction_id: None,
        producer_node: task.node_plan.node_id.clone(),
        producer_port: Some("prediction".to_string()),
        partition: PredictionPartition::Test,
        fold_id: task.fold_id.clone(),
        sample_ids: vec![test_id.clone()],
        values: vec![vec![1.0]],
        target_names: vec!["y".to_string()],
    };
    assert!(validate_prediction_scope(&prediction, &task).is_err());
    task.data_views.insert(
        "data:x:test".to_string(),
        DataProviderViewSpec {
            sample_ids: Some(vec![test_id]),
            partition: DataRequestPartition::Predict,
            fold_id: None,
            source_ids: None,
            columns: None,
            include_augmented: false,
            include_excluded: true,
            branch_view: None,
            extra: BTreeMap::new(),
        },
    );
    validate_prediction_scope(&prediction, &task).unwrap();
    prediction.sample_ids = vec![SampleId::new("test:unattested").unwrap()];
    assert!(validate_prediction_scope(&prediction, &task).is_err());
    prediction.fold_id = Some(FoldId::new("fold:other").unwrap());
    assert!(validate_prediction_scope(&prediction, &task).is_err());
}

#[cfg(dag_ml_workspace_contract_fixtures)]
fn runtime_custom_loss_role(node_id: NodeId) -> TrainingLossRoleReference {
    let fixture: serde_json::Value = serde_json::from_str(include_str!(
        "../../../../examples/fixtures/criteria/criteria_contracts.v1.json"
    ))
    .unwrap();
    let mut role: TrainingLossRoleReference =
        serde_json::from_value(fixture["valid"]["training_loss_role"].clone()).unwrap();
    role.node_id = node_id;
    role
}

#[cfg(dag_ml_workspace_contract_fixtures)]
fn runtime_rust_custom_loss_role(node_id: NodeId) -> TrainingLossRoleReference {
    let mut role = runtime_custom_loss_role(node_id);
    role.loss.implementation.provider_id = "provider:rust-local".to_string();
    role.loss.implementation.binding_id = "binding:rust".to_string();
    role.loss.implementation.implementation_fingerprint = "2".repeat(64);
    role.loss.implementation.registry_key = Some("loss:run-123:asymmetric-rust".to_string());
    role.loss
        .implementation
        .capabilities
        .remove(&ImplementationCapability::NeedsGil);
    role.loss.implementation.descriptor_fingerprint =
        role.loss.implementation.compute_fingerprint().unwrap();
    role.validate().unwrap();
    role
}

#[test]
fn fit_influence_strict_requires_weight_support() {
    let error = resolve_fit_influence_task(
        FitInfluencePolicy::StrictWeightSupport,
        &BTreeSet::new(),
        &fit_influence_view(vec!["s1", "s1", "s2"]),
    )
    .unwrap_err()
    .to_string();

    assert!(
        error.contains("fit influence"),
        "unexpected strict support error: {error}"
    );
}

#[test]
fn d9_negative_controller_lacking_fit_influence_capability_is_rejected() {
    let error = resolve_fit_influence_task(
        FitInfluencePolicy::EqualSampleInfluence,
        &BTreeSet::new(),
        &fit_influence_view(vec!["s1", "s1", "s2"]),
    )
    .unwrap_err()
    .to_string();

    assert!(
        error.contains("controller capabilities do not support requested fit influence policy"),
        "unexpected D9 fit-influence capability error: {error}"
    );
}

#[test]
fn fit_influence_auto_falls_back_with_warning() {
    let task = resolve_fit_influence_task(
        FitInfluencePolicy::Auto,
        &BTreeSet::new(),
        &fit_influence_view(vec!["s1", "s1", "s2"]),
    )
    .unwrap();

    assert_eq!(task.effective_policy, FitInfluencePolicy::UniformRows);
    assert_eq!(task.mechanism, FitInfluenceMechanism::UniformRows);
    assert!(task.warnings[0].contains("fell back"));
    task.validate().unwrap();

    let diagnostic = task.diagnostic();
    assert!(diagnostic.fallback_used);
    assert_eq!(diagnostic.row_weight_count, 0);
    assert_eq!(diagnostic.warnings, task.warnings);
}

#[test]
fn d9_fit_influence_diagnostic_must_match_runtime_task_warnings() {
    let fit_influence = resolve_fit_influence_task(
        FitInfluencePolicy::Auto,
        &BTreeSet::new(),
        &fit_influence_view(vec!["s1", "s1", "s2"]),
    )
    .unwrap();
    let task = fit_influence_validation_task(fit_influence.clone());
    let diagnostic = fit_influence.diagnostic();
    diagnostic.validate(&task).unwrap();

    let mut wrong_fallback = diagnostic.clone();
    wrong_fallback.fallback_used = false;
    let error = wrong_fallback.validate(&task).unwrap_err().to_string();
    assert!(
        error.contains("fallback_used"),
        "unexpected fallback mismatch error: {error}"
    );

    let mut wrong_warning = diagnostic;
    wrong_warning.warnings = vec!["different warning".to_string()];
    let error = wrong_warning.validate(&task).unwrap_err().to_string();
    assert!(
        error.contains("warnings do not match"),
        "unexpected warning mismatch error: {error}"
    );
}

#[test]
fn equal_sample_influence_emits_per_row_weights_without_aggregation_weights() {
    let capabilities = BTreeSet::from([ControllerCapability::SupportsSampleWeights]);
    let task = resolve_fit_influence_task(
        FitInfluencePolicy::EqualSampleInfluence,
        &capabilities,
        &fit_influence_view(vec!["s1", "s1", "s2"]),
    )
    .unwrap();

    assert_eq!(task.mechanism, FitInfluenceMechanism::SampleWeights);
    assert_eq!(task.row_weights, vec![0.5, 0.5, 1.0]);

    let aggregation = AggregationPolicy {
        method: AggregationMethod::WeightedMean,
        weights: crate::policy::AggregationWeights::RepetitionCount,
        ..AggregationPolicy::default()
    };
    aggregation.validate().unwrap();
    assert_eq!(
        task.effective_policy,
        FitInfluencePolicy::EqualSampleInfluence
    );
}

#[cfg(dag_ml_workspace_contract_fixtures)]
#[test]
fn node_result_validation_rejects_external_conformance_mismatches() {
    let plan = build_execution_plan(
        "plan:result.validation",
        simple_graph(),
        CampaignSpec {
            inner_cv: None,
            id: "campaign:result.validation".to_string(),
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
        &manifests(),
    )
    .unwrap();
    let node_plan = plan
        .node_plans
        .get(&NodeId::new("model:pls").unwrap())
        .unwrap()
        .clone();
    let task = NodeTask {
        inner_fold_set: None,
        residual_targets: None,
        run_id: RunId::new("run:result.validation").unwrap(),
        node_plan: node_plan.clone(),
        phase: Phase::FitCv,
        resources: None,
        variant_id: None,
        variant: None,
        fold_id: None,
        branch_path: Vec::new(),
        input_handles: BTreeMap::new(),
        data_views: BTreeMap::new(),
        data_view_receipts: BTreeMap::new(),
        prediction_inputs: BTreeMap::new(),
        prediction_feature_matrix: None,
        prediction_feature_off_fold_matrix: None,
        artifact_inputs: BTreeMap::new(),
        required_loss_attestations: Vec::new(),
        fit_influence: FitInfluenceTask::default(),
        seed: Some(99),
    };
    let controller = MockController {
        id: node_plan.controller_id.clone(),
        handle: 2,
        emit_prediction: false,
    };
    let result = controller.invoke(&task).unwrap();
    result.validate_for_task(&task).unwrap();

    let mut bad_controller = result.clone();
    bad_controller.lineage.controller_id = ControllerId::new("controller:wrong").unwrap();
    assert!(bad_controller
        .validate_for_task(&task)
        .unwrap_err()
        .to_string()
        .contains("controller"));

    let mut bad_params = result.clone();
    bad_params.lineage.params_fingerprint = "wrong".to_string();
    assert!(bad_params
        .validate_for_task(&task)
        .unwrap_err()
        .to_string()
        .contains("params fingerprint"));

    let mut bad_output_owner = result.clone();
    bad_output_owner
        .outputs
        .get_mut("out")
        .unwrap()
        .owner_controller = ControllerId::new("controller:wrong").unwrap();
    assert!(bad_output_owner
        .validate_for_task(&task)
        .unwrap_err()
        .to_string()
        .contains("output `out`"));

    let mut loss_task = task.clone();
    let loss_role = runtime_custom_loss_role(loss_task.node_plan.node_id.clone());
    loss_task.node_plan.training_losses = vec![loss_role.clone()];
    loss_task.required_loss_attestations =
        NodeTask::required_loss_attestations_for(&loss_task.node_plan, loss_task.phase).unwrap();
    let (bound_role, bound_attestation) = loss_task.training_loss_binding(0).unwrap();
    assert_eq!(bound_role, &loss_role);
    assert_eq!(bound_attestation, &loss_task.required_loss_attestations[0]);
    assert!(loss_task
        .training_loss_binding(1)
        .unwrap_err()
        .to_string()
        .contains("outside the active training loss range"));
    assert_eq!(
        serde_json::to_value(&loss_task).unwrap()["required_loss_attestations"],
        serde_json::to_value(&loss_task.required_loss_attestations).unwrap()
    );
    let missing_attestation = controller.invoke(&loss_task).unwrap();
    assert!(missing_attestation
        .validate_for_task(&loss_task)
        .unwrap_err()
        .to_string()
        .contains("loss attestations"));

    let mut attested = missing_attestation;
    attested.lineage.loss_attestations =
        vec![LossExecutionAttestation::for_role(&loss_role, Phase::FitCv).unwrap()];
    attested.validate_for_task(&loss_task).unwrap();

    let mut first_role = loss_role.clone();
    first_role.output_id = Some("a".to_string());
    let mut second_role = loss_role.clone();
    second_role.output_id = Some("b".to_string());
    let mut multi_output_task = loss_task.clone();
    multi_output_task.node_plan.training_losses = vec![first_role.clone(), second_role.clone()];
    multi_output_task.required_loss_attestations = NodeTask::required_loss_attestations_for(
        &multi_output_task.node_plan,
        multi_output_task.phase,
    )
    .unwrap();
    let (bound_second_role, bound_second_attestation) =
        multi_output_task.training_loss_binding(1).unwrap();
    assert_eq!(bound_second_role, &second_role);
    assert_eq!(
        bound_second_attestation,
        &multi_output_task.required_loss_attestations[1]
    );

    let mut refit_only_role = loss_role.clone();
    refit_only_role.output_id = Some("refit-only".to_string());
    refit_only_role.phases = BTreeSet::from([Phase::Refit]);
    let mut fit_only_role = loss_role.clone();
    fit_only_role.output_id = Some("fit-only".to_string());
    fit_only_role.phases = BTreeSet::from([Phase::FitCv]);
    let mut phase_filtered_task = loss_task.clone();
    phase_filtered_task.node_plan.training_losses = vec![refit_only_role, fit_only_role.clone()];
    phase_filtered_task.required_loss_attestations = NodeTask::required_loss_attestations_for(
        &phase_filtered_task.node_plan,
        phase_filtered_task.phase,
    )
    .unwrap();
    let (bound_fit_role, bound_fit_attestation) =
        phase_filtered_task.training_loss_binding(0).unwrap();
    assert_eq!(bound_fit_role, &fit_only_role);
    assert_eq!(
        bound_fit_attestation,
        &phase_filtered_task.required_loss_attestations[0]
    );

    let mut reversed = controller.invoke(&multi_output_task).unwrap();
    reversed.lineage.loss_attestations = vec![
        LossExecutionAttestation::for_role(&second_role, Phase::FitCv).unwrap(),
        LossExecutionAttestation::for_role(&first_role, Phase::FitCv).unwrap(),
    ];
    assert!(reversed
        .validate_for_task(&multi_output_task)
        .unwrap_err()
        .to_string()
        .contains("does not match"));

    let mut refit_task = loss_task.clone();
    refit_task.phase = Phase::Refit;
    refit_task.required_loss_attestations =
        NodeTask::required_loss_attestations_for(&refit_task.node_plan, refit_task.phase).unwrap();
    let mut refit_result = controller.invoke(&refit_task).unwrap();
    refit_result.lineage.loss_attestations =
        vec![LossExecutionAttestation::for_role(&loss_role, Phase::Refit).unwrap()];
    refit_result.validate_for_task(&refit_task).unwrap();
    refit_result.lineage.loss_attestations = attested.lineage.loss_attestations.clone();
    assert!(refit_result
        .validate_for_task(&refit_task)
        .unwrap_err()
        .to_string()
        .contains("does not match"));

    let mut mismatched = attested;
    mismatched.lineage.loss_attestations[0].semantic_fingerprint = "0".repeat(64);
    mismatched.lineage.loss_attestations[0].attestation_fingerprint =
        mismatched.lineage.loss_attestations[0]
            .compute_fingerprint()
            .unwrap();
    assert!(mismatched
        .validate_for_task(&loss_task)
        .unwrap_err()
        .to_string()
        .contains("does not match"));

    let mut stale_requirements = loss_task.clone();
    stale_requirements.required_loss_attestations.clear();
    assert!(stale_requirements.training_loss_binding(0).is_err());
    assert!(controller
        .invoke(&stale_requirements)
        .unwrap()
        .validate_for_task(&stale_requirements)
        .unwrap_err()
        .to_string()
        .contains("loss execution requirements"));

    let mut tampered_requirements = loss_task.clone();
    tampered_requirements.required_loss_attestations[0].reduction =
        crate::criteria::LossReduction::Sum;
    tampered_requirements.required_loss_attestations[0].attestation_fingerprint =
        tampered_requirements.required_loss_attestations[0]
            .compute_fingerprint()
            .unwrap();
    assert!(tampered_requirements.training_loss_binding(0).is_err());
    assert!(controller
        .invoke(&tampered_requirements)
        .unwrap()
        .validate_for_task(&tampered_requirements)
        .unwrap_err()
        .to_string()
        .contains("loss execution requirements"));

    assert!(
        NodeTask::required_loss_attestations_for(&loss_task.node_plan, Phase::Predict)
            .unwrap()
            .is_empty()
    );
    let mut predict_task = loss_task;
    predict_task.phase = Phase::Predict;
    predict_task.required_loss_attestations.clear();
    assert!(predict_task
        .training_loss_binding(0)
        .unwrap_err()
        .to_string()
        .contains("FIT_CV or REFIT"));
}

#[cfg(dag_ml_workspace_contract_fixtures)]
#[test]
fn scheduler_populates_native_loss_execution_requirements() {
    let mut controller_manifests = ControllerRegistry::new();
    controller_manifests
        .register(controller_manifest(
            "controller:transform",
            NodeKind::Transform,
        ))
        .unwrap();
    let mut model_manifest = controller_manifest("controller:model", NodeKind::Model);
    model_manifest
        .supported_phases
        .extend([Phase::FitCv, Phase::Refit]);
    model_manifest.capabilities.extend([
        ControllerCapability::NeedsPythonGil,
        ControllerCapability::SupportsConfigurableLoss,
        ControllerCapability::SupportsCustomLoss,
        ControllerCapability::SupportsDifferentiableLoss,
    ]);
    controller_manifests.register(model_manifest).unwrap();
    let mut plan = build_execution_plan(
        "plan:loss.requirements.scheduler",
        simple_graph(),
        CampaignSpec {
            inner_cv: None,
            id: "campaign:loss.requirements.scheduler".to_string(),
            root_seed: Some(17),
            leakage_policy: Default::default(),
            aggregation_policy: Default::default(),
            split_invocation: None,
            generation: Default::default(),
            shape_plans: BTreeMap::new(),
            data_bindings: BTreeMap::new(),
            branch_view_plans: Vec::new(),
            metadata: BTreeMap::new(),
        },
        &controller_manifests,
    )
    .unwrap();
    let model_id = NodeId::new("model:pls").unwrap();
    let role = runtime_custom_loss_role(model_id.clone());
    plan.node_plans.get_mut(&model_id).unwrap().training_losses = vec![role.clone()];
    plan.validate().unwrap();

    let mut controllers = RuntimeControllerRegistry::new();
    controllers
        .register(Box::new(MockController {
            id: ControllerId::new("controller:transform").unwrap(),
            handle: 1,
            emit_prediction: false,
        }))
        .unwrap();
    controllers
        .register(Box::new(LossRequirementEchoController {
            inner: MockController {
                id: ControllerId::new("controller:model").unwrap(),
                handle: 2,
                emit_prediction: false,
            },
        }))
        .unwrap();
    let mut context = RunContext::new(
        RunId::new("run:loss.requirements.scheduler").unwrap(),
        Some(17),
    );
    let results = SequentialScheduler
        .execute_campaign_phase(&plan, &controllers, &mut context, Phase::FitCv)
        .unwrap();
    let model_result = results
        .iter()
        .find(|result| result.node_id == model_id)
        .unwrap();
    assert_eq!(
        model_result.lineage.loss_attestations,
        vec![LossExecutionAttestation::for_role(&role, Phase::FitCv).unwrap()]
    );
}

#[cfg(dag_ml_workspace_contract_fixtures)]
#[test]
fn scheduler_executes_rust_local_loss_before_attesting() {
    let mut controller_manifests = ControllerRegistry::new();
    let mut transform_manifest = controller_manifest("controller:transform", NodeKind::Transform);
    transform_manifest
        .supported_phases
        .extend([Phase::FitCv, Phase::Refit]);
    controller_manifests.register(transform_manifest).unwrap();
    let mut model_manifest = controller_manifest("controller:model", NodeKind::Model);
    model_manifest
        .supported_phases
        .extend([Phase::FitCv, Phase::Refit]);
    model_manifest.capabilities.extend([
        ControllerCapability::SupportsConfigurableLoss,
        ControllerCapability::SupportsCustomLoss,
        ControllerCapability::SupportsDifferentiableLoss,
    ]);
    controller_manifests.register(model_manifest).unwrap();
    let mut plan = build_execution_plan(
        "plan:loss.rust.scheduler",
        simple_graph(),
        CampaignSpec {
            inner_cv: None,
            id: "campaign:loss.rust.scheduler".to_string(),
            root_seed: Some(23),
            leakage_policy: Default::default(),
            aggregation_policy: Default::default(),
            split_invocation: None,
            generation: Default::default(),
            shape_plans: BTreeMap::new(),
            data_bindings: BTreeMap::new(),
            branch_view_plans: Vec::new(),
            metadata: BTreeMap::new(),
        },
        &controller_manifests,
    )
    .unwrap();
    let model_id = NodeId::new("model:pls").unwrap();
    let role = runtime_rust_custom_loss_role(model_id.clone());
    plan.node_plans.get_mut(&model_id).unwrap().training_losses = vec![role.clone()];
    plan.validate().unwrap();

    let registry = Arc::new(Mutex::new(LocalImplementationRegistry::<RustLossFn>::new()));
    let loss: RustLossFn = Arc::new(|target, prediction| (prediction - target).abs());
    registry
        .lock()
        .unwrap()
        .register_loss(&role.loss, loss)
        .unwrap();
    let calls = Arc::new(Mutex::new(Vec::new()));

    let mut controllers = RuntimeControllerRegistry::new();
    controllers
        .register(Box::new(MockController {
            id: ControllerId::new("controller:transform").unwrap(),
            handle: 1,
            emit_prediction: false,
        }))
        .unwrap();
    controllers
        .register(Box::new(RustLocalLossController {
            inner: MockController {
                id: ControllerId::new("controller:model").unwrap(),
                handle: 2,
                emit_prediction: false,
            },
            registry: Arc::clone(&registry),
            calls: Arc::clone(&calls),
        }))
        .unwrap();

    let mut context = RunContext::new(RunId::new("run:loss.rust.scheduler").unwrap(), Some(23));
    let fit_results = SequentialScheduler
        .execute_campaign_phase(&plan, &controllers, &mut context, Phase::FitCv)
        .unwrap();
    let refit_results = SequentialScheduler
        .execute_campaign_phase(&plan, &controllers, &mut context, Phase::Refit)
        .unwrap();

    let expected_fit = LossExecutionAttestation::for_role(&role, Phase::FitCv).unwrap();
    let expected_refit = LossExecutionAttestation::for_role(&role, Phase::Refit).unwrap();
    let model_fit = fit_results
        .iter()
        .find(|result| result.node_id == model_id)
        .unwrap();
    let model_refit = refit_results
        .iter()
        .find(|result| result.node_id == model_id)
        .unwrap();
    assert_eq!(model_fit.lineage.loss_attestations, vec![expected_fit]);
    assert_eq!(model_refit.lineage.loss_attestations, vec![expected_refit]);

    let calls = calls.lock().unwrap().clone();
    assert_eq!(calls.len(), 2);
    assert_eq!(calls[0].0, Phase::FitCv);
    assert_eq!(calls[0].1, None);
    assert!((calls[0].2 - 3.5).abs() < f64::EPSILON);
    assert_eq!(calls[1].0, Phase::Refit);
    assert_eq!(calls[1].1, None);
    assert!((calls[1].2 - 3.5).abs() < f64::EPSILON);

    let nonfinite_registry = Arc::new(Mutex::new(LocalImplementationRegistry::<RustLossFn>::new()));
    let nonfinite_loss: RustLossFn = Arc::new(|_, _| f64::NAN);
    nonfinite_registry
        .lock()
        .unwrap()
        .register_loss(&role.loss, nonfinite_loss)
        .unwrap();
    let nonfinite_calls = Arc::new(Mutex::new(Vec::new()));
    let mut nonfinite_controllers = RuntimeControllerRegistry::new();
    nonfinite_controllers
        .register(Box::new(MockController {
            id: ControllerId::new("controller:transform").unwrap(),
            handle: 1,
            emit_prediction: false,
        }))
        .unwrap();
    nonfinite_controllers
        .register(Box::new(RustLocalLossController {
            inner: MockController {
                id: ControllerId::new("controller:model").unwrap(),
                handle: 2,
                emit_prediction: false,
            },
            registry: Arc::clone(&nonfinite_registry),
            calls: Arc::clone(&nonfinite_calls),
        }))
        .unwrap();
    let mut nonfinite_context =
        RunContext::new(RunId::new("run:loss.rust.nonfinite").unwrap(), Some(23));
    let error = SequentialScheduler
        .execute_campaign_phase(
            &plan,
            &nonfinite_controllers,
            &mut nonfinite_context,
            Phase::FitCv,
        )
        .unwrap_err()
        .to_string();
    assert!(
        error.contains("non-finite scalar"),
        "unexpected non-finite loss error: {error}"
    );
    assert!(nonfinite_calls.lock().unwrap().is_empty());
}

#[test]
fn node_result_validation_checks_shape_fingerprints_and_feature_deltas() {
    let model_id = NodeId::new("model:pls").unwrap();
    let initial_feature_schema = "a".repeat(64);
    let updated_feature_schema = "b".repeat(64);
    let shape_plan = DataModelShapePlan {
        node_id: model_id.clone(),
        input_granularity: Granularity::Sample,
        target_granularity: Granularity::Sample,
        fit_rows: FitBoundary::FoldTrain,
        predict_rows: FitBoundary::FoldValidation,
        feature_namespace: Some("raw.x".to_string()),
        feature_schema_fingerprint: Some(initial_feature_schema.clone()),
        target_space: "raw".to_string(),
        aggregation_policy: AggregationPolicy::default(),
        augmentation_policy: Default::default(),
        selection_policy: Default::default(),
    };
    let plan = build_execution_plan(
        "plan:result.validation.shape",
        simple_graph(),
        CampaignSpec {
            inner_cv: None,
            id: "campaign:result.validation.shape".to_string(),
            root_seed: Some(11),
            leakage_policy: Default::default(),
            aggregation_policy: Default::default(),
            split_invocation: None,
            generation: Default::default(),
            shape_plans: BTreeMap::from([(model_id.clone(), shape_plan.clone())]),
            data_bindings: BTreeMap::new(),
            branch_view_plans: Vec::new(),
            metadata: BTreeMap::new(),
        },
        &manifests(),
    )
    .unwrap();
    let node_plan = plan.node_plans.get(&model_id).unwrap().clone();
    let task = NodeTask {
        inner_fold_set: None,
        residual_targets: None,
        run_id: RunId::new("run:result.validation.shape").unwrap(),
        node_plan: node_plan.clone(),
        phase: Phase::FitCv,
        resources: None,
        variant_id: None,
        variant: None,
        fold_id: None,
        branch_path: Vec::new(),
        input_handles: BTreeMap::new(),
        data_views: BTreeMap::new(),
        data_view_receipts: BTreeMap::new(),
        prediction_inputs: BTreeMap::new(),
        prediction_feature_matrix: None,
        prediction_feature_off_fold_matrix: None,
        artifact_inputs: BTreeMap::new(),
        required_loss_attestations: Vec::new(),
        fit_influence: FitInfluenceTask::default(),
        seed: Some(99),
    };
    let controller = MockController {
        id: node_plan.controller_id.clone(),
        handle: 2,
        emit_prediction: false,
    };
    let mut result = controller.invoke(&task).unwrap();
    result.lineage.data_model_shape_fingerprint =
        Some(stable_json_fingerprint(&shape_plan).unwrap());
    result.lineage.aggregation_policy_fingerprint =
        Some(stable_json_fingerprint(&shape_plan.aggregation_policy).unwrap());
    result.shape_deltas = vec![ShapeDelta {
        node_id: model_id.clone(),
        kind: ShapeDeltaKind::Feature,
        before_fingerprint: initial_feature_schema.clone(),
        after_fingerprint: updated_feature_schema.clone(),
        metadata: BTreeMap::from([(
            "feature_namespace".to_string(),
            serde_json::Value::String("selected.x".to_string()),
        )]),
    }];
    result.validate_for_task(&task).unwrap();

    let mut wrong_shape_fingerprint = result.clone();
    wrong_shape_fingerprint.lineage.data_model_shape_fingerprint = Some("0".repeat(64));
    assert!(wrong_shape_fingerprint
        .validate_for_task(&task)
        .unwrap_err()
        .to_string()
        .contains("data/model shape fingerprint"));

    let mut wrong_feature_delta = result.clone();
    wrong_feature_delta.shape_deltas[0].before_fingerprint = "c".repeat(64);
    assert!(wrong_feature_delta
        .validate_for_task(&task)
        .unwrap_err()
        .to_string()
        .contains("expected current schema"));

    let mut unchanged_delta = result;
    unchanged_delta.shape_deltas[0].after_fingerprint = initial_feature_schema;
    assert!(unchanged_delta
        .validate_for_task(&task)
        .unwrap_err()
        .to_string()
        .contains("does not change fingerprint"));
}

#[test]
fn node_result_validation_rejects_bad_artifact_handles() {
    let plan = build_execution_plan(
        "plan:result.validation.artifacts",
        simple_graph(),
        CampaignSpec {
            inner_cv: None,
            id: "campaign:result.validation.artifacts".to_string(),
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
        &manifests(),
    )
    .unwrap();
    let node_plan = plan
        .node_plans
        .get(&NodeId::new("model:pls").unwrap())
        .unwrap()
        .clone();
    let task = NodeTask {
        inner_fold_set: None,
        residual_targets: None,
        run_id: RunId::new("run:result.validation.artifacts").unwrap(),
        node_plan: node_plan.clone(),
        phase: Phase::Refit,
        resources: None,
        variant_id: None,
        variant: None,
        fold_id: None,
        branch_path: Vec::new(),
        input_handles: BTreeMap::new(),
        data_views: BTreeMap::new(),
        data_view_receipts: BTreeMap::new(),
        prediction_inputs: BTreeMap::new(),
        prediction_feature_matrix: None,
        prediction_feature_off_fold_matrix: None,
        artifact_inputs: BTreeMap::new(),
        required_loss_attestations: Vec::new(),
        fit_influence: FitInfluenceTask::default(),
        seed: Some(99),
    };
    let controller = MockController {
        id: node_plan.controller_id.clone(),
        handle: 2,
        emit_prediction: false,
    };
    let base = controller.invoke(&task).unwrap();
    let artifact = ArtifactRef {
        id: ArtifactId::new("artifact:model:pls:refit").unwrap(),
        kind: "mock_model".to_string(),
        controller_id: node_plan.controller_id.clone(),
        backend: None,
        uri: None,
        content_fingerprint: None,
        size_bytes: Some(128),
        plugin: None,
        plugin_version: None,
        abi_major: None,
        abi_min_minor: None,
        native_predictor_descriptor: None,
        native_estimator_descriptor: None,
    };
    let handle = HandleRef {
        handle: 77,
        kind: HandleKind::Model,
        owner_controller: node_plan.controller_id.clone(),
    };
    let mut valid = base.clone();
    valid.artifacts = vec![artifact.clone()];
    valid
        .artifact_handles
        .insert(artifact.id.clone(), handle.clone());
    valid.lineage.artifact_refs = vec![artifact.clone()];
    valid.validate_for_task(&task).unwrap();

    let mut missing_handle = valid.clone();
    missing_handle.artifact_handles.clear();
    assert!(missing_handle
        .validate_for_task(&task)
        .unwrap_err()
        .to_string()
        .contains("without artifact handle"));

    let mut wrong_kind = valid.clone();
    wrong_kind
        .artifact_handles
        .get_mut(&artifact.id)
        .unwrap()
        .kind = HandleKind::Data;
    assert!(wrong_kind
        .validate_for_task(&task)
        .unwrap_err()
        .to_string()
        .contains("non-artifact/model handle kind"));

    let mut wrong_owner = valid.clone();
    wrong_owner
        .artifact_handles
        .get_mut(&artifact.id)
        .unwrap()
        .owner_controller = ControllerId::new("controller:wrong").unwrap();
    assert!(wrong_owner
        .validate_for_task(&task)
        .unwrap_err()
        .to_string()
        .contains("owned by"));

    let mut undeclared_handle = base.clone();
    undeclared_handle.artifact_handles.insert(
        ArtifactId::new("artifact:model:pls:extra").unwrap(),
        handle.clone(),
    );
    assert!(undeclared_handle
        .validate_for_task(&task)
        .unwrap_err()
        .to_string()
        .contains("undeclared artifact"));

    let mut missing_lineage_ref = valid;
    missing_lineage_ref.lineage.artifact_refs.clear();
    assert!(missing_lineage_ref
        .validate_for_task(&task)
        .unwrap_err()
        .to_string()
        .contains("lineage artifact ref"));
}

#[test]
fn artifact_ref_validates_portable_metadata() {
    let content_fingerprint = "a".repeat(64);
    let artifact = ArtifactRef {
        id: ArtifactId::new("artifact:model:portable").unwrap(),
        kind: "model".to_string(),
        controller_id: ControllerId::new("controller:sklearn").unwrap(),
        backend: Some(ArtifactBackend::Joblib),
        uri: Some(format!("artifacts/{content_fingerprint}.joblib")),
        content_fingerprint: Some(content_fingerprint.clone()),
        size_bytes: Some(4096),
        plugin: Some("dagml.sklearn".to_string()),
        plugin_version: Some("1.0.0".to_string()),
        abi_major: None,
        abi_min_minor: None,
        native_predictor_descriptor: None,
        native_estimator_descriptor: None,
    };

    artifact.validate().unwrap();
    let encoded = serde_json::to_value(&artifact).unwrap();
    assert_eq!(encoded["backend"].as_str(), Some("joblib"));
    assert_eq!(
        encoded["content_fingerprint"].as_str(),
        Some(content_fingerprint.as_str())
    );

    let legacy: ArtifactRef = serde_json::from_value(serde_json::json!({
        "id": "artifact:model:legacy",
        "kind": "mock_model",
        "controller_id": "controller:mock",
        "size_bytes": 128
    }))
    .unwrap();
    assert_eq!(legacy.backend, None);
    assert_eq!(legacy.content_fingerprint, None);
    legacy.validate().unwrap();

    let legacy_with_extension: ArtifactRef = serde_json::from_value(serde_json::json!({
        "id": "artifact:model:legacy-extension",
        "kind": "mock_model",
        "controller_id": "controller:mock",
        "size_bytes": 128,
        "host_metadata": { "format": "joblib", "version": 1 }
    }))
    .unwrap();
    legacy_with_extension.validate().unwrap();
}

#[test]
fn artifact_ref_rejects_invalid_portable_metadata() {
    let mut artifact = ArtifactRef {
        id: ArtifactId::new("artifact:model:portable").unwrap(),
        kind: "model".to_string(),
        controller_id: ControllerId::new("controller:sklearn").unwrap(),
        backend: Some(ArtifactBackend::Joblib),
        uri: Some("artifacts/model.joblib".to_string()),
        content_fingerprint: Some("b".repeat(64)),
        size_bytes: Some(4096),
        plugin: Some("dagml.sklearn".to_string()),
        plugin_version: Some("1.0.0".to_string()),
        abi_major: None,
        abi_min_minor: None,
        native_predictor_descriptor: None,
        native_estimator_descriptor: None,
    };
    artifact.validate().unwrap();

    let mut bad_fingerprint = artifact.clone();
    bad_fingerprint.content_fingerprint = Some("not-a-digest".to_string());
    assert!(bad_fingerprint
        .validate()
        .unwrap_err()
        .to_string()
        .contains("artifact content fingerprint"));

    let mut missing_backend = artifact.clone();
    missing_backend.backend = None;
    assert!(missing_backend
        .validate()
        .unwrap_err()
        .to_string()
        .contains("uri without backend"));

    let mut missing_fingerprint = artifact.clone();
    missing_fingerprint.content_fingerprint = None;
    assert!(missing_fingerprint
        .validate()
        .unwrap_err()
        .to_string()
        .contains("uri without content_fingerprint"));

    artifact.plugin = None;
    assert!(artifact
        .validate()
        .unwrap_err()
        .to_string()
        .contains("plugin_version without plugin"));
}

#[test]
fn node_result_validation_rejects_predictions_outside_validation_view() {
    let model_id = NodeId::new("model:pls").unwrap();
    let plan = build_execution_plan(
        "plan:result.validation.samples",
        simple_graph(),
        CampaignSpec {
            inner_cv: None,
            id: "campaign:result.validation.samples".to_string(),
            root_seed: Some(11),
            leakage_policy: Default::default(),
            aggregation_policy: Default::default(),
            split_invocation: Some(SplitInvocation {
                id: "split:outer".to_string(),
                controller_id: None,
                leakage_policy: Default::default(),
                params: BTreeMap::new(),
                fold_set: Some(two_fold_set()),
            }),
            generation: Default::default(),
            shape_plans: BTreeMap::new(),
            data_bindings: BTreeMap::from([(model_id.clone(), vec![data_binding(&model_id)])]),
            branch_view_plans: Vec::new(),
            metadata: BTreeMap::new(),
        },
        &manifests(),
    )
    .unwrap();
    let node_plan = plan.node_plans.get(&model_id).unwrap().clone();
    let task = NodeTask {
        inner_fold_set: None,
        residual_targets: None,
        run_id: RunId::new("run:result.validation.samples").unwrap(),
        node_plan: node_plan.clone(),
        phase: Phase::FitCv,
        resources: None,
        variant_id: Some(VariantId::new("variant:base").unwrap()),
        variant: None,
        fold_id: Some(FoldId::new("fold:0").unwrap()),
        branch_path: Vec::new(),
        input_handles: BTreeMap::new(),
        data_views: BTreeMap::from([(
            "data:x:validation".to_string(),
            DataProviderViewSpec {
                sample_ids: Some(vec![SampleId::new("s1").unwrap()]),
                partition: DataRequestPartition::FoldValidation,
                fold_id: Some(FoldId::new("fold:0").unwrap()),
                source_ids: None,
                columns: None,
                include_augmented: false,
                include_excluded: false,
                branch_view: None,
                extra: BTreeMap::new(),
            },
        )]),
        data_view_receipts: BTreeMap::new(),
        prediction_inputs: BTreeMap::new(),
        prediction_feature_matrix: None,
        prediction_feature_off_fold_matrix: None,
        artifact_inputs: BTreeMap::new(),
        required_loss_attestations: Vec::new(),
        fit_influence: FitInfluenceTask::default(),
        seed: Some(99),
    };
    let result = NodeResult {
        schema_version: None,
        classification_probabilities: Vec::new(),
        consumed_data_views: std::collections::BTreeMap::new(),
        node_id: model_id.clone(),
        outputs: BTreeMap::from([(
            "out".to_string(),
            HandleRef {
                handle: 7,
                kind: HandleKind::Data,
                owner_controller: node_plan.controller_id.clone(),
            },
        )]),
        predictions: vec![PredictionBlock {
            prediction_id: Some("pred:bad.sample".to_string()),
            producer_node: model_id,
            producer_port: None,
            partition: PredictionPartition::Validation,
            fold_id: Some(FoldId::new("fold:0").unwrap()),
            sample_ids: vec![SampleId::new("s2").unwrap()],
            values: vec![vec![1.0]],
            target_names: vec!["y".to_string()],
        }],
        observation_predictions: Vec::new(),
        aggregated_predictions: Vec::new(),
        explanations: Vec::new(),
        shape_deltas: Vec::new(),
        artifacts: Vec::new(),
        artifact_handles: BTreeMap::new(),
        fit_influence_diagnostics: Vec::new(),
        regression_targets: Vec::new(),
        lineage: LineageRecord {
            record_id: LineageId::new("lineage:bad.sample").unwrap(),
            run_id: task.run_id.clone(),
            node_id: task.node_plan.node_id.clone(),
            phase: task.phase,
            controller_id: task.node_plan.controller_id.clone(),
            controller_version: task.node_plan.controller_version.clone(),
            variant_id: task.variant_id.clone(),
            fold_id: task.fold_id.clone(),
            branch_path: task.branch_path.clone(),
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
            target_domain: None,
        },
    };

    assert!(result.validate_for_task(&task).is_err());
}

// R-P1-5: a Sample-level aggregated validation block must stay inside its
// fold's validation view, mirroring the raw-prediction scope check. A unit
// outside the view is rejected; an in-view unit is accepted unchanged.
#[test]
fn node_result_validation_rejects_aggregated_units_outside_validation_view() {
    let model_id = NodeId::new("model:pls").unwrap();
    let plan = build_execution_plan(
        "plan:result.validation.aggregated",
        simple_graph(),
        CampaignSpec {
            inner_cv: None,
            id: "campaign:result.validation.aggregated".to_string(),
            root_seed: Some(11),
            leakage_policy: Default::default(),
            aggregation_policy: Default::default(),
            split_invocation: Some(SplitInvocation {
                id: "split:outer".to_string(),
                controller_id: None,
                leakage_policy: Default::default(),
                params: BTreeMap::new(),
                fold_set: Some(two_fold_set()),
            }),
            generation: Default::default(),
            shape_plans: BTreeMap::new(),
            data_bindings: BTreeMap::from([(model_id.clone(), vec![data_binding(&model_id)])]),
            branch_view_plans: Vec::new(),
            metadata: BTreeMap::new(),
        },
        &manifests(),
    )
    .unwrap();
    let node_plan = plan.node_plans.get(&model_id).unwrap().clone();
    let task = NodeTask {
        inner_fold_set: None,
        residual_targets: None,
        run_id: RunId::new("run:result.validation.aggregated").unwrap(),
        node_plan: node_plan.clone(),
        phase: Phase::FitCv,
        resources: None,
        variant_id: Some(VariantId::new("variant:base").unwrap()),
        variant: None,
        fold_id: Some(FoldId::new("fold:0").unwrap()),
        branch_path: Vec::new(),
        input_handles: BTreeMap::new(),
        data_views: BTreeMap::from([(
            "data:x:validation".to_string(),
            DataProviderViewSpec {
                sample_ids: Some(vec![SampleId::new("s1").unwrap()]),
                partition: DataRequestPartition::FoldValidation,
                fold_id: Some(FoldId::new("fold:0").unwrap()),
                source_ids: None,
                columns: None,
                include_augmented: false,
                include_excluded: false,
                branch_view: None,
                extra: BTreeMap::new(),
            },
        )]),
        data_view_receipts: BTreeMap::new(),
        prediction_inputs: BTreeMap::new(),
        prediction_feature_matrix: None,
        prediction_feature_off_fold_matrix: None,
        artifact_inputs: BTreeMap::new(),
        required_loss_attestations: Vec::new(),
        fit_influence: FitInfluenceTask::default(),
        seed: Some(99),
    };
    let aggregated_block = |sample: &str| AggregatedPredictionBlock {
        prediction_id: Some("pred:agg".to_string()),
        producer_node: model_id.clone(),
        producer_port: None,
        partition: PredictionPartition::Validation,
        fold_id: Some(FoldId::new("fold:0").unwrap()),
        level: PredictionLevel::Sample,
        unit_ids: vec![PredictionUnitId::Sample(SampleId::new(sample).unwrap())],
        values: vec![vec![1.0]],
        target_names: vec!["y".to_string()],
    };
    let mut result = NodeResult {
        schema_version: None,
        classification_probabilities: Vec::new(),
        consumed_data_views: std::collections::BTreeMap::new(),
        node_id: model_id.clone(),
        outputs: BTreeMap::from([(
            "out".to_string(),
            HandleRef {
                handle: 7,
                kind: HandleKind::Data,
                owner_controller: node_plan.controller_id.clone(),
            },
        )]),
        predictions: Vec::new(),
        observation_predictions: Vec::new(),
        aggregated_predictions: vec![aggregated_block("s2")],
        explanations: Vec::new(),
        shape_deltas: Vec::new(),
        artifacts: Vec::new(),
        artifact_handles: BTreeMap::new(),
        fit_influence_diagnostics: Vec::new(),
        regression_targets: Vec::new(),
        lineage: LineageRecord {
            record_id: LineageId::new("lineage:agg.scope").unwrap(),
            run_id: task.run_id.clone(),
            node_id: task.node_plan.node_id.clone(),
            phase: task.phase,
            controller_id: task.node_plan.controller_id.clone(),
            controller_version: task.node_plan.controller_version.clone(),
            variant_id: task.variant_id.clone(),
            fold_id: task.fold_id.clone(),
            branch_path: task.branch_path.clone(),
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
            target_domain: None,
        },
    };

    // Malformed: aggregated sample unit `s2` is outside fold:0's validation view {s1}.
    let error = result.validate_for_task(&task).unwrap_err().to_string();
    assert!(
        error.contains("outside its validation view"),
        "unexpected aggregated scope error: {error}"
    );

    // Valid: aggregated sample unit inside the validation view passes unchanged.
    result.aggregated_predictions = vec![aggregated_block("s1")];
    result.validate_for_task(&task).unwrap();
}

// R-P1-6: a controller that emits aggregated predictions itself (bypassing
// native aggregation) must emit them at the node's policy level. A block at a
// different level is rejected before it can be scored against a mismatched
// policy; a matching-level block is accepted.
#[test]
fn controller_emitted_aggregated_block_must_match_policy_level() {
    let model_id = NodeId::new("model:obs").unwrap();
    let graph = GraphSpec {
        id: "graph:agg.policy.level".to_string(),
        interface: GraphInterface::default(),
        nodes: vec![node(
            model_id.as_str(),
            NodeKind::Model,
            vec![port("x", PortKind::Data)],
            vec![port("pred", PortKind::Prediction)],
        )],
        edges: Vec::new(),
        search_space_fingerprint: None,
        metadata: BTreeMap::new(),
    };
    let mut shape_plans = BTreeMap::new();
    shape_plans.insert(
        model_id.clone(),
        DataModelShapePlan {
            node_id: model_id.clone(),
            input_granularity: Granularity::Sample,
            target_granularity: Granularity::Sample,
            fit_rows: FitBoundary::FoldTrain,
            predict_rows: FitBoundary::FoldValidation,
            feature_namespace: Some("nir".to_string()),
            feature_schema_fingerprint: None,
            target_space: "regression:y".to_string(),
            // Native policy aggregates to GROUP level.
            aggregation_policy: custom_aggregation_policy(PredictionLevel::Group),
            augmentation_policy: Default::default(),
            selection_policy: Default::default(),
        },
    );
    let campaign = CampaignSpec {
        inner_cv: None,
        id: "campaign:agg.policy.level".to_string(),
        root_seed: Some(7),
        leakage_policy: Default::default(),
        aggregation_policy: Default::default(),
        split_invocation: None,
        generation: Default::default(),
        shape_plans,
        data_bindings: BTreeMap::new(),
        branch_view_plans: Vec::new(),
        metadata: BTreeMap::new(),
    };
    let plan =
        build_execution_plan("plan:agg.policy.level", graph, campaign, &manifests()).unwrap();
    let node_plan = plan.node_plans.get(&model_id).unwrap().clone();
    let task = NodeTask {
        inner_fold_set: None,
        residual_targets: None,
        run_id: RunId::new("run:agg.policy.level").unwrap(),
        node_plan: node_plan.clone(),
        phase: Phase::FitCv,
        resources: None,
        variant_id: Some(VariantId::new("variant:base").unwrap()),
        variant: None,
        fold_id: None,
        branch_path: Vec::new(),
        input_handles: BTreeMap::new(),
        data_views: BTreeMap::new(),
        data_view_receipts: BTreeMap::new(),
        prediction_inputs: BTreeMap::new(),
        prediction_feature_matrix: None,
        prediction_feature_off_fold_matrix: None,
        artifact_inputs: BTreeMap::new(),
        required_loss_attestations: Vec::new(),
        fit_influence: FitInfluenceTask::default(),
        seed: Some(99),
    };
    let controllers = RuntimeControllerRegistry::new();
    let resources = PhaseScopeResources {
        data_provider: None,
        fold_set_override: None,
        node_filter: None,
        cached_data_node_ids: None,
        suppress_inner_cv: false,
        nested_stacking: None,
        replay_artifact_handles: None,
        replay_artifact_inputs: None,
        replay_bundle_id: None,
        data_envelopes: None,
        prediction_cache_store: None,
        prediction_cache_contracts: None,
        direct_sample_prediction_only: false,
        artifact_store: None,
    };
    let aggregated_block =
        |level: PredictionLevel, unit: PredictionUnitId| AggregatedPredictionBlock {
            prediction_id: Some("pred:agg".to_string()),
            producer_node: model_id.clone(),
            producer_port: None,
            partition: PredictionPartition::Final,
            fold_id: None,
            level,
            unit_ids: vec![unit],
            values: vec![vec![1.0]],
            target_names: vec!["y".to_string()],
        };
    let lineage = LineageRecord {
        record_id: LineageId::new("lineage:agg.policy.level").unwrap(),
        run_id: task.run_id.clone(),
        node_id: task.node_plan.node_id.clone(),
        phase: task.phase,
        controller_id: task.node_plan.controller_id.clone(),
        controller_version: task.node_plan.controller_version.clone(),
        variant_id: task.variant_id.clone(),
        fold_id: task.fold_id.clone(),
        branch_path: task.branch_path.clone(),
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
        target_domain: None,
    };
    let base_result = |level: PredictionLevel, unit: PredictionUnitId| NodeResult {
        schema_version: None,
        classification_probabilities: Vec::new(),
        consumed_data_views: std::collections::BTreeMap::new(),
        node_id: model_id.clone(),
        outputs: BTreeMap::new(),
        predictions: vec![PredictionBlock {
            prediction_id: Some("pred:sample".to_string()),
            producer_node: model_id.clone(),
            producer_port: None,
            partition: PredictionPartition::Final,
            fold_id: None,
            sample_ids: vec![SampleId::new("s1").unwrap()],
            values: vec![vec![1.0]],
            target_names: vec!["y".to_string()],
        }],
        observation_predictions: Vec::new(),
        aggregated_predictions: vec![aggregated_block(level, unit)],
        explanations: Vec::new(),
        shape_deltas: Vec::new(),
        artifacts: Vec::new(),
        artifact_handles: BTreeMap::new(),
        fit_influence_diagnostics: Vec::new(),
        regression_targets: Vec::new(),
        lineage: lineage.clone(),
    };

    // Malformed: block aggregated at TARGET level but the node policy is GROUP.
    let mut bad = base_result(
        PredictionLevel::Target,
        PredictionUnitId::Target(TargetId::new("target:a").unwrap()),
    );
    let error =
        apply_result_prediction_aggregation(&plan, &controllers, &task, &mut bad, &resources)
            .unwrap_err()
            .to_string();
    assert!(
        error.contains("aggregation policy is")
            && error.contains("Group")
            && error.contains("Target"),
        "unexpected policy-level error: {error}"
    );

    // Valid: block aggregated at the policy GROUP level passes the level gate.
    let mut good = base_result(
        PredictionLevel::Group,
        PredictionUnitId::Group(GroupId::new("group:a").unwrap()),
    );
    apply_result_prediction_aggregation(&plan, &controllers, &task, &mut good, &resources).unwrap();
}

// R-P1-8: a binding that REQUIRES coordinator relations must resolve them. With
// no envelope and no provider the relations are unresolvable, which must be a
// hard error (not a silent empty exclusion set); a provider that supplies the
// relations resolves them unchanged.
#[test]
fn coordinator_relations_required_but_unresolved_is_refused() {
    let model_id = NodeId::new("model:pls").unwrap();
    let mut campaign = oof_edge_campaign();
    campaign.data_bindings = BTreeMap::from([(model_id.clone(), vec![data_binding(&model_id)])]);
    let plan = build_execution_plan(
        "plan:relations.required",
        simple_graph(),
        campaign,
        &manifests(),
    )
    .unwrap();
    let node_plan = plan.node_plans.get(&model_id).unwrap().clone();
    assert!(node_plan.data_bindings.iter().any(|b| b.require_relations));

    // Malformed: relations are required but neither envelope nor provider supplies them.
    let empty_resources = PhaseScopeResources {
        data_provider: None,
        fold_set_override: None,
        node_filter: None,
        cached_data_node_ids: None,
        suppress_inner_cv: false,
        nested_stacking: None,
        replay_artifact_handles: None,
        replay_artifact_inputs: None,
        replay_bundle_id: None,
        data_envelopes: None,
        prediction_cache_store: None,
        prediction_cache_contracts: None,
        direct_sample_prediction_only: false,
        artifact_store: None,
    };
    let error = coordinator_relations_for_node(&node_plan, &empty_resources)
        .unwrap_err()
        .to_string();
    assert!(
        error.contains("requires coordinator relations but none were resolved"),
        "unexpected unresolved-relations error: {error}"
    );

    // Valid: a provider carrying the binding's relations resolves them.
    let envelope: ExternalDataPlanEnvelope = serde_json::from_str(include_str!(
        "../../tests/fixtures/package/data/coordinator_data_plan_envelope_sample12.json"
    ))
    .unwrap();
    let provider = InMemoryDataProvider::with_envelope(
        ControllerId::new("controller:data.provider").unwrap(),
        envelope,
    )
    .unwrap();
    let provider_resources = PhaseScopeResources {
        data_provider: Some(&provider),
        fold_set_override: None,
        node_filter: None,
        cached_data_node_ids: None,
        suppress_inner_cv: false,
        nested_stacking: None,
        replay_artifact_handles: None,
        replay_artifact_inputs: None,
        replay_bundle_id: None,
        data_envelopes: None,
        prediction_cache_store: None,
        prediction_cache_contracts: None,
        direct_sample_prediction_only: false,
        artifact_store: None,
    };
    let relations = coordinator_relations_for_node(&node_plan, &provider_resources).unwrap();
    assert!(
        relations.is_some(),
        "expected the provider to supply relations"
    );
}

// R-P1-8: a data view handle is delivered to the controller as a data input, so
// a provider that returns a non-data/data-view handle (e.g. a model handle)
// across the ABI must be refused.
#[test]
fn make_data_view_handle_refuses_non_data_handle_kind() {
    struct WrongKindViewProvider {
        owner: ControllerId,
    }
    impl RuntimeDataProvider for WrongKindViewProvider {
        fn materialize(&self, _request: &DataMaterializationRequest) -> Result<HandleRef> {
            Ok(HandleRef {
                handle: 1,
                kind: HandleKind::Data,
                owner_controller: self.owner.clone(),
            })
        }
        fn make_view(&self, _request: &DataViewRequest) -> Result<HandleRef> {
            // A misbehaving provider hands back a MODEL handle as if it were a view.
            Ok(HandleRef {
                handle: 2,
                kind: HandleKind::Model,
                owner_controller: self.owner.clone(),
            })
        }
    }

    let owner = ControllerId::new("controller:data.provider").unwrap();
    let provider = WrongKindViewProvider {
        owner: owner.clone(),
    };
    let model_id = NodeId::new("model:pls").unwrap();
    let mut campaign = oof_edge_campaign();
    campaign.data_bindings = BTreeMap::from([(model_id.clone(), vec![data_binding(&model_id)])]);
    let plan = build_execution_plan(
        "plan:view.handle.kind",
        simple_graph(),
        campaign,
        &manifests(),
    )
    .unwrap();
    let node_plan = plan.node_plans.get(&model_id).unwrap().clone();
    let binding = node_plan.data_bindings[0].clone();
    let ctx = RunContext::new(RunId::new("run:view.handle.kind").unwrap(), Some(11));
    let scope = PhaseScope {
        phase: Phase::FitCv,
        variant_id: Some(VariantId::new("variant:base").unwrap()),
        variant: None,
        fold_id: Some(FoldId::new("fold:0").unwrap()),
        seed_root: Some(11),
    };
    let data_handle = HandleRef {
        handle: 1,
        kind: HandleKind::Data,
        owner_controller: owner.clone(),
    };
    let view = DataProviderViewSpec {
        sample_ids: Some(vec![SampleId::new("s1").unwrap()]),
        partition: DataRequestPartition::FoldTrain,
        fold_id: Some(FoldId::new("fold:0").unwrap()),
        source_ids: None,
        columns: None,
        include_augmented: false,
        include_excluded: false,
        branch_view: None,
        extra: BTreeMap::new(),
    };
    let error = make_data_view_handle(
        &provider,
        &ctx,
        &node_plan,
        &scope,
        &binding,
        DataViewHandleInput {
            data_handle: &data_handle,
            view: &view,
            predict_cohort: None,
        },
    )
    .unwrap_err()
    .to_string();
    assert!(
        error.contains("non-data/data-view handle kind"),
        "unexpected handle-kind error: {error}"
    );
}

// ADR-26: a top-level PREDICT uses only its separately attested cohort.  It
// must not touch the CV relation authority, even when the binding requires it
// for FIT_CV/REFIT.  The exact cohort also reaches both provider boundaries.
#[test]
fn predict_uses_attested_cohort_without_resolving_cv_relations() {
    struct PredictCohortProbe {
        owner: ControllerId,
        cohort: PredictCohort,
        materialize_calls: std::cell::Cell<usize>,
        make_view_calls: std::cell::Cell<usize>,
        relation_calls: std::cell::Cell<usize>,
    }

    impl RuntimeDataProvider for PredictCohortProbe {
        fn materialize(&self, request: &DataMaterializationRequest) -> Result<HandleRef> {
            self.materialize_calls.set(self.materialize_calls.get() + 1);
            assert_eq!(request.phase, Phase::Predict);
            assert_eq!(request.predict_cohort.as_ref(), Some(&self.cohort));
            Ok(HandleRef {
                handle: 81,
                kind: HandleKind::Data,
                owner_controller: self.owner.clone(),
            })
        }

        fn make_view(&self, request: &DataViewRequest) -> Result<HandleRef> {
            self.make_view_calls.set(self.make_view_calls.get() + 1);
            assert_eq!(request.phase, Phase::Predict);
            assert!(request.view_key.starts_with("view:v1:"));
            assert!(request.view_seed.is_some());
            assert_eq!(request.predict_cohort.as_ref(), Some(&self.cohort));
            assert_eq!(request.view.partition, DataRequestPartition::Predict);
            assert_eq!(request.view.fold_id, None);
            assert_eq!(
                request.view.sample_ids,
                Some(self.cohort.physical_sample_ids.clone())
            );
            Ok(HandleRef {
                handle: 82,
                kind: HandleKind::DataView,
                owner_controller: self.owner.clone(),
            })
        }

        fn make_view_attested(&self, request: &DataViewRequest) -> Result<AttestedDataView> {
            let handle = self.make_view(request)?;
            Ok(AttestedDataView {
                receipt: Some(DataViewReceipt {
                    handle: handle.clone(),
                    view_key: request.view_key.clone(),
                    sample_ids: request
                        .view
                        .sample_ids
                        .clone()
                        .expect("explicit PREDICT IDs"),
                    schema_fingerprint: "a".repeat(64),
                    content_fingerprint: "b".repeat(64),
                }),
                handle,
            })
        }

        fn coordinator_relations(
            &self,
            _binding: &crate::data::DataBinding,
        ) -> Result<Option<SampleRelationSet>> {
            self.relation_calls.set(self.relation_calls.get() + 1);
            Err(DagMlError::RuntimeValidation(
                "PREDICT must not resolve CV coordinator relations".to_string(),
            ))
        }

        fn predict_cohort(
            &self,
            _binding: &crate::data::DataBinding,
            phase: Phase,
        ) -> Result<Option<PredictCohort>> {
            assert_eq!(phase, Phase::Predict);
            Ok(Some(self.cohort.clone()))
        }
    }

    let held_out = SampleId::new("heldout:1").unwrap();
    let relations = SampleRelationSet {
        records: vec![crate::relation::SampleRelation::new(
            ObservationId::new("obs:heldout.1").unwrap(),
            held_out.clone(),
        )],
    };
    let relation_fingerprint = relations.fingerprint().unwrap();
    let mut cohort = PredictCohort {
        role: PredictCohortRole::ExternalTest,
        physical_sample_ids: vec![held_out.clone()],
        origin_sample_ids: vec![held_out.clone()],
        target_names: vec!["y".to_string()],
        relation_fingerprint,
        relations,
        data_content_fingerprint: "a".repeat(64),
        target_content_fingerprint: Some("b".repeat(64)),
        cohort_fingerprint: String::new(),
    };
    cohort.cohort_fingerprint = cohort.fingerprint().unwrap();

    let model_id = NodeId::new("model:pls").unwrap();
    let mut campaign = oof_edge_campaign();
    campaign.data_bindings = BTreeMap::from([(model_id.clone(), vec![data_binding(&model_id)])]);
    let plan = build_execution_plan(
        "plan:predict.cohort.only",
        simple_graph(),
        campaign,
        &manifests(),
    )
    .unwrap();
    cohort
        .validate_against_cv_fold_set(plan.fold_set.as_ref().unwrap())
        .unwrap();
    let node_plan = plan.node_plans.get(&model_id).unwrap();
    let provider = PredictCohortProbe {
        owner: ControllerId::new("controller:data.predict-cohort").unwrap(),
        cohort: cohort.clone(),
        materialize_calls: std::cell::Cell::new(0),
        make_view_calls: std::cell::Cell::new(0),
        relation_calls: std::cell::Cell::new(0),
    };
    let resources = PhaseScopeResources {
        data_provider: Some(&provider),
        ..Default::default()
    };
    let ctx = RunContext::new(RunId::new("run:predict.cohort.only").unwrap(), Some(11));
    let collected = collect_input_handles(
        &plan,
        node_plan,
        &BTreeMap::new(),
        &BTreeMap::new(),
        &resources,
        &ctx,
        &PhaseScope {
            phase: Phase::Predict,
            variant_id: Some(VariantId::new("variant:base").unwrap()),
            variant: None,
            fold_id: None,
            seed_root: Some(11),
        },
    )
    .unwrap();

    assert_eq!(provider.materialize_calls.get(), 1);
    assert_eq!(provider.make_view_calls.get(), 1);
    assert_eq!(provider.relation_calls.get(), 0);
    let receipt = &collected.data_view_receipts["data:x"];
    assert_eq!(receipt.handle, collected.handles["data:x"]);
    assert_eq!(receipt.sample_ids, vec![held_out.clone()]);
    assert!(receipt.view_key.starts_with("view:v1:"));
    assert_eq!(receipt.content_fingerprint, "b".repeat(64));
    assert_eq!(
        collected.data_views["data:x"].sample_ids,
        Some(vec![held_out])
    );
}

#[test]
fn refit_issues_an_attested_external_test_companion_view() {
    struct RefitTestProvider {
        owner: ControllerId,
        train_relations: SampleRelationSet,
        omit_relations: bool,
        generated: bool,
        cohort: Option<PredictCohort>,
        refit_ids: Option<Vec<SampleId>>,
        refit_id_calls: std::cell::Cell<usize>,
        materializations: std::cell::RefCell<Vec<DataMaterializationRequest>>,
        views: std::cell::RefCell<Vec<DataViewRequest>>,
    }

    impl RuntimeDataProvider for RefitTestProvider {
        fn generated_views_enabled(&self) -> bool {
            self.generated
        }

        fn materialize(&self, request: &DataMaterializationRequest) -> Result<HandleRef> {
            self.materializations.borrow_mut().push(request.clone());
            Ok(HandleRef {
                handle: if request.predict_cohort.is_some() {
                    91
                } else {
                    90
                },
                kind: HandleKind::Data,
                owner_controller: self.owner.clone(),
            })
        }

        fn make_view(&self, request: &DataViewRequest) -> Result<HandleRef> {
            Ok(HandleRef {
                handle: if request.view.partition == DataRequestPartition::Predict {
                    93
                } else {
                    92
                },
                kind: HandleKind::DataView,
                owner_controller: self.owner.clone(),
            })
        }

        fn make_view_attested(&self, request: &DataViewRequest) -> Result<AttestedDataView> {
            self.views.borrow_mut().push(request.clone());
            let handle = self.make_view(request)?;
            Ok(AttestedDataView {
                receipt: self.generated.then(|| DataViewReceipt {
                    handle: handle.clone(),
                    view_key: request.view_key.clone(),
                    sample_ids: request.view.sample_ids.clone().expect("selected IDs"),
                    schema_fingerprint: "a".repeat(64),
                    content_fingerprint: "b".repeat(64),
                }),
                handle,
            })
        }

        fn coordinator_relations(
            &self,
            _binding: &DataBinding,
        ) -> Result<Option<SampleRelationSet>> {
            Ok((!self.omit_relations).then(|| self.train_relations.clone()))
        }

        fn cv_test_cohort(&self, _binding: &DataBinding) -> Result<Option<PredictCohort>> {
            Ok(self.cohort.clone())
        }

        fn refit_sample_ids(&self, _binding: &DataBinding) -> Result<Option<Vec<SampleId>>> {
            let calls = self.refit_id_calls.get() + 1;
            self.refit_id_calls.set(calls);
            if calls > 1 {
                return Ok(self
                    .cohort
                    .as_ref()
                    .map(|cohort| cohort.physical_sample_ids.clone()));
            }
            Ok(self.refit_ids.clone())
        }
    }

    let model_id = NodeId::new("model:pls").unwrap();
    let mut campaign = oof_edge_campaign();
    campaign.data_bindings = BTreeMap::from([(model_id.clone(), vec![data_binding(&model_id)])]);
    let plan = build_execution_plan(
        "plan:refit.external.test.view",
        simple_graph(),
        campaign,
        &manifests(),
    )
    .unwrap();
    let training_ids = plan.fold_set.as_ref().unwrap().sample_ids.clone();
    let train_relations = SampleRelationSet {
        records: training_ids
            .iter()
            .enumerate()
            .map(|(index, id)| {
                SampleRelation::new(
                    ObservationId::new(format!("obs:train:{index}")).unwrap(),
                    id.clone(),
                )
            })
            .collect(),
    };
    let test_id = SampleId::new("external:test").unwrap();
    let test_relations = SampleRelationSet {
        records: vec![SampleRelation::new(
            ObservationId::new("obs:external.test").unwrap(),
            test_id.clone(),
        )],
    };
    let mut cohort = PredictCohort {
        role: PredictCohortRole::ExternalTest,
        physical_sample_ids: vec![test_id.clone()],
        origin_sample_ids: vec![test_id.clone()],
        target_names: vec!["y".to_string()],
        relation_fingerprint: test_relations.fingerprint().unwrap(),
        relations: test_relations,
        data_content_fingerprint: "c".repeat(64),
        target_content_fingerprint: Some("d".repeat(64)),
        cohort_fingerprint: String::new(),
    };
    cohort.cohort_fingerprint = cohort.fingerprint().unwrap();
    cohort
        .validate_against_cv_fold_set(plan.fold_set.as_ref().unwrap())
        .unwrap();
    let provider = RefitTestProvider {
        owner: ControllerId::new("controller:refit.test.provider").unwrap(),
        train_relations,
        omit_relations: false,
        generated: true,
        cohort: Some(cohort.clone()),
        refit_ids: None,
        refit_id_calls: std::cell::Cell::new(0),
        materializations: std::cell::RefCell::new(Vec::new()),
        views: std::cell::RefCell::new(Vec::new()),
    };
    let ctx = RunContext::new(
        RunId::new("run:refit.external.test.view").unwrap(),
        Some(11),
    );
    let scope = PhaseScope {
        phase: Phase::Refit,
        variant_id: None,
        variant: None,
        fold_id: None,
        seed_root: Some(11),
    };
    let collected = collect_input_handles(
        &plan,
        plan.node_plans.get(&model_id).unwrap(),
        &BTreeMap::new(),
        &BTreeMap::new(),
        &PhaseScopeResources {
            data_provider: Some(&provider),
            ..Default::default()
        },
        &ctx,
        &scope,
    )
    .unwrap();

    assert_eq!(
        collected.data_views["data:x"].partition,
        DataRequestPartition::FullTrain
    );
    assert_eq!(
        collected.data_views["data:x"].sample_ids,
        Some(training_ids.clone())
    );
    assert_eq!(
        collected.data_views["data:x:test"].partition,
        DataRequestPartition::Predict
    );
    assert_eq!(
        collected.data_views["data:x:test"].sample_ids,
        Some(vec![test_id.clone()])
    );
    assert_eq!(
        collected.data_view_receipts["data:x:test"].sample_ids,
        vec![test_id.clone()]
    );
    assert_eq!(
        collected.data_view_receipts["data:x:test"].handle,
        collected.handles["data:x:test"]
    );
    assert_eq!(provider.materializations.borrow().len(), 2);
    assert!(provider.materializations.borrow()[0]
        .predict_cohort
        .is_none());
    assert_eq!(
        provider.materializations.borrow()[1].predict_cohort,
        Some(cohort.clone())
    );
    assert_eq!(
        provider.views.borrow()[1].predict_cohort,
        Some(cohort.clone())
    );

    let mut task = fit_influence_validation_task(FitInfluenceTask::default());
    task.node_plan = plan.node_plans.get(&model_id).unwrap().clone();
    task.phase = Phase::Refit;
    task.fold_id = None;
    task.input_handles = collected.handles.clone();
    task.data_views = collected.data_views.clone();
    task.data_view_receipts = collected.data_view_receipts.clone();
    task.validate_dynamic_view_training_gate().unwrap();

    let make_candidate =
        |candidate: PredictCohort, relations: SampleRelationSet| RefitTestProvider {
            owner: provider.owner.clone(),
            train_relations: relations,
            omit_relations: false,
            generated: true,
            cohort: Some(candidate),
            refit_ids: None,
            refit_id_calls: std::cell::Cell::new(0),
            materializations: std::cell::RefCell::new(Vec::new()),
            views: std::cell::RefCell::new(Vec::new()),
        };
    let make_cohort = |sample: SampleId, origin: Option<SampleId>| {
        let mut relation =
            SampleRelation::new(ObservationId::new("obs:overlap.candidate").unwrap(), sample);
        relation.origin_sample_id = origin;
        PredictCohort::from_relations(
            PredictCohortRole::ExternalTest,
            SampleRelationSet {
                records: vec![relation],
            },
            vec!["y".to_string()],
            "c".repeat(64),
            Some("d".repeat(64)),
        )
        .unwrap()
    };
    let physical_overlap = make_candidate(
        make_cohort(training_ids[0].clone(), None),
        provider.train_relations.clone(),
    );
    let cv_scope = PhaseScope {
        phase: Phase::FitCv,
        fold_id: Some(FoldId::new("fold:0").unwrap()),
        ..scope.clone()
    };
    let error = collect_input_handles(
        &plan,
        plan.node_plans.get(&model_id).unwrap(),
        &BTreeMap::new(),
        &BTreeMap::new(),
        &PhaseScopeResources {
            data_provider: Some(&physical_overlap),
            ..Default::default()
        },
        &ctx,
        &cv_scope,
    )
    .err()
    .expect("invalid external test must fail")
    .to_string();
    assert!(
        error.contains("overlaps CV fold sample or origin"),
        "{error}"
    );
    assert!(physical_overlap.materializations.borrow().is_empty());

    let origin_overlap = make_candidate(
        make_cohort(test_id.clone(), Some(training_ids[0].clone())),
        provider.train_relations.clone(),
    );
    let error = collect_input_handles(
        &plan,
        plan.node_plans.get(&model_id).unwrap(),
        &BTreeMap::new(),
        &BTreeMap::new(),
        &PhaseScopeResources {
            data_provider: Some(&origin_overlap),
            ..Default::default()
        },
        &ctx,
        &scope,
    )
    .err()
    .expect("invalid external test must fail")
    .to_string();
    assert!(
        error.contains("overlaps CV fold sample or origin"),
        "{error}"
    );
    assert!(origin_overlap.materializations.borrow().is_empty());

    let mut aliased_relations = provider.train_relations.clone();
    aliased_relations.records[0].origin_sample_id = Some(test_id.clone());
    let relation_overlap = make_candidate(cohort.clone(), aliased_relations);
    let error = collect_input_handles(
        &plan,
        plan.node_plans.get(&model_id).unwrap(),
        &BTreeMap::new(),
        &BTreeMap::new(),
        &PhaseScopeResources {
            data_provider: Some(&relation_overlap),
            ..Default::default()
        },
        &ctx,
        &scope,
    )
    .err()
    .expect("invalid external test must fail")
    .to_string();
    assert!(
        error.contains("overlaps CV relation identity closure"),
        "{error}"
    );
    assert!(relation_overlap.materializations.borrow().is_empty());

    let mut override_fold_set = two_fold_set();
    let replaced_id = SampleId::new("s2").unwrap();
    for id in &mut override_fold_set.sample_ids {
        if *id == replaced_id {
            *id = test_id.clone();
        }
    }
    for fold in &mut override_fold_set.folds {
        for id in fold
            .train_sample_ids
            .iter_mut()
            .chain(fold.validation_sample_ids.iter_mut())
        {
            if *id == replaced_id {
                *id = test_id.clone();
            }
        }
    }
    override_fold_set.validate().unwrap();
    let override_provider = make_candidate(cohort.clone(), provider.train_relations.clone());
    let error = collect_input_handles(
        &plan,
        plan.node_plans.get(&model_id).unwrap(),
        &BTreeMap::new(),
        &BTreeMap::new(),
        &PhaseScopeResources {
            data_provider: Some(&override_provider),
            fold_set_override: Some(&override_fold_set),
            ..Default::default()
        },
        &ctx,
        &scope,
    )
    .err()
    .expect("invalid external test must fail")
    .to_string();
    assert!(
        error.contains("overlaps CV fold sample or origin"),
        "{error}"
    );
    assert!(override_provider.materializations.borrow().is_empty());

    let mut no_fold_plan = plan.clone();
    no_fold_plan.fold_set = None;
    let no_fold_provider = make_candidate(cohort.clone(), provider.train_relations.clone());
    let error = collect_input_handles(
        &no_fold_plan,
        no_fold_plan.node_plans.get(&model_id).unwrap(),
        &BTreeMap::new(),
        &BTreeMap::new(),
        &PhaseScopeResources {
            data_provider: Some(&no_fold_provider),
            ..Default::default()
        },
        &ctx,
        &scope,
    )
    .err()
    .expect("invalid external test must fail")
    .to_string();
    assert!(error.contains("without attested training IDs"), "{error}");
    assert!(no_fold_provider.materializations.borrow().is_empty());

    let mut no_fold_attested = make_candidate(cohort.clone(), provider.train_relations.clone());
    no_fold_attested.refit_ids = Some(training_ids.clone());
    let no_fold = collect_input_handles(
        &no_fold_plan,
        no_fold_plan.node_plans.get(&model_id).unwrap(),
        &BTreeMap::new(),
        &BTreeMap::new(),
        &PhaseScopeResources {
            data_provider: Some(&no_fold_attested),
            ..Default::default()
        },
        &ctx,
        &scope,
    )
    .unwrap();
    assert_eq!(no_fold_attested.refit_id_calls.get(), 1);
    assert_eq!(
        no_fold.data_views["data:x"].sample_ids,
        Some(training_ids.clone())
    );

    // A static REFIT-only host does not request or validate a generated test
    // companion, even when its envelope has an external-test cohort.
    let mut no_fold_static = make_candidate(cohort.clone(), provider.train_relations.clone());
    no_fold_static.generated = false;
    let static_refit = collect_input_handles(
        &no_fold_plan,
        no_fold_plan.node_plans.get(&model_id).unwrap(),
        &BTreeMap::new(),
        &BTreeMap::new(),
        &PhaseScopeResources {
            data_provider: Some(&no_fold_static),
            ..Default::default()
        },
        &ctx,
        &scope,
    )
    .unwrap();
    assert_eq!(no_fold_static.refit_id_calls.get(), 1);
    assert!(!static_refit.data_views.contains_key("data:x:test"));

    let mut no_relations_provider =
        make_candidate(cohort.clone(), provider.train_relations.clone());
    no_relations_provider.omit_relations = true;
    let mut optional_relation_node_plan = plan.node_plans.get(&model_id).unwrap().clone();
    optional_relation_node_plan.data_bindings[0].require_relations = false;
    optional_relation_node_plan.data_bindings[0].relation_fingerprint = None;
    let error = collect_input_handles(
        &plan,
        &optional_relation_node_plan,
        &BTreeMap::new(),
        &BTreeMap::new(),
        &PhaseScopeResources {
            data_provider: Some(&no_relations_provider),
            ..Default::default()
        },
        &ctx,
        &scope,
    )
    .err()
    .expect("invalid external test must fail")
    .to_string();
    assert!(
        error.contains("without CV coordinator relations"),
        "{error}"
    );
    assert!(no_relations_provider.materializations.borrow().is_empty());

    let without_test = RefitTestProvider {
        owner: provider.owner.clone(),
        train_relations: provider.train_relations.clone(),
        omit_relations: false,
        generated: true,
        cohort: None,
        refit_ids: None,
        refit_id_calls: std::cell::Cell::new(0),
        materializations: std::cell::RefCell::new(Vec::new()),
        views: std::cell::RefCell::new(Vec::new()),
    };
    let collected_without_test = collect_input_handles(
        &plan,
        plan.node_plans.get(&model_id).unwrap(),
        &BTreeMap::new(),
        &BTreeMap::new(),
        &PhaseScopeResources {
            data_provider: Some(&without_test),
            ..Default::default()
        },
        &ctx,
        &scope,
    )
    .unwrap();
    assert!(!collected_without_test
        .data_views
        .contains_key("data:x:test"));
    assert_eq!(without_test.materializations.borrow().len(), 1);

    // Raw hosts opt in to the same external-test isolation without claiming
    // generated buffers or manufacturing dynamic-view receipts.
    let mut raw_campaign = oof_edge_campaign();
    let mut raw_binding = data_binding(&model_id);
    assert!(!raw_binding.view_policy.include_refit_test_view);
    raw_binding.view_policy.include_refit_test_view = true;
    raw_campaign.data_bindings = BTreeMap::from([(model_id.clone(), vec![raw_binding])]);
    let raw_plan = build_execution_plan(
        "plan:refit.raw.external.test.view",
        simple_graph(),
        raw_campaign,
        &manifests(),
    )
    .unwrap();
    let make_raw_candidate = |candidate: PredictCohort, relations: SampleRelationSet| {
        let mut candidate = make_candidate(candidate, relations);
        candidate.generated = false;
        candidate
    };
    let collect_raw = |candidate_plan: &ExecutionPlan,
                       candidate: &RefitTestProvider,
                       override_folds: Option<&FoldSet>| {
        collect_input_handles(
            candidate_plan,
            candidate_plan.node_plans.get(&model_id).unwrap(),
            &BTreeMap::new(),
            &BTreeMap::new(),
            &PhaseScopeResources {
                data_provider: Some(candidate),
                fold_set_override: override_folds,
                ..Default::default()
            },
            &ctx,
            &scope,
        )
    };
    let raw_provider = make_raw_candidate(cohort.clone(), provider.train_relations.clone());
    let raw = collect_raw(&raw_plan, &raw_provider, None).unwrap();
    assert_eq!(raw.data_views.len(), 2);
    assert_eq!(
        raw.data_views["data:x"].partition,
        DataRequestPartition::FullTrain
    );
    assert_eq!(
        raw.data_views["data:x"].sample_ids,
        Some(training_ids.clone())
    );
    let raw_test_view = &raw.data_views["data:x:test"];
    assert_eq!(raw_test_view.partition, DataRequestPartition::Predict);
    assert_eq!(raw_test_view.sample_ids, Some(vec![test_id.clone()]));
    assert!(raw_test_view.fold_id.is_none());
    assert!(!raw_test_view.include_augmented);
    assert!(!raw_test_view
        .extra
        .contains_key("include_augmented_refit_predictions"));
    assert!(raw.data_view_receipts.is_empty());
    assert_eq!(raw_provider.materializations.borrow().len(), 2);
    assert!(raw_provider.materializations.borrow()[0]
        .predict_cohort
        .is_none());
    assert_eq!(
        raw_provider.materializations.borrow()[1].predict_cohort,
        Some(cohort.clone())
    );
    assert!(raw_provider.views.borrow()[0].predict_cohort.is_none());
    assert_eq!(
        raw_provider.views.borrow()[1].predict_cohort,
        Some(cohort.clone())
    );
    let mut raw_task = task.clone();
    raw_task.node_plan = raw_plan.node_plans.get(&model_id).unwrap().clone();
    raw_task.input_handles = raw.handles;
    raw_task.data_views = raw.data_views;
    raw_task.data_view_receipts = raw.data_view_receipts;
    raw_task.validate_dynamic_view_training_gate().unwrap();

    let mut raw_no_fold_plan = raw_plan.clone();
    raw_no_fold_plan.fold_set = None;
    let mut raw_no_fold_provider =
        make_raw_candidate(cohort.clone(), provider.train_relations.clone());
    raw_no_fold_provider.refit_ids = Some(training_ids.clone());
    let raw_no_fold = collect_raw(&raw_no_fold_plan, &raw_no_fold_provider, None).unwrap();
    assert_eq!(raw_no_fold_provider.refit_id_calls.get(), 1);
    assert_eq!(
        raw_no_fold.data_views["data:x"].sample_ids,
        Some(training_ids.clone())
    );
    assert_eq!(
        raw_no_fold.data_views["data:x:test"].sample_ids,
        Some(vec![test_id.clone()])
    );
    assert!(raw_no_fold.data_view_receipts.is_empty());
    assert!(raw_no_fold_provider.materializations.borrow()[0]
        .predict_cohort
        .is_none());
    assert_eq!(
        raw_no_fold_provider.materializations.borrow()[1].predict_cohort,
        Some(cohort.clone())
    );

    let inference_cohort = PredictCohort::from_relations(
        PredictCohortRole::Inference,
        cohort.relations.clone(),
        vec!["y".to_string()],
        "c".repeat(64),
        None,
    )
    .unwrap();
    let mut raw_aliased_relations = provider.train_relations.clone();
    raw_aliased_relations.records[0].origin_sample_id = Some(test_id.clone());
    for (label, candidate_cohort, candidate_relations, expected_error) in [
        (
            "physical overlap",
            make_cohort(training_ids[0].clone(), None),
            provider.train_relations.clone(),
            "overlaps CV fold sample or origin",
        ),
        (
            "origin overlap",
            make_cohort(test_id.clone(), Some(training_ids[0].clone())),
            provider.train_relations.clone(),
            "overlaps CV fold sample or origin",
        ),
        (
            "relation overlap",
            cohort.clone(),
            raw_aliased_relations,
            "overlaps CV relation identity closure",
        ),
        (
            "inference cohort",
            inference_cohort,
            provider.train_relations.clone(),
            "non-external-test cohort",
        ),
    ] {
        let candidate = make_raw_candidate(candidate_cohort, candidate_relations);
        let error = collect_raw(&raw_plan, &candidate, None)
            .err()
            .expect("invalid raw external test must fail")
            .to_string();
        assert!(error.contains(expected_error), "{label}: {error}");
        assert!(candidate.materializations.borrow().is_empty(), "{label}");
        assert!(candidate.views.borrow().is_empty(), "{label}");
    }
    let raw_override_provider =
        make_raw_candidate(cohort.clone(), provider.train_relations.clone());
    let error = collect_raw(&raw_plan, &raw_override_provider, Some(&override_fold_set))
        .err()
        .expect("raw external test overlapping the effective FoldSet must fail")
        .to_string();
    assert!(
        error.contains("overlaps CV fold sample or origin"),
        "{error}"
    );
    assert!(raw_override_provider.materializations.borrow().is_empty());
    assert!(raw_override_provider.views.borrow().is_empty());

    let raw_missing_ids = make_raw_candidate(cohort.clone(), provider.train_relations.clone());
    let error = collect_raw(&raw_no_fold_plan, &raw_missing_ids, None)
        .err()
        .expect("raw REFIT external test needs explicit training IDs")
        .to_string();
    assert!(error.contains("without attested training IDs"), "{error}");
    assert!(raw_missing_ids.materializations.borrow().is_empty());
    assert!(raw_missing_ids.views.borrow().is_empty());

    let mut raw_overlap_ids = make_raw_candidate(cohort.clone(), provider.train_relations.clone());
    raw_overlap_ids.refit_ids = Some(vec![test_id]);
    let error = collect_raw(&raw_no_fold_plan, &raw_overlap_ids, None)
        .err()
        .expect("raw REFIT training IDs must exclude external test identities")
        .to_string();
    assert!(error.contains("overlaps REFIT training IDs"), "{error}");
    assert!(raw_overlap_ids.materializations.borrow().is_empty());
    assert!(raw_overlap_ids.views.borrow().is_empty());
}

// R-P1-7: a node only sees upstream handles for ports it DECLARES an edge to.
// An extra handle a producer emitted on an undeclared port (which a sibling
// consumer might use) must not leak into this node's input contract; the
// declared port still arrives.
#[test]
fn collect_input_handles_forwards_only_declared_source_ports() {
    let producer = NodeId::new("transform:snv").unwrap();
    let consumer = NodeId::new("model:pls").unwrap();
    let plan = build_execution_plan(
        "plan:declared.ports",
        simple_graph(),
        CampaignSpec {
            inner_cv: None,
            id: "campaign:declared.ports".to_string(),
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
        &manifests(),
    )
    .unwrap();
    let node_plan = plan.node_plans.get(&consumer).unwrap().clone();
    let owner = node_plan.controller_id.clone();
    // The producer emitted TWO output handles: the declared `x` (edge to
    // `model:pls.x`) and an undeclared `extra` port no edge references.
    let output_handles = BTreeMap::from([(
        producer.clone(),
        BTreeMap::from([
            (
                "x".to_string(),
                HandleRef {
                    handle: 1,
                    kind: HandleKind::Data,
                    owner_controller: owner.clone(),
                },
            ),
            (
                "extra".to_string(),
                HandleRef {
                    handle: 2,
                    kind: HandleKind::Data,
                    owner_controller: owner.clone(),
                },
            ),
        ]),
    )]);
    let ctx = RunContext::new(RunId::new("run:declared.ports").unwrap(), Some(11));
    let scope = PhaseScope {
        phase: Phase::FitCv,
        variant_id: Some(VariantId::new("variant:base").unwrap()),
        variant: None,
        fold_id: Some(FoldId::new("fold:0").unwrap()),
        seed_root: Some(11),
    };
    let resources = PhaseScopeResources {
        data_provider: None,
        fold_set_override: None,
        node_filter: None,
        cached_data_node_ids: None,
        suppress_inner_cv: false,
        nested_stacking: None,
        replay_artifact_handles: None,
        replay_artifact_inputs: None,
        replay_bundle_id: None,
        data_envelopes: None,
        prediction_cache_store: None,
        prediction_cache_contracts: None,
        direct_sample_prediction_only: false,
        artifact_store: None,
    };
    let collected = collect_input_handles(
        &plan,
        &node_plan,
        &output_handles,
        &BTreeMap::new(),
        &resources,
        &ctx,
        &scope,
    )
    .unwrap();

    // The declared source port arrives; the undeclared one is filtered out.
    assert!(
        collected.handles.contains_key("transform:snv.x"),
        "declared source port handle missing: {:?}",
        collected.handles.keys().collect::<Vec<_>>()
    );
    assert!(
        !collected.handles.contains_key("transform:snv.extra"),
        "undeclared source port handle leaked: {:?}",
        collected.handles.keys().collect::<Vec<_>>()
    );
}

#[test]
fn collect_input_handles_masks_only_the_exact_oof_source_port_in_training() {
    let plan = build_execution_plan(
        "plan:oof.exact.port.training",
        oof_edge_graph_with_auxiliary_port(),
        oof_edge_campaign(),
        &oof_edge_manifests(BTreeSet::from([Phase::FitCv, Phase::Refit, Phase::Predict])),
    )
    .unwrap();
    let base = NodeId::new("model:base").unwrap();
    let meta = NodeId::new("model:meta").unwrap();
    let node_plan = plan.node_plans.get(&meta).unwrap();
    let owner = ControllerId::new("controller:model").unwrap();
    let raw_prediction = HandleRef {
        handle: 10,
        kind: HandleKind::Prediction,
        owner_controller: owner.clone(),
    };
    let auxiliary = HandleRef {
        handle: 20,
        kind: HandleKind::Artifact,
        owner_controller: owner,
    };
    let output_handles = BTreeMap::from([(
        base.clone(),
        BTreeMap::from([
            ("pred".to_string(), raw_prediction.clone()),
            ("aux".to_string(), auxiliary.clone()),
        ]),
    )]);
    let mut ctx = RunContext::new(RunId::new("run:oof.exact.port.training").unwrap(), Some(11));
    for (fold_id, sample_id, value) in [("fold:0", "s1", 0.25), ("fold:1", "s2", 0.75)] {
        ctx.prediction_store
            .append(PredictionBlock {
                prediction_id: Some(format!("pred:model:base:{fold_id}")),
                producer_node: base.clone(),
                producer_port: None,
                partition: PredictionPartition::Validation,
                fold_id: Some(FoldId::new(fold_id).unwrap()),
                sample_ids: vec![SampleId::new(sample_id).unwrap()],
                values: vec![vec![value]],
                target_names: vec!["y".to_string()],
            })
            .unwrap();
    }

    for (phase, fold_id, expected_samples) in [
        (
            Phase::FitCv,
            Some(FoldId::new("fold:0").unwrap()),
            vec![SampleId::new("s1").unwrap()],
        ),
        (
            Phase::Refit,
            None,
            vec![SampleId::new("s1").unwrap(), SampleId::new("s2").unwrap()],
        ),
    ] {
        let collected = collect_input_handles(
            &plan,
            node_plan,
            &output_handles,
            &BTreeMap::new(),
            &PhaseScopeResources::default(),
            &ctx,
            &PhaseScope {
                phase,
                variant_id: Some(VariantId::new("variant:base").unwrap()),
                variant: None,
                fold_id,
                seed_root: Some(11),
            },
        )
        .unwrap();

        assert_eq!(
            collected.handles.keys().cloned().collect::<BTreeSet<_>>(),
            BTreeSet::from(["model:base.aux".to_string(), "model:base.pred".to_string()]),
            "unexpected inputs in {phase:?}"
        );
        assert_eq!(collected.handles["model:base.aux"], auxiliary);
        assert_ne!(
            collected.handles["model:base.pred"], raw_prediction,
            "the raw OOF source handle leaked in {phase:?}"
        );
        assert_eq!(
            collected.prediction_inputs["model:base.pred"].sample_ids,
            expected_samples
        );
    }
}

#[test]
fn collect_input_handles_predict_uses_only_the_suffixed_off_fold_port() {
    let plan = build_execution_plan(
        "plan:oof.exact.port.predict",
        oof_edge_graph_with_auxiliary_port(),
        oof_edge_campaign(),
        &oof_edge_manifests(BTreeSet::from([Phase::FitCv, Phase::Refit, Phase::Predict])),
    )
    .unwrap();
    let base = NodeId::new("model:base").unwrap();
    let meta = NodeId::new("model:meta").unwrap();
    let node_plan = plan.node_plans.get(&meta).unwrap();
    let owner = ControllerId::new("controller:model").unwrap();
    let raw_prediction = HandleRef {
        handle: 30,
        kind: HandleKind::Prediction,
        owner_controller: owner.clone(),
    };
    let auxiliary = HandleRef {
        handle: 40,
        kind: HandleKind::Artifact,
        owner_controller: owner,
    };
    let output_handles = BTreeMap::from([(
        base.clone(),
        BTreeMap::from([
            ("pred".to_string(), raw_prediction),
            ("aux".to_string(), auxiliary.clone()),
        ]),
    )]);
    let mut ctx = RunContext::new(RunId::new("run:oof.exact.port.predict").unwrap(), Some(11));
    let sample_ids = vec![SampleId::new("s1").unwrap(), SampleId::new("s2").unwrap()];
    let values = vec![vec![0.4], vec![0.6]];
    ctx.prediction_store
        .append(PredictionBlock {
            prediction_id: Some("pred:model:base:final".to_string()),
            producer_node: base,
            producer_port: None,
            partition: PredictionPartition::Final,
            fold_id: None,
            sample_ids: sample_ids.clone(),
            values: values.clone(),
            target_names: vec!["y".to_string()],
        })
        .unwrap();

    let collected = collect_input_handles(
        &plan,
        node_plan,
        &output_handles,
        &BTreeMap::new(),
        &PhaseScopeResources::default(),
        &ctx,
        &PhaseScope {
            phase: Phase::Predict,
            variant_id: Some(VariantId::new("variant:base").unwrap()),
            variant: None,
            fold_id: None,
            seed_root: Some(11),
        },
    )
    .unwrap();

    assert_eq!(
        collected.handles.keys().cloned().collect::<BTreeSet<_>>(),
        BTreeSet::from([
            "model:base.aux".to_string(),
            "model:base.pred:predict".to_string()
        ])
    );
    assert_eq!(collected.handles["model:base.aux"], auxiliary);
    assert!(!collected.handles.contains_key("model:base.pred"));
    assert_eq!(
        collected
            .prediction_inputs
            .keys()
            .cloned()
            .collect::<BTreeSet<_>>(),
        BTreeSet::from(["model:base.pred:predict".to_string()])
    );
    let spec = &collected.prediction_inputs["model:base.pred:predict"];
    assert_eq!(spec.producer_node, NodeId::new("model:base").unwrap());
    assert_eq!(spec.source_port, "pred");
    assert_eq!(spec.target_port, "pred");
    assert_eq!(spec.partition, PredictionPartition::Final);
    assert_eq!(spec.fold_id, None);
    assert!(spec.fold_ids.is_empty());
    assert_eq!(spec.sample_ids, sample_ids);
    assert_eq!(spec.values, values);
    assert_eq!(spec.prediction_width, 1);
    assert_eq!(spec.target_names, vec!["y".to_string()]);
}

fn ambiguous_prediction_source_port_error(
    phase: Phase,
    partition: PredictionPartition,
    fold_id: Option<FoldId>,
    sample_ids: Vec<SampleId>,
    producer_port: Option<&str>,
) -> DagMlError {
    let plan = build_execution_plan(
        format!(
            "plan:oof.ambiguous.port.{}",
            phase.as_str().to_ascii_lowercase()
        ),
        oof_edge_graph_with_ambiguous_prediction_port(),
        oof_edge_campaign(),
        &oof_edge_manifests(BTreeSet::from([Phase::FitCv, Phase::Refit, Phase::Predict])),
    )
    .unwrap();
    let base = NodeId::new("model:base").unwrap();
    let meta = NodeId::new("model:meta").unwrap();
    let owner = ControllerId::new("controller:model").unwrap();
    let output_handles = BTreeMap::from([(
        base.clone(),
        BTreeMap::from([
            (
                "pred".to_string(),
                HandleRef {
                    handle: 50,
                    kind: HandleKind::Prediction,
                    owner_controller: owner.clone(),
                },
            ),
            (
                "aux".to_string(),
                HandleRef {
                    handle: 60,
                    kind: HandleKind::Prediction,
                    owner_controller: owner,
                },
            ),
        ]),
    )]);
    let mut ctx = RunContext::new(
        RunId::new(format!(
            "run:oof.ambiguous.port.{}",
            phase.as_str().to_ascii_lowercase()
        ))
        .unwrap(),
        Some(11),
    );
    // This is the only stored block. When it is tagged as sibling `aux`, the
    // port-aware lookup must not relabel it as edge source `pred`. When the
    // port is absent, the multi-output producer must still fail closed.
    ctx.prediction_store
        .append(PredictionBlock {
            prediction_id: Some("pred:model:base:aux-only".to_string()),
            producer_node: base,
            producer_port: producer_port.map(str::to_string),
            partition,
            fold_id: fold_id.clone(),
            values: vec![vec![0.5]; sample_ids.len()],
            sample_ids,
            target_names: vec!["y".to_string()],
        })
        .unwrap();

    collect_input_handles(
        &plan,
        plan.node_plans.get(&meta).unwrap(),
        &output_handles,
        &BTreeMap::new(),
        &PhaseScopeResources::default(),
        &ctx,
        &PhaseScope {
            phase,
            variant_id: Some(VariantId::new("variant:base").unwrap()),
            variant: None,
            fold_id,
            seed_root: Some(11),
        },
    )
    .err()
    .expect("ambiguous prediction-port provenance must fail closed")
}

#[test]
fn fit_cv_refuses_ambiguous_multi_prediction_source_port() {
    let error = ambiguous_prediction_source_port_error(
        Phase::FitCv,
        PredictionPartition::Validation,
        Some(FoldId::new("fold:0").unwrap()),
        vec![SampleId::new("s1").unwrap()],
        None,
    );

    assert!(matches!(&error, DagMlError::OofValidation(_)));
    let message = error.to_string();
    assert!(message.contains("without producer_port"));
    assert!(message.contains("2 Prediction output ports"));
    assert!(message.contains("[\"aux\", \"pred\"]"));
}

#[test]
fn predict_refuses_sibling_prediction_source_port() {
    let error = ambiguous_prediction_source_port_error(
        Phase::Predict,
        PredictionPartition::Final,
        None,
        vec![SampleId::new("s1").unwrap(), SampleId::new("s2").unwrap()],
        Some("aux"),
    );

    assert!(matches!(&error, DagMlError::OofValidation(_)));
    let message = error.to_string();
    assert!(message.contains("none for source port `pred`"));
}

#[test]
fn predict_routes_both_explicit_prediction_ports_from_one_producer() {
    let plan = build_execution_plan(
        "plan:oof.dual.port.predict",
        oof_edge_graph_with_ambiguous_prediction_port(),
        oof_edge_campaign(),
        &oof_edge_manifests(BTreeSet::from([Phase::FitCv, Phase::Refit, Phase::Predict])),
    )
    .unwrap();
    let base = NodeId::new("model:base").unwrap();
    let meta = NodeId::new("model:meta").unwrap();
    let owner = ControllerId::new("controller:model").unwrap();
    let handles = BTreeMap::from([(
        base.clone(),
        BTreeMap::from([
            (
                "pred".to_string(),
                HandleRef {
                    handle: 50,
                    kind: HandleKind::Prediction,
                    owner_controller: owner.clone(),
                },
            ),
            (
                "aux".to_string(),
                HandleRef {
                    handle: 60,
                    kind: HandleKind::Prediction,
                    owner_controller: owner,
                },
            ),
        ]),
    )]);
    let mut ctx = RunContext::new(RunId::new("run:oof.dual.port.predict").unwrap(), Some(11));
    let ids = vec![SampleId::new("s1").unwrap(), SampleId::new("s2").unwrap()];
    for (port_name, values) in [
        ("pred", vec![vec![0.0], vec![1.0]]),
        ("aux", vec![vec![0.8, 0.2], vec![0.1, 0.9]]),
    ] {
        ctx.prediction_store
            .append(PredictionBlock {
                prediction_id: Some(format!("pred:model:base:{port_name}:final")),
                producer_node: base.clone(),
                producer_port: Some(port_name.to_string()),
                partition: PredictionPartition::Final,
                fold_id: None,
                sample_ids: ids.clone(),
                target_names: if port_name == "aux" {
                    vec!["0".to_string(), "1".to_string()]
                } else {
                    vec!["y".to_string()]
                },
                values,
            })
            .unwrap();
    }
    let collected = collect_input_handles(
        &plan,
        plan.node_plans.get(&meta).unwrap(),
        &handles,
        &BTreeMap::new(),
        &PhaseScopeResources::default(),
        &ctx,
        &PhaseScope {
            phase: Phase::Predict,
            variant_id: Some(VariantId::new("variant:base").unwrap()),
            variant: None,
            fold_id: None,
            seed_root: Some(11),
        },
    )
    .unwrap();
    assert_eq!(
        collected.prediction_inputs["model:base.pred:predict"].prediction_width,
        1
    );
    assert_eq!(
        collected.prediction_inputs["model:base.aux:predict"].prediction_width,
        2
    );
    assert_eq!(
        collected.prediction_inputs["model:base.aux:predict"].values[0],
        vec![0.8, 0.2]
    );
}

#[test]
fn in_memory_artifact_store_resolves_bundle_artifacts() {
    let plan = fixture_plan("plan:replay.artifacts");
    let bundle = replay_bundle(&plan);
    let artifact = &bundle.refit_artifacts[0];
    let mut store = InMemoryArtifactStore::new();
    let handle = HandleRef {
        handle: 77,
        kind: HandleKind::Model,
        owner_controller: artifact.controller_id.clone(),
    };
    store.register(artifact, handle.clone()).unwrap();

    let request = ArtifactMaterializationRequest {
        run_id: RunId::new("run:replay.artifacts").unwrap(),
        bundle_id: bundle.bundle_id.clone(),
        node_id: artifact.node_id.clone(),
        phase: Phase::Predict,
        variant_id: bundle.selected_variant_id.clone(),
        controller_id: artifact.controller_id.clone(),
        artifact: artifact.artifact.clone(),
        params_fingerprint: artifact.params_fingerprint.clone(),
        training_loss_fingerprint: artifact.training_loss_fingerprint.clone(),
    };
    let resolved = store.materialize(&request).unwrap();

    assert_eq!(resolved, handle);
    assert_eq!(store.len(), 1);

    let mut wrong_loss = request.clone();
    wrong_loss.training_loss_fingerprint = Some("f".repeat(64));
    assert!(store
        .materialize(&wrong_loss)
        .unwrap_err()
        .to_string()
        .contains("training loss fingerprint"));

    assert!(InMemoryArtifactStore::new().materialize(&request).is_err());
}

#[test]
fn bundle_replay_invokes_predict_with_data_and_refit_artifact_handles() {
    let plan = fixture_plan("plan:replay.predict");
    let bundle = replay_bundle(&plan);
    let request = replay_request(&bundle, Phase::Predict);
    let envelopes = replay_envelopes();
    let provider = replay_data_provider();
    let store = replay_artifact_store(&bundle);
    let controllers = replay_runtime_controllers();
    let mut ctx = RunContext::new(RunId::new("run:replay.predict").unwrap(), Some(11));

    let results = SequentialScheduler
        .execute_bundle_replay(
            BundleReplayExecution {
                plan: &plan,
                bundle: &bundle,
                replay_request: &request,
                prediction_cache_store: None,
                controllers: &controllers,
                data_provider: &provider,
                artifact_store: &store,
                data_envelopes: &envelopes,
            },
            &mut ctx,
        )
        .unwrap();

    assert_eq!(results.len(), 2);
    assert_eq!(provider.handle_records().len(), 1);
    assert_eq!(provider.view_records().len(), 1);
    assert_eq!(
        provider.view_records()[0].view.partition,
        DataRequestPartition::Predict
    );
    assert_eq!(ctx.prediction_store.blocks().len(), 1);
    assert_eq!(
        ctx.prediction_store.blocks()[0].partition,
        PredictionPartition::Final
    );
    assert!(ctx
        .lineage
        .records()
        .any(|record| record.node_id.as_str() == "model:base"
            && record.phase == Phase::Predict
            && record.variant_id == bundle.selected_variant_id));

    let provider = replay_data_provider();
    let mut ctx = RunContext::new(RunId::new("run:parallel.replay.predict").unwrap(), Some(11));
    let results = ParallelScheduler::new(2)
        .unwrap()
        .execute_bundle_replay(
            BundleReplayExecution {
                plan: &plan,
                bundle: &bundle,
                replay_request: &request,
                prediction_cache_store: None,
                controllers: &controllers,
                data_provider: &provider,
                artifact_store: &store,
                data_envelopes: &envelopes,
            },
            &mut ctx,
        )
        .unwrap();

    assert_eq!(results.len(), 2);
    assert_eq!(provider.handle_records().len(), 1);
    assert_eq!(provider.view_records().len(), 1);
    assert_eq!(
        provider.view_records()[0].view.partition,
        DataRequestPartition::Predict
    );
    assert_eq!(ctx.prediction_store.blocks().len(), 1);
}

#[test]
fn bundle_replay_rejects_missing_artifact_unsupported_phase_and_bad_envelope() {
    let plan = fixture_plan("plan:replay.reject");
    let bundle = replay_bundle(&plan);
    let request = replay_request(&bundle, Phase::Predict);
    let envelopes = replay_envelopes();
    let provider = replay_data_provider();
    let controllers = replay_runtime_controllers();
    let mut ctx = RunContext::new(RunId::new("run:replay.reject").unwrap(), Some(11));

    assert!(SequentialScheduler
        .execute_bundle_replay(
            BundleReplayExecution {
                plan: &plan,
                bundle: &bundle,
                replay_request: &request,
                prediction_cache_store: None,
                controllers: &controllers,
                data_provider: &provider,
                artifact_store: &InMemoryArtifactStore::new(),
                data_envelopes: &envelopes,
            },
            &mut ctx,
        )
        .is_err());

    let store = replay_artifact_store(&bundle);
    assert!(SequentialScheduler
        .execute_bundle_replay(
            BundleReplayExecution {
                plan: &plan,
                bundle: &bundle,
                replay_request: &replay_request(&bundle, Phase::FitCv),
                prediction_cache_store: None,
                controllers: &controllers,
                data_provider: &provider,
                artifact_store: &store,
                data_envelopes: &envelopes,
            },
            &mut ctx,
        )
        .is_err());

    let mut bad_envelopes = replay_envelopes();
    bad_envelopes
        .get_mut("model:base.x")
        .unwrap()
        .schema_fingerprint = "0".repeat(64);
    assert!(SequentialScheduler
        .execute_bundle_replay(
            BundleReplayExecution {
                plan: &plan,
                bundle: &bundle,
                replay_request: &request,
                prediction_cache_store: None,
                controllers: &controllers,
                data_provider: &provider,
                artifact_store: &store,
                data_envelopes: &bad_envelopes,
            },
            &mut ctx,
        )
        .is_err());
}

#[test]
fn fit_cv_node_with_inner_cv_carries_inner_fold_set_subset_of_outer_train() {
    use crate::fold::{KFoldSpec, NestedCvSpec};
    use crate::ids::SampleId;

    // Reuse a real plan's campaign + a node plan, but drive nesting with a fresh
    // outer fold set that has enough train samples for an inner KFold.
    let plan = live_group_oof_runtime_plan();
    let mut campaign = plan.campaign.clone();
    let node_plan = plan
        .node_plans
        .values()
        .next()
        .expect("plan has at least one node")
        .clone();
    assert!(
        node_plan.inner_cv.is_none(),
        "node falls back to campaign default"
    );

    let samples = ["s1", "s2", "s3", "s4"]
        .into_iter()
        .map(|s| SampleId::new(s).unwrap())
        .collect::<Vec<_>>();
    let outer = KFoldSpec {
        n_splits: 2,
        shuffle: false,
        seed: Some(0),
    }
    .split("outer", &samples)
    .unwrap();
    let outer_fold = outer.folds[0].clone();
    let fit_scope = PhaseScope {
        phase: Phase::FitCv,
        variant_id: None,
        variant: None,
        fold_id: Some(outer_fold.fold_id.clone()),
        seed_root: None,
    };

    // With a campaign-level inner CV and no node override, the node gets an inner
    // fold set built from this outer fold's TRAIN samples (⊆ outer-train).
    campaign.inner_cv = Some(NestedCvSpec::KFold(KFoldSpec {
        n_splits: 2,
        shuffle: false,
        seed: Some(1),
    }));
    let inner = inner_fold_set_for_scope(&campaign, Some(&outer), &node_plan, &fit_scope)
        .expect("inner fold set builds")
        .expect("inner fold set present for FIT_CV node with inner_cv");
    let outer_train = outer_fold
        .train_sample_ids
        .iter()
        .collect::<std::collections::BTreeSet<_>>();
    for sample_id in &inner.sample_ids {
        assert!(
            outer_train.contains(sample_id),
            "inner sample escapes outer-train"
        );
    }
    assert_eq!(
        inner
            .sample_ids
            .iter()
            .collect::<std::collections::BTreeSet<_>>(),
        outer_train
    );

    // No effective inner CV → no inner fold set.
    campaign.inner_cv = None;
    assert!(
        inner_fold_set_for_scope(&campaign, Some(&outer), &node_plan, &fit_scope)
            .unwrap()
            .is_none()
    );

    // Non-FIT_CV phases never carry an inner fold set, even with inner_cv declared.
    campaign.inner_cv = Some(NestedCvSpec::KFold(KFoldSpec {
        n_splits: 2,
        shuffle: false,
        seed: Some(1),
    }));
    let predict_scope = PhaseScope {
        phase: Phase::Predict,
        variant_id: None,
        variant: None,
        fold_id: None,
        seed_root: None,
    };
    assert!(
        inner_fold_set_for_scope(&campaign, Some(&outer), &node_plan, &predict_scope)
            .unwrap()
            .is_none()
    );
}

fn nested_stacking_test_plan(outer: FoldSet, partitioned_refit_oof: bool) -> ExecutionPlan {
    use crate::fold::{KFoldSpec, NestedCvSpec};
    let mut campaign = oof_edge_campaign();
    campaign.inner_cv = Some(NestedCvSpec::KFold(KFoldSpec {
        n_splits: 2,
        shuffle: false,
        seed: Some(13),
    }));
    campaign.split_invocation.as_mut().unwrap().fold_set = Some(outer.clone());

    let meta_id = NodeId::new("model:meta").unwrap();
    let base_a = NodeId::new("model:base.a").unwrap();
    let base_b = NodeId::new("model:base.b").unwrap();
    let mut meta = node(
        meta_id.as_str(),
        NodeKind::Model,
        vec![
            port("a", PortKind::Prediction),
            port("b", PortKind::Prediction),
        ],
        vec![port("pred", PortKind::Prediction)],
    );
    meta.metadata.insert(
        NESTED_STACKING_EXECUTION_METADATA_KEY.to_string(),
        json!(NESTED_STACKING_EXECUTION_V1),
    );
    if partitioned_refit_oof {
        meta.metadata.insert(
            STACKING_REFIT_OOF_METADATA_KEY.to_string(),
            json!(STACKING_REFIT_PARTITIONED_INNER_V1),
        );
    }
    let graph = GraphSpec {
        id: "graph:nested.stacking.plan".to_string(),
        interface: GraphInterface::default(),
        nodes: vec![
            node(
                base_a.as_str(),
                NodeKind::Model,
                Vec::new(),
                vec![port("pred", PortKind::Prediction)],
            ),
            node(
                base_b.as_str(),
                NodeKind::Model,
                Vec::new(),
                vec![port("pred", PortKind::Prediction)],
            ),
            meta,
        ],
        edges: vec![
            EdgeSpec {
                source: PortRef {
                    node_id: base_a.clone(),
                    port_name: "pred".to_string(),
                },
                target: PortRef {
                    node_id: meta_id.clone(),
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
                    node_id: base_b.clone(),
                    port_name: "pred".to_string(),
                },
                target: PortRef {
                    node_id: meta_id.clone(),
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
    build_execution_plan("plan:nested.stacking", graph, campaign, &manifests()).unwrap()
}

#[test]
fn independent_terminal_meta_nodes_keep_distinct_report_grade_oof() {
    use crate::fold::KFoldSpec;

    struct IndependentModel {
        inner: VariantScoringController,
        folds: BTreeMap<FoldId, FoldAssignment>,
    }
    impl RuntimeController for IndependentModel {
        fn controller_id(&self) -> &ControllerId {
            self.inner.controller_id()
        }

        fn invoke(&self, task: &NodeTask) -> Result<NodeResult> {
            if task.phase == Phase::Refit {
                if task.node_plan.node_id.as_str().starts_with("model:meta") {
                    assert_eq!(task.prediction_inputs.len(), 1);
                    assert_eq!(
                        task.prediction_inputs
                            .values()
                            .next()
                            .unwrap()
                            .sample_ids
                            .len(),
                        12
                    );
                }
                return self.inner.invoke(task);
            }
            let fold = &self.folds[task.fold_id.as_ref().expect("FIT_CV fold")];
            if task.node_plan.node_id.as_str().starts_with("model:meta") {
                assert_eq!(task.prediction_inputs.len(), 2);
                for (key, input) in &task.prediction_inputs {
                    let expected = if key.ends_with(":outer") {
                        &fold.validation_sample_ids
                    } else {
                        &fold.train_sample_ids
                    };
                    assert_eq!(
                        input.sample_ids.iter().collect::<BTreeSet<_>>(),
                        expected.iter().collect::<BTreeSet<_>>()
                    );
                }
            }
            let mut result = self.inner.invoke(task)?;
            result.predictions = vec![PredictionBlock {
                prediction_id: Some(format!("pred:{}:{}", task.node_plan.node_id, fold.fold_id)),
                producer_node: task.node_plan.node_id.clone(),
                producer_port: Some("pred".into()),
                partition: PredictionPartition::Validation,
                fold_id: Some(fold.fold_id.clone()),
                sample_ids: fold.validation_sample_ids.clone(),
                values: vec![vec![1.0]; fold.validation_sample_ids.len()],
                target_names: vec!["y".into()],
            }];
            result.regression_targets = vec![RegressionTargetBlock {
                level: PredictionLevel::Sample,
                unit_ids: fold
                    .validation_sample_ids
                    .iter()
                    .cloned()
                    .map(crate::aggregation::PredictionUnitId::Sample)
                    .collect(),
                values: vec![vec![0.0]; fold.validation_sample_ids.len()],
                validity_masks: None,
                target_names: vec!["y".into()],
            }];
            Ok(result)
        }
    }

    let samples = (1..=12)
        .map(|index| SampleId::new(format!("s{index}")).unwrap())
        .collect::<Vec<_>>();
    let outer = KFoldSpec {
        n_splits: 3,
        shuffle: false,
        seed: Some(7),
    }
    .split("outer", &samples)
    .unwrap();
    let original = nested_stacking_test_plan(outer.clone(), true);
    let mut graph = original.graph_plan.graph;
    let first = NodeId::new("model:meta").unwrap();
    let second = NodeId::new("model:meta.b").unwrap();
    graph
        .nodes
        .iter_mut()
        .find(|node| node.id == first)
        .unwrap()
        .ports
        .inputs
        .retain(|port| port.name == "a");
    graph
        .edges
        .iter_mut()
        .find(|edge| edge.source.node_id.as_str() == "model:base.b")
        .unwrap()
        .target = PortRef {
        node_id: second.clone(),
        port_name: "b".into(),
    };
    let mut second_node = node(
        second.as_str(),
        NodeKind::Model,
        vec![port("b", PortKind::Prediction)],
        vec![port("pred", PortKind::Prediction)],
    );
    second_node.metadata.insert(
        NESTED_STACKING_EXECUTION_METADATA_KEY.into(),
        json!(NESTED_STACKING_EXECUTION_V1),
    );
    second_node.metadata.insert(
        STACKING_REFIT_OOF_METADATA_KEY.into(),
        json!(STACKING_REFIT_PARTITIONED_INNER_V1),
    );
    graph.nodes.push(second_node);
    let registry = oof_edge_manifests(BTreeSet::from([Phase::FitCv, Phase::Refit]));
    let plan =
        build_execution_plan("plan:independent.meta", graph, original.campaign, &registry).unwrap();
    let campaigns = nested_stacking_campaign_plans(&plan).unwrap();
    assert_eq!(
        campaigns
            .iter()
            .map(|campaign| &campaign.meta_node_id)
            .collect::<Vec<_>>(),
        vec![&first, &second]
    );
    assert!(campaigns[0]
        .base_node_ids
        .is_disjoint(&campaigns[1].base_node_ids));

    let folds = outer
        .folds
        .iter()
        .chain(campaigns.iter().flat_map(|campaign| {
            campaign
                .outer_scopes
                .iter()
                .flat_map(|scope| &scope.inner.inner_fold_set.folds)
        }))
        .chain(
            campaigns
                .iter()
                .flat_map(|campaign| campaign.refit_fold_set.as_ref().unwrap().folds.iter()),
        )
        .map(|fold| (fold.fold_id.clone(), fold.clone()))
        .collect();
    let mut controllers = RuntimeControllerRegistry::new();
    controllers
        .register(Box::new(IndependentModel {
            inner: VariantScoringController {
                id: ControllerId::new("controller:model").unwrap(),
                handle: 1,
                emit_targets: true,
            },
            folds,
        }))
        .unwrap();
    let provider = InMemoryDataProvider::new(ControllerId::new("controller:data").unwrap());
    let mut ctx = RunContext::new(RunId::new("run:independent.meta").unwrap(), Some(7));
    SequentialScheduler
        .execute_campaign_phase_with_data_provider(
            &plan,
            &controllers,
            &provider,
            &mut ctx,
            Phase::FitCv,
        )
        .unwrap();
    for producer in [&first, &second] {
        for fold in &outer.folds {
            assert_eq!(
                ctx.prediction_store
                    .find(
                        Some(producer),
                        Some(&PredictionPartition::Validation),
                        Some(&fold.fold_id)
                    )
                    .len(),
                1
            );
        }
    }
    let score_set = ctx.build_score_set(plan.id.clone(), None).unwrap();
    for producer in [&first, &second] {
        assert!(score_set
            .reports
            .iter()
            .any(|report| report.producer_node == *producer && report.fold_id.is_some()));
    }
    let refit = SequentialScheduler
        .execute_campaign_phase_with_data_provider(
            &plan,
            &controllers,
            &provider,
            &mut ctx,
            Phase::Refit,
        )
        .unwrap();
    for producer in [&first, &second] {
        assert!(refit
            .iter()
            .any(|result| result.node_id == *producer && result.lineage.phase == Phase::Refit));
    }
}

// Contract for a second OOF stage. The first meta-model must be fitted from
// inner OOF predictions before it can itself produce OOF predictions for a
// downstream residual learner. A single global inner fold set cannot attest
// both. The independent Data edge here keeps the residual learner valid; the
// full prediction-feature merge topology is covered by the DSL test.
#[test]
fn nested_stacking_then_residual_accepts_dependent_meta_models() {
    use crate::fold::KFoldSpec;

    let samples = (1..=6)
        .map(|index| SampleId::new(format!("s{index}")).unwrap())
        .collect::<Vec<_>>();
    let outer = KFoldSpec {
        n_splits: 3,
        shuffle: false,
        seed: Some(7),
    }
    .split("outer", &samples)
    .unwrap();
    let plan = nested_stacking_test_plan(outer, false);
    let upstream_id = NodeId::new("model:meta").unwrap();
    let downstream_id = NodeId::new("model:meta.downstream").unwrap();
    let feature_id = NodeId::new("transform:features").unwrap();
    let mut downstream = node(
        downstream_id.as_str(),
        NodeKind::Model,
        vec![
            port("upstream", PortKind::Prediction),
            port("x_original", PortKind::Data),
        ],
        vec![port("pred", PortKind::Prediction)],
    );
    downstream.metadata.insert(
        RESIDUAL_TARGET_EXECUTION_METADATA_KEY.to_string(),
        json!(RESIDUAL_TARGET_EXECUTION_V1),
    );
    downstream.metadata.insert(
        STACKING_REFIT_OOF_METADATA_KEY.to_string(),
        json!(STACKING_REFIT_PARTITIONED_INNER_V1),
    );
    let mut graph = plan.graph_plan.graph.clone();
    graph.nodes.push(node(
        feature_id.as_str(),
        NodeKind::Transform,
        Vec::new(),
        vec![port("x_out", PortKind::Data)],
    ));
    graph.nodes.push(downstream);
    graph.edges.push(EdgeSpec {
        source: PortRef {
            node_id: upstream_id,
            port_name: "pred".to_string(),
        },
        target: PortRef {
            node_id: downstream_id.clone(),
            port_name: "upstream".to_string(),
        },
        contract: EdgeContract {
            requires_oof: true,
            requires_fold_alignment: true,
            ..EdgeContract::new(PortKind::Prediction, None)
        },
    });
    graph.edges.push(EdgeSpec {
        source: PortRef {
            node_id: feature_id,
            port_name: "x_out".to_string(),
        },
        target: PortRef {
            node_id: downstream_id,
            port_name: "x_original".to_string(),
        },
        contract: EdgeContract::new(PortKind::Data, None),
    });
    let plan = build_execution_plan("plan:dependent.meta", graph, plan.campaign, &manifests())
        .expect("valid two-stage prediction and residual topology");

    let terminal = nested_stacking_campaign_plan(&plan)
        .expect("dependent OOF stages need separate nested fold scopes")
        .expect("terminal meta node");
    assert_eq!(
        terminal.meta_node_id,
        NodeId::new("model:meta.downstream").unwrap()
    );
    let upstream =
        nested_stacking_campaign_plan_for_node(&plan, NodeId::new("model:meta").unwrap())
            .unwrap()
            .unwrap();
    assert!(!upstream.base_node_ids.contains(&terminal.meta_node_id));
}

#[test]
fn dependent_stacking_executes_parent_bound_oof_at_both_levels() {
    use crate::fold::{KFoldSpec, NestedCvSpec};

    struct LayeredModel {
        inner: VariantScoringController,
        folds: BTreeMap<FoldId, FoldAssignment>,
        require_original_data: bool,
    }
    impl RuntimeController for LayeredModel {
        fn controller_id(&self) -> &ControllerId {
            self.inner.controller_id()
        }

        fn invoke(&self, task: &NodeTask) -> Result<NodeResult> {
            if task.node_plan.node_id.as_str().starts_with("transform:") {
                let mut result = self.inner.invoke(task)?;
                result.outputs = BTreeMap::from([(
                    "x_out".into(),
                    HandleRef {
                        handle: 2,
                        kind: HandleKind::Data,
                        owner_controller: self.inner.id.clone(),
                    },
                )]);
                return Ok(result);
            }
            if self.require_original_data && task.node_plan.node_id.as_str() == "model:meta.second"
            {
                assert!(task.input_handles.contains_key("data:x_original"));
            }
            if task.phase == Phase::Refit {
                return self.inner.invoke(task);
            }
            let fold = &self.folds[task.fold_id.as_ref().expect("fold scope")];
            if task.node_plan.node_id.as_str().starts_with("model:meta") {
                for (key, input) in &task.prediction_inputs {
                    let expected = if key.ends_with(":outer") {
                        &fold.validation_sample_ids
                    } else {
                        &fold.train_sample_ids
                    };
                    assert_eq!(
                        input.sample_ids.iter().cloned().collect::<BTreeSet<_>>(),
                        expected.iter().cloned().collect::<BTreeSet<_>>()
                    );
                }
            }
            let mut result = self.inner.invoke(task)?;
            result.predictions = vec![PredictionBlock {
                prediction_id: Some(format!("pred:{}:{}", task.node_plan.node_id, fold.fold_id)),
                producer_node: task.node_plan.node_id.clone(),
                producer_port: Some("pred".into()),
                partition: PredictionPartition::Validation,
                fold_id: Some(fold.fold_id.clone()),
                sample_ids: fold.validation_sample_ids.clone(),
                values: vec![vec![1.0]; fold.validation_sample_ids.len()],
                target_names: vec!["y".into()],
            }];
            result.regression_targets = vec![RegressionTargetBlock {
                level: PredictionLevel::Sample,
                unit_ids: fold
                    .validation_sample_ids
                    .iter()
                    .cloned()
                    .map(crate::aggregation::PredictionUnitId::Sample)
                    .collect(),
                values: vec![vec![0.0]; fold.validation_sample_ids.len()],
                validity_masks: None,
                target_names: vec!["y".into()],
            }];
            Ok(result)
        }
    }

    let samples = (1..=24)
        .map(|i| SampleId::new(format!("s{i}")).unwrap())
        .collect::<Vec<_>>();
    let outer = KFoldSpec {
        n_splits: 3,
        shuffle: false,
        seed: Some(7),
    }
    .split("outer", &samples)
    .unwrap();
    let original = nested_stacking_test_plan(outer.clone(), true);
    let mut graph = original.graph_plan.graph;
    let first = NodeId::new("model:meta").unwrap();
    let second = NodeId::new("model:meta.second").unwrap();
    let mut node_second = node(
        second.as_str(),
        NodeKind::Model,
        vec![port("first", PortKind::Prediction)],
        vec![port("pred", PortKind::Prediction)],
    );
    node_second.metadata.insert(
        NESTED_STACKING_EXECUTION_METADATA_KEY.into(),
        json!(NESTED_STACKING_EXECUTION_V1),
    );
    node_second.metadata.insert(
        STACKING_REFIT_OOF_METADATA_KEY.into(),
        json!(STACKING_REFIT_PARTITIONED_INNER_V1),
    );
    graph.nodes.push(node_second);
    graph.edges.push(EdgeSpec {
        source: PortRef {
            node_id: first.clone(),
            port_name: "pred".into(),
        },
        target: PortRef {
            node_id: second.clone(),
            port_name: "first".into(),
        },
        contract: EdgeContract {
            requires_oof: true,
            requires_fold_alignment: true,
            ..EdgeContract::new(PortKind::Prediction, None)
        },
    });
    let registry = oof_edge_manifests(BTreeSet::from([Phase::FitCv, Phase::Refit]));
    let plan = build_execution_plan("plan:two.meta", graph, original.campaign, &registry).unwrap();
    let spec = NestedCvSpec::KFold(KFoldSpec {
        n_splits: 2,
        shuffle: false,
        seed: Some(13),
    });
    let mut folds = BTreeMap::new();
    for outer_fold in &outer.folds {
        folds.insert(outer_fold.fold_id.clone(), outer_fold.clone());
        let inner = spec
            .build_nested_fold_set(outer_fold, &outer.sample_groups)
            .unwrap();
        for inner_fold in &inner.inner_fold_set.folds {
            folds.insert(inner_fold.fold_id.clone(), inner_fold.clone());
            let deeper = spec
                .build_nested_fold_set(inner_fold, &inner.inner_fold_set.sample_groups)
                .unwrap();
            for deep_fold in deeper.inner_fold_set.folds {
                folds.insert(deep_fold.fold_id.clone(), deep_fold.clone());
            }
        }
    }
    let refit_folds = nested_stacking_campaign_plan(&plan)
        .unwrap()
        .unwrap()
        .refit_fold_set
        .unwrap();
    for refit_fold in &refit_folds.folds {
        folds.insert(refit_fold.fold_id.clone(), refit_fold.clone());
        let inner = spec
            .build_nested_fold_set(refit_fold, &refit_folds.sample_groups)
            .unwrap();
        for inner_fold in &inner.inner_fold_set.folds {
            folds.insert(inner_fold.fold_id.clone(), inner_fold.clone());
        }
    }
    let transform_folds = folds.clone();
    let mut controllers = RuntimeControllerRegistry::new();
    controllers
        .register(Box::new(LayeredModel {
            inner: VariantScoringController {
                id: ControllerId::new("controller:model").unwrap(),
                handle: 1,
                emit_targets: true,
            },
            folds,
            require_original_data: false,
        }))
        .unwrap();
    let provider = InMemoryDataProvider::new(ControllerId::new("controller:data").unwrap());
    let mut ctx = RunContext::new(RunId::new("run:two.meta").unwrap(), Some(7));
    SequentialScheduler
        .execute_campaign_phase_with_data_provider(
            &plan,
            &controllers,
            &provider,
            &mut ctx,
            Phase::FitCv,
        )
        .unwrap();
    for fold in &outer.folds {
        assert_eq!(
            ctx.prediction_store
                .find(
                    Some(&second),
                    Some(&PredictionPartition::Validation),
                    Some(&fold.fold_id)
                )
                .len(),
            1
        );
    }
    let refit = SequentialScheduler
        .execute_campaign_phase_with_data_provider(
            &plan,
            &controllers,
            &provider,
            &mut ctx,
            Phase::Refit,
        )
        .unwrap();
    assert!(refit.iter().any(|result| result.node_id == second));

    let mut residual_graph = plan.graph_plan.graph.clone();
    let residual = residual_graph
        .nodes
        .iter_mut()
        .find(|node| node.id == second)
        .unwrap();
    residual
        .metadata
        .remove(NESTED_STACKING_EXECUTION_METADATA_KEY);
    residual.metadata.insert(
        RESIDUAL_TARGET_EXECUTION_METADATA_KEY.into(),
        json!(RESIDUAL_TARGET_EXECUTION_V1),
    );
    residual
        .ports
        .inputs
        .push(port("x_original", PortKind::Data));
    let transform_id = NodeId::new("transform:original").unwrap();
    residual_graph.nodes.push(node(
        transform_id.as_str(),
        NodeKind::Transform,
        Vec::new(),
        vec![port("x_out", PortKind::Data)],
    ));
    residual_graph.edges.push(EdgeSpec {
        source: PortRef {
            node_id: transform_id,
            port_name: "x_out".into(),
        },
        target: PortRef {
            node_id: second.clone(),
            port_name: "x_original".into(),
        },
        contract: EdgeContract::new(PortKind::Data, None),
    });
    let fusion_id = NodeId::new("model:meta.second.residual_fusion").unwrap();
    let mut fusion = node(
        fusion_id.as_str(),
        NodeKind::PredictionJoin,
        vec![
            port("base", PortKind::Prediction),
            port("learner", PortKind::Prediction),
        ],
        vec![port("prediction", PortKind::Prediction)],
    );
    fusion.metadata.extend(BTreeMap::from([
        ("merge_mode".into(), json!("residual_fusion")),
        ("residual_fusion_for".into(), json!(second.as_str())),
        ("residual_base".into(), json!(first.as_str())),
        ("residual_learner".into(), json!(second.as_str())),
        ("residual_gate".into(), json!(false)),
    ]));
    residual_graph.nodes.push(fusion);
    for (source, port_name) in [(first.clone(), "base"), (second.clone(), "learner")] {
        residual_graph.edges.push(EdgeSpec {
            source: PortRef {
                node_id: source,
                port_name: "pred".into(),
            },
            target: PortRef {
                node_id: fusion_id.clone(),
                port_name: port_name.into(),
            },
            contract: EdgeContract {
                requires_oof: true,
                requires_fold_alignment: true,
                ..EdgeContract::new(PortKind::Prediction, None)
            },
        });
    }
    let mut residual_registry = registry;
    let mut transform_manifest = controller_manifest("controller:transform", NodeKind::Transform);
    transform_manifest.supported_phases.insert(Phase::Refit);
    residual_registry.register(transform_manifest).unwrap();
    let mut join_manifest =
        controller_manifest("controller:prediction.join", NodeKind::PredictionJoin);
    join_manifest
        .capabilities
        .insert(ControllerCapability::EmitsPredictions);
    join_manifest
        .capabilities
        .insert(ControllerCapability::ConsumesOofPredictions);
    join_manifest.supported_phases.insert(Phase::Refit);
    residual_registry.register(join_manifest).unwrap();
    let residual_plan = build_execution_plan(
        "plan:two.meta.residual",
        residual_graph,
        plan.campaign.clone(),
        &residual_registry,
    )
    .unwrap();
    let mut residual_controllers = RuntimeControllerRegistry::new();
    residual_controllers
        .register(Box::new(LayeredModel {
            inner: VariantScoringController {
                id: ControllerId::new("controller:model").unwrap(),
                handle: 1,
                emit_targets: true,
            },
            folds: transform_folds.clone(),
            require_original_data: true,
        }))
        .unwrap();
    residual_controllers
        .register(Box::new(LayeredModel {
            inner: VariantScoringController {
                id: ControllerId::new("controller:transform").unwrap(),
                handle: 2,
                emit_targets: false,
            },
            folds: transform_folds,
            require_original_data: false,
        }))
        .unwrap();
    let mut residual_ctx = RunContext::new(RunId::new("run:two.meta.residual").unwrap(), Some(7));
    SequentialScheduler
        .execute_campaign_phase_with_data_provider(
            &residual_plan,
            &residual_controllers,
            &provider,
            &mut residual_ctx,
            Phase::FitCv,
        )
        .unwrap();
    for fold in &outer.folds {
        assert_eq!(
            residual_ctx
                .prediction_store
                .find(
                    Some(&fusion_id),
                    Some(&PredictionPartition::Validation),
                    Some(&fold.fold_id)
                )
                .len(),
            1
        );
    }
    let residual_refit = SequentialScheduler
        .execute_campaign_phase_with_data_provider(
            &residual_plan,
            &residual_controllers,
            &provider,
            &mut residual_ctx,
            Phase::Refit,
        )
        .unwrap();
    assert!(residual_refit.iter().any(|result| result.node_id == second));
}

#[test]
fn prediction_feature_specs_join_in_graph_order_by_sample_identity() {
    let sample = |name: &str| SampleId::new(name).unwrap();
    let source = |name: &str, ids: Vec<SampleId>, values: Vec<Vec<f64>>| PredictionInputSpec {
        producer_node: NodeId::new(name).unwrap(),
        source_port: "pred".to_string(),
        target_port: "oof".to_string(),
        partition: PredictionPartition::Validation,
        prediction_level: PredictionLevel::Sample,
        fold_id: None,
        fold_ids: Vec::new(),
        unit_ids: Vec::new(),
        sample_ids: ids,
        values,
        feature_validity_masks: None,
        source_presence: None,
        prediction_width: 1,
        target_names: vec!["y".to_string()],
    };
    let a = source(
        "model:a",
        vec![sample("s2"), sample("s1")],
        vec![vec![2.0], vec![1.0]],
    );
    let b = source(
        "model:b",
        vec![sample("s1"), sample("s2")],
        vec![vec![10.0], vec![20.0]],
    );
    let join_id = NodeId::new("merge:features").unwrap();
    let matrix =
        join_prediction_feature_specs(&join_id, &[&b, &a], &[sample("s1"), sample("s2")]).unwrap();
    assert_eq!(matrix.columns, vec!["model:b.pred__y", "model:a.pred__y"]);
    assert_eq!(matrix.values, vec![vec![10.0, 1.0], vec![20.0, 2.0]]);

    let mut leaked = a.clone();
    leaked.partition = PredictionPartition::Train;
    assert!(
        join_prediction_feature_specs(&join_id, &[&leaked], &matrix.sample_ids)
            .unwrap_err()
            .to_string()
            .contains("validation OOF")
    );
    let mut incomplete = a;
    incomplete.sample_ids.pop();
    incomplete.values.pop();
    assert!(
        join_prediction_feature_specs(&join_id, &[&incomplete], &matrix.sample_ids)
            .unwrap_err()
            .to_string()
            .contains("exactly cover")
    );
    let mut duplicate = b;
    duplicate.sample_ids.push(sample("s2"));
    duplicate.values.push(vec![20.0]);
    assert!(
        join_prediction_feature_specs(&join_id, &[&duplicate], &matrix.sample_ids)
            .unwrap_err()
            .to_string()
            .contains("exactly cover")
    );
}

#[test]
fn prediction_feature_views_keep_train_and_outer_validation_separate() {
    let mut task = fit_influence_validation_task(FitInfluenceTask::default());
    let train = vec![SampleId::new("s1").unwrap(), SampleId::new("s2").unwrap()];
    let validation = vec![SampleId::new("s3").unwrap()];
    task.prediction_feature_matrix = Some(crate::oof::OofMatrix {
        sample_ids: train.clone(),
        columns: vec!["model:a.pred__y".to_string()],
        values: vec![vec![1.0], vec![2.0]],
    });
    task.prediction_feature_off_fold_matrix = Some(crate::oof::OofMatrix {
        sample_ids: validation.clone(),
        columns: vec!["model:a.pred__y".to_string()],
        values: vec![vec![3.0]],
    });
    let primary = prediction_feature_data_view(&task, false).unwrap().unwrap();
    let outer = prediction_feature_data_view(&task, true).unwrap().unwrap();
    assert_eq!(primary.sample_ids, Some(train));
    assert_eq!(primary.partition, DataRequestPartition::FoldTrain);
    assert_eq!(outer.sample_ids, Some(validation));
    assert_eq!(outer.partition, DataRequestPartition::FoldValidation);
    task.prediction_feature_off_fold_matrix
        .as_mut()
        .unwrap()
        .sample_ids = vec![SampleId::new("s2").unwrap()];
    assert!(prediction_feature_data_view(&task, true)
        .unwrap_err()
        .to_string()
        .contains("overlapping train/outer-validation"));
}

#[test]
fn nested_residual_prediction_feature_plan_separates_source_and_base_scopes() {
    use crate::fold::KFoldSpec;

    let samples = (1..=6)
        .map(|index| SampleId::new(format!("s{index}")).unwrap())
        .collect::<Vec<_>>();
    let outer = KFoldSpec {
        n_splits: 3,
        shuffle: false,
        seed: Some(7),
    }
    .split("outer", &samples)
    .unwrap();
    let original = nested_stacking_test_plan(outer, true);
    let mut graph = original.graph_plan.graph;
    let join_id = NodeId::new("merge:prediction.features").unwrap();
    let base_id = NodeId::new("model:base.a").unwrap();
    graph
        .nodes
        .iter_mut()
        .find(|node| node.id == base_id)
        .unwrap()
        .ports
        .inputs
        .push(port("x", PortKind::Data));
    let mut join = node(
        join_id.as_str(),
        NodeKind::PredictionJoin,
        vec![
            port("a", PortKind::Prediction),
            port("b", PortKind::Prediction),
        ],
        vec![port("x_out", PortKind::Data)],
    );
    join.metadata.insert(
        "prediction_feature_execution".to_string(),
        json!("native_oof_v1"),
    );
    graph.nodes.push(join);
    for (name, port_name) in [("model:source.a", "a"), ("model:source.b", "b")] {
        let source_id = NodeId::new(name).unwrap();
        graph.nodes.push(node(
            name,
            NodeKind::Model,
            Vec::new(),
            vec![port("pred", PortKind::Prediction)],
        ));
        graph.edges.push(EdgeSpec {
            source: PortRef {
                node_id: source_id,
                port_name: "pred".to_string(),
            },
            target: PortRef {
                node_id: join_id.clone(),
                port_name: port_name.to_string(),
            },
            contract: EdgeContract {
                requires_oof: true,
                requires_fold_alignment: true,
                ..EdgeContract::new(PortKind::Prediction, None)
            },
        });
    }
    graph.edges.push(EdgeSpec {
        source: PortRef {
            node_id: join_id.clone(),
            port_name: "x_out".to_string(),
        },
        target: PortRef {
            node_id: base_id.clone(),
            port_name: "x".to_string(),
        },
        contract: EdgeContract::new(PortKind::Data, None),
    });
    let mut registry = manifests();
    let mut join_manifest =
        controller_manifest("controller:prediction.join", NodeKind::PredictionJoin);
    join_manifest
        .capabilities
        .insert(ControllerCapability::ConsumesOofPredictions);
    registry.register(join_manifest).unwrap();
    let plan = build_execution_plan(
        "plan:prediction.feature.residual",
        graph,
        original.campaign,
        &registry,
    )
    .unwrap();
    let nested = nested_stacking_campaign_plan(&plan).unwrap().unwrap();
    let feature = prediction_feature_join_plan(&plan, &nested)
        .unwrap()
        .unwrap();
    assert_eq!(feature.join_node_id, join_id);
    assert_eq!(
        feature.source_node_ids,
        BTreeSet::from([
            NodeId::new("model:source.a").unwrap(),
            NodeId::new("model:source.b").unwrap(),
        ])
    );
    assert!(feature.downstream_node_ids.contains(&base_id));
    assert!(!feature.downstream_node_ids.contains(&join_id));

    let final_sample = SampleId::new("external:1").unwrap();
    let mut inputs = BTreeMap::new();
    for (name, value) in [("model:source.a", 1.0), ("model:source.b", 2.0)] {
        inputs.insert(
            format!("{name}.pred:predict"),
            PredictionInputSpec {
                producer_node: NodeId::new(name).unwrap(),
                source_port: "pred".to_string(),
                target_port: "x".to_string(),
                partition: PredictionPartition::Final,
                prediction_level: PredictionLevel::Sample,
                fold_id: None,
                fold_ids: Vec::new(),
                unit_ids: Vec::new(),
                sample_ids: vec![final_sample.clone()],
                values: vec![vec![value]],
                feature_validity_masks: None,
                source_presence: None,
                prediction_width: 1,
                target_names: vec!["y".to_string()],
            },
        );
    }
    let scope = PhaseScope {
        phase: Phase::Predict,
        variant_id: None,
        variant: None,
        fold_id: None,
        seed_root: None,
    };
    let matrix = prediction_feature_matrix_for_task(
        &plan,
        plan.node_plans.get(&join_id).unwrap(),
        &inputs,
        &scope,
        &PhaseScopeResources::default(),
    )
    .unwrap()
    .unwrap();
    assert_eq!(matrix.sample_ids, vec![final_sample]);
    assert_eq!(matrix.values, vec![vec![1.0, 2.0]]);

    let refit = nested.refit_fold_set.as_ref().unwrap();
    let edge = plan
        .graph_plan
        .graph
        .edges
        .iter()
        .find(|edge| {
            edge.target.node_id == join_id
                && edge.source.node_id == NodeId::new("model:source.a").unwrap()
        })
        .unwrap();
    let mut ctx = RunContext::new(RunId::new("run:prediction.feature.refit").unwrap(), None);
    for fold in plan
        .fold_set
        .as_ref()
        .unwrap()
        .folds
        .iter()
        .chain(&refit.folds)
    {
        ctx.prediction_store
            .append(PredictionBlock {
                prediction_id: None,
                producer_node: edge.source.node_id.clone(),
                producer_port: Some(edge.source.port_name.clone()),
                partition: PredictionPartition::Validation,
                fold_id: Some(fold.fold_id.clone()),
                sample_ids: fold.validation_sample_ids.clone(),
                values: vec![vec![1.0]; fold.validation_sample_ids.len()],
                target_names: vec!["y".to_string()],
            })
            .unwrap();
    }
    let refit_blocks = validate_refit_oof_edge(&plan, edge, &ctx).unwrap().unwrap();
    assert_eq!(refit_blocks.len(), refit.folds.len());
    assert!(refit_blocks.iter().all(|block| refit
        .folds
        .iter()
        .any(|fold| block.fold_id.as_ref() == Some(&fold.fold_id))));
}

#[test]
fn nested_stacking_accepts_one_oof_base_producer() {
    use crate::fold::KFoldSpec;

    let samples = (1..=6)
        .map(|index| SampleId::new(format!("s{index}")).unwrap())
        .collect::<Vec<_>>();
    let outer = KFoldSpec {
        n_splits: 3,
        shuffle: false,
        seed: Some(7),
    }
    .split("outer", &samples)
    .unwrap();
    let mut plan = nested_stacking_test_plan(outer, false);
    let base_b = NodeId::new("model:base.b").unwrap();
    plan.graph_plan.graph.nodes.retain(|node| node.id != base_b);
    plan.graph_plan
        .graph
        .edges
        .retain(|edge| edge.source.node_id != base_b);
    plan.node_plans.remove(&base_b);

    let nested = nested_stacking_campaign_plan(&plan)
        .unwrap()
        .expect("one base producer is a valid nested OOF meta input");
    assert_eq!(
        nested.base_node_ids,
        BTreeSet::from([NodeId::new("model:base.a").unwrap()])
    );
}

#[test]
fn nested_stacking_campaign_requires_explicit_marker_and_parent_bound_inner_oof() {
    use crate::fold::KFoldSpec;
    let samples = (1..=6)
        .map(|index| SampleId::new(format!("s{index}")).unwrap())
        .collect::<Vec<_>>();
    let outer = KFoldSpec {
        n_splits: 3,
        shuffle: false,
        seed: Some(7),
    }
    .split("outer", &samples)
    .unwrap();
    let plan = nested_stacking_test_plan(outer.clone(), false);
    let meta_id = NodeId::new("model:meta").unwrap();
    let base_a = NodeId::new("model:base.a").unwrap();
    let base_b = NodeId::new("model:base.b").unwrap();
    let nested = nested_stacking_campaign_plan(&plan)
        .unwrap()
        .expect("explicit nested marker produces a campaign plan");
    assert_eq!(nested.meta_node_id, meta_id.clone());
    assert_eq!(
        nested.base_node_ids,
        BTreeSet::from([base_a.clone(), base_b.clone()])
    );
    assert_eq!(nested.outer_scopes.len(), 3);
    assert!(
        nested.refit_fold_set.is_none(),
        "existing KFold execution remains unchanged"
    );
    for scope in &nested.outer_scopes {
        let parent = outer
            .folds
            .iter()
            .find(|fold| fold.fold_id == scope.outer_fold_id)
            .unwrap();
        scope.inner.validate_for_outer(parent).unwrap();
    }

    // The scheduler-side input replacement is the non-leakage boundary: base
    // inner folds become the unsuffixed fit matrix, while outer validation is
    // retained only under `:outer` for the meta-model prediction call.
    let selected_outer = &nested.outer_scopes[0];
    let scope = PhaseScope {
        phase: Phase::FitCv,
        variant_id: Some(plan.variants[0].variant_id.clone()),
        variant: Some(VariantExecutionSpec::from_plan(&plan.variants[0])),
        fold_id: Some(selected_outer.outer_fold_id.clone()),
        seed_root: Some(11),
    };
    let mut ctx = RunContext::new(RunId::new("run:nested.stacking.inputs").unwrap(), Some(11));
    let meta_plan = plan.node_plans.get(&meta_id).unwrap();
    let mut handles = BTreeMap::new();
    let mut prediction_inputs = BTreeMap::new();
    for source in [&base_a, &base_b] {
        let edge = plan
            .graph_plan
            .graph
            .edges
            .iter()
            .find(|edge| edge.source.node_id == *source)
            .unwrap();
        for inner_fold in &selected_outer.inner.inner_fold_set.folds {
            ctx.prediction_store
                .append(PredictionBlock {
                    prediction_id: Some(format!("pred:{source}:{}", inner_fold.fold_id)),
                    producer_node: source.clone(),
                    producer_port: Some("pred".to_string()),
                    partition: PredictionPartition::Validation,
                    fold_id: Some(inner_fold.fold_id.clone()),
                    sample_ids: inner_fold.validation_sample_ids.clone(),
                    values: vec![vec![1.0]; inner_fold.validation_sample_ids.len()],
                    target_names: vec!["y".to_string()],
                })
                .unwrap();
        }
        let parent = outer
            .folds
            .iter()
            .find(|fold| fold.fold_id == selected_outer.outer_fold_id)
            .unwrap();
        ctx.prediction_store
            .append(PredictionBlock {
                prediction_id: Some(format!("pred:{source}:{}", parent.fold_id)),
                producer_node: source.clone(),
                producer_port: Some("pred".to_string()),
                partition: PredictionPartition::Validation,
                fold_id: Some(parent.fold_id.clone()),
                sample_ids: parent.validation_sample_ids.clone(),
                values: vec![vec![2.0]; parent.validation_sample_ids.len()],
                target_names: vec!["y".to_string()],
            })
            .unwrap();
        let outer_blocks = ctx.prediction_store.find(
            Some(source),
            Some(&PredictionPartition::Validation),
            Some(&parent.fold_id),
        );
        let outer_spec = prediction_input_spec(edge, &scope, &outer_blocks, false).unwrap();
        let key = format!("{source}.pred");
        prediction_inputs.insert(key.clone(), outer_spec);
        handles.insert(
            key,
            HandleRef {
                handle: 42,
                kind: HandleKind::Prediction,
                owner_controller: ControllerId::new("controller:model").unwrap(),
            },
        );
    }
    replace_nested_stacking_fit_cv_inputs(
        &plan,
        meta_plan,
        &ctx,
        &scope,
        &NestedStackingInput {
            meta_node_id: &meta_id,
            inner: &selected_outer.inner,
            parent_fold_set: &outer,
            kind: NestedMetaKind::Stacking,
        },
        &mut handles,
        &mut prediction_inputs,
    )
    .unwrap();
    let parent = outer
        .folds
        .iter()
        .find(|fold| fold.fold_id == selected_outer.outer_fold_id)
        .unwrap();
    for source in [&base_a, &base_b] {
        let inner = prediction_inputs.get(&format!("{source}.pred")).unwrap();
        let outer = prediction_inputs
            .get(&format!("{source}.pred:outer"))
            .unwrap();
        assert_eq!(
            inner.sample_ids, parent.train_sample_ids,
            "inner OOF covers exactly outer training rows"
        );
        assert_eq!(outer.sample_ids, parent.validation_sample_ids);
        assert!(
            inner
                .sample_ids
                .iter()
                .all(|sample| !outer.sample_ids.contains(sample)),
            "a meta training row cannot be an outer evaluation row"
        );
    }
}

#[test]
fn nested_residual_campaign_delivers_only_parent_train_targets() {
    use crate::fold::KFoldSpec;
    let samples = (1..=6)
        .map(|index| SampleId::new(format!("s{index}")).unwrap())
        .collect::<Vec<_>>();
    let outer = KFoldSpec {
        n_splits: 3,
        shuffle: false,
        seed: Some(7),
    }
    .split("outer", &samples)
    .unwrap();
    let stacking = nested_stacking_test_plan(outer.clone(), true);
    let mut graph = stacking.graph_plan.graph.clone();
    let meta_id = NodeId::new("model:meta").unwrap();
    let base_id = NodeId::new("model:base.a").unwrap();
    graph
        .nodes
        .retain(|node| node.id != NodeId::new("model:base.b").unwrap());
    graph.edges.retain(|edge| edge.source.node_id == base_id);
    let meta = graph
        .nodes
        .iter_mut()
        .find(|node| node.id == meta_id)
        .unwrap();
    meta.ports.inputs.retain(|port| port.name == "a");
    meta.metadata.remove(NESTED_STACKING_EXECUTION_METADATA_KEY);
    meta.metadata.insert(
        RESIDUAL_TARGET_EXECUTION_METADATA_KEY.to_string(),
        json!(RESIDUAL_TARGET_EXECUTION_V1),
    );
    let plan = build_execution_plan(
        "plan:nested.residual",
        graph,
        stacking.campaign,
        &manifests(),
    )
    .unwrap();
    let nested = nested_stacking_campaign_plan(&plan).unwrap().unwrap();
    assert_eq!(nested.kind, NestedMetaKind::Residual);
    assert_eq!(nested.base_node_ids, BTreeSet::from([base_id.clone()]));
    let selected = &nested.outer_scopes[0];
    let scope = PhaseScope {
        phase: Phase::FitCv,
        variant_id: Some(plan.variants[0].variant_id.clone()),
        variant: Some(VariantExecutionSpec::from_plan(&plan.variants[0])),
        fold_id: Some(selected.outer_fold_id.clone()),
        seed_root: Some(11),
    };
    let nested_input = NestedStackingInput {
        meta_node_id: &meta_id,
        inner: &selected.inner,
        parent_fold_set: plan.fold_set.as_ref().expect("outer folds"),
        kind: NestedMetaKind::Residual,
    };
    let mut ctx = RunContext::new(RunId::new("run:nested.residual.inputs").unwrap(), Some(11));
    for fold in &selected.inner.inner_fold_set.folds {
        let ids = fold.validation_sample_ids.clone();
        ctx.prediction_store
            .append(PredictionBlock {
                prediction_id: Some(format!("pred:base:{}", fold.fold_id)),
                producer_node: base_id.clone(),
                producer_port: Some("pred".to_string()),
                partition: PredictionPartition::Validation,
                fold_id: Some(fold.fold_id.clone()),
                sample_ids: ids.clone(),
                values: vec![vec![1.0]; ids.len()],
                target_names: vec!["y".to_string()],
            })
            .unwrap();
        ctx.regression_target_records
            .push(crate::metrics::RegressionTargetRecord {
                producer_node: base_id.clone(),
                producer_port: Some("pred".to_string()),
                variant_id: scope.variant_id.clone(),
                partition: PredictionPartition::Validation,
                fold_id: Some(fold.fold_id.clone()),
                block: RegressionTargetBlock {
                    level: PredictionLevel::Sample,
                    unit_ids: ids.iter().cloned().map(PredictionUnitId::Sample).collect(),
                    values: ids
                        .iter()
                        .map(|sample| vec![sample.as_str()[1..].parse::<f64>().unwrap() * 10.0])
                        .collect(),
                    validity_masks: None,
                    target_names: vec!["y".to_string()],
                },
            });
    }
    let target = nested_residual_targets(
        &plan,
        plan.node_plans.get(&meta_id).unwrap(),
        &ctx,
        &scope,
        Some(&nested_input),
    )
    .unwrap()
    .unwrap();
    let parent = outer
        .folds
        .iter()
        .find(|fold| fold.fold_id == selected.outer_fold_id)
        .unwrap();
    assert_eq!(target.sample_ids, parent.train_sample_ids);
    assert!(target
        .sample_ids
        .iter()
        .all(|sample| !parent.validation_sample_ids.contains(sample)));
    for (sample, row) in target.sample_ids.iter().zip(&target.values) {
        assert_eq!(
            row,
            &vec![sample.as_str()[1..].parse::<f64>().unwrap() * 10.0 - 1.0]
        );
    }
    ctx.regression_target_records.clear();
    assert!(nested_residual_targets(
        &plan,
        plan.node_plans.get(&meta_id).unwrap(),
        &ctx,
        &scope,
        Some(&nested_input),
    )
    .is_err());
}

#[test]
fn nested_stacking_resampled_refit_has_separate_exact_partitioned_oof() {
    use crate::fold::KFoldSpec;
    let samples = (1..=6)
        .map(|i| SampleId::new(format!("s{i}")).unwrap())
        .collect::<Vec<_>>();
    let mut outer = KFoldSpec {
        n_splits: 3,
        shuffle: false,
        seed: Some(7),
    }
    .split("outer", &samples)
    .unwrap();
    outer.folds.pop(); // Two samples have never been validated externally.
    let mut repeated = outer.folds[0].clone();
    repeated.fold_id = FoldId::new("repeat0").unwrap();
    outer.folds.push(repeated); // Two others have multiple external occurrences.
    outer.partition_mode = FoldPartitionMode::Resampled;
    outer.validate().unwrap();
    let ordinary = nested_stacking_test_plan(outer.clone(), false);
    let plan = nested_stacking_test_plan(outer.clone(), true);
    assert_ne!(
        ordinary.graph_fingerprint, plan.graph_fingerprint,
        "explicit refit policy is fingerprinted"
    );
    let nested = nested_stacking_campaign_plan(&plan).unwrap().unwrap();
    for scope in &nested.outer_scopes {
        let parent = outer
            .folds
            .iter()
            .find(|fold| fold.fold_id == scope.outer_fold_id)
            .unwrap();
        scope.inner.validate_for_outer(parent).unwrap();
    }
    let refit = nested.refit_fold_set.unwrap();
    assert_eq!(refit.partition_mode, FoldPartitionMode::Partition);
    assert_eq!(refit.sample_ids, samples);
    let mut seen = BTreeSet::new();
    for fold in &refit.folds {
        assert!(fold.fold_id.as_str().starts_with("stacking.refit.inner."));
        for id in &fold.validation_sample_ids {
            assert!(
                seen.insert(id.clone()),
                "exactly one REFIT OOF contribution per sample"
            );
            assert!(!fold.train_sample_ids.contains(id));
        }
    }
    assert_eq!(seen, samples.into_iter().collect());
    assert_eq!(
        refit,
        nested_stacking_campaign_plan(&plan)
            .unwrap()
            .unwrap()
            .refit_fold_set
            .unwrap()
    );

    let source = NodeId::new("model:base.a").unwrap();
    let edge = plan
        .graph_plan
        .graph
        .edges
        .iter()
        .find(|edge| edge.source.node_id == source)
        .unwrap();
    let mut ctx = RunContext::new(RunId::new("run:resampled.refit").unwrap(), Some(11));
    for (folds, value) in [(&outer.folds, 100.0), (&refit.folds, 1.0)] {
        for fold in folds {
            ctx.prediction_store
                .append(PredictionBlock {
                    prediction_id: Some(format!("pred:{}", fold.fold_id)),
                    producer_node: source.clone(),
                    producer_port: Some("pred".to_string()),
                    partition: PredictionPartition::Validation,
                    fold_id: Some(fold.fold_id.clone()),
                    sample_ids: fold.validation_sample_ids.clone(),
                    values: vec![vec![value]; fold.validation_sample_ids.len()],
                    target_names: vec!["y".to_string()],
                })
                .unwrap();
        }
    }
    let selected = validate_refit_oof_edge(&plan, edge, &ctx).unwrap().unwrap();
    assert_eq!(selected.len(), refit.folds.len());
    assert!(selected
        .iter()
        .all(|block| block.values.iter().all(|row| row == &[1.0])));
    let scope = PhaseScope {
        phase: Phase::Refit,
        variant_id: None,
        variant: None,
        fold_id: None,
        seed_root: Some(11),
    };
    let joined = prediction_input_spec(edge, &scope, &selected, false).unwrap();
    assert_eq!(joined.sample_ids, refit.sample_ids);
    assert_eq!(joined.values, vec![vec![1.0]; refit.sample_ids.len()]);

    let empty = RunContext::new(RunId::new("run:missing.refit.oof").unwrap(), Some(11));
    assert!(
        validate_refit_oof_edge(&plan, edge, &empty).is_err(),
        "no imputed or train predictions accepted"
    );
    // Scope BOTH predictions and target records. Preparation covers samples
    // absent from the resampled evaluation union and must not widen its truth
    // universe (nor contaminate the outer scores with its different values).
    ctx.validation_scoring_fold_ids = Some(
        outer
            .folds
            .iter()
            .map(|fold| fold.fold_id.clone())
            .collect(),
    );
    for block in ctx.prediction_store.blocks() {
        ctx.regression_target_records
            .push(crate::metrics::RegressionTargetRecord {
                producer_node: source.clone(),
                producer_port: Some("pred".to_string()),
                variant_id: None,
                partition: PredictionPartition::Validation,
                fold_id: block.fold_id.clone(),
                block: crate::metrics::RegressionTargetBlock {
                    validity_masks: None,
                    level: crate::policy::PredictionLevel::Sample,
                    unit_ids: block
                        .sample_ids
                        .iter()
                        .cloned()
                        .map(crate::aggregation::PredictionUnitId::Sample)
                        .collect(),
                    values: block.values.clone(),
                    target_names: vec!["y".to_string()],
                },
            });
    }
    ctx.collect_cross_fold_validation_scores(FoldPartitionMode::Resampled)
        .unwrap();
    assert_eq!(ctx.oof_average_blocks.len(), 2);
    assert_eq!(ctx.oof_average_blocks[0].predictions.unit_ids.len(), 4);
    assert_eq!(
        ctx.oof_average_blocks[0].predictions.values,
        vec![vec![100.0]; 4]
    );
    assert_eq!(
        ctx.oof_average_blocks[0].y_true.values,
        vec![vec![100.0]; 4]
    );
    assert_eq!(
        ctx.oof_average_blocks[1].predictions.values,
        ctx.oof_average_blocks[0].predictions.values
    );
    assert_eq!(
        ctx.oof_average_blocks[1]
            .predictions
            .fold_id
            .as_ref()
            .unwrap()
            .as_str(),
        "w_avg"
    );
}

#[test]
fn native_scoring_collects_reports_and_builds_score_set() {
    use crate::aggregation::PredictionUnitId;
    use crate::ids::SampleId;
    use crate::metrics::RegressionTargetBlock;
    use crate::policy::PredictionLevel;

    let node = NodeId::new("model:pls").unwrap();
    let predictions = PredictionBlock {
        prediction_id: None,
        producer_node: node.clone(),
        producer_port: Some("pred".to_string()),
        partition: PredictionPartition::Validation,
        fold_id: None,
        sample_ids: vec![SampleId::new("s1").unwrap(), SampleId::new("s2").unwrap()],
        values: vec![vec![2.0], vec![4.0]],
        target_names: vec!["y".to_string()],
    };
    let targets = RegressionTargetBlock {
        validity_masks: None,
        level: PredictionLevel::Sample,
        unit_ids: vec![
            PredictionUnitId::Sample(SampleId::new("s1").unwrap()),
            PredictionUnitId::Sample(SampleId::new("s2").unwrap()),
        ],
        values: vec![vec![2.0], vec![4.0]],
        target_names: vec!["y".to_string()],
    };
    let make = |regression_targets: Vec<RegressionTargetBlock>| NodeResult {
        schema_version: None,
        classification_probabilities: Vec::new(),
        consumed_data_views: std::collections::BTreeMap::new(),
        node_id: node.clone(),
        outputs: BTreeMap::new(),
        predictions: vec![predictions.clone()],
        observation_predictions: Vec::new(),
        aggregated_predictions: Vec::new(),
        explanations: Vec::new(),
        shape_deltas: Vec::new(),
        artifacts: Vec::new(),
        artifact_handles: BTreeMap::new(),
        fit_influence_diagnostics: Vec::new(),
        regression_targets,
        lineage: LineageRecord {
            record_id: LineageId::new("lineage:t").unwrap(),
            run_id: RunId::new("run:t").unwrap(),
            node_id: node.clone(),
            phase: Phase::FitCv,
            controller_id: ControllerId::new("controller:pls").unwrap(),
            controller_version: "1".to_string(),
            variant_id: None,
            fold_id: None,
            branch_path: Vec::new(),
            input_lineage: Vec::new(),
            artifact_refs: Vec::new(),
            params_fingerprint: "fp".to_string(),
            data_model_shape_fingerprint: None,
            aggregation_policy_fingerprint: None,
            seed: None,
            unsafe_flags: BTreeSet::new(),
            metrics: BTreeMap::new(),
            loss_attestations: Vec::new(),
            early_stopping_records: Vec::new(),
            target_domain: None,
        },
    };

    // Targets present -> the result is scored natively and collectable into a ScoreSet.
    let mut ctx = RunContext::new(RunId::new("run:t").unwrap(), None);
    apply_result_scoring(
        &make(vec![targets]),
        &BTreeSet::new(),
        &mut ctx.score_collector,
        &mut ctx.regression_target_records,
    )
    .unwrap();
    assert_eq!(ctx.score_collector.len(), 1);
    assert_eq!(ctx.regression_target_records.len(), 1);
    assert!(ctx.score_collector[0].metrics.contains_key("rmse"));
    let set = ctx
        .build_score_set("plan:t", Some("rmse".to_string()))
        .unwrap();
    assert_eq!(set.reports.len(), 1);
    set.validate().unwrap();

    // No targets -> nothing collected, no ScoreSet (existing runs are unaffected).
    let mut empty = RunContext::new(RunId::new("run:t").unwrap(), None);
    apply_result_scoring(
        &make(Vec::new()),
        &BTreeSet::new(),
        &mut empty.score_collector,
        &mut empty.regression_target_records,
    )
    .unwrap();
    assert!(empty.score_collector.is_empty());
    assert!(empty.build_score_set("plan:t", None).is_none());
}

#[test]
fn auxiliary_prediction_port_matches_primary_cohort_and_does_not_score() {
    use crate::aggregation::PredictionUnitId;

    let mut plan = fixture_plan("plan:dual-prediction-output");
    let node_id = NodeId::new("model:base").unwrap();
    let node = plan
        .graph_plan
        .graph
        .nodes
        .iter_mut()
        .find(|node| node.id == node_id)
        .unwrap();
    node.ports.outputs.push(port("proba", PortKind::Prediction));
    node.metadata
        .insert("auxiliary_prediction_ports".to_string(), json!(["proba"]));
    let mut task = fit_influence_validation_task(FitInfluenceTask::default());
    task.node_plan = plan.node_plans[&node_id].clone();
    let ids = vec![SampleId::new("s1").unwrap(), SampleId::new("s2").unwrap()];
    let primary = PredictionBlock {
        prediction_id: None,
        producer_node: node_id.clone(),
        producer_port: Some("oof".to_string()),
        partition: PredictionPartition::Validation,
        fold_id: Some(FoldId::new("fold:0").unwrap()),
        sample_ids: ids.clone(),
        values: vec![vec![0.0], vec![1.0]],
        target_names: vec!["y".to_string()],
    };
    let auxiliary = PredictionBlock {
        producer_port: Some("proba".to_string()),
        values: vec![vec![0.8, 0.2], vec![0.1, 0.9]],
        target_names: vec!["0".to_string(), "1".to_string()],
        ..primary.clone()
    };
    let mut result = NodeResult {
        schema_version: None,
        classification_probabilities: Vec::new(),
        consumed_data_views: std::collections::BTreeMap::new(),
        node_id: node_id.clone(),
        outputs: BTreeMap::new(),
        predictions: vec![primary, auxiliary],
        observation_predictions: Vec::new(),
        aggregated_predictions: Vec::new(),
        explanations: Vec::new(),
        shape_deltas: Vec::new(),
        artifacts: Vec::new(),
        artifact_handles: BTreeMap::new(),
        fit_influence_diagnostics: Vec::new(),
        regression_targets: vec![RegressionTargetBlock {
            level: PredictionLevel::Sample,
            unit_ids: ids.into_iter().map(PredictionUnitId::Sample).collect(),
            values: vec![vec![0.0], vec![1.0]],
            target_names: vec!["y".to_string()],
            validity_masks: None,
        }],
        lineage: LineageRecord {
            record_id: LineageId::new("lineage:dual.prediction").unwrap(),
            run_id: task.run_id.clone(),
            node_id,
            phase: task.phase,
            controller_id: task.node_plan.controller_id.clone(),
            controller_version: task.node_plan.controller_version.clone(),
            variant_id: None,
            fold_id: task.fold_id.clone(),
            branch_path: Vec::new(),
            input_lineage: Vec::new(),
            artifact_refs: Vec::new(),
            params_fingerprint: task.node_plan.params_fingerprint.clone(),
            data_model_shape_fingerprint: None,
            aggregation_policy_fingerprint: None,
            seed: None,
            unsafe_flags: BTreeSet::new(),
            metrics: BTreeMap::new(),
            loss_attestations: Vec::new(),
            early_stopping_records: Vec::new(),
            target_domain: None,
        },
    };
    normalize_result_prediction_ports(&plan, &task, &mut result).unwrap();
    let mut ctx = RunContext::new(task.run_id.clone(), None);
    apply_result_scoring(
        &result,
        &BTreeSet::from(["proba".to_string()]),
        &mut ctx.score_collector,
        &mut ctx.regression_target_records,
    )
    .unwrap();
    assert_eq!(ctx.score_collector.len(), 1);
    assert_eq!(ctx.regression_target_records.len(), 1);
    assert_eq!(ctx.score_collector[0].producer_port.as_deref(), Some("oof"));

    result.predictions[1].sample_ids.reverse();
    assert!(normalize_result_prediction_ports(&plan, &task, &mut result)
        .unwrap_err()
        .to_string()
        .contains("ordered sample IDs"));

    // Group/target-level outputs obey the same primary-only scoring rule.
    let target_id = PredictionUnitId::Target(TargetId::new("target:one").unwrap());
    result.predictions.clear();
    result.aggregated_predictions = vec![
        crate::aggregation::AggregatedPredictionBlock {
            prediction_id: None,
            producer_node: result.node_id.clone(),
            producer_port: Some("oof".to_string()),
            partition: PredictionPartition::Validation,
            fold_id: task.fold_id.clone(),
            level: PredictionLevel::Target,
            unit_ids: vec![target_id.clone()],
            values: vec![vec![1.0]],
            target_names: vec!["y".to_string()],
        },
        crate::aggregation::AggregatedPredictionBlock {
            prediction_id: None,
            producer_node: result.node_id.clone(),
            producer_port: Some("proba".to_string()),
            partition: PredictionPartition::Validation,
            fold_id: task.fold_id.clone(),
            level: PredictionLevel::Target,
            unit_ids: vec![target_id.clone()],
            values: vec![vec![0.2, 0.8]],
            target_names: vec!["0".to_string(), "1".to_string()],
        },
    ];
    result.regression_targets = vec![RegressionTargetBlock {
        level: PredictionLevel::Target,
        unit_ids: vec![target_id],
        values: vec![vec![1.0]],
        target_names: vec!["y".to_string()],
        validity_masks: None,
    }];
    let mut aggregated = RunContext::new(task.run_id.clone(), None);
    apply_result_scoring(
        &result,
        &BTreeSet::from(["proba".to_string()]),
        &mut aggregated.score_collector,
        &mut aggregated.regression_target_records,
    )
    .unwrap();
    assert_eq!(aggregated.score_collector.len(), 1);
    assert_eq!(
        aggregated.score_collector[0].producer_port.as_deref(),
        Some("oof")
    );
}

#[test]
fn cross_fold_validation_reports_scores_the_oof_average() {
    use crate::aggregation::PredictionUnitId;
    use crate::ids::SampleId;
    use crate::metrics::{
        cross_fold_validation_reports, RegressionTargetBlock, RegressionTargetRecord,
    };
    use crate::policy::PredictionLevel;

    let node = NodeId::new("model:pls").unwrap();
    let pred = |fold: &str, rows: &[(&str, f64)]| PredictionBlock {
        prediction_id: None,
        producer_node: node.clone(),
        producer_port: None,
        partition: PredictionPartition::Validation,
        fold_id: Some(FoldId::new(fold).unwrap()),
        sample_ids: rows
            .iter()
            .map(|(s, _)| SampleId::new(*s).unwrap())
            .collect(),
        values: rows.iter().map(|(_, v)| vec![*v]).collect(),
        target_names: vec!["y".to_string()],
    };
    let record = |fold: &str, rows: &[(&str, f64)]| RegressionTargetRecord {
        producer_node: node.clone(),
        producer_port: None,
        variant_id: None,
        partition: PredictionPartition::Validation,
        fold_id: Some(FoldId::new(fold).unwrap()),
        block: RegressionTargetBlock {
            validity_masks: None,
            level: PredictionLevel::Sample,
            unit_ids: rows
                .iter()
                .map(|(s, _)| PredictionUnitId::Sample(SampleId::new(*s).unwrap()))
                .collect(),
            values: rows.iter().map(|(_, v)| vec![*v]).collect(),
            target_names: vec!["y".to_string()],
        },
    };

    // Two disjoint folds -> OOF concat scored over all 4 samples; residual only on s4 (5 vs 4).
    let blocks = [
        pred("fold0", &[("s1", 1.0), ("s2", 2.0)]),
        pred("fold1", &[("s3", 3.0), ("s4", 5.0)]),
    ];
    let records = [
        record("fold0", &[("s1", 1.0), ("s2", 2.0)]),
        record("fold1", &[("s3", 3.0), ("s4", 4.0)]),
    ];
    let outcome = cross_fold_validation_reports(
        &blocks,
        &records,
        SCORE_METRICS,
        FoldPartitionMode::Partition,
    )
    .unwrap();
    let reports = &outcome.reports;
    assert_eq!(reports.len(), 1);
    assert_eq!(reports[0].fold_id, Some(FoldId::new("avg").unwrap()));
    assert_eq!(reports[0].partition, PredictionPartition::Validation);
    assert_eq!(reports[0].row_count, 4);
    assert!((reports[0].metrics["rmse"] - 0.5).abs() < 1e-9); // sqrt((0+0+0+1)/4)

    // Additive per-sample OOF average surface: one block, keyed identically to the scalar report
    // (Validation / avg), pooled per-sample values + a y_true row per averaged sample (same id set).
    assert_eq!(outcome.oof_averages.len(), 1);
    let oof = &outcome.oof_averages[0];
    assert_eq!(oof.predictions.partition, PredictionPartition::Validation);
    assert_eq!(oof.predictions.fold_id, Some(FoldId::new("avg").unwrap()));
    assert_eq!(oof.predictions.level, PredictionLevel::Sample);
    assert_eq!(oof.predictions.unit_ids.len(), 4);
    assert_eq!(oof.y_true.unit_ids, oof.predictions.unit_ids);
}

#[test]
fn cross_fold_validation_reports_rejects_cross_variant_mixed_oof() {
    // R-P0-1 scoring-path guard: a producer whose two "fold" blocks both claim sample s1 (the
    // signature of two variants accumulated in one context, since PredictionBlock has no variant tag)
    // must be REFUSED rather than silently averaged into one cv score. Without the guard,
    // `reduce_predictions_across_folds` would average the two s1 rows and mix the variants.
    use crate::ids::SampleId;

    let node = NodeId::new("model:pls").unwrap();
    let pred = |fold: &str, rows: &[(&str, f64)]| PredictionBlock {
        prediction_id: None,
        producer_node: node.clone(),
        producer_port: None,
        partition: PredictionPartition::Validation,
        fold_id: Some(FoldId::new(fold).unwrap()),
        sample_ids: rows
            .iter()
            .map(|(s, _)| SampleId::new(*s).unwrap())
            .collect(),
        values: rows.iter().map(|(_, v)| vec![*v]).collect(),
        target_names: vec!["y".to_string()],
    };
    // Both blocks claim s1 -> non-unique OOF for this producer.
    let blocks = [
        pred("fold0", &[("s1", 1.0), ("s2", 2.0)]),
        pred("fold1", &[("s1", 9.0), ("s3", 3.0)]),
    ];
    let err =
        cross_fold_validation_reports(&blocks, &[], SCORE_METRICS, FoldPartitionMode::Partition)
            .unwrap_err();
    assert!(
        err.to_string().contains("not unique")
            && err.to_string().contains("mixed several variants"),
        "got: {err}"
    );
}

#[test]
fn combine_validation_targets_rejects_conflicting_ground_truth() {
    // R-P0-1 target-recombination guard: two validation records for the same producer disagree on
    // s1's y_true (4.0 vs 5.0) — the ground-truth reference was mixed (e.g. two variants in one
    // context). Scoring against a corrupted reference is refused. (Exercised through the public
    // `cross_fold_validation_reports`, which calls `combine_validation_targets`.)
    use crate::aggregation::PredictionUnitId;
    use crate::ids::SampleId;
    use crate::metrics::{RegressionTargetBlock, RegressionTargetRecord};

    let node = NodeId::new("model:pls").unwrap();
    let pred = |fold: &str, rows: &[(&str, f64)]| PredictionBlock {
        prediction_id: None,
        producer_node: node.clone(),
        producer_port: None,
        partition: PredictionPartition::Validation,
        fold_id: Some(FoldId::new(fold).unwrap()),
        sample_ids: rows
            .iter()
            .map(|(s, _)| SampleId::new(*s).unwrap())
            .collect(),
        values: rows.iter().map(|(_, v)| vec![*v]).collect(),
        target_names: vec!["y".to_string()],
    };
    let record = |fold: &str, rows: &[(&str, f64)]| RegressionTargetRecord {
        producer_node: node.clone(),
        producer_port: None,
        variant_id: None,
        partition: PredictionPartition::Validation,
        fold_id: Some(FoldId::new(fold).unwrap()),
        block: RegressionTargetBlock {
            validity_masks: None,
            level: PredictionLevel::Sample,
            unit_ids: rows
                .iter()
                .map(|(s, _)| PredictionUnitId::Sample(SampleId::new(*s).unwrap()))
                .collect(),
            values: rows.iter().map(|(_, v)| vec![*v]).collect(),
            target_names: vec!["y".to_string()],
        },
    };
    // Predictions are unique (s1, s2) so they pass the coverage gate; the y_true records conflict.
    let blocks = [pred("fold0", &[("s1", 1.0)]), pred("fold1", &[("s2", 2.0)])];
    let records = [
        record("fold0", &[("s1", 4.0)]),
        record("fold1", &[("s1", 5.0), ("s2", 2.0)]),
    ];
    let err = cross_fold_validation_reports(
        &blocks,
        &records,
        SCORE_METRICS,
        FoldPartitionMode::Partition,
    )
    .unwrap_err();
    assert!(
        err.to_string().contains("conflicting ground truth"),
        "got: {err}"
    );
}

/// Model controller for the native-variant-SELECT test. For each FIT_CV fold it emits one VALIDATION
/// prediction plus (when `emit_targets`) the matching `y_true`, keyed by `fold_id` (fold:0 -> s1,
/// fold:1 -> s2). The predicted value is `y_true + offset`, where `offset` is read from the variant's
/// `n_components` param override — so different variants yield different OOF residuals (hence different
/// OOF RMSE). With `emit_targets = false` the OOF predictions are still well-formed and disjoint across
/// folds, but no ground truth is emitted, so native scoring is genuinely off.
struct VariantScoringController {
    id: ControllerId,
    handle: u64,
    emit_targets: bool,
}

impl VariantScoringController {
    fn fold_sample(task: &NodeTask) -> Option<(SampleId, f64)> {
        // (validation sample, its y_true) per fold of `two_fold_set`.
        match task.fold_id.as_ref()?.as_str() {
            "fold:0" => Some((SampleId::new("s1").unwrap(), 1.0)),
            "fold:1" => Some((SampleId::new("s2").unwrap(), 2.0)),
            _ => None,
        }
    }
}

impl RuntimeController for VariantScoringController {
    fn controller_id(&self) -> &ControllerId {
        &self.id
    }

    fn invoke(&self, task: &NodeTask) -> Result<NodeResult> {
        let output = HandleRef {
            handle: self.handle,
            kind: HandleKind::Data,
            owner_controller: self.id.clone(),
        };
        let mut predictions = Vec::new();
        let mut regression_targets = Vec::new();
        if let Some((sample_id, y_true)) = Self::fold_sample(task) {
            // Prediction = y_true + offset(variant). offset is the variant's `n_components` override.
            let offset = task
                .node_plan
                .params
                .get("n_components")
                .and_then(serde_json::Value::as_f64)
                .unwrap_or(0.0);
            predictions.push(PredictionBlock {
                prediction_id: Some(format!("pred:{}", task.node_plan.node_id)),
                producer_node: task.node_plan.node_id.clone(),
                producer_port: None,
                partition: PredictionPartition::Validation,
                fold_id: task.fold_id.clone(),
                sample_ids: vec![sample_id.clone()],
                values: vec![vec![y_true + offset]],
                target_names: vec!["y".to_string()],
            });
            if self.emit_targets {
                regression_targets.push(crate::metrics::RegressionTargetBlock {
                    validity_masks: None,
                    level: PredictionLevel::Sample,
                    unit_ids: vec![crate::aggregation::PredictionUnitId::Sample(sample_id)],
                    values: vec![vec![y_true]],
                    target_names: vec!["y".to_string()],
                });
            }
        }
        let variant_label = task
            .variant_id
            .as_ref()
            .map(ToString::to_string)
            .unwrap_or_else(|| "base".to_string());
        let fold_label = task
            .fold_id
            .as_ref()
            .map(ToString::to_string)
            .unwrap_or_else(|| "nofold".to_string());
        Ok(NodeResult {
            schema_version: None,
            classification_probabilities: Vec::new(),
            consumed_data_views: std::collections::BTreeMap::new(),
            node_id: task.node_plan.node_id.clone(),
            outputs: BTreeMap::from([("pred".to_string(), output)]),
            predictions,
            observation_predictions: Vec::new(),
            aggregated_predictions: Vec::new(),
            explanations: Vec::new(),
            shape_deltas: Vec::new(),
            artifacts: Vec::new(),
            artifact_handles: BTreeMap::new(),
            fit_influence_diagnostics: Vec::new(),
            regression_targets,
            lineage: LineageRecord {
                record_id: LineageId::new(format!(
                    "lineage:{}:{:?}:{variant_label}:{fold_label}",
                    task.node_plan.node_id, task.phase
                ))
                .unwrap(),
                run_id: task.run_id.clone(),
                node_id: task.node_plan.node_id.clone(),
                phase: task.phase,
                controller_id: self.id.clone(),
                controller_version: task.node_plan.controller_version.clone(),
                variant_id: task.variant_id.clone(),
                fold_id: task.fold_id.clone(),
                branch_path: task.branch_path.clone(),
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
                target_domain: None,
            },
        })
    }
}

fn variant_scoring_campaign(offsets: Vec<(&str, f64)>) -> CampaignSpec {
    let choices = offsets
        .into_iter()
        .map(|(label, offset)| GenerationChoice {
            label: label.to_string(),
            value: json!(label),
            param_overrides: vec![crate::generation::GenerationParamOverride {
                node_id: NodeId::new("model:pls").unwrap(),
                params: BTreeMap::from([("n_components".to_string(), json!(offset))]),
            }],
            active_subsequence: None,
        })
        .collect::<Vec<_>>();
    let max_variants = Some(choices.len());
    CampaignSpec {
        inner_cv: None,
        id: "campaign:variant.select".to_string(),
        root_seed: Some(7),
        leakage_policy: Default::default(),
        aggregation_policy: Default::default(),
        split_invocation: Some(SplitInvocation {
            id: "split:outer".to_string(),
            controller_id: None,
            leakage_policy: Default::default(),
            params: BTreeMap::new(),
            fold_set: Some(two_fold_set()),
        }),
        generation: GenerationSpec {
            strategy: GenerationStrategy::Cartesian,
            dimensions: vec![GenerationDimension {
                name: "model_offset".to_string(),
                choices,
            }],
            max_variants,
            constraints: GenerationConstraints::default(),
        },
        shape_plans: BTreeMap::new(),
        data_bindings: BTreeMap::new(),
        branch_view_plans: Vec::new(),
        metadata: BTreeMap::new(),
    }
}

fn variant_scoring_controllers() -> RuntimeControllerRegistry {
    let mut controllers = RuntimeControllerRegistry::new();
    controllers
        .register(Box::new(MockController {
            id: ControllerId::new("controller:transform").unwrap(),
            handle: 1,
            emit_prediction: false,
        }))
        .unwrap();
    controllers
        .register(Box::new(VariantScoringController {
            id: ControllerId::new("controller:model").unwrap(),
            handle: 2,
            emit_targets: true,
        }))
        .unwrap();
    controllers
}

#[test]
fn browser_hpo_worker_window_is_phase_bounded_and_checkpoint_keyed() {
    struct Proposals;
    impl HostHpoProposalSource for Proposals {
        fn ask(&mut self, trial_index: u32) -> Result<Option<BTreeMap<String, serde_json::Value>>> {
            Ok(Some(BTreeMap::from([(
                "n_components".into(),
                json!(trial_index + 1),
            )])))
        }
        fn tell(&mut self, _trial_index: u32, _score: f64) -> Result<()> {
            Ok(())
        }
    }
    let mut campaign = variant_scoring_campaign(vec![("base", 0.0)]);
    campaign.generation = GenerationSpec::default();
    let plan = build_execution_plan(
        "plan:host_hpo:browser.window",
        simple_graph(),
        campaign,
        &manifests(),
    )
    .unwrap();
    let mut request = HostHpoSearchRequest {
        parameter_bindings: BTreeMap::new(),
        structural_catalogue: None,
        phase_trial_budgets: vec![1, 2],
        progressive_pruning: false,
        fold_score_reduction: None,
        target_node: NodeId::new("model:pls").unwrap(),
        trial_budget: 3,
        metric: RegressionMetricKind::Rmse,
        direction: crate::selection::MetricObjective::Minimize,
        optimizer_descriptor: BTreeMap::from([("owner".into(), json!("browser"))]),
    };
    let options = HostHpoResumeOptions {
        data_fingerprint: "data:browser".into(),
        checkpoint: None,
    };
    let first =
        prepare_host_hpo_worker_window(&plan, &request, &options, &mut Proposals, 3).unwrap();
    assert_eq!(
        first.tasks.len(),
        1,
        "a window cannot cross a phase boundary"
    );
    assert_eq!(first.tasks[0].trial_index, 0);
    assert_eq!(first.tasks[0].phase_index, Some(0));
    assert_eq!(
        first.tasks[0].candidate_plan.variants[0]
            .variant_id
            .as_str(),
        "host_hpo:trial:0000000000"
    );
    assert_ne!(
        first.tasks[0].candidate_plan.variants[0].fingerprint,
        plan.variants[0].fingerprint
    );
    assert_eq!(
        first.window_id,
        prepare_host_hpo_worker_window(&plan, &request, &options, &mut Proposals, 3)
            .unwrap()
            .window_id
    );
    request.phase_trial_budgets.clear();
    let parallel =
        prepare_host_hpo_worker_window(&plan, &request, &options, &mut Proposals, 2).unwrap();
    assert_eq!(parallel.tasks.len(), 2);
    assert_eq!(parallel.tasks[1].trial_index, 1);
    assert_ne!(first.window_id, parallel.window_id);
}

#[test]
fn browser_hpo_worker_fold_stops_before_next_fold() {
    struct Proposals;
    impl HostHpoProposalSource for Proposals {
        fn ask(&mut self, _: u32) -> Result<Option<BTreeMap<String, serde_json::Value>>> {
            Ok(Some(BTreeMap::from([("n_components".into(), json!(2.0))])))
        }
        fn tell(&mut self, _: u32, _: f64) -> Result<()> {
            Ok(())
        }
    }
    let mut campaign = variant_scoring_campaign(vec![("base", 0.0)]);
    campaign.generation = GenerationSpec::default();
    let plan = build_execution_plan(
        "plan:host_hpo:worker.fold",
        simple_graph(),
        campaign,
        &manifests(),
    )
    .unwrap();
    let request = HostHpoSearchRequest {
        parameter_bindings: BTreeMap::new(),
        structural_catalogue: None,
        phase_trial_budgets: Vec::new(),
        progressive_pruning: false,
        fold_score_reduction: None,
        target_node: NodeId::new("model:pls").unwrap(),
        trial_budget: 1,
        metric: RegressionMetricKind::Rmse,
        direction: crate::selection::MetricObjective::Minimize,
        optimizer_descriptor: BTreeMap::from([("owner".into(), json!("browser"))]),
    };
    let options = HostHpoResumeOptions {
        data_fingerprint: "data:browser".into(),
        checkpoint: None,
    };
    let task = prepare_host_hpo_worker_window(&plan, &request, &options, &mut Proposals, 2)
        .unwrap()
        .tasks
        .remove(0);
    let provider = InMemoryDataProvider::new(ControllerId::new("controller:data").unwrap());
    let controllers = variant_scoring_controllers();
    let first = evaluate_host_hpo_worker_fold(
        &task,
        &request,
        0,
        &controllers,
        &provider,
        &options.data_fingerprint,
    )
    .unwrap();
    assert_eq!(
        first.fold_id,
        plan.fold_set.as_ref().unwrap().folds[0].fold_id
    );
    assert_eq!(first.score, 2.0);
    assert!(first.scores.reports.iter().all(|report| {
        report.fold_id.as_ref() != Some(&plan.fold_set.as_ref().unwrap().folds[1].fold_id)
    }));
    assert!(evaluate_host_hpo_worker_fold(
        &task,
        &request,
        99,
        &controllers,
        &provider,
        &options.data_fingerprint,
    )
    .is_err());
}

#[test]
fn browser_hpo_worker_window_terminalizes_real_pruned_prefix() {
    struct Proposals {
        told: Vec<u32>,
        pruned: Vec<u32>,
    }
    impl HostHpoProposalSource for Proposals {
        fn ask(&mut self, trial: u32) -> Result<Option<BTreeMap<String, serde_json::Value>>> {
            Ok(Some(BTreeMap::from([(
                "n_components".into(),
                json!(trial + 1),
            )])))
        }
        fn tell(&mut self, trial: u32, _: f64) -> Result<()> {
            self.told.push(trial);
            Ok(())
        }
        fn pruned(&mut self, trial: u32) -> Result<()> {
            self.pruned.push(trial);
            Ok(())
        }
    }
    let mut campaign = variant_scoring_campaign(vec![("base", 0.0)]);
    campaign.generation = GenerationSpec::default();
    let plan = build_execution_plan(
        "plan:host_hpo:worker.prune",
        simple_graph(),
        campaign,
        &manifests(),
    )
    .unwrap();
    let request = HostHpoSearchRequest {
        parameter_bindings: BTreeMap::new(),
        structural_catalogue: None,
        phase_trial_budgets: Vec::new(),
        progressive_pruning: true,
        fold_score_reduction: None,
        target_node: NodeId::new("model:pls").unwrap(),
        trial_budget: 2,
        metric: RegressionMetricKind::Rmse,
        direction: crate::selection::MetricObjective::Minimize,
        optimizer_descriptor: BTreeMap::from([("owner".into(), json!("browser"))]),
    };
    let options = HostHpoResumeOptions {
        data_fingerprint: "data:worker.prune".into(),
        checkpoint: None,
    };
    let mut proposals = Proposals {
        told: Vec::new(),
        pruned: Vec::new(),
    };
    let window =
        prepare_host_hpo_worker_window(&plan, &request, &options, &mut proposals, 2).unwrap();
    let controllers = variant_scoring_controllers();
    let provider = InMemoryDataProvider::new(ControllerId::new("controller:data").unwrap());
    let complete_task = &window.tasks[0];
    let complete_folds = (0..2)
        .map(|index| {
            evaluate_host_hpo_worker_fold(
                complete_task,
                &request,
                index,
                &controllers,
                &provider,
                &options.data_fingerprint,
            )
            .unwrap()
        })
        .collect::<Vec<_>>();
    let pruned_task = &window.tasks[1];
    let pruned_folds = vec![evaluate_host_hpo_worker_fold(
        pruned_task,
        &request,
        0,
        &controllers,
        &provider,
        &options.data_fingerprint,
    )
    .unwrap()];
    let pruned = host_hpo_worker_pruned_evidence(
        pruned_task,
        &request,
        &options.data_fingerprint,
        &pruned_folds,
    )
    .unwrap();
    assert_eq!(pruned.intermediate_scores.len(), 1);
    let results = vec![
        HostHpoWorkerResult::Pruned {
            evidence: pruned,
            data_fingerprint: options.data_fingerprint.clone(),
            fold_evidence: pruned_folds,
        },
        HostHpoWorkerResult::Complete {
            evidence: evaluate_host_hpo_worker_task(
                complete_task,
                &request,
                &controllers,
                &provider,
            )
            .unwrap(),
            data_fingerprint: options.data_fingerprint.clone(),
            fold_evidence: complete_folds,
        },
    ];
    let mut progress = DurableHostProgress {
        stop_after: usize::MAX,
        checkpoints: Vec::new(),
    };
    let outcome = complete_host_hpo_worker_window(
        &plan,
        &request,
        &options,
        window,
        results,
        &mut proposals,
        &mut progress,
    )
    .unwrap();
    assert_eq!(outcome.status, HostHpoSearchStatus::Completed);
    assert_eq!(proposals.told, vec![0]);
    assert_eq!(proposals.pruned, vec![1]);
    assert_eq!(outcome.result.unwrap().pruned_trials.len(), 1);
}

#[test]
fn host_hpo_owns_budget_native_scores_and_selection_without_refit() {
    struct Proposals {
        asked: u32,
        phases: Vec<Option<u32>>,
        told: Vec<(u32, f64)>,
        pruned: Vec<u32>,
        intermediates: Vec<(u32, u32, f64)>,
    }
    impl HostHpoProposalSource for Proposals {
        fn ask(&mut self, trial_index: u32) -> Result<Option<BTreeMap<String, serde_json::Value>>> {
            assert_eq!(
                trial_index as usize,
                self.told.len() + self.pruned.len(),
                "each proposal must be terminal before asking again"
            );
            self.asked += 1;
            Ok(Some(BTreeMap::from([(
                "n_components".into(),
                json!([3.0, 1.0, 2.0][trial_index as usize]),
            )])))
        }
        fn tell(&mut self, trial_index: u32, score: f64) -> Result<()> {
            self.told.push((trial_index, score));
            Ok(())
        }
        fn ask_in_phase(
            &mut self,
            trial_index: u32,
            phase_index: Option<u32>,
        ) -> Result<Option<BTreeMap<String, serde_json::Value>>> {
            self.phases.push(phase_index);
            self.ask(trial_index)
        }
        fn report_intermediate(&mut self, trial_index: u32, step: u32, score: f64) -> Result<bool> {
            self.intermediates.push((trial_index, step, score));
            Ok(trial_index == 1 && step == 0)
        }
        fn pruned(&mut self, trial_index: u32) -> Result<()> {
            self.pruned.push(trial_index);
            Ok(())
        }
    }
    struct CvOnly(VariantScoringController);
    impl RuntimeController for CvOnly {
        fn controller_id(&self) -> &ControllerId {
            self.0.controller_id()
        }
        fn invoke(&self, task: &NodeTask) -> Result<NodeResult> {
            assert_eq!(
                task.phase,
                Phase::FitCv,
                "search must never refit or predict"
            );
            self.0.invoke(task)
        }
    }
    let mut campaign = variant_scoring_campaign(vec![("base", 0.0)]);
    campaign.generation = GenerationSpec::default();
    let plan =
        build_execution_plan("plan:host_hpo:test", simple_graph(), campaign, &manifests()).unwrap();
    let mut controllers = RuntimeControllerRegistry::new();
    controllers
        .register(Box::new(MockController {
            id: ControllerId::new("controller:transform").unwrap(),
            handle: 1,
            emit_prediction: false,
        }))
        .unwrap();
    controllers
        .register(Box::new(CvOnly(VariantScoringController {
            id: ControllerId::new("controller:model").unwrap(),
            handle: 2,
            emit_targets: true,
        })))
        .unwrap();
    let provider = InMemoryDataProvider::new(ControllerId::new("controller:data").unwrap());
    let mut request = HostHpoSearchRequest {
        parameter_bindings: BTreeMap::new(),
        structural_catalogue: None,
        phase_trial_budgets: vec![1, 2],
        progressive_pruning: false,
        fold_score_reduction: None,
        target_node: NodeId::new("model:pls").unwrap(),
        trial_budget: 3,
        metric: RegressionMetricKind::Rmse,
        direction: crate::selection::MetricObjective::Minimize,
        optimizer_descriptor: BTreeMap::from([("owner".into(), json!("test-host"))]),
    };
    let mut proposals = Proposals {
        asked: 0,
        phases: Vec::new(),
        told: Vec::new(),
        pruned: Vec::new(),
        intermediates: Vec::new(),
    };
    let result = SequentialScheduler
        .execute_host_hpo_search(&plan, &controllers, &provider, &request, &mut proposals)
        .unwrap();
    assert_eq!(proposals.asked, 3);
    assert_eq!(proposals.phases, vec![Some(0), Some(1), Some(1)]);
    assert_eq!(proposals.told, vec![(0, 3.0), (1, 1.0), (2, 2.0)]);
    assert_eq!(result.selected_trial_index, 1);
    assert_eq!(result.selected_params["n_components"], json!(1.0));
    assert!(!result.portable);
    assert!(result
        .trials
        .iter()
        .all(|trial| !trial.scores.reports.is_empty()));
    assert_eq!(
        result.fold_set_fingerprint,
        stable_json_fingerprint(plan.fold_set.as_ref().unwrap()).unwrap()
    );
    assert!(!serde_json::to_value(&request)
        .unwrap()
        .as_object()
        .unwrap()
        .contains_key("fold_score_reduction"));
    request.fold_score_reduction = Some(HostHpoFoldReduction::Mean);
    let mut reduced_proposals = Proposals {
        asked: 0,
        phases: Vec::new(),
        told: Vec::new(),
        pruned: Vec::new(),
        intermediates: Vec::new(),
    };
    let reduced = SequentialScheduler
        .execute_host_hpo_search(
            &plan,
            &controllers,
            &provider,
            &request,
            &mut reduced_proposals,
        )
        .unwrap();
    assert_ne!(reduced.request_fingerprint, result.request_fingerprint);
    assert_eq!(reduced.selected_trial_index, result.selected_trial_index);
    for (trial, original) in reduced.trials.iter().zip(&result.trials) {
        assert_eq!(
            trial.objective_fold_scores.len(),
            plan.fold_set.as_ref().unwrap().folds.len()
        );
        assert_eq!(
            serde_json::to_value(&trial.scores).unwrap(),
            serde_json::to_value(&original.scores).unwrap(),
            "selection reduction cannot rewrite native per-fold/OOF reports"
        );
    }
    request.progressive_pruning = true;
    let mut pruning_proposals = Proposals {
        asked: 0,
        phases: Vec::new(),
        told: Vec::new(),
        pruned: Vec::new(),
        intermediates: Vec::new(),
    };
    let pruned = SequentialScheduler
        .execute_host_hpo_search(
            &plan,
            &controllers,
            &provider,
            &request,
            &mut pruning_proposals,
        )
        .unwrap();
    assert_eq!(pruning_proposals.asked, 3);
    assert_eq!(pruning_proposals.pruned, vec![1]);
    assert_eq!(
        pruning_proposals
            .intermediates
            .iter()
            .filter(|(trial, _, _)| *trial == 1)
            .count(),
        1
    );
    assert_eq!(pruned.trials.len(), 2);
    assert_eq!(pruned.pruned_trials.len(), 1);
    assert_eq!(pruned.pruned_trials[0].intermediate_scores.len(), 1);
    request.phase_trial_budgets = vec![1, 1];
    assert!(SequentialScheduler
        .execute_host_hpo_search(&plan, &controllers, &provider, &request, &mut proposals)
        .is_err());
    assert_eq!(
        proposals.asked, 3,
        "invalid phase budgets cannot ask or evaluate"
    );
    request.trial_budget = 0;
    assert!(SequentialScheduler
        .execute_host_hpo_search(&plan, &controllers, &provider, &request, &mut proposals)
        .is_err());
    assert_eq!(proposals.asked, 3, "invalid request cannot ask or evaluate");
}

struct DurableHostProposals {
    asked: Vec<u32>,
    told: Vec<u32>,
    failed: Vec<u32>,
}

impl HostHpoProposalSource for DurableHostProposals {
    fn ask(&mut self, trial_index: u32) -> Result<Option<BTreeMap<String, serde_json::Value>>> {
        self.asked.push(trial_index);
        Ok(Some(BTreeMap::from([(
            "n_components".into(),
            json!([1.0, 3.0, 2.0][trial_index as usize]),
        )])))
    }

    fn tell(&mut self, trial_index: u32, _score: f64) -> Result<()> {
        self.told.push(trial_index);
        Ok(())
    }

    fn fail(&mut self, trial_index: u32, _error: &str) -> Result<()> {
        self.failed.push(trial_index);
        Ok(())
    }
}

struct DurableHostProgress {
    stop_after: usize,
    checkpoints: Vec<(HostHpoCheckpoint, HostHpoSearchStatus)>,
}

impl HostHpoProgress for DurableHostProgress {
    fn checkpoint(
        &mut self,
        checkpoint: &HostHpoCheckpoint,
        status: HostHpoSearchStatus,
    ) -> Result<bool> {
        self.checkpoints.push((checkpoint.clone(), status));
        Ok(checkpoint.trials.len() < self.stop_after)
    }
}

fn durable_host_fixture(
    fail_second: bool,
) -> (
    ExecutionPlan,
    RuntimeControllerRegistry,
    InMemoryDataProvider,
    HostHpoSearchRequest,
) {
    struct Model {
        inner: VariantScoringController,
        fail_second: bool,
    }
    impl RuntimeController for Model {
        fn controller_id(&self) -> &ControllerId {
            self.inner.controller_id()
        }
        fn invoke(&self, task: &NodeTask) -> Result<NodeResult> {
            assert_eq!(task.phase, Phase::FitCv, "search cannot refit");
            if self.fail_second
                && task
                    .variant_id
                    .as_ref()
                    .is_some_and(|id| id.as_str() == "host_hpo:trial:0000000001")
            {
                return Err(DagMlError::RuntimeValidation(
                    "deliberate second trial failure".into(),
                ));
            }
            self.inner.invoke(task)
        }
    }
    let mut campaign = variant_scoring_campaign(vec![("base", 0.0)]);
    campaign.generation = GenerationSpec::default();
    let plan = build_execution_plan(
        "plan:host_hpo:durable",
        simple_graph(),
        campaign,
        &manifests(),
    )
    .unwrap();
    let mut controllers = RuntimeControllerRegistry::new();
    controllers
        .register(Box::new(MockController {
            id: ControllerId::new("controller:transform").unwrap(),
            handle: 1,
            emit_prediction: false,
        }))
        .unwrap();
    controllers
        .register(Box::new(Model {
            inner: VariantScoringController {
                id: ControllerId::new("controller:model").unwrap(),
                handle: 2,
                emit_targets: true,
            },
            fail_second,
        }))
        .unwrap();
    let provider = InMemoryDataProvider::new(ControllerId::new("controller:data").unwrap());
    let request = HostHpoSearchRequest {
        parameter_bindings: BTreeMap::new(),
        structural_catalogue: None,
        phase_trial_budgets: Vec::new(),
        progressive_pruning: false,
        target_node: NodeId::new("model:pls").unwrap(),
        trial_budget: 3,
        metric: RegressionMetricKind::Rmse,
        direction: crate::selection::MetricObjective::Minimize,
        optimizer_descriptor: BTreeMap::from([
            ("space".into(), json!({"n_components": [1, 2, 3]})),
            ("seed".into(), json!(42)),
        ]),
        fold_score_reduction: None,
    };
    (plan, controllers, provider, request)
}

#[test]
fn browser_hpo_worker_window_reduces_out_of_order_native_results() {
    let (plan, controllers, _, mut request) = durable_host_fixture(false);
    request.trial_budget = 2;
    let options = HostHpoResumeOptions {
        data_fingerprint: "browser-window-data".into(),
        checkpoint: None,
    };
    let mut proposals = DurableHostProposals {
        asked: Vec::new(),
        told: Vec::new(),
        failed: Vec::new(),
    };
    let window =
        prepare_host_hpo_worker_window(&plan, &request, &options, &mut proposals, 2).unwrap();
    assert_eq!(proposals.asked, vec![0, 1]);
    assert_eq!(window.tasks.len(), 2);
    let mut results = window
        .tasks
        .iter()
        .map(|task| {
            let provider = InMemoryDataProvider::new(ControllerId::new("controller:data").unwrap());
            HostHpoWorkerResult::Complete {
                evidence: evaluate_host_hpo_worker_task(task, &request, &controllers, &provider)
                    .unwrap(),
                data_fingerprint: options.data_fingerprint.clone(),
                fold_evidence: Vec::new(),
            }
        })
        .collect::<Vec<_>>();
    results.reverse();
    let mut tampered = results.clone();
    if let HostHpoWorkerResult::Complete { evidence, .. } = &mut tampered[0] {
        evidence.score += 1.0;
    }
    let mut progress = DurableHostProgress {
        stop_after: usize::MAX,
        checkpoints: Vec::new(),
    };
    assert!(complete_host_hpo_worker_window(
        &plan,
        &request,
        &options,
        window.clone(),
        tampered,
        &mut proposals,
        &mut progress,
    )
    .unwrap_err()
    .to_string()
    .contains("scalar/fold scores differ"));
    assert!(proposals.told.is_empty());
    assert!(progress.checkpoints.is_empty());
    let outcome = complete_host_hpo_worker_window(
        &plan,
        &request,
        &options,
        window,
        results,
        &mut proposals,
        &mut progress,
    )
    .unwrap();
    assert_eq!(outcome.status, HostHpoSearchStatus::Completed);
    assert_eq!(proposals.told, vec![0, 1]);
    assert_eq!(outcome.result.unwrap().selected_trial_index, 0);
    assert_eq!(outcome.checkpoint.unwrap().trials.len(), 2);
    assert_eq!(progress.checkpoints.len(), 2);
}

#[test]
fn host_hpo_sequential_prepares_terminal_before_optimizer_tell() {
    let (plan, controllers, provider, request) = durable_host_fixture(false);
    let prepared = Arc::new(AtomicUsize::new(0));
    struct Proposals {
        prepared: Arc<AtomicUsize>,
    }
    impl HostHpoProposalSource for Proposals {
        fn ask(&mut self, trial_index: u32) -> Result<Option<BTreeMap<String, serde_json::Value>>> {
            Ok(Some(BTreeMap::from([(
                "n_components".into(),
                json!([1.0, 3.0, 2.0][trial_index as usize]),
            )])))
        }
        fn tell(&mut self, trial_index: u32, _score: f64) -> Result<()> {
            assert_eq!(
                self.prepared.load(Ordering::SeqCst),
                trial_index as usize + 1
            );
            Ok(())
        }
    }
    struct Progress {
        prepared: Arc<AtomicUsize>,
        published: Vec<usize>,
    }
    impl HostHpoProgress for Progress {
        fn prepare_terminal(
            &mut self,
            checkpoint: &HostHpoCheckpoint,
            _status: HostHpoSearchStatus,
        ) -> Result<()> {
            checkpoint.verify_seal()?;
            self.prepared
                .store(checkpoint.trials.len(), Ordering::SeqCst);
            Ok(())
        }
        fn checkpoint(
            &mut self,
            checkpoint: &HostHpoCheckpoint,
            _status: HostHpoSearchStatus,
        ) -> Result<bool> {
            self.published.push(checkpoint.trials.len());
            Ok(true)
        }
    }
    let mut proposals = Proposals {
        prepared: prepared.clone(),
    };
    let mut progress = Progress {
        prepared,
        published: Vec::new(),
    };
    let result = SequentialScheduler
        .execute_resumable_host_hpo_search(
            &plan,
            &controllers,
            &provider,
            &request,
            &mut proposals,
            &HostHpoResumeOptions {
                data_fingerprint: "sequential-prepare".into(),
                checkpoint: None,
            },
            &mut progress,
        )
        .unwrap();
    assert_eq!(result.status, HostHpoSearchStatus::Completed);
    assert_eq!(progress.published, vec![0, 1, 2, 3]);
}

fn durable_proposals() -> DurableHostProposals {
    DurableHostProposals {
        asked: Vec::new(),
        told: Vec::new(),
        failed: Vec::new(),
    }
}

#[test]
fn host_hpo_provider_factory_keeps_candidate_handles_isolated_across_resume() {
    struct ObservedProvider {
        trial_index: u32,
        inner: InMemoryDataProvider,
        dropped: Arc<Mutex<Vec<(u32, usize, usize)>>>,
    }
    impl RuntimeDataProvider for ObservedProvider {
        fn materialize(&self, request: &DataMaterializationRequest) -> Result<HandleRef> {
            self.inner.materialize(request)
        }
        fn make_view(&self, request: &DataViewRequest) -> Result<HandleRef> {
            self.inner.make_view(request)
        }
    }
    impl Drop for ObservedProvider {
        fn drop(&mut self) {
            self.dropped.lock().unwrap().push((
                self.trial_index,
                self.inner.handle_records().len(),
                self.inner.view_records().len(),
            ));
        }
    }
    struct Factory(Arc<Mutex<Vec<(u32, usize, usize)>>>);
    impl HostHpoCandidateProviderFactory for Factory {
        fn create(&self, trial_index: u32) -> Result<Box<dyn RuntimeDataProvider + Send>> {
            Ok(Box::new(ObservedProvider {
                trial_index,
                inner: InMemoryDataProvider::new(ControllerId::new("controller:data")?),
                dropped: self.0.clone(),
            }))
        }
    }
    let (plan, controllers, provider, request) = durable_host_fixture(false);
    let observations = Arc::new(Mutex::new(Vec::new()));
    let factory = Factory(observations.clone());
    let options = HostHpoResumeOptions {
        data_fingerprint: "candidate-local-data".into(),
        checkpoint: None,
    };
    let mut progress = DurableHostProgress {
        stop_after: 1,
        checkpoints: Vec::new(),
    };
    let mut proposals = durable_proposals();
    let first = SequentialScheduler
        .execute_resumable_host_hpo_search_with_provider_factory(
            &plan,
            &controllers,
            &provider,
            &factory,
            &request,
            &mut proposals,
            &options,
            &mut progress,
        )
        .unwrap();
    assert_eq!(first.status, HostHpoSearchStatus::Cancelled);
    assert_eq!(observations.lock().unwrap().len(), 1);
    let resumed = SequentialScheduler
        .execute_resumable_host_hpo_search_with_provider_factory(
            &plan,
            &controllers,
            &provider,
            &factory,
            &request,
            &mut proposals,
            &HostHpoResumeOptions {
                data_fingerprint: "candidate-local-data".into(),
                checkpoint: first.checkpoint,
            },
            &mut DurableHostProgress {
                stop_after: usize::MAX,
                checkpoints: Vec::new(),
            },
        )
        .unwrap();
    assert_eq!(resumed.status, HostHpoSearchStatus::Completed);
    assert_eq!(proposals.asked, vec![0, 1, 2]);
    let observed = observations.lock().unwrap();
    assert_eq!(
        observed.iter().map(|entry| entry.0).collect::<Vec<_>>(),
        vec![0, 1, 2]
    );
    assert!(observed.iter().all(|entry| entry.1 == 0 && entry.2 == 0));
    assert!(provider.handle_records().is_empty());
    assert!(provider.view_records().is_empty());
}

#[test]
fn host_hpo_parallel_window_overlaps_candidates_and_tells_in_trial_order() {
    struct ProviderFactory;
    impl HostHpoCandidateProviderFactory for ProviderFactory {
        fn create(&self, _trial_index: u32) -> Result<Box<dyn RuntimeDataProvider + Send>> {
            Ok(Box::new(InMemoryDataProvider::new(ControllerId::new(
                "controller:data",
            )?)))
        }
    }
    struct SlowModel {
        inner: VariantScoringController,
        active: Arc<AtomicUsize>,
        maximum: Arc<AtomicUsize>,
    }
    impl RuntimeController for SlowModel {
        fn controller_id(&self) -> &ControllerId {
            self.inner.controller_id()
        }
        fn invoke(&self, task: &NodeTask) -> Result<NodeResult> {
            let current = self.active.fetch_add(1, Ordering::SeqCst) + 1;
            self.maximum.fetch_max(current, Ordering::SeqCst);
            std::thread::sleep(std::time::Duration::from_millis(25));
            let result = self.inner.invoke(task);
            self.active.fetch_sub(1, Ordering::SeqCst);
            result
        }
    }
    struct ControllerFactory {
        active: Arc<AtomicUsize>,
        maximum: Arc<AtomicUsize>,
    }
    impl HostHpoCandidateControllerFactory for ControllerFactory {
        fn create(&self, _trial_index: u32) -> Result<RuntimeControllerRegistry> {
            let mut registry = RuntimeControllerRegistry::new();
            registry.register(Box::new(MockController {
                id: ControllerId::new("controller:transform")?,
                handle: 1,
                emit_prediction: false,
            }))?;
            registry.register(Box::new(SlowModel {
                inner: VariantScoringController {
                    id: ControllerId::new("controller:model")?,
                    handle: 2,
                    emit_targets: true,
                },
                active: self.active.clone(),
                maximum: self.maximum.clone(),
            }))?;
            Ok(registry)
        }
    }
    struct OrderedProposals(Vec<String>);
    impl HostHpoProposalSource for OrderedProposals {
        fn ask(&mut self, index: u32) -> Result<Option<BTreeMap<String, serde_json::Value>>> {
            self.0.push(format!("ask:{index}"));
            Ok(Some(BTreeMap::from([(
                "n_components".into(),
                json!((index + 1) as f64),
            )])))
        }
        fn tell(&mut self, index: u32, _score: f64) -> Result<()> {
            self.0.push(format!("tell:{index}"));
            Ok(())
        }
        fn report_intermediate(&mut self, index: u32, step: u32, _score: f64) -> Result<bool> {
            self.0.push(format!("fold:{index}:{step}"));
            Ok(index == 1 && step == 0)
        }
    }
    let (plan, _controllers, _provider, request) = durable_host_fixture(false);
    let active = Arc::new(AtomicUsize::new(0));
    let maximum = Arc::new(AtomicUsize::new(0));
    let controller_factory = ControllerFactory {
        active,
        maximum: maximum.clone(),
    };
    let mut proposals = OrderedProposals(Vec::new());
    let result = SequentialScheduler
        .execute_parallel_host_hpo_search_with_candidate_factories(
            &plan,
            &ProviderFactory,
            &controller_factory,
            &request,
            &mut proposals,
            2,
        )
        .unwrap();
    assert!(
        maximum.load(Ordering::SeqCst) >= 2,
        "FIT_CV candidates did not overlap"
    );
    assert_eq!(
        proposals.0,
        vec!["ask:0", "ask:1", "tell:0", "tell:1", "ask:2", "tell:2"]
    );
    assert_eq!(result.trials.len(), 3);
    assert_eq!(result.selected_trial_index, 0);

    struct PreparedProgress {
        prepared: Vec<usize>,
        published: Vec<usize>,
        cancel_after_first: bool,
    }
    impl HostHpoProgress for PreparedProgress {
        fn prepare_terminal(
            &mut self,
            checkpoint: &HostHpoCheckpoint,
            _status: HostHpoSearchStatus,
        ) -> Result<()> {
            self.prepared.push(checkpoint.trials.len());
            Ok(())
        }
        fn checkpoint(
            &mut self,
            checkpoint: &HostHpoCheckpoint,
            _status: HostHpoSearchStatus,
        ) -> Result<bool> {
            self.published.push(checkpoint.trials.len());
            Ok(!(self.cancel_after_first && checkpoint.trials.len() == 1))
        }
    }
    let mut pruning_request = request.clone();
    pruning_request.progressive_pruning = true;
    pruning_request.fold_score_reduction = Some(HostHpoFoldReduction::Mean);
    let options = HostHpoResumeOptions {
        data_fingerprint: "parallel-pruning-data".into(),
        checkpoint: None,
    };
    let mut progress = PreparedProgress {
        prepared: Vec::new(),
        published: Vec::new(),
        cancel_after_first: true,
    };
    let mut proposals = OrderedProposals(Vec::new());
    let first = SequentialScheduler
        .execute_resumable_parallel_host_hpo_search_with_candidate_factories(
            &plan,
            &ProviderFactory,
            &controller_factory,
            &pruning_request,
            &mut proposals,
            2,
            &options,
            &mut progress,
        )
        .unwrap();
    assert_eq!(first.status, HostHpoSearchStatus::Cancelled);
    assert_eq!(first.checkpoint.as_ref().unwrap().trials.len(), 2);
    assert_eq!(progress.prepared, vec![1, 2]);
    assert_eq!(progress.published, vec![0, 1, 2, 2]);
    assert_eq!(first.result.as_ref().unwrap().pruned_trials.len(), 1);
    assert!(proposals.0.contains(&"fold:0:0".to_string()));
    assert!(proposals.0.contains(&"fold:1:0".to_string()));
    assert_eq!(
        proposals
            .0
            .iter()
            .filter(|event| *event == "fold:1:1")
            .count(),
        0
    );
    let resumed = SequentialScheduler
        .execute_resumable_parallel_host_hpo_search_with_candidate_factories(
            &plan,
            &ProviderFactory,
            &controller_factory,
            &pruning_request,
            &mut proposals,
            2,
            &HostHpoResumeOptions {
                data_fingerprint: "parallel-pruning-data".into(),
                checkpoint: first.checkpoint,
            },
            &mut PreparedProgress {
                prepared: Vec::new(),
                published: Vec::new(),
                cancel_after_first: false,
            },
        )
        .unwrap();
    assert_eq!(resumed.status, HostHpoSearchStatus::Completed);
    assert_eq!(resumed.checkpoint.unwrap().trials.len(), 3);
    assert!(maximum.load(Ordering::SeqCst) >= 2);
}

#[test]
fn host_hpo_parallel_seals_one_batch_manifest_for_success_and_failure() {
    struct ProviderFactory;
    impl HostHpoCandidateProviderFactory for ProviderFactory {
        fn create(&self, _trial_index: u32) -> Result<Box<dyn RuntimeDataProvider + Send>> {
            Ok(Box::new(InMemoryDataProvider::new(ControllerId::new(
                "controller:data",
            )?)))
        }

        fn batch_generated_view_manifest(
            &self,
            _has_success: bool,
        ) -> Result<Option<serde_json::Value>> {
            Ok(Some(json!({"batch_receipts": ["trial:0", "trial:1"]})))
        }
    }
    struct Model {
        inner: VariantScoringController,
        fail: bool,
    }
    impl RuntimeController for Model {
        fn controller_id(&self) -> &ControllerId {
            self.inner.controller_id()
        }
        fn invoke(&self, task: &NodeTask) -> Result<NodeResult> {
            if self.fail {
                return Err(DagMlError::RuntimeValidation(
                    "deliberate parallel candidate failure".into(),
                ));
            }
            self.inner.invoke(task)
        }
    }
    struct ControllerFactory;
    impl HostHpoCandidateControllerFactory for ControllerFactory {
        fn create(&self, trial_index: u32) -> Result<RuntimeControllerRegistry> {
            let mut registry = RuntimeControllerRegistry::new();
            registry.register(Box::new(MockController {
                id: ControllerId::new("controller:transform")?,
                handle: 1,
                emit_prediction: false,
            }))?;
            registry.register(Box::new(Model {
                inner: VariantScoringController {
                    id: ControllerId::new("controller:model")?,
                    handle: 2,
                    emit_targets: true,
                },
                fail: trial_index == 1,
            }))?;
            Ok(registry)
        }
    }

    let (plan, _, _, mut request) = durable_host_fixture(false);
    request.trial_budget = 2;
    let mut progress = DurableHostProgress {
        stop_after: usize::MAX,
        checkpoints: Vec::new(),
    };
    let error = SequentialScheduler
        .execute_resumable_parallel_host_hpo_search_with_candidate_factories(
            &plan,
            &ProviderFactory,
            &ControllerFactory,
            &request,
            &mut durable_proposals(),
            2,
            &HostHpoResumeOptions {
                data_fingerprint: "parallel-generated-batch".into(),
                checkpoint: None,
            },
            &mut progress,
        )
        .unwrap_err();
    assert!(error
        .to_string()
        .contains("deliberate parallel candidate failure"));
    let checkpoint = &progress.checkpoints.last().unwrap().0;
    checkpoint.verify_seal().unwrap();
    assert_eq!(checkpoint.trials.len(), 2);
    let expected = Some(json!({"batch_receipts": ["trial:0", "trial:1"]}));
    let first = match &checkpoint.trials[0] {
        HostHpoTerminalTrial::Complete { evidence } => &evidence.generated_view_manifest,
        other => panic!("expected complete first candidate, got {other:?}"),
    };
    let second = match &checkpoint.trials[1] {
        HostHpoTerminalTrial::Failed {
            generated_view_manifest,
            ..
        } => generated_view_manifest,
        other => panic!("expected failed second candidate, got {other:?}"),
    };
    assert_eq!(first, &expected);
    assert_eq!(second, &expected);
}

mod typed_parallel_profile_tests {
    use super::*;

    struct ProviderFactory;
    impl HostHpoCandidateProviderFactory for ProviderFactory {
        fn create(&self, _: u32) -> Result<Box<dyn RuntimeDataProvider + Send>> {
            Ok(Box::new(InMemoryDataProvider::new(ControllerId::new(
                "controller:data",
            )?)))
        }
    }

    struct Model {
        inner: VariantScoringController,
        trial: u32,
        first_wave: u32,
        barrier: Arc<std::sync::Barrier>,
        active: Arc<AtomicUsize>,
        maximum: Arc<AtomicUsize>,
        dropped: Arc<AtomicUsize>,
        failure: Option<&'static str>,
    }
    impl Drop for Model {
        fn drop(&mut self) {
            self.dropped.fetch_add(1, Ordering::SeqCst);
        }
    }
    impl RuntimeController for Model {
        fn controller_id(&self) -> &ControllerId {
            self.inner.controller_id()
        }
        fn invoke(&self, task: &NodeTask) -> Result<NodeResult> {
            let resources = task
                .resources
                .as_ref()
                .expect("admitted native task resources");
            assert_eq!(resources.cpu_threads, 1);
            assert!(resources.gpu_devices.is_empty());
            struct Active<'a>(&'a AtomicUsize);
            impl Drop for Active<'_> {
                fn drop(&mut self) {
                    self.0.fetch_sub(1, Ordering::SeqCst);
                }
            }
            let active = self.active.fetch_add(1, Ordering::SeqCst) + 1;
            self.maximum.fetch_max(active, Ordering::SeqCst);
            let _active = Active(&self.active);
            if self.trial < self.first_wave
                && task
                    .fold_id
                    .as_ref()
                    .is_some_and(|fold| fold.as_str() == "fold:0")
            {
                self.barrier.wait();
            }
            if self.trial == 0 {
                match self.failure {
                    Some("panic") => panic!("typed profile candidate panic"),
                    Some("failure") => {
                        return Err(DagMlError::RuntimeValidation(
                            "typed profile candidate failure".into(),
                        ))
                    }
                    _ => {}
                }
            }
            self.inner.invoke(task)
        }
    }
    struct ControllerFactory {
        barrier: Arc<std::sync::Barrier>,
        first_wave: u32,
        active: Arc<AtomicUsize>,
        maximum: Arc<AtomicUsize>,
        created: Arc<AtomicUsize>,
        dropped: Arc<AtomicUsize>,
        trials: Arc<Mutex<Vec<u32>>>,
        failure: Option<&'static str>,
    }
    impl HostHpoCandidateControllerFactory for ControllerFactory {
        fn create(&self, trial: u32) -> Result<RuntimeControllerRegistry> {
            self.trials.lock().unwrap().push(trial);
            let mut registry = RuntimeControllerRegistry::new();
            registry.register(Box::new(MockController {
                id: ControllerId::new("controller:transform")?,
                handle: 1,
                emit_prediction: false,
            }))?;
            registry.register(Box::new(Model {
                inner: VariantScoringController {
                    id: ControllerId::new("controller:model")?,
                    handle: 2,
                    emit_targets: true,
                },
                trial,
                first_wave: self.first_wave,
                barrier: self.barrier.clone(),
                active: self.active.clone(),
                maximum: self.maximum.clone(),
                dropped: self.dropped.clone(),
                failure: self.failure,
            }))?;
            self.created.fetch_add(1, Ordering::SeqCst);
            Ok(registry)
        }
    }
    #[derive(Default)]
    struct Proposals {
        asked: Vec<u32>,
        terminals: Vec<(u32, &'static str)>,
    }
    impl HostHpoProposalSource for Proposals {
        fn ask(&mut self, trial: u32) -> Result<Option<BTreeMap<String, serde_json::Value>>> {
            self.asked.push(trial);
            Ok(Some(BTreeMap::from([(
                "n_components".into(),
                json!(trial + 1),
            )])))
        }
        fn tell(&mut self, trial: u32, _: f64) -> Result<()> {
            self.terminals.push((trial, "complete"));
            Ok(())
        }
        fn fail(&mut self, trial: u32, _: &str) -> Result<()> {
            self.terminals.push((trial, "failed"));
            Ok(())
        }
    }
    struct Progress {
        active: Arc<AtomicUsize>,
        created: Arc<AtomicUsize>,
        dropped: Arc<AtomicUsize>,
        stop_after: Option<usize>,
        checkpoints: Vec<HostHpoCheckpoint>,
    }
    impl HostHpoProgress for Progress {
        fn prepare_terminal(
            &mut self,
            _: &HostHpoCheckpoint,
            _: HostHpoSearchStatus,
        ) -> Result<()> {
            assert_eq!(self.active.load(Ordering::SeqCst), 0);
            assert_eq!(
                self.created.load(Ordering::SeqCst),
                self.dropped.load(Ordering::SeqCst)
            );
            Ok(())
        }
        fn checkpoint(
            &mut self,
            checkpoint: &HostHpoCheckpoint,
            _: HostHpoSearchStatus,
        ) -> Result<bool> {
            self.prepare_terminal(checkpoint, HostHpoSearchStatus::Running)?;
            self.checkpoints.push(checkpoint.clone());
            Ok(self
                .stop_after
                .is_none_or(|limit| checkpoint.trials.len() < limit))
        }
    }

    fn run_case(budget: u32, workers: usize, cancel: bool, failure: Option<&'static str>) {
        let (plan, _, _, mut request) = durable_host_fixture(false);
        request.trial_budget = budget;
        request.optimizer_descriptor.extend(serde_json::from_value::<BTreeMap<String, serde_json::Value>>(json!({
            "n_jobs":workers, "sampler":"random", "pruner":null,
            "parallel_execution":{"schema_version":1, "profile":"methods_sequential_cpu_v1",
                "workers":workers, "cpu_threads":1, "gpu_devices":[],
                "methods_build":{"schema_version":1, "blas":false, "openmp":false, "cuda":false}}
        })).unwrap());
        let first_wave = workers.min(budget as usize);
        let factory = ControllerFactory {
            barrier: Arc::new(std::sync::Barrier::new(first_wave)),
            first_wave: first_wave as u32,
            active: Arc::new(AtomicUsize::new(0)),
            maximum: Arc::new(AtomicUsize::new(0)),
            created: Arc::new(AtomicUsize::new(0)),
            dropped: Arc::new(AtomicUsize::new(0)),
            trials: Arc::new(Mutex::new(Vec::new())),
            failure,
        };
        let mut progress = Progress {
            active: factory.active.clone(),
            created: factory.created.clone(),
            dropped: factory.dropped.clone(),
            stop_after: cancel.then_some(1),
            checkpoints: Vec::new(),
        };
        let mut proposals = Proposals::default();
        let options = HostHpoResumeOptions {
            data_fingerprint: "typed:profile:cohort".into(),
            checkpoint: None,
        };
        let result = SequentialScheduler
            .execute_resumable_parallel_host_hpo_search_with_candidate_factories(
                &plan,
                &ProviderFactory,
                &factory,
                &request,
                &mut proposals,
                workers,
                &options,
                &mut progress,
            );
        assert_eq!(factory.active.load(Ordering::SeqCst), 0);
        assert_eq!(
            factory.created.load(Ordering::SeqCst),
            factory.dropped.load(Ordering::SeqCst)
        );
        assert!(factory.maximum.load(Ordering::SeqCst) >= first_wave);
        if let Some(failure) = failure {
            let error = result.unwrap_err().to_string();
            assert!(error.contains(if failure == "panic" {
                "worker panicked"
            } else {
                "candidate failure"
            }));
            let saved = progress.checkpoints.last().unwrap();
            saved.verify_seal().unwrap();
            assert_eq!(saved.trials.len(), first_wave);
            assert!(matches!(
                &saved.trials[0],
                HostHpoTerminalTrial::Failed { .. }
            ));
            assert!(matches!(
                &saved.trials[1],
                HostHpoTerminalTrial::Complete { .. }
            ));
            assert_eq!(proposals.terminals, vec![(0, "failed"), (1, "complete")]);
            return;
        }
        let first = result.unwrap();
        if cancel {
            assert_eq!(first.status, HostHpoSearchStatus::Cancelled);
            assert_eq!(first.checkpoint.as_ref().unwrap().trials.len(), first_wave);
            progress.stop_after = None;
            let resumed = SequentialScheduler
                .execute_resumable_parallel_host_hpo_search_with_candidate_factories(
                    &plan,
                    &ProviderFactory,
                    &factory,
                    &request,
                    &mut proposals,
                    workers,
                    &HostHpoResumeOptions {
                        checkpoint: first.checkpoint,
                        data_fingerprint: options.data_fingerprint,
                    },
                    &mut progress,
                )
                .unwrap();
            assert_eq!(resumed.status, HostHpoSearchStatus::Completed);
            assert_eq!(resumed.checkpoint.unwrap().trials.len(), budget as usize);
        } else {
            assert_eq!(first.status, HostHpoSearchStatus::Completed);
            assert_eq!(first.checkpoint.unwrap().trials.len(), budget as usize);
        }
        assert_eq!(proposals.asked, (0..budget).collect::<Vec<_>>());
        assert_eq!(
            proposals.terminals,
            (0..budget)
                .map(|index| (index, "complete"))
                .collect::<Vec<_>>()
        );
        assert_eq!(
            *factory.trials.lock().unwrap(),
            (0..budget).collect::<Vec<_>>()
        );
        assert_eq!(factory.created.load(Ordering::SeqCst), budget as usize);
        assert_eq!(factory.dropped.load(Ordering::SeqCst), budget as usize);
    }

    #[test]
    fn bounded_profile_joins_partial_windows_and_resumes_after_cancellation() {
        for (budget, workers, cancel) in [(1, 4, false), (3, 2, false), (5, 4, false), (5, 2, true)]
        {
            run_case(budget, workers, cancel, None);
        }
    }

    #[test]
    fn bounded_profile_failure_and_panic_preserve_sibling_terminal_and_drop_owners() {
        for failure in ["failure", "panic"] {
            run_case(3, 2, false, Some(failure));
        }
    }
}

#[test]
fn host_hpo_durable_masked_regression_resumes_with_native_scores_and_unchanged_selection() {
    struct MaskedModel {
        inner: VariantScoringController,
        hidden: f64,
    }
    impl RuntimeController for MaskedModel {
        fn controller_id(&self) -> &ControllerId {
            self.inner.controller_id()
        }
        fn invoke(&self, task: &NodeTask) -> Result<NodeResult> {
            let mut result = self.inner.invoke(task)?;
            let hidden_id = SampleId::new(if task.fold_id.as_ref().unwrap().as_str() == "fold:0" {
                "s3"
            } else {
                "s4"
            })
            .unwrap();
            let prediction = &mut result.predictions[0];
            prediction.sample_ids.push(hidden_id.clone());
            prediction.values.push(vec![1e10]);
            let targets = &mut result.regression_targets[0];
            targets
                .unit_ids
                .push(crate::aggregation::PredictionUnitId::Sample(hidden_id));
            targets.values.push(vec![self.hidden]);
            targets.validity_masks = Some(vec![vec![true], vec![false]]);
            Ok(result)
        }
    }
    let (base_plan, _, provider, request) = durable_host_fixture(false);
    let mut campaign = base_plan.campaign.clone();
    let folds = campaign
        .split_invocation
        .as_mut()
        .unwrap()
        .fold_set
        .as_mut()
        .unwrap();
    let s3 = SampleId::new("s3").unwrap();
    let s4 = SampleId::new("s4").unwrap();
    folds.sample_ids.extend([s3.clone(), s4.clone()]);
    folds.folds[0].validation_sample_ids.push(s3.clone());
    folds.folds[0].train_sample_ids.push(s4.clone());
    folds.folds[1].validation_sample_ids.push(s4);
    folds.folds[1].train_sample_ids.push(s3);
    let plan = build_execution_plan(
        "plan:host_hpo:masked",
        simple_graph(),
        campaign,
        &manifests(),
    )
    .unwrap();
    let controllers = |hidden| {
        let mut registry = RuntimeControllerRegistry::new();
        registry
            .register(Box::new(MockController {
                id: ControllerId::new("controller:transform").unwrap(),
                handle: 1,
                emit_prediction: false,
            }))
            .unwrap();
        registry
            .register(Box::new(MaskedModel {
                inner: VariantScoringController {
                    id: ControllerId::new("controller:model").unwrap(),
                    handle: 2,
                    emit_targets: true,
                },
                hidden,
            }))
            .unwrap();
        registry
    };
    let mut progress = DurableHostProgress {
        stop_after: 1,
        checkpoints: Vec::new(),
    };
    let mut proposals = durable_proposals();
    let options = HostHpoResumeOptions {
        data_fingerprint: "observed-targets-and-mask".into(),
        checkpoint: None,
    };
    let first = SequentialScheduler
        .execute_resumable_host_hpo_search(
            &plan,
            &controllers(42.0),
            &provider,
            &request,
            &mut proposals,
            &options,
            &mut progress,
        )
        .unwrap();
    assert_eq!(first.status, HostHpoSearchStatus::Cancelled);
    let checkpoint =
        serde_json::from_value(serde_json::to_value(first.checkpoint.unwrap()).unwrap()).unwrap();
    let mut resumed_proposals = durable_proposals();
    progress.stop_after = usize::MAX;
    let resumed = SequentialScheduler
        .execute_resumable_host_hpo_search(
            &plan,
            &controllers(-1e100),
            &provider,
            &request,
            &mut resumed_proposals,
            &HostHpoResumeOptions {
                checkpoint: Some(checkpoint),
                data_fingerprint: options.data_fingerprint.clone(),
            },
            &mut progress,
        )
        .unwrap();
    assert_eq!(resumed_proposals.asked, [1, 2]);
    let continuous = SequentialScheduler
        .execute_resumable_host_hpo_search(
            &plan,
            &controllers(1e100),
            &provider,
            &request,
            &mut durable_proposals(),
            &options,
            &mut progress,
        )
        .unwrap();
    let resumed = resumed.result.unwrap();
    assert_eq!(
        serde_json::to_value(&resumed).unwrap(),
        serde_json::to_value(continuous.result.unwrap()).unwrap()
    );
    assert_eq!(resumed.selected_trial_index, 0);
    for trial in &resumed.trials {
        let average = trial
            .scores
            .reports
            .iter()
            .find(|report| report.fold_id.as_ref().unwrap().as_str() == "avg")
            .unwrap();
        assert_eq!(
            average.row_count, 4,
            "hidden labels do not remove OOF predictions"
        );
    }
}

#[test]
fn captured_masked_targets_realign_masks_with_sample_ids() {
    let ids = [SampleId::new("s1").unwrap(), SampleId::new("s2").unwrap()];
    let targets = RegressionTargetBlock {
        level: PredictionLevel::Sample,
        unit_ids: ids
            .iter()
            .rev()
            .cloned()
            .map(crate::aggregation::PredictionUnitId::Sample)
            .collect(),
        values: vec![vec![0.0, 2.0], vec![1.0, 0.0]],
        validity_masks: Some(vec![vec![false, true], vec![true, false]]),
        target_names: vec!["a".into(), "b".into()],
    };
    let aligned = target_block_aligned_to_samples(&ids, &targets);
    assert_eq!(aligned.values, vec![vec![1.0, 0.0], vec![0.0, 2.0]]);
    assert_eq!(
        aligned.validity_masks,
        Some(vec![vec![true, false], vec![false, true]])
    );
}

#[test]
fn host_hpo_durable_cancel_resume_preserves_old_winner_and_total_budget() {
    let (plan, controllers, provider, mut request) = durable_host_fixture(false);
    let options = HostHpoResumeOptions {
        data_fingerprint: "data:with-relations".into(),
        checkpoint: None,
    };
    let mut first = durable_proposals();
    let mut progress = DurableHostProgress {
        stop_after: 1,
        checkpoints: Vec::new(),
    };
    let interrupted = SequentialScheduler
        .execute_resumable_host_hpo_search(
            &plan,
            &controllers,
            &provider,
            &request,
            &mut first,
            &options,
            &mut progress,
        )
        .unwrap();
    assert_eq!(interrupted.status, HostHpoSearchStatus::Cancelled);
    assert_eq!(first.asked, [0]);
    assert_eq!(first.told, [0]);
    assert_eq!(
        progress.checkpoints.last().unwrap().1,
        HostHpoSearchStatus::Cancelled
    );
    let serialized = serde_json::to_value(&interrupted).unwrap();
    assert_eq!(serialized["selected_trial_index"], 0);
    let checkpoint: HostHpoCheckpoint =
        serde_json::from_value(serialized["checkpoint"].clone()).unwrap();
    let old_score_set =
        serde_json::to_value(&interrupted.result.as_ref().unwrap().trials[0].scores).unwrap();

    // A completed one-trial budget can also be extended to three.
    request.trial_budget = 1;
    let mut no_work = durable_proposals();
    let mut progress = DurableHostProgress {
        stop_after: usize::MAX,
        checkpoints: Vec::new(),
    };
    let options = HostHpoResumeOptions {
        checkpoint: Some(checkpoint),
        ..options
    };
    let completed = SequentialScheduler
        .execute_resumable_host_hpo_search(
            &plan,
            &controllers,
            &provider,
            &request,
            &mut no_work,
            &options,
            &mut progress,
        )
        .unwrap();
    assert_eq!(completed.status, HostHpoSearchStatus::Completed);
    assert!(no_work.asked.is_empty());
    request.trial_budget = 3;
    let mut resumed = durable_proposals();
    let finished = SequentialScheduler
        .execute_resumable_host_hpo_search(
            &plan,
            &controllers,
            &provider,
            &request,
            &mut resumed,
            &options,
            &mut progress,
        )
        .unwrap();
    assert_eq!(resumed.asked, [1, 2]);
    assert_eq!(resumed.told, [1, 2]);
    assert_eq!(finished.status, HostHpoSearchStatus::Completed);
    assert_eq!(finished.checkpoint.as_ref().unwrap().trials.len(), 3);
    let result = finished.result.unwrap();
    assert_eq!(
        result.selected_trial_index, 0,
        "historical winner must participate in native SELECT"
    );
    assert_eq!(
        serde_json::to_value(&result.trials[0].scores).unwrap(),
        old_score_set
    );
    assert_eq!(
        result
            .trials
            .iter()
            .map(|trial| trial.trial_index)
            .collect::<Vec<_>>(),
        [0, 1, 2]
    );

    let mut uninterrupted = durable_proposals();
    let baseline = SequentialScheduler
        .execute_resumable_host_hpo_search(
            &plan,
            &controllers,
            &provider,
            &request,
            &mut uninterrupted,
            &HostHpoResumeOptions {
                checkpoint: None,
                ..options
            },
            &mut progress,
        )
        .unwrap();
    assert_eq!(
        serde_json::to_value(&result).unwrap(),
        serde_json::to_value(baseline.result.unwrap()).unwrap()
    );
}

#[test]
fn host_hpo_durable_refuses_changed_binding_corruption_and_inconsistent_scores_before_ask() {
    let (plan, controllers, provider, request) = durable_host_fixture(false);
    let mut progress = DurableHostProgress {
        stop_after: 1,
        checkpoints: Vec::new(),
    };
    let options = HostHpoResumeOptions {
        data_fingerprint: "data:A".into(),
        checkpoint: None,
    };
    let first = SequentialScheduler
        .execute_resumable_host_hpo_search(
            &plan,
            &controllers,
            &provider,
            &request,
            &mut durable_proposals(),
            &options,
            &mut progress,
        )
        .unwrap();
    let checkpoint = first.checkpoint.unwrap();
    for mutation in [
        "data",
        "space",
        "seed",
        "metric",
        "reduction",
        "graph",
        "controller",
        "campaign",
        "fold",
        "corruption",
        "indices",
        "scores",
    ] {
        let mut changed_plan = plan.clone();
        let mut changed_request = request.clone();
        let mut changed_checkpoint = checkpoint.clone();
        let mut data_fingerprint = "data:A".to_string();
        match mutation {
            "data" => data_fingerprint = "data:B".into(),
            "space" => {
                changed_request
                    .optimizer_descriptor
                    .insert("space".into(), json!({"n_components":[2,3]}));
            }
            "seed" => {
                changed_request
                    .optimizer_descriptor
                    .insert("seed".into(), json!(99));
            }
            "metric" => changed_request.metric = RegressionMetricKind::Mae,
            "reduction" => changed_request.fold_score_reduction = Some(HostHpoFoldReduction::Mean),
            "graph" => changed_checkpoint.binding.graph_fingerprint = "different".into(),
            "controller" => changed_checkpoint.binding.controller_fingerprint = "different".into(),
            "campaign" => changed_checkpoint.binding.campaign_fingerprint = "different".into(),
            "fold" => changed_checkpoint.binding.fold_set_fingerprint = "different".into(),
            "corruption" => changed_checkpoint.fingerprint = "broken".into(),
            "indices" | "scores" => {
                let HostHpoTerminalTrial::Complete { evidence } = &mut changed_checkpoint.trials[0]
                else {
                    panic!("expected success")
                };
                if mutation == "indices" {
                    evidence.trial_index = 5;
                } else {
                    evidence.score += 0.5;
                }
                // Even a recomputed integrity digest cannot bypass semantic checks.
                changed_checkpoint.fingerprint = stable_json_fingerprint(&(
                    changed_checkpoint.schema_version,
                    &changed_checkpoint.binding,
                    &changed_checkpoint.trials,
                ))
                .unwrap();
            }
            _ => unreachable!(),
        }
        // Keep the current plan itself valid; mismatches belong to checkpoint validation.
        changed_plan.id = plan.id.clone();
        let options = HostHpoResumeOptions {
            data_fingerprint,
            checkpoint: Some(changed_checkpoint),
        };
        let mut proposals = durable_proposals();
        assert!(
            SequentialScheduler
                .execute_resumable_host_hpo_search(
                    &changed_plan,
                    &controllers,
                    &provider,
                    &changed_request,
                    &mut proposals,
                    &options,
                    &mut progress
                )
                .is_err(),
            "{mutation}"
        );
        assert!(
            proposals.asked.is_empty(),
            "{mutation} cannot ask an optimizer"
        );
    }
}

#[test]
fn host_hpo_durable_records_failed_trial_and_never_replays_it() {
    let (plan, controllers, provider, request) = durable_host_fixture(true);
    let options = HostHpoResumeOptions {
        data_fingerprint: "data".into(),
        checkpoint: None,
    };
    let mut proposals = durable_proposals();
    let mut progress = DurableHostProgress {
        stop_after: usize::MAX,
        checkpoints: Vec::new(),
    };
    let failed = SequentialScheduler.execute_resumable_host_hpo_search(
        &plan,
        &controllers,
        &provider,
        &request,
        &mut proposals,
        &options,
        &mut progress,
    );
    assert!(failed
        .unwrap_err()
        .to_string()
        .contains("deliberate second trial failure"));
    assert_eq!(proposals.asked, [0, 1]);
    assert_eq!(proposals.failed, [1]);
    let (checkpoint, status) = progress.checkpoints.last().unwrap();
    assert_eq!(*status, HostHpoSearchStatus::Failed);
    assert!(matches!(
        &checkpoint.trials[1],
        HostHpoTerminalTrial::Failed { trial_index: 1, .. }
    ));
    let options = HostHpoResumeOptions {
        checkpoint: Some(checkpoint.clone()),
        ..options
    };
    let mut resumed = durable_proposals();
    let finished = SequentialScheduler
        .execute_resumable_host_hpo_search(
            &plan,
            &controllers,
            &provider,
            &request,
            &mut resumed,
            &options,
            &mut progress,
        )
        .unwrap();
    assert_eq!(resumed.asked, [2]);
    assert_eq!(finished.checkpoint.unwrap().trials.len(), 3);
    assert_eq!(finished.result.unwrap().trials.len(), 2);
}

#[test]
fn host_hpo_durable_cancel_before_first_trial_has_no_fabricated_winner() {
    let (plan, controllers, provider, request) = durable_host_fixture(false);
    let mut progress = DurableHostProgress {
        stop_after: 0,
        checkpoints: Vec::new(),
    };
    let mut proposals = durable_proposals();
    let result = SequentialScheduler
        .execute_resumable_host_hpo_search(
            &plan,
            &controllers,
            &provider,
            &request,
            &mut proposals,
            &HostHpoResumeOptions {
                data_fingerprint: "data".into(),
                checkpoint: None,
            },
            &mut progress,
        )
        .unwrap();
    assert_eq!(result.status, HostHpoSearchStatus::Cancelled);
    assert!(result.result.is_none());
    assert!(proposals.asked.is_empty());
    assert!(serde_json::to_value(result)
        .unwrap()
        .get("selected_trial_index")
        .is_none());
}

#[test]
fn host_hpo_bindings_validate_before_callbacks_and_preserve_legacy_wire() {
    let (plan, controllers, provider, request) = durable_host_fixture(false);
    let legacy = serde_json::to_value(&request).unwrap();
    assert!(legacy.get("parameter_bindings").is_none());
    let mut explicit_empty = legacy.clone();
    explicit_empty["parameter_bindings"] = json!({});
    let decoded: HostHpoSearchRequest = serde_json::from_value(explicit_empty).unwrap();
    assert_eq!(serde_json::to_value(decoded).unwrap(), legacy);

    let binding = |node: &str, path: &str| HostHpoParameterBinding {
        node_id: NodeId::new(node).unwrap(),
        param_path: path.into(),
    };
    for bindings in [
        BTreeMap::from([("alpha".into(), binding("missing", "alpha"))]),
        BTreeMap::from([(" ".into(), binding("model:pls", "alpha"))]),
        BTreeMap::from([("alpha".into(), binding("model:pls", " "))]),
        BTreeMap::from([
            ("a".into(), binding("model:pls", "alpha")),
            ("b".into(), binding("model:pls", "alpha")),
        ]),
    ] {
        let mut invalid = request.clone();
        invalid.parameter_bindings = bindings;
        let mut proposals = durable_proposals();
        let mut progress = DurableHostProgress {
            stop_after: usize::MAX,
            checkpoints: Vec::new(),
        };
        assert!(SequentialScheduler
            .execute_resumable_host_hpo_search(
                &plan,
                &controllers,
                &provider,
                &invalid,
                &mut proposals,
                &HostHpoResumeOptions {
                    data_fingerprint: "data".into(),
                    checkpoint: None
                },
                &mut progress,
            )
            .is_err());
        assert!(proposals.asked.is_empty());
        assert!(progress.checkpoints.is_empty());
    }
    let mut explicit = request.clone();
    explicit
        .parameter_bindings
        .insert("other".into(), binding("model:pls", "alpha"));
    let mut proposals = durable_proposals();
    let error = SequentialScheduler
        .execute_host_hpo_search(&plan, &controllers, &provider, &explicit, &mut proposals)
        .unwrap_err();
    assert!(error.to_string().contains("has no parameter binding"));
    assert_eq!(proposals.asked, [0]);
    assert!(proposals.told.is_empty());
}

#[test]
fn host_hpo_bindings_route_nested_stacking_and_resume_without_replaying() {
    struct Proposals {
        asked: Vec<u32>,
    }
    impl HostHpoProposalSource for Proposals {
        fn ask(&mut self, index: u32) -> Result<Option<BTreeMap<String, serde_json::Value>>> {
            self.asked.push(index);
            Ok(Some(BTreeMap::from([
                ("branches.a.alpha".into(), json!(index + 1)),
                ("branches.b.alpha".into(), json!(10 * (index + 1))),
                ("meta.alpha".into(), json!(100 * (index + 1))),
            ])))
        }
        fn tell(&mut self, _: u32, _: f64) -> Result<()> {
            Ok(())
        }
    }
    struct NestedModel {
        inner: VariantScoringController,
        folds: BTreeMap<FoldId, FoldAssignment>,
        calls: Arc<Mutex<Vec<(String, String)>>>,
    }
    impl RuntimeController for NestedModel {
        fn controller_id(&self) -> &ControllerId {
            self.inner.controller_id()
        }
        fn invoke(&self, task: &NodeTask) -> Result<NodeResult> {
            assert_eq!(task.phase, Phase::FitCv);
            let fold = &self.folds[task.fold_id.as_ref().unwrap()];
            let node = task.node_plan.node_id.as_str();
            let alpha = task.node_plan.params["alpha"].as_f64().unwrap();
            let index = task
                .variant_id
                .as_ref()
                .unwrap()
                .as_str()
                .rsplit(':')
                .next()
                .unwrap()
                .parse::<u32>()
                .unwrap();
            let scale = match node {
                "model:base.a" => 1,
                "model:base.b" => 10,
                _ => 100,
            };
            assert_eq!(alpha, f64::from(scale * (index + 1)));
            self.calls
                .lock()
                .unwrap()
                .push((node.into(), fold.fold_id.to_string()));
            if node == "model:meta" {
                assert_eq!(task.prediction_inputs.len(), 4);
                for (key, input) in &task.prediction_inputs {
                    if key.ends_with(":outer") {
                        assert_eq!(input.sample_ids, fold.validation_sample_ids);
                    } else {
                        assert_eq!(input.sample_ids, fold.train_sample_ids);
                        assert!(input
                            .sample_ids
                            .iter()
                            .all(|id| !fold.validation_sample_ids.contains(id)));
                        assert!(input.fold_ids.iter().all(|id| id != &fold.fold_id));
                    }
                    let base_scale = if key.contains("base.a") { 1 } else { 10 };
                    assert!(input
                        .values
                        .iter()
                        .all(|row| row == &vec![f64::from(base_scale * (index + 1))]));
                }
            }
            let mut result = self.inner.invoke(task)?;
            result.predictions = vec![PredictionBlock {
                prediction_id: Some(format!("pred:{node}:{}", fold.fold_id)),
                producer_node: task.node_plan.node_id.clone(),
                producer_port: Some("pred".into()),
                partition: PredictionPartition::Validation,
                fold_id: Some(fold.fold_id.clone()),
                sample_ids: fold.validation_sample_ids.clone(),
                values: vec![vec![alpha]; fold.validation_sample_ids.len()],
                target_names: vec!["y".into()],
            }];
            result.regression_targets = vec![RegressionTargetBlock {
                level: PredictionLevel::Sample,
                unit_ids: fold
                    .validation_sample_ids
                    .iter()
                    .cloned()
                    .map(crate::aggregation::PredictionUnitId::Sample)
                    .collect(),
                values: vec![vec![0.0]; fold.validation_sample_ids.len()],
                validity_masks: None,
                target_names: vec!["y".into()],
            }];
            Ok(result)
        }
    }
    let samples = (1..=6)
        .map(|i| SampleId::new(format!("s{i}")).unwrap())
        .collect::<Vec<_>>();
    let outer = crate::fold::KFoldSpec {
        n_splits: 3,
        shuffle: false,
        seed: Some(7),
    }
    .split("outer", &samples)
    .unwrap();
    let plan = nested_stacking_test_plan(outer.clone(), false);
    let nested = nested_stacking_campaign_plan(&plan).unwrap().unwrap();
    let folds = outer
        .folds
        .iter()
        .chain(
            nested
                .outer_scopes
                .iter()
                .flat_map(|scope| &scope.inner.inner_fold_set.folds),
        )
        .map(|fold| (fold.fold_id.clone(), fold.clone()))
        .collect();
    let calls = Arc::new(Mutex::new(Vec::new()));
    let mut controllers = RuntimeControllerRegistry::new();
    controllers
        .register(Box::new(NestedModel {
            inner: VariantScoringController {
                id: ControllerId::new("controller:model").unwrap(),
                handle: 1,
                emit_targets: true,
            },
            folds,
            calls: calls.clone(),
        }))
        .unwrap();
    let provider = InMemoryDataProvider::new(ControllerId::new("controller:data").unwrap());
    let (_, _, _, mut request) = durable_host_fixture(false);
    request.target_node = NodeId::new("model:meta").unwrap();
    request.fold_score_reduction = Some(HostHpoFoldReduction::Mean);
    request.parameter_bindings = [
        ("branches.a.alpha", "model:base.a"),
        ("branches.b.alpha", "model:base.b"),
        ("meta.alpha", "model:meta"),
    ]
    .into_iter()
    .map(|(path, node)| {
        (
            path.into(),
            HostHpoParameterBinding {
                node_id: NodeId::new(node).unwrap(),
                param_path: "alpha".into(),
            },
        )
    })
    .collect();
    let options = HostHpoResumeOptions {
        data_fingerprint: "nested:data".into(),
        checkpoint: None,
    };
    let mut progress = DurableHostProgress {
        stop_after: 1,
        checkpoints: Vec::new(),
    };
    let first = SequentialScheduler
        .execute_resumable_host_hpo_search(
            &plan,
            &controllers,
            &provider,
            &request,
            &mut Proposals { asked: Vec::new() },
            &options,
            &mut progress,
        )
        .unwrap();
    assert_eq!(first.status, HostHpoSearchStatus::Cancelled);
    assert_eq!(
        calls.lock().unwrap().len(),
        21,
        "2 bases × (2 inner + 1 outer) × 3 folds + 3 meta fits"
    );
    let options = HostHpoResumeOptions {
        checkpoint: first.checkpoint,
        ..options
    };
    let mut changed = request.clone();
    changed
        .parameter_bindings
        .get_mut("branches.a.alpha")
        .unwrap()
        .param_path = "beta".into();
    let mut rejected = Proposals { asked: Vec::new() };
    assert!(SequentialScheduler
        .execute_resumable_host_hpo_search(
            &plan,
            &controllers,
            &provider,
            &changed,
            &mut rejected,
            &options,
            &mut progress,
        )
        .unwrap_err()
        .to_string()
        .contains("binding mismatch"));
    assert!(rejected.asked.is_empty());
    assert_eq!(calls.lock().unwrap().len(), 21);
    progress.stop_after = usize::MAX;
    let mut resumed = Proposals { asked: Vec::new() };
    let result = SequentialScheduler
        .execute_resumable_host_hpo_search(
            &plan,
            &controllers,
            &provider,
            &request,
            &mut resumed,
            &options,
            &mut progress,
        )
        .unwrap()
        .result
        .unwrap();
    assert_eq!(resumed.asked, [1, 2]);
    assert_eq!(calls.lock().unwrap().len(), 63);
    assert_eq!(result.selected_trial_index, 0);
    assert_eq!(
        result.trials.iter().map(|t| t.score).collect::<Vec<_>>(),
        [100.0, 200.0, 300.0]
    );
    assert_eq!(result.selected_params["branches.b.alpha"], json!(10));
    let baseline = SequentialScheduler
        .execute_resumable_host_hpo_search(
            &plan,
            &controllers,
            &provider,
            &request,
            &mut Proposals { asked: Vec::new() },
            &HostHpoResumeOptions {
                checkpoint: None,
                ..options
            },
            &mut progress,
        )
        .unwrap()
        .result
        .unwrap();
    assert_eq!(
        serde_json::to_value(result).unwrap(),
        serde_json::to_value(baseline).unwrap()
    );
}

fn multi_port_model_graph() -> GraphSpec {
    let mut graph = simple_graph();
    graph.id = "g:multi.port.model".to_string();
    let model = graph
        .nodes
        .iter_mut()
        .find(|node| node.id.as_str() == "model:pls")
        .unwrap();
    model.ports.outputs = vec![
        port("pred", PortKind::Prediction),
        port("aux", PortKind::Prediction),
    ];
    graph
}

struct MultiPortVariantScoringController {
    id: ControllerId,
    handle: u64,
}

impl RuntimeController for MultiPortVariantScoringController {
    fn controller_id(&self) -> &ControllerId {
        &self.id
    }

    fn invoke(&self, task: &NodeTask) -> Result<NodeResult> {
        let output = HandleRef {
            handle: self.handle,
            kind: HandleKind::Data,
            owner_controller: self.id.clone(),
        };
        let mut predictions = Vec::new();
        let mut regression_targets = Vec::new();
        if let Some((sample_id, y_true)) = VariantScoringController::fold_sample(task) {
            let pred_offset = task
                .node_plan
                .params
                .get("n_components")
                .and_then(serde_json::Value::as_f64)
                .unwrap_or(0.0);
            let aux_offset = if pred_offset == 0.0 { 10.0 } else { 0.0 };
            for (port_name, offset) in [("pred", pred_offset), ("aux", aux_offset)] {
                predictions.push(PredictionBlock {
                    prediction_id: Some(format!("pred:{}:{port_name}", task.node_plan.node_id)),
                    producer_node: task.node_plan.node_id.clone(),
                    producer_port: Some(port_name.to_string()),
                    partition: PredictionPartition::Validation,
                    fold_id: task.fold_id.clone(),
                    sample_ids: vec![sample_id.clone()],
                    values: vec![vec![y_true + offset]],
                    target_names: vec!["y".to_string()],
                });
            }
            regression_targets.push(crate::metrics::RegressionTargetBlock {
                validity_masks: None,
                level: PredictionLevel::Sample,
                unit_ids: vec![crate::aggregation::PredictionUnitId::Sample(sample_id)],
                values: vec![vec![y_true]],
                target_names: vec!["y".to_string()],
            });
        }
        let variant_label = task
            .variant_id
            .as_ref()
            .map(ToString::to_string)
            .unwrap_or_else(|| "base".to_string());
        let fold_label = task
            .fold_id
            .as_ref()
            .map(ToString::to_string)
            .unwrap_or_else(|| "nofold".to_string());
        Ok(NodeResult {
            schema_version: None,
            classification_probabilities: Vec::new(),
            consumed_data_views: std::collections::BTreeMap::new(),
            node_id: task.node_plan.node_id.clone(),
            outputs: BTreeMap::from([
                ("pred".to_string(), output.clone()),
                ("aux".to_string(), output),
            ]),
            predictions,
            observation_predictions: Vec::new(),
            aggregated_predictions: Vec::new(),
            explanations: Vec::new(),
            shape_deltas: Vec::new(),
            artifacts: Vec::new(),
            artifact_handles: BTreeMap::new(),
            fit_influence_diagnostics: Vec::new(),
            regression_targets,
            lineage: LineageRecord {
                record_id: LineageId::new(format!(
                    "lineage:{}:{:?}:{variant_label}:{fold_label}:multiport",
                    task.node_plan.node_id, task.phase
                ))
                .unwrap(),
                run_id: task.run_id.clone(),
                node_id: task.node_plan.node_id.clone(),
                phase: task.phase,
                controller_id: self.id.clone(),
                controller_version: task.node_plan.controller_version.clone(),
                variant_id: task.variant_id.clone(),
                fold_id: task.fold_id.clone(),
                branch_path: task.branch_path.clone(),
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
                target_domain: None,
            },
        })
    }
}

fn multi_port_variant_scoring_controllers() -> RuntimeControllerRegistry {
    let mut controllers = RuntimeControllerRegistry::new();
    controllers
        .register(Box::new(MockController {
            id: ControllerId::new("controller:transform").unwrap(),
            handle: 1,
            emit_prediction: false,
        }))
        .unwrap();
    controllers
        .register(Box::new(MultiPortVariantScoringController {
            id: ControllerId::new("controller:model").unwrap(),
            handle: 2,
        }))
        .unwrap();
    controllers
}

fn one_fold_set() -> FoldSet {
    // Single fold, train/validation disjoint (s2 trains, s1 validates). `Resampled` mode drops the
    // OOF-completeness requirement (s2 never validated) while keeping per-fold disjointness.
    FoldSet {
        id: "outer.single".to_string(),
        sample_ids: vec![SampleId::new("s1").unwrap(), SampleId::new("s2").unwrap()],
        folds: vec![FoldAssignment {
            fold_id: FoldId::new("fold:0").unwrap(),
            train_sample_ids: vec![SampleId::new("s2").unwrap()],
            validation_sample_ids: vec![SampleId::new("s1").unwrap()],
            metadata: BTreeMap::new(),
        }],
        sample_groups: BTreeMap::new(),
        partition_mode: FoldPartitionMode::Resampled,
        train_exclusion: FoldTrainExclusion::Relations,
        target_missing_sample_ids: Vec::new(),
    }
}

fn single_fold_variant_scoring_campaign(offsets: Vec<(&str, f64)>) -> CampaignSpec {
    let mut campaign = variant_scoring_campaign(offsets);
    campaign.id = "campaign:variant.select.single.fold".to_string();
    if let Some(split) = campaign.split_invocation.as_mut() {
        split.fold_set = Some(one_fold_set());
    }
    campaign
}

// --- Multi-producer (two independent model nodes) fixtures for the >1-OOF-average refusal. ---

fn two_model_graph() -> GraphSpec {
    let data_edge = |target: &str| EdgeSpec {
        source: PortRef {
            node_id: NodeId::new("transform:snv").unwrap(),
            port_name: "x".to_string(),
        },
        target: PortRef {
            node_id: NodeId::new(target).unwrap(),
            port_name: "x".to_string(),
        },
        contract: EdgeContract {
            requires_oof: false,
            requires_fold_alignment: false,
            ..EdgeContract::new(PortKind::Data, None)
        },
    };
    GraphSpec {
        id: "g:two.model".to_string(),
        interface: GraphInterface::default(),
        nodes: vec![
            node(
                "transform:snv",
                NodeKind::Transform,
                vec![],
                vec![port("x", PortKind::Data)],
            ),
            node(
                "model:a",
                NodeKind::Model,
                vec![port("x", PortKind::Data)],
                vec![port("pred", PortKind::Prediction)],
            ),
            node(
                "model:b",
                NodeKind::Model,
                vec![port("x", PortKind::Data)],
                vec![port("pred", PortKind::Prediction)],
            ),
        ],
        edges: vec![data_edge("model:a"), data_edge("model:b")],
        search_space_fingerprint: None,
        metadata: BTreeMap::new(),
    }
}

fn two_model_manifests() -> crate::controller::ControllerRegistry {
    let mut manifests = crate::controller::ControllerRegistry::new();
    manifests
        .register(controller_manifest(
            "controller:transform",
            NodeKind::Transform,
        ))
        .unwrap();
    manifests
        .register(controller_manifest("controller:model", NodeKind::Model))
        .unwrap();
    manifests
}

fn two_model_variant_scoring_campaign(offsets: Vec<(&str, f64)>) -> CampaignSpec {
    let choices = offsets
        .into_iter()
        .map(|(label, offset)| GenerationChoice {
            label: label.to_string(),
            value: json!(label),
            param_overrides: vec![crate::generation::GenerationParamOverride {
                node_id: NodeId::new("model:a").unwrap(),
                params: BTreeMap::from([("n_components".to_string(), json!(offset))]),
            }],
            active_subsequence: None,
        })
        .collect::<Vec<_>>();
    let max_variants = Some(choices.len());
    CampaignSpec {
        inner_cv: None,
        id: "campaign:variant.select.multi.producer".to_string(),
        root_seed: Some(7),
        leakage_policy: Default::default(),
        aggregation_policy: Default::default(),
        split_invocation: Some(SplitInvocation {
            id: "split:outer".to_string(),
            controller_id: None,
            leakage_policy: Default::default(),
            params: BTreeMap::new(),
            fold_set: Some(two_fold_set()),
        }),
        generation: GenerationSpec {
            strategy: GenerationStrategy::Cartesian,
            dimensions: vec![GenerationDimension {
                name: "model_offset".to_string(),
                choices,
            }],
            max_variants,
            constraints: GenerationConstraints::default(),
        },
        shape_plans: BTreeMap::new(),
        data_bindings: BTreeMap::new(),
        branch_view_plans: Vec::new(),
        metadata: BTreeMap::new(),
    }
}

fn two_model_variant_scoring_controllers() -> RuntimeControllerRegistry {
    let mut controllers = RuntimeControllerRegistry::new();
    controllers
        .register(Box::new(MockController {
            id: ControllerId::new("controller:transform").unwrap(),
            handle: 1,
            emit_prediction: false,
        }))
        .unwrap();
    controllers
        .register(Box::new(VariantScoringController {
            id: ControllerId::new("controller:model").unwrap(),
            handle: 2,
            emit_targets: true,
        }))
        .unwrap();
    controllers
}

#[test]
fn select_best_variant_by_cv_picks_lowest_oof_rmse_variant() {
    use crate::metrics::RegressionMetricKind;

    // Two variants over a 2-fold OOF CV: variant `accurate` predicts y_true exactly (offset 0 ->
    // RMSE 0); variant `biased` predicts y_true + 1 (offset 1 -> RMSE 1). Native SELECT must pick the
    // accurate one by its cross-fold OOF average RMSE.
    let plan = build_execution_plan(
        "plan:variant.select",
        simple_graph(),
        variant_scoring_campaign(vec![("accurate", 0.0), ("biased", 1.0)]),
        &manifests(),
    )
    .unwrap();
    assert_eq!(plan.variants.len(), 2);
    let controllers = variant_scoring_controllers();
    let run_id = RunId::new("run:variant.select").unwrap();

    let selected = select_best_variant_by_cv(
        &plan,
        &run_id,
        Some(7),
        RegressionMetricKind::Rmse,
        |variant_plan, ctx| {
            SequentialScheduler
                .execute_campaign_phase(variant_plan, &controllers, ctx, Phase::FitCv)
                .map(|_| ())
        },
    )
    .unwrap();

    let accurate_variant = plan
        .variants
        .iter()
        .find(|variant| variant.choices["model_offset"].label == "accurate")
        .unwrap();
    let selection = selected.unwrap();
    assert_eq!(selection.selected_variant_id, accurate_variant.variant_id);

    // ADDITIVE per-variant reports: the bundle-bound `validation_reports` carry EVERY variant's CV
    // (the loser `biased` too), each tagged its own variant_id — not just the winner's. This is the
    // dag-ml-side surfacing that lets a generated sweep's num_predictions match legacy.
    let scored_variants: BTreeSet<VariantId> = selection
        .validation_reports
        .iter()
        .filter_map(|report| report.variant_id.clone())
        .collect();
    let expected_variants: BTreeSet<VariantId> = plan
        .variants
        .iter()
        .map(|variant| variant.variant_id.clone())
        .collect();
    assert_eq!(
        scored_variants, expected_variants,
        "validation reports must cover ALL variants, not just the winner"
    );
    // Every report is a Validation (OOF) report — never Final/Test — preserving the report-only,
    // OOF-safe guarantee for the non-selected variants.
    assert!(
        selection
            .validation_reports
            .iter()
            .all(|report| report.partition == PredictionPartition::Validation),
        "selection must only retain Validation (OOF) reports"
    );
    // The cross-fold OOF average per variant is present and tagged with the variant id (its native
    // form has variant_id = None), so each loser's headline CV score is recoverable.
    for variant in &plan.variants {
        let has_avg = selection.validation_reports.iter().any(|report| {
            report.variant_id.as_ref() == Some(&variant.variant_id)
                && report
                    .fold_id
                    .as_ref()
                    .is_some_and(|fold| fold.as_str() == "avg")
        });
        assert!(
            has_avg,
            "variant `{}` is missing its cross-fold OOF average report",
            variant.variant_id
        );
    }

    // ADDITIVE per-variant PREDICTIONS: alongside the scalar reports, EVERY variant's per-fold
    // VALIDATION (OOF) predictions are captured + re-tagged with the variant's id, so a host can fill a
    // non-selected variant's per-sample rows (not just its score). Param-variant SELECT carries no
    // operator-variant fingerprint, so `variant_label` is None.
    let predicted_variants: BTreeSet<VariantId> = selection
        .variant_validation_predictions
        .iter()
        .map(|captured| captured.variant_id.clone())
        .collect();
    assert_eq!(
        predicted_variants, expected_variants,
        "captured validation predictions must cover ALL variants, not just the winner"
    );
    assert!(
        selection
            .variant_validation_predictions
            .iter()
            .all(|captured| captured.variant_label.is_none()
                && !captured.predictions.is_empty()
                && captured
                    .predictions
                    .iter()
                    .all(|block| block.partition == PredictionPartition::Validation)),
        "captured param-variant predictions are Validation-only with no operator fingerprint"
    );
}

#[test]
fn select_best_variant_for_target_ignores_better_sibling_port() {
    use crate::metrics::RegressionMetricKind;

    // Same producer node, two prediction ports:
    // - `pred` makes variant `accurate` perfect and `biased` bad.
    // - `aux` intentionally does the opposite.
    //
    // Training SELECT resolves an OutputBinding to one concrete port. Targeting `pred` must therefore
    // pick `accurate` even though sibling port `aux` gives `biased` the better score.
    let plan = build_execution_plan(
        "plan:variant.select.multi.port",
        multi_port_model_graph(),
        variant_scoring_campaign(vec![("accurate", 0.0), ("biased", 10.0)]),
        &manifests(),
    )
    .unwrap();
    assert_eq!(plan.variants.len(), 2);
    let controllers = multi_port_variant_scoring_controllers();
    let run_id = RunId::new("run:variant.select.multi.port").unwrap();
    let target = NodeId::new("model:pls").unwrap();

    let outcome = select_best_variant_outcome_by_cv_for_target(
        &plan,
        &run_id,
        Some(7),
        RegressionMetricKind::Rmse,
        &target,
        Some("pred"),
        PredictionLevel::Sample,
        |variant_plan, ctx| {
            SequentialScheduler
                .execute_campaign_phase(variant_plan, &controllers, ctx, Phase::FitCv)
                .map(|_| ())
        },
    )
    .unwrap()
    .unwrap();

    let accurate_variant = plan
        .variants
        .iter()
        .find(|variant| variant.choices["model_offset"].label == "accurate")
        .unwrap();
    let biased_variant = plan
        .variants
        .iter()
        .find(|variant| variant.choices["model_offset"].label == "biased")
        .unwrap();
    assert_eq!(
        outcome.selection.selected_variant_id,
        accurate_variant.variant_id
    );

    let avg_rmse = |variant_id: &VariantId, port_name: &str| {
        outcome
            .selection
            .validation_reports
            .iter()
            .find(|report| {
                report.variant_id.as_ref() == Some(variant_id)
                    && report.producer_node == target
                    && report.producer_port.as_deref() == Some(port_name)
                    && report.partition == PredictionPartition::Validation
                    && report
                        .fold_id
                        .as_ref()
                        .is_some_and(|fold| fold.as_str() == "avg")
            })
            .map(|report| report.metrics["rmse"])
            .unwrap()
    };
    assert_eq!(avg_rmse(&accurate_variant.variant_id, "pred"), 0.0);
    assert_eq!(avg_rmse(&biased_variant.variant_id, "aux"), 0.0);
    assert!(
        avg_rmse(&biased_variant.variant_id, "pred")
            > avg_rmse(&accurate_variant.variant_id, "pred")
    );
}

#[test]
fn independent_unit_group_select_preserves_the_declared_port_and_refuses_another_port() {
    use crate::policy::{AggregationGroupingKey, AggregationMethod};

    struct ExplicitPredictionPort(VariantScoringController);
    impl RuntimeController for ExplicitPredictionPort {
        fn controller_id(&self) -> &ControllerId {
            self.0.controller_id()
        }
        fn invoke(&self, task: &NodeTask) -> Result<NodeResult> {
            let influence = &task.fit_influence;
            assert_eq!(influence.fit_sample_ids.len(), 1);
            assert_eq!(influence.row_weights, vec![1.0]);
            let mut result = self.0.invoke(task)?;
            for block in &mut result.predictions {
                block.producer_port = Some("pred".into());
            }
            Ok(result)
        }
    }
    let node = NodeId::new("model:pls").unwrap();
    let relations = crate::relation::SampleRelationSet {
        records: ["s1", "s2"]
            .into_iter()
            .map(|id| {
                let mut relation = crate::relation::SampleRelation::new(
                    crate::ids::ObservationId::new(format!("obs:{id}")).unwrap(),
                    SampleId::new(id).unwrap(),
                );
                relation
                    .metadata
                    .insert("independent_unit_id".into(), json!(format!("unit:{id}")));
                relation
            })
            .collect(),
    };
    let mut campaign = variant_scoring_campaign(vec![("accurate", 0.0), ("biased", 1.0)]);
    campaign.aggregation_policy = crate::policy::AggregationPolicy {
        aggregation_level: PredictionLevel::Group,
        selection_metric_level: PredictionLevel::Group,
        grouping_key: Some(AggregationGroupingKey::RelationMetadata {
            key: "independent_unit_id".into(),
        }),
        method: AggregationMethod::Mean,
        ..Default::default()
    };
    let mut graph = simple_graph();
    graph.nodes.retain(|node| node.kind == NodeKind::Model);
    graph.edges.clear();
    graph.metadata.insert(
        "experimental_unit".into(),
        json!({
            "schema_version": 1, "sample_ids": ["s1", "s2"],
            "independent_unit_ids": ["unit:s1", "unit:s2"],
            "fit_influence_policy": "equal_sample_influence", "task_type": "regression",
            "target_names": ["y"], "target_values": [[1.0], [2.0]]
        }),
    );
    let mut weighted_manifests = ControllerRegistry::new();
    for mut manifest in manifests().manifests().cloned() {
        if manifest.operator_kind == NodeKind::Model {
            manifest
                .capabilities
                .insert(ControllerCapability::SupportsSampleWeights);
        }
        weighted_manifests.register(manifest).unwrap();
    }
    let mut binding = data_binding(&node);
    binding.relation_fingerprint =
        Some(crate::relation::relation_set_fingerprint(&relations).unwrap());
    campaign.data_bindings.insert(node.clone(), vec![binding]);
    let plan = build_execution_plan(
        "plan:group.select.port",
        graph,
        campaign,
        &weighted_manifests,
    )
    .unwrap();
    let mut controllers = RuntimeControllerRegistry::new();
    controllers
        .register(Box::new(MockController {
            id: ControllerId::new("controller:transform").unwrap(),
            handle: 1,
            emit_prediction: false,
        }))
        .unwrap();
    controllers
        .register(Box::new(ExplicitPredictionPort(VariantScoringController {
            id: ControllerId::new("controller:model").unwrap(),
            handle: 2,
            emit_targets: true,
        })))
        .unwrap();
    let provider = ExcludedRelationProvider {
        owner: ControllerId::new("controller:data.excluded").unwrap(),
        relations,
    };
    let mut run_cv = |variant_plan: &ExecutionPlan, ctx: &mut RunContext| {
        SequentialScheduler
            .execute_campaign_phase_with_data_provider(
                variant_plan,
                &controllers,
                &provider,
                ctx,
                Phase::FitCv,
            )
            .map(|_| ())
    };
    let run = RunId::new("run:group.select.port").unwrap();
    let selected = select_best_variant_outcome_by_cv_for_target(
        &plan,
        &run,
        Some(7),
        RegressionMetricKind::Rmse,
        &node,
        Some("pred"),
        PredictionLevel::Group,
        &mut run_cv,
    )
    .unwrap()
    .unwrap();
    let accurate = plan
        .variants
        .iter()
        .find(|v| v.choices["model_offset"].label == "accurate")
        .unwrap();
    assert_eq!(selected.selection.selected_variant_id, accurate.variant_id);
    assert_eq!(selected.decision.selected_score, 0.0);
    // The generic SELECT helper keeps its legacy optional decision metadata;
    // the training-operation profile binds Group separately. Its explicit
    // score-target filter must still rank the genuine Group/port reports here.
    assert_eq!(selected.decision.metric_level, None);
    assert!(selected
        .selection
        .validation_reports
        .iter()
        .any(|r| r.level == PredictionLevel::Group
            && r.fold_id.as_ref().is_some_and(|id| id.as_str() == "avg")));
    assert!(selected
        .selection
        .validation_reports
        .iter()
        .filter(|r| r.level == PredictionLevel::Group)
        .all(|r| r.producer_port.as_deref() == Some("pred")
            && r.grouping_key == plan.campaign.aggregation_policy.grouping_key));
    let error = select_best_variant_outcome_by_cv_for_target(
        &plan,
        &run,
        Some(7),
        RegressionMetricKind::Rmse,
        &node,
        Some("other_prediction"),
        PredictionLevel::Group,
        &mut run_cv,
    )
    .unwrap_err();
    assert!(
        error.to_string().contains("no cross-fold OOF average"),
        "{error}"
    );
}

#[test]
fn select_best_variant_by_cv_single_variant_returns_that_variant() {
    use crate::metrics::RegressionMetricKind;

    let plan = build_execution_plan(
        "plan:variant.select.single",
        simple_graph(),
        variant_scoring_campaign(vec![("only", 1.0)]),
        &manifests(),
    )
    .unwrap();
    assert_eq!(plan.variants.len(), 1);
    let controllers = variant_scoring_controllers();
    let run_id = RunId::new("run:variant.select.single").unwrap();

    let selected = select_best_variant_by_cv(
        &plan,
        &run_id,
        Some(7),
        RegressionMetricKind::Rmse,
        |variant_plan, ctx| {
            SequentialScheduler
                .execute_campaign_phase(variant_plan, &controllers, ctx, Phase::FitCv)
                .map(|_| ())
        },
    )
    .unwrap();

    let selection = selected.unwrap();
    assert_eq!(selection.selected_variant_id, plan.variants[0].variant_id);
    // The single variant's own CV reports are still surfaced (tagged with its id).
    assert!(selection
        .validation_reports
        .iter()
        .all(|report| report.variant_id.as_ref() == Some(&plan.variants[0].variant_id)));
}

#[test]
fn select_best_variant_by_cv_picks_highest_accuracy_variant() {
    use crate::metrics::RegressionMetricKind;

    // Accuracy maximizes (metrics.rs objective): the `accurate` variant matches the integer label
    // exactly (accuracy 1.0), `biased` is off by 1 (accuracy 0.0). Native SELECT with Accuracy must
    // pick `accurate` — proving the metric (not just RMSE) drives direction.
    let plan = build_execution_plan(
        "plan:variant.select.accuracy",
        simple_graph(),
        variant_scoring_campaign(vec![("accurate", 0.0), ("biased", 1.0)]),
        &manifests(),
    )
    .unwrap();
    assert_eq!(plan.variants.len(), 2);
    let controllers = variant_scoring_controllers();
    let run_id = RunId::new("run:variant.select.accuracy").unwrap();

    let selected = select_best_variant_by_cv(
        &plan,
        &run_id,
        Some(7),
        RegressionMetricKind::Accuracy,
        |variant_plan, ctx| {
            SequentialScheduler
                .execute_campaign_phase(variant_plan, &controllers, ctx, Phase::FitCv)
                .map(|_| ())
        },
    )
    .unwrap();

    let accurate_variant = plan
        .variants
        .iter()
        .find(|variant| variant.choices["model_offset"].label == "accurate")
        .unwrap();
    assert_eq!(
        selected.unwrap().selected_variant_id,
        accurate_variant.variant_id
    );
}

#[test]
fn select_best_variant_by_cv_no_targets_returns_none() {
    use crate::metrics::RegressionMetricKind;

    // The model emits well-formed, fold-disjoint validation OOF (s1 for fold:0, s2 for fold:1) but NO
    // regression_targets, so native scoring is genuinely off. The function returns Ok(None) so the
    // caller keeps its default variant. (A dedicated `emit_targets = false` controller is used rather
    // than the generic mock, whose binding-less fallback would emit the same sample in both folds — a
    // non-unique OOF set the mandatory coverage gate now rejects.)
    let plan = build_execution_plan(
        "plan:variant.select.no.targets",
        simple_graph(),
        variant_scoring_campaign(vec![("a", 0.0), ("b", 1.0)]),
        &manifests(),
    )
    .unwrap();
    assert_eq!(plan.variants.len(), 2);
    let mut controllers = RuntimeControllerRegistry::new();
    controllers
        .register(Box::new(MockController {
            id: ControllerId::new("controller:transform").unwrap(),
            handle: 1,
            emit_prediction: false,
        }))
        .unwrap();
    controllers
        .register(Box::new(VariantScoringController {
            id: ControllerId::new("controller:model").unwrap(),
            handle: 2,
            emit_targets: false,
        }))
        .unwrap();
    let run_id = RunId::new("run:variant.select.no.targets").unwrap();

    let selected = select_best_variant_by_cv(
        &plan,
        &run_id,
        Some(7),
        RegressionMetricKind::Rmse,
        |variant_plan, ctx| {
            SequentialScheduler
                .execute_campaign_phase(variant_plan, &controllers, ctx, Phase::FitCv)
                .map(|_| ())
        },
    )
    .unwrap();

    assert!(selected.is_none());
}

#[test]
fn select_best_variant_by_cv_single_fold_scores_but_no_average_errors() {
    use crate::metrics::RegressionMetricKind;

    // Scoring IS on (targets emitted) but the fold set has a single fold, so `cross_fold_validation
    // _reports` skips the OOF average. Per-fold scores exist (any_scores_seen) yet no average can rank
    // the variants -> an error, distinct from the no-targets Ok(None) case.
    let plan = build_execution_plan(
        "plan:variant.select.single.fold",
        simple_graph(),
        single_fold_variant_scoring_campaign(vec![("a", 0.0), ("b", 1.0)]),
        &manifests(),
    )
    .unwrap();
    assert_eq!(plan.variants.len(), 2);
    let controllers = variant_scoring_controllers();
    let run_id = RunId::new("run:variant.select.single.fold").unwrap();

    let error = select_best_variant_by_cv(
        &plan,
        &run_id,
        Some(7),
        RegressionMetricKind::Rmse,
        |variant_plan, ctx| {
            SequentialScheduler
                .execute_campaign_phase(variant_plan, &controllers, ctx, Phase::FitCv)
                .map(|_| ())
        },
    )
    .unwrap_err()
    .to_string();

    assert!(
        error.contains("no cross-fold OOF average"),
        "unexpected single-fold error: {error}"
    );
}

#[test]
fn select_best_variant_by_cv_rejects_multiple_prediction_producers() {
    use crate::metrics::RegressionMetricKind;

    // Two model producers each emit a cross-fold OOF average per variant, so a variant has >1 average.
    // Native SELECT needs a single score target -> it refuses to silently rank on one producer.
    let plan = build_execution_plan(
        "plan:variant.select.multi.producer",
        two_model_graph(),
        two_model_variant_scoring_campaign(vec![("a", 0.0), ("b", 1.0)]),
        &two_model_manifests(),
    )
    .unwrap();
    assert_eq!(plan.variants.len(), 2);
    let controllers = two_model_variant_scoring_controllers();
    let run_id = RunId::new("run:variant.select.multi.producer").unwrap();

    let error = select_best_variant_by_cv(
        &plan,
        &run_id,
        Some(7),
        RegressionMetricKind::Rmse,
        |variant_plan, ctx| {
            SequentialScheduler
                .execute_campaign_phase(variant_plan, &controllers, ctx, Phase::FitCv)
                .map(|_| ())
        },
    )
    .unwrap_err()
    .to_string();

    assert!(
        error.contains("multiple prediction producers"),
        "unexpected multi-producer error: {error}"
    );
}

#[test]
fn fit_view_spec_drops_excluded_samples_while_validation_keeps_them() {
    // `exclude` drops outlier samples from the TRAINING view spec (not just the
    // materialized view) but keeps them in validation/predict so OOF/test
    // coverage stays complete. three_fold_stress_set: s0..s5; fold:0
    // validation=[s0,s3], train=[s1,s2,s4,s5]. Exclude s2.
    let node_id = NodeId::new("node:model").unwrap();
    let binding = data_binding(&node_id);
    assert!(
        !binding.view_policy.include_excluded,
        "default policy must not include excluded rows"
    );
    let fold_set = three_fold_stress_set();
    let fold_id = fold_set.folds[0].fold_id.clone();
    let excluded: BTreeSet<SampleId> = [SampleId::new("s2").unwrap()].into_iter().collect();
    let empty: BTreeSet<SampleId> = BTreeSet::new();

    let fold_scope = PhaseScope {
        phase: Phase::FitCv,
        variant_id: None,
        variant: None,
        fold_id: Some(fold_id),
        seed_root: None,
    };

    // (a) Excluded sample is ABSENT from the TRAINING view spec sample_ids,
    // while the other train samples remain.
    let train_view = data_view_for_partition(
        &binding,
        Some(&fold_set),
        &fold_scope,
        DataRequestPartition::FoldTrain,
        None,
        DataViewRole::Fit,
        &excluded,
    )
    .unwrap();
    assert!(
        !train_view.include_excluded,
        "fit view must not include excluded rows"
    );
    let train_ids = train_view.sample_ids.as_ref().unwrap();
    assert!(
        !train_ids.contains(&SampleId::new("s2").unwrap()),
        "excluded s2 must be dropped from the training spec sample_ids"
    );
    assert!(
        train_ids.contains(&SampleId::new("s1").unwrap())
            && train_ids.contains(&SampleId::new("s4").unwrap())
            && train_ids.contains(&SampleId::new("s5").unwrap()),
        "non-excluded train samples must remain"
    );

    // Validation read keeps every validation sample and flags include_excluded.
    let validation_view = data_view_for_partition(
        &binding,
        Some(&fold_set),
        &fold_scope,
        DataRequestPartition::FoldValidation,
        None,
        DataViewRole::NonFit,
        &excluded,
    )
    .unwrap();
    assert!(
        validation_view.include_excluded,
        "validation read must keep excluded rows so they are still validated"
    );
    assert_eq!(
        validation_view.sample_ids,
        Some(vec![
            SampleId::new("s0").unwrap(),
            SampleId::new("s3").unwrap()
        ]),
        "validation spec is unfiltered by exclusion"
    );

    // FullTrain (refit) is a fit read: drops the excluded sample from the
    // full-train spec.
    let full_scope = PhaseScope {
        phase: Phase::Refit,
        variant_id: None,
        variant: None,
        fold_id: None,
        seed_root: None,
    };
    let full_train_view = data_view_for_partition(
        &binding,
        Some(&fold_set),
        &full_scope,
        DataRequestPartition::FullTrain,
        None,
        DataViewRole::Fit,
        &excluded,
    )
    .unwrap();
    assert!(!full_train_view.include_excluded);
    assert!(
        !full_train_view
            .sample_ids
            .as_ref()
            .unwrap()
            .contains(&SampleId::new("s2").unwrap()),
        "refit training spec drops excluded s2"
    );

    // Predict read keeps excluded; sample_ids stays None (whole dataset).
    let predict_scope = PhaseScope {
        phase: Phase::Predict,
        variant_id: None,
        variant: None,
        fold_id: None,
        seed_root: None,
    };
    let predict_view = data_view_for_partition(
        &binding,
        Some(&fold_set),
        &predict_scope,
        DataRequestPartition::Predict,
        None,
        DataViewRole::NonFit,
        &empty,
    )
    .unwrap();
    assert!(
        predict_view.include_excluded,
        "predict read must keep excluded rows so they are still predicted"
    );
}

#[test]
fn refit_fit_view_attests_augmented_resubstitution_opt_in() {
    let node_id = NodeId::new("node:model").unwrap();
    let mut binding = data_binding(&node_id);
    let fold_set = three_fold_stress_set();
    let scope = PhaseScope {
        phase: Phase::Refit,
        variant_id: None,
        variant: None,
        fold_id: None,
        seed_root: None,
    };
    let excluded = BTreeSet::new();
    let default_view = data_view_for_partition(
        &binding,
        Some(&fold_set),
        &scope,
        DataRequestPartition::FullTrain,
        None,
        DataViewRole::Fit,
        &excluded,
    )
    .unwrap();
    assert_eq!(
        default_view.extra["include_augmented_refit_predictions"],
        false
    );

    binding.view_policy.include_augmented_refit_predictions = true;
    let opted_view = data_view_for_partition(
        &binding,
        Some(&fold_set),
        &scope,
        DataRequestPartition::FullTrain,
        None,
        DataViewRole::Fit,
        &excluded,
    )
    .unwrap();
    assert!(opted_view.include_augmented);
    assert_eq!(
        opted_view.extra["include_augmented_refit_predictions"],
        true
    );
    assert_eq!(opted_view.sample_ids, default_view.sample_ids);
}

#[test]
fn cv_augmented_train_predictions_are_fold_declared_and_never_oof() {
    let node_id = NodeId::new("node:model").unwrap();
    let mut binding = data_binding(&node_id);
    let fold_id = FoldId::new("fold:0").unwrap();
    let origin = SampleId::new("s1").unwrap();
    let child = SampleId::new("child:fold0").unwrap();
    let other_fold_child = SampleId::new("child:fold1").unwrap();
    binding.view_policy.include_augmented_cv_train_predictions = true;
    binding
        .view_policy
        .augmented_cv_train_prediction_ids_by_fold
        .insert(fold_id.clone(), vec![child.clone()]);
    let scope = PhaseScope {
        phase: Phase::FitCv,
        variant_id: None,
        variant: None,
        fold_id: Some(fold_id.clone()),
        seed_root: None,
    };
    let view = data_view_for_partition(
        &binding,
        Some(&three_fold_stress_set()),
        &scope,
        DataRequestPartition::FoldTrain,
        None,
        DataViewRole::Fit,
        &BTreeSet::new(),
    )
    .unwrap();
    assert_eq!(
        view.extra["augmented_cv_train_prediction_ids"],
        json!(["child:fold0"])
    );
    let mut base =
        crate::relation::SampleRelation::new(ObservationId::new("s1").unwrap(), origin.clone());
    base.origin_sample_id = None;
    let make_child = |id: &SampleId| {
        let mut relation = crate::relation::SampleRelation::new(
            ObservationId::new(id.as_str()).unwrap(),
            origin.clone(),
        );
        relation.origin_sample_id = Some(origin.clone());
        relation.is_augmented = true;
        relation
    };
    let relations = crate::relation::SampleRelationSet {
        records: vec![base, make_child(&child), make_child(&other_fold_child)],
    };
    validate_cv_augmented_train_prediction_view(&view, &relations).unwrap();

    let mut task = fit_influence_validation_task(FitInfluenceTask::default());
    task.fold_id = Some(fold_id.clone());
    task.data_views.insert("data:x".to_string(), view);
    let mut prediction = PredictionBlock {
        prediction_id: None,
        producer_node: task.node_plan.node_id.clone(),
        producer_port: Some("prediction".to_string()),
        partition: PredictionPartition::Train,
        fold_id: Some(fold_id),
        sample_ids: vec![origin, child],
        values: vec![vec![1.0], vec![1.1]],
        target_names: vec!["y".to_string()],
    };
    validate_prediction_scope(&prediction, &task).unwrap();
    prediction.sample_ids.push(other_fold_child);
    prediction.values.push(vec![1.2]);
    assert!(validate_prediction_scope(&prediction, &task)
        .unwrap_err()
        .to_string()
        .contains("outside its fold-train data view"));
    prediction.partition = PredictionPartition::TrainPool;
    assert!(validate_prediction_scope(&prediction, &task).is_err());
}

#[test]
fn data_view_extra_carries_source_index_metadata() {
    let node_id = NodeId::new("node:model").unwrap();
    let mut binding = data_binding(&node_id);
    binding.source_ids = vec!["nir".to_string(), "chem".to_string()];
    binding.metadata.insert(
        SOURCE_INDEX_METADATA_KEY.to_string(),
        json!({
            "nir": 0,
            "chem": 1
        }),
    );
    binding.validate().unwrap();
    let empty: BTreeSet<SampleId> = BTreeSet::new();
    let scope = PhaseScope {
        phase: Phase::Predict,
        variant_id: None,
        variant: None,
        fold_id: None,
        seed_root: None,
    };

    let view = data_view_for_partition(
        &binding,
        None,
        &scope,
        DataRequestPartition::Predict,
        None,
        DataViewRole::NonFit,
        &empty,
    )
    .unwrap();

    assert_eq!(
        view.extra.get(SOURCE_INDEX_METADATA_KEY),
        Some(&json!({"nir": 0, "chem": 1}))
    );
}

#[test]
fn feature_axes_are_validated_and_carried_to_source_views() {
    let node_id = NodeId::new("node:model").unwrap();
    let mut binding = data_binding(&node_id);
    binding.source_ids = vec!["nir".to_string(), "chem".to_string()];
    binding.metadata.insert(
        crate::data::FEATURE_AXES_METADATA_KEY.to_string(),
        json!({"nir": ["1000", "1100"], "chem": ["a", "b", "c"]}),
    );
    binding.validate().unwrap();
    let scope = PhaseScope {
        phase: Phase::Predict,
        variant_id: None,
        variant: None,
        fold_id: None,
        seed_root: None,
    };
    let view = data_view_for_partition(
        &binding,
        None,
        &scope,
        DataRequestPartition::Predict,
        None,
        DataViewRole::NonFit,
        &BTreeSet::new(),
    )
    .unwrap();
    assert_eq!(
        view.extra.get(crate::data::FEATURE_AXES_METADATA_KEY),
        Some(&json!({"nir": ["1000", "1100"], "chem": ["a", "b", "c"]})),
    );
    binding.metadata.insert(
        crate::data::FEATURE_AXES_METADATA_KEY.to_string(),
        json!({"nir": ["1000", "1100"]}),
    );
    binding.validate().unwrap();
    binding.metadata.insert(
        crate::data::FEATURE_AXES_METADATA_KEY.to_string(),
        json!({"unknown": ["1000", "1100"]}),
    );
    assert!(binding.validate().is_err());
}

#[test]
fn by_source_data_view_uses_branch_source_ids() {
    use crate::data::{BranchViewMode, BranchViewPlan, DataViewSelector};

    let node_id = NodeId::new("node:model").unwrap();
    let mut binding = data_binding(&node_id);
    binding.source_ids = vec!["nir".to_string(), "chem".to_string()];
    let branch_view = BranchViewPlan {
        view_id: "branch_view:chem".to_string(),
        branch_id: "branch:chem".to_string(),
        mode: BranchViewMode::BySource,
        selector: DataViewSelector {
            source_ids: vec!["chem".to_string()],
            ..Default::default()
        },
        allow_overlap: false,
        metadata: BTreeMap::new(),
    };
    let empty: BTreeSet<SampleId> = BTreeSet::new();
    let scope = PhaseScope {
        phase: Phase::Predict,
        variant_id: None,
        variant: None,
        fold_id: None,
        seed_root: None,
    };

    let view = data_view_for_partition(
        &binding,
        None,
        &scope,
        DataRequestPartition::Predict,
        Some(&branch_view),
        DataViewRole::NonFit,
        &empty,
    )
    .unwrap();

    assert_eq!(view.source_ids, Some(vec!["chem".to_string()]));
    assert_eq!(view.branch_view.as_ref(), Some(&branch_view));

    let invalid_branch_view = BranchViewPlan {
        view_id: "branch_view:raman".to_string(),
        branch_id: "branch:raman".to_string(),
        selector: DataViewSelector {
            source_ids: vec!["raman".to_string()],
            ..Default::default()
        },
        ..branch_view
    };
    let error = data_view_for_partition(
        &binding,
        None,
        &scope,
        DataRequestPartition::Predict,
        Some(&invalid_branch_view),
        DataViewRole::NonFit,
        &empty,
    )
    .unwrap_err()
    .to_string();
    assert!(
        error.contains("outside data binding source_ids"),
        "unexpected: {error}"
    );
}

#[test]
fn fit_influence_row_weights_match_post_exclusion_training_spec() {
    // (b) equal_sample_influence_weights row_weights length must equal the
    // post-exclusion training view, not the pre-exclusion fold train set.
    let node_id = NodeId::new("node:model").unwrap();
    let binding = data_binding(&node_id);
    let fold_set = three_fold_stress_set(); // s0..s5
    let fold_id = fold_set.folds[0].fold_id.clone();
    let train_len = fold_set.folds[0].train_sample_ids.len();
    assert!(train_len >= 2, "need a multi-sample train fold");
    let dropped = fold_set.folds[0].train_sample_ids[0].clone();
    let excluded: BTreeSet<SampleId> = [dropped.clone()].into_iter().collect();

    let scope = PhaseScope {
        phase: Phase::FitCv,
        variant_id: None,
        variant: None,
        fold_id: Some(fold_id),
        seed_root: None,
    };
    let train_view = data_view_for_partition(
        &binding,
        Some(&fold_set),
        &scope,
        DataRequestPartition::FoldTrain,
        None,
        DataViewRole::Fit,
        &excluded,
    )
    .unwrap();
    let spec_len = train_view.sample_ids.as_ref().unwrap().len();
    assert_eq!(
        spec_len,
        train_len - 1,
        "training spec must drop exactly the one excluded sample"
    );
    assert!(!train_view.sample_ids.as_ref().unwrap().contains(&dropped));

    let mut data_views = BTreeMap::new();
    data_views.insert("x".to_string(), train_view);
    let weights = equal_sample_influence_weights(&data_views).expect("weights derived");
    assert_eq!(
        weights.len(),
        spec_len,
        "row_weights length must equal the post-exclusion training spec"
    );
}

/// Provider resolving one relation set whose `excluded` bit marks `s2`.
struct ExcludedRelationProvider {
    owner: ControllerId,
    relations: SampleRelationSet,
}

impl ExcludedRelationProvider {
    fn new() -> Self {
        let records = (0..6)
            .map(|index| {
                let mut record = SampleRelation::new(
                    ObservationId::new(format!("obs.s{index}")).unwrap(),
                    SampleId::new(format!("s{index}")).unwrap(),
                );
                record.excluded = index == 2;
                record
            })
            .collect();
        Self {
            owner: ControllerId::new("controller:data.excluded").unwrap(),
            relations: SampleRelationSet { records },
        }
    }
}

impl RuntimeDataProvider for ExcludedRelationProvider {
    fn materialize(&self, _request: &DataMaterializationRequest) -> Result<HandleRef> {
        Ok(HandleRef {
            handle: 91,
            kind: HandleKind::Data,
            owner_controller: self.owner.clone(),
        })
    }

    fn make_view(&self, _request: &DataViewRequest) -> Result<HandleRef> {
        Ok(HandleRef {
            handle: 92,
            kind: HandleKind::DataView,
            owner_controller: self.owner.clone(),
        })
    }

    fn coordinator_relations(
        &self,
        _binding: &crate::data::DataBinding,
    ) -> Result<Option<SampleRelationSet>> {
        Ok(Some(self.relations.clone()))
    }
}

/// The scheduler-created data views of `model:pls` for one phase scope, over
/// `three_fold_stress_set` (s0..s5; fold:0 validation=[s0,s3], train=[s1,s2,s4,s5])
/// with relation-excluded `s2` and the given fold-train exclusion authority.
fn excluded_relation_views(
    train_exclusion: FoldTrainExclusion,
    phase: Phase,
    fold_id: Option<&str>,
) -> BTreeMap<String, DataProviderViewSpec> {
    let mut fold_set = three_fold_stress_set();
    fold_set.train_exclusion = train_exclusion;
    let model_id = NodeId::new("model:pls").unwrap();
    let mut campaign = oof_edge_campaign();
    campaign.split_invocation.as_mut().unwrap().fold_set = Some(fold_set);
    campaign.data_bindings = BTreeMap::from([(model_id.clone(), vec![data_binding(&model_id)])]);
    let plan = build_execution_plan(
        "plan:fold.train.exclusion",
        simple_graph(),
        campaign,
        &manifests(),
    )
    .unwrap();
    let provider = ExcludedRelationProvider::new();
    let resources = PhaseScopeResources {
        data_provider: Some(&provider),
        ..Default::default()
    };
    collect_input_handles(
        &plan,
        plan.node_plans.get(&model_id).unwrap(),
        &BTreeMap::new(),
        &BTreeMap::new(),
        &resources,
        &RunContext::new(RunId::new("run:fold.train.exclusion").unwrap(), Some(11)),
        &PhaseScope {
            phase,
            variant_id: Some(VariantId::new("variant:base").unwrap()),
            variant: None,
            fold_id: fold_id.map(|id| FoldId::new(id).unwrap()),
            seed_root: Some(11),
        },
    )
    .unwrap()
    .data_views
}

fn view_ids(view: &DataProviderViewSpec) -> Vec<&str> {
    view.sample_ids
        .as_ref()
        .unwrap()
        .iter()
        .map(SampleId::as_str)
        .collect()
}

#[test]
fn relations_mode_drops_relation_excluded_samples_from_fold_train_and_refit() {
    let fit_cv =
        excluded_relation_views(FoldTrainExclusion::Relations, Phase::FitCv, Some("fold:0"));
    let train = &fit_cv["data:x"];
    assert_eq!(train.partition, DataRequestPartition::FoldTrain);
    assert_eq!(view_ids(train), ["s1", "s4", "s5"]);
    assert!(!train.include_excluded);
    let validation = &fit_cv["data:x:validation"];
    assert_eq!(view_ids(validation), ["s0", "s3"]);
    assert!(validation.include_excluded);

    let refit = excluded_relation_views(FoldTrainExclusion::Relations, Phase::Refit, None);
    let refit = &refit["data:x"];
    assert_eq!(refit.partition, DataRequestPartition::FullTrain);
    assert_eq!(view_ids(refit), ["s0", "s1", "s3", "s4", "s5"]);
    assert!(!refit.include_excluded);
}

#[test]
fn fold_local_mode_trains_on_listed_fold_rows_but_refit_still_excludes() {
    // The host kept relation-excluded s2 in fold:0's train list (its fold-local
    // filter, fitted on fold:0's train only, accepted it): FIT_CV trains on it.
    let fit_cv =
        excluded_relation_views(FoldTrainExclusion::FoldLocal, Phase::FitCv, Some("fold:0"));
    let train = &fit_cv["data:x"];
    assert_eq!(train.partition, DataRequestPartition::FoldTrain);
    assert_eq!(view_ids(train), ["s1", "s2", "s4", "s5"]);
    assert!(
        train.include_excluded,
        "the provider must not re-filter the authoritative fold list"
    );
    let validation = &fit_cv["data:x:validation"];
    assert_eq!(view_ids(validation), ["s0", "s3"]);
    assert!(validation.include_excluded);
    // Row weights follow the authoritative fold list.
    assert_eq!(
        equal_sample_influence_weights(&fit_cv).unwrap().len(),
        4,
        "row weights cover every fold-local training row"
    );

    // The relation bit still removes s2 from the REFIT training cohort.
    let refit = excluded_relation_views(FoldTrainExclusion::FoldLocal, Phase::Refit, None);
    let refit = &refit["data:x"];
    assert_eq!(refit.partition, DataRequestPartition::FullTrain);
    assert_eq!(view_ids(refit), ["s0", "s1", "s3", "s4", "s5"]);
    assert!(!refit.include_excluded);
}

#[test]
fn fold_local_mode_does_not_relax_non_fold_train_fit_reads() {
    // An unsafe FIT_CV fit on the validation partition is not a fold-train
    // read, so relation exclusions still narrow it under `fold_local`.
    let node_id = NodeId::new("node:model").unwrap();
    let mut binding = data_binding(&node_id);
    binding.view_policy.fit_partition = DataRequestPartition::FoldValidation;
    let mut fold_set = three_fold_stress_set();
    fold_set.train_exclusion = FoldTrainExclusion::FoldLocal;
    let excluded = BTreeSet::from([SampleId::new("s0").unwrap()]);
    let scope = PhaseScope {
        phase: Phase::FitCv,
        variant_id: None,
        variant: None,
        fold_id: Some(FoldId::new("fold:0").unwrap()),
        seed_root: None,
    };
    let view = data_view_for_partition(
        &binding,
        Some(&fold_set),
        &scope,
        DataRequestPartition::FoldValidation,
        None,
        DataViewRole::Fit,
        &excluded,
    )
    .unwrap();
    assert_eq!(view_ids(&view), ["s3"]);
    assert!(!view.include_excluded);
}

/// Relations s0..s5 (`s2` has a missing target, declared on the fold set by the
/// host) and an inference cohort that asks to PREDICT `s2`.
struct TargetMissingRelationProvider {
    owner: ControllerId,
    relations: SampleRelationSet,
    cohort: PredictCohort,
}

impl TargetMissingRelationProvider {
    fn new() -> Self {
        let records = (0..6)
            .map(|index| {
                SampleRelation::new(
                    ObservationId::new(format!("obs.s{index}")).unwrap(),
                    SampleId::new(format!("s{index}")).unwrap(),
                )
            })
            .collect();
        let cohort = PredictCohort::from_relations(
            PredictCohortRole::Inference,
            SampleRelationSet {
                records: vec![SampleRelation::new(
                    ObservationId::new("obs.s2").unwrap(),
                    SampleId::new("s2").unwrap(),
                )],
            },
            vec!["y".into()],
            "d".repeat(64),
            None,
        )
        .unwrap();
        Self {
            owner: ControllerId::new("controller:data.target_missing").unwrap(),
            relations: SampleRelationSet { records },
            cohort,
        }
    }
}

impl RuntimeDataProvider for TargetMissingRelationProvider {
    fn materialize(&self, _request: &DataMaterializationRequest) -> Result<HandleRef> {
        Ok(HandleRef {
            handle: 93,
            kind: HandleKind::Data,
            owner_controller: self.owner.clone(),
        })
    }

    fn make_view(&self, _request: &DataViewRequest) -> Result<HandleRef> {
        Ok(HandleRef {
            handle: 94,
            kind: HandleKind::DataView,
            owner_controller: self.owner.clone(),
        })
    }

    fn coordinator_relations(
        &self,
        _binding: &crate::data::DataBinding,
    ) -> Result<Option<SampleRelationSet>> {
        Ok(Some(self.relations.clone()))
    }

    fn predict_cohort(
        &self,
        _binding: &crate::data::DataBinding,
        phase: Phase,
    ) -> Result<Option<PredictCohort>> {
        Ok((phase == Phase::Predict).then(|| self.cohort.clone()))
    }
}

/// Records every model task's views and emits validation predictions plus
/// `y_true` (the sample index) for exactly the validation view it was given.
/// With `leak`, it also emits a validation block for `leak`, which the runtime
/// must refuse even when the task carries no data view to check it against.
struct TargetMissingProbeController {
    id: ControllerId,
    observed: Arc<Mutex<Vec<NodeTask>>>,
    leak: Option<SampleId>,
}

impl RuntimeController for TargetMissingProbeController {
    fn controller_id(&self) -> &ControllerId {
        &self.id
    }

    fn invoke(&self, task: &NodeTask) -> Result<NodeResult> {
        self.observed.lock().unwrap().push(task.clone());
        let mut predictions = Vec::new();
        let mut regression_targets = Vec::new();
        if let Some(validation) = validation_view_sample_ids(task) {
            let sample_ids = validation.into_iter().collect::<Vec<_>>();
            let y_true = sample_ids
                .iter()
                .map(|sample_id| vec![sample_id.as_str()[1..].parse::<f64>().unwrap()])
                .collect::<Vec<_>>();
            predictions.push(PredictionBlock {
                prediction_id: Some(format!("pred:{}", task.node_plan.node_id)),
                producer_node: task.node_plan.node_id.clone(),
                producer_port: None,
                partition: PredictionPartition::Validation,
                fold_id: task.fold_id.clone(),
                sample_ids: sample_ids.clone(),
                values: y_true.iter().map(|row| vec![row[0] + 0.5]).collect(),
                target_names: vec!["y".to_string()],
            });
            regression_targets.push(crate::metrics::RegressionTargetBlock {
                validity_masks: None,
                level: PredictionLevel::Sample,
                unit_ids: sample_ids
                    .into_iter()
                    .map(crate::aggregation::PredictionUnitId::Sample)
                    .collect(),
                values: y_true,
                target_names: vec!["y".to_string()],
            });
        }
        if let Some(leak) = &self.leak {
            predictions.push(PredictionBlock {
                prediction_id: Some(format!("pred:{}:leak", task.node_plan.node_id)),
                producer_node: task.node_plan.node_id.clone(),
                producer_port: None,
                partition: PredictionPartition::Validation,
                fold_id: task.fold_id.clone(),
                sample_ids: vec![leak.clone()],
                values: vec![vec![0.0]],
                target_names: vec!["y".to_string()],
            });
        }
        let fold_label = task
            .fold_id
            .as_ref()
            .map(ToString::to_string)
            .unwrap_or_else(|| "nofold".to_string());
        Ok(NodeResult {
            schema_version: None,
            classification_probabilities: Vec::new(),
            consumed_data_views: BTreeMap::new(),
            node_id: task.node_plan.node_id.clone(),
            outputs: BTreeMap::from([(
                "pred".to_string(),
                HandleRef {
                    handle: 95,
                    kind: HandleKind::Data,
                    owner_controller: self.id.clone(),
                },
            )]),
            predictions,
            observation_predictions: Vec::new(),
            aggregated_predictions: Vec::new(),
            explanations: Vec::new(),
            shape_deltas: Vec::new(),
            artifacts: Vec::new(),
            artifact_handles: BTreeMap::new(),
            fit_influence_diagnostics: Vec::new(),
            regression_targets,
            lineage: LineageRecord {
                record_id: LineageId::new(format!(
                    "lineage:{}:{:?}:{fold_label}:target_missing",
                    task.node_plan.node_id, task.phase
                ))
                .unwrap(),
                run_id: task.run_id.clone(),
                node_id: task.node_plan.node_id.clone(),
                phase: task.phase,
                controller_id: self.id.clone(),
                controller_version: task.node_plan.controller_version.clone(),
                variant_id: task.variant_id.clone(),
                fold_id: task.fold_id.clone(),
                branch_path: task.branch_path.clone(),
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
                target_domain: None,
            },
        })
    }
}

fn target_missing_plan(fold_set: FoldSet) -> ExecutionPlan {
    let model_id = NodeId::new("model:pls").unwrap();
    let mut campaign = oof_edge_campaign();
    campaign.split_invocation.as_mut().unwrap().fold_set = Some(fold_set);
    campaign.data_bindings = BTreeMap::from([(model_id.clone(), vec![data_binding(&model_id)])]);
    build_execution_plan(
        "plan:target.missing",
        simple_graph(),
        campaign,
        &manifests(),
    )
    .unwrap()
}

fn target_missing_views(
    plan: &ExecutionPlan,
    provider: &TargetMissingRelationProvider,
    phase: Phase,
) -> BTreeMap<String, DataProviderViewSpec> {
    let model_id = NodeId::new("model:pls").unwrap();
    let resources = PhaseScopeResources {
        data_provider: Some(provider),
        ..Default::default()
    };
    collect_input_handles(
        plan,
        plan.node_plans.get(&model_id).unwrap(),
        &BTreeMap::new(),
        &BTreeMap::new(),
        &resources,
        &RunContext::new(RunId::new("run:target.missing").unwrap(), Some(11)),
        &PhaseScope {
            phase,
            variant_id: Some(VariantId::new("variant:base").unwrap()),
            variant: None,
            fold_id: None,
            seed_root: Some(11),
        },
    )
    .unwrap()
    .data_views
}

#[test]
fn target_missing_samples_never_train_validate_or_score_but_stay_predictable() {
    // three_fold_stress_set: s0..s5; fold:2 validation=[s2,s5]. `s2` has no target.
    let s2 = SampleId::new("s2").unwrap();
    let fold_set = three_fold_stress_set()
        .exclude_target_missing(&BTreeSet::from([s2.clone()]))
        .unwrap();
    assert_eq!(fold_set.target_missing_sample_ids, vec![s2.clone()]);
    let plan = target_missing_plan(fold_set);
    assert_eq!(
        plan.fold_set
            .as_ref()
            .unwrap()
            .target_missing_sample_ids
            .len(),
        1,
        "the exclusion and its count are recorded in the plan lineage"
    );
    let provider = TargetMissingRelationProvider::new();
    // The relation authority still lists `s2`; the fold set declares it outside CV.
    provider
        .relations
        .validate_against_fold_set(plan.fold_set.as_ref().unwrap(), &Default::default())
        .unwrap();

    // FIT_CV: never trained, never validated, never scored.
    let observed = Arc::new(Mutex::new(Vec::new()));
    let mut controllers = RuntimeControllerRegistry::new();
    controllers
        .register(Box::new(MockController {
            id: ControllerId::new("controller:transform").unwrap(),
            handle: 1,
            emit_prediction: false,
        }))
        .unwrap();
    controllers
        .register(Box::new(TargetMissingProbeController {
            id: ControllerId::new("controller:model").unwrap(),
            observed: observed.clone(),
            leak: None,
        }))
        .unwrap();
    let mut ctx = RunContext::new(RunId::new("run:target.missing.cv").unwrap(), Some(11));
    SequentialScheduler
        .execute_campaign_phase_with_data_provider(
            &plan,
            &controllers,
            &provider,
            &mut ctx,
            Phase::FitCv,
        )
        .unwrap();
    let tasks = observed.lock().unwrap();
    assert_eq!(tasks.len(), 3);
    let mut validated = BTreeSet::new();
    for task in tasks.iter() {
        let train = &task.data_views["data:x"];
        assert_eq!(train.partition, DataRequestPartition::FoldTrain);
        assert!(!train.sample_ids.as_ref().unwrap().contains(&s2));
        let validation = &task.data_views["data:x:validation"];
        assert!(!validation.sample_ids.as_ref().unwrap().contains(&s2));
        validated.extend(validation.sample_ids.clone().unwrap());
    }
    assert_eq!(
        validated.iter().map(SampleId::as_str).collect::<Vec<_>>(),
        ["s0", "s1", "s3", "s4", "s5"]
    );
    assert!(ctx
        .prediction_store
        .blocks()
        .iter()
        .all(|block| !block.sample_ids.contains(&s2)));
    let scored_rows = ctx
        .score_collector
        .iter()
        .filter(|report| {
            report.partition == PredictionPartition::Validation
                && report
                    .fold_id
                    .as_ref()
                    .is_some_and(|fold| fold.as_str().starts_with("fold:"))
        })
        .map(|report| report.row_count)
        .sum::<usize>();
    assert_eq!(
        scored_rows, 5,
        "OOF/SELECT scores cover only target-observed rows"
    );

    // REFIT: the FullTrain universe is the target-observed fold universe.
    let refit = target_missing_views(&plan, &provider, Phase::Refit);
    assert_eq!(refit["data:x"].partition, DataRequestPartition::FullTrain);
    assert_eq!(view_ids(&refit["data:x"]), ["s0", "s1", "s3", "s4", "s5"]);

    // PREDICT: the target-missing sample remains predictable.
    let predict = target_missing_views(&plan, &provider, Phase::Predict);
    assert_eq!(predict["data:x"].partition, DataRequestPartition::Predict);
    assert_eq!(view_ids(&predict["data:x"]), ["s2"]);
}

#[test]
fn target_missing_rows_in_a_controller_result_are_refused() {
    let s2 = SampleId::new("s2").unwrap();
    let fold_set = three_fold_stress_set()
        .exclude_target_missing(&BTreeSet::from([s2.clone()]))
        .unwrap();
    // No data binding: the model task carries no validation view, so only the
    // fold set's declaration can refuse the leaked row.
    let mut campaign = oof_edge_campaign();
    campaign.split_invocation.as_mut().unwrap().fold_set = Some(fold_set);
    campaign.data_bindings = BTreeMap::new();
    campaign.shape_plans = BTreeMap::new();
    let plan = build_execution_plan(
        "plan:target.missing.leak",
        simple_graph(),
        campaign,
        &manifests(),
    )
    .unwrap();
    let mut controllers = RuntimeControllerRegistry::new();
    controllers
        .register(Box::new(MockController {
            id: ControllerId::new("controller:transform").unwrap(),
            handle: 1,
            emit_prediction: false,
        }))
        .unwrap();
    controllers
        .register(Box::new(TargetMissingProbeController {
            id: ControllerId::new("controller:model").unwrap(),
            observed: Arc::default(),
            leak: Some(s2.clone()),
        }))
        .unwrap();
    let mut ctx = RunContext::new(RunId::new("run:target.missing.leak").unwrap(), Some(11));
    let error = SequentialScheduler
        .execute_campaign_phase(&plan, &controllers, &mut ctx, Phase::FitCv)
        .unwrap_err();
    let DagMlError::TargetMissing(report) = error else {
        panic!("expected a target-missing refusal, got {error}");
    };
    assert_eq!(report.reason, crate::TargetMissingRefusal::ScoredResult);
    assert_eq!(report.sample_ids, vec!["s2".to_string()]);
    assert!(ctx
        .prediction_store
        .blocks()
        .iter()
        .all(|block| !block.sample_ids.contains(&s2)));

    // Scoring targets are refused too, and test/final rows stay admissible.
    let declared = plan.fold_set.as_ref().unwrap();
    let mut result = NodeResult {
        schema_version: None,
        classification_probabilities: Vec::new(),
        consumed_data_views: BTreeMap::new(),
        node_id: NodeId::new("model:pls").unwrap(),
        outputs: BTreeMap::new(),
        predictions: vec![PredictionBlock {
            prediction_id: None,
            producer_node: NodeId::new("model:pls").unwrap(),
            producer_port: None,
            partition: PredictionPartition::Test,
            fold_id: None,
            sample_ids: vec![s2.clone()],
            values: vec![vec![1.0]],
            target_names: vec!["y".to_string()],
        }],
        observation_predictions: Vec::new(),
        aggregated_predictions: Vec::new(),
        explanations: Vec::new(),
        shape_deltas: Vec::new(),
        artifacts: Vec::new(),
        artifact_handles: BTreeMap::new(),
        fit_influence_diagnostics: Vec::new(),
        regression_targets: Vec::new(),
        lineage: ctx
            .lineage
            .records()
            .next()
            .cloned()
            .expect("the transform node recorded lineage before the refusal"),
    };
    result
        .validate_target_missing(declared, None, None)
        .unwrap();
    result
        .regression_targets
        .push(crate::metrics::RegressionTargetBlock {
            validity_masks: None,
            level: PredictionLevel::Sample,
            unit_ids: vec![crate::aggregation::PredictionUnitId::Sample(s2)],
            values: vec![vec![0.0]],
            target_names: vec!["y".to_string()],
        });
    assert!(matches!(
        result.validate_target_missing(declared, None, None),
        Err(DagMlError::TargetMissing(_))
    ));

    // Group units resolve through relations: a group made only of target-missing
    // samples is refused; a group with an observed member is scored as usual.
    result.regression_targets.clear();
    let grouped = |sample: &str, group: &str| {
        let mut record = SampleRelation::new(
            ObservationId::new(format!("obs.{sample}")).unwrap(),
            SampleId::new(sample).unwrap(),
        );
        record.group_id = Some(GroupId::new(group).unwrap());
        record
    };
    let relations = SampleRelationSet {
        records: vec![
            grouped("s2", "g.missing"),
            grouped("s1", "g.mixed"),
            grouped("s2", "g.mixed"),
        ],
    };
    let group_block = |group: &str| crate::aggregation::AggregatedPredictionBlock {
        prediction_id: None,
        producer_node: NodeId::new("model:pls").unwrap(),
        producer_port: None,
        partition: PredictionPartition::Validation,
        fold_id: None,
        level: PredictionLevel::Group,
        unit_ids: vec![crate::aggregation::PredictionUnitId::Group(
            GroupId::new(group).unwrap(),
        )],
        values: vec![vec![1.0]],
        target_names: vec!["y".to_string()],
    };
    result.aggregated_predictions = vec![group_block("g.mixed")];
    result
        .validate_target_missing(declared, Some(&relations), None)
        .unwrap();
    assert!(
        result
            .validate_target_missing(declared, None, None)
            .is_err(),
        "group rows cannot be checked without relations"
    );
    result.aggregated_predictions = vec![group_block("g.missing")];
    assert!(matches!(
        result.validate_target_missing(declared, Some(&relations), None),
        Err(DagMlError::TargetMissing(_))
    ));

    // Under a statistical grouping key, groups resolve through that relation metadata
    // only; an unrelated `group_id` with the same name neither masks nor blocks them.
    let statistical_key = crate::policy::AggregationGroupingKey::RelationMetadata {
        key: "independent_unit_id".into(),
    };
    let with_unit = |sample: &str, group: &str, unit: &str| {
        let mut record = grouped(sample, group);
        record
            .metadata
            .insert("independent_unit_id".into(), json!(unit));
        record
    };
    let collided = SampleRelationSet {
        records: vec![with_unit("s2", "g.other", "G"), grouped("s1", "G")],
    };
    result.aggregated_predictions = vec![group_block("G")];
    assert!(matches!(
        result.validate_target_missing(declared, Some(&collided), Some(&statistical_key)),
        Err(DagMlError::TargetMissing(_))
    ));
    // Ordinary group aggregation resolves `G` through `group_id` alone: `s1` is observed.
    result
        .validate_target_missing(declared, Some(&collided), None)
        .unwrap();
    let collided = SampleRelationSet {
        records: vec![grouped("s2", "G"), with_unit("s1", "g.other", "G")],
    };
    assert!(matches!(
        result.validate_target_missing(declared, Some(&collided), None),
        Err(DagMlError::TargetMissing(_))
    ));
    result
        .validate_target_missing(declared, Some(&collided), Some(&statistical_key))
        .unwrap();

    // A scored group without attested CV members is refused.
    result.aggregated_predictions = vec![group_block("unit.unknown")];
    assert!(result
        .validate_target_missing(declared, Some(&collided), None)
        .is_err());
    // Group-level scoring of test or final predictions resolves through a predict
    // cohort, not the CV relations, so it is refused under a declaration.
    for partition in [PredictionPartition::Test, PredictionPartition::Final] {
        let mut block = group_block("unit.external");
        block.partition = partition;
        result.aggregated_predictions = vec![block];
        result.regression_targets = vec![crate::metrics::RegressionTargetBlock {
            validity_masks: None,
            level: PredictionLevel::Group,
            unit_ids: vec![crate::aggregation::PredictionUnitId::Group(
                GroupId::new("unit.external").unwrap(),
            )],
            values: vec![vec![1.0]],
            target_names: vec!["y".to_string()],
        }];
        assert!(!result.target_missing_needs_relations());
        let error = result
            .validate_target_missing(declared, Some(&collided), None)
            .unwrap_err()
            .to_string();
        assert!(
            error.contains("group/target-level scoring targets"),
            "{error}"
        );
    }
    // Targets for another target name never pair with the prediction: no refusal.
    result.regression_targets[0].target_names = vec!["y1".to_string()];
    result.aggregated_predictions[0].target_names = vec!["y2".to_string()];
    result
        .validate_target_missing(declared, Some(&collided), None)
        .unwrap();
    result.regression_targets.clear();

    // Unscored (final) group predictions need no relations.
    let mut final_block = group_block("g.missing");
    final_block.partition = PredictionPartition::Final;
    result.aggregated_predictions = vec![final_block];
    assert!(!result.target_missing_needs_relations());
    result
        .validate_target_missing(declared, None, None)
        .unwrap();
}

#[test]
fn nested_stacking_scopes_keep_the_target_missing_declaration() {
    use crate::fold::KFoldSpec;
    let samples = (1..=12)
        .map(|index| SampleId::new(format!("s{index}")).unwrap())
        .collect::<Vec<_>>();
    let missing = BTreeSet::from([SampleId::new("s5").unwrap()]);
    let outer = KFoldSpec {
        n_splits: 3,
        shuffle: false,
        seed: Some(7),
    }
    .split_with_target_missing("outer", &samples, &missing)
    .unwrap();
    let plan = nested_stacking_test_plan(outer, true);
    let stacking = nested_stacking_campaign_plan(&plan).unwrap().unwrap();
    let declared = vec![SampleId::new("s5").unwrap()];
    for scope in &stacking.outer_scopes {
        assert_eq!(
            scope.inner.inner_fold_set.target_missing_sample_ids,
            declared
        );
    }
    let refit = stacking
        .refit_fold_set
        .as_ref()
        .expect("partitioned REFIT OOF");
    assert_eq!(refit.target_missing_sample_ids, declared);
    assert!(!refit.sample_ids.contains(&declared[0]));
}

#[test]
fn target_missing_declarations_refuse_unbounded_fit_views() {
    let fold_set = three_fold_stress_set()
        .exclude_target_missing(&BTreeSet::from([SampleId::new("s2").unwrap()]))
        .unwrap();
    let node_id = NodeId::new("node:model").unwrap();
    let binding = data_binding(&node_id);
    let unbounded = PhaseScope {
        phase: Phase::FitCv,
        variant_id: None,
        variant: None,
        fold_id: None,
        seed_root: None,
    };
    let error = data_view_for_partition(
        &binding,
        Some(&fold_set),
        &unbounded,
        DataRequestPartition::FoldTrain,
        None,
        DataViewRole::Fit,
        &BTreeSet::new(),
    )
    .unwrap_err()
    .to_string();
    assert!(error.contains("unbounded"), "{error}");
    // Without a declaration the historical unbounded view is unchanged.
    data_view_for_partition(
        &binding,
        Some(&three_fold_stress_set()),
        &unbounded,
        DataRequestPartition::FoldTrain,
        None,
        DataViewRole::Fit,
        &BTreeSet::new(),
    )
    .unwrap();
}

#[test]
fn target_missing_declarations_refuse_all_observations_fit_views() {
    let s2 = SampleId::new("s2").unwrap();
    let fold_set = three_fold_stress_set()
        .exclude_target_missing(&BTreeSet::from([s2]))
        .unwrap();
    let model_id = NodeId::new("model:pls").unwrap();
    let mut binding = data_binding(&model_id);
    binding.view_policy.fit_partition = DataRequestPartition::AllObservations;
    binding
        .view_policy
        .unsafe_flags
        .insert(crate::data::DataViewPolicy::ALLOW_FIT_CV_ALL_OBSERVATIONS_VIEW.to_string());
    let mut campaign = oof_edge_campaign();
    campaign.split_invocation.as_mut().unwrap().fold_set = Some(fold_set);
    campaign.data_bindings = BTreeMap::from([(model_id, vec![binding])]);
    let error = build_execution_plan(
        "plan:target.missing.all",
        simple_graph(),
        campaign,
        &manifests(),
    )
    .unwrap_err();
    assert!(
        error.to_string().contains("all-observations fit view"),
        "{error}"
    );
}

#[test]
fn exclusion_is_sample_local_across_relation_rows() {
    // (c) A sample with one excluded relation row and one non-excluded row is
    // fully dropped from training (sample-local exclusion).
    let mut base = SampleRelation::new(
        ObservationId::new("obs.s2.base").unwrap(),
        SampleId::new("s2").unwrap(),
    );
    base.excluded = false;
    let mut rep = SampleRelation::new(
        ObservationId::new("obs.s2.rep1").unwrap(),
        SampleId::new("s2").unwrap(),
    );
    rep.excluded = true; // only the second row is excluded
    let kept = SampleRelation::new(
        ObservationId::new("obs.s1.base").unwrap(),
        SampleId::new("s1").unwrap(),
    );
    let relations = SampleRelationSet {
        records: vec![base, rep, kept],
    };
    let excluded = relations.excluded_sample_ids();
    assert!(
        excluded.contains(&SampleId::new("s2").unwrap()),
        "a sample with ANY excluded row is excluded sample-locally"
    );
    assert!(!excluded.contains(&SampleId::new("s1").unwrap()));

    let node_id = NodeId::new("node:model").unwrap();
    let binding = data_binding(&node_id);
    let fold_set = three_fold_stress_set();
    let fold_id = fold_set.folds[0].fold_id.clone(); // train=[s1,s2,s4,s5]
    let scope = PhaseScope {
        phase: Phase::FitCv,
        variant_id: None,
        variant: None,
        fold_id: Some(fold_id),
        seed_root: None,
    };
    let train_view = data_view_for_partition(
        &binding,
        Some(&fold_set),
        &scope,
        DataRequestPartition::FoldTrain,
        None,
        DataViewRole::Fit,
        &excluded,
    )
    .unwrap();
    assert!(
        !train_view
            .sample_ids
            .as_ref()
            .unwrap()
            .contains(&SampleId::new("s2").unwrap()),
        "s2 must be fully dropped from training even though one of its rows is not excluded"
    );
}

#[test]
fn by_metadata_and_by_tag_branch_selectors_reach_the_provider_view_spec() {
    // The metadata/tag branch selector must survive the scheduler's
    // `data_view_for_partition` path and arrive intact on the
    // `DataProviderViewSpec.branch_view` that is handed to the provider's
    // `make_view` (where dag-ml-data's `filter_relations` matches it natively).
    use crate::data::{BranchViewMode, BranchViewPlan, DataViewSelector};

    let node_id = NodeId::new("node:model").unwrap();
    let binding = data_binding(&node_id);
    let empty: BTreeSet<SampleId> = BTreeSet::new();
    let scope = PhaseScope {
        phase: Phase::Predict,
        variant_id: None,
        variant: None,
        fold_id: None,
        seed_root: None,
    };

    let metadata_branch = BranchViewPlan {
        view_id: "branch_view:group_a".to_string(),
        branch_id: "branch:group_a".to_string(),
        mode: BranchViewMode::ByMetadata,
        selector: DataViewSelector {
            metadata: BTreeMap::from([("group".to_string(), serde_json::json!("A"))]),
            ..Default::default()
        },
        allow_overlap: false,
        metadata: BTreeMap::new(),
    };
    let metadata_view = data_view_for_partition(
        &binding,
        None,
        &scope,
        DataRequestPartition::Predict,
        Some(&metadata_branch),
        DataViewRole::NonFit,
        &empty,
    )
    .unwrap();
    let carried = metadata_view
        .branch_view
        .as_ref()
        .expect("by_metadata selector must reach the provider view spec");
    assert_eq!(carried.mode, BranchViewMode::ByMetadata);
    assert_eq!(
        carried.selector.metadata.get("group"),
        Some(&serde_json::json!("A")),
        "by_metadata selector value must reach the provider unchanged"
    );

    let tag_branch = BranchViewPlan {
        view_id: "branch_view:clean".to_string(),
        branch_id: "branch:clean".to_string(),
        mode: BranchViewMode::ByTag,
        selector: DataViewSelector {
            tags: vec!["clean".to_string()],
            ..Default::default()
        },
        allow_overlap: false,
        metadata: BTreeMap::new(),
    };
    let tag_view = data_view_for_partition(
        &binding,
        None,
        &scope,
        DataRequestPartition::Predict,
        Some(&tag_branch),
        DataViewRole::NonFit,
        &empty,
    )
    .unwrap();
    let carried_tags = tag_view
        .branch_view
        .as_ref()
        .expect("by_tag selector must reach the provider view spec");
    assert_eq!(carried_tags.mode, BranchViewMode::ByTag);
    assert_eq!(
        carried_tags.selector.tags,
        vec!["clean".to_string()],
        "by_tag selector must reach the provider unchanged"
    );
    // The spec itself must validate (the branch view validation runs here too).
    metadata_view.validate().unwrap();
    tag_view.validate().unwrap();
}

// ----- Slice 2: data-aware fan-out per-branch FIT_CV scoping -----

/// One recorded FIT_CV task observation:
/// `(node_id, fold_id, branch-view "site" value, validation sample ids)`.
type BranchScopeObservation = (String, String, Option<serde_json::Value>, Vec<String>);

/// Records, per (node_id, fold_id), the branch-view selector value and the
/// validation-view sample ids the runtime hands to the controller, then emits a
/// validation OOF block scoped to ITS PARTITION. A real branch model node only
/// sees the samples the data provider returns after applying the branch_view
/// metadata filter (the partition ∩ fold-validation intersection), so this mock
/// reproduces that by intersecting the fold-validation ids with the samples whose
/// recorded site equals the node's branch_view selector value — and detects the
/// empty intersection explicitly rather than silently emitting nothing.
struct BranchScopeRecordingController {
    id: ControllerId,
    handle: u64,
    /// sample id -> site value, the membership the data provider would filter by.
    sample_sites: BTreeMap<String, String>,
    /// When true, an empty partition ∩ fold is a hard error (mirrors the
    /// dag-ml-data provider's "data view selected no coordinator relations").
    /// When false, the branch+fold is skipped with no OOF block (the alternative
    /// explicit handling: never silently duplicate/mis-cover).
    error_on_empty_intersection: bool,
    seen: Arc<Mutex<Vec<BranchScopeObservation>>>,
}

impl RuntimeController for BranchScopeRecordingController {
    fn controller_id(&self) -> &ControllerId {
        &self.id
    }

    fn invoke(&self, task: &NodeTask) -> Result<NodeResult> {
        let node_id = task.node_plan.node_id.to_string();
        let fold_label = task
            .fold_id
            .as_ref()
            .map(ToString::to_string)
            .unwrap_or_else(|| "nofold".to_string());
        // The validation companion view carries this node's branch_view selector.
        let validation_view = task
            .data_views
            .iter()
            .find(|(_, view)| view.partition == DataRequestPartition::FoldValidation)
            .map(|(_, view)| view);
        let branch_value = validation_view
            .and_then(|view| view.branch_view.as_ref())
            .and_then(|branch| branch.selector.metadata.get("site").cloned());
        let branch_site = branch_value.as_ref().and_then(|value| value.as_str());
        // The fold's full validation sample ids carried by the spec.
        let fold_validation_ids: Vec<String> = validation_view
            .and_then(|view| view.sample_ids.clone())
            .unwrap_or_default()
            .iter()
            .map(ToString::to_string)
            .collect();
        // Partition ∩ fold-validation: only the fold-validation samples whose site
        // matches this branch's selector (what the data provider would return).
        let partition_ids: Vec<String> = match branch_site {
            Some(site) => fold_validation_ids
                .iter()
                .filter(|sample| {
                    self.sample_sites
                        .get(*sample)
                        .map(|s| s == site)
                        .unwrap_or(false)
                })
                .cloned()
                .collect(),
            None => fold_validation_ids.clone(),
        };
        self.seen.lock().unwrap().push((
            node_id,
            fold_label.clone(),
            branch_value.clone(),
            partition_ids.clone(),
        ));

        let prediction_output = HandleRef {
            handle: self.handle,
            kind: HandleKind::Prediction,
            owner_controller: self.id.clone(),
        };
        let data_output = HandleRef {
            handle: self.handle,
            kind: HandleKind::Data,
            owner_controller: self.id.clone(),
        };
        // Explicit empty partition ∩ fold handling: error or skip, never emit a
        // silently-empty OOF block that would mis-cover the partition. When not
        // erroring, the empty (branch, fold) is simply skipped below (no block).
        if task.phase == Phase::FitCv
            && task.fold_id.is_some()
            && partition_ids.is_empty()
            && self.error_on_empty_intersection
        {
            return Err(DagMlError::RuntimeValidation(format!(
                "branch node `{}` has no samples in fold {} for its partition (empty \
                 partition ∩ fold)",
                task.node_plan.node_id, fold_label
            )));
        }
        let predictions = if task.phase == Phase::FitCv && !partition_ids.is_empty() {
            vec![PredictionBlock {
                prediction_id: Some(format!("pred:{}", task.node_plan.node_id)),
                producer_node: task.node_plan.node_id.clone(),
                producer_port: None,
                partition: PredictionPartition::Validation,
                fold_id: task.fold_id.clone(),
                sample_ids: partition_ids
                    .iter()
                    .map(|s| SampleId::new(s).unwrap())
                    .collect(),
                values: vec![vec![1.0]; partition_ids.len()],
                target_names: vec!["y".to_string()],
            }]
        } else {
            Vec::new()
        };
        Ok(NodeResult {
            schema_version: None,
            classification_probabilities: Vec::new(),
            consumed_data_views: std::collections::BTreeMap::new(),
            node_id: task.node_plan.node_id.clone(),
            outputs: BTreeMap::from([
                ("pred".to_string(), prediction_output.clone()),
                ("oof".to_string(), prediction_output),
                ("x".to_string(), data_output),
            ]),
            predictions,
            observation_predictions: Vec::new(),
            aggregated_predictions: Vec::new(),
            explanations: Vec::new(),
            shape_deltas: Vec::new(),
            artifacts: Vec::new(),
            artifact_handles: BTreeMap::new(),
            fit_influence_diagnostics: Vec::new(),
            regression_targets: Vec::new(),
            lineage: LineageRecord {
                record_id: LineageId::new(format!(
                    "lineage:{}:{fold_label}",
                    task.node_plan.node_id
                ))
                .unwrap(),
                run_id: task.run_id.clone(),
                node_id: task.node_plan.node_id.clone(),
                phase: task.phase,
                controller_id: self.id.clone(),
                controller_version: task.node_plan.controller_version.clone(),
                variant_id: task.variant_id.clone(),
                fold_id: task.fold_id.clone(),
                branch_path: task.branch_path.clone(),
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
                target_domain: None,
            },
        })
    }
}

/// A branch model controller that emits a validation OOF block over the WHOLE
/// fold validation set (ignoring any partition filter). Two such branches feeding
/// one concat-merge therefore overlap on every sample — the non-disjoint input
/// the merge handler must refuse. Used by the overlap-guard test.
struct OverlapEmittingController {
    id: ControllerId,
    handle: u64,
}

impl RuntimeController for OverlapEmittingController {
    fn controller_id(&self) -> &ControllerId {
        &self.id
    }

    fn invoke(&self, task: &NodeTask) -> Result<NodeResult> {
        let fold_label = task
            .fold_id
            .as_ref()
            .map(ToString::to_string)
            .unwrap_or_else(|| "nofold".to_string());
        let validation_view = task
            .data_views
            .iter()
            .find(|(_, view)| view.partition == DataRequestPartition::FoldValidation)
            .map(|(_, view)| view);
        let fold_validation_ids: Vec<SampleId> = validation_view
            .and_then(|view| view.sample_ids.clone())
            .unwrap_or_default();
        let prediction_output = HandleRef {
            handle: self.handle,
            kind: HandleKind::Prediction,
            owner_controller: self.id.clone(),
        };
        let data_output = HandleRef {
            handle: self.handle,
            kind: HandleKind::Data,
            owner_controller: self.id.clone(),
        };
        let predictions = if task.phase == Phase::FitCv && !fold_validation_ids.is_empty() {
            vec![PredictionBlock {
                prediction_id: Some(format!("pred:{}", task.node_plan.node_id)),
                producer_node: task.node_plan.node_id.clone(),
                producer_port: None,
                partition: PredictionPartition::Validation,
                fold_id: task.fold_id.clone(),
                sample_ids: fold_validation_ids.clone(),
                values: vec![vec![1.0]; fold_validation_ids.len()],
                target_names: vec!["y".to_string()],
            }]
        } else {
            Vec::new()
        };
        Ok(NodeResult {
            schema_version: None,
            classification_probabilities: Vec::new(),
            consumed_data_views: std::collections::BTreeMap::new(),
            node_id: task.node_plan.node_id.clone(),
            outputs: BTreeMap::from([
                ("pred".to_string(), prediction_output.clone()),
                ("oof".to_string(), prediction_output),
                ("x".to_string(), data_output),
            ]),
            predictions,
            observation_predictions: Vec::new(),
            aggregated_predictions: Vec::new(),
            explanations: Vec::new(),
            shape_deltas: Vec::new(),
            artifacts: Vec::new(),
            artifact_handles: BTreeMap::new(),
            fit_influence_diagnostics: Vec::new(),
            regression_targets: Vec::new(),
            lineage: LineageRecord {
                record_id: LineageId::new(format!(
                    "lineage:{}:{fold_label}",
                    task.node_plan.node_id
                ))
                .unwrap(),
                run_id: task.run_id.clone(),
                node_id: task.node_plan.node_id.clone(),
                phase: task.phase,
                controller_id: self.id.clone(),
                controller_version: task.node_plan.controller_version.clone(),
                variant_id: task.variant_id.clone(),
                fold_id: task.fold_id.clone(),
                branch_path: task.branch_path.clone(),
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
                target_domain: None,
            },
        })
    }
}

/// A model node carrying a `dsl_branch_view_plan` by_metadata selector for one
/// site value — exactly the shape `fan_out_data_aware_branches` + compile emit.
fn branch_model_node(node_id: &str, site: &str) -> NodeSpec {
    use crate::data::{BranchViewMode, BranchViewPlan, DataViewSelector};
    let plan = BranchViewPlan {
        view_id: format!("branch_view:per_site__{site}"),
        branch_id: format!("per_site__{site}"),
        mode: BranchViewMode::ByMetadata,
        selector: DataViewSelector {
            metadata: BTreeMap::from([("site".to_string(), serde_json::json!(site))]),
            ..Default::default()
        },
        allow_overlap: false,
        metadata: BTreeMap::new(),
    };
    let mut node = node(
        node_id,
        NodeKind::Model,
        vec![port("x", PortKind::Data)],
        vec![port("oof", PortKind::Prediction)],
    );
    node.metadata.insert(
        "dsl_branch_view_plan".to_string(),
        serde_json::to_value(&plan).unwrap(),
    );
    node
}

#[test]
fn fanned_out_branches_each_fit_cv_only_their_partition() {
    // Two fanned-out branch model nodes (one per discovered site A/B), each
    // scoped to its partition by a dsl_branch_view_plan in node metadata — the
    // shape the data-aware fan-out + compile produce. A 2-fold KFold over four
    // samples drives FIT_CV; we assert each branch node, across both folds,
    // receives a validation view carrying ITS OWN branch_view selector and the
    // fold's validation samples (the intersection that yields per-partition OOF).
    let node_a = branch_model_node("model:site__A", "A");
    let node_b = branch_model_node("model:site__B", "B");
    let graph = GraphSpec {
        id: "graph:fanout.scope".to_string(),
        interface: GraphInterface::default(),
        nodes: vec![node_a, node_b],
        edges: Vec::new(),
        search_space_fingerprint: None,
        metadata: BTreeMap::new(),
    };

    let id_a = NodeId::new("model:site__A").unwrap();
    let id_b = NodeId::new("model:site__B").unwrap();
    let samples: Vec<SampleId> = ["sample:1", "sample:2", "sample:3", "sample:4"]
        .iter()
        .map(|s| SampleId::new(*s).unwrap())
        .collect();
    let fold_set = FoldSet {
        id: "folds:fanout.scope".to_string(),
        sample_ids: samples.clone(),
        folds: vec![
            FoldAssignment {
                fold_id: FoldId::new("fold:0").unwrap(),
                train_sample_ids: vec![samples[2].clone(), samples[3].clone()],
                validation_sample_ids: vec![samples[0].clone(), samples[1].clone()],
                metadata: BTreeMap::new(),
            },
            FoldAssignment {
                fold_id: FoldId::new("fold:1").unwrap(),
                train_sample_ids: vec![samples[0].clone(), samples[1].clone()],
                validation_sample_ids: vec![samples[2].clone(), samples[3].clone()],
                metadata: BTreeMap::new(),
            },
        ],
        sample_groups: BTreeMap::new(),
        partition_mode: FoldPartitionMode::Partition,
        train_exclusion: FoldTrainExclusion::Relations,
        target_missing_sample_ids: Vec::new(),
    };
    let campaign = CampaignSpec {
        inner_cv: None,
        id: "campaign:fanout.scope".to_string(),
        root_seed: Some(7),
        leakage_policy: Default::default(),
        aggregation_policy: Default::default(),
        split_invocation: Some(SplitInvocation {
            id: "split:fanout.scope".to_string(),
            controller_id: None,
            leakage_policy: Default::default(),
            params: BTreeMap::new(),
            fold_set: Some(fold_set),
        }),
        generation: Default::default(),
        shape_plans: BTreeMap::new(),
        data_bindings: BTreeMap::from([
            (id_a.clone(), vec![data_binding(&id_a)]),
            (id_b.clone(), vec![data_binding(&id_b)]),
        ]),
        branch_view_plans: Vec::new(),
        metadata: BTreeMap::new(),
    };
    let mut registry = ControllerRegistry::new();
    registry
        .register(controller_manifest("controller:model", NodeKind::Model))
        .unwrap();
    let plan = build_execution_plan("plan:fanout.scope", graph, campaign, &registry).unwrap();

    // The envelope carries 4 samples across two sites; require_relations is set,
    // so registering it is enough for the InMemoryDataProvider to materialize.
    let envelope = sample_relations_envelope(&[
        ("sample:1", "A"),
        ("sample:2", "B"),
        ("sample:3", "A"),
        ("sample:4", "B"),
    ]);
    let data_provider = InMemoryDataProvider::with_envelope(
        ControllerId::new("controller:data").unwrap(),
        envelope,
    )
    .unwrap();

    let seen = Arc::new(Mutex::new(Vec::new()));
    let mut controllers = RuntimeControllerRegistry::new();
    controllers
        .register(Box::new(BranchScopeRecordingController {
            id: ControllerId::new("controller:model").unwrap(),
            handle: 1,
            sample_sites: BTreeMap::from([
                ("sample:1".to_string(), "A".to_string()),
                ("sample:2".to_string(), "B".to_string()),
                ("sample:3".to_string(), "A".to_string()),
                ("sample:4".to_string(), "B".to_string()),
            ]),
            error_on_empty_intersection: false,
            seen: Arc::clone(&seen),
        }))
        .unwrap();
    let mut ctx = RunContext::new(RunId::new("run:fanout.scope").unwrap(), Some(7));

    SequentialScheduler
        .execute_campaign_phase_with_data_provider(
            &plan,
            &controllers,
            &data_provider,
            &mut ctx,
            Phase::FitCv,
        )
        .unwrap();

    let seen = seen.lock().unwrap().clone();
    // Two branch nodes x two folds = four FIT_CV tasks.
    assert_eq!(seen.len(), 4, "expected one task per (branch, fold)");
    // Every branch-A task is scoped to site A; every branch-B task to site B.
    for (node_id, _fold, branch_value, _val_ids) in &seen {
        let expected = if node_id.ends_with("__A") { "A" } else { "B" };
        assert_eq!(
            branch_value.as_ref(),
            Some(&serde_json::json!(expected)),
            "node `{node_id}` must be scoped to its own partition `{expected}`"
        );
    }
    // Realistic per-partition OOF: each branch validates ONLY its partition's
    // samples (partition ∩ fold-validation), never the full universe. Site A owns
    // {sample:1, sample:3}; site B owns {sample:2, sample:4}.
    let oof_blocks = ctx.prediction_store.blocks();
    assert_eq!(oof_blocks.len(), 4, "one OOF block per (branch, fold)");
    for block in oof_blocks {
        assert_eq!(block.partition, PredictionPartition::Validation);
        assert!(
            !block.sample_ids.is_empty(),
            "a non-empty partition ∩ fold must produce a non-empty OOF block"
        );
    }
    let expected_partition = BTreeMap::from([
        (
            "model:site__A",
            vec!["sample:1".to_string(), "sample:3".to_string()],
        ),
        (
            "model:site__B",
            vec!["sample:2".to_string(), "sample:4".to_string()],
        ),
    ]);
    for (node, expected) in &expected_partition {
        let mut ids: Vec<String> = oof_blocks
            .iter()
            .filter(|block| block.producer_node.as_str() == *node)
            .flat_map(|block| block.sample_ids.iter().map(ToString::to_string))
            .collect();
        ids.sort();
        assert_eq!(
            &ids, expected,
            "branch `{node}` must validate ONLY its own partition's samples across folds"
        );
    }
}

/// A `PredictionJoin` concat-merge node reassembling N branch OOF blocks — the
/// shape Slice 3 (native merge) handles. `merge_mode="concat"` in node metadata
/// marks it as a separation-branch reassembly (vs the default stacking merge),
/// and one prediction input port per upstream branch carries an OOF edge.
fn concat_merge_node(node_id: &str, branch_ids: &[&str]) -> NodeSpec {
    let mut node = node(
        node_id,
        NodeKind::PredictionJoin,
        branch_ids
            .iter()
            .map(|branch| port(&format!("oof_{branch}"), PortKind::Prediction))
            .collect(),
        vec![port("oof", PortKind::Prediction)],
    );
    node.metadata.insert(
        "merge_mode".to_string(),
        serde_json::Value::String("concat".to_string()),
    );
    node
}

/// Branch OOF edge: `branch.oof -> merge.oof_<branch>`, carrying the
/// `requires_oof` and `requires_fold_alignment` contract the real merge DSL
/// emits. The native merge handler intercepts the node BEFORE this edge is
/// resolved, so it never trips the full-fold OOF validation that the
/// partition-covering branch inputs would fail.
fn branch_to_merge_edge(branch_id: &str, merge_id: &str) -> EdgeSpec {
    EdgeSpec {
        source: PortRef {
            node_id: NodeId::new(branch_id).unwrap(),
            port_name: "oof".to_string(),
        },
        target: PortRef {
            node_id: NodeId::new(merge_id).unwrap(),
            port_name: format!("oof_{branch_id}"),
        },
        contract: EdgeContract {
            requires_oof: true,
            requires_fold_alignment: true,
            ..EdgeContract::new(PortKind::Prediction, None)
        },
    }
}

/// A controller manifest for the concat-merge node so `build_execution_plan`
/// resolves a `controller_id` for it. The merge node never actually runs through
/// this controller — the native scheduler handler reassembles it — but the plan
/// still needs a manifest (and thread/process safety for the parallel scheduler).
fn merge_controller_manifest(id: &str) -> ControllerManifest {
    let mut manifest = controller_manifest(id, NodeKind::PredictionJoin);
    manifest.supported_phases = BTreeSet::from([Phase::FitCv, Phase::Refit, Phase::Predict]);
    manifest
        .capabilities
        .insert(ControllerCapability::ConsumesOofPredictions);
    manifest
        .capabilities
        .insert(ControllerCapability::EmitsPredictions);
    manifest
}

#[test]
fn concat_merge_reassembles_disjoint_branch_oof_into_full_universe() {
    // A fanned-out (Slice 2) + merged separation campaign: two branch model nodes
    // (sites A/B, each scoped to its partition) feed one concat-merge node. A
    // 2-fold KFold over four samples drives FIT_CV; each branch emits per-partition
    // OOF (its partition ∩ fold validation), and the merge node must reassemble the
    // disjoint per-partition blocks into ONE per-sample OOF block covering the full
    // validation universe exactly once.
    let node_a = branch_model_node("model:site__A", "A");
    let node_b = branch_model_node("model:site__B", "B");
    let merge = concat_merge_node("merge:sites", &["model:site__A", "model:site__B"]);
    let graph = GraphSpec {
        id: "graph:merge.scope".to_string(),
        interface: GraphInterface::default(),
        nodes: vec![node_a, node_b, merge],
        edges: vec![
            branch_to_merge_edge("model:site__A", "merge:sites"),
            branch_to_merge_edge("model:site__B", "merge:sites"),
        ],
        search_space_fingerprint: None,
        metadata: BTreeMap::new(),
    };

    let id_a = NodeId::new("model:site__A").unwrap();
    let id_b = NodeId::new("model:site__B").unwrap();
    let merge_id = NodeId::new("merge:sites").unwrap();
    let samples: Vec<SampleId> = ["sample:1", "sample:2", "sample:3", "sample:4"]
        .iter()
        .map(|s| SampleId::new(*s).unwrap())
        .collect();
    let fold_set = FoldSet {
        id: "folds:merge.scope".to_string(),
        sample_ids: samples.clone(),
        folds: vec![
            FoldAssignment {
                fold_id: FoldId::new("fold:0").unwrap(),
                train_sample_ids: vec![samples[2].clone(), samples[3].clone()],
                validation_sample_ids: vec![samples[0].clone(), samples[1].clone()],
                metadata: BTreeMap::new(),
            },
            FoldAssignment {
                fold_id: FoldId::new("fold:1").unwrap(),
                train_sample_ids: vec![samples[0].clone(), samples[1].clone()],
                validation_sample_ids: vec![samples[2].clone(), samples[3].clone()],
                metadata: BTreeMap::new(),
            },
        ],
        sample_groups: BTreeMap::new(),
        partition_mode: FoldPartitionMode::Partition,
        train_exclusion: FoldTrainExclusion::Relations,
        target_missing_sample_ids: Vec::new(),
    };
    let campaign = CampaignSpec {
        inner_cv: None,
        id: "campaign:merge.scope".to_string(),
        root_seed: Some(7),
        leakage_policy: Default::default(),
        aggregation_policy: Default::default(),
        split_invocation: Some(SplitInvocation {
            id: "split:merge.scope".to_string(),
            controller_id: None,
            leakage_policy: Default::default(),
            params: BTreeMap::new(),
            fold_set: Some(fold_set),
        }),
        generation: Default::default(),
        shape_plans: BTreeMap::new(),
        data_bindings: BTreeMap::from([
            (id_a.clone(), vec![data_binding(&id_a)]),
            (id_b.clone(), vec![data_binding(&id_b)]),
        ]),
        branch_view_plans: Vec::new(),
        metadata: BTreeMap::new(),
    };
    let mut registry = ControllerRegistry::new();
    registry
        .register(controller_manifest("controller:model", NodeKind::Model))
        .unwrap();
    registry
        .register(merge_controller_manifest("controller:merge"))
        .unwrap();
    let plan = build_execution_plan("plan:merge.scope", graph, campaign, &registry).unwrap();

    let envelope = sample_relations_envelope(&[
        ("sample:1", "A"),
        ("sample:2", "B"),
        ("sample:3", "A"),
        ("sample:4", "B"),
    ]);
    let data_provider = InMemoryDataProvider::with_envelope(
        ControllerId::new("controller:data").unwrap(),
        envelope,
    )
    .unwrap();

    let mut controllers = RuntimeControllerRegistry::new();
    controllers
        .register(Box::new(BranchScopeRecordingController {
            id: ControllerId::new("controller:model").unwrap(),
            handle: 1,
            sample_sites: BTreeMap::from([
                ("sample:1".to_string(), "A".to_string()),
                ("sample:2".to_string(), "B".to_string()),
                ("sample:3".to_string(), "A".to_string()),
                ("sample:4".to_string(), "B".to_string()),
            ]),
            error_on_empty_intersection: false,
            seen: Arc::new(Mutex::new(Vec::new())),
        }))
        .unwrap();
    // No merge controller is registered in the RUNTIME registry on purpose: the
    // native handler must reassemble without invoking any controller.
    let mut ctx = RunContext::new(RunId::new("run:merge.scope").unwrap(), Some(7));

    SequentialScheduler
        .execute_campaign_phase_with_data_provider(
            &plan,
            &controllers,
            &data_provider,
            &mut ctx,
            Phase::FitCv,
        )
        .unwrap();

    // The merge node emits exactly ONE OOF block per fold (two folds), each
    // covering the full fold validation set — not per-partition like the branches.
    let merge_blocks: Vec<&PredictionBlock> = ctx
        .prediction_store
        .blocks()
        .iter()
        .filter(|block| block.producer_node == merge_id)
        .collect();
    assert_eq!(
        merge_blocks.len(),
        2,
        "merge node must emit one reassembled OOF block per fold"
    );

    // Per-fold reassembly covers the fold's full validation set, each sample once.
    let mut fold0: Vec<String> = merge_blocks
        .iter()
        .find(|block| block.fold_id.as_ref().unwrap().as_str() == "fold:0")
        .unwrap()
        .sample_ids
        .iter()
        .map(ToString::to_string)
        .collect();
    fold0.sort();
    assert_eq!(
        fold0,
        vec!["sample:1".to_string(), "sample:2".to_string()],
        "fold:0 merge covers its full validation set (A:sample:1 + B:sample:2)"
    );
    let mut fold1: Vec<String> = merge_blocks
        .iter()
        .find(|block| block.fold_id.as_ref().unwrap().as_str() == "fold:1")
        .unwrap()
        .sample_ids
        .iter()
        .map(ToString::to_string)
        .collect();
    fold1.sort();
    assert_eq!(
        fold1,
        vec!["sample:3".to_string(), "sample:4".to_string()],
        "fold:1 merge covers its full validation set (A:sample:3 + B:sample:4)"
    );

    // Across folds, the merge's OOF covers the FULL sample universe exactly once.
    let mut all_merged: Vec<String> = merge_blocks
        .iter()
        .flat_map(|block| block.sample_ids.iter().map(ToString::to_string))
        .collect();
    all_merged.sort();
    assert_eq!(
        all_merged,
        vec![
            "sample:1".to_string(),
            "sample:2".to_string(),
            "sample:3".to_string(),
            "sample:4".to_string()
        ],
        "the merged OOF must cover every sample exactly once across folds"
    );

    // Each merged block passes the normal full-fold OOF completeness validation
    // (the per-branch partition inputs would fail it; the reassembly does not).
    let fold_set = plan.fold_set.as_ref().unwrap();
    crate::oof::validate_prediction_blocks_against_folds(fold_set, &[(*merge_blocks[0]).clone()])
        .expect("reassembled OOF block passes full-fold completeness");
    crate::oof::validate_prediction_blocks_against_folds(fold_set, &[(*merge_blocks[1]).clone()])
        .expect("reassembled OOF block passes full-fold completeness");

    // The merge lineage links its contributing branches (full traceability).
    let merge_lineage = ctx
        .lineage
        .records()
        .find(|record| {
            record.node_id == merge_id && record.fold_id.as_ref().unwrap().as_str() == "fold:0"
        })
        .expect("merge node recorded lineage");
    assert_eq!(
        merge_lineage.input_lineage.len(),
        2,
        "merge lineage references both branch producers for the fold"
    );
}

#[test]
fn concat_merge_rejects_overlapping_branch_predictions() {
    // Guard: if two branches both claim the same sample (a non-disjoint partition,
    // which separation must never produce), the reassembly is a hard error rather
    // than silently double-covering. Here BOTH branch controllers claim every
    // fold-validation sample (site filter disabled), so their OOF blocks overlap.
    let node_a = branch_model_node("model:site__A", "A");
    let node_b = branch_model_node("model:site__B", "B");
    let merge = concat_merge_node("merge:sites", &["model:site__A", "model:site__B"]);
    let graph = GraphSpec {
        id: "graph:merge.overlap".to_string(),
        interface: GraphInterface::default(),
        nodes: vec![node_a, node_b, merge],
        edges: vec![
            branch_to_merge_edge("model:site__A", "merge:sites"),
            branch_to_merge_edge("model:site__B", "merge:sites"),
        ],
        search_space_fingerprint: None,
        metadata: BTreeMap::new(),
    };
    let id_a = NodeId::new("model:site__A").unwrap();
    let id_b = NodeId::new("model:site__B").unwrap();
    let samples: Vec<SampleId> = ["sample:1", "sample:2", "sample:3", "sample:4"]
        .iter()
        .map(|s| SampleId::new(*s).unwrap())
        .collect();
    let fold_set = FoldSet {
        id: "folds:merge.overlap".to_string(),
        sample_ids: samples.clone(),
        folds: vec![
            FoldAssignment {
                fold_id: FoldId::new("fold:0").unwrap(),
                train_sample_ids: vec![samples[2].clone(), samples[3].clone()],
                validation_sample_ids: vec![samples[0].clone(), samples[1].clone()],
                metadata: BTreeMap::new(),
            },
            FoldAssignment {
                fold_id: FoldId::new("fold:1").unwrap(),
                train_sample_ids: vec![samples[0].clone(), samples[1].clone()],
                validation_sample_ids: vec![samples[2].clone(), samples[3].clone()],
                metadata: BTreeMap::new(),
            },
        ],
        sample_groups: BTreeMap::new(),
        partition_mode: FoldPartitionMode::Partition,
        train_exclusion: FoldTrainExclusion::Relations,
        target_missing_sample_ids: Vec::new(),
    };
    let campaign = CampaignSpec {
        inner_cv: None,
        id: "campaign:merge.overlap".to_string(),
        root_seed: Some(7),
        leakage_policy: Default::default(),
        aggregation_policy: Default::default(),
        split_invocation: Some(SplitInvocation {
            id: "split:merge.overlap".to_string(),
            controller_id: None,
            leakage_policy: Default::default(),
            params: BTreeMap::new(),
            fold_set: Some(fold_set),
        }),
        generation: Default::default(),
        shape_plans: BTreeMap::new(),
        data_bindings: BTreeMap::from([
            (id_a.clone(), vec![data_binding(&id_a)]),
            (id_b.clone(), vec![data_binding(&id_b)]),
        ]),
        branch_view_plans: Vec::new(),
        metadata: BTreeMap::new(),
    };
    let mut registry = ControllerRegistry::new();
    registry
        .register(controller_manifest("controller:model", NodeKind::Model))
        .unwrap();
    registry
        .register(merge_controller_manifest("controller:merge"))
        .unwrap();
    let plan = build_execution_plan("plan:merge.overlap", graph, campaign, &registry).unwrap();
    let envelope = sample_relations_envelope(&[
        ("sample:1", "A"),
        ("sample:2", "B"),
        ("sample:3", "A"),
        ("sample:4", "B"),
    ]);
    let data_provider = InMemoryDataProvider::with_envelope(
        ControllerId::new("controller:data").unwrap(),
        envelope,
    )
    .unwrap();
    let mut controllers = RuntimeControllerRegistry::new();
    // EMPTY sample_sites => the branch controller's site filter matches nothing by
    // membership, so it falls back to emitting the FULL fold-validation set for
    // BOTH branches (overlap on every sample).
    controllers
        .register(Box::new(OverlapEmittingController {
            id: ControllerId::new("controller:model").unwrap(),
            handle: 1,
        }))
        .unwrap();
    let mut ctx = RunContext::new(RunId::new("run:merge.overlap").unwrap(), Some(7));

    let error = SequentialScheduler
        .execute_campaign_phase_with_data_provider(
            &plan,
            &controllers,
            &data_provider,
            &mut ctx,
            Phase::FitCv,
        )
        .unwrap_err()
        .to_string();
    assert!(
        error.contains("overlapping branch predictions"),
        "overlapping branch inputs must surface a clear error: {error}"
    );
}

/// A branch model controller that emits NO predictions/targets for any fold —
/// used to drive the "non-empty fold, no branch inputs" merge error path.
struct SilentBranchController {
    id: ControllerId,
    handle: u64,
}

impl RuntimeController for SilentBranchController {
    fn controller_id(&self) -> &ControllerId {
        &self.id
    }

    fn invoke(&self, task: &NodeTask) -> Result<NodeResult> {
        let fold_label = task
            .fold_id
            .as_ref()
            .map(ToString::to_string)
            .unwrap_or_else(|| "nofold".to_string());
        let output = HandleRef {
            handle: self.handle,
            kind: HandleKind::Data,
            owner_controller: self.id.clone(),
        };
        Ok(NodeResult {
            schema_version: None,
            classification_probabilities: Vec::new(),
            consumed_data_views: std::collections::BTreeMap::new(),
            node_id: task.node_plan.node_id.clone(),
            outputs: BTreeMap::from([
                ("oof".to_string(), output.clone()),
                ("x".to_string(), output),
            ]),
            predictions: Vec::new(),
            observation_predictions: Vec::new(),
            aggregated_predictions: Vec::new(),
            explanations: Vec::new(),
            shape_deltas: Vec::new(),
            artifacts: Vec::new(),
            artifact_handles: BTreeMap::new(),
            fit_influence_diagnostics: Vec::new(),
            regression_targets: Vec::new(),
            lineage: LineageRecord {
                record_id: LineageId::new(format!(
                    "lineage:{}:{fold_label}",
                    task.node_plan.node_id
                ))
                .unwrap(),
                run_id: task.run_id.clone(),
                node_id: task.node_plan.node_id.clone(),
                phase: task.phase,
                controller_id: self.id.clone(),
                controller_version: task.node_plan.controller_version.clone(),
                variant_id: task.variant_id.clone(),
                fold_id: task.fold_id.clone(),
                branch_path: task.branch_path.clone(),
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
                target_domain: None,
            },
        })
    }
}

/// A branch model controller that, like `BranchScopeRecordingController`, scopes
/// its OOF to its partition (fold-validation ∩ its site), but ALSO emits the
/// matching per-sample `y_true` so the merge can be scored. Prediction =
/// `y_true + offset`, where `offset` comes from the variant's `n_components`
/// param override — so different variants give the merge different OOF residuals.
/// `y_true(sample) = trailing integer of the sample id`.
struct ScoringBranchController {
    id: ControllerId,
    handle: u64,
    sample_sites: BTreeMap<String, String>,
}

impl ScoringBranchController {
    fn y_true(sample: &str) -> f64 {
        sample
            .rsplit(|c: char| !c.is_ascii_digit())
            .find(|piece| !piece.is_empty())
            .and_then(|digits| digits.parse::<f64>().ok())
            .unwrap_or(0.0)
    }
}

impl RuntimeController for ScoringBranchController {
    fn controller_id(&self) -> &ControllerId {
        &self.id
    }

    fn invoke(&self, task: &NodeTask) -> Result<NodeResult> {
        let fold_label = task
            .fold_id
            .as_ref()
            .map(ToString::to_string)
            .unwrap_or_else(|| "nofold".to_string());
        let validation_view = task
            .data_views
            .iter()
            .find(|(_, view)| view.partition == DataRequestPartition::FoldValidation)
            .map(|(_, view)| view);
        let branch_site = validation_view
            .and_then(|view| view.branch_view.as_ref())
            .and_then(|branch| branch.selector.metadata.get("site"))
            .and_then(serde_json::Value::as_str);
        let fold_validation_ids: Vec<String> = validation_view
            .and_then(|view| view.sample_ids.clone())
            .unwrap_or_default()
            .iter()
            .map(ToString::to_string)
            .collect();
        let partition_ids: Vec<String> = match branch_site {
            Some(site) => fold_validation_ids
                .iter()
                .filter(|sample| {
                    self.sample_sites
                        .get(*sample)
                        .map(|s| s == site)
                        .unwrap_or(false)
                })
                .cloned()
                .collect(),
            None => fold_validation_ids.clone(),
        };
        let offset = task
            .node_plan
            .params
            .get("n_components")
            .and_then(serde_json::Value::as_f64)
            .unwrap_or(0.0);

        let prediction_output = HandleRef {
            handle: self.handle,
            kind: HandleKind::Prediction,
            owner_controller: self.id.clone(),
        };
        let data_output = HandleRef {
            handle: self.handle,
            kind: HandleKind::Data,
            owner_controller: self.id.clone(),
        };
        let (predictions, regression_targets) =
            if task.phase == Phase::FitCv && !partition_ids.is_empty() {
                let preds = vec![PredictionBlock {
                    prediction_id: Some(format!("pred:{}", task.node_plan.node_id)),
                    producer_node: task.node_plan.node_id.clone(),
                    producer_port: None,
                    partition: PredictionPartition::Validation,
                    fold_id: task.fold_id.clone(),
                    sample_ids: partition_ids
                        .iter()
                        .map(|s| SampleId::new(s).unwrap())
                        .collect(),
                    values: partition_ids
                        .iter()
                        .map(|s| vec![Self::y_true(s) + offset])
                        .collect(),
                    target_names: vec!["y".to_string()],
                }];
                let targets = vec![crate::metrics::RegressionTargetBlock {
                    validity_masks: None,
                    level: PredictionLevel::Sample,
                    unit_ids: partition_ids
                        .iter()
                        .map(|s| {
                            crate::aggregation::PredictionUnitId::Sample(SampleId::new(s).unwrap())
                        })
                        .collect(),
                    values: partition_ids
                        .iter()
                        .map(|s| vec![Self::y_true(s)])
                        .collect(),
                    target_names: vec!["y".to_string()],
                }];
                (preds, targets)
            } else {
                (Vec::new(), Vec::new())
            };
        let variant_label = task
            .variant_id
            .as_ref()
            .map(ToString::to_string)
            .unwrap_or_else(|| "base".to_string());
        Ok(NodeResult {
            schema_version: None,
            classification_probabilities: Vec::new(),
            consumed_data_views: std::collections::BTreeMap::new(),
            node_id: task.node_plan.node_id.clone(),
            outputs: BTreeMap::from([
                ("pred".to_string(), prediction_output.clone()),
                ("oof".to_string(), prediction_output),
                ("x".to_string(), data_output),
            ]),
            predictions,
            observation_predictions: Vec::new(),
            aggregated_predictions: Vec::new(),
            explanations: Vec::new(),
            shape_deltas: Vec::new(),
            artifacts: Vec::new(),
            artifact_handles: BTreeMap::new(),
            fit_influence_diagnostics: Vec::new(),
            regression_targets,
            lineage: LineageRecord {
                record_id: LineageId::new(format!(
                    "lineage:{}:{variant_label}:{fold_label}",
                    task.node_plan.node_id
                ))
                .unwrap(),
                run_id: task.run_id.clone(),
                node_id: task.node_plan.node_id.clone(),
                phase: task.phase,
                controller_id: self.id.clone(),
                controller_version: task.node_plan.controller_version.clone(),
                variant_id: task.variant_id.clone(),
                fold_id: task.fold_id.clone(),
                branch_path: task.branch_path.clone(),
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
                target_domain: None,
            },
        })
    }
}

/// Two-site sample→site membership shared by the scoring merge tests.
fn merge_sample_sites() -> BTreeMap<String, String> {
    BTreeMap::from([
        ("sample:1".to_string(), "A".to_string()),
        ("sample:2".to_string(), "B".to_string()),
        ("sample:3".to_string(), "A".to_string()),
        ("sample:4".to_string(), "B".to_string()),
    ])
}

/// 2-site (A/B) merge plan + provider over a 2-fold KFold, optionally with a
/// per-variant `n_components` offset sweep on BOTH branch nodes. Returns the plan
/// and the data provider; the caller supplies the runtime controllers.
fn scoring_merge_plan_and_provider(
    plan_id: &str,
    offsets: Vec<(&str, f64)>,
) -> (ExecutionPlan, InMemoryDataProvider) {
    let node_a = branch_model_node("model:site__A", "A");
    let node_b = branch_model_node("model:site__B", "B");
    let merge = concat_merge_node("merge:sites", &["model:site__A", "model:site__B"]);
    let graph = GraphSpec {
        id: format!("graph:{plan_id}"),
        interface: GraphInterface::default(),
        nodes: vec![node_a, node_b, merge],
        edges: vec![
            branch_to_merge_edge("model:site__A", "merge:sites"),
            branch_to_merge_edge("model:site__B", "merge:sites"),
        ],
        search_space_fingerprint: None,
        metadata: BTreeMap::new(),
    };
    let id_a = NodeId::new("model:site__A").unwrap();
    let id_b = NodeId::new("model:site__B").unwrap();
    let samples: Vec<SampleId> = ["sample:1", "sample:2", "sample:3", "sample:4"]
        .iter()
        .map(|s| SampleId::new(*s).unwrap())
        .collect();
    let fold_set = FoldSet {
        id: format!("folds:{plan_id}"),
        sample_ids: samples.clone(),
        folds: vec![
            FoldAssignment {
                fold_id: FoldId::new("fold:0").unwrap(),
                train_sample_ids: vec![samples[2].clone(), samples[3].clone()],
                validation_sample_ids: vec![samples[0].clone(), samples[1].clone()],
                metadata: BTreeMap::new(),
            },
            FoldAssignment {
                fold_id: FoldId::new("fold:1").unwrap(),
                train_sample_ids: vec![samples[0].clone(), samples[1].clone()],
                validation_sample_ids: vec![samples[2].clone(), samples[3].clone()],
                metadata: BTreeMap::new(),
            },
        ],
        sample_groups: BTreeMap::new(),
        partition_mode: FoldPartitionMode::Partition,
        train_exclusion: FoldTrainExclusion::Relations,
        target_missing_sample_ids: Vec::new(),
    };
    // A per-variant offset sweep applied to BOTH branch model nodes.
    let generation = if offsets.is_empty() {
        Default::default()
    } else {
        let choices = offsets
            .into_iter()
            .map(|(label, offset)| GenerationChoice {
                label: label.to_string(),
                value: json!(label),
                param_overrides: vec![
                    crate::generation::GenerationParamOverride {
                        node_id: id_a.clone(),
                        params: BTreeMap::from([("n_components".to_string(), json!(offset))]),
                    },
                    crate::generation::GenerationParamOverride {
                        node_id: id_b.clone(),
                        params: BTreeMap::from([("n_components".to_string(), json!(offset))]),
                    },
                ],
                active_subsequence: None,
            })
            .collect::<Vec<_>>();
        let max_variants = Some(choices.len());
        GenerationSpec {
            strategy: GenerationStrategy::Cartesian,
            dimensions: vec![GenerationDimension {
                name: "branch_offset".to_string(),
                choices,
            }],
            max_variants,
            constraints: GenerationConstraints::default(),
        }
    };
    let campaign = CampaignSpec {
        inner_cv: None,
        id: format!("campaign:{plan_id}"),
        root_seed: Some(7),
        leakage_policy: Default::default(),
        aggregation_policy: Default::default(),
        split_invocation: Some(SplitInvocation {
            id: format!("split:{plan_id}"),
            controller_id: None,
            leakage_policy: Default::default(),
            params: BTreeMap::new(),
            fold_set: Some(fold_set),
        }),
        generation,
        shape_plans: BTreeMap::new(),
        data_bindings: BTreeMap::from([
            (id_a.clone(), vec![data_binding(&id_a)]),
            (id_b.clone(), vec![data_binding(&id_b)]),
        ]),
        branch_view_plans: Vec::new(),
        metadata: BTreeMap::new(),
    };
    let mut registry = ControllerRegistry::new();
    registry
        .register(controller_manifest("controller:model", NodeKind::Model))
        .unwrap();
    registry
        .register(merge_controller_manifest("controller:merge"))
        .unwrap();
    let plan = build_execution_plan(plan_id, graph, campaign, &registry).unwrap();
    let envelope = sample_relations_envelope(&[
        ("sample:1", "A"),
        ("sample:2", "B"),
        ("sample:3", "A"),
        ("sample:4", "B"),
    ]);
    let provider = InMemoryDataProvider::with_envelope(
        ControllerId::new("controller:data").unwrap(),
        envelope,
    )
    .unwrap();
    (plan, provider)
}

#[test]
fn concat_merge_producer_is_scored_per_fold_and_cross_fold() {
    // Fix 1: the merge must be SCORED, not just stored. Branch controllers emit
    // per-partition OOF + matching y_true; the merge reassembles BOTH, so the
    // merge producer gets per-fold reports AND a cross-fold OOF average
    // (cv_best_score). Predictions equal y_true (offset 0) -> RMSE 0 everywhere.
    let (plan, provider) = scoring_merge_plan_and_provider("plan:merge.scored", Vec::new());
    let merge_id = NodeId::new("merge:sites").unwrap();
    let mut controllers = RuntimeControllerRegistry::new();
    controllers
        .register(Box::new(ScoringBranchController {
            id: ControllerId::new("controller:model").unwrap(),
            handle: 1,
            sample_sites: merge_sample_sites(),
        }))
        .unwrap();
    let mut ctx = RunContext::new(RunId::new("run:merge.scored").unwrap(), Some(7));

    SequentialScheduler
        .execute_campaign_phase_with_data_provider(
            &plan,
            &controllers,
            &provider,
            &mut ctx,
            Phase::FitCv,
        )
        .unwrap();
    // Cross-fold OOF average must be computed for the merge producer.
    ctx.collect_cross_fold_validation_scores(plan_oof_partition_mode(&plan))
        .unwrap();

    // Per-fold scoring: the merge producer has a Validation report per fold.
    let per_fold: Vec<&crate::metrics::RegressionMetricReport> = ctx
        .score_collector
        .iter()
        .filter(|report| {
            report.producer_node == merge_id
                && report.partition == PredictionPartition::Validation
                && report
                    .fold_id
                    .as_ref()
                    .is_some_and(|fold| !matches!(fold.as_str(), "avg" | "w_avg"))
        })
        .collect();
    assert_eq!(
        per_fold.len(),
        2,
        "merge producer must be scored once per fold"
    );
    for report in &per_fold {
        assert_eq!(
            report.row_count, 2,
            "each per-fold merge report covers the full fold"
        );
        assert!(report.metrics["rmse"].abs() < 1e-9, "offset 0 -> RMSE 0");
    }

    // Cross-fold scoring: the merge producer has a cv_best_score (fold_id="avg")
    // over the full sample universe — exactly what makes a separation branch yield
    // a scored full-universe result.
    let avg: Vec<&crate::metrics::RegressionMetricReport> = ctx
        .score_collector
        .iter()
        .filter(|report| {
            report.producer_node == merge_id
                && report
                    .fold_id
                    .as_ref()
                    .is_some_and(|fold| fold.as_str() == "avg")
        })
        .collect();
    assert_eq!(
        avg.len(),
        1,
        "merge producer must have one cross-fold OOF average"
    );
    assert_eq!(
        avg[0].row_count, 4,
        "the merge OOF average covers the full universe"
    );
    assert!(
        avg[0].metrics["rmse"].abs() < 1e-9,
        "offset 0 -> OOF-average RMSE 0"
    );
}

#[test]
fn concat_merge_errors_when_a_nonempty_fold_has_no_branch_inputs() {
    // Fix 2: a NON-EMPTY fold whose branches produced no OOF must ERROR (report
    // the missing samples), never silently drop the merge output. The branch
    // controllers here emit NOTHING (skip every fold), so the merge sees a
    // non-empty fold with zero inputs.
    let (plan, provider) = scoring_merge_plan_and_provider("plan:merge.noinputs", Vec::new());
    let mut controllers = RuntimeControllerRegistry::new();
    controllers
        .register(Box::new(SilentBranchController {
            id: ControllerId::new("controller:model").unwrap(),
            handle: 1,
        }))
        .unwrap();
    let mut ctx = RunContext::new(RunId::new("run:merge.noinputs").unwrap(), Some(7));

    let error = SequentialScheduler
        .execute_campaign_phase_with_data_provider(
            &plan,
            &controllers,
            &provider,
            &mut ctx,
            Phase::FitCv,
        )
        .unwrap_err()
        .to_string();
    assert!(
        error.contains("does not cover fold") && error.contains("missing"),
        "a non-empty fold with no branch inputs must report missing samples: {error}"
    );
}

#[test]
fn concat_merge_isolates_per_variant_blocks() {
    // Fix 3: a 2-variant branch+merge campaign. Each variant runs in its OWN run
    // context (exactly how native SELECT scores variants), so each variant's merge
    // reassembles from ONLY its own branch blocks — no cross-variant overlap — and
    // each variant's cross-fold OOF average reflects ITS offset.
    let (plan, provider) = scoring_merge_plan_and_provider(
        "plan:merge.variants",
        vec![("accurate", 0.0), ("biased", 10.0)],
    );
    assert_eq!(plan.variants.len(), 2);
    let merge_id = NodeId::new("merge:sites").unwrap();

    let mut avg_rmse_by_variant: BTreeMap<String, f64> = BTreeMap::new();
    for variant in &plan.variants {
        let mut controllers = RuntimeControllerRegistry::new();
        controllers
            .register(Box::new(ScoringBranchController {
                id: ControllerId::new("controller:model").unwrap(),
                handle: 1,
                sample_sites: merge_sample_sites(),
            }))
            .unwrap();
        // A fresh, variant-pinned context per variant (the per-variant isolation
        // the CLI / select_best_variant_by_cv rely on).
        let mut ctx = RunContext::new(
            RunId::new(format!("run:merge.variants:{}", variant.variant_id)).unwrap(),
            Some(7),
        );
        ctx.variant_id = Some(variant.variant_id.clone());
        SequentialScheduler
            .execute_campaign_phase_with_data_provider(
                &plan,
                &controllers,
                &provider,
                &mut ctx,
                Phase::FitCv,
            )
            .unwrap();
        ctx.collect_cross_fold_validation_scores(plan_oof_partition_mode(&plan))
            .unwrap();

        // Each variant's merge covers the full universe exactly once, with the
        // variant-distinguished id, and no overlap error.
        let merge_blocks: Vec<&PredictionBlock> = ctx
            .prediction_store
            .blocks()
            .iter()
            .filter(|block| block.producer_node == merge_id)
            .collect();
        assert_eq!(
            merge_blocks.len(),
            2,
            "one merge block per fold for this variant"
        );
        let mut all: Vec<String> = merge_blocks
            .iter()
            .flat_map(|block| block.sample_ids.iter().map(ToString::to_string))
            .collect();
        all.sort();
        assert_eq!(
            all,
            vec![
                "sample:1".to_string(),
                "sample:2".to_string(),
                "sample:3".to_string(),
                "sample:4".to_string()
            ],
            "variant `{}` merge must cover the full universe exactly once",
            variant.variant_id
        );
        for block in &merge_blocks {
            assert!(
                block
                    .prediction_id
                    .as_ref()
                    .is_some_and(|id| id.contains(variant.variant_id.as_str())),
                "merge block id must be variant-distinguished"
            );
        }
        let avg = ctx
            .score_collector
            .iter()
            .find(|report| {
                report.producer_node == merge_id
                    && report
                        .fold_id
                        .as_ref()
                        .is_some_and(|fold| fold.as_str() == "avg")
            })
            .expect("variant merge has a cross-fold OOF average");
        avg_rmse_by_variant.insert(variant.variant_id.to_string(), avg.metrics["rmse"]);
    }

    // The two variants score differently (offset 0 -> RMSE 0; offset 10 -> RMSE 10),
    // proving each merge was reassembled from ONLY its own variant's blocks.
    let rmses: Vec<f64> = avg_rmse_by_variant.values().copied().collect();
    assert!(
        rmses.iter().any(|r| r.abs() < 1e-9) && rmses.iter().any(|r| (r - 10.0).abs() < 1e-9),
        "per-variant merge OOF averages must differ by offset (0 and 10): {avg_rmse_by_variant:?}"
    );
}

#[test]
fn concat_merge_rejects_mixed_variant_blocks_in_one_context() {
    // Fix 3 guard: running BOTH variants in ONE context (variant_id unset) lets
    // two variants' branch blocks accumulate for the same (branch, fold). Blocks
    // carry no variant tag, so the merge cannot attribute them and must ERROR
    // rather than silently mix variants. (Real multi-variant runs isolate each
    // variant in its own context — this is the unsupported direct path.)
    let (plan, provider) = scoring_merge_plan_and_provider(
        "plan:merge.mixed",
        vec![("accurate", 0.0), ("biased", 10.0)],
    );
    let mut controllers = RuntimeControllerRegistry::new();
    controllers
        .register(Box::new(ScoringBranchController {
            id: ControllerId::new("controller:model").unwrap(),
            handle: 1,
            sample_sites: merge_sample_sites(),
        }))
        .unwrap();
    // No variant pinned -> execute_campaign_phase runs BOTH variants in one ctx.
    let mut ctx = RunContext::new(RunId::new("run:merge.mixed").unwrap(), Some(7));

    let error = SequentialScheduler
        .execute_campaign_phase_with_data_provider(
            &plan,
            &controllers,
            &provider,
            &mut ctx,
            Phase::FitCv,
        )
        .unwrap_err()
        .to_string();
    assert!(
        error.contains("mixes several variants"),
        "mixed-variant branch blocks in one context must error: {error}"
    );
}

/// Build the 3-site plan + provider used by the empty-intersection tests. Site C
/// has a single sample (sample:4) so one fold's validation set contains no C
/// samples → an empty partition ∩ fold for branch C in that fold.
fn empty_intersection_plan_and_provider() -> (ExecutionPlan, InMemoryDataProvider) {
    let nodes = vec![
        branch_model_node("model:site__A", "A"),
        branch_model_node("model:site__B", "B"),
        branch_model_node("model:site__C", "C"),
    ];
    let graph = GraphSpec {
        id: "graph:fanout.empty".to_string(),
        interface: GraphInterface::default(),
        nodes,
        edges: Vec::new(),
        search_space_fingerprint: None,
        metadata: BTreeMap::new(),
    };
    let samples: Vec<SampleId> = ["sample:1", "sample:2", "sample:3", "sample:4"]
        .iter()
        .map(|s| SampleId::new(*s).unwrap())
        .collect();
    let fold_set = FoldSet {
        id: "folds:fanout.empty".to_string(),
        sample_ids: samples.clone(),
        folds: vec![
            FoldAssignment {
                fold_id: FoldId::new("fold:0").unwrap(),
                train_sample_ids: vec![samples[2].clone(), samples[3].clone()],
                // val = {sample:1 (A), sample:2 (B)} -> NO C samples here.
                validation_sample_ids: vec![samples[0].clone(), samples[1].clone()],
                metadata: BTreeMap::new(),
            },
            FoldAssignment {
                fold_id: FoldId::new("fold:1").unwrap(),
                train_sample_ids: vec![samples[0].clone(), samples[1].clone()],
                // val = {sample:3 (A), sample:4 (C)}.
                validation_sample_ids: vec![samples[2].clone(), samples[3].clone()],
                metadata: BTreeMap::new(),
            },
        ],
        sample_groups: BTreeMap::new(),
        partition_mode: FoldPartitionMode::Partition,
        train_exclusion: FoldTrainExclusion::Relations,
        target_missing_sample_ids: Vec::new(),
    };
    let bindings = ["model:site__A", "model:site__B", "model:site__C"]
        .iter()
        .map(|id| {
            let node_id = NodeId::new(*id).unwrap();
            (node_id.clone(), vec![data_binding(&node_id)])
        })
        .collect::<BTreeMap<_, _>>();
    let campaign = CampaignSpec {
        inner_cv: None,
        id: "campaign:fanout.empty".to_string(),
        root_seed: Some(7),
        leakage_policy: Default::default(),
        aggregation_policy: Default::default(),
        split_invocation: Some(SplitInvocation {
            id: "split:fanout.empty".to_string(),
            controller_id: None,
            leakage_policy: Default::default(),
            params: BTreeMap::new(),
            fold_set: Some(fold_set),
        }),
        generation: Default::default(),
        shape_plans: BTreeMap::new(),
        data_bindings: bindings,
        branch_view_plans: Vec::new(),
        metadata: BTreeMap::new(),
    };
    let mut registry = ControllerRegistry::new();
    registry
        .register(controller_manifest("controller:model", NodeKind::Model))
        .unwrap();
    let plan = build_execution_plan("plan:fanout.empty", graph, campaign, &registry).unwrap();
    let envelope = sample_relations_envelope(&[
        ("sample:1", "A"),
        ("sample:2", "B"),
        ("sample:3", "A"),
        ("sample:4", "C"),
    ]);
    let provider = InMemoryDataProvider::with_envelope(
        ControllerId::new("controller:data").unwrap(),
        envelope,
    )
    .unwrap();
    (plan, provider)
}

fn empty_intersection_sample_sites() -> BTreeMap<String, String> {
    BTreeMap::from([
        ("sample:1".to_string(), "A".to_string()),
        ("sample:2".to_string(), "B".to_string()),
        ("sample:3".to_string(), "A".to_string()),
        ("sample:4".to_string(), "C".to_string()),
    ])
}

#[test]
fn empty_partition_intersection_is_skipped_with_no_silent_miscoverage() {
    // Skip mode: branch C has NO samples in fold:0 (its partition ∩ fold is
    // empty). The (C, fold:0) OOF is skipped — never a silently-empty block — and
    // C still validates its sample in fold:1, so coverage is correct, not dropped.
    let (plan, provider) = empty_intersection_plan_and_provider();
    let seen = Arc::new(Mutex::new(Vec::new()));
    let mut controllers = RuntimeControllerRegistry::new();
    controllers
        .register(Box::new(BranchScopeRecordingController {
            id: ControllerId::new("controller:model").unwrap(),
            handle: 1,
            sample_sites: empty_intersection_sample_sites(),
            error_on_empty_intersection: false,
            seen: Arc::clone(&seen),
        }))
        .unwrap();
    let mut ctx = RunContext::new(RunId::new("run:fanout.empty.skip").unwrap(), Some(7));

    SequentialScheduler
        .execute_campaign_phase_with_data_provider(
            &plan,
            &controllers,
            &provider,
            &mut ctx,
            Phase::FitCv,
        )
        .unwrap();

    let oof_blocks = ctx.prediction_store.blocks();
    // Branch C produced exactly one OOF block (fold:1, sample:4); fold:0 skipped.
    let c_ids: Vec<String> = oof_blocks
        .iter()
        .filter(|block| block.producer_node.as_str() == "model:site__C")
        .flat_map(|block| block.sample_ids.iter().map(ToString::to_string))
        .collect();
    assert_eq!(
        c_ids,
        vec!["sample:4".to_string()],
        "branch C must cover only its present sample, with the empty fold skipped"
    );
    // No empty OOF blocks were emitted anywhere.
    assert!(
        oof_blocks.iter().all(|block| !block.sample_ids.is_empty()),
        "no silently-empty OOF block may be emitted for an empty partition ∩ fold"
    );
}

#[test]
fn empty_partition_intersection_can_raise_a_clear_error() {
    // Error mode: the empty partition ∩ fold for branch C in fold:0 raises a
    // clear, explicit error rather than silently mis-covering.
    let (plan, provider) = empty_intersection_plan_and_provider();
    let mut controllers = RuntimeControllerRegistry::new();
    controllers
        .register(Box::new(BranchScopeRecordingController {
            id: ControllerId::new("controller:model").unwrap(),
            handle: 1,
            sample_sites: empty_intersection_sample_sites(),
            error_on_empty_intersection: true,
            seen: Arc::new(Mutex::new(Vec::new())),
        }))
        .unwrap();
    let mut ctx = RunContext::new(RunId::new("run:fanout.empty.error").unwrap(), Some(7));

    let error = SequentialScheduler
        .execute_campaign_phase_with_data_provider(
            &plan,
            &controllers,
            &provider,
            &mut ctx,
            Phase::FitCv,
        )
        .unwrap_err()
        .to_string();
    assert!(
        error.contains("empty partition ∩ fold"),
        "empty intersection must surface a clear error: {error}"
    );
}

/// A `PredictionJoin` *fusion* (late-fusion averaging) merge node over N
/// duplication branches. `merge_mode="fusion"` marks it for the native fusion
/// reassembly that averages each sample's branch predictions (vs concat's
/// disjoint reassembly).
fn fusion_merge_node(node_id: &str, branch_ids: &[&str], merge_mode: &str) -> NodeSpec {
    let mut node = node(
        node_id,
        NodeKind::PredictionJoin,
        branch_ids
            .iter()
            .map(|branch| port(&format!("oof_{branch}"), PortKind::Prediction))
            .collect(),
        vec![port("oof", PortKind::Prediction)],
    );
    node.metadata.insert(
        "merge_mode".to_string(),
        serde_json::Value::String(merge_mode.to_string()),
    );
    node
}

/// A duplication-branch model node: a plain Model node (no branch_view, so it
/// covers the FULL fold validation set — the duplication shape `[[A],[B]]`).
fn duplication_model_node(node_id: &str) -> NodeSpec {
    node(
        node_id,
        NodeKind::Model,
        vec![port("x", PortKind::Data)],
        vec![port("oof", PortKind::Prediction)],
    )
}

/// A duplication-branch controller for the fusion tests: it emits ONE full-fold
/// `Validation` OOF block over the fold's validation set (read from the
/// validation data view — duplication branches see the whole fold), with a
/// per-node constant value `offsets[node_id]`, plus matching per-sample `y_true`.
/// `skip` names (node_id, sample) pairs that the branch does NOT predict, used to
/// drive asymmetric coverage — that sample is then averaged over the remaining
/// branch(es) only.
struct FusionBranchController {
    id: ControllerId,
    handle: u64,
    /// node_id -> the constant prediction value this branch emits per sample.
    offsets: BTreeMap<String, f64>,
    /// (node_id, sample_id) pairs the branch deliberately does not cover.
    skip: BTreeSet<(String, String)>,
}

impl RuntimeController for FusionBranchController {
    fn controller_id(&self) -> &ControllerId {
        &self.id
    }

    fn invoke(&self, task: &NodeTask) -> Result<NodeResult> {
        let node_id = task.node_plan.node_id.to_string();
        let fold_label = task
            .fold_id
            .as_ref()
            .map(ToString::to_string)
            .unwrap_or_else(|| "nofold".to_string());
        let validation_view = task
            .data_views
            .iter()
            .find(|(_, view)| view.partition == DataRequestPartition::FoldValidation)
            .map(|(_, view)| view);
        // Duplication branch: cover the FULL fold validation set (minus any skips).
        let fold_validation_ids: Vec<String> = validation_view
            .and_then(|view| view.sample_ids.clone())
            .unwrap_or_default()
            .iter()
            .map(ToString::to_string)
            .filter(|sample| !self.skip.contains(&(node_id.clone(), sample.clone())))
            .collect();
        let value = *self.offsets.get(&node_id).unwrap_or(&0.0);

        let prediction_output = HandleRef {
            handle: self.handle,
            kind: HandleKind::Prediction,
            owner_controller: self.id.clone(),
        };
        let data_output = HandleRef {
            handle: self.handle,
            kind: HandleKind::Data,
            owner_controller: self.id.clone(),
        };
        let (predictions, regression_targets) =
            if task.phase == Phase::FitCv && !fold_validation_ids.is_empty() {
                let preds = vec![PredictionBlock {
                    prediction_id: Some(format!("pred:{}", task.node_plan.node_id)),
                    producer_node: task.node_plan.node_id.clone(),
                    producer_port: None,
                    partition: PredictionPartition::Validation,
                    fold_id: task.fold_id.clone(),
                    sample_ids: fold_validation_ids
                        .iter()
                        .map(|s| SampleId::new(s).unwrap())
                        .collect(),
                    values: fold_validation_ids.iter().map(|_| vec![value]).collect(),
                    target_names: vec!["y".to_string()],
                }];
                // Ground truth is the sample's numeric suffix — identical across
                // branches (a sample's y_true is fold/branch-independent).
                let targets = vec![crate::metrics::RegressionTargetBlock {
                    validity_masks: None,
                    level: PredictionLevel::Sample,
                    unit_ids: fold_validation_ids
                        .iter()
                        .map(|s| {
                            crate::aggregation::PredictionUnitId::Sample(SampleId::new(s).unwrap())
                        })
                        .collect(),
                    values: fold_validation_ids
                        .iter()
                        .map(|s| vec![ScoringBranchController::y_true(s)])
                        .collect(),
                    target_names: vec!["y".to_string()],
                }];
                (preds, targets)
            } else {
                (Vec::new(), Vec::new())
            };
        Ok(NodeResult {
            schema_version: None,
            classification_probabilities: Vec::new(),
            consumed_data_views: std::collections::BTreeMap::new(),
            node_id: task.node_plan.node_id.clone(),
            outputs: BTreeMap::from([
                ("pred".to_string(), prediction_output.clone()),
                ("oof".to_string(), prediction_output),
                ("x".to_string(), data_output),
            ]),
            predictions,
            observation_predictions: Vec::new(),
            aggregated_predictions: Vec::new(),
            explanations: Vec::new(),
            shape_deltas: Vec::new(),
            artifacts: Vec::new(),
            artifact_handles: BTreeMap::new(),
            fit_influence_diagnostics: Vec::new(),
            regression_targets,
            lineage: LineageRecord {
                record_id: LineageId::new(format!("lineage:{node_id}:{fold_label}")).unwrap(),
                run_id: task.run_id.clone(),
                node_id: task.node_plan.node_id.clone(),
                phase: task.phase,
                controller_id: self.id.clone(),
                controller_version: task.node_plan.controller_version.clone(),
                variant_id: task.variant_id.clone(),
                fold_id: task.fold_id.clone(),
                branch_path: task.branch_path.clone(),
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
                target_domain: None,
            },
        })
    }
}

/// A 2-branch duplication + fusion-merge plan over a 2-fold KFold (4 samples),
/// both branches on the FULL data. Returns plan + provider; the caller registers
/// the runtime controllers.
fn fusion_merge_plan_and_provider(plan_id: &str) -> (ExecutionPlan, InMemoryDataProvider) {
    let node_a = duplication_model_node("model:dup__A");
    let node_b = duplication_model_node("model:dup__B");
    let merge = fusion_merge_node("merge:dup", &["model:dup__A", "model:dup__B"], "fusion");
    let graph = GraphSpec {
        id: format!("graph:{plan_id}"),
        interface: GraphInterface::default(),
        nodes: vec![node_a, node_b, merge],
        edges: vec![
            branch_to_merge_edge("model:dup__A", "merge:dup"),
            branch_to_merge_edge("model:dup__B", "merge:dup"),
        ],
        search_space_fingerprint: None,
        metadata: BTreeMap::new(),
    };
    let id_a = NodeId::new("model:dup__A").unwrap();
    let id_b = NodeId::new("model:dup__B").unwrap();
    let samples: Vec<SampleId> = ["sample:1", "sample:2", "sample:3", "sample:4"]
        .iter()
        .map(|s| SampleId::new(*s).unwrap())
        .collect();
    let fold_set = FoldSet {
        id: format!("folds:{plan_id}"),
        sample_ids: samples.clone(),
        folds: vec![
            FoldAssignment {
                fold_id: FoldId::new("fold:0").unwrap(),
                train_sample_ids: vec![samples[2].clone(), samples[3].clone()],
                validation_sample_ids: vec![samples[0].clone(), samples[1].clone()],
                metadata: BTreeMap::new(),
            },
            FoldAssignment {
                fold_id: FoldId::new("fold:1").unwrap(),
                train_sample_ids: vec![samples[0].clone(), samples[1].clone()],
                validation_sample_ids: vec![samples[2].clone(), samples[3].clone()],
                metadata: BTreeMap::new(),
            },
        ],
        sample_groups: BTreeMap::new(),
        partition_mode: FoldPartitionMode::Partition,
        train_exclusion: FoldTrainExclusion::Relations,
        target_missing_sample_ids: Vec::new(),
    };
    let campaign = CampaignSpec {
        inner_cv: None,
        id: format!("campaign:{plan_id}"),
        root_seed: Some(7),
        leakage_policy: Default::default(),
        aggregation_policy: Default::default(),
        split_invocation: Some(SplitInvocation {
            id: format!("split:{plan_id}"),
            controller_id: None,
            leakage_policy: Default::default(),
            params: BTreeMap::new(),
            fold_set: Some(fold_set),
        }),
        generation: Default::default(),
        shape_plans: BTreeMap::new(),
        data_bindings: BTreeMap::from([
            (id_a.clone(), vec![data_binding(&id_a)]),
            (id_b.clone(), vec![data_binding(&id_b)]),
        ]),
        branch_view_plans: Vec::new(),
        metadata: BTreeMap::new(),
    };
    let mut registry = ControllerRegistry::new();
    registry
        .register(controller_manifest("controller:model", NodeKind::Model))
        .unwrap();
    registry
        .register(merge_controller_manifest("controller:merge"))
        .unwrap();
    let plan = build_execution_plan(plan_id, graph, campaign, &registry).unwrap();
    let envelope = sample_relations_envelope(&[
        ("sample:1", "A"),
        ("sample:2", "B"),
        ("sample:3", "A"),
        ("sample:4", "B"),
    ]);
    let provider = InMemoryDataProvider::with_envelope(
        ControllerId::new("controller:data").unwrap(),
        envelope,
    )
    .unwrap();
    (plan, provider)
}

#[test]
fn fusion_merge_averages_duplication_branch_oof_including_asymmetric_coverage() {
    // A 2-branch DUPLICATION ([[A],[B]]) + late-fusion merge: both models fit on
    // the FULL data and emit full-fold OOF; the merge AVERAGES their held-out
    // predictions per sample (distinct from concat's disjoint reassembly). Branch
    // A always predicts 10.0; branch B predicts 20.0 but DELIBERATELY SKIPS
    // sample:1 (asymmetric coverage). So sample:1 averages over A only (=10.0)
    // while every other sample averages A+B (=15.0).
    let (plan, provider) = fusion_merge_plan_and_provider("plan:fusion.avg");
    let merge_id = NodeId::new("merge:dup").unwrap();
    let mut controllers = RuntimeControllerRegistry::new();
    controllers
        .register(Box::new(FusionBranchController {
            id: ControllerId::new("controller:model").unwrap(),
            handle: 1,
            offsets: BTreeMap::from([
                ("model:dup__A".to_string(), 10.0),
                ("model:dup__B".to_string(), 20.0),
            ]),
            skip: BTreeSet::from([("model:dup__B".to_string(), "sample:1".to_string())]),
        }))
        .unwrap();
    let mut ctx = RunContext::new(RunId::new("run:fusion.avg").unwrap(), Some(7));

    SequentialScheduler
        .execute_campaign_phase_with_data_provider(
            &plan,
            &controllers,
            &provider,
            &mut ctx,
            Phase::FitCv,
        )
        .unwrap();

    // The merge emits one fused OOF block per fold, each covering the full fold
    // validation set (the union of branch coverage), each sample exactly once.
    let merge_blocks: Vec<&PredictionBlock> = ctx
        .prediction_store
        .blocks()
        .iter()
        .filter(|block| block.producer_node == merge_id)
        .collect();
    assert_eq!(
        merge_blocks.len(),
        2,
        "fusion merge emits one fused OOF block per fold"
    );

    // Collect every fused (sample -> value) across folds.
    let fused: BTreeMap<String, f64> = merge_blocks
        .iter()
        .flat_map(|block| {
            block
                .sample_ids
                .iter()
                .zip(&block.values)
                .map(|(sample, row)| (sample.to_string(), row[0]))
        })
        .collect();
    // sample:1 was predicted by A only (B skipped it) -> average over A: 10.0.
    assert!(
        (fused["sample:1"] - 10.0).abs() < 1e-9,
        "asymmetric: sample:1 averages over the covering branch (A) only"
    );
    // Every other sample was predicted by both A (10) and B (20) -> mean 15.0.
    for sample in ["sample:2", "sample:3", "sample:4"] {
        assert!(
            (fused[sample] - 15.0).abs() < 1e-9,
            "{sample} averages both branches: (10+20)/2 = 15"
        );
    }

    // The fused output covers the full sample universe exactly once across folds
    // and passes the normal full-fold OOF completeness validation.
    let mut covered: Vec<String> = fused.keys().cloned().collect();
    covered.sort();
    assert_eq!(
        covered,
        vec![
            "sample:1".to_string(),
            "sample:2".to_string(),
            "sample:3".to_string(),
            "sample:4".to_string()
        ],
        "the fused OOF covers every sample exactly once"
    );
    let fold_set = plan.fold_set.as_ref().unwrap();
    crate::oof::validate_prediction_blocks_against_folds(fold_set, &[(*merge_blocks[0]).clone()])
        .expect("fused OOF block passes full-fold completeness");
    crate::oof::validate_prediction_blocks_against_folds(fold_set, &[(*merge_blocks[1]).clone()])
        .expect("fused OOF block passes full-fold completeness");

    // LEAKAGE: the fused block is a Validation (held-out) producer for the merge.
    for block in &merge_blocks {
        assert_eq!(
            block.partition,
            PredictionPartition::Validation,
            "fusion averages held-out OOF, never train predictions"
        );
    }

    // The merge is SCORED both per-fold and cross-fold (branches emit matching
    // y_true, reassembled onto the merge producer).
    ctx.collect_cross_fold_validation_scores(plan_oof_partition_mode(&plan))
        .unwrap();
    let avg: Vec<&crate::metrics::RegressionMetricReport> = ctx
        .score_collector
        .iter()
        .filter(|report| {
            report.producer_node == merge_id
                && report
                    .fold_id
                    .as_ref()
                    .is_some_and(|fold| fold.as_str() == "avg")
        })
        .collect();
    assert_eq!(
        avg.len(),
        1,
        "fusion merge producer has one cross-fold OOF average"
    );
    assert_eq!(
        avg[0].row_count, 4,
        "the merge OOF average covers the full universe"
    );

    // The merge lineage links both contributing branches per fold.
    let merge_lineage = ctx
        .lineage
        .records()
        .find(|record| {
            record.node_id == merge_id && record.fold_id.as_ref().unwrap().as_str() == "fold:0"
        })
        .expect("fusion merge recorded lineage");
    assert_eq!(
        merge_lineage.input_lineage.len(),
        2,
        "fusion merge lineage references both branch producers for the fold"
    );
}

#[test]
fn fusion_proba_mean_merge_averages_and_renormalizes_class_probabilities() {
    // The classification analogue: merge_mode="fusion_proba_mean" averages each
    // sample's per-class probability rows across duplication branches and
    // renormalizes to a valid distribution. Branch A emits [0.8, 0.2]; branch B
    // emits [0.4, 0.6]; the fused row is [0.6, 0.4] (mean, already summing to 1).
    let node_a = duplication_model_node("model:dup__A");
    let node_b = duplication_model_node("model:dup__B");
    let merge = fusion_merge_node(
        "merge:dup",
        &["model:dup__A", "model:dup__B"],
        "fusion_proba_mean",
    );
    let graph = GraphSpec {
        id: "graph:fusion.proba".to_string(),
        interface: GraphInterface::default(),
        nodes: vec![node_a, node_b, merge],
        edges: vec![
            branch_to_merge_edge("model:dup__A", "merge:dup"),
            branch_to_merge_edge("model:dup__B", "merge:dup"),
        ],
        search_space_fingerprint: None,
        metadata: BTreeMap::new(),
    };
    let id_a = NodeId::new("model:dup__A").unwrap();
    let id_b = NodeId::new("model:dup__B").unwrap();
    let samples: Vec<SampleId> = ["sample:1", "sample:2"]
        .iter()
        .map(|s| SampleId::new(*s).unwrap())
        .collect();
    // Two disjoint folds (LOO over the 2 samples); each branch emits a proba row
    // for the fold's validated sample, and the merge fuses per fold.
    let fold_set = FoldSet {
        id: "folds:fusion.proba".to_string(),
        sample_ids: samples.clone(),
        folds: vec![
            FoldAssignment {
                fold_id: FoldId::new("fold:0").unwrap(),
                train_sample_ids: vec![samples[1].clone()],
                validation_sample_ids: vec![samples[0].clone()],
                metadata: BTreeMap::new(),
            },
            FoldAssignment {
                fold_id: FoldId::new("fold:1").unwrap(),
                train_sample_ids: vec![samples[0].clone()],
                validation_sample_ids: vec![samples[1].clone()],
                metadata: BTreeMap::new(),
            },
        ],
        sample_groups: BTreeMap::new(),
        partition_mode: FoldPartitionMode::Partition,
        train_exclusion: FoldTrainExclusion::Relations,
        target_missing_sample_ids: Vec::new(),
    };
    let campaign = CampaignSpec {
        inner_cv: None,
        id: "campaign:fusion.proba".to_string(),
        root_seed: Some(7),
        leakage_policy: Default::default(),
        aggregation_policy: Default::default(),
        split_invocation: Some(SplitInvocation {
            id: "split:fusion.proba".to_string(),
            controller_id: None,
            leakage_policy: Default::default(),
            params: BTreeMap::new(),
            fold_set: Some(fold_set),
        }),
        generation: Default::default(),
        shape_plans: BTreeMap::new(),
        data_bindings: BTreeMap::from([
            (id_a.clone(), vec![data_binding(&id_a)]),
            (id_b.clone(), vec![data_binding(&id_b)]),
        ]),
        branch_view_plans: Vec::new(),
        metadata: BTreeMap::new(),
    };
    let mut registry = ControllerRegistry::new();
    registry
        .register(controller_manifest("controller:model", NodeKind::Model))
        .unwrap();
    registry
        .register(merge_controller_manifest("controller:merge"))
        .unwrap();
    let plan = build_execution_plan("plan:fusion.proba", graph, campaign, &registry).unwrap();
    let envelope = sample_relations_envelope(&[("sample:1", "A"), ("sample:2", "B")]);
    let provider = InMemoryDataProvider::with_envelope(
        ControllerId::new("controller:data").unwrap(),
        envelope,
    )
    .unwrap();

    let merge_id = NodeId::new("merge:dup").unwrap();
    let mut controllers = RuntimeControllerRegistry::new();
    controllers
        .register(Box::new(ProbaBranchController {
            id: ControllerId::new("controller:model").unwrap(),
            handle: 1,
            rows: BTreeMap::from([
                ("model:dup__A".to_string(), vec![0.8, 0.2]),
                ("model:dup__B".to_string(), vec![0.4, 0.6]),
            ]),
        }))
        .unwrap();
    let mut ctx = RunContext::new(RunId::new("run:fusion.proba").unwrap(), Some(7));

    SequentialScheduler
        .execute_campaign_phase_with_data_provider(
            &plan,
            &controllers,
            &provider,
            &mut ctx,
            Phase::FitCv,
        )
        .unwrap();

    let merge_blocks: Vec<&PredictionBlock> = ctx
        .prediction_store
        .blocks()
        .iter()
        .filter(|block| block.producer_node == merge_id)
        .collect();
    assert_eq!(merge_blocks.len(), 2, "one fused proba block per fold");
    for block in &merge_blocks {
        for row in &block.values {
            assert!(
                (row[0] - 0.6).abs() < 1e-9 && (row[1] - 0.4).abs() < 1e-9,
                "fused proba row is the renormalized mean [0.6, 0.4], got {row:?}"
            );
            assert!(
                (row.iter().sum::<f64>() - 1.0).abs() < 1e-9,
                "fused proba row is a valid distribution (sums to 1)"
            );
        }
    }
}

/// A duplication-branch controller emitting a full-fold `Validation` block whose
/// rows are a per-node per-class probability vector (`rows[node_id]`), for the
/// proba-mean fusion test.
struct ProbaBranchController {
    id: ControllerId,
    handle: u64,
    rows: BTreeMap<String, Vec<f64>>,
}

impl RuntimeController for ProbaBranchController {
    fn controller_id(&self) -> &ControllerId {
        &self.id
    }

    fn invoke(&self, task: &NodeTask) -> Result<NodeResult> {
        let node_id = task.node_plan.node_id.to_string();
        let fold_label = task
            .fold_id
            .as_ref()
            .map(ToString::to_string)
            .unwrap_or_else(|| "nofold".to_string());
        let fold_validation_ids: Vec<SampleId> = task
            .data_views
            .iter()
            .find(|(_, view)| view.partition == DataRequestPartition::FoldValidation)
            .and_then(|(_, view)| view.sample_ids.clone())
            .unwrap_or_default();
        let row = self.rows.get(&node_id).cloned().unwrap_or_default();
        let prediction_output = HandleRef {
            handle: self.handle,
            kind: HandleKind::Prediction,
            owner_controller: self.id.clone(),
        };
        let predictions = if task.phase == Phase::FitCv && !fold_validation_ids.is_empty() {
            vec![PredictionBlock {
                prediction_id: Some(format!("pred:{}", task.node_plan.node_id)),
                producer_node: task.node_plan.node_id.clone(),
                producer_port: None,
                partition: PredictionPartition::Validation,
                fold_id: task.fold_id.clone(),
                sample_ids: fold_validation_ids.clone(),
                values: fold_validation_ids.iter().map(|_| row.clone()).collect(),
                target_names: vec!["c0".to_string(), "c1".to_string()],
            }]
        } else {
            Vec::new()
        };
        Ok(NodeResult {
            schema_version: None,
            classification_probabilities: Vec::new(),
            consumed_data_views: std::collections::BTreeMap::new(),
            node_id: task.node_plan.node_id.clone(),
            outputs: BTreeMap::from([
                ("pred".to_string(), prediction_output.clone()),
                ("oof".to_string(), prediction_output),
            ]),
            predictions,
            observation_predictions: Vec::new(),
            aggregated_predictions: Vec::new(),
            explanations: Vec::new(),
            shape_deltas: Vec::new(),
            artifacts: Vec::new(),
            artifact_handles: BTreeMap::new(),
            fit_influence_diagnostics: Vec::new(),
            regression_targets: Vec::new(),
            lineage: LineageRecord {
                record_id: LineageId::new(format!("lineage:{node_id}:{fold_label}")).unwrap(),
                run_id: task.run_id.clone(),
                node_id: task.node_plan.node_id.clone(),
                phase: task.phase,
                controller_id: self.id.clone(),
                controller_version: task.node_plan.controller_version.clone(),
                variant_id: task.variant_id.clone(),
                fold_id: task.fold_id.clone(),
                branch_path: task.branch_path.clone(),
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
                target_domain: None,
            },
        })
    }
}

/// A model controller manifest that supports FIT_CV AND REFIT/PREDICT, so the
/// base branch nodes run in REFIT/PREDICT (the default `controller_manifest` is
/// FIT_CV-only). Used by the off-fold (test/predict) merge tests.
fn refit_capable_model_manifest(id: &str) -> ControllerManifest {
    let mut manifest = controller_manifest(id, NodeKind::Model);
    manifest.supported_phases = BTreeSet::from([Phase::FitCv, Phase::Refit, Phase::Predict]);
    manifest
}

/// Like [`scoring_merge_plan_and_provider`] but the model manifest supports
/// FIT_CV + REFIT + PREDICT, so the base branch nodes also run off-fold (REFIT
/// predicts the held-out test set). Used by the off-fold merge tests.
fn refit_merge_plan_and_provider(plan_id: &str) -> (ExecutionPlan, InMemoryDataProvider) {
    let node_a = branch_model_node("model:site__A", "A");
    let node_b = branch_model_node("model:site__B", "B");
    let merge = concat_merge_node("merge:sites", &["model:site__A", "model:site__B"]);
    let graph = GraphSpec {
        id: format!("graph:{plan_id}"),
        interface: GraphInterface::default(),
        nodes: vec![node_a, node_b, merge],
        edges: vec![
            branch_to_merge_edge("model:site__A", "merge:sites"),
            branch_to_merge_edge("model:site__B", "merge:sites"),
        ],
        search_space_fingerprint: None,
        metadata: BTreeMap::new(),
    };
    let id_a = NodeId::new("model:site__A").unwrap();
    let id_b = NodeId::new("model:site__B").unwrap();
    let samples: Vec<SampleId> = ["sample:1", "sample:2", "sample:3", "sample:4"]
        .iter()
        .map(|s| SampleId::new(*s).unwrap())
        .collect();
    let fold_set = FoldSet {
        id: format!("folds:{plan_id}"),
        sample_ids: samples.clone(),
        folds: vec![
            FoldAssignment {
                fold_id: FoldId::new("fold:0").unwrap(),
                train_sample_ids: vec![samples[2].clone(), samples[3].clone()],
                validation_sample_ids: vec![samples[0].clone(), samples[1].clone()],
                metadata: BTreeMap::new(),
            },
            FoldAssignment {
                fold_id: FoldId::new("fold:1").unwrap(),
                train_sample_ids: vec![samples[0].clone(), samples[1].clone()],
                validation_sample_ids: vec![samples[2].clone(), samples[3].clone()],
                metadata: BTreeMap::new(),
            },
        ],
        sample_groups: BTreeMap::new(),
        partition_mode: FoldPartitionMode::Partition,
        train_exclusion: FoldTrainExclusion::Relations,
        target_missing_sample_ids: Vec::new(),
    };
    let campaign = CampaignSpec {
        inner_cv: None,
        id: format!("campaign:{plan_id}"),
        root_seed: Some(7),
        leakage_policy: Default::default(),
        aggregation_policy: Default::default(),
        split_invocation: Some(SplitInvocation {
            id: format!("split:{plan_id}"),
            controller_id: None,
            leakage_policy: Default::default(),
            params: BTreeMap::new(),
            fold_set: Some(fold_set),
        }),
        generation: Default::default(),
        shape_plans: BTreeMap::new(),
        data_bindings: BTreeMap::from([
            (id_a.clone(), vec![data_binding(&id_a)]),
            (id_b.clone(), vec![data_binding(&id_b)]),
        ]),
        branch_view_plans: Vec::new(),
        metadata: BTreeMap::new(),
    };
    let mut registry = ControllerRegistry::new();
    registry
        .register(refit_capable_model_manifest("controller:model"))
        .unwrap();
    registry
        .register(merge_controller_manifest("controller:merge"))
        .unwrap();
    let plan = build_execution_plan(plan_id, graph, campaign, &registry).unwrap();
    let envelope = sample_relations_envelope(&[
        ("sample:1", "A"),
        ("sample:2", "B"),
        ("sample:3", "A"),
        ("sample:4", "B"),
    ]);
    let provider = InMemoryDataProvider::with_envelope(
        ControllerId::new("controller:data").unwrap(),
        envelope,
    )
    .unwrap();
    (plan, provider)
}

/// A branch controller that emits per-partition OOF in FIT_CV (like
/// [`ScoringBranchController`]) AND, in REFIT, a `Test`-partition block over the
/// FULL-train view samples filtered to its site (the held-out test predictions a
/// base branch makes after refit), with matching `y_true`. The off-fold merge
/// reassembly reads exactly those REFIT `Test` blocks. `value_offset` lets a test
/// inject a per-site constant so the merged output is checkable; `0.0` makes the
/// prediction equal `y_true` (RMSE 0).
struct OffFoldScoringController {
    id: ControllerId,
    handle: u64,
    /// sample_id -> site (A/B), so a branch keeps only its partition's samples.
    sample_sites: BTreeMap<String, String>,
    /// constant added to every prediction (0.0 -> prediction == y_true).
    value_offset: f64,
}

impl RuntimeController for OffFoldScoringController {
    fn controller_id(&self) -> &ControllerId {
        &self.id
    }

    fn invoke(&self, task: &NodeTask) -> Result<NodeResult> {
        let fold_label = task
            .fold_id
            .as_ref()
            .map(ToString::to_string)
            .unwrap_or_else(|| "nofold".to_string());
        // FIT_CV reads the fold-validation view; REFIT reads the full-train view.
        // The PREDICT view carries no sample ids (new data), so PREDICT derives the
        // universe from the configured sites instead.
        let request_partition = match task.phase {
            Phase::FitCv => DataRequestPartition::FoldValidation,
            Phase::Predict => DataRequestPartition::Predict,
            _ => DataRequestPartition::FullTrain,
        };
        let view = task
            .data_views
            .iter()
            .find(|(_, view)| view.partition == request_partition)
            .map(|(_, view)| view);
        let branch_site = view
            .and_then(|view| view.branch_view.as_ref())
            .and_then(|branch| branch.selector.metadata.get("site"))
            .and_then(serde_json::Value::as_str);
        let view_ids: Vec<String> = match task.phase {
            // PREDICT: the view has no sample ids; use the full configured universe.
            Phase::Predict => self.sample_sites.keys().cloned().collect(),
            _ => view
                .and_then(|view| view.sample_ids.clone())
                .unwrap_or_default()
                .iter()
                .map(ToString::to_string)
                .collect(),
        };
        // Keep only this branch's partition (its site).
        let partition_ids: Vec<String> = match branch_site {
            Some(site) => view_ids
                .into_iter()
                .filter(|sample| {
                    self.sample_sites
                        .get(sample)
                        .map(|s| s == site)
                        .unwrap_or(false)
                })
                .collect(),
            None => view_ids,
        };
        let partition = match task.phase {
            Phase::FitCv => PredictionPartition::Validation,
            Phase::Predict => PredictionPartition::Final,
            _ => PredictionPartition::Test,
        };
        let (predictions, regression_targets) = if !partition_ids.is_empty() {
            let preds = vec![PredictionBlock {
                prediction_id: Some(format!("pred:{}", task.node_plan.node_id)),
                producer_node: task.node_plan.node_id.clone(),
                producer_port: None,
                partition,
                fold_id: task.fold_id.clone(),
                sample_ids: partition_ids
                    .iter()
                    .map(|s| SampleId::new(s).unwrap())
                    .collect(),
                values: partition_ids
                    .iter()
                    .map(|s| vec![ScoringBranchController::y_true(s) + self.value_offset])
                    .collect(),
                target_names: vec!["y".to_string()],
            }];
            let targets = vec![crate::metrics::RegressionTargetBlock {
                validity_masks: None,
                level: PredictionLevel::Sample,
                unit_ids: partition_ids
                    .iter()
                    .map(|s| {
                        crate::aggregation::PredictionUnitId::Sample(SampleId::new(s).unwrap())
                    })
                    .collect(),
                values: partition_ids
                    .iter()
                    .map(|s| vec![ScoringBranchController::y_true(s)])
                    .collect(),
                target_names: vec!["y".to_string()],
            }];
            (preds, targets)
        } else {
            (Vec::new(), Vec::new())
        };
        let prediction_output = HandleRef {
            handle: self.handle,
            kind: HandleKind::Prediction,
            owner_controller: self.id.clone(),
        };
        let data_output = HandleRef {
            handle: self.handle,
            kind: HandleKind::Data,
            owner_controller: self.id.clone(),
        };
        let variant_label = task
            .variant_id
            .as_ref()
            .map(ToString::to_string)
            .unwrap_or_else(|| "base".to_string());
        Ok(NodeResult {
            schema_version: None,
            classification_probabilities: Vec::new(),
            consumed_data_views: std::collections::BTreeMap::new(),
            node_id: task.node_plan.node_id.clone(),
            outputs: BTreeMap::from([
                ("pred".to_string(), prediction_output.clone()),
                ("oof".to_string(), prediction_output),
                ("x".to_string(), data_output),
            ]),
            predictions,
            observation_predictions: Vec::new(),
            aggregated_predictions: Vec::new(),
            explanations: Vec::new(),
            shape_deltas: Vec::new(),
            artifacts: Vec::new(),
            artifact_handles: BTreeMap::new(),
            fit_influence_diagnostics: Vec::new(),
            regression_targets,
            lineage: LineageRecord {
                record_id: LineageId::new(format!(
                    "lineage:{}:{variant_label}:{}:{fold_label}",
                    task.node_plan.node_id,
                    task.phase.as_str()
                ))
                .unwrap(),
                run_id: task.run_id.clone(),
                node_id: task.node_plan.node_id.clone(),
                phase: task.phase,
                controller_id: self.id.clone(),
                controller_version: task.node_plan.controller_version.clone(),
                variant_id: task.variant_id.clone(),
                fold_id: task.fold_id.clone(),
                branch_path: task.branch_path.clone(),
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
                target_domain: None,
            },
        })
    }
}

#[test]
fn concat_merge_reassembles_and_scores_refit_test_predictions() {
    // Backlog #16 (a): in REFIT the base branches predict the held-out TEST set
    // (PredictionPartition::Test, no fold). The off-fold concat reassembly must
    // join the disjoint per-site Test predictions into ONE Test block under the
    // merge producer, reassemble their y_true, and have it SCORED — so the concat
    // merge yields a best_rmse in REFIT, not just FIT_CV Validation OOF.
    let (plan, provider) = refit_merge_plan_and_provider("plan:merge.refit");
    let merge_id = NodeId::new("merge:sites").unwrap();
    let mut controllers = RuntimeControllerRegistry::new();
    controllers
        .register(Box::new(OffFoldScoringController {
            id: ControllerId::new("controller:model").unwrap(),
            handle: 1,
            sample_sites: merge_sample_sites(),
            value_offset: 0.0,
        }))
        .unwrap();
    let mut ctx = RunContext::new(RunId::new("run:merge.refit").unwrap(), Some(7));

    SequentialScheduler
        .execute_campaign_phase_with_data_provider(
            &plan,
            &controllers,
            &provider,
            &mut ctx,
            Phase::Refit,
        )
        .unwrap();

    // The merge node emits exactly ONE Test block (no fold), covering the union of
    // the disjoint per-site partitions = the full sample universe.
    let merge_blocks: Vec<&PredictionBlock> = ctx
        .prediction_store
        .blocks()
        .iter()
        .filter(|block| block.producer_node == merge_id)
        .collect();
    assert_eq!(
        merge_blocks.len(),
        1,
        "concat merge emits one reassembled REFIT test block"
    );
    let merged = merge_blocks[0];
    assert_eq!(merged.partition, PredictionPartition::Test);
    assert!(merged.fold_id.is_none(), "REFIT test block carries no fold");
    let mut ids: Vec<String> = merged.sample_ids.iter().map(ToString::to_string).collect();
    ids.sort();
    assert_eq!(
        ids,
        vec![
            "sample:1".to_string(),
            "sample:2".to_string(),
            "sample:3".to_string(),
            "sample:4".to_string(),
        ],
        "the reassembled test block covers the full universe exactly once"
    );

    // The merge producer is SCORED on the Test partition (offset 0 -> RMSE 0).
    let test_reports: Vec<&crate::metrics::RegressionMetricReport> = ctx
        .score_collector
        .iter()
        .filter(|report| {
            report.producer_node == merge_id && report.partition == PredictionPartition::Test
        })
        .collect();
    assert_eq!(
        test_reports.len(),
        1,
        "the concat merge produces one scored REFIT test report (best_rmse)"
    );
    assert_eq!(test_reports[0].row_count, 4);
    assert!(
        test_reports[0].metrics["rmse"].abs() < 1e-9,
        "offset 0 -> test RMSE 0"
    );
}

#[test]
fn fusion_merge_averages_and_scores_refit_test_predictions() {
    // Backlog #16 (a), fusion half: in REFIT two duplication branches each predict
    // the FULL test set; the off-fold fusion reassembly averages their Test
    // predictions per sample into one scored Test block. Branch A offset +2, branch
    // B offset -2 -> the mean equals y_true exactly (RMSE 0).
    let node_a = duplication_model_node("model:dup__A");
    let node_b = duplication_model_node("model:dup__B");
    let merge = fusion_merge_node("merge:dup", &["model:dup__A", "model:dup__B"], "fusion");
    let graph = GraphSpec {
        id: "graph:fusion.refit".to_string(),
        interface: GraphInterface::default(),
        nodes: vec![node_a, node_b, merge],
        edges: vec![
            branch_to_merge_edge("model:dup__A", "merge:dup"),
            branch_to_merge_edge("model:dup__B", "merge:dup"),
        ],
        search_space_fingerprint: None,
        metadata: BTreeMap::new(),
    };
    let id_a = NodeId::new("model:dup__A").unwrap();
    let id_b = NodeId::new("model:dup__B").unwrap();
    let samples: Vec<SampleId> = ["sample:1", "sample:2"]
        .iter()
        .map(|s| SampleId::new(*s).unwrap())
        .collect();
    let fold_set = FoldSet {
        id: "folds:fusion.refit".to_string(),
        sample_ids: samples.clone(),
        folds: vec![
            FoldAssignment {
                fold_id: FoldId::new("fold:0").unwrap(),
                train_sample_ids: vec![samples[1].clone()],
                validation_sample_ids: vec![samples[0].clone()],
                metadata: BTreeMap::new(),
            },
            FoldAssignment {
                fold_id: FoldId::new("fold:1").unwrap(),
                train_sample_ids: vec![samples[0].clone()],
                validation_sample_ids: vec![samples[1].clone()],
                metadata: BTreeMap::new(),
            },
        ],
        sample_groups: BTreeMap::new(),
        partition_mode: FoldPartitionMode::Partition,
        train_exclusion: FoldTrainExclusion::Relations,
        target_missing_sample_ids: Vec::new(),
    };
    let campaign = CampaignSpec {
        inner_cv: None,
        id: "campaign:fusion.refit".to_string(),
        root_seed: Some(7),
        leakage_policy: Default::default(),
        aggregation_policy: Default::default(),
        split_invocation: Some(SplitInvocation {
            id: "split:fusion.refit".to_string(),
            controller_id: None,
            leakage_policy: Default::default(),
            params: BTreeMap::new(),
            fold_set: Some(fold_set),
        }),
        generation: Default::default(),
        shape_plans: BTreeMap::new(),
        data_bindings: BTreeMap::from([
            (id_a.clone(), vec![data_binding(&id_a)]),
            (id_b.clone(), vec![data_binding(&id_b)]),
        ]),
        branch_view_plans: Vec::new(),
        metadata: BTreeMap::new(),
    };
    let mut registry = ControllerRegistry::new();
    registry
        .register(refit_capable_model_manifest("controller:model"))
        .unwrap();
    registry
        .register(merge_controller_manifest("controller:merge"))
        .unwrap();
    let plan = build_execution_plan("plan:fusion.refit", graph, campaign, &registry).unwrap();
    let envelope = sample_relations_envelope(&[("sample:1", "A"), ("sample:2", "B")]);
    let provider = InMemoryDataProvider::with_envelope(
        ControllerId::new("controller:data").unwrap(),
        envelope,
    )
    .unwrap();

    let merge_id = NodeId::new("merge:dup").unwrap();
    let mut controllers = RuntimeControllerRegistry::new();
    // No branch_view: both duplication branches see the FULL test set. Offsets
    // +2 / -2 so the per-sample mean equals y_true.
    controllers
        .register(Box::new(OffFoldDuplicationController {
            id: ControllerId::new("controller:model").unwrap(),
            handle: 1,
            offsets: BTreeMap::from([
                ("model:dup__A".to_string(), 2.0),
                ("model:dup__B".to_string(), -2.0),
            ]),
        }))
        .unwrap();
    let mut ctx = RunContext::new(RunId::new("run:fusion.refit").unwrap(), Some(7));

    SequentialScheduler
        .execute_campaign_phase_with_data_provider(
            &plan,
            &controllers,
            &provider,
            &mut ctx,
            Phase::Refit,
        )
        .unwrap();

    let merge_blocks: Vec<&PredictionBlock> = ctx
        .prediction_store
        .blocks()
        .iter()
        .filter(|block| block.producer_node == merge_id)
        .collect();
    assert_eq!(merge_blocks.len(), 1, "one fused REFIT test block");
    let merged = merge_blocks[0];
    assert_eq!(merged.partition, PredictionPartition::Test);
    assert!(merged.fold_id.is_none());
    // The fused value is the per-sample mean of (+2) and (-2) offsets = y_true.
    for (sample_id, row) in merged.sample_ids.iter().zip(&merged.values) {
        let y = ScoringBranchController::y_true(sample_id.as_str());
        assert!(
            (row[0] - y).abs() < 1e-9,
            "fused test row equals y_true for {sample_id}"
        );
    }
    let test_reports: Vec<&crate::metrics::RegressionMetricReport> = ctx
        .score_collector
        .iter()
        .filter(|report| {
            report.producer_node == merge_id && report.partition == PredictionPartition::Test
        })
        .collect();
    assert_eq!(test_reports.len(), 1, "the fusion merge is scored in REFIT");
    assert!(
        test_reports[0].metrics["rmse"].abs() < 1e-9,
        "averaged offsets cancel -> test RMSE 0"
    );
}

/// A duplication-branch controller that, in REFIT, emits a full-test-set `Test`
/// block (`offsets[node_id]` added to each sample's y_true) plus matching y_true.
/// FIT_CV emits the analogous full-fold `Validation` block. Used by the off-fold
/// fusion REFIT test.
struct OffFoldDuplicationController {
    id: ControllerId,
    handle: u64,
    offsets: BTreeMap<String, f64>,
}

impl RuntimeController for OffFoldDuplicationController {
    fn controller_id(&self) -> &ControllerId {
        &self.id
    }

    fn invoke(&self, task: &NodeTask) -> Result<NodeResult> {
        let node_id = task.node_plan.node_id.to_string();
        let fold_label = task
            .fold_id
            .as_ref()
            .map(ToString::to_string)
            .unwrap_or_else(|| "nofold".to_string());
        let request_partition = match task.phase {
            Phase::FitCv => DataRequestPartition::FoldValidation,
            _ => DataRequestPartition::FullTrain,
        };
        let ids: Vec<String> = task
            .data_views
            .iter()
            .find(|(_, view)| view.partition == request_partition)
            .and_then(|(_, view)| view.sample_ids.clone())
            .unwrap_or_default()
            .iter()
            .map(ToString::to_string)
            .collect();
        let partition = match task.phase {
            Phase::FitCv => PredictionPartition::Validation,
            _ => PredictionPartition::Test,
        };
        let offset = *self.offsets.get(&node_id).unwrap_or(&0.0);
        let (predictions, regression_targets) = if !ids.is_empty() {
            let preds = vec![PredictionBlock {
                prediction_id: Some(format!("pred:{}", task.node_plan.node_id)),
                producer_node: task.node_plan.node_id.clone(),
                producer_port: None,
                partition,
                fold_id: task.fold_id.clone(),
                sample_ids: ids.iter().map(|s| SampleId::new(s).unwrap()).collect(),
                values: ids
                    .iter()
                    .map(|s| vec![ScoringBranchController::y_true(s) + offset])
                    .collect(),
                target_names: vec!["y".to_string()],
            }];
            let targets = vec![crate::metrics::RegressionTargetBlock {
                validity_masks: None,
                level: PredictionLevel::Sample,
                unit_ids: ids
                    .iter()
                    .map(|s| {
                        crate::aggregation::PredictionUnitId::Sample(SampleId::new(s).unwrap())
                    })
                    .collect(),
                values: ids
                    .iter()
                    .map(|s| vec![ScoringBranchController::y_true(s)])
                    .collect(),
                target_names: vec!["y".to_string()],
            }];
            (preds, targets)
        } else {
            (Vec::new(), Vec::new())
        };
        let prediction_output = HandleRef {
            handle: self.handle,
            kind: HandleKind::Prediction,
            owner_controller: self.id.clone(),
        };
        Ok(NodeResult {
            schema_version: None,
            classification_probabilities: Vec::new(),
            consumed_data_views: std::collections::BTreeMap::new(),
            node_id: task.node_plan.node_id.clone(),
            outputs: BTreeMap::from([
                ("pred".to_string(), prediction_output.clone()),
                ("oof".to_string(), prediction_output),
            ]),
            predictions,
            observation_predictions: Vec::new(),
            aggregated_predictions: Vec::new(),
            explanations: Vec::new(),
            shape_deltas: Vec::new(),
            artifacts: Vec::new(),
            artifact_handles: BTreeMap::new(),
            fit_influence_diagnostics: Vec::new(),
            regression_targets,
            lineage: LineageRecord {
                record_id: LineageId::new(format!(
                    "lineage:{node_id}:{}:{fold_label}",
                    task.phase.as_str()
                ))
                .unwrap(),
                run_id: task.run_id.clone(),
                node_id: task.node_plan.node_id.clone(),
                phase: task.phase,
                controller_id: self.id.clone(),
                controller_version: task.node_plan.controller_version.clone(),
                variant_id: task.variant_id.clone(),
                fold_id: task.fold_id.clone(),
                branch_path: task.branch_path.clone(),
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
                target_domain: None,
            },
        })
    }
}

#[test]
fn off_fold_merge_never_reads_fit_cv_validation_oof() {
    // Leakage invariant: the off-fold (REFIT) merge reassembly must read ONLY
    // non-Validation, no-fold blocks. Here the SAME context is reused across
    // FIT_CV then REFIT, so the store holds the FIT_CV Validation OOF blocks AND
    // the REFIT Test blocks. The merge's REFIT output must be built from the Test
    // blocks alone — never the Validation OOF — proving FIT_CV meta-features stay
    // Validation-only and are never recycled into the test/predict path.
    let (plan, provider) = refit_merge_plan_and_provider("plan:merge.leak");
    let merge_id = NodeId::new("merge:sites").unwrap();
    let mut controllers = RuntimeControllerRegistry::new();
    // FIT_CV predictions are y_true (offset 0); REFIT predictions are y_true + 100
    // so a leaked Validation OOF value would be detectable in the merged test block.
    controllers
        .register(Box::new(OffFoldScoringController {
            id: ControllerId::new("controller:model").unwrap(),
            handle: 1,
            sample_sites: merge_sample_sites(),
            value_offset: 100.0,
        }))
        .unwrap();
    let mut ctx = RunContext::new(RunId::new("run:merge.leak").unwrap(), Some(7));

    // FIT_CV first: populates the store with Validation OOF blocks (offset 0).
    SequentialScheduler
        .execute_campaign_phase_with_data_provider(
            &plan,
            &controllers,
            &provider,
            &mut ctx,
            Phase::FitCv,
        )
        .unwrap();

    // FIT_CV merge blocks are Validation (per fold) and untouched by the off-fold path.
    let fit_cv_validation_count = ctx
        .prediction_store
        .blocks()
        .iter()
        .filter(|block| {
            block.producer_node == merge_id && block.partition == PredictionPartition::Validation
        })
        .count();
    assert_eq!(
        fit_cv_validation_count, 2,
        "FIT_CV still emits the per-fold Validation OOF merge blocks (Validation-only)"
    );

    // Now REFIT in the same context. The off-fold reassembly must read only the
    // Test blocks (offset 100), never the Validation OOF (offset 0).
    SequentialScheduler
        .execute_campaign_phase_with_data_provider(
            &plan,
            &controllers,
            &provider,
            &mut ctx,
            Phase::Refit,
        )
        .unwrap();

    let test_merge: Vec<&PredictionBlock> = ctx
        .prediction_store
        .blocks()
        .iter()
        .filter(|block| {
            block.producer_node == merge_id && block.partition == PredictionPartition::Test
        })
        .collect();
    assert_eq!(test_merge.len(), 1, "one off-fold Test merge block");
    for (sample_id, row) in test_merge[0].sample_ids.iter().zip(&test_merge[0].values) {
        let expected = ScoringBranchController::y_true(sample_id.as_str()) + 100.0;
        assert!(
            (row[0] - expected).abs() < 1e-9,
            "merged test value is the REFIT Test prediction (offset 100), not the leaked Validation OOF (offset 0) for {sample_id}: got {}",
            row[0]
        );
    }
    // The Validation OOF merge blocks are still Validation-only and unchanged.
    let validation_after = ctx
        .prediction_store
        .blocks()
        .iter()
        .filter(|block| {
            block.producer_node == merge_id && block.partition == PredictionPartition::Validation
        })
        .count();
    assert_eq!(
        validation_after, 2,
        "the off-fold REFIT path adds no Validation blocks and removes none"
    );
}

#[test]
fn refit_merge_consumes_only_test_partition_not_train_or_final() {
    // Fix 1: a REFIT merge must consume ONLY the phase-expected partition (Test),
    // never a stray Train block or a stale Final block left in the same context.
    // We pre-seed each branch with a Train and a Final block (no fold), then run
    // REFIT where the branches emit Test. The off-fold filter must reassemble the
    // Test blocks alone (value 0 -> RMSE 0) and ignore the Train/Final noise; if
    // it read non-Validation broadly it would trip the multi-block "mixes variants"
    // guard or fuse the wrong values.
    let (plan, provider) = refit_merge_plan_and_provider("plan:merge.testonly");
    let merge_id = NodeId::new("merge:sites").unwrap();
    let id_a = NodeId::new("model:site__A").unwrap();
    let id_b = NodeId::new("model:site__B").unwrap();
    let mut controllers = RuntimeControllerRegistry::new();
    controllers
        .register(Box::new(OffFoldScoringController {
            id: ControllerId::new("controller:model").unwrap(),
            handle: 1,
            sample_sites: merge_sample_sites(),
            value_offset: 0.0,
        }))
        .unwrap();
    let mut ctx = RunContext::new(RunId::new("run:merge.testonly").unwrap(), Some(7));

    // Pre-seed Train + Final noise for each branch (no fold, non-Validation, but
    // NOT the phase-expected Test partition). A naive "non-Validation" filter would
    // pick these up.
    for (branch, site_sample) in [(&id_a, "sample:1"), (&id_b, "sample:2")] {
        ctx.prediction_store
            .append(PredictionBlock {
                prediction_id: Some(format!("noise:train:{branch}")),
                producer_node: branch.clone(),
                producer_port: None,
                partition: PredictionPartition::Train,
                fold_id: None,
                sample_ids: vec![SampleId::new(site_sample).unwrap()],
                values: vec![vec![999.0]],
                target_names: vec!["y".to_string()],
            })
            .unwrap();
        ctx.prediction_store
            .append(PredictionBlock {
                prediction_id: Some(format!("noise:final:{branch}")),
                producer_node: branch.clone(),
                producer_port: None,
                partition: PredictionPartition::Final,
                fold_id: None,
                sample_ids: vec![SampleId::new(site_sample).unwrap()],
                values: vec![vec![-999.0]],
                target_names: vec!["y".to_string()],
            })
            .unwrap();
    }

    SequentialScheduler
        .execute_campaign_phase_with_data_provider(
            &plan,
            &controllers,
            &provider,
            &mut ctx,
            Phase::Refit,
        )
        .unwrap();

    let merge_blocks: Vec<&PredictionBlock> = ctx
        .prediction_store
        .blocks()
        .iter()
        .filter(|block| block.producer_node == merge_id)
        .collect();
    assert_eq!(
        merge_blocks.len(),
        1,
        "the REFIT merge emits exactly one Test block despite Train/Final noise"
    );
    let merged = merge_blocks[0];
    assert_eq!(
        merged.partition,
        PredictionPartition::Test,
        "the merge consumed the Test partition, not Train/Final"
    );
    // Values are the Test predictions (offset 0 -> y_true), never 999 / -999.
    for (sample_id, row) in merged.sample_ids.iter().zip(&merged.values) {
        let y = ScoringBranchController::y_true(sample_id.as_str());
        assert!(
            (row[0] - y).abs() < 1e-9,
            "merged value is the Test prediction for {sample_id}, not the Train/Final noise: {}",
            row[0]
        );
    }
    let test_reports = ctx
        .score_collector
        .iter()
        .filter(|report| {
            report.producer_node == merge_id && report.partition == PredictionPartition::Test
        })
        .count();
    assert_eq!(test_reports, 1, "the Test merge is scored");
}

#[test]
fn predict_after_refit_in_one_context_picks_final_cleanly() {
    // Fix 1: a PREDICT that runs AFTER a REFIT in the SAME RunContext must consume
    // the Final partition cleanly — the REFIT Test blocks from the earlier phase
    // are still in the store, so a broad "non-Validation" read would see BOTH Test
    // and Final per branch and error with "mixes variants". The phase-expected
    // filter (PREDICT -> Final) selects Final only.
    let (plan, provider) = refit_merge_plan_and_provider("plan:merge.refit.then.predict");
    let merge_id = NodeId::new("merge:sites").unwrap();
    let mut controllers = RuntimeControllerRegistry::new();
    controllers
        .register(Box::new(OffFoldScoringController {
            id: ControllerId::new("controller:model").unwrap(),
            handle: 1,
            sample_sites: merge_sample_sites(),
            value_offset: 0.0,
        }))
        .unwrap();
    let mut ctx = RunContext::new(RunId::new("run:merge.refit.then.predict").unwrap(), Some(7));

    // REFIT first: base branches emit Test, the merge reassembles a Test block.
    SequentialScheduler
        .execute_campaign_phase_with_data_provider(
            &plan,
            &controllers,
            &provider,
            &mut ctx,
            Phase::Refit,
        )
        .unwrap();
    assert_eq!(
        ctx.prediction_store
            .blocks()
            .iter()
            .filter(|block| block.partition == PredictionPartition::Test)
            .count(),
        3,
        "REFIT left Test blocks (2 base + 1 merge) in the context"
    );

    // PREDICT next in the SAME context: base branches emit Final, the merge must
    // pick Final cleanly (no 'mixes variants' from the lingering Test blocks).
    SequentialScheduler
        .execute_campaign_phase_with_data_provider(
            &plan,
            &controllers,
            &provider,
            &mut ctx,
            Phase::Predict,
        )
        .unwrap();

    let final_merge: Vec<&PredictionBlock> = ctx
        .prediction_store
        .blocks()
        .iter()
        .filter(|block| {
            block.producer_node == merge_id && block.partition == PredictionPartition::Final
        })
        .collect();
    assert_eq!(
        final_merge.len(),
        1,
        "PREDICT emits exactly one Final merge block, picking Final cleanly"
    );
    let mut ids: Vec<String> = final_merge[0]
        .sample_ids
        .iter()
        .map(ToString::to_string)
        .collect();
    ids.sort();
    assert_eq!(
        ids,
        vec![
            "sample:1".to_string(),
            "sample:2".to_string(),
            "sample:3".to_string(),
            "sample:4".to_string(),
        ],
        "the Final merge covers the full predict universe"
    );
    // The REFIT Test merge block is still present and untouched.
    assert_eq!(
        ctx.prediction_store
            .blocks()
            .iter()
            .filter(|block| {
                block.producer_node == merge_id && block.partition == PredictionPartition::Test
            })
            .count(),
        1,
        "the earlier REFIT Test merge block is untouched"
    );
}

#[test]
fn off_fold_fusion_rejects_within_branch_duplicate_sample() {
    // Fix 2: off-fold fusion must reject a within-branch duplicate sample_id (the
    // reducer would otherwise double-count it). One branch emits two rows for the
    // SAME sample in its REFIT Test block; the fusion reassembly must error.
    let node_a = duplication_model_node("model:dup__A");
    let node_b = duplication_model_node("model:dup__B");
    let merge = fusion_merge_node("merge:dup", &["model:dup__A", "model:dup__B"], "fusion");
    let graph = GraphSpec {
        id: "graph:fusion.dup".to_string(),
        interface: GraphInterface::default(),
        nodes: vec![node_a, node_b, merge],
        edges: vec![
            branch_to_merge_edge("model:dup__A", "merge:dup"),
            branch_to_merge_edge("model:dup__B", "merge:dup"),
        ],
        search_space_fingerprint: None,
        metadata: BTreeMap::new(),
    };
    let id_a = NodeId::new("model:dup__A").unwrap();
    let id_b = NodeId::new("model:dup__B").unwrap();
    let samples: Vec<SampleId> = ["sample:1", "sample:2"]
        .iter()
        .map(|s| SampleId::new(*s).unwrap())
        .collect();
    let fold_set = FoldSet {
        id: "folds:fusion.dup".to_string(),
        sample_ids: samples.clone(),
        folds: vec![
            FoldAssignment {
                fold_id: FoldId::new("fold:0").unwrap(),
                train_sample_ids: vec![samples[1].clone()],
                validation_sample_ids: vec![samples[0].clone()],
                metadata: BTreeMap::new(),
            },
            FoldAssignment {
                fold_id: FoldId::new("fold:1").unwrap(),
                train_sample_ids: vec![samples[0].clone()],
                validation_sample_ids: vec![samples[1].clone()],
                metadata: BTreeMap::new(),
            },
        ],
        sample_groups: BTreeMap::new(),
        partition_mode: FoldPartitionMode::Partition,
        train_exclusion: FoldTrainExclusion::Relations,
        target_missing_sample_ids: Vec::new(),
    };
    let campaign = CampaignSpec {
        inner_cv: None,
        id: "campaign:fusion.dup".to_string(),
        root_seed: Some(7),
        leakage_policy: Default::default(),
        aggregation_policy: Default::default(),
        split_invocation: Some(SplitInvocation {
            id: "split:fusion.dup".to_string(),
            controller_id: None,
            leakage_policy: Default::default(),
            params: BTreeMap::new(),
            fold_set: Some(fold_set),
        }),
        generation: Default::default(),
        shape_plans: BTreeMap::new(),
        data_bindings: BTreeMap::from([
            (id_a.clone(), vec![data_binding(&id_a)]),
            (id_b.clone(), vec![data_binding(&id_b)]),
        ]),
        branch_view_plans: Vec::new(),
        metadata: BTreeMap::new(),
    };
    let mut registry = ControllerRegistry::new();
    registry
        .register(refit_capable_model_manifest("controller:model"))
        .unwrap();
    registry
        .register(merge_controller_manifest("controller:merge"))
        .unwrap();
    let plan = build_execution_plan("plan:fusion.dup", graph, campaign, &registry).unwrap();
    let envelope = sample_relations_envelope(&[("sample:1", "A"), ("sample:2", "B")]);
    let provider = InMemoryDataProvider::with_envelope(
        ControllerId::new("controller:data").unwrap(),
        envelope,
    )
    .unwrap();

    let id_a = NodeId::new("model:dup__A").unwrap();
    let mut controllers = RuntimeControllerRegistry::new();
    controllers
        .register(Box::new(DuplicateSampleBranchController {
            id: ControllerId::new("controller:model").unwrap(),
            handle: 1,
            duplicate_branch: id_a,
        }))
        .unwrap();
    let mut ctx = RunContext::new(RunId::new("run:fusion.dup").unwrap(), Some(7));

    let error = SequentialScheduler
        .execute_campaign_phase_with_data_provider(
            &plan,
            &controllers,
            &provider,
            &mut ctx,
            Phase::Refit,
        )
        .unwrap_err()
        .to_string();
    assert!(
        error.contains("duplicate prediction for sample"),
        "off-fold fusion must reject a within-branch duplicate sample, got: {error}"
    );
}

/// A duplication-branch controller for the within-branch-duplicate fusion test:
/// in REFIT, `duplicate_branch` emits a `Test` block with the SAME sample id
/// twice; the other branch emits a clean single-row block. Off-fold fusion must
/// reject the duplicate before reducing.
struct DuplicateSampleBranchController {
    id: ControllerId,
    handle: u64,
    duplicate_branch: NodeId,
}

impl RuntimeController for DuplicateSampleBranchController {
    fn controller_id(&self) -> &ControllerId {
        &self.id
    }

    fn invoke(&self, task: &NodeTask) -> Result<NodeResult> {
        let node_id = task.node_plan.node_id.clone();
        let predictions = if task.phase == Phase::Refit {
            let sample_ids = if node_id == self.duplicate_branch {
                // Same sample id twice (the within-branch duplicate).
                vec![
                    SampleId::new("sample:1").unwrap(),
                    SampleId::new("sample:1").unwrap(),
                ]
            } else {
                vec![SampleId::new("sample:1").unwrap()]
            };
            vec![PredictionBlock {
                prediction_id: Some(format!("pred:{node_id}")),
                producer_node: node_id.clone(),
                producer_port: None,
                partition: PredictionPartition::Test,
                fold_id: None,
                sample_ids: sample_ids.clone(),
                values: sample_ids.iter().map(|_| vec![1.0]).collect(),
                target_names: vec!["y".to_string()],
            }]
        } else {
            Vec::new()
        };
        let prediction_output = HandleRef {
            handle: self.handle,
            kind: HandleKind::Prediction,
            owner_controller: self.id.clone(),
        };
        Ok(NodeResult {
            schema_version: None,
            classification_probabilities: Vec::new(),
            consumed_data_views: std::collections::BTreeMap::new(),
            node_id: node_id.clone(),
            outputs: BTreeMap::from([
                ("pred".to_string(), prediction_output.clone()),
                ("oof".to_string(), prediction_output),
            ]),
            predictions,
            observation_predictions: Vec::new(),
            aggregated_predictions: Vec::new(),
            explanations: Vec::new(),
            shape_deltas: Vec::new(),
            artifacts: Vec::new(),
            artifact_handles: BTreeMap::new(),
            fit_influence_diagnostics: Vec::new(),
            regression_targets: Vec::new(),
            lineage: LineageRecord {
                record_id: LineageId::new(format!("lineage:dup:{node_id}:{}", task.phase.as_str()))
                    .unwrap(),
                run_id: task.run_id.clone(),
                node_id,
                phase: task.phase,
                controller_id: self.id.clone(),
                controller_version: task.node_plan.controller_version.clone(),
                variant_id: task.variant_id.clone(),
                fold_id: task.fold_id.clone(),
                branch_path: task.branch_path.clone(),
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
                target_domain: None,
            },
        })
    }
}

/// A stacking base + meta controller for the off-fold (REFIT) meta-feature
/// delivery test. `model:base` emits a Validation OOF block per fold in FIT_CV
/// AND a `Test` block (no fold, both samples, value 0.9) in REFIT. `model:meta`,
/// in REFIT, asserts it received BOTH the Validation-OOF `model:base.pred` input
/// (cross-fold, Validation partition) AND the SEPARATE off-fold `model:base.pred:refit`
/// input carrying the Test values — never mixing them.
struct StackingOffFoldController {
    id: ControllerId,
}

impl RuntimeController for StackingOffFoldController {
    fn controller_id(&self) -> &ControllerId {
        &self.id
    }

    fn invoke(&self, task: &NodeTask) -> Result<NodeResult> {
        if task.node_plan.node_id.as_str() == "model:meta" {
            // The Validation OOF input is always present and Validation-only.
            let oof = task
                .prediction_inputs
                .get("model:base.pred")
                .ok_or_else(|| {
                    DagMlError::RuntimeValidation("meta missing Validation OOF input".to_string())
                })?;
            if oof.partition != PredictionPartition::Validation {
                return Err(DagMlError::RuntimeValidation(format!(
                    "meta Validation OOF input has partition {:?}, expected Validation",
                    oof.partition
                )));
            }
            if task.phase == Phase::Refit {
                // The SEPARATE off-fold input carries the base Test predictions.
                let test = task
                    .prediction_inputs
                    .get("model:base.pred:refit")
                    .ok_or_else(|| {
                        DagMlError::RuntimeValidation(
                            "meta missing off-fold (test) prediction input".to_string(),
                        )
                    })?;
                if test.partition != PredictionPartition::Test
                    || test.fold_id.is_some()
                    || test.sample_ids
                        != vec![SampleId::new("s1").unwrap(), SampleId::new("s2").unwrap()]
                    || test.values != vec![vec![0.9], vec![0.9]]
                    || test.prediction_width != 1
                {
                    return Err(DagMlError::RuntimeValidation(format!(
                        "meta off-fold test input is malformed: partition={:?} fold={:?} samples={:?} values={:?}",
                        test.partition, test.fold_id, test.sample_ids, test.values
                    )));
                }
            }
        }

        let predictions = if task.node_plan.node_id.as_str() == "model:base" {
            match task.phase {
                Phase::FitCv => {
                    let samples = aligned_validation_samples(task);
                    vec![PredictionBlock {
                        prediction_id: Some("pred:model:base".to_string()),
                        producer_node: task.node_plan.node_id.clone(),
                        producer_port: None,
                        partition: PredictionPartition::Validation,
                        fold_id: task.fold_id.clone(),
                        sample_ids: samples.clone(),
                        values: vec![vec![0.5]; samples.len()],
                        target_names: vec!["y".to_string()],
                    }]
                }
                Phase::Refit => {
                    let samples = vec![SampleId::new("s1").unwrap(), SampleId::new("s2").unwrap()];
                    vec![PredictionBlock {
                        prediction_id: Some("pred:model:base:test".to_string()),
                        producer_node: task.node_plan.node_id.clone(),
                        producer_port: None,
                        partition: PredictionPartition::Test,
                        fold_id: None,
                        sample_ids: samples.clone(),
                        values: vec![vec![0.9]; samples.len()],
                        target_names: vec!["y".to_string()],
                    }]
                }
                _ => Vec::new(),
            }
        } else {
            Vec::new()
        };

        let handle_id = if task.node_plan.node_id.as_str() == "model:base" {
            301
        } else {
            302
        };
        Ok(NodeResult {
            schema_version: None,
            classification_probabilities: Vec::new(),
            consumed_data_views: std::collections::BTreeMap::new(),
            node_id: task.node_plan.node_id.clone(),
            outputs: BTreeMap::from([(
                "pred".to_string(),
                HandleRef {
                    handle: handle_id,
                    kind: HandleKind::Data,
                    owner_controller: self.id.clone(),
                },
            )]),
            predictions,
            observation_predictions: Vec::new(),
            aggregated_predictions: Vec::new(),
            explanations: Vec::new(),
            shape_deltas: Vec::new(),
            artifacts: Vec::new(),
            artifact_handles: BTreeMap::new(),
            fit_influence_diagnostics: Vec::new(),
            regression_targets: Vec::new(),
            lineage: LineageRecord {
                record_id: LineageId::new(format!(
                    "lineage:stack:{}:{}:{}",
                    task.node_plan.node_id,
                    task.phase.as_str(),
                    task.fold_id
                        .as_ref()
                        .map(ToString::to_string)
                        .unwrap_or_else(|| "nofold".to_string())
                ))
                .unwrap(),
                run_id: task.run_id.clone(),
                node_id: task.node_plan.node_id.clone(),
                phase: task.phase,
                controller_id: self.id.clone(),
                controller_version: task.node_plan.controller_version.clone(),
                variant_id: task.variant_id.clone(),
                fold_id: task.fold_id.clone(),
                branch_path: task.branch_path.clone(),
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
                target_domain: None,
            },
        })
    }
}

#[test]
fn stacking_meta_node_receives_base_test_predictions_in_refit() {
    // Backlog #16 (b): a stacking meta-node receives the base node's REFIT test
    // predictions as a SEPARATE prediction input (`model:base.pred:refit`,
    // partition Test, carrying values), alongside the unchanged Validation-OOF
    // input (`model:base.pred`). The host meta-model predicts the test set from
    // the off-fold input; the Validation OOF stays the FIT_CV training feature.
    let plan = build_execution_plan(
        "plan:stack.offfold",
        oof_edge_graph(),
        oof_edge_campaign(),
        &oof_edge_manifests(BTreeSet::from([Phase::FitCv, Phase::Refit])),
    )
    .unwrap();
    let mut controllers = RuntimeControllerRegistry::new();
    controllers
        .register(Box::new(StackingOffFoldController {
            id: ControllerId::new("controller:model").unwrap(),
        }))
        .unwrap();
    let mut ctx = RunContext::new(RunId::new("run:stack.offfold").unwrap(), Some(11));

    // FIT_CV populates Validation OOF for the base (2 folds).
    SequentialScheduler
        .execute_campaign_phase(&plan, &controllers, &mut ctx, Phase::FitCv)
        .unwrap();
    assert_eq!(
        ctx.prediction_store
            .blocks()
            .iter()
            .filter(|block| block.partition == PredictionPartition::Validation)
            .count(),
        2,
        "FIT_CV recorded the base Validation OOF (Validation-only)"
    );

    // REFIT: the base emits a Test block; the meta-node's invoke asserts it
    // received both inputs correctly (the controller errors otherwise).
    let refit_results = SequentialScheduler
        .execute_campaign_phase(&plan, &controllers, &mut ctx, Phase::Refit)
        .unwrap();
    assert_eq!(
        refit_results
            .iter()
            .filter(|result| result.node_id.as_str() == "model:meta")
            .count(),
        1,
        "the meta-node ran in REFIT and accepted the off-fold test input"
    );
}

#[test]
fn stacking_best_fold_refit_reads_selected_cv_test_block() {
    let mut plan = build_execution_plan(
        "plan:stack.best.fold",
        oof_edge_graph(),
        oof_edge_campaign(),
        &oof_edge_manifests(BTreeSet::from([Phase::FitCv, Phase::Refit])),
    )
    .unwrap();
    let meta = plan
        .graph_plan
        .graph
        .nodes
        .iter_mut()
        .find(|node| node.id.as_str() == "model:meta")
        .unwrap();
    meta.metadata
        .insert("stacking_test_aggregation".to_string(), json!("best"));
    meta.metadata
        .insert("stacking_test_metric".to_string(), json!("rmse"));
    let mut ctx = RunContext::new(RunId::new("run:stack.best.fold").unwrap(), Some(11));
    for (fold, value, rmse) in [("fold:0", 0.4, 4.0), ("fold:1", 0.2, 2.0)] {
        ctx.prediction_store
            .append(PredictionBlock {
                prediction_id: None,
                producer_node: NodeId::new("model:base").unwrap(),
                producer_port: None,
                partition: PredictionPartition::Test,
                fold_id: Some(FoldId::new(fold).unwrap()),
                sample_ids: vec![SampleId::new("test:0").unwrap()],
                values: vec![vec![value]],
                target_names: vec!["y".to_string()],
            })
            .unwrap();
        ctx.score_collector.push(
            serde_json::from_value(json!({
                "producer_node": "model:base", "partition": "validation", "fold_id": fold,
                "level": "sample", "row_count": 1, "target_width": 1,
                "metrics": {"rmse": rmse}
            }))
            .unwrap(),
        );
    }
    ctx.prediction_store
        .append(PredictionBlock {
            prediction_id: None,
            producer_node: NodeId::new("model:base").unwrap(),
            producer_port: None,
            partition: PredictionPartition::Test,
            fold_id: None,
            sample_ids: vec![SampleId::new("test:0").unwrap()],
            values: vec![vec![0.9]],
            target_names: vec!["y".to_string()],
        })
        .unwrap();
    let edge = &plan.graph_plan.graph.edges[0];
    let input = collect_off_fold_prediction_input(
        &plan,
        edge,
        &ctx,
        &PhaseScope {
            phase: Phase::Refit,
            variant_id: None,
            variant: None,
            fold_id: None,
            seed_root: None,
        },
    )
    .unwrap()
    .unwrap();
    assert_eq!(input.spec.values, vec![vec![0.2]]);
    assert_eq!(input.spec.fold_id, None);
    plan.graph_plan
        .graph
        .nodes
        .iter_mut()
        .find(|node| node.id.as_str() == "model:meta")
        .unwrap()
        .metadata
        .insert("stacking_test_aggregation".to_string(), json!("weighted"));
    let weighted = collect_off_fold_prediction_input(
        &plan,
        &plan.graph_plan.graph.edges[0],
        &ctx,
        &PhaseScope {
            phase: Phase::Refit,
            variant_id: None,
            variant: None,
            fold_id: None,
            seed_root: None,
        },
    )
    .unwrap()
    .unwrap();
    assert!(
        (weighted.spec.values[0][0] - (0.4 / 4.0 + 0.2 / 2.0) / (1.0 / 4.0 + 1.0 / 2.0)).abs()
            < 1e-9,
        "weighted feature was {}",
        weighted.spec.values[0][0]
    );
}

#[test]
fn stacking_cv_test_input_selects_only_current_fold_and_never_validation() {
    let plan = build_execution_plan(
        "plan:stack.cv.fold.test",
        oof_edge_graph(),
        oof_edge_campaign(),
        &oof_edge_manifests(BTreeSet::from([Phase::FitCv])),
    )
    .unwrap();
    let mut ctx = RunContext::new(RunId::new("run:stack.cv.fold.test").unwrap(), Some(11));
    for (fold, partition, value) in [
        ("fold:0", PredictionPartition::Test, 0.2),
        ("fold:1", PredictionPartition::Test, 0.8),
        ("fold:0", PredictionPartition::Validation, 99.0),
    ] {
        ctx.prediction_store
            .append(PredictionBlock {
                prediction_id: None,
                producer_node: NodeId::new("model:base").unwrap(),
                producer_port: None,
                partition,
                fold_id: Some(FoldId::new(fold).unwrap()),
                sample_ids: vec![SampleId::new("external:test").unwrap()],
                values: vec![vec![value]],
                target_names: vec!["y".to_string()],
            })
            .unwrap();
    }
    let input = collect_cv_fold_test_prediction_input(
        &plan,
        &plan.graph_plan.graph.edges[0],
        &ctx,
        &PhaseScope {
            phase: Phase::FitCv,
            variant_id: None,
            variant: None,
            fold_id: Some(FoldId::new("fold:1").unwrap()),
            seed_root: None,
        },
    )
    .unwrap()
    .unwrap();
    assert_eq!(input.spec.partition, PredictionPartition::Test);
    assert_eq!(input.spec.fold_id, Some(FoldId::new("fold:1").unwrap()));
    assert_eq!(input.spec.values, vec![vec![0.8]]);
    assert_ne!(
        input.handle.handle,
        deterministic_oof_handle(
            &plan,
            &plan.graph_plan.graph.edges[0],
            &ctx,
            &PhaseScope {
                phase: Phase::FitCv,
                variant_id: None,
                variant: None,
                fold_id: Some(FoldId::new("fold:1").unwrap()),
                seed_root: None,
            },
        )
        .unwrap(),
    );
}

fn sample_relations_envelope(rows: &[(&str, &str)]) -> ExternalDataPlanEnvelope {
    let records = rows
        .iter()
        .map(|(sample, site)| {
            let mut relation = SampleRelation::new(
                ObservationId::new(format!("obs:{}", sample.replace(':', "."))).unwrap(),
                SampleId::new(*sample).unwrap(),
            );
            relation
                .metadata
                .insert("site".to_string(), serde_json::json!(site));
            relation
        })
        .collect::<Vec<_>>();
    let relations = SampleRelationSet { records };
    relations.validate().unwrap();
    // Match the data_binding() helper's fingerprints so the provider accepts the
    // binding; require_relations is satisfied by coordinator_relations presence.
    ExternalDataPlanEnvelope {
        schema_version: crate::data::EXTERNAL_DATA_PLAN_ENVELOPE_SCHEMA_VERSION,
        schema_fingerprint: "f97b37872fa22134b508f98fd8e207e5b776b52594fb8f6f5c3e15bee212246b"
            .to_string(),
        plan_fingerprint: "7c5431d85574b3f337022fa5d25971d5b5cf445b90331b49938f573ff6901e4d"
            .to_string(),
        relation_fingerprint: Some(
            "a3a7e329df35db9f2883a17b8611b7fae6dcaa031875e3ec2c9be1b9e29cbe10".to_string(),
        ),
        data_content_fingerprint: None,
        target_content_fingerprint: None,
        coordinator_relations: Some(relations),
        predict_cohort: None,
    }
}

/// R-P2-22 (REFIT-EXCLUDES-TEST): the REFIT final-fit universe (`DataRequestPartition::FullTrain`)
/// is exactly the fold set's train pool (`fold_set.sample_ids`), which the splitter partitioned into
/// train/validation folds. A held-out TEST sample is never passed to the splitter — it is requested
/// separately via `DataRequestPartition::Predict` (host-resolved, `sample_ids == None`) — so it can
/// never appear in the refit universe. This pins both halves of that invariant.
#[test]
fn refit_full_train_universe_excludes_held_out_test_partition() {
    let train: Vec<SampleId> = ["sample:1", "sample:2", "sample:3", "sample:4"]
        .iter()
        .map(|s| SampleId::new(*s).unwrap())
        .collect();
    let fold_set = FoldSet {
        id: "folds:refit.universe".to_string(),
        sample_ids: train.clone(),
        folds: vec![
            FoldAssignment {
                fold_id: FoldId::new("fold:0").unwrap(),
                train_sample_ids: vec![train[2].clone(), train[3].clone()],
                validation_sample_ids: vec![train[0].clone(), train[1].clone()],
                metadata: BTreeMap::new(),
            },
            FoldAssignment {
                fold_id: FoldId::new("fold:1").unwrap(),
                train_sample_ids: vec![train[0].clone(), train[1].clone()],
                validation_sample_ids: vec![train[2].clone(), train[3].clone()],
                metadata: BTreeMap::new(),
            },
        ],
        sample_groups: BTreeMap::new(),
        partition_mode: FoldPartitionMode::Partition,
        train_exclusion: FoldTrainExclusion::Relations,
        target_missing_sample_ids: Vec::new(),
    };
    fold_set.validate().unwrap();

    // REFIT resolves to FullTrain; its universe is exactly the fold (train) pool.
    let refit_universe =
        sample_ids_for_partition(DataRequestPartition::FullTrain, Some(&fold_set), None)
            .expect("FullTrain yields the fold-set universe");
    assert_eq!(
        refit_universe, train,
        "REFIT FullTrain universe is exactly the splitter's train pool"
    );

    // A held-out test sample — present in NEITHER fold and NOT in fold_set.sample_ids — is
    // structurally absent from the refit universe (the splitter never saw it).
    let held_out_test = SampleId::new("sample:test_only").unwrap();
    assert!(
        !refit_universe.contains(&held_out_test),
        "the held-out test partition can never enter the refit training universe"
    );

    // The TEST/PREDICT partition is host-resolved: the core enumerates no sample ids for it,
    // so it cannot be conflated with the fold universe.
    assert!(
        sample_ids_for_partition(DataRequestPartition::Predict, Some(&fold_set), None).is_none(),
        "Predict (test/final) is host-resolved, never enumerated from the fold set"
    );
}

// ===========================================================================================
// C Phase 4 (EXECUTION) — native operator-level generators: prune_plan_to_active +
// select_best_operator_variant_by_cv. The union is a STACKING graph
// (`filter -> choice_i(transform -> model) -> merge:gen (oof) -> model:meta`); operator `_or_` is
// SELECT, so each candidate is the union PRUNED to one choice (merge + meta + sibling choices
// elided) and scored on its own pruned plan. The winner = the lower-RMSE choice.
// ===========================================================================================

/// Scores a model node by `node_id` -> RMSE offset: `model:choice0__pls` predicts y_true exactly
/// (offset 0 -> RMSE 0, the winner), `model:choice1__ridge` predicts y_true + 1 (offset 1). Mirrors
/// `VariantScoringController` but keys the offset off the operator-choice's model NODE rather than a
/// param override, which is how operator `_or_` distinguishes choices.
struct OperatorScoringController {
    id: ControllerId,
    handle: u64,
    offsets: BTreeMap<NodeId, f64>,
}

impl OperatorScoringController {
    fn fold_sample(task: &NodeTask) -> Option<(SampleId, f64)> {
        match task.fold_id.as_ref()?.as_str() {
            "fold:0" => Some((SampleId::new("s1").unwrap(), 1.0)),
            "fold:1" => Some((SampleId::new("s2").unwrap(), 2.0)),
            _ => None,
        }
    }
}

impl RuntimeController for OperatorScoringController {
    fn controller_id(&self) -> &ControllerId {
        &self.id
    }

    fn invoke(&self, task: &NodeTask) -> Result<NodeResult> {
        let output = HandleRef {
            handle: self.handle,
            kind: HandleKind::Prediction,
            owner_controller: self.id.clone(),
        };
        let mut predictions = Vec::new();
        let mut regression_targets = Vec::new();
        if let Some((sample_id, y_true)) = Self::fold_sample(task) {
            let offset = self
                .offsets
                .get(&task.node_plan.node_id)
                .copied()
                .unwrap_or(0.0);
            predictions.push(PredictionBlock {
                prediction_id: Some(format!("pred:{}", task.node_plan.node_id)),
                producer_node: task.node_plan.node_id.clone(),
                producer_port: None,
                partition: PredictionPartition::Validation,
                fold_id: task.fold_id.clone(),
                sample_ids: vec![sample_id.clone()],
                values: vec![vec![y_true + offset]],
                target_names: vec!["y".to_string()],
            });
            regression_targets.push(crate::metrics::RegressionTargetBlock {
                validity_masks: None,
                level: PredictionLevel::Sample,
                unit_ids: vec![crate::aggregation::PredictionUnitId::Sample(sample_id)],
                values: vec![vec![y_true]],
                target_names: vec!["y".to_string()],
            });
        }
        let variant_label = task
            .variant_id
            .as_ref()
            .map(ToString::to_string)
            .unwrap_or_else(|| "base".to_string());
        let fold_label = task
            .fold_id
            .as_ref()
            .map(ToString::to_string)
            .unwrap_or_else(|| "nofold".to_string());
        Ok(NodeResult {
            schema_version: None,
            classification_probabilities: Vec::new(),
            consumed_data_views: std::collections::BTreeMap::new(),
            node_id: task.node_plan.node_id.clone(),
            outputs: BTreeMap::from([("oof".to_string(), output)]),
            predictions,
            observation_predictions: Vec::new(),
            aggregated_predictions: Vec::new(),
            explanations: Vec::new(),
            shape_deltas: Vec::new(),
            artifacts: Vec::new(),
            artifact_handles: BTreeMap::new(),
            fit_influence_diagnostics: Vec::new(),
            regression_targets,
            lineage: LineageRecord {
                record_id: LineageId::new(format!(
                    "lineage:{}:{:?}:{variant_label}:{fold_label}",
                    task.node_plan.node_id, task.phase
                ))
                .unwrap(),
                run_id: task.run_id.clone(),
                node_id: task.node_plan.node_id.clone(),
                phase: task.phase,
                controller_id: self.id.clone(),
                controller_version: task.node_plan.controller_version.clone(),
                variant_id: task.variant_id.clone(),
                fold_id: task.fold_id.clone(),
                branch_path: task.branch_path.clone(),
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
                target_domain: None,
            },
        })
    }
}

/// Build the operator-SELECT UNION fixture: a hand-built STACKING graph mirroring the parity DSL —
/// `filter:y_outlier` (shared prefix) feeds two operator choices, each `transform -> model`, whose
/// models fan into `merge:gen` (OOF) -> `model:meta` — plus the matching `OperatorVariantModel`
/// (one `active_subsequence`-only choice per sub-sequence). The plan validates as a full union; the
/// model's active_nodes name exactly each choice's `{transform, model}`.
fn operator_select_union() -> (ExecutionPlan, OperatorVariantModel) {
    let filter = "filter:y_outlier";
    let (t0, m0) = ("transform:choice0__snv", "model:choice0__pls");
    let (t1, m1) = ("transform:choice1__msc", "model:choice1__ridge");
    let merge = "merge:gen";
    let meta = "model:meta";

    let data_edge = |source: &str, sport: &str, target: &str| EdgeSpec {
        source: PortRef {
            node_id: NodeId::new(source).unwrap(),
            port_name: sport.to_string(),
        },
        target: PortRef {
            node_id: NodeId::new(target).unwrap(),
            port_name: "x".to_string(),
        },
        contract: EdgeContract {
            requires_oof: false,
            requires_fold_alignment: false,
            ..EdgeContract::new(PortKind::Data, None)
        },
    };
    let oof_edge = |source: &str, target_port: &str| EdgeSpec {
        source: PortRef {
            node_id: NodeId::new(source).unwrap(),
            port_name: "oof".to_string(),
        },
        target: PortRef {
            node_id: NodeId::new(merge).unwrap(),
            port_name: target_port.to_string(),
        },
        contract: EdgeContract {
            requires_oof: true,
            requires_fold_alignment: false,
            ..EdgeContract::new(PortKind::Prediction, None)
        },
    };

    let graph = GraphSpec {
        id: "g:operator.select".to_string(),
        interface: GraphInterface::default(),
        nodes: vec![
            node(
                filter,
                NodeKind::Exclude,
                vec![port("x", PortKind::Data)],
                vec![port("x", PortKind::Data)],
            ),
            node(
                t0,
                NodeKind::Transform,
                vec![port("x", PortKind::Data)],
                vec![port("x", PortKind::Data)],
            ),
            node(
                m0,
                NodeKind::Model,
                vec![port("x", PortKind::Data)],
                vec![port("oof", PortKind::Prediction)],
            ),
            node(
                t1,
                NodeKind::Transform,
                vec![port("x", PortKind::Data)],
                vec![port("x", PortKind::Data)],
            ),
            node(
                m1,
                NodeKind::Model,
                vec![port("x", PortKind::Data)],
                vec![port("oof", PortKind::Prediction)],
            ),
            node(
                merge,
                NodeKind::PredictionJoin,
                vec![
                    port("c0", PortKind::Prediction),
                    port("c1", PortKind::Prediction),
                ],
                vec![port("x", PortKind::Data)],
            ),
            node(
                meta,
                NodeKind::Model,
                vec![port("x", PortKind::Data)],
                vec![port("oof", PortKind::Prediction)],
            ),
        ],
        edges: vec![
            data_edge(filter, "x", t0),
            data_edge(t0, "x", m0),
            data_edge(filter, "x", t1),
            data_edge(t1, "x", m1),
            oof_edge(m0, "c0"),
            oof_edge(m1, "c1"),
            data_edge(merge, "x", meta),
        ],
        search_space_fingerprint: None,
        metadata: BTreeMap::new(),
    };

    let campaign = CampaignSpec {
        inner_cv: None,
        id: "campaign:operator.select".to_string(),
        root_seed: Some(7),
        leakage_policy: Default::default(),
        aggregation_policy: Default::default(),
        split_invocation: Some(SplitInvocation {
            id: "split:outer".to_string(),
            controller_id: None,
            leakage_policy: Default::default(),
            params: BTreeMap::new(),
            fold_set: Some(two_fold_set()),
        }),
        generation: Default::default(),
        shape_plans: BTreeMap::new(),
        data_bindings: BTreeMap::new(),
        branch_view_plans: Vec::new(),
        metadata: BTreeMap::new(),
    };

    let plan = build_execution_plan(
        "plan:operator.select",
        graph,
        campaign,
        &operator_select_manifests(),
    )
    .unwrap();

    let active_nodes = BTreeMap::from([
        (
            "choice0".to_string(),
            BTreeSet::from([NodeId::new(t0).unwrap(), NodeId::new(m0).unwrap()]),
        ),
        (
            "choice1".to_string(),
            BTreeSet::from([NodeId::new(t1).unwrap(), NodeId::new(m1).unwrap()]),
        ),
    ]);
    let model = OperatorVariantModel {
        generator_id: NodeId::new("generator:preproc_model").unwrap(),
        dimension: GenerationDimension {
            name: "generator:preproc_model.operators".to_string(),
            choices: vec![
                GenerationChoice {
                    label: "choice0".to_string(),
                    value: json!("choice0"),
                    param_overrides: Vec::new(),
                    active_subsequence: Some("choice0".to_string()),
                },
                GenerationChoice {
                    label: "choice1".to_string(),
                    value: json!("choice1"),
                    param_overrides: Vec::new(),
                    active_subsequence: Some("choice1".to_string()),
                },
            ],
        },
        active_nodes,
        variant_labels: BTreeMap::new(),
    };
    model.validate().unwrap();
    (plan, model)
}

fn operator_select_manifests() -> crate::controller::ControllerRegistry {
    let mut manifests = crate::controller::ControllerRegistry::new();
    manifests
        .register(controller_manifest(
            "controller:transform",
            NodeKind::Transform,
        ))
        .unwrap();
    manifests
        .register(controller_manifest("controller:model", NodeKind::Model))
        .unwrap();
    // The shared-prefix filter and the stacking merge get their own manifests so the union plan
    // validates (the OOF edge target must declare consumes_oof_predictions).
    let mut filter_manifest = controller_manifest("controller:filter", NodeKind::Exclude);
    filter_manifest.supported_phases = BTreeSet::from([Phase::FitCv, Phase::Refit, Phase::Predict]);
    manifests.register(filter_manifest).unwrap();
    let mut merge_manifest = controller_manifest("controller:merge", NodeKind::PredictionJoin);
    merge_manifest
        .capabilities
        .insert(ControllerCapability::EmitsPredictions);
    merge_manifest
        .capabilities
        .insert(ControllerCapability::ConsumesOofPredictions);
    merge_manifest.supported_phases = BTreeSet::from([Phase::FitCv, Phase::Refit, Phase::Predict]);
    manifests.register(merge_manifest).unwrap();
    manifests
}

fn operator_select_controllers() -> RuntimeControllerRegistry {
    let mut controllers = RuntimeControllerRegistry::new();
    controllers
        .register(Box::new(MockController {
            id: ControllerId::new("controller:filter").unwrap(),
            handle: 1,
            emit_prediction: false,
        }))
        .unwrap();
    controllers
        .register(Box::new(MockController {
            id: ControllerId::new("controller:transform").unwrap(),
            handle: 2,
            emit_prediction: false,
        }))
        .unwrap();
    controllers
        .register(Box::new(OperatorScoringController {
            id: ControllerId::new("controller:model").unwrap(),
            handle: 3,
            offsets: BTreeMap::from([
                (NodeId::new("model:choice0__pls").unwrap(), 0.0),
                (NodeId::new("model:choice1__ridge").unwrap(), 1.0),
            ]),
        }))
        .unwrap();
    controllers
}

/// Re-enumerate the model's variants and return `(variant, active_nodes, all_choice_nodes)` for the
/// choice whose `active_subsequence` matches `choice_key`.
fn operator_variant_for_choice<'a>(
    model: &'a OperatorVariantModel,
    choice_key: &str,
) -> (VariantPlan, &'a BTreeSet<NodeId>, BTreeSet<NodeId>) {
    let variants = enumerate_variants(&model.generation_spec(), Some(7)).unwrap();
    let variant = variants
        .into_iter()
        .find(|variant| {
            variant
                .choices
                .get(&model.dimension.name)
                .and_then(|choice| choice.active_subsequence.as_deref())
                == Some(choice_key)
        })
        .unwrap();
    let active_nodes = model.active_nodes.get(choice_key).unwrap();
    let all_choice_nodes = model
        .active_nodes
        .values()
        .flatten()
        .cloned()
        .collect::<BTreeSet<_>>();
    (variant, active_nodes, all_choice_nodes)
}

#[test]
fn prune_plan_to_active_elides_merge_meta_and_sibling_choices() {
    // Pruning correctness: each pruned candidate's node_plans keys == shared_prefix ∪
    // active_nodes[choice]; merge:gen + model:meta + the sibling choice are ELIDED (absent); every
    // surviving edge has both endpoints in keep.
    let (plan, model) = operator_select_union();
    let (variant, active_nodes, all_choice_nodes) = operator_variant_for_choice(&model, "choice0");

    let pruned = prune_plan_to_active(&plan, active_nodes, &all_choice_nodes, &variant).unwrap();

    let filter = NodeId::new("filter:y_outlier").unwrap();
    let t0 = NodeId::new("transform:choice0__snv").unwrap();
    let m0 = NodeId::new("model:choice0__pls").unwrap();
    let expected_keep: BTreeSet<NodeId> = BTreeSet::from([filter.clone(), t0.clone(), m0.clone()]);

    let keep: BTreeSet<NodeId> = pruned.node_plans.keys().cloned().collect();
    assert_eq!(
        keep, expected_keep,
        "kept set must be shared_prefix (filter) ∪ active_nodes[choice0] (transform+model)"
    );
    // The graph nodes mirror the node_plans exactly.
    let graph_nodes: BTreeSet<NodeId> = pruned
        .graph_plan
        .graph
        .nodes
        .iter()
        .map(|node| node.id.clone())
        .collect();
    assert_eq!(graph_nodes, expected_keep);

    // The stacking merge + meta-model + the sibling choice are ELIDED.
    for elided in [
        "merge:gen",
        "model:meta",
        "transform:choice1__msc",
        "model:choice1__ridge",
    ] {
        let id = NodeId::new(elided).unwrap();
        assert!(
            !pruned.node_plans.contains_key(&id),
            "`{elided}` must be elided from the pruned SELECT candidate"
        );
    }

    // Surviving edges only within keep — no dangling edge into the elided merge.
    for edge in &pruned.graph_plan.graph.edges {
        assert!(
            keep.contains(&edge.source.node_id) && keep.contains(&edge.target.node_id),
            "edge {} -> {} escapes the kept set",
            edge.source.node_id,
            edge.target.node_id
        );
    }
    // No surviving edge targets the elided merge.
    assert!(
        !pruned
            .graph_plan
            .graph
            .edges
            .iter()
            .any(|edge| edge.target.node_id.as_str() == "merge:gen"),
        "no OOF edge into the elided merge may survive"
    );
    // The chosen model's rebuilt input_nodes point at the chosen transform only (the scheduler reads
    // this; a stale union entry would reintroduce an inactive edge).
    assert_eq!(pruned.node_plans[&m0].input_nodes, vec![t0.clone()]);
    assert_eq!(pruned.node_plans[&t0].input_nodes, vec![filter.clone()]);
    assert_eq!(pruned.variants, vec![variant]);
    pruned.validate().unwrap();
}

#[test]
fn prune_plan_to_active_is_deterministic() {
    // Determinism: two prunes of the same choice are byte-identical.
    let (plan, model) = operator_select_union();
    let (variant, active_nodes, all_choice_nodes) = operator_variant_for_choice(&model, "choice1");
    let left = prune_plan_to_active(&plan, active_nodes, &all_choice_nodes, &variant).unwrap();
    let right = prune_plan_to_active(&plan, active_nodes, &all_choice_nodes, &variant).unwrap();
    assert_eq!(
        serde_json::to_string(&left).unwrap(),
        serde_json::to_string(&right).unwrap(),
        "two prunes of the same choice must be byte-identical"
    );
}

#[test]
fn validate_active_inputs_rejects_a_dangling_prune() {
    // A deliberately-dangling prune: keep the model but DROP its feeding transform from the active
    // set, so the model's required `x` input port has zero surviving sources. P4-1 must reject it.
    let (plan, model) = operator_select_union();
    let (variant, _active_nodes, all_choice_nodes) = operator_variant_for_choice(&model, "choice0");
    // active = model only (transform omitted) -> model:choice0__pls.x dangles.
    let dangling_active = BTreeSet::from([NodeId::new("model:choice0__pls").unwrap()]);
    let error = prune_plan_to_active(&plan, &dangling_active, &all_choice_nodes, &variant)
        .unwrap_err()
        .to_string();
    assert!(
        error.contains("dangling") || error.contains("zero surviving sources"),
        "P4-1 must reject a dangling prune: {error}"
    );
}

#[test]
fn select_best_operator_variant_runs_both_pruned_candidates_and_picks_winner() {
    use crate::metrics::RegressionMetricKind;

    // (1) A 2-variant operator `_or_` runs BOTH pruned SELECT candidates; the winner is the
    // lower-RMSE choice (choice0, offset 0); both Validation reports are present and variant-tagged;
    // and the winner refits on its pruned plan (see the dedicated pruning/CLI tests for refit).
    let (plan, model) = operator_select_union();
    let controllers = operator_select_controllers();
    let run_id = RunId::new("run:operator.select").unwrap();

    let selected = select_best_operator_variant_outcome_by_cv(
        &plan,
        &model,
        &run_id,
        Some(7),
        RegressionMetricKind::Rmse,
        |pruned_plan, ctx| {
            // The candidate is the PRUNED plan, not the union: the merge + meta + sibling choice are
            // gone, so exactly one terminal producer remains.
            assert!(
                !pruned_plan
                    .node_plans
                    .contains_key(&NodeId::new("merge:gen").unwrap()),
                "the scored plan must be the pruned candidate, not the stacking union"
            );
            SequentialScheduler
                .execute_campaign_phase(pruned_plan, &controllers, ctx, Phase::FitCv)
                .map(|_| ())
        },
    )
    .unwrap();

    let outcome = selected.expect("operator scoring is on (targets emitted)");
    let ranking = &outcome.decision.ranked_candidates;
    assert_eq!(ranking.len(), 2);
    assert_eq!(ranking[0].rank, 1);
    assert_eq!(ranking[1].rank, 2);
    let selection = outcome.selection;
    // The winner is choice0 (RMSE 0) — recover its variant id from the model's enumeration.
    let (winner_variant, _, _) = operator_variant_for_choice(&model, "choice0");
    assert_eq!(selection.selected_variant_id, winner_variant.variant_id);
    assert_eq!(
        ranking[0].candidate_id,
        winner_variant.variant_id.to_string()
    );

    // Both choices' Validation reports are present and tagged with their own variant ids.
    let scored: BTreeSet<VariantId> = selection
        .validation_reports
        .iter()
        .filter_map(|report| report.variant_id.clone())
        .collect();
    let expected: BTreeSet<VariantId> = enumerate_variants(&model.generation_spec(), Some(7))
        .unwrap()
        .into_iter()
        .map(|variant| variant.variant_id)
        .collect();
    assert_eq!(
        scored, expected,
        "every operator choice must be scored+tagged"
    );
    assert!(
        selection
            .validation_reports
            .iter()
            .all(|report| report.partition == PredictionPartition::Validation),
        "operator-SELECT retains only Validation (OOF) reports"
    );
}

/// Phase 5: when the operator model carries `variant_labels`, `select_best_operator_variant_by_cv`
/// STAMPS each choice's content fingerprint on EVERY validation report — the WINNER's and the
/// losers' — keyed by the choice the report belongs to (resolved the SAME way `variant_id` is). This
/// is the cross-language mapping the nirs4all host relies on (report -> operator-choice config).
#[test]
fn select_best_operator_variant_stamps_variant_label_on_winner_and_loser_reports() {
    use crate::metrics::RegressionMetricKind;

    let (plan, mut model) = operator_select_union();
    // Inject two distinct, valid 64-hex content fingerprints (the derivation is contract-tested in
    // dag-ml-core's dsl tests; here we assert PROPAGATION onto the reports).
    let choice0_label = "a".repeat(64);
    let choice1_label = "b".repeat(64);
    model.variant_labels = BTreeMap::from([
        ("choice0".to_string(), choice0_label.clone()),
        ("choice1".to_string(), choice1_label.clone()),
    ]);
    model.validate().unwrap();
    let controllers = operator_select_controllers();
    let run_id = RunId::new("run:operator.label").unwrap();

    let selection = select_best_operator_variant_by_cv(
        &plan,
        &model,
        &run_id,
        Some(7),
        RegressionMetricKind::Rmse,
        |pruned_plan, ctx| {
            SequentialScheduler
                .execute_campaign_phase(pruned_plan, &controllers, ctx, Phase::FitCv)
                .map(|_| ())
        },
    )
    .unwrap()
    .expect("operator scoring is on");

    // The winner is choice0 (RMSE 0).
    let (winner_variant, _, _) = operator_variant_for_choice(&model, "choice0");
    let (loser_variant, _, _) = operator_variant_for_choice(&model, "choice1");

    // Every report carries the label of the choice its variant belongs to (winner AND loser).
    let mut saw_winner_label = false;
    let mut saw_loser_label = false;
    for report in &selection.validation_reports {
        let variant_id = report.variant_id.as_ref().unwrap();
        let expected = if variant_id == &winner_variant.variant_id {
            saw_winner_label = true;
            &choice0_label
        } else if variant_id == &loser_variant.variant_id {
            saw_loser_label = true;
            &choice1_label
        } else {
            panic!("unexpected variant id {variant_id}");
        };
        assert_eq!(
            report.variant_label.as_ref(),
            Some(expected),
            "each report must carry its own choice's variant_label"
        );
    }
    assert!(
        saw_winner_label,
        "the WINNER report must carry variant_label, not just the losers"
    );
    assert!(saw_loser_label, "the loser report must carry variant_label");
}

/// operator-SELECT additively surfaces EACH variant's per-fold VALIDATION (OOF) PREDICTIONS (not just
/// the scalar reports), each re-tagged with the variant's id + content fingerprint, so a host can fill
/// a non-selected variant's per-sample prediction rows. The blocks are the variant's OWN validation
/// predictions (re-tagged by variant id — no cross-variant mixing), are `Validation`-only, and pair
/// with their id-matched y_true — the leakage-safe contract.
#[test]
fn select_best_operator_variant_surfaces_per_variant_validation_predictions() {
    use crate::metrics::RegressionMetricKind;

    let (plan, mut model) = operator_select_union();
    let choice0_label = "a".repeat(64);
    let choice1_label = "b".repeat(64);
    model.variant_labels = BTreeMap::from([
        ("choice0".to_string(), choice0_label.clone()),
        ("choice1".to_string(), choice1_label.clone()),
    ]);
    model.validate().unwrap();
    let controllers = operator_select_controllers();
    let run_id = RunId::new("run:operator.predictions").unwrap();

    let selection = select_best_operator_variant_by_cv(
        &plan,
        &model,
        &run_id,
        Some(7),
        RegressionMetricKind::Rmse,
        |pruned_plan, ctx| {
            SequentialScheduler
                .execute_campaign_phase(pruned_plan, &controllers, ctx, Phase::FitCv)
                .map(|_| ())
        },
    )
    .unwrap()
    .expect("operator scoring is on");

    let (winner_variant, _, _) = operator_variant_for_choice(&model, "choice0");
    let (loser_variant, _, _) = operator_variant_for_choice(&model, "choice1");

    // Both variants surface captured validation predictions, each tagged with its OWN id + label.
    let captured: BTreeSet<VariantId> = selection
        .variant_validation_predictions
        .iter()
        .map(|captured| captured.variant_id.clone())
        .collect();
    assert_eq!(
        captured,
        BTreeSet::from([
            winner_variant.variant_id.clone(),
            loser_variant.variant_id.clone()
        ]),
        "every operator choice must surface its captured validation predictions"
    );

    for captured in &selection.variant_validation_predictions {
        let expected_label = if captured.variant_id == winner_variant.variant_id {
            &choice0_label
        } else {
            &choice1_label
        };
        assert_eq!(
            captured.variant_label.as_ref(),
            Some(expected_label),
            "captured predictions carry the variant's own content fingerprint"
        );
        // Every captured block is a Validation (OOF) block — never Final/Test/refit (the transient run
        // is FIT_CV-only), the leakage-safe contract.
        assert!(
            !captured.predictions.is_empty(),
            "the variant's per-fold validation blocks are captured"
        );
        assert!(
            captured
                .predictions
                .iter()
                .all(|block| block.partition == PredictionPartition::Validation),
            "only Validation (OOF) predictions are surfaced — no refit/train/test"
        );
        // Each prediction block is paired POSITION-FOR-POSITION with an id-matched y_true block.
        assert_eq!(
            captured.predictions.len(),
            captured.regression_targets.len(),
            "every captured prediction block has its paired y_true"
        );
        for (block, target) in captured
            .predictions
            .iter()
            .zip(captured.regression_targets.iter())
        {
            let pred_ids: BTreeSet<_> = block.sample_ids.iter().cloned().collect();
            let target_ids: BTreeSet<_> = target
                .unit_ids
                .iter()
                .map(|unit| match unit {
                    crate::aggregation::PredictionUnitId::Sample(sample_id) => sample_id.clone(),
                    other => panic!("unexpected non-sample unit id {other:?}"),
                })
                .collect();
            assert_eq!(
                pred_ids, target_ids,
                "the per-fold y_true covers exactly the prediction block's samples (id-matched)"
            );
        }
    }
}

/// A host controller may VALIDLY emit its `regression_targets` rows in a DIFFERENT order than the
/// PredictionBlock's `sample_ids` (the scoring path realigns by unit id before computing metrics). But
/// the host surfaces a captured loser block POSITIONALLY — y_pred from `block.sample_ids`/`values`
/// paired ROW-FOR-ROW with `regression_targets.values`. So the captured y_true must be REBUILT in
/// `sample_ids` order; `target_block_aligned_to_samples` does that. This pins the per-sample y_true is
/// aligned to y_pred by id even when the target block arrives shuffled.
#[test]
fn captured_validation_y_true_is_realigned_to_prediction_sample_order() {
    use crate::aggregation::PredictionUnitId;

    let sample_order = [
        SampleId::new("s1").unwrap(),
        SampleId::new("s2").unwrap(),
        SampleId::new("s3").unwrap(),
    ];
    // The y_true block arrives in a DIFFERENT order than `sample_order` (s3, s1, s2), each row a
    // distinct value tied to its sample so a misalignment would be observable.
    let shuffled_targets = RegressionTargetBlock {
        validity_masks: None,
        level: PredictionLevel::Sample,
        unit_ids: vec![
            PredictionUnitId::Sample(SampleId::new("s3").unwrap()),
            PredictionUnitId::Sample(SampleId::new("s1").unwrap()),
            PredictionUnitId::Sample(SampleId::new("s2").unwrap()),
        ],
        values: vec![vec![30.0], vec![10.0], vec![20.0]],
        target_names: vec!["y".to_string()],
    };

    let aligned = target_block_aligned_to_samples(&sample_order, &shuffled_targets);

    // The realigned block is in `sample_order` (s1, s2, s3) with each sample's OWN value, so a
    // positional zip of y_pred[i] (sample_order[i]) with y_true[i] pairs the right sample.
    assert_eq!(
        aligned.unit_ids,
        vec![
            PredictionUnitId::Sample(SampleId::new("s1").unwrap()),
            PredictionUnitId::Sample(SampleId::new("s2").unwrap()),
            PredictionUnitId::Sample(SampleId::new("s3").unwrap()),
        ],
        "y_true unit ids are realigned to the prediction block's sample order"
    );
    assert_eq!(
        aligned.values,
        vec![vec![10.0], vec![20.0], vec![30.0]],
        "each y_true row moves with its sample id (s1->10, s2->20, s3->30), not its arrival position"
    );
    assert_eq!(aligned.target_names, vec!["y".to_string()]);
}

/// END-TO-END through `capture_variant_validation_predictions`: a fold's multi-sample VALIDATION
/// `PredictionBlock` whose paired `RegressionTargetRecord` arrives in a DIFFERENT row order (the
/// `sample_targets_match_block` precondition only requires the same sample SET) must be captured with
/// its y_true REALIGNED to the prediction block's `sample_ids`, so a host that pairs y_pred ↔ y_true by
/// row position reads the right per-sample ground truth — no cross-sample y_true misalignment.
#[test]
fn capture_variant_validation_predictions_realigns_shuffled_fold_targets() {
    use crate::aggregation::PredictionUnitId;

    let producer = NodeId::new("model:choice0__pls").unwrap();
    let variant_id = VariantId::new("variant:probe").unwrap();
    let mut ctx = RunContext::new(RunId::new("run:capture.shuffle").unwrap(), Some(7));
    ctx.variant_id = Some(variant_id.clone());

    // A 3-sample validation block in s1,s2,s3 order — y_pred = y_true + 100 so each value is
    // distinguishable per sample.
    ctx.prediction_store
        .append(PredictionBlock {
            prediction_id: Some("pred:fold0".to_string()),
            producer_node: producer.clone(),
            producer_port: None,
            partition: PredictionPartition::Validation,
            fold_id: Some(FoldId::new("fold:0").unwrap()),
            sample_ids: vec![
                SampleId::new("s1").unwrap(),
                SampleId::new("s2").unwrap(),
                SampleId::new("s3").unwrap(),
            ],
            values: vec![vec![110.0], vec![120.0], vec![130.0]],
            target_names: vec!["y".to_string()],
        })
        .unwrap();
    // The matching y_true record arrives SHUFFLED (s3, s1, s2) — a valid host ordering.
    ctx.regression_target_records.push(RegressionTargetRecord {
        producer_node: producer.clone(),
        producer_port: None,
        variant_id: Some(variant_id.clone()),
        partition: PredictionPartition::Validation,
        fold_id: Some(FoldId::new("fold:0").unwrap()),
        block: RegressionTargetBlock {
            validity_masks: None,
            level: PredictionLevel::Sample,
            unit_ids: vec![
                PredictionUnitId::Sample(SampleId::new("s3").unwrap()),
                PredictionUnitId::Sample(SampleId::new("s1").unwrap()),
                PredictionUnitId::Sample(SampleId::new("s2").unwrap()),
            ],
            values: vec![vec![30.0], vec![10.0], vec![20.0]],
            target_names: vec!["y".to_string()],
        },
    });

    let captured = capture_variant_validation_predictions(&variant_id, None, &ctx);
    assert_eq!(captured.predictions.len(), 1);
    assert_eq!(captured.regression_targets.len(), 1);

    // The surfaced y_true is realigned to the prediction block's sample order (s1,s2,s3), so a
    // POSITIONAL zip of y_pred[i] ↔ y_true[i] pairs the SAME sample: s1->(110,10), s2->(120,20),
    // s3->(130,30). A misalignment (the raw shuffled order) would pair s1's y_pred with s3's y_true.
    let block = &captured.predictions[0];
    let target = &captured.regression_targets[0];
    for (position, sample_id) in block.sample_ids.iter().enumerate() {
        assert_eq!(
            target.unit_ids[position],
            PredictionUnitId::Sample(sample_id.clone()),
            "y_true row {position} is aligned to the prediction block's sample at that position"
        );
    }
    assert_eq!(
        target.values,
        vec![vec![10.0], vec![20.0], vec![30.0]],
        "y_true values follow their sample id into prediction order, not their shuffled arrival order"
    );
}

#[test]
fn select_best_operator_variant_is_leakage_safe_inactive_choice_writes_no_validation() {
    use crate::metrics::RegressionMetricKind;

    // (5) Leakage: when scoring choice0, the inactive choice1's model is ABSENT from the pruned
    // graph, so it is never fit and writes NO Validation block into that context. We assert this by
    // inspecting each per-variant context's prediction store from inside the scoring closure.
    let (plan, model) = operator_select_union();
    let controllers = operator_select_controllers();
    let run_id = RunId::new("run:operator.leakage").unwrap();

    let c0_model = NodeId::new("model:choice0__pls").unwrap();
    let c1_model = NodeId::new("model:choice1__ridge").unwrap();

    select_best_operator_variant_by_cv(
        &plan,
        &model,
        &run_id,
        Some(7),
        RegressionMetricKind::Rmse,
        |pruned_plan, ctx| {
            SequentialScheduler
                .execute_campaign_phase(pruned_plan, &controllers, ctx, Phase::FitCv)
                .map(|_| ())?;
            // Exactly ONE of the two choice models produced blocks in this context; the other is
            // physically absent from the pruned graph, so no inactive choice's OOF can leak.
            let producers: BTreeSet<NodeId> = ctx
                .prediction_store
                .blocks()
                .iter()
                .map(|block| block.producer_node.clone())
                .collect();
            let has_c0 = producers.contains(&c0_model);
            let has_c1 = producers.contains(&c1_model);
            assert!(
                has_c0 ^ has_c1,
                "exactly one choice model may write Validation blocks in a pruned context (c0={has_c0}, c1={has_c1})"
            );
            Ok(())
        },
    )
    .unwrap();
}

#[test]
fn select_best_operator_variant_from_models_enumerates_multiple_generators() {
    use crate::metrics::RegressionMetricKind;

    // Independent operator generators form a Cartesian product. No host targets
    // means SELECT is off, so the run keeps its default variant.
    let (plan, model) = operator_select_union();
    let mut second = model.clone();
    second.generator_id = NodeId::new("generator:other").unwrap();
    second.dimension.name = "generator:other.operators".to_string();
    let models = vec![model, second];
    let run_id = RunId::new("run:operator.multi").unwrap();

    let variants = enumerate_operator_variants(&models, Some(7)).unwrap();
    assert_eq!(variants.len(), 4);
    assert!(variants.iter().all(|variant| variant.choices.len() == 2));

    let selected = select_best_operator_variant_from_models(
        &plan,
        &models,
        &run_id,
        Some(7),
        RegressionMetricKind::Rmse,
        |_plan, _ctx| Ok(()),
    )
    .unwrap();
    assert!(selected.is_none());

    // An empty model slice is a no-op (no operator generator to SELECT): returns Ok(None).
    let none = select_best_operator_variant_from_models(
        &plan,
        &[],
        &run_id,
        Some(7),
        RegressionMetricKind::Rmse,
        |_plan, _ctx| Ok(()),
    )
    .unwrap();
    assert!(none.is_none());
}

#[test]
fn multi_operator_select_pools_oof_rows_with_branch_scoped_ids() {
    let (_, mut left) = operator_select_union();
    let mut right = left.clone();
    right.generator_id = NodeId::new("generator:right").unwrap();
    right.dimension.name = "generator:right.operators".to_string();
    left.active_nodes.insert(
        "choice0".into(),
        BTreeSet::from([NodeId::new("model:left").unwrap()]),
    );
    right.active_nodes.insert(
        "choice0".into(),
        BTreeSet::from([NodeId::new("model:right").unwrap()]),
    );
    let models = [left, right];
    let variant = enumerate_operator_variants(&models, Some(7))
        .unwrap()
        .into_iter()
        .find(|variant| {
            variant
                .choices
                .values()
                .all(|choice| choice.label == "choice0")
        })
        .unwrap();
    let average = |producer: &str, predictions: Vec<f64>| {
        let units = (0..predictions.len())
            .map(|index| PredictionUnitId::Sample(SampleId::new(format!("same:{index}")).unwrap()))
            .collect::<Vec<_>>();
        OofAverageBlock {
            predictions: AggregatedPredictionBlock {
                prediction_id: None,
                producer_node: NodeId::new(producer).unwrap(),
                producer_port: None,
                partition: PredictionPartition::Validation,
                fold_id: Some(FoldId::new("avg").unwrap()),
                level: PredictionLevel::Sample,
                unit_ids: units.clone(),
                values: predictions.into_iter().map(|value| vec![value]).collect(),
                target_names: Vec::new(),
            },
            y_true: RegressionTargetBlock {
                level: PredictionLevel::Sample,
                unit_ids: units.clone(),
                values: vec![vec![0.0]; units.len()],
                validity_masks: None,
                target_names: Vec::new(),
            },
        }
    };
    let left_average = average("model:left", vec![0.0]);
    let right_average = average("model:right", vec![2.0, 2.0, 2.0]);
    let mut left_weighted = left_average.clone();
    left_weighted.predictions.fold_id = Some(FoldId::new("w_avg").unwrap());
    let mut right_weighted = right_average.clone();
    right_weighted.predictions.fold_id = Some(FoldId::new("w_avg").unwrap());
    let score = pooled_operator_candidate_score(
        &variant,
        &models,
        &[left_average, right_average, left_weighted, right_weighted],
        RegressionMetricKind::Rmse,
    )
    .unwrap();
    assert!((score.metrics["rmse"] - 3.0_f64.sqrt()).abs() < 1e-12);
    assert_eq!(score.metadata["row_count"], 4);
    assert_eq!(score.metadata["operator_branch_count"], 2);
}

#[test]
fn multi_operator_select_scores_each_pruned_combination_and_refits_winner() {
    let (base, left) = operator_select_union();
    let mut graph = base.graph_plan.graph.clone();
    let template = graph
        .nodes
        .iter()
        .find(|node| node.id.as_str() == "model:choice0__pls")
        .unwrap()
        .clone();
    let prefix_edge = graph
        .edges
        .iter()
        .find(|edge| {
            edge.source.node_id.as_str() == "filter:y_outlier" && edge.target.port_name == "x"
        })
        .unwrap()
        .clone();
    for id in ["model:right0", "model:right1"] {
        let mut node = template.clone();
        node.id = NodeId::new(id).unwrap();
        graph.nodes.push(node);
        let mut edge = prefix_edge.clone();
        edge.target.node_id = NodeId::new(id).unwrap();
        graph.edges.push(edge);
    }
    let plan = build_execution_plan(
        "plan:multi.operator.select",
        graph,
        base.campaign.clone(),
        &operator_select_manifests(),
    )
    .unwrap();
    let right = OperatorVariantModel {
        generator_id: NodeId::new("generator:right").unwrap(),
        dimension: GenerationDimension {
            name: "generator:right.operators".into(),
            choices: ["right0", "right1"]
                .into_iter()
                .map(|label| GenerationChoice {
                    label: label.into(),
                    value: json!(label),
                    param_overrides: Vec::new(),
                    active_subsequence: Some(label.into()),
                })
                .collect(),
        },
        active_nodes: BTreeMap::from([
            (
                "right0".into(),
                BTreeSet::from([NodeId::new("model:right0").unwrap()]),
            ),
            (
                "right1".into(),
                BTreeSet::from([NodeId::new("model:right1").unwrap()]),
            ),
        ]),
        variant_labels: BTreeMap::new(),
    };
    let models = [left, right];
    let run_id = RunId::new("run:multi.operator.select").unwrap();
    let mut seen = BTreeSet::new();
    let selection = select_best_operator_variant_from_models(
        &plan,
        &models,
        &run_id,
        Some(7),
        RegressionMetricKind::Rmse,
        |pruned, ctx| {
            let active_left = ["model:choice0__pls", "model:choice1__ridge"]
                .into_iter()
                .filter(|id| pruned.node_plans.contains_key(&NodeId::new(*id).unwrap()))
                .collect::<Vec<_>>();
            let active_right = ["model:right0", "model:right1"]
                .into_iter()
                .filter(|id| pruned.node_plans.contains_key(&NodeId::new(*id).unwrap()))
                .collect::<Vec<_>>();
            assert_eq!(
                active_left.len(),
                1,
                "inactive left choice leaked into candidate"
            );
            assert_eq!(
                active_right.len(),
                1,
                "inactive right choice leaked into candidate"
            );
            assert!(!pruned
                .node_plans
                .contains_key(&NodeId::new("merge:gen").unwrap()));
            seen.insert((active_left[0].to_string(), active_right[0].to_string()));
            for (branch_index, (producer, offset, count)) in [
                (
                    active_left[0],
                    if active_left[0].contains("choice0") {
                        1.0
                    } else {
                        0.0
                    },
                    1,
                ),
                (
                    active_right[0],
                    if active_right[0].ends_with('0') {
                        0.0
                    } else {
                        2.0
                    },
                    3,
                ),
            ]
            .into_iter()
            .enumerate()
            {
                let unit_ids = (0..count)
                    .map(|i| {
                        PredictionUnitId::Sample(SampleId::new(format!("shared:{i}")).unwrap())
                    })
                    .collect::<Vec<_>>();
                let block = AggregatedPredictionBlock {
                    prediction_id: None,
                    producer_node: NodeId::new(producer).unwrap(),
                    producer_port: None,
                    partition: PredictionPartition::Validation,
                    fold_id: Some(FoldId::new("avg").unwrap()),
                    level: PredictionLevel::Sample,
                    unit_ids: unit_ids.clone(),
                    values: vec![vec![offset]; count],
                    target_names: Vec::new(),
                };
                let truth = RegressionTargetBlock {
                    level: PredictionLevel::Sample,
                    unit_ids,
                    values: vec![vec![0.0]; count],
                    validity_masks: None,
                    target_names: Vec::new(),
                };
                let report = score_regression_aggregated_block(
                    &block,
                    &truth,
                    &[RegressionMetricKind::Rmse],
                )?;
                assert_eq!(branch_index, ctx.oof_average_blocks.len());
                ctx.score_collector.push(report);
                ctx.oof_average_blocks.push(OofAverageBlock {
                    predictions: block,
                    y_true: truth,
                });
            }
            Ok(())
        },
    )
    .unwrap()
    .unwrap();
    assert_eq!(
        seen.len(),
        4,
        "every Cartesian candidate must run exactly once"
    );
    let variants = enumerate_operator_variants(&models, Some(7)).unwrap();
    let winner = variants
        .iter()
        .find(|variant| {
            variant.choices["generator:preproc_model.operators"].label == "choice1"
                && variant.choices["generator:right.operators"].label == "right0"
        })
        .unwrap();
    assert_eq!(selection.selected_variant_id, winner.variant_id);
    assert_eq!(selection.validation_reports.len(), 8);
    assert_eq!(selection.variant_validation_predictions.len(), 4);
    for captured in &selection.variant_validation_predictions {
        assert_eq!(
            captured.oof_averages.len(),
            2,
            "both independent branch producers retain their OOF arrays"
        );
        assert_ne!(
            captured.oof_averages[0].predictions.producer_node,
            captured.oof_averages[1].predictions.producer_node
        );
    }
    let refit = pruned_plan_for_operator_models(&plan, &models, winner).unwrap();
    assert!(refit
        .node_plans
        .contains_key(&NodeId::new("model:choice1__ridge").unwrap()));
    assert!(refit
        .node_plans
        .contains_key(&NodeId::new("model:right0").unwrap()));
    assert!(!refit
        .node_plans
        .contains_key(&NodeId::new("model:right1").unwrap()));
}

/// MM05: sparse predictions remain real observations; only native feature
/// inputs carry zero placeholders and availability indicators.
mod prediction_availability_contract {
    use super::*;
    use crate::fold::KFoldSpec;

    fn sample_ids() -> Vec<SampleId> {
        (1..=12)
            .map(|index| SampleId::new(format!("s{index}")).unwrap())
            .collect()
    }

    fn signed(classes: bool) -> PredictionAvailability {
        let samples = sample_ids();
        PredictionAvailability {
            schema_version: 1,
            sample_ids: samples.clone(),
            source_presence: BTreeMap::from([
                ("nir".into(), vec![true; samples.len()]),
                ("image".into(), vec![true; samples.len()]),
            ]),
            target_names: if classes {
                vec!["class".into()]
            } else {
                vec!["y".into(), "z".into()]
            },
            target_validity_masks: vec![vec![true; if classes { 1 } else { 2 }]; samples.len()],
            class_labels: classes.then_some(vec![0.0, 1.0]),
            sample_labels: classes.then(|| {
                (0..samples.len())
                    .map(|index| Some((index % 2) as f64))
                    .collect()
            }),
        }
    }

    fn base_plan() -> ExecutionPlan {
        let outer = KFoldSpec {
            n_splits: 3,
            shuffle: false,
            seed: Some(7),
        }
        .split("availability.outer", &sample_ids())
        .unwrap();
        nested_stacking_test_plan(outer, true)
    }

    fn graph_with_availability(base: &ExecutionPlan, signed: &PredictionAvailability) -> GraphSpec {
        let mut graph = base.graph_plan.graph.clone();
        graph.metadata.insert(
            "prediction_availability".into(),
            serde_json::to_value(signed).unwrap(),
        );
        for node in &mut graph.nodes {
            match node.id.as_str() {
                "model:base.a" => {
                    node.metadata
                        .insert("prediction_availability_source".into(), json!("nir"));
                }
                "model:base.b" => {
                    node.metadata
                        .insert("prediction_availability_source".into(), json!("image"));
                }
                "model:meta" => {
                    node.metadata
                        .insert("prediction_availability_meta".into(), json!(true));
                }
                _ => panic!("unexpected fixture node"),
            }
        }
        graph
    }

    fn build_signed(
        base: &ExecutionPlan,
        signed: &PredictionAvailability,
    ) -> Result<ExecutionPlan> {
        build_execution_plan(
            "plan:availability",
            graph_with_availability(base, signed),
            base.campaign.clone(),
            &manifests(),
        )
    }

    fn sparse_input(
        port: &str,
        samples: &[SampleId],
        values: Vec<Vec<f64>>,
        names: Vec<String>,
    ) -> PredictionInputSpec {
        PredictionInputSpec {
            producer_node: NodeId::new("model:base.a").unwrap(),
            source_port: port.into(),
            target_port: "a".into(),
            partition: PredictionPartition::Validation,
            prediction_level: PredictionLevel::Sample,
            fold_id: None,
            fold_ids: Vec::new(),
            unit_ids: samples
                .iter()
                .cloned()
                .map(PredictionUnitId::Sample)
                .collect(),
            sample_ids: samples.to_vec(),
            values,
            feature_validity_masks: None,
            source_presence: None,
            prediction_width: names.len(),
            target_names: names,
        }
    }

    #[test]
    fn full_class_distributions_expand_by_id_without_padding_prediction_blocks() {
        let signed = signed(true);
        let requested = vec![
            signed.sample_ids[2].clone(),
            signed.sample_ids[0].clone(),
            signed.sample_ids[1].clone(),
        ];
        let genuine = sparse_input(
            "proba",
            &[requested[2].clone(), requested[0].clone()],
            vec![vec![0.2, 0.8], vec![0.7, 0.3]],
            vec!["0.0".into(), "1.0".into()],
        );
        let original = genuine.clone();
        let input = expand_available_prediction_input(
            &signed,
            "nir",
            genuine,
            &requested,
            &[true, false, true],
        )
        .unwrap();
        assert_eq!(
            input.prediction_width, 2,
            "binary probabilities keep both classes"
        );
        assert_eq!(
            input.values,
            vec![vec![0.7, 0.3], vec![0.0, 0.0], vec![0.2, 0.8]]
        );
        assert_eq!(
            input.feature_validity_masks,
            Some(vec![vec![true, true], vec![false, false], vec![true, true]])
        );
        let matrix = join_prediction_feature_specs(
            &NodeId::new("join:features").unwrap(),
            &[&input],
            &requested,
        )
        .unwrap();
        assert_eq!(
            matrix.values,
            vec![
                vec![0.7, 0.3, 1.0],
                vec![0.0, 0.0, 0.0],
                vec![0.2, 0.8, 1.0]
            ]
        );
        assert_eq!(original.values, vec![vec![0.2, 0.8], vec![0.7, 0.3]]);
        assert!(
            expand_available_prediction_input(
                &signed,
                "nir",
                original.clone(),
                &requested,
                &[true, true, true]
            )
            .is_err(),
            "missing present prediction refuses"
        );
        let mut zero_distribution = original.clone();
        zero_distribution.values[0] = vec![0.0, 0.0];
        assert!(
            expand_available_prediction_input(
                &signed,
                "nir",
                zero_distribution,
                &requested,
                &[true, false, true]
            )
            .is_err(),
            "a zero probability distribution never becomes authentic evidence"
        );
        let mut reordered = original;
        reordered.target_names.reverse();
        assert!(
            expand_available_prediction_input(
                &signed,
                "nir",
                reordered,
                &requested,
                &[true, false, true]
            )
            .is_err(),
            "class columns cannot be permuted"
        );
    }

    #[test]
    fn entirely_absent_source_has_features_only_and_requires_paired_masks() {
        let signed = signed(true);
        let requested = &signed.sample_ids[..2];
        let input = expand_available_prediction_input(
            &signed,
            "nir",
            sparse_input("proba", &[], Vec::new(), Vec::new()),
            requested,
            &[false, false],
        )
        .unwrap();
        assert_eq!(input.values, vec![vec![0.0, 0.0]; 2]);
        assert_eq!(input.target_names, vec!["0.0", "1.0"]);
        let mut missing_presence = input.clone();
        missing_presence.source_presence = None;
        assert!(missing_presence.validate_feature_availability().is_err());
        let mut invalid_placeholder = input.clone();
        invalid_placeholder.values[0][0] = 1.0;
        assert!(invalid_placeholder.validate_feature_availability().is_err());
        let mut target_mask_instead_of_presence = input;
        target_mask_instead_of_presence
            .feature_validity_masks
            .as_mut()
            .unwrap()[0][1] = true;
        assert!(target_mask_instead_of_presence
            .validate_feature_availability()
            .is_err());
        let legacy = sparse_input("pred", requested, vec![vec![2.0]; 2], vec!["y".into()]);
        let wire = serde_json::to_value(&legacy).unwrap();
        assert!(wire.get("feature_validity_masks").is_none());
        assert!(wire.get("source_presence").is_none());
        assert_eq!(
            serde_json::from_value::<PredictionInputSpec>(wire.clone()).unwrap(),
            legacy
        );
        assert_eq!(
            serde_json::to_value(
                serde_json::from_value::<PredictionInputSpec>(wire.clone()).unwrap()
            )
            .unwrap(),
            wire,
            "legacy wire roundtrip remains exact"
        );
    }

    #[test]
    fn regression_predictions_do_not_use_heldout_label_validity_as_feature_presence() {
        let mut signed = signed(false);
        signed.target_validity_masks[0][1] = false;
        let requested = &signed.sample_ids[..2];
        let input = expand_available_prediction_input(
            &signed,
            "nir",
            sparse_input(
                "pred",
                requested,
                vec![vec![5.0, 11.0], vec![7.0, 13.0]],
                signed.target_names.clone(),
            ),
            requested,
            &[true, true],
        )
        .unwrap();
        assert_eq!(input.values[0], vec![5.0, 11.0]);
        assert_eq!(
            input.feature_validity_masks,
            Some(vec![vec![true, true]; 2])
        );
    }

    #[test]
    fn sparse_oof_keeps_exact_native_fold_sample_identity_and_refuses_foreign_or_duplicate_evidence(
    ) {
        let base = base_plan();
        let mut signed = signed(false);
        signed.source_presence.get_mut("nir").unwrap()[0] = false;
        let plan = build_signed(&base, &signed).unwrap();
        let nested = nested_stacking_campaign_plan(&plan).unwrap().unwrap();
        let folds = nested.refit_fold_set.unwrap();
        let edge = &plan.graph_plan.graph.edges[0];
        let mut blocks = Vec::new();
        for fold in &folds.folds {
            let presence = signed.presence("nir", &fold.validation_sample_ids).unwrap();
            let ids = fold
                .validation_sample_ids
                .iter()
                .zip(presence)
                .filter_map(|(sample, present)| present.then_some(sample.clone()))
                .collect::<Vec<_>>();
            if !ids.is_empty() {
                blocks.push(PredictionBlock {
                    prediction_id: None,
                    producer_node: edge.source.node_id.clone(),
                    producer_port: Some(edge.source.port_name.clone()),
                    partition: PredictionPartition::Validation,
                    fold_id: Some(fold.fold_id.clone()),
                    values: vec![vec![9.0, 17.0]; ids.len()],
                    sample_ids: ids,
                    target_names: signed.target_names.clone(),
                });
            }
        }
        let scope = PhaseScope {
            phase: Phase::Refit,
            variant_id: None,
            variant: None,
            fold_id: None,
            seed_root: Some(1),
        };
        let refs = blocks.iter().collect::<Vec<_>>();
        let input = available_oof_input(&plan, edge, &scope, &refs, &folds, &folds.sample_ids)
            .unwrap()
            .unwrap();
        assert_eq!(input.sample_ids, folds.sample_ids);
        assert_eq!(input.values[0], vec![0.0, 0.0]);
        assert_eq!(input.values[1], vec![9.0, 17.0]);
        assert!(blocks
            .iter()
            .all(|block| !block.sample_ids.contains(&signed.sample_ids[0])));
        let mut duplicate = refs.clone();
        duplicate.push(&blocks[0]);
        assert!(validate_available_oof_blocks(&signed, "nir", &folds, &duplicate).is_err());
        let mut foreign = blocks[0].clone();
        foreign.fold_id = Some(FoldId::new("foreign").unwrap());
        assert!(validate_available_oof_blocks(&signed, "nir", &folds, &[&foreign]).is_err());
        let mut leak = blocks[0].clone();
        leak.partition = PredictionPartition::Train;
        assert!(validate_available_oof_blocks(&signed, "nir", &folds, &[&leak]).is_err());
        assert!(
            validate_available_oof_blocks(&signed, "nir", &folds, &refs[1..]).is_err(),
            "missing real validation rows refuse"
        );
    }

    #[test]
    fn native_nested_scopes_preflight_targets_and_classes_before_any_controller() {
        let base = base_plan();
        let nested = nested_stacking_campaign_plan(&base).unwrap().unwrap();
        let first_inner = &nested.outer_scopes[0].inner.inner_fold_set.folds[0];
        let mut masked = signed(false);
        for sample in &first_inner.train_sample_ids {
            let index = masked
                .sample_ids
                .iter()
                .position(|candidate| candidate == sample)
                .unwrap();
            masked.target_validity_masks[index][1] = false;
        }
        // The full Train and every outer scope still contain observations;
        // rejection is caused by an actual scheduler-owned inner train scope.
        let meta = NodeId::new("model:meta").unwrap();
        masked
            .validate_fit(&meta, None, &masked.sample_ids)
            .unwrap();
        for fold in &base.fold_set.as_ref().unwrap().folds {
            masked
                .validate_fit(&meta, None, &fold.train_sample_ids)
                .unwrap();
        }
        let error = build_signed(&base, &masked).unwrap_err().to_string();
        assert!(error.contains("empty native fit scope"), "{error}");
        struct CallbackSentinel {
            id: ControllerId,
            calls: Arc<AtomicUsize>,
        }
        impl RuntimeController for CallbackSentinel {
            fn controller_id(&self) -> &ControllerId {
                &self.id
            }
            fn invoke(&self, _task: &NodeTask) -> Result<NodeResult> {
                self.calls.fetch_add(1, Ordering::SeqCst);
                Err(DagMlError::RuntimeValidation(
                    "numerical callback reached unexpectedly".into(),
                ))
            }
        }
        let calls = Arc::new(AtomicUsize::new(0));
        let mut controllers = RuntimeControllerRegistry::new();
        controllers
            .register(Box::new(CallbackSentinel {
                id: ControllerId::new("controller:model").unwrap(),
                calls: calls.clone(),
            }))
            .unwrap();
        // A fully re-signed external plan must still be refused by the native
        // public scheduler before any controller; stale fingerprint refusal is
        // not the scientific admission proof.
        let mut inadmissible = base.clone();
        inadmissible.graph_plan.graph = graph_with_availability(&base, &masked);
        inadmissible.graph_fingerprint =
            stable_json_fingerprint(&inadmissible.graph_plan.graph).unwrap();
        let mut ctx = RunContext::new(RunId::new("run:availability.refused").unwrap(), Some(13));
        let error = SequentialScheduler
            .execute_campaign_phase(&inadmissible, &controllers, &mut ctx, Phase::FitCv)
            .unwrap_err()
            .to_string();
        assert!(error.contains("empty native fit scope"), "{error}");
        assert_eq!(calls.load(Ordering::SeqCst), 0);
        assert!(ctx.lineage.records().next().is_none());

        let valid_classification = signed(true);
        build_signed(&base, &valid_classification).unwrap();
        for refit_fold in &nested.refit_fold_set.unwrap().folds {
            let mut missing_class = valid_classification.clone();
            for sample in &refit_fold.train_sample_ids {
                let index = missing_class
                    .sample_ids
                    .iter()
                    .position(|candidate| candidate == sample)
                    .unwrap();
                if missing_class.sample_labels.as_ref().unwrap()[index] == Some(1.0) {
                    missing_class.source_presence.get_mut("nir").unwrap()[index] = false;
                }
            }
            assert!(
                missing_class
                    .validate_fit(
                        &NodeId::new("model:base.a").unwrap(),
                        Some("nir"),
                        &refit_fold.train_sample_ids
                    )
                    .is_err(),
                "native full-REFIT inner scopes require every class"
            );
            assert!(build_signed(&base, &missing_class).is_err());
        }
        let mut unknown_contract = serde_json::to_value(&valid_classification).unwrap();
        unknown_contract["unattested_policy"] = json!(true);
        assert!(serde_json::from_value::<PredictionAvailability>(unknown_contract).is_err());
    }
    #[test]
    fn off_fold_absence_uses_the_separately_attested_test_or_predict_cohort() {
        struct CohortProvider {
            cohort: PredictCohort,
        }
        impl RuntimeDataProvider for CohortProvider {
            fn materialize(&self, _request: &DataMaterializationRequest) -> Result<HandleRef> {
                Err(DagMlError::RuntimeValidation(
                    "unexpected data materialization".into(),
                ))
            }
            fn make_view(&self, _request: &DataViewRequest) -> Result<HandleRef> {
                Err(DagMlError::RuntimeValidation("unexpected data view".into()))
            }
            fn predict_cohort(
                &self,
                _binding: &crate::data::DataBinding,
                phase: Phase,
            ) -> Result<Option<PredictCohort>> {
                assert_eq!(phase, Phase::Predict);
                Ok(Some(self.cohort.clone()))
            }
            fn cv_test_cohort(
                &self,
                _binding: &crate::data::DataBinding,
            ) -> Result<Option<PredictCohort>> {
                Ok(Some(self.cohort.clone()))
            }
        }
        let signed = signed(false);
        let mut plan = build_signed(&base_plan(), &signed).unwrap();
        let source = plan.graph_plan.graph.edges[0].source.node_id.clone();
        plan.node_plans
            .get_mut(&source)
            .unwrap()
            .data_bindings
            .push(data_binding(&source));
        let edge = &plan.graph_plan.graph.edges[0];
        let ctx = RunContext::new(RunId::new("run:availability.cohort").unwrap(), Some(19));
        for phase in [Phase::FitCv, Phase::Refit, Phase::Predict] {
            let make_cohort = |present: bool, source_name: &str| {
                let relations = SampleRelationSet {
                    records: ["p2", "p1"]
                        .iter()
                        .map(|id| {
                            let mut relation = SampleRelation::new(
                                ObservationId::new(format!("obs:{id}")).unwrap(),
                                SampleId::new(*id).unwrap(),
                            );
                            relation.metadata.insert(
                                "prediction_source_presence".into(),
                                json!({(source_name):present,"image":true}),
                            );
                            relation
                        })
                        .collect(),
                };
                PredictCohort::from_relations(
                    if phase == Phase::Predict {
                        PredictCohortRole::Inference
                    } else {
                        PredictCohortRole::ExternalTest
                    },
                    relations,
                    signed.target_names.clone(),
                    "a".repeat(64),
                    (phase != Phase::Predict).then(|| "b".repeat(64)),
                )
                .unwrap()
            };
            let provider = CohortProvider {
                cohort: make_cohort(false, "nir"),
            };
            let scope = PhaseScope {
                phase,
                variant_id: None,
                variant: None,
                fold_id: (phase == Phase::FitCv)
                    .then(|| plan.fold_set.as_ref().unwrap().folds[0].fold_id.clone()),
                seed_root: Some(19),
            };
            let resources = PhaseScopeResources {
                data_provider: Some(&provider),
                ..Default::default()
            };
            let input =
                collect_available_off_fold_prediction_input(&plan, edge, &ctx, &scope, &resources)
                    .unwrap()
                    .unwrap()
                    .spec;
            assert_eq!(input.sample_ids, provider.cohort.physical_sample_ids);
            assert!(
                input
                    .sample_ids
                    .iter()
                    .all(|id| !signed.sample_ids.contains(id)),
                "Train metadata cannot choose Test/PREDICT IDs"
            );
            assert_eq!(
                input.partition,
                if phase == Phase::Predict {
                    PredictionPartition::Final
                } else {
                    PredictionPartition::Test
                }
            );
            assert_eq!(input.fold_id, scope.fold_id);
            assert_eq!(input.values, vec![vec![0.0, 0.0]; 2]);
            assert_eq!(input.source_presence, Some(vec![false, false]));
            assert!(
                ctx.prediction_store.blocks().is_empty(),
                "no padded PredictionBlock created"
            );
            let missing_real_predictions = CohortProvider {
                cohort: make_cohort(true, "nir"),
            };
            let resources = PhaseScopeResources {
                data_provider: Some(&missing_real_predictions),
                ..Default::default()
            };
            assert!(collect_available_off_fold_prediction_input(
                &plan, edge, &ctx, &scope, &resources
            )
            .is_err());
            let substituted_source = CohortProvider {
                cohort: make_cohort(false, "foreign"),
            };
            let resources = PhaseScopeResources {
                data_provider: Some(&substituted_source),
                ..Default::default()
            };
            assert!(
                collect_available_off_fold_prediction_input(&plan, edge, &ctx, &scope, &resources)
                    .is_err(),
                "even a re-signed cohort cannot substitute source identity"
            );
        }
    }
}

mod independent_unit_contract {
    use super::*;
    use crate::fold::KFoldSpec;
    use crate::policy::{AggregationGroupingKey, AggregationMethod};

    fn base() -> ExecutionPlan {
        let ids = (1..=12)
            .map(|index| SampleId::new(format!("s{index}")).unwrap())
            .collect::<Vec<_>>();
        let outer = KFoldSpec {
            n_splits: 3,
            shuffle: false,
            seed: Some(7),
        }
        .split("units.outer", &ids)
        .unwrap();
        let mut plan = nested_stacking_test_plan(outer, true);
        plan.campaign.inner_cv = Some(crate::fold::NestedCvSpec::KFold(KFoldSpec {
            n_splits: 3,
            shuffle: false,
            seed: Some(13),
        }));
        build_execution_plan(
            "plan:unit.base",
            plan.graph_plan.graph.clone(),
            plan.campaign.clone(),
            &manifests(),
        )
        .unwrap()
    }

    fn descriptor(plan: &ExecutionPlan) -> serde_json::Value {
        let samples = &plan.fold_set.as_ref().unwrap().sample_ids;
        json!({"schema_version":1,"sample_ids":samples,
            "independent_unit_ids":samples.iter().map(|id| format!("unit_{}",id.as_str())).collect::<Vec<_>>(),
            "fit_influence_policy":"equal_sample_influence","task_type":"regression",
            "target_names":["y","z"],"target_values":vec![vec![Some(0.0),Some(0.0)];samples.len()]})
    }

    fn signed(base: &ExecutionPlan, descriptor: serde_json::Value) -> ExecutionPlan {
        let mut graph = base.graph_plan.graph.clone();
        graph
            .metadata
            .insert("experimental_unit".into(), descriptor);
        let mut campaign = base.campaign.clone();
        campaign.aggregation_policy = AggregationPolicy {
            aggregation_level: PredictionLevel::Group,
            selection_metric_level: PredictionLevel::Group,
            grouping_key: Some(AggregationGroupingKey::RelationMetadata {
                key: "independent_unit_id".into(),
            }),
            method: AggregationMethod::Mean,
            ..Default::default()
        };
        let mut registry = ControllerRegistry::new();
        for mut manifest in manifests().manifests().cloned() {
            if manifest.operator_kind == NodeKind::Model {
                manifest
                    .capabilities
                    .insert(ControllerCapability::SupportsSampleWeights);
            }
            registry.register(manifest).unwrap();
        }
        build_execution_plan("plan:independent.units", graph, campaign, &registry).unwrap()
    }

    #[test]
    fn equal_unit_weights_follow_selected_scope_order_and_observed_target_counts() {
        let base = base();
        let mut desc = descriptor(&base);
        for index in 0..3 {
            desc["independent_unit_ids"][index] = json!("unit_a");
        }
        desc["target_values"][0] = json!([1.0, null]);
        desc["target_values"][1] = json!([1.0, 7.0]);
        desc["target_values"][2] = json!([1.0, 7.0]);
        desc["target_values"][3] = json!([2.0, 9.0]);
        // Use the real native task resolver; no Python recomputation or resampling.
        let mut plan = signed(&base, descriptor(&base));
        let mut presence = vec![true; 12];
        presence[1] = false;
        plan.graph_plan.graph.metadata.insert("prediction_availability".into(),json!({
            "schema_version":1,"sample_ids":desc["sample_ids"],"source_presence":{"nir":presence,"image":vec![true;12]},
            "target_names":["y","z"],"target_validity_masks":desc["target_values"].as_array().unwrap().iter()
                .map(|row|row.as_array().unwrap().iter().map(|value|!value.is_null()).collect::<Vec<_>>()).collect::<Vec<_>>() }));
        for node in &mut plan.graph_plan.graph.nodes {
            match node.id.as_str() {
                "model:base.a" => {
                    node.metadata
                        .insert("prediction_availability_source".into(), json!("nir"));
                }
                "model:base.b" => {
                    node.metadata
                        .insert("prediction_availability_source".into(), json!("image"));
                }
                "model:meta" => {
                    node.metadata
                        .insert("prediction_availability_meta".into(), json!(true));
                }
                _ => unreachable!(),
            }
        }
        plan.graph_plan
            .graph
            .metadata
            .insert("experimental_unit".into(), desc);
        let ids = &base.fold_set.as_ref().unwrap().sample_ids;
        let requested = vec![
            ids[3].clone(),
            ids[2].clone(),
            ids[1].clone(),
            ids[0].clone(),
        ];
        let view = DataProviderViewSpec {
            sample_ids: Some(requested.clone()),
            partition: DataRequestPartition::FoldTrain,
            fold_id: Some(FoldId::new("scope.actual").unwrap()),
            source_ids: None,
            columns: None,
            include_augmented: false,
            include_excluded: false,
            branch_view: None,
            extra: BTreeMap::new(),
        };
        let node = &plan.node_plans[&NodeId::new("model:base.a").unwrap()];
        let task = fit_influence_task_for_node(
            &plan,
            node,
            &BTreeMap::from([("data:x".into(), view)]),
            &BTreeMap::new(),
            Phase::FitCv,
        )
        .unwrap();
        assert_eq!(
            task.fit_sample_ids,
            vec![ids[3].clone(), ids[2].clone(), ids[0].clone()]
        );
        assert_eq!(task.row_weights, vec![1.0, 0.5, 0.5]);
        assert_eq!(
            task.target_row_weights,
            Some(vec![vec![1.0, 1.0], vec![0.5, 1.0], vec![0.5, 0.0]])
        );
        assert_eq!(
            task.independent_unit_ids,
            vec![
                format!("unit_{}", ids[3].as_str()),
                "unit_a".to_owned(),
                "unit_a".to_owned()
            ]
        );
        let mut tampered = task.clone();
        tampered.row_weights[1] = 1.0;
        assert!(tampered.validate().is_err());
        let mut tampered = task.clone();
        tampered.target_row_weights.as_mut().unwrap()[1][1] = 0.5;
        assert!(tampered.validate().is_err());
        assert_eq!(
            fit_influence_task_for_node(
                &plan,
                node,
                &BTreeMap::new(),
                &BTreeMap::new(),
                Phase::Predict
            )
            .unwrap(),
            FitInfluenceTask::default()
        );
    }

    #[test]
    fn fully_observed_regression_scopes_still_carry_native_target_weights() {
        let base = base();
        let ids = &base.fold_set.as_ref().unwrap().sample_ids;
        for partial_elsewhere in [false, true] {
            let mut plan = signed(&base, descriptor(&base));
            let mut desc = descriptor(&base);
            for index in 0..3 {
                desc["independent_unit_ids"][index] = json!("unit_a");
            }
            if partial_elsewhere {
                desc["target_values"][10] = json!([0.0, null]);
            }
            plan.graph_plan
                .graph
                .metadata
                .insert("experimental_unit".into(), desc);
            let requested = vec![
                ids[3].clone(),
                ids[2].clone(),
                ids[1].clone(),
                ids[0].clone(),
            ];
            for phase in [Phase::FitCv, Phase::Refit] {
                let view = DataProviderViewSpec {
                    sample_ids: Some(requested.clone()),
                    partition: if phase == Phase::FitCv {
                        DataRequestPartition::FoldTrain
                    } else {
                        DataRequestPartition::FullTrain
                    },
                    fold_id: (phase == Phase::FitCv).then(|| FoldId::new("scope.actual").unwrap()),
                    source_ids: None,
                    columns: None,
                    include_augmented: false,
                    include_excluded: false,
                    branch_view: None,
                    extra: BTreeMap::new(),
                };
                let node = &plan.node_plans[&NodeId::new("model:base.a").unwrap()];
                let task = fit_influence_task_for_node(
                    &plan,
                    node,
                    &BTreeMap::from([("data:x".into(), view)]),
                    &BTreeMap::new(),
                    phase,
                )
                .unwrap();
                assert_eq!(task.fit_sample_ids, requested);
                assert_eq!(task.row_weights, vec![1.0, 1.0 / 3.0, 1.0 / 3.0, 1.0 / 3.0]);
                assert_eq!(
                    task.target_row_weights,
                    Some(
                        task.row_weights
                            .iter()
                            .map(|weight| vec![*weight; 2])
                            .collect()
                    )
                );
                task.validate().unwrap();
            }
        }
    }

    #[test]
    fn meta_native_fit_excludes_all_masked_rows_without_shrinking_oof_inputs() {
        let base = base();
        let mut plan = signed(&base, descriptor(&base));
        let samples = base.fold_set.as_ref().unwrap().sample_ids.clone();
        let mut desc = descriptor(&base);
        desc["target_values"][0] = json!([null, null]);
        desc["target_values"][1] = json!([0.0, null]);
        plan.graph_plan
            .graph
            .metadata
            .insert("experimental_unit".into(), desc);
        let input = PredictionInputSpec {
            producer_node: NodeId::new("model:base.a").unwrap(),
            source_port: "oof".into(),
            target_port: "a".into(),
            partition: PredictionPartition::Validation,
            prediction_level: PredictionLevel::Sample,
            fold_id: None,
            fold_ids: Vec::new(),
            unit_ids: samples
                .iter()
                .cloned()
                .map(PredictionUnitId::Sample)
                .collect(),
            sample_ids: samples.clone(),
            values: vec![vec![1.0, 2.0]; samples.len()],
            feature_validity_masks: Some(vec![vec![true, true]; samples.len()]),
            source_presence: Some(vec![true; samples.len()]),
            prediction_width: 2,
            target_names: vec!["y".into(), "z".into()],
        };
        let inputs = BTreeMap::from([("model:base.a.oof".into(), input)]);
        let node = &plan.node_plans[&NodeId::new("model:meta").unwrap()];
        for phase in [Phase::FitCv, Phase::Refit] {
            let task =
                fit_influence_task_for_node(&plan, node, &BTreeMap::new(), &inputs, phase).unwrap();
            assert_eq!(task.fit_sample_ids, samples[1..]);
            let target_weights = task.target_row_weights.as_ref().unwrap();
            assert_eq!(target_weights.len(), samples.len() - 1);
            assert_eq!(target_weights[0], vec![1.0, 0.0]);
            assert!(target_weights[1..].iter().all(|row| row == &[1.0, 1.0]));
            assert_eq!(inputs["model:base.a.oof"].sample_ids, samples);
            assert_eq!(inputs["model:base.a.oof"].values.len(), samples.len());
            task.validate().unwrap();
        }
    }

    #[test]
    fn true_nested_inner_unit_leak_refuses_before_any_numerical_callback() {
        let base = base();
        let mut desc = descriptor(&base);
        let nested = nested_stacking_campaign_plan(&base).unwrap().unwrap();
        let outer = base.fold_set.as_ref().unwrap();
        let mut pair = None;
        for scope in &nested.outer_scopes {
            for fold in &scope.inner.inner_fold_set.folds {
                for train in &fold.train_sample_ids {
                    for validation in &fold.validation_sample_ids {
                        if outer.folds.iter().all(|outer| {
                            outer.validation_sample_ids.contains(train)
                                == outer.validation_sample_ids.contains(validation)
                        }) {
                            pair = Some((train.clone(), validation.clone()));
                            break;
                        }
                    }
                    if pair.is_some() {
                        break;
                    }
                }
                if pair.is_some() {
                    break;
                }
            }
            if pair.is_some() {
                break;
            }
        }
        let (train, validation) =
            pair.expect("fixture includes a real inner-only split of one outer unit");
        for id in [train, validation] {
            let position = outer
                .sample_ids
                .iter()
                .position(|sample| sample == &id)
                .unwrap();
            desc["independent_unit_ids"][position] = json!("unit_repeat");
        }
        let mut plan = signed(&base, descriptor(&base));
        plan.graph_plan
            .graph
            .metadata
            .insert("experimental_unit".into(), desc);
        plan.graph_fingerprint = stable_json_fingerprint(&plan.graph_plan.graph).unwrap();
        struct Sentinel(ControllerId, Arc<AtomicUsize>);
        impl RuntimeController for Sentinel {
            fn controller_id(&self) -> &ControllerId {
                &self.0
            }
            fn invoke(&self, _: &NodeTask) -> Result<NodeResult> {
                self.1.fetch_add(1, Ordering::SeqCst);
                Err(DagMlError::RuntimeValidation("callback reached".into()))
            }
        }
        let calls = Arc::new(AtomicUsize::new(0));
        let mut controllers = RuntimeControllerRegistry::new();
        controllers
            .register(Box::new(Sentinel(
                ControllerId::new("controller:model").unwrap(),
                calls.clone(),
            )))
            .unwrap();
        let mut context = RunContext::new(RunId::new("run:unit.leak").unwrap(), Some(7));
        let error = SequentialScheduler
            .execute_campaign_phase(&plan, &controllers, &mut context, Phase::FitCv)
            .unwrap_err()
            .to_string();
        assert!(error.contains("leaks an independent unit"), "{error}");
        assert_eq!(calls.load(Ordering::SeqCst), 0);
        assert!(context.lineage.records().next().is_none());
    }

    #[test]
    fn unit_truth_missing_class_and_weight_capability_are_preflight_contracts() {
        let base = base();
        let mut plan = signed(&base, descriptor(&base));
        let mut desc = descriptor(&base);
        desc["independent_unit_ids"][1] = desc["independent_unit_ids"][0].clone();
        desc["target_values"][1][0] = json!(2.0);
        plan.graph_plan
            .graph
            .metadata
            .insert("experimental_unit".into(), desc);
        assert!(plan
            .validate_experimental_units()
            .unwrap_err()
            .to_string()
            .contains("conflicting observed targets"));
        let mut desc = descriptor(&base);
        desc["independent_unit_ids"][0] = json!("unité avec espace");
        plan.graph_plan
            .graph
            .metadata
            .insert("experimental_unit".into(), desc);
        assert!(plan.validate_experimental_units().is_err());
        let mut desc = descriptor(&base);
        desc["task_type"] = json!("classification");
        desc["target_names"] = json!(["y"]);
        desc["target_values"] = json!(vec![vec![Some(0.0)]; 12]);
        desc["target_values"][0][0] = json!(1.0);
        plan.graph_plan
            .graph
            .metadata
            .insert("experimental_unit".into(), desc);
        plan.campaign.aggregation_policy.method = AggregationMethod::Vote;
        assert!(plan
            .validate_experimental_units()
            .unwrap_err()
            .to_string()
            .contains("missing a declared class"));
        plan = signed(&base, descriptor(&base));
        plan.node_plans
            .get_mut(&NodeId::new("model:base.a").unwrap())
            .unwrap()
            .controller_capabilities
            .remove(&ControllerCapability::SupportsSampleWeights);
        assert!(plan
            .validate_experimental_units()
            .unwrap_err()
            .to_string()
            .contains("cannot honor"));
    }

    #[test]
    fn independent_units_refuse_separate_fitting_owners_by_actual_fit_scope() {
        let base = base();
        for fit_scope in [
            crate::controller::ControllerFitScope::FoldTrain,
            crate::controller::ControllerFitScope::FullTrain,
        ] {
            let mut plan = signed(&base, descriptor(&base));
            let id = NodeId::new("model:base.a").unwrap();
            plan.graph_plan
                .graph
                .nodes
                .iter_mut()
                .find(|node| node.id == id)
                .unwrap()
                .kind = NodeKind::Transform;
            plan.node_plans.get_mut(&id).unwrap().fit_scope = fit_scope;
            assert!(plan
                .validate_experimental_units()
                .unwrap_err()
                .to_string()
                .contains("separate fitting nodes"));
        }
    }

    #[test]
    fn absent_statistical_contract_keeps_legacy_wire_and_oof_sample_grain() {
        let task = FitInfluenceTask::default();
        let wire = serde_json::to_value(task).unwrap();
        for field in [
            "fit_sample_ids",
            "independent_unit_ids",
            "target_names",
            "target_row_weights",
        ] {
            assert!(wire.get(field).is_none());
        }
        assert!(serde_json::to_value(AggregationPolicy::default())
            .unwrap()
            .get("grouping_key")
            .is_none());
        let plan = signed(&base(), descriptor(&base()));
        assert!(plan
            .node_plans
            .values()
            .all(|node| node
                .shape_plan
                .as_ref()
                .is_none_or(
                    |shape| shape.aggregation_policy.aggregation_level == PredictionLevel::Sample
                )));
    }

    #[test]
    fn actual_test_cohort_unit_identity_is_attested_and_excluded_rows_are_not_test() {
        use crate::data::{PredictCohort, PredictCohortRole};
        use crate::ids::ObservationId;
        use crate::relation::SampleRelation;
        let base = base();
        let plan = signed(&base, descriptor(&base));
        let units = experimental_units(&plan).unwrap().unwrap();
        let mut relations = SampleRelationSet {
            records: base
                .fold_set
                .as_ref()
                .unwrap()
                .sample_ids
                .iter()
                .map(|sample| {
                    let mut row = SampleRelation::new(
                        ObservationId::new(format!("obs_{}", sample.as_str())).unwrap(),
                        sample.clone(),
                    );
                    row.metadata.insert(
                        "independent_unit_id".into(),
                        json!(format!("unit_{}", sample.as_str())),
                    );
                    row
                })
                .collect(),
        };
        let mut excluded = SampleRelation::new(
            ObservationId::new("obs_excluded").unwrap(),
            SampleId::new("excluded").unwrap(),
        );
        excluded.excluded = true;
        excluded
            .metadata
            .insert("independent_unit_id".into(), json!("unit_s1"));
        relations.records.push(excluded);
        units.validate_relations(&relations).unwrap();
        let cohort = |unit: &str| {
            let mut row = SampleRelation::new(
                ObservationId::new("obs_test").unwrap(),
                SampleId::new("test_only").unwrap(),
            );
            row.metadata
                .insert("independent_unit_id".into(), json!(unit));
            PredictCohort::from_relations(
                PredictCohortRole::ExternalTest,
                SampleRelationSet { records: vec![row] },
                vec!["y".into(), "z".into()],
                "a".repeat(64),
                Some("b".repeat(64)),
            )
            .unwrap()
        };
        assert!(units
            .validate_test_cohort(&cohort("unit_s1"))
            .unwrap_err()
            .to_string()
            .contains("leaks between Train and external Test"));
        let valid = cohort("unit_external");
        units.validate_test_cohort(&valid).unwrap();
        let mut tampered = valid;
        tampered.relations.records[0]
            .metadata
            .insert("independent_unit_id".into(), json!("unit_other"));
        assert!(
            units.validate_test_cohort(&tampered).is_err(),
            "actual cohort fingerprint must reject metadata mutation"
        );
    }
}
