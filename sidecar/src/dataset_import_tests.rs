use super::*;

fn request(path: &str, metadata: &Value, files: &[(&str, &[u8])]) -> HttpRequest {
    let mut body =
        format!("--x\r\nContent-Disposition: form-data; name=\"metadata\"\r\n\r\n{metadata}\r\n")
            .into_bytes();
    for (name, bytes) in files {
        body.extend_from_slice(format!("--x\r\nContent-Disposition: form-data; name=\"files\"; filename=\"{name}\"\r\nContent-Type: application/octet-stream\r\n\r\n").as_bytes());
        body.extend_from_slice(bytes);
        body.extend_from_slice(b"\r\n");
    }
    body.extend_from_slice(b"--x--\r\n");
    HttpRequest {
        method: "POST".into(),
        path: path.into(),
        query: None,
        headers: BTreeMap::from([(
            "content-type".into(),
            "multipart/form-data; boundary=x".into(),
        )]),
        body,
    }
}

fn workspace() -> (tempfile::TempDir, AppSettingsStore) {
    let root = tempfile::tempdir().unwrap();
    let settings = AppSettingsStore::new(root.path().join("settings/config.json"));
    let path = root.path().join("workspace");
    for (route, body) in [
        (
            "/api/workspace/create",
            json!({"path":path,"name":"Import witness"}),
        ),
        ("/api/workspace/select", json!({"path":path})),
    ] {
        let response =
            workspace_documents::route(&settings, "POST", route, body.to_string().as_bytes())
                .unwrap();
        assert_eq!(response.status, 200, "{}", response.body);
    }
    (root, settings)
}

fn adapter(operation: &str, value: &Value) -> Result<Value, String> {
    match operation {
        "dataset.configure" => Ok(value["record"]["config"].clone()),
        "dataset.preview" => {
            let path = value["config"]["files"][0]["path"].as_str().unwrap();
            assert_eq!(fs::read(path).unwrap(), b"1,2\n3,4\n");
            Ok(
                json!({"success":true,"summary":{"num_samples":2,"num_features":2,
                "train_samples":2,"test_samples":0,"n_sources":1,"has_targets":false,"has_metadata":false}}),
            )
        }
        _ => Err(format!("Unexpected operation {operation}")),
    }
}

#[test]
fn rejects_paths_duplicates_and_unselected_files_before_adapter() {
    let (_root, settings) = workspace();
    let metadata = json!({"files":[{"path":"X.csv","type":"X","split":"train"}],"parsing":{}});
    for files in [
        vec![("../X.csv", b"1,2\n3,4\n".as_slice())],
        vec![("X.csv", b"1".as_slice()), ("x.csv", b"2".as_slice())],
        vec![("X.csv", b"1".as_slice()), ("hidden.csv", b"2".as_slice())],
    ] {
        let response = handle(
            &settings,
            &request("/api/datasets/preview-upload", &metadata, &files),
            &|_, _| panic!("Invalid upload must not reach the library"),
        );
        assert_eq!(response.status, 400);
    }
}

#[test]
fn preview_cleans_temporary_bytes_and_import_persists_original_files_and_metadata() {
    let (_root, settings) = workspace();
    let config = json!({"name":"Selected dataset name","files":[{"path":"X.csv","type":"X","split":"train"}]});
    let captured = Mutex::new(None);
    let preview = handle(
        &settings,
        &request(
            "/api/datasets/preview-upload",
            &json!({"files":config["files"],"parsing":{}}),
            &[("X.csv", b"1,2\n3,4\n")],
        ),
        &|operation, value| {
            if operation == "dataset.preview" {
                *captured.lock().unwrap() = Some(
                    value["config"]["files"][0]["path"]
                        .as_str()
                        .unwrap()
                        .to_owned(),
                );
            }
            adapter(operation, value)
        },
    );
    assert_eq!(preview.status, 200, "{}", preview.body);
    assert!(!Path::new(captured.lock().unwrap().as_ref().unwrap()).exists());
    let response = handle(
        &settings,
        &request(
            "/api/datasets/upload",
            &json!({"config":config}),
            &[("X.csv", b"1,2\n3,4\n")],
        ),
        &adapter,
    );
    assert_eq!(response.status, 200, "{}", response.body);
    let value: Value = serde_json::from_str(&response.body).unwrap();
    let dataset = &value["dataset"];
    assert_eq!(dataset["name"], "Selected dataset name");
    assert_eq!(dataset["num_samples"], 2);
    assert_eq!(dataset["num_features"], 2);
    let bytes = fs::read(dataset["config"]["files"][0]["path"].as_str().unwrap()).unwrap();
    assert_eq!(bytes, b"1,2\n3,4\n");
    let stored =
        workspace_documents::linked_dataset(&settings, dataset["id"].as_str().unwrap()).unwrap();
    assert_eq!(stored, dataset.clone());
}

#[test]
fn failed_import_does_not_publish_a_link_or_keep_partial_files() {
    let (_root, settings) = workspace();
    let response = handle(
        &settings,
        &request(
            "/api/datasets/upload",
            &json!({"config":{"files":[{"path":"X.csv","type":"X","split":"train"}]}}),
            &[("X.csv", b"1,2\n3,4\n")],
        ),
        &|operation, value| {
            if operation == "dataset.configure" {
                adapter(operation, value)
            } else {
                Err("Reader rejected invalid matrix".into())
            }
        },
    );
    assert_eq!(response.status, 400);
    let parent = import_parent(&settings).unwrap();
    assert_eq!(fs::read_dir(parent).unwrap().count(), 0);
    let listing = workspace_documents::route(&settings, "GET", "/api/datasets", b"").unwrap();
    assert_eq!(
        serde_json::from_str::<Value>(&listing.body).unwrap()["total"],
        0
    );
}

#[test]
fn preview_preserves_explicit_parsing_in_the_stored_config_adapter_shape() {
    let (_root, settings) = workspace();
    let response = handle(
        &settings,
        &request(
            "/api/datasets/preview-upload",
            &json!({"files":[{"path":"X.csv","type":"X","split":"train"}],
            "parsing":{"delimiter":",","has_header":false,"decimal_separator":"."}}),
            &[("X.csv", b"1,2\n3,4\n")],
        ),
        &|operation, value| {
            if operation == "dataset.configure" {
                assert_eq!(value["record"]["config"]["delimiter"], ",");
                assert_eq!(value["record"]["config"]["has_header"], false);
            }
            if operation == "dataset.preview" {
                assert_eq!(value["max_input_bytes"], 512 * 1024 * 1024);
            }
            adapter(operation, value)
        },
    );
    assert_eq!(response.status, 200, "{}", response.body);
}

#[test]
fn refresh_refuses_metadata_from_a_stale_configuration() {
    let (root, settings) = workspace();
    let file = root.path().join("X.csv");
    fs::write(&file, b"1,2\n3,4\n").unwrap();
    let config = json!({"files":[{"path":file,"type":"X","split":"train"}]});
    let linked = workspace_documents::route(
        &settings,
        "POST",
        "/api/datasets/link",
        json!({"path":root.path(),"config":config})
            .to_string()
            .as_bytes(),
    )
    .unwrap();
    let record = serde_json::from_str::<Value>(&linked.body).unwrap()["dataset"].clone();
    let id = record["id"].as_str().unwrap();
    let mut current = record.clone();
    current["config"]["has_header"] = json!(false);
    workspace_documents::route(
        &settings,
        "PUT",
        &format!("/api/datasets/{id}"),
        json!({"config":current["config"]}).to_string().as_bytes(),
    )
    .unwrap();
    let error = workspace_documents::refresh_inspected_dataset(
        &settings,
        id,
        &record,
        &json!({"summary":{"num_samples":999}}),
    )
    .unwrap_err();
    assert_eq!(error.0, 409);
    assert_eq!(
        workspace_documents::linked_dataset(&settings, id).unwrap()["num_samples"],
        Value::Null
    );
}
