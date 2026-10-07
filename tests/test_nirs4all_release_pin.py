from __future__ import annotations

import json
import re
import subprocess
import tomllib
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]


def test_sidecar_resolves_selected_native_releases() -> None:
    manifest = tomllib.loads((ROOT / "sidecar" / "Cargo.toml").read_text(encoding="utf-8"))
    dependencies = manifest["dependencies"]
    assert dependencies["nirs4all"] == "=0.4.4"
    assert dependencies["nirs4all-io"] == "=0.2.6"
    # Native consumers use Core 0.4.4 public reexports and its exact DAG 0.3.39.
    assert "dag-ml-core" not in manifest.get("dev-dependencies", {})


def test_registry_lock_resolves_selected_native_releases() -> None:
    locked = tomllib.loads((ROOT / "sidecar" / "Cargo.lock").read_text(encoding="utf-8"))
    packages = {(package["name"], package["version"]) for package in locked["package"]}
    assert {("nirs4all", "0.4.4"), ("nirs4all-io", "0.2.6"), ("dag-ml", "0.3.39"),
            ("dag-ml-core", "0.3.39"), ("dag-ml-data", "0.2.13"), ("n4m", "0.4.0")} <= packages
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

    assert version == "1.4.6"
    ref = re.search(r"^  NIRS4ALL_LIBRARY_REF: ([0-9a-f]{40})$", workflow, re.MULTILINE)
    source = re.search(r"^  NIRS4ALL_SOURCE_URL: .+/archive/([0-9a-f]{40})\.tar\.gz$", workflow, re.MULTILINE)
    assert ref is not None
    assert source is not None
    assert ref.group(1) == source.group(1) == "1cc6b83d4c6d3904a0ce78f7b844056e47efd794"
    parsed = yaml.safe_load(workflow)
    contract = json.loads((ROOT / "sidecar/contracts/studio_scientific_cpython_host_v1.json").read_text())
    assert parsed["env"]["NIRS4ALL_WHEEL_SHA256"] == contract["selected_wheel_sha256"]
    validation = next(step["run"] for step in parsed["jobs"]["prepare"]["steps"]
                      if step.get("name") == "Validate pinned runtime dependency refs")
    environment = {key: "" if value is None else str(value) for key, value in parsed["env"].items()}
    if environment["NIRS4ALL_PUBLICATION_STATUS"] == "pending":
        assert contract["publication_status"] == "pending"
        assert contract["public_registry_verified"] is False
        assert subprocess.run(["bash", "-c", validation], env=environment, capture_output=True).returncode != 0
    else:
        assert environment["NIRS4ALL_PUBLICATION_STATUS"] == "published"
        assert contract["publication_status"] == "published"
        assert contract["public_registry_verified"] is True
        wheel_url = environment["NIRS4ALL_WHEEL_URL"]
        assert wheel_url == contract["selected_wheel_url"]
        assert wheel_url.startswith("https://files.pythonhosted.org/")
        assert wheel_url.endswith(f"/nirs4all-{version}-py3-none-any.whl")
        assert subprocess.run(["bash", "-c", validation], env=environment, capture_output=True).returncode == 0
        environment["NIRS4ALL_WHEEL_URL"] = wheel_url.replace(f"nirs4all-{version}-", "nirs4all-1.3.0-")
        assert subprocess.run(["bash", "-c", validation], env=environment, capture_output=True).returncode != 0
    assert f"ref: {version}" not in workflow

    dag_ref = re.search(r"^  DAG_ML_REF: ([0-9a-f]{40})$", workflow, re.MULTILINE)
    dag_source = re.search(r"^  DAG_ML_SOURCE_URL: .+/archive/([0-9a-f]{40})\.tar\.gz$", workflow, re.MULTILINE)
    assert dag_ref is not None
    assert dag_source is not None
    assert dag_ref.group(1) == dag_source.group(1) == "36af82eaf661de5c20311a3c2d55e24fbfcf287f"

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
        assert package["min"] == f">={version}"


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
                       if step.get("name") == "Acquire and verify canonical public wheels")
    assert acquisition.count('curl --fail --location --proto "=https" --tlsv1.2') == 2
    assert '"$NIRS4ALL_WHEEL_URL"' in acquisition
    assert '"$NIRS4ALL_TOOLS_WHEEL_URL"' in acquisition
    assert "9b152be79b7d510406d10da1cf097c5d67176334e2d54de0fd49ef0757774310" in acquisition
    assert "pip wheel" not in acquisition


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
    assert "nirs4all==1.4.6" in constraints
    assert "nirs4all-core==0.4.4" in constraints
    assert "nirs4all-io==0.2.6" in constraints
    assert "dag-ml-data==0.2.13" in constraints
    assert "nirs4all-methods==1.3.4" in constraints
    assert "pls4all==1.3.4" in constraints
    # Python DAG is independently published 0.3.40; Rust stays on Core's 0.3.39.
    assert "dag-ml==0.3.40" in constraints
    assert "nirs4all-formats==0.2.11" in constraints
    assert "nirs4all-tools==0.0.8" in constraints
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
        qualifier = steps[qualification]["run"]
        assert qualifier.count("--multimodal-provider-script _deps/nirs4all-qualification/tests/qualification/installed_multimodal_provider.py") == 1
        sdk_checkout = next(i for i, step in enumerate(steps)
                            if step.get("with", {}).get("repository") == "GBeurier/nirs4all")
        assert sdk_checkout < qualification
        assert steps[sdk_checkout]["with"]["ref"] == "1cc6b83d4c6d3904a0ce78f7b844056e47efd794"
        assert steps[sdk_checkout]["with"]["path"] == "_deps/nirs4all-qualification"
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
