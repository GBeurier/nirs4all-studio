//! Public bounded HPO over the native DAG scheduler and Methods optimizer.
//! Native package loading owns checkpoint provenance and completed-trial reuse.

use crate::io_training::{
    train_dataset_package_methods_archive_v2, DatasetPackage,
    DatasetPackageMethodsArchiveV2Outcome, DatasetPackageMethodsArchiveV2Request,
};
use crate::workflow::{dense_regression_training_request, DenseRegressionPreprocessing};
use dag_ml_core::{GenerationSpec, HpoSampler, RegressionMetricKind, TrainingRequest};
use sha2::{Digest, Sha256};
use std::{collections::BTreeMap, path::Path};

/// A total trial budget, including terminal trials in a resumed native study.
pub struct DenseTuningRequest<'a> {
    pub dataset: &'a DatasetPackage,
    pub source_id: &'a str,
    pub trials: u32,
    pub seed: u64,
    pub sampler: HpoSampler,
    pub metric: RegressionMetricKind,
    pub methods_library_path: &'a Path,
    pub checkpoint_archive: Option<&'a Path>,
    pub archive_path: &'a Path,
    pub run_id: &'a str,
}

/// Compile user options into a native Methods HPO request; no trial loop lives here.
pub fn dense_tuning_training_request(
    input: &DenseTuningRequest<'_>,
) -> Result<TrainingRequest, String> {
    if input.trials == 0 || input.trials > 256 {
        return Err("trials must be a total budget between 1 and 256".into());
    }
    if !matches!(
        input.sampler,
        HpoSampler::Random | HpoSampler::Tpe | HpoSampler::Sobol | HpoSampler::Lhs
    ) {
        return Err("this integer PLS study supports random, tpe, sobol or lhs samplers".into());
    }
    let mut request = dense_regression_training_request(
        input.dataset,
        input.source_id,
        &[1, 2],
        DenseRegressionPreprocessing::SnvSavitzkyGolay,
    )?;
    request.campaign.generation = GenerationSpec::default();
    let library_bytes =
        std::fs::read(input.methods_library_path).map_err(|error| error.to_string())?;
    let library_identity = format!("n4m:sha256:{:x}", Sha256::digest(library_bytes));
    let checkpoint = input
        .checkpoint_archive
        .map(|path| {
            let archive = crate::load_archive_v2(path).map_err(|error| error.to_string())?;
            let bytes = archive
                .portable_predictor_package()
                .map_err(|error| error.to_string())?;
            let text = std::str::from_utf8(bytes).map_err(|error| error.to_string())?;
            let package = dag_ml_core::PortablePredictorPackage::from_json(text)
                .map_err(|error| error.to_string())?;
            dag_ml_core::validate_archive_v2_portable_payloads(
                archive.manifest(),
                &package,
                archive.members(),
            )
            .map_err(|error| error.to_string())?;
            Ok::<String, String>(text.to_owned())
        })
        .transpose()?;
    let mut raw = serde_json::to_value(&request).map_err(|error| error.to_string())?;
    let role_params = BTreeMap::from([
        (
            "native_profile".into(),
            serde_json::json!("n4m.pls_role_pipeline.v1"),
        ),
        ("n_components".into(), serde_json::json!(1)),
        ("scale".into(), serde_json::json!(false)),
        (
            "pipeline".into(),
            serde_json::json!({"schema_version":1,"pipeline_type":"n4m.snv_savgol_smooth.v1","savgol_window":5,"savgol_poly_degree":2}),
        ),
    ]);
    let contract = dag_ml_core::methods_pls_role_pipeline_contract(&role_params)
        .map_err(|error| error.to_string())?;
    raw["graph"]["nodes"][0]["params"] =
        serde_json::to_value(&role_params).map_err(|error| error.to_string())?;
    raw["graph"]["nodes"][0]["operator"] = contract["operator"].clone();
    raw["controller_manifests"] = serde_json::json!([contract["manifest"].clone()]);
    raw["campaign"]["root_seed"] = input.seed.into();
    raw["options"]["seed"] = input.seed.into();
    raw["options"]["selection"]["metric"] = serde_json::json!({"name": input.metric.name(), "objective": if matches!(input.metric, RegressionMetricKind::R2) {"maximize"} else {"minimize"}});
    request = serde_json::from_value(raw).map_err(|error| error.to_string())?;
    request.campaign.metadata.insert("methods_hpo_operation".into(), serde_json::json!({
        "schema_version": 2, "native_profile":"n4m.pls_role_pipeline.v1", "operation_id": "tuning:pls-components", "target_node_id": "model:pls",
        "parameter_paths": BTreeMap::from([("n_components", "n_components"), ("scale", "scale")]), "trials": input.trials,
        "resume_package_json": checkpoint,
        "study": {"controller_id": "methods:public-hpo", "study_id": "study:public-pls", "methods_abi": library_identity,
            "search_space": {"parameters": [{"kind": "int", "name": "n_components", "low": 1, "high": 3, "step": 1, "log": false},
                {"kind":"categorical", "name":"scale", "values":[false,true]}]},
            "optimizer": {"sampler": input.sampler, "pruner": "none", "direction": if matches!(input.metric, RegressionMetricKind::R2) {"maximize"} else {"minimize"},
                "metric": input.metric.name(), "seed": input.seed, "n_startup_trials": 2, "max_resource": 0, "reduction_factor": 0}
        }
    }));
    request.request_fingerprint = request
        .compute_fingerprint()
        .map_err(|error| error.to_string())?;
    request.validate().map_err(|error| error.to_string())?;
    Ok(request)
}

/// Run or resume native CV HPO, select the winner and export its full-data refit.
pub fn run_dense_tuning(
    input: DenseTuningRequest<'_>,
) -> Result<DatasetPackageMethodsArchiveV2Outcome, String> {
    crate::workflow::preflight_workflow_archive_path(input.archive_path)?;
    let request = dense_tuning_training_request(&input)?;
    train_dataset_package_methods_archive_v2(DatasetPackageMethodsArchiveV2Request {
        dataset: input.dataset,
        source_id: input.source_id,
        training_request: &request,
        methods_library_path: input.methods_library_path,
        archive_path: input.archive_path,
        outcome_id: &format!("outcome:{}", input.run_id),
        run_id: dag_ml_core::RunId::new(input.run_id).map_err(|error| error.to_string())?,
        bundle_id: dag_ml_core::BundleId::new(format!("bundle:{}", input.run_id))
            .map_err(|error| error.to_string())?,
        package_id: &format!("package:{}", input.run_id),
        archive_id: &format!("archive:{}", input.run_id),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn public_hpo_request_retains_signed_io_authority_and_native_search_identity() {
        let library = std::env::var("N4M_LIBRARY_PATH").expect("exact Methods library");
        let raw = crate::test_fixture::dense_training_record();
        let dataset =
            nirs4all_io_crate::core::public_dataset::dense_dataset_package(&raw, "spectra")
                .unwrap();
        let directory = tempfile::tempdir().unwrap();
        let destination = directory.path().join("model.n4a");
        let input = DenseTuningRequest {
            dataset: &dataset,
            source_id: "spectra",
            trials: 4,
            seed: 91,
            sampler: HpoSampler::Random,
            metric: RegressionMetricKind::Rmse,
            methods_library_path: Path::new(&library),
            checkpoint_archive: None,
            archive_path: &destination,
            run_id: "run:rust:hpo:contract",
        };
        let request = dense_tuning_training_request(&input).unwrap();
        request.validate().unwrap();
        assert_eq!(
            request.request_fingerprint,
            request.compute_fingerprint().unwrap()
        );
        assert!(request.campaign.metadata.contains_key("raw_source_schema"));
        let operation = &request.campaign.metadata["methods_hpo_operation"];
        assert_eq!(operation["trials"], 4);
        assert_eq!(
            operation["study"]["search_space"]["parameters"]
                .as_array()
                .unwrap()
                .len(),
            2
        );
        assert_eq!(operation["study"]["optimizer"]["seed"], 91);
        assert!(operation["study"]["methods_abi"]
            .as_str()
            .unwrap()
            .starts_with("n4m:sha256:"));
        assert!(!destination.exists());

        for partition in ["test", "predict"] {
            let mut mixed = raw.clone();
            mixed["dataset"]["partitions"]["dtype"] = "<U7".into();
            for value in mixed["dataset"]["partitions"]["values"]
                .as_array_mut()
                .unwrap()
                .iter_mut()
                .skip(8)
            {
                *value = serde_json::json!(partition);
            }
            let package =
                nirs4all_io_crate::core::public_dataset::dense_dataset_package(&mixed, "spectra")
                    .unwrap();
            let mixed_input = DenseTuningRequest {
                dataset: &package,
                ..input
            };
            let error = dense_tuning_training_request(&mixed_input).unwrap_err();
            assert!(error.contains("only train partition"), "{error}");
            assert!(
                !destination.exists(),
                "partition refusal must happen before native FIT/publication"
            );
            eprintln!("native HPO {partition} partition refused before FIT");
        }
    }
}
