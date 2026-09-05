# SPDX-License-Identifier: CECILL-2.1 OR AGPL-3.0-or-later
"""Focused regression tests for release provenance and packaging helpers."""

from __future__ import annotations

import csv
import io
import json
import subprocess
import tomllib
import zipfile
from pathlib import Path

import pytest

from scripts.normalize_cyclonedx import canonicalize_arrays, validate_cyclonedx, verify_subject
from scripts.normalize_wheel import normalize_wheel
from scripts.release_paths import CANONICAL_SOURCE, normalize_source_strings, refuse_source_path_leaks
from scripts.rust_reproducibility import reproducible_rust_env
from scripts.scan_artifact_paths import scan_paths
from scripts.verify_release_tag import verify
from scripts.write_deterministic_zip import write_zip
from scripts.write_release_receipt import reproducibility_covers, required_artifact_status, source_matches

ROOT = Path(__file__).resolve().parents[1]
WORKSPACE_VERSION = tomllib.loads((ROOT / "Cargo.toml").read_text(encoding="utf-8"))["workspace"]["package"]["version"]


def test_formats_security_repin_is_exact_across_python_and_web() -> None:
    expected = "0.2.9"
    project = tomllib.loads((ROOT / "pyproject.toml").read_text(encoding="utf-8"))["project"]
    assert project["optional-dependencies"]["formats"] == [f"nirs4all-formats=={expected}"]
    assert f"nirs4all-formats=={expected}" in project["optional-dependencies"]["dev"]
    web_package = json.loads((ROOT / "web/pkg/formats/package.json").read_text(encoding="utf-8"))
    assert web_package["name"] == "nirs4all-formats-wasm"
    assert web_package["version"] == expected


def test_json_path_normalization_handles_escaped_windows_form() -> None:
    windows_root = str(ROOT).replace("/", "\\")
    document = json.loads(json.dumps({"nested": [f"{windows_root}\\crates\\core"]}))
    normalized = normalize_source_strings(document, ROOT)
    assert normalized == {"nested": [f"{CANONICAL_SOURCE}\\crates\\core"]}
    refuse_source_path_leaks(normalized, ROOT)
    refuse_source_path_leaks(
        {"bom-ref": f"path+file://{CANONICAL_SOURCE}/bindings/python#nirs4all-io-py@0.1.12"},
        ROOT,
    )


def test_rust_environment_remaps_ephemeral_build_root(tmp_path: Path) -> None:
    target = tmp_path / "ephemeral-build" / "target"
    env = reproducible_rust_env(ROOT, target, {}, extra_roots=(target.parent,))
    flags = env["CARGO_ENCODED_RUSTFLAGS"].split("\x1f")
    assert f"--remap-path-prefix={target.parent.resolve()}=/usr/src/nirs4all-io/build-0" in flags


def test_path_leak_scanner_descends_into_zip(tmp_path: Path) -> None:
    archive = tmp_path / "leaky.zip"
    with zipfile.ZipFile(archive, "w") as output:
        output.writestr("native.bin", f"debug={ROOT}/target/release".encode())
    with pytest.raises(ValueError, match="path leak"):
        scan_paths([archive])


def test_committed_web_wasm_has_no_checkout_paths() -> None:
    bundles = sorted((ROOT / "web" / "pkg").glob("**/*.wasm"))
    assert bundles
    scan_paths(bundles)


def test_web_wasm_rebuilds_are_locked() -> None:
    source = (ROOT / "web" / "build-wasm.sh").read_text(encoding="utf-8")
    assert source.count("--locked") == 2


def test_rust_security_gate_audits_every_lockfile() -> None:
    source = (ROOT / "scripts" / "audit_rust_locks.sh").read_text(encoding="utf-8")
    for lock_file in (
        "Cargo.lock",
        "bindings/python/Cargo.lock",
        "bindings/wasm/Cargo.lock",
        "bindings/r/Cargo.lock.rust",
    ):
        assert f'"{lock_file}"' in source
    assert 'cargo audit --file "${repo_root}/${lock_file}"' in source

    for workflow in ("ci.yml", "release.yml"):
        workflow_source = (ROOT / ".github" / "workflows" / workflow).read_text(
            encoding="utf-8"
        )
        assert "bash scripts/audit_rust_locks.sh" in workflow_source


def test_source_release_removes_sbom_staging_before_clean_tree_gate() -> None:
    workflow = (ROOT / ".github" / "workflows" / "release-source.yml").read_text(
        encoding="utf-8"
    )
    remove_index = workflow.index("rm -rf sbom-root")
    normalize_index = workflow.index("python scripts/normalize_cyclonedx.py")
    assert remove_index < normalize_index


def test_dagml_release_gate_uses_identity_and_exact_sibling() -> None:
    source = (ROOT / "tests" / "dag_ml_data" / "verify_cross_cli.sh").read_text(
        encoding="utf-8"
    )
    assert "tests/cross_binding/corpus/identity.spec.json" in source
    assert "cargo update" in source and "--precise" in source and "--offline" in source
    assert "dag-ml-data patch was not selected" in source
    assert source.count("cargo build -q --locked") == 3


def test_cyclonedx_validation_and_array_canonicalization() -> None:
    document = {
        "bomFormat": "CycloneDX",
        "specVersion": "1.6",
        "version": 1,
        "components": [{"name": "z"}, {"name": "a"}],
    }
    canonical = canonicalize_arrays(document)
    assert [item["name"] for item in canonical["components"]] == ["a", "z"]
    assert validate_cyclonedx(canonical) is canonical
    with pytest.raises(ValueError, match="bomFormat"):
        validate_cyclonedx({"components": []})


def test_cyclonedx_subject_must_be_deterministic_head_archive(tmp_path: Path) -> None:
    subject = tmp_path / "nirs4all-io-0.1.12-src.tar.gz"
    raw = tmp_path / "source.tar"
    with raw.open("wb") as stream:
        subprocess.run(
            [
                "git",
                "-C",
                str(ROOT),
                "archive",
                "--format=tar",
                "--prefix=nirs4all-io-0.1.12/",
                "HEAD",
            ],
            stdout=stream,
            check=True,
        )
    with subject.open("wb") as stream:
        subprocess.run(["gzip", "-9", "-n", "-c", str(raw)], stdout=stream, check=True)
    assert verify_subject(ROOT, subject)
    subject.write_bytes(subject.read_bytes() + b"tampered")
    with pytest.raises(ValueError, match="deterministic source archive"):
        verify_subject(ROOT, subject)


def test_deterministic_zip_has_fixed_metadata(tmp_path: Path) -> None:
    source = tmp_path / "pkg"
    source.mkdir()
    (source / "b.txt").write_text("b", encoding="utf-8")
    (source / "a.txt").write_text("a", encoding="utf-8")
    first, second = tmp_path / "a.zip", tmp_path / "b.zip"
    write_zip(source, first, 1_700_000_000)
    write_zip(source, second, 1_700_000_000)
    assert first.read_bytes() == second.read_bytes()
    with zipfile.ZipFile(first) as archive:
        assert archive.namelist() == ["pkg/a.txt", "pkg/b.txt"]
        assert all(not info.extra for info in archive.infolist())


def _write_fake_wheel(path: Path, *, duplicate: bool = False) -> None:
    version = WORKSPACE_VERSION
    dist = f"nirs4all_io-{version}.dist-info"
    members = {
        "nirs4all_io/__init__.py": b"",
        f"{dist}/METADATA": f"Metadata-Version: 2.4\nName: nirs4all-io\nVersion: {version}\n".encode(),
        f"{dist}/sboms/nirs4all_io.cdx.json": json.dumps(
            {"bomFormat": "CycloneDX", "metadata": {"path": str(ROOT)}, "specVersion": "1.6", "version": 1}
        ).encode(),
    }
    record_name = f"{dist}/RECORD"
    rows = [[name, "", ""] for name in members] + [[record_name, "", ""]]
    record = io.StringIO(newline="")
    csv.writer(record, lineterminator="\n").writerows(rows)
    members[record_name] = record.getvalue().encode()
    with zipfile.ZipFile(path, "w") as archive:
        for name, data in members.items():
            archive.writestr(name, data)
        if duplicate:
            archive.writestr("nirs4all_io/__init__.py", b"duplicate")


def test_wheel_normalizer_sets_commit_serial_and_record(tmp_path: Path) -> None:
    wheel = tmp_path / f"nirs4all_io-{WORKSPACE_VERSION}-py3-none-any.whl"
    _write_fake_wheel(wheel)
    normalize_wheel(wheel, ROOT, 1_700_000_000, "a" * 40)
    with zipfile.ZipFile(wheel) as archive:
        sbom_name = next(name for name in archive.namelist() if "/sboms/" in name)
        sbom = json.loads(archive.read(sbom_name))
        assert sbom["serialNumber"].startswith("urn:uuid:")
        assert CANONICAL_SOURCE in json.dumps(sbom)
        record_name = next(name for name in archive.namelist() if name.endswith("/RECORD"))
        record_names = [row[0] for row in csv.reader(io.StringIO(archive.read(record_name).decode()))]
        assert set(record_names) == set(archive.namelist())


def test_wheel_normalizer_refuses_duplicate_members(tmp_path: Path) -> None:
    wheel = tmp_path / f"nirs4all_io-{WORKSPACE_VERSION}-py3-none-any.whl"
    _write_fake_wheel(wheel, duplicate=True)
    with pytest.raises(SystemExit, match="duplicate"):
        normalize_wheel(wheel, ROOT, 1_700_000_000, "a" * 40)


def test_release_tag_and_receipt_fail_closed_helpers() -> None:
    verify("workflow_dispatch", "", "0.1.12")
    verify("workflow_dispatch", "v0.1.12", "0.1.12", "tag")
    verify("push", "v0.1.12", "0.1.12")
    with pytest.raises(SystemExit, match="mismatch"):
        verify("push", "v0.1.13", "0.1.12")
    with pytest.raises(SystemExit, match="mismatch"):
        verify("workflow_dispatch", "v0.1.13", "0.1.12", "tag")
    assert source_matches(
        {"source": {"commit": "c", "tree": "t", "dirty": False}},
        "c",
        "t",
    )
    assert not source_matches({"source_commit": "c", "source_tree": "t"}, "c", "t")
    status = required_artifact_status(
        [
            "nirs4all_io-0.1.12-cp311-abi3-manylinux.whl",
            "nirs4all_io-0.1.12.tar.gz",
        ]
    )
    assert status["python_wheel"] and status["python_sdist"]
    assert not status["npm_tarball"]
    assert not reproducibility_covers(
        {"artifacts": [{"path": "nirs4all_io-0.1.12.tar.gz", "byte_identical": True}]},
        {"nirs4all_io-0.1.12.tar.gz": "abc"},
    )
