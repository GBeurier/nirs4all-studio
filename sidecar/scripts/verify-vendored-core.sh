#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
vendor_root="$script_dir/../vendor/nirs4all-core-57fee01"
inventory="$vendor_root/INVENTORY.sha256"
actual=$(mktemp)
expected=$(mktemp)
trap 'rm -f "$actual" "$expected"' EXIT HUP INT TERM

test -f "$vendor_root/upstream/Cargo.toml"
test -f "$vendor_root/upstream/Cargo.lock"
test -f "$vendor_root/upstream/bindings/wasm/package-lock.json"
test -f "$vendor_root/upstream/bindings/rust/nirs4all/src/archive_v2.rs"
test -f "$vendor_root/upstream/bindings/rust/nirs4all/src/native_methods_replay.rs"
grep -q 'preflight_methods_archive_v2_library' "$vendor_root/upstream/bindings/rust/nirs4all/src/lib.rs"
grep -q 'inspect_methods_archive_v2_predictors' "$vendor_root/upstream/bindings/rust/nirs4all/src/lib.rs"
grep -q 'train_dataset_package_methods_conformal_archive_v2' "$vendor_root/upstream/bindings/rust/nirs4all/src/lib.rs"
test "$(sed -n 's/^version = "\([^"]*\)"/\1/p' "$vendor_root/upstream/bindings/rust/nirs4all/Cargo.toml" | head -n 1)" = "0.3.30"
grep -q 'n4m = { version = "=0.1.4"' "$vendor_root/upstream/bindings/rust/nirs4all/Cargo.toml"
grep -q '"commit": "57fee01ca5477856d5ede53cac56cc21b361cb31"' "$vendor_root/PROVENANCE.json"
grep -q '"repository_tree": "2b84921d86d4f14811ab5d6d94d1bac99cf34a2c"' "$vendor_root/PROVENANCE.json"
grep -q '"nirs4all": "cfdef4276f81fbb4e340e02a0db1e6faba5c57dc"' "$vendor_root/PROVENANCE.json"
grep -q '"sha256": "da33681fd164c7320b3c53c2f992be993d529d2abdc9b4d25626014deeb35f52"' "$vendor_root/PROVENANCE.json"
grep -q '"hashed_files": 258' "$vendor_root/PROVENANCE.json"

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
