#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
vendor_root="$script_dir/../vendor/nirs4all-core-3a3ce72"
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
test "$(sed -n 's/^version = "\([^"]*\)"/\1/p' "$vendor_root/upstream/bindings/rust/nirs4all/Cargo.toml" | head -n 1)" = "0.3.25"
grep -q 'n4m = { version = "=0.1.3"' "$vendor_root/upstream/bindings/rust/nirs4all/Cargo.toml"
grep -q '"commit": "3a3ce728cebf001ad25b20b3eeaed3bc76daf32f"' "$vendor_root/PROVENANCE.json"
grep -q '"repository_tree": "57e8203bf33a6c7b0b3f049f0dcbf3efa28991b1"' "$vendor_root/PROVENANCE.json"
grep -q '"nirs4all": "e6076fcc4b9deb89d9fe79ae21c972143a311dd4"' "$vendor_root/PROVENANCE.json"
grep -q '"sha256": "dd62b13cb8249e982033ae312a345a60ff3c92315f6982d5cf5466c263f869a6"' "$vendor_root/PROVENANCE.json"
grep -q '"hashed_files": 250' "$vendor_root/PROVENANCE.json"

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
