use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use nirs4all::dag_ml::{BundleId, RunId};
use nirs4all::{
    canonical_pls_training_request, formats, load_archive_v2, load_spectrum_dataset_package,
    load_spectrum_methods_provider, predict_methods_archive_v2_matrix,
    preflight_methods_archive_v2_library, train_dataset_package_methods_archive_v2,
    CanonicalPlsProfile, DatasetPackageMethodsArchiveV2Request, FormatsIoError,
    MethodsArchiveMatrixPredictRequest,
};
use sha2::{Digest, Sha256};

fn sha256(path: &Path) -> String {
    let bytes = fs::read(path).expect("read exact Methods library");
    format!("{:x}", Sha256::digest(bytes))
}

#[test]
fn real_delimited_format_reaches_io_package_and_core_provider() {
    let directory = tempfile::tempdir().expect("temporary fixture directory");
    let path = directory.path().join("tiny_nirs.csv");
    fs::write(
        &path,
        concat!(
            "sample_id,protein,1100.0,1200.0,1300.0\n",
            "S001,10.1,0.10,0.20,0.30\n",
            "S002,11.2,0.15,0.25,0.35\n",
            "S003,12.3,0.20,0.30,0.40\n",
        ),
    )
    .expect("write real delimited-text fixture");

    let parsed = formats::open_path(&path).expect("Formats parses the fixture");
    assert_eq!(parsed.len(), 3);
    assert_eq!(parsed[0].provenance.format, "delimited-text");

    let loaded = load_spectrum_dataset_package(&path).expect("Formats records assemble through IO");
    assert_eq!(loaded.format, "delimited-text");
    assert_eq!(loaded.record_count, 3);
    assert!(!loaded.package.row_position_fallback.used);
    assert_eq!(
        loaded.package.identity.sample_id.as_deref(),
        Some("sample_id")
    );
    let partition = loaded
        .package
        .partitions
        .get("train")
        .expect("train partition");
    assert_eq!(partition.n_samples, 3);
    assert_eq!(
        partition.source_ids.as_slice(),
        std::slice::from_ref(&loaded.source_id)
    );

    let provider = load_spectrum_methods_provider(&path).expect("IO package reaches Core provider");
    assert_eq!(provider.source_id(), loaded.source_id);
    assert_eq!(provider.relations().records.len(), 3);
}

#[test]
fn unsupported_format_refuses_without_fallback() {
    let directory = tempfile::tempdir().expect("temporary fixture directory");
    let path = directory.path().join("not-a-spectrum.bin");
    fs::write(&path, b"not a supported spectral format").expect("write refusal fixture");

    let error = load_spectrum_dataset_package(&path).expect_err("unknown format must fail closed");
    assert!(matches!(
        error,
        FormatsIoError::Format(formats::Error::UnsupportedFormat { .. })
    ));
}

#[test]
fn real_spectrum_file_trains_archive_reloads_and_fresh_predicts() {
    let library = std::env::var_os("N4M_LIBRARY_PATH")
        .map(PathBuf::from)
        .expect("N4M_LIBRARY_PATH must name the exact ABI 2.5 libn4m");
    let library_sha256 = sha256(&library);
    preflight_methods_archive_v2_library(&library, &library_sha256)
        .expect("exact Methods ABI 2.5 library passes Core preflight");

    let directory = tempfile::tempdir().expect("temporary E2E directory");
    let spectrum_path = directory.path().join("canonical_raw_pls.csv");
    fs::write(
        &spectrum_path,
        concat!(
            "sample_id,protein,1100.0,1150.0,1200.0,1250.0,1300.0\n",
            "S001,3.1,1.0,1.8,3.2,4.1,5.3\n",
            "S002,5.2,1.4,2.7,3.0,4.8,5.1\n",
            "S003,7.3,1.9,2.2,3.8,4.4,5.9\n",
            "S004,9.4,2.3,3.1,3.6,5.2,5.6\n",
            "S005,11.5,2.8,3.5,4.7,5.0,6.4\n",
            "S006,13.6,3.2,4.4,4.2,5.9,6.1\n",
            "S007,15.7,3.7,3.9,5.3,5.5,7.0\n",
            "S008,17.8,4.1,4.8,4.9,6.3,6.7\n",
        ),
    )
    .expect("write real supported spectrum file");
    let archive_path = directory.path().join("canonical_raw_pls.n4a");

    {
        let loaded = load_spectrum_dataset_package(&spectrum_path)
            .expect("Formats parses and IO assembles the spectrum file");
        let provider = load_spectrum_methods_provider(&spectrum_path)
            .expect("IO DatasetPackage reaches the Core data provider");
        let training_request =
            canonical_pls_training_request(&provider, CanonicalPlsProfile::SnvSavitzkyGolay)
                .expect("bounded canonical PLS request composes from provider identities");
        drop(provider);
        let trained =
            train_dataset_package_methods_archive_v2(DatasetPackageMethodsArchiveV2Request {
                dataset: &loaded.package,
                source_id: &loaded.source_id,
                training_request: &training_request,
                outcome_id: "outcome:core001:e2e",
                run_id: RunId::new("run:core001:e2e:train").expect("valid run id"),
                bundle_id: BundleId::new("bundle:core001:e2e").expect("valid bundle id"),
                package_id: "predictor:core001:e2e",
                archive_id: "archive:core001:e2e",
                archive_path: &archive_path,
                methods_library_path: &library,
            })
            .expect("DAG and Methods train canonical PLS and persist Archive V2");
        assert_eq!(trained.training.execution_bundle.refit_artifacts.len(), 1);
        let descriptor = trained.training.execution_bundle.refit_artifacts[0]
            .artifact
            .native_predictor_descriptor
            .as_ref()
            .expect("portable native predictor descriptor");
        assert_eq!(descriptor.format_version, 2);
        assert!(descriptor.pipeline.is_some());
    }

    let archive = load_archive_v2(&archive_path).expect("fresh Archive V2 reload");
    let predicted = predict_methods_archive_v2_matrix(
        &archive,
        MethodsArchiveMatrixPredictRequest {
            sample_ids: vec!["fresh:1".into(), "fresh:2".into()],
            x: vec![vec![4.5, 5.1, 5.7, 6.8, 7.2], vec![4.9, 5.7, 5.4, 7.1, 7.6]],
            expected_target_names: vec!["protein".into()],
            methods_library_path: library,
            methods_library_sha256: library_sha256,
            request_id: "predict:core001:e2e".into(),
            outcome_id: "outcome:core001:e2e:fresh".into(),
            run_id: RunId::new("run:core001:e2e:fresh").expect("valid run id"),
            warnings: vec![],
            diagnostics: BTreeMap::new(),
        },
    )
    .expect("fresh process-style replay predicts from reloaded Archive V2");
    let values = &predicted.outputs[0].predictions[0].values;
    assert_eq!(values.len(), 2);
    assert!(values
        .iter()
        .all(|row| row.len() == 1 && row[0].is_finite()));
}
