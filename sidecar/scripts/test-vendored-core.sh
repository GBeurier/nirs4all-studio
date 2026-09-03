#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
manifest="$script_dir/../vendor/nirs4all-core-94d712f/upstream/Cargo.toml"
target_dir="$script_dir/../target"

CARGO_TARGET_DIR="$target_dir" cargo test --manifest-path "$manifest" --workspace --locked
