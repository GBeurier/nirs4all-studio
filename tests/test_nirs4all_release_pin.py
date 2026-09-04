from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_release_workflow_uses_immutable_nirs4all_source() -> None:
    config = json.loads((ROOT / "recommended-config.json").read_text(encoding="utf-8"))
    version = config["nirs4all"]
    workflow = (ROOT / ".github" / "workflows" / "release-unified.yml").read_text(encoding="utf-8")

    assert version == "1.0.0rc2"
    ref = re.search(r"^  NIRS4ALL_LIBRARY_REF: ([0-9a-f]{40})$", workflow, re.MULTILINE)
    source = re.search(r"^  NIRS4ALL_SOURCE_URL: .+/archive/([0-9a-f]{40})\.tar\.gz$", workflow, re.MULTILINE)
    assert ref is not None
    assert source is not None
    assert ref.group(1) == source.group(1) == "6429974a88cccc3fbf8dbe8aeb060435381f2bd4"
    assert f"ref: {version}" not in workflow

    dag_ref = re.search(r"^  DAG_ML_REF: ([0-9a-f]{40})$", workflow, re.MULTILINE)
    dag_source = re.search(r"^  DAG_ML_SOURCE_URL: .+/archive/([0-9a-f]{40})\.tar\.gz$", workflow, re.MULTILINE)
    assert dag_ref is not None
    assert dag_source is not None
    assert dag_ref.group(1) == dag_source.group(1) == "1caa26dc9b90f33bc3f53b15b4d85e18f3f67381"

    data_ref = re.search(r"^  DAG_ML_DATA_REF: ([0-9a-f]{40})$", workflow, re.MULTILINE)
    data_source = re.search(
        r"^  DAG_ML_DATA_SOURCE_URL: .+/archive/([0-9a-f]{40})\.tar\.gz$",
        workflow,
        re.MULTILINE,
    )
    assert data_ref is not None
    assert data_source is not None
    assert data_ref.group(1) == data_source.group(1) == "7d9b9fed04c135ed4c2bba472c782aca7ef85807"

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
        assert re.fullmatch(r">=0\.10\.\d+", package["min"])


def test_release_builds_pinned_plugin_wheels_once_for_all_distributables() -> None:
    workflow = (ROOT / ".github" / "workflows" / "release-unified.yml").read_text(encoding="utf-8")

    assert "  pinned-plugin-wheels:\n" in workflow
    assert workflow.count("needs: [prepare, pinned-plugin-wheels]") == 8
    assert workflow.count("name: Download canonical plugin wheels") == 8
    assert workflow.count("--plugin-wheel _deps/pinned-plugin-wheels/nirs4all-1.0.0rc2-py3-none-any.whl") == 8
    assert workflow.count("--tools-wheel _deps/pinned-plugin-wheels/nirs4all_tools-0.0.7-py3-none-any.whl") == 8
    assert "GIT_CONFIG_KEY_0: core.autocrlf" in workflow
    assert "GIT_CONFIG_VALUE_0: 'false'" in workflow
