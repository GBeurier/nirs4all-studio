#![cfg(unix)]

use std::{
    fs,
    io::{BufRead, BufReader, Read},
    net::{TcpListener, TcpStream},
    os::unix::fs::{symlink, PermissionsExt},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{mpsc, Arc, Mutex},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use serde_json::{json, Value};
use studio_sidecar::{
    execution_job_records::read_execution_job_record,
    job_http::{
        JobExecutorError, NativeJobRuntime, NativeJobRuntimeError, ScientificExecutionRequest,
        ScientificExecutorSelection, ScientificJobExecutor, ScientificJobTerminal,
        ScientificSubmissionPreflight,
    },
    route_request_with_body,
    scientific_cpython::{CpythonScientificJobExecutor, SCIENTIFIC_CPYTHON_EXECUTOR_ID},
    websocket_transport::{
        handle_websocket_connection, LegacyWebSocketEndpoint, WebSocketConnectionManager,
    },
    SidecarState, PYTHON_PLUGIN_HOST_ENV, PYTHON_PLUGIN_SITE_PACKAGES_ENV, SCIENTIFIC_EXECUTOR_ENV,
    STUDIO_ADAPTERS_DIR_ENV,
};
use tungstenite::{
    protocol::{Role, WebSocket},
    Message,
};

#[derive(Debug)]
struct ChannelTerminal {
    sender: Mutex<mpsc::SyncSender<Result<Value, String>>>,
}

/// Subscribe before registration/start while still delegating to real `CPython`.
#[derive(Debug)]
struct ObservedScientificExecutor {
    inner: Arc<dyn ScientificJobExecutor>,
    manager: Mutex<Option<Arc<WebSocketConnectionManager>>>,
    connection: Mutex<Option<ObservedJobEvents>>,
}

#[derive(Debug)]
struct ObservedJobEvents {
    socket: WebSocket<TcpStream>,
    server: std::thread::JoinHandle<()>,
}

impl ScientificJobExecutor for ObservedScientificExecutor {
    fn is_selected(&self) -> bool {
        self.inner.is_selected()
    }

    fn unavailability_reason(&self) -> &'static str {
        self.inner.unavailability_reason()
    }

    fn preflight_submission(
        &self,
        request: &ScientificSubmissionPreflight,
    ) -> Result<ScientificExecutorSelection, JobExecutorError> {
        let selection = self.inner.preflight_submission(request)?;
        let manager = self.manager.lock().unwrap().as_ref().unwrap().clone();
        let endpoint = LegacyWebSocketEndpoint::Job {
            job_id: request.job_id.clone(),
        };
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let server = std::thread::spawn(move || {
            let (stream, _) = listener.accept().unwrap();
            handle_websocket_connection(stream, "dGhlIHNhbXBsZSBub25jZQ==", &endpoint, &manager)
                .unwrap();
        });
        let mut stream = TcpStream::connect(address).unwrap();
        stream
            .set_read_timeout(Some(Duration::from_secs(120)))
            .unwrap();
        // This transport seam starts after the HTTP request was validated.
        let mut header = Vec::new();
        while !header.ends_with(b"\r\n\r\n") {
            let mut byte = [0];
            stream.read_exact(&mut byte).unwrap();
            header.push(byte[0]);
            assert!(header.len() <= 4096);
        }
        assert!(header.starts_with(b"HTTP/1.1 101 "));
        let mut socket = WebSocket::from_raw_socket(stream, Role::Client, None);
        for expected in ["connected", "subscribed"] {
            let message = read_event_text(&mut socket);
            let event: Value = serde_json::from_str(&message).unwrap();
            assert_eq!(event["type"], expected);
        }
        // Receiving subscribed guarantees the observer is ready before start.
        assert!(self
            .connection
            .lock()
            .unwrap()
            .replace(ObservedJobEvents { socket, server })
            .is_none());
        Ok(selection)
    }

    fn submit_scientific(
        &self,
        request: &ScientificExecutionRequest,
        terminal: Arc<dyn ScientificJobTerminal>,
    ) -> Result<(), JobExecutorError> {
        self.inner.submit_scientific(request, terminal)
    }

    fn request_cooperative_cancel(&self, job_id: &str) -> Result<(), JobExecutorError> {
        self.inner.request_cooperative_cancel(job_id)
    }
}

fn read_event_text(socket: &mut WebSocket<TcpStream>) -> String {
    loop {
        match socket.read().unwrap() {
            Message::Text(message) => return message.to_string(),
            Message::Ping(_) | Message::Pong(_) => socket.flush().unwrap(),
            unexpected => panic!("unexpected lifecycle frame: {unexpected:?}"),
        }
    }
}

#[derive(Debug)]
struct RejectingTerminal;

impl ScientificJobTerminal for RejectingTerminal {
    fn complete(&self, _job_id: &str, _result: Value) -> Result<(), NativeJobRuntimeError> {
        Err(NativeJobRuntimeError::Executor(
            studio_sidecar::job_http::JobExecutorError::SubmissionRefused,
        ))
    }

    fn fail(&self, _job_id: &str, _reason: &str) -> Result<(), NativeJobRuntimeError> {
        Err(NativeJobRuntimeError::Executor(
            studio_sidecar::job_http::JobExecutorError::SubmissionRefused,
        ))
    }

    fn acknowledge_cancel(&self, _job_id: &str) -> Result<(), NativeJobRuntimeError> {
        Err(NativeJobRuntimeError::Executor(
            studio_sidecar::job_http::JobExecutorError::SubmissionRefused,
        ))
    }
}

impl ScientificJobTerminal for ChannelTerminal {
    fn complete(&self, _job_id: &str, result: Value) -> Result<(), NativeJobRuntimeError> {
        let _ = self.sender.lock().unwrap().send(Ok(result));
        Ok(())
    }

    fn fail(&self, _job_id: &str, reason: &str) -> Result<(), NativeJobRuntimeError> {
        let _ = self.sender.lock().unwrap().send(Err(reason.to_owned()));
        Ok(())
    }

    fn acknowledge_cancel(&self, _job_id: &str) -> Result<(), NativeJobRuntimeError> {
        let _ = self.sender.lock().unwrap().send(Err("cancelled".into()));
        Ok(())
    }
}

fn test_directory(name: &str) -> PathBuf {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    std::env::temp_dir().join(format!(
        "studio-scientific-cpython-runtime-{name}-{}-{nonce}",
        std::process::id()
    ))
}

fn shell_host(root: &Path, name: &str, body: &str) -> PathBuf {
    fs::create_dir_all(root).unwrap();
    let path = root.join(name);
    fs::write(&path, format!("#!/bin/sh\n{body}\n")).unwrap();
    let mut permissions = fs::metadata(&path).unwrap().permissions();
    permissions.set_mode(0o700);
    fs::set_permissions(&path, permissions).unwrap();
    std::thread::sleep(std::time::Duration::from_millis(10));
    path
}

fn configured_resolver(root: &Path) -> PathBuf {
    let config = root.join("config");
    fs::create_dir_all(&config).unwrap();
    fs::write(
        config.join("dataset_links.json"),
        br#"{"version":"1.0","schema_version":2,"datasets":[],"groups":[]}"#,
    )
    .unwrap();
    config
}

/// The adapters directory shipped with the application, from the compiled manifest.
fn application_adapters(root: &Path) -> PathBuf {
    let directory = root.join("adapters");
    let manifest: Value = serde_json::from_str(include_str!(
        "../contracts/studio_document_adapters_v1.json"
    ))
    .unwrap();
    let sources = Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap();
    for member in manifest["files"].as_array().unwrap() {
        let relative = member["path"].as_str().unwrap();
        let destination = directory.join("studio_document_adapters").join(relative);
        fs::create_dir_all(destination.parent().unwrap()).unwrap();
        let bytes = if relative.ends_with("__init__.py") {
            b"\"\"\"Pure document translation package; no HTTP or application state.\"\"\"\n"
                .to_vec()
        } else {
            fs::read(sources.join(relative)).unwrap()
        };
        fs::write(destination, bytes).unwrap();
    }
    directory
}

/// The site-packages directory of a real interpreter, without importing anything.
fn site_packages_of(python: &Path) -> PathBuf {
    let output = std::process::Command::new(python)
        .args([
            "-I",
            "-B",
            "-c",
            "import sysconfig; print(sysconfig.get_paths()['purelib'])",
        ])
        .output()
        .unwrap();
    assert!(output.status.success());
    PathBuf::from(String::from_utf8(output.stdout).unwrap().trim())
}

/// Admit a real environment exactly as the application hands it over.
fn acquire_real(python: &Path, root: &Path, config: &Path) -> CpythonScientificJobExecutor {
    CpythonScientificJobExecutor::acquire(
        python,
        site_packages_of(python),
        application_adapters(root),
        config,
    )
}

/// A shell host that answers the admission probe with one framed report.
fn probe_host(root: &Path, name: &str, report_command: &str) -> PathBuf {
    shell_host(
        root,
        name,
        &format!("{report_command} | /usr/bin/python3 -c 'import sys; data=sys.stdin.buffer.read(); sys.stdout.buffer.write(len(data).to_bytes(8, chr(108)+chr(105)+chr(116)+chr(116)+chr(108)+chr(101))); sys.stdout.buffer.write(data)'"),
    )
}

/// A shell command printing the admission report of a host with this nirs4all.
fn report(distribution_version: &Value) -> String {
    format!(
        "printf '%s' '{}'",
        json!({
            "schema": "nirs4all.studio-scientific-cpython-host.v2",
            "implementation": "cpython",
            "version": [3, 11, 0],
            "isolated": true,
            "network_bind_denied": true,
            "distribution_version": distribution_version,
            "distribution_inconsistency": null,
            "import_error": null,
            "ready": true,
        })
    )
}

/// The nirs4all release the embedded catalogue installs, which it admits.
fn catalogue_install_version() -> Value {
    let catalogue: Value =
        serde_json::from_str(include_str!("../../recommended-config.json")).unwrap();
    catalogue["required"]
        .as_array()
        .unwrap()
        .iter()
        .find(|package| package["name"] == "nirs4all")
        .unwrap()["install"]
        .clone()
}

fn refusal(root: &Path, host: &Path) -> (Value, Arc<NativeJobRuntime>) {
    let config = root.join("config");
    fs::create_dir_all(config.join("app_settings.json")).unwrap();
    let site_packages = root.join("site-packages");
    fs::create_dir_all(&site_packages).unwrap();
    let runtime = Arc::new(NativeJobRuntime::with_executor(Arc::new(
        CpythonScientificJobExecutor::acquire(
            host,
            site_packages,
            application_adapters(root),
            &config,
        ),
    )));
    let mut state =
        SidecarState::with_native_jobs_and_app_settings_dir(Arc::clone(&runtime), &config);
    let response = route_request_with_body(
        &mut state,
        "POST",
        "/api/runs/run-groups",
        b"not-json-must-not-be-parsed",
    );
    assert_eq!(response.status, 503);
    (serde_json::from_str(&response.body).unwrap(), runtime)
}

#[test]
fn unusable_hosts_are_typed_before_body_or_workspace_access() {
    let root = test_directory("typed");
    let linked = root.join("venv-python");
    let ready = probe_host(&root, "ready", &report(&catalogue_install_version()));
    // A venv interpreter is a link: the selected path is used as given.
    symlink(&ready, &linked).unwrap();
    let cases = [
        (root.join("missing"), "python_host_unavailable"),
        (
            probe_host(&root, "malformed", "printf nope"),
            "python_host_malformed_response",
        ),
        (
            probe_host(&root, "oversized", "head -c 9000 /dev/zero | tr '\\000' x"),
            "python_host_stdout_too_large",
        ),
        (
            probe_host(&root, "outdated", &report(&json!("0.0.1"))),
            "scientific_distribution_version_unsupported",
        ),
        (
            probe_host(&root, "absent", &report(&Value::Null)),
            "scientific_distribution_missing",
        ),
        // Admitted hosts still need the Rust-owned saved-run resolver.
        (ready, "scientific_request_resolver_unavailable"),
        (linked, "scientific_request_resolver_unavailable"),
    ];
    for (host, expected) in cases {
        let (body, runtime) = refusal(&root, &host);
        assert_eq!(body["error"]["code"], "scientific_executor_unavailable");
        assert_eq!(body["error"]["details"]["reason"], expected);
        assert_eq!(runtime.published_event_count(), 0);
        assert_eq!(runtime.durable_write_count(), 0);
    }
    fs::remove_dir_all(root).unwrap();
}

struct RunningSidecar(Child);

impl Drop for RunningSidecar {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

/// Start the product binary with exactly the given hand-off and return its
/// readiness once the scientific host acquisition has ended.
fn readiness_after_startup(config: &Path, hand_off: &[(&str, &Path)]) -> Value {
    let mut sidecar = RunningSidecar(
        Command::new(env!("CARGO_BIN_EXE_studio-sidecar"))
            .args(["--host", "127.0.0.1", "--port", "0"])
            .env_clear()
            .env("NIRS4ALL_CONFIG", config)
            .env(SCIENTIFIC_EXECUTOR_ENV, SCIENTIFIC_CPYTHON_EXECUTOR_ID)
            .envs(hand_off.iter().copied())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .unwrap(),
    );
    let mut ready = String::new();
    BufReader::new(sidecar.0.stdout.take().unwrap())
        .read_line(&mut ready)
        .unwrap();
    let ready: Value =
        serde_json::from_str(ready.strip_prefix("STUDIO_SIDECAR_READY ").unwrap()).unwrap();
    let url = format!("http://127.0.0.1:{}/api/system/readiness", ready["port"]);
    let client = reqwest::blocking::Client::new();
    let deadline = std::time::Instant::now() + Duration::from_secs(30);
    loop {
        let readiness: Value = client.get(&url).send().unwrap().json().unwrap();
        if readiness["ml_loading"] == false {
            return readiness;
        }
        assert!(
            std::time::Instant::now() < deadline,
            "acquisition did not end"
        );
        std::thread::sleep(Duration::from_millis(20));
    }
}

#[test]
fn product_startup_admits_the_handed_over_environment_and_names_what_is_missing() {
    let root = test_directory("hand-off");
    let host = probe_host(&root, "python", &report(&catalogue_install_version()));
    let site_packages = root.join("site-packages");
    let config = root.join("config");
    fs::create_dir_all(&site_packages).unwrap();
    fs::create_dir_all(&config).unwrap();
    let adapters = application_adapters(&root);
    let hand_off = [
        (PYTHON_PLUGIN_HOST_ENV, host.as_path()),
        (PYTHON_PLUGIN_SITE_PACKAGES_ENV, site_packages.as_path()),
        (STUDIO_ADAPTERS_DIR_ENV, adapters.as_path()),
    ];
    let admitted = readiness_after_startup(&config, &hand_off);
    assert_eq!(admitted["ml_ready"], true, "{admitted}");
    assert!(admitted["ml_error"].is_null());

    for (present, expected) in [
        (&hand_off[..2], "studio_adapters_unavailable"),
        (&hand_off[..1], "python_host_unavailable"),
        (&hand_off[1..], "python_host_unavailable"),
    ] {
        let refused = readiness_after_startup(&config, present);
        assert_eq!(refused["ml_ready"], false);
        assert_eq!(refused["ml_error"], expected);
    }
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn terminal_callback_failure_is_observed_and_disables_future_selection() {
    let Some(python) = std::env::var_os("N4A_STUDIO_REAL_PYTHON").map(PathBuf::from) else {
        return;
    };
    let root = test_directory("terminal-callback");
    fs::create_dir_all(&root).unwrap();
    let config = configured_resolver(&root);
    let executor = acquire_real(&python, &root, &config);
    assert!(executor.is_selected(), "{}", executor.unavailable_reason());
    let request = ScientificExecutionRequest {
        job_id: "run_native_callback_failure".into(),
        workspace_id: "workspace-a".into(),
        workspace_path: root.clone(),
        requested_backend: "local-python".into(),
        payload: json!({
            "schema": "nirs4all.studio-scientific-job.v1",
            "operation": "run",
            "job_id": "run_native_callback_failure",
            "engine": "dag-ml",
            "allow_fallback": false,
            "dataset": {
                "name": "dataset-a",
                "task_type": "regression",
                "X": [[0.0], [1.0], [2.0], [3.0]],
                "y": [0.0, 1.0, 2.0, 3.0]
            },
            "pipeline": {
                "kind": "pls_regression",
                "n_components": 1,
                "scale": true,
                "cross_validation": {"kind": "kfold", "n_splits": 2, "shuffle": false}
            },
            "options": {"name": "pipeline-a", "random_state": 42}
        }),
    };
    executor
        .submit_scientific(&request, Arc::new(RejectingTerminal))
        .unwrap();
    let deadline = std::time::Instant::now() + Duration::from_secs(30);
    while executor.is_selected() && std::time::Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(10));
    }
    assert!(!executor.is_selected());
    assert_eq!(
        executor.unavailable_reason(),
        "scientific_terminal_callback_failed"
    );
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn selected_wheel_executes_closed_path_free_request_through_real_stdio_host() {
    let Some(python) = std::env::var_os("N4A_STUDIO_REAL_PYTHON").map(PathBuf::from) else {
        return;
    };
    let root = test_directory("real-wheel");
    let config = configured_resolver(&root);
    let executor = acquire_real(&python, &root, &config);
    assert!(executor.is_selected(), "{}", executor.unavailable_reason());
    let job_id = "run_native_real_wheel";
    let request = ScientificExecutionRequest {
        job_id: job_id.into(),
        workspace_id: "must-not-cross-stdio".into(),
        workspace_path: PathBuf::from("/must/not/cross/stdio"),
        requested_backend: "local-python".into(),
        payload: json!({
            "schema": "nirs4all.studio-scientific-job.v1",
            "operation": "run",
            "job_id": job_id,
            "engine": "dag-ml",
            "allow_fallback": false,
            "dataset": {
                "name": "studio-real-wheel",
                "task_type": "regression",
                "X": [
                    [0.0, 1.0], [1.0, 0.0], [2.0, 1.0], [3.0, 1.5],
                    [4.0, 2.0], [5.0, 3.0], [6.0, 5.0], [7.0, 8.0]
                ],
                "y": [0.2, 1.1, 1.9, 3.2, 4.1, 5.3, 5.8, 7.4]
            },
            "pipeline": {
                "kind": "pls_regression",
                "n_components": 1,
                "scale": true,
                "cross_validation": {"kind": "kfold", "n_splits": 2, "shuffle": false}
            },
            "options": {"name": "studio-real-wheel", "random_state": 42}
        }),
    };
    let (sender, receiver) = mpsc::sync_channel(1);
    executor
        .submit_scientific(
            &request,
            Arc::new(ChannelTerminal {
                sender: Mutex::new(sender),
            }),
        )
        .unwrap();
    let result = receiver
        .recv_timeout(Duration::from_secs(120))
        .expect("real stdio worker must report one terminal outcome")
        .expect("real stdio worker must complete successfully");
    assert_eq!(result["schema"], "nirs4all.studio-scientific-job-result.v1");
    assert_eq!(result["job_id"], job_id);
    assert_eq!(result["engine"], "dag-ml");
    assert_eq!(result["result"]["model"], "pls_regression");
    assert!(result["result"]["prediction_count"]
        .as_u64()
        .is_some_and(|count| count > 0));
    fs::remove_dir_all(root).unwrap();
}

#[test]
#[allow(clippy::too_many_lines)]
fn selected_wheel_resolves_saved_route_and_persists_only_the_original_request() {
    let Some(python) = std::env::var_os("N4A_STUDIO_REAL_PYTHON").map(PathBuf::from) else {
        return;
    };
    let root = test_directory("saved-route");
    let config = root.join("config");
    let workspace = root.join("workspace");
    let dataset = root.join("dataset");
    fs::create_dir_all(&config).unwrap();
    fs::create_dir_all(workspace.join("runs")).unwrap();
    fs::create_dir_all(workspace.join("pipelines")).unwrap();
    fs::create_dir_all(&dataset).unwrap();
    fs::write(
        config.join("app_settings.json"),
        serde_json::to_vec(&json!({
            "version": "3.0",
            "linked_workspaces": [{
                "id": "workspace-a",
                "path": workspace,
                "name": "Workspace A",
                "is_active": true,
                "linked_at": "2026-09-01T12:00:00Z",
                "last_scanned": null,
                "discovered": {"runs_count": 0}
            }]
        }))
        .unwrap(),
    )
    .unwrap();
    fs::write(
        dataset.join("x.csv"),
        "1000,1001\n1,2\n2,3\n3,4\n4,5\n5,6\n6,7\n7,8\n8,9\n",
    )
    .unwrap();
    fs::write(
        dataset.join("y.csv"),
        "protein\n1.1\n2.2\n3.4\n4.8\n5.3\n6.7\n7.9\n8.6\n",
    )
    .unwrap();
    fs::write(
        config.join("dataset_links.json"),
        serde_json::to_vec(&json!({
            "version": "1.0",
            "schema_version": 2,
            "datasets": [{
                "id": "dataset-a",
                "name": "Dataset A",
                "path": dataset,
                "config": {
                    "delimiter": ",",
                    "decimal_separator": ".",
                    "has_header": true,
                    "header_unit": "cm-1",
                    "signal_type": "auto",
                    "task_type": "regression",
                    "files": [
                        {"path": "x.csv", "type": "X", "split": "train"},
                        {"path": "y.csv", "type": "Y", "split": "train"}
                    ],
                    "targets": [{"column": "protein", "type": "regression", "is_default": true}],
                    "target_selection": {
                        "selected_targets": ["protein"],
                        "default_target": "protein",
                        "task_by_target": {"protein": "regression"}
                    },
                    "default_target": "protein"
                }
            }],
            "groups": []
        }))
        .unwrap(),
    )
    .unwrap();
    fs::write(
        workspace.join("pipelines/pipeline-a.json"),
        serde_json::to_vec(&json!({
            "id": "pipeline-a",
            "name": "PLS",
            "taskType": "regression",
            "steps": [
                {"id": "cv", "type": "splitting", "name": "KFold", "params": {"n_splits": 2, "shuffle": true, "random_state": 42}},
                {"id": "model", "type": "model", "name": "PLSRegression", "params": {"n_components": 1, "scale": true}}
            ]
        }))
        .unwrap(),
    )
    .unwrap();
    let executor = acquire_real(&python, &root, &config);
    assert!(executor.is_selected(), "{}", executor.unavailable_reason());
    let observed_executor = Arc::new(ObservedScientificExecutor {
        inner: Arc::new(executor),
        manager: Mutex::new(None),
        connection: Mutex::new(None),
    });
    let runtime = Arc::new(NativeJobRuntime::with_executor(observed_executor.clone()));
    *observed_executor.manager.lock().unwrap() = Some(runtime.websocket_manager());
    let mut state =
        SidecarState::with_native_jobs_and_app_settings_dir(Arc::clone(&runtime), &config);
    let original_request = json!({
        "legacyConfig": {
            "name": "Native saved campaign",
            "dataset_ids": ["dataset-a"],
            "pipeline_ids": ["pipeline-a"],
            "execution_backend": "local-python",
            "engine": "dag-ml",
            "allow_fallback": false,
            "split_group_by_by_dataset": {}
        },
        "manifest": {
            "version": "studio.native-launch-payload.v1",
            "legacyExperimentName": "Native saved campaign",
            "legacyDatasetCount": 1,
            "legacyPipelineCount": 1,
            "strictCampaignCount": 1,
            "skippedRunCount": 0,
            "sourceRunIds": ["dataset-a::pipeline-a"],
            "skippedRunIds": []
        },
        "strictCampaignSpecs": {
            "splitSpecs": [{
                "id": "single-pair:dataset-a::pipeline-a",
                "sourceRunId": "dataset-a::pipeline-a",
                "sourceDatasetId": "dataset-a",
                "sourcePipelineId": "pipeline-a",
                "campaign": {
                    "name": "Native saved campaign / Dataset A / Pipeline A",
                    "mode": "paired_by_index",
                    "executionBackend": "local-python",
                    "datasets": [{"id": "dataset-a", "name": "Dataset A", "splitGroupBy": null}],
                    "pipelines": [{"id": "pipeline-a", "name": "Pipeline A", "source": "saved"}],
                    "runMatrix": [{
                        "id": "dataset-a::pipeline-a",
                        "datasetId": "dataset-a",
                        "pipelineId": "pipeline-a",
                        "datasetIndex": 0,
                        "pipelineIndex": 0,
                        "splitGroupBy": null
                    }]
                }
            }],
            "skippedRunIds": []
        }
    });
    let response = route_request_with_body(
        &mut state,
        "POST",
        "/api/runs/run-groups",
        &serde_json::to_vec(&original_request).unwrap(),
    );
    assert_eq!(response.status, 202, "{}", response.body);
    let response: Value = serde_json::from_str(&response.body).unwrap();
    let job_id = response["job_id"].as_str().unwrap();
    let deadline = std::time::Instant::now() + Duration::from_secs(120);
    loop {
        let snapshot = runtime.get_at(job_id, std::time::Instant::now()).unwrap();
        if snapshot.status.as_str() != "running" {
            assert_eq!(
                snapshot.status.as_str(),
                "completed",
                "{:?}",
                snapshot.error
            );
            break;
        }
        assert!(
            std::time::Instant::now() < deadline,
            "scientific route timed out"
        );
        std::thread::sleep(Duration::from_millis(20));
    }
    let record = read_execution_job_record(&workspace, job_id).unwrap();
    assert_eq!(record["status"], "completed");
    assert_eq!(record["request"], original_request);
    assert!(!record["request"].to_string().contains("\"X\""));
    assert!(!record["request"].to_string().contains("\"y\""));
    let ObservedJobEvents { mut socket, server } =
        observed_executor.connection.lock().unwrap().take().unwrap();
    let mut events = Vec::new();
    loop {
        let message = read_event_text(&mut socket);
        let event: Value = serde_json::from_str(&message).unwrap();
        assert_eq!(event["channel"], format!("job:{job_id}"));
        let completed = event["type"] == "job_completed";
        events.push(event);
        if completed {
            break;
        }
        assert!(
            std::time::Instant::now() < deadline,
            "missing terminal event"
        );
    }
    assert_eq!(events.first().unwrap()["type"], "job_started");
    assert_eq!(events[0]["data"]["id"], job_id);
    assert_eq!(events[0]["data"]["status"], "running");
    let terminal = events.last().unwrap();
    assert_eq!(terminal["data"]["job_id"], job_id);
    assert_eq!(
        runtime
            .get_at(job_id, std::time::Instant::now())
            .unwrap()
            .result
            .as_ref(),
        Some(&terminal["data"]["result"])
    );
    for event in &events[1..events.len() - 1] {
        assert_eq!(event["type"], "job_progress");
        assert_eq!(event["data"]["job_id"], job_id);
        let progress = event["data"]["progress"].as_f64().unwrap();
        assert!(progress.is_finite() && (0.0..=100.0).contains(&progress));
        assert_eq!(event["data"]["metrics"], json!({}));
        let message = event["data"]["message"].as_str().unwrap();
        assert_ne!(message, "");
        if let Some(elapsed) = message.strip_prefix("Scientific computation running · ") {
            let elapsed = elapsed
                .strip_suffix("s elapsed. Fit progress is unavailable.")
                .unwrap();
            assert!(elapsed.parse::<u64>().is_ok());
        }
    }
    let progress_count = u64::try_from(events.len() - 2).unwrap();
    // One start, truthful activity, one completion.
    let expected = 2 + progress_count;
    // Completed state is committed before its event is published: wait for the
    // observed terminal publication instead of racing the relaxed counter.
    while runtime.published_event_count() < expected {
        assert!(std::time::Instant::now() < deadline);
        std::thread::sleep(Duration::from_millis(1));
    }
    assert_eq!(runtime.published_event_count(), expected);
    assert_eq!(runtime.durable_write_count(), expected);
    socket.close(None).unwrap();
    loop {
        match socket.read() {
            Ok(Message::Text(message)) => panic!("event after terminal: {message}"),
            Ok(Message::Close(_))
            | Err(tungstenite::Error::ConnectionClosed | tungstenite::Error::AlreadyClosed) => {
                break
            }
            Ok(Message::Ping(_) | Message::Pong(_)) => socket.flush().unwrap(),
            Ok(unexpected) => panic!("unexpected closing frame: {unexpected:?}"),
            Err(error) => panic!("websocket close failed: {error}"),
        }
    }
    server.join().unwrap();
    fs::remove_dir_all(root).unwrap();
}
