#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
vendor_root="$script_dir/../vendor/dag-ml-bad5"
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
grep -q 'version = "0.1.2"' "$core/Cargo.toml"
grep -q '"sha1": "bad5aff0bfbc14c622f5ade7f393f29399df6e07"' "$facade/.cargo_vcs_info.json"
grep -q '"sha1": "bad5aff0bfbc14c622f5ade7f393f29399df6e07"' "$core/.cargo_vcs_info.json"
grep -q '"commit": "bad5aff0bfbc14c622f5ade7f393f29399df6e07"' "$vendor_root/PROVENANCE.json"
grep -q '"repository_tree": "529ecc687d6b9307f41ee34feafcf5d8135ba9ae"' "$vendor_root/PROVENANCE.json"
grep -q '"dag-ml": "bba3d934c7cc6488cca1557128e7ed24577bbd1e"' "$vendor_root/PROVENANCE.json"
grep -q '"dag-ml-core": "87f5b18085e7fda2aeed1fb79767f2defea0b50e"' "$vendor_root/PROVENANCE.json"
grep -q '"hashed_files": 94' "$vendor_root/PROVENANCE.json"

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
