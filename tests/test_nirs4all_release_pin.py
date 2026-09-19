from __future__ import annotations

import json
import re
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]


def test_release_workflows_embed_recommended_nirs4all_version() -> None:
    config = json.loads((ROOT / "recommended-config.json").read_text(encoding="utf-8"))
    version = config["nirs4all"]
    workflow = (ROOT / ".github" / "workflows" / "release-unified.yml").read_text(encoding="utf-8")
    manifest = json.loads((ROOT / "build" / "recovery-library.json").read_text(encoding="utf-8"))

    assert version == "1.0.2"
    assert manifest["version"] == version
    assert re.fullmatch(r"[a-f0-9]{40}", manifest["source_commit"])
    assert re.fullmatch(r"[a-f0-9]{64}", manifest["source_sha256"])
    assert manifest["source_commit"] in manifest["source_url"]
    assert workflow.count("python scripts/build-recovery-library.py") == 1
    jobs = yaml.safe_load(workflow)["jobs"]
    for name in ("installer", "docker"):
        assert jobs[name]["needs"] == "quality"
        download = next(step for step in jobs[name]["steps"] if str(step.get("uses", "")).startswith("actions/download-artifact@"))
        assert download["with"] == {"name": "recovery-library-wheel", "path": "vendor/python/"}
    assert f"vendor/python/nirs4all-{version}-py3-none-any.whl" in workflow


def test_recommended_profiles_use_single_nirs4all_version() -> None:
    config = json.loads((ROOT / "recommended-config.json").read_text(encoding="utf-8"))
    version = config["nirs4all"]

    for profile in config["profiles"].values():
        package = profile.get("packages", {}).get("nirs4all")
        if package is None:
            continue
        assert package["recommended"] == version
        assert package["min"] == f"=={version}"
