"""Derive the installed nirs4all manifest from an exact, verified wheel."""

from __future__ import annotations

import base64
import csv
import hashlib
import io
import json
import sys
from email.parser import Parser
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


def candidate_attestation(wheel_path: Path, source_root: Path, version: str) -> dict[str, object]:
    """Verify a local candidate against its source without claiming publication."""
    manifest = manifest_sha256(wheel_path)
    expected_filename = f"nirs4all-{version}-py3-none-any.whl"
    if wheel_path.name != expected_filename:
        raise ValueError(f"expected candidate filename {expected_filename}")
    with ZipFile(wheel_path) as wheel:
        metadata_paths = [name for name in wheel.namelist() if name.endswith(".dist-info/METADATA")]
        if len(metadata_paths) != 1:
            raise ValueError("candidate must contain exactly one METADATA")
        metadata = Parser().parsestr(wheel.read(metadata_paths[0]).decode("utf-8"))
        if metadata["Name"] != "nirs4all" or metadata["Version"] != version:
            raise ValueError("candidate distribution metadata differs from selected release")
        members = {name for name in wheel.namelist() if name.startswith("nirs4all/") and name.endswith(".py")}
        source_members = {
            path.relative_to(source_root).as_posix()
            for path in (source_root / "nirs4all").rglob("*.py")
            if "__pycache__" not in path.parts
        }
        if members != source_members:
            raise ValueError("candidate Python member inventory differs from selected source")
        for member in sorted(members):
            if wheel.read(member) != (source_root / member).read_bytes():
                raise ValueError(f"candidate source payload differs: {member}")
        callable_hash = hashlib.sha256(wheel.read("nirs4all/api/studio_scientific.py")).hexdigest()
    return {
        "publication_status": "pending",
        "public_registry_verified": False,
        "wheel_filename": expected_filename,
        "wheel_sha256": hashlib.sha256(wheel_path.read_bytes()).hexdigest(),
        "installed_manifest_sha256": manifest,
        "callable_sha256": callable_hash,
        "distribution_version": version,
        "source_payload_verified": True,
    }


if __name__ == "__main__":
    if len(sys.argv) == 2:
        print(manifest_sha256(Path(sys.argv[1])))
    elif len(sys.argv) == 5 and sys.argv[2] == "--candidate-source":
        print(json.dumps(candidate_attestation(Path(sys.argv[1]), Path(sys.argv[3]), sys.argv[4]), indent=2))
    else:
        raise SystemExit("usage: candidate_wheel_manifest.py WHEEL [--candidate-source SOURCE_ROOT VERSION]")
