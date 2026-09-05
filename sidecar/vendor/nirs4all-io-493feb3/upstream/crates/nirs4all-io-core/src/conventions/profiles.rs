// SPDX-License-Identifier: CeCILL-2.1 OR AGPL-3.0-or-later
//! Convention profiles (ports `conventions/profiles.py`).
//!
//! A profile maps filenames to dataset roles/partitions. The four built-ins are
//! embedded from the Python package directory (single source of truth — they
//! migrate to a top-level `conventions/` anchor when the Python MVP is relegated
//! in EPIC 12). `roles`/`bare` preserve TOML document order, which is
//! load-bearing for assignment order.

use crate::spec::enums::{Partition, Role, SpecError};
use serde_json::Value;

/// Legacy role-bucket key for folds (handled separately from sample roles).
pub const FOLDS_ROLE_KEY: &str = "folds";

/// Fallback extension set when no formats registry is supplied (CSV family).
pub const DEFAULT_EXTENSIONS: &[&str] =
    &[".csv", ".csv.gz", ".csv.zip", ".tsv", ".txt", ".gz", ".zip"];

/// Map a legacy role-bucket key to `(Role, Option<Partition>)` (Python `ROLE_KEY_MAP`).
pub fn role_key_map(key: &str) -> Option<(Role, Option<Partition>)> {
    match key {
        "train_x" => Some((Role::Features, Some(Partition::Train))),
        "test_x" => Some((Role::Features, Some(Partition::Test))),
        "train_y" => Some((Role::Targets, Some(Partition::Train))),
        "test_y" => Some((Role::Targets, Some(Partition::Test))),
        "train_group" => Some((Role::Metadata, Some(Partition::Train))),
        "test_group" => Some((Role::Metadata, Some(Partition::Test))),
        _ => None,
    }
}

#[derive(Debug, Clone)]
pub struct MatchConfig {
    pub short_pattern_word_boundary: bool,
    pub case_insensitive: bool,
    pub recursive: bool,
    pub extensions: Vec<String>,
}

impl Default for MatchConfig {
    fn default() -> Self {
        Self {
            short_pattern_word_boundary: true,
            case_insensitive: true,
            recursive: false,
            extensions: vec!["from-formats-registry".to_string()],
        }
    }
}

impl MatchConfig {
    fn from_value(d: Option<&Value>) -> Self {
        let Some(Value::Object(m)) = d else {
            return Self::default();
        };
        let b = |k: &str, default: bool| m.get(k).map(crate::pyfmt::py_truthy).unwrap_or(default);
        let extensions = match m.get("extensions") {
            Some(Value::Array(a)) => a
                .iter()
                .filter_map(|v| v.as_str().map(str::to_string))
                .collect(),
            _ => vec!["from-formats-registry".to_string()],
        };
        Self {
            short_pattern_word_boundary: b("short_pattern_word_boundary", true),
            case_insensitive: b("case_insensitive", true),
            recursive: b("recursive", false),
            extensions,
        }
    }
}

#[derive(Debug, Clone)]
pub struct Profile {
    pub name: String,
    pub version: i64,
    /// Ordered `(role_key, patterns)` — TOML order is load-bearing.
    pub roles: Vec<(String, Vec<String>)>,
    pub bare: Vec<(String, Vec<String>)>,
    pub match_cfg: MatchConfig,
    pub spectra: Option<Value>,
    pub reference: Option<Value>,
    pub join: Option<Value>,
}

fn str_list_map(v: Option<&Value>) -> Vec<(String, Vec<String>)> {
    match v {
        Some(Value::Object(m)) => m
            .iter()
            .map(|(k, val)| {
                let list = match val {
                    Value::Array(a) => a
                        .iter()
                        .filter_map(|x| x.as_str().map(str::to_string))
                        .collect(),
                    _ => vec![],
                };
                (k.clone(), list)
            })
            .collect(),
        _ => vec![],
    }
}

impl Profile {
    pub fn is_vendor_corpus(&self) -> bool {
        self.spectra.is_some()
    }

    pub fn from_value(d: &Value) -> Result<Self, SpecError> {
        let m = d
            .as_object()
            .ok_or_else(|| SpecError::new("convention profile must be a mapping"))?;
        let name = m
            .get("profile")
            .or_else(|| m.get("name"))
            .and_then(|v| v.as_str())
            .ok_or_else(|| {
                SpecError::new(format!(
                    "convention profile needs a 'profile'/'name': {}",
                    crate::pyfmt::py_repr(d)
                ))
            })?
            .to_string();
        Ok(Self {
            name,
            version: m.get("version").and_then(|v| v.as_i64()).unwrap_or(1),
            roles: str_list_map(m.get("roles")),
            bare: str_list_map(m.get("bare")),
            match_cfg: MatchConfig::from_value(m.get("match")),
            spectra: m.get("spectra").cloned().filter(|v| !v.is_null()),
            reference: m.get("reference").cloned().filter(|v| !v.is_null()),
            join: m.get("join").cloned().filter(|v| !v.is_null()),
        })
    }
}

// Built-in profiles, embedded from a crate-local copy so a packaged crate
// (cargo package / crates.io / vendored) still compiles. The copies are kept
// byte-identical to the Python `src/nirs4all_io/conventions/builtin/` source by
// `tests/test_convention_toml_sync.py`; they consolidate into a single
// top-level `conventions/` anchor when the Python MVP is relegated (EPIC 12).
const BARE_TOML: &str = include_str!("../../conventions/builtin/bare.toml");
const CLASSIC_TOML: &str = include_str!("../../conventions/builtin/nirs4all-classic.toml");
const TRAIN_TEST_TOML: &str = include_str!("../../conventions/builtin/train-test.toml");
const VENDOR_CORPUS_TOML: &str = include_str!("../../conventions/builtin/vendor-corpus.toml");

fn builtin_toml(name: &str) -> Option<&'static str> {
    match name {
        "bare" => Some(BARE_TOML),
        "nirs4all-classic" => Some(CLASSIC_TOML),
        "train-test" => Some(TRAIN_TEST_TOML),
        "vendor-corpus" => Some(VENDOR_CORPUS_TOML),
        _ => None,
    }
}

/// All built-in profile names.
pub const BUILTIN_NAMES: &[&str] = &["bare", "nirs4all-classic", "train-test", "vendor-corpus"];

fn load_builtin(name: &str) -> Result<Profile, SpecError> {
    let text = builtin_toml(name)
        .ok_or_else(|| SpecError::new(format!("unknown built-in convention profile: {name}")))?;
    let value: Value = toml::from_str(text)
        .map_err(|e| SpecError::new(format!("failed to parse built-in profile {name}: {e}")))?;
    Profile::from_value(&value)
}

/// Resolve built-in profile names to [`Profile`]s. (File-path / inline-dict
/// profiles are a facade concern; core handles the built-ins.)
pub fn resolve_profiles(names: &[&str]) -> Result<Vec<Profile>, SpecError> {
    names.iter().map(|n| load_builtin(n)).collect()
}

/// All shipped built-in profiles (for the convention-coverage test).
pub fn builtin_profiles() -> Result<Vec<Profile>, SpecError> {
    BUILTIN_NAMES.iter().map(|n| load_builtin(n)).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn loads_all_builtins() {
        let profs = builtin_profiles().unwrap();
        let names: Vec<&str> = profs.iter().map(|p| p.name.as_str()).collect();
        assert_eq!(
            names,
            vec!["bare", "nirs4all-classic", "train-test", "vendor-corpus"]
        );
    }

    #[test]
    fn classic_roles_order_preserved() {
        let p = &resolve_profiles(&["nirs4all-classic"]).unwrap()[0];
        let keys: Vec<&str> = p.roles.iter().map(|(k, _)| k.as_str()).collect();
        assert_eq!(
            keys,
            vec![
                "train_x",
                "test_x",
                "train_y",
                "test_y",
                "train_group",
                "test_group",
                "folds"
            ]
        );
        assert!(!p.is_vendor_corpus());
    }

    #[test]
    fn vendor_corpus_detected() {
        let p = &resolve_profiles(&["vendor-corpus"]).unwrap()[0];
        assert!(p.is_vendor_corpus());
    }
}
