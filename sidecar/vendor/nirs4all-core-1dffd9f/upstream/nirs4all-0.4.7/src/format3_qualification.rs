//! Explicit live-cohort witness, run with --ignored against Methods ABI 2.20.
//! Historical fixtures and the regular published-cohort tests stay unchanged.
use std::collections::BTreeMap;
use std::fs;
use std::path::Path;

use dag_ml_core::{
    build_archive_v3_native_refit_payloads, build_portable_refit_package_v3,
    derive_portable_full_refit_target_plan, execute_portable_full_refit, ArtifactLoadMode,
    BundleId, FittedArtifactMode, PortableFullRefitExecutionInput, PortableRefitPackageV3,
    PortableRefitPackageV3BuildInput, PortableRefitRecipe, RunId, RuntimeControllerRegistry,
    TrainingInfluenceManifest,
};
use serde_json::json;
use sha2::{Digest, Sha256};

use crate::{
    canonical_pls_training_request, load_archive_v2, load_archive_v3,
    load_spectrum_dataset_package, load_spectrum_methods_provider,
    predict_methods_archive_v2_matrix, train_dataset_package_methods_archive_v2, write_archive_v3,
    ArchiveV3WriteRequest, CanonicalPlsProfile, DatasetPackageMethodsArchiveV2Request,
    MethodsArchiveMatrixPredictRequest,
};

fn spectrum(path: &Path, offset: f64) {
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    let mut csv = "sample_id,protein,1100,1150,1200,1250,1300\n".to_owned();
    for row in 0..12 {
        let x = (0..5)
            .map(|column| {
                ((row + 1) as f64 * (column + 1) as f64 * 0.17).sin()
                    + row as f64 * 0.13
                    + column as f64 * 0.21
            })
            .collect::<Vec<_>>();
        let y = 2.0 * x[0] - x[2] + row as f64 * 0.11 + offset;
        csv.push_str(&format!(
            "S{row},{y},{}\n",
            x.iter()
                .map(ToString::to_string)
                .collect::<Vec<_>>()
                .join(",")
        ));
    }
    fs::write(path, csv).unwrap();
}

fn reject_member_tamper(path: &Path, bytes: &[u8], is_v3: bool) {
    let mut archive = fs::read(path).unwrap();
    let offset = archive
        .windows(bytes.len())
        .position(|part| part == bytes)
        .unwrap();
    archive[offset + 4] ^= 1;
    let target = path.with_extension("tampered.n4a");
    fs::write(&target, archive).unwrap();
    if is_v3 {
        assert!(load_archive_v3(&target).is_err());
    } else {
        assert!(load_archive_v2(&target).is_err());
    }
}

#[test]
#[ignore = "explicit live source-cohort gate; requires Methods ABI 2.20 and candidate DAG/n4m"]
fn live_format_three_v2_v3_native_roundtrip_and_replay() {
    let library =
        fs::canonicalize(std::env::var_os("N4M_LIBRARY_PATH").expect("exact native library"))
            .unwrap();
    let directory = std::path::PathBuf::from(
        std::env::var_os("NIRS4ALL_CORE_FORMAT3_ARTIFACTS")
            .expect("persistent qualification artifact directory"),
    );
    fs::create_dir_all(&directory).unwrap();
    let source = directory.join("source/data.csv");
    let target = directory.join("target/data.csv");
    spectrum(&source, 0.0);
    spectrum(&target, 0.75);
    let loaded = load_spectrum_dataset_package(&source).unwrap();
    let provider = load_spectrum_methods_provider(&source).unwrap();
    let target_loaded = load_spectrum_dataset_package(&target).unwrap();
    let target_provider = load_spectrum_methods_provider(&target).unwrap();
    for (name, profile) in [
        ("raw", CanonicalPlsProfile::Raw),
        ("pipeline", CanonicalPlsProfile::SnvSavitzkyGolay),
    ] {
        let request = canonical_pls_training_request(&provider, profile).unwrap();
        let archive_path = directory.join(format!("format3-{name}.n4a"));
        let trained =
            train_dataset_package_methods_archive_v2(DatasetPackageMethodsArchiveV2Request {
                dataset: &loaded.package,
                source_id: &loaded.source_id,
                training_request: &request,
                outcome_id: &format!("outcome:format3.{name}"),
                run_id: RunId::new(format!("run:format3.{name}")).unwrap(),
                bundle_id: BundleId::new(format!("bundle:format3.{name}")).unwrap(),
                package_id: &format!("package:format3.{name}"),
                archive_id: &format!("archive:format3.{name}"),
                archive_path: &archive_path,
                methods_library_path: &library,
            })
            .unwrap();
        let record = &trained.training.execution_bundle.refit_artifacts[0];
        let descriptor = record
            .artifact
            .native_predictor_descriptor
            .as_ref()
            .unwrap();
        assert_eq!(descriptor.format_version, 3);
        assert!(descriptor.writer_abi.minor >= 20);
        assert_eq!(descriptor.pipeline.is_some(), name == "pipeline");
        assert_eq!(record.artifact.abi_min_minor, Some(20));
        let archive = load_archive_v2(&archive_path).unwrap();
        let declaration = &archive.methods_n4mm_artifacts().unwrap()[0];
        assert_eq!(
            (declaration.format_version(), declaration.abi_min_minor()),
            (3, 20)
        );
        let native = &trained.training.execution_bundle.raw_artifact_payloads[&record.artifact.id];
        assert_eq!(archive.member(declaration.member_path()).unwrap(), native);
        let inspected = crate::inspect_methods_archive_v2_predictors(
            &archive,
            &library,
            &format!("{:x}", Sha256::digest(fs::read(&library).unwrap())),
        )
        .unwrap();
        assert_eq!(&inspected[0], descriptor);
        let x = vec![vec![0.5, 1.2, 1.6, 2.1, 2.7], vec![0.9, 1.5, 1.8, 2.6, 3.0]];
        let prediction = predict_methods_archive_v2_matrix(
            &archive,
            MethodsArchiveMatrixPredictRequest {
                sample_ids: vec!["predict.0".into(), "predict.1".into()],
                x: x.clone(),
                expected_target_names: vec!["protein".into()],
                methods_library_path: library.clone(),
                methods_library_sha256: format!(
                    "{:x}",
                    Sha256::digest(fs::read(&library).unwrap())
                ),
                request_id: format!("predict:format3.{name}"),
                outcome_id: format!("outcome:format3.{name}.predict"),
                run_id: RunId::new(format!("run:format3.{name}.predict")).unwrap(),
                warnings: vec![],
                diagnostics: BTreeMap::new(),
            },
        )
        .unwrap();
        let predicted = &prediction.outputs[0].predictions[0].values;
        let context = n4m::Context::new().unwrap();
        let model = n4m::Model::import_n4mm(&context, native).unwrap();
        let flat = x.iter().flatten().copied().collect::<Vec<_>>();
        let direct = model
            .predict(&context, n4m::MatrixRef::row_major(&flat, 2, 5).unwrap())
            .unwrap();
        for (actual, expected) in predicted.iter().flatten().zip(&direct.data) {
            assert!((actual - expected).abs() < 1e-10);
        }
        fs::write(directory.join(format!("format3-{name}.scenario.json")), serde_json::to_vec_pretty(&json!({"x":x,"sample_ids":["predict.0","predict.1"],"target_names":["protein"],"expected":predicted,"pipeline":name=="pipeline"})).unwrap()).unwrap();
        reject_member_tamper(&archive_path, native, false);

        // A fresh target cohort uses the official native full-refit constructor.
        // No V2 bytes are relabelled as a V3 package.
        let parent = trained
            .training
            .to_portable_predictor_package(
                format!("package:format3.{name}.parent"),
                FittedArtifactMode::PortableRequired,
                ArtifactLoadMode::NativePortable,
            )
            .unwrap();
        let recipe =
            PortableRefitRecipe::derive_from_package(&parent, format!("recipe:format3.{name}"))
                .unwrap();
        let target_request = canonical_pls_training_request(&target_provider, profile).unwrap();
        fs::write(
            directory.join(format!("format3-{name}.source-plan.json")),
            serde_json::to_vec_pretty(&parent.effective_plan).unwrap(),
        )
        .unwrap();
        fs::write(
            directory.join(format!("format3-{name}.target-plan.json")),
            serde_json::to_vec_pretty(&target_request.project().unwrap().plan).unwrap(),
        )
        .unwrap();
        let plan =
            derive_portable_full_refit_target_plan(&recipe, &parent, &target_request).unwrap();
        let influence = TrainingInfluenceManifest::derive_for_projection(
            &target_request.project().unwrap(),
            &target_request,
            target_provider.relations(),
        )
        .unwrap();
        let runtime =
            crate::native_methods_replay::configure_methods_runtime_for_source(&library).unwrap();
        let mut controllers = RuntimeControllerRegistry::new();
        dag_ml_core::register_methods_native_controllers(&mut controllers, runtime).unwrap();
        let execution = execute_portable_full_refit(PortableFullRefitExecutionInput {
            recipe: &recipe,
            source_package: &parent,
            target_plan: &plan,
            target_training_request: &target_request,
            target_training_request_fingerprint: target_request.request_fingerprint.clone(),
            target_data_identities: &target_request.data_identities,
            target_training_influence: &influence,
            run_id: RunId::new(format!("run:format3.{name}.child")).unwrap(),
            controllers: &controllers,
            data_provider: &target_provider,
        })
        .unwrap();
        let child = build_portable_refit_package_v3(PortableRefitPackageV3BuildInput {
            package_id: format!("package:format3.{name}.child"),
            outcome_id: format!("outcome:format3.{name}.child"),
            bundle_id: BundleId::new(format!("bundle:format3.{name}.child")).unwrap(),
            recipe: &recipe,
            source_package: &parent,
            target_plan: &plan,
            target_training_request: &target_request,
            target_data_identities: &target_request.data_identities,
            target_training_influence: &influence,
            execution: &execution,
        })
        .unwrap();
        let payloads =
            build_archive_v3_native_refit_payloads(format!("archive:format3.{name}.child"), &child)
                .unwrap();
        let path = directory.join(format!("format3-{name}-v3.n4a"));
        write_archive_v3(
            &path,
            ArchiveV3WriteRequest {
                manifest: payloads.manifest,
                payloads: payloads
                    .members
                    .into_iter()
                    .map(|(path, bytes)| crate::ArchivePayload { path, bytes })
                    .collect(),
            },
        )
        .unwrap();
        let loaded = load_archive_v3(&path).unwrap();
        let restored = PortableRefitPackageV3::from_json(
            std::str::from_utf8(loaded.portable_refit_package().unwrap()).unwrap(),
        )
        .unwrap();
        assert_eq!(restored, child);
        // Reuse Core's closed matrix contract, then bind its request to the
        // newly loaded target outcome through DAG's public fingerprint API.
        let composition = crate::native_methods_replay::compose_methods_archive_matrix_predict(
            &parent,
            MethodsArchiveMatrixPredictRequest {
                sample_ids: vec!["predict.0".into(), "predict.1".into()],
                x: x.clone(),
                expected_target_names: vec!["protein".into()],
                methods_library_path: library.clone(),
                methods_library_sha256: format!(
                    "{:x}",
                    Sha256::digest(fs::read(&library).unwrap())
                ),
                request_id: format!("predict:format3.{name}.v3"),
                outcome_id: format!("outcome:format3.{name}.v3.predict"),
                run_id: RunId::new(format!("run:format3.{name}.v3.predict")).unwrap(),
                warnings: vec![],
                diagnostics: BTreeMap::new(),
            },
        )
        .unwrap();
        let mut replay_input = composition.input;
        replay_input.request.source_outcome_fingerprint = child.outcome.outcome_fingerprint.clone();
        replay_input.request.request_fingerprint =
            replay_input.request.compute_fingerprint().unwrap();
        let replay = crate::replay_methods_archive_v3(
            &loaded,
            crate::MethodsArchiveRefitRequestV3 {
                request: replay_input.request,
                data_envelopes: replay_input.data_envelopes,
                methods_inputs: replay_input.methods_inputs,
                methods_library_path: library.clone(),
                supplemental_controllers: RuntimeControllerRegistry::new(),
                outcome_id: format!("outcome:format3.{name}.v3.replay"),
                run_id: RunId::new(format!("run:format3.{name}.v3.replay")).unwrap(),
                warnings: vec![],
                diagnostics: BTreeMap::new(),
            },
        )
        .unwrap();
        let child_record = &child.outcome.execution_bundle.refit_artifacts[0];
        let child_native =
            &child.outcome.execution_bundle.raw_artifact_payloads[&child_record.artifact.id];
        let child_model = n4m::Model::import_n4mm(&context, child_native).unwrap();
        let child_expected = child_model
            .predict(&context, n4m::MatrixRef::row_major(&flat, 2, 5).unwrap())
            .unwrap();
        let child_actual = &replay.outputs[0].predictions[0].values;
        for (actual, expected) in child_actual.iter().flatten().zip(&child_expected.data) {
            assert!((actual - expected).abs() < 1e-10);
        }

        for record in &child.outcome.execution_bundle.refit_artifacts {
            let bytes = &child.outcome.execution_bundle.raw_artifact_payloads[&record.artifact.id];
            let descriptor = record
                .artifact
                .native_predictor_descriptor
                .as_ref()
                .unwrap();
            assert_eq!(
                (descriptor.format_version, record.artifact.abi_min_minor),
                (3, Some(20))
            );
            assert_eq!(
                loaded
                    .member(record.artifact.uri.as_deref().unwrap())
                    .unwrap(),
                bytes
            );
            assert_ne!(
                bytes, native,
                "fresh target full refit must not reuse parent model bytes"
            );
            reject_member_tamper(&path, bytes, true);
        }
        assert_eq!(target_loaded.source_id, target_provider.source_id());
    }
}
