#!/usr/bin/env bash
# SPDX-License-Identifier: CeCILL-2.1 OR AGPL-3.0-or-later
# Build the n4io MEX and smoke-test it with Octave (EPIC 11.3). MATLAB users run
# build.m + smoke.m the same way. SKIPs (exit 0) if octave is absent, so this is a
# no-op off-CI; the Octave CI leg (octave-binding.yml) provides octave.
set -euo pipefail

io_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

if ! command -v octave >/dev/null 2>&1; then
  echo "SKIP: octave not found; MATLAB/Octave binding smoke not run."
  exit 0
fi

echo ">> building nirs4all-io-capi (release)"
( cd "${io_root}" && cargo build -q -p nirs4all-io-capi --release )

export N4IO_INCLUDE="${io_root}/crates/nirs4all-io-capi/include"
export N4IO_CAPI_DIR="${io_root}/target/release"
export N4IO_CORPUS="${io_root}/tests/goldens/contract/corpus"

cd "${io_root}/bindings/matlab"
echo ">> mex build"
octave --no-gui --norc --eval "build"
echo ">> smoke"
octave --no-gui --norc --path "$(pwd)" --eval "run('smoke.m')"
