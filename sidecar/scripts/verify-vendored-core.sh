#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
vendor_root="$script_dir/../vendor/nirs4all-core-46a51a4"
inventory="$vendor_root/INVENTORY.sha256"
actual=$(mktemp)
expected=$(mktemp)
trap 'rm -f "$actual" "$expected"' EXIT HUP INT TERM

test -f "$vendor_root/upstream/Cargo.toml"
test -f "$vendor_root/upstream/Cargo.lock"
test -f "$vendor_root/upstream/bindings/rust/nirs4all/src/archive_v2.rs"
test -f "$vendor_root/upstream/bindings/rust/nirs4all/src/native_methods_replay.rs"
grep -q 'preflight_methods_archive_v2_library' "$vendor_root/upstream/bindings/rust/nirs4all/src/lib.rs"
grep -q 'inspect_methods_archive_v2_predictors' "$vendor_root/upstream/bindings/rust/nirs4all/src/lib.rs"
test "$(sed -n 's/^version = "\([^"]*\)"/\1/p' "$vendor_root/upstream/bindings/rust/nirs4all/Cargo.toml" | head -n 1)" = "0.3.25"
grep -q 'n4m = { version = "=0.1.4"' "$vendor_root/upstream/bindings/rust/nirs4all/Cargo.toml"
grep -q '"commit": "46a51a4bf123f9766b363fcbfb3009ea5c5f0a62"' "$vendor_root/PROVENANCE.json"
grep -q '"repository_tree": "3b02332cfa4cf5e3424a7697f56d85a55fd80de6"' "$vendor_root/PROVENANCE.json"
grep -q '"nirs4all": "a6fa7db08ed0724c36ca905e959d456341378aa4"' "$vendor_root/PROVENANCE.json"
grep -q '"sha256": "4eb6d6a370194d9e5bbbe55b2d3650f74699bd56790d3b5b1bd4f945550d99f9"' "$vendor_root/PROVENANCE.json"
grep -q '"hashed_files": 250' "$vendor_root/PROVENANCE.json"

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
