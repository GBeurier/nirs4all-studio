# SPDX-License-Identifier: CeCILL-2.1 OR AGPL-3.0-or-later
"""nirs4all-io — dataset-assembly bridge (Rust core, pyo3 binding).

The inference surface (:func:`infer` / :func:`to_spec` / :func:`validate`) is
backed by the native extension. ``infer`` / ``to_spec`` accept native inputs — a
path (``str`` or :class:`~pathlib.Path`), a list of files, or a config ``dict`` —
and return ergonomic typed mappings (:class:`DatasetPlan` / :class:`DatasetSpec`)
that subclass ``dict`` (so they stay subscriptable, JSON-serializable, and valid
inputs to :func:`validate` / :func:`load`) while adding a readable ``repr`` and a
few convenience accessors.

:func:`load` wraps the materialized exports: ``target="assembled"`` returns the
structural summary dict; ``target="spectrodataset"`` builds a real nirs4all
``SpectroDataset`` via the lazy adapter (the only nirs4all touch-point).
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from ._adapter import to_spectrodataset
from ._assembled import require_assembled_dataset_v2
from ._native import __version__, assembled_full, load_summary
from ._native import infer as _native_infer
from ._native import to_spec as _native_to_spec
from ._native import validate as _native_validate
from ._package import (
    DatasetPackage,
    PayloadManifest,
    PayloadManifestEntry,
    PayloadStorageKind,
    RowPositionFallback,
    repr_ids,
)

__all__ = [
    "infer",
    "to_spec",
    "validate",
    "load",
    "to_dataset_package",
    "describe_dataset_package",
    "to_spectrodataset",
    "DatasetPlan",
    "DatasetSpec",
    "DatasetPackage",
    "PayloadManifest",
    "PayloadManifestEntry",
    "PayloadStorageKind",
    "RowPositionFallback",
    "repr_ids",
    "__version__",
]


def _normalize_input(input: Any) -> Any:
    """Coerce ``os.PathLike`` (and lists thereof) to plain ``str`` for the native
    call, which accepts ``str`` paths, ``list[str]`` file lists, and ``dict``
    specs. Mappings and plain strings pass through unchanged."""
    if isinstance(input, os.PathLike):
        return os.fspath(input)
    if isinstance(input, (list, tuple)):
        return [os.fspath(p) if isinstance(p, os.PathLike) else p for p in input]
    return input


def _plain_data(value: Any) -> Any:
    if isinstance(value, os.PathLike):
        return os.fspath(value)
    if isinstance(value, dict):
        return {str(k): _plain_data(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_plain_data(item) for item in value]
    return value


def _is_relative_local_ref(value: str) -> bool:
    return not Path(value).is_absolute() and urlparse(value).scheme == ""


def _absolutize_input_ref(value: Any, base_dir: Path) -> Any:
    if isinstance(value, str) and _is_relative_local_ref(value):
        return str((base_dir / value).resolve())
    if isinstance(value, list):
        return [_absolutize_input_ref(item, base_dir) for item in value]
    return value


def _absolutize_dataset_spec_refs(spec: dict[str, Any], base_dir: Path) -> None:
    for source in spec.get("sources", []):
        if not isinstance(source, dict):
            continue
        if "input" in source:
            source["input"] = _absolutize_input_ref(source["input"], base_dir)
        for variation in source.get("variations", []):
            if isinstance(variation, dict) and "input" in variation:
                variation["input"] = _absolutize_input_ref(variation["input"], base_dir)

    partitions = spec.get("partitions")
    if isinstance(partitions, dict):
        for key in ("train_file", "test_file", "predict_file"):
            if key in partitions:
                partitions[key] = _absolutize_input_ref(partitions[key], base_dir)

    folds = spec.get("folds")
    if isinstance(folds, dict) and "file" in folds:
        folds["file"] = _absolutize_input_ref(folds["file"], base_dir)


def _adapt_to_io_spec(input: Any, *, base_dir: str | Path | None = None) -> Any:
    if isinstance(input, DatasetPlan):
        input = input.resolved_spec
        if input is None:
            raise ValueError("plan has no resolved_spec")
    adapter = getattr(input, "to_io_spec", None)
    if not callable(adapter):
        raw = input
        explicit_base = Path(base_dir) if base_dir is not None else None
    else:
        raw = adapter()
        explicit_base = Path(base_dir) if base_dir is not None else None
    if callable(adapter) and isinstance(raw, tuple):
        if len(raw) != 2:
            raise ValueError("to_io_spec() must return a spec dict or a (spec, base_dir) pair")
        raw, base = raw
        explicit_base = Path(base_dir or base) if base is not None else explicit_base

    if not isinstance(raw, dict):
        return raw

    spec = _plain_data(raw)
    if explicit_base is not None:
        _absolutize_dataset_spec_refs(spec, explicit_base)
    return spec


class DatasetSpec(dict):
    """A canonical ``DatasetSpec`` returned by :func:`to_spec`.

    A plain ``dict`` (subscriptable, JSON-serializable, accepted by
    :func:`validate` and :func:`load`) with a readable ``repr`` and shortcut
    accessors for the common top-level fields.
    """

    __slots__ = ()

    @property
    def name(self) -> str | None:
        return self.get("name")

    @property
    def schema_version(self) -> int | None:
        return self.get("schema_version")

    @property
    def sources(self) -> list[dict[str, Any]]:
        return self.get("sources", [])

    def __repr__(self) -> str:
        srcs = self.sources
        head = ", ".join(f"{s.get('id', '?')}:{s.get('role', '?')}" for s in srcs[:4])
        if len(srcs) > 4:
            head += ", ..."
        return f"DatasetSpec(name={self.name!r}, schema_version={self.schema_version}, sources=[{head}])"


class Decision(dict):
    """A native decision with mapping and historical attribute access."""

    def __getattr__(self, key: str) -> Any:
        try:
            return self[key]
        except KeyError as error:
            raise AttributeError(key) from error

    def to_dict(self) -> dict[str, Any]:
        return dict(self)


class DatasetPlan(dict):
    """A scored ``DatasetPlan`` returned by :func:`infer`.

    A plain ``dict`` with a readable ``repr``, a :attr:`resolved_spec` accessor
    (returns a :class:`DatasetSpec`), and :meth:`decisions` for the scored
    inference decisions (structure / signal type / task type / ...).
    """

    __slots__ = ()

    def __getattr__(self, key: str) -> Any:
        try:
            value = self[key]
        except KeyError as error:
            raise AttributeError(key) from error
        return Decision(value) if isinstance(value, dict) and {"value", "score", "ambiguous"} <= value.keys() else value

    def to_dict(self) -> dict[str, Any]:
        return dict(self)

    def accept(self, **overrides: Any) -> DatasetSpec:
        """Return a validated copy of the resolved spec with explicit overrides."""
        spec = self.resolved_spec
        if spec is None:
            raise ValueError("plan has no resolved_spec")
        return to_spec({**spec, **overrides})

    @property
    def overall_score(self) -> float | None:
        return self.get("overall_score")

    @property
    def resolved_spec(self) -> DatasetSpec | None:
        """The editable spec produced by inference, as a :class:`DatasetSpec`."""
        value = self.get("resolved_spec")
        return DatasetSpec(value) if isinstance(value, dict) else None

    @property
    def recommendations(self) -> list[str]:
        return self.get("recommendations", [])

    @property
    def warnings(self) -> list[str]:
        return self.get("warnings", [])

    def decisions(self) -> dict[str, dict[str, Any]]:
        """The scored decisions keyed by kind.

        A decision is any top-level field shaped like
        ``{value, score, evidence, alternatives, ambiguous}`` (structure,
        signal_type, task_type, ...)."""
        return {k: v for k, v in self.items() if isinstance(v, dict) and {"value", "score", "ambiguous"} <= v.keys()}

    def __repr__(self) -> str:
        decs = ", ".join(f"{k}={v.get('value')!r}({v.get('score')})" for k, v in self.decisions().items())
        return f"DatasetPlan(overall_score={self.overall_score}, {decs})"


def infer(input: Any, conventions: list[str] | None = None, *, hints: dict | None = None) -> DatasetPlan:
    """Inspect a data input and return a scored :class:`DatasetPlan`.

    Args:
        input: A path (``str`` or :class:`~pathlib.Path`) or a list of files.
        conventions: Optional convention names; ``None`` uses the default list.

    Returns:
        A :class:`DatasetPlan` (a ``dict`` subclass) with ``resolved_spec``,
        the scored decisions, ``recommendations`` and ``warnings``.
    """
    if hints is not None and not isinstance(hints, dict):
        raise TypeError("hints must be a mapping or None")
    if hints:
        raise ValueError("Non-empty inference hints are not implemented; edit the resolved_spec explicitly")
    plan = _native_infer(_normalize_input(input), conventions)
    return DatasetPlan(plan)


def to_spec(input: Any, conventions: list[str] | None = None, name: str | None = None) -> DatasetSpec:
    """Normalize a data input into a canonical :class:`DatasetSpec`.

    Args:
        input: A path (``str`` or :class:`~pathlib.Path`), a list of files, or a
            config ``dict``.
        conventions: Optional convention names; ``None`` uses the default list.
        name: Optional dataset name override.

    Returns:
        A :class:`DatasetSpec` (a ``dict`` subclass) that round-trips through
        :func:`validate` and :func:`load`.
    """
    from ._inputs import yaml_config
    input, config_base, _ = yaml_config(input)
    spec = _native_to_spec(_normalize_input(_adapt_to_io_spec(input)), conventions, name)
    if config_base is not None:
        _absolutize_dataset_spec_refs(spec, config_base)
    return DatasetSpec(spec)


def validate(spec: Any) -> None:
    """Validate a ``DatasetSpec`` (a mapping or a JSON string).

    Raises:
        ValueError: if the spec is malformed or fails validation.
    """
    _native_validate(spec)


def load(
    input: Any,
    *,
    target: str = "assembled",
    conventions: list[str] | None = None,
    name: str | None = None,
    base_dir: str | Path | None = None,
    spectro_dataset_cls: type | None = None,
    limits: dict[str, int] | str | None = None,
) -> Any:
    """Materialize ``input``.

    Args:
        input: A path (``str`` or :class:`~pathlib.Path`), a list of files, or a
            config ``dict``.
        target: ``"assembled"`` → the rounded structural summary ``dict``;
            ``"spectrodataset"`` → a nirs4all ``SpectroDataset`` (lazy import).
        conventions: Optional convention names.
        name: Optional dataset name override.
        spectro_dataset_cls: A recording double can be injected here to exercise
            the ``"spectrodataset"`` adapter without nirs4all installed.
        limits: Host read/decompression/shape budgets; omitted fields use defaults.
            ``"unlimited"`` is an explicit trusted-input opt-out.

    Returns:
        The assembled summary ``dict`` or a ``SpectroDataset``.
    """
    if isinstance(input, DatasetPackage):
        if target in {"dataset_package", "package"}:
            return input
        if target == "spectrodataset":
            return to_spectrodataset(input._full, spectro_dataset_cls=spectro_dataset_cls)
        if target == "assembled":
            return input.to_assembled()
    from ._inputs import array_payload, yaml_config
    from ._native import assemble_frames
    memory = array_payload(input, name, limits)
    if memory is not None:
        spec, frames = memory
        full = assemble_frames(spec, frames, limits=limits, summary=target == "assembled")
        if target == "assembled":
            return full
        if target in {"dataset_package", "package"}:
            return DatasetPackage(full)
        if target == "spectrodataset":
            return to_spectrodataset(full, spectro_dataset_cls=spectro_dataset_cls)
        raise ValueError(f"unknown target {target!r}")
    input, config_base, limits = yaml_config(input, limits)
    native_input = _normalize_input(_adapt_to_io_spec(input, base_dir=base_dir))
    if config_base is not None:
        native_input = _native_to_spec(native_input, conventions, name)
        _absolutize_dataset_spec_refs(native_input, Path(base_dir) if base_dir is not None else config_base)
    load_options = {} if limits is None else {"limits": limits}
    if target == "assembled":
        summary = load_summary(native_input, conventions, name, **load_options)
        require_assembled_dataset_v2(summary)
        return summary
    if target in {"dataset_package", "package"}:
        return DatasetPackage(assembled_full(native_input, conventions, name, **load_options))
    if target == "spectrodataset":
        full = assembled_full(native_input, conventions, name, **load_options)
        return to_spectrodataset(full, spectro_dataset_cls=spectro_dataset_cls)
    if target in {"dag-ml-data", "dag_ml_data"}:
        raise NotImplementedError(
            "target 'dag-ml-data' is not exposed by the Python pyo3 binding; use the Rust bridge crate "
            "`crates/nirs4all-io-dagml` (`to_dag_ml_data` / `emit-dagml`)"
        )
    raise ValueError(f"unknown target {target!r}; expected 'assembled' | 'spectrodataset' | 'dataset_package' | 'package'")


def to_dataset_package(
    input: Any,
    *,
    conventions: list[str] | None = None,
    base_dir: str | Path | None = None,
    name: str | None = None,
    limits: dict[str, int] | str | None = None,
) -> DatasetPackage:
    """Materialize ``input`` into a target-agnostic :class:`DatasetPackage`."""
    if isinstance(input, DatasetPackage):
        return input
    package = load(input, target="dataset_package", conventions=conventions, base_dir=base_dir, name=name, limits=limits)
    if not isinstance(package, DatasetPackage):
        raise TypeError(f"target 'dataset_package' returned {type(package).__name__}, expected DatasetPackage")
    return package


def describe_dataset_package(
    input: Any,
    *,
    conventions: list[str] | None = None,
    base_dir: str | Path | None = None,
    name: str | None = None,
    canonical: bool = False,
    limits: dict[str, int] | str | None = None,
) -> dict[str, Any] | str:
    """Return a bytes-free package summary for ``input``."""
    package = to_dataset_package(input, conventions=conventions, base_dir=base_dir, name=name, limits=limits)
    return package.to_canonical_summary() if canonical else package.to_summary_dict()
