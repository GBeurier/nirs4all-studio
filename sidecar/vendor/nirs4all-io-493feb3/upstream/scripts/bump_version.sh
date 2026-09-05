#!/usr/bin/env bash
# SPDX-License-Identifier: CeCILL-2.1 OR AGPL-3.0-or-later
#
# bump_version.sh — nirs4all-io version source-of-truth syncer.
#
# Reads the canonical workspace version from the root Cargo.toml
# ([workspace.package] version) and propagates it to every downstream
# binding manifest, translating the spelling each ecosystem requires.
#
# Usage:
#   scripts/bump_version.sh                # sync manifests to the SoT (idempotent)
#   scripts/bump_version.sh --check        # exit 1 if any manifest drifts from the SoT
#   scripts/bump_version.sh --bump X.Y.Z[-pre]   # rewrite the SoT then sync
#   scripts/bump_version.sh --help
#
# The single source of truth is the Cargo workspace version (Cargo SemVer,
# e.g. `0.1.0-alpha.1`). Three spellings are derived from it:
#
#   * Cargo   : the SoT verbatim, e.g. `0.1.0-alpha.1`  (or plain `0.1.0`).
#               Used by the root Cargo.toml [workspace.dependencies]
#               nirs4all-io-core / nirs4all-io internal-dep `version` (required
#               so the published crates resolve each other from crates.io),
#               bindings/python/Cargo.toml, bindings/wasm/Cargo.toml, the
#               self-contained workspace emitted by bindings/r/configure, and
#               every workspace-member package via `version.workspace = true`.
#               The npm package.json (bindings/wasm/pkg/) is a gitignored
#               wasm-pack build artifact, NOT a sync target — release-npm.yml
#               injects the SoT version into it at build time.
#   * PEP 440 : `0.1.0a1` for `0.1.0-alpha.1`; `0.1.0b2` / `0.1.0rc1` for
#               beta / rc; plain `X.Y.Z` maps to itself.
#               Used by src/nirs4all_io/_version.py (the root Python package).
#               NOTE: bindings/python/pyproject.toml is dynamic-from-Cargo
#               (`dynamic = ["version"]`, maturin reads bindings/python/Cargo.toml)
#               so it is NOT a sync target.
#   * R       : the plain base `X.Y.Z` for a final release; `X.Y.Z.9000`
#               (the canonical R "in-development toward X.Y.Z" spelling) for
#               ANY pre-release — CRAN does not accept SemVer pre-release
#               suffixes. Used by bindings/r/DESCRIPTION.
#
# Requires: bash >= 4, GNU sed, python3 (no external Python deps).

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CARGO_TOML="${ROOT}/Cargo.toml"

if [[ ! -f "${CARGO_TOML}" ]]; then
    echo "error: root Cargo.toml not found at ${CARGO_TOML}" >&2
    exit 2
fi

# ---------------------------------------------------------------------------
# 1. Read the canonical Cargo version from [workspace.package] version
# ---------------------------------------------------------------------------
read_workspace_version() {
    # Extract the `version = "…"` line inside the [workspace.package] table.
    local value
    value=$(sed -nE '/^\[workspace\.package\]/,/^\[/{s/^version[[:space:]]*=[[:space:]]*"([^"]+)".*/\1/p}' \
            "${CARGO_TOML}" | head -n1 || true)
    if [[ -z "${value}" ]]; then
        echo "error: could not parse [workspace.package] version from ${CARGO_TOML}" >&2
        exit 2
    fi
    printf '%s' "${value}"
}

find_python311() {
    local candidate
    for candidate in "${N4IO_VERSION_PYTHON:-}" python3.13 python3.12 python3.11 python3; do
        [[ -n "${candidate}" ]] || continue
        command -v "${candidate}" >/dev/null 2>&1 || continue
        if "${candidate}" -c 'import sys; raise SystemExit(sys.version_info < (3, 11))' 2>/dev/null; then
            printf '%s' "${candidate}"
            return 0
        fi
    done
    echo "error: Python >=3.11 is required for semantic Cargo TOML validation" >&2
    return 1
}

# ---------------------------------------------------------------------------
# 2. Spelling translators (Cargo SemVer is the canonical input)
# ---------------------------------------------------------------------------
# Cargo SemVer grammar accepted here: X.Y.Z optionally followed by a
# `-<pre>` identifier. The pre-release we translate is one of:
#   alpha[.N] | beta[.N] | rc[.N]   (the only ones the ecosystems map cleanly).
# Anything else with a `-` suffix is rejected so drift can't sneak through.

# to_pep440 <cargo_version> -> PEP 440 spelling
to_pep440() {
    local v="$1"
    local base="${v%%-*}"          # X.Y.Z
    if [[ ! "${base}" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
        echo "error: version base '${base}' is not X.Y.Z" >&2
        exit 2
    fi
    local pre=""
    [[ "${v}" == *-* ]] && pre="${v#*-}"
    if [[ -z "${pre}" ]]; then
        printf '%s' "${base}"
        return 0
    fi
    # The pre-release must be exactly alpha[.N] | beta[.N] | rc[.N] with a
    # canonical numeric N (no leading zeros). Reject anything else so we never
    # emit invalid / non-canonical PEP 440 (e.g. 'alpha.foo' -> 'afoo',
    # 'alpha.01' -> 'a01' which PyPI normalises to 'a1' and breaks tag↔version).
    if [[ ! "${pre}" =~ ^(alpha|beta|rc)(\.(0|[1-9][0-9]*))?$ ]]; then
        echo "error: unsupported pre-release '${pre}' (want alpha[.N]|beta[.N]|rc[.N], N canonical)" >&2
        exit 2
    fi
    local kind num
    kind="${pre%%.*}"
    if [[ "${pre}" == *.* ]]; then num="${pre#*.}"; else num="0"; fi
    case "${kind}" in
        alpha) printf '%sa%s'  "${base}" "${num}" ;;
        beta)  printf '%sb%s'  "${base}" "${num}" ;;
        rc)    printf '%src%s' "${base}" "${num}" ;;
    esac
}

# to_r <cargo_version> -> R DESCRIPTION spelling
to_r() {
    local v="$1"
    local base="${v%%-*}"          # X.Y.Z
    if [[ "${v}" == *-* ]]; then
        # Any pre-release → the canonical R "in development toward base" form.
        printf '%s.9000' "${base}"
    else
        printf '%s' "${base}"
    fi
}

# ---------------------------------------------------------------------------
# 3. CLI handling
# ---------------------------------------------------------------------------
MODE="sync"
NEW_VERSION=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        --check)  MODE="check"; shift ;;
        --bump)
            if [[ $# -lt 2 ]]; then
                echo "error: --bump requires X.Y.Z[-pre]" >&2
                exit 2
            fi
            MODE="bump"
            NEW_VERSION="$2"
            shift 2
            ;;
        -h|--help)
            sed -nE '2,/^$/{ s/^# ?//; /^!/!p }' "${BASH_SOURCE[0]}"
            exit 0
            ;;
        *) echo "error: unknown argument: $1" >&2; exit 2 ;;
    esac
done

# ---------------------------------------------------------------------------
# 4. --bump: rewrite the SoT first
# ---------------------------------------------------------------------------
if [[ "${MODE}" == "bump" ]]; then
    if [[ ! "${NEW_VERSION}" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.]+)?$ ]]; then
        echo "error: --bump requires X.Y.Z[-pre] (got: '${NEW_VERSION}')" >&2
        exit 2
    fi
    # Validate the pre-release translates (fails loudly before any write).
    to_pep440 "${NEW_VERSION}" >/dev/null
    # Rewrite ONLY the version inside [workspace.package].
    sed -i -E "/^\[workspace\.package\]/,/^\[/{s/^(version[[:space:]]*=[[:space:]]*\")[^\"]+(\")/\1${NEW_VERSION}\2/}" \
        "${CARGO_TOML}"
    echo "  bumped [workspace.package] version to ${NEW_VERSION}"
    MODE="sync"
fi

# ---------------------------------------------------------------------------
# 5. Re-read the SoT (post --bump if any) and derive the three spellings
# ---------------------------------------------------------------------------
CARGO_VERSION="$(read_workspace_version)"
PEP440_VERSION="$(to_pep440 "${CARGO_VERSION}")"
R_VERSION="$(to_r "${CARGO_VERSION}")"

if [[ "${MODE}" == "check" ]]; then
    echo "  canonical Cargo version : ${CARGO_VERSION}"
    echo "  derived PEP 440 version : ${PEP440_VERSION}"
    echo "  derived R version       : ${R_VERSION}"
else
    echo "  syncing manifests to Cargo=${CARGO_VERSION} / PEP440=${PEP440_VERSION} / R=${R_VERSION}"
fi

# ---------------------------------------------------------------------------
# 6. Manifest update / check engine
# ---------------------------------------------------------------------------
EXIT_CODE=0
DRIFTED=()

# update_with_sed <relative_path> <expected_value> <sed_match_regex> <sed_replace_regex>
#   sed_match_regex: must capture the version with group \1 (for --check extraction).
#   sed_replace_regex: full sed -E expression  s/MATCH/REPLACEMENT/.
update_with_sed() {
    local rel="$1" expected="$2" match="$3" replace="$4"
    local abs="${ROOT}/${rel}"

    if [[ ! -f "${abs}" ]]; then
        echo "  DRIFT: ${rel} missing (expected manifest)" >&2
        DRIFTED+=("${rel}")
        EXIT_CODE=1
        return 0
    fi

    local current
    current=$(grep -E "${match}" "${abs}" | head -n1 || true)
    if [[ -z "${current}" ]]; then
        echo "  DRIFT: ${rel} has no line matching /${match}/" >&2
        DRIFTED+=("${rel}")
        EXIT_CODE=1
        return 0
    fi

    local found
    found=$(printf '%s\n' "${current}" | sed -E "s|.*${match}.*|\1|" | head -n1)

    if [[ "${MODE}" == "check" ]]; then
        if [[ "${found}" != "${expected}" ]]; then
            echo "  DRIFT: ${rel} reports '${found}' (expected '${expected}')" >&2
            DRIFTED+=("${rel}")
            EXIT_CODE=1
        fi
    else
        if [[ "${found}" == "${expected}" ]]; then
            return 0  # already in sync
        fi
        sed -i -E "${replace}" "${abs}"
        echo "  updated ${rel}: ${found} → ${expected}"
    fi
}

# update_cargo_lock_package <relative_path> <package_name> <expected_version>
update_cargo_lock_package() {
    local rel="$1" package="$2" expected="$3"
    local abs="${ROOT}/${rel}"
    local current
    current=$(sed -nE "/^name = \"${package}\"$/,/^\[\[package\]\]/{s/^version[[:space:]]*=[[:space:]]*\"([^\"]+)\"/\1/p}" \
        "${abs}" | head -n1 || true)
    if [[ -z "${current}" ]]; then
        echo "  DRIFT: ${rel} has no package '${package}'" >&2
        DRIFTED+=("${rel}:${package}")
        EXIT_CODE=1
    elif [[ "${MODE}" == "check" && "${current}" != "${expected}" ]]; then
        echo "  DRIFT: ${rel} package '${package}' reports '${current}' (expected '${expected}')" >&2
        DRIFTED+=("${rel}:${package}")
        EXIT_CODE=1
    elif [[ "${MODE}" != "check" && "${current}" != "${expected}" ]]; then
        sed -i -E "/^name = \"${package}\"$/,/^\[\[package\]\]/{s/^(version[[:space:]]*=[[:space:]]*\")[^\"]+(\")/\1${expected}\2/}" \
            "${abs}"
        echo "  updated ${rel}:${package}: ${current} → ${expected}"
    fi
}

# ---------------------------------------------------------------------------
# 7. The manifest table — every downstream version string lives here.
# ---------------------------------------------------------------------------

# --- Cargo SemVer targets (the SoT spelling verbatim) ----------------------

# Internal workspace dep versions in the root Cargo.toml [workspace.dependencies].
# These carry an explicit `version` (alongside `path`) so the published crates
# resolve each other from crates.io; the value MUST track the workspace version.
update_with_sed \
    "Cargo.toml" \
    "${CARGO_VERSION}" \
    "^nirs4all-io-core[[:space:]]*=.*version[[:space:]]*=[[:space:]]*\"([0-9A-Za-z.-]+)\"" \
    "s/^(nirs4all-io-core[[:space:]]*=.*version[[:space:]]*=[[:space:]]*\")[0-9A-Za-z.-]+(\")/\1${CARGO_VERSION}\2/"

update_with_sed \
    "Cargo.toml" \
    "${CARGO_VERSION}" \
    "^nirs4all-io[[:space:]]*=.*version[[:space:]]*=[[:space:]]*\"([0-9A-Za-z.-]+)\"" \
    "s/^(nirs4all-io[[:space:]]*=.*version[[:space:]]*=[[:space:]]*\")[0-9A-Za-z.-]+(\")/\1${CARGO_VERSION}\2/"

# Python PyO3 crate (bindings/python/Cargo.toml: line  version = "X.Y.Z[-pre]")
update_with_sed \
    "bindings/python/Cargo.toml" \
    "${CARGO_VERSION}" \
    "^version[[:space:]]*=[[:space:]]*\"([0-9A-Za-z.-]+)\"" \
    "s/^(version[[:space:]]*=[[:space:]]*\")[0-9A-Za-z.-]+(\")/\1${CARGO_VERSION}\2/"

# WASM crate (bindings/wasm/Cargo.toml)
update_with_sed \
    "bindings/wasm/Cargo.toml" \
    "${CARGO_VERSION}" \
    "^version[[:space:]]*=[[:space:]]*\"([0-9A-Za-z.-]+)\"" \
    "s/^(version[[:space:]]*=[[:space:]]*\")[0-9A-Za-z.-]+(\")/\1${CARGO_VERSION}\2/"

# R source packages generate a self-contained vendored Rust workspace at
# configure time. Its three literal versions are executable release metadata,
# not documentation, and must follow the Cargo source of truth as well.
update_with_sed \
    "bindings/r/configure" \
    "${CARGO_VERSION}" \
    "^version[[:space:]]*=[[:space:]]*\"([0-9A-Za-z.-]+)\"" \
    "s/^(version[[:space:]]*=[[:space:]]*\")[0-9A-Za-z.-]+(\")/\1${CARGO_VERSION}\2/"

update_with_sed \
    "bindings/r/configure" \
    "${CARGO_VERSION}" \
    "^nirs4all-io-core[[:space:]]*=.*version[[:space:]]*=[[:space:]]*\"([0-9A-Za-z.-]+)\"" \
    "s/^(nirs4all-io-core[[:space:]]*=.*version[[:space:]]*=[[:space:]]*\")[0-9A-Za-z.-]+(\")/\1${CARGO_VERSION}\2/"

update_with_sed \
    "bindings/r/configure" \
    "${CARGO_VERSION}" \
    "^nirs4all-io[[:space:]]*=.*version[[:space:]]*=[[:space:]]*\"([0-9A-Za-z.-]+)\"" \
    "s/^(nirs4all-io[[:space:]]*=.*version[[:space:]]*=[[:space:]]*\")[0-9A-Za-z.-]+(\")/\1${CARGO_VERSION}\2/"

for package in nirs4all-io-core nirs4all-io nirs4all-io-capi; do
    update_cargo_lock_package "bindings/r/Cargo.lock.rust" "${package}" "${CARGO_VERSION}"
done

for rel in \
    "crates/nirs4all-io-core/Cargo.toml" \
    "crates/nirs4all-io/Cargo.toml" \
    "crates/nirs4all-io-capi/Cargo.toml" \
    "crates/nirs4all-io-cli/Cargo.toml" \
    "crates/nirs4all-io-dagml/Cargo.toml"
do
    if ! grep -Eq "^version\\.workspace[[:space:]]*=[[:space:]]*true" "${ROOT}/${rel}"; then
        if [[ "${MODE}" == "check" ]]; then
            echo "  DRIFT: ${rel} must use version.workspace = true" >&2
            DRIFTED+=("${rel}")
            EXIT_CODE=1
        else
            sed -i -E 's/^version[[:space:]]*=[[:space:]]*"[^"]+"/version.workspace = true/' "${ROOT}/${rel}"
            echo "  updated ${rel}: version.workspace = true"
        fi
    fi
done

# NOTE: bindings/wasm/pkg/package.json is a wasm-pack BUILD ARTIFACT — the whole
# pkg/ directory is gitignored (bindings/wasm/pkg/.gitignore is `*`), so it is
# NOT in version control and is absent on a fresh checkout. release-npm.yml
# injects the canonical SoT version into the generated pkg-node/package.json at
# build time (the "Pin package.json name + version" step reads the Cargo SoT),
# so there is nothing to sync here.

# --- PEP 440 target --------------------------------------------------------

# Root Python package version string (src/nirs4all_io/_version.py).
# bindings/python/pyproject.toml is dynamic-from-Cargo (maturin reads
# bindings/python/Cargo.toml), so it is intentionally NOT listed here.
update_with_sed \
    "src/nirs4all_io/_version.py" \
    "${PEP440_VERSION}" \
    "^__version__[[:space:]]*=[[:space:]]*\"([0-9A-Za-z.+!-]+)\"" \
    "s/^(__version__[[:space:]]*=[[:space:]]*\")[0-9A-Za-z.+!-]+(\")/\1${PEP440_VERSION}\2/"

# --- R DESCRIPTION target --------------------------------------------------

# R DESCRIPTION (Version: X.Y.Z[.9000])
update_with_sed \
    "bindings/r/DESCRIPTION" \
    "${R_VERSION}" \
    "^Version:[[:space:]]+([0-9.]+)" \
    "s/^(Version:[[:space:]]+)[0-9.]+/\1${R_VERSION}/"

# ---------------------------------------------------------------------------
# 8. Summary
# ---------------------------------------------------------------------------
if [[ "${MODE}" == "check" ]]; then
    N4IO_CHECK_PYTHON="$(find_python311)"
    if ! "${N4IO_CHECK_PYTHON}" "${ROOT}/scripts/check_r_reduced_workspace.py" --root "${ROOT}"; then
        DRIFTED+=("bindings/r/reduced-workspace")
        EXIT_CODE=1
    fi
    if [[ ${EXIT_CODE} -eq 0 ]]; then
        echo "  OK: every manifest is in sync with the Cargo workspace version (${CARGO_VERSION})"
    else
        echo "" >&2
        echo "FAIL: ${#DRIFTED[@]} manifest(s) drifted from the Cargo workspace version." >&2
        echo "      Run scripts/bump_version.sh to re-sync." >&2
    fi
fi
exit ${EXIT_CODE}
