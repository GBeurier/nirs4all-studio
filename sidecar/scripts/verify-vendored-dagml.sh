#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
vendor_root="$script_dir/../vendor/dag-ml-233d4ec"
inventory="$vendor_root/INVENTORY.sha256"
actual=$(mktemp)
expected=$(mktemp)
trap 'rm -f "$actual" "$expected"' EXIT HUP INT TERM

facade="$vendor_root/upstream/dag-ml-0.3.25"
core="$vendor_root/upstream/dag-ml-core-0.3.25"
test -f "$facade/Cargo.toml"
test -f "$facade/Cargo.toml.orig"
test -f "$facade/.cargo_vcs_info.json"
test -f "$core/Cargo.toml"
test -f "$core/Cargo.toml.orig"
test -f "$core/.cargo_vcs_info.json"
test -f "$core/LICENSE"
grep -q 'version = "0.3.25"' "$facade/Cargo.toml"
grep -q 'version = "0.3.25"' "$core/Cargo.toml"
grep -q 'version = "0.1.4"' "$core/Cargo.toml"
grep -q '"sha1": "233d4ecdae14d2a810f9b01b4ce7c15bdedc9d27"' "$facade/.cargo_vcs_info.json"
grep -q '"sha1": "233d4ecdae14d2a810f9b01b4ce7c15bdedc9d27"' "$core/.cargo_vcs_info.json"
grep -q '"commit": "233d4ecdae14d2a810f9b01b4ce7c15bdedc9d27"' "$vendor_root/PROVENANCE.json"
grep -q '"repository_tree": "5cddf5a07aab796054a6bb6ce7332f2ea914b625"' "$vendor_root/PROVENANCE.json"
grep -q '"selected_release_commit": "233d4ecdae14d2a810f9b01b4ce7c15bdedc9d27"' "$vendor_root/PROVENANCE.json"
grep -q '"selected_release_repository_tree": "5cddf5a07aab796054a6bb6ce7332f2ea914b625"' "$vendor_root/PROVENANCE.json"
grep -q '"dag-ml": "bba3d934c7cc6488cca1557128e7ed24577bbd1e"' "$vendor_root/PROVENANCE.json"
grep -q '"dag-ml-core": "e1be900005a51db255cfdafaa5773075e223402a"' "$vendor_root/PROVENANCE.json"
grep -q '"sha256": "ec4476ba8c1ed27fad13259f9ce6e3e7e5fbc1049b1dc0116c6c6fd323eccf95"' "$vendor_root/PROVENANCE.json"
grep -q '"sha256": "8c53fda2a54d1d3d245848d02c2c851f75bd3f390e24450855654e5664e031d2"' "$vendor_root/PROVENANCE.json"
grep -q '"hashed_files": 95' "$vendor_root/PROVENANCE.json"

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
