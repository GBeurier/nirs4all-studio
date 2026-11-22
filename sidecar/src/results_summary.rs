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

use rusqlite::Connection;
use serde_json::{json, Map, Value};

use crate::{
    settings::DatasetLinkIdentity,
    workspace_store::{
        read_results_summary_source_from_connection, WorkspaceStoreReadError,
        WorkspaceStoreResultsSummarySourceRow,
    },
};

const TOP_N: usize = 5;
// Mirrors nirs4all-ui `LOWER_IS_BETTER` so backend top-N selection and UI
// ordering agree. Debt: direction belongs to the DAG-ML metric registry
// (docs/development/TECHNICAL_DEBT.md, TD-STUDIO-2026-11-22-01).
const LOWER_IS_BETTER: [&str; 15] = [
    "rmse",
    "rmsecv",
    "rmsep",
    "mse",
    "mae",
    "mape",
    "bias",
    "sep",
    "nrmse",
    "nmse",
    "nmae",
    "max_error",
    "median_ae",
    "hamming_loss",
    "log_loss",
];

type DatasetProvenance = BTreeMap<(String, String), Option<String>>;

#[derive(Clone)]
struct SummaryRow {
    source: WorkspaceStoreResultsSummarySourceRow,
    synthetic_refit: bool,
    is_refit_only: bool,
}

pub fn read_results_summary_from_connection(
    connection: &Connection,
    workspace_id: &str,
    linked_datasets: &[DatasetLinkIdentity],
) -> Result<Value, WorkspaceStoreReadError> {
    let rows = read_results_summary_source_from_connection(connection)?;
    let provenance = read_dataset_provenance(connection, &rows)?;
    Ok(build_results_summary_with_provenance(
        rows,
        workspace_id,
        linked_datasets,
        &provenance,
    ))
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
    let connection = crate::workspace_store::open_read_snapshot(workspace_path)?;
    read_results_summary_from_connection(&connection, workspace_id, linked_datasets)
}

pub fn build_results_summary(
    rows: Vec<WorkspaceStoreResultsSummarySourceRow>,
    workspace_id: &str,
    linked_datasets: &[DatasetLinkIdentity],
) -> Value {
    build_results_summary_with_provenance(rows, workspace_id, linked_datasets, &BTreeMap::new())
}

fn read_dataset_provenance(
    connection: &Connection,
    rows: &[WorkspaceStoreResultsSummarySourceRow],
) -> Result<DatasetProvenance, WorkspaceStoreReadError> {
    let mut provenance = DatasetProvenance::new();
    let ids = rows
        .iter()
        .map(|row| row.run_id.as_str())
        .collect::<std::collections::BTreeSet<_>>();
    let ids = ids.into_iter().collect::<Vec<_>>();
    for detail in crate::workspace_store::read_run_metadata_batch_from_connection(connection, &ids)?
    {
        let Some(id) = detail["run_id"].as_str() else {
            continue;
        };
        for dataset in detail["datasets"].as_array().into_iter().flatten() {
            if let (Some(name), Some(link)) = (
                dataset["name"].as_str(),
                dataset["linked_dataset_id"].as_str(),
            ) {
                if name.is_empty() || link.is_empty() {
                    continue;
                }
                provenance
                    .entry((id.into(), name.into()))
                    .and_modify(|current| {
                        if current.as_deref() != Some(link) {
                            *current = None;
                        }
                    })
                    .or_insert_with(|| Some(link.into()));
            }
        }
    }
    Ok(provenance)
}

fn build_results_summary_with_provenance(
    rows: Vec<WorkspaceStoreResultsSummarySourceRow>,
    workspace_id: &str,
    linked_datasets: &[DatasetLinkIdentity],
    provenance: &DatasetProvenance,
) -> Value {
    let dataset_links = DatasetLinkMatcher::new(linked_datasets);
    let historical_ids = historical_dataset_ids(provenance);
    let mut legacy_links = BTreeMap::new();
    let mut grouped = BTreeMap::<(Option<String>, String), Vec<SummaryRow>>::new();
    for source in rows {
        if source.dataset_name.is_empty() {
            continue;
        }
        let name = &source.dataset_name;
        let historical_id = historical_ids.get(name.as_str());
        let legacy_link = *legacy_links.entry(name.clone()).or_insert_with(|| {
            dataset_links
                .match_name(name)
                .filter(|id| historical_id.is_none_or(|historical| *historical == Some(*id)))
        });
        let group_id = provenance
            .get(&(source.run_id.clone(), name.clone()))
            .cloned()
            .unwrap_or_else(|| historical_id.and(legacy_link).map(str::to_owned));
        let mut row = SummaryRow {
            source,
            synthetic_refit: false,
            is_refit_only: false,
        };
        row.is_refit_only = has_meaningful_final(&row) && !has_cv_payload(&row);
        apply_synthetic_refit(&mut row);
        grouped
            .entry((group_id, row.source.dataset_name.clone()))
            .or_default()
            .push(row);
    }

    let mut datasets = Vec::new();
    for ((linked_dataset_id, dataset_name), rows) in grouped {
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
        let mut dataset = json!({
            "dataset_name": dataset_name,
            "metric": metric,
            "task_type": task_type,
            "top_chains": top_chains,
        });
        if !linked_datasets.is_empty() {
            dataset["name"] = json!(dataset_name);
        }
        let display_link = linked_dataset_id.as_deref().map_or_else(
            || legacy_links[&dataset_name],
            |id| dataset_links.contains(id).then_some(id),
        );
        if let Some(id) = display_link {
            dataset["linked_dataset_id"] = json!(id);
        }
        datasets.push(dataset);
    }

    json!({"workspace_id": workspace_id, "datasets": datasets})
}

// A unique catalogue match can join legacy results to identified ones only
// when it agrees with all recorded identities for that stored name.
fn historical_dataset_ids(provenance: &DatasetProvenance) -> BTreeMap<&str, Option<&str>> {
    let mut ids = BTreeMap::new();
    for ((_, name), id) in provenance {
        let id = id.as_deref();
        ids.entry(name.as_str())
            .and_modify(|current| {
                if *current != id {
                    *current = None;
                }
            })
            .or_insert(id);
    }
    ids
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
            // Owner extension full_train_only_v1: a real REFIT with no CV or
            // test cohort remains inspectable. Its training score is never
            // promoted to a validation/test score or ranked as a best test.
            ((row.source.cv_fold_count == 0 && row.source.final_test_score.is_some())
                || row.is_refit_only)
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

pub fn metric_higher_is_better(metric: &str) -> bool {
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
    if let Some(context) = &row.source.target_domain_context {
        payload["cv_summary_fold_id"] = json!("macro");
        payload["target_domain_context"] = json!(context);
    }
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
    let steps = expanded_config?;
    let step = if let Ok(index) = usize::try_from(model_step_idx.checked_sub(1)?) {
        steps.get(index)?.as_object()?
    } else {
        let mut models = steps
            .iter()
            .filter_map(Value::as_object)
            .filter(|step| step.contains_key("model"));
        let model = models.next()?;
        if models.next().is_some() {
            return None;
        }
        model
    };
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

pub fn augment_dataset_links(datasets: &mut [Value], linked: &[DatasetLinkIdentity]) {
    if linked.is_empty() {
        for dataset in datasets {
            if let Some(object) = dataset.as_object_mut() {
                object.remove("linked_dataset_id");
            }
        }
        return;
    }
    let matcher = DatasetLinkMatcher::new(linked);

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

        if let Some(id) = object.get("linked_dataset_id").and_then(Value::as_str) {
            if !matcher.contains(id) {
                object.remove("linked_dataset_id");
            }
            // An explicit owner identity cannot be rebound to another import
            // merely because its display name was reused after unlinking.
            continue;
        }

        if let Some(id) = matcher.match_name(&store_name) {
            object.insert("linked_dataset_id".into(), Value::String(id.into()));
        } else {
            object.remove("linked_dataset_id");
        }
    }
}

struct DatasetLinkKeys<'a> {
    id: &'a str,
    lower_name: String,
    name_key: String,
    folder_key: String,
}

struct DatasetLinkMatcher<'a>(Vec<DatasetLinkKeys<'a>>);

impl<'a> DatasetLinkMatcher<'a> {
    fn new(linked: &'a [DatasetLinkIdentity]) -> Self {
        Self(
            linked
                .iter()
                .map(|dataset| {
                    let folder = Path::new(&dataset.path)
                        .file_name()
                        .and_then(|name| name.to_str())
                        .unwrap_or_default();
                    DatasetLinkKeys {
                        id: &dataset.id,
                        lower_name: dataset.name.to_lowercase(),
                        name_key: dataset_match_key(&dataset.name),
                        folder_key: dataset_match_key(folder),
                    }
                })
                .collect(),
        )
    }

    fn contains(&self, id: &str) -> bool {
        self.0.iter().any(|dataset| dataset.id == id)
    }

    fn match_name(&self, store_name: &str) -> Option<&'a str> {
        let store_lower = store_name.to_lowercase();
        let store_key = dataset_match_key(store_name);
        let mut exact = self.0.iter().filter(|dataset| {
            !dataset.id.is_empty()
                && (store_lower == dataset.lower_name
                    || (!store_key.is_empty() && store_key == dataset.name_key))
        });
        if let Some(dataset) = exact.next() {
            // Several imports may share one display name, such as "raw".
            return exact.next().is_none().then_some(dataset.id);
        }

        for use_folder in [true, false] {
            let mut candidates = Vec::new();
            let mut best_len = 0;
            for dataset in &self.0 {
                let key = if use_folder {
                    &dataset.folder_key
                } else {
                    &dataset.name_key
                };
                if dataset.id.is_empty() || key.is_empty() || !store_key.starts_with(key) {
                    continue;
                }
                if key.len() > best_len {
                    candidates.clear();
                    best_len = key.len();
                }
                if key.len() == best_len && !candidates.contains(&dataset.id) {
                    candidates.push(dataset.id);
                }
            }
            if !candidates.is_empty() {
                return (candidates.len() == 1).then_some(candidates[0]);
            }
        }
        None
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
    fn duplicate_display_names_do_not_invent_dataset_identity() {
        let links = vec![
            DatasetLinkIdentity {
                id: "alpine".into(),
                name: "raw".into(),
                path: "/alpine/raw".into(),
            },
            DatasetLinkIdentity {
                id: "beer".into(),
                name: "raw".into(),
                path: "/beer/raw".into(),
            },
        ];
        let mut datasets = vec![
            json!({"name":"raw"}),
            json!({"name":"raw","linked_dataset_id":"beer"}),
            json!({"name":"raw_variant"}),
        ];
        super::augment_dataset_links(&mut datasets, &links);
        assert!(datasets[0].get("linked_dataset_id").is_none());
        assert_eq!(datasets[1]["linked_dataset_id"], "beer");
        assert!(datasets[2].get("linked_dataset_id").is_none());
    }

    #[test]
    fn stale_explicit_identity_never_rebinds_to_a_new_import_with_the_same_name() {
        let links = vec![DatasetLinkIdentity {
            id: "new-beer".into(),
            name: "raw".into(),
            path: "/new/raw".into(),
        }];
        let mut datasets = vec![
            json!({"dataset_name":"raw","linked_dataset_id":"old-beer"}),
            json!({"dataset_name":"raw","linked_dataset_id":"new-beer"}),
        ];
        super::augment_dataset_links(&mut datasets, &links);
        assert!(datasets[0].get("linked_dataset_id").is_none());
        assert_eq!(datasets[1]["linked_dataset_id"], "new-beer");
        super::augment_dataset_links(&mut datasets, &[]);
        assert!(datasets[1].get("linked_dataset_id").is_none());
    }

    #[test]
    fn legacy_and_identified_runs_share_one_dataset_card_before_ranking() {
        let workspace = fixture_workspace();
        let mut rows = crate::workspace_store::read_results_summary_source(&workspace).unwrap();
        fs::remove_dir_all(workspace).unwrap();
        rows.truncate(2);
        for (row, id) in rows.iter_mut().zip(["current", "legacy"]) {
            row.run_id = id.into();
            row.dataset_name = "raw".into();
            row.metric = Some("rmse".into());
            row.cv_fold_count = 3;
            row.cv_val_score = Some(0.2);
        }
        let links = [DatasetLinkIdentity {
            id: "linked-raw".into(),
            name: "raw".into(),
            path: "/workspace/raw".into(),
        }];
        let current_dataset = ("current".into(), "raw".into());
        let mut provenance =
            super::DatasetProvenance::from([(current_dataset.clone(), Some("linked-raw".into()))]);
        let summary =
            super::build_results_summary_with_provenance(rows.clone(), "ws", &links, &provenance);
        let datasets = summary["datasets"].as_array().unwrap();
        assert_eq!(datasets.len(), 1);
        assert_eq!(datasets[0]["linked_dataset_id"], "linked-raw");
        let visible_runs = datasets[0]["top_chains"]
            .as_array()
            .unwrap()
            .iter()
            .map(|chain| chain["run_id"].as_str().unwrap())
            .collect::<std::collections::BTreeSet<_>>();
        assert_eq!(visible_runs, ["current", "legacy"].into());

        provenance.insert(current_dataset, Some("unlinked-raw".into()));
        let summary = super::build_results_summary_with_provenance(rows, "ws", &links, &provenance);
        let datasets = summary["datasets"].as_array().unwrap();
        assert_eq!(datasets.len(), 2);
        assert!(datasets
            .iter()
            .all(|dataset| dataset.get("linked_dataset_id").is_none()));
    }

    #[test]
    fn owner_provenance_keeps_same_basename_datasets_separate_and_ambiguity_unlinked() {
        let workspace = fixture_workspace();
        let connection = rusqlite::Connection::open(workspace.join("store.sqlite")).unwrap();
        connection.execute_batch("DELETE FROM predictions;DELETE FROM chains;DELETE FROM pipelines;DELETE FROM runs;").unwrap();
        for (suffix, identity) in [
            ("beer", Some("beer")),
            ("alpine", Some("alpine")),
            ("unknown", None),
        ] {
            let dataset = identity.map_or_else(
                || json!({"name":"raw"}),
                |id| json!({"name":"raw","linked_dataset_id":id}),
            );
            connection
                .execute(
                    "INSERT INTO runs(run_id,name,datasets,status) VALUES (?1,?1,?2,'completed')",
                    rusqlite::params![format!("run-{suffix}"), json!([dataset]).to_string()],
                )
                .unwrap();
            connection.execute("INSERT INTO pipelines(pipeline_id,run_id,name,dataset_name,metric,status) VALUES (?1,?2,?1,'raw','rmse','completed')",rusqlite::params![format!("pipeline-{suffix}"),format!("run-{suffix}")]).unwrap();
            connection.execute("INSERT INTO chains(chain_id,pipeline_id,steps,model_step_idx,model_class,dataset_name,metric,cv_fold_count,cv_val_score,final_test_score) VALUES (?1,?2,'[]',0,'PLSRegression','raw','rmse',3,0.2,0.3)",rusqlite::params![format!("chain-{suffix}"),format!("pipeline-{suffix}")]).unwrap();
            connection.execute("INSERT INTO predictions(prediction_id,pipeline_id,chain_id,dataset_name,model_name,model_class,fold_id,partition,metric,task_type) VALUES (?1,?2,?3,'raw','PLSRegression','PLSRegression','final','test','rmse','regression')",rusqlite::params![format!("prediction-{suffix}"),format!("pipeline-{suffix}"),format!("chain-{suffix}")]).unwrap();
        }
        let links = vec![
            DatasetLinkIdentity {
                id: "beer".into(),
                name: "raw".into(),
                path: "/beer/raw".into(),
            },
            DatasetLinkIdentity {
                id: "alpine".into(),
                name: "raw".into(),
                path: "/alpine/raw".into(),
            },
        ];
        let summary =
            super::read_results_summary_from_connection(&connection, "workspace", &links).unwrap();
        let datasets = summary["datasets"].as_array().unwrap();
        assert_eq!(datasets.len(), 3);
        for identity in ["beer", "alpine"] {
            let dataset = datasets
                .iter()
                .find(|dataset| dataset["linked_dataset_id"] == identity)
                .unwrap();
            assert_eq!(dataset["top_chains"].as_array().unwrap().len(), 1);
            assert_eq!(
                dataset["top_chains"][0]["chain_id"],
                format!("chain-{identity}")
            );
        }
        let unknown = datasets
            .iter()
            .find(|dataset| dataset.get("linked_dataset_id").is_none())
            .unwrap();
        assert_eq!(unknown["top_chains"][0]["chain_id"], "chain-unknown");
        connection.execute("UPDATE runs SET datasets=?1 WHERE run_id='run-beer'",[json!([{"name":"raw","linked_dataset_id":"beer"},{"name":"raw","linked_dataset_id":"alpine"}]).to_string()]).unwrap();
        let source =
            crate::workspace_store::read_results_summary_source_from_connection(&connection)
                .unwrap();
        let provenance = super::read_dataset_provenance(&connection, &source).unwrap();
        assert_eq!(
            provenance.get(&("run-beer".into(), "raw".into())),
            Some(&None)
        );
        assert_eq!(
            provenance
                .get(&("run-alpine".into(), "raw".into()))
                .and_then(Option::as_deref),
            Some("alpine")
        );
        drop(connection);
        fs::remove_dir_all(workspace).unwrap();
    }

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
            target_domain_context: None,
        };

        let summary = build_results_summary(vec![source], "workspace", &[]);
        assert_eq!(
            summary["datasets"][0]["top_chains"][0]["is_refit_only"],
            true
        );
    }

    #[test]
    fn full_train_without_cv_or_test_remains_visible_in_results_and_history() {
        let workspace = fixture_workspace();
        let connection = rusqlite::Connection::open(workspace.join("store.sqlite")).unwrap();
        connection
            .execute_batch(
                "UPDATE chains SET cv_val_score=NULL, cv_test_score=NULL,
            cv_train_score=NULL, cv_fold_count=0, cv_scores='{}', final_test_score=NULL,
            final_train_score=0.125, final_scores='{\"train\":{\"rmse\":0.125}}';",
            )
            .unwrap();
        let source =
            crate::workspace_store::read_results_summary_source_from_connection(&connection)
                .unwrap();
        let expected_count = source.len();
        let summary = build_results_summary(source, "workspace", &[]);
        let mut count = 0;
        for dataset in summary["datasets"].as_array().unwrap() {
            for chain in dataset["top_chains"].as_array().unwrap() {
                assert_eq!(chain["avg_val_score"], Value::Null);
                assert_eq!(chain["avg_test_score"], Value::Null);
                assert_eq!(chain["fold_count"], 0);
                assert_eq!(chain["final_test_score"], Value::Null);
                assert_eq!(chain["final_train_score"], 0.125);
                assert_eq!(chain["is_refit_only"], true);
                assert_eq!(chain["synthetic_refit"], false);
                count += 1;
            }
        }
        assert_eq!(count, expected_count);
        assert!(count > 0);
        let history = crate::run_history::read_enriched_runs_from_connection(
            &connection,
            "workspace",
            &[],
            None,
            100,
            0,
        )
        .unwrap();
        let mut historical_count = 0;
        for dataset in history["runs"][0]["datasets"].as_array().unwrap() {
            assert_eq!(dataset["best_avg_val_score"], Value::Null);
            assert_eq!(dataset["best_final_score"], Value::Null);
            historical_count += dataset["top_5"].as_array().unwrap().len();
        }
        assert_eq!(historical_count, expected_count);
        drop(connection);
        fs::remove_dir_all(workspace).unwrap();
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
