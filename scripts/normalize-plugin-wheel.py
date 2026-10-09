"""Verify owner RECORD bytes and normalize wheel build metadata across hosts."""

from __future__ import annotations

import argparse
import base64
import csv
import hashlib
import io
import json
import os
import stat
import tempfile
import zipfile
from datetime import UTC, datetime
from pathlib import Path, PurePosixPath

MAX_ENTRIES = 4096
MAX_MEMBER_BYTES = 64 * 1024 * 1024
MAX_TOTAL_BYTES = 256 * 1024 * 1024


def normalize_wheel(source: Path, destination: Path, epoch: int, expected_manifest: str) -> dict[str, str | int]:
    """Reject altered/unbounded payloads before writing a portable ZIP container."""
    date = datetime.fromtimestamp(epoch, UTC)
    if not 1980 <= date.year <= 2107:
        raise ValueError("Wheel epoch is outside the ZIP date range")
    date_time = (date.year, date.month, date.day, date.hour, date.minute, date.second // 2 * 2)
    with zipfile.ZipFile(source) as archive:
        entries = archive.infolist()
        if not 1 <= len(entries) <= MAX_ENTRIES or sum(entry.file_size for entry in entries) > MAX_TOTAL_BYTES:
            raise ValueError("Wheel inventory exceeds its bound")
        names = [entry.filename for entry in entries]
        if len(set(names)) != len(names):
            raise ValueError("Wheel has duplicate members")
        for entry in entries:
            path = PurePosixPath(entry.filename)
            if (path.is_absolute() or ".." in path.parts or "\\" in entry.filename or ":" in entry.filename
                    or entry.is_dir() or str(path) != entry.filename or entry.file_size > MAX_MEMBER_BYTES
                    or stat.S_ISLNK(entry.external_attr >> 16) or entry.flag_bits & 1):
                raise ValueError("Wheel member is unsafe or oversized")
        record_names = [name for name in names if name.endswith(".dist-info/RECORD")]
        if len(record_names) != 1:
            raise ValueError("Wheel must have exactly one RECORD")
        payloads = {entry.filename: archive.read(entry) for entry in entries}

    record_name = record_names[0]
    rows = list(csv.reader(io.StringIO(payloads[record_name].decode("utf-8"))))
    if any(len(row) != 3 for row in rows) or len({row[0] for row in rows}) != len(rows) or {row[0] for row in rows} != set(names):
        raise ValueError("Wheel RECORD must biject with the complete inventory")
    for relative, encoded, size in rows:
        if relative == record_name:
            if encoded or size:
                raise ValueError("RECORD cannot self-hash")
            continue
        algorithm, separator, expected = encoded.partition("=")
        if separator != "=" or algorithm != "sha256" or not size.isdecimal():
            raise ValueError("Every wheel payload needs its exact SHA-256 and size")
        payload = payloads[relative]
        actual = base64.urlsafe_b64encode(hashlib.sha256(payload).digest()).decode("ascii").rstrip("=")
        if actual != expected or len(payload) != int(size):
            raise ValueError(f"Wheel RECORD content mismatch: {relative}")
    # Setuptools writes RFC metadata using the host's text newline. All owner
    # code/data bytes remain untouched; only METADATA is normalized to LF and
    # its already-verified RECORD entry is recomputed before the exact gate.
    metadata_name = record_name.removesuffix("RECORD") + "METADATA"
    metadata = payloads[metadata_name]
    canonical_metadata = metadata.replace(b"\r\n", b"\n")
    if metadata != canonical_metadata:
        payloads[metadata_name] = canonical_metadata
        for row in rows:
            if row[0] == metadata_name:
                row[1] = "sha256=" + base64.urlsafe_b64encode(hashlib.sha256(canonical_metadata).digest()).decode("ascii").rstrip("=")
                row[2] = str(len(canonical_metadata))
        serialized = io.StringIO()
        csv.writer(serialized, lineterminator="\n").writerows(rows)
        payloads[record_name] = serialized.getvalue().encode("utf-8")
    verified = [tuple(row) for row in rows if row[1] and not row[0].endswith(".pyc") and not row[0].startswith("../../../")
                and row[0].rsplit("/", 1)[-1] not in {"INSTALLER", "REQUESTED", "direct_url.json"}]
    manifest = hashlib.sha256("".join(",".join(row) + "\n" for row in sorted(set(verified))).encode("utf-8")).hexdigest()
    if manifest != expected_manifest:
        raise ValueError(f"Wheel installed manifest mismatch: expected {expected_manifest}, got {manifest}")

    destination.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(prefix=".qualified-wheel-", dir=destination.parent)
    os.close(descriptor)
    try:
        # Stored entries avoid a dependency on the host's zlib implementation.
        with zipfile.ZipFile(temporary, "w", compression=zipfile.ZIP_STORED) as archive:
            for name, payload in sorted(payloads.items()):
                entry = zipfile.ZipInfo(name, date_time=date_time)
                entry.create_system = 3
                entry.external_attr = (stat.S_IFREG | 0o644) << 16
                archive.writestr(entry, payload)
        os.replace(temporary, destination)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
    return {"wheel_sha256": hashlib.sha256(destination.read_bytes()).hexdigest(), "installed_manifest_sha256": manifest, "record_entries_verified": len(verified)}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--epoch", required=True, type=int)
    parser.add_argument("--expected-manifest", required=True)
    arguments = parser.parse_args()
    print(json.dumps(normalize_wheel(arguments.input, arguments.output, arguments.epoch, arguments.expected_manifest), sort_keys=True))
