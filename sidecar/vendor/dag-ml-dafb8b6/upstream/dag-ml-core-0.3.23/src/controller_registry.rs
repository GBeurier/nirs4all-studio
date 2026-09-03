//! Loader for declarative `*.controller.yaml` registries.
//!
//! The JSON-encoded `ControllerManifest` (validated by
//! `docs/contracts/controller_manifest.schema.json`) remains the wire
//! contract; YAML is a human-friendly *authoring* format that
//! deserializes into the same Rust type via serde. A directory of
//! YAML files becomes a vector of `ControllerManifest`s ready for
//! the scheduler's existing `validate()` path.

use std::fs;
use std::path::{Path, PathBuf};

use crate::controller::ControllerManifest;
use crate::error::{DagMlError, Result};

const YAML_EXTENSION: &str = "yaml";
const YAML_DOTTED_SUFFIX: &str = ".controller.yaml";

/// Parse a single YAML manifest from raw text. The same `ControllerManifest`
/// deserializer is reused so YAML and JSON cannot drift on field shape.
pub fn parse_yaml_manifest(text: &str) -> Result<ControllerManifest> {
    let manifest: ControllerManifest = yaml_serde::from_str(text).map_err(|error| {
        DagMlError::ControllerValidation(format!("controller manifest YAML parse failed: {error}"))
    })?;
    manifest.validate()?;
    Ok(manifest)
}

/// Load and validate a single manifest from disk.
pub fn load_yaml_manifest_from_path(path: impl AsRef<Path>) -> Result<ControllerManifest> {
    let path = path.as_ref();
    let text = fs::read_to_string(path).map_err(|error| {
        DagMlError::ControllerValidation(format!(
            "failed to read controller manifest `{}`: {error}",
            path.display()
        ))
    })?;
    parse_yaml_manifest(&text).map_err(|error| {
        if let DagMlError::ControllerValidation(message) = error {
            DagMlError::ControllerValidation(format!("{}: {message}", path.display()))
        } else {
            error
        }
    })
}

/// Walk a directory for `*.controller.yaml` files and return a
/// deterministically ordered, validated manifest list. Duplicate
/// `controller_id`s across files are rejected so a directory cannot
/// silently ship two definitions of the same controller.
pub fn load_yaml_manifests_from_dir(dir: impl AsRef<Path>) -> Result<Vec<ControllerManifest>> {
    let dir = dir.as_ref();
    if !dir.is_dir() {
        return Err(DagMlError::ControllerValidation(format!(
            "controller registry directory `{}` is not a directory",
            dir.display()
        )));
    }
    let mut paths: Vec<PathBuf> = fs::read_dir(dir)
        .map_err(|error| {
            DagMlError::ControllerValidation(format!(
                "failed to read controller registry dir `{}`: {error}",
                dir.display()
            ))
        })?
        .filter_map(std::result::Result::ok)
        .map(|entry| entry.path())
        .filter(|path| {
            // Lowercase comparison so case-preserving filesystems (HFS+,
            // APFS case-insensitive mode, NTFS) still recognise files
            // like `Sklearn.Controller.YAML` rather than silently
            // skipping them. The on-disk display is preserved; only the
            // matcher is normalised.
            path.is_file()
                && path
                    .extension()
                    .and_then(|ext| ext.to_str())
                    .map(str::to_ascii_lowercase)
                    .as_deref()
                    == Some(YAML_EXTENSION)
                && path
                    .file_name()
                    .and_then(|name| name.to_str())
                    .map(str::to_ascii_lowercase)
                    .is_some_and(|name| name.ends_with(YAML_DOTTED_SUFFIX))
        })
        .collect();
    paths.sort();

    let mut manifests = Vec::with_capacity(paths.len());
    let mut seen_controller_ids = std::collections::BTreeSet::<String>::new();
    for path in paths {
        let manifest = load_yaml_manifest_from_path(&path)?;
        let controller_id = manifest.controller_id.as_str().to_string();
        if !seen_controller_ids.insert(controller_id.clone()) {
            return Err(DagMlError::ControllerValidation(format!(
                "duplicate controller_id `{}` in registry dir `{}`",
                controller_id,
                dir.display()
            )));
        }
        manifests.push(manifest);
    }
    Ok(manifests)
}

#[cfg(test)]
mod tests {
    use super::*;

    const SKLEARN_MANIFEST_YAML: &str = r#"
controller_id: "controller:sklearn.production"
controller_version: "1.0.0"
operator_kind: model
priority: 20
supported_phases:
  - FIT_CV
  - REFIT
  - PREDICT
input_ports:
  - name: x
    kind: data
    representation: tabular_numeric
    cardinality: one
    description: "feature matrix"
output_ports:
  - name: y_hat
    kind: prediction
    representation: null
    cardinality: one
    description: "model predictions"
data_requirements: null
capabilities:
  - deterministic
  - thread_safe
  - process_safe
  - uses_core_rng
  - emits_predictions
  - emits_artifacts
  - stateful
operator_selectors:
  - aliases:
      - Ridge
      - StandardScaler
fit_scope: fold_train
rng_policy: uses_core_seed
artifact_policy: serializable
"#;

    #[test]
    fn parses_minimal_yaml_manifest() {
        let manifest = parse_yaml_manifest(SKLEARN_MANIFEST_YAML).expect("yaml parses");
        assert_eq!(
            manifest.controller_id.as_str(),
            "controller:sklearn.production"
        );
        assert_eq!(manifest.controller_version, "1.0.0");
    }

    #[test]
    fn refuses_invalid_yaml() {
        let err = parse_yaml_manifest("not: [valid: yaml").unwrap_err();
        match err {
            DagMlError::ControllerValidation(_) => {}
            other => panic!("expected ControllerValidation, got {other:?}"),
        }
    }

    #[test]
    fn refuses_yaml_that_validates_to_an_inconsistent_manifest() {
        let bad = r#"
controller_id: "controller:bad"
controller_version: ""
operator_kind: model
supported_phases: [FIT_CV]
input_ports: []
output_ports: []
data_requirements: null
capabilities: []
operator_selectors: []
fit_scope: fold_train
rng_policy: uses_core_seed
artifact_policy: serializable
"#;
        let err = parse_yaml_manifest(bad).unwrap_err();
        match err {
            DagMlError::ControllerValidation(message) => {
                assert!(
                    message.contains("empty version"),
                    "unexpected message: {message}"
                );
            }
            other => panic!("expected ControllerValidation, got {other:?}"),
        }
    }

    #[test]
    fn loads_directory_in_deterministic_order() {
        let temp_dir = std::env::temp_dir().join(format!(
            "dag_ml_core_controller_yaml_{}_{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("system clock is after UNIX_EPOCH")
                .as_nanos()
        ));
        std::fs::create_dir(&temp_dir).expect("create tempdir");
        let path = temp_dir.join("sklearn.controller.yaml");
        std::fs::write(&path, SKLEARN_MANIFEST_YAML).expect("write yaml");
        let manifests = load_yaml_manifests_from_dir(&temp_dir).expect("load dir");
        assert_eq!(manifests.len(), 1);
        assert_eq!(
            manifests[0].controller_id.as_str(),
            "controller:sklearn.production"
        );
        std::fs::remove_dir_all(&temp_dir).expect("cleanup tempdir");
    }

    #[test]
    fn rejects_duplicate_controller_ids() {
        let temp_dir = std::env::temp_dir().join(format!(
            "dag_ml_core_controller_yaml_dup_{}_{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("system clock is after UNIX_EPOCH")
                .as_nanos()
        ));
        std::fs::create_dir(&temp_dir).expect("create tempdir");
        std::fs::write(temp_dir.join("a.controller.yaml"), SKLEARN_MANIFEST_YAML).expect("write a");
        std::fs::write(temp_dir.join("b.controller.yaml"), SKLEARN_MANIFEST_YAML).expect("write b");
        let err = load_yaml_manifests_from_dir(&temp_dir).unwrap_err();
        match err {
            DagMlError::ControllerValidation(message) => {
                assert!(message.contains("duplicate"), "unexpected: {message}");
            }
            other => panic!("expected ControllerValidation, got {other:?}"),
        }
        std::fs::remove_dir_all(&temp_dir).expect("cleanup tempdir");
    }

    #[test]
    fn skips_files_that_are_not_controller_yaml() {
        let temp_dir = std::env::temp_dir().join(format!(
            "dag_ml_core_controller_yaml_skip_{}_{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("system clock is after UNIX_EPOCH")
                .as_nanos()
        ));
        std::fs::create_dir(&temp_dir).expect("create tempdir");
        std::fs::write(temp_dir.join("README.md"), "not a manifest").expect("write readme");
        std::fs::write(temp_dir.join("config.yaml"), "key: value").expect("write config");
        std::fs::write(
            temp_dir.join("sklearn.controller.yaml"),
            SKLEARN_MANIFEST_YAML,
        )
        .expect("write yaml");
        let manifests = load_yaml_manifests_from_dir(&temp_dir).expect("load dir");
        assert_eq!(
            manifests.len(),
            1,
            "non-`.controller.yaml` files must be ignored"
        );
        std::fs::remove_dir_all(&temp_dir).expect("cleanup tempdir");
    }
}
