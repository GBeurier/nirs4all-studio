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


def _probe(root: Path, verified_stat: str | None = None) -> dict:
    env = dict(os.environ)
    env.pop("NIRS4ALL_SELECTED_SITE_PACKAGES", None)
    env.pop("NIRS4ALL_VERIFIED_DISTRIBUTION_STAT", None)
    if verified_stat:
        env["NIRS4ALL_VERIFIED_DISTRIBUTION_STAT"] = verified_stat
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


def test_selected_environment_is_admitted_by_version_not_member_hashes(tmp_path):
    # Custom and managed environments (no packaged site-packages argument) are
    # checked by version range and ABI; only the packaged runtime is attested.
    _installation(tmp_path)
    (tmp_path / "nirs4all/__init__.py").write_text("def studio_scientific_job_v1(request): return 123\n", encoding="utf-8")
    env = dict(os.environ) | {"NIRS4ALL_SELECTED_SITE_PACKAGES": str(tmp_path)}
    completed = subprocess.run([sys.executable, "-I", "-S", "-B", "-c", PROBE, ""],
                               env=env, text=True, capture_output=True, check=True, timeout=30)
    result = json.loads(completed.stdout)
    assert result["ready"]
    assert result["distribution_version"] == "1.4.13"
    assert not result["distribution_files_verified"]


def test_recorded_stat_identity_skips_member_hashes_until_a_member_changes(tmp_path):
    _installation(tmp_path)
    member = tmp_path / "nirs4all/__init__.py"
    # A member that no longer matches RECORD: hashing it fails verification.
    member.write_text("def studio_scientific_job_v1(request): return 123\n", encoding="utf-8")
    first = _probe(tmp_path)
    assert not first["distribution_files_verified"]
    digest = first["distribution_stat_sha256"]
    assert re.fullmatch(r"[0-9a-f]{64}", digest)
    # Rust passes the stat identity it recorded after a full verification;
    # with unchanged stats the member hashes are skipped (proved by the mismatch above).
    assert _probe(tmp_path, digest)["distribution_files_verified"]
    # Any later write changes the stat identity, so the members are hashed again.
    member.write_text("def studio_scientific_job_v1(request): return 456\n", encoding="utf-8")
    changed = _probe(tmp_path, digest)
    assert changed["distribution_stat_sha256"] != digest
    assert not changed["distribution_files_verified"]
