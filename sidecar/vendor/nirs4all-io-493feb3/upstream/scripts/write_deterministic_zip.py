#!/usr/bin/env python3
# SPDX-License-Identifier: CECILL-2.1 OR AGPL-3.0-or-later
"""Write a deterministic ZIP from a staged directory tree."""

from __future__ import annotations

import argparse
import os
import time
import zipfile
from pathlib import Path


def write_zip(source: Path, output: Path, epoch: int) -> None:
    stamp = time.gmtime(epoch)
    zip_stamp = (max(stamp.tm_year, 1980), stamp.tm_mon, stamp.tm_mday, stamp.tm_hour, stamp.tm_min, stamp.tm_sec)
    files = sorted((path for path in source.rglob("*") if path.is_file()), key=lambda path: path.relative_to(source.parent).as_posix().encode())
    temporary = output.with_suffix(output.suffix + ".tmp")
    with zipfile.ZipFile(temporary, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for path in files:
            name = path.relative_to(source.parent).as_posix()
            info = zipfile.ZipInfo(name, date_time=zip_stamp)
            info.create_system = 3
            info.external_attr = 0o100644 << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(info, path.read_bytes(), compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)
    os.replace(temporary, output)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("epoch", type=int)
    args = parser.parse_args()
    write_zip(args.source.resolve(), args.output.resolve(), args.epoch)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
