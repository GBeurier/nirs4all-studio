use super::*;
use std::time::Duration;

fn workspace() -> (tempfile::TempDir, AppSettingsStore, PathBuf) {
    let root = tempfile::tempdir().unwrap();
    let settings = AppSettingsStore::new(root.path().join("settings/config.json"));
    let path = root.path().join("workspace");
    for (route, body) in [
        (
            "/api/workspace/create",
            json!({"path":path,"name":"Public witness"}),
        ),
        ("/api/workspace/select", json!({"path":path})),
    ] {
        let response =
            workspace_documents::route(&settings, "POST", route, body.to_string().as_bytes())
                .unwrap();
        assert_eq!(response.status, 200, "{}", response.body);
    }
    (root, settings, path)
}

fn request(method: &str, path: &str, body: &Value) -> HttpRequest {
    HttpRequest {
        method: method.into(),
        path: path.into(),
        query: None,
        headers: BTreeMap::new(),
        body: if body.is_null() {
            Vec::new()
        } else {
            body.to_string().into_bytes()
        },
    }
}

fn body(response: &HttpResponse) -> Value {
    serde_json::from_str(&response.body).unwrap()
}

/// Library-shaped fake: writes X/y below `output_dir` and returns a file config.
fn writing_adapter(calls: Arc<Mutex<Vec<Value>>>) -> Invoke {
    Arc::new(move |operation, payload, _cancel| {
        assert_eq!(operation, IMPORT_OPERATION);
        calls.lock().unwrap().push(payload.clone());
        let output = Path::new(payload["output_dir"].as_str().unwrap());
        assert!(Path::new(payload["cache_dir"].as_str().unwrap()).is_dir());
        fs::write(output.join("X.csv"), "1000;1002\n0.1;0.2\n").unwrap();
        fs::write(output.join("Y.csv"), "protein\n12.5\n").unwrap();
        Ok(json!({"name":"Corn public","config":{"files":[
            {"path":output.join("X.csv"),"type":"X","split":"train"},
            {"path":output.join("Y.csv"),"type":"Y","split":"train"}]},
            "inspection":{"success":true,"summary":{"num_samples":1,"num_features":2,
                "train_samples":1,"test_samples":0,"n_sources":1,"has_targets":true,
                "has_metadata":false,"metadata_columns":[]}},
            "provenance":{"source_id":"nir"}}))
    })
}

fn wait_terminal(jobs: &NativeJobRuntime, id: &str) -> crate::job_lifecycle::JobSnapshot {
    let start = Instant::now();
    loop {
        let job = jobs.get_at(id, Instant::now()).unwrap();
        if job.status.is_terminal() {
            return job;
        }
        assert!(
            start.elapsed() < Duration::from_secs(20),
            "job did not finish"
        );
        std::thread::sleep(Duration::from_millis(10));
    }
}

fn import_dirs(workspace: &Path) -> Vec<PathBuf> {
    fs::read_dir(workspace.join("imports"))
        .map(|entries| {
            entries
                .map(|entry| entry.unwrap().path())
                .filter(|path| {
                    path.file_name()
                        .unwrap()
                        .to_string_lossy()
                        .starts_with("public-")
                })
                .collect()
        })
        .unwrap_or_default()
}

fn linked(settings: &AppSettingsStore) -> Vec<Value> {
    workspace_documents::catalogue(settings).unwrap()["datasets"]
        .as_array()
        .unwrap()
        .clone()
}

#[test]
fn routes_validate_methods_queries_fields_and_require_a_host() {
    let (_root, settings, _) = workspace();
    let jobs = NativeJobRuntime::default();
    let never: Invoke = Arc::new(|_, _, _| panic!("invalid requests must not reach the host"));
    assert!(owns_path("/api/datasets/public"));
    assert!(owns_path("/api/datasets/public/anything"));
    assert!(!owns_path("/api/datasets/publication"));
    let mut cases = vec![
        (request("POST", "/api/datasets/public", &Value::Null), 405),
        (
            request("GET", "/api/datasets/public/import", &Value::Null),
            405,
        ),
        (
            request("GET", "/api/datasets/public/other", &Value::Null),
            404,
        ),
        (
            request("GET", "/api/datasets/public/imports/a/b", &Value::Null),
            404,
        ),
        (
            request("GET", "/api/datasets/public/imports/%2e%2e", &Value::Null),
            400,
        ),
    ];
    for invalid in [
        json!({}),
        json!({"dataset_id":"../corn"}),
        json!({"dataset_id":"corn","source_id":"a/b"}),
        json!({"dataset_id":"corn","source_id":7}),
        json!({"dataset_id":"corn","output_dir":"/tmp"}),
        json!({"dataset_id":"corn","tier":"private"}),
        json!(["corn"]),
    ] {
        cases.push((
            request("POST", "/api/datasets/public/import", &invalid),
            400,
        ));
    }
    let mut query = request("GET", "/api/datasets/public", &Value::Null);
    query.query = Some("tier=private".into());
    cases.push((query, 400));
    for (request, expected) in cases {
        let response = handle(&settings, &jobs, Some(never.clone()), &request);
        assert_eq!(
            response.status, expected,
            "{} {}",
            request.path, response.body
        );
    }
    for request in [
        request("GET", "/api/datasets/public", &Value::Null),
        request(
            "POST",
            "/api/datasets/public/import",
            &json!({"dataset_id":"corn"}),
        ),
    ] {
        assert_eq!(handle(&settings, &jobs, None, &request).status, 503);
    }
}

#[test]
fn catalogue_needs_no_workspace_and_rejects_malformed_owner_output() {
    let root = tempfile::tempdir().unwrap();
    let settings = AppSettingsStore::new(root.path().join("settings/config.json"));
    let jobs = NativeJobRuntime::default();
    let catalogue: Invoke = Arc::new(|operation, payload, _| {
        assert_eq!(operation, CATALOGUE_OPERATION);
        assert_eq!(payload, &json!({}));
        Ok(json!({"datasets":[{"id":"corn","source_ids":["nir"]}],"version":"1.0.0"}))
    });
    let get = request("GET", "/api/datasets/public", &Value::Null);
    let response = handle(&settings, &jobs, Some(catalogue), &get);
    assert_eq!(response.status, 200, "{}", response.body);
    assert_eq!(body(&response)["datasets"][0]["id"], "corn");
    let malformed: Invoke = Arc::new(|_, _, _| Ok(json!({"datasets":{}})));
    assert_eq!(handle(&settings, &jobs, Some(malformed), &get).status, 502);
    // Import requires the active workspace destination.
    let import = request(
        "POST",
        "/api/datasets/public/import",
        &json!({"dataset_id":"corn"}),
    );
    let never: Invoke = Arc::new(|_, _, _| panic!("no workspace, no import"));
    assert_eq!(handle(&settings, &jobs, Some(never), &import).status, 409);
}

#[test]
fn import_links_once_inside_the_captured_workspace_and_reuses_duplicates() {
    let (_root, settings, workspace) = workspace();
    let jobs = NativeJobRuntime::default();
    let calls = Arc::new(Mutex::new(Vec::new()));
    let import = request(
        "POST",
        "/api/datasets/public/import",
        &json!({"dataset_id":"corn-m5","source_id":"nir"}),
    );
    let response = handle(
        &settings,
        &jobs,
        Some(writing_adapter(calls.clone())),
        &import,
    );
    assert_eq!(response.status, 200, "{}", response.body);
    let receipt = body(&response);
    assert_eq!(receipt["status"], "running");
    let id = receipt["job_id"].as_str().unwrap();
    let job = wait_terminal(&jobs, id);
    assert_eq!(job.status, JobStatus::Completed, "{:?}", job.error);
    let result = job.result.unwrap();
    assert_eq!(result["already_imported"], false);
    let dataset = &result["dataset"];
    assert_eq!(dataset["num_samples"], 1);
    assert_eq!(dataset["config"]["public_dataset"]["dataset_id"], "corn-m5");
    assert_eq!(dataset["config"]["public_dataset"]["source_id"], "nir");
    let canonical = workspace.canonicalize().unwrap();
    let stage = Path::new(dataset["path"].as_str().unwrap());
    assert!(stage.starts_with(canonical.join("imports")));
    assert!(stage.join("X.csv").is_file());
    let payload = calls.lock().unwrap()[0].clone();
    assert_eq!(payload["source_id"], "nir");
    assert!(Path::new(payload["cache_dir"].as_str().unwrap())
        .canonicalize()
        .unwrap()
        .starts_with(&canonical));
    // Status is served from the scoped durable record/registry.
    let status = handle(
        &settings,
        &jobs,
        None,
        &request(
            "GET",
            &format!("/api/datasets/public/imports/{id}"),
            &Value::Null,
        ),
    );
    assert_eq!(status.status, 200, "{}", status.body);
    assert_eq!(body(&status)["status"], "completed");
    assert_eq!(body(&status)["result"]["dataset"]["id"], dataset["id"]);
    // Durable fallback after the in-memory registry is gone.
    let fresh = NativeJobRuntime::default();
    let restored = handle(
        &settings,
        &fresh,
        None,
        &request(
            "GET",
            &format!("/api/datasets/public/imports/{id}"),
            &Value::Null,
        ),
    );
    assert_eq!(body(&restored)["status"], "completed");
    // A repeated click returns the existing dataset without acquisition.
    let again = handle(
        &settings,
        &jobs,
        Some(Arc::new(|_, _, _| {
            panic!("duplicates must not download again")
        })),
        &import,
    );
    let again = wait_terminal(&jobs, body(&again)["job_id"].as_str().unwrap());
    let again = again.result.unwrap();
    assert_eq!(again["already_imported"], true);
    assert_eq!(again["dataset"]["id"], dataset["id"]);
    assert_eq!(linked(&settings).len(), 1);
    assert_eq!(import_dirs(&workspace).len(), 1);
}

#[test]
fn importing_into_another_workspace_keeps_its_own_files() {
    let (root, settings, first_workspace) = workspace();
    let jobs = NativeJobRuntime::default();
    let calls = Arc::new(Mutex::new(Vec::new()));
    let import = request(
        "POST",
        "/api/datasets/public/import",
        &json!({"dataset_id":"corn-m5","source_id":"nir"}),
    );
    let first = handle(
        &settings,
        &jobs,
        Some(writing_adapter(calls.clone())),
        &import,
    );
    let first = wait_terminal(&jobs, body(&first)["job_id"].as_str().unwrap());
    assert_eq!(first.status, JobStatus::Completed);
    let first_dataset = first.result.unwrap()["dataset"].clone();

    let second_workspace = root.path().join("second-workspace");
    for (route, document) in [
        (
            "/api/workspace/create",
            json!({"path":second_workspace,"name":"Second workspace"}),
        ),
        ("/api/workspace/select", json!({"path":second_workspace})),
    ] {
        let response =
            workspace_documents::route(&settings, "POST", route, document.to_string().as_bytes())
                .unwrap();
        assert_eq!(response.status, 200, "{}", response.body);
    }
    let second = handle(
        &settings,
        &jobs,
        Some(writing_adapter(calls.clone())),
        &import,
    );
    let second = wait_terminal(&jobs, body(&second)["job_id"].as_str().unwrap());
    assert_eq!(second.status, JobStatus::Completed);
    let result = second.result.unwrap();
    assert_eq!(result["already_imported"], false);
    assert_ne!(result["dataset"]["id"], first_dataset["id"]);
    assert!(Path::new(result["dataset"]["path"].as_str().unwrap())
        .starts_with(second_workspace.canonicalize().unwrap().join("imports")));
    assert_eq!(calls.lock().unwrap().len(), 2);
    assert_eq!(linked(&settings).len(), 2);
    assert_eq!(import_dirs(&first_workspace).len(), 1);
    assert_eq!(import_dirs(&second_workspace).len(), 1);
}

#[test]
fn unrelated_jobs_are_not_exposed_through_public_status_or_cancel() {
    #[derive(Debug)]
    struct Idle;
    impl ScientificJobExecutor for Idle {
        fn is_selected(&self) -> bool {
            true
        }
        fn preflight_submission(
            &self,
            request: &ScientificSubmissionPreflight,
        ) -> Result<ScientificExecutorSelection, JobExecutorError> {
            Ok(ScientificExecutorSelection {
                execution_backend: "local-python".into(),
                execution_mode: Some("shap-analysis".into()),
                prepared_payload: request.payload.clone(),
            })
        }
        fn submit_scientific(
            &self,
            _: &ScientificExecutionRequest,
            _: Arc<dyn ScientificJobTerminal>,
        ) -> Result<(), JobExecutorError> {
            Ok(())
        }
        fn request_cooperative_cancel(&self, _: &str) -> Result<(), JobExecutorError> {
            panic!("an unrelated job must not be cancelled")
        }
    }
    let (_root, settings, workspace) = workspace();
    let jobs = NativeJobRuntime::default();
    let receipt = jobs
        .submit_with_executor_kind_at(
            JobType::Analysis,
            "SHAP",
            "local-python",
            &json!({}),
            "ws",
            &workspace,
            "2026-11-19T00:00:00Z",
            Instant::now(),
            Arc::new(Idle),
        )
        .unwrap();
    for (method, suffix) in [("GET", ""), ("POST", "/cancel")] {
        let response = handle(
            &settings,
            &jobs,
            None,
            &request(
                method,
                &format!("/api/datasets/public/imports/{}{suffix}", receipt.job_id),
                &Value::Null,
            ),
        );
        assert_eq!(response.status, 404, "{}", response.body);
    }
}

#[test]
fn failed_or_escaping_imports_leave_no_link_and_no_stage() {
    let (root, settings, workspace) = workspace();
    let jobs = NativeJobRuntime::default();
    let outside = root.path().join("outside.csv");
    fs::write(&outside, "1\n").unwrap();
    let escaping = outside.clone();
    let adapters: Vec<Invoke> = vec![
        Arc::new(|_, payload, _| {
            fs::write(
                Path::new(payload["output_dir"].as_str().unwrap()).join("partial.csv"),
                "1\n",
            )
            .unwrap();
            Err("Public dataset download failed".into())
        }),
        Arc::new(move |_, _, _| {
            Ok(
                json!({"name":"Escape","config":{"files":[{"path":escaping,"type":"X"}]},
                "inspection":{"success":true,"summary":{"num_samples":1,"num_features":1,
                "train_samples":1,"test_samples":0,"n_sources":1}}}),
            )
        }),
        Arc::new(|_, payload, _| {
            let output = Path::new(payload["output_dir"].as_str().unwrap());
            fs::write(output.join("X.csv"), "1\n").unwrap();
            Ok(
                json!({"name":"Uninspected","config":{"files":[{"path":output.join("X.csv"),"type":"X"}]},
                "inspection":{"success":false}}),
            )
        }),
    ];
    for adapter in adapters {
        let response = handle(
            &settings,
            &jobs,
            Some(adapter),
            &request(
                "POST",
                "/api/datasets/public/import",
                &json!({"dataset_id":"corn"}),
            ),
        );
        let job = wait_terminal(&jobs, body(&response)["job_id"].as_str().unwrap());
        assert_eq!(job.status, JobStatus::Failed);
        assert!(linked(&settings).is_empty());
        assert!(import_dirs(&workspace).is_empty());
    }
    assert!(outside.is_file());
}

#[cfg(unix)]
#[test]
fn symlinked_library_output_is_refused() {
    let (root, settings, workspace) = workspace();
    let jobs = NativeJobRuntime::default();
    let outside = root.path().join("secret.csv");
    fs::write(&outside, "1\n").unwrap();
    let adapter: Invoke = Arc::new(move |_, payload, _| {
        let output = Path::new(payload["output_dir"].as_str().unwrap());
        fs::write(output.join("X.csv"), "1\n").unwrap();
        std::os::unix::fs::symlink(&outside, output.join("meta.csv")).unwrap();
        Ok(
            json!({"name":"Linked","config":{"files":[{"path":output.join("X.csv"),"type":"X"}]},
            "inspection":{"success":true,"summary":{"num_samples":1,"num_features":1,
            "train_samples":1,"test_samples":0,"n_sources":1}}}),
        )
    });
    let response = handle(
        &settings,
        &jobs,
        Some(adapter),
        &request(
            "POST",
            "/api/datasets/public/import",
            &json!({"dataset_id":"corn"}),
        ),
    );
    let job = wait_terminal(&jobs, body(&response)["job_id"].as_str().unwrap());
    assert_eq!(job.status, JobStatus::Failed);
    assert!(linked(&settings).is_empty());
    assert!(import_dirs(&workspace).is_empty());
}

#[test]
fn cancellation_during_acquisition_is_acknowledged_without_a_dataset() {
    let (_root, settings, workspace) = workspace();
    let jobs = NativeJobRuntime::default();
    let started = Arc::new(AtomicBool::new(false));
    let observed = started.clone();
    let adapter: Invoke = Arc::new(move |_, payload, cancel| {
        fs::write(
            Path::new(payload["output_dir"].as_str().unwrap()).join("partial.csv"),
            "1\n",
        )
        .unwrap();
        observed.store(true, Ordering::Release);
        while !cancel.load(Ordering::Acquire) {
            std::thread::sleep(Duration::from_millis(5));
        }
        Err("process terminated".into())
    });
    let import = request(
        "POST",
        "/api/datasets/public/import",
        &json!({"dataset_id":"corn"}),
    );
    let response = handle(&settings, &jobs, Some(adapter), &import);
    let id = body(&response)["job_id"].as_str().unwrap().to_owned();
    // A second click while running observes the same job.
    let never: Invoke = Arc::new(|_, _, _| panic!("in-flight duplicates must not start"));
    assert_eq!(
        body(&handle(&settings, &jobs, Some(never), &import))["job_id"],
        id
    );
    while !started.load(Ordering::Acquire) {
        std::thread::sleep(Duration::from_millis(5));
    }
    let cancel = handle(
        &settings,
        &jobs,
        None,
        &request(
            "POST",
            &format!("/api/datasets/public/imports/{id}/cancel"),
            &Value::Null,
        ),
    );
    assert_eq!(cancel.status, 200, "{}", cancel.body);
    assert_eq!(body(&cancel)["cancellation_requested"], true);
    assert_eq!(wait_terminal(&jobs, &id).status, JobStatus::Cancelled);
    assert!(linked(&settings).is_empty());
    assert!(import_dirs(&workspace).is_empty());
}

#[test]
fn a_cancellation_winning_the_terminal_race_rolls_back_the_link() {
    let (_root, settings, workspace) = workspace();
    let jobs = NativeJobRuntime::default();
    let inner = writing_adapter(Arc::new(Mutex::new(Vec::new())));
    let runtime = jobs.clone();
    let (send, receive) = std::sync::mpsc::channel::<String>();
    let receive = Mutex::new(receive);
    // Cancellation lands after acquisition, before the worker observes its
    // flag: the registry then records the completion as a cancellation.
    let adapter: Invoke = Arc::new(move |operation, payload, cancel| {
        let result = inner(operation, payload, cancel);
        let id = receive.lock().unwrap().recv().unwrap();
        runtime
            .request_cancel_at(&id, "2026-11-19T00:00:01Z", Instant::now())
            .unwrap();
        cancel.store(false, Ordering::Release);
        result
    });
    let response = handle(
        &settings,
        &jobs,
        Some(adapter),
        &request(
            "POST",
            "/api/datasets/public/import",
            &json!({"dataset_id":"corn"}),
        ),
    );
    let id = body(&response)["job_id"].as_str().unwrap().to_owned();
    send.send(id.clone()).unwrap();
    let job = wait_terminal(&jobs, &id);
    assert_eq!(job.status, JobStatus::Cancelled);
    // The worker compensates right after the terminal decision.
    let start = Instant::now();
    while !(linked(&settings).is_empty() && import_dirs(&workspace).is_empty()) {
        assert!(
            start.elapsed() < Duration::from_secs(20),
            "link was not rolled back"
        );
        std::thread::sleep(Duration::from_millis(10));
    }
}
