// SPDX-License-Identifier: CeCILL-2.1 OR AGPL-3.0-or-later
//! `to_dag_ml_data`: build a dag-ml-data `CoordinatorDataPlanEnvelope` from a
//! nirs4all-io [`AssembledDataset`] (EPIC 10, D-R8, ADR-0001).
//!
//! io owns the assembled → envelope bridge. It maps the `AssembledDataset` onto a
//! `DatasetSchema` (+ `SourceDescriptor`/`RepresentationSpec`/`AxisSpec`;
//! nm→`Wavelength`, cm⁻¹→`Frequency`; signal_type→`tags`), a minimal `DataPlan`,
//! and a `SampleRelationTable` (explicit observation/sample/group/repetition
//! identity). Fold preflight rejects shared sample ids and, when declared,
//! shared groups across train/validation; repetition is provenance, not the
//! sole leakage unit. It then calls
//! `CoordinatorDataPlanEnvelope::from_parts` (it computes the three fingerprints
//! and self-validates). io does **not** build dag-ml `FoldSet`/`DataBinding` —
//! those are dag-ml's domain (folds/campaigns).
//!
//! This bridge resolves `dag-ml-data` from crates.io by default. The cross-CLI
//! conformance harness patches Cargo to the sibling checkout when it is present.
//! It remains a separate `publish = false` crate so the published `nirs4all-io`
//! CLI does not grow a hard dag-ml-data dependency.

use std::collections::{BTreeMap, BTreeSet};

use dag_ml_data::{
    sample_metadata, signal_1d, signal_with_processings, target_categorical,
    target_categorical_matrix, target_numeric, target_numeric_matrix, AxisKind, AxisSpec,
    CoordinateDType, CoordinateSpec, CoordinateValues, CoordinatorDataHandleRecord,
    CoordinatorDataMaterializationRequest, CoordinatorDataPlanEnvelope, CoordinatorDataViewRecord,
    CoordinatorFeatureBlock, CoordinatorRelationSet, CoordinatorTargetBlock,
    CoordinatorTargetTable, CoordinatorTargetValue, DataPlan, DataPlanStep, DataPlanStepKind,
    DataView, DatasetSchema, FitScope, FoldSpec, GroupId, GroupKind, GroupSpec, MetadataFieldSpec,
    MetadataSchema, MetadataValueKind, NumericFeatureBufferStore, NumericFeatureMatrixF64,
    ObservationId, RepetitionId, RepresentationId, RepresentationSpec, SampleId, SampleRelation,
    SampleRelationTable, SignalKind, SourceDescriptor, SourceGranularity, SourceId, TargetId,
    REPRESENTATION_FEATURE_BLOCK_SET, REPRESENTATION_SAMPLE_METADATA,
};
use dag_ml_data_provider::{DagMlDataProvider, InMemoryProvider};
use nirs4all_io::core::infer::{ColDtype, NumericKind};
pub use nirs4all_io::core::materialize::package::DatasetPackage;
use nirs4all_io::core::materialize::package::PayloadBlock;
use nirs4all_io::core::spec::SpecError;
use nirs4all_io::materialize::{AssembledDataset, Cell, PartitionBlock};
use serde_json::Value;
use sha2::{Digest, Sha256};

fn err<E: std::fmt::Display>(e: E) -> SpecError {
    SpecError::new(e.to_string())
}

/// Canonical X-only identity used by the target-free native Methods PLS
/// PREDICT provider. This is shared with DAG-ML and the public Python facade.
pub const METHODS_PLS_PREDICT_CONTENT_PROFILE: &str = "n4a-matrix-f64-le.v1";

/// Coerce an arbitrary label into a dag-ml-data identifier (ASCII alnum / `_-.`,
/// 1..=128 bytes). Unsupported characters collapse to `_`; an all-`_` or empty
/// result falls back to `fallback`.
fn sanitize(raw: &str, fallback: &str) -> String {
    let mut s: String = raw
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '.') {
                c
            } else {
                '_'
            }
        })
        .collect();
    if s.trim_matches('_').is_empty() {
        s = fallback.to_string();
    }
    if s.len() > 128 {
        s.truncate(128);
    }
    s
}

/// Preflight failures that indicate the assembled v1 IR cannot represent the
/// requested scientific identity in a dag-ml envelope without inventing data.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DagMlPreflightError {
    MissingSampleId,
    MissingIdentityColumn {
        column: String,
        partition: String,
    },
    UnalignedIdentityColumn {
        column: String,
        partition: String,
    },
    EmptyIdentityValue {
        column: String,
        partition: String,
        row: usize,
    },
    InvalidIdentifier {
        kind: &'static str,
        value: String,
    },
    DuplicateObservationId {
        observation_id: String,
    },
    RepeatedSampleNeedsObservationId {
        sample_id: String,
    },
    UnalignedWeights {
        partition: String,
    },
    NonFiniteWeight {
        partition: String,
        row: usize,
    },
    FoldIndexOutOfRange {
        fold: usize,
        index: i64,
    },
    FoldUnknownObservation {
        fold: usize,
        observation_id: String,
    },
    FoldProvenanceUnavailable {
        fold_count: usize,
    },
    FoldDuplicateObservation {
        fold: usize,
        role: &'static str,
        observation_id: String,
    },
    FoldTrainValidationOverlap {
        fold: usize,
        observation_id: String,
    },
    FoldSampleLeakage {
        fold: usize,
        sample_id: String,
    },
    FoldGroupLeakage {
        fold: usize,
        group_id: String,
    },
    UnalignedBlockSources {
        partition: String,
        matrices: usize,
        source_ids: usize,
    },
    SourceLayoutConflict {
        source_id: String,
        partition: String,
        detail: &'static str,
    },
    PartitionLayoutConflict {
        partition: String,
        detail: &'static str,
    },
}

impl std::fmt::Display for DagMlPreflightError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::MissingSampleId => f.write_str(
                "cannot emit dag-ml-data: stable sample identity is unavailable; declare sample_index: { by: id, key: <metadata column> }",
            ),
            Self::MissingIdentityColumn { column, partition } => write!(
                f,
                "cannot emit dag-ml-data: identity column '{column}' is absent from partition '{partition}'",
            ),
            Self::UnalignedIdentityColumn { column, partition } => write!(
                f,
                "cannot emit dag-ml-data: identity column '{column}' is not aligned to partition '{partition}'",
            ),
            Self::EmptyIdentityValue { column, partition, row } => write!(
                f,
                "cannot emit dag-ml-data: identity column '{column}' has an empty value in partition '{partition}' row {row}",
            ),
            Self::InvalidIdentifier { kind, value } => write!(
                f,
                "cannot emit dag-ml-data: {kind} '{value}' is not a dag-ml identifier (ASCII alphanumeric plus _-. only, max 128 bytes)",
            ),
            Self::DuplicateObservationId { observation_id } => write!(
                f,
                "cannot emit dag-ml-data: duplicate observation id '{observation_id}'",
            ),
            Self::RepeatedSampleNeedsObservationId { sample_id } => write!(
                f,
                "cannot emit dag-ml-data: repeated sample '{sample_id}' requires sample_index.observation_id",
            ),
            Self::UnalignedWeights { partition } => write!(
                f,
                "cannot emit dag-ml-data: sample weights are not aligned to partition '{partition}'",
            ),
            Self::NonFiniteWeight { partition, row } => write!(
                f,
                "cannot emit dag-ml-data: sample weight in partition '{partition}' row {row} is non-finite",
            ),
            Self::FoldIndexOutOfRange { fold, index } => write!(
                f,
                "cannot emit dag-ml-data: fold {fold} references row index {index}, outside the assembled observations",
            ),
            Self::FoldUnknownObservation {
                fold,
                observation_id,
            } => write!(
                f,
                "cannot emit dag-ml-data: fold {fold} references unknown observation '{observation_id}'",
            ),
            Self::FoldProvenanceUnavailable { fold_count } => write!(
                f,
                "cannot emit dag-ml-data: {fold_count} fold(s) have positional indices but no stable pre-partition observation provenance",
            ),
            Self::FoldDuplicateObservation { fold, role, observation_id } => write!(
                f,
                "cannot emit dag-ml-data: fold {fold} has duplicate {role} observation '{observation_id}'",
            ),
            Self::FoldTrainValidationOverlap { fold, observation_id } => write!(
                f,
                "cannot emit dag-ml-data: fold {fold} has train/validation overlap at observation '{observation_id}'",
            ),
            Self::FoldSampleLeakage { fold, sample_id } => write!(
                f,
                "cannot emit dag-ml-data: fold {fold} leaks sample '{sample_id}' across train and validation",
            ),
            Self::FoldGroupLeakage { fold, group_id } => write!(
                f,
                "cannot emit dag-ml-data: fold {fold} leaks group '{group_id}' across train and validation",
            ),
            Self::UnalignedBlockSources { partition, matrices, source_ids } => write!(
                f,
                "cannot emit dag-ml-data: partition '{partition}' has {matrices} feature matrices but {source_ids} source ids",
            ),
            Self::SourceLayoutConflict { source_id, partition, detail } => write!(
                f,
                "cannot emit dag-ml-data: source '{source_id}' conflicts in partition '{partition}' ({detail})",
            ),
            Self::PartitionLayoutConflict { partition, detail } => write!(
                f,
                "cannot emit dag-ml-data: partition '{partition}' conflicts with the dataset contract ({detail})",
            ),
        }
    }
}

impl std::error::Error for DagMlPreflightError {}

fn preflight_err(error: DagMlPreflightError) -> SpecError {
    SpecError::new(error.to_string())
}

#[derive(Debug, Clone)]
struct IdentityRow {
    partition: String,
    sample_id: String,
    observation_id: String,
    group_id: Option<String>,
    repetition_id: Option<String>,
    source_ids: Vec<String>,
    metadata: BTreeMap<String, Value>,
}

/// One IO-materialized, target-free feature cohort ready to be bound to a
/// native Methods PLS PREDICT request by the host runtime.
///
/// This bridge deliberately does not depend on `dag-ml-core`: IO owns the
/// rows/source identity and DAG-ML owns the scheduler/provider. The caller
/// must pass all fields unchanged to its typed runtime adapter; no target
/// matrix is carried here.
#[derive(Debug, Clone, PartialEq)]
pub struct MethodsPlsPredictCohort {
    pub partition: String,
    pub source_id: String,
    pub sample_ids: Vec<String>,
    pub values: Vec<f64>,
    pub rows: usize,
    pub cols: usize,
    pub data_content_profile: String,
    pub data_content_fingerprint: String,
}

fn methods_pls_predict_content_fingerprint(
    rows: usize,
    cols: usize,
    values: &[f64],
) -> Result<String, SpecError> {
    if rows
        .checked_mul(cols)
        .is_none_or(|expected| expected != values.len())
    {
        return Err(SpecError::new(
            "cannot emit Methods PLS PREDICT cohort: matrix dimensions are invalid",
        ));
    }
    if values.iter().any(|value| !value.is_finite()) {
        return Err(SpecError::new(
            "cannot emit Methods PLS PREDICT cohort: feature matrix contains a non-finite value",
        ));
    }
    let rows = u64::try_from(rows).map_err(err)?;
    let cols = u64::try_from(cols).map_err(err)?;
    let mut hasher = Sha256::new();
    hasher.update(METHODS_PLS_PREDICT_CONTENT_PROFILE.as_bytes());
    hasher.update([0]);
    hasher.update(rows.to_le_bytes());
    hasher.update(cols.to_le_bytes());
    for value in values {
        hasher.update(value.to_bits().to_le_bytes());
    }
    Ok(format!("{:x}", hasher.finalize()))
}

/// Materialize one exact source from one assembled partition for target-free
/// Methods PLS prediction. Stable sample IDs are mandatory and source ordering
/// is preserved; callers must use the returned fingerprint/profile unchanged
/// in the corresponding DAG-ML envelope and runtime input.
pub fn methods_pls_predict_cohort(
    assembled: &AssembledDataset,
    partition: &str,
    source_id: &str,
) -> Result<MethodsPlsPredictCohort, SpecError> {
    let block = assembled.blocks.get(partition).ok_or_else(|| {
        SpecError::new(format!(
            "cannot emit Methods PLS PREDICT cohort: unknown partition `{partition}`"
        ))
    })?;
    if block.x.len() != block.source_ids.len() {
        return Err(preflight_err(DagMlPreflightError::UnalignedBlockSources {
            partition: partition.to_string(),
            matrices: block.x.len(),
            source_ids: block.source_ids.len(),
        }));
    }
    let source_index = block
        .source_ids
        .iter()
        .position(|candidate| candidate == source_id)
        .ok_or_else(|| {
            SpecError::new(format!(
                "cannot emit Methods PLS PREDICT cohort: partition `{partition}` has no source `{source_id}`"
            ))
        })?;
    let matrix = &block.x[source_index];
    if matrix.n_rows != block.n_samples {
        return Err(SpecError::new(format!(
            "cannot emit Methods PLS PREDICT cohort: source `{source_id}` row count differs from partition `{partition}`"
        )));
    }
    let sample_column = assembled
        .identity
        .sample_id
        .as_deref()
        .ok_or_else(|| preflight_err(DagMlPreflightError::MissingSampleId))?;
    let sample_ids = (0..block.n_samples)
        .map(|row| identity_value(block, sample_column, partition, row))
        .collect::<Result<Vec<_>, _>>()
        .map_err(preflight_err)?;
    for sample_id in &sample_ids {
        ensure_identifier("sample id", sample_id).map_err(preflight_err)?;
    }
    if sample_ids.iter().collect::<BTreeSet<_>>().len() != sample_ids.len() {
        return Err(SpecError::new(
            "cannot emit Methods PLS PREDICT cohort: duplicate sample identities",
        ));
    }
    let values = matrix
        .data
        .iter()
        .map(|value| f64::from(*value))
        .collect::<Vec<_>>();
    let data_content_fingerprint =
        methods_pls_predict_content_fingerprint(matrix.n_rows, matrix.n_cols, &values)?;
    Ok(MethodsPlsPredictCohort {
        partition: partition.to_string(),
        source_id: source_id.to_string(),
        sample_ids,
        values,
        rows: matrix.n_rows,
        cols: matrix.n_cols,
        data_content_profile: METHODS_PLS_PREDICT_CONTENT_PROFILE.to_string(),
        data_content_fingerprint,
    })
}

fn cell_value(cell: &Cell) -> Value {
    match cell {
        Cell::Bool(value) => Value::Bool(*value),
        Cell::Int(value) => Value::from(*value),
        Cell::Float(value) if value.is_finite() => Value::from(*value),
        Cell::Str(value) => Value::String(value.clone()),
        Cell::Float(_) | Cell::Na => Value::Null,
    }
}

fn identity_value(
    block: &PartitionBlock,
    column: &str,
    partition: &str,
    row: usize,
) -> Result<String, DagMlPreflightError> {
    let frame =
        block
            .metadata
            .as_ref()
            .ok_or_else(|| DagMlPreflightError::MissingIdentityColumn {
                column: column.to_string(),
                partition: partition.to_string(),
            })?;
    let values =
        frame
            .column(column)
            .ok_or_else(|| DagMlPreflightError::MissingIdentityColumn {
                column: column.to_string(),
                partition: partition.to_string(),
            })?;
    if values.values.len() != block.n_samples {
        return Err(DagMlPreflightError::UnalignedIdentityColumn {
            column: column.to_string(),
            partition: partition.to_string(),
        });
    }
    let value = values.values[row].to_str_scalar();
    let missing = matches!(&values.values[row], Cell::Na)
        || matches!(&values.values[row], Cell::Float(value) if value.is_nan());
    if value.trim().is_empty() || missing {
        return Err(DagMlPreflightError::EmptyIdentityValue {
            column: column.to_string(),
            partition: partition.to_string(),
            row,
        });
    }
    Ok(value)
}

fn ensure_identifier(kind: &'static str, value: &str) -> Result<(), DagMlPreflightError> {
    let valid = !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-' | b'.'));
    if valid {
        Ok(())
    } else {
        Err(DagMlPreflightError::InvalidIdentifier {
            kind,
            value: value.to_string(),
        })
    }
}

/// Validate and extract every relation row before schema construction.
///
/// This is intentionally public so hosts can fail before serialising an
/// envelope. It never substitutes row positions, sanitized IDs, or fabricated
/// observation labels for absent scientific provenance.
pub fn preflight_identity(assembled: &AssembledDataset) -> Result<(), DagMlPreflightError> {
    let rows = collect_identity_rows(assembled)?;
    let first = assembled.blocks.values().next().ok_or_else(|| {
        DagMlPreflightError::PartitionLayoutConflict {
            partition: "<none>".to_string(),
            detail: "dataset has no partitions",
        }
    })?;
    validate_partition_contracts(assembled, first)?;
    source_layouts(assembled)?;
    fold_specs(assembled, &rows, None)?;
    Ok(())
}

fn collect_identity_rows(
    assembled: &AssembledDataset,
) -> Result<Vec<IdentityRow>, DagMlPreflightError> {
    let sample_column = assembled
        .identity
        .sample_id
        .as_deref()
        .ok_or(DagMlPreflightError::MissingSampleId)?;
    let mut rows = Vec::new();
    for (partition, block) in &assembled.blocks {
        if let Some(weights) = &block.weights {
            if weights.len() != block.n_samples {
                return Err(DagMlPreflightError::UnalignedWeights {
                    partition: partition.clone(),
                });
            }
            for (row, weight) in weights.iter().enumerate() {
                if !weight.is_finite() {
                    return Err(DagMlPreflightError::NonFiniteWeight {
                        partition: partition.clone(),
                        row,
                    });
                }
            }
        }
        for row in 0..block.n_samples {
            let sample_id = identity_value(block, sample_column, partition, row)?;
            ensure_identifier("sample id", &sample_id)?;
            let observation_id = match assembled.identity.observation_id.as_deref() {
                Some(column) => identity_value(block, column, partition, row)?,
                // Reusing an explicit, stable sample key is lossless for the
                // one-observation-per-sample case. Duplicates are rejected
                // below rather than receiving a synthetic `.obsN` suffix.
                None => sample_id.clone(),
            };
            ensure_identifier("observation id", &observation_id)?;
            let group_id = assembled
                .identity
                .group_id
                .as_deref()
                .map(|column| identity_value(block, column, partition, row))
                .transpose()?;
            if let Some(value) = &group_id {
                ensure_identifier("group id", value)?;
            }
            let repetition_id = assembled
                .identity
                .repetition_id
                .as_deref()
                .or(assembled.repetition.as_deref())
                .map(|column| identity_value(block, column, partition, row))
                .transpose()?;
            if let Some(value) = &repetition_id {
                ensure_identifier("repetition id", value)?;
            }
            let mut metadata = block
                .metadata
                .as_ref()
                .map(|frame| {
                    frame
                        .columns
                        .iter()
                        .map(|column| (column.name.clone(), cell_value(&column.values[row])))
                        .collect::<BTreeMap<_, _>>()
                })
                .unwrap_or_default();
            metadata.insert("io.partition".to_string(), Value::String(partition.clone()));
            metadata.insert(
                "io.source_ids".to_string(),
                Value::Array(
                    block
                        .source_ids
                        .iter()
                        .cloned()
                        .map(Value::String)
                        .collect(),
                ),
            );
            if let Some(weight) = block.weights.as_ref().map(|weights| weights[row]) {
                metadata.insert("io.sample_weight".to_string(), Value::from(weight));
                if let Some(column) = &block.weights_header {
                    metadata.insert(
                        "io.sample_weight_column".to_string(),
                        Value::String(column.clone()),
                    );
                }
            }
            rows.push(IdentityRow {
                partition: partition.clone(),
                sample_id,
                observation_id,
                group_id,
                repetition_id,
                source_ids: block.source_ids.clone(),
                metadata,
            });
        }
    }
    let mut samples = BTreeMap::<String, usize>::new();
    for row in &rows {
        let count = samples.entry(row.sample_id.clone()).or_default();
        *count += 1;
    }
    if assembled.identity.observation_id.is_none() {
        if let Some((sample_id, _)) = samples.iter().find(|(_, count)| **count > 1) {
            return Err(DagMlPreflightError::RepeatedSampleNeedsObservationId {
                sample_id: sample_id.clone(),
            });
        }
    }
    let mut observations = BTreeSet::new();
    for row in &rows {
        if !observations.insert(row.observation_id.clone()) {
            return Err(DagMlPreflightError::DuplicateObservationId {
                observation_id: row.observation_id.clone(),
            });
        }
    }
    Ok(rows)
}

/// Map an io header unit onto a spectral axis kind + canonical unit string.
fn feature_axis(unit: &str) -> (AxisKind, Option<String>, &'static str) {
    let u = unit.to_ascii_lowercase();
    if u.contains("nm") || u.contains("nanomet") || u.contains("wavelength") {
        (AxisKind::Wavelength, Some("nm".to_string()), "wavelength")
    } else if u.contains("cm-1")
        || u.contains("cm^-1")
        || u.contains("1/cm")
        || u.contains("wavenumber")
        || u.contains("cm⁻¹")
    {
        (
            AxisKind::Wavenumber,
            Some("cm^-1".to_string()),
            "wavenumber",
        )
    } else {
        (AxisKind::Feature, None, "feature")
    }
}

/// Numeric axis coordinates from feature headers, only when every header parses
/// to a finite number and the count matches the axis size (else `None`, so the
/// `AxisSpec` size/coordinates invariant always holds).
fn numeric_coords(headers: &[String], size: usize) -> Option<CoordinateSpec> {
    if headers.len() != size {
        return None;
    }
    let mut out = Vec::with_capacity(size);
    for h in headers {
        let v: f64 = h.trim().parse().ok()?;
        if !v.is_finite() {
            return None;
        }
        out.push(Value::from(v));
    }
    Some(CoordinateSpec {
        dtype: CoordinateDType::Numeric,
        ordered: false,
        values: CoordinateValues::Explicit { values: out },
    })
}

fn categorical_coords(values: Vec<Value>) -> Option<CoordinateSpec> {
    if values.is_empty() {
        return None;
    }
    Some(CoordinateSpec {
        dtype: CoordinateDType::Categorical,
        ordered: false,
        values: CoordinateValues::Explicit { values },
    })
}

fn sample_axis(n_samples: usize) -> AxisSpec {
    AxisSpec {
        name: "sample".into(),
        kind: AxisKind::Sample,
        unit: None,
        size: Some(n_samples),
        variable: false,
        coordinate: None,
    }
}

fn feature_axis_spec(headers: &[String], n_features: usize, unit: &str) -> AxisSpec {
    let (kind, axis_unit, axis_name) = feature_axis(unit);
    AxisSpec {
        name: axis_name.into(),
        kind,
        unit: axis_unit,
        size: Some(n_features),
        variable: false,
        coordinate: numeric_coords(headers, n_features),
    }
}

fn processing_axis(names: Vec<String>) -> AxisSpec {
    AxisSpec {
        name: "processing".into(),
        kind: AxisKind::Processing,
        unit: None,
        size: Some(names.len()),
        variable: false,
        coordinate: categorical_coords(names.into_iter().map(Value::String).collect()),
    }
}

fn target_axis(headers: &[String]) -> AxisSpec {
    AxisSpec {
        name: "target".into(),
        kind: AxisKind::Target,
        unit: None,
        size: Some(headers.len()),
        variable: false,
        coordinate: categorical_coords(headers.iter().cloned().map(Value::String).collect()),
    }
}

fn signal_kind(raw: &str) -> SignalKind {
    match raw.trim().to_ascii_lowercase().as_str() {
        "absorbance" => SignalKind::Absorbance,
        "reflectance" => SignalKind::Reflectance,
        "transmittance" => SignalKind::Transmittance,
        "log_reflectance" | "log-reflectance" | "log reflectance" => SignalKind::LogReflectance,
        "preprocessed" => SignalKind::Preprocessed,
        _ => SignalKind::Unknown,
    }
}

fn source_representation(
    n_samples: usize,
    n_features: usize,
    headers: &[String],
    unit: &str,
    signal: Option<&str>,
    processings: &[String],
) -> RepresentationSpec {
    let kind = signal.map(signal_kind).unwrap_or(SignalKind::Unknown);
    let mut representation = if processings.len() > 1 {
        signal_with_processings(kind)
    } else {
        signal_1d(kind)
    };
    let feature_axis = feature_axis_spec(headers, n_features, unit);
    representation.axes = if processings.len() > 1 {
        vec![
            sample_axis(n_samples),
            processing_axis(processings.to_vec()),
            feature_axis,
        ]
    } else {
        vec![sample_axis(n_samples), feature_axis]
    };
    representation.rank = Some(representation.axes.len());
    representation
}

fn single_target_representation(
    n_samples: usize,
    _header: &str,
    categorical: bool,
) -> RepresentationSpec {
    let mut representation = if categorical {
        target_categorical()
    } else {
        target_numeric()
    };
    representation.axes = vec![sample_axis(n_samples)];
    representation.rank = Some(1);
    representation
}

fn target_matrix_representation(
    n_samples: usize,
    headers: &[String],
    categorical: bool,
) -> RepresentationSpec {
    let mut representation = if categorical {
        target_categorical_matrix()
    } else {
        target_numeric_matrix()
    };
    representation.axes = vec![sample_axis(n_samples), target_axis(headers)];
    representation.rank = Some(2);
    representation
}

fn target_is_categorical(
    assembled: &AssembledDataset,
    first_block: &nirs4all_io::core::materialize::PartitionBlock,
    header: &str,
) -> bool {
    first_block.y_categorical.contains_key(header)
        || matches!(assembled.task_type.as_str(), "binary" | "multiclass")
}

fn emit_target_specs(
    assembled: &AssembledDataset,
    n_samples: usize,
    first_block: &nirs4all_io::core::materialize::PartitionBlock,
    headers: &[String],
) -> Result<BTreeMap<TargetId, RepresentationSpec>, SpecError> {
    let mut targets = BTreeMap::new();
    if headers.is_empty() {
        return Ok(targets);
    }

    let target_kinds = headers
        .iter()
        .map(|header| target_is_categorical(assembled, first_block, header))
        .collect::<Vec<_>>();
    let all_same_kind = target_kinds
        .first()
        .is_some_and(|first| target_kinds.iter().all(|kind| kind == first));

    if headers.len() > 1 && all_same_kind {
        let id = TargetId::new("targets").map_err(err)?;
        targets.insert(
            id,
            target_matrix_representation(n_samples, headers, target_kinds[0]),
        );
        return Ok(targets);
    }

    for (i, header) in headers.iter().enumerate() {
        let tid = sanitize(header, &format!("target{i}"));
        targets.insert(
            TargetId::new(&tid).map_err(err)?,
            single_target_representation(n_samples, header, target_kinds[i]),
        );
    }
    Ok(targets)
}

fn metadata_value_kind(
    column: &nirs4all_io::core::materialize::frame::Column,
) -> MetadataValueKind {
    match column.dtype {
        ColDtype::Bool => MetadataValueKind::Boolean,
        ColDtype::Datetime => MetadataValueKind::Datetime,
        ColDtype::Numeric if column.numeric_kind == NumericKind::NonFloatNumeric => {
            MetadataValueKind::Integer
        }
        ColDtype::Numeric => MetadataValueKind::Number,
        ColDtype::String => MetadataValueKind::String,
    }
}

fn sample_metadata_representation(
    n_samples: usize,
    field_names: Vec<String>,
) -> Option<RepresentationSpec> {
    if field_names.is_empty() {
        return None;
    }
    let mut representation = sample_metadata();
    representation.axes = vec![
        sample_axis(n_samples),
        AxisSpec {
            name: "field".into(),
            kind: AxisKind::Feature,
            unit: None,
            size: Some(field_names.len()),
            variable: false,
            coordinate: categorical_coords(field_names.into_iter().map(Value::String).collect()),
        },
    ];
    representation.rank = Some(2);
    Some(representation)
}

fn emit_metadata(
    first_block: &nirs4all_io::core::materialize::PartitionBlock,
    n_samples: usize,
) -> (BTreeMap<String, RepresentationSpec>, Option<MetadataSchema>) {
    let Some(frame) = &first_block.metadata else {
        return (BTreeMap::new(), None);
    };
    let field_names = frame
        .columns
        .iter()
        .map(|column| column.name.clone())
        .collect::<Vec<_>>();

    let mut metadata = BTreeMap::new();
    if let Some(representation) = sample_metadata_representation(n_samples, field_names) {
        metadata.insert(REPRESENTATION_SAMPLE_METADATA.to_string(), representation);
    }

    let fields = frame
        .columns
        .iter()
        .map(|column| {
            (
                column.name.clone(),
                MetadataFieldSpec {
                    kind: metadata_value_kind(column),
                    required: false,
                    unit: None,
                    allowed_values: vec![],
                    description: None,
                },
            )
        })
        .collect::<BTreeMap<_, _>>();

    let schema = if fields.is_empty() {
        None
    } else {
        Some(MetadataSchema { fields })
    };
    (metadata, schema)
}

#[derive(Clone)]
struct SourceLayout {
    id: String,
    n_features: usize,
    headers: Vec<String>,
    unit: String,
    signal: Option<String>,
    processings: Vec<String>,
}

fn source_layouts(assembled: &AssembledDataset) -> Result<Vec<SourceLayout>, DagMlPreflightError> {
    let mut layouts: Vec<SourceLayout> = Vec::new();
    for (partition, block) in &assembled.blocks {
        if block.x.len() != block.source_ids.len() {
            return Err(DagMlPreflightError::UnalignedBlockSources {
                partition: partition.clone(),
                matrices: block.x.len(),
                source_ids: block.source_ids.len(),
            });
        }
        for (index, matrix) in block.x.iter().enumerate() {
            let id = block.source_ids[index].clone();
            ensure_identifier("source id", &id)?;
            let headers = block
                .feature_headers
                .get(index)
                .cloned()
                .unwrap_or_default();
            let unit = block.header_units.get(index).cloned().unwrap_or_default();
            let signal = block.signal_types.get(index).cloned().flatten();
            let mut processings = vec!["native".to_string()];
            if let Some(values) = block.processings.get(index) {
                processings.extend(values.iter().map(|(name, _)| name.clone()));
            }
            if headers.len() != matrix.n_cols {
                return Err(DagMlPreflightError::SourceLayoutConflict {
                    source_id: id,
                    partition: partition.clone(),
                    detail: "feature-header count differs from matrix width",
                });
            }
            if matrix.n_rows != block.n_samples {
                return Err(DagMlPreflightError::SourceLayoutConflict {
                    source_id: id,
                    partition: partition.clone(),
                    detail: "feature matrix row count differs from partition sample count",
                });
            }
            if let Some(processings) = block.processings.get(index) {
                for (_, processing) in processings {
                    if processing.n_rows != block.n_samples || processing.n_cols != matrix.n_cols {
                        return Err(DagMlPreflightError::SourceLayoutConflict {
                            source_id: id,
                            partition: partition.clone(),
                            detail: "processing matrix shape differs from native feature matrix",
                        });
                    }
                }
            }
            let candidate = SourceLayout {
                id: id.clone(),
                n_features: matrix.n_cols,
                headers,
                unit,
                signal,
                processings,
            };
            if let Some(existing) = layouts.iter().find(|layout| layout.id == id) {
                let detail = if existing.n_features != candidate.n_features {
                    Some("feature width differs")
                } else if existing.headers != candidate.headers {
                    Some("feature headers differ")
                } else if existing.unit != candidate.unit {
                    Some("header unit differs")
                } else if existing.signal != candidate.signal {
                    Some("signal type differs")
                } else if existing.processings != candidate.processings {
                    Some("processing layout differs")
                } else {
                    None
                };
                if let Some(detail) = detail {
                    return Err(DagMlPreflightError::SourceLayoutConflict {
                        source_id: id,
                        partition: partition.clone(),
                        detail,
                    });
                }
            } else {
                layouts.push(candidate);
            }
        }
    }
    Ok(layouts)
}

fn validate_partition_contracts(
    assembled: &AssembledDataset,
    first_block: &PartitionBlock,
) -> Result<(), DagMlPreflightError> {
    for (partition, block) in &assembled.blocks {
        if block.y.is_some() != first_block.y.is_some()
            || block.y_headers != first_block.y_headers
            || block.y_categorical != first_block.y_categorical
        {
            return Err(DagMlPreflightError::PartitionLayoutConflict {
                partition: partition.clone(),
                detail: "target layout differs",
            });
        }
        let metadata_layout = |value: &Option<nirs4all_io::materialize::Frame>| {
            value.as_ref().map(|frame| {
                frame
                    .columns
                    .iter()
                    .map(|column| (column.name.clone(), column.dtype, column.numeric_kind))
                    .collect::<Vec<_>>()
            })
        };
        if metadata_layout(&block.metadata) != metadata_layout(&first_block.metadata) {
            return Err(DagMlPreflightError::PartitionLayoutConflict {
                partition: partition.clone(),
                detail: "metadata layout differs",
            });
        }
    }
    Ok(())
}

fn fold_specs(
    assembled: &AssembledDataset,
    identity_rows: &[IdentityRow],
    group: Option<&GroupSpec>,
) -> Result<Vec<FoldSpec>, DagMlPreflightError> {
    if assembled.folds.is_empty() {
        return Ok(vec![]);
    }
    if assembled.folds.len() != assembled.fold_provenance.len() {
        return Err(DagMlPreflightError::FoldProvenanceUnavailable {
            fold_count: assembled.folds.len(),
        });
    }
    let observations = identity_rows
        .iter()
        .map(|row| {
            (
                row.observation_id.as_str(),
                (row.sample_id.as_str(), row.group_id.as_deref()),
            )
        })
        .collect::<BTreeMap<_, _>>();
    assembled
        .fold_provenance
        .iter()
        .enumerate()
        .map(|(fold_index, fold)| {
            let validate_members = |role: &'static str,
                                    values: &[String]|
             -> Result<BTreeSet<String>, DagMlPreflightError> {
                let mut seen = BTreeSet::new();
                for value in values {
                    if !observations.contains_key(value.as_str()) {
                        return Err(DagMlPreflightError::FoldUnknownObservation {
                            fold: fold_index,
                            observation_id: value.clone(),
                        });
                    }
                    if !seen.insert(value.clone()) {
                        return Err(DagMlPreflightError::FoldDuplicateObservation {
                            fold: fold_index,
                            role,
                            observation_id: value.clone(),
                        });
                    }
                }
                Ok(seen)
            };
            let train = validate_members("train", &fold.train_observation_ids)?;
            let validation = validate_members("validation", &fold.validation_observation_ids)?;
            if let Some(observation_id) = train.intersection(&validation).next() {
                return Err(DagMlPreflightError::FoldTrainValidationOverlap {
                    fold: fold_index,
                    observation_id: observation_id.clone(),
                });
            }
            let train_samples = train
                .iter()
                .map(|observation| observations[observation.as_str()].0)
                .collect::<BTreeSet<_>>();
            if let Some(sample_id) = validation
                .iter()
                .map(|observation| observations[observation.as_str()].0)
                .find(|sample_id| train_samples.contains(sample_id))
            {
                return Err(DagMlPreflightError::FoldSampleLeakage {
                    fold: fold_index,
                    sample_id: sample_id.to_string(),
                });
            }
            let train_groups = train
                .iter()
                .filter_map(|observation| observations[observation.as_str()].1.map(str::to_string))
                .collect::<BTreeSet<_>>();
            if let Some(group_id) = validation
                .iter()
                .filter_map(|observation| observations[observation.as_str()].1)
                .find(|group_id| train_groups.contains(*group_id))
            {
                return Err(DagMlPreflightError::FoldGroupLeakage {
                    fold: fold_index,
                    group_id: group_id.to_string(),
                });
            }
            let mut metadata = BTreeMap::new();
            metadata.insert(
                "io.train_observation_ids".to_string(),
                Value::Array(
                    fold.train_observation_ids
                        .iter()
                        .cloned()
                        .map(Value::String)
                        .collect(),
                ),
            );
            metadata.insert(
                "io.validation_observation_ids".to_string(),
                Value::Array(
                    fold.validation_observation_ids
                        .iter()
                        .cloned()
                        .map(Value::String)
                        .collect(),
                ),
            );
            Ok(FoldSpec {
                id: format!("io.fold.{fold_index}"),
                group_id: group.map(|group| group.id.clone()),
                split_column: Some("io.partition".to_string()),
                metadata,
            })
        })
        .collect()
}

fn build_dag_ml_data_parts(
    assembled: &AssembledDataset,
) -> Result<(DatasetSchema, DataPlan, Option<SampleRelationTable>), SpecError> {
    let Some((_first, b0)) = assembled.blocks.iter().next() else {
        return Err(SpecError::new(
            "cannot emit dag-ml-data: dataset has no partitions",
        ));
    };
    if b0.x.is_empty() {
        return Err(SpecError::new(
            "cannot emit dag-ml-data: dataset has no feature source",
        ));
    }
    validate_partition_contracts(assembled, b0).map_err(preflight_err)?;
    // Source layouts are the validated union across blocks. Explicit train/test
    // inputs need not contain the same table instances, so a global table list
    // is neither required nor sufficient provenance.
    let source_layouts = source_layouts(assembled).map_err(preflight_err)?;
    if source_layouts.is_empty() {
        return Err(SpecError::new(
            "cannot emit dag-ml-data: dataset has no feature-source provenance",
        ));
    }

    // --- sample / observation identity across all partitions ---
    // The bridge accepts only explicit scientific identity emitted by io's
    // sample_index provenance. It never substitutes `s.<row>`/`obs.<row>` or
    // a sanitized collision suffix for missing values.
    let identity_rows = collect_identity_rows(assembled).map_err(preflight_err)?;
    let mut sample_ids: Vec<SampleId> = Vec::new();
    let mut sample_seen: BTreeSet<String> = BTreeSet::new();
    for row in &identity_rows {
        if sample_seen.insert(row.sample_id.clone()) {
            sample_ids.push(SampleId::new(&row.sample_id).map_err(err)?);
        }
    }
    let n_samples = sample_ids.len();

    // --- sources (validated union of each X source across partitions) ---
    let mut sources = Vec::with_capacity(source_layouts.len());
    for layout in &source_layouts {
        let native_representation = source_representation(
            n_samples,
            layout.n_features,
            &layout.headers,
            &layout.unit,
            layout.signal.as_deref(),
            &layout.processings,
        );
        let mut tags = BTreeMap::new();
        if let Some(sig) = &layout.signal {
            tags.insert("signal_type".to_string(), Value::String(sig.clone()));
        }
        if layout.processings.len() > 1 {
            tags.insert(
                "processing_layers".to_string(),
                Value::Array(
                    layout
                        .processings
                        .iter()
                        .cloned()
                        .map(Value::String)
                        .collect(),
                ),
            );
        }
        sources.push(SourceDescriptor {
            id: SourceId::new(&layout.id).map_err(err)?,
            name: layout.id.clone(),
            type_id: native_representation.type_id.clone(),
            modality: "spectroscopy".into(),
            native_representation,
            sample_key: "sample_id".into(),
            granularity: if identity_rows.iter().any(|row| row.repetition_id.is_some()) {
                SourceGranularity::PerSampleRepeated
            } else {
                SourceGranularity::PerSample
            },
            schema: BTreeMap::new(),
            tags,
            shape_contract: None,
        });
    }

    // --- targets (standardized target-side contracts) ---
    let targets = if b0.y.is_some() {
        emit_target_specs(assembled, n_samples, b0, &b0.y_headers)?
    } else {
        BTreeMap::new()
    };
    let relation_target_id = (targets.len() == 1)
        .then(|| targets.keys().next().cloned())
        .flatten();

    // --- metadata (declared as sample_metadata when present) ---
    let (metadata, metadata_schema) = emit_metadata(b0, n_samples);

    let rows = identity_rows
        .iter()
        .map(|row| -> Result<SampleRelation, SpecError> {
            Ok(SampleRelation {
                observation_id: ObservationId::new(&row.observation_id).map_err(err)?,
                sample_id: SampleId::new(&row.sample_id).map_err(err)?,
                source_id: (row.source_ids.len() == 1)
                    .then(|| SourceId::new(&row.source_ids[0]))
                    .transpose()
                    .map_err(err)?,
                // A single target has an unambiguous observation relation. For
                // multi-target data the complete target-id set stays in the
                // schema and provider tables; inventing duplicate observation
                // rows would violate the coordinator identity contract.
                target_id: relation_target_id.clone(),
                group_id: row
                    .group_id
                    .as_ref()
                    .map(GroupId::new)
                    .transpose()
                    .map_err(err)?,
                origin_id: None,
                repetition_id: row
                    .repetition_id
                    .as_ref()
                    .map(RepetitionId::new)
                    .transpose()
                    .map_err(err)?,
                augmented: false,
                excluded: false,
                // `origin_id` is intentionally None: v1 assembly has no
                // augmentation-origin relation. No synthetic origin is made.
                metadata: row.metadata.clone(),
                tags: vec![format!("partition:{}", row.partition)],
                augmentation: None,
            })
        })
        .collect::<Result<Vec<_>, SpecError>>()?;

    let groups = assembled
        .identity
        .group_id
        .as_ref()
        .map(|column| {
            Ok(GroupSpec {
                id: GroupId::new("io.sample_group").map_err(err)?,
                kind: GroupKind::Custom,
                column: column.clone(),
                source_id: None,
                strict: true,
                metadata: BTreeMap::new(),
            })
        })
        .transpose()?;
    let folds = fold_specs(assembled, &identity_rows, groups.as_ref()).map_err(preflight_err)?;

    let schema = DatasetSchema {
        dataset_id: sanitize(&assembled.name, "dataset"),
        sample_ids,
        sources,
        targets,
        metadata,
        metadata_schema,
        groups: groups.into_iter().collect(),
        folds,
    };

    // --- plan: materialize each source, join when multi-source ---
    let mut materialize_metadata = BTreeMap::new();
    materialize_metadata.insert(
        "io.partitions".to_string(),
        Value::Array(
            assembled
                .blocks
                .keys()
                .cloned()
                .map(Value::String)
                .collect(),
        ),
    );
    materialize_metadata.insert("io.fold_count".to_string(), Value::from(schema.folds.len()));
    let mut steps: Vec<DataPlanStep> = schema
        .sources
        .iter()
        .map(|s| DataPlanStep {
            kind: DataPlanStepKind::Materialize,
            source_id: Some(s.id.clone()),
            adapter_id: None,
            input_representation: None,
            output_representation: Some(s.native_representation.id.clone()),
            fit_scope: FitScope::Stateless,
            requires_user_choice: false,
            metadata: materialize_metadata.clone(),
        })
        .collect();
    let output_representation = if schema.sources.len() == 1 {
        schema.sources[0].native_representation.id.clone()
    } else {
        let model_input = RepresentationId::new(REPRESENTATION_FEATURE_BLOCK_SET).map_err(err)?;
        steps.push(DataPlanStep {
            kind: DataPlanStepKind::Join,
            source_id: None,
            adapter_id: None,
            input_representation: None,
            output_representation: Some(model_input.clone()),
            fit_scope: FitScope::Stateless,
            requires_user_choice: false,
            metadata: BTreeMap::new(),
        });
        model_input
    };
    let plan = DataPlan {
        id: sanitize(&format!("{}_plan", assembled.name), "plan"),
        steps,
        output_representation,
        issues: vec![],
    };

    let relations = if rows.is_empty() {
        None
    } else {
        Some(SampleRelationTable { rows })
    };
    Ok((schema, plan, relations))
}

fn envelope_from_parts(
    assembled: &AssembledDataset,
    schema: &DatasetSchema,
    plan: DataPlan,
    relations: Option<&SampleRelationTable>,
) -> Result<CoordinatorDataPlanEnvelope, SpecError> {
    let mut envelope =
        CoordinatorDataPlanEnvelope::from_parts(schema, plan, relations).map_err(err)?;
    // `CoordinatorDataPlanEnvelope` fingerprints a schema but does not carry it
    // as a first-class field. Retain the exact schema as an io namespaced
    // snapshot so source ids, target labels, groups and fold declarations do
    // not disappear behind an opaque hash at this bridge boundary.
    envelope.metadata.insert(
        "io.dataset_schema".to_string(),
        serde_json::to_value(schema).map_err(err)?,
    );
    envelope.metadata.insert(
        "io.identity_contract".to_string(),
        serde_json::json!({
            "sample_id_column": &assembled.identity.sample_id,
            "observation_id_column": &assembled.identity.observation_id,
            "repetition_id_column": &assembled.identity.repetition_id,
            "group_id_column": &assembled.identity.group_id,
            "source_ids": &assembled.identity.source_ids,
            "origin_id": Value::Null,
            "fold_assignments": "schema.folds[].metadata.io.*_observation_ids",
        }),
    );
    envelope.validate().map_err(err)?;
    Ok(envelope)
}

/// Map an [`AssembledDataset`] to a dag-ml-data `CoordinatorDataPlanEnvelope`.
pub fn to_dag_ml_data(
    assembled: &AssembledDataset,
) -> Result<CoordinatorDataPlanEnvelope, SpecError> {
    let (schema, plan, relations) = build_dag_ml_data_parts(assembled)?;
    envelope_from_parts(assembled, &schema, plan, relations.as_ref())
}

/// A production-shaped Rust provider built directly from an IO
/// [`DatasetPackage`].
///
/// The package is converted through its canonical, lossless
/// [`DatasetPackage::to_assembled`] path; no JSON payload round-trip and no
/// `SpectroDataset` adapter is involved. DATA-002 deliberately supports the
/// dense, single-source matrix surface. Multi-source fusion and N-D payloads
/// remain owned by their existing, explicit provider paths.
pub struct PackageProvider {
    envelope: CoordinatorDataPlanEnvelope,
    feature_set_id: String,
    target_ids: Vec<TargetId>,
    target_names: Vec<String>,
    provider: InMemoryProvider,
}

impl PackageProvider {
    /// Build a dag-ml-data provider from a Rust IO package without serializing
    /// or adapting through Python.
    pub fn from_package(package: &DatasetPackage) -> Result<Self, SpecError> {
        Self::build(package, None)
    }

    /// Build the bounded DATA-002 provider for one exact source from a
    /// multi-source package.
    ///
    /// This is source selection, not fusion: the selected source keeps its IO
    /// identity and all other feature matrices remain outside the provider.
    /// The package's relations, folds, targets and payload-manifest identity
    /// are retained unchanged.
    pub fn from_package_source(
        package: &DatasetPackage,
        source_id: &str,
    ) -> Result<Self, SpecError> {
        if source_id.trim().is_empty() {
            return Err(SpecError::new(
                "cannot build PackageProvider: selected source id is empty",
            ));
        }
        Self::build(package, Some(source_id))
    }

    fn build(package: &DatasetPackage, selected_source: Option<&str>) -> Result<Self, SpecError> {
        preflight_package_payloads(package)?;
        let mut assembled = package.to_assembled();
        if let Some(source_id) = selected_source {
            select_assembled_source(&mut assembled, source_id)?;
        }
        let (schema, mut plan, relations) = build_dag_ml_data_parts(&assembled)?;
        if schema.sources.len() != 1 {
            return Err(SpecError::new(
                "cannot build PackageProvider: DATA-002 requires one selected feature source; call from_package_source for a multi-source package or use the explicit dag-ml-data fusion provider",
            ));
        }
        if assembled.blocks.values().any(|block| {
            block
                .processings
                .iter()
                .any(|processings| !processings.is_empty())
        }) {
            return Err(SpecError::new(
                "cannot build PackageProvider: processing-stack/N-D payloads require the explicit dag-ml-data tensor provider",
            ));
        }
        if selected_source.is_some() && plan.output_representation.as_str() != "tabular_numeric" {
            let input_representation = plan.output_representation.clone();
            let output_representation = RepresentationId::new("tabular_numeric").map_err(err)?;
            plan.steps.push(DataPlanStep {
                kind: DataPlanStepKind::Adapt,
                source_id: None,
                adapter_id: Some("nirs4all-io.numeric-feature-matrix.v1".to_string()),
                input_representation: Some(input_representation),
                output_representation: Some(output_representation.clone()),
                fit_scope: FitScope::Stateless,
                requires_user_choice: false,
                metadata: BTreeMap::from([(
                    "io.adapter_semantics".to_string(),
                    Value::String("typed-f64-row-major".to_string()),
                )]),
            });
            plan.output_representation = output_representation;
            plan.validate().map_err(err)?;
        }

        let identity_rows = collect_identity_rows(&assembled).map_err(preflight_err)?;
        let mut feature_matrix = package_feature_matrix(&assembled, &schema, &identity_rows)?;
        if selected_source.is_some() {
            feature_matrix.representation_id = plan.output_representation.clone();
        }
        let feature_set_id = feature_matrix.feature_set_id.clone();
        let feature_store =
            NumericFeatureBufferStore::from_f64_matrices(vec![feature_matrix]).map_err(err)?;
        let target_tables = package_target_tables(&assembled, &schema, &identity_rows)?;
        let target_ids = target_tables.keys().cloned().collect();
        let target_names = package_target_names(&assembled)?;
        let mut envelope = envelope_from_parts(&assembled, &schema, plan, relations.as_ref())?;
        let package_content_fingerprint = package.manifest().root;
        envelope.data_content_fingerprint = Some(package_content_fingerprint.clone());
        envelope.target_content_fingerprint =
            (!target_tables.is_empty()).then_some(package_content_fingerprint);
        envelope.validate().map_err(err)?;
        let provider =
            InMemoryProvider::new(envelope.clone(), target_tables, feature_store).map_err(err)?;

        Ok(Self {
            envelope,
            feature_set_id,
            target_ids,
            target_names,
            provider,
        })
    }

    /// Exact coordinator envelope used by this provider.
    pub fn envelope(&self) -> &CoordinatorDataPlanEnvelope {
        &self.envelope
    }

    /// Feature-set id accepted by [`Self::feature_block`].
    pub fn feature_set_id(&self) -> &str {
        &self.feature_set_id
    }

    /// Target ids accepted by [`Self::target_block`].
    pub fn target_ids(&self) -> &[TargetId] {
        &self.target_ids
    }

    /// Stable target-column order retained from the IO target table.
    pub fn target_names(&self) -> &[String] {
        &self.target_names
    }

    /// Typed row-major projection for the selected numeric source.
    pub fn feature_block_f64(
        &self,
        view_handle: u64,
    ) -> dag_ml_data::Result<dag_ml_data::CoordinatorFeatureBlockF64> {
        self.provider
            .feature_block_f64(view_handle, &self.feature_set_id)
    }
}

fn preflight_package_payloads(package: &DatasetPackage) -> Result<(), SpecError> {
    for partition in package.partitions.values() {
        for (_, payload) in &partition.payloads {
            if !matches!(
                payload,
                PayloadBlock::FeatureMatrix(_)
                    | PayloadBlock::TargetTable(_)
                    | PayloadBlock::MetadataTable(_)
                    | PayloadBlock::Weights(_)
            ) {
                return Err(SpecError::new(
                    "cannot build PackageProvider: N-D, sequence, record, mask and URI payloads require an explicit dag-ml-data provider",
                ));
            }
        }
    }
    Ok(())
}

fn select_assembled_source(
    assembled: &mut AssembledDataset,
    source_id: &str,
) -> Result<(), SpecError> {
    for (partition, block) in &mut assembled.blocks {
        let source_count = block.source_ids.len();
        if block.x.len() != source_count
            || block.feature_headers.len() != source_count
            || block.header_units.len() != source_count
            || block.signal_types.len() != source_count
            || block.processings.len() != source_count
        {
            return Err(SpecError::new(format!(
                "cannot build PackageProvider: partition `{partition}` has misaligned source payload descriptors"
            )));
        }
        let index = block
            .source_ids
            .iter()
            .position(|candidate| candidate == source_id)
            .ok_or_else(|| {
                SpecError::new(format!(
                    "cannot build PackageProvider: partition `{partition}` has no source `{source_id}`"
                ))
            })?;
        block.source_ids = vec![block.source_ids[index].clone()];
        block.x = vec![block.x[index].clone()];
        block.feature_headers = vec![block
            .feature_headers
            .get(index)
            .cloned()
            .unwrap_or_default()];
        block.header_units = vec![block.header_units.get(index).cloned().unwrap_or_default()];
        block.signal_types = vec![block.signal_types.get(index).cloned().unwrap_or(None)];
        block.processings = vec![block.processings.get(index).cloned().unwrap_or_default()];
    }
    assembled.n_sources = 1;
    assembled.identity.source_ids = vec![source_id.to_string()];
    Ok(())
}

fn package_target_names(assembled: &AssembledDataset) -> Result<Vec<String>, SpecError> {
    let mut names: Option<Vec<String>> = None;
    for (partition, block) in &assembled.blocks {
        if block.y.is_none() {
            continue;
        }
        if block.y_headers.is_empty() || block.y_headers.iter().any(|name| name.trim().is_empty()) {
            return Err(SpecError::new(format!(
                "cannot build PackageProvider: partition `{partition}` has invalid target names"
            )));
        }
        if names
            .as_ref()
            .is_some_and(|expected| expected != &block.y_headers)
        {
            return Err(SpecError::new(format!(
                "cannot build PackageProvider: target columns differ in partition `{partition}`"
            )));
        }
        names.get_or_insert_with(|| block.y_headers.clone());
    }
    Ok(names.unwrap_or_default())
}

impl DagMlDataProvider for PackageProvider {
    fn materialize(
        &self,
        request: &CoordinatorDataMaterializationRequest,
    ) -> dag_ml_data::Result<CoordinatorDataHandleRecord> {
        self.provider.materialize(request)
    }

    fn make_view(
        &self,
        data_handle: u64,
        view: &DataView,
    ) -> dag_ml_data::Result<CoordinatorDataViewRecord> {
        self.provider.make_view(data_handle, view)
    }

    fn view_identity(&self, view_handle: u64) -> dag_ml_data::Result<CoordinatorRelationSet> {
        self.provider.view_identity(view_handle)
    }

    fn target_block(
        &self,
        view_handle: u64,
        target_id: &TargetId,
    ) -> dag_ml_data::Result<CoordinatorTargetBlock> {
        self.provider.target_block(view_handle, target_id)
    }

    fn feature_block(
        &self,
        view_handle: u64,
        feature_set_id: &str,
    ) -> dag_ml_data::Result<CoordinatorFeatureBlock> {
        self.provider.feature_block(view_handle, feature_set_id)
    }

    fn release(&self, handle: u64) -> bool {
        self.provider.release(handle)
    }
}

fn package_feature_matrix(
    assembled: &AssembledDataset,
    schema: &DatasetSchema,
    identity_rows: &[IdentityRow],
) -> Result<NumericFeatureMatrixF64, SpecError> {
    let source = &schema.sources[0];
    let source_id = source.id.as_str();
    let mut feature_names: Option<Vec<String>> = None;
    let mut observation_ids = Vec::new();
    let mut values = Vec::new();
    let mut validity_mask = Vec::new();
    let mut identity_offset = 0usize;

    for (partition, block) in &assembled.blocks {
        let source_index = block
            .source_ids
            .iter()
            .position(|candidate| candidate == source_id)
            .ok_or_else(|| {
                SpecError::new(format!(
                    "cannot build PackageProvider: partition `{partition}` does not contain source `{source_id}`"
                ))
            })?;
        let matrix = &block.x[source_index];
        let headers = block
            .feature_headers
            .get(source_index)
            .cloned()
            .unwrap_or_default();
        if feature_names
            .as_ref()
            .is_some_and(|known| known != &headers)
        {
            return Err(SpecError::new(format!(
                "cannot build PackageProvider: source `{source_id}` feature headers differ in partition `{partition}`"
            )));
        }
        feature_names.get_or_insert(headers);
        for row in 0..block.n_samples {
            let identity = &identity_rows[identity_offset + row];
            if identity.partition != *partition {
                return Err(SpecError::new(
                    "cannot build PackageProvider: identity rows are not aligned with package partitions",
                ));
            }
            observation_ids.push(ObservationId::new(&identity.observation_id).map_err(err)?);
            for value in &matrix.data[row * matrix.n_cols..(row + 1) * matrix.n_cols] {
                let valid = value.is_finite();
                values.push(if valid { f64::from(*value) } else { 0.0 });
                validity_mask.push(valid);
            }
        }
        identity_offset += block.n_samples;
    }

    Ok(NumericFeatureMatrixF64 {
        feature_set_id: source_id.to_string(),
        representation_id: source.native_representation.id.clone(),
        feature_names: feature_names.unwrap_or_default(),
        observation_ids,
        values,
        validity_mask: validity_mask
            .iter()
            .any(|valid| !valid)
            .then_some(validity_mask),
    })
}

fn package_target_tables(
    assembled: &AssembledDataset,
    schema: &DatasetSchema,
    identity_rows: &[IdentityRow],
) -> Result<BTreeMap<TargetId, CoordinatorTargetTable>, SpecError> {
    if schema.targets.is_empty() {
        return Ok(BTreeMap::new());
    }
    let matrix_target = schema.targets.len() == 1
        && schema
            .targets
            .keys()
            .next()
            .is_some_and(|target_id| target_id.as_str() == "targets");
    let mut values = BTreeMap::<TargetId, Vec<CoordinatorTargetValue>>::new();
    let mut seen = BTreeMap::<(TargetId, SampleId), Value>::new();
    let mut identity_offset = 0usize;

    for (partition, block) in &assembled.blocks {
        let Some(matrix) = &block.y else {
            identity_offset += block.n_samples;
            continue;
        };
        if matrix.n_rows != block.n_samples || matrix.n_cols != block.y_headers.len() {
            return Err(SpecError::new(format!(
                "cannot build PackageProvider: target matrix shape differs from headers in partition `{partition}`"
            )));
        }
        for row in 0..block.n_samples {
            let identity = &identity_rows[identity_offset + row];
            let sample_id = SampleId::new(&identity.sample_id).map_err(err)?;
            let target_values = if matrix_target {
                let row_values = (0..matrix.n_cols)
                    .map(|column| finite_target_value(matrix.data[row * matrix.n_cols + column]))
                    .collect::<Result<Vec<_>, _>>()?;
                vec![(
                    TargetId::new("targets").map_err(err)?,
                    Value::Array(row_values),
                )]
            } else {
                block
                    .y_headers
                    .iter()
                    .enumerate()
                    .map(|(column, header)| {
                        Ok((
                            TargetId::new(sanitize(header, &format!("target{column}")))
                                .map_err(err)?,
                            finite_target_value(matrix.data[row * matrix.n_cols + column])?,
                        ))
                    })
                    .collect::<Result<Vec<_>, SpecError>>()?
            };
            for (target_id, value) in target_values {
                let key = (target_id.clone(), sample_id.clone());
                if let Some(previous) = seen.get(&key) {
                    if previous != &value {
                        return Err(SpecError::new(format!(
                            "cannot build PackageProvider: repeated sample `{sample_id}` has conflicting values for target `{target_id}`"
                        )));
                    }
                    continue;
                }
                seen.insert(key, value.clone());
                values
                    .entry(target_id.clone())
                    .or_default()
                    .push(CoordinatorTargetValue {
                        sample_id: sample_id.clone(),
                        value,
                    });
            }
        }
        identity_offset += block.n_samples;
    }

    values
        .into_iter()
        .map(|(target_id, target_values)| {
            let table = CoordinatorTargetTable {
                target_id: target_id.clone(),
                values: target_values,
            };
            table.validate().map_err(err)?;
            Ok((target_id, table))
        })
        .collect()
}

fn finite_target_value(value: f32) -> Result<Value, SpecError> {
    if !value.is_finite() {
        return Err(SpecError::new(
            "cannot build PackageProvider: target matrix contains a non-finite value",
        ));
    }
    Ok(Value::from(f64::from(value)))
}

/// Build the v3 [`DatasetPackage`] for an [`AssembledDataset`] — the typed-payload
/// + content-hash-manifest companion to [`to_dag_ml_data`] (`IO-002`).
///
/// This **extends** the bridge rather than replacing it: the same
/// `AssembledDataset` now yields both the dag-ml-data envelope
/// (`DatasetSchema`/`DataPlan`/`SampleRelationTable`) and the target-agnostic
/// package (typed payload blocks, a `content_hash` payload manifest, and an
/// explicit row-position fallback diagnostic). The package's representation-ID
/// hints are the same `DMD-001` strings the envelope's `SourceDescriptor`s use —
/// asserted by the `core_repr_ids_match_dag_ml_data_registry` drift guard below.
/// Payload-store export (`IO-006`) can later hang off this manifest without
/// touching the envelope seam.
pub fn to_dataset_package(assembled: &AssembledDataset) -> DatasetPackage {
    DatasetPackage::from_assembled(assembled)
}

#[cfg(test)]
mod tests {
    use super::*;
    use dag_ml_data::{
        DataPlanStepKind, REPRESENTATION_SIGNAL_1D, REPRESENTATION_SIGNAL_WITH_PROCESSINGS,
        REPRESENTATION_TARGET_NUMERIC, REPRESENTATION_TARGET_NUMERIC_MATRIX,
    };
    use nirs4all_io::core::materialize::{
        AssembledDataset, Cell, Column, Frame, Matrix, PartitionBlock,
    };

    fn matrix(rows: usize, cols: usize) -> Matrix {
        Matrix {
            data: (0..rows * cols).map(|value| value as f32).collect(),
            n_rows: rows,
            n_cols: cols,
        }
    }

    fn assembled_with_block(block: PartitionBlock) -> AssembledDataset {
        let mut assembled = AssembledDataset {
            name: "demo".into(),
            task_type: "regression".into(),
            signal_type: "absorbance".into(),
            n_sources: 1,
            blocks: Default::default(),
            folds: vec![],
            fold_provenance: vec![],
            repetition: None,
            identity: nirs4all_io::materialize::IdentityProvenance {
                source_ids: vec!["spectra".into()],
                sample_id: Some("sample_id".into()),
                observation_id: Some("scan_id".into()),
                repetition_id: Some("rep".into()),
                group_id: Some("batch".into()),
            },
            aggregate: None,
            warnings: vec![],
            audits: vec![],
        };
        assembled.blocks.insert("train".to_string(), block);
        assembled
    }

    fn base_block() -> PartitionBlock {
        PartitionBlock {
            n_samples: 2,
            source_ids: vec!["spectra".into()],
            x: vec![matrix(2, 3)],
            feature_headers: vec![vec!["1000".into(), "1010".into(), "1020".into()]],
            header_units: vec!["nm".into()],
            signal_types: vec![Some("absorbance".into())],
            processings: vec![vec![]],
            y: Some(matrix(2, 1)),
            y_headers: vec!["protein".into()],
            y_categorical: Default::default(),
            metadata: Some(Frame::from_columns(
                vec![
                    Column::from_cells("batch", vec![Cell::Str("a".into()), Cell::Str("b".into())]),
                    Column::from_cells("rep", vec![Cell::Int(1), Cell::Int(2)]),
                    Column::from_cells(
                        "sample_id",
                        vec![Cell::Str("S1".into()), Cell::Str("S2".into())],
                    ),
                    Column::from_cells(
                        "scan_id",
                        vec![Cell::Str("O1".into()), Cell::Str("O2".into())],
                    ),
                ],
                "text",
            )),
            weights: None,
            weights_header: None,
        }
    }

    #[test]
    fn preflight_refuses_missing_stable_sample_identity() {
        let mut assembled = assembled_with_block(base_block());
        assembled.identity.sample_id = None;
        assert_eq!(
            preflight_identity(&assembled),
            Err(DagMlPreflightError::MissingSampleId)
        );
    }

    #[test]
    fn methods_predict_cohort_is_target_free_and_matches_the_cross_runtime_vector() {
        let cohort =
            methods_pls_predict_cohort(&assembled_with_block(base_block()), "train", "spectra")
                .unwrap();
        assert_eq!(cohort.sample_ids, vec!["S1", "S2"]);
        assert_eq!(cohort.rows, 2);
        assert_eq!(cohort.cols, 3);
        assert_eq!(cohort.values, vec![0.0, 1.0, 2.0, 3.0, 4.0, 5.0]);
        assert_eq!(cohort.data_content_profile, "n4a-matrix-f64-le.v1");
        assert_eq!(
            cohort.data_content_fingerprint,
            "e413ddf6896dd5eb7d292782b0e427a79864e98768fddab118f5f2eecf2895ea"
        );
    }

    #[test]
    fn methods_predict_cohort_refuses_duplicate_or_nonfinite_rows() {
        let mut duplicate = base_block();
        duplicate.metadata.as_mut().unwrap().columns[2] = Column::from_cells(
            "sample_id",
            vec![Cell::Str("S1".into()), Cell::Str("S1".into())],
        );
        let error =
            methods_pls_predict_cohort(&assembled_with_block(duplicate), "train", "spectra")
                .unwrap_err();
        assert!(error.to_string().contains("duplicate sample"));

        let mut nonfinite = base_block();
        nonfinite.x[0].data[0] = f32::NAN;
        let error =
            methods_pls_predict_cohort(&assembled_with_block(nonfinite), "train", "spectra")
                .unwrap_err();
        assert!(error.to_string().contains("non-finite"));
    }

    #[test]
    fn emits_standard_single_source_signal_target_and_metadata() {
        let (schema, plan, relations) =
            build_dag_ml_data_parts(&assembled_with_block(base_block())).unwrap();
        let protein = TargetId::new("protein").unwrap();

        assert_eq!(schema.sources.len(), 1);
        assert_eq!(
            schema.sources[0].native_representation.id.as_str(),
            REPRESENTATION_SIGNAL_1D
        );
        assert_eq!(
            schema.sources[0].native_representation.axes[1].kind,
            AxisKind::Wavelength
        );
        assert_eq!(
            schema.targets[&protein].id.as_str(),
            REPRESENTATION_TARGET_NUMERIC
        );
        assert!(schema.metadata.contains_key(REPRESENTATION_SAMPLE_METADATA));
        assert!(schema
            .metadata_schema
            .as_ref()
            .is_some_and(|schema| schema.fields.contains_key("batch")));
        assert_eq!(
            plan.output_representation.as_str(),
            REPRESENTATION_SIGNAL_1D
        );
        let relations = relations.expect("relations");
        assert_eq!(relations.rows[0].sample_id.as_str(), "S1");
        assert_eq!(relations.rows[0].observation_id.as_str(), "O1");
        assert_eq!(
            relations.rows[0].target_id.as_ref().unwrap().as_str(),
            "protein"
        );
        assert_eq!(relations.rows[0].group_id.as_ref().unwrap().as_str(), "a");
        assert_eq!(
            relations.rows[0].repetition_id.as_ref().unwrap().as_str(),
            "1"
        );
        assert_eq!(
            relations.rows[0].source_id.as_ref().unwrap().as_str(),
            "spectra"
        );
    }

    #[test]
    fn emits_processing_stack_when_variations_exist() {
        let mut block = base_block();
        block.processings = vec![vec![("snv".into(), matrix(2, 3))]];

        let (schema, _plan, _relations) =
            build_dag_ml_data_parts(&assembled_with_block(block)).unwrap();
        let representation = &schema.sources[0].native_representation;

        assert_eq!(
            representation.id.as_str(),
            REPRESENTATION_SIGNAL_WITH_PROCESSINGS
        );
        assert_eq!(representation.rank, Some(3));
        assert_eq!(representation.axes[1].kind, AxisKind::Processing);
        assert_eq!(representation.axes[1].size, Some(2));
    }

    #[test]
    fn emits_feature_block_set_for_multi_source_join() {
        let mut block = base_block();
        block.x.push(matrix(2, 2));
        block.source_ids.push("markers".into());
        block
            .feature_headers
            .push(vec!["1200".into(), "1210".into()]);
        block.header_units.push("nm".into());
        block.signal_types.push(Some("reflectance".into()));
        block.processings.push(vec![]);

        let mut assembled = assembled_with_block(block);
        assembled.n_sources = 2;
        let (schema, plan, _relations) = build_dag_ml_data_parts(&assembled).unwrap();

        assert_eq!(schema.sources.len(), 2);
        assert_eq!(
            plan.output_representation.as_str(),
            REPRESENTATION_FEATURE_BLOCK_SET
        );
        assert!(plan.steps.iter().any(|step| {
            step.kind == DataPlanStepKind::Join
                && step
                    .output_representation
                    .as_ref()
                    .is_some_and(|id| id.as_str() == REPRESENTATION_FEATURE_BLOCK_SET)
        }));
    }

    #[test]
    fn emits_target_matrix_for_uniform_multivariate_targets() {
        let mut block = base_block();
        block.y = Some(matrix(2, 2));
        block.y_headers = vec!["protein".into(), "moisture".into()];

        let (schema, _plan, _relations) =
            build_dag_ml_data_parts(&assembled_with_block(block)).unwrap();
        let targets = TargetId::new("targets").unwrap();
        let target = &schema.targets[&targets];

        assert_eq!(target.id.as_str(), REPRESENTATION_TARGET_NUMERIC_MATRIX);
        assert_eq!(target.rank, Some(2));
        assert_eq!(target.axes[1].kind, AxisKind::Target);
        assert_eq!(target.axes[1].size, Some(2));
    }

    #[test]
    fn preserves_weights_partitions_and_fold_provenance() {
        let mut block = base_block();
        block.weights = Some(vec![0.25, 2.0]);
        block.weights_header = Some("quality_weight".into());
        let mut assembled = assembled_with_block(block);
        assembled.folds = vec![(vec![0], vec![1])];
        assembled.fold_provenance = vec![nirs4all_io::materialize::FoldProvenance {
            train_observation_ids: vec!["O1".into()],
            validation_observation_ids: vec!["O2".into()],
        }];

        let (schema, plan, relations) = build_dag_ml_data_parts(&assembled).unwrap();
        let relations = relations.expect("relations");
        assert_eq!(
            relations.rows[0].metadata["io.sample_weight"],
            Value::from(0.25_f32)
        );
        assert_eq!(
            relations.rows[0].metadata["io.sample_weight_column"],
            Value::String("quality_weight".into())
        );
        assert_eq!(
            relations.rows[0].metadata["io.partition"],
            Value::String("train".into())
        );
        assert_eq!(schema.folds.len(), 1);
        assert_eq!(
            schema.folds[0].metadata["io.validation_observation_ids"],
            Value::Array(vec![Value::String("O2".into())])
        );
        assert_eq!(
            plan.steps[0].metadata["io.partitions"],
            Value::Array(vec![Value::String("train".into())])
        );
        let envelope = to_dag_ml_data(&assembled).unwrap();
        assert_eq!(
            envelope.metadata["io.dataset_schema"]["targets"]["protein"]["id"],
            Value::String(REPRESENTATION_TARGET_NUMERIC.into())
        );
        assert_eq!(
            envelope.coordinator_relations.as_ref().unwrap().records[0].metadata
                ["io.sample_weight"],
            Value::from(0.25_f32)
        );
    }

    #[test]
    fn dataset_package_materializes_provider_without_spectrodataset() {
        let mut assembled = assembled_with_block(base_block());
        assembled.folds = vec![(vec![0], vec![1])];
        assembled.fold_provenance = vec![nirs4all_io::materialize::FoldProvenance {
            train_observation_ids: vec!["O1".into()],
            validation_observation_ids: vec!["O2".into()],
        }];

        // Rust loader output -> DatasetPackage -> dag-ml-data provider. No
        // JSON/pickle/Python/SpectroDataset adapter participates in this path.
        let package = to_dataset_package(&assembled);
        let provider = PackageProvider::from_package(&package).unwrap();
        let envelope = provider.envelope();
        let relations = &envelope.coordinator_relations.as_ref().unwrap().records;

        assert_eq!(provider.feature_set_id(), "spectra");
        assert_eq!(
            provider
                .target_ids()
                .iter()
                .map(TargetId::as_str)
                .collect::<Vec<_>>(),
            vec!["protein"]
        );
        assert_eq!(relations[0].sample_id.as_str(), "S1");
        assert_eq!(relations[0].observation_id.as_str(), "O1");
        assert_eq!(relations[0].group_id.as_ref().unwrap().as_str(), "a");
        assert_eq!(relations[0].source_id.as_ref().unwrap().as_str(), "spectra");
        assert_eq!(relations[0].target_id.as_ref().unwrap().as_str(), "protein");
        assert_eq!(
            envelope.metadata["io.dataset_schema"]["folds"][0]["id"],
            Value::String("io.fold.0".into())
        );
        assert_eq!(
            envelope.metadata["io.dataset_schema"]["folds"][0]["metadata"]
                ["io.train_observation_ids"],
            Value::Array(vec![Value::String("O1".into())])
        );

        let request = CoordinatorDataMaterializationRequest {
            run_id: "run.data002".into(),
            node_id: "model".into(),
            input_name: "X".into(),
            phase: "fit".into(),
            variant_id: None,
            fold_id: Some("io.fold.0".into()),
            request_id: "request.data002".into(),
            schema_fingerprint: envelope.schema_fingerprint.clone(),
            plan_fingerprint: envelope.plan_fingerprint.clone(),
            relation_fingerprint: envelope.relation_fingerprint.clone(),
            output_representation: envelope.plan.output_representation.clone(),
            source_ids: vec![SourceId::new("spectra").unwrap()],
            require_relations: true,
        };
        let data = provider.materialize(&request).unwrap();
        let view = provider
            .make_view(
                data.handle.handle,
                &DataView {
                    sample_ids: Some(vec![
                        SampleId::new("S2").unwrap(),
                        SampleId::new("S1").unwrap(),
                    ]),
                    include_augmented: true,
                    ..DataView::default()
                },
            )
            .unwrap();
        let view_relations = provider.view_identity(view.handle.handle).unwrap();
        assert_eq!(
            view_relations
                .records
                .iter()
                .map(|row| row.observation_id.as_str())
                .collect::<Vec<_>>(),
            vec!["O2", "O1"]
        );
        let features = provider
            .feature_block(view.handle.handle, provider.feature_set_id())
            .unwrap();
        assert_eq!(features.observation_ids[0].as_str(), "O2");
        assert_eq!(features.sample_ids[0].as_str(), "S2");
        assert_eq!(
            features.values,
            vec![
                vec![Value::from(3.0), Value::from(4.0), Value::from(5.0)],
                vec![Value::from(0.0), Value::from(1.0), Value::from(2.0)],
            ]
        );
        let protein = TargetId::new("protein").unwrap();
        let targets = provider.target_block(view.handle.handle, &protein).unwrap();
        assert_eq!(targets.sample_ids[0].as_str(), "S2");
        assert_eq!(targets.values, vec![Value::from(1.0), Value::from(0.0)]);
        assert!(provider.release(data.handle.handle));
    }

    #[test]
    fn preflight_refuses_repeated_samples_without_observation_provenance() {
        let mut assembled = assembled_with_block(base_block());
        assembled.identity.observation_id = None;
        let frame = assembled
            .blocks
            .get_mut("train")
            .unwrap()
            .metadata
            .as_mut()
            .unwrap();
        frame
            .columns
            .iter_mut()
            .find(|column| column.name == "sample_id")
            .unwrap()
            .values[1] = Cell::Str("S1".into());
        assert_eq!(
            preflight_identity(&assembled),
            Err(DagMlPreflightError::RepeatedSampleNeedsObservationId {
                sample_id: "S1".into()
            })
        );
    }

    #[test]
    fn folds_use_prepartition_observation_provenance_not_block_order() {
        let mut assembled = assembled_with_block(base_block());
        // Assemble blocks in a different order than the original combined frame.
        let mut test = base_block();
        test.metadata
            .as_mut()
            .unwrap()
            .columns
            .iter_mut()
            .for_each(|column| {
                column.values.reverse();
            });
        assembled.blocks.insert("test".into(), test);
        assembled.folds = vec![(vec![0, 1], vec![2])];
        assembled.fold_provenance = vec![nirs4all_io::materialize::FoldProvenance {
            train_observation_ids: vec!["O3".into(), "O1".into()],
            validation_observation_ids: vec!["O2".into()],
        }];
        // Keep the direct fixture's scientific identifiers globally unique.
        assembled
            .blocks
            .get_mut("test")
            .unwrap()
            .metadata
            .as_mut()
            .unwrap()
            .columns
            .iter_mut()
            .find(|column| column.name == "sample_id")
            .unwrap()
            .values = vec![Cell::Str("S4".into()), Cell::Str("S3".into())];
        assembled
            .blocks
            .get_mut("test")
            .unwrap()
            .metadata
            .as_mut()
            .unwrap()
            .columns
            .iter_mut()
            .find(|column| column.name == "scan_id")
            .unwrap()
            .values = vec![Cell::Str("O4".into()), Cell::Str("O3".into())];
        assembled
            .blocks
            .get_mut("test")
            .unwrap()
            .metadata
            .as_mut()
            .unwrap()
            .columns
            .iter_mut()
            .find(|column| column.name == "batch")
            .unwrap()
            .values = vec![Cell::Str("b".into()), Cell::Str("c".into())];
        // Use an existing observation in the provenance and verify exact order
        // rather than the materialized train/test row order.
        assembled.fold_provenance[0].train_observation_ids = vec!["O1".into(), "O4".into()];
        assembled.fold_provenance[0].validation_observation_ids = vec!["O3".into()];
        let (schema, _, _) = build_dag_ml_data_parts(&assembled).unwrap();
        assert_eq!(
            schema.folds[0].metadata["io.train_observation_ids"],
            Value::Array(vec![Value::String("O1".into()), Value::String("O4".into())])
        );
    }

    #[test]
    fn preflight_refuses_fold_overlap_and_group_leakage() {
        let mut assembled = assembled_with_block(base_block());
        assembled.folds = vec![(vec![0], vec![1])];
        assembled.fold_provenance = vec![nirs4all_io::materialize::FoldProvenance {
            train_observation_ids: vec!["O1".into()],
            validation_observation_ids: vec!["O1".into()],
        }];
        assert_eq!(
            preflight_identity(&assembled),
            Err(DagMlPreflightError::FoldTrainValidationOverlap {
                fold: 0,
                observation_id: "O1".into(),
            })
        );
        assembled.fold_provenance[0].validation_observation_ids = vec!["O2".into()];
        assembled
            .blocks
            .get_mut("train")
            .unwrap()
            .metadata
            .as_mut()
            .unwrap()
            .columns
            .iter_mut()
            .find(|column| column.name == "batch")
            .unwrap()
            .values[1] = Cell::Str("a".into());
        assert_eq!(
            preflight_identity(&assembled),
            Err(DagMlPreflightError::FoldGroupLeakage {
                fold: 0,
                group_id: "a".into(),
            })
        );

        assembled.fold_provenance[0] = nirs4all_io::materialize::FoldProvenance {
            train_observation_ids: vec!["O1".into(), "O1".into()],
            validation_observation_ids: vec!["O2".into()],
        };
        assert_eq!(
            preflight_identity(&assembled),
            Err(DagMlPreflightError::FoldDuplicateObservation {
                fold: 0,
                role: "train",
                observation_id: "O1".into(),
            })
        );
    }

    #[test]
    fn preflight_refuses_same_sample_across_fold_roles_without_group() {
        let mut assembled = assembled_with_block(base_block());
        assembled.identity.group_id = None;
        assembled.folds = vec![(vec![0], vec![1])];
        assembled.fold_provenance = vec![nirs4all_io::materialize::FoldProvenance {
            train_observation_ids: vec!["O1".into()],
            validation_observation_ids: vec!["O2".into()],
        }];
        assembled
            .blocks
            .get_mut("train")
            .unwrap()
            .metadata
            .as_mut()
            .unwrap()
            .columns
            .iter_mut()
            .find(|column| column.name == "sample_id")
            .unwrap()
            .values[1] = Cell::Str("S1".into());

        assert_eq!(
            preflight_identity(&assembled),
            Err(DagMlPreflightError::FoldSampleLeakage {
                fold: 0,
                sample_id: "S1".into(),
            })
        );
        let error = to_dag_ml_data(&assembled).unwrap_err();
        assert!(error.message.contains("leaks sample 'S1'"));
    }

    #[test]
    fn source_schema_is_a_validated_union_of_partition_blocks() {
        let mut assembled = assembled_with_block(base_block());
        let mut test = base_block();
        test.source_ids = vec!["markers".into()];
        test.feature_headers = vec![vec!["m1".into(), "m2".into(), "m3".into()]];
        test.metadata
            .as_mut()
            .unwrap()
            .columns
            .iter_mut()
            .for_each(|column| {
                if column.name == "sample_id" {
                    column.values = vec![Cell::Str("S3".into()), Cell::Str("S4".into())];
                }
                if column.name == "scan_id" {
                    column.values = vec![Cell::Str("O3".into()), Cell::Str("O4".into())];
                }
            });
        assembled.blocks.insert("test".into(), test);
        let (schema, _, relations) = build_dag_ml_data_parts(&assembled).unwrap();
        assert_eq!(schema.sources.len(), 2);
        assert_eq!(
            relations.unwrap().rows[2]
                .source_id
                .as_ref()
                .unwrap()
                .as_str(),
            "markers"
        );
    }
}
