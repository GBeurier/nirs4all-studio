//! Source selection is an opaque host transform. These witnesses exercise
//! native recipe identity, pruning, parameter routing and resume safety only;
//! numerical source slicing is qualified by the real host integration tests.

use super::*;

fn source_branches() -> serde_json::Value {
    let declarations = [
        (json!([0]), json!(["source_0"]), json!([0, 1, 2, 3])),
        (json!([1]), json!(["source_1"]), json!([4, 5, 6])),
        (
            json!([1, 0]),
            json!(["source_1", "source_0"]),
            json!([4, 5, 6, 0, 1, 2, 3]),
        ),
    ];
    serde_json::Value::Array(
        declarations
            .into_iter()
            .enumerate()
            .map(|(index, (source_indices, source_ids, columns))| {
                json!({"id": format!("s0op{index}"), "steps": [{
                    "kind": "transform", "id": format!("t:s0op{index}"),
                    "operator": {"class": "sklearn.compose._column_transformer.ColumnTransformer"},
                    "params": {"transformers": [["selected", "passthrough", columns]], "remainder": "drop", "sparse_threshold": 0,
                        "n_jobs": null, "transformer_weights": null, "verbose": false, "verbose_feature_names_out": true},
                    "metadata": {
                        "nirs4all_structural_dense_concat": true,
                        "nirs4all_structural_source_selection": {
                            "schema": "nirs4all.structural-source-selection.v1",
                            "source_order": source_ids,
                            "source_indices": source_indices,
                            "source_ids": source_ids,
                            "input_source_widths": [4, 3],
                            "input_width": 7,
                            "selected_width": columns.as_array().unwrap().len(),
                            "columns": columns,
                            "input_source_layout": {
                                "kind": "by_source_concat",
                                "source_ids": ["source_0", "source_1"],
                                "source_order": ["source_0", "source_1"],
                                "blocks": [
                                    {"source_id": "source_0", "source_name": "source_0", "source_index": 0, "column_start": 0, "column_count": 4, "dtype": "float64"},
                                    {"source_id": "source_1", "source_name": "source_1", "source_index": 1, "column_start": 4, "column_count": 3, "dtype": "float64"}
                                ]
                            }
                        }
                    }
                }]})
            })
            .collect(),
    )
}

fn source_fixture(branches: serde_json::Value) -> (ExecutionPlan, HostHpoSearchRequest) {
    let (_, base) = structural_host_fixture();
    let mut dsl =
        serde_json::to_value(&base.structural_catalogue.as_ref().unwrap().source_dsl).unwrap();
    dsl["id"] = json!("dsl:structural.sources");
    let stages = dsl["steps"][0]["stages"].as_array_mut().unwrap();
    stages[0]["id"] = json!("stage1");
    stages[1]["id"] = json!("stage2");
    stages[0]["branches"][1] = json!({"id": "snv_savgol", "steps": [
        {"kind": "transform", "id": "snv", "operator": {"class": "nirs4all.operators.transforms.scalers.StandardNormalVariate"}, "params": {"copy": true}},
        {"kind": "transform", "id": "savgol", "operator": {"class": "nirs4all.operators.transforms.nirs.SavitzkyGolay"}, "params": {"window_length": 3, "polyorder": 1, "deriv": 0, "delta": 1.0, "copy": true}}
    ]});
    for stage in stages.iter_mut() {
        for branch in stage["branches"].as_array_mut().unwrap() {
            for step in branch["steps"].as_array_mut().unwrap() {
                step["metadata"]["nirs4all_structural_dense_concat"] = json!(true);
            }
        }
    }
    stages.insert(0, json!({"id": "stage0", "branches": branches}));
    let dsl: crate::PipelineDslSpec = serde_json::from_value(dsl).unwrap();
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
        "plan:dsl:structural.sources:host_hpo",
        compiled.graph,
        compiled.campaign_template,
        &registry,
    )
    .unwrap();
    let request = HostHpoSearchRequest {
        target_node: catalogue.entries[0].target_node.clone(),
        trial_budget: catalogue.entries.len().try_into().unwrap(),
        structural_catalogue: Some(catalogue),
        ..base
    };
    (plan, request)
}

fn operator_class(node: &NodeSpec) -> &str {
    node.operator
        .as_ref()
        .and_then(|operator| operator.get("class"))
        .and_then(serde_json::Value::as_str)
        .unwrap_or_default()
}

#[test]
fn source_catalogue_owns_three_stage_order_pruning_and_model_only_axes() {
    let branches = source_branches();
    let (plan, request) = source_fixture(branches.clone());
    let catalogue = request.structural_catalogue.as_ref().unwrap();
    catalogue.validate_for_plan(&plan).unwrap();
    let models = crate::compile_operator_variant_models(&catalogue.source_dsl).unwrap();
    assert_eq!(models.len(), 1);
    let variants = enumerate_operator_variants(&models, plan.campaign.root_seed).unwrap();
    assert_eq!(variants.len(), 12);
    assert_eq!(catalogue.entries.len(), variants.len());
    assert_eq!(
        catalogue
            .entries
            .iter()
            .map(|entry| &entry.variant_label)
            .collect::<BTreeSet<_>>()
            .len(),
        12
    );
    for (index, (entry, variant)) in catalogue.entries.iter().zip(variants).enumerate() {
        assert_eq!(entry.variant, variant);
        assert_eq!(entry.recipe_id, entry.variant.variant_id);
        let pruned = pruned_plan_for_operator_models(&plan, &models, &entry.variant).unwrap();
        assert_eq!(entry.graph, pruned.graph_plan.graph);
        assert_eq!(entry.graph_fingerprint, pruned.graph_fingerprint);
        assert_eq!(entry.controller_fingerprint, pruned.controller_fingerprint);
        let ordered = pruned
            .graph_plan
            .topological_order
            .iter()
            .filter_map(|id| entry.graph.nodes.iter().find(|node| &node.id == id))
            .filter(|node| matches!(node.kind, NodeKind::Transform | NodeKind::Model))
            .collect::<Vec<_>>();
        let with_chain = index % 4 >= 2;
        let model_class = if index % 2 == 0 {
            "sklearn.linear_model.Ridge"
        } else {
            "sklearn.cross_decomposition.PLSRegression"
        };
        let expected_classes = if with_chain {
            vec![
                "sklearn.compose._column_transformer.ColumnTransformer",
                "nirs4all.operators.transforms.scalers.StandardNormalVariate",
                "nirs4all.operators.transforms.nirs.SavitzkyGolay",
                model_class,
            ]
        } else {
            vec![
                "sklearn.compose._column_transformer.ColumnTransformer",
                model_class,
            ]
        };
        assert_eq!(
            ordered
                .iter()
                .map(|node| operator_class(node))
                .collect::<Vec<_>>(),
            expected_classes
        );
        assert_eq!(
            serde_json::to_value(&ordered[0].params).unwrap(),
            branches[index / 4]["steps"][0]["params"]
        );
        for node in &ordered {
            assert_eq!(
                node.metadata["nirs4all_structural_dense_concat"],
                json!(true)
            );
            assert_eq!(pruned.node_plans[&node.id].node_id, node.id);
            assert_eq!(pruned.node_plans[&node.id].params, node.params);
        }
        assert_eq!(
            ordered[0].metadata["nirs4all_structural_source_selection"],
            branches[index / 4]["steps"][0]["metadata"]["nirs4all_structural_source_selection"]
        );
        assert_eq!(ordered.last().unwrap().id, entry.target_node);
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
        assert_eq!(entry.parameter_bindings[key].node_id, entry.target_node);
        let selector_params = BTreeMap::from([
            (catalogue.selector_path.clone(), json!(entry.recipe_id)),
            (key.to_owned(), json!(2)),
        ]);
        let candidate = catalogue.candidate_plan(&plan, &selector_params).unwrap();
        assert_eq!(candidate.graph_plan.graph, entry.graph);
        for inactive in [
            "source.columns",
            if key == "model.alpha" {
                "model.n_components"
            } else {
                "model.alpha"
            },
        ] {
            let mut invalid = selector_params.clone();
            invalid.insert(inactive.into(), json!(1));
            assert!(catalogue
                .recipe(&invalid)
                .unwrap_err()
                .to_string()
                .contains("inactive"));
        }
    }
}

#[test]
fn source_subset_columns_and_layout_have_distinct_native_identity_contracts() {
    let (_, original) = source_fixture(source_branches());
    let before = original.structural_catalogue.unwrap();
    for mutation in 0..4 {
        let mut branches = source_branches();
        match mutation {
            0 => {
                branches[2]["steps"][0]["params"]["transformers"][0][2] =
                    json!([0, 1, 2, 3, 4, 5, 6])
            }
            1 => {
                branches[2]["steps"][0]["metadata"]["nirs4all_structural_source_selection"]
                    ["source_ids"][0] = json!("renamed_source_1")
            }
            2 => {
                branches[2]["steps"][0]["params"]["transformers"][0][2] =
                    json!([5, 6, 7, 0, 1, 2, 3])
            }
            _ => {
                branches[2]["steps"][0]["metadata"]["nirs4all_structural_source_selection"]
                    ["input_source_layout"]["blocks"][0]["dtype"] = json!("float32")
            }
        }
        let (plan, changed) = source_fixture(branches);
        let after = changed.structural_catalogue.unwrap();
        after.validate_for_plan(&plan).unwrap();
        assert_ne!(before.catalogue_fingerprint, after.catalogue_fingerprint);
        for (index, (original, current)) in before.entries.iter().zip(&after.entries).enumerate() {
            assert_eq!(
                original.recipe_id, current.recipe_id,
                "position identity stays native"
            );
            if index < 8 {
                assert_eq!(original.variant_label, current.variant_label);
                assert_eq!(original.graph_fingerprint, current.graph_fingerprint);
            } else {
                if mutation == 0 || mutation == 2 {
                    assert_ne!(original.variant_label, current.variant_label);
                } else {
                    // The established content label signs class/kind/params.
                    // Layout metadata is signed by graph/catalogue identity.
                    assert_eq!(original.variant_label, current.variant_label);
                }
                assert_ne!(original.graph_fingerprint, current.graph_fingerprint);
            }
        }
    }
}

#[test]
fn source_catalogue_checkpoint_refuses_reordered_or_rebound_columns_before_callbacks() {
    let (plan, request) = source_fixture(source_branches());
    let options = HostHpoResumeOptions {
        data_fingerprint: "data:source.blocks.4.3".into(),
        checkpoint: None,
    };
    let checkpoint = prepare_host_hpo_checkpoint(&plan, &request, &options).unwrap();
    let original_bytes = serde_json::to_vec(&checkpoint).unwrap();
    for mutation in 0..5 {
        let mut branches = source_branches();
        match mutation {
            0 => branches.as_array_mut().unwrap().swap(0, 1),
            1 => {
                branches[2]["steps"][0]["params"]["transformers"][0][2] =
                    json!([0, 1, 2, 3, 4, 5, 6])
            }
            2 => branches[1]["steps"][0]["params"]["transformers"][0][2] = json!([5, 6, 7]),
            3 => {
                branches[1]["steps"][0]["metadata"]["nirs4all_structural_dense_concat"] =
                    json!(false)
            }
            _ => {
                branches[1]["steps"][0]["metadata"]["nirs4all_structural_source_selection"]
                    ["input_source_layout"]["blocks"][0]["dtype"] = json!("float32")
            }
        }
        let (changed_plan, changed_request) = source_fixture(branches);
        let calls = Arc::new(Mutex::new(Vec::new()));
        let mut proposals = StructuralHostProposals::from_request(&changed_request);
        let mut progress = DurableHostProgress {
            stop_after: usize::MAX,
            checkpoints: Vec::new(),
        };
        let error = SequentialScheduler
            .execute_resumable_host_hpo_search(
                &changed_plan,
                &structural_score_controllers(calls.clone()),
                &InMemoryDataProvider::new(ControllerId::new("controller:data").unwrap()),
                &changed_request,
                &mut proposals,
                &HostHpoResumeOptions {
                    checkpoint: Some(checkpoint.clone()),
                    data_fingerprint: options.data_fingerprint.clone(),
                },
                &mut progress,
            )
            .unwrap_err();
        assert!(error.to_string().contains("binding mismatch"));
        assert!(proposals.asked.is_empty());
        assert!(proposals.told.is_empty());
        assert!(calls.lock().unwrap().is_empty());
        assert!(progress.checkpoints.is_empty());
        assert_eq!(serde_json::to_vec(&checkpoint).unwrap(), original_bytes);
    }
}

#[test]
fn source_worker_window_retains_each_selected_target_and_fixed_selector_params() {
    let (plan, request) = source_fixture(source_branches());
    let options = HostHpoResumeOptions {
        data_fingerprint: "data:source.worker.blocks.4.3".into(),
        checkpoint: None,
    };
    let mut proposals = StructuralHostProposals::from_request(&request);
    let window =
        prepare_host_hpo_worker_window(&plan, &request, &options, &mut proposals, 12).unwrap();
    assert_eq!(window.tasks.len(), 12);
    let catalogue = request.structural_catalogue.as_ref().unwrap();
    for (task, recipe) in window.tasks.iter().zip(&catalogue.entries) {
        assert_eq!(task.candidate_plan.variants.len(), 1);
        let model_nodes = task
            .candidate_plan
            .node_plans
            .values()
            .filter(|node| node.kind == NodeKind::Model)
            .collect::<Vec<_>>();
        assert_eq!(model_nodes.len(), 1);
        assert_eq!(model_nodes[0].node_id, recipe.target_node);
        assert_eq!(
            request.target_for_plan(&task.candidate_plan).unwrap(),
            &recipe.target_node
        );
        let source = task
            .candidate_plan
            .graph_plan
            .graph
            .nodes
            .iter()
            .find(|node| {
                operator_class(node) == "sklearn.compose._column_transformer.ColumnTransformer"
            })
            .unwrap();
        let declared = recipe
            .graph
            .nodes
            .iter()
            .find(|node| node.id == source.id)
            .unwrap();
        assert_eq!(source.params, declared.params);
        assert_eq!(
            task.params.len(),
            2,
            "only the selector and active model axis cross the tuner boundary"
        );
    }
    assert_eq!(proposals.asked, (0..12).collect::<Vec<_>>());
    assert!(proposals.told.is_empty());
}

type SourceTransformCalls = Arc<Mutex<Vec<(NodeId, VariantId, FoldId)>>>;

struct SourceTransformProbe {
    inner: MockController,
    calls: SourceTransformCalls,
}

impl RuntimeController for SourceTransformProbe {
    fn controller_id(&self) -> &ControllerId {
        self.inner.controller_id()
    }

    fn invoke(&self, task: &NodeTask) -> Result<NodeResult> {
        assert_eq!(task.phase, Phase::FitCv);
        self.calls.lock().unwrap().push((
            task.node_plan.node_id.clone(),
            task.variant_id.clone().unwrap(),
            task.fold_id.clone().unwrap(),
        ));
        self.inner.invoke(task)
    }
}

#[test]
fn source_search_dispatches_only_selected_source_chain_and_model_once_per_fold() {
    let (plan, request) = source_fixture(source_branches());
    let transform_calls: SourceTransformCalls = Arc::new(Mutex::new(Vec::new()));
    let model_calls = Arc::new(Mutex::new(Vec::new()));
    let mut controllers = RuntimeControllerRegistry::new();
    controllers
        .register(Box::new(SourceTransformProbe {
            inner: MockController {
                id: ControllerId::new("controller:transform").unwrap(),
                handle: 1,
                emit_prediction: false,
            },
            calls: transform_calls.clone(),
        }))
        .unwrap();
    controllers
        .register(Box::new(StructuralScoreController {
            inner: VariantScoringController {
                id: ControllerId::new("controller:model").unwrap(),
                handle: 2,
                emit_targets: true,
            },
            calls: model_calls.clone(),
        }))
        .unwrap();
    let mut proposals = StructuralHostProposals::from_request(&request);
    let result = SequentialScheduler
        .execute_host_hpo_search(
            &plan,
            &controllers,
            &InMemoryDataProvider::new(ControllerId::new("controller:data").unwrap()),
            &request,
            &mut proposals,
        )
        .unwrap();
    assert_eq!(result.trials.len(), 12);
    assert_eq!(proposals.told.len(), 12);
    let observed_transforms = transform_calls.lock().unwrap();
    let observed_models = model_calls.lock().unwrap();
    assert_eq!(observed_models.len(), 24);
    assert_eq!(observed_transforms.len(), 48);
    let catalogue = request.structural_catalogue.as_ref().unwrap();
    let folds = &plan.fold_set.as_ref().unwrap().folds;
    for (recipe, trial) in catalogue.entries.iter().zip(&result.trials) {
        let transforms = recipe
            .graph
            .topological_order()
            .unwrap()
            .into_iter()
            .filter(|id| {
                recipe
                    .graph
                    .nodes
                    .iter()
                    .any(|node| &node.id == id && node.kind == NodeKind::Transform)
            })
            .collect::<Vec<_>>();
        for fold in folds {
            let actual = observed_transforms
                .iter()
                .filter(|(_, variant, fold_id)| {
                    variant == &trial.variant_id && fold_id == &fold.fold_id
                })
                .map(|(node, _, _)| node.clone())
                .collect::<Vec<_>>();
            assert_eq!(actual, transforms);
        }
        assert_eq!(
            observed_models
                .iter()
                .filter(|(_, variant)| variant == &trial.variant_id)
                .map(|(node, _)| node.clone())
                .collect::<Vec<_>>(),
            [recipe.target_node.clone(), recipe.target_node.clone()]
        );
        assert!(trial
            .scores
            .reports
            .iter()
            .all(|report| report.producer_node == recipe.target_node));
    }
}
