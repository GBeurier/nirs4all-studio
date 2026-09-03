#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
vendor_root="$script_dir/../vendor/dag-ml-dafb8b6"
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
grep -q 'version = "0.1.4"' "$core/Cargo.toml"
grep -q '"sha1": "dafb8b6fb98f9d380d30559a3f4b868c91e5b5c4"' "$facade/.cargo_vcs_info.json"
grep -q '"sha1": "dafb8b6fb98f9d380d30559a3f4b868c91e5b5c4"' "$core/.cargo_vcs_info.json"
grep -q '"commit": "dafb8b6fb98f9d380d30559a3f4b868c91e5b5c4"' "$vendor_root/PROVENANCE.json"
grep -q '"repository_tree": "44a2c4a46911d2c49c33fe75418674bd0e129d5e"' "$vendor_root/PROVENANCE.json"
grep -q '"dag-ml": "bba3d934c7cc6488cca1557128e7ed24577bbd1e"' "$vendor_root/PROVENANCE.json"
grep -q '"dag-ml-core": "203cb17729225f1bafff5109f9a9c42c49838dd4"' "$vendor_root/PROVENANCE.json"
grep -q '"sha256": "8107c50a572f217fa7f9ad696d6eba30355d6a1dd4dc7d107b21979567cb92fe"' "$vendor_root/PROVENANCE.json"
grep -q '"sha256": "c87a28c7fccfac280a3337bebaebafae7b3df49fb86747d1d44048fd265b2036"' "$vendor_root/PROVENANCE.json"
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
