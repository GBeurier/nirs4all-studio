"""Create the Windows update ZIP with the single application root the updater requires."""

import argparse
import os
import tempfile
import zipfile
from pathlib import Path, PurePosixPath

PRODUCT_NAME = "nirs4all Studio"


def verify_archive(archive_path: Path) -> None:
    """Validate actual ZIP members and contents, not an independently wrapped fixture."""
    with zipfile.ZipFile(archive_path) as archive:
        names = archive.namelist()
        if len(names) != len(set(names)):
            raise ValueError("Windows update archive contains duplicate members")
        for name in names:
            parts = PurePosixPath(name).parts
            if "\\" in name or ".." in parts or not parts or parts[0] != PRODUCT_NAME or (len(parts) == 1 and not name.endswith("/")):
                raise ValueError(f"Windows update archive requires one application directory: {name}")
        for member in (f"{PRODUCT_NAME}/{PRODUCT_NAME}.exe", f"{PRODUCT_NAME}/resources/app.asar"):
            if member not in names or archive.getinfo(member).is_dir():
                raise ValueError(f"Windows update archive is missing {member}")
        bad_member = archive.testzip()
        if bad_member is not None:
            raise ValueError(f"Windows update archive CRC failed: {bad_member}")


def create_archive(app_path: Path, archive_path: Path) -> None:
    """Stream every member, including hidden files, then publish only a validated ZIP."""
    if not app_path.is_dir() or app_path.is_symlink():
        raise ValueError(f"Expected a regular Windows application directory: {app_path}")
    if archive_path.resolve().is_relative_to(app_path.resolve()):
        raise ValueError("Archive output must be outside the application directory")
    archive_path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary_name = tempfile.mkstemp(prefix=f".{archive_path.name}.", suffix=".tmp", dir=archive_path.parent)
    os.close(fd)
    temporary_path = Path(temporary_name)
    try:
        with zipfile.ZipFile(temporary_path, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6, allowZip64=True) as archive:
            archive.write(app_path, PRODUCT_NAME)
            for member in sorted(app_path.rglob("*")):
                if member.is_symlink() or not (member.is_file() or member.is_dir()):
                    raise ValueError(f"Unsupported Windows application member: {member}")
                archive.write(member, f"{PRODUCT_NAME}/{member.relative_to(app_path).as_posix()}")
        verify_archive(temporary_path)
        os.replace(temporary_path, archive_path)
    finally:
        temporary_path.unlink(missing_ok=True)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("app_path", type=Path)
    parser.add_argument("archive_path", type=Path)
    parser.add_argument("--verify-only", action="store_true")
    args = parser.parse_args()
    if args.verify_only:
        verify_archive(args.archive_path)
    else:
        create_archive(args.app_path, args.archive_path)
    print(f"Windows update ZIP verified: {args.archive_path}")


if __name__ == "__main__":
    main()
