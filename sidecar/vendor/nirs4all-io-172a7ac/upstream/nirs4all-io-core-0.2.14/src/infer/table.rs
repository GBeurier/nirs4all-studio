// SPDX-License-Identifier: CeCILL-2.1 OR AGPL-3.0-or-later
//! Neutral table interface consumed by core inference, populated by the facade.
//!
//! The facade is the single place that mirrors pandas (dtype inference,
//! `nunique(dropna=False)`, `is_unique`, `py_str_scalar` rendering, `to_numeric`
//! coercion, the f32 widening). Core trusts these labels verbatim, keeping all
//! role/dataset inference pure (no `Path`/`Frame`/bytes).

/// Mirrors pandas `is_float_dtype` / `is_numeric_dtype` / object.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NumericKind {
    /// float dtype (pandas `is_float_dtype` true).
    Float,
    /// integer/bool numeric (pandas `is_numeric_dtype` true, `is_float_dtype` false).
    NonFloatNumeric,
    /// object/string/datetime (pandas `is_numeric_dtype` false).
    NonNumeric,
}

/// Coarse dtype label for `DtypeSelector` (`infer_dtypes` output).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ColDtype {
    Numeric,
    String,
    Datetime,
    Bool,
}

impl ColDtype {
    /// The string label the `dtype` selector matches on.
    pub fn label(&self) -> &'static str {
        match self {
            ColDtype::Numeric => "numeric",
            ColDtype::String => "string",
            ColDtype::Datetime => "datetime",
            ColDtype::Bool => "bool",
        }
    }
}

#[derive(Debug, Clone)]
pub struct ColumnProfile {
    pub name: String,
    pub dtype: ColDtype,
    pub numeric_kind: NumericKind,
    /// pandas `nunique(dropna=False)`.
    pub nunique_with_na: usize,
    /// pandas `Series.is_unique` (`nunique_with_na == n_rows`).
    pub is_unique: bool,
    /// `py_str_scalar(cell)` in row order (for id/coverage columns).
    pub str_values: Vec<String>,
    /// `to_numeric(errors="coerce")` values (NaN = missing), for detectors.
    pub numeric_values: Vec<f64>,
}

impl ColumnProfile {
    pub fn is_float_dtype(&self) -> bool {
        self.numeric_kind == NumericKind::Float
    }
    pub fn is_numeric_dtype(&self) -> bool {
        self.numeric_kind != NumericKind::NonNumeric
    }
}

#[derive(Debug, Clone)]
pub struct TableProfile {
    pub n_rows: usize,
    pub columns: Vec<ColumnProfile>,
}

impl TableProfile {
    pub fn column(&self, name: &str) -> Option<&ColumnProfile> {
        self.columns.iter().find(|c| c.name == name)
    }
    pub fn has_column(&self, name: &str) -> bool {
        self.columns.iter().any(|c| c.name == name)
    }
    pub fn column_names(&self) -> Vec<String> {
        self.columns.iter().map(|c| c.name.clone()).collect()
    }
}
