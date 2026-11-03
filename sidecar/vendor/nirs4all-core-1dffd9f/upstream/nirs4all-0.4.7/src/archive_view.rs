//! Read-only archive projections for application hosts.
//!
//! The archive manifest is the persisted source of truth.  This module only
//! projects its already-validated references into a serializable view; it does
//! not deserialize DAG-ML payloads, calculate conformal intervals, or execute
//! replay.

use std::fmt;

use serde::Serialize;
use serde_json::{Map, Value};

use crate::{
    ArchiveReference, ArchiveV2Reference, ArchiveV3Reference, LoadedArchiveV1, LoadedArchiveV2,
    LoadedArchiveV3,
};

/// Serializable, read-only summary of an archive's replay and evidence refs.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct ArchiveView {
    pub archive_id: String,
    pub schema_version: u32,
    pub profile: String,
    pub archive_sha256: String,
    pub replay: ArchiveReplayView,
    /// The identity-bound split-conformal calibration payload, if persisted.
    /// Its contents remain owned and validated by DAG-ML.
    pub conformal: Option<ArchivePayloadView>,
    /// The optional DAG-ML robustness report reference.
    pub robustness: Option<ArchivePayloadView>,
}

/// Required, typed references that make an archive replay-complete.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct ArchiveReplayView {
    pub portable_predictor_package: ArchivePayloadView,
    pub graph: ArchivePayloadView,
    pub execution_bundle: ArchivePayloadView,
    pub training_outcome: ArchivePayloadView,
    pub prediction_cache_payload_set: ArchivePayloadView,
    pub score_set: ArchivePayloadView,
    /// The aggregate exposes this evidence but has no native artifact executor.
    pub execution_status: ArchiveReplayExecutionStatus,
}

/// Current aggregate replay capability for a fully declared archive.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ArchiveReplayExecutionStatus {
    RequiresNativeArtifactExecutor,
}

/// An integrity-checked archive member reference from the manifest.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct ArchivePayloadView {
    pub owner: String,
    pub schema_id: String,
    pub schema_version: u32,
    pub member_path: String,
    pub raw_sha256: String,
    pub semantic_fingerprint: String,
    pub semantic_profile: String,
    /// Present when replay provenance is bound to the producing output port.
    pub producer_port_required: Option<bool>,
}

/// Serializable, read-only V3 archive inventory for an application host.
///
/// It exposes only the V3 manifest declarations that Core validates: opaque
/// DAG-ML replay references and native artifact inventory metadata. It does not
/// deserialize those members, execute them, or infer results, OOF data,
/// scores, HPO state, or conformal state.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct ArchiveV3View {
    pub archive_id: String,
    pub schema_version: u32,
    pub profile: String,
    pub archive_sha256: String,
    pub replay: ArchiveV3ReplayView,
    pub methods: ArchiveV3MethodsView,
}

/// V3's opaque DAG-ML replay member references.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct ArchiveV3ReplayView {
    pub portable_refit_package: ArchivePayloadView,
    pub graph: ArchivePayloadView,
    pub execution_bundle: ArchivePayloadView,
    pub refit_outcome: ArchivePayloadView,
    /// V3 declares native method artifacts; Core does not execute them.
    pub execution_status: ArchiveReplayExecutionStatus,
}

/// The native-method artifact declarations validated for an Archive V3.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct ArchiveV3MethodsView {
    pub n4mm: Vec<ArchiveV3N4mmView>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub n4me: Vec<ArchiveV3N4meView>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub role_pipelines: Vec<ArchiveV3RolePipelineView>,
}

/// Metadata for one declared N4MM member; this never includes artifact bytes.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct ArchiveV3N4mmView {
    pub artifact_id: String,
    pub kind: String,
    pub owner: String,
    pub format_version: u32,
    pub abi_major: u32,
    /// Optional minimum Methods ABI minor declared by the archive.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub abi_min_minor: Option<u32>,
    pub member_path: String,
    pub raw_sha256: String,
    pub semantic_fingerprint: String,
    pub semantic_profile: String,
}

/// Native estimator metadata has the same ABI-bound fields as N4MM metadata.
/// The validated `kind` and semantic profile distinguish the state families.
pub type ArchiveV3N4meView = ArchiveV3N4mmView;

/// Reference to a DAG-ML-owned wrapper containing native N4ME role states.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct ArchiveV3RolePipelineView {
    pub artifact_id: String,
    pub kind: String,
    pub owner: String,
    pub format_version: u32,
    pub member_path: String,
    pub raw_sha256: String,
    pub semantic_fingerprint: String,
    pub semantic_profile: String,
}

/// A malformed persisted manifest prevented a host projection.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ArchiveViewError(String);

impl fmt::Display for ArchiveViewError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "archive view refusal: {}", self.0)
    }
}

impl std::error::Error for ArchiveViewError {}

/// Project an integrity-checked archive into a common host view model.
pub fn archive_view(archive: &LoadedArchiveV1) -> Result<ArchiveView, ArchiveViewError> {
    archive_view_from_manifest(archive.reference(), archive.manifest())
}

/// Project an integrity-checked Archive V2 without parsing or executing its
/// DAG-ML members. This gives Rust hosts (including the Studio sidecar) the
/// same reference-only capability as V1 while preserving V2's package-owned
/// conformal state: `payloads.conformal` remains an ownership marker and is
/// therefore expected to be null.
pub fn archive_v2_view(archive: &LoadedArchiveV2) -> Result<ArchiveView, ArchiveViewError> {
    archive_v2_view_from_manifest(archive.reference(), archive.manifest())
}

/// Project an integrity-checked Archive V3 into its native-artifact inventory
/// view without parsing DAG-ML or N4MM members or executing a replay.
pub fn archive_v3_view(archive: &LoadedArchiveV3) -> Result<ArchiveV3View, ArchiveViewError> {
    archive_v3_view_from_manifest(archive.reference(), archive.manifest())
}

fn archive_view_from_manifest(
    reference: &ArchiveReference,
    manifest: &Value,
) -> Result<ArchiveView, ArchiveViewError> {
    let root = object(manifest, "manifest")?;
    let replay = object(member(root, "replay", "manifest")?, "replay")?;
    let training_artifacts = object(
        member(replay, "training_artifacts", "replay")?,
        "replay.training_artifacts",
    )?;
    let payloads = object(member(root, "payloads", "manifest")?, "payloads")?;

    Ok(ArchiveView {
        archive_id: reference.archive_id().to_owned(),
        schema_version: reference.schema_version(),
        profile: reference.profile().to_owned(),
        archive_sha256: reference.archive_sha256().to_owned(),
        replay: ArchiveReplayView {
            portable_predictor_package: payload_view(member(
                replay,
                "portable_predictor_package",
                "replay",
            )?)?,
            graph: payload_view(member(
                training_artifacts,
                "graph",
                "replay.training_artifacts",
            )?)?,
            execution_bundle: payload_view(member(
                training_artifacts,
                "execution_bundle",
                "replay.training_artifacts",
            )?)?,
            training_outcome: payload_view(member(
                training_artifacts,
                "training_outcome",
                "replay.training_artifacts",
            )?)?,
            prediction_cache_payload_set: payload_view(member(
                training_artifacts,
                "prediction_cache_payload_set",
                "replay.training_artifacts",
            )?)?,
            score_set: payload_view(member(
                training_artifacts,
                "score_set",
                "replay.training_artifacts",
            )?)?,
            execution_status: ArchiveReplayExecutionStatus::RequiresNativeArtifactExecutor,
        },
        conformal: optional_payload_view(payloads, "conformal", "payloads")?,
        robustness: optional_payload_view(payloads, "robustness", "payloads")?,
    })
}

fn archive_v2_view_from_manifest(
    reference: &ArchiveV2Reference,
    manifest: &Value,
) -> Result<ArchiveView, ArchiveViewError> {
    let root = object(manifest, "manifest")?;
    let replay = object(member(root, "replay", "manifest")?, "replay")?;
    let training_artifacts = object(
        member(replay, "training_artifacts", "replay")?,
        "replay.training_artifacts",
    )?;
    let payloads = object(member(root, "payloads", "manifest")?, "payloads")?;

    if !member(payloads, "conformal", "payloads")?.is_null() {
        return Err(ArchiveViewError(
            "Archive V2 payloads.conformal must be null; conformal state is package-owned"
                .to_string(),
        ));
    }

    Ok(ArchiveView {
        archive_id: reference.archive_id().to_owned(),
        schema_version: reference.schema_version(),
        profile: reference.profile().to_owned(),
        archive_sha256: reference.archive_sha256().to_owned(),
        replay: ArchiveReplayView {
            portable_predictor_package: payload_view(member(
                replay,
                "portable_predictor_package",
                "replay",
            )?)?,
            graph: payload_view(member(
                training_artifacts,
                "graph",
                "replay.training_artifacts",
            )?)?,
            execution_bundle: payload_view(member(
                training_artifacts,
                "execution_bundle",
                "replay.training_artifacts",
            )?)?,
            training_outcome: payload_view(member(
                training_artifacts,
                "training_outcome",
                "replay.training_artifacts",
            )?)?,
            prediction_cache_payload_set: payload_view(member(
                training_artifacts,
                "prediction_cache_payload_set",
                "replay.training_artifacts",
            )?)?,
            score_set: payload_view(member(
                training_artifacts,
                "score_set",
                "replay.training_artifacts",
            )?)?,
            execution_status: ArchiveReplayExecutionStatus::RequiresNativeArtifactExecutor,
        },
        conformal: None,
        robustness: optional_payload_view(payloads, "robustness", "payloads")?,
    })
}

fn archive_v3_view_from_manifest(
    reference: &ArchiveV3Reference,
    manifest: &Value,
) -> Result<ArchiveV3View, ArchiveViewError> {
    let root = object(manifest, "manifest")?;
    let replay = object(member(root, "replay", "manifest")?, "replay")?;
    let refit_artifacts = object(
        member(replay, "refit_artifacts", "replay")?,
        "replay.refit_artifacts",
    )?;
    let payloads = object(member(root, "payloads", "manifest")?, "payloads")?;
    let methods = object(member(payloads, "methods", "payloads")?, "payloads.methods")?;
    let n4mm = array(
        member(methods, "n4mm", "payloads.methods")?,
        "payloads.methods.n4mm",
    )?
    .iter()
    .map(n4mm_view)
    .collect::<Result<Vec<_>, _>>()?;
    let n4me = methods
        .get("n4me")
        .map(|value| {
            array(value, "payloads.methods.n4me")
                .and_then(|values| values.iter().map(n4mm_view).collect::<Result<Vec<_>, _>>())
        })
        .transpose()?
        .unwrap_or_default();
    let role_pipelines = methods
        .get("role_pipelines")
        .map(|value| {
            array(value, "payloads.methods.role_pipelines").and_then(|values| {
                values
                    .iter()
                    .map(role_pipeline_view)
                    .collect::<Result<Vec<_>, _>>()
            })
        })
        .transpose()?
        .unwrap_or_default();

    Ok(ArchiveV3View {
        archive_id: reference.archive_id().to_owned(),
        schema_version: reference.schema_version(),
        profile: reference.profile().to_owned(),
        archive_sha256: reference.archive_sha256().to_owned(),
        replay: ArchiveV3ReplayView {
            portable_refit_package: payload_view(member(
                replay,
                "portable_refit_package",
                "replay",
            )?)?,
            graph: payload_view(member(refit_artifacts, "graph", "replay.refit_artifacts")?)?,
            execution_bundle: payload_view(member(
                refit_artifacts,
                "execution_bundle",
                "replay.refit_artifacts",
            )?)?,
            refit_outcome: payload_view(member(
                refit_artifacts,
                "refit_outcome",
                "replay.refit_artifacts",
            )?)?,
            execution_status: ArchiveReplayExecutionStatus::RequiresNativeArtifactExecutor,
        },
        methods: ArchiveV3MethodsView {
            n4mm,
            n4me,
            role_pipelines,
        },
    })
}

fn optional_payload_view(
    object: &Map<String, Value>,
    key: &str,
    context: &str,
) -> Result<Option<ArchivePayloadView>, ArchiveViewError> {
    let value = member(object, key, context)?;
    if value.is_null() {
        Ok(None)
    } else {
        payload_view(value).map(Some)
    }
}

fn payload_view(value: &Value) -> Result<ArchivePayloadView, ArchiveViewError> {
    let object = object(value, "payload reference")?;
    Ok(ArchivePayloadView {
        owner: string(
            member(object, "owner", "payload reference")?,
            "payload reference.owner",
        )?,
        schema_id: string(
            member(object, "schema_id", "payload reference")?,
            "payload reference.schema_id",
        )?,
        schema_version: u32_value(
            member(object, "schema_version", "payload reference")?,
            "payload reference.schema_version",
        )?,
        member_path: string(
            member(object, "member_path", "payload reference")?,
            "payload reference.member_path",
        )?,
        raw_sha256: string(
            member(object, "raw_sha256", "payload reference")?,
            "payload reference.raw_sha256",
        )?,
        semantic_fingerprint: string(
            member(object, "semantic_fingerprint", "payload reference")?,
            "payload reference.semantic_fingerprint",
        )?,
        semantic_profile: string(
            member(object, "semantic_profile", "payload reference")?,
            "payload reference.semantic_profile",
        )?,
        producer_port_required: optional_bool(
            object,
            "producer_port_required",
            "payload reference",
        )?,
    })
}

fn n4mm_view(value: &Value) -> Result<ArchiveV3N4mmView, ArchiveViewError> {
    let object = object(value, "V3 N4MM inventory entry")?;
    Ok(ArchiveV3N4mmView {
        artifact_id: string(
            member(object, "artifact_id", "V3 N4MM inventory entry")?,
            "V3 N4MM inventory entry.artifact_id",
        )?,
        kind: string(
            member(object, "kind", "V3 N4MM inventory entry")?,
            "V3 N4MM inventory entry.kind",
        )?,
        owner: string(
            member(object, "owner", "V3 N4MM inventory entry")?,
            "V3 N4MM inventory entry.owner",
        )?,
        format_version: u32_value(
            member(object, "format_version", "V3 N4MM inventory entry")?,
            "V3 N4MM inventory entry.format_version",
        )?,
        abi_major: u32_value(
            member(object, "abi_major", "V3 N4MM inventory entry")?,
            "V3 N4MM inventory entry.abi_major",
        )?,
        abi_min_minor: object
            .get("abi_min_minor")
            .map(|value| u32_value(value, "V3 N4MM inventory entry.abi_min_minor"))
            .transpose()?,
        member_path: string(
            member(object, "member_path", "V3 N4MM inventory entry")?,
            "V3 N4MM inventory entry.member_path",
        )?,
        raw_sha256: string(
            member(object, "raw_sha256", "V3 N4MM inventory entry")?,
            "V3 N4MM inventory entry.raw_sha256",
        )?,
        semantic_fingerprint: string(
            member(object, "semantic_fingerprint", "V3 N4MM inventory entry")?,
            "V3 N4MM inventory entry.semantic_fingerprint",
        )?,
        semantic_profile: string(
            member(object, "semantic_profile", "V3 N4MM inventory entry")?,
            "V3 N4MM inventory entry.semantic_profile",
        )?,
    })
}

fn role_pipeline_view(value: &Value) -> Result<ArchiveV3RolePipelineView, ArchiveViewError> {
    let object = object(value, "V3 RolePipeline inventory entry")?;
    let text = |key| string(member(object, key, "V3 RolePipeline inventory entry")?, key);
    Ok(ArchiveV3RolePipelineView {
        artifact_id: text("artifact_id")?,
        kind: text("kind")?,
        owner: text("owner")?,
        format_version: u32_value(
            member(object, "format_version", "V3 RolePipeline inventory entry")?,
            "format_version",
        )?,
        member_path: text("member_path")?,
        raw_sha256: text("raw_sha256")?,
        semantic_fingerprint: text("semantic_fingerprint")?,
        semantic_profile: text("semantic_profile")?,
    })
}

fn object<'a>(value: &'a Value, context: &str) -> Result<&'a Map<String, Value>, ArchiveViewError> {
    value
        .as_object()
        .ok_or_else(|| ArchiveViewError(format!("{context} must be an object")))
}

fn array<'a>(value: &'a Value, context: &str) -> Result<&'a Vec<Value>, ArchiveViewError> {
    value
        .as_array()
        .ok_or_else(|| ArchiveViewError(format!("{context} must be an array")))
}

fn member<'a>(
    object: &'a Map<String, Value>,
    key: &str,
    context: &str,
) -> Result<&'a Value, ArchiveViewError> {
    object
        .get(key)
        .ok_or_else(|| ArchiveViewError(format!("{context}.{key} is required")))
}

fn string(value: &Value, context: &str) -> Result<String, ArchiveViewError> {
    value
        .as_str()
        .map(ToOwned::to_owned)
        .ok_or_else(|| ArchiveViewError(format!("{context} must be a string")))
}

fn u32_value(value: &Value, context: &str) -> Result<u32, ArchiveViewError> {
    value
        .as_u64()
        .and_then(|value| u32::try_from(value).ok())
        .ok_or_else(|| ArchiveViewError(format!("{context} must be a u32")))
}

fn optional_bool(
    object: &Map<String, Value>,
    key: &str,
    context: &str,
) -> Result<Option<bool>, ArchiveViewError> {
    match object.get(key) {
        Some(value) => value
            .as_bool()
            .map(Some)
            .ok_or_else(|| ArchiveViewError(format!("{context}.{key} must be a boolean"))),
        None => Ok(None),
    }
}

#[cfg(test)]
mod tests {
    use serde_json::Value;

    use super::{archive_view_from_manifest, ArchiveReference, ArchiveReplayExecutionStatus};

    const PORTABLE_SPLIT_CONFORMAL: &str =
        include_str!("archive_v1_fixtures/positive/portable_split_conformal.json");

    fn reference() -> ArchiveReference {
        ArchiveReference {
            archive_id: "archive:portable-conformal".into(),
            schema_version: 1,
            profile: "nirs4all.archive_workspace.v1".into(),
            archive_sha256: "a".repeat(64),
            portable_predictor_member: "dagml/portable_predictor_package.json".into(),
        }
    }

    #[test]
    fn projects_identity_bound_conformal_and_replay_references_without_execution() {
        let manifest: Value = serde_json::from_str(PORTABLE_SPLIT_CONFORMAL).unwrap();
        let view = archive_view_from_manifest(&reference(), &manifest).unwrap();

        assert_eq!(
            view.conformal.as_ref().unwrap().member_path,
            "dagml/conformal.json"
        );
        assert_eq!(
            view.replay.execution_bundle.member_path,
            "dagml/execution_bundle.json"
        );
        assert_eq!(
            view.replay.execution_bundle.producer_port_required,
            Some(true)
        );
        assert_eq!(
            view.replay.execution_status,
            ArchiveReplayExecutionStatus::RequiresNativeArtifactExecutor
        );
        assert_eq!(
            view.robustness.as_ref().unwrap().member_path,
            "dagml/robustness.json"
        );
    }

    #[test]
    fn preserves_an_explicit_absent_calibration_reference() {
        let mut manifest: Value = serde_json::from_str(PORTABLE_SPLIT_CONFORMAL).unwrap();
        manifest["payloads"]["conformal"] = Value::Null;

        let view = archive_view_from_manifest(&reference(), &manifest).unwrap();
        assert_eq!(view.conformal, None);
    }

    #[test]
    fn refuses_malformed_persisted_reference_instead_of_inventing_a_view() {
        let mut manifest: Value = serde_json::from_str(PORTABLE_SPLIT_CONFORMAL).unwrap();
        manifest["payloads"]["conformal"]
            .as_object_mut()
            .unwrap()
            .remove("schema_id");

        let error = archive_view_from_manifest(&reference(), &manifest).unwrap_err();
        assert_eq!(
            error.to_string(),
            "archive view refusal: payload reference.schema_id is required"
        );
    }
}
