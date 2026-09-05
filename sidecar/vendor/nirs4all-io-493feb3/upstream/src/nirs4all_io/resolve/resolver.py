# SPDX-License-Identifier: CeCILL-2.1 OR AGPL-3.0-or-later
"""Resolver: normalize any input to a stable, ordered :class:`InputSet` (Epic 3.1).

Every item carries a **stable identity** (absolute path / archive member /
in-memory name), a **content hash** (so plans and fingerprints are reproducible),
an extension/format hint, and a **sidecar group** (companion files like ENVI
``.hdr``). Directory and glob expansions are **deterministically ordered**.
These properties are foundational (Critique C11): retrofitting identity later
would break fingerprints.

The resolver handles *data* inputs (a directory, a file, a glob, a file list,
in-memory arrays, a prebuilt records object, or a ``SpectroDataset``). Config
specs (dict / ``.json`` / ``.yaml``) are routed by the public API, not here.
"""

from __future__ import annotations

import glob as _glob
import hashlib
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

# Known sidecar relationships: primary-extension -> companion-extensions sharing the stem.
_SIDECAR_COMPANIONS: dict[str, tuple[str, ...]] = {
    ".img": (".hdr",),
    ".sli": (".hdr",),
    ".dat": (".hdr",),
    ".bil": (".hdr",),
    ".bsq": (".hdr",),
    ".bip": (".hdr",),
}
_GLOB_CHARS = set("*?[")


@dataclass
class InputItem:
    ref: str  # display reference (basename or relative path, or marker)
    kind: str  # "file" | "array" | "record_set" | "spectrodataset"
    identity: str  # stable id: absolute path | "array:<name>" | "object:<id>"
    content_hash: str | None = None
    extension: str | None = None
    sidecars: list[str] = field(default_factory=list)
    hints: dict[str, Any] = field(default_factory=dict)
    payload: Any = None  # in-memory array / prebuilt object (never serialized)


@dataclass
class InputSet:
    items: list[InputItem] = field(default_factory=list)
    origin: dict[str, Any] = field(default_factory=dict)

    @property
    def names(self) -> list[str]:
        return [it.ref for it in self.items]

    def files(self) -> list[InputItem]:
        return [it for it in self.items if it.kind == "file"]


def _sha256_file(path: Path, *, chunk: int = 1 << 20) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        while True:
            block = fh.read(chunk)
            if not block:
                break
            h.update(block)
    return h.hexdigest()


def _compound_extension(name: str) -> str:
    low = name.lower()
    for compound in (".csv.gz", ".csv.zip", ".tar.gz", ".tar.bz2", ".tar.xz"):
        if low.endswith(compound):
            return compound
    suffix = Path(name).suffix.lower()
    return suffix


def _is_glob(text: str) -> bool:
    return any(c in _GLOB_CHARS for c in text)


def _group_sidecars(paths: list[Path]) -> dict[str, list[str]]:
    """Map each primary file (abspath) to its companion sidecar abspaths."""
    by_stem: dict[tuple[str, str], list[Path]] = {}
    for p in paths:
        by_stem.setdefault((str(p.parent), p.stem), []).append(p)
    sidecars: dict[str, list[str]] = {}
    for group in by_stem.values():
        exts = {p.suffix.lower(): p for p in group}
        for ext, companions in _SIDECAR_COMPANIONS.items():
            primary = exts.get(ext)
            if primary is None:
                continue
            attached = [str(exts[c].resolve()) for c in companions if c in exts]
            if attached:
                sidecars[str(primary.resolve())] = attached
    return sidecars


def _file_item(path: Path, sidecar_map: dict[str, list[str]], *, base: Path | None = None) -> InputItem:
    abspath = str(path.resolve())
    ref = os.path.relpath(abspath, str(base)) if base else path.name
    return InputItem(
        ref=ref,
        kind="file",
        identity=abspath,
        content_hash=_sha256_file(path),
        extension=_compound_extension(path.name),
        sidecars=sidecar_map.get(abspath, []),
        hints={"basename": path.name, "stem": path.stem},
    )


def _resolve_dir(path: Path, *, recursive: bool) -> InputSet:
    pattern = "**/*" if recursive else "*"
    files = sorted((p for p in path.glob(pattern) if p.is_file()), key=lambda p: str(p.resolve()).lower())
    # sidecar files are attached to primaries, not listed as standalone items
    sidecar_map = _group_sidecars(files)
    attached = {s for group in sidecar_map.values() for s in group}
    items = [_file_item(p, sidecar_map, base=path) for p in files if str(p.resolve()) not in attached]
    return InputSet(items=items, origin={"kind": "directory", "ref": str(path.resolve()), "recursive": recursive})


def _resolve_paths(paths: list[str], *, recursive: bool) -> InputSet:
    expanded: list[Path] = []
    for raw in paths:
        if _is_glob(raw):
            expanded.extend(Path(p) for p in _glob.glob(raw, recursive=recursive))
        else:
            expanded.append(Path(raw))
    files = sorted((p for p in expanded if p.is_file()), key=lambda p: str(p.resolve()).lower())
    sidecar_map = _group_sidecars(files)
    attached = {s for group in sidecar_map.values() for s in group}
    items = [_file_item(p, sidecar_map) for p in files if str(p.resolve()) not in attached]
    missing = [raw for raw in paths if not _is_glob(raw) and not Path(raw).exists()]
    origin: dict[str, Any] = {"kind": "files", "ref": list(paths)}
    if missing:
        origin["missing"] = missing
    return InputSet(items=items, origin=origin)


def _array_item(name: str, array: Any) -> InputItem:
    try:
        import numpy as np

        arr = np.asarray(array)
        digest = hashlib.sha256(arr.tobytes()).hexdigest()
        shape = list(arr.shape)
    except Exception:  # noqa: BLE001 - hashing is best-effort for non-numpy payloads
        digest = None
        shape = None
    return InputItem(ref=name, kind="array", identity=f"array:{name}", content_hash=digest, extension=None, hints={"shape": shape}, payload=array)


def resolve(inp: Any, *, recursive: bool = False) -> InputSet:
    """Normalize ``inp`` into an ordered :class:`InputSet` with stable identities."""
    if isinstance(inp, (str, Path)):
        path = Path(inp)
        if path.is_dir():
            return _resolve_dir(path, recursive=recursive)
        if _is_glob(str(inp)):
            return _resolve_paths([str(inp)], recursive=recursive)
        return _resolve_paths([str(inp)], recursive=recursive)

    if isinstance(inp, (list, tuple)):
        if all(isinstance(x, (str, Path)) for x in inp):
            return _resolve_paths([str(x) for x in inp], recursive=recursive)
        # list/tuple of arrays -> in-memory items (e.g. [X], (X, y))
        items = [_array_item(f"arg{i}", x) for i, x in enumerate(inp)]
        return InputSet(items=items, origin={"kind": "in_memory", "ref": "sequence"})

    if isinstance(inp, dict):
        # dict-of-arrays (e.g. {"X": ..., "y": ...})
        items = [_array_item(str(k), v) for k, v in inp.items()]
        return InputSet(items=items, origin={"kind": "in_memory", "ref": "mapping"})

    # prebuilt objects: SpectroDataset (duck-typed) or a formats records object
    if hasattr(inp, "add_samples") or type(inp).__name__ == "SpectroDataset":
        return InputSet(items=[InputItem(ref="spectrodataset", kind="spectrodataset", identity=f"object:{id(inp)}", payload=inp)], origin={"kind": "spectrodataset"})
    if hasattr(inp, "to_spectrodataset") or type(inp).__name__ in {"SpectralRecordSet", "RecordSet"}:
        return InputSet(items=[InputItem(ref="record_set", kind="record_set", identity=f"object:{id(inp)}", payload=inp)], origin={"kind": "record_set"})

    # numpy array (single)
    if type(inp).__module__ == "numpy" or hasattr(inp, "shape"):
        return InputSet(items=[_array_item("array", inp)], origin={"kind": "in_memory", "ref": "array"})

    raise TypeError(f"cannot resolve input of type {type(inp).__name__}")
