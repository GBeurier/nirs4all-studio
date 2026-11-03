//! Frozen audit transport over Methods perturbations and DAG-ML report semantics.
use crate::conformal::{resolve_uncertainty_cohort, UncertaintyCohortInput};
use crate::native_methods_replay::configure_methods_runtime_for_source;
use crate::{
    load_archive_v2, predict_methods_archive_v2_matrix, MethodsArchiveMatrixPredictRequest,
};
use dag_ml_core::public_robustness::{frozen_robustness_report, FrozenRobustnessScenario};
use dag_ml_core::{ConformalCalibrationTruth, PortablePredictorPackage, RunId, SampleId};
use n4m::roles::{run_procedure, FitInputs, Params};
use n4m::{Context, MatrixRef};
use serde_json::Value;
use std::path::Path;

pub struct FrozenRobustnessRequest<'a> {
    pub archive_path: &'a Path,
    pub methods_library_path: &'a Path,
    pub methods_library_sha256: &'a str,
    pub sample_ids: Vec<String>,
    pub x: Vec<Vec<f64>>,
    pub dataset: Option<&'a Value>,
    pub source_id: Option<&'a str>,
    pub truth: Vec<Vec<f64>>,
    pub scenarios: Vec<FrozenRobustnessScenario>,
    pub run_id: &'a str,
}

pub fn robustness_archive(input: FrozenRobustnessRequest<'_>) -> Result<Value, String> {
    let archive = load_archive_v2(input.archive_path).map_err(|e| e.to_string())?;
    let package = PortablePredictorPackage::from_json(
        std::str::from_utf8(
            archive
                .portable_predictor_package()
                .map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    dag_ml_core::validate_archive_v2_portable_payloads(
        archive.manifest(),
        &package,
        archive.members(),
    )
    .map_err(|e| e.to_string())?;
    let [binding] = package.output_bindings.as_slice() else {
        return Err("one robustness output required".into());
    };
    let cohort_input = if let Some(record) = input.dataset {
        if !input.x.is_empty() || !input.sample_ids.is_empty() {
            return Err(
                "structured robustness cannot also supply positional X or sample_ids".into(),
            );
        }
        UncertaintyCohortInput::Dataset {
            record,
            source_id: input.source_id,
        }
    } else {
        if input.source_id.is_some() {
            return Err("source_id requires a structured robustness dataset".into());
        }
        UncertaintyCohortInput::Positional {
            x: &input.x,
            sample_ids: &input.sample_ids,
        }
    };
    let cohort = resolve_uncertainty_cohort(&archive, cohort_input)?;
    let ids = cohort
        .sample_ids
        .iter()
        .map(|s| SampleId::new(s).map_err(|e| e.to_string()))
        .collect::<Result<Vec<_>, _>>()?;
    if input.scenarios.is_empty()
        || input.scenarios.len() > 64
        || input.scenarios[0].kind != "observed"
    {
        return Err("1 to 64 scenarios with observed baseline required".into());
    }
    for scenario in &input.scenarios {
        scenario.validate().map_err(|e| e.to_string())?;
    }
    configure_methods_runtime_for_source(input.methods_library_path).map_err(|e| e.to_string())?;
    let ctx = Context::new().map_err(|e| e.to_string())?;
    let flat = cohort.x.iter().flatten().copied().collect::<Vec<_>>();
    let x = MatrixRef::row_major(&flat, ids.len(), cohort.x[0].len()).map_err(|e| e.to_string())?;
    let mut replays = Vec::new();
    let predict = if package.execution_bundle.methods_hpo_resume_state.is_some() {
        crate::predict_tuning_archive_v2_matrix
    } else {
        predict_methods_archive_v2_matrix
    };
    for (index, scenario) in input.scenarios.iter().enumerate() {
        let shifted = if scenario.kind == "observed" {
            cohort.x.clone()
        } else {
            let mut params = Params::new(&ctx, "augmentation.noise.gaussian_noise")
                .map_err(|e| e.to_string())?;
            params
                .set_int("seed", i64::from(scenario.seed))
                .map_err(|e| e.to_string())?;
            params
                .set_double("sigma", scenario.severity)
                .map_err(|e| e.to_string())?;
            let shifted = run_procedure(
                &ctx,
                "augmentation.noise.gaussian_noise",
                Some(&params),
                &FitInputs::new(x),
            )
            .map_err(|e| e.to_string())?
            .double_matrix("X")
            .map_err(|e| e.to_string())?;
            shifted
                .data
                .chunks_exact(shifted.cols)
                .map(|row| row.to_vec())
                .collect()
        };
        replays.push(
            predict(
                &archive,
                MethodsArchiveMatrixPredictRequest {
                    sample_ids: cohort.sample_ids.clone(),
                    x: shifted,
                    expected_target_names: binding.target_names.clone(),
                    methods_library_path: input.methods_library_path.to_owned(),
                    methods_library_sha256: input.methods_library_sha256.to_owned(),
                    request_id: format!("robustness:{}:{index}", input.run_id),
                    outcome_id: format!("outcome:robustness:{}:{index}", input.run_id),
                    run_id: RunId::new(format!("{}:{index}", input.run_id))
                        .map_err(|e| e.to_string())?,
                    warnings: vec![],
                    diagnostics: cohort.diagnostics.clone(),
                },
            )
            .map_err(|e| e.to_string())?,
        );
    }
    frozen_robustness_report(
        &package,
        &input.scenarios,
        &replays,
        &ConformalCalibrationTruth {
            sample_ids: ids,
            values: input.truth,
        },
    )
    .map_err(|e| e.to_string())
}
