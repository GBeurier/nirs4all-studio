#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
vendor_root="$script_dir/../vendor/dag-ml-data-1f60"
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
grep -q 'version = "0.2.10"' "$vendor_root/upstream/Cargo.toml"
grep -q '"commit": "1f60b920d34acda7c0fbc044b593bb6af1fab4c1"' "$vendor_root/PROVENANCE.json"
grep -q '"repository_tree": "f2144d861642e81758dcef4f6ee76ec32c0961ff"' "$vendor_root/PROVENANCE.json"
test "$(find "$vendor_root/upstream/crates" -mindepth 1 -maxdepth 1 -type d | wc -l)" = "3"
grep -q '"hashed_files": 48' "$vendor_root/PROVENANCE.json"

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
