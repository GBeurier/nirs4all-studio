#!/usr/bin/env python3
# SPDX-License-Identifier: CECILL-2.1 OR AGPL-3.0-or-later
"""Write the canonical local release receipt and checksum manifest."""

from __future__ import annotations

import argparse
import hashlib
import json
import platform
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RECEIPT_NAME = "qualification-receipt.json"
SUMS_NAME = "SHA256SUMS"
REQUIRED_ARTIFACTS = {
    "python_wheel": re.compile(r"(?:^|/)nirs4all_io-.*\.whl$"),
    "python_sdist": re.compile(r"(?:^|/)nirs4all_io-.*\.tar\.gz$"),
    "npm_tarball": re.compile(r"(?:^|/)nirs4all-io-wasm-.*\.tgz$"),
    "c_abi_archive": re.compile(r"(?:^|/)nirs4all-io-capi-.*\.tar\.gz$"),
    "matlab_archive": re.compile(r"(?:^|/)nirs4all-io-matlab-octave-.*\.zip$"),
    "source_tar": re.compile(r"(?:^|/)nirs4all-io-.*-src\.tar\.gz$"),
    "source_zip": re.compile(r"(?:^|/)nirs4all-io-.*-src\.zip$"),
    "cyclonedx_sbom": re.compile(r"(?:^|/)nirs4all-io-.*\.cdx\.json$"),
}
GLOBAL_REQUIRED_ARTIFACTS = {
    **REQUIRED_ARTIFACTS,
    "rust_core_crate": re.compile(r"(?:^|/)nirs4all-io-core-.*\.crate$"),
    "rust_facade_crate": re.compile(r"(?:^|/)nirs4all-io-[0-9].*\.crate$"),
    "rust_capi_crate": re.compile(r"(?:^|/)nirs4all-io-capi-.*\.crate$"),
    "rust_cli_crate": re.compile(r"(?:^|/)nirs4all-io-cli-.*\.crate$"),
    "r_source": re.compile(r"(?:^|/)nirs4allio_.*\.tar\.gz$"),
}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def git(*args: str) -> str:
    return subprocess.check_output(["git", "-C", str(ROOT), *args], text=True).strip()


def first_match(path: Path, pattern: str) -> str:
    match = re.search(pattern, path.read_text(encoding="utf-8"), re.MULTILINE)
    if match is None:
        raise SystemExit(f"could not resolve release metadata from {path}")
    return match.group(1)


def load_optional(path: Path) -> dict[str, object] | None:
    if not path.is_file():
        return None
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise SystemExit(f"release evidence must be a JSON object: {path}")
    return value


def source_matches(document: dict[str, object] | None, commit: str, tree: str) -> bool:
    if document is None:
        return False
    source = document.get("source")
    if isinstance(source, dict):
        return source.get("commit") == commit and source.get("tree") == tree and source.get("dirty") is False
    return (
        document.get("source_commit") == commit
        and document.get("source_tree") == tree
        and document.get("source_dirty") is False
    )


def required_artifact_status(
    paths: list[str],
    patterns: dict[str, re.Pattern[str]] = REQUIRED_ARTIFACTS,
) -> dict[str, bool]:
    return {
        role: any(pattern.search(path) is not None for path in paths)
        for role, pattern in patterns.items()
    }


def reproducibility_covers(
    document: dict[str, object] | None,
    artifact_hashes: dict[str, str],
    patterns: dict[str, re.Pattern[str]] = REQUIRED_ARTIFACTS,
) -> bool:
    if document is None:
        return False
    raw_artifacts = document.get("artifacts")
    if not isinstance(raw_artifacts, list):
        return False
    rows: dict[str, dict[str, object]] = {}
    for raw in raw_artifacts:
        if isinstance(raw, dict) and isinstance(raw.get("path"), str):
            rows[str(raw["path"])] = raw
    for pattern in patterns.values():
        candidates = [path for path in artifact_hashes if pattern.search(path)]
        if not candidates:
            return False
        if not any(
            path in rows
            and rows[path].get("byte_identical") is True
            and rows[path].get("sha256_a") == digest
            and rows[path].get("sha256_b") == digest
            for path in candidates
            for digest in (artifact_hashes[path],)
        ):
            return False
    return True


def assert_source_identity(commit: str, tree: str) -> None:
    if git("status", "--porcelain=v1", "--untracked-files=all"):
        raise SystemExit("source worktree changed while writing the release receipt")
    if git("rev-parse", "HEAD") != commit or git("rev-parse", "HEAD^{tree}") != tree:
        raise SystemExit("source identity changed while writing the release receipt")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("release_dir", type=Path)
    args = parser.parse_args()

    dirty = git("status", "--porcelain=v1", "--untracked-files=all")
    if dirty:
        parser.error("release receipts require a clean source worktree")

    release = args.release_dir.resolve()
    release.mkdir(parents=True, exist_ok=True)
    commit = git("rev-parse", "HEAD")
    tree = git("rev-parse", "HEAD^{tree}")
    version = first_match(
        ROOT / "Cargo.toml",
        r"\[workspace\.package\][\s\S]*?^version\s*=\s*\"([^\"]+)\"",
    )
    abi = first_match(
        ROOT / "crates/nirs4all-io-capi/src/lib.rs",
        r'^pub const N4IO_ABI_VERSION: &str = "([^"]+)";',
    )

    artifacts = []
    artifact_hashes: dict[Path, str] = {}
    for path in sorted(release.rglob("*"), key=lambda item: item.relative_to(release).as_posix()):
        if not path.is_file() or path.name in {RECEIPT_NAME, SUMS_NAME}:
            continue
        digest = sha256(path)
        artifact_hashes[path] = digest
        artifacts.append(
            {
                "path": path.relative_to(release).as_posix(),
                "sha256": digest,
                "size": path.stat().st_size,
            }
        )

    gates = load_optional(release / "local-gates.json")
    reproducibility = load_optional(release / "reproducibility.json")
    cross_binding = load_optional(release / "io-xlg-001-report.json")
    release_matrix = load_optional(release / "release-matrix.json")
    attestations = load_optional(release / "attestations.json")
    gates_pass = bool(
        gates
        and gates.get("overall_passed") is True
        and source_matches(gates, commit, tree)
    )
    reproducibility_identity_pass = bool(
        reproducibility
        and reproducibility.get("overall_passed") is True
        and source_matches(reproducibility, commit, tree)
    )
    cross_source_matches = source_matches(cross_binding, commit, tree)
    local_surfaces_pass = False
    if cross_binding:
        raw_rows = cross_binding.get("rows", [])
        rows: dict[str, dict[str, object]] = {}
        if isinstance(raw_rows, list):
            for row in raw_rows:
                if isinstance(row, dict) and isinstance(row.get("surface"), str):
                    rows[str(row["surface"])] = row
        local_surfaces_pass = cross_source_matches and all(
            rows.get(surface, {}).get("disposition") == "passed"
            for surface in ("rust", "python", "wasm", "c_abi")
        )

    artifact_status = required_artifact_status([str(item["path"]) for item in artifacts])
    global_artifact_status = required_artifact_status(
        [str(item["path"]) for item in artifacts],
        GLOBAL_REQUIRED_ARTIFACTS,
    )
    artifacts_complete = all(artifact_status.values())
    reproducibility_pass = reproducibility_identity_pass and reproducibility_covers(
        reproducibility,
        {str(item["path"]): str(item["sha256"]) for item in artifacts},
    )
    local_go = gates_pass and reproducibility_pass and local_surfaces_pass and artifacts_complete
    global_go = bool(
        local_go
        and all(global_artifact_status.values())
        and reproducibility_covers(
            reproducibility,
            {str(item["path"]): str(item["sha256"]) for item in artifacts},
            GLOBAL_REQUIRED_ARTIFACTS,
        )
        and cross_binding
        and cross_binding.get("overall_complete") is True
        and release_matrix
        and release_matrix.get("overall_passed") is True
        and source_matches(release_matrix, commit, tree)
        and attestations
        and attestations.get("overall_verified") is True
        and source_matches(attestations, commit, tree)
    )

    receipt = {
        "schema_version": 1,
        "project": "nirs4all-io",
        "version": version,
        "source": {
            "commit": commit,
            "tree": tree,
            "dirty": False,
            "commit_epoch": int(git("log", "-1", "--format=%ct", "HEAD")),
        },
        "contracts": {
            "dataset_spec": 1,
            "canonical_json": 1,
            "assembled_dataset": 2,
            "dataset_package": 3,
            "c_abi": abi,
            "dag_ml_data": "0.2.9",
        },
        "verdict": {
            "local_linux": "GO" if local_go else "NO-GO",
            "global_release": "GO" if global_go else "NO-GO",
        },
        "evidence": {
            "local_gates": gates,
            "cross_binding": cross_binding,
            "reproducibility": reproducibility,
            "release_matrix": release_matrix,
            "attestations": attestations,
            "required_artifacts": artifact_status,
            "global_required_artifacts": global_artifact_status,
        },
        "artifacts": artifacts,
        "locks": {
            path.relative_to(ROOT).as_posix(): sha256(path)
            for path in (
                ROOT / "Cargo.lock",
                ROOT / "bindings/python/Cargo.lock",
                ROOT / "bindings/wasm/Cargo.lock",
                ROOT / "bindings/r/Cargo.lock.rust",
            )
        },
        "host": {
            "platform": platform.platform(),
            "python": sys.version.splitlines()[0],
        },
        "reserves": [
            "Rust package builds are compared at one stable logical build root per platform; remapping removes host paths but Cargo package identity remains build-root-sensitive",
            "R and MATLAB/Octave qualification unavailable on the local host",
            "macOS and Windows binary matrices require CI runners",
            "Sigstore/OIDC attestations and registry publication require release CI",
            "R source archive byte reproducibility remains a CI follow-up",
        ],
    }
    assert_source_identity(commit, tree)
    if any(not path.is_file() or sha256(path) != digest for path, digest in artifact_hashes.items()):
        raise SystemExit("release evidence changed while writing the receipt")
    receipt_path = release / RECEIPT_NAME
    receipt_tmp = release / f".{RECEIPT_NAME}.tmp"
    receipt_tmp.write_text(
        json.dumps(receipt, indent=2, sort_keys=True, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    receipt_tmp.replace(receipt_path)

    members = sorted(
        (path for path in release.rglob("*") if path.is_file() and path.name != SUMS_NAME),
        key=lambda item: item.relative_to(release).as_posix(),
    )
    sums = "".join(f"{sha256(path)}  {path.relative_to(release).as_posix()}\n" for path in members)
    assert_source_identity(commit, tree)
    if any(not path.is_file() or sha256(path) != digest for path, digest in artifact_hashes.items()):
        raise SystemExit("release evidence changed before checksum finalization")
    sums_tmp = release / f".{SUMS_NAME}.tmp"
    sums_tmp.write_text(sums, encoding="utf-8")
    sums_tmp.replace(release / SUMS_NAME)
    print(f"{sha256(receipt_path)}  {receipt_path}")
    print(f"{sha256(release / SUMS_NAME)}  {release / SUMS_NAME}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
