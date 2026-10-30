use std::{
    env, fs,
    io::{BufRead, BufReader, Read, Write},
    net::TcpStream,
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::mpsc,
    thread,
    time::Duration,
};

use serde_json::{json, Value};

use studio_sidecar::legacy_conversion::{
    LegacyConversionProcessOutput, LegacyConversionRequest, LegacyConversionRuntime,
};

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
    let server = ProductConverter::start(&python, &source);
    let runtime = LegacyConversionRuntime::from_python_plugin_host(Some(python.clone()));
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
    assert_eq!(&command[1..4], ["-I", "-B", "-c"]);
    assert!(command[4].contains("runpy.run_module(\"nirs4all_tools\""));
    assert_plugin_guard_is_active(&python, &command);
    let output = server.run(&request);
    #[cfg(not(windows))]
    {
        assert_eq!(output.return_code, 0);
        assert_eq!(output.stderr, "");
        assert!(output.stdout.contains("would_preserve_opaque"));
    }
    #[cfg(windows)]
    assert_windows_capability_refusal(&output);
    assert!(!request.output_path.exists());

    let migration = server.run(&LegacyConversionRequest {
        workspace_path: source.clone(),
        output_path: output_path.clone(),
        verify: true,
        dry_run: false,
        strict: false,
        link_converted_workspace: false,
    });
    #[cfg(not(windows))]
    {
        assert_eq!(migration.return_code, 10);
        assert!(output_path.join("store.sqlite").is_file());
        assert!(output_path.join("migration-manifest.json").is_file());
    }
    #[cfg(windows)]
    {
        assert_windows_capability_refusal(&migration);
        assert!(!output_path.exists());
    }
    let strict_output = output_path.with_file_name(format!(
        "studio-sidecar-real-tools-strict-{}",
        std::process::id()
    ));
    if strict_output.exists() {
        fs::remove_dir_all(&strict_output).unwrap();
    }
    let refused = server.run(&LegacyConversionRequest {
        workspace_path: source.clone(),
        output_path: strict_output.clone(),
        verify: true,
        dry_run: false,
        strict: true,
        link_converted_workspace: false,
    });
    assert_eq!(refused.return_code, 20);
    #[cfg(windows)]
    assert_windows_capability_refusal(&refused);
    assert!(!strict_output.exists());
    assert_eq!(
        before,
        [
            fs::read(source.join("store.duckdb")).unwrap(),
            fs::read(source.join("run_predictions.json")).unwrap(),
            fs::read(source.join("sample.meta.parquet")).unwrap(),
        ]
    );
    #[cfg(not(windows))]
    fs::remove_dir_all(output_path).unwrap();
}

// The Windows converter starts a contained copy of current_exe(). Exercise the
// actual product executable, whose main dispatches the internal Job launcher;
// a libtest executable cannot provide that product process boundary.
struct ProductConverter {
    child: Child,
    port: u16,
    config: PathBuf,
}

impl ProductConverter {
    fn start(python: &Path, source: &Path) -> Self {
        let config = env::temp_dir().join(format!(
            "studio-real-converter-config-{}",
            std::process::id()
        ));
        fs::create_dir_all(&config).unwrap();
        fs::write(
            config.join("app_settings.json"),
            json!({"version":"3.0","linked_workspaces":[{
                "id":"legacy-real", "path":source, "name":"Legacy fixture",
                "is_active":true, "linked_at":"2026-10-30T00:00:00",
                "last_scanned":null, "discovered":{"runs_count":1}
            }],"favorite_pipelines":[],"ui_preferences":{}})
            .to_string(),
        )
        .unwrap();
        let child = Command::new(env!("CARGO_BIN_EXE_studio-sidecar"))
            .args(["--port", "0"])
            .env("NIRS4ALL_CONFIG", &config)
            .env(studio_sidecar::PYTHON_PLUGIN_HOST_ENV, python)
            .env_remove("NIRS4ALL_STUDIO_SESSION_TOKEN")
            .env_remove("NIRS4ALL_SCIENTIFIC_EXECUTOR")
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .spawn()
            .unwrap();
        let mut server = Self {
            child,
            port: 0,
            config,
        };
        let stdout = server.child.stdout.take().unwrap();
        let (sender, receiver) = mpsc::channel();
        thread::spawn(move || {
            let mut line = String::new();
            BufReader::new(stdout).read_line(&mut line).unwrap();
            let _ = sender.send(line);
        });
        let line = receiver.recv_timeout(Duration::from_secs(60)).unwrap();
        let ready: Value = serde_json::from_str(
            line.strip_prefix("STUDIO_SIDECAR_READY ")
                .expect("product readiness"),
        )
        .unwrap();
        server.port = u16::try_from(ready["port"].as_u64().unwrap()).unwrap();
        server
    }

    fn run(&self, request: &LegacyConversionRequest) -> LegacyConversionProcessOutput {
        let body = json!({
            "output_path":request.output_path, "verify":request.verify,
            "dry_run":request.dry_run, "strict":request.strict,
            "link_converted_workspace":request.link_converted_workspace,
        })
        .to_string();
        let mut stream = TcpStream::connect(("127.0.0.1", self.port)).unwrap();
        stream
            .set_read_timeout(Some(Duration::from_secs(120)))
            .unwrap();
        write!(stream,
            "POST /api/workspace/legacy-convert HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()
        ).unwrap();
        let mut response = String::new();
        stream.read_to_string(&mut response).unwrap();
        let (headers, payload) = response.split_once("\r\n\r\n").unwrap();
        let expected_status = if cfg!(windows) || request.strict {
            "HTTP/1.1 422 "
        } else {
            "HTTP/1.1 200 "
        };
        assert!(headers.starts_with(expected_status), "{response}");
        let payload: Value = serde_json::from_str(payload).unwrap();
        LegacyConversionProcessOutput {
            return_code: i32::try_from(payload["return_code"].as_i64().unwrap()).unwrap(),
            stdout: payload["stdout"].as_str().unwrap().to_owned(),
            stderr: payload["stderr"].as_str().unwrap().to_owned(),
        }
    }
}

impl Drop for ProductConverter {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
        let _ = fs::remove_dir_all(&self.config);
    }
}

fn assert_plugin_guard_is_active(python: &Path, command: &[String]) {
    // Replace only the test dispatch target, after the real immutable Tools
    // attestation, so both denied operations execute under the production hook.
    let probe = format!(
        r#"import runpy,socket,subprocess,sys
def probe(*args,**kwargs):
 try:
  subprocess.run([sys.executable,"-c","pass"],check=True)
 except RuntimeError as error:
  assert str(error)=="spawn denied"
 else:
  raise AssertionError("plugin subprocess unexpectedly allowed")
 with socket.socket() as listener:
  try:
   listener.bind(("127.0.0.1",0))
  except RuntimeError as error:
   assert str(error)=="listener denied"
  else:
   raise AssertionError("plugin listener unexpectedly allowed")
 print("plugin guards enforced")
runpy.run_module=probe
{}
"#,
        command[4]
    );
    #[cfg(windows)]
    let mut launcher = {
        let mut launcher = Command::new(env!("CARGO_BIN_EXE_studio-sidecar"));
        launcher.arg(studio_sidecar::legacy_conversion::WINDOWS_JOB_LAUNCHER_ARGUMENT);
        launcher.arg(python);
        launcher
    };
    #[cfg(not(windows))]
    let mut launcher = Command::new(python);
    let output = launcher
        .args(["-I", "-B", "-c", &probe, "--"])
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert_eq!(output.stderr, [] as [u8; 0]);
    assert_eq!(
        String::from_utf8(output.stdout).unwrap().trim(),
        "plugin guards enforced"
    );
}

#[cfg(windows)]
fn assert_windows_capability_refusal(output: &LegacyConversionProcessOutput) {
    // Tools 0.0.8 requires descriptor-relative POSIX no-follow source staging.
    // Windows must preserve this established refusal, never fall back to paths.
    assert_eq!(output.return_code, 20);
    assert_eq!(output.stdout, "");
    assert_eq!(
        serde_json::from_str::<Value>(&output.stderr).unwrap(),
        json!({"error":{
            "code":"UNSUPPORTED_INPUT", "exit_code":20,
            "cause":"unsupported_capability",
            "message":"secure source staging requires descriptor-relative no-follow filesystem support",
            "mitigation":"run this conversion on a platform with O_NOFOLLOW, O_DIRECTORY, and dir_fd support"
        }})
    );
}
