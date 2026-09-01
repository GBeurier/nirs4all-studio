// SPDX-License-Identifier: CeCILL-2.1 OR AGPL-3.0-or-later
//! Canonical JSON (story 7.3) — the cross-language wire contract.
//!
//! The single biggest correctness risk in the rewrite is that Python `json`
//! and Rust `serde_json` disagree byte-for-byte. We pin a canonical form and
//! verify it with a parity gate (`tests/canonical_parity.rs` here and
//! `tests/test_canonical_json.py` on the Python side, both comparing against the
//! same blessed expected files).
//!
//! ## Canonical form
//! - **Encoding:** UTF-8, no BOM. Non-ASCII is emitted verbatim (NOT
//!   `\uXXXX`-escaped); the Python side sets `ensure_ascii=False` to match.
//! - **Key order:** lexicographic by Unicode code point. The workspace enables
//!   serde_json's `preserve_order` so *input* map order mirrors Python dict
//!   insertion order (load-bearing for legacy-config normalization). Therefore
//!   `canonical_json` sorts object keys EXPLICITLY — it cannot rely on the map
//!   type. Rust `str` `Ord` is byte-wise UTF-8 = code-point order, matching
//!   Python `sort_keys=True`.
//! - **Indent:** pretty, two spaces, `": "` after keys, one element per line.
//!   `serde_json::to_string_pretty` and Python `json.dumps(indent=2)` produce
//!   identical layout (verified by the parity gate).
//! - **Line endings:** `\n`, with a single trailing `\n`.
//! - **Floats:** finite only. `serde_json` maps non-finite `f64` to JSON `null`
//!   on the way into a `Value`; the IR never produces non-finite numbers, and
//!   the Python emitter sets `allow_nan=False` to make the policy explicit. The
//!   contract domain is finite decimals in **normal range** — scores rounded to
//!   3 decimals and wavelengths (|x| in roughly `[1e-3, 25000]`). Values that
//!   would require exponent notation (`|x| >= 1e16` or `0 < |x| < 1e-4`) are the
//!   only known point where Python `repr` and Ryū can disagree; the IR never
//!   emits them. The `contract_domain_floats` parity case pins this range.

use serde::Serialize;
use thiserror::Error;

/// Errors raised while producing canonical JSON.
#[derive(Debug, Error)]
pub enum CanonicalJsonError {
    /// The value could not be serialized to JSON.
    #[error("JSON serialization failed: {0}")]
    Serialize(#[from] serde_json::Error),
}

/// Canonicalize an already-built [`serde_json::Value`].
///
/// Objects are re-emitted with sorted keys (guaranteed by `serde_json`'s
/// default `BTreeMap` map type), two-space pretty indentation, and a single
/// trailing newline.
pub fn canonical_json(value: &serde_json::Value) -> Result<String, CanonicalJsonError> {
    let mut out = serde_json::to_string_pretty(&sort_keys(value))?;
    out.push('\n');
    Ok(out)
}

/// Recursively rebuild `value` with object keys sorted lexicographically.
///
/// Required because the workspace enables `preserve_order`, so the default map
/// is insertion-ordered; we re-key it in sorted order before serializing.
fn sort_keys(value: &serde_json::Value) -> serde_json::Value {
    use serde_json::Value;
    match value {
        Value::Object(map) => {
            let mut keys: Vec<&String> = map.keys().collect();
            keys.sort_unstable();
            let mut out = serde_json::Map::new();
            for k in keys {
                out.insert(k.clone(), sort_keys(&map[k]));
            }
            Value::Object(out)
        }
        Value::Array(items) => Value::Array(items.iter().map(sort_keys).collect()),
        other => other.clone(),
    }
}

/// Serialize any [`Serialize`] value to canonical JSON.
///
/// Routes through [`serde_json::Value`] so key ordering is normalized
/// regardless of struct field declaration order.
pub fn to_canonical_json<T: Serialize>(value: &T) -> Result<String, CanonicalJsonError> {
    let value = serde_json::to_value(value)?;
    canonical_json(&value)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn keys_are_sorted_regardless_of_insertion_order() {
        let v = json!({"b": 1, "a": 2, "c": {"z": 1, "y": 2}});
        let out = canonical_json(&v).unwrap();
        assert_eq!(
            out,
            "{\n  \"a\": 2,\n  \"b\": 1,\n  \"c\": {\n    \"y\": 2,\n    \"z\": 1\n  }\n}\n"
        );
    }

    #[test]
    fn empty_containers_and_trailing_newline() {
        let v = json!({"arr": [], "obj": {}});
        let out = canonical_json(&v).unwrap();
        assert_eq!(out, "{\n  \"arr\": [],\n  \"obj\": {}\n}\n");
    }

    #[test]
    fn floats_keep_decimal_point_and_ints_stay_ints() {
        let v = json!({"i": 1, "f": 1.0, "s": 0.95});
        let out = canonical_json(&v).unwrap();
        assert_eq!(out, "{\n  \"f\": 1.0,\n  \"i\": 1,\n  \"s\": 0.95\n}\n");
    }

    #[test]
    fn unicode_is_emitted_verbatim() {
        let v = json!({"name": "café—é"});
        let out = canonical_json(&v).unwrap();
        assert_eq!(out, "{\n  \"name\": \"café—é\"\n}\n");
    }
}
