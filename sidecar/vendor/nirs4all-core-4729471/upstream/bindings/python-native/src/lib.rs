//! Native Archive V2/V3 access and Methods replay for the Python facade.
//!
//! ZIP parsing, schema dispatch, inventory validation, and raw-integrity checks
//! remain in the aggregate Rust reader. DAG-ML remains the sole owner of
//! package parsing, scheduling, and invocation-local N4MM execution. The
//! replay functions accept strict JSON and never accept Python callbacks or
//! serialized host-model handles.

#![allow(clippy::useless_conversion)] // PyO3's exported-function wrapper converts PyErr to itself.

use std::path::Path;
use std::path::PathBuf;

use nirs4all::{
    inspect_methods_archive_v2_predictors_json as core_inspect_methods_archive_v2_predictors_json,
    load_archive_v2, load_archive_v3,
    predict_methods_archive_v2_matrix_json as core_predict_methods_archive_v2_matrix_json,
    replay_methods_archive_v2_conformal_presentation_v1_json as core_replay_methods_archive_v2_conformal_presentation_v1_json,
    replay_methods_archive_v2_conformal_presentation_v2_json as core_replay_methods_archive_v2_conformal_presentation_v2_json,
    replay_methods_archive_v2_json as core_replay_methods_archive_v2_json,
    replay_methods_archive_v3_json as core_replay_methods_archive_v3_json, write_archive_v2,
    write_archive_v3, ArchivePayload, ArchiveV2WriteRequest, ArchiveV3WriteRequest,
    MethodsArchiveReplayJsonRequest,
};
use pyo3::{
    exceptions::PyValueError,
    prelude::*,
    types::{PyAny, PyBytes},
};
use serde_json::Value;

fn archive_error(error: impl std::fmt::Display) -> PyErr {
    PyValueError::new_err(format!("Archive V2 validation refused: {error}"))
}

fn replay_error(error: impl std::fmt::Display) -> PyErr {
    PyValueError::new_err(format!("native Methods archive replay refused: {error}"))
}

#[allow(clippy::too_many_arguments)]
fn replay_json_input(
    request_json: &str,
    data_envelopes_json: &str,
    methods_inputs_json: &str,
    methods_library_path: &str,
    outcome_id: &str,
    run_id: &str,
    warnings_json: &str,
    diagnostics_json: &str,
) -> MethodsArchiveReplayJsonRequest {
    MethodsArchiveReplayJsonRequest {
        request_json: request_json.to_owned(),
        data_envelopes_json: data_envelopes_json.to_owned(),
        methods_inputs_json: methods_inputs_json.to_owned(),
        methods_library_path: PathBuf::from(methods_library_path),
        outcome_id: outcome_id.to_owned(),
        run_id: run_id.to_owned(),
        warnings_json: warnings_json.to_owned(),
        diagnostics_json: diagnostics_json.to_owned(),
    }
}

/// Return the exact DAG-ML PortablePredictorPackage V2 bytes from a validated
/// Archive V2.  This does not parse, deserialize, or execute the package.
#[pyfunction]
fn read_portable_predictor_package_v2<'py>(
    py: Python<'py>,
    path: &str,
) -> PyResult<Bound<'py, PyBytes>> {
    let archive = load_archive_v2(Path::new(path)).map_err(archive_error)?;
    let package = archive
        .portable_predictor_package()
        .map_err(archive_error)?;
    Ok(PyBytes::new(py, package))
}

/// Return the exact DAG-ML PortableRefitPackage V3 bytes from a validated
/// Archive V3. This does not parse, deserialize, or execute the package.
#[pyfunction]
fn read_portable_refit_package_v3<'py>(
    py: Python<'py>,
    path: &str,
) -> PyResult<Bound<'py, PyBytes>> {
    let archive = load_archive_v3(Path::new(path)).map_err(|error| {
        PyValueError::new_err(format!("Archive V3 validation refused: {error}"))
    })?;
    let package = archive.portable_refit_package().map_err(|error| {
        PyValueError::new_err(format!("Archive V3 validation refused: {error}"))
    })?;
    Ok(PyBytes::new(py, package))
}

/// Inspect every native predictor in a validated Archive V2.
///
/// The descriptor JSON is emitted from DAG-ML's typed contract after Core has
/// attested the exact libn4m bytes and Methods has inspected each complete
/// N4MM payload. Python neither supplies nor reconstructs descriptor fields.
#[pyfunction]
fn inspect_methods_archive_v2_predictors_json(
    py: Python<'_>,
    path: &str,
    methods_library_path: &str,
    methods_library_sha256: &str,
) -> PyResult<String> {
    let archive_path = PathBuf::from(path);
    let library_path = PathBuf::from(methods_library_path);
    let library_sha256 = methods_library_sha256.to_owned();
    py.detach(move || {
        core_inspect_methods_archive_v2_predictors_json(
            &archive_path,
            &library_path,
            &library_sha256,
        )
        .map_err(replay_error)
    })
}

/// Replay one Core-validated Archive V2 through DAG-ML's callback-free Methods
/// runtime. All structured values are strict JSON contracts; no Python object,
/// estimator handle, callback, or joblib payload crosses this boundary.
#[pyfunction]
#[pyo3(signature = (
    path,
    request_json,
    data_envelopes_json,
    methods_inputs_json,
    methods_library_path,
    outcome_id,
    run_id,
    warnings_json = "[]",
    diagnostics_json = "{}"
))]
#[allow(clippy::too_many_arguments)]
fn replay_methods_archive_v2_json(
    py: Python<'_>,
    path: &str,
    request_json: &str,
    data_envelopes_json: &str,
    methods_inputs_json: &str,
    methods_library_path: &str,
    outcome_id: &str,
    run_id: &str,
    warnings_json: &str,
    diagnostics_json: &str,
) -> PyResult<String> {
    let archive_path = PathBuf::from(path);
    let input = replay_json_input(
        request_json,
        data_envelopes_json,
        methods_inputs_json,
        methods_library_path,
        outcome_id,
        run_id,
        warnings_json,
        diagnostics_json,
    );
    py.detach(move || core_replay_methods_archive_v2_json(&archive_path, input))
        .map_err(replay_error)
}

/// Execute Core's closed X-only Archive V2 matrix prediction surface.
///
/// Core owns request composition, target-order validation, libn4m SHA-256 and
/// ABI attestation, the private library snapshot and replay outcome checks.
#[pyfunction]
fn predict_methods_archive_v2_matrix_json(
    py: Python<'_>,
    path: &str,
    input_json: &str,
) -> PyResult<String> {
    let archive_path = PathBuf::from(path);
    let input_json = input_json.to_owned();
    py.detach(move || {
        let archive = load_archive_v2(&archive_path).map_err(archive_error)?;
        core_predict_methods_archive_v2_matrix_json(&archive, &input_json).map_err(replay_error)
    })
}

/// Replay one calibrated Archive V2 and return DAG-ML's self-validating
/// conformal presentation. Python transports JSON only; it never calculates
/// residual quantiles, interval endpoints, fingerprints, or sample joins.
#[pyfunction]
#[pyo3(signature = (
    path,
    request_json,
    data_envelopes_json,
    methods_inputs_json,
    methods_library_path,
    outcome_id,
    run_id,
    warnings_json = "[]",
    diagnostics_json = "{}"
))]
#[allow(clippy::too_many_arguments)]
fn replay_methods_archive_v2_conformal_presentation_v1_json(
    py: Python<'_>,
    path: &str,
    request_json: &str,
    data_envelopes_json: &str,
    methods_inputs_json: &str,
    methods_library_path: &str,
    outcome_id: &str,
    run_id: &str,
    warnings_json: &str,
    diagnostics_json: &str,
) -> PyResult<String> {
    let archive_path = PathBuf::from(path);
    let input = replay_json_input(
        request_json,
        data_envelopes_json,
        methods_inputs_json,
        methods_library_path,
        outcome_id,
        run_id,
        warnings_json,
        diagnostics_json,
    );
    py.detach(move || {
        core_replay_methods_archive_v2_conformal_presentation_v1_json(&archive_path, input)
    })
    .map_err(replay_error)
}

/// Replay one calibrated Archive V2 and return DAG-ML's complete,
/// content-bound multi-target conformal presentation V2. Python transports
/// strict JSON only and cannot reconstruct predictor or archive fingerprints.
#[pyfunction]
#[pyo3(signature = (
    path,
    request_json,
    data_envelopes_json,
    methods_inputs_json,
    methods_library_path,
    outcome_id,
    run_id,
    warnings_json = "[]",
    diagnostics_json = "{}"
))]
#[allow(clippy::too_many_arguments)]
fn replay_methods_archive_v2_conformal_presentation_v2_json(
    py: Python<'_>,
    path: &str,
    request_json: &str,
    data_envelopes_json: &str,
    methods_inputs_json: &str,
    methods_library_path: &str,
    outcome_id: &str,
    run_id: &str,
    warnings_json: &str,
    diagnostics_json: &str,
) -> PyResult<String> {
    let archive_path = PathBuf::from(path);
    let input = replay_json_input(
        request_json,
        data_envelopes_json,
        methods_inputs_json,
        methods_library_path,
        outcome_id,
        run_id,
        warnings_json,
        diagnostics_json,
    );
    py.detach(move || {
        core_replay_methods_archive_v2_conformal_presentation_v2_json(&archive_path, input)
    })
    .map_err(replay_error)
}

/// Replay one Core-validated Archive V3 through a fresh Methods-only runtime.
/// Supplemental host controllers are deliberately unavailable from Python.
#[pyfunction]
#[pyo3(signature = (
    path,
    request_json,
    data_envelopes_json,
    methods_inputs_json,
    methods_library_path,
    outcome_id,
    run_id,
    warnings_json = "[]",
    diagnostics_json = "{}"
))]
#[allow(clippy::too_many_arguments)]
fn replay_methods_archive_v3_json(
    py: Python<'_>,
    path: &str,
    request_json: &str,
    data_envelopes_json: &str,
    methods_inputs_json: &str,
    methods_library_path: &str,
    outcome_id: &str,
    run_id: &str,
    warnings_json: &str,
    diagnostics_json: &str,
) -> PyResult<String> {
    let archive_path = PathBuf::from(path);
    let input = replay_json_input(
        request_json,
        data_envelopes_json,
        methods_inputs_json,
        methods_library_path,
        outcome_id,
        run_id,
        warnings_json,
        diagnostics_json,
    );
    py.detach(move || core_replay_methods_archive_v3_json(&archive_path, input))
        .map_err(replay_error)
}

/// Write a fully assembled Archive V2 without implementing any archive or
/// DAG-ML semantics in Python. The manifest must come from DAG-ML's native
/// assembler; Core validates every declaration and derives the inventory/raw
/// hashes immediately before its atomic no-replace write.
#[pyfunction]
fn write_archive_v2_from_native_payloads(
    path: &str,
    manifest: &Bound<'_, PyAny>,
    members: Vec<(String, Vec<u8>)>,
) -> PyResult<(String, String)> {
    let manifest: Value = pythonize::depythonize(manifest).map_err(|error| {
        PyValueError::new_err(format!(
            "Archive V2 manifest is not JSON-compatible: {error}"
        ))
    })?;
    let payloads = members
        .into_iter()
        .map(|(path, bytes)| ArchivePayload { path, bytes })
        .collect();
    let reference = write_archive_v2(
        Path::new(path),
        ArchiveV2WriteRequest { manifest, payloads },
    )
    .map_err(archive_error)?;
    Ok((
        reference.archive_id().to_owned(),
        reference.archive_sha256().to_owned(),
    ))
}

/// Write a fully assembled Archive V3 without giving Python any archive or
/// DAG-ML execution responsibility.  DAG-ML assembles the signed manifest and
/// opaque members; Core validates the closed V3 container and publishes it
/// atomically without replacing an existing target.
#[pyfunction]
fn write_archive_v3_from_native_payloads(
    path: &str,
    manifest: &Bound<'_, PyAny>,
    members: Vec<(String, Vec<u8>)>,
) -> PyResult<(String, String)> {
    let manifest: Value = pythonize::depythonize(manifest).map_err(|error| {
        PyValueError::new_err(format!(
            "Archive V3 manifest is not JSON-compatible: {error}"
        ))
    })?;
    let payloads = members
        .into_iter()
        .map(|(path, bytes)| ArchivePayload { path, bytes })
        .collect();
    let reference = write_archive_v3(
        Path::new(path),
        ArchiveV3WriteRequest { manifest, payloads },
    )
    .map_err(|error| PyValueError::new_err(format!("Archive V3 validation refused: {error}")))?;
    Ok((
        reference.archive_id().to_owned(),
        reference.archive_sha256().to_owned(),
    ))
}

/// Python extension module installed as ``nirs4all_core._native``.
#[pymodule]
fn _native(module: &Bound<'_, PyModule>) -> PyResult<()> {
    module.add_function(wrap_pyfunction!(
        read_portable_predictor_package_v2,
        module
    )?)?;
    module.add_function(wrap_pyfunction!(read_portable_refit_package_v3, module)?)?;
    module.add_function(wrap_pyfunction!(
        inspect_methods_archive_v2_predictors_json,
        module
    )?)?;
    module.add_function(wrap_pyfunction!(replay_methods_archive_v2_json, module)?)?;
    module.add_function(wrap_pyfunction!(
        predict_methods_archive_v2_matrix_json,
        module
    )?)?;
    module.add_function(wrap_pyfunction!(
        replay_methods_archive_v2_conformal_presentation_v1_json,
        module
    )?)?;
    module.add_function(wrap_pyfunction!(
        replay_methods_archive_v2_conformal_presentation_v2_json,
        module
    )?)?;
    module.add_function(wrap_pyfunction!(replay_methods_archive_v3_json, module)?)?;
    module.add_function(wrap_pyfunction!(
        write_archive_v2_from_native_payloads,
        module
    )?)?;
    module.add_function(wrap_pyfunction!(
        write_archive_v3_from_native_payloads,
        module
    )?)
}
