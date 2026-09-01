// SPDX-License-Identifier: CeCILL-2.1 OR AGPL-3.0-or-later
//! Sample-identity inference + cross-file alignment audit (ports `infer/identity.py`).
//!
//! Detects a sample-id column, classifies a metadata source as per-sample (1:1)
//! vs shared/dimension (m:1), and audits coverage. Operates on the neutral
//! [`TableProfile`] (facade-populated) — no pandas, no file IO.

use std::collections::HashSet;
use std::sync::LazyLock;

use regex::{Regex, RegexBuilder};
use serde_json::Value;

use super::table::TableProfile;
use crate::pyfmt::{py_float_repr, py_round};

static ID_NAME_RE: LazyLock<Regex> = LazyLock::new(|| {
    RegexBuilder::new(
        r"^(sample[_ ]?id|sampleid|sample|id|name|code|ref(erence)?|key|index|spectrum[_ ]?id|scan[_ ]?id|.*_id|id_.*)$",
    )
    .case_insensitive(true)
    .build()
    .unwrap()
});

static WL_RE: LazyLock<Regex> = LazyLock::new(|| {
    RegexBuilder::new(r"^\d+(\.\d+)?(nm|cm-1)?$")
        .case_insensitive(true)
        .build()
        .unwrap()
});

// Replicate-suffix patterns (source string leaks verbatim into evidence).
static REPLICATE_PATTERNS: LazyLock<Vec<(&'static str, Regex)>> = LazyLock::new(|| {
    let build = |p: &'static str| {
        (
            p,
            RegexBuilder::new(p).case_insensitive(true).build().unwrap(),
        )
    };
    vec![
        build(r"[_\-. ]rep(?:licate)?[_\-. ]?\d+$"),
        build(r"[_\-. ]r\d+$"),
        build(r"[_\-. ]scan[_\-. ]?\d+$"),
        build(r"[_\-. ]dup(?:licate)?\d*$"),
        build(r"\s*\(\d+\)$"),
        build(r"[_\-. ][a-z]$"),
    ]
});

#[derive(Debug, Clone)]
pub struct SampleIdGuess {
    pub column: String,
    pub score: f64,
    pub unique: bool,
    pub evidence: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct RepetitionProfile {
    pub n_rows: usize,
    pub n_unique: usize,
    pub avg_reps: f64,
    pub is_repetition: bool,
}

#[derive(Debug, Clone)]
pub struct ReplicateGrouping {
    pub pattern: String,
    pub sample_ids: Vec<String>,
    pub n_files: usize,
    pub n_samples: usize,
    pub avg_reps: f64,
    pub evidence: Vec<String>,
}

/// Pick the most likely sample-id column, or `None` (requires score >= 0.5).
pub fn detect_sample_id(table: &TableProfile) -> Option<SampleIdGuess> {
    let n = table.n_rows;
    if n == 0 {
        return None;
    }
    let mut best: Option<SampleIdGuess> = None;
    for col in &table.columns {
        if WL_RE.is_match(&col.name) {
            continue;
        }
        let nunique = col.nunique_with_na;
        let unique = col.is_unique;
        let mut score = 0.0;
        let mut ev: Vec<String> = vec![];
        if ID_NAME_RE.is_match(&col.name) {
            score += 0.5;
            ev.push(format!("id-like name '{}'", col.name));
        }
        if unique {
            score += 0.35;
            ev.push("unique per row".into());
        } else if nunique as f64 >= 0.9 * n as f64 {
            score += 0.15;
            ev.push("near-unique values".into());
        }
        if col.is_float_dtype() {
            score -= 0.25;
        } else if !col.is_numeric_dtype() {
            score += 0.1;
            ev.push("string identifier".into());
        }
        if score > 0.0 && best.as_ref().is_none_or(|b| score > b.score) {
            best = Some(SampleIdGuess {
                column: col.name.clone(),
                score: score.min(1.0),
                unique,
                evidence: ev,
            });
        }
    }
    best.filter(|b| b.score >= 0.5)
}

/// Non-unique id → repeated measurements (avg >= 1.5) vs sporadic duplicates.
pub fn repetition_profile(n_rows: usize, n_unique: usize) -> RepetitionProfile {
    let u = if n_unique == 0 { 1 } else { n_unique };
    let avg = n_rows as f64 / u as f64;
    RepetitionProfile {
        n_rows,
        n_unique: u,
        avg_reps: py_round(avg, 2),
        is_repetition: u < n_rows && avg >= 1.5,
    }
}

fn unique_count(items: &[String]) -> usize {
    items.iter().collect::<HashSet<&String>>().len()
}

/// Detect replicate files of the same sample (mango_001_a/_b/_c → mango_001).
pub fn detect_replicate_grouping(stems: &[String]) -> Option<ReplicateGrouping> {
    let n = stems.len();
    if n < 2 {
        return None;
    }
    let mut best: Option<(f64, ReplicateGrouping)> = None;
    for (src, rx) in REPLICATE_PATTERNS.iter() {
        let stripped: Vec<String> = stems
            .iter()
            .map(|s| rx.replace_all(s, "").into_owned())
            .collect();
        let matched = stripped.iter().zip(stems).filter(|(st, s)| st != s).count();
        if (matched as f64) < n as f64 * 0.5 {
            continue;
        }
        let n_samples = unique_count(&stripped);
        if n_samples >= n {
            continue;
        }
        let avg = n as f64 / n_samples as f64;
        if avg < 1.5 {
            continue;
        }
        let score = matched as f64 / n as f64;
        if best.as_ref().is_none_or(|(bs, _)| score > *bs) {
            let avg2 = py_round(avg, 2);
            let ev = vec![format!(
                "replicate suffix /{src}/ on {matched}/{n} files -> {n_samples} sample(s), avg {} reps",
                py_float_repr(avg2)
            )];
            best = Some((
                score,
                ReplicateGrouping {
                    pattern: (*src).to_string(),
                    sample_ids: stripped,
                    n_files: n,
                    n_samples,
                    avg_reps: avg2,
                    evidence: ev,
                },
            ));
        }
    }
    best.map(|(_, g)| g)
}

fn sorted_unique_diff(a: &HashSet<&str>, b: &HashSet<&str>) -> Vec<String> {
    let mut v: Vec<String> = a.difference(b).map(|s| s.to_string()).collect();
    v.sort();
    v
}

/// Does every sample id have a match in `other_ids`? Report missing/extra/dupes.
pub fn coverage_audit(x_ids: &[String], other_ids: &[String], other_name: &str) -> Value {
    let o_set: HashSet<&str> = other_ids.iter().map(String::as_str).collect();
    let x_set: HashSet<&str> = x_ids.iter().map(String::as_str).collect();
    let missing = sorted_unique_diff(&x_set, &o_set);
    let extra = sorted_unique_diff(&o_set, &x_set);
    // duplicates in x_ids (count > 1), sorted
    let mut counts: std::collections::HashMap<&str, usize> = std::collections::HashMap::new();
    for v in x_ids {
        *counts.entry(v.as_str()).or_insert(0) += 1;
    }
    let mut dup_x: Vec<String> = counts
        .iter()
        .filter(|(_, &c)| c > 1)
        .map(|(k, _)| k.to_string())
        .collect();
    dup_x.sort();

    let take20 = |v: &[String]| -> Vec<Value> {
        v.iter().take(20).map(|s| Value::from(s.clone())).collect()
    };
    serde_json::json!({
        "against": other_name,
        "n_samples": x_set.len(),
        "n_missing": missing.len(),
        "missing": take20(&missing),
        "n_extra": extra.len(),
        "extra": take20(&extra),
        "duplicate_sample_ids": take20(&dup_x),
    })
}

/// Classify a metadata source vs the samples: `("1:1"|"m:1", key, evidence)`.
pub fn classify_metadata_relation(
    x_table: &TableProfile,
    meta_table: &TableProfile,
    x_id: &str,
) -> Option<(String, String, Vec<String>)> {
    if let Some(col) = meta_table.column(x_id) {
        if col.is_unique && meta_table.n_rows as f64 >= x_table.n_rows as f64 * 0.5 {
            return Some((
                "1:1".into(),
                x_id.to_string(),
                vec![format!("keyed by sample id '{x_id}' (one row per sample)")],
            ));
        }
    }
    for col in &meta_table.columns {
        if col.name == x_id || !x_table.has_column(&col.name) {
            continue;
        }
        if col.is_unique && meta_table.n_rows < x_table.n_rows {
            return Some((
                "m:1".into(),
                col.name.clone(),
                vec![format!(
                    "shared dimension table keyed by '{}' ({} rows broadcast to {} samples)",
                    col.name, meta_table.n_rows, x_table.n_rows
                )],
            ));
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::super::table::{ColDtype, ColumnProfile, NumericKind, TableProfile};
    use super::*;

    fn col(
        name: &str,
        dtype: ColDtype,
        nk: NumericKind,
        nunique: usize,
        n: usize,
    ) -> ColumnProfile {
        ColumnProfile {
            name: name.into(),
            dtype,
            numeric_kind: nk,
            nunique_with_na: nunique,
            is_unique: nunique == n,
            str_values: vec![],
            numeric_values: vec![],
        }
    }

    #[test]
    fn detect_id_by_name_and_uniqueness() {
        let t = TableProfile {
            n_rows: 3,
            columns: vec![
                col("sample_id", ColDtype::String, NumericKind::NonNumeric, 3, 3),
                col("1000", ColDtype::Numeric, NumericKind::Float, 3, 3),
            ],
        };
        let g = detect_sample_id(&t).unwrap();
        assert_eq!(g.column, "sample_id");
        // 0.5 (id name) + 0.35 (unique) + 0.1 (string) = 0.95
        assert_eq!(g.score, 0.95);
    }

    #[test]
    fn float_target_is_not_an_id() {
        let t = TableProfile {
            n_rows: 6,
            columns: vec![col("protein", ColDtype::Numeric, NumericKind::Float, 6, 6)],
        };
        // unique 0.35 - float 0.25 = 0.1 < 0.5 -> None
        assert!(detect_sample_id(&t).is_none());
    }

    #[test]
    fn replicate_grouping_single_letter() {
        let stems: Vec<String> = ["m_001_a", "m_001_b", "m_002_a", "m_002_b"]
            .iter()
            .map(|s| s.to_string())
            .collect();
        let g = detect_replicate_grouping(&stems).unwrap();
        assert_eq!(g.n_samples, 2);
        assert_eq!(g.avg_reps, 2.0);
        assert_eq!(g.sample_ids, vec!["m_001", "m_001", "m_002", "m_002"]);
    }

    #[test]
    fn coverage_audit_missing() {
        let x: Vec<String> = ["a", "b", "c"].iter().map(|s| s.to_string()).collect();
        let o: Vec<String> = ["a", "b"].iter().map(|s| s.to_string()).collect();
        let audit = coverage_audit(&x, &o, "targets");
        assert_eq!(audit["n_missing"], serde_json::json!(1));
        assert_eq!(audit["missing"], serde_json::json!(["c"]));
        assert_eq!(audit["against"], serde_json::json!("targets"));
    }
}
