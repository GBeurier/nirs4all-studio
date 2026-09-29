"""Derive the installed nirs4all manifest from an exact, verified wheel."""

from __future__ import annotations

import base64
import csv
import hashlib
import io
import sys
from pathlib import Path, PurePosixPath
from zipfile import ZipFile


def manifest_sha256(wheel_path: Path) -> str:
    """Return the same canonical RECORD manifest checked by the packaged runtime."""
    with ZipFile(wheel_path) as wheel:
        members = [member for member in wheel.infolist() if not member.is_dir()]
        names = [member.filename for member in members]
        if len(names) != len(set(names)):
            raise ValueError("wheel contains duplicate member paths")
        records = [name for name in names if name.endswith(".dist-info/RECORD")]
        if len(records) != 1:
            raise ValueError("wheel must contain exactly one RECORD")
        for name in names:
            path = PurePosixPath(name)
            if path.is_absolute() or ".." in path.parts or any(part.endswith(".data") for part in path.parts):
                raise ValueError(f"unsupported wheel member path: {name}")

        rows = list(csv.reader(io.StringIO(wheel.read(records[0]).decode("utf-8"))))
        if any(len(row) != 3 for row in rows) or len(rows) != len(names):
            raise ValueError("RECORD does not describe every wheel member")
        if len({row[0] for row in rows}) != len(rows) or {row[0] for row in rows} != set(names):
            raise ValueError("RECORD member paths differ from wheel members")
        canonical: list[tuple[str, str, str]] = []
        for name, encoded, size in rows:
            if name == records[0]:
                if encoded or size:
                    raise ValueError("RECORD must not hash itself")
                continue
            if not encoded.startswith("sha256=") or not size.isdecimal():
                raise ValueError(f"missing SHA-256 or size for {name}")
            payload = wheel.read(name)
            digest = base64.urlsafe_b64encode(hashlib.sha256(payload).digest()).decode("ascii").rstrip("=")
            if encoded != f"sha256={digest}" or int(size) != len(payload):
                raise ValueError(f"RECORD integrity mismatch for {name}")
            canonical.append((name, encoded, size))
    if not canonical:
        raise ValueError("wheel has no hashed members")
    manifest = "".join(",".join(row) + "\n" for row in sorted(canonical)).encode("utf-8")
    return hashlib.sha256(manifest).hexdigest()


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("usage: candidate_wheel_manifest.py WHEEL")
    print(manifest_sha256(Path(sys.argv[1])))
