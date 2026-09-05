# SPDX-License-Identifier: CeCILL-2.1 OR AGPL-3.0-or-later
"""DatasetPackage v3 over the explicitly versioned AssembledDataset v2 wire.

The package wraps v2 assembly feature, target, metadata, and weight payloads in
typed blocks, exposes a bytes-free manifest, and records row-position fallback.
Package v3 and assembled-wire v2 are separate contracts; neither silently
accepts its retired predecessor.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any

import numpy as np
import pandas as pd

from ..canonical_json import canonical_json
from ..spec.dataset_spec import AggregateSpec
from .assemble import AssembledDataset, PartitionBlock

DATASET_PACKAGE_VERSION = 3


class repr_ids:
    """Representation-id strings mirrored from the Rust DatasetPackage model."""

    SIGNAL_1D = "signal_1d"
    SIGNAL_WITH_PROCESSINGS = "signal_with_processings"
    FEATURE_BLOCK_SET = "feature_block_set"
    TARGET_NUMERIC = "target_numeric"
    TARGET_CATEGORICAL = "target_categorical"
    TARGET_NUMERIC_MATRIX = "target_numeric_matrix"
    TARGET_CATEGORICAL_MATRIX = "target_categorical_matrix"
    SAMPLE_METADATA = "sample_metadata"
    GRAY_IMAGE = "gray_image"
    RGB_IMAGE = "rgb_image"
    MC_IMAGE = "mc_image"
    MULTISPECTRAL_IMAGE = "multispectral_image"


class PayloadStorageKind(StrEnum):
    """Where payload bytes live."""

    INLINE = "inline"
    URI = "uri"


@dataclass(frozen=True)
class PayloadManifestEntry:
    """A bytes-free manifest row for one payload block."""

    id: str
    partition: str
    role: str
    payload_kind: str
    representation_id: str | None
    dtype: str
    shape: list[int]
    axes: list[str]
    content_hash: str
    byte_len: int
    storage: PayloadStorageKind = PayloadStorageKind.INLINE
    uri: str | None = None
    codec: str | None = None

    def to_dict(self) -> dict[str, Any]:
        """Return the stable JSON-serializable manifest row."""
        return {
            "id": self.id,
            "partition": self.partition,
            "role": self.role,
            "payload_kind": self.payload_kind,
            "representation_id": self.representation_id,
            "dtype": self.dtype,
            "shape": self.shape,
            "axes": self.axes,
            "content_hash": self.content_hash,
            "byte_len": self.byte_len,
            "storage": self.storage.value,
            "uri": self.uri,
            "codec": self.codec,
        }


@dataclass(frozen=True)
class PayloadManifest:
    """The package payload manifest plus its root fingerprint."""

    root: str
    entries: list[PayloadManifestEntry]

    def to_dict(self) -> dict[str, Any]:
        """Return the stable JSON-serializable manifest."""
        return {"root": self.root, "entries": [entry.to_dict() for entry in self.entries]}


@dataclass(frozen=True)
class UriRef:
    """A URI-backed payload pointer."""

    uri: str
    dtype: str
    shape: list[int]
    axes: list[str]
    content_hash: str
    byte_len: int
    codec: str | None = None


@dataclass(frozen=True)
class FeatureMatrix:
    """A dense feature matrix payload."""

    matrix: np.ndarray
    headers: list[str]
    header_unit: str
    signal_type: str | None
    processings: list[tuple[str, np.ndarray]] = field(default_factory=list)


@dataclass(frozen=True)
class TargetTable:
    """A target table payload."""

    matrix: np.ndarray
    headers: list[str]
    categorical: dict[str, Any] = field(default_factory=dict)
    representation_id: str | None = None


@dataclass(frozen=True)
class MetadataTable:
    """A sample-aligned metadata table payload."""

    frame: pd.DataFrame


@dataclass(frozen=True)
class WeightsVector:
    """Per-sample training weights."""

    values: np.ndarray
    header: str | None = None


@dataclass(frozen=True)
class SpectralRecordSet:
    """Decoded spectroscopy records carried as a package payload."""

    records: list[dict[str, Any]]


@dataclass(frozen=True)
class NdTensor:
    """A URI-backed N-D tensor payload."""

    representation_id: str
    dtype: str
    shape: list[int]
    axis_names: list[str]
    observation_ids: list[str]
    uri: UriRef


@dataclass(frozen=True)
class SequenceBlock:
    """A URI-backed time-series payload."""

    representation_id: str
    dtype: str
    n_channels: int
    lengths: list[int]
    uri: UriRef


@dataclass(frozen=True)
class GenotypeMatrix:
    """A URI-backed genotype matrix descriptor."""

    representation_id: str
    n_variants: int
    n_samples: int
    encoding: str
    uri: UriRef


@dataclass(frozen=True)
class MaskBlock:
    """A URI-backed mask payload."""

    representation_id: str
    dtype: str
    shape: list[int]
    uri: UriRef


PayloadBlock = (
    FeatureMatrix
    | TargetTable
    | MetadataTable
    | WeightsVector
    | SpectralRecordSet
    | NdTensor
    | SequenceBlock
    | GenotypeMatrix
    | MaskBlock
    | UriRef
)


@dataclass(frozen=True)
class PackagePartition:
    """Typed payloads for one dataset partition."""

    n_samples: int
    payloads: list[tuple[str, PayloadBlock]]
    source_ids: list[str] = field(default_factory=list)


@dataclass(frozen=True)
class RowPositionFallback:
    """Whether sample identity fell back to row position."""

    used: bool
    reason: str
    partitions: list[str]
    fingerprint: str

    def to_dict(self) -> dict[str, Any]:
        """Return the stable JSON-serializable diagnostic."""
        return {
            "used": self.used,
            "reason": self.reason,
            "partitions": self.partitions,
            "fingerprint": self.fingerprint,
        }


@dataclass(frozen=True)
class DatasetPackage:
    """The public v3 dataset package built from an :class:`AssembledDataset`."""

    name: str
    task_type: str
    signal_type: str
    n_sources: int
    repetition: str | None
    aggregate: AggregateSpec | None
    folds: list[tuple[list[int], list[int]]]
    fold_provenance: list[dict[str, list[str]]]
    identity: dict[str, object]
    warnings: list[str]
    audits: list[dict[str, Any]]
    partitions: dict[str, PackagePartition]
    row_position_fallback: RowPositionFallback

    @classmethod
    def from_assembled(cls, assembled: AssembledDataset) -> DatasetPackage:
        """Build a v3 package from assembly output."""
        partitions: dict[str, PackagePartition] = {}
        for partition_name, block in assembled.blocks.items():
            payloads: list[tuple[str, PayloadBlock]] = []
            for idx, matrix in enumerate(block.X):
                payloads.append(
                    (
                        f"{partition_name}/x{idx}",
                        FeatureMatrix(
                            matrix=np.asarray(matrix, dtype=np.float32),
                            headers=list(block.feature_headers[idx]) if idx < len(block.feature_headers) else [],
                            header_unit=block.header_units[idx] if idx < len(block.header_units) else "",
                            signal_type=block.signal_types[idx] if idx < len(block.signal_types) else None,
                            processings=list(block.processings[idx]) if idx < len(block.processings) else [],
                        ),
                    )
                )
            if block.y is not None:
                payloads.append(
                    (
                        f"{partition_name}/y",
                        TargetTable(
                            matrix=np.asarray(block.y, dtype=np.float32),
                            headers=list(block.y_headers),
                            categorical=dict(block.y_categorical),
                            representation_id=_target_representation_id(assembled.task_type, block.y_headers, block.y_categorical),
                        ),
                    )
                )
            if block.metadata is not None:
                payloads.append((f"{partition_name}/metadata", MetadataTable(frame=block.metadata.copy())))
            if block.weights is not None:
                payloads.append(
                    (
                        f"{partition_name}/weights",
                        WeightsVector(values=np.asarray(block.weights, dtype=np.float32), header=block.weights_header),
                    )
                )
            partitions[partition_name] = PackagePartition(
                n_samples=block.n_samples,
                payloads=payloads,
                source_ids=list(block.source_ids),
            )
        return cls(
            name=assembled.name,
            task_type=assembled.task_type,
            signal_type=assembled.signal_type,
            n_sources=assembled.n_sources,
            repetition=assembled.repetition,
            aggregate=assembled.aggregate,
            folds=[(list(train), list(val)) for train, val in assembled.folds],
            fold_provenance=[dict(fold) for fold in assembled.fold_provenance],
            identity=dict(assembled.identity),
            warnings=list(assembled.warnings),
            audits=list(assembled.audits),
            partitions=partitions,
            row_position_fallback=_compute_row_position_fallback(assembled),
        )

    def to_assembled(self) -> AssembledDataset:
        """Reconstruct the v2-expressible :class:`AssembledDataset` payload."""
        assembled = AssembledDataset(
            name=self.name,
            task_type=self.task_type,
            signal_type=self.signal_type,
            n_sources=self.n_sources,
            repetition=self.repetition,
            aggregate=self.aggregate,
            warnings=list(self.warnings),
            audits=list(self.audits),
        )
        assembled.folds = [(list(train), list(val)) for train, val in self.folds]
        assembled.fold_provenance = [dict(fold) for fold in self.fold_provenance]
        assembled.identity = dict(self.identity)
        for partition_name, partition in self.partitions.items():
            block = PartitionBlock(n_samples=partition.n_samples)
            block.source_ids = list(partition.source_ids)
            for _payload_id, payload in partition.payloads:
                if isinstance(payload, FeatureMatrix):
                    block.X.append(np.array(payload.matrix, dtype=np.float32, copy=True))
                    block.feature_headers.append(list(payload.headers))
                    block.header_units.append(payload.header_unit)
                    block.signal_types.append(payload.signal_type)
                    block.processings.append([(name, np.array(matrix, dtype=np.float32, copy=True)) for name, matrix in payload.processings])
                elif isinstance(payload, TargetTable):
                    block.y = np.array(payload.matrix, dtype=np.float32, copy=True)
                    block.y_headers = list(payload.headers)
                    block.y_categorical = dict(payload.categorical)
                elif isinstance(payload, MetadataTable):
                    block.metadata = payload.frame.copy()
                elif isinstance(payload, WeightsVector):
                    block.weights = np.array(payload.values, dtype=np.float32, copy=True)
                    block.weights_header = payload.header
            assembled.blocks[partition_name] = block
        return assembled

    def manifest(self) -> PayloadManifest:
        """Build the payload manifest and root fingerprint."""
        entries: list[PayloadManifestEntry] = []
        for partition_name, partition in self.partitions.items():
            for payload_id, payload in partition.payloads:
                entries.append(_manifest_entry(payload, partition=partition_name, payload_id=payload_id))
        root = _sha256_json([entry.to_dict() for entry in entries])
        return PayloadManifest(root=root, entries=entries)

    def to_summary_dict(self) -> dict[str, Any]:
        """Return a stable, bytes-free package summary."""
        aggregate = None
        if self.aggregate is not None:
            aggregate = {
                "by": self.aggregate.by,
                "method": self.aggregate.method.value,
                "exclude_outliers": self.aggregate.exclude_outliers,
                "outlier_threshold": self.aggregate.outlier_threshold,
            }
        return {
            "schema_version": DATASET_PACKAGE_VERSION,
            "name": self.name,
            "task_type": self.task_type,
            "signal_type": self.signal_type,
            "n_sources": self.n_sources,
            "repetition": self.repetition,
            "folds": [[list(train), list(val)] for train, val in self.folds],
            "fold_provenance": [dict(fold) for fold in self.fold_provenance],
            "aggregate": aggregate,
            "partitions": {
                name: {"n_samples": partition.n_samples, "source_ids": list(partition.source_ids)}
                for name, partition in self.partitions.items()
            },
            "manifest": self.manifest().to_dict(),
            "identity": {
                "provenance": dict(self.identity),
                "row_position_fallback": self.row_position_fallback.to_dict(),
            },
        }

    def to_canonical_summary(self) -> str:
        """Return the canonical JSON form of :meth:`to_summary_dict`."""
        return canonical_json(self.to_summary_dict())


def _sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _sha256_json(value: Any) -> str:
    return _sha256_bytes(canonical_json(value).encode("utf-8"))


def _matrix_bytes(matrix: np.ndarray) -> bytes:
    array = np.ascontiguousarray(np.asarray(matrix, dtype="<f4"))
    return array.tobytes(order="C")


def _feature_content_bytes(payload: FeatureMatrix) -> bytes:
    out = bytearray(_matrix_bytes(payload.matrix))
    out.extend("\x1f".join(payload.headers).encode("utf-8"))
    for name, matrix in payload.processings:
        out.append(0)
        out.extend(name.encode("utf-8"))
        out.append(0)
        out.extend(_matrix_bytes(matrix))
    return bytes(out)


def _target_content_bytes(payload: TargetTable) -> bytes:
    out = bytearray(_matrix_bytes(payload.matrix))
    out.extend("\x1f".join(payload.headers).encode("utf-8"))
    out.append(0)
    out.extend(canonical_json(_json_safe(payload.categorical)).encode("utf-8"))
    return bytes(out)


def _weights_content_bytes(payload: WeightsVector) -> bytes:
    out = bytearray(_matrix_bytes(np.asarray(payload.values, dtype=np.float32).reshape(-1, 1)))
    if payload.header:
        out.append(0)
        out.extend(payload.header.encode("utf-8"))
    return bytes(out)


def _metadata_content_bytes(frame: pd.DataFrame) -> bytes:
    columns: list[dict[str, Any]] = []
    for name in frame.columns:
        series = frame[name]
        columns.append(
            {
                "name": str(name),
                "dtype": _series_dtype_label(series),
                "values": [_json_scalar(value) for value in series.tolist()],
            }
        )
    return canonical_json({"n_rows": int(len(frame)), "columns": columns}).encode("utf-8")


def _json_scalar(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, np.generic):
        value = value.item()
    if pd.isna(value):
        return None
    if isinstance(value, (bool, int, float, str)):
        return value
    return str(value)


def _json_safe(value: Any) -> Any:
    if isinstance(value, dict):
        return {str(k): _json_safe(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_safe(v) for v in value]
    if isinstance(value, np.ndarray):
        return [_json_safe(v) for v in value.tolist()]
    return _json_scalar(value)


def _series_dtype_label(series: pd.Series) -> str:
    if pd.api.types.is_bool_dtype(series):
        return "bool"
    if pd.api.types.is_numeric_dtype(series):
        return "numeric"
    if pd.api.types.is_datetime64_any_dtype(series):
        return "datetime"
    return "string"


def _feature_axis_name(unit: str) -> str:
    text = unit.lower()
    if "nm" in text or "nanomet" in text or "wavelength" in text:
        return "wavelength"
    if "cm-1" in text or "cm^-1" in text or "1/cm" in text or "wavenumber" in text or "cm\u207b\u00b9" in text:
        return "wavenumber"
    return "feature"


def _target_representation_id(task_type: str, headers: list[str], categorical: dict[str, Any]) -> str | None:
    if not headers:
        return None
    kinds = [header in categorical or task_type in {"binary", "multiclass"} for header in headers]
    if len(headers) == 1:
        return repr_ids.TARGET_CATEGORICAL if kinds[0] else repr_ids.TARGET_NUMERIC
    if all(kind == kinds[0] for kind in kinds):
        return repr_ids.TARGET_CATEGORICAL_MATRIX if kinds[0] else repr_ids.TARGET_NUMERIC_MATRIX
    return None


def _inline_entry(
    *,
    partition: str,
    payload_id: str,
    role: str,
    payload_kind: str,
    representation_id: str | None,
    dtype: str,
    shape: list[int],
    axes: list[str],
    content: bytes,
) -> PayloadManifestEntry:
    return PayloadManifestEntry(
        id=payload_id,
        partition=partition,
        role=role,
        payload_kind=payload_kind,
        representation_id=representation_id,
        dtype=dtype,
        shape=shape,
        axes=axes,
        content_hash=_sha256_bytes(content),
        byte_len=len(content),
        storage=PayloadStorageKind.INLINE,
    )


def _uri_entry(
    *,
    partition: str,
    payload_id: str,
    role: str,
    payload_kind: str,
    representation_id: str | None,
    uri: UriRef,
    dtype: str | None = None,
    shape: list[int] | None = None,
    axes: list[str] | None = None,
) -> PayloadManifestEntry:
    return PayloadManifestEntry(
        id=payload_id,
        partition=partition,
        role=role,
        payload_kind=payload_kind,
        representation_id=representation_id,
        dtype=dtype or uri.dtype,
        shape=list(shape or uri.shape),
        axes=list(axes or uri.axes),
        content_hash=uri.content_hash,
        byte_len=uri.byte_len,
        storage=PayloadStorageKind.URI,
        uri=uri.uri,
        codec=uri.codec,
    )


def _manifest_entry(payload: PayloadBlock, *, partition: str, payload_id: str) -> PayloadManifestEntry:
    if isinstance(payload, FeatureMatrix):
        has_processings = bool(payload.processings)
        axes = ["sample"]
        if has_processings:
            axes.append("processing")
        axes.append(_feature_axis_name(payload.header_unit))
        matrix = np.asarray(payload.matrix)
        return _inline_entry(
            partition=partition,
            payload_id=payload_id,
            role="features",
            payload_kind="feature_matrix",
            representation_id=repr_ids.SIGNAL_WITH_PROCESSINGS if has_processings else repr_ids.SIGNAL_1D,
            dtype="float32",
            shape=[int(matrix.shape[0]), int(matrix.shape[1]) if matrix.ndim > 1 else 1],
            axes=axes,
            content=_feature_content_bytes(payload),
        )
    if isinstance(payload, TargetTable):
        matrix = np.asarray(payload.matrix)
        n_cols = int(matrix.shape[1]) if matrix.ndim > 1 else 1
        return _inline_entry(
            partition=partition,
            payload_id=payload_id,
            role="targets",
            payload_kind="target_table",
            representation_id=payload.representation_id,
            dtype="float32",
            shape=[int(matrix.shape[0]), n_cols],
            axes=["sample", "target"] if n_cols > 1 else ["sample"],
            content=_target_content_bytes(payload),
        )
    if isinstance(payload, MetadataTable):
        return _inline_entry(
            partition=partition,
            payload_id=payload_id,
            role="metadata",
            payload_kind="metadata_table",
            representation_id=repr_ids.SAMPLE_METADATA,
            dtype="mixed",
            shape=[int(len(payload.frame)), int(len(payload.frame.columns))],
            axes=["sample", "field"],
            content=_metadata_content_bytes(payload.frame),
        )
    if isinstance(payload, WeightsVector):
        values = np.asarray(payload.values)
        return _inline_entry(
            partition=partition,
            payload_id=payload_id,
            role="weights",
            payload_kind="weights",
            representation_id=None,
            dtype="float32",
            shape=[int(values.size)],
            axes=["sample"],
            content=_weights_content_bytes(payload),
        )
    if isinstance(payload, SpectralRecordSet):
        content = canonical_json(_json_safe(payload.records)).encode("utf-8")
        return _inline_entry(
            partition=partition,
            payload_id=payload_id,
            role="features",
            payload_kind="spectral_record_set",
            representation_id=None,
            dtype="records",
            shape=[len(payload.records)],
            axes=["sample"],
            content=content,
        )
    if isinstance(payload, NdTensor):
        return _uri_entry(
            partition=partition,
            payload_id=payload_id,
            role="features",
            payload_kind="nd_tensor",
            representation_id=payload.representation_id,
            uri=payload.uri,
            dtype=payload.dtype,
            shape=payload.shape,
            axes=payload.axis_names,
        )
    if isinstance(payload, SequenceBlock):
        return _uri_entry(
            partition=partition,
            payload_id=payload_id,
            role="features",
            payload_kind="sequence_block",
            representation_id=payload.representation_id,
            uri=payload.uri,
        )
    if isinstance(payload, GenotypeMatrix):
        return _uri_entry(
            partition=partition,
            payload_id=payload_id,
            role="features",
            payload_kind="genotype_matrix",
            representation_id=payload.representation_id,
            uri=payload.uri,
            shape=[payload.n_samples, payload.n_variants],
            axes=["sample", "variant"],
        )
    if isinstance(payload, MaskBlock):
        return _uri_entry(
            partition=partition,
            payload_id=payload_id,
            role="mask",
            payload_kind="mask_block",
            representation_id=payload.representation_id,
            uri=payload.uri,
            dtype=payload.dtype,
            shape=payload.shape,
        )
    return _uri_entry(partition=partition, payload_id=payload_id, role="features", payload_kind="uri_backed", representation_id=None, uri=payload)


def _compute_row_position_fallback(assembled: AssembledDataset) -> RowPositionFallback:
    partitions = list(assembled.blocks)
    sample_id = assembled.identity.get("sample_id") if isinstance(assembled.identity, dict) else None
    use_sample_id = isinstance(sample_id, str) and all(
        block.metadata is not None and sample_id in block.metadata.columns and len(block.metadata[sample_id]) == block.n_samples for block in assembled.blocks.values()
    )
    if use_sample_id:
        used = False
        reason = f"stable sample-id key '{sample_id}' is aligned in every partition"
    elif isinstance(sample_id, str):
        used = True
        reason = f"sample-id key '{sample_id}' is absent or not aligned in every partition; sample identity falls back to row position"
    else:
        used = True
        reason = "no stable sample-id key declared; sample identity falls back to row position"
    fingerprint = _sha256_json({"used": used, "reason": reason, "partitions": partitions})
    return RowPositionFallback(used=used, reason=reason, partitions=partitions, fingerprint=fingerprint)


__all__ = [
    "DATASET_PACKAGE_VERSION",
    "DatasetPackage",
    "FeatureMatrix",
    "GenotypeMatrix",
    "MaskBlock",
    "MetadataTable",
    "NdTensor",
    "PackagePartition",
    "PayloadBlock",
    "PayloadManifest",
    "PayloadManifestEntry",
    "PayloadStorageKind",
    "RowPositionFallback",
    "SequenceBlock",
    "SpectralRecordSet",
    "TargetTable",
    "UriRef",
    "WeightsVector",
    "repr_ids",
]
