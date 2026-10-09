"""Exercise private OpenMP linkage and wheel integrity with a real ELF consumer."""

import csv
import importlib.util
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

SCRIPT = Path(__file__).parents[1] / "scripts/bundle-linux-openmp.py"
spec = importlib.util.spec_from_file_location("bundle_linux_openmp", SCRIPT)
bundle = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bundle)


@pytest.fixture
def runtime(tmp_path):
    if sys.platform != "linux" or not shutil.which("gcc") or not shutil.which("patchelf"):
        pytest.skip("Real ELF regression requires Linux GCC and patchelf")
    site = tmp_path / "lib/python3.11/site-packages"
    library = site / "lightgbm/lib/lib_lightgbm.so"
    library.parent.mkdir(parents=True)
    subprocess.run(
        ["gcc", "-shared", "-fPIC", "-fopenmp", "-x", "c", "-o", str(library), "-"],
        input="#include <omp.h>\nint threads(void) { return omp_get_max_threads(); }",
        text=True, check=True, capture_output=True,
    )
    record = site / "lightgbm-4.6.0.dist-info/RECORD"
    record.parent.mkdir()
    with record.open("w", newline="") as stream:
        csv.writer(stream).writerows([bundle.record_entry(library, site), [record.relative_to(site).as_posix(), "", ""]])
    return tmp_path, site, library, record


def test_private_openmp_resolves_without_loader_environment_and_record_is_valid(runtime):
    root, site, library, record = runtime
    proof = bundle.bundle_openmp(root)
    private = library.with_name("libgomp.so.1")
    assert private.is_file() and not private.is_symlink()
    assert "$ORIGIN" in subprocess.check_output(["patchelf", "--print-rpath", str(library)], text=True)
    dependencies = subprocess.check_output(["ldd", str(library)], env={"PATH": "/usr/bin:/bin"}, text=True)
    assert f"libgomp.so.1 => {private}" in dependencies
    assert "not found" not in dependencies
    with record.open(newline="") as stream:
        rows = list(csv.reader(stream))
    for filename in [library, private, library.with_name("libgomp.COPYING")]:
        assert bundle.record_entry(filename, site) in rows
    assert "GCC Runtime Library Exception" in library.with_name("libgomp.COPYING").read_text()
    assert proof["openmp"] == str(private.relative_to(root))


def test_corrupted_wheel_is_rejected_before_copying_dependency(runtime):
    root, _, library, _ = runtime
    with library.open("ab") as stream:
        stream.write(b"tampered")
    with pytest.raises(ValueError, match="does not match"):
        bundle.bundle_openmp(root)
    assert not library.with_name("libgomp.so.1").exists()


def test_dependency_symlink_is_rejected(runtime):
    root, _, library, _ = runtime
    library.with_name("libgomp.so.1").symlink_to("/usr/lib/libgomp.so.1")
    with pytest.raises(ValueError, match="noncanonical"):
        bundle.bundle_openmp(root)
