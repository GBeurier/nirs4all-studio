#!/usr/bin/env bash
# bump_version.sh — nirs4all-core version source-of-truth syncer.
#
# nirs4all-core has no Cargo workspace.package version (the workspace only
# pins the shared edition/license/repository), and every binding manifest
# carries its own hardcoded version string. To keep them from drifting we
# elect the Rust crate manifest as the single source of truth:
#
#       SoT = bindings/rust/nirs4all/Cargo.toml  ([package] version)
#
# (scripts/build-matlab-package.sh already derives the MATLAB/Octave archive
# version from this same file, so the SoT was already de-facto here.)
#
# The SoT value is propagated to every other binding manifest, translating the
# spelling each ecosystem requires:
#
#   * Cargo / npm : the SoT verbatim, e.g. `0.1.0` (or `0.1.0-alpha.1`).
#                   bindings/rust/nirs4all/Cargo.toml (SoT),
#                   bindings/wasm/package.json + package-lock.json.
#   * PEP 440     : `0.1.0a1` for `0.1.0-alpha.1`; `0.1.0b2` / `0.1.0rc1` for
#                   beta / rc; plain `X.Y.Z` maps to itself.
#                   bindings/python/pyproject.toml and the Python
#                   nirs4all_core.__version__ surface.
#   * Python ABI   : bindings/python-native/Cargo.toml keeps the same Cargo
#                   version as the public aggregate to make wheel provenance
#                   unambiguous.
#   * R           : the plain base `X.Y.Z` for a final release; `X.Y.Z.9000`
#                   (the canonical R "in-development toward X.Y.Z" spelling)
#                   for ANY pre-release — CRAN does not accept SemVer
#                   pre-release suffixes. bindings/r/DESCRIPTION.
#
# Usage:
#   scripts/bump_version.sh                # sync manifests to the SoT (idempotent)
#   scripts/bump_version.sh --check        # exit 1 if any manifest drifts from the SoT
#   scripts/bump_version.sh --bump X.Y.Z[-pre]   # rewrite the SoT then sync
#   scripts/bump_version.sh --help
#
# Requires: bash >= 4, GNU sed, python3 (for the JSON manifests; no external
# Python deps).

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOT_TOML="${ROOT}/bindings/rust/nirs4all/Cargo.toml"

if [[ ! -f "${SOT_TOML}" ]]; then
    echo "error: SoT Cargo.toml not found at ${SOT_TOML}" >&2
    exit 2
fi

# ---------------------------------------------------------------------------
# 1. Read the canonical version from the Rust crate [package] version
# ---------------------------------------------------------------------------
read_sot_version() {
    local value
    value=$(sed -nE '/^\[package\]/,/^\[/{s/^version[[:space:]]*=[[:space:]]*"([^"]+)".*/\1/p}' \
            "${SOT_TOML}" | head -n1 || true)
    if [[ -z "${value}" ]]; then
        echo "error: could not parse [package] version from ${SOT_TOML}" >&2
        exit 2
    fi
    printf '%s' "${value}"
}

# ---------------------------------------------------------------------------
# 2. Spelling translators (Cargo SemVer is the canonical input)
# ---------------------------------------------------------------------------
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
    to_pep440 "${NEW_VERSION}" >/dev/null   # validate the pre-release translates
    sed -i -E "/^\[package\]/,/^\[/{s/^(version[[:space:]]*=[[:space:]]*\")[^\"]+(\")/\1${NEW_VERSION}\2/}" \
        "${SOT_TOML}"
    echo "  bumped Rust crate [package] version to ${NEW_VERSION}"
    MODE="sync"
fi

# ---------------------------------------------------------------------------
# 5. Re-read the SoT (post --bump if any) and derive the three spellings
# ---------------------------------------------------------------------------
CARGO_VERSION="$(read_sot_version)"
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
            return 0
        fi
        sed -i -E "${replace}" "${abs}"
        echo "  updated ${rel}: ${found} -> ${expected}"
    fi
}

# ---------------------------------------------------------------------------
# 7. The manifest table — every downstream version string lives here.
# ---------------------------------------------------------------------------

# --- Cargo.lock local crate package entries (Cargo/SemVer spelling verbatim) --
mapfile -t local_lock_versions < <(
    python3 - "${ROOT}/Cargo.lock" <<'PY'
import re
import sys

with open(sys.argv[1], "r", encoding="utf-8") as handle:
    text = handle.read()
versions = {}
for block in re.findall(r'\[\[package\]\]\n(?:[^\[]|\[(?!\[))*', text):
    name = re.search(r'^name = "([^"]+)"$', block, re.MULTILINE)
    version = re.search(r'^version = "([^"]+)"$', block, re.MULTILINE)
    if name and version:
        versions[name.group(1)] = version.group(1)
for name in ("nirs4all", "nirs4all-core-python-native", "nirs4all-core-wasm-native"):
    print(f"{name}={versions.get(name, '')}")
PY
)
lock_drift=0
for entry in "${local_lock_versions[@]}"; do
    package_name="${entry%%=*}"
    lock_ver="${entry#*=}"
    if [[ "${lock_ver}" != "${CARGO_VERSION}" ]]; then
        lock_drift=1
        if [[ "${MODE}" == "check" ]]; then
            echo "  DRIFT: Cargo.lock ${package_name} reports '${lock_ver}' (expected '${CARGO_VERSION}')" >&2
        fi
    fi
done
if [[ "${MODE}" == "check" ]]; then
    if [[ ${lock_drift} -ne 0 ]]; then
        DRIFTED+=("Cargo.lock")
        EXIT_CODE=1
    fi
else
    if [[ ${lock_drift} -ne 0 ]]; then
        python3 - "${ROOT}/Cargo.lock" "${CARGO_VERSION}" <<'PY'
import re
import sys

path, version = sys.argv[1], sys.argv[2]
text = open(path, "r", encoding="utf-8").read()

def update(match: re.Match[str]) -> str:
    block = match.group(0)
    names = (
        'name = "nirs4all"',
        'name = "nirs4all-core-python-native"',
        'name = "nirs4all-core-wasm-native"',
    )
    if not any(name in block for name in names):
        return block
    return re.sub(r'version = "[^"]+"', f'version = "{version}"', block, count=1)

updated = re.sub(r'\[\[package\]\]\n(?:[^\[]|\[(?!\[))*', update, text)
if updated != text:
    open(path, "w", encoding="utf-8").write(updated)
PY
        echo "  updated Cargo.lock local packages -> ${CARGO_VERSION}"
    fi
fi

# --- npm package.json (Cargo/SemVer spelling verbatim) ---------------------
update_with_sed \
    "bindings/wasm/package.json" \
    "${CARGO_VERSION}" \
    "^[[:space:]]*\"version\":[[:space:]]*\"([0-9A-Za-z.-]+)\"" \
    "s/^([[:space:]]*\"version\":[[:space:]]*\")[0-9A-Za-z.-]+(\")/\1${CARGO_VERSION}\2/"

# package-lock.json carries the root version twice (top-level + packages."").
if [[ "${MODE}" != "check" ]]; then
    python3 - "${ROOT}/bindings/wasm/package-lock.json" "${CARGO_VERSION}" <<'PY'
import json
import sys

path, version = sys.argv[1], sys.argv[2]
with open(path, "r", encoding="utf-8") as handle:
    data = json.load(handle)
root = (data.get("packages") or {}).get("", {})
changed = data.get("version") != version or root.get("version") != version
if changed:
    data["version"] = version
    data.setdefault("packages", {}).setdefault("", {})["version"] = version
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(data, handle, indent=2)
        handle.write("\n")
    print(f"  updated bindings/wasm/package-lock.json root versions -> {version}")
PY
fi
# Validate the lockfile's root version under --check.
if [[ "${MODE}" == "check" ]]; then
    lock_ver=$(sed -nE '0,/"version":/{s/^[[:space:]]*"version":[[:space:]]*"([0-9A-Za-z.-]+)".*/\1/p}' \
               "${ROOT}/bindings/wasm/package-lock.json" | head -n1 || true)
    if [[ "${lock_ver}" != "${CARGO_VERSION}" ]]; then
        echo "  DRIFT: bindings/wasm/package-lock.json reports '${lock_ver}' (expected '${CARGO_VERSION}')" >&2
        DRIFTED+=("bindings/wasm/package-lock.json")
        EXIT_CODE=1
    fi
    root_lock_ver=$(
        python3 - "${ROOT}/bindings/wasm/package-lock.json" <<'PY'
import json
import sys

with open(sys.argv[1], "r", encoding="utf-8") as handle:
    data = json.load(handle)
print((data.get("packages") or {}).get("", {}).get("version", ""))
PY
    )
    if [[ "${root_lock_ver}" != "${CARGO_VERSION}" ]]; then
        echo "  DRIFT: bindings/wasm/package-lock.json packages.\"\" reports '${root_lock_ver}' (expected '${CARGO_VERSION}')" >&2
        DRIFTED+=("bindings/wasm/package-lock.json")
        EXIT_CODE=1
    fi
fi

# --- PEP 440 target --------------------------------------------------------
update_with_sed \
    "bindings/wasm-native/Cargo.toml" \
    "${CARGO_VERSION}" \
    "^version[[:space:]]*=[[:space:]]*\"([0-9A-Za-z.-]+)\"" \
    "s/^(version[[:space:]]*=[[:space:]]*\")[0-9A-Za-z.-]+(\")/\1${CARGO_VERSION}\2/"

update_with_sed \
    "bindings/python-native/Cargo.toml" \
    "${CARGO_VERSION}" \
    "^version[[:space:]]*=[[:space:]]*\"([0-9A-Za-z.-]+)\"" \
    "s/^(version[[:space:]]*=[[:space:]]*\")[0-9A-Za-z.-]+(\")/\1${CARGO_VERSION}\2/"

update_with_sed \
    "bindings/python/pyproject.toml" \
    "${PEP440_VERSION}" \
    "^version[[:space:]]*=[[:space:]]*\"([0-9A-Za-z.+!-]+)\"" \
    "s/^(version[[:space:]]*=[[:space:]]*\")[0-9A-Za-z.+!-]+(\")/\1${PEP440_VERSION}\2/"

update_with_sed \
    "bindings/python/src/nirs4all_core/__init__.py" \
    "${PEP440_VERSION}" \
    "^__version__[[:space:]]*=[[:space:]]*\"([0-9A-Za-z.+!-]+)\"" \
    "s/^(__version__[[:space:]]*=[[:space:]]*\")[0-9A-Za-z.+!-]+(\")/\1${PEP440_VERSION}\2/"

# --- R DESCRIPTION target --------------------------------------------------
update_with_sed \
    "bindings/r/DESCRIPTION" \
    "${R_VERSION}" \
    "^Version:[[:space:]]+([0-9.]+)" \
    "s/^(Version:[[:space:]]+)[0-9.]+/\1${R_VERSION}/"

# ---------------------------------------------------------------------------
# 8. Summary
# ---------------------------------------------------------------------------
if [[ "${MODE}" == "check" ]]; then
    if [[ ${EXIT_CODE} -eq 0 ]]; then
        echo "  OK: every manifest is in sync with the Rust crate version (${CARGO_VERSION})"
    else
        echo "" >&2
        echo "FAIL: ${#DRIFTED[@]} manifest(s) drifted from the Rust crate version." >&2
        echo "      Run scripts/bump_version.sh to re-sync." >&2
    fi
fi
exit ${EXIT_CODE}
