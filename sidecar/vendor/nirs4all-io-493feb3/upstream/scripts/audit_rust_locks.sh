#!/usr/bin/env bash
# SPDX-License-Identifier: CeCILL-2.1 OR AGPL-3.0-or-later
#
# Audit every independently resolved Rust dependency graph shipped by this
# repository.  A clean root lock does not cover the Python, WASM, or reduced R
# workspaces, so omitting one of these files can hide binding-only advisories.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly lock_files=(
  "Cargo.lock"
  "bindings/python/Cargo.lock"
  "bindings/wasm/Cargo.lock"
  "bindings/r/Cargo.lock.rust"
)

for lock_file in "${lock_files[@]}"; do
  if [[ ! -f "${repo_root}/${lock_file}" ]]; then
    echo "missing required Rust lockfile: ${lock_file}" >&2
    exit 1
  fi
  echo ">> cargo audit --file ${lock_file}"
  cargo audit --file "${repo_root}/${lock_file}"
done
