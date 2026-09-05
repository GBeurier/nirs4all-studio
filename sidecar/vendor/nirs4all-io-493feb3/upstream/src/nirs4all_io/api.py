# SPDX-License-Identifier: CeCILL-2.1 OR AGPL-3.0-or-later
"""Public API: ``to_spec`` and ``load`` (Appendix I).

``load`` is the end-to-end entry: *resolve -> configure -> materialize*. It
accepts a ``DatasetSpec``, a dict/JSON/YAML config (alias-normalized), a
directory or file list (matched against conventions), or in-memory arrays, and
materializes a ``SpectroDataset`` (default), the target-agnostic
``AssembledDataset``, or a ``DatasetPackage``. Objects from sibling catalog
packages may also expose a ``to_io_spec()`` adapter; the returned spec is then
materialized by this package.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import numpy as np

from .conventions.engine import match_items
from .conventions.profiles import resolve_profiles
from .conventions.to_spec import assignments_to_spec_dict
from .materialize.assemble import AssembledDataset, PartitionBlock, assemble
from .materialize.package import DatasetPackage
from .materialize.spectrodataset import to_spectrodataset
from .resolve import resolve
from .spec import DatasetSpec
from .spec.enums import SpecError
from .spec.normalize import normalize_to_spec_dict

_CONFIG_SUFFIXES = (".json", ".yaml", ".yml")
_DEFAULT_CONVENTIONS = ["nirs4all-classic"]


def to_spec(
    inp: Any,
    *,
    conventions: list[str] | None = None,
    base_dir: str | Path | None = None,
    name: str | None = None,
) -> tuple[DatasetSpec, Path]:
    """Normalize any (non-in-memory) input into a (DatasetSpec, base_dir) pair."""
    from .infer.plan import DatasetPlan

    adapted = _adapt_to_io_spec(inp, base_dir=base_dir)
    if adapted is not None:
        spec, base = adapted
        if name:
            spec.name = name
        return spec, base
    if isinstance(inp, DatasetPlan):
        # a plan's resolved_spec carries absolute input paths (Appendix I)
        return inp.accept(), Path(base_dir or ".")
    if isinstance(inp, DatasetSpec):
        return inp, Path(base_dir or ".")
    if isinstance(inp, dict):
        spec = DatasetSpec.from_dict(normalize_to_spec_dict(inp))
        if name:
            spec.name = name
        return spec, Path(base_dir or ".")
    if isinstance(inp, (str, Path)):
        path = Path(inp)
        if path.suffix.lower() in _CONFIG_SUFFIXES and path.is_file():
            import json

            import yaml

            text = path.read_text(encoding="utf-8")
            raw = yaml.safe_load(text) if path.suffix.lower() != ".json" else json.loads(text)
            spec = DatasetSpec.from_dict(normalize_to_spec_dict(raw))
            spec.name = name or spec.name or path.stem
            return spec, Path(base_dir or path.parent)
        if path.is_dir():
            return _spec_from_directory(path, conventions or _DEFAULT_CONVENTIONS, name or path.name), path
        if path.is_file():
            spec = DatasetSpec.from_dict({"name": name or path.stem, "sources": [{"id": "data", "role": "features", "input": path.name}]})
            return spec, path.parent
        raise SpecError(f"path does not exist: {inp}")
    if isinstance(inp, (list, tuple)) and all(isinstance(x, (str, Path)) for x in inp):
        # a list/glob of files -> resolve + convention match, with ABSOLUTE inputs
        # (files may live in different directories / share basenames)
        iset = resolve(list(inp))
        name_to_abs = {it.ref: it.identity for it in iset.items}
        result = match_items(list(name_to_abs), resolve_profiles(conventions or _DEFAULT_CONVENTIONS))
        spec_dict = assignments_to_spec_dict(result, name=name or "dataset")
        for src in spec_dict.get("sources", []):
            value = src.get("input")
            if isinstance(value, list):
                src["input"] = [name_to_abs.get(n, n) for n in value]
            elif isinstance(value, str):
                src["input"] = name_to_abs.get(value, value)
        return DatasetSpec.from_dict(spec_dict), Path(base_dir or ".")
    raise SpecError(f"cannot build a DatasetSpec from {type(inp).__name__}; pass arrays to load() directly")


def _adapt_to_io_spec(inp: Any, *, base_dir: str | Path | None) -> tuple[DatasetSpec, Path] | None:
    """Accept sibling reference-dataset objects without importing their package.

    ``nirs4all-datasets.NirsDataset`` implements ``to_io_spec()``. Keeping this
    as a duck-typed adapter avoids a runtime dependency from IO back to the
    catalog package while still letting ``nio.load(reference_dataset)`` use the
    normal DatasetSpec materialization path.
    """
    adapter = getattr(inp, "to_io_spec", None)
    if not callable(adapter):
        return None
    raw = adapter()
    adapted_base: str | Path | None = None
    if isinstance(raw, tuple):
        if len(raw) != 2:
            raise SpecError("to_io_spec() must return a spec dict/DatasetSpec or a (spec, base_dir) pair")
        raw, adapted_base = raw
    if isinstance(raw, DatasetSpec):
        spec = raw
    elif isinstance(raw, dict):
        spec = DatasetSpec.from_dict(normalize_to_spec_dict(raw))
    else:
        raise SpecError(f"to_io_spec() returned {type(raw).__name__}, expected dict or DatasetSpec")
    return spec, Path(base_dir or adapted_base or ".")


def _spec_from_directory(path: Path, conventions: list[str], name: str) -> DatasetSpec:
    iset = resolve(path)
    result = match_items(iset.names, resolve_profiles(conventions))
    spec_dict = assignments_to_spec_dict(result, name=name)
    if not spec_dict.get("sources"):
        raise SpecError(f"no dataset files recognized in {path} with conventions {conventions}; unmatched: {result.unmatched}")
    return DatasetSpec.from_dict(spec_dict)


# --------------------------------------------------------------------------- #
# In-memory inputs (arrays / (X, y[, split]) / dict-of-arrays)                #
# --------------------------------------------------------------------------- #
def _is_in_memory(inp: Any) -> bool:
    if isinstance(inp, np.ndarray):
        return True
    if isinstance(inp, tuple) and inp and isinstance(inp[0], np.ndarray):
        return True
    if isinstance(inp, dict) and any(isinstance(v, np.ndarray) for v in inp.values()):
        return True
    return False


def _assemble_in_memory(inp: Any, name: str | None) -> AssembledDataset:
    x = y = meta = split = None
    if isinstance(inp, np.ndarray):
        x = inp
    elif isinstance(inp, tuple):
        x = inp[0]
        y = inp[1] if len(inp) > 1 else None
        split = inp[2] if len(inp) > 2 else None
    elif isinstance(inp, dict):
        x = inp.get("X") if "X" in inp else inp.get("x")
        y = inp.get("y") if "y" in inp else inp.get("Y")
        meta = inp.get("metadata") if "metadata" in inp else inp.get("meta")
    x = np.asarray(x, dtype=np.float32)
    headers = [str(i) for i in range(x.shape[1])]

    meta_df = None
    if meta is not None:
        import pandas as pd

        meta_df = meta if isinstance(meta, pd.DataFrame) else pd.DataFrame(np.asarray(meta))
        meta_df.columns = [str(c) for c in meta_df.columns]

    def _block(rows: np.ndarray) -> PartitionBlock:
        b = PartitionBlock(n_samples=int(rows.sum()) if rows.dtype == bool else len(rows))
        idx = rows
        b.X = [x[idx]]
        b.feature_headers = [headers]
        b.header_units = ["index"]
        b.signal_types = [None]
        if y is not None:
            yarr = np.asarray(y)
            yarr = yarr.reshape(-1, 1) if yarr.ndim == 1 else yarr
            b.y = yarr[idx]
            b.y_headers = [f"y{i}" for i in range(b.y.shape[1])]
        if meta_df is not None:
            b.metadata = meta_df.iloc[idx].reset_index(drop=True)
        return b

    assembled = AssembledDataset(name=name or "array_dataset", task_type="auto", signal_type="auto", n_sources=1)
    n = len(x)
    if split is None:
        partition = y is None and "predict" or "train"  # X-only -> predict, (X,y) -> train
        assembled.blocks[partition] = _block(np.ones(n, dtype=bool))
    else:
        split = np.asarray(split)
        for part in ("train", "test", "predict"):
            mask = split == part
            if mask.any():
                assembled.blocks[part] = _block(mask)
    return assembled


# --------------------------------------------------------------------------- #
# load                                                                         #
# --------------------------------------------------------------------------- #
def load(
    inp: Any,
    *,
    target: str = "spectrodataset",
    conventions: list[str] | None = None,
    base_dir: str | Path | None = None,
    name: str | None = None,
    spectro_dataset_cls: type | None = None,
) -> Any:
    """Materialize ``inp`` into a dataset (default target: a nirs4all SpectroDataset)."""
    if _is_in_memory(inp):
        assembled = _assemble_in_memory(inp, name)
    elif isinstance(inp, DatasetPackage):
        if target in ("dataset_package", "package"):
            return inp
        assembled = inp.to_assembled()
    else:
        spec, base = to_spec(inp, conventions=conventions, base_dir=base_dir, name=name)
        spec.validate()
        assembled = assemble(spec, base)

    if target == "assembled":
        return assembled
    if target in ("dataset_package", "package"):
        return DatasetPackage.from_assembled(assembled)
    if target == "spectrodataset":
        return to_spectrodataset(assembled, spectro_dataset_cls=spectro_dataset_cls)
    if target in ("dag-ml-data", "dag_ml_data"):
        raise NotImplementedError(
            "target 'dag-ml-data' is not exposed by the Python MVP load() surface; use the Rust bridge crate "
            "`crates/nirs4all-io-dagml` (`to_dag_ml_data` / `emit-dagml`)"
        )
    raise SpecError(f"unknown target {target!r}; expected 'spectrodataset' | 'assembled' | 'dataset_package' | 'package'")


def to_dataset_package(
    inp: Any,
    *,
    conventions: list[str] | None = None,
    base_dir: str | Path | None = None,
    name: str | None = None,
) -> DatasetPackage:
    """Materialize ``inp`` into a public, target-agnostic :class:`DatasetPackage`."""
    if isinstance(inp, DatasetPackage):
        return inp
    if isinstance(inp, AssembledDataset):
        return DatasetPackage.from_assembled(inp)
    package = load(inp, target="dataset_package", conventions=conventions, base_dir=base_dir, name=name)
    if not isinstance(package, DatasetPackage):  # defensive guard for type checkers and future targets
        raise SpecError(f"target 'dataset_package' returned {type(package).__name__}, expected DatasetPackage")
    return package


def describe_dataset_package(
    inp: Any,
    *,
    conventions: list[str] | None = None,
    base_dir: str | Path | None = None,
    name: str | None = None,
    canonical: bool = False,
) -> dict[str, Any] | str:
    """Return the bytes-free ``DatasetPackage`` summary for ``inp``.

    Set ``canonical=True`` to receive canonical JSON; otherwise a JSON-ready dict
    is returned.
    """
    package = to_dataset_package(inp, conventions=conventions, base_dir=base_dir, name=name)
    return package.to_canonical_summary() if canonical else package.to_summary_dict()
