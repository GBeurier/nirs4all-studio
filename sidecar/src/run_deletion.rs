//! Rust-owned run deletion route; cascade writes remain with nirs4all.

use std::{
    sync::{Arc, Mutex},
    time::Instant,
};

use serde_json::{json, Value};

use crate::{
    job_http::NativeJobRuntime, settings::AppSettingsStore, HttpRequest, HttpResponse, SidecarState,
};

pub fn route(state: &Arc<Mutex<SidecarState>>, request: &HttpRequest) -> Option<HttpResponse> {
    if request.method != "DELETE" || crate::workspace_run_detail_ids(&request.path).is_none() {
        return None;
    }
    if request.query.is_some() || !request.body.is_empty() {
        return Some(error(
            400,
            "Run deletion does not accept query fields or a body",
        ));
    }
    let (settings, jobs, host) = {
        let state = state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        (
            state.app_settings.clone(),
            Arc::clone(&state.native_jobs),
            state.scientific_host.clone(),
        )
    };
    Some(dispatch(
        &settings,
        &jobs,
        &request.path,
        &|operation, payload| {
            host.as_deref()
                .ok_or_else(|| "Scientific library runtime is unavailable".to_owned())?
                .adapt_document(operation, payload)
        },
    ))
}

fn error(status: u16, detail: &str) -> HttpResponse {
    HttpResponse::json(status, json!({"detail": detail}).to_string())
}

pub fn dispatch(
    settings: &AppSettingsStore,
    jobs: &NativeJobRuntime,
    path: &str,
    invoke: &impl Fn(&str, &Value) -> Result<Value, String>,
) -> HttpResponse {
    let Some((workspace_id, run_id)) = crate::workspace_run_detail_ids(path) else {
        return error(404, "Route not found");
    };
    if [&workspace_id, &run_id].iter().any(|id| {
        id.len() > 256 || id.contains(['/', '\\', '\0']) || matches!(id.as_str(), "." | "..")
    }) {
        return error(400, "Invalid workspace or run ID");
    }
    let workspace = match settings.linked_workspace_access(&workspace_id) {
        Ok(Some(workspace)) => workspace,
        Ok(None) => return error(404, "Workspace not found"),
        Err(detail) => return error(409, &detail),
    };
    // A failed child run can still belong to a live campaign. Wait until its
    // workspace's workers stop writing before invoking a storage cascade.
    if jobs
        .training_list_at(workspace.path(), Instant::now())
        .iter()
        .any(|context| {
            matches!(
                context["job"]["status"].as_str(),
                Some("pending" | "running")
            )
        })
    {
        return error(409, "Stop active runs before deleting run history");
    }
    let payload = json!({"workspace_path": workspace.path(), "run_id": run_id});
    // Release the read snapshot before the library opens its write transaction.
    drop(workspace);
    match invoke("runs.delete", &payload) {
        Ok(value)
            if value["success"] == true
                && value["run_id"] == run_id
                && value["deleted_rows"].as_u64().is_some() =>
        {
            HttpResponse::json(200, value.to_string())
        }
        Ok(value) if value["success"] == false => match value["reason"].as_str() {
            Some("run_not_found") => error(404, "Run not found"),
            Some("run_active") => error(409, "Stop the run before deleting it"),
            _ => error(502, "Invalid run deletion response"),
        },
        Ok(_) => error(502, "Invalid run deletion response"),
        Err(detail) => error(503, &detail),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> (tempfile::TempDir, AppSettingsStore) {
        let root = tempfile::tempdir().unwrap();
        let workspace = root.path().join("workspace");
        std::fs::create_dir(&workspace).unwrap();
        std::fs::write(
            root.path().join("app_settings.json"),
            json!({
                "linked_workspaces": [{"id": "selected", "path": workspace, "is_active": true}]
            })
            .to_string(),
        )
        .unwrap();
        let settings = AppSettingsStore::new(root.path());
        (root, settings)
    }

    #[test]
    fn deletion_resolves_workspace_and_delegates_the_exact_run() {
        let (root, settings) = fixture();
        let response = dispatch(
            &settings,
            &NativeJobRuntime::default(),
            "/api/workspaces/selected/runs/failed-run",
            &|operation, payload| {
                assert_eq!(operation, "runs.delete");
                assert_eq!(
                    payload,
                    &json!({"workspace_path": root.path().join("workspace"), "run_id": "failed-run"})
                );
                Ok(json!({"success": true, "deleted_rows": 1, "run_id": "failed-run"}))
            },
        );
        assert_eq!(response.status, 200);
        assert_eq!(
            serde_json::from_str::<Value>(&response.body).unwrap()["deleted_rows"],
            1
        );
    }

    #[test]
    fn deletion_preserves_missing_active_and_library_failure_outcomes() {
        let (_root, settings) = fixture();
        for (result, status) in [
            (
                Ok(json!({"success": false, "reason": "run_not_found"})),
                404,
            ),
            (Ok(json!({"success": false, "reason": "run_active"})), 409),
            (Err("Store deletion failed".into()), 503),
            (
                Ok(json!({"success": true, "run_id": "another-run", "deleted_rows": 1})),
                502,
            ),
        ] {
            assert_eq!(
                dispatch(
                    &settings,
                    &NativeJobRuntime::default(),
                    "/api/workspaces/selected/runs/failed-run",
                    &|_, _| result.clone()
                )
                .status,
                status
            );
        }
    }

    #[test]
    fn deletion_rejects_unknown_workspaces_and_unsafe_ids_before_the_library() {
        let (_root, settings) = fixture();
        for (path, status) in [
            ("/api/workspaces/missing/runs/failed-run", 404),
            ("/api/workspaces/selected/runs/..", 400),
            ("/api/workspaces/selected/runs/%5Coutside", 400),
        ] {
            assert_eq!(
                dispatch(
                    &settings,
                    &NativeJobRuntime::default(),
                    path,
                    &|_, _| panic!("Library must not be invoked")
                )
                .status,
                status
            );
        }
    }

    #[test]
    fn renderer_delete_request_reaches_the_native_route() {
        let (_root, settings) = fixture();
        let mut state = SidecarState::with_app_settings_dir(settings.config_dir());
        let response = crate::route_request(
            &mut state,
            "DELETE",
            "/api/workspaces/selected/runs/failed-run",
        );
        assert_eq!(
            response.status, 503,
            "An unconfigured library must no longer produce GET-only 405"
        );
    }

    #[test]
    fn http_delete_rejects_query_fields_and_bodies() {
        let (root, _settings) = fixture();
        let state = Arc::new(Mutex::new(SidecarState::with_app_settings_dir(root.path())));
        for (query, body) in [
            (Some("run_id=another-run".into()), vec![]),
            (None, b"{}".to_vec()),
        ] {
            let response = route(
                &state,
                &HttpRequest {
                    method: "DELETE".into(),
                    path: "/api/workspaces/selected/runs/failed-run".into(),
                    query,
                    headers: std::collections::BTreeMap::new(),
                    body,
                },
            )
            .unwrap();
            assert_eq!(response.status, 400);
        }
    }

    #[test]
    fn active_campaign_prevents_deletion_until_terminal() {
        use crate::job_http::{
            JobExecutorError, ScientificExecutionRequest, ScientificExecutorSelection,
            ScientificJobExecutor, ScientificJobTerminal, ScientificSubmissionPreflight,
        };
        #[derive(Debug)]
        struct HoldingExecutor;
        impl ScientificJobExecutor for HoldingExecutor {
            fn is_selected(&self) -> bool {
                true
            }
            fn preflight_submission(
                &self,
                _: &ScientificSubmissionPreflight,
            ) -> Result<ScientificExecutorSelection, JobExecutorError> {
                Ok(ScientificExecutorSelection {
                    execution_backend: "local-python".into(),
                    execution_mode: None,
                    prepared_payload: json!({}),
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
                Ok(())
            }
        }
        let (root, settings) = fixture();
        let jobs = NativeJobRuntime::default();
        std::fs::create_dir(root.path().join("workspace/runs")).unwrap();
        let timestamp = "2026-10-08T12:00:00Z";
        let receipt = jobs
            .submit_with_executor_at(
                "Campaign",
                "local-python",
                &json!({}),
                "selected",
                &root.path().join("workspace"),
                timestamp,
                Instant::now(),
                Arc::new(HoldingExecutor),
            )
            .unwrap();
        assert_eq!(
            dispatch(
                &settings,
                &jobs,
                "/api/workspaces/selected/runs/failed-run",
                &|_, _| panic!("Active campaigns must not reach the library")
            )
            .status,
            409
        );
        jobs.complete_at(
            &receipt.job_id,
            json!({"result":{"run_ids":["child-a", "child-b"]}}),
            timestamp,
            Instant::now(),
        )
        .unwrap();
        let record = crate::execution_job_records::read_execution_job_record(&root.path().join("workspace"), &receipt.job_id).unwrap();
        assert_eq!(record["driver"]["store_run_ids"], json!(["child-a", "child-b"]));
        assert_eq!(
            dispatch(
                &settings,
                &jobs,
                "/api/workspaces/selected/runs/failed-run",
                &|_, _| Ok(json!({"success": true, "run_id": "failed-run", "deleted_rows": 1}))
            )
            .status,
            200
        );
    }
}
