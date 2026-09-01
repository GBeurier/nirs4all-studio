//! Archive V3 target-bound full-refit storage bridge.
//!
//! V3 is deliberately not a V2 predictor-package variant. DAG-ML emits the
//! closed Package/Outcome/Bundle V3 byte closure; Core validates only the
//! bounded ZIP container, exact inventory and declared native artifact bytes.
//! It never parses a DAG-ML package or executes a model.

use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

use serde_json::{Map, Value};
use sha2::{Digest, Sha256};

use crate::archive_v2::{
    atomic_create, open_v2_preflight, preflight_archive_len, preflight_payload_sizes,
    read_manifest_member, read_payload_members, sha256_file, stored_zip,
};
use crate::{ArchivePayload, ArchiveStoreError};

const PROFILE: &str = "nirs4all.archive_workspace.v3";
const WRITER_ID: &str = "nirs4all-core.archive_workspace_writer.v3";
const MANIFEST: &str = "manifest.json";
const PACKAGE: &str = "dagml/portable_refit_package.json";
const GRAPH: &str = "dagml/graph.json";
const BUNDLE: &str = "dagml/portable_refit_execution_bundle.json";
const OUTCOME: &str = "dagml/portable_refit_outcome.json";
const MAX_ENTRIES: usize = 256;
const MAX_MEMBER: usize = 134_217_728;
const MAX_TOTAL: usize = 536_870_912;
const PACKAGE_SCHEMA: &str =
    "https://github.com/GBeurier/dag-ml/schemas/portable_refit_package.v3.schema.json";
const GRAPH_SCHEMA: &str = "https://github.com/GBeurier/dag-ml/schemas/graph_spec.v1.schema.json";
const BUNDLE_SCHEMA: &str =
    "https://github.com/GBeurier/dag-ml/schemas/portable_refit_execution_bundle.v3.schema.json";
const OUTCOME_SCHEMA: &str =
    "https://github.com/GBeurier/dag-ml/schemas/portable_refit_outcome.v3.schema.json";

#[derive(Clone, Debug)]
pub struct ArchiveV3WriteRequest {
    pub manifest: Value,
    pub payloads: Vec<ArchivePayload>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ArchiveV3Reference {
    archive_id: String,
    archive_sha256: String,
}

impl ArchiveV3Reference {
    pub fn archive_id(&self) -> &str {
        &self.archive_id
    }
    pub fn schema_version(&self) -> u32 {
        3
    }
    pub fn profile(&self) -> &str {
        PROFILE
    }
    pub fn archive_sha256(&self) -> &str {
        &self.archive_sha256
    }
    pub fn portable_refit_package_member(&self) -> &'static str {
        PACKAGE
    }
}

#[derive(Clone, Debug)]
pub struct LoadedArchiveV3 {
    reference: ArchiveV3Reference,
    manifest: Value,
    members: BTreeMap<String, Vec<u8>>,
}

impl LoadedArchiveV3 {
    pub fn reference(&self) -> &ArchiveV3Reference {
        &self.reference
    }
    pub fn manifest(&self) -> &Value {
        &self.manifest
    }
    /// Return exact stored bytes. DAG-ML remains the only V3 package/refit
    /// parser and replay executor.
    pub fn member(&self, path: &str) -> Result<&[u8], ArchiveStoreError> {
        self.members.get(path).map(Vec::as_slice).ok_or_else(|| {
            ArchiveStoreError::Integrity(format!("V3 member `{path}` disappeared after validation"))
        })
    }
    pub fn portable_refit_package(&self) -> Result<&[u8], ArchiveStoreError> {
        self.member(PACKAGE)
    }
}

pub fn write_archive_v3(
    path: &Path,
    request: ArchiveV3WriteRequest,
) -> Result<ArchiveV3Reference, ArchiveStoreError> {
    let (manifest, members, archive_id) = prepare(request.manifest, request.payloads, true)?;
    let bytes = stored_zip(&manifest, &members)?;
    let reference = ArchiveV3Reference {
        archive_id,
        archive_sha256: sha256(&bytes),
    };
    atomic_create(path, &bytes)?;
    Ok(reference)
}

pub fn load_archive_v3(path: &Path) -> Result<LoadedArchiveV3, ArchiveStoreError> {
    let (mut file, preflight) = open_v2_preflight(path)?;
    let manifest = read_manifest_member(&mut file, &preflight)?;
    // V3 family/closure validation is deliberately complete before any model
    // payload body is copied or CRC-checked.
    validate_declarations(&manifest, &preflight_payload_sizes(&preflight))?;
    let members = read_payload_members(&mut file, &preflight)?;
    let (manifest, members, archive_id) = prepare(
        manifest,
        members
            .into_iter()
            .map(|(path, bytes)| ArchivePayload { path, bytes })
            .collect(),
        false,
    )?;
    let archive_sha256 = sha256_file(&mut file, preflight_archive_len(&preflight))?;
    Ok(LoadedArchiveV3 {
        reference: ArchiveV3Reference {
            archive_id,
            archive_sha256,
        },
        manifest,
        members,
    })
}

type PreparedArchive = (Value, BTreeMap<String, Vec<u8>>, String);
type InventoryMeta = BTreeMap<String, (String, String, String)>;

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
            return refuse("manifest.json cannot be supplied as a V3 payload");
        }
        if payload.bytes.len() > MAX_MEMBER {
            return refuse("payload exceeds V3 member budget");
        }
        total = total
            .checked_add(payload.bytes.len())
            .ok_or_else(|| fmt_err("payload total overflow"))?;
        if total > MAX_TOTAL {
            return refuse("payload total exceeds V3 budget");
        }
        if members
            .insert(payload.path.clone(), payload.bytes)
            .is_some()
        {
            return refuse("duplicate V3 payload path");
        }
    }
    if members.len() + 1 > MAX_ENTRIES {
        return refuse("payload entry count exceeds V3 budget");
    }
    let sizes = members
        .iter()
        .map(|(path, bytes)| (path.clone(), bytes.len()))
        .collect::<BTreeMap<_, _>>();
    if derive_raw {
        // All accesses in derivation are checked and limited to declared paths;
        // Core is the final raw hash/size authority, so writer placeholders are
        // filled before the exact physical inventory comparison below.
        derive_inventory(&mut manifest, &members)?;
    }
    validate_declarations(&manifest, &sizes)?;
    validate_raw_closure(&manifest, &members)?;
    let root = object(&manifest, "manifest")?;
    let archive_id = required_str(root, "archive_id")?.to_owned();
    Ok((manifest, members, archive_id))
}

fn validate_declarations(
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
        ],
        "V3 manifest",
    )?;
    if root.get("schema_version").and_then(Value::as_u64) != Some(3)
        || root.get("profile").and_then(Value::as_str) != Some(PROFILE)
        || root.get("persistence_kind").and_then(Value::as_str) != Some("n4a_archive")
    {
        return refuse("not an exact Archive V3 manifest");
    }
    id_ok(required_str(root, "archive_id")?, "archive_id")?;
    validate_writer(object(required(root, "writer")?, "writer")?)?;
    validate_dispatch(object(
        required(root, "reader_dispatch")?,
        "reader_dispatch",
    )?)?;
    validate_physical(object(
        required(root, "physical_profile")?,
        "physical_profile",
    )?)?;
    if root.get("migration_provenance") != Some(&Value::Null)
        || root.get("workspace") != Some(&Value::Null)
    {
        return refuse("Archive V3 refuses in-place migration and workspace snapshots");
    }
    let security = object(required(root, "security")?, "security")?;
    closed(security, &["integrity_profile", "signature"], "security")?;
    if security.get("integrity_profile").and_then(Value::as_str)
        != Some("sha256_raw_member_inventory_v3")
        || security.get("signature") != Some(&Value::Null)
    {
        return refuse("Archive V3 security profile is not exact");
    }
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
    if payloads.get("n4d_aggregate_reference") != Some(&Value::Null)
        || payloads.get("conformal") != Some(&Value::Null)
        || payloads.get("robustness") != Some(&Value::Null)
        || payloads
            .get("host_artifacts")
            .and_then(Value::as_array)
            .filter(|items| items.is_empty())
            .is_none()
    {
        return refuse("Archive V3 refuses nonportable sidecars and copied calibration state");
    }
    let methods = object(required(payloads, "methods")?, "payloads.methods")?;
    closed(methods, &["n4mm", "n4mopt"], "payloads.methods")?;
    if methods
        .get("n4mm")
        .and_then(Value::as_array)
        .filter(|items| !items.is_empty())
        .is_none()
        || methods
            .get("n4mopt")
            .and_then(Value::as_array)
            .filter(|items| items.is_empty())
            .is_none()
    {
        return refuse("Archive V3 requires N4MM and forbids resumable N4MOPT payloads");
    }
    let replay = object(required(root, "replay")?, "replay")?;
    closed(
        replay,
        &[
            "portable_refit_package",
            "refit_artifacts",
            "future_artifacts",
        ],
        "replay",
    )?;
    if replay
        .get("future_artifacts")
        .and_then(Value::as_array)
        .filter(|items| items.is_empty())
        .is_none()
    {
        return refuse("Archive V3 has no deferred replay artifacts");
    }
    let artifacts = object(required(replay, "refit_artifacts")?, "refit_artifacts")?;
    closed(
        artifacts,
        &["graph", "execution_bundle", "refit_outcome"],
        "refit_artifacts",
    )?;
    let inventory = inventory_meta(root, physical_members)?;
    validate_ref(
        required(replay, "portable_refit_package")?,
        &inventory,
        (PACKAGE_SCHEMA, 3, true, "dagml_tcv1"),
        PACKAGE,
    )?;
    validate_ref(
        required(artifacts, "graph")?,
        &inventory,
        (GRAPH_SCHEMA, 1, false, "dagml_historical_serde_json_v1"),
        GRAPH,
    )?;
    validate_ref(
        required(artifacts, "execution_bundle")?,
        &inventory,
        (BUNDLE_SCHEMA, 3, true, "dagml_tcv1"),
        BUNDLE,
    )?;
    validate_ref(
        required(artifacts, "refit_outcome")?,
        &inventory,
        (OUTCOME_SCHEMA, 3, true, "dagml_tcv1"),
        OUTCOME,
    )?;
    let mut declared = BTreeSet::from([
        PACKAGE.to_owned(),
        GRAPH.to_owned(),
        BUNDLE.to_owned(),
        OUTCOME.to_owned(),
    ]);
    let mut artifact_ids = BTreeSet::new();
    for reference in methods
        .get("n4mm")
        .and_then(Value::as_array)
        .ok_or_else(|| fmt_err("n4mm must be an array"))?
    {
        let reference = object(reference, "N4MM reference")?;
        closed(
            reference,
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
            ],
            "N4MM reference",
        )?;
        let artifact_id = required_str(reference, "artifact_id")?;
        let path = required_str(reference, "member_path")?;
        if !is_id(artifact_id)
            || !artifact_ids.insert(artifact_id.to_owned())
            || !n4mm_path_ok(path)
            || !declared.insert(path.to_owned())
            || reference.get("kind").and_then(Value::as_str) != Some("N4MM")
            || reference.get("owner").and_then(Value::as_str) != Some("nirs4all-methods")
            || reference.get("format_version").and_then(Value::as_u64) != Some(1)
            || reference.get("abi_major").and_then(Value::as_u64) != Some(2)
            || reference.get("semantic_profile").and_then(Value::as_str) != Some("n4mm_raw_sha256")
            || reference.get("semantic_fingerprint") != reference.get("raw_sha256")
        {
            return refuse("Archive V3 N4MM reference is not exact ABI-2 raw data");
        }
        let meta = inventory
            .get(path)
            .ok_or_else(|| fmt_err("N4MM member is absent from inventory"))?;
        if reference.get("raw_sha256").and_then(Value::as_str) != Some(meta.0.as_str())
            || reference
                .get("semantic_fingerprint")
                .and_then(Value::as_str)
                != Some(meta.1.as_str())
            || meta.2 != "n4mm_raw_sha256"
        {
            return refuse("Archive V3 N4MM does not bind its inventory member");
        }
    }
    if declared.len() != inventory.len()
        || declared.iter().any(|path| !inventory.contains_key(path))
    {
        return refuse("Archive V3 member inventory is not closed over declared members");
    }
    Ok(())
}

fn derive_inventory(
    manifest: &mut Value,
    members: &BTreeMap<String, Vec<u8>>,
) -> Result<(), ArchiveStoreError> {
    let root = object_mut(manifest, "manifest")?;
    for item in required_mut(root, "member_inventory")?
        .as_array_mut()
        .ok_or_else(|| fmt_err("member_inventory must be an array"))?
    {
        let item = object_mut(item, "member inventory")?;
        let path = required_str(item, "path")?.to_owned();
        let bytes = members
            .get(&path)
            .ok_or_else(|| fmt_err("inventory path is absent from payloads"))?;
        item.insert("raw_sha256".into(), Value::String(sha256(bytes)));
        item.insert("uncompressed_size_bytes".into(), Value::from(bytes.len()));
        if path.ends_with(".n4mm") {
            item.insert("semantic_fingerprint".into(), Value::String(sha256(bytes)));
            item.insert(
                "semantic_profile".into(),
                Value::String("n4mm_raw_sha256".into()),
            );
        }
    }
    let sync =
        |value: &mut Value, members: &BTreeMap<String, Vec<u8>>| -> Result<(), ArchiveStoreError> {
            let reference = object_mut(value, "member reference")?;
            let path = required_str(reference, "member_path")?.to_owned();
            let bytes = members
                .get(&path)
                .ok_or_else(|| fmt_err("reference path is absent from payloads"))?;
            reference.insert("raw_sha256".into(), Value::String(sha256(bytes)));
            if path.ends_with(".n4mm") {
                reference.insert("semantic_fingerprint".into(), Value::String(sha256(bytes)));
                reference.insert(
                    "semantic_profile".into(),
                    Value::String("n4mm_raw_sha256".into()),
                );
            }
            Ok(())
        };
    let replay = object_mut(required_mut(root, "replay")?, "replay")?;
    sync(required_mut(replay, "portable_refit_package")?, members)?;
    let artifacts = object_mut(required_mut(replay, "refit_artifacts")?, "refit_artifacts")?;
    for key in ["graph", "execution_bundle", "refit_outcome"] {
        sync(required_mut(artifacts, key)?, members)?;
    }
    let methods = object_mut(
        required_mut(
            object_mut(required_mut(root, "payloads")?, "payloads")?,
            "methods",
        )?,
        "methods",
    )?;
    for reference in required_mut(methods, "n4mm")?
        .as_array_mut()
        .ok_or_else(|| fmt_err("n4mm must be an array"))?
    {
        sync(reference, members)?;
    }
    Ok(())
}

fn validate_raw_closure(
    manifest: &Value,
    members: &BTreeMap<String, Vec<u8>>,
) -> Result<(), ArchiveStoreError> {
    let root = object(manifest, "manifest")?;
    let physical = members
        .iter()
        .map(|(path, bytes)| (path.clone(), bytes.len()))
        .collect::<BTreeMap<_, _>>();
    let inventory = inventory_meta(root, &physical)?;
    for (path, (raw, _, _)) in inventory {
        let bytes = members
            .get(&path)
            .ok_or_else(|| fmt_err("inventory path is absent after payload load"))?;
        if raw != sha256(bytes) {
            return Err(ArchiveStoreError::Integrity(format!(
                "V3 inventory hash mismatch for `{path}`"
            )));
        }
    }
    Ok(())
}

fn inventory_meta(
    root: &Map<String, Value>,
    physical_members: &BTreeMap<String, usize>,
) -> Result<InventoryMeta, ArchiveStoreError> {
    let entries = required(root, "member_inventory")?
        .as_array()
        .ok_or_else(|| fmt_err("member_inventory must be an array"))?;
    if entries.len() != physical_members.len()
        || entries.len() < 5
        || entries.len() + 1 > MAX_ENTRIES
    {
        return refuse("Archive V3 inventory cardinality is not exact");
    }
    let mut inventory = BTreeMap::new();
    for entry in entries {
        let entry = object(entry, "member inventory")?;
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
            "member inventory",
        )?;
        let path = required_str(entry, "path")?;
        path_ok(path)?;
        let raw = required_str(entry, "raw_sha256")?;
        let semantic = required_str(entry, "semantic_fingerprint")?;
        let profile = required_str(entry, "semantic_profile")?;
        if entry.get("regular_file") != Some(&Value::Bool(true))
            || !sha256_text(raw)
            || !sha256_text(semantic)
            || !matches!(
                profile,
                "dagml_tcv1" | "dagml_historical_serde_json_v1" | "n4mm_raw_sha256"
            )
            || entry.get("uncompressed_size_bytes").and_then(Value::as_u64)
                != physical_members.get(path).map(|size| *size as u64)
            || inventory
                .insert(
                    path.to_owned(),
                    (raw.to_owned(), semantic.to_owned(), profile.to_owned()),
                )
                .is_some()
        {
            return refuse("Archive V3 inventory member is malformed or not physical");
        }
    }
    Ok(inventory)
}

fn validate_ref(
    value: &Value,
    inventory: &InventoryMeta,
    expected: (&str, u64, bool, &str),
    fixed_path: &str,
) -> Result<(), ArchiveStoreError> {
    let (schema, version, required_port, semantic_profile) = expected;
    let reference = object(value, "DAG-ML reference")?;
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
    closed(reference, keys, "DAG-ML reference")?;
    let path = required_str(reference, "member_path")?;
    if path != fixed_path
        || reference.get("owner").and_then(Value::as_str) != Some("dag-ml")
        || reference.get("schema_id").and_then(Value::as_str) != Some(schema)
        || reference.get("schema_version").and_then(Value::as_u64) != Some(version)
        || (required_port && reference.get("producer_port_required") != Some(&Value::Bool(true)))
        || reference.get("semantic_profile").and_then(Value::as_str) != Some(semantic_profile)
    {
        return refuse("Archive V3 reference uses the wrong schema family or producer contract");
    }
    let (raw, semantic, profile) = inventory
        .get(path)
        .ok_or_else(|| fmt_err("DAG-ML reference is missing from inventory"))?;
    if reference.get("raw_sha256").and_then(Value::as_str) != Some(raw.as_str())
        || reference
            .get("semantic_fingerprint")
            .and_then(Value::as_str)
            != Some(semantic.as_str())
        || profile != semantic_profile
    {
        return refuse("Archive V3 reference does not exactly bind inventory metadata");
    }
    Ok(())
}

fn validate_writer(value: &Map<String, Value>) -> Result<(), ArchiveStoreError> {
    closed(
        value,
        &["product_aggregate_owner", "canonical_writer_id"],
        "writer",
    )?;
    if value.get("product_aggregate_owner").and_then(Value::as_str) != Some("nirs4all-core")
        || value.get("canonical_writer_id").and_then(Value::as_str) != Some(WRITER_ID)
    {
        return refuse("writer identity is not Archive V3");
    }
    Ok(())
}

fn validate_dispatch(value: &Map<String, Value>) -> Result<(), ArchiveStoreError> {
    closed(
        value,
        &["archive_v3", "archive_v2", "archive_v1"],
        "reader_dispatch",
    )?;
    let current = object(required(value, "archive_v3")?, "archive_v3 dispatch")?;
    closed(
        current,
        &[
            "accepted_versions",
            "future_versions",
            "dispatch_before_extraction",
        ],
        "archive_v3 dispatch",
    )?;
    if current.get("accepted_versions") != Some(&serde_json::json!([3]))
        || current.get("future_versions").and_then(Value::as_str) != Some("refuse")
        || current.get("dispatch_before_extraction") != Some(&Value::Bool(true))
    {
        return refuse("Archive V3 current dispatch is not exact");
    }
    for (key, version) in [("archive_v2", 2u64), ("archive_v1", 1u64)] {
        let previous = object(required(value, key)?, key)?;
        closed(
            previous,
            &["accepted_versions", "read_mode", "mutation"],
            key,
        )?;
        if previous.get("accepted_versions") != Some(&serde_json::json!([version]))
            || previous.get("read_mode").and_then(Value::as_str) != Some("immutable_dual_read")
            || previous.get("mutation").and_then(Value::as_str) != Some("never_in_place")
        {
            return refuse("Archive V3 historical dispatch is not immutable dual-read");
        }
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
        "physical profile",
    )?;
    if value.get("container").and_then(Value::as_str) != Some("zip")
        || value.get("manifest_member").and_then(Value::as_str) != Some(MANIFEST)
        || value.get("regular_files_only") != Some(&Value::Bool(true))
    {
        return refuse("Archive V3 physical profile is not exact");
    }
    let limits = object(required(value, "limits")?, "physical limits")?;
    closed(
        limits,
        &[
            "max_entries",
            "max_total_uncompressed_bytes",
            "max_member_uncompressed_bytes",
            "max_compression_ratio",
        ],
        "physical limits",
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
        return refuse("Archive V3 physical limits are not exact");
    }
    Ok(())
}

fn object<'a>(value: &'a Value, label: &str) -> Result<&'a Map<String, Value>, ArchiveStoreError> {
    value
        .as_object()
        .ok_or_else(|| fmt_err(&format!("{label} must be an object")))
}
fn object_mut<'a>(
    value: &'a mut Value,
    label: &str,
) -> Result<&'a mut Map<String, Value>, ArchiveStoreError> {
    value
        .as_object_mut()
        .ok_or_else(|| fmt_err(&format!("{label} must be an object")))
}
fn required<'a>(object: &'a Map<String, Value>, key: &str) -> Result<&'a Value, ArchiveStoreError> {
    object
        .get(key)
        .ok_or_else(|| fmt_err(&format!("missing required `{key}`")))
}
fn required_mut<'a>(
    object: &'a mut Map<String, Value>,
    key: &str,
) -> Result<&'a mut Value, ArchiveStoreError> {
    object
        .get_mut(key)
        .ok_or_else(|| fmt_err(&format!("missing required `{key}`")))
}
fn required_str<'a>(
    object: &'a Map<String, Value>,
    key: &str,
) -> Result<&'a str, ArchiveStoreError> {
    required(object, key)?
        .as_str()
        .ok_or_else(|| fmt_err(&format!("`{key}` must be a string")))
}
fn closed(
    object: &Map<String, Value>,
    keys: &[&str],
    label: &str,
) -> Result<(), ArchiveStoreError> {
    if object.keys().any(|key| !keys.contains(&key.as_str()))
        || keys.iter().any(|key| !object.contains_key(*key))
    {
        return refuse(&format!("{label} is not a closed exact object"));
    }
    Ok(())
}
fn id_ok(value: &str, label: &str) -> Result<(), ArchiveStoreError> {
    if is_id(value) {
        Ok(())
    } else {
        refuse(&format!("{label} is not a portable identifier"))
    }
}
fn is_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'.' | b':' | b'-'))
}
fn n4mm_path_ok(path: &str) -> bool {
    path.starts_with("methods/")
        && path.ends_with(".n4mm")
        && path.len() <= 512
        && !path.contains('\\')
        && path
            .split('/')
            .all(|part| !part.is_empty() && part != "." && part != "..")
}
fn path_ok(path: &str) -> Result<(), ArchiveStoreError> {
    if path.is_empty()
        || path.len() > 512
        || path.contains('\\')
        || path
            .split('/')
            .any(|part| part.is_empty() || part == "." || part == "..")
    {
        return refuse("archive member path is unsafe");
    }
    Ok(())
}
fn sha256(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn sha256_text(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
}
fn refuse<T>(detail: &str) -> Result<T, ArchiveStoreError> {
    Err(ArchiveStoreError::Format(detail.to_owned()))
}
fn fmt_err(detail: &str) -> ArchiveStoreError {
    ArchiveStoreError::Format(detail.to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        load_archive, replay_methods_archive_v3, LoadedArchive, MethodsArchiveRefitRequestV3,
    };
    use dag_ml_core::{Phase, RunId, RuntimeControllerRegistry, TrainingReplayRequest};
    use std::collections::BTreeMap;
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn path(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "n4a-v3-{name}-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("clock after Unix epoch")
                .as_nanos()
        ))
    }

    fn request() -> ArchiveV3WriteRequest {
        let paths = [PACKAGE, GRAPH, BUNDLE, OUTCOME, "methods/model.n4mm"];
        let payloads = paths
            .iter()
            .map(|path| ArchivePayload {
                path: (*path).to_owned(),
                bytes: format!("opaque:{path}").into_bytes(),
            })
            .collect::<Vec<_>>();
        let ref_value = |path: &str, schema: &str, version: u64, port: bool, profile: &str| {
            let mut value = serde_json::json!({
                "owner": "dag-ml", "schema_id": schema, "schema_version": version,
                "member_path": path, "raw_sha256": "0".repeat(64),
                "semantic_fingerprint": "a".repeat(64), "semantic_profile": profile
            });
            if port {
                value["producer_port_required"] = Value::Bool(true);
            }
            value
        };
        let n4mm_raw = sha256(&payloads[4].bytes);
        let inventory = paths
            .iter()
            .enumerate()
            .map(|(index, path)| {
                let (profile, semantic) = if index == 4 {
                    ("n4mm_raw_sha256", n4mm_raw.clone())
                } else if *path == GRAPH {
                    ("dagml_historical_serde_json_v1", "a".repeat(64))
                } else {
                    ("dagml_tcv1", "a".repeat(64))
                };
                serde_json::json!({
                    "path": path, "regular_file": true, "raw_sha256": "0".repeat(64),
                    "uncompressed_size_bytes": 0, "semantic_fingerprint": semantic,
                    "semantic_profile": profile
                })
            })
            .collect::<Vec<_>>();
        let manifest = serde_json::json!({
            "schema_version": 3, "profile": PROFILE, "archive_id": "archive:v3-test",
            "persistence_kind": "n4a_archive",
            "writer": {"product_aggregate_owner": "nirs4all-core", "canonical_writer_id": WRITER_ID},
            "reader_dispatch": {
                "archive_v3": {"accepted_versions": [3], "future_versions": "refuse", "dispatch_before_extraction": true},
                "archive_v2": {"accepted_versions": [2], "read_mode": "immutable_dual_read", "mutation": "never_in_place"},
                "archive_v1": {"accepted_versions": [1], "read_mode": "immutable_dual_read", "mutation": "never_in_place"}
            },
            "physical_profile": {"container": "zip", "manifest_member": "manifest.json", "regular_files_only": true, "limits": {"max_entries": 256, "max_total_uncompressed_bytes": 536870912_u64, "max_member_uncompressed_bytes": 134217728_u64, "max_compression_ratio": 100}},
            "replay": {
                "portable_refit_package": ref_value(PACKAGE, PACKAGE_SCHEMA, 3, true, "dagml_tcv1"),
                "refit_artifacts": {
                    "graph": ref_value(GRAPH, GRAPH_SCHEMA, 1, false, "dagml_historical_serde_json_v1"),
                    "execution_bundle": ref_value(BUNDLE, BUNDLE_SCHEMA, 3, true, "dagml_tcv1"),
                    "refit_outcome": ref_value(OUTCOME, OUTCOME_SCHEMA, 3, true, "dagml_tcv1")
                }, "future_artifacts": []
            },
            "payloads": {"methods": {"n4mm": [{
                "artifact_id": "artifact:model:refit", "kind": "N4MM", "owner": "nirs4all-methods",
                "format_version": 1, "abi_major": 2, "member_path": "methods/model.n4mm",
                "raw_sha256": "0".repeat(64), "semantic_fingerprint": n4mm_raw,
                "semantic_profile": "n4mm_raw_sha256"
            }], "n4mopt": []}, "n4d_aggregate_reference": null, "conformal": null, "robustness": null, "host_artifacts": []},
            "member_inventory": inventory, "migration_provenance": null,
            "security": {"integrity_profile": "sha256_raw_member_inventory_v3", "signature": null}, "workspace": null
        });
        ArchiveV3WriteRequest { manifest, payloads }
    }

    #[test]
    fn v3_round_trips_opaque_refit_package_and_dispatches() {
        let archive = path("roundtrip.n4a");
        let request = request();
        let expected = request.payloads[0].bytes.clone();
        let reference = write_archive_v3(&archive, request).expect("write V3");
        let loaded = load_archive_v3(&archive).expect("load V3");
        assert_eq!(loaded.reference(), &reference);
        assert_eq!(
            loaded.portable_refit_package().expect("package bytes"),
            expected
        );
        assert!(matches!(
            load_archive(&archive).expect("generic V3"),
            LoadedArchive::V3(_)
        ));
        let _ = fs::remove_file(archive);
    }

    #[test]
    fn v3_storage_fixture_is_semantically_refused_before_methods_runtime() {
        let archive_path = path("dagml-semantic-boundary");
        write_archive_v3(&archive_path, request()).expect("write storage fixture");
        let archive = load_archive_v3(&archive_path).expect("load storage fixture");
        let replay = TrainingReplayRequest {
            schema_version: 0,
            request_id: "request:v3-storage-fixture".to_owned(),
            source_outcome_fingerprint: "0".repeat(64),
            phase: Phase::Predict,
            data_envelope_keys: Vec::new(),
            output_binding_ids: Vec::new(),
            request_fingerprint: String::new(),
        };
        let error = replay_methods_archive_v3(
            &archive,
            MethodsArchiveRefitRequestV3 {
                request: replay,
                data_envelopes: BTreeMap::new(),
                methods_inputs: BTreeMap::new(),
                methods_library_path: PathBuf::from("/must-not-open-libn4m"),
                supplemental_controllers: RuntimeControllerRegistry::new(),
                outcome_id: "outcome:v3-storage-fixture".to_owned(),
                run_id: RunId::new("run:v3-storage-fixture").expect("valid run id"),
                warnings: Vec::new(),
                diagnostics: BTreeMap::new(),
            },
        )
        .expect_err("opaque storage fixture cannot be a DAG-ML Package V3");
        let message = error.to_string();
        assert!(message.starts_with("DAG-ML rejected Core Archive V3 package:"));
        assert!(!message.contains("cannot configure the Methods runtime"));
        let _ = fs::remove_file(archive_path);
    }

    #[test]
    fn v3_refuses_mixed_family_and_host_before_write() {
        let archive = path("mixed.n4a");
        let mut mixed = request();
        mixed.manifest["replay"]["portable_refit_package"]["schema_version"] = Value::from(2);
        assert!(matches!(
            write_archive_v3(&archive, mixed),
            Err(ArchiveStoreError::Format(_))
        ));
        let mut host = request();
        host.manifest["payloads"]["host_artifacts"] = serde_json::json!([{"kind":"pickle"}]);
        assert!(matches!(
            write_archive_v3(&archive, host),
            Err(ArchiveStoreError::Format(_))
        ));
    }

    #[test]
    fn v3_refuses_tampered_opaque_member() {
        let archive = path("tamper.n4a");
        write_archive_v3(&archive, request()).expect("write V3");
        let mut bytes = fs::read(&archive).expect("archive bytes");
        let offset = bytes
            .windows(b"opaque".len())
            .position(|window| window == b"opaque")
            .expect("opaque payload");
        bytes[offset] ^= 1;
        fs::write(&archive, bytes).expect("tamper archive");
        assert!(matches!(
            load_archive_v3(&archive),
            Err(ArchiveStoreError::Integrity(_))
        ));
        let _ = fs::remove_file(archive);
    }
}
