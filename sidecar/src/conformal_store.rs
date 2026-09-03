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
use nirs4all::dag_ml::{ConformalPresentationV1, ConformalPresentationV2};

const PRESENTATIONS_V1_DIRECTORY: &str = "conformal-presentations-v1";
const PRESENTATIONS_V2_DIRECTORY: &str = "conformal-presentations-v2";
const PRESENTATION_EXTENSION: &str = "json";
const MAX_PRESENTATION_BYTES: u64 = 2 * 1024 * 1024;

/// A content-addressed, native sidecar store for validated DAG-ML conformal
/// presentations.
#[derive(Debug, Clone)]
pub struct ConformalPresentationStore {
    root_v1: PathBuf,
    root_v2: PathBuf,
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
        let config_dir = config_dir.into();
        Self {
            root_v1: config_dir.join(PRESENTATIONS_V1_DIRECTORY),
            root_v2: config_dir.join(PRESENTATIONS_V2_DIRECTORY),
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
        Self::write(
            &self.root_v1,
            &presentation.presentation_fingerprint,
            &encoded,
        )
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
        let path = Self::path_for(&self.root_v1, fingerprint);
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
        &self.root_v1
    }

    /// Persist an already-produced Core/DAG-ML V2 projection. This standalone
    /// gate verifies its TCV1 fingerprint, dimensions, ordered identities and
    /// interval/guarantee closure. Archive/package binding is revalidated by
    /// Core whenever the HTTP read surface loads it.
    ///
    /// # Errors
    ///
    /// Returns an error when DAG-ML rejects the projection, it exceeds the
    /// size bound, or the atomic store write fails.
    pub fn store_v2(
        &self,
        presentation: &ConformalPresentationV2,
    ) -> Result<(), ConformalPresentationStoreError> {
        presentation.validate().map_err(|error| {
            ConformalPresentationStoreError::InvalidPresentation(format!(
                "refusing invalid DAG-ML conformal presentation V2: {error}"
            ))
        })?;
        let encoded = serde_json::to_vec_pretty(presentation).map_err(|error| {
            ConformalPresentationStoreError::Storage(format!(
                "could not encode conformal presentation V2: {error}"
            ))
        })?;
        if u64::try_from(encoded.len()).unwrap_or(u64::MAX) > MAX_PRESENTATION_BYTES {
            return Err(ConformalPresentationStoreError::Storage(
                "conformal presentation V2 exceeds the native store size limit".into(),
            ));
        }
        Self::write(
            &self.root_v2,
            &presentation.presentation_fingerprint,
            &encoded,
        )
    }

    /// Re-read the exact V2 JSON after standalone DAG-ML validation. The
    /// caller must pass these bytes to Core together with the registered
    /// Archive V2 before presenting them to the renderer.
    ///
    /// # Errors
    ///
    /// Returns an error for an invalid key, missing or unsafe artifact, size
    /// overflow, or any DAG-ML validation/fingerprint failure.
    pub fn load_v2_json(
        &self,
        fingerprint: &str,
    ) -> Result<String, ConformalPresentationStoreError> {
        validate_fingerprint(fingerprint)?;
        let path = Self::path_for(&self.root_v2, fingerprint);
        let metadata = fs::symlink_metadata(&path).map_err(|error| {
            if error.kind() == std::io::ErrorKind::NotFound {
                ConformalPresentationStoreError::NotFound(fingerprint.to_owned())
            } else {
                ConformalPresentationStoreError::Storage(format!(
                    "could not inspect conformal presentation {}: {error}",
                    path.display()
                ))
            }
        })?;
        if metadata.file_type().is_symlink()
            || !metadata.is_file()
            || metadata.len() > MAX_PRESENTATION_BYTES
        {
            return Err(ConformalPresentationStoreError::Storage(format!(
                "stored conformal presentation {} is not a bounded regular file",
                path.display()
            )));
        }
        let raw = fs::read_to_string(&path).map_err(|error| {
            ConformalPresentationStoreError::Storage(format!(
                "could not read conformal presentation {}: {error}",
                path.display()
            ))
        })?;
        let presentation = ConformalPresentationV2::from_json(&raw).map_err(|error| {
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
        Ok(raw)
    }

    fn write(
        root: &Path,
        fingerprint: &str,
        encoded: &[u8],
    ) -> Result<(), ConformalPresentationStoreError> {
        validate_fingerprint(fingerprint)?;
        fs::create_dir_all(root).map_err(|error| {
            ConformalPresentationStoreError::Storage(format!(
                "could not create conformal presentation store {}: {error}",
                root.display()
            ))
        })?;
        let path = Self::path_for(root, fingerprint);
        AtomicFile::new(&path, AllowOverwrite)
            .write(|file| file.write_all(encoded).and_then(|()| file.write_all(b"\n")))
            .map_err(|error| {
                ConformalPresentationStoreError::Storage(format!(
                    "could not atomically write conformal presentation {}: {error}",
                    path.display()
                ))
            })
    }

    fn path_for(root: &Path, fingerprint: &str) -> PathBuf {
        root.join(fingerprint)
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
pub(crate) mod tests {
    use std::{
        env, fs,
        path::PathBuf,
        time::{SystemTime, UNIX_EPOCH},
    };

    use nirs4all::dag_ml::{
        ConformalCalibration, ConformalCalibrationCohort, ConformalCalibrationContext,
        ConformalCalibrationTruth, ConformalMultiTargetPolicy, ConformalPresentationDimensionsV2,
        ConformalPresentationGuaranteeV2, ConformalPresentationInterval,
        ConformalPresentationPredictorV2, ConformalPresentationV2, ConformalSmallSamplePolicy,
        NodeId, PredictionBlock, PredictionPartition, SampleId,
        CONFORMAL_PRESENTATION_SCHEMA_VERSION_V2,
    };

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

    #[allow(clippy::too_many_lines)]
    pub fn presentation_v2(archive_sha256: &str) -> ConformalPresentationV2 {
        let calibration_ids = [
            "calibration:one",
            "calibration:two",
            "calibration:three",
            "calibration:four",
        ]
        .into_iter()
        .map(|id| SampleId::new(id).unwrap())
        .collect::<Vec<_>>();
        let target_names = vec!["protein".to_string(), "moisture".to_string()];
        let calibration_predictions = PredictionBlock {
            prediction_id: Some("prediction:calibration".into()),
            producer_node: NodeId::new("model:regressor").unwrap(),
            producer_port: Some("prediction".into()),
            partition: PredictionPartition::Validation,
            fold_id: None,
            sample_ids: calibration_ids.clone(),
            values: vec![
                vec![1.0, 10.0],
                vec![2.0, 20.0],
                vec![3.0, 30.0],
                vec![4.0, 40.0],
            ],
            target_names: target_names.clone(),
        };
        let truth = ConformalCalibrationTruth {
            sample_ids: calibration_ids.clone(),
            values: vec![
                vec![0.5, 9.0],
                vec![1.0, 18.0],
                vec![1.5, 27.0],
                vec![2.0, 36.0],
            ],
        };
        let mut cohort = ConformalCalibrationCohort {
            role: "calibration".into(),
            physical_sample_ids: calibration_ids.clone(),
            origin_sample_ids: calibration_ids,
            target_names: target_names.clone(),
            manifest_fingerprint: String::new(),
        };
        cohort.manifest_fingerprint = cohort.compute_fingerprint().unwrap();
        let mut context = ConformalCalibrationContext {
            predictor_binding_fingerprint: "5".repeat(64),
            source_training_outcome_fingerprint: "8".repeat(64),
            calibration_replay_outcome_fingerprint: "9".repeat(64),
            data_identities_fingerprint: "a".repeat(64),
            fold_set_fingerprint: "b".repeat(64),
            training_influence_fingerprint: "c".repeat(64),
            relation_fingerprint: "d".repeat(64),
            calibration_cohort: cohort,
            context_fingerprint: String::new(),
        };
        context.context_fingerprint = context.compute_fingerprint().unwrap();
        let calibration = ConformalCalibration::calibrate_with_truth(
            "output:main",
            target_names.clone(),
            &calibration_predictions,
            &truth,
            context,
            vec![0.8],
            ConformalMultiTargetPolicy::Marginal,
            ConformalSmallSamplePolicy::Error,
        )
        .unwrap();
        let point_prediction = PredictionBlock {
            prediction_id: Some("prediction:production".into()),
            producer_node: NodeId::new("model:regressor").unwrap(),
            producer_port: Some("prediction".into()),
            partition: PredictionPartition::Final,
            fold_id: None,
            sample_ids: vec![
                SampleId::new("sample:two").unwrap(),
                SampleId::new("sample:one").unwrap(),
            ],
            values: vec![vec![10.0, 100.0], vec![20.0, 200.0]],
            target_names: target_names.clone(),
        };
        let interval_block = calibration.apply(&point_prediction).unwrap();
        let mut presentation = ConformalPresentationV2 {
            schema_version: CONFORMAL_PRESENTATION_SCHEMA_VERSION_V2,
            archive_sha256: archive_sha256.to_string(),
            package_fingerprint: "2".repeat(64),
            replay_outcome_fingerprint: "3".repeat(64),
            binding_id: "output:main".into(),
            predictor: ConformalPresentationPredictorV2 {
                model_artifact_fingerprint: "4".repeat(64),
                predictor_binding_fingerprint: "5".repeat(64),
                predictor_descriptor_fingerprint: "6".repeat(64),
            },
            dimensions: ConformalPresentationDimensionsV2 {
                sample_count: 2,
                target_count: 2,
            },
            target_names,
            sample_ids: point_prediction.sample_ids.clone(),
            point_prediction,
            interval_block,
            guarantee: ConformalPresentationGuaranteeV2 {
                calibration_sample_count: 4,
                multi_target_policy: calibration.multi_target_policy,
                small_sample_policy: calibration.small_sample_policy,
                quantiles: calibration.quantiles.clone(),
            },
            calibration_fingerprint: calibration.calibration_fingerprint,
            presentation_fingerprint: "0".repeat(64),
        };
        presentation.presentation_fingerprint = presentation.compute_fingerprint().unwrap();
        presentation.validate().unwrap();
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

    #[test]
    fn stores_and_reloads_ordered_multitarget_v2_and_refuses_tampering() {
        let directory = temporary_directory("conformal-v2");
        let store = ConformalPresentationStore::new(&directory);
        let expected = presentation_v2(&"1".repeat(64));

        store.store_v2(&expected).unwrap();
        let loaded = ConformalPresentationV2::from_json(
            &store
                .load_v2_json(&expected.presentation_fingerprint)
                .unwrap(),
        )
        .unwrap();
        assert_eq!(loaded.target_names, vec!["protein", "moisture"]);
        assert_eq!(loaded.sample_ids[0].as_str(), "sample:two");

        let path = store
            .root_v2
            .join(format!("{}.json", expected.presentation_fingerprint));
        let tampered = fs::read_to_string(&path)
            .unwrap()
            .replace("sample:two", "sample:changed");
        fs::write(path, tampered).unwrap();
        assert!(matches!(
            store.load_v2_json(&expected.presentation_fingerprint),
            Err(ConformalPresentationStoreError::InvalidPresentation(_))
        ));
        fs::remove_dir_all(directory).unwrap();
    }
}
