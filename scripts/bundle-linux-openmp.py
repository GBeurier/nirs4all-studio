"""Bundle LightGBM's required OpenMP library before sealing the Linux runtime."""

from __future__ import annotations

import argparse
import base64
import csv
import hashlib
import json
import re
import shutil
import subprocess
from pathlib import Path


def record_entry(filename: Path, site_packages: Path) -> list[str]:
    data = filename.read_bytes()
    digest = base64.urlsafe_b64encode(hashlib.sha256(data).digest()).rstrip(b"=").decode()
    return [filename.relative_to(site_packages).as_posix(), f"sha256={digest}", str(len(data))]


def bundle_openmp(runtime_root: Path) -> dict:
    """Keep OpenMP private to LightGBM and preserve its wheel file inventory."""
    root = runtime_root.resolve(strict=True)
    site_packages = root / "lib/python3.11/site-packages"
    consumer = site_packages / "lightgbm/lib/lib_lightgbm.so"
    records = list(site_packages.glob("lightgbm-*.dist-info/RECORD"))
    if len(records) != 1:
        raise ValueError("Expected exactly one installed LightGBM wheel RECORD")
    record = records[0]
    for filename in [consumer, record]:
        if filename.resolve(strict=True) != filename or not filename.is_file():
            raise ValueError(f"Expected a canonical runtime file: {filename}")
    with record.open(newline="") as stream:
        rows = list(csv.reader(stream))
    original = record_entry(consumer, site_packages)
    if original not in rows:
        raise ValueError("LightGBM binary does not match its installed wheel RECORD")
    needed = subprocess.check_output(["patchelf", "--print-needed", str(consumer)], text=True).splitlines()
    if "libgomp.so.1" not in needed:
        raise ValueError("Expected LightGBM to require libgomp.so.1")
    cache = subprocess.check_output(["/sbin/ldconfig", "-p"], text=True)
    matches = re.findall(r"^\s*libgomp\.so\.1\s+\(libc6,x86-64[^)]*\)\s+=>\s+(.+)$", cache, re.MULTILINE)
    if not matches:
        raise ValueError("The Linux x64 builder must install libgomp1")
    source = Path(matches[0]).resolve(strict=True)
    license_file = Path("/usr/share/doc/libgomp1/copyright")
    library = consumer.with_name("libgomp.so.1")
    notice = consumer.with_name("libgomp.COPYING")
    for filename in [library, notice]:
        if filename.is_symlink() or filename.resolve() != filename:
            raise ValueError(f"Refusing a noncanonical bundled dependency: {filename}")
    shutil.copyfile(source, library)
    shutil.copyfile(license_file, notice)
    rpath = subprocess.check_output(["patchelf", "--print-rpath", str(consumer)], text=True).strip()
    paths = list(dict.fromkeys(["$ORIGIN", *filter(None, rpath.split(":"))]))
    subprocess.run(["patchelf", "--set-rpath", ":".join(paths), str(consumer)], check=True)
    replacements = {row[0]: row for row in [record_entry(filename, site_packages) for filename in [consumer, library, notice]]}
    rows = [row for row in rows if row[0] not in replacements]
    rows.extend(replacements.values())
    with record.open("w", newline="") as stream:
        csv.writer(stream).writerows(sorted(rows))
    return {"consumer": str(consumer.relative_to(root)), "openmp": str(library.relative_to(root)), "sha256": hashlib.sha256(library.read_bytes()).hexdigest()}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--runtime-root", type=Path, required=True)
    print(json.dumps(bundle_openmp(parser.parse_args().runtime_root), sort_keys=True))


if __name__ == "__main__":
    main()
