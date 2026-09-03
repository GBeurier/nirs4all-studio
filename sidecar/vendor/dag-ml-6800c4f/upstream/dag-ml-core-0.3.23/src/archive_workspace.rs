//! Archive V2 replay-member assembly owned by DAG-ML.
//!
//! This module deliberately does not write ZIPs or read archives.  It turns a
//! fully validated native training result into the exact DAG-ML document bytes
//! and manifest references required by ADR-23; `nirs4all-core` remains the
//! sole owner of bounded archive storage and inventory validation.

use std::collections::BTreeMap;

use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use crate::bundle::{
    BundlePredictionCachePayloadSet, ExecutionBundle, PREDICTION_CACHE_PAYLOAD_SCHEMA_VERSION,
};
use crate::canonical::parse_typed_json;
use crate::error::{DagMlError, Result};
use crate::graph::GraphSpec;
use crate::runtime::ArtifactBackend;
use crate::training::{ArtifactLoadMode, FittedArtifactMode, PortablePredictorPackage};
use crate::training_runtime::{PortableRefitPackageV3, TrainingOutcome};

pub const ARCHIVE_V2_PACKAGE_MEMBER: &str = "dagml/portable_predictor_package.json";
pub const ARCHIVE_V2_GRAPH_MEMBER: &str = "dagml/graph.json";
pub const ARCHIVE_V2_BUNDLE_MEMBER: &str = "dagml/execution_bundle.json";
pub const ARCHIVE_V2_OUTCOME_MEMBER: &str = "dagml/training_outcome.json";
pub const ARCHIVE_V2_CACHE_MEMBER: &str = "dagml/prediction_cache_payload_set.json";
pub const ARCHIVE_V2_SCORE_MEMBER: &str = "dagml/score_set.json";

/// Archive V3 keeps the V2 predictor family immutable and carries a distinct,
/// target-bound full-refit child package defined by ADR-25.
pub const ARCHIVE_V3_PACKAGE_MEMBER: &str = "dagml/portable_refit_package.json";
pub const ARCHIVE_V3_GRAPH_MEMBER: &str = "dagml/graph.json";
pub const ARCHIVE_V3_BUNDLE_MEMBER: &str = "dagml/portable_refit_execution_bundle.json";
pub const ARCHIVE_V3_OUTCOME_MEMBER: &str = "dagml/portable_refit_outcome.json";

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
const REFIT_PACKAGE_V3_SCHEMA: &str =
    "https://github.com/GBeurier/dag-ml/schemas/portable_refit_package.v3.schema.json";
const REFIT_BUNDLE_V3_SCHEMA: &str =
    "https://github.com/GBeurier/dag-ml/schemas/portable_refit_execution_bundle.v3.schema.json";
const REFIT_OUTCOME_V3_SCHEMA: &str =
    "https://github.com/GBeurier/dag-ml/schemas/portable_refit_outcome.v3.schema.json";

/// Exact bytes and manifest handed to the Core Archive V2 writer.
#[derive(Clone, Debug, PartialEq)]
pub struct ArchiveV2ReplayPayloads {
    pub manifest: Value,
    pub members: BTreeMap<String, Vec<u8>>,
}

/// Exact bytes and manifest handed to the future Core Archive V3 writer.
///
/// This is intentionally a separate family from [`ArchiveV2ReplayPayloads`]:
/// V3 contains a new target-bound refit outcome and can never be fed to a V2
/// reader as a predictor package.
#[derive(Clone, Debug, PartialEq)]
pub struct ArchiveV3RefitPayloads {
    pub manifest: Value,
    pub members: BTreeMap<String, Vec<u8>>,
}

/// Assemble the strict ADR-25 full-refit closure for an Archive V3 writer.
///
/// DAG-ML owns the semantic member set and all exact cross-links.  Core owns
/// ZIP persistence, bounded reads and container integrity only; it must not
/// reinterpret the refit plan or native artifact bytes.  The V3 package still
/// owns its detached raw map, while the archive additionally exposes each raw
/// N4MM as an independently inventory-bound member for fresh-process hydration.
pub fn build_archive_v3_native_refit_payloads(
    archive_id: impl Into<String>,
    package: &PortableRefitPackageV3,
) -> Result<ArchiveV3RefitPayloads> {
    package.validate()?;
    let archive_id = archive_id.into();
    if archive_id.is_empty()
        || archive_id.len() > 128
        || !archive_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'.' | b':' | b'-'))
    {
        return refuse("archive V3 archive_id is not a portable identifier");
    }
    if package.schema_version != 3 || package.outcome.schema_version != 3 {
        return refuse("Archive V3 requires an exact PortableRefitPackage and outcome V3");
    }

    let outcome = &package.outcome;
    let bundle = &outcome.execution_bundle;
    let mut members = BTreeMap::new();
    insert_json(&mut members, ARCHIVE_V3_PACKAGE_MEMBER, package)?;
    insert_json(
        &mut members,
        ARCHIVE_V3_GRAPH_MEMBER,
        &outcome.effective_plan.graph_plan.graph,
    )?;
    insert_json(&mut members, ARCHIVE_V3_BUNDLE_MEMBER, bundle)?;
    insert_json(&mut members, ARCHIVE_V3_OUTCOME_MEMBER, outcome)?;

    let mut n4mm = Vec::new();
    for record in &bundle.refit_artifacts {
        let artifact = &record.artifact;
        if artifact.kind != "n4m_model"
            || artifact.backend != Some(ArtifactBackend::Raw)
            || artifact.plugin.is_some()
            || artifact.plugin_version.is_some()
        {
            return refuse("Archive V3 accepts only raw plugin-free n4m_model refit artifacts");
        }
        let path = artifact.uri.as_deref().ok_or_else(|| {
            DagMlError::RuntimeValidation(
                "Archive V3 N4MM artifact has no archive member URI".to_string(),
            )
        })?;
        if !safe_n4mm_path(path) {
            return refuse("Archive V3 N4MM URI must be a safe methods/*.n4mm path");
        }
        let bytes = bundle
            .raw_artifact_payloads
            .get(&artifact.id)
            .ok_or_else(|| {
                DagMlError::RuntimeValidation(format!(
                    "Archive V3 lacks raw N4MM payload `{}`",
                    artifact.id
                ))
            })?
            .clone();
        let raw = sha256(&bytes);
        if artifact.size_bytes != Some(bytes.len() as u64)
            || artifact.content_fingerprint.as_deref() != Some(raw.as_str())
        {
            return refuse("Archive V3 N4MM descriptor does not match its raw payload");
        }
        if members.insert(path.to_owned(), bytes).is_some() {
            return refuse("Archive V3 N4MM paths must be unique");
        }
        let (abi_major, abi_min_minor) = crate::hpo::methods_n4mm_abi_requirement(artifact)?;
        let format_version = artifact
            .native_predictor_descriptor
            .as_ref()
            .map(|descriptor| descriptor.format_version)
            .unwrap_or(1);
        if format_version == 2
            && artifact
                .native_predictor_descriptor
                .as_ref()
                .and_then(|descriptor| descriptor.pipeline.as_ref())
                .is_none()
        {
            return refuse("Archive V3 N4MM format 2 requires an embedded pipeline descriptor");
        }
        n4mm.push(json!({
            "artifact_id": artifact.id,
            "kind": "N4MM",
            "owner": "nirs4all-methods",
            "format_version": format_version,
            "abi_major": abi_major,
            "abi_min_minor": abi_min_minor,
            "member_path": path,
            "raw_sha256": raw,
            "semantic_fingerprint": raw,
            "semantic_profile": "n4mm_raw_sha256"
        }));
    }
    if n4mm.is_empty()
        || bundle.raw_artifact_payloads.len() != n4mm.len()
        || bundle.refit_artifacts.len() != n4mm.len()
    {
        return refuse("Archive V3 N4MM members must exactly cover all refit artifacts");
    }

    let mut manifest = json!({
        "schema_version": 3,
        "profile": "nirs4all.archive_workspace.v3",
        "archive_id": archive_id,
        "persistence_kind": "n4a_archive",
        "writer": {"product_aggregate_owner": "nirs4all-core", "canonical_writer_id": "nirs4all-core.archive_workspace_writer.v3"},
        "reader_dispatch": {
            "archive_v3": {"accepted_versions": [3], "future_versions": "refuse", "dispatch_before_extraction": true},
            "archive_v2": {"accepted_versions": [2], "read_mode": "immutable_dual_read", "mutation": "never_in_place"},
            "archive_v1": {"accepted_versions": [1], "read_mode": "immutable_dual_read", "mutation": "never_in_place"}
        },
        "physical_profile": {"container": "zip", "manifest_member": "manifest.json", "regular_files_only": true, "limits": {"max_entries": 256, "max_total_uncompressed_bytes": 536870912_u64, "max_member_uncompressed_bytes": 134217728_u64, "max_compression_ratio": 100}},
        "replay": {
            "portable_refit_package": dag_ref(ARCHIVE_V3_PACKAGE_MEMBER, REFIT_PACKAGE_V3_SCHEMA, 3, true, "dagml_tcv1", package.package_fingerprint.clone()),
            "refit_artifacts": {
                "graph": dag_ref(ARCHIVE_V3_GRAPH_MEMBER, GRAPH_SCHEMA, 1, false, "dagml_historical_serde_json_v1", historical_fingerprint(members.get(ARCHIVE_V3_GRAPH_MEMBER).expect("inserted graph"))),
                "execution_bundle": dag_ref(ARCHIVE_V3_BUNDLE_MEMBER, REFIT_BUNDLE_V3_SCHEMA, 3, true, "dagml_tcv1", bundle.bundle_fingerprint.clone()),
                "refit_outcome": dag_ref(ARCHIVE_V3_OUTCOME_MEMBER, REFIT_OUTCOME_V3_SCHEMA, 3, true, "dagml_tcv1", outcome.outcome_fingerprint.clone())
            },
            "future_artifacts": []
        },
        "payloads": {"methods": {"n4mm": n4mm, "n4mopt": []}, "n4d_aggregate_reference": null, "conformal": null, "robustness": null, "host_artifacts": []},
        "member_inventory": [],
        "migration_provenance": null,
        "security": {"integrity_profile": "sha256_raw_member_inventory_v3", "signature": null},
        "workspace": null
    });
    let inventory = members
        .iter()
        .map(|(path, bytes)| {
            let (semantic_profile, semantic_fingerprint) = if path == ARCHIVE_V3_PACKAGE_MEMBER {
                ("dagml_tcv1", package.package_fingerprint.clone())
            } else if path.ends_with(".n4mm") {
                ("n4mm_raw_sha256", sha256(bytes))
            } else if path == ARCHIVE_V3_BUNDLE_MEMBER {
                ("dagml_tcv1", bundle.bundle_fingerprint.clone())
            } else if path == ARCHIVE_V3_OUTCOME_MEMBER {
                ("dagml_tcv1", outcome.outcome_fingerprint.clone())
            } else {
                ("dagml_historical_serde_json_v1", historical_fingerprint(bytes))
            };
            json!({"path": path, "regular_file": true, "raw_sha256": sha256(bytes), "uncompressed_size_bytes": bytes.len(), "semantic_fingerprint": semantic_fingerprint, "semantic_profile": semantic_profile})
        })
        .collect::<Vec<_>>();
    manifest["member_inventory"] = Value::Array(inventory);
    bind_raw_hashes(&mut manifest, &members);
    Ok(ArchiveV3RefitPayloads { manifest, members })
}

/// Assemble the strict ADR-23 P0 replay closure from real DAG-ML contracts.
///
/// This fails closed instead of creating score placeholders, changing an
/// artifact URI, or inventing nonempty OOF cache evidence.  A strictly empty
/// archive-only V2 cache payload set is permitted only when the cross-linked
/// bundle and graph prove there is no OOF cache dependency.  In particular,
/// portable packages that are valid for a host-sidecar deployment are
/// intentionally not Archive V2 P0 candidates.
pub fn build_archive_v2_native_portable_payloads(
    archive_id: impl Into<String>,
    outcome: &TrainingOutcome,
    package: &PortablePredictorPackage,
) -> Result<ArchiveV2ReplayPayloads> {
    outcome.validate()?;
    package.validate()?;
    let archive_id = archive_id.into();
    if archive_id.is_empty()
        || archive_id.len() > 128
        || !archive_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'.' | b':' | b'-'))
    {
        return refuse("archive V2 archive_id is not a portable identifier");
    }
    if package.schema_version != 2 || outcome.schema_version != 2 {
        return refuse("Archive V2 requires Package and TrainingOutcome schema V2");
    }
    if package.fitted_artifact_mode != FittedArtifactMode::PortableRequired
        || package
            .artifact_bindings
            .iter()
            .any(|binding| binding.load_mode != ArtifactLoadMode::NativePortable)
    {
        return refuse("Archive V2 P0 refuses host-sidecar package artifacts");
    }
    if package.training_outcome != outcome.to_reference()?
        || package.execution_bundle != outcome.execution_bundle
        || package.effective_plan != outcome.effective_plan
        || package.template.graph != outcome.effective_plan.graph_plan.graph
    {
        return refuse("Archive V2 package does not exactly cross-link its TrainingOutcome");
    }
    // A strict terminal PREDICT keeps mandatory internal CV OOF scoring but
    // deliberately discards external cache payloads. Archive V2 still has a
    // closed cache-member slot, so represent that *proven absence* with the
    // existing empty V2 payload-set shape. This is archive-only:
    // outcome/package bytes and fingerprints remain untouched, and no
    // nonempty OOF evidence is invented.
    let synthesized_empty_caches = if outcome.portable_prediction_caches.is_none() {
        Some(synthesize_empty_archive_cache_payloads(
            &outcome.execution_bundle,
            &outcome.effective_plan.graph_plan.graph,
        )?)
    } else {
        None
    };
    let caches = outcome
        .portable_prediction_caches
        .as_ref()
        .or(synthesized_empty_caches.as_ref())
        .expect("an existing or synthesized cache payload set is present");
    caches.validate_against_bundle(&outcome.execution_bundle)?;
    if caches.schema_version != 2 || outcome.score_set.schema_version != 2 {
        return refuse("Archive V2 requires V2 prediction-cache and score-set companions");
    }

    let mut members = BTreeMap::new();
    insert_json(&mut members, ARCHIVE_V2_PACKAGE_MEMBER, package)?;
    insert_json(
        &mut members,
        ARCHIVE_V2_GRAPH_MEMBER,
        &package.template.graph,
    )?;
    insert_json(
        &mut members,
        ARCHIVE_V2_BUNDLE_MEMBER,
        &package.execution_bundle,
    )?;
    insert_json(&mut members, ARCHIVE_V2_OUTCOME_MEMBER, outcome)?;
    insert_json(&mut members, ARCHIVE_V2_CACHE_MEMBER, caches)?;
    insert_json(&mut members, ARCHIVE_V2_SCORE_MEMBER, &outcome.score_set)?;

    let mut n4mm = Vec::new();
    for record in &package.execution_bundle.refit_artifacts {
        let artifact = &record.artifact;
        if artifact.kind != "n4m_model"
            || artifact.backend != Some(ArtifactBackend::Raw)
            || artifact.plugin.is_some()
            || artifact.plugin_version.is_some()
        {
            return refuse("Archive V2 P0 accepts only raw plugin-free n4m_model refit artifacts");
        }
        let path = artifact.uri.as_deref().ok_or_else(|| {
            DagMlError::RuntimeValidation(
                "Archive V2 P0 N4MM artifact has no archive member URI".to_string(),
            )
        })?;
        if !safe_n4mm_path(path) {
            return refuse("Archive V2 P0 N4MM URI must be a safe methods/*.n4mm path");
        }
        let bytes = package
            .execution_bundle
            .raw_artifact_payloads
            .get(&artifact.id)
            .ok_or_else(|| {
                DagMlError::RuntimeValidation(format!(
                    "Archive V2 P0 lacks raw N4MM payload `{}`",
                    artifact.id
                ))
            })?
            .clone();
        if artifact.size_bytes != Some(bytes.len() as u64) {
            return refuse("Archive V2 P0 N4MM size does not match raw payload");
        }
        let raw = sha256(&bytes);
        if artifact.content_fingerprint.as_deref() != Some(raw.as_str()) {
            return refuse("Archive V2 P0 N4MM raw SHA-256 does not match artifact fingerprint");
        }
        if members.insert(path.to_owned(), bytes).is_some() {
            return refuse("Archive V2 P0 N4MM paths must be unique");
        }
        let (abi_major, abi_min_minor) = crate::hpo::methods_n4mm_abi_requirement(artifact)?;
        let format_version = artifact
            .native_predictor_descriptor
            .as_ref()
            .map(|descriptor| descriptor.format_version)
            .unwrap_or(1);
        if format_version == 2
            && artifact
                .native_predictor_descriptor
                .as_ref()
                .and_then(|descriptor| descriptor.pipeline.as_ref())
                .is_none()
        {
            return refuse("Archive V2 N4MM format 2 requires an embedded pipeline descriptor");
        }
        n4mm.push(json!({
            "artifact_id": artifact.id,
            "kind": "N4MM",
            "owner": "nirs4all-methods",
            "format_version": format_version,
            "abi_major": abi_major,
            "abi_min_minor": abi_min_minor,
            "member_path": path,
            "raw_sha256": raw,
            "semantic_fingerprint": raw,
            "semantic_profile": "n4mm_raw_sha256"
        }));
    }
    if n4mm.is_empty()
        || package.execution_bundle.raw_artifact_payloads.len() != n4mm.len()
        || package.artifact_bindings.len() != n4mm.len()
    {
        return refuse("Archive V2 P0 N4MM members must exactly cover all package refit artifacts");
    }

    let package_semantic = package.package_fingerprint.clone();
    let mut manifest = json!({
        "schema_version": 2,
        "profile": "nirs4all.archive_workspace.v2",
        "archive_id": archive_id,
        "persistence_kind": "n4a_archive",
        "writer": {"product_aggregate_owner": "nirs4all-core", "canonical_writer_id": "nirs4all-core.archive_workspace_writer.v2"},
        "reader_dispatch": {
            "archive_v2": {"accepted_versions": [2], "future_versions": "refuse", "dispatch_before_extraction": true},
            "archive_v1": {"accepted_versions": [1], "read_mode": "immutable_dual_read", "mutation": "never_in_place"},
            "legacy_n4a": {"form": "historical_n4a_zip", "manifest_member": "manifest.json", "reader_id": "nirs4all.pipeline.bundle.loader.BundleLoader", "maximum_bundle_format_version": "1.0", "migration_direction": "legacy_to_v1_copy_on_write_only"}
        },
        "physical_profile": {"container": "zip", "manifest_member": "manifest.json", "regular_files_only": true, "limits": {"max_entries": 256, "max_total_uncompressed_bytes": 536870912_u64, "max_member_uncompressed_bytes": 134217728_u64, "max_compression_ratio": 100}},
        "replay": {
            "portable_predictor_package": dag_ref(ARCHIVE_V2_PACKAGE_MEMBER, PACKAGE_SCHEMA, 2, true, "dagml_tcv1", package_semantic),
            "training_artifacts": {
                "graph": dag_ref(ARCHIVE_V2_GRAPH_MEMBER, GRAPH_SCHEMA, 1, false, "dagml_historical_serde_json_v1", historical_fingerprint(members.get(ARCHIVE_V2_GRAPH_MEMBER).expect("inserted graph"))),
                "execution_bundle": dag_ref(ARCHIVE_V2_BUNDLE_MEMBER, BUNDLE_SCHEMA, 2, true, "dagml_tcv1", tcv1_bytes(members.get(ARCHIVE_V2_BUNDLE_MEMBER).expect("inserted bundle"))?),
                "training_outcome": dag_ref(ARCHIVE_V2_OUTCOME_MEMBER, OUTCOME_SCHEMA, 2, true, "dagml_tcv1", outcome.outcome_fingerprint.clone()),
                "prediction_cache_payload_set": dag_ref(ARCHIVE_V2_CACHE_MEMBER, CACHE_SCHEMA, 2, true, "dagml_historical_serde_json_v1", historical_fingerprint(members.get(ARCHIVE_V2_CACHE_MEMBER).expect("inserted cache"))),
                "score_set": dag_ref(ARCHIVE_V2_SCORE_MEMBER, SCORE_SCHEMA, 2, true, "dagml_historical_serde_json_v1", historical_fingerprint(members.get(ARCHIVE_V2_SCORE_MEMBER).expect("inserted scores")))
            },
            "future_artifacts": []
        },
        "payloads": {"methods": {"n4mm": n4mm, "n4mopt": []}, "n4d_aggregate_reference": null, "conformal": null, "robustness": null, "host_artifacts": []},
        "member_inventory": [],
        "migration_provenance": null,
        "security": {"integrity_profile": "sha256_raw_member_inventory_v2", "signature": null},
        "workspace": null
    });
    let inventory = members
        .iter()
        .map(|(path, bytes)| {
            let (semantic_profile, semantic_fingerprint) = if path == ARCHIVE_V2_PACKAGE_MEMBER {
                ("dagml_tcv1", package.package_fingerprint.clone())
            } else if path.ends_with(".n4mm") {
                ("n4mm_raw_sha256", sha256(bytes))
            } else if path == ARCHIVE_V2_BUNDLE_MEMBER {
                ("dagml_tcv1", tcv1_bytes(bytes).expect("serialized TCV1 document"))
            } else if path == ARCHIVE_V2_OUTCOME_MEMBER {
                ("dagml_tcv1", outcome.outcome_fingerprint.clone())
            } else {
                ("dagml_historical_serde_json_v1", historical_fingerprint(bytes))
            };
            json!({"path": path, "regular_file": true, "raw_sha256": sha256(bytes), "uncompressed_size_bytes": bytes.len(), "semantic_fingerprint": semantic_fingerprint, "semantic_profile": semantic_profile})
        })
        .collect::<Vec<_>>();
    manifest["member_inventory"] = Value::Array(inventory);
    bind_raw_hashes(&mut manifest, &members);
    Ok(ArchiveV2ReplayPayloads { manifest, members })
}

/// Construct the only archive-only cache payload permitted for an outcome
/// whose durable contract deliberately has no retained OOF payloads.
///
/// These checks deliberately strengthen ordinary outcome validation. The
/// normal cross-link checks validate declared bundle requirements and caches,
/// but do not prove reverse coverage of every `requires_oof` graph edge;
/// archive assembly must reject a re-signed outcome whose bundle arrays were
/// stripped while its graph still contains an OOF dependency.
fn synthesize_empty_archive_cache_payloads(
    bundle: &ExecutionBundle,
    graph: &GraphSpec,
) -> Result<BundlePredictionCachePayloadSet> {
    if !bundle.prediction_requirements.is_empty()
        || !bundle.prediction_caches.is_empty()
        || graph.edges.iter().any(|edge| edge.contract.requires_oof)
    {
        return Err(DagMlError::RuntimeValidation(
            "Archive V2 cannot synthesize an empty prediction-cache payload set when the bundle or graph has an OOF cache dependency"
                .to_string(),
        ));
    }
    Ok(BundlePredictionCachePayloadSet {
        bundle_id: bundle.bundle_id.clone(),
        schema_version: PREDICTION_CACHE_PAYLOAD_SCHEMA_VERSION,
        caches: Vec::new(),
    })
}

fn insert_json<T: serde::Serialize>(
    members: &mut BTreeMap<String, Vec<u8>>,
    path: &str,
    value: &T,
) -> Result<()> {
    members.insert(path.to_owned(), serde_json::to_vec(value)?);
    Ok(())
}

fn dag_ref(
    path: &str,
    schema_id: &str,
    schema_version: u64,
    producer_port_required: bool,
    semantic_profile: &str,
    semantic_fingerprint: String,
) -> Value {
    let mut reference = json!({
        "owner": "dag-ml",
        "schema_id": schema_id,
        "schema_version": schema_version,
        "member_path": path,
        "raw_sha256": "0000000000000000000000000000000000000000000000000000000000000000",
        "semantic_fingerprint": semantic_fingerprint,
        "semantic_profile": semantic_profile
    });
    if producer_port_required {
        reference["producer_port_required"] = Value::Bool(true);
    }
    reference
}

fn tcv1_bytes(bytes: &[u8]) -> Result<String> {
    parse_typed_json(std::str::from_utf8(bytes).map_err(|error| {
        DagMlError::RuntimeValidation(format!("Archive V2 DAG-ML JSON was not UTF-8: {error}"))
    })?)
    .map_err(|error| {
        DagMlError::RuntimeValidation(format!("Archive V2 DAG-ML JSON was not TCV1: {error}"))
    })?
    .fingerprint()
    .map_err(|error| {
        DagMlError::RuntimeValidation(format!("Archive V2 TCV1 fingerprint failed: {error}"))
    })
}

fn historical_fingerprint(bytes: &[u8]) -> String {
    sha256(bytes)
}

fn sha256(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

/// Core recomputes these during its final atomic write.  Binding them here as
/// well keeps the DAG-ML handoff self-consistent for callers that validate the
/// manifest before handing its bytes to Core.
fn bind_raw_hashes(value: &mut Value, members: &BTreeMap<String, Vec<u8>>) {
    match value {
        Value::Object(object) => {
            if let Some(path) = object.get("member_path").and_then(Value::as_str) {
                if let Some(bytes) = members.get(path) {
                    object.insert("raw_sha256".to_string(), Value::String(sha256(bytes)));
                }
            }
            for child in object.values_mut() {
                bind_raw_hashes(child, members);
            }
        }
        Value::Array(items) => {
            for item in items {
                bind_raw_hashes(item, members);
            }
        }
        _ => {}
    }
}

fn safe_n4mm_path(path: &str) -> bool {
    path.starts_with("methods/")
        && path.ends_with(".n4mm")
        && path.len() <= 512
        && !path.contains('\\')
        && path
            .split('/')
            .all(|part| !part.is_empty() && part != "." && part != "..")
}

fn refuse<T>(message: &str) -> Result<T> {
    Err(DagMlError::RuntimeValidation(message.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::bundle::{BundlePredictionCacheRecord, BundlePredictionRequirement};

    fn empty_bundle() -> ExecutionBundle {
        serde_json::from_value(json!({
            "bundle_id": "bundle:archive.empty-cache",
            "schema_version": 2,
            "plan_id": "plan:archive.empty-cache",
            "graph_fingerprint": "a".repeat(64),
            "campaign_fingerprint": "b".repeat(64),
            "controller_fingerprint": "c".repeat(64),
        }))
        .expect("minimal bundle shape deserializes for archive eligibility checks")
    }

    fn cache_free_graph() -> GraphSpec {
        serde_json::from_str(include_str!("../tests/fixtures/package/minimal_graph.json"))
            .expect("cache-free graph fixture deserializes")
    }

    fn resign_outcome(outcome: &mut TrainingOutcome) {
        let plan_json = serde_json::to_string(&outcome.effective_plan).unwrap();
        outcome.effective_plan_fingerprint =
            parse_typed_json(&plan_json).unwrap().fingerprint().unwrap();
        outcome.outcome_fingerprint = "0".repeat(64);
        outcome.outcome_fingerprint = outcome.compute_fingerprint().unwrap();
    }

    #[cfg(dag_ml_workspace_contract_fixtures)]
    #[test]
    fn package_local_archive_fixture_tracks_canonical_v2_replay_fixture() {
        // The package gate compiles without workspace fixtures.  This workspace
        // witness prevents the required package-local copy from silently
        // diverging from the canonical V2 replay fixture.
        assert_eq!(
            include_str!("../tests/fixtures/package/archive/training_outcome_port_explicit.json"),
            include_str!(
                "../../../examples/fixtures/training/replay/training_outcome_port_explicit.v2.json"
            )
        );
    }

    #[test]
    fn empty_cache_synthesis_requires_a_bundle_and_graph_proof_of_no_oof_dependency() {
        let bundle = empty_bundle();
        let graph = cache_free_graph();
        let empty = synthesize_empty_archive_cache_payloads(&bundle, &graph)
            .expect("an empty bundle and cache-free graph permit the neutral V2 companion");
        assert_eq!(empty.bundle_id, bundle.bundle_id);
        assert_eq!(
            empty.schema_version,
            PREDICTION_CACHE_PAYLOAD_SCHEMA_VERSION
        );
        assert!(empty.caches.is_empty());

        let requirement: BundlePredictionRequirement = serde_json::from_value(json!({
            "producer_node": "model:source",
            "source_port": "oof",
            "consumer_node": "model:consumer",
            "target_port": "meta",
            "partition": "validation",
            "prediction_level": "sample",
            "fold_ids": ["fold:0"],
            "sample_ids": ["sample:1"],
            "prediction_width": 1,
            "target_names": ["y"],
        }))
        .expect("test requirement deserializes");
        requirement
            .validate()
            .expect("test requirement is a valid nonempty OOF dependency");
        let mut with_requirement = bundle.clone();
        with_requirement.prediction_requirements.push(requirement);
        assert!(
            synthesize_empty_archive_cache_payloads(&with_requirement, &graph)
                .unwrap_err()
                .to_string()
                .contains("OOF cache dependency")
        );

        let cache: BundlePredictionCacheRecord = serde_json::from_value(json!({
            "requirement_key": "model:source.oof->model:consumer.meta",
            "cache_id": "prediction-cache:test",
            "format": "dag-ml-json-prediction-blocks-v2",
            "partition": "validation",
            "prediction_level": "sample",
            "fold_ids": ["fold:0"],
            "sample_ids": ["sample:1"],
            "prediction_width": 1,
            "target_names": ["y"],
            "block_count": 1,
            "row_count": 1,
            "content_fingerprint": "d".repeat(64),
            "blocks": [{
                "prediction_id": "prediction:source.fold0",
                "fold_id": "fold:0",
                "prediction_level": "sample",
                "row_count": 1,
                "sample_ids": ["sample:1"],
                "content_fingerprint": "e".repeat(64),
            }],
        }))
        .expect("test cache record deserializes");
        cache
            .validate()
            .expect("test cache record is a valid nonempty OOF dependency");
        let mut with_cache = bundle.clone();
        with_cache.prediction_caches.push(cache);
        assert!(synthesize_empty_archive_cache_payloads(&with_cache, &graph)
            .unwrap_err()
            .to_string()
            .contains("OOF cache dependency"));

        let oof_graph: GraphSpec = serde_json::from_str(include_str!(
            "../tests/fixtures/package/separation_branch_concat_merge_oof_graph.json"
        ))
        .expect("OOF graph fixture deserializes");
        assert!(oof_graph
            .edges
            .iter()
            .any(|edge| edge.contract.requires_oof));
        assert!(synthesize_empty_archive_cache_payloads(&bundle, &oof_graph)
            .unwrap_err()
            .to_string()
            .contains("OOF cache dependency"));
    }

    #[test]
    fn empty_cache_synthesis_refuses_a_resigned_oof_fixture_with_cleared_bundle_arrays() {
        let mut stripped = TrainingOutcome::from_json(include_str!(
            "../tests/fixtures/package/archive/training_outcome_port_explicit.json"
        ))
        .expect("real V2 stacking outcome fixture validates before hostile mutation");
        assert!(stripped
            .effective_plan
            .graph_plan
            .graph
            .edges
            .iter()
            .any(|edge| edge.contract.requires_oof));
        assert!(!stripped.execution_bundle.prediction_requirements.is_empty());
        assert!(!stripped.execution_bundle.prediction_caches.is_empty());

        // This models a malicious but re-signed portable boundary: each
        // ordinary bundle list is cleared, along with refit references and
        // the durable payload set.  The outcome remains structurally valid
        // because normal cross-link validation is deliberately one-way.
        stripped.execution_bundle.prediction_requirements.clear();
        stripped.execution_bundle.prediction_caches.clear();
        for artifact in &mut stripped.execution_bundle.refit_artifacts {
            artifact.prediction_requirement_keys.clear();
        }
        stripped.portable_prediction_caches = None;
        resign_outcome(&mut stripped);
        stripped
            .validate()
            .expect("re-signed fixture reaches the archive persistence boundary");

        let error = synthesize_empty_archive_cache_payloads(
            &stripped.execution_bundle,
            &stripped.effective_plan.graph_plan.graph,
        )
        .expect_err("graph-wide requires_oof must prevent an archive-only empty cache member");
        assert!(error.to_string().contains("OOF cache dependency"));
    }

    #[test]
    fn retained_nonempty_cache_member_keeps_historical_serialization() {
        let mut outcome = TrainingOutcome::from_json(include_str!(
            "../tests/fixtures/package/archive/training_outcome_port_explicit.json"
        ))
        .expect("real V2 stacking outcome fixture validates");
        let retained = outcome
            .portable_prediction_caches
            .as_ref()
            .expect("fixture retains its nonempty OOF cache payload set");
        assert!(!retained.caches.is_empty());

        // Make the existing fixture's refit artifacts portable raw N4MM
        // members without changing its OOF cache contracts.  Archive V2 only
        // binds raw bytes; the test needs no native runtime to prove that a
        // supplied `Some(nonempty)` cache set follows the untouched historical
        // serialization path.
        outcome.execution_bundle.raw_artifact_payloads.clear();
        for (index, record) in outcome
            .execution_bundle
            .refit_artifacts
            .iter_mut()
            .enumerate()
        {
            let payload = format!("n4mm retained-cache fixture {index}").into_bytes();
            let fingerprint = sha256(&payload);
            record.artifact.kind = "n4m_model".to_string();
            record.artifact.backend = Some(ArtifactBackend::Raw);
            record.artifact.uri = Some(format!("methods/retained-cache-{index}.n4mm"));
            record.artifact.content_fingerprint = Some(fingerprint);
            record.artifact.size_bytes = Some(payload.len() as u64);
            record.artifact.plugin = None;
            record.artifact.plugin_version = None;
            record.artifact.abi_major = Some(crate::hpo::METHODS_ABI_MAJOR);
            record.artifact.abi_min_minor = Some(crate::hpo::METHODS_PLS_N4MM_MIN_ABI_MINOR);
            outcome
                .execution_bundle
                .raw_artifact_payloads
                .insert(record.artifact.id.clone(), payload);
        }
        let portable_artifacts = outcome
            .execution_bundle
            .refit_artifacts
            .iter()
            .map(|record| (record.artifact.id.clone(), record.artifact.clone()))
            .collect::<BTreeMap<_, _>>();
        for record in &mut outcome.lineage {
            for artifact in &mut record.artifact_refs {
                if let Some(portable) = portable_artifacts.get(&artifact.id) {
                    *artifact = portable.clone();
                }
            }
        }
        resign_outcome(&mut outcome);
        outcome
            .validate()
            .expect("portable raw fixture remains a valid re-signed outcome");
        let package = outcome
            .to_portable_predictor_package(
                "predictor:archive.retained-nonempty",
                FittedArtifactMode::PortableRequired,
                ArtifactLoadMode::NativePortable,
            )
            .expect("portable raw fixture produces a PREDICT package");
        let archive = build_archive_v2_native_portable_payloads(
            "archive:retained-nonempty",
            &outcome,
            &package,
        )
        .expect("Archive V2 preserves an existing retained nonempty cache set");
        for reference in archive.manifest["payloads"]["methods"]["n4mm"]
            .as_array()
            .expect("writer emits N4MM references")
        {
            assert_eq!(reference["abi_major"], crate::hpo::METHODS_ABI_MAJOR);
            assert_eq!(
                reference["abi_min_minor"],
                crate::hpo::METHODS_PLS_N4MM_MIN_ABI_MINOR
            );
        }
        assert_eq!(
            archive.members.get(ARCHIVE_V2_CACHE_MEMBER).unwrap(),
            serde_json::to_vec(
                outcome
                    .portable_prediction_caches
                    .as_ref()
                    .expect("retained set remains present"),
            )
            .unwrap()
            .as_slice(),
            "Some(nonempty) must retain the exact historical cache JSON bytes"
        );
    }
}
