use std::collections::BTreeMap;

use dag_ml_core::{
    calibrate_residual_gate, derive_residual_targets, fuse_residual_predictions, FoldAssignment,
    FoldId, FoldPartitionMode, FoldSet, FoldTrainExclusion, NodeId, PredictionBlock,
    PredictionPartition, ResidualGate, ResidualGateResult, ResidualTargetSet, SampleId,
};

fn sample(number: usize) -> SampleId {
    SampleId::new(format!("sample:{number}")).unwrap()
}

fn fold(number: usize, train: &[usize], validation: &[usize]) -> FoldAssignment {
    FoldAssignment {
        fold_id: FoldId::new(format!("fold:{number}")).unwrap(),
        train_sample_ids: train.iter().copied().map(sample).collect(),
        validation_sample_ids: validation.iter().copied().map(sample).collect(),
        metadata: BTreeMap::new(),
    }
}

fn prediction(
    producer: &NodeId,
    number: usize,
    samples: &[usize],
    values: &[f64],
) -> PredictionBlock {
    PredictionBlock {
        prediction_id: None,
        producer_node: producer.clone(),
        producer_port: None,
        partition: PredictionPartition::Validation,
        fold_id: Some(FoldId::new(format!("fold:{number}")).unwrap()),
        sample_ids: samples.iter().copied().map(sample).collect(),
        values: values.iter().map(|value| vec![*value]).collect(),
        target_names: vec!["y".to_string()],
    }
}

fn observed(rows: &[(usize, f64)]) -> BTreeMap<SampleId, Vec<f64>> {
    rows.iter()
        .map(|(id, value)| (sample(*id), vec![*value]))
        .collect()
}

#[test]
fn residual_targets_join_by_sample_id_in_foldset_order() {
    let producer = NodeId::new("base").unwrap();
    let folds = FoldSet {
        id: "inner".to_string(),
        sample_ids: (1..=4).map(sample).collect(),
        folds: vec![fold(0, &[1, 2], &[3, 4]), fold(1, &[3, 4], &[1, 2])],
        sample_groups: BTreeMap::new(),
        partition_mode: FoldPartitionMode::Partition,
        train_exclusion: FoldTrainExclusion::Relations,
        target_missing_sample_ids: Vec::new(),
    };
    let blocks = [
        prediction(&producer, 0, &[4, 3], &[4.0, 3.0]),
        prediction(&producer, 1, &[2, 1], &[2.0, 1.0]),
    ];

    let result = derive_residual_targets(
        &folds,
        &producer,
        &blocks,
        &observed(&[(1, 10.0), (2, 20.0), (3, 30.0), (4, 40.0)]),
    )
    .unwrap();
    assert_eq!(result.sample_ids, folds.sample_ids);
    assert_eq!(
        result.values,
        vec![vec![9.0], vec![18.0], vec![27.0], vec![36.0]]
    );
    assert_eq!(result.target_names, vec!["y"]);
}

#[test]
fn residual_targets_reject_train_predictions_and_fold_identity_mismatch() {
    let producer = NodeId::new("base").unwrap();
    let folds = FoldSet {
        id: "inner".to_string(),
        sample_ids: vec![sample(1), sample(2)],
        folds: vec![fold(0, &[1], &[2]), fold(1, &[2], &[1])],
        sample_groups: BTreeMap::new(),
        partition_mode: FoldPartitionMode::Partition,
        train_exclusion: FoldTrainExclusion::Relations,
        target_missing_sample_ids: Vec::new(),
    };
    let targets = observed(&[(1, 10.0), (2, 20.0)]);
    let mut blocks = [
        prediction(&producer, 0, &[2], &[2.0]),
        prediction(&producer, 1, &[1], &[1.0]),
    ];
    blocks[0].partition = PredictionPartition::Train;
    assert!(
        derive_residual_targets(&folds, &producer, &blocks, &targets)
            .unwrap_err()
            .to_string()
            .contains("only validation OOF")
    );
    blocks[0].partition = PredictionPartition::Validation;
    blocks[0].sample_ids = vec![sample(1)];
    assert!(
        derive_residual_targets(&folds, &producer, &blocks, &targets)
            .unwrap_err()
            .to_string()
            .contains("validation")
    );
}

#[test]
fn residual_targets_average_repeated_validation_before_subtraction() {
    let producer = NodeId::new("base").unwrap();
    let folds = FoldSet {
        id: "inner".to_string(),
        sample_ids: (1..=3).map(sample).collect(),
        folds: vec![fold(0, &[3], &[1, 2]), fold(1, &[1], &[2, 3])],
        sample_groups: BTreeMap::new(),
        partition_mode: FoldPartitionMode::Resampled,
        train_exclusion: FoldTrainExclusion::Relations,
        target_missing_sample_ids: Vec::new(),
    };
    let blocks = [
        prediction(&producer, 0, &[1, 2], &[1.0, 2.0]),
        prediction(&producer, 1, &[2, 3], &[4.0, 3.0]),
    ];
    let result = derive_residual_targets(
        &folds,
        &producer,
        &blocks,
        &observed(&[(1, 10.0), (2, 20.0), (3, 30.0)]),
    )
    .unwrap();
    assert_eq!(result.values, vec![vec![9.0], vec![17.0], vec![27.0]]);
}

#[test]
fn residual_gate_uses_only_sample_keyed_oof_and_matches_legacy_formula() {
    let targets = ResidualTargetSet {
        base_producer: NodeId::new("base").unwrap(),
        sample_ids: vec![sample(2), sample(1)],
        values: vec![vec![4.0], vec![2.0]],
        target_names: vec!["y".to_string()],
    };
    let learner = BTreeMap::from([(sample(1), vec![1.0]), (sample(2), vec![2.0])]);
    let result = calibrate_residual_gate(
        &targets,
        &learner,
        ResidualGate::Automatic { rli_threshold: 0.0 },
    )
    .unwrap();
    // The least-squares weight is 2, clipped to [0, 1]; learnability below
    // the threshold closes the automatic gate.
    assert_eq!(result.gate, 0.0);
    assert!((result.rli - (1.0 - 2.5_f64.sqrt())).abs() < 1e-12);
    assert_eq!(
        calibrate_residual_gate(&targets, &learner, ResidualGate::Disabled)
            .unwrap()
            .gate,
        1.0
    );
    assert_eq!(
        calibrate_residual_gate(&targets, &learner, ResidualGate::Fixed(0.25))
            .unwrap()
            .gate,
        0.25
    );
    let missing = BTreeMap::from([(sample(1), vec![1.0])]);
    assert!(calibrate_residual_gate(&targets, &missing, ResidualGate::Disabled).is_err());
}

#[test]
fn residual_fusion_aligns_rows_by_sample_and_rejects_missing_learner_rows() {
    let base = BTreeMap::from([(sample(1), vec![10.0]), (sample(2), vec![20.0])]);
    let learner = BTreeMap::from([(sample(2), vec![4.0]), (sample(1), vec![2.0])]);
    let fused = fuse_residual_predictions(
        &base,
        &learner,
        0.5,
        ResidualGateResult {
            gate: 0.25,
            rli: 0.2,
        },
    )
    .unwrap();
    assert_eq!(fused[&sample(1)], vec![10.25]);
    assert_eq!(fused[&sample(2)], vec![20.5]);
    assert!(fuse_residual_predictions(
        &base,
        &BTreeMap::from([(sample(1), vec![2.0])]),
        1.0,
        ResidualGateResult {
            gate: 1.0,
            rli: 0.0
        }
    )
    .is_err());
}
