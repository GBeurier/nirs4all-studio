#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
vendor_root="$script_dir/../vendor/dag-ml-1890991"
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
grep -q 'version = "0.1.3"' "$core/Cargo.toml"
grep -q '"sha1": "189099119b69e74c69466f2308808cb423dc2e94"' "$facade/.cargo_vcs_info.json"
grep -q '"sha1": "189099119b69e74c69466f2308808cb423dc2e94"' "$core/.cargo_vcs_info.json"
grep -q '"commit": "189099119b69e74c69466f2308808cb423dc2e94"' "$vendor_root/PROVENANCE.json"
grep -q '"repository_tree": "6ce31722bdb999482932e9d4a3884987426d1dd6"' "$vendor_root/PROVENANCE.json"
grep -q '"dag-ml": "bba3d934c7cc6488cca1557128e7ed24577bbd1e"' "$vendor_root/PROVENANCE.json"
grep -q '"dag-ml-core": "f17bbcf05e1f21f867444a0453de067c039cc8a0"' "$vendor_root/PROVENANCE.json"
grep -q '"sha256": "98156712e20077d6845c9dd7a70bf613be7122e39403716e0241b5136b6625b0"' "$vendor_root/PROVENANCE.json"
grep -q '"sha256": "af55a1530ca908ab22984f189e6508f8937a16ab68b135c9c8d0dc19b3b7a6cf"' "$vendor_root/PROVENANCE.json"
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
