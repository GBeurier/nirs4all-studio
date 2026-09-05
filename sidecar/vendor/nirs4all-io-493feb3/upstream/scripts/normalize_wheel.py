#!/usr/bin/env python3
# SPDX-License-Identifier: CECILL-2.1 OR AGPL-3.0-or-later
"""Canonicalize maturin's generated Rust SBOM and wheel container."""

from __future__ import annotations

import argparse
import base64
import csv
import hashlib
import io
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import uuid
import zipfile
from collections.abc import Iterator
from datetime import UTC, datetime
from pathlib import Path

if __package__ in {None, ""}:
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from scripts.release_paths import normalize_source_strings, refuse_source_path_leaks
from scripts.scan_artifact_paths import scan_paths


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("wheels", nargs="+", type=Path)
    return parser.parse_args()


def record_digest(data: bytes) -> str:
    value = base64.urlsafe_b64encode(hashlib.sha256(data).digest()).rstrip(b"=")
    return f"sha256={value.decode('ascii')}"


def normalize_wheel(wheel: Path, root: Path, epoch: int, commit: str) -> None:
    with zipfile.ZipFile(wheel, "r") as source:
        names = [info.filename for info in source.infolist()]
        if len(names) != len(set(names)):
            raise SystemExit(f"{wheel}: duplicate ZIP member")
        if any(name.startswith(("/", "\\")) or ".." in Path(name).parts for name in names):
            raise SystemExit(f"{wheel}: unsafe ZIP member")
        infos = {info.filename: info for info in source.infolist()}
        members = {name: source.read(name) for name in infos}

    signatures = [name for name in members if name.endswith(("RECORD.jws", "RECORD.p7s"))]
    if signatures:
        raise SystemExit(f"{wheel}: signed RECORD cannot be rewritten safely")
    metadata_names = [name for name in members if name.endswith(".dist-info/METADATA")]
    if len(metadata_names) != 1:
        raise SystemExit(f"{wheel}: expected exactly one dist-info/METADATA")
    version_match = re.search(
        r"\[workspace\.package\][\s\S]*?^version\s*=\s*\"([^\"]+)\"",
        (root / "Cargo.toml").read_text(encoding="utf-8"),
        re.MULTILINE,
    )
    metadata = members[metadata_names[0]].decode("utf-8")
    if version_match is None or f"Version: {version_match.group(1)}\n" not in metadata.replace("\r\n", "\n"):
        raise SystemExit(f"{wheel}: package version does not match the source workspace")

    sboms = sorted(name for name in members if ".dist-info/sboms/" in name)
    if not sboms:
        raise SystemExit(f"{wheel}: no embedded SBOM found")

    timestamp = datetime.fromtimestamp(epoch, UTC).isoformat().replace("+00:00", "Z")
    serial = f"urn:uuid:{uuid.uuid5(uuid.NAMESPACE_URL, f'https://github.com/GBeurier/nirs4all-io/commit/{commit}')}"

    for name in sboms:
        original_document = json.loads(members[name].decode("utf-8"))
        root_variants = {str(root.resolve()), root.resolve().as_posix(), str(root.resolve()).replace("/", "\\")}
        if not any(any(value in text for value in root_variants) for text in _iter_json_strings(original_document)):
            raise SystemExit(f"{wheel}: embedded SBOM is not tied to the current source checkout")
        document = normalize_source_strings(original_document, root)
        document.setdefault("metadata", {})["timestamp"] = timestamp
        document["serialNumber"] = serial
        refuse_source_path_leaks(document, root)
        members[name] = (json.dumps(document, indent=2, sort_keys=True, ensure_ascii=False) + "\n").encode()

    record_name = next((name for name in members if name.endswith(".dist-info/RECORD")), None)
    if record_name is None:
        raise SystemExit(f"{wheel}: RECORD is missing")
    rows = list(csv.reader(io.StringIO(members[record_name].decode("utf-8"))))
    record_members = [row[0] for row in rows]
    if len(record_members) != len(set(record_members)) or set(record_members) != set(members):
        raise SystemExit(f"{wheel}: RECORD does not describe every member exactly once")
    rewritten: list[list[str]] = []
    for row in rows:
        member_name = row[0]
        if member_name == record_name:
            rewritten.append([member_name, "", ""])
        elif member_name in members:
            data = members[member_name]
            rewritten.append([member_name, record_digest(data), str(len(data))])
        else:
            raise SystemExit(f"{wheel}: RECORD references missing member {member_name}")
    record = io.StringIO(newline="")
    csv.writer(record, lineterminator="\n").writerows(rewritten)
    members[record_name] = record.getvalue().encode("utf-8")

    stamp = datetime.fromtimestamp(epoch, UTC)
    zip_stamp = (max(stamp.year, 1980), stamp.month, stamp.day, stamp.hour, stamp.minute, stamp.second)
    temporary = wheel.with_suffix(f"{wheel.suffix}.tmp")
    order = sorted((name for name in members if name != record_name), key=str.encode) + [record_name]
    with zipfile.ZipFile(temporary, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as output:
        for name in order:
            original = infos[name]
            info = zipfile.ZipInfo(name, date_time=zip_stamp)
            info.compress_type = zipfile.ZIP_DEFLATED
            info.create_system = 3
            info.external_attr = original.external_attr
            info.flag_bits = original.flag_bits
            output.writestr(info, members[name], compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)
    os.replace(temporary, wheel)
    scan_paths([wheel])
    print(f"{hashlib.sha256(wheel.read_bytes()).hexdigest()}  {wheel}")


def _iter_json_strings(value: object) -> Iterator[str]:
    if isinstance(value, str):
        yield value
    elif isinstance(value, list):
        for item in value:
            yield from _iter_json_strings(item)
    elif isinstance(value, dict):
        for item in value.values():
            yield from _iter_json_strings(item)


def main() -> int:
    args = parse_args()
    root = Path(__file__).resolve().parent.parent
    dirty = subprocess.check_output(
        ["git", "-C", str(root), "status", "--porcelain=v1", "--untracked-files=all"],
        text=True,
    ).strip()
    if dirty:
        raise SystemExit("wheel normalization requires a clean source worktree")
    commit = subprocess.check_output(["git", "-C", str(root), "rev-parse", "HEAD"], text=True).strip()
    tree = subprocess.check_output(["git", "-C", str(root), "rev-parse", "HEAD^{tree}"], text=True).strip()
    epoch = int(subprocess.check_output(["git", "-C", str(root), "log", "-1", "--format=%ct", "HEAD"], text=True).strip())
    for wheel in args.wheels:
        destination = wheel.resolve()
        with tempfile.TemporaryDirectory(prefix="n4io-wheel-normalize-") as temporary:
            candidate = Path(temporary) / destination.name
            shutil.copy2(destination, candidate)
            normalize_wheel(candidate, root, epoch, commit)
            if subprocess.check_output(
                ["git", "-C", str(root), "status", "--porcelain=v1", "--untracked-files=all"],
                text=True,
            ).strip():
                raise SystemExit("source worktree changed during wheel normalization")
            if (
                subprocess.check_output(["git", "-C", str(root), "rev-parse", "HEAD"], text=True).strip() != commit
                or subprocess.check_output(["git", "-C", str(root), "rev-parse", "HEAD^{tree}"], text=True).strip() != tree
            ):
                raise SystemExit("source identity changed during wheel normalization")
            shutil.move(candidate, destination)
        print(f"{hashlib.sha256(destination.read_bytes()).hexdigest()}  {destination}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
