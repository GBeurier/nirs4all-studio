//! Native, fail-closed STORE-001 archive V1 storage slice.
//!
//! The wire contract is owned by dag-ml (`docs/contracts/archive-v1`), whose
//! frozen writer id deliberately names this aggregate.  This module consumes
//! that declared V1 profile; it does not define a second manifest schema or a
//! legacy `.n4a` reader.  The narrow implementation writes/reads stored ZIP
//! members only.  Compressed, legacy, future-version, signed and host-sidecar
//! execution paths are rejected until their owning capabilities are available.

#[cfg(test)]
use std::cell::RefCell;
use std::collections::{BTreeMap, BTreeSet};
use std::fmt;
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use serde_json::{Map, Value};
use sha2::{Digest, Sha256};
use unicode_normalization::UnicodeNormalization;

use crate::durability::sync_directory;

const PROFILE: &str = "nirs4all.archive_workspace.v1";
const WRITER_ID: &str = "nirs4all-core.archive_workspace_writer.v1";
const MANIFEST_MEMBER: &str = "manifest.json";
const MAX_ENTRIES: usize = 256;
const MAX_MEMBER_BYTES: usize = 134_217_728;
/// The DAG-ML V1 dispatch bootstrap budget. Keep this separate from the
/// payload-member limit: the reader must bound the manifest before loading it.
const MAX_MANIFEST_BYTES: usize = 1_048_576;
/// Kept deliberately below serde_json's recursion guard. The structural scan
/// runs before deserialization, so this is a stack-safe V1 dispatch limit for
/// every nested object and array (including duplicate-key scanning).
const MAX_MANIFEST_JSON_NESTING: usize = 64;
const MAX_TOTAL_BYTES: usize = 536_870_912;
// This is an on-disk allocation guard, not a second wire budget. The frozen
// physical budget is the sum of every central-directory uncompressed size,
// including manifest.json; ZIP framing can make the file itself larger.
const MAX_ARCHIVE_BYTES: usize = MAX_TOTAL_BYTES + (MAX_ENTRIES * (MAX_ZIP_NAME_BYTES + 76)) + 22;
const MAX_ZIP_NAME_BYTES: usize = 4_096;
const MAX_TEMP_ATTEMPTS: u64 = 64;
const PORTABLE_PACKAGE_SCHEMA: &str =
    "https://github.com/GBeurier/dag-ml/schemas/portable_predictor_package.v1.schema.json";
const GRAPH_SCHEMA: &str = "https://github.com/GBeurier/dag-ml/schemas/graph_spec.v1.schema.json";
const EXECUTION_BUNDLE_SCHEMA: &str =
    "https://github.com/GBeurier/dag-ml/schemas/execution_bundle.v2.schema.json";
const TRAINING_OUTCOME_SCHEMA: &str =
    "https://github.com/GBeurier/dag-ml/schemas/training_outcome.v2.schema.json";
const CACHE_SET_SCHEMA: &str =
    "https://github.com/GBeurier/dag-ml/schemas/prediction_cache_payload_set.v2.schema.json";
const SCORE_SET_SCHEMA: &str =
    "https://github.com/GBeurier/dag-ml/schemas/score_set.v2.schema.json";
const HISTORICAL_LEGACY_FIXTURE_SHA256: &str =
    "1a0f2806c2e5baab3ed95e2ac6a2e0a975af1dc9b6da35c0c103b5375b0e5ede";

static TEMP_SEQUENCE: AtomicU64 = AtomicU64::new(0);

#[cfg(test)]
thread_local! {
    static LOAD_AFTER_MANIFEST_HOOK: RefCell<Option<Box<dyn FnOnce()>>> = const { RefCell::new(None) };
    static LOAD_AFTER_PAYLOADS_HOOK: RefCell<Option<Box<dyn FnOnce()>>> = const { RefCell::new(None) };
}

/// A raw payload supplied by the producing DAG-ML/runtime port.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ArchivePayload {
    pub path: String,
    pub bytes: Vec<u8>,
}

/// V1 writer input. `manifest` is a declared DAG-ML STORE-001 manifest; raw
/// checksums and uncompressed sizes are derived from `payloads` immediately
/// before writing. Semantic fingerprints remain producer-owned declarations.
#[derive(Clone, Debug)]
pub struct ArchiveV1WriteRequest {
    pub manifest: Value,
    pub payloads: Vec<ArchivePayload>,
}

/// Stable reference returned after an atomic archive creation.
///
/// ```compile_fail
/// let mut reference: nirs4all::ArchiveReference = todo!();
/// reference.archive_sha256 = String::new();
/// ```
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ArchiveReference {
    pub(crate) archive_id: String,
    pub(crate) schema_version: u32,
    pub(crate) profile: String,
    pub(crate) archive_sha256: String,
    pub(crate) portable_predictor_member: String,
}

impl ArchiveReference {
    pub fn archive_id(&self) -> &str {
        &self.archive_id
    }

    pub fn schema_version(&self) -> u32 {
        self.schema_version
    }

    pub fn profile(&self) -> &str {
        &self.profile
    }

    pub fn archive_sha256(&self) -> &str {
        &self.archive_sha256
    }

    pub fn portable_predictor_member(&self) -> &str {
        &self.portable_predictor_member
    }
}

/// A loaded, integrity-checked V1 archive. It deliberately has no implicit
/// Python/legacy executor.
#[derive(Clone, Debug)]
pub struct LoadedArchiveV1 {
    reference: ArchiveReference,
    manifest: Value,
    payloads: BTreeMap<String, Vec<u8>>,
}

impl LoadedArchiveV1 {
    pub fn reference(&self) -> &ArchiveReference {
        &self.reference
    }

    pub fn manifest(&self) -> &Value {
        &self.manifest
    }

    pub fn portable_predictor_package(&self) -> Result<&[u8], ArchiveStoreError> {
        self.payloads
            .get(&self.reference.portable_predictor_member)
            .map(Vec::as_slice)
            .ok_or_else(|| {
                ArchiveStoreError::Integrity("portable predictor payload disappeared".into())
            })
    }

    /// STORE-001 stores a declared predictor package; this aggregate release has
    /// no native artifact executor. Refuse before inspecting inputs or invoking
    /// any legacy/Python backend.
    pub fn predict(
        &self,
        _rows: &[f64],
        _n_features: usize,
    ) -> Result<Vec<f64>, ArchiveStoreError> {
        Err(ArchiveStoreError::UnsupportedCapability(
            "archive V1 predictor execution requires a declared native artifact executor; nirs4all-core does not provide one".into(),
        ))
    }
}

#[derive(Debug)]
pub enum ArchiveStoreError {
    Io(std::io::Error),
    Format(String),
    Integrity(String),
    UnsupportedCapability(String),
    AlreadyExists(PathBuf),
    /// The archive is visible at `path`, but post-publication durability or
    /// temporary-file cleanup failed. Callers must not retry a write blindly.
    PublishedWithCleanupError {
        path: PathBuf,
        detail: String,
    },
}

impl fmt::Display for ArchiveStoreError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Io(error) => write!(f, "archive I/O error: {error}"),
            Self::Format(detail) => write!(f, "archive V1 format refusal: {detail}"),
            Self::Integrity(detail) => write!(f, "archive V1 integrity refusal: {detail}"),
            Self::UnsupportedCapability(detail) => {
                write!(f, "archive V1 unsupported capability: {detail}")
            }
            Self::AlreadyExists(path) => {
                write!(f, "archive target already exists: {}", path.display())
            }
            Self::PublishedWithCleanupError { path, detail } => write!(
                f,
                "archive was published at {} but final cleanup/durability failed: {detail}",
                path.display()
            ),
        }
    }
}

impl std::error::Error for ArchiveStoreError {}

impl From<std::io::Error> for ArchiveStoreError {
    fn from(error: std::io::Error) -> Self {
        Self::Io(error)
    }
}

/// Atomically create a new stored-ZIP archive. Existing targets are never
/// overwritten; callers must make an explicit retention/rotation decision.
pub fn write_archive_v1(
    path: &Path,
    request: ArchiveV1WriteRequest,
) -> Result<ArchiveReference, ArchiveStoreError> {
    let prepared = prepare_write(request)?;
    let bytes = write_stored_zip(&prepared.manifest, &prepared.payloads)?;
    let reference = ArchiveReference {
        archive_id: prepared.archive_id,
        schema_version: 1,
        profile: PROFILE.to_string(),
        archive_sha256: sha256_hex(&bytes),
        portable_predictor_member: prepared.portable_predictor_member,
    };
    atomic_create(path, &bytes)?;
    Ok(reference)
}

/// Load and verify a stored ZIP V1 archive without extracting to disk.
pub fn load_archive_v1(path: &Path) -> Result<LoadedArchiveV1, ArchiveStoreError> {
    let mut file = File::open(path)?;
    let initial_len = usize::try_from(file.metadata()?.len())
        .map_err(|_| ArchiveStoreError::Format("archive size exceeds platform limits".into()))?;
    validate_archive_size(initial_len)?;
    let archive_sha256 = sha256_file(&mut file, initial_len)?;
    // The bootstrap reads only bounded EOCD/central/local-header metadata, then
    // the manifest dispatch member. Payload bytes remain unopened until the
    // strict V1 manifest has selected this reader and passed compatibility.
    let preflight = preflight_zip_file(&mut file)?;
    if preflight.archive_len != initial_len {
        return Err(ArchiveStoreError::Format(
            "archive changed while being read".into(),
        ));
    }
    let manifest_entry = preflight
        .entries
        .iter()
        .find(|entry| entry.name == MANIFEST_MEMBER)
        .ok_or_else(|| {
            ArchiveStoreError::Format("ZIP dispatch member manifest.json is absent".into())
        })?;
    let manifest_bytes = read_zip_member(&mut file, manifest_entry)?;
    let manifest = parse_manifest_json(&manifest_bytes)?;
    #[cfg(test)]
    run_load_after_manifest_hook();
    let physical_paths = preflight
        .entries
        .iter()
        .map(|entry| entry.name.clone())
        .collect();
    validate_manifest_for_dispatch(manifest.clone(), &physical_paths)?;

    let entries = read_payload_members(&mut file, &preflight)?;
    #[cfg(test)]
    run_load_after_payloads_hook();
    if sha256_file(&mut file, preflight.archive_len)? != archive_sha256 {
        return Err(ArchiveStoreError::Format(
            "archive changed while being read".into(),
        ));
    }
    let verified = validate_manifest_and_payloads(manifest, entries, false)?;
    Ok(LoadedArchiveV1 {
        reference: ArchiveReference {
            archive_id: verified.archive_id,
            schema_version: 1,
            profile: PROFILE.to_string(),
            archive_sha256,
            portable_predictor_member: verified.portable_predictor_member,
        },
        manifest: verified.manifest,
        payloads: verified.payloads,
    })
}

#[derive(Clone, Debug)]
struct ZipEntry {
    name: String,
    crc: u32,
    local_offset: usize,
    data_start: usize,
    data_end: usize,
}

#[derive(Debug)]
struct ZipPreflight {
    archive_len: usize,
    entries: Vec<ZipEntry>,
}

#[cfg(test)]
fn run_load_after_payloads_hook() {
    LOAD_AFTER_PAYLOADS_HOOK.with(|hook| {
        if let Some(hook) = hook.borrow_mut().take() {
            hook();
        }
    });
}

#[cfg(test)]
fn run_load_after_manifest_hook() {
    LOAD_AFTER_MANIFEST_HOOK.with(|hook| {
        if let Some(hook) = hook.borrow_mut().take() {
            hook();
        }
    });
}

struct VerifiedArchive {
    manifest: Value,
    payloads: BTreeMap<String, Vec<u8>>,
    archive_id: String,
    portable_predictor_member: String,
}

/// Fully validated writer input, kept as a named type so every derived
/// integrity field travels together before publication.
struct PreparedWrite {
    manifest: Value,
    payloads: BTreeMap<String, Vec<u8>>,
    archive_id: String,
    portable_predictor_member: String,
}

fn prepare_write(request: ArchiveV1WriteRequest) -> Result<PreparedWrite, ArchiveStoreError> {
    let ArchiveV1WriteRequest { manifest, payloads } = request;
    prevalidate_writer_payloads(&payloads)?;
    let payloads = payloads
        .into_iter()
        .map(|payload| (payload.path, payload.bytes))
        .collect();
    let verified = validate_manifest_and_payloads(manifest, payloads, true)?;
    Ok(PreparedWrite {
        manifest: verified.manifest,
        payloads: verified.payloads,
        archive_id: verified.archive_id,
        portable_predictor_member: verified.portable_predictor_member,
    })
}

/// Validate user-owned payloads before building an owned lookup table. The
/// small V1 entry limit makes the reference-only duplicate scan preferable to
/// allocating a second collection before resource limits are known.
fn prevalidate_writer_payloads(payloads: &[ArchivePayload]) -> Result<(), ArchiveStoreError> {
    if payloads.len() > MAX_ENTRIES - 1 {
        return Err(ArchiveStoreError::Format(
            "payload entry count exceeds V1 budget before manifest validation".into(),
        ));
    }
    let mut total_payload_bytes = 0usize;
    for (index, payload) in payloads.iter().enumerate() {
        validate_member_path(&payload.path)?;
        if payload.path == MANIFEST_MEMBER {
            return Err(ArchiveStoreError::Format(
                "manifest.json is dispatch-only and cannot be inventoried".into(),
            ));
        }
        if payload.bytes.len() > MAX_MEMBER_BYTES {
            return Err(ArchiveStoreError::Format(format!(
                "payload `{}` exceeds V1 member budget",
                payload.path
            )));
        }
        if payloads[..index]
            .iter()
            .any(|previous| previous.path == payload.path)
        {
            return Err(ArchiveStoreError::Format(format!(
                "duplicate payload `{}`",
                payload.path
            )));
        }
        total_payload_bytes =
            checked_writer_payload_total(total_payload_bytes, payload.bytes.len())?;
    }
    Ok(())
}

fn checked_writer_payload_total(
    total: usize,
    additional: usize,
) -> Result<usize, ArchiveStoreError> {
    let total = total
        .checked_add(additional)
        .ok_or_else(|| ArchiveStoreError::Format("writer payload size overflow".into()))?;
    if total > MAX_TOTAL_BYTES {
        return Err(ArchiveStoreError::Format(
            "payload size exceeds V1 total budget before manifest validation".into(),
        ));
    }
    Ok(total)
}

/// Validate the manifest contract that selects this reader before opening any
/// payload. This deliberately repeats the final validation pass below: the
/// second pass binds the already-selected manifest to the bytes that were then
/// read and CRC/SHA verified.
fn validate_manifest_for_dispatch(
    mut manifest: Value,
    physical_paths: &BTreeSet<String>,
) -> Result<(), ArchiveStoreError> {
    let root = object_mut(&mut manifest, "manifest")?;
    require_known_keys(
        root,
        &[
            "schema_version",
            "profile",
            "archive_id",
            "persistence_kind",
            "writer",
            "reader_dispatch",
            "physical_profile",
            "replay",
            "payloads",
            "member_inventory",
            "migration_provenance",
            "security",
            "workspace",
            "extensions",
        ],
        "manifest",
    )?;
    require_required_keys(
        root,
        &[
            "schema_version",
            "profile",
            "archive_id",
            "persistence_kind",
            "writer",
            "reader_dispatch",
            "physical_profile",
            "replay",
            "payloads",
            "member_inventory",
            "migration_provenance",
            "security",
            "workspace",
        ],
        "manifest",
    )?;
    if root.get("schema_version").and_then(Value::as_u64) != Some(1)
        || root.get("profile").and_then(Value::as_str) != Some(PROFILE)
    {
        return Err(ArchiveStoreError::Format(
            "only archive/workspace schema_version=1 profile is readable".into(),
        ));
    }
    let persistence_kind = required_string(root, "persistence_kind", "manifest")?.to_string();
    if !matches!(
        persistence_kind.as_str(),
        "n4a_archive" | "workspace_snapshot"
    ) {
        return Err(ArchiveStoreError::Format(
            "manifest.persistence_kind is outside the frozen V1 schema".into(),
        ));
    }
    required_id(root, "archive_id", "manifest")?;
    let writer = object(root.get("writer"), "writer")?;
    require_exact_keys(
        writer,
        &["product_aggregate_owner", "canonical_writer_id"],
        "writer",
    )?;
    if writer
        .get("product_aggregate_owner")
        .and_then(Value::as_str)
        != Some("nirs4all-core")
        || writer.get("canonical_writer_id").and_then(Value::as_str) != Some(WRITER_ID)
    {
        return Err(ArchiveStoreError::Format(
            "manifest writer is not the declared nirs4all-core V1 writer".into(),
        ));
    }
    validate_dispatch(root.get("reader_dispatch"))?;
    validate_physical_profile(root.get("physical_profile"))?;
    if persistence_kind == "n4a_archive" && !root.get("workspace").is_some_and(Value::is_null) {
        return Err(ArchiveStoreError::Format(
            "n4a_archive V1 must have workspace=null".into(),
        ));
    }
    let migration_is_present = validate_migration_provenance(root.get("migration_provenance"))?;
    let signature_is_present = {
        let security = object(root.get("security"), "security")?;
        require_exact_keys(security, &["integrity_profile", "signature"], "security")?;
        if security.get("integrity_profile").and_then(Value::as_str)
            != Some("sha256_raw_member_inventory_v1")
        {
            return Err(ArchiveStoreError::Format(
                "manifest integrity profile is not sha256_raw_member_inventory_v1".into(),
            ));
        }
        validate_signature(security.get("signature"))?
    };
    if signature_is_present {
        validate_signature_preimage(root)?;
    }
    validate_future_artifacts(root.get("replay"))?;
    validate_required_replay_refs(root.get("replay"))?;
    let unsupported_payloads = validate_payload_declarations(root.get("payloads"))?;
    validate_extensions(root.get("extensions"))?;
    if persistence_kind == "workspace_snapshot" {
        validate_workspace(root.get("workspace"))?;
    }

    let inventory = root
        .get("member_inventory")
        .and_then(Value::as_array)
        .ok_or_else(|| ArchiveStoreError::Format("member_inventory must be an array".into()))?;
    if inventory.is_empty() || inventory.len() > MAX_ENTRIES - 1 {
        return Err(ArchiveStoreError::Format(
            "member_inventory entry count exceeds V1 budget".into(),
        ));
    }
    let mut declared = BTreeSet::new();
    let mut total = 0usize;
    for member in inventory {
        let item = object(Some(member), "member_inventory entry")?;
        require_exact_keys(
            item,
            &[
                "path",
                "regular_file",
                "raw_sha256",
                "uncompressed_size_bytes",
                "semantic_fingerprint",
                "semantic_profile",
            ],
            "member_inventory entry",
        )?;
        let path = required_string(item, "path", "member_inventory entry")?;
        validate_member_path(path)?;
        if path == MANIFEST_MEMBER || !declared.insert(path.to_string()) {
            return Err(ArchiveStoreError::Format(format!(
                "member inventory path `{path}` is reserved or duplicated"
            )));
        }
        if item.get("regular_file").and_then(Value::as_bool) != Some(true) {
            return Err(ArchiveStoreError::Format(format!(
                "member `{path}` is not a regular file"
            )));
        }
        require_sha256(item.get("raw_sha256"), "member raw_sha256")?;
        let size = item
            .get("uncompressed_size_bytes")
            .and_then(Value::as_u64)
            .and_then(|size| usize::try_from(size).ok())
            .ok_or_else(|| {
                ArchiveStoreError::Format(format!(
                    "member `{path}` uncompressed_size_bytes must be a non-negative integer"
                ))
            })?;
        total = total
            .checked_add(size)
            .ok_or_else(|| ArchiveStoreError::Format("total member size overflow".into()))?;
        if size > MAX_MEMBER_BYTES || total > MAX_TOTAL_BYTES {
            return Err(ArchiveStoreError::Format(
                "payload size exceeds V1 budget".into(),
            ));
        }
        require_optional_sha256(
            item.get("semantic_fingerprint"),
            "member semantic_fingerprint",
        )?;
        require_semantic_profile(item.get("semantic_profile"), "member semantic_profile")?;
    }
    if physical_paths
        .iter()
        .filter(|path| path.as_str() != MANIFEST_MEMBER)
        .collect::<BTreeSet<_>>()
        != declared.iter().collect::<BTreeSet<_>>()
    {
        return Err(ArchiveStoreError::Format(
            "ZIP payloads do not exactly equal the closed member inventory".into(),
        ));
    }
    if persistence_kind == "workspace_snapshot" {
        validate_workspace_namespace(root.get("workspace"), physical_paths)?;
    }
    validate_ref_inventory_links(
        root.get("replay"),
        root.get("payloads"),
        root.get("workspace"),
        root.get("member_inventory"),
    )?;
    if persistence_kind == "workspace_snapshot" {
        return Err(ArchiveStoreError::UnsupportedCapability(
            "workspace snapshots are outside this native V1 slice".into(),
        ));
    }
    if migration_is_present {
        return Err(ArchiveStoreError::UnsupportedCapability(
            "legacy migration provenance is not writable/readable by this V1 native slice".into(),
        ));
    }
    if signature_is_present {
        return Err(ArchiveStoreError::UnsupportedCapability(
            "archive V1 signatures are reserved, not implemented".into(),
        ));
    }
    if unsupported_payloads {
        return Err(ArchiveStoreError::UnsupportedCapability(
            "declared V1 payload requires a capability unavailable in this native slice".into(),
        ));
    }
    Ok(())
}

fn validate_manifest_and_payloads(
    mut manifest: Value,
    mut payloads: BTreeMap<String, Vec<u8>>,
    derive_raw_integrity: bool,
) -> Result<VerifiedArchive, ArchiveStoreError> {
    let root = object_mut(&mut manifest, "manifest")?;
    require_known_keys(
        root,
        &[
            "schema_version",
            "profile",
            "archive_id",
            "persistence_kind",
            "writer",
            "reader_dispatch",
            "physical_profile",
            "replay",
            "payloads",
            "member_inventory",
            "migration_provenance",
            "security",
            "workspace",
            "extensions",
        ],
        "manifest",
    )?;
    require_required_keys(
        root,
        &[
            "schema_version",
            "profile",
            "archive_id",
            "persistence_kind",
            "writer",
            "reader_dispatch",
            "physical_profile",
            "replay",
            "payloads",
            "member_inventory",
            "migration_provenance",
            "security",
            "workspace",
        ],
        "manifest",
    )?;
    if root.get("schema_version").and_then(Value::as_u64) != Some(1)
        || root.get("profile").and_then(Value::as_str) != Some(PROFILE)
    {
        return Err(ArchiveStoreError::Format(
            "only archive/workspace schema_version=1 profile is readable".into(),
        ));
    }
    let persistence_kind = root
        .get("persistence_kind")
        .and_then(Value::as_str)
        .ok_or_else(|| {
            ArchiveStoreError::Format("manifest.persistence_kind must be a string".into())
        })?
        .to_string();
    if !matches!(
        persistence_kind.as_str(),
        "n4a_archive" | "workspace_snapshot"
    ) {
        return Err(ArchiveStoreError::Format(
            "manifest.persistence_kind is outside the frozen V1 schema".into(),
        ));
    }
    let archive_id = required_id(root, "archive_id", "manifest")?.to_string();
    let writer = object(root.get("writer"), "writer")?;
    require_exact_keys(
        writer,
        &["product_aggregate_owner", "canonical_writer_id"],
        "writer",
    )?;
    if writer
        .get("product_aggregate_owner")
        .and_then(Value::as_str)
        != Some("nirs4all-core")
        || writer.get("canonical_writer_id").and_then(Value::as_str) != Some(WRITER_ID)
    {
        return Err(ArchiveStoreError::Format(
            "manifest writer is not the declared nirs4all-core V1 writer".into(),
        ));
    }
    validate_dispatch(root.get("reader_dispatch"))?;
    validate_physical_profile(root.get("physical_profile"))?;
    if persistence_kind == "n4a_archive" && !root.get("workspace").is_some_and(Value::is_null) {
        return Err(ArchiveStoreError::Format(
            "n4a_archive V1 must have workspace=null".into(),
        ));
    }
    let migration_is_present = validate_migration_provenance(root.get("migration_provenance"))?;
    let signature_is_present = {
        let security = object(root.get("security"), "security")?;
        require_exact_keys(security, &["integrity_profile", "signature"], "security")?;
        if security.get("integrity_profile").and_then(Value::as_str)
            != Some("sha256_raw_member_inventory_v1")
        {
            return Err(ArchiveStoreError::Format(
                "manifest integrity profile is not sha256_raw_member_inventory_v1".into(),
            ));
        }
        validate_signature(security.get("signature"))?
    };
    if signature_is_present {
        validate_signature_preimage(root)?;
    }
    validate_future_artifacts(root.get("replay"))?;
    let portable_predictor_member = validate_required_replay_refs(root.get("replay"))?;
    let unsupported_payloads = validate_payload_declarations(root.get("payloads"))?;
    validate_extensions(root.get("extensions"))?;
    if persistence_kind == "workspace_snapshot" {
        validate_workspace(root.get("workspace"))?;
    }

    let inventory = root
        .get_mut("member_inventory")
        .and_then(Value::as_array_mut)
        .ok_or_else(|| ArchiveStoreError::Format("member_inventory must be an array".into()))?;
    if inventory.is_empty() || inventory.len() > MAX_ENTRIES - 1 {
        return Err(ArchiveStoreError::Format(
            "member_inventory entry count exceeds V1 budget".into(),
        ));
    }
    let mut declared = BTreeSet::new();
    let mut total = 0usize;
    for member in inventory {
        let item = object_mut(member, "member_inventory entry")?;
        require_exact_keys(
            item,
            &[
                "path",
                "regular_file",
                "raw_sha256",
                "uncompressed_size_bytes",
                "semantic_fingerprint",
                "semantic_profile",
            ],
            "member_inventory entry",
        )?;
        let path = required_string(item, "path", "member_inventory entry")?.to_string();
        validate_member_path(&path)?;
        if path == MANIFEST_MEMBER || !declared.insert(path.clone()) {
            return Err(ArchiveStoreError::Format(format!(
                "member inventory path `{path}` is reserved or duplicated"
            )));
        }
        if item.get("regular_file").and_then(Value::as_bool) != Some(true) {
            return Err(ArchiveStoreError::Format(format!(
                "member `{path}` is not a regular file"
            )));
        }
        require_sha256(item.get("raw_sha256"), "member raw_sha256")?;
        if item
            .get("uncompressed_size_bytes")
            .and_then(Value::as_u64)
            .is_none()
        {
            return Err(ArchiveStoreError::Format(format!(
                "member `{path}` uncompressed_size_bytes must be a non-negative integer"
            )));
        }
        let bytes = payloads.get(&path).ok_or_else(|| {
            ArchiveStoreError::Format(format!("declared member `{path}` is absent from ZIP"))
        })?;
        total = total
            .checked_add(bytes.len())
            .ok_or_else(|| ArchiveStoreError::Format("total member size overflow".into()))?;
        if bytes.len() > MAX_MEMBER_BYTES || total > MAX_TOTAL_BYTES {
            return Err(ArchiveStoreError::Format(
                "payload size exceeds V1 budget".into(),
            ));
        }
        if derive_raw_integrity {
            item.insert("raw_sha256".into(), Value::String(sha256_hex(bytes)));
            item.insert(
                "uncompressed_size_bytes".into(),
                Value::from(bytes.len() as u64),
            );
        } else {
            if item.get("uncompressed_size_bytes").and_then(Value::as_u64)
                != Some(bytes.len() as u64)
            {
                return Err(ArchiveStoreError::Integrity(format!(
                    "member `{path}` size does not match inventory"
                )));
            }
            let declared_hash = required_string(item, "raw_sha256", "member_inventory entry")?;
            if declared_hash != sha256_hex(bytes) {
                return Err(ArchiveStoreError::Integrity(format!(
                    "member `{path}` SHA-256 does not match inventory"
                )));
            }
        }
        require_optional_sha256(
            item.get("semantic_fingerprint"),
            "member semantic_fingerprint",
        )?;
        require_semantic_profile(item.get("semantic_profile"), "member semantic_profile")?;
    }
    if payloads.keys().collect::<BTreeSet<_>>() != declared.iter().collect::<BTreeSet<_>>() {
        return Err(ArchiveStoreError::Format(
            "ZIP payloads do not exactly equal the closed member inventory".into(),
        ));
    }
    if derive_raw_integrity {
        derive_replay_raw_hashes(root, &payloads)?;
    }
    validate_ref_inventory_links(
        root.get("replay"),
        root.get("payloads"),
        root.get("workspace"),
        root.get("member_inventory"),
    )?;
    // Complete all manifest shape, inventory, and link validation before
    // reporting a capability gap. Otherwise a typed optional declaration
    // could mask a malformed closed inventory or a bad reference link.
    if persistence_kind == "workspace_snapshot" {
        return Err(ArchiveStoreError::UnsupportedCapability(
            "workspace snapshots are outside this native V1 slice".into(),
        ));
    }
    if migration_is_present {
        return Err(ArchiveStoreError::UnsupportedCapability(
            "legacy migration provenance is not writable/readable by this V1 native slice".into(),
        ));
    }
    if signature_is_present {
        return Err(ArchiveStoreError::UnsupportedCapability(
            "archive V1 signatures are reserved, not implemented".into(),
        ));
    }
    if unsupported_payloads {
        return Err(ArchiveStoreError::UnsupportedCapability(
            "declared V1 payload requires a capability unavailable in this native slice".into(),
        ));
    }
    Ok(VerifiedArchive {
        manifest,
        payloads: std::mem::take(&mut payloads),
        archive_id,
        portable_predictor_member,
    })
}

fn derive_replay_raw_hashes(
    root: &mut Map<String, Value>,
    payloads: &BTreeMap<String, Vec<u8>>,
) -> Result<(), ArchiveStoreError> {
    let replay = root
        .get_mut("replay")
        .and_then(Value::as_object_mut)
        .ok_or_else(|| ArchiveStoreError::Format("replay must be an object".into()))?;
    let package = replay
        .get_mut("portable_predictor_package")
        .and_then(Value::as_object_mut)
        .ok_or_else(|| {
            ArchiveStoreError::Format("replay.portable_predictor_package must be an object".into())
        })?;
    derive_ref_raw_hash(package, payloads)?;
    let artifacts = replay
        .get_mut("training_artifacts")
        .and_then(Value::as_object_mut)
        .ok_or_else(|| {
            ArchiveStoreError::Format("replay.training_artifacts must be an object".into())
        })?;
    for key in [
        "graph",
        "execution_bundle",
        "training_outcome",
        "prediction_cache_payload_set",
        "score_set",
    ] {
        let reference = artifacts
            .get_mut(key)
            .and_then(Value::as_object_mut)
            .ok_or_else(|| {
                ArchiveStoreError::Format(format!("training artifact `{key}` must be an object"))
            })?;
        derive_ref_raw_hash(reference, payloads)?;
    }
    let payload_declarations = root
        .get_mut("payloads")
        .and_then(Value::as_object_mut)
        .ok_or_else(|| ArchiveStoreError::Format("payloads must be an object".into()))?;
    for key in ["conformal", "robustness"] {
        if let Some(reference) = payload_declarations
            .get_mut(key)
            .filter(|reference| !reference.is_null())
            .and_then(Value::as_object_mut)
        {
            derive_ref_raw_hash(reference, payloads)?;
        }
    }
    Ok(())
}

fn derive_ref_raw_hash(
    reference: &mut Map<String, Value>,
    payloads: &BTreeMap<String, Vec<u8>>,
) -> Result<(), ArchiveStoreError> {
    let path = required_string(reference, "member_path", "replay reference")?;
    let bytes = payloads.get(path).ok_or_else(|| {
        ArchiveStoreError::Integrity(format!("replay reference `{path}` has no payload"))
    })?;
    reference.insert("raw_sha256".to_string(), Value::String(sha256_hex(bytes)));
    Ok(())
}

fn validate_dispatch(value: Option<&Value>) -> Result<(), ArchiveStoreError> {
    let dispatch = object(value, "reader_dispatch")?;
    require_exact_keys(dispatch, &["archive_v1", "legacy_n4a"], "reader_dispatch")?;
    let archive = object(dispatch.get("archive_v1"), "reader_dispatch.archive_v1")?;
    require_exact_keys(
        archive,
        &[
            "accepted_versions",
            "future_versions",
            "dispatch_before_extraction",
        ],
        "reader_dispatch.archive_v1",
    )?;
    if archive.get("accepted_versions") != Some(&serde_json::json!([1]))
        || archive.get("future_versions").and_then(Value::as_str) != Some("refuse")
        || archive
            .get("dispatch_before_extraction")
            .and_then(Value::as_bool)
            != Some(true)
    {
        return Err(ArchiveStoreError::Format(
            "reader dispatch must be the frozen V1 fail-closed profile".into(),
        ));
    }
    let legacy = object(dispatch.get("legacy_n4a"), "reader_dispatch.legacy_n4a")?;
    require_exact_keys(
        legacy,
        &[
            "form",
            "manifest_member",
            "reader_id",
            "maximum_bundle_format_version",
            "migration_direction",
        ],
        "reader_dispatch.legacy_n4a",
    )?;
    if legacy.get("form").and_then(Value::as_str) != Some("historical_n4a_zip")
        || legacy.get("manifest_member").and_then(Value::as_str) != Some(MANIFEST_MEMBER)
        || legacy.get("reader_id").and_then(Value::as_str)
            != Some("nirs4all.pipeline.bundle.loader.BundleLoader")
        || legacy
            .get("maximum_bundle_format_version")
            .and_then(Value::as_str)
            != Some("1.0")
        || legacy.get("migration_direction").and_then(Value::as_str)
            != Some("legacy_to_v1_copy_on_write_only")
    {
        return Err(ArchiveStoreError::Format(
            "legacy dispatch does not match frozen V1 separation".into(),
        ));
    }
    Ok(())
}

fn validate_physical_profile(value: Option<&Value>) -> Result<(), ArchiveStoreError> {
    let profile = object(value, "physical_profile")?;
    require_exact_keys(
        profile,
        &[
            "container",
            "manifest_member",
            "regular_files_only",
            "limits",
        ],
        "physical_profile",
    )?;
    let limits = object(profile.get("limits"), "physical_profile.limits")?;
    require_exact_keys(
        limits,
        &[
            "max_entries",
            "max_total_uncompressed_bytes",
            "max_member_uncompressed_bytes",
            "max_compression_ratio",
        ],
        "physical_profile.limits",
    )?;
    if profile.get("container").and_then(Value::as_str) != Some("zip")
        || profile.get("manifest_member").and_then(Value::as_str) != Some(MANIFEST_MEMBER)
        || profile.get("regular_files_only").and_then(Value::as_bool) != Some(true)
        || limits.get("max_entries").and_then(Value::as_u64) != Some(MAX_ENTRIES as u64)
        || limits
            .get("max_total_uncompressed_bytes")
            .and_then(Value::as_u64)
            != Some(MAX_TOTAL_BYTES as u64)
        || limits
            .get("max_member_uncompressed_bytes")
            .and_then(Value::as_u64)
            != Some(MAX_MEMBER_BYTES as u64)
        || limits.get("max_compression_ratio").and_then(Value::as_u64) != Some(100)
    {
        return Err(ArchiveStoreError::Format(
            "physical profile is not the frozen STORE-001 V1 profile".into(),
        ));
    }
    Ok(())
}

fn validate_future_artifacts(replay: Option<&Value>) -> Result<(), ArchiveStoreError> {
    let replay = object(replay, "replay")?;
    let future = replay
        .get("future_artifacts")
        .and_then(Value::as_array)
        .ok_or_else(|| {
            ArchiveStoreError::Format("replay.future_artifacts must be an array".into())
        })?;
    for item in future {
        let item = object(Some(item), "future artifact")?;
        require_exact_keys(
            item,
            &["kind", "status", "reason", "affects_replay"],
            "future artifact",
        )?;
        if !is_id(required_string(item, "kind", "future artifact")?)
            || required_string(item, "reason", "future artifact").is_err()
            || item.get("status").and_then(Value::as_str) != Some("deferred_future_contract")
            || item.get("affects_replay").and_then(Value::as_bool) != Some(false)
        {
            return Err(ArchiveStoreError::Format(
                "future artifacts must be explicitly deferred and replay-inert".into(),
            ));
        }
    }
    Ok(())
}

fn validate_required_replay_refs(replay: Option<&Value>) -> Result<String, ArchiveStoreError> {
    let replay = object(replay, "replay")?;
    require_exact_keys(
        replay,
        &[
            "portable_predictor_package",
            "training_artifacts",
            "future_artifacts",
        ],
        "replay",
    )?;
    let package = object(
        replay.get("portable_predictor_package"),
        "replay.portable_predictor_package",
    )?;
    validate_dagml_ref(package, PORTABLE_PACKAGE_SCHEMA, 1, "dagml_tcv1", false)?;
    let package_path =
        required_string(package, "member_path", "portable predictor package")?.to_string();
    let artifacts = object(
        replay.get("training_artifacts"),
        "replay.training_artifacts",
    )?;
    require_exact_keys(
        artifacts,
        &[
            "graph",
            "execution_bundle",
            "training_outcome",
            "prediction_cache_payload_set",
            "score_set",
        ],
        "replay.training_artifacts",
    )?;
    let refs = [
        (
            "graph",
            GRAPH_SCHEMA,
            1,
            "dagml_historical_serde_json_v1",
            false,
        ),
        (
            "execution_bundle",
            EXECUTION_BUNDLE_SCHEMA,
            2,
            "dagml_tcv1",
            true,
        ),
        (
            "training_outcome",
            TRAINING_OUTCOME_SCHEMA,
            2,
            "dagml_tcv1",
            true,
        ),
        (
            "prediction_cache_payload_set",
            CACHE_SET_SCHEMA,
            2,
            "dagml_historical_serde_json_v1",
            true,
        ),
        (
            "score_set",
            SCORE_SET_SCHEMA,
            2,
            "dagml_historical_serde_json_v1",
            true,
        ),
    ];
    for (key, schema, version, profile, port_required) in refs {
        validate_dagml_ref(
            object(artifacts.get(key), key)?,
            schema,
            version,
            profile,
            port_required,
        )?;
    }
    Ok(package_path)
}

fn validate_dagml_ref(
    reference: &Map<String, Value>,
    schema: &str,
    version: u64,
    profile: &str,
    port_required: bool,
) -> Result<(), ArchiveStoreError> {
    const V1_FIELDS: &[&str] = &[
        "owner",
        "schema_id",
        "schema_version",
        "member_path",
        "raw_sha256",
        "semantic_fingerprint",
        "semantic_profile",
    ];
    const V2_FIELDS: &[&str] = &[
        "owner",
        "schema_id",
        "schema_version",
        "producer_port_required",
        "member_path",
        "raw_sha256",
        "semantic_fingerprint",
        "semantic_profile",
    ];
    require_exact_keys(
        reference,
        if port_required { V2_FIELDS } else { V1_FIELDS },
        "DAG-ML reference",
    )?;
    if reference.get("owner").and_then(Value::as_str) != Some("dag-ml")
        || reference.get("schema_id").and_then(Value::as_str) != Some(schema)
        || reference.get("schema_version").and_then(Value::as_u64) != Some(version)
        || reference.get("semantic_profile").and_then(Value::as_str) != Some(profile)
        || (port_required
            && reference
                .get("producer_port_required")
                .and_then(Value::as_bool)
                != Some(true))
    {
        return Err(ArchiveStoreError::Format(format!(
            "DAG-ML reference `{schema}` has an unsupported version/profile/port declaration"
        )));
    }
    validate_member_path(required_string(
        reference,
        "member_path",
        "DAG-ML reference",
    )?)?;
    require_sha256(reference.get("raw_sha256"), "DAG-ML raw_sha256")?;
    require_sha256(
        reference.get("semantic_fingerprint"),
        "DAG-ML semantic_fingerprint",
    )?;
    Ok(())
}

/// Validate all schema-owned payload shapes before deciding whether this host
/// has the capability to load them. This keeps malformed input in the Format
/// namespace and reserves UnsupportedCapability for valid, typed declarations.
fn validate_payload_declarations(value: Option<&Value>) -> Result<bool, ArchiveStoreError> {
    let payloads = object(value, "payloads")?;
    require_exact_keys(
        payloads,
        &[
            "methods",
            "n4d_aggregate_reference",
            "conformal",
            "robustness",
            "host_artifacts",
        ],
        "payloads",
    )?;
    let methods = object(payloads.get("methods"), "payloads.methods")?;
    require_exact_keys(methods, &["n4mm", "n4mopt"], "payloads.methods")?;
    let mut unsupported = false;
    for key in ["n4mm", "n4mopt"] {
        let values = methods.get(key).and_then(Value::as_array).ok_or_else(|| {
            ArchiveStoreError::Format(format!("payloads.methods.{key} must be an array"))
        })?;
        for reference in values {
            validate_methods_ref(object(Some(reference), "Methods reference")?, key)?;
        }
        unsupported |= !values.is_empty();
    }
    if let Some(reference) = payloads
        .get("n4d_aggregate_reference")
        .filter(|value| !value.is_null())
    {
        validate_n4d_ref(object(Some(reference), "N4D aggregate reference")?)?;
        unsupported = true;
    }
    for (key, schema, profile) in [
        (
            "conformal",
            "https://github.com/GBeurier/dag-ml/schemas/conformal_calibration.v1.schema.json",
            "dagml_tcv1",
        ),
        (
            "robustness",
            "https://github.com/GBeurier/dag-ml/schemas/robustness_report.v1.schema.json",
            "dagml_tcv1",
        ),
    ] {
        if let Some(reference) = payloads.get(key).filter(|value| !value.is_null()) {
            validate_dagml_ref(object(Some(reference), key)?, schema, 1, profile, false)?;
        }
    }
    let hosts = payloads
        .get("host_artifacts")
        .and_then(Value::as_array)
        .ok_or_else(|| {
            ArchiveStoreError::Format("payloads.host_artifacts must be an array".into())
        })?;
    let mut host_ids = BTreeSet::new();
    for host in hosts {
        let host = object(Some(host), "host artifact")?;
        validate_host_artifact(host)?;
        let id = required_id(host, "artifact_id", "host artifact")?;
        if !host_ids.insert(id) {
            return Err(ArchiveStoreError::Format(
                "host artifact ids must be unique".into(),
            ));
        }
    }
    Ok(unsupported || !hosts.is_empty())
}

fn validate_methods_ref(
    reference: &Map<String, Value>,
    array_key: &str,
) -> Result<(), ArchiveStoreError> {
    require_exact_keys(
        reference,
        &[
            "kind",
            "owner",
            "format_version",
            "abi_major",
            "member_path",
            "raw_sha256",
            "semantic_fingerprint",
            "semantic_profile",
        ],
        "Methods reference",
    )?;
    let expected_kind = if array_key == "n4mm" {
        "N4MM"
    } else {
        "N4MOPT"
    };
    if reference.get("kind").and_then(Value::as_str) != Some(expected_kind)
        || reference.get("owner").and_then(Value::as_str) != Some("nirs4all-methods")
        || reference.get("format_version").and_then(Value::as_u64) != Some(1)
        || reference.get("abi_major").and_then(Value::as_u64) != Some(2)
        || reference.get("semantic_profile").and_then(Value::as_str) != Some("methods_rfc8785_jcs")
    {
        return Err(ArchiveStoreError::Format(
            "Methods reference is outside the frozen V1 type".into(),
        ));
    }
    validate_member_path(required_string(
        reference,
        "member_path",
        "Methods reference",
    )?)?;
    require_sha256(reference.get("raw_sha256"), "Methods raw_sha256")?;
    require_sha256(
        reference.get("semantic_fingerprint"),
        "Methods semantic_fingerprint",
    )
}

fn validate_n4d_ref(reference: &Map<String, Value>) -> Result<(), ArchiveStoreError> {
    require_exact_keys(
        reference,
        &[
            "kind",
            "owner",
            "interpretation",
            "member_path",
            "raw_sha256",
            "semantic_fingerprint",
            "semantic_profile",
        ],
        "N4D aggregate reference",
    )?;
    if reference.get("kind").and_then(Value::as_str) != Some("n4d_aggregate_reference")
        || reference.get("owner").and_then(Value::as_str) != Some("nirs4all-core")
        || reference.get("interpretation").and_then(Value::as_str)
            != Some("aggregate_reference_not_n4d_format_claim")
        || reference.get("semantic_fingerprint") != Some(&Value::Null)
        || reference.get("semantic_profile").and_then(Value::as_str) != Some("none")
    {
        return Err(ArchiveStoreError::Format(
            "N4D aggregate reference is outside the frozen V1 type".into(),
        ));
    }
    validate_member_path(required_string(
        reference,
        "member_path",
        "N4D aggregate reference",
    )?)?;
    require_sha256(reference.get("raw_sha256"), "N4D raw_sha256")
}

fn validate_host_artifact(host: &Map<String, Value>) -> Result<(), ArchiveStoreError> {
    require_exact_keys(
        host,
        &[
            "artifact_id",
            "host_state",
            "serialization_backend",
            "load_policy",
            "controller_id",
            "controller_version",
            "plugin_id",
            "plugin_version",
            "runtime_id",
            "abi_id",
            "capability_id",
            "member_path",
            "raw_sha256",
            "semantic_fingerprint",
            "semantic_profile",
        ],
        "host artifact",
    )?;
    for key in [
        "artifact_id",
        "controller_id",
        "controller_version",
        "plugin_id",
        "plugin_version",
        "runtime_id",
        "abi_id",
        "capability_id",
    ] {
        required_id(host, key, "host artifact")?;
    }
    if !matches!(
        host.get("host_state").and_then(Value::as_str),
        Some("native_portable" | "host_sidecar")
    ) || !matches!(
        host.get("serialization_backend").and_then(Value::as_str),
        Some("onnx" | "safetensors" | "json" | "torch_state_dict" | "joblib" | "pickle" | "rds")
    ) || !matches!(
        host.get("load_policy").and_then(Value::as_str),
        Some("native_portable" | "host_opt_in")
    ) || host.get("semantic_fingerprint") != Some(&Value::Null)
        || host.get("semantic_profile").and_then(Value::as_str) != Some("host_opaque")
    {
        return Err(ArchiveStoreError::Format(
            "host artifact is outside the frozen V1 type".into(),
        ));
    }
    if host.get("host_state").and_then(Value::as_str) == Some("native_portable")
        && host.get("load_policy").and_then(Value::as_str) != Some("native_portable")
    {
        return Err(ArchiveStoreError::Format(
            "native host artifact requires native_portable policy".into(),
        ));
    }
    if matches!(
        host.get("serialization_backend").and_then(Value::as_str),
        Some("pickle" | "joblib" | "rds")
    ) && host.get("load_policy").and_then(Value::as_str) != Some("host_opt_in")
    {
        return Err(ArchiveStoreError::Format(
            "code-bearing host artifact requires host_opt_in".into(),
        ));
    }
    validate_member_path(required_string(host, "member_path", "host artifact")?)?;
    require_sha256(host.get("raw_sha256"), "host artifact raw_sha256")
}

fn validate_migration_provenance(value: Option<&Value>) -> Result<bool, ArchiveStoreError> {
    let Some(value) = value else {
        return Err(ArchiveStoreError::Format(
            "migration_provenance is required".into(),
        ));
    };
    if value.is_null() {
        return Ok(false);
    }
    let migration = object(Some(value), "migration_provenance")?;
    require_exact_keys(
        migration,
        &[
            "source_raw_sha256",
            "legacy_format",
            "legacy_format_version",
            "tool_id",
            "tool_version",
            "copy_on_write",
            "source_retained",
        ],
        "migration_provenance",
    )?;
    match migration.get("source_raw_sha256") {
        Some(Value::Null) => {}
        value => require_sha256(value, "migration_provenance.source_raw_sha256")?,
    }
    if !matches!(migration.get("legacy_format"), Some(Value::Null))
        && migration.get("legacy_format").and_then(Value::as_str) != Some("historical_n4a_zip")
        || !matches!(
            migration.get("legacy_format_version"),
            Some(Value::Null) | Some(Value::String(_))
        )
        || migration.get("copy_on_write").and_then(Value::as_bool) != Some(true)
        || migration.get("source_retained").and_then(Value::as_bool) != Some(true)
    {
        return Err(ArchiveStoreError::Format(
            "migration_provenance is outside the frozen V1 type".into(),
        ));
    }
    required_id(migration, "tool_id", "migration_provenance")?;
    required_id(migration, "tool_version", "migration_provenance")?;
    let has_legacy = !migration.get("legacy_format").is_some_and(Value::is_null);
    if has_legacy
        && (migration
            .get("source_raw_sha256")
            .is_some_and(Value::is_null)
            || migration
                .get("legacy_format_version")
                .is_some_and(Value::is_null))
    {
        return Err(ArchiveStoreError::Format(
            "legacy migration requires source hash and version".into(),
        ));
    }
    if has_legacy
        && migration.get("source_raw_sha256").and_then(Value::as_str)
            != Some(HISTORICAL_LEGACY_FIXTURE_SHA256)
    {
        return Err(ArchiveStoreError::Format(
            "legacy migration source SHA-256 differs from the retained V1 fixture".into(),
        ));
    }
    Ok(true)
}

fn validate_signature(value: Option<&Value>) -> Result<bool, ArchiveStoreError> {
    let Some(value) = value else {
        return Err(ArchiveStoreError::Format(
            "security.signature is required".into(),
        ));
    };
    if value.is_null() {
        return Ok(false);
    }
    let signature = object(Some(value), "security.signature")?;
    require_exact_keys(
        signature,
        &[
            "status",
            "manifest_sha256",
            "canonical_profile",
            "preimage_rules",
            "algorithm",
            "key_id",
            "signature",
            "trust_root",
        ],
        "security.signature",
    )?;
    if signature.get("status").and_then(Value::as_str) != Some("reserved_future_contract")
        || signature.get("canonical_profile").and_then(Value::as_str)
            != Some("archive_v1_manifest_json_canonical_v1")
        || signature.get("preimage_rules").and_then(Value::as_str)
            != Some("utf8_json_sort_keys_compact_with_signature_null_v1")
        || ["algorithm", "key_id", "signature", "trust_root"]
            .iter()
            .any(|key| signature.get(*key) != Some(&Value::Null))
    {
        return Err(ArchiveStoreError::Format(
            "security.signature is outside the frozen V1 reservation".into(),
        ));
    }
    require_sha256(
        signature.get("manifest_sha256"),
        "security.signature.manifest_sha256",
    )?;
    Ok(true)
}

fn validate_signature_preimage(manifest: &mut Map<String, Value>) -> Result<(), ArchiveStoreError> {
    let expected = manifest["security"]["signature"]["manifest_sha256"]
        .as_str()
        .ok_or_else(|| {
            ArchiveStoreError::Format("security.signature.manifest_sha256 is required".into())
        })?
        .to_string();
    let original = {
        let security = object_mut(
            manifest
                .get_mut("security")
                .ok_or_else(|| ArchiveStoreError::Format("security is required".into()))?,
            "security",
        )?;
        std::mem::replace(
            security.get_mut("signature").ok_or_else(|| {
                ArchiveStoreError::Format("security.signature is required".into())
            })?,
            Value::Null,
        )
    };
    let canonical = serde_json::to_vec(manifest).map_err(|error| {
        ArchiveStoreError::Format(format!("cannot canonicalize signature preimage: {error}"))
    })?;
    object_mut(
        manifest
            .get_mut("security")
            .ok_or_else(|| ArchiveStoreError::Format("security is required".into()))?,
        "security",
    )?
    .insert("signature".into(), original);
    if sha256_hex(&canonical) != expected {
        return Err(ArchiveStoreError::Format(
            "security.signature manifest_sha256 does not match its canonical preimage".into(),
        ));
    }
    Ok(())
}

fn validate_extensions(value: Option<&Value>) -> Result<(), ArchiveStoreError> {
    let Some(value) = value else {
        return Ok(());
    };
    let extensions = object(Some(value), "extensions")?;
    for (namespace, extension) in extensions {
        if !is_extension_namespace(namespace) || !extension.is_object() {
            return Err(ArchiveStoreError::Format(
                "extensions must map a valid namespace to an object".into(),
            ));
        }
    }
    Ok(())
}

fn is_extension_namespace(value: &str) -> bool {
    let mut chunks = value.split(['.', '_', '-']);
    let Some(first) = chunks.next() else {
        return false;
    };
    if first.is_empty()
        || !first
            .bytes()
            .next()
            .is_some_and(|byte| byte.is_ascii_lowercase())
        || !first
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit())
    {
        return false;
    }
    chunks.all(|chunk| {
        !chunk.is_empty()
            && chunk
                .bytes()
                .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit())
    })
}

fn validate_workspace(value: Option<&Value>) -> Result<(), ArchiveStoreError> {
    let workspace = object(value, "workspace")?;
    require_exact_keys(
        workspace,
        &[
            "layout",
            "snapshot_protocol",
            "payload_inventory",
            "exclusions",
        ],
        "workspace",
    )?;
    if workspace.get("layout").and_then(Value::as_str) != Some("sqlite_parquet_artifacts_v1")
        || workspace.get("exclusions")
            != Some(&serde_json::json!([
                "workspace/.session.lock",
                "workspace/live-session/**"
            ]))
    {
        return Err(ArchiveStoreError::Format(
            "workspace layout or exclusions are outside frozen V1".into(),
        ));
    }
    let snapshot = object(
        workspace.get("snapshot_protocol"),
        "workspace.snapshot_protocol",
    )?;
    require_exact_keys(
        snapshot,
        &[
            "checkpoint_id",
            "transaction_id",
            "run_ids",
            "inventory_complete",
        ],
        "workspace.snapshot_protocol",
    )?;
    required_id(snapshot, "checkpoint_id", "workspace.snapshot_protocol")?;
    required_id(snapshot, "transaction_id", "workspace.snapshot_protocol")?;
    if snapshot.get("inventory_complete").and_then(Value::as_bool) != Some(true) {
        return Err(ArchiveStoreError::Format(
            "workspace snapshot inventory must be complete".into(),
        ));
    }
    let runs = snapshot
        .get("run_ids")
        .and_then(Value::as_array)
        .ok_or_else(|| {
            ArchiveStoreError::Format("workspace.snapshot_protocol.run_ids must be an array".into())
        })?;
    if runs.is_empty() {
        return Err(ArchiveStoreError::Format(
            "workspace requires at least one run id".into(),
        ));
    }
    let mut run_ids = BTreeSet::new();
    for run in runs {
        let run = run
            .as_str()
            .filter(|run| is_id(run))
            .ok_or_else(|| ArchiveStoreError::Format("workspace run_id is invalid".into()))?;
        if !run_ids.insert(run) {
            return Err(ArchiveStoreError::Format(
                "workspace run_ids must be unique".into(),
            ));
        }
    }
    let payloads = workspace
        .get("payload_inventory")
        .and_then(Value::as_array)
        .ok_or_else(|| {
            ArchiveStoreError::Format("workspace.payload_inventory must be an array".into())
        })?;
    if payloads.is_empty() {
        return Err(ArchiveStoreError::Format(
            "workspace payload inventory is empty".into(),
        ));
    }
    let mut paths = BTreeSet::new();
    let mut sqlite = 0usize;
    for payload in payloads {
        let payload = object(Some(payload), "workspace payload")?;
        require_exact_keys(
            payload,
            &[
                "kind",
                "run_id",
                "member_path",
                "raw_sha256",
                "semantic_fingerprint",
                "semantic_profile",
            ],
            "workspace payload",
        )?;
        let kind = payload
            .get("kind")
            .and_then(Value::as_str)
            .filter(|kind| matches!(*kind, "sqlite" | "parquet" | "artifact" | "ordinary"))
            .ok_or_else(|| ArchiveStoreError::Format("workspace payload kind is invalid".into()))?;
        let path = required_string(payload, "member_path", "workspace payload")?;
        validate_member_path(path)?;
        require_sha256(payload.get("raw_sha256"), "workspace payload raw_sha256")?;
        require_optional_sha256(
            payload.get("semantic_fingerprint"),
            "workspace payload semantic_fingerprint",
        )?;
        if !matches!(
            payload.get("semantic_profile").and_then(Value::as_str),
            Some("host_opaque" | "none")
        ) || !paths.insert(path)
            || is_sqlite_live_path(path)
        {
            return Err(ArchiveStoreError::Format(
                "workspace payload type/path is invalid".into(),
            ));
        }
        match kind {
            "sqlite" => {
                sqlite += 1;
                if payload.get("run_id") != Some(&Value::Null) || !is_workspace_sqlite(path) {
                    return Err(ArchiveStoreError::Format(
                        "workspace SQLite payload is invalid".into(),
                    ));
                }
            }
            _ => {
                let run = payload
                    .get("run_id")
                    .and_then(Value::as_str)
                    .filter(|run| run_ids.contains(run))
                    .ok_or_else(|| {
                        ArchiveStoreError::Format("workspace payload run_id is invalid".into())
                    })?;
                let _ = run;
                if !is_workspace_run_path(path)
                    || (kind == "parquet" && !path.ends_with(".parquet"))
                {
                    return Err(ArchiveStoreError::Format(
                        "workspace run payload path is invalid".into(),
                    ));
                }
            }
        }
    }
    if sqlite != 1 {
        return Err(ArchiveStoreError::Format(
            "workspace requires exactly one SQLite payload".into(),
        ));
    }
    Ok(())
}

/// A workspace snapshot is closed over both manifest and ZIP namespace: every
/// physical `workspace/` member must be named by the snapshot inventory, and
/// every inventory member must physically exist. This runs before the current
/// slice reports that it lacks workspace execution capability.
fn validate_workspace_namespace(
    value: Option<&Value>,
    physical_paths: &BTreeSet<String>,
) -> Result<(), ArchiveStoreError> {
    let workspace = object(value, "workspace")?;
    let inventory = workspace
        .get("payload_inventory")
        .and_then(Value::as_array)
        .ok_or_else(|| {
            ArchiveStoreError::Format("workspace.payload_inventory must be an array".into())
        })?;
    let declared = inventory
        .iter()
        .map(|payload| {
            object(Some(payload), "workspace payload")
                .and_then(|payload| required_string(payload, "member_path", "workspace payload"))
        })
        .collect::<Result<BTreeSet<_>, _>>()?;
    let physical = physical_paths
        .iter()
        .filter(|path| path.starts_with("workspace/"))
        .map(String::as_str)
        .collect::<BTreeSet<_>>();
    if declared != physical {
        return Err(ArchiveStoreError::Format(
            "physical workspace members must exactly equal workspace.payload_inventory".into(),
        ));
    }
    Ok(())
}

fn is_workspace_sqlite(path: &str) -> bool {
    path.strip_prefix("workspace/")
        .and_then(|name| name.strip_suffix(".sqlite"))
        .is_some_and(is_workspace_name)
}
fn is_workspace_run_path(path: &str) -> bool {
    path.strip_prefix("workspace/runs/").is_some_and(|rest| {
        rest.split_once('/')
            .is_some_and(|(run, child)| is_workspace_name(run) && !child.is_empty())
    })
}

/// DAG-ML's frozen `SQLITE_SNAPSHOT_PATH` and
/// `RUN_SCOPED_WORKSPACE_PATH` both use this exact component expression:
/// `[A-Za-z0-9][A-Za-z0-9_.-]*`. It intentionally differs from the general
/// manifest ID grammar, which also admits `:`.
fn is_workspace_name(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.first().is_some_and(u8::is_ascii_alphanumeric)
        && bytes
            .iter()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(*byte, b'_' | b'.' | b'-'))
}

fn is_sqlite_live_path(path: &str) -> bool {
    let name = path
        .rsplit('/')
        .next()
        .unwrap_or_default()
        .to_ascii_lowercase();
    ["-wal", "-shm", "-journal", "-stmtjrnl"]
        .iter()
        .any(|suffix| name.ends_with(suffix))
        || name.starts_with("etilqs_")
        || name.starts_with("sqlite-tmp-")
        || name.starts_with("sqlite_temp_")
        || is_sqlite_super_journal_name(&name)
}

/// The frozen DAG-ML V1 contract rejects every SQLite-style super-journal
/// leaf: `-mj`, optionally one space, then one or more hexadecimal characters
/// through the leaf end. Matching is ASCII case-insensitive because callers
/// normalize the leaf first. This deliberately covers more than SQLite's
/// current narrow implementation spelling while leaving ordinary names such as
/// `report-mjpeg.json` usable.
fn is_sqlite_super_journal_name(name: &str) -> bool {
    let Some((_, suffix)) = name.rsplit_once("-mj") else {
        return false;
    };
    let suffix = suffix.strip_prefix(' ').unwrap_or(suffix);
    !suffix.is_empty() && suffix.bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn validate_ref_inventory_links(
    replay: Option<&Value>,
    payload_declarations: Option<&Value>,
    workspace: Option<&Value>,
    inventory: Option<&Value>,
) -> Result<(), ArchiveStoreError> {
    let inventory = inventory.and_then(Value::as_array).ok_or_else(|| {
        ArchiveStoreError::Format("member inventory lost during validation".into())
    })?;
    let inventory = inventory
        .iter()
        .map(|item| {
            let item = object(Some(item), "member inventory link")?;
            Ok((
                required_string(item, "path", "member inventory link")?,
                (
                    required_string(item, "raw_sha256", "member inventory link")?,
                    item.get("semantic_fingerprint").ok_or_else(|| {
                        ArchiveStoreError::Format(
                            "member inventory link.semantic_fingerprint is required".into(),
                        )
                    })?,
                    required_string(item, "semantic_profile", "member inventory link")?,
                ),
            ))
        })
        .collect::<Result<BTreeMap<_, _>, ArchiveStoreError>>()?;
    let replay = object(replay, "replay")?;
    let mut refs = vec![object(
        replay.get("portable_predictor_package"),
        "portable predictor package",
    )?];
    let artifacts = object(replay.get("training_artifacts"), "training artifacts")?;
    for key in [
        "graph",
        "execution_bundle",
        "training_outcome",
        "prediction_cache_payload_set",
        "score_set",
    ] {
        refs.push(object(artifacts.get(key), key)?);
    }
    let required_replay_paths = refs
        .iter()
        .map(|reference| required_string(reference, "member_path", "replay reference"))
        .collect::<Result<BTreeSet<_>, _>>()?;
    if required_replay_paths.len() != refs.len() {
        return Err(ArchiveStoreError::Format(
            "required replay references must use distinct inventory members".into(),
        ));
    }

    let payloads = object(payload_declarations, "payloads")?;
    let methods = object(payloads.get("methods"), "payloads.methods")?;
    let mut method_paths = BTreeSet::new();
    for key in ["n4mm", "n4mopt"] {
        let methods = methods.get(key).and_then(Value::as_array).ok_or_else(|| {
            ArchiveStoreError::Format(format!("payloads.methods.{key} must be an array"))
        })?;
        for reference in methods {
            let reference = object(Some(reference), "Methods reference")?;
            let path = required_string(reference, "member_path", "Methods reference")?;
            if !method_paths.insert(path) {
                return Err(ArchiveStoreError::Format(
                    "N4MM and N4MOPT references cannot alias".into(),
                ));
            }
            refs.push(reference);
        }
    }
    for key in ["n4d_aggregate_reference", "conformal", "robustness"] {
        if let Some(reference) = payloads.get(key).filter(|value| !value.is_null()) {
            refs.push(object(Some(reference), key)?);
        }
    }
    let hosts = payloads
        .get("host_artifacts")
        .and_then(Value::as_array)
        .ok_or_else(|| {
            ArchiveStoreError::Format("payloads.host_artifacts must be an array".into())
        })?;
    for host in hosts {
        refs.push(object(Some(host), "host artifact")?);
    }
    if let Some(workspace) = workspace.filter(|value| !value.is_null()) {
        let workspace = object(Some(workspace), "workspace")?;
        let payloads = workspace
            .get("payload_inventory")
            .and_then(Value::as_array)
            .ok_or_else(|| {
                ArchiveStoreError::Format("workspace.payload_inventory must be an array".into())
            })?;
        for payload in payloads {
            refs.push(object(Some(payload), "workspace payload")?);
        }
    }
    let declared_paths = inventory.keys().copied().collect::<BTreeSet<_>>();
    let mut paths = BTreeSet::new();
    for reference in refs {
        let path = required_string(reference, "member_path", "replay reference")?;
        let raw = required_string(reference, "raw_sha256", "replay reference")?;
        let semantic_fingerprint = reference.get("semantic_fingerprint").ok_or_else(|| {
            ArchiveStoreError::Format("replay reference.semantic_fingerprint is required".into())
        })?;
        let semantic_profile = required_string(reference, "semantic_profile", "replay reference")?;
        let Some((inventory_raw, inventory_fingerprint, inventory_profile)) = inventory.get(path)
        else {
            return Err(ArchiveStoreError::Format(format!(
                "reference `{path}` is absent from the closed member inventory"
            )));
        };
        if *inventory_raw != raw
            || *inventory_profile != semantic_profile
            || *inventory_fingerprint != semantic_fingerprint
        {
            return Err(ArchiveStoreError::Format(format!(
                "reference `{path}` does not match its closed member inventory entry"
            )));
        }
        paths.insert(path);
    }
    if paths != declared_paths {
        return Err(ArchiveStoreError::Format(
            "member inventory must exactly equal all declared member references".into(),
        ));
    }
    Ok(())
}

fn write_stored_zip(
    manifest: &Value,
    payloads: &BTreeMap<String, Vec<u8>>,
) -> Result<Vec<u8>, ArchiveStoreError> {
    let manifest = serialize_manifest_bounded(manifest)?;
    let payload_bytes = payloads.values().try_fold(0usize, |total, bytes| {
        total
            .checked_add(bytes.len())
            .ok_or_else(|| ArchiveStoreError::Format("ZIP payload size overflow".into()))
    })?;
    checked_physical_total(manifest.len(), payload_bytes)?;
    let member_count = payloads.len() + 1;
    if member_count > MAX_ENTRIES {
        return Err(ArchiveStoreError::Format(
            "ZIP entry count exceeds V1 budget".into(),
        ));
    }
    let projected_archive_bytes = manifest
        .len()
        .checked_add(payload_bytes)
        .and_then(|bytes| bytes.checked_add(member_count * (MAX_ZIP_NAME_BYTES + 76)))
        .and_then(|bytes| bytes.checked_add(22))
        .ok_or_else(|| ArchiveStoreError::Format("ZIP size overflow".into()))?;
    if projected_archive_bytes > MAX_ARCHIVE_BYTES {
        return Err(ArchiveStoreError::Format(
            "ZIP archive exceeds V1 on-disk size budget".into(),
        ));
    }
    let mut out = Vec::with_capacity(projected_archive_bytes);
    let mut central = Vec::with_capacity(member_count * (46 + MAX_ZIP_NAME_BYTES));
    append_stored_zip_member(&mut out, &mut central, MANIFEST_MEMBER, &manifest)?;
    for (path, bytes) in payloads {
        append_stored_zip_member(&mut out, &mut central, path, bytes)?;
    }
    let central_offset = u32::try_from(out.len())
        .map_err(|_| ArchiveStoreError::Format("ZIP exceeds V1 offset profile".into()))?;
    let central_size = u32::try_from(central.len())
        .map_err(|_| ArchiveStoreError::Format("ZIP directory exceeds V1 profile".into()))?;
    out.extend_from_slice(&central);
    le32(&mut out, 0x0605_4b50);
    le16(&mut out, 0);
    le16(&mut out, 0);
    le16(&mut out, payloads.len() as u16 + 1);
    le16(&mut out, payloads.len() as u16 + 1);
    le32(&mut out, central_size);
    le32(&mut out, central_offset);
    le16(&mut out, 0);
    Ok(out)
}

fn checked_physical_total(
    manifest_bytes: usize,
    payload_bytes: usize,
) -> Result<usize, ArchiveStoreError> {
    let physical_total = manifest_bytes
        .checked_add(payload_bytes)
        .ok_or_else(|| ArchiveStoreError::Format("ZIP physical size overflow".into()))?;
    if physical_total > MAX_TOTAL_BYTES {
        return Err(ArchiveStoreError::Format(
            "manifest.json plus ZIP payloads exceed V1 total uncompressed budget".into(),
        ));
    }
    Ok(physical_total)
}

fn append_stored_zip_member(
    out: &mut Vec<u8>,
    central: &mut Vec<u8>,
    path: &str,
    bytes: &[u8],
) -> Result<(), ArchiveStoreError> {
    let name = path.as_bytes();
    let offset = u32::try_from(out.len())
        .map_err(|_| ArchiveStoreError::Format("ZIP exceeds 32-bit V1 offset profile".into()))?;
    let size = u32::try_from(bytes.len()).map_err(|_| {
        ArchiveStoreError::Format("ZIP member exceeds 32-bit V1 size profile".into())
    })?;
    let crc = crc32(bytes);
    le32(out, 0x0403_4b50);
    le16(out, 20);
    le16(out, 0);
    le16(out, 0);
    le16(out, 0);
    le16(out, 0);
    le32(out, crc);
    le32(out, size);
    le32(out, size);
    le16(out, name.len() as u16);
    le16(out, 0);
    out.extend_from_slice(name);
    out.extend_from_slice(bytes);
    le32(central, 0x0201_4b50);
    le16(central, 20);
    le16(central, 20);
    le16(central, 0);
    le16(central, 0);
    le16(central, 0);
    le16(central, 0);
    le32(central, crc);
    le32(central, size);
    le32(central, size);
    le16(central, name.len() as u16);
    le16(central, 0);
    le16(central, 0);
    le16(central, 0);
    le16(central, 0);
    le32(central, 0);
    le32(central, offset);
    central.extend_from_slice(name);
    Ok(())
}

fn preflight_zip_file(file: &mut File) -> Result<ZipPreflight, ArchiveStoreError> {
    let file_len = usize::try_from(file.metadata()?.len()).map_err(|_| {
        ArchiveStoreError::Format("archive exceeds platform addressable size".into())
    })?;
    validate_archive_size(file_len)?;
    let tail_len = file_len.min(65_557);
    file.seek(SeekFrom::End(-(tail_len as i64)))?;
    let mut tail = vec![0; tail_len];
    file.read_exact(&mut tail)?;
    let tail_eocd = find_eocd(&tail)?;
    let eocd = file_len - tail_len + tail_eocd;
    let (count, central_offset, central_size) =
        zip_directory_bounds(&tail, tail_eocd, file_len, eocd)?;
    let mut central = vec![0; central_size];
    file.seek(SeekFrom::Start(central_offset as u64))?;
    file.read_exact(&mut central)?;
    preflight_central_directory(&central, count)?;
    let entries = locate_zip_members(file, &central, count, central_offset)?;
    Ok(ZipPreflight {
        archive_len: file_len,
        entries,
    })
}

fn locate_zip_members(
    file: &mut File,
    central: &[u8],
    count: usize,
    central_offset: usize,
) -> Result<Vec<ZipEntry>, ArchiveStoreError> {
    let mut at = 0;
    let mut entries = Vec::with_capacity(count);
    for _ in 0..count {
        let flags = read_u16(central, checked_offset_add(at, 8, "ZIP central offset")?)?;
        let method = read_u16(central, checked_offset_add(at, 10, "ZIP central offset")?)?;
        let crc = read_u32(central, checked_offset_add(at, 16, "ZIP central offset")?)?;
        let compressed =
            read_u32(central, checked_offset_add(at, 20, "ZIP central offset")?)? as usize;
        let size = read_u32(central, checked_offset_add(at, 24, "ZIP central offset")?)? as usize;
        let name_len =
            read_u16(central, checked_offset_add(at, 28, "ZIP central offset")?)? as usize;
        let name_start = checked_offset_add(at, 46, "ZIP central offset")?;
        let name_end = checked_offset_add(name_start, name_len, "ZIP member name")?;
        let name = std::str::from_utf8(checked_slice(
            central,
            name_start,
            name_end,
            "ZIP member name",
        )?)
        .map_err(|_| ArchiveStoreError::Format("ZIP member name is not UTF-8".into()))?;
        let local_offset =
            read_u32(central, checked_offset_add(at, 42, "ZIP central offset")?)? as usize;

        let mut local = [0u8; 30];
        read_file_exact_at(file, local_offset, &mut local)?;
        if read_u32(&local, 0)? != 0x0403_4b50
            || read_u16(&local, 4)?
                != read_u16(central, checked_offset_add(at, 6, "ZIP central offset")?)?
            || read_u16(&local, 6)? != flags
            || read_u16(&local, 8)? != method
            || read_u16(&local, 10)?
                != read_u16(central, checked_offset_add(at, 12, "ZIP central offset")?)?
            || read_u16(&local, 12)?
                != read_u16(central, checked_offset_add(at, 14, "ZIP central offset")?)?
            || read_u32(&local, 14)? != crc
            || read_u32(&local, 18)? as usize != compressed
            || read_u32(&local, 22)? as usize != size
        {
            return Err(ArchiveStoreError::Format(
                "ZIP local header does not exactly match its central-directory entry".into(),
            ));
        }
        let local_name_len = read_u16(&local, 26)? as usize;
        let local_extra_len = read_u16(&local, 28)? as usize;
        if local_name_len != name_len || local_extra_len != 0 {
            return Err(ArchiveStoreError::Format(
                "ZIP local member name/extra layout is outside the V1 profile".into(),
            ));
        }
        let local_name_start = checked_offset_add(local_offset, 30, "ZIP local offset")?;
        let data_start = local_name_start
            .checked_add(local_name_len)
            .filter(|start| *start <= central_offset)
            .ok_or_else(|| ArchiveStoreError::Format("ZIP local header is truncated".into()))?;
        let mut local_name = vec![0; local_name_len];
        read_file_exact_at(file, local_name_start, &mut local_name)?;
        if local_name != checked_slice(central, name_start, name_end, "ZIP member name")? {
            return Err(ArchiveStoreError::Format(
                "ZIP local member name does not match its central-directory entry".into(),
            ));
        }
        let data_end = data_start
            .checked_add(size)
            .filter(|end| *end <= central_offset)
            .ok_or_else(|| ArchiveStoreError::Format("ZIP member payload is truncated".into()))?;
        entries.push(ZipEntry {
            name: name.to_string(),
            crc,
            local_offset,
            data_start,
            data_end,
        });
        at = checked_offset_add(
            at,
            checked_offset_add(46, name_len, "ZIP central member length")?,
            "ZIP central offset",
        )?;
    }
    entries.sort_unstable_by_key(|entry| entry.local_offset);
    if entries
        .windows(2)
        .any(|pair| pair[1].local_offset < pair[0].data_end)
    {
        return Err(ArchiveStoreError::Format(
            "ZIP local member regions overlap".into(),
        ));
    }
    Ok(entries)
}

fn read_file_exact_at(
    file: &mut File,
    offset: usize,
    bytes: &mut [u8],
) -> Result<(), ArchiveStoreError> {
    file.seek(SeekFrom::Start(offset as u64))?;
    file.read_exact(bytes)?;
    Ok(())
}

fn read_zip_member(file: &mut File, entry: &ZipEntry) -> Result<Vec<u8>, ArchiveStoreError> {
    let len = entry
        .data_end
        .checked_sub(entry.data_start)
        .ok_or_else(|| ArchiveStoreError::Format("ZIP member range underflow".into()))?;
    let mut payload = vec![0; len];
    read_file_exact_at(file, entry.data_start, &mut payload)?;
    if crc32(&payload) != entry.crc {
        return Err(ArchiveStoreError::Integrity(format!(
            "ZIP CRC32 mismatch for `{}`",
            entry.name
        )));
    }
    Ok(payload)
}

fn read_payload_members(
    file: &mut File,
    preflight: &ZipPreflight,
) -> Result<BTreeMap<String, Vec<u8>>, ArchiveStoreError> {
    let mut entries = BTreeMap::new();
    for entry in &preflight.entries {
        if entry.name != MANIFEST_MEMBER {
            let payload = read_zip_member(file, entry)?;
            if entries.insert(entry.name.clone(), payload).is_some() {
                return Err(ArchiveStoreError::Format(format!(
                    "duplicate ZIP member `{}`",
                    entry.name
                )));
            }
        }
    }
    Ok(entries)
}

fn sha256_file(file: &mut File, expected_len: usize) -> Result<String, ArchiveStoreError> {
    let actual_len = usize::try_from(file.metadata()?.len())
        .map_err(|_| ArchiveStoreError::Format("archive size exceeds platform limits".into()))?;
    if actual_len != expected_len {
        return Err(ArchiveStoreError::Format(
            "archive changed while being read".into(),
        ));
    }
    file.seek(SeekFrom::Start(0))?;
    let mut hasher = Sha256::new();
    let mut remaining = expected_len;
    let mut buffer = [0u8; 64 * 1024];
    while remaining > 0 {
        let chunk = remaining.min(buffer.len());
        file.read_exact(&mut buffer[..chunk])?;
        hasher.update(&buffer[..chunk]);
        remaining -= chunk;
    }
    let mut trailing = [0_u8; 1];
    if file.read(&mut trailing)? != 0
        || usize::try_from(file.metadata()?.len())
            .map_err(|_| ArchiveStoreError::Format("archive size exceeds platform limits".into()))?
            != expected_len
    {
        return Err(ArchiveStoreError::Format(
            "archive changed while being read".into(),
        ));
    }
    Ok(format!("{:x}", hasher.finalize()))
}

fn validate_archive_size(size: usize) -> Result<(), ArchiveStoreError> {
    if size > MAX_ARCHIVE_BYTES {
        return Err(ArchiveStoreError::Format(
            "archive exceeds V1 on-disk size budget before read".into(),
        ));
    }
    Ok(())
}

fn validate_manifest_size(size: usize) -> Result<(), ArchiveStoreError> {
    if size > MAX_MANIFEST_BYTES {
        return Err(ArchiveStoreError::Format(
            "manifest.json exceeds V1 dispatch bootstrap budget".into(),
        ));
    }
    Ok(())
}

/// Serialize into a capped buffer so the writer never first builds an
/// unbounded manifest JSON allocation. The input `Value` is caller-owned; this
/// is the only serialized manifest copy made by the writer.
fn serialize_manifest_bounded(manifest: &Value) -> Result<Vec<u8>, ArchiveStoreError> {
    let mut writer = BoundedManifestWriter::default();
    if let Err(error) = serde_json::to_writer(&mut writer, manifest) {
        if writer.exceeded_budget {
            return Err(ArchiveStoreError::Format(
                "manifest.json exceeds V1 dispatch bootstrap budget before ZIP construction".into(),
            ));
        }
        return Err(ArchiveStoreError::Format(format!(
            "cannot serialize manifest: {error}"
        )));
    }
    validate_manifest_size(writer.bytes.len())?;
    Ok(writer.bytes)
}

#[derive(Default)]
struct BoundedManifestWriter {
    bytes: Vec<u8>,
    exceeded_budget: bool,
}

impl Write for BoundedManifestWriter {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        let end = self
            .bytes
            .len()
            .checked_add(bytes.len())
            .ok_or_else(|| std::io::Error::other("manifest serialization size overflow"))?;
        if end > MAX_MANIFEST_BYTES {
            self.exceeded_budget = true;
            return Err(std::io::Error::other("manifest exceeds bootstrap budget"));
        }
        self.bytes.extend_from_slice(bytes);
        Ok(bytes.len())
    }

    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

fn zip_directory_bounds(
    bytes: &[u8],
    eocd: usize,
    archive_len: usize,
    absolute_eocd: usize,
) -> Result<(usize, usize, usize), ArchiveStoreError> {
    if read_u32(bytes, eocd)? != 0x0605_4b50
        || read_u16(bytes, checked_offset_add(eocd, 4, "ZIP EOCD offset")?)? != 0
        || read_u16(bytes, checked_offset_add(eocd, 6, "ZIP EOCD offset")?)? != 0
    {
        return Err(ArchiveStoreError::Format(
            "ZIP EOCD is outside the single-disk V1 profile".into(),
        ));
    }
    let count_on_disk = read_u16(bytes, checked_offset_add(eocd, 8, "ZIP EOCD offset")?)? as usize;
    let count = read_u16(bytes, checked_offset_add(eocd, 10, "ZIP EOCD offset")?)? as usize;
    let central_size = read_u32(bytes, checked_offset_add(eocd, 12, "ZIP EOCD offset")?)? as usize;
    let central_offset =
        read_u32(bytes, checked_offset_add(eocd, 16, "ZIP EOCD offset")?)? as usize;
    if count == 0
        || count != count_on_disk
        || count > MAX_ENTRIES
        || central_size > MAX_ENTRIES * (46 + MAX_ZIP_NAME_BYTES)
        || central_offset
            .checked_add(central_size)
            .filter(|end| *end == absolute_eocd && *end <= archive_len)
            .is_none()
    {
        return Err(ArchiveStoreError::Format(
            "ZIP central directory violates V1 bounds".into(),
        ));
    }
    Ok((count, central_offset, central_size))
}

fn preflight_central_directory(bytes: &[u8], count: usize) -> Result<(), ArchiveStoreError> {
    let mut at = 0;
    let mut total = 0usize;
    let mut names = BTreeSet::new();
    let mut manifests = 0usize;
    for _ in 0..count {
        if read_u32(bytes, at)? != 0x0201_4b50 {
            return Err(ArchiveStoreError::Format(
                "invalid ZIP central-directory member".into(),
            ));
        }
        let flags = read_u16(bytes, checked_offset_add(at, 8, "ZIP central offset")?)?;
        let method = read_u16(bytes, checked_offset_add(at, 10, "ZIP central offset")?)?;
        let compressed =
            read_u32(bytes, checked_offset_add(at, 20, "ZIP central offset")?)? as usize;
        let size = read_u32(bytes, checked_offset_add(at, 24, "ZIP central offset")?)? as usize;
        let name_len = read_u16(bytes, checked_offset_add(at, 28, "ZIP central offset")?)? as usize;
        let extra_len =
            read_u16(bytes, checked_offset_add(at, 30, "ZIP central offset")?)? as usize;
        let comment_len =
            read_u16(bytes, checked_offset_add(at, 32, "ZIP central offset")?)? as usize;
        let disk = read_u16(bytes, checked_offset_add(at, 34, "ZIP central offset")?)?;
        let external = read_u32(bytes, checked_offset_add(at, 38, "ZIP central offset")?)?;
        let end = at
            .checked_add(
                46usize
                    .checked_add(name_len)
                    .and_then(|end| end.checked_add(extra_len))
                    .and_then(|end| end.checked_add(comment_len))
                    .ok_or_else(|| {
                        ArchiveStoreError::Format("ZIP central member length overflow".into())
                    })?,
            )
            .filter(|end| *end <= bytes.len())
            .ok_or_else(|| ArchiveStoreError::Format("truncated ZIP central directory".into()))?;
        if flags != 0
            || method != 0
            || compressed != size
            || extra_len != 0
            || comment_len != 0
            || disk != 0
        {
            return Err(ArchiveStoreError::UnsupportedCapability(
                "only unencrypted stored ZIP members without extras/comments are supported by this native V1 slice".into(),
            ));
        }
        // Unix archives may omit file-type bits while retaining permission
        // bits. When file type is present it must be a regular file. The DOS
        // directory bit is independently checked because it can otherwise
        // disguise a zero-type directory.
        let mode = external >> 16;
        let file_type = mode & 0o170000;
        if !matches!(file_type, 0 | 0o100000) {
            return Err(ArchiveStoreError::Format(
                "ZIP contains a non-regular member".into(),
            ));
        }
        if external & 0x10 != 0 {
            return Err(ArchiveStoreError::Format(
                "ZIP contains a DOS-directory member".into(),
            ));
        }
        let name_start = checked_offset_add(at, 46, "ZIP central offset")?;
        let name_end = checked_offset_add(name_start, name_len, "ZIP member name")?;
        let name = std::str::from_utf8(checked_slice(
            bytes,
            name_start,
            name_end,
            "ZIP member name",
        )?)
        .map_err(|_| ArchiveStoreError::Format("ZIP member name is not UTF-8".into()))?;
        validate_member_path(name)?;
        if !names.insert(name.to_string()) {
            return Err(ArchiveStoreError::Format(format!(
                "duplicate ZIP member `{name}` in central directory"
            )));
        }
        if name == MANIFEST_MEMBER && size > MAX_MANIFEST_BYTES {
            return Err(ArchiveStoreError::Format(
                "manifest.json exceeds V1 dispatch bootstrap budget before read".into(),
            ));
        }
        if name == MANIFEST_MEMBER {
            manifests += 1;
        }
        total = total
            .checked_add(size)
            .ok_or_else(|| ArchiveStoreError::Format("ZIP size overflow".into()))?;
        if size > MAX_MEMBER_BYTES || total > MAX_TOTAL_BYTES {
            return Err(ArchiveStoreError::Format(
                "ZIP member exceeds V1 size budget".into(),
            ));
        }
        at = end;
    }
    if at != bytes.len() {
        return Err(ArchiveStoreError::Format(
            "ZIP central-directory size mismatch".into(),
        ));
    }
    if manifests != 1 {
        return Err(ArchiveStoreError::Format(
            "ZIP must contain exactly one manifest.json dispatch member".into(),
        ));
    }
    Ok(())
}

fn atomic_create(path: &Path, bytes: &[u8]) -> Result<(), ArchiveStoreError> {
    // A bare relative filename has an empty parent component. It still belongs
    // to the current directory, which must be the directory fsynced after the
    // link publication rather than an invalid empty path.
    let parent = match path.parent() {
        Some(parent) if parent.as_os_str().is_empty() => Path::new("."),
        Some(parent) => parent,
        None => {
            return Err(ArchiveStoreError::Format(
                "archive target has no parent directory".into(),
            ));
        }
    };
    fs::create_dir_all(parent)?;
    let filename = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| ArchiveStoreError::Format("archive target name is not UTF-8".into()))?;
    let (temp, mut file) = create_unique_temp(parent, filename)?;
    let result = (|| -> Result<(), ArchiveStoreError> {
        file.write_all(bytes)?;
        file.sync_all()?;
        drop(file);
        // `rename` replaces an existing destination on common platforms, which
        // would turn a target-creation race into data loss. Both names are in
        // the same directory, so a hard link publishes the already-synced
        // inode atomically and fails with AlreadyExists if another writer won.
        match fs::hard_link(&temp, path) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                return Err(ArchiveStoreError::AlreadyExists(path.to_path_buf()));
            }
            Err(error) => return Err(ArchiveStoreError::Io(error)),
        }
        let cleanup = fs::remove_file(&temp).and_then(|()| sync_directory(parent));
        match cleanup {
            Ok(()) => Ok(()),
            Err(error) => Err(ArchiveStoreError::PublishedWithCleanupError {
                path: path.to_path_buf(),
                detail: error.to_string(),
            }),
        }
    })();
    if !matches!(
        result,
        Err(ArchiveStoreError::PublishedWithCleanupError { .. })
    ) {
        let _ = fs::remove_file(&temp);
    }
    result
}

fn create_unique_temp(parent: &Path, filename: &str) -> Result<(PathBuf, File), ArchiveStoreError> {
    for _ in 0..MAX_TEMP_ATTEMPTS {
        let temp = parent.join(format!(
            ".{filename}.tmp-{}-{}",
            std::process::id(),
            TEMP_SEQUENCE.fetch_add(1, Ordering::Relaxed)
        ));
        match OpenOptions::new().write(true).create_new(true).open(&temp) {
            Ok(file) => return Ok((temp, file)),
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(ArchiveStoreError::Io(error)),
        }
    }
    Err(ArchiveStoreError::Io(std::io::Error::new(
        std::io::ErrorKind::AlreadyExists,
        "unable to reserve a unique archive temporary path",
    )))
}

fn object<'a>(
    value: Option<&'a Value>,
    label: &str,
) -> Result<&'a Map<String, Value>, ArchiveStoreError> {
    value
        .and_then(Value::as_object)
        .ok_or_else(|| ArchiveStoreError::Format(format!("{label} must be an object")))
}
/// `serde_json::Value` deliberately keeps the last of duplicate object keys.
/// The frozen contract instead treats each JSON object as closed, so scan the
/// source structure first and reject duplicates (including escaped spellings)
/// before converting it to a Value for the deterministic Rust validator.
///
/// This must remain iterative. A recursive duplicate-key prescan could exhaust
/// the process stack on a small, deeply nested dispatch manifest before
/// serde_json's own recursion guard is reached.
fn parse_manifest_json(bytes: &[u8]) -> Result<Value, ArchiveStoreError> {
    let mut at = 0;
    let mut frames = Vec::new();
    let mut root_complete = false;
    scan_json_value_iterative(bytes, &mut at, &mut frames, &mut root_complete)?;
    while !root_complete {
        let frame = frames.pop().ok_or_else(|| {
            ArchiveStoreError::Format("manifest.json has an incomplete JSON value".into())
        })?;
        match frame {
            JsonScanFrame::Object { mut keys, state } => match state {
                JsonObjectState::KeyOrEnd => {
                    skip_json_whitespace(bytes, &mut at);
                    if bytes.get(at) == Some(&b'}') {
                        at += 1;
                        complete_scanned_json_value(&mut frames, &mut root_complete)?;
                    } else if bytes.get(at) == Some(&b'"') {
                        let (start, end) = scan_json_string(bytes, &mut at)?;
                        let key: String =
                            serde_json::from_slice(&bytes[start..end]).map_err(|error| {
                                ArchiveStoreError::Format(format!(
                                    "manifest.json has an invalid object key: {error}"
                                ))
                            })?;
                        if !keys.insert(key.clone()) {
                            return Err(ArchiveStoreError::Format(format!(
                                "manifest.json has duplicate object key `{key}`"
                            )));
                        }
                        frames.push(JsonScanFrame::Object {
                            keys,
                            state: JsonObjectState::Colon,
                        });
                    } else {
                        return Err(ArchiveStoreError::Format(
                            "manifest.json object key must be a string".into(),
                        ));
                    }
                }
                JsonObjectState::Colon => {
                    skip_json_whitespace(bytes, &mut at);
                    if bytes.get(at) != Some(&b':') {
                        return Err(ArchiveStoreError::Format(
                            "manifest.json object key lacks ':'".into(),
                        ));
                    }
                    at += 1;
                    frames.push(JsonScanFrame::Object {
                        keys,
                        state: JsonObjectState::Value,
                    });
                    scan_json_value_iterative(bytes, &mut at, &mut frames, &mut root_complete)?;
                }
                JsonObjectState::Value => {
                    return Err(ArchiveStoreError::Format(
                        "manifest.json object is truncated".into(),
                    ));
                }
                JsonObjectState::CommaOrEnd => {
                    skip_json_whitespace(bytes, &mut at);
                    match bytes.get(at) {
                        Some(b',') => {
                            at += 1;
                            frames.push(JsonScanFrame::Object {
                                keys,
                                state: JsonObjectState::KeyOrEnd,
                            });
                        }
                        Some(b'}') => {
                            at += 1;
                            complete_scanned_json_value(&mut frames, &mut root_complete)?;
                        }
                        _ => {
                            return Err(ArchiveStoreError::Format(
                                "manifest.json object is truncated".into(),
                            ));
                        }
                    }
                }
            },
            JsonScanFrame::Array(state) => match state {
                JsonArrayState::ValueOrEnd => {
                    skip_json_whitespace(bytes, &mut at);
                    if bytes.get(at) == Some(&b']') {
                        at += 1;
                        complete_scanned_json_value(&mut frames, &mut root_complete)?;
                    } else {
                        frames.push(JsonScanFrame::Array(JsonArrayState::Value));
                        scan_json_value_iterative(bytes, &mut at, &mut frames, &mut root_complete)?;
                    }
                }
                JsonArrayState::Value => {
                    return Err(ArchiveStoreError::Format(
                        "manifest.json array is truncated".into(),
                    ));
                }
                JsonArrayState::CommaOrEnd => {
                    skip_json_whitespace(bytes, &mut at);
                    match bytes.get(at) {
                        Some(b',') => {
                            at += 1;
                            frames.push(JsonScanFrame::Array(JsonArrayState::ValueOrEnd));
                        }
                        Some(b']') => {
                            at += 1;
                            complete_scanned_json_value(&mut frames, &mut root_complete)?;
                        }
                        _ => {
                            return Err(ArchiveStoreError::Format(
                                "manifest.json array is truncated".into(),
                            ));
                        }
                    }
                }
            },
        }
    }
    skip_json_whitespace(bytes, &mut at);
    if at != bytes.len() {
        return Err(ArchiveStoreError::Format(
            "manifest.json has trailing JSON data".into(),
        ));
    }
    serde_json::from_slice(bytes)
        .map_err(|error| ArchiveStoreError::Format(format!("manifest.json is not JSON: {error}")))
}

enum JsonScanFrame {
    Object {
        keys: BTreeSet<String>,
        state: JsonObjectState,
    },
    Array(JsonArrayState),
}

enum JsonObjectState {
    KeyOrEnd,
    Colon,
    Value,
    CommaOrEnd,
}

enum JsonArrayState {
    ValueOrEnd,
    Value,
    CommaOrEnd,
}

fn scan_json_value_iterative(
    bytes: &[u8],
    at: &mut usize,
    frames: &mut Vec<JsonScanFrame>,
    root_complete: &mut bool,
) -> Result<(), ArchiveStoreError> {
    skip_json_whitespace(bytes, at);
    match bytes.get(*at) {
        Some(b'{') => {
            push_json_frame(
                frames,
                JsonScanFrame::Object {
                    keys: BTreeSet::new(),
                    state: JsonObjectState::KeyOrEnd,
                },
            )?;
            *at += 1;
            Ok(())
        }
        Some(b'[') => {
            push_json_frame(frames, JsonScanFrame::Array(JsonArrayState::ValueOrEnd))?;
            *at += 1;
            Ok(())
        }
        Some(b'"') => {
            scan_json_string(bytes, at)?;
            complete_scanned_json_value(frames, root_complete)
        }
        Some(_) => {
            let start = *at;
            while bytes.get(*at).is_some_and(|byte| !is_json_delimiter(*byte)) {
                *at += 1;
            }
            if *at == start {
                return Err(ArchiveStoreError::Format(
                    "manifest.json has an invalid JSON value".into(),
                ));
            }
            complete_scanned_json_value(frames, root_complete)
        }
        None => Err(ArchiveStoreError::Format(
            "manifest.json is truncated".into(),
        )),
    }
}

fn push_json_frame(
    frames: &mut Vec<JsonScanFrame>,
    frame: JsonScanFrame,
) -> Result<(), ArchiveStoreError> {
    if frames.len() >= MAX_MANIFEST_JSON_NESTING {
        return Err(ArchiveStoreError::Format(format!(
            "manifest.json nesting exceeds the V1 structural limit of {MAX_MANIFEST_JSON_NESTING}"
        )));
    }
    frames.push(frame);
    Ok(())
}

fn complete_scanned_json_value(
    frames: &mut [JsonScanFrame],
    root_complete: &mut bool,
) -> Result<(), ArchiveStoreError> {
    let Some(parent) = frames.last_mut() else {
        *root_complete = true;
        return Ok(());
    };
    match parent {
        JsonScanFrame::Object { state, .. } if matches!(state, JsonObjectState::Value) => {
            *state = JsonObjectState::CommaOrEnd;
            Ok(())
        }
        JsonScanFrame::Array(state) if matches!(state, JsonArrayState::Value) => {
            *state = JsonArrayState::CommaOrEnd;
            Ok(())
        }
        _ => Err(ArchiveStoreError::Format(
            "manifest.json has an invalid JSON value position".into(),
        )),
    }
}

fn scan_json_string(bytes: &[u8], at: &mut usize) -> Result<(usize, usize), ArchiveStoreError> {
    let start = *at;
    *at += 1;
    loop {
        match bytes.get(*at) {
            Some(b'"') => {
                *at += 1;
                return Ok((start, *at));
            }
            Some(b'\\') => {
                *at = (*at).checked_add(2).ok_or_else(|| {
                    ArchiveStoreError::Format("manifest.json string offset overflow".into())
                })?;
            }
            Some(_) => *at += 1,
            None => {
                return Err(ArchiveStoreError::Format(
                    "manifest.json string is truncated".into(),
                ))
            }
        }
    }
}

fn skip_json_whitespace(bytes: &[u8], at: &mut usize) {
    while bytes
        .get(*at)
        .is_some_and(|byte| byte.is_ascii_whitespace())
    {
        *at += 1;
    }
}
fn is_json_delimiter(byte: u8) -> bool {
    byte.is_ascii_whitespace() || matches!(byte, b',' | b']' | b'}')
}
fn object_mut<'a>(
    value: &'a mut Value,
    label: &str,
) -> Result<&'a mut Map<String, Value>, ArchiveStoreError> {
    value
        .as_object_mut()
        .ok_or_else(|| ArchiveStoreError::Format(format!("{label} must be an object")))
}
fn required_id<'a>(
    object: &'a Map<String, Value>,
    key: &str,
    label: &str,
) -> Result<&'a str, ArchiveStoreError> {
    let value = required_string(object, key, label)?;
    if !is_id(value) {
        return Err(ArchiveStoreError::Format(format!(
            "{label}.{key} must be a V1 identifier"
        )));
    }
    Ok(value)
}
fn required_string<'a>(
    object: &'a Map<String, Value>,
    key: &str,
    label: &str,
) -> Result<&'a str, ArchiveStoreError> {
    object
        .get(key)
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            ArchiveStoreError::Format(format!("{label}.{key} must be a non-empty string"))
        })
}
fn require_exact_keys(
    object: &Map<String, Value>,
    allowed: &[&str],
    label: &str,
) -> Result<(), ArchiveStoreError> {
    require_known_keys(object, allowed, label)?;
    require_required_keys(object, allowed, label)
}
fn require_known_keys(
    object: &Map<String, Value>,
    allowed: &[&str],
    label: &str,
) -> Result<(), ArchiveStoreError> {
    if let Some(key) = object.keys().find(|key| !allowed.contains(&key.as_str())) {
        return Err(ArchiveStoreError::Format(format!(
            "{label} contains unknown key `{key}`"
        )));
    }
    Ok(())
}
fn require_required_keys(
    object: &Map<String, Value>,
    required: &[&str],
    label: &str,
) -> Result<(), ArchiveStoreError> {
    if let Some(key) = required.iter().find(|key| !object.contains_key(**key)) {
        return Err(ArchiveStoreError::Format(format!(
            "{label} is missing required key `{key}`"
        )));
    }
    Ok(())
}
fn is_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'.' | b':' | b'-'))
}
fn require_sha256(value: Option<&Value>, label: &str) -> Result<(), ArchiveStoreError> {
    let value = value
        .and_then(Value::as_str)
        .ok_or_else(|| ArchiveStoreError::Format(format!("{label} must be a SHA-256 string")))?;
    if value.len() != 64
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
    {
        return Err(ArchiveStoreError::Format(format!(
            "{label} must be lowercase SHA-256"
        )));
    }
    Ok(())
}
fn require_optional_sha256(value: Option<&Value>, label: &str) -> Result<(), ArchiveStoreError> {
    match value {
        Some(Value::Null) => Ok(()),
        Some(value) => require_sha256(Some(value), label),
        None => Err(ArchiveStoreError::Format(format!("{label} is required"))),
    }
}
fn require_semantic_profile(value: Option<&Value>, label: &str) -> Result<(), ArchiveStoreError> {
    if matches!(
        value.and_then(Value::as_str),
        Some(
            "dagml_tcv1"
                | "dagml_historical_serde_json_v1"
                | "methods_rfc8785_jcs"
                | "host_opaque"
                | "none"
        )
    ) {
        Ok(())
    } else {
        Err(ArchiveStoreError::Format(format!(
            "{label} is outside the frozen V1 enum"
        )))
    }
}
fn validate_member_path(path: &str) -> Result<(), ArchiveStoreError> {
    if path.is_empty()
        || path.chars().count() > 512
        || path.nfc().ne(path.chars())
        || path.starts_with('/')
        || path.contains('\\')
        || path.contains(':')
        || path.bytes().any(|byte| byte < 0x20 || byte == 0x7f)
        || path.split('/').any(|segment| {
            segment.is_empty()
                || segment == "."
                || segment == ".."
                || segment.ends_with('.')
                || segment.ends_with(' ')
                || is_dos_reserved_device_name(segment)
        })
    {
        return Err(ArchiveStoreError::Format(format!(
            "unsafe archive member path `{path}`"
        )));
    }
    Ok(())
}

fn is_dos_reserved_device_name(segment: &str) -> bool {
    let basename = segment.split_once('.').map_or(segment, |(name, _)| name);
    let name = basename.to_ascii_lowercase();
    matches!(name.as_str(), "con" | "prn" | "aux" | "nul")
        || matches!(
            name.as_bytes(),
            [b'c', b'o', b'm', b'1'..=b'9'] | [b'l', b'p', b't', b'1'..=b'9']
        )
}
fn sha256_hex(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn le16(out: &mut Vec<u8>, value: u16) {
    out.extend_from_slice(&value.to_le_bytes());
}
fn le32(out: &mut Vec<u8>, value: u32) {
    out.extend_from_slice(&value.to_le_bytes());
}
fn read_u16(bytes: &[u8], offset: usize) -> Result<u16, ArchiveStoreError> {
    let value = checked_range(bytes, offset, 2, "truncated ZIP integer")?;
    Ok(u16::from_le_bytes([value[0], value[1]]))
}
fn read_u32(bytes: &[u8], offset: usize) -> Result<u32, ArchiveStoreError> {
    let value = checked_range(bytes, offset, 4, "truncated ZIP integer")?;
    Ok(u32::from_le_bytes([value[0], value[1], value[2], value[3]]))
}
fn checked_offset_add(
    offset: usize,
    additional: usize,
    label: &str,
) -> Result<usize, ArchiveStoreError> {
    offset
        .checked_add(additional)
        .ok_or_else(|| ArchiveStoreError::Format(format!("{label} overflow")))
}
fn checked_range<'a>(
    bytes: &'a [u8],
    offset: usize,
    length: usize,
    label: &str,
) -> Result<&'a [u8], ArchiveStoreError> {
    let end = checked_offset_add(offset, length, label)?;
    bytes
        .get(offset..end)
        .ok_or_else(|| ArchiveStoreError::Format(label.into()))
}
fn checked_slice<'a>(
    bytes: &'a [u8],
    start: usize,
    end: usize,
    label: &str,
) -> Result<&'a [u8], ArchiveStoreError> {
    bytes
        .get(start..end)
        .ok_or_else(|| ArchiveStoreError::Format(format!("truncated {label}")))
}
fn find_eocd(bytes: &[u8]) -> Result<usize, ArchiveStoreError> {
    let start = bytes.len().saturating_sub(65_557);
    for index in (start..bytes.len().saturating_sub(3)).rev() {
        if checked_range(bytes, index, 4, "truncated ZIP EOCD")? == [0x50, 0x4b, 0x05, 0x06] {
            let comment =
                read_u16(bytes, checked_offset_add(index, 20, "ZIP EOCD offset")?)? as usize;
            if checked_offset_add(
                checked_offset_add(index, 22, "ZIP EOCD offset")?,
                comment,
                "ZIP EOCD comment",
            )? == bytes.len()
            {
                return Ok(index);
            }
        }
    }
    Err(ArchiveStoreError::Format(
        "ZIP end-of-central-directory is absent".into(),
    ))
}
fn crc32(bytes: &[u8]) -> u32 {
    let mut crc = 0xffff_ffffu32;
    for byte in bytes {
        crc ^= u32::from(*byte);
        for _ in 0..8 {
            crc = if crc & 1 != 0 {
                (crc >> 1) ^ 0xedb8_8320
            } else {
                crc >> 1
            };
        }
    }
    !crc
}

#[cfg(test)]
mod tests {
    use super::*;

    type RequestMutation = Box<dyn Fn(&mut ArchiveV1WriteRequest)>;

    fn fingerprint(seed: char) -> String {
        std::iter::repeat_n(seed, 64).collect()
    }
    fn replay_ref(
        path: &str,
        schema: &str,
        version: u64,
        profile: &str,
        port: bool,
        seed: char,
    ) -> Value {
        let mut value = serde_json::json!({"owner":"dag-ml","schema_id":schema,"schema_version":version,"member_path":path,"raw_sha256":fingerprint('0'),"semantic_fingerprint":fingerprint(seed),"semantic_profile":profile});
        if port {
            value["producer_port_required"] = Value::Bool(true);
        }
        value
    }
    fn request() -> ArchiveV1WriteRequest {
        let refs = [
            (
                "portable_predictor_package",
                "dagml/portable_predictor_package.json",
                PORTABLE_PACKAGE_SCHEMA,
                1,
                "dagml_tcv1",
                false,
                'a',
            ),
            (
                "graph",
                "dagml/graph.json",
                GRAPH_SCHEMA,
                1,
                "dagml_historical_serde_json_v1",
                false,
                'b',
            ),
            (
                "execution_bundle",
                "dagml/execution_bundle.json",
                EXECUTION_BUNDLE_SCHEMA,
                2,
                "dagml_tcv1",
                true,
                'c',
            ),
            (
                "training_outcome",
                "dagml/training_outcome.json",
                TRAINING_OUTCOME_SCHEMA,
                2,
                "dagml_tcv1",
                true,
                'd',
            ),
            (
                "prediction_cache_payload_set",
                "dagml/prediction_cache_payload_set.json",
                CACHE_SET_SCHEMA,
                2,
                "dagml_historical_serde_json_v1",
                true,
                'e',
            ),
            (
                "score_set",
                "dagml/score_set.json",
                SCORE_SET_SCHEMA,
                2,
                "dagml_historical_serde_json_v1",
                true,
                'f',
            ),
        ];
        let mut artifacts = Map::new();
        let mut package = Value::Null;
        let mut inventory = Vec::new();
        let mut payloads = Vec::new();
        for (key, path, schema, version, profile, port, seed) in refs {
            let reference = replay_ref(path, schema, version, profile, port, seed);
            if key == "portable_predictor_package" {
                package = reference;
            } else {
                artifacts.insert(key.to_string(), reference);
            }
            inventory.push(serde_json::json!({"path":path,"regular_file":true,"raw_sha256":fingerprint('0'),"uncompressed_size_bytes":0,"semantic_fingerprint":fingerprint(seed),"semantic_profile":profile}));
            payloads.push(ArchivePayload {
                path: path.into(),
                bytes: format!("{{\"declared\":\"{key}\"}}").into_bytes(),
            });
        }
        ArchiveV1WriteRequest {
            manifest: serde_json::json!({
                "schema_version":1,"profile":PROFILE,"archive_id":"archive:test","persistence_kind":"n4a_archive",
                "writer":{"product_aggregate_owner":"nirs4all-core","canonical_writer_id":WRITER_ID},
                "reader_dispatch":{"archive_v1":{"accepted_versions":[1],"future_versions":"refuse","dispatch_before_extraction":true},"legacy_n4a":{"form":"historical_n4a_zip","manifest_member":"manifest.json","reader_id":"nirs4all.pipeline.bundle.loader.BundleLoader","maximum_bundle_format_version":"1.0","migration_direction":"legacy_to_v1_copy_on_write_only"}},
                "physical_profile":{"container":"zip","manifest_member":"manifest.json","regular_files_only":true,"limits":{"max_entries":256,"max_total_uncompressed_bytes":536870912u64,"max_member_uncompressed_bytes":134217728u64,"max_compression_ratio":100}},
                "replay":{"portable_predictor_package":package,"training_artifacts":Value::Object(artifacts),"future_artifacts":[]},
                "payloads":{"methods":{"n4mm":[],"n4mopt":[]},"n4d_aggregate_reference":null,"conformal":null,"robustness":null,"host_artifacts":[]},
                "member_inventory":inventory,"migration_provenance":null,"security":{"integrity_profile":"sha256_raw_member_inventory_v1","signature":null},"workspace":null
            }),
            payloads,
        }
    }

    fn add_conformal_metadata(request: &mut ArchiveV1WriteRequest) {
        let member_path = "dagml/conformal.json";
        let bytes = b"{\"calibration\":\"identity-bound\"}".to_vec();
        let reference = replay_ref(
            member_path,
            "https://github.com/GBeurier/dag-ml/schemas/conformal_calibration.v1.schema.json",
            1,
            "dagml_tcv1",
            false,
            '7',
        );
        request.manifest["payloads"]["conformal"] = reference;
        request.manifest["member_inventory"]
            .as_array_mut()
            .unwrap()
            .push(serde_json::json!({
                "path": member_path,
                "regular_file": true,
                "raw_sha256": fingerprint('0'),
                "uncompressed_size_bytes": 0,
                "semantic_fingerprint": fingerprint('7'),
                "semantic_profile": "dagml_tcv1"
            }));
        request.payloads.push(ArchivePayload {
            path: member_path.into(),
            bytes,
        });
    }

    fn add_robustness_metadata(request: &mut ArchiveV1WriteRequest) {
        let member_path = "dagml/robustness.json";
        let bytes = b"{\"report\":\"identity-bound\"}".to_vec();
        let reference = replay_ref(
            member_path,
            "https://github.com/GBeurier/dag-ml/schemas/robustness_report.v1.schema.json",
            1,
            "dagml_tcv1",
            false,
            '8',
        );
        request.manifest["payloads"]["robustness"] = reference;
        request.manifest["member_inventory"]
            .as_array_mut()
            .unwrap()
            .push(serde_json::json!({
                "path": member_path,
                "regular_file": true,
                "raw_sha256": fingerprint('0'),
                "uncompressed_size_bytes": 0,
                "semantic_fingerprint": fingerprint('8'),
                "semantic_profile": "dagml_tcv1"
            }));
        request.payloads.push(ArchivePayload {
            path: member_path.into(),
            bytes,
        });
    }
    fn temp_file(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "nirs4all-core-{name}-{}-{}.n4a",
            std::process::id(),
            TEMP_SEQUENCE.fetch_add(1, Ordering::Relaxed)
        ))
    }

    fn workspace_snapshot_request() -> ArchiveV1WriteRequest {
        let mut request = request();
        let workspace_payloads = [
            (
                "sqlite",
                Value::Null,
                "workspace/snapshot.sqlite",
                &b"sqlite"[..],
            ),
            (
                "ordinary",
                Value::String("run_a".into()),
                "workspace/runs/run_a/records.json",
                &b"records"[..],
            ),
        ];
        let mut inventory = Vec::new();
        for (kind, run_id, path, bytes) in workspace_payloads {
            let raw_sha256 = sha256_hex(bytes);
            inventory.push(serde_json::json!({
                "kind":kind,"run_id":run_id,"member_path":path,"raw_sha256":raw_sha256,
                "semantic_fingerprint":null,"semantic_profile":"host_opaque"
            }));
            request.manifest["member_inventory"]
                .as_array_mut()
                .unwrap()
                .push(serde_json::json!({
                    "path":path,"regular_file":true,"raw_sha256":raw_sha256,
                    "uncompressed_size_bytes":bytes.len(),"semantic_fingerprint":null,
                    "semantic_profile":"host_opaque"
                }));
            request.payloads.push(ArchivePayload {
                path: path.into(),
                bytes: bytes.to_vec(),
            });
        }
        request.manifest["persistence_kind"] = Value::String("workspace_snapshot".into());
        request.manifest["workspace"] = serde_json::json!({
            "layout":"sqlite_parquet_artifacts_v1",
            "snapshot_protocol":{
                "checkpoint_id":"checkpoint_a","transaction_id":"transaction_a",
                "run_ids":["run_a"],"inventory_complete":true
            },
            "payload_inventory":inventory,
            "exclusions":["workspace/.session.lock","workspace/live-session/**"]
        });
        request
    }

    fn unvalidated_zip(request: ArchiveV1WriteRequest) -> Vec<u8> {
        let ArchiveV1WriteRequest { manifest, payloads } = request;
        let payloads = payloads
            .into_iter()
            .map(|payload| (payload.path, payload.bytes))
            .collect::<BTreeMap<_, _>>();
        write_stored_zip(&manifest, &payloads).unwrap()
    }

    fn manifest_only_zip(manifest: &[u8]) -> Vec<u8> {
        let mut out = Vec::new();
        let mut central = Vec::new();
        append_stored_zip_member(&mut out, &mut central, MANIFEST_MEMBER, manifest).unwrap();
        let central_offset = out.len() as u32;
        let central_size = central.len() as u32;
        out.extend_from_slice(&central);
        le32(&mut out, 0x0605_4b50);
        le16(&mut out, 0);
        le16(&mut out, 0);
        le16(&mut out, 1);
        le16(&mut out, 1);
        le32(&mut out, central_size);
        le32(&mut out, central_offset);
        le16(&mut out, 0);
        out
    }

    // Byte-for-byte copies of the DAG-ML frozen V1 corpus. Keeping them in
    // this crate avoids a sibling-checkout test dependency; PROVENANCE.md
    // records the source paths and these exact source-byte SHA-256 values.
    const PORTABLE_CONTRACT_FIXTURE: &str =
        include_str!("archive_v1_fixtures/positive/portable_split_conformal.json");
    const WORKSPACE_CONTRACT_FIXTURE: &str =
        include_str!("archive_v1_fixtures/positive/workspace_n4d_host_sidecar.json");
    const REFUSAL_CONTRACT_FIXTURE: &str =
        include_str!("archive_v1_fixtures/negative/refusals.v1.json");
    const ARCHIVE_V1_CONTRACT_SCHEMA: &str =
        include_str!("archive_v1_fixtures/archive_workspace_manifest.v1.schema.json");
    const PORTABLE_CONTRACT_FIXTURE_SHA256: &str =
        "79acef8a6bedee201c9e7be7a398bf7ec0ef6de2c75777824ec9ec0633b4c451";
    const WORKSPACE_CONTRACT_FIXTURE_SHA256: &str =
        "6c3d678e955258a2f652c886d86358d4775dc98e9e85714166d88ad0e16b13ca";
    const REFUSAL_CONTRACT_FIXTURE_SHA256: &str =
        "d6522da50d8debc87b5c824392d793fd8895e4822ebe80289199a246f502ded5";
    const ARCHIVE_V1_CONTRACT_SCHEMA_SHA256: &str =
        "91daa7209843ab9043aa62a50200ff43b0f85f4c4e61ad8f73aa67b65a0a98dc";

    fn contract_fixture(name: &str) -> Value {
        let bytes = match name {
            "portable_split_conformal.json" => PORTABLE_CONTRACT_FIXTURE,
            "workspace_n4d_host_sidecar.json" => WORKSPACE_CONTRACT_FIXTURE,
            other => panic!("unknown archive contract fixture {other}"),
        };
        serde_json::from_str(bytes).unwrap_or_else(|error| {
            panic!("checked-in archive V1 fixture {name} is not JSON: {error}")
        })
    }

    fn refusal_contract_cases() -> Vec<Value> {
        serde_json::from_str::<Value>(REFUSAL_CONTRACT_FIXTURE)
            .expect("checked-in archive V1 refusal fixture is JSON")["cases"]
            .as_array()
            .expect("checked-in archive V1 refusal fixture has cases")
            .clone()
    }

    fn rebind_fixture_reference_hashes(value: &mut Value, payloads: &BTreeMap<String, Vec<u8>>) {
        match value {
            Value::Object(object) => {
                if let Some(path) = object.get("member_path").and_then(Value::as_str) {
                    if object.contains_key("raw_sha256") {
                        if let Some(bytes) = payloads.get(path) {
                            object.insert("raw_sha256".into(), Value::String(sha256_hex(bytes)));
                        }
                    }
                }
                for nested in object.values_mut() {
                    rebind_fixture_reference_hashes(nested, payloads);
                }
            }
            Value::Array(values) => {
                for nested in values {
                    rebind_fixture_reference_hashes(nested, payloads);
                }
            }
            _ => {}
        }
    }

    fn protected_inventory_fields(case: &Value) -> BTreeSet<(usize, String)> {
        let fallback;
        let mutations = if let Some(mutations) = case.get("mutations").and_then(Value::as_array) {
            mutations
        } else {
            fallback = vec![case.clone()];
            &fallback
        };
        mutations
            .iter()
            .filter_map(|mutation| {
                let path = mutation.get("mutation")?.as_array()?;
                let index = path.get(1)?.as_u64()? as usize;
                let field = path.get(2)?.as_str()?;
                (path.first()?.as_str() == Some("member_inventory")
                    && matches!(field, "raw_sha256" | "uncompressed_size_bytes"))
                .then(|| (index, field.to_string()))
            })
            .collect()
    }

    /// Materialize the exact frozen manifest shape as a small stored ZIP.
    /// Contract examples intentionally carry illustrative payload metadata, so
    /// all non-refusal raw hashes/sizes are rebound to these physical bytes.
    /// The mutation under test remains untouched, exactly as in DAG-ML's
    /// physical contract regression gate.
    fn materialize_contract_fixture(
        manifest: &Value,
        preserve: &BTreeSet<(usize, String)>,
    ) -> Vec<u8> {
        let mut manifest = manifest.clone();
        let payloads = manifest["member_inventory"]
            .as_array()
            .expect("fixture inventory is an array")
            .iter()
            .map(|member| {
                let path = member["path"].as_str().expect("fixture path is a string");
                (
                    path.to_string(),
                    format!("STORE-001 materialized fixture payload: {path}\\n").into_bytes(),
                )
            })
            .collect::<BTreeMap<_, _>>();
        for (index, member) in manifest["member_inventory"]
            .as_array_mut()
            .expect("fixture inventory is mutable")
            .iter_mut()
            .enumerate()
        {
            let path = member["path"].as_str().expect("fixture path is a string");
            let bytes = payloads.get(path).expect("fixture payload exists");
            if !preserve.contains(&(index, "raw_sha256".to_string())) {
                member["raw_sha256"] = Value::String(sha256_hex(bytes));
            }
            if !preserve.contains(&(index, "uncompressed_size_bytes".to_string())) {
                member["uncompressed_size_bytes"] = Value::from(bytes.len() as u64);
            }
        }
        rebind_fixture_reference_hashes(&mut manifest, &payloads);
        write_stored_zip(&manifest, &payloads).expect("fixture ZIP materializes")
    }

    fn fixture_path_mut<'a>(mut value: &'a mut Value, path: &[Value]) -> &'a mut Value {
        for component in path {
            value = match component {
                Value::String(key) => value.get_mut(key).unwrap(),
                Value::Number(index) => value
                    .as_array_mut()
                    .unwrap()
                    .get_mut(index.as_u64().unwrap() as usize)
                    .unwrap(),
                other => panic!("fixture mutation path component is invalid: {other}"),
            };
        }
        value
    }

    fn apply_contract_fixture_mutations(manifest: &mut Value, case: &Value) {
        let one_mutation;
        let mutations = if let Some(mutations) = case.get("mutations").and_then(Value::as_array) {
            mutations
        } else {
            one_mutation = vec![serde_json::json!({
                "mutation": case["mutation"].clone(),
                "value": case["value"].clone(),
            })];
            &one_mutation
        };
        for mutation in mutations {
            let path = mutation["mutation"].as_array().unwrap();
            match mutation
                .get("operation")
                .and_then(Value::as_str)
                .unwrap_or("set")
            {
                "set" => {
                    let (last, parent) = path.split_last().unwrap();
                    match last {
                        Value::String(key) => {
                            fixture_path_mut(manifest, parent)
                                .as_object_mut()
                                .unwrap()
                                .insert(key.clone(), mutation["value"].clone());
                        }
                        Value::Number(index) => {
                            *fixture_path_mut(manifest, parent)
                                .as_array_mut()
                                .unwrap()
                                .get_mut(index.as_u64().unwrap() as usize)
                                .unwrap() = mutation["value"].clone();
                        }
                        other => panic!("fixture mutation path component is invalid: {other}"),
                    }
                }
                "append" => fixture_path_mut(manifest, path)
                    .as_array_mut()
                    .unwrap()
                    .push(mutation["value"].clone()),
                "remove" => {
                    let (last, parent) = path.split_last().unwrap();
                    match last {
                        Value::String(key) => {
                            fixture_path_mut(manifest, parent)
                                .as_object_mut()
                                .unwrap()
                                .remove(key)
                                .unwrap();
                        }
                        Value::Number(index) => {
                            fixture_path_mut(manifest, parent)
                                .as_array_mut()
                                .unwrap()
                                .remove(index.as_u64().unwrap() as usize);
                        }
                        other => panic!("fixture mutation path component is invalid: {other}"),
                    }
                }
                other => panic!("unknown fixture mutation operation {other}"),
            }
        }
    }

    fn replace_workspace_payload_path(
        request: &mut ArchiveV1WriteRequest,
        original: &str,
        replacement: &str,
    ) {
        request.manifest["workspace"]["payload_inventory"]
            .as_array_mut()
            .unwrap()
            .iter_mut()
            .find(|payload| payload["member_path"] == original)
            .unwrap()["member_path"] = Value::String(replacement.into());
        request.manifest["member_inventory"]
            .as_array_mut()
            .unwrap()
            .iter_mut()
            .find(|member| member["path"] == original)
            .unwrap()["path"] = Value::String(replacement.into());
        request
            .payloads
            .iter_mut()
            .find(|payload| payload.path == original)
            .unwrap()
            .path = replacement.into();
    }

    fn append_central_metadata(out: &mut Vec<u8>, name: &str, size: u32, external: u32) {
        le32(out, 0x0201_4b50);
        le16(out, 20);
        le16(out, 20);
        le16(out, 0);
        le16(out, 0);
        le16(out, 0);
        le16(out, 0);
        le32(out, 0);
        le32(out, size);
        le32(out, size);
        le16(out, name.len() as u16);
        le16(out, 0);
        le16(out, 0);
        le16(out, 0);
        le16(out, 0);
        le32(out, external);
        le32(out, 0);
        out.extend_from_slice(name.as_bytes());
    }

    fn metadata_only_zip(entries: &[(&str, u32, u32)]) -> Vec<u8> {
        let mut central = Vec::new();
        for (name, size, external) in entries {
            append_central_metadata(&mut central, name, *size, *external);
        }
        let mut zip = central.clone();
        le32(&mut zip, 0x0605_4b50);
        le16(&mut zip, 0);
        le16(&mut zip, 0);
        le16(&mut zip, entries.len() as u16);
        le16(&mut zip, entries.len() as u16);
        le32(&mut zip, central.len() as u32);
        le32(&mut zip, 0);
        le16(&mut zip, 0);
        zip
    }

    #[test]
    fn archive_v1_atomically_round_trips_and_refuses_predict_without_executor() {
        let path = temp_file("roundtrip");
        let reference = write_archive_v1(&path, request()).unwrap();
        assert!(path.is_file());
        let archive = load_archive_v1(&path).unwrap();
        assert_eq!(archive.reference, reference);
        assert_eq!(
            archive.portable_predictor_package().unwrap(),
            b"{\"declared\":\"portable_predictor_package\"}"
        );
        assert!(matches!(
            archive.predict(&[1.0, 2.0], 2),
            Err(ArchiveStoreError::UnsupportedCapability(_))
        ));
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn archive_v1_refuses_tampered_payload_and_invalid_request_before_write() {
        let path = temp_file("tamper");
        write_archive_v1(&path, request()).unwrap();
        let mut bytes = fs::read(&path).unwrap();
        let needle = b"{\"declared\":\"portable_predictor_package\"}";
        let offset = bytes
            .windows(needle.len())
            .position(|window| window == needle)
            .unwrap();
        bytes[offset] ^= 1;
        fs::write(&path, bytes).unwrap();
        assert!(matches!(
            load_archive_v1(&path),
            Err(ArchiveStoreError::Integrity(_))
        ));
        fs::remove_file(&path).unwrap();

        let invalid = temp_file("invalid");
        let mut request = request();
        request.manifest["schema_version"] = Value::from(2);
        assert!(matches!(
            write_archive_v1(&invalid, request),
            Err(ArchiveStoreError::Format(_))
        ));
        assert!(
            !invalid.exists(),
            "validation must fail before an atomic temp is created"
        );
    }

    #[test]
    fn archive_v1_refuses_same_length_mutation_during_load() {
        let path = temp_file("same-length-mutation");
        write_archive_v1(&path, request()).unwrap();
        let mutation_path = path.clone();
        // This mutation happens after payload bytes have been read. The loader
        // compares complete file hashes instead of trusting filesystem times.
        LOAD_AFTER_PAYLOADS_HOOK.with(|hook| {
            *hook.borrow_mut() = Some(Box::new(move || {
                let mut bytes = fs::read(&mutation_path).unwrap();
                let needle = b"{\"declared\":\"portable_predictor_package\"}";
                let offset = bytes
                    .windows(needle.len())
                    .position(|window| window == needle)
                    .unwrap();
                bytes[offset] ^= 1;
                fs::write(&mutation_path, bytes).unwrap();
            }));
        });

        assert!(matches!(
            load_archive_v1(&path),
            Err(ArchiveStoreError::Format(detail)) if detail == "archive changed while being read"
        ));
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn archive_v1_refuses_append_after_payloads_are_read() {
        let path = temp_file("append-after-payloads");
        write_archive_v1(&path, request()).unwrap();
        let mutation_path = path.clone();
        LOAD_AFTER_PAYLOADS_HOOK.with(|hook| {
            *hook.borrow_mut() = Some(Box::new(move || {
                let mut file = OpenOptions::new()
                    .append(true)
                    .open(&mutation_path)
                    .unwrap();
                file.write_all(b"append").unwrap();
            }));
        });

        assert!(matches!(
            load_archive_v1(&path),
            Err(ArchiveStoreError::Format(detail)) if detail == "archive changed while being read"
        ));
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn archive_v1_refuses_manifest_mutation_after_the_cached_manifest_read() {
        let path = temp_file("manifest-mutation");
        write_archive_v1(&path, request()).unwrap();
        let mutation_path = path.clone();
        LOAD_AFTER_MANIFEST_HOOK.with(|hook| {
            *hook.borrow_mut() = Some(Box::new(move || {
                let mut bytes = fs::read(&mutation_path).unwrap();
                let needle = b"archive:test";
                let offset = bytes
                    .windows(needle.len())
                    .position(|window| window == needle)
                    .unwrap();
                bytes[offset] ^= 1;
                fs::write(&mutation_path, bytes).unwrap();
            }));
        });

        assert!(matches!(
            load_archive_v1(&path),
            Err(ArchiveStoreError::Format(detail)) if detail == "archive changed while being read"
        ));
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn archive_v1_loads_conformal_metadata_for_a_host_view_and_still_refuses_execution() {
        let path = temp_file("conformal-metadata-view");
        let mut request = request();
        add_conformal_metadata(&mut request);
        add_robustness_metadata(&mut request);
        write_archive_v1(&path, request).unwrap();

        let archive = load_archive_v1(&path).unwrap();
        let view = crate::archive_view::archive_view(&archive).unwrap();
        assert_eq!(
            view.conformal.as_ref().unwrap().member_path,
            "dagml/conformal.json"
        );
        assert_eq!(
            view.conformal.as_ref().unwrap().producer_port_required,
            None
        );
        assert_eq!(
            view.conformal.as_ref().unwrap().raw_sha256,
            sha256_hex(b"{\"calibration\":\"identity-bound\"}")
        );
        assert_eq!(
            view.robustness.as_ref().unwrap().member_path,
            "dagml/robustness.json"
        );
        let serialized = serde_json::to_value(&view).unwrap();
        assert_eq!(
            serialized["replay"]["execution_status"],
            "requires_native_artifact_executor"
        );
        assert_eq!(
            serialized["conformal"]["schema_id"],
            "https://github.com/GBeurier/dag-ml/schemas/conformal_calibration.v1.schema.json"
        );
        assert!(matches!(
            archive.predict(&[1.0], 1),
            Err(ArchiveStoreError::UnsupportedCapability(_))
        ));

        let mut bytes = fs::read(&path).unwrap();
        let needle = b"{\"calibration\":\"identity-bound\"}";
        let offset = bytes
            .windows(needle.len())
            .position(|window| window == needle)
            .unwrap();
        bytes[offset] ^= 1;
        fs::write(&path, bytes).unwrap();
        assert!(matches!(
            load_archive_v1(&path),
            Err(ArchiveStoreError::Integrity(_))
        ));
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn archive_v1_dispatches_future_schema_before_opening_a_bad_payload() {
        let path = temp_file("future-schema-before-payload");
        let mut request = request();
        request.manifest["schema_version"] = Value::from(2);
        let mut bytes = unvalidated_zip(request);
        let needle = b"{\"declared\":\"portable_predictor_package\"}";
        let offset = bytes
            .windows(needle.len())
            .position(|window| window == needle)
            .unwrap();
        bytes[offset] ^= 1; // also makes this member's stored CRC invalid
        fs::write(&path, bytes).unwrap();
        assert!(matches!(
            load_archive_v1(&path),
            Err(ArchiveStoreError::Format(detail)) if detail.contains("schema_version=1")
        ));
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn archive_v1_workspace_namespace_is_closed_before_capability_refusal() {
        let path = temp_file("workspace-namespace");
        let mut request = workspace_snapshot_request();
        let path_extra = "workspace/runs/run_a/uninventoried.json";
        let bytes_extra = b"unlisted".to_vec();
        request.manifest["member_inventory"]
            .as_array_mut()
            .unwrap()
            .push(serde_json::json!({
                "path":path_extra,"regular_file":true,"raw_sha256":sha256_hex(&bytes_extra),
                "uncompressed_size_bytes":bytes_extra.len(),"semantic_fingerprint":null,
                "semantic_profile":"host_opaque"
            }));
        request.payloads.push(ArchivePayload {
            path: path_extra.into(),
            bytes: bytes_extra,
        });
        fs::write(&path, unvalidated_zip(request)).unwrap();
        assert!(matches!(
            load_archive_v1(&path),
            Err(ArchiveStoreError::Format(detail)) if detail.contains("workspace members")
        ));
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn archive_v1_publishes_a_relative_target_without_cleanup_error() {
        static CURRENT_DIR_LOCK: std::sync::OnceLock<std::sync::Mutex<()>> =
            std::sync::OnceLock::new();
        let _lock = CURRENT_DIR_LOCK
            .get_or_init(|| std::sync::Mutex::new(()))
            .lock()
            .unwrap();
        let directory = std::env::temp_dir().join(format!(
            "nirs4all-core-relative-{}-{}",
            std::process::id(),
            TEMP_SEQUENCE.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir(&directory).unwrap();
        let original = std::env::current_dir().unwrap();
        std::env::set_current_dir(&directory).unwrap();
        let result = write_archive_v1(Path::new("relative-target.n4a"), request());
        std::env::set_current_dir(&original).unwrap();
        assert!(result.is_ok());
        assert!(directory.join("relative-target.n4a").is_file());
        fs::remove_file(directory.join("relative-target.n4a")).unwrap();
        fs::remove_dir(directory).unwrap();
    }

    #[test]
    fn archive_v1_publication_never_replaces_a_target_created_by_another_writer() {
        let path = temp_file("publication-race");
        let original = b"external writer won";
        fs::write(&path, original).unwrap();

        assert!(matches!(
            write_archive_v1(&path, request()),
            Err(ArchiveStoreError::AlreadyExists(ref existing)) if existing == &path
        ));
        assert_eq!(fs::read(&path).unwrap(), original);
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn archive_v1_refuses_unsupported_payload_declarations_and_semantic_divergence() {
        for (member, kind) in [("n4mm", "N4MM"), ("n4mopt", "N4MOPT")] {
            let member_path = format!("methods/model.{member}");
            let bytes = format!("{{\"declared\":\"{member}\"}}").into_bytes();
            let raw_sha256 = sha256_hex(&bytes);
            let value = serde_json::json!([{
                "kind":kind,"owner":"nirs4all-methods","format_version":1,"abi_major":2,
                "member_path":member_path,"raw_sha256":raw_sha256,
                "semantic_fingerprint":fingerprint('2'),"semantic_profile":"methods_rfc8785_jcs"
            }]);
            let path = temp_file(member);
            let mut unsupported = request();
            unsupported.manifest["payloads"]["methods"][member] = value;
            unsupported.manifest["member_inventory"].as_array_mut().unwrap().push(
                serde_json::json!({"path":member_path,"regular_file":true,"raw_sha256":sha256_hex(&bytes),"uncompressed_size_bytes":bytes.len(),"semantic_fingerprint":fingerprint('2'),"semantic_profile":"methods_rfc8785_jcs"}),
            );
            unsupported.payloads.push(ArchivePayload {
                path: member_path,
                bytes,
            });
            assert!(matches!(
                write_archive_v1(&path, unsupported),
                Err(ArchiveStoreError::UnsupportedCapability(_))
            ));
            assert!(!path.exists());
        }
        let host_path = temp_file("host-artifacts");
        let mut unsupported = request();
        let bytes = b"{\"declared\":\"host-artifact\"}".to_vec();
        let raw_sha256 = sha256_hex(&bytes);
        unsupported.manifest["payloads"]["host_artifacts"] = serde_json::json!([{
            "artifact_id":"artifact:host","host_state":"host_sidecar","serialization_backend":"joblib","load_policy":"host_opt_in",
            "controller_id":"controller","controller_version":"1.0","plugin_id":"plugin","plugin_version":"1.0","runtime_id":"runtime","abi_id":"abi","capability_id":"capability",
            "member_path":"artifacts/model.joblib","raw_sha256":raw_sha256,"semantic_fingerprint":null,"semantic_profile":"host_opaque"
        }]);
        unsupported.manifest["member_inventory"].as_array_mut().unwrap().push(
            serde_json::json!({"path":"artifacts/model.joblib","regular_file":true,"raw_sha256":sha256_hex(&bytes),"uncompressed_size_bytes":bytes.len(),"semantic_fingerprint":null,"semantic_profile":"host_opaque"}),
        );
        unsupported.payloads.push(ArchivePayload {
            path: "artifacts/model.joblib".into(),
            bytes,
        });
        assert!(matches!(
            write_archive_v1(&host_path, unsupported),
            Err(ArchiveStoreError::UnsupportedCapability(_))
        ));
        assert!(!host_path.exists());

        let semantic_path = temp_file("semantic-link");
        let mut divergent = request();
        divergent.manifest["member_inventory"][0]["semantic_fingerprint"] =
            Value::String(fingerprint('f'));
        assert!(matches!(
            write_archive_v1(&semantic_path, divergent),
            Err(ArchiveStoreError::Format(_))
        ));
        assert!(!semantic_path.exists());

        let profile_path = temp_file("profile-link");
        let mut divergent = request();
        divergent.manifest["member_inventory"][0]["semantic_profile"] =
            Value::String("different_profile".into());
        assert!(matches!(
            write_archive_v1(&profile_path, divergent),
            Err(ArchiveStoreError::Format(_))
        ));
        assert!(!profile_path.exists());
    }

    #[test]
    fn archive_v1_refuses_inconsistent_local_zip_headers() {
        let path = temp_file("local-header");
        write_archive_v1(&path, request()).unwrap();
        let mut bytes = fs::read(&path).unwrap();
        // The first local header is manifest.json. Its method is at offset 8.
        bytes[8] = 1;
        fs::write(&path, &bytes).unwrap();
        assert!(matches!(
            load_archive_v1(&path),
            Err(ArchiveStoreError::Format(_))
        ));

        let prepared = prepare_write(request()).unwrap();
        let mut bytes = write_stored_zip(&prepared.manifest, &prepared.payloads).unwrap();
        // The first local member name starts at offset 30; make it differ from
        // the central name while retaining a safe UTF-8 path.
        bytes[30] = b'x';
        fs::write(&path, bytes).unwrap();
        assert!(matches!(
            load_archive_v1(&path),
            Err(ArchiveStoreError::Format(_))
        ));
        let prepared = prepare_write(request()).unwrap();
        let mut bytes = write_stored_zip(&prepared.manifest, &prepared.payloads).unwrap();
        let eocd = find_eocd(&bytes).unwrap();
        let central = read_u32(&bytes, eocd + 16).unwrap() as usize;
        let second_central = central + 46 + read_u16(&bytes, central + 28).unwrap() as usize;
        // Point a distinct central entry at the first local record. It must be
        // rejected before any member payload allocation.
        bytes[second_central + 42..second_central + 46].copy_from_slice(&0u32.to_le_bytes());
        fs::write(&path, bytes).unwrap();
        assert!(matches!(
            load_archive_v1(&path),
            Err(ArchiveStoreError::Format(_))
        ));

        for (name, offset) in [
            ("version-needed", 4usize),
            ("dos-time", 10usize),
            ("dos-date", 12usize),
        ] {
            let prepared = prepare_write(request()).unwrap();
            let mut bytes = write_stored_zip(&prepared.manifest, &prepared.payloads).unwrap();
            bytes[offset] = 1;
            fs::write(&path, bytes).unwrap();
            assert!(
                matches!(load_archive_v1(&path), Err(ArchiveStoreError::Format(_))),
                "{name}"
            );
        }
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn archive_v1_validates_closed_optional_payload_links_before_capability_refusal() {
        let member_path = "methods/model.n4mm";
        let bytes = b"{\"declared\":\"n4mm\"}".to_vec();
        let raw_sha256 = sha256_hex(&bytes);
        let add_optional_method = |request: &mut ArchiveV1WriteRequest| {
            request.manifest["payloads"]["methods"]["n4mm"] = serde_json::json!([{
                "kind":"N4MM","owner":"nirs4all-methods","format_version":1,"abi_major":2,
                "member_path":member_path,"raw_sha256":raw_sha256,
                "semantic_fingerprint":fingerprint('2'),"semantic_profile":"methods_rfc8785_jcs"
            }]);
            request.manifest["member_inventory"].as_array_mut().unwrap().push(
                serde_json::json!({"path":member_path,"regular_file":true,"raw_sha256":raw_sha256,"uncompressed_size_bytes":bytes.len(),"semantic_fingerprint":fingerprint('2'),"semantic_profile":"methods_rfc8785_jcs"}),
            );
            request.payloads.push(ArchivePayload {
                path: member_path.into(),
                bytes: bytes.clone(),
            });
        };

        let path = temp_file("valid-optional-capability");
        let mut valid = request();
        add_optional_method(&mut valid);
        assert!(matches!(
            write_archive_v1(&path, valid),
            Err(ArchiveStoreError::UnsupportedCapability(_))
        ));
        assert!(!path.exists());

        let path = temp_file("missing-optional-inventory");
        let mut missing_inventory = request();
        add_optional_method(&mut missing_inventory);
        missing_inventory.manifest["member_inventory"]
            .as_array_mut()
            .unwrap()
            .pop();
        missing_inventory.payloads.pop();
        assert!(matches!(
            write_archive_v1(&path, missing_inventory),
            Err(ArchiveStoreError::Format(_))
        ));
        assert!(!path.exists());

        let path = temp_file("invalid-optional-link");
        let mut invalid = request();
        add_optional_method(&mut invalid);
        invalid.manifest["payloads"]["methods"]["n4mm"][0]["raw_sha256"] =
            Value::String(fingerprint('f'));
        assert!(matches!(
            write_archive_v1(&path, invalid),
            Err(ArchiveStoreError::Format(_))
        ));
        assert!(!path.exists());
    }

    #[test]
    fn archive_v1_refuses_oversized_files_before_loading_and_bounds_manifest() {
        let path = temp_file("oversized");
        let file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
            .unwrap();
        file.set_len((MAX_ARCHIVE_BYTES + 1) as u64).unwrap();
        assert!(matches!(
            load_archive_v1(&path),
            Err(ArchiveStoreError::Format(_))
        ));
        fs::remove_file(path).unwrap();
        assert!(validate_manifest_size(MAX_MANIFEST_BYTES + 1).is_err());
    }

    #[test]
    fn archive_v1_uses_the_same_canonical_path_rule_for_writer_and_reader() {
        let unsafe_paths = [
            "CON",
            "PrN.txt",
            "aux.data",
            "NUL.bin",
            "COM1",
            "com9.log",
            "Lpt1",
            "lpt9.out",
            "payload.",
            "payload ",
            "cafe\u{301}.json",
        ];
        for path in unsafe_paths {
            assert!(validate_member_path(path).is_err(), "{path}");
            assert!(prevalidate_writer_payloads(&[ArchivePayload {
                path: path.into(),
                bytes: Vec::new(),
            }])
            .is_err());

            let mut local = Vec::new();
            let mut central = Vec::new();
            append_stored_zip_member(&mut local, &mut central, path, &[]).unwrap();
            assert!(preflight_central_directory(&central, 1).is_err(), "{path}");
        }

        let boundary = "é".repeat(512);
        assert!(validate_member_path(&boundary).is_ok());
        let mut local = Vec::new();
        let mut central = Vec::new();
        append_stored_zip_member(&mut local, &mut central, MANIFEST_MEMBER, &[]).unwrap();
        append_stored_zip_member(&mut local, &mut central, &boundary, &[]).unwrap();
        assert!(preflight_central_directory(&central, 2).is_ok());
        assert!(validate_member_path(&"é".repeat(513)).is_err());
    }

    #[test]
    fn archive_v1_requires_exact_dagml_reference_fields_and_closed_six_member_inventory() {
        let cases: [(&str, RequestMutation); 4] = [
            (
                "unknown reference field",
                Box::new(|request| {
                    request.manifest["replay"]["portable_predictor_package"]["unexpected"] =
                        Value::Bool(true);
                }),
            ),
            (
                "V1 producer port field",
                Box::new(|request| {
                    request.manifest["replay"]["training_artifacts"]["graph"]
                        ["producer_port_required"] = Value::Bool(true);
                }),
            ),
            (
                "missing V2 producer port",
                Box::new(|request| {
                    request.manifest["replay"]["training_artifacts"]["execution_bundle"]
                        .as_object_mut()
                        .unwrap()
                        .remove("producer_port_required");
                }),
            ),
            (
                "false V2 producer port",
                Box::new(|request| {
                    request.manifest["replay"]["training_artifacts"]["execution_bundle"]
                        ["producer_port_required"] = Value::Bool(false);
                }),
            ),
        ];
        for (name, mutate) in cases {
            let path = temp_file(name);
            let mut invalid = request();
            mutate(&mut invalid);
            assert!(matches!(
                write_archive_v1(&path, invalid),
                Err(ArchiveStoreError::Format(_))
            ));
            assert!(!path.exists());
        }

        let path = temp_file("orphan-inventory");
        let mut orphan = request();
        orphan.manifest["member_inventory"].as_array_mut().unwrap().push(
            serde_json::json!({"path":"dagml/orphan.json","regular_file":true,"raw_sha256":fingerprint('1'),"uncompressed_size_bytes":0,"semantic_fingerprint":fingerprint('1'),"semantic_profile":"dagml_tcv1"}),
        );
        orphan.payloads.push(ArchivePayload {
            path: "dagml/orphan.json".into(),
            bytes: b"orphan".to_vec(),
        });
        assert!(matches!(
            write_archive_v1(&path, orphan),
            Err(ArchiveStoreError::Format(_))
        ));
        assert!(!path.exists());
    }

    #[test]
    fn archive_v1_writer_bounds_manifest_serialization_before_zip_construction() {
        let path = temp_file("manifest-bootstrap-budget");
        let mut oversized = request();
        oversized.manifest["extensions"] =
            serde_json::json!({"example.extension":{"value":"x".repeat(MAX_MANIFEST_BYTES)}});
        assert!(matches!(
            write_archive_v1(&path, oversized),
            Err(ArchiveStoreError::Format(ref detail)) if detail.contains("bootstrap budget")
        ));
        assert!(!path.exists());
    }

    #[test]
    fn archive_v1_zip_integer_readers_and_offsets_fail_closed_on_overflow() {
        assert!(read_u16(&[], usize::MAX).is_err());
        assert!(read_u32(&[], usize::MAX).is_err());
        assert!(checked_offset_add(usize::MAX, 1, "test").is_err());
        assert!(checked_range(&[], usize::MAX, 1, "test").is_err());
    }

    #[test]
    fn archive_v1_writer_budgets_payloads_before_manifest_or_clone_work() {
        let path = temp_file("writer-entry-budget");
        let mut over_limit = request();
        over_limit.manifest["schema_version"] = Value::from(2);
        over_limit.payloads = (0..MAX_ENTRIES)
            .map(|index| ArchivePayload {
                path: format!("payloads/{index}"),
                bytes: Vec::new(),
            })
            .collect();
        assert!(prevalidate_writer_payloads(&over_limit.payloads).is_err());
        let error = write_archive_v1(&path, over_limit).unwrap_err();
        assert!(error.to_string().contains("entry count exceeds V1 budget"));
        assert!(!path.exists());
        assert!(checked_writer_payload_total(MAX_TOTAL_BYTES, 1).is_err());
    }

    #[test]
    fn archive_v1_physical_preflight_counts_manifest_and_rejects_metadata_only_attacks() {
        assert_eq!(
            checked_physical_total(1, MAX_TOTAL_BYTES - 1).unwrap(),
            MAX_TOTAL_BYTES
        );
        assert!(checked_physical_total(1, MAX_TOTAL_BYTES).is_err());

        // Four members reach the exact total (manifest plus three payloads);
        // the final one-byte declaration must be refused from central metadata
        // without constructing any large local member allocation.
        let central = metadata_only_zip(&[
            (MANIFEST_MEMBER, MAX_MEMBER_BYTES as u32, 0),
            ("payload/a", MAX_MEMBER_BYTES as u32, 0),
            ("payload/b", MAX_MEMBER_BYTES as u32, 0),
            ("payload/c", MAX_MEMBER_BYTES as u32, 0),
            ("payload/d", 1, 0),
        ]);
        let path = temp_file("central-total-metadata");
        fs::write(&path, central).unwrap();
        assert!(matches!(
            load_archive_v1(&path),
            Err(ArchiveStoreError::Format(_))
        ));
        fs::remove_file(&path).unwrap();

        let duplicate = metadata_only_zip(&[(MANIFEST_MEMBER, 0, 0), (MANIFEST_MEMBER, 0, 0)]);
        assert!(preflight_central_directory(&duplicate[..duplicate.len() - 22], 2).is_err());
        let dos_directory = metadata_only_zip(&[(MANIFEST_MEMBER, 0, 0x10)]);
        assert!(
            preflight_central_directory(&dos_directory[..dos_directory.len() - 22], 1).is_err()
        );
        let permission_only = metadata_only_zip(&[(MANIFEST_MEMBER, 0, 0o644 << 16)]);
        assert!(
            preflight_central_directory(&permission_only[..permission_only.len() - 22], 1).is_ok()
        );
        for external in [0o040000 << 16, 0o120000 << 16, 0o060000 << 16] {
            let non_regular = metadata_only_zip(&[(MANIFEST_MEMBER, 0, external)]);
            assert!(
                preflight_central_directory(&non_regular[..non_regular.len() - 22], 1).is_err()
            );
        }
    }

    #[test]
    fn archive_v1_closed_manifest_reports_malformed_payloads_as_format_before_capability_refusal() {
        assert!(matches!(
            parse_manifest_json(br#"{"writer":{"a":1,"\u0061":2}}"#),
            Err(ArchiveStoreError::Format(_))
        ));
        let mut writer_unknown = request();
        writer_unknown.manifest["writer"]["future_writer_field"] = Value::Bool(true);
        assert!(matches!(
            prepare_write(writer_unknown),
            Err(ArchiveStoreError::Format(_))
        ));

        let mut host_wrong_type = request();
        host_wrong_type.manifest["payloads"]["host_artifacts"] = serde_json::json!([{
            "artifact_id": 1, "host_state":"host_sidecar", "serialization_backend":"json", "load_policy":"host_opt_in",
            "controller_id":"controller", "controller_version":"1.0", "plugin_id":"plugin", "plugin_version":"1.0", "runtime_id":"runtime", "abi_id":"abi", "capability_id":"capability",
            "member_path":"artifacts/model.json", "raw_sha256":fingerprint('1'), "semantic_fingerprint":null, "semantic_profile":"host_opaque"
        }]);
        assert!(matches!(
            prepare_write(host_wrong_type),
            Err(ArchiveStoreError::Format(_))
        ));
    }

    #[test]
    fn archive_v1_public_loader_refuses_escaped_duplicate_manifest_keys() {
        let path = temp_file("escaped-duplicate-key");
        fs::write(
            &path,
            manifest_only_zip(br#"{"writer":{"a":1,"\u0061":2}}"#),
        )
        .unwrap();
        assert!(matches!(
            load_archive_v1(&path),
            Err(ArchiveStoreError::Format(_))
        ));
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn archive_v1_public_reader_refuses_50k_nested_manifest_without_stack_growth() {
        let nesting = 50_000;
        let mut manifest = Vec::with_capacity(nesting * 2 + 1);
        manifest.extend(std::iter::repeat_n(b'[', nesting));
        manifest.push(b'0');
        manifest.extend(std::iter::repeat_n(b']', nesting));
        assert!(manifest.len() < MAX_MANIFEST_BYTES);

        let path = temp_file("deep-manifest");
        fs::write(&path, manifest_only_zip(&manifest)).unwrap();
        assert!(matches!(
            load_archive_v1(&path),
            Err(ArchiveStoreError::Format(detail)) if detail.contains("nesting exceeds")
        ));
        // Reaching this assertion is itself the regression proof: the public
        // reader returned a typed refusal in this process rather than recursing
        // through the 50k JSON levels.
        assert!(path.is_file());
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn archive_v1_public_reader_uses_full_frozen_dagml_fixture_corpus() {
        for (bytes, expected) in [
            (PORTABLE_CONTRACT_FIXTURE, PORTABLE_CONTRACT_FIXTURE_SHA256),
            (
                WORKSPACE_CONTRACT_FIXTURE,
                WORKSPACE_CONTRACT_FIXTURE_SHA256,
            ),
            (REFUSAL_CONTRACT_FIXTURE, REFUSAL_CONTRACT_FIXTURE_SHA256),
            (
                ARCHIVE_V1_CONTRACT_SCHEMA,
                ARCHIVE_V1_CONTRACT_SCHEMA_SHA256,
            ),
        ] {
            assert_eq!(sha256_hex(bytes.as_bytes()), expected);
        }
        let schema: Value = serde_json::from_str(ARCHIVE_V1_CONTRACT_SCHEMA).unwrap();
        assert_eq!(
            schema["$id"],
            "https://github.com/GBeurier/dag-ml/contracts/archive-v1/archive_workspace_manifest.v1.schema.json"
        );
        assert_eq!(schema["properties"]["schema_version"]["const"], 1);

        for name in [
            "portable_split_conformal.json",
            "workspace_n4d_host_sidecar.json",
        ] {
            let path = temp_file(name);
            fs::write(
                &path,
                materialize_contract_fixture(&contract_fixture(name), &BTreeSet::new()),
            )
            .unwrap();
            assert!(matches!(
                load_archive_v1(&path),
                Err(ArchiveStoreError::UnsupportedCapability(_))
            ));
            fs::remove_file(path).unwrap();
        }

        let refusals = refusal_contract_cases();
        assert_eq!(refusals.len(), 24, "the frozen corpus has every refusal");
        let refusal_ids = refusals
            .iter()
            .map(|case| case["id"].as_str().expect("refusal id"))
            .collect::<BTreeSet<_>>();
        assert_eq!(
            refusal_ids.len(),
            24,
            "the frozen corpus has unique refusal ids"
        );
        for case in refusals {
            let case_id = case["id"].as_str().expect("refusal id");
            let base = case
                .get("base")
                .and_then(Value::as_str)
                .unwrap_or("workspace_n4d_host_sidecar.json");
            let mut manifest = contract_fixture(base);
            apply_contract_fixture_mutations(&mut manifest, &case);
            let path = temp_file(case_id);
            fs::write(
                &path,
                materialize_contract_fixture(&manifest, &protected_inventory_fields(&case)),
            )
            .unwrap();
            assert!(
                matches!(load_archive_v1(&path), Err(ArchiveStoreError::Format(_))),
                "frozen contract refusal {case_id} must be a Core Format refusal"
            );
            fs::remove_file(path).unwrap();
        }
    }

    #[test]
    fn archive_v1_public_reader_uses_exact_dagml_workspace_path_and_live_name_rules() {
        const RUN_PAYLOAD: &str = "workspace/runs/run_a/records.json";
        const SQLITE_PAYLOAD: &str = "workspace/snapshot.sqlite";
        let cases = [
            (
                "normal-mjpeg",
                RUN_PAYLOAD,
                "workspace/runs/run_a/report-mjpeg.json",
                false,
            ),
            (
                "non-superjournal-mj",
                RUN_PAYLOAD,
                "workspace/runs/run_a/report-mjpeg.json",
                false,
            ),
            (
                "sqlite-superjournal-any-hex-suffix",
                RUN_PAYLOAD,
                "workspace/runs/run_a/store.sqlite-mjabcDEF",
                true,
            ),
            (
                "sqlite-superjournal-spaced-hex-suffix",
                RUN_PAYLOAD,
                "workspace/runs/run_a/store.sqlite-mj A1B2C39FF",
                true,
            ),
            (
                "sqlite-root-regex",
                SQLITE_PAYLOAD,
                "workspace/store:bad.sqlite",
                true,
            ),
            (
                "run-regex",
                RUN_PAYLOAD,
                "workspace/runs/run:bad/report.json",
                true,
            ),
        ];
        for (name, original, replacement, refused) in cases {
            let path = temp_file(name);
            let mut request = workspace_snapshot_request();
            replace_workspace_payload_path(&mut request, original, replacement);
            fs::write(&path, unvalidated_zip(request)).unwrap();
            if refused {
                assert!(
                    matches!(load_archive_v1(&path), Err(ArchiveStoreError::Format(_))),
                    "{replacement} must be refused"
                );
            } else {
                assert!(
                    matches!(
                        load_archive_v1(&path),
                        Err(ArchiveStoreError::UnsupportedCapability(_))
                    ),
                    "{replacement} must reach the documented workspace capability outcome"
                );
            }
            fs::remove_file(path).unwrap();
        }
    }
}
