// SPDX-License-Identifier: CeCILL-2.1 OR AGPL-3.0-or-later
//! Tabular loaders — the facade's file-reading entry (ports the IO half of
//! `materialize/loaders.py`).
//!
//! The pure CSV-from-bytes decoder, NA policy, dtype inference and param merge
//! moved into `nirs4all-io-core` so the WASM binding can reach them. This module
//! keeps only the filesystem side: read a file, transparently decompress
//! `.gz`/`.zip`, then delegate to the shared core decoder. A single decoder thus
//! backs both the native (path) and the in-memory paths (D-R4).

use std::path::Path;

use arrow_array::types::{
    ArrowPrimitiveType, Float32Type, Float64Type, Int16Type, Int32Type, Int64Type, Int8Type,
    UInt16Type, UInt32Type, UInt64Type, UInt8Type,
};
use arrow_array::{
    Array, BooleanArray, LargeStringArray, PrimitiveArray, RecordBatchReader, StringArray,
    StringViewArray,
};
use arrow_schema::DataType;
use nirs4all_io_core::infer::table::{ColDtype, NumericKind};
use nirs4all_io_core::materialize::loaders::{apply_na_policy, read_table_bytes};
use nirs4all_io_core::spec::dataset_spec::LoadingParams;
use nirs4all_io_core::spec::SpecError;
use parquet::arrow::arrow_reader::ParquetRecordBatchReaderBuilder;
use parquet::arrow::ProjectionMask;
use serde_json::Value;

use super::frame::{Cell, Column, Frame};

pub use nirs4all_io_core::materialize::loaders::{effective_params, LoadedTable};

/// Read a file, transparently decompressing `.gz` / `.zip` so compressed CSVs parse.
fn read_maybe_compressed(path: &Path) -> Result<Vec<u8>, SpecError> {
    use std::io::Read;
    let raw = std::fs::read(path)
        .map_err(|e| SpecError::new(format!("file not found: {} ({e})", path.display())))?;
    let lower = path.to_string_lossy().to_lowercase();
    if lower.ends_with(".gz") {
        let mut out = Vec::new();
        flate2::read::GzDecoder::new(&raw[..])
            .read_to_end(&mut out)
            .map_err(|e| {
                SpecError::new(format!("gzip decode failed for {}: {e}", path.display()))
            })?;
        Ok(out)
    } else if lower.ends_with(".zip") {
        let mut archive = zip::ZipArchive::new(std::io::Cursor::new(raw))
            .map_err(|e| SpecError::new(format!("zip open failed for {}: {e}", path.display())))?;
        if archive.is_empty() {
            return Err(SpecError::new(format!(
                "empty zip archive: {}",
                path.display()
            )));
        }
        let mut entry = archive.by_index(0).map_err(|e| {
            SpecError::new(format!("zip entry read failed for {}: {e}", path.display()))
        })?;
        let mut out = Vec::new();
        entry.read_to_end(&mut out).map_err(|e| {
            SpecError::new(format!("zip decompress failed for {}: {e}", path.display()))
        })?;
        Ok(out)
    } else {
        Ok(raw)
    }
}

fn is_parquet_path(path: &Path) -> bool {
    matches!(
        path.extension()
            .and_then(|ext| ext.to_str())
            .map(str::to_ascii_lowercase)
            .as_deref(),
        Some("parquet" | "pq")
    )
}

fn parquet_header_unit(params: &LoadingParams) -> String {
    params
        .header_unit
        .map(|unit| unit.value().to_string())
        .unwrap_or_else(|| "text".to_string())
}

fn parquet_requested_columns(params: &LoadingParams) -> Result<Option<Vec<String>>, SpecError> {
    match params.format.values.get("columns") {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(name)) => Ok(Some(vec![name.clone()])),
        Some(Value::Array(values)) => values
            .iter()
            .map(|value| {
                value.as_str().map(str::to_string).ok_or_else(|| {
                    SpecError::new(
                        "parquet loading.format.columns must be a string or a list of strings",
                    )
                })
            })
            .collect::<Result<Vec<_>, _>>()
            .map(Some),
        Some(_) => Err(SpecError::new(
            "parquet loading.format.columns must be a string or a list of strings",
        )),
    }
}

fn unsupported_parquet_type(name: &str, data_type: &DataType) -> SpecError {
    SpecError::new(format!(
        "parquet column '{name}' has unsupported type {data_type}; supported types are bool, signed/unsigned integers within i64 range, float32/float64, utf8 strings, and null"
    ))
}

fn downcast_array<'a, T: 'static>(name: &str, array: &'a dyn Array) -> Result<&'a T, SpecError> {
    array.as_any().downcast_ref::<T>().ok_or_else(|| {
        SpecError::new(format!(
            "parquet column '{name}' reported type {} but Arrow array downcast failed",
            array.data_type()
        ))
    })
}

fn append_integer_cells<T>(
    name: &str,
    array: &dyn Array,
    cells: &mut Vec<Cell>,
) -> Result<(), SpecError>
where
    T: ArrowPrimitiveType,
    T::Native: TryInto<i64> + Copy + std::fmt::Display,
{
    let array = downcast_array::<PrimitiveArray<T>>(name, array)?;
    for row in 0..array.len() {
        if array.is_null(row) {
            cells.push(Cell::Na);
        } else {
            let raw = array.value(row);
            let value = raw.try_into().map_err(|_| {
                SpecError::new(format!(
                    "parquet column '{name}' contains integer value {raw} outside i64 range"
                ))
            })?;
            cells.push(Cell::Int(value));
        }
    }
    Ok(())
}

fn append_float_cells<T>(
    name: &str,
    array: &dyn Array,
    cells: &mut Vec<Cell>,
) -> Result<(), SpecError>
where
    T: ArrowPrimitiveType,
    T::Native: Into<f64> + Copy,
{
    let array = downcast_array::<PrimitiveArray<T>>(name, array)?;
    for row in 0..array.len() {
        cells.push(if array.is_null(row) {
            Cell::Float(f64::NAN)
        } else {
            Cell::Float(array.value(row).into())
        });
    }
    Ok(())
}

fn append_bool_cells(
    name: &str,
    array: &dyn Array,
    cells: &mut Vec<Cell>,
) -> Result<(), SpecError> {
    let array = downcast_array::<BooleanArray>(name, array)?;
    for row in 0..array.len() {
        cells.push(if array.is_null(row) {
            Cell::Na
        } else {
            Cell::Bool(array.value(row))
        });
    }
    Ok(())
}

fn append_string_array<F>(
    array_len: usize,
    is_null: impl Fn(usize) -> bool,
    value: F,
    cells: &mut Vec<Cell>,
) where
    F: Fn(usize) -> String,
{
    for row in 0..array_len {
        cells.push(if is_null(row) {
            Cell::Na
        } else {
            Cell::Str(value(row))
        });
    }
}

fn append_array_cells(
    name: &str,
    array: &dyn Array,
    cells: &mut Vec<Cell>,
) -> Result<(), SpecError> {
    match array.data_type() {
        DataType::Null => {
            cells.extend(std::iter::repeat_n(Cell::Na, array.len()));
            Ok(())
        }
        DataType::Boolean => append_bool_cells(name, array, cells),
        DataType::Int8 => append_integer_cells::<Int8Type>(name, array, cells),
        DataType::Int16 => append_integer_cells::<Int16Type>(name, array, cells),
        DataType::Int32 => append_integer_cells::<Int32Type>(name, array, cells),
        DataType::Int64 => append_integer_cells::<Int64Type>(name, array, cells),
        DataType::UInt8 => append_integer_cells::<UInt8Type>(name, array, cells),
        DataType::UInt16 => append_integer_cells::<UInt16Type>(name, array, cells),
        DataType::UInt32 => append_integer_cells::<UInt32Type>(name, array, cells),
        DataType::UInt64 => append_integer_cells::<UInt64Type>(name, array, cells),
        DataType::Float32 => append_float_cells::<Float32Type>(name, array, cells),
        DataType::Float64 => append_float_cells::<Float64Type>(name, array, cells),
        DataType::Utf8 => {
            let array = downcast_array::<StringArray>(name, array)?;
            append_string_array(
                array.len(),
                |row| array.is_null(row),
                |row| array.value(row).to_string(),
                cells,
            );
            Ok(())
        }
        DataType::LargeUtf8 => {
            let array = downcast_array::<LargeStringArray>(name, array)?;
            append_string_array(
                array.len(),
                |row| array.is_null(row),
                |row| array.value(row).to_string(),
                cells,
            );
            Ok(())
        }
        DataType::Utf8View => {
            let array = downcast_array::<StringViewArray>(name, array)?;
            append_string_array(
                array.len(),
                |row| array.is_null(row),
                |row| array.value(row).to_string(),
                cells,
            );
            Ok(())
        }
        other => Err(unsupported_parquet_type(name, other)),
    }
}

fn column_from_parquet_cells(
    name: &str,
    data_type: &DataType,
    cells: Vec<Cell>,
) -> Result<Column, SpecError> {
    match data_type {
        DataType::Utf8 | DataType::LargeUtf8 | DataType::Utf8View | DataType::Null => Ok(Column {
            name: name.into(),
            dtype: ColDtype::String,
            numeric_kind: NumericKind::NonNumeric,
            values: cells,
        }),
        DataType::Boolean => Ok(Column::from_cells(name, cells)),
        DataType::Int8
        | DataType::Int16
        | DataType::Int32
        | DataType::Int64
        | DataType::UInt8
        | DataType::UInt16
        | DataType::UInt32
        | DataType::UInt64
        | DataType::Float32
        | DataType::Float64 => Ok(Column::from_cells(name, cells)),
        other => Err(unsupported_parquet_type(name, other)),
    }
}

fn read_parquet_raw(path: &Path, params: &LoadingParams) -> Result<Frame, SpecError> {
    let file = std::fs::File::open(path)
        .map_err(|e| SpecError::new(format!("file not found: {} ({e})", path.display())))?;
    let mut builder = ParquetRecordBatchReaderBuilder::try_new(file)
        .map_err(|e| SpecError::new(format!("parquet open failed for {}: {e}", path.display())))?;

    let requested = parquet_requested_columns(params)?;
    if let Some(columns) = &requested {
        let available: Vec<String> = builder
            .schema()
            .fields()
            .iter()
            .map(|field| field.name().to_string())
            .collect();
        let indices = columns
            .iter()
            .map(|name| {
                available
                    .iter()
                    .position(|field| field == name)
                    .ok_or_else(|| {
                        SpecError::new(format!(
                            "parquet column '{name}' not found in {} (available: {available:?})",
                            path.display()
                        ))
                    })
            })
            .collect::<Result<Vec<_>, _>>()?;
        let projection = ProjectionMask::roots(builder.parquet_schema(), indices);
        builder = builder.with_projection(projection);
    }

    let mut reader = builder
        .build()
        .map_err(|e| SpecError::new(format!("parquet read failed for {}: {e}", path.display())))?;
    let schema = reader.schema();
    let fields: Vec<(String, DataType)> = schema
        .fields()
        .iter()
        .map(|field| (field.name().to_string(), field.data_type().clone()))
        .collect();
    let mut cells_by_column: Vec<Vec<Cell>> = fields.iter().map(|_| Vec::new()).collect();
    let mut n_rows = 0usize;

    for batch in &mut reader {
        let batch = batch.map_err(|e| {
            SpecError::new(format!("parquet read failed for {}: {e}", path.display()))
        })?;
        if batch.num_columns() != fields.len() {
            return Err(SpecError::new(format!(
                "parquet read failed for {}: expected {} columns, got {}",
                path.display(),
                fields.len(),
                batch.num_columns()
            )));
        }
        n_rows += batch.num_rows();
        for (idx, cells) in cells_by_column.iter_mut().enumerate() {
            append_array_cells(&fields[idx].0, batch.column(idx).as_ref(), cells)?;
        }
    }

    let columns = fields
        .into_iter()
        .zip(cells_by_column)
        .map(|((name, data_type), cells)| column_from_parquet_cells(&name, &data_type, cells))
        .collect::<Result<Vec<_>, _>>()?;
    let mut frame = Frame {
        columns,
        n_rows,
        header_unit: parquet_header_unit(params),
    };
    if let Some(columns) = requested {
        frame = frame.select(&columns);
    }
    Ok(frame)
}

pub(crate) fn read_parquet_frame(
    path: &Path,
    columns: Option<&[String]>,
) -> Result<Frame, SpecError> {
    let mut params = LoadingParams::default();
    if let Some(columns) = columns {
        params.format.values.insert(
            "columns".into(),
            Value::Array(columns.iter().cloned().map(Value::from).collect()),
        );
    }
    read_parquet_raw(path, &params)
}

fn read_parquet(path: &Path, params: &LoadingParams) -> Result<Frame, SpecError> {
    let frame = read_parquet_raw(path, params)?;
    apply_na_policy(&frame, &params.na)
}

/// Read a tabular file into a [`Frame`]: read bytes (+ gzip/zip), then run the
/// shared core CSV decoder. v0: the CSV family. numpy/parquet/excel/vendor
/// readers land with the broader load path; until then unknown extensions fall
/// back to CSV (nirs4all's own fallback).
pub fn read_table(path: &Path, params: &LoadingParams) -> Result<Frame, SpecError> {
    if is_parquet_path(path) {
        return read_parquet(path, params);
    }
    let bytes = read_maybe_compressed(path)?;
    read_table_bytes(&bytes, params)
        .map_err(|e| SpecError::new(format!("{} in {}", e.message, path.display())))
}

#[cfg(test)]
mod tests {
    use super::*;
    use arrow_array::{ArrayRef, Date32Array, Float64Array, Int64Array, StringArray};
    use arrow_schema::{Field, Schema};
    use nirs4all_io_core::infer::table::NumericKind;
    use nirs4all_io_core::spec::dataset_spec::NaConfig;
    use nirs4all_io_core::spec::enums::{FillMethod, NaPolicy};
    use parquet::arrow::arrow_writer::ArrowWriter;
    use std::io::Write;
    use std::sync::Arc;

    fn write(dir: &Path, name: &str, content: &str) -> std::path::PathBuf {
        let p = dir.join(name);
        std::fs::File::create(&p)
            .unwrap()
            .write_all(content.as_bytes())
            .unwrap();
        p
    }

    fn write_parquet(path: &Path, batch: arrow_array::RecordBatch) {
        let file = std::fs::File::create(path).unwrap();
        let mut writer = ArrowWriter::try_new(file, batch.schema(), None).unwrap();
        writer.write(&batch).unwrap();
        writer.close().unwrap();
    }

    #[test]
    fn reads_combined_float_columns() {
        let tmp = tempfile::tempdir().unwrap();
        let mut text = String::from("1000;1005;protein\n");
        for y in ["12.5", "8.3", "15.1"] {
            text.push_str(&format!("0.40;1.30;{y}\n"));
        }
        let p = write(tmp.path(), "data.csv", &text);
        let params = LoadingParams {
            delimiter: Some(";".into()),
            has_header: Some(true),
            ..Default::default()
        };
        let t = read_table(&p, &params).unwrap();
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
        let tmp = tempfile::tempdir().unwrap();
        let p = write(tmp.path(), "ids.csv", "id;v\n1;0.5\n2;0.6\n");
        let params = LoadingParams {
            delimiter: Some(";".into()),
            has_header: Some(true),
            ..Default::default()
        };
        let prof = read_table(&p, &params).unwrap().to_table_profile();
        let idc = prof.column("id").unwrap();
        assert_eq!(idc.numeric_kind, NumericKind::NonFloatNumeric);
        assert!(!idc.is_float_dtype());
        assert!(idc.is_numeric_dtype());
        assert_eq!(idc.str_values, vec!["1", "2"]);
    }

    #[test]
    fn reads_gzip_csv() {
        use flate2::write::GzEncoder;
        use flate2::Compression;
        let tmp = tempfile::tempdir().unwrap();
        let p = tmp.path().join("X.csv.gz");
        let mut enc = GzEncoder::new(std::fs::File::create(&p).unwrap(), Compression::default());
        enc.write_all(b"1000;1005\n0.4;1.3\n0.5;1.2\n").unwrap();
        enc.finish().unwrap();
        let params = LoadingParams {
            delimiter: Some(";".into()),
            has_header: Some(true),
            ..Default::default()
        };
        let t = read_table(&p, &params).unwrap();
        assert_eq!(t.column_names(), vec!["1000", "1005"]);
        assert_eq!(t.n_rows, 2);
        assert_eq!(t.numeric_column_f64("1000"), vec![0.4, 0.5]);
    }

    #[test]
    fn reads_parquet_basic_scalar_columns() {
        let tmp = tempfile::tempdir().unwrap();
        let p = tmp.path().join("data.parquet");
        let schema = Arc::new(Schema::new(vec![
            Field::new("flag", DataType::Boolean, false),
            Field::new("id", DataType::Int64, false),
            Field::new("y", DataType::Float64, false),
            Field::new("label", DataType::Utf8, false),
        ]));
        let batch = arrow_array::RecordBatch::try_new(
            schema,
            vec![
                Arc::new(BooleanArray::from(vec![true, false, true])) as ArrayRef,
                Arc::new(Int64Array::from(vec![1, 2, 3])) as ArrayRef,
                Arc::new(Float64Array::from(vec![1.5, 2.5, 3.25])) as ArrayRef,
                Arc::new(StringArray::from(vec!["a", "b", "c"])) as ArrayRef,
            ],
        )
        .unwrap();
        write_parquet(&p, batch);

        let table = read_table(&p, &LoadingParams::default()).unwrap();

        assert_eq!(table.column_names(), vec!["flag", "id", "y", "label"]);
        assert_eq!(
            table.dtype_labels(),
            vec!["bool", "numeric", "numeric", "string"]
        );
        assert_eq!(table.str_column("flag"), vec!["True", "False", "True"]);
        let flag = table.numeric_column_f64("flag");
        assert_eq!(flag[0], 1.0);
        assert_eq!(flag[1], 0.0);
        assert_eq!(flag[2], 1.0);
        assert_eq!(table.numeric_column_f64("id"), vec![1.0, 2.0, 3.0]);
        assert_eq!(table.numeric_column_f64("y"), vec![1.5, 2.5, 3.25]);
        assert_eq!(table.str_column("label"), vec!["a", "b", "c"]);
    }

    #[test]
    fn reads_parquet_projected_columns_in_requested_order() {
        let tmp = tempfile::tempdir().unwrap();
        let p = tmp.path().join("data.parquet");
        let schema = Arc::new(Schema::new(vec![
            Field::new("id", DataType::Int64, false),
            Field::new("label", DataType::Utf8, false),
        ]));
        let batch = arrow_array::RecordBatch::try_new(
            schema,
            vec![
                Arc::new(Int64Array::from(vec![1, 2])) as ArrayRef,
                Arc::new(StringArray::from(vec!["a", "b"])) as ArrayRef,
            ],
        )
        .unwrap();
        write_parquet(&p, batch);
        let mut params = LoadingParams::default();
        params
            .format
            .values
            .insert("columns".into(), serde_json::json!(["label", "id"]));

        let table = read_table(&p, &params).unwrap();

        assert_eq!(table.column_names(), vec!["label", "id"]);
        assert_eq!(table.str_column("label"), vec!["a", "b"]);
        assert_eq!(table.numeric_column_f64("id"), vec![1.0, 2.0]);
    }

    #[test]
    fn reads_parquet_nullable_columns_with_na_policy() {
        let tmp = tempfile::tempdir().unwrap();
        let p = tmp.path().join("data.parquet");
        let schema = Arc::new(Schema::new(vec![
            Field::new("a", DataType::Float64, false),
            Field::new("b", DataType::Float64, true),
        ]));
        let batch = arrow_array::RecordBatch::try_new(
            schema,
            vec![
                Arc::new(Float64Array::from(vec![Some(1.0), Some(2.0)])) as ArrayRef,
                Arc::new(Float64Array::from(vec![None, Some(3.0)])) as ArrayRef,
            ],
        )
        .unwrap();
        write_parquet(&p, batch);

        let mut params = LoadingParams {
            na: NaConfig {
                policy: NaPolicy::Replace,
                fill_method: Some(FillMethod::Value),
                fill_value: serde_json::json!(7.0),
                ..Default::default()
            },
            ..Default::default()
        };
        let replaced = read_table(&p, &params).unwrap();
        assert_eq!(replaced.numeric_column_f64("b"), vec![7.0, 3.0]);

        params.na = NaConfig {
            policy: NaPolicy::RemoveSample,
            ..Default::default()
        };
        let filtered = read_table(&p, &params).unwrap();
        assert_eq!(filtered.n_rows, 1);
        assert_eq!(filtered.numeric_column_f64("a"), vec![2.0]);
    }

    #[test]
    fn unsupported_parquet_type_errors_explicitly() {
        let tmp = tempfile::tempdir().unwrap();
        let p = tmp.path().join("dates.parquet");
        let schema = Arc::new(Schema::new(vec![Field::new(
            "date",
            DataType::Date32,
            false,
        )]));
        let batch = arrow_array::RecordBatch::try_new(
            schema,
            vec![Arc::new(Date32Array::from(vec![1, 2])) as ArrayRef],
        )
        .unwrap();
        write_parquet(&p, batch);

        let err = read_table(&p, &LoadingParams::default()).unwrap_err();

        assert!(err
            .message
            .contains("parquet column 'date' has unsupported type Date32"));
    }
}
