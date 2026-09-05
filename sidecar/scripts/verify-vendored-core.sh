#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
vendor_root="$script_dir/../vendor/nirs4all-core-4729471"
inventory="$vendor_root/INVENTORY.sha256"
actual=$(mktemp)
expected=$(mktemp)
trap 'rm -f "$actual" "$expected"' EXIT HUP INT TERM

test -f "$vendor_root/upstream/Cargo.toml"
test -f "$vendor_root/upstream/Cargo.lock"
test -f "$vendor_root/upstream/bindings/wasm/package-lock.json"
test -f "$vendor_root/upstream/bindings/rust/nirs4all/src/archive_v2.rs"
test -f "$vendor_root/upstream/bindings/rust/nirs4all/src/native_methods_replay.rs"
grep -q 'preflight_methods_archive_v2_library' "$vendor_root/upstream/bindings/rust/nirs4all/src/lib.rs"
grep -q 'inspect_methods_archive_v2_predictors' "$vendor_root/upstream/bindings/rust/nirs4all/src/lib.rs"
grep -q 'train_dataset_package_methods_conformal_archive_v2' "$vendor_root/upstream/bindings/rust/nirs4all/src/lib.rs"
test "$(sed -n 's/^version = "\([^"]*\)"/\1/p' "$vendor_root/upstream/bindings/rust/nirs4all/Cargo.toml" | head -n 1)" = "0.3.29"
grep -q 'n4m = { version = "=0.1.4"' "$vendor_root/upstream/bindings/rust/nirs4all/Cargo.toml"
grep -q '"commit": "47294718edf8ad2a170158e339adda39e3e4fa2f"' "$vendor_root/PROVENANCE.json"
grep -q '"repository_tree": "386a4ef6031b18e85f976a639888991753e5e68c"' "$vendor_root/PROVENANCE.json"
grep -q '"nirs4all": "211ca18cac23510c428d595072c59484bd34a192"' "$vendor_root/PROVENANCE.json"
grep -q '"sha256": "b655dc5c2a1a7c5dcf2f525af6ebd3bef7b0647114973e5c6ceebd7b7c70fcd0"' "$vendor_root/PROVENANCE.json"
grep -q '"hashed_files": 257' "$vendor_root/PROVENANCE.json"

(
  cd "$vendor_root"
  find . -type f ! -name INVENTORY.sha256 -print | LC_ALL=C sort
) >"$actual"
sed 's/^[0-9a-f][0-9a-f]*  //' "$inventory" | LC_ALL=C sort >"$expected"
diff -u "$expected" "$actual"
(
  cd "$vendor_root"
  sha256sum --check --strict INVENTORY.sha256
)
