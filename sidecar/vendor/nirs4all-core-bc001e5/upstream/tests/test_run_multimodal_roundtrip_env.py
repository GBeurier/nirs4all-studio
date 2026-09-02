from __future__ import annotations

import importlib.util
import os
import subprocess
from pathlib import Path
from unittest import mock


ROOT = Path(__file__).resolve().parents[1]


def _load_module():
    path = ROOT / "scripts" / "e2e" / "run_multimodal_roundtrip.py"
    spec = importlib.util.spec_from_file_location("run_multimodal_roundtrip", path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_prepend_r_toolchain_env_keeps_existing_path(tmp_path: Path) -> None:
    module = _load_module()
    r_bin = tmp_path / "r-env" / "bin"
    r_bin.mkdir(parents=True)
    rscript = r_bin / "Rscript"
    rscript.write_text("#!/bin/sh\n", encoding="utf-8")
    env = {"PATH": "/usr/local/bin"}

    module._prepend_r_toolchain_env(env, str(rscript))

    assert env["PATH"].split(os.pathsep) == [str(r_bin), "/usr/local/bin"]


def test_prepend_r_library_env_preserves_existing_user_library(tmp_path: Path) -> None:
    module = _load_module()
    scenario_lib = tmp_path / "scenario-r-lib"
    env = {
        "R_LIBS": "/opt/site-r-lib",
        "R_LIBS_USER": "/home/runner/R/library",
    }

    module._prepend_r_library_env(env, scenario_lib)

    assert env["R_LIBS"].split(os.pathsep) == [str(scenario_lib), "/opt/site-r-lib"]
    assert env["R_LIBS_USER"].split(os.pathsep) == [str(scenario_lib), "/home/runner/R/library"]


def test_prepend_r_library_env_leaves_default_user_library_unset(tmp_path: Path) -> None:
    module = _load_module()
    scenario_lib = tmp_path / "scenario-r-lib"
    env: dict[str, str] = {}

    module._prepend_r_library_env(env, scenario_lib)

    assert env["R_LIBS"] == str(scenario_lib)
    assert "R_LIBS_USER" not in env


def test_prepare_r_library_uses_rscript_toolchain_path(tmp_path: Path) -> None:
    module = _load_module()
    workspace = tmp_path / "workspace"
    core = tmp_path / "core"
    artifacts = tmp_path / "artifacts"
    r_bin = tmp_path / "conda-r" / "bin"
    methods_r = workspace / "nirs4all-methods" / "bindings" / "r" / "n4m"
    generated = workspace / "nirs4all-methods" / "build" / "dev-release" / "generated"
    methods_lib_dir = workspace / "nirs4all-methods" / "build" / "dev-release" / "cpp" / "src"
    for path in (r_bin, methods_r, generated, methods_lib_dir, core / "bindings" / "r"):
        path.mkdir(parents=True)
    rscript = r_bin / "Rscript"
    r_cmd = r_bin / "R"
    rscript.write_text("#!/bin/sh\n", encoding="utf-8")
    r_cmd.write_text("#!/bin/sh\n", encoding="utf-8")
    methods_lib = methods_lib_dir / "libn4m.so"
    methods_lib.write_text("", encoding="utf-8")

    observed_paths: list[list[str]] = []

    def fake_run(*args, **kwargs):
        command = args[0]
        env = kwargs["env"]
        assert command[0] == str(r_cmd)
        observed_paths.append(env["PATH"].split(os.pathsep)[:2])
        assert env["N4M_R_LINK_PREBUILT"] == "1"
        assert env["N4M_LIB_DIR"] == str(methods_lib_dir)
        assert env["N4M_GENERATED_DIR"] == str(generated)
        assert env["N4M_INCLUDE_DIR"] == str(workspace / "nirs4all-methods" / "cpp" / "include")
        assert env["R_LIBS"].split(os.pathsep)[:2] == [str(artifacts / "_r-lib"), "/opt/site-r-lib"]
        assert env["R_LIBS_USER"].split(os.pathsep)[:2] == [
            str(artifacts / "_r-lib"),
            "/home/runner/R/library",
        ]
        assert env["R_MAKEVARS_USER"] == str(artifacts / "r-Makevars")
        assert env["NIRS4ALL_CORE_R_PARITY_LIB"] == str(artifacts / "_r-lib")
        return subprocess.CompletedProcess(command, 0, "", "")

    with (
        mock.patch.object(module, "_methods_lib_path", return_value=methods_lib),
        mock.patch.object(module.subprocess, "run", side_effect=fake_run),
        mock.patch.dict(
            os.environ,
            {
                "PATH": "/usr/bin",
                "NIRS4ALL_METHODS_ROOT": str(workspace / "nirs4all-methods"),
                "R_LIBS": "/opt/site-r-lib",
                "R_LIBS_USER": "/home/runner/R/library",
            },
            clear=False,
        ),
    ):
        r_lib, error = module._prepare_r_library(workspace, core, artifacts, str(rscript))

    assert error is None
    assert r_lib == artifacts / "_r-lib"
    assert observed_paths == [[str(r_bin), str(methods_lib_dir)], [str(r_bin), str(methods_lib_dir)]]
    assert (artifacts / "r-Makevars").read_text(encoding="utf-8").splitlines()[:2] == ["CC=gcc", "CXX=g++"]


def test_methods_root_honors_environment_override(tmp_path: Path) -> None:
    module = _load_module()
    configured = tmp_path / "methods"

    with mock.patch.dict(os.environ, {"NIRS4ALL_METHODS_ROOT": str(configured)}, clear=False):
        assert module._methods_root(tmp_path / "workspace") == configured.resolve()
