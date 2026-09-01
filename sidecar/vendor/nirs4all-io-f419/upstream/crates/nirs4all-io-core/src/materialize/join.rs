// SPDX-License-Identifier: CeCILL-2.1 OR AGPL-3.0-or-later
//! Relational merge/join engine on [`Frame`] (ports `materialize/join.py`).
//!
//! io performs every join/broadcast itself. Role-agnostic — only rows are
//! aligned here. `concat_samples` stacks rows (schema-union); `concat_features`
//! stacks column-blocks (by key or row order); `join_tables` is a single
//! cross-source join honoring cardinality, duplicate rules, coverage, and a
//! dropped-row audit; `merge_by_key` chains 1:1 joins on a shared key.

use std::collections::{HashMap, HashSet};

use crate::spec::enums::{Cardinality, Coverage};
use crate::spec::SpecError;

use super::frame::{Cell, Column, Frame, JoinKey};

/// A join error is a `SpecError` (cardinality / duplicate-key / coverage).
pub type JoinError = SpecError;

#[derive(Debug, Clone, Default)]
pub struct JoinAudit {
    pub operation: String,
    pub n_left: usize,
    pub n_right: usize,
    pub n_result: usize,
    pub n_matched: usize,
    pub dropped_rows: Vec<String>,
    pub warnings: Vec<String>,
}

fn keys(on: &[String]) -> Vec<String> {
    on.to_vec()
}

fn require_columns(frame: &Frame, cols: &[String], where_: &str) -> Result<(), SpecError> {
    let missing: Vec<&String> = cols.iter().filter(|c| !frame.has_column(c)).collect();
    if !missing.is_empty() {
        return Err(SpecError::new(format!(
            "{where_}: key column(s) {missing:?} not found (have {:?})",
            frame.column_names()
        )));
    }
    Ok(())
}

/// Vertically stack rows with a schema-union of columns; track per-row origin.
pub fn concat_samples(frames: &[Frame], names: &[String]) -> (Frame, Vec<String>, JoinAudit) {
    if frames.is_empty() {
        return (
            Frame::empty(),
            vec![],
            JoinAudit {
                operation: "concat_samples".into(),
                ..Default::default()
            },
        );
    }
    let mut origins = Vec::new();
    for (frame, name) in frames.iter().zip(names) {
        origins.extend(std::iter::repeat_n(name.clone(), frame.n_rows));
    }
    // union columns: first-appearance order across frames
    let mut union_order: Vec<String> = Vec::new();
    for f in frames {
        for c in f.column_names() {
            if !union_order.contains(&c) {
                union_order.push(c);
            }
        }
    }
    let total_rows: usize = frames.iter().map(|f| f.n_rows).sum();
    let columns: Vec<Column> = union_order
        .iter()
        .map(|name| {
            let mut cells = Vec::with_capacity(total_rows);
            for f in frames {
                match f.column(name) {
                    Some(col) => cells.extend(col.values.iter().cloned()),
                    None => cells.extend(std::iter::repeat_n(Cell::Na, f.n_rows)),
                }
            }
            Column::from_cells(name, cells)
        })
        .collect();
    let mut audit = JoinAudit {
        operation: "concat_samples".into(),
        n_result: total_rows,
        ..Default::default()
    };
    let common: HashSet<&String> = frames
        .iter()
        .map(|f| f.columns.iter().map(|c| &c.name).collect::<HashSet<_>>())
        .reduce(|a, b| a.intersection(&b).copied().collect())
        .unwrap_or_default();
    let n_not_shared = union_order.iter().filter(|c| !common.contains(c)).count();
    if n_not_shared > 0 {
        audit.warnings.push(format!(
            "concat_samples schema-union: {n_not_shared} column(s) not shared across files were null-filled"
        ));
    }
    (
        Frame::from_columns(columns, &frames[0].header_unit),
        origins,
        audit,
    )
}

/// Horizontally stack column-blocks for the same samples (by key or row order).
pub fn concat_features(
    frames: &[Frame],
    names: &[String],
    key: Option<&[String]>,
) -> Result<(Frame, JoinAudit), SpecError> {
    if frames.is_empty() {
        return Ok((
            Frame::empty(),
            JoinAudit {
                operation: "concat_features".into(),
                ..Default::default()
            },
        ));
    }
    let mut audit = JoinAudit {
        operation: "concat_features".into(),
        ..Default::default()
    };
    if let Some(key) = key {
        let mut out = frames[0].clone();
        for (frame, name) in frames[1..].iter().zip(&names[1..]) {
            let (merged, step) = join_tables(
                &out,
                frame,
                key,
                key,
                Cardinality::OneToOne,
                Coverage::Complete,
                &names[0],
                name,
            )?;
            out = merged;
            audit.warnings.extend(step.warnings);
        }
        audit.n_result = out.n_rows;
        return Ok((out, audit));
    }
    let lengths: HashSet<usize> = frames.iter().map(|f| f.n_rows).collect();
    if lengths.len() > 1 {
        let mut sorted: Vec<usize> = lengths.into_iter().collect();
        sorted.sort();
        return Err(SpecError::new(format!(
            "concat_features by row order needs equal row counts, got {sorted:?} (supply a 'key')"
        )));
    }
    let mut seen: HashSet<String> = HashSet::new();
    let mut columns: Vec<Column> = Vec::new();
    for (frame, name) in frames.iter().zip(names) {
        for col in &frame.columns {
            let new_name = if seen.contains(&col.name) {
                format!("{name}__{}", col.name)
            } else {
                col.name.clone()
            };
            seen.insert(new_name.clone());
            columns.push(Column {
                name: new_name,
                ..col.clone()
            });
        }
    }
    let out = Frame::from_columns(columns, &frames[0].header_unit);
    audit.n_result = out.n_rows;
    Ok((out, audit))
}

/// Join `right` onto `left` honoring cardinality, duplicate rules, coverage.
#[allow(clippy::too_many_arguments)]
pub fn join_tables(
    left: &Frame,
    right: &Frame,
    left_on: &[String],
    right_on: &[String],
    cardinality: Cardinality,
    coverage: Coverage,
    left_name: &str,
    right_name: &str,
) -> Result<(Frame, JoinAudit), SpecError> {
    let lkeys = keys(left_on);
    let rkeys = keys(right_on);
    require_columns(left, &lkeys, left_name)?;
    require_columns(right, &rkeys, right_name)?;
    if lkeys.len() != rkeys.len() {
        return Err(SpecError::new(format!(
            "join keys must have equal arity: {lkeys:?} vs {rkeys:?}"
        )));
    }

    let left_dup = left.has_duplicate_keys(&lkeys);
    let right_dup = right.has_duplicate_keys(&rkeys);
    match cardinality {
        Cardinality::OneToOne => {
            if left_dup {
                return Err(SpecError::new(format!(
                    "1:1 join: duplicate keys on left '{left_name}'"
                )));
            }
            if right_dup {
                return Err(SpecError::new(format!(
                    "1:1 join: duplicate keys on right '{right_name}'"
                )));
            }
        }
        Cardinality::ManyToOne => {
            if right_dup {
                return Err(SpecError::new(format!(
                    "m:1 join: duplicate keys on the right (lookup) '{right_name}' — a dimension table must be unique on {rkeys:?}"
                )));
            }
        }
        Cardinality::OneToMany => {
            if left_dup {
                return Err(SpecError::new(format!(
                    "1:m join: duplicate keys on left '{left_name}' on {lkeys:?}"
                )));
            }
        }
    }

    let left_tuples = left.join_key_tuples(&lkeys);
    let right_tuples = right.join_key_tuples(&rkeys);
    let mut right_map: HashMap<Vec<JoinKey>, Vec<usize>> = HashMap::new();
    for (ri, t) in right_tuples.iter().enumerate() {
        if let Some(t) = t {
            right_map.entry(t.clone()).or_default().push(ri);
        }
    }

    let missing_unique: Vec<&Option<Vec<JoinKey>>> = {
        let mut seen: HashSet<&Option<Vec<JoinKey>>> = HashSet::new();
        let mut out = Vec::new();
        for t in &left_tuples {
            let matched = t.as_ref().is_some_and(|k| right_map.contains_key(k));
            if !matched && seen.insert(t) {
                out.push(t);
            }
        }
        out
    };
    let n_missing: usize = left_tuples
        .iter()
        .filter(|t| !t.as_ref().is_some_and(|k| right_map.contains_key(k)))
        .count();

    if n_missing > 0 && coverage == Coverage::Complete {
        return Err(SpecError::new(format!(
            "coverage 'complete': {} key(s) in '{left_name}' have no match in '{right_name}'",
            missing_unique.len()
        )));
    }
    if n_missing > 0 && coverage == Coverage::Error {
        return Err(SpecError::new(format!(
            "coverage 'error': a key from '{left_name}' was not found in '{right_name}'"
        )));
    }

    // result columns: all left columns, then right non-key columns (suffixed on
    // name collision). Right key columns are shared/dropped (mirrors Python).
    let left_names: HashSet<&String> = left.columns.iter().map(|c| &c.name).collect();
    let right_extra: Vec<(&Column, String)> = right
        .columns
        .iter()
        .filter(|c| !rkeys.contains(&c.name))
        .map(|c| {
            let name = if left_names.contains(&c.name) {
                format!("{}__{right_name}", c.name)
            } else {
                c.name.clone()
            };
            (c, name)
        })
        .collect();

    let drop = coverage == Coverage::Drop;
    let mut left_out: Vec<Vec<Cell>> = vec![Vec::new(); left.columns.len()];
    let mut right_out: Vec<Vec<Cell>> = vec![Vec::new(); right_extra.len()];
    let mut n_matched = 0;
    for (li, t) in left_tuples.iter().enumerate() {
        let matches = t.as_ref().and_then(|k| right_map.get(k));
        match matches {
            Some(rows) => {
                n_matched += 1;
                for &ri in rows {
                    for (ci, col) in left.columns.iter().enumerate() {
                        left_out[ci].push(col.values[li].clone());
                    }
                    for (ci, (col, _)) in right_extra.iter().enumerate() {
                        right_out[ci].push(col.values[ri].clone());
                    }
                }
            }
            None => {
                if drop {
                    continue;
                }
                for (ci, col) in left.columns.iter().enumerate() {
                    left_out[ci].push(col.values[li].clone());
                }
                for col in right_out.iter_mut() {
                    col.push(Cell::Na);
                }
            }
        }
    }

    let mut columns: Vec<Column> = Vec::with_capacity(left.columns.len() + right_extra.len());
    for (ci, col) in left.columns.iter().enumerate() {
        columns.push(Column::from_cells(
            &col.name,
            std::mem::take(&mut left_out[ci]),
        ));
    }
    for (ci, (_, name)) in right_extra.iter().enumerate() {
        columns.push(Column::from_cells(name, std::mem::take(&mut right_out[ci])));
    }
    let out = Frame::from_columns(columns, &left.header_unit);

    let mut audit = JoinAudit {
        operation: format!(
            "{} join '{left_name}' <- '{right_name}'",
            cardinality.value()
        ),
        n_left: left.n_rows,
        n_right: right.n_rows,
        n_result: out.n_rows,
        n_matched,
        ..Default::default()
    };
    if n_missing > 0 && coverage == Coverage::Drop {
        audit.dropped_rows = vec!["unmatched_left".into(); missing_unique.len()];
        audit.warnings.push(format!(
            "coverage 'drop': removed {n_missing} unmatched row(s) from '{left_name}' ({} distinct key(s))",
            missing_unique.len()
        ));
    }
    if n_missing > 0 && coverage == Coverage::Warn {
        audit.warnings.push(format!(
            "coverage 'warn': {} key(s) in '{left_name}' unmatched in '{right_name}'; right columns null-filled",
            missing_unique.len()
        ));
    }
    Ok((out, audit))
}

/// Relational 1:1 join of several frames on a shared key (the `by_key` merge).
pub fn merge_by_key(
    frames: &[Frame],
    names: &[String],
    key: &[String],
    coverage: Coverage,
) -> Result<(Frame, JoinAudit), SpecError> {
    if frames.is_empty() {
        return Ok((
            Frame::empty(),
            JoinAudit {
                operation: "by_key".into(),
                ..Default::default()
            },
        ));
    }
    let mut out = frames[0].clone();
    let mut audit = JoinAudit {
        operation: "by_key".into(),
        n_result: frames[0].n_rows,
        ..Default::default()
    };
    for (frame, name) in frames[1..].iter().zip(&names[1..]) {
        let (merged, step) = join_tables(
            &out,
            frame,
            key,
            key,
            Cardinality::OneToOne,
            coverage,
            &names[0],
            name,
        )?;
        out = merged;
        audit.warnings.extend(step.warnings);
        audit.dropped_rows.extend(step.dropped_rows);
        audit.n_result = step.n_result;
    }
    Ok((out, audit))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::materialize::frame::Frame;

    fn col(name: &str, vals: &[i64]) -> Column {
        Column::from_cells(name, vals.iter().map(|&v| Cell::Int(v)).collect())
    }
    fn fcol(name: &str, vals: &[f64]) -> Column {
        Column::from_cells(name, vals.iter().map(|&v| Cell::Float(v)).collect())
    }

    #[test]
    fn concat_features_row_order_suffixes_dupes() {
        let a = Frame::from_columns(vec![col("id", &[1, 2]), fcol("x", &[0.1, 0.2])], "text");
        let b = Frame::from_columns(vec![col("id", &[1, 2]), fcol("y", &[1.0, 2.0])], "text");
        let (out, _) = concat_features(&[a, b], &["a".into(), "b".into()], None).unwrap();
        assert_eq!(out.column_names(), vec!["id", "x", "b__id", "y"]);
        assert_eq!(out.n_rows, 2);
    }

    #[test]
    fn m1_lookup_join_broadcasts() {
        // x.site in {S1,S2,S1}; lookup sites unique -> region broadcast.
        let x = Frame::from_columns(
            vec![
                Column::from_cells(
                    "site",
                    vec![
                        Cell::Str("S1".into()),
                        Cell::Str("S2".into()),
                        Cell::Str("S1".into()),
                    ],
                ),
                fcol("v", &[0.1, 0.2, 0.3]),
            ],
            "text",
        );
        let sites = Frame::from_columns(
            vec![
                Column::from_cells("site", vec![Cell::Str("S1".into()), Cell::Str("S2".into())]),
                Column::from_cells("region", vec![Cell::Str("n".into()), Cell::Str("s".into())]),
            ],
            "text",
        );
        let (out, audit) = join_tables(
            &x,
            &sites,
            &["site".into()],
            &["site".into()],
            Cardinality::ManyToOne,
            Coverage::Complete,
            "x",
            "sites",
        )
        .unwrap();
        assert_eq!(out.n_rows, 3);
        assert_eq!(out.str_column("region"), vec!["n", "s", "n"]);
        assert_eq!(audit.n_matched, 3);
    }

    #[test]
    fn one_to_one_duplicate_left_errors() {
        let l = Frame::from_columns(vec![col("id", &[1, 1])], "text");
        let r = Frame::from_columns(vec![col("id", &[1, 2])], "text");
        let err = join_tables(
            &l,
            &r,
            &["id".into()],
            &["id".into()],
            Cardinality::OneToOne,
            Coverage::Complete,
            "l",
            "r",
        )
        .unwrap_err();
        assert!(err.message.contains("duplicate keys on left"));
    }

    #[test]
    fn coverage_complete_missing_errors() {
        let l = Frame::from_columns(vec![col("id", &[1, 2, 3])], "text");
        let r = Frame::from_columns(vec![col("id", &[1, 2])], "text");
        let err = join_tables(
            &l,
            &r,
            &["id".into()],
            &["id".into()],
            Cardinality::ManyToOne,
            Coverage::Complete,
            "l",
            "r",
        )
        .unwrap_err();
        assert!(err.message.contains("coverage 'complete'"));
    }
}
