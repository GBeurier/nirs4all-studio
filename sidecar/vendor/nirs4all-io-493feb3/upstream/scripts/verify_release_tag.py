#!/usr/bin/env python3
# SPDX-License-Identifier: CECILL-2.1 OR AGPL-3.0-or-later
"""Fail a tag-triggered release when its tag differs from the Cargo version."""

from __future__ import annotations

import os
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def workspace_version(manifest: Path = ROOT / "Cargo.toml") -> str:
    match = re.search(
        r"\[workspace\.package\][\s\S]*?^version\s*=\s*\"([^\"]+)\"",
        manifest.read_text(encoding="utf-8"),
        re.MULTILINE,
    )
    if match is None:
        raise SystemExit(f"could not resolve [workspace.package] version from {manifest}")
    return match.group(1)


def verify(event_name: str, ref_name: str, version: str, ref_type: str = "") -> None:
    if event_name != "push" and ref_type != "tag":
        return
    expected = f"v{version}"
    if ref_name != expected:
        raise SystemExit(f"release tag mismatch: got {ref_name!r}, expected {expected!r}")


def main() -> int:
    version = workspace_version()
    event_name = os.environ.get("GITHUB_EVENT_NAME", "")
    ref_name = os.environ.get("GITHUB_REF_NAME", "")
    ref_type = os.environ.get("GITHUB_REF_TYPE", "")
    verify(event_name, ref_name, version, ref_type)
    print(f"release identity verified: version={version}, event={event_name or 'local'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
