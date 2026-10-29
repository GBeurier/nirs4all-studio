"""Installer metadata must not make a verified external SDK look corrupted."""

import base64
import csv
import hashlib
import io
import json
import os
import re
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
SOURCE = (ROOT / "sidecar/src/scientific_cpython.rs").read_text(encoding="utf-8")
PROBE = re.search(r'const PREFLIGHT_SCRIPT: &str = r#"(.*?)"#;', SOURCE, re.DOTALL)[1]
METADATA = "nirs4all-1.4.13.dist-info"


def _installation(root: Path, extra: str | None = None) -> None:
    payloads = {
        "nirs4all/__init__.py": b"def studio_scientific_job_v1(request): return None\n",
        f"{METADATA}/METADATA": b"Name: nirs4all\nVersion: 1.4.13\n",
    }
    if extra:
        payloads[extra] = b"{}\n"
    rows = []
    for name, payload in payloads.items():
        target = root / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(payload)
        digest = base64.urlsafe_b64encode(hashlib.sha256(payload).digest()).decode().rstrip("=")
        rows.append([name, "sha256=" + digest, str(len(payload))])
    stream = io.StringIO()
    csv.writer(stream, lineterminator="\n").writerows(rows + [[f"{METADATA}/RECORD", "", ""]])
    (root / METADATA / "RECORD").write_text(stream.getvalue(), encoding="utf-8")


def _probe(root: Path) -> dict:
    env = dict(os.environ)
    env.pop("NIRS4ALL_SELECTED_SITE_PACKAGES", None)
    completed = subprocess.run([sys.executable, "-I", "-S", "-B", "-c", PROBE, str(root)],
                               env=env, text=True, capture_output=True, check=True, timeout=30)
    return json.loads(completed.stdout)


def test_uv_installation_keeps_the_exact_scientific_package_identity(tmp_path):
    _installation(tmp_path)
    before = _probe(tmp_path)
    _installation(tmp_path, f"{METADATA}/uv_cache.json")
    after = _probe(tmp_path)
    assert before["ready"] and after["ready"]
    assert after["distribution_files_verified"]
    assert before["distribution_manifest_sha256"] == after["distribution_manifest_sha256"]


@pytest.mark.parametrize("name", ["uv_cache.json", "INSTALLER"])
def test_installer_named_files_inside_sdk_code_remain_attested(tmp_path, name):
    _installation(tmp_path)
    before = _probe(tmp_path)
    _installation(tmp_path, "nirs4all/" + name)
    after = _probe(tmp_path)
    assert after["distribution_files_verified"]
    assert before["distribution_manifest_sha256"] != after["distribution_manifest_sha256"]


def test_uv_metadata_does_not_hide_tampered_sdk_code(tmp_path):
    _installation(tmp_path, f"{METADATA}/uv_cache.json")
    (tmp_path / "nirs4all/__init__.py").write_text("def studio_scientific_job_v1(request): return 123\n", encoding="utf-8")
    assert not _probe(tmp_path)["distribution_files_verified"]
