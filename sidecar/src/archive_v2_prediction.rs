//! Closed product contract for native Archive V2 prediction.
//!
//! This module validates the array-only request, resolves one persisted
//! workspace export without scanning, reads and hashes the archive from one
//! bounded handle, and executes replay through the immutable Core snapshot and
//! its native Methods boundary. It deliberately contains no independent
//! archive parser or numerical implementation. Product state selects this
//! executor only when the packaged runtime contract attests a per-platform
//! libn4m closure and Core preflight succeeds; otherwise the capability remains
//! unavailable.

use std::{
    collections::{BTreeMap, BTreeSet},
    fmt::Debug,
    fs,
    io::Read,
    path::{Component, Path, PathBuf},
    sync::Arc,
};

#[cfg(unix)]
use cap_std::fs::MetadataExt as CapMetadataExt;
use cap_std::{ambient_authority, fs::Dir};
use nirs4all::{
    dag_ml::RunId, load_archive_v2_bytes, predict_methods_archive_v2_matrix,
    preflight_methods_archive_v2_library, MethodsArchiveMatrixPredictRequest,
};
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
#[cfg(unix)]
use std::os::unix::fs::MetadataExt as StdMetadataExt;

pub const ARCHIVE_V2_PREDICTION_ROUTE: &str = "/api/predict/archive-v2";
pub const MAX_PREDICTION_BODY_BYTES: usize = 64 * 1024;
pub const MAX_ARCHIVE_BYTES: u64 = 64 * 1024 * 1024;
pub const MAX_PREDICTION_RESPONSE_BYTES: usize = 2 * 1024 * 1024;
const MAX_SAMPLES: usize = 128;
const MAX_FEATURES: usize = 256;
const MAX_CELLS: usize = 16_384;
const MAX_TARGETS: usize = 64;
const MAX_ID_BYTES: usize = 256;
const MAX_ARCHIVE_REF_BYTES: usize = 240;
const MAX_PROVENANCE_EXECUTOR_BYTES: usize = 256;
const MAX_METHODS_LIBRARY_BYTES: u64 = 64 * 1024 * 1024;
const MAX_RUNTIME_CONTRACT_BYTES: u64 = 64 * 1024;
const METHODS_ABI_MAJOR: u32 = 2;
const METHODS_ABI_MINOR: u32 = 2;
const PACKAGED_RUNTIME_CONTRACT: &str = "STUDIO_RUNTIME_CONTRACT.json";

#[derive(Clone, Debug, PartialEq)]
pub struct ArchiveV2PredictionRequest {
    pub workspace_id: String,
    pub archive_ref: String,
    pub archive_sha256: String,
    pub sample_ids: Vec<String>,
    pub x: Vec<Vec<f64>>,
    pub expected_target_names: Vec<String>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct ResolvedArchiveV2PredictionRequest {
    pub request: ArchiveV2PredictionRequest,
    pub archive_bytes: Vec<u8>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct ArchiveV2PredictionOutput {
    pub archive_id: String,
    pub sample_ids: Vec<String>,
    pub target_names: Vec<String>,
    pub values: Vec<Vec<f64>>,
    pub provenance_executor: String,
}

/// Product-owned identity of the one native Methods library selected by a
/// packaged runtime closure. None of these values are accepted from HTTP.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PackagedMethodsLibraryIdentity {
    pub path: PathBuf,
    pub size: u64,
    pub sha256: String,
    pub abi_major: u32,
    pub abi_minor: u32,
}

/// Core-backed executor for callback-free Archive V2 matrix replay.
#[derive(Debug)]
pub struct CoreArchiveV2PredictionExecutor {
    methods: PackagedMethodsLibraryIdentity,
}

impl CoreArchiveV2PredictionExecutor {
    /// Acquire one exact packaged libn4m identity before advertising the
    /// capability. The packaged contract fixes ABI 2.2 and this preflight
    /// attests its exact bytes. Core snapshots and re-attests those bytes, then
    /// the n4m binding performs the ABI compatibility call during execution.
    pub fn acquire(
        methods: PackagedMethodsLibraryIdentity,
    ) -> Result<Self, ArchiveV2PredictionExecutorError> {
        if methods.abi_major != METHODS_ABI_MAJOR || methods.abi_minor != METHODS_ABI_MINOR {
            return Err(ArchiveV2PredictionExecutorError::ExecutionFailed);
        }
        attest_regular_file(
            &methods.path,
            methods.size,
            &methods.sha256,
            MAX_METHODS_LIBRARY_BYTES,
        )
        .map_err(|()| ArchiveV2PredictionExecutorError::ExecutionFailed)?;
        preflight_methods_archive_v2_library(&methods.path, &methods.sha256)
            .map_err(|_| ArchiveV2PredictionExecutorError::ExecutionFailed)?;
        Ok(Self { methods })
    }
}

impl ArchiveV2PredictionExecutor for CoreArchiveV2PredictionExecutor {
    fn is_selected(&self) -> bool {
        true
    }

    fn execute(
        &self,
        resolved: &ResolvedArchiveV2PredictionRequest,
    ) -> Result<ArchiveV2PredictionOutput, ArchiveV2PredictionExecutorError> {
        let archive = load_archive_v2_bytes(&resolved.archive_bytes)
            .map_err(|_| ArchiveV2PredictionExecutorError::ExecutionFailed)?;
        if archive.reference().archive_sha256() != resolved.request.archive_sha256 {
            return Err(ArchiveV2PredictionExecutorError::ExecutionFailed);
        }
        let identity = &resolved.request.archive_sha256[..16];
        let outcome = predict_methods_archive_v2_matrix(
            &archive,
            MethodsArchiveMatrixPredictRequest {
                sample_ids: resolved.request.sample_ids.clone(),
                x: resolved.request.x.clone(),
                expected_target_names: resolved.request.expected_target_names.clone(),
                methods_library_path: self.methods.path.clone(),
                methods_library_sha256: self.methods.sha256.clone(),
                request_id: format!("request:studio.archive-v2:{identity}"),
                outcome_id: format!("outcome:studio.archive-v2:{identity}"),
                run_id: RunId::new(format!("run:studio.archive-v2:{identity}"))
                    .map_err(|_| ArchiveV2PredictionExecutorError::ExecutionFailed)?,
                warnings: Vec::new(),
                diagnostics: BTreeMap::from([(
                    "contract".into(),
                    Value::String("nirs4all.studio-archive-v2-prediction-contract.v1".into()),
                )]),
            },
        )
        .map_err(|_| ArchiveV2PredictionExecutorError::ExecutionFailed)?;
        let output = outcome
            .outputs
            .into_iter()
            .next()
            .ok_or(ArchiveV2PredictionExecutorError::ExecutionFailed)?;
        let prediction = output
            .predictions
            .into_iter()
            .next()
            .ok_or(ArchiveV2PredictionExecutorError::ExecutionFailed)?;
        Ok(ArchiveV2PredictionOutput {
            archive_id: archive.reference().archive_id().to_owned(),
            sample_ids: prediction
                .sample_ids
                .into_iter()
                .map(|sample_id| sample_id.as_str().to_owned())
                .collect(),
            target_names: prediction.target_names,
            values: prediction.values,
            provenance_executor: format!(
                "nirs4all-core@0.3.23+libn4m-abi-{}.{}:{}",
                self.methods.abi_major, self.methods.abi_minor, self.methods.sha256
            ),
        })
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ArchiveV2PredictionExecutorError {
    ExecutionFailed,
}

pub trait ArchiveV2PredictionExecutor: Debug + Send + Sync {
    fn is_selected(&self) -> bool;

    /// Execute one validated, content-addressed array request.
    ///
    /// # Errors
    ///
    /// Returns a closed executor error without exposing an implementation
    /// envelope to the Studio HTTP surface.
    fn execute(
        &self,
        request: &ResolvedArchiveV2PredictionRequest,
    ) -> Result<ArchiveV2PredictionOutput, ArchiveV2PredictionExecutorError>;
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ArchiveV2PredictionError {
    ExecutorUnavailable,
    BodyTooLarge,
    InvalidJson,
    InvalidShape(&'static str),
    Unsupported(&'static str),
    WorkspaceUnavailable,
    WorkspaceUnsafe,
    ArchiveNotFound,
    ArchiveUnsafe,
    ArchiveTooLarge,
    ArchiveDigestMismatch,
    ExecutionFailed,
    InvalidExecutorOutput,
    ResponseTooLarge,
}

#[derive(Debug)]
struct UnselectedArchiveV2PredictionExecutor;

impl ArchiveV2PredictionExecutor for UnselectedArchiveV2PredictionExecutor {
    fn is_selected(&self) -> bool {
        false
    }

    fn execute(
        &self,
        _request: &ResolvedArchiveV2PredictionRequest,
    ) -> Result<ArchiveV2PredictionOutput, ArchiveV2PredictionExecutorError> {
        Err(ArchiveV2PredictionExecutorError::ExecutionFailed)
    }
}

#[derive(Debug)]
pub struct ArchiveV2PredictionRuntime {
    executor: Arc<dyn ArchiveV2PredictionExecutor>,
}

impl Default for ArchiveV2PredictionRuntime {
    fn default() -> Self {
        packaged_methods_library_identity()
            .and_then(|identity| CoreArchiveV2PredictionExecutor::acquire(identity).ok())
            .map_or_else(
                || Self {
                    executor: Arc::new(UnselectedArchiveV2PredictionExecutor),
                },
                |executor| Self {
                    executor: Arc::new(executor),
                },
            )
    }
}

impl ArchiveV2PredictionRuntime {
    #[must_use]
    pub fn is_selected(&self) -> bool {
        self.executor.is_selected()
    }

    #[cfg(test)]
    #[must_use]
    pub(crate) fn with_executor(executor: Arc<dyn ArchiveV2PredictionExecutor>) -> Self {
        Self { executor }
    }

    /// Resolve, read, hash, execute, and project one already validated request.
    ///
    /// # Errors
    ///
    /// Refuses an unselected executor, unsafe workspace/export paths, changed
    /// archive bytes, executor errors, and any output outside the frozen V1
    /// response contract.
    pub fn execute(
        &self,
        request: ArchiveV2PredictionRequest,
        workspace_path: &Path,
    ) -> Result<String, ArchiveV2PredictionError> {
        if !self.is_selected() {
            return Err(ArchiveV2PredictionError::ExecutorUnavailable);
        }
        let archive_bytes = read_archive(workspace_path, &request)?;
        let resolved = ResolvedArchiveV2PredictionRequest {
            request,
            archive_bytes,
        };
        let output = self
            .executor
            .execute(&resolved)
            .map_err(|_| ArchiveV2PredictionError::ExecutionFailed)?;
        project_response(&resolved.request, &output)
    }
}

fn packaged_methods_library_identity() -> Option<PackagedMethodsLibraryIdentity> {
    let executable = std::env::current_exe().ok()?;
    let native_directory = executable.parent()?;
    let backend_root = native_directory.parent()?;
    let contract_path = native_directory.join(PACKAGED_RUNTIME_CONTRACT);
    let metadata = fs::symlink_metadata(&contract_path).ok()?;
    if metadata.file_type().is_symlink()
        || !metadata.is_file()
        || metadata.len() > MAX_RUNTIME_CONTRACT_BYTES
    {
        return None;
    }
    let mut contract_file = fs::File::open(&contract_path).ok()?;
    let opened = contract_file.metadata().ok()?;
    if !opened.is_file() || opened.len() != metadata.len() {
        return None;
    }
    let mut bytes = Vec::new();
    contract_file
        .by_ref()
        .take(MAX_RUNTIME_CONTRACT_BYTES + 1)
        .read_to_end(&mut bytes)
        .ok()?;
    if u64::try_from(bytes.len()).ok()? > MAX_RUNTIME_CONTRACT_BYTES {
        return None;
    }
    let contract: Value = serde_json::from_slice(&bytes).ok()?;
    let root = contract.as_object()?;
    if root.get("schema").and_then(Value::as_str) != Some("nirs4all.studio-packaged-runtime.v1")
        || root.get("product_backend").and_then(Value::as_str) != Some("rust-sidecar")
    {
        return None;
    }
    let methods = root.get("methods_library")?.as_object()?;
    if methods.len() != 3 || methods.get("mode").and_then(Value::as_str) != Some("bundled-required")
    {
        return None;
    }
    let member = methods.get("member")?.as_object()?;
    if member.len() != 3 {
        return None;
    }
    let expected_relative = packaged_methods_library_relative_path();
    let member_path = member.get("path")?.as_str()?;
    if member_path != expected_relative {
        return None;
    }
    let abi = methods.get("abi")?.as_object()?;
    if abi.len() != 2 {
        return None;
    }
    Some(PackagedMethodsLibraryIdentity {
        path: backend_root.join(Path::new(member_path)),
        size: member.get("size")?.as_u64()?,
        sha256: member.get("sha256")?.as_str()?.to_owned(),
        abi_major: u32::try_from(abi.get("major")?.as_u64()?).ok()?,
        abi_minor: u32::try_from(abi.get("minor")?.as_u64()?).ok()?,
    })
}

const fn packaged_methods_library_relative_path() -> &'static str {
    #[cfg(target_os = "windows")]
    {
        "native/n4m.dll"
    }
    #[cfg(target_os = "macos")]
    {
        "native/libn4m.dylib"
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        "native/libn4m.so"
    }
}

/// Parse the exact array-only V1 request without resolving workspace state.
///
/// # Errors
///
/// Refuses oversized, malformed, open-ended, path-based, fallback-enabled, or
/// over-capacity requests.
pub fn parse_request(body: &[u8]) -> Result<ArchiveV2PredictionRequest, ArchiveV2PredictionError> {
    if body.len() > MAX_PREDICTION_BODY_BYTES {
        return Err(ArchiveV2PredictionError::BodyTooLarge);
    }
    let value: Value =
        serde_json::from_slice(body).map_err(|_| ArchiveV2PredictionError::InvalidJson)?;
    let root = exact_object(
        &value,
        &[
            "schema_version",
            "operation",
            "workspace_id",
            "archive",
            "input",
            "execution",
        ],
        "request root must contain only the frozen V1 fields",
    )?;
    if root.get("schema_version").and_then(Value::as_u64) != Some(1) {
        return Err(ArchiveV2PredictionError::Unsupported(
            "schema_version must be 1",
        ));
    }
    if root.get("operation").and_then(Value::as_str) != Some("archive_v2_predict") {
        return Err(ArchiveV2PredictionError::Unsupported(
            "operation must be archive_v2_predict",
        ));
    }
    let workspace_id = required_id(root, "workspace_id")?;
    let archive = exact_object(
        root.get("archive")
            .ok_or(ArchiveV2PredictionError::InvalidShape(
                "archive is required",
            ))?,
        &["ref", "sha256"],
        "archive must contain only ref and sha256",
    )?;
    let archive_ref = archive
        .get("ref")
        .and_then(Value::as_str)
        .filter(|value| valid_archive_ref(value))
        .ok_or(ArchiveV2PredictionError::InvalidShape(
            "archive.ref must be a safe relative .n4a path",
        ))?
        .to_owned();
    let archive_sha256 = archive
        .get("sha256")
        .and_then(Value::as_str)
        .filter(|value| valid_sha256(value))
        .ok_or(ArchiveV2PredictionError::InvalidShape(
            "archive.sha256 must be lowercase hexadecimal SHA-256",
        ))?
        .to_owned();
    let input = exact_object(
        root.get("input")
            .ok_or(ArchiveV2PredictionError::InvalidShape("input is required"))?,
        &["kind", "sample_ids", "x", "expected_target_names"],
        "input must contain only kind, sample_ids, x, and expected_target_names",
    )?;
    if input.get("kind").and_then(Value::as_str) != Some("array") {
        return Err(ArchiveV2PredictionError::Unsupported(
            "input.kind must be array",
        ));
    }
    let sample_ids = string_ids(input, "sample_ids", MAX_SAMPLES)?;
    let expected_target_names = string_ids(input, "expected_target_names", MAX_TARGETS)?;
    let x = matrix(input.get("x"), sample_ids.len())?;
    let execution = exact_object(
        root.get("execution")
            .ok_or(ArchiveV2PredictionError::InvalidShape(
                "execution is required",
            ))?,
        &["engine", "allow_fallback"],
        "execution must contain only engine and allow_fallback",
    )?;
    if execution.get("engine").and_then(Value::as_str) != Some("core_rust_methods") {
        return Err(ArchiveV2PredictionError::Unsupported(
            "execution.engine must be core_rust_methods",
        ));
    }
    if execution.get("allow_fallback").and_then(Value::as_bool) != Some(false) {
        return Err(ArchiveV2PredictionError::Unsupported(
            "execution.allow_fallback must be false",
        ));
    }
    Ok(ArchiveV2PredictionRequest {
        workspace_id,
        archive_ref,
        archive_sha256,
        sample_ids,
        x,
        expected_target_names,
    })
}

fn exact_object<'a>(
    value: &'a Value,
    fields: &[&str],
    detail: &'static str,
) -> Result<&'a Map<String, Value>, ArchiveV2PredictionError> {
    let object = value
        .as_object()
        .ok_or(ArchiveV2PredictionError::InvalidShape(detail))?;
    if object.len() != fields.len() || fields.iter().any(|field| !object.contains_key(*field)) {
        return Err(ArchiveV2PredictionError::InvalidShape(detail));
    }
    Ok(object)
}

fn required_id(
    object: &Map<String, Value>,
    field: &'static str,
) -> Result<String, ArchiveV2PredictionError> {
    object
        .get(field)
        .and_then(Value::as_str)
        .filter(|value| valid_id(value))
        .map(str::to_owned)
        .ok_or(ArchiveV2PredictionError::InvalidShape(
            "workspace_id must be a bounded identifier",
        ))
}

fn string_ids(
    object: &Map<String, Value>,
    field: &'static str,
    maximum: usize,
) -> Result<Vec<String>, ArchiveV2PredictionError> {
    let values = object
        .get(field)
        .and_then(Value::as_array)
        .filter(|values| !values.is_empty() && values.len() <= maximum)
        .ok_or(ArchiveV2PredictionError::InvalidShape(
            "identifier array is empty or exceeds its cap",
        ))?;
    let mut result = Vec::with_capacity(values.len());
    let mut unique = BTreeSet::new();
    for value in values {
        let value = value.as_str().filter(|value| valid_id(value)).ok_or(
            ArchiveV2PredictionError::InvalidShape("identifier array contains an invalid value"),
        )?;
        if !unique.insert(value) {
            return Err(ArchiveV2PredictionError::InvalidShape(
                "identifier arrays must contain unique values",
            ));
        }
        result.push(value.to_owned());
    }
    Ok(result)
}

fn matrix(
    value: Option<&Value>,
    samples: usize,
) -> Result<Vec<Vec<f64>>, ArchiveV2PredictionError> {
    let rows = value
        .and_then(Value::as_array)
        .filter(|rows| rows.len() == samples)
        .ok_or(ArchiveV2PredictionError::InvalidShape(
            "input.x rows must align with sample_ids",
        ))?;
    let mut result = Vec::with_capacity(rows.len());
    let mut width = None;
    for row in rows {
        let row = row
            .as_array()
            .filter(|row| !row.is_empty() && row.len() <= MAX_FEATURES)
            .ok_or(ArchiveV2PredictionError::InvalidShape(
                "input.x must be a non-empty bounded matrix",
            ))?;
        if width
            .replace(row.len())
            .is_some_and(|expected| expected != row.len())
        {
            return Err(ArchiveV2PredictionError::InvalidShape(
                "input.x must be rectangular",
            ));
        }
        let values = row
            .iter()
            .map(|value| {
                value.as_f64().filter(|value| value.is_finite()).ok_or(
                    ArchiveV2PredictionError::InvalidShape(
                        "input.x must contain only finite JSON numbers",
                    ),
                )
            })
            .collect::<Result<Vec<_>, _>>()?;
        result.push(values);
    }
    let features = width.unwrap_or(0);
    if samples.saturating_mul(features) > MAX_CELLS {
        return Err(ArchiveV2PredictionError::InvalidShape(
            "input.x exceeds the cell cap",
        ));
    }
    Ok(result)
}

fn valid_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= MAX_ID_BYTES
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b':'))
}

fn valid_archive_ref(value: &str) -> bool {
    if value.is_empty() || value.len() > MAX_ARCHIVE_REF_BYTES || value.contains('\\') {
        return false;
    }
    let path = Path::new(value);
    if path.extension().and_then(|extension| extension.to_str()) != Some("n4a") {
        return false;
    }
    !path.is_absolute()
        && path.components().all(|component| {
            matches!(component, Component::Normal(value) if value.to_str().is_some_and(valid_id))
        })
}

fn valid_sha256(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

#[cfg(unix)]
fn stable_std_cap_identity(
    std_metadata: &fs::Metadata,
    cap_metadata: &cap_std::fs::Metadata,
) -> bool {
    std_metadata.dev() == cap_metadata.dev() && std_metadata.ino() == cap_metadata.ino()
}

#[cfg(not(unix))]
fn stable_std_cap_identity(
    std_metadata: &fs::Metadata,
    cap_metadata: &cap_std::fs::Metadata,
) -> bool {
    std_metadata.file_type().is_file() == cap_metadata.file_type().is_file()
        && std_metadata.file_type().is_dir() == cap_metadata.file_type().is_dir()
        && std_metadata.len() == cap_metadata.len()
}

#[cfg(unix)]
fn stable_cap_identity(left: &cap_std::fs::Metadata, right: &cap_std::fs::Metadata) -> bool {
    left.dev() == right.dev() && left.ino() == right.ino()
}

#[cfg(not(unix))]
fn stable_cap_identity(left: &cap_std::fs::Metadata, right: &cap_std::fs::Metadata) -> bool {
    left.file_type().is_file() == right.file_type().is_file()
        && left.file_type().is_dir() == right.file_type().is_dir()
        && left.len() == right.len()
}

fn open_workspace(path: &Path) -> Result<Dir, ArchiveV2PredictionError> {
    if !path.is_absolute() {
        return Err(ArchiveV2PredictionError::WorkspaceUnsafe);
    }
    let before =
        fs::symlink_metadata(path).map_err(|_| ArchiveV2PredictionError::WorkspaceUnavailable)?;
    if before.file_type().is_symlink() || !before.is_dir() {
        return Err(ArchiveV2PredictionError::WorkspaceUnsafe);
    }
    let opened = Dir::open_ambient_dir(path, ambient_authority())
        .map_err(|_| ArchiveV2PredictionError::WorkspaceUnavailable)?;
    let opened_metadata = opened
        .dir_metadata()
        .map_err(|_| ArchiveV2PredictionError::WorkspaceUnsafe)?;
    let after =
        fs::symlink_metadata(path).map_err(|_| ArchiveV2PredictionError::WorkspaceUnsafe)?;
    if after.file_type().is_symlink()
        || !after.is_dir()
        || !stable_std_cap_identity(&before, &opened_metadata)
        || !stable_std_cap_identity(&after, &opened_metadata)
    {
        return Err(ArchiveV2PredictionError::WorkspaceUnsafe);
    }
    Ok(opened)
}

fn open_child_directory(
    directory: &Dir,
    component: &Path,
) -> Result<Dir, ArchiveV2PredictionError> {
    let before = directory
        .symlink_metadata(component)
        .map_err(|_| ArchiveV2PredictionError::ArchiveNotFound)?;
    if before.file_type().is_symlink() || !before.is_dir() {
        return Err(ArchiveV2PredictionError::ArchiveUnsafe);
    }
    let opened = directory
        .open_dir(component)
        .map_err(|_| ArchiveV2PredictionError::ArchiveUnsafe)?;
    let opened_metadata = opened
        .dir_metadata()
        .map_err(|_| ArchiveV2PredictionError::ArchiveUnsafe)?;
    let after = directory
        .symlink_metadata(component)
        .map_err(|_| ArchiveV2PredictionError::ArchiveUnsafe)?;
    if after.file_type().is_symlink()
        || !after.is_dir()
        || !stable_cap_identity(&before, &opened_metadata)
        || !stable_cap_identity(&after, &opened_metadata)
    {
        return Err(ArchiveV2PredictionError::ArchiveUnsafe);
    }
    Ok(opened)
}

fn read_archive(
    workspace_path: &Path,
    request: &ArchiveV2PredictionRequest,
) -> Result<Vec<u8>, ArchiveV2PredictionError> {
    let workspace = open_workspace(workspace_path)?;
    let mut directory = open_child_directory(&workspace, Path::new("exports"))?;
    let components = Path::new(&request.archive_ref)
        .components()
        .map(|component| match component {
            Component::Normal(value) => Ok(value.to_owned()),
            _ => Err(ArchiveV2PredictionError::ArchiveUnsafe),
        })
        .collect::<Result<Vec<_>, _>>()?;
    let (file_name, parents) = components
        .split_last()
        .ok_or(ArchiveV2PredictionError::ArchiveUnsafe)?;
    for parent in parents {
        directory = open_child_directory(&directory, Path::new(parent))?;
    }
    let before = directory
        .symlink_metadata(file_name)
        .map_err(|_| ArchiveV2PredictionError::ArchiveNotFound)?;
    if before.file_type().is_symlink() || !before.is_file() {
        return Err(ArchiveV2PredictionError::ArchiveUnsafe);
    }
    if before.len() > MAX_ARCHIVE_BYTES {
        return Err(ArchiveV2PredictionError::ArchiveTooLarge);
    }
    let mut file = directory
        .open(file_name)
        .map_err(|_| ArchiveV2PredictionError::ArchiveUnsafe)?
        .into_std();
    let opened = file
        .metadata()
        .map_err(|_| ArchiveV2PredictionError::ArchiveUnsafe)?;
    if !opened.is_file() {
        return Err(ArchiveV2PredictionError::ArchiveUnsafe);
    }
    let after_open = directory
        .symlink_metadata(file_name)
        .map_err(|_| ArchiveV2PredictionError::ArchiveUnsafe)?;
    if after_open.file_type().is_symlink()
        || !after_open.is_file()
        || !stable_std_cap_identity(&opened, &before)
        || !stable_std_cap_identity(&opened, &after_open)
    {
        return Err(ArchiveV2PredictionError::ArchiveUnsafe);
    }
    if opened.len() > MAX_ARCHIVE_BYTES {
        return Err(ArchiveV2PredictionError::ArchiveTooLarge);
    }
    let mut bytes = Vec::with_capacity(usize::try_from(opened.len()).unwrap_or(0).min(64 * 1024));
    Read::by_ref(&mut file)
        .take(MAX_ARCHIVE_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| ArchiveV2PredictionError::ArchiveUnsafe)?;
    if u64::try_from(bytes.len()).unwrap_or(u64::MAX) > MAX_ARCHIVE_BYTES {
        return Err(ArchiveV2PredictionError::ArchiveTooLarge);
    }
    let after_read = file
        .metadata()
        .map_err(|_| ArchiveV2PredictionError::ArchiveUnsafe)?;
    let final_path = directory
        .symlink_metadata(file_name)
        .map_err(|_| ArchiveV2PredictionError::ArchiveUnsafe)?;
    if final_path.file_type().is_symlink()
        || !final_path.is_file()
        || after_read.len() != opened.len()
        || !stable_std_cap_identity(&after_read, &final_path)
        || !stable_std_cap_identity(&opened, &final_path)
    {
        return Err(ArchiveV2PredictionError::ArchiveUnsafe);
    }
    let actual = format!("{:x}", Sha256::digest(&bytes));
    if actual != request.archive_sha256 {
        return Err(ArchiveV2PredictionError::ArchiveDigestMismatch);
    }
    Ok(bytes)
}

fn attest_regular_file(
    path: &Path,
    expected_size: u64,
    expected_sha256: &str,
    maximum: u64,
) -> Result<(), ()> {
    if !path.is_absolute() || !valid_sha256(expected_sha256) {
        return Err(());
    }
    let before = fs::symlink_metadata(path).map_err(|_| ())?;
    if before.file_type().is_symlink()
        || !before.is_file()
        || before.len() != expected_size
        || before.len() > maximum
    {
        return Err(());
    }
    let mut file = fs::File::open(path).map_err(|_| ())?;
    let opened = file.metadata().map_err(|_| ())?;
    let after_open = fs::symlink_metadata(path).map_err(|_| ())?;
    #[cfg(unix)]
    if before.dev() != opened.dev()
        || before.ino() != opened.ino()
        || after_open.dev() != opened.dev()
        || after_open.ino() != opened.ino()
    {
        return Err(());
    }
    if after_open.file_type().is_symlink()
        || !after_open.is_file()
        || opened.len() > maximum
        || after_open.len() != opened.len()
    {
        return Err(());
    }
    let mut bytes_read = 0_u64;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 16 * 1024];
    loop {
        let count = file.read(&mut buffer).map_err(|_| ())?;
        if count == 0 {
            break;
        }
        bytes_read = bytes_read.saturating_add(u64::try_from(count).map_err(|_| ())?);
        if bytes_read > maximum {
            return Err(());
        }
        hasher.update(&buffer[..count]);
    }
    let after_read = file.metadata().map_err(|_| ())?;
    let final_path = fs::symlink_metadata(path).map_err(|_| ())?;
    #[cfg(unix)]
    if final_path.dev() != opened.dev()
        || final_path.ino() != opened.ino()
        || after_read.dev() != opened.dev()
        || after_read.ino() != opened.ino()
    {
        return Err(());
    }
    if final_path.file_type().is_symlink()
        || !final_path.is_file()
        || after_read.len() != bytes_read
        || final_path.len() != bytes_read
        || format!("{:x}", hasher.finalize()) != expected_sha256
    {
        return Err(());
    }
    Ok(())
}

fn project_response(
    request: &ArchiveV2PredictionRequest,
    output: &ArchiveV2PredictionOutput,
) -> Result<String, ArchiveV2PredictionError> {
    if !valid_id(&output.archive_id)
        || output.sample_ids != request.sample_ids
        || output.target_names != request.expected_target_names
        || output.provenance_executor.is_empty()
        || output.provenance_executor.len() > MAX_PROVENANCE_EXECUTOR_BYTES
        || output.values.len() != request.sample_ids.len()
        || output.values.iter().any(|row| {
            row.len() != request.expected_target_names.len()
                || row.iter().any(|value| !value.is_finite())
        })
    {
        return Err(ArchiveV2PredictionError::InvalidExecutorOutput);
    }
    let response = json!({
        "schema_version": 1,
        "operation": "archive_v2_predict",
        "archive_id": output.archive_id,
        "archive_sha256": request.archive_sha256,
        "engine": "core_rust_methods",
        "fallback_used": false,
        "sample_ids": output.sample_ids,
        "target_names": output.target_names,
        "values": output.values,
        "provenance": {
            "executor": output.provenance_executor,
            "archive_ref": request.archive_ref,
            "workspace_id": request.workspace_id,
        },
    })
    .to_string();
    if response.len() > MAX_PREDICTION_RESPONSE_BYTES {
        return Err(ArchiveV2PredictionError::ResponseTooLarge);
    }
    Ok(response)
}

#[cfg(test)]
mod tests {
    use std::{fs, time::SystemTime};

    use super::*;

    #[derive(Debug)]
    struct FakeExecutor;

    impl ArchiveV2PredictionExecutor for FakeExecutor {
        fn is_selected(&self) -> bool {
            true
        }

        fn execute(
            &self,
            request: &ResolvedArchiveV2PredictionRequest,
        ) -> Result<ArchiveV2PredictionOutput, ArchiveV2PredictionExecutorError> {
            assert_eq!(request.archive_bytes, b"archive-v2-bytes");
            Ok(ArchiveV2PredictionOutput {
                archive_id: "archive-a".into(),
                sample_ids: request.request.sample_ids.clone(),
                target_names: request.request.expected_target_names.clone(),
                values: vec![vec![1.5, 13.0], vec![2.5, 15.0]],
                provenance_executor: "fake-core-unit-only".into(),
            })
        }
    }

    fn root(name: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!(
            "studio-archive-v2-{name}-{}-{nonce}",
            std::process::id()
        ))
    }

    fn request(archive_sha256: &str) -> Vec<u8> {
        json!({
            "schema_version": 1,
            "operation": "archive_v2_predict",
            "workspace_id": "workspace-a",
            "archive": {"ref": "models/model-a.n4a", "sha256": archive_sha256},
            "input": {
                "kind": "array",
                "sample_ids": ["s1", "s2"],
                "x": [[1.0, 2.0], [3.0, 4.0]],
                "expected_target_names": ["protein", "moisture"]
            },
            "execution": {"engine": "core_rust_methods", "allow_fallback": false}
        })
        .to_string()
        .into_bytes()
    }

    #[test]
    fn fake_executor_proves_validation_resolution_and_closed_projection() {
        let root = root("success");
        let archive = root.join("exports/models/model-a.n4a");
        fs::create_dir_all(archive.parent().unwrap()).unwrap();
        fs::write(&archive, b"archive-v2-bytes").unwrap();
        let digest = format!("{:x}", Sha256::digest(b"archive-v2-bytes"));
        let parsed = parse_request(&request(&digest)).unwrap();
        let runtime = ArchiveV2PredictionRuntime::with_executor(Arc::new(FakeExecutor));

        let response: Value =
            serde_json::from_str(&runtime.execute(parsed, &root).unwrap()).unwrap();

        assert_eq!(
            response
                .as_object()
                .unwrap()
                .keys()
                .cloned()
                .collect::<BTreeSet<_>>(),
            BTreeSet::from([
                "archive_id".into(),
                "archive_sha256".into(),
                "engine".into(),
                "fallback_used".into(),
                "operation".into(),
                "provenance".into(),
                "sample_ids".into(),
                "schema_version".into(),
                "target_names".into(),
                "values".into(),
            ])
        );
        assert_eq!(response["target_names"], json!(["protein", "moisture"]));
        assert_eq!(response["values"], json!([[1.5, 13.0], [2.5, 15.0]]));
        assert_eq!(response["fallback_used"], false);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn parser_is_array_only_closed_and_bounded() {
        let digest = "0".repeat(64);
        let mut open: Value = serde_json::from_slice(&request(&digest)).unwrap();
        open.as_object_mut()
            .unwrap()
            .insert("path".into(), json!("/tmp/x"));
        assert!(matches!(
            parse_request(open.to_string().as_bytes()),
            Err(ArchiveV2PredictionError::InvalidShape(_))
        ));

        let mut file_input: Value = serde_json::from_slice(&request(&digest)).unwrap();
        file_input["input"]["kind"] = json!("file");
        assert!(matches!(
            parse_request(file_input.to_string().as_bytes()),
            Err(ArchiveV2PredictionError::Unsupported(_))
        ));

        let mut fallback: Value = serde_json::from_slice(&request(&digest)).unwrap();
        fallback["execution"]["allow_fallback"] = json!(true);
        assert!(matches!(
            parse_request(fallback.to_string().as_bytes()),
            Err(ArchiveV2PredictionError::Unsupported(_))
        ));
    }

    #[test]
    fn parser_enforces_every_array_and_identity_cap() {
        assert_eq!(
            parse_request(&vec![b' '; MAX_PREDICTION_BODY_BYTES + 1]),
            Err(ArchiveV2PredictionError::BodyTooLarge)
        );
        let digest = "0".repeat(64);
        let base: Value = serde_json::from_slice(&request(&digest)).unwrap();

        for archive_ref in ["/absolute/model.n4a", "../model.n4a", "models/../model.n4a"] {
            let mut value = base.clone();
            value["archive"]["ref"] = json!(archive_ref);
            assert!(matches!(
                parse_request(value.to_string().as_bytes()),
                Err(ArchiveV2PredictionError::InvalidShape(_))
            ));
        }

        let mut identifiers = base.clone();
        identifiers["input"]["sample_ids"] = Value::Array(
            (0..=MAX_SAMPLES)
                .map(|index| json!(format!("sample-{index}")))
                .collect(),
        );
        identifiers["input"]["x"] = Value::Array((0..=MAX_SAMPLES).map(|_| json!([1.0])).collect());
        assert!(matches!(
            parse_request(identifiers.to_string().as_bytes()),
            Err(ArchiveV2PredictionError::InvalidShape(_))
        ));

        let mut features = base.clone();
        features["input"]["x"] = json!([vec![0.0; MAX_FEATURES + 1], vec![0.0; MAX_FEATURES + 1]]);
        assert!(matches!(
            parse_request(features.to_string().as_bytes()),
            Err(ArchiveV2PredictionError::InvalidShape(_))
        ));

        let mut cells = base.clone();
        let samples = 65;
        cells["input"]["sample_ids"] = Value::Array(
            (0..samples)
                .map(|index| json!(format!("sample-{index}")))
                .collect(),
        );
        cells["input"]["x"] = json!(vec![vec![0; 253]; samples]);
        assert!(cells.to_string().len() <= MAX_PREDICTION_BODY_BYTES);
        assert!(matches!(
            parse_request(cells.to_string().as_bytes()),
            Err(ArchiveV2PredictionError::InvalidShape(
                "input.x exceeds the cell cap"
            ))
        ));

        let mut targets = base.clone();
        targets["input"]["expected_target_names"] = Value::Array(
            (0..=MAX_TARGETS)
                .map(|index| json!(format!("target-{index}")))
                .collect(),
        );
        assert!(matches!(
            parse_request(targets.to_string().as_bytes()),
            Err(ArchiveV2PredictionError::InvalidShape(_))
        ));

        let mut oversized_id = base;
        oversized_id["workspace_id"] = json!("x".repeat(MAX_ID_BYTES + 1));
        assert!(matches!(
            parse_request(oversized_id.to_string().as_bytes()),
            Err(ArchiveV2PredictionError::InvalidShape(_))
        ));
    }

    #[test]
    fn resolver_rejects_digest_mismatch_and_symlink() {
        let root = root("unsafe");
        fs::create_dir_all(root.join("exports")).unwrap();
        fs::write(root.join("outside.n4a"), b"archive-v2-bytes").unwrap();
        let digest = format!("{:x}", Sha256::digest(b"archive-v2-bytes"));
        let runtime = ArchiveV2PredictionRuntime::with_executor(Arc::new(FakeExecutor));

        let mismatched = parse_request(&request(&"0".repeat(64))).unwrap();
        fs::create_dir_all(root.join("exports/models")).unwrap();
        fs::write(root.join("exports/models/model-a.n4a"), b"archive-v2-bytes").unwrap();
        assert_eq!(
            runtime.execute(mismatched, &root),
            Err(ArchiveV2PredictionError::ArchiveDigestMismatch)
        );

        fs::remove_file(root.join("exports/models/model-a.n4a")).unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink(
            root.join("outside.n4a"),
            root.join("exports/models/model-a.n4a"),
        )
        .unwrap();
        #[cfg(unix)]
        assert_eq!(
            runtime.execute(parse_request(&request(&digest)).unwrap(), &root),
            Err(ArchiveV2PredictionError::ArchiveUnsafe)
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn resolver_refuses_oversized_archive_before_reading_or_execution() {
        let root = root("too-large");
        let archive = root.join("exports/models/model-a.n4a");
        fs::create_dir_all(archive.parent().unwrap()).unwrap();
        fs::File::create(&archive)
            .unwrap()
            .set_len(MAX_ARCHIVE_BYTES + 1)
            .unwrap();
        let runtime = ArchiveV2PredictionRuntime::with_executor(Arc::new(FakeExecutor));
        let parsed = parse_request(&request(&"0".repeat(64))).unwrap();

        assert_eq!(
            runtime.execute(parsed, &root),
            Err(ArchiveV2PredictionError::ArchiveTooLarge)
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn inode_identity_gate_detects_same_size_path_replacement() {
        let root = root("inode-swap");
        fs::create_dir_all(root.join("exports")).unwrap();
        fs::write(root.join("exports/before.n4a"), b"same-size-a").unwrap();
        fs::write(root.join("exports/after.n4a"), b"same-size-b").unwrap();
        let directory = Dir::open_ambient_dir(root.join("exports"), ambient_authority()).unwrap();
        let before = directory.symlink_metadata("before.n4a").unwrap();
        let opened_after = directory.open("after.n4a").unwrap().into_std();
        let opened_after = opened_after.metadata().unwrap();

        assert!(!stable_std_cap_identity(&opened_after, &before));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn concrete_executor_refuses_wrong_packaged_abi_before_selection() {
        let error = CoreArchiveV2PredictionExecutor::acquire(PackagedMethodsLibraryIdentity {
            path: PathBuf::from("/must-not-open-libn4m"),
            size: 0,
            sha256: "0".repeat(64),
            abi_major: METHODS_ABI_MAJOR,
            abi_minor: METHODS_ABI_MINOR + 1,
        })
        .unwrap_err();
        assert_eq!(error, ArchiveV2PredictionExecutorError::ExecutionFailed);
    }

    #[test]
    fn frozen_contract_records_caps_and_conditional_product_selection() {
        let contract: Value = serde_json::from_str(include_str!(
            "../contracts/studio_archive_v2_prediction_v1.json"
        ))
        .unwrap();

        assert_eq!(contract["route"]["path"], ARCHIVE_V2_PREDICTION_ROUTE);
        assert_eq!(
            contract["route"]["selection"],
            "conditional_on_attested_packaged_closure"
        );
        assert_eq!(
            contract["route"]["without_attested_packaged_closure"]["status"],
            503
        );
        assert_eq!(
            contract["route"]["without_attested_packaged_closure"]["capability"],
            false
        );
        assert_eq!(
            contract["route"]["with_attested_packaged_closure"]["success_status"],
            200
        );
        assert_eq!(
            contract["route"]["with_attested_packaged_closure"]["capability"],
            true
        );
        assert_eq!(
            contract["request"]["maximum_encoded_bytes"],
            MAX_PREDICTION_BODY_BYTES
        );
        assert_eq!(
            contract["archive_resolution"]["maximum_bytes"],
            MAX_ARCHIVE_BYTES
        );
        assert_eq!(
            contract["success_response"]["maximum_encoded_bytes"],
            MAX_PREDICTION_RESPONSE_BYTES
        );
        assert_eq!(
            contract["executor_boundary"]["selection"],
            "packaged_runtime_contract_plus_successful_core_preflight"
        );
        assert_eq!(contract["executor_boundary"]["python_http_owner"], false);
        assert_eq!(contract["executor_boundary"]["fastapi_fallback"], false);
    }
}
