//! WASM projection over Core's canonical Archive V2 reader.
//!
//! The ZIP, manifest and inventory implementation is included from the exact
//! Core-owned Rust source used by the native binding. This crate adds only a
//! bounded Methods/DAG-ML projection and wasm-bindgen ownership glue; it is not
//! a second archive parser and contains no numerical code.

use std::{
    collections::BTreeSet,
    path::{Path, PathBuf},
};

use dag_ml_core::{
    ArtifactBackend, ArtifactLoadMode, FittedArtifactMode, OutputOrder, Phase,
    PortablePredictorPackage, PredictionKind, PredictionLevel,
};
use wasm_bindgen::prelude::*;

// The canonical module's V1/V3 dispatch types live at the aggregate root. They
// are unavailable in this deliberately small wasm32 crate, so these private
// placeholders satisfy only the uncalled dual-dispatch signatures. Archive V2
// byte validation below executes the same source and never touches them.
#[derive(Clone, Debug)]
pub struct ArchivePayload {
    pub path: String,
    pub bytes: Vec<u8>,
}

#[derive(Debug)]
pub enum ArchiveStoreError {
    Io(std::io::Error),
    Format(String),
    Integrity(String),
    UnsupportedCapability(String),
    AlreadyExists(PathBuf),
    PublishedWithCleanupError { path: PathBuf, detail: String },
}

impl std::fmt::Display for ArchiveStoreError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Io(error) => write!(formatter, "archive I/O error: {error}"),
            Self::Format(detail) => detail.fmt(formatter),
            Self::Integrity(detail) => detail.fmt(formatter),
            Self::UnsupportedCapability(detail) => detail.fmt(formatter),
            Self::AlreadyExists(path) => {
                write!(
                    formatter,
                    "archive target already exists: {}",
                    path.display()
                )
            }
            Self::PublishedWithCleanupError { path, detail } => write!(
                formatter,
                "archive was published at {} but cleanup failed: {detail}",
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

#[derive(Clone, Debug)]
pub struct LoadedArchiveV1;

#[derive(Clone, Debug)]
pub struct LoadedArchiveV3;

pub fn load_archive_v1(_path: &Path) -> Result<LoadedArchiveV1, ArchiveStoreError> {
    Err(ArchiveStoreError::UnsupportedCapability(
        "Archive V1 is not linked into the Archive V2 WASM validator".to_owned(),
    ))
}

pub fn load_archive_v3(_path: &Path) -> Result<LoadedArchiveV3, ArchiveStoreError> {
    Err(ArchiveStoreError::UnsupportedCapability(
        "Archive V3 is not linked into the Archive V2 WASM validator".to_owned(),
    ))
}

#[allow(dead_code, clippy::drop_non_drop)]
#[path = "../../rust/nirs4all/src/archive_v2.rs"]
mod core_archive_v2;

/// A fully validated, single-model Methods Archive V2 projection.
#[wasm_bindgen]
pub struct ValidatedMethodsArchiveV2 {
    archive_sha256: String,
    archive_id: String,
    package_json: String,
    model_bytes: Vec<u8>,
    artifact_id: String,
    binding_id: String,
    node_id: String,
    port_name: String,
    target_names_json: String,
    abi_min_minor: u32,
}

#[wasm_bindgen]
impl ValidatedMethodsArchiveV2 {
    /// Validate through Core before returning any package or model bytes.
    #[wasm_bindgen(constructor)]
    pub fn new(archive_bytes: &[u8]) -> Result<ValidatedMethodsArchiveV2, JsValue> {
        project_archive(archive_bytes)
            .map_err(|error| JsValue::from_str(&format!("Core Archive V2 refusal: {error}")))
    }

    #[wasm_bindgen(getter)]
    pub fn archive_sha256(&self) -> String {
        self.archive_sha256.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn archive_id(&self) -> String {
        self.archive_id.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn artifact_id(&self) -> String {
        self.artifact_id.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn binding_id(&self) -> String {
        self.binding_id.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn node_id(&self) -> String {
        self.node_id.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn port_name(&self) -> String {
        self.port_name.clone()
    }

    pub fn package_json(&self) -> String {
        self.package_json.clone()
    }

    pub fn model_bytes(&self) -> Vec<u8> {
        self.model_bytes.clone()
    }

    pub fn target_names_json(&self) -> String {
        self.target_names_json.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn abi_min_minor(&self) -> u32 {
        self.abi_min_minor
    }
}

fn project_archive(bytes: &[u8]) -> Result<ValidatedMethodsArchiveV2, String> {
    let archive =
        core_archive_v2::load_archive_v2_bytes(bytes).map_err(|error| error.to_string())?;
    validate_bounded_manifest(archive.manifest())?;
    let declarations = archive
        .methods_n4mm_artifacts()
        .map_err(|error| error.to_string())?;
    if declarations.len() != 1 {
        return refuse("bounded WASM replay requires exactly one N4MM artifact");
    }
    let declaration = &declarations[0];
    let package_bytes = archive
        .portable_predictor_package()
        .map_err(|error| error.to_string())?;
    let package_json = std::str::from_utf8(package_bytes)
        .map_err(|_| "portable predictor package is not UTF-8".to_owned())?
        .to_owned();
    let package = PortablePredictorPackage::from_json(&package_json)
        .map_err(|error| format!("DAG-ML rejected predictor package: {error}"))?;

    if package.schema_version != 2
        || package.fitted_artifact_mode != FittedArtifactMode::PortableRequired
        || package.predictor_node_ids.len() != 1
        || package.artifact_bindings.len() != 1
        || package.output_bindings.len() != 1
        || package.effective_plan.node_plans.len() != 1
        || package.execution_bundle.refit_artifacts.len() != 1
        || package.execution_bundle.raw_artifact_payloads.len() != 1
        || package.conformal_calibration.is_some()
        || package.conformal_calibration_replay.is_some()
        || package.execution_bundle.conformal_calibration.is_some()
    {
        return refuse("package is outside the bounded single-node Methods replay contract");
    }

    let node_id = &package.predictor_node_ids[0];
    let node = package
        .effective_plan
        .node_plans
        .get(node_id)
        .ok_or_else(|| "predictor node plan is absent".to_owned())?;
    if node.controller_id.as_str() != "controller:methods.pls"
        || !node.supported_phases.contains(&Phase::Predict)
    {
        return refuse("predictor node is not callback-free Methods PLS PREDICT");
    }

    let binding = &package.artifact_bindings[0];
    if binding.artifact_id.as_str() != declaration.artifact_id()
        || binding.load_mode != ArtifactLoadMode::NativePortable
    {
        return refuse("package artifact binding does not match portable N4MM");
    }

    let output = &package.output_bindings[0];
    let unique_target_names: BTreeSet<&str> =
        output.target_names.iter().map(String::as_str).collect();
    if output.node_id != *node_id
        || output.prediction_level != PredictionLevel::Sample
        || output.prediction_kind != PredictionKind::RegressionPoint
        || serde_json::to_value(output.prediction_source)
            .ok()
            .as_ref()
            .and_then(serde_json::Value::as_str)
            != Some("final_refit")
        || output.output_order != OutputOrder::TargetOrder
        || output.target_space != "raw"
        || output.target_names.is_empty()
        || output.target_names.len() > 256
        || unique_target_names.len() != output.target_names.len()
        || output
            .target_names
            .iter()
            .any(|name| name.is_empty() || name.len() > 128 || name.chars().any(char::is_control))
    {
        return refuse("output binding is outside multi-target regression replay");
    }

    let record = &package.execution_bundle.refit_artifacts[0];
    let artifact = &record.artifact;
    if record.node_id != *node_id
        || artifact.id != binding.artifact_id
        || artifact.id.as_str() != declaration.artifact_id()
        || artifact.kind != "n4m_model"
        || artifact.backend != Some(ArtifactBackend::Raw)
        || artifact.plugin.is_some()
        || artifact.plugin_version.is_some()
        || artifact.uri.as_deref() != Some(declaration.member_path())
    {
        return refuse("refit artifact does not cross-link the portable N4MM member");
    }
    let embedded = package
        .execution_bundle
        .raw_artifact_payloads
        .get(&artifact.id)
        .ok_or_else(|| "execution bundle lacks detached N4MM bytes".to_owned())?;
    let model_bytes = archive
        .member(declaration.member_path())
        .map_err(|error| error.to_string())?;
    if embedded.as_slice() != model_bytes {
        return refuse("DAG-ML N4MM bytes differ from the inventoried archive member");
    }

    let target_names_json = serde_json::to_string(&output.target_names)
        .map_err(|error| format!("cannot serialize target names: {error}"))?;
    Ok(ValidatedMethodsArchiveV2 {
        archive_sha256: archive.reference().archive_sha256().to_owned(),
        archive_id: archive.reference().archive_id().to_owned(),
        package_json,
        model_bytes: model_bytes.to_vec(),
        artifact_id: artifact.id.as_str().to_owned(),
        binding_id: output.binding_id.clone(),
        node_id: node_id.as_str().to_owned(),
        port_name: output.port_name.clone(),
        target_names_json,
        abi_min_minor: declaration.abi_min_minor(),
    })
}

fn validate_bounded_manifest(manifest: &serde_json::Value) -> Result<(), String> {
    let root = manifest
        .as_object()
        .ok_or_else(|| "manifest is not an object".to_owned())?;
    let payloads = root
        .get("payloads")
        .and_then(serde_json::Value::as_object)
        .ok_or_else(|| "manifest payloads are not an object".to_owned())?;
    let methods = payloads
        .get("methods")
        .and_then(serde_json::Value::as_object)
        .ok_or_else(|| "manifest Methods payloads are not an object".to_owned())?;
    let n4mm = methods
        .get("n4mm")
        .and_then(serde_json::Value::as_array)
        .ok_or_else(|| "manifest N4MM payloads are not an array".to_owned())?;
    let n4mopt = methods
        .get("n4mopt")
        .and_then(serde_json::Value::as_array)
        .ok_or_else(|| "manifest N4MOPT payloads are not an array".to_owned())?;
    let host_artifacts = payloads
        .get("host_artifacts")
        .and_then(serde_json::Value::as_array)
        .ok_or_else(|| "manifest host artifacts are not an array".to_owned())?;
    if n4mm.len() != 1 || !n4mopt.is_empty() {
        return refuse("bounded WASM replay requires one N4MM and no optimization payloads");
    }
    if !host_artifacts.is_empty()
        || ["n4d_aggregate_reference", "conformal", "robustness"]
            .iter()
            .any(|key| !payloads.get(*key).is_some_and(serde_json::Value::is_null))
    {
        return refuse(
            "bounded WASM replay refuses data, conformal, robustness and host-only payloads",
        );
    }
    let future_artifacts = root
        .get("replay")
        .and_then(serde_json::Value::as_object)
        .and_then(|replay| replay.get("future_artifacts"))
        .and_then(serde_json::Value::as_array)
        .ok_or_else(|| "manifest future artifacts are not an array".to_owned())?;
    if !future_artifacts.is_empty() {
        return refuse("bounded WASM replay refuses future artifact declarations");
    }
    Ok(())
}

fn refuse<T>(detail: &str) -> Result<T, String> {
    Err(detail.to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn bounded_manifest() -> serde_json::Value {
        json!({
            "payloads": {
                "methods": {"n4mm": [{}], "n4mopt": []},
                "n4d_aggregate_reference": null,
                "conformal": null,
                "robustness": null,
                "host_artifacts": []
            },
            "replay": {"future_artifacts": []}
        })
    }

    #[test]
    fn bounded_manifest_accepts_only_the_single_n4mm_projection() {
        validate_bounded_manifest(&bounded_manifest()).unwrap();
    }

    #[test]
    fn bounded_manifest_refuses_every_unconsumed_payload_class() {
        for path in ["n4mopt", "host_artifacts", "conformal", "robustness"] {
            let mut manifest = bounded_manifest();
            match path {
                "n4mopt" => manifest["payloads"]["methods"]["n4mopt"] = json!([{}]),
                "host_artifacts" => manifest["payloads"]["host_artifacts"] = json!([{}]),
                _ => manifest["payloads"][path] = json!({}),
            }
            assert!(validate_bounded_manifest(&manifest).is_err(), "{path}");
        }
        let mut data = bounded_manifest();
        data["payloads"]["n4d_aggregate_reference"] = json!({});
        assert!(validate_bounded_manifest(&data).is_err());
        let mut future = bounded_manifest();
        future["replay"]["future_artifacts"] = json!([{}]);
        assert!(validate_bounded_manifest(&future).is_err());
    }
}
