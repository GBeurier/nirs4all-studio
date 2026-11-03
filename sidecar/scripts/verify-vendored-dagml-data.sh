#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
vendor_root="$script_dir/../vendor/dag-ml-data-eb2ad78"
lock="$script_dir/../Cargo.lock"
inventory="$vendor_root/INVENTORY.sha256"
actual=$(mktemp)
expected=$(mktemp)
trap 'rm -f "$actual" "$expected"' EXIT HUP INT TERM

test -f "$vendor_root/upstream/dag-ml-data-0.2.16"/Cargo.toml
test -f "$vendor_root/upstream/dag-ml-data-0.2.16"/Cargo.toml.orig
test -f "$vendor_root/upstream/dag-ml-data-0.2.16"/Cargo.lock
test -f "$vendor_root/upstream/dag-ml-data-0.2.16"/.cargo_vcs_info.json
test "$(sed -n 's/^version = "\([^"]*\)"/\1/p' "$vendor_root/upstream/dag-ml-data-0.2.16"/Cargo.toml | head -n 1)" = "0.2.16"
grep -q '"sha1": "eb2ad7835ca85feebf6f626d9f43f61575a1c9a9"' "$vendor_root/upstream/dag-ml-data-0.2.16"/.cargo_vcs_info.json
grep -q '"dag-ml-data": "8542e62591146efe9250362d00557cb946a92b75"' "$vendor_root/PROVENANCE.json"
grep -q '"sha256": "f57a340d701cc08eadbc0c5b1745dd46d76b91aba1a68a718be4adc4abc77adc"' "$vendor_root/PROVENANCE.json"
grep -A2 -x 'name = "dag-ml-data"' "$lock" | grep -qx 'version = "0.2.16"'
grep -qx 'checksum = "f57a340d701cc08eadbc0c5b1745dd46d76b91aba1a68a718be4adc4abc77adc"' "$lock"
test -f "$vendor_root/upstream/dag-ml-data-core-0.2.16"/Cargo.toml
test -f "$vendor_root/upstream/dag-ml-data-core-0.2.16"/Cargo.toml.orig
test -f "$vendor_root/upstream/dag-ml-data-core-0.2.16"/Cargo.lock
test -f "$vendor_root/upstream/dag-ml-data-core-0.2.16"/.cargo_vcs_info.json
test "$(sed -n 's/^version = "\([^"]*\)"/\1/p' "$vendor_root/upstream/dag-ml-data-core-0.2.16"/Cargo.toml | head -n 1)" = "0.2.16"
grep -q '"sha1": "eb2ad7835ca85feebf6f626d9f43f61575a1c9a9"' "$vendor_root/upstream/dag-ml-data-core-0.2.16"/.cargo_vcs_info.json
grep -q '"dag-ml-data-core": "16d810b4feb1768c8676bc5b46c5247a5de3a08b"' "$vendor_root/PROVENANCE.json"
grep -q '"sha256": "2b422140ba492c707ba776403ccb613a4f371f6a64bc1af3adfc2af7d883b2fc"' "$vendor_root/PROVENANCE.json"
grep -A2 -x 'name = "dag-ml-data-core"' "$lock" | grep -qx 'version = "0.2.16"'
grep -qx 'checksum = "2b422140ba492c707ba776403ccb613a4f371f6a64bc1af3adfc2af7d883b2fc"' "$lock"
test -f "$vendor_root/upstream/dag-ml-data-provider-0.2.16"/Cargo.toml
test -f "$vendor_root/upstream/dag-ml-data-provider-0.2.16"/Cargo.toml.orig
test -f "$vendor_root/upstream/dag-ml-data-provider-0.2.16"/Cargo.lock
test -f "$vendor_root/upstream/dag-ml-data-provider-0.2.16"/.cargo_vcs_info.json
test "$(sed -n 's/^version = "\([^"]*\)"/\1/p' "$vendor_root/upstream/dag-ml-data-provider-0.2.16"/Cargo.toml | head -n 1)" = "0.2.16"
grep -q '"sha1": "eb2ad7835ca85feebf6f626d9f43f61575a1c9a9"' "$vendor_root/upstream/dag-ml-data-provider-0.2.16"/.cargo_vcs_info.json
grep -q '"dag-ml-data-provider": "6bab41e5199e15be16fbf6c2858b1ab68eabc18a"' "$vendor_root/PROVENANCE.json"
grep -q '"sha256": "48268bd5b790a5512b71aca85617729d3bad83fea3a0368e257291e3ace2f781"' "$vendor_root/PROVENANCE.json"
grep -A2 -x 'name = "dag-ml-data-provider"' "$lock" | grep -qx 'version = "0.2.16"'
grep -qx 'checksum = "48268bd5b790a5512b71aca85617729d3bad83fea3a0368e257291e3ace2f781"' "$lock"
grep -q '"commit": "eb2ad7835ca85feebf6f626d9f43f61575a1c9a9"' "$vendor_root/PROVENANCE.json"
grep -q '"repository_tree": "8bbccfcf7194f33eea6df14c9bb64bea2e262d63"' "$vendor_root/PROVENANCE.json"
grep -q '"hashed_files": 40' "$vendor_root/PROVENANCE.json"

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
