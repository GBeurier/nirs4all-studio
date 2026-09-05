//! History presentation from immutable, owner-published metadata and scores.
//! No estimators, arrays, artifact deserialization or independent metric engine.

use std::{
    collections::{BTreeMap, HashSet},
    path::Path,
};

use rusqlite::Connection;
use serde_json::{json, Value};

use crate::{
    results_summary::{build_results_summary, metric_higher_is_better},
    settings::DatasetLinkIdentity,
    workspace_store::{
        history::{
            read_filtered_history, read_filtered_history_from_connection, read_history,
            read_history_from_connection, HistoricalScores, HistorySource,
        },
        WorkspaceStoreReadError, WorkspaceStoreResultsSummarySourceRow,
    },
};

pub fn read_enriched_runs(
    workspace: &Path,
    workspace_id: &str,
    links: &[DatasetLinkIdentity],
    project_id: Option<&str>,
    limit: u16,
    offset: u64,
) -> Result<Value, WorkspaceStoreReadError> {
    Ok(compose_history(
        read_history(workspace, project_id, limit, offset)?,
        workspace_id,
        links,
    ))
}

pub fn read_filtered_enriched_runs(
    workspace: &Path,
    workspace_id: &str,
    links: &[DatasetLinkIdentity],
    project_id: Option<&str>,
    limit: u16,
    offset: u64,
    statuses: &[String],
) -> Result<Value, WorkspaceStoreReadError> {
    Ok(compose_history(
        read_filtered_history(workspace, project_id, limit, offset, statuses)?,
        workspace_id,
        links,
    ))
}

pub fn read_enriched_runs_from_connection(
    connection: &Connection,
    workspace_id: &str,
    links: &[DatasetLinkIdentity],
    project_id: Option<&str>,
    limit: u16,
    offset: u64,
) -> Result<Value, WorkspaceStoreReadError> {
    Ok(compose_history(
        read_history_from_connection(connection, project_id, limit, offset)?,
        workspace_id,
        links,
    ))
}

pub fn read_filtered_enriched_runs_from_connection(
    connection: &Connection,
    workspace_id: &str,
    links: &[DatasetLinkIdentity],
    project_id: Option<&str>,
    limit: u16,
    offset: u64,
    statuses: &[String],
) -> Result<Value, WorkspaceStoreReadError> {
    Ok(compose_history(
        read_filtered_history_from_connection(connection, project_id, limit, offset, statuses)?,
        workspace_id,
        links,
    ))
}

fn compose_history(
    source: HistorySource,
    workspace_id: &str,
    links: &[DatasetLinkIdentity],
) -> Value {
    let mut by_run = BTreeMap::<String, Vec<WorkspaceStoreResultsSummarySourceRow>>::new();
    for chain in source.chains {
        by_run.entry(chain.run_id.clone()).or_default().push(chain);
    }
    let mut runs = source.runs;
    for run in &mut runs {
        let run_id = run["run_id"].as_str().unwrap_or_default();
        let rows = by_run.get(run_id).map_or(&[][..], Vec::as_slice);
        let summary = build_results_summary(rows.to_vec(), workspace_id, links);
        let mut datasets = BTreeMap::<String, Value>::new();
        for dataset in summary["datasets"].as_array().into_iter().flatten() {
            let name = dataset["dataset_name"].as_str().unwrap_or_default();
            datasets.insert(
                name.into(),
                enrich_dataset(dataset, rows, &source.historical_scores, run_id),
            );
        }
        for metadata in run["datasets"].as_array().into_iter().flatten() {
            let Some(name) = metadata.as_str().or_else(|| metadata["name"].as_str()) else {
                continue;
            };
            if name.is_empty() {
                continue;
            }
            let dataset = datasets.entry(name.into()).or_insert_with(|| {
                json!({
                    "dataset_name": name, "best_avg_val_score": null, "best_avg_test_score": null,
                    "best_final_score": null, "metric": null, "task_type": null,
                    "gain_from_previous_best": null, "pipeline_count": 0, "top_5": [],
                })
            });
            for field in ["n_samples", "n_features"] {
                if !metadata[field].is_null() {
                    dataset[field] = metadata[field].clone();
                }
            }
        }
        if let Some(metadata) = run
            .as_object_mut()
            .and_then(|run| run.remove("dataset_metadata"))
        {
            for (name, dataset) in &mut datasets {
                for field in ["n_samples", "n_features", "task_type", "metric"] {
                    if dataset[field].is_null() && !metadata[name][field].is_null() {
                        dataset[field] = metadata[name][field].clone();
                    }
                }
            }
        }
        let datasets = datasets.into_values().collect::<Vec<_>>();
        run["datasets_count"] = json!(datasets.len());
        run["datasets"] = json!(datasets);
        for field in ["created_at", "status"] {
            if run[field].is_null() {
                run[field] = json!(if field == "status" { "unknown" } else { "" });
            }
        }
        let has_refit = run["final_models_count"].as_u64().unwrap_or(0) > 0;
        let folds = run["total_folds"].clone();
        let mut config = run["config"].as_object().cloned().unwrap_or_default();
        config.retain(|_, value| !value.is_null());
        config.entry("has_refit").or_insert(json!(has_refit));
        if folds.as_u64().unwrap_or(0) > 0 {
            config.entry("cv_folds").or_insert(folds);
        }
        if !config.contains_key("metric") {
            if let Some(metric) = datasets
                .iter()
                .find_map(|dataset| dataset["metric"].as_str())
            {
                config.insert("metric".into(), json!(metric));
            }
        }
        for field in [
            "engine",
            "engine_requested",
            "engine_diagnostics",
            "runtime_source",
            "runtime_manifest",
            "allow_fallback",
            "fallback_policy",
            "native_result_refs",
            "execution_metadata",
        ] {
            if let Some(value) = config.get(field) {
                run[field] = value.clone();
            }
        }
        run["config"] = json!(config);
    }
    json!({"runs": runs, "total": source.total})
}

fn enrich_dataset(
    summary: &Value,
    rows: &[WorkspaceStoreResultsSummarySourceRow],
    historical_scores: &HistoricalScores,
    run_id: &str,
) -> Value {
    let name = summary["dataset_name"].as_str().unwrap_or_default();
    let metric = summary["metric"].as_str().unwrap_or_default();
    let higher = metric_higher_is_better(metric);
    let top = summary["top_chains"]
        .as_array()
        .cloned()
        .unwrap_or_default();
    let best = top
        .iter()
        .filter(|chain| chain["avg_val_score"].as_f64().is_some())
        .min_by(|left, right| {
            compare_scores(
                left["avg_val_score"].as_f64().unwrap(),
                right["avg_val_score"].as_f64().unwrap(),
                higher,
            )
        });
    let final_score = top
        .iter()
        .filter_map(|chain| chain["final_test_score"].as_f64())
        .min_by(|left, right| compare_scores(*left, *right, higher));
    // Same historical comparator as Studio: all other stored runs, not merely
    // the currently visible page or project. Preserve metric identity.
    let historical = historical_scores
        .get(&(run_id.into(), name.into(), metric.into()))
        .and_then(|extrema| extrema[usize::from(higher)]);
    let gain = best
        .and_then(|chain| chain["avg_val_score"].as_f64())
        .zip(historical)
        .map(|(current, previous)| ((current - previous) * 1e6).round_ties_even() / 1e6);
    let mut result = json!({
        "dataset_name": name, "metric": summary["metric"], "task_type": summary["task_type"],
        "best_avg_val_score": best.map(|chain| &chain["avg_val_score"]),
        "best_avg_test_score": best.map(|chain| &chain["avg_test_score"]),
        "best_final_score": final_score, "gain_from_previous_best": gain,
        "pipeline_count": rows.iter().filter(|row| row.dataset_name == name).map(|row| &row.pipeline_id).collect::<HashSet<_>>().len(),
        "top_5": top,
    });
    for field in ["n_samples", "n_features"] {
        if !summary[field].is_null() {
            result[field] = summary[field].clone();
        }
    }
    result
}

fn compare_scores(left: f64, right: f64, higher: bool) -> std::cmp::Ordering {
    if higher {
        right.total_cmp(&left)
    } else {
        left.total_cmp(&right)
    }
}

#[cfg(test)]
#[path = "run_history_tests.rs"]
mod tests;
