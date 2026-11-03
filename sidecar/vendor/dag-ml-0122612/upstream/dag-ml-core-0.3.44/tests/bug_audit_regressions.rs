//! Reproductions for the 2026-10-05 audit and guards against its false positives.
use std::collections::BTreeSet;

use dag_ml_core::*;
use serde_json::{json, Value};

fn plan() -> ExecutionPlan {
    let graph = serde_json::from_str(include_str!("fixtures/package/minimal_graph.json")).unwrap();
    let campaign = serde_json::from_str(include_str!(
        "fixtures/package/campaign_oof_generation.json"
    ))
    .unwrap();
    let manifests: Vec<ControllerManifest> =
        serde_json::from_str(include_str!("fixtures/package/controller_manifests.json")).unwrap();
    let mut registry = ControllerRegistry::new();
    for manifest in manifests {
        registry.register(manifest).unwrap();
    }
    build_execution_plan("plan:audit", graph, campaign, &registry).unwrap()
}

fn folds(grouped: bool) -> FoldSet {
    let mut value = json!({"id":"folds:audit", "sample_ids":["a","b","c","d","e","f","g","h"],
        "folds":[{"fold_id":"outer:0","train_sample_ids":["a","b","c","d"],"validation_sample_ids":["e","f","g","h"]},
        {"fold_id":"outer:1","train_sample_ids":["e","f","g","h"],"validation_sample_ids":["a","b","c","d"]}]});
    if grouped {
        value["sample_groups"] =
            json!({"a":"g0","b":"g0","c":"g1","d":"g1","e":"g2","f":"g2","g":"g3","h":"g3"});
    }
    serde_json::from_value(value).unwrap()
}

#[test]
fn nested_cv_refuses_group_erasure_and_retains_group_boundaries() {
    let outer = folds(true);
    outer.validate().unwrap();
    for kind in ["kfold", "stratified_kfold"] {
        let spec: NestedCvSpec =
            serde_json::from_value(json!({"kind":kind,"n_splits":2,"strata":{}})).unwrap();
        assert!(outer.nested_fold_set(&spec, &outer.folds[0]).is_err());
    }
    let spec: NestedCvSpec =
        serde_json::from_value(json!({"kind":"group_kfold","n_splits":2})).unwrap();
    let inner = outer.nested_fold_set(&spec, &outer.folds[0]).unwrap();
    assert_eq!(inner.inner_fold_set.sample_groups.len(), 4);
    inner.inner_fold_set.validate().unwrap();
}

#[test]
fn augmented_rows_need_origins_but_self_origin_observations_remain_valid() {
    let mut row = SampleRelation::new(
        ObservationId::new("obs:a").unwrap(),
        SampleId::new("a").unwrap(),
    );
    row.is_augmented = true;
    let mut relations = SampleRelationSet { records: vec![row] };
    assert!(relations
        .validate_against_fold_set(&folds(false), &LeakageUnitPolicy::default())
        .is_err());
    relations.records[0].origin_sample_id = Some(SampleId::new("a").unwrap());
    relations
        .validate_against_fold_set(&folds(false), &LeakageUnitPolicy::default())
        .unwrap();
}

#[test]
fn resampling_can_omit_an_origin_pair_from_an_individual_fold() {
    let mut set = folds(false);
    set.partition_mode = FoldPartitionMode::Resampled;
    set.folds.truncate(1);
    set.folds[0]
        .train_sample_ids
        .retain(|id| id.as_str() != "a" && id.as_str() != "b");
    let mut row = SampleRelation::new(
        ObservationId::new("obs:b").unwrap(),
        SampleId::new("b").unwrap(),
    );
    row.is_augmented = true;
    row.origin_sample_id = Some(SampleId::new("a").unwrap());
    SampleRelationSet { records: vec![row] }
        .validate_against_fold_set(&set, &LeakageUnitPolicy::default())
        .unwrap();
}

#[test]
fn deserialized_plans_refuse_swapped_folds_variants_seeds_and_bindings() {
    let original = plan();
    let mut forged = original.clone();
    forged.fold_set = Some(folds(false));
    assert!(forged
        .validate()
        .unwrap_err()
        .to_string()
        .contains("fold_set differs"));
    let mut forged = original.clone();
    forged.variants.push(forged.variants[0].clone());
    assert!(forged
        .validate()
        .unwrap_err()
        .to_string()
        .contains("repeats variant"));
    let mut forged = original.clone();
    forged.variants[0].seed = Some(forged.variants[0].seed.unwrap_or(0) ^ 1);
    assert!(forged
        .validate()
        .unwrap_err()
        .to_string()
        .contains("seed differs"));
    let mut forged = original.clone();
    forged.variants[0].fingerprint = "f".repeat(64);
    assert!(forged.validate().is_err());
    let mut serialized = serde_json::to_value(&original).unwrap();
    let key = original.node_plans.keys().next().unwrap().as_str();
    serialized["node_plans"][key]["data_bindings"] = json!([{"node_id":key,"input_name":"x","request_id":"r",
        "schema_fingerprint":"a".repeat(64),"plan_fingerprint":"b".repeat(64),"output_representation":"tabular_numeric"}]);
    let forged: ExecutionPlan = serde_json::from_value(serialized).unwrap();
    assert!(forged
        .validate()
        .unwrap_err()
        .to_string()
        .contains("data bindings or shape plan differ"));
    // Selection narrows the candidates without changing the generation contract.
    let mut selected = original;
    selected.variants.truncate(1);
    selected.validate().unwrap();
}

#[test]
fn generation_refuses_the_cartesian_product_before_materialization() {
    let spec: GenerationSpec =
        serde_json::from_value(json!({"strategy":"cartesian","max_variants":2,
        "dimensions":[{"name":"left","choices":[{"label":"0","value":0},{"label":"1","value":1}]},
        {"name":"right","choices":[{"label":"0","value":0},{"label":"1","value":1}]}]}))
        .unwrap();
    assert!(enumerate_variants(&spec, Some(1)).is_err());
    let mut huge = spec;
    huge.max_variants = None;
    huge.dimensions = (0..64)
        .map(|i| {
            let mut dimension = huge.dimensions[0].clone();
            dimension.name = format!("d{i}");
            dimension
        })
        .collect();
    assert!(enumerate_variants(&huge, Some(1)).is_err());
}

#[test]
fn operator_pick_range_is_bounded_before_collecting_sizes() {
    let mut value = json!({"id":"pick-bounds", "steps":[{
        "kind":"generator","id":"generator:choices","mode":"or","pick":[1,1],
        "branches":[
            {"id":"left","steps":[{"kind":"model","id":"model:left","operator":{"type":"Ridge"}}]},
            {"id":"right","steps":[{"kind":"model","id":"model:right","operator":{"type":"Ridge"}}]}
        ]
    }]});
    let valid: PipelineDslSpec = serde_json::from_value(value.clone()).unwrap();
    compile_pipeline_dsl_with_generation(&valid).unwrap();
    value["steps"][0]["pick"] = json!([1, u64::MAX]);
    let huge: PipelineDslSpec = serde_json::from_value(value).unwrap();
    assert!(compile_pipeline_dsl_with_generation(&huge).is_err());
}

#[test]
fn compat_fusion_lookahead_does_not_duplicate_split_side_effects() {
    let spec = parse_pipeline_dsl_json(br#"{"id":"lookahead","steps":[{"_or_":["SNV","MSC"]},{"split":"KFold"},"StandardScaler"]}"#).unwrap();
    let split = serde_json::to_value(spec.split_invocation.unwrap()).unwrap();
    assert!(!split.to_string().contains("compat_split_chain"));
}

#[test]
fn integer_ranges_are_integer_parameters_and_log_bounds_are_exact() {
    let spec = parse_pipeline_dsl_json(
        br#"{"id":"ranges","steps":[{"_range_":[5,15,5]},{"model":"PLSRegression"}]}"#,
    )
    .unwrap();
    let compiled = compile_pipeline_dsl_with_generation(&spec).unwrap();
    let variants = enumerate_variants(&compiled.generation, Some(1)).unwrap();
    assert_eq!(variants.len(), 3);
    assert!(variants
        .iter()
        .flat_map(|v| v.choices.values())
        .flat_map(|choice| &choice.param_overrides)
        .all(|overrides| overrides.params["n_components"].is_i64()));
    let spec = parse_pipeline_dsl_json(
        br#"{"id":"logs","steps":[{"_log_range_":{"start":0.001,"stop":1000,"count":3}},{"model":"PLSRegression"}]}"#,
    )
    .unwrap();
    let compiled = compile_pipeline_dsl_with_generation(&spec).unwrap();
    let values = &compiled.generation.dimensions[0].choices;
    assert_eq!(
        values[0].param_overrides[0].params["alpha"].as_f64(),
        Some(0.001)
    );
    assert_eq!(
        values.last().unwrap().param_overrides[0].params["alpha"].as_f64(),
        Some(1000.0)
    );
}

#[test]
fn labeled_generator_values_keep_the_documented_syntax_and_preserve_extra_keys() {
    let labeled: PipelineDslGeneratorValue =
        serde_json::from_value(json!({"label":"x","value":1})).unwrap();
    assert!(matches!(labeled, PipelineDslGeneratorValue::Labeled { .. }));
    let object = json!({"label":"x","value":1,"units":"nm"});
    let plain: PipelineDslGeneratorValue = serde_json::from_value(object.clone()).unwrap();
    assert_eq!(plain, PipelineDslGeneratorValue::Value(object));
}

#[test]
fn graph_cardinality_rejects_duplicate_edges_but_external_inputs_are_valid() {
    let mut graph = plan().graph_plan.graph;
    graph.validate().unwrap();
    let duplicate = graph.edges[0].clone();
    graph.edges.push(duplicate);
    assert!(graph.validate().is_err());
}

#[test]
fn hpo_space_bounds_are_checked_without_loading_the_native_optimizer() {
    for parameter in [
        json!({"kind":"sorted_tuple","name":"x","length":i32::MAX,"low":0,"high":1,"integer":false}),
        json!({"kind":"int","name":"x","low":0,"high":10,"step":1,"log":true}),
        json!({"kind":"float","name":"x","low":-1,"high":10,"step":0,"log":true}),
    ] {
        let space: HpoSearchSpace =
            serde_json::from_value(json!({"parameters":[parameter]})).unwrap();
        assert!(space.validate().is_err());
    }
}

#[test]
fn native_hpo_ties_use_trial_numbers_and_ordinary_candidates_stay_lexical() {
    let policy: SelectionPolicy = serde_json::from_value(
        json!({"id":"ties","metric":{"name":"rmse","objective":"minimize"}}),
    )
    .unwrap();
    for (ids, expected) in [
        (["hpo:trial:10", "hpo:trial:2"], "hpo:trial:2"),
        (
            ["hpo:scope:a:trial:10", "hpo:scope:a:trial:2"],
            "hpo:scope:a:trial:2",
        ),
        (["model:10", "model:2"], "model:10"),
    ] {
        let candidates = ids
            .into_iter()
            .map(|id| {
                serde_json::from_value(json!({"candidate_id":id,"metrics":{"rmse":1.0}})).unwrap()
            })
            .collect::<Vec<CandidateScore>>();
        assert_eq!(
            select_candidate(&policy, &candidates)
                .unwrap()
                .selected_candidate_id,
            expected
        );
    }
}

fn predictions(fold: &str, value: f64) -> PredictionBlock {
    serde_json::from_value(json!({"producer_node":"classifier","producer_port":"y_hat","partition":"validation","fold_id":fold,
        "sample_ids":["a"],"values":[[value]],"target_names":["y"]})).unwrap()
}

#[test]
fn repeated_class_predictions_vote_without_inventing_a_new_class() {
    let blocks = vec![predictions("f0", 0.0), predictions("f1", 2.0)];
    let targets: Vec<RegressionTargetRecord> = ["f0", "f1"].into_iter().map(|fold| RegressionTargetRecord {
        producer_node: NodeId::new("classifier").unwrap(),
        producer_port: Some("y_hat".to_owned()),
        variant_id: None,
        partition: PredictionPartition::Validation,
        fold_id: Some(FoldId::new(fold).unwrap()),
        block: serde_json::from_value(json!({"level":"sample","unit_ids":[{"level":"sample","id":"a"}],"values":[[0.0]],"target_names":["y"]})).unwrap(),
    }).collect();
    let outcome = cross_fold_validation_reports_with_classification(
        &blocks,
        &[],
        &targets,
        &[RegressionMetricKind::Rmse, RegressionMetricKind::Accuracy],
        FoldPartitionMode::Resampled,
        &BTreeSet::from([NodeId::new("classifier").unwrap()]),
    )
    .unwrap();
    assert_eq!(outcome.oof_averages[0].predictions.values, vec![vec![0.0]]);
    assert_eq!(outcome.reports[0].metrics["accuracy"], 1.0);
    let regression = cross_fold_validation_reports(
        &blocks,
        &targets,
        &[RegressionMetricKind::Rmse],
        FoldPartitionMode::Resampled,
    )
    .unwrap();
    assert_eq!(
        regression.oof_averages[0].predictions.values,
        vec![vec![1.0]]
    );
}

#[test]
fn lineage_duplicate_errors_preserve_the_original_record() {
    let fixture: Value = serde_json::from_str(include_str!(
        "fixtures/package/archive/training_outcome_port_explicit.json"
    ))
    .unwrap();
    let record: LineageRecord = serde_json::from_value(fixture["lineage"][0].clone()).unwrap();
    let mut recorder = InMemoryLineageRecorder::new();
    recorder.record(record.clone()).unwrap();
    let mut second = record.clone();
    second.input_lineage.clear();
    assert!(recorder.record(second).is_err());
    assert_eq!(
        recorder.records().cloned().collect::<Vec<_>>(),
        vec![record]
    );
}
