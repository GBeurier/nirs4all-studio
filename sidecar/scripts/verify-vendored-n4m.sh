#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
vendor_root="$script_dir/../vendor/n4m-a71ee29"
inventory="$vendor_root/INVENTORY.sha256"
actual=$(mktemp)
expected=$(mktemp)
trap 'rm -f "$actual" "$expected"' EXIT HUP INT TERM

crate="$vendor_root/upstream/n4m-0.1.3"
test -f "$crate/Cargo.toml"
test -f "$crate/Cargo.toml.orig"
test -f "$crate/.cargo_vcs_info.json"
test -f "$crate/src/lib.rs"
grep -q 'version = "0.1.3"' "$crate/Cargo.toml"
grep -q '"sha1": "a71ee2927524d03482183de3d6e22661efc05d12"' "$crate/.cargo_vcs_info.json"
grep -q '"commit": "a71ee2927524d03482183de3d6e22661efc05d12"' "$vendor_root/PROVENANCE.json"
grep -q '"repository_tree": "f6749f4c4be7dca161f3c2677dd10a9ac4434b66"' "$vendor_root/PROVENANCE.json"
grep -q '"n4m": "8501c570137bbb3edfb4adce629e3b89a56fb2c2"' "$vendor_root/PROVENANCE.json"
grep -q '"sha256": "adeef4121b462f30d379dedc23c9b19371e746813f72d52f94dae636ff0ccdd4"' "$vendor_root/PROVENANCE.json"
grep -q '"hashed_files": 13' "$vendor_root/PROVENANCE.json"

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
