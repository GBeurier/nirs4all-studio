"""Discovery and loading of the dag-ml-data C ABI cdylib.

The package does not bundle `dag_ml_data_capi` yet. The cdylib is located, in
order, from: an explicit path, the ``DAG_ML_DATA_CAPI_LIB`` environment
variable, a package-local ``.libs/`` directory (reserved for a future
cibuildwheel/auditwheel/delocate bundle), then the Cargo target directory of a
source checkout (honoring ``CARGO_TARGET_DIR``).
"""

from __future__ import annotations

import ctypes
import os
import sys
from pathlib import Path

from ._abi import configure_library


def _library_filename() -> str:
    if sys.platform == "darwin":
        return "libdag_ml_data_capi.dylib"
    if sys.platform == "win32":
        return "dag_ml_data_capi.dll"
    return "libdag_ml_data_capi.so"


def _candidate_paths() -> list[Path]:
    filename = _library_filename()
    candidates: list[Path] = []

    env_path = os.environ.get("DAG_ML_DATA_CAPI_LIB")
    if env_path:
        candidates.append(Path(env_path))

    # Reserved for a future bundled cdylib (cibuildwheel/auditwheel/delocate).
    candidates.append(Path(__file__).resolve().parent / ".libs" / filename)

    # Source-checkout convenience: locate the cdylib under the Cargo target dir.
    # parents[5] of .../crates/dag-ml-data-capi/bindings/python/dag_ml_data_provider/_library.py
    # is the workspace root; when pip-installed this is not a checkout and the
    # fallback is skipped (guarded by the workspace `Cargo.toml`).
    resolved = Path(__file__).resolve()
    workspace_root = resolved.parents[5] if len(resolved.parents) >= 6 else None

    target_dirs: list[Path] = []
    cargo_target = os.environ.get("CARGO_TARGET_DIR")
    if cargo_target:
        cargo_target_path = Path(cargo_target)
        if not cargo_target_path.is_absolute() and workspace_root is not None:
            # Cargo resolves a relative CARGO_TARGET_DIR against the workspace root,
            # not the current working directory.
            cargo_target_path = workspace_root / cargo_target_path
        target_dirs.append(cargo_target_path)
    if workspace_root is not None and (workspace_root / "Cargo.toml").is_file():
        target_dirs.append(workspace_root / "target")

    for target_dir in target_dirs:
        candidates.append(target_dir / "debug" / filename)
        candidates.append(target_dir / "release" / filename)

    return candidates


def find_capi_library() -> Path:
    """Returns the first existing candidate path for the C ABI cdylib.

    Raises ``FileNotFoundError`` with the searched locations if none is found.
    """
    candidates = _candidate_paths()
    for candidate in candidates:
        if candidate.is_file():
            return candidate
    searched = "\n  ".join(str(candidate) for candidate in candidates)
    raise FileNotFoundError(
        "could not locate the dag-ml-data C ABI cdylib "
        f"({_library_filename()}). Set DAG_ML_DATA_CAPI_LIB, pass "
        "library_path=..., or build it with "
        "`cargo build -p dag-ml-data-capi --lib`. Searched:\n  " + searched
    )


def load_library(library_path: str | Path | None = None) -> ctypes.CDLL:
    """Loads and configures the C ABI cdylib.

    When ``library_path`` is ``None`` the library is discovered via
    :func:`find_capi_library`.
    """
    path = Path(library_path) if library_path is not None else find_capi_library()
    return configure_library(ctypes.CDLL(str(path)))
