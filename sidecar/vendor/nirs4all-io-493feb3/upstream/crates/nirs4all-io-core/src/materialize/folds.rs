// SPDX-License-Identifier: CeCILL-2.1 OR AGPL-3.0-or-later
//! Fold-file parsing (ports `materialize/folds.py`).
//!
//! Supports csv-nirs4all (columns of TRAIN ids, val = complement),
//! csv-assignment (a `fold` column of VAL membership, train = complement),
//! JSON (`[{train, val|test}]`) and TXT (alternating train/val lines). YAML
//! lands with the PyYAML-1.1 shim.
//!
//! This is the pure, fs-free parser: it consumes already-read text plus a
//! resolved format. The facade reads the file and infers the format from the
//! extension before delegating here, so the same parsing rules back both the
//! native (path) and in-memory paths.

use std::collections::BTreeSet;

use crate::spec::SpecError;
use serde_json::Value;

/// A `(train, val)` index pair.
pub type Fold = (Vec<i64>, Vec<i64>);

/// Parse fold-file `text` with an already-resolved `fmt` (`csv`/`json`/`txt`/
/// `yaml`). `auto` is resolved by the caller from the file extension.
pub fn parse_fold_str(text: &str, fmt: &str) -> Result<Vec<Fold>, SpecError> {
    match fmt {
        "csv" => parse_csv(text),
        "json" => parse_json(
            &serde_json::from_str(text).map_err(|e| SpecError::new(format!("fold JSON: {e}")))?,
        ),
        "yaml" | "yml" => Err(SpecError::new(
            "YAML fold files land with the PyYAML-1.1 shim; use CSV/JSON/TXT for now",
        )),
        "txt" => parse_txt(text),
        other => Err(SpecError::new(format!(
            "unsupported fold-file format: {other:?}"
        ))),
    }
}

fn parse_csv(text: &str) -> Result<Vec<Fold>, SpecError> {
    let mut rdr = csv::ReaderBuilder::new()
        .has_headers(false)
        .flexible(true)
        .from_reader(text.as_bytes());
    let mut records = rdr.records();
    let headers: Vec<String> = match records.next() {
        Some(Ok(r)) => r.iter().map(str::to_string).collect(),
        _ => return Ok(vec![]),
    };
    let rows: Vec<Vec<String>> = records
        .filter_map(Result::ok)
        .map(|r| r.iter().map(str::to_string).collect())
        .collect();
    let lower: Vec<String> = headers.iter().map(|h| h.to_lowercase()).collect();
    if headers.iter().all(|h| h.starts_with("fold_")) {
        csv_nirs4all(&headers, &rows)
    } else if lower.iter().any(|h| h == "fold") {
        csv_assignment(&headers, &rows)
    } else {
        csv_nirs4all(&headers, &rows)
    }
}

fn csv_nirs4all(headers: &[String], rows: &[Vec<String>]) -> Result<Vec<Fold>, SpecError> {
    let n_folds = headers.len();
    let mut fold_train: Vec<Vec<i64>> = vec![vec![]; n_folds];
    for row in rows {
        for (i, value) in row.iter().enumerate() {
            if i < n_folds && !value.trim().is_empty() {
                if let Ok(v) = value.trim().parse::<i64>() {
                    fold_train[i].push(v);
                }
            }
        }
    }
    let all_ids: BTreeSet<i64> = fold_train.iter().flatten().copied().collect();
    Ok(fold_train
        .iter()
        .map(|train| {
            let train_set: BTreeSet<i64> = train.iter().copied().collect();
            let mut t: Vec<i64> = train_set.iter().copied().collect();
            t.sort();
            let val: Vec<i64> = all_ids
                .iter()
                .copied()
                .filter(|s| !train_set.contains(s))
                .collect();
            (t, val)
        })
        .collect())
}

fn csv_assignment(headers: &[String], rows: &[Vec<String>]) -> Result<Vec<Fold>, SpecError> {
    let lower: Vec<String> = headers.iter().map(|h| h.to_lowercase()).collect();
    let fold_col = lower.iter().position(|h| h == "fold").unwrap();
    let sample_col = ["sample_id", "id", "index", "sample"]
        .iter()
        .find_map(|c| lower.iter().position(|h| h == c));
    let mut fold_to_samples: std::collections::BTreeMap<i64, Vec<i64>> =
        std::collections::BTreeMap::new();
    for (row_idx, row) in rows.iter().enumerate() {
        let fold_value: i64 = row
            .get(fold_col)
            .and_then(|v| v.trim().parse().ok())
            .ok_or_else(|| SpecError::new("fold column has a non-integer value"))?;
        let sample_id = match sample_col {
            Some(c) => row
                .get(c)
                .and_then(|v| v.trim().parse().ok())
                .ok_or_else(|| SpecError::new("sample column has a non-integer value"))?,
            None => row_idx as i64,
        };
        fold_to_samples
            .entry(fold_value)
            .or_default()
            .push(sample_id);
    }
    let all_samples: BTreeSet<i64> = fold_to_samples.values().flatten().copied().collect();
    Ok(fold_to_samples
        .values()
        .map(|members| {
            let mset: BTreeSet<i64> = members.iter().copied().collect();
            let train: Vec<i64> = all_samples
                .iter()
                .copied()
                .filter(|s| !mset.contains(s))
                .collect();
            let mut val: Vec<i64> = mset.iter().copied().collect();
            val.sort();
            (train, val)
        })
        .collect())
}

fn parse_json(data: &Value) -> Result<Vec<Fold>, SpecError> {
    let arr = data
        .as_array()
        .ok_or_else(|| SpecError::new("fold JSON/YAML must be a list of {train, val} objects"))?;
    let int_list = |v: Option<&Value>| -> Vec<i64> {
        v.and_then(|v| v.as_array())
            .map(|a| a.iter().filter_map(|x| x.as_i64()).collect())
            .unwrap_or_default()
    };
    arr.iter()
        .map(|obj| {
            let m = obj.as_object().ok_or_else(|| {
                SpecError::new("each fold entry must be a mapping with 'train' and 'val'/'test'")
            })?;
            let train = int_list(m.get("train"));
            let val = int_list(m.get("val").or_else(|| m.get("test")));
            Ok((train, val))
        })
        .collect()
}

fn parse_txt(text: &str) -> Result<Vec<Fold>, SpecError> {
    let lines: Vec<&str> = text
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty())
        .collect();
    if !lines.len().is_multiple_of(2) {
        return Err(SpecError::new(
            "TXT fold file must have an even number of non-empty lines (train/val pairs)",
        ));
    }
    let parse_line = |line: &str| -> Result<Vec<i64>, SpecError> {
        line.split(',')
            .filter(|x| !x.trim().is_empty())
            .map(|x| {
                x.trim()
                    .parse::<i64>()
                    .map_err(|_| SpecError::new("non-integer fold index"))
            })
            .collect()
    };
    let mut folds = vec![];
    let mut i = 0;
    while i < lines.len() {
        folds.push((parse_line(lines[i])?, parse_line(lines[i + 1])?));
        i += 2;
    }
    Ok(folds)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn csv_nirs4all_train_columns() {
        // cookbook test_folds_file_case: fold_0,fold_1 with train ids per column.
        let folds = parse_fold_str("fold_0,fold_1\n0,2\n1,3\n,4\n,5\n", "csv").unwrap();
        assert_eq!(folds.len(), 2);
        assert_eq!(folds[0], (vec![0, 1], vec![2, 3, 4, 5]));
        assert_eq!(folds[1], (vec![2, 3, 4, 5], vec![0, 1]));
    }

    #[test]
    fn json_train_val() {
        let folds = parse_fold_str(r#"[{"train":[0,1,2,3],"val":[4,5]}]"#, "json").unwrap();
        assert_eq!(folds, vec![(vec![0, 1, 2, 3], vec![4, 5])]);
    }

    #[test]
    fn txt_alternating() {
        let folds = parse_fold_str("0,1,2\n3,4\n", "txt").unwrap();
        assert_eq!(folds, vec![(vec![0, 1, 2], vec![3, 4])]);
    }
}
