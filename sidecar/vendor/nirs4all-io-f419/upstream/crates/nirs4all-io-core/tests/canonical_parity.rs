// SPDX-License-Identifier: CeCILL-2.1 OR AGPL-3.0-or-later
//! Canonical-JSON parity gate, Rust side (story 7.3).
//!
//! Reads the same `tests/goldens/canonical/cases.json` corpus as the Python
//! test and compares each canonicalized value against the same blessed
//! `<name>.canonical` files. The expected files are blessed from the Python
//! implementation, so a green run here proves Python ≡ Rust byte-for-byte.
//! Re-bless with `NIRS4ALL_IO_ACCEPT_GOLDENS=1 cargo test`.

use std::path::PathBuf;

use nirs4all_io_core::canonical_json;

fn golden_dir() -> PathBuf {
    // crates/nirs4all-io-core -> repo root is two levels up.
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(|p| p.parent())
        .expect("repo root")
        .join("tests/goldens/canonical")
}

#[test]
fn canonical_json_matches_goldens() {
    let dir = golden_dir();
    let cases: serde_json::Map<String, serde_json::Value> = {
        let text = std::fs::read_to_string(dir.join("cases.json")).expect("read cases.json");
        serde_json::from_str(&text).expect("parse cases.json")
    };
    let accept = std::env::var("NIRS4ALL_IO_ACCEPT_GOLDENS").as_deref() == Ok("1");

    let mut names: Vec<&String> = cases.keys().collect();
    names.sort();
    for name in names {
        let produced = canonical_json(&cases[name]).expect("canonicalize");
        let golden = dir.join(format!("{name}.canonical"));
        if accept {
            std::fs::write(&golden, &produced).expect("write golden");
            continue;
        }
        let expected = std::fs::read_to_string(&golden)
            .unwrap_or_else(|_| panic!("missing golden for {name}"));
        assert_eq!(produced, expected, "canonical-JSON drift for {name}");
    }
}
