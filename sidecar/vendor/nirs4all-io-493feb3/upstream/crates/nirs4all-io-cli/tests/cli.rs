// SPDX-License-Identifier: CeCILL-2.1 OR AGPL-3.0-or-later
//! CLI mechanics: every subcommand runs the built binary end-to-end and checks
//! exit status + the shape of the emitted canonical JSON. Content parity is
//! proven by the facade contract goldens; this proves the CLI plumbing.

use std::path::PathBuf;
use std::process::Command;

fn corpus(case: &str) -> String {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(|p| p.parent())
        .expect("repo root")
        .join("tests/goldens/contract/corpus")
        .join(case)
        .to_string_lossy()
        .into_owned()
}

fn run(args: &[&str]) -> (bool, String, String) {
    let out = Command::new(env!("CARGO_BIN_EXE_nirs4all-io"))
        .args(args)
        .output()
        .expect("spawn cli");
    (
        out.status.success(),
        String::from_utf8_lossy(&out.stdout).into_owned(),
        String::from_utf8_lossy(&out.stderr).into_owned(),
    )
}

#[test]
fn to_spec_emits_canonical_spec() {
    let (ok, stdout, stderr) = run(&["to-spec", &corpus("train_test")]);
    assert!(ok, "stderr: {stderr}");
    assert!(stdout.starts_with("{\n"), "pretty JSON");
    assert!(stdout.contains("\"schema_version\""));
    assert!(stdout.ends_with("}\n"), "trailing newline");
}

#[test]
fn infer_emits_plan() {
    let (ok, stdout, stderr) = run(&["infer", &corpus("single_combined")]);
    assert!(ok, "stderr: {stderr}");
    assert!(stdout.contains("\"resolved_spec\""));
}

#[test]
fn load_emits_assembled_summary() {
    let (ok, stdout, stderr) = run(&["load", &corpus("x_y_separate")]);
    assert!(ok, "stderr: {stderr}");
    assert!(stdout.contains("\"blocks\""));
}

#[test]
fn load_limits_are_configurable_without_changing_output() {
    let path = corpus("train_test");
    let (ok, expected, error) = run(&["load", &path]);
    assert!(ok, "{error}");
    for policy in ["{}", "\"unlimited\"", "{\"max_rows\":1000000}"] {
        let (ok, output, error) = run(&["load", &path, "--limits", policy]);
        assert!(ok, "{error}");
        assert_eq!(output, expected);
    }
    for policy in ["{\"max_file_bytes\":1}", "{\"max_row\":1}"] {
        let (ok, output, error) = run(&["load", &path, "--limits", policy]);
        assert!(!ok);
        assert!(output.is_empty());
        assert!(error.contains("limit"), "{error}");
    }
}

#[test]
fn to_spec_output_validates() {
    let (ok, spec, _) = run(&["to-spec", &corpus("x_y_separate")]);
    assert!(ok);
    let tmp = std::env::temp_dir().join(format!("n4io_cli_{}.json", std::process::id()));
    std::fs::write(&tmp, &spec).unwrap();
    let (ok, _, stderr) = run(&["validate", tmp.to_str().unwrap()]);
    let _ = std::fs::remove_file(&tmp);
    assert!(ok, "validate failed: {stderr}");
    assert!(stderr.contains("valid"));
}

#[test]
fn validate_rejects_bad_spec() {
    let tmp = std::env::temp_dir().join(format!("n4io_cli_bad_{}.json", std::process::id()));
    std::fs::write(&tmp, r#"{"partitions": {"by": "random"}}"#).unwrap();
    let (ok, _, stderr) = run(&["validate", tmp.to_str().unwrap()]);
    let _ = std::fs::remove_file(&tmp);
    assert!(!ok, "should reject");
    assert!(!stderr.is_empty());
}

#[test]
fn emit_dag_ml_data_points_to_ecosystem_crate() {
    // The emit lives in the `nirs4all-io-dagml` bridge crate; the
    // main CLI subcommand exists for discoverability and points there.
    let (ok, _, stderr) = run(&["emit-dag-ml-data", &corpus("x_y_separate")]);
    assert!(!ok);
    assert!(stderr.contains("nirs4all-io-dagml"));
}

#[test]
fn missing_input_is_a_usage_error() {
    // clap rejects a missing required positional with a non-zero exit
    let (ok, _, _) = run(&["infer"]);
    assert!(!ok);
}
