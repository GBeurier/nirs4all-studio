#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
vendor_root="$script_dir/../vendor/n4m-b246b50"
lock="$script_dir/../Cargo.lock"
inventory="$vendor_root/INVENTORY.sha256"
actual=$(mktemp)
expected=$(mktemp)
trap 'rm -f "$actual" "$expected"' EXIT HUP INT TERM

test -f "$vendor_root/upstream/n4m-0.4.1"/Cargo.toml
test -f "$vendor_root/upstream/n4m-0.4.1"/Cargo.toml.orig
test -f "$vendor_root/upstream/n4m-0.4.1"/Cargo.lock
test -f "$vendor_root/upstream/n4m-0.4.1"/.cargo_vcs_info.json
test "$(sed -n 's/^version = "\([^"]*\)"/\1/p' "$vendor_root/upstream/n4m-0.4.1"/Cargo.toml | head -n 1)" = "0.4.1"
grep -q '"sha1": "b246b5029cc62cf0cc369df2611069498f2da183"' "$vendor_root/upstream/n4m-0.4.1"/.cargo_vcs_info.json
grep -q '"n4m": "a2dd723826c6d0d3797b48b71e14d7f69b839044"' "$vendor_root/PROVENANCE.json"
grep -q '"sha256": "4d036a20611f734738741f0b70e8e0393a7fbf6dcf06bb41051a4eeae6d880b8"' "$vendor_root/PROVENANCE.json"
grep -A2 -x 'name = "n4m"' "$lock" | grep -qx 'version = "0.4.1"'
grep -qx 'checksum = "4d036a20611f734738741f0b70e8e0393a7fbf6dcf06bb41051a4eeae6d880b8"' "$lock"
grep -q '"commit": "b246b5029cc62cf0cc369df2611069498f2da183"' "$vendor_root/PROVENANCE.json"
grep -q '"repository_tree": "8c4b525882dc454d7a4dd1a805fb916b0d22e250"' "$vendor_root/PROVENANCE.json"
grep -q '"hashed_files": 15' "$vendor_root/PROVENANCE.json"

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
