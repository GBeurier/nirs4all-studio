from __future__ import annotations

import json
import re
import tomllib
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]


def test_sidecar_resolves_selected_native_releases() -> None:
    manifest = tomllib.loads((ROOT / "sidecar" / "Cargo.toml").read_text(encoding="utf-8"))
    locked = tomllib.loads((ROOT / "sidecar" / "Cargo.lock").read_text(encoding="utf-8"))
    dependencies = manifest["dependencies"]
    assert dependencies["nirs4all"] == "=0.3.31"
    assert dependencies["nirs4all-io"] == "=0.2.0"
    assert manifest["dev-dependencies"]["dag-ml-core"] == "=0.3.27"
    packages = {(package["name"], package["version"]) for package in locked["package"]}
    assert {("nirs4all", "0.3.31"), ("nirs4all-io", "0.2.0"), ("dag-ml", "0.3.27"),
            ("dag-ml-core", "0.3.27"), ("dag-ml-data", "0.2.12")} <= packages


def test_release_workflow_uses_immutable_nirs4all_source() -> None:
    config = json.loads((ROOT / "recommended-config.json").read_text(encoding="utf-8"))
    version = config["nirs4all"]
    workflow = (ROOT / ".github" / "workflows" / "release-unified.yml").read_text(encoding="utf-8")

    assert version == "1.1.5"
    ref = re.search(r"^  NIRS4ALL_LIBRARY_REF: ([0-9a-f]{40})$", workflow, re.MULTILINE)
    source = re.search(r"^  NIRS4ALL_SOURCE_URL: .+/archive/([0-9a-f]{40})\.tar\.gz$", workflow, re.MULTILINE)
    assert ref is not None
    assert source is not None
    assert ref.group(1) == source.group(1) == "bcea63bf6fdee8d08f2c65f3cd0cf994258b2b4c"
    wheel_url = re.search(r"^  NIRS4ALL_WHEEL_URL: (https://files\.pythonhosted\.org/.+/nirs4all-1\.1\.5-py3-none-any\.whl)$", workflow, re.MULTILINE)
    wheel_sha = re.search(r"^  NIRS4ALL_WHEEL_SHA256: ([0-9a-f]{64})$", workflow, re.MULTILINE)
    assert wheel_url is not None
    assert wheel_sha is not None
    assert wheel_sha.group(1) == "d8af69437ecac1c814ec6d5ce22e8e8d5de758e0ebd1ac5131ae3383cd1e3fd0"
    assert f"ref: {version}" not in workflow

    dag_ref = re.search(r"^  DAG_ML_REF: ([0-9a-f]{40})$", workflow, re.MULTILINE)
    dag_source = re.search(r"^  DAG_ML_SOURCE_URL: .+/archive/([0-9a-f]{40})\.tar\.gz$", workflow, re.MULTILINE)
    assert dag_ref is not None
    assert dag_source is not None
    assert dag_ref.group(1) == dag_source.group(1) == "d351c33caf7264a9ed5faf7ad6223c5b492b9fb1"

    data_ref = re.search(r"^  DAG_ML_DATA_REF: ([0-9a-f]{40})$", workflow, re.MULTILINE)
    data_source = re.search(
        r"^  DAG_ML_DATA_SOURCE_URL: .+/archive/([0-9a-f]{40})\.tar\.gz$",
        workflow,
        re.MULTILINE,
    )
    assert data_ref is not None
    assert data_source is not None
    assert data_ref.group(1) == data_source.group(1) == "6a71216176556a582ba9b684cda37403014e41c2"

    tools_ref = re.search(r"^  NIRS4ALL_TOOLS_REF: ([0-9a-f]{40})$", workflow, re.MULTILINE)
    tools_source = re.search(
        r"^  NIRS4ALL_TOOLS_SOURCE_URL: .+/archive/([0-9a-f]{40})\.tar\.gz$",
        workflow,
        re.MULTILINE,
    )
    assert tools_ref is not None
    assert tools_source is not None
    assert tools_ref.group(1) == tools_source.group(1) == "88c2bc1e29603049cdbf1a1080a35845edf2f3c9"


def test_recommended_profiles_use_single_nirs4all_version() -> None:
    config = json.loads((ROOT / "recommended-config.json").read_text(encoding="utf-8"))
    version = config["nirs4all"]

    for profile in config["profiles"].values():
        package = profile.get("packages", {}).get("nirs4all")
        if package is None:
            continue
        assert package["recommended"] == version
        assert package["min"] == ">=1.1.5"


def test_release_builds_pinned_plugin_wheels_once_for_all_distributables() -> None:
    workflow = (ROOT / ".github" / "workflows" / "release-unified.yml").read_text(encoding="utf-8")

    assert "  pinned-plugin-wheels:\n" in workflow
    assert workflow.count("needs: [prepare, pinned-plugin-wheels]") == 4
    assert workflow.count("name: Download canonical plugin wheels") == 4
    assert workflow.count("--plugin-wheel _deps/pinned-plugin-wheels/nirs4all-1.1.5-py3-none-any.whl") == 4
    assert workflow.count("--tools-wheel _deps/pinned-plugin-wheels/nirs4all_tools-0.0.7-py3-none-any.whl") == 4
    assert 'curl --fail --location --proto "=https" --tlsv1.2' in workflow


def test_generated_operator_registries_are_from_the_published_runtime() -> None:
    python_versions: set[str] = set()
    for path in [
        ROOT / "src" / "data" / "nodes" / "generated" / "canonical-registry.meta.json",
        ROOT / "public" / "node-registry" / "extended.meta.json",
    ]:
        metadata = json.loads(path.read_text(encoding="utf-8"))
        assert metadata["nirs4allVersion"] == "1.1.5"
        assert metadata["pythonVersion"].startswith("3.11.")
        assert metadata["sklearnVersion"] == "1.9.0"
        python_versions.add(metadata["pythonVersion"])
    assert len(python_versions) == 1


def test_release_rebuilds_and_compares_the_exact_plugin_closure_twice() -> None:
    workflow = (ROOT / ".github" / "workflows" / "release-unified.yml").read_text(encoding="utf-8")
    constraints = (ROOT / "build" / "constraints" / "plugin-runtime-cpython311.txt").read_text(encoding="utf-8")

    assert "node scripts/verify-plugin-runtime-reproducibility.cjs" in workflow
    assert "plugin-runtime-reproducibility-${{ runner.os }}-${{ runner.arch }}.json" in workflow
    assert "nirs4all==1.1.5" in constraints
    assert "nirs4all-core==0.3.31" in constraints
    assert "nirs4all-methods==1.0.21" in constraints
    assert "scikit-learn==1.9.0" in constraints


def test_release_dispatch_never_publishes_docker_images() -> None:
    workflow = yaml.safe_load((ROOT / ".github" / "workflows" / "release-unified.yml").read_text(encoding="utf-8"))

    for step_name in ["Login to GitHub Container Registry", "Publish the tested Docker image"]:
        step = next(step for step in workflow["jobs"]["release"]["steps"] if step.get("name") == step_name)
        assert step["if"] == "needs.prepare.outputs.is_tag_release == 'true' && needs.prepare.outputs.skip_docker != 'true'"


def test_release_installed_upgrade_is_blocking_and_checksums_use_basenames() -> None:
    workflow = yaml.safe_load((ROOT / ".github" / "workflows" / "release-unified.yml").read_text(encoding="utf-8"))

    installers = {name: job for name, job in workflow["jobs"].items() if name.startswith("installer-")}
    assert set(installers) == {"installer-linux", "installer-windows", "installer-macos-x64", "installer-macos-arm64"}
    release = workflow["jobs"]["release"]
    for name, job in installers.items():
        assert name in release["needs"]
        assert f"needs.{name}.result == 'success'" in release["if"]
        steps = job["steps"]
        qualification = next(i for i, step in enumerate(steps) if "scripts/qualify-installer.cjs" in step.get("run", ""))
        upload = next(i for i, step in enumerate(steps) if step.get("name") == "Upload artifacts")
        assert qualification < upload
        assert not steps[qualification].get("continue-on-error", False)
        assert "INSTALLER_BASELINE" in steps[qualification]["env"]
        checksum = next(step["run"] for step in steps if step.get("name") == "Generate checksums")
        if name == "installer-windows":
            assert "$($_.Name)" in checksum
        else:
            assert checksum.startswith("cd release\n")
    # The existing finalizer verifies producer hashes and rewrites sidecars to
    # the exact public asset basename (GitHub normalizes spaces to dots).
    preparation = next(step for step in release["steps"] if step.get("name") == "Prepare release assets")
    assert "scripts/finalize-release-assets.cjs" in preparation["run"]
