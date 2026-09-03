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
cp -R bindings/matlab/LICENSES "$tmp_dir/nirs4all/"
cp bindings/matlab/LICENSING.md "$tmp_dir/nirs4all/"
cp bindings/matlab/THIRD_PARTY_NOTICES.md "$tmp_dir/nirs4all/"

# ZIP stores wall-clock mtimes and host-specific extra fields by default.  Pin
# all entries to SOURCE_DATE_EPOCH (or the ZIP epoch when it is unset), omit
# those extra fields, and feed a byte-sorted file list so repeated release
# builds are byte-for-byte identical.
source_date_epoch="${SOURCE_DATE_EPOCH:-315532800}"
case "$source_date_epoch" in
  ''|*[!0-9]*)
    echo "SOURCE_DATE_EPOCH must be an integer Unix timestamp" >&2
    exit 2
    ;;
esac
if (( source_date_epoch < 315532800 )); then
  echo "SOURCE_DATE_EPOCH must be on or after 1980-01-01 for ZIP" >&2
  exit 2
fi

find "$tmp_dir/nirs4all" -type f -exec touch -d "@$source_date_epoch" {} +
(
  cd "$tmp_dir"
  find nirs4all -type f -print | LC_ALL=C sort | TZ=UTC zip -q -X "$archive_path" -@
)
echo "$archive_path"
