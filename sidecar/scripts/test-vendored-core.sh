#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
manifest="$script_dir/../vendor/nirs4all-core-45e1/upstream/Cargo.toml"

cargo test --manifest-path "$manifest" --workspace
