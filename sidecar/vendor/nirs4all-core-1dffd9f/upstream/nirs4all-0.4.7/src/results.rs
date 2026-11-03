//! Read a persisted experiment through dag-ml's validated native results store.
//!
//! The JSON view is a checked projection for host languages. Scores and
//! predictions remain owned by the native results triple; a linked Core
//! Archive V2 is a separate model transport, not a checkpoint or workspace.

use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};

use dag_ml_results::{read_native_results, NativePredictionRow, NativeResultsView};
use serde_json::Value;
use sha2::{Digest, Sha256};

const RESULT_FILES: [&str; 3] = ["manifest.json", "score_set.json", "predictions.parquet"];

/// A closed, checked view of one persisted experiment.
pub struct ExperimentResults {
    pub path: PathBuf,
    pub run_id: String,
    pub winner_variant_id: String,
    pub native: NativeResultsView,
    pub model_archive: Option<PathBuf>,
}

impl ExperimentResults {
    /// Native score reports in their stored partition/fold scope.
    pub fn compare(
        &self,
        variant_id: Option<&str>,
        partition: Option<&str>,
    ) -> Result<Vec<&Value>, String> {
        self.check_variant(variant_id)?;
        Ok(self.native.score_set["reports"]
            .as_array()
            .into_iter()
            .flatten()
            .filter(|report| {
                variant_id.is_none_or(|id| report["variant_id"].as_str() == Some(id))
                    && partition.is_none_or(|name| report["partition"].as_str() == Some(name))
            })
            .collect())
    }

    /// Native prediction rows, preserving physical sample IDs and target shape.
    pub fn predictions(
        &self,
        variant_id: Option<&str>,
        partition: Option<&str>,
        fold_id: Option<&str>,
    ) -> Result<Vec<&NativePredictionRow>, String> {
        self.check_variant(variant_id)?;
        Ok(self
            .native
            .predictions
            .iter()
            .filter(|row| {
                variant_id.is_none_or(|id| row.variant_id == id)
                    && partition.is_none_or(|name| row.partition == name)
                    && fold_id.is_none_or(|id| row.fold_id == id)
            })
            .collect())
    }

    fn check_variant(&self, variant_id: Option<&str>) -> Result<(), String> {
        if let Some(id) = variant_id {
            let present = self
                .native
                .predictions
                .iter()
                .any(|row| row.variant_id == id)
                || self.native.score_set["reports"]
                    .as_array()
                    .is_some_and(|reports| {
                        reports
                            .iter()
                            .any(|report| report["variant_id"].as_str() == Some(id))
                    });
            if !present {
                return Err(format!("unknown variant_id {id:?}"));
            }
        }
        Ok(())
    }
}

fn invalid(message: impl Into<String>) -> String {
    message.into()
}

fn regular_file(path: &Path) -> Result<(), String> {
    let metadata =
        fs::symlink_metadata(path).map_err(|error| format!("{}: {error}", path.display()))?;
    if !metadata.file_type().is_file() {
        return Err(invalid(format!(
            "experiment member is not a regular file: {}",
            path.display()
        )));
    }
    Ok(())
}

fn sha256(path: &Path) -> Result<String, String> {
    regular_file(path)?;
    let bytes = fs::read(path).map_err(|error| format!("{}: {error}", path.display()))?;
    Ok(format!("{:x}", Sha256::digest(bytes)))
}

fn required<'a>(value: &'a Value, key: &str) -> Result<&'a str, String> {
    value[key]
        .as_str()
        .ok_or_else(|| invalid(format!("experiment {key} must be a string")))
}

/// Reopen a Python/Core-created experiment and revalidate its native triple.
pub fn open_experiment_results(path: impl AsRef<Path>) -> Result<ExperimentResults, String> {
    let path = path.as_ref();
    let index_path = path.join("experiment.json");
    regular_file(&index_path)?;
    let index: Value =
        serde_json::from_slice(&fs::read(&index_path).map_err(|error| error.to_string())?)
            .map_err(|error| format!("invalid experiment index: {error}"))?;
    if required(&index, "schema")? != "nirs4all.experiment.v1" {
        return Err(invalid("unsupported experiment schema"));
    }
    let run_id = required(&index, "run_id")?.to_owned();
    let winner_variant_id = required(&index, "winner_variant_id")?.to_owned();
    if run_id.is_empty() || winner_variant_id.is_empty() {
        return Err(invalid("experiment run and winner IDs must be nonempty"));
    }
    let declared = index["results"]
        .as_object()
        .ok_or_else(|| invalid("invalid results inventory"))?;
    if declared.keys().map(String::as_str).collect::<BTreeSet<_>>()
        != RESULT_FILES.into_iter().collect()
    {
        return Err(invalid("invalid results inventory"));
    }
    for name in RESULT_FILES {
        let actual = sha256(&path.join("results").join(name))?;
        if declared[name].as_str() != Some(actual.as_str()) {
            return Err(invalid(format!("experiment result hash mismatch: {name}")));
        }
    }
    let projection_path = path.join("result_view.json");
    if index["result_view_sha256"].as_str() != Some(sha256(&projection_path)?.as_str()) {
        return Err(invalid("experiment result view hash mismatch"));
    }
    let native = read_native_results(path.join("results")).map_err(|error| error.to_string())?;
    let projection: Value =
        serde_json::from_slice(&fs::read(&projection_path).map_err(|error| error.to_string())?)
            .map_err(|error| format!("invalid experiment result view: {error}"))?;
    if projection != serde_json::to_value(&native).map_err(|error| error.to_string())? {
        return Err(invalid(
            "experiment result view disagrees with native results",
        ));
    }
    if required(&native.manifest, "run_id")? != run_id
        || required(&native.manifest, "selected_variant_id")? != winner_variant_id
    {
        return Err(invalid("native result identity disagrees with experiment"));
    }
    let present = native
        .predictions
        .iter()
        .any(|row| row.variant_id == winner_variant_id)
        || native.score_set["reports"]
            .as_array()
            .is_some_and(|reports| {
                reports
                    .iter()
                    .any(|report| report["variant_id"].as_str() == Some(winner_variant_id.as_str()))
            });
    if !present {
        return Err(invalid("winner is absent from native results"));
    }
    let model_archive = if index["model_archive"].is_null() {
        None
    } else {
        let model = &index["model_archive"];
        if required(model, "path")? != "model.n4a" {
            return Err(invalid("invalid model archive path"));
        }
        let model_path = path.join("model.n4a");
        let model_hash = sha256(&model_path)?;
        if Some(model_hash.as_str()) != model["sha256"].as_str() {
            return Err(invalid("experiment model archive hash mismatch"));
        }
        let archive = crate::load_archive_v2(&model_path).map_err(|error| error.to_string())?;
        let package_text = std::str::from_utf8(
            archive
                .portable_predictor_package()
                .map_err(|error| error.to_string())?,
        )
        .map_err(|error| error.to_string())?;
        let package = dag_ml_core::PortablePredictorPackage::from_json(package_text)
            .map_err(|error| error.to_string())?;
        dag_ml_core::validate_archive_v2_portable_payloads(
            archive.manifest(),
            &package,
            archive.members(),
        )
        .map_err(|error| error.to_string())?;
        let outcome_text = std::str::from_utf8(
            archive
                .member("dagml/training_outcome.json")
                .map_err(|error| error.to_string())?,
        )
        .map_err(|error| error.to_string())?;
        let outcome = dag_ml_core::TrainingOutcome::from_json(outcome_text)
            .map_err(|error| error.to_string())?;
        if outcome.run_id.as_str() != run_id
            || outcome.selected_variant_id.as_str() != winner_variant_id
            || native.manifest["training_outcome_fingerprint"].as_str()
                != Some(outcome.outcome_fingerprint.as_str())
            || native.score_set
                != serde_json::to_value(&outcome.score_set).map_err(|error| error.to_string())?
            || package.training_outcome.outcome_fingerprint != outcome.outcome_fingerprint
            || package
                .execution_bundle
                .selected_variant_id
                .as_ref()
                .map(|id| id.as_str())
                != Some(winner_variant_id.as_str())
        {
            return Err(invalid(
                "model archive does not close over experiment winner",
            ));
        }
        let rows: Vec<Value> = native
            .predictions
            .iter()
            .map(|row| serde_json::to_value(row).map_err(|error| error.to_string()))
            .collect::<Result<_, _>>()?;
        crate::result_projection::validate_training_predictions(&outcome, &rows)?;
        Some(model_path)
    };
    Ok(ExperimentResults {
        path: path.to_path_buf(),
        run_id,
        winner_variant_id,
        native,
        model_archive,
    })
}

/// Persist the exact native training evidence without rescoring or reselection.
///
/// CV score reports keep their fold scopes; prediction rows contain the native
/// retained OOF averages, CV ensembles and selected final output blocks. An
/// absent final target block stays absent rather than being reconstructed.
pub fn write_training_results(
    outcome: &dag_ml_core::TrainingOutcome,
    dataset: &crate::io_training::DatasetPackage,
    source_id: &str,
    directory: impl AsRef<Path>,
) -> Result<NativeResultsView, String> {
    outcome.validate().map_err(|error| error.to_string())?;
    let _ = source_id; // IO/source attestation already bound the signed outcome.
    let projected = crate::result_projection::project_training_predictions(
        outcome,
        &dataset.name,
        &dataset.task_type,
    )?;
    let rows: Vec<NativePredictionRow> = projected
        .into_iter()
        .map(|row| serde_json::from_value(row).map_err(|error| error.to_string()))
        .collect::<Result<_, _>>()?;
    let selected = outcome.selected_variant_id.as_str();
    let scores = serde_json::to_value(&outcome.score_set).map_err(|error| error.to_string())?;
    let manifest = serde_json::json!({
        "schema_version": 2, "engine": "dag-ml", "run_id": outcome.run_id.as_str(),
        "selected_variant_id": selected, "training_outcome_fingerprint": outcome.outcome_fingerprint,
        "score_set_hash": dag_ml_results::score_set_hash(&scores),
        "files": {"score_set": "score_set.json", "predictions": "predictions.parquet"}
    });
    fs::create_dir(directory.as_ref()).map_err(|error| error.to_string())?;
    dag_ml_results::write_native_results(directory.as_ref(), manifest, scores, rows)
        .map_err(|error| error.to_string())?;
    read_native_results(directory).map_err(|error| error.to_string())
}

/// Atomically save a native result and optional selected Core Archive V2.
/// Native run and winner identity are read from the result manifest.
pub fn save_experiment_results(
    native_directory: impl AsRef<Path>,
    destination: impl AsRef<Path>,
    model_archive: Option<&Path>,
) -> Result<ExperimentResults, String> {
    let source = native_directory.as_ref();
    let target = destination.as_ref();
    if fs::symlink_metadata(target).is_ok() {
        return Err("experiment destination already exists".into());
    }
    let native = read_native_results(source).map_err(|error| error.to_string())?;
    let run_id = required(&native.manifest, "run_id")?;
    let winner = required(&native.manifest, "selected_variant_id")?;
    let parent = target
        .parent()
        .filter(|path| !path.as_os_str().is_empty())
        .unwrap_or(Path::new("."));
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    let temporary = tempfile::Builder::new()
        .prefix(".nirs4all-experiment-")
        .tempdir_in(parent)
        .map_err(|error| error.to_string())?;
    let result_directory = temporary.path().join("results");
    fs::create_dir(&result_directory).map_err(|error| error.to_string())?;
    let mut inventory = serde_json::Map::new();
    for name in RESULT_FILES {
        regular_file(&source.join(name))?;
        let member = result_directory.join(name);
        fs::copy(source.join(name), &member).map_err(|error| error.to_string())?;
        inventory.insert(name.into(), Value::String(sha256(&member)?));
    }
    let copied = read_native_results(&result_directory).map_err(|error| error.to_string())?;
    let projection = temporary.path().join("result_view.json");
    fs::write(
        &projection,
        serde_json::to_vec(&copied).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())?;
    let model = if let Some(archive) = model_archive {
        regular_file(archive)?;
        let member = temporary.path().join("model.n4a");
        fs::copy(archive, &member).map_err(|error| error.to_string())?;
        serde_json::json!({"path": "model.n4a", "sha256": sha256(&member)?})
    } else {
        Value::Null
    };
    let index = serde_json::json!({
        "schema": "nirs4all.experiment.v1", "run_id": run_id, "winner_variant_id": winner,
        "results": inventory, "result_view_sha256": sha256(&projection)?, "model_archive": model
    });
    fs::write(
        temporary.path().join("experiment.json"),
        serde_json::to_vec(&index).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())?;
    // Validate full model/results closure before publishing the destination.
    open_experiment_results(temporary.path())?;
    crate::publish_directory_noreplace(temporary.path(), target)?;
    open_experiment_results(target)
}
