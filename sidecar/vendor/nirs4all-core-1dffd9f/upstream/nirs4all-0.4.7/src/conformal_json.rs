//! Host-neutral bridges to DAG-ML conformal contracts and kernels.
use dag_ml_core::{
    align_named_source_rows, build_conformal_presentation_v1,
    calibrate_attached_training_replay_with_derived_context, regression_conformal_metrics,
    ArtifactLoadMode, ConformalCalibration, ConformalCalibrationTruth, ConformalIntervalBlock,
    ConformalMultiTargetPolicy, FittedArtifactMode, NamedSourceAlignmentRequest,
    NamedSourceSampleOrder, PortablePredictorPackage, PredictionBlock, SampleId, SampleRelationSet,
    TrainingOutcome, TrainingReplayOutcome, TrainingReplayRequest,
};
use serde::Deserialize;
use serde_json::json;

/// Binding transport carries schema and validity alongside keyed numeric truth.
/// The native calibrator still receives its original strict aligned contract.
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct CalibrationTruthInput {
    sample_ids: Vec<SampleId>,
    values: Vec<Vec<f64>>,
    target_names: Vec<String>,
    validity_masks: Vec<Vec<bool>>,
}

fn aligned_calibration_truth(
    point: &PredictionBlock,
    target_names: &[String],
    truth: CalibrationTruthInput,
) -> Result<ConformalCalibrationTruth, String> {
    let width = point.validate_content().map_err(|e| e.to_string())?;
    if target_names.len() != width
        || point.target_names != target_names
        || truth.target_names != target_names
    {
        return Err("calibration truth target schema differs from native prediction".into());
    }
    if truth.values.len() != truth.sample_ids.len()
        || truth
            .values
            .iter()
            .any(|row| row.len() != width || row.iter().any(|v| !v.is_finite()))
        || truth.validity_masks.len() != truth.sample_ids.len()
        || truth
            .validity_masks
            .iter()
            .any(|row| row.len() != width || row.iter().any(|v| !v))
    {
        return Err("calibration requires complete finite truth rows and validity masks".into());
    }
    // DAG owns exact-set, uniqueness and keyed permutation validation. Only
    // target rows move here; features and the signed replay are unchanged.
    let alignment = align_named_source_rows(&NamedSourceAlignmentRequest {
        sample_ids: point.sample_ids.clone(),
        required_source_ids: vec!["calibration:truth".into()],
        sources: vec![NamedSourceSampleOrder {
            source_id: "calibration:truth".into(),
            sample_ids: truth.sample_ids,
        }],
    })
    .map_err(|e| e.to_string())?;
    Ok(ConformalCalibrationTruth {
        sample_ids: alignment.sample_ids,
        values: alignment.sources[0]
            .row_indices
            .iter()
            .map(|&i| truth.values[i].clone())
            .collect(),
    })
}

/// Host-safe attachment bridge: every fingerprint and overlap check stays native.
pub fn calibrate_workflow_replay_json(
    source: &str,
    replay: &str,
    relations: &str,
    truth: &str,
    coverages: &str,
    small_sample_policy: &str,
) -> Result<String, String> {
    let mut source = TrainingOutcome::from_json(source).map_err(|e| e.to_string())?;
    if source.conformal_calibration.is_some() {
        return Err("predictor already calibrated".into());
    }
    let replay = TrainingReplayOutcome::from_json(replay).map_err(|e| e.to_string())?;
    let relations: SampleRelationSet =
        serde_json::from_str(relations).map_err(|e| e.to_string())?;
    let truth: CalibrationTruthInput = serde_json::from_str(truth).map_err(|e| e.to_string())?;
    let [output] = replay.outputs.as_slice() else {
        return Err("one calibration output required".into());
    };
    let [point] = output.predictions.as_slice() else {
        return Err("one native calibration point block required".into());
    };
    let truth = aligned_calibration_truth(point, &output.binding.target_names, truth)?;
    let calibration = calibrate_attached_training_replay_with_derived_context(
        &mut source,
        &replay,
        &output.binding.binding_id,
        &relations,
        truth,
        serde_json::from_str(coverages).map_err(|e| e.to_string())?,
        ConformalMultiTargetPolicy::Marginal,
        serde_json::from_str(small_sample_policy).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    let package = source
        .to_portable_predictor_package(
            "package:public:calibrated",
            FittedArtifactMode::PortableRequired,
            ArtifactLoadMode::NativePortable,
        )
        .map_err(|e| e.to_string())?;
    serde_json::to_string(&json!({"training_outcome_json": serde_json::to_string(&source).map_err(|e| e.to_string())?,
        "calibration": calibration, "portable_predictor_package_json": serde_json::to_string(&package).map_err(|e| e.to_string())?}))
        .map_err(|e| e.to_string())
}

pub fn calibrated_prediction_json(
    package: &str,
    request: &str,
    replay: &str,
) -> Result<String, String> {
    let package = PortablePredictorPackage::from_json(package).map_err(|e| e.to_string())?;
    let request = TrainingReplayRequest::from_json(request).map_err(|e| e.to_string())?;
    let replay = TrainingReplayOutcome::from_json(replay).map_err(|e| e.to_string())?;
    for output in &replay.outputs {
        for point in &output.predictions {
            dag_ml_core::public_robustness::validate_independent_uncertainty_ids(
                &package,
                &point.sample_ids,
            )
            .map_err(|e| e.to_string())?;
        }
    }
    let presentation =
        build_conformal_presentation_v1(&package, &request, &replay).map_err(|e| e.to_string())?;
    let [interval] = replay.conformal_intervals.as_slice() else {
        return Err("one calibrated interval block required".into());
    };
    serde_json::to_string(&json!({"schema": "nirs4all.calibrated-prediction.v1",
        "presentation": presentation, "interval_block": interval,
        "sample_ids": presentation.sample_ids, "point_predictions": presentation.point_predictions}))
        .map_err(|e| e.to_string())
}

/// Diagnostics require keyed truth matching the exact native interval rows.
pub fn conformal_metrics_json(
    calibration: &str,
    intervals: &str,
    truth: &str,
) -> Result<String, String> {
    // A browser can pass the untouched package bytes, preserving TCV1's
    // integer/float distinctions that JSON.stringify cannot retain.
    let raw: serde_json::Value = serde_json::from_str(calibration).map_err(|e| e.to_string())?;
    let calibration = if raw.get("package_fingerprint").is_some() {
        PortablePredictorPackage::from_json(calibration)
            .map_err(|e| e.to_string())?
            .conformal_calibration
            .ok_or("native package has no calibration")?
    } else {
        ConformalCalibration::from_json(calibration).map_err(|e| e.to_string())?
    };
    let intervals: ConformalIntervalBlock =
        serde_json::from_str(intervals).map_err(|e| e.to_string())?;
    let truth: ConformalCalibrationTruth =
        serde_json::from_str(truth).map_err(|e| e.to_string())?;
    intervals.validate().map_err(|e| e.to_string())?;
    if truth.sample_ids != intervals.sample_ids
        || intervals.calibration_fingerprint != calibration.calibration_fingerprint
    {
        return Err("truth identities or calibration fingerprint differ from intervals".into());
    }
    let metrics = intervals
        .intervals
        .iter()
        .map(|interval| {
            regression_conformal_metrics(&truth.values, interval, calibration.multi_target_policy)
                .map(|values| json!({"coverage": interval.coverage, "metrics": values.iter().map(|m| json!({
                    "target_index": m.target_index,
                    "measurement_status": format!("{:?}", m.measurement_status).to_lowercase(),
                    "empirical_coverage": m.empirical_coverage, "coverage_gap": m.coverage_gap,
                    "mean_width": m.mean_width, "median_width": m.median_width, "interval_score": m.interval_score,
                })).collect::<Vec<_>>()}))
                .map_err(|e| e.to_string())
        })
        .collect::<Result<Vec<_>, _>>()?;
    serde_json::to_string(&json!({"schema": "nirs4all.conformal.metrics.v1", "sample_ids": truth.sample_ids, "coverages": metrics}))
        .map_err(|e| e.to_string())
}

pub fn calibrated_methods_points_json(
    package: &str,
    archive_sha256: &str,
    sample_ids: &str,
    values: &str,
    descriptor: &str,
) -> Result<String, String> {
    let package = PortablePredictorPackage::from_json(package).map_err(|e| e.to_string())?;
    let result = dag_ml_core::public_robustness::calibrated_frozen_methods_points(
        &package,
        archive_sha256,
        serde_json::from_str(sample_ids).map_err(|e| e.to_string())?,
        serde_json::from_str(values).map_err(|e| e.to_string())?,
        &serde_json::from_str(descriptor).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    serde_json::to_string(&result).map_err(|e| e.to_string())
}
