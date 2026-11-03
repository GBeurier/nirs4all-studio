//! Thin public calibration over DAG-ML's authenticated replay and kernels.

use std::collections::BTreeMap;
use std::path::Path;

use dag_ml_core::{
    build_archive_v2_native_portable_payloads,
    calibrate_attached_training_replay_with_derived_context, execute_attached_training_replay,
    ArtifactLoadMode, AttachedTrainingReplayInput, ConformalMultiTargetPolicy,
    ConformalSmallSamplePolicy, FittedArtifactMode, InMemoryArtifactStore, MethodsPlsController,
    Phase, PortablePredictorPackage, RunId, RuntimeControllerRegistry, TrainingOutcome,
    TrainingReplayRequest, TRAINING_REPLAY_REQUEST_SCHEMA_VERSION,
};
use serde_json::{json, Value};

use crate::io_training::{DatasetPackage, DatasetPackageMethodsProvider};
use crate::native_methods_replay::configure_methods_runtime_for_source;
use crate::{
    load_archive_v2, write_archive_v2, ArchivePayload, ArchiveV2WriteRequest, LoadedArchiveV2,
};

/// Structured cohorts retain IO schema/physical identity; positional inputs
/// explicitly supply only matrix columns and sample identities.
pub enum UncertaintyCohortInput<'a> {
    Dataset {
        record: &'a Value,
        source_id: Option<&'a str>,
    },
    Positional {
        x: &'a [Vec<f64>],
        sample_ids: &'a [String],
    },
}

pub struct ResolvedUncertaintyCohort {
    pub sample_ids: Vec<String>,
    pub x: Vec<Vec<f64>>,
    pub source_id: String,
    pub diagnostics: BTreeMap<String, Value>,
    pub dataset_package: Option<DatasetPackage>,
}

fn uncertainty_package(archive: &LoadedArchiveV2) -> Result<PortablePredictorPackage, String> {
    let pkg = PortablePredictorPackage::from_json(
        std::str::from_utf8(
            archive
                .portable_predictor_package()
                .map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    dag_ml_core::validate_archive_v2_portable_payloads(archive.manifest(), &pkg, archive.members())
        .map_err(|e| e.to_string())?;
    Ok(pkg)
}

/// Resolve one independent cohort before native uncertainty replay and sealing.
pub fn resolve_uncertainty_cohort(
    archive: &LoadedArchiveV2,
    input: UncertaintyCohortInput<'_>,
) -> Result<ResolvedUncertaintyCohort, String> {
    let pkg = uncertainty_package(archive)?;
    let bindings: Vec<_> = pkg
        .template
        .campaign
        .data_bindings
        .values()
        .flatten()
        .collect();
    let [binding] = bindings.as_slice() else {
        return Err("uncertainty requires one source binding".into());
    };
    let [source_id] = binding.source_ids.as_slice() else {
        return Err("uncertainty requires one selected source".into());
    };
    let [output] = pkg.output_bindings.as_slice() else {
        return Err("uncertainty requires one output".into());
    };
    if output.target_names.len() != 1 {
        return Err("uncertainty requires one numeric target".into());
    }
    let source_id = source_id.to_string();
    let (sample_ids, x, relations, dataset_package, diagnostics) = match input {
        UncertaintyCohortInput::Dataset {
            record,
            source_id: requested,
        } => {
            if requested.is_some_and(|requested| requested != source_id) {
                return Err("uncertainty source differs from the frozen predictor".into());
            }
            let normalized = nirs4all_io_crate::core::public_dataset::normalize_dataset(record)?;
            let raw = &normalized["dataset"];
            if !raw["groups"].is_null()
                || normalized["origin_ids"] != raw["sample_ids"]
                || raw.get("independent_unit_ids").is_some()
                || raw.get("repetition_ids").is_some()
            {
                return Err("uncertainty requires independent physical samples without groups, origin aliases or declared experimental units/repetitions".into());
            }
            let expected = pkg
                .template
                .campaign
                .metadata
                .get("raw_source_schema")
                .ok_or("structured uncertainty requires an archived input schema")?;
            let schema = nirs4all_io_crate::core::public_dataset::public_source_schema(
                &normalized,
                &source_id,
            )?;
            if nirs4all_io_crate::core::public_dataset::canonical_content_bytes(&schema)?
                != nirs4all_io_crate::core::public_dataset::canonical_content_bytes(expected)?
            {
                return Err("uncertainty source schema differs from the frozen predictor".into());
            }
            // IO enforces numeric rank-2, complete presence and storage limits.
            let dataset = nirs4all_io_crate::core::public_dataset::dense_dataset_package(
                &normalized,
                &source_id,
            )?;
            let provider =
                nirs4all_io_dagml::PackageProvider::from_package_source(&dataset, &source_id)
                    .map_err(|e| e.to_string())?;
            let relations = crate::io_training::convert_relations(
                provider
                    .envelope()
                    .coordinator_relations
                    .as_ref()
                    .ok_or("uncertainty requires IO sample relations")?,
            )?;
            let source = raw["sources"]
                .as_array()
                .ok_or("uncertainty sources missing")?
                .iter()
                .find(|source| source["name"] == source_id)
                .ok_or("uncertainty source missing")?;
            let ids: Vec<String> =
                serde_json::from_value(raw["sample_ids"].clone()).map_err(|e| e.to_string())?;
            let x: Vec<Vec<f64>> = serde_json::from_value(source["array"]["values"].clone())
                .map_err(|e| e.to_string())?;
            (
                ids,
                x,
                relations,
                Some(dataset),
                BTreeMap::from([
                    (
                        "uncertainty_input_contract".into(),
                        json!("nirs4all.dataset.v1"),
                    ),
                    (
                        "uncertainty_schema_validation".into(),
                        json!("io_source_schema"),
                    ),
                    (
                        "uncertainty_physical_identity_validation".into(),
                        json!("independent_physical_samples"),
                    ),
                ]),
            )
        }
        UncertaintyCohortInput::Positional { x, sample_ids } => {
            let relations =
                serde_json::from_value(json!({"records": sample_ids.iter().map(|id| json!({
                "observation_id": id, "sample_id": id, "source_id": source_id,
                "group_id": null, "origin_sample_id": null, "is_augmented": false,
            })).collect::<Vec<_>>()}))
                .map_err(|e| e.to_string())?;
            (
                sample_ids.to_vec(),
                x.to_vec(),
                relations,
                None,
                BTreeMap::from([
                    ("uncertainty_input_contract".into(), json!("positional_matrix")),
                    ("uncertainty_schema_validation".into(), json!("unavailable")),
                    ("uncertainty_physical_identity_validation".into(), json!("sample_ids_only")),
                    ("uncertainty_limitations".into(), json!("Column order, axes and units are caller responsibilities; undeclared groups, origins and experimental units cannot be checked")),
                ]),
            )
        }
    };
    if x.is_empty()
        || x[0].is_empty()
        || x.len() != sample_ids.len()
        || x.iter()
            .any(|row| row.len() != x[0].len() || row.iter().any(|v| !v.is_finite()))
    {
        return Err("uncertainty requires a finite rectangular X aligned to identities".into());
    }
    dag_ml_core::public_robustness::validate_independent_uncertainty_cohort(&pkg, &relations)
        .map_err(|e| e.to_string())?;
    Ok(ResolvedUncertaintyCohort {
        sample_ids,
        x,
        source_id,
        diagnostics,
        dataset_package,
    })
}

/// Calibrate the archived winner on a distinct target-bound IO cohort; no FIT.
pub struct CalibrateArchiveRequest<'a> {
    pub model_archive: &'a Path,
    pub calibration_record: &'a Value,
    pub source_id: Option<&'a str>,
    pub methods_library_path: &'a Path,
    pub archive_path: &'a Path,
    pub run_id: &'a str,
    pub coverages: Vec<f64>,
    pub small_sample_policy: ConformalSmallSamplePolicy,
}

pub fn calibrate_archive(input: CalibrateArchiveRequest<'_>) -> Result<Value, String> {
    crate::workflow::preflight_workflow_archive_path(input.archive_path)?;
    let archive = load_archive_v2(input.model_archive).map_err(|e| e.to_string())?;
    let pkg = PortablePredictorPackage::from_json(
        std::str::from_utf8(
            archive
                .portable_predictor_package()
                .map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    dag_ml_core::validate_archive_v2_portable_payloads(archive.manifest(), &pkg, archive.members())
        .map_err(|e| e.to_string())?;
    let mut training = TrainingOutcome::from_json(
        std::str::from_utf8(
            archive
                .member("dagml/training_outcome.json")
                .map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    if training.outcome_fingerprint != pkg.training_outcome.outcome_fingerprint {
        return Err("training outcome differs from archived package".into());
    }
    if pkg.conformal_calibration.is_some() {
        return Err(
            "archive is already calibrated; calibrate the original frozen predictor".into(),
        );
    }
    let cohort = resolve_uncertainty_cohort(
        &archive,
        UncertaintyCohortInput::Dataset {
            record: input.calibration_record,
            source_id: input.source_id,
        },
    )?;
    let calibration_dataset = cohort
        .dataset_package
        .as_ref()
        .ok_or("calibration requires an IO dataset")?;
    let [requirement] = training.execution_bundle.data_requirements.as_slice() else {
        return Err("calibration supports one data requirement".into());
    };
    let [binding] = training.outputs.as_slice() else {
        return Err("calibration supports one output binding".into());
    };
    let binding_id = binding.binding.binding_id.clone();
    let mut provider = DatasetPackageMethodsProvider::new(calibration_dataset, &cohort.source_id)?;
    if provider.relations().records.iter().any(|record| {
        record
            .group_id
            .as_ref()
            .is_some_and(|id| id.as_str() != record.sample_id.as_str())
            || record
                .origin_sample_id
                .as_ref()
                .is_some_and(|id| id != &record.sample_id)
            || record.is_augmented
    }) {
        return Err("this bounded calibrator requires independent physical samples without groups, origins or augmentation".into());
    }
    provider.bind_replay_requirement(requirement)?;
    let envelopes = BTreeMap::from([(requirement.key(), provider.external_envelope().clone())]);
    let mut request = TrainingReplayRequest {
        schema_version: TRAINING_REPLAY_REQUEST_SCHEMA_VERSION,
        request_id: format!("calibrate:{}", input.run_id),
        source_outcome_fingerprint: training.outcome_fingerprint.clone(),
        phase: Phase::Predict,
        data_envelope_keys: vec![requirement.key()],
        output_binding_ids: vec![binding_id.clone()],
        request_fingerprint: String::new(),
    };
    request.request_fingerprint = request.compute_fingerprint().map_err(|e| e.to_string())?;
    let runtime = configure_methods_runtime_for_source(input.methods_library_path)
        .map_err(|e| e.to_string())?;
    let mut controllers = RuntimeControllerRegistry::new();
    controllers
        .register(Box::new(MethodsPlsController::new(runtime.clone())))
        .map_err(|e| e.to_string())?;
    if pkg.execution_bundle.methods_hpo_resume_state.is_some() {
        controllers
            .register(Box::new(
                dag_ml_core::MethodsNativeRegressionController::new(runtime),
            ))
            .map_err(|e| e.to_string())?;
    }
    let artifacts = InMemoryArtifactStore::new();
    let replay = execute_attached_training_replay(AttachedTrainingReplayInput {
        source: &training,
        request: &request,
        outcome_id: format!("outcome:{}", input.run_id),
        run_id: RunId::new(input.run_id).map_err(|e| e.to_string())?,
        controllers: &controllers,
        data_provider: &provider,
        artifact_store: &artifacts,
        data_envelopes: &envelopes,
        warnings: vec![],
        diagnostics: cohort.diagnostics,
    })
    .map_err(|e| e.to_string())?;
    let truth = provider.conformal_truth(&replay, &binding_id)?;
    let calibration = calibrate_attached_training_replay_with_derived_context(
        &mut training,
        &replay,
        &binding_id,
        provider.relations(),
        truth,
        input.coverages,
        ConformalMultiTargetPolicy::Marginal,
        input.small_sample_policy,
    )
    .map_err(|e| e.to_string())?;
    let package = training
        .to_portable_predictor_package(
            format!("package:{}", input.run_id),
            FittedArtifactMode::PortableRequired,
            ArtifactLoadMode::NativePortable,
        )
        .map_err(|e| e.to_string())?;
    let payloads = build_archive_v2_native_portable_payloads(
        format!("archive:{}", input.run_id),
        &training,
        &package,
    )
    .map_err(|e| e.to_string())?;
    let reference = write_archive_v2(
        input.archive_path,
        ArchiveV2WriteRequest {
            manifest: payloads.manifest,
            payloads: payloads
                .members
                .into_iter()
                .map(|(path, bytes)| ArchivePayload { path, bytes })
                .collect(),
        },
    )
    .map_err(|e| e.to_string())?;
    Ok(
        json!({"schema": "nirs4all.calibrated.v1", "calibration": calibration,
        "calibration_replay": replay, "archive_sha256": reference.archive_sha256(),
        "model_archive": input.archive_path, "training_outcome": training}),
    )
}

pub use crate::conformal_json::{
    calibrate_workflow_replay_json, calibrated_prediction_json, conformal_metrics_json,
};
