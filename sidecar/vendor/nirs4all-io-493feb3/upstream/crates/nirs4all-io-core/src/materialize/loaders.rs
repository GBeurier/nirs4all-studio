// SPDX-License-Identifier: CeCILL-2.1 OR AGPL-3.0-or-later
//! Tabular loaders (ports the pure CSV-from-bytes path of `materialize/loaders.py`).
//!
//! Decodes delimited bytes into a typed [`Frame`] whose per-column dtype
//! inference mirrors pandas: a column is int64 only if every non-NA cell is an
//! integer literal and there is no NA; float64 if every non-NA cell parses as a
//! float (NA promotes int→float); object/string otherwise.
//!
//! This module is fs-free: it operates on bytes already read (and decompressed)
//! by the caller. The facade owns the file-read + gzip/zip decompression and
//! then delegates here, so the same decoder backs both the native (path) and the
//! in-memory paths.

use std::sync::LazyLock;

use crate::infer::table::{ColDtype, NumericKind};
use crate::spec::dataset_spec::{FormatParams, LoadingParams, NaConfig};
use crate::spec::enums::{FillMethod, NaPolicy};
use crate::spec::SpecError;
use serde_json::Value;

use super::frame::{Cell, Column, Frame};

/// Back-compat alias for the inference path.
pub type LoadedTable = Frame;

/// Streaming shape budgets applied while decoding one tabular byte source.
///
/// Record and field sizes count decoded CSV payload bytes (delimiters and CSV
/// quoting are not included). Rows exclude the optional header. The cell cap
/// covers both decoded data fields and the rectangular frame that will be
/// materialized, so ragged input cannot hide a large allocation.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct TabularReadLimits {
    pub max_record_bytes: u64,
    pub max_field_bytes: u64,
    pub max_rows: u64,
    pub max_columns: u64,
    pub max_cells: u64,
}

impl TabularReadLimits {
    /// Check a rectangular allocation before creating/copying its cells.
    pub fn check_shape(self, rows: u64, columns: u64) -> Result<(), SpecError> {
        if rows > self.max_rows {
            return Err(SpecError::new(format!(
                "load limit exceeded: rows (maximum {})",
                self.max_rows
            )));
        }
        if columns > self.max_columns {
            return Err(SpecError::new(format!(
                "load limit exceeded: columns (maximum {})",
                self.max_columns
            )));
        }
        let cells = rows
            .checked_mul(columns)
            .ok_or_else(|| SpecError::new("load limit exceeded: shape overflow"))?;
        if cells > self.max_cells {
            return Err(SpecError::new(format!(
                "load limit exceeded: cells (maximum {})",
                self.max_cells
            )));
        }
        Ok(())
    }

    pub const fn new(
        max_record_bytes: u64,
        max_field_bytes: u64,
        max_rows: u64,
        max_columns: u64,
        max_cells: u64,
    ) -> Self {
        Self {
            max_record_bytes,
            max_field_bytes,
            max_rows,
            max_columns,
            max_cells,
        }
    }
}

fn merge_na(base: &NaConfig, over: &NaConfig) -> NaConfig {
    if over.policy == NaPolicy::Auto && over.fill_method.is_none() {
        return base.clone();
    }
    NaConfig {
        policy: if over.policy != NaPolicy::Auto {
            over.policy
        } else {
            base.policy
        },
        fill_method: over.fill_method.or(base.fill_method),
        fill_value: if !over.fill_value.is_null() {
            over.fill_value.clone()
        } else {
            base.fill_value.clone()
        },
        fill_per_column: over.fill_per_column,
    }
}

/// Merge global + source loading params (source wins on explicitly-set fields).
pub fn effective_params(global: &LoadingParams, source: &LoadingParams) -> LoadingParams {
    let or_str = |o: &Option<String>, b: &Option<String>| {
        o.clone().filter(|s| !s.is_empty()).or_else(|| b.clone())
    };
    let mut fmt = global.format.values.clone();
    for (k, v) in &source.format.values {
        fmt.insert(k.clone(), v.clone());
    }
    LoadingParams {
        delimiter: or_str(&source.delimiter, &global.delimiter),
        decimal_separator: or_str(&source.decimal_separator, &global.decimal_separator),
        has_header: source.has_header.or(global.has_header),
        header_unit: source.header_unit.or(global.header_unit),
        signal_type: source.signal_type.or(global.signal_type),
        encoding: or_str(&source.encoding, &global.encoding),
        na: merge_na(&global.na, &source.na),
        categorical: source.categorical.or(global.categorical),
        format: FormatParams { values: fmt },
    }
}

/// pandas `keep_default_na=True` default set ∪ io's `_NA_VALUES`.
static NA_TOKENS: LazyLock<std::collections::HashSet<&'static str>> = LazyLock::new(|| {
    [
        "#N/A", "#N/A N/A", "#NA", "-1.#IND", "-1.#QNAN", "-NaN", "-nan", "1.#IND", "1.#QNAN",
        "<NA>", "N/A", "NA", "NULL", "NaN", "None", "n/a", "nan", "null", "",
    ]
    .into_iter()
    .collect()
});

fn is_na(cell: &str) -> bool {
    NA_TOKENS.contains(cell)
}

/// pandas integer-literal test: optional sign + ASCII digits (no `.`/`e`).
fn parse_int_literal(s: &str) -> Option<i64> {
    let t = s.trim();
    if t.is_empty() {
        return None;
    }
    let body = t.strip_prefix(['+', '-']).unwrap_or(t);
    if !body.is_empty() && body.bytes().all(|b| b.is_ascii_digit()) {
        t.parse::<i64>().ok()
    } else {
        None
    }
}

fn parse_float(s: &str) -> Option<f64> {
    let t = s.trim();
    if t.is_empty() {
        return None;
    }
    t.parse::<f64>().ok()
}

fn infer_column(name: &str, raw: &[String], decimal: char) -> Column {
    let norm = |c: &str| -> String {
        if decimal == ',' {
            c.replace(',', ".")
        } else {
            c.to_string()
        }
    };
    let mut has_na = false;
    let mut all_int = true;
    let mut all_numeric = true;
    for cell in raw {
        if is_na(cell) {
            has_na = true;
            continue;
        }
        let n = norm(cell);
        if parse_int_literal(&n).is_none() {
            all_int = false;
        }
        if parse_float(&n).is_none() {
            all_numeric = false;
        }
    }

    if all_numeric && all_int && !has_na {
        Column {
            name: name.into(),
            dtype: ColDtype::Numeric,
            numeric_kind: NumericKind::NonFloatNumeric,
            values: raw
                .iter()
                .map(|c| Cell::Int(parse_int_literal(&norm(c)).unwrap()))
                .collect(),
        }
    } else if all_numeric {
        Column {
            name: name.into(),
            dtype: ColDtype::Numeric,
            numeric_kind: NumericKind::Float,
            values: raw
                .iter()
                .map(|c| {
                    if is_na(c) {
                        Cell::Float(f64::NAN)
                    } else {
                        Cell::Float(parse_float(&norm(c)).unwrap())
                    }
                })
                .collect(),
        }
    } else {
        Column {
            name: name.into(),
            dtype: ColDtype::String,
            numeric_kind: NumericKind::NonNumeric,
            values: raw
                .iter()
                .map(|c| {
                    if is_na(c) {
                        Cell::Na
                    } else {
                        Cell::Str(c.clone())
                    }
                })
                .collect(),
        }
    }
}

fn header_unit(params: &LoadingParams, has_header: bool) -> String {
    match params.header_unit {
        Some(u) => u.value().to_string(),
        None => if has_header { "text" } else { "index" }.to_string(),
    }
}

fn cell_is_na(cell: &Cell) -> bool {
    matches!(cell, Cell::Na) || matches!(cell, Cell::Float(f) if f.is_nan())
}

fn first_na(frame: &Frame) -> Option<(usize, String)> {
    for row in 0..frame.n_rows {
        for col in &frame.columns {
            if col.values.get(row).is_some_and(cell_is_na) {
                return Some((row, col.name.clone()));
            }
        }
    }
    None
}

fn row_has_na(frame: &Frame, row: usize) -> bool {
    frame
        .columns
        .iter()
        .any(|col| col.values.get(row).is_some_and(cell_is_na))
}

fn column_has_na(col: &Column) -> bool {
    col.values.iter().any(cell_is_na)
}

fn frame_from_column_values(frame: &Frame, values_by_column: Vec<Vec<Cell>>) -> Frame {
    let columns = frame
        .columns
        .iter()
        .zip(values_by_column)
        .map(|(col, values)| Column::from_cells(&col.name, values))
        .collect();
    Frame {
        columns,
        n_rows: frame.n_rows,
        header_unit: frame.header_unit.clone(),
    }
}

fn fill_value_cell(fill_value: &Value) -> Result<Cell, SpecError> {
    match fill_value {
        Value::Null => Ok(Cell::Float(0.0)),
        Value::Bool(value) => Ok(Cell::Bool(*value)),
        Value::Number(value) => {
            if let Some(value) = value.as_i64() {
                Ok(Cell::Int(value))
            } else if let Some(value) = value.as_u64() {
                Ok(i64::try_from(value)
                    .map(Cell::Int)
                    .unwrap_or_else(|_| Cell::Float(value as f64)))
            } else if let Some(value) = value.as_f64() {
                Ok(Cell::Float(value))
            } else {
                Err(SpecError::new(
                    "na.fill.fill_value must be a number, string, bool, or null",
                ))
            }
        }
        Value::String(value) => Ok(Cell::Str(value.clone())),
        _ => Err(SpecError::new(
            "na.fill.fill_value must be a number, string, bool, or null",
        )),
    }
}

fn replace_na_value(frame: &Frame, fill_value: &Value) -> Result<Frame, SpecError> {
    let replacement = fill_value_cell(fill_value)?;
    let values_by_column = frame
        .columns
        .iter()
        .map(|col| {
            col.values
                .iter()
                .map(|cell| {
                    if cell_is_na(cell) {
                        replacement.clone()
                    } else {
                        cell.clone()
                    }
                })
                .collect()
        })
        .collect();
    Ok(frame_from_column_values(frame, values_by_column))
}

fn sorted_numeric_values(col: &Column) -> Vec<f64> {
    if col.dtype != ColDtype::Numeric {
        return Vec::new();
    }
    let mut values: Vec<f64> = col
        .values
        .iter()
        .map(Cell::to_numeric)
        .filter(|value| !value.is_nan())
        .collect();
    values.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    values
}

fn mean(values: &[f64]) -> f64 {
    if values.is_empty() {
        f64::NAN
    } else {
        values.iter().sum::<f64>() / values.len() as f64
    }
}

fn median(values: &[f64]) -> f64 {
    if values.is_empty() {
        return f64::NAN;
    }
    let mid = values.len() / 2;
    if values.len().is_multiple_of(2) {
        (values[mid - 1] + values[mid]) / 2.0
    } else {
        values[mid]
    }
}

fn replace_na_stat(frame: &Frame, per_column: bool, stat: fn(&[f64]) -> f64) -> Frame {
    if per_column {
        let values_by_column = frame
            .columns
            .iter()
            .map(|col| {
                if col.dtype != ColDtype::Numeric {
                    return col.values.clone();
                }
                let values = sorted_numeric_values(col);
                let replacement = Cell::Float(stat(&values));
                col.values
                    .iter()
                    .map(|cell| {
                        if cell_is_na(cell) {
                            replacement.clone()
                        } else {
                            cell.clone()
                        }
                    })
                    .collect()
            })
            .collect();
        frame_from_column_values(frame, values_by_column)
    } else {
        let mut values = Vec::new();
        for col in &frame.columns {
            values.extend(sorted_numeric_values(col));
        }
        values.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
        frame_from_column_values(
            frame,
            frame
                .columns
                .iter()
                .map(|col| {
                    let replacement = Cell::Float(stat(&values));
                    col.values
                        .iter()
                        .map(|cell| {
                            if cell_is_na(cell) {
                                replacement.clone()
                            } else {
                                cell.clone()
                            }
                        })
                        .collect()
                })
                .collect(),
        )
    }
}

fn fill_across_columns(frame: &Frame, forward: bool) -> Frame {
    let mut rows: Vec<Vec<Cell>> = vec![vec![Cell::Na; frame.columns.len()]; frame.n_rows];
    for (row_idx, row) in rows.iter_mut().enumerate() {
        for (col_idx, col) in frame.columns.iter().enumerate() {
            row[col_idx] = col.values.get(row_idx).cloned().unwrap_or(Cell::Na);
        }
        let mut carry: Option<Cell> = None;
        if forward {
            for cell in row.iter_mut() {
                if cell_is_na(cell) {
                    if let Some(value) = &carry {
                        *cell = value.clone();
                    }
                } else {
                    carry = Some(cell.clone());
                }
            }
        } else {
            for cell in row.iter_mut().rev() {
                if cell_is_na(cell) {
                    if let Some(value) = &carry {
                        *cell = value.clone();
                    }
                } else {
                    carry = Some(cell.clone());
                }
            }
        }
    }
    let values_by_column = (0..frame.columns.len())
        .map(|col_idx| rows.iter().map(|row| row[col_idx].clone()).collect())
        .collect();
    frame_from_column_values(frame, values_by_column)
}

fn replace_na(frame: &Frame, na: &NaConfig, method: FillMethod) -> Result<Frame, SpecError> {
    match method {
        FillMethod::Value => replace_na_value(frame, &na.fill_value),
        FillMethod::Mean => Ok(replace_na_stat(frame, na.fill_per_column, mean)),
        FillMethod::Median => Ok(replace_na_stat(frame, na.fill_per_column, median)),
        FillMethod::ForwardFill => Ok(fill_across_columns(frame, true)),
        FillMethod::BackwardFill => Ok(fill_across_columns(frame, false)),
    }
}

/// Apply the configured NA policy to an already-decoded [`Frame`].
///
/// The Python MVP treats `auto` as `abort`; the Rust core follows that contract
/// for both CSV bytes and facade-decoded frames such as Parquet.
pub fn apply_na_policy(frame: &Frame, na: &NaConfig) -> Result<Frame, SpecError> {
    let policy = if na.policy == NaPolicy::Auto {
        NaPolicy::Abort
    } else {
        na.policy
    };
    let Some((row, col)) = first_na(frame) else {
        return Ok(frame.clone());
    };

    match policy {
        NaPolicy::Abort => Err(SpecError::new(format!(
            "NA values detected and na_policy is 'abort'. First NA in column '{col}' (row: {row})."
        ))),
        NaPolicy::Ignore => Ok(frame.clone()),
        NaPolicy::RemoveSample => {
            let mask: Vec<bool> = (0..frame.n_rows)
                .map(|row| !row_has_na(frame, row))
                .collect();
            Ok(frame.mask_rows(&mask))
        }
        NaPolicy::RemoveFeature => Ok(Frame {
            columns: frame
                .columns
                .iter()
                .filter(|col| !column_has_na(col))
                .cloned()
                .collect(),
            n_rows: frame.n_rows,
            header_unit: frame.header_unit.clone(),
        }),
        NaPolicy::Replace => {
            let method = na.fill_method.unwrap_or(FillMethod::Value);
            replace_na(frame, na, method)
        }
        NaPolicy::Auto => unreachable!("auto is normalized to abort"),
    }
}

/// pandas `mangle_dupe_cols`: `a, a.1, a.2`; stringify + pad to `ncols`.
fn mangle_dupes(header: &[String], ncols: usize) -> Vec<String> {
    let mut seen: std::collections::HashMap<String, usize> = std::collections::HashMap::new();
    let mut out = Vec::with_capacity(ncols);
    for j in 0..ncols {
        let base = header.get(j).cloned().unwrap_or_else(|| j.to_string());
        let count = seen.entry(base.clone()).or_insert(0);
        let name = if *count == 0 {
            base.clone()
        } else {
            format!("{base}.{count}")
        };
        *count += 1;
        out.push(name);
    }
    out
}

/// Decode already-read (and decompressed) tabular bytes into a [`Frame`].
///
/// v0: the CSV family. UTF-8 with a latin-1 fallback, mirroring the native
/// loader's decoding. The facade reads the file and handles gzip/zip before
/// calling this so a single decoder backs both paths.
pub fn read_table_bytes(bytes: &[u8], params: &LoadingParams) -> Result<Frame, SpecError> {
    read_table_bytes_impl(bytes, params, None)
}

/// Decode tabular bytes while enforcing streaming record, field, and frame
/// shape budgets before copying an accepted record into owned cell strings.
pub fn read_table_bytes_with_limits(
    bytes: &[u8],
    params: &LoadingParams,
    limits: TabularReadLimits,
) -> Result<Frame, SpecError> {
    read_table_bytes_impl(bytes, params, Some(limits))
}

fn read_table_bytes_impl(
    bytes: &[u8],
    params: &LoadingParams,
    limits: Option<TabularReadLimits>,
) -> Result<Frame, SpecError> {
    let delimiter = params
        .delimiter
        .as_deref()
        .unwrap_or(";")
        .chars()
        .next()
        .unwrap_or(';');
    let decimal = params
        .decimal_separator
        .as_deref()
        .unwrap_or(".")
        .chars()
        .next()
        .unwrap_or('.');
    let has_header = params.has_header.unwrap_or(true);
    let latin1;
    let text = match std::str::from_utf8(bytes) {
        Ok(_) => bytes,
        Err(_) => {
            latin1 = bytes.iter().map(|&byte| byte as char).collect::<String>();
            latin1.as_bytes()
        }
    };

    let mut rdr = csv::ReaderBuilder::new()
        .has_headers(false)
        .flexible(true)
        .delimiter(delimiter as u8)
        .from_reader(text);
    let mut records: Vec<Vec<String>> = Vec::new();
    let mut record = csv::ByteRecord::new();
    let mut data_cells = 0_u64;
    let mut max_columns_seen = 0_u64;
    while rdr
        .read_byte_record(&mut record)
        .map_err(|e| SpecError::new(format!("csv parse error: {e}")))?
    {
        if record.iter().all(|field| field.is_empty()) {
            continue; // skip_blank_lines
        }
        if let Some(limits) = limits {
            let record_bytes = record.iter().fold(0_u64, |total, field| {
                total.saturating_add(field.len() as u64)
            });
            if record_bytes > limits.max_record_bytes {
                return Err(SpecError::new(format!(
                    "tabular record exceeds the {}-byte record budget",
                    limits.max_record_bytes
                )));
            }
            if record
                .iter()
                .any(|field| field.len() as u64 > limits.max_field_bytes)
            {
                return Err(SpecError::new(format!(
                    "tabular field exceeds the {}-byte field budget",
                    limits.max_field_bytes
                )));
            }

            let next_record_count = records.len() as u64 + 1;
            let data_rows = next_record_count.saturating_sub(u64::from(has_header));
            if data_rows > limits.max_rows {
                return Err(SpecError::new(format!(
                    "tabular input exceeds the {}-row budget",
                    limits.max_rows
                )));
            }
            let columns = max_columns_seen.max(record.len() as u64);
            if columns > limits.max_columns {
                return Err(SpecError::new(format!(
                    "tabular input exceeds the {}-column budget",
                    limits.max_columns
                )));
            }
            let next_data_cells = if has_header && records.is_empty() {
                data_cells
            } else {
                data_cells.saturating_add(record.len() as u64)
            };
            let rectangular_cells = data_rows.saturating_mul(columns);
            if next_data_cells.max(rectangular_cells) > limits.max_cells {
                return Err(SpecError::new(format!(
                    "tabular input exceeds the {}-cell budget",
                    limits.max_cells
                )));
            }
            data_cells = next_data_cells;
            max_columns_seen = columns;
        }
        records.push(
            record
                .iter()
                .map(|field| {
                    std::str::from_utf8(field)
                        .expect("CSV input was normalized to UTF-8")
                        .to_string()
                })
                .collect(),
        );
    }
    if records.is_empty() {
        return apply_na_policy(
            &Frame {
                columns: vec![],
                n_rows: 0,
                header_unit: header_unit(params, has_header),
            },
            &params.na,
        );
    }

    let ncols = records.iter().map(|r| r.len()).max().unwrap_or(0);
    let (header, data_start) = if has_header {
        (records[0].clone(), 1)
    } else {
        ((0..ncols).map(|i| i.to_string()).collect(), 0)
    };
    let names = mangle_dupes(&header, ncols);

    let columns: Vec<Column> = names
        .iter()
        .enumerate()
        .map(|(j, name)| {
            let raw: Vec<String> = records[data_start..]
                .iter()
                .map(|r| r.get(j).cloned().unwrap_or_default())
                .collect();
            infer_column(name, &raw, decimal)
        })
        .collect();
    apply_na_policy(
        &Frame {
            columns,
            n_rows: records.len() - data_start,
            header_unit: header_unit(params, has_header),
        },
        &params.na,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn read(text: &str, params: &LoadingParams) -> Frame {
        read_table_bytes(text.as_bytes(), params).unwrap()
    }

    fn params_with_na(na: NaConfig) -> LoadingParams {
        LoadingParams {
            delimiter: Some(";".into()),
            has_header: Some(true),
            na,
            ..Default::default()
        }
    }

    #[test]
    fn bounded_reader_accepts_every_limit_exactly() {
        let limits = TabularReadLimits::new(5, 3, 2, 2, 4);
        let frame = read_table_bytes_with_limits(
            b"abc;de\n1;2\n3;4\n",
            &LoadingParams {
                delimiter: Some(";".into()),
                has_header: Some(true),
                ..Default::default()
            },
            limits,
        )
        .unwrap();

        assert_eq!(frame.n_rows, 2);
        assert_eq!(frame.columns.len(), 2);
    }

    #[test]
    fn bounded_reader_counts_latin1_after_utf8_normalization() {
        let error = read_table_bytes_with_limits(
            b"\xe9\n",
            &LoadingParams {
                has_header: Some(false),
                ..Default::default()
            },
            TabularReadLimits::new(1, 1, 1, 1, 1),
        )
        .unwrap_err();

        assert!(error.message.contains("1-byte record budget"));
        assert!(read_table_bytes(
            b"\xe9\n",
            &LoadingParams {
                has_header: Some(false),
                ..Default::default()
            }
        )
        .is_ok());
    }

    fn na(policy: NaPolicy) -> NaConfig {
        NaConfig {
            policy,
            ..Default::default()
        }
    }

    #[test]
    fn reads_combined_float_columns() {
        let mut text = String::from("1000;1005;protein\n");
        for y in ["12.5", "8.3", "15.1"] {
            text.push_str(&format!("0.40;1.30;{y}\n"));
        }
        let params = LoadingParams {
            delimiter: Some(";".into()),
            has_header: Some(true),
            ..Default::default()
        };
        let t = read(&text, &params);
        assert_eq!(t.column_names(), vec!["1000", "1005", "protein"]);
        assert_eq!(t.dtype_labels(), vec!["numeric", "numeric", "numeric"]);
        let prof = t.to_table_profile();
        assert_eq!(prof.column("1000").unwrap().nunique_with_na, 1);
        assert!(prof.column("protein").unwrap().is_unique);
        assert!(prof.column("protein").unwrap().is_float_dtype());
        assert_eq!(t.numeric_column_f64("protein"), vec![12.5, 8.3, 15.1]);
    }

    #[test]
    fn int_column_stays_nonfloat() {
        let params = LoadingParams {
            delimiter: Some(";".into()),
            has_header: Some(true),
            ..Default::default()
        };
        let prof = read("id;v\n1;0.5\n2;0.6\n", &params).to_table_profile();
        let idc = prof.column("id").unwrap();
        assert_eq!(idc.numeric_kind, NumericKind::NonFloatNumeric);
        assert!(!idc.is_float_dtype());
        assert!(idc.is_numeric_dtype());
        assert_eq!(idc.str_values, vec!["1", "2"]);
    }

    #[test]
    fn csv_auto_and_abort_error_on_first_na() {
        let text = "a;b\n1;\n2;3\n";

        let auto = read_table_bytes(text.as_bytes(), &params_with_na(na(NaPolicy::Auto)))
            .expect_err("auto must abort on NA");
        assert!(auto.message.contains("First NA in column 'b' (row: 0)"));

        let abort = read_table_bytes(text.as_bytes(), &params_with_na(na(NaPolicy::Abort)))
            .expect_err("abort must abort on NA");
        assert!(abort.message.contains("na_policy is 'abort'"));
    }

    #[test]
    fn csv_ignore_preserves_na() {
        let frame = read("a;b\n1;\n2;3\n", &params_with_na(na(NaPolicy::Ignore)));

        assert_eq!(frame.n_rows, 2);
        let b = frame.numeric_column_f64("b");
        assert!(b[0].is_nan());
        assert_eq!(b[1], 3.0);
    }

    #[test]
    fn csv_remove_sample_drops_rows_with_any_na() {
        let frame = read(
            "a;b;c\n1;;x\n2;3;y\n;4;z\n",
            &params_with_na(na(NaPolicy::RemoveSample)),
        );

        assert_eq!(frame.n_rows, 1);
        assert_eq!(frame.numeric_column_f64("a"), vec![2.0]);
        assert_eq!(frame.str_column("c"), vec!["y"]);
    }

    #[test]
    fn csv_remove_feature_drops_columns_with_any_na() {
        let frame = read(
            "a;b;c\n1;;x\n2;3;y\n;4;z\n",
            &params_with_na(na(NaPolicy::RemoveFeature)),
        );

        assert_eq!(frame.column_names(), vec!["c"]);
        assert_eq!(frame.n_rows, 3);
    }

    #[test]
    fn csv_replace_value_fills_na() {
        let mut cfg = na(NaPolicy::Replace);
        cfg.fill_method = Some(FillMethod::Value);
        cfg.fill_value = serde_json::json!(9.5);

        let frame = read("a;b\n1;\n2;3\n", &params_with_na(cfg));

        assert_eq!(frame.numeric_column_f64("b"), vec![9.5, 3.0]);

        let default_fill = read("a;b\n1;\n2;3\n", &params_with_na(na(NaPolicy::Replace)));
        assert_eq!(default_fill.numeric_column_f64("b"), vec![0.0, 3.0]);
    }

    #[test]
    fn replace_value_supports_numeric_string_and_bool_fill_values() {
        let replace = |fill_value: Value| NaConfig {
            policy: NaPolicy::Replace,
            fill_method: Some(FillMethod::Value),
            fill_value,
            ..Default::default()
        };

        let numeric = Frame::from_columns(
            vec![Column::from_cells(
                "x",
                vec![Cell::Float(1.0), Cell::Float(f64::NAN)],
            )],
            "text",
        );
        let numeric = apply_na_policy(&numeric, &replace(serde_json::json!(7.5))).unwrap();
        assert_eq!(numeric.numeric_column_f64("x"), vec![1.0, 7.5]);

        let string = Frame::from_columns(
            vec![Column::from_cells(
                "label",
                vec![Cell::Str("a".into()), Cell::Na],
            )],
            "text",
        );
        let string = apply_na_policy(&string, &replace(serde_json::json!("missing"))).unwrap();
        assert_eq!(string.str_column("label"), vec!["a", "missing"]);

        let bools = Frame::from_columns(
            vec![Column::from_cells("flag", vec![Cell::Bool(true), Cell::Na])],
            "text",
        );
        let bools = apply_na_policy(&bools, &replace(serde_json::json!(false))).unwrap();
        assert_eq!(bools.str_column("flag"), vec!["True", "False"]);
    }

    #[test]
    fn csv_replace_mean_and_median_follow_python_axis_rules() {
        let mut cfg = na(NaPolicy::Replace);
        cfg.fill_method = Some(FillMethod::Mean);

        let mean_fill = read(
            "a;b;label\n1;10;x\n;20;y\n3;30;\n",
            &params_with_na(cfg.clone()),
        );
        assert_eq!(mean_fill.numeric_column_f64("a"), vec![1.0, 2.0, 3.0]);
        assert!(
            matches!(mean_fill.column("label").unwrap().values[2], Cell::Na),
            "per-column numeric mean must not fill non-numeric columns"
        );

        cfg.fill_method = Some(FillMethod::Median);
        let median_fill = read("a;b\n1;10\n;20\n5;30\n", &params_with_na(cfg.clone()));
        assert_eq!(median_fill.numeric_column_f64("a"), vec![1.0, 3.0, 5.0]);

        cfg.fill_per_column = false;
        let global_fill = read("a;b\n1;10\n;20\n5;30\n", &params_with_na(cfg));
        assert_eq!(global_fill.numeric_column_f64("a"), vec![1.0, 10.0, 5.0]);
    }

    #[test]
    fn csv_replace_forward_and_backward_fill_across_columns() {
        let mut cfg = na(NaPolicy::Replace);
        cfg.fill_method = Some(FillMethod::ForwardFill);
        let ffill = read("a;b;c\n1;;3\n;2;3\n", &params_with_na(cfg.clone()));
        assert_eq!(ffill.numeric_column_f64("b"), vec![1.0, 2.0]);
        assert!(ffill.numeric_column_f64("a")[1].is_nan());

        cfg.fill_method = Some(FillMethod::BackwardFill);
        let bfill = read("a;b;c\n1;;3\n;2;3\n", &params_with_na(cfg));
        assert_eq!(bfill.numeric_column_f64("b"), vec![3.0, 2.0]);
        assert_eq!(bfill.numeric_column_f64("a")[1], 2.0);
    }
}
