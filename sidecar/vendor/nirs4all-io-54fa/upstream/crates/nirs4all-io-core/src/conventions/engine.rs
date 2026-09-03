// SPDX-License-Identifier: CeCILL-2.1 OR AGPL-3.0-or-later
//! Convention matching engine (ports `conventions/engine.py`).
//!
//! Generalizes nirs4all's `FolderParser`: the word-boundary matcher,
//! compound-extension stem logic, multi-source detection, and the bare-stem
//! second pass — over declarative [`Profile`]s. Pure: operates on filename
//! strings the facade resolver supplies.

use std::collections::HashSet;

use indexmap::IndexMap;
use serde_json::Value;

use super::profiles::{role_key_map, Profile, DEFAULT_EXTENSIONS, FOLDS_ROLE_KEY};
use crate::spec::enums::{Partition, Role};

const DELIMITERS: [u8; 4] = *b"._- ";

fn is_delim(b: u8) -> bool {
    DELIMITERS.contains(&b)
}

/// Word-boundary-aware match (verbatim from `FolderParser._pattern_matches`).
/// Inputs are expected already lowercased. ASCII-byte logic (filenames/patterns
/// are ASCII; non-ASCII bytes never equal an ASCII delimiter).
pub fn pattern_matches(filename: &str, pattern: &str, word_boundary: bool) -> bool {
    if word_boundary && pattern.chars().count() <= 2 {
        let fb = filename.as_bytes();
        let pb = pattern.as_bytes();
        if fb.starts_with(pb) && (fb.len() == pb.len() || is_delim(fb[pb.len()])) {
            return true;
        }
        for &delim in &DELIMITERS {
            let needle: Vec<u8> = std::iter::once(delim).chain(pb.iter().copied()).collect();
            if let Some(idx) = find_subslice(fb, &needle) {
                let end = idx + needle.len();
                if end >= fb.len() || is_delim(fb[end]) {
                    return true;
                }
            }
        }
        return false;
    }
    filename.contains(pattern)
}

fn find_subslice(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    if needle.is_empty() || needle.len() > haystack.len() {
        return None;
    }
    haystack.windows(needle.len()).position(|w| w == needle)
}

/// Filename stem without extension, handling compound `.csv.gz`/`.csv.zip`.
pub fn get_stem(filename: &str) -> String {
    let low = filename.to_lowercase();
    if low.ends_with(".csv.gz") {
        return filename[..filename.len() - ".csv.gz".len()].to_string();
    }
    if low.ends_with(".csv.zip") {
        return filename[..filename.len() - ".csv.zip".len()].to_string();
    }
    match filename.rfind('.') {
        Some(idx) if idx > 0 => filename[..idx].to_string(),
        _ => filename.to_string(),
    }
}

/// Whether `name` has a supported extension (CSV-family aware).
pub fn has_supported_extension(name: &str, extensions: &HashSet<String>) -> bool {
    let low = name.to_lowercase();
    if low.ends_with(".tar.gz")
        || low.ends_with(".tgz")
        || low.ends_with(".tar.bz2")
        || low.ends_with(".tar.xz")
        || low.ends_with(".tar")
    {
        return false;
    }
    if low.ends_with(".csv.gz") || low.ends_with(".csv.zip") {
        return extensions.contains(".csv.gz")
            || extensions.contains(".csv.zip")
            || extensions.contains(".gz")
            || extensions.contains(".zip");
    }
    let suffix = match low.rfind('.') {
        Some(idx) => &low[idx..],
        None => "",
    };
    extensions.contains(suffix)
}

#[derive(Debug, Clone)]
pub struct Assignment {
    pub name: String,
    pub role: Role,
    pub partition: Option<Partition>,
    pub source_index: i64,
    pub matched_pattern: String,
    pub profile: String,
}

#[derive(Debug, Clone, Default)]
pub struct VendorCorpusResult {
    pub spectra: Vec<String>,
    pub reference: Vec<String>,
    pub join: serde_json::Map<String, Value>,
}

#[derive(Debug, Clone, Default)]
pub struct ConventionResult {
    pub assignments: Vec<Assignment>,
    pub fold_files: Vec<String>,
    pub unmatched: Vec<String>,
    pub warnings: Vec<String>,
    pub vendor: Option<VendorCorpusResult>,
}

fn effective_extensions(
    profiles: &[&Profile],
    supported: Option<&HashSet<String>>,
) -> HashSet<String> {
    for prof in profiles {
        let exts = &prof.match_cfg.extensions;
        if !exts.is_empty() && exts.as_slice() != ["from-formats-registry".to_string()] {
            return exts
                .iter()
                .map(|e| {
                    if e.starts_with('.') {
                        e.clone()
                    } else {
                        format!(".{e}")
                    }
                })
                .collect();
        }
    }
    supported
        .cloned()
        .unwrap_or_else(|| DEFAULT_EXTENSIONS.iter().map(|s| s.to_string()).collect())
}

type RoleMap = IndexMap<String, Vec<String>>;

fn merge_roles(profiles: &[&Profile]) -> (RoleMap, RoleMap, bool) {
    let mut roles: RoleMap = IndexMap::new();
    let mut bare: RoleMap = IndexMap::new();
    let mut word_boundary = true;
    for prof in profiles {
        word_boundary = word_boundary && prof.match_cfg.short_pattern_word_boundary;
        for (key, patterns) in &prof.roles {
            let entry = roles.entry(key.clone()).or_default();
            for p in patterns {
                if !entry.contains(p) {
                    entry.push(p.clone());
                }
            }
        }
        for (key, stems) in &prof.bare {
            let entry = bare.entry(key.clone()).or_default();
            for s in stems {
                if !entry.contains(s) {
                    entry.push(s.clone());
                }
            }
        }
    }
    (roles, bare, word_boundary)
}

/// Match filenames to roles/partitions using the given profiles.
pub fn match_items(
    names: &[String],
    profiles: &[Profile],
    supported_exts: Option<&HashSet<String>>,
    is_spectrum: Option<&dyn Fn(&str) -> bool>,
) -> ConventionResult {
    let mut result = ConventionResult::default();
    if profiles.is_empty() {
        result.unmatched = names.to_vec();
        return result;
    }

    if let Some(vp) = profiles.iter().find(|p| p.is_vendor_corpus()) {
        result.vendor = Some(match_vendor_corpus(names, vp, is_spectrum));
    }

    let role_profiles: Vec<&Profile> = profiles.iter().filter(|p| !p.is_vendor_corpus()).collect();
    if role_profiles.is_empty() {
        let matched: HashSet<&str> = result
            .vendor
            .as_ref()
            .map(|v| {
                v.spectra
                    .iter()
                    .chain(v.reference.iter())
                    .map(String::as_str)
                    .collect()
            })
            .unwrap_or_default();
        result.unmatched = names
            .iter()
            .filter(|n| !matched.contains(n.as_str()))
            .cloned()
            .collect();
        return result;
    }

    let exts = effective_extensions(&role_profiles, supported_exts);
    let (roles, bare, word_boundary) = merge_roles(&role_profiles);
    let profile_name = role_profiles
        .iter()
        .map(|p| p.name.as_str())
        .collect::<Vec<_>>()
        .join("+");

    let mut candidates: Vec<String> = names
        .iter()
        .filter(|n| has_supported_extension(n, &exts))
        .cloned()
        .collect();
    candidates.sort_by_key(|n| n.to_lowercase());

    let mut assigned: HashSet<String> = HashSet::new();

    // Pass 1: pattern matching per role bucket.
    for (role_key, patterns) in &roles {
        let mut matched: Vec<String> = Vec::new();
        for pattern in patterns {
            let pat = pattern.to_lowercase();
            for name in &candidates {
                if pattern_matches(&name.to_lowercase(), &pat, word_boundary)
                    && !matched.contains(name)
                {
                    matched.push(name.clone());
                }
            }
        }
        if matched.is_empty() {
            continue;
        }
        if role_key == FOLDS_ROLE_KEY {
            result.fold_files.extend(matched.iter().cloned());
            assigned.extend(matched);
            continue;
        }
        let Some((role, partition)) = role_key_map(role_key) else {
            continue;
        };
        if matched.len() > 1 {
            result.warnings.push(format!(
                "{role_key}: {} files matched -> multi-source",
                matched.len()
            ));
        }
        for (idx, name) in matched.into_iter().enumerate() {
            result.assignments.push(Assignment {
                name: name.clone(),
                role,
                partition,
                source_index: idx as i64,
                matched_pattern: role_key.clone(),
                profile: profile_name.clone(),
            });
            assigned.insert(name);
        }
    }

    // Pass 2: bare stems -> train partition, only for roles still empty.
    let bare_role = |k: &str| match k {
        "x" => Some(Role::Features),
        "y" => Some(Role::Targets),
        "meta" => Some(Role::Metadata),
        _ => None,
    };
    let mut filled: HashSet<(Role, Option<Partition>)> = result
        .assignments
        .iter()
        .map(|a| (a.role, a.partition))
        .collect();
    for (bare_key, stems) in &bare {
        let Some(b_role) = bare_role(bare_key) else {
            continue;
        };
        if filled.contains(&(b_role, Some(Partition::Train))) {
            continue;
        }
        for name in &candidates {
            if assigned.contains(name) {
                continue;
            }
            if stems.contains(&get_stem(name).to_lowercase()) {
                result.assignments.push(Assignment {
                    name: name.clone(),
                    role: b_role,
                    partition: Some(Partition::Train),
                    source_index: 0,
                    matched_pattern: format!("bare:{bare_key}"),
                    profile: profile_name.clone(),
                });
                assigned.insert(name.clone());
                filled.insert((b_role, Some(Partition::Train)));
                break;
            }
        }
    }

    let vendor_matched: HashSet<&str> = result
        .vendor
        .as_ref()
        .map(|v| {
            v.spectra
                .iter()
                .chain(v.reference.iter())
                .map(String::as_str)
                .collect()
        })
        .unwrap_or_default();
    result.unmatched = names
        .iter()
        .filter(|n| !assigned.contains(*n) && !vendor_matched.contains(n.as_str()))
        .cloned()
        .collect();
    result
}

fn match_vendor_corpus(
    names: &[String],
    profile: &Profile,
    is_spectrum: Option<&dyn Fn(&str) -> bool>,
) -> VendorCorpusResult {
    let spectra_formats: HashSet<String> = profile
        .spectra
        .as_ref()
        .and_then(|v| v.get("formats"))
        .and_then(|v| v.as_array())
        .map(|a| {
            a.iter()
                .filter_map(|v| v.as_str())
                .map(|f| f.to_lowercase().trim_start_matches('.').to_string())
                .collect()
        })
        .unwrap_or_default();
    let reference_names: Vec<String> = profile
        .reference
        .as_ref()
        .and_then(|v| v.get("names"))
        .and_then(|v| v.as_array())
        .map(|a| {
            a.iter()
                .filter_map(|v| v.as_str())
                .map(|n| n.to_lowercase())
                .collect()
        })
        .unwrap_or_default();

    let looks_like_spectrum = |name: &str| -> bool {
        if let Some(f) = is_spectrum {
            return f(name);
        }
        let low = name.to_lowercase();
        let ext = if low.contains('.') {
            low.rsplit('.').next().unwrap_or("").to_string()
        } else {
            String::new()
        };
        spectra_formats.contains(&ext)
    };

    let mut spectra: Vec<String> = names
        .iter()
        .filter(|n| looks_like_spectrum(n))
        .cloned()
        .collect();
    spectra.sort_by_key(|n| n.to_lowercase());
    let spectra_set: HashSet<&str> = spectra.iter().map(String::as_str).collect();

    let mut reference: Vec<String> = names
        .iter()
        .filter(|n| {
            !spectra_set.contains(n.as_str())
                && reference_names
                    .iter()
                    .any(|rn| pattern_matches(&get_stem(n).to_lowercase(), rn, true))
        })
        .cloned()
        .collect();
    reference.sort_by_key(|n| n.to_lowercase());

    let join = profile
        .join
        .as_ref()
        .and_then(|v| v.as_object())
        .cloned()
        .unwrap_or_default();
    VendorCorpusResult {
        spectra,
        reference,
        join,
    }
}

#[cfg(test)]
mod tests {
    use super::super::profiles::resolve_profiles;
    use super::*;

    fn names(v: &[&str]) -> Vec<String> {
        v.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn pattern_matches_word_boundary() {
        assert!(pattern_matches("x.csv", "x", true));
        assert!(pattern_matches("x_cal.csv", "x", true));
        assert!(!pattern_matches("xcal.csv", "x", true)); // no boundary after x
        assert!(pattern_matches("xcal.csv", "xcal", true)); // long pattern = substring
    }

    #[test]
    fn get_stem_compound() {
        assert_eq!(get_stem("a.csv"), "a");
        assert_eq!(get_stem("a.csv.gz"), "a");
        assert_eq!(get_stem("mango_001.csv"), "mango_001");
    }

    #[test]
    fn classic_train_test_assignment() {
        let profs = resolve_profiles(&["nirs4all-classic"]).unwrap();
        let r = match_items(
            &names(&["Xcal.csv", "Ycal.csv", "Xval.csv", "Yval.csv"]),
            &profs,
            None,
            None,
        );
        assert_eq!(r.assignments.len(), 4);
        let by: Vec<(&str, &str)> = r
            .assignments
            .iter()
            .map(|a| (a.name.as_str(), a.matched_pattern.as_str()))
            .collect();
        assert!(by.contains(&("Xcal.csv", "train_x")));
        assert!(by.contains(&("Xval.csv", "test_x")));
        assert!(by.contains(&("Ycal.csv", "train_y")));
        assert!(by.contains(&("Yval.csv", "test_y")));
        assert!(r.unmatched.is_empty());
    }

    #[test]
    fn bare_x_y() {
        let profs = resolve_profiles(&["nirs4all-classic"]).unwrap();
        let r = match_items(&names(&["X.csv", "Y.csv"]), &profs, None, None);
        assert_eq!(r.assignments.len(), 2);
        assert!(r
            .assignments
            .iter()
            .any(|a| a.name == "X.csv" && a.role == Role::Features));
        assert!(r
            .assignments
            .iter()
            .any(|a| a.name == "Y.csv" && a.role == Role::Targets));
    }
}
