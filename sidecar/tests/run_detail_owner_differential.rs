use std::{env, fs, path::PathBuf, process::Command, time::SystemTime};

use serde_json::Value;
use studio_sidecar::run_detail_cpython::materialize_run_detail_owner;

fn test_directory() -> PathBuf {
    let nonce = SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    env::temp_dir().join(format!(
        "studio-run-detail-owner-differential-{}-{nonce}",
        std::process::id()
    ))
}

#[test]
#[ignore = "requires NIRS4ALL_RUN_DETAIL_OWNER_PYTHON with nirs4all installed"]
fn fresh_isolated_cpython_matches_the_direct_owner_oracle_without_mutation() {
    let python = PathBuf::from(
        env::var_os("NIRS4ALL_RUN_DETAIL_OWNER_PYTHON")
            .expect("NIRS4ALL_RUN_DETAIL_OWNER_PYTHON is required"),
    );
    let root = test_directory();
    fs::create_dir_all(&root).unwrap();
    let fixtures = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures");
    let database = root.join("store.sqlite");
    fs::copy(fixtures.join("workspace_store_v5.sqlite"), &database).unwrap();
    let before = fs::metadata(&database).unwrap();
    let run_id = "12345678-1234-5678-1234-567812345678";

    let actual = materialize_run_detail_owner(&python, &root, run_id)
        .unwrap()
        .expect("fixture run must exist");
    let oracle = Command::new(&python)
        .args([
            "-I",
            "-c",
            "import json,sys\nfrom nirs4all.pipeline.storage import studio_run_detail_http_inputs_v1\nprint(json.dumps(studio_run_detail_http_inputs_v1(sys.argv[1],sys.argv[2]),allow_nan=False,separators=(',',':'),sort_keys=True))",
        ])
        .arg(&root)
        .arg(run_id)
        .output()
        .unwrap();
    assert!(oracle.status.success());
    assert!(oracle.stderr.is_empty());
    let expected: Value = serde_json::from_slice(&oracle.stdout).unwrap();
    assert_eq!(actual, expected);

    let after = fs::metadata(&database).unwrap();
    assert_eq!(before.len(), after.len());
    assert_eq!(before.modified().unwrap(), after.modified().unwrap());
    for suffix in ["-wal", "-shm", "-journal"] {
        assert!(!PathBuf::from(format!("{}{suffix}", database.display())).exists());
    }
    fs::remove_dir_all(root).unwrap();
}
