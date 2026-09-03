//! Core-owned Archive V2 to DAG-ML Methods replay composition.
//!
//! Archive parsing and integrity remain Core-owned. DAG-ML remains the sole
//! owner of package semantics, scheduling, N4MM hydration and conformal
//! intervals.

use std::collections::{BTreeMap, BTreeSet};
use std::fmt;
use std::fs::{File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

use dag_ml_core::training::PredictionSource;
use dag_ml_core::{
    build_conformal_presentation_v1, build_conformal_presentation_v2,
    deserialize_external_contract, execute_loaded_methods_portable_refit_replay_v3,
    execute_loaded_methods_predictor_replay, inspect_methods_native_predictor_descriptor_v1,
    methods_n4mm_abi_requirement, methods_pls_predict_feature_content_fingerprint,
    ConformalPresentationV1, ConformalPresentationV2, ExternalDataPlanEnvelope, MethodsPlsDataset,
    MethodsPlsMatrix, MethodsPortablePredictorReplayInput, MethodsPortableRefitReplayInputV3,
    MethodsRuntime, NativePredictorDescriptorV1, ObservationId, Phase, PortablePredictorPackage,
    PortableRefitPackageV3, PortableRefitReplayOutcomeV3, PredictionKind, PredictionPartition,
    RunId, RuntimeControllerRegistry, SampleId, SampleRelation, SampleRelationSet,
    TrainingReplayOutcome, TrainingReplayRequest, EXTERNAL_DATA_PLAN_ENVELOPE_SCHEMA_VERSION_V1,
    TRAINING_REPLAY_REQUEST_SCHEMA_VERSION,
};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tempfile::TempDir;

use crate::{load_archive_v2, load_archive_v3, LoadedArchiveV2, LoadedArchiveV3};

/// Typed current-cohort input accepted by the callback-free DAG-ML replay.
pub struct MethodsArchivePredictRequest {
    pub request: TrainingReplayRequest,
    pub data_envelopes: BTreeMap<String, ExternalDataPlanEnvelope>,
    pub methods_inputs: BTreeMap<String, MethodsPlsDataset>,
    pub methods_library_path: PathBuf,
    pub outcome_id: String,
    pub run_id: RunId,
    pub warnings: Vec<String>,
    pub diagnostics: BTreeMap<String, serde_json::Value>,
}

/// Closed product input for one X-only, Methods-backed Archive V2 prediction.
///
/// Core derives the signed DAG-ML replay request, relation authority, external
/// data envelopes and Methods datasets from these host values. Callers cannot
/// inject a fit/refit phase, target values, controller callbacks, artifact
/// handles or a fallback engine.
pub struct MethodsArchiveMatrixPredictRequest {
    pub sample_ids: Vec<String>,
    pub x: Vec<Vec<f64>>,
    pub expected_target_names: Vec<String>,
    pub methods_library_path: PathBuf,
    pub methods_library_sha256: String,
    pub request_id: String,
    pub outcome_id: String,
    pub run_id: RunId,
    pub warnings: Vec<String>,
    pub diagnostics: BTreeMap<String, serde_json::Value>,
}

/// Strict host-language contract for one closed Archive V2 matrix prediction.
///
/// Bindings transport this JSON shape only; Core constructs the typed run id,
/// validates the complete matrix/package identity and attests libn4m before
/// delegating to the typed product surface.
#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct MethodsArchiveMatrixPredictJsonRequest {
    pub sample_ids: Vec<String>,
    pub x: Vec<Vec<f64>>,
    pub expected_target_names: Vec<String>,
    pub methods_library_path: PathBuf,
    pub methods_library_sha256: String,
    pub request_id: String,
    pub outcome_id: String,
    pub run_id: String,
    #[serde(default)]
    pub warnings: Vec<String>,
    #[serde(default)]
    pub diagnostics: BTreeMap<String, serde_json::Value>,
}

struct MethodsArchiveMatrixPredictComposition {
    input: MethodsArchivePredictRequest,
    sample_ids: Vec<SampleId>,
    target_names: Vec<String>,
    output_binding_id: String,
}

const MAX_ATTESTED_METHODS_LIBRARY_BYTES: u64 = 64 * 1024 * 1024;
const CORE_METHODS_ABI_MAJOR: u64 = 2;
const CORE_METHODS_ABI_MINOR: u64 = 5;

struct AttestedMethodsLibrary {
    source_canonical_path: PathBuf,
    sha256: String,
    bytes: Vec<u8>,
}

struct ConfiguredMethodsLibrary {
    source_canonical_path: PathBuf,
    sha256: String,
    snapshot_path: PathBuf,
    abi_error: Option<String>,
    _snapshot_directory: TempDir,
}

static CONFIGURED_METHODS_LIBRARY: OnceLock<Mutex<Option<ConfiguredMethodsLibrary>>> =
    OnceLock::new();

/// Typed current-cohort input for a target-bound Archive V3 full-refit replay.
///
/// `supplemental_controllers` is deliberately invocation-local and owns only
/// the non-Methods controllers declared by the persisted V3 plan. Core never
/// interprets, hydrates, or caches model artifacts itself: DAG-ML owns all
/// package validation, scheduler execution, and Methods N4MM lifecycle.
pub struct MethodsArchiveRefitRequestV3 {
    pub request: TrainingReplayRequest,
    pub data_envelopes: BTreeMap<String, ExternalDataPlanEnvelope>,
    pub methods_inputs: BTreeMap<String, MethodsPlsDataset>,
    pub methods_library_path: PathBuf,
    pub supplemental_controllers: RuntimeControllerRegistry,
    pub outcome_id: String,
    pub run_id: RunId,
    pub warnings: Vec<String>,
    pub diagnostics: BTreeMap<String, serde_json::Value>,
}

/// JSON inputs accepted by host-language bindings for callback-free replay.
///
/// The JSON documents remain DAG-ML contracts. Core only performs the strict
/// host-boundary conversion needed to call the typed aggregate entry point.
/// Archive parsing still happens first, and neither callbacks nor serialized
/// Python model handles are part of this surface.
pub struct MethodsArchiveReplayJsonRequest {
    pub request_json: String,
    pub data_envelopes_json: String,
    pub methods_inputs_json: String,
    pub methods_library_path: PathBuf,
    pub outcome_id: String,
    pub run_id: String,
    pub warnings_json: String,
    pub diagnostics_json: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct MethodsDatasetJson {
    sample_ids: Vec<String>,
    x: Vec<Vec<f64>>,
    #[serde(default)]
    y: Option<Vec<Vec<f64>>>,
    target_names: Vec<String>,
}

/// Fail-closed error at the aggregate composition boundary.
#[derive(Debug)]
pub struct NativeMethodsReplayError(String);

impl fmt::Display for NativeMethodsReplayError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.0.fmt(formatter)
    }
}

impl std::error::Error for NativeMethodsReplayError {}

fn replay_error(detail: impl std::fmt::Display) -> NativeMethodsReplayError {
    NativeMethodsReplayError(detail.to_string())
}

fn parse_contract<T>(json: &str, label: &str) -> Result<T, NativeMethodsReplayError>
where
    T: DeserializeOwned + Serialize,
{
    deserialize_external_contract(json, label, |detail| {
        dag_ml_core::DagMlError::CampaignValidation(detail)
    })
    .map_err(|error| replay_error(format!("DAG-ML rejected {label}: {error}")))
}

fn matrix_from_rows(
    rows: Vec<Vec<f64>>,
    label: &str,
) -> Result<MethodsPlsMatrix, NativeMethodsReplayError> {
    let row_count = rows.len();
    let columns = rows.first().map(Vec::len).unwrap_or(0);
    if row_count == 0 || columns == 0 || rows.iter().any(|row| row.len() != columns) {
        return Err(replay_error(format!(
            "DAG-ML rejected {label}: expected a non-empty rectangular matrix"
        )));
    }
    Ok(MethodsPlsMatrix {
        values: rows.into_iter().flatten().collect(),
        rows: row_count,
        cols: columns,
    })
}

fn methods_dataset_from_json(
    input: MethodsDatasetJson,
    label: &str,
) -> Result<MethodsPlsDataset, NativeMethodsReplayError> {
    let sample_ids = input
        .sample_ids
        .into_iter()
        .map(SampleId::new)
        .collect::<dag_ml_core::Result<Vec<_>>>()
        .map_err(|error| replay_error(format!("DAG-ML rejected {label}: {error}")))?;
    let dataset = MethodsPlsDataset {
        sample_ids,
        x: matrix_from_rows(input.x, &format!("{label}.x"))?,
        y: input
            .y
            .map(|rows| matrix_from_rows(rows, &format!("{label}.y")))
            .transpose()?,
        target_names: input.target_names,
    };
    dataset
        .validate(label, false)
        .map_err(|error| replay_error(format!("DAG-ML rejected {label}: {error}")))?;
    Ok(dataset)
}

fn hash_reader(
    mut reader: impl Read,
    label: &str,
) -> Result<(String, Vec<u8>), NativeMethodsReplayError> {
    let mut bytes = Vec::new();
    reader
        .by_ref()
        .take(MAX_ATTESTED_METHODS_LIBRARY_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| replay_error(format!("cannot read {label}: {error}")))?;
    if bytes.len() as u64 > MAX_ATTESTED_METHODS_LIBRARY_BYTES {
        return Err(replay_error(format!(
            "{label} exceeds the {} byte limit",
            MAX_ATTESTED_METHODS_LIBRARY_BYTES
        )));
    }
    let sha256 = format!("{:x}", Sha256::digest(&bytes));
    Ok((sha256, bytes))
}

fn attest_methods_library(
    path: &Path,
    expected_sha256: &str,
) -> Result<AttestedMethodsLibrary, NativeMethodsReplayError> {
    let attested = read_methods_library_identity(path)?;
    if attested.sha256 != expected_sha256 {
        return Err(replay_error(format!(
            "libn4m SHA-256 identity mismatch: expected {expected_sha256}, got {}",
            attested.sha256
        )));
    }
    Ok(attested)
}

fn read_methods_library_identity(
    path: &Path,
) -> Result<AttestedMethodsLibrary, NativeMethodsReplayError> {
    if !path.is_absolute() {
        return Err(replay_error("libn4m path must be absolute"));
    }
    let link_metadata = std::fs::symlink_metadata(path)
        .map_err(|error| replay_error(format!("cannot inspect libn4m identity: {error}")))?;
    if link_metadata.file_type().is_symlink() || !link_metadata.is_file() {
        return Err(replay_error(
            "libn4m identity must name a regular non-symlink file",
        ));
    }
    if link_metadata.len() > MAX_ATTESTED_METHODS_LIBRARY_BYTES {
        return Err(replay_error(format!(
            "attested libn4m exceeds the {} byte limit",
            MAX_ATTESTED_METHODS_LIBRARY_BYTES
        )));
    }
    let source_canonical_path = std::fs::canonicalize(path)
        .map_err(|error| replay_error(format!("cannot canonicalize libn4m identity: {error}")))?;
    if source_canonical_path != path {
        return Err(replay_error(
            "libn4m path must be canonical and contain no symlink components",
        ));
    }
    let file = File::open(path)
        .map_err(|error| replay_error(format!("cannot open attested libn4m: {error}")))?;
    let opened_metadata = file
        .metadata()
        .map_err(|error| replay_error(format!("cannot inspect opened libn4m: {error}")))?;
    if !opened_metadata.is_file() || opened_metadata.len() != link_metadata.len() {
        return Err(replay_error(
            "libn4m identity changed while opening the attested file",
        ));
    }
    let (actual, bytes) = hash_reader(file, "attested libn4m")?;
    Ok(AttestedMethodsLibrary {
        source_canonical_path,
        sha256: actual,
        bytes,
    })
}

fn ensure_same_configured_methods_library(
    configured: &ConfiguredMethodsLibrary,
    attested: &AttestedMethodsLibrary,
) -> Result<PathBuf, NativeMethodsReplayError> {
    let path_matches = configured.source_canonical_path == attested.source_canonical_path
        || configured.snapshot_path == attested.source_canonical_path;
    if !path_matches || configured.sha256 != attested.sha256 {
        return Err(replay_error(format!(
            "libn4m process identity is already fixed to `{}` at SHA-256 {}; requested `{}` at SHA-256 {}",
            configured.source_canonical_path.display(),
            configured.sha256,
            attested.source_canonical_path.display(),
            attested.sha256
        )));
    }
    if let Some(error) = &configured.abi_error {
        return Err(replay_error(format!(
            "the configured libn4m process identity failed ABI 2.5 verification: {error}"
        )));
    }
    Ok(configured.snapshot_path.clone())
}

fn write_attested_methods_snapshot(
    attested: &AttestedMethodsLibrary,
) -> Result<(TempDir, PathBuf), NativeMethodsReplayError> {
    let directory = tempfile::Builder::new()
        .prefix("nirs4all-core-libn4m-")
        .tempdir()
        .map_err(|error| replay_error(format!("cannot create private libn4m snapshot: {error}")))?;
    let file_name = attested
        .source_canonical_path
        .file_name()
        .ok_or_else(|| replay_error("attested libn4m path has no file name"))?;
    let snapshot_path = directory.path().join(file_name);
    let mut snapshot = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&snapshot_path)
        .map_err(|error| replay_error(format!("cannot create private libn4m snapshot: {error}")))?;
    snapshot
        .write_all(&attested.bytes)
        .and_then(|()| snapshot.sync_all())
        .map_err(|error| {
            replay_error(format!("cannot persist private libn4m snapshot: {error}"))
        })?;
    drop(snapshot);

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&snapshot_path, std::fs::Permissions::from_mode(0o400)).map_err(
            |error| replay_error(format!("cannot protect private libn4m snapshot: {error}")),
        )?;
    }
    #[cfg(not(unix))]
    {
        let mut permissions = std::fs::metadata(&snapshot_path)
            .map_err(|error| replay_error(format!("cannot inspect libn4m snapshot: {error}")))?
            .permissions();
        permissions.set_readonly(true);
        std::fs::set_permissions(&snapshot_path, permissions).map_err(|error| {
            replay_error(format!("cannot protect private libn4m snapshot: {error}"))
        })?;
    }

    let (snapshot_sha256, _) = hash_reader(
        File::open(&snapshot_path)
            .map_err(|error| replay_error(format!("cannot reopen libn4m snapshot: {error}")))?,
        "private libn4m snapshot",
    )?;
    if snapshot_sha256 != attested.sha256 {
        return Err(replay_error(
            "private libn4m snapshot does not match the attested source bytes",
        ));
    }
    Ok((directory, snapshot_path))
}

fn configure_attested_methods_library(
    path: &Path,
    expected_sha256: &str,
) -> Result<PathBuf, NativeMethodsReplayError> {
    if expected_sha256.len() != 64
        || !expected_sha256
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err(replay_error(
            "libn4m SHA-256 identity must be 64 lowercase hexadecimal characters",
        ));
    }
    let attested = attest_methods_library(path, expected_sha256)?;
    configure_methods_library_identity(attested)
}

fn configure_methods_library_identity(
    attested: AttestedMethodsLibrary,
) -> Result<PathBuf, NativeMethodsReplayError> {
    let lock = CONFIGURED_METHODS_LIBRARY.get_or_init(|| Mutex::new(None));
    let mut configured = lock
        .lock()
        .map_err(|_| replay_error("libn4m process identity lock is poisoned"))?;
    if let Some(existing) = configured.as_ref() {
        return ensure_same_configured_methods_library(existing, &attested);
    }

    let (snapshot_directory, snapshot_path) = write_attested_methods_snapshot(&attested)?;
    MethodsRuntime::configure(&snapshot_path).map_err(|error| {
        replay_error(format!(
            "cannot configure the attested Methods runtime: {error}"
        ))
    })?;
    let abi_error = n4m::Context::new().err().map(|error| error.to_string());
    *configured = Some(ConfiguredMethodsLibrary {
        source_canonical_path: attested.source_canonical_path,
        sha256: attested.sha256,
        snapshot_path: snapshot_path.clone(),
        abi_error: abi_error.clone(),
        _snapshot_directory: snapshot_directory,
    });
    if let Some(error) = abi_error {
        return Err(replay_error(format!(
            "the attested libn4m failed ABI 2.5 verification: {error}"
        )));
    }
    Ok(snapshot_path)
}

/// Resolve a training/replay source path through the same process-global,
/// byte-attested snapshot authority used by the explicit SHA-256 preflight.
/// Historical callers need not supply a new field: the first call records the
/// exact source digest, and a later pinned preflight must match it exactly.
pub(crate) fn configure_methods_runtime_for_source(
    path: &Path,
) -> Result<MethodsRuntime, NativeMethodsReplayError> {
    let canonical = std::fs::canonicalize(path)
        .map_err(|error| replay_error(format!("cannot canonicalize libn4m source: {error}")))?;
    let attested = read_methods_library_identity(&canonical)?;
    let snapshot_path = configure_methods_library_identity(attested)?;
    MethodsRuntime::configure(&snapshot_path).map_err(|error| {
        replay_error(format!(
            "cannot open the process-attested Methods runtime: {error}"
        ))
    })
}

/// Attest and configure the exact libn4m identity used by Archive V2 replay.
///
/// This closed preflight hashes a canonical, non-symlink source file, loads a
/// private snapshot of those already-attested bytes, and creates then drops a
/// native context to verify the n4m ABI 2.5 contract. The first successful
/// call fixes both source path and SHA-256 for the process. No runtime path,
/// native handle, archive input, callback or numerical result is returned.
pub fn preflight_methods_archive_v2_library(
    methods_library_path: impl AsRef<Path>,
    methods_library_sha256: &str,
) -> Result<(), NativeMethodsReplayError> {
    configure_attested_methods_library(methods_library_path.as_ref(), methods_library_sha256)
        .map(|_| ())
}

/// Derive and attest every native predictor carried by an Archive V2.
///
/// Core binds the inventoried archive member to DAG-ML's artifact reference,
/// then delegates complete N4MM inspection and controller policy to DAG-ML and
/// Methods. Historical V2 packages without an embedded descriptor remain
/// readable: their descriptor is derived from the native bytes here. A newer
/// embedded descriptor is accepted only when it exactly matches that result.
pub fn inspect_methods_archive_v2_predictors(
    archive: &LoadedArchiveV2,
    methods_library_path: impl AsRef<Path>,
    methods_library_sha256: &str,
) -> Result<Vec<NativePredictorDescriptorV1>, NativeMethodsReplayError> {
    let package = load_v2_predictor_package(archive)?;
    configure_attested_methods_library(methods_library_path.as_ref(), methods_library_sha256)?;
    inspect_package_native_predictors(archive, &package)
}

fn inspect_package_native_predictors(
    archive: &LoadedArchiveV2,
    package: &PortablePredictorPackage,
) -> Result<Vec<NativePredictorDescriptorV1>, NativeMethodsReplayError> {
    let mut declarations = archive
        .methods_n4mm_artifacts()
        .map_err(|error| {
            replay_error(format!(
                "Core Archive V2 N4MM declaration read failed: {error}"
            ))
        })?
        .into_iter()
        .map(|declaration| (declaration.artifact_id().to_owned(), declaration))
        .collect::<BTreeMap<_, _>>();
    let mut descriptors = Vec::new();

    for record in &package.execution_bundle.refit_artifacts {
        let artifact = &record.artifact;
        if artifact.kind != "n4m_model" {
            continue;
        }
        let declaration = declarations.remove(artifact.id.as_str()).ok_or_else(|| {
            replay_error(format!(
                "Core Archive V2 has no N4MM declaration for DAG-ML artifact `{}`",
                artifact.id
            ))
        })?;
        let (artifact_abi_major, artifact_abi_min_minor) = methods_n4mm_abi_requirement(artifact)
            .map_err(|error| {
            replay_error(format!(
                "DAG-ML refused Archive V2 predictor ABI for `{}`: {error}",
                artifact.id
            ))
        })?;
        if artifact.backend != Some(dag_ml_core::ArtifactBackend::Raw)
            || artifact.uri.as_deref() != Some(declaration.member_path())
            || artifact_abi_major != CORE_METHODS_ABI_MAJOR as u32
            || artifact_abi_min_minor != declaration.abi_min_minor()
        {
            return Err(replay_error(format!(
                "Core Archive V2 N4MM declaration does not match DAG-ML artifact `{}`",
                artifact.id
            )));
        }
        let bytes = archive.member(declaration.member_path()).map_err(|error| {
            replay_error(format!(
                "Core Archive V2 N4MM member `{}` read failed: {error}",
                declaration.member_path()
            ))
        })?;
        let embedded = package
            .execution_bundle
            .raw_artifact_payloads
            .get(&artifact.id)
            .ok_or_else(|| {
                replay_error(format!(
                    "DAG-ML package has no detached N4MM bytes for `{}`",
                    artifact.id
                ))
            })?;
        if embedded.as_slice() != bytes {
            return Err(replay_error(format!(
                "DAG-ML N4MM bytes differ from the inventoried Archive V2 member for `{}`",
                artifact.id
            )));
        }

        let derived =
            inspect_methods_native_predictor_descriptor_v1(&artifact.controller_id, bytes)
                .map_err(|error| {
                    replay_error(format!(
                        "DAG-ML/Methods refused Archive V2 predictor `{}`: {error}",
                        artifact.id
                    ))
                })?;
        if derived.format_version != declaration.format_version() {
            return Err(replay_error(format!(
                "Core Archive V2 N4MM declaration format does not match inspected artifact `{}`",
                artifact.id
            )));
        }
        if artifact
            .native_predictor_descriptor
            .as_ref()
            .is_some_and(|embedded| embedded != &derived)
        {
            return Err(replay_error(format!(
                "Archive V2 predictor `{}` does not match its native descriptor",
                artifact.id
            )));
        }
        if declaration.format_version() == 2
            && artifact
                .native_predictor_descriptor
                .as_ref()
                .is_none_or(|embedded| embedded.pipeline.is_none())
        {
            return Err(replay_error(format!(
                "Core Archive V2 pipeline N4MM `{}` requires its content-bound embedded descriptor",
                artifact.id
            )));
        }
        descriptors.push(derived);
    }

    if descriptors.is_empty() || !declarations.is_empty() {
        return Err(replay_error(
            "Archive V2 N4MM declarations do not exactly cover DAG-ML refit predictors",
        ));
    }
    Ok(descriptors)
}

fn require_exactly_one_matrix_data_requirement(
    count: usize,
) -> Result<(), NativeMethodsReplayError> {
    if count != 1 {
        return Err(replay_error(format!(
            "Archive V2 matrix prediction requires exactly one external data requirement, got {count}"
        )));
    }
    Ok(())
}

fn compose_methods_archive_matrix_predict(
    package: &PortablePredictorPackage,
    input: MethodsArchiveMatrixPredictRequest,
) -> Result<MethodsArchiveMatrixPredictComposition, NativeMethodsReplayError> {
    package.validate().map_err(|error| {
        replay_error(format!("DAG-ML rejected Core Archive V2 package: {error}"))
    })?;
    let [binding] = package.output_bindings.as_slice() else {
        return Err(replay_error(
            "Archive V2 matrix prediction requires exactly one output binding",
        ));
    };
    if binding.prediction_source != PredictionSource::FinalRefit
        || binding.prediction_kind != PredictionKind::RegressionPoint
    {
        return Err(replay_error(
            "Archive V2 matrix prediction requires one final-refit regression-point binding",
        ));
    }
    if input.expected_target_names != binding.target_names {
        return Err(replay_error(format!(
            "Archive V2 target order mismatch: expected {:?}, package binds {:?}",
            input.expected_target_names, binding.target_names
        )));
    }

    let sample_ids = input
        .sample_ids
        .into_iter()
        .map(SampleId::new)
        .collect::<dag_ml_core::Result<Vec<_>>>()
        .map_err(|error| replay_error(format!("DAG-ML rejected prediction sample ids: {error}")))?;
    if sample_ids.len() != sample_ids.iter().collect::<BTreeSet<_>>().len() {
        return Err(replay_error(
            "Archive V2 matrix prediction sample ids must be unique",
        ));
    }
    let x = matrix_from_rows(input.x, "Archive V2 matrix prediction X")?;
    if x.rows != sample_ids.len() {
        return Err(replay_error(format!(
            "Archive V2 matrix prediction has {} sample ids for {} X rows",
            sample_ids.len(),
            x.rows
        )));
    }
    x.validate("Archive V2 matrix prediction X")
        .map_err(|error| replay_error(format!("DAG-ML rejected prediction X: {error}")))?;

    let relations = SampleRelationSet {
        records: sample_ids
            .iter()
            .map(|sample_id| {
                let observation_id = ObservationId::new(sample_id.as_str()).map_err(|error| {
                    replay_error(format!(
                        "DAG-ML rejected prediction observation id: {error}"
                    ))
                })?;
                Ok(SampleRelation::new(observation_id, sample_id.clone()))
            })
            .collect::<Result<Vec<_>, NativeMethodsReplayError>>()?,
    };
    relations.validate().map_err(|error| {
        replay_error(format!(
            "DAG-ML rejected prediction relation authority: {error}"
        ))
    })?;
    let relation_fingerprint = relations.fingerprint().map_err(|error| {
        replay_error(format!(
            "DAG-ML could not fingerprint prediction relations: {error}"
        ))
    })?;
    let data_content_fingerprint =
        methods_pls_predict_feature_content_fingerprint(&x).map_err(|error| {
            replay_error(format!(
                "DAG-ML could not fingerprint prediction X: {error}"
            ))
        })?;

    require_exactly_one_matrix_data_requirement(package.execution_bundle.data_requirements.len())?;
    let requirement = &package.execution_bundle.data_requirements[0];
    let mut data_envelopes = BTreeMap::new();
    let mut methods_inputs = BTreeMap::new();
    requirement.validate().map_err(|error| {
        replay_error(format!(
            "DAG-ML rejected Archive V2 data requirement: {error}"
        ))
    })?;
    if requirement.output_representation != "tabular_numeric" {
        return Err(replay_error(format!(
            "Archive V2 matrix prediction does not support requirement `{}` representation `{}`",
            requirement.key(),
            requirement.output_representation
        )));
    }
    let key = requirement.key();
    let envelope = ExternalDataPlanEnvelope {
        schema_version: EXTERNAL_DATA_PLAN_ENVELOPE_SCHEMA_VERSION_V1,
        schema_fingerprint: requirement.schema_fingerprint.clone(),
        plan_fingerprint: requirement.plan_fingerprint.clone(),
        relation_fingerprint: Some(relation_fingerprint),
        data_content_fingerprint: Some(data_content_fingerprint),
        target_content_fingerprint: None,
        coordinator_relations: Some(relations),
        predict_cohort: None,
    };
    envelope.validate().map_err(|error| {
        replay_error(format!(
            "DAG-ML rejected derived prediction envelope `{key}`: {error}"
        ))
    })?;
    let dataset = MethodsPlsDataset {
        sample_ids: sample_ids.clone(),
        x,
        y: None,
        target_names: binding.target_names.clone(),
    };
    dataset
        .validate(
            &format!("Archive V2 matrix prediction input `{key}`"),
            false,
        )
        .map_err(|error| replay_error(format!("DAG-ML rejected derived Methods input: {error}")))?;
    data_envelopes.insert(key.clone(), envelope);
    methods_inputs.insert(key, dataset);

    let mut request = TrainingReplayRequest {
        schema_version: TRAINING_REPLAY_REQUEST_SCHEMA_VERSION,
        request_id: input.request_id,
        source_outcome_fingerprint: package.training_outcome.outcome_fingerprint.clone(),
        phase: Phase::Predict,
        data_envelope_keys: data_envelopes.keys().cloned().collect(),
        output_binding_ids: vec![binding.binding_id.clone()],
        request_fingerprint: String::new(),
    };
    request.request_fingerprint = request.compute_fingerprint().map_err(|error| {
        replay_error(format!(
            "DAG-ML could not sign the derived replay request: {error}"
        ))
    })?;
    request.validate().map_err(|error| {
        replay_error(format!("DAG-ML rejected derived replay request: {error}"))
    })?;

    Ok(MethodsArchiveMatrixPredictComposition {
        input: MethodsArchivePredictRequest {
            request,
            data_envelopes,
            methods_inputs,
            methods_library_path: input.methods_library_path,
            outcome_id: input.outcome_id,
            run_id: input.run_id,
            warnings: input.warnings,
            diagnostics: input.diagnostics,
        },
        sample_ids,
        target_names: binding.target_names.clone(),
        output_binding_id: binding.binding_id.clone(),
    })
}

fn validate_methods_archive_matrix_outcome(
    outcome: &TrainingReplayOutcome,
    sample_ids: &[SampleId],
    target_names: &[String],
    output_binding_id: &str,
) -> Result<(), NativeMethodsReplayError> {
    outcome.validate().map_err(|error| {
        replay_error(format!(
            "DAG-ML returned an invalid replay outcome: {error}"
        ))
    })?;
    let [output] = outcome.outputs.as_slice() else {
        return Err(replay_error(
            "Archive V2 matrix prediction returned an ambiguous output set",
        ));
    };
    if output.binding.binding_id != output_binding_id || output.binding.target_names != target_names
    {
        return Err(replay_error(
            "Archive V2 matrix prediction output binding or target order changed",
        ));
    }
    let [prediction] = output.predictions.as_slice() else {
        return Err(replay_error(
            "Archive V2 matrix prediction requires exactly one terminal prediction block",
        ));
    };
    if prediction.partition != PredictionPartition::Final
        || prediction.sample_ids != sample_ids
        || prediction.target_names != target_names
    {
        return Err(replay_error(
            "Archive V2 matrix prediction changed terminal partition, sample order or target order",
        ));
    }
    if prediction.values.len() != sample_ids.len()
        || prediction
            .values
            .iter()
            .any(|row| row.len() != target_names.len())
        || prediction
            .values
            .iter()
            .flatten()
            .any(|value| !value.is_finite())
    {
        return Err(replay_error(
            "Archive V2 matrix prediction returned an invalid or non-finite result matrix",
        ));
    }
    Ok(())
}

fn parse_json_request(
    input: MethodsArchiveReplayJsonRequest,
) -> Result<MethodsArchivePredictRequest, NativeMethodsReplayError> {
    let request = TrainingReplayRequest::from_json(&input.request_json)
        .map_err(|error| replay_error(format!("DAG-ML rejected replay request: {error}")))?;
    let data_envelopes = parse_contract::<BTreeMap<String, ExternalDataPlanEnvelope>>(
        &input.data_envelopes_json,
        "Methods replay data envelope map",
    )?;
    for (key, envelope) in &data_envelopes {
        envelope.validate().map_err(|error| {
            replay_error(format!(
                "DAG-ML rejected Methods replay data envelope `{key}`: {error}"
            ))
        })?;
    }
    let raw_inputs = parse_contract::<BTreeMap<String, MethodsDatasetJson>>(
        &input.methods_inputs_json,
        "Methods replay input map",
    )?;
    let methods_inputs = raw_inputs
        .into_iter()
        .map(|(key, dataset)| {
            let label = format!("Methods replay input `{key}`");
            Ok((key, methods_dataset_from_json(dataset, &label)?))
        })
        .collect::<Result<BTreeMap<_, _>, NativeMethodsReplayError>>()?;
    let warnings = parse_contract::<Vec<String>>(&input.warnings_json, "Methods replay warnings")?;
    let diagnostics = parse_contract::<BTreeMap<String, serde_json::Value>>(
        &input.diagnostics_json,
        "Methods replay diagnostics",
    )?;
    let run_id = RunId::new(&input.run_id)
        .map_err(|error| replay_error(format!("DAG-ML rejected replay run_id: {error}")))?;
    Ok(MethodsArchivePredictRequest {
        request,
        data_envelopes,
        methods_inputs,
        methods_library_path: input.methods_library_path,
        outcome_id: input.outcome_id,
        run_id,
        warnings,
        diagnostics,
    })
}

/// Replay a Core-validated Archive V2 through the registered Methods runtime.
///
/// The archive is opened before this function is called, so malformed ZIPs,
/// inventory drift and untrusted members are refused by Core before DAG-ML sees
/// package bytes. No Python callback, model handle or estimator is accepted.
pub fn replay_methods_archive_v2(
    archive: &LoadedArchiveV2,
    input: MethodsArchivePredictRequest,
) -> Result<TrainingReplayOutcome, NativeMethodsReplayError> {
    let package = load_v2_predictor_package(archive)?;
    replay_methods_predictor_package(&package, input)
}

/// Execute one closed, X-only Archive V2 Methods prediction.
///
/// This is the product-host surface for Studio and other Rust orchestrators.
/// It derives every DAG-ML replay contract through upstream constructors,
/// attests the exact native Methods library, then configures the process-global
/// runtime only after package, binding, target, identity and matrix validation.
/// It never fits, refits, calls Python or selects a fallback implementation.
pub fn predict_methods_archive_v2_matrix(
    archive: &LoadedArchiveV2,
    input: MethodsArchiveMatrixPredictRequest,
) -> Result<TrainingReplayOutcome, NativeMethodsReplayError> {
    let package = load_v2_predictor_package(archive)?;
    let expected_library_sha256 = input.methods_library_sha256.clone();
    let MethodsArchiveMatrixPredictComposition {
        input,
        sample_ids,
        target_names,
        output_binding_id,
    } = compose_methods_archive_matrix_predict(&package, input)?;
    let snapshot_path =
        configure_attested_methods_library(&input.methods_library_path, &expected_library_sha256)?;
    inspect_package_native_predictors(archive, &package)?;
    let mut input = input;
    input.methods_library_path = snapshot_path;
    let outcome = replay_methods_predictor_package(&package, input)?;
    validate_methods_archive_matrix_outcome(
        &outcome,
        &sample_ids,
        &target_names,
        &output_binding_id,
    )?;
    Ok(outcome)
}

/// Execute the closed X-only product surface and return DAG-ML's Archive-bound
/// multi-target conformal presentation. Core supplies the archive digest and
/// descriptors inspected from the inventoried N4MM bytes; it does not
/// calculate or reshape intervals.
pub fn predict_methods_archive_v2_matrix_conformal_presentation_v2(
    archive: &LoadedArchiveV2,
    input: MethodsArchiveMatrixPredictRequest,
) -> Result<ConformalPresentationV2, NativeMethodsReplayError> {
    let package = load_v2_predictor_package(archive)?;
    let expected_library_sha256 = input.methods_library_sha256.clone();
    let MethodsArchiveMatrixPredictComposition {
        input,
        sample_ids,
        target_names,
        output_binding_id,
    } = compose_methods_archive_matrix_predict(&package, input)?;
    let request = input.request.clone();
    let snapshot_path =
        configure_attested_methods_library(&input.methods_library_path, &expected_library_sha256)?;
    let native_predictors = inspect_package_native_predictors(archive, &package)?;
    let mut input = input;
    input.methods_library_path = snapshot_path;
    let outcome = replay_methods_predictor_package(&package, input)?;
    validate_methods_archive_matrix_outcome(
        &outcome,
        &sample_ids,
        &target_names,
        &output_binding_id,
    )?;
    build_conformal_presentation_v2(
        archive.reference().archive_sha256(),
        &package,
        &request,
        &outcome,
        &native_predictors,
    )
    .map_err(|error| {
        replay_error(format!(
            "DAG-ML could not build Core Archive V2 conformal presentation V2: {error}"
        ))
    })
}

/// Execute the closed Archive V2 matrix surface from a strict JSON binding.
///
/// The returned JSON is DAG-ML's validated replay outcome. Host bindings do
/// not compose replay envelopes, choose controllers or post-process values.
pub fn predict_methods_archive_v2_matrix_json(
    archive: &LoadedArchiveV2,
    input_json: &str,
) -> Result<String, NativeMethodsReplayError> {
    let input = parse_contract::<MethodsArchiveMatrixPredictJsonRequest>(
        input_json,
        "Archive V2 matrix prediction request",
    )?;
    let run_id = RunId::new(&input.run_id).map_err(|error| {
        replay_error(format!("DAG-ML rejected matrix prediction run_id: {error}"))
    })?;
    let outcome = predict_methods_archive_v2_matrix(
        archive,
        MethodsArchiveMatrixPredictRequest {
            sample_ids: input.sample_ids,
            x: input.x,
            expected_target_names: input.expected_target_names,
            methods_library_path: input.methods_library_path,
            methods_library_sha256: input.methods_library_sha256,
            request_id: input.request_id,
            outcome_id: input.outcome_id,
            run_id,
            warnings: input.warnings,
            diagnostics: input.diagnostics,
        },
    )?;
    serde_json::to_string(&outcome).map_err(|error| {
        replay_error(format!(
            "cannot serialize Archive V2 matrix prediction outcome: {error}"
        ))
    })
}

/// Open one Archive V2 and return its native predictor descriptors as JSON.
///
/// The native Methods library is content-attested before any descriptor is
/// derived. The returned JSON is serialized from DAG-ML's typed contract; no
/// host-supplied descriptor or capability metadata is accepted.
pub fn inspect_methods_archive_v2_predictors_json(
    archive_path: &Path,
    methods_library_path: &Path,
    methods_library_sha256: &str,
) -> Result<String, NativeMethodsReplayError> {
    let archive = load_archive_v2(archive_path)
        .map_err(|error| replay_error(format!("Core Archive V2 validation refused: {error}")))?;
    let descriptors = inspect_methods_archive_v2_predictors(
        &archive,
        methods_library_path,
        methods_library_sha256,
    )?;
    serde_json::to_string(&descriptors).map_err(|error| {
        replay_error(format!(
            "cannot serialize Archive V2 native predictor descriptors: {error}"
        ))
    })
}

/// Replay an integrity-checked Archive V2 and project its already-calculated
/// split-conformal intervals through DAG-ML's closed presentation contract.
///
/// Core keeps the validated package, signed request and resulting replay
/// together only for this call. DAG-ML validates their complete provenance,
/// binding, sample-order and interval closure before returning the projection;
/// Core neither calculates an interval nor selects a target.
pub fn replay_methods_archive_v2_conformal_presentation_v1(
    archive: &LoadedArchiveV2,
    input: MethodsArchivePredictRequest,
) -> Result<ConformalPresentationV1, NativeMethodsReplayError> {
    let package = load_v2_predictor_package(archive)?;
    let request = input.request.clone();
    let replay = replay_methods_predictor_package(&package, input)?;
    build_conformal_presentation_v1(&package, &request, &replay).map_err(|error| {
        replay_error(format!(
            "DAG-ML could not build Core Archive V2 conformal presentation: {error}"
        ))
    })
}

/// Replay an integrity-checked Archive V2 and project the complete persisted
/// multi-target conformal result. V1 remains unchanged for scalar consumers.
pub fn replay_methods_archive_v2_conformal_presentation_v2(
    archive: &LoadedArchiveV2,
    input: MethodsArchivePredictRequest,
) -> Result<ConformalPresentationV2, NativeMethodsReplayError> {
    let package = load_v2_predictor_package(archive)?;
    let request = input.request.clone();
    let replay = replay_methods_predictor_package(&package, input)?;
    let native_predictors = inspect_package_native_predictors(archive, &package)?;
    build_conformal_presentation_v2(
        archive.reference().archive_sha256(),
        &package,
        &request,
        &replay,
        &native_predictors,
    )
    .map_err(|error| {
        replay_error(format!(
            "DAG-ML could not build Core Archive V2 conformal presentation V2: {error}"
        ))
    })
}

/// Parse persisted presentation JSON only in the presence of its exact
/// integrity-checked archive and byte-attested Methods library.
pub fn load_methods_archive_v2_conformal_presentation_v2(
    archive: &LoadedArchiveV2,
    presentation_json: &str,
    methods_library_path: impl AsRef<Path>,
    methods_library_sha256: &str,
) -> Result<ConformalPresentationV2, NativeMethodsReplayError> {
    let package = load_v2_predictor_package(archive)?;
    configure_attested_methods_library(methods_library_path.as_ref(), methods_library_sha256)?;
    let native_predictors = inspect_package_native_predictors(archive, &package)?;
    let presentation = ConformalPresentationV2::from_json_for_package(
        presentation_json,
        &package,
        &native_predictors,
    )
    .map_err(|error| {
        replay_error(format!(
            "DAG-ML rejected Core Archive V2 conformal presentation V2: {error}"
        ))
    })?;
    require_conformal_archive_identity(
        &presentation.archive_sha256,
        archive.reference().archive_sha256(),
    )?;
    Ok(presentation)
}

fn require_conformal_archive_identity(
    presentation_archive_sha256: &str,
    loaded_archive_sha256: &str,
) -> Result<(), NativeMethodsReplayError> {
    if presentation_archive_sha256 != loaded_archive_sha256 {
        return Err(replay_error(
            "conformal presentation V2 archive SHA-256 does not match validated Archive V2 bytes",
        ));
    }
    Ok(())
}

fn load_v2_predictor_package(
    archive: &LoadedArchiveV2,
) -> Result<PortablePredictorPackage, NativeMethodsReplayError> {
    require_archive_methods_abi(archive.manifest(), "Archive V2")?;
    let package_bytes = archive.portable_predictor_package().map_err(|error| {
        NativeMethodsReplayError(format!("Core Archive V2 package read failed: {error}"))
    })?;
    let package_json = std::str::from_utf8(package_bytes).map_err(|error| {
        NativeMethodsReplayError(format!(
            "Core Archive V2 package is not UTF-8 JSON: {error}"
        ))
    })?;
    let package = PortablePredictorPackage::from_json(package_json).map_err(|error| {
        NativeMethodsReplayError(format!("DAG-ML rejected Core Archive V2 package: {error}"))
    })?;
    Ok(package)
}

/// Refuse a payload before native import when its manifest requires a newer
/// Methods ABI than the n4m binding compiled into this Core release.
///
/// The absent-field fallback is intentionally limited to the historical V2/V3
/// profile: PLS N4MM existed at ABI 2.0 and usable N4MOPT at ABI 2.2. New writers emit
/// `abi_min_minor` from the actual payload capability (for example, 3 for an
/// imported-linear N4MM) rather than from the host runtime version.
fn require_archive_methods_abi(
    manifest: &serde_json::Value,
    archive_label: &str,
) -> Result<(), NativeMethodsReplayError> {
    require_archive_methods_abi_for_runtime(
        manifest,
        archive_label,
        CORE_METHODS_ABI_MAJOR,
        CORE_METHODS_ABI_MINOR,
    )
}

fn require_archive_methods_abi_for_runtime(
    manifest: &serde_json::Value,
    archive_label: &str,
    runtime_major: u64,
    runtime_minor: u64,
) -> Result<(), NativeMethodsReplayError> {
    let methods = manifest
        .get("payloads")
        .and_then(|value| value.get("methods"))
        .and_then(serde_json::Value::as_object)
        .ok_or_else(|| replay_error(format!("{archive_label} Methods manifest is absent")))?;
    for kind in ["n4mm", "n4mopt"] {
        let references = methods
            .get(kind)
            .and_then(serde_json::Value::as_array)
            .ok_or_else(|| replay_error(format!("{archive_label} {kind} references are absent")))?;
        for reference in references {
            let required_major = reference
                .get("abi_major")
                .and_then(serde_json::Value::as_u64)
                .ok_or_else(|| {
                    replay_error(format!("{archive_label} {kind} ABI major is absent"))
                })?;
            let historical_minimum = if kind == "n4mopt" { 2 } else { 0 };
            let required_minor = reference
                .get("abi_min_minor")
                .and_then(serde_json::Value::as_u64)
                .unwrap_or(historical_minimum);
            if required_major != runtime_major || runtime_minor < required_minor {
                return Err(replay_error(format!(
                    "{archive_label} {kind} payload requires Methods ABI {required_major}.{required_minor} or newer within the same major; Core provides ABI {runtime_major}.{runtime_minor}"
                )));
            }
        }
    }
    Ok(())
}

fn replay_methods_predictor_package(
    package: &PortablePredictorPackage,
    input: MethodsArchivePredictRequest,
) -> Result<TrainingReplayOutcome, NativeMethodsReplayError> {
    // Keep structural/package/request/input validation ahead of process-global
    // libn4m configuration. Cross-contract scheduling and native N4MM hydration
    // remain DAG-ML-owned below.
    package.validate().map_err(|error| {
        replay_error(format!("DAG-ML rejected Core Archive V2 package: {error}"))
    })?;
    input
        .request
        .validate()
        .map_err(|error| replay_error(format!("DAG-ML rejected replay request: {error}")))?;
    if input.request.phase != Phase::Predict {
        return Err(replay_error(
            "DAG-ML rejected replay request: callback-free Methods package replay supports PREDICT only",
        ));
    }
    for (key, dataset) in &input.methods_inputs {
        dataset
            .validate(&format!("native Methods replay input `{key}`"), false)
            .map_err(|error| replay_error(format!("DAG-ML rejected Methods input: {error}")))?;
    }
    let runtime = configure_methods_runtime_for_source(&input.methods_library_path)?;
    execute_loaded_methods_predictor_replay(MethodsPortablePredictorReplayInput {
        package,
        request: &input.request,
        data_envelopes: &input.data_envelopes,
        methods_inputs: &input.methods_inputs,
        runtime,
        outcome_id: input.outcome_id,
        run_id: input.run_id,
        warnings: input.warnings,
        diagnostics: input.diagnostics,
    })
    .map_err(|error| NativeMethodsReplayError(format!("DAG-ML Methods replay failed: {error}")))
}

/// Replay a Core-validated Archive V3 target-bound refit package.
///
/// V3 remains a DAG-ML package family: Core provides only integrity-checked
/// bytes and the caller's attested current cohort. The public DAG-ML entry
/// point validates the complete package then registers a fresh Methods runtime
/// for this invocation, so no process-local N4MM handle can survive the call.
pub fn replay_methods_archive_v3(
    archive: &LoadedArchiveV3,
    input: MethodsArchiveRefitRequestV3,
) -> Result<PortableRefitReplayOutcomeV3, NativeMethodsReplayError> {
    require_archive_methods_abi(archive.manifest(), "Archive V3")?;
    let package_bytes = archive.portable_refit_package().map_err(|error| {
        NativeMethodsReplayError(format!("Core Archive V3 package read failed: {error}"))
    })?;
    let package_json = std::str::from_utf8(package_bytes).map_err(|error| {
        NativeMethodsReplayError(format!(
            "Core Archive V3 package is not UTF-8 JSON: {error}"
        ))
    })?;
    let package = PortableRefitPackageV3::from_json(package_json).map_err(|error| {
        NativeMethodsReplayError(format!("DAG-ML rejected Core Archive V3 package: {error}"))
    })?;
    let runtime = configure_methods_runtime_for_source(&input.methods_library_path)?;
    execute_loaded_methods_portable_refit_replay_v3(MethodsPortableRefitReplayInputV3 {
        package: &package,
        request: &input.request,
        data_envelopes: &input.data_envelopes,
        methods_inputs: &input.methods_inputs,
        runtime,
        supplemental_controllers: input.supplemental_controllers,
        outcome_id: input.outcome_id,
        run_id: input.run_id,
        warnings: input.warnings,
        diagnostics: input.diagnostics,
    })
    .map_err(|error| NativeMethodsReplayError(format!("DAG-ML Methods V3 replay failed: {error}")))
}

/// Open, validate, and replay an Archive V2 from strict host JSON contracts.
///
/// Archive validation is deliberately completed before any request parsing or
/// Methods runtime configuration. The returned JSON is the exact serialized
/// DAG-ML replay outcome.
pub fn replay_methods_archive_v2_json(
    archive_path: &Path,
    input: MethodsArchiveReplayJsonRequest,
) -> Result<String, NativeMethodsReplayError> {
    let archive = load_archive_v2(archive_path)
        .map_err(|error| replay_error(format!("Core Archive V2 validation refused: {error}")))?;
    let input = parse_json_request(input)?;
    let outcome = replay_methods_archive_v2(&archive, input)?;
    serde_json::to_string(&outcome).map_err(|error| {
        replay_error(format!(
            "cannot serialize DAG-ML V2 replay outcome: {error}"
        ))
    })
}

/// Open, validate and replay an Archive V2, returning DAG-ML's exact closed
/// conformal-presentation JSON for binding and Studio transport.
pub fn replay_methods_archive_v2_conformal_presentation_v1_json(
    archive_path: &Path,
    input: MethodsArchiveReplayJsonRequest,
) -> Result<String, NativeMethodsReplayError> {
    let archive = load_archive_v2(archive_path)
        .map_err(|error| replay_error(format!("Core Archive V2 validation refused: {error}")))?;
    let input = parse_json_request(input)?;
    let presentation = replay_methods_archive_v2_conformal_presentation_v1(&archive, input)?;
    serde_json::to_string(&presentation).map_err(|error| {
        replay_error(format!(
            "cannot serialize DAG-ML V2 conformal presentation: {error}"
        ))
    })
}

/// Open, validate and replay an Archive V2, returning DAG-ML's exact
/// content-bound multi-target conformal-presentation V2 JSON.
pub fn replay_methods_archive_v2_conformal_presentation_v2_json(
    archive_path: &Path,
    input: MethodsArchiveReplayJsonRequest,
) -> Result<String, NativeMethodsReplayError> {
    let archive = load_archive_v2(archive_path)
        .map_err(|error| replay_error(format!("Core Archive V2 validation refused: {error}")))?;
    let input = parse_json_request(input)?;
    let presentation = replay_methods_archive_v2_conformal_presentation_v2(&archive, input)?;
    serde_json::to_string(&presentation).map_err(|error| {
        replay_error(format!(
            "cannot serialize DAG-ML V2 conformal presentation V2: {error}"
        ))
    })
}

/// Open, validate, and replay an Archive V3 from strict host JSON contracts.
///
/// Python bindings intentionally get an empty supplemental controller registry:
/// the portable path is Methods-only and cannot hydrate a Python callback or a
/// joblib sidecar.
pub fn replay_methods_archive_v3_json(
    archive_path: &Path,
    input: MethodsArchiveReplayJsonRequest,
) -> Result<String, NativeMethodsReplayError> {
    let archive = load_archive_v3(archive_path)
        .map_err(|error| replay_error(format!("Core Archive V3 validation refused: {error}")))?;
    let input = parse_json_request(input)?;
    let outcome = replay_methods_archive_v3(
        &archive,
        MethodsArchiveRefitRequestV3 {
            request: input.request,
            data_envelopes: input.data_envelopes,
            methods_inputs: input.methods_inputs,
            methods_library_path: input.methods_library_path,
            supplemental_controllers: RuntimeControllerRegistry::new(),
            outcome_id: input.outcome_id,
            run_id: input.run_id,
            warnings: input.warnings,
            diagnostics: input.diagnostics,
        },
    )?;
    serde_json::to_string(&outcome).map_err(|error| {
        replay_error(format!(
            "cannot serialize DAG-ML V3 replay outcome: {error}"
        ))
    })
}

#[cfg(test)]
mod json_tests {
    use super::*;

    #[test]
    fn live_historical_archive_derives_native_predictor_descriptor() {
        let Ok(archive_path) = std::env::var("NIRS4ALL_CORE_LIVE_ARCHIVE_V2") else {
            return;
        };
        let Ok(library_path) = std::env::var("NIRS4ALL_CORE_LIVE_METHODS_LIBRARY") else {
            return;
        };
        let library_path = PathBuf::from(library_path)
            .canonicalize()
            .expect("live Methods library path is canonicalizable");
        let library_sha256 = format!(
            "{:x}",
            Sha256::digest(std::fs::read(&library_path).expect("live Methods library is readable"))
        );
        let archive = load_archive_v2(Path::new(&archive_path)).expect("live Archive V2 is valid");
        let descriptors =
            inspect_methods_archive_v2_predictors(&archive, &library_path, &library_sha256)
                .expect("historical Archive V2 derives a descriptor from native bytes");
        assert_eq!(descriptors.len(), 1);
        let descriptor = &descriptors[0];
        assert_eq!(
            descriptor.descriptor_type,
            "dagml.native_predictor_descriptor.v1"
        );
        assert_eq!(descriptor.schema_version, 1);
        assert_eq!(
            descriptor.owner_controller.as_str(),
            "controller:methods.pls"
        );
        assert_eq!(descriptor.storage_algorithm, 0);
        assert_eq!(descriptor.dimensions.n_features, 2);
        assert_eq!(descriptor.dimensions.n_targets, 2);
        descriptor
            .validate()
            .expect("derived descriptor stays valid");
    }

    #[test]
    fn matrix_product_contract_requires_one_external_requirement() {
        assert!(require_exactly_one_matrix_data_requirement(1).is_ok());
        for count in [0, 2, usize::MAX] {
            let error = require_exactly_one_matrix_data_requirement(count)
                .expect_err("a single X matrix cannot bind an ambiguous requirement set");
            assert!(error.to_string().contains("exactly one"));
            assert!(error.to_string().contains(&count.to_string()));
        }
    }

    #[test]
    fn conformal_presentation_v2_archive_identity_is_exact() {
        let digest = "a".repeat(64);
        require_conformal_archive_identity(&digest, &digest)
            .expect("the exact validated archive identity is accepted");
        let error = require_conformal_archive_identity(&digest, &"b".repeat(64))
            .expect_err("a presentation from another archive must be refused");
        assert!(error
            .to_string()
            .contains("does not match validated Archive V2 bytes"));
    }

    #[test]
    fn archive_methods_abi_minimum_is_checked_before_native_import() {
        let mut manifest = serde_json::json!({
            "payloads": {"methods": {
                "n4mm": [{"abi_major": 2}],
                "n4mopt": []
            }}
        });
        require_archive_methods_abi(&manifest, "Archive V2")
            .expect("an absent minor is the documented historical PLS ABI 2.0 profile");
        manifest["payloads"]["methods"]["n4mm"][0]["abi_min_minor"] = serde_json::Value::from(5);
        require_archive_methods_abi(&manifest, "Archive V2")
            .expect("this candidate provides Methods ABI 2.5");
        manifest["payloads"]["methods"]["n4mm"][0]["abi_min_minor"] = serde_json::Value::from(6);
        let error = require_archive_methods_abi(&manifest, "Archive V2")
            .expect_err("a future Methods minor must be refused before import");
        assert!(error.to_string().contains("requires Methods ABI 2.6"));

        manifest["payloads"]["methods"]["n4mm"] = serde_json::json!([]);
        manifest["payloads"]["methods"]["n4mopt"] = serde_json::json!([{"abi_major": 2}]);
        let error = require_archive_methods_abi_for_runtime(&manifest, "Archive V2", 2, 1)
            .expect_err("historical N4MOPT requires the first usable optimizer ABI 2.2");
        assert!(error.to_string().contains("requires Methods ABI 2.2"));
        require_archive_methods_abi_for_runtime(&manifest, "Archive V2", 2, 2)
            .expect("Methods ABI 2.2 accepts a historical N4MOPT reference");
    }

    #[test]
    fn configured_methods_identity_binds_path_and_sha() {
        let directory = tempfile::tempdir().expect("private test directory");
        let source = directory.path().join("libn4m-source.so");
        let snapshot = directory.path().join("libn4m-snapshot.so");
        let configured = ConfiguredMethodsLibrary {
            source_canonical_path: source.clone(),
            sha256: "a".repeat(64),
            snapshot_path: snapshot.clone(),
            abi_error: None,
            _snapshot_directory: tempfile::tempdir().expect("retained snapshot directory"),
        };
        let matching = AttestedMethodsLibrary {
            source_canonical_path: source.clone(),
            sha256: "a".repeat(64),
            bytes: Vec::new(),
        };
        assert_eq!(
            ensure_same_configured_methods_library(&configured, &matching)
                .expect("same process identity remains usable"),
            snapshot
        );

        let changed_sha = AttestedMethodsLibrary {
            source_canonical_path: source.clone(),
            sha256: "b".repeat(64),
            bytes: Vec::new(),
        };
        assert!(
            ensure_same_configured_methods_library(&configured, &changed_sha)
                .unwrap_err()
                .to_string()
                .contains("process identity is already fixed")
        );

        let changed_path = AttestedMethodsLibrary {
            source_canonical_path: directory.path().join("other-libn4m.so"),
            sha256: "a".repeat(64),
            bytes: Vec::new(),
        };
        assert!(
            ensure_same_configured_methods_library(&configured, &changed_path)
                .unwrap_err()
                .to_string()
                .contains("process identity is already fixed")
        );

        let failed_abi = ConfiguredMethodsLibrary {
            source_canonical_path: source,
            sha256: "a".repeat(64),
            snapshot_path: snapshot,
            abi_error: Some("incompatible ABI".into()),
            _snapshot_directory: tempfile::tempdir().expect("failed ABI snapshot directory"),
        };
        assert!(
            ensure_same_configured_methods_library(&failed_abi, &matching)
                .unwrap_err()
                .to_string()
                .contains("failed ABI 2.5 verification")
        );
    }

    fn matrix_predict_request(
        methods_library_path: PathBuf,
        methods_library_sha256: String,
    ) -> MethodsArchiveMatrixPredictRequest {
        MethodsArchiveMatrixPredictRequest {
            sample_ids: vec!["predict.0".into(), "predict.1".into()],
            x: vec![vec![1.5, 0.5], vec![3.5, 1.5]],
            expected_target_names: vec!["protein".into(), "moisture".into()],
            methods_library_path,
            methods_library_sha256,
            request_id: "replay:nirs4all.rt-pred-001".into(),
            outcome_id: "outcome:nirs4all.rt-pred-001".into(),
            run_id: RunId::new("run:nirs4all.rt-pred-001").unwrap(),
            warnings: Vec::new(),
            diagnostics: BTreeMap::from([(
                "contract".into(),
                serde_json::Value::String("RT-PRED-001".into()),
            )]),
        }
    }

    fn invalid_json_input() -> MethodsArchiveReplayJsonRequest {
        MethodsArchiveReplayJsonRequest {
            request_json: "not-json".to_owned(),
            data_envelopes_json: "not-json".to_owned(),
            methods_inputs_json: "not-json".to_owned(),
            methods_library_path: PathBuf::from("/must-not-open-libn4m"),
            outcome_id: "outcome:must-not-run".to_owned(),
            run_id: "not a run id".to_owned(),
            warnings_json: "not-json".to_owned(),
            diagnostics_json: "not-json".to_owned(),
        }
    }

    #[test]
    fn json_replay_validates_archive_before_host_contracts() {
        let missing = std::env::temp_dir().join(format!(
            "nirs4all-core-missing-archive-{}-{}.n4a",
            std::process::id(),
            std::thread::current().name().unwrap_or("json-test")
        ));
        let v2 = replay_methods_archive_v2_json(&missing, invalid_json_input())
            .expect_err("missing V2 archive must be rejected first");
        assert!(v2
            .to_string()
            .starts_with("Core Archive V2 validation refused:"));
        let conformal = replay_methods_archive_v2_conformal_presentation_v1_json(
            &missing,
            invalid_json_input(),
        )
        .expect_err("missing conformal V2 archive must be rejected first");
        assert!(conformal
            .to_string()
            .starts_with("Core Archive V2 validation refused:"));
        let v3 = replay_methods_archive_v3_json(&missing, invalid_json_input())
            .expect_err("missing V3 archive must be rejected first");
        assert!(v3
            .to_string()
            .starts_with("Core Archive V3 validation refused:"));
    }

    #[test]
    fn methods_input_refuses_unknown_fields() {
        let error = parse_contract::<BTreeMap<String, MethodsDatasetJson>>(
            r#"{"input:predict":{"sample_ids":["sample:1"],"x":[[1.0]],"target_names":["y"],"artifact_handle":"python:model"}}"#,
            "Methods replay input map",
        )
        .expect_err("host artifact handles are not part of the portable input contract");
        assert!(error
            .to_string()
            .contains("unknown field `artifact_handle`"));
    }

    #[test]
    fn matrix_json_input_refuses_injectable_controller_fields() {
        let error = parse_contract::<MethodsArchiveMatrixPredictJsonRequest>(
            r#"{
                "sample_ids":["predict.0"],
                "x":[[1.0]],
                "expected_target_names":["protein"],
                "methods_library_path":"/tmp/libn4m.so",
                "methods_library_sha256":"0000000000000000000000000000000000000000000000000000000000000000",
                "request_id":"request:closed",
                "outcome_id":"outcome:closed",
                "run_id":"run:closed",
                "controller_callback":"python:callable"
            }"#,
            "Archive V2 matrix prediction input",
        )
        .expect_err("controller callbacks are not part of the closed matrix contract");
        assert!(error
            .to_string()
            .contains("unknown field `controller_callback`"));
    }

    #[test]
    fn methods_input_refuses_ragged_matrix() {
        let raw = parse_contract::<BTreeMap<String, MethodsDatasetJson>>(
            r#"{"input:predict":{"sample_ids":["sample:1","sample:2"],"x":[[1.0],[2.0,3.0]],"target_names":["y"]}}"#,
            "Methods replay input map",
        )
        .expect("shape-valid JSON");
        let error = methods_dataset_from_json(
            raw.into_values().next().expect("one dataset"),
            "Methods replay input `input:predict`",
        )
        .expect_err("ragged matrices must fail before Methods runtime configuration");
        assert!(error.to_string().contains("non-empty rectangular matrix"));
    }

    #[test]
    #[ignore = "requires N4A_RT_PRED_ARCHIVE_V2, N4A_RT_PRED_METHODS_LIBRARY and N4A_RT_PRED_METHODS_SHA256"]
    fn real_multitarget_archive_matrix_product_contract() {
        let archive_path = PathBuf::from(
            std::env::var("N4A_RT_PRED_ARCHIVE_V2")
                .expect("N4A_RT_PRED_ARCHIVE_V2 must name the real multi-target witness"),
        );
        let methods_library_source = PathBuf::from(
            std::env::var("N4A_RT_PRED_METHODS_LIBRARY")
                .expect("N4A_RT_PRED_METHODS_LIBRARY must name the real libn4m"),
        );
        let methods_library_sha256 = std::env::var("N4A_RT_PRED_METHODS_SHA256")
            .expect("N4A_RT_PRED_METHODS_SHA256 must attest the real libn4m");
        let methods_library_directory =
            tempfile::tempdir().expect("private mutable libn4m source directory");
        let methods_library_path = methods_library_directory.path().join(
            methods_library_source
                .file_name()
                .expect("real libn4m has a file name"),
        );
        std::fs::copy(&methods_library_source, &methods_library_path)
            .expect("copy real libn4m into the mutable source directory");
        let archive = load_archive_v2(&archive_path).expect("real Archive V2 witness validates");

        let mut wrong_targets =
            matrix_predict_request(methods_library_path.clone(), methods_library_sha256.clone());
        wrong_targets.expected_target_names.swap(0, 1);
        assert!(predict_methods_archive_v2_matrix(&archive, wrong_targets)
            .unwrap_err()
            .to_string()
            .contains("target order mismatch"));

        let mut duplicate_samples =
            matrix_predict_request(methods_library_path.clone(), methods_library_sha256.clone());
        duplicate_samples.sample_ids[1] = duplicate_samples.sample_ids[0].clone();
        assert!(
            predict_methods_archive_v2_matrix(&archive, duplicate_samples)
                .unwrap_err()
                .to_string()
                .contains("sample ids must be unique")
        );

        let mut ragged =
            matrix_predict_request(methods_library_path.clone(), methods_library_sha256.clone());
        ragged.x[1].pop();
        assert!(predict_methods_archive_v2_matrix(&archive, ragged)
            .unwrap_err()
            .to_string()
            .contains("non-empty rectangular matrix"));

        let mut non_finite =
            matrix_predict_request(methods_library_path.clone(), methods_library_sha256.clone());
        non_finite.x[0][0] = f64::NAN;
        assert!(predict_methods_archive_v2_matrix(&archive, non_finite)
            .unwrap_err()
            .to_string()
            .contains("non-finite"));

        let wrong_identity = matrix_predict_request(methods_library_path.clone(), "0".repeat(64));
        assert!(predict_methods_archive_v2_matrix(&archive, wrong_identity)
            .unwrap_err()
            .to_string()
            .contains("libn4m SHA-256 identity mismatch"));

        preflight_methods_archive_v2_library(&methods_library_path, &methods_library_sha256)
            .expect("closed preflight attests the source snapshot and ABI");
        preflight_methods_archive_v2_library(&methods_library_path, &methods_library_sha256)
            .expect("same process identity can be preflighted repeatedly");

        let outcome = predict_methods_archive_v2_matrix(
            &archive,
            matrix_predict_request(methods_library_path.clone(), methods_library_sha256.clone()),
        )
        .expect("real multi-target Archive V2 predicts without fallback");
        let output = outcome.outputs.first().expect("one output binding");
        let prediction = output.predictions.first().expect("one terminal prediction");
        assert_eq!(
            prediction.sample_ids,
            vec![
                SampleId::new("predict.0").unwrap(),
                SampleId::new("predict.1").unwrap(),
            ]
        );
        assert_eq!(prediction.target_names, ["protein", "moisture"]);
        let expected = [
            [1.636_363_636_363_636_5, 13.272_727_272_727_273],
            [2.499_999_999_999_999_6, 15.0],
        ];
        for (actual_row, expected_row) in prediction.values.iter().zip(expected) {
            for (actual, expected) in actual_row.iter().zip(expected_row) {
                assert!((actual - expected).abs() <= 1.0e-9);
            }
        }

        let replacement = b"replacement must never reach the configured native runtime";
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;

            let mut permissions = std::fs::metadata(&methods_library_path)
                .expect("inspect mutable source copy permissions")
                .permissions();
            permissions.set_mode(permissions.mode() | 0o200);
            std::fs::set_permissions(&methods_library_path, permissions)
                .expect("make only the private source copy writable");
        }
        #[cfg(not(unix))]
        {
            let mut permissions = std::fs::metadata(&methods_library_path)
                .expect("inspect mutable source copy permissions")
                .permissions();
            permissions.set_readonly(false);
            std::fs::set_permissions(&methods_library_path, permissions)
                .expect("make only the private source copy writable");
        }
        std::fs::write(&methods_library_path, replacement)
            .expect("replace only the mutable source copy");
        let replacement_sha256 = format!("{:x}", Sha256::digest(replacement));
        let error = predict_methods_archive_v2_matrix(
            &archive,
            matrix_predict_request(methods_library_path, replacement_sha256),
        )
        .expect_err("one process cannot change libn4m identity after its first replay");
        assert!(error
            .to_string()
            .contains("process identity is already fixed"));
    }
}
