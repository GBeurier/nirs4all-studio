use nirs4all_io_core::public_dataset::{
    canonical_content_bytes, dataset_content_bytes, dense_dataset_package,
    multimodal_runtime_input, normalize_dataset, public_source_schema, u07_sources,
};
use serde_json::{json, Value};
fn input() -> Value {
    json!({"schema":"nirs4all.dataset.v1","schema_version":1,"origin_ids":["a","b","c","d"],"fold_ids":["0","0","1","1"],"dataset":{"schema":"nirs4all.multimodal-dataset","schema_version":1,"name":"public","sample_ids":["a","b","c","d"],"source_alignment":"strict","sources":[{"name":"spectra","sample_ids":["d","c","b","a"],"representation_id":"signal_1d","axes":["sample","wavelength"],"feature_names":null,"axis_units":{"wavelength":"nm"},"axis_coordinates":{"wavelength":[900,1000]},"array":{"dtype":"float64","shape":[4,2],"values":[[7.0,8.0],[5.0,6.0],[3.0,4.0],[1.0,2.0]]}}],"y":{"dtype":"float64","shape":[4],"values":[1.0,2.0,3.0,4.0]},"groups":null,"partitions":{"dtype":"<U5","shape":[4],"values":["train","train","train","train"]}}})
}
#[test]
fn aligns_by_identity_and_preserves_folds_in_existing_package() {
    let normalized = normalize_dataset(&input()).unwrap();
    assert_eq!(
        normalized["dataset"]["sources"][0]["array"]["values"][0],
        json!([1.0, 2.0])
    );
    let package = dense_dataset_package(&input(), "spectra").unwrap();
    let assembled = package.to_assembled();
    assert_eq!(
        assembled.blocks["train"].x[0].data,
        vec![1., 2., 3., 4., 5., 6., 7., 8.]
    );
    assert_eq!(assembled.fold_provenance.len(), 2);
    assert_eq!(
        assembled.fold_provenance[0].validation_observation_ids,
        vec!["a", "b"]
    );
}
#[test]
fn origin_group_and_axis_failures_are_closed() {
    let mut value = input();
    value["origin_ids"][2] = json!("a");
    assert!(normalize_dataset(&value).unwrap_err().contains("origin"));
    let mut value = input();
    value["dataset"]["groups"] = json!({"dtype":"<U1","shape":[4],"values":["x","y","x","z"]});
    assert!(normalize_dataset(&value).unwrap_err().contains("group"));
    let mut value = input();
    value["dataset"]["sources"][0]["axes"] = json!(["sample", "feature"]);
    assert!(normalize_dataset(&value).is_err());
}
#[test]
fn missing_rows_require_explicit_left_alignment() {
    let mut value = input();
    let source = &mut value["dataset"]["sources"][0];
    source["sample_ids"] = json!(["a"]);
    source["array"]["shape"][0] = json!(1);
    source["array"]["values"] = json!([[1., 2.]]);
    assert!(normalize_dataset(&value).is_err());
    value["dataset"]["source_alignment"] = json!("left");
    let normalized = normalize_dataset(&value).unwrap();
    assert_eq!(
        normalized["dataset"]["sources"][0]["presence_mask"]["values"],
        json!([true, false, false, false])
    );
    assert!(dense_dataset_package(&value, "spectra").is_err());
}

#[test]
fn unknown_units_are_equivalent_and_float32_values_follow_declared_storage() {
    let mut omitted = input();
    omitted["dataset"]["sources"][0]["axis_units"] = json!({});
    let mut explicit = omitted.clone();
    explicit["dataset"]["sources"][0]["axis_units"] = json!({"wavelength":null});
    assert_eq!(
        public_source_schema(&omitted, "spectra").unwrap(),
        public_source_schema(&explicit, "spectra").unwrap()
    );
    assert_ne!(
        public_source_schema(&input(), "spectra").unwrap(),
        public_source_schema(&omitted, "spectra").unwrap()
    );
    explicit["dataset"]["sources"][0]["array"]["dtype"] = json!("float32");
    explicit["dataset"]["sources"][0]["array"]["values"][0][0] = json!(1.234567891);
    let normalized = normalize_dataset(&explicit).unwrap();
    assert_eq!(
        normalized["dataset"]["sources"][0]["array"]["values"][3][0],
        json!(1.234567891_f64 as f32 as f64)
    );
}

#[test]
fn unsafe_integer_coordinates_fail_before_transport() {
    let mut value = input();
    value["dataset"]["sources"][0]["axis_coordinates"]["wavelength"] =
        json!([9_007_199_254_740_992_u64, 9_007_199_254_740_994_u64]);
    assert!(normalize_dataset(&value)
        .unwrap_err()
        .contains("exactly representable"));
}

#[test]
fn content_bytes_match_shared_unicode_and_numeric_golden() {
    use sha2::{Digest, Sha256};
    let golden: Value = serde_json::from_str(include_str!(
        "../../../tests/fixtures/public-content-v1.json"
    ))
    .unwrap();
    let bytes = canonical_content_bytes(&golden["input"]).unwrap();
    assert_eq!(
        String::from_utf8(bytes.clone()).unwrap(),
        golden["canonical_content_utf8"]
    );
    assert_eq!(format!("{:x}", Sha256::digest(bytes)), golden["sha256"]);
    assert_eq!(
        canonical_content_bytes(&json!([0, 1, 1000])).unwrap(),
        canonical_content_bytes(&json!([-0.0, 1.0, 1e3])).unwrap()
    );
}

#[test]
fn portable_validators_do_not_infer_from_invalid_declarations() {
    let mut value = input();
    value["dataset"]["source_alignment"] = Value::Null;
    assert!(normalize_dataset(&value).is_err());
    let mut value = input();
    value["dataset"]["repetition_ids"] = json!(["a", "b", "c", "d"]);
    assert!(normalize_dataset(&value).is_err());
    let mut value = input();
    let source = &mut value["dataset"]["sources"][0];
    source["representation_id"] = json!("tabular_numeric");
    source["axes"] = json!(["sample", "feature"]);
    source["axis_units"] = json!({});
    source["axis_coordinates"] = json!({"feature":[1,"category"]});
    assert!(normalize_dataset(&value).is_err());
    let mut value = input();
    value["dataset"]["sources"][0]["array"]["values"][0][0] = json!(9_007_199_254_740_992_u64);
    assert!(normalize_dataset(&value).is_ok()); // Declared float64, independent of JSON integer spelling.
}

#[test]
fn metadata_ascii_whitespace_includes_vertical_tab() {
    let original: Value = serde_json::from_str(include_str!(
        "../../../tests/fixtures/runtime-u07-groups.json"
    ))
    .unwrap();
    for whitespace in [" ", "\t", "\n", "\r", "\u{000b}", "\u{000c}"] {
        let mut variant = original.clone();
        variant["dataset"]["sources"][3]["array"]["values"][0][0] =
            json!(format!("{whitespace}20.5{whitespace}"));
        assert!(
            u07_sources(&variant).is_ok(),
            "ASCII whitespace {whitespace:?}"
        );
        assert_eq!(
            dataset_content_bytes(&variant).unwrap(),
            dataset_content_bytes(&original).unwrap()
        );
    }
}

#[test]
fn runtime_groups_preserve_string_ids_and_refuse_numeric_labels() {
    let original: Value = serde_json::from_str(include_str!(
        "../../../tests/fixtures/runtime-u07-groups.json"
    ))
    .unwrap();
    let output = multimodal_runtime_input(&original).unwrap();
    assert_eq!(
        output["coordinator_relations"]["records"][0]["group_id"],
        json!("1.0")
    );
    assert_eq!(
        output["coordinator_relations"]["records"][1]["group_id"],
        json!("1")
    );
    for labels in [json!([1.0, 1.5]), json!([1, 2]), json!(["1", 2.0])] {
        let mut variant = original.clone();
        variant["dataset"]["groups"] = json!({"dtype":"object","shape":[2],"values":labels});
        assert_eq!(
            normalize_dataset(&variant).unwrap()["dataset"]["groups"]["values"],
            labels
        );
        assert!(multimodal_runtime_input(&variant)
            .unwrap_err()
            .contains("group IDs must be nonempty strings"));
    }
}

#[test]
fn matrix_targets_preserve_width_and_classification_is_explicit() {
    use nirs4all_io_core::public_dataset::matrix_dataset_package;
    let mut value = input();
    value["dataset"]["y"] =
        json!({"dtype":"float64","shape":[4,2],"values":[[1.,10.],[2.,20.],[3.,30.],[4.,40.]]});
    value["dataset"]["target_names"] = json!(["first", "second"]);
    let package = matrix_dataset_package(&value, "spectra")
        .unwrap()
        .to_assembled();
    assert_eq!(package.blocks["train"].y.as_ref().unwrap().n_cols, 2);
    assert_eq!(
        package.blocks["train"].y.as_ref().unwrap().data,
        vec![1., 10., 2., 20., 3., 30., 4., 40.]
    );
    assert!(dense_dataset_package(&value, "spectra").is_err());
    value["dataset"]["y"] = json!({"dtype":"int64","shape":[4],"values":[0,1,0,1]});
    value["dataset"]["target_names"] = json!(["class"]);
    value["dataset"]["task_type"] = json!("classification");
    assert_eq!(
        matrix_dataset_package(&value, "spectra")
            .unwrap()
            .to_assembled()
            .task_type,
        "classification"
    );
    assert!(dense_dataset_package(&value, "spectra").is_err());
    value["dataset"]["y"]["values"][0] = json!(16_777_217);
    assert!(matrix_dataset_package(&value, "spectra")
        .unwrap_err()
        .contains("float32"));
}

#[test]
fn v2_ragged_and_masked_targets_match_python_js_golden() {
    use nirs4all_io_core::public_dataset::{masked_matrix_dataset_package, matrix_dataset_package};
    let value: Value = serde_json::from_str(include_str!(
        "../../../tests/fixtures/public-dataset-v2.json"
    ))
    .unwrap();
    let expected: Value = serde_json::from_str(include_str!(
        "../../../tests/fixtures/public-dataset-v2-normalized.json"
    ))
    .unwrap();
    assert_eq!(normalize_dataset(&value).unwrap(), expected);
    assert_eq!(normalize_dataset(&expected).unwrap(), expected);
    assert!(matrix_dataset_package(&value, "matrix")
        .unwrap_err()
        .contains("observed"));
    let (package, projection) = masked_matrix_dataset_package(&value, "matrix").unwrap();
    assert_eq!(projection["sample_ids"], expected["dataset"]["sample_ids"]);
    assert_eq!(
        projection["target_mask"],
        expected["dataset"]["target_mask"]
    );
    assert_eq!(
        projection["mask_content_fingerprint"]
            .as_str()
            .unwrap()
            .len(),
        64
    );
    assert_eq!(
        package.to_assembled().blocks["train"]
            .y
            .as_ref()
            .unwrap()
            .data,
        vec![1., 0., 2., 4., 3., 6., 0., 8.]
    );
    let schema = public_source_schema(&value, "series").unwrap();
    assert_eq!(schema["shape"], json!([null, null, 2]));
    assert_eq!(schema["time_unit"], json!("s"));
    assert!(masked_matrix_dataset_package(&value, "series").is_err());
}

#[test]
fn v2_rejects_corrupt_offsets_times_observed_missing_and_v1_ragged() {
    let value: Value = serde_json::from_str(include_str!(
        "../../../tests/fixtures/public-dataset-v2.json"
    ))
    .unwrap();
    for kind in ["offsets", "times", "target", "v1"] {
        let mut wrong = value.clone();
        match kind {
            "offsets" => wrong["dataset"]["sources"][1]["offsets"]["values"][2] = json!(4),
            "times" => wrong["dataset"]["sources"][1]["time_coordinates"]["values"][1] = json!(0),
            "target" => wrong["dataset"]["target_mask"]["values"][0][1] = json!(true),
            _ => {
                wrong["schema"] = json!("nirs4all.dataset.v1");
                wrong["schema_version"] = json!(1);
            }
        }
        assert!(normalize_dataset(&wrong).is_err(), "{kind}");
    }
}

#[test]
fn projected_native_features_join_by_identity_and_refuse_unencoded_presence() {
    use nirs4all_io_core::public_dataset::{
        masked_matrix_dataset_package, projected_matrix_dataset,
    };
    let value: Value = serde_json::from_str(include_str!(
        "../../../tests/fixtures/public-dataset-v2.json"
    ))
    .unwrap();
    let mut projections = vec![
        json!({"source_id":"matrix","sample_ids":["d","c","b","a"],"array":{"dtype":"float64","shape":[4,1],"values":[[4.],[3.],[2.],[1.]]},"feature_names":["mean"],"presence_encoded":false}),
        json!({"source_id":"series","sample_ids":["a","b","c","d"],"array":{"dtype":"float64","shape":[4,2],"values":[[0.,0.],[0.,0.],[4.,1.],[0.,0.]]},"feature_names":["mean","present"],"presence_encoded":false}),
    ];
    assert!(projected_matrix_dataset(&value, &projections)
        .unwrap_err()
        .contains("presence"));
    projections[1]["presence_encoded"] = json!(true);
    let (record, provenance) = projected_matrix_dataset(&value, &projections).unwrap();
    assert_eq!(
        record["dataset"]["sources"][0]["array"]["values"],
        json!([[1., 0., 0.], [2., 0., 0.], [3., 4., 1.], [4., 0., 0.]])
    );
    assert_eq!(
        record["dataset"]["sources"][0]["feature_names"],
        json!(["matrix:mean", "series:mean", "series:present"])
    );
    assert_eq!(
        record["dataset"]["target_mask"],
        value["dataset"]["target_mask"]
    );
    assert_eq!(
        provenance["source_projections"][1]["source_schema"]["time_unit"],
        json!("s")
    );
    assert!(masked_matrix_dataset_package(&record, "native_features").is_ok());
    projections[0]["sample_ids"] = json!(["d", "c", "b", "foreign"]);
    assert!(projected_matrix_dataset(&value, &projections).is_err());
}

#[test]
fn false_target_sentinel_is_normalized_before_float32_conversion() {
    use nirs4all_io_core::public_dataset::masked_matrix_dataset_package;
    let mut value: Value = serde_json::from_str(include_str!(
        "../../../tests/fixtures/public-dataset-v2.json"
    ))
    .unwrap();
    value["dataset"]["y"]["dtype"] = json!("float32");
    value["dataset"]["y"]["values"][0][1] = json!(1e99);
    let (package, _) = masked_matrix_dataset_package(&value, "matrix").unwrap();
    assert_eq!(
        package.to_assembled().blocks["train"]
            .y
            .as_ref()
            .unwrap()
            .data[1],
        0.
    );
    value["dataset"]["target_mask"]["values"][0][1] = json!(true);
    assert!(masked_matrix_dataset_package(&value, "matrix").is_err());
}

#[test]
fn ragged_matrix_projection_is_refused_even_when_fully_present() {
    use nirs4all_io_core::public_dataset::{masked_matrix_dataset_package, matrix_dataset_package};
    let mut value: Value = serde_json::from_str(include_str!(
        "../../../tests/fixtures/public-dataset-v2.json"
    ))
    .unwrap();
    value["dataset"]["sources"][1]["sample_ids"] = json!(["a", "b", "c", "d"]);
    value["dataset"]["sources"][1]["offsets"] =
        json!({"dtype":"int64","shape":[5],"values":[0,2,3,4,5]});
    value["dataset"]["sources"][1]["array"] =
        json!({"dtype":"float64","shape":[5,2],"values":[[1.,2.],[2.,3.],[3.,4.],[4.,5.],[5.,6.]]});
    value["dataset"]["sources"][1]["time_coordinates"] =
        json!({"dtype":"float64","shape":[5],"values":[0.,1.,0.,0.,0.]});
    value["dataset"]["sources"][1]["presence_mask"] =
        json!({"dtype":"bool","shape":[4],"values":[true,true,true,true]});
    assert!(normalize_dataset(&value).is_ok());
    assert!(matrix_dataset_package(&value, "series").is_err());
    assert!(masked_matrix_dataset_package(&value, "series").is_err());
    value["dataset"]["sources"][1]["offsets"]["values"] = json!([0, 0, 3, 4, 5]);
    assert!(normalize_dataset(&value)
        .unwrap_err()
        .contains("packed point"));
    value["dataset"]["sources"][1]["offsets"]["values"] = json!([0, 2, 3, 4, 5]);
    value["dataset"]["sources"][1]["time_coordinates"]["dtype"] = json!("object");
    assert!(normalize_dataset(&value).is_err());
}

#[test]
fn masked_classifier_columns_preserve_independent_labels_and_observation_masks() {
    use nirs4all_io_core::public_dataset::{masked_matrix_dataset_package, matrix_dataset_package};
    let mut value: Value = serde_json::from_str(include_str!(
        "../../../tests/fixtures/public-dataset-v2.json"
    ))
    .unwrap();
    value["dataset"]["task_type"] = json!("classification");
    value["dataset"]["y"]["dtype"] = json!("int64");
    value["dataset"]["y"]["values"] = json!([[0, null], [1, 3], [0, 7], [1e99, 3]]);
    value["dataset"]["target_names"] = json!(["class_a", "class_b"]);
    let (package, mask) = masked_matrix_dataset_package(&value, "matrix").unwrap();
    assert_eq!(package.to_assembled().task_type, "classification");
    let assembled = package.to_assembled();
    assert_eq!(
        assembled.blocks["train"].y_headers,
        vec!["class_a", "class_b"]
    );
    assert_eq!(
        assembled.blocks["train"].y.as_ref().unwrap().data,
        vec![0., 0., 1., 3., 0., 7., 0., 3.]
    );
    assert_eq!(mask["target_names"], json!(["class_a", "class_b"]));
    assert_eq!(mask["target_mask"], value["dataset"]["target_mask"]);
    assert!(matrix_dataset_package(&value, "matrix").is_err());
    value["dataset"]["y"]["values"][1][1] = json!(16777217);
    assert!(masked_matrix_dataset_package(&value, "matrix")
        .unwrap_err()
        .to_string()
        .contains("float32"));
    value["dataset"]["y"]["values"][1][1] = json!(3);
    value["dataset"]["target_names"] = json!(["class_a", "class_a"]);
    assert!(masked_matrix_dataset_package(&value, "matrix").is_err());
    value["dataset"]["target_names"] = json!(["class_a", "class_b"]);
    value["dataset"]["target_mask"]["values"][0][1] = json!(true);
    assert!(masked_matrix_dataset_package(&value, "matrix").is_err());
    value["dataset"]["target_mask"]["values"][0][1] = json!(false);
    value["dataset"]["y"]["values"] = json!([[0, 3], [1, 3], [0, 7], [1, 3]]);
    value["dataset"]["target_mask"]["values"] =
        json!([[true, true], [true, true], [true, true], [true, true]]);
    assert!(masked_matrix_dataset_package(&value, "matrix").is_ok());
    assert!(matrix_dataset_package(&value, "matrix").is_err());
    value["dataset"]["y"]["dtype"] = json!("float64");
    assert!(masked_matrix_dataset_package(&value, "matrix").is_err());
}
