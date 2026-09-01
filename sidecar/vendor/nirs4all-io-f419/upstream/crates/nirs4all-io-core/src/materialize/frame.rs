// SPDX-License-Identifier: CeCILL-2.1 OR AGPL-3.0-or-later
//! A minimal pandas-faithful typed frame for materialization.
//!
//! Columns carry a uniform pandas-like dtype (int64 / float64 / object) inferred
//! the way pandas infers a CSV column. The frame supports the operations the
//! join engine and assembler need (select, mask, add-column, coerce-to-matrix)
//! and produces the neutral `TableProfile` the core inference consumes.

use std::collections::HashSet;

use crate::infer::table::{ColDtype, ColumnProfile, NumericKind, TableProfile};
use crate::pyfmt::py_str_scalar;
use serde_json::Value;

/// A pandas-typed cell. Within a column all cells share the column dtype
/// (`Bool`, `Int` for int64, `Float` for float64 with `NaN`=NA, `Str`/`Na`
/// for object).
#[derive(Debug, Clone, PartialEq)]
pub enum Cell {
    Bool(bool),
    Int(i64),
    Float(f64),
    Str(String),
    Na,
}

impl Cell {
    /// `to_numeric(errors="coerce")` → f64 (NaN for non-numeric / NA).
    pub fn to_numeric(&self) -> f64 {
        match self {
            Cell::Bool(b) => i64::from(*b) as f64,
            Cell::Int(i) => *i as f64,
            Cell::Float(f) => *f,
            Cell::Str(s) => s.trim().parse::<f64>().unwrap_or(f64::NAN),
            Cell::Na => f64::NAN,
        }
    }
    /// `py_str_scalar` of the pandas-typed value.
    pub fn to_str_scalar(&self) -> String {
        match self {
            Cell::Bool(b) => {
                if *b {
                    "True".to_string()
                } else {
                    "False".to_string()
                }
            }
            Cell::Int(i) => i.to_string(),
            Cell::Float(f) => py_str_scalar(&Value::from(*f)),
            Cell::Str(s) => s.clone(),
            Cell::Na => "nan".to_string(),
        }
    }
    /// A hashable identity for `nunique`/grouping (pandas: all NaN are one group).
    fn group_key(&self) -> GroupKey {
        match self {
            Cell::Bool(b) => GroupKey::Bool(*b),
            Cell::Int(i) => GroupKey::Num((*i as f64).to_bits()),
            Cell::Float(f) if f.is_nan() => GroupKey::Na,
            Cell::Float(f) => GroupKey::Num(f.to_bits()),
            Cell::Str(s) => GroupKey::Str(s.clone()),
            Cell::Na => GroupKey::Na,
        }
    }

    /// A join-match key: `Int(1)` and `Float(1.0)` unify; NaN/NA never match
    /// (returns `None`), mirroring pandas merge (NaN keys don't join).
    pub fn join_key(&self) -> Option<JoinKey> {
        match self {
            Cell::Bool(b) => Some(JoinKey::Bool(*b)),
            Cell::Int(i) => Some(JoinKey::Num((*i as f64).to_bits())),
            Cell::Float(f) if f.is_nan() => None,
            Cell::Float(f) => Some(JoinKey::Num(f.to_bits())),
            Cell::Str(s) => Some(JoinKey::Str(s.clone())),
            Cell::Na => None,
        }
    }
}

/// A hashable join key (numeric values unified by f64 bits; strings verbatim).
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum JoinKey {
    Bool(bool),
    Num(u64),
    Str(String),
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
enum GroupKey {
    Bool(bool),
    Num(u64),
    Str(String),
    Na,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Column {
    pub name: String,
    pub dtype: ColDtype,
    pub numeric_kind: NumericKind,
    pub values: Vec<Cell>,
}

impl Column {
    pub fn is_float_dtype(&self) -> bool {
        self.numeric_kind == NumericKind::Float
    }
    pub fn is_numeric_dtype(&self) -> bool {
        self.numeric_kind != NumericKind::NonNumeric
    }
    pub fn nunique_with_na(&self) -> usize {
        self.values
            .iter()
            .map(Cell::group_key)
            .collect::<HashSet<_>>()
            .len()
    }
    /// Build a column from cells, inferring the pandas dtype: object if any
    /// string; bool if all-bool; int64 if all-int and no NA; else float64
    /// (with int/bool→float and NA→NaN promotion, as pandas does on a join/concat).
    pub fn from_cells(name: &str, cells: Vec<Cell>) -> Column {
        let mut any_str = false;
        let mut any_bool = false;
        let mut any_na = false;
        let mut all_int = true;
        let mut all_bool = true;
        for c in &cells {
            match c {
                Cell::Str(_) => {
                    any_str = true;
                    all_int = false;
                    all_bool = false;
                }
                Cell::Bool(_) => {
                    any_bool = true;
                    all_int = false;
                }
                Cell::Float(f) => {
                    all_int = false;
                    all_bool = false;
                    if f.is_nan() {
                        any_na = true;
                    }
                }
                Cell::Na => {
                    any_na = true;
                    all_int = false;
                }
                Cell::Int(_) => {
                    all_bool = false;
                }
            }
        }
        if any_str {
            Column {
                name: name.into(),
                dtype: ColDtype::String,
                numeric_kind: NumericKind::NonNumeric,
                values: cells,
            }
        } else if any_bool && all_bool {
            Column {
                name: name.into(),
                dtype: ColDtype::Bool,
                numeric_kind: NumericKind::NonFloatNumeric,
                values: cells,
            }
        } else if all_int && !any_na {
            Column {
                name: name.into(),
                dtype: ColDtype::Numeric,
                numeric_kind: NumericKind::NonFloatNumeric,
                values: cells,
            }
        } else {
            let values = cells
                .into_iter()
                .map(|c| match c {
                    Cell::Bool(b) => Cell::Float(i64::from(b) as f64),
                    Cell::Int(i) => Cell::Float(i as f64),
                    Cell::Na => Cell::Float(f64::NAN),
                    other => other,
                })
                .collect();
            Column {
                name: name.into(),
                dtype: ColDtype::Numeric,
                numeric_kind: NumericKind::Float,
                values,
            }
        }
    }

    fn to_profile(&self, n_rows: usize) -> ColumnProfile {
        let nunique = self.nunique_with_na();
        ColumnProfile {
            name: self.name.clone(),
            dtype: self.dtype,
            numeric_kind: self.numeric_kind,
            nunique_with_na: nunique,
            is_unique: nunique == n_rows,
            str_values: self.values.iter().map(Cell::to_str_scalar).collect(),
            numeric_values: self.values.iter().map(Cell::to_numeric).collect(),
        }
    }
}

/// A column-major typed frame.
#[derive(Debug, Clone, PartialEq)]
pub struct Frame {
    pub columns: Vec<Column>,
    pub n_rows: usize,
    pub header_unit: String,
}

/// A row-major dense `f32` matrix (an assembled feature/variation block).
#[derive(Debug, Clone, PartialEq)]
pub struct Matrix {
    pub data: Vec<f32>,
    pub n_rows: usize,
    pub n_cols: usize,
}

impl Frame {
    pub fn empty() -> Self {
        Frame {
            columns: vec![],
            n_rows: 0,
            header_unit: "text".into(),
        }
    }

    /// Build a frame from columns (n_rows from the first column).
    pub fn from_columns(columns: Vec<Column>, header_unit: &str) -> Frame {
        let n_rows = columns.first().map(|c| c.values.len()).unwrap_or(0);
        Frame {
            columns,
            n_rows,
            header_unit: header_unit.into(),
        }
    }

    /// Per-row join keys over `keys` (`None` if any key cell is NA — never matches).
    pub fn join_key_tuples(&self, keys: &[String]) -> Vec<Option<Vec<JoinKey>>> {
        let cols: Vec<&Column> = keys.iter().filter_map(|k| self.column(k)).collect();
        (0..self.n_rows)
            .map(|row| {
                let mut tuple = Vec::with_capacity(cols.len());
                for c in &cols {
                    match c.values[row].join_key() {
                        Some(k) => tuple.push(k),
                        None => return None,
                    }
                }
                Some(tuple)
            })
            .collect()
    }

    /// Whether any two rows share a key (pandas `duplicated(subset=keys)`; NA groups).
    pub fn has_duplicate_keys(&self, keys: &[String]) -> bool {
        let cols: Vec<&Column> = keys.iter().filter_map(|k| self.column(k)).collect();
        let mut seen: HashSet<Vec<GroupKey>> = HashSet::new();
        for row in 0..self.n_rows {
            let tuple: Vec<GroupKey> = cols.iter().map(|c| c.values[row].group_key()).collect();
            if !seen.insert(tuple) {
                return true;
            }
        }
        false
    }

    pub fn column_names(&self) -> Vec<String> {
        self.columns.iter().map(|c| c.name.clone()).collect()
    }

    pub fn dtype_labels(&self) -> Vec<String> {
        self.columns
            .iter()
            .map(|c| c.dtype.label().to_string())
            .collect()
    }

    pub fn column(&self, name: &str) -> Option<&Column> {
        self.columns.iter().find(|c| c.name == name)
    }

    pub fn has_column(&self, name: &str) -> bool {
        self.column(name).is_some()
    }

    pub fn to_table_profile(&self) -> TableProfile {
        TableProfile {
            n_rows: self.n_rows,
            columns: self
                .columns
                .iter()
                .map(|c| c.to_profile(self.n_rows))
                .collect(),
        }
    }

    /// `to_numeric(errors="coerce")` of a column as f64 (for task detection).
    pub fn numeric_column_f64(&self, name: &str) -> Vec<f64> {
        self.column(name)
            .map(|c| c.values.iter().map(Cell::to_numeric).collect())
            .unwrap_or_default()
    }

    /// `py_str_scalar` rendering of a column (for ids / coverage).
    pub fn str_column(&self, name: &str) -> Vec<String> {
        self.column(name)
            .map(|c| c.values.iter().map(Cell::to_str_scalar).collect())
            .unwrap_or_default()
    }

    /// Row-major feature matrix over `cols`, f32-widened to f64 (mirrors
    /// `coerce_numeric` → float32 → widen) for `detect_signal_type`.
    pub fn feature_matrix_f32(&self, cols: &[String]) -> (Vec<f64>, usize) {
        let m = self.coerce_numeric(cols);
        (m.data.iter().map(|&v| v as f64).collect(), m.n_cols)
    }

    /// `coerce_numeric(df[cols])` → row-major `f32` matrix (non-numeric → NaN).
    pub fn coerce_numeric(&self, cols: &[String]) -> Matrix {
        let n_cols = cols.len();
        let mut data = Vec::with_capacity(self.n_rows * n_cols);
        for row in 0..self.n_rows {
            for name in cols {
                let v = self
                    .column(name)
                    .map(|c| c.values[row].to_numeric())
                    .unwrap_or(f64::NAN);
                data.push(v as f32);
            }
        }
        Matrix {
            data,
            n_rows: self.n_rows,
            n_cols,
        }
    }

    /// Append an int64 column (e.g. the row-index sentinel).
    pub fn add_int_column(&mut self, name: &str, values: Vec<i64>) {
        self.columns.push(Column {
            name: name.into(),
            dtype: ColDtype::Numeric,
            numeric_kind: NumericKind::NonFloatNumeric,
            values: values.into_iter().map(Cell::Int).collect(),
        });
    }

    /// Append an object (string) column.
    pub fn add_str_column(&mut self, name: &str, values: Vec<String>) {
        self.columns.push(Column {
            name: name.into(),
            dtype: ColDtype::String,
            numeric_kind: NumericKind::NonNumeric,
            values: values.into_iter().map(Cell::Str).collect(),
        });
    }

    /// A new frame with only `cols` (preserving order), rows unchanged.
    pub fn select(&self, cols: &[String]) -> Frame {
        let columns = cols
            .iter()
            .filter_map(|name| self.column(name).cloned())
            .collect();
        Frame {
            columns,
            n_rows: self.n_rows,
            header_unit: self.header_unit.clone(),
        }
    }

    /// A new frame keeping only rows where `mask[i]` is true.
    pub fn mask_rows(&self, mask: &[bool]) -> Frame {
        let columns = self
            .columns
            .iter()
            .map(|c| Column {
                name: c.name.clone(),
                dtype: c.dtype,
                numeric_kind: c.numeric_kind,
                values: c
                    .values
                    .iter()
                    .zip(mask)
                    .filter(|(_, &m)| m)
                    .map(|(v, _)| v.clone())
                    .collect(),
            })
            .collect();
        Frame {
            columns,
            n_rows: mask.iter().filter(|&&m| m).count(),
            header_unit: self.header_unit.clone(),
        }
    }
}
