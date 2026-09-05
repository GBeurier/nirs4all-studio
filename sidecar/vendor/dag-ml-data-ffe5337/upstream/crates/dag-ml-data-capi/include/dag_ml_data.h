#ifndef DAG_ML_DATA_H
#define DAG_ML_DATA_H

#include <stdint.h>
#include <stddef.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef uint64_t DagMlDataHandle;

typedef enum DagMlDataStatusCode {
    DAG_ML_DATA_STATUS_OK = 0,
    DAG_ML_DATA_STATUS_INVALID_ARGUMENT = 1,
    DAG_ML_DATA_STATUS_VALIDATION_ERROR = 2,
    DAG_ML_DATA_STATUS_PANIC = 255
} DagMlDataStatusCode;

typedef struct DagMlDataVersion {
    uint32_t major;
    uint32_t minor;
    uint32_t patch;
} DagMlDataVersion;

typedef struct DagMlDataString {
    char *ptr;
    size_t len;
} DagMlDataString;

typedef struct DagMlDataBytesView {
    const uint8_t *ptr;
    size_t len;
} DagMlDataBytesView;

#define DAG_ML_DATA_TENSOR_F64_ABI_VERSION 1u

typedef struct DagMlDataStringArray {
    DagMlDataString *ptr;
    size_t len;
} DagMlDataStringArray;

typedef struct DagMlDataUSizeArray {
    size_t *ptr;
    size_t len;
} DagMlDataUSizeArray;

typedef struct DagMlDataF64Array {
    double *ptr;
    size_t len;
} DagMlDataF64Array;

typedef struct DagMlDataF32Array {
    float *ptr;
    size_t len;
} DagMlDataF32Array;

typedef struct DagMlDataU8Array {
    uint8_t *ptr;
    size_t len;
} DagMlDataU8Array;

typedef struct DagMlDataTensorF64 {
    uint32_t abi_version;
    DagMlDataString block_id;
    DagMlDataString representation_id;
    DagMlDataString batch_container;
    DagMlDataStringArray observation_ids;
    DagMlDataStringArray sample_ids;
    DagMlDataUSizeArray shape;
    DagMlDataF64Array values;
    DagMlDataU8Array presence_mask;
    DagMlDataU8Array validity_mask;
    DagMlDataStringArray feature_names;
} DagMlDataTensorF64;

#define DAG_ML_DATA_TENSOR_F32_ABI_VERSION 1u

typedef struct DagMlDataTensorF32 {
    uint32_t abi_version;
    DagMlDataString block_id;
    DagMlDataString representation_id;
    DagMlDataString batch_container;
    DagMlDataStringArray observation_ids;
    DagMlDataStringArray sample_ids;
    DagMlDataUSizeArray shape;
    DagMlDataF32Array values;
    DagMlDataU8Array presence_mask;
    DagMlDataU8Array validity_mask;
    DagMlDataStringArray feature_names;
} DagMlDataTensorF32;

#define DAG_ML_DATA_BORROWED_TENSOR_VIEW_ABI_VERSION 1u
#define DAG_ML_DATA_OWNED_TENSOR_ABI_VERSION 1u

typedef enum DagMlDataTensorDType {
    DAG_ML_DATA_TENSOR_DTYPE_F64 = 0,
    DAG_ML_DATA_TENSOR_DTYPE_F32 = 1,
    DAG_ML_DATA_TENSOR_DTYPE_U8 = 2,
    DAG_ML_DATA_TENSOR_DTYPE_I32 = 3,
    DAG_ML_DATA_TENSOR_DTYPE_BOOL = 4
} DagMlDataTensorDType;

/* Borrowed N-D tensor view. Axis 0 is the sample/observation axis
 * (shape[0] == ids_len). strides_bytes may be NULL (contiguous row-major) or
 * strictly positive byte strides; the constructor copies into canonical
 * row-major bytes and discards strides. Multibyte elements (F64/F32/I32) MUST
 * be little-endian: the constructor copies element bytes verbatim and never
 * byte-swaps, and the reproducibility fingerprint hashes them as-is, so the
 * little-endian encoding is part of the contract (a big-endian caller must
 * canonicalize before passing the view). All pointers are borrowed for the
 * duration of the constructor call only. */
typedef struct DagMlDataBorrowedTensorView {
    uint32_t abi_version;
    DagMlDataBytesView tensor_id;
    DagMlDataBytesView representation_id;
    DagMlDataBytesView container;
    /* A DagMlDataTensorDType value, carried as uint32_t so an out-of-range code
     * is rejected by the library instead of being undefined behaviour. */
    uint32_t dtype;
    const uint8_t *data;
    size_t data_len;
    const size_t *shape;
    const ptrdiff_t *strides_bytes;
    size_t rank;
    const DagMlDataBytesView *observation_ids;
    const DagMlDataBytesView *sample_ids;
    size_t ids_len;
    const uint8_t *row_presence_mask;
    size_t row_presence_len;
} DagMlDataBorrowedTensorView;

/* Rust-owned, contiguous row-major N-D tensor returned by the ND export.
 * Release with dagmldata_nd_tensor_free. */
typedef struct DagMlDataOwnedTensor {
    uint32_t abi_version;
    DagMlDataString tensor_id;
    DagMlDataString representation_id;
    DagMlDataString container;
    DagMlDataTensorDType dtype;
    DagMlDataStringArray observation_ids;
    DagMlDataStringArray sample_ids;
    DagMlDataUSizeArray shape;
    DagMlDataU8Array data;
    DagMlDataU8Array row_presence_mask;
} DagMlDataOwnedTensor;

typedef struct DagMlDataFeatureMatrixF64View {
    DagMlDataBytesView feature_set_id;
    DagMlDataBytesView representation_id;
    const DagMlDataBytesView *feature_names;
    size_t feature_names_len;
    const DagMlDataBytesView *observation_ids;
    size_t observation_ids_len;
    const double *values;
    size_t values_len;
    const uint8_t *validity_mask;
    size_t validity_mask_len;
} DagMlDataFeatureMatrixF64View;

typedef struct DagMlDataF64ColumnView {
    const double *values;
    size_t values_len;
    const uint8_t *validity_mask;
    size_t validity_mask_len;
} DagMlDataF64ColumnView;

typedef struct DagMlDataFeatureMatrixF64ColumnarView {
    DagMlDataBytesView feature_set_id;
    DagMlDataBytesView representation_id;
    const DagMlDataBytesView *feature_names;
    size_t feature_names_len;
    const DagMlDataBytesView *observation_ids;
    size_t observation_ids_len;
    const DagMlDataF64ColumnView *columns;
    size_t columns_len;
} DagMlDataFeatureMatrixF64ColumnarView;

#ifndef ARROW_C_DATA_INTERFACE
#define ARROW_C_DATA_INTERFACE

typedef struct ArrowArray {
    int64_t length;
    int64_t null_count;
    int64_t offset;
    int64_t n_buffers;
    int64_t n_children;
    const void **buffers;
    struct ArrowArray **children;
    struct ArrowArray *dictionary;
    void (*release)(struct ArrowArray *array);
    void *private_data;
} ArrowArray;

typedef struct ArrowSchema {
    const char *format;
    const char *name;
    const char *metadata;
    int64_t flags;
    int64_t n_children;
    struct ArrowSchema **children;
    struct ArrowSchema *dictionary;
    void (*release)(struct ArrowSchema *schema);
    void *private_data;
} ArrowSchema;

#endif

#ifndef DAG_ML_DATA_PROVIDER_VTABLE_ABI_VERSION
#define DAG_ML_DATA_PROVIDER_VTABLE_ABI_VERSION 2u
#endif

#ifndef DAG_ML_DATA_VTABLE_DEFINED
#define DAG_ML_DATA_VTABLE_DEFINED
typedef struct DagMlDataVTable {
    uint32_t abi_version;
    void *user_data;
    DagMlDataStatusCode (*materialize)(void *user_data, DagMlDataHandle dataset, DagMlDataBytesView request_json, DagMlDataHandle *out_handle);
    DagMlDataStatusCode (*make_view)(void *user_data, DagMlDataHandle dataset, DagMlDataBytesView selector_json, DagMlDataHandle *out_view);
    DagMlDataStatusCode (*view_identity)(void *user_data, DagMlDataHandle view, ArrowArray **out_arrow_array, ArrowSchema **out_arrow_schema);
    DagMlDataStatusCode (*target_arrow)(void *user_data, DagMlDataHandle view, DagMlDataBytesView target_name, ArrowArray **out_arrow_array, ArrowSchema **out_arrow_schema);
    DagMlDataStatusCode (*feature_arrow)(void *user_data, DagMlDataHandle view, DagMlDataBytesView feature_set_name, ArrowArray **out_arrow_array, ArrowSchema **out_arrow_schema);
    void (*release)(void *user_data, DagMlDataHandle handle);
    void (*destroy)(void *user_data);
} DagMlDataVTable;
#endif

DagMlDataVersion dagmldata_version(void);
void dagmldata_string_free(DagMlDataString value);
/* ADR-11 thread-local last-error accessors. The buffer holds the structured
 * descriptor JSON and numeric (category << 16 | code) of the most recent failing
 * call on the calling thread. Every failing call updates it: taxonomy errors
 * carry their real category/code; boundary errors (null pointer, bad UTF-8) use
 * validation/c_abi_argument (0x0000FFFF). Errno-like semantics: it is NOT cleared
 * on success, so check the function's return code first, then read the buffer on
 * the same thread. */
DagMlDataStatusCode dagmldata_last_error_json(DagMlDataString *out);
uint32_t dagmldata_last_error_code(void);
void dagmldata_tensor_f64_free(DagMlDataTensorF64 tensor);
void dagmldata_tensor_f32_free(DagMlDataTensorF32 tensor);
void dagmldata_nd_tensor_free(DagMlDataOwnedTensor tensor);
void dagmldata_arrow_array_free(ArrowArray *array);
void dagmldata_arrow_schema_free(ArrowSchema *schema);
DagMlDataStatusCode dagmldata_schema_fingerprint_json(const uint8_t *json_ptr, size_t json_len, DagMlDataString *fingerprint_out, DagMlDataString *error_out);
DagMlDataStatusCode dagmldata_fold_set_validate_json(const uint8_t *json_ptr, size_t json_len, DagMlDataString *error_out);
DagMlDataStatusCode dagmldata_aggregation_policy_validate_json(const uint8_t *json_ptr, size_t json_len, DagMlDataString *error_out);
DagMlDataStatusCode dagmldata_fold_set_fingerprint_json(const uint8_t *json_ptr, size_t json_len, DagMlDataString *fingerprint_out, DagMlDataString *error_out);
DagMlDataStatusCode dagmldata_fold_set_validate_against_relations_json(const uint8_t *fold_set_ptr, size_t fold_set_len, const uint8_t *relations_ptr, size_t relations_len, DagMlDataString *error_out);
DagMlDataStatusCode dagmldata_fitted_adapter_ref_validate_json(const uint8_t *json_ptr, size_t json_len, uint8_t require_portable, DagMlDataString *error_out);
DagMlDataStatusCode dagmldata_fitted_adapter_manifest_validate_json(const uint8_t *json_ptr, size_t json_len, uint8_t require_portable, DagMlDataString *error_out);

typedef struct DagMlDataFittedAdapterStoreHandle {
    void *ptr;
} DagMlDataFittedAdapterStoreHandle;

DagMlDataStatusCode dagmldata_inmemory_fitted_adapter_store_new(DagMlDataFittedAdapterStoreHandle *out_store);
void dagmldata_inmemory_fitted_adapter_store_destroy(DagMlDataFittedAdapterStoreHandle store);
DagMlDataStatusCode dagmldata_inmemory_fitted_adapter_store_register_json(DagMlDataFittedAdapterStoreHandle store, const uint8_t *json_ptr, size_t json_len, uint64_t *out_handle, DagMlDataString *error_out);
DagMlDataStatusCode dagmldata_inmemory_fitted_adapter_store_materialize_json(DagMlDataFittedAdapterStoreHandle store, const uint8_t *json_ptr, size_t json_len, uint64_t *out_handle, DagMlDataString *error_out);
DagMlDataStatusCode dagmldata_inmemory_fitted_adapter_store_release(DagMlDataFittedAdapterStoreHandle store, const uint8_t *adapter_id, size_t adapter_id_len, uint8_t *out_released);
DagMlDataStatusCode dagmldata_inmemory_provider_attach_fitted_adapter_store(const DagMlDataVTable *vtable, DagMlDataFittedAdapterStoreHandle store, DagMlDataString *error_out);
DagMlDataStatusCode dagmldata_inmemory_provider_materialize_fitted_adapter_json(const DagMlDataVTable *vtable, const uint8_t *json_ptr, size_t json_len, uint64_t *out_handle, DagMlDataString *error_out);
DagMlDataStatusCode dagmldata_coordinator_identity_arrow_json(const uint8_t *json_ptr, size_t json_len, ArrowArray **out_arrow_array, ArrowSchema **out_arrow_schema, DagMlDataString *error_out);
DagMlDataStatusCode dagmldata_coordinator_target_arrow_json(const uint8_t *json_ptr, size_t json_len, ArrowArray **out_arrow_array, ArrowSchema **out_arrow_schema, DagMlDataString *error_out);
DagMlDataStatusCode dagmldata_coordinator_multi_target_arrow_json(const uint8_t *json_ptr, size_t json_len, ArrowArray **out_arrow_array, ArrowSchema **out_arrow_schema, DagMlDataString *error_out);
DagMlDataStatusCode dagmldata_coordinator_feature_arrow_json(const uint8_t *json_ptr, size_t json_len, ArrowArray **out_arrow_array, ArrowSchema **out_arrow_schema, DagMlDataString *error_out);
DagMlDataStatusCode dagmldata_coordinator_feature_fusion_arrow_json(const uint8_t *json_ptr, size_t json_len, ArrowArray **out_arrow_array, ArrowSchema **out_arrow_schema, DagMlDataString *error_out);
DagMlDataStatusCode dagmldata_coordinator_feature_collation_json(const uint8_t *json_ptr, size_t json_len, DagMlDataString *out_json, DagMlDataString *error_out);
DagMlDataStatusCode dagmldata_coordinator_feature_collation_tensor_f64_json(const uint8_t *json_ptr, size_t json_len, DagMlDataTensorF64 *out_tensor, DagMlDataString *error_out);
DagMlDataStatusCode dagmldata_coordinator_feature_collation_tensor_f32_json(const uint8_t *json_ptr, size_t json_len, DagMlDataTensorF32 *out_tensor, DagMlDataString *error_out);
DagMlDataStatusCode dagmldata_inmemory_provider_new_json(const uint8_t *envelope_ptr, size_t envelope_len, const uint8_t *target_tables_ptr, size_t target_tables_len, DagMlDataVTable *out_vtable, DagMlDataString *error_out);
DagMlDataStatusCode dagmldata_inmemory_provider_new_with_features_json(const uint8_t *envelope_ptr, size_t envelope_len, const uint8_t *target_tables_ptr, size_t target_tables_len, const uint8_t *feature_tables_ptr, size_t feature_tables_len, DagMlDataVTable *out_vtable, DagMlDataString *error_out);
DagMlDataStatusCode dagmldata_inmemory_provider_new_with_f64_features_json(const uint8_t *envelope_ptr, size_t envelope_len, const uint8_t *target_tables_ptr, size_t target_tables_len, const uint8_t *feature_matrices_ptr, size_t feature_matrices_len, DagMlDataVTable *out_vtable, DagMlDataString *error_out);
DagMlDataStatusCode dagmldata_inmemory_provider_new_with_f64_feature_views(const uint8_t *envelope_ptr, size_t envelope_len, const uint8_t *target_tables_ptr, size_t target_tables_len, const DagMlDataFeatureMatrixF64View *feature_matrices, size_t feature_matrices_len, DagMlDataVTable *out_vtable, DagMlDataString *error_out);
DagMlDataStatusCode dagmldata_inmemory_provider_new_with_f64_feature_columns(const uint8_t *envelope_ptr, size_t envelope_len, const uint8_t *target_tables_ptr, size_t target_tables_len, const DagMlDataFeatureMatrixF64ColumnarView *feature_matrices, size_t feature_matrices_len, DagMlDataVTable *out_vtable, DagMlDataString *error_out);
DagMlDataStatusCode dagmldata_inmemory_provider_new_from_file(const uint8_t *envelope_ptr, size_t envelope_len, const uint8_t *target_tables_ptr, size_t target_tables_len, const uint8_t *path_ptr, size_t path_len, DagMlDataVTable *out_vtable, DagMlDataString *error_out);
DagMlDataStatusCode dagmldata_inmemory_provider_new_with_tensor_views(const uint8_t *envelope_ptr, size_t envelope_len, const uint8_t *target_tables_ptr, size_t target_tables_len, const DagMlDataBorrowedTensorView *tensor_views, size_t tensor_views_len, DagMlDataVTable *out_vtable, DagMlDataString *error_out);
DagMlDataStatusCode dagmldata_inmemory_provider_nd_tensor_manifest_json(const DagMlDataVTable *vtable, DagMlDataString *out_json, DagMlDataString *error_out);
DagMlDataStatusCode dagmldata_inmemory_provider_data_nd_tensor_manifest_json(const DagMlDataVTable *vtable, DagMlDataHandle data_handle, DagMlDataString *out_json, DagMlDataString *error_out);
DagMlDataStatusCode dagmldata_inmemory_provider_nd_tensor_export_json(const DagMlDataVTable *vtable, DagMlDataHandle view, DagMlDataBytesView selector_json, DagMlDataOwnedTensor *out_tensor, DagMlDataString *error_out);
/* dagmldata_inmemory_provider_new_from_arrow_ipc is only present when the
   `arrow-ipc` feature is enabled in the dag-ml-data-capi build. Hosts that
   link a feature-enabled library must define DAG_ML_DATA_ARROW_IPC before
   including this header, or the call will fail to resolve at link time. */
#ifdef DAG_ML_DATA_ARROW_IPC
DagMlDataStatusCode dagmldata_inmemory_provider_new_from_arrow_ipc(const uint8_t *envelope_ptr, size_t envelope_len, const uint8_t *target_tables_ptr, size_t target_tables_len, const uint8_t *path_ptr, size_t path_len, DagMlDataVTable *out_vtable, DagMlDataString *error_out);
#endif

#define DAG_ML_DATA_BUFFER_FETCHER_ABI_VERSION 1u

/* DagMlDataBufferFetcherVTable: host-implemented vtable used by
   `dagmldata_inmemory_provider_new_with_buffer_fetcher` to fetch feature
   buffer bytes on demand.

   Lifecycle: the constructor invokes `destroy(user_data)` exactly once
   before returning (success or failure). The same `user_data` MUST NOT
   be shared across concurrent constructor calls — each call destroys
   the user_data, so concurrent invocations would double-free the host
   allocation.

   `fetch_columnar` semantics: the host owns the bytes pointed to by
   `out_view` for the duration of the call only. The provider copies
   them into Rust-owned buffers before the call returns; the host may
   release its memory immediately afterwards. The host must not populate
   `error_out` when returning `DAG_ML_DATA_STATUS_OK`; if it does the
   provider frees the string defensively to prevent a leak. */
typedef struct DagMlDataBufferFetcherVTable {
    uint32_t abi_version;
    void *user_data;
    DagMlDataStatusCode (*fetch_columnar)(void *user_data, DagMlDataBytesView feature_set_id, DagMlDataBytesView content_fingerprint, DagMlDataFeatureMatrixF64ColumnarView *out_view, DagMlDataString *error_out);
    void (*destroy)(void *user_data);
} DagMlDataBufferFetcherVTable;

typedef struct DagMlDataBufferFetchRequest {
    DagMlDataBytesView feature_set_id;
    DagMlDataBytesView content_fingerprint;
} DagMlDataBufferFetchRequest;

DagMlDataStatusCode dagmldata_inmemory_provider_new_with_buffer_fetcher(const uint8_t *envelope_ptr, size_t envelope_len, const uint8_t *target_tables_ptr, size_t target_tables_len, DagMlDataBufferFetcherVTable fetcher, const DagMlDataBufferFetchRequest *requests, size_t requests_len, DagMlDataVTable *out_vtable, DagMlDataString *error_out);
DagMlDataStatusCode dagmldata_inmemory_provider_feature_buffer_manifest_json(const DagMlDataVTable *vtable, DagMlDataString *out_json, DagMlDataString *error_out);
DagMlDataStatusCode dagmldata_inmemory_provider_data_feature_buffer_manifest_json(const DagMlDataVTable *vtable, DagMlDataHandle data_handle, DagMlDataString *out_json, DagMlDataString *error_out);
DagMlDataStatusCode dagmldata_inmemory_provider_feature_collation_json(const DagMlDataVTable *vtable, DagMlDataHandle view, DagMlDataBytesView selector_json, DagMlDataString *out_json, DagMlDataString *error_out);
DagMlDataStatusCode dagmldata_inmemory_provider_feature_collation_tensor_f64_json(const DagMlDataVTable *vtable, DagMlDataHandle view, DagMlDataBytesView selector_json, DagMlDataTensorF64 *out_tensor, DagMlDataString *error_out);
DagMlDataStatusCode dagmldata_inmemory_provider_feature_collation_tensor_f32_json(const DagMlDataVTable *vtable, DagMlDataHandle view, DagMlDataBytesView selector_json, DagMlDataTensorF32 *out_tensor, DagMlDataString *error_out);
void dagmldata_inmemory_provider_destroy(DagMlDataVTable *vtable);

#ifdef __cplusplus
}
#endif

#endif
