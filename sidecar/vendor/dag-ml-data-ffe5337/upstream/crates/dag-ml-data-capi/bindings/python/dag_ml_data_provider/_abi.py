"""ctypes layout of the dag-ml-data C ABI provider surface.

This module mirrors `crates/dag-ml-data-capi/include/dag_ml_data.h`. It owns the
`ctypes.Structure` / `CFUNCTYPE` definitions and the `configure_library` routine
that pins argtypes/restypes on a loaded cdylib. It contains no behavior beyond
the ABI shape.
"""

from __future__ import annotations

import ctypes


class DagMlDataString(ctypes.Structure):
    _fields_ = [("ptr", ctypes.c_void_p), ("len", ctypes.c_size_t)]


class DagMlDataBytesView(ctypes.Structure):
    _fields_ = [("ptr", ctypes.POINTER(ctypes.c_uint8)), ("len", ctypes.c_size_t)]


class DagMlDataStringArray(ctypes.Structure):
    _fields_ = [("ptr", ctypes.POINTER(DagMlDataString)), ("len", ctypes.c_size_t)]


class DagMlDataUSizeArray(ctypes.Structure):
    _fields_ = [("ptr", ctypes.POINTER(ctypes.c_size_t)), ("len", ctypes.c_size_t)]


class DagMlDataF64Array(ctypes.Structure):
    _fields_ = [("ptr", ctypes.POINTER(ctypes.c_double)), ("len", ctypes.c_size_t)]


class DagMlDataU8Array(ctypes.Structure):
    _fields_ = [("ptr", ctypes.POINTER(ctypes.c_uint8)), ("len", ctypes.c_size_t)]


class DagMlDataTensorF64(ctypes.Structure):
    _fields_ = [
        ("abi_version", ctypes.c_uint32),
        ("block_id", DagMlDataString),
        ("representation_id", DagMlDataString),
        ("batch_container", DagMlDataString),
        ("observation_ids", DagMlDataStringArray),
        ("sample_ids", DagMlDataStringArray),
        ("shape", DagMlDataUSizeArray),
        ("values", DagMlDataF64Array),
        ("presence_mask", DagMlDataU8Array),
        ("validity_mask", DagMlDataU8Array),
        ("feature_names", DagMlDataStringArray),
    ]


class ArrowArray(ctypes.Structure):
    pass


class ArrowSchema(ctypes.Structure):
    pass


ArrowArray._fields_ = [
    ("length", ctypes.c_int64),
    ("null_count", ctypes.c_int64),
    ("offset", ctypes.c_int64),
    ("n_buffers", ctypes.c_int64),
    ("n_children", ctypes.c_int64),
    ("buffers", ctypes.POINTER(ctypes.c_void_p)),
    ("children", ctypes.POINTER(ctypes.POINTER(ArrowArray))),
    ("dictionary", ctypes.POINTER(ArrowArray)),
    ("release", ctypes.c_void_p),
    ("private_data", ctypes.c_void_p),
]

ArrowSchema._fields_ = [
    ("format", ctypes.c_char_p),
    ("name", ctypes.c_char_p),
    ("metadata", ctypes.c_char_p),
    ("flags", ctypes.c_int64),
    ("n_children", ctypes.c_int64),
    ("children", ctypes.POINTER(ctypes.POINTER(ArrowSchema))),
    ("dictionary", ctypes.POINTER(ArrowSchema)),
    ("release", ctypes.c_void_p),
    ("private_data", ctypes.c_void_p),
]


MaterializeFn = ctypes.CFUNCTYPE(
    ctypes.c_int,
    ctypes.c_void_p,
    ctypes.c_uint64,
    DagMlDataBytesView,
    ctypes.POINTER(ctypes.c_uint64),
)
MakeViewFn = ctypes.CFUNCTYPE(
    ctypes.c_int,
    ctypes.c_void_p,
    ctypes.c_uint64,
    DagMlDataBytesView,
    ctypes.POINTER(ctypes.c_uint64),
)
ViewIdentityFn = ctypes.CFUNCTYPE(
    ctypes.c_int,
    ctypes.c_void_p,
    ctypes.c_uint64,
    ctypes.POINTER(ctypes.POINTER(ArrowArray)),
    ctypes.POINTER(ctypes.POINTER(ArrowSchema)),
)
TargetArrowFn = ctypes.CFUNCTYPE(
    ctypes.c_int,
    ctypes.c_void_p,
    ctypes.c_uint64,
    DagMlDataBytesView,
    ctypes.POINTER(ctypes.POINTER(ArrowArray)),
    ctypes.POINTER(ctypes.POINTER(ArrowSchema)),
)
FeatureArrowFn = ctypes.CFUNCTYPE(
    ctypes.c_int,
    ctypes.c_void_p,
    ctypes.c_uint64,
    DagMlDataBytesView,
    ctypes.POINTER(ctypes.POINTER(ArrowArray)),
    ctypes.POINTER(ctypes.POINTER(ArrowSchema)),
)
ReleaseFn = ctypes.CFUNCTYPE(None, ctypes.c_void_p, ctypes.c_uint64)
DestroyFn = ctypes.CFUNCTYPE(None, ctypes.c_void_p)


class DagMlDataVTable(ctypes.Structure):
    _fields_ = [
        ("abi_version", ctypes.c_uint32),
        ("user_data", ctypes.c_void_p),
        ("materialize", MaterializeFn),
        ("make_view", MakeViewFn),
        ("view_identity", ViewIdentityFn),
        ("target_arrow", TargetArrowFn),
        ("feature_arrow", FeatureArrowFn),
        ("release", ReleaseFn),
        ("destroy", DestroyFn),
    ]


def configure_library(lib: ctypes.CDLL) -> ctypes.CDLL:
    """Pins argtypes/restypes for the C ABI symbols this package calls."""
    lib.dagmldata_inmemory_provider_new_json.argtypes = [
        ctypes.POINTER(ctypes.c_uint8),
        ctypes.c_size_t,
        ctypes.POINTER(ctypes.c_uint8),
        ctypes.c_size_t,
        ctypes.POINTER(DagMlDataVTable),
        ctypes.POINTER(DagMlDataString),
    ]
    lib.dagmldata_inmemory_provider_new_json.restype = ctypes.c_int
    lib.dagmldata_inmemory_provider_new_with_features_json.argtypes = [
        ctypes.POINTER(ctypes.c_uint8),
        ctypes.c_size_t,
        ctypes.POINTER(ctypes.c_uint8),
        ctypes.c_size_t,
        ctypes.POINTER(ctypes.c_uint8),
        ctypes.c_size_t,
        ctypes.POINTER(DagMlDataVTable),
        ctypes.POINTER(DagMlDataString),
    ]
    lib.dagmldata_inmemory_provider_new_with_features_json.restype = ctypes.c_int
    lib.dagmldata_inmemory_provider_new_with_f64_features_json.argtypes = [
        ctypes.POINTER(ctypes.c_uint8),
        ctypes.c_size_t,
        ctypes.POINTER(ctypes.c_uint8),
        ctypes.c_size_t,
        ctypes.POINTER(ctypes.c_uint8),
        ctypes.c_size_t,
        ctypes.POINTER(DagMlDataVTable),
        ctypes.POINTER(DagMlDataString),
    ]
    lib.dagmldata_inmemory_provider_new_with_f64_features_json.restype = ctypes.c_int
    lib.dagmldata_inmemory_provider_feature_buffer_manifest_json.argtypes = [
        ctypes.POINTER(DagMlDataVTable),
        ctypes.POINTER(DagMlDataString),
        ctypes.POINTER(DagMlDataString),
    ]
    lib.dagmldata_inmemory_provider_feature_buffer_manifest_json.restype = ctypes.c_int
    lib.dagmldata_inmemory_provider_data_feature_buffer_manifest_json.argtypes = [
        ctypes.POINTER(DagMlDataVTable),
        ctypes.c_uint64,
        ctypes.POINTER(DagMlDataString),
        ctypes.POINTER(DagMlDataString),
    ]
    lib.dagmldata_inmemory_provider_data_feature_buffer_manifest_json.restype = ctypes.c_int
    lib.dagmldata_inmemory_provider_feature_collation_json.argtypes = [
        ctypes.POINTER(DagMlDataVTable),
        ctypes.c_uint64,
        DagMlDataBytesView,
        ctypes.POINTER(DagMlDataString),
        ctypes.POINTER(DagMlDataString),
    ]
    lib.dagmldata_inmemory_provider_feature_collation_json.restype = ctypes.c_int
    lib.dagmldata_inmemory_provider_feature_collation_tensor_f64_json.argtypes = [
        ctypes.POINTER(DagMlDataVTable),
        ctypes.c_uint64,
        DagMlDataBytesView,
        ctypes.POINTER(DagMlDataTensorF64),
        ctypes.POINTER(DagMlDataString),
    ]
    lib.dagmldata_inmemory_provider_feature_collation_tensor_f64_json.restype = ctypes.c_int
    lib.dagmldata_inmemory_provider_destroy.argtypes = [ctypes.POINTER(DagMlDataVTable)]
    lib.dagmldata_inmemory_provider_destroy.restype = None
    lib.dagmldata_string_free.argtypes = [DagMlDataString]
    lib.dagmldata_string_free.restype = None
    lib.dagmldata_tensor_f64_free.argtypes = [DagMlDataTensorF64]
    lib.dagmldata_tensor_f64_free.restype = None
    lib.dagmldata_arrow_array_free.argtypes = [ctypes.POINTER(ArrowArray)]
    lib.dagmldata_arrow_array_free.restype = None
    lib.dagmldata_arrow_schema_free.argtypes = [ctypes.POINTER(ArrowSchema)]
    lib.dagmldata_arrow_schema_free.restype = None
    return lib
