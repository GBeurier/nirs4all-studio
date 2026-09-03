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
    assert ref.group(1) == source.group(1) == "3a38f589e5acbda58c5d071c95036f2572972ecd"
    assert f"ref: {version}" not in workflow

    dag_ref = re.search(r"^  DAG_ML_REF: ([0-9a-f]{40})$", workflow, re.MULTILINE)
    dag_source = re.search(r"^  DAG_ML_SOURCE_URL: .+/archive/([0-9a-f]{40})\.tar\.gz$", workflow, re.MULTILINE)
    assert dag_ref is not None
    assert dag_source is not None
    assert dag_ref.group(1) == dag_source.group(1) == "b08c62638829e0bcab741e66d44a3db66459e5a8"


def test_recommended_profiles_use_single_nirs4all_version() -> None:
    config = json.loads((ROOT / "recommended-config.json").read_text(encoding="utf-8"))
    version = config["nirs4all"]

    for profile in config["profiles"].values():
        package = profile.get("packages", {}).get("nirs4all")
        if package is None:
            continue
        assert package["recommended"] == version
        assert re.fullmatch(r">=0\.10\.\d+", package["min"])
