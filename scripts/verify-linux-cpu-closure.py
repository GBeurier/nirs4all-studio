"""Qualify the Linux CPU runtime without optional system Numba thread pools."""

from __future__ import annotations

import argparse
import datetime
import json
import os
import platform
import re
import subprocess
import sys
import tempfile
from pathlib import Path

# These are the Linux C/C++ ABI dependencies of the supported desktop baseline.
# Scientific libraries must otherwise resolve within the bundled runtime.
SYSTEM_ABI = frozenset(
    {
        "ld-linux-x86-64.so.2",
        "libc.so.6",
        "libm.so.6",
        "libpthread.so.0",
        "libdl.so.2",
        "librt.so.1",
        "libutil.so.1",
        "libgcc_s.so.1",
        "libstdc++.so.6",
        "libcrypt.so.1",
        "libz.so.1",
        "libresolv.so.2",
    }
)
OPTIONAL_MISSING = {
    "lib/python3.11/site-packages/numba/np/ufunc/tbbpool.cpython-311-x86_64-linux-gnu.so": frozenset({"libtbb.so.12"}),
    "lib/python3.11/site-packages/numba/np/ufunc/omppool.cpython-311-x86_64-linux-gnu.so": frozenset({"libgomp.so.1.0.0"}),
}


def validate_dependencies(relative: str, output: str, runtime_root: Path) -> list[str]:
    """Reject all missing dependencies except the exact optional file/name pairs."""
    optional = []
    for raw in output.splitlines():
        line = raw.strip()
        if not line or line.startswith("linux-vdso."):
            continue
        missing = re.fullmatch(r"(\S+) => not found", line)
        if missing:
            name = missing[1]
            if name not in OPTIONAL_MISSING.get(relative, frozenset()):
                raise ValueError(f"Required ELF dependency missing: {relative}: {name}")
            optional.append(name)
            continue
        resolved = re.fullmatch(r"(\S+) => (/.*?) \(0x[0-9a-f]+\)", line)
        loader = re.fullmatch(r"(/\S+) \(0x[0-9a-f]+\)", line)
        if resolved:
            name, filename = resolved[1], resolved[2]
        elif loader:
            filename = loader[1]
            name = Path(filename).name
        else:
            raise ValueError(f"Unrecognized ELF dependency result: {relative}: {line}")
        location = Path(filename).resolve()
        if not location.is_relative_to(runtime_root) and name not in SYSTEM_ABI:
            raise ValueError(f"Unbundled scientific dependency: {relative}: {name}: {location}")
    return optional


def scan_runtime(runtime_root: Path) -> dict:
    checked = 0
    optional = {}
    for filename in sorted(runtime_root.rglob("*")):
        if not filename.is_file():
            continue
        with filename.open("rb") as source:
            if source.read(4) != b"\x7fELF":
                continue
        relative = filename.relative_to(runtime_root).as_posix()
        dynamic = subprocess.check_output(["readelf", "-d", str(filename)], text=True, env={"PATH": "/usr/bin:/bin", "LC_ALL": "C"})
        if "(NEEDED)" not in dynamic:
            checked += 1
            continue
        # Wheel-local dependencies (e.g. Arrow/Pillow) and PBS's own RPATH.
        environment = {"PATH": "/usr/bin:/bin", "LC_ALL": "C", "LD_LIBRARY_PATH": f"{filename.parent}:{runtime_root / 'lib'}"}
        result = subprocess.run(["ldd", str(filename)], env=environment, text=True, capture_output=True, timeout=15, check=False)
        output = result.stdout + result.stderr
        if result.returncode != 0:
            raise ValueError(f"ELF inspection failed for {relative}: {output.strip()}")
        missing = validate_dependencies(relative, output, runtime_root)
        if missing:
            optional[relative] = missing
        checked += 1
    if checked == 0:
        raise ValueError("No bundled ELF files were inspected")
    return {"elf_files_checked": checked, "optional_numba_backends_unavailable": optional}


def masked_system_paths() -> list[str]:
    output = subprocess.check_output(["/sbin/ldconfig", "-p"], text=True)
    paths = set()
    for line in output.splitlines():
        if re.match(r"\s*lib(?:tbb[^ ]*|gomp[^ ]*)\s", line) and "=>" in line:
            paths.add(str(Path(line.split("=>", 1)[1].strip()).resolve(strict=True)))
    return sorted(paths)


def inside_namespace(runtime_root: Path) -> dict:
    result = scan_runtime(runtime_root)
    probe = Path(__file__).with_name("probe-linux-cpu-threading.py")
    runs = []
    for mode, layer in [("shap", "default"), ("parallel", "default"), ("parallel", "tbb"), ("parallel", "omp"), ("parallel", "safe")]:
        environment = {
            "NUMBA_THREADING_LAYER": layer,
            "NUMBA_NUM_THREADS": "2",
            "MPLBACKEND": "Agg",
            "MPLCONFIGDIR": f"{os.environ['CPU_PROBE_CACHE']}/mpl",
            "XDG_CACHE_HOME": os.environ["CPU_PROBE_CACHE"],
        }
        completed = subprocess.run(
            [
                str(runtime_root / "bin/python3"),
                "-I",
                "-S",
                "-B",
                str(probe),
                str(runtime_root / "lib/python3.11/site-packages"),
                mode,
            ],
            env=environment,
            text=True,
            capture_output=True,
            timeout=120,
            check=False,
        )
        if completed.returncode != 0:
            raise ValueError(f"CPU probe failed ({mode}/{layer}): {completed.stdout}\n{completed.stderr}")
        record = json.loads(completed.stdout)
        if mode == "parallel":
            if layer == "default":
                if record.get("success") is not True or record.get("selected_layer") != "workqueue":
                    raise ValueError(f"Default CPU workqueue failed: {record}")
            elif record.get("success") is not False or "No threading layer could be loaded" not in record.get("error", ""):
                raise ValueError(f"Unsupported optional backend unexpectedly usable: {record}")
        runs.append({"mode": mode, "layer": layer, "result": record})
    return {**result, "runs": runs, "success": True}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--runtime-root", type=Path, required=True)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--inside-namespace", action="store_true", help=argparse.SUPPRESS)
    args = parser.parse_args()
    if sys.platform != "linux" or platform.machine() not in {"x86_64", "AMD64"}:
        raise ValueError("This CPU closure qualification targets Linux x64 only")
    root = args.runtime_root.resolve(strict=True)
    if args.inside_namespace:
        print(json.dumps(inside_namespace(root), sort_keys=True))
        return
    paths = masked_system_paths()
    with tempfile.TemporaryDirectory(prefix="studio-cpu-clean-") as cache:
        command = ["bwrap", "--ro-bind", "/", "/", "--proc", "/proc", "--dev", "/dev", "--unshare-net", "--unshare-pid", "--die-with-parent", "--tmpfs", cache]
        for filename in paths:
            command.extend(["--ro-bind", "/dev/null", filename])
        command.extend(["--", sys.executable, "-I", "-B", str(Path(__file__).resolve()), "--inside-namespace", "--runtime-root", str(root)])
        result = subprocess.run(command, env={"PATH": "/usr/bin:/bin", "CPU_PROBE_CACHE": cache}, text=True, capture_output=True, timeout=360, check=False)
    if result.returncode != 0:
        raise ValueError(f"Clean CPU qualification failed: {result.stdout}\n{result.stderr}")
    proof = {
        **json.loads(result.stdout),
        "platform": "linux-x64",
        "runtime_root": str(root),
        "network_namespace_isolated": True,
        "masked_system_library_files": paths,
        "verified_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),  # noqa: UP017 - Ubuntu 22.04 Python 3.10
        "contract": "Studio CPU calculations and default workqueue; explicit Numba tbb/omp/safe backends are optional and not guaranteed",
    }
    serialized = json.dumps(proof, indent=2) + "\n"
    if args.output:
        args.output.write_text(serialized)
    print(serialized, end="")


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, subprocess.SubprocessError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
