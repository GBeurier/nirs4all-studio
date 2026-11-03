//! Native archive transport for hosts that do not embed the Rust aggregate.
//!
//! Core validates the container and passes the original package bytes to DAG-ML.
//! DAG-ML owns package validation, process callbacks, hydration and replay. This
//! Dataset commands delegate construction to IO. Workflow commands compose
//! existing upstream entry points; the binary never interprets numerical state.

use std::collections::BTreeMap;
use std::error::Error;
use std::ffi::OsString;
use std::fs::{File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::Command;

use crate::{
    archive_v2_view, archive_v3_view, archive_view, load_archive, load_archive_v2,
    predict_methods_archive_v2_matrix, preflight_methods_archive_v2_library,
    replay_methods_archive_v2_json, replay_methods_archive_v3_json, run_dense_regression_workflow,
    DenseRegressionPreprocessing, DenseRegressionWorkflowRequest, LoadedArchive,
    MethodsArchiveMatrixPredictRequest, MethodsArchiveReplayJsonRequest,
};
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

type Result<T> = std::result::Result<T, Box<dyn Error>>;

// Core's existing physical transport bounds. This binary does not parse ZIP
// structures: these limits only bound copying the already-validated container
// and caller JSON into owning native entry points.
const MAX_JSON_TRANSPORT_BYTES: u64 = 134_217_728;
const MAX_ARCHIVE_TRANSPORT_BYTES: u64 = 536_870_912 + 256 * (4096 + 76) + 22;

fn options(
    args: impl IntoIterator<Item = OsString>,
) -> Result<(String, BTreeMap<String, OsString>)> {
    let mut args = args.into_iter();
    let command = args
        .next()
        .ok_or("expected inspect, read-member, replay-process, replay-methods, dataset-normalize or dataset-u07-sources")?;
    let command = command.into_string().map_err(|_| "command must be UTF-8")?;
    if !matches!(
        command.as_str(),
        "inspect"
            | "read-member"
            | "replay-process"
            | "replay-methods"
            | "dataset-normalize"
            | "dataset-content"
            | "dataset-compatible-schemas"
            | "dataset-u07-sources"
            | "multimodal-replay-inputs"
            | "native-multimodal-run"
            | "native-multimodal-load"
            | "native-multimodal-predict"
            | "native-multimodal-export"
            | "pipeline-retrain"
            | "native-multimodal-retrain"
            | "pipeline-run"
            | "pipeline-export"
            | "pipeline-load"
            | "pipeline-predict"
            | "workflow-run"
            | "workflow-predict"
            | "workflow-load"
            | "training-result-view"
            | "experiment-open"
            | "experiment-save"
            | "publish-directory"
            | "generate"
            | "tuning-run"
            | "tuning-load"
            | "conformal-calibrate"
            | "conformal-predict"
            | "conformal-load"
            | "conformal-metrics"
            | "robustness"
    ) {
        return Err(format!("unknown archive command: {command}").into());
    }
    let allowed: &[&str] = match command.as_str() {
        "dataset-normalize"
        | "dataset-u07-sources"
        | "dataset-content"
        | "dataset-compatible-schemas" => &["input", "output"],
        "multimodal-replay-inputs" => &["archive", "input", "output", "workdir"],
        "experiment-open" => &["input", "output"],
        "experiment-save" => &["input", "destination", "archive", "output"],
        "publish-directory" => &["input", "destination", "output"],
        "workflow-load" | "training-result-view" => &["archive", "output"],
        "generate" | "conformal-metrics" => &["input", "output"],
        "robustness" => &["input", "archive", "methods-library", "run-id", "output"],
        "conformal-load" | "tuning-load" => &["archive", "output"],
        "tuning-run" => &[
            "input",
            "source-id",
            "trials",
            "seed",
            "sampler",
            "metric",
            "methods-library",
            "checkpoint-archive",
            "archive",
            "run-id",
            "output",
            "results-directory",
        ],
        "conformal-calibrate" => &[
            "input",
            "archive",
            "destination",
            "source-id",
            "methods-library",
            "run-id",
            "coverages",
            "small-sample-policy",
            "output",
        ],
        "pipeline-export" | "native-multimodal-export" => &["input", "output", "destination"],
        "native-multimodal-run"
        | "native-multimodal-load"
        | "native-multimodal-predict"
        | "native-multimodal-retrain" => &["input", "output", "methods-library", "run-id"],
        "pipeline-run" | "pipeline-load" | "pipeline-predict" | "pipeline-retrain" => {
            &["input", "output", "source-id", "methods-library", "run-id"]
        }
        "workflow-run" => &[
            "input",
            "source-id",
            "components",
            "preprocessing",
            "methods-library",
            "archive",
            "run-id",
            "output",
            "results-directory",
        ],
        "workflow-predict" | "conformal-predict" => &[
            "input",
            "archive",
            "methods-library",
            "methods-library-sha256",
            "run-id",
            "output",
        ],
        "inspect" => &["archive", "output"],
        "read-member" => &["archive", "member", "output", "expected-archive-sha256"],
        "replay-methods" => &[
            "archive",
            "expected-archive-sha256",
            "request",
            "envelopes",
            "methods-inputs",
            "methods-library",
            "methods-library-sha256",
            "output",
            "outcome-id",
            "run-id",
        ],
        _ => &[
            "archive",
            "expected-archive-sha256",
            "dag-cli",
            "request",
            "envelopes",
            "trusted-controllers",
            "adapter",
            "output",
            "outcome-id",
            "run-id",
            "process-timeout-ms",
        ],
    };
    let mut values = BTreeMap::new();
    while let Some(key) = args.next() {
        let key = key
            .into_string()
            .map_err(|_| "option names must be UTF-8")?;
        let key = key.strip_prefix("--").ok_or("expected a named --option")?;
        if !allowed.contains(&key) {
            return Err(format!("unsupported {command} option: --{key}").into());
        }
        let value = args
            .next()
            .ok_or_else(|| format!("missing value for --{key}"))?;
        if value.is_empty() || values.insert(key.to_owned(), value).is_some() {
            return Err(format!("empty or duplicate --{key}").into());
        }
    }
    Ok((command, values))
}

fn required<'a>(values: &'a BTreeMap<String, OsString>, key: &str) -> Result<&'a OsString> {
    values
        .get(key)
        .ok_or_else(|| format!("missing --{key}").into())
}

fn validated_view(archive: &LoadedArchive) -> Result<Value> {
    Ok(match archive {
        LoadedArchive::V1(archive) => serde_json::to_value(archive_view(archive)?)?,
        LoadedArchive::V2(archive) => serde_json::to_value(archive_v2_view(archive)?)?,
        LoadedArchive::V3(archive) => serde_json::to_value(archive_v3_view(archive)?)?,
    })
}

fn ensure_archive_identity(view: &Value, expected: &OsString) -> Result<()> {
    let expected = expected.to_str().ok_or("archive SHA must be UTF-8")?;
    if expected.len() != 64
        || !expected
            .bytes()
            .all(|value| value.is_ascii_hexdigit() && !value.is_ascii_uppercase())
        || view.get("archive_sha256").and_then(Value::as_str) != Some(expected)
    {
        return Err("archive bytes changed or expected archive SHA is invalid".into());
    }
    Ok(())
}

fn write_new(path: &Path, bytes: &[u8]) -> Result<()> {
    let mut output = OpenOptions::new().write(true).create_new(true).open(path)?;
    if let Err(error) = output.write_all(bytes).and_then(|()| output.flush()) {
        drop(output);
        let _ = std::fs::remove_file(path);
        return Err(error.into());
    }
    Ok(())
}

fn new_destination(path: &Path) -> Result<PathBuf> {
    match std::fs::symlink_metadata(path) {
        Ok(_) => return Err(format!("training output already exists: {}", path.display()).into()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => (),
        Err(error) => return Err(error.into()),
    }
    let parent = path
        .parent()
        .filter(|path| !path.as_os_str().is_empty())
        .unwrap_or(Path::new("."));
    let parent = std::fs::canonicalize(parent)?;
    let filename = path
        .file_name()
        .ok_or("training destination must name a new file or directory")?;
    // Probe writability before native training. The temporary file is removed
    // without reserving or publishing any caller destination.
    tempfile::NamedTempFile::new_in(&parent)?.close()?;
    Ok(parent.join(filename))
}

struct TrainingDestinations {
    archive: PathBuf,
    results: Option<PathBuf>,
}

fn training_destinations(values: &BTreeMap<String, OsString>) -> Result<TrainingDestinations> {
    let archive = new_destination(Path::new(required(values, "archive")?))?;
    let results = values
        .get("results-directory")
        .map(|path| new_destination(Path::new(path)))
        .transpose()?;
    let output = values
        .get("output")
        .map(|path| new_destination(Path::new(path)))
        .transpose()?;
    let paths = std::iter::once(&archive)
        .chain(results.iter())
        .chain(output.iter())
        .collect::<Vec<_>>();
    for (index, path) in paths.iter().enumerate() {
        for other in paths.iter().skip(index + 1) {
            if path.starts_with(other) || other.starts_with(path) {
                return Err("training destinations overlap or refer to the same path".into());
            }
        }
    }
    Ok(TrainingDestinations { archive, results })
}

struct PublishedPathIdentity {
    #[cfg(unix)]
    handle: File,
}

impl PublishedPathIdentity {
    fn capture(path: &Path) -> Result<Self> {
        #[cfg(unix)]
        {
            Ok(Self {
                handle: File::open(path)?,
            })
        }
        #[cfg(not(unix))]
        {
            let _ = path;
            Ok(Self {})
        }
    }

    fn matches(&self, path: &Path) -> bool {
        #[cfg(unix)]
        {
            use std::os::unix::fs::MetadataExt;
            let Ok(expected) = self.handle.metadata() else {
                return false;
            };
            let Ok(current) = std::fs::symlink_metadata(path) else {
                return false;
            };
            // Retaining the handle prevents reuse of a removed inode. Never
            // follow a replacement symlink, even when it points to our bytes.
            !current.file_type().is_symlink()
                && expected.dev() == current.dev()
                && expected.ino() == current.ino()
        }
        #[cfg(not(unix))]
        {
            // Stable std exposes no portable strong filesystem identity.
            // Preserve outputs on rollback rather than guess with timestamps
            // or delete another writer's replacement, including identical bytes.
            let _ = path;
            false
        }
    }
}

struct PublishedTrainingPath {
    path: PathBuf,
    directory: bool,
    identity: PublishedPathIdentity,
}

impl PublishedTrainingPath {
    fn staged(source: &Path, destination: &Path) -> Result<Self> {
        let kind = std::fs::symlink_metadata(source)?.file_type();
        if !kind.is_file() && !kind.is_dir() {
            return Err("training stage must contain only regular files and directories".into());
        }
        let identity = PublishedPathIdentity::capture(source)?;
        #[cfg(unix)]
        if !identity.matches(source) {
            return Err("training stage changed while recording publication identity".into());
        }
        Ok(Self {
            path: destination.to_owned(),
            directory: kind.is_dir(),
            identity,
        })
    }
}

fn staged_training_inventory(
    source: &Path,
    destination: &Path,
) -> Result<Vec<PublishedTrainingPath>> {
    let root = PublishedTrainingPath::staged(source, destination)?;
    let mut inventory = Vec::new();
    if root.directory {
        for entry in std::fs::read_dir(source)? {
            let entry = entry?;
            inventory.extend(staged_training_inventory(
                &entry.path(),
                &destination.join(entry.file_name()),
            )?);
        }
    }
    // Parent-first ordering lets rollback remove children before their empty
    // directories, without enumerating or claiming any later foreign member.
    inventory.insert(0, root);
    Ok(inventory)
}

#[derive(Default)]
struct PublishedTrainingOutputs {
    owned: Vec<PublishedTrainingPath>,
    committed: bool,
}

impl PublishedTrainingOutputs {
    fn publish(
        archive_stage: &Path,
        results_stage: Option<&Path>,
        destinations: &TrainingDestinations,
    ) -> Result<Self> {
        let mut published = Self::default();
        let archive = PublishedTrainingPath::staged(archive_stage, &destinations.archive)?;
        let results = match (results_stage, destinations.results.as_ref()) {
            (Some(stage), Some(target)) => staged_training_inventory(stage, target)?,
            _ => Vec::new(),
        };
        // The stage is in the destination parent: an exclusive hard link
        // publishes complete bytes and never replaces another invocation.
        std::fs::hard_link(archive_stage, &destinations.archive)?;
        published.owned.push(archive);
        if let (Some(stage), Some(target)) = (results_stage, destinations.results.as_ref()) {
            crate::publish_directory_noreplace(stage, target)?;
            published.owned.extend(results);
        }
        Ok(published)
    }
}

impl Drop for PublishedTrainingOutputs {
    fn drop(&mut self) {
        if !self.committed {
            for entry in self.owned.iter().rev() {
                let parents_unchanged = self
                    .owned
                    .iter()
                    .filter(|parent| {
                        parent.directory
                            && entry.path != parent.path
                            && entry.path.starts_with(&parent.path)
                    })
                    .all(|parent| parent.identity.matches(&parent.path));
                if !parents_unchanged || !entry.identity.matches(&entry.path) {
                    continue;
                }
                if entry.directory {
                    // A foreign member keeps this directory nonempty and safe.
                    let _ = std::fs::remove_dir(&entry.path);
                } else {
                    let _ = std::fs::remove_file(&entry.path);
                }
            }
        }
    }
}

fn staged_results(
    training: &dag_ml_core::TrainingOutcome,
    dataset: &crate::DatasetPackage,
    source_id: &str,
    destination: Option<&Path>,
) -> Result<Option<(tempfile::TempDir, PathBuf)>> {
    destination
        .map(|target| {
            let temporary = tempfile::tempdir_in(target.parent().ok_or("missing results parent")?)?;
            let stage = temporary.path().join("results");
            crate::results::write_training_results(training, dataset, source_id, &stage)?;
            Ok((temporary, stage))
        })
        .transpose()
}

fn read_json_transport(path: &Path) -> Result<String> {
    let mut bytes = Vec::new();
    File::open(path)?
        .take(MAX_JSON_TRANSPORT_BYTES + 1)
        .read_to_end(&mut bytes)?;
    if bytes.len() as u64 > MAX_JSON_TRANSPORT_BYTES {
        return Err("native JSON transport exceeds the Core member budget".into());
    }
    Ok(String::from_utf8(bytes)?)
}

fn replay_methods(
    archive: &LoadedArchive,
    view: &Value,
    values: &BTreeMap<String, OsString>,
) -> Result<()> {
    if matches!(archive, LoadedArchive::V1(_)) {
        return Err("native Methods replay requires Core Archive V2 or V3".into());
    }
    // The public JSON replay API reopens a path. Pin that path to the original
    // validated bytes in a private temporary directory, so a concurrently
    // replaced user file cannot bypass the archive identity anchor.
    let temporary = tempfile::tempdir()?;
    let snapshot_path = temporary.path().join("original.n4a");
    let mut source = File::open(Path::new(required(values, "archive")?))?;
    let mut output = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&snapshot_path)?;
    let mut hasher = Sha256::new();
    let mut total = 0_u64;
    let mut buffer = [0_u8; 65_536];
    loop {
        let count = source.read(&mut buffer)?;
        if count == 0 {
            break;
        }
        total += count as u64;
        if total > MAX_ARCHIVE_TRANSPORT_BYTES {
            return Err("archive transport exceeds Core physical budget".into());
        }
        hasher.update(&buffer[..count]);
        output.write_all(&buffer[..count])?;
    }
    output.flush()?;
    drop(output);
    let snapshot_sha = format!("{:x}", hasher.finalize());
    if view.get("archive_sha256").and_then(Value::as_str) != Some(snapshot_sha.as_str()) {
        return Err("archive bytes changed before native Methods replay".into());
    }
    let library = Path::new(required(values, "methods-library")?).to_path_buf();
    let library_sha = required(values, "methods-library-sha256")?
        .to_str()
        .ok_or("Methods library SHA must be UTF-8")?;
    // This existing native preflight pins an exact private library snapshot and
    // checks the Methods ABI. No model state or fit is created by this bridge.
    preflight_methods_archive_v2_library(&library, library_sha)?;
    let input = MethodsArchiveReplayJsonRequest {
        request_json: read_json_transport(Path::new(required(values, "request")?))?,
        data_envelopes_json: read_json_transport(Path::new(required(values, "envelopes")?))?,
        methods_inputs_json: read_json_transport(Path::new(required(values, "methods-inputs")?))?,
        methods_library_path: library,
        outcome_id: required(values, "outcome-id")?
            .to_str()
            .ok_or("outcome ID must be UTF-8")?
            .to_owned(),
        run_id: required(values, "run-id")?
            .to_str()
            .ok_or("run ID must be UTF-8")?
            .to_owned(),
        warnings_json: "[]".to_owned(),
        diagnostics_json: "{}".to_owned(),
    };
    let outcome = match archive {
        LoadedArchive::V2(_) => replay_methods_archive_v2_json(&snapshot_path, input)?,
        LoadedArchive::V3(_) => replay_methods_archive_v3_json(&snapshot_path, input)?,
        LoadedArchive::V1(_) => unreachable!("V1 refused before opening any runtime"),
    };
    write_new(Path::new(required(values, "output")?), outcome.as_bytes())
}

fn execute(command: &str, values: &BTreeMap<String, OsString>) -> Result<()> {
    if command == "publish-directory" {
        let source = Path::new(required(values, "input")?);
        let target = Path::new(required(values, "destination")?);
        // Finish the transport response before making the export visible.
        emit_json(values, &json!({"published": target}))?;
        crate::publish_directory_noreplace(source, target)?;
        return Ok(());
    }
    if command == "training-result-view" {
        return training_result_view(values);
    }
    if command == "dataset-content" || command == "dataset-compatible-schemas" {
        let input: Value =
            serde_json::from_str(&read_json_transport(Path::new(required(values, "input")?))?)?;
        if command == "dataset-content" {
            let bytes = nirs4all_io_crate::core::public_dataset::dataset_content_bytes(&input)?;
            let fingerprint = format!("{:x}", Sha256::digest(&bytes));
            return emit_json(
                values,
                &json!({"canonical_content_utf8": String::from_utf8(bytes)?, "fingerprint": fingerprint}),
            );
        }
        let saved = nirs4all_io_crate::core::public_dataset::compatible_source_schemas(
            &input["current"],
            &input["saved"],
        )?;
        return emit_json(values, &saved);
    }
    if command == "multimodal-replay-inputs" {
        return multimodal_replay_inputs(values);
    }
    if command == "robustness" {
        return robustness(values);
    }
    if command == "generate" {
        let input = read_json_transport(Path::new(required(values, "input")?))?;
        let result = crate::generation::generate_variants_json(&input)?;
        let variants: Value = serde_json::from_str(&result)?;
        let seeds: Vec<String> = variants
            .as_array()
            .ok_or("native generator variants must be an array")?
            .iter()
            .map(|variant| {
                variant["seed"]
                    .as_u64()
                    .map(|seed| seed.to_string())
                    .ok_or("native generator variant lacks its u64 seed")
            })
            .collect::<std::result::Result<_, _>>()?;
        return emit_json(
            values,
            &json!({"schema": "nirs4all.generation.v1", "variants": variants, "seed_decimals": seeds}),
        );
    }
    if command == "tuning-run" {
        return tuning_run(values);
    }
    if command == "tuning-load" {
        return tuning_load(values);
    }
    if command == "conformal-calibrate" {
        return conformal_calibrate(values);
    }
    if command == "conformal-predict" {
        return workflow_predict(values, true);
    }
    if command == "conformal-load" {
        let archive = load_archive_v2(Path::new(required(values, "archive")?))?;
        let package = dag_ml_core::PortablePredictorPackage::from_json(std::str::from_utf8(
            archive.portable_predictor_package()?,
        )?)?;
        dag_ml_core::validate_archive_v2_portable_payloads(
            archive.manifest(),
            &package,
            archive.members(),
        )?;
        let calibration = package
            .conformal_calibration
            .ok_or("archive has no calibrator")?;
        return emit_json(
            values,
            &json!({"schema": "nirs4all.calibrated.v1", "calibration": calibration}),
        );
    }
    if command == "conformal-metrics" {
        let input: Value =
            serde_json::from_str(&read_json_transport(Path::new(required(values, "input")?))?)?;
        let calibration = if let Some(raw) = input.get("calibration_json") {
            if input.get("calibration").is_some() {
                return Err("ambiguous calibration transport".into());
            }
            let envelope: Value =
                serde_json::from_str(raw.as_str().ok_or("calibration_json must be a string")?)?;
            envelope["calibration"].clone()
        } else {
            input["calibration"].clone()
        };
        let intervals = if let Some(raw) = input.get("prediction_json") {
            if input.get("intervals").is_some() {
                return Err("ambiguous interval transport".into());
            }
            let prediction: Value =
                serde_json::from_str(raw.as_str().ok_or("prediction_json must be a string")?)?;
            prediction["interval_block"].clone()
        } else {
            input["intervals"].clone()
        };
        let result = crate::conformal_json::conformal_metrics_json(
            &serde_json::to_string(&calibration)?,
            &serde_json::to_string(&intervals)?,
            &serde_json::to_string(&input["truth"])?,
        )?;
        return emit_json(values, &serde_json::from_str(&result)?);
    }
    if command == "workflow-load" {
        return workflow_load(values);
    }
    if command == "experiment-save" {
        let experiment = crate::results::save_experiment_results(
            Path::new(required(values, "input")?),
            Path::new(required(values, "destination")?),
            values.get("archive").map(Path::new),
        )
        .map_err(|error| format!("experiment publication refused: {error}"))?;
        return emit_json(values, &serde_json::to_value(experiment.native)?);
    }
    if command == "experiment-open" {
        let experiment =
            crate::results::open_experiment_results(Path::new(required(values, "input")?))
                .map_err(|error| format!("experiment validation refused: {error}"))?;
        return emit_json(values, &serde_json::to_value(experiment.native)?);
    }
    if command.starts_with("pipeline-") || command.starts_with("native-multimodal-") {
        let record: Value =
            serde_json::from_str(&read_json_transport(Path::new(required(values, "input")?))?)?;
        let result = match command {
            "pipeline-retrain" | "native-multimodal-retrain" => {
                if record.as_object().is_none_or(|fields| {
                    fields.len() != 2
                        || !fields.contains_key("model")
                        || !fields.contains_key("dataset")
                }) {
                    return Err("native retrain requires exactly model and dataset".into());
                }
                let model = &record["model"];
                let library = Path::new(required(values, "methods-library")?);
                let run_id = text_option(values, "run-id")?;
                if command == "pipeline-retrain" {
                    crate::pipeline_workflow::validate_pipeline(model)?;
                    crate::pipeline_workflow::run_pipeline(
                        &json!({"dataset":record["dataset"], "pipeline":model["config"]["pipeline"]}),
                        model["config"]["source_id"]
                            .as_str()
                            .ok_or("Invalid native source ID")?,
                        library,
                        run_id,
                    )?
                } else {
                    crate::multimodal_workflow::validate_multimodal(model)?;
                    crate::multimodal_workflow::run_multimodal(
                        &json!({"dataset":record["dataset"], "pipeline":model["config"]["pipeline"],
                            "source_policies":model["config"]["source_policies"]}),
                        library,
                        run_id,
                    )?
                }
            }
            "native-multimodal-run" => crate::multimodal_workflow::run_multimodal(
                &record,
                Path::new(required(values, "methods-library")?),
                text_option(values, "run-id")?,
            )?,
            "native-multimodal-predict" => crate::multimodal_workflow::predict_multimodal(
                &record,
                Path::new(required(values, "methods-library")?),
                text_option(values, "run-id")?,
            )?,
            "native-multimodal-load" => {
                crate::multimodal_workflow::validate_multimodal(&record)?;
                record
            }
            "pipeline-run" => crate::pipeline_workflow::run_pipeline(
                &record,
                text_option(values, "source-id")?,
                Path::new(required(values, "methods-library")?),
                text_option(values, "run-id")?,
            )?,
            "pipeline-load" => {
                crate::pipeline_workflow::validate_pipeline(&record)?;
                record
            }
            "pipeline-export" | "native-multimodal-export" => {
                if command == "pipeline-export" {
                    crate::pipeline_workflow::validate_pipeline(&record)?;
                } else {
                    crate::multimodal_workflow::validate_multimodal(&record)?;
                }
                let path = Path::new(required(values, "destination")?);
                let parent = path
                    .parent()
                    .filter(|p| !p.as_os_str().is_empty())
                    .unwrap_or_else(|| Path::new("."));
                let mut file = tempfile::NamedTempFile::new_in(parent)?;
                serde_json::to_writer(file.as_file_mut(), &record)?;
                file.as_file_mut().sync_all()?;
                file.persist_noclobber(path)?;
                json!({"path":path})
            }
            "pipeline-predict" => crate::pipeline_workflow::predict_pipeline(
                &record,
                Path::new(required(values, "methods-library")?),
                text_option(values, "run-id")?,
            )?,
            _ => unreachable!(),
        };
        return emit_json(values, &result);
    }
    if command == "workflow-run" {
        return workflow_run(values);
    }
    if command == "workflow-predict" {
        return workflow_predict(values, false);
    }
    if matches!(command, "dataset-normalize" | "dataset-u07-sources") {
        let input = read_json_transport(Path::new(required(values, "input")?))?;
        let raw: Value = serde_json::from_str(&input)?;
        let normalized = if command == "dataset-normalize" {
            nirs4all_io_crate::core::public_dataset::normalize_dataset(&raw)
        } else {
            nirs4all_io_crate::core::public_dataset::u07_sources(&raw)
        }
        .map_err(|error| format!("IO dataset validation refused: {error}"))?;
        let output = serde_json::to_vec_pretty(&normalized)?;
        if let Some(path) = values.get("output") {
            write_new(Path::new(path), &output)?;
        } else {
            std::io::stdout().write_all(&output)?;
        }
        return Ok(());
    }
    // Container dispatch, size limits, closure and raw hashes are validated by
    // the owning Core loader before any host process or member output exists.
    let archive = load_archive(Path::new(required(values, "archive")?))?;
    let view = validated_view(&archive)?;
    if command == "inspect" {
        let manifest = match &archive {
            LoadedArchive::V1(archive) => archive.manifest(),
            LoadedArchive::V2(archive) => archive.manifest(),
            LoadedArchive::V3(archive) => archive.manifest(),
        };
        let output = serde_json::to_vec_pretty(&json!({
            "schema_version": 1, "archive": view, "manifest": manifest,
        }))?;
        if let Some(path) = values.get("output") {
            write_new(Path::new(path), &output)?;
        } else {
            std::io::stdout().write_all(&output)?;
        }
        return Ok(());
    }
    ensure_archive_identity(&view, required(values, "expected-archive-sha256")?)?;
    if command == "replay-methods" {
        return replay_methods(&archive, &view, values);
    }
    if command == "read-member" {
        let member = required(values, "member")?
            .to_str()
            .ok_or("member path must be UTF-8")?;
        let bytes = match &archive {
            LoadedArchive::V1(_) => return Err("member transport requires Archive V2 or V3".into()),
            LoadedArchive::V2(archive) => archive.member(member)?,
            LoadedArchive::V3(archive) => archive.member(member)?,
        };
        return write_new(Path::new(required(values, "output")?), bytes);
    }
    let (native_command, package) = match &archive {
        LoadedArchive::V1(_) => {
            return Err("native process replay requires Archive V2 or V3".into())
        }
        LoadedArchive::V2(archive) => (
            "run-process-loaded-predictor-replay",
            archive.portable_predictor_package()?,
        ),
        LoadedArchive::V3(archive) => (
            "run-process-loaded-refit-replay",
            archive.portable_refit_package()?,
        ),
    };
    // These are transport files, not an alternate persisted package: preserve
    // the exact signed bytes, and remove them on success and on every refusal.
    let temporary = tempfile::tempdir()?;
    let package_path = temporary.path().join("package.json");
    write_new(&package_path, package)?;
    let mut process = Command::new(required(values, "dag-cli")?);
    process
        .arg(native_command)
        .arg("--package")
        .arg(&package_path);
    for key in [
        "request",
        "envelopes",
        "trusted-controllers",
        "adapter",
        "output",
        "outcome-id",
        "run-id",
    ] {
        process.arg(format!("--{key}")).arg(required(values, key)?);
    }
    if let Some(timeout) = values.get("process-timeout-ms") {
        process.arg("--process-timeout-ms").arg(timeout);
    }
    let status = process.status()?;
    if !status.success() {
        return Err(format!("native DAG-ML replay refused: {status}").into());
    }
    Ok(())
}

fn text_option<'a>(values: &'a BTreeMap<String, OsString>, key: &str) -> Result<&'a str> {
    required(values, key)?
        .to_str()
        .ok_or_else(|| format!("--{key} must be UTF-8").into())
}

fn emit_json(values: &BTreeMap<String, OsString>, value: &Value) -> Result<()> {
    let output = serde_json::to_vec_pretty(value)?;
    if let Some(path) = values.get("output") {
        write_new(Path::new(path), &output)
    } else {
        std::io::stdout().write_all(&output)?;
        Ok(())
    }
}

fn multimodal_replay_inputs(values: &BTreeMap<String, OsString>) -> Result<()> {
    let archive = load_archive_v2(Path::new(required(values, "archive")?))?;
    let package = dag_ml_core::PortablePredictorPackage::from_json(std::str::from_utf8(
        archive.portable_predictor_package()?,
    )?)?;
    dag_ml_core::validate_archive_v2_portable_payloads(
        archive.manifest(),
        &package,
        archive.members(),
    )?;
    let input: Value =
        serde_json::from_str(&read_json_transport(Path::new(required(values, "input")?))?)?;
    let mut current = nirs4all_io_crate::core::public_dataset::multimodal_runtime_input(&input)
        .map_err(|error| format!("IO raw cohort validation refused: {error}"))?;
    let package_value = serde_json::to_value(&package)?;
    let saved = package_value
        .pointer("/effective_plan/graph_plan/graph/nodes/0/operator/source_schemas")
        .ok_or("multimodal archive has no fitted source schemas")?;
    // IO owns logical schema compatibility. Preserve the exact fitted native
    // descriptors after validation, including archives made by older hosts.
    current["source_schemas"] = nirs4all_io_crate::core::public_dataset::compatible_source_schemas(
        &current["source_schemas"],
        saved,
    )
    .map_err(|error| format!("IO source schema compatibility refused: {error}"))?;
    let mut prepared =
        dag_ml_core::multimodal_replay_inputs::prepare_multimodal_replay(&package, &current)?;
    let view = serde_json::to_value(archive_v2_view(&archive)?)?;
    prepared["archive_sha256"] = view["archive_sha256"].clone();
    if let Some(path) = values.get("workdir") {
        let path = Path::new(path);
        // A fresh directory preserves every native contract as exact JSON.
        std::fs::create_dir(path)?;
        let directory = std::fs::canonicalize(path)?;
        prepared["config"]["audit_path"] = json!(directory.join("lifecycle.jsonl"));
        for (key, filename) in [
            ("request", "request.json"),
            ("envelopes", "envelopes.json"),
            ("trusted_controllers", "trusted-controllers.json"),
            ("config", "config.json"),
        ] {
            write_new(
                &directory.join(filename),
                &serde_json::to_vec_pretty(&prepared[key])?,
            )?;
        }
    }
    emit_json(values, &prepared)
}

fn workflow_load(values: &BTreeMap<String, OsString>) -> Result<()> {
    let path = Path::new(required(values, "archive")?);
    let archive = load_archive_v2(path)?;
    let view = serde_json::to_value(archive_v2_view(&archive)?)?;
    let package = dag_ml_core::PortablePredictorPackage::from_json(std::str::from_utf8(
        archive.portable_predictor_package()?,
    )?)?;
    dag_ml_core::validate_archive_v2_portable_payloads(
        archive.manifest(),
        &package,
        archive.members(),
    )?;
    let outcome = dag_ml_core::TrainingOutcome::from_json(std::str::from_utf8(
        archive.member("dagml/training_outcome.json")?,
    )?)?;
    if outcome.outcome_fingerprint != package.training_outcome.outcome_fingerprint {
        return Err("workflow outcome and signed package disagree".into());
    }
    let config = crate::dense_regression_workflow_config(&package)?;
    emit_json(
        values,
        &json!({
            "schema": "nirs4all.workflow.v1", "run_id": outcome.run_id,
            "winner_variant_id": outcome.selected_variant_id, "training_outcome": outcome,
            "model_archive": std::fs::canonicalize(path)?,
            "archive_id": view["archive_id"], "archive_sha256": view["archive_sha256"],
            "config": config, "numeric_storage": "float32",
        }),
    )
}

fn training_result_view(values: &BTreeMap<String, OsString>) -> Result<()> {
    let path = Path::new(required(values, "archive")?);
    let archive = load_archive_v2(path)?;
    let package = dag_ml_core::PortablePredictorPackage::from_json(std::str::from_utf8(
        archive.portable_predictor_package()?,
    )?)?;
    dag_ml_core::validate_archive_v2_portable_payloads(
        archive.manifest(),
        &package,
        archive.members(),
    )?;
    let outcome = dag_ml_core::TrainingOutcome::from_json(std::str::from_utf8(
        archive.member("dagml/training_outcome.json")?,
    )?)?;
    if outcome.outcome_fingerprint != package.training_outcome.outcome_fingerprint {
        return Err("native result outcome differs from the archived predictor".into());
    }
    let predictions = crate::result_projection::project_training_predictions(
        &outcome,
        outcome.effective_plan.id.as_str(),
        "regression",
    )?;
    emit_json(
        values,
        &json!({
            "schema": "nirs4all.result-view.v1", "run_id": outcome.run_id,
            "training_outcome_fingerprint": outcome.outcome_fingerprint,
            "winner_variant_id": outcome.selected_variant_id, "score_set": outcome.score_set,
            "predictions": predictions, "model_archive": std::fs::canonicalize(path)?,
            "validation_level": "native_model_projection", "label_provenance": "transport_only",
        }),
    )
}

fn workflow_run(values: &BTreeMap<String, OsString>) -> Result<()> {
    let destinations = training_destinations(values)?;
    let archive_temporary = tempfile::tempdir_in(
        destinations
            .archive
            .parent()
            .ok_or("missing archive parent")?,
    )?;
    let archive_stage = archive_temporary.path().join("model.n4a");
    let record: Value =
        serde_json::from_str(&read_json_transport(Path::new(required(values, "input")?))?)?;
    let source_id = text_option(values, "source-id")?;
    let components: Vec<u32> = serde_json::from_str(text_option(values, "components")?)?;
    let preprocessing_name = values
        .get("preprocessing")
        .map(|value| value.to_str().ok_or("preprocessing must be UTF-8"))
        .transpose()?
        .unwrap_or("snv_savgol");
    let preprocessing = match preprocessing_name {
        "raw" => DenseRegressionPreprocessing::Raw,
        "snv_savgol" => DenseRegressionPreprocessing::SnvSavitzkyGolay,
        _ => return Err("workflow preprocessing must be raw or snv_savgol".into()),
    };
    let dataset =
        nirs4all_io_crate::core::public_dataset::dense_dataset_package(&record, source_id)
            .map_err(|error| format!("IO dataset validation refused: {error}"))?;
    let library = std::fs::canonicalize(Path::new(required(values, "methods-library")?))?;
    let outcome = run_dense_regression_workflow(DenseRegressionWorkflowRequest {
        dataset: &dataset,
        source_id,
        components: &components,
        preprocessing,
        methods_library_path: &library,
        archive_path: &archive_stage,
        run_id: text_option(values, "run-id")?,
    })
    .map_err(|error| format!("native workflow refused: {error}"))?;
    let config = json!({"source_id": source_id, "components": components, "preprocessing": preprocessing_name});
    let results = staged_results(
        &outcome.training,
        &dataset,
        source_id,
        destinations.results.as_deref(),
    )?;
    let mut published = PublishedTrainingOutputs::publish(
        &archive_stage,
        results.as_ref().map(|(_, path)| path.as_path()),
        &destinations,
    )?;
    emit_json(
        values,
        &json!({
            "schema": "nirs4all.workflow.v1", "run_id": outcome.training.run_id,
            "winner_variant_id": outcome.training.selected_variant_id, "training_outcome": outcome.training,
            "model_archive": destinations.archive, "archive_id": outcome.archive.archive_id(),
            "archive_sha256": outcome.archive.archive_sha256(), "native_results_dir": destinations.results,
            "config": config,
            "numeric_storage": "float32",
        }),
    )?;
    published.committed = true;
    Ok(())
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct WorkflowPredictInput {
    sample_ids: Vec<String>,
    x: Vec<Vec<f64>>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct UncertaintyDatasetInput {
    dataset: Value,
    source_id: Option<String>,
}

#[derive(Deserialize)]
#[serde(untagged)]
enum ConformalPredictInput {
    Dataset(UncertaintyDatasetInput),
    Positional(WorkflowPredictInput),
}

fn workflow_predict(values: &BTreeMap<String, OsString>, conformal: bool) -> Result<()> {
    let input_json = read_json_transport(Path::new(required(values, "input")?))?;
    let archive = load_archive_v2(Path::new(required(values, "archive")?))?;
    let (input, diagnostics) = if conformal {
        let input: ConformalPredictInput = serde_json::from_str(&input_json)?;
        let cohort = match &input {
            ConformalPredictInput::Dataset(input) => {
                crate::conformal::UncertaintyCohortInput::Dataset {
                    record: &input.dataset,
                    source_id: input.source_id.as_deref(),
                }
            }
            ConformalPredictInput::Positional(input) => {
                crate::conformal::UncertaintyCohortInput::Positional {
                    x: &input.x,
                    sample_ids: &input.sample_ids,
                }
            }
        };
        let resolved = crate::conformal::resolve_uncertainty_cohort(&archive, cohort)?;
        (
            WorkflowPredictInput {
                sample_ids: resolved.sample_ids,
                x: resolved.x,
            },
            resolved.diagnostics,
        )
    } else {
        (
            serde_json::from_str::<WorkflowPredictInput>(&input_json)?,
            BTreeMap::new(),
        )
    };
    let package = dag_ml_core::PortablePredictorPackage::from_json(std::str::from_utf8(
        archive.portable_predictor_package()?,
    )?)?;
    let [binding] = package.output_bindings.as_slice() else {
        return Err("workflow matrix prediction requires exactly one output binding".into());
    };
    let library = std::fs::canonicalize(Path::new(required(values, "methods-library")?))?;
    let mut source = File::open(&library)?.take(64 * 1024 * 1024 + 1);
    let mut bytes = Vec::new();
    source.read_to_end(&mut bytes)?;
    if bytes.len() > 64 * 1024 * 1024 {
        return Err("Methods library exceeds the native identity budget".into());
    }
    let actual = format!("{:x}", Sha256::digest(bytes));
    let hash = values
        .get("methods-library-sha256")
        .map(|value| value.to_str().ok_or("Methods hash must be UTF-8"))
        .transpose()?
        .unwrap_or(&actual)
        .to_owned();
    let run_id = text_option(values, "run-id")?;
    let request = MethodsArchiveMatrixPredictRequest {
        sample_ids: input.sample_ids,
        x: input.x,
        expected_target_names: binding.target_names.clone(),
        methods_library_path: library,
        methods_library_sha256: hash,
        request_id: format!("predict:{run_id}"),
        outcome_id: format!("outcome:{run_id}"),
        run_id: dag_ml_core::RunId::new(run_id)?,
        warnings: Vec::new(),
        diagnostics,
    };
    if conformal {
        if package.execution_bundle.methods_hpo_resume_state.is_some() {
            let presentation = crate::native_methods_replay::predict_tuning_archive_v2_calibrated(
                &archive, request,
            )?;
            return emit_json(values, &presentation);
        }
        let presentation =
            crate::predict_methods_archive_v2_matrix_conformal_presentation_v2(&archive, request)?;
        return emit_json(values, &serde_json::to_value(presentation)?);
    }
    let predicted = if package.execution_bundle.methods_hpo_resume_state.is_some() {
        crate::predict_tuning_archive_v2_matrix(&archive, request)?
    } else {
        predict_methods_archive_v2_matrix(&archive, request)?
    };
    emit_json(values, &serde_json::to_value(predicted)?)
}

fn conformal_calibrate(values: &BTreeMap<String, OsString>) -> Result<()> {
    let mut publication_values = values.clone();
    publication_values.insert("archive".into(), required(values, "destination")?.clone());
    let destinations = training_destinations(&publication_values)?;
    let temporary = tempfile::tempdir_in(
        destinations
            .archive
            .parent()
            .ok_or("missing calibration parent")?,
    )?;
    let archive_stage = temporary.path().join("calibrated.n4a");
    let record: Value =
        serde_json::from_str(&read_json_transport(Path::new(required(values, "input")?))?)?;
    let source_id = text_option(values, "source-id")?;
    let library = std::fs::canonicalize(Path::new(required(values, "methods-library")?))?;
    let mut result =
        crate::conformal::calibrate_archive(crate::conformal::CalibrateArchiveRequest {
            model_archive: Path::new(required(values, "archive")?),
            calibration_record: &record,
            source_id: Some(source_id),
            methods_library_path: &library,
            archive_path: &archive_stage,
            run_id: text_option(values, "run-id")?,
            coverages: serde_json::from_str(text_option(values, "coverages")?)?,
            small_sample_policy: serde_json::from_str(text_option(values, "small-sample-policy")?)?,
        })?;
    let mut published = PublishedTrainingOutputs::publish(&archive_stage, None, &destinations)?;
    result["model_archive"] = json!(destinations.archive);
    emit_json(values, &result)?;
    published.committed = true;
    Ok(())
}

fn tuning_run(values: &BTreeMap<String, OsString>) -> Result<()> {
    let destinations = training_destinations(values)?;
    let archive_temporary = tempfile::tempdir_in(
        destinations
            .archive
            .parent()
            .ok_or("missing archive parent")?,
    )?;
    let archive_stage = archive_temporary.path().join("model.n4a");
    let record: Value =
        serde_json::from_str(&read_json_transport(Path::new(required(values, "input")?))?)?;
    let source_id = text_option(values, "source-id")?;
    let dataset =
        nirs4all_io_crate::core::public_dataset::dense_dataset_package(&record, source_id)?;
    let library = std::fs::canonicalize(Path::new(required(values, "methods-library")?))?;
    let sampler: dag_ml_core::HpoSampler =
        serde_json::from_value(json!(text_option(values, "sampler")?))?;
    let metric = match text_option(values, "metric")? {
        "rmse" => dag_ml_core::RegressionMetricKind::Rmse,
        "mae" => dag_ml_core::RegressionMetricKind::Mae,
        "r2" => dag_ml_core::RegressionMetricKind::R2,
        _ => return Err("tuning metric must be rmse, mae or r2".into()),
    };
    let outcome = crate::tuning::run_dense_tuning(crate::tuning::DenseTuningRequest {
        dataset: &dataset,
        source_id,
        trials: text_option(values, "trials")?.parse()?,
        seed: text_option(values, "seed")?.parse()?,
        sampler,
        metric,
        methods_library_path: &library,
        checkpoint_archive: values.get("checkpoint-archive").map(Path::new),
        archive_path: &archive_stage,
        run_id: text_option(values, "run-id")?,
    })?;
    let results = staged_results(
        &outcome.training,
        &dataset,
        source_id,
        destinations.results.as_deref(),
    )?;
    let mut published = PublishedTrainingOutputs::publish(
        &archive_stage,
        results.as_ref().map(|(_, path)| path.as_path()),
        &destinations,
    )?;
    emit_json(
        values,
        &json!({"schema": "nirs4all.tuning.v1", "training_outcome": outcome.training,
        "model_archive": destinations.archive, "native_results_dir": destinations.results,
        "archive_sha256": outcome.archive.archive_sha256()}),
    )?;
    published.committed = true;
    Ok(())
}

fn tuning_load(values: &BTreeMap<String, OsString>) -> Result<()> {
    let path = Path::new(required(values, "archive")?);
    let archive = load_archive_v2(path)?;
    let package = dag_ml_core::PortablePredictorPackage::from_json(std::str::from_utf8(
        archive.portable_predictor_package()?,
    )?)?;
    dag_ml_core::validate_archive_v2_portable_payloads(
        archive.manifest(),
        &package,
        archive.members(),
    )?;
    if package.execution_bundle.methods_hpo_resume_state.is_none() {
        return Err("archive has no native tuning checkpoint".into());
    }
    let training = dag_ml_core::TrainingOutcome::from_json(std::str::from_utf8(
        archive.member("dagml/training_outcome.json")?,
    )?)?;
    if training.outcome_fingerprint != package.training_outcome.outcome_fingerprint {
        return Err("tuning archive outcome differs from its package".into());
    }
    let template = serde_json::to_value(&package.template)?;
    let descriptor = &template["campaign"]["metadata"]["methods_hpo_operation"];
    let source_id = template["campaign"]["data_bindings"]["model:pls"][0]["source_ids"][0]
        .as_str()
        .ok_or("missing native tuning source")?;
    if !descriptor.is_object() {
        return Err("missing native tuning descriptor".into());
    }
    let view = serde_json::to_value(archive_v2_view(&archive)?)?;
    emit_json(
        values,
        &json!({"schema": "nirs4all.tuning.v1", "training_outcome": training,
        "model_archive": std::fs::canonicalize(path)?, "archive_sha256": view["archive_sha256"],
        "config": {"source_id": source_id, "trials": descriptor["trials"],
            "seed": descriptor["study"]["optimizer"]["seed"],
            "sampler": descriptor["study"]["optimizer"]["sampler"],
            "metric": descriptor["study"]["optimizer"]["metric"]}}),
    )
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RobustnessInput {
    #[serde(default)]
    sample_ids: Vec<String>,
    #[serde(default)]
    x: Vec<Vec<f64>>,
    dataset: Option<Value>,
    source_id: Option<String>,
    truth: Vec<Vec<f64>>,
    scenarios: Vec<dag_ml_core::public_robustness::FrozenRobustnessScenario>,
}

fn robustness(values: &BTreeMap<String, OsString>) -> Result<()> {
    let input: RobustnessInput =
        serde_json::from_str(&read_json_transport(Path::new(required(values, "input")?))?)?;
    let library = std::fs::canonicalize(Path::new(required(values, "methods-library")?))?;
    let mut bytes = Vec::new();
    File::open(&library)?
        .take(64 * 1024 * 1024 + 1)
        .read_to_end(&mut bytes)?;
    if bytes.len() > 64 * 1024 * 1024 {
        return Err("Methods library exceeds identity budget".into());
    }
    let digest = format!("{:x}", Sha256::digest(bytes));
    let result =
        crate::robustness::robustness_archive(crate::robustness::FrozenRobustnessRequest {
            archive_path: Path::new(required(values, "archive")?),
            methods_library_path: &library,
            methods_library_sha256: &digest,
            sample_ids: input.sample_ids,
            x: input.x,
            dataset: input.dataset.as_ref(),
            source_id: input.source_id.as_deref(),
            truth: input.truth,
            scenarios: input.scenarios,
            run_id: text_option(values, "run-id")?,
        })?;
    emit_json(values, &result)
}

/// Execute the shared archive command transport from a CLI or host binding.
/// The arguments exclude the executable name and use the same strict parser.
pub fn execute_archive_command(args: impl IntoIterator<Item = OsString>) -> Result<()> {
    options(args).and_then(|(command, values)| execute(&command, &values))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn training_destinations_refuse_collisions_before_any_fit() {
        let directory = tempfile::tempdir().unwrap();
        let archive = directory.path().join("model.n4a");
        let mut args = BTreeMap::from([("archive".into(), archive.clone().into_os_string())]);
        args.insert(
            "output".into(),
            directory.path().join("./model.n4a").into_os_string(),
        );
        assert!(training_destinations(&args).is_err());
        args.remove("output");
        args.insert("results-directory".into(), archive.clone().into_os_string());
        assert!(training_destinations(&args).is_err());
        args.insert(
            "results-directory".into(),
            directory.path().join("missing/results").into_os_string(),
        );
        assert!(training_destinations(&args).is_err());
        args.remove("results-directory");
        std::fs::write(&archive, b"existing").unwrap();
        assert!(training_destinations(&args).is_err());
        assert_eq!(std::fs::read(&archive).unwrap(), b"existing");
    }

    #[test]
    #[cfg(unix)]
    fn raced_results_publication_rolls_back_only_own_archive() {
        let directory = tempfile::tempdir().unwrap();
        let archive = directory.path().join("model.n4a");
        let results = directory.path().join("results");
        let args = BTreeMap::from([
            ("archive".into(), archive.clone().into_os_string()),
            ("results-directory".into(), results.clone().into_os_string()),
        ]);
        let destinations = training_destinations(&args).unwrap();
        let stage = directory.path().join("stage.n4a");
        std::fs::write(&stage, b"complete archive").unwrap();
        let stage_results = directory.path().join("stage-results");
        std::fs::create_dir(&stage_results).unwrap();
        std::fs::write(stage_results.join("experiment.json"), b"verified").unwrap();
        // Another invocation reserves its target after our preflight.
        std::fs::create_dir(&results).unwrap();
        std::fs::write(results.join("owned-by-other"), b"preserve").unwrap();
        assert!(
            PublishedTrainingOutputs::publish(&stage, Some(&stage_results), &destinations).is_err()
        );
        assert!(!archive.exists());
        assert_eq!(
            std::fs::read(results.join("owned-by-other")).unwrap(),
            b"preserve"
        );
        assert!(stage_results.join("experiment.json").exists());
    }

    #[test]
    #[cfg(unix)]
    fn failed_emit_preserves_foreign_insertions_and_replacements_after_publication() {
        for change in [
            "insert",
            "replace-member",
            "replace-directory",
            "replace-archive",
        ] {
            let directory = tempfile::tempdir().unwrap();
            let archive = directory.path().join("model.n4a");
            let results = directory.path().join("results");
            let output = directory.path().join("output.json");
            let args = BTreeMap::from([
                ("archive".into(), archive.clone().into_os_string()),
                ("results-directory".into(), results.clone().into_os_string()),
                ("output".into(), output.clone().into_os_string()),
            ]);
            let destinations = training_destinations(&args).unwrap();
            let stage = directory.path().join("stage.n4a");
            let stage_results = directory.path().join("stage-results");
            std::fs::write(&stage, b"complete archive").unwrap();
            std::fs::create_dir(&stage_results).unwrap();
            std::fs::write(stage_results.join("manifest.json"), b"verified").unwrap();
            std::fs::create_dir(stage_results.join("nested")).unwrap();
            std::fs::write(stage_results.join("nested/owned"), b"owned bytes").unwrap();
            let published =
                PublishedTrainingOutputs::publish(&stage, Some(&stage_results), &destinations)
                    .unwrap();
            match change {
                "insert" => std::fs::write(results.join("foreign"), b"preserve").unwrap(),
                "replace-member" => {
                    std::fs::rename(
                        results.join("manifest.json"),
                        directory.path().join("original-manifest"),
                    )
                    .unwrap();
                    // Identical bytes defeat a content/size-only ownership test.
                    std::fs::write(results.join("manifest.json"), b"verified").unwrap();
                }
                "replace-directory" => {
                    std::fs::rename(&results, directory.path().join("original-results")).unwrap();
                    // Even a replacement empty directory belongs to its writer.
                    std::fs::create_dir(&results).unwrap();
                }
                "replace-archive" => {
                    std::fs::rename(&archive, directory.path().join("original-archive")).unwrap();
                    std::fs::write(&archive, b"complete archive").unwrap();
                }
                _ => unreachable!(),
            }
            // Inject a failure after publication, exactly at the final emit.
            std::fs::write(&output, b"foreign output").unwrap();
            assert!(emit_json(&args, &json!({"published": true})).is_err());
            drop(published);
            assert_eq!(std::fs::read(&output).unwrap(), b"foreign output");
            if change == "replace-archive" {
                assert_eq!(std::fs::read(&archive).unwrap(), b"complete archive");
                assert!(!results.exists());
            } else {
                assert!(!archive.exists());
                match change {
                    "insert" => {
                        assert_eq!(std::fs::read(results.join("foreign")).unwrap(), b"preserve");
                        assert!(!results.join("manifest.json").exists());
                        assert!(!results.join("nested").exists());
                    }
                    "replace-member" => {
                        assert_eq!(
                            std::fs::read(results.join("manifest.json")).unwrap(),
                            b"verified"
                        );
                        assert!(!results.join("nested").exists());
                    }
                    "replace-directory" => {
                        assert!(results.is_dir());
                        assert!(directory
                            .path()
                            .join("original-results/manifest.json")
                            .exists());
                    }
                    _ => unreachable!(),
                }
            }
            eprintln!("post-publication emit failure preserves foreign {change}");
        }
    }

    #[test]
    #[cfg(not(unix))]
    fn failed_emit_conservatively_preserves_published_paths_without_strong_identity() {
        let directory = tempfile::tempdir().unwrap();
        let archive = directory.path().join("model.n4a");
        let stage = directory.path().join("stage.n4a");
        std::fs::write(&stage, b"complete archive").unwrap();
        let published = PublishedTrainingOutputs::publish(
            &stage,
            None,
            &TrainingDestinations {
                archive: archive.clone(),
                results: None,
            },
        )
        .unwrap();
        drop(published);
        assert_eq!(std::fs::read(archive).unwrap(), b"complete archive");
    }

    #[test]
    fn strict_transport_options_do_not_accept_fit_or_arbitrary_passthrough() {
        for args in [
            vec!["replay-process", "--phase", "REFIT"],
            vec!["replay-methods", "--adapter", "borrowed-controller"],
            vec!["replay-methods", "--phase", "FIT_CV"],
            vec!["inspect", "--archive", "a", "--archive", "b"],
            vec!["read-member", "--output"],
            vec!["train"],
        ] {
            assert!(options(args.into_iter().map(OsString::from)).is_err());
        }
    }

    #[test]
    fn archive_identity_requires_exact_lowercase_raw_sha() {
        let sha = "a".repeat(64);
        let view = json!({"archive_sha256": sha});
        assert!(ensure_archive_identity(&view, &OsString::from("a".repeat(64))).is_ok());
        for value in ["A".repeat(64), "b".repeat(64), "a".repeat(63)] {
            assert!(ensure_archive_identity(&view, &OsString::from(value)).is_err());
        }
    }

    #[test]
    fn invalid_archive_is_refused_before_any_worker_or_output() {
        let directory = tempfile::tempdir().unwrap();
        let archive = directory.path().join("invalid.n4a");
        std::fs::write(&archive, b"not a Core archive").unwrap();
        let output = directory.path().join("must-not-exist.json");
        let mut args = BTreeMap::new();
        args.insert("archive".to_owned(), archive.into_os_string());
        args.insert("output".to_owned(), output.clone().into_os_string());
        args.insert("dag-cli".to_owned(), OsString::from("must-not-spawn"));
        assert!(execute("replay-process", &args).is_err());
        assert!(execute("replay-methods", &args).is_err());
        assert!(!output.exists());
    }
}
