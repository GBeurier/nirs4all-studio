#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
vendor_root="$script_dir/../vendor/nirs4all-io-172a7ac"
lock="$script_dir/../Cargo.lock"
inventory="$vendor_root/INVENTORY.sha256"
actual=$(mktemp)
expected=$(mktemp)
trap 'rm -f "$actual" "$expected"' EXIT HUP INT TERM

test -f "$vendor_root/upstream/nirs4all-io-0.2.14"/Cargo.toml
test -f "$vendor_root/upstream/nirs4all-io-0.2.14"/Cargo.toml.orig
test -f "$vendor_root/upstream/nirs4all-io-0.2.14"/Cargo.lock
test -f "$vendor_root/upstream/nirs4all-io-0.2.14"/.cargo_vcs_info.json
test "$(sed -n 's/^version = "\([^"]*\)"/\1/p' "$vendor_root/upstream/nirs4all-io-0.2.14"/Cargo.toml | head -n 1)" = "0.2.14"
grep -q '"sha1": "172a7acfcc029742f45fbcf477f55f46dc7fbafe"' "$vendor_root/upstream/nirs4all-io-0.2.14"/.cargo_vcs_info.json
grep -q '"nirs4all-io": "9fab67d2113e89ebbdb2f10f86c8a63d43603b38"' "$vendor_root/PROVENANCE.json"
grep -q '"sha256": "172a381c32a1009ac3719c0c915e6e897a157c897cc99077cb7100a7b8a02270"' "$vendor_root/PROVENANCE.json"
grep -A2 -x 'name = "nirs4all-io"' "$lock" | grep -qx 'version = "0.2.14"'
grep -qx 'checksum = "172a381c32a1009ac3719c0c915e6e897a157c897cc99077cb7100a7b8a02270"' "$lock"
test -f "$vendor_root/upstream/nirs4all-io-core-0.2.14"/Cargo.toml
test -f "$vendor_root/upstream/nirs4all-io-core-0.2.14"/Cargo.toml.orig
test -f "$vendor_root/upstream/nirs4all-io-core-0.2.14"/Cargo.lock
test -f "$vendor_root/upstream/nirs4all-io-core-0.2.14"/.cargo_vcs_info.json
test "$(sed -n 's/^version = "\([^"]*\)"/\1/p' "$vendor_root/upstream/nirs4all-io-core-0.2.14"/Cargo.toml | head -n 1)" = "0.2.14"
grep -q '"sha1": "172a7acfcc029742f45fbcf477f55f46dc7fbafe"' "$vendor_root/upstream/nirs4all-io-core-0.2.14"/.cargo_vcs_info.json
grep -q '"nirs4all-io-core": "ef1345d9dfcf1a9974d60ce60b8fef33930f3dc5"' "$vendor_root/PROVENANCE.json"
grep -q '"sha256": "37e99cd89ca38908afbf63d0a473eee38d15c48a39b323e224762cc50116575e"' "$vendor_root/PROVENANCE.json"
grep -A2 -x 'name = "nirs4all-io-core"' "$lock" | grep -qx 'version = "0.2.14"'
grep -qx 'checksum = "37e99cd89ca38908afbf63d0a473eee38d15c48a39b323e224762cc50116575e"' "$lock"
test -f "$vendor_root/upstream/nirs4all-io-dagml-0.2.14"/Cargo.toml
test -f "$vendor_root/upstream/nirs4all-io-dagml-0.2.14"/Cargo.toml.orig
test -f "$vendor_root/upstream/nirs4all-io-dagml-0.2.14"/Cargo.lock
test -f "$vendor_root/upstream/nirs4all-io-dagml-0.2.14"/.cargo_vcs_info.json
test "$(sed -n 's/^version = "\([^"]*\)"/\1/p' "$vendor_root/upstream/nirs4all-io-dagml-0.2.14"/Cargo.toml | head -n 1)" = "0.2.14"
grep -q '"sha1": "172a7acfcc029742f45fbcf477f55f46dc7fbafe"' "$vendor_root/upstream/nirs4all-io-dagml-0.2.14"/.cargo_vcs_info.json
grep -q '"nirs4all-io-dagml": "a3bae1bdadd5496e524c389c47e8ad0c22d95b0e"' "$vendor_root/PROVENANCE.json"
grep -q '"sha256": "3d85f5e796158badccde3a7581212fd5c1d6ab510c187f63b8a2d681af69160b"' "$vendor_root/PROVENANCE.json"
grep -A2 -x 'name = "nirs4all-io-dagml"' "$lock" | grep -qx 'version = "0.2.14"'
grep -qx 'checksum = "3d85f5e796158badccde3a7581212fd5c1d6ab510c187f63b8a2d681af69160b"' "$lock"
grep -q '"commit": "172a7acfcc029742f45fbcf477f55f46dc7fbafe"' "$vendor_root/PROVENANCE.json"
grep -q '"repository_tree": "b238838b7efec55a09de146fc5b103743f700787"' "$vendor_root/PROVENANCE.json"
grep -q '"hashed_files": 112' "$vendor_root/PROVENANCE.json"

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
