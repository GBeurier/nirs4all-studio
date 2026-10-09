//! Native workspace discovery and storage accounting. No scientific arrays are read.
use crate::{
    settings::{AppSettingsStore, LinkedWorkspaceAccess},
    HttpRequest, HttpResponse, SidecarState,
};
use serde_json::{json, Value};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};

const MAX_FILES: usize = 100_000;
const MAX_ROWS: usize = 20_000;

#[derive(Eq, Ord, PartialEq, PartialOrd)]
struct DatasetCohortKey {
    name: String,
    declared_link: Option<String>,
    content_hash: Option<String>,
}

fn endpoint(path: &str) -> Option<(Option<&str>, &str)> {
    match path {
        "/api/workspaces" => Some((None, "catalogue")),
        "/api/workspace/stats" => Some((None, "stats")),
        "/api/workspace/storage-status" => Some((None, "storage-status")),
        _ => {
            let (id, kind) = path.strip_prefix("/api/workspaces/")?.split_once('/')?;
            if id.is_empty()
                || !matches!(
                    kind,
                    "scan" | "datasets/discovered" | "predictions" | "exports" | "templates"
                )
            {
                return None;
            }
            Some((Some(id), kind))
        }
    }
}

pub fn route(runtime: &Arc<Mutex<SidecarState>>, request: &HttpRequest) -> Option<HttpResponse> {
    endpoint(&request.path)?;
    let settings = runtime
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .app_settings
        .clone();
    Some(dispatch(&settings, request))
}

fn failure(status: u16, detail: impl Into<String>) -> HttpResponse {
    HttpResponse::json(status, json!({"detail":detail.into()}).to_string())
}

fn dispatch(settings: &AppSettingsStore, request: &HttpRequest) -> HttpResponse {
    let Some((id, kind)) = endpoint(&request.path) else {
        return failure(404, "Route not found");
    };
    let method = if kind == "scan" { "POST" } else { "GET" };
    if request.method != method {
        return crate::method_not_allowed(&request.method, &request.path, method);
    }
    if request
        .query
        .as_deref()
        .is_some_and(|query| !query.is_empty())
    {
        return failure(400, "Workspace discovery takes no query fields");
    }
    if !request.body.is_empty() && request.body != b"{}" {
        return failure(400, "Workspace discovery takes no request fields");
    }
    if kind == "catalogue" {
        let mut response = match settings.linked_workspaces_response() {
            Ok(value) => value,
            Err(error) => return failure(409, error),
        };
        for workspace in response["workspaces"].as_array_mut().into_iter().flatten() {
            let Some(id) = workspace["id"].as_str() else {
                continue;
            };
            match settings
                .linked_workspace_access(id)
                .and_then(|access| access.ok_or_else(|| "Workspace not found".into()))
                .and_then(|access| scan(&access, settings, false))
            {
                Ok(value) => workspace["discovered"] = value["discovered"].clone(),
                Err(error) => {
                    workspace["scan_error"] = json!(error);
                }
            }
        }
        return HttpResponse::json(200, response.to_string());
    }
    let access = match id {
        Some(raw) => {
            let Ok(id) = percent_encoding::percent_decode_str(raw).decode_utf8() else {
                return failure(400, "Invalid workspace identifier");
            };
            if id.is_empty()
                || id.len() > 256
                || id.contains(['/', '\\', '\0'])
                || matches!(id.as_ref(), "." | "..")
            {
                return failure(400, "Invalid workspace identifier");
            }
            settings.linked_workspace_access(&id)
        }
        None => settings.active_linked_workspace_access(),
    };
    let access = match access {
        Ok(Some(access)) => access,
        Ok(None) => return failure(if id.is_some() { 404 } else { 409 }, "Workspace not found"),
        Err(error) => return failure(409, error),
    };
    let value = match scan(&access, settings, kind == "stats") {
        Ok(value) => value,
        Err(error) => return failure(409, error),
    };
    let response = match kind {
        "scan" => {
            if let Err(error) = settings.record_workspace_scan(
                access.id(),
                &value["discovered"],
                value["scanned_at"].as_str().unwrap_or_default(),
            ) {
                return failure(500, error);
            }
            json!({"workspace_id":access.id(),"workspace_name":value["workspace_name"],"discovered":value["discovered"],"datasets":value["datasets"],"scanned_at":value["scanned_at"],"message":value["message"]})
        }
        "datasets/discovered" => {
            json!({"workspace_id":access.id(),"datasets":value["datasets"],"total":value["datasets"].as_array().map_or(0,Vec::len)})
        }
        "predictions" | "exports" | "templates" => {
            json!({"workspace_id":access.id(),kind:value[kind],"total":value[kind].as_array().map_or(0,Vec::len)})
        }
        "storage-status" => value["storage_status"].clone(),
        "stats" => value["stats"].clone(),
        _ => return failure(404, "Route not found"),
    };
    HttpResponse::json(200, response.to_string())
}

/// Count regular files only. Directory symlinks/reparse links are never traversed.
fn files(root: &Path) -> Result<Vec<(PathBuf, u64)>, String> {
    if !root.exists() {
        return Ok(Vec::new());
    }
    let mut result = Vec::new();
    let mut stack = vec![(root.to_owned(), 0usize)];
    let mut visited = 0usize;
    while let Some((directory, depth)) = stack.pop() {
        if depth > 32 {
            return Err("Workspace directory depth exceeds 32".into());
        }
        let metadata = fs::symlink_metadata(&directory).map_err(|error| error.to_string())?;
        if metadata.file_type().is_symlink() {
            continue;
        }
        for entry in fs::read_dir(directory).map_err(|error| error.to_string())? {
            visited += 1;
            if visited > MAX_FILES {
                return Err("Workspace scan exceeds 100000 entries".into());
            }
            let entry = entry.map_err(|error| error.to_string())?;
            let metadata = fs::symlink_metadata(entry.path()).map_err(|error| error.to_string())?;
            if metadata.file_type().is_symlink() {
                continue;
            }
            if metadata.is_dir() {
                stack.push((entry.path(), depth + 1));
            } else if metadata.is_file() {
                result.push((entry.path(), metadata.len()));
            }
        }
    }
    result.sort_by(|a, b| a.0.cmp(&b.0));
    Ok(result)
}

type DatasetCohorts = BTreeMap<DatasetCohortKey, (BTreeSet<String>, Value)>;

fn read_store_cohorts(
    store: &rusqlite::Connection,
) -> Result<(DatasetCohorts, i64, i64, bool), String> {
    let mut datasets: DatasetCohorts = BTreeMap::new();
    let runs: i64 = store
        .query_row("SELECT COUNT(*) FROM runs", [], |row| row.get(0))
        .map_err(|error| error.to_string())?;
    let predictions: i64 = store
        .query_row("SELECT COUNT(*) FROM predictions", [], |row| row.get(0))
        .map_err(|error| error.to_string())?;
    let legacy:bool=store.query_row("SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='prediction_arrays')",[],|row|row.get(0)).map_err(|error|error.to_string())?;
    let mut statement = store
        .prepare("SELECT run_id, datasets FROM runs LIMIT 20001")
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?))
        })
        .map_err(|error| error.to_string())?;
    for (index, row) in rows.enumerate() {
        if index >= MAX_ROWS {
            return Err("Workspace discovery exceeds 20000 runs".into());
        }
        let (run, serialized) = row.map_err(|error| error.to_string())?;
        let Some(serialized) = serialized else {
            continue;
        };
        let values: Value = serde_json::from_str(&serialized)
            .map_err(|error| format!("Invalid run dataset metadata: {error}"))?;
        for dataset in values.as_array().ok_or("Run datasets must be an array")? {
            let name = dataset
                .as_str()
                .or_else(|| dataset["name"].as_str())
                .unwrap_or_default();
            if name.is_empty() {
                continue;
            }
            let identity = DatasetCohortKey {
                name: name.into(),
                // Preserve declaration presence even for malformed IDs;
                // these must never merge into a legacy name-only cohort.
                declared_link: dataset.get("linked_dataset_id").map(Value::to_string),
                content_hash: dataset["hash"]
                    .as_str()
                    .filter(|hash| !hash.is_empty())
                    .map(str::to_owned),
            };
            let entry = datasets.entry(identity).or_insert_with(|| {
                (
                    BTreeSet::new(),
                    if dataset.is_object() {
                        dataset.clone()
                    } else {
                        json!({"name":name})
                    },
                )
            });
            entry.0.insert(run.clone());
        }
    }
    Ok((datasets, runs, predictions, legacy))
}

fn resolve_cohort_paths(
    datasets: DatasetCohorts,
    links: &[crate::settings::DatasetLinkIdentity],
) -> Vec<Value> {
    datasets
        .into_iter()
        .map(|(identity, (runs, mut value))| {
            let name = identity.name;
            let path = value.get("linked_dataset_id").map_or_else(
                || {
                    let candidates: Vec<_> =
                        links.iter().filter(|link| link.name == name).collect();
                    value["path"]
                        .as_str()
                        .filter(|path| !path.is_empty())
                        .map(str::to_owned)
                        .or_else(|| (candidates.len() == 1).then(|| candidates[0].path.clone()))
                        .unwrap_or_default()
                },
                |declared_id| {
                    let candidates: Vec<_> = declared_id
                        .as_str()
                        .filter(|id| !id.is_empty())
                        .into_iter()
                        .flat_map(|id| links.iter().filter(move |link| link.id == id))
                        .collect();
                    // An explicit identity is authoritative. Removed, malformed or
                    // ambiguous links remain unresolved, including legacy paths.
                    if candidates.len() == 1 {
                        candidates[0].path.clone()
                    } else {
                        String::new()
                    }
                },
            );
            value["name"] = json!(name);
            value["path"] = json!(path);
            value["runs_count"] = json!(runs.len());
            value["hashes_seen"] = json!(value["hash"]
                .as_str()
                .filter(|hash| !hash.is_empty())
                .into_iter()
                .collect::<Vec<_>>());
            value["versions_seen"] = json!(["v5"]);
            value["status"] = json!(if path.is_empty() {
                "unknown"
            } else if Path::new(&path).exists() {
                "valid"
            } else {
                "missing"
            });
            value
        })
        .collect()
}

// Byte counts beyond 2^52 are not representable exactly, and the percentage
// is a display ratio rounded by the client, so the f64 conversion is intended.
#[allow(clippy::cast_precision_loss)]
fn percentage(size: u64, total: u64) -> f64 {
    if total == 0 {
        0.0
    } else {
        size as f64 / total as f64 * 100.0
    }
}

fn scan(
    access: &LinkedWorkspaceAccess,
    settings: &AppSettingsStore,
    include_external_sizes: bool,
) -> Result<Value, String> {
    let root = access.path();
    let store_path = crate::workspace_store::workspace_store_path(root);
    let content = store_path
        .as_ref()
        .and_then(|path| path.parent())
        .unwrap_or(root);
    let all = files(root)?;
    let (datasets, runs_count, predictions_count, has_prediction_arrays_table) =
        if let Some(store) = access.store() {
            read_store_cohorts(&store)?
        } else {
            if root.join("store.duckdb").exists()
                || all.iter().any(|(path, _)| {
                    path.starts_with(root.join("runs"))
                        || path.starts_with(root.join("workspace/runs"))
                        || path.starts_with(root.join("nirs4all_results"))
                })
            {
                return Err(
                    "Workspace result format requires migration before native discovery".into(),
                );
            }
            (BTreeMap::new(), 0, 0, false)
        };
    let links = settings.dataset_links()?;
    let datasets = resolve_cohort_paths(datasets, &links);
    let exports:Vec<Value>=all.iter().filter(|(path,_)|path.starts_with(content.join("exports")) && path.extension().is_some_and(|extension|matches!(extension.to_str(),Some("n4a" | "json" | "csv")))).map(|(path,size)|json!({"type":if path.extension().is_some_and(|value|value=="n4a"){"n4a_bundle"}else{"pipeline_json"},"name":path.file_stem().and_then(|value|value.to_str()),"path":path,"size_bytes":size})).collect();
    let templates:Vec<Value>=all.iter().filter(|(path,_)|path.starts_with(content.join("library/templates")) && path.extension().is_some_and(|extension|extension=="json")).map(|(path,_)|json!({"type":"template","name":path.file_stem().and_then(|value|value.to_str()),"path":path})).collect();
    let predictions:Vec<Value>=all.iter().filter(|(path,_)|path.starts_with(content.join("arrays")) && path.extension().is_some_and(|extension|extension=="parquet")).map(|(path,size)|json!({"dataset":path.file_stem().and_then(|value|value.to_str()),"format":"parquet","path":path,"size_bytes":size})).collect();
    let total_size: u64 = all.iter().map(|(_, size)| size).sum();
    let categories = [
        ("Runs", "runs"),
        ("Exports", "exports"),
        ("Templates", "library/templates"),
        ("Trained models", "library/trained"),
        ("Prediction arrays", "arrays"),
        ("Cache", ".cache"),
        ("Temp", ".tmp"),
    ];
    let usage:Vec<Value>=categories.iter().map(|(name,directory)|{let entries:Vec<_>=all.iter().filter(|(path,_)|path.starts_with(content.join(directory))).collect();let size:u64=entries.iter().map(|(_,size)|size).sum();json!({"name":name,"size_bytes":size,"file_count":entries.len(),"percentage":percentage(size,total_size)})}).collect();
    let arrays_size: u64 = all
        .iter()
        .filter(|(path, _)| path.starts_with(content.join("arrays")))
        .map(|(_, size)| size)
        .sum();
    let store_size = all
        .iter()
        .find(|(path, _)| path == &content.join("store.sqlite"))
        .map_or(0, |(_, size)| *size);
    let external_size = if include_external_sizes {
        links.iter().try_fold(0u64, |size, link| {
            if Path::new(&link.path).is_dir() {
                files(Path::new(&link.path))
                    .map(|items| size + items.iter().map(|(_, bytes)| bytes).sum::<u64>())
            } else {
                Ok(size)
            }
        })?
    } else {
        0
    };
    let record = settings.linked_workspaces_response()?["workspaces"]
        .as_array()
        .and_then(|items| {
            items
                .iter()
                .find(|item| item["id"].as_str() == Some(access.id()))
        })
        .cloned()
        .ok_or("Workspace not found")?;
    let storage_status = json!({"storage_mode":if has_prediction_arrays_table{"legacy"}else if content.join("store.sqlite").exists(){"migrated"}else{"new"},"has_prediction_arrays_table":has_prediction_arrays_table,"has_arrays_directory":content.join("arrays").is_dir(),"migration_needed":has_prediction_arrays_table});
    let model_count = all
        .iter()
        .filter(|(path, _)| {
            path.extension().is_some_and(|extension| extension == "n4a")
                || (path.starts_with(content.join("library/trained"))
                    && path.file_name().is_some_and(|name| name == "pipeline.json"))
        })
        .count();
    let counts = json!({"runs_count":runs_count,"datasets_count":datasets.len(),"predictions_count":predictions_count,"exports_count":exports.len(),"templates_count":templates.len()});
    let now = crate::websocket_transport::rfc3339_now();
    let stats = json!({"path":root,"name":record["name"],"created_at":record["linked_at"],"last_accessed":record["linked_at"],"total_size_bytes":total_size,"space_usage":usage,"linked_datasets_count":links.len(),"linked_datasets_external_size":external_size,"duckdb_size_bytes":store_size,"parquet_arrays_size_bytes":arrays_size,"storage_mode":storage_status["storage_mode"],"runs_count":runs_count,"datasets_count":datasets.len(),"predictions_count":predictions_count,"models_count":model_count});
    Ok(
        json!({"workspace_id":access.id(),"workspace_name":record["name"],"discovered":counts,"datasets":datasets,"predictions":predictions,"exports":exports,"templates":templates,"scanned_at":now,"message":"Workspace scan completed","stats":stats,"storage_status":storage_status}),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn bounded_walk_counts_nested_files_and_skips_symlinks() {
        let directory = tempfile::tempdir().unwrap();
        fs::create_dir(directory.path().join("runs")).unwrap();
        fs::write(directory.path().join("runs/file"), b"abc").unwrap();
        fs::write(directory.path().join("store.sqlite"), b"12345").unwrap();
        let found = files(directory.path()).unwrap();
        assert_eq!(found.len(), 2);
        assert_eq!(found.iter().map(|(_, size)| size).sum::<u64>(), 8);
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(directory.path(), directory.path().join("loop")).unwrap();
            assert_eq!(files(directory.path()).unwrap().len(), 2);
        }
    }
    #[test]
    fn only_explicit_workspace_views_match() {
        assert!(endpoint("/api/workspaces/a/datasets/discovered").is_some());
        assert!(endpoint("/api/workspaces/a/scan").is_some());
        assert!(endpoint("/api/workspaces/a/runs").is_none());
        assert!(endpoint("/api/workspaces/a/scan/extra").is_none());
    }
    fn request(method: &str, path: &str) -> HttpRequest {
        HttpRequest {
            method: method.into(),
            path: path.into(),
            query: None,
            headers: BTreeMap::default(),
            body: Vec::new(),
        }
    }
    #[test]
    fn real_store_counters_scan_persistence_and_authorized_discovery() {
        let directory = tempfile::tempdir().unwrap();
        let workspace = directory.path().join("workspace");
        let config = directory.path().join("config");
        fs::create_dir_all(&workspace).unwrap();
        fs::create_dir_all(&config).unwrap();
        let connection = rusqlite::Connection::open(workspace.join("store.sqlite")).unwrap();
        connection.execute_batch("CREATE TABLE runs(run_id TEXT,datasets TEXT);CREATE TABLE predictions(prediction_id TEXT);INSERT INTO runs VALUES ('run-a','[{\"name\":\"Corn\"}]'),('run-b','[{\"name\":\"Corn\"}]');INSERT INTO predictions VALUES ('one'),('two'),('three');").unwrap();
        drop(connection);
        fs::create_dir(workspace.join("arrays")).unwrap();
        fs::write(workspace.join("arrays/Corn.parquet"), b"PAR1test").unwrap();
        fs::write(config.join("app_settings.json"),json!({"linked_workspaces":[{"id":"a","name":"QA","path":workspace,"is_active":true,"linked_at":"2026-10-09T00:00:00Z"}]}).to_string()).unwrap();
        let settings = AppSettingsStore::new(&config);
        let response = dispatch(&settings, &request("GET", "/api/workspace/stats"));
        assert_eq!(response.status, 200, "{}", response.body);
        let value: Value = serde_json::from_str(&response.body).unwrap();
        assert_eq!(value["runs_count"], 2);
        assert_eq!(value["predictions_count"], 3);
        assert_eq!(value["datasets_count"], 1);
        assert_eq!(value["parquet_arrays_size_bytes"], 8);
        assert!(value["total_size_bytes"].as_u64().unwrap() > 8);
        let response = dispatch(&settings, &request("POST", "/api/workspaces/a/scan"));
        assert_eq!(response.status, 200, "{}", response.body);
        let catalogue = settings.linked_workspaces_response().unwrap();
        assert_eq!(catalogue["workspaces"][0]["discovered"]["runs_count"], 2);
        assert!(catalogue["workspaces"][0]["last_scanned"]
            .as_str()
            .is_some());
        let response = dispatch(
            &settings,
            &request("GET", "/api/workspaces/a/datasets/discovered"),
        );
        let value: Value = serde_json::from_str(&response.body).unwrap();
        assert_eq!(value["datasets"][0]["name"], "Corn");
        assert_eq!(value["datasets"][0]["runs_count"], 2);
        assert_eq!(value["datasets"][0]["status"], "unknown");
        assert_eq!(
            dispatch(
                &settings,
                &request("GET", "/api/workspaces/foreign/datasets/discovered")
            )
            .status,
            404
        );
        assert_eq!(
            dispatch(&settings, &request("GET", "/api/workspaces/a/scan")).status,
            405
        );
    }

    fn discover_test_cohorts(directory: &Path, cohorts: &[Value], links: &Value) -> Value {
        let workspace = directory.join("workspace");
        let config = directory.join("config");
        fs::create_dir_all(&workspace).unwrap();
        fs::create_dir_all(&config).unwrap();
        let connection = rusqlite::Connection::open(workspace.join("store.sqlite")).unwrap();
        connection
            .execute_batch("CREATE TABLE runs(run_id TEXT,datasets TEXT);CREATE TABLE predictions(prediction_id TEXT);")
            .unwrap();
        for (index, cohort) in cohorts.iter().enumerate() {
            connection
                .execute(
                    "INSERT INTO runs VALUES (?,?)",
                    rusqlite::params![format!("run-{index}"), json!([cohort]).to_string()],
                )
                .unwrap();
        }
        drop(connection);
        fs::write(
            config.join("app_settings.json"),
            json!({"linked_workspaces":[{"id":"a","name":"QA","path":workspace,"is_active":true,"linked_at":"2026-10-09T00:00:00Z"}]}).to_string(),
        ).unwrap();
        fs::write(config.join("dataset_links.json"), links.to_string()).unwrap();
        let settings = AppSettingsStore::new(&config);
        let response = dispatch(
            &settings,
            &request("GET", "/api/workspaces/a/datasets/discovered"),
        );
        assert_eq!(response.status, 200, "{}", response.body);
        serde_json::from_str(&response.body).unwrap()
    }

    #[test]
    fn duplicate_basenames_preserve_exact_links_and_cohort_run_counts() {
        let directory = tempfile::tempdir().unwrap();
        let beer_path = directory.path().join("Beer/raw");
        let alpine_path = directory.path().join("Alpine/raw");
        fs::create_dir_all(&beer_path).unwrap();
        fs::create_dir_all(&alpine_path).unwrap();
        let beer = json!({"name":"raw","hash":"beer-cohort","linked_dataset_id":"beer","path":"obsolete-path"});
        let alpine = json!({"name":"raw","hash":"alpine-cohort","linked_dataset_id":"alpine"});
        let value = discover_test_cohorts(
            directory.path(),
            &[beer.clone(), beer, alpine],
            &json!({"datasets":[{"id":"beer","name":"raw","path":beer_path},{"id":"alpine","name":"raw","path":alpine_path}]}),
        );
        assert_eq!(value["total"], 2);
        let cohorts = value["datasets"].as_array().unwrap();
        let beer = cohorts
            .iter()
            .find(|row| row["linked_dataset_id"] == "beer")
            .unwrap();
        let alpine = cohorts
            .iter()
            .find(|row| row["linked_dataset_id"] == "alpine")
            .unwrap();
        assert_eq!(beer["path"], json!(beer_path));
        assert_eq!(beer["status"], "valid");
        assert_eq!(beer["runs_count"], 2);
        assert_eq!(beer["hashes_seen"], json!(["beer-cohort"]));
        assert_eq!(alpine["path"], json!(alpine_path));
        assert_eq!(alpine["status"], "valid");
        assert_eq!(alpine["runs_count"], 1);
    }

    #[test]
    fn changed_hashes_or_link_ids_do_not_merge_same_named_cohorts() {
        let directory = tempfile::tempdir().unwrap();
        let value = discover_test_cohorts(
            directory.path(),
            &[
                json!({"name":"raw","hash":"first","linked_dataset_id":"same"}),
                json!({"name":"raw","hash":"second","linked_dataset_id":"same"}),
                json!({"name":"raw","hash":"first","linked_dataset_id":"different"}),
                json!({"name":"raw","hash":"first"}),
                json!({"name":"raw","hash":"second"}),
            ],
            &json!({"datasets":[]}),
        );
        assert_eq!(value["total"], 5);
        for cohort in value["datasets"].as_array().unwrap() {
            assert_eq!(cohort["runs_count"], 1);
            assert_eq!(cohort["status"], "unknown");
        }
    }

    #[test]
    fn stale_or_invalid_explicit_links_never_fall_back_to_name_or_old_path() {
        let directory = tempfile::tempdir().unwrap();
        let current = directory.path().join("raw");
        fs::create_dir_all(&current).unwrap();
        let value = discover_test_cohorts(
            directory.path(),
            &[
                json!({"name":"raw","hash":"same","linked_dataset_id":"removed","path":current}),
                json!({"name":"raw","hash":"same","linked_dataset_id":null}),
                json!({"name":"raw","hash":"same","linked_dataset_id":""}),
                json!({"name":"raw","hash":"same"}),
            ],
            &json!({"datasets":[{"id":"replacement","name":"raw","path":current}]}),
        );
        assert_eq!(value["total"], 4);
        for cohort in value["datasets"].as_array().unwrap() {
            if cohort.get("linked_dataset_id").is_some() {
                assert_eq!(cohort["path"], "");
                assert_eq!(cohort["status"], "unknown");
            } else {
                assert_eq!(cohort["path"], json!(current));
                assert_eq!(cohort["status"], "valid");
            }
        }
    }
}
