"""Prove that a baked Python runtime contains the exact candidate wheel files."""

from __future__ import annotations

import argparse
import hashlib
from pathlib import Path
from zipfile import ZipFile


def verify_wheel(site_packages: Path, wheel_path: Path) -> tuple[str, int]:
    if not wheel_path.is_file():
        raise ValueError(f"Candidate wheel is missing: {wheel_path}")
    checked = 0
    with ZipFile(wheel_path) as wheel:
        members = [member for member in wheel.infolist() if not member.is_dir()]
        records = [member.filename for member in members if member.filename.endswith(".dist-info/RECORD")]
        if len(records) != 1:
            raise ValueError(f"Expected one wheel RECORD: {wheel_path}")
        for member in members:
            relative = Path(member.filename)
            if relative.is_absolute() or ".." in relative.parts or any(part.endswith(".data") for part in relative.parts):
                raise ValueError(f"Unsupported wheel member path: {member.filename}")
            if member.filename == records[0]:
                # pip rewrites RECORD after installation.
                continue
            installed = site_packages / relative
            if not installed.is_file():
                raise ValueError(f"Candidate member is missing from runtime: {installed}")
            expected = hashlib.sha256(wheel.read(member)).digest()
            actual = hashlib.sha256(installed.read_bytes()).digest()
            if actual != expected:
                raise ValueError(f"Candidate member differs from wheel: {installed}")
            checked += 1
    if checked == 0:
        raise ValueError(f"Candidate wheel has no checked members: {wheel_path}")
    return wheel_path.name, checked


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("site_packages", type=Path)
    parser.add_argument("wheels", type=Path, nargs="+")
    args = parser.parse_args()
    if not args.site_packages.is_dir():
        parser.error(f"site-packages is missing: {args.site_packages}")
    for wheel_path in args.wheels:
        name, checked = verify_wheel(args.site_packages, wheel_path)
        print(f"{name}: {checked} exact installed members")


if __name__ == "__main__":
    main()
