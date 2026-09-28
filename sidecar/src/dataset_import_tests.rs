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
fn multimodal_import_links_a_typed_cohort_only_after_scientific_inspection() {
    let (_root, settings) = workspace();
    let descriptor = json!({"schema":"nirs4all.studio-multimodal-dataset.v1",
        "cohort":{"schema":"nirs4all.multimodal-dataset","schema_version":1,
            "sample_ids":["s1","s2"],"sources":[]}});
    let body = json!({"name":"Typed cohort","dataset_document":descriptor});
    let request = HttpRequest {
        method: "POST".into(),
        path: "/api/datasets/import-multimodal".into(),
        query: None,
        headers: BTreeMap::new(),
        body: body.to_string().into_bytes(),
    };
    let response = handle(&settings, &request, &|operation, value| {
        assert_eq!(operation, "dataset.inspect_multimodal");
        assert_eq!(value["dataset_document"], descriptor);
        Ok(
            json!({"success":true,"summary":{"num_samples":2,"num_features":0,
            "train_samples":2,"test_samples":0,"n_sources":1,
            "has_targets":false,"has_metadata":false}}),
        )
    });
    assert_eq!(response.status, 200, "{}", response.body);
    let result: Value = serde_json::from_str(&response.body).unwrap();
    let dataset = &result["dataset"];
    assert_eq!(dataset["name"], "Typed cohort");
    assert_eq!(dataset["config"]["dataset_document"], descriptor);
    let path = Path::new(dataset["path"].as_str().unwrap());
    assert!(path.is_dir());
    assert_eq!(
        serde_json::from_slice::<Value>(&fs::read(path.join("dataset.json")).unwrap()).unwrap(),
        descriptor
    );
    assert_eq!(
        workspace_documents::linked_dataset(&settings, dataset["id"].as_str().unwrap()).unwrap(),
        *dataset
    );
    let refresh = HttpRequest {
        method: "POST".into(),
        path: format!("/api/datasets/{}/refresh", dataset["id"].as_str().unwrap()),
        query: None,
        headers: BTreeMap::new(),
        body: Vec::new(),
    };
    let refreshed = handle(&settings, &refresh, &|operation, value| {
        assert_eq!(operation, "dataset.inspect_multimodal");
        assert_eq!(value["dataset_document"], descriptor);
        Ok(
            json!({"success":true,"summary":{"num_samples":2,"num_features":0,
            "train_samples":2,"test_samples":0,"n_sources":1}}),
        )
    });
    assert_eq!(refreshed.status, 200, "{}", refreshed.body);
}

#[test]
fn multimodal_import_rejects_invalid_or_failed_inspection_without_publishing() {
    let (_root, settings) = workspace();
    for descriptor in [
        json!({"schema":"wrong","cohort":{}}),
        json!({"schema":"nirs4all.studio-multimodal-dataset.v1","cohort":{},"extra":true}),
    ] {
        let request = HttpRequest {
            method: "POST".into(),
            path: "/api/datasets/import-multimodal".into(),
            query: None,
            headers: BTreeMap::new(),
            body: json!({"name":"Bad","dataset_document":descriptor})
                .to_string()
                .into_bytes(),
        };
        let response = handle(&settings, &request, &|_, _| {
            panic!("Invalid descriptor reached the library")
        });
        assert_eq!(response.status, 400);
    }
    let request = HttpRequest {
        method: "POST".into(),
        path: "/api/datasets/import-multimodal".into(),
        query: None,
        headers: BTreeMap::new(),
        body: json!({"name":"\ninvalid", "dataset_document": {
            "schema":"nirs4all.studio-multimodal-dataset.v1","cohort":{}
        }})
        .to_string()
        .into_bytes(),
    };
    let response = handle(&settings, &request, &|_, _| {
        panic!("Invalid name reached the library")
    });
    assert_eq!(response.status, 400);
    let descriptor = json!({"schema":"nirs4all.studio-multimodal-dataset.v1","cohort":{}});
    let request = HttpRequest {
        method: "POST".into(),
        path: "/api/datasets/import-multimodal".into(),
        query: None,
        headers: BTreeMap::new(),
        body: json!({"name":"Bad","dataset_document":descriptor})
            .to_string()
            .into_bytes(),
    };
    let response = handle(&settings, &request, &|_, _| Err("Invalid cohort".into()));
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
fn multimodal_import_reserves_catalogue_capacity_for_other_datasets() {
    let (_root, settings) = workspace();
    let descriptor = json!({"schema":"nirs4all.studio-multimodal-dataset.v1",
        "cohort":{"values": vec![0u8; 115_000]}});
    assert!(serde_json::to_vec(&descriptor).unwrap().len() < 1024 * 1024);
    let request = HttpRequest {
        method: "POST".into(),
        path: "/api/datasets/import-multimodal".into(),
        query: None,
        headers: BTreeMap::new(),
        body: json!({"name":"Oversized catalogue", "dataset_document":descriptor})
            .to_string()
            .into_bytes(),
    };
    let response = handle(&settings, &request, &|operation, _| {
        assert_eq!(operation, "dataset.inspect_multimodal");
        Ok(
            json!({"success":true,"summary":{"num_samples":1,"num_features":0,
            "train_samples":1,"test_samples":0,"n_sources":1}}),
        )
    });
    assert_eq!(response.status, 413, "{}", response.body);
    assert!(response.body.contains("insufficient catalogue space"));
    assert_eq!(
        fs::read_dir(import_parent(&settings).unwrap())
            .unwrap()
            .count(),
        0
    );
    assert_eq!(
        workspace_documents::catalogue(&settings).unwrap()["datasets"],
        json!([])
    );
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
