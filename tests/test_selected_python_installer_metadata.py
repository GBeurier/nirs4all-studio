"""Installer metadata must not make a usable selected SDK look unusable.

The sidecar admits the selected environment by the nirs4all version its
distribution metadata declares, once the package and its Studio callables
import; it does not hash the installed members.
"""

import json
import os
import re
import subprocess
import sys
import venv
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
SOURCE = (ROOT / "sidecar/src/scientific_cpython.rs").read_text(encoding="utf-8")
# The admission probe is the shared host bootstrap followed by its own body.
BOOTSTRAP = re.search(r'macro_rules! host_bootstrap \{.*?r#"(.*?)"#', SOURCE, re.DOTALL)[1]
PROBE = BOOTSTRAP + re.search(r'const PREFLIGHT_SCRIPT: &str = concat!\(\s*host_bootstrap!\(\),\s*r#"(.*?)"#', SOURCE, re.DOTALL)[1]
PACKAGE = "def studio_scientific_job_v1(request): return None\ndef studio_scientific_job_v2(request): return None\n"


def _installation(root: Path, version: str = "1.4.16", extra: str | None = None) -> None:
    metadata = root / f"nirs4all-{version}.dist-info"
    (root / "nirs4all").mkdir(parents=True, exist_ok=True)
    (root / "nirs4all/__init__.py").write_text(PACKAGE, encoding="utf-8")
    metadata.mkdir(parents=True, exist_ok=True)
    (metadata / "METADATA").write_text(f"Metadata-Version: 2.1\nName: nirs4all\nVersion: {version}\n", encoding="utf-8")
    # RECORD hashes are deliberately wrong: admission never reads them.
    (metadata / "RECORD").write_text("nirs4all/__init__.py,sha256=AAAA,1\n", encoding="utf-8")
    if extra:
        (metadata / extra).write_text("{}\n", encoding="utf-8")


@pytest.fixture(scope="module")
def interpreter(tmp_path_factory) -> str:
    """An interpreter whose own environment holds no nirs4all, like a fresh selected one."""
    root = tmp_path_factory.mktemp("selected-environment")
    venv.EnvBuilder(with_pip=False, symlinks=os.name != "nt").create(root)
    return str(root / ("Scripts/python.exe" if os.name == "nt" else "bin/python"))


def _probe(interpreter: str, site_packages: Path, adapters: Path) -> dict:
    adapters.mkdir(exist_ok=True)
    completed = subprocess.run([interpreter, "-I", "-S", "-B", "-c", PROBE, str(site_packages), str(adapters)],
                               env=dict(os.environ), text=True, capture_output=True, check=True, timeout=30)
    return json.loads(completed.stdout)


def test_uv_installation_metadata_does_not_change_the_admitted_identity(tmp_path, interpreter):
    site_packages = tmp_path / "site-packages"
    _installation(site_packages)
    before = _probe(interpreter, site_packages, tmp_path / "adapters")
    for name in ("uv_cache.json", "INSTALLER", "REQUESTED"):
        _installation(site_packages, extra=name)
    after = _probe(interpreter, site_packages, tmp_path / "adapters")
    assert before["ready"] and after["ready"]
    assert before == after
    assert after["distribution_version"] == "1.4.16"
    assert after["distribution_inconsistency"] is None and after["import_error"] is None


def test_selected_environment_is_admitted_by_version_not_member_hashes(tmp_path, interpreter):
    site_packages = tmp_path / "site-packages"
    _installation(site_packages)
    # A member that no longer matches RECORD (a patched or rebuilt SDK) is still admitted.
    (site_packages / "nirs4all/__init__.py").write_text(PACKAGE + "PATCHED = True\n", encoding="utf-8")
    result = _probe(interpreter, site_packages, tmp_path / "adapters")
    assert result["ready"]
    assert result["distribution_version"] == "1.4.16"


def test_metadata_must_describe_the_code_that_runs(tmp_path, interpreter):
    site_packages = tmp_path / "site-packages"
    _installation(site_packages)
    # A second distribution left by another installer makes the version ambiguous.
    _installation(site_packages, version="1.4.13")
    result = _probe(interpreter, site_packages, tmp_path / "adapters")
    assert not result["ready"]
    assert "2 nirs4all distributions are installed" in result["distribution_inconsistency"]


def test_missing_studio_callables_or_import_failure_are_not_ready(tmp_path, interpreter):
    site_packages = tmp_path / "site-packages"
    _installation(site_packages)
    (site_packages / "nirs4all/__init__.py").write_text("def studio_scientific_job_v1(request): return None\n", encoding="utf-8")
    assert not _probe(interpreter, site_packages, tmp_path / "adapters")["ready"]
    (site_packages / "nirs4all/__init__.py").write_text("raise RuntimeError('broken install')\n", encoding="utf-8")
    broken = _probe(interpreter, site_packages, tmp_path / "adapters")
    assert not broken["ready"]
    assert broken["import_error"] == "RuntimeError: broken install"
