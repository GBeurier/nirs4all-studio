// SPDX-License-Identifier: CeCILL-2.1 OR AGPL-3.0-or-later
//! ABI-surface drift guard. The set of `#[no_mangle] pub extern "C" fn n4io_*`
//! declared in `src/lib.rs` must equal the frozen `abi/expected_symbols_*.txt`
//! snapshots (which all three platforms share) and appear in the committed
//! cbindgen header. The cross-platform CI (`.github/workflows/abi-check.yml`)
//! re-checks the *built* libraries; this test catches drift at `cargo test`
//! time without needing the artifact.

use std::collections::BTreeSet;

const SRC: &str = include_str!("../src/lib.rs");
const HEADER: &str = include_str!("../include/nirs4all_io.h");
const LINUX: &str = include_str!("../abi/expected_symbols_linux.txt");
const MACOS: &str = include_str!("../abi/expected_symbols_macos.txt");
const WINDOWS: &str = include_str!("../abi/expected_symbols_windows.txt");

fn snapshot(text: &str) -> BTreeSet<String> {
    text.lines()
        .map(str::trim)
        .filter(|l| !l.is_empty())
        .map(String::from)
        .collect()
}

/// Symbols declared with `pub extern "C" fn n4io_...` (with or without `unsafe`).
fn declared_symbols() -> BTreeSet<String> {
    let marker = "extern \"C\" fn ";
    SRC.lines()
        .map(str::trim_start)
        .filter(|l| l.starts_with("pub "))
        .filter_map(|l| l.find(marker).map(|i| &l[i + marker.len()..]))
        .map(|after| {
            after
                .chars()
                .take_while(|c| c.is_alphanumeric() || *c == '_')
                .collect::<String>()
        })
        .filter(|name| name.starts_with("n4io_"))
        .collect()
}

#[test]
fn declared_surface_matches_linux_snapshot() {
    assert_eq!(
        declared_symbols(),
        snapshot(LINUX),
        "ABI surface drifted: update crates/nirs4all-io-capi/abi/expected_symbols_*.txt \
         (and rebuild to refresh the cbindgen header)"
    );
}

#[test]
fn all_platform_snapshots_agree() {
    let linux = snapshot(LINUX);
    assert_eq!(linux, snapshot(MACOS), "macOS snapshot differs from Linux");
    assert_eq!(
        linux,
        snapshot(WINDOWS),
        "Windows snapshot differs from Linux"
    );
}

#[test]
fn every_symbol_has_the_n4io_prefix() {
    assert!(
        snapshot(LINUX).iter().all(|s| s.starts_with("n4io_")),
        "non-n4io_ symbol in snapshot"
    );
}

#[test]
fn header_declares_every_symbol() {
    for sym in snapshot(LINUX) {
        assert!(
            HEADER.contains(&sym),
            "committed header is missing `{sym}` — rebuild to regenerate"
        );
    }
}
