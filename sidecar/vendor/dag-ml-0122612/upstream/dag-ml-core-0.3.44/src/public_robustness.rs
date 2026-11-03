//! Frozen-predictor robustness semantics; Methods owns perturbation kernels.
use crate::{
    score_regression_prediction_block, ConformalCalibrationTruth, DagMlError,
    PortablePredictorPackage, PredictionBlock, PredictionLevel, PredictionUnitId,
    RegressionMetricKind, RegressionTargetBlock, Result, SampleId, SampleRelationSet,
    TrainingReplayOutcome,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::BTreeSet;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FrozenRobustnessScenario {
    pub id: String,
    pub kind: String,
    pub severity: f64,
    pub seed: u32,
}
impl FrozenRobustnessScenario {
    pub fn validate(&self) -> Result<()> {
        if self.id.is_empty() || !self.severity.is_finite() || self.severity < 0.0 {
            return Err(DagMlError::RuntimeValidation(
                "scenario requires id and finite nonnegative severity".into(),
            ));
        }
        match self.kind.as_str() {
            "observed" if self.severity == 0.0 => Ok(()),
            "spectral_noise" => Ok(()),
            _ => Err(DagMlError::RuntimeValidation(
                "supported frozen scenarios: observed severity=0, spectral_noise (native Gaussian)"
                    .into(),
            )),
        }
    }
}

/// Independent inference cannot overlap any physical/origin/group influence
/// or the held-out calibration cohort. It never grants a new coverage claim.
pub fn validate_independent_uncertainty_cohort(
    package: &PortablePredictorPackage,
    relations: &SampleRelationSet,
) -> Result<()> {
    package.validate()?;
    relations.validate()?;
    let influenced = package
        .training_influence
        .entries
        .iter()
        .flat_map(|entry| {
            entry
                .physical_sample_ids
                .iter()
                .chain(&entry.origin_sample_ids)
        })
        .collect::<BTreeSet<_>>();
    let groups = package
        .training_influence
        .entries
        .iter()
        .flat_map(|entry| &entry.group_ids)
        .collect::<BTreeSet<_>>();
    let calibrated = package
        .conformal_calibration
        .as_ref()
        .map(|c| {
            c.context
                .calibration_cohort
                .physical_sample_ids
                .iter()
                .chain(&c.context.calibration_cohort.origin_sample_ids)
                .collect::<BTreeSet<_>>()
        })
        .unwrap_or_default();
    for record in &relations.records {
        if std::iter::once(&record.sample_id)
            .chain(record.origin_sample_id.as_ref())
            .any(|id| influenced.contains(id) || calibrated.contains(id))
            || record
                .group_id
                .as_ref()
                .is_some_and(|id| groups.contains(id))
        {
            return Err(DagMlError::RuntimeValidation(
                "independent cohort overlaps training or calibration influence".into(),
            ));
        }
        if record.is_augmented {
            return Err(DagMlError::RuntimeValidation(
                "independent cohort refuses augmented observations".into(),
            ));
        }
    }
    Ok(())
}

pub fn validate_independent_uncertainty_ids(
    package: &PortablePredictorPackage,
    ids: &[SampleId],
) -> Result<()> {
    package.validate()?;
    let influenced = package
        .training_influence
        .entries
        .iter()
        .flat_map(|entry| {
            entry
                .physical_sample_ids
                .iter()
                .chain(&entry.origin_sample_ids)
        })
        .collect::<BTreeSet<_>>();
    let calibrated = package
        .conformal_calibration
        .as_ref()
        .map(|c| {
            c.context
                .calibration_cohort
                .physical_sample_ids
                .iter()
                .chain(&c.context.calibration_cohort.origin_sample_ids)
                .collect::<BTreeSet<_>>()
        })
        .unwrap_or_default();
    if ids
        .iter()
        .any(|id| influenced.contains(id) || calibrated.contains(id))
    {
        return Err(DagMlError::RuntimeValidation(
            "independent cohort overlaps training or calibration influence".into(),
        ));
    }
    Ok(())
}

/// Summarize actual frozen replay outcomes with keyed truth and built-in metrics.
pub fn frozen_robustness_report(
    package: &PortablePredictorPackage,
    scenarios: &[FrozenRobustnessScenario],
    replays: &[TrainingReplayOutcome],
    truth: &ConformalCalibrationTruth,
) -> Result<Value> {
    package.validate()?;
    if scenarios.is_empty()
        || scenarios.len() != replays.len()
        || scenarios.len() > 64
        || scenarios[0].kind != "observed"
    {
        return Err(DagMlError::RuntimeValidation(
            "1 to 64 scenarios with observed baseline and exact replay count required".into(),
        ));
    }
    let mut unique = BTreeSet::new();
    let mut rows = Vec::new();
    for (scenario, replay) in scenarios.iter().zip(replays) {
        scenario.validate()?;
        if !unique.insert(&scenario.id) {
            return Err(DagMlError::RuntimeValidation(
                "duplicate scenario id".into(),
            ));
        }
        replay.validate()?;
        let request = crate::TrainingReplayRequest {
            schema_version: crate::TRAINING_REPLAY_REQUEST_SCHEMA_VERSION,
            request_id: replay.replay_request_id.clone(),
            source_outcome_fingerprint: replay.source_training_outcome.outcome_fingerprint.clone(),
            phase: replay.phase,
            data_envelope_keys: replay
                .input_data_identities
                .iter()
                .map(|i| i.requirement_key.clone())
                .collect(),
            output_binding_ids: replay
                .outputs
                .iter()
                .map(|o| o.binding.binding_id.clone())
                .collect(),
            request_fingerprint: replay.replay_request_fingerprint.clone(),
        };
        replay.validate_against_package(package, &request)?;
        if replay.source_training_outcome.outcome_fingerprint
            != package.training_outcome.outcome_fingerprint
            || replay.phase != crate::Phase::Predict
        {
            return Err(DagMlError::RuntimeValidation(
                "robustness requires same frozen predictor PREDICT replay".into(),
            ));
        }
        let [output] = replay.outputs.as_slice() else {
            return Err(DagMlError::RuntimeValidation(
                "one robustness output required".into(),
            ));
        };
        let [point]: &[PredictionBlock; 1] =
            output.predictions.as_slice().try_into().map_err(|_| {
                DagMlError::RuntimeValidation("one robustness point block required".into())
            })?;
        if point.sample_ids != truth.sample_ids {
            return Err(DagMlError::RuntimeValidation(
                "robustness truth identities differ from predictions".into(),
            ));
        }
        validate_independent_uncertainty_ids(package, &point.sample_ids)?;
        let target = RegressionTargetBlock {
            level: PredictionLevel::Sample,
            unit_ids: truth
                .sample_ids
                .iter()
                .cloned()
                .map(PredictionUnitId::Sample)
                .collect(),
            values: truth.values.clone(),
            validity_masks: None,
            target_names: point.target_names.clone(),
        };
        let metrics = score_regression_prediction_block(
            point,
            &target,
            &[RegressionMetricKind::Rmse, RegressionMetricKind::Mae],
        )?;
        rows.push(json!({"scenario": scenario, "metrics": metrics, "replay_outcome_fingerprint": replay.outcome_fingerprint,
            "point_predictions": point.values, "sample_ids": point.sample_ids,
            "intervals": replay.conformal_intervals}));
    }
    Ok(
        json!({"schema": "nirs4all.robustness.v1", "mode": "clean_frozen", "audit_only": true,
        "rng_profile": "n4m_pcg64_v1", "noise_distribution": "normal",
        "package_fingerprint": package.package_fingerprint, "sample_ids": truth.sample_ids,
        "calibration_fingerprint": package.conformal_calibration.as_ref().map(|c| &c.calibration_fingerprint),
        "scenarios": rows}),
    )
}

/// Present actual frozen Methods predictions with required archived calibration.
/// This retains the strict calibrated API while frozen audits also admit no calibrator.
pub fn calibrated_frozen_methods_points(
    package: &PortablePredictorPackage,
    archive_sha256: &str,
    sample_ids: Vec<SampleId>,
    values: Vec<Vec<f64>>,
    inspected_descriptor: &crate::NativePredictorDescriptorV1,
) -> Result<Value> {
    if package.conformal_calibration.is_none() {
        return Err(DagMlError::RuntimeValidation(
            "archive has no calibrator".into(),
        ));
    }
    frozen_methods_points(
        package,
        archive_sha256,
        sample_ids,
        values,
        inspected_descriptor,
    )
}

/// Present actual callback-free Methods predictions, optionally with calibration.
/// This is a point/interval contract, not a fabricated scheduler replay outcome.
pub fn frozen_methods_points(
    package: &PortablePredictorPackage,
    archive_sha256: &str,
    sample_ids: Vec<SampleId>,
    values: Vec<Vec<f64>>,
    inspected_descriptor: &crate::NativePredictorDescriptorV1,
) -> Result<Value> {
    package.validate()?;
    inspected_descriptor.validate()?;
    if archive_sha256.len() != 64
        || !archive_sha256
            .bytes()
            .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
    {
        return Err(DagMlError::RuntimeValidation(
            "invalid archive SHA-256".into(),
        ));
    }
    validate_independent_uncertainty_ids(package, &sample_ids)?;
    let [binding] = package.output_bindings.as_slice() else {
        return Err(DagMlError::RuntimeValidation(
            "one Methods output required".into(),
        ));
    };
    let calibration = package.conformal_calibration.as_ref();
    let [artifact] = package.execution_bundle.refit_artifacts.as_slice() else {
        return Err(DagMlError::RuntimeValidation(
            "one frozen Methods artifact required".into(),
        ));
    };
    if artifact.artifact.kind != "n4m_model"
        || artifact.node_id != binding.node_id
        || artifact.artifact.native_predictor_descriptor.as_ref() != Some(inspected_descriptor)
        || calibration.is_some_and(|calibration| {
            calibration.binding_id != binding.binding_id
                || calibration.target_names != binding.target_names
        })
    {
        return Err(DagMlError::RuntimeValidation(
            "Methods inspection, predictor and calibrator do not match".into(),
        ));
    }
    let point = PredictionBlock {
        prediction_id: Some("prediction:frozen-methods".into()),
        producer_node: binding.node_id.clone(),
        producer_port: Some(binding.port_name.clone()),
        partition: crate::PredictionPartition::Final,
        fold_id: None,
        sample_ids,
        values,
        target_names: binding.target_names.clone(),
    };
    point.validate_content()?;
    if point
        .values
        .iter()
        .any(|row| row.len() != binding.target_names.len())
    {
        return Err(DagMlError::RuntimeValidation(
            "Methods output target width differs from frozen predictor".into(),
        ));
    }
    let Some(calibration) = calibration else {
        let fingerprint =
            crate::conformal_runtime::point_prediction_fingerprint_for_runtime(&point)?;
        return Ok(
            json!({"schema":"nirs4all.frozen-prediction.v1", "archive_sha256":archive_sha256,
            "package_fingerprint":package.package_fingerprint, "binding_id":binding.binding_id,
            "native_predictor_descriptor":inspected_descriptor, "sample_ids":point.sample_ids,
            "point_prediction":point, "point_prediction_fingerprint":fingerprint,
            "execution":"callback_free_methods_n4mm", "audit_only":false}),
        );
    };
    let intervals = calibration.apply(&point)?;
    Ok(
        json!({"schema":"nirs4all.calibrated-prediction.v1", "archive_sha256":archive_sha256,
        "package_fingerprint":package.package_fingerprint, "binding_id":binding.binding_id,
        "native_predictor_descriptor":inspected_descriptor,
        "sample_ids":point.sample_ids,"point_prediction":point,
        "interval_block":intervals,"calibration_fingerprint":calibration.calibration_fingerprint,
        "execution":"callback_free_methods_n4mm","audit_only":false}),
    )
}

/// Audit actual frozen Methods point blocks without inventing scheduler replay lineage.
pub fn frozen_methods_points_robustness_report(
    package: &PortablePredictorPackage,
    scenarios: &[FrozenRobustnessScenario],
    points: &[Value],
    truth: &ConformalCalibrationTruth,
) -> Result<Value> {
    if scenarios.is_empty()
        || scenarios.len() > 64
        || points.len() != scenarios.len()
        || scenarios[0].kind != "observed"
    {
        return Err(DagMlError::RuntimeValidation(
            "1 to 64 scenarios with observed baseline and exact points required".into(),
        ));
    }
    let mut ids = BTreeSet::new();
    let mut rows = Vec::new();
    for (scenario, presentation) in scenarios.iter().zip(points) {
        scenario.validate()?;
        if !ids.insert(&scenario.id) {
            return Err(DagMlError::RuntimeValidation(
                "duplicate scenario id".into(),
            ));
        }
        let point: PredictionBlock =
            serde_json::from_value(presentation["point_prediction"].clone())?;
        let descriptor =
            serde_json::from_value(presentation["native_predictor_descriptor"].clone())?;
        let expected = frozen_methods_points(
            package,
            presentation["archive_sha256"]
                .as_str()
                .ok_or_else(|| DagMlError::RuntimeValidation("missing archive identity".into()))?,
            point.sample_ids.clone(),
            point.values.clone(),
            &descriptor,
        )?;
        if expected != *presentation || point.sample_ids != truth.sample_ids {
            return Err(DagMlError::RuntimeValidation(
                "frozen native presentation or keyed truth mismatch".into(),
            ));
        }
        let target = RegressionTargetBlock {
            level: PredictionLevel::Sample,
            unit_ids: truth
                .sample_ids
                .iter()
                .cloned()
                .map(PredictionUnitId::Sample)
                .collect(),
            values: truth.values.clone(),
            validity_masks: None,
            target_names: point.target_names.clone(),
        };
        let metrics = score_regression_prediction_block(
            &point,
            &target,
            &[RegressionMetricKind::Rmse, RegressionMetricKind::Mae],
        )?;
        rows.push(
            json!({"scenario":scenario,"metrics":metrics,"sample_ids":point.sample_ids,
            "point_predictions":point.values,"intervals":presentation["interval_block"],
            "point_prediction_fingerprint": if package.conformal_calibration.is_some() {
                &presentation["interval_block"]["point_prediction_fingerprint"]
            } else { &presentation["point_prediction_fingerprint"] }}),
        );
    }
    Ok(
        json!({"schema":"nirs4all.robustness.v1","mode":"clean_frozen","audit_only":true,
        "execution":"callback_free_methods_n4mm","rng_profile":"n4m_pcg64_v1","noise_distribution":"normal",
        "package_fingerprint":package.package_fingerprint,"sample_ids":truth.sample_ids,"scenarios":rows,
        "calibration_fingerprint":package.conformal_calibration.as_ref().map(|c| &c.calibration_fingerprint)}),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn frozen_scenarios_fail_closed() {
        let mut scenario = FrozenRobustnessScenario {
            id: "s".into(),
            kind: "observed".into(),
            severity: 0.0,
            seed: 1,
        };
        assert!(scenario.validate().is_ok());
        scenario.severity = 1.0;
        assert!(scenario.validate().is_err());
        scenario.kind = "spectral_noise".into();
        assert!(scenario.validate().is_ok());
        scenario.kind = "retrain_shifted".into();
        assert!(scenario.validate().is_err());
        scenario.kind = "spectral_noise".into();
        scenario.severity = f64::NAN;
        assert!(scenario.validate().is_err());
    }
}
