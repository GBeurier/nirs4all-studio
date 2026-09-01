//! Native implementation of the owner-defined Studio results-summary policy.
//!
//! Store access remains in `workspace_store`: this module receives only the
//! published source projection and applies the versioned ranking,
//! normalization, serialization, and dataset-link augmentation policy.

use std::{
    cmp::Ordering,
    collections::{BTreeMap, HashSet},
    path::Path,
};

use serde_json::{json, Map, Value};

use crate::{
    settings::DatasetLinkIdentity,
    workspace_store::{
        read_results_summary_source, WorkspaceStoreReadError, WorkspaceStoreResultsSummarySourceRow,
    },
};

const TOP_N: usize = 5;
const LOWER_IS_BETTER: [&str; 8] = [
    "rmse", "rmsecv", "rmsep", "mae", "mse", "mape", "bias", "sep",
];

#[derive(Clone)]
struct SummaryRow {
    source: WorkspaceStoreResultsSummarySourceRow,
    synthetic_refit: bool,
    is_refit_only: bool,
}

/// Build the exact bare `GET /results/summary` response from Store v5.
///
/// # Errors
///
/// Returns [`WorkspaceStoreReadError`] when the owner contract or immutable
/// Store projection cannot be consumed safely.
pub fn read_results_summary(
    workspace_path: &Path,
    workspace_id: &str,
    linked_datasets: &[DatasetLinkIdentity],
) -> Result<Value, WorkspaceStoreReadError> {
    let rows = read_results_summary_source(workspace_path)?;
    Ok(build_results_summary(rows, workspace_id, linked_datasets))
}

fn build_results_summary(
    rows: Vec<WorkspaceStoreResultsSummarySourceRow>,
    workspace_id: &str,
    linked_datasets: &[DatasetLinkIdentity],
) -> Value {
    let mut grouped = BTreeMap::<String, Vec<SummaryRow>>::new();
    for source in rows {
        if source.dataset_name.is_empty() {
            continue;
        }
        let mut row = SummaryRow {
            source,
            synthetic_refit: false,
            is_refit_only: false,
        };
        row.is_refit_only = has_meaningful_final(&row) && !has_cv_payload(&row);
        apply_synthetic_refit(&mut row);
        grouped
            .entry(row.source.dataset_name.clone())
            .or_default()
            .push(row);
    }

    let mut datasets = Vec::new();
    for (dataset_name, rows) in grouped {
        let metric = rows
            .iter()
            .find_map(|row| {
                row.source
                    .metric
                    .as_deref()
                    .filter(|metric| !metric.is_empty())
            })
            .unwrap_or("r2")
            .to_owned();
        let task_type = rows.iter().find_map(|row| {
            row.source
                .task_type
                .as_deref()
                .filter(|task_type| !task_type.is_empty())
                .map(str::to_owned)
        });
        let higher_is_better = metric_higher_is_better(&metric);
        let selected = select_rows(&rows, &metric, higher_is_better);
        if selected.is_empty() {
            continue;
        }
        let top_chains = selected
            .into_iter()
            .map(|(index, is_refit_only)| serialize_chain(&rows[index], is_refit_only))
            .collect::<Vec<_>>();
        datasets.push(json!({
            "dataset_name": dataset_name,
            "metric": metric,
            "task_type": task_type,
            "top_chains": top_chains,
        }));
    }

    augment_dataset_links(&mut datasets, linked_datasets);
    json!({"workspace_id": workspace_id, "datasets": datasets})
}

fn has_meaningful_final(row: &SummaryRow) -> bool {
    row.source.final_test_score.is_some()
        || row.source.final_train_score.is_some()
        || nonempty_object(&row.source.final_scores)
}

fn has_cv_payload(row: &SummaryRow) -> bool {
    row.source.cv_val_score.is_some()
        || row.source.cv_test_score.is_some()
        || row.source.cv_train_score.is_some()
        || row.source.cv_fold_count != 0
        || nonempty_object(&row.source.cv_scores)
}

fn apply_synthetic_refit(row: &mut SummaryRow) {
    if has_meaningful_final(row) || !has_cv_payload(row) {
        return;
    }
    row.source.final_test_score = row.source.cv_test_score;
    row.source.final_train_score = row.source.cv_train_score;
    row.source.final_scores = if nonempty_object(&row.source.cv_scores) {
        row.source.cv_scores.clone()
    } else {
        synthetic_final_scores(&row.source)
    };
    row.synthetic_refit = true;
}

fn synthetic_final_scores(row: &WorkspaceStoreResultsSummarySourceRow) -> Value {
    let Some(metric) = row.metric.as_deref().filter(|metric| !metric.is_empty()) else {
        return json!({});
    };
    let mut scores = Map::new();
    for (partition, score) in [
        ("val", row.cv_val_score),
        ("test", row.cv_test_score),
        ("train", row.cv_train_score),
    ] {
        if let Some(score) = score {
            scores.insert(partition.into(), json!({metric: score}));
        }
    }
    Value::Object(scores)
}

fn select_rows(rows: &[SummaryRow], metric: &str, higher_is_better: bool) -> Vec<(usize, bool)> {
    let cv_rows = rows
        .iter()
        .enumerate()
        .filter_map(|(index, row)| (row.source.cv_fold_count > 0).then_some(index))
        .collect::<Vec<_>>();
    let refit_only_rows = rows
        .iter()
        .enumerate()
        .filter_map(|(index, row)| {
            (row.source.cv_fold_count == 0 && row.source.final_test_score.is_some())
                .then_some(index)
        })
        .collect::<Vec<_>>();

    let mut best_final = None;
    let mut best_final_score = None;
    for (index, row) in rows.iter().enumerate() {
        let Some(score) = row.source.final_test_score else {
            continue;
        };
        if is_better(score, best_final_score, higher_is_better) {
            best_final = Some(index);
            best_final_score = Some(score);
        }
    }

    // This is the owner-ranked `studio_chain_ranked_v1` primitive over the
    // same immutable source snapshot: exact filters, NULL-last score ordering,
    // and `chain_id` as the deterministic tie breaker.
    let mut primary = rows
        .iter()
        .enumerate()
        .filter_map(|(index, row)| {
            (row.source.dataset_name == rows[0].source.dataset_name
                && row.source.metric.as_deref() == Some(metric))
            .then_some(index)
        })
        .collect::<Vec<_>>();
    primary.sort_by(|left, right| {
        compare_optional_scores(
            rows[*left].source.cv_val_score,
            rows[*right].source.cv_val_score,
            higher_is_better,
        )
        .then_with(|| {
            rows[*left]
                .source
                .chain_id
                .cmp(&rows[*right].source.chain_id)
        })
    });

    let mut top_cv = Vec::new();
    let mut seen_top_keys = HashSet::new();
    for index in primary.into_iter().take(TOP_N) {
        let row = &rows[index];
        let key = chain_key(&row.source);
        if !seen_top_keys.insert(key) {
            continue;
        }
        if row.source.cv_fold_count != 0 || row.source.cv_val_score.is_some() {
            top_cv.push(index);
        }
        if top_cv.len() >= TOP_N {
            break;
        }
    }

    if top_cv.len() < TOP_N {
        let mut fallback = cv_rows;
        fallback.sort_by(|left, right| {
            compare_optional_scores(
                rows[*left].source.cv_val_score,
                rows[*right].source.cv_val_score,
                higher_is_better,
            )
        });
        for index in fallback {
            if !seen_top_keys.insert(chain_key(&rows[index].source)) {
                continue;
            }
            top_cv.push(index);
            if top_cv.len() >= TOP_N {
                break;
            }
        }
    }

    let mut selected = Vec::new();
    let mut seen_chain_ids = HashSet::new();
    for (index, mark_refit_only) in top_cv
        .into_iter()
        .map(|index| (index, false))
        .chain(refit_only_rows.into_iter().map(|index| (index, true)))
        .chain(best_final.into_iter().map(|index| (index, false)))
    {
        let chain_id = &rows[index].source.chain_id;
        if !chain_id.is_empty() && !seen_chain_ids.insert(chain_id.clone()) {
            continue;
        }
        selected.push((index, mark_refit_only || rows[index].is_refit_only));
    }
    selected
}

fn compare_optional_scores(left: Option<f64>, right: Option<f64>, higher: bool) -> Ordering {
    match (left, right) {
        (Some(left), Some(right)) if higher => right.total_cmp(&left),
        (Some(left), Some(right)) => left.total_cmp(&right),
        (Some(_), None) => Ordering::Less,
        (None, Some(_)) => Ordering::Greater,
        (None, None) => Ordering::Equal,
    }
}

fn is_better(candidate: f64, incumbent: Option<f64>, higher: bool) -> bool {
    incumbent.is_none_or(|incumbent| {
        if higher {
            candidate > incumbent
        } else {
            candidate < incumbent
        }
    })
}

fn metric_higher_is_better(metric: &str) -> bool {
    let normalized = metric.trim().to_lowercase();
    !LOWER_IS_BETTER.contains(&normalized.as_str())
}

fn chain_key(row: &WorkspaceStoreResultsSummarySourceRow) -> String {
    if !row.chain_id.is_empty() {
        return format!("chain_id:{}", row.chain_id);
    }
    serde_json::to_string(&(
        &row.run_id,
        &row.pipeline_id,
        &row.dataset_name,
        &row.model_class,
        &row.model_name,
        &row.preprocessings,
    ))
    .expect("results-summary chain fallback key is JSON serializable")
}

fn serialize_chain(row: &SummaryRow, is_refit_only: bool) -> Value {
    let best_params = row.source.best_params.clone();
    let variant_params = merge_variant_params(
        extract_model_params(
            row.source.expanded_config.as_deref(),
            row.source.model_step_idx,
        ),
        best_params.as_ref(),
    );
    let mut payload = json!({
        "chain_id": row.source.chain_id,
        "run_id": row.source.run_id,
        "pipeline_id": row.source.pipeline_id,
        "pipeline_name": row.source.pipeline_name,
        "model_name": row.source.model_name.clone().unwrap_or_default(),
        "model_class": row.source.model_class,
        "preprocessings": row.source.preprocessings,
        "avg_val_score": row.source.cv_val_score,
        "avg_test_score": row.source.cv_test_score,
        "avg_train_score": row.source.cv_train_score,
        "fold_count": row.source.cv_fold_count,
        "scores": row.source.cv_scores,
        "cv_source_chain_id": null,
        "final_test_score": row.source.final_test_score,
        "final_train_score": row.source.final_train_score,
        "final_scores": row.source.final_scores,
        "final_agg_test_score": row.source.final_agg_test_score,
        "final_agg_train_score": row.source.final_agg_train_score,
        "final_agg_scores": row.source.final_agg_scores,
        "best_params": best_params,
        "variant_params": variant_params,
        "synthetic_refit": row.synthetic_refit,
    });
    if is_refit_only {
        payload
            .as_object_mut()
            .expect("chain payload is an object")
            .insert("is_refit_only".into(), Value::Bool(true));
    }
    sanitize_recursive(&mut payload);
    payload
}

fn extract_model_params(
    expanded_config: Option<&[Value]>,
    model_step_idx: i64,
) -> Option<&Map<String, Value>> {
    let index = usize::try_from(model_step_idx.checked_sub(1)?).ok()?;
    let step = expanded_config?.get(index)?.as_object()?;
    if step.contains_key("model") {
        return step.get("model")?.as_object()?.get("params")?.as_object();
    }
    step.get("params")?.as_object()
}

fn merge_variant_params(
    step_params: Option<&Map<String, Value>>,
    best_params: Option<&Value>,
) -> Option<Value> {
    let mut merged = Map::new();
    if let Some(step_params) = step_params {
        merged.extend(step_params.clone());
    }
    if let Some(best_params) = best_params.and_then(Value::as_object) {
        merged.extend(best_params.clone());
    }
    (!merged.is_empty()).then_some(Value::Object(merged))
}

fn nonempty_object(value: &Value) -> bool {
    value.as_object().is_some_and(|object| !object.is_empty())
}

fn sanitize_recursive(value: &mut Value) {
    match value {
        Value::Array(values) => values.iter_mut().for_each(sanitize_recursive),
        Value::Object(values) => values.values_mut().for_each(sanitize_recursive),
        _ => {}
    }
}

fn augment_dataset_links(datasets: &mut [Value], linked: &[DatasetLinkIdentity]) {
    if linked.is_empty() {
        return;
    }
    let linked_info = linked
        .iter()
        .map(|dataset| {
            let folder = Path::new(&dataset.path)
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or_default();
            (
                dataset.id.as_str(),
                dataset.name.to_lowercase(),
                dataset_match_key(&dataset.name),
                dataset_match_key(folder),
            )
        })
        .collect::<Vec<_>>();

    for dataset in datasets {
        let Some(object) = dataset.as_object_mut() else {
            continue;
        };
        let store_name = object
            .get("dataset_name")
            .or_else(|| object.get("name"))
            .or_else(|| object.get("dataset"))
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_owned();
        if store_name.is_empty() {
            continue;
        }
        object
            .entry("name")
            .or_insert_with(|| Value::String(store_name.clone()));
        object
            .entry("dataset_name")
            .or_insert_with(|| Value::String(store_name.clone()));

        let store_lower = store_name.to_lowercase();
        let store_key = dataset_match_key(&store_name);
        let exact = linked_info
            .iter()
            .find_map(|(id, name_lower, name_key, _)| {
                ((store_lower == *name_lower || (!store_key.is_empty() && store_key == *name_key))
                    && !id.is_empty())
                .then_some(*id)
            });
        if let Some(id) = exact {
            object.insert("linked_dataset_id".into(), Value::String(id.into()));
            continue;
        }

        let mut best_id = None;
        let mut best_len = 0;
        for (id, _, _, folder_key) in &linked_info {
            if !folder_key.is_empty()
                && store_key.starts_with(folder_key)
                && folder_key.len() > best_len
            {
                best_id = (!id.is_empty()).then_some(*id);
                best_len = folder_key.len();
            }
        }
        if let Some(id) = best_id {
            object.insert("linked_dataset_id".into(), Value::String(id.into()));
            continue;
        }
        for (id, _, name_key, _) in &linked_info {
            if !name_key.is_empty() && store_key.starts_with(name_key) && name_key.len() > best_len
            {
                best_id = (!id.is_empty()).then_some(*id);
                best_len = name_key.len();
            }
        }
        if let Some(id) = best_id {
            object.insert("linked_dataset_id".into(), Value::String(id.into()));
        }
    }
}

fn dataset_match_key(value: &str) -> String {
    value
        .chars()
        .flat_map(|character| {
            if character.is_alphanumeric() {
                character.to_lowercase().collect::<Vec<_>>()
            } else {
                vec!['_']
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use std::{fs, path::PathBuf, time::SystemTime};

    use serde_json::{json, Value};

    use super::{build_results_summary, read_results_summary};
    use crate::settings::DatasetLinkIdentity;
    use crate::workspace_store::WorkspaceStoreResultsSummarySourceRow;

    const PYTHON_WRITTEN_STORE: &[u8] =
        include_bytes!("../tests/fixtures/workspace_store_v5_summary.sqlite");
    const PYTHON_ORACLE: &str =
        include_str!("../tests/fixtures/workspace_store_v5_summary.response.json");
    const DATASET_LINKS: &str =
        include_str!("../tests/fixtures/workspace_store_v5_summary_dataset_links.json");

    #[test]
    fn matches_the_python_results_summary_oracle_exactly() {
        let workspace = fixture_workspace();
        let links: Value = serde_json::from_str(DATASET_LINKS).unwrap();
        let linked = links["datasets"]
            .as_array()
            .unwrap()
            .iter()
            .map(|dataset| DatasetLinkIdentity {
                id: dataset["id"].as_str().unwrap().into(),
                name: dataset["name"].as_str().unwrap().into(),
                path: dataset["path"].as_str().unwrap().into(),
            })
            .collect::<Vec<_>>();

        let actual = read_results_summary(&workspace, "workspace-summary-v5", &linked).unwrap();
        let expected: Value = serde_json::from_str(PYTHON_ORACLE).unwrap();

        assert_eq!(actual, expected);
        assert!(!workspace.join("store.sqlite-wal").exists());
        assert!(!workspace.join("store.sqlite-shm").exists());
        fs::remove_dir_all(workspace).unwrap();
    }

    #[test]
    fn marks_a_fold_zero_final_candidate_when_cv_payload_prevents_intrinsic_marker() {
        let source = WorkspaceStoreResultsSummarySourceRow {
            chain_id: "mixed-payload".into(),
            pipeline_id: "pipeline".into(),
            run_id: "run".into(),
            pipeline_name: "Pipeline".into(),
            expanded_config: None,
            model_step_idx: 0,
            dataset_name: "dataset".into(),
            metric: Some("r2".into()),
            task_type: None,
            model_name: None,
            model_class: "Model".into(),
            preprocessings: String::new(),
            cv_val_score: None,
            cv_test_score: Some(0.7),
            cv_train_score: None,
            cv_fold_count: 0,
            cv_scores: json!({"test": {"r2": 0.7}}),
            final_test_score: Some(0.8),
            final_train_score: None,
            final_scores: json!({"test": {"r2": 0.8}}),
            final_agg_test_score: None,
            final_agg_train_score: None,
            final_agg_scores: json!({}),
            best_params: None,
        };

        let summary = build_results_summary(vec![source], "workspace", &[]);
        assert_eq!(
            summary["datasets"][0]["top_chains"][0]["is_refit_only"],
            true
        );
    }

    fn fixture_workspace() -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let workspace = std::env::temp_dir().join(format!(
            "studio-sidecar-results-summary-{}-{nonce}",
            std::process::id()
        ));
        fs::create_dir_all(&workspace).unwrap();
        fs::write(workspace.join("store.sqlite"), PYTHON_WRITTEN_STORE).unwrap();
        workspace
    }
}
