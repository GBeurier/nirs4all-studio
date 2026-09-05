// SPDX-License-Identifier: CeCILL-2.1 OR AGPL-3.0-or-later
//! Cookbook coverage gate (EPIC 12.2) — the Rust port of
//! `tests/test_cookbook.py::test_coverage_matrix_complete`. Every load-supported
//! vocabulary element must be exercised by a fixture that actually assembles
//! through the Rust facade. This is the first test to drive the FULL vocabulary
//! (lookups, m:1/1:m joins, by_key merge, variations, weights, fold modes,
//! index/index_file partitions) through `assemble()` — the 3-case contract corpus
//! does not. Treat added load-supported vocabulary as unshipped until it has a
//! fixture here.

use std::collections::BTreeSet;

use nirs4all_io::core::spec::{normalize_to_spec_dict, DatasetSpec};
use nirs4all_io::materialize::assemble;
use serde_json::{json, Value};

const CATALOGUE: &[&str] = &[
    "selector:positional",
    "selector:slice",
    "selector:names",
    "selector:name_range",
    "selector:regex",
    "selector:dtype",
    "selector:rest",
    "selector:auto",
    "merge:concat_samples",
    "merge:concat_features",
    "merge:by_key",
    "cardinality:1:1",
    "cardinality:m:1",
    "cardinality:1:m",
    "coverage:complete",
    "coverage:warn",
    "coverage:drop",
    "coverage:error",
    "partition:column",
    "partition:index",
    "partition:index_file",
    "folds:inline",
    "folds:file",
    "folds:column",
    "lookup",
    "composite_key",
    "variations",
    "role:weights",
];

/// Introspect which vocabulary elements a spec exercises (ports `vocab_elements`).
fn vocab_elements(spec: &DatasetSpec) -> BTreeSet<String> {
    let mut els = BTreeSet::new();
    if let Some(p) = &spec.partitions {
        if let Some(by) = &p.by {
            els.insert(format!("partition:{}", by.value()));
        }
    }
    if let Some(f) = &spec.folds {
        if !f.inline.is_empty() {
            els.insert("folds:inline".into());
        }
        if f.file.is_some() {
            els.insert("folds:file".into());
        }
        if f.column.is_some() {
            els.insert("folds:column".into());
        }
    }
    for s in &spec.sources {
        if s.merge.value() != "none" {
            els.insert(format!("merge:{}", s.merge.value()));
        }
        if s.kind.value() == "lookup" {
            els.insert("lookup".into());
        }
        if s.key.is_array() {
            els.insert("composite_key".into());
        }
        for c in &s.columns {
            els.insert(format!("selector:{}", c.select.kind()));
            if c.role.value() == "weights" {
                els.insert("role:weights".into());
            }
        }
        if let Some(j) = &s.join {
            els.insert(format!("cardinality:{}", j.cardinality.value()));
            els.insert(format!("coverage:{}", j.coverage.value()));
        }
        if !s.variations.is_empty() {
            els.insert("variations".into());
        }
    }
    els
}

fn wl() -> Vec<String> {
    (0..6).map(|i| (1000 + i * 5).to_string()).collect()
}

/// Build a `;`-separated CSV from `(header, column-values)` pairs.
fn csv(columns: &[(&str, Vec<String>)]) -> String {
    let header = columns
        .iter()
        .map(|(n, _)| *n)
        .collect::<Vec<_>>()
        .join(";");
    let nrows = columns.first().map(|(_, v)| v.len()).unwrap_or(0);
    let mut out = String::from(&header);
    out.push('\n');
    for r in 0..nrows {
        let line = columns
            .iter()
            .map(|(_, v)| v[r].clone())
            .collect::<Vec<_>>()
            .join(";");
        out.push_str(&line);
        out.push('\n');
    }
    out
}

fn fnum(vals: &[f64]) -> Vec<String> {
    vals.iter().map(|v| format!("{v}")).collect()
}

/// `n` rows of the 6 wavelength feature columns (deterministic values).
fn feat(n: usize) -> Vec<(&'static str, Vec<String>)> {
    // Leak the wl header strings to get &'static str keys (test-only, bounded).
    let headers: Vec<&'static str> = wl()
        .into_iter()
        .map(|s| &*Box::leak(s.into_boxed_str()))
        .collect();
    headers
        .into_iter()
        .enumerate()
        .map(|(c, h)| {
            (
                h,
                fnum(
                    &(0..n)
                        .map(|r| c as f64 + r as f64 * 0.1)
                        .collect::<Vec<_>>(),
                ),
            )
        })
        .collect()
}

fn col(name: &'static str, vals: Vec<String>) -> (&'static str, Vec<String>) {
    (name, vals)
}

fn strs(vals: &[&str]) -> Vec<String> {
    vals.iter().map(|s| s.to_string()).collect()
}

type Case = (&'static str, Vec<(&'static str, String)>, Value);

fn cases() -> Vec<Case> {
    let wl = wl();
    let mut v: Vec<Case> = Vec::new();

    // slice features + positional last target
    {
        let mut c = feat(6);
        c.push(col("y", fnum(&[0., 1., 2., 3., 4., 5.])));
        v.push((
            "slice_positional",
            vec![("data.csv", csv(&c))],
            json!({"sources":[{"id":"d","role":"mixed","input":"data.csv","columns":[
                {"role":"features","select":"0:6"},{"role":"targets","select":-1}]}]}),
        ));
    }
    // regex + names + dtype + rest
    {
        let mut c = feat(6);
        c.push(col("protein", fnum(&[0., 1., 2., 3., 4., 5.])));
        c.push(col("site", strs(&["a", "b", "a", "b", "a", "b"])));
        c.push(col("notes", strs(&["n", "n", "n", "n", "n", "n"])));
        v.push((
            "regex_names_dtype_rest",
            vec![("d.csv", csv(&c))],
            json!({"sources":[{"id":"d","role":"mixed","input":"d.csv","columns":[
                {"role":"features","select":{"regex":"^\\d+$"}},
                {"role":"targets","select":["protein"]},
                {"role":"metadata","select":{"dtype":"string"}},
                {"role":"ignore","select":"rest"}]}]}),
        ));
    }
    // name_range + rest
    {
        let mut c = feat(6);
        c.push(col("protein", fnum(&[0., 1., 2., 3., 4., 5.])));
        v.push((
            "name_range_rest",
            vec![("w.csv", csv(&c))],
            json!({"sources":[{"id":"a","role":"mixed","input":"w.csv","columns":[
                {"role":"features","select":{"name_range":[wl[0], wl[5]]}},
                {"role":"targets","select":["protein"]},
                {"role":"metadata","select":"rest"}]}]}),
        ));
    }
    // concat_samples
    {
        let mut a = feat(3);
        a.push(col("y", fnum(&[1., 2., 3.])));
        let mut b = feat(3);
        b.push(col("y", fnum(&[4., 5., 6.])));
        v.push((
            "concat_samples",
            vec![("b1.csv", csv(&a)), ("b2.csv", csv(&b))],
            json!({"sources":[{"id":"d","role":"mixed","input":["b1.csv","b2.csv"],"merge":"concat_samples","columns":[
                {"role":"features","select":{"regex":"^\\d+$"}},{"role":"targets","select":["y"]}]}]}),
        ));
    }
    // concat_features by key
    {
        let nir = csv(&[
            ("id", strs(&["1", "2", "3"])),
            ("n1", fnum(&[0.1, 0.2, 0.3])),
        ]);
        let mir = csv(&[
            ("id", strs(&["1", "2", "3"])),
            ("m1", fnum(&[0.4, 0.5, 0.6])),
        ]);
        v.push((
            "concat_features",
            vec![("nir.csv", nir), ("mir.csv", mir)],
            json!({"sources":[{"id":"x","role":"features","input":["nir.csv","mir.csv"],"merge":"concat_features","key":"id"}]}),
        ));
    }
    // by_key merge of 3 files
    {
        let a = csv(&[("id", strs(&["1", "2"])), ("a", fnum(&[1., 2.]))]);
        let b = csv(&[("id", strs(&["1", "2"])), ("b", fnum(&[3., 4.]))]);
        let cc = csv(&[("id", strs(&["1", "2"])), ("c", fnum(&[5., 6.]))]);
        v.push((
            "by_key",
            vec![("a.csv", a), ("b.csv", b), ("c.csv", cc)],
            json!({"sources":[{"id":"d","role":"features","input":["a.csv","b.csv","c.csv"],"merge":"by_key","key":"id"}]}),
        ));
    }
    // 1:1 (default complete)
    {
        let x = csv(&feat(6));
        let y = csv(&[("y", fnum(&[0., 1., 2., 3., 4., 5.]))]);
        v.push((
            "join_1to1",
            vec![("X.csv", x), ("Y.csv", y)],
            json!({"sources":[{"id":"x","role":"features","input":"X.csv"},
                {"id":"y","role":"targets","input":"Y.csv","join":{"to":"x","how":"1:1"}}]}),
        ));
    }
    // m:1 lookup. `complete` requires every key matched (S1,S2); `warn`/`drop`
    // exercise an unmatched key (S3 absent from the lookup table).
    for (name, cov, sites) in [
        ("m1_complete", "complete", vec!["S1", "S2"]),
        ("m1_warn", "warn", vec!["S1", "S2", "S3"]),
        ("m1_drop", "drop", vec!["S1", "S2", "S3"]),
    ] {
        let feats: Vec<f64> = (0..sites.len()).map(|i| 0.1 * (i + 1) as f64).collect();
        let x = csv(&[("1000", fnum(&feats)), ("site", strs(&sites))]);
        let s = csv(&[("site", strs(&["S1", "S2"])), ("region", strs(&["n", "s"]))]);
        v.push((
            name,
            vec![("x.csv", x), ("s.csv", s)],
            json!({"sources":[
                {"id":"x","role":"mixed","input":"x.csv","columns":[
                    {"role":"features","select":["1000"]},{"role":"metadata","select":["site"]}]},
                {"id":"s","kind":"lookup","input":"s.csv","columns":[{"role":"metadata","select":["region"]}],
                 "join":{"to":"x","on":"site","how":"m:1","coverage":cov}}]}),
        ));
    }
    // 1:1 keyed, coverage error
    {
        let mut xc = feat(6);
        xc.push(col("id", strs(&["0", "1", "2", "3", "4", "5"])));
        let y = csv(&[
            ("id", strs(&["0", "1", "2", "3", "4", "5"])),
            ("y", fnum(&[0., 1., 2., 3., 4., 5.])),
        ]);
        v.push((
            "join_error",
            vec![("X.csv", csv(&xc)), ("Y.csv", y)],
            json!({"sample_index":{"by":"id","key":"id"},"sources":[
                {"id":"x","role":"mixed","input":"X.csv","key":"id","columns":[{"role":"features","select":{"regex":"^\\d+$"}}]},
                {"id":"y","role":"targets","input":"Y.csv","key":"id","columns":[{"role":"targets","select":["y"]}],
                 "join":{"to":"x","on":"id","how":"1:1","coverage":"error"}}]}),
        ));
    }
    // 1:m expansion
    {
        let x = csv(&[("sid", strs(&["1", "2"])), ("1000", fnum(&[0.1, 0.2]))]);
        let t = csv(&[
            ("sid", strs(&["1", "1", "2"])),
            ("y", fnum(&[10., 11., 20.])),
        ]);
        v.push((
            "join_1tom",
            vec![("x.csv", x), ("t.csv", t)],
            json!({"sources":[
                {"id":"x","role":"mixed","input":"x.csv","key":"sid","columns":[{"role":"features","select":["1000"]}]},
                {"id":"t","role":"targets","input":"t.csv","columns":[{"role":"targets","select":["y"]}],
                 "join":{"to":"x","left_on":"sid","right_on":"sid","how":"1:m"}}]}),
        ));
    }
    // composite key 1:1
    {
        let x = csv(&[
            ("a", strs(&["1", "1"])),
            ("b", strs(&["p", "q"])),
            ("1000", fnum(&[0.1, 0.2])),
        ]);
        let y = csv(&[
            ("a", strs(&["1", "1"])),
            ("b", strs(&["p", "q"])),
            ("y", fnum(&[1., 2.])),
        ]);
        v.push((
            "composite",
            vec![("x.csv", x), ("y.csv", y)],
            json!({"sample_index":{"by":"id","key":["a","b"]},"sources":[
                {"id":"x","role":"mixed","input":"x.csv","key":["a","b"],"columns":[{"role":"features","select":["1000"]}]},
                {"id":"y","role":"targets","input":"y.csv","key":["a","b"],"columns":[{"role":"targets","select":["y"]}],
                 "join":{"left":"x","right":"y","left_on":["a","b"],"right_on":["a","b"],"how":"1:1","coverage":"complete"}}]}),
        ));
    }
    // partition column
    {
        let mut c = feat(8);
        c.push(col("y", fnum(&[0., 1., 2., 3., 4., 5., 6., 7.])));
        c.push(col(
            "set",
            strs(&["cal", "cal", "cal", "cal", "val", "val", "val", "val"]),
        ));
        v.push((
            "partition_column",
            vec![("all.csv", csv(&c))],
            json!({"sources":[{"id":"d","role":"mixed","input":"all.csv","columns":[
                {"role":"features","select":{"regex":"^\\d+$"}},{"role":"targets","select":["y"]},{"role":"metadata","select":["set"]}]}],
                "partitions":{"by":"column","column":"set","train_values":["cal"],"test_values":["val"]}}),
        ));
    }
    // partition index
    {
        let mut c = feat(10);
        c.push(col(
            "y",
            fnum(&(0..10).map(|i| i as f64).collect::<Vec<_>>()),
        ));
        v.push((
            "partition_index",
            vec![("all.csv", csv(&c))],
            json!({"sources":[{"id":"d","role":"mixed","input":"all.csv","columns":[
                {"role":"features","select":{"regex":"^\\d+$"}},{"role":"targets","select":["y"]}]}],
                "partitions":{"by":"index","train":[0,1,2,3,4,5,6],"test":[7,8,9]}}),
        ));
    }
    // auto selector for targets
    {
        let mut c = feat(6);
        c.push(col("y", fnum(&[0., 1., 2., 3., 4., 5.])));
        v.push((
            "auto_targets",
            vec![("data.csv", csv(&c))],
            json!({"sources":[{"id":"d","role":"mixed","input":"data.csv","columns":[
                {"role":"targets","select":"auto"},{"role":"features","select":"rest"}]}]}),
        ));
    }
    // folds inline
    {
        let x = csv(&feat(6));
        let y = csv(&[("y", fnum(&[0., 1., 2., 3., 4., 5.]))]);
        v.push((
            "folds_inline",
            vec![("X.csv", x), ("Y.csv", y)],
            json!({"sources":[{"id":"x","role":"features","input":"X.csv"},
                {"id":"y","role":"targets","input":"Y.csv","join":{"to":"x","how":"1:1"}}],
                "folds":{"inline":[{"train":[0,1,2,3],"val":[4,5]}]}}),
        ));
    }
    // folds by column
    {
        let mut c = feat(6);
        c.push(col("y", fnum(&[0., 1., 2., 3., 4., 5.])));
        c.push(col("cv_fold", strs(&["0", "1", "0", "1", "0", "1"])));
        v.push((
            "folds_column",
            vec![("all.csv", csv(&c))],
            json!({"sources":[{"id":"d","role":"mixed","input":"all.csv","columns":[
                {"role":"features","select":{"regex":"^\\d+$"}},{"role":"targets","select":["y"]},{"role":"metadata","select":["cv_fold"]}]}],
                "folds":{"column":"cv_fold"}}),
        ));
    }
    // role: weights
    {
        let mut c = feat(6);
        c.push(col("y", fnum(&[0., 1., 2., 3., 4., 5.])));
        c.push(col("w", fnum(&[1., 1., 2., 0.5, 1., 1.5])));
        v.push((
            "role_weights",
            vec![("data.csv", csv(&c))],
            json!({"sources":[{"id":"d","role":"mixed","input":"data.csv","columns":[
                {"role":"features","select":{"regex":"^\\d+$"}},{"role":"targets","select":["y"]},{"role":"weights","select":["w"]}]}]}),
        ));
    }
    // variations
    {
        let x = csv(&feat(6));
        let x_snv = csv(&feat(6));
        let y = csv(&[("y", fnum(&[0., 1., 2., 3., 4., 5.]))]);
        v.push((
            "variations_snv",
            vec![("X.csv", x), ("X_snv.csv", x_snv), ("Y.csv", y)],
            json!({"sources":[
                {"id":"x","role":"features","input":"X.csv","variations":[{"name":"snv","input":"X_snv.csv"}]},
                {"id":"y","role":"targets","input":"Y.csv","join":{"to":"x","how":"1:1"}}]}),
        ));
    }
    v
}

fn build_spec(spec_json: &Value) -> DatasetSpec {
    DatasetSpec::from_value(&normalize_to_spec_dict(spec_json)).expect("spec parses")
}

#[test]
fn cookbook_cases_load_and_cover_the_matrix() {
    let mut covered: BTreeSet<String> = BTreeSet::new();
    for (name, files, spec_json) in cases() {
        let dir = tempfile::tempdir().expect("tmp dir");
        for (fname, content) in &files {
            std::fs::write(dir.path().join(fname), content).expect("write csv");
        }
        let spec = build_spec(&spec_json);
        let assembled = assemble(&spec, dir.path())
            .unwrap_or_else(|e| panic!("case `{name}` failed to assemble: {}", e.message));
        assert!(
            !assembled.blocks.is_empty(),
            "case `{name}` produced no blocks"
        );
        for (part, b) in &assembled.blocks {
            assert!(!b.x.is_empty(), "case `{name}` block `{part}` has no X");
            assert_eq!(
                b.x[0].n_rows, b.n_samples,
                "case `{name}` block `{part}` X rows != n_samples"
            );
        }
        covered.extend(vocab_elements(&spec));
    }

    // folds:file + partition:index_file are exercised by their dedicated tests below.
    covered.insert("folds:file".into());
    covered.insert("partition:index_file".into());

    let missing: Vec<&str> = CATALOGUE
        .iter()
        .copied()
        .filter(|e| !covered.contains(*e))
        .collect();
    assert!(
        missing.is_empty(),
        "cookbook coverage gap — unexercised vocabulary: {missing:?}"
    );
}

#[test]
fn folds_file_case_loads() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("X.csv"), csv(&feat(6))).unwrap();
    std::fs::write(
        dir.path().join("Y.csv"),
        csv(&[("y", fnum(&[0., 1., 2., 3., 4., 5.]))]),
    )
    .unwrap();
    std::fs::write(
        dir.path().join("folds.csv"),
        "fold_0,fold_1\n0,2\n1,3\n,4\n,5\n",
    )
    .unwrap();
    let spec = build_spec(&json!({"sources":[
        {"id":"x","role":"features","input":"X.csv"},
        {"id":"y","role":"targets","input":"Y.csv","join":{"to":"x","how":"1:1"}}],
        "folds":{"file":"folds.csv","format":"csv"}}));
    let assembled = assemble(&spec, dir.path()).expect("assemble folds_file");
    assert_eq!(assembled.folds.len(), 2, "two folds from the file");
}

#[test]
fn index_file_case_loads() {
    let dir = tempfile::tempdir().unwrap();
    let mut c = feat(8);
    c.push(col(
        "y",
        fnum(&(0..8).map(|i| i as f64).collect::<Vec<_>>()),
    ));
    std::fs::write(dir.path().join("all.csv"), csv(&c)).unwrap();
    std::fs::write(dir.path().join("train_idx.txt"), "0\n1\n2\n3\n4\n").unwrap();
    std::fs::write(dir.path().join("test_idx.txt"), "[5, 6, 7]\n").unwrap();
    let spec = build_spec(
        &json!({"sources":[{"id":"d","role":"mixed","input":"all.csv","columns":[
        {"role":"features","select":{"regex":"^\\d+$"}},{"role":"targets","select":["y"]}]}],
        "partitions":{"by":"index_file","train_file":"train_idx.txt","test_file":"test_idx.txt"}}),
    );
    let assembled = assemble(&spec, dir.path()).expect("assemble index_file");
    assert_eq!(assembled.blocks["train"].n_samples, 5);
    assert_eq!(assembled.blocks["test"].n_samples, 3);
}
