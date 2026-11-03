use super::*;
use crate::controller_adapter::HostControllerSpec;
use serde_json::json;

fn class_names(classes: usize) -> Value {
    if classes == 2 {
        json!([-19, 43])
    } else {
        json!((0..classes).collect::<Vec<_>>())
    }
}

fn raw_operator(selected: &[&str], classes: usize) -> Value {
    let mut encoders = serde_json::Map::new();
    for name in selected {
        encoders.insert((*name).into(), match *name {
            "nir" => json!({"kind":"standard_scaler","with_mean":true,"with_std":true}),
            "metadata" => json!({"kind":"column_transformer","numeric_columns":[0],"categorical_columns":[1],"with_mean":true,"with_std":true,"handle_unknown":"ignore","sparse_output":false,"drop":null}),
            _ => json!({"kind":"tensor_pca","n_components":1,"whiten":false,"random_state":17}),
        });
    }
    let schemas = ["nir","image","series","metadata"].into_iter().zip(["signal_1d","rgb_image","series_mv","tabular_mixed"]).map(|(name, representation)| (name, json!({"representation_id":representation,"input_shape":[2],"dtype":"float64","identity":format!("{{\"source\":\"{name}\"}}") }))).collect::<BTreeMap<_, _>>();
    json!({"type":METHODS_RAW_CLASSIFIER,"classification":{"schema_version":1,"class_labels":(0..classes).collect::<Vec<_>>(),"label_names":class_names(classes)},"source_schemas":schemas,
        "recipe":{"schema_version":1,"fusion":"early","source_order":selected,"encoders":encoders,"source_weights":selected.iter().map(|source| (*source,1.0)).collect::<BTreeMap<_,_>>(),"model":{"method_id":METHODS_CLASSIFIER_METHOD,"params":{"n_components":1,"max_iter":30}}}})
}

fn fixed_plan(branches: usize) -> ExecutionPlan {
    fixed_plan_with_classes(branches, 2)
}

fn fixed_plan_with_classes(branches: usize, classes: usize) -> ExecutionPlan {
    let names = ["nir", "image", "series", "metadata"];
    let samples = (0..classes * 6)
        .map(|n| format!("s{n}"))
        .collect::<Vec<_>>();
    let sample_labels = samples
        .iter()
        .enumerate()
        .map(|(n, sample)| (sample.clone(), n % classes))
        .collect::<BTreeMap<_, _>>();
    let sample_groups = samples
        .iter()
        .enumerate()
        .map(|(n, sample)| (sample.clone(), format!("g{}", n / classes)))
        .collect::<BTreeMap<_, _>>();
    let folds = (0..3).map(|fold| json!({"fold_id":format!("outer{fold}"),"train_sample_ids":samples.iter().enumerate().filter(|(n,_)| n / (classes * 2) != fold).map(|(_,s)|s).collect::<Vec<_>>(),"validation_sample_ids":samples.iter().enumerate().filter(|(n,_)| n / (classes * 2) == fold).map(|(_,s)|s).collect::<Vec<_>>() })).collect::<Vec<_>>();
    let steps = if branches == 0 {
        vec![
            json!({"kind":"model","prediction_output_ports":["y_hat","probabilities"],"id":"early","operator":raw_operator(&names, classes),"metadata":{"controller_id":"controller:methods.python.multimodal.classification"}}),
        ]
    } else {
        let ids = names[..branches]
            .iter()
            .map(|name| format!("raw:{name}"))
            .collect::<Vec<_>>();
        vec![
            json!({"kind":"branch","branches":names[..branches].iter().zip(&ids).map(|(name,id)|json!({"id":format!("branch:{name}"),"steps":[{"kind":"model","prediction_output_ports":["y_hat","probabilities"],"id":id,"operator":raw_operator(&[*name], classes),"metadata":{"controller_id":"controller:methods.python.multimodal.classification"}}]})).collect::<Vec<_>>() }),
            json!({"kind":"merge_model","prediction_output_ports":["y_hat","probabilities"],"id":"meta","sources":ids,"source_ports":ids.iter().map(|id|(id,"probabilities")).collect::<BTreeMap<_,_>>(),"include_original_data":false,
                "operator":{"type":METHODS_META_CLASSIFIER,"source_order":&names[..branches],"classification":{"schema_version":1,"class_labels":(0..classes).collect::<Vec<_>>(),"label_names":class_names(classes)},"steps":[{"methodId":METHODS_CLASSIFIER_METHOD,"params":{"n_components":1,"max_iter":30}}]},
                "metadata":{"controller_id":"controller:methods.python.classification","stacking_oof_execution":"nested_oof_v1","stacking_refit_oof":"partitioned_inner_v1"},"inner_cv":{"kind":"group_kfold","n_splits":2}}),
        ]
    };
    let dsl: crate::dsl::PipelineDslSpec = serde_json::from_value(json!({"id":"dsl:classification","root_seed":17,"metadata":{"classification_targets":{"schema_version":1,"class_labels":(0..classes).collect::<Vec<_>>(),"label_names":class_names(classes),"sample_labels":sample_labels}},"split_invocation":{"id":"split:class","fold_set":{"id":"folds:class","sample_ids":samples,"sample_groups":sample_groups,"folds":folds}},"steps":steps})).unwrap();
    let outputs = serde_json::from_value(json!([{"name":"y_hat","kind":"prediction","representation":null,"cardinality":"one","description":""},{"name":"probabilities","kind":"prediction","representation":null,"cardinality":"one","description":""},{"name":"model","kind":"artifact","representation":null,"cardinality":"one","description":""}])).unwrap();
    let mut raw = HostControllerSpec::new(
        "controller:methods.python.multimodal.classification",
        "1.0.0",
        crate::NodeKind::Model,
    );
    raw.output_ports = Some(outputs);
    raw.input_ports = Some(serde_json::from_value(json!([{"name":"x","kind":"data","representation":"feature_block_set","cardinality":"one","description":""}])).unwrap());
    raw.data_requirements = Some(
        json!({"schema_version":1,"default_fusion":{"mode":"dict_by_source","alignment":"sample_id","adapter_id":null,"params":{}},"metadata":{},"ports":[{"name":"x","accepted_representations":["feature_block_set"],"accepted_types":["multi_block"],"rank":null,"multi_source":true,"optional":false,"metadata":{}}]}),
    );
    let mut meta = HostControllerSpec::new(
        "controller:methods.python.classification",
        "1.0.0",
        crate::NodeKind::Model,
    );
    meta.output_ports = raw.output_ports.clone();
    meta.added_capabilities
        .insert(crate::ControllerCapability::ConsumesOofPredictions);
    let mut registry = crate::ControllerRegistry::new();
    registry.register(raw.derive().unwrap()).unwrap();
    registry.register(meta.derive().unwrap()).unwrap();
    let mut compiled =
        crate::dsl::compile_pipeline_dsl_with_generation_and_controller_registry(&dsl, &registry)
            .unwrap();
    for node in compiled.graph.nodes.iter().filter(|node| {
        node.operator
            .as_ref()
            .is_some_and(|op| op["type"] == METHODS_RAW_CLASSIFIER)
    }) {
        compiled.campaign_template.data_bindings.insert(node.id.clone(), vec![serde_json::from_value(json!({"node_id":node.id,"input_name":"x","request_id":"request:raw","schema_fingerprint":"a".repeat(64),"plan_fingerprint":"b".repeat(64),"output_representation":"feature_block_set","source_ids":names})).unwrap()]);
    }
    crate::build_execution_plan(
        "plan:classifier",
        compiled.graph,
        compiled.campaign_template,
        &registry,
    )
    .unwrap()
}

fn reseal_graph(plan: &mut ExecutionPlan) {
    plan.graph_fingerprint =
        crate::campaign::stable_json_fingerprint(&plan.graph_plan.graph).unwrap();
}

#[test]
fn fixed_classifier_plans_validate_exact_native_grouped_scopes_and_order() {
    for branches in [0, 2, 3, 4] {
        let plan = fixed_plan(branches);
        plan.validate().unwrap();
        if branches != 0 {
            let meta = NodeId::new("meta").unwrap();
            assert_eq!(
                classifier_input_nodes(&plan, &meta).unwrap().len(),
                branches
            );
            let nested = crate::runtime::nested_stacking_campaign_plans(&plan).unwrap();
            assert_eq!(nested.len(), 1);
            assert!(nested[0].refit_fold_set.is_some());
        }
    }
}

#[test]
fn classifier_dsl_declares_both_real_outputs_and_reserved_oof_is_not_a_label_alias() {
    for branches in [0, 2, 3, 4] {
        let plan = fixed_plan(branches);
        for node in plan.graph_plan.graph.nodes.iter().filter(|node| {
            node.operator.as_ref().is_some_and(|operator| {
                methods_operator_classification(operator).unwrap().is_some()
            })
        }) {
            let mut ports = node
                .ports
                .outputs
                .iter()
                .filter(|port| port.kind == crate::PortKind::Prediction)
                .map(|port| port.name.clone())
                .collect::<Vec<_>>();
            ports.sort();
            assert_eq!(ports, ["oof", "probabilities", "y_hat"]);
            assert_eq!(
                crate::runtime::classifier_auxiliary_prediction_ports(&ports).unwrap(),
                BTreeSet::from(["probabilities".to_string()]),
            );
            let label = crate::PredictionBlock {
                prediction_id: None,
                producer_node: node.id.clone(),
                producer_port: Some("y_hat".into()),
                partition: crate::PredictionPartition::Final,
                fold_id: None,
                sample_ids: vec![crate::SampleId::new("s0").unwrap()],
                values: vec![vec![0.0]],
                target_names: vec!["y".into()],
            };
            validate_methods_classification_block(&plan, &label).unwrap();
            let mut legacy_alias = label;
            legacy_alias.producer_port = Some("oof".into());
            assert!(validate_methods_classification_block(&plan, &legacy_alias).is_err());
        }
    }
    let direct_ports = vec!["probabilities".to_string(), "y_hat".to_string()];
    assert_eq!(
        crate::runtime::classifier_auxiliary_prediction_ports(&direct_ports).unwrap(),
        BTreeSet::from(["probabilities".to_string()]),
    );
    for malformed in [
        vec!["oof", "probabilities"],
        vec!["oof", "y_hat"],
        vec!["other", "probabilities", "y_hat"],
        vec!["oof", "other", "probabilities", "y_hat"],
    ] {
        let ports = malformed
            .into_iter()
            .map(str::to_string)
            .collect::<Vec<_>>();
        assert!(crate::runtime::classifier_auxiliary_prediction_ports(&ports).is_err());
    }
}

#[test]
fn signed_targets_cannot_hide_missing_inner_classes_or_test_vocabulary() {
    let plan = fixed_plan(2);
    let nested = crate::runtime::nested_stacking_campaign_plans(&plan).unwrap();
    let scope = &nested[0].refit_fold_set.as_ref().unwrap().folds[0].train_sample_ids;
    let mut deficient = plan.clone();
    for sample in scope {
        deficient
            .graph_plan
            .graph
            .metadata
            .get_mut("classification_targets")
            .unwrap()["sample_labels"][sample.as_str()] = json!(0);
    }
    reseal_graph(&mut deficient);
    assert!(deficient.validate().is_err());
    for mutation in ["foreign", "permuted", "mixed", "unsupported"] {
        let mut changed = plan.clone();
        let evidence = changed
            .graph_plan
            .graph
            .metadata
            .get_mut("classification_targets")
            .unwrap();
        match mutation {
            "foreign" => evidence["sample_labels"]["heldout:foreign"] = json!(1),
            "permuted" => evidence["class_labels"] = json!([1, 0]),
            "mixed" => evidence["label_names"] = json!([-19, "43"]),
            _ => evidence["schema_version"] = json!(2),
        }
        reseal_graph(&mut changed);
        assert!(changed.validate().is_err(), "{mutation}");
    }
}

#[test]
fn classifier_oof_join_rejects_permuted_columns_and_foreign_recipe() {
    let plan = fixed_plan(2);
    let producer = NodeId::new("raw:nir").unwrap();
    let block = crate::PredictionBlock {
        prediction_id: None,
        producer_node: producer.clone(),
        producer_port: Some("probabilities".into()),
        partition: crate::PredictionPartition::Validation,
        fold_id: Some(crate::FoldId::new("outer0").unwrap()),
        sample_ids: vec![crate::SampleId::new("s0").unwrap()],
        values: vec![vec![0.8, 0.2]],
        target_names: vec!["class:0".into(), "class:1".into()],
    };
    validate_methods_classification_block(&plan, &block).unwrap();
    let mut permutation = block.clone();
    permutation.target_names.reverse();
    assert!(validate_methods_classification_block(&plan, &permutation).is_err());
    let mut invalid = block;
    invalid.values[0] = vec![0.8, 0.3];
    assert!(validate_methods_classification_block(&plan, &invalid).is_err());
    let mut port = plan.clone();
    port.graph_plan
        .graph
        .edges
        .iter_mut()
        .find(|edge| edge.source.node_id == producer && edge.contract.requires_oof)
        .unwrap()
        .source
        .port_name = "y_hat".into();
    reseal_graph(&mut port);
    assert!(port.validate().is_err());
}

#[test]
fn classifier_components_and_typed_labels_refuse_before_execution() {
    let mut plan = fixed_plan(0);
    let node = plan
        .graph_plan
        .graph
        .nodes
        .iter_mut()
        .find(|node| node.operator.is_some())
        .unwrap();
    node.operator.as_mut().unwrap()["recipe"]["model"]["params"]["n_components"] = json!(9);
    reseal_graph(&mut plan);
    assert!(plan.validate().is_err());
    let valid = MethodsClassVocabulary {
        schema_version: 1,
        class_labels: vec![0, 1],
        label_names: vec![json!(""), json!("named")],
    };
    valid.validate().unwrap();
    let mut malformed = valid;
    malformed.label_names[1] = json!(true);
    assert!(malformed.validate().is_err());
}

#[test]
fn classifier_matrix_bounds_cover_raw_and_ordered_meta_before_allocation() {
    let classes = 65_536_u64;
    validate_classifier_buffer(256, classes).unwrap();
    assert!(validate_classifier_buffer(257, classes).is_err());
    validate_classifier_buffer(64, classes * 4).unwrap();
    assert!(validate_classifier_buffer(65, classes * 4).is_err());
    assert!(validate_classifier_buffer(u64::MAX, 2).is_err());
}

#[test]
fn classifier_hessian_and_design_bounds_are_exact_and_overflow_safe() {
    validate_classifier_working_set(1, 2, 4095).unwrap();
    assert!(validate_classifier_working_set(1, 2, 4096).is_err());
    assert!(validate_classifier_working_set(3072, 512, 128).is_err());
    validate_classifier_working_set(16_777_216 / 9, 2, 8).unwrap();
    assert!(validate_classifier_working_set(16_777_216 / 9 + 1, 2, 8).is_err());
    assert!(validate_classifier_working_set(1, 2, u64::MAX).is_err());
    assert!(validate_classifier_working_set(1, u64::MAX, 1).is_err());
}

#[test]
fn ordinary_raw_and_meta_plans_refuse_the_actual_logistic_hessian() {
    for branches in [0, 2] {
        let mut plan = fixed_plan_with_classes(branches, 512);
        let target = if branches == 0 { "early" } else { "meta" };
        let operator = plan
            .graph_plan
            .graph
            .nodes
            .iter_mut()
            .find(|node| node.id.as_str() == target)
            .unwrap()
            .operator
            .as_mut()
            .unwrap();
        if branches == 0 {
            operator["source_schemas"]["nir"]["input_shape"] = json!([128]);
            operator["recipe"]["model"]["params"]["n_components"] = json!(128);
        } else {
            operator["steps"][0]["params"]["n_components"] = json!(128);
        }
        reseal_graph(&mut plan);
        assert!(plan
            .validate()
            .unwrap_err()
            .to_string()
            .contains("PLS-logistic working set"));
    }
}

struct NoClassifierCallbacks;
impl crate::HostHpoCandidateControllerFactory for NoClassifierCallbacks {
    fn create(&self, _: u32) -> Result<crate::RuntimeControllerRegistry> {
        panic!("classifier refusal must precede controller factories")
    }
}
impl crate::HostHpoCandidateProviderFactory for NoClassifierCallbacks {
    fn create(&self, _: u32) -> Result<Box<dyn crate::RuntimeDataProvider + Send>> {
        panic!("classifier refusal must precede provider factories")
    }
}
impl crate::HostHpoProposalSource for NoClassifierCallbacks {
    fn ask(&mut self, _: u32) -> Result<Option<BTreeMap<String, Value>>> {
        panic!("classifier refusal must precede optimizer ask")
    }
    fn tell(&mut self, _: u32, _: f64) -> Result<()> {
        panic!("classifier refusal must precede optimizer tell")
    }
}
impl crate::HostHpoProgress for NoClassifierCallbacks {
    fn checkpoint(
        &mut self,
        _: &crate::HostHpoCheckpoint,
        _: crate::HostHpoSearchStatus,
    ) -> Result<bool> {
        panic!("classifier refusal must precede progress callbacks")
    }
}

#[test]
fn unsafe_classifier_axes_and_forced_counts_refuse_before_optimizer_callbacks() {
    let plan = fixed_plan(0);
    let provider =
        crate::InMemoryDataProvider::new(crate::ControllerId::new("controller:data").unwrap());
    for domain in [
        json!([1, 4096]),
        json!(["int", 1, 4096]),
        json!({"type":"int_log","low":1,"high":4096}),
        json!({"type":"categorical","choices":[1,4096]}),
        json!([]),
    ] {
        assert!(
            classifier_component_bound(&domain).is_err()
                || validate_classifier_working_set(
                    12,
                    2,
                    classifier_component_bound(&domain).unwrap()
                )
                .is_err()
        );
    }
    for forced in [false, true] {
        let domain = if forced {
            json!([1])
        } else {
            json!({"type":"int","low":1,"high":4096})
        };
        let force_params = if forced {
            json!({"model__n_components":4096})
        } else {
            Value::Null
        };
        let request: crate::HostHpoSearchRequest = serde_json::from_value(json!({"target_node":"early","trial_budget":2,"metric":"accuracy","direction":"maximize","optimizer_descriptor":{"sampler":"random","space":{"model__n_components":domain},"force_params":force_params}})).unwrap();
        let error = crate::SequentialScheduler
            .execute_resumable_host_hpo_search_with_candidate_factories(
                &plan,
                &crate::RuntimeControllerRegistry::new(),
                &provider,
                &NoClassifierCallbacks,
                &NoClassifierCallbacks,
                &request,
                &mut NoClassifierCallbacks,
                &crate::HostHpoResumeOptions {
                    data_fingerprint: "class:bounded".into(),
                    checkpoint: None,
                },
                &mut NoClassifierCallbacks,
            )
            .unwrap_err();
        assert!(error.to_string().contains("PLS-logistic working set"));
    }
}

#[test]
fn effective_only_classifier_parallelism_refuses_rmse_before_all_callbacks() {
    for branches in [0, 2] {
        let plan = fixed_plan(branches);
        let request: crate::HostHpoSearchRequest = serde_json::from_value(json!({"target_node":if branches == 0 {"early"} else {"meta"},"trial_budget":2,"metric":"rmse","direction":"minimize","optimizer_descriptor":{"sampler":"random","n_jobs":2,"pruner":null,"parallel_execution":{"schema_version":1,"profile":"methods_sequential_cpu_v1","workers":2,"cpu_threads":1,"gpu_devices":[],"methods_build":{"schema_version":1,"blas":false,"openmp":false,"cuda":false}}}})).unwrap();
        // The descriptor alone is admitted: the effective graph is essential.
        assert!(request.validate_parallel_execution(2).is_ok());
        let error = crate::SequentialScheduler
            .execute_resumable_parallel_host_hpo_search_with_candidate_factories(
                &plan,
                &NoClassifierCallbacks,
                &NoClassifierCallbacks,
                &request,
                &mut NoClassifierCallbacks,
                2,
                &crate::HostHpoResumeOptions {
                    data_fingerprint: "class:serial".into(),
                    checkpoint: None,
                },
                &mut NoClassifierCallbacks,
            )
            .unwrap_err();
        assert!(error.to_string().contains("classification requires serial"));
    }
}
