#!/usr/bin/env bash
# SPDX-License-Identifier: CECILL-2.1 OR AGPL-3.0-or-later
# Build the MATLAB/Octave source package with commit-derived timestamps.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ -n "$(git -C "${ROOT}" status --porcelain=v1 --untracked-files=all)" ]]; then
    echo "error: MATLAB/Octave release archives require a clean source worktree" >&2
    exit 2
fi
OUT_ARG="${1:-${ROOT}/dist}"
mkdir -p "${OUT_ARG}"
OUT_DIR="$(cd "${OUT_ARG}" && pwd)"
COMMIT=$(git -C "${ROOT}" rev-parse HEAD)
TREE=$(git -C "${ROOT}" rev-parse HEAD^{tree})

VERSION=$(sed -nE '/^\[workspace\.package\]/,/^\[/{s/^version[[:space:]]*=[[:space:]]*"([^"]+)".*/\1/p}' \
    "${ROOT}/Cargo.toml" | head -n1)
if [[ -z "${VERSION}" ]]; then
    echo "error: could not read the workspace version" >&2
    exit 2
fi

PREFIX="nirs4all-io-matlab-octave-${VERSION}"
ARCHIVE="${OUT_DIR}/${PREFIX}.zip"
EPOCH=$(git -C "${ROOT}" log -1 --format=%ct "${COMMIT}")
BUILD_DIR=$(mktemp -d)
trap 'rm -rf -- "${BUILD_DIR}"' EXIT

mkdir -p "${BUILD_DIR}/stage/${PREFIX}/LICENSES"
git -C "${ROOT}" archive --format=tar "${COMMIT}":bindings/matlab \
    -o "${BUILD_DIR}/matlab.tar"
tar -xf "${BUILD_DIR}/matlab.tar" -C "${BUILD_DIR}/stage/${PREFIX}"

install -m 0644 "${ROOT}/LICENSE" "${BUILD_DIR}/stage/${PREFIX}/LICENSE"
install -m 0644 "${ROOT}/LICENSING.md" "${BUILD_DIR}/stage/${PREFIX}/LICENSING.md"
install -m 0644 "${ROOT}/THIRD_PARTY_NOTICES.md" \
    "${BUILD_DIR}/stage/${PREFIX}/THIRD_PARTY_NOTICES.md"
install -m 0644 "${ROOT}/COPY_PROVENANCE.md" \
    "${BUILD_DIR}/stage/${PREFIX}/COPY_PROVENANCE.md"
install -m 0644 "${ROOT}"/LICENSES/* "${BUILD_DIR}/stage/${PREFIX}/LICENSES/"

if [[ -n "$(git -C "${ROOT}" status --porcelain=v1 --untracked-files=all)" ]] || \
   [[ "$(git -C "${ROOT}" rev-parse HEAD)" != "${COMMIT}" ]] || \
   [[ "$(git -C "${ROOT}" rev-parse HEAD^{tree})" != "${TREE}" ]]; then
    echo "error: source worktree changed during MATLAB/Octave archive assembly" >&2
    exit 2
fi

# Use Python's pinned writer contract instead of the host `zip` implementation:
# fixed order, timestamp, permissions, compression level, and empty extras.
rm -f -- "${ARCHIVE}"
python3 "${ROOT}/scripts/write_deterministic_zip.py" \
    "${BUILD_DIR}/stage/${PREFIX}" "${ARCHIVE}" "${EPOCH}"

sha256sum "${ARCHIVE}"
