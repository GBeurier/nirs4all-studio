// SPDX-License-Identifier: CeCILL-2.1 OR AGPL-3.0-or-later
//! Public API: `to_spec` (ports `api.py`'s `to_spec`).
//!
//! `to_spec` normalizes any non-in-memory input into a `(DatasetSpec, base_dir)`
//! pair: a spec dict (alias-normalized), a JSON config file, a directory
//! (convention-matched), a single file, or a file list (absolute inputs).
//! `load` (materialize → SpectroDataset) lands with the materialize path.

use std::path::{Path, PathBuf};

use nirs4all_io_core::conventions::{assignments_to_spec_dict, match_items, resolve_profiles};
use nirs4all_io_core::spec::{normalize_to_spec_dict, validate_spec, DatasetSpec, SpecError};
use serde_json::{json, Value};

use crate::materialize::{assemble, AssembledDataset};
use crate::resolve::resolve_path;

const CONFIG_SUFFIXES: &[&str] = &["json", "yaml", "yml"];
const DEFAULT_CONVENTIONS: &[&str] = &["nirs4all-classic"];

/// A non-in-memory input form for `to_spec`.
pub enum Input {
    /// A spec/config dict (alias-normalized).
    Spec(Value),
    /// A path: directory, single file, or `.json`/`.yaml` config file.
    Path(String),
    /// A file list / globs (resolved to absolute inputs).
    Paths(Vec<String>),
}

fn file_stem(name: &str) -> String {
    match name.rfind('.') {
        Some(idx) if idx > 0 => name[..idx].to_string(),
        _ => name.to_string(),
    }
}

fn conv_refs(conventions: Option<&[String]>) -> Vec<String> {
    match conventions {
        Some(c) if !c.is_empty() => c.to_vec(),
        _ => DEFAULT_CONVENTIONS.iter().map(|s| s.to_string()).collect(),
    }
}

/// Normalize an input into a `(DatasetSpec, base_dir)` pair.
pub fn to_spec(
    input: &Input,
    conventions: Option<&[String]>,
    name: Option<&str>,
) -> Result<(DatasetSpec, PathBuf), SpecError> {
    match input {
        Input::Spec(v) => {
            let mut spec = DatasetSpec::from_value(&normalize_to_spec_dict(v))?;
            if let Some(n) = name {
                spec.name = Some(n.to_string());
            }
            Ok((spec, PathBuf::from(".")))
        }
        Input::Path(p) => to_spec_path(p, conventions, name),
        Input::Paths(ps) => to_spec_paths(ps, conventions, name),
    }
}

/// Materialize `input` into a target-agnostic [`AssembledDataset`]
/// (`load(..., target="assembled")`). The `SpectroDataset` target is a
/// binding-only adapter and lands with the bindings.
pub fn load_assembled(
    input: &Input,
    conventions: Option<&[String]>,
    name: Option<&str>,
) -> Result<AssembledDataset, SpecError> {
    let (spec, base) = to_spec(input, conventions, name)?;
    validate_spec(&spec)?;
    assemble(&spec, &base)
}

fn to_spec_path(
    p: &str,
    conventions: Option<&[String]>,
    name: Option<&str>,
) -> Result<(DatasetSpec, PathBuf), SpecError> {
    let path = Path::new(p);
    let suffix = path
        .extension()
        .and_then(|e| e.to_str())
        .map(str::to_lowercase);
    if suffix
        .as_deref()
        .is_some_and(|s| CONFIG_SUFFIXES.contains(&s))
        && path.is_file()
    {
        let text = std::fs::read_to_string(path)
            .map_err(|e| SpecError::new(format!("cannot read config {p}: {e}")))?;
        let raw: Value = if suffix.as_deref() == Some("json") {
            serde_json::from_str(&text)
                .map_err(|e| SpecError::new(format!("invalid JSON config {p}: {e}")))?
        } else {
            return Err(SpecError::new(
                "YAML config support lands with the PyYAML-1.1 shim; use JSON for now",
            ));
        };
        let mut spec = DatasetSpec::from_value(&normalize_to_spec_dict(&raw))?;
        let stem = path
            .file_stem()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_default();
        spec.name = name
            .map(String::from)
            .or_else(|| spec.name.clone().filter(|s| !s.is_empty()))
            .or(Some(stem));
        let base = path
            .parent()
            .map(Path::to_path_buf)
            .unwrap_or_else(|| PathBuf::from("."));
        return Ok((spec, base));
    }
    if path.is_dir() {
        let dir_name = name.map(String::from).unwrap_or_else(|| {
            path.file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_default()
        });
        let spec = spec_from_directory(p, conventions, &dir_name)?;
        return Ok((spec, path.to_path_buf()));
    }
    if path.is_file() {
        let base_name = path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default();
        let spec_name = name
            .map(String::from)
            .unwrap_or_else(|| file_stem(&base_name));
        let spec = DatasetSpec::from_value(&json!({
            "name": spec_name,
            "sources": [{"id": "data", "role": "features", "input": base_name}],
        }))?;
        let base = path
            .parent()
            .map(Path::to_path_buf)
            .unwrap_or_else(|| PathBuf::from("."));
        return Ok((spec, base));
    }
    Err(SpecError::new(format!("path does not exist: {p}")))
}

fn spec_from_directory(
    p: &str,
    conventions: Option<&[String]>,
    name: &str,
) -> Result<DatasetSpec, SpecError> {
    let iset = resolve_path(p, false);
    let conv = conv_refs(conventions);
    let conv_ref: Vec<&str> = conv.iter().map(String::as_str).collect();
    let profiles = resolve_profiles(&conv_ref)?;
    let result = match_items(&iset.names(), &profiles, None, None);
    let spec_dict = assignments_to_spec_dict(&result, name);
    let has_sources = spec_dict
        .get("sources")
        .and_then(|v| v.as_array())
        .is_some_and(|a| !a.is_empty());
    if !has_sources {
        let unmatched = nirs4all_io_core::pyfmt::py_repr(&Value::Array(
            result
                .unmatched
                .iter()
                .map(|s| Value::from(s.clone()))
                .collect(),
        ));
        return Err(SpecError::new(format!(
            "no dataset files recognized in {p} with conventions {conv:?}; unmatched: {unmatched}"
        )));
    }
    DatasetSpec::from_value(&spec_dict)
}

fn to_spec_paths(
    paths: &[String],
    conventions: Option<&[String]>,
    name: Option<&str>,
) -> Result<(DatasetSpec, PathBuf), SpecError> {
    let iset = crate::resolve::resolve_list(paths, false);
    // refs (basenames) -> absolute identities. Mirrors Python `api.py`, which
    // also builds `{it.ref: it.identity}` — so file lists with duplicate
    // basenames collapse to one entry. Reproduced for parity (a known Python
    // limitation), NOT a Rust regression; do not "fix" without changing Python.
    let name_to_abs: std::collections::HashMap<String, String> = iset
        .items
        .iter()
        .map(|it| (it.ref_.clone(), it.identity.clone()))
        .collect();
    let conv = conv_refs(conventions);
    let conv_ref: Vec<&str> = conv.iter().map(String::as_str).collect();
    let profiles = resolve_profiles(&conv_ref)?;
    let names: Vec<String> = name_to_abs.keys().cloned().collect();
    let result = match_items(&names, &profiles, None, None);
    let mut spec_dict = assignments_to_spec_dict(&result, name.unwrap_or("dataset"));
    if let Some(sources) = spec_dict.get_mut("sources").and_then(|v| v.as_array_mut()) {
        for src in sources.iter_mut() {
            let Some(obj) = src.as_object_mut() else {
                continue;
            };
            match obj.get("input").cloned() {
                Some(Value::Array(a)) => {
                    let mapped: Vec<Value> = a
                        .iter()
                        .map(|v| {
                            v.as_str()
                                .map(|s| {
                                    Value::from(
                                        name_to_abs
                                            .get(s)
                                            .cloned()
                                            .unwrap_or_else(|| s.to_string()),
                                    )
                                })
                                .unwrap_or_else(|| v.clone())
                        })
                        .collect();
                    obj.insert("input".into(), Value::Array(mapped));
                }
                Some(Value::String(s)) => {
                    obj.insert(
                        "input".into(),
                        Value::from(name_to_abs.get(&s).cloned().unwrap_or(s)),
                    );
                }
                _ => {}
            }
        }
    }
    Ok((DatasetSpec::from_value(&spec_dict)?, PathBuf::from(".")))
}
