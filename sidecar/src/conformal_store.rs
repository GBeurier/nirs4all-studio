//! Native persistence for already-computed conformal presentations.
//!
//! The Core/DAG-ML contract owns conformal calibration and interval math. This
//! store accepts only its self-validating presentation projection, so the
//! Studio process can retain and later render it without recomputing bounds or
//! accepting a caller-selected path.

use std::{
    fmt, fs,
    io::Write,
    path::{Path, PathBuf},
};

use atomicwrites::{AllowOverwrite, AtomicFile};
use nirs4all::dag_ml::ConformalPresentationV1;

const PRESENTATIONS_DIRECTORY: &str = "conformal-presentations-v1";
const PRESENTATION_EXTENSION: &str = "json";

/// A content-addressed, native sidecar store for validated DAG-ML conformal
/// presentations.
#[derive(Debug, Clone)]
pub struct ConformalPresentationStore {
    root: PathBuf,
}

/// Errors at the Studio persistence boundary. Invalid DAG-ML data is never
/// silently downgraded to an empty or partially rendered result.
#[derive(Debug, Clone, Eq, PartialEq)]
pub enum ConformalPresentationStoreError {
    InvalidPresentation(String),
    NotFound(String),
    Storage(String),
}

impl fmt::Display for ConformalPresentationStoreError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidPresentation(message) | Self::Storage(message) => {
                formatter.write_str(message)
            }
            Self::NotFound(fingerprint) => {
                write!(
                    formatter,
                    "conformal presentation {fingerprint} was not found"
                )
            }
        }
    }
}

impl std::error::Error for ConformalPresentationStoreError {}

impl ConformalPresentationStore {
    /// Store artifacts below a product-selected configuration directory.
    #[must_use]
    pub fn new(config_dir: impl Into<PathBuf>) -> Self {
        Self {
            root: config_dir.into().join(PRESENTATIONS_DIRECTORY),
        }
    }

    /// Persist a Core-produced presentation only after its DAG-ML provenance,
    /// cardinality, interval closure and self-fingerprint have been checked.
    ///
    /// # Errors
    ///
    /// Returns an error when DAG-ML rejects the presentation or the native
    /// store cannot create or atomically write its immutable artifact.
    pub fn store(
        &self,
        presentation: &ConformalPresentationV1,
    ) -> Result<(), ConformalPresentationStoreError> {
        presentation.validate().map_err(|error| {
            ConformalPresentationStoreError::InvalidPresentation(format!(
                "refusing invalid DAG-ML conformal presentation: {error}"
            ))
        })?;
        let encoded = serde_json::to_vec_pretty(presentation).map_err(|error| {
            ConformalPresentationStoreError::Storage(format!(
                "could not encode conformal presentation: {error}"
            ))
        })?;
        self.write(&presentation.presentation_fingerprint, &encoded)
    }

    /// Parse and persist the exact native wire format. This is deliberately
    /// not an HTTP handler: a future execution route must first obtain this
    /// value from the typed Core replay boundary.
    ///
    /// # Errors
    ///
    /// Returns an error when the bytes are not a valid self-fingerprinted
    /// DAG-ML presentation or persistence fails.
    pub fn store_json(
        &self,
        json: &str,
    ) -> Result<ConformalPresentationV1, ConformalPresentationStoreError> {
        let presentation = ConformalPresentationV1::from_json(json).map_err(|error| {
            ConformalPresentationStoreError::InvalidPresentation(format!(
                "refusing invalid DAG-ML conformal presentation: {error}"
            ))
        })?;
        self.store(&presentation)?;
        Ok(presentation)
    }

    /// Re-read an artifact by its immutable presentation fingerprint. Both the
    /// caller key and the persisted bytes are checked, preventing a renamed or
    /// tampered file from being rendered as a valid result.
    ///
    /// # Errors
    ///
    /// Returns an error for an invalid key, a missing or unreadable artifact,
    /// or data that does not validate under the published DAG-ML contract.
    pub fn load(
        &self,
        fingerprint: &str,
    ) -> Result<ConformalPresentationV1, ConformalPresentationStoreError> {
        validate_fingerprint(fingerprint)?;
        let path = self.path_for(fingerprint);
        let raw = fs::read_to_string(&path).map_err(|error| {
            if error.kind() == std::io::ErrorKind::NotFound {
                ConformalPresentationStoreError::NotFound(fingerprint.to_owned())
            } else {
                ConformalPresentationStoreError::Storage(format!(
                    "could not read conformal presentation {}: {error}",
                    path.display()
                ))
            }
        })?;
        let presentation = ConformalPresentationV1::from_json(&raw).map_err(|error| {
            ConformalPresentationStoreError::InvalidPresentation(format!(
                "stored conformal presentation {} is invalid: {error}",
                path.display()
            ))
        })?;
        if presentation.presentation_fingerprint != fingerprint {
            return Err(ConformalPresentationStoreError::InvalidPresentation(format!(
                "stored conformal presentation fingerprint does not match requested key {fingerprint}"
            )));
        }
        Ok(presentation)
    }

    #[must_use]
    pub fn root(&self) -> &Path {
        &self.root
    }

    fn write(
        &self,
        fingerprint: &str,
        encoded: &[u8],
    ) -> Result<(), ConformalPresentationStoreError> {
        validate_fingerprint(fingerprint)?;
        fs::create_dir_all(&self.root).map_err(|error| {
            ConformalPresentationStoreError::Storage(format!(
                "could not create conformal presentation store {}: {error}",
                self.root.display()
            ))
        })?;
        let path = self.path_for(fingerprint);
        AtomicFile::new(&path, AllowOverwrite)
            .write(|file| file.write_all(encoded).and_then(|()| file.write_all(b"\n")))
            .map_err(|error| {
                ConformalPresentationStoreError::Storage(format!(
                    "could not atomically write conformal presentation {}: {error}",
                    path.display()
                ))
            })
    }

    fn path_for(&self, fingerprint: &str) -> PathBuf {
        self.root
            .join(fingerprint)
            .with_extension(PRESENTATION_EXTENSION)
    }
}

fn validate_fingerprint(fingerprint: &str) -> Result<(), ConformalPresentationStoreError> {
    if fingerprint.len() == 64
        && fingerprint
            .bytes()
            .all(|byte| byte.is_ascii_digit() || matches!(byte, b'a'..=b'f'))
    {
        return Ok(());
    }
    Err(ConformalPresentationStoreError::InvalidPresentation(
        "conformal presentation fingerprint must be a lowercase SHA-256 hex digest".into(),
    ))
}

#[cfg(test)]
mod tests {
    use std::{
        env, fs,
        path::PathBuf,
        time::{SystemTime, UNIX_EPOCH},
    };

    use nirs4all::dag_ml::{ConformalPresentationInterval, SampleId};

    use super::{ConformalPresentationStore, ConformalPresentationStoreError};

    fn temporary_directory(name: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock precedes Unix epoch")
            .as_nanos();
        let path = env::temp_dir().join(format!(
            "studio-sidecar-{name}-{}-{nonce}",
            std::process::id()
        ));
        fs::create_dir_all(&path).expect("could not create temporary store directory");
        path
    }

    fn presentation() -> nirs4all::dag_ml::ConformalPresentationV1 {
        let mut presentation = nirs4all::dag_ml::ConformalPresentationV1 {
            schema_version: 1,
            package_fingerprint: "a".repeat(64),
            replay_outcome_fingerprint: "b".repeat(64),
            binding_id: "model:pls".into(),
            target_name: "moisture".into(),
            sample_ids: vec![
                SampleId::new("sample:one").unwrap(),
                SampleId::new("sample:two").unwrap(),
            ],
            point_predictions: vec![1.0, 2.0],
            intervals: vec![ConformalPresentationInterval {
                coverage: 0.95,
                lower: vec![Some(0.5), Some(1.5)],
                upper: vec![Some(1.5), Some(2.5)],
                qhat: Some(0.5),
            }],
            calibration_fingerprint: "c".repeat(64),
            presentation_fingerprint: String::new(),
        };
        presentation.presentation_fingerprint = presentation.compute_fingerprint().unwrap();
        presentation
    }

    #[test]
    fn stores_and_reloads_a_core_compatible_presentation_by_fingerprint() {
        let directory = temporary_directory("conformal-store");
        let store = ConformalPresentationStore::new(&directory);
        let expected = presentation();

        store.store(&expected).unwrap();
        let loaded = store.load(&expected.presentation_fingerprint).unwrap();

        assert_eq!(loaded, expected);
        assert!(store
            .root()
            .join(format!("{}.json", expected.presentation_fingerprint))
            .is_file());
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn rejects_tampered_or_renamed_presentations_before_returning_them() {
        let directory = temporary_directory("conformal-tamper");
        let store = ConformalPresentationStore::new(&directory);
        let expected = presentation();
        store.store(&expected).unwrap();

        let path = store
            .root()
            .join(format!("{}.json", expected.presentation_fingerprint));
        let tampered = fs::read_to_string(&path)
            .unwrap()
            .replace("\"qhat\": 0.5", "\"qhat\": 0.75");
        fs::write(&path, tampered).unwrap();

        assert!(matches!(
            store.load(&expected.presentation_fingerprint),
            Err(ConformalPresentationStoreError::InvalidPresentation(_))
        ));
        assert!(matches!(
            store.load("../not-a-presentation"),
            Err(ConformalPresentationStoreError::InvalidPresentation(_))
        ));
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn parses_the_native_contract_before_writing_any_artifact() {
        let directory = temporary_directory("conformal-json");
        let store = ConformalPresentationStore::new(&directory);
        let expected = presentation();
        let json = serde_json::to_string(&expected).unwrap();

        let stored = store.store_json(&json).unwrap();
        assert_eq!(stored, expected);
        assert!(matches!(
            store.store_json("{\"schema_version\":1}"),
            Err(ConformalPresentationStoreError::InvalidPresentation(_))
        ));
        fs::remove_dir_all(directory).unwrap();
    }
}
