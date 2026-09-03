#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
vendor_root="$script_dir/../vendor/dag-ml-6800c4f"
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
grep -q '"sha1": "6800c4fd0ec8b13b171cec9ed4a9b2ccdbabca0d"' "$facade/.cargo_vcs_info.json"
grep -q '"sha1": "6800c4fd0ec8b13b171cec9ed4a9b2ccdbabca0d"' "$core/.cargo_vcs_info.json"
grep -q '"commit": "6800c4fd0ec8b13b171cec9ed4a9b2ccdbabca0d"' "$vendor_root/PROVENANCE.json"
grep -q '"repository_tree": "37d61366cae6061756a92befc60266e52dae5623"' "$vendor_root/PROVENANCE.json"
grep -q '"dag-ml": "bba3d934c7cc6488cca1557128e7ed24577bbd1e"' "$vendor_root/PROVENANCE.json"
grep -q '"dag-ml-core": "5a63ca748d69e7eea268f44b62826c9a853316f3"' "$vendor_root/PROVENANCE.json"
grep -q '"sha256": "ae9c025e2cb32d9a22986368be63ef54d78092c6b8026f24db17be531be078f5"' "$vendor_root/PROVENANCE.json"
grep -q '"sha256": "7def81ec143cece3c0883af92385d356af98338b260adb175578b88844fd951b"' "$vendor_root/PROVENANCE.json"
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
