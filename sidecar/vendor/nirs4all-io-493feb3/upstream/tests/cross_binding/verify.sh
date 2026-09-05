#!/usr/bin/env bash
# SPDX-License-Identifier: CeCILL-2.1 OR AGPL-3.0-or-later
# IO-XLG-001 strict entrypoint. No binding is silently skipped: the JSON report
# records passed/refused/unavailable and this command closes only on six passed.
set -euo pipefail

io_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
python_bin="${N4IO_QUALIFIER_PYTHON:-python3}"
exec "${python_bin}" "${io_root}/tests/cross_binding/qualification.py" "$@"
