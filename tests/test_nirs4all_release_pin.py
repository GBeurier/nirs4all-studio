from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_release_workflows_embed_recommended_nirs4all_version() -> None:
    config = json.loads((ROOT / "recommended-config.json").read_text(encoding="utf-8"))
    version = config["nirs4all"]
    workflow = (ROOT / ".github" / "workflows" / "release-unified.yml").read_text(encoding="utf-8")

    assert version == "0.11.0"
    assert f"ref: {version}" in workflow
    assert f"NIRS4ALL_VERSION={version}" in workflow
    assert "ref: 0.10.0" not in workflow
    assert "NIRS4ALL_VERSION=0.10.0" not in workflow


def test_recommended_profiles_use_single_nirs4all_version() -> None:
    config = json.loads((ROOT / "recommended-config.json").read_text(encoding="utf-8"))
    version = config["nirs4all"]

    for profile in config["profiles"].values():
        package = profile.get("packages", {}).get("nirs4all")
        if package is None:
            continue
        assert package["recommended"] == version
        assert re.fullmatch(r">=0\.10\.\d+", package["min"])
