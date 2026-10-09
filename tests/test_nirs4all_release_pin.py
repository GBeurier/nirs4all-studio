from __future__ import annotations

import base64
import csv
import hashlib
import importlib.util
import io
import json
import os
import re
import subprocess
import sys
import tomllib
import zipfile
from pathlib import Path

import pytest
import yaml

ROOT = Path(__file__).resolve().parents[1]


def test_sidecar_resolves_selected_native_releases() -> None:
    manifest = tomllib.loads((ROOT / "sidecar" / "Cargo.toml").read_text(encoding="utf-8"))
    dependencies = manifest["dependencies"]
    assert dependencies["nirs4all"] == "=0.4.5"
    assert dependencies["nirs4all-io"] == "=0.2.6"
    # Native consumers use Core 0.4.5 public reexports and its exact DAG 0.3.41.
    assert "dag-ml-core" not in manifest.get("dev-dependencies", {})


def test_registry_lock_resolves_selected_native_releases() -> None:
    locked = tomllib.loads((ROOT / "sidecar" / "Cargo.lock").read_text(encoding="utf-8"))
    packages = {(package["name"], package["version"]) for package in locked["package"]}
    assert {("nirs4all", "0.4.5"), ("nirs4all-io", "0.2.6"), ("dag-ml", "0.3.41"),
            ("dag-ml-core", "0.3.41"), ("dag-ml-data", "0.2.13"), ("n4m", "0.4.0")} <= packages
    for package in locked["package"]:
        if package["name"] in {"nirs4all", "nirs4all-io", "dag-ml", "dag-ml-core", "dag-ml-data", "n4m"}:
            assert package.get("source", "").startswith("registry+"), "local path locks do not attest public releases"
            assert re.fullmatch(r"[0-9a-f]{64}", package.get("checksum", ""))
    # Core, DAG-ML and the Methods binding must share one libn4m loader.
    assert [version for name, version in packages if name == "n4m"] == ["0.4.0"]


def test_release_workflow_uses_immutable_nirs4all_source() -> None:
    config = json.loads((ROOT / "recommended-config.json").read_text(encoding="utf-8"))
    version = config["nirs4all"]
    workflow = (ROOT / ".github" / "workflows" / "release-unified.yml").read_text(encoding="utf-8")

    assert version == "1.4.8"
    ref = re.search(r"^  NIRS4ALL_LIBRARY_REF: ([0-9a-f]{40})$", workflow, re.MULTILINE)
    source = re.search(r"^  NIRS4ALL_SOURCE_URL: .+/archive/([0-9a-f]{40})\.tar\.gz$", workflow, re.MULTILINE)
    assert ref is not None
    assert source is not None
    assert ref.group(1) == source.group(1) == "f4e13a2163ee78f12c326e8853bbd7db44a4540f"
    parsed = yaml.safe_load(workflow)
    contract = json.loads((ROOT / "sidecar/contracts/studio_scientific_cpython_host_v1.json").read_text())
    assert parsed["env"]["NIRS4ALL_WHEEL_SHA256"] == contract["selected_wheel_sha256"]
    validation = next(step["run"] for step in parsed["jobs"]["prepare"]["steps"]
                      if step.get("name") == "Validate pinned runtime dependency refs")
    environment = dict(os.environ) | {key: "" if value is None else str(value) for key, value in parsed["env"].items()}
    assert environment["NIRS4ALL_PUBLICATION_STATUS"] == contract["publication_status"] == "source-built"
    assert contract["public_registry_verified"] is False
    assert environment["NIRS4ALL_WHEEL_URL"] == contract["selected_wheel_url"] == ""
    assert environment["NIRS4ALL_SOURCE_EPOCH"] == "1791548791"
    result = subprocess.run(["bash", "-c", validation], env=environment, cwd=ROOT, capture_output=True)
    assert result.returncode == 0, result.stderr.decode()
    for changed in ({"NIRS4ALL_WHEEL_URL": "https://files.pythonhosted.org/old/nirs4all-1.4.8-py3-none-any.whl"},
                    {"NIRS4ALL_SOURCE_EPOCH": "1791533217"}, {"NIRS4ALL_PUBLICATION_STATUS": "published"},
                    {"NIRS4ALL_SOURCE_URL": "https://github.com/GBeurier/nirs4all/archive/main.tar.gz"}):
        assert subprocess.run(["bash", "-c", validation], env=environment | changed, cwd=ROOT, capture_output=True).returncode != 0
    assert f"ref: {version}" not in workflow

    dag_ref = re.search(r"^  DAG_ML_REF: ([0-9a-f]{40})$", workflow, re.MULTILINE)
    dag_source = re.search(r"^  DAG_ML_SOURCE_URL: .+/archive/([0-9a-f]{40})\.tar\.gz$", workflow, re.MULTILINE)
    assert dag_ref is not None
    assert dag_source is not None
    assert dag_ref.group(1) == dag_source.group(1) == "6f4044b45028a90a92d3f29287e67779bb5fd0b9"

    data_ref = re.search(r"^  DAG_ML_DATA_REF: ([0-9a-f]{40})$", workflow, re.MULTILINE)
    data_source = re.search(
        r"^  DAG_ML_DATA_SOURCE_URL: .+/archive/([0-9a-f]{40})\.tar\.gz$",
        workflow,
        re.MULTILINE,
    )
    assert data_ref is not None
    assert data_source is not None
    assert data_ref.group(1) == data_source.group(1) == "78719b68c8e9ffd4c2035792574b8da33387d237"

    tools_ref = re.search(r"^  NIRS4ALL_TOOLS_REF: ([0-9a-f]{40})$", workflow, re.MULTILINE)
    tools_source = re.search(
        r"^  NIRS4ALL_TOOLS_SOURCE_URL: .+/archive/([0-9a-f]{40})\.tar\.gz$",
        workflow,
        re.MULTILINE,
    )
    assert tools_ref is not None
    assert tools_source is not None
    assert tools_ref.group(1) == tools_source.group(1) == "ca5cc30c4f7ab748142cfe25ea6d6b3e4c983cc8"


def test_recommended_profiles_use_single_nirs4all_version() -> None:
    config = json.loads((ROOT / "recommended-config.json").read_text(encoding="utf-8"))
    version = config["nirs4all"]
    package = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
    app_version = json.loads((ROOT / "version.json").read_text(encoding="utf-8"))

    # The remote-config resolver compares app_version with its cached copy.
    assert config["app_version"] == package["version"] == app_version["version"]

    for profile in config["profiles"].values():
        package = profile.get("packages", {}).get("nirs4all")
        if package is None:
            continue
        assert package["recommended"] == version
        # Compatibility floor remains 1.4.6 while the recommended cohort is 1.4.8.
        assert package["min"] == ">=1.4.6"


def test_release_builds_pinned_plugin_wheels_once_for_all_distributables() -> None:
    workflow = (ROOT / ".github" / "workflows" / "release-unified.yml").read_text(encoding="utf-8")

    assert "  pinned-plugin-wheels:\n" in workflow
    assert workflow.count("needs: [prepare, pinned-plugin-wheels]") == 4
    assert workflow.count("name: Download canonical plugin wheels") == 4
    version = json.loads((ROOT / "recommended-config.json").read_text())["nirs4all"]
    assert workflow.count(f"--plugin-wheel _deps/pinned-plugin-wheels/nirs4all-{version}-py3-none-any.whl") == 4
    assert workflow.count("--tools-wheel _deps/pinned-plugin-wheels/nirs4all_tools-0.0.8-py3-none-any.whl") == 4
    parsed = yaml.safe_load(workflow)
    acquisition = next(step["run"] for step in parsed["jobs"]["pinned-plugin-wheels"]["steps"]
                       if step.get("name") == "Build SDK and verify canonical plugin wheels")
    assert acquisition.count('curl --fail --location --proto "=https" --tlsv1.2') == 1
    assert "node scripts/setup-python-env.cjs" in acquisition
    assert "--build-plugin-wheel dist/pinned-plugin-wheels/nirs4all-1.4.8-py3-none-any.whl" in acquisition
    assert '"$NIRS4ALL_TOOLS_WHEEL_URL"' in acquisition
    assert "9b152be79b7d510406d10da1cf097c5d67176334e2d54de0fd49ef0757774310" in acquisition
    assert "pip wheel" not in acquisition


def _wheel_normalizer():
    specification = importlib.util.spec_from_file_location("plugin_wheel_normalizer", ROOT / "scripts/normalize-plugin-wheel.py")
    module = importlib.util.module_from_spec(specification)
    specification.loader.exec_module(module)
    return module.normalize_wheel


def _test_wheel(path: Path, *, windows: bool = False, corruption: bool = False, extra: bool = False) -> str:
    metadata_name = "nirs4all-1.4.8.dist-info/METADATA"
    record_name = "nirs4all-1.4.8.dist-info/RECORD"
    payloads = {"nirs4all/example.py": b"scientific_code = 'preserved'\n",
                metadata_name: b"Metadata-Version: 2.4\nName: nirs4all\nVersion: 1.4.8\n\nDescription\n",
                "nirs4all-1.4.8.dist-info/WHEEL": b"Wheel-Version: 1.0\nTag: py3-none-any\n"}

    def record_rows():
        return [(name, "sha256=" + base64.urlsafe_b64encode(hashlib.sha256(payload).digest()).decode().rstrip("="), str(len(payload)))
                for name, payload in sorted(payloads.items())]

    canonical_rows = record_rows()
    manifest = hashlib.sha256("".join(",".join(row) + "\n" for row in canonical_rows).encode()).hexdigest()
    if windows:
        payloads[metadata_name] = payloads[metadata_name].replace(b"\n", b"\r\n")
    output = io.StringIO()
    csv.writer(output, lineterminator="\n").writerows(record_rows() + [(record_name, "", "")])
    payloads[record_name] = output.getvalue().encode()
    if corruption:
        payloads["nirs4all/example.py"] = b"changed scientific code\n"
    if extra:
        payloads["nirs4all/unrecorded.py"] = b"unrecorded code\n"
    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for name, payload in reversed(list(payloads.items())) if windows else payloads.items():
            info = zipfile.ZipInfo(name, (2026, 10, 10 if windows else 9, 1, 2, 4))
            info.create_system = 0 if windows else 3
            info.external_attr = (0o100666 if windows else 0o100755) << 16
            archive.writestr(info, payload)
    return manifest


def test_wheel_normalization_is_portable_and_preserves_owner_payloads(tmp_path: Path) -> None:
    linux, windows = tmp_path / "linux.whl", tmp_path / "windows.whl"
    expected = _test_wheel(linux)
    assert expected == _test_wheel(windows, windows=True)
    normalize = _wheel_normalizer()
    left, right = tmp_path / "left.whl", tmp_path / "right.whl"
    assert normalize(linux, left, 1791533216, expected) == normalize(windows, right, 1791533216, expected)
    assert left.read_bytes() == right.read_bytes()
    with zipfile.ZipFile(left) as archive:
        assert archive.read("nirs4all/example.py") == b"scientific_code = 'preserved'\n"
        assert archive.namelist() == sorted(archive.namelist())
        assert all(item.create_system == 3 and item.external_attr >> 16 == 0o100644 and item.compress_type == zipfile.ZIP_STORED
                   and item.date_time == (2026, 10, 9, 8, 6, 56) for item in archive.infolist())


@pytest.mark.parametrize("corruption,extra", [(True, False), (False, True)])
def test_wheel_normalization_rejects_unverified_input_without_replacing_output(tmp_path: Path, corruption: bool, extra: bool) -> None:
    source, destination = tmp_path / "input.whl", tmp_path / "output.whl"
    expected = _test_wheel(source, corruption=corruption, extra=extra)
    destination.write_bytes(b"existing qualified wheel")
    with pytest.raises(ValueError, match="content mismatch|complete inventory"):
        _wheel_normalizer()(source, destination, 1791533216, expected)
    assert destination.read_bytes() == b"existing qualified wheel"


def test_wheel_normalization_rejects_a_different_installed_manifest(tmp_path: Path) -> None:
    source, destination = tmp_path / "input.whl", tmp_path / "output.whl"
    _test_wheel(source)
    with pytest.raises(ValueError, match="installed manifest mismatch"):
        _wheel_normalizer()(source, destination, 1791533216, "0" * 64)
    assert not destination.exists()


def test_runtime_prunes_only_the_exact_additional_windows_launcher_record(tmp_path: Path) -> None:
    record = tmp_path / "python/Lib/site-packages/example.dist-info/RECORD"
    record.parent.mkdir(parents=True)
    record.write_text("../../Scripts/nirs4all.exe,sha256=generated,1\n"
                      "../../Scripts/unrelated.exe,sha256=keep,2\n"
                      "../../other/source.py,sha256=keep,3\n"
                      "example/module.py,sha256=keep,4\n", encoding="utf-8")
    script = "require('./scripts/setup-python-env.cjs').removePrunedLauncherRecordRows(process.argv[1],process.argv[2]).catch(e=>{console.error(e);process.exit(1)})"
    result = subprocess.run(["node", "-e", script, sys.executable, str(tmp_path)], cwd=ROOT, capture_output=True)
    assert result.returncode == 0, result.stderr.decode()
    assert "nirs4all.exe" not in record.read_text(encoding="utf-8")
    assert "unrelated.exe" in record.read_text(encoding="utf-8")
    assert "../../other/source.py" in record.read_text(encoding="utf-8")


def test_generated_operator_registries_are_from_the_published_runtime() -> None:
    python_versions: set[str] = set()
    for path in [
        ROOT / "src" / "data" / "nodes" / "generated" / "canonical-registry.meta.json",
        ROOT / "public" / "node-registry" / "extended.meta.json",
    ]:
        metadata = json.loads(path.read_text(encoding="utf-8"))
        assert metadata["nirs4allVersion"] == "1.4.2"
        assert metadata["pythonVersion"].startswith("3.11.")
        assert metadata["sklearnVersion"] == "1.9.0"
        python_versions.add(metadata["pythonVersion"])
    assert len(python_versions) == 1


def test_release_rebuilds_and_compares_the_exact_plugin_closure_twice() -> None:
    workflow = (ROOT / ".github" / "workflows" / "release-unified.yml").read_text(encoding="utf-8")
    constraints = (ROOT / "build" / "constraints" / "plugin-runtime-cpython311.txt").read_text(encoding="utf-8")

    assert "node scripts/verify-plugin-runtime-reproducibility.cjs" in workflow
    assert "plugin-runtime-reproducibility-${{ runner.os }}-${{ runner.arch }}.json" in workflow
    assert "nirs4all==1.4.8" in constraints
    assert "nirs4all-core==0.4.5" in constraints
    assert "nirs4all-io==0.2.6" in constraints
    assert "dag-ml-data==0.2.13" in constraints
    assert "nirs4all-methods==1.3.4" in constraints
    assert "pls4all==1.3.4" in constraints
    # Python and Rust DAG consume the same independently published 0.3.41 cohort.
    assert "dag-ml==0.3.41" in constraints
    assert "nirs4all-formats==0.2.11" in constraints
    assert "nirs4all-tools==0.0.8" in constraints
    assert "scikit-learn==1.9.0" in constraints


def test_release_dispatch_only_publishes_when_explicitly_requested() -> None:
    workflow = yaml.safe_load((ROOT / ".github" / "workflows" / "release-unified.yml").read_text(encoding="utf-8"))

    for step_name in ["Login to GitHub Container Registry", "Publish the tested Docker image"]:
        step = next(step for step in workflow["jobs"]["release"]["steps"] if step.get("name") == step_name)
        assert step["if"] == "needs.prepare.outputs.is_tag_release == 'true' && needs.prepare.outputs.skip_docker != 'true'"


def test_release_packaged_ui_smoke_is_blocking_and_checksums_use_basenames() -> None:
    workflow = yaml.safe_load((ROOT / ".github" / "workflows" / "release-unified.yml").read_text(encoding="utf-8"))

    installers = {name: job for name, job in workflow["jobs"].items() if name.startswith("installer-")}
    assert set(installers) == {"installer-linux", "installer-windows", "installer-macos-x64", "installer-macos-arm64"}
    release = workflow["jobs"]["release"]
    for name, job in installers.items():
        assert name in release["needs"]
        assert f"needs.{name}.result == 'success'" in release["if"]
        steps = job["steps"]
        qualification = next(i for i, step in enumerate(steps) if "scripts/smoke-packaged-ui.cjs" in step.get("run", ""))
        upload = next(i for i, step in enumerate(steps) if step.get("name") == "Upload artifacts")
        assert qualification < upload
        qualifier = steps[qualification]["run"]
        assert "--installer" in qualifier
        assert "--timeout-ms 120000" in qualifier
        assert not steps[qualification].get("continue-on-error", False)
        assert "checkout_ref" in steps[qualification]["env"]["RELEASE_SOURCE_SHA"]
        assert "INSTALLER_BASELINE" not in steps[qualification].get("env", {})
        checksum = next(step["run"] for step in steps if step.get("name") == "Generate checksums")
        if name == "installer-windows":
            assert "$($_.Name)" in checksum
        else:
            assert checksum.startswith("cd release\n")
    # The existing finalizer verifies producer hashes and rewrites sidecars to
    # the exact public asset basename (GitHub normalizes spaces to dots).
    preparation = next(step for step in release["steps"] if step.get("name") == "Prepare release assets")
    assert "scripts/finalize-release-assets.cjs" in preparation["run"]
