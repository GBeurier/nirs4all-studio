#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
vendor_root="$script_dir/../vendor/nirs4all-core-1dffd9f"
lock="$script_dir/../Cargo.lock"
inventory="$vendor_root/INVENTORY.sha256"
actual=$(mktemp)
expected=$(mktemp)
trap 'rm -f "$actual" "$expected"' EXIT HUP INT TERM

test -f "$vendor_root/upstream/nirs4all-0.4.7"/Cargo.toml
test -f "$vendor_root/upstream/nirs4all-0.4.7"/Cargo.toml.orig
test -f "$vendor_root/upstream/nirs4all-0.4.7"/Cargo.lock
test -f "$vendor_root/upstream/nirs4all-0.4.7"/.cargo_vcs_info.json
test "$(sed -n 's/^version = "\([^"]*\)"/\1/p' "$vendor_root/upstream/nirs4all-0.4.7"/Cargo.toml | head -n 1)" = "0.4.7"
grep -q '"sha1": "1dffd9f4472551cc09ad9d99ed9d40814bd003cc"' "$vendor_root/upstream/nirs4all-0.4.7"/.cargo_vcs_info.json
grep -q '"nirs4all": "34df15ad83a459b4d96a5fa3b9684614587fdc5a"' "$vendor_root/PROVENANCE.json"
grep -q '"sha256": "85610ceb9ea2f1111db1137ae1f7e58ce132d71c3eb31f04944495fc83403394"' "$vendor_root/PROVENANCE.json"
grep -A2 -x 'name = "nirs4all"' "$lock" | grep -qx 'version = "0.4.7"'
grep -qx 'checksum = "85610ceb9ea2f1111db1137ae1f7e58ce132d71c3eb31f04944495fc83403394"' "$lock"
grep -q '"commit": "1dffd9f4472551cc09ad9d99ed9d40814bd003cc"' "$vendor_root/PROVENANCE.json"
grep -q '"repository_tree": "3990c98a44a49c2c3827f61daad78915e33e948a"' "$vendor_root/PROVENANCE.json"
grep -q '"hashed_files": 58' "$vendor_root/PROVENANCE.json"

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
