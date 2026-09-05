#!/usr/bin/env python3
# SPDX-License-Identifier: CeCILL-2.1 OR AGPL-3.0-or-later
"""Executable IO-XLG-001 cross-language qualification matrix.

Every available host must materialize one identity-rich fixture through the
same Rust assembler and reproduce the frozen canonical summary byte-for-byte.
Missing runtimes are recorded as ``unavailable``; build, execution, or parity
failures are recorded as ``refused``. Only six ``passed`` rows close the gate.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import pathlib
import shutil
import subprocess
import sys
import tempfile
import zipfile
from collections.abc import Callable
from dataclasses import dataclass

ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from scripts.rust_reproducibility import reproducible_rust_env  # noqa: E402

FIXTURE = ROOT / "tests" / "cross_binding" / "corpus" / "identity.csv"
SPEC = ROOT / "tests" / "cross_binding" / "corpus" / "identity.spec.json"
GOLDEN = ROOT / "tests" / "cross_binding" / "identity.expected.canonical"
SURFACES = ("rust", "python", "wasm", "r", "matlab_octave", "c_abi")


def sha256(path: pathlib.Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def artifact(path: pathlib.Path, role: str) -> dict[str, object]:
    return {
        "role": role,
        "sha256": sha256(path),
        "size": path.stat().st_size,
    }


def executable(name: str, env_name: str | None = None) -> str | None:
    override = os.environ.get(env_name, "") if env_name else ""
    if override:
        candidate = pathlib.Path(override)
        return str(candidate) if candidate.is_file() and os.access(candidate, os.X_OK) else None
    return shutil.which(name)


def python_interpreter() -> str | None:
    candidates = [os.environ.get("N4IO_PYTHON", ""), "python3.13", "python3.12", "python3.11"]
    for candidate in candidates:
        if not candidate:
            continue
        resolved = candidate if pathlib.Path(candidate).is_file() else shutil.which(candidate)
        if not resolved:
            continue
        check = subprocess.run(
            [resolved, "-c", "import sys; raise SystemExit(sys.version_info < (3, 11))"],
            check=False,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        if check.returncode == 0:
            return resolved
    return None


def clean_env(target_dir: pathlib.Path) -> dict[str, str]:
    env = os.environ.copy()
    env.pop("PYTHONPATH", None)
    env.pop("VIRTUAL_ENV", None)
    env["PYTHONNOUSERSITE"] = "1"
    return reproducible_rust_env(ROOT, target_dir, env, extra_roots=(target_dir.parent,))


def sanitize_diagnostic(error: BaseException, work: pathlib.Path) -> str:
    message = str(error)
    replacements = {
        str(ROOT): "<SOURCE>",
        str(work): "<WORK>",
        str(pathlib.Path.home()): "<HOME>",
    }
    for before, after in sorted(replacements.items(), key=lambda item: len(item[0]), reverse=True):
        message = message.replace(before, after).replace(before.replace("/", "\\"), after)
    return message


def git_value(*args: str) -> str:
    return subprocess.run(["git", *args], cwd=ROOT, check=True, capture_output=True, text=True).stdout.strip()


def tool_versions() -> dict[str, str]:
    commands = {
        "cargo": executable("cargo"),
        "rustc": executable("rustc"),
        "maturin": executable("maturin", "N4IO_MATURIN"),
        "wasm_pack": executable("wasm-pack", "N4IO_WASM_PACK"),
        "node": executable("node", "N4IO_NODE"),
        "r": executable("R", "N4IO_R"),
        "rscript": executable("Rscript", "N4IO_RSCRIPT"),
        "octave": executable("octave", "N4IO_OCTAVE"),
        "matlab": executable("matlab", "N4IO_MATLAB"),
        "cc": executable("cc", "N4IO_CC"),
    }
    versions = {"python": sys.version.splitlines()[0]}
    for name, command in commands.items():
        if command is None:
            versions[name] = "unavailable"
            continue
        try:
            result = subprocess.run([command, "--version"], check=False, capture_output=True, text=True, timeout=10)
            output = (result.stdout or result.stderr).splitlines()
            versions[name] = output[0].strip() if output else "version-unreported"
        except (OSError, subprocess.TimeoutExpired):
            versions[name] = "version-unreported"
    return versions


@dataclass
class Context:
    work: pathlib.Path
    target: pathlib.Path
    env: dict[str, str]
    golden: bytes

    def run(
        self,
        command: list[str],
        *,
        cwd: pathlib.Path = ROOT,
        env: dict[str, str] | None = None,
        capture: bool = False,
    ) -> subprocess.CompletedProcess[bytes]:
        return subprocess.run(
            command,
            cwd=cwd,
            env=env or self.env,
            check=True,
            stdout=subprocess.PIPE if capture else subprocess.DEVNULL,
            stderr=subprocess.PIPE if capture else None,
        )

    def compare(self, output: bytes) -> None:
        if output != self.golden:
            raise RuntimeError(f"canonical summary mismatch (expected {hashlib.sha256(self.golden).hexdigest()}, got {hashlib.sha256(output).hexdigest()})")


def build_native(ctx: Context, packages: list[str], release: bool = False) -> None:
    cargo = executable("cargo")
    if not cargo:
        raise FileNotFoundError("cargo not found")
    command = [cargo, "build", "--locked"]
    if release:
        command.append("--release")
    for package in packages:
        command.extend(["-p", package])
    ctx.run(command)


def qualify_rust(ctx: Context) -> list[dict[str, object]]:
    if not executable("cargo"):
        raise FileNotFoundError("cargo not found")
    build_native(ctx, ["nirs4all-io-cli"])
    binary = ctx.target / "debug" / ("nirs4all-io.exe" if os.name == "nt" else "nirs4all-io")
    result = ctx.run([str(binary), "load", str(SPEC)], capture=True)
    ctx.compare(result.stdout)
    return [artifact(binary, "rust_cli")]


def qualify_c_abi(ctx: Context) -> list[dict[str, object]]:
    cc = executable("cc", "N4IO_CC")
    if not cc:
        raise FileNotFoundError("C compiler not found")
    build_native(ctx, ["nirs4all-io-capi"], release=True)
    suffix = ".dll" if os.name == "nt" else (".dylib" if sys.platform == "darwin" else ".so")
    prefix = "" if os.name == "nt" else "lib"
    library = ctx.target / "release" / f"{prefix}nirs4all_io_capi{suffix}"
    if not library.is_file():
        raise FileNotFoundError(f"C ABI library not produced: {library}")
    if os.name == "nt":
        raise FileNotFoundError("direct C qualification runner is not implemented for Windows")
    probe = ctx.work / "n4io-c-probe"
    ctx.run(
        [
            cc,
            "-std=c11",
            "-Wall",
            "-Wextra",
            "-Werror",
            f"-I{ROOT / 'crates/nirs4all-io-capi/include'}",
            str(ROOT / "tests/cross_binding/c_probe.c"),
            f"-L{ctx.target / 'release'}",
            f"-Wl,-rpath,{ctx.target / 'release'}",
            "-lnirs4all_io_capi",
            "-o",
            str(probe),
        ]
    )
    result = ctx.run([str(probe), json.dumps(str(SPEC))], capture=True)
    ctx.compare(result.stdout)
    return [artifact(library, "c_abi_cdylib"), artifact(probe, "c_abi_probe")]


def qualify_python(ctx: Context) -> list[dict[str, object]]:
    maturin = executable("maturin", "N4IO_MATURIN")
    python = python_interpreter()
    if not maturin:
        raise FileNotFoundError("maturin not found")
    if not python:
        raise FileNotFoundError("CPython >=3.11 not found")
    wheel_dir = ctx.work / "python-wheels"
    wheel_dir.mkdir(exist_ok=True)
    ctx.run(
        [maturin, "build", "--locked", "--release", "--interpreter", python, "-o", str(wheel_dir)],
        cwd=ROOT / "bindings/python",
    )
    wheels = sorted(wheel_dir.glob("*.whl"))
    if len(wheels) != 1:
        raise RuntimeError(f"expected one wheel, found {len(wheels)}")
    wheel = wheels[0]
    ctx.run([python, str(ROOT / "scripts/normalize_wheel.py"), str(wheel)])
    unpacked = ctx.work / "python-unpacked"
    with zipfile.ZipFile(wheel) as archive:
        archive.extractall(unpacked)
    native = next((unpacked / "nirs4all_io").glob("_native*"), None)
    if native is None:
        raise RuntimeError("wheel has no native extension")
    runner = ROOT / "tests/cross_binding/python_identity.py"
    result = ctx.run([python, str(runner), str(native), str(SPEC)], capture=True)
    ctx.compare(result.stdout)
    return [artifact(wheel, "python_wheel"), artifact(native, "python_extension")]


def qualify_wasm(ctx: Context) -> list[dict[str, object]]:
    wasm_pack = executable("wasm-pack", "N4IO_WASM_PACK")
    node = executable("node", "N4IO_NODE")
    if not wasm_pack:
        raise FileNotFoundError("wasm-pack not found")
    if not node:
        raise FileNotFoundError("Node.js not found")
    package = ctx.work / "wasm-pkg"
    ctx.run(
        [wasm_pack, "build", "--locked", "--release", "--target", "nodejs", "--out-dir", str(package)],
        cwd=ROOT / "bindings/wasm",
    )
    ctx.run([node, str(ROOT / "scripts/stage_wasm_package.mjs"), str(package)])
    js = package / "nirs4all_io_wasm.js"
    wasm = package / "nirs4all_io_wasm_bg.wasm"
    result = ctx.run(
        [node, str(ROOT / "tests/cross_binding/wasm_identity.cjs"), str(js), str(FIXTURE), str(SPEC)],
        capture=True,
    )
    ctx.compare(result.stdout)
    return [artifact(wasm, "wasm_module"), artifact(js, "wasm_node_loader")]


def qualify_r(ctx: Context) -> list[dict[str, object]]:
    r = executable("R", "N4IO_R")
    rscript = executable("Rscript", "N4IO_RSCRIPT")
    if not r or not rscript:
        raise FileNotFoundError("R and Rscript are required")
    dependency = subprocess.run(
        [rscript, "-e", "quit(status=if(requireNamespace('jsonlite',quietly=TRUE))0 else 42)"],
        env=ctx.env,
        check=False,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    if dependency.returncode != 0:
        raise FileNotFoundError("R package jsonlite is absent from the explicit runtime closure; the strict runner never downloads dependencies")
    library = ctx.work / "r-library"
    library.mkdir(exist_ok=True)
    env = ctx.env.copy()
    env["N4IO_R_VENDOR"] = "1"
    env["N4IO_R_LIB"] = str(library)
    ctx.run(["./configure"], cwd=ROOT / "bindings/r", env=env)
    install_env = env.copy()
    install_env["R_LIBS_USER"] = str(library)
    ctx.run([r, "CMD", "INSTALL", "--no-multiarch", f"--library={library}", str(ROOT / "bindings/r")], env=install_env)
    result = ctx.run(
        [
            rscript,
            "-e",
            "library(nirs4allio); cat(n4io_load_summary(commandArgs(TRUE)[1]))",
            json.dumps(str(SPEC)),
        ],
        env=install_env,
        capture=True,
    )
    ctx.compare(result.stdout)
    shared = next(library.glob("nirs4allio/libs/*nirs4allio*"), None)
    return [artifact(shared, "r_native_library")] if shared else []


def qualify_matlab_octave(ctx: Context) -> list[dict[str, object]]:
    octave = executable("octave", "N4IO_OCTAVE")
    matlab = executable("matlab", "N4IO_MATLAB")
    if not octave and not matlab:
        raise FileNotFoundError("neither Octave nor MATLAB found")
    build_native(ctx, ["nirs4all-io-capi"], release=True)
    env = ctx.env.copy()
    env["N4IO_INCLUDE"] = str(ROOT / "crates/nirs4all-io-capi/include")
    env["N4IO_CAPI_DIR"] = str(ctx.target / "release")
    env["N4IO_XLG_SPEC"] = str(SPEC)
    output = ctx.work / "matlab-octave.out"
    env["N4IO_XLG_OUTPUT"] = str(output)
    binding = ROOT / "bindings/matlab"
    if octave:
        ctx.run([octave, "--no-gui", "--norc", "--eval", "build"], cwd=binding, env=env)
        ctx.run(
            [
                octave,
                "--no-gui",
                "--norc",
                "--path",
                str(binding),
                "--eval",
                "run('tests/cross_binding/matlab_identity.m')",
            ],
            cwd=ROOT,
            env=env,
        )
    else:
        assert matlab is not None
        ctx.run([matlab, "-batch", f"cd('{binding.as_posix()}'); build"], env=env)
        runner = (ROOT / "tests/cross_binding/matlab_identity.m").as_posix()
        ctx.run([matlab, "-batch", f"addpath('{binding.as_posix()}'); run('{runner}')"], env=env)
    ctx.compare(output.read_bytes())
    mexes = list(binding.glob("n4io.mex*"))
    return [artifact(mexes[0], "matlab_octave_mex")] if mexes else []


QUALIFIERS: dict[str, Callable[[Context], list[dict[str, object]]]] = {
    "rust": qualify_rust,
    "python": qualify_python,
    "wasm": qualify_wasm,
    "r": qualify_r,
    "matlab_octave": qualify_matlab_octave,
    "c_abi": qualify_c_abi,
}


def validate_identity(summary: dict[str, object]) -> None:
    provenance = summary["identity"]["provenance"]  # type: ignore[index]
    expected = {
        "sample_id": "sample_id",
        "observation_id": "observation_id",
        "repetition_id": "repetition_id",
        "group_id": "group_id",
        "source_ids": ["data"],
    }
    if provenance != expected:
        raise ValueError(f"identity provenance drift: {provenance!r}")
    folds = summary.get("fold_provenance")
    if folds != [{"train_observation_ids": ["O0", "O2"], "validation_observation_ids": ["O1"]}]:
        raise ValueError(f"fold provenance drift: {folds!r}")


def finalize_report(rows: list[dict[str, object]]) -> dict[str, object]:
    by_surface = {str(row["surface"]): row for row in rows}
    complete = set(by_surface) == set(SURFACES) and all(by_surface[surface].get("disposition") == "passed" for surface in SURFACES)
    return {
        "schema_version": 1,
        "qualification": "IO-XLG-001",
        "contract": "assembled_dataset_summary_v2",
        "overall_complete": complete,
        "rows": [by_surface[surface] for surface in SURFACES],
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=pathlib.Path)
    parser.add_argument("--work-dir", type=pathlib.Path)
    parser.add_argument("--allow-incomplete", action="store_true")
    args = parser.parse_args(argv)

    dirty = git_value("status", "--porcelain=v1", "--untracked-files=all")
    if dirty:
        parser.error("IO-XLG-001 requires a clean source worktree; commit or remove all changes first")

    golden = GOLDEN.read_bytes()
    validate_identity(json.loads(golden))
    owned_work = args.work_dir is None
    temp = tempfile.TemporaryDirectory(prefix="n4io-xlg-") if owned_work else None
    work = pathlib.Path(temp.name) if temp else args.work_dir.resolve()
    work.mkdir(parents=True, exist_ok=True)
    target = work / "cargo-target"
    ctx = Context(work=work, target=target, env=clean_env(target), golden=golden)
    commit = git_value("rev-parse", "HEAD")
    tree = git_value("rev-parse", "HEAD^{tree}")
    evidence_paths = (
        pathlib.Path(__file__),
        ROOT / "tests/cross_binding/verify.sh",
        FIXTURE,
        SPEC,
        GOLDEN,
        ROOT / "Cargo.lock",
        ROOT / "bindings/python/Cargo.lock",
        ROOT / "bindings/wasm/Cargo.lock",
        ROOT / "bindings/r/Cargo.lock.rust",
    )
    initial_hashes = {path: sha256(path) for path in evidence_paths}
    versions = tool_versions()

    rows: list[dict[str, object]] = []
    for surface in SURFACES:
        try:
            artifacts = QUALIFIERS[surface](ctx)
            rows.append(
                {
                    "surface": surface,
                    "disposition": "passed",
                    "reason": "byte_exact_identity_summary",
                    "artifacts": artifacts,
                }
            )
        except FileNotFoundError as error:
            rows.append({"surface": surface, "disposition": "unavailable", "reason": sanitize_diagnostic(error, work), "artifacts": []})
        except (OSError, subprocess.CalledProcessError, RuntimeError, ValueError) as error:
            rows.append({"surface": surface, "disposition": "refused", "reason": sanitize_diagnostic(error, work), "artifacts": []})

    if git_value("status", "--porcelain=v1", "--untracked-files=all"):
        raise SystemExit("source worktree changed during IO-XLG-001; refusing mixed-state evidence")
    if git_value("rev-parse", "HEAD") != commit or git_value("rev-parse", "HEAD^{tree}") != tree:
        raise SystemExit("source identity changed during IO-XLG-001; refusing mixed-state evidence")
    final_hashes = {path: sha256(path) for path in evidence_paths}
    if final_hashes != initial_hashes:
        raise SystemExit("qualification inputs changed during IO-XLG-001; refusing mixed-state evidence")

    report = finalize_report(rows)
    report.update(
        {
            "source_commit": commit,
            "source_tree": tree,
            "source_dirty": False,
            "fixture_sha256": initial_hashes[FIXTURE],
            "spec_sha256": initial_hashes[SPEC],
            "expected_summary_sha256": initial_hashes[GOLDEN],
            "runner_sha256": initial_hashes[pathlib.Path(__file__)],
            "entrypoint_sha256": initial_hashes[ROOT / "tests/cross_binding/verify.sh"],
            "lockfiles": {
                str(path.relative_to(ROOT)): sha256(path)
                for path in (
                    ROOT / "Cargo.lock",
                    ROOT / "bindings/python/Cargo.lock",
                    ROOT / "bindings/wasm/Cargo.lock",
                    ROOT / "bindings/r/Cargo.lock.rust",
                )
            },
            "tool_versions": versions,
            "isolation": {
                "editable_install": False,
                "pythonpath": False,
                "sibling_checkout_dependency": False,
            },
        }
    )
    encoded = json.dumps(report, indent=2, sort_keys=True) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(encoded, encoding="utf-8")
    sys.stdout.write(encoded)
    if temp:
        temp.cleanup()
    return 0 if report["overall_complete"] or args.allow_incomplete else 2


if __name__ == "__main__":
    raise SystemExit(main())
