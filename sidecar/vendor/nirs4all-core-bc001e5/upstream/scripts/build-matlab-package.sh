#!/usr/bin/env bash
set -euo pipefail

out_dir="${1:-dist/matlab}"
# Version source of truth: the Rust crate [package] version (kept in sync across
# bindings by scripts/bump_version.sh).
version="$(sed -nE '/^\[package\]/,/^\[/{s/^version[[:space:]]*=[[:space:]]*"([^"]+)".*/\1/p}' bindings/rust/nirs4all/Cargo.toml | head -1)"
version="${version:-0.0.0}"
archive="nirs4all-matlab-octave-${version}.zip"

mkdir -p "$out_dir"
case "$out_dir" in
  /*) archive_path="$out_dir/$archive" ;;
  *) archive_path="$PWD/$out_dir/$archive" ;;
esac
tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

mkdir -p "$tmp_dir/nirs4all"
cp -R bindings/matlab/+nirs4all "$tmp_dir/nirs4all/"
cp bindings/matlab/README.md "$tmp_dir/nirs4all/"
cp bindings/matlab/LICENSE "$tmp_dir/nirs4all/"

(cd "$tmp_dir" && zip -qr "$archive_path" nirs4all)
echo "$archive_path"
