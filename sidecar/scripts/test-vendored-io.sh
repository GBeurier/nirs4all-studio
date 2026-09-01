#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
manifest="$script_dir/../vendor/nirs4all-io-f419/upstream/Cargo.toml"
target_dir=$(mktemp -d)
trap 'rm -rf "$target_dir"' EXIT HUP INT TERM

"$script_dir/verify-vendored-io.sh"
CARGO_TARGET_DIR="$target_dir" cargo fmt --all --check --manifest-path "$manifest"
CARGO_TARGET_DIR="$target_dir" cargo test --workspace --offline --locked --manifest-path "$manifest"
