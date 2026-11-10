//! Real packaged startup qualification; no injected executor or Python host.
#![cfg(all(target_os = "linux", target_arch = "x86_64"))]

use std::{
    fs,
    io::{BufRead, BufReader},
    path::Path,
    process::{Child, Command, Stdio},
    sync::mpsc,
    time::Duration,
};

use reqwest::blocking::Client;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

struct RunningSidecar(Child);

impl Drop for RunningSidecar {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

fn launch(binary: &Path, config: &Path) -> (RunningSidecar, String) {
    let mut child = RunningSidecar(
        Command::new(binary)
            .args(["--host", "127.0.0.1", "--port", "0"])
            .env_clear()
            .env("NIRS4ALL_CONFIG", config)
            .env(
                "NIRS4ALL_STUDIO_SESSION_TOKEN",
                "PublicWheelStartupTestSession00001",
            )
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()
            .unwrap(),
    );
    let stdout = child.0.stdout.take().unwrap();
    let (sender, receiver) = mpsc::sync_channel(1);
    let reader = std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines() {
            let line = line.unwrap();
            if let Some(ready) = line.strip_prefix("STUDIO_SIDECAR_READY ") {
                let ready: Value = serde_json::from_str(ready).unwrap();
                sender.send(ready["port"].as_u64().unwrap()).unwrap();
                break;
            }
        }
    });
    let port = receiver
        .recv_timeout(Duration::from_secs(30))
        .expect("normal product startup must become ready within 30 seconds");
    reader.join().unwrap();
    (child, format!("http://127.0.0.1:{port}"))
}

#[test]
#[ignore = "requires the exact public Methods wheel and saved owner-produced Archive V2 fixture"]
#[expect(
    clippy::too_many_lines,
    reason = "one real startup, replay and refusal qualification"
)]
fn public_methods_wheel_startup_selects_and_refuses_without_injected_executor() {
    let profile: Value = serde_json::from_str(include_str!(
        "../../scripts/methods-public-wheel-profile.json"
    ))
    .unwrap();
    let library = fs::read(
        std::env::var_os("N4A_RT_PRED_METHODS_LIBRARY")
            .expect("exact public Methods wheel library required"),
    )
    .unwrap();
    assert_eq!(json!(library.len()), profile["library"]["size"]);
    assert_eq!(
        format!("{:x}", Sha256::digest(&library)),
        profile["library"]["sha256"]
    );
    let archive = fs::read(
        std::env::var_os("N4A_RT_PRED_ARCHIVE_V2")
            .expect("saved raw-pls2-affine-multitarget-core-v1 fixture required"),
    )
    .unwrap();
    let archive_sha256 = format!("{:x}", Sha256::digest(&archive));
    assert_eq!(
        archive_sha256,
        std::env::var("N4A_RT_PRED_ARCHIVE_V2_SHA256").unwrap()
    );

    let scratch = tempfile::tempdir().unwrap();
    let root = scratch.path().canonicalize().unwrap();
    let backend = root.join("backend");
    let native = backend.join("native");
    let config = root.join("config");
    let workspace = root.join("workspace");
    fs::create_dir_all(&native).unwrap();
    fs::create_dir_all(&config).unwrap();
    fs::create_dir_all(workspace.join("exports/models")).unwrap();
    fs::write(workspace.join("exports/models/model-a.n4a"), archive).unwrap();
    fs::write(
        config.join("app_settings.json"),
        json!({"linked_workspaces": [{
            "id": "workspace-a", "path": workspace, "name": "workspace-a", "is_active": true,
            "linked_at": "2026-09-01T10:00:00", "last_scanned": null,
            "discovered": {"runs_count": 0}
        }]})
        .to_string(),
    )
    .unwrap();
    let binary = native.join("studio-sidecar");
    fs::copy(env!("CARGO_BIN_EXE_studio-sidecar"), &binary).unwrap();
    let staged_library = native.join("libn4m.so");
    fs::write(&staged_library, &library).unwrap();
    let writer = Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .join("scripts/native-runtime-contract.cjs");
    let produced = Command::new("node")
        .args([
            "-e",
            r"
const c = require(process.argv[1]);
const backendRoot = process.argv[2];
const result = c.writeRuntimeContract({backendRoot, platform:'linux', arch:'x64',
  methodsLibraryPath:require('node:path').join(backendRoot,'native/libn4m.so')});
c.verifyRuntimeContract({backendRoot, artifactBoundaryRoot:backendRoot,
  platform:'linux', arch:'x64', requireBundledMethods:true});
console.log(JSON.stringify(result.contract));
",
        ])
        .arg(writer)
        .arg(&backend)
        .output()
        .unwrap();
    assert!(
        produced.status.success(),
        "{}",
        String::from_utf8_lossy(&produced.stderr)
    );
    let contract: Value = serde_json::from_slice(&produced.stdout).unwrap();
    assert_eq!(contract["methods_library"]["artifact"], profile["artifact"]);
    assert!(contract["methods_library"].get("source").is_none());

    let client = Client::builder()
        .no_proxy()
        .timeout(Duration::from_secs(30))
        .build()
        .unwrap();
    let contract_path = native.join("STUDIO_RUNTIME_CONTRACT.json");
    for case in [
        "selected",
        "absent-contract",
        "wrong-artifact",
        "wrong-abi",
        "missing-library",
        "altered-library",
    ] {
        let mut candidate = contract.clone();
        fs::write(&staged_library, &library).unwrap();
        match case {
            "wrong-artifact" => {
                candidate["methods_library"]["artifact"]["wheel"]["sha256"] = json!("a".repeat(64));
            }
            "wrong-abi" => candidate["methods_library"]["abi"]["minor"] = json!(20),
            "missing-library" => fs::remove_file(&staged_library).unwrap(),
            "altered-library" => fs::write(&staged_library, b"unselected-native-library").unwrap(),
            _ => {}
        }
        fs::write(&contract_path, candidate.to_string()).unwrap();
        if case == "absent-contract" {
            fs::remove_file(&contract_path).unwrap();
        }
        let (_process, url) = launch(&binary, &config);
        let request = |path: &str| {
            client
                .get(format!("{url}{path}"))
                .header("X-Nirs4all-Session", "PublicWheelStartupTestSession00001")
        };
        let readiness: Value = request("/api/system/readiness")
            .send()
            .unwrap()
            .error_for_status()
            .unwrap()
            .json()
            .unwrap();
        assert_eq!(
            readiness["native_prediction_ready"],
            case == "selected",
            "{case}: {readiness}"
        );
        assert_eq!(
            readiness["native_training_ready"],
            case == "selected",
            "{case}: {readiness}"
        );
        assert_eq!(readiness["ml_ready"], false);
        let body = if case == "selected" {
            json!({
            "schema_version": 1, "operation": "archive_v2_predict", "workspace_id": "workspace-a",
            "archive": {"ref": "models/model-a.n4a", "sha256": archive_sha256},
            "input": {"kind": "array", "sample_ids": ["predict.0", "predict.1"],
                "x": [[1.5, 0.5], [3.5, 1.5]], "expected_target_names": ["protein", "moisture"]},
            "execution": {"engine": "core_rust_methods", "allow_fallback": false}
        }).to_string()
        } else {
            "not-json-must-not-be-parsed".into()
        };
        let response = client
            .post(format!("{url}/api/predict/archive-v2"))
            .header("X-Nirs4all-Session", "PublicWheelStartupTestSession00001")
            .header("Content-Type", "application/json")
            .body(body)
            .send()
            .unwrap();
        assert_eq!(
            response.status().as_u16(),
            if case == "selected" { 200 } else { 503 }
        );
        let response: Value = response.json().unwrap();
        if case == "selected" {
            assert_eq!(response["engine"], "core_rust_methods");
            assert_eq!(response["fallback_used"], false);
            assert_eq!(response["sample_ids"], json!(["predict.0", "predict.1"]));
            assert_eq!(response["target_names"], json!(["protein", "moisture"]));
            assert_eq!(response["archive_sha256"], archive_sha256);
            assert_eq!(
                response["provenance"]["executor"],
                format!(
                    "nirs4all-core@0.5.0+libn4m-abi-2.22:{}",
                    profile["library"]["sha256"].as_str().unwrap()
                )
            );
            for (row, expected) in response["values"]
                .as_array()
                .unwrap()
                .iter()
                .zip([[3.5, 17.0], [6.5, 23.0]])
            {
                let row = row.as_array().unwrap();
                assert_eq!(row.len(), 2);
                for (actual, expected) in row.iter().zip(expected) {
                    let actual = actual.as_f64().unwrap();
                    assert!(actual.is_finite() && (actual - expected).abs() <= 1.0e-9);
                }
            }
            assert_eq!(response["values"].as_array().unwrap().len(), 2);
        } else {
            assert_eq!(
                response["error"]["code"],
                "archive_v2_prediction_unavailable"
            );
        }
    }
}
