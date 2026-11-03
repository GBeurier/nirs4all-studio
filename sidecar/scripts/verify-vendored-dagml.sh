#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
vendor_root="$script_dir/../vendor/dag-ml-0122612"
lock="$script_dir/../Cargo.lock"
inventory="$vendor_root/INVENTORY.sha256"
actual=$(mktemp)
expected=$(mktemp)
trap 'rm -f "$actual" "$expected"' EXIT HUP INT TERM

test -f "$vendor_root/upstream/dag-ml-0.3.44"/Cargo.toml
test -f "$vendor_root/upstream/dag-ml-0.3.44"/Cargo.toml.orig
test -f "$vendor_root/upstream/dag-ml-0.3.44"/Cargo.lock
test -f "$vendor_root/upstream/dag-ml-0.3.44"/.cargo_vcs_info.json
test "$(sed -n 's/^version = "\([^"]*\)"/\1/p' "$vendor_root/upstream/dag-ml-0.3.44"/Cargo.toml | head -n 1)" = "0.3.44"
grep -q '"sha1": "01226120552529aad45e5ba60d3f6327894adc67"' "$vendor_root/upstream/dag-ml-0.3.44"/.cargo_vcs_info.json
grep -q '"dag-ml": "bba3d934c7cc6488cca1557128e7ed24577bbd1e"' "$vendor_root/PROVENANCE.json"
grep -q '"sha256": "0c752eebc932ccd9bfff7d85fdeb27edaa223866f34e7a7c6f3fd87e9e54ef6f"' "$vendor_root/PROVENANCE.json"
grep -A2 -x 'name = "dag-ml"' "$lock" | grep -qx 'version = "0.3.44"'
grep -qx 'checksum = "0c752eebc932ccd9bfff7d85fdeb27edaa223866f34e7a7c6f3fd87e9e54ef6f"' "$lock"
test -f "$vendor_root/upstream/dag-ml-core-0.3.44"/Cargo.toml
test -f "$vendor_root/upstream/dag-ml-core-0.3.44"/Cargo.toml.orig
test -f "$vendor_root/upstream/dag-ml-core-0.3.44"/Cargo.lock
test -f "$vendor_root/upstream/dag-ml-core-0.3.44"/.cargo_vcs_info.json
test "$(sed -n 's/^version = "\([^"]*\)"/\1/p' "$vendor_root/upstream/dag-ml-core-0.3.44"/Cargo.toml | head -n 1)" = "0.3.44"
grep -q '"sha1": "01226120552529aad45e5ba60d3f6327894adc67"' "$vendor_root/upstream/dag-ml-core-0.3.44"/.cargo_vcs_info.json
grep -q '"dag-ml-core": "2c48c565f0e453cf6f643d9a33f275e95f92e808"' "$vendor_root/PROVENANCE.json"
grep -q '"sha256": "e4f4fd800766c7a01a9f6605226556a8e8f5fbd7df498457b5c8ecc8b9029080"' "$vendor_root/PROVENANCE.json"
grep -A2 -x 'name = "dag-ml-core"' "$lock" | grep -qx 'version = "0.3.44"'
grep -qx 'checksum = "e4f4fd800766c7a01a9f6605226556a8e8f5fbd7df498457b5c8ecc8b9029080"' "$lock"
test -f "$vendor_root/upstream/dag-ml-results-0.3.44"/Cargo.toml
test -f "$vendor_root/upstream/dag-ml-results-0.3.44"/Cargo.toml.orig
test -f "$vendor_root/upstream/dag-ml-results-0.3.44"/Cargo.lock
test -f "$vendor_root/upstream/dag-ml-results-0.3.44"/.cargo_vcs_info.json
test "$(sed -n 's/^version = "\([^"]*\)"/\1/p' "$vendor_root/upstream/dag-ml-results-0.3.44"/Cargo.toml | head -n 1)" = "0.3.44"
grep -q '"sha1": "01226120552529aad45e5ba60d3f6327894adc67"' "$vendor_root/upstream/dag-ml-results-0.3.44"/.cargo_vcs_info.json
grep -q '"dag-ml-results": "2531c913e359e54b2f13e67a5fdb92cb46292d6d"' "$vendor_root/PROVENANCE.json"
grep -q '"sha256": "7bf34f0a2ed9a6250fab06716d34a11c85b190f61d61c90220dac0bd877a75ea"' "$vendor_root/PROVENANCE.json"
grep -A2 -x 'name = "dag-ml-results"' "$lock" | grep -qx 'version = "0.3.44"'
grep -qx 'checksum = "7bf34f0a2ed9a6250fab06716d34a11c85b190f61d61c90220dac0bd877a75ea"' "$lock"
grep -q '"commit": "01226120552529aad45e5ba60d3f6327894adc67"' "$vendor_root/PROVENANCE.json"
grep -q '"repository_tree": "14f02a3278e74e953a94f482dc4a4f8800c85f54"' "$vendor_root/PROVENANCE.json"
grep -q '"hashed_files": 135' "$vendor_root/PROVENANCE.json"

(
  cd "$vendor_root"
  find . -type f ! -name INVENTORY.sha256 -print | LC_ALL=C sort
) >"$actual"
sed 's/^[0-9a-f][0-9a-f]*  //' "$inventory" | LC_ALL=C sort >"$expected"
diff -u "$expected" "$actual"
(
  cd "$vendor_root"
  sha256sum --check --strict --quiet INVENTORY.sha256
)
