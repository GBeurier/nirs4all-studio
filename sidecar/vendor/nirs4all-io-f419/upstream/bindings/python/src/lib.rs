// SPDX-License-Identifier: CeCILL-2.1 OR AGPL-3.0-or-later
//! Native core of the pyo3 Python binding (EPIC 11.1). Compiled as
//! `nirs4all_io._native`; the user-facing `nirs4all_io` package
//! (`bindings/python/python/nirs4all_io`) wraps it and adds the lazy
//! SpectroDataset adapter.
//!
//! The JSON surface (`infer` / `to_spec` / `validate`) and the materialized
//! exports (`load_summary` = rounded structural summary, `assembled_full` =
//! full-precision arrays for the SpectroDataset adapter) return native Python
//! objects via `pythonize`. Nothing here imports `nirs4all`.

use nirs4all_io_facade::api::{load_assembled, to_spec as facade_to_spec, Input};
use nirs4all_io_facade::core::spec::{validate_spec, DatasetSpec};
use nirs4all_io_facade::infer::{infer_path, infer_paths};
use pyo3::exceptions::{PyTypeError, PyValueError};
use pyo3::prelude::*;
use pythonize::{depythonize, pythonize};
use serde_json::Value;

/// Convert a Python argument into a facade [`Input`]: `str` → path, a sequence of
/// `str` → file list, a `dict`/mapping → spec.
fn to_input(obj: &Bound<'_, PyAny>) -> PyResult<Input> {
    if let Ok(s) = obj.extract::<String>() {
        return Ok(Input::Path(s));
    }
    if let Ok(paths) = obj.extract::<Vec<String>>() {
        return Ok(Input::Paths(paths));
    }
    let value: Value = depythonize(obj).map_err(|e| {
        PyTypeError::new_err(format!("input is not a path, file list, or spec dict: {e}"))
    })?;
    if value.is_object() {
        Ok(Input::Spec(value))
    } else {
        Err(PyTypeError::new_err(
            "input must be a path (str), file list (sequence of str), or spec (dict)",
        ))
    }
}

fn to_py(py: Python<'_>, value: &Value) -> PyResult<PyObject> {
    Ok(pythonize(py, value)
        .map_err(|e| PyValueError::new_err(e.to_string()))?
        .unbind())
}

/// Inspect a data input and return the scored DatasetPlan as a dict.
#[pyfunction]
#[pyo3(signature = (input, conventions=None))]
fn infer(
    py: Python<'_>,
    input: &Bound<'_, PyAny>,
    conventions: Option<Vec<String>>,
) -> PyResult<PyObject> {
    let plan = match to_input(input)? {
        Input::Path(p) => infer_path(&p, conventions.as_deref()),
        Input::Paths(ps) => infer_paths(&ps, conventions.as_deref()),
        Input::Spec(_) => {
            return Err(PyValueError::new_err(
                "infer needs a data input (path or file list), not a spec",
            ))
        }
    }
    .map_err(|e| PyValueError::new_err(e.message))?;
    to_py(py, &plan.to_value())
}

/// Normalize an input into a canonical DatasetSpec dict.
#[pyfunction]
#[pyo3(signature = (input, conventions=None, name=None))]
fn to_spec(
    py: Python<'_>,
    input: &Bound<'_, PyAny>,
    conventions: Option<Vec<String>>,
    name: Option<String>,
) -> PyResult<PyObject> {
    let (spec, _base) = facade_to_spec(&to_input(input)?, conventions.as_deref(), name.as_deref())
        .map_err(|e| PyValueError::new_err(e.message))?;
    to_py(py, &spec.to_value())
}

/// Validate a DatasetSpec (a dict or a JSON string); raises `ValueError` if invalid.
#[pyfunction]
fn validate(spec: &Bound<'_, PyAny>) -> PyResult<()> {
    let value: Value = if let Ok(s) = spec.extract::<String>() {
        serde_json::from_str(&s)
            .map_err(|e| PyValueError::new_err(format!("invalid spec JSON: {e}")))?
    } else {
        depythonize(spec)
            .map_err(|e| PyTypeError::new_err(format!("spec must be a dict or JSON string: {e}")))?
    };
    let spec = DatasetSpec::from_value(&value).map_err(|e| PyValueError::new_err(e.message))?;
    validate_spec(&spec).map_err(|e| PyValueError::new_err(e.message))?;
    Ok(())
}

/// Materialize an input and return the rounded structural summary dict
/// (target="assembled").
#[pyfunction]
#[pyo3(signature = (input, conventions=None, name=None))]
fn load_summary(
    py: Python<'_>,
    input: &Bound<'_, PyAny>,
    conventions: Option<Vec<String>>,
    name: Option<String>,
) -> PyResult<PyObject> {
    let assembled = load_assembled(&to_input(input)?, conventions.as_deref(), name.as_deref())
        .map_err(|e| PyValueError::new_err(e.message))?;
    to_py(py, &assembled.to_summary_value())
}

/// Materialize an input and return the full-precision arrays dict consumed by the
/// Python SpectroDataset adapter (X/y/processing matrices, metadata, weights, folds).
#[pyfunction]
#[pyo3(signature = (input, conventions=None, name=None))]
fn assembled_full(
    py: Python<'_>,
    input: &Bound<'_, PyAny>,
    conventions: Option<Vec<String>>,
    name: Option<String>,
) -> PyResult<PyObject> {
    let assembled = load_assembled(&to_input(input)?, conventions.as_deref(), name.as_deref())
        .map_err(|e| PyValueError::new_err(e.message))?;
    to_py(py, &assembled.to_full_value())
}

#[pymodule]
fn _native(m: &Bound<'_, PyModule>) -> PyResult<()> {
    m.add("__version__", env!("CARGO_PKG_VERSION"))?;
    m.add_function(wrap_pyfunction!(infer, m)?)?;
    m.add_function(wrap_pyfunction!(to_spec, m)?)?;
    m.add_function(wrap_pyfunction!(validate, m)?)?;
    m.add_function(wrap_pyfunction!(load_summary, m)?)?;
    m.add_function(wrap_pyfunction!(assembled_full, m)?)?;
    Ok(())
}
