"""The :class:`InMemoryProvider` ctypes wrapper over the C ABI provider vtable.

This is a thin shim: its only job is to hand JSON payloads and host buffers to
the Rust C ABI and decode the Arrow/owned-struct results. It owns no NIRS, ML,
or scheduling logic.
"""

from __future__ import annotations

import ctypes
import json
from pathlib import Path
from typing import Any

from ._abi import (
    ArrowArray,
    ArrowSchema,
    DagMlDataBytesView,
    DagMlDataF64Array,
    DagMlDataString,
    DagMlDataStringArray,
    DagMlDataTensorF64,
    DagMlDataU8Array,
    DagMlDataUSizeArray,
    DagMlDataVTable,
    ViewIdentityFn,
)
from ._library import load_library


def _u8_buffer(data: bytes) -> tuple[ctypes.Array[ctypes.c_char], ctypes.POINTER(ctypes.c_uint8)]:
    buffer = ctypes.create_string_buffer(data)
    return buffer, ctypes.cast(buffer, ctypes.POINTER(ctypes.c_uint8))


def _bytes_view(data: bytes) -> tuple[ctypes.Array[ctypes.c_char], DagMlDataBytesView]:
    buffer, ptr = _u8_buffer(data)
    return buffer, DagMlDataBytesView(ptr, len(data))


def _valid(bitmap: int | None, idx: int) -> bool:
    if not bitmap:
        return True
    byte = ctypes.cast(bitmap, ctypes.POINTER(ctypes.c_uint8))[idx // 8]
    return (byte & (1 << (idx % 8))) != 0


def _utf8_values(array_ptr: ctypes.POINTER(ArrowArray)) -> list[str | None]:
    array = array_ptr.contents
    offsets = ctypes.cast(array.buffers[1], ctypes.POINTER(ctypes.c_int32))
    value_ptr = ctypes.cast(array.buffers[2], ctypes.POINTER(ctypes.c_uint8))
    values: list[str | None] = []
    for idx in range(array.length):
        if not _valid(array.buffers[0], idx):
            values.append(None)
            continue
        start = offsets[idx]
        end = offsets[idx + 1]
        values.append(bytes(value_ptr[start:end]).decode("utf-8"))
    return values


def _bool_values(array_ptr: ctypes.POINTER(ArrowArray)) -> list[bool]:
    array = array_ptr.contents
    value_ptr = array.buffers[1]
    return [_valid(value_ptr, idx) for idx in range(array.length)]


def _f64_values(array_ptr: ctypes.POINTER(ArrowArray)) -> list[float | None]:
    array = array_ptr.contents
    values = ctypes.cast(array.buffers[1], ctypes.POINTER(ctypes.c_double))
    return [values[idx] if _valid(array.buffers[0], idx) else None for idx in range(array.length)]


def _owned_string_value(value: DagMlDataString) -> str:
    if not value.ptr:
        return ""
    return ctypes.string_at(value.ptr, value.len).decode("utf-8")


def _string_array_values(array: DagMlDataStringArray) -> list[str]:
    if not array.ptr:
        return []
    return [_owned_string_value(array.ptr[idx]) for idx in range(array.len)]


def _usize_array_values(array: DagMlDataUSizeArray) -> list[int]:
    if not array.ptr:
        return []
    return [int(array.ptr[idx]) for idx in range(array.len)]


def _f64_array_values(array: DagMlDataF64Array) -> list[float]:
    if not array.ptr:
        return []
    return [float(array.ptr[idx]) for idx in range(array.len)]


def _u8_array_values(array: DagMlDataU8Array) -> list[bool] | None:
    if not array.ptr:
        return None
    return [bool(array.ptr[idx]) for idx in range(array.len)]


def _tensor_to_dict(tensor: DagMlDataTensorF64) -> dict[str, Any]:
    result: dict[str, Any] = {
        "abi_version": int(tensor.abi_version),
        "block_id": _owned_string_value(tensor.block_id),
        "representation_id": _owned_string_value(tensor.representation_id),
        "batch_container": _owned_string_value(tensor.batch_container),
        "observation_ids": _string_array_values(tensor.observation_ids),
        "sample_ids": _string_array_values(tensor.sample_ids),
        "shape": _usize_array_values(tensor.shape),
        "values": _f64_array_values(tensor.values),
    }
    presence_mask = _u8_array_values(tensor.presence_mask)
    if presence_mask is not None:
        result["presence_mask"] = presence_mask
    validity_mask = _u8_array_values(tensor.validity_mask)
    if validity_mask is not None:
        result["validity_mask"] = validity_mask
    feature_names = _string_array_values(tensor.feature_names)
    if feature_names:
        result["feature_names"] = feature_names
    return result


class InMemoryProvider:
    """Rust-owned in-memory provider driven over the C ABI vtable.

    ``library_path`` is keyword-only; when omitted the cdylib is discovered via
    :func:`dag_ml_data_provider.find_capi_library`.
    """

    def __init__(
        self,
        envelope_json: bytes,
        *,
        library_path: str | Path | None = None,
        target_tables: list[dict[str, Any]] | None = None,
        feature_tables: list[dict[str, Any]] | None = None,
        f64_feature_matrices: list[dict[str, Any]] | None = None,
    ) -> None:
        if feature_tables is not None and f64_feature_matrices is not None:
            raise ValueError(
                "pass at most one of feature_tables or f64_feature_matrices"
            )
        self._lib = load_library(library_path)
        # Choose the feature payload from the SAME branch as the constructor so
        # the JSON shape always matches the symbol it is handed to.
        if f64_feature_matrices is not None:
            constructor = self._lib.dagmldata_inmemory_provider_new_with_f64_features_json
            feature_rows = f64_feature_matrices
        else:
            constructor = self._lib.dagmldata_inmemory_provider_new_with_features_json
            feature_rows = feature_tables or []
        target_json = json.dumps(target_tables or []).encode("utf-8")
        feature_json = json.dumps(feature_rows).encode("utf-8")
        envelope_buffer, envelope_ptr = _u8_buffer(envelope_json)
        target_buffer, target_ptr = _u8_buffer(target_json)
        feature_buffer, feature_ptr = _u8_buffer(feature_json)
        # Constructors copy borrowed input synchronously. Local references keep
        # buffers alive through the call; the provider must not retain them.
        self._vtable = DagMlDataVTable()
        error = DagMlDataString()
        status = constructor(
            envelope_ptr,
            len(envelope_json),
            target_ptr,
            len(target_json),
            feature_ptr,
            len(feature_json),
            ctypes.byref(self._vtable),
            ctypes.byref(error),
        )
        if status != 0:
            message = self._consume_error(error) or f"status {status}"
            raise RuntimeError(f"provider creation failed: {message}")
        if not self._vtable.user_data:
            raise RuntimeError("provider creation returned null user_data")

    @classmethod
    def from_files(
        cls,
        envelope_path: str | Path,
        *,
        library_path: str | Path | None = None,
        target_tables: list[dict[str, Any]] | None = None,
        feature_tables: list[dict[str, Any]] | None = None,
        f64_feature_matrices: list[dict[str, Any]] | None = None,
    ) -> "InMemoryProvider":
        return cls(
            Path(envelope_path).read_bytes(),
            library_path=library_path,
            target_tables=target_tables,
            feature_tables=feature_tables,
            f64_feature_matrices=f64_feature_matrices,
        )

    def materialize(self, request: dict[str, Any] | bytes) -> int:
        self._ensure_open()
        payload = request if isinstance(request, bytes) else json.dumps(request).encode("utf-8")
        buffer, view = _bytes_view(payload)
        handle = ctypes.c_uint64()
        status = self._vtable.materialize(self._vtable.user_data, 0, view, ctypes.byref(handle))
        if status != 0:
            raise RuntimeError(f"materialize failed: status {status}")
        return int(handle.value)

    def materialize_file(self, request_path: str | Path) -> int:
        return self.materialize(Path(request_path).read_bytes())

    def make_view(self, data_handle: int, view_spec: dict[str, Any]) -> int:
        self._ensure_open()
        buffer, view = _bytes_view(json.dumps(view_spec).encode("utf-8"))
        handle = ctypes.c_uint64()
        status = self._vtable.make_view(
            self._vtable.user_data,
            data_handle,
            view,
            ctypes.byref(handle),
        )
        if status != 0:
            raise RuntimeError(f"make_view failed: status {status}")
        return int(handle.value)

    def view_identity(self, view_handle: int) -> list[dict[str, Any]]:
        array, schema = self._call_arrow(self._vtable.view_identity, view_handle)
        try:
            children = array.contents.children
            columns = [
                _utf8_values(children[0]),
                _utf8_values(children[1]),
                _utf8_values(children[2]),
                _utf8_values(children[3]),
                _utf8_values(children[4]),
                _utf8_values(children[5]),
                _bool_values(children[6]),
            ]
            return [
                {
                    "observation_id": columns[0][idx],
                    "sample_id": columns[1][idx],
                    "target_id": columns[2][idx],
                    "group_id": columns[3][idx],
                    "origin_sample_id": columns[4][idx],
                    "source_id": columns[5][idx],
                    "is_augmented": columns[6][idx],
                }
                for idx in range(array.contents.length)
            ]
        finally:
            self._lib.dagmldata_arrow_array_free(array)
            self._lib.dagmldata_arrow_schema_free(schema)

    def target_values(self, view_handle: int, target_id: str) -> list[dict[str, Any]]:
        self._ensure_open()
        target_buffer, target_view = _bytes_view(target_id.encode("utf-8"))
        array = ctypes.POINTER(ArrowArray)()
        schema = ctypes.POINTER(ArrowSchema)()
        status = self._vtable.target_arrow(
            self._vtable.user_data,
            view_handle,
            target_view,
            ctypes.byref(array),
            ctypes.byref(schema),
        )
        if status != 0:
            raise RuntimeError(f"target_arrow failed: status {status}")
        try:
            children = array.contents.children
            sample_ids = _utf8_values(children[0])
            target_ids = _utf8_values(children[1])
            values = _f64_values(children[2])
            return [
                {"sample_id": sample_ids[idx], "target_id": target_ids[idx], "value": values[idx]}
                for idx in range(array.contents.length)
            ]
        finally:
            self._lib.dagmldata_arrow_array_free(array)
            self._lib.dagmldata_arrow_schema_free(schema)

    def feature_values(self, view_handle: int, feature_set_id: str) -> list[dict[str, Any]]:
        self._ensure_open()
        feature_buffer, feature_view = _bytes_view(feature_set_id.encode("utf-8"))
        array = ctypes.POINTER(ArrowArray)()
        schema = ctypes.POINTER(ArrowSchema)()
        status = self._vtable.feature_arrow(
            self._vtable.user_data,
            view_handle,
            feature_view,
            ctypes.byref(array),
            ctypes.byref(schema),
        )
        if status != 0:
            raise RuntimeError(f"feature_arrow failed: status {status}")
        try:
            children = array.contents.children
            schema_children = schema.contents.children
            observation_ids = _utf8_values(children[0])
            sample_ids = _utf8_values(children[1])
            feature_names = [
                schema_children[idx].contents.name.decode("utf-8")
                for idx in range(2, schema.contents.n_children)
            ]
            feature_columns = [
                _f64_values(children[idx]) for idx in range(2, array.contents.n_children)
            ]
            return [
                {
                    "observation_id": observation_ids[row_idx],
                    "sample_id": sample_ids[row_idx],
                    "features": {
                        feature_name: feature_columns[col_idx][row_idx]
                        for col_idx, feature_name in enumerate(feature_names)
                    },
                }
                for row_idx in range(array.contents.length)
            ]
        finally:
            self._lib.dagmldata_arrow_array_free(array)
            self._lib.dagmldata_arrow_schema_free(schema)

    def feature_fusion_values(
        self,
        view_handle: int,
        selector: dict[str, Any],
    ) -> list[dict[str, Any]]:
        return self.feature_values(view_handle, json.dumps(selector))

    def feature_buffer_manifests(self) -> list[dict[str, Any]]:
        self._ensure_open()
        out = DagMlDataString()
        error = DagMlDataString()
        status = self._lib.dagmldata_inmemory_provider_feature_buffer_manifest_json(
            ctypes.byref(self._vtable),
            ctypes.byref(out),
            ctypes.byref(error),
        )
        if status != 0:
            message = self._consume_string(error) or f"status {status}"
            raise RuntimeError(f"feature buffer manifest export failed: {message}")
        payload = self._consume_string(out) or "[]"
        return json.loads(payload)

    def data_feature_buffer_manifests(self, data_handle: int) -> list[dict[str, Any]]:
        self._ensure_open()
        out = DagMlDataString()
        error = DagMlDataString()
        status = self._lib.dagmldata_inmemory_provider_data_feature_buffer_manifest_json(
            ctypes.byref(self._vtable),
            data_handle,
            ctypes.byref(out),
            ctypes.byref(error),
        )
        if status != 0:
            message = self._consume_string(error) or f"status {status}"
            raise RuntimeError(f"data feature buffer manifest export failed: {message}")
        payload = self._consume_string(out) or "[]"
        return json.loads(payload)

    def feature_tensor(self, view_handle: int, selector: dict[str, Any]) -> dict[str, Any]:
        self._ensure_open()
        payload = json.dumps(selector).encode("utf-8")
        buffer, view = _bytes_view(payload)
        tensor = DagMlDataTensorF64()
        error = DagMlDataString()
        status = self._lib.dagmldata_inmemory_provider_feature_collation_tensor_f64_json(
            ctypes.byref(self._vtable),
            view_handle,
            view,
            ctypes.byref(tensor),
            ctypes.byref(error),
        )
        if status != 0:
            message = self._consume_string(error) or f"status {status}"
            raise RuntimeError(f"feature collation failed: {message}")
        try:
            return _tensor_to_dict(tensor)
        finally:
            self._lib.dagmldata_tensor_f64_free(tensor)

    def release(self, handle: int) -> None:
        self._ensure_open()
        self._vtable.release(self._vtable.user_data, handle)

    def close(self) -> None:
        if self._vtable.user_data:
            self._lib.dagmldata_inmemory_provider_destroy(ctypes.byref(self._vtable))

    def __enter__(self) -> "InMemoryProvider":
        return self

    def __exit__(self, exc_type: object, exc: object, tb: object) -> None:
        self.close()

    def _ensure_open(self) -> None:
        if not self._vtable.user_data:
            raise RuntimeError("provider is closed")

    def _consume_error(self, error: DagMlDataString) -> str | None:
        return self._consume_string(error)

    def _consume_string(self, value: DagMlDataString) -> str | None:
        if not value.ptr:
            return None
        text = ctypes.string_at(value.ptr, value.len).decode("utf-8")
        self._lib.dagmldata_string_free(value)
        return text

    def _call_arrow(
        self,
        callback: ViewIdentityFn,
        view_handle: int,
    ) -> tuple[ctypes.POINTER(ArrowArray), ctypes.POINTER(ArrowSchema)]:
        self._ensure_open()
        array = ctypes.POINTER(ArrowArray)()
        schema = ctypes.POINTER(ArrowSchema)()
        status = callback(self._vtable.user_data, view_handle, ctypes.byref(array), ctypes.byref(schema))
        if status != 0:
            raise RuntimeError(f"Arrow callback failed: status {status}")
        return array, schema
