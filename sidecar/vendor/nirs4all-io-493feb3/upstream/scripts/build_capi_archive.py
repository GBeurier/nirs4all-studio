#!/usr/bin/env python3
# SPDX-License-Identifier: CECILL-2.1 OR AGPL-3.0-or-later
"""Build and package a checkout-independent C-ABI release archive."""

from __future__ import annotations

import argparse
import gzip
import hashlib
import io
import json
import re
import subprocess
import sys
import tarfile
import tempfile
from pathlib import Path

if __package__ in {None, ""}:
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from scripts.rust_reproducibility import reproducible_rust_env
from scripts.scan_artifact_paths import scan_paths


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("target_triple", help="Rust target triple, for example x86_64-unknown-linux-gnu")
    parser.add_argument("out_dir", type=Path, help="destination directory")
    return parser.parse_args()


def add_bytes(archive: tarfile.TarFile, name: str, data: bytes, mode: int, epoch: int) -> None:
    info = tarfile.TarInfo(name)
    info.size = len(data)
    info.mode = mode
    info.mtime = epoch
    info.uid = info.gid = 0
    info.uname = info.gname = ""
    archive.addfile(info, io.BytesIO(data))


def main() -> int:
    args = parse_args()
    if re.fullmatch(r"[A-Za-z0-9_.-]+", args.target_triple) is None:
        raise SystemExit(f"invalid target triple: {args.target_triple!r}")
    root = Path(__file__).resolve().parent.parent
    dirty = subprocess.check_output(
        ["git", "-C", str(root), "status", "--porcelain=v1", "--untracked-files=all"],
        text=True,
    ).strip()
    if dirty:
        raise SystemExit("C-ABI release archives require a clean source worktree")
    epoch = int(
        subprocess.check_output(
            ["git", "-C", str(root), "log", "-1", "--format=%ct", "HEAD"],
            text=True,
        ).strip()
    )
    commit = subprocess.check_output(["git", "-C", str(root), "rev-parse", "HEAD"], text=True).strip()
    tree = subprocess.check_output(["git", "-C", str(root), "rev-parse", "HEAD^{tree}"], text=True).strip()
    version_match = re.search(
        r"\[workspace\.package\][\s\S]*?^version\s*=\s*\"([^\"]+)\"",
        (root / "Cargo.toml").read_text(encoding="utf-8"),
        re.MULTILINE,
    )
    if version_match is None:
        raise SystemExit("could not resolve workspace version")
    version = version_match.group(1)

    legal = [
        root / "LICENSE",
        root / "LICENSING.md",
        root / "THIRD_PARTY_NOTICES.md",
        root / "COPY_PROVENANCE.md",
        *sorted((root / "LICENSES").iterdir(), key=lambda path: path.name.encode()),
    ]
    header = root / "crates/nirs4all-io-capi/include/nirs4all_io.h"
    committed_header = header.read_bytes()
    prefix = f"nirs4all-io-capi-{args.target_triple}"
    metadata = (
        json.dumps(
            {
                "project": "nirs4all-io-capi",
                "schema_version": 1,
                "source": {"commit": commit, "dirty": False, "tree": tree},
                "target_triple": args.target_triple,
                "version": version,
            },
            indent=2,
            sort_keys=True,
        )
        + "\n"
    ).encode("utf-8")
    scratch_root = root / "target" / "release-scratch"
    scratch_root.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="n4io-capi-build-", dir=scratch_root) as temporary:
        target_dir = Path(temporary) / "target"
        env = reproducible_rust_env(root, target_dir, extra_roots=(Path(temporary),))
        env["SOURCE_DATE_EPOCH"] = str(epoch)
        subprocess.run(
            [
                "cargo",
                "build",
                "-p",
                "nirs4all-io-capi",
                "--release",
                "--locked",
                "--target",
                args.target_triple,
            ],
            cwd=root,
            env=env,
            check=True,
        )
        # cbindgen rewrites the tracked header during every Cargo build. On
        # Windows its output can differ only by newline convention; package the
        # committed contract and restore the checkout before the cleanliness
        # assertion below.
        if header.read_bytes() != committed_header:
            header.write_bytes(committed_header)
        lib_dir = target_dir / args.target_triple / "release"
        # Ship the shared C ABI and its Windows import library. R and other
        # static consumers build the vendored staticlib themselves; Cargo's
        # prebuilt static archives retain toolchain scratch paths on macOS and
        # MSVC and are not portable release artifacts.
        patterns = ("libnirs4all_io_capi.*", "nirs4all_io_capi.dll", "nirs4all_io_capi.dll.lib")
        libraries = sorted(
            {
                path
                for pattern in patterns
                for path in lib_dir.glob(pattern)
                if path.is_file() and path.suffix not in {".a", ".d", ".rlib"}
            },
            key=lambda path: path.name.encode(),
        )
        if not libraries:
            raise SystemExit(f"no C-ABI library produced for {args.target_triple}")
        scan_paths(libraries, [temporary])
        if subprocess.check_output(
            ["git", "-C", str(root), "status", "--porcelain=v1", "--untracked-files=all"],
            text=True,
        ).strip():
            raise SystemExit("source worktree changed during the C-ABI build")
        if (
            subprocess.check_output(["git", "-C", str(root), "rev-parse", "HEAD"], text=True).strip() != commit
            or subprocess.check_output(["git", "-C", str(root), "rev-parse", "HEAD^{tree}"], text=True).strip() != tree
        ):
            raise SystemExit("source identity changed during the C-ABI build")
        members: list[tuple[str, Path, int]] = [
            (f"{prefix}/include/{header.name}", header, 0o644),
            *[(f"{prefix}/lib/{path.name}", path, 0o755) for path in libraries],
            *[(f"{prefix}/licenses/{path.name}", path, 0o644) for path in legal],
        ]
        members.sort(key=lambda item: item[0].encode())

        args.out_dir.mkdir(parents=True, exist_ok=True)
        output = args.out_dir / f"nirs4all-io-capi-{args.target_triple}.tar.gz"
        with output.open("wb") as raw:
            with gzip.GzipFile(filename="", mode="wb", compresslevel=9, fileobj=raw, mtime=epoch) as gz:
                with tarfile.open(fileobj=gz, mode="w", format=tarfile.GNU_FORMAT) as archive:
                    add_bytes(archive, f"{prefix}/RELEASE-METADATA.json", metadata, 0o644, epoch)
                    for name, source, mode in members:
                        add_bytes(archive, name, source.read_bytes(), mode, epoch)
        scan_paths([output], [temporary])

    digest = hashlib.sha256(output.read_bytes()).hexdigest()
    print(f"{digest}  {output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
