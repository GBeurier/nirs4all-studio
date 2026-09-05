// SPDX-License-Identifier: CeCILL-2.1 OR AGPL-3.0-or-later
//! Property tests (EPIC 12.5) — intensive, generative fuzzing of the pure parse
//! surfaces. Arbitrary JSON must never panic the spec/normalize/selector parsers,
//! and canonical JSON must round-trip and be idempotent on any finite value.
//! (ASan/UBSan over the C ABI + cargo-fuzz corpora are the CI-gated complement.)

use nirs4all_io_core::canonical_json;
use nirs4all_io_core::infer::describe_text;
use nirs4all_io_core::spec::selectors::Selector;
use nirs4all_io_core::spec::{normalize_to_spec_dict, validate_spec, DatasetSpec};
use proptest::prelude::*;
use serde_json::Value;

/// A bounded, recursive arbitrary `serde_json::Value` (finite numbers only — the
/// IR never emits NaN/Inf, and `canonical_json` rejects them by contract).
fn arb_json() -> impl Strategy<Value = Value> {
    let leaf = prop_oneof![
        Just(Value::Null),
        any::<bool>().prop_map(Value::Bool),
        any::<i64>().prop_map(Value::from),
        // Any finite f64: canonical_json emits the shortest round-tripping repr
        // (ryu) and the workspace enables serde_json's `float_roundtrip` so the
        // re-parse is correctly rounded (matching CPython). NaN/Inf are excluded
        // by contract (the IR never emits them; canonical_json would reject them).
        any::<f64>()
            .prop_filter("finite", |f| f.is_finite())
            .prop_map(Value::from),
        ".*".prop_map(Value::String),
    ];
    leaf.prop_recursive(4, 48, 8, |inner| {
        prop_oneof![
            prop::collection::vec(inner.clone(), 0..6).prop_map(Value::Array),
            prop::collection::hash_map(".*", inner, 0..6)
                .prop_map(|m| Value::Object(m.into_iter().collect())),
        ]
    })
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(400))]

    /// canonical_json(v) parses back to an equal value, and re-canonicalizing is
    /// stable (the cross-language wire contract is well-defined for any value).
    #[test]
    fn canonical_json_round_trips_and_is_idempotent(v in arb_json()) {
        let s = canonical_json(&v).expect("finite JSON canonicalizes");
        let parsed: Value = serde_json::from_str(&s).expect("canonical JSON parses");
        prop_assert_eq!(&v, &parsed, "canonical JSON round-trips to an equal value");
        let s2 = canonical_json(&parsed).expect("re-canonicalize");
        prop_assert_eq!(s, s2, "canonical JSON is idempotent");
    }

    /// Parsing arbitrary JSON into the IR returns Ok or a SpecError — never panics.
    #[test]
    fn dataset_spec_from_value_never_panics(v in arb_json()) {
        let _ = DatasetSpec::from_value(&v);
    }

    #[test]
    fn normalize_never_panics(v in arb_json()) {
        let _ = normalize_to_spec_dict(&v);
    }

    /// validate() never panics on any spec the parser accepts.
    #[test]
    fn validate_never_panics_on_parsed_specs(v in arb_json()) {
        if let Ok(spec) = DatasetSpec::from_value(&v) {
            let _ = validate_spec(&spec);
        }
    }

    /// Selector parsing never panics; a parsed selector re-serializes to a form
    /// that parses again (parse → to_spec → parse is stable).
    #[test]
    fn selector_parse_is_panic_free_and_stable(v in arb_json()) {
        if let Ok(sel) = Selector::parse(&v) {
            prop_assert!(Selector::parse(&sel.to_spec()).is_ok(), "selector re-parse");
        }
    }

    /// The CSV sniffer never panics on arbitrary text.
    #[test]
    fn describe_text_never_panics(text in ".*", n in 0usize..16) {
        let _ = describe_text(&text, n);
    }
}
