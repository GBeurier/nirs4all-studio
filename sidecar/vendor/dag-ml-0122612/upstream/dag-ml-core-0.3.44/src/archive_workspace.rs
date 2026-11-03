//! Archive V2 replay-member assembly owned by DAG-ML.
//!
//! This module deliberately does not write ZIPs or read archives.  It turns a
//! fully validated native training result into the exact DAG-ML document bytes
//! and manifest references required by ADR-23; `nirs4all-core` remains the
//! sole owner of bounded archive storage and inventory validation.

use std::collections::{BTreeMap, BTreeSet};

use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use crate::bundle::{
    BundlePredictionCachePayloadSet, ExecutionBundle, RefitArtifactRecord,
    PREDICTION_CACHE_PAYLOAD_SCHEMA_VERSION,
};
use crate::canonical::parse_typed_json;
use crate::error::{DagMlError, Result};
use crate::graph::GraphSpec;
use crate::plan::ExecutionPlan;
use crate::runtime::ArtifactBackend;
use crate::training::{ArtifactLoadMode, FittedArtifactMode, PortablePredictorPackage};
use crate::training_runtime::{PortableRefitPackageV3, TrainingOutcome};

pub const ARCHIVE_V2_PACKAGE_MEMBER: &str = "dagml/portable_predictor_package.json";
pub const ARCHIVE_V2_GRAPH_MEMBER: &str = "dagml/graph.json";
pub const ARCHIVE_V2_BUNDLE_MEMBER: &str = "dagml/execution_bundle.json";
pub const ARCHIVE_V2_OUTCOME_MEMBER: &str = "dagml/training_outcome.json";
pub const ARCHIVE_V2_CACHE_MEMBER: &str = "dagml/prediction_cache_payload_set.json";
pub const ARCHIVE_V2_SCORE_MEMBER: &str = "dagml/score_set.json";
/// Exact-byte identity profile for the bounded ADR-28 Methods wrapper.
pub const METHODS_ROLE_PIPELINE_SEMANTIC_PROFILE: &str = "dagml_methods_role_pipeline_raw_sha256";

#[derive(Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
struct MethodsRolePipelinePayload {
    schema: String,
    node_id: String,
    params_fingerprint: String,
    target_names: Vec<String>,
    steps: Vec<MethodsRolePipelineStep>,
    feature_names: Vec<String>,
    states: Vec<Vec<u8>>,
}

#[derive(Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
struct MethodsRolePipelineStep {
    #[serde(default)]
    class: Option<String>,
    #[serde(default, rename = "methodId")]
    method_id: Option<String>,
    #[serde(default)]
    params: serde_json::Map<String, Value>,
}

fn validate_methods_role_pipeline_recipe(
    record: &RefitArtifactRecord,
    bytes: &[u8],
    plan: &ExecutionPlan,
) -> Result<()> {
    let node = plan.node_plans.get(&record.node_id).ok_or_else(|| {
        DagMlError::RuntimeValidation("RolePipeline has no effective node plan".into())
    })?;
    if record.controller_id.as_str() == crate::METHODS_NATIVE_REGRESSION_CONTROLLER {
        if record.artifact.plugin.as_deref() != Some(crate::METHODS_NATIVE_REGRESSION_PLUGIN) {
            return refuse("native PLS wrapper must retain its native owner identity");
        }
        crate::methods_phase_controls::validate_native_pls_phase_plan(plan)?;
        let expected =
            crate::NativePlsRoleParams::from_params(&node.params)?.recipe(crate::Phase::Refit);
        let saved: MethodsRolePipelinePayload = serde_json::from_slice(bytes)?;
        let expected: Vec<MethodsRolePipelineStep> =
            serde_json::from_value(serde_json::to_value(expected)?)?;
        if saved.steps != expected || record.params_fingerprint != node.params_fingerprint {
            return refuse("native PLS RAW recipe differs from the signed effective REFIT phase");
        }
        return Ok(());
    }
    let graph_node = plan
        .graph_plan
        .graph
        .nodes
        .iter()
        .find(|node| node.id == record.node_id)
        .ok_or_else(|| {
            DagMlError::RuntimeValidation("RolePipeline has no effective graph operator".into())
        })?;
    let operator = graph_node.operator.as_ref().ok_or_else(|| {
        DagMlError::RuntimeValidation("RolePipeline has no explicit graph operator".into())
    })?;
    let kind = operator
        .get("type")
        .and_then(Value::as_str)
        .ok_or_else(|| {
            DagMlError::RuntimeValidation("RolePipeline graph operator has no native type".into())
        })?;
    let mut expected: Vec<MethodsRolePipelineStep> = if kind == "N4mRolePipeline" {
        serde_json::from_value(operator.get("steps").cloned().ok_or_else(|| {
            DagMlError::RuntimeValidation("RolePipeline graph operator has no steps".into())
        })?)?
    } else if kind.strip_prefix("n4m:").is_some_and(|id| !id.is_empty()) {
        vec![MethodsRolePipelineStep {
            class: Some(kind.into()),
            method_id: None,
            params: serde_json::Map::new(),
        }]
    } else {
        return refuse("RolePipeline graph operator is outside the native Methods recipe profile");
    };
    let last = expected.last_mut().ok_or_else(|| {
        DagMlError::RuntimeValidation("RolePipeline planned recipe is empty".into())
    })?;
    // This is the controller's declarative rule, not a numerical lowerer:
    // selected effective node parameters override only the final recipe step.
    last.params.extend(
        node.params
            .iter()
            .map(|(key, value)| (key.clone(), value.clone())),
    );
    let saved: MethodsRolePipelinePayload = serde_json::from_slice(bytes)?;
    if saved.steps != expected || record.params_fingerprint != node.params_fingerprint {
        return refuse(
            "RolePipeline saved recipe differs from its effective graph and selected parameters",
        );
    }
    Ok(())
}

/// Validate the declarative wrapper without interpreting Methods estimator bytes.
/// Model hydration and numerical validation remain controller/Methods-owned.
pub fn validate_methods_role_pipeline_payload(
    record: &RefitArtifactRecord,
    bytes: &[u8],
) -> Result<()> {
    let artifact = &record.artifact;
    artifact.validate_portable()?;
    if artifact.kind != "methods_role_pipeline"
        || artifact.backend != Some(ArtifactBackend::Raw)
        || !matches!(
            artifact.plugin.as_deref(),
            Some(
                "dagml.methods.wasm.regression"
                    | "dagml.methods.python.regression"
                    | "dagml.methods.r.regression"
                    | "dagml.methods.octave.regression"
                    | "dagml.methods.native.regression"
            )
        )
        || artifact.plugin_version.as_deref() != Some("1.0.0")
        || artifact.native_predictor_descriptor.is_some()
        || artifact.native_estimator_descriptor.is_some()
        || bytes.is_empty()
        || bytes.len() > 134_217_728
    {
        return refuse("Archive V2 requires the bounded trusted Methods RolePipeline RAW codec");
    }
    if artifact.plugin.as_deref() == Some(crate::METHODS_NATIVE_REGRESSION_PLUGIN)
        && (artifact.controller_id.as_str() != crate::METHODS_NATIVE_REGRESSION_CONTROLLER
            || record.controller_id.as_str() != crate::METHODS_NATIVE_REGRESSION_CONTROLLER)
    {
        return refuse("native PLS RAW plugin requires its exact native controller owner");
    }
    if artifact.plugin.as_deref() == Some("dagml.methods.octave.regression")
        && (artifact.controller_id.as_str() != "controller:methods.octave.regression"
            || record.controller_id.as_str() != "controller:methods.octave.regression")
    {
        return refuse("Octave Methods RAW plugin requires its exact Octave controller owner");
    }
    if artifact.plugin.as_deref() == Some("dagml.methods.python.regression")
        && (artifact.controller_id.as_str() != "controller:methods.python.regression"
            || record.controller_id.as_str() != "controller:methods.python.regression")
    {
        return refuse("Python Methods RAW plugin requires its exact Python controller owner");
    }
    let raw = sha256(bytes);
    if artifact.content_fingerprint.as_deref() != Some(raw.as_str())
        || artifact.size_bytes != Some(bytes.len() as u64)
        || artifact.uri.as_deref() != Some(format!("artifacts/{raw}.json").as_str())
    {
        return refuse(
            "Archive V2 RolePipeline URI, size and raw SHA-256 must exactly bind its bytes",
        );
    }
    let text = std::str::from_utf8(bytes).map_err(|error| {
        DagMlError::RuntimeValidation(format!("RolePipeline payload is not UTF-8: {error}"))
    })?;
    crate::canonical::parse_bounded_typed_json(text, 4_000_000).map_err(|error| {
        DagMlError::RuntimeValidation(format!(
            "RolePipeline payload is outside strict TCV1: {error}"
        ))
    })?;
    let payload: MethodsRolePipelinePayload = serde_json::from_str(text)?;
    let unique_text = |values: &[String]| {
        !values.is_empty()
            && values.len() <= 65_536
            && values
                .iter()
                .all(|value| !value.is_empty() && value.len() <= 4096)
            && values.iter().collect::<BTreeSet<_>>().len() == values.len()
    };
    if payload.schema != "dagml.methods.regression.v1"
        || payload.node_id != record.node_id.as_str()
        || payload.params_fingerprint != record.params_fingerprint
        || !unique_text(&payload.target_names)
        || !unique_text(&payload.feature_names)
        || payload.steps.is_empty()
        || payload.steps.len() > 256
        || payload.steps.len() != payload.states.len()
        || payload
            .states
            .iter()
            .any(|state| !state.starts_with(b"N4ME"))
    {
        return refuse("Archive V2 RolePipeline wrapper does not bind a complete native recipe and state sequence");
    }
    for step in &payload.steps {
        let valid = match (&step.class, &step.method_id) {
            (Some(class), None) => class
                .strip_prefix("n4m:")
                .is_some_and(|id| !id.is_empty() && id.len() <= 256),
            (None, Some(id)) => !id.is_empty() && id.len() <= 256,
            _ => false,
        };
        if !valid || step.params.len() > 256 {
            return refuse(
                "Archive V2 RolePipeline steps must be explicit native Methods declarations",
            );
        }
    }
    Ok(())
}

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
    let mut n4me = Vec::new();
    let mut role_pipelines = Vec::new();
    let mut methods_profiles = BTreeMap::new();
    for record in &bundle.refit_artifacts {
        let artifact = &record.artifact;
        artifact.validate_portable()?;
        if artifact.kind == "methods_role_pipeline" {
            let bytes = bundle
                .raw_artifact_payloads
                .get(&artifact.id)
                .ok_or_else(|| {
                    DagMlError::RuntimeValidation(format!(
                        "Archive V3 lacks RolePipeline RAW payload `{}`",
                        artifact.id
                    ))
                })?;
            validate_methods_role_pipeline_payload(record, bytes)?;
            validate_methods_role_pipeline_recipe(record, bytes, &outcome.effective_plan)?;
            if artifact.controller_id.as_str() != crate::METHODS_NATIVE_REGRESSION_CONTROLLER {
                return refuse("Archive V3 RolePipeline requires the native Methods controller; host-language sidecars are not portable");
            }
            let path = artifact.uri.as_ref().expect("validated portable URI");
            if members.insert(path.clone(), bytes.clone()).is_some() {
                return refuse("Archive V3 native artifact paths must be unique");
            }
            methods_profiles.insert(path.clone(), METHODS_ROLE_PIPELINE_SEMANTIC_PROFILE);
            let raw = sha256(bytes);
            role_pipelines.push(json!({
                "artifact_id": artifact.id, "kind": "methods_role_pipeline", "owner": "dag-ml",
                "format_version": 1, "member_path": path, "raw_sha256": raw,
                "semantic_fingerprint": raw, "semantic_profile": METHODS_ROLE_PIPELINE_SEMANTIC_PROFILE
            }));
            continue;
        }
        if artifact.kind == crate::NATIVE_ESTIMATOR_ARTIFACT_KIND {
            if artifact.backend != Some(ArtifactBackend::Raw)
                || artifact.plugin.is_some()
                || artifact.plugin_version.is_some()
                || artifact.abi_major != Some(crate::hpo::METHODS_ABI_MAJOR)
                || artifact.abi_min_minor != Some(crate::hpo::METHODS_N4ME_MIN_ABI_MINOR)
            {
                return refuse("Archive V3 N4ME requires a plugin-free native estimator with its exact minimum Methods ABI");
            }
            let path = artifact.uri.as_deref().expect("validated portable URI");
            if !safe_native_method_path(path, ".n4me") {
                return refuse("Archive V3 N4ME URI must be a safe methods/*.n4me path");
            }
            let bytes = bundle
                .raw_artifact_payloads
                .get(&artifact.id)
                .ok_or_else(|| {
                    DagMlError::RuntimeValidation(format!(
                        "Archive V3 lacks raw N4ME payload `{}`",
                        artifact.id
                    ))
                })?;
            let raw = sha256(bytes);
            if !bytes.starts_with(b"N4ME")
                || artifact.size_bytes != Some(bytes.len() as u64)
                || artifact.content_fingerprint.as_deref() != Some(raw.as_str())
            {
                return refuse(
                    "Archive V3 N4ME descriptor does not bind its actual native payload",
                );
            }
            if members.insert(path.to_owned(), bytes.clone()).is_some() {
                return refuse("Archive V3 native artifact paths must be unique");
            }
            methods_profiles.insert(path.to_owned(), "n4me_raw_sha256");
            n4me.push(json!({
                "artifact_id": artifact.id, "kind": "N4ME", "owner": "nirs4all-methods",
                "format_version": 1, "abi_major": artifact.abi_major,
                "abi_min_minor": artifact.abi_min_minor, "member_path": path,
                "raw_sha256": raw, "semantic_fingerprint": raw, "semantic_profile": "n4me_raw_sha256"
            }));
            continue;
        }
        if artifact.kind != "n4m_model"
            || artifact.backend != Some(ArtifactBackend::Raw)
            || artifact.plugin.is_some()
            || artifact.plugin_version.is_some()
        {
            return refuse(
                "Archive V3 accepts native N4MM, N4ME or Methods RolePipeline refit artifacts only",
            );
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
    let native_count = n4mm.len() + n4me.len() + role_pipelines.len();
    if native_count == 0
        || bundle.raw_artifact_payloads.len() != native_count
        || bundle.refit_artifacts.len() != native_count
    {
        return refuse("Archive V3 native members must exactly cover all refit artifacts");
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
    if !n4me.is_empty() {
        manifest["payloads"]["methods"]["n4me"] = Value::Array(n4me);
    }
    if !role_pipelines.is_empty() {
        manifest["payloads"]["methods"]["role_pipelines"] = Value::Array(role_pipelines);
    }
    let inventory = members
        .iter()
        .map(|(path, bytes)| {
            let (semantic_profile, semantic_fingerprint) = if path == ARCHIVE_V3_PACKAGE_MEMBER {
                ("dagml_tcv1", package.package_fingerprint.clone())
            } else if path.ends_with(".n4mm") {
                ("n4mm_raw_sha256", sha256(bytes))
            } else if let Some(profile) = methods_profiles.get(path) {
                (*profile, sha256(bytes))
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
    let mut role_pipelines = Vec::new();
    let mut multimodal_pipelines = Vec::new();
    let mut methods_profiles = BTreeMap::new();
    for record in &package.execution_bundle.refit_artifacts {
        let artifact = &record.artifact;
        if matches!(
            artifact.kind.as_str(),
            "methods_multimodal_classifier_pipeline" | "methods_role_classifier_pipeline"
        ) {
            let bytes = package
                .execution_bundle
                .raw_artifact_payloads
                .get(&artifact.id)
                .ok_or_else(|| {
                    DagMlError::RuntimeValidation(
                        "Archive V2 lacks its complete classifier RAW payload".into(),
                    )
                })?;
            crate::validate_methods_classifier_payload(record, bytes, &package.effective_plan)?;
            let path = artifact.uri.as_ref().expect("validated classifier URI");
            if members.insert(path.clone(), bytes.clone()).is_some() {
                return refuse("Archive V2 native artifact paths must be unique");
            }
            let raw = sha256(bytes);
            let multimodal = artifact.kind == "methods_multimodal_classifier_pipeline";
            let profile = if multimodal {
                crate::METHODS_MULTIMODAL_CLASSIFIER_SEMANTIC_PROFILE
            } else {
                crate::METHODS_ROLE_CLASSIFIER_SEMANTIC_PROFILE
            };
            let reference = json!({"artifact_id":artifact.id,"kind":artifact.kind,"owner":"dag-ml","format_version":1,"member_path":path,"raw_sha256":raw,"semantic_fingerprint":raw,"semantic_profile":profile});
            methods_profiles.insert(path.clone(), profile);
            if multimodal {
                multimodal_pipelines.push(reference);
            } else {
                role_pipelines.push(reference);
            }
            continue;
        }
        if artifact.kind == "methods_multimodal_pipeline" {
            let bytes = package
                .execution_bundle
                .raw_artifact_payloads
                .get(&artifact.id)
                .ok_or_else(|| {
                    DagMlError::RuntimeValidation(
                        "Archive V2 lacks its complete Methods multimodal RAW payload".into(),
                    )
                })?;
            crate::validate_methods_multimodal_pipeline_recipe(
                record,
                bytes,
                &package.effective_plan,
            )?;
            let path = artifact.uri.as_ref().expect("validated portable URI");
            if members.insert(path.clone(), bytes.clone()).is_some() {
                return refuse("Archive V2 native artifact paths must be unique");
            }
            methods_profiles.insert(path.clone(), crate::METHODS_MULTIMODAL_SEMANTIC_PROFILE);
            let raw = sha256(bytes);
            multimodal_pipelines.push(json!({"artifact_id":artifact.id,
                "kind":"methods_multimodal_pipeline", "owner":"dag-ml", "format_version":1,
                "member_path":path, "raw_sha256":raw, "semantic_fingerprint":raw,
                "semantic_profile":crate::METHODS_MULTIMODAL_SEMANTIC_PROFILE}));
            continue;
        }
        if artifact.kind == "methods_role_pipeline" {
            let bytes = package
                .execution_bundle
                .raw_artifact_payloads
                .get(&artifact.id)
                .ok_or_else(|| {
                    DagMlError::RuntimeValidation(format!(
                        "Archive V2 lacks RolePipeline RAW payload `{}`",
                        artifact.id
                    ))
                })?;
            validate_methods_role_pipeline_payload(record, bytes)?;
            validate_methods_role_pipeline_recipe(record, bytes, &package.effective_plan)?;
            let path = artifact.uri.as_ref().expect("validated portable URI");
            if members.insert(path.clone(), bytes.clone()).is_some() {
                return refuse("Archive V2 native artifact paths must be unique");
            }
            methods_profiles.insert(path.clone(), METHODS_ROLE_PIPELINE_SEMANTIC_PROFILE);
            let raw = sha256(bytes);
            role_pipelines.push(json!({
                "artifact_id": artifact.id, "kind": "methods_role_pipeline",
                "owner": "dag-ml", "format_version": 1, "member_path": path,
                "raw_sha256": raw, "semantic_fingerprint": raw,
                "semantic_profile": METHODS_ROLE_PIPELINE_SEMANTIC_PROFILE
            }));
            continue;
        }
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
    let native_count = n4mm.len() + role_pipelines.len() + multimodal_pipelines.len();
    if native_count == 0
        || package.execution_bundle.raw_artifact_payloads.len() != native_count
        || package.artifact_bindings.len() != native_count
    {
        return refuse("Archive V2 native members must exactly cover all package refit artifacts");
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
    if !role_pipelines.is_empty() {
        manifest["payloads"]["methods"]["role_pipelines"] = Value::Array(role_pipelines);
    }
    if !multimodal_pipelines.is_empty() {
        manifest["payloads"]["methods"]["multimodal_pipelines"] =
            Value::Array(multimodal_pipelines);
    }
    let inventory = archive_member_inventory(&members, package, outcome, &methods_profiles);
    manifest["member_inventory"] = Value::Array(inventory);
    bind_raw_hashes(&mut manifest, &members);
    Ok(ArchiveV2ReplayPayloads { manifest, members })
}

// Each validated Methods artifact supplies its own exact profile. In particular,
// classifier wrappers must never inherit the regression profile of the same
// role/multimodal container family.
fn archive_member_inventory(
    members: &BTreeMap<String, Vec<u8>>,
    package: &PortablePredictorPackage,
    outcome: &TrainingOutcome,
    methods_profiles: &BTreeMap<String, &'static str>,
) -> Vec<Value> {
    members
        .iter()
        .map(|(path, bytes)| {
            let (semantic_profile, semantic_fingerprint) = if path == ARCHIVE_V2_PACKAGE_MEMBER {
                ("dagml_tcv1", package.package_fingerprint.clone())
            } else if let Some(profile) = methods_profiles.get(path) {
                (*profile, sha256(bytes))
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
        .collect()
}

/// Validate the exact standalone predictor transport assembled by DAG-ML.
///
/// Core first validates container bounds and inventory. This independent
/// semantic gate preserves the original package/outcome and checks every
/// companion, reference and RAW member before any controller callback runs.
pub fn validate_archive_v2_portable_payloads(
    manifest: &Value,
    package: &PortablePredictorPackage,
    members: &BTreeMap<String, Vec<u8>>,
) -> Result<()> {
    let archive_id = manifest
        .get("archive_id")
        .and_then(Value::as_str)
        .ok_or_else(|| DagMlError::RuntimeValidation("Archive V2 has no archive_id".into()))?;
    let bytes = members.get(ARCHIVE_V2_OUTCOME_MEMBER).ok_or_else(|| {
        DagMlError::RuntimeValidation("Archive V2 lacks its TrainingOutcome companion".into())
    })?;
    let text = std::str::from_utf8(bytes).map_err(|error| {
        DagMlError::RuntimeValidation(format!("Archive V2 TrainingOutcome is not UTF-8: {error}"))
    })?;
    let outcome = TrainingOutcome::from_json(text)?;
    let expected = build_archive_v2_native_portable_payloads(archive_id, &outcome, package)?;
    if manifest != &expected.manifest || members != &expected.members {
        return refuse(
            "Archive V2 portable transport differs from its exact DAG-ML semantic closure",
        );
    }
    Ok(())
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
    // Cargo feature unification may enable preserve_order only on some hosts.
    // Archive members must retain the same bytes and raw hashes across them.
    members.insert(path.to_owned(), crate::stable_json::to_vec(value)?);
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
    safe_native_method_path(path, ".n4mm")
}

fn safe_native_method_path(path: &str, extension: &str) -> bool {
    path.starts_with("methods/")
        && path.ends_with(extension)
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

    // These are opaque transport witnesses, not numerical N4ME qualification.
    // The real five-model Methods campaign runs in the Node/web smoke script.
    fn role_transport_fixture(mixed: bool) -> (TrainingOutcome, PortablePredictorPackage) {
        let mut outcome = TrainingOutcome::from_json(include_str!(
            "../tests/fixtures/package/archive/training_outcome_port_explicit.json"
        ))
        .unwrap();
        outcome.execution_bundle.raw_artifact_payloads.clear();
        for (index, record) in outcome
            .execution_bundle
            .refit_artifacts
            .iter_mut()
            .enumerate()
        {
            let role = !mixed || index % 2 == 0;
            let payload = if role {
                serde_json::to_vec(&json!({
                    "schema": "dagml.methods.regression.v1", "node_id": record.node_id,
                    "params_fingerprint": record.params_fingerprint,
                    "target_names": ["y"], "feature_names": ["source:feature"],
                    "steps": [{"class": "n4m:models.regularized.ridge",
                        "params": outcome.effective_plan.node_plans[&record.node_id].params}],
                    "states": [[78, 52, 77, 69, index as u8]]
                }))
                .unwrap()
            } else {
                format!("opaque N4MM transport witness {index}").into_bytes()
            };
            let fingerprint = sha256(&payload);
            record.artifact.kind = if role {
                "methods_role_pipeline"
            } else {
                "n4m_model"
            }
            .into();
            record.artifact.backend = Some(ArtifactBackend::Raw);
            record.artifact.uri = Some(if role {
                format!("artifacts/{fingerprint}.json")
            } else {
                format!("methods/mixed-{index}.n4mm")
            });
            record.artifact.content_fingerprint = Some(fingerprint);
            record.artifact.size_bytes = Some(payload.len() as u64);
            record.artifact.plugin = role.then(|| "dagml.methods.wasm.regression".into());
            record.artifact.plugin_version = role.then(|| "1.0.0".into());
            record.artifact.abi_major = (!role).then_some(crate::hpo::METHODS_ABI_MAJOR);
            record.artifact.abi_min_minor =
                (!role).then_some(crate::hpo::METHODS_PLS_N4MM_MIN_ABI_MINOR);
            record.artifact.native_predictor_descriptor = None;
            record.artifact.native_estimator_descriptor = None;
            outcome
                .execution_bundle
                .raw_artifact_payloads
                .insert(record.artifact.id.clone(), payload);
        }
        let role_nodes = outcome
            .execution_bundle
            .refit_artifacts
            .iter()
            .filter(|record| record.artifact.kind == "methods_role_pipeline")
            .map(|record| record.node_id.clone())
            .collect::<BTreeSet<_>>();
        for node in &mut outcome.effective_plan.graph_plan.graph.nodes {
            if role_nodes.contains(&node.id) {
                node.operator = Some(json!({"type": "n4m:models.regularized.ridge"}));
            }
        }
        outcome.effective_plan.graph_fingerprint =
            crate::campaign::stable_json_fingerprint(&outcome.effective_plan.graph_plan.graph)
                .unwrap();
        outcome.execution_bundle.graph_fingerprint =
            outcome.effective_plan.graph_fingerprint.clone();
        let artifacts = outcome
            .execution_bundle
            .refit_artifacts
            .iter()
            .map(|record| (record.artifact.id.clone(), record.artifact.clone()))
            .collect::<BTreeMap<_, _>>();
        for record in &mut outcome.lineage {
            for artifact in &mut record.artifact_refs {
                if let Some(portable) = artifacts.get(&artifact.id) {
                    *artifact = portable.clone();
                }
            }
        }
        resign_outcome(&mut outcome);
        outcome.validate().unwrap();
        let package = outcome
            .to_portable_predictor_package(
                "predictor:archive.roles",
                FittedArtifactMode::PortableRequired,
                ArtifactLoadMode::NativePortable,
            )
            .unwrap();
        (outcome, package)
    }

    #[test]
    fn mixed_classifier_and_regression_inventory_retains_exact_declared_profiles() {
        // Reuse the validated mixed regression transport for all six companion
        // documents and its native role/N4MM members. The extra bytes are only
        // opaque storage witnesses: they do not claim fitted classifier state
        // validation, which remains mandatory before assembly and in real
        // installed classifier/archive qualification.
        let (outcome, package) = role_transport_fixture(true);
        let archive =
            build_archive_v2_native_portable_payloads("archive:profiles", &outcome, &package)
                .unwrap();
        let mut members = archive.members.clone();
        let mut profiles = BTreeMap::new();
        for reference in archive.manifest["payloads"]["methods"]["role_pipelines"]
            .as_array()
            .unwrap()
        {
            profiles.insert(
                reference["member_path"].as_str().unwrap().to_owned(),
                METHODS_ROLE_PIPELINE_SEMANTIC_PROFILE,
            );
        }
        let cases = [
            (
                "artifacts/storage-multimodal-regression.json",
                crate::METHODS_MULTIMODAL_SEMANTIC_PROFILE,
                "dagml_methods_multimodal_pipeline_raw_sha256",
            ),
            (
                "artifacts/storage-role-classifier.json",
                crate::METHODS_ROLE_CLASSIFIER_SEMANTIC_PROFILE,
                "dagml_methods_role_classifier_pipeline_raw_sha256",
            ),
            (
                "artifacts/storage-multimodal-classifier.json",
                crate::METHODS_MULTIMODAL_CLASSIFIER_SEMANTIC_PROFILE,
                "dagml_methods_multimodal_classifier_pipeline_raw_sha256",
            ),
        ];
        for (path, profile, _) in cases {
            members.insert(
                path.to_owned(),
                format!("opaque storage witness {path}").into_bytes(),
            );
            profiles.insert(path.to_owned(), profile);
        }
        let inventory = archive_member_inventory(&members, &package, &outcome, &profiles);
        assert_eq!(
            inventory.len(),
            archive.manifest["member_inventory"]
                .as_array()
                .unwrap()
                .len()
                + 3
        );
        for original in archive.manifest["member_inventory"].as_array().unwrap() {
            let retained = inventory
                .iter()
                .find(|entry| entry["path"] == original["path"])
                .unwrap();
            assert_eq!(
                retained, original,
                "historical regression/companion inventory must stay exact"
            );
        }
        for (path, _, expected_profile) in cases {
            let bytes = &members[path];
            let raw = sha256(bytes);
            let entry = inventory
                .iter()
                .find(|entry| entry["path"] == path)
                .unwrap();
            assert_eq!(
                entry,
                &json!({
                    "path": path, "regular_file": true, "raw_sha256": raw,
                    "uncompressed_size_bytes": bytes.len(), "semantic_fingerprint": raw,
                    "semantic_profile": expected_profile,
                })
            );
        }
    }

    #[test]
    fn archive_transport_is_independent_of_nested_json_key_order() {
        fn reversed_json(value: &Value) -> String {
            match value {
                Value::Object(map) => format!(
                    "{{{}}}",
                    map.iter()
                        .rev()
                        .map(|(key, value)| format!(
                            "{}:{}",
                            serde_json::to_string(key).unwrap(),
                            reversed_json(value)
                        ))
                        .collect::<Vec<_>>()
                        .join(",")
                ),
                Value::Array(values) => format!(
                    "[{}]",
                    values
                        .iter()
                        .map(reversed_json)
                        .collect::<Vec<_>>()
                        .join(",")
                ),
                _ => serde_json::to_string(value).unwrap(),
            }
        }

        let (outcome, package) = role_transport_fixture(false);
        let reordered_outcome =
            TrainingOutcome::from_json(&reversed_json(&serde_json::to_value(&outcome).unwrap()))
                .unwrap();
        let reordered_package = PortablePredictorPackage::from_json(&reversed_json(
            &serde_json::to_value(&package).unwrap(),
        ))
        .unwrap();
        assert_eq!(outcome, reordered_outcome);
        assert_eq!(package, reordered_package);
        let original =
            build_archive_v2_native_portable_payloads("archive:key-order", &outcome, &package)
                .unwrap();
        let rebuilt = build_archive_v2_native_portable_payloads(
            "archive:key-order",
            &reordered_outcome,
            &reordered_package,
        )
        .unwrap();
        for (path, bytes) in &original.members {
            assert!(bytes == &rebuilt.members[path], "member {path}");
        }
        assert_eq!(original.manifest, rebuilt.manifest);
        validate_archive_v2_portable_payloads(
            &original.manifest,
            &reordered_package,
            &original.members,
        )
        .unwrap();
    }

    #[test]
    fn role_and_mixed_transport_preserve_exact_package_and_raw_closure() {
        for mixed in [false, true] {
            let (outcome, package) = role_transport_fixture(mixed);
            let archive =
                build_archive_v2_native_portable_payloads("archive:roles", &outcome, &package)
                    .unwrap();
            let methods = &archive.manifest["payloads"]["methods"];
            let roles = methods["role_pipelines"].as_array().unwrap();
            let n4mm = methods["n4mm"].as_array().unwrap();
            assert!(!roles.is_empty());
            assert_eq!(n4mm.is_empty(), !mixed);
            assert_eq!(roles.len() + n4mm.len(), package.artifact_bindings.len());
            assert_eq!(archive.members.len(), 6 + package.artifact_bindings.len());
            assert_eq!(
                archive.members[ARCHIVE_V2_PACKAGE_MEMBER],
                crate::stable_json::to_vec(&package).unwrap()
            );
            assert_eq!(
                archive.members[ARCHIVE_V2_OUTCOME_MEMBER],
                crate::stable_json::to_vec(&outcome).unwrap()
            );
            validate_archive_v2_portable_payloads(&archive.manifest, &package, &archive.members)
                .unwrap();
            for reference in roles {
                let path = reference["member_path"].as_str().unwrap();
                let raw = sha256(&archive.members[path]);
                assert_eq!(reference["raw_sha256"], raw);
                assert_eq!(reference["semantic_fingerprint"], raw);
                assert_eq!(
                    reference["semantic_profile"],
                    METHODS_ROLE_PIPELINE_SEMANTIC_PROFILE
                );
                let entry = archive.manifest["member_inventory"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .find(|entry| entry["path"] == path)
                    .unwrap();
                assert_eq!(entry["raw_sha256"], reference["raw_sha256"]);
                assert_eq!(
                    entry["semantic_fingerprint"],
                    reference["semantic_fingerprint"]
                );
                assert_eq!(entry["semantic_profile"], reference["semantic_profile"]);
            }
            let mut missing = archive.members.clone();
            missing.remove(roles[0]["member_path"].as_str().unwrap());
            assert!(
                validate_archive_v2_portable_payloads(&archive.manifest, &package, &missing)
                    .is_err()
            );
            let mut altered = archive.members.clone();
            altered.get_mut(ARCHIVE_V2_GRAPH_MEMBER).unwrap().push(b' ');
            assert!(
                validate_archive_v2_portable_payloads(&archive.manifest, &package, &altered)
                    .is_err()
            );
            let mut injected = archive.members.clone();
            injected.insert("unexpected.json".into(), b"{}".to_vec());
            assert!(
                validate_archive_v2_portable_payloads(&archive.manifest, &package, &injected)
                    .is_err()
            );
            let mut alias = archive.manifest.clone();
            alias["payloads"]["methods"]["role_pipelines"][0]["artifact_id"] =
                json!("artifact:unbound");
            assert!(
                validate_archive_v2_portable_payloads(&alias, &package, &archive.members).is_err()
            );
        }
    }

    #[test]
    fn role_wrapper_refuses_unknown_schema_identity_recipe_and_state() {
        let (_, package) = role_transport_fixture(false);
        let original = &package.execution_bundle.refit_artifacts[0];
        let bytes = &package.execution_bundle.raw_artifact_payloads[&original.artifact.id];
        validate_methods_role_pipeline_payload(original, bytes).unwrap();
        let mut r_native = original.clone();
        r_native.artifact.plugin = Some("dagml.methods.r.regression".into());
        validate_methods_role_pipeline_payload(&r_native, bytes).unwrap();
        r_native.artifact.plugin = Some("dagml.methods.unknown.regression".into());
        assert!(validate_methods_role_pipeline_payload(&r_native, bytes).is_err());
        let mut untrusted = original.clone();
        untrusted.artifact.plugin_version = Some("999.0.0".into());
        assert!(validate_methods_role_pipeline_payload(&untrusted, bytes).is_err());
        let mut external = original.clone();
        external.artifact.uri = Some("../external.json".into());
        assert!(validate_methods_role_pipeline_payload(&external, bytes).is_err());
        for (pointer, value) in [
            ("/schema", json!("dagml.methods.regression.v999")),
            ("/node_id", json!("model:another")),
            ("/params_fingerprint", json!("f".repeat(64))),
            ("/steps/0/class", json!("sklearn.Ridge")),
            ("/states/0", json!([80, 73, 67, 75, 76, 69])),
            ("/target_names", json!([])),
            ("/feature_names", json!(["duplicate", "duplicate"])),
        ] {
            let mut wrapper: Value = serde_json::from_slice(bytes).unwrap();
            if pointer == "/steps/0/class" {
                wrapper["steps"][0]["class"] = value;
            } else {
                *wrapper.pointer_mut(pointer).unwrap() = value;
            }
            let modified = serde_json::to_vec(&wrapper).unwrap();
            let mut record = original.clone();
            let raw = sha256(&modified);
            record.artifact.uri = Some(format!("artifacts/{raw}.json"));
            record.artifact.content_fingerprint = Some(raw);
            record.artifact.size_bytes = Some(modified.len() as u64);
            assert!(
                validate_methods_role_pipeline_payload(&record, &modified).is_err(),
                "{pointer}"
            );
        }
        let mut wrapper: Value = serde_json::from_slice(bytes).unwrap();
        wrapper["unexpected"] = json!(true);
        let modified = serde_json::to_vec(&wrapper).unwrap();
        let mut record = original.clone();
        let raw = sha256(&modified);
        record.artifact.uri = Some(format!("artifacts/{raw}.json"));
        record.artifact.content_fingerprint = Some(raw);
        record.artifact.size_bytes = Some(modified.len() as u64);
        assert!(validate_methods_role_pipeline_payload(&record, &modified).is_err());
    }

    #[test]
    fn octave_role_plugin_requires_both_exact_controller_owners() {
        let (_, package) = role_transport_fixture(false);
        let original = &package.execution_bundle.refit_artifacts[0];
        let bytes = &package.execution_bundle.raw_artifact_payloads[&original.artifact.id];
        let mut octave = original.clone();
        octave.artifact.plugin = Some("dagml.methods.octave.regression".into());
        assert!(validate_methods_role_pipeline_payload(&octave, bytes).is_err());
        octave.artifact.controller_id =
            crate::ControllerId::new("controller:methods.octave.regression").unwrap();
        assert!(validate_methods_role_pipeline_payload(&octave, bytes).is_err());
        octave.controller_id = octave.artifact.controller_id.clone();
        validate_methods_role_pipeline_payload(&octave, bytes).unwrap();
        let mut foreign_artifact = octave.clone();
        foreign_artifact.artifact.controller_id = original.artifact.controller_id.clone();
        assert!(validate_methods_role_pipeline_payload(&foreign_artifact, bytes).is_err());
        for plugin in [
            "dagml.methods.octave.regression.v2",
            "dagml.methods.octave.unknown",
        ] {
            let mut unknown = octave.clone();
            unknown.artifact.plugin = Some(plugin.into());
            assert!(validate_methods_role_pipeline_payload(&unknown, bytes).is_err());
        }
        let mut wrong_version = octave;
        wrong_version.artifact.plugin_version = Some("1.0.1".into());
        assert!(validate_methods_role_pipeline_payload(&wrong_version, bytes).is_err());
    }

    #[test]
    fn python_role_plugin_requires_both_exact_controller_owners() {
        let (_, package) = role_transport_fixture(false);
        let original = &package.execution_bundle.refit_artifacts[0];
        let bytes = &package.execution_bundle.raw_artifact_payloads[&original.artifact.id];
        let mut python = original.clone();
        python.artifact.plugin = Some("dagml.methods.python.regression".into());
        assert!(validate_methods_role_pipeline_payload(&python, bytes).is_err());
        python.artifact.controller_id =
            crate::ControllerId::new("controller:methods.python.regression").unwrap();
        assert!(validate_methods_role_pipeline_payload(&python, bytes).is_err());
        python.controller_id = python.artifact.controller_id.clone();
        validate_methods_role_pipeline_payload(&python, bytes).unwrap();
        let mut foreign = python.clone();
        foreign.artifact.controller_id = original.artifact.controller_id.clone();
        assert!(validate_methods_role_pipeline_payload(&foreign, bytes).is_err());
        let mut unknown = python.clone();
        unknown.artifact.plugin = Some("dagml.methods.python.regression.v2".into());
        assert!(validate_methods_role_pipeline_payload(&unknown, bytes).is_err());
        let mut wrong_version = python;
        wrong_version.artifact.plugin_version = Some("1.0.1".into());
        assert!(validate_methods_role_pipeline_payload(&wrong_version, bytes).is_err());
    }

    #[test]
    fn resealed_role_recipe_cannot_override_the_unchanged_effective_plan() {
        for change_method in [false, true] {
            let (mut outcome, _) = role_transport_fixture(false);
            let record = &mut outcome.execution_bundle.refit_artifacts[0];
            let mut wrapper: Value = serde_json::from_slice(
                &outcome.execution_bundle.raw_artifact_payloads[&record.artifact.id],
            )
            .unwrap();
            if change_method {
                wrapper["steps"][0]["class"] = json!("n4m:models.pls");
            } else {
                wrapper["steps"][0]["params"]["unplanned_alpha"] = json!(9);
            }
            let bytes = serde_json::to_vec(&wrapper).unwrap();
            let raw = sha256(&bytes);
            record.artifact.uri = Some(format!("artifacts/{raw}.json"));
            record.artifact.content_fingerprint = Some(raw);
            record.artifact.size_bytes = Some(bytes.len() as u64);
            validate_methods_role_pipeline_payload(record, &bytes).unwrap();
            let changed = record.artifact.clone();
            outcome
                .execution_bundle
                .raw_artifact_payloads
                .insert(changed.id.clone(), bytes);
            for lineage in &mut outcome.lineage {
                for artifact in &mut lineage.artifact_refs {
                    if artifact.id == changed.id {
                        *artifact = changed.clone();
                    }
                }
            }
            resign_outcome(&mut outcome);
            outcome.validate().unwrap();
            let package = outcome
                .to_portable_predictor_package(
                    "predictor:resealed.recipe",
                    FittedArtifactMode::PortableRequired,
                    ArtifactLoadMode::NativePortable,
                )
                .unwrap();
            assert!(build_archive_v2_native_portable_payloads(
                "archive:resealed.recipe",
                &outcome,
                &package
            )
            .unwrap_err()
            .to_string()
            .contains("saved recipe differs"));
        }
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
        assert!(archive.manifest["payloads"]["methods"]
            .get("role_pipelines")
            .is_none());
        validate_archive_v2_portable_payloads(&archive.manifest, &package, &archive.members)
            .unwrap();
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
            crate::stable_json::to_vec(
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
