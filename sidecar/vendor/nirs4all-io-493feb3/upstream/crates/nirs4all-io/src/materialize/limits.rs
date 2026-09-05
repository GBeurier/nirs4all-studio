// SPDX-License-Identifier: CeCILL-2.1 OR AGPL-3.0-or-later
//! Host-selected resource budgets, deliberately separate from DatasetSpec.

use std::io::Read;
use std::path::Path;

use nirs4all_io_core::materialize::TabularReadLimits;
use nirs4all_io_core::spec::SpecError;
use serde::{Deserialize, Serialize};

/// Compatibility-oriented ceilings, not a promise that the host has enough RAM.
/// Application hosts should tighten them; trusted batch hosts may raise each
/// field or explicitly select [`Self::unlimited`]. Never read limits from data.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct LoadLimits {
    pub max_file_bytes: u64,
    pub max_total_bytes: u64,
    pub max_decoded_file_bytes: u64,
    pub max_decoded_total_bytes: u64,
    pub max_files: u64,
    pub max_record_bytes: u64,
    pub max_field_bytes: u64,
    pub max_rows: u64,
    pub max_columns: u64,
    pub max_cells: u64,
}

impl Default for LoadLimits {
    fn default() -> Self {
        Self {
            max_file_bytes: 2 << 30,
            max_total_bytes: 8 << 30,
            max_decoded_file_bytes: 4 << 30,
            max_decoded_total_bytes: 16 << 30,
            max_files: 100_000,
            max_record_bytes: 64 << 20,
            max_field_bytes: 16 << 20,
            max_rows: 10_000_000,
            max_columns: 1_000_000,
            max_cells: 1 << 30,
        }
    }
}

impl LoadLimits {
    /// Explicit opt-out for trusted inputs; integer overflow checks still apply.
    pub const fn unlimited() -> Self {
        Self {
            max_file_bytes: u64::MAX,
            max_total_bytes: u64::MAX,
            max_decoded_file_bytes: u64::MAX,
            max_decoded_total_bytes: u64::MAX,
            max_files: u64::MAX,
            max_record_bytes: u64::MAX,
            max_field_bytes: u64::MAX,
            max_rows: u64::MAX,
            max_columns: u64::MAX,
            max_cells: u64::MAX,
        }
    }

    /// Parse a host options object, or the explicit string `"unlimited"`.
    pub fn from_value(value: &serde_json::Value) -> Result<Self, SpecError> {
        let limits = if value.as_str() == Some("unlimited") {
            Self::unlimited()
        } else {
            serde_json::from_value(value.clone())
                .map_err(|error| SpecError::new(format!("invalid load limits: {error}")))?
        };
        limits.validate()?;
        Ok(limits)
    }

    pub fn validate(self) -> Result<(), SpecError> {
        if [
            self.max_file_bytes,
            self.max_total_bytes,
            self.max_decoded_file_bytes,
            self.max_decoded_total_bytes,
            self.max_files,
            self.max_record_bytes,
            self.max_field_bytes,
            self.max_rows,
            self.max_columns,
            self.max_cells,
        ]
        .contains(&0)
        {
            return Err(SpecError::new("load limits must be greater than zero"));
        }
        Ok(())
    }

    pub fn tabular(self) -> TabularReadLimits {
        TabularReadLimits::new(
            self.max_record_bytes,
            self.max_field_bytes,
            self.max_rows,
            self.max_columns,
            self.max_cells,
        )
    }
}

/// One accounting scope for config, source/variation, index and fold reads.
pub(crate) struct ReadBudget {
    pub limits: LoadLimits,
    total: u64,
    decoded: u64,
    files: u64,
}

impl ReadBudget {
    pub fn new(limits: LoadLimits) -> Result<Self, SpecError> {
        limits.validate()?;
        Ok(Self {
            limits,
            total: 0,
            decoded: 0,
            files: 0,
        })
    }

    pub fn read_raw(&mut self, path: &Path) -> Result<Vec<u8>, SpecError> {
        self.read_raw_with_allowance(path, u64::MAX)
    }

    fn read_raw_with_allowance(
        &mut self,
        path: &Path,
        additional: u64,
    ) -> Result<Vec<u8>, SpecError> {
        if self.files >= self.limits.max_files {
            return Err(limit_error("max_files", self.limits.max_files));
        }
        let file = std::fs::File::open(path)
            .map_err(|e| SpecError::new(format!("file not found: {} ({e})", path.display())))?;
        let metadata = file
            .metadata()
            .map_err(|e| SpecError::new(format!("cannot inspect {}: {e}", path.display())))?;
        if !metadata.is_file() {
            return Err(SpecError::new(format!(
                "input is not a regular file: {}",
                path.display()
            )));
        }
        let allowance = self
            .limits
            .max_file_bytes
            .min(self.limits.max_total_bytes.saturating_sub(self.total))
            .min(additional);
        if metadata.len() > allowance {
            return Err(limit_error("file/total bytes", allowance));
        }
        let bytes = read_bounded(file, allowance, "file/total bytes")?;
        self.total = self
            .total
            .checked_add(bytes.len() as u64)
            .ok_or_else(|| limit_error("total bytes overflow", self.limits.max_total_bytes))?;
        self.files += 1;
        Ok(bytes)
    }

    pub fn decoded_allowance(&self) -> u64 {
        self.limits.max_decoded_file_bytes.min(
            self.limits
                .max_decoded_total_bytes
                .saturating_sub(self.decoded),
        )
    }

    pub fn charge_decoded(&mut self, bytes: u64) -> Result<(), SpecError> {
        if bytes > self.decoded_allowance() {
            return Err(limit_error(
                "decoded file/total bytes",
                self.decoded_allowance(),
            ));
        }
        self.decoded = self.decoded.checked_add(bytes).ok_or_else(|| {
            limit_error(
                "decoded bytes overflow",
                self.limits.max_decoded_total_bytes,
            )
        })?;
        Ok(())
    }

    pub fn read(&mut self, path: &Path) -> Result<Vec<u8>, SpecError> {
        let lower = path.to_string_lossy().to_ascii_lowercase();
        let compressed = lower.ends_with(".gz") || lower.ends_with(".zip");
        let raw = self.read_raw_with_allowance(
            path,
            if compressed {
                u64::MAX
            } else {
                self.decoded_allowance()
            },
        )?;
        let bytes = if lower.ends_with(".gz") {
            read_bounded(
                flate2::read::GzDecoder::new(raw.as_slice()),
                self.decoded_allowance(),
                "gzip decoded bytes",
            )?
        } else if lower.ends_with(".zip") {
            let mut archive = zip::ZipArchive::new(std::io::Cursor::new(raw)).map_err(|e| {
                SpecError::new(format!("zip open failed for {}: {e}", path.display()))
            })?;
            if archive.is_empty() {
                return Err(SpecError::new(format!(
                    "empty zip archive: {}",
                    path.display()
                )));
            }
            let entry = archive.by_index(0).map_err(|e| {
                SpecError::new(format!("zip entry read failed for {}: {e}", path.display()))
            })?;
            if entry.size() > self.decoded_allowance() {
                return Err(limit_error("zip decoded bytes", self.decoded_allowance()));
            }
            read_bounded(entry, self.decoded_allowance(), "zip decoded bytes")?
        } else {
            raw
        };
        self.charge_decoded(bytes.len() as u64)?;
        Ok(bytes)
    }
}

pub(crate) fn limit_error(label: &str, maximum: u64) -> SpecError {
    SpecError::new(format!("load limit exceeded: {label} (maximum {maximum}); raise host limits explicitly for trusted larger inputs"))
}

/// Read only up to the allowed payload plus one byte; reserve in small fallible
/// increments rather than trusting a declared size or allocating the ceiling.
fn read_bounded(reader: impl Read, maximum: u64, label: &str) -> Result<Vec<u8>, SpecError> {
    let mut reader = reader.take(maximum.saturating_add(1));
    let mut bytes = Vec::new();
    let mut chunk = [0u8; 8192];
    loop {
        let count = reader
            .read(&mut chunk)
            .map_err(|e| SpecError::new(format!("{label} read failed: {e}")))?;
        if count == 0 {
            break;
        }
        let next = bytes
            .len()
            .checked_add(count)
            .ok_or_else(|| limit_error(label, maximum))?;
        if next as u64 > maximum {
            return Err(limit_error(label, maximum));
        }
        bytes
            .try_reserve(count)
            .map_err(|e| SpecError::new(format!("input allocation failed: {e}")))?;
        bytes.extend_from_slice(&chunk[..count]);
    }
    Ok(bytes)
}
