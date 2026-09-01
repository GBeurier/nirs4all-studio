// SPDX-License-Identifier: CeCILL-2.1 OR AGPL-3.0-or-later
//! Structural validation of a `DatasetSpec` (ports `spec/validate.py`).
//!
//! Checks what is verifiable without reading data: schema version, unique source
//! ids, join references, identity/key requirements, merge/columns invariants,
//! lookup wiring, partitions, folds. Data-dependent checks happen at load time.

use std::collections::{BTreeSet, HashSet};

use serde_json::Value;

use super::dataset_spec::{DatasetSpec, SourceSpec};
use super::enums::{
    Cardinality, MergeMode, PartitionBy, Role, SampleIndexBy, SourceKind, SpecError,
};
use super::selectors::Selector;
use crate::pyfmt::{py_repr, py_truthy};

pub const SUPPORTED_SCHEMA_VERSIONS: &[i64] = &[1];

fn opt_truthy(s: &Option<String>) -> bool {
    s.as_deref().is_some_and(|v| !v.is_empty())
}

fn sorted_list_repr(items: &BTreeSet<&str>) -> String {
    let arr = Value::Array(items.iter().map(|s| Value::from(*s)).collect());
    py_repr(&arr)
}

/// Validate `spec`; returns a combined [`SpecError`] listing all problems.
pub fn validate_spec(spec: &DatasetSpec) -> Result<(), SpecError> {
    let mut errors: Vec<String> = Vec::new();

    if !SUPPORTED_SCHEMA_VERSIONS.contains(&spec.schema_version) {
        errors.push(format!(
            "schema_version {} is not supported (supported: (1,))",
            spec.schema_version
        ));
    }

    if spec.sources.is_empty() {
        errors.push("a DatasetSpec needs at least one source".into());
    }

    let ids: Vec<&str> = spec.sources.iter().map(|s| s.id.as_str()).collect();
    let dupes: BTreeSet<&str> = ids
        .iter()
        .filter(|id| ids.iter().filter(|x| x == id).count() > 1)
        .copied()
        .collect();
    if !dupes.is_empty() {
        errors.push(format!(
            "duplicate source ids: {}",
            sorted_list_repr(&dupes)
        ));
    }
    let id_set: HashSet<&str> = ids.iter().copied().collect();

    if spec.sample_index.by == SampleIndexBy::Id && !py_truthy(&spec.sample_index.key) {
        errors.push("sample_index.by='id' requires a 'key'".into());
    }

    let mut has_features = false;
    for src in &spec.sources {
        validate_source(src, &id_set, &mut errors);
        if src.kind != SourceKind::Lookup && (src.role == Role::Features || src.role == Role::Mixed)
        {
            has_features = true;
        }
    }
    if !has_features {
        errors.push(
            "no source produces features (need a source with role 'features' or 'mixed')".into(),
        );
    }

    let referenced: HashSet<&str> = spec
        .sources
        .iter()
        .filter_map(|s| s.join.as_ref().map(|j| j.right.as_str()))
        .collect();
    for src in &spec.sources {
        if src.kind == SourceKind::Lookup
            && src.join.is_none()
            && !referenced.contains(src.id.as_str())
        {
            errors.push(format!(
                "lookup source '{}' is never joined (give it a 'join' or reference it from another source's join)",
                src.id
            ));
        }
    }

    validate_partitions(spec, &mut errors);
    validate_folds(spec, &mut errors);

    if errors.is_empty() {
        Ok(())
    } else {
        Err(SpecError::new(format!(
            "invalid DatasetSpec:\n  - {}",
            errors.join("\n  - ")
        )))
    }
}

fn validate_source(src: &SourceSpec, id_set: &HashSet<&str>, errors: &mut Vec<String>) {
    let where_ = format!("source '{}'", src.id);

    if matches!(&src.input, Value::Array(a) if a.len() > 1) && src.merge == MergeMode::None {
        errors.push(format!(
            "{where_}: a multi-file input requires a 'merge' mode (concat_samples|concat_features|by_key)"
        ));
    }
    if src.merge == MergeMode::ByKey && !py_truthy(&src.key) {
        errors.push(format!("{where_}: merge='by_key' requires a 'key'"));
    }

    let rest_count = src
        .columns
        .iter()
        .filter(|c| matches!(c.select, Selector::Rest))
        .count();
    if rest_count > 1 {
        errors.push(format!(
            "{where_}: at most one 'rest' selector allowed (found {rest_count})"
        ));
    }
    if !src.columns.is_empty() && src.role != Role::Mixed && !all_same_role(src) {
        errors.push(format!(
            "{where_}: declares per-column roles but source role is '{}' (use role 'mixed')",
            src.role.value()
        ));
    }

    if let Some(j) = &src.join {
        if !id_set.contains(j.right.as_str()) {
            errors.push(format!(
                "{where_}: join.right '{}' is not a known source id",
                j.right
            ));
        }
        let left = j
            .left
            .clone()
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| src.id.clone());
        if !id_set.contains(left.as_str()) {
            errors.push(format!(
                "{where_}: join.left '{left}' is not a known source id"
            ));
        }
        if matches!(
            j.cardinality,
            Cardinality::ManyToOne | Cardinality::OneToMany
        ) && (j.left_on.is_null() || j.right_on.is_null())
        {
            errors.push(format!(
                "{where_}: {} join needs explicit left_on/right_on (the shorthand 'on' sets both; a per-source 'key' is alignment, not a join key)",
                j.cardinality.value()
            ));
        }
    }
}

fn all_same_role(src: &SourceSpec) -> bool {
    let roles: HashSet<Role> = src.columns.iter().map(|c| c.role).collect();
    roles.len() <= 1
}

fn validate_partitions(spec: &DatasetSpec, errors: &mut Vec<String>) {
    let Some(p) = &spec.partitions else {
        return;
    };
    if p.by == Some(PartitionBy::Column) && p.column.as_deref().filter(|s| !s.is_empty()).is_none()
    {
        errors.push("partitions.by='column' requires 'column'".into());
    }
    if p.by == Some(PartitionBy::Index)
        && p.train.is_null()
        && p.test.is_null()
        && p.predict.is_null()
    {
        errors.push(
            "partitions.by='index' requires at least one of 'train' / 'test' / 'predict' (list of row indices)"
                .into(),
        );
    }
    if p.by == Some(PartitionBy::IndexFile)
        && !(opt_truthy(&p.train_file) || opt_truthy(&p.test_file) || opt_truthy(&p.predict_file))
    {
        errors.push(
            "partitions.by='index_file' requires at least one of 'train_file' / 'test_file' / 'predict_file'"
                .into(),
        );
    }
}

fn validate_folds(spec: &DatasetSpec, errors: &mut Vec<String>) {
    let Some(f) = &spec.folds else {
        return;
    };
    let mut set_count = 0;
    if !f.inline.is_empty() {
        set_count += 1;
    }
    if opt_truthy(&f.file) {
        set_count += 1;
    }
    if opt_truthy(&f.column) {
        set_count += 1;
    }
    if set_count == 0 {
        errors.push("folds is present but empty (set one of inline|file|column)".into());
    }
    if set_count > 1 {
        errors.push("folds must use exactly one of inline|file|column".into());
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn spec(v: serde_json::Value) -> DatasetSpec {
        DatasetSpec::from_value(&v).unwrap()
    }

    #[test]
    fn valid_minimal() {
        assert!(validate_spec(&spec(
            json!({"sources": [{"id": "x", "role": "features", "input": "X.csv"}]})
        ))
        .is_ok());
    }

    #[test]
    fn no_sources_and_no_features() {
        let err = validate_spec(&spec(json!({"sources": []}))).unwrap_err();
        assert!(err.message.contains("at least one source"));
        assert!(err.message.contains("no source produces features"));
    }

    #[test]
    fn duplicate_ids_and_bad_join() {
        let err = validate_spec(&spec(json!({"sources": [
            {"id": "x", "role": "features", "input": "X.csv"},
            {"id": "x", "role": "targets", "input": "Y.csv", "join": {"to": "missing", "how": "1:1"}}
        ]})))
        .unwrap_err();
        assert!(err.message.contains("duplicate source ids: ['x']"));
        assert!(err
            .message
            .contains("join.right 'missing' is not a known source id"));
    }

    #[test]
    fn multifile_needs_merge() {
        let err = validate_spec(&spec(json!({"sources": [
            {"id": "x", "role": "features", "input": ["a.csv", "b.csv"]}
        ]})))
        .unwrap_err();
        assert!(err.message.contains("multi-file input requires a 'merge'"));
    }
}
