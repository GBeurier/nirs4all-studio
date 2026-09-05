#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
vendor_root="$script_dir/../vendor/dag-ml-data-ffe5337"
inventory="$vendor_root/INVENTORY.sha256"
actual=$(mktemp)
expected=$(mktemp)
trap 'rm -f "$actual" "$expected"' EXIT HUP INT TERM

test -f "$vendor_root/upstream/Cargo.toml"
test -f "$vendor_root/upstream/Cargo.lock"
test -f "$vendor_root/upstream/LICENSE"
test -f "$vendor_root/upstream/THIRD_PARTY_NOTICES.md"
test -f "$vendor_root/upstream/scripts/release/check_publish_plan.py"
test -f "$vendor_root/upstream/scripts/release/publish_crates.py"
test -f "$vendor_root/upstream/crates/dag-ml-data/src/lib.rs"
test -f "$vendor_root/upstream/crates/dag-ml-data-core/src/lib.rs"
test -f "$vendor_root/upstream/crates/dag-ml-data-provider/src/lib.rs"
grep -q 'version = "0.2.11"' "$vendor_root/upstream/Cargo.toml"
grep -q '"commit": "ffe533704a1a0b0c7bb7d97a997caade3f4ba36e"' "$vendor_root/PROVENANCE.json"
grep -q '"repository_tree": "fe9950371e360ba2cb32d790250e56555eb9efc1"' "$vendor_root/PROVENANCE.json"
grep -q '"dag-ml-data": "b440877c2faa70050ba72ba094970465460af051"' "$vendor_root/PROVENANCE.json"
grep -q '"dag-ml-data-core": "187ba49d3e5a79bcdf002d9bedcf1c61b94bef4d"' "$vendor_root/PROVENANCE.json"
grep -q '"dag-ml-data-provider": "e6d74879fb71c7552b21f4a04b96c24b30b9ab1b"' "$vendor_root/PROVENANCE.json"
grep -q '"sha256": "c957ca4bb18a2012e6f7d648f2b300b70faa516133a004c19bab89ae4672884b"' "$vendor_root/PROVENANCE.json"
grep -q '"sha256": "0f88f28ad7d4bc9617443da03c0e7e6db4feaa224e697da09e1f0a5fa007b36f"' "$vendor_root/PROVENANCE.json"
grep -q '"sha256": "2a806973713639e291bd1175278ba62ae3b488c82154af23c3d003760d5ec184"' "$vendor_root/PROVENANCE.json"
grep -q '"hashed_files": 190' "$vendor_root/PROVENANCE.json"

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
