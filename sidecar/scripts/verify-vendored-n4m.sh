#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
vendor_root="$script_dir/../vendor/n4m-48ad1e5"
inventory="$vendor_root/INVENTORY.sha256"
actual=$(mktemp)
expected=$(mktemp)
trap 'rm -f "$actual" "$expected"' EXIT HUP INT TERM

crate="$vendor_root/upstream/n4m-0.1.4"
test -f "$crate/Cargo.toml"
test -f "$crate/Cargo.toml.orig"
test -f "$crate/.cargo_vcs_info.json"
test -f "$crate/src/lib.rs"
grep -q 'version = "0.1.4"' "$crate/Cargo.toml"
grep -q '"sha1": "48ad1e5a50844f68c2b99e93b02ad6a3b491c07b"' "$crate/.cargo_vcs_info.json"
grep -q '"commit": "48ad1e5a50844f68c2b99e93b02ad6a3b491c07b"' "$vendor_root/PROVENANCE.json"
grep -q '"repository_tree": "f2eaa3c46629c26d11913a25bff723f9a9cefbc9"' "$vendor_root/PROVENANCE.json"
grep -q '"n4m": "d05e03f28f6cb9e6e6599a75d157df9b01c4b459"' "$vendor_root/PROVENANCE.json"
grep -q '"sha256": "859c935ea5b8f7620a8861cdc0ac3c57a9a0f92efe584347c2278de5a0bf1e7d"' "$vendor_root/PROVENANCE.json"
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
