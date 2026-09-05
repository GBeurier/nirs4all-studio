# SPDX-License-Identifier: CeCILL-2.1 OR AGPL-3.0-or-later
"""Story 6.5: importing nirs4all_io (and running load on non-SpectroDataset targets)
must NOT import the heavy nirs4all modelling library. Only
``load(..., target="spectrodataset")`` may lazily import it."""

from __future__ import annotations

import subprocess
import sys


def _run(code: str) -> None:
    # subprocess gives a clean sys.modules (a parity test elsewhere may import nirs4all)
    res = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True)
    assert res.returncode == 0, res.stdout + res.stderr


def test_import_does_not_import_nirs4all():
    _run(
        "import sys, nirs4all_io\n"
        "leaked = [m for m in sys.modules if m == 'nirs4all' or m.startswith('nirs4all.')]\n"
        "assert not leaked, f'import nirs4all_io leaked nirs4all modules: {leaked}'\n"
    )


def test_assembled_load_does_not_import_nirs4all():
    _run(
        "import sys, numpy as np, nirs4all_io as nio\n"
        "nio.load((np.zeros((4, 3)), np.arange(4)), target='assembled')\n"
        "leaked = [m for m in sys.modules if m == 'nirs4all' or m.startswith('nirs4all.')]\n"
        "assert not leaked, f'assembled load leaked nirs4all: {leaked}'\n"
    )
