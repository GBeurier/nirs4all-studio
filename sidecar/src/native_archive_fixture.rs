//! Test-only owner producer for the named analytical fixture.
//! The active qualification script invokes this ignored test once; consumers only replay.

use std::{
    error::Error,
    fs,
    path::{Path, PathBuf},
};

use nirs4all::{
    canonical_pls_training_request,
    dag_ml::{BundleId, RunId},
    inspect_methods_archive_v2_predictors,
    io::core::materialize::{
        AssembledDataset, Cell, Column, Frame, IdentityProvenance, Matrix, PartitionBlock,
    },
    n4a::N4aMemoryBudget,
    n4a_native_package::load_native_package_bytes,
    preflight_methods_archive_v2_library, train_dataset_package_methods_archive_v2,
    CanonicalPlsProfile, DatasetPackage, DatasetPackageMethodsArchiveV2Request,
    DatasetPackageMethodsProvider,
};
use serde_json::{json, Value};

const PROFILE: &str = "raw-pls2-affine-multitarget-core-v1";
const LABELS: [&str; 6] = ["row.0", "row.1", "row.2", "row.3", "row.4", "row.5"];
const X: [f64; 12] = [0.0, 0.0, 1.0, 1.0, 2.0, 4.0, 3.0, 9.0, 4.0, 16.0, 5.0, 25.0];
const Y: [f64; 12] = [
    1.0, 12.0, 2.0, 14.0, 1.0, 12.0, -2.0, 6.0, -7.0, -4.0, -14.0, -18.0,
];

fn write_json(path: &Path, value: &Value) -> Result<(), Box<dyn Error>> {
    fs::write(path, serde_json::to_vec_pretty(value)?)?;
    Ok(())
}

#[test]
#[ignore = "creates the named fixture once; requires output directory and attested Methods library"]
#[expect(
    clippy::too_many_lines,
    clippy::default_trait_access,
    reason = "self-contained owner-produced scientific test fixture"
)]
fn produce_raw_pls2_affine_multitarget_core_v1() -> Result<(), Box<dyn Error>> {
    let output_path = PathBuf::from(
        std::env::var_os("N4A_RT_PRED_FIXTURE_OUTPUT")
            .ok_or("N4A_RT_PRED_FIXTURE_OUTPUT must name an absent absolute output directory")?,
    );
    let methods_library = PathBuf::from(
        std::env::var_os("N4A_RT_PRED_METHODS_LIBRARY")
            .ok_or("N4A_RT_PRED_METHODS_LIBRARY must name the selected Methods library")?,
    );
    let methods_digest = std::env::var("N4A_RT_PRED_METHODS_SHA256")?;
    let output = output_path.as_path();
    let methods_path = methods_library.as_path();
    let methods_sha256 = methods_digest.as_str();
    if !output.is_absolute() || !methods_path.is_absolute() {
        return Err("output directory and selected Methods library paths must be absolute".into());
    }
    // Core attests the selected source and owns its immutable runtime snapshot.
    // Training and inspection accept this source path through that same owner;
    // configuring it directly afterward would retarget the process runtime.
    preflight_methods_archive_v2_library(methods_path, methods_sha256)?;
    fs::create_dir(output)?; // Refuse existing destinations, including partial earlier runs.

    let sample_labels: Vec<_> = LABELS
        .iter()
        .map(|label| format!("{PROFILE}.sample.{label}"))
        .collect();
    let observation_labels: Vec<_> = LABELS
        .iter()
        .map(|label| format!("{PROFILE}.observation.{label}"))
        .collect();
    let block = PartitionBlock {
        n_samples: 6,
        source_ids: vec!["features".into()],
        x: vec![Matrix::new(X.to_vec(), 6, 2)],
        feature_headers: vec![vec!["i".into(), "i_squared".into()]],
        header_units: vec!["text".into()],
        signal_types: vec![None],
        processings: vec![vec![]],
        y: Some(Matrix::new(Y.to_vec(), 6, 2)),
        y_headers: vec!["protein".into(), "moisture".into()],
        metadata: Some(Frame::from_columns(
            vec![
                Column::from_cells(
                    "sample_id",
                    sample_labels.iter().cloned().map(Cell::Str).collect(),
                ),
                Column::from_cells(
                    "observation_id",
                    observation_labels.iter().cloned().map(Cell::Str).collect(),
                ),
                Column::from_cells(
                    "fixture_label",
                    LABELS
                        .iter()
                        .map(|label| Cell::Str((*label).into()))
                        .collect(),
                ),
            ],
            "text",
        )),
        ..Default::default()
    };
    let mut assembled = AssembledDataset {
        name: PROFILE.into(),
        task_type: "regression".into(),
        signal_type: String::new(),
        n_sources: 1,
        blocks: Default::default(),
        folds: vec![],
        fold_provenance: vec![],
        repetition: None,
        identity: IdentityProvenance {
            source_ids: vec!["features".into()],
            sample_id: Some("sample_id".into()),
            observation_id: Some("observation_id".into()),
            repetition_id: None,
            group_id: None,
        },
        aggregate: None,
        warnings: vec![],
        audits: vec![],
    };
    assembled.blocks.insert("train".into(), block);
    let dataset = DatasetPackage::from_assembled(&assembled)?;
    let provider = DatasetPackageMethodsProvider::new(&dataset, "features")?;
    let mut request = canonical_pls_training_request(&provider, CanonicalPlsProfile::Raw)?;
    assert_eq!(request.graph.nodes.len(), 1);
    let node = request
        .graph
        .nodes
        .iter_mut()
        .find(|node| node.id.as_str() == "model:pls")
        .ok_or("canonical request omitted model:pls")?;
    // Only this parameter changes on the freshly owner-generated request.
    node.params.insert("n_components".into(), json!(2));
    request.request_fingerprint = request.compute_fingerprint()?;
    request.validate()?;
    let projection = request.project()?;
    assert_eq!(request.options.outputs.len(), 1);
    assert_eq!(
        request.options.outputs[0].target_names,
        ["protein", "moisture"]
    );
    let folds = request
        .campaign
        .split_invocation
        .as_ref()
        .and_then(|split| split.fold_set.as_ref())
        .ok_or("canonical request omitted FoldSet")?;
    assert_eq!(folds.sample_ids.len(), 6);
    assert_eq!(folds.folds.len(), 2);
    for fold in &folds.folds {
        assert_eq!(fold.train_sample_ids.len(), 3);
        assert_eq!(fold.validation_sample_ids.len(), 3);
    }
    let relations = provider.relations();
    assert_eq!(relations.records.len(), LABELS.len());
    let mut label_mapping = Vec::new();
    for (index, label) in LABELS.iter().enumerate() {
        let matched: Vec<_> = relations
            .records
            .iter()
            .filter(|record| {
                record.metadata.get("fixture_label").and_then(Value::as_str) == Some(*label)
            })
            .collect();
        assert_eq!(
            matched.len(),
            1,
            "each input label must map to one owner relation"
        );
        let record = matched[0];
        label_mapping.push(json!({
            "fixture_label": label,
            "input_sample_label": sample_labels[index],
            "input_observation_label": observation_labels[index],
            "owner_sample_id": record.sample_id,
            "owner_observation_id": record.observation_id,
        }));
    }
    write_json(
        &output.join("inputs.json"),
        &json!({
            "profile": PROFILE, "task_type": "regression", "partition": "train",
            "x_row_major": X, "y_row_major": Y, "shape": [6, 2],
            "feature_headers": ["i", "i_squared"], "header_unit": "text",
            "target_names": ["protein", "moisture"], "label_mapping": label_mapping,
            "query": [[1.5, 0.5], [3.5, 1.5]],
            "analytical_expected": [[3.5, 17.0], [6.5, 23.0]], "atol": 1e-9,
            "oracle": "protein = 1 + 2*x0 - x1; moisture = 10 + 2*protein",
        }),
    )?;
    write_json(
        &output.join("request.json"),
        &serde_json::to_value(&request)?,
    )?;
    write_json(
        &output.join("projection.json"),
        &serde_json::to_value(&projection)?,
    )?;
    write_json(
        &output.join("relations.json"),
        &serde_json::to_value(relations)?,
    )?;

    // Exactly one owner training invocation; DAG owns its CV and full-data refit.
    let archive_path = output.join(format!("{PROFILE}.n4a"));
    let produced =
        train_dataset_package_methods_archive_v2(DatasetPackageMethodsArchiveV2Request {
            dataset: &dataset,
            source_id: "features",
            training_request: &request,
            outcome_id: "outcome:studio:raw-pls2-affine-multitarget-core-v1",
            run_id: RunId::new("run:studio:raw-pls2-affine-multitarget-core-v1")?,
            bundle_id: BundleId::new("bundle:studio:raw-pls2-affine-multitarget-core-v1")?,
            package_id: "package:studio:raw-pls2-affine-multitarget-core-v1",
            archive_id: "archive:studio:raw-pls2-affine-multitarget-core-v1",
            archive_path: &archive_path,
            methods_library_path: methods_path,
        })?;
    write_json(
        &output.join("outcome.json"),
        &serde_json::to_value(&produced.training)?,
    )?;
    let bytes = fs::read(&archive_path)?;
    let loaded = load_native_package_bytes(&bytes, None, N4aMemoryBudget::host_allocator())?;
    assert_eq!(
        loaded.reference().archive_sha256(),
        produced.archive.archive_sha256()
    );
    assert_eq!(loaded.manifest().schema_version, 1);
    assert_eq!(loaded.reference().schema_version(), 2);
    let package = loaded.predictor_package()?;
    assert_eq!(package.schema_version, 2);
    assert_eq!(package.output_bindings.len(), 1);
    assert_eq!(
        package.output_bindings[0].target_names,
        ["protein", "moisture"]
    );
    assert_eq!(package.execution_bundle.refit_artifacts.len(), 1);
    let artifact = &package.execution_bundle.refit_artifacts[0].artifact;
    assert_eq!(
        artifact.kind, "n4m_model",
        "N4ME is not this fixture profile"
    );
    let descriptors = inspect_methods_archive_v2_predictors(&loaded, methods_path, methods_sha256)?;
    assert_eq!(descriptors.len(), 1);
    let descriptor = &descriptors[0];
    assert_eq!(
        artifact.native_predictor_descriptor.as_ref(),
        Some(descriptor)
    );
    assert_eq!(descriptor.format, "N4MM");
    assert_eq!(descriptor.dimensions.training_samples, 6);
    assert_eq!(descriptor.dimensions.n_features, 2);
    assert_eq!(descriptor.dimensions.n_targets, 2);
    assert_eq!(descriptor.dimensions.n_components, 2);
    assert!(
        descriptor.pipeline.is_none(),
        "raw profile must not contain SNV/SG"
    );
    let outcome_folds = produced
        .training
        .effective_plan
        .campaign
        .split_invocation
        .as_ref()
        .and_then(|split| split.fold_set.as_ref())
        .ok_or("outcome omitted FoldSet")?;
    assert_eq!(outcome_folds, folds);
    assert_eq!(
        package
            .effective_plan
            .campaign
            .split_invocation
            .as_ref()
            .and_then(|split| split.fold_set.as_ref()),
        Some(outcome_folds)
    );
    for plan in [&produced.training.effective_plan, &package.effective_plan] {
        let node = plan
            .graph_plan
            .graph
            .nodes
            .iter()
            .find(|node| node.id.as_str() == "model:pls")
            .ok_or("owner output omitted model:pls")?;
        assert_eq!(node.params.get("n_components"), Some(&json!(2)));
    }
    fs::write(
        output.join("package.json"),
        loaded.portable_predictor_package()?,
    )?;
    let receipt = json!({
        "profile": PROFILE,
        "owner_training_calls": 1,
        "archive_path": archive_path,
        "archive_sha256": loaded.reference().archive_sha256(),
        "container_schema_version": loaded.manifest().schema_version,
        "package_schema_version": package.schema_version,
        "selected_methods": {
            "path": methods_path, "sha256_verified_by_core": methods_sha256,
            "reported_abi": null,
            "abi_admission": "Core attested preflight and Methods binding compatibility",
            "abi_observation": "Core preflight exposes no runtime ABI value; writer ABI is recorded only in native_descriptor",
        },
        "artifact": artifact,
        "native_descriptor": descriptor,
        "target_names": package.output_bindings[0].target_names,
        "fold_set": outcome_folds,
        "label_mapping": label_mapping,
        "cv_scores": produced.training.score_set,
        "core_admission": loaded.view(),
        "post_production_replay_performed": false,
    });
    write_json(&output.join("receipt.json"), &receipt)?;
    println!("{}", serde_json::to_string(&receipt)?);
    Ok(())
}
