// SPDX-License-Identifier: CeCILL-2.1 OR AGPL-3.0-or-later

use std::fs;

use nirs4all_io::{
    load_role_tagged_assembled, load_role_tagged_assembled_with_limits, to_spec_role_tagged,
    RoleTaggedReadLimits, MAX_ROLE_TAGGED_FILE_BYTES, MAX_ROLE_TAGGED_TOTAL_BYTES,
};
use serde_json::json;
use tempfile::tempdir;

fn config(x: &str, y: &str) -> serde_json::Value {
    json!({
        "delimiter": ";",
        "decimal_separator": ".",
        "has_header": true,
        "header_unit": "cm-1",
        "files": [
            {"path": x, "type": "X", "split": "train", "source": 1},
            {"path": y, "type": "Y", "split": "train", "source": null}
        ],
        "target_selection": {
            "selected_targets": ["protein"],
            "default_target": "protein",
            "task_by_target": {"protein": "regression"}
        },
        "task_type": "regression"
    })
}

fn studio_limits() -> RoleTaggedReadLimits {
    RoleTaggedReadLimits::new(
        1024 * 1024,
        2 * 1024 * 1024,
        128 * 1024,
        64 * 1024,
        128,
        256,
        16_384,
    )
    .unwrap()
}

#[test]
fn facade_materializes_through_the_existing_in_memory_assembler() {
    let root = tempdir().unwrap();
    fs::write(root.path().join("X.csv"), "1000;1001\n1;2\n3;4\n").unwrap();
    fs::write(root.path().join("Y.csv"), "protein;ignored\n10;A\n20;B\n").unwrap();

    let assembled =
        load_role_tagged_assembled(&config("X.csv", "Y.csv"), root.path(), Some("strict")).unwrap();
    assert_eq!(assembled.name, "strict");
    let train = assembled.blocks.get("train").unwrap();
    assert_eq!((train.x[0].n_rows, train.x[0].n_cols), (2, 2));
    let y = train.y.as_ref().unwrap();
    assert_eq!((y.n_rows, y.n_cols), (2, 1));
    assert_eq!(train.y_headers, vec!["protein"]);
}

#[test]
fn absolute_paths_inside_the_root_are_accepted() {
    let root = tempdir().unwrap();
    let x = root.path().join("X.csv");
    let y = root.path().join("Y.csv");
    fs::write(&x, "1000\n1\n").unwrap();
    fs::write(&y, "protein\n10\n").unwrap();
    let assembled = load_role_tagged_assembled(
        &config(x.to_str().unwrap(), y.to_str().unwrap()),
        root.path(),
        None,
    )
    .unwrap();
    assert_eq!(assembled.blocks["train"].n_samples, 1);
}

#[test]
fn multi_target_projection_filters_targets_and_keeps_oracle_file_order() {
    let root = tempdir().unwrap();
    fs::write(root.path().join("X.csv"), "1000\n1\n2\n").unwrap();
    fs::write(
        root.path().join("Y.csv"),
        "protein;moisture;ignored\n10;1;A\n20;2;B\n",
    )
    .unwrap();
    let mut tagged = config("X.csv", "Y.csv");
    tagged["target_selection"] = json!({
        "selected_targets": ["moisture", "protein"],
        "default_target": "protein",
        "task_by_target": {"moisture": "regression", "protein": "regression"}
    });
    tagged["default_target"] = json!("protein");
    tagged["targets"] = json!([
        {"column": "moisture", "type": "regression", "unit": "%", "is_default": false},
        {"column": "protein", "type": "regression", "unit": "%", "is_default": true}
    ]);
    let assembled = load_role_tagged_assembled(&tagged, root.path(), None).unwrap();
    assert_eq!(
        assembled.blocks["train"].y_headers,
        vec!["protein", "moisture"]
    );
}

#[test]
fn conversion_is_pure_but_materialization_confines_absolute_paths() {
    let root = tempdir().unwrap();
    let outside = tempdir().unwrap();
    let x = outside.path().join("X.csv");
    let y = outside.path().join("Y.csv");
    fs::write(&x, "1000\n1\n").unwrap();
    fs::write(&y, "protein\n10\n").unwrap();
    let tagged = config(x.to_str().unwrap(), y.to_str().unwrap());

    assert!(to_spec_role_tagged(&tagged, None).is_ok());
    let error = load_role_tagged_assembled(&tagged, root.path(), None).unwrap_err();
    assert!(error.message.contains("outside dataset_root"));
}

#[cfg(unix)]
#[test]
fn materialization_rejects_a_symlink_escape() {
    use std::os::unix::fs::symlink;

    let root = tempdir().unwrap();
    let outside = tempdir().unwrap();
    fs::write(outside.path().join("X.csv"), "1000\n1\n").unwrap();
    fs::write(root.path().join("Y.csv"), "protein\n10\n").unwrap();
    symlink(outside.path().join("X.csv"), root.path().join("X.csv")).unwrap();

    let error =
        load_role_tagged_assembled(&config("X.csv", "Y.csv"), root.path(), None).unwrap_err();
    assert!(error.message.contains("securely open"));
}

#[cfg(unix)]
#[test]
fn materialization_rejects_two_names_for_the_same_opened_file() {
    use std::os::unix::fs::symlink;

    let root = tempdir().unwrap();
    fs::write(root.path().join("X.csv"), "1000\n1\n").unwrap();
    fs::write(root.path().join("Y.csv"), "protein\n10\n").unwrap();
    symlink("X.csv", root.path().join("X-alias.csv")).unwrap();
    let mut tagged = config("X.csv", "Y.csv");
    tagged["files"].as_array_mut().unwrap().insert(
        1,
        json!({"path": "X-alias.csv", "type": "X", "split": "train", "source": 3}),
    );
    let error = load_role_tagged_assembled(&tagged, root.path(), None).unwrap_err();
    assert!(error.message.contains("already used"));
}

#[test]
fn compressed_and_oversized_files_fail_before_scientific_parsing() {
    let root = tempdir().unwrap();
    fs::write(root.path().join("X.csv.gz"), b"not-even-a-gzip").unwrap();
    fs::write(root.path().join("Y.csv"), "protein\n10\n").unwrap();
    let compressed =
        load_role_tagged_assembled(&config("X.csv.gz", "Y.csv"), root.path(), None).unwrap_err();
    assert!(compressed.message.contains("compressed .gz/.zip"));

    let oversized = fs::File::create(root.path().join("X.csv")).unwrap();
    oversized.set_len(MAX_ROLE_TAGGED_FILE_BYTES + 1).unwrap();
    let too_large =
        load_role_tagged_assembled(&config("X.csv", "Y.csv"), root.path(), None).unwrap_err();
    assert!(too_large.message.contains("file budget"));
}

#[test]
fn compatibility_defaults_remain_explicit_and_custom_limits_only_tighten_them() {
    let defaults = RoleTaggedReadLimits::default();
    assert_eq!(defaults.max_file_bytes(), MAX_ROLE_TAGGED_FILE_BYTES);
    assert_eq!(defaults.max_total_bytes(), MAX_ROLE_TAGGED_TOTAL_BYTES);
    assert_eq!(defaults.max_record_bytes(), u64::MAX);
    assert_eq!(defaults.max_field_bytes(), u64::MAX);
    assert_eq!(defaults.max_rows(), u64::MAX);
    assert_eq!(defaults.max_columns(), u64::MAX);
    assert_eq!(defaults.max_cells(), u64::MAX);
    assert_eq!(studio_limits().max_record_bytes(), 128 * 1024);
    assert_eq!(studio_limits().max_field_bytes(), 64 * 1024);
    assert!(RoleTaggedReadLimits::new(0, 1, 1, 1, 1, 1, 1).is_err());
    assert!(RoleTaggedReadLimits::new(2, 1, 1, 1, 1, 1, 1).is_err());
    assert!(RoleTaggedReadLimits::new(2, 2, 3, 1, 1, 1, 1).is_err());
    assert!(RoleTaggedReadLimits::new(2, 2, 2, 3, 1, 1, 1).is_err());
    assert!(RoleTaggedReadLimits::new(
        MAX_ROLE_TAGGED_FILE_BYTES + 1,
        MAX_ROLE_TAGGED_TOTAL_BYTES,
        1,
        1,
        1,
        1,
        1,
    )
    .is_err());
}

#[test]
fn custom_limit_rejects_a_sparse_cap_plus_one_before_allocation() {
    let root = tempdir().unwrap();
    let sparse = fs::File::create(root.path().join("X.csv")).unwrap();
    sparse.set_len(65).unwrap();
    fs::write(root.path().join("Y.csv"), "protein\n10\n").unwrap();
    let tagged = config("X.csv", "Y.csv");
    let before = tagged.clone();

    let error = load_role_tagged_assembled_with_limits(
        &tagged,
        root.path(),
        None,
        RoleTaggedReadLimits::new(64, 128, 64, 64, 128, 256, 16_384).unwrap(),
    )
    .unwrap_err();

    assert!(error.message.contains("64-byte file budget"));
    assert_eq!(tagged, before);
    assert_eq!(fs::metadata(root.path().join("X.csv")).unwrap().len(), 65);
    assert_eq!(
        fs::read(root.path().join("Y.csv")).unwrap(),
        b"protein\n10\n"
    );
}

#[test]
fn custom_limit_rejects_an_oversized_single_field_before_parsing() {
    let root = tempdir().unwrap();
    fs::write(root.path().join("X.csv"), vec![b'1'; 65]).unwrap();
    fs::write(root.path().join("Y.csv"), "protein\n10\n").unwrap();

    let error = load_role_tagged_assembled_with_limits(
        &config("X.csv", "Y.csv"),
        root.path(),
        None,
        RoleTaggedReadLimits::new(64, 128, 64, 64, 128, 256, 16_384).unwrap(),
    )
    .unwrap_err();

    assert!(error.message.contains("64-byte file budget"));
}

#[test]
fn custom_limit_rejects_the_second_file_at_the_aggregate_budget() {
    let root = tempdir().unwrap();
    fs::write(root.path().join("X.csv"), "1000\n1\n").unwrap();
    fs::write(root.path().join("Y.csv"), "protein\n10\n").unwrap();

    let error = load_role_tagged_assembled_with_limits(
        &config("X.csv", "Y.csv"),
        root.path(),
        None,
        RoleTaggedReadLimits::new(16, 17, 16, 16, 128, 256, 16_384).unwrap(),
    )
    .unwrap_err();

    assert!(error.message.contains("17-byte aggregate budget"));
}

#[cfg(unix)]
#[test]
fn custom_limits_keep_symlink_confinement_enabled() {
    use std::os::unix::fs::symlink;

    let root = tempdir().unwrap();
    let outside = tempdir().unwrap();
    fs::write(outside.path().join("X.csv"), "1000\n1\n").unwrap();
    fs::write(root.path().join("Y.csv"), "protein\n10\n").unwrap();
    symlink(outside.path().join("X.csv"), root.path().join("X.csv")).unwrap();

    let error = load_role_tagged_assembled_with_limits(
        &config("X.csv", "Y.csv"),
        root.path(),
        None,
        studio_limits(),
    )
    .unwrap_err();

    assert!(error.message.contains("securely open"));
}

#[test]
fn studio_limits_reject_record_cap_plus_one_before_cell_copies() {
    let root = tempdir().unwrap();
    let mut record = vec![b'a'; 64 * 1024];
    record.push(b';');
    record.extend(vec![b'b'; 64 * 1024]);
    record.extend_from_slice(b";c\n");
    fs::write(root.path().join("X.csv"), record).unwrap();
    fs::write(root.path().join("Y.csv"), "protein\n10\n").unwrap();

    let error = load_role_tagged_assembled_with_limits(
        &config("X.csv", "Y.csv"),
        root.path(),
        None,
        studio_limits(),
    )
    .unwrap_err();

    assert!(error.message.contains("131072-byte record budget"));
}

#[test]
fn studio_limits_reject_field_cap_plus_one_before_cell_copies() {
    let root = tempdir().unwrap();
    let mut field = vec![b'a'; 64 * 1024 + 1];
    field.push(b'\n');
    fs::write(root.path().join("X.csv"), field).unwrap();
    fs::write(root.path().join("Y.csv"), "protein\n10\n").unwrap();

    let error = load_role_tagged_assembled_with_limits(
        &config("X.csv", "Y.csv"),
        root.path(),
        None,
        studio_limits(),
    )
    .unwrap_err();

    assert!(error.message.contains("65536-byte field budget"));
}

#[test]
fn studio_limits_stop_on_row_129() {
    let root = tempdir().unwrap();
    let mut x = String::from("1000\n");
    for _ in 0..129 {
        x.push_str("1\n");
    }
    fs::write(root.path().join("X.csv"), x).unwrap();
    fs::write(root.path().join("Y.csv"), "protein\n10\n").unwrap();

    let error = load_role_tagged_assembled_with_limits(
        &config("X.csv", "Y.csv"),
        root.path(),
        None,
        studio_limits(),
    )
    .unwrap_err();

    assert!(error.message.contains("128-row budget"));
}

#[test]
fn studio_limits_stop_on_column_257() {
    let root = tempdir().unwrap();
    let header = (0..257)
        .map(|column| format!("c{column}"))
        .collect::<Vec<_>>()
        .join(";");
    fs::write(root.path().join("X.csv"), format!("{header}\n")).unwrap();
    fs::write(root.path().join("Y.csv"), "protein\n10\n").unwrap();

    let error = load_role_tagged_assembled_with_limits(
        &config("X.csv", "Y.csv"),
        root.path(),
        None,
        studio_limits(),
    )
    .unwrap_err();

    assert!(error.message.contains("256-column budget"));
}

#[test]
fn studio_limits_stop_on_cell_16385() {
    let root = tempdir().unwrap();
    let header = (0..256)
        .map(|column| format!("c{column}"))
        .collect::<Vec<_>>()
        .join(";");
    let full_row = std::iter::repeat_n("1", 256).collect::<Vec<_>>().join(";");
    let mut x = format!("{header}\n");
    for _ in 0..64 {
        x.push_str(&full_row);
        x.push('\n');
    }
    x.push_str("1\n");
    fs::write(root.path().join("X.csv"), x).unwrap();
    fs::write(root.path().join("Y.csv"), "protein\n10\n").unwrap();

    let error = load_role_tagged_assembled_with_limits(
        &config("X.csv", "Y.csv"),
        root.path(),
        None,
        studio_limits(),
    )
    .unwrap_err();

    assert!(error.message.contains("16384-cell budget"));
}
