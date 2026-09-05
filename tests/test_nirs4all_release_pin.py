from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_release_workflow_uses_immutable_nirs4all_source() -> None:
    config = json.loads((ROOT / "recommended-config.json").read_text(encoding="utf-8"))
    version = config["nirs4all"]
    workflow = (ROOT / ".github" / "workflows" / "release-unified.yml").read_text(encoding="utf-8")

    assert version == "1.0.1"
    ref = re.search(r"^  NIRS4ALL_LIBRARY_REF: ([0-9a-f]{40})$", workflow, re.MULTILINE)
    source = re.search(r"^  NIRS4ALL_SOURCE_URL: .+/archive/([0-9a-f]{40})\.tar\.gz$", workflow, re.MULTILINE)
    assert ref is not None
    assert source is not None
    assert ref.group(1) == source.group(1) == "bf21c552b9d0929daf2dcc2ac7b220c9631ffa07"
    wheel_url = re.search(r"^  NIRS4ALL_WHEEL_URL: (https://files\.pythonhosted\.org/.+/nirs4all-1\.0\.1-py3-none-any\.whl)$", workflow, re.MULTILINE)
    wheel_sha = re.search(r"^  NIRS4ALL_WHEEL_SHA256: ([0-9a-f]{64})$", workflow, re.MULTILINE)
    assert wheel_url is not None
    assert wheel_sha is not None
    assert wheel_sha.group(1) == "d6f696580d4e52aeb6d39ecce47d30b3e10dc0b867f88f89f39dc1205cf93103"
    assert f"ref: {version}" not in workflow

    dag_ref = re.search(r"^  DAG_ML_REF: ([0-9a-f]{40})$", workflow, re.MULTILINE)
    dag_source = re.search(r"^  DAG_ML_SOURCE_URL: .+/archive/([0-9a-f]{40})\.tar\.gz$", workflow, re.MULTILINE)
    assert dag_ref is not None
    assert dag_source is not None
    assert dag_ref.group(1) == dag_source.group(1) == "233d4ecdae14d2a810f9b01b4ce7c15bdedc9d27"

    data_ref = re.search(r"^  DAG_ML_DATA_REF: ([0-9a-f]{40})$", workflow, re.MULTILINE)
    data_source = re.search(
        r"^  DAG_ML_DATA_SOURCE_URL: .+/archive/([0-9a-f]{40})\.tar\.gz$",
        workflow,
        re.MULTILINE,
    )
    assert data_ref is not None
    assert data_source is not None
    assert data_ref.group(1) == data_source.group(1) == "ffe533704a1a0b0c7bb7d97a997caade3f4ba36e"

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
        assert package["min"] == ">=1.0.1"


def test_release_builds_pinned_plugin_wheels_once_for_all_distributables() -> None:
    workflow = (ROOT / ".github" / "workflows" / "release-unified.yml").read_text(encoding="utf-8")

    assert "  pinned-plugin-wheels:\n" in workflow
    assert workflow.count("needs: [prepare, pinned-plugin-wheels]") == 8
    assert workflow.count("name: Download canonical plugin wheels") == 8
    assert workflow.count("--plugin-wheel _deps/pinned-plugin-wheels/nirs4all-1.0.1-py3-none-any.whl") == 8
    assert workflow.count("--tools-wheel _deps/pinned-plugin-wheels/nirs4all_tools-0.0.7-py3-none-any.whl") == 8
    assert 'curl --fail --location --proto "=https" --tlsv1.2' in workflow


def test_generated_operator_registries_are_from_the_published_runtime() -> None:
    for path in [
        ROOT / "src" / "data" / "nodes" / "generated" / "canonical-registry.meta.json",
        ROOT / "public" / "node-registry" / "extended.meta.json",
    ]:
        metadata = json.loads(path.read_text(encoding="utf-8"))
        assert metadata["nirs4allVersion"] == "1.0.1"
        assert metadata["pythonVersion"] == "3.11.13"
        assert metadata["sklearnVersion"] == "1.9.0"


def test_release_rebuilds_and_compares_the_exact_plugin_closure_twice() -> None:
    workflow = (ROOT / ".github" / "workflows" / "release-unified.yml").read_text(encoding="utf-8")
    constraints = (ROOT / "build" / "constraints" / "plugin-runtime-cpython311.txt").read_text(encoding="utf-8")

    assert "node scripts/verify-plugin-runtime-reproducibility.cjs" in workflow
    assert "plugin-runtime-reproducibility-${{ runner.os }}-${{ runner.arch }}.json" in workflow
    assert "nirs4all==1.0.1" in constraints
    assert "nirs4all-core==0.3.30" in constraints
    assert "nirs4all-methods==1.0.18" in constraints
    assert "scikit-learn==1.9.0" in constraints


def test_release_dispatch_never_publishes_docker_images() -> None:
    workflow = (ROOT / ".github" / "workflows" / "release-unified.yml").read_text(encoding="utf-8")

    for step_name in ["Login to GitHub Container Registry", "Build and push Docker image"]:
        guarded_step = re.search(
            rf"      - name: {re.escape(step_name)}\n"
            r"        if: needs\.prepare\.outputs\.is_tag_release == 'true'\n",
            workflow,
        )
        assert guarded_step is not None, f"manual release dispatch could publish in step: {step_name}"


def test_release_self_update_is_blocking_and_checksums_use_basenames() -> None:
    workflow = (ROOT / ".github" / "workflows" / "release-unified.yml").read_text(encoding="utf-8")

    assert workflow.count("name: Smoke test self-update (download -> apply -> relaunch)") == 4
    for match in re.finditer(r"name: Smoke test self-update \(download -> apply -> relaunch\)", workflow):
        step = workflow[match.start() : match.start() + 320]
        assert "continue-on-error" not in step
    assert 'sha256sum "$FILE" > "$FILE.sha256"' not in workflow
    assert 'shasum -a 256 "$FILE" > "$FILE.sha256"' not in workflow
    assert workflow.count('"$(basename "$FILE")" > "$(basename "$FILE").sha256"') == 3
