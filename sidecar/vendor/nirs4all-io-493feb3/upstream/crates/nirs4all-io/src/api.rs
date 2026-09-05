// SPDX-License-Identifier: CeCILL-2.1 OR AGPL-3.0-or-later
//! Public API: `to_spec` (ports `api.py`'s `to_spec`).
//!
//! `to_spec` normalizes any non-in-memory input into a `(DatasetSpec, base_dir)`
//! pair: a spec dict (alias-normalized), a JSON config file, a directory
//! (convention-matched), a single file, or a file list (absolute inputs).
//! `load` (materialize → SpectroDataset) lands with the materialize path.

use std::collections::HashMap;
use std::io::Read;
use std::path::{Path, PathBuf};

use cap_std::ambient_authority;
use cap_std::fs::Dir;
use nirs4all_io_core::conventions::{assignments_to_spec_dict, match_items, resolve_profiles};
use nirs4all_io_core::materialize::{
    assemble_in_memory_with_tabular_limits, parse_fold_str, InMemorySource, SourcePayload,
    TabularReadLimits,
};
use nirs4all_io_core::spec::{
    normalize_to_spec_dict, role_tagged_config_to_spec, validate_spec, DatasetSpec, SpecError,
};
use same_file::Handle;
use serde_json::{json, Value};

use crate::materialize::assemble::assemble_with_budget;
use crate::materialize::limits::ReadBudget;
use crate::materialize::AssembledDataset;
pub use crate::materialize::LoadLimits;
use crate::resolve::resolve_path;

const CONFIG_SUFFIXES: &[&str] = &["json", "yaml", "yml"];
const DEFAULT_CONVENTIONS: &[&str] = &["nirs4all-classic"];

/// Per-file and aggregate byte budgets for the product-facing role adapter.
pub const MAX_ROLE_TAGGED_FILE_BYTES: u64 = 256 * 1024 * 1024;
pub const MAX_ROLE_TAGGED_TOTAL_BYTES: u64 = 512 * 1024 * 1024;

/// Host-selected read budgets for role-tagged dataset materialization.
///
/// Custom limits can only tighten the compatibility defaults. This keeps the
/// adapter bounded even when a host constructs the limits from user-facing
/// configuration.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct RoleTaggedReadLimits {
    max_file_bytes: u64,
    max_total_bytes: u64,
    max_record_bytes: u64,
    max_field_bytes: u64,
    max_rows: u64,
    max_columns: u64,
    max_cells: u64,
}

impl RoleTaggedReadLimits {
    /// Build tighter read budgets for a product host.
    pub fn new(
        max_file_bytes: u64,
        max_total_bytes: u64,
        max_record_bytes: u64,
        max_field_bytes: u64,
        max_rows: u64,
        max_columns: u64,
        max_cells: u64,
    ) -> Result<Self, SpecError> {
        if [
            max_file_bytes,
            max_total_bytes,
            max_record_bytes,
            max_field_bytes,
            max_rows,
            max_columns,
            max_cells,
        ]
        .contains(&0)
        {
            return Err(SpecError::new(
                "role-tagged read limits must be greater than zero",
            ));
        }
        if max_file_bytes > max_total_bytes {
            return Err(SpecError::new(
                "role-tagged per-file read limit cannot exceed the aggregate limit",
            ));
        }
        if max_file_bytes > MAX_ROLE_TAGGED_FILE_BYTES
            || max_total_bytes > MAX_ROLE_TAGGED_TOTAL_BYTES
        {
            return Err(SpecError::new(format!(
                "role-tagged read limits cannot exceed the compatibility ceilings of {MAX_ROLE_TAGGED_FILE_BYTES} bytes per file and {MAX_ROLE_TAGGED_TOTAL_BYTES} bytes total"
            )));
        }
        if max_record_bytes > max_file_bytes || max_field_bytes > max_record_bytes {
            return Err(SpecError::new(
                "role-tagged field limit must not exceed the record limit, and the record limit must not exceed the file limit",
            ));
        }
        Ok(Self {
            max_file_bytes,
            max_total_bytes,
            max_record_bytes,
            max_field_bytes,
            max_rows,
            max_columns,
            max_cells,
        })
    }

    /// Maximum bytes accepted from one opened file handle.
    pub const fn max_file_bytes(self) -> u64 {
        self.max_file_bytes
    }

    /// Maximum bytes accepted across all opened file handles.
    pub const fn max_total_bytes(self) -> u64 {
        self.max_total_bytes
    }

    pub const fn max_record_bytes(self) -> u64 {
        self.max_record_bytes
    }

    pub const fn max_field_bytes(self) -> u64 {
        self.max_field_bytes
    }

    pub const fn max_rows(self) -> u64 {
        self.max_rows
    }

    pub const fn max_columns(self) -> u64 {
        self.max_columns
    }

    pub const fn max_cells(self) -> u64 {
        self.max_cells
    }

    fn tabular(self) -> TabularReadLimits {
        TabularReadLimits::new(
            self.max_record_bytes,
            self.max_field_bytes,
            self.max_rows,
            self.max_columns,
            self.max_cells,
        )
    }
}

impl Default for RoleTaggedReadLimits {
    fn default() -> Self {
        Self {
            max_file_bytes: MAX_ROLE_TAGGED_FILE_BYTES,
            max_total_bytes: MAX_ROLE_TAGGED_TOTAL_BYTES,
            max_record_bytes: u64::MAX,
            max_field_bytes: u64::MAX,
            max_rows: u64::MAX,
            max_columns: u64::MAX,
            max_cells: u64::MAX,
        }
    }
}

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
    to_spec_with_budget(
        input,
        conventions,
        name,
        &mut ReadBudget::new(LoadLimits::default())?,
    )
}

fn to_spec_with_budget(
    input: &Input,
    conventions: Option<&[String]>,
    name: Option<&str>,
    budget: &mut ReadBudget,
) -> Result<(DatasetSpec, PathBuf), SpecError> {
    match input {
        Input::Spec(v) => {
            let mut spec = DatasetSpec::from_value(&normalize_to_spec_dict(v))?;
            if let Some(n) = name {
                spec.name = Some(n.to_string());
            }
            Ok((spec, PathBuf::from(".")))
        }
        Input::Path(p) => to_spec_path(p, conventions, name, budget),
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
    load_assembled_with_limits(input, conventions, name, LoadLimits::default())
}

/// Materialize using explicit host budgets, shared by all file reads in a load.
pub fn load_assembled_with_limits(
    input: &Input,
    conventions: Option<&[String]>,
    name: Option<&str>,
    limits: LoadLimits,
) -> Result<AssembledDataset, SpecError> {
    let mut budget = ReadBudget::new(limits)?;
    let (spec, base) = to_spec_with_budget(input, conventions, name, &mut budget)?;
    validate_spec(&spec)?;
    assemble_with_budget(&spec, &base, &mut budget)
}

/// Adapt Studio's existing role-tagged `config.files` object to the official
/// [`DatasetSpec`]. This is a strict input adapter, not a persistent schema.
pub fn to_spec_role_tagged(config: &Value, name: Option<&str>) -> Result<DatasetSpec, SpecError> {
    let mut spec = role_tagged_config_to_spec(config)?;
    if let Some(name) = name {
        if name.trim().is_empty() || name.trim() != name || name.len() > 256 {
            return Err(SpecError::new(
                "role-tagged config: dataset name must be 1..=256 bytes with no surrounding whitespace",
            ));
        }
        spec.name = Some(name.to_string());
    }
    Ok(spec)
}

fn role_err(message: impl Into<String>) -> SpecError {
    SpecError::new(format!("role-tagged config: {}", message.into()))
}

fn reject_compressed(path: &str, field: &str) -> Result<(), SpecError> {
    let lower = path.to_ascii_lowercase();
    if lower.ends_with(".gz") || lower.ends_with(".zip") {
        return Err(role_err(format!(
            "{field}: compressed .gz/.zip inputs are not supported by the bounded role-tagged adapter"
        )));
    }
    Ok(())
}

/// Capability-rooted reader. `cap_std::fs::Dir` resolves every relative open
/// beneath an already-open directory handle, including under concurrent
/// symlink replacement. Bytes are then read from that same file handle; the
/// checked path is never reopened by the scientific loader.
struct ConfinedReader {
    root: Dir,
    root_path: PathBuf,
    limits: RoleTaggedReadLimits,
    identities: Vec<Handle>,
    total_bytes: u64,
}

impl ConfinedReader {
    fn new(dataset_root: &Path, limits: RoleTaggedReadLimits) -> Result<Self, SpecError> {
        let root_path = std::fs::canonicalize(dataset_root)
            .map_err(|error| role_err(format!("cannot resolve dataset_root: {error}")))?;
        if !root_path.is_dir() {
            return Err(role_err("dataset_root is not a directory"));
        }
        let root = Dir::open_ambient_dir(&root_path, ambient_authority())
            .map_err(|error| role_err(format!("cannot open dataset_root: {error}")))?;
        Ok(Self {
            root,
            root_path,
            limits,
            identities: Vec::new(),
            total_bytes: 0,
        })
    }

    fn relative_path(&self, raw: &str, field: &str) -> Result<PathBuf, SpecError> {
        let path = Path::new(raw);
        let relative = if path.is_absolute() {
            path.strip_prefix(&self.root_path)
                .map_err(|_| role_err(format!("{field}: absolute path is outside dataset_root")))?
        } else {
            path
        };
        if relative.as_os_str().is_empty() {
            return Err(role_err(format!("{field}: path resolves to dataset_root")));
        }
        Ok(relative.to_path_buf())
    }

    fn read(&mut self, raw: &str, field: &str) -> Result<Vec<u8>, SpecError> {
        self.read_with_after_open(raw, field, || {})
    }

    fn read_with_after_open<F>(
        &mut self,
        raw: &str,
        field: &str,
        after_open: F,
    ) -> Result<Vec<u8>, SpecError>
    where
        F: FnOnce(),
    {
        reject_compressed(raw, field)?;
        let relative = self.relative_path(raw, field)?;
        let cap_file = self
            .root
            .open(&relative)
            .map_err(|error| role_err(format!("cannot securely open {field} {raw:?}: {error}")))?;
        let mut file = cap_file.into_std();
        let metadata = file
            .metadata()
            .map_err(|error| role_err(format!("cannot inspect {field} {raw:?}: {error}")))?;
        if !metadata.is_file() {
            return Err(role_err(format!("{field} {raw:?} is not a regular file")));
        }
        if metadata.len() > self.limits.max_file_bytes {
            return Err(role_err(format!(
                "{field} {raw:?} exceeds the {}-byte file budget",
                self.limits.max_file_bytes
            )));
        }
        let remaining_total = self
            .limits
            .max_total_bytes
            .checked_sub(self.total_bytes)
            .ok_or_else(|| role_err("aggregate byte budget is already exhausted"))?;
        if metadata.len() > remaining_total {
            return Err(role_err(format!(
                "inputs exceed the {}-byte aggregate budget",
                self.limits.max_total_bytes
            )));
        }
        let identity = Handle::from_file(
            file.try_clone()
                .map_err(|error| role_err(format!("cannot clone {field} handle: {error}")))?,
        )
        .map_err(|error| role_err(format!("cannot identify {field} {raw:?}: {error}")))?;
        if self.identities.iter().any(|seen| seen == &identity) {
            return Err(role_err(format!(
                "{field} {raw:?} resolves to a file already used by this config"
            )));
        }

        // Tests swap the directory entry here. Reading continues from `file`,
        // proving there is no check-then-reopen window.
        after_open();

        let read_budget = self.limits.max_file_bytes.min(remaining_total);
        let mut bytes =
            Vec::with_capacity(metadata.len().min(read_budget).min(1024 * 1024) as usize);
        file.by_ref()
            .take(read_budget + 1)
            .read_to_end(&mut bytes)
            .map_err(|error| role_err(format!("cannot read {field} {raw:?}: {error}")))?;
        if bytes.len() as u64 > self.limits.max_file_bytes {
            return Err(role_err(format!(
                "{field} {raw:?} grew beyond the {}-byte file budget while reading",
                self.limits.max_file_bytes
            )));
        }
        if bytes.len() as u64 > remaining_total {
            return Err(role_err(format!(
                "inputs exceed the {}-byte aggregate budget while reading",
                self.limits.max_total_bytes
            )));
        }
        let actual_total = self.total_bytes + bytes.len() as u64;
        self.total_bytes = actual_total;
        self.identities.push(identity);
        Ok(bytes)
    }
}

fn fold_format(path: &str, configured: &str) -> Result<String, SpecError> {
    if !configured.is_empty() && configured != "auto" {
        return Ok(configured.to_string());
    }
    match Path::new(path)
        .extension()
        .and_then(|extension| extension.to_str())
        .map(str::to_ascii_lowercase)
        .as_deref()
    {
        Some("csv") => Ok("csv".into()),
        Some("json") => Ok("json".into()),
        Some("txt") => Ok("txt".into()),
        Some("yaml" | "yml") => Ok("yaml".into()),
        other => Err(role_err(format!(
            "cannot infer fold-file format from {other:?}"
        ))),
    }
}

/// Materialize a role-tagged config through the existing fs-free scientific
/// loader after every source and fold file has been securely opened and read
/// under `dataset_root` with explicit byte budgets.
pub fn load_role_tagged_assembled(
    config: &Value,
    dataset_root: &Path,
    name: Option<&str>,
) -> Result<AssembledDataset, SpecError> {
    load_role_tagged_assembled_with_limits(
        config,
        dataset_root,
        name,
        RoleTaggedReadLimits::default(),
    )
}

/// Materialize a role-tagged config with host-selected read budgets.
///
/// All sources and fold files are opened relative to the same capability root
/// as [`load_role_tagged_assembled`]. File metadata is checked before buffer
/// allocation, and reads are capped at the smaller remaining budget plus one
/// byte so concurrent file growth cannot bypass either limit.
pub fn load_role_tagged_assembled_with_limits(
    config: &Value,
    dataset_root: &Path,
    name: Option<&str>,
    limits: RoleTaggedReadLimits,
) -> Result<AssembledDataset, SpecError> {
    let spec = to_spec_role_tagged(config, name)?;
    let mut reader = ConfinedReader::new(dataset_root, limits)?;
    let mut sources = Vec::with_capacity(spec.sources.len());
    for source in &spec.sources {
        let raw = source
            .input
            .as_str()
            .ok_or_else(|| role_err(format!("source {:?} input is not a path", source.id)))?;
        sources.push(InMemorySource {
            name: raw.to_string(),
            payload: SourcePayload::Bytes(reader.read(raw, &format!("source {:?}", source.id))?),
        });
    }

    let fold_inline = if let Some(folds) = &spec.folds {
        if let Some(raw) = folds.file.as_deref().filter(|path| !path.is_empty()) {
            let bytes = reader.read(raw, "folds.file")?;
            let text =
                std::str::from_utf8(&bytes).map_err(|_| role_err("folds.file must be UTF-8"))?;
            Some(parse_fold_str(
                text,
                &fold_format(raw, folds.format.value())?,
            )?)
        } else {
            None
        }
    } else {
        None
    };

    assemble_in_memory_with_tabular_limits(
        &spec,
        &sources,
        &HashMap::new(),
        fold_inline.as_deref(),
        Some(limits.tabular()),
    )
}

fn to_spec_path(
    p: &str,
    conventions: Option<&[String]>,
    name: Option<&str>,
    budget: &mut ReadBudget,
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
        let text = String::from_utf8(budget.read(path)?)
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

#[cfg(all(test, unix))]
mod role_tagged_secure_open_tests {
    use super::*;
    use std::fs;
    use std::os::unix::fs::symlink;

    #[test]
    fn directory_entry_swap_after_open_cannot_change_the_bytes_read() {
        let root = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let input = root.path().join("X.csv");
        fs::write(&input, b"original").unwrap();
        let attacker = outside.path().join("attacker.csv");
        fs::write(&attacker, b"attacker").unwrap();

        let limits = RoleTaggedReadLimits::new(16, 32, 16, 16, 16, 16, 256).unwrap();
        let mut reader = ConfinedReader::new(root.path(), limits).unwrap();
        let bytes = reader
            .read_with_after_open("X.csv", "test source", || {
                fs::rename(&input, root.path().join("opened.csv")).unwrap();
                symlink(&attacker, &input).unwrap();
            })
            .unwrap();

        assert_eq!(bytes, b"original");
        assert_eq!(fs::read(&input).unwrap(), b"attacker");
    }
}
