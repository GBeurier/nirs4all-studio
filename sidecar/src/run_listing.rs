//! Workspace-scoped run discovery combines immutable history with actual jobs.
use crate::{workspace_store::WorkspaceStoreReadError, HttpRequest, HttpResponse, SidecarState};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::HashSet,
    sync::{Arc, Mutex},
    time::Instant,
};

pub fn route(state: &Arc<Mutex<SidecarState>>, request: &HttpRequest) -> Option<HttpResponse> {
    if !matches!(
        request.path.as_str(),
        "/api/runs" | "/api/runs/stats" | "/api/runs/pipelines"
    ) {
        return None;
    }
    if request.method != "GET" {
        return Some(crate::method_not_allowed(
            &request.method,
            &request.path,
            "GET",
        ));
    }
    let result = if request.path == "/api/runs/pipelines" {
        read_historical_pipelines(state, request)
    } else {
        read(state, request)
    };
    Some(match result {
        Ok(value) => HttpResponse::json(200, value.to_string()),
        Err(response) => response,
    })
}

fn read_historical_pipelines(
    runtime: &Arc<Mutex<SidecarState>>,
    request: &HttpRequest,
) -> Result<Value, HttpResponse> {
    if request.query.is_some() {
        return Err(HttpResponse::json(
            400,
            json!({"detail":"Historical pipelines do not accept query fields"}).to_string(),
        ));
    }
    let (settings, host) = {
        let state = runtime
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        (state.app_settings.clone(), state.scientific_host.clone())
    };
    let active = settings.active_linked_workspace_access().map_err(|error| {
        crate::app_settings_storage_error("resolve active pipeline history workspace", &error)
    })?;
    let Some(workspace) = active else {
        return Ok(json!({"pipelines":[]}));
    };
    let summaries = workspace.store().map_or_else(
        || crate::workspace_store::read_run_summaries(workspace.path(), 500, 0),
        |store| crate::workspace_store::read_run_summaries_from_connection(&store, 500, 0),
    );
    let summaries = match summaries {
        Ok(rows) => rows,
        Err(WorkspaceStoreReadError::StoreNotFound) => return Ok(json!({"pipelines":[]})),
        Err(error) => return Err(crate::workspace_store_read_error_response(&error)),
    };
    let mut seen = HashSet::new();
    let mut pipelines = Vec::new();
    let mut truncated = false;
    for summary in summaries {
        let summary = summary.response();
        let Some(run_id) = summary["id"].as_str() else {
            continue;
        };
        let detail = workspace
            .store()
            .map_or_else(
                || crate::workspace_store::read_run_detail_projection(workspace.path(), run_id),
                |store| {
                    crate::workspace_store::read_run_detail_projection_from_connection(
                        &store, run_id,
                    )
                },
            )
            .map_err(|error| crate::workspace_store_read_error_response(&error))?;
        let Some(detail) = detail else { continue };
        for pipeline in detail["pipelines"].as_array().into_iter().flatten() {
            let Some(template) = historical_template(pipeline) else {
                continue;
            };
            let Ok(signature) = serde_json::to_vec(template) else {
                continue;
            };
            if signature.len() > 32 * 1024 || !seen.insert(signature.clone()) {
                continue;
            }
            if pipelines.len() == 100 {
                truncated = true;
                break;
            }
            let Some(host) = &host else {
                return Err(HttpResponse::json(
                    503,
                    json!({"detail":"Historical pipeline conversion requires the configured library host"})
                        .to_string(),
                ));
            };
            let Ok(converted) =
                host.adapt_document("pipeline.import", &json!({"payload":template}))
            else {
                continue;
            };
            let Some(steps) = converted["steps"].as_array() else {
                continue;
            };
            if steps.is_empty() || steps.iter().any(|step| !step.is_object()) {
                continue;
            }
            let id = format!("history:{:x}", Sha256::digest(signature));
            let created_at = pipeline["created_at"].as_str().unwrap_or_default();
            pipelines.push(json!({
                "id":id,
                "name":pipeline["name"].as_str().unwrap_or("Historical pipeline"),
                "description":"Recovered from run history",
                "category":"history",
                "source":"history",
                "steps":steps,
                "created_at":created_at,
                "updated_at":pipeline["completed_at"].as_str().unwrap_or(created_at),
            }));
        }
        if truncated {
            break;
        }
    }
    Ok(json!({"pipelines":pipelines,"truncated":truncated}))
}

fn historical_template(pipeline: &Value) -> Option<&Value> {
    pipeline
        .get("original_template")
        .filter(|value| value.is_array() || value.is_object())
        .or_else(|| {
            pipeline
                .get("expanded_config")
                .filter(|value| value.is_array() || value.is_object())
        })
}

fn read(runtime: &Arc<Mutex<SidecarState>>, request: &HttpRequest) -> Result<Value, HttpResponse> {
    let stats_only = request.path.ends_with("/stats");
    let statuses = parse_statuses(request.query.as_deref(), stats_only)?;
    let (settings, jobs) = {
        let state = runtime
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        (state.app_settings.clone(), state.native_jobs.clone())
    };
    let active = settings.active_linked_workspace_access().map_err(|error| {
        crate::app_settings_storage_error("resolve active run workspace", &error)
    })?;
    let empty_stats = json!({"running":0,"queued":0,"completed":0,"failed":0,"cancelled":0,"partial":0,"total":0,"total_pipelines":0});
    let Some(workspace) = active else {
        return Ok(if stats_only {
            empty_stats
        } else {
            json!({"runs":[],"total":0})
        });
    };
    let id = workspace.id();
    let links = settings
        .dataset_links()
        .map_err(|error| crate::app_settings_storage_error("read run dataset links", &error))?;
    let mut history_statuses = statuses.iter().flatten().cloned().collect::<Vec<_>>();
    history_statuses.sort();
    let stored = if stats_only {
        Ok(json!({"runs":[],"total":0}))
    } else {
        workspace.store().map_or_else(
            || {
                crate::run_history::read_filtered_enriched_runs(
                    workspace.path(),
                    id,
                    &links,
                    None,
                    500,
                    0,
                    &history_statuses,
                )
            },
            |store| {
                crate::run_history::read_filtered_enriched_runs_from_connection(
                    &store,
                    id,
                    &links,
                    None,
                    500,
                    0,
                    &history_statuses,
                )
            },
        )
    };
    let stored = match stored {
        Ok(value) => value,
        Err(WorkspaceStoreReadError::StoreNotFound) => json!({"runs":[],"total":0}),
        Err(error) => return Err(crate::workspace_store_read_error_response(&error)),
    };
    let stats = workspace.store().map_or_else(
        || crate::workspace_store::history::read_history_stats(workspace.path()),
        |store| crate::workspace_store::history::read_history_stats_from_connection(&store),
    );
    let stats = match stats {
        Ok(value) => value,
        Err(WorkspaceStoreReadError::StoreNotFound) => empty_stats,
        Err(error) => return Err(crate::workspace_store_read_error_response(&error)),
    };
    Ok(compose(
        &stored,
        stats,
        jobs.training_list_at(workspace.path(), Instant::now()),
        statuses.as_ref(),
        stats_only,
    ))
}

fn parse_statuses(
    query: Option<&str>,
    stats: bool,
) -> Result<Option<HashSet<String>>, HttpResponse> {
    let fields = url::form_urlencoded::parse(query.unwrap_or("").as_bytes()).collect::<Vec<_>>();
    if fields.is_empty() {
        return Ok(None);
    }
    let bad = || {
        HttpResponse::json(
            400,
            json!({"detail":"Expected a single valid run status filter"}).to_string(),
        )
    };
    if stats || fields.len() != 1 || fields[0].0 != "status" {
        return Err(bad());
    }
    let values = fields[0].1.split(',').collect::<Vec<_>>();
    if values.iter().any(|value| {
        !matches!(
            *value,
            "running" | "queued" | "completed" | "failed" | "cancelled" | "partial"
        )
    }) {
        return Err(bad());
    }
    Ok(Some(values.into_iter().map(str::to_owned).collect()))
}

fn compose(
    stored: &Value,
    mut counters: Value,
    jobs: Vec<Value>,
    statuses: Option<&HashSet<String>>,
    stats_only: bool,
) -> Value {
    let mut runs = stored["runs"].as_array().cloned().unwrap_or_default();
    for run in &mut runs {
        run["id"] = run["run_id"].clone();
        run["store_run_id"] = run["run_id"].clone();
        run["format"] = json!("store");
        run["total_pipelines"] = run["pipeline_runs_count"].clone();
        // Full stored pipeline detail remains available via the run-detail route.
        for dataset in run["datasets"].as_array_mut().into_iter().flatten() {
            dataset["pipelines"] = json!([]);
        }
    }
    let mut additional = 0_u64;
    for context in jobs {
        let job = &context["job"];
        let status = if job["status"] == "pending" {
            "queued"
        } else {
            job["status"].as_str().unwrap_or("unknown")
        };
        let child_ids = job
            .pointer("/result/result/run_ids")
            .or_else(|| job.pointer("/result/run_ids"))
            .and_then(Value::as_array);
        // A successful library job names its persisted children. Count those
        // via the store even when their rows lie beyond this history page.
        if child_ids.is_some_and(|ids| {
            ids.iter()
                .any(|id| id.as_str().is_some_and(|id| !id.is_empty()))
        }) {
            continue;
        }
        let legacy = &context["legacyConfig"];
        let datasets = legacy["dataset_ids"]
            .as_array()
            .into_iter()
            .flatten()
            .map(|id| json!({"dataset_id":id,"dataset_name":id,"pipelines":[]}))
            .collect::<Vec<_>>();
        if statuses.is_none_or(|statuses| statuses.contains(status)) {
            runs.push(json!({"id":job["id"],"name":job["config"]["run_name"],"status":status,"created_at":job["created_at"],"started_at":job["started_at"],"completed_at":job["completed_at"],"datasets":datasets,"execution_backend":job["config"]["execution_backend"],"config":legacy,"progress":job["progress"],"error":job["error"],"duration_seconds":job["duration_seconds"]}));
        }
        additional += 1;
        if let Some(value) = counters.get_mut(status) {
            *value = json!(value.as_u64().unwrap_or(0) + 1);
        }
    }
    if stats_only {
        counters["total"] = json!(counters["total"].as_u64().unwrap_or(0) + additional);
        return counters;
    }
    runs.sort_by(|a, b| {
        b["created_at"]
            .as_str()
            .cmp(&a["created_at"].as_str())
            .then_with(|| a["id"].as_str().cmp(&b["id"].as_str()))
    });
    let total = statuses.map_or_else(
        || stored["total"].as_u64().unwrap_or(0) + additional,
        |statuses| {
            statuses
                .iter()
                .map(|status| counters[status].as_u64().unwrap_or(0))
                .sum()
        },
    );
    json!({"runs":runs,"total":total,"history_limit":500})
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::sync::atomic::{AtomicU64, Ordering};

    #[test]
    fn historical_pipeline_source_reads_schema_five_and_falls_back_to_expanded_config() {
        static NEXT: AtomicU64 = AtomicU64::new(0);
        let workspace = std::env::temp_dir().join(format!(
            "n4a-historical-pipelines-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir(&workspace).unwrap();
        fs::write(
            workspace.join("store.sqlite"),
            include_bytes!("../tests/fixtures/workspace_store_v5_summary.sqlite"),
        )
        .unwrap();
        let summaries = crate::workspace_store::read_run_summaries(&workspace, 100, 0).unwrap();
        let run_id = summaries[0].response()["id"].as_str().unwrap().to_owned();
        let detail = crate::workspace_store::read_run_detail_projection(&workspace, &run_id)
            .unwrap()
            .unwrap();
        let pipeline = &detail["pipelines"][0];
        assert!(pipeline["original_template"].is_null());
        assert!(historical_template(pipeline).unwrap().is_array());
        assert_eq!(historical_template(&json!({"expanded_config":"bad"})), None);
        fs::remove_dir_all(workspace).unwrap();
    }
    #[test]
    fn filters_are_closed_and_duplicate_keys_are_rejected() {
        for query in ["status=bad", "status=running&status=queued", "limit=2"] {
            assert!(parse_statuses(Some(query), false).is_err());
        }
        assert!(parse_statuses(Some("status=running"), true).is_err());
        assert_eq!(
            parse_statuses(Some("status=running,queued"), false)
                .unwrap()
                .unwrap()
                .len(),
            2
        );
    }
    #[test]
    fn real_job_children_are_not_counted_twice_and_statuses_remain_honest() {
        let stored = json!({"runs":[{"run_id":"child","name":"Stored","status":"completed","created_at":"2026-09-01","pipeline_runs_count":2,"datasets":[]}],"total":600});
        let jobs = vec![
            json!({"job":{"id":"parent","status":"completed","result":{"result":{"run_ids":["child"]}}}}),
            json!({"job":{"id":"active","status":"running","created_at":"2026-09-02","config":{"run_name":"Actual worker"}},"legacyConfig":{"dataset_ids":["data"]}}),
        ];
        let stats =
            json!({"running":0,"queued":0,"completed":600,"failed":0,"total_pipelines":900});
        let result = compose(&stored, stats.clone(), jobs.clone(), None, false);
        assert_eq!(result["total"], 601);
        assert_eq!(result["runs"].as_array().unwrap().len(), 2);
        assert_eq!(result["runs"][0]["id"], "active");
        let selected = HashSet::from(["completed".to_owned()]);
        let filtered = compose(&stored, stats.clone(), jobs.clone(), Some(&selected), false);
        assert_eq!(filtered["total"], 600);
        let result = compose(&stored, stats, jobs, None, true);
        assert_eq!(result["running"], 1);
        assert_eq!(result["completed"], 600);
        assert_eq!(result["total_pipelines"], 900);
    }
}
