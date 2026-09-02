use std::{env, fs, path::PathBuf};

use studio_sidecar::legacy_conversion::{LegacyConversionRequest, LegacyConversionRuntime};

#[test]
#[ignore = "requires NIRS4ALL_TEST_LEGACY_CONVERTER_PYTHON and NIRS4ALL_TEST_LEGACY_WORKSPACE"]
fn real_tools_dry_run_uses_bounded_stdio_and_keeps_the_source_immutable() {
    let python = PathBuf::from(
        env::var_os("NIRS4ALL_TEST_LEGACY_CONVERTER_PYTHON")
            .expect("NIRS4ALL_TEST_LEGACY_CONVERTER_PYTHON is required"),
    );
    let source = PathBuf::from(
        env::var_os("NIRS4ALL_TEST_LEGACY_WORKSPACE")
            .expect("NIRS4ALL_TEST_LEGACY_WORKSPACE is required"),
    );
    let before = [
        fs::read(source.join("store.duckdb")).unwrap(),
        fs::read(source.join("run_predictions.json")).unwrap(),
        fs::read(source.join("sample.meta.parquet")).unwrap(),
    ];
    let runtime = LegacyConversionRuntime::from_python_plugin_host(Some(python));
    let output_path = env::temp_dir().join(format!(
        "studio-sidecar-real-tools-dry-run-{}",
        std::process::id()
    ));
    if output_path.exists() {
        fs::remove_dir_all(&output_path).unwrap();
    }
    let request = LegacyConversionRequest {
        workspace_path: source.clone(),
        output_path: output_path.clone(),
        verify: true,
        dry_run: true,
        strict: false,
        link_converted_workspace: false,
    };

    let command = runtime.command(&request);
    assert_eq!(&command[1..5], ["-I", "-B", "-m", "nirs4all_tools"]);
    let output = runtime.run(&request).unwrap();
    assert_eq!(output.return_code, 0);
    assert!(output.stderr.is_empty());
    assert!(output.stdout.contains("would_preserve_opaque"));
    assert!(!request.output_path.exists());

    let migration = runtime
        .run(&LegacyConversionRequest {
            workspace_path: source.clone(),
            output_path: output_path.clone(),
            verify: true,
            dry_run: false,
            strict: false,
            link_converted_workspace: false,
        })
        .unwrap();
    assert_eq!(migration.return_code, 10);
    assert!(output_path.join("store.sqlite").is_file());
    assert!(output_path.join("migration-manifest.json").is_file());
    let strict_output = output_path.with_file_name(format!(
        "studio-sidecar-real-tools-strict-{}",
        std::process::id()
    ));
    if strict_output.exists() {
        fs::remove_dir_all(&strict_output).unwrap();
    }
    let refused = runtime
        .run(&LegacyConversionRequest {
            workspace_path: source.clone(),
            output_path: strict_output.clone(),
            verify: true,
            dry_run: false,
            strict: true,
            link_converted_workspace: false,
        })
        .unwrap();
    assert_eq!(refused.return_code, 20);
    assert!(!strict_output.exists());
    assert_eq!(
        before,
        [
            fs::read(source.join("store.duckdb")).unwrap(),
            fs::read(source.join("run_predictions.json")).unwrap(),
            fs::read(source.join("sample.meta.parquet")).unwrap(),
        ]
    );
    fs::remove_dir_all(output_path).unwrap();
}
