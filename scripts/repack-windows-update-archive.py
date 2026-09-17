"""Wrap a qualified flat Windows ZIP without changing any application bytes."""
from __future__ import annotations

import argparse
import copy
import hashlib
import json
import shutil
import zipfile
from pathlib import Path, PurePosixPath


def digest(stream) -> str:
    hasher = hashlib.sha256()
    for chunk in iter(lambda: stream.read(1024 * 1024), b""):
        hasher.update(chunk)
    return hasher.hexdigest()


def repack(source: Path, destination: Path) -> dict[str, object]:
    if destination.exists() or source.resolve() == destination.resolve():
        raise ValueError("Destination must be a new file; preserve the qualified input archive")
    prefix = "nirs4all Studio/"
    destination.parent.mkdir(parents=True, exist_ok=True)
    member_hashes: dict[str, str] = {}
    with zipfile.ZipFile(source) as original:
        names = original.namelist()
        if len(names) != len(set(names)):
            raise ValueError("Duplicate archive member names")
        if "nirs4all Studio.exe" not in names:
            raise ValueError("Expected the qualified flat Windows application ZIP")
        for name in names:
            member = PurePosixPath(name)
            if member.is_absolute() or ".." in member.parts or "\\" in name or ":" in name:
                raise ValueError(f"Unsafe archive member: {name}")
        with zipfile.ZipFile(destination, "x", allowZip64=True) as wrapped:
            for info in original.infolist():
                renamed = copy.copy(info)
                renamed.filename = prefix + info.filename
                renamed.orig_filename = renamed.filename
                if info.is_dir():
                    wrapped.writestr(renamed, b"")
                    continue
                with original.open(info) as reader, wrapped.open(renamed, "w", force_zip64=True) as writer:
                    shutil.copyfileobj(reader, writer, length=1024 * 1024)
                with original.open(info) as reader:
                    member_hashes[renamed.filename] = digest(reader)
    with zipfile.ZipFile(destination) as wrapped:
        if wrapped.namelist() != [prefix + name for name in names]:
            raise ValueError("Repack changed the member set")
        for name, expected in member_hashes.items():
            with wrapped.open(name) as reader:
                if digest(reader) != expected:
                    raise ValueError(f"Repack changed application bytes: {name}")
    with source.open("rb") as stream:
        source_hash = digest(stream)
    with destination.open("rb") as stream:
        destination_hash = digest(stream)
    Path(str(destination) + ".sha256").write_text(
        f"{destination_hash}  {destination.name}\n", encoding="utf-8"
    )
    return {
        "source_sha256": source_hash,
        "archive_sha256": destination_hash,
        "application_files_verified_identical": len(member_hashes),
        "top_level_directory": prefix.rstrip("/"),
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("destination", type=Path)
    args = parser.parse_args()
    print(json.dumps(repack(args.source, args.destination), indent=2))
