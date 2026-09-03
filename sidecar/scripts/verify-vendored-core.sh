#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
vendor_root="$script_dir/../vendor/nirs4all-core-6b25b63"
inventory="$vendor_root/INVENTORY.sha256"
actual=$(mktemp)
expected=$(mktemp)
trap 'rm -f "$actual" "$expected"' EXIT HUP INT TERM

test -f "$vendor_root/upstream/Cargo.toml"
test -f "$vendor_root/upstream/Cargo.lock"
test -f "$vendor_root/upstream/bindings/rust/nirs4all/src/archive_v2.rs"
test -f "$vendor_root/upstream/bindings/rust/nirs4all/src/native_methods_replay.rs"
grep -q 'preflight_methods_archive_v2_library' "$vendor_root/upstream/bindings/rust/nirs4all/src/lib.rs"
grep -q 'inspect_methods_archive_v2_predictors' "$vendor_root/upstream/bindings/rust/nirs4all/src/lib.rs"
grep -q 'train_dataset_package_methods_conformal_archive_v2' "$vendor_root/upstream/bindings/rust/nirs4all/src/lib.rs"
test "$(sed -n 's/^version = "\([^"]*\)"/\1/p' "$vendor_root/upstream/bindings/rust/nirs4all/Cargo.toml" | head -n 1)" = "0.3.25"
grep -q 'n4m = { version = "=0.1.4"' "$vendor_root/upstream/bindings/rust/nirs4all/Cargo.toml"
grep -q '"commit": "6b25b63bb09adfe3c4dae8ffacc90d09a1a81e16"' "$vendor_root/PROVENANCE.json"
grep -q '"repository_tree": "11344243884a24aeec75f73e0469f23721c76978"' "$vendor_root/PROVENANCE.json"
grep -q '"nirs4all": "d7a696b41ee0197a970d2a5dad9ae5a371a755a2"' "$vendor_root/PROVENANCE.json"
grep -q '"sha256": "e28b4792f5a8c0763f6bab6944f3cf5a3d84b5de249d70afcc12a1ac29315cf6"' "$vendor_root/PROVENANCE.json"
grep -q '"hashed_files": 251' "$vendor_root/PROVENANCE.json"

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
