"""Build missing macOS Intel dependencies once in CI, never during user setup.

Prerequisites: native Intel macOS, Python 3.11+, Rust/Cargo, Xcode command-line
build tools, and ``python -m pip install maturin==1.14.1``. Uses only pinned
public sdists, their supplied Cargo.lock files and registry dependencies.
"""

import argparse
import email.parser
import hashlib
import importlib.metadata
import json
import os
import platform
import shutil
import subprocess
import sys
import tarfile
import tempfile
import tomllib
import urllib.request
import zipfile
from pathlib import Path


def sha256(path: Path) -> str:
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def verify_wheel(wheel: Path, package: dict) -> dict[str, str]:
    """Reject the wrong package/version or an incompatible architecture."""
    with zipfile.ZipFile(wheel) as archive:
        if archive.testzip() is not None:
            raise ValueError(f"Corrupt wheel: {wheel.name}")
        metadata_names = [name for name in archive.namelist() if name.endswith(".dist-info/METADATA")]
        if len(metadata_names) != 1:
            raise ValueError(f"Wheel must have one metadata record: {wheel.name}")
        metadata_name = metadata_names[0]
        metadata = email.parser.Parser().parsestr(archive.read(metadata_name).decode())
        if metadata["Name"].replace("_", "-").lower() != package["name"] or metadata["Version"] != package["version"]:
            raise ValueError(f"Wheel package/version does not match the source pin: {wheel.name}")
        wheel_metadata = email.parser.Parser().parsestr(archive.read(metadata_name.removesuffix("METADATA") + "WHEEL").decode())
        tags = wheel_metadata.get_all("Tag", [])
        if not tags or not all(
            tag.startswith("cp311-abi3-macosx_") and tag.endswith(("_x86_64", "_universal2"))
            for tag in tags
        ):
            raise ValueError(f"Wheel must support CPython 3.11 ABI3 on Intel macOS: {tags}")
        module_name = package["module_name"]
        package_path, module = module_name.rsplit(".", 1)
        prefix = package_path.replace(".", "/") + "/" + module + "."
        extensions = [name for name in archive.namelist() if name.startswith(prefix) and name.endswith(".so")]
        if len(extensions) != 1 or package_path.replace(".", "/") + "/__init__.py" not in archive.namelist():
            raise ValueError(f"Wheel is missing its Python package or {module_name} extension: {wheel.name}")
    return {"filename": wheel.name, "sha256": sha256(wheel)}


def verified_cache(output: Path, pin: dict) -> dict | None:
    """Reuse only complete wheel pairs whose bytes and source pins still match."""
    try:
        proof = json.loads((output / "macos-intel-native-wheels.json").read_text())
        if (
            proof["schema_version"] != 1
            or proof["target"] != "x86_64-apple-darwin"
            or proof["maturin_version"] != pin["maturin_version"]
            or proof["deployment_target"] != pin["deployment_target"]
            or len(proof["packages"]) != len(pin["packages"])
        ):
            return None
        for package, record in zip(pin["packages"], proof["packages"], strict=True):
            if (record["name"] != package["name"] or record["version"] != package["version"]
                    or record["module_name"] != package["module_name"]
                    or record["init_symbol"] != "PyInit_" + package["module_name"].rsplit(".", 1)[1]):
                return None
            if record["source"] != {
                "url": package["source_url"], "filename": package["source_filename"],
                "sha256": package["source_sha256"],
            }:
                return None
            filename = record["wheel"]["filename"]
            if Path(filename).name != filename:
                return None
            if verify_wheel(output / filename, package) != record["wheel"]:
                return None
        return proof
    except (OSError, ValueError, KeyError, TypeError, AttributeError, zipfile.BadZipFile):
        return None


def verify_project_metadata(source: Path, package: dict, metadata_directory: Path) -> None:
    """Exercise Maturin's actual project discovery before compiling any Rust."""
    project = tomllib.loads((source / "pyproject.toml").read_text())
    config = project["tool"]["maturin"]
    if config["manifest-path"] != package["manifest_path"] or config["module-name"] != package["module_name"]:
        raise ValueError(f"Published Python project configuration differs from the pin: {package['name']}")
    # Deliberately do not pass --manifest-path: Maturin then reads this root
    # pyproject, including its Python package/module name and nested Cargo path.
    subprocess.run([
        sys.executable, "-m", "maturin", "pep517", "write-dist-info", "--locked",
        "--metadata-directory", str(metadata_directory), "--interpreter", sys.executable,
    ], cwd=source, check=True)
    metadata_files = list(metadata_directory.glob("*.dist-info/METADATA"))
    if len(metadata_files) != 1:
        raise ValueError(f"Expected one Maturin metadata record: {package['name']}")
    metadata = email.parser.Parser().parsestr(metadata_files[0].read_text())
    if metadata["Name"].replace("_", "-").lower() != package["name"] or metadata["Version"] != package["version"]:
        raise ValueError(f"Maturin selected the wrong Python project: {package['name']}")


def verify_init_symbol(wheel: Path, package: dict) -> str:
    """Check the exported CPython entry point instead of accepting a warning."""
    package_path, module = package["module_name"].rsplit(".", 1)
    prefix = package_path.replace(".", "/") + "/" + module + "."
    symbol = "PyInit_" + module
    with zipfile.ZipFile(wheel) as archive, tempfile.TemporaryDirectory(prefix="studio-native-symbol-") as temporary:
        extensions = [name for name in archive.namelist() if name.startswith(prefix) and name.endswith(".so")]
        if len(extensions) != 1:
            raise ValueError(f"Expected one native module for {package['module_name']}")
        library = Path(temporary) / "extension.so"
        library.write_bytes(archive.read(extensions[0]))
        # Apple's nm prefixes C symbols with an underscore on Mach-O binaries.
        output = subprocess.check_output(["nm", "-gU", str(library)], text=True)
    symbols = {line.split()[-1] for line in output.splitlines() if line.split()}
    if symbol not in symbols and "_" + symbol not in symbols:
        raise ValueError(f"Native extension is missing {symbol}: {wheel.name}")
    return symbol


def prepare_source(package: dict, directory: Path) -> tuple[Path, dict]:
    """Verify immutable public source bytes before extracting or invoking Cargo."""
    filename = package["source_filename"]
    if Path(filename).name != filename or not filename.endswith(".tar.gz"):
        raise ValueError("Source filename must be a simple tar.gz filename")
    archive_path = directory / filename
    with urllib.request.urlopen(package["source_url"], timeout=60) as response:
        with archive_path.open("wb") as output:
            shutil.copyfileobj(response, output)
    digest = sha256(archive_path)
    if digest != package["source_sha256"]:
        raise ValueError(f"Source checksum mismatch for {package['name']}: {digest}")
    with tarfile.open(archive_path, "r:gz") as archive:
        archive.extractall(directory, filter="data")
    source = directory / filename.removesuffix(".tar.gz")
    manifest = source / package["manifest_path"]
    lock = source / package["lock_path"]
    if not manifest.is_file() or not lock.is_file():
        raise ValueError(f"Published source is missing its binding manifest or lock: {package['name']}")
    # This verifies that the sdist contains all local path dependencies without
    # silently reaching into a neighboring ecosystem checkout.
    subprocess.run([
        "cargo", "metadata", "--format-version", "1", "--no-deps", "--locked",
        "--manifest-path", str(manifest),
    ], cwd=source, check=True, stdout=subprocess.DEVNULL)
    proof = {
        "name": package["name"], "version": package["version"],
        "source": {"url": package["source_url"], "filename": filename, "sha256": digest},
        "cargo_lock_sha256": sha256(lock),
    }
    return source, proof


def main() -> None:
    root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, default=root / "build/recovery-macos-intel.json")
    parser.add_argument("--output", type=Path, default=root / "vendor/python")
    parser.add_argument("--validate-sources-only", action="store_true", help="Verify sdists/path dependencies without compiling; also works on Linux")
    args = parser.parse_args()
    pin = json.loads(args.manifest.read_text())
    if pin["schema_version"] != 1:
        raise ValueError("Unsupported native wheel manifest schema")
    if not args.validate_sources_only:
        if sys.platform != "darwin" or platform.machine().lower() not in ("x86_64", "amd64"):
            raise RuntimeError("Build these wheels on an Intel macOS runner")
        cached = verified_cache(args.output, pin)
        if cached is not None:
            print("Reusing verified macOS Intel dependency wheels", file=sys.stderr)
            print(json.dumps(cached, indent=2))
            return
        if importlib.metadata.version("maturin") != pin["maturin_version"]:
            raise RuntimeError(f"Install maturin=={pin['maturin_version']} before building")
    proof = {
        "schema_version": 1,
        "target": "x86_64-apple-darwin",
        "deployment_target": pin["deployment_target"],
        "maturin_version": pin["maturin_version"],
        "python": sys.version,
        "rustc": subprocess.check_output(["rustc", "-Vv"], text=True).strip(),
        "packages": [],
    }
    with tempfile.TemporaryDirectory(prefix="studio-macos-native-") as temporary:
        work = Path(temporary)
        wheel_directory = work / "wheels"
        wheel_directory.mkdir()
        env = os.environ.copy()
        env["MACOSX_DEPLOYMENT_TARGET"] = pin["deployment_target"]
        # Share third-party compilation between IO and Core. CI can point this
        # at a persistent, separately cached directory without shipping it.
        env.setdefault("CARGO_TARGET_DIR", str(work / "cargo-target"))
        for package in pin["packages"]:
            source, package_proof = prepare_source(package, work)
            verify_project_metadata(source, package, work / (package["name"] + "-metadata"))
            package_proof["module_name"] = package["module_name"]
            if not args.validate_sources_only:
                before = set(wheel_directory.glob("*.whl"))
                subprocess.run([
                    sys.executable, "-m", "maturin", "build", "--release", "--locked",
                    "--target", "x86_64-apple-darwin", "--interpreter", sys.executable,
                    "--out", str(wheel_directory),
                ], cwd=source, env=env, check=True)
                built = set(wheel_directory.glob("*.whl")) - before
                if len(built) != 1:
                    raise ValueError(f"Expected exactly one wheel for {package['name']}")
                wheel = built.pop()
                package_proof["wheel"] = verify_wheel(wheel, package)
                package_proof["init_symbol"] = verify_init_symbol(wheel, package)
            proof["packages"].append(package_proof)
        if not args.validate_sources_only:
            # Publish only after both builds verify. Preserve the independently
            # built canonical nirs4all wheel and its provenance alongside these.
            args.output.mkdir(parents=True, exist_ok=True)
            for wheel in wheel_directory.glob("*.whl"):
                staged = args.output / (wheel.name + ".tmp")
                shutil.copyfile(wheel, staged)
                staged.replace(args.output / wheel.name)
            staged_proof = args.output / "macos-intel-native-wheels.json.tmp"
            staged_proof.write_text(json.dumps(proof, indent=2) + "\n")
            staged_proof.replace(args.output / "macos-intel-native-wheels.json")
    print(json.dumps(proof, indent=2))


if __name__ == "__main__":
    main()
