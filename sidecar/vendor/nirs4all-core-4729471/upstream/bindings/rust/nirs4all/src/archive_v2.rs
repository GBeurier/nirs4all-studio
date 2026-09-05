//! Archive V2 native-portable storage bridge.
//!
//! DAG-ML owns every replay document carried by this archive.  Core deliberately
//! treats those bytes as opaque: it validates the Archive V2 container, closed
//! inventory, raw hashes, native-only manifest declarations and ZIP budgets, but
//! does not deserialize a predictor package or execute a model.

use std::collections::{BTreeMap, BTreeSet};
use std::fs::{self, File, OpenOptions};
use std::io::{Cursor, Read, Seek, SeekFrom, Write};
use std::path::Path;
#[cfg(all(test, not(nirs4all_archive_v2_source_consumer)))]
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};

use serde_json::{Map, Value};
use sha2::{Digest, Sha256};
use unicode_normalization::UnicodeNormalization;

use crate::{
    load_archive_v1, load_archive_v3, ArchivePayload, ArchiveStoreError, LoadedArchiveV1,
    LoadedArchiveV3,
};

const PROFILE: &str = "nirs4all.archive_workspace.v2";
const WRITER_ID: &str = "nirs4all-core.archive_workspace_writer.v2";
const MANIFEST: &str = "manifest.json";
const PACKAGE: &str = "dagml/portable_predictor_package.json";
const MAX_ENTRIES: usize = 256;
const MAX_MEMBER: usize = 134_217_728;
const MAX_TOTAL: usize = 536_870_912;
const MAX_MANIFEST: usize = 1_048_576;
const MAX_MANIFEST_JSON_NESTING: usize = 64;
const MAX_ARCHIVE: usize = MAX_TOTAL + MAX_ENTRIES * (4096 + 76) + 22;
const PACKAGE_SCHEMA: &str =
    "https://github.com/GBeurier/dag-ml/schemas/portable_predictor_package.v2.schema.json";
const GRAPH_SCHEMA: &str = "https://github.com/GBeurier/dag-ml/schemas/graph_spec.v1.schema.json";
const BUNDLE_SCHEMA: &str =
    "https://github.com/GBeurier/dag-ml/schemas/execution_bundle.v2.schema.json";
const OUTCOME_SCHEMA: &str =
    "https://github.com/GBeurier/dag-ml/schemas/training_outcome.v2.schema.json";
const CACHE_SCHEMA: &str =
    "https://github.com/GBeurier/dag-ml/schemas/prediction_cache_payload_set.v2.schema.json";
const SCORE_SCHEMA: &str = "https://github.com/GBeurier/dag-ml/schemas/score_set.v2.schema.json";
static TEMP_SEQUENCE: AtomicU64 = AtomicU64::new(0);

/// Typed input for the distinct V2 writer.  `manifest` is the DAG-ML-owned V2
/// manifest; Core derives raw member hashes and sizes immediately before write.
#[derive(Clone, Debug)]
pub struct ArchiveV2WriteRequest {
    pub manifest: Value,
    pub payloads: Vec<ArchivePayload>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ArchiveV2Reference {
    archive_id: String,
    archive_sha256: String,
}

impl ArchiveV2Reference {
    pub fn archive_id(&self) -> &str {
        &self.archive_id
    }
    pub fn schema_version(&self) -> u32 {
        2
    }
    pub fn profile(&self) -> &str {
        PROFILE
    }
    pub fn archive_sha256(&self) -> &str {
        &self.archive_sha256
    }
    pub fn portable_predictor_member(&self) -> &'static str {
        PACKAGE
    }
}

/// A V2 archive whose bytes passed inventory and raw-integrity checks.
#[derive(Clone, Debug)]
pub struct LoadedArchiveV2 {
    reference: ArchiveV2Reference,
    manifest: Value,
    members: BTreeMap<String, Vec<u8>>,
}

/// A manifest-validated portable Methods artifact declaration.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ArchiveV2MethodsArtifact {
    artifact_id: String,
    member_path: String,
    format_version: u32,
    abi_min_minor: u32,
}

impl ArchiveV2MethodsArtifact {
    pub fn artifact_id(&self) -> &str {
        &self.artifact_id
    }

    pub fn member_path(&self) -> &str {
        &self.member_path
    }

    /// Native N4MM wire format inspected and declared by the archive writer.
    pub fn format_version(&self) -> u32 {
        self.format_version
    }

    /// Minimum Methods ABI 2 minor required to import this payload.
    ///
    /// Archives written before the field was introduced contain only the
    /// historical PLS N4MM format available since ABI 2.0 and therefore
    /// project `0` here. New writers must emit the field explicitly from the
    /// payload capability they selected.
    pub fn abi_min_minor(&self) -> u32 {
        self.abi_min_minor
    }
}

impl LoadedArchiveV2 {
    pub fn reference(&self) -> &ArchiveV2Reference {
        &self.reference
    }
    pub fn manifest(&self) -> &Value {
        &self.manifest
    }
    /// Return exact stored bytes. DAG-ML, not Core, parses/replays these bytes.
    pub fn member(&self, path: &str) -> Result<&[u8], ArchiveStoreError> {
        self.members.get(path).map(Vec::as_slice).ok_or_else(|| {
            ArchiveStoreError::Integrity(format!("V2 member `{path}` disappeared after validation"))
        })
    }
    pub fn portable_predictor_package(&self) -> Result<&[u8], ArchiveStoreError> {
        self.member(PACKAGE)
    }

    /// Project the Methods N4MM declarations only after the canonical manifest,
    /// inventory and raw-member closure has been validated.
    pub fn methods_n4mm_artifacts(
        &self,
    ) -> Result<Vec<ArchiveV2MethodsArtifact>, ArchiveStoreError> {
        let root = object(&self.manifest, "manifest")?;
        let payloads = required(root, "payloads")?
            .as_object()
            .ok_or_else(|| fmt_err("payloads must be object"))?;
        let methods = required(payloads, "methods")?
            .as_object()
            .ok_or_else(|| fmt_err("payloads.methods must be object"))?;
        required(methods, "n4mm")?
            .as_array()
            .ok_or_else(|| fmt_err("payloads.methods.n4mm must be array"))?
            .iter()
            .map(|value| {
                let item = object(value, "N4MM declaration")?;
                Ok(ArchiveV2MethodsArtifact {
                    artifact_id: required_str(item, "artifact_id")?.to_owned(),
                    member_path: required_str(item, "member_path")?.to_owned(),
                    format_version: item
                        .get("format_version")
                        .and_then(Value::as_u64)
                        .ok_or_else(|| fmt_err("N4MM format_version must be an integer"))?
                        as u32,
                    abi_min_minor: item
                        .get("abi_min_minor")
                        .and_then(Value::as_u64)
                        .unwrap_or(0) as u32,
                })
            })
            .collect()
    }
}

/// Additive dual-reader result. Archive V1 remains represented by its original
/// type and is never rewritten or revalidated as V2.
#[derive(Clone, Debug)]
pub enum LoadedArchive {
    V1(LoadedArchiveV1),
    V2(LoadedArchiveV2),
    V3(LoadedArchiveV3),
}

pub fn write_archive_v2(
    path: &Path,
    request: ArchiveV2WriteRequest,
) -> Result<ArchiveV2Reference, ArchiveStoreError> {
    let (manifest, members, archive_id) = prepare(request.manifest, request.payloads, true)?;
    let bytes = stored_zip(&manifest, &members)?;
    let reference = ArchiveV2Reference {
        archive_id,
        archive_sha256: sha256(&bytes),
    };
    atomic_create(path, &bytes)?;
    Ok(reference)
}

pub fn load_archive_v2(path: &Path) -> Result<LoadedArchiveV2, ArchiveStoreError> {
    let (mut file, preflight) = open_v2_preflight(path)?;
    let manifest = read_manifest_member(&mut file, &preflight)?;
    // Capability/family dispatch is deliberately complete before payload
    // reads. In particular a hostile unknown/host archive cannot force an
    // expensive payload allocation or a payload CRC calculation.
    validate_manifest_for_dispatch(&manifest, &preflight)?;
    let members = read_payload_members(&mut file, &preflight)?;
    let (manifest, members, archive_id) = prepare(
        manifest,
        members
            .into_iter()
            .map(|(path, bytes)| ArchivePayload { path, bytes })
            .collect(),
        false,
    )?;
    let archive_sha256 = sha256_file(&mut file, preflight.archive_len)?;
    Ok(LoadedArchiveV2 {
        reference: ArchiveV2Reference {
            archive_id,
            archive_sha256,
        },
        manifest,
        members,
    })
}

/// Validate an in-memory Archive V2 through the same byte-oriented reader used
/// by the native file surface. This is the canonical browser/WASM entry point:
/// bindings must not duplicate ZIP, manifest or inventory parsing.
pub fn load_archive_v2_bytes(bytes: &[u8]) -> Result<LoadedArchiveV2, ArchiveStoreError> {
    let mut reader = Cursor::new(bytes);
    let preflight = preflight_zip_reader(&mut reader, bytes.len())?;
    let manifest = read_manifest_member(&mut reader, &preflight)?;
    validate_manifest_for_dispatch(&manifest, &preflight)?;
    let members = read_payload_members(&mut reader, &preflight)?;
    let (manifest, members, archive_id) = prepare(
        manifest,
        members
            .into_iter()
            .map(|(path, bytes)| ArchivePayload { path, bytes })
            .collect(),
        false,
    )?;
    Ok(LoadedArchiveV2 {
        reference: ArchiveV2Reference {
            archive_id,
            archive_sha256: sha256(bytes),
        },
        manifest,
        members,
    })
}

/// Dispatch only from the bounded `manifest.json` header. Unknown versions are
/// refused before any payload is opened; V1 continues through its frozen reader.
pub fn load_archive(path: &Path) -> Result<LoadedArchive, ArchiveStoreError> {
    let (mut file, preflight) = open_v2_preflight(path)?;
    match dispatch_schema_version(&mut file, &preflight)? {
        1 => Ok(LoadedArchive::V1(load_archive_v1(path)?)),
        2 => {
            let manifest = read_manifest_member(&mut file, &preflight)?;
            validate_manifest_for_dispatch(&manifest, &preflight)?;
            let members = read_payload_members(&mut file, &preflight)?;
            let (manifest, members, archive_id) = prepare(
                manifest,
                members
                    .into_iter()
                    .map(|(path, bytes)| ArchivePayload { path, bytes })
                    .collect(),
                false,
            )?;
            let archive_sha256 = sha256_file(&mut file, preflight.archive_len)?;
            Ok(LoadedArchive::V2(LoadedArchiveV2 {
                reference: ArchiveV2Reference {
                    archive_id,
                    archive_sha256,
                },
                manifest,
                members,
            }))
        }
        3 => Ok(LoadedArchive::V3(load_archive_v3(path)?)),
        other => Err(ArchiveStoreError::Format(format!(
            "archive dispatch refuses schema_version={other}"
        ))),
    }
}

/// Bootstrap dispatch reads only the bounded EOCD/central directory and the
/// bounded manifest member. Payload bytes are neither copied nor CRC-checked
/// until the selected exact-version reader has accepted the manifest family.
fn dispatch_schema_version(
    file: &mut File,
    preflight: &ZipPreflight,
) -> Result<u64, ArchiveStoreError> {
    let value = read_manifest_member(file, preflight)?;
    value
        .get("schema_version")
        .and_then(Value::as_u64)
        .ok_or_else(|| fmt_err("manifest schema_version is missing"))
}

type PreparedArchive = (Value, BTreeMap<String, Vec<u8>>, String);
type InventoryMeta<'a> = BTreeMap<&'a str, (String, Option<String>, String)>;

fn prepare(
    mut manifest: Value,
    payloads: Vec<ArchivePayload>,
    derive_raw: bool,
) -> Result<PreparedArchive, ArchiveStoreError> {
    let mut members = BTreeMap::new();
    let mut total = 0usize;
    for payload in payloads {
        path_ok(&payload.path)?;
        if payload.path == MANIFEST {
            return refuse("manifest.json cannot be supplied as a payload");
        }
        if payload.bytes.len() > MAX_MEMBER {
            return refuse("payload exceeds V2 member budget");
        }
        total = total
            .checked_add(payload.bytes.len())
            .ok_or_else(|| fmt_err("payload total overflow"))?;
        if total > MAX_TOTAL {
            return refuse("payload total exceeds V2 budget");
        }
        if members
            .insert(payload.path.clone(), payload.bytes)
            .is_some()
        {
            return refuse("duplicate payload path");
        }
    }
    if members.len() + 1 > MAX_ENTRIES {
        return refuse("payload entry count exceeds V2 budget");
    }
    validate_manifest_shape(&mut manifest, &members, derive_raw)?;
    let archive_id = required_str(object(&manifest, "manifest")?, "archive_id")?.to_owned();
    Ok((manifest, members, archive_id))
}

fn validate_manifest_shape(
    manifest: &mut Value,
    members: &BTreeMap<String, Vec<u8>>,
    derive_raw: bool,
) -> Result<(), ArchiveStoreError> {
    let physical_members = members
        .iter()
        .map(|(path, bytes)| (path.clone(), bytes.len()))
        .collect();
    if derive_raw {
        derive_inventory(manifest, members)?;
    }
    validate_manifest_declarations(manifest, &physical_members)?;
    validate_reference_closure(manifest, members)
}

/// Validate everything that can be known from the bounded manifest plus the
/// central-directory member names.  This is deliberately invoked before any
/// payload member is read or CRC checked by the reader.
fn validate_manifest_declarations(
    manifest: &Value,
    physical_members: &BTreeMap<String, usize>,
) -> Result<(), ArchiveStoreError> {
    let root = object(manifest, "manifest")?;
    closed(
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
    if root.get("schema_version").and_then(Value::as_u64) != Some(2)
        || root.get("profile").and_then(Value::as_str) != Some(PROFILE)
        || root.get("persistence_kind").and_then(Value::as_str) != Some("n4a_archive")
    {
        return refuse("not an exact Archive V2 manifest");
    }
    id_ok(required_str(root, "archive_id")?, "archive_id")?;
    validate_extensions(root.get("extensions"))?;
    let writer = object(required(root, "writer")?, "writer")?;
    closed(
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
        return refuse("writer identity is not Archive V2");
    }
    validate_dispatch(object(
        required(root, "reader_dispatch")?,
        "reader_dispatch",
    )?)?;
    validate_physical(object(
        required(root, "physical_profile")?,
        "physical_profile",
    )?)?;
    let payloads = object(required(root, "payloads")?, "payloads")?;
    closed(
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
    if payloads.get("conformal") != Some(&Value::Null)
        || payloads
            .get("host_artifacts")
            .and_then(Value::as_array)
            .filter(|v| v.is_empty())
            .is_none()
    {
        return refuse("V2 refuses archive conformal state or host sidecars");
    }
    let replay = object(required(root, "replay")?, "replay")?;
    closed(
        replay,
        &[
            "portable_predictor_package",
            "training_artifacts",
            "future_artifacts",
        ],
        "replay",
    )?;
    let training = object(
        required(replay, "training_artifacts")?,
        "training_artifacts",
    )?;
    closed(
        training,
        &[
            "graph",
            "execution_bundle",
            "training_outcome",
            "prediction_cache_payload_set",
            "score_set",
        ],
        "training_artifacts",
    )?;
    for deferred in required(replay, "future_artifacts")?
        .as_array()
        .ok_or_else(|| fmt_err("future_artifacts must be array"))?
    {
        let deferred = object(deferred, "future_artifact")?;
        closed(
            deferred,
            &["kind", "status", "reason", "affects_replay"],
            "future_artifact",
        )?;
        if deferred.get("status").and_then(Value::as_str) != Some("deferred_future_contract")
            || deferred.get("affects_replay") != Some(&Value::Bool(false))
            || !deferred
                .get("kind")
                .and_then(Value::as_str)
                .is_some_and(is_id)
            || deferred
                .get("reason")
                .and_then(Value::as_str)
                .filter(|v| !v.is_empty())
                .is_none()
        {
            return refuse("invalid deferred future artifact");
        }
    }
    let methods = object(required(payloads, "methods")?, "payloads.methods")?;
    closed(methods, &["n4mm", "n4mopt"], "payloads.methods")?;
    if root.get("workspace") != Some(&Value::Null) {
        return refuse("V2 P0 refuses workspace snapshots");
    }
    let security = object(required(root, "security")?, "security")?;
    closed(security, &["integrity_profile", "signature"], "security")?;
    if security.get("integrity_profile").and_then(Value::as_str)
        != Some("sha256_raw_member_inventory_v2")
        || security.get("signature") != Some(&Value::Null)
    {
        return refuse("V2 security profile is not the unsigned raw-inventory profile");
    }
    if let Some(provenance) = root.get("migration_provenance") {
        if provenance != &Value::Null {
            let provenance = object(provenance, "migration_provenance")?;
            closed(
                provenance,
                &[
                    "source_raw_sha256",
                    "source_schema_version",
                    "source_profile",
                    "tool_id",
                    "tool_version",
                    "copy_on_write",
                    "source_retained",
                ],
                "migration_provenance",
            )?;
            if provenance
                .get("source_schema_version")
                .and_then(Value::as_u64)
                != Some(1)
                || provenance.get("source_profile").and_then(Value::as_str)
                    != Some("nirs4all.archive_workspace.v1")
                || provenance.get("copy_on_write") != Some(&Value::Bool(true))
                || provenance.get("source_retained") != Some(&Value::Bool(true))
                || !sha256_text(provenance.get("source_raw_sha256").and_then(Value::as_str))
                || !provenance
                    .get("tool_id")
                    .and_then(Value::as_str)
                    .is_some_and(is_id)
                || !provenance
                    .get("tool_version")
                    .and_then(Value::as_str)
                    .is_some_and(is_id)
            {
                return refuse("invalid V1-to-V2 copy-on-write provenance");
            }
        }
    }
    if object(required(payloads, "methods")?, "payloads.methods")?
        .get("n4mm")
        .and_then(Value::as_array)
        .filter(|v| !v.is_empty())
        .is_none()
    {
        return refuse("V2 requires at least one N4MM member");
    }
    let inventory = root
        .get("member_inventory")
        .and_then(Value::as_array)
        .ok_or_else(|| fmt_err("member_inventory must be an array"))?;
    if inventory.len() != physical_members.len() || inventory.len() + 1 > MAX_ENTRIES {
        return refuse("closed member inventory does not match payloads");
    }
    let mut inventory_paths = BTreeSet::new();
    for entry in inventory {
        let entry = object(entry, "member_inventory entry")?;
        closed(
            entry,
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
        let path = required_str(entry, "path")?;
        path_ok(path)?;
        if entry.get("regular_file") != Some(&Value::Bool(true))
            || !inventory_paths.insert(path)
            || !physical_members.contains_key(path)
            || !sha256_text(entry.get("raw_sha256").and_then(Value::as_str))
            || entry.get("uncompressed_size_bytes").and_then(Value::as_u64)
                != physical_members.get(path).map(|size| *size as u64)
        {
            return refuse("inventory must contain each payload exactly once as a regular file");
        }
    }
    let inventory_meta = declared_inventory_metadata(root)?;
    validate_reference_declarations(manifest, &inventory_meta)
}

fn validate_dispatch(value: &Map<String, Value>) -> Result<(), ArchiveStoreError> {
    closed(
        value,
        &["archive_v2", "archive_v1", "legacy_n4a"],
        "reader_dispatch",
    )?;
    let v2 = object(required(value, "archive_v2")?, "reader_dispatch.archive_v2")?;
    closed(
        v2,
        &[
            "accepted_versions",
            "future_versions",
            "dispatch_before_extraction",
        ],
        "reader_dispatch.archive_v2",
    )?;
    if v2.get("accepted_versions") != Some(&serde_json::json!([2]))
        || v2.get("future_versions").and_then(Value::as_str) != Some("refuse")
        || v2.get("dispatch_before_extraction") != Some(&Value::Bool(true))
    {
        return refuse("reader_dispatch.archive_v2 is not exact");
    }
    let v1 = object(required(value, "archive_v1")?, "reader_dispatch.archive_v1")?;
    closed(
        v1,
        &["accepted_versions", "read_mode", "mutation"],
        "reader_dispatch.archive_v1",
    )?;
    if v1.get("accepted_versions") != Some(&serde_json::json!([1]))
        || v1.get("read_mode").and_then(Value::as_str) != Some("immutable_dual_read")
        || v1.get("mutation").and_then(Value::as_str) != Some("never_in_place")
    {
        return refuse("reader_dispatch.archive_v1 is not immutable dual-read");
    }
    let legacy = object(required(value, "legacy_n4a")?, "reader_dispatch.legacy_n4a")?;
    closed(
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
        || legacy.get("manifest_member").and_then(Value::as_str) != Some(MANIFEST)
        || legacy.get("reader_id").and_then(Value::as_str)
            != Some("nirs4all.pipeline.bundle.loader.BundleLoader")
        || legacy
            .get("maximum_bundle_format_version")
            .and_then(Value::as_str)
            != Some("1.0")
        || legacy.get("migration_direction").and_then(Value::as_str)
            != Some("legacy_to_v1_copy_on_write_only")
    {
        return refuse("reader_dispatch.legacy_n4a is not exact");
    }
    Ok(())
}

fn validate_physical(value: &Map<String, Value>) -> Result<(), ArchiveStoreError> {
    closed(
        value,
        &[
            "container",
            "manifest_member",
            "regular_files_only",
            "limits",
        ],
        "physical_profile",
    )?;
    if value.get("container").and_then(Value::as_str) != Some("zip")
        || value.get("manifest_member").and_then(Value::as_str) != Some(MANIFEST)
        || value.get("regular_files_only") != Some(&Value::Bool(true))
    {
        return refuse("physical profile is not the V2 ZIP profile");
    }
    let limits = object(required(value, "limits")?, "physical_profile.limits")?;
    closed(
        limits,
        &[
            "max_entries",
            "max_total_uncompressed_bytes",
            "max_member_uncompressed_bytes",
            "max_compression_ratio",
        ],
        "physical_profile.limits",
    )?;
    if limits.get("max_entries").and_then(Value::as_u64) != Some(MAX_ENTRIES as u64)
        || limits
            .get("max_total_uncompressed_bytes")
            .and_then(Value::as_u64)
            != Some(MAX_TOTAL as u64)
        || limits
            .get("max_member_uncompressed_bytes")
            .and_then(Value::as_u64)
            != Some(MAX_MEMBER as u64)
        || limits.get("max_compression_ratio").and_then(Value::as_u64) != Some(100)
    {
        return refuse("physical profile limits are not exact V2 limits");
    }
    Ok(())
}

fn derive_inventory(
    manifest: &mut Value,
    members: &BTreeMap<String, Vec<u8>>,
) -> Result<(), ArchiveStoreError> {
    let root = object_mut(manifest, "manifest")?;
    let inventory = root
        .get_mut("member_inventory")
        .and_then(Value::as_array_mut)
        .ok_or_else(|| fmt_err("member_inventory must be array"))?;
    for entry in inventory {
        let e = object_mut(entry, "inventory")?;
        let path = required_str(e, "path")?.to_owned();
        let bytes = &members[&path];
        e.insert("raw_sha256".into(), Value::String(sha256(bytes)));
        e.insert("uncompressed_size_bytes".into(), Value::from(bytes.len()));
        if path.ends_with(".n4mm") {
            e.insert("semantic_fingerprint".into(), Value::String(sha256(bytes)));
            e.insert(
                "semantic_profile".into(),
                Value::String("n4mm_raw_sha256".into()),
            );
        }
    }
    fn sync(
        value: &mut Value,
        members: &BTreeMap<String, Vec<u8>>,
    ) -> Result<(), ArchiveStoreError> {
        let o = object_mut(value, "member reference")?;
        let path = required_str(o, "member_path")?.to_owned();
        let bytes = members
            .get(&path)
            .ok_or_else(|| fmt_err("reference path missing from inventory"))?;
        o.insert("raw_sha256".into(), Value::String(sha256(bytes)));
        if path.ends_with(".n4mm") {
            o.insert("semantic_fingerprint".into(), Value::String(sha256(bytes)));
            o.insert(
                "semantic_profile".into(),
                Value::String("n4mm_raw_sha256".into()),
            );
        }
        Ok(())
    }
    let replay = object_mut(required_mut(root, "replay")?, "replay")?;
    sync(required_mut(replay, "portable_predictor_package")?, members)?;
    let training = object_mut(
        required_mut(replay, "training_artifacts")?,
        "training_artifacts",
    )?;
    for key in [
        "graph",
        "execution_bundle",
        "training_outcome",
        "prediction_cache_payload_set",
        "score_set",
    ] {
        sync(required_mut(training, key)?, members)?;
    }
    let methods = object_mut(
        required_mut(
            object_mut(required_mut(root, "payloads")?, "payloads")?,
            "methods",
        )?,
        "methods",
    )?;
    for key in ["n4mm", "n4mopt"] {
        for item in required_mut(methods, key)?
            .as_array_mut()
            .ok_or_else(|| fmt_err("methods payload list must be array"))?
        {
            sync(item, members)?;
        }
    }
    let payloads = object_mut(required_mut(root, "payloads")?, "payloads")?;
    for key in ["n4d_aggregate_reference", "robustness"] {
        if let Some(reference) = payloads.get_mut(key).filter(|value| !value.is_null()) {
            sync(reference, members)?;
        }
    }
    Ok(())
}

fn validate_reference_closure(
    manifest: &Value,
    members: &BTreeMap<String, Vec<u8>>,
) -> Result<(), ArchiveStoreError> {
    let root = object(manifest, "manifest")?;
    let inventory = root
        .get("member_inventory")
        .and_then(Value::as_array)
        .ok_or_else(|| fmt_err("member_inventory must be array"))?;
    let inventory_meta = declared_inventory_metadata(root)?;
    for entry in inventory {
        let e = object(entry, "inventory")?;
        let path = required_str(e, "path")?;
        let bytes = members
            .get(path)
            .ok_or_else(|| fmt_err("missing inventory member"))?;
        if e.get("uncompressed_size_bytes").and_then(Value::as_u64) != Some(bytes.len() as u64)
            || e.get("raw_sha256").and_then(Value::as_str) != Some(sha256(bytes).as_str())
        {
            return Err(ArchiveStoreError::Integrity(format!(
                "inventory hash or size mismatch for {}",
                path
            )));
        }
    }
    validate_reference_declarations(manifest, &inventory_meta)
}

fn declared_inventory_metadata(
    root: &Map<String, Value>,
) -> Result<InventoryMeta<'_>, ArchiveStoreError> {
    let inventory = required(root, "member_inventory")?
        .as_array()
        .ok_or_else(|| fmt_err("member_inventory must be array"))?;
    let mut inventory_meta = BTreeMap::new();
    for entry in inventory {
        let entry = object(entry, "inventory")?;
        let path = required_str(entry, "path")?;
        let semantic = entry.get("semantic_fingerprint").and_then(Value::as_str);
        let profile = entry.get("semantic_profile").and_then(Value::as_str);
        if !matches!(
            profile,
            Some(
                "dagml_tcv1"
                    | "dagml_historical_serde_json_v1"
                    | "n4mm_raw_sha256"
                    | "methods_rfc8785_jcs"
                    | "none"
            )
        ) || (profile == Some("none")) != semantic.is_none()
            || semantic.is_some_and(|value| !sha256_text(Some(value)))
        {
            return refuse("inventory semantic fingerprint/profile is invalid");
        }
        inventory_meta.insert(
            path,
            (
                required_str(entry, "raw_sha256")?.to_owned(),
                semantic.map(str::to_owned),
                profile.unwrap().to_owned(),
            ),
        );
    }
    Ok(inventory_meta)
}

/// Close every manifest reference over the declared inventory without reading
/// member contents.  The caller that has payload bytes performs raw SHA/size
/// verification first, then reuses this exact closure check.
fn validate_reference_declarations(
    manifest: &Value,
    inventory_meta: &InventoryMeta<'_>,
) -> Result<(), ArchiveStoreError> {
    let root = object(manifest, "manifest")?;
    let mut declared_paths = BTreeSet::new();
    let replay = object(required(root, "replay")?, "replay")?;
    validate_ref(
        required(replay, "portable_predictor_package")?,
        inventory_meta,
        Some((PACKAGE_SCHEMA, 2, true, "dagml_tcv1")),
        Some(PACKAGE),
        &mut declared_paths,
    )?;
    let training = object(
        required(replay, "training_artifacts")?,
        "training_artifacts",
    )?;
    for (key, schema, version, port, semantic_profile) in [
        (
            "graph",
            GRAPH_SCHEMA,
            1,
            false,
            "dagml_historical_serde_json_v1",
        ),
        ("execution_bundle", BUNDLE_SCHEMA, 2, true, "dagml_tcv1"),
        ("training_outcome", OUTCOME_SCHEMA, 2, true, "dagml_tcv1"),
        (
            "prediction_cache_payload_set",
            CACHE_SCHEMA,
            2,
            true,
            "dagml_historical_serde_json_v1",
        ),
        (
            "score_set",
            SCORE_SCHEMA,
            2,
            true,
            "dagml_historical_serde_json_v1",
        ),
    ] {
        validate_ref(
            required(training, key)?,
            inventory_meta,
            Some((schema, version, port, semantic_profile)),
            None,
            &mut declared_paths,
        )?;
    }
    let methods = object(
        required(object(required(root, "payloads")?, "payloads")?, "methods")?,
        "methods",
    )?;
    let mut n4mm_paths = BTreeSet::new();
    let mut n4mm_ids = BTreeSet::new();
    for item in required(methods, "n4mm")?
        .as_array()
        .ok_or_else(|| fmt_err("n4mm must be array"))?
    {
        let o = object(item, "n4mm ref")?;
        let fields = if o.contains_key("abi_min_minor") {
            &[
                "artifact_id",
                "kind",
                "owner",
                "format_version",
                "abi_major",
                "abi_min_minor",
                "member_path",
                "raw_sha256",
                "semantic_fingerprint",
                "semantic_profile",
            ][..]
        } else {
            &[
                "artifact_id",
                "kind",
                "owner",
                "format_version",
                "abi_major",
                "member_path",
                "raw_sha256",
                "semantic_fingerprint",
                "semantic_profile",
            ][..]
        };
        closed(o, fields, "N4MM reference")?;
        let format_version = o.get("format_version").and_then(Value::as_u64);
        let abi_min_minor = o.get("abi_min_minor").and_then(Value::as_u64);
        if o.get("kind").and_then(Value::as_str) != Some("N4MM")
            || o.get("owner").and_then(Value::as_str) != Some("nirs4all-methods")
            || !matches!(format_version, Some(1 | 2))
            || o.get("abi_major").and_then(Value::as_u64) != Some(2)
            || o.get("abi_min_minor")
                .is_some_and(|value| value.as_u64().is_none_or(|minor| minor > u32::MAX as u64))
            || (format_version == Some(2) && abi_min_minor != Some(5))
            || o.get("semantic_profile").and_then(Value::as_str) != Some("n4mm_raw_sha256")
            || o.get("semantic_fingerprint") != o.get("raw_sha256")
        {
            return refuse("N4MM reference is not exact Methods ABI 2 format-1/format-2 data");
        }
        let path = required_str(o, "member_path")?;
        let artifact_id = o
            .get("artifact_id")
            .and_then(Value::as_str)
            .filter(|value| is_id(value));
        if !n4mm_path_ok(path)
            || !n4mm_paths.insert(path)
            || !artifact_id.is_some_and(|id| n4mm_ids.insert(id))
        {
            return refuse("unsafe or duplicate N4MM member path");
        }
        validate_ref(item, inventory_meta, None, None, &mut declared_paths)?;
    }
    for item in required(methods, "n4mopt")?
        .as_array()
        .ok_or_else(|| fmt_err("n4mopt must be array"))?
    {
        let o = object(item, "n4mopt ref")?;
        let fields = if o.contains_key("abi_min_minor") {
            &[
                "kind",
                "owner",
                "format_version",
                "abi_major",
                "abi_min_minor",
                "member_path",
                "raw_sha256",
                "semantic_fingerprint",
                "semantic_profile",
            ][..]
        } else {
            &[
                "kind",
                "owner",
                "format_version",
                "abi_major",
                "member_path",
                "raw_sha256",
                "semantic_fingerprint",
                "semantic_profile",
            ][..]
        };
        closed(o, fields, "N4MOPT reference")?;
        let path = required_str(o, "member_path")?;
        if o.get("kind").and_then(Value::as_str) != Some("N4MOPT")
            || o.get("owner").and_then(Value::as_str) != Some("nirs4all-methods")
            || o.get("format_version").and_then(Value::as_u64) != Some(1)
            || o.get("abi_major").and_then(Value::as_u64) != Some(2)
            || o.get("abi_min_minor")
                .is_some_and(|value| value.as_u64().is_none_or(|minor| minor > u32::MAX as u64))
            || o.get("semantic_profile").and_then(Value::as_str) != Some("methods_rfc8785_jcs")
            || n4mm_paths.contains(path)
        {
            return refuse("N4MOPT must remain a distinct Methods resume payload");
        }
        validate_ref(item, inventory_meta, None, None, &mut declared_paths)?;
    }
    let payloads = object(required(root, "payloads")?, "payloads")?;
    if let Some(n4d_value) = payloads
        .get("n4d_aggregate_reference")
        .filter(|value| !value.is_null())
    {
        let n4d = object(n4d_value, "n4d aggregate reference")?;
        closed(
            n4d,
            &[
                "kind",
                "owner",
                "interpretation",
                "member_path",
                "raw_sha256",
                "semantic_fingerprint",
                "semantic_profile",
            ],
            "n4d aggregate reference",
        )?;
        if n4d.get("kind").and_then(Value::as_str) != Some("n4d_aggregate_reference")
            || n4d.get("owner").and_then(Value::as_str) != Some("nirs4all-core")
            || n4d.get("interpretation").and_then(Value::as_str)
                != Some("aggregate_reference_not_n4d_format_claim")
            || n4d.get("semantic_fingerprint") != Some(&Value::Null)
            || n4d.get("semantic_profile").and_then(Value::as_str) != Some("none")
        {
            return refuse("N4D aggregate reference is not exact V2 metadata");
        }
        validate_ref(n4d_value, inventory_meta, None, None, &mut declared_paths)?;
    }
    if let Some(robustness) = payloads.get("robustness").filter(|value| !value.is_null()) {
        validate_ref(
            robustness,
            inventory_meta,
            Some((
                "https://github.com/GBeurier/dag-ml/schemas/robustness_report.v1.schema.json",
                1,
                false,
                "dagml_tcv1",
            )),
            None,
            &mut declared_paths,
        )?;
    }
    if declared_paths.len() != inventory_meta.len()
        || declared_paths
            .iter()
            .any(|path| !inventory_meta.contains_key(path.as_str()))
    {
        return refuse("member inventory is not closed over declared replay references");
    }
    Ok(())
}

fn validate_ref(
    value: &Value,
    inventory: &InventoryMeta<'_>,
    expected: Option<(&str, u64, bool, &str)>,
    fixed_path: Option<&str>,
    declared_paths: &mut BTreeSet<String>,
) -> Result<(), ArchiveStoreError> {
    let o = object(value, "member reference")?;
    if let Some((_, _, required_port, _)) = expected {
        let keys = if required_port {
            &[
                "owner",
                "schema_id",
                "schema_version",
                "producer_port_required",
                "member_path",
                "raw_sha256",
                "semantic_fingerprint",
                "semantic_profile",
            ][..]
        } else {
            &[
                "owner",
                "schema_id",
                "schema_version",
                "member_path",
                "raw_sha256",
                "semantic_fingerprint",
                "semantic_profile",
            ][..]
        };
        closed(o, keys, "DAG-ML member reference")?;
    }
    let path = required_str(o, "member_path")?;
    path_ok(path)?;
    if fixed_path.is_some_and(|fixed| fixed != path)
        || o.get("owner").and_then(Value::as_str) != Some("dag-ml") && expected.is_some()
        || !inventory.contains_key(path)
        || inventory.get(path).map(|meta| meta.0.as_str())
            != o.get("raw_sha256").and_then(Value::as_str)
        || inventory.get(path).and_then(|meta| meta.1.as_deref())
            != o.get("semantic_fingerprint").and_then(Value::as_str)
        || inventory.get(path).map(|meta| meta.2.as_str())
            != o.get("semantic_profile").and_then(Value::as_str)
    {
        return refuse("member reference does not exactly bind inventory bytes");
    }
    if !declared_paths.insert(path.to_owned()) {
        return refuse("two declared references share an archive member");
    }
    if let Some((schema, version, required_port, semantic_profile)) = expected {
        if o.get("schema_id").and_then(Value::as_str) != Some(schema)
            || o.get("schema_version").and_then(Value::as_u64) != Some(version)
            || (required_port && o.get("producer_port_required") != Some(&Value::Bool(true)))
            || o.get("semantic_profile").and_then(Value::as_str) != Some(semantic_profile)
        {
            return refuse("DAG-ML replay reference has wrong version family or provenance");
        }
    }
    Ok(())
}

pub(crate) fn stored_zip(
    manifest: &Value,
    members: &BTreeMap<String, Vec<u8>>,
) -> Result<Vec<u8>, ArchiveStoreError> {
    let manifest = serialize_manifest_bounded(manifest)?;
    let total = members.values().try_fold(manifest.len(), |total, bytes| {
        total
            .checked_add(bytes.len())
            .ok_or_else(|| fmt_err("ZIP total overflow"))
    })?;
    if total > MAX_TOTAL {
        return refuse("manifest plus payloads exceeds V2 total budget");
    }
    let mut out = Vec::new();
    let mut central = Vec::new();
    append(&mut out, &mut central, MANIFEST, &manifest)?;
    for (p, b) in members {
        append(&mut out, &mut central, p, b)?
    }
    let offset = u32::try_from(out.len()).map_err(|_| fmt_err("ZIP offset overflow"))?;
    let size = u32::try_from(central.len()).map_err(|_| fmt_err("ZIP central overflow"))?;
    out.extend_from_slice(&central);
    u32le(&mut out, 0x0605_4b50);
    u16le(&mut out, 0);
    u16le(&mut out, 0);
    u16le(&mut out, (members.len() + 1) as u16);
    u16le(&mut out, (members.len() + 1) as u16);
    u32le(&mut out, size);
    u32le(&mut out, offset);
    u16le(&mut out, 0);
    Ok(out)
}

struct BoundedJsonWriter {
    bytes: Vec<u8>,
    limit: usize,
}
impl Write for BoundedJsonWriter {
    fn write(&mut self, input: &[u8]) -> std::io::Result<usize> {
        let next = self
            .bytes
            .len()
            .checked_add(input.len())
            .ok_or_else(|| std::io::Error::other("manifest size overflow"))?;
        if next > self.limit {
            return Err(std::io::Error::other("manifest exceeds bootstrap budget"));
        }
        self.bytes.extend_from_slice(input);
        Ok(input.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}
fn serialize_manifest_bounded(manifest: &Value) -> Result<Vec<u8>, ArchiveStoreError> {
    let mut writer = BoundedJsonWriter {
        bytes: Vec::with_capacity(MAX_MANIFEST.min(4096)),
        limit: MAX_MANIFEST,
    };
    serde_json::to_writer(&mut writer, manifest).map_err(|error| {
        fmt_err(&format!(
            "manifest serialization failed within V2 bootstrap budget: {error}"
        ))
    })?;
    Ok(writer.bytes)
}
fn append(
    out: &mut Vec<u8>,
    central: &mut Vec<u8>,
    path: &str,
    bytes: &[u8],
) -> Result<(), ArchiveStoreError> {
    let name = path.as_bytes();
    let off = u32::try_from(out.len()).map_err(|_| fmt_err("ZIP offset overflow"))?;
    let size = u32::try_from(bytes.len()).map_err(|_| fmt_err("ZIP member overflow"))?;
    let crc = crc32(bytes);
    u32le(out, 0x0403_4b50);
    u16le(out, 20);
    u16le(out, 0);
    u16le(out, 0);
    u16le(out, 0);
    u16le(out, 0);
    u32le(out, crc);
    u32le(out, size);
    u32le(out, size);
    u16le(out, name.len() as u16);
    u16le(out, 0);
    out.extend_from_slice(name);
    out.extend_from_slice(bytes);
    u32le(central, 0x0201_4b50);
    u16le(central, 20);
    u16le(central, 20);
    u16le(central, 0);
    u16le(central, 0);
    u16le(central, 0);
    u16le(central, 0);
    u32le(central, crc);
    u32le(central, size);
    u32le(central, size);
    u16le(central, name.len() as u16);
    u16le(central, 0);
    u16le(central, 0);
    u16le(central, 0);
    u16le(central, 0);
    u32le(central, 0);
    u32le(central, off);
    central.extend_from_slice(name);
    Ok(())
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
pub(crate) struct ZipPreflight {
    archive_len: usize,
    entries: Vec<ZipEntry>,
}

pub(crate) fn open_v2_preflight(path: &Path) -> Result<(File, ZipPreflight), ArchiveStoreError> {
    let metadata = fs::symlink_metadata(path)?;
    if !metadata.file_type().is_file() {
        return refuse("archive path must be a POSIX regular file");
    }
    let mut file = File::open(path)?;
    let preflight = preflight_zip_file(&mut file)?;
    Ok((file, preflight))
}

fn preflight_zip_file(file: &mut File) -> Result<ZipPreflight, ArchiveStoreError> {
    let archive_len = usize::try_from(file.metadata()?.len())
        .map_err(|_| fmt_err("archive exceeds platform bounds"))?;
    preflight_zip_reader(file, archive_len)
}

fn preflight_zip_reader<R: Read + Seek>(
    reader: &mut R,
    archive_len: usize,
) -> Result<ZipPreflight, ArchiveStoreError> {
    if !(22..=MAX_ARCHIVE).contains(&archive_len) {
        return refuse("archive exceeds V2 on-disk budget");
    }
    let tail_len = archive_len.min(65_557);
    reader.seek(SeekFrom::End(-(tail_len as i64)))?;
    let mut tail = vec![0; tail_len];
    reader.read_exact(&mut tail)?;
    let tail_eocd = (0..=tail_len - 22)
        .rev()
        .find(|&at| u32at(&tail, at) == Some(0x0605_4b50))
        .ok_or_else(|| fmt_err("ZIP end record missing"))?;
    let eocd = archive_len - tail_len + tail_eocd;
    if u16at(&tail, tail_eocd + 4) != Some(0)
        || u16at(&tail, tail_eocd + 6) != Some(0)
        || u16at(&tail, tail_eocd + 8) != u16at(&tail, tail_eocd + 10)
    {
        return refuse("multi-disk ZIP is outside the V2 physical profile");
    }
    let count = u16at(&tail, tail_eocd + 10).unwrap() as usize;
    let central_size = u32at(&tail, tail_eocd + 12).unwrap() as usize;
    let central_offset = u32at(&tail, tail_eocd + 16).unwrap() as usize;
    if count == 0
        || count > MAX_ENTRIES
        || central_size > MAX_ENTRIES * (46 + 512)
        || central_offset.checked_add(central_size) != Some(eocd)
    {
        return refuse("unsupported ZIP central directory");
    }
    let mut central = vec![0; central_size];
    read_exact_at(reader, central_offset, &mut central)?;
    let entries = locate_zip_members(reader, &central, count, central_offset)?;
    Ok(ZipPreflight {
        archive_len,
        entries,
    })
}

fn locate_zip_members<R: Read + Seek>(
    reader: &mut R,
    central: &[u8],
    count: usize,
    central_offset: usize,
) -> Result<Vec<ZipEntry>, ArchiveStoreError> {
    let mut at = 0usize;
    let mut total = 0usize;
    let mut manifests = 0usize;
    let mut names = BTreeSet::new();
    let mut entries = Vec::with_capacity(count);
    for _ in 0..count {
        if u32at(central, at) != Some(0x0201_4b50) {
            return refuse("invalid ZIP central entry");
        }
        let version_needed = u16at(central, at + 6).ok_or_else(|| fmt_err("truncated central"))?;
        let flags = u16at(central, at + 8).ok_or_else(|| fmt_err("truncated central"))?;
        let method = u16at(central, at + 10).ok_or_else(|| fmt_err("truncated central"))?;
        let mod_time = u16at(central, at + 12).ok_or_else(|| fmt_err("truncated central"))?;
        let mod_date = u16at(central, at + 14).ok_or_else(|| fmt_err("truncated central"))?;
        let crc = u32at(central, at + 16).ok_or_else(|| fmt_err("truncated central"))?;
        let compressed =
            u32at(central, at + 20).ok_or_else(|| fmt_err("truncated central"))? as usize;
        let size = u32at(central, at + 24).ok_or_else(|| fmt_err("truncated central"))? as usize;
        let name_len =
            u16at(central, at + 28).ok_or_else(|| fmt_err("truncated central"))? as usize;
        let extra = u16at(central, at + 30).ok_or_else(|| fmt_err("truncated central"))? as usize;
        let comment = u16at(central, at + 32).ok_or_else(|| fmt_err("truncated central"))? as usize;
        let disk = u16at(central, at + 34).ok_or_else(|| fmt_err("truncated central"))?;
        let external = u32at(central, at + 38).ok_or_else(|| fmt_err("truncated central"))?;
        let local_offset =
            u32at(central, at + 42).ok_or_else(|| fmt_err("truncated central"))? as usize;
        let end = at
            .checked_add(46 + name_len)
            .filter(|end| *end <= central.len())
            .ok_or_else(|| fmt_err("truncated central directory"))?;
        let mode = external >> 16;
        let file_type = mode & 0o170000;
        if flags != 0
            || method != 0
            || compressed != size
            || extra != 0
            || comment != 0
            || disk != 0
            || size > MAX_MEMBER
            || external & 0x10 != 0
            || !matches!(file_type, 0 | 0o100000)
        {
            return refuse("ZIP member is outside regular stored V2 profile");
        }
        let name = std::str::from_utf8(slice(central, at + 46, end)?)
            .map_err(|_| fmt_err("ZIP name is not UTF-8"))?
            .to_owned();
        if name == MANIFEST {
            manifests += 1;
            if size > MAX_MANIFEST {
                return refuse("manifest exceeds V2 bootstrap budget");
            }
        } else {
            path_ok(&name)?;
        }
        if !names.insert(name.clone()) {
            return refuse("duplicate ZIP member");
        }
        total = total
            .checked_add(size)
            .ok_or_else(|| fmt_err("ZIP total overflow"))?;
        if total > MAX_TOTAL {
            return refuse("ZIP total exceeds V2 budget");
        }
        let mut local = [0u8; 30];
        read_exact_at(reader, local_offset, &mut local)?;
        if u32at(&local, 0) != Some(0x0403_4b50)
            || u16at(&local, 4) != Some(version_needed)
            || u16at(&local, 6) != Some(flags)
            || u16at(&local, 8) != Some(method)
            || u16at(&local, 10) != Some(mod_time)
            || u16at(&local, 12) != Some(mod_date)
            || u32at(&local, 14) != Some(crc)
            || u32at(&local, 18) != Some(compressed as u32)
            || u32at(&local, 22) != Some(size as u32)
            || u16at(&local, 26) != Some(name_len as u16)
            || u16at(&local, 28) != Some(0)
        {
            return refuse("ZIP local header mismatch");
        }
        let local_name_offset = local_offset
            .checked_add(30)
            .ok_or_else(|| fmt_err("ZIP local offset overflow"))?;
        let mut local_name = vec![0; name_len];
        read_exact_at(reader, local_name_offset, &mut local_name)?;
        if local_name != name.as_bytes() {
            return refuse("ZIP local member name does not match central directory");
        }
        let data_start = local_name_offset
            .checked_add(name_len)
            .ok_or_else(|| fmt_err("ZIP local offset overflow"))?;
        let data_end = data_start
            .checked_add(size)
            .filter(|end| *end <= central_offset)
            .ok_or_else(|| fmt_err("ZIP payload is truncated or overlaps central directory"))?;
        entries.push(ZipEntry {
            name,
            crc,
            local_offset,
            data_start,
            data_end,
        });
        at = end;
    }
    if at != central.len() || manifests != 1 {
        return refuse("ZIP central directory/member inventory is invalid");
    }
    entries.sort_unstable_by_key(|entry| entry.local_offset);
    if entries
        .windows(2)
        .any(|pair| pair[0].data_end > pair[1].local_offset)
    {
        return refuse("ZIP local member regions overlap");
    }
    Ok(entries)
}

fn read_exact_at<R: Read + Seek>(
    reader: &mut R,
    offset: usize,
    bytes: &mut [u8],
) -> Result<(), ArchiveStoreError> {
    reader.seek(SeekFrom::Start(offset as u64))?;
    reader.read_exact(bytes)?;
    Ok(())
}

fn read_zip_member<R: Read + Seek>(
    reader: &mut R,
    entry: &ZipEntry,
) -> Result<Vec<u8>, ArchiveStoreError> {
    let len = entry
        .data_end
        .checked_sub(entry.data_start)
        .ok_or_else(|| fmt_err("ZIP payload range underflow"))?;
    let mut bytes = vec![0; len];
    read_exact_at(reader, entry.data_start, &mut bytes)?;
    if crc32(&bytes) != entry.crc {
        return Err(ArchiveStoreError::Integrity(format!(
            "ZIP CRC mismatch for `{}`",
            entry.name
        )));
    }
    Ok(bytes)
}

// serde_json keeps the last duplicate key. Archive V2 instead treats every
// object as closed, so the bounded dispatch parser must reject duplicates
// (including JSON-escape aliases) before building a Value. This is iterative
// to keep a hostile nested manifest from consuming the Rust stack.
fn parse_manifest_json(bytes: &[u8]) -> Result<Value, ArchiveStoreError> {
    let mut at = 0;
    let mut frames = Vec::new();
    let mut root_complete = false;
    scan_json_value_iterative(bytes, &mut at, &mut frames, &mut root_complete)?;
    while !root_complete {
        let frame = frames
            .pop()
            .ok_or_else(|| fmt_err("manifest has an incomplete JSON value"))?;
        match frame {
            JsonScanFrame::Object { mut keys, state } => match state {
                JsonObjectState::KeyOrEnd => {
                    skip_json_whitespace(bytes, &mut at);
                    if bytes.get(at) == Some(&b'}') {
                        at += 1;
                        complete_scanned_json_value(&mut frames, &mut root_complete)?;
                    } else if bytes.get(at) == Some(&b'"') {
                        let (start, end) = scan_json_string(bytes, &mut at)?;
                        let key: String = serde_json::from_slice(&bytes[start..end])
                            .map_err(|_| fmt_err("manifest has an invalid object key"))?;
                        if !keys.insert(key.clone()) {
                            return refuse(&format!("manifest has duplicate object key `{key}`"));
                        }
                        frames.push(JsonScanFrame::Object {
                            keys,
                            state: JsonObjectState::Colon,
                        });
                    } else {
                        return refuse("manifest object key must be a string");
                    }
                }
                JsonObjectState::Colon => {
                    skip_json_whitespace(bytes, &mut at);
                    if bytes.get(at) != Some(&b':') {
                        return refuse("manifest object key lacks ':'");
                    }
                    at += 1;
                    frames.push(JsonScanFrame::Object {
                        keys,
                        state: JsonObjectState::Value,
                    });
                    scan_json_value_iterative(bytes, &mut at, &mut frames, &mut root_complete)?;
                }
                JsonObjectState::Value => return refuse("manifest object is truncated"),
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
                        _ => return refuse("manifest object is truncated"),
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
                JsonArrayState::Value => return refuse("manifest array is truncated"),
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
                        _ => return refuse("manifest array is truncated"),
                    }
                }
            },
        }
    }
    skip_json_whitespace(bytes, &mut at);
    if at != bytes.len() {
        return refuse("manifest has trailing JSON data");
    }
    serde_json::from_slice(bytes).map_err(|_| fmt_err("manifest is not JSON"))
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
                return refuse("manifest has an invalid JSON value");
            }
            complete_scanned_json_value(frames, root_complete)
        }
        None => refuse("manifest is truncated"),
    }
}

fn push_json_frame(
    frames: &mut Vec<JsonScanFrame>,
    frame: JsonScanFrame,
) -> Result<(), ArchiveStoreError> {
    if frames.len() >= MAX_MANIFEST_JSON_NESTING {
        return refuse("manifest nesting exceeds the V2 structural limit");
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
        _ => refuse("manifest has an invalid JSON value position"),
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
                *at = at
                    .checked_add(2)
                    .ok_or_else(|| fmt_err("manifest string offset overflow"))?;
            }
            Some(_) => *at += 1,
            None => return refuse("manifest string is truncated"),
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

pub(crate) fn read_manifest_member<R: Read + Seek>(
    reader: &mut R,
    preflight: &ZipPreflight,
) -> Result<Value, ArchiveStoreError> {
    let entry = preflight
        .entries
        .iter()
        .find(|entry| entry.name == MANIFEST)
        .ok_or_else(|| fmt_err("ZIP dispatch member manifest.json is absent"))?;
    let bytes = read_zip_member(reader, entry)?;
    parse_manifest_json(&bytes)
}

/// Return bounded central-directory metadata without reading a payload body.
/// Archive V3 reuses this V2-hardened ZIP preflight but validates its own
/// manifest family before it asks for any member bytes.
pub(crate) fn preflight_payload_sizes(preflight: &ZipPreflight) -> BTreeMap<String, usize> {
    preflight
        .entries
        .iter()
        .filter(|entry| entry.name != MANIFEST)
        .map(|entry| {
            (
                entry.name.clone(),
                entry.data_end.saturating_sub(entry.data_start),
            )
        })
        .collect()
}

pub(crate) fn preflight_archive_len(preflight: &ZipPreflight) -> usize {
    preflight.archive_len
}

fn validate_manifest_for_dispatch(
    manifest: &Value,
    preflight: &ZipPreflight,
) -> Result<(), ArchiveStoreError> {
    let members = preflight
        .entries
        .iter()
        .filter(|entry| entry.name != MANIFEST)
        .map(|entry| {
            (
                entry.name.clone(),
                entry.data_end.saturating_sub(entry.data_start),
            )
        })
        .collect();
    validate_manifest_declarations(manifest, &members)
}

pub(crate) fn read_payload_members<R: Read + Seek>(
    reader: &mut R,
    preflight: &ZipPreflight,
) -> Result<BTreeMap<String, Vec<u8>>, ArchiveStoreError> {
    let mut members = BTreeMap::new();
    for entry in &preflight.entries {
        if entry.name != MANIFEST {
            let bytes = read_zip_member(reader, entry)?;
            if members.insert(entry.name.clone(), bytes).is_some() {
                return refuse("duplicate ZIP member");
            }
        }
    }
    Ok(members)
}

pub(crate) fn sha256_file(
    file: &mut File,
    expected_len: usize,
) -> Result<String, ArchiveStoreError> {
    if usize::try_from(file.metadata()?.len()).ok() != Some(expected_len) {
        return refuse("archive changed while being read");
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
    let mut trailing = [0u8; 1];
    if file.read(&mut trailing)? != 0
        || usize::try_from(file.metadata()?.len()).ok() != Some(expected_len)
    {
        return refuse("archive changed while being read");
    }
    Ok(format!("{:x}", hasher.finalize()))
}

pub(crate) fn atomic_create(path: &Path, bytes: &[u8]) -> Result<(), ArchiveStoreError> {
    let parent = path
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));
    let base = path
        .file_name()
        .and_then(|v| v.to_str())
        .ok_or_else(|| fmt_err("archive target has no UTF-8 file name"))?;
    fs::create_dir_all(parent)?;
    for _ in 0..64 {
        let seq = TEMP_SEQUENCE.fetch_add(1, Ordering::Relaxed);
        let temp = parent.join(format!(".{base}.v2-{seq}.tmp"));
        match OpenOptions::new().write(true).create_new(true).open(&temp) {
            Ok(mut file) => {
                let write = (|| -> Result<(), ArchiveStoreError> {
                    file.write_all(bytes)?;
                    file.sync_all()?;
                    drop(file);
                    fs::hard_link(&temp, path).map_err(|e| {
                        if e.kind() == std::io::ErrorKind::AlreadyExists {
                            ArchiveStoreError::AlreadyExists(path.to_path_buf())
                        } else {
                            ArchiveStoreError::Io(e)
                        }
                    })?;
                    match fs::remove_file(&temp).and_then(|()| {
                        File::open(parent).and_then(|directory| directory.sync_all())
                    }) {
                        Ok(()) => Ok(()),
                        Err(error) => Err(ArchiveStoreError::PublishedWithCleanupError {
                            path: path.to_path_buf(),
                            detail: error.to_string(),
                        }),
                    }
                })();
                if !matches!(
                    write,
                    Err(ArchiveStoreError::PublishedWithCleanupError { .. })
                ) {
                    let _ = fs::remove_file(&temp);
                }
                return write;
            }
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(e.into()),
        }
    }
    Err(fmt_err("unable to allocate temporary archive"))
}
fn object<'a>(v: &'a Value, label: &str) -> Result<&'a Map<String, Value>, ArchiveStoreError> {
    v.as_object()
        .ok_or_else(|| fmt_err(&format!("{label} must be object")))
}
fn object_mut<'a>(
    v: &'a mut Value,
    label: &str,
) -> Result<&'a mut Map<String, Value>, ArchiveStoreError> {
    v.as_object_mut()
        .ok_or_else(|| fmt_err(&format!("{label} must be object")))
}
fn required<'a>(o: &'a Map<String, Value>, key: &str) -> Result<&'a Value, ArchiveStoreError> {
    o.get(key)
        .ok_or_else(|| fmt_err(&format!("{key} is required")))
}
fn required_mut<'a>(
    o: &'a mut Map<String, Value>,
    key: &str,
) -> Result<&'a mut Value, ArchiveStoreError> {
    o.get_mut(key)
        .ok_or_else(|| fmt_err(&format!("{key} is required")))
}
fn required_str<'a>(o: &'a Map<String, Value>, key: &str) -> Result<&'a str, ArchiveStoreError> {
    required(o, key)?
        .as_str()
        .ok_or_else(|| fmt_err(&format!("{key} must be string")))
}
fn closed(o: &Map<String, Value>, keys: &[&str], label: &str) -> Result<(), ArchiveStoreError> {
    if o.keys().any(|key| !keys.contains(&key.as_str())) {
        return refuse(&format!("{label} has unknown fields"));
    }
    if keys
        .iter()
        .filter(|&&k| k != "extensions")
        .any(|k| !o.contains_key(*k))
    {
        return refuse(&format!("{label} lacks required fields"));
    }
    Ok(())
}
fn id_ok(value: &str, label: &str) -> Result<(), ArchiveStoreError> {
    if is_id(value) {
        Ok(())
    } else {
        refuse(&format!("{label} is outside the Archive V2 id grammar"))
    }
}

fn is_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'.' | b':' | b'-'))
}

fn validate_extensions(value: Option<&Value>) -> Result<(), ArchiveStoreError> {
    let Some(value) = value else {
        return Ok(());
    };
    let extensions = object(value, "extensions")?;
    if extensions.keys().any(|key| !is_extension_namespace(key)) {
        return refuse("extensions namespace is outside the Archive V2 grammar");
    }
    Ok(())
}

fn is_extension_namespace(value: &str) -> bool {
    let mut segments = value.split('.');
    let Some(first) = segments.next() else {
        return false;
    };
    is_extension_segment(first)
        && segments.next().is_some_and(is_extension_segment)
        && segments.all(is_extension_segment)
}

fn is_extension_segment(value: &str) -> bool {
    value
        .bytes()
        .next()
        .is_some_and(|byte| byte.is_ascii_alphabetic())
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
}

fn n4mm_path_ok(path: &str) -> bool {
    let Some(name) = path.strip_prefix("methods/") else {
        return false;
    };
    let Some(stem) = name.strip_suffix(".n4mm") else {
        return false;
    };
    !stem.is_empty()
        && stem
            .bytes()
            .next()
            .is_some_and(|byte| byte.is_ascii_alphanumeric())
        && stem
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'.' | b'-'))
}
fn path_ok(path: &str) -> Result<(), ArchiveStoreError> {
    if path.is_empty()
        || path.len() > 512
        || path == MANIFEST
        || path.starts_with('/')
        || path.contains('\\')
        || path
            .split('/')
            .any(|s| s.is_empty() || s == "." || s == "..")
        || path.nfc().collect::<String>() != path
    {
        return refuse("unsafe archive member path");
    }
    Ok(())
}
fn sha256(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn sha256_text(value: Option<&str>) -> bool {
    value.is_some_and(|text| {
        text.len() == 64
            && text
                .bytes()
                .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
    })
}
fn refuse<T>(detail: &str) -> Result<T, ArchiveStoreError> {
    Err(fmt_err(detail))
}
fn fmt_err(detail: &str) -> ArchiveStoreError {
    ArchiveStoreError::Format(format!("archive V2 format refusal: {detail}"))
}
fn u16le(out: &mut Vec<u8>, v: u16) {
    out.extend_from_slice(&v.to_le_bytes())
}
fn u32le(out: &mut Vec<u8>, v: u32) {
    out.extend_from_slice(&v.to_le_bytes())
}
fn u16at(b: &[u8], i: usize) -> Option<u16> {
    b.get(i..i + 2).map(|v| u16::from_le_bytes([v[0], v[1]]))
}
fn u32at(b: &[u8], i: usize) -> Option<u32> {
    b.get(i..i + 4)
        .map(|v| u32::from_le_bytes([v[0], v[1], v[2], v[3]]))
}
fn slice(b: &[u8], start: usize, end: usize) -> Result<&[u8], ArchiveStoreError> {
    b.get(start..end)
        .ok_or_else(|| fmt_err("truncated ZIP member"))
}
fn crc32(bytes: &[u8]) -> u32 {
    let mut crc = !0u32;
    for &byte in bytes {
        crc ^= u32::from(byte);
        for _ in 0..8 {
            crc = (crc >> 1) ^ if crc & 1 != 0 { 0xedb8_8320 } else { 0 }
        }
    }
    !crc
}

#[cfg(all(test, not(nirs4all_archive_v2_source_consumer)))]
mod tests {
    use super::*;
    use crate::{
        replay_methods_archive_v2, replay_methods_archive_v2_conformal_presentation_v1,
        MethodsArchivePredictRequest,
    };
    use dag_ml_core::{Phase, RunId, TrainingReplayRequest};
    use std::collections::BTreeMap;
    use std::time::{SystemTime, UNIX_EPOCH};
    fn path(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "n4a-v2-{name}-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ))
    }
    fn request() -> ArchiveV2WriteRequest {
        let paths = [
            PACKAGE,
            "dagml/graph.json",
            "dagml/execution_bundle.json",
            "dagml/training_outcome.json",
            "dagml/prediction_cache_payload_set.json",
            "dagml/score_set.json",
            "methods/model.n4mm",
        ];
        let mut payloads = paths
            .iter()
            .map(|p| ArchivePayload {
                path: (*p).into(),
                bytes: format!("opaque:{p}").into_bytes(),
            })
            .collect::<Vec<_>>();
        // Deliberately package-shaped but not semantically interpreted here:
        // DAG-ML is the only owner of Package V2 semantic validation/replay.
        payloads[0].bytes = br#"{"schema_version":2,"package_id":"predictor:storage-fixture","fitted_artifact_mode":"portable_required"}"#.to_vec();
        let mut inventory=paths.iter().map(|p|serde_json::json!({"path":p,"regular_file":true,"raw_sha256":"0".repeat(64),"uncompressed_size_bytes":0,"semantic_fingerprint":"a".repeat(64),"semantic_profile":"dagml_tcv1"})).collect::<Vec<_>>();
        inventory[6]["semantic_fingerprint"] = Value::String("b".repeat(64));
        inventory[6]["semantic_profile"] = Value::String("n4mm_raw_sha256".into());
        for index in [1, 4, 5] {
            inventory[index]["semantic_profile"] =
                Value::String("dagml_historical_serde_json_v1".into());
        }
        let dag = |path: &str, schema: &str, version: u64, port: bool| {
            let profile = if matches!(schema, GRAPH_SCHEMA | CACHE_SCHEMA | SCORE_SCHEMA) {
                "dagml_historical_serde_json_v1"
            } else {
                "dagml_tcv1"
            };
            let mut v = serde_json::json!({"owner":"dag-ml","schema_id":schema,"schema_version":version,"member_path":path,"raw_sha256":"0".repeat(64),"semantic_fingerprint":"a".repeat(64),"semantic_profile":profile});
            if port {
                v["producer_port_required"] = Value::Bool(true)
            }
            v
        };
        let n4mm_fingerprint = sha256(&payloads[6].bytes);
        inventory[6]["semantic_fingerprint"] = Value::String(n4mm_fingerprint.clone());
        let mut manifest = serde_json::json!({"schema_version":2,"profile":PROFILE,"archive_id":"archive:v2-test","persistence_kind":"n4a_archive","writer":{"product_aggregate_owner":"nirs4all-core","canonical_writer_id":WRITER_ID},"reader_dispatch":{"archive_v2":{"accepted_versions":[2],"future_versions":"refuse","dispatch_before_extraction":true},"archive_v1":{"accepted_versions":[1],"read_mode":"immutable_dual_read","mutation":"never_in_place"},"legacy_n4a":{"form":"historical_n4a_zip","manifest_member":"manifest.json","reader_id":"nirs4all.pipeline.bundle.loader.BundleLoader","maximum_bundle_format_version":"1.0","migration_direction":"legacy_to_v1_copy_on_write_only"}},"physical_profile":{"container":"zip","manifest_member":"manifest.json","regular_files_only":true,"limits":{"max_entries":256,"max_total_uncompressed_bytes":536870912,"max_member_uncompressed_bytes":134217728,"max_compression_ratio":100}},"replay":{"portable_predictor_package":dag(PACKAGE,PACKAGE_SCHEMA,2,true),"training_artifacts":{"graph":dag("dagml/graph.json",GRAPH_SCHEMA,1,false),"execution_bundle":dag("dagml/execution_bundle.json",BUNDLE_SCHEMA,2,true),"training_outcome":dag("dagml/training_outcome.json",OUTCOME_SCHEMA,2,true),"prediction_cache_payload_set":dag("dagml/prediction_cache_payload_set.json",CACHE_SCHEMA,2,true),"score_set":dag("dagml/score_set.json",SCORE_SCHEMA,2,true)},"future_artifacts":[]},"payloads":{"methods":{"n4mm":[{"artifact_id":"artifact:model:refit","kind":"N4MM","owner":"nirs4all-methods","format_version":1,"abi_major":2,"member_path":"methods/model.n4mm","raw_sha256":"0".repeat(64),"semantic_fingerprint":n4mm_fingerprint,"semantic_profile":"n4mm_raw_sha256"}],"n4mopt":[]},"n4d_aggregate_reference":null,"conformal":null,"robustness":null,"host_artifacts":[]},"member_inventory":inventory,"migration_provenance":null,"security":{"integrity_profile":"sha256_raw_member_inventory_v2","signature":null},"workspace":null});
        // The storage writer derives raw hashes; the binary semantic identity
        // is intentionally the exact same raw N4MM digest.
        manifest["payloads"]["methods"]["n4mm"][0]["semantic_fingerprint"] =
            Value::String(sha256(&payloads[6].bytes));
        ArchiveV2WriteRequest { manifest, payloads }
    }

    #[test]
    fn archive_v2_storage_fixture_is_semantically_refused_before_methods_runtime() {
        let target = path("dagml-semantic-boundary");
        write_archive_v2(&target, request()).unwrap();
        let archive = load_archive_v2(&target).unwrap();
        let replay = || TrainingReplayRequest {
            schema_version: 0,
            request_id: "request:storage-fixture".to_owned(),
            source_outcome_fingerprint: "0".repeat(64),
            phase: Phase::Predict,
            data_envelope_keys: Vec::new(),
            output_binding_ids: Vec::new(),
            request_fingerprint: String::new(),
        };
        let input = || MethodsArchivePredictRequest {
            request: replay(),
            data_envelopes: BTreeMap::new(),
            methods_inputs: BTreeMap::new(),
            methods_library_path: PathBuf::from("/must-not-open-libn4m"),
            outcome_id: "outcome:storage-fixture".to_owned(),
            run_id: RunId::new("run:storage-fixture").unwrap(),
            warnings: Vec::new(),
            diagnostics: BTreeMap::new(),
        };
        for error in [
            replay_methods_archive_v2(&archive, input()).unwrap_err(),
            replay_methods_archive_v2_conformal_presentation_v1(&archive, input()).unwrap_err(),
        ] {
            let message = error.to_string();
            assert!(message.starts_with("DAG-ML rejected Core Archive V2 package:"));
            assert!(!message.contains("cannot configure the Methods runtime"));
        }
        let _ = std::fs::remove_file(target);
    }

    fn rewrite_manifest_same_length(bytes: &mut [u8], from: &[u8], to: &[u8]) {
        assert_eq!(from.len(), to.len());
        let manifest_start = 30 + u16at(bytes, 26).unwrap() as usize;
        let manifest_end = manifest_start + u32at(bytes, 22).unwrap() as usize;
        let relative = bytes[manifest_start..manifest_end]
            .windows(from.len())
            .position(|window| window == from)
            .unwrap();
        bytes[manifest_start + relative..manifest_start + relative + from.len()]
            .copy_from_slice(to);
        refresh_manifest_crc(bytes);
    }

    fn refresh_manifest_crc(bytes: &mut [u8]) {
        let manifest_start = 30 + u16at(bytes, 26).unwrap() as usize;
        let manifest_end = manifest_start + u32at(bytes, 22).unwrap() as usize;
        let crc = crc32(&bytes[manifest_start..manifest_end]);
        bytes[14..18].copy_from_slice(&crc.to_le_bytes());
        let central = bytes
            .windows(4)
            .position(|window| window == b"PK\x01\x02")
            .unwrap();
        bytes[central + 16..central + 20].copy_from_slice(&crc.to_le_bytes());
    }
    #[test]
    fn v2_round_trips_exact_opaque_package_bytes_and_dual_dispatches() {
        let p = path("roundtrip.n4a");
        let req = request();
        let expected = req.payloads[0].bytes.clone();
        let r = write_archive_v2(&p, req).unwrap();
        let a = load_archive_v2(&p).unwrap();
        assert_eq!(a.reference(), &r);
        assert_eq!(a.portable_predictor_package().unwrap(), expected);
        let raw = fs::read(&p).unwrap();
        let from_bytes = load_archive_v2_bytes(&raw).unwrap();
        assert_eq!(from_bytes.reference(), &r);
        assert_eq!(from_bytes.manifest(), a.manifest());
        assert_eq!(
            from_bytes.methods_n4mm_artifacts().unwrap(),
            a.methods_n4mm_artifacts().unwrap()
        );
        assert!(matches!(load_archive(&p).unwrap(), LoadedArchive::V2(_)));
        let _ = fs::remove_file(p);
    }
    #[test]
    fn v2_dual_reads_historical_abi_minor_and_projects_new_minimum() {
        let historical_path = path("historical-abi-minor.n4a");
        write_archive_v2(&historical_path, request()).unwrap();
        let historical = load_archive_v2(&historical_path).unwrap();
        assert_eq!(
            historical.methods_n4mm_artifacts().unwrap()[0].abi_min_minor(),
            0
        );
        assert_eq!(
            historical.methods_n4mm_artifacts().unwrap()[0].format_version(),
            1
        );
        let _ = fs::remove_file(historical_path);

        let current_path = path("current-abi-minor.n4a");
        let mut current = request();
        current.manifest["payloads"]["methods"]["n4mm"][0]["abi_min_minor"] = Value::from(3);
        write_archive_v2(&current_path, current).unwrap();
        let current = load_archive_v2(&current_path).unwrap();
        assert_eq!(
            current.methods_n4mm_artifacts().unwrap()[0].abi_min_minor(),
            3
        );
        let _ = fs::remove_file(current_path);

        let pipeline_path = path("pipeline-format-v2.n4a");
        let mut pipeline = request();
        pipeline.manifest["payloads"]["methods"]["n4mm"][0]["format_version"] = Value::from(2);
        pipeline.manifest["payloads"]["methods"]["n4mm"][0]["abi_min_minor"] = Value::from(5);
        write_archive_v2(&pipeline_path, pipeline).unwrap();
        let pipeline = load_archive_v2(&pipeline_path).unwrap();
        let declaration = &pipeline.methods_n4mm_artifacts().unwrap()[0];
        assert_eq!(declaration.format_version(), 2);
        assert_eq!(declaration.abi_min_minor(), 5);
        let _ = fs::remove_file(pipeline_path);
    }
    #[test]
    fn v2_refuses_non_integer_abi_minimum() {
        let path = path("invalid-abi-minor.n4a");
        let mut request = request();
        request.manifest["payloads"]["methods"]["n4mm"][0]["abi_min_minor"] =
            Value::String("3".to_owned());
        assert!(matches!(
            write_archive_v2(&path, request),
            Err(ArchiveStoreError::Format(_))
        ));
    }

    #[test]
    fn v2_pipeline_format_requires_methods_abi_2_5() {
        for minor in [None, Some(4), Some(6)] {
            let target = path("pipeline-wrong-abi.n4a");
            let mut request = request();
            request.manifest["payloads"]["methods"]["n4mm"][0]["format_version"] = Value::from(2);
            match minor {
                Some(minor) => {
                    request.manifest["payloads"]["methods"]["n4mm"][0]["abi_min_minor"] =
                        Value::from(minor);
                }
                None => {
                    request.manifest["payloads"]["methods"]["n4mm"][0]
                        .as_object_mut()
                        .unwrap()
                        .remove("abi_min_minor");
                }
            }
            assert!(matches!(
                write_archive_v2(&target, request),
                Err(ArchiveStoreError::Format(_))
            ));
        }
    }
    #[test]
    fn v2_refuses_host_and_mixed_package_before_write() {
        let p = path("refuse.n4a");
        let mut r = request();
        r.manifest["payloads"]["host_artifacts"] = serde_json::json!([{"kind":"pickle"}]);
        assert!(matches!(
            write_archive_v2(&p, r),
            Err(ArchiveStoreError::Format(_))
        ));
        let mut r = request();
        r.manifest["replay"]["portable_predictor_package"]["schema_version"] = Value::from(1);
        assert!(matches!(
            write_archive_v2(&p, r),
            Err(ArchiveStoreError::Format(_))
        ));
    }
    #[test]
    fn v2_refuses_semantic_mismatch_unreferenced_payload_and_invalid_resume() {
        let p = path("closure.n4a");
        let mut r = request();
        r.manifest["replay"]["portable_predictor_package"]["semantic_fingerprint"] =
            Value::String("c".repeat(64));
        assert!(matches!(
            write_archive_v2(&p, r),
            Err(ArchiveStoreError::Format(_))
        ));

        let mut r = request();
        r.payloads.push(ArchivePayload {
            path: "methods/unreferenced-model.pkl".into(),
            bytes: b"not-a-declared-artifact".to_vec(),
        });
        r.manifest["member_inventory"]
            .as_array_mut()
            .unwrap()
            .push(serde_json::json!({
                "path":"methods/unreferenced-model.pkl", "regular_file":true,
                "raw_sha256":"0".repeat(64), "uncompressed_size_bytes":0,
                "semantic_fingerprint":"b".repeat(64), "semantic_profile":"methods_rfc8785_jcs"
            }));
        assert!(matches!(
            write_archive_v2(&p, r),
            Err(ArchiveStoreError::Format(_))
        ));

        let mut r = request();
        r.manifest["payloads"]["methods"]["n4mopt"] = serde_json::json!([{
            "kind":"N4MOPT", "owner":"nirs4all-methods", "format_version":2,
            "abi_major":2, "member_path":"methods/resume.n4mopt",
            "raw_sha256":"0".repeat(64), "semantic_fingerprint":"b".repeat(64),
            "semantic_profile":"methods_rfc8785_jcs"
        }]);
        assert!(matches!(
            write_archive_v2(&p, r),
            Err(ArchiveStoreError::Format(_))
        ));
    }
    #[test]
    fn v2_zip_preflight_refuses_central_local_name_divergence() {
        let p = path("zip-preflight.n4a");
        write_archive_v2(&p, request()).unwrap();
        let mut bytes = fs::read(&p).unwrap();
        let central = bytes
            .windows(4)
            .position(|window| window == b"PK\x01\x02")
            .unwrap();
        bytes[central + 46] = b'x';
        fs::write(&p, bytes).unwrap();
        assert!(matches!(
            load_archive_v2(&p),
            Err(ArchiveStoreError::Format(_))
        ));
        let _ = fs::remove_file(p);
    }
    #[test]
    fn v2_atomic_writer_never_replaces_an_existing_archive() {
        let p = path("atomic.n4a");
        write_archive_v2(&p, request()).unwrap();
        let original = fs::read(&p).unwrap();
        assert!(matches!(
            write_archive_v2(&p, request()),
            Err(ArchiveStoreError::AlreadyExists(_))
        ));
        assert_eq!(fs::read(&p).unwrap(), original);
        let _ = fs::remove_file(p);
    }
    #[test]
    fn dispatch_refuses_future_manifest_before_corrupt_payload_is_loaded() {
        let p = path("future-dispatch.n4a");
        write_archive_v2(&p, request()).unwrap();
        let mut bytes = fs::read(&p).unwrap();
        let manifest_start = 30 + u16at(&bytes, 26).unwrap() as usize;
        let manifest_end = manifest_start + u32at(&bytes, 22).unwrap() as usize;
        let root_prefix = b"{\"schema_version\":2";
        assert!(bytes[manifest_start..manifest_end].starts_with(root_prefix));
        bytes[manifest_start + b"{\"schema_version\":".len()] = b'9';
        // Preserve the manifest's physical CRC so dispatch reaches the
        // unknown-version refusal; the independently corrupted payload must
        // remain unread at that point.
        let manifest_crc = crc32(&bytes[manifest_start..manifest_end]);
        bytes[14..18].copy_from_slice(&manifest_crc.to_le_bytes());
        let central = bytes
            .windows(4)
            .position(|window| window == b"PK\x01\x02")
            .unwrap();
        bytes[central + 16..central + 20].copy_from_slice(&manifest_crc.to_le_bytes());
        let payload = bytes
            .windows(6)
            .position(|window| window == b"opaque")
            .unwrap();
        bytes[payload] ^= 1;
        fs::write(&p, bytes).unwrap();
        let error = load_archive(&p).unwrap_err();
        assert!(
            matches!(error, ArchiveStoreError::Format(ref detail) if detail.contains("dispatch refuses schema_version=9")),
            "{error}"
        );
        let _ = fs::remove_file(p);
    }

    #[test]
    fn direct_v2_reader_refuses_invalid_manifest_before_corrupt_payload_crc() {
        let p = path("direct-manifest-before-payload.n4a");
        write_archive_v2(&p, request()).unwrap();
        let mut bytes = fs::read(&p).unwrap();
        rewrite_manifest_same_length(&mut bytes, b"nirs4all-core", b"xirs4all-core");
        let payload = bytes
            .windows(6)
            .position(|window| window == b"opaque")
            .unwrap();
        bytes[payload] ^= 1;
        fs::write(&p, bytes).unwrap();
        let error = load_archive_v2(&p).unwrap_err();
        assert!(
            matches!(error, ArchiveStoreError::Format(ref detail) if detail.contains("writer identity")),
            "{error}"
        );
        let _ = fs::remove_file(p);
    }

    #[test]
    fn direct_and_generic_readers_refuse_duplicate_manifest_keys_before_payload_io() {
        let p = path("duplicate-manifest-key.n4a");
        write_archive_v2(&p, request()).unwrap();
        let mut bytes = fs::read(&p).unwrap();
        // Whitespace after a JSON key is legal, so this is a same-length
        // duplicate of the existing root `writer` key.
        rewrite_manifest_same_length(&mut bytes, b"\"profile\"", b"\"writer\" ");
        let payload = bytes
            .windows(6)
            .position(|window| window == b"opaque")
            .unwrap();
        bytes[payload] ^= 1;
        fs::write(&p, bytes).unwrap();
        let direct = load_archive_v2(&p).unwrap_err();
        assert!(
            matches!(direct, ArchiveStoreError::Format(ref detail) if detail.contains("duplicate object key")),
            "{direct}"
        );
        let error = load_archive(&p).unwrap_err();
        assert!(
            matches!(error, ArchiveStoreError::Format(ref detail) if detail.contains("duplicate object key")),
            "{error}"
        );
        let _ = fs::remove_file(p);

        let p = path("escaped-duplicate-manifest-key.n4a");
        write_archive_v2(&p, request()).unwrap();
        let mut bytes = fs::read(&p).unwrap();
        rewrite_manifest_same_length(&mut bytes, b"\"reader_dispatch\"", b"\"\\u0077riter\"    ");
        fs::write(&p, bytes).unwrap();
        let error = load_archive_v2(&p).unwrap_err();
        assert!(
            matches!(error, ArchiveStoreError::Format(ref detail) if detail.contains("duplicate object key `writer`")),
            "{error}"
        );
        let _ = fs::remove_file(p);
    }

    #[test]
    fn readers_refuse_inventory_size_metadata_before_payload_crc() {
        let p = path("inventory-size-before-payload.n4a");
        write_archive_v2(&p, request()).unwrap();
        let mut bytes = fs::read(&p).unwrap();
        let manifest_start = 30 + u16at(&bytes, 26).unwrap() as usize;
        let manifest_end = manifest_start + u32at(&bytes, 22).unwrap() as usize;
        let prefix = b"\"uncompressed_size_bytes\":";
        let offset = bytes[manifest_start..manifest_end]
            .windows(prefix.len())
            .position(|window| window == prefix)
            .unwrap()
            + manifest_start
            + prefix.len();
        assert!(bytes[offset].is_ascii_digit());
        bytes[offset] = if bytes[offset] == b'9' { b'8' } else { b'9' };
        refresh_manifest_crc(&mut bytes);
        let payload = bytes
            .windows(6)
            .position(|window| window == b"opaque")
            .unwrap();
        bytes[payload] ^= 1;
        fs::write(&p, bytes).unwrap();
        let direct = load_archive_v2(&p).unwrap_err();
        assert!(
            matches!(direct, ArchiveStoreError::Format(ref detail) if detail.contains("inventory")),
            "{direct}"
        );
        let generic = load_archive(&p).unwrap_err();
        assert!(
            matches!(generic, ArchiveStoreError::Format(ref detail) if detail.contains("inventory")),
            "{generic}"
        );
        let _ = fs::remove_file(p);
    }

    #[test]
    fn v2_closes_optional_refs_and_exact_schema_grammars() {
        let p = path("optional-ref-closure.n4a");
        let mut request = request();
        request.payloads.extend([
            ArchivePayload {
                path: "resume-artifact".into(),
                bytes: b"resume".to_vec(),
            },
            ArchivePayload {
                path: "aggregate-reference".into(),
                bytes: b"aggregate".to_vec(),
            },
            ArchivePayload {
                path: "robustness-report".into(),
                bytes: b"robustness".to_vec(),
            },
        ]);
        let add_inventory =
            |manifest: &mut Value, path: &str, profile: &str, fingerprint: Value| {
                manifest["member_inventory"]
                    .as_array_mut()
                    .unwrap()
                    .push(serde_json::json!({
                        "path": path,
                        "regular_file": true,
                        "raw_sha256": "0".repeat(64),
                        "uncompressed_size_bytes": 0,
                        "semantic_fingerprint": fingerprint,
                        "semantic_profile": profile,
                    }));
            };
        add_inventory(
            &mut request.manifest,
            "resume-artifact",
            "methods_rfc8785_jcs",
            Value::String("a".repeat(64)),
        );
        add_inventory(
            &mut request.manifest,
            "aggregate-reference",
            "none",
            Value::Null,
        );
        add_inventory(
            &mut request.manifest,
            "robustness-report",
            "dagml_tcv1",
            Value::String("b".repeat(64)),
        );
        request.manifest["payloads"]["methods"]["n4mopt"] = serde_json::json!([{
            "kind":"N4MOPT", "owner":"nirs4all-methods", "format_version":1,
            "abi_major":2, "member_path":"resume-artifact", "raw_sha256":"0".repeat(64),
            "semantic_fingerprint":"a".repeat(64), "semantic_profile":"methods_rfc8785_jcs"
        }]);
        request.manifest["payloads"]["n4d_aggregate_reference"] = serde_json::json!({
            "kind":"n4d_aggregate_reference", "owner":"nirs4all-core",
            "interpretation":"aggregate_reference_not_n4d_format_claim",
            "member_path":"aggregate-reference", "raw_sha256":"0".repeat(64),
            "semantic_fingerprint":null, "semantic_profile":"none"
        });
        request.manifest["payloads"]["robustness"] = serde_json::json!({
            "owner":"dag-ml", "schema_id":"https://github.com/GBeurier/dag-ml/schemas/robustness_report.v1.schema.json",
            "schema_version":1, "member_path":"robustness-report", "raw_sha256":"0".repeat(64),
            "semantic_fingerprint":"b".repeat(64), "semantic_profile":"dagml_tcv1"
        });
        request.manifest["extensions"] = serde_json::json!({"example.extension-v2": 17});
        write_archive_v2(&p, request.clone()).unwrap();
        assert!(load_archive_v2(&p).is_ok());
        let _ = fs::remove_file(&p);

        request.manifest["payloads"]["methods"]["n4mm"][0]["artifact_id"] =
            Value::String("bad/path".into());
        assert!(matches!(
            write_archive_v2(&p, request),
            Err(ArchiveStoreError::Format(_))
        ));
    }
    #[test]
    fn manifest_serializer_refuses_before_unbounded_output_allocation() {
        let manifest = Value::String("x".repeat(MAX_MANIFEST));
        assert!(matches!(
            serialize_manifest_bounded(&manifest),
            Err(ArchiveStoreError::Format(_))
        ));
    }
    #[test]
    fn v2_refuses_tampered_member() {
        let p = path("tamper.n4a");
        write_archive_v2(&p, request()).unwrap();
        let mut bytes = fs::read(&p).unwrap();
        let i = bytes.windows(6).position(|w| w == b"opaque").unwrap();
        bytes[i] ^= 1;
        fs::write(&p, bytes).unwrap();
        assert!(matches!(
            load_archive_v2(&p),
            Err(ArchiveStoreError::Integrity(_))
        ));
        let _ = fs::remove_file(p);
    }
}
