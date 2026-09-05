// SPDX-License-Identifier: CeCILL-2.1 OR AGPL-3.0-or-later
//! wasm-bindgen binding for `nirs4all-io` (EPIC 11.4).
//!
//! WASM has no filesystem (D-R7), so this binding exposes the pure, fs-free
//! JSON surface backed by `nirs4all-io-core`: normalize a spec/config dict into
//! the canonical `DatasetSpec` (`to_spec`), validate a spec (`validate`), and
//! infer a dataset plan from named in-memory files (`inferFiles`). Strings cross
//! as canonical JSON where that is the cross-binding contract; `inferFiles`
//! returns a plain JS object for browser UIs.

use nirs4all_io_core::canonical_json;
use nirs4all_io_core::infer::memory::{
    infer_browser_dataset, infer_decoded_records, infer_named_bytes, DecodedRecordSet, NamedBytes,
};
use nirs4all_io_core::infer::propose::{propose_browser_dataset, ConfirmedLock};
use nirs4all_io_core::materialize::{
    assemble_in_memory, AssembledDataset, InMemorySource, SourcePayload,
};
use nirs4all_io_core::spec::{normalize_to_spec_dict, validate_spec, DatasetSpec};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use serde_wasm_bindgen::Serializer;
use std::collections::HashMap;
use wasm_bindgen::prelude::*;

#[derive(Deserialize)]
struct WasmFile {
    name: String,
    bytes: Vec<u8>,
}

#[derive(Deserialize)]
struct WasmRecordSet {
    source: String,
    #[serde(default)]
    format: Option<String>,
    #[serde(default)]
    records: Vec<Value>,
}

#[derive(Deserialize, Default)]
struct InferOptions {
    #[serde(default)]
    conventions: Vec<String>,
}

#[derive(Deserialize)]
struct WasmConfirmedLock {
    kind: String,
    target: String,
    #[serde(default)]
    value: Value,
    #[serde(default)]
    status: Option<String>,
}

#[derive(Deserialize, Default)]
struct ProposeOptions {
    #[serde(default)]
    conventions: Vec<String>,
    #[serde(default)]
    confirmed: Vec<WasmConfirmedLock>,
}

fn js_serializer() -> Serializer {
    Serializer::new().serialize_maps_as_objects(true)
}

/// Normalize a spec/config JSON string into the canonical `DatasetSpec` JSON.
#[wasm_bindgen]
pub fn to_spec(spec_json: &str) -> Result<String, JsError> {
    let value: Value =
        serde_json::from_str(spec_json).map_err(|e| JsError::new(&format!("input JSON: {e}")))?;
    let spec = DatasetSpec::from_value(&normalize_to_spec_dict(&value))
        .map_err(|e| JsError::new(&e.message))?;
    canonical_json(&spec.to_value()).map_err(|e| JsError::new(&e.to_string()))
}

/// Validate a `DatasetSpec` JSON string; throws (rejects) when invalid.
#[wasm_bindgen]
pub fn validate(spec_json: &str) -> Result<(), JsError> {
    let value: Value =
        serde_json::from_str(spec_json).map_err(|e| JsError::new(&format!("input JSON: {e}")))?;
    let spec = DatasetSpec::from_value(&value).map_err(|e| JsError::new(&e.message))?;
    validate_spec(&spec).map_err(|e| JsError::new(&e.message))?;
    Ok(())
}

/// Infer a dataset plan from browser-provided files.
///
/// `files` must be an array of `{name, bytes}` where `bytes` is a
/// `Uint8Array`. `options.conventions` can override the default
/// `nirs4all-classic` convention list.
#[wasm_bindgen(js_name = inferFiles)]
pub fn infer_files(files: JsValue, options: JsValue) -> Result<JsValue, JsError> {
    let files: Vec<WasmFile> = serde_wasm_bindgen::from_value(files)
        .map_err(|e| JsError::new(&format!("files must be an array of {{name, bytes}}: {e}")))?;
    let options = parse_options(options)?;
    let named = files
        .into_iter()
        .map(|f| NamedBytes {
            name: f.name,
            bytes: f.bytes,
        })
        .collect::<Vec<_>>();
    let conventions = if options.conventions.is_empty() {
        None
    } else {
        Some(options.conventions.as_slice())
    };
    let plan = infer_named_bytes(&named, conventions).map_err(|e| JsError::new(&e.message))?;
    plan.to_value()
        .serialize(&js_serializer())
        .map_err(|e| JsError::new(&e.to_string()))
}

/// Infer a browser dataset plan from raw files and decoded spectral records.
///
/// `files` must be an array of `{name, bytes}`. `recordSets` must be an array
/// of `{source, format?, records}` where records follow `nirs4all-formats`.
#[wasm_bindgen(js_name = inferDataset)]
pub fn infer_dataset(
    files: JsValue,
    record_sets: JsValue,
    options: JsValue,
) -> Result<JsValue, JsError> {
    let files: Vec<WasmFile> = serde_wasm_bindgen::from_value(files)
        .map_err(|e| JsError::new(&format!("files must be an array of {{name, bytes}}: {e}")))?;
    let record_sets: Vec<WasmRecordSet> = serde_wasm_bindgen::from_value(record_sets)
        .map_err(|e| JsError::new(&format!("recordSets must be an array: {e}")))?;
    let options = parse_options(options)?;
    let named = files
        .into_iter()
        .map(|f| NamedBytes {
            name: f.name,
            bytes: f.bytes,
        })
        .collect::<Vec<_>>();
    let sets = record_sets
        .into_iter()
        .map(|set| DecodedRecordSet {
            source: set.source,
            format: set.format,
            records: set.records,
        })
        .collect::<Vec<_>>();
    let conventions = if options.conventions.is_empty() {
        None
    } else {
        Some(options.conventions.as_slice())
    };
    let plan =
        infer_browser_dataset(&named, &sets, conventions).map_err(|e| JsError::new(&e.message))?;
    plan.to_value()
        .serialize(&js_serializer())
        .map_err(|e| JsError::new(&e.to_string()))
}

/// Iterative, user-validatable dataset inference.
///
/// Inputs mirror [`infer_dataset`] plus `options.confirmed` — an array of
/// `{kind, target, value, status?}` locks the user has accepted/overridden,
/// fed back so re-inference honours them. Returns a plain JS object
/// `{plan, proposals, spec, valid, validation_errors}` where `proposals` is the
/// list of still-open (and echoed confirmed) decisions to validate.
#[wasm_bindgen(js_name = proposeDataset)]
pub fn propose_dataset(
    files: JsValue,
    record_sets: JsValue,
    options: JsValue,
) -> Result<JsValue, JsError> {
    let files: Vec<WasmFile> = serde_wasm_bindgen::from_value(files)
        .map_err(|e| JsError::new(&format!("files must be an array of {{name, bytes}}: {e}")))?;
    let record_sets: Vec<WasmRecordSet> = serde_wasm_bindgen::from_value(record_sets)
        .map_err(|e| JsError::new(&format!("recordSets must be an array: {e}")))?;
    let opts: ProposeOptions = if options.is_null() || options.is_undefined() {
        ProposeOptions::default()
    } else {
        serde_wasm_bindgen::from_value(options)
            .map_err(|e| JsError::new(&format!("invalid propose options: {e}")))?
    };
    let named = files
        .into_iter()
        .map(|f| NamedBytes {
            name: f.name,
            bytes: f.bytes,
        })
        .collect::<Vec<_>>();
    let sets = record_sets
        .into_iter()
        .map(|set| DecodedRecordSet {
            source: set.source,
            format: set.format,
            records: set.records,
        })
        .collect::<Vec<_>>();
    let confirmed = opts
        .confirmed
        .into_iter()
        .map(|l| ConfirmedLock {
            kind: l.kind,
            target: l.target,
            value: l.value,
            status: l.status,
        })
        .collect::<Vec<_>>();
    let conventions = if opts.conventions.is_empty() {
        None
    } else {
        Some(opts.conventions.as_slice())
    };
    let result = propose_browser_dataset(&named, &sets, &confirmed, conventions)
        .map_err(|e| JsError::new(&e.message))?;
    result
        .to_value()
        .serialize(&js_serializer())
        .map_err(|e| JsError::new(&e.to_string()))
}

/// Infer a dataset plan from decoded spectral records.
///
/// `recordSets` must be an array of `{source, format?, records}` where
/// `records` follows the JSON shape emitted by `nirs4all-formats`.
#[wasm_bindgen(js_name = inferRecords)]
pub fn infer_records(record_sets: JsValue) -> Result<JsValue, JsError> {
    let record_sets: Vec<WasmRecordSet> = serde_wasm_bindgen::from_value(record_sets)
        .map_err(|e| JsError::new(&format!("recordSets must be an array: {e}")))?;
    let sets = record_sets
        .into_iter()
        .map(|set| DecodedRecordSet {
            source: set.source,
            format: set.format,
            records: set.records,
        })
        .collect::<Vec<_>>();
    let plan = infer_decoded_records(&sets).map_err(|e| JsError::new(&e.message))?;
    plan.to_value()
        .serialize(&js_serializer())
        .map_err(|e| JsError::new(&e.to_string()))
}

/// Assemble a `DatasetSpec` into a materialized, target-agnostic dataset, fs-free.
///
/// `files` = array of `{name, bytes}` — CSV/tabular bytes the formats layer won't
/// decode (y / metadata tables). `recordSets` = array of `{source, format?,
/// records}` — pre-decoded `nirs4all-formats` records (signals → X, targets,
/// metadata). `spec` = a `DatasetSpec` JSON string (typically `plan.resolved_spec`);
/// its source `input` strings must match the `name`/`source` of the supplied
/// sources (exact, then file-stem, then glob). Returns `AssembledDataset` as a
/// plain JS object (per-partition `blocks` with `x`/`y`/headers/metadata + `folds`).
///
/// `index_file`/`folds.file` partitions are not browser-reachable here (no fs) and
/// raise an error — column/inline partitions and folds work.
#[wasm_bindgen(js_name = assembleDataset)]
pub fn assemble_dataset(
    files: JsValue,
    record_sets: JsValue,
    spec: &str,
) -> Result<JsValue, JsError> {
    let assembled = assemble_from_js(files, record_sets, spec)?;
    assembled
        .to_full_value()
        .serialize(&js_serializer())
        .map_err(|e| JsError::new(&e.to_string()))
}

/// Materialize the same fs-free inputs as [`assemble_dataset`] and return the
/// canonical structural summary used by the native CLI and C ABI.
///
/// Keeping this as canonical JSON (rather than a re-serialized JS object) makes
/// the cross-language qualification byte-exact and preserves source, sample,
/// observation, repetition, group, and fold provenance without host-side logic.
#[wasm_bindgen(js_name = loadSummary)]
pub fn load_summary(
    files: JsValue,
    record_sets: JsValue,
    spec: &str,
) -> Result<String, JsError> {
    let assembled = assemble_from_js(files, record_sets, spec)?;
    canonical_json(&assembled.to_summary_value()).map_err(|e| JsError::new(&e.to_string()))
}

fn assemble_from_js(
    files: JsValue,
    record_sets: JsValue,
    spec: &str,
) -> Result<AssembledDataset, JsError> {
    let files: Vec<WasmFile> = serde_wasm_bindgen::from_value(files)
        .map_err(|e| JsError::new(&format!("files must be an array of {{name, bytes}}: {e}")))?;
    let record_sets: Vec<WasmRecordSet> = serde_wasm_bindgen::from_value(record_sets)
        .map_err(|e| JsError::new(&format!("recordSets must be an array: {e}")))?;
    let value: Value =
        serde_json::from_str(spec).map_err(|e| JsError::new(&format!("spec JSON: {e}")))?;
    let spec = DatasetSpec::from_value(&value).map_err(|e| JsError::new(&e.message))?;

    let mut sources: Vec<InMemorySource> = Vec::with_capacity(files.len() + record_sets.len());
    for f in files {
        sources.push(InMemorySource {
            name: f.name,
            payload: SourcePayload::Bytes(f.bytes),
        });
    }
    for set in record_sets {
        sources.push(InMemorySource {
            name: set.source,
            payload: SourcePayload::Records(set.records),
        });
    }

    assemble_in_memory(&spec, &sources, &HashMap::new(), None)
        .map_err(|e| JsError::new(&e.message))
}

/// The wire-contract (crate) version string.
#[wasm_bindgen]
pub fn version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

fn parse_options(options: JsValue) -> Result<InferOptions, JsError> {
    if options.is_null() || options.is_undefined() {
        Ok(InferOptions::default())
    } else {
        serde_wasm_bindgen::from_value(options)
            .map_err(|e| JsError::new(&format!("invalid infer options: {e}")))
    }
}
