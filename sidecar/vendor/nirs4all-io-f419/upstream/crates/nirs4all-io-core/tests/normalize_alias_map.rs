// SPDX-License-Identifier: CeCILL-2.1 OR AGPL-3.0-or-later
//! Validates the Rust alias map (trap #4, first-wins over ~16k aliases) against
//! the Python `alias_map()` golden, byte-for-byte after canonicalization.
//! Re-bless: the Python harness writes `tests/goldens/normalize/alias_map.canonical`.

use std::path::PathBuf;

use nirs4all_io_core::canonical_json::canonical_json;
use nirs4all_io_core::spec::normalize::alias_map;
use serde_json::Value;

#[test]
fn alias_map_matches_python() {
    let golden = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(|p| p.parent())
        .unwrap()
        .join("tests/goldens/normalize/alias_map.canonical");
    let expected = std::fs::read_to_string(&golden).expect("alias_map golden");

    let map = alias_map();
    let obj: serde_json::Map<String, Value> = map
        .iter()
        .map(|(k, v)| (k.clone(), Value::from(v.clone())))
        .collect();
    let produced = canonical_json(&Value::Object(obj)).unwrap();
    assert_eq!(produced, expected, "alias map drift vs Python");
}
