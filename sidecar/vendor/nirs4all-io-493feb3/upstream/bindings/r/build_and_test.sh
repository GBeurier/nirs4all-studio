#!/usr/bin/env bash
# SPDX-License-Identifier: CeCILL-2.1 OR AGPL-3.0-or-later
# Local dev helper: vendor the Rust core into the R package, install it from the
# self-contained tree (offline staticlib build), and run the smoke test. This is
# the SAME path CRAN / R-universe use — there is no prebuilt cdylib and no
# N4IO_CAPI_DIR anymore (the package vendors + compiles its own staticlib).
set -euo pipefail

pkg_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"   # bindings/r
io_root="$(cd "${pkg_dir}/../.." && pwd)"

# 1. Vendor the workspace core crates + cargo-vendor every crates.io dep into
#    bindings/r/src/rust/ (needs the repo crates/ + network, like the CI prep).
echo ">> N4IO_R_VENDOR=1 ./configure (vendoring the Rust core)"
( cd "${pkg_dir}" && N4IO_R_VENDOR=1 ./configure )

# Point the smoke's richer corpus checks at the checked-out goldens (the
# corpus-free native checks run regardless).
export N4IO_CORPUS="${io_root}/tests/goldens/contract/corpus"

# Force a clean compile so a stale/foreign-arch object is never reused.
rm -f "${pkg_dir}/src/"*.o "${pkg_dir}/src/"*.so "${pkg_dir}/src/"*.dll

lib="${install_lib:-$(mktemp -d)}"
mkdir -p "${lib}"
echo ">> installing R Imports -> ${lib}"
N4IO_R_LIB="${lib}" Rscript -e 'lib <- Sys.getenv("N4IO_R_LIB"); repos <- Sys.getenv("N4IO_R_REPOS", "https://cloud.r-project.org"); if (!"jsonlite" %in% rownames(installed.packages(lib.loc = lib))) install.packages("jsonlite", lib = lib, repos = repos)'
echo ">> R CMD INSTALL -> ${lib} (offline staticlib build via src/Makevars)"
R_LIBS_USER="${lib}:${R_LIBS_USER:-}" R CMD INSTALL --no-multiarch --library="${lib}" "${pkg_dir}"

echo ">> smoke"
R_LIBS_USER="${lib}:${R_LIBS_USER:-}" Rscript "${pkg_dir}/tests/smoke.R"
