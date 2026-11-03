//! Host-neutral native scenario/report bridge.
use dag_ml_core::public_robustness::{frozen_robustness_report, FrozenRobustnessScenario};
use dag_ml_core::{ConformalCalibrationTruth, PortablePredictorPackage, TrainingReplayOutcome};

pub fn validate_robustness_scenarios_json(scenarios: &str) -> Result<String, String> {
    let scenarios: Vec<FrozenRobustnessScenario> =
        serde_json::from_str(scenarios).map_err(|e| e.to_string())?;
    if scenarios.is_empty() || scenarios.len() > 64 || scenarios[0].kind != "observed" {
        return Err("1 to 64 scenarios with observed baseline required".into());
    }
    let mut ids = std::collections::BTreeSet::new();
    for scenario in &scenarios {
        scenario.validate().map_err(|e| e.to_string())?;
        if !ids.insert(&scenario.id) {
            return Err("duplicate scenario id".into());
        }
    }
    serde_json::to_string(&scenarios).map_err(|e| e.to_string())
}

pub fn robustness_report_json(
    package: &str,
    scenarios: &str,
    replays: &str,
    truth: &str,
) -> Result<String, String> {
    let package = PortablePredictorPackage::from_json(package).map_err(|e| e.to_string())?;
    let scenarios: Vec<FrozenRobustnessScenario> =
        serde_json::from_str(scenarios).map_err(|e| e.to_string())?;
    let raw: Vec<serde_json::Value> = serde_json::from_str(replays).map_err(|e| e.to_string())?;
    let replays = raw
        .iter()
        .map(|replay| match replay.as_str() {
            Some(original) => TrainingReplayOutcome::from_json(original).map_err(|e| e.to_string()),
            None => TrainingReplayOutcome::from_json(
                &serde_json::to_string(replay).map_err(|e| e.to_string())?,
            )
            .map_err(|e| e.to_string()),
        })
        .collect::<Result<Vec<_>, _>>()?;
    let truth: ConformalCalibrationTruth =
        serde_json::from_str(truth).map_err(|e| e.to_string())?;
    let report = frozen_robustness_report(&package, &scenarios, &replays, &truth)
        .map_err(|e| e.to_string())?;
    serde_json::to_string(&report).map_err(|e| e.to_string())
}

pub fn robustness_methods_points_json(
    package: &str,
    scenarios: &str,
    points: &str,
    truth: &str,
) -> Result<String, String> {
    let package = PortablePredictorPackage::from_json(package).map_err(|e| e.to_string())?;
    let scenarios: Vec<FrozenRobustnessScenario> =
        serde_json::from_str(scenarios).map_err(|e| e.to_string())?;
    let raw_points: Vec<serde_json::Value> =
        serde_json::from_str(points).map_err(|e| e.to_string())?;
    let points = raw_points
        .into_iter()
        .map(|point| match point {
            serde_json::Value::String(original) => {
                serde_json::from_str(&original).map_err(|e| e.to_string())
            }
            value => Ok(value),
        })
        .collect::<Result<Vec<_>, String>>()?;
    let truth = serde_json::from_str(truth).map_err(|e| e.to_string())?;
    let report = dag_ml_core::public_robustness::frozen_methods_points_robustness_report(
        &package, &scenarios, &points, &truth,
    )
    .map_err(|e| e.to_string())?;
    serde_json::to_string(&report).map_err(|e| e.to_string())
}

/// Present inspected callback-free Methods points with optional archived calibration.
pub fn frozen_methods_points_json(
    package: &str,
    archive_sha: &str,
    sample_ids: &str,
    values: &str,
    descriptor: &str,
) -> Result<String, String> {
    let package = PortablePredictorPackage::from_json(package).map_err(|e| e.to_string())?;
    let point = dag_ml_core::public_robustness::frozen_methods_points(
        &package,
        archive_sha,
        serde_json::from_str(sample_ids).map_err(|e| e.to_string())?,
        serde_json::from_str(values).map_err(|e| e.to_string())?,
        &serde_json::from_str(descriptor).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    serde_json::to_string(&point).map_err(|e| e.to_string())
}
