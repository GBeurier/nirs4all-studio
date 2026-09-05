// SPDX-License-Identifier: CeCILL-2.1 OR AGPL-3.0-or-later
//! Python typed-array transport into the existing fs-free assembly owner.

use std::collections::HashMap;

use nirs4all_io_facade::core::materialize::{
    assemble_in_memory_with_tabular_limits, Cell, Column, Frame, InMemorySource, SourcePayload,
};
use nirs4all_io_facade::core::spec::{validate_spec, DatasetSpec};
use pyo3::exceptions::PyValueError;
use pyo3::prelude::*;
use pyo3::types::{PyFloat, PyString};
use pythonize::depythonize;
use serde_json::Value;

#[pyfunction]
#[pyo3(signature = (limits=None))]
pub fn resolved_load_limits(
    py: Python<'_>,
    limits: Option<&Bound<'_, PyAny>>,
) -> PyResult<Py<PyAny>> {
    let limits = super::parse_load_limits(limits)?;
    super::to_py(
        py,
        &serde_json::to_value(limits).map_err(|e| PyValueError::new_err(e.to_string()))?,
    )
}

#[pyfunction]
#[pyo3(signature = (spec, frames, *, limits=None, summary=false))]
pub fn assemble_frames(
    py: Python<'_>,
    spec: &Bound<'_, PyAny>,
    frames: &Bound<'_, PyAny>,
    limits: Option<&Bound<'_, PyAny>>,
    summary: bool,
) -> PyResult<Py<PyAny>> {
    let limits = super::parse_load_limits(limits)?;
    let spec: Value = depythonize(spec).map_err(|e| PyValueError::new_err(e.to_string()))?;
    let spec = DatasetSpec::from_value(&spec).map_err(|e| PyValueError::new_err(e.message))?;
    validate_spec(&spec).map_err(|e| PyValueError::new_err(e.message))?;
    // Admit Python-owned payload shapes and string bytes before depythonize
    // duplicates them into serde_json trees. Public Python adapters perform
    // the same admission before ndarray.tolist(), but this raw entry is safe
    // to call directly as well.
    if frames.len()? as u64 > limits.max_files {
        return Err(PyValueError::new_err("memory source count exceeds limit"));
    }
    let mut cells = 0_u64;
    let mut bytes = 0_u64;
    for frame in frames.try_iter()? {
        let frame = frame?;
        let rows = frame.get_item("rows")?;
        let columns = frame.get_item("columns")?.len()?;
        limits
            .tabular()
            .check_shape(rows.len()? as u64, columns as u64)
            .map_err(|e| PyValueError::new_err(e.message))?;
        cells = cells
            .checked_add((rows.len()? as u64).saturating_mul(columns as u64))
            .ok_or_else(|| PyValueError::new_err("memory cell count overflow"))?;
        if cells > limits.max_cells {
            return Err(PyValueError::new_err("memory cells exceed aggregate limit"));
        }
        let start = bytes;
        for row in rows.try_iter()? {
            let row = row?;
            if row.len()? != columns {
                return Err(PyValueError::new_err("memory frame is not rectangular"));
            }
            let row_start = bytes;
            for cell in row.try_iter()? {
                let cell = cell?;
                if let Ok(value) = cell.cast::<PyFloat>() {
                    if value.value().is_infinite() {
                        return Err(PyValueError::new_err(
                            "infinite array values cannot be represented by the dataset wire",
                        ));
                    }
                }
                let size = if let Ok(text) = cell.cast::<PyString>() {
                    text.to_str()?.len() as u64
                } else {
                    8
                };
                if size > limits.max_field_bytes {
                    return Err(PyValueError::new_err("memory field exceeds byte limit"));
                }
                bytes = bytes
                    .checked_add(size)
                    .ok_or_else(|| PyValueError::new_err("memory byte count overflow"))?;
                if bytes > limits.max_decoded_total_bytes {
                    return Err(PyValueError::new_err(
                        "memory payload exceeds aggregate byte limit",
                    ));
                }
            }
            if bytes - row_start > limits.max_record_bytes {
                return Err(PyValueError::new_err("memory record exceeds byte limit"));
            }
        }
        if bytes - start > limits.max_decoded_file_bytes {
            return Err(PyValueError::new_err("memory source exceeds byte limit"));
        }
    }
    let frames: Vec<Value> =
        depythonize(frames).map_err(|e| PyValueError::new_err(e.to_string()))?;
    if frames.len() as u64 > limits.max_files {
        return Err(PyValueError::new_err("memory source count exceeds limit"));
    }
    let mut sources = Vec::new();
    let mut total_cells = 0_u64;
    for value in frames {
        let name = value["name"]
            .as_str()
            .ok_or_else(|| PyValueError::new_err("frame name required"))?;
        let names = value["columns"]
            .as_array()
            .ok_or_else(|| PyValueError::new_err("frame columns required"))?;
        let rows = value["rows"]
            .as_array()
            .ok_or_else(|| PyValueError::new_err("frame rows required"))?;
        limits
            .tabular()
            .check_shape(rows.len() as u64, names.len() as u64)
            .map_err(|e| PyValueError::new_err(e.message))?;
        total_cells = total_cells
            .checked_add((rows.len() as u64).saturating_mul(names.len() as u64))
            .ok_or_else(|| PyValueError::new_err("memory cell count overflow"))?;
        if total_cells > limits.max_cells {
            return Err(PyValueError::new_err("memory cells exceed aggregate limit"));
        }
        if rows
            .iter()
            .any(|row| row.as_array().is_none_or(|row| row.len() != names.len()))
        {
            return Err(PyValueError::new_err("memory frame is not rectangular"));
        }
        let mut columns = Vec::new();
        for (index, column) in names.iter().enumerate() {
            let column = column
                .as_str()
                .ok_or_else(|| PyValueError::new_err("column name must be text"))?;
            let cells: PyResult<Vec<Cell>> = rows
                .iter()
                .map(|row| match &row[index] {
                    Value::Null => Ok(Cell::Na),
                    Value::Bool(v) => Ok(Cell::Bool(*v)),
                    Value::String(v) => Ok(Cell::Str(v.clone())),
                    Value::Number(v) => {
                        if let Some(v) = v.as_i64() {
                            Ok(Cell::Int(v))
                        } else {
                            v.as_f64()
                                .map(Cell::Float)
                                .ok_or_else(|| PyValueError::new_err("invalid numeric cell"))
                        }
                    }
                    _ => Err(PyValueError::new_err("array cells must be scalar")),
                })
                .collect();
            columns.push(Column::from_cells(column, cells?));
        }
        sources.push(InMemorySource {
            name: name.into(),
            payload: SourcePayload::Frame(Frame::from_columns(columns, "index")),
        });
    }
    let assembled = assemble_in_memory_with_tabular_limits(
        &spec,
        &sources,
        &HashMap::new(),
        None,
        Some(limits.tabular()),
    )
    .map_err(|e| PyValueError::new_err(e.message))?;
    super::to_py(
        py,
        &if summary {
            assembled.to_summary_value()
        } else {
            assembled.to_full_value()
        },
    )
}
