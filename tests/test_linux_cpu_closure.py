"""Linux CPU closure exceptions must never hide a required native dependency."""

import importlib.util
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

SCRIPT = Path(__file__).parents[1] / "scripts/verify-linux-cpu-closure.py"
spec = importlib.util.spec_from_file_location("linux_cpu_closure", SCRIPT)
closure = importlib.util.module_from_spec(spec)
spec.loader.exec_module(closure)


@pytest.mark.parametrize("filename,missing", closure.OPTIONAL_MISSING.items())
def test_only_the_exact_optional_dependency_is_exempt(filename, missing, tmp_path):
    name = next(iter(missing))
    assert closure.validate_dependencies(filename, f"{name} => not found", tmp_path) == [name]
    with pytest.raises(ValueError, match="Required ELF dependency missing"):
        closure.validate_dependencies(filename, f"{name} => not found\nlibstdc++.so.6 => not found", tmp_path)
    with pytest.raises(ValueError, match="Required ELF dependency missing"):
        closure.validate_dependencies("lib/another.so", f"{name} => not found", tmp_path)


def test_resolved_scientific_library_must_be_bundled_even_when_runner_has_it(tmp_path):
    with pytest.raises(ValueError, match="Unbundled scientific dependency"):
        closure.validate_dependencies("lib/required.so", "libcustom.so => /usr/lib/libcustom.so (0x123)", tmp_path)
    assert closure.validate_dependencies("lib/required.so", "libc.so.6 => /usr/lib/libc.so.6 (0x123)", tmp_path) == []


def test_unrecognized_loader_errors_are_never_silently_accepted(tmp_path):
    with pytest.raises(ValueError, match="Unrecognized ELF dependency"):
        closure.validate_dependencies(next(iter(closure.OPTIONAL_MISSING)), "error while loading shared libraries", tmp_path)


@pytest.mark.skipif(sys.platform != "linux" or not shutil.which("gcc"), reason="real ELF regression requires Linux GCC")
@pytest.mark.parametrize("keep_external", [False, True])
def test_real_elf_missing_or_runner_only_dependency_fails(tmp_path, keep_external):
    runtime = tmp_path / "runtime"
    runtime.mkdir()
    external = tmp_path / "host"
    external.mkdir()
    library = external / "libclosure_test_required.so"
    subprocess.run(["gcc", "-shared", "-fPIC", "-x", "c", "-o", str(library), "-"], input="int required(void) { return 42; }", text=True, check=True, capture_output=True)
    subprocess.run(
        ["gcc", "-shared", "-fPIC", "-x", "c", "-o", str(runtime / "consumer.so"), "-", f"-L{external}", "-Wl,--no-as-needed", "-lclosure_test_required", f"-Wl,-rpath,{external}"],
        input="extern int required(void); int consumer(void) { return required(); }",
        text=True,
        check=True,
        capture_output=True,
    )
    if not keep_external:
        library.unlink()
    expected = "Unbundled scientific dependency" if keep_external else "Required ELF dependency missing"
    with pytest.raises(ValueError, match=expected):
        closure.scan_runtime(runtime)


@pytest.mark.skipif(sys.platform != "linux" or not shutil.which("gcc"), reason="real ELF regression requires Linux GCC")
@pytest.mark.parametrize("bundled", [True, False])
def test_absolute_elf_dependency_with_spaces_must_still_be_bundled(tmp_path, bundled):
    runtime = tmp_path / "nirs4all Studio" / "python"
    runtime.mkdir(parents=True)
    dependency_root = runtime / "lib" if bundled else tmp_path / "host libraries"
    dependency_root.mkdir()
    library = dependency_root / "libclosure_absolute.so"
    subprocess.run(
        ["gcc", "-shared", "-fPIC", "-x", "c", "-o", str(library), "-"],
        input="int required(void) { return 42; }", text=True, check=True, capture_output=True,
    )
    # No SONAME: the linker records the absolute library path as DT_NEEDED,
    # reproducing PBS libpython3.so's ldd output without a "name =>" prefix.
    consumer = runtime / "consumer.so"
    subprocess.run(
        ["gcc", "-shared", "-fPIC", "-o", str(consumer), "-Wl,--no-as-needed", str(library), "-x", "c", "-"],
        input="extern int required(void); int consumer(void) { return required(); }",
        text=True, check=True, capture_output=True,
    )
    output = subprocess.check_output(["ldd", str(consumer)], text=True)
    assert any(line.strip().startswith(f"{library} (0x") for line in output.splitlines())
    if bundled:
        assert closure.scan_runtime(runtime) == {"elf_files_checked": 2, "optional_numba_backends_unavailable": {}}
    else:
        with pytest.raises(ValueError, match="Unbundled scientific dependency"):
            closure.scan_runtime(runtime)


def test_linux_release_gates_run_clean_qualification_before_publication():
    import yaml

    root = SCRIPT.parents[1]
    release = yaml.safe_load((root / ".github/workflows/release-unified.yml").read_text())
    for job_name in ["installer-linux", "archive-linux"]:
        steps = release["jobs"][job_name]["steps"]
        clean = next(index for index, step in enumerate(steps) if "verify-linux-cpu-closure.py" in step.get("run", ""))
        upload = next(index for index, step in enumerate(steps) if step.get("uses", "").startswith("actions/upload-artifact"))
        assert clean < upload
        assert steps[clean].get("continue-on-error") is not True
        proof = steps[clean + 1]
        assert proof["uses"] == "actions/upload-artifact@v4"
        assert proof["with"]["name"] == f"{job_name}-cpu-closure-proof"
        kind = job_name.removesuffix("-linux")
        assert proof["with"]["path"] == "${{ runner.temp }}/linux-" + kind + "-cpu-closure.json"
        assert proof["with"]["if-no-files-found"] == "error"
        assert proof["with"]["retention-days"] == 14
    appimage = yaml.safe_load((root / ".github/workflows/qualify-appimage-hotfix.yml").read_text())
    steps = appimage["jobs"]["appimage"]["steps"]
    commands = "\n".join(step.get("run", "") for step in steps)
    assert "libtbb12" not in commands and "libgomp1" not in commands
    assert "verify-linux-cpu-closure.py" in commands
    assert "scripts/smoke-appimage-standalone.cjs" in commands
