#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
vendor_root="$script_dir/../vendor/dag-ml-879e2af"
inventory="$vendor_root/INVENTORY.sha256"
actual=$(mktemp)
expected=$(mktemp)
trap 'rm -f "$actual" "$expected"' EXIT HUP INT TERM

facade="$vendor_root/upstream/dag-ml-0.3.23"
core="$vendor_root/upstream/dag-ml-core-0.3.23"
test -f "$facade/Cargo.toml"
test -f "$facade/Cargo.toml.orig"
test -f "$facade/.cargo_vcs_info.json"
test -f "$core/Cargo.toml"
test -f "$core/Cargo.toml.orig"
test -f "$core/.cargo_vcs_info.json"
test -f "$core/LICENSE"
grep -q 'version = "0.3.23"' "$facade/Cargo.toml"
grep -q 'version = "0.3.23"' "$core/Cargo.toml"
grep -q 'version = "0.1.4"' "$core/Cargo.toml"
grep -q '"sha1": "879e2af880548287fe4f5de556681ae998e25bca"' "$facade/.cargo_vcs_info.json"
grep -q '"sha1": "879e2af880548287fe4f5de556681ae998e25bca"' "$core/.cargo_vcs_info.json"
grep -q '"commit": "879e2af880548287fe4f5de556681ae998e25bca"' "$vendor_root/PROVENANCE.json"
grep -q '"repository_tree": "28acb24f9d31b0900263ce45d85f2d6806380dc9"' "$vendor_root/PROVENANCE.json"
grep -q '"dag-ml": "bba3d934c7cc6488cca1557128e7ed24577bbd1e"' "$vendor_root/PROVENANCE.json"
grep -q '"dag-ml-core": "ce8237d16a014df38d3552ac03726f9a76d1a5cc"' "$vendor_root/PROVENANCE.json"
grep -q '"sha256": "ae9c025e2cb32d9a22986368be63ef54d78092c6b8026f24db17be531be078f5"' "$vendor_root/PROVENANCE.json"
grep -q '"sha256": "0f73ce40b1cba8cbe30d3706c8242f1730c2b97299b2e23c51538f92423c4a98"' "$vendor_root/PROVENANCE.json"
grep -q '"hashed_files": 95' "$vendor_root/PROVENANCE.json"

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
