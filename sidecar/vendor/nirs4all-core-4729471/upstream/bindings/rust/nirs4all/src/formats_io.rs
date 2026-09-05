//! Bounded composition of the real Formats parser and IO dataset assembler.
//!
//! Parsing stays in `nirs4all-formats`; dataset inference, assembly, and package
//! identity stay in `nirs4all-io`. This module only wires those public owner
//! APIs into the aggregate and selects the one source accepted by the existing
//! Core Methods provider.

use std::collections::{BTreeSet, HashMap};
use std::fmt;
use std::path::{Path, PathBuf};

use nirs4all_io_crate::core::infer::memory::{infer_decoded_records, DecodedRecordSet};
use nirs4all_io_crate::core::materialize::{
    assemble_in_memory, DatasetPackage, InMemorySource, SourcePayload,
};

use crate::DatasetPackageMethodsProvider;

/// A parsed and assembled single-source spectrum dataset.
#[derive(Debug, Clone)]
pub struct LoadedSpectrumDataset {
    pub path: PathBuf,
    pub format: String,
    pub record_count: usize,
    pub source_id: String,
    pub package: DatasetPackage,
}

/// Fail-closed errors from the owner APIs used by the aggregate composition.
#[derive(Debug)]
pub enum FormatsIoError {
    Format(nirs4all_formats_crate::Error),
    Serialization(serde_json::Error),
    Assembly(nirs4all_io_crate::core::SpecError),
    UnsupportedShape(String),
    Provider(String),
}

impl fmt::Display for FormatsIoError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Format(error) => {
                write!(
                    formatter,
                    "Formats parser refused the spectrum file: {error}"
                )
            }
            Self::Serialization(error) => {
                write!(formatter, "Formats record projection failed: {error}")
            }
            Self::Assembly(error) => {
                write!(formatter, "IO assembly refused Formats records: {error}")
            }
            Self::UnsupportedShape(detail) => {
                write!(
                    formatter,
                    "Core Formats/IO path does not support this shape: {detail}"
                )
            }
            Self::Provider(detail) => {
                write!(formatter, "Core provider refused IO package: {detail}")
            }
        }
    }
}

impl std::error::Error for FormatsIoError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Format(error) => Some(error),
            Self::Serialization(error) => Some(error),
            Self::Assembly(error) => Some(error),
            Self::UnsupportedShape(_) | Self::Provider(_) => None,
        }
    }
}

/// Parse one supported spectrum file and assemble it into IO's DatasetPackage.
///
/// The bounded CORE-001/002 path accepts one decoded source with explicit,
/// stable sample identity. Multi-source fusion, row-position identity, and
/// incompatible record shapes are rejected by Formats/IO or this preflight;
/// none fall back to a local parser or assembler.
pub fn load_spectrum_dataset_package(
    path: impl AsRef<Path>,
) -> Result<LoadedSpectrumDataset, FormatsIoError> {
    let path = path.as_ref();
    let records = nirs4all_formats_crate::open_path(path).map_err(FormatsIoError::Format)?;
    if records.is_empty() {
        return Err(FormatsIoError::UnsupportedShape(
            "the Formats reader returned no spectral records".to_string(),
        ));
    }

    let format = records[0].provenance.format.clone();
    if records
        .iter()
        .any(|record| record.provenance.format != format)
    {
        return Err(FormatsIoError::UnsupportedShape(
            "one file produced records with heterogeneous format identities".to_string(),
        ));
    }
    let source_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| {
            FormatsIoError::UnsupportedShape(
                "the source path has no UTF-8 file name for IO matching".to_string(),
            )
        })?
        .to_string();
    let record_count = records.len();
    let record_values = records
        .into_iter()
        .map(serde_json::to_value)
        .collect::<Result<Vec<_>, _>>()
        .map_err(FormatsIoError::Serialization)?;
    let decoded = DecodedRecordSet {
        source: source_name.clone(),
        format: Some(format.clone()),
        records: record_values.clone(),
    };
    let plan = infer_decoded_records(&[decoded]).map_err(FormatsIoError::Assembly)?;
    let spec = plan.resolved_spec.ok_or_else(|| {
        FormatsIoError::UnsupportedShape(
            "IO inference did not produce a resolved DatasetSpec".to_string(),
        )
    })?;
    let sources = [InMemorySource {
        name: source_name,
        payload: SourcePayload::Records(record_values),
    }];
    let assembled = assemble_in_memory(&spec, &sources, &HashMap::new(), None)
        .map_err(FormatsIoError::Assembly)?;
    let package = DatasetPackage::from_assembled(&assembled);
    if package.row_position_fallback.used {
        return Err(FormatsIoError::UnsupportedShape(format!(
            "stable sample identity is required ({})",
            package.row_position_fallback.reason
        )));
    }
    let source_ids = package
        .partitions
        .values()
        .flat_map(|partition| partition.source_ids.iter().cloned())
        .collect::<BTreeSet<_>>();
    if source_ids.len() != 1 {
        return Err(FormatsIoError::UnsupportedShape(format!(
            "exactly one IO feature source is required, found {}",
            source_ids.len()
        )));
    }
    let source_id = source_ids
        .into_iter()
        .next()
        .expect("one source checked above");

    Ok(LoadedSpectrumDataset {
        path: path.to_path_buf(),
        format,
        record_count,
        source_id,
        package,
    })
}

/// Reach the existing Core provider through the Formats → IO package path.
pub fn load_spectrum_methods_provider(
    path: impl AsRef<Path>,
) -> Result<DatasetPackageMethodsProvider, FormatsIoError> {
    let loaded = load_spectrum_dataset_package(path)?;
    DatasetPackageMethodsProvider::new(&loaded.package, &loaded.source_id)
        .map_err(FormatsIoError::Provider)
}
