#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
manifest="$script_dir/../vendor/nirs4all-core-57fee01/upstream/Cargo.toml"
target_dir=$(mktemp -d)
trap 'rm -rf "$target_dir"' EXIT HUP INT TERM

if [ -z "${N4M_LIBRARY_PATH:-}" ] || [ ! -f "$N4M_LIBRARY_PATH" ]; then
  echo "N4M_LIBRARY_PATH must name the qualified ABI 2.5 libn4m binary" >&2
  exit 2
fi

CARGO_TARGET_DIR="$target_dir" cargo test --manifest-path "$manifest" --workspace --locked
