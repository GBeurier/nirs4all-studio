#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
vendor_root="$script_dir/../vendor/nirs4all-io-493feb3"
inventory="$vendor_root/INVENTORY.sha256"
actual=$(mktemp)
expected=$(mktemp)
trap 'rm -f "$actual" "$expected"' EXIT HUP INT TERM

test -f "$vendor_root/upstream/Cargo.toml"
test -f "$vendor_root/upstream/Cargo.lock"
test -f "$vendor_root/upstream/crates/nirs4all-io/tests/role_tagged_adapter.rs"
test -d "$vendor_root/upstream/tests/fixtures"
grep -q 'version = "0.1.18"' "$vendor_root/upstream/Cargo.toml"
grep -q '"commit": "493feb3b9dc5b856c4837afda14292358a8a3184"' "$vendor_root/PROVENANCE.json"
grep -q '"repository_tree": "df18be5fe70db2f772404d67850dbd3d54ec5fe6"' "$vendor_root/PROVENANCE.json"
grep -q '"nirs4all-io": "ff16ea9591040372e6740cfa0e55646fa7124d42"' "$vendor_root/PROVENANCE.json"
grep -q '"nirs4all-io-core": "bba1ad4235d55ea3d88cfe0bdf4dd65c17120863"' "$vendor_root/PROVENANCE.json"
grep -q '"nirs4all-io-dagml": "263b40cc2b8227df5429418a4384829087f40e5a"' "$vendor_root/PROVENANCE.json"
grep -q '"sha256": "7bc4fdc2c6ec748ab6028d1413b1d07e6415b3821b0c5061344403c72dc2caa8"' "$vendor_root/PROVENANCE.json"
grep -q '"sha256": "3e1905415dea85a7434832d3cd4a45f3a4642736a5afb48f5c6880cd799cf029"' "$vendor_root/PROVENANCE.json"
grep -q '"sha256": "3929446e1fa7a2111be58b4c899eedf2b61cfe4066e36b3641b1fbaa67b9414f"' "$vendor_root/PROVENANCE.json"
grep -q '"hashed_files": 478' "$vendor_root/PROVENANCE.json"

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
