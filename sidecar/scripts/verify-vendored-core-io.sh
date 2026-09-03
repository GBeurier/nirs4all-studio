#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
vendor_root="$script_dir/../vendor/nirs4all-io-54fa"
inventory="$vendor_root/INVENTORY.sha256"
actual=$(mktemp)
expected=$(mktemp)
trap 'rm -f "$actual" "$expected"' EXIT HUP INT TERM

test -f "$vendor_root/upstream/LICENSE"
test -f "$vendor_root/upstream/COPY_PROVENANCE.md"
test -f "$vendor_root/upstream/crates/nirs4all-io/src/lib.rs"
test -f "$vendor_root/upstream/crates/nirs4all-io-core/src/lib.rs"
test -f "$vendor_root/upstream/crates/nirs4all-io-dagml/src/lib.rs"
test "$(find "$vendor_root/upstream/crates" -mindepth 1 -maxdepth 1 -type d | wc -l)" = "3"
grep -q 'version = "0.1.12"' "$vendor_root/upstream/Cargo.toml"
grep -q '"commit": "54fa4f5f544f08f37317897612f78e4ee103b5a4"' "$vendor_root/PROVENANCE.json"
grep -q '"repository_tree": "c583ba2e8d2fec5376933086d4fbb765c931486f"' "$vendor_root/PROVENANCE.json"
grep -q '"hashed_files": 103' "$vendor_root/PROVENANCE.json"

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
