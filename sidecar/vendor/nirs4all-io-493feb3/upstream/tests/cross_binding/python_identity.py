#!/usr/bin/env python3
# SPDX-License-Identifier: CeCILL-2.1 OR AGPL-3.0-or-later
"""Load the wheel extension by absolute filename, without install/PYTHONPATH."""

from __future__ import annotations

import importlib.util
import json
import pathlib
import sys

native_path = pathlib.Path(sys.argv[1])
spec_path = pathlib.Path(sys.argv[2])
module_spec = importlib.util.spec_from_file_location("nirs4all_io._native", native_path)
if module_spec is None or module_spec.loader is None:
    raise RuntimeError(f"cannot load {native_path}")
native = importlib.util.module_from_spec(module_spec)
module_spec.loader.exec_module(native)
summary = native.load_summary(str(spec_path), None, None)
sys.stdout.write(json.dumps(summary, ensure_ascii=False, sort_keys=True, indent=2, allow_nan=False) + "\n")
