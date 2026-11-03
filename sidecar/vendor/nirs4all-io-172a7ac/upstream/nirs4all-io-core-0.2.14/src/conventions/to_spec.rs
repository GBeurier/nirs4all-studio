// SPDX-License-Identifier: CeCILL-2.1 OR AGPL-3.0-or-later
//! Convention match → DatasetSpec dict (ports `conventions/to_spec.py`).
//!
//! Feature files become feature sources (one per multi-source index, per
//! partition); target/metadata files join 1:1 onto the partition's first feature
//! source; fold files become `folds.file`; a vendor-corpus match becomes a glob
//! feature source plus an m:1 reference lookup.

use indexmap::IndexMap;
use serde_json::{Map, Value};

use super::engine::{Assignment, ConventionResult};
use crate::spec::enums::{Partition, Role};

fn part_value(p: Option<Partition>) -> Option<&'static str> {
    p.map(|p| p.value())
}

/// Build a DatasetSpec dict from a convention match.
pub fn assignments_to_spec_dict(result: &ConventionResult, name: &str) -> Value {
    if let Some(vendor) = &result.vendor {
        if !vendor.spectra.is_empty() {
            return vendor_spec(result, name);
        }
    }

    let mut sources: Vec<Value> = Vec::new();

    // Group by (role, partition), preserving assignment (insertion) order.
    let mut by_role_part: IndexMap<(Role, Option<Partition>), Vec<Assignment>> = IndexMap::new();
    for a in &result.assignments {
        by_role_part
            .entry((a.role, a.partition))
            .or_default()
            .push(a.clone());
    }

    let mut feature_anchor: IndexMap<Option<Partition>, String> = IndexMap::new();

    // Features first — establish per-partition anchor ids.
    for ((role, partition), items) in &by_role_part {
        if *role != Role::Features {
            continue;
        }
        let mut items = items.clone();
        items.sort_by_key(|a| a.source_index);
        let multi = items.len() > 1;
        for a in &items {
            let base = part_value(*partition).unwrap_or("x");
            let sid = if multi {
                format!("{base}_x_{}", a.source_index)
            } else {
                format!("{base}_x")
            };
            let mut src = Map::new();
            src.insert("id".into(), Value::from(sid.clone()));
            src.insert("role".into(), Value::from("features"));
            src.insert("input".into(), Value::from(a.name.clone()));
            if let Some(pv) = part_value(*partition) {
                src.insert("partition".into(), Value::from(pv));
            }
            feature_anchor
                .entry(*partition)
                .or_insert_with(|| sid.clone());
            if multi && a.source_index > 0 {
                let anchor = feature_anchor[partition].clone();
                src.insert(
                    "join".into(),
                    serde_json::json!({"to": anchor, "how": "1:1"}),
                );
            }
            sources.push(Value::Object(src));
        }
    }

    // Targets + metadata join 1:1 onto the partition anchor.
    for ((role, partition), items) in &by_role_part {
        if *role == Role::Features {
            continue;
        }
        let anchor = feature_anchor.get(partition).cloned();
        let mut items = items.clone();
        items.sort_by_key(|a| a.source_index);
        for a in &items {
            let part_base = part_value(*partition).unwrap_or("m");
            let role_tag = if *role == Role::Targets { "y" } else { "m" };
            let mut sid = format!("{part_base}_{role_tag}");
            if a.source_index != 0 {
                sid = format!("{sid}_{}", a.source_index);
            }
            let mut src = Map::new();
            src.insert("id".into(), Value::from(sid));
            src.insert("role".into(), Value::from(role.value()));
            src.insert("input".into(), Value::from(a.name.clone()));
            if let Some(pv) = part_value(*partition) {
                src.insert("partition".into(), Value::from(pv));
            }
            if let Some(anchor) = &anchor {
                src.insert(
                    "join".into(),
                    serde_json::json!({"to": anchor, "how": "1:1"}),
                );
            }
            sources.push(Value::Object(src));
        }
    }

    let mut spec = Map::new();
    spec.insert("name".into(), Value::from(name));
    spec.insert("sources".into(), Value::Array(sources));
    if !result.fold_files.is_empty() {
        spec.insert(
            "folds".into(),
            serde_json::json!({"file": result.fold_files[0], "format": "auto"}),
        );
    }
    Value::Object(spec)
}

fn vendor_spec(result: &ConventionResult, name: &str) -> Value {
    let vendor = result.vendor.as_ref().expect("vendor present");
    let mut sources: Vec<Value> = Vec::new();

    let mut spectra = vendor.spectra.clone();
    spectra.sort(); // case-sensitive (Python sorted() without lower)
    sources.push(serde_json::json!({
        "id": "spectra",
        "role": "features",
        "input": spectra,
        "merge": "concat_samples",
    }));

    if !vendor.reference.is_empty() {
        let on = vendor
            .join
            .get("sample_key")
            .and_then(|v| v.as_str())
            .unwrap_or("filename_stem");
        let on_missing = vendor
            .join
            .get("on_missing")
            .and_then(|v| v.as_str())
            .unwrap_or("warn");
        let coverage = match on_missing {
            "drop" => "drop",
            "error" => "error",
            _ => "warn",
        };
        sources.push(serde_json::json!({
            "id": "ref",
            "kind": "lookup",
            "input": vendor.reference[0],
            "columns": [{"role": "targets", "select": "rest"}],
            "join": {"to": "spectra", "on": on, "how": "m:1", "coverage": coverage},
        }));
    }

    serde_json::json!({
        "name": name,
        "conventions": ["vendor-corpus"],
        "sources": sources,
    })
}
