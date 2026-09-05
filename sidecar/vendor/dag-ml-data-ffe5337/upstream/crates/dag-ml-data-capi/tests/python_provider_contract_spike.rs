//! P4 provider-contract spike runner.
//!
//! Builds the C ABI cdylib and runs `examples/python/provider_contract_spike.py`
//! against the installable `dag_ml_data_provider` package, proving the provider
//! contract end-to-end from Python over the C ABI on realistic shapes
//! (branch-view filtering, group/fold identity, multi-source fusion, vtable
//! lifecycle). The spike imports the package and discovers the cdylib via
//! `DAG_ML_DATA_CAPI_LIB`, so `--lib` is omitted.

use std::path::{Path, PathBuf};
use std::process::Command;

fn workspace_root() -> PathBuf {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    manifest_dir
        .parent()
        .and_then(Path::parent)
        .expect("workspace root")
        .to_path_buf()
}

fn build_capi_cdylib(workspace_root: &Path) -> PathBuf {
    let cargo = std::env::var("CARGO").unwrap_or_else(|_| "cargo".to_string());
    let build = Command::new(cargo)
        .arg("build")
        .arg("-p")
        .arg("dag-ml-data-capi")
        .arg("--lib")
        .current_dir(workspace_root)
        .output()
        .expect("run cargo build for cdylib");
    assert!(
        build.status.success(),
        "cargo build failed\nstdout:\n{}\nstderr:\n{}",
        String::from_utf8_lossy(&build.stdout),
        String::from_utf8_lossy(&build.stderr)
    );

    let target_dir = std::env::var_os("CARGO_TARGET_DIR")
        .map(|path| {
            let path = PathBuf::from(path);
            if path.is_absolute() {
                path
            } else {
                workspace_root.join(path)
            }
        })
        .unwrap_or_else(|| workspace_root.join("target"));
    target_dir.join("debug").join(format!(
        "{}dag_ml_data_capi{}",
        std::env::consts::DLL_PREFIX,
        std::env::consts::DLL_SUFFIX
    ))
}

#[test]
fn python_provider_contract_spike_runs_against_c_abi() {
    let workspace_root = workspace_root();
    let lib_path = build_capi_cdylib(&workspace_root);
    let envelope_path = workspace_root
        .join("examples/fixtures/oof_campaign/coordinator_data_plan_envelope_nir.json");
    let request_path = workspace_root
        .join("examples/fixtures/oof_campaign/materialization_request_model_base_x.json");
    let script_path = workspace_root.join("examples/python/provider_contract_spike.py");

    let package_root = workspace_root.join("crates/dag-ml-data-capi/bindings/python");
    let mut python_paths = vec![package_root];
    if let Some(existing) = std::env::var_os("PYTHONPATH") {
        python_paths.extend(std::env::split_paths(&existing));
    }
    let python_path = std::env::join_paths(python_paths).expect("join PYTHONPATH");

    let output = Command::new("python3")
        .arg(&script_path)
        .arg("--envelope")
        .arg(&envelope_path)
        .arg("--request")
        .arg(&request_path)
        .env("PYTHONPATH", &python_path)
        .env("DAG_ML_DATA_CAPI_LIB", &lib_path)
        .output()
        .expect("run provider contract spike");

    assert!(
        output.status.success(),
        "provider contract spike failed\nstdout:\n{}\nstderr:\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );

    let stdout = String::from_utf8_lossy(&output.stdout);
    // Branch-view: sample subset + column projection + reorder (S002 first).
    assert!(
        stdout.contains(r#""observations": ["obs.S002.base", "obs.S001.base", "obs.S001.rep1"]"#),
        "{stdout}"
    );
    // Group/fold identity: both groups surfaced, host-aggregated target aligned.
    assert!(
        stdout.contains(r#""groups": ["plant.A", "plant.B"]"#),
        "{stdout}"
    );
    assert!(
        stdout.contains(r#""aligned": {"S001": 100.0, "S002": 200.0}"#),
        "{stdout}"
    );
    // Multi-source fusion: namespaced columns, inner-join row count, 2x2 tensor.
    assert!(
        stdout.contains(r#""fused_columns": ["nir.v", "chem.v"]"#),
        "{stdout}"
    );
    assert!(stdout.contains(r#""fused_rows": 2"#), "{stdout}");
    // Lifecycle: release invalidates the view.
    assert!(
        stdout.contains(r#""released_invalidates": true"#),
        "{stdout}"
    );
}
