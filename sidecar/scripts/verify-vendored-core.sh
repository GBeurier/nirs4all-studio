#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
vendor_root="$script_dir/../vendor/nirs4all-core-4eb8a68"
inventory="$vendor_root/INVENTORY.sha256"
actual=$(mktemp)
expected=$(mktemp)
trap 'rm -f "$actual" "$expected"' EXIT HUP INT TERM

test -f "$vendor_root/upstream/Cargo.toml"
test -f "$vendor_root/upstream/Cargo.lock"
test -f "$vendor_root/upstream/bindings/rust/nirs4all/src/archive_v2.rs"
test -f "$vendor_root/upstream/bindings/rust/nirs4all/src/native_methods_replay.rs"
grep -q 'preflight_methods_archive_v2_library' "$vendor_root/upstream/bindings/rust/nirs4all/src/lib.rs"
test "$(sed -n 's/^version = "\([^"]*\)"/\1/p' "$vendor_root/upstream/bindings/rust/nirs4all/Cargo.toml" | head -n 1)" = "0.3.25"
grep -q 'n4m = { version = "=0.1.2"' "$vendor_root/upstream/bindings/rust/nirs4all/Cargo.toml"
grep -q '"commit": "4eb8a687b0b3797b6f5db816444cf840f67c8ee0"' "$vendor_root/PROVENANCE.json"
grep -q '"repository_tree": "4ccd67a7fe556db2c50615500cca096cae7666ef"' "$vendor_root/PROVENANCE.json"
grep -q '"nirs4all": "4020cacd8aa72b4f160b6fa93fafe5d69169e836"' "$vendor_root/PROVENANCE.json"
grep -q '"sha256": "cf0b7983f6f46f3467256acee60fe7fb85f7fa78073d1f2c2046b3282f51043f"' "$vendor_root/PROVENANCE.json"
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
