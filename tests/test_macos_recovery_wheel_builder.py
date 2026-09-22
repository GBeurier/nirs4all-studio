"""A cached native wheel must match its public source pin and target platform."""

import importlib.util
import io
import json
import zipfile
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[1] / "scripts/build-macos-recovery-wheels.py"
spec = importlib.util.spec_from_file_location("macos_recovery_builder", SCRIPT)
assert spec is not None and spec.loader is not None
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)


def write_wheel(directory, package, tag="cp311-abi3-macosx_11_0_x86_64"):
    name = package["name"].replace("-", "_")
    wheel = directory / f"{name}-{package['version']}-{tag}.whl"
    metadata_root = f"{name}-{package['version']}.dist-info"
    with zipfile.ZipFile(wheel, "w") as archive:
        archive.writestr(f"{metadata_root}/METADATA", f"Name: {package['name']}\nVersion: {package['version']}\n")
        archive.writestr(f"{metadata_root}/WHEEL", f"Wheel-Version: 1.0\nTag: {tag}\n")
        archive.writestr(f"{name}/__init__.py", "from . import _native\n")
        archive.writestr(f"{name}/_native.abi3.so", b"fixture")
    return wheel


@pytest.fixture
def cached_pair(tmp_path):
    pin = json.loads((SCRIPT.parent.parent / "build/recovery-macos-intel.json").read_text())
    proof = {"schema_version": 1, "target": "x86_64-apple-darwin",
             "maturin_version": pin["maturin_version"], "deployment_target": pin["deployment_target"],
             "packages": []}
    for package in pin["packages"]:
        wheel = write_wheel(tmp_path, package)
        proof["packages"].append({
            "name": package["name"], "version": package["version"],
            "module_name": package["module_name"], "init_symbol": "PyInit__native",
            "source": {"url": package["source_url"], "filename": package["source_filename"],
                       "sha256": package["source_sha256"]},
            "wheel": builder.verify_wheel(wheel, package),
        })
    (tmp_path / "macos-intel-native-wheels.json").write_text(json.dumps(proof))
    return pin, proof


def test_complete_cache_reuses_only_verified_pair(tmp_path, cached_pair):
    pin, proof = cached_pair
    assert builder.verified_cache(tmp_path, pin) == proof


def test_corrupt_cached_wheel_requires_rebuild(tmp_path, cached_pair):
    pin, proof = cached_pair
    (tmp_path / proof["packages"][0]["wheel"]["filename"]).write_bytes(b"damaged")
    assert builder.verified_cache(tmp_path, pin) is None


def test_changed_source_pin_requires_rebuild(tmp_path, cached_pair):
    pin, _ = cached_pair
    pin["packages"][0]["source_sha256"] = "0" * 64
    assert builder.verified_cache(tmp_path, pin) is None


@pytest.mark.parametrize("tag", ["cp311-abi3-macosx_11_0_arm64", "cp311-abi3-manylinux_2_17_x86_64", "cp312-abi3-macosx_11_0_x86_64"])
def test_rejects_wheel_incompatible_with_bundled_python(tmp_path, tag):
    package = {"name": "nirs4all-core", "version": "0.3.30"}
    wheel = write_wheel(tmp_path, package, tag)
    with pytest.raises(ValueError, match="CPython 3.11 ABI3"):
        builder.verify_wheel(wheel, package)


def test_source_checksum_verified_before_extract_or_build(tmp_path, monkeypatch):
    package = {"name": "nirs4all-core", "source_filename": "source.tar.gz",
               "source_url": "https://example.invalid/source.tar.gz", "source_sha256": "0" * 64}
    monkeypatch.setattr(builder.urllib.request, "urlopen", lambda *args, **kwargs: io.BytesIO(b"changed source"))
    with pytest.raises(ValueError, match="checksum mismatch"):
        builder.prepare_source(package, tmp_path)


@pytest.mark.parametrize("exported, valid", [("_PyInit__native", True), ("_PyInit_nirs4all_io_native", False)])
def test_extension_must_export_python_project_module_name(tmp_path, monkeypatch, exported, valid):
    package = {"name": "nirs4all-io", "version": "0.2.0", "module_name": "nirs4all_io._native"}
    wheel = write_wheel(tmp_path, package)
    monkeypatch.setattr(builder.subprocess, "check_output", lambda *args, **kwargs: f"000000 T {exported}\n")
    if valid:
        assert builder.verify_init_symbol(wheel, package) == "PyInit__native"
    else:
        with pytest.raises(ValueError, match="missing PyInit__native"):
            builder.verify_init_symbol(wheel, package)


def test_changed_python_module_configuration_fails_before_compilation(tmp_path):
    package = {"name": "nirs4all-io", "manifest_path": "bindings/python/Cargo.toml", "module_name": "nirs4all_io._native"}
    (tmp_path / "pyproject.toml").write_text(
        '[tool.maturin]\nmanifest-path="bindings/python/Cargo.toml"\nmodule-name="nirs4all_io_native"\n'
    )
    with pytest.raises(ValueError, match="configuration differs"):
        builder.verify_project_metadata(tmp_path, package, tmp_path / "metadata")
