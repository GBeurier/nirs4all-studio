#!/usr/bin/env python3
# SPDX-License-Identifier: CECILL-2.1 OR AGPL-3.0-or-later
"""Normalize source paths and volatile metadata in a CycloneDX JSON SBOM."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

if __package__ in {None, ""}:
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from scripts.release_paths import normalize_source_strings, refuse_source_path_leaks


def canonicalize_arrays(value: Any) -> Any:
    """Recursively sort CycloneDX set-like arrays by canonical JSON value."""
    if isinstance(value, dict):
        return {key: canonicalize_arrays(item) for key, item in value.items()}
    if isinstance(value, list):
        items = [canonicalize_arrays(item) for item in value]
        return sorted(items, key=lambda item: json.dumps(item, sort_keys=True, ensure_ascii=False))
    return value


def validate_cyclonedx(document: object) -> dict[str, Any]:
    if not isinstance(document, dict):
        raise ValueError("CycloneDX document must be a JSON object")
    if document.get("bomFormat") != "CycloneDX":
        raise ValueError("SBOM bomFormat must be CycloneDX")
    if not isinstance(document.get("specVersion"), str):
        raise ValueError("SBOM specVersion is missing")
    if not isinstance(document.get("version"), int):
        raise ValueError("SBOM document version is missing")
    if not isinstance(document.get("components"), list):
        raise ValueError("SBOM components array is missing")
    return document


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def verify_subject(root: Path, subject: Path) -> str:
    """Prove that the scanned source tarball is the deterministic HEAD archive."""
    with tempfile.TemporaryDirectory(prefix="n4io-source-check-") as temporary:
        raw = Path(temporary) / "source.tar"
        expected = Path(temporary) / "source.tar.gz"
        prefix = subject.name.removesuffix("-src.tar.gz") + "/"
        with raw.open("wb") as stream:
            subprocess.run(
                ["git", "-C", str(root), "archive", "--format=tar", f"--prefix={prefix}", "HEAD"],
                stdout=stream,
                check=True,
            )
        with expected.open("wb") as stream:
            subprocess.run(["gzip", "-9", "-n", "-c", str(raw)], stdout=stream, check=True)
        if sha256(expected) != sha256(subject):
            raise ValueError("SBOM subject is not the deterministic source archive for HEAD")
    return sha256(subject)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("sbom", type=Path)
    parser.add_argument("subject", type=Path)
    args = parser.parse_args()

    root = Path(__file__).resolve().parent.parent
    dirty = subprocess.check_output(
        ["git", "-C", str(root), "status", "--porcelain=v1", "--untracked-files=all"],
        text=True,
    ).strip()
    if dirty:
        parser.error("SBOM normalization requires a clean source worktree")
    commit = subprocess.check_output(["git", "-C", str(root), "rev-parse", "HEAD"], text=True).strip()
    tree = subprocess.check_output(["git", "-C", str(root), "rev-parse", "HEAD^{tree}"], text=True).strip()
    epoch = int(subprocess.check_output(["git", "-C", str(root), "log", "-1", "--format=%ct", "HEAD"], text=True).strip())
    timestamp = datetime.fromtimestamp(epoch, UTC).isoformat().replace("+00:00", "Z")
    serial = f"urn:uuid:{uuid.uuid5(uuid.NAMESPACE_URL, f'https://github.com/GBeurier/nirs4all-io/commit/{commit}')}"
    subject = args.subject.resolve()
    subject_sha256 = verify_subject(root, subject)
    destination = args.sbom.resolve()
    temporary = tempfile.TemporaryDirectory(prefix="n4io-sbom-normalize-")
    candidate = Path(temporary.name) / destination.name
    shutil.copy2(destination, candidate)

    archive_prefix = args.subject.name.removesuffix("-src.tar.gz")
    document = validate_cyclonedx(
        canonicalize_arrays(
            normalize_source_strings(
                normalize_source_strings(
                    json.loads(candidate.read_text(encoding="utf-8")),
                    root / "sbom-root" / archive_prefix,
                ),
                root,
            )
        )
    )
    document["serialNumber"] = serial
    metadata = document.setdefault("metadata", {})
    if not isinstance(metadata, dict):
        raise ValueError("SBOM metadata must be an object")
    metadata["timestamp"] = timestamp
    properties = metadata.setdefault("properties", [])
    if not isinstance(properties, list):
        raise ValueError("SBOM metadata.properties must be an array")
    properties = [
        item
        for item in properties
        if not isinstance(item, dict) or item.get("name") != "nirs4all:source-archive-sha256"
    ]
    properties.append({"name": "nirs4all:source-archive-sha256", "value": subject_sha256})
    metadata["properties"] = canonicalize_arrays(properties)
    refuse_source_path_leaks(document, root)
    candidate.write_text(
        json.dumps(document, indent=2, sort_keys=True, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    if subprocess.check_output(
        ["git", "-C", str(root), "status", "--porcelain=v1", "--untracked-files=all"],
        text=True,
    ).strip():
        raise SystemExit("source worktree changed during SBOM normalization")
    if (
        subprocess.check_output(["git", "-C", str(root), "rev-parse", "HEAD"], text=True).strip() != commit
        or subprocess.check_output(["git", "-C", str(root), "rev-parse", "HEAD^{tree}"], text=True).strip() != tree
        or sha256(subject) != subject_sha256
    ):
        raise SystemExit("source identity or SBOM subject changed during normalization")
    os.replace(candidate, destination)
    temporary.cleanup()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
