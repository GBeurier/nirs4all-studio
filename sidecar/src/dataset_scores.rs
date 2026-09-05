//! Compact dataset-card scores from the unchanged Store-owned projection.
//! Only actual final-test values may be labelled final; CV remains explicit.
use crate::{
    results_summary::{augment_dataset_links, metric_higher_is_better},
    settings::{AppSettingsStore, DatasetLinkIdentity},
    workspace_store::{self, WorkspaceStoreReadError, WorkspaceStoreResultsSummarySourceRow},
    HttpRequest, HttpResponse, SidecarState,
};
use rusqlite::Connection;
use serde_json::{json, Value};
use std::{
    collections::BTreeMap,
    path::Path,
    sync::{Arc, Mutex},
};

#[derive(Default)]
struct Scores {
    metric: String,
    final_test: Option<Candidate>,
    cv: Option<Candidate>,
}

struct Candidate {
    score: f64,
    cv: Option<f64>,
    model: String,
}

#[derive(Default)]
struct Accumulator(BTreeMap<String, Scores>);

impl Accumulator {
    fn consume(&mut self, row: WorkspaceStoreResultsSummarySourceRow) {
        let Some(metric) = row
            .metric
            .as_deref()
            .filter(|metric| !metric.trim().is_empty())
        else {
            return; // Missing metric is not evidence that a scalar measures R2.
        };
        if row.dataset_name.is_empty() {
            return;
        }
        let scores = self.0.entry(row.dataset_name).or_insert_with(|| Scores {
            metric: metric.to_owned(),
            ..Scores::default()
        });
        // Preserve the historical first-metric selection but never compare
        // numbers expressed in another metric's units under that label.
        if scores.metric != metric {
            return;
        }
        let higher = metric_higher_is_better(metric);
        let model = row
            .model_name
            .filter(|name| !name.is_empty())
            .unwrap_or(row.model_class);
        for (value, best) in [
            (row.final_test_score, &mut scores.final_test),
            (row.cv_val_score, &mut scores.cv),
        ] {
            let Some(score) = value.filter(|value| value.is_finite()) else {
                continue;
            };
            if best.as_ref().is_none_or(|best| {
                if higher {
                    score > best.score
                } else {
                    score < best.score
                }
            }) {
                *best = Some(Candidate {
                    score,
                    cv: row.cv_val_score.filter(|value| value.is_finite()),
                    model: model.clone(),
                });
            }
        }
    }

    fn finish(self, workspace_id: &str, links: &[DatasetLinkIdentity]) -> Value {
        let mut datasets = Vec::new();
        for (name, scores) in self.0 {
            let (best, kind, cv) = if let Some(best) = scores.final_test {
                let cv = best.cv.or_else(|| scores.cv.as_ref().map(|cv| cv.score));
                (best, "final", cv)
            } else if let Some(best) = scores.cv {
                (best, "cv", None)
            } else {
                continue; // Train-only results do not become held-out scores.
            };
            datasets.push(json!({"dataset_name":name,"linked_dataset_id":null,
                "metric":scores.metric,"best_score":best.score,"cv_score":cv,
                "score_kind":kind,"model_name":best.model}));
        }
        augment_dataset_links(&mut datasets, links);
        json!({"workspace_id":workspace_id,"datasets":datasets})
    }
}

fn read(
    path: &Path,
    connection: Option<&Connection>,
    workspace_id: &str,
    links: &[DatasetLinkIdentity],
) -> Result<Value, WorkspaceStoreReadError> {
    let mut scores = Accumulator::default();
    if let Some(connection) = connection {
        workspace_store::visit_results_summary_source_from_connection(connection, |row| {
            scores.consume(row);
        })?;
    } else {
        workspace_store::visit_results_summary_source(path, |row| scores.consume(row))?;
    }
    Ok(scores.finish(workspace_id, links))
}

pub fn route(state: &Arc<Mutex<SidecarState>>, request: &HttpRequest) -> Option<HttpResponse> {
    let id = request
        .path
        .strip_prefix("/api/workspaces/")?
        .strip_suffix("/results/dataset-scores")?;
    if id.is_empty() || id.contains('/') {
        return None;
    }
    if request.method != "GET" {
        return Some(crate::method_not_allowed(
            &request.method,
            &request.path,
            "GET",
        ));
    }
    if request.query.is_some() {
        return Some(HttpResponse::json(
            400,
            json!({"detail":"Dataset scores do not accept query fields"}).to_string(),
        ));
    }
    let settings = state
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .app_settings
        .clone();
    Some(response(&settings, id))
}

fn response(settings: &AppSettingsStore, id: &str) -> HttpResponse {
    let workspace = match settings.linked_workspace_access(id) {
        Ok(Some(workspace)) => workspace,
        Ok(None) => {
            return HttpResponse::json(404, json!({"detail":"Workspace not found"}).to_string())
        }
        Err(error) => {
            return crate::app_settings_storage_error("resolve dataset-score workspace", &error)
        }
    };
    let links = match settings.dataset_links() {
        Ok(links) => links,
        Err(error) => return crate::app_settings_storage_error("read dataset-score links", &error),
    };
    match read(workspace.path(), workspace.store(), id, &links) {
        Ok(value) => HttpResponse::json(200, value.to_string()),
        Err(WorkspaceStoreReadError::StoreNotFound) => {
            HttpResponse::json(200, json!({"workspace_id":id,"datasets":[]}).to_string())
        }
        Err(error) => crate::workspace_store_read_error_response(&error),
    }
}

#[cfg(test)]
#[path = "dataset_scores_tests.rs"]
mod tests;
