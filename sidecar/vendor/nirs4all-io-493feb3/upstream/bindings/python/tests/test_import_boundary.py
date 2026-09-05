# SPDX-License-Identifier: CeCILL-2.1 OR AGPL-3.0-or-later
"""Importing the binding must not import `nirs4all` (the lazy SpectroDataset
adapter is the only touch-point, imported at call time). Runs in a subprocess so
module state is pristine."""
import subprocess
import sys


def test_import_does_not_load_nirs4all():
    code = (
        "import nirs4all_io, sys\n"
        "leaked = sorted(m for m in sys.modules "
        "if m == 'nirs4all' or m.startswith('nirs4all.'))\n"
        "assert not leaked, leaked\n"
    )
    subprocess.run([sys.executable, "-c", code], check=True)
