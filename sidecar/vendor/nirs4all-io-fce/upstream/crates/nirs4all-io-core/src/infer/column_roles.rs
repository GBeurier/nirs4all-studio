// SPDX-License-Identifier: CeCILL-2.1 OR AGPL-3.0-or-later
//! Column-role + structure inference (ports the pure parts of `infer/engine.py`).
//!
//! `infer_column_roles` assigns each column a role (features/targets/metadata)
//! with evidence; `structure_kind` decides the dataset structure from a
//! convention match. Both pure (over `FileDescription`/`TableProfile`/a match).

use std::sync::LazyLock;

use regex::{Regex, RegexBuilder};
use serde_json::Value;

use super::describe::FileDescription;
use super::table::TableProfile;
use crate::conventions::ConventionResult;
use crate::spec::enums::{Partition, Role};

// Mirrors engine.py `_WL_RE` (identical to identity's WL regex).
static WL_RE: LazyLock<Regex> = LazyLock::new(|| {
    RegexBuilder::new(r"^\d+(\.\d+)?(nm|cm-1)?$")
        .case_insensitive(true)
        .build()
        .unwrap()
});

/// Assign a role to each column with evidence (heuristics A/C/I). Returns the
/// per-column guess dicts in header order (→ `plan.columns[].column_roles`).
pub fn infer_column_roles(desc: &FileDescription, table: &TableProfile) -> Vec<Value> {
    let headers: Vec<&str> = table.columns.iter().map(|c| c.name.as_str()).collect();
    let is_numeric = |h: &str| {
        table
            .column(h)
            .map(|c| c.is_numeric_dtype())
            .unwrap_or(false)
    };

    let wl_cols: Vec<&str> = if desc.is_wavelength_header {
        headers
            .iter()
            .copied()
            .filter(|h| WL_RE.is_match(h))
            .collect()
    } else {
        vec![]
    };
    let numeric_non_wl: Vec<&str> = headers
        .iter()
        .copied()
        .filter(|h| !wl_cols.contains(h) && is_numeric(h))
        .collect();

    let guess = |col: &str, role: Role, score: f64, ev: &str| serde_json::json!({"col": col, "role": role.value(), "score": score, "evidence": [ev]});

    headers
        .iter()
        .map(|&h| {
            if wl_cols.contains(&h) {
                guess(
                    h,
                    Role::Features,
                    0.9,
                    "monotonic nm/cm-1 wavelength column",
                )
            } else if !is_numeric(h) {
                guess(h, Role::Metadata, 0.7, "non-numeric / id-like column")
            } else if wl_cols.is_empty()
                && numeric_non_wl.last() == Some(&h)
                && numeric_non_wl.len() > 1
            {
                guess(h, Role::Targets, 0.6, "last numeric column (likely target)")
            } else if !wl_cols.is_empty()
                && numeric_non_wl.contains(&h)
                && numeric_non_wl.len() <= 3
            {
                guess(
                    h,
                    Role::Targets,
                    0.65,
                    "numeric non-wavelength column alongside a spectral block",
                )
            } else {
                guess(h, Role::Features, 0.55, "numeric column")
            }
        })
        .collect()
}

/// Decide `(structure_kind, score)` from a convention match.
pub fn structure_kind(result: &ConventionResult) -> (&'static str, f64) {
    let partitions: std::collections::HashSet<Partition> = result
        .assignments
        .iter()
        .filter_map(|a| a.partition)
        .collect();
    let roles: std::collections::HashSet<Role> =
        result.assignments.iter().map(|a| a.role).collect();
    if partitions.len() > 1 {
        ("train_test_folder", 0.92)
    } else if roles.contains(&Role::Features) && roles.contains(&Role::Targets) {
        ("x_y_separate", 0.85)
    } else {
        ("single_partition_folder", 0.8)
    }
}

#[cfg(test)]
mod tests {
    use super::super::table::{ColDtype, ColumnProfile, NumericKind, TableProfile};
    use super::*;

    fn ncol(name: &str, numeric: bool) -> ColumnProfile {
        ColumnProfile {
            name: name.into(),
            dtype: if numeric {
                ColDtype::Numeric
            } else {
                ColDtype::String
            },
            numeric_kind: if numeric {
                NumericKind::Float
            } else {
                NumericKind::NonNumeric
            },
            nunique_with_na: 6,
            is_unique: false,
            str_values: vec![],
            numeric_values: vec![],
        }
    }

    #[test]
    fn combined_no_wl_last_numeric_is_target() {
        // data.csv: has_header verdict false -> is_wavelength_header false -> no wl_cols.
        let mut cols: Vec<ColumnProfile> = (0..12)
            .map(|i| ncol(&(1000 + i * 5).to_string(), true))
            .collect();
        cols.push(ncol("protein", true));
        let table = TableProfile {
            n_rows: 6,
            columns: cols,
        };
        let desc = FileDescription {
            is_wavelength_header: false,
            ..Default::default()
        };
        let guesses = infer_column_roles(&desc, &table);
        assert_eq!(guesses.len(), 13);
        assert_eq!(guesses[0]["role"], "features");
        assert_eq!(guesses[0]["score"], serde_json::json!(0.55));
        assert_eq!(guesses[12]["col"], "protein");
        assert_eq!(guesses[12]["role"], "targets");
        assert_eq!(guesses[12]["score"], serde_json::json!(0.6));
    }
}
