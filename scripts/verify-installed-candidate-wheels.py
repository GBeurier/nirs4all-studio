"""Prove that a baked Python runtime contains the exact candidate wheel files."""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
from pathlib import Path
from zipfile import ZipFile

MACH_O_MAGICS = {bytes.fromhex(value) for value in ("cafebabe", "cafebabf", "bebafeca", "bfbafeca", "cefaedfe", "cffaedfe", "feedface", "feedfacf")}


def load_signing_attestation(path: Path) -> tuple[Path, dict[str, dict[str, str]]]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if payload.get("schema_version") != 1 or not isinstance(payload.get("members"), list):
        raise ValueError(f"Invalid macOS signing attestation: {path}")
    backend_root = path.resolve().parent.parent
    members = {}
    for member in payload["members"]:
        relative = Path(member["path"])
        if relative.is_absolute() or ".." in relative.parts or not relative.parts:
            raise ValueError(f"Invalid signed member path: {member['path']}")
        if str(relative.as_posix()) in members:
            raise ValueError(f"Duplicate signed member: {relative}")
        for field in ("pre_sign_sha256", "post_sign_sha256"):
            value = member[field]
            if not isinstance(value, str) or len(value) != 64 or any(char not in "0123456789abcdef" for char in value):
                raise ValueError(f"Invalid {field} for signed member: {relative}")
        members[relative.as_posix()] = member
    if not members:
        raise ValueError("macOS signing attestation has no members")
    return backend_root, members


def verify_wheel(
    site_packages: Path,
    wheel_path: Path,
    signing_attestation: tuple[Path, dict[str, dict[str, str]]] | None = None,
) -> tuple[str, int]:
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
            wheel_bytes = wheel.read(member)
            expected = hashlib.sha256(wheel_bytes).hexdigest()
            actual = hashlib.sha256(installed.read_bytes()).hexdigest()
            signed_member = None
            if signing_attestation is not None:
                backend_root, signed_members = signing_attestation
                relative_installed = installed.resolve().relative_to(backend_root).as_posix()
                signed_member = signed_members.get(relative_installed)
            if signed_member is not None:
                if wheel_bytes[:4] not in MACH_O_MAGICS:
                    raise ValueError(f"Signed wheel member is not Mach-O: {installed}")
                if expected != signed_member["pre_sign_sha256"] or actual != signed_member["post_sign_sha256"]:
                    raise ValueError(f"Signed wheel member differs from attested transformation: {installed}")
                subprocess.run(["/usr/bin/codesign", "--verify", "--strict", str(installed)], check=True)
            elif actual != expected:
                raise ValueError(f"Candidate member differs from wheel: {installed}")
            checked += 1
    if checked == 0:
        raise ValueError(f"Candidate wheel has no checked members: {wheel_path}")
    return wheel_path.name, checked


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("site_packages", type=Path)
    parser.add_argument("wheels", type=Path, nargs="+")
    parser.add_argument("--macos-signing-attestation", type=Path)
    args = parser.parse_args()
    if not args.site_packages.is_dir():
        parser.error(f"site-packages is missing: {args.site_packages}")
    signing_attestation = load_signing_attestation(args.macos_signing_attestation) if args.macos_signing_attestation is not None else None
    for wheel_path in args.wheels:
        name, checked = verify_wheel(args.site_packages, wheel_path, signing_attestation)
        print(f"{name}: {checked} exact installed members")


if __name__ == "__main__":
    main()
