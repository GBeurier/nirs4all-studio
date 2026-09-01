from __future__ import annotations

import importlib.util
import os
import sys
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]
PYTHON_SRC = ROOT / "bindings/python/src"
if str(PYTHON_SRC) not in sys.path:
    sys.path.insert(0, str(PYTHON_SRC))

SCRIPT = ROOT / "scripts/e2e/run_custom_app_host.py"
SPEC = importlib.util.spec_from_file_location("run_custom_app_host", SCRIPT)
assert SPEC is not None
assert SPEC.loader is not None
runner = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(runner)


def test_configure_methods_runtime_env_points_to_sibling_dev_release(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    core_root = tmp_path / "nirs4all-core"
    methods_lib = tmp_path / "nirs4all-methods/build/dev-release/cpp/src"
    methods_lib.mkdir(parents=True)
    monkeypatch.setattr(runner, "ROOT", core_root)
    monkeypatch.setenv("LD_LIBRARY_PATH", "/usr/lib")
    monkeypatch.delenv("PLS4ALL_LIB_PATH", raising=False)
    monkeypatch.delenv("N4M_LIB_PATH", raising=False)

    runner._configure_methods_runtime_env()

    assert os.environ["PLS4ALL_LIB_PATH"] == str(methods_lib)
    assert os.environ["N4M_LIB_PATH"] == str(methods_lib)
    assert os.environ["LD_LIBRARY_PATH"].split(os.pathsep)[:2] == [str(methods_lib), "/usr/lib"]


def test_configure_methods_runtime_env_is_noop_without_methods_build(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(runner, "ROOT", tmp_path / "nirs4all-core")
    monkeypatch.delenv("PLS4ALL_LIB_PATH", raising=False)
    monkeypatch.delenv("N4M_LIB_PATH", raising=False)
    monkeypatch.delenv("LD_LIBRARY_PATH", raising=False)

    runner._configure_methods_runtime_env()

    assert "PLS4ALL_LIB_PATH" not in os.environ
    assert "N4M_LIB_PATH" not in os.environ
    assert "LD_LIBRARY_PATH" not in os.environ
