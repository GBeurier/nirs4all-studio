use std::cell::RefCell;
use std::collections::BTreeMap;
use std::ffi::{c_void, CString};
use std::os::raw::c_char;
use std::slice;

use dag_ml_data_core::{
    collate_feature_block, fold_set_fingerprint, fuse_feature_blocks, schema_fingerprint,
    AggregationPolicy, CollationPolicy, CoordinatorDataMaterializationRequest,
    CoordinatorDataPlanEnvelope, CoordinatorFeatureBlock, CoordinatorFeatureTable,
    CoordinatorHandleArena, CoordinatorMultiTargetBlock, CoordinatorTargetBlock,
    CoordinatorTargetTable, DataError, DataView, DatasetSchema, FeatureFusionPolicy,
    FeatureFusionSourceLayout, FittedAdapterManifest, FittedAdapterMaterializationRequest,
    FittedAdapterRef, FoldSet, InMemoryFittedAdapterStore, NdTensorBlock, NdTensorInput,
    NdTensorStore, NumericFeatureBufferStore, NumericFeatureMatrixF64,
    NumericFeatureMatrixF64Columnar, NumericTensorBlock, ObservationId, RepresentationId,
    RuntimeFittedAdapterStore, SampleAlignmentPlan, SampleRelationTable, SourceFeatureBlock,
    TargetId,
};
#[cfg(test)]
use dag_ml_data_core::{SampleId, SourceId};
use dag_ml_data_provider::{
    default_owner_controller, DagMlDataProvider, InMemoryProvider, ProviderFeatureCollationRequest,
    ProviderFeatureFusionSelector,
};
use serde::Deserialize;

/// Opaque handle to a host-owned object passed across the C ABI.
pub type DagMlDataHandle = u64;
/// ABI version of the host data-provider vtable; must match the C header.
pub const DAG_ML_DATA_PROVIDER_VTABLE_ABI_VERSION: u32 = 2;

/// Status code returned by C ABI entry points.
#[repr(C)]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum DagMlDataStatusCode {
    Ok = 0,
    InvalidArgument = 1,
    ValidationError = 2,
    Panic = 255,
}

/// Semantic version (major/minor/patch) of the C ABI library.
#[repr(C)]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct DagMlDataVersion {
    pub major: u32,
    pub minor: u32,
    pub patch: u32,
}

/// Owned UTF-8 string returned across the ABI; release with the matching free function.
#[repr(C)]
#[derive(Clone, Copy, Debug)]
pub struct DagMlDataString {
    pub ptr: *mut c_char,
    pub len: usize,
}

impl Default for DagMlDataString {
    fn default() -> Self {
        Self {
            ptr: std::ptr::null_mut(),
            len: 0,
        }
    }
}

/// Borrowed view over a caller-owned byte buffer.
#[repr(C)]
#[derive(Clone, Copy, Debug)]
pub struct DagMlDataBytesView {
    pub ptr: *const u8,
    pub len: usize,
}

/// Borrowed row-major f64 feature matrix supplied by the host.
#[repr(C)]
#[derive(Clone, Copy, Debug)]
pub struct DagMlDataFeatureMatrixF64View {
    pub feature_set_id: DagMlDataBytesView,
    pub representation_id: DagMlDataBytesView,
    pub feature_names: *const DagMlDataBytesView,
    pub feature_names_len: usize,
    pub observation_ids: *const DagMlDataBytesView,
    pub observation_ids_len: usize,
    pub values: *const f64,
    pub values_len: usize,
    pub validity_mask: *const u8,
    pub validity_mask_len: usize,
}

/// Borrowed single f64 feature column with an optional validity mask.
#[repr(C)]
#[derive(Clone, Copy, Debug)]
pub struct DagMlDataF64ColumnView {
    pub values: *const f64,
    pub values_len: usize,
    pub validity_mask: *const u8,
    pub validity_mask_len: usize,
}

/// Borrowed columnar f64 feature matrix supplied by the host.
#[repr(C)]
#[derive(Clone, Copy, Debug)]
pub struct DagMlDataFeatureMatrixF64ColumnarView {
    pub feature_set_id: DagMlDataBytesView,
    pub representation_id: DagMlDataBytesView,
    pub feature_names: *const DagMlDataBytesView,
    pub feature_names_len: usize,
    pub observation_ids: *const DagMlDataBytesView,
    pub observation_ids_len: usize,
    pub columns: *const DagMlDataF64ColumnView,
    pub columns_len: usize,
}

/// Owned array of `DagMlDataString` values returned across the ABI.
#[repr(C)]
#[derive(Clone, Copy, Debug)]
pub struct DagMlDataStringArray {
    pub ptr: *mut DagMlDataString,
    pub len: usize,
}

impl Default for DagMlDataStringArray {
    fn default() -> Self {
        Self {
            ptr: std::ptr::null_mut(),
            len: 0,
        }
    }
}

/// Owned array of `usize` values returned across the ABI.
#[repr(C)]
#[derive(Clone, Copy, Debug)]
pub struct DagMlDataUSizeArray {
    pub ptr: *mut usize,
    pub len: usize,
}

impl Default for DagMlDataUSizeArray {
    fn default() -> Self {
        Self {
            ptr: std::ptr::null_mut(),
            len: 0,
        }
    }
}

/// Owned array of `f64` values returned across the ABI.
#[repr(C)]
#[derive(Clone, Copy, Debug)]
pub struct DagMlDataF64Array {
    pub ptr: *mut f64,
    pub len: usize,
}

impl Default for DagMlDataF64Array {
    fn default() -> Self {
        Self {
            ptr: std::ptr::null_mut(),
            len: 0,
        }
    }
}

/// Owned array of `f32` values returned across the ABI.
#[repr(C)]
#[derive(Clone, Copy, Debug)]
pub struct DagMlDataF32Array {
    pub ptr: *mut f32,
    pub len: usize,
}

impl Default for DagMlDataF32Array {
    fn default() -> Self {
        Self {
            ptr: std::ptr::null_mut(),
            len: 0,
        }
    }
}

/// Owned array of `u8` values (for example presence or validity masks).
#[repr(C)]
#[derive(Clone, Copy, Debug)]
pub struct DagMlDataU8Array {
    pub ptr: *mut u8,
    pub len: usize,
}

impl Default for DagMlDataU8Array {
    fn default() -> Self {
        Self {
            ptr: std::ptr::null_mut(),
            len: 0,
        }
    }
}

/// ABI version of the `DagMlDataTensorF64` transport struct.
pub const DAG_ML_DATA_TENSOR_F64_ABI_VERSION: u32 = 1;

/// Owned f64 N-dimensional tensor transport returned across the ABI.
#[repr(C)]
#[derive(Clone, Copy, Debug)]
pub struct DagMlDataTensorF64 {
    pub abi_version: u32,
    pub block_id: DagMlDataString,
    pub representation_id: DagMlDataString,
    pub batch_container: DagMlDataString,
    pub observation_ids: DagMlDataStringArray,
    pub sample_ids: DagMlDataStringArray,
    pub shape: DagMlDataUSizeArray,
    pub values: DagMlDataF64Array,
    pub presence_mask: DagMlDataU8Array,
    pub validity_mask: DagMlDataU8Array,
    pub feature_names: DagMlDataStringArray,
}

impl Default for DagMlDataTensorF64 {
    fn default() -> Self {
        Self {
            abi_version: DAG_ML_DATA_TENSOR_F64_ABI_VERSION,
            block_id: DagMlDataString::default(),
            representation_id: DagMlDataString::default(),
            batch_container: DagMlDataString::default(),
            observation_ids: DagMlDataStringArray::default(),
            sample_ids: DagMlDataStringArray::default(),
            shape: DagMlDataUSizeArray::default(),
            values: DagMlDataF64Array::default(),
            presence_mask: DagMlDataU8Array::default(),
            validity_mask: DagMlDataU8Array::default(),
            feature_names: DagMlDataStringArray::default(),
        }
    }
}

/// ABI version of the `DagMlDataTensorF32` transport struct.
pub const DAG_ML_DATA_TENSOR_F32_ABI_VERSION: u32 = 1;

/// Owned f32 N-dimensional tensor transport returned across the ABI.
#[repr(C)]
#[derive(Clone, Copy, Debug)]
pub struct DagMlDataTensorF32 {
    pub abi_version: u32,
    pub block_id: DagMlDataString,
    pub representation_id: DagMlDataString,
    pub batch_container: DagMlDataString,
    pub observation_ids: DagMlDataStringArray,
    pub sample_ids: DagMlDataStringArray,
    pub shape: DagMlDataUSizeArray,
    pub values: DagMlDataF32Array,
    pub presence_mask: DagMlDataU8Array,
    pub validity_mask: DagMlDataU8Array,
    pub feature_names: DagMlDataStringArray,
}

impl Default for DagMlDataTensorF32 {
    fn default() -> Self {
        Self {
            abi_version: DAG_ML_DATA_TENSOR_F32_ABI_VERSION,
            block_id: DagMlDataString::default(),
            representation_id: DagMlDataString::default(),
            batch_container: DagMlDataString::default(),
            observation_ids: DagMlDataStringArray::default(),
            sample_ids: DagMlDataStringArray::default(),
            shape: DagMlDataUSizeArray::default(),
            values: DagMlDataF32Array::default(),
            presence_mask: DagMlDataU8Array::default(),
            validity_mask: DagMlDataU8Array::default(),
            feature_names: DagMlDataStringArray::default(),
        }
    }
}

pub const DAG_ML_DATA_BORROWED_TENSOR_VIEW_ABI_VERSION: u32 = 1;
pub const DAG_ML_DATA_OWNED_TENSOR_ABI_VERSION: u32 = 1;

/// Element dtype of an N-D tensor; discriminants are stable ABI.
#[repr(C)]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum DagMlDataTensorDType {
    F64 = 0,
    F32 = 1,
    U8 = 2,
    I32 = 3,
    Bool = 4,
}

impl DagMlDataTensorDType {
    /// Maps a raw inbound dtype code (carried as `u32` on the borrowed view so an
    /// invalid value is a clean error, never an out-of-range enum discriminant /
    /// UB).
    fn from_code(value: u32) -> dag_ml_data_core::Result<dag_ml_data_core::NdTensorDType> {
        Ok(match value {
            0 => dag_ml_data_core::NdTensorDType::F64,
            1 => dag_ml_data_core::NdTensorDType::F32,
            2 => dag_ml_data_core::NdTensorDType::U8,
            3 => dag_ml_data_core::NdTensorDType::I32,
            4 => dag_ml_data_core::NdTensorDType::Bool,
            other => {
                return Err(dag_ml_data_core::DataError::Validation(format!(
                    "unknown tensor dtype code {other}"
                )))
            }
        })
    }

    fn from_core(dtype: dag_ml_data_core::NdTensorDType) -> Self {
        match dtype {
            dag_ml_data_core::NdTensorDType::F64 => DagMlDataTensorDType::F64,
            dag_ml_data_core::NdTensorDType::F32 => DagMlDataTensorDType::F32,
            dag_ml_data_core::NdTensorDType::U8 => DagMlDataTensorDType::U8,
            dag_ml_data_core::NdTensorDType::I32 => DagMlDataTensorDType::I32,
            dag_ml_data_core::NdTensorDType::Bool => DagMlDataTensorDType::Bool,
        }
    }
}

/// Borrowed (host-owned) N-D tensor view. Axis 0 is the sample/observation axis;
/// `shape[0] == ids_len`. `dtype` is a raw `DagMlDataTensorDType` code (u32) so
/// an invalid value is rejected rather than producing UB. `strides_bytes` may be
/// null (contiguous row-major) or positive byte strides; the constructor copies
/// into canonical row-major bytes and discards strides. All pointers are
/// borrowed for the duration of the constructor call only.
#[repr(C)]
pub struct DagMlDataBorrowedTensorView {
    pub abi_version: u32,
    pub tensor_id: DagMlDataBytesView,
    pub representation_id: DagMlDataBytesView,
    pub container: DagMlDataBytesView,
    pub dtype: u32,
    pub data: *const u8,
    pub data_len: usize,
    pub shape: *const usize,
    pub strides_bytes: *const isize,
    pub rank: usize,
    pub observation_ids: *const DagMlDataBytesView,
    pub sample_ids: *const DagMlDataBytesView,
    pub ids_len: usize,
    pub row_presence_mask: *const u8,
    pub row_presence_len: usize,
}

/// Rust-owned, contiguous row-major N-D tensor returned by the ND export. Free
/// with `dagmldata_nd_tensor_free`.
#[repr(C)]
#[derive(Clone, Copy, Debug)]
pub struct DagMlDataOwnedTensor {
    pub abi_version: u32,
    pub tensor_id: DagMlDataString,
    pub representation_id: DagMlDataString,
    pub container: DagMlDataString,
    pub dtype: DagMlDataTensorDType,
    pub observation_ids: DagMlDataStringArray,
    pub sample_ids: DagMlDataStringArray,
    pub shape: DagMlDataUSizeArray,
    pub data: DagMlDataU8Array,
    pub row_presence_mask: DagMlDataU8Array,
}

impl Default for DagMlDataOwnedTensor {
    fn default() -> Self {
        Self {
            abi_version: DAG_ML_DATA_OWNED_TENSOR_ABI_VERSION,
            tensor_id: DagMlDataString::default(),
            representation_id: DagMlDataString::default(),
            container: DagMlDataString::default(),
            dtype: DagMlDataTensorDType::F64,
            observation_ids: DagMlDataStringArray::default(),
            sample_ids: DagMlDataStringArray::default(),
            shape: DagMlDataUSizeArray::default(),
            data: DagMlDataU8Array::default(),
            row_presence_mask: DagMlDataU8Array::default(),
        }
    }
}

#[repr(C)]
pub struct ArrowArray {
    pub length: i64,
    pub null_count: i64,
    pub offset: i64,
    pub n_buffers: i64,
    pub n_children: i64,
    pub buffers: *mut *const c_void,
    pub children: *mut *mut ArrowArray,
    pub dictionary: *mut ArrowArray,
    pub release: Option<unsafe extern "C" fn(array: *mut ArrowArray)>,
    pub private_data: *mut c_void,
}

#[repr(C)]
pub struct ArrowSchema {
    pub format: *const c_char,
    pub name: *const c_char,
    pub metadata: *const c_char,
    pub flags: i64,
    pub n_children: i64,
    pub children: *mut *mut ArrowSchema,
    pub dictionary: *mut ArrowSchema,
    pub release: Option<unsafe extern "C" fn(schema: *mut ArrowSchema)>,
    pub private_data: *mut c_void,
}

#[repr(C)]
#[derive(Clone, Copy)]
pub struct DagMlDataVTable {
    pub abi_version: u32,
    pub user_data: *mut c_void,
    pub materialize: Option<
        unsafe extern "C" fn(
            user_data: *mut c_void,
            dataset: DagMlDataHandle,
            request_json: DagMlDataBytesView,
            out_handle: *mut DagMlDataHandle,
        ) -> DagMlDataStatusCode,
    >,
    pub make_view: Option<
        unsafe extern "C" fn(
            user_data: *mut c_void,
            dataset: DagMlDataHandle,
            selector_json: DagMlDataBytesView,
            out_view: *mut DagMlDataHandle,
        ) -> DagMlDataStatusCode,
    >,
    pub view_identity: Option<
        unsafe extern "C" fn(
            user_data: *mut c_void,
            view: DagMlDataHandle,
            out_arrow_array: *mut *mut ArrowArray,
            out_arrow_schema: *mut *mut ArrowSchema,
        ) -> DagMlDataStatusCode,
    >,
    pub target_arrow: Option<
        unsafe extern "C" fn(
            user_data: *mut c_void,
            view: DagMlDataHandle,
            target_name: DagMlDataBytesView,
            out_arrow_array: *mut *mut ArrowArray,
            out_arrow_schema: *mut *mut ArrowSchema,
        ) -> DagMlDataStatusCode,
    >,
    pub feature_arrow: Option<
        unsafe extern "C" fn(
            user_data: *mut c_void,
            view: DagMlDataHandle,
            feature_set_name: DagMlDataBytesView,
            out_arrow_array: *mut *mut ArrowArray,
            out_arrow_schema: *mut *mut ArrowSchema,
        ) -> DagMlDataStatusCode,
    >,
    pub release: Option<unsafe extern "C" fn(user_data: *mut c_void, handle: DagMlDataHandle)>,
    pub destroy: Option<unsafe extern "C" fn(user_data: *mut c_void)>,
}

#[no_mangle]
pub extern "C" fn dagmldata_version() -> DagMlDataVersion {
    DagMlDataVersion {
        major: 0,
        minor: 1,
        patch: 0,
    }
}

thread_local! {
    /// ADR-11 thread-local last-error buffer: the structured descriptor JSON and
    /// numeric error code of the most recent failing C ABI call on this thread.
    static LAST_ERROR: RefCell<Option<(String, u32)>> = const { RefCell::new(None) };
}

/// Record the descriptor JSON and numeric code of the most recent error in the
/// calling thread's last-error buffer.
fn store_last_error(payload: &str, code: u32) {
    LAST_ERROR.with(|cell| *cell.borrow_mut() = Some((payload.to_string(), code)));
}

/// Writes the structured ADR-11 descriptor JSON of the most recent failing C ABI
/// call on the calling thread into `out`.
///
/// The buffer is thread-local and persists until the next failing call on the
/// same thread. When no error has been recorded, `out` is set to an empty string
/// (`ptr` is null). Returns [`DagMlDataStatusCode::Ok`].
///
/// # Safety
///
/// `out` may be null; when non-null it must point to writable memory for one
/// `DagMlDataString`. Any returned string must be released with
/// `dagmldata_string_free`.
#[no_mangle]
pub unsafe extern "C" fn dagmldata_last_error_json(
    out: *mut DagMlDataString,
) -> DagMlDataStatusCode {
    // Clone the payload out of the borrow before writing so the writer can never
    // re-borrow LAST_ERROR. `set_string` is the pure writer (it does not touch the
    // thread-local), so reading the buffer must not overwrite it.
    let payload = LAST_ERROR.with(|cell| cell.borrow().as_ref().map(|(p, _)| p.clone()));
    clear_string(out);
    if let Some(payload) = payload {
        set_string(out, payload);
    }
    DagMlDataStatusCode::Ok
}

/// Returns the stable ADR-11 numeric error code (`(category << 16) | code`) of the
/// most recent failing C ABI call on the calling thread, or `0` when no error has
/// been recorded. The buffer is thread-local and persists until the next failing
/// call on the same thread.
#[no_mangle]
pub extern "C" fn dagmldata_last_error_code() -> u32 {
    LAST_ERROR.with(|cell| cell.borrow().as_ref().map(|(_, code)| *code).unwrap_or(0))
}

/// Releases a string allocated by DAG-ML-DATA.
///
/// # Safety
///
/// `value.ptr` must either be null or a pointer previously returned by a
/// DAG-ML-DATA C ABI function in a `DagMlDataString`. Passing any other pointer,
/// or freeing the same string twice, is undefined behavior.
#[no_mangle]
pub unsafe extern "C" fn dagmldata_string_free(value: DagMlDataString) {
    if !value.ptr.is_null() {
        drop(CString::from_raw(value.ptr));
    }
}

/// Releases a tensor allocated by DAG-ML-DATA.
///
/// # Safety
///
/// Every pointer inside `tensor` must either be null or come from a
/// DAG-ML-DATA C ABI function returning `DagMlDataTensorF64`. Passing nested
/// pointers from any other allocator, or freeing the same tensor twice, is
/// undefined behavior.
#[no_mangle]
pub unsafe extern "C" fn dagmldata_tensor_f64_free(tensor: DagMlDataTensorF64) {
    dagmldata_string_free(tensor.block_id);
    dagmldata_string_free(tensor.representation_id);
    dagmldata_string_free(tensor.batch_container);
    free_string_array(tensor.observation_ids);
    free_string_array(tensor.sample_ids);
    free_usize_array(tensor.shape);
    free_f64_array(tensor.values);
    free_u8_array(tensor.presence_mask);
    free_u8_array(tensor.validity_mask);
    free_string_array(tensor.feature_names);
}

/// Releases an f32 tensor allocated by DAG-ML-DATA.
///
/// # Safety
///
/// Every pointer inside `tensor` must either be null or come from a
/// DAG-ML-DATA C ABI function returning `DagMlDataTensorF32`. Passing nested
/// pointers from any other allocator, or freeing the same tensor twice, is
/// undefined behavior.
#[no_mangle]
pub unsafe extern "C" fn dagmldata_tensor_f32_free(tensor: DagMlDataTensorF32) {
    dagmldata_string_free(tensor.block_id);
    dagmldata_string_free(tensor.representation_id);
    dagmldata_string_free(tensor.batch_container);
    free_string_array(tensor.observation_ids);
    free_string_array(tensor.sample_ids);
    free_usize_array(tensor.shape);
    free_f32_array(tensor.values);
    free_u8_array(tensor.presence_mask);
    free_u8_array(tensor.validity_mask);
    free_string_array(tensor.feature_names);
}

/// Releases an `ArrowArray` allocated by DAG-ML-DATA.
///
/// # Safety
///
/// `array` must either be null or a pointer returned by a DAG-ML-DATA C ABI
/// function. Passing any other pointer, or freeing the same pointer twice, is
/// undefined behavior.
#[no_mangle]
pub unsafe extern "C" fn dagmldata_arrow_array_free(array: *mut ArrowArray) {
    if array.is_null() {
        return;
    }
    if let Some(release) = (*array).release {
        release(array);
    }
    drop(Box::from_raw(array));
}

/// Releases an `ArrowSchema` allocated by DAG-ML-DATA.
///
/// # Safety
///
/// `schema` must either be null or a pointer returned by a DAG-ML-DATA C ABI
/// function. Passing any other pointer, or freeing the same pointer twice, is
/// undefined behavior.
#[no_mangle]
pub unsafe extern "C" fn dagmldata_arrow_schema_free(schema: *mut ArrowSchema) {
    if schema.is_null() {
        return;
    }
    if let Some(release) = (*schema).release {
        release(schema);
    }
    drop(Box::from_raw(schema));
}

/// Computes the deterministic fingerprint of a canonical JSON `DatasetSchema`.
///
/// # Safety
///
/// When `json_ptr` is non-null it must point to `json_len` readable bytes for
/// the duration of the call. `fingerprint_out` and `error_out` may be null; when
/// non-null each must point to writable memory for one `DagMlDataString`. Any
/// returned string must be released with `dagmldata_string_free`.
#[no_mangle]
pub unsafe extern "C" fn dagmldata_schema_fingerprint_json(
    json_ptr: *const u8,
    json_len: usize,
    fingerprint_out: *mut DagMlDataString,
    error_out: *mut DagMlDataString,
) -> DagMlDataStatusCode {
    clear_string(fingerprint_out);
    clear_string(error_out);
    if json_ptr.is_null() {
        set_error_message(error_out, "json pointer is null");
        return DagMlDataStatusCode::InvalidArgument;
    }

    let json = slice::from_raw_parts(json_ptr, json_len);
    match serde_json::from_slice::<DatasetSchema>(json) {
        Ok(schema) => match schema_fingerprint(&schema) {
            Ok(fingerprint) => {
                set_string(fingerprint_out, fingerprint);
                DagMlDataStatusCode::Ok
            }
            Err(error) => {
                set_display_error(error_out, error);
                DagMlDataStatusCode::ValidationError
            }
        },
        Err(error) => {
            set_display_error(error_out, error);
            DagMlDataStatusCode::ValidationError
        }
    }
}

/// Validates a JSON fold-set payload.
///
/// The payload mirrors dag-ml's `FoldSet` JSON shape but keeps `fold_id` as an
/// opaque string so runtime labels such as `fold:0` remain ABI-compatible.
/// This standalone check validates the exhaustive fold partition shape and any
/// leakage across the fold-set's own embedded `sample_groups`; use
/// `dagmldata_fold_set_validate_against_relations_json` to additionally audit
/// leakage against an external relation table's groups and augmentation origins.
///
/// # Safety
///
/// When `json_ptr` is non-null it must point to `json_len` readable bytes for
/// the duration of the call. `error_out` may be null; when non-null it must
/// point to writable memory for one `DagMlDataString`. Returned strings must be
/// released with `dagmldata_string_free`.
#[no_mangle]
pub unsafe extern "C" fn dagmldata_fold_set_validate_json(
    json_ptr: *const u8,
    json_len: usize,
    error_out: *mut DagMlDataString,
) -> DagMlDataStatusCode {
    clear_string(error_out);
    if json_ptr.is_null() {
        set_error_message(error_out, "json pointer is null");
        return DagMlDataStatusCode::InvalidArgument;
    }

    let json = slice::from_raw_parts(json_ptr, json_len);
    match serde_json::from_slice::<FoldSet>(json) {
        Ok(fold_set) => match fold_set.validate() {
            Ok(()) => DagMlDataStatusCode::Ok,
            Err(error) => {
                set_display_error(error_out, error);
                DagMlDataStatusCode::ValidationError
            }
        },
        Err(error) => {
            set_display_error(error_out, error);
            DagMlDataStatusCode::ValidationError
        }
    }
}

/// Validates a JSON aggregation-policy payload (ADR-07).
///
/// The payload is the flat `AggregationPolicy` shape — a reducer name plus the
/// single parameter that reducer accepts, e.g.
/// `{"reducer":"robust_mean","trim_fraction":0.1}`. Unknown keys are rejected,
/// the reducer's own parameter is range-checked, and parameters belonging to a
/// different reducer are refused. This is the parameter-shape check only; the
/// task-sensitivity rule (`vote` on regression) is enforced by the host with the
/// task context it owns.
///
/// # Safety
///
/// When `json_ptr` is non-null it must point to `json_len` readable bytes for
/// the duration of the call. `error_out` may be null; when non-null it must
/// point to writable memory for one `DagMlDataString`. Returned strings must be
/// released with `dagmldata_string_free`.
#[no_mangle]
pub unsafe extern "C" fn dagmldata_aggregation_policy_validate_json(
    json_ptr: *const u8,
    json_len: usize,
    error_out: *mut DagMlDataString,
) -> DagMlDataStatusCode {
    clear_string(error_out);
    if json_ptr.is_null() {
        set_error_message(error_out, "json pointer is null");
        return DagMlDataStatusCode::InvalidArgument;
    }

    let json = slice::from_raw_parts(json_ptr, json_len);
    match serde_json::from_slice::<AggregationPolicy>(json) {
        Ok(policy) => match policy.validate() {
            Ok(()) => DagMlDataStatusCode::Ok,
            Err(error) => {
                set_display_error(error_out, error);
                DagMlDataStatusCode::ValidationError
            }
        },
        Err(error) => {
            set_display_error(error_out, error);
            DagMlDataStatusCode::ValidationError
        }
    }
}

/// Computes the deterministic fingerprint of a JSON fold-set payload.
///
/// The fingerprint canonicalizes irrelevant ordering of sample ids, fold ids
/// and train/validation sample lists after validating the fold set.
///
/// # Safety
///
/// When `json_ptr` is non-null it must point to `json_len` readable bytes for
/// the duration of the call. `fingerprint_out` and `error_out` may be null; when
/// non-null each must point to writable memory for one `DagMlDataString`. Any
/// returned string must be released with `dagmldata_string_free`.
#[no_mangle]
pub unsafe extern "C" fn dagmldata_fold_set_fingerprint_json(
    json_ptr: *const u8,
    json_len: usize,
    fingerprint_out: *mut DagMlDataString,
    error_out: *mut DagMlDataString,
) -> DagMlDataStatusCode {
    clear_string(fingerprint_out);
    clear_string(error_out);
    if json_ptr.is_null() {
        set_error_message(error_out, "json pointer is null");
        return DagMlDataStatusCode::InvalidArgument;
    }

    let json = slice::from_raw_parts(json_ptr, json_len);
    match serde_json::from_slice::<FoldSet>(json) {
        Ok(fold_set) => match fold_set_fingerprint(&fold_set) {
            Ok(fingerprint) => {
                set_string(fingerprint_out, fingerprint);
                DagMlDataStatusCode::Ok
            }
            Err(error) => {
                set_display_error(error_out, error);
                DagMlDataStatusCode::ValidationError
            }
        },
        Err(error) => {
            set_display_error(error_out, error);
            DagMlDataStatusCode::ValidationError
        }
    }
}

/// Validates a JSON fold-set payload against a JSON `SampleRelationTable`.
///
/// This is the C ABI entry point for ADR-05: all samples covered by relations
/// must be covered exactly once by validation folds, and relation group/origin
/// boundaries must not cross train/validation inside a fold.
///
/// # Safety
///
/// When non-null, `fold_set_ptr` and `relations_ptr` must point to
/// `fold_set_len` and `relations_len` readable bytes respectively for the
/// duration of the call. `error_out` may be null; when non-null it must point to
/// writable memory for one `DagMlDataString`. Returned strings must be released
/// with `dagmldata_string_free`.
#[no_mangle]
pub unsafe extern "C" fn dagmldata_fold_set_validate_against_relations_json(
    fold_set_ptr: *const u8,
    fold_set_len: usize,
    relations_ptr: *const u8,
    relations_len: usize,
    error_out: *mut DagMlDataString,
) -> DagMlDataStatusCode {
    clear_string(error_out);
    if fold_set_ptr.is_null() {
        set_error_message(error_out, "fold set json pointer is null");
        return DagMlDataStatusCode::InvalidArgument;
    }
    if relations_ptr.is_null() {
        set_error_message(error_out, "sample relations json pointer is null");
        return DagMlDataStatusCode::InvalidArgument;
    }

    let fold_set_json = slice::from_raw_parts(fold_set_ptr, fold_set_len);
    let relations_json = slice::from_raw_parts(relations_ptr, relations_len);
    let fold_set = match serde_json::from_slice::<FoldSet>(fold_set_json) {
        Ok(fold_set) => fold_set,
        Err(error) => {
            set_display_error(error_out, error);
            return DagMlDataStatusCode::ValidationError;
        }
    };
    let relations = match serde_json::from_slice::<SampleRelationTable>(relations_json) {
        Ok(relations) => relations,
        Err(error) => {
            set_display_error(error_out, error);
            return DagMlDataStatusCode::ValidationError;
        }
    };
    match relations.validate_fold_set(&fold_set) {
        Ok(()) => DagMlDataStatusCode::Ok,
        Err(error) => {
            set_display_error(error_out, error);
            DagMlDataStatusCode::ValidationError
        }
    }
}

/// Opaque handle to a Rust-owned in-memory fitted-adapter store. Callers
/// receive this from `dagmldata_inmemory_fitted_adapter_store_new` and must
/// eventually release it with `dagmldata_inmemory_fitted_adapter_store_destroy`.
///
/// The underlying Rust store is internally synchronized with a
/// `std::sync::Mutex`, so the same handle value can be shared across host
/// threads and concurrent `register`/`materialize`/`release` calls serialize
/// safely instead of racing. `destroy` is the only operation that must be
/// externally synchronized: no other call on the handle may overlap with
/// `destroy`.
#[repr(C)]
#[derive(Clone, Copy, Debug)]
pub struct DagMlDataFittedAdapterStoreHandle {
    pub ptr: *mut c_void,
}

impl Default for DagMlDataFittedAdapterStoreHandle {
    fn default() -> Self {
        Self {
            ptr: std::ptr::null_mut(),
        }
    }
}

/// Creates a Rust-owned in-memory fitted-adapter store. The returned handle
/// must be released with `dagmldata_inmemory_fitted_adapter_store_destroy`.
///
/// # Safety
///
/// `out_store` must point to writable memory for one
/// `DagMlDataFittedAdapterStoreHandle`.
#[no_mangle]
pub unsafe extern "C" fn dagmldata_inmemory_fitted_adapter_store_new(
    out_store: *mut DagMlDataFittedAdapterStoreHandle,
) -> DagMlDataStatusCode {
    if out_store.is_null() {
        record_arg_error("fitted-adapter store out pointer is null");
        return DagMlDataStatusCode::InvalidArgument;
    }
    let store = Box::new(InMemoryFittedAdapterStore::new());
    *out_store = DagMlDataFittedAdapterStoreHandle {
        ptr: Box::into_raw(store).cast::<c_void>(),
    };
    DagMlDataStatusCode::Ok
}

/// Destroys a fitted-adapter store handle previously returned by
/// `dagmldata_inmemory_fitted_adapter_store_new`.
///
/// # Safety
///
/// `store.ptr` must either be null or point to a store handle returned by
/// `dagmldata_inmemory_fitted_adapter_store_new` and not already destroyed.
#[no_mangle]
pub unsafe extern "C" fn dagmldata_inmemory_fitted_adapter_store_destroy(
    store: DagMlDataFittedAdapterStoreHandle,
) {
    if !store.ptr.is_null() {
        drop(Box::from_raw(
            store.ptr.cast::<InMemoryFittedAdapterStore>(),
        ));
    }
}

/// Registers a JSON `FittedAdapterRef` in the store. On success writes the
/// allocated u64 handle to `out_handle`. Returns `ValidationError` if the ref
/// fails validation or if an adapter with the same `adapter_id` is already
/// registered.
///
/// # Safety
///
/// `store.ptr` must point to a live store handle. `json_ptr` must point to
/// `json_len` readable bytes. `out_handle` and `error_out` may be null; any
/// returned error string must be released with `dagmldata_string_free`.
#[no_mangle]
pub unsafe extern "C" fn dagmldata_inmemory_fitted_adapter_store_register_json(
    store: DagMlDataFittedAdapterStoreHandle,
    json_ptr: *const u8,
    json_len: usize,
    out_handle: *mut u64,
    error_out: *mut DagMlDataString,
) -> DagMlDataStatusCode {
    clear_string(error_out);
    if store.ptr.is_null() || json_ptr.is_null() {
        set_error_message(error_out, "store or json pointer is null");
        return DagMlDataStatusCode::InvalidArgument;
    }
    let store_ref = &*store.ptr.cast::<InMemoryFittedAdapterStore>();
    let json = slice::from_raw_parts(json_ptr, json_len);
    let value: FittedAdapterRef = match serde_json::from_slice(json) {
        Ok(value) => value,
        Err(error) => {
            set_display_error(error_out, error);
            return DagMlDataStatusCode::ValidationError;
        }
    };
    match store_ref.register(value) {
        Ok(record) => {
            if !out_handle.is_null() {
                *out_handle = record.handle;
            }
            DagMlDataStatusCode::Ok
        }
        Err(error) => {
            set_display_error(error_out, error);
            DagMlDataStatusCode::ValidationError
        }
    }
}

/// Materializes an opaque handle for a previously registered fitted adapter
/// from a JSON `FittedAdapterMaterializationRequest`. Writes the handle id to
/// `out_handle` on success. Returns `ValidationError` if the request fails
/// validation, the adapter is missing, or the request's `params_fingerprint`
/// does not match the registered ref's fingerprint.
///
/// # Safety
///
/// Same pointer ownership rules as
/// `dagmldata_inmemory_fitted_adapter_store_register_json`.
#[no_mangle]
pub unsafe extern "C" fn dagmldata_inmemory_fitted_adapter_store_materialize_json(
    store: DagMlDataFittedAdapterStoreHandle,
    json_ptr: *const u8,
    json_len: usize,
    out_handle: *mut u64,
    error_out: *mut DagMlDataString,
) -> DagMlDataStatusCode {
    clear_string(error_out);
    if store.ptr.is_null() || json_ptr.is_null() {
        set_error_message(error_out, "store or json pointer is null");
        return DagMlDataStatusCode::InvalidArgument;
    }
    let store_ref = &*store.ptr.cast::<InMemoryFittedAdapterStore>();
    let json = slice::from_raw_parts(json_ptr, json_len);
    let request: FittedAdapterMaterializationRequest = match serde_json::from_slice(json) {
        Ok(request) => request,
        Err(error) => {
            set_display_error(error_out, error);
            return DagMlDataStatusCode::ValidationError;
        }
    };
    match store_ref.materialize(&request) {
        Ok(handle) => {
            if !out_handle.is_null() {
                *out_handle = handle;
            }
            DagMlDataStatusCode::Ok
        }
        Err(error) => {
            set_display_error(error_out, error);
            DagMlDataStatusCode::ValidationError
        }
    }
}

/// Releases a registered fitted-adapter handle by `adapter_id`. Returns
/// `Ok` whether the adapter existed or not; callers can inspect
/// `out_released` (non-zero if a record was removed) when non-null.
///
/// # Safety
///
/// `store.ptr` must point to a live store handle. `adapter_id` must point to
/// `adapter_id_len` UTF-8 bytes for the duration of the call. `out_released`
/// may be null.
#[no_mangle]
pub unsafe extern "C" fn dagmldata_inmemory_fitted_adapter_store_release(
    store: DagMlDataFittedAdapterStoreHandle,
    adapter_id: *const u8,
    adapter_id_len: usize,
    out_released: *mut u8,
) -> DagMlDataStatusCode {
    if store.ptr.is_null() || adapter_id.is_null() {
        record_arg_error("fitted-adapter store or adapter_id pointer is null");
        return DagMlDataStatusCode::InvalidArgument;
    }
    let store_ref = &*store.ptr.cast::<InMemoryFittedAdapterStore>();
    let adapter_id_bytes = slice::from_raw_parts(adapter_id, adapter_id_len);
    let adapter_id_str = match std::str::from_utf8(adapter_id_bytes) {
        Ok(value) => value,
        Err(_) => {
            record_arg_error("adapter_id is not valid UTF-8");
            return DagMlDataStatusCode::InvalidArgument;
        }
    };
    let released = store_ref.release(adapter_id_str);
    if !out_released.is_null() {
        *out_released = u8::from(released);
    }
    DagMlDataStatusCode::Ok
}

/// Attaches a fitted-adapter store handle to a Rust-owned in-memory provider
/// vtable so the provider's controllers can materialize fitted-adapter
/// handles through the same lifecycle as the data/view handles. The provider
/// holds a borrowed pointer to the store; the host must keep the store alive
/// while it stays attached and must clear the attachment (by attaching a
/// null handle) before calling `dagmldata_inmemory_fitted_adapter_store_destroy`
/// on the store. Passing `store.ptr == null` detaches any previously
/// attached store without freeing it.
///
/// # Safety
///
/// `vtable` must point to a live `DagMlDataVTable` returned by one of the
/// `dagmldata_inmemory_provider_new*` constructors. `store.ptr` must either
/// be null or a live store handle returned by
/// `dagmldata_inmemory_fitted_adapter_store_new`.
#[no_mangle]
pub unsafe extern "C" fn dagmldata_inmemory_provider_attach_fitted_adapter_store(
    vtable: *const DagMlDataVTable,
    store: DagMlDataFittedAdapterStoreHandle,
    error_out: *mut DagMlDataString,
) -> DagMlDataStatusCode {
    clear_string(error_out);
    if vtable.is_null() || (*vtable).user_data.is_null() {
        set_error_message(error_out, "provider vtable or user_data is null");
        return DagMlDataStatusCode::InvalidArgument;
    }
    let state = &*((*vtable).user_data.cast::<InMemoryProviderState>());
    let store_ptr = if store.ptr.is_null() {
        std::ptr::null()
    } else {
        store.ptr.cast::<InMemoryFittedAdapterStore>() as *const _
    };
    match state.fitted_adapter_store.lock() {
        Ok(mut slot) => {
            *slot = store_ptr;
            DagMlDataStatusCode::Ok
        }
        Err(error) => {
            set_error_message(
                error_out,
                format!("provider fitted-adapter mutex poisoned: {error}"),
            );
            DagMlDataStatusCode::ValidationError
        }
    }
}

/// Materializes a fitted-adapter handle through the provider's attached
/// store. Returns `InvalidArgument` if no fitted-adapter store is attached,
/// `ValidationError` if the request fails, otherwise writes the opaque u64
/// handle to `out_handle` and returns `Ok`.
///
/// # Safety
///
/// `vtable` must point to a live provider vtable. `json_ptr` must point to
/// `json_len` readable bytes encoding a `FittedAdapterMaterializationRequest`.
/// `out_handle` and `error_out` may be null; returned error strings must be
/// released with `dagmldata_string_free`.
#[no_mangle]
pub unsafe extern "C" fn dagmldata_inmemory_provider_materialize_fitted_adapter_json(
    vtable: *const DagMlDataVTable,
    json_ptr: *const u8,
    json_len: usize,
    out_handle: *mut u64,
    error_out: *mut DagMlDataString,
) -> DagMlDataStatusCode {
    clear_string(error_out);
    if vtable.is_null() || (*vtable).user_data.is_null() || json_ptr.is_null() {
        set_error_message(
            error_out,
            "provider vtable, user_data or json pointer is null",
        );
        return DagMlDataStatusCode::InvalidArgument;
    }
    let state = &*((*vtable).user_data.cast::<InMemoryProviderState>());
    // Hold the store guard across the dereference and `materialize` so a
    // concurrent attach(null)/detach cannot pull the borrowed store pointer out
    // from under us (which, combined with the host destroying the store, would
    // be a use-after-free). Detach blocks until any in-flight materialize ends.
    let store_guard = match state.fitted_adapter_store.lock() {
        Ok(guard) => guard,
        Err(error) => {
            set_error_message(
                error_out,
                format!("provider fitted-adapter mutex poisoned: {error}"),
            );
            return DagMlDataStatusCode::ValidationError;
        }
    };
    if store_guard.is_null() {
        set_error_message(
            error_out,
            "provider has no fitted-adapter store attached; \
             call dagmldata_inmemory_provider_attach_fitted_adapter_store first",
        );
        return DagMlDataStatusCode::InvalidArgument;
    }
    let store = &**store_guard;
    let json = slice::from_raw_parts(json_ptr, json_len);
    let request: FittedAdapterMaterializationRequest = match serde_json::from_slice(json) {
        Ok(request) => request,
        Err(error) => {
            set_display_error(error_out, error);
            return DagMlDataStatusCode::ValidationError;
        }
    };
    match store.materialize(&request) {
        Ok(handle) => {
            if !out_handle.is_null() {
                *out_handle = handle;
            }
            DagMlDataStatusCode::Ok
        }
        Err(error) => {
            set_display_error(error_out, error);
            DagMlDataStatusCode::ValidationError
        }
    }
}

/// Validates a JSON `FittedAdapterRef` payload against the published v1
/// contract (`fitted_adapter_ref.v1`). Returns `Ok` if the payload parses,
/// passes shape validation and either inline or portable validation as
/// requested; otherwise returns `ValidationError` and writes an error string.
///
/// When `require_portable` is non-zero, the ref must also carry backend, safe
/// relative URI and content fingerprint (matching `validate_portable`).
///
/// # Safety
///
/// When `json_ptr` is non-null it must point to `json_len` readable bytes for
/// the duration of the call. `error_out` may be null; when non-null it must
/// point to writable memory for one `DagMlDataString`. Returned strings must
/// be released with `dagmldata_string_free`.
#[no_mangle]
pub unsafe extern "C" fn dagmldata_fitted_adapter_ref_validate_json(
    json_ptr: *const u8,
    json_len: usize,
    require_portable: u8,
    error_out: *mut DagMlDataString,
) -> DagMlDataStatusCode {
    clear_string(error_out);
    if json_ptr.is_null() {
        set_error_message(error_out, "json pointer is null");
        return DagMlDataStatusCode::InvalidArgument;
    }
    let json = slice::from_raw_parts(json_ptr, json_len);
    let value: FittedAdapterRef = match serde_json::from_slice(json) {
        Ok(value) => value,
        Err(error) => {
            set_display_error(error_out, error);
            return DagMlDataStatusCode::ValidationError;
        }
    };
    let result = if require_portable != 0 {
        value.validate_portable()
    } else {
        value.validate()
    };
    match result {
        Ok(()) => DagMlDataStatusCode::Ok,
        Err(error) => {
            set_display_error(error_out, error);
            DagMlDataStatusCode::ValidationError
        }
    }
}

/// Validates a JSON `FittedAdapterManifest` payload against the published v1
/// contract. Same `require_portable` semantics as
/// `dagmldata_fitted_adapter_ref_validate_json`, applied to every manifest
/// entry; the manifest enforces unique adapter ids and key-vs-ref consistency.
///
/// # Safety
///
/// Same pointer ownership rules as `dagmldata_fitted_adapter_ref_validate_json`.
#[no_mangle]
pub unsafe extern "C" fn dagmldata_fitted_adapter_manifest_validate_json(
    json_ptr: *const u8,
    json_len: usize,
    require_portable: u8,
    error_out: *mut DagMlDataString,
) -> DagMlDataStatusCode {
    clear_string(error_out);
    if json_ptr.is_null() {
        set_error_message(error_out, "json pointer is null");
        return DagMlDataStatusCode::InvalidArgument;
    }
    let json = slice::from_raw_parts(json_ptr, json_len);
    let manifest: FittedAdapterManifest = match serde_json::from_slice(json) {
        Ok(manifest) => manifest,
        Err(error) => {
            set_display_error(error_out, error);
            return DagMlDataStatusCode::ValidationError;
        }
    };
    let result = if require_portable != 0 {
        manifest.validate_portable()
    } else {
        manifest.validate()
    };
    match result {
        Ok(()) => DagMlDataStatusCode::Ok,
        Err(error) => {
            set_display_error(error_out, error);
            DagMlDataStatusCode::ValidationError
        }
    }
}

/// Builds an Arrow C Data identity table from a coordinator data-plan envelope.
///
/// The returned table has one row per coordinator relation and these columns:
/// `observation_id`, `sample_id`, `target_id`, `group_id`,
/// `origin_sample_id`, `source_id`, `is_augmented`.
///
/// # Safety
///
/// When `json_ptr` is non-null it must point to `json_len` readable bytes for
/// the duration of the call. `out_arrow_array`, `out_arrow_schema` and
/// `error_out` may be null. Returned Arrow pointers must be released with
/// `dagmldata_arrow_array_free` and `dagmldata_arrow_schema_free`.
#[no_mangle]
pub unsafe extern "C" fn dagmldata_coordinator_identity_arrow_json(
    json_ptr: *const u8,
    json_len: usize,
    out_arrow_array: *mut *mut ArrowArray,
    out_arrow_schema: *mut *mut ArrowSchema,
    error_out: *mut DagMlDataString,
) -> DagMlDataStatusCode {
    clear_arrow_array(out_arrow_array);
    clear_arrow_schema(out_arrow_schema);
    clear_string(error_out);
    if json_ptr.is_null() {
        set_error_message(error_out, "json pointer is null");
        return DagMlDataStatusCode::InvalidArgument;
    }
    if out_arrow_array.is_null() || out_arrow_schema.is_null() {
        set_error_message(error_out, "arrow output pointer is null");
        return DagMlDataStatusCode::InvalidArgument;
    }

    let json = slice::from_raw_parts(json_ptr, json_len);
    match serde_json::from_slice::<CoordinatorDataPlanEnvelope>(json) {
        Ok(envelope) => match build_identity_arrow(&envelope) {
            Ok((array, schema)) => {
                *out_arrow_array = Box::into_raw(Box::new(array));
                *out_arrow_schema = Box::into_raw(Box::new(schema));
                DagMlDataStatusCode::Ok
            }
            Err(error) => {
                set_display_error(error_out, error);
                DagMlDataStatusCode::ValidationError
            }
        },
        Err(error) => {
            set_display_error(error_out, error);
            DagMlDataStatusCode::ValidationError
        }
    }
}

/// Builds an Arrow C Data target table from a coordinator envelope, data view
/// and sample-level target table.
///
/// The request JSON shape is `{ envelope, materialization_request, view,
/// target_table, owner_controller? }`. The returned table has `sample_id`,
/// `target_id` and numeric `value` columns. Repeated observations in the view
/// are de-duplicated to one target row per sample.
///
/// # Safety
///
/// When `json_ptr` is non-null it must point to `json_len` readable bytes for
/// the duration of the call. `out_arrow_array`, `out_arrow_schema` and
/// `error_out` may be null. Returned Arrow pointers must be released with
/// `dagmldata_arrow_array_free` and `dagmldata_arrow_schema_free`.
#[no_mangle]
pub unsafe extern "C" fn dagmldata_coordinator_target_arrow_json(
    json_ptr: *const u8,
    json_len: usize,
    out_arrow_array: *mut *mut ArrowArray,
    out_arrow_schema: *mut *mut ArrowSchema,
    error_out: *mut DagMlDataString,
) -> DagMlDataStatusCode {
    clear_arrow_array(out_arrow_array);
    clear_arrow_schema(out_arrow_schema);
    clear_string(error_out);
    if json_ptr.is_null() {
        set_error_message(error_out, "json pointer is null");
        return DagMlDataStatusCode::InvalidArgument;
    }
    if out_arrow_array.is_null() || out_arrow_schema.is_null() {
        set_error_message(error_out, "arrow output pointer is null");
        return DagMlDataStatusCode::InvalidArgument;
    }

    let json = slice::from_raw_parts(json_ptr, json_len);
    match serde_json::from_slice::<CoordinatorTargetArrowRequest>(json) {
        Ok(request) => {
            match build_target_block(&request).and_then(|block| build_target_arrow(&block)) {
                Ok((array, schema)) => {
                    *out_arrow_array = Box::into_raw(Box::new(array));
                    *out_arrow_schema = Box::into_raw(Box::new(schema));
                    DagMlDataStatusCode::Ok
                }
                Err(error) => {
                    set_display_error(error_out, error);
                    DagMlDataStatusCode::ValidationError
                }
            }
        }
        Err(error) => {
            set_display_error(error_out, error);
            DagMlDataStatusCode::ValidationError
        }
    }
}

/// Builds an Arrow C Data multi-target table from a coordinator envelope, data
/// view and target tables.
///
/// The request JSON shape is `{ envelope, materialization_request, view,
/// target_tables, owner_controller? }`. The returned table has `sample_id`
/// plus one nullable f64 column per `target_id`, preserving the view's
/// requested sample order and encoding missing/null target values in each
/// target column's validity bitmap.
///
/// # Safety
///
/// When `json_ptr` is non-null it must point to `json_len` readable bytes for
/// the duration of the call. `out_arrow_array`, `out_arrow_schema` and
/// `error_out` may be null. Returned Arrow pointers must be released with
/// `dagmldata_arrow_array_free` and `dagmldata_arrow_schema_free`.
#[no_mangle]
pub unsafe extern "C" fn dagmldata_coordinator_multi_target_arrow_json(
    json_ptr: *const u8,
    json_len: usize,
    out_arrow_array: *mut *mut ArrowArray,
    out_arrow_schema: *mut *mut ArrowSchema,
    error_out: *mut DagMlDataString,
) -> DagMlDataStatusCode {
    clear_arrow_array(out_arrow_array);
    clear_arrow_schema(out_arrow_schema);
    clear_string(error_out);
    if json_ptr.is_null() {
        set_error_message(error_out, "json pointer is null");
        return DagMlDataStatusCode::InvalidArgument;
    }
    if out_arrow_array.is_null() || out_arrow_schema.is_null() {
        set_error_message(error_out, "arrow output pointer is null");
        return DagMlDataStatusCode::InvalidArgument;
    }

    let json = slice::from_raw_parts(json_ptr, json_len);
    match serde_json::from_slice::<CoordinatorMultiTargetArrowRequest>(json) {
        Ok(request) => match build_multi_target_block(&request)
            .and_then(|block| build_multi_target_arrow(&block))
        {
            Ok((array, schema)) => {
                *out_arrow_array = Box::into_raw(Box::new(array));
                *out_arrow_schema = Box::into_raw(Box::new(schema));
                DagMlDataStatusCode::Ok
            }
            Err(error) => {
                set_display_error(error_out, error);
                DagMlDataStatusCode::ValidationError
            }
        },
        Err(error) => {
            set_display_error(error_out, error);
            DagMlDataStatusCode::ValidationError
        }
    }
}

/// Builds an Arrow C Data feature table from a coordinator envelope, data view
/// and observation-level feature table.
///
/// The request JSON shape is `{ envelope, materialization_request, view,
/// feature_table, owner_controller? }`. The returned table has
/// `observation_id`, `sample_id` and one numeric column per selected feature.
/// Repeated observations are preserved; `DataView.columns` filters feature
/// columns without changing row identity.
///
/// # Safety
///
/// When `json_ptr` is non-null it must point to `json_len` readable bytes for
/// the duration of the call. `out_arrow_array`, `out_arrow_schema` and
/// `error_out` may be null. Returned Arrow pointers must be released with
/// `dagmldata_arrow_array_free` and `dagmldata_arrow_schema_free`.
#[no_mangle]
pub unsafe extern "C" fn dagmldata_coordinator_feature_arrow_json(
    json_ptr: *const u8,
    json_len: usize,
    out_arrow_array: *mut *mut ArrowArray,
    out_arrow_schema: *mut *mut ArrowSchema,
    error_out: *mut DagMlDataString,
) -> DagMlDataStatusCode {
    clear_arrow_array(out_arrow_array);
    clear_arrow_schema(out_arrow_schema);
    clear_string(error_out);
    if json_ptr.is_null() {
        set_error_message(error_out, "json pointer is null");
        return DagMlDataStatusCode::InvalidArgument;
    }
    if out_arrow_array.is_null() || out_arrow_schema.is_null() {
        set_error_message(error_out, "arrow output pointer is null");
        return DagMlDataStatusCode::InvalidArgument;
    }

    let json = slice::from_raw_parts(json_ptr, json_len);
    match serde_json::from_slice::<CoordinatorFeatureArrowRequest>(json) {
        Ok(request) => {
            match build_feature_block(&request).and_then(|block| build_feature_arrow(&block)) {
                Ok((array, schema)) => {
                    *out_arrow_array = Box::into_raw(Box::new(array));
                    *out_arrow_schema = Box::into_raw(Box::new(schema));
                    DagMlDataStatusCode::Ok
                }
                Err(error) => {
                    set_display_error(error_out, error);
                    DagMlDataStatusCode::ValidationError
                }
            }
        }
        Err(error) => {
            set_display_error(error_out, error);
            DagMlDataStatusCode::ValidationError
        }
    }
}

/// Builds an Arrow C Data fused feature table from already materialized
/// coordinator feature blocks.
///
/// The request JSON shape is `{ feature_set_id, sources, alignment, policy? }`,
/// where `sources` is a list of `{ source_id, block }`. The returned table has
/// `observation_id`, `sample_id` and one numeric column per fused feature.
/// Reference-source repetitions are preserved; singleton non-reference rows are
/// broadcast; ambiguous repeated non-reference rows are rejected.
///
/// # Safety
///
/// When `json_ptr` is non-null it must point to `json_len` readable bytes for
/// the duration of the call. `out_arrow_array`, `out_arrow_schema` and
/// `error_out` may be null. Returned Arrow pointers must be released with
/// `dagmldata_arrow_array_free` and `dagmldata_arrow_schema_free`.
#[no_mangle]
pub unsafe extern "C" fn dagmldata_coordinator_feature_fusion_arrow_json(
    json_ptr: *const u8,
    json_len: usize,
    out_arrow_array: *mut *mut ArrowArray,
    out_arrow_schema: *mut *mut ArrowSchema,
    error_out: *mut DagMlDataString,
) -> DagMlDataStatusCode {
    clear_arrow_array(out_arrow_array);
    clear_arrow_schema(out_arrow_schema);
    clear_string(error_out);
    if json_ptr.is_null() {
        set_error_message(error_out, "json pointer is null");
        return DagMlDataStatusCode::InvalidArgument;
    }
    if out_arrow_array.is_null() || out_arrow_schema.is_null() {
        set_error_message(error_out, "arrow output pointer is null");
        return DagMlDataStatusCode::InvalidArgument;
    }

    let json = slice::from_raw_parts(json_ptr, json_len);
    match serde_json::from_slice::<CoordinatorFeatureFusionArrowRequest>(json) {
        Ok(request) => {
            let result = request
                .source_layout
                .as_ref()
                .map(|layout| {
                    layout.validate_for_source_blocks(&request.feature_set_id, &request.sources)
                })
                .transpose()
                .and_then(|_| {
                    fuse_feature_blocks(
                        request.feature_set_id,
                        &request.sources,
                        &request.alignment,
                        &request.policy,
                    )
                })
                .and_then(|block| build_feature_arrow(&block));

            match result {
                Ok((array, schema)) => {
                    *out_arrow_array = Box::into_raw(Box::new(array));
                    *out_arrow_schema = Box::into_raw(Box::new(schema));
                    DagMlDataStatusCode::Ok
                }
                Err(error) => {
                    set_display_error(error_out, error);
                    DagMlDataStatusCode::ValidationError
                }
            }
        }
        Err(error) => {
            set_display_error(error_out, error);
            DagMlDataStatusCode::ValidationError
        }
    }
}

/// Builds a JSON row-major tensor from a coordinator feature block.
///
/// The request JSON shape is `{ feature_block, policy? }`. The output JSON is a
/// `NumericTensorBlock`: it preserves observation/sample identity and emits
/// deterministic shape, values, optional presence mask and optional validity
/// mask.
///
/// # Safety
///
/// When `json_ptr` is non-null it must point to `json_len` readable bytes for
/// the duration of the call. `out_json` and `error_out` may be null. Any
/// returned string must be released with `dagmldata_string_free`.
#[no_mangle]
pub unsafe extern "C" fn dagmldata_coordinator_feature_collation_json(
    json_ptr: *const u8,
    json_len: usize,
    out_json: *mut DagMlDataString,
    error_out: *mut DagMlDataString,
) -> DagMlDataStatusCode {
    clear_string(out_json);
    clear_string(error_out);
    if json_ptr.is_null() {
        set_error_message(error_out, "json pointer is null");
        return DagMlDataStatusCode::InvalidArgument;
    }

    let json = slice::from_raw_parts(json_ptr, json_len);
    match serde_json::from_slice::<CoordinatorFeatureCollationJsonRequest>(json) {
        Ok(request) => {
            match collate_feature_block(&request.feature_block, &request.policy)
                .and_then(|tensor| serde_json::to_string(&tensor).map_err(Into::into))
            {
                Ok(tensor_json) => {
                    set_string(out_json, tensor_json);
                    DagMlDataStatusCode::Ok
                }
                Err(error) => {
                    set_display_error(error_out, error);
                    DagMlDataStatusCode::ValidationError
                }
            }
        }
        Err(error) => {
            set_display_error(error_out, error);
            DagMlDataStatusCode::ValidationError
        }
    }
}

/// Builds an owned row-major f64 tensor from a coordinator feature block.
///
/// The request JSON shape is `{ feature_block, policy? }`. The returned tensor
/// owns contiguous f64 values, shape, identity arrays and optional masks. It
/// must be released with `dagmldata_tensor_f64_free`.
///
/// # Safety
///
/// When `json_ptr` is non-null it must point to `json_len` readable bytes for
/// the duration of the call. `out_tensor` must point to writable memory for one
/// `DagMlDataTensorF64`. `error_out` may be null.
#[no_mangle]
pub unsafe extern "C" fn dagmldata_coordinator_feature_collation_tensor_f64_json(
    json_ptr: *const u8,
    json_len: usize,
    out_tensor: *mut DagMlDataTensorF64,
    error_out: *mut DagMlDataString,
) -> DagMlDataStatusCode {
    clear_tensor(out_tensor);
    clear_string(error_out);
    if json_ptr.is_null() {
        set_error_message(error_out, "json pointer is null");
        return DagMlDataStatusCode::InvalidArgument;
    }
    if out_tensor.is_null() {
        set_error_message(error_out, "tensor output pointer is null");
        return DagMlDataStatusCode::InvalidArgument;
    }

    let json = slice::from_raw_parts(json_ptr, json_len);
    match serde_json::from_slice::<CoordinatorFeatureCollationJsonRequest>(json) {
        Ok(request) => match collate_feature_block(&request.feature_block, &request.policy) {
            Ok(tensor) => {
                *out_tensor = tensor_to_c(tensor);
                DagMlDataStatusCode::Ok
            }
            Err(error) => {
                set_display_error(error_out, error);
                DagMlDataStatusCode::ValidationError
            }
        },
        Err(error) => {
            set_display_error(error_out, error);
            DagMlDataStatusCode::ValidationError
        }
    }
}

/// Builds an owned row-major f32 tensor from a coordinator feature block.
///
/// The request JSON shape is `{ feature_block, policy? }`, identical to the
/// f64 entry point. The collation kernel still operates on f64 to preserve the
/// canonical numeric semantics; each value is cast to f32 at the ABI boundary
/// and the call is rejected with `ValidationError` if any padded value, finite
/// input or padding fallback does not round-trip into a finite f32 (overflow
/// to infinity, or non-finite input). The returned tensor must be released
/// with `dagmldata_tensor_f32_free`.
///
/// # Safety
///
/// When `json_ptr` is non-null it must point to `json_len` readable bytes for
/// the duration of the call. `out_tensor` must point to writable memory for one
/// `DagMlDataTensorF32`. `error_out` may be null.
#[no_mangle]
pub unsafe extern "C" fn dagmldata_coordinator_feature_collation_tensor_f32_json(
    json_ptr: *const u8,
    json_len: usize,
    out_tensor: *mut DagMlDataTensorF32,
    error_out: *mut DagMlDataString,
) -> DagMlDataStatusCode {
    clear_tensor_f32(out_tensor);
    clear_string(error_out);
    if json_ptr.is_null() {
        set_error_message(error_out, "json pointer is null");
        return DagMlDataStatusCode::InvalidArgument;
    }
    if out_tensor.is_null() {
        set_error_message(error_out, "tensor output pointer is null");
        return DagMlDataStatusCode::InvalidArgument;
    }

    let json = slice::from_raw_parts(json_ptr, json_len);
    match serde_json::from_slice::<CoordinatorFeatureCollationJsonRequest>(json) {
        Ok(request) => match collate_feature_block(&request.feature_block, &request.policy)
            .and_then(tensor_to_c_f32)
        {
            Ok(tensor) => {
                *out_tensor = tensor;
                DagMlDataStatusCode::Ok
            }
            Err(error) => {
                set_display_error(error_out, error);
                DagMlDataStatusCode::ValidationError
            }
        },
        Err(error) => {
            set_display_error(error_out, error);
            DagMlDataStatusCode::ValidationError
        }
    }
}

/// Creates a Rust-owned in-memory provider and returns its C ABI vtable.
///
/// `envelope_ptr/envelope_len` must encode a `CoordinatorDataPlanEnvelope`.
/// `target_tables_ptr/target_tables_len` may be null/zero, or a JSON array of
/// `CoordinatorTargetTable` values. The caller owns the returned vtable value
/// but must eventually call either `vtable.destroy(vtable.user_data)` or
/// `dagmldata_inmemory_provider_destroy(&vtable)`.
///
/// # Safety
///
/// Non-null byte pointers must point to readable memory for the duration of the
/// call. `out_vtable` may be null only if the caller is probing error handling.
#[no_mangle]
pub unsafe extern "C" fn dagmldata_inmemory_provider_new_json(
    envelope_ptr: *const u8,
    envelope_len: usize,
    target_tables_ptr: *const u8,
    target_tables_len: usize,
    out_vtable: *mut DagMlDataVTable,
    error_out: *mut DagMlDataString,
) -> DagMlDataStatusCode {
    clear_vtable(out_vtable);
    clear_string(error_out);
    if envelope_ptr.is_null() {
        set_error_message(error_out, "envelope pointer is null");
        return DagMlDataStatusCode::InvalidArgument;
    }
    if out_vtable.is_null() {
        set_error_message(error_out, "vtable output pointer is null");
        return DagMlDataStatusCode::InvalidArgument;
    }

    let envelope_json = slice::from_raw_parts(envelope_ptr, envelope_len);
    let envelope = match serde_json::from_slice::<CoordinatorDataPlanEnvelope>(envelope_json) {
        Ok(envelope) => envelope,
        Err(error) => {
            set_display_error(error_out, error);
            return DagMlDataStatusCode::ValidationError;
        }
    };
    let target_tables = match parse_target_tables(target_tables_ptr, target_tables_len, error_out) {
        Ok(target_tables) => target_tables,
        Err(status) => return status,
    };
    match InMemoryProviderState::new(
        envelope,
        target_tables,
        NumericFeatureBufferStore::default(),
    ) {
        Ok(provider) => {
            *out_vtable = provider_vtable(Box::into_raw(Box::new(provider)).cast::<c_void>());
            DagMlDataStatusCode::Ok
        }
        Err(error) => {
            set_display_error(error_out, error);
            DagMlDataStatusCode::ValidationError
        }
    }
}

/// Creates a Rust-owned in-memory provider with target and feature tables.
///
/// `feature_tables_ptr/feature_tables_len` may be null/zero, or a JSON array of
/// `CoordinatorFeatureTable` values. This is the current conformance helper for
/// binding tests that need real observation-level feature data.
///
/// # Safety
///
/// Non-null byte pointers must point to readable memory for the duration of the
/// call. `out_vtable` may be null only if the caller is probing error handling.
#[no_mangle]
pub unsafe extern "C" fn dagmldata_inmemory_provider_new_with_features_json(
    envelope_ptr: *const u8,
    envelope_len: usize,
    target_tables_ptr: *const u8,
    target_tables_len: usize,
    feature_tables_ptr: *const u8,
    feature_tables_len: usize,
    out_vtable: *mut DagMlDataVTable,
    error_out: *mut DagMlDataString,
) -> DagMlDataStatusCode {
    clear_vtable(out_vtable);
    clear_string(error_out);
    if envelope_ptr.is_null() {
        set_error_message(error_out, "envelope pointer is null");
        return DagMlDataStatusCode::InvalidArgument;
    }
    if out_vtable.is_null() {
        set_error_message(error_out, "vtable output pointer is null");
        return DagMlDataStatusCode::InvalidArgument;
    }

    let envelope_json = slice::from_raw_parts(envelope_ptr, envelope_len);
    let envelope = match serde_json::from_slice::<CoordinatorDataPlanEnvelope>(envelope_json) {
        Ok(envelope) => envelope,
        Err(error) => {
            set_display_error(error_out, error);
            return DagMlDataStatusCode::ValidationError;
        }
    };
    let target_tables = match parse_target_tables(target_tables_ptr, target_tables_len, error_out) {
        Ok(target_tables) => target_tables,
        Err(status) => return status,
    };
    let feature_tables =
        match parse_feature_tables(feature_tables_ptr, feature_tables_len, error_out) {
            Ok(feature_tables) => feature_tables,
            Err(status) => return status,
        };
    match InMemoryProviderState::new(envelope, target_tables, feature_tables) {
        Ok(provider) => {
            *out_vtable = provider_vtable(Box::into_raw(Box::new(provider)).cast::<c_void>());
            DagMlDataStatusCode::Ok
        }
        Err(error) => {
            set_display_error(error_out, error);
            DagMlDataStatusCode::ValidationError
        }
    }
}

/// Creates a Rust-owned in-memory provider with typed row-major f64 feature matrices.
///
/// `feature_matrices_ptr/feature_matrices_len` may be null/zero, or a JSON
/// array of `NumericFeatureMatrixF64` values. Unlike
/// `dagmldata_inmemory_provider_new_with_features_json`, this path avoids
/// per-cell `serde_json::Value` parsing for numeric feature values.
///
/// # Safety
///
/// Non-null byte pointers must point to readable memory for the duration of the
/// call. `out_vtable` may be null only if the caller is probing error handling.
#[no_mangle]
pub unsafe extern "C" fn dagmldata_inmemory_provider_new_with_f64_features_json(
    envelope_ptr: *const u8,
    envelope_len: usize,
    target_tables_ptr: *const u8,
    target_tables_len: usize,
    feature_matrices_ptr: *const u8,
    feature_matrices_len: usize,
    out_vtable: *mut DagMlDataVTable,
    error_out: *mut DagMlDataString,
) -> DagMlDataStatusCode {
    clear_vtable(out_vtable);
    clear_string(error_out);
    if envelope_ptr.is_null() {
        set_error_message(error_out, "envelope pointer is null");
        return DagMlDataStatusCode::InvalidArgument;
    }
    if out_vtable.is_null() {
        set_error_message(error_out, "vtable output pointer is null");
        return DagMlDataStatusCode::InvalidArgument;
    }

    let envelope_json = slice::from_raw_parts(envelope_ptr, envelope_len);
    let envelope = match serde_json::from_slice::<CoordinatorDataPlanEnvelope>(envelope_json) {
        Ok(envelope) => envelope,
        Err(error) => {
            set_display_error(error_out, error);
            return DagMlDataStatusCode::ValidationError;
        }
    };
    let target_tables = match parse_target_tables(target_tables_ptr, target_tables_len, error_out) {
        Ok(target_tables) => target_tables,
        Err(status) => return status,
    };
    let feature_store =
        match parse_f64_feature_matrices(feature_matrices_ptr, feature_matrices_len, error_out) {
            Ok(feature_store) => feature_store,
            Err(status) => return status,
        };
    match InMemoryProviderState::new(envelope, target_tables, feature_store) {
        Ok(provider) => {
            *out_vtable = provider_vtable(Box::into_raw(Box::new(provider)).cast::<c_void>());
            DagMlDataStatusCode::Ok
        }
        Err(error) => {
            set_display_error(error_out, error);
            DagMlDataStatusCode::ValidationError
        }
    }
}

/// Creates a Rust-owned in-memory provider that serves borrowed N-D tensors
/// (RGB images, hyperspectral cubes, ...). The borrowed views are copied into
/// canonical row-major storage during this call; callers keep ownership of all
/// input pointers and may release them after the function returns.
///
/// # Safety
///
/// Non-null byte/tensor pointers must point to readable memory for the duration
/// of the call. `out_vtable` may be null only if the caller is probing error
/// handling.
#[no_mangle]
pub unsafe extern "C" fn dagmldata_inmemory_provider_new_with_tensor_views(
    envelope_ptr: *const u8,
    envelope_len: usize,
    target_tables_ptr: *const u8,
    target_tables_len: usize,
    tensor_views_ptr: *const DagMlDataBorrowedTensorView,
    tensor_views_len: usize,
    out_vtable: *mut DagMlDataVTable,
    error_out: *mut DagMlDataString,
) -> DagMlDataStatusCode {
    clear_vtable(out_vtable);
    clear_string(error_out);
    if envelope_ptr.is_null() {
        set_error_message(error_out, "envelope pointer is null");
        return DagMlDataStatusCode::InvalidArgument;
    }
    if out_vtable.is_null() {
        set_error_message(error_out, "vtable output pointer is null");
        return DagMlDataStatusCode::InvalidArgument;
    }

    let envelope_json = slice::from_raw_parts(envelope_ptr, envelope_len);
    let envelope = match serde_json::from_slice::<CoordinatorDataPlanEnvelope>(envelope_json) {
        Ok(envelope) => envelope,
        Err(error) => {
            set_display_error(error_out, error);
            return DagMlDataStatusCode::ValidationError;
        }
    };
    let target_tables = match parse_target_tables(target_tables_ptr, target_tables_len, error_out) {
        Ok(target_tables) => target_tables,
        Err(status) => return status,
    };
    let nd_tensor_store = match parse_borrowed_tensor_views(tensor_views_ptr, tensor_views_len) {
        Ok(store) => store,
        Err(error) => {
            set_display_error(error_out, error);
            return DagMlDataStatusCode::ValidationError;
        }
    };
    match InMemoryProviderState::new_with_tensors(
        envelope,
        target_tables,
        NumericFeatureBufferStore::default(),
        nd_tensor_store,
    ) {
        Ok(provider) => {
            *out_vtable = provider_vtable(Box::into_raw(Box::new(provider)).cast::<c_void>());
            DagMlDataStatusCode::Ok
        }
        Err(error) => {
            set_display_error(error_out, error);
            DagMlDataStatusCode::ValidationError
        }
    }
}

/// Creates a Rust-owned in-memory provider with borrowed C f64 feature matrices.
///
/// The borrowed `DagMlDataFeatureMatrixF64View` descriptors are copied into
/// Rust-owned buffers during this call. Callers keep ownership of all input
/// pointers and may release them after the function returns.
///
/// # Safety
///
/// Non-null byte pointers and matrix pointers must point to readable memory for
/// the duration of the call. `out_vtable` may be null only if the caller is
/// probing error handling.
#[no_mangle]
pub unsafe extern "C" fn dagmldata_inmemory_provider_new_with_f64_feature_views(
    envelope_ptr: *const u8,
    envelope_len: usize,
    target_tables_ptr: *const u8,
    target_tables_len: usize,
    feature_matrices_ptr: *const DagMlDataFeatureMatrixF64View,
    feature_matrices_len: usize,
    out_vtable: *mut DagMlDataVTable,
    error_out: *mut DagMlDataString,
) -> DagMlDataStatusCode {
    clear_vtable(out_vtable);
    clear_string(error_out);
    if envelope_ptr.is_null() {
        set_error_message(error_out, "envelope pointer is null");
        return DagMlDataStatusCode::InvalidArgument;
    }
    if out_vtable.is_null() {
        set_error_message(error_out, "vtable output pointer is null");
        return DagMlDataStatusCode::InvalidArgument;
    }

    let envelope_json = slice::from_raw_parts(envelope_ptr, envelope_len);
    let envelope = match serde_json::from_slice::<CoordinatorDataPlanEnvelope>(envelope_json) {
        Ok(envelope) => envelope,
        Err(error) => {
            set_display_error(error_out, error);
            return DagMlDataStatusCode::ValidationError;
        }
    };
    let target_tables = match parse_target_tables(target_tables_ptr, target_tables_len, error_out) {
        Ok(target_tables) => target_tables,
        Err(status) => return status,
    };
    let feature_store =
        match parse_f64_feature_matrix_views(feature_matrices_ptr, feature_matrices_len) {
            Ok(feature_store) => feature_store,
            Err(error) => {
                set_display_error(error_out, error);
                return DagMlDataStatusCode::ValidationError;
            }
        };
    match InMemoryProviderState::new(envelope, target_tables, feature_store) {
        Ok(provider) => {
            *out_vtable = provider_vtable(Box::into_raw(Box::new(provider)).cast::<c_void>());
            DagMlDataStatusCode::Ok
        }
        Err(error) => {
            set_display_error(error_out, error);
            DagMlDataStatusCode::ValidationError
        }
    }
}

/// Creates a Rust-owned in-memory provider with borrowed C column-major f64 feature matrices.
///
/// `DagMlDataFeatureMatrixF64ColumnarView` mirrors the production columnar
/// layout of Arrow/Parquet/NumPy column ndarrays: one f64 slice per feature
/// column, with optional per-column validity bitmaps. The column slices and
/// optional validity masks are copied into Rust-owned buffers during this
/// call, so callers may release them after the function returns and pay no
/// row-major transpose on the hot ingestion path.
///
/// # Safety
///
/// Non-null byte pointers and matrix/column pointers must point to readable
/// memory for the duration of the call. `out_vtable` may be null only if the
/// caller is probing error handling.
#[no_mangle]
pub unsafe extern "C" fn dagmldata_inmemory_provider_new_with_f64_feature_columns(
    envelope_ptr: *const u8,
    envelope_len: usize,
    target_tables_ptr: *const u8,
    target_tables_len: usize,
    feature_matrices_ptr: *const DagMlDataFeatureMatrixF64ColumnarView,
    feature_matrices_len: usize,
    out_vtable: *mut DagMlDataVTable,
    error_out: *mut DagMlDataString,
) -> DagMlDataStatusCode {
    clear_vtable(out_vtable);
    clear_string(error_out);
    if envelope_ptr.is_null() {
        set_error_message(error_out, "envelope pointer is null");
        return DagMlDataStatusCode::InvalidArgument;
    }
    if out_vtable.is_null() {
        set_error_message(error_out, "vtable output pointer is null");
        return DagMlDataStatusCode::InvalidArgument;
    }

    let envelope_json = slice::from_raw_parts(envelope_ptr, envelope_len);
    let envelope = match serde_json::from_slice::<CoordinatorDataPlanEnvelope>(envelope_json) {
        Ok(envelope) => envelope,
        Err(error) => {
            set_display_error(error_out, error);
            return DagMlDataStatusCode::ValidationError;
        }
    };
    let target_tables = match parse_target_tables(target_tables_ptr, target_tables_len, error_out) {
        Ok(target_tables) => target_tables,
        Err(status) => return status,
    };
    let feature_store =
        match parse_f64_feature_matrix_columnar_views(feature_matrices_ptr, feature_matrices_len) {
            Ok(feature_store) => feature_store,
            Err(error) => {
                set_display_error(error_out, error);
                return DagMlDataStatusCode::ValidationError;
            }
        };
    match InMemoryProviderState::new(envelope, target_tables, feature_store) {
        Ok(provider) => {
            *out_vtable = provider_vtable(Box::into_raw(Box::new(provider)).cast::<c_void>());
            DagMlDataStatusCode::Ok
        }
        Err(error) => {
            set_display_error(error_out, error);
            DagMlDataStatusCode::ValidationError
        }
    }
}

/// Creates a Rust-owned in-memory provider whose feature buffers are loaded
/// from a deterministic `.n4d` binary file produced by the dag-ml-data file
/// store serializer. Lets a host persist a provider's feature buffers across
/// processes without re-ingesting the source data.
///
/// `path_ptr/path_len` must encode a UTF-8 filesystem path. Loading errors
/// (truncation, bad magic, unsupported version, SHA-256 mismatch) bubble up
/// as `ValidationError` with the error string filled in.
///
/// # Safety
///
/// Non-null byte pointers must point to readable memory for the duration of
/// the call. `out_vtable` may be null only if the caller is probing error
/// handling.
#[no_mangle]
pub unsafe extern "C" fn dagmldata_inmemory_provider_new_from_file(
    envelope_ptr: *const u8,
    envelope_len: usize,
    target_tables_ptr: *const u8,
    target_tables_len: usize,
    path_ptr: *const u8,
    path_len: usize,
    out_vtable: *mut DagMlDataVTable,
    error_out: *mut DagMlDataString,
) -> DagMlDataStatusCode {
    clear_vtable(out_vtable);
    clear_string(error_out);
    if envelope_ptr.is_null() {
        set_error_message(error_out, "envelope pointer is null");
        return DagMlDataStatusCode::InvalidArgument;
    }
    if out_vtable.is_null() {
        set_error_message(error_out, "vtable output pointer is null");
        return DagMlDataStatusCode::InvalidArgument;
    }
    if path_ptr.is_null() {
        set_error_message(error_out, "buffer-store path pointer is null");
        return DagMlDataStatusCode::InvalidArgument;
    }

    let envelope_json = slice::from_raw_parts(envelope_ptr, envelope_len);
    let envelope = match serde_json::from_slice::<CoordinatorDataPlanEnvelope>(envelope_json) {
        Ok(envelope) => envelope,
        Err(error) => {
            set_display_error(error_out, error);
            return DagMlDataStatusCode::ValidationError;
        }
    };
    let target_tables = match parse_target_tables(target_tables_ptr, target_tables_len, error_out) {
        Ok(target_tables) => target_tables,
        Err(status) => return status,
    };
    let path_bytes = slice::from_raw_parts(path_ptr, path_len);
    let path_str = match std::str::from_utf8(path_bytes) {
        Ok(value) => value,
        Err(error) => {
            set_error_message(
                error_out,
                format!("buffer-store path is not valid utf-8: {error}"),
            );
            return DagMlDataStatusCode::ValidationError;
        }
    };
    let path = std::path::Path::new(path_str);
    let feature_store = match dag_ml_data_core::buffer_file_store::read_store_from_path(path) {
        Ok(store) => store,
        Err(error) => {
            set_display_error(error_out, error);
            return DagMlDataStatusCode::ValidationError;
        }
    };
    match InMemoryProviderState::new(envelope, target_tables, feature_store) {
        Ok(provider) => {
            *out_vtable = provider_vtable(Box::into_raw(Box::new(provider)).cast::<c_void>());
            DagMlDataStatusCode::Ok
        }
        Err(error) => {
            set_display_error(error_out, error);
            DagMlDataStatusCode::ValidationError
        }
    }
}

/// Creates a Rust-owned in-memory provider whose feature buffers are loaded
/// from an Apache Arrow IPC file on disk. Only available when the
/// `arrow-ipc` feature is enabled — host bindings opt into the `arrow`
/// dependency by depending on `dag-ml-data-capi` with that feature on.
///
/// `path_ptr/path_len` must encode a UTF-8 filesystem path to an Arrow IPC
/// file. Each top-level `RecordBatch` becomes one feature buffer; its
/// schema must declare `dag_ml_data.feature_set_id` and
/// `dag_ml_data.representation_id` metadata, and expose an
/// `observation_id` Utf8 column. See `dag-ml-data-arrow` for the full
/// mapping contract.
///
/// # Safety
///
/// Non-null byte pointers must point to readable memory for the duration of
/// the call. `out_vtable` may be null only if the caller is probing error
/// handling.
#[cfg(feature = "arrow-ipc")]
#[no_mangle]
pub unsafe extern "C" fn dagmldata_inmemory_provider_new_from_arrow_ipc(
    envelope_ptr: *const u8,
    envelope_len: usize,
    target_tables_ptr: *const u8,
    target_tables_len: usize,
    path_ptr: *const u8,
    path_len: usize,
    out_vtable: *mut DagMlDataVTable,
    error_out: *mut DagMlDataString,
) -> DagMlDataStatusCode {
    clear_vtable(out_vtable);
    clear_string(error_out);
    if envelope_ptr.is_null() {
        set_error_message(error_out, "envelope pointer is null");
        return DagMlDataStatusCode::InvalidArgument;
    }
    if out_vtable.is_null() {
        set_error_message(error_out, "vtable output pointer is null");
        return DagMlDataStatusCode::InvalidArgument;
    }
    if path_ptr.is_null() {
        set_error_message(error_out, "arrow IPC path pointer is null");
        return DagMlDataStatusCode::InvalidArgument;
    }

    let envelope_json = slice::from_raw_parts(envelope_ptr, envelope_len);
    let envelope = match serde_json::from_slice::<CoordinatorDataPlanEnvelope>(envelope_json) {
        Ok(envelope) => envelope,
        Err(error) => {
            set_display_error(error_out, error);
            return DagMlDataStatusCode::ValidationError;
        }
    };
    let target_tables = match parse_target_tables(target_tables_ptr, target_tables_len, error_out) {
        Ok(target_tables) => target_tables,
        Err(status) => return status,
    };
    let path_bytes = slice::from_raw_parts(path_ptr, path_len);
    let path_str = match std::str::from_utf8(path_bytes) {
        Ok(value) => value,
        Err(error) => {
            set_error_message(
                error_out,
                format!("arrow IPC path is not valid utf-8: {error}"),
            );
            return DagMlDataStatusCode::ValidationError;
        }
    };
    let path = std::path::Path::new(path_str);
    let feature_store = match dag_ml_data_arrow::read_buffers_from_ipc_path(path) {
        Ok(store) => store,
        Err(error) => {
            set_display_error(error_out, error);
            return DagMlDataStatusCode::ValidationError;
        }
    };
    match InMemoryProviderState::new(envelope, target_tables, feature_store) {
        Ok(provider) => {
            *out_vtable = provider_vtable(Box::into_raw(Box::new(provider)).cast::<c_void>());
            DagMlDataStatusCode::Ok
        }
        Err(error) => {
            set_display_error(error_out, error);
            DagMlDataStatusCode::ValidationError
        }
    }
}

pub const DAG_ML_DATA_BUFFER_FETCHER_ABI_VERSION: u32 = 1;

/// Vtable a host implements so the provider can pull feature buffers on
/// demand, rather than requiring all bytes up-front in JSON or borrowed C
/// views.
///
/// Lifecycle contract:
///
/// - The host owns the bytes pointed to by `out_view` for the duration of
///   the `fetch_columnar` call only. The provider copies them into
///   Rust-owned buffers before the call returns; the host may free its
///   memory immediately after.
/// - `destroy` is called exactly once per constructor invocation, before
///   the constructor returns (success or failure). The provider's
///   internal guard suppresses any accidental second invocation that a
///   future edit might introduce.
/// - The `user_data` pointer must not be shared across concurrent
///   `dagmldata_inmemory_provider_new_with_buffer_fetcher` calls. Each
///   constructor calls `destroy(user_data)` once; concurrent constructors
///   would therefore call destroy twice with the same pointer, causing
///   host-side double-free / UB.
/// - The host must not populate `error_out` when returning `Ok` — but the
///   provider defensively frees any error string it observes after the
///   callback regardless, to avoid silent leaks if a host violates this.
#[repr(C)]
#[derive(Clone, Copy)]
pub struct DagMlDataBufferFetcherVTable {
    pub abi_version: u32,
    pub user_data: *mut c_void,
    pub fetch_columnar: Option<
        unsafe extern "C" fn(
            user_data: *mut c_void,
            feature_set_id: DagMlDataBytesView,
            content_fingerprint: DagMlDataBytesView,
            out_view: *mut DagMlDataFeatureMatrixF64ColumnarView,
            error_out: *mut DagMlDataString,
        ) -> DagMlDataStatusCode,
    >,
    pub destroy: Option<unsafe extern "C" fn(user_data: *mut c_void)>,
}

/// One (feature_set_id, content_fingerprint) pair the fetcher is asked
/// to materialize. The pair lets the host distinguish the same logical
/// feature set across different versions.
#[repr(C)]
#[derive(Clone, Copy, Debug)]
pub struct DagMlDataBufferFetchRequest {
    pub feature_set_id: DagMlDataBytesView,
    pub content_fingerprint: DagMlDataBytesView,
}

/// Creates a Rust-owned in-memory provider whose feature buffers are
/// produced by a host-supplied fetcher vtable. Each entry in
/// `requests` is passed to the fetcher in order; the returned columnar
/// view is copied into Rust-owned buffers and registered in the
/// provider. The fetcher's `destroy` callback is invoked exactly once
/// before the function returns (whether the constructor succeeds or
/// fails after the first fetch).
///
/// # Safety
///
/// Non-null byte pointers must point to readable memory for the duration
/// of the call. `out_vtable` may be null only if the caller is probing
/// error handling.
#[no_mangle]
pub unsafe extern "C" fn dagmldata_inmemory_provider_new_with_buffer_fetcher(
    envelope_ptr: *const u8,
    envelope_len: usize,
    target_tables_ptr: *const u8,
    target_tables_len: usize,
    fetcher: DagMlDataBufferFetcherVTable,
    requests_ptr: *const DagMlDataBufferFetchRequest,
    requests_len: usize,
    out_vtable: *mut DagMlDataVTable,
    error_out: *mut DagMlDataString,
) -> DagMlDataStatusCode {
    clear_vtable(out_vtable);
    clear_string(error_out);
    // RAII-style at-most-once guard: turning `Some` into `None` after the
    // first invocation makes a future `destroy_fetcher()` call a silent
    // no-op even if a maintainer accidentally double-fires it on a new
    // error branch. Without this, a host's `destroy` callback could be
    // invoked twice on the same `user_data`, which is host-side UB
    // (typically a double-free).
    let mut destroy_slot = Some(fetcher.destroy);
    let mut destroy_fetcher = || {
        if let Some(destroy) = destroy_slot.take().flatten() {
            destroy(fetcher.user_data);
        }
    };
    if out_vtable.is_null() {
        set_error_message(error_out, "vtable output pointer is null");
        destroy_fetcher();
        return DagMlDataStatusCode::InvalidArgument;
    }
    if envelope_ptr.is_null() {
        set_error_message(error_out, "envelope pointer is null");
        destroy_fetcher();
        return DagMlDataStatusCode::InvalidArgument;
    }
    if fetcher.abi_version != DAG_ML_DATA_BUFFER_FETCHER_ABI_VERSION {
        set_error_message(error_out,
            format!(
                "fetcher vtable abi_version {} does not match {DAG_ML_DATA_BUFFER_FETCHER_ABI_VERSION}",
                fetcher.abi_version
            ),
        );
        destroy_fetcher();
        return DagMlDataStatusCode::InvalidArgument;
    }
    let Some(fetch_callback) = fetcher.fetch_columnar else {
        set_error_message(error_out, "fetcher vtable fetch_columnar callback is null");
        destroy_fetcher();
        return DagMlDataStatusCode::InvalidArgument;
    };
    if requests_ptr.is_null() && requests_len != 0 {
        set_error_message(
            error_out,
            "fetch requests pointer is null but length is non-zero",
        );
        destroy_fetcher();
        return DagMlDataStatusCode::InvalidArgument;
    }

    let envelope_json = slice::from_raw_parts(envelope_ptr, envelope_len);
    let envelope = match serde_json::from_slice::<CoordinatorDataPlanEnvelope>(envelope_json) {
        Ok(envelope) => envelope,
        Err(error) => {
            set_display_error(error_out, error);
            destroy_fetcher();
            return DagMlDataStatusCode::ValidationError;
        }
    };
    let target_tables = match parse_target_tables(target_tables_ptr, target_tables_len, error_out) {
        Ok(target_tables) => target_tables,
        Err(status) => {
            destroy_fetcher();
            return status;
        }
    };

    let requests: &[DagMlDataBufferFetchRequest] = if requests_len == 0 {
        &[]
    } else {
        slice::from_raw_parts(requests_ptr, requests_len)
    };
    let mut matrices = Vec::with_capacity(requests.len());
    for (index, request) in requests.iter().enumerate() {
        let mut view = DagMlDataFeatureMatrixF64ColumnarView {
            feature_set_id: DagMlDataBytesView {
                ptr: std::ptr::null(),
                len: 0,
            },
            representation_id: DagMlDataBytesView {
                ptr: std::ptr::null(),
                len: 0,
            },
            feature_names: std::ptr::null(),
            feature_names_len: 0,
            observation_ids: std::ptr::null(),
            observation_ids_len: 0,
            columns: std::ptr::null(),
            columns_len: 0,
        };
        let mut fetch_error = DagMlDataString::default();
        let status = fetch_callback(
            fetcher.user_data,
            request.feature_set_id,
            request.content_fingerprint,
            &mut view,
            &mut fetch_error,
        );
        // Always consume `fetch_error` regardless of status: a host that
        // populates the error string on a success-status return would
        // otherwise leak that allocation forever. `consume_string_message`
        // safely no-ops on a null/empty string.
        let fetch_message = consume_string_message(fetch_error);
        if status != DagMlDataStatusCode::Ok {
            set_error_message(
                error_out,
                format!(
                    "fetcher rejected request {index}: status {status:?} message {fetch_message}"
                ),
            );
            destroy_fetcher();
            return DagMlDataStatusCode::ValidationError;
        }
        let matrix = match f64_feature_matrix_columnar_view_to_core(view, index) {
            Ok(matrix) => matrix,
            Err(error) => {
                set_error_message(
                    error_out,
                    format!("fetcher returned invalid matrix for request {index}: {error}"),
                );
                destroy_fetcher();
                return DagMlDataStatusCode::ValidationError;
            }
        };
        matrices.push(matrix);
    }
    destroy_fetcher();
    let feature_store = match NumericFeatureBufferStore::from_f64_column_matrices(matrices) {
        Ok(store) => store,
        Err(error) => {
            set_display_error(error_out, error);
            return DagMlDataStatusCode::ValidationError;
        }
    };
    match InMemoryProviderState::new(envelope, target_tables, feature_store) {
        Ok(provider) => {
            *out_vtable = provider_vtable(Box::into_raw(Box::new(provider)).cast::<c_void>());
            DagMlDataStatusCode::Ok
        }
        Err(error) => {
            set_display_error(error_out, error);
            DagMlDataStatusCode::ValidationError
        }
    }
}

/// Destroys a provider vtable returned by `dagmldata_inmemory_provider_new_json`.
///
/// # Safety
///
/// `vtable` must be null or point to a vtable previously initialized by
/// `dagmldata_inmemory_provider_new_json` and not already destroyed.
#[no_mangle]
pub unsafe extern "C" fn dagmldata_inmemory_provider_destroy(vtable: *mut DagMlDataVTable) {
    if vtable.is_null() {
        return;
    }
    if let Some(destroy) = (*vtable).destroy {
        destroy((*vtable).user_data);
    }
    *vtable = empty_vtable();
}

/// Returns the provider-owned numeric feature-buffer manifests as JSON.
///
/// The JSON is an array of `NumericFeatureBufferManifest` values. It is a
/// conformance/debug export for bindings that need to verify which typed
/// buffers are loaded before creating views, feature Arrow arrays or tensors.
///
/// # Safety
///
/// `vtable` must point to a live vtable returned by
/// any `dagmldata_inmemory_provider_new*` constructor (JSON, typed f64,
/// borrowed views, columnar borrowed views, or file-backed). Returned
/// strings must be released with `dagmldata_string_free`.
#[no_mangle]
pub unsafe extern "C" fn dagmldata_inmemory_provider_feature_buffer_manifest_json(
    vtable: *const DagMlDataVTable,
    out_json: *mut DagMlDataString,
    error_out: *mut DagMlDataString,
) -> DagMlDataStatusCode {
    clear_string(out_json);
    clear_string(error_out);
    if vtable.is_null() || (*vtable).user_data.is_null() {
        set_error_message(error_out, "provider vtable or user_data is null");
        return DagMlDataStatusCode::InvalidArgument;
    }

    let state = &*((*vtable).user_data.cast::<InMemoryProviderState>());
    match state
        .provider
        .feature_buffer_manifests()
        .and_then(|manifests| serde_json::to_string(&manifests).map_err(Into::into))
    {
        Ok(json) => {
            set_string(out_json, json);
            DagMlDataStatusCode::Ok
        }
        Err(error) => {
            set_display_error(error_out, error);
            DagMlDataStatusCode::ValidationError
        }
    }
}

/// Returns feature-buffer bindings for one live materialized data handle.
///
/// Unlike the provider-wide manifest export, this reports only buffers whose
/// representation and observation coverage are compatible with the scoped
/// coordinator relations owned by `data_handle`.
///
/// # Safety
///
/// `vtable` must point to a live vtable returned by
/// any `dagmldata_inmemory_provider_new*` constructor (JSON, typed f64,
/// borrowed views, columnar borrowed views, or file-backed). Returned
/// strings must be released with `dagmldata_string_free`.
#[no_mangle]
pub unsafe extern "C" fn dagmldata_inmemory_provider_data_feature_buffer_manifest_json(
    vtable: *const DagMlDataVTable,
    data_handle: DagMlDataHandle,
    out_json: *mut DagMlDataString,
    error_out: *mut DagMlDataString,
) -> DagMlDataStatusCode {
    clear_string(out_json);
    clear_string(error_out);
    if vtable.is_null() || (*vtable).user_data.is_null() {
        set_error_message(error_out, "provider vtable or user_data is null");
        return DagMlDataStatusCode::InvalidArgument;
    }

    let state = &*((*vtable).user_data.cast::<InMemoryProviderState>());
    match state
        .provider
        .data_feature_buffer_bindings(data_handle)
        .and_then(|bindings| serde_json::to_string(&bindings).map_err(Into::into))
    {
        Ok(json) => {
            set_string(out_json, json);
            DagMlDataStatusCode::Ok
        }
        Err(error) => {
            set_display_error(error_out, error);
            DagMlDataStatusCode::ValidationError
        }
    }
}

#[derive(Debug, Deserialize)]
struct NdTensorExportSelector {
    tensor_id: String,
    #[serde(default)]
    source_id: Option<String>,
}

/// Returns the provider-wide N-D tensor manifests as JSON (no payload bytes).
///
/// # Safety
///
/// `vtable` must point to a live provider vtable; returned strings must be
/// released with `dagmldata_string_free`.
#[no_mangle]
pub unsafe extern "C" fn dagmldata_inmemory_provider_nd_tensor_manifest_json(
    vtable: *const DagMlDataVTable,
    out_json: *mut DagMlDataString,
    error_out: *mut DagMlDataString,
) -> DagMlDataStatusCode {
    clear_string(out_json);
    clear_string(error_out);
    if vtable.is_null() || (*vtable).user_data.is_null() {
        set_error_message(error_out, "provider vtable or user_data is null");
        return DagMlDataStatusCode::InvalidArgument;
    }
    let state = &*((*vtable).user_data.cast::<InMemoryProviderState>());
    match state
        .provider
        .nd_tensor_manifests()
        .and_then(|manifests| serde_json::to_string(&manifests).map_err(Into::into))
    {
        Ok(json) => {
            set_string(out_json, json);
            DagMlDataStatusCode::Ok
        }
        Err(error) => {
            set_display_error(error_out, error);
            DagMlDataStatusCode::ValidationError
        }
    }
}

/// Returns the N-D tensor bindings for one live materialized data handle as JSON.
///
/// # Safety
///
/// `vtable` must point to a live provider vtable; returned strings must be
/// released with `dagmldata_string_free`.
#[no_mangle]
pub unsafe extern "C" fn dagmldata_inmemory_provider_data_nd_tensor_manifest_json(
    vtable: *const DagMlDataVTable,
    data_handle: DagMlDataHandle,
    out_json: *mut DagMlDataString,
    error_out: *mut DagMlDataString,
) -> DagMlDataStatusCode {
    clear_string(out_json);
    clear_string(error_out);
    if vtable.is_null() || (*vtable).user_data.is_null() {
        set_error_message(error_out, "provider vtable or user_data is null");
        return DagMlDataStatusCode::InvalidArgument;
    }
    let state = &*((*vtable).user_data.cast::<InMemoryProviderState>());
    match state
        .provider
        .data_nd_tensor_bindings(data_handle)
        .and_then(|bindings| serde_json::to_string(&bindings).map_err(Into::into))
    {
        Ok(json) => {
            set_string(out_json, json);
            DagMlDataStatusCode::Ok
        }
        Err(error) => {
            set_display_error(error_out, error);
            DagMlDataStatusCode::ValidationError
        }
    }
}

/// Exports a view-filtered, contiguous row-major N-D tensor as an owned
/// [`DagMlDataOwnedTensor`]. The selector JSON is `{ tensor_id, source_id? }`;
/// axis 0 is gathered in the view's relation order.
///
/// # Safety
///
/// `vtable` must point to a live provider vtable; `selector_json.ptr` must point
/// to `selector_json.len` readable bytes; `out_tensor` must be non-null. The
/// returned tensor must be released with `dagmldata_nd_tensor_free`.
#[no_mangle]
pub unsafe extern "C" fn dagmldata_inmemory_provider_nd_tensor_export_json(
    vtable: *const DagMlDataVTable,
    view: DagMlDataHandle,
    selector_json: DagMlDataBytesView,
    out_tensor: *mut DagMlDataOwnedTensor,
    error_out: *mut DagMlDataString,
) -> DagMlDataStatusCode {
    clear_string(error_out);
    if !out_tensor.is_null() {
        *out_tensor = DagMlDataOwnedTensor::default();
    }
    if vtable.is_null()
        || (*vtable).user_data.is_null()
        || selector_json.ptr.is_null()
        || out_tensor.is_null()
    {
        set_error_message(
            error_out,
            "provider vtable, user_data, selector or out_tensor pointer is null",
        );
        return DagMlDataStatusCode::InvalidArgument;
    }
    let state = &*((*vtable).user_data.cast::<InMemoryProviderState>());
    let selector_bytes = slice::from_raw_parts(selector_json.ptr, selector_json.len);
    let selector = match serde_json::from_slice::<NdTensorExportSelector>(selector_bytes) {
        Ok(selector) => selector,
        Err(error) => {
            set_display_error(error_out, error);
            return DagMlDataStatusCode::ValidationError;
        }
    };
    let source_id = match selector.source_id.as_deref() {
        Some(value) => match dag_ml_data_core::SourceId::new(value) {
            Ok(id) => Some(id),
            Err(error) => {
                set_display_error(error_out, error);
                return DagMlDataStatusCode::ValidationError;
            }
        },
        None => None,
    };
    match state
        .provider
        .nd_tensor_block(view, &selector.tensor_id, source_id.as_ref())
    {
        Ok(block) => {
            *out_tensor = owned_tensor_from_block(block);
            DagMlDataStatusCode::Ok
        }
        Err(error) => {
            set_display_error(error_out, error);
            DagMlDataStatusCode::ValidationError
        }
    }
}

/// Frees a [`DagMlDataOwnedTensor`] returned by the ND export.
///
/// # Safety
///
/// `tensor` must have been returned by
/// `dagmldata_inmemory_provider_nd_tensor_export_json` and not already freed.
#[no_mangle]
pub unsafe extern "C" fn dagmldata_nd_tensor_free(tensor: DagMlDataOwnedTensor) {
    dagmldata_string_free(tensor.tensor_id);
    dagmldata_string_free(tensor.representation_id);
    dagmldata_string_free(tensor.container);
    free_string_array(tensor.observation_ids);
    free_string_array(tensor.sample_ids);
    free_usize_array(tensor.shape);
    free_u8_array(tensor.data);
    free_u8_array(tensor.row_presence_mask);
}

/// Builds a JSON row-major tensor from feature buffers owned by the Rust
/// in-memory provider.
///
/// The selector JSON shape is `{ feature_set_id, policy? }` for a single
/// provider feature table, or `{ fusion, policy? }` where `fusion` is a feature
/// fusion selector accepted by the provider. The output JSON is a
/// `NumericTensorBlock`.
///
/// # Safety
///
/// `vtable` must point to a live vtable returned by
/// any `dagmldata_inmemory_provider_new*` constructor; `selector_json.ptr`
/// must point to `selector_json.len` readable bytes. Returned strings must be
/// released with `dagmldata_string_free`.
#[no_mangle]
pub unsafe extern "C" fn dagmldata_inmemory_provider_feature_collation_json(
    vtable: *const DagMlDataVTable,
    view: DagMlDataHandle,
    selector_json: DagMlDataBytesView,
    out_json: *mut DagMlDataString,
    error_out: *mut DagMlDataString,
) -> DagMlDataStatusCode {
    clear_string(out_json);
    clear_string(error_out);
    if vtable.is_null() || (*vtable).user_data.is_null() || selector_json.ptr.is_null() {
        set_error_message(
            error_out,
            "provider vtable, user_data or selector pointer is null",
        );
        return DagMlDataStatusCode::InvalidArgument;
    }

    let state = &*((*vtable).user_data.cast::<InMemoryProviderState>());
    let selector = slice::from_raw_parts(selector_json.ptr, selector_json.len);
    match serde_json::from_slice::<ProviderFeatureCollationRequest>(selector) {
        Ok(request) => match state
            .provider
            .feature_collation_block(view, &request)
            .and_then(|block| collate_feature_block(&block, &request.policy))
            .and_then(|tensor| serde_json::to_string(&tensor).map_err(Into::into))
        {
            Ok(tensor_json) => {
                set_string(out_json, tensor_json);
                DagMlDataStatusCode::Ok
            }
            Err(error) => {
                set_display_error(error_out, error);
                DagMlDataStatusCode::ValidationError
            }
        },
        Err(error) => {
            set_display_error(error_out, error);
            DagMlDataStatusCode::ValidationError
        }
    }
}

/// Builds an owned row-major f64 tensor from feature buffers owned by the Rust
/// in-memory provider.
///
/// The selector JSON shape is `{ feature_set_id, policy? }` for a single
/// provider feature table, or `{ fusion, policy? }` where `fusion` is a feature
/// fusion selector accepted by the provider. The returned tensor must be
/// released with `dagmldata_tensor_f64_free`.
///
/// # Safety
///
/// `vtable` must point to a live vtable returned by
/// any `dagmldata_inmemory_provider_new*` constructor; `selector_json.ptr`
/// must point to `selector_json.len` readable bytes. `out_tensor` must point to
/// writable memory for one `DagMlDataTensorF64`. `error_out` may be null.
#[no_mangle]
pub unsafe extern "C" fn dagmldata_inmemory_provider_feature_collation_tensor_f64_json(
    vtable: *const DagMlDataVTable,
    view: DagMlDataHandle,
    selector_json: DagMlDataBytesView,
    out_tensor: *mut DagMlDataTensorF64,
    error_out: *mut DagMlDataString,
) -> DagMlDataStatusCode {
    clear_tensor(out_tensor);
    clear_string(error_out);
    if vtable.is_null()
        || (*vtable).user_data.is_null()
        || selector_json.ptr.is_null()
        || out_tensor.is_null()
    {
        set_error_message(
            error_out,
            "provider vtable, user_data, selector pointer or tensor output is null",
        );
        return DagMlDataStatusCode::InvalidArgument;
    }

    let state = &*((*vtable).user_data.cast::<InMemoryProviderState>());
    let selector = slice::from_raw_parts(selector_json.ptr, selector_json.len);
    match serde_json::from_slice::<ProviderFeatureCollationRequest>(selector) {
        Ok(request) => match state
            .provider
            .feature_collation_block(view, &request)
            .and_then(|block| collate_feature_block(&block, &request.policy))
        {
            Ok(tensor) => {
                *out_tensor = tensor_to_c(tensor);
                DagMlDataStatusCode::Ok
            }
            Err(error) => {
                set_display_error(error_out, error);
                DagMlDataStatusCode::ValidationError
            }
        },
        Err(error) => {
            set_display_error(error_out, error);
            DagMlDataStatusCode::ValidationError
        }
    }
}

/// Builds an owned row-major f32 tensor from feature buffers owned by the Rust
/// in-memory provider.
///
/// The selector JSON shape matches the f64 entry point. The collation kernel
/// runs in f64 and each value is cast to f32 at the ABI boundary; the call is
/// rejected with `ValidationError` if any padded value, finite input or padding
/// fallback does not round-trip into a finite f32. The returned tensor must be
/// released with `dagmldata_tensor_f32_free`.
///
/// # Safety
///
/// `vtable` must point to a live vtable returned by
/// any `dagmldata_inmemory_provider_new*` constructor; `selector_json.ptr`
/// must point to `selector_json.len` readable bytes. `out_tensor` must point to
/// writable memory for one `DagMlDataTensorF32`. `error_out` may be null.
#[no_mangle]
pub unsafe extern "C" fn dagmldata_inmemory_provider_feature_collation_tensor_f32_json(
    vtable: *const DagMlDataVTable,
    view: DagMlDataHandle,
    selector_json: DagMlDataBytesView,
    out_tensor: *mut DagMlDataTensorF32,
    error_out: *mut DagMlDataString,
) -> DagMlDataStatusCode {
    clear_tensor_f32(out_tensor);
    clear_string(error_out);
    if vtable.is_null()
        || (*vtable).user_data.is_null()
        || selector_json.ptr.is_null()
        || out_tensor.is_null()
    {
        set_error_message(
            error_out,
            "provider vtable, user_data, selector pointer or tensor output is null",
        );
        return DagMlDataStatusCode::InvalidArgument;
    }

    let state = &*((*vtable).user_data.cast::<InMemoryProviderState>());
    let selector = slice::from_raw_parts(selector_json.ptr, selector_json.len);
    match serde_json::from_slice::<ProviderFeatureCollationRequest>(selector) {
        Ok(request) => match state
            .provider
            .feature_collation_block(view, &request)
            .and_then(|block| collate_feature_block(&block, &request.policy))
            .and_then(tensor_to_c_f32)
        {
            Ok(tensor) => {
                *out_tensor = tensor;
                DagMlDataStatusCode::Ok
            }
            Err(error) => {
                set_display_error(error_out, error);
                DagMlDataStatusCode::ValidationError
            }
        },
        Err(error) => {
            set_display_error(error_out, error);
            DagMlDataStatusCode::ValidationError
        }
    }
}

unsafe fn clear_string(out: *mut DagMlDataString) {
    if !out.is_null() {
        *out = DagMlDataString::default();
    }
}

unsafe fn clear_tensor(out: *mut DagMlDataTensorF64) {
    if !out.is_null() {
        *out = DagMlDataTensorF64::default();
    }
}

unsafe fn clear_tensor_f32(out: *mut DagMlDataTensorF32) {
    if !out.is_null() {
        *out = DagMlDataTensorF32::default();
    }
}

unsafe fn clear_arrow_array(out: *mut *mut ArrowArray) {
    if !out.is_null() {
        *out = std::ptr::null_mut();
    }
}

unsafe fn clear_arrow_schema(out: *mut *mut ArrowSchema) {
    if !out.is_null() {
        *out = std::ptr::null_mut();
    }
}

unsafe fn clear_vtable(out: *mut DagMlDataVTable) {
    if !out.is_null() {
        *out = empty_vtable();
    }
}

unsafe fn set_string(out: *mut DagMlDataString, value: impl Into<String>) {
    if out.is_null() {
        return;
    }
    *out = owned_string(value);
}

/// Numeric ADR-11 code for generic C ABI boundary/argument errors that do not
/// originate from a `DataError` (null pointers, malformed UTF-8): validation
/// category (0), reserved C-ABI code id `0xFFFF`.
const C_ABI_ARGUMENT_ERROR_CODE: u32 = 0x0000_FFFF;

/// Build a structured descriptor for a plain boundary `message`, so the
/// thread-local last-error stays valid JSON and carries a stable taxonomy.
fn c_abi_argument_descriptor(message: &str) -> String {
    serde_json::json!({
        "category": "validation",
        "code": "c_abi_argument",
        "severity": "error",
        "message": message,
        "remediation_hint": "Pass valid, non-null arguments that satisfy the C ABI contract.",
        "context": {"detail": message},
    })
    .to_string()
}

/// Record a plain boundary error: update the thread-local last-error with a
/// generic descriptor and write the message to `out`. The thread-local is
/// updated even when `out` is null so `dagmldata_last_error_*` stay accurate.
unsafe fn set_error_message(out: *mut DagMlDataString, message: impl Into<String>) {
    let message = message.into();
    store_last_error(
        &c_abi_argument_descriptor(&message),
        C_ABI_ARGUMENT_ERROR_CODE,
    );
    set_string(out, message);
}

/// Record a boundary error in the thread-local last-error for handle-based entry
/// points that have no `error_out` and signal failure only via the status code,
/// so `dagmldata_last_error_*` stay consistent with the returned status.
fn record_arg_error(message: &str) {
    store_last_error(
        &c_abi_argument_descriptor(message),
        C_ABI_ARGUMENT_ERROR_CODE,
    );
}

/// Record the true per-variant descriptor of a `DataError` in the thread-local
/// last-error, for status-code-only paths (e.g. provider vtable callbacks) that
/// would otherwise discard the error.
fn record_data_error(error: &DataError) {
    let payload = error
        .descriptor_json()
        .unwrap_or_else(|_| error.to_string());
    store_last_error(&payload, error.error_code());
}

/// Emit a `DataError` to `error_out` (and the thread-local) with its true
/// per-variant taxonomy, returning the `ValidationError` status. Used by parse
/// helpers that own their own error reporting.
unsafe fn data_error_status(
    error_out: *mut DagMlDataString,
    error: DataError,
) -> DagMlDataStatusCode {
    set_display_error(error_out, error);
    DagMlDataStatusCode::ValidationError
}

/// Errors that can be lowered into a stable ADR-11 `DataError` descriptor at the
/// C ABI boundary. Both the core `DataError` and the raw `serde_json::Error`
/// produced by top-level payload parsing implement this, so every C ABI callsite
/// emits the true per-variant taxonomy instead of a hardcoded category/code.
trait IntoDataError {
    fn into_data_error(self) -> DataError;
}

impl IntoDataError for DataError {
    fn into_data_error(self) -> DataError {
        self
    }
}

impl IntoDataError for serde_json::Error {
    fn into_data_error(self) -> DataError {
        DataError::Serialization(self)
    }
}

/// Write a structured ADR-11 descriptor for `error` into `out`. The descriptor
/// carries the real category/code/severity/remediation_hint/context of the
/// underlying `DataError` variant.
unsafe fn set_display_error(out: *mut DagMlDataString, error: impl IntoDataError) {
    let error = error.into_data_error();
    let payload = error
        .descriptor_json()
        .unwrap_or_else(|_| error.to_string());
    store_last_error(&payload, error.error_code());
    set_string(out, payload);
}

/// Read a `DagMlDataString` produced by some other function (typically a
/// host callback), copy it into an owned Rust `String` and free the
/// original. Returns `"<empty>"` for a null pointer so error formatters
/// always have something to print.
unsafe fn consume_string_message(value: DagMlDataString) -> String {
    if value.ptr.is_null() || value.len == 0 {
        return "<empty>".to_string();
    }
    let bytes = slice::from_raw_parts(value.ptr.cast::<u8>(), value.len);
    let message = String::from_utf8_lossy(bytes).into_owned();
    dagmldata_string_free(value);
    message
}

fn owned_string(value: impl Into<String>) -> DagMlDataString {
    let sanitized = value.into().replace('\0', "\\0");
    let c_string = CString::new(sanitized).expect("nul bytes were sanitized");
    let len = c_string.as_bytes().len();
    DagMlDataString {
        ptr: c_string.into_raw(),
        len,
    }
}

fn tensor_to_c(tensor: NumericTensorBlock) -> DagMlDataTensorF64 {
    DagMlDataTensorF64 {
        abi_version: DAG_ML_DATA_TENSOR_F64_ABI_VERSION,
        block_id: owned_string(tensor.block_id),
        representation_id: owned_string(tensor.representation_id.as_str()),
        batch_container: owned_string(tensor.batch_container),
        observation_ids: owned_string_array(
            tensor
                .observation_ids
                .iter()
                .map(|observation_id| observation_id.as_str()),
        ),
        sample_ids: owned_string_array(
            tensor.sample_ids.iter().map(|sample_id| sample_id.as_str()),
        ),
        shape: owned_usize_array(tensor.shape),
        values: owned_f64_array(tensor.values),
        presence_mask: owned_bool_array(tensor.presence_mask),
        validity_mask: owned_bool_array(tensor.validity_mask),
        feature_names: tensor
            .feature_names
            .map(owned_string_array)
            .unwrap_or_default(),
    }
}

fn tensor_to_c_f32(tensor: NumericTensorBlock) -> dag_ml_data_core::Result<DagMlDataTensorF32> {
    // f64 → f32 cast: reject only when the result is non-finite (overflow to
    // ±inf, or upstream NaN that survived collation). Subnormal f32 values
    // are intentionally passed through; consumers running on hardware with
    // flush-to-zero (GPU default, SSE `DAZ`) should be aware that values
    // below ~1.2e-38 may flush at use time.
    let values = tensor
        .values
        .iter()
        .enumerate()
        .map(|(idx, value)| {
            let cast = *value as f32;
            if cast.is_finite() {
                Ok(cast)
            } else {
                Err(dag_ml_data_core::DataError::Validation(format!(
                    "f32 tensor `{}` value at index {idx} ({value}) does not round-trip into a finite f32",
                    tensor.block_id
                )))
            }
        })
        .collect::<dag_ml_data_core::Result<Vec<f32>>>()?;
    Ok(DagMlDataTensorF32 {
        abi_version: DAG_ML_DATA_TENSOR_F32_ABI_VERSION,
        block_id: owned_string(tensor.block_id),
        representation_id: owned_string(tensor.representation_id.as_str()),
        batch_container: owned_string(tensor.batch_container),
        observation_ids: owned_string_array(
            tensor
                .observation_ids
                .iter()
                .map(|observation_id| observation_id.as_str()),
        ),
        sample_ids: owned_string_array(
            tensor.sample_ids.iter().map(|sample_id| sample_id.as_str()),
        ),
        shape: owned_usize_array(tensor.shape),
        values: owned_f32_array(values),
        presence_mask: owned_bool_array(tensor.presence_mask),
        validity_mask: owned_bool_array(tensor.validity_mask),
        feature_names: tensor
            .feature_names
            .map(owned_string_array)
            .unwrap_or_default(),
    })
}

fn owned_string_array<I, S>(values: I) -> DagMlDataStringArray
where
    I: IntoIterator<Item = S>,
    S: Into<String>,
{
    let values = values.into_iter().map(owned_string).collect::<Vec<_>>();
    let (ptr, len) = boxed_slice_parts(values);
    DagMlDataStringArray { ptr, len }
}

fn owned_usize_array(values: Vec<usize>) -> DagMlDataUSizeArray {
    let (ptr, len) = boxed_slice_parts(values);
    DagMlDataUSizeArray { ptr, len }
}

fn owned_f64_array(values: Vec<f64>) -> DagMlDataF64Array {
    let (ptr, len) = boxed_slice_parts(values);
    DagMlDataF64Array { ptr, len }
}

fn owned_f32_array(values: Vec<f32>) -> DagMlDataF32Array {
    let (ptr, len) = boxed_slice_parts(values);
    DagMlDataF32Array { ptr, len }
}

fn owned_bool_array(values: Option<Vec<bool>>) -> DagMlDataU8Array {
    let Some(values) = values else {
        return DagMlDataU8Array::default();
    };
    let values = values.into_iter().map(u8::from).collect::<Vec<_>>();
    let (ptr, len) = boxed_slice_parts(values);
    DagMlDataU8Array { ptr, len }
}

fn owned_u8_array(values: Vec<u8>) -> DagMlDataU8Array {
    let (ptr, len) = boxed_slice_parts(values);
    DagMlDataU8Array { ptr, len }
}

fn owned_tensor_from_block(block: NdTensorBlock) -> DagMlDataOwnedTensor {
    DagMlDataOwnedTensor {
        abi_version: DAG_ML_DATA_OWNED_TENSOR_ABI_VERSION,
        tensor_id: owned_string(block.tensor_id),
        representation_id: owned_string(block.representation_id.as_str()),
        container: owned_string(block.container),
        dtype: DagMlDataTensorDType::from_core(block.dtype),
        observation_ids: owned_string_array(
            block
                .observation_ids
                .iter()
                .map(|id| id.as_str().to_string()),
        ),
        sample_ids: owned_string_array(block.sample_ids.iter().map(|id| id.as_str().to_string())),
        shape: owned_usize_array(block.shape),
        data: owned_u8_array(block.data),
        row_presence_mask: owned_bool_array(block.row_presence),
    }
}

fn boxed_slice_parts<T>(values: Vec<T>) -> (*mut T, usize) {
    if values.is_empty() {
        return (std::ptr::null_mut(), 0);
    }
    let mut boxed = values.into_boxed_slice();
    let ptr = boxed.as_mut_ptr();
    let len = boxed.len();
    std::mem::forget(boxed);
    (ptr, len)
}

unsafe fn free_string_array(array: DagMlDataStringArray) {
    if array.ptr.is_null() {
        return;
    }
    for idx in 0..array.len {
        let value = std::ptr::read(array.ptr.add(idx));
        dagmldata_string_free(value);
    }
    drop(Box::from_raw(std::ptr::slice_from_raw_parts_mut(
        array.ptr, array.len,
    )));
}

unsafe fn free_usize_array(array: DagMlDataUSizeArray) {
    free_boxed_slice(array.ptr, array.len);
}

unsafe fn free_f64_array(array: DagMlDataF64Array) {
    free_boxed_slice(array.ptr, array.len);
}

unsafe fn free_f32_array(array: DagMlDataF32Array) {
    free_boxed_slice(array.ptr, array.len);
}

unsafe fn free_u8_array(array: DagMlDataU8Array) {
    free_boxed_slice(array.ptr, array.len);
}

unsafe fn free_boxed_slice<T>(ptr: *mut T, len: usize) {
    if ptr.is_null() {
        return;
    }
    drop(Box::from_raw(std::ptr::slice_from_raw_parts_mut(ptr, len)));
}

#[derive(Debug, Deserialize)]
struct CoordinatorTargetArrowRequest {
    envelope: CoordinatorDataPlanEnvelope,
    materialization_request: CoordinatorDataMaterializationRequest,
    view: DataView,
    target_table: CoordinatorTargetTable,
    #[serde(default = "default_owner_controller")]
    owner_controller: String,
}

#[derive(Debug, Deserialize)]
struct CoordinatorMultiTargetArrowRequest {
    envelope: CoordinatorDataPlanEnvelope,
    materialization_request: CoordinatorDataMaterializationRequest,
    view: DataView,
    target_tables: Vec<CoordinatorTargetTable>,
    #[serde(default = "default_owner_controller")]
    owner_controller: String,
}

#[derive(Debug, Deserialize)]
struct CoordinatorFeatureArrowRequest {
    envelope: CoordinatorDataPlanEnvelope,
    materialization_request: CoordinatorDataMaterializationRequest,
    view: DataView,
    feature_table: CoordinatorFeatureTable,
    #[serde(default = "default_owner_controller")]
    owner_controller: String,
}

#[derive(Debug, Deserialize)]
struct CoordinatorFeatureFusionArrowRequest {
    feature_set_id: String,
    sources: Vec<SourceFeatureBlock>,
    alignment: SampleAlignmentPlan,
    #[serde(default)]
    source_layout: Option<FeatureFusionSourceLayout>,
    #[serde(default)]
    policy: FeatureFusionPolicy,
}

/// C-ABI-side provider state: the modality-neutral [`InMemoryProvider`] plus a
/// borrowed pointer to a host-owned `InMemoryFittedAdapterStore`.
///
/// The provider itself is `Send + Sync`; the borrowed store pointer is read only
/// under the `Mutex` guard, so concurrent attach/detach from multiple host
/// threads never races the materialize path. The host must keep the store alive
/// while attached and clear the attachment (attach a null handle) before
/// destroying it.
struct InMemoryProviderState {
    provider: InMemoryProvider,
    fitted_adapter_store: std::sync::Mutex<*const InMemoryFittedAdapterStore>,
}

// SAFETY: the only field that is not already `Send + Sync` is the raw
// fitted-adapter store pointer, which is dereferenced only under the `Mutex`
// guard; `InMemoryFittedAdapterStore` is itself `Send + Sync`. The host
// serializes vtable calls per the C ABI contract.
unsafe impl Send for InMemoryProviderState {}
unsafe impl Sync for InMemoryProviderState {}

impl InMemoryProviderState {
    fn new(
        envelope: CoordinatorDataPlanEnvelope,
        target_tables: BTreeMap<TargetId, CoordinatorTargetTable>,
        feature_store: NumericFeatureBufferStore,
    ) -> dag_ml_data_core::Result<Self> {
        Ok(Self {
            provider: InMemoryProvider::new(envelope, target_tables, feature_store)?,
            fitted_adapter_store: std::sync::Mutex::new(std::ptr::null()),
        })
    }

    fn new_with_tensors(
        envelope: CoordinatorDataPlanEnvelope,
        target_tables: BTreeMap<TargetId, CoordinatorTargetTable>,
        feature_store: NumericFeatureBufferStore,
        nd_tensor_store: NdTensorStore,
    ) -> dag_ml_data_core::Result<Self> {
        Ok(Self {
            provider: InMemoryProvider::new_with_tensors(
                envelope,
                target_tables,
                feature_store,
                nd_tensor_store,
            )?,
            fitted_adapter_store: std::sync::Mutex::new(std::ptr::null()),
        })
    }
}

#[derive(Debug, Deserialize)]
struct CoordinatorFeatureCollationJsonRequest {
    feature_block: CoordinatorFeatureBlock,
    #[serde(default)]
    policy: CollationPolicy,
}

unsafe fn parse_target_tables(
    target_tables_ptr: *const u8,
    target_tables_len: usize,
    error_out: *mut DagMlDataString,
) -> Result<BTreeMap<TargetId, CoordinatorTargetTable>, DagMlDataStatusCode> {
    if target_tables_ptr.is_null() {
        if target_tables_len != 0 {
            // Inconsistent (null pointer, non-zero length) is a caller/ABI
            // contract violation, not a data-contract failure.
            set_error_message(
                error_out,
                "target tables pointer is null but length is non-zero",
            );
            return Err(DagMlDataStatusCode::InvalidArgument);
        }
        return Ok(BTreeMap::new());
    }
    if target_tables_len == 0 {
        return Ok(BTreeMap::new());
    }
    let json = slice::from_raw_parts(target_tables_ptr, target_tables_len);
    // Malformed JSON is an ADR-11 compatibility/serialization_error, not a data
    // contract validation error.
    let tables = serde_json::from_slice::<Vec<CoordinatorTargetTable>>(json)
        .map_err(|error| data_error_status(error_out, DataError::Serialization(error)))?;
    let mut by_target = BTreeMap::new();
    for table in tables {
        table
            .validate()
            .map_err(|error| data_error_status(error_out, error))?;
        let target_id = table.target_id.clone();
        if by_target.insert(target_id.clone(), table).is_some() {
            return Err(data_error_status(
                error_out,
                DataError::Validation(format!("duplicate target table `{target_id}`")),
            ));
        }
    }
    Ok(by_target)
}

unsafe fn parse_feature_tables(
    feature_tables_ptr: *const u8,
    feature_tables_len: usize,
    error_out: *mut DagMlDataString,
) -> Result<NumericFeatureBufferStore, DagMlDataStatusCode> {
    if feature_tables_ptr.is_null() {
        if feature_tables_len != 0 {
            set_error_message(
                error_out,
                "feature tables pointer is null but length is non-zero",
            );
            return Err(DagMlDataStatusCode::InvalidArgument);
        }
        return Ok(NumericFeatureBufferStore::default());
    }
    if feature_tables_len == 0 {
        return Ok(NumericFeatureBufferStore::default());
    }
    let json = slice::from_raw_parts(feature_tables_ptr, feature_tables_len);
    let tables = serde_json::from_slice::<Vec<CoordinatorFeatureTable>>(json)
        .map_err(|error| data_error_status(error_out, DataError::Serialization(error)))?;
    NumericFeatureBufferStore::from_feature_tables(tables)
        .map_err(|error| data_error_status(error_out, error))
}

unsafe fn parse_f64_feature_matrices(
    feature_matrices_ptr: *const u8,
    feature_matrices_len: usize,
    error_out: *mut DagMlDataString,
) -> Result<NumericFeatureBufferStore, DagMlDataStatusCode> {
    if feature_matrices_ptr.is_null() {
        if feature_matrices_len != 0 {
            set_error_message(
                error_out,
                "f64 feature matrices pointer is null but length is non-zero",
            );
            return Err(DagMlDataStatusCode::InvalidArgument);
        }
        return Ok(NumericFeatureBufferStore::default());
    }
    if feature_matrices_len == 0 {
        return Ok(NumericFeatureBufferStore::default());
    }
    let json = slice::from_raw_parts(feature_matrices_ptr, feature_matrices_len);
    let matrices = serde_json::from_slice::<Vec<NumericFeatureMatrixF64>>(json)
        .map_err(|error| data_error_status(error_out, DataError::Serialization(error)))?;
    NumericFeatureBufferStore::from_f64_matrices(matrices)
        .map_err(|error| data_error_status(error_out, error))
}

unsafe fn parse_f64_feature_matrix_views(
    feature_matrices_ptr: *const DagMlDataFeatureMatrixF64View,
    feature_matrices_len: usize,
) -> dag_ml_data_core::Result<NumericFeatureBufferStore> {
    if feature_matrices_ptr.is_null() {
        if feature_matrices_len != 0 {
            return Err(dag_ml_data_core::DataError::Validation(
                "f64 feature matrix views pointer is null".to_string(),
            ));
        }
        return Ok(NumericFeatureBufferStore::default());
    }
    if feature_matrices_len == 0 {
        return Ok(NumericFeatureBufferStore::default());
    }
    let views = slice::from_raw_parts(feature_matrices_ptr, feature_matrices_len);
    let matrices = views
        .iter()
        .enumerate()
        .map(|(idx, view)| f64_feature_matrix_view_to_core(*view, idx))
        .collect::<dag_ml_data_core::Result<Vec<_>>>()?;
    NumericFeatureBufferStore::from_f64_matrices(matrices)
}

unsafe fn parse_borrowed_tensor_views(
    views_ptr: *const DagMlDataBorrowedTensorView,
    views_len: usize,
) -> dag_ml_data_core::Result<NdTensorStore> {
    if views_ptr.is_null() {
        if views_len != 0 {
            return Err(dag_ml_data_core::DataError::Validation(
                "borrowed tensor views pointer is null".to_string(),
            ));
        }
        return Ok(NdTensorStore::default());
    }
    if views_len == 0 {
        return Ok(NdTensorStore::default());
    }
    let inputs = slice::from_raw_parts(views_ptr, views_len)
        .iter()
        .enumerate()
        .map(|(idx, view)| borrowed_tensor_view_to_input(view, idx))
        .collect::<dag_ml_data_core::Result<Vec<_>>>()?;
    NdTensorStore::from_inputs(inputs)
}

/// Converts a borrowed (possibly strided) N-D tensor view into a canonical
/// row-major [`NdTensorInput`], copying the payload. Strides must be null
/// (contiguous) or strictly positive; the gather is bounds-checked against
/// `data_len`.
unsafe fn borrowed_tensor_view_to_input(
    view: &DagMlDataBorrowedTensorView,
    index: usize,
) -> dag_ml_data_core::Result<NdTensorInput> {
    let label = format!("borrowed tensor view {index}");
    if view.abi_version != DAG_ML_DATA_BORROWED_TENSOR_VIEW_ABI_VERSION {
        return Err(dag_ml_data_core::DataError::Validation(format!(
            "{label} abi_version {} is not {DAG_ML_DATA_BORROWED_TENSOR_VIEW_ABI_VERSION}",
            view.abi_version
        )));
    }
    let tensor_id = bytes_view_to_string(view.tensor_id, &format!("{label} tensor_id"))?;
    let representation_id = RepresentationId::new(bytes_view_to_string(
        view.representation_id,
        &format!("{label} representation_id"),
    )?)?;
    let container = bytes_view_to_string(view.container, &format!("{label} container"))?;
    let dtype = DagMlDataTensorDType::from_code(view.dtype)?;
    let element_size = dtype.element_size();

    if view.rank == 0 || view.rank > dag_ml_data_core::ND_TENSOR_MAX_RANK {
        return Err(dag_ml_data_core::DataError::Validation(format!(
            "{label} rank {} is not in 1..={}",
            view.rank,
            dag_ml_data_core::ND_TENSOR_MAX_RANK
        )));
    }
    if view.shape.is_null() {
        return Err(dag_ml_data_core::DataError::Validation(format!(
            "{label} shape pointer is null"
        )));
    }
    let shape = slice::from_raw_parts(view.shape, view.rank).to_vec();
    if shape.contains(&0) {
        return Err(dag_ml_data_core::DataError::Validation(format!(
            "{label} has a zero dimension in shape {shape:?}"
        )));
    }
    if shape[0] != view.ids_len {
        return Err(dag_ml_data_core::DataError::Validation(format!(
            "{label} axis-0 size {} does not match ids_len {}",
            shape[0], view.ids_len
        )));
    }

    let observation_ids = bytes_view_array_to_strings(
        view.observation_ids,
        view.ids_len,
        &format!("{label} observation_ids"),
    )?
    .into_iter()
    .map(ObservationId::new)
    .collect::<dag_ml_data_core::Result<Vec<_>>>()?;
    let sample_ids = if view.sample_ids.is_null() {
        None
    } else {
        Some(
            bytes_view_array_to_strings(
                view.sample_ids,
                view.ids_len,
                &format!("{label} sample_ids"),
            )?
            .into_iter()
            .map(dag_ml_data_core::SampleId::new)
            .collect::<dag_ml_data_core::Result<Vec<_>>>()?,
        )
    };

    let total_elements = checked_product(&label, &shape)?;
    let canonical_bytes = total_elements.checked_mul(element_size).ok_or_else(|| {
        dag_ml_data_core::DataError::Validation(format!("{label} byte size overflows usize"))
    })?;
    let data = if view.data.is_null() {
        return Err(dag_ml_data_core::DataError::Validation(format!(
            "{label} data pointer is null"
        )));
    } else if view.strides_bytes.is_null() {
        // Contiguous row-major: the payload is already canonical. Element bytes
        // are copied verbatim and never byte-swapped, so multibyte dtypes must
        // already be little-endian per the borrowed-view contract (this is what
        // keeps the tensor fingerprint platform-independent).
        if view.data_len != canonical_bytes {
            return Err(dag_ml_data_core::DataError::Validation(format!(
                "{label} contiguous data has {} bytes for shape {shape:?} dtype {dtype:?} ({canonical_bytes} expected)",
                view.data_len
            )));
        }
        ensure_addressable(&label, canonical_bytes)?;
        slice::from_raw_parts(view.data, canonical_bytes).to_vec()
    } else {
        gather_strided_tensor(
            view,
            &label,
            &shape,
            element_size,
            total_elements,
            canonical_bytes,
        )?
    };

    let row_presence = if view.row_presence_mask.is_null() {
        if view.row_presence_len != 0 {
            return Err(dag_ml_data_core::DataError::Validation(format!(
                "{label} row presence mask pointer is null but length is {}",
                view.row_presence_len
            )));
        }
        None
    } else {
        // Validate the length against axis-0 BEFORE reading, so a too-large
        // length can never cause an out-of-bounds read.
        if view.row_presence_len != shape[0] {
            return Err(dag_ml_data_core::DataError::Validation(format!(
                "{label} row presence mask has {} flags for axis-0 size {}",
                view.row_presence_len, shape[0]
            )));
        }
        let bytes = slice::from_raw_parts(view.row_presence_mask, view.row_presence_len);
        let mut presence = Vec::with_capacity(bytes.len());
        for byte in bytes {
            if *byte > 1 {
                return Err(dag_ml_data_core::DataError::Validation(format!(
                    "{label} row presence mask contains a byte that is not 0 or 1"
                )));
            }
            presence.push(*byte == 1);
        }
        Some(presence)
    };

    Ok(NdTensorInput {
        tensor_id,
        representation_id,
        container,
        dtype,
        shape,
        observation_ids,
        sample_ids,
        data,
        row_presence,
    })
}

/// Gathers a strided borrowed tensor into canonical row-major bytes, bounds
/// checking every addressed element against `data_len`. Strides must be > 0.
unsafe fn gather_strided_tensor(
    view: &DagMlDataBorrowedTensorView,
    label: &str,
    shape: &[usize],
    element_size: usize,
    total_elements: usize,
    canonical_bytes: usize,
) -> dag_ml_data_core::Result<Vec<u8>> {
    let strides = slice::from_raw_parts(view.strides_bytes, view.rank);
    let mut strides_usize = Vec::with_capacity(view.rank);
    for stride in strides {
        if *stride <= 0 {
            return Err(dag_ml_data_core::DataError::Validation(format!(
                "{label} has a non-positive byte stride {stride} (v1 supports null or positive strides)"
            )));
        }
        strides_usize.push(*stride as usize);
    }
    // Highest addressed byte = sum (dim-1)*stride + element_size; must fit in data_len.
    let mut max_offset: usize = 0;
    for (dim, stride) in shape.iter().zip(strides_usize.iter()) {
        let span = (dim - 1).checked_mul(*stride).ok_or_else(|| {
            dag_ml_data_core::DataError::Validation(format!("{label} stride span overflows usize"))
        })?;
        max_offset = max_offset.checked_add(span).ok_or_else(|| {
            dag_ml_data_core::DataError::Validation(format!(
                "{label} stride offset overflows usize"
            ))
        })?;
    }
    let max_byte = max_offset.checked_add(element_size).ok_or_else(|| {
        dag_ml_data_core::DataError::Validation(format!("{label} addressed byte overflows usize"))
    })?;
    if view.data_len < max_byte {
        return Err(dag_ml_data_core::DataError::Validation(format!(
            "{label} strided data has {} bytes but addresses up to {max_byte}",
            view.data_len
        )));
    }
    // Slice only the proven-addressable range (never the caller-controlled
    // `data_len`, which may be exaggerated).
    ensure_addressable(label, max_byte)?;
    let data = slice::from_raw_parts(view.data, max_byte);
    let mut canonical = Vec::with_capacity(canonical_bytes);
    for flat in 0..total_elements {
        // Decompose `flat` row-major (last axis fastest) and compute the strided
        // byte offset.
        let mut remainder = flat;
        let mut offset = 0usize;
        for (dim, stride) in shape.iter().zip(strides_usize.iter()).rev() {
            let coord = remainder % dim;
            remainder /= dim;
            offset += coord * stride;
        }
        canonical.extend_from_slice(&data[offset..offset + element_size]);
    }
    Ok(canonical)
}

fn checked_product(label: &str, shape: &[usize]) -> dag_ml_data_core::Result<usize> {
    let mut product: usize = 1;
    for dim in shape {
        product = product.checked_mul(*dim).ok_or_else(|| {
            dag_ml_data_core::DataError::Validation(format!(
                "{label} shape product overflows usize"
            ))
        })?;
    }
    Ok(product)
}

/// Guards `slice::from_raw_parts` of `u8`: the length (in bytes) must not exceed
/// `isize::MAX`, which is a soundness precondition of the call.
fn ensure_addressable(label: &str, len: usize) -> dag_ml_data_core::Result<()> {
    if len > isize::MAX as usize {
        return Err(dag_ml_data_core::DataError::Validation(format!(
            "{label} byte length {len} exceeds isize::MAX"
        )));
    }
    Ok(())
}

unsafe fn f64_feature_matrix_view_to_core(
    view: DagMlDataFeatureMatrixF64View,
    index: usize,
) -> dag_ml_data_core::Result<NumericFeatureMatrixF64> {
    let feature_set_id = bytes_view_to_string(
        view.feature_set_id,
        &format!("f64 feature matrix view {index} feature_set_id"),
    )?;
    let representation = bytes_view_to_string(
        view.representation_id,
        &format!("f64 feature matrix view {index} representation_id"),
    )?;
    let representation_id = RepresentationId::new(&representation)?;
    let feature_names = bytes_view_array_to_strings(
        view.feature_names,
        view.feature_names_len,
        &format!("f64 feature matrix view {index} feature_names"),
    )?;
    let observation_ids = bytes_view_array_to_strings(
        view.observation_ids,
        view.observation_ids_len,
        &format!("f64 feature matrix view {index} observation_ids"),
    )?
    .into_iter()
    .map(|observation_id| ObservationId::new(&observation_id))
    .collect::<dag_ml_data_core::Result<Vec<_>>>()?;
    let values = f64_view_to_vec(
        view.values,
        view.values_len,
        &format!("f64 feature matrix view {index} values"),
    )?;
    let validity_mask = u8_validity_mask_to_vec(
        view.validity_mask,
        view.validity_mask_len,
        &format!("f64 feature matrix view {index} validity_mask"),
    )?;
    Ok(NumericFeatureMatrixF64 {
        feature_set_id,
        representation_id,
        feature_names,
        observation_ids,
        values,
        validity_mask,
    })
}

unsafe fn parse_f64_feature_matrix_columnar_views(
    feature_matrices_ptr: *const DagMlDataFeatureMatrixF64ColumnarView,
    feature_matrices_len: usize,
) -> dag_ml_data_core::Result<NumericFeatureBufferStore> {
    if feature_matrices_ptr.is_null() {
        if feature_matrices_len != 0 {
            return Err(dag_ml_data_core::DataError::Validation(
                "f64 columnar feature matrix views pointer is null".to_string(),
            ));
        }
        return Ok(NumericFeatureBufferStore::default());
    }
    if feature_matrices_len == 0 {
        return Ok(NumericFeatureBufferStore::default());
    }
    let views = slice::from_raw_parts(feature_matrices_ptr, feature_matrices_len);
    let matrices = views
        .iter()
        .enumerate()
        .map(|(idx, view)| f64_feature_matrix_columnar_view_to_core(*view, idx))
        .collect::<dag_ml_data_core::Result<Vec<_>>>()?;
    NumericFeatureBufferStore::from_f64_column_matrices(matrices)
}

unsafe fn f64_feature_matrix_columnar_view_to_core(
    view: DagMlDataFeatureMatrixF64ColumnarView,
    index: usize,
) -> dag_ml_data_core::Result<NumericFeatureMatrixF64Columnar> {
    let feature_set_id = bytes_view_to_string(
        view.feature_set_id,
        &format!("f64 columnar feature matrix view {index} feature_set_id"),
    )?;
    let representation = bytes_view_to_string(
        view.representation_id,
        &format!("f64 columnar feature matrix view {index} representation_id"),
    )?;
    let representation_id = RepresentationId::new(&representation)?;
    let feature_names = bytes_view_array_to_strings(
        view.feature_names,
        view.feature_names_len,
        &format!("f64 columnar feature matrix view {index} feature_names"),
    )?;
    let observation_ids = bytes_view_array_to_strings(
        view.observation_ids,
        view.observation_ids_len,
        &format!("f64 columnar feature matrix view {index} observation_ids"),
    )?
    .into_iter()
    .map(|observation_id| ObservationId::new(&observation_id))
    .collect::<dag_ml_data_core::Result<Vec<_>>>()?;
    let (columns, validity_masks) = f64_column_views_to_vecs(
        view.columns,
        view.columns_len,
        &format!("f64 columnar feature matrix view {index}"),
    )?;
    Ok(NumericFeatureMatrixF64Columnar {
        feature_set_id,
        representation_id,
        feature_names,
        observation_ids,
        columns,
        validity_masks,
    })
}

type ColumnarParseOutput = (Vec<Vec<f64>>, Option<Vec<Vec<bool>>>);

unsafe fn f64_column_views_to_vecs(
    columns_ptr: *const DagMlDataF64ColumnView,
    columns_len: usize,
    label: &str,
) -> dag_ml_data_core::Result<ColumnarParseOutput> {
    if columns_ptr.is_null() {
        if columns_len != 0 {
            return Err(dag_ml_data_core::DataError::Validation(format!(
                "{label} columns pointer is null"
            )));
        }
        return Ok((Vec::new(), None));
    }
    let column_views = slice::from_raw_parts(columns_ptr, columns_len);
    let mut columns = Vec::with_capacity(columns_len);
    let mut masks = Vec::with_capacity(columns_len);
    let mut any_mask = false;
    for (idx, column) in column_views.iter().enumerate() {
        let values = f64_view_to_vec(
            column.values,
            column.values_len,
            &format!("{label} column {idx} values"),
        )?;
        columns.push(values);
        let mask = u8_validity_mask_to_vec(
            column.validity_mask,
            column.validity_mask_len,
            &format!("{label} column {idx} validity_mask"),
        )?;
        if let Some(mask) = mask {
            any_mask = true;
            masks.push(mask);
        } else {
            masks.push(Vec::new());
        }
    }
    if any_mask {
        for (idx, (mask, column)) in masks.iter().zip(columns.iter()).enumerate() {
            if mask.is_empty() {
                return Err(dag_ml_data_core::DataError::Validation(format!(
                    "{label} column {idx} validity_mask is missing but other columns supply one; \
                     either all columns must supply a validity_mask or none"
                )));
            }
            if mask.len() != column.len() {
                return Err(dag_ml_data_core::DataError::Validation(format!(
                    "{label} column {idx} validity_mask has {} values for {} rows",
                    mask.len(),
                    column.len()
                )));
            }
        }
        Ok((columns, Some(masks)))
    } else {
        Ok((columns, None))
    }
}

unsafe fn bytes_view_to_string(
    view: DagMlDataBytesView,
    label: &str,
) -> dag_ml_data_core::Result<String> {
    if view.ptr.is_null() {
        return Err(dag_ml_data_core::DataError::Validation(format!(
            "{label} pointer is null"
        )));
    }
    let bytes = slice::from_raw_parts(view.ptr, view.len);
    std::str::from_utf8(bytes)
        .map(str::to_string)
        .map_err(|error| {
            dag_ml_data_core::DataError::Validation(format!("{label} is not valid UTF-8: {error}"))
        })
}

unsafe fn bytes_view_array_to_strings(
    ptr: *const DagMlDataBytesView,
    len: usize,
    label: &str,
) -> dag_ml_data_core::Result<Vec<String>> {
    if ptr.is_null() {
        if len != 0 {
            return Err(dag_ml_data_core::DataError::Validation(format!(
                "{label} pointer is null"
            )));
        }
        return Ok(Vec::new());
    }
    slice::from_raw_parts(ptr, len)
        .iter()
        .enumerate()
        .map(|(idx, view)| bytes_view_to_string(*view, &format!("{label}[{idx}]")))
        .collect()
}

unsafe fn f64_view_to_vec(
    ptr: *const f64,
    len: usize,
    label: &str,
) -> dag_ml_data_core::Result<Vec<f64>> {
    if ptr.is_null() {
        if len != 0 {
            return Err(dag_ml_data_core::DataError::Validation(format!(
                "{label} pointer is null"
            )));
        }
        return Ok(Vec::new());
    }
    Ok(slice::from_raw_parts(ptr, len).to_vec())
}

unsafe fn u8_validity_mask_to_vec(
    ptr: *const u8,
    len: usize,
    label: &str,
) -> dag_ml_data_core::Result<Option<Vec<bool>>> {
    if ptr.is_null() {
        if len != 0 {
            return Err(dag_ml_data_core::DataError::Validation(format!(
                "{label} pointer is null"
            )));
        }
        return Ok(None);
    }
    if len == 0 {
        return Ok(None);
    }
    slice::from_raw_parts(ptr, len)
        .iter()
        .enumerate()
        .map(|(idx, value)| match *value {
            0 => Ok(false),
            1 => Ok(true),
            _ => Err(dag_ml_data_core::DataError::Validation(format!(
                "{label}[{idx}] must be 0 or 1"
            ))),
        })
        .collect::<dag_ml_data_core::Result<Vec<_>>>()
        .map(Some)
}

fn provider_vtable(user_data: *mut c_void) -> DagMlDataVTable {
    DagMlDataVTable {
        abi_version: DAG_ML_DATA_PROVIDER_VTABLE_ABI_VERSION,
        user_data,
        materialize: Some(provider_materialize),
        make_view: Some(provider_make_view),
        view_identity: Some(provider_view_identity),
        target_arrow: Some(provider_target_arrow),
        feature_arrow: Some(provider_feature_arrow),
        release: Some(provider_release),
        destroy: Some(provider_destroy),
    }
}

fn empty_vtable() -> DagMlDataVTable {
    DagMlDataVTable {
        abi_version: DAG_ML_DATA_PROVIDER_VTABLE_ABI_VERSION,
        user_data: std::ptr::null_mut(),
        materialize: None,
        make_view: None,
        view_identity: None,
        target_arrow: None,
        feature_arrow: None,
        release: None,
        destroy: None,
    }
}

unsafe extern "C" fn provider_materialize(
    user_data: *mut c_void,
    _dataset: DagMlDataHandle,
    request_json: DagMlDataBytesView,
    out_handle: *mut DagMlDataHandle,
) -> DagMlDataStatusCode {
    if user_data.is_null() || out_handle.is_null() || request_json.ptr.is_null() {
        record_arg_error("provider materialize: user_data, out_handle or request json is null");
        return DagMlDataStatusCode::InvalidArgument;
    }
    *out_handle = 0;
    let state = &*(user_data.cast::<InMemoryProviderState>());
    let request = match serde_json::from_slice::<CoordinatorDataMaterializationRequest>(
        slice::from_raw_parts(request_json.ptr, request_json.len),
    ) {
        Ok(request) => request,
        Err(error) => {
            record_data_error(&DataError::Serialization(error));
            return DagMlDataStatusCode::ValidationError;
        }
    };
    match state.provider.materialize(&request) {
        Ok(record) => {
            *out_handle = record.handle.handle;
            DagMlDataStatusCode::Ok
        }
        Err(error) => {
            record_data_error(&error);
            DagMlDataStatusCode::ValidationError
        }
    }
}

unsafe extern "C" fn provider_make_view(
    user_data: *mut c_void,
    data: DagMlDataHandle,
    selector_json: DagMlDataBytesView,
    out_view: *mut DagMlDataHandle,
) -> DagMlDataStatusCode {
    if user_data.is_null() || out_view.is_null() || selector_json.ptr.is_null() {
        record_arg_error("provider make_view: user_data, out_view or selector json is null");
        return DagMlDataStatusCode::InvalidArgument;
    }
    *out_view = 0;
    let state = &*(user_data.cast::<InMemoryProviderState>());
    let view = match serde_json::from_slice::<DataView>(slice::from_raw_parts(
        selector_json.ptr,
        selector_json.len,
    )) {
        Ok(view) => view,
        Err(error) => {
            record_data_error(&DataError::Serialization(error));
            return DagMlDataStatusCode::ValidationError;
        }
    };
    match state.provider.make_view(data, &view) {
        Ok(record) => {
            *out_view = record.handle.handle;
            DagMlDataStatusCode::Ok
        }
        Err(error) => {
            record_data_error(&error);
            DagMlDataStatusCode::ValidationError
        }
    }
}

unsafe extern "C" fn provider_view_identity(
    user_data: *mut c_void,
    view: DagMlDataHandle,
    out_arrow_array: *mut *mut ArrowArray,
    out_arrow_schema: *mut *mut ArrowSchema,
) -> DagMlDataStatusCode {
    clear_arrow_array(out_arrow_array);
    clear_arrow_schema(out_arrow_schema);
    if user_data.is_null() || out_arrow_array.is_null() || out_arrow_schema.is_null() {
        record_arg_error("provider view_identity: user_data or arrow out pointers are null");
        return DagMlDataStatusCode::InvalidArgument;
    }
    let state = &*(user_data.cast::<InMemoryProviderState>());
    match state
        .provider
        .view_identity(view)
        .and_then(|relations| build_identity_relations_arrow(&relations))
    {
        Ok((array, schema)) => {
            *out_arrow_array = Box::into_raw(Box::new(array));
            *out_arrow_schema = Box::into_raw(Box::new(schema));
            DagMlDataStatusCode::Ok
        }
        Err(error) => {
            record_data_error(&error);
            DagMlDataStatusCode::ValidationError
        }
    }
}

unsafe extern "C" fn provider_target_arrow(
    user_data: *mut c_void,
    view: DagMlDataHandle,
    target_name: DagMlDataBytesView,
    out_arrow_array: *mut *mut ArrowArray,
    out_arrow_schema: *mut *mut ArrowSchema,
) -> DagMlDataStatusCode {
    clear_arrow_array(out_arrow_array);
    clear_arrow_schema(out_arrow_schema);
    if user_data.is_null()
        || target_name.ptr.is_null()
        || out_arrow_array.is_null()
        || out_arrow_schema.is_null()
    {
        record_arg_error(
            "provider target_arrow: user_data, target_name or arrow out pointers are null",
        );
        return DagMlDataStatusCode::InvalidArgument;
    }
    let state = &*(user_data.cast::<InMemoryProviderState>());
    let target_name =
        match std::str::from_utf8(slice::from_raw_parts(target_name.ptr, target_name.len)) {
            Ok(target_name) => target_name,
            Err(_) => {
                record_arg_error("provider target_arrow: target_name is not valid UTF-8");
                return DagMlDataStatusCode::ValidationError;
            }
        };
    let target_id = match TargetId::new(target_name) {
        Ok(target_id) => target_id,
        Err(error) => {
            record_data_error(&error);
            return DagMlDataStatusCode::ValidationError;
        }
    };
    // A valid-but-absent target id is reported by `target_block` as a semantic
    // data-validation failure, not a C ABI boundary/argument error.
    match state
        .provider
        .target_block(view, &target_id)
        .and_then(|target| build_target_arrow(&target))
    {
        Ok((array, schema)) => {
            *out_arrow_array = Box::into_raw(Box::new(array));
            *out_arrow_schema = Box::into_raw(Box::new(schema));
            DagMlDataStatusCode::Ok
        }
        Err(error) => {
            record_data_error(&error);
            DagMlDataStatusCode::ValidationError
        }
    }
}

unsafe extern "C" fn provider_feature_arrow(
    user_data: *mut c_void,
    view: DagMlDataHandle,
    feature_set_name: DagMlDataBytesView,
    out_arrow_array: *mut *mut ArrowArray,
    out_arrow_schema: *mut *mut ArrowSchema,
) -> DagMlDataStatusCode {
    clear_arrow_array(out_arrow_array);
    clear_arrow_schema(out_arrow_schema);
    if user_data.is_null()
        || feature_set_name.ptr.is_null()
        || out_arrow_array.is_null()
        || out_arrow_schema.is_null()
    {
        record_arg_error(
            "provider feature_arrow: user_data, feature_set_name or arrow out pointers are null",
        );
        return DagMlDataStatusCode::InvalidArgument;
    }
    let state = &*(user_data.cast::<InMemoryProviderState>());
    let feature_set_name = match std::str::from_utf8(slice::from_raw_parts(
        feature_set_name.ptr,
        feature_set_name.len,
    )) {
        Ok(feature_set_name) => feature_set_name,
        Err(_) => {
            record_arg_error("provider feature_arrow: feature_set_name is not valid UTF-8");
            return DagMlDataStatusCode::ValidationError;
        }
    };
    let result = if feature_set_name.trim_start().starts_with('{') {
        serde_json::from_str::<ProviderFeatureFusionSelector>(feature_set_name)
            .map_err(DataError::Serialization)
            .and_then(|selector| state.provider.feature_fusion_block(view, &selector))
            .and_then(|features| build_feature_arrow(&features))
    } else {
        if feature_set_name.trim().is_empty() {
            record_arg_error("provider feature_arrow: feature_set_name is empty");
            return DagMlDataStatusCode::ValidationError;
        }
        state
            .provider
            .feature_block(view, feature_set_name)
            .and_then(|features| build_feature_arrow(&features))
    };
    match result {
        Ok((array, schema)) => {
            *out_arrow_array = Box::into_raw(Box::new(array));
            *out_arrow_schema = Box::into_raw(Box::new(schema));
            DagMlDataStatusCode::Ok
        }
        Err(error) => {
            record_data_error(&error);
            DagMlDataStatusCode::ValidationError
        }
    }
}

unsafe extern "C" fn provider_release(user_data: *mut c_void, handle: DagMlDataHandle) {
    if user_data.is_null() {
        return;
    }
    let state = &*(user_data.cast::<InMemoryProviderState>());
    state.provider.release(handle);
}

unsafe extern "C" fn provider_destroy(user_data: *mut c_void) {
    if user_data.is_null() {
        return;
    }
    drop(Box::from_raw(user_data.cast::<InMemoryProviderState>()));
}

#[allow(dead_code)]
struct StringArrayPrivate {
    validity: Option<Vec<u8>>,
    offsets: Vec<i32>,
    values: Vec<u8>,
    buffers: Box<[*const c_void]>,
}

#[allow(dead_code)]
struct BoolArrayPrivate {
    values: Vec<u8>,
    buffers: Box<[*const c_void]>,
}

#[allow(dead_code)]
struct F64ArrayPrivate {
    validity: Option<Vec<u8>>,
    values: Vec<f64>,
    buffers: Box<[*const c_void]>,
}

struct StructArrayPrivate {
    children: Box<[*mut ArrowArray]>,
    buffers: Box<[*const c_void]>,
}

#[allow(dead_code)]
struct SchemaPrivate {
    format: CString,
    name: CString,
    metadata: Option<CString>,
    children: Box<[*mut ArrowSchema]>,
}

fn build_identity_arrow(
    envelope: &CoordinatorDataPlanEnvelope,
) -> dag_ml_data_core::Result<(ArrowArray, ArrowSchema)> {
    envelope.validate()?;
    let relations = envelope.coordinator_relations.as_ref().ok_or_else(|| {
        dag_ml_data_core::DataError::Validation(
            "coordinator identity export requires coordinator_relations".to_string(),
        )
    })?;
    build_identity_relations_arrow(relations)
}

fn build_identity_relations_arrow(
    relations: &dag_ml_data_core::CoordinatorRelationSet,
) -> dag_ml_data_core::Result<(ArrowArray, ArrowSchema)> {
    relations.validate()?;
    let records = &relations.records;
    let child_arrays = vec![
        Box::into_raw(Box::new(string_array(
            records
                .iter()
                .map(|record| Some(record.observation_id.as_str())),
        )?)),
        Box::into_raw(Box::new(string_array(
            records.iter().map(|record| Some(record.sample_id.as_str())),
        )?)),
        Box::into_raw(Box::new(string_array(records.iter().map(|record| {
            record.target_id.as_ref().map(|value| value.as_str())
        }))?)),
        Box::into_raw(Box::new(string_array(
            records
                .iter()
                .map(|record| record.group_id.as_ref().map(|value| value.as_str())),
        )?)),
        Box::into_raw(Box::new(string_array(records.iter().map(|record| {
            record.origin_sample_id.as_ref().map(|value| value.as_str())
        }))?)),
        Box::into_raw(Box::new(string_array(records.iter().map(|record| {
            record.source_id.as_ref().map(|value| value.as_str())
        }))?)),
        Box::into_raw(Box::new(bool_array(
            records.iter().map(|record| record.is_augmented),
        ))),
    ];
    let child_schemas = vec![
        Box::into_raw(Box::new(field_schema("observation_id", "u", false)?)),
        Box::into_raw(Box::new(field_schema("sample_id", "u", false)?)),
        Box::into_raw(Box::new(field_schema("target_id", "u", true)?)),
        Box::into_raw(Box::new(field_schema("group_id", "u", true)?)),
        Box::into_raw(Box::new(field_schema("origin_sample_id", "u", true)?)),
        Box::into_raw(Box::new(field_schema("source_id", "u", true)?)),
        Box::into_raw(Box::new(field_schema("is_augmented", "b", false)?)),
    ];
    Ok((
        struct_array(records.len(), child_arrays),
        struct_schema("coordinator_identity", child_schemas)?,
    ))
}

fn build_target_block(
    request: &CoordinatorTargetArrowRequest,
) -> dag_ml_data_core::Result<CoordinatorTargetBlock> {
    let arena = CoordinatorHandleArena::new(&request.owner_controller)?;
    let data = arena.materialize(&request.envelope, &request.materialization_request)?;
    let view = arena.make_view(data.handle.handle, &request.view)?;
    arena.target_values(view.handle.handle, &request.target_table)
}

fn build_multi_target_block(
    request: &CoordinatorMultiTargetArrowRequest,
) -> dag_ml_data_core::Result<CoordinatorMultiTargetBlock> {
    let arena = CoordinatorHandleArena::new(&request.owner_controller)?;
    let data = arena.materialize(&request.envelope, &request.materialization_request)?;
    let view = arena.make_view(data.handle.handle, &request.view)?;
    arena.multi_target_values(view.handle.handle, &request.target_tables)
}

fn build_feature_block(
    request: &CoordinatorFeatureArrowRequest,
) -> dag_ml_data_core::Result<CoordinatorFeatureBlock> {
    let arena = CoordinatorHandleArena::new(&request.owner_controller)?;
    let data = arena.materialize(&request.envelope, &request.materialization_request)?;
    let view = arena.make_view(data.handle.handle, &request.view)?;
    arena.feature_values(view.handle.handle, &request.feature_table)
}

fn build_target_arrow(
    target: &CoordinatorTargetBlock,
) -> dag_ml_data_core::Result<(ArrowArray, ArrowSchema)> {
    let target_ids = std::iter::repeat_n(Some(target.target_id.as_str()), target.sample_ids.len());
    let numeric_values = target
        .values
        .iter()
        .map(|value| match value {
            serde_json::Value::Null => Ok(None),
            serde_json::Value::Number(number) => number.as_f64().map(Some).ok_or_else(|| {
                dag_ml_data_core::DataError::Validation(format!(
                    "target `{}` contains a non-f64 numeric value",
                    target.target_id
                ))
            }),
            _ => Err(dag_ml_data_core::DataError::Validation(format!(
                "target `{}` Arrow smoke only supports numeric or null values",
                target.target_id
            ))),
        })
        .collect::<dag_ml_data_core::Result<Vec<_>>>()?;
    let child_arrays = vec![
        Box::into_raw(Box::new(string_array(
            target
                .sample_ids
                .iter()
                .map(|sample_id| Some(sample_id.as_str())),
        )?)),
        Box::into_raw(Box::new(string_array(target_ids)?)),
        Box::into_raw(Box::new(f64_array(numeric_values.into_iter()))),
    ];
    let child_schemas = vec![
        Box::into_raw(Box::new(field_schema("sample_id", "u", false)?)),
        Box::into_raw(Box::new(field_schema("target_id", "u", false)?)),
        Box::into_raw(Box::new(field_schema("value", "g", true)?)),
    ];
    Ok((
        struct_array(target.sample_ids.len(), child_arrays),
        struct_schema("coordinator_target", child_schemas)?,
    ))
}

fn build_multi_target_arrow(
    targets: &CoordinatorMultiTargetBlock,
) -> dag_ml_data_core::Result<(ArrowArray, ArrowSchema)> {
    if targets.values.len() != targets.target_ids.len()
        || targets.validity_masks.len() != targets.target_ids.len()
    {
        return Err(dag_ml_data_core::DataError::Validation(
            "multi-target block target/value/mask lengths differ".to_string(),
        ));
    }
    let mut child_arrays = vec![Box::into_raw(Box::new(string_array(
        targets
            .sample_ids
            .iter()
            .map(|sample_id| Some(sample_id.as_str())),
    )?))];
    let mut child_schemas = vec![Box::into_raw(Box::new(field_schema(
        "sample_id",
        "u",
        false,
    )?))];

    for (target_idx, target_id) in targets.target_ids.iter().enumerate() {
        let values = targets.values.get(target_idx).ok_or_else(|| {
            dag_ml_data_core::DataError::Validation(format!(
                "multi-target block missing values for target `{target_id}`"
            ))
        })?;
        let validity = targets.validity_masks.get(target_idx).ok_or_else(|| {
            dag_ml_data_core::DataError::Validation(format!(
                "multi-target block missing validity mask for target `{target_id}`"
            ))
        })?;
        if values.len() != targets.sample_ids.len() || validity.len() != targets.sample_ids.len() {
            return Err(dag_ml_data_core::DataError::Validation(format!(
                "multi-target block target `{target_id}` is not aligned to sample_ids"
            )));
        }
        let numeric_values = values
            .iter()
            .zip(validity.iter())
            .map(|(value, valid)| {
                if !*valid || value.is_null() {
                    return Ok(None);
                }
                match value {
                    serde_json::Value::Number(number) => {
                        number.as_f64().map(Some).ok_or_else(|| {
                            dag_ml_data_core::DataError::Validation(format!(
                                "target `{target_id}` contains a non-f64 numeric value"
                            ))
                        })
                    }
                    _ => Err(dag_ml_data_core::DataError::Validation(format!(
                        "target `{target_id}` Arrow smoke only supports numeric or null values"
                    ))),
                }
            })
            .collect::<dag_ml_data_core::Result<Vec<_>>>()?;
        child_arrays.push(Box::into_raw(Box::new(f64_array(
            numeric_values.into_iter(),
        ))));
        child_schemas.push(Box::into_raw(Box::new(field_schema(
            target_id.as_str(),
            "g",
            true,
        )?)));
    }

    Ok((
        struct_array(targets.sample_ids.len(), child_arrays),
        struct_schema("coordinator_multi_target", child_schemas)?,
    ))
}

fn build_feature_arrow(
    features: &CoordinatorFeatureBlock,
) -> dag_ml_data_core::Result<(ArrowArray, ArrowSchema)> {
    let mut child_arrays = vec![
        Box::into_raw(Box::new(string_array(
            features
                .observation_ids
                .iter()
                .map(|observation_id| Some(observation_id.as_str())),
        )?)),
        Box::into_raw(Box::new(string_array(
            features
                .sample_ids
                .iter()
                .map(|sample_id| Some(sample_id.as_str())),
        )?)),
    ];
    let mut child_schemas = vec![
        Box::into_raw(Box::new(field_schema("observation_id", "u", false)?)),
        Box::into_raw(Box::new(field_schema("sample_id", "u", false)?)),
    ];
    for (feature_idx, feature_name) in features.feature_names.iter().enumerate() {
        let numeric_values = features
            .values
            .iter()
            .map(|row| match &row[feature_idx] {
                serde_json::Value::Null => Ok(None),
                serde_json::Value::Number(number) => number.as_f64().map(Some).ok_or_else(|| {
                    dag_ml_data_core::DataError::Validation(format!(
                        "feature `{}` contains a non-f64 numeric value",
                        feature_name
                    ))
                }),
                _ => Err(dag_ml_data_core::DataError::Validation(format!(
                    "feature `{}` Arrow smoke only supports numeric or null values",
                    feature_name
                ))),
            })
            .collect::<dag_ml_data_core::Result<Vec<_>>>()?;
        child_arrays.push(Box::into_raw(Box::new(f64_array(
            numeric_values.into_iter(),
        ))));
        child_schemas.push(Box::into_raw(Box::new(field_schema(
            feature_name,
            "g",
            true,
        )?)));
    }
    Ok((
        struct_array(features.observation_ids.len(), child_arrays),
        struct_schema("coordinator_features", child_schemas)?,
    ))
}

fn string_array<'a>(
    values: impl Iterator<Item = Option<&'a str>>,
) -> dag_ml_data_core::Result<ArrowArray> {
    let values = values.collect::<Vec<_>>();
    let mut validity = Vec::new();
    let mut offsets = Vec::with_capacity(values.len() + 1);
    let mut data = Vec::new();
    offsets.push(0);
    let mut null_count = 0i64;
    for (idx, value) in values.iter().enumerate() {
        if let Some(value) = value {
            set_bitmap(&mut validity, idx, true);
            data.extend_from_slice(value.as_bytes());
        } else {
            set_bitmap(&mut validity, idx, false);
            null_count += 1;
        }
        let offset = i32::try_from(data.len()).map_err(|_| {
            dag_ml_data_core::DataError::Validation(
                "identity Arrow UTF-8 payload exceeds i32 offsets".to_string(),
            )
        })?;
        offsets.push(offset);
    }
    let validity = (null_count > 0).then_some(validity);
    let buffers = vec![
        validity
            .as_ref()
            .map(|buffer| buffer.as_ptr().cast::<c_void>())
            .unwrap_or(std::ptr::null()),
        offsets.as_ptr().cast::<c_void>(),
        data.as_ptr().cast::<c_void>(),
    ]
    .into_boxed_slice();
    let private = Box::new(StringArrayPrivate {
        validity,
        offsets,
        values: data,
        buffers,
    });
    let buffers = private.buffers.as_ptr() as *mut *const c_void;
    Ok(ArrowArray {
        length: values.len() as i64,
        null_count,
        offset: 0,
        n_buffers: 3,
        n_children: 0,
        buffers,
        children: std::ptr::null_mut(),
        dictionary: std::ptr::null_mut(),
        release: Some(release_string_array),
        private_data: Box::into_raw(private).cast::<c_void>(),
    })
}

fn f64_array(values: impl Iterator<Item = Option<f64>>) -> ArrowArray {
    let values = values.collect::<Vec<_>>();
    let mut validity = Vec::new();
    let mut data = Vec::with_capacity(values.len());
    let mut null_count = 0i64;
    for (idx, value) in values.iter().enumerate() {
        if let Some(value) = value {
            set_bitmap(&mut validity, idx, true);
            data.push(*value);
        } else {
            set_bitmap(&mut validity, idx, false);
            data.push(0.0);
            null_count += 1;
        }
    }
    let validity = (null_count > 0).then_some(validity);
    let buffers = vec![
        validity
            .as_ref()
            .map(|buffer| buffer.as_ptr().cast::<c_void>())
            .unwrap_or(std::ptr::null()),
        data.as_ptr().cast::<c_void>(),
    ]
    .into_boxed_slice();
    let private = Box::new(F64ArrayPrivate {
        validity,
        values: data,
        buffers,
    });
    let buffers = private.buffers.as_ptr() as *mut *const c_void;
    ArrowArray {
        length: values.len() as i64,
        null_count,
        offset: 0,
        n_buffers: 2,
        n_children: 0,
        buffers,
        children: std::ptr::null_mut(),
        dictionary: std::ptr::null_mut(),
        release: Some(release_f64_array),
        private_data: Box::into_raw(private).cast::<c_void>(),
    }
}

fn bool_array(values: impl Iterator<Item = bool>) -> ArrowArray {
    let values = values.collect::<Vec<_>>();
    let mut bitmap = Vec::new();
    for (idx, value) in values.iter().enumerate() {
        set_bitmap(&mut bitmap, idx, *value);
    }
    let buffers = vec![std::ptr::null(), bitmap.as_ptr().cast::<c_void>()].into_boxed_slice();
    let private = Box::new(BoolArrayPrivate {
        values: bitmap,
        buffers,
    });
    let buffers = private.buffers.as_ptr() as *mut *const c_void;
    ArrowArray {
        length: values.len() as i64,
        null_count: 0,
        offset: 0,
        n_buffers: 2,
        n_children: 0,
        buffers,
        children: std::ptr::null_mut(),
        dictionary: std::ptr::null_mut(),
        release: Some(release_bool_array),
        private_data: Box::into_raw(private).cast::<c_void>(),
    }
}

fn struct_array(length: usize, children: Vec<*mut ArrowArray>) -> ArrowArray {
    let child_count = children.len() as i64;
    let children = children.into_boxed_slice();
    let buffers = vec![std::ptr::null()].into_boxed_slice();
    let private = Box::new(StructArrayPrivate { children, buffers });
    let children = private.children.as_ptr() as *mut *mut ArrowArray;
    let buffers = private.buffers.as_ptr() as *mut *const c_void;
    ArrowArray {
        length: length as i64,
        null_count: 0,
        offset: 0,
        n_buffers: 1,
        n_children: child_count,
        buffers,
        children,
        dictionary: std::ptr::null_mut(),
        release: Some(release_struct_array),
        private_data: Box::into_raw(private).cast::<c_void>(),
    }
}

fn field_schema(name: &str, format: &str, nullable: bool) -> dag_ml_data_core::Result<ArrowSchema> {
    schema(name, format, nullable, Vec::new())
}

fn struct_schema(
    name: &str,
    children: Vec<*mut ArrowSchema>,
) -> dag_ml_data_core::Result<ArrowSchema> {
    schema(name, "+s", false, children)
}

fn schema(
    name: &str,
    format: &str,
    nullable: bool,
    children: Vec<*mut ArrowSchema>,
) -> dag_ml_data_core::Result<ArrowSchema> {
    let format = CString::new(format).map_err(|_| {
        dag_ml_data_core::DataError::Validation("Arrow schema format contains nul".to_string())
    })?;
    let name = CString::new(name).map_err(|_| {
        dag_ml_data_core::DataError::Validation("Arrow schema name contains nul".to_string())
    })?;
    let child_count = children.len() as i64;
    let private = Box::new(SchemaPrivate {
        format,
        name,
        metadata: None,
        children: children.into_boxed_slice(),
    });
    let schema = ArrowSchema {
        format: private.format.as_ptr(),
        name: private.name.as_ptr(),
        metadata: std::ptr::null(),
        flags: if nullable { 1 } else { 0 },
        n_children: child_count,
        children: private.children.as_ptr() as *mut *mut ArrowSchema,
        dictionary: std::ptr::null_mut(),
        release: Some(release_schema),
        private_data: Box::into_raw(private).cast::<c_void>(),
    };
    Ok(schema)
}

fn set_bitmap(bitmap: &mut Vec<u8>, idx: usize, value: bool) {
    let byte_idx = idx / 8;
    if bitmap.len() <= byte_idx {
        bitmap.resize(byte_idx + 1, 0);
    }
    if value {
        bitmap[byte_idx] |= 1 << (idx % 8);
    }
}

unsafe extern "C" fn release_string_array(array: *mut ArrowArray) {
    if array.is_null() || (*array).release.is_none() {
        return;
    }
    (*array).release = None;
    if !(*array).private_data.is_null() {
        let private = Box::from_raw((*array).private_data.cast::<StringArrayPrivate>());
        drop(private);
    }
    (*array).private_data = std::ptr::null_mut();
    (*array).buffers = std::ptr::null_mut();
}

unsafe extern "C" fn release_bool_array(array: *mut ArrowArray) {
    if array.is_null() || (*array).release.is_none() {
        return;
    }
    (*array).release = None;
    if !(*array).private_data.is_null() {
        let private = Box::from_raw((*array).private_data.cast::<BoolArrayPrivate>());
        drop(private);
    }
    (*array).private_data = std::ptr::null_mut();
    (*array).buffers = std::ptr::null_mut();
}

unsafe extern "C" fn release_f64_array(array: *mut ArrowArray) {
    if array.is_null() || (*array).release.is_none() {
        return;
    }
    (*array).release = None;
    if !(*array).private_data.is_null() {
        let private = Box::from_raw((*array).private_data.cast::<F64ArrayPrivate>());
        drop(private);
    }
    (*array).private_data = std::ptr::null_mut();
    (*array).buffers = std::ptr::null_mut();
}

unsafe extern "C" fn release_struct_array(array: *mut ArrowArray) {
    if array.is_null() || (*array).release.is_none() {
        return;
    }
    (*array).release = None;
    if !(*array).private_data.is_null() {
        let private = Box::from_raw((*array).private_data.cast::<StructArrayPrivate>());
        for child in private.children.iter().copied() {
            if !child.is_null() {
                if let Some(release) = (*child).release {
                    release(child);
                }
                drop(Box::from_raw(child));
            }
        }
        drop(private);
    }
    (*array).private_data = std::ptr::null_mut();
    (*array).buffers = std::ptr::null_mut();
    (*array).children = std::ptr::null_mut();
}

unsafe extern "C" fn release_schema(schema: *mut ArrowSchema) {
    if schema.is_null() || (*schema).release.is_none() {
        return;
    }
    (*schema).release = None;
    if !(*schema).private_data.is_null() {
        let private = Box::from_raw((*schema).private_data.cast::<SchemaPrivate>());
        for child in private.children.iter().copied() {
            if !child.is_null() {
                if let Some(release) = (*child).release {
                    release(child);
                }
                drop(Box::from_raw(child));
            }
        }
        drop(private);
    }
    (*schema).private_data = std::ptr::null_mut();
    (*schema).format = std::ptr::null();
    (*schema).name = std::ptr::null();
    (*schema).metadata = std::ptr::null();
    (*schema).children = std::ptr::null_mut();
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::ffi::CStr;

    #[test]
    fn fingerprints_schema_json_over_abi() {
        let schema = include_bytes!("../../../examples/minimal_schema.json");
        let mut fingerprint = DagMlDataString::default();
        let mut error = DagMlDataString::default();

        let status = unsafe {
            dagmldata_schema_fingerprint_json(
                schema.as_ptr(),
                schema.len(),
                &mut fingerprint,
                &mut error,
            )
        };

        assert_eq!(status, DagMlDataStatusCode::Ok);
        assert!(!fingerprint.ptr.is_null());
        assert!(error.ptr.is_null());

        unsafe {
            dagmldata_string_free(fingerprint);
        }
    }

    #[test]
    fn schema_fingerprint_abi_validates_nirs4all_core_contract_fields() {
        let schema = include_bytes!(
            "../../../examples/fixtures/oof_campaign/schema_nirs4all_core_contract.json"
        );
        let mut fingerprint = DagMlDataString::default();
        let mut error = DagMlDataString::default();

        let status = unsafe {
            dagmldata_schema_fingerprint_json(
                schema.as_ptr(),
                schema.len(),
                &mut fingerprint,
                &mut error,
            )
        };

        assert_eq!(status, DagMlDataStatusCode::Ok);
        assert!(!fingerprint.ptr.is_null());
        assert!(error.ptr.is_null());
        unsafe {
            dagmldata_string_free(fingerprint);
        }

        let mut invalid: serde_json::Value = serde_json::from_slice(schema).unwrap();
        invalid["sources"][0]["shape_contract"]["axis_sizes"]["wavelength"]["exact"] =
            serde_json::json!(999);
        let invalid = serde_json::to_vec(&invalid).unwrap();
        let mut fingerprint = DagMlDataString::default();
        let mut error = DagMlDataString::default();
        let status = unsafe {
            dagmldata_schema_fingerprint_json(
                invalid.as_ptr(),
                invalid.len(),
                &mut fingerprint,
                &mut error,
            )
        };

        assert_eq!(status, DagMlDataStatusCode::ValidationError);
        assert!(fingerprint.ptr.is_null());
        assert!(!error.ptr.is_null());
        let message = unsafe { CStr::from_ptr(error.ptr.cast()) }
            .to_str()
            .unwrap()
            .to_string();
        assert!(message.contains("shape contract"));
        unsafe {
            dagmldata_string_free(error);
        }
    }

    #[test]
    fn last_error_accessors_expose_structured_taxonomy() {
        // Malformed JSON -> compatibility (8) / serialization_error (1) -> 0x0008_0001.
        let malformed = b"{";
        let mut fingerprint = DagMlDataString::default();
        let mut error = DagMlDataString::default();
        let status = unsafe {
            dagmldata_schema_fingerprint_json(
                malformed.as_ptr(),
                malformed.len(),
                &mut fingerprint,
                &mut error,
            )
        };
        assert_eq!(status, DagMlDataStatusCode::ValidationError);
        assert_eq!(dagmldata_last_error_code(), 0x0008_0001);

        let mut last = DagMlDataString::default();
        let last_status = unsafe { dagmldata_last_error_json(&mut last) };
        assert_eq!(last_status, DagMlDataStatusCode::Ok);
        assert!(!last.ptr.is_null());
        let json = unsafe { CStr::from_ptr(last.ptr.cast()) }
            .to_str()
            .unwrap()
            .to_string();
        let descriptor: serde_json::Value =
            serde_json::from_str(&json).expect("last error descriptor json");
        assert_eq!(descriptor["category"], "compatibility");
        assert_eq!(descriptor["code"], "serialization_error");
        unsafe {
            dagmldata_string_free(error);
            dagmldata_string_free(last);
        }
    }

    #[test]
    fn last_error_records_boundary_argument_errors() {
        // A null-pointer (InvalidArgument) failure must still update the
        // thread-local so it is never stale relative to the returned error.
        let mut fingerprint = DagMlDataString::default();
        let mut error = DagMlDataString::default();
        let status = unsafe {
            dagmldata_schema_fingerprint_json(std::ptr::null(), 0, &mut fingerprint, &mut error)
        };
        assert_eq!(status, DagMlDataStatusCode::InvalidArgument);
        assert_eq!(dagmldata_last_error_code(), C_ABI_ARGUMENT_ERROR_CODE);

        let mut last = DagMlDataString::default();
        let last_status = unsafe { dagmldata_last_error_json(&mut last) };
        assert_eq!(last_status, DagMlDataStatusCode::Ok);
        let json = unsafe { CStr::from_ptr(last.ptr.cast()) }
            .to_str()
            .unwrap()
            .to_string();
        let descriptor: serde_json::Value =
            serde_json::from_str(&json).expect("boundary descriptor json");
        assert_eq!(descriptor["category"], "validation");
        assert_eq!(descriptor["code"], "c_abi_argument");
        unsafe {
            dagmldata_string_free(error);
            dagmldata_string_free(last);
        }
    }

    #[test]
    fn validates_fold_set_json_over_abi() {
        let fold_set = br#"{
  "id": "cv.repetition.safe",
  "sample_ids": ["S001", "S002"],
  "folds": [
    {
      "fold_id": "fold:0",
      "train_sample_ids": ["S002"],
      "validation_sample_ids": ["S001"]
    },
    {
      "fold_id": "fold:1",
      "train_sample_ids": ["S001"],
      "validation_sample_ids": ["S002"]
    }
  ]
}"#;
        let mut error = DagMlDataString::default();
        let status = unsafe {
            dagmldata_fold_set_validate_json(fold_set.as_ptr(), fold_set.len(), &mut error)
        };

        assert_eq!(status, DagMlDataStatusCode::Ok);
        assert!(error.ptr.is_null());

        let mut fingerprint = DagMlDataString::default();
        let mut error = DagMlDataString::default();
        let status = unsafe {
            dagmldata_fold_set_fingerprint_json(
                fold_set.as_ptr(),
                fold_set.len(),
                &mut fingerprint,
                &mut error,
            )
        };

        assert_eq!(status, DagMlDataStatusCode::Ok);
        let fingerprint = unsafe { string_value(fingerprint) };
        assert_eq!(fingerprint.len(), 64);
        assert!(error.ptr.is_null());

        let mut invalid: serde_json::Value = serde_json::from_slice(fold_set).unwrap();
        invalid["folds"][0]["validation_sample_ids"] = serde_json::json!(["S001", "S002"]);
        let invalid = serde_json::to_vec(&invalid).unwrap();
        let mut error = DagMlDataString::default();
        let status = unsafe {
            dagmldata_fold_set_validate_json(invalid.as_ptr(), invalid.len(), &mut error)
        };

        assert_eq!(status, DagMlDataStatusCode::ValidationError);
        let message = unsafe { string_value(error) };
        assert!(
            message.contains("train/validation overlap"),
            "unexpected: {message}"
        );
    }

    #[test]
    fn validates_aggregation_policy_json_over_abi() {
        // valid: robust_mean with an in-range trim_fraction
        let ok = br#"{"reducer":"robust_mean","trim_fraction":0.1}"#;
        let mut error = DagMlDataString::default();
        let status = unsafe {
            dagmldata_aggregation_policy_validate_json(ok.as_ptr(), ok.len(), &mut error)
        };
        assert_eq!(status, DagMlDataStatusCode::Ok);
        assert!(error.ptr.is_null());

        // unknown key is rejected at the boundary
        let unknown = br#"{"reducer":"mean","skipna":false}"#;
        let mut error = DagMlDataString::default();
        let status = unsafe {
            dagmldata_aggregation_policy_validate_json(unknown.as_ptr(), unknown.len(), &mut error)
        };
        assert_eq!(status, DagMlDataStatusCode::ValidationError);
        // string_value takes ownership and frees the error string.
        let message = unsafe { string_value(error) };
        assert!(!message.is_empty());

        // cross-parameter contamination is refused (mean takes no params)
        let contaminated = br#"{"reducer":"mean","trim_fraction":0.1}"#;
        let mut error = DagMlDataString::default();
        let status = unsafe {
            dagmldata_aggregation_policy_validate_json(
                contaminated.as_ptr(),
                contaminated.len(),
                &mut error,
            )
        };
        assert_eq!(status, DagMlDataStatusCode::ValidationError);
        let message = unsafe { string_value(error) };
        assert!(
            message.contains("does not accept parameter"),
            "unexpected: {message}"
        );
    }

    #[test]
    fn fold_set_abi_rejects_relation_group_leakage() {
        let fold_set = br#"{
  "id": "cv.repetition.safe",
  "sample_ids": ["S001", "S002"],
  "folds": [
    {
      "fold_id": "fold:0",
      "train_sample_ids": ["S002"],
      "validation_sample_ids": ["S001"]
    },
    {
      "fold_id": "fold:1",
      "train_sample_ids": ["S001"],
      "validation_sample_ids": ["S002"]
    }
  ]
}"#;
        let relations = include_bytes!(
            "../../../examples/fixtures/oof_campaign/sample_relations_grouped_augmented.json"
        );
        let mut error = DagMlDataString::default();
        let status = unsafe {
            dagmldata_fold_set_validate_against_relations_json(
                fold_set.as_ptr(),
                fold_set.len(),
                relations.as_ptr(),
                relations.len(),
                &mut error,
            )
        };

        assert_eq!(status, DagMlDataStatusCode::Ok);
        assert!(error.ptr.is_null());

        let mut leaking_relations: serde_json::Value = serde_json::from_slice(relations).unwrap();
        for row in leaking_relations["rows"].as_array_mut().unwrap() {
            if row["sample_id"] == "S002" {
                row["group_id"] = serde_json::json!("plant.A");
            }
        }
        let leaking_relations = serde_json::to_vec(&leaking_relations).unwrap();
        let mut error = DagMlDataString::default();
        let status = unsafe {
            dagmldata_fold_set_validate_against_relations_json(
                fold_set.as_ptr(),
                fold_set.len(),
                leaking_relations.as_ptr(),
                leaking_relations.len(),
                &mut error,
            )
        };

        assert_eq!(status, DagMlDataStatusCode::ValidationError);
        let message = unsafe { string_value(error) };
        assert!(message.contains("leaks group"), "unexpected: {message}");
    }

    #[test]
    fn validates_fitted_adapter_ref_through_abi() {
        let payload = br#"{
  "schema_version": 1,
  "adapter_id": "snv",
  "adapter_version": "1.0.0",
  "params_fingerprint": "12121212121212121212121212121212121212121212121212121212121212ab"
}"#;
        let mut error = DagMlDataString::default();
        let status = unsafe {
            dagmldata_fitted_adapter_ref_validate_json(
                payload.as_ptr(),
                payload.len(),
                0,
                &mut error,
            )
        };
        assert_eq!(status, DagMlDataStatusCode::Ok);
        assert!(error.ptr.is_null());

        let mut portable_error = DagMlDataString::default();
        let status = unsafe {
            dagmldata_fitted_adapter_ref_validate_json(
                payload.as_ptr(),
                payload.len(),
                1,
                &mut portable_error,
            )
        };
        assert_eq!(status, DagMlDataStatusCode::ValidationError);
        let message = unsafe { string_value(portable_error) };
        assert!(message.contains("is not portable"), "unexpected: {message}");
    }

    #[test]
    fn fitted_adapter_store_register_materialize_release_round_trips_through_abi() {
        let mut store = DagMlDataFittedAdapterStoreHandle::default();
        let status = unsafe { dagmldata_inmemory_fitted_adapter_store_new(&mut store) };
        assert_eq!(status, DagMlDataStatusCode::Ok);
        assert!(!store.ptr.is_null());

        let ref_payload = br#"{
  "schema_version": 1,
  "adapter_id": "snv",
  "adapter_version": "1.0.0",
  "params_fingerprint": "12121212121212121212121212121212121212121212121212121212121212ab"
}"#;
        let mut register_handle: u64 = 0;
        let mut error = DagMlDataString::default();
        let status = unsafe {
            dagmldata_inmemory_fitted_adapter_store_register_json(
                store,
                ref_payload.as_ptr(),
                ref_payload.len(),
                &mut register_handle,
                &mut error,
            )
        };
        assert_eq!(status, DagMlDataStatusCode::Ok);
        assert!(error.ptr.is_null());
        assert_eq!(register_handle, 1);

        let request_payload = br#"{
  "adapter_id": "snv",
  "params_fingerprint": "12121212121212121212121212121212121212121212121212121212121212ab"
}"#;
        let mut materialize_handle: u64 = 0;
        let mut materialize_error = DagMlDataString::default();
        let status = unsafe {
            dagmldata_inmemory_fitted_adapter_store_materialize_json(
                store,
                request_payload.as_ptr(),
                request_payload.len(),
                &mut materialize_handle,
                &mut materialize_error,
            )
        };
        assert_eq!(status, DagMlDataStatusCode::Ok);
        assert!(materialize_error.ptr.is_null());
        assert_eq!(materialize_handle, register_handle);

        let bad_request = br#"{
  "adapter_id": "snv",
  "params_fingerprint": "5555555555555555555555555555555555555555555555555555555555555555"
}"#;
        let mut bad_handle: u64 = 0;
        let mut bad_error = DagMlDataString::default();
        let status = unsafe {
            dagmldata_inmemory_fitted_adapter_store_materialize_json(
                store,
                bad_request.as_ptr(),
                bad_request.len(),
                &mut bad_handle,
                &mut bad_error,
            )
        };
        assert_eq!(status, DagMlDataStatusCode::ValidationError);
        let message = unsafe { string_value(bad_error) };
        assert!(
            message.contains("params fingerprint mismatch"),
            "unexpected: {message}"
        );

        let mut released: u8 = 0;
        let status = unsafe {
            dagmldata_inmemory_fitted_adapter_store_release(
                store,
                b"snv".as_ptr(),
                3,
                &mut released,
            )
        };
        assert_eq!(status, DagMlDataStatusCode::Ok);
        assert_eq!(released, 1);

        unsafe { dagmldata_inmemory_fitted_adapter_store_destroy(store) };
    }

    #[test]
    fn provider_attached_fitted_adapter_store_materializes_handles() {
        let envelope = include_bytes!(
            "../../../examples/fixtures/oof_campaign/coordinator_data_plan_envelope_nir.json"
        );
        let mut provider_vtable = empty_vtable();
        let mut error = DagMlDataString::default();
        let status = unsafe {
            dagmldata_inmemory_provider_new_json(
                envelope.as_ptr(),
                envelope.len(),
                b"[]".as_ptr(),
                2,
                &mut provider_vtable,
                &mut error,
            )
        };
        assert_eq!(status, DagMlDataStatusCode::Ok);

        let mut store = DagMlDataFittedAdapterStoreHandle::default();
        let status = unsafe { dagmldata_inmemory_fitted_adapter_store_new(&mut store) };
        assert_eq!(status, DagMlDataStatusCode::Ok);
        assert!(!store.ptr.is_null());

        let ref_payload = br#"{
  "schema_version": 1,
  "adapter_id": "snv",
  "adapter_version": "1.0.0",
  "params_fingerprint": "12121212121212121212121212121212121212121212121212121212121212ab"
}"#;
        let mut adapter_handle: u64 = 0;
        let status = unsafe {
            dagmldata_inmemory_fitted_adapter_store_register_json(
                store,
                ref_payload.as_ptr(),
                ref_payload.len(),
                &mut adapter_handle,
                &mut error,
            )
        };
        assert_eq!(status, DagMlDataStatusCode::Ok);
        assert_eq!(adapter_handle, 1);

        // Materializing through the provider BEFORE attaching the store is rejected.
        let request_payload = br#"{
  "adapter_id": "snv",
  "params_fingerprint": "12121212121212121212121212121212121212121212121212121212121212ab"
}"#;
        let mut materialize_handle: u64 = 0;
        let status = unsafe {
            dagmldata_inmemory_provider_materialize_fitted_adapter_json(
                &provider_vtable,
                request_payload.as_ptr(),
                request_payload.len(),
                &mut materialize_handle,
                &mut error,
            )
        };
        assert_eq!(status, DagMlDataStatusCode::InvalidArgument);
        let message = unsafe { string_value(error) };
        assert!(
            message.contains("no fitted-adapter store attached"),
            "unexpected: {message}"
        );

        // Attach the store, then materialize through the provider succeeds.
        let mut attach_error = DagMlDataString::default();
        let status = unsafe {
            dagmldata_inmemory_provider_attach_fitted_adapter_store(
                &provider_vtable,
                store,
                &mut attach_error,
            )
        };
        assert_eq!(status, DagMlDataStatusCode::Ok);
        assert!(attach_error.ptr.is_null());

        let mut materialize_error = DagMlDataString::default();
        let status = unsafe {
            dagmldata_inmemory_provider_materialize_fitted_adapter_json(
                &provider_vtable,
                request_payload.as_ptr(),
                request_payload.len(),
                &mut materialize_handle,
                &mut materialize_error,
            )
        };
        assert_eq!(status, DagMlDataStatusCode::Ok);
        assert_eq!(materialize_handle, 1);
        assert!(materialize_error.ptr.is_null());

        // Detach by passing a null handle.
        let null_handle = DagMlDataFittedAdapterStoreHandle::default();
        let mut detach_error = DagMlDataString::default();
        let status = unsafe {
            dagmldata_inmemory_provider_attach_fitted_adapter_store(
                &provider_vtable,
                null_handle,
                &mut detach_error,
            )
        };
        assert_eq!(status, DagMlDataStatusCode::Ok);

        let mut detached_error = DagMlDataString::default();
        let status = unsafe {
            dagmldata_inmemory_provider_materialize_fitted_adapter_json(
                &provider_vtable,
                request_payload.as_ptr(),
                request_payload.len(),
                &mut materialize_handle,
                &mut detached_error,
            )
        };
        assert_eq!(status, DagMlDataStatusCode::InvalidArgument);
        let detached_message = unsafe { string_value(detached_error) };
        assert!(detached_message.contains("no fitted-adapter store attached"));

        unsafe {
            dagmldata_inmemory_fitted_adapter_store_destroy(store);
            dagmldata_inmemory_provider_destroy(&mut provider_vtable);
        }
    }

    #[test]
    fn rejects_bad_fitted_adapter_manifest_through_abi() {
        let payload = br#"{
  "schema_version": 1,
  "entries": [
    {
      "adapter_id": "snv",
      "fitted_adapter": {
        "schema_version": 1,
        "adapter_id": "snv",
        "adapter_version": "1.0.0",
        "params_fingerprint": "bad"
      }
    }
  ]
}"#;
        let mut error = DagMlDataString::default();
        let status = unsafe {
            dagmldata_fitted_adapter_manifest_validate_json(
                payload.as_ptr(),
                payload.len(),
                0,
                &mut error,
            )
        };
        assert_eq!(status, DagMlDataStatusCode::ValidationError);
        let message = unsafe { string_value(error) };
        assert!(
            message.contains("params fingerprint"),
            "unexpected: {message}"
        );
    }

    #[test]
    fn exports_coordinator_identity_arrow_over_abi() {
        let envelope = include_bytes!(
            "../../../examples/fixtures/oof_campaign/coordinator_data_plan_envelope_nir.json"
        );
        let mut array = std::ptr::null_mut();
        let mut schema = std::ptr::null_mut();
        let mut error = DagMlDataString::default();

        let status = unsafe {
            dagmldata_coordinator_identity_arrow_json(
                envelope.as_ptr(),
                envelope.len(),
                &mut array,
                &mut schema,
                &mut error,
            )
        };

        assert_eq!(status, DagMlDataStatusCode::Ok);
        assert!(error.ptr.is_null());
        assert!(!array.is_null());
        assert!(!schema.is_null());
        unsafe {
            assert_eq!((*array).length, 4);
            assert_eq!((*array).n_children, 7);
            assert_eq!((*schema).n_children, 7);
            assert_eq!(CStr::from_ptr((*schema).format).to_str().unwrap(), "+s");
            let schema_children =
                slice::from_raw_parts((*schema).children, (*schema).n_children as usize);
            let array_children =
                slice::from_raw_parts((*array).children, (*array).n_children as usize);
            let first_child = schema_children[0];
            assert_eq!(
                CStr::from_ptr((*first_child).name).to_str().unwrap(),
                "observation_id"
            );
            assert_eq!(CStr::from_ptr((*first_child).format).to_str().unwrap(), "u");
            assert_eq!(
                utf8_values(array_children[0]),
                vec![
                    Some("obs.S001.aug0".to_string()),
                    Some("obs.S001.base".to_string()),
                    Some("obs.S001.rep1".to_string()),
                    Some("obs.S002.base".to_string()),
                ]
            );
            assert_eq!(
                utf8_values(array_children[4]),
                vec![Some("S001".to_string()), None, None, None]
            );
            assert_eq!(
                bool_values(array_children[6]),
                vec![true, false, false, false]
            );
            dagmldata_arrow_array_free(array);
            dagmldata_arrow_schema_free(schema);
        }
    }

    #[test]
    fn exports_coordinator_target_arrow_over_abi() {
        let envelope: serde_json::Value = serde_json::from_slice(include_bytes!(
            "../../../examples/fixtures/oof_campaign/coordinator_data_plan_envelope_nir.json"
        ))
        .unwrap();
        let materialization_request: serde_json::Value = serde_json::from_slice(include_bytes!(
            "../../../examples/fixtures/oof_campaign/materialization_request_model_base_x.json"
        ))
        .unwrap();
        let request = serde_json::json!({
            "envelope": envelope,
            "materialization_request": materialization_request,
            "view": {
                "sample_ids": ["S001"],
                "include_augmented": false
            },
            "target_table": {
                "target_id": "y",
                "values": [
                    {"sample_id": "S001", "value": 42.0},
                    {"sample_id": "S002", "value": 7.0}
                ]
            }
        });
        let request = serde_json::to_vec(&request).unwrap();
        let mut array = std::ptr::null_mut();
        let mut schema = std::ptr::null_mut();
        let mut error = DagMlDataString::default();

        let status = unsafe {
            dagmldata_coordinator_target_arrow_json(
                request.as_ptr(),
                request.len(),
                &mut array,
                &mut schema,
                &mut error,
            )
        };

        assert_eq!(status, DagMlDataStatusCode::Ok);
        assert!(error.ptr.is_null());
        unsafe {
            assert_eq!((*array).length, 1);
            assert_eq!((*array).n_children, 3);
            assert_eq!(CStr::from_ptr((*schema).format).to_str().unwrap(), "+s");
            let array_children =
                slice::from_raw_parts((*array).children, (*array).n_children as usize);
            assert_eq!(
                utf8_values(array_children[0]),
                vec![Some("S001".to_string())]
            );
            assert_eq!(f64_values(array_children[2]), vec![Some(42.0)]);
            dagmldata_arrow_array_free(array);
            dagmldata_arrow_schema_free(schema);
        }
    }

    #[test]
    fn exports_coordinator_multi_target_arrow_over_abi() {
        let envelope: serde_json::Value = serde_json::from_slice(include_bytes!(
            "../../../examples/fixtures/oof_campaign/coordinator_data_plan_envelope_nir.json"
        ))
        .unwrap();
        let materialization_request: serde_json::Value = serde_json::from_slice(include_bytes!(
            "../../../examples/fixtures/oof_campaign/materialization_request_model_base_x.json"
        ))
        .unwrap();
        let request = serde_json::json!({
            "envelope": envelope,
            "materialization_request": materialization_request,
            "view": {
                "sample_ids": ["S002", "S001"],
                "include_augmented": false
            },
            "target_tables": [
                {
                    "target_id": "y",
                    "values": [
                        {"sample_id": "S001", "value": 42.0},
                        {"sample_id": "S002", "value": 7.0}
                    ]
                },
                {
                    "target_id": "protein",
                    "values": [
                        {"sample_id": "S001", "value": 12.5}
                    ]
                }
            ]
        });
        let request = serde_json::to_vec(&request).unwrap();
        let mut array = std::ptr::null_mut();
        let mut schema = std::ptr::null_mut();
        let mut error = DagMlDataString::default();

        let status = unsafe {
            dagmldata_coordinator_multi_target_arrow_json(
                request.as_ptr(),
                request.len(),
                &mut array,
                &mut schema,
                &mut error,
            )
        };

        assert_eq!(status, DagMlDataStatusCode::Ok);
        assert!(error.ptr.is_null());
        unsafe {
            assert_eq!((*array).length, 2);
            assert_eq!((*array).n_children, 3);
            assert_eq!(CStr::from_ptr((*schema).format).to_str().unwrap(), "+s");
            let array_children =
                slice::from_raw_parts((*array).children, (*array).n_children as usize);
            assert_eq!(
                utf8_values(array_children[0]),
                vec![Some("S002".to_string()), Some("S001".to_string())]
            );
            assert_eq!(f64_values(array_children[1]), vec![Some(7.0), Some(42.0)]);
            assert_eq!(f64_values(array_children[2]), vec![None, Some(12.5)]);
            let schema_children =
                slice::from_raw_parts((*schema).children, (*schema).n_children as usize);
            assert_eq!(
                CStr::from_ptr((*schema_children[1]).name).to_str().unwrap(),
                "y"
            );
            assert_eq!(
                CStr::from_ptr((*schema_children[2]).name).to_str().unwrap(),
                "protein"
            );
            dagmldata_arrow_array_free(array);
            dagmldata_arrow_schema_free(schema);
        }
    }

    #[test]
    fn exports_coordinator_feature_arrow_over_abi() {
        let envelope: serde_json::Value = serde_json::from_slice(include_bytes!(
            "../../../examples/fixtures/oof_campaign/coordinator_data_plan_envelope_nir.json"
        ))
        .unwrap();
        let materialization_request: serde_json::Value = serde_json::from_slice(include_bytes!(
            "../../../examples/fixtures/oof_campaign/materialization_request_model_base_x.json"
        ))
        .unwrap();
        let request = serde_json::json!({
            "envelope": envelope,
            "materialization_request": materialization_request,
            "view": {
                "sample_ids": ["S001"],
                "columns": ["f1"],
                "include_augmented": false
            },
            "feature_table": {
                "feature_set_id": "x",
                "representation_id": "tabular_numeric",
                "feature_names": ["f0", "f1"],
                "rows": [
                    {"observation_id": "obs.S001.base", "values": [1.0, 10.0]},
                    {"observation_id": "obs.S001.rep1", "values": [2.0, 20.0]},
                    {"observation_id": "obs.S001.aug0", "values": [3.0, 30.0]},
                    {"observation_id": "obs.S002.base", "values": [4.0, 40.0]}
                ]
            }
        });
        let request = serde_json::to_vec(&request).unwrap();
        let mut array = std::ptr::null_mut();
        let mut schema = std::ptr::null_mut();
        let mut error = DagMlDataString::default();

        let status = unsafe {
            dagmldata_coordinator_feature_arrow_json(
                request.as_ptr(),
                request.len(),
                &mut array,
                &mut schema,
                &mut error,
            )
        };

        assert_eq!(status, DagMlDataStatusCode::Ok);
        assert!(error.ptr.is_null());
        unsafe {
            assert_eq!((*array).length, 2);
            assert_eq!((*array).n_children, 3);
            let array_children =
                slice::from_raw_parts((*array).children, (*array).n_children as usize);
            let schema_children =
                slice::from_raw_parts((*schema).children, (*schema).n_children as usize);
            assert_eq!(
                CStr::from_ptr((*schema_children[2]).name).to_str().unwrap(),
                "f1"
            );
            assert_eq!(
                utf8_values(array_children[0]),
                vec![
                    Some("obs.S001.base".to_string()),
                    Some("obs.S001.rep1".to_string()),
                ]
            );
            assert_eq!(f64_values(array_children[2]), vec![Some(10.0), Some(20.0)]);
            dagmldata_arrow_array_free(array);
            dagmldata_arrow_schema_free(schema);
        }
    }

    #[test]
    fn exports_coordinator_feature_fusion_arrow_over_abi() {
        let request = serde_json::json!({
            "schema_version": 1,
            "feature_set_id": "fused",
            "sources": [
                {
                    "source_id": "nir",
                    "block": {
                        "feature_set_id": "nir_x",
                        "representation_id": "tabular_numeric",
                        "feature_names": ["n0"],
                        "observation_ids": ["obs.S001.r1", "obs.S001.r2", "obs.S002.r1"],
                        "sample_ids": ["S001", "S001", "S002"],
                        "values": [[1.0], [2.0], [3.0]]
                    }
                },
                {
                    "source_id": "chem",
                    "block": {
                        "feature_set_id": "chem_x",
                        "representation_id": "tabular_numeric",
                        "feature_names": ["c0"],
                        "observation_ids": ["chem.S001", "chem.S002"],
                        "sample_ids": ["S001", "S002"],
                        "values": [[10.0], [20.0]]
                    }
                }
            ],
            "alignment": {
                "mode": "inner",
                "sample_ids": ["S001", "S002"],
                "masks": [
                    {"source_id": "nir", "sample_ids": ["S001", "S002"], "present": [true, true]},
                    {"source_id": "chem", "sample_ids": ["S001", "S002"], "present": [true, true]}
                ]
            },
            "source_layout": {
                "kind": "by_source_concat",
                "source_order": ["nir", "chem"],
                "blocks": [
                    {
                        "source_id": "nir",
                        "preprocessing_output": {
                            "feature_set_id": "nir_x",
                            "representation_id": "tabular_numeric",
                            "adapter_id": "preprocess_nir",
                            "fit_scope": "fold_train"
                        },
                        "column_start": 0,
                        "column_count": 1,
                        "feature_names": ["n0"]
                    },
                    {
                        "source_id": "chem",
                        "preprocessing_output": {
                            "feature_set_id": "chem_x",
                            "representation_id": "tabular_numeric",
                            "adapter_id": "preprocess_chem",
                            "fit_scope": "fold_train"
                        },
                        "column_start": 1,
                        "column_count": 1,
                        "feature_names": ["c0"]
                    }
                ],
                "concat": {
                    "feature_set_id": "fused",
                    "representation_id": "tabular_numeric",
                    "axis": "feature",
                    "total_column_count": 2,
                    "preserve_source_order": true,
                    "namespace_columns": true
                }
            }
        });
        let request = serde_json::to_vec(&request).unwrap();
        let mut array = std::ptr::null_mut();
        let mut schema = std::ptr::null_mut();
        let mut error = DagMlDataString::default();

        let status = unsafe {
            dagmldata_coordinator_feature_fusion_arrow_json(
                request.as_ptr(),
                request.len(),
                &mut array,
                &mut schema,
                &mut error,
            )
        };

        assert_eq!(status, DagMlDataStatusCode::Ok);
        assert!(error.ptr.is_null());
        unsafe {
            assert_eq!((*array).length, 3);
            assert_eq!((*array).n_children, 4);
            let array_children =
                slice::from_raw_parts((*array).children, (*array).n_children as usize);
            let schema_children =
                slice::from_raw_parts((*schema).children, (*schema).n_children as usize);
            assert_eq!(
                utf8_values(array_children[0]),
                vec![
                    Some("obs.S001.r1".to_string()),
                    Some("obs.S001.r2".to_string()),
                    Some("obs.S002.r1".to_string()),
                ]
            );
            assert_eq!(
                CStr::from_ptr((*schema_children[2]).name).to_str().unwrap(),
                "nir.n0"
            );
            assert_eq!(
                CStr::from_ptr((*schema_children[3]).name).to_str().unwrap(),
                "chem.c0"
            );
            assert_eq!(
                f64_values(array_children[2]),
                vec![Some(1.0), Some(2.0), Some(3.0)]
            );
            assert_eq!(
                f64_values(array_children[3]),
                vec![Some(10.0), Some(10.0), Some(20.0)]
            );
            dagmldata_arrow_array_free(array);
            dagmldata_arrow_schema_free(schema);
        }
    }

    #[test]
    fn exports_coordinator_feature_collation_json_over_abi() {
        let request = serde_json::json!({
            "feature_block": {
                "feature_set_id": "x",
                "representation_id": "tabular_numeric",
                "feature_names": ["f0", "f1"],
                "observation_ids": ["obs.S001", "obs.S002"],
                "sample_ids": ["S001", "S002"],
                "values": [[1.0, null], [3.0, 4.0]]
            },
            "policy": {
                "emit_mask": true
            }
        });
        let request = serde_json::to_vec(&request).unwrap();
        let mut out_json = DagMlDataString::default();
        let mut error = DagMlDataString::default();

        let status = unsafe {
            dagmldata_coordinator_feature_collation_json(
                request.as_ptr(),
                request.len(),
                &mut out_json,
                &mut error,
            )
        };

        assert_eq!(status, DagMlDataStatusCode::Ok);
        assert!(error.ptr.is_null());
        assert!(!out_json.ptr.is_null());
        let tensor_json = unsafe { string_value(out_json) };
        let tensor: serde_json::Value = serde_json::from_str(&tensor_json).unwrap();
        assert_eq!(tensor["shape"], serde_json::json!([2, 2]));
        assert_eq!(tensor["values"], serde_json::json!([1.0, 0.0, 3.0, 4.0]));
        assert_eq!(
            tensor["presence_mask"],
            serde_json::json!([true, true, true, true])
        );
        assert_eq!(
            tensor["validity_mask"],
            serde_json::json!([true, false, true, true])
        );
    }

    #[test]
    fn exports_coordinator_feature_collation_tensor_f64_over_abi() {
        let request = serde_json::json!({
            "feature_block": {
                "feature_set_id": "x",
                "representation_id": "tabular_numeric",
                "feature_names": ["f0", "f1"],
                "observation_ids": ["obs.S001", "obs.S002"],
                "sample_ids": ["S001", "S002"],
                "values": [[1.0, null], [3.0, 4.0]]
            },
            "policy": {
                "emit_mask": true
            }
        });
        let request = serde_json::to_vec(&request).unwrap();
        let mut tensor = DagMlDataTensorF64::default();
        let mut error = DagMlDataString::default();

        let status = unsafe {
            dagmldata_coordinator_feature_collation_tensor_f64_json(
                request.as_ptr(),
                request.len(),
                &mut tensor,
                &mut error,
            )
        };

        assert_eq!(status, DagMlDataStatusCode::Ok);
        assert!(error.ptr.is_null());
        unsafe {
            assert_eq!(tensor.abi_version, DAG_ML_DATA_TENSOR_F64_ABI_VERSION);
            assert_eq!(borrowed_string(&tensor.block_id), "x");
            assert_eq!(
                borrowed_string(&tensor.representation_id),
                "tabular_numeric"
            );
            assert_eq!(
                string_array_values(tensor.observation_ids),
                vec!["obs.S001", "obs.S002"]
            );
            assert_eq!(string_array_values(tensor.sample_ids), vec!["S001", "S002"]);
            assert_eq!(usize_array_values(tensor.shape), vec![2, 2]);
            assert_eq!(f64_array_values(tensor.values), vec![1.0, 0.0, 3.0, 4.0]);
            assert_eq!(u8_array_values(tensor.presence_mask), vec![1, 1, 1, 1]);
            assert_eq!(u8_array_values(tensor.validity_mask), vec![1, 0, 1, 1]);
            assert_eq!(string_array_values(tensor.feature_names), vec!["f0", "f1"]);
            dagmldata_tensor_f64_free(tensor);
        }
    }

    #[test]
    fn exports_coordinator_feature_collation_tensor_f32_over_abi() {
        let request = serde_json::json!({
            "feature_block": {
                "feature_set_id": "x",
                "representation_id": "tabular_numeric",
                "feature_names": ["f0", "f1"],
                "observation_ids": ["obs.S001", "obs.S002"],
                "sample_ids": ["S001", "S002"],
                "values": [[1.0, null], [3.0, 4.5]]
            },
            "policy": {
                "emit_mask": true
            }
        });
        let request = serde_json::to_vec(&request).unwrap();
        let mut tensor = DagMlDataTensorF32::default();
        let mut error = DagMlDataString::default();

        let status = unsafe {
            dagmldata_coordinator_feature_collation_tensor_f32_json(
                request.as_ptr(),
                request.len(),
                &mut tensor,
                &mut error,
            )
        };

        assert_eq!(status, DagMlDataStatusCode::Ok);
        assert!(error.ptr.is_null());
        unsafe {
            assert_eq!(tensor.abi_version, DAG_ML_DATA_TENSOR_F32_ABI_VERSION);
            assert_eq!(borrowed_string(&tensor.block_id), "x");
            assert_eq!(
                borrowed_string(&tensor.representation_id),
                "tabular_numeric"
            );
            assert_eq!(
                string_array_values(tensor.observation_ids),
                vec!["obs.S001", "obs.S002"]
            );
            assert_eq!(string_array_values(tensor.sample_ids), vec!["S001", "S002"]);
            assert_eq!(usize_array_values(tensor.shape), vec![2, 2]);
            assert_eq!(
                f32_array_values(tensor.values),
                vec![1.0_f32, 0.0, 3.0, 4.5]
            );
            assert_eq!(u8_array_values(tensor.presence_mask), vec![1, 1, 1, 1]);
            assert_eq!(u8_array_values(tensor.validity_mask), vec![1, 0, 1, 1]);
            assert_eq!(string_array_values(tensor.feature_names), vec!["f0", "f1"]);
            dagmldata_tensor_f32_free(tensor);
        }

        let overflow_request = serde_json::json!({
            "feature_block": {
                "feature_set_id": "x",
                "representation_id": "tabular_numeric",
                "feature_names": ["f0"],
                "observation_ids": ["obs.S001"],
                "sample_ids": ["S001"],
                "values": [[1.0e40]]
            },
            "policy": {"emit_mask": false}
        });
        let overflow_request = serde_json::to_vec(&overflow_request).unwrap();
        let mut overflow_tensor = DagMlDataTensorF32::default();
        let mut overflow_error = DagMlDataString::default();
        let status = unsafe {
            dagmldata_coordinator_feature_collation_tensor_f32_json(
                overflow_request.as_ptr(),
                overflow_request.len(),
                &mut overflow_tensor,
                &mut overflow_error,
            )
        };
        assert_eq!(status, DagMlDataStatusCode::ValidationError);
        assert_eq!(
            overflow_tensor.abi_version,
            DAG_ML_DATA_TENSOR_F32_ABI_VERSION
        );
        assert!(overflow_tensor.values.ptr.is_null());
        let overflow_message = unsafe { string_value(overflow_error) };
        assert!(
            overflow_message.contains("does not round-trip into a finite f32"),
            "unexpected overflow error: {overflow_message}"
        );
    }

    #[test]
    fn inmemory_provider_feature_arrow_accepts_fusion_selector_json() {
        let (envelope, materialization_request) = multisource_provider_fixture();
        let target_tables = b"[]";
        let feature_tables = serde_json::to_vec(&serde_json::json!([
            {
                "feature_set_id": "nir_x",
                "representation_id": "tabular_numeric",
                "feature_names": ["n0"],
                "rows": [
                    {"observation_id": "obs.S001.r1", "values": [1.0]},
                    {"observation_id": "obs.S001.r2", "values": [2.0]},
                    {"observation_id": "obs.S002.r1", "values": [3.0]}
                ]
            },
            {
                "feature_set_id": "chem_x",
                "representation_id": "tabular_numeric",
                "feature_names": ["c0"],
                "rows": [
                    {"observation_id": "chem.S001", "values": [10.0]},
                    {"observation_id": "chem.S002", "values": [20.0]}
                ]
            }
        ]))
        .unwrap();
        let mut vtable = empty_vtable();
        let mut error = DagMlDataString::default();
        let status = unsafe {
            dagmldata_inmemory_provider_new_with_features_json(
                envelope.as_ptr(),
                envelope.len(),
                target_tables.as_ptr(),
                target_tables.len(),
                feature_tables.as_ptr(),
                feature_tables.len(),
                &mut vtable,
                &mut error,
            )
        };
        assert_eq!(status, DagMlDataStatusCode::Ok);
        assert!(error.ptr.is_null());

        let mut data_handle = 0;
        let materialize = vtable.materialize.unwrap();
        let status = unsafe {
            materialize(
                vtable.user_data,
                0,
                DagMlDataBytesView {
                    ptr: materialization_request.as_ptr(),
                    len: materialization_request.len(),
                },
                &mut data_handle,
            )
        };
        assert_eq!(status, DagMlDataStatusCode::Ok);

        let view_json = serde_json::to_vec(&serde_json::json!({
            "sample_ids": ["S001", "S002"],
            "include_augmented": false
        }))
        .unwrap();
        let mut view_handle = 0;
        let make_view = vtable.make_view.unwrap();
        let status = unsafe {
            make_view(
                vtable.user_data,
                data_handle,
                DagMlDataBytesView {
                    ptr: view_json.as_ptr(),
                    len: view_json.len(),
                },
                &mut view_handle,
            )
        };
        assert_eq!(status, DagMlDataStatusCode::Ok);

        let fusion_selector = serde_json::to_vec(&serde_json::json!({
            "schema_version": 1,
            "feature_set_id": "fused",
            "sources": [
                {"source_id": "nir", "feature_set_id": "nir_x"},
                {"source_id": "chem", "feature_set_id": "chem_x"}
            ],
            "alignment": {
                "mode": "inner",
                "sample_ids": ["S001", "S002"],
                "masks": [
                    {"source_id": "nir", "sample_ids": ["S001", "S002"], "present": [true, true]},
                    {"source_id": "chem", "sample_ids": ["S001", "S002"], "present": [true, true]}
                ]
            }
        }))
        .unwrap();
        let mut feature_array = std::ptr::null_mut();
        let mut feature_schema = std::ptr::null_mut();
        let feature_arrow = vtable.feature_arrow.unwrap();
        let status = unsafe {
            feature_arrow(
                vtable.user_data,
                view_handle,
                DagMlDataBytesView {
                    ptr: fusion_selector.as_ptr(),
                    len: fusion_selector.len(),
                },
                &mut feature_array,
                &mut feature_schema,
            )
        };
        assert_eq!(status, DagMlDataStatusCode::Ok);
        unsafe {
            assert_eq!((*feature_array).length, 3);
            assert_eq!((*feature_array).n_children, 4);
            let array_children = slice::from_raw_parts(
                (*feature_array).children,
                (*feature_array).n_children as usize,
            );
            let schema_children = slice::from_raw_parts(
                (*feature_schema).children,
                (*feature_schema).n_children as usize,
            );
            assert_eq!(
                utf8_values(array_children[0]),
                vec![
                    Some("obs.S001.r1".to_string()),
                    Some("obs.S001.r2".to_string()),
                    Some("obs.S002.r1".to_string()),
                ]
            );
            assert_eq!(
                CStr::from_ptr((*schema_children[2]).name).to_str().unwrap(),
                "nir.n0"
            );
            assert_eq!(
                CStr::from_ptr((*schema_children[3]).name).to_str().unwrap(),
                "chem.c0"
            );
            assert_eq!(
                f64_values(array_children[2]),
                vec![Some(1.0), Some(2.0), Some(3.0)]
            );
            assert_eq!(
                f64_values(array_children[3]),
                vec![Some(10.0), Some(10.0), Some(20.0)]
            );
            dagmldata_arrow_array_free(feature_array);
            dagmldata_arrow_schema_free(feature_schema);
            vtable.release.unwrap()(vtable.user_data, view_handle);
            vtable.release.unwrap()(vtable.user_data, data_handle);
            dagmldata_inmemory_provider_destroy(&mut vtable);
        }
    }

    #[test]
    fn inmemory_provider_make_view_forwards_branch_view_by_source_filter() {
        // The C ABI provider's `provider_make_view` deserializes a
        // `DataView` JSON, which carries `branch_view`. The arena
        // intersects `view.source_ids` (if any) with the branch
        // selector's `source_ids` (BySource mode) before filtering
        // relations. This test pins that contract end-to-end through
        // the C ABI by selecting only the NIR source and asserting
        // that the chem observation does not appear in view_identity.
        let (envelope, materialization_request) = multisource_provider_fixture();
        let target_tables = b"[]";
        let feature_tables = b"[]";
        let mut vtable = empty_vtable();
        let mut error = DagMlDataString::default();
        let status = unsafe {
            dagmldata_inmemory_provider_new_with_features_json(
                envelope.as_ptr(),
                envelope.len(),
                target_tables.as_ptr(),
                target_tables.len(),
                feature_tables.as_ptr(),
                feature_tables.len(),
                &mut vtable,
                &mut error,
            )
        };
        assert_eq!(status, DagMlDataStatusCode::Ok);
        assert!(error.ptr.is_null());

        let mut data_handle = 0;
        let materialize = vtable.materialize.unwrap();
        let status = unsafe {
            materialize(
                vtable.user_data,
                0,
                DagMlDataBytesView {
                    ptr: materialization_request.as_ptr(),
                    len: materialization_request.len(),
                },
                &mut data_handle,
            )
        };
        assert_eq!(status, DagMlDataStatusCode::Ok);

        let branch_view_json = serde_json::to_vec(&serde_json::json!({
            "sample_ids": ["S001", "S002"],
            "source_ids": ["nir", "chem"],
            "include_augmented": false,
            "branch_view": {
                "view_id": "branch_view:nir-only",
                "branch_id": "branch:nir",
                "mode": "by_source",
                "selector": {
                    "source_ids": ["nir"]
                }
            }
        }))
        .unwrap();
        let mut view_handle = 0;
        let make_view = vtable.make_view.unwrap();
        let status = unsafe {
            make_view(
                vtable.user_data,
                data_handle,
                DagMlDataBytesView {
                    ptr: branch_view_json.as_ptr(),
                    len: branch_view_json.len(),
                },
                &mut view_handle,
            )
        };
        assert_eq!(
            status,
            DagMlDataStatusCode::Ok,
            "make_view must accept a by_source branch_view payload"
        );

        let mut identity_array = std::ptr::null_mut();
        let mut identity_schema = std::ptr::null_mut();
        let view_identity = vtable.view_identity.unwrap();
        let status = unsafe {
            view_identity(
                vtable.user_data,
                view_handle,
                &mut identity_array,
                &mut identity_schema,
            )
        };
        assert_eq!(status, DagMlDataStatusCode::Ok);
        unsafe {
            // NIR fixture has 3 observations across S001 (r1 + r2) and
            // S002 (r1). The chem observation `chem.S001` must be
            // filtered out by the branch selector.
            assert_eq!((*identity_array).length, 3);
            let array_children = slice::from_raw_parts(
                (*identity_array).children,
                (*identity_array).n_children as usize,
            );
            let observation_ids = utf8_values(array_children[0]);
            assert_eq!(
                observation_ids,
                vec![
                    Some("obs.S001.r1".to_string()),
                    Some("obs.S001.r2".to_string()),
                    Some("obs.S002.r1".to_string())
                ],
                "branch_view by_source must restrict the identity table to the selected source"
            );
            dagmldata_arrow_array_free(identity_array);
            dagmldata_arrow_schema_free(identity_schema);
            vtable.release.unwrap()(vtable.user_data, view_handle);
            vtable.release.unwrap()(vtable.user_data, data_handle);
            dagmldata_inmemory_provider_destroy(&mut vtable);
        }
    }

    #[test]
    fn inmemory_provider_make_view_refuses_unconstrained_branch_view_selector() {
        // A syntactically valid branch view with an empty by_metadata selector
        // must fail as a contract validation error rather than returning an
        // unfiltered view. Native by_metadata/by_tag/by_filter execution is
        // covered by the core/provider tests; this ABI test locks the typed
        // refusal path independently of JSON parsing.
        use dag_ml_data_core::DataView;
        let (envelope, materialization_request) = multisource_provider_fixture();
        let target_tables = b"[]";
        let feature_tables = b"[]";
        let mut vtable = empty_vtable();
        let mut error = DagMlDataString::default();
        let status = unsafe {
            dagmldata_inmemory_provider_new_with_features_json(
                envelope.as_ptr(),
                envelope.len(),
                target_tables.as_ptr(),
                target_tables.len(),
                feature_tables.as_ptr(),
                feature_tables.len(),
                &mut vtable,
                &mut error,
            )
        };
        assert_eq!(status, DagMlDataStatusCode::Ok);

        let mut data_handle = 0;
        let materialize = vtable.materialize.unwrap();
        let status = unsafe {
            materialize(
                vtable.user_data,
                0,
                DagMlDataBytesView {
                    ptr: materialization_request.as_ptr(),
                    len: materialization_request.len(),
                },
                &mut data_handle,
            )
        };
        assert_eq!(status, DagMlDataStatusCode::Ok);

        let by_metadata_view_json = serde_json::to_vec(&serde_json::json!({
            "sample_ids": ["S001", "S002"],
            "source_ids": ["nir", "chem"],
            "include_augmented": false,
            "branch_view": {
                "view_id": "branch_view:by-metadata",
                "branch_id": "branch:metadata",
                "mode": "by_metadata",
                "selector": {
                    "metadata": {}
                }
            }
        }))
        .unwrap();
        // Sanity guard: the JSON parses as a DataView at the core level, so
        // the C ABI's refusal below is validation rather than parse failure.
        let parsed: DataView = serde_json::from_slice(&by_metadata_view_json)
            .expect("by_metadata DataView JSON must parse via dag-ml-data-core");
        assert!(parsed.branch_view.is_some());
        let mut view_handle = 0;
        let make_view = vtable.make_view.unwrap();
        let status = unsafe {
            make_view(
                vtable.user_data,
                data_handle,
                DagMlDataBytesView {
                    ptr: by_metadata_view_json.as_ptr(),
                    len: by_metadata_view_json.len(),
                },
                &mut view_handle,
            )
        };
        assert_eq!(
            status,
            DagMlDataStatusCode::ValidationError,
            "make_view must refuse an unconstrained branch_view selector"
        );
        assert_eq!(view_handle, 0);

        unsafe {
            vtable.release.unwrap()(vtable.user_data, data_handle);
            dagmldata_inmemory_provider_destroy(&mut vtable);
        }
    }

    #[test]
    fn inmemory_provider_feature_collation_uses_provider_buffers_and_fusion_selector() {
        let (envelope, materialization_request) = multisource_provider_fixture();
        let target_tables = b"[]";
        let feature_tables = serde_json::to_vec(&serde_json::json!([
            {
                "feature_set_id": "nir_x",
                "representation_id": "tabular_numeric",
                "feature_names": ["n0"],
                "rows": [
                    {"observation_id": "obs.S001.r1", "values": [1.0]},
                    {"observation_id": "obs.S001.r2", "values": [2.0]},
                    {"observation_id": "obs.S002.r1", "values": [3.0]}
                ]
            },
            {
                "feature_set_id": "chem_x",
                "representation_id": "tabular_numeric",
                "feature_names": ["c0"],
                "rows": [
                    {"observation_id": "chem.S001", "values": [10.0]},
                    {"observation_id": "chem.S002", "values": [20.0]}
                ]
            }
        ]))
        .unwrap();
        let mut vtable = empty_vtable();
        let mut error = DagMlDataString::default();
        let status = unsafe {
            dagmldata_inmemory_provider_new_with_features_json(
                envelope.as_ptr(),
                envelope.len(),
                target_tables.as_ptr(),
                target_tables.len(),
                feature_tables.as_ptr(),
                feature_tables.len(),
                &mut vtable,
                &mut error,
            )
        };
        assert_eq!(status, DagMlDataStatusCode::Ok);
        assert!(error.ptr.is_null());

        let mut data_handle = 0;
        let status = unsafe {
            vtable.materialize.unwrap()(
                vtable.user_data,
                0,
                DagMlDataBytesView {
                    ptr: materialization_request.as_ptr(),
                    len: materialization_request.len(),
                },
                &mut data_handle,
            )
        };
        assert_eq!(status, DagMlDataStatusCode::Ok);

        let view_json = serde_json::to_vec(&serde_json::json!({
            "sample_ids": ["S001", "S002"],
            "include_augmented": false
        }))
        .unwrap();
        let mut view_handle = 0;
        let status = unsafe {
            vtable.make_view.unwrap()(
                vtable.user_data,
                data_handle,
                DagMlDataBytesView {
                    ptr: view_json.as_ptr(),
                    len: view_json.len(),
                },
                &mut view_handle,
            )
        };
        assert_eq!(status, DagMlDataStatusCode::Ok);

        let selector = serde_json::to_vec(&serde_json::json!({
            "fusion": {
                "schema_version": 1,
                "feature_set_id": "fused",
                "sources": [
                    {"source_id": "nir", "feature_set_id": "nir_x", "columns": ["n0"]},
                    {"source_id": "chem", "feature_set_id": "chem_x", "columns": ["c0"]}
                ],
                "alignment": {
                    "mode": "inner",
                    "sample_ids": ["S001", "S002"],
                    "masks": [
                        {"source_id": "nir", "sample_ids": ["S001", "S002"], "present": [true, true]},
                        {"source_id": "chem", "sample_ids": ["S001", "S002"], "present": [true, true]}
                    ]
                },
                "source_layout": {
                    "kind": "by_source_concat",
                    "source_order": ["nir", "chem"],
                    "blocks": [
                        {
                            "source_id": "nir",
                            "preprocessing_output": {
                                "feature_set_id": "nir_x",
                                "representation_id": "tabular_numeric",
                                "adapter_id": "preprocess_nir",
                                "fit_scope": "fold_train"
                            },
                            "column_start": 0,
                            "column_count": 1,
                            "feature_names": ["n0"]
                        },
                        {
                            "source_id": "chem",
                            "preprocessing_output": {
                                "feature_set_id": "chem_x",
                                "representation_id": "tabular_numeric",
                                "adapter_id": "preprocess_chem",
                                "fit_scope": "fold_train"
                            },
                            "column_start": 1,
                            "column_count": 1,
                            "feature_names": ["c0"]
                        }
                    ],
                    "concat": {
                        "feature_set_id": "fused",
                        "representation_id": "tabular_numeric",
                        "axis": "feature",
                        "total_column_count": 2,
                        "preserve_source_order": true,
                        "namespace_columns": true
                    }
                }
            },
            "policy": {
                "emit_mask": true
            }
        }))
        .unwrap();
        let mut out_json = DagMlDataString::default();
        let mut error = DagMlDataString::default();
        let status = unsafe {
            dagmldata_inmemory_provider_feature_collation_json(
                &vtable,
                view_handle,
                DagMlDataBytesView {
                    ptr: selector.as_ptr(),
                    len: selector.len(),
                },
                &mut out_json,
                &mut error,
            )
        };

        assert_eq!(status, DagMlDataStatusCode::Ok);
        assert!(error.ptr.is_null());
        let tensor_json = unsafe { string_value(out_json) };
        let tensor: serde_json::Value = serde_json::from_str(&tensor_json).unwrap();
        assert_eq!(tensor["shape"], serde_json::json!([3, 2]));
        assert_eq!(
            tensor["observation_ids"],
            serde_json::json!(["obs.S001.r1", "obs.S001.r2", "obs.S002.r1"])
        );
        assert_eq!(
            tensor["values"],
            serde_json::json!([1.0, 10.0, 2.0, 10.0, 3.0, 20.0])
        );
        assert_eq!(
            tensor["feature_names"],
            serde_json::json!(["nir.n0", "chem.c0"])
        );
        assert_eq!(
            tensor["presence_mask"],
            serde_json::json!([true, true, true, true, true, true])
        );

        let mut tensor = DagMlDataTensorF64::default();
        let mut error = DagMlDataString::default();
        let status = unsafe {
            dagmldata_inmemory_provider_feature_collation_tensor_f64_json(
                &vtable,
                view_handle,
                DagMlDataBytesView {
                    ptr: selector.as_ptr(),
                    len: selector.len(),
                },
                &mut tensor,
                &mut error,
            )
        };
        assert_eq!(status, DagMlDataStatusCode::Ok);
        assert!(error.ptr.is_null());
        unsafe {
            assert_eq!(usize_array_values(tensor.shape), vec![3, 2]);
            assert_eq!(
                string_array_values(tensor.observation_ids),
                vec!["obs.S001.r1", "obs.S001.r2", "obs.S002.r1"]
            );
            assert_eq!(
                f64_array_values(tensor.values),
                vec![1.0, 10.0, 2.0, 10.0, 3.0, 20.0]
            );
            assert_eq!(
                string_array_values(tensor.feature_names),
                vec!["nir.n0", "chem.c0"]
            );
            assert_eq!(
                u8_array_values(tensor.presence_mask),
                vec![1, 1, 1, 1, 1, 1]
            );
            dagmldata_tensor_f64_free(tensor);
        }

        unsafe {
            vtable.release.unwrap()(vtable.user_data, view_handle);
            vtable.release.unwrap()(vtable.user_data, data_handle);
            dagmldata_inmemory_provider_destroy(&mut vtable);
        }
    }

    /// Phase B: a contiguous uint8 RGB ND tensor `[N,H,W]` round-trips through
    /// the provider — constructed from a borrowed view, bound at materialize,
    /// and exported view-filtered + axis-0-gathered in relation order.
    #[test]
    fn inmemory_provider_new_with_tensor_views_contiguous_u8_round_trips() {
        use dag_ml_data_core::{AxisKind, AxisSpec, RepresentationSpec, TypeId};

        let representation_id = RepresentationId::new("rgb_image").unwrap();
        let native_representation = RepresentationSpec {
            id: representation_id.clone(),
            type_id: TypeId::new("image").unwrap(),
            rank: Some(2),
            axes: vec![
                AxisSpec {
                    name: "sample".to_string(),
                    kind: AxisKind::Sample,
                    unit: None,
                    size: Some(3),
                    variable: false,
                    coordinate: None,
                },
                AxisSpec {
                    name: "pixel".to_string(),
                    kind: AxisKind::Feature,
                    unit: None,
                    size: Some(4),
                    variable: false,
                    coordinate: None,
                },
            ],
            container: "pil_image_batch".to_string(),
            dtype: Some("uint8".to_string()),
            sparse: false,
            ragged: false,
            signal_type: None,
        };
        let schema = single_source_dataset_schema("image", "image", native_representation);
        let (envelope, materialization_request) =
            single_modality_provider_fixture(&schema, &representation_id);

        // [3, 2, 2] contiguous uint8 tensor over obs.s1..s3.
        let tensor_id = bytes_view(b"rgb");
        let repr = bytes_view(b"rgb_image");
        let container = bytes_view(b"pil_image_batch");
        let observation_ids = [
            bytes_view(b"obs.s1"),
            bytes_view(b"obs.s2"),
            bytes_view(b"obs.s3"),
        ];
        let shape = [3usize, 2, 2];
        let data: [u8; 12] = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
        let views = [DagMlDataBorrowedTensorView {
            abi_version: DAG_ML_DATA_BORROWED_TENSOR_VIEW_ABI_VERSION,
            tensor_id,
            representation_id: repr,
            container,
            dtype: DagMlDataTensorDType::U8 as u32,
            data: data.as_ptr(),
            data_len: data.len(),
            shape: shape.as_ptr(),
            strides_bytes: std::ptr::null(),
            rank: shape.len(),
            observation_ids: observation_ids.as_ptr(),
            sample_ids: std::ptr::null(),
            ids_len: observation_ids.len(),
            row_presence_mask: std::ptr::null(),
            row_presence_len: 0,
        }];
        let target_tables = b"[]";
        let mut vtable = empty_vtable();
        let mut error = DagMlDataString::default();
        let status = unsafe {
            dagmldata_inmemory_provider_new_with_tensor_views(
                envelope.as_ptr(),
                envelope.len(),
                target_tables.as_ptr(),
                target_tables.len(),
                views.as_ptr(),
                views.len(),
                &mut vtable,
                &mut error,
            )
        };
        assert_eq!(status, DagMlDataStatusCode::Ok);
        assert!(error.ptr.is_null());

        let mut data_handle = 0;
        let status = unsafe {
            vtable.materialize.unwrap()(
                vtable.user_data,
                0,
                DagMlDataBytesView {
                    ptr: materialization_request.as_ptr(),
                    len: materialization_request.len(),
                },
                &mut data_handle,
            )
        };
        assert_eq!(status, DagMlDataStatusCode::Ok);

        // View selects s3 then s1; the export gathers those axis-0 rows in order.
        let view_json = serde_json::to_vec(&serde_json::json!({
            "sample_ids": ["s3", "s1"],
            "include_augmented": false
        }))
        .unwrap();
        let mut view_handle = 0;
        let status = unsafe {
            vtable.make_view.unwrap()(
                vtable.user_data,
                data_handle,
                DagMlDataBytesView {
                    ptr: view_json.as_ptr(),
                    len: view_json.len(),
                },
                &mut view_handle,
            )
        };
        assert_eq!(status, DagMlDataStatusCode::Ok);

        let selector = serde_json::to_vec(&serde_json::json!({"tensor_id": "rgb"})).unwrap();
        let mut tensor = DagMlDataOwnedTensor::default();
        let mut error = DagMlDataString::default();
        let status = unsafe {
            dagmldata_inmemory_provider_nd_tensor_export_json(
                &vtable,
                view_handle,
                DagMlDataBytesView {
                    ptr: selector.as_ptr(),
                    len: selector.len(),
                },
                &mut tensor,
                &mut error,
            )
        };
        assert_eq!(status, DagMlDataStatusCode::Ok);
        assert!(error.ptr.is_null());
        unsafe {
            assert_eq!(tensor.dtype, DagMlDataTensorDType::U8);
            assert_eq!(usize_array_values(tensor.shape), vec![2, 2, 2]);
            // s3 row (bytes 8..12) then s1 row (0..4).
            assert_eq!(u8_array_values(tensor.data), vec![8, 9, 10, 11, 0, 1, 2, 3]);
            assert_eq!(
                string_array_values(tensor.observation_ids),
                vec!["obs.s3", "obs.s1"]
            );
            assert_eq!(string_array_values(tensor.sample_ids), vec!["s3", "s1"]);
            dagmldata_nd_tensor_free(tensor);
            vtable.release.unwrap()(vtable.user_data, view_handle);
            vtable.release.unwrap()(vtable.user_data, data_handle);
            dagmldata_inmemory_provider_destroy(&mut vtable);
        }
    }

    /// Phase B: a STRIDED borrowed tensor is gathered into canonical row-major
    /// bytes (strides discarded). [3,2] u8 with a 1-byte row pad.
    #[test]
    fn inmemory_provider_new_with_tensor_views_gathers_strided_input() {
        use dag_ml_data_core::{AxisKind, AxisSpec, RepresentationSpec, TypeId};

        let representation_id = RepresentationId::new("rgb_image").unwrap();
        let native_representation = RepresentationSpec {
            id: representation_id.clone(),
            type_id: TypeId::new("image").unwrap(),
            rank: Some(2),
            axes: vec![
                AxisSpec {
                    name: "sample".to_string(),
                    kind: AxisKind::Sample,
                    unit: None,
                    size: Some(3),
                    variable: false,
                    coordinate: None,
                },
                AxisSpec {
                    name: "pixel".to_string(),
                    kind: AxisKind::Feature,
                    unit: None,
                    size: Some(2),
                    variable: false,
                    coordinate: None,
                },
            ],
            container: "ndarray".to_string(),
            dtype: Some("uint8".to_string()),
            sparse: false,
            ragged: false,
            signal_type: None,
        };
        let schema = single_source_dataset_schema("image", "image", native_representation);
        let (envelope, materialization_request) =
            single_modality_provider_fixture(&schema, &representation_id);

        let observation_ids = [
            bytes_view(b"obs.s1"),
            bytes_view(b"obs.s2"),
            bytes_view(b"obs.s3"),
        ];
        let shape = [3usize, 2];
        // Row stride 3 (1 byte trailing pad), element stride 1: rows are
        // [10,11,_], [20,21,_], [30,31,_].
        let strides = [3isize, 1];
        let data: [u8; 9] = [10, 11, 99, 20, 21, 99, 30, 31, 99];
        let views = [DagMlDataBorrowedTensorView {
            abi_version: DAG_ML_DATA_BORROWED_TENSOR_VIEW_ABI_VERSION,
            tensor_id: bytes_view(b"rgb"),
            representation_id: bytes_view(b"rgb_image"),
            container: bytes_view(b"ndarray"),
            dtype: DagMlDataTensorDType::U8 as u32,
            data: data.as_ptr(),
            data_len: data.len(),
            shape: shape.as_ptr(),
            strides_bytes: strides.as_ptr(),
            rank: shape.len(),
            observation_ids: observation_ids.as_ptr(),
            sample_ids: std::ptr::null(),
            ids_len: observation_ids.len(),
            row_presence_mask: std::ptr::null(),
            row_presence_len: 0,
        }];
        let target_tables = b"[]";
        let mut vtable = empty_vtable();
        let mut error = DagMlDataString::default();
        let status = unsafe {
            dagmldata_inmemory_provider_new_with_tensor_views(
                envelope.as_ptr(),
                envelope.len(),
                target_tables.as_ptr(),
                target_tables.len(),
                views.as_ptr(),
                views.len(),
                &mut vtable,
                &mut error,
            )
        };
        assert_eq!(status, DagMlDataStatusCode::Ok);

        let mut data_handle = 0;
        unsafe {
            vtable.materialize.unwrap()(
                vtable.user_data,
                0,
                DagMlDataBytesView {
                    ptr: materialization_request.as_ptr(),
                    len: materialization_request.len(),
                },
                &mut data_handle,
            )
        };
        let view_json = serde_json::to_vec(&serde_json::json!({
            "sample_ids": ["s1", "s2", "s3"],
            "include_augmented": false
        }))
        .unwrap();
        let mut view_handle = 0;
        unsafe {
            vtable.make_view.unwrap()(
                vtable.user_data,
                data_handle,
                DagMlDataBytesView {
                    ptr: view_json.as_ptr(),
                    len: view_json.len(),
                },
                &mut view_handle,
            )
        };
        let selector = serde_json::to_vec(&serde_json::json!({"tensor_id": "rgb"})).unwrap();
        let mut tensor = DagMlDataOwnedTensor::default();
        let mut error = DagMlDataString::default();
        let status = unsafe {
            dagmldata_inmemory_provider_nd_tensor_export_json(
                &vtable,
                view_handle,
                DagMlDataBytesView {
                    ptr: selector.as_ptr(),
                    len: selector.len(),
                },
                &mut tensor,
                &mut error,
            )
        };
        assert_eq!(status, DagMlDataStatusCode::Ok);
        unsafe {
            assert_eq!(usize_array_values(tensor.shape), vec![3, 2]);
            // Strides discarded: canonical contiguous bytes, no pad byte 99.
            assert_eq!(u8_array_values(tensor.data), vec![10, 11, 20, 21, 30, 31]);
            dagmldata_nd_tensor_free(tensor);
            vtable.release.unwrap()(vtable.user_data, view_handle);
            vtable.release.unwrap()(vtable.user_data, data_handle);
            dagmldata_inmemory_provider_destroy(&mut vtable);
        }
    }

    /// Phase B: the constructor rejects a contiguous view whose data length does
    /// not match `shape * element_size`.
    #[test]
    fn inmemory_provider_new_with_tensor_views_rejects_bad_data_len() {
        let observation_ids = [bytes_view(b"obs.s1"), bytes_view(b"obs.s2")];
        let shape = [2usize, 2];
        let data: [u8; 3] = [1, 2, 3]; // expected 4 bytes
        let views = [DagMlDataBorrowedTensorView {
            abi_version: DAG_ML_DATA_BORROWED_TENSOR_VIEW_ABI_VERSION,
            tensor_id: bytes_view(b"rgb"),
            representation_id: bytes_view(b"rgb_image"),
            container: bytes_view(b"ndarray"),
            dtype: DagMlDataTensorDType::U8 as u32,
            data: data.as_ptr(),
            data_len: data.len(),
            shape: shape.as_ptr(),
            strides_bytes: std::ptr::null(),
            rank: shape.len(),
            observation_ids: observation_ids.as_ptr(),
            sample_ids: std::ptr::null(),
            ids_len: observation_ids.len(),
            row_presence_mask: std::ptr::null(),
            row_presence_len: 0,
        }];
        let representation_id = RepresentationId::new("rgb_image").unwrap();
        let schema = {
            use dag_ml_data_core::{AxisKind, AxisSpec, RepresentationSpec, TypeId};
            single_source_dataset_schema(
                "image",
                "image",
                RepresentationSpec {
                    id: representation_id.clone(),
                    type_id: TypeId::new("image").unwrap(),
                    rank: Some(2),
                    axes: vec![
                        AxisSpec {
                            name: "sample".to_string(),
                            kind: AxisKind::Sample,
                            unit: None,
                            size: Some(3),
                            variable: false,
                            coordinate: None,
                        },
                        AxisSpec {
                            name: "pixel".to_string(),
                            kind: AxisKind::Feature,
                            unit: None,
                            size: Some(2),
                            variable: false,
                            coordinate: None,
                        },
                    ],
                    container: "ndarray".to_string(),
                    dtype: Some("uint8".to_string()),
                    sparse: false,
                    ragged: false,
                    signal_type: None,
                },
            )
        };
        let (envelope, _request) = single_modality_provider_fixture(&schema, &representation_id);
        let target_tables = b"[]";
        let mut vtable = empty_vtable();
        let mut error = DagMlDataString::default();
        let status = unsafe {
            dagmldata_inmemory_provider_new_with_tensor_views(
                envelope.as_ptr(),
                envelope.len(),
                target_tables.as_ptr(),
                target_tables.len(),
                views.as_ptr(),
                views.len(),
                &mut vtable,
                &mut error,
            )
        };
        assert_eq!(status, DagMlDataStatusCode::ValidationError);
        assert!(vtable.user_data.is_null());
        unsafe {
            dagmldata_string_free(error);
        }
    }

    /// Phase B: an out-of-range dtype code is rejected (not UB) — the borrowed
    /// view carries `dtype` as a raw u32.
    #[test]
    fn inmemory_provider_new_with_tensor_views_rejects_unknown_dtype() {
        use dag_ml_data_core::{AxisKind, AxisSpec, RepresentationSpec, TypeId};

        let observation_ids = [bytes_view(b"obs.s1")];
        let shape = [1usize, 2];
        let data: [u8; 2] = [1, 2];
        let views = [DagMlDataBorrowedTensorView {
            abi_version: DAG_ML_DATA_BORROWED_TENSOR_VIEW_ABI_VERSION,
            tensor_id: bytes_view(b"rgb"),
            representation_id: bytes_view(b"rgb_image"),
            container: bytes_view(b"ndarray"),
            dtype: 99, // unknown code
            data: data.as_ptr(),
            data_len: data.len(),
            shape: shape.as_ptr(),
            strides_bytes: std::ptr::null(),
            rank: shape.len(),
            observation_ids: observation_ids.as_ptr(),
            sample_ids: std::ptr::null(),
            ids_len: observation_ids.len(),
            row_presence_mask: std::ptr::null(),
            row_presence_len: 0,
        }];
        let representation_id = RepresentationId::new("rgb_image").unwrap();
        let schema = single_source_dataset_schema(
            "image",
            "image",
            RepresentationSpec {
                id: representation_id.clone(),
                type_id: TypeId::new("image").unwrap(),
                rank: Some(2),
                axes: vec![
                    AxisSpec {
                        name: "sample".to_string(),
                        kind: AxisKind::Sample,
                        unit: None,
                        size: Some(3),
                        variable: false,
                        coordinate: None,
                    },
                    AxisSpec {
                        name: "pixel".to_string(),
                        kind: AxisKind::Feature,
                        unit: None,
                        size: Some(2),
                        variable: false,
                        coordinate: None,
                    },
                ],
                container: "ndarray".to_string(),
                dtype: Some("uint8".to_string()),
                sparse: false,
                ragged: false,
                signal_type: None,
            },
        );
        let (envelope, _request) = single_modality_provider_fixture(&schema, &representation_id);
        let target_tables = b"[]";
        let mut vtable = empty_vtable();
        let mut error = DagMlDataString::default();
        let status = unsafe {
            dagmldata_inmemory_provider_new_with_tensor_views(
                envelope.as_ptr(),
                envelope.len(),
                target_tables.as_ptr(),
                target_tables.len(),
                views.as_ptr(),
                views.len(),
                &mut vtable,
                &mut error,
            )
        };
        assert_eq!(status, DagMlDataStatusCode::ValidationError);
        assert!(vtable.user_data.is_null());
        unsafe {
            dagmldata_string_free(error);
        }
    }

    /// Phase A: prove that one modality-neutral provider transports several
    /// distinct modalities through a single code path.
    ///
    /// Each case is a different modality expressed purely with the generic
    /// contract vocabulary — a free `modality` string plus an `AxisKind`
    /// (`Wavelength`, `Feature`, `Time`, `Variant`). The vocabulary has no
    /// modality-specific *types*: the only modality-bearing fields are free
    /// strings (`modality`, `type_id`, the representation id) and the generic
    /// `AxisKind` enum, and the provider code path never branches on any of
    /// them. The modality schema is threaded through the provider for real —
    /// the envelope's `schema_fingerprint` is the digest of the modality
    /// `DatasetSchema`, so a different `AxisKind`/`modality` yields a different
    /// digest that the request must carry to materialize. The loop body that
    /// drives the provider (`new_with_f64_features_json -> materialize ->
    /// make_view -> feature_arrow`) is byte-for-byte identical for every case
    /// and asserts the same materialized output, so the only thing that varies
    /// between modalities is the schema. That is the "zero per-modality code"
    /// claim made concrete. The companion negative test
    /// `inmemory_provider_refuses_feature_buffer_with_mismatched_representation`
    /// shows the provider really binds on the representation rather than
    /// special-casing these names.
    #[test]
    fn inmemory_provider_materializes_modalities_through_one_provider_code_path() {
        use dag_ml_data_core::{AxisKind, AxisSpec, RepresentationSpec, SignalKind, TypeId};

        struct ModalityCase {
            representation_id: &'static str,
            modality: &'static str,
            type_id: &'static str,
            axis_name: &'static str,
            axis_kind: AxisKind,
            axis_unit: Option<&'static str>,
            container: &'static str,
            signal_type: Option<SignalKind>,
        }

        let cases = [
            ModalityCase {
                representation_id: "signal_1d",
                modality: "nir",
                type_id: "dense_signal",
                axis_name: "wavelength",
                axis_kind: AxisKind::Wavelength,
                axis_unit: Some("nm"),
                container: "ndarray",
                signal_type: Some(SignalKind::Reflectance),
            },
            ModalityCase {
                representation_id: "tabular_numeric",
                modality: "tabular",
                type_id: "table",
                axis_name: "feature",
                axis_kind: AxisKind::Feature,
                axis_unit: None,
                container: "dataframe",
                signal_type: None,
            },
            ModalityCase {
                representation_id: "time_series",
                modality: "timeseries",
                type_id: "dense_series",
                axis_name: "time",
                axis_kind: AxisKind::Time,
                axis_unit: Some("s"),
                container: "ndarray",
                signal_type: None,
            },
            ModalityCase {
                representation_id: "marker_panel",
                modality: "markers",
                type_id: "genotype",
                axis_name: "variant",
                axis_kind: AxisKind::Variant,
                axis_unit: None,
                container: "ndarray",
                signal_type: None,
            },
        ];

        for case in cases {
            let representation_id = RepresentationId::new(case.representation_id).unwrap();

            // 1. The generic contract vocabulary expresses this modality with no
            //    modality-specific type: a `SourceDescriptor` carrying the free
            //    `modality` string and a native representation whose non-sample
            //    axis is the modality's `AxisKind`.
            let native_representation = RepresentationSpec {
                id: representation_id.clone(),
                type_id: TypeId::new(case.type_id).unwrap(),
                rank: Some(2),
                axes: vec![
                    AxisSpec {
                        name: "sample".to_string(),
                        kind: AxisKind::Sample,
                        unit: None,
                        size: Some(3),
                        variable: false,
                        coordinate: None,
                    },
                    AxisSpec {
                        name: case.axis_name.to_string(),
                        kind: case.axis_kind.clone(),
                        unit: case.axis_unit.map(str::to_string),
                        size: Some(2),
                        variable: false,
                        coordinate: None,
                    },
                ],
                container: case.container.to_string(),
                dtype: Some("float64".to_string()),
                sparse: false,
                ragged: false,
                signal_type: case.signal_type,
            };
            let schema =
                single_source_dataset_schema(case.modality, case.type_id, native_representation);
            schema.validate().unwrap();
            let source = &schema.sources[0];
            assert_eq!(source.modality, case.modality);
            assert_eq!(source.native_representation.axes[1].kind, case.axis_kind);
            assert_eq!(source.native_representation.id, representation_id);

            // 2. The same provider code path transports this modality. Only the
            //    modality schema changes between iterations; the envelope's
            //    schema_fingerprint is the digest of that schema, so the
            //    modality is bound into materialize-time validation.
            let (envelope, materialization_request) =
                single_modality_provider_fixture(&schema, &representation_id);
            let target_tables = b"[]";
            let feature_matrices = serde_json::to_vec(&serde_json::json!([
                {
                    "feature_set_id": "x",
                    "representation_id": case.representation_id,
                    "feature_names": ["f0", "f1"],
                    "observation_ids": ["obs.s1", "obs.s2", "obs.s3"],
                    "values": [1.0, 10.0, 2.0, 20.0, 3.0, 30.0],
                    "validity_mask": [true, true, true, true, true, true]
                }
            ]))
            .unwrap();
            let mut vtable = empty_vtable();
            let mut error = DagMlDataString::default();
            let status = unsafe {
                dagmldata_inmemory_provider_new_with_f64_features_json(
                    envelope.as_ptr(),
                    envelope.len(),
                    target_tables.as_ptr(),
                    target_tables.len(),
                    feature_matrices.as_ptr(),
                    feature_matrices.len(),
                    &mut vtable,
                    &mut error,
                )
            };
            assert_eq!(status, DagMlDataStatusCode::Ok);
            assert!(error.ptr.is_null());

            let mut data_handle = 0;
            let status = unsafe {
                vtable.materialize.unwrap()(
                    vtable.user_data,
                    0,
                    DagMlDataBytesView {
                        ptr: materialization_request.as_ptr(),
                        len: materialization_request.len(),
                    },
                    &mut data_handle,
                )
            };
            assert_eq!(status, DagMlDataStatusCode::Ok);

            let view_json = serde_json::to_vec(&serde_json::json!({
                "sample_ids": ["s1", "s2", "s3"],
                "include_augmented": false
            }))
            .unwrap();
            let mut view_handle = 0;
            let status = unsafe {
                vtable.make_view.unwrap()(
                    vtable.user_data,
                    data_handle,
                    DagMlDataBytesView {
                        ptr: view_json.as_ptr(),
                        len: view_json.len(),
                    },
                    &mut view_handle,
                )
            };
            assert_eq!(status, DagMlDataStatusCode::Ok);

            let mut feature_array = std::ptr::null_mut();
            let mut feature_schema = std::ptr::null_mut();
            let feature_set_name = b"x";
            let status = unsafe {
                vtable.feature_arrow.unwrap()(
                    vtable.user_data,
                    view_handle,
                    DagMlDataBytesView {
                        ptr: feature_set_name.as_ptr(),
                        len: feature_set_name.len(),
                    },
                    &mut feature_array,
                    &mut feature_schema,
                )
            };
            assert_eq!(status, DagMlDataStatusCode::Ok);
            unsafe {
                // Columns: [observation_id, sample_id, f0, f1] — identical for
                // every modality.
                assert_eq!((*feature_array).n_children, 4);
                let array_children = slice::from_raw_parts(
                    (*feature_array).children,
                    (*feature_array).n_children as usize,
                );
                assert_eq!(
                    utf8_values(array_children[0]),
                    vec![
                        Some("obs.s1".to_string()),
                        Some("obs.s2".to_string()),
                        Some("obs.s3".to_string()),
                    ]
                );
                assert_eq!(
                    utf8_values(array_children[1]),
                    vec![
                        Some("s1".to_string()),
                        Some("s2".to_string()),
                        Some("s3".to_string()),
                    ]
                );
                assert_eq!(
                    f64_values(array_children[2]),
                    vec![Some(1.0), Some(2.0), Some(3.0)]
                );
                assert_eq!(
                    f64_values(array_children[3]),
                    vec![Some(10.0), Some(20.0), Some(30.0)]
                );
                dagmldata_arrow_array_free(feature_array);
                dagmldata_arrow_schema_free(feature_schema);
                vtable.release.unwrap()(vtable.user_data, view_handle);
                vtable.release.unwrap()(vtable.user_data, data_handle);
                dagmldata_inmemory_provider_destroy(&mut vtable);
            }
        }
    }

    /// Companion to `inmemory_provider_materializes_modalities_through_one_provider_code_path`:
    /// the modality transport is real binding, not name special-casing. The
    /// schema/plan materialize `tabular_numeric`, but the feature buffer is
    /// tagged with a different representation (`signal_1d`). The provider binds
    /// feature buffers by representation at materialize time, so the buffer is
    /// never bound and `feature_arrow` is refused. This is what stops the
    /// positive test from passing vacuously if the provider ignored the
    /// representation.
    #[test]
    fn inmemory_provider_refuses_feature_buffer_with_mismatched_representation() {
        use dag_ml_data_core::{AxisKind, AxisSpec, RepresentationSpec};

        let materialized = RepresentationId::new("tabular_numeric").unwrap();
        let native_representation = RepresentationSpec {
            id: materialized.clone(),
            type_id: dag_ml_data_core::TypeId::new("table").unwrap(),
            rank: Some(2),
            axes: vec![
                AxisSpec {
                    name: "sample".to_string(),
                    kind: AxisKind::Sample,
                    unit: None,
                    size: Some(3),
                    variable: false,
                    coordinate: None,
                },
                AxisSpec {
                    name: "feature".to_string(),
                    kind: AxisKind::Feature,
                    unit: None,
                    size: Some(2),
                    variable: false,
                    coordinate: None,
                },
            ],
            container: "dataframe".to_string(),
            dtype: Some("float64".to_string()),
            sparse: false,
            ragged: false,
            signal_type: None,
        };
        let schema = single_source_dataset_schema("tabular", "table", native_representation);
        schema.validate().unwrap();
        let (envelope, materialization_request) =
            single_modality_provider_fixture(&schema, &materialized);

        // The feature buffer is tagged with a representation that does NOT match
        // the materialized output representation.
        let feature_matrices = serde_json::to_vec(&serde_json::json!([
            {
                "feature_set_id": "x",
                "representation_id": "signal_1d",
                "feature_names": ["f0", "f1"],
                "observation_ids": ["obs.s1", "obs.s2", "obs.s3"],
                "values": [1.0, 10.0, 2.0, 20.0, 3.0, 30.0],
                "validity_mask": [true, true, true, true, true, true]
            }
        ]))
        .unwrap();
        let target_tables = b"[]";
        let mut vtable = empty_vtable();
        let mut error = DagMlDataString::default();
        let status = unsafe {
            dagmldata_inmemory_provider_new_with_f64_features_json(
                envelope.as_ptr(),
                envelope.len(),
                target_tables.as_ptr(),
                target_tables.len(),
                feature_matrices.as_ptr(),
                feature_matrices.len(),
                &mut vtable,
                &mut error,
            )
        };
        assert_eq!(status, DagMlDataStatusCode::Ok);
        assert!(error.ptr.is_null());

        let mut data_handle = 0;
        let status = unsafe {
            vtable.materialize.unwrap()(
                vtable.user_data,
                0,
                DagMlDataBytesView {
                    ptr: materialization_request.as_ptr(),
                    len: materialization_request.len(),
                },
                &mut data_handle,
            )
        };
        assert_eq!(status, DagMlDataStatusCode::Ok);

        let view_json = serde_json::to_vec(&serde_json::json!({
            "sample_ids": ["s1", "s2", "s3"],
            "include_augmented": false
        }))
        .unwrap();
        let mut view_handle = 0;
        let status = unsafe {
            vtable.make_view.unwrap()(
                vtable.user_data,
                data_handle,
                DagMlDataBytesView {
                    ptr: view_json.as_ptr(),
                    len: view_json.len(),
                },
                &mut view_handle,
            )
        };
        assert_eq!(status, DagMlDataStatusCode::Ok);

        let mut feature_array = std::ptr::null_mut();
        let mut feature_schema = std::ptr::null_mut();
        let feature_set_name = b"x";
        let status = unsafe {
            vtable.feature_arrow.unwrap()(
                vtable.user_data,
                view_handle,
                DagMlDataBytesView {
                    ptr: feature_set_name.as_ptr(),
                    len: feature_set_name.len(),
                },
                &mut feature_array,
                &mut feature_schema,
            )
        };
        assert_eq!(status, DagMlDataStatusCode::ValidationError);
        assert!(feature_array.is_null());
        assert!(feature_schema.is_null());

        unsafe {
            vtable.release.unwrap()(vtable.user_data, view_handle);
            vtable.release.unwrap()(vtable.user_data, data_handle);
            dagmldata_inmemory_provider_destroy(&mut vtable);
        }
    }

    #[test]
    fn inmemory_provider_refuses_unbound_feature_buffers_for_source_scoped_handle() {
        let (envelope, materialization_request) = multisource_provider_fixture();
        let mut materialization_request: serde_json::Value =
            serde_json::from_slice(&materialization_request).unwrap();
        materialization_request["source_ids"] = serde_json::json!(["nir"]);
        let materialization_request = serde_json::to_vec(&materialization_request).unwrap();
        let target_tables = b"[]";
        let feature_tables = serde_json::to_vec(&serde_json::json!([
            {
                "feature_set_id": "nir_x",
                "representation_id": "tabular_numeric",
                "feature_names": ["n0"],
                "rows": [
                    {"observation_id": "obs.S001.r1", "values": [1.0]},
                    {"observation_id": "obs.S001.r2", "values": [2.0]},
                    {"observation_id": "obs.S002.r1", "values": [3.0]}
                ]
            },
            {
                "feature_set_id": "chem_x",
                "representation_id": "tabular_numeric",
                "feature_names": ["c0"],
                "rows": [
                    {"observation_id": "chem.S001", "values": [10.0]},
                    {"observation_id": "chem.S002", "values": [20.0]}
                ]
            }
        ]))
        .unwrap();
        let mut vtable = empty_vtable();
        let mut error = DagMlDataString::default();
        let status = unsafe {
            dagmldata_inmemory_provider_new_with_features_json(
                envelope.as_ptr(),
                envelope.len(),
                target_tables.as_ptr(),
                target_tables.len(),
                feature_tables.as_ptr(),
                feature_tables.len(),
                &mut vtable,
                &mut error,
            )
        };
        assert_eq!(status, DagMlDataStatusCode::Ok);
        assert!(error.ptr.is_null());

        let mut data_handle = 0;
        let status = unsafe {
            vtable.materialize.unwrap()(
                vtable.user_data,
                0,
                DagMlDataBytesView {
                    ptr: materialization_request.as_ptr(),
                    len: materialization_request.len(),
                },
                &mut data_handle,
            )
        };
        assert_eq!(status, DagMlDataStatusCode::Ok);

        let mut data_manifest_json = DagMlDataString::default();
        let mut data_manifest_error = DagMlDataString::default();
        let status = unsafe {
            dagmldata_inmemory_provider_data_feature_buffer_manifest_json(
                &vtable,
                data_handle,
                &mut data_manifest_json,
                &mut data_manifest_error,
            )
        };
        assert_eq!(status, DagMlDataStatusCode::Ok);
        assert!(data_manifest_error.ptr.is_null());
        let manifests: serde_json::Value =
            serde_json::from_str(&unsafe { string_value(data_manifest_json) }).unwrap();
        assert_eq!(manifests.as_array().unwrap().len(), 1);
        assert_eq!(manifests[0]["feature_set_id"], serde_json::json!("nir_x"));
        assert_eq!(manifests[0]["source_ids"], serde_json::json!(["nir"]));

        let view_json = serde_json::to_vec(&serde_json::json!({
            "sample_ids": ["S001", "S002"],
            "include_augmented": false
        }))
        .unwrap();
        let mut view_handle = 0;
        let status = unsafe {
            vtable.make_view.unwrap()(
                vtable.user_data,
                data_handle,
                DagMlDataBytesView {
                    ptr: view_json.as_ptr(),
                    len: view_json.len(),
                },
                &mut view_handle,
            )
        };
        assert_eq!(status, DagMlDataStatusCode::Ok);

        let mut chem_array = std::ptr::null_mut();
        let mut chem_schema = std::ptr::null_mut();
        let feature_set_name = b"chem_x";
        let status = unsafe {
            vtable.feature_arrow.unwrap()(
                vtable.user_data,
                view_handle,
                DagMlDataBytesView {
                    ptr: feature_set_name.as_ptr(),
                    len: feature_set_name.len(),
                },
                &mut chem_array,
                &mut chem_schema,
            )
        };
        assert_eq!(status, DagMlDataStatusCode::ValidationError);
        assert!(chem_array.is_null());
        assert!(chem_schema.is_null());

        let selector = serde_json::to_vec(&serde_json::json!({
            "fusion": {
                "schema_version": 1,
                "feature_set_id": "bad_fused",
                "sources": [
                    {"source_id": "chem", "feature_set_id": "chem_x"}
                ],
                "alignment": {
                    "mode": "inner",
                    "sample_ids": ["S001", "S002"],
                    "masks": [
                        {"source_id": "chem", "sample_ids": ["S001", "S002"], "present": [true, true]}
                    ]
                }
            },
            "policy": {
                "emit_mask": true
            }
        }))
        .unwrap();
        let mut out_json = DagMlDataString::default();
        let mut error = DagMlDataString::default();
        let status = unsafe {
            dagmldata_inmemory_provider_feature_collation_json(
                &vtable,
                view_handle,
                DagMlDataBytesView {
                    ptr: selector.as_ptr(),
                    len: selector.len(),
                },
                &mut out_json,
                &mut error,
            )
        };
        assert_eq!(status, DagMlDataStatusCode::ValidationError);
        assert!(out_json.ptr.is_null());
        unsafe {
            dagmldata_string_free(error);
        }

        let mut tensor = DagMlDataTensorF64::default();
        let mut error = DagMlDataString::default();
        let status = unsafe {
            dagmldata_inmemory_provider_feature_collation_tensor_f64_json(
                &vtable,
                view_handle,
                DagMlDataBytesView {
                    ptr: selector.as_ptr(),
                    len: selector.len(),
                },
                &mut tensor,
                &mut error,
            )
        };
        assert_eq!(status, DagMlDataStatusCode::ValidationError);
        assert!(tensor.values.ptr.is_null());
        unsafe {
            dagmldata_string_free(error);
            vtable.release.unwrap()(vtable.user_data, view_handle);
            vtable.release.unwrap()(vtable.user_data, data_handle);
            dagmldata_inmemory_provider_destroy(&mut vtable);
        }
    }

    #[test]
    fn inmemory_provider_accepts_typed_f64_feature_matrices() {
        let envelope = include_bytes!(
            "../../../examples/fixtures/oof_campaign/coordinator_data_plan_envelope_nir.json"
        );
        let materialization_request = include_bytes!(
            "../../../examples/fixtures/oof_campaign/materialization_request_model_base_x.json"
        );
        let target_tables = b"[]";
        let feature_matrices = serde_json::to_vec(&serde_json::json!([
            {
                "feature_set_id": "x",
                "representation_id": "tabular_numeric",
                "feature_names": ["f0", "f1"],
                "observation_ids": [
                    "obs.S001.base",
                    "obs.S001.rep1",
                    "obs.S001.aug0",
                    "obs.S002.base"
                ],
                "values": [1.0, 10.0, 2.0, 20.0, 3.0, 30.0, 4.0, 0.0],
                "validity_mask": [true, true, true, true, true, true, true, false]
            }
        ]))
        .unwrap();
        let mut vtable = empty_vtable();
        let mut error = DagMlDataString::default();

        let status = unsafe {
            dagmldata_inmemory_provider_new_with_f64_features_json(
                envelope.as_ptr(),
                envelope.len(),
                target_tables.as_ptr(),
                target_tables.len(),
                feature_matrices.as_ptr(),
                feature_matrices.len(),
                &mut vtable,
                &mut error,
            )
        };
        assert_eq!(status, DagMlDataStatusCode::Ok);
        assert!(error.ptr.is_null());

        let mut data_handle = 0;
        let status = unsafe {
            vtable.materialize.unwrap()(
                vtable.user_data,
                0,
                DagMlDataBytesView {
                    ptr: materialization_request.as_ptr(),
                    len: materialization_request.len(),
                },
                &mut data_handle,
            )
        };
        assert_eq!(status, DagMlDataStatusCode::Ok);

        let view_json = serde_json::to_vec(&serde_json::json!({
            "sample_ids": ["S002", "S001"],
            "include_augmented": false
        }))
        .unwrap();
        let mut view_handle = 0;
        let status = unsafe {
            vtable.make_view.unwrap()(
                vtable.user_data,
                data_handle,
                DagMlDataBytesView {
                    ptr: view_json.as_ptr(),
                    len: view_json.len(),
                },
                &mut view_handle,
            )
        };
        assert_eq!(status, DagMlDataStatusCode::Ok);

        let mut feature_array = std::ptr::null_mut();
        let mut feature_schema = std::ptr::null_mut();
        let feature_set_name = b"x";
        let status = unsafe {
            vtable.feature_arrow.unwrap()(
                vtable.user_data,
                view_handle,
                DagMlDataBytesView {
                    ptr: feature_set_name.as_ptr(),
                    len: feature_set_name.len(),
                },
                &mut feature_array,
                &mut feature_schema,
            )
        };
        assert_eq!(status, DagMlDataStatusCode::Ok);
        unsafe {
            let array_children = slice::from_raw_parts(
                (*feature_array).children,
                (*feature_array).n_children as usize,
            );
            assert_eq!(
                utf8_values(array_children[0]),
                vec![
                    Some("obs.S002.base".to_string()),
                    Some("obs.S001.base".to_string()),
                    Some("obs.S001.rep1".to_string()),
                ]
            );
            assert_eq!(
                f64_values(array_children[2]),
                vec![Some(4.0), Some(1.0), Some(2.0)]
            );
            assert_eq!(
                f64_values(array_children[3]),
                vec![None, Some(10.0), Some(20.0)]
            );
            dagmldata_arrow_array_free(feature_array);
            dagmldata_arrow_schema_free(feature_schema);
        }

        let selector = serde_json::to_vec(&serde_json::json!({
            "feature_set_id": "x",
            "policy": {
                "emit_mask": true
            }
        }))
        .unwrap();
        let mut tensor = DagMlDataTensorF64::default();
        let mut error = DagMlDataString::default();
        let status = unsafe {
            dagmldata_inmemory_provider_feature_collation_tensor_f64_json(
                &vtable,
                view_handle,
                DagMlDataBytesView {
                    ptr: selector.as_ptr(),
                    len: selector.len(),
                },
                &mut tensor,
                &mut error,
            )
        };
        assert_eq!(status, DagMlDataStatusCode::Ok);
        assert!(error.ptr.is_null());
        unsafe {
            assert_eq!(usize_array_values(tensor.shape), vec![3, 2]);
            assert_eq!(
                f64_array_values(tensor.values),
                vec![4.0, 0.0, 1.0, 10.0, 2.0, 20.0]
            );
            assert_eq!(
                u8_array_values(tensor.validity_mask),
                vec![1, 0, 1, 1, 1, 1]
            );
            dagmldata_tensor_f64_free(tensor);
            vtable.release.unwrap()(vtable.user_data, view_handle);
            vtable.release.unwrap()(vtable.user_data, data_handle);
            dagmldata_inmemory_provider_destroy(&mut vtable);
        }
    }

    #[test]
    fn inmemory_provider_accepts_borrowed_f64_feature_matrix_views() {
        let envelope = include_bytes!(
            "../../../examples/fixtures/oof_campaign/coordinator_data_plan_envelope_nir.json"
        );
        let materialization_request = include_bytes!(
            "../../../examples/fixtures/oof_campaign/materialization_request_model_base_x.json"
        );
        let target_tables = b"[]";
        let feature_names = [bytes_view(b"f0"), bytes_view(b"f1")];
        let observation_ids = [
            bytes_view(b"obs.S001.base"),
            bytes_view(b"obs.S001.rep1"),
            bytes_view(b"obs.S001.aug0"),
            bytes_view(b"obs.S002.base"),
        ];
        let values = [1.0, 10.0, 2.0, 20.0, 3.0, 30.0, 4.0, 0.0];
        let validity_mask = [1_u8, 1, 1, 1, 1, 1, 1, 0];
        let matrices = [DagMlDataFeatureMatrixF64View {
            feature_set_id: bytes_view(b"x"),
            representation_id: bytes_view(b"tabular_numeric"),
            feature_names: feature_names.as_ptr(),
            feature_names_len: feature_names.len(),
            observation_ids: observation_ids.as_ptr(),
            observation_ids_len: observation_ids.len(),
            values: values.as_ptr(),
            values_len: values.len(),
            validity_mask: validity_mask.as_ptr(),
            validity_mask_len: validity_mask.len(),
        }];
        let mut vtable = empty_vtable();
        let mut error = DagMlDataString::default();

        let status = unsafe {
            dagmldata_inmemory_provider_new_with_f64_feature_views(
                envelope.as_ptr(),
                envelope.len(),
                target_tables.as_ptr(),
                target_tables.len(),
                matrices.as_ptr(),
                matrices.len(),
                &mut vtable,
                &mut error,
            )
        };
        assert_eq!(status, DagMlDataStatusCode::Ok);
        assert!(error.ptr.is_null());

        let mut data_handle = 0;
        let status = unsafe {
            vtable.materialize.unwrap()(
                vtable.user_data,
                0,
                DagMlDataBytesView {
                    ptr: materialization_request.as_ptr(),
                    len: materialization_request.len(),
                },
                &mut data_handle,
            )
        };
        assert_eq!(status, DagMlDataStatusCode::Ok);

        let mut manifest_json = DagMlDataString::default();
        let status = unsafe {
            dagmldata_inmemory_provider_data_feature_buffer_manifest_json(
                &vtable,
                data_handle,
                &mut manifest_json,
                &mut error,
            )
        };
        assert_eq!(status, DagMlDataStatusCode::Ok);
        let manifests: serde_json::Value =
            serde_json::from_str(&unsafe { string_value(manifest_json) }).unwrap();
        assert_eq!(manifests[0]["feature_set_id"], serde_json::json!("x"));
        assert_eq!(manifests[0]["source_ids"], serde_json::json!(["nir"]));

        let mut invalid_vtable = empty_vtable();
        let invalid_mask = [2_u8];
        let invalid = [DagMlDataFeatureMatrixF64View {
            validity_mask: invalid_mask.as_ptr(),
            validity_mask_len: invalid_mask.len(),
            ..matrices[0]
        }];
        let status = unsafe {
            dagmldata_inmemory_provider_new_with_f64_feature_views(
                envelope.as_ptr(),
                envelope.len(),
                target_tables.as_ptr(),
                target_tables.len(),
                invalid.as_ptr(),
                invalid.len(),
                &mut invalid_vtable,
                &mut error,
            )
        };
        assert_eq!(status, DagMlDataStatusCode::ValidationError);
        assert!(invalid_vtable.user_data.is_null());
        unsafe {
            dagmldata_string_free(error);
            vtable.release.unwrap()(vtable.user_data, data_handle);
            dagmldata_inmemory_provider_destroy(&mut vtable);
        }
    }

    #[test]
    fn inmemory_provider_accepts_borrowed_f64_feature_matrix_columnar_views() {
        let envelope = include_bytes!(
            "../../../examples/fixtures/oof_campaign/coordinator_data_plan_envelope_nir.json"
        );
        let materialization_request = include_bytes!(
            "../../../examples/fixtures/oof_campaign/materialization_request_model_base_x.json"
        );
        let target_tables = b"[]";
        let feature_names = [bytes_view(b"f0"), bytes_view(b"f1")];
        let observation_ids = [
            bytes_view(b"obs.S001.base"),
            bytes_view(b"obs.S001.rep1"),
            bytes_view(b"obs.S001.aug0"),
            bytes_view(b"obs.S002.base"),
        ];
        let f0_values = [1.0_f64, 2.0, 3.0, 4.0];
        let f1_values = [10.0_f64, 20.0, 30.0, 0.0];
        let f0_mask = [1_u8, 1, 1, 1];
        let f1_mask = [1_u8, 1, 1, 0];
        let columns = [
            DagMlDataF64ColumnView {
                values: f0_values.as_ptr(),
                values_len: f0_values.len(),
                validity_mask: f0_mask.as_ptr(),
                validity_mask_len: f0_mask.len(),
            },
            DagMlDataF64ColumnView {
                values: f1_values.as_ptr(),
                values_len: f1_values.len(),
                validity_mask: f1_mask.as_ptr(),
                validity_mask_len: f1_mask.len(),
            },
        ];
        let matrices = [DagMlDataFeatureMatrixF64ColumnarView {
            feature_set_id: bytes_view(b"x"),
            representation_id: bytes_view(b"tabular_numeric"),
            feature_names: feature_names.as_ptr(),
            feature_names_len: feature_names.len(),
            observation_ids: observation_ids.as_ptr(),
            observation_ids_len: observation_ids.len(),
            columns: columns.as_ptr(),
            columns_len: columns.len(),
        }];
        let mut vtable = empty_vtable();
        let mut error = DagMlDataString::default();

        let status = unsafe {
            dagmldata_inmemory_provider_new_with_f64_feature_columns(
                envelope.as_ptr(),
                envelope.len(),
                target_tables.as_ptr(),
                target_tables.len(),
                matrices.as_ptr(),
                matrices.len(),
                &mut vtable,
                &mut error,
            )
        };
        assert_eq!(status, DagMlDataStatusCode::Ok);
        assert!(error.ptr.is_null());

        let mut data_handle = 0;
        let status = unsafe {
            vtable.materialize.unwrap()(
                vtable.user_data,
                0,
                DagMlDataBytesView {
                    ptr: materialization_request.as_ptr(),
                    len: materialization_request.len(),
                },
                &mut data_handle,
            )
        };
        assert_eq!(status, DagMlDataStatusCode::Ok);

        let mut manifest_json = DagMlDataString::default();
        let status = unsafe {
            dagmldata_inmemory_provider_data_feature_buffer_manifest_json(
                &vtable,
                data_handle,
                &mut manifest_json,
                &mut error,
            )
        };
        assert_eq!(status, DagMlDataStatusCode::Ok);
        let manifests: serde_json::Value =
            serde_json::from_str(&unsafe { string_value(manifest_json) }).unwrap();
        assert_eq!(manifests[0]["feature_set_id"], serde_json::json!("x"));
        assert_eq!(manifests[0]["source_ids"], serde_json::json!(["nir"]));

        let mut invalid_vtable = empty_vtable();
        let short_column = [1.0_f64, 2.0];
        let invalid_columns = [DagMlDataF64ColumnView {
            values: short_column.as_ptr(),
            values_len: short_column.len(),
            validity_mask: std::ptr::null(),
            validity_mask_len: 0,
        }];
        let invalid = [DagMlDataFeatureMatrixF64ColumnarView {
            feature_set_id: bytes_view(b"x"),
            representation_id: bytes_view(b"tabular_numeric"),
            feature_names: feature_names.as_ptr(),
            feature_names_len: 1,
            observation_ids: observation_ids.as_ptr(),
            observation_ids_len: observation_ids.len(),
            columns: invalid_columns.as_ptr(),
            columns_len: invalid_columns.len(),
        }];
        let status = unsafe {
            dagmldata_inmemory_provider_new_with_f64_feature_columns(
                envelope.as_ptr(),
                envelope.len(),
                target_tables.as_ptr(),
                target_tables.len(),
                invalid.as_ptr(),
                invalid.len(),
                &mut invalid_vtable,
                &mut error,
            )
        };
        assert_eq!(status, DagMlDataStatusCode::ValidationError);
        assert!(invalid_vtable.user_data.is_null());

        let mut invalid_mask_vtable = empty_vtable();
        let bad_mask = [2_u8, 1, 1, 1];
        let bad_mask_columns = [
            DagMlDataF64ColumnView {
                values: f0_values.as_ptr(),
                values_len: f0_values.len(),
                validity_mask: bad_mask.as_ptr(),
                validity_mask_len: bad_mask.len(),
            },
            DagMlDataF64ColumnView {
                values: f1_values.as_ptr(),
                values_len: f1_values.len(),
                validity_mask: f1_mask.as_ptr(),
                validity_mask_len: f1_mask.len(),
            },
        ];
        let bad_mask_matrices = [DagMlDataFeatureMatrixF64ColumnarView {
            feature_set_id: bytes_view(b"x"),
            representation_id: bytes_view(b"tabular_numeric"),
            feature_names: feature_names.as_ptr(),
            feature_names_len: feature_names.len(),
            observation_ids: observation_ids.as_ptr(),
            observation_ids_len: observation_ids.len(),
            columns: bad_mask_columns.as_ptr(),
            columns_len: bad_mask_columns.len(),
        }];
        let status = unsafe {
            dagmldata_inmemory_provider_new_with_f64_feature_columns(
                envelope.as_ptr(),
                envelope.len(),
                target_tables.as_ptr(),
                target_tables.len(),
                bad_mask_matrices.as_ptr(),
                bad_mask_matrices.len(),
                &mut invalid_mask_vtable,
                &mut error,
            )
        };
        assert_eq!(status, DagMlDataStatusCode::ValidationError);
        assert!(invalid_mask_vtable.user_data.is_null());

        let mut mixed_mask_vtable = empty_vtable();
        let mixed_mask_columns = [
            DagMlDataF64ColumnView {
                values: f0_values.as_ptr(),
                values_len: f0_values.len(),
                validity_mask: std::ptr::null(),
                validity_mask_len: 0,
            },
            DagMlDataF64ColumnView {
                values: f1_values.as_ptr(),
                values_len: f1_values.len(),
                validity_mask: f1_mask.as_ptr(),
                validity_mask_len: f1_mask.len(),
            },
        ];
        let mixed_mask_matrices = [DagMlDataFeatureMatrixF64ColumnarView {
            feature_set_id: bytes_view(b"x"),
            representation_id: bytes_view(b"tabular_numeric"),
            feature_names: feature_names.as_ptr(),
            feature_names_len: feature_names.len(),
            observation_ids: observation_ids.as_ptr(),
            observation_ids_len: observation_ids.len(),
            columns: mixed_mask_columns.as_ptr(),
            columns_len: mixed_mask_columns.len(),
        }];
        let status = unsafe {
            dagmldata_inmemory_provider_new_with_f64_feature_columns(
                envelope.as_ptr(),
                envelope.len(),
                target_tables.as_ptr(),
                target_tables.len(),
                mixed_mask_matrices.as_ptr(),
                mixed_mask_matrices.len(),
                &mut mixed_mask_vtable,
                &mut error,
            )
        };
        assert_eq!(status, DagMlDataStatusCode::ValidationError);
        assert!(mixed_mask_vtable.user_data.is_null());
        let mixed_mask_error = unsafe { string_value(error) };
        assert!(
            mixed_mask_error.contains("either all columns must supply a validity_mask or none"),
            "unexpected mixed-mask error: {mixed_mask_error}"
        );

        unsafe {
            vtable.release.unwrap()(vtable.user_data, data_handle);
            dagmldata_inmemory_provider_destroy(&mut vtable);
        }
    }

    #[test]
    fn file_backed_provider_loads_persisted_buffer_store() {
        use dag_ml_data_core::buffer::{
            NumericFeatureBufferStore, NumericFeatureMatrixF64Columnar,
        };
        use dag_ml_data_core::ids::{ObservationId, RepresentationId};

        let matrix = NumericFeatureMatrixF64Columnar {
            feature_set_id: "x".to_string(),
            representation_id: RepresentationId::new("tabular_numeric").unwrap(),
            feature_names: vec!["f0".to_string(), "f1".to_string()],
            observation_ids: vec![
                ObservationId::new("obs.S001.base").unwrap(),
                ObservationId::new("obs.S001.rep1").unwrap(),
                ObservationId::new("obs.S001.aug0").unwrap(),
                ObservationId::new("obs.S002.base").unwrap(),
            ],
            columns: vec![vec![1.0, 2.0, 3.0, 4.0], vec![10.0, 20.0, 30.0, 40.0]],
            validity_masks: None,
        };
        let store = NumericFeatureBufferStore::from_f64_column_matrices(vec![matrix]).unwrap();
        let path = std::env::temp_dir().join(format!(
            "dag_ml_data_file_backed_provider_{}.n4d",
            std::process::id()
        ));
        dag_ml_data_core::buffer_file_store::write_store_to_path(&store, &path).unwrap();

        let envelope = include_bytes!(
            "../../../examples/fixtures/oof_campaign/coordinator_data_plan_envelope_nir.json"
        );
        let materialization_request = include_bytes!(
            "../../../examples/fixtures/oof_campaign/materialization_request_model_base_x.json"
        );
        let target_tables = b"[]";
        let path_str = path.to_string_lossy().into_owned();
        let path_bytes = path_str.as_bytes();
        let mut vtable = empty_vtable();
        let mut error = DagMlDataString::default();

        let status = unsafe {
            dagmldata_inmemory_provider_new_from_file(
                envelope.as_ptr(),
                envelope.len(),
                target_tables.as_ptr(),
                target_tables.len(),
                path_bytes.as_ptr(),
                path_bytes.len(),
                &mut vtable,
                &mut error,
            )
        };
        assert_eq!(status, DagMlDataStatusCode::Ok);
        assert!(error.ptr.is_null());

        let mut data_handle = 0;
        let status = unsafe {
            vtable.materialize.unwrap()(
                vtable.user_data,
                0,
                DagMlDataBytesView {
                    ptr: materialization_request.as_ptr(),
                    len: materialization_request.len(),
                },
                &mut data_handle,
            )
        };
        assert_eq!(status, DagMlDataStatusCode::Ok);

        let mut manifest_json = DagMlDataString::default();
        let status = unsafe {
            dagmldata_inmemory_provider_data_feature_buffer_manifest_json(
                &vtable,
                data_handle,
                &mut manifest_json,
                &mut error,
            )
        };
        assert_eq!(status, DagMlDataStatusCode::Ok);
        let manifests: serde_json::Value =
            serde_json::from_str(&unsafe { string_value(manifest_json) }).unwrap();
        assert_eq!(manifests[0]["feature_set_id"], serde_json::json!("x"));

        unsafe {
            vtable.release.unwrap()(vtable.user_data, data_handle);
            dagmldata_inmemory_provider_destroy(&mut vtable);
        }
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn file_backed_provider_rejects_missing_path() {
        let envelope = include_bytes!(
            "../../../examples/fixtures/oof_campaign/coordinator_data_plan_envelope_nir.json"
        );
        let missing_path = b"/tmp/dag_ml_data_definitely_missing.n4d";
        let mut vtable = empty_vtable();
        let mut error = DagMlDataString::default();
        let status = unsafe {
            dagmldata_inmemory_provider_new_from_file(
                envelope.as_ptr(),
                envelope.len(),
                b"[]".as_ptr(),
                2,
                missing_path.as_ptr(),
                missing_path.len(),
                &mut vtable,
                &mut error,
            )
        };
        assert_eq!(status, DagMlDataStatusCode::ValidationError);
        assert!(vtable.user_data.is_null());
        let message = unsafe { string_value(error) };
        assert!(
            message.contains("failed to read feature buffer store"),
            "unexpected: {message}"
        );
    }

    struct FetcherTestState {
        f0_values: Vec<f64>,
        f0_mask: Vec<u8>,
        f1_values: Vec<f64>,
        f1_mask: Vec<u8>,
        feature_set_id: Vec<u8>,
        representation_id: Vec<u8>,
        feature_names: Vec<DagMlDataBytesView>,
        observation_ids: Vec<DagMlDataBytesView>,
        columns_storage: Vec<DagMlDataF64ColumnView>,
        feature_name_strings: Vec<Vec<u8>>,
        observation_id_strings: Vec<Vec<u8>>,
        destroyed: bool,
    }

    impl FetcherTestState {
        fn new() -> Self {
            let feature_name_strings = vec![b"f0".to_vec(), b"f1".to_vec()];
            let observation_id_strings = vec![
                b"obs.S001.base".to_vec(),
                b"obs.S001.rep1".to_vec(),
                b"obs.S001.aug0".to_vec(),
                b"obs.S002.base".to_vec(),
            ];
            FetcherTestState {
                f0_values: vec![1.0, 2.0, 3.0, 4.0],
                f0_mask: vec![1, 1, 1, 1],
                f1_values: vec![10.0, 20.0, 30.0, 40.0],
                f1_mask: vec![1, 1, 1, 1],
                feature_set_id: b"x".to_vec(),
                representation_id: b"tabular_numeric".to_vec(),
                feature_names: Vec::new(),
                observation_ids: Vec::new(),
                columns_storage: Vec::new(),
                feature_name_strings,
                observation_id_strings,
                destroyed: false,
            }
        }
    }

    unsafe extern "C" fn fetcher_callback(
        user_data: *mut c_void,
        feature_set_id: DagMlDataBytesView,
        _content_fingerprint: DagMlDataBytesView,
        out_view: *mut DagMlDataFeatureMatrixF64ColumnarView,
        error_out: *mut DagMlDataString,
    ) -> DagMlDataStatusCode {
        let state = &mut *user_data.cast::<FetcherTestState>();
        let requested = std::slice::from_raw_parts(feature_set_id.ptr, feature_set_id.len);
        if requested != state.feature_set_id.as_slice() {
            set_error_message(error_out, "fetcher saw unexpected feature_set_id");
            return DagMlDataStatusCode::ValidationError;
        }
        state.feature_names = state
            .feature_name_strings
            .iter()
            .map(|name| DagMlDataBytesView {
                ptr: name.as_ptr(),
                len: name.len(),
            })
            .collect();
        state.observation_ids = state
            .observation_id_strings
            .iter()
            .map(|id| DagMlDataBytesView {
                ptr: id.as_ptr(),
                len: id.len(),
            })
            .collect();
        state.columns_storage = vec![
            DagMlDataF64ColumnView {
                values: state.f0_values.as_ptr(),
                values_len: state.f0_values.len(),
                validity_mask: state.f0_mask.as_ptr(),
                validity_mask_len: state.f0_mask.len(),
            },
            DagMlDataF64ColumnView {
                values: state.f1_values.as_ptr(),
                values_len: state.f1_values.len(),
                validity_mask: state.f1_mask.as_ptr(),
                validity_mask_len: state.f1_mask.len(),
            },
        ];
        *out_view = DagMlDataFeatureMatrixF64ColumnarView {
            feature_set_id: DagMlDataBytesView {
                ptr: state.feature_set_id.as_ptr(),
                len: state.feature_set_id.len(),
            },
            representation_id: DagMlDataBytesView {
                ptr: state.representation_id.as_ptr(),
                len: state.representation_id.len(),
            },
            feature_names: state.feature_names.as_ptr(),
            feature_names_len: state.feature_names.len(),
            observation_ids: state.observation_ids.as_ptr(),
            observation_ids_len: state.observation_ids.len(),
            columns: state.columns_storage.as_ptr(),
            columns_len: state.columns_storage.len(),
        };
        DagMlDataStatusCode::Ok
    }

    unsafe extern "C" fn fetcher_destroy(user_data: *mut c_void) {
        let state = &mut *user_data.cast::<FetcherTestState>();
        state.destroyed = true;
    }

    unsafe extern "C" fn fetcher_failure(
        _user_data: *mut c_void,
        _feature_set_id: DagMlDataBytesView,
        _content_fingerprint: DagMlDataBytesView,
        _out_view: *mut DagMlDataFeatureMatrixF64ColumnarView,
        error_out: *mut DagMlDataString,
    ) -> DagMlDataStatusCode {
        set_error_message(error_out, "fetcher deliberately refused");
        DagMlDataStatusCode::ValidationError
    }

    /// Misbehaving callback: writes the columnar view normally AND
    /// populates `error_out` even though it returns `Ok`. The provider
    /// must free that error string defensively so we do not leak host
    /// memory. Verified by inspection rather than a Miri leak check.
    unsafe extern "C" fn fetcher_ok_with_error_string(
        user_data: *mut c_void,
        feature_set_id: DagMlDataBytesView,
        content_fingerprint: DagMlDataBytesView,
        out_view: *mut DagMlDataFeatureMatrixF64ColumnarView,
        error_out: *mut DagMlDataString,
    ) -> DagMlDataStatusCode {
        let status = fetcher_callback(
            user_data,
            feature_set_id,
            content_fingerprint,
            out_view,
            error_out,
        );
        set_error_message(error_out, "ignored on success");
        status
    }

    #[test]
    fn buffer_fetcher_provider_loads_columnar_matrix_through_callback() {
        let envelope = include_bytes!(
            "../../../examples/fixtures/oof_campaign/coordinator_data_plan_envelope_nir.json"
        );
        let materialization_request = include_bytes!(
            "../../../examples/fixtures/oof_campaign/materialization_request_model_base_x.json"
        );
        let mut state = FetcherTestState::new();
        let fetcher = DagMlDataBufferFetcherVTable {
            abi_version: DAG_ML_DATA_BUFFER_FETCHER_ABI_VERSION,
            user_data: (&mut state as *mut FetcherTestState).cast::<c_void>(),
            fetch_columnar: Some(fetcher_callback),
            destroy: Some(fetcher_destroy),
        };
        let feature_set = b"x";
        let fingerprint = b"deadbeef".to_vec();
        let requests = [DagMlDataBufferFetchRequest {
            feature_set_id: DagMlDataBytesView {
                ptr: feature_set.as_ptr(),
                len: feature_set.len(),
            },
            content_fingerprint: DagMlDataBytesView {
                ptr: fingerprint.as_ptr(),
                len: fingerprint.len(),
            },
        }];
        let mut vtable = empty_vtable();
        let mut error = DagMlDataString::default();
        let status = unsafe {
            dagmldata_inmemory_provider_new_with_buffer_fetcher(
                envelope.as_ptr(),
                envelope.len(),
                b"[]".as_ptr(),
                2,
                fetcher,
                requests.as_ptr(),
                requests.len(),
                &mut vtable,
                &mut error,
            )
        };
        assert_eq!(status, DagMlDataStatusCode::Ok);
        assert!(error.ptr.is_null());
        assert!(
            state.destroyed,
            "fetcher destroy must be invoked exactly once"
        );

        let mut data_handle = 0;
        let status = unsafe {
            vtable.materialize.unwrap()(
                vtable.user_data,
                0,
                DagMlDataBytesView {
                    ptr: materialization_request.as_ptr(),
                    len: materialization_request.len(),
                },
                &mut data_handle,
            )
        };
        assert_eq!(status, DagMlDataStatusCode::Ok);

        let mut manifest_json = DagMlDataString::default();
        let status = unsafe {
            dagmldata_inmemory_provider_data_feature_buffer_manifest_json(
                &vtable,
                data_handle,
                &mut manifest_json,
                &mut error,
            )
        };
        assert_eq!(status, DagMlDataStatusCode::Ok);
        let manifests: serde_json::Value =
            serde_json::from_str(&unsafe { string_value(manifest_json) }).unwrap();
        assert_eq!(manifests[0]["feature_set_id"], serde_json::json!("x"));

        unsafe {
            vtable.release.unwrap()(vtable.user_data, data_handle);
            dagmldata_inmemory_provider_destroy(&mut vtable);
        }
    }

    #[test]
    fn buffer_fetcher_provider_propagates_callback_failure_and_invokes_destroy() {
        let envelope = include_bytes!(
            "../../../examples/fixtures/oof_campaign/coordinator_data_plan_envelope_nir.json"
        );
        let mut state = FetcherTestState::new();
        let fetcher = DagMlDataBufferFetcherVTable {
            abi_version: DAG_ML_DATA_BUFFER_FETCHER_ABI_VERSION,
            user_data: (&mut state as *mut FetcherTestState).cast::<c_void>(),
            fetch_columnar: Some(fetcher_failure),
            destroy: Some(fetcher_destroy),
        };
        let feature_set = b"x";
        let fingerprint = b"deadbeef".to_vec();
        let requests = [DagMlDataBufferFetchRequest {
            feature_set_id: DagMlDataBytesView {
                ptr: feature_set.as_ptr(),
                len: feature_set.len(),
            },
            content_fingerprint: DagMlDataBytesView {
                ptr: fingerprint.as_ptr(),
                len: fingerprint.len(),
            },
        }];
        let mut vtable = empty_vtable();
        let mut error = DagMlDataString::default();
        let status = unsafe {
            dagmldata_inmemory_provider_new_with_buffer_fetcher(
                envelope.as_ptr(),
                envelope.len(),
                b"[]".as_ptr(),
                2,
                fetcher,
                requests.as_ptr(),
                requests.len(),
                &mut vtable,
                &mut error,
            )
        };
        assert_eq!(status, DagMlDataStatusCode::ValidationError);
        assert!(vtable.user_data.is_null());
        assert!(state.destroyed, "destroy must run even when fetcher fails");
        let message = unsafe { string_value(error) };
        assert!(
            message.contains("fetcher deliberately refused"),
            "unexpected: {message}"
        );
    }

    #[test]
    fn buffer_fetcher_provider_frees_error_string_on_success_path() {
        let envelope = include_bytes!(
            "../../../examples/fixtures/oof_campaign/coordinator_data_plan_envelope_nir.json"
        );
        let materialization_request = include_bytes!(
            "../../../examples/fixtures/oof_campaign/materialization_request_model_base_x.json"
        );
        let mut state = FetcherTestState::new();
        let fetcher = DagMlDataBufferFetcherVTable {
            abi_version: DAG_ML_DATA_BUFFER_FETCHER_ABI_VERSION,
            user_data: (&mut state as *mut FetcherTestState).cast::<c_void>(),
            fetch_columnar: Some(fetcher_ok_with_error_string),
            destroy: Some(fetcher_destroy),
        };
        let feature_set = b"x";
        let fingerprint = b"deadbeef".to_vec();
        let requests = [DagMlDataBufferFetchRequest {
            feature_set_id: DagMlDataBytesView {
                ptr: feature_set.as_ptr(),
                len: feature_set.len(),
            },
            content_fingerprint: DagMlDataBytesView {
                ptr: fingerprint.as_ptr(),
                len: fingerprint.len(),
            },
        }];
        let mut vtable = empty_vtable();
        let mut error = DagMlDataString::default();
        let status = unsafe {
            dagmldata_inmemory_provider_new_with_buffer_fetcher(
                envelope.as_ptr(),
                envelope.len(),
                b"[]".as_ptr(),
                2,
                fetcher,
                requests.as_ptr(),
                requests.len(),
                &mut vtable,
                &mut error,
            )
        };
        assert_eq!(status, DagMlDataStatusCode::Ok);
        assert!(error.ptr.is_null());
        // The constructor must have consumed the spurious error string the
        // callback wrote despite returning Ok; the public `error_out`
        // remains untouched on the success path.

        let mut data_handle = 0;
        let status = unsafe {
            vtable.materialize.unwrap()(
                vtable.user_data,
                0,
                DagMlDataBytesView {
                    ptr: materialization_request.as_ptr(),
                    len: materialization_request.len(),
                },
                &mut data_handle,
            )
        };
        assert_eq!(status, DagMlDataStatusCode::Ok);
        unsafe {
            vtable.release.unwrap()(vtable.user_data, data_handle);
            dagmldata_inmemory_provider_destroy(&mut vtable);
        }
    }

    #[test]
    fn buffer_fetcher_provider_rejects_wrong_abi_version() {
        let envelope = include_bytes!(
            "../../../examples/fixtures/oof_campaign/coordinator_data_plan_envelope_nir.json"
        );
        let mut state = FetcherTestState::new();
        let fetcher = DagMlDataBufferFetcherVTable {
            abi_version: DAG_ML_DATA_BUFFER_FETCHER_ABI_VERSION + 1,
            user_data: (&mut state as *mut FetcherTestState).cast::<c_void>(),
            fetch_columnar: Some(fetcher_callback),
            destroy: Some(fetcher_destroy),
        };
        let mut vtable = empty_vtable();
        let mut error = DagMlDataString::default();
        let status = unsafe {
            dagmldata_inmemory_provider_new_with_buffer_fetcher(
                envelope.as_ptr(),
                envelope.len(),
                b"[]".as_ptr(),
                2,
                fetcher,
                std::ptr::null(),
                0,
                &mut vtable,
                &mut error,
            )
        };
        assert_eq!(status, DagMlDataStatusCode::InvalidArgument);
        assert!(state.destroyed, "destroy must run on abi version mismatch");
        let message = unsafe { string_value(error) };
        assert!(message.contains("abi_version"), "unexpected: {message}");
    }

    #[cfg(feature = "arrow-ipc")]
    #[test]
    fn arrow_ipc_provider_loads_buffer_store_from_disk() {
        use arrow_array::{Float64Array, RecordBatch, StringArray};
        use arrow_ipc::writer::FileWriter;
        use arrow_schema::{DataType, Field, Schema};
        use std::collections::HashMap;
        use std::sync::Arc;

        let mut metadata = HashMap::new();
        metadata.insert("dag_ml_data.feature_set_id".to_string(), "x".to_string());
        metadata.insert(
            "dag_ml_data.representation_id".to_string(),
            "tabular_numeric".to_string(),
        );
        let schema = Arc::new(Schema::new_with_metadata(
            vec![
                Field::new("observation_id", DataType::Utf8, false),
                Field::new("f0", DataType::Float64, true),
                Field::new("f1", DataType::Float64, true),
            ],
            metadata,
        ));
        let batch = RecordBatch::try_new(
            schema.clone(),
            vec![
                Arc::new(StringArray::from(vec![
                    "obs.S001.base",
                    "obs.S001.rep1",
                    "obs.S001.aug0",
                    "obs.S002.base",
                ])),
                Arc::new(Float64Array::from(vec![1.0, 2.0, 3.0, 4.0])),
                Arc::new(Float64Array::from(vec![10.0, 20.0, 30.0, 40.0])),
            ],
        )
        .unwrap();

        let path = std::env::temp_dir().join(format!(
            "dag_ml_data_arrow_ipc_provider_{}.arrow",
            std::process::id()
        ));
        {
            let mut file = std::fs::File::create(&path).unwrap();
            let mut writer = FileWriter::try_new(&mut file, &schema).unwrap();
            writer.write(&batch).unwrap();
            writer.finish().unwrap();
        }

        let envelope = include_bytes!(
            "../../../examples/fixtures/oof_campaign/coordinator_data_plan_envelope_nir.json"
        );
        let materialization_request = include_bytes!(
            "../../../examples/fixtures/oof_campaign/materialization_request_model_base_x.json"
        );
        let target_tables = b"[]";
        let path_str = path.to_string_lossy().into_owned();
        let path_bytes = path_str.as_bytes();
        let mut vtable = empty_vtable();
        let mut error = DagMlDataString::default();

        let status = unsafe {
            dagmldata_inmemory_provider_new_from_arrow_ipc(
                envelope.as_ptr(),
                envelope.len(),
                target_tables.as_ptr(),
                target_tables.len(),
                path_bytes.as_ptr(),
                path_bytes.len(),
                &mut vtable,
                &mut error,
            )
        };
        assert_eq!(status, DagMlDataStatusCode::Ok);
        assert!(error.ptr.is_null());

        let mut data_handle = 0;
        let status = unsafe {
            vtable.materialize.unwrap()(
                vtable.user_data,
                0,
                DagMlDataBytesView {
                    ptr: materialization_request.as_ptr(),
                    len: materialization_request.len(),
                },
                &mut data_handle,
            )
        };
        assert_eq!(status, DagMlDataStatusCode::Ok);
        let mut manifest_json = DagMlDataString::default();
        let status = unsafe {
            dagmldata_inmemory_provider_data_feature_buffer_manifest_json(
                &vtable,
                data_handle,
                &mut manifest_json,
                &mut error,
            )
        };
        assert_eq!(status, DagMlDataStatusCode::Ok);
        let manifests: serde_json::Value =
            serde_json::from_str(&unsafe { string_value(manifest_json) }).unwrap();
        assert_eq!(manifests[0]["feature_set_id"], serde_json::json!("x"));

        unsafe {
            vtable.release.unwrap()(vtable.user_data, data_handle);
            dagmldata_inmemory_provider_destroy(&mut vtable);
        }
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn inmemory_provider_vtable_materializes_views_identity_targets_and_features() {
        let envelope = include_bytes!(
            "../../../examples/fixtures/oof_campaign/coordinator_data_plan_envelope_nir.json"
        );
        let materialization_request = include_bytes!(
            "../../../examples/fixtures/oof_campaign/materialization_request_model_base_x.json"
        );
        let target_tables = serde_json::to_vec(&serde_json::json!([
            {
                "target_id": "y",
                "values": [
                    {"sample_id": "S001", "value": 42.0},
                    {"sample_id": "S002", "value": 7.0}
                ]
            }
        ]))
        .unwrap();
        let feature_tables = serde_json::to_vec(&serde_json::json!([
            {
                "feature_set_id": "x",
                "representation_id": "tabular_numeric",
                "feature_names": ["f0", "f1"],
                "rows": [
                    {"observation_id": "obs.S001.base", "values": [1.0, 10.0]},
                    {"observation_id": "obs.S001.rep1", "values": [2.0, 20.0]},
                    {"observation_id": "obs.S001.aug0", "values": [3.0, 30.0]},
                    {"observation_id": "obs.S002.base", "values": [4.0, 40.0]}
                ]
            },
            {
                "feature_set_id": "x_bad_representation",
                "representation_id": "dense_signal",
                "feature_names": ["f0"],
                "rows": [
                    {"observation_id": "obs.S001.base", "values": [1.0]},
                    {"observation_id": "obs.S001.rep1", "values": [2.0]},
                    {"observation_id": "obs.S001.aug0", "values": [3.0]},
                    {"observation_id": "obs.S002.base", "values": [4.0]}
                ]
            }
        ]))
        .unwrap();
        let mut vtable = empty_vtable();
        let mut error = DagMlDataString::default();

        let status = unsafe {
            dagmldata_inmemory_provider_new_with_features_json(
                envelope.as_ptr(),
                envelope.len(),
                target_tables.as_ptr(),
                target_tables.len(),
                feature_tables.as_ptr(),
                feature_tables.len(),
                &mut vtable,
                &mut error,
            )
        };

        assert_eq!(status, DagMlDataStatusCode::Ok);
        assert!(error.ptr.is_null());
        assert!(!vtable.user_data.is_null());

        let mut manifest_json = DagMlDataString::default();
        let mut manifest_error = DagMlDataString::default();
        let status = unsafe {
            dagmldata_inmemory_provider_feature_buffer_manifest_json(
                &vtable,
                &mut manifest_json,
                &mut manifest_error,
            )
        };
        assert_eq!(status, DagMlDataStatusCode::Ok);
        assert!(manifest_error.ptr.is_null());
        let manifests: serde_json::Value =
            serde_json::from_str(&unsafe { string_value(manifest_json) }).unwrap();
        assert_eq!(manifests.as_array().unwrap().len(), 2);
        assert_eq!(manifests[0]["schema_version"], serde_json::json!(1));
        assert_eq!(manifests[0]["feature_set_id"], serde_json::json!("x"));
        assert_eq!(manifests[0]["row_count"], serde_json::json!(4));
        assert_eq!(manifests[0]["feature_count"], serde_json::json!(2));
        assert_eq!(manifests[0]["estimated_value_bytes"], serde_json::json!(64));
        assert_eq!(
            manifests[0]["buffer_fingerprint"].as_str().unwrap().len(),
            64
        );

        let mut data_handle = 0;
        let materialize = vtable.materialize.unwrap();
        let status = unsafe {
            materialize(
                vtable.user_data,
                0,
                DagMlDataBytesView {
                    ptr: materialization_request.as_ptr(),
                    len: materialization_request.len(),
                },
                &mut data_handle,
            )
        };
        assert_eq!(status, DagMlDataStatusCode::Ok);
        assert_eq!(data_handle, 1);
        let mut data_manifest_json = DagMlDataString::default();
        let mut data_manifest_error = DagMlDataString::default();
        let status = unsafe {
            dagmldata_inmemory_provider_data_feature_buffer_manifest_json(
                &vtable,
                data_handle,
                &mut data_manifest_json,
                &mut data_manifest_error,
            )
        };
        assert_eq!(status, DagMlDataStatusCode::Ok);
        assert!(data_manifest_error.ptr.is_null());
        let data_manifests: serde_json::Value =
            serde_json::from_str(&unsafe { string_value(data_manifest_json) }).unwrap();
        assert_eq!(data_manifests.as_array().unwrap().len(), 1);
        assert_eq!(data_manifests[0]["feature_set_id"], serde_json::json!("x"));
        assert_eq!(data_manifests[0]["source_ids"], serde_json::json!(["nir"]));

        let view_json = serde_json::to_vec(
            &serde_json::json!({"sample_ids": ["S001"], "columns": ["f1"], "include_augmented": false}),
        )
        .unwrap();
        let mut view_handle = 0;
        let make_view = vtable.make_view.unwrap();
        let status = unsafe {
            make_view(
                vtable.user_data,
                data_handle,
                DagMlDataBytesView {
                    ptr: view_json.as_ptr(),
                    len: view_json.len(),
                },
                &mut view_handle,
            )
        };
        assert_eq!(status, DagMlDataStatusCode::Ok);
        assert_eq!(view_handle, 2);

        let mut identity_array = std::ptr::null_mut();
        let mut identity_schema = std::ptr::null_mut();
        let view_identity = vtable.view_identity.unwrap();
        let status = unsafe {
            view_identity(
                vtable.user_data,
                view_handle,
                &mut identity_array,
                &mut identity_schema,
            )
        };
        assert_eq!(status, DagMlDataStatusCode::Ok);
        unsafe {
            assert_eq!((*identity_array).length, 2);
            let array_children = slice::from_raw_parts(
                (*identity_array).children,
                (*identity_array).n_children as usize,
            );
            assert_eq!(
                utf8_values(array_children[0]),
                vec![
                    Some("obs.S001.base".to_string()),
                    Some("obs.S001.rep1".to_string()),
                ]
            );
            dagmldata_arrow_array_free(identity_array);
            dagmldata_arrow_schema_free(identity_schema);
        }

        let mut target_array = std::ptr::null_mut();
        let mut target_schema = std::ptr::null_mut();
        let target_arrow = vtable.target_arrow.unwrap();
        let target_name = b"y";
        let status = unsafe {
            target_arrow(
                vtable.user_data,
                view_handle,
                DagMlDataBytesView {
                    ptr: target_name.as_ptr(),
                    len: target_name.len(),
                },
                &mut target_array,
                &mut target_schema,
            )
        };
        assert_eq!(status, DagMlDataStatusCode::Ok);
        unsafe {
            assert_eq!((*target_array).length, 1);
            let array_children = slice::from_raw_parts(
                (*target_array).children,
                (*target_array).n_children as usize,
            );
            assert_eq!(
                utf8_values(array_children[0]),
                vec![Some("S001".to_string())]
            );
            assert_eq!(f64_values(array_children[2]), vec![Some(42.0)]);
            dagmldata_arrow_array_free(target_array);
            dagmldata_arrow_schema_free(target_schema);
        }

        let mut feature_array = std::ptr::null_mut();
        let mut feature_schema = std::ptr::null_mut();
        let feature_arrow = vtable.feature_arrow.unwrap();
        let feature_set_name = b"x";
        let status = unsafe {
            feature_arrow(
                vtable.user_data,
                view_handle,
                DagMlDataBytesView {
                    ptr: feature_set_name.as_ptr(),
                    len: feature_set_name.len(),
                },
                &mut feature_array,
                &mut feature_schema,
            )
        };
        assert_eq!(status, DagMlDataStatusCode::Ok);
        unsafe {
            assert_eq!((*feature_array).length, 2);
            assert_eq!((*feature_array).n_children, 3);
            let array_children = slice::from_raw_parts(
                (*feature_array).children,
                (*feature_array).n_children as usize,
            );
            assert_eq!(
                utf8_values(array_children[0]),
                vec![
                    Some("obs.S001.base".to_string()),
                    Some("obs.S001.rep1".to_string()),
                ]
            );
            assert_eq!(f64_values(array_children[2]), vec![Some(10.0), Some(20.0)]);
            dagmldata_arrow_array_free(feature_array);
            dagmldata_arrow_schema_free(feature_schema);
        }
        let bad_feature_set_name = b"x_bad_representation";
        let mut bad_feature_array = std::ptr::null_mut();
        let mut bad_feature_schema = std::ptr::null_mut();
        let status = unsafe {
            feature_arrow(
                vtable.user_data,
                view_handle,
                DagMlDataBytesView {
                    ptr: bad_feature_set_name.as_ptr(),
                    len: bad_feature_set_name.len(),
                },
                &mut bad_feature_array,
                &mut bad_feature_schema,
            )
        };
        assert_eq!(status, DagMlDataStatusCode::ValidationError);
        assert!(bad_feature_array.is_null());
        assert!(bad_feature_schema.is_null());

        let bad_selector = serde_json::to_vec(&serde_json::json!({
            "feature_set_id": "x_bad_representation",
            "policy": {
                "emit_mask": true
            }
        }))
        .unwrap();
        let mut bad_tensor_json = DagMlDataString::default();
        let mut bad_tensor_error = DagMlDataString::default();
        let status = unsafe {
            dagmldata_inmemory_provider_feature_collation_json(
                &vtable,
                view_handle,
                DagMlDataBytesView {
                    ptr: bad_selector.as_ptr(),
                    len: bad_selector.len(),
                },
                &mut bad_tensor_json,
                &mut bad_tensor_error,
            )
        };
        assert_eq!(status, DagMlDataStatusCode::ValidationError);
        assert!(bad_tensor_json.ptr.is_null());
        unsafe {
            dagmldata_string_free(bad_tensor_error);
        }

        let mut bad_tensor = DagMlDataTensorF64::default();
        let mut bad_tensor_error = DagMlDataString::default();
        let status = unsafe {
            dagmldata_inmemory_provider_feature_collation_tensor_f64_json(
                &vtable,
                view_handle,
                DagMlDataBytesView {
                    ptr: bad_selector.as_ptr(),
                    len: bad_selector.len(),
                },
                &mut bad_tensor,
                &mut bad_tensor_error,
            )
        };
        assert_eq!(status, DagMlDataStatusCode::ValidationError);
        assert!(bad_tensor.values.ptr.is_null());
        unsafe {
            dagmldata_string_free(bad_tensor_error);
        }

        unsafe {
            vtable.release.unwrap()(vtable.user_data, view_handle);
        }
        let mut released_array = std::ptr::null_mut();
        let mut released_schema = std::ptr::null_mut();
        let status = unsafe {
            view_identity(
                vtable.user_data,
                view_handle,
                &mut released_array,
                &mut released_schema,
            )
        };
        assert_eq!(status, DagMlDataStatusCode::ValidationError);
        assert!(released_array.is_null());
        assert!(released_schema.is_null());

        let mut child_view_handle = 0;
        let status = unsafe {
            make_view(
                vtable.user_data,
                data_handle,
                DagMlDataBytesView {
                    ptr: view_json.as_ptr(),
                    len: view_json.len(),
                },
                &mut child_view_handle,
            )
        };
        assert_eq!(status, DagMlDataStatusCode::Ok);
        assert_ne!(child_view_handle, 0);
        unsafe {
            vtable.release.unwrap()(vtable.user_data, data_handle);
        }
        let mut stale_manifest_json = DagMlDataString::default();
        let mut stale_manifest_error = DagMlDataString::default();
        let status = unsafe {
            dagmldata_inmemory_provider_data_feature_buffer_manifest_json(
                &vtable,
                data_handle,
                &mut stale_manifest_json,
                &mut stale_manifest_error,
            )
        };
        assert_eq!(status, DagMlDataStatusCode::ValidationError);
        assert!(stale_manifest_json.ptr.is_null());
        unsafe {
            dagmldata_string_free(stale_manifest_error);
        }
        let mut child_array = std::ptr::null_mut();
        let mut child_schema = std::ptr::null_mut();
        let status = unsafe {
            view_identity(
                vtable.user_data,
                child_view_handle,
                &mut child_array,
                &mut child_schema,
            )
        };
        assert_eq!(status, DagMlDataStatusCode::ValidationError);
        assert!(child_array.is_null());
        assert!(child_schema.is_null());

        let mut stale_feature_array = std::ptr::null_mut();
        let mut stale_feature_schema = std::ptr::null_mut();
        let status = unsafe {
            feature_arrow(
                vtable.user_data,
                child_view_handle,
                DagMlDataBytesView {
                    ptr: feature_set_name.as_ptr(),
                    len: feature_set_name.len(),
                },
                &mut stale_feature_array,
                &mut stale_feature_schema,
            )
        };
        assert_eq!(status, DagMlDataStatusCode::ValidationError);
        assert!(stale_feature_array.is_null());
        assert!(stale_feature_schema.is_null());

        let selector = serde_json::to_vec(&serde_json::json!({
            "feature_set_id": "x",
            "policy": {
                "emit_mask": true
            }
        }))
        .unwrap();
        let mut stale_tensor_json = DagMlDataString::default();
        let mut stale_tensor_error = DagMlDataString::default();
        let status = unsafe {
            dagmldata_inmemory_provider_feature_collation_json(
                &vtable,
                child_view_handle,
                DagMlDataBytesView {
                    ptr: selector.as_ptr(),
                    len: selector.len(),
                },
                &mut stale_tensor_json,
                &mut stale_tensor_error,
            )
        };
        assert_eq!(status, DagMlDataStatusCode::ValidationError);
        assert!(stale_tensor_json.ptr.is_null());
        unsafe {
            dagmldata_string_free(stale_tensor_error);
        }

        let mut stale_tensor = DagMlDataTensorF64::default();
        let mut stale_tensor_error = DagMlDataString::default();
        let status = unsafe {
            dagmldata_inmemory_provider_feature_collation_tensor_f64_json(
                &vtable,
                child_view_handle,
                DagMlDataBytesView {
                    ptr: selector.as_ptr(),
                    len: selector.len(),
                },
                &mut stale_tensor,
                &mut stale_tensor_error,
            )
        };
        assert_eq!(status, DagMlDataStatusCode::ValidationError);
        assert!(stale_tensor.values.ptr.is_null());
        unsafe {
            dagmldata_string_free(stale_tensor_error);
        }

        let mut orphan_view_handle = 0;
        let status = unsafe {
            make_view(
                vtable.user_data,
                data_handle,
                DagMlDataBytesView {
                    ptr: view_json.as_ptr(),
                    len: view_json.len(),
                },
                &mut orphan_view_handle,
            )
        };
        assert_eq!(status, DagMlDataStatusCode::ValidationError);
        assert_eq!(orphan_view_handle, 0);

        unsafe {
            dagmldata_inmemory_provider_destroy(&mut vtable);
        }
        assert!(vtable.user_data.is_null());
    }

    #[test]
    fn inmemory_provider_rejects_non_numeric_feature_buffers_on_creation() {
        let envelope = include_bytes!(
            "../../../examples/fixtures/oof_campaign/coordinator_data_plan_envelope_nir.json"
        );
        let feature_tables = serde_json::to_vec(&serde_json::json!([
            {
                "feature_set_id": "x",
                "representation_id": "tabular_numeric",
                "feature_names": ["f0"],
                "rows": [
                    {"observation_id": "obs.S001.base", "values": ["bad"]}
                ]
            }
        ]))
        .unwrap();
        let mut vtable = empty_vtable();
        let mut error = DagMlDataString::default();

        let status = unsafe {
            dagmldata_inmemory_provider_new_with_features_json(
                envelope.as_ptr(),
                envelope.len(),
                std::ptr::null(),
                0,
                feature_tables.as_ptr(),
                feature_tables.len(),
                &mut vtable,
                &mut error,
            )
        };

        assert_eq!(status, DagMlDataStatusCode::ValidationError);
        assert!(vtable.user_data.is_null());
        assert!(!error.ptr.is_null());
        unsafe {
            dagmldata_string_free(error);
        }
    }

    unsafe fn utf8_values(array: *const ArrowArray) -> Vec<Option<String>> {
        assert!(!array.is_null());
        let buffers = slice::from_raw_parts((*array).buffers, (*array).n_buffers as usize);
        assert_eq!(buffers.len(), 3);
        let offsets = slice::from_raw_parts(
            buffers[1].cast::<i32>(),
            usize::try_from((*array).length).unwrap() + 1,
        );
        let values = slice::from_raw_parts(
            buffers[2].cast::<u8>(),
            usize::try_from(*offsets.last().unwrap()).unwrap(),
        );
        (0..usize::try_from((*array).length).unwrap())
            .map(|idx| {
                if !is_valid(buffers[0], idx) {
                    return None;
                }
                let start = usize::try_from(offsets[idx]).unwrap();
                let end = usize::try_from(offsets[idx + 1]).unwrap();
                Some(String::from_utf8(values[start..end].to_vec()).unwrap())
            })
            .collect()
    }

    unsafe fn f64_values(array: *const ArrowArray) -> Vec<Option<f64>> {
        assert!(!array.is_null());
        let buffers = slice::from_raw_parts((*array).buffers, (*array).n_buffers as usize);
        assert_eq!(buffers.len(), 2);
        let values = slice::from_raw_parts(buffers[1].cast::<f64>(), (*array).length as usize);
        (0..usize::try_from((*array).length).unwrap())
            .map(|idx| is_valid(buffers[0], idx).then_some(values[idx]))
            .collect()
    }

    unsafe fn bool_values(array: *const ArrowArray) -> Vec<bool> {
        assert!(!array.is_null());
        let buffers = slice::from_raw_parts((*array).buffers, (*array).n_buffers as usize);
        assert_eq!(buffers.len(), 2);
        (0..usize::try_from((*array).length).unwrap())
            .map(|idx| is_valid(buffers[1], idx))
            .collect()
    }

    unsafe fn is_valid(bitmap: *const c_void, idx: usize) -> bool {
        if bitmap.is_null() {
            return true;
        }
        let byte = *bitmap.cast::<u8>().add(idx / 8);
        byte & (1 << (idx % 8)) != 0
    }

    fn bytes_view(bytes: &'static [u8]) -> DagMlDataBytesView {
        DagMlDataBytesView {
            ptr: bytes.as_ptr(),
            len: bytes.len(),
        }
    }

    unsafe fn string_value(value: DagMlDataString) -> String {
        let bytes = slice::from_raw_parts(value.ptr.cast::<u8>(), value.len);
        let out = String::from_utf8(bytes.to_vec()).unwrap();
        dagmldata_string_free(value);
        out
    }

    unsafe fn borrowed_string(value: &DagMlDataString) -> String {
        assert!(!value.ptr.is_null());
        let bytes = slice::from_raw_parts(value.ptr.cast::<u8>(), value.len);
        String::from_utf8(bytes.to_vec()).unwrap()
    }

    unsafe fn string_array_values(array: DagMlDataStringArray) -> Vec<String> {
        if array.ptr.is_null() {
            return Vec::new();
        }
        slice::from_raw_parts(array.ptr, array.len)
            .iter()
            .map(|value| borrowed_string(value))
            .collect()
    }

    unsafe fn usize_array_values(array: DagMlDataUSizeArray) -> Vec<usize> {
        if array.ptr.is_null() {
            return Vec::new();
        }
        slice::from_raw_parts(array.ptr, array.len).to_vec()
    }

    unsafe fn f64_array_values(array: DagMlDataF64Array) -> Vec<f64> {
        if array.ptr.is_null() {
            return Vec::new();
        }
        slice::from_raw_parts(array.ptr, array.len).to_vec()
    }

    unsafe fn f32_array_values(array: DagMlDataF32Array) -> Vec<f32> {
        if array.ptr.is_null() {
            return Vec::new();
        }
        slice::from_raw_parts(array.ptr, array.len).to_vec()
    }

    unsafe fn u8_array_values(array: DagMlDataU8Array) -> Vec<u8> {
        if array.ptr.is_null() {
            return Vec::new();
        }
        slice::from_raw_parts(array.ptr, array.len).to_vec()
    }

    /// Builds a single-source `DatasetSchema` (samples `s1..s3` on source
    /// `src`) wrapping `native_representation` under the free `modality` string
    /// and `type_id`. Used by the Phase A modality tests to express each
    /// modality with nothing but generic contract vocabulary.
    fn single_source_dataset_schema(
        modality: &str,
        type_id: &str,
        native_representation: dag_ml_data_core::RepresentationSpec,
    ) -> DatasetSchema {
        use dag_ml_data_core::{SourceDescriptor, SourceGranularity, TypeId};

        DatasetSchema {
            dataset_id: format!("{modality}-dataset"),
            sample_ids: vec![
                SampleId::new("s1").unwrap(),
                SampleId::new("s2").unwrap(),
                SampleId::new("s3").unwrap(),
            ],
            sources: vec![SourceDescriptor {
                id: SourceId::new("src").unwrap(),
                name: format!("{modality} source"),
                type_id: TypeId::new(type_id).unwrap(),
                modality: modality.to_string(),
                native_representation,
                sample_key: "sample_id".to_string(),
                granularity: SourceGranularity::PerSample,
                schema: BTreeMap::new(),
                tags: BTreeMap::new(),
                shape_contract: None,
            }],
            targets: BTreeMap::new(),
            metadata: BTreeMap::new(),
            metadata_schema: None,
            groups: Vec::new(),
            folds: Vec::new(),
        }
    }

    /// Builds an envelope + materialization request from a real modality
    /// `DatasetSchema`, with three unrepeated observations (`obs.s1..obs.s3`)
    /// mapped to samples `s1..s3` on source `src`.
    ///
    /// The envelope is built with `CoordinatorDataPlanEnvelope::from_parts`, so
    /// the `schema_fingerprint` is the genuine digest of `schema` (which carries
    /// the modality's `SourceDescriptor` + `AxisKind`), the `plan_fingerprint`
    /// is computed from the plan, and the `relation_fingerprint` /
    /// `coordinator_relations` are derived from the relation table — nothing is
    /// guessed. The request's fingerprints are taken straight from the envelope,
    /// so a different modality (hence a different schema digest) threads all the
    /// way through the provider's materialize-time validation. The plan shape is
    /// identical across modalities; only `schema`/`representation_id` differ.
    fn single_modality_provider_fixture(
        schema: &DatasetSchema,
        representation_id: &RepresentationId,
    ) -> (Vec<u8>, Vec<u8>) {
        use std::collections::BTreeMap;

        use dag_ml_data_core::{
            CoordinatorDataMaterializationRequest, CoordinatorDataPlanEnvelope, DataPlan,
            DataPlanStep, DataPlanStepKind, FitScope, SampleRelation, SampleRelationTable,
        };

        let source = SourceId::new("src").unwrap();
        let plan = DataPlan {
            id: format!("modality-{representation_id}"),
            steps: vec![DataPlanStep {
                kind: DataPlanStepKind::Materialize,
                source_id: Some(source.clone()),
                adapter_id: None,
                input_representation: None,
                output_representation: Some(representation_id.clone()),
                fit_scope: FitScope::Stateless,
                requires_user_choice: false,
                metadata: BTreeMap::new(),
            }],
            output_representation: representation_id.clone(),
            issues: Vec::new(),
        };
        let relation = |observation: &str, sample: &str| SampleRelation {
            observation_id: ObservationId::new(observation).unwrap(),
            sample_id: SampleId::new(sample).unwrap(),
            source_id: Some(source.clone()),
            target_id: None,
            group_id: None,
            origin_id: None,
            repetition_id: None,
            augmented: false,
            excluded: false,
            metadata: BTreeMap::new(),
            tags: Vec::new(),
            augmentation: None,
        };
        let relations = SampleRelationTable {
            rows: vec![
                relation("obs.s1", "s1"),
                relation("obs.s2", "s2"),
                relation("obs.s3", "s3"),
            ],
        };
        let envelope =
            CoordinatorDataPlanEnvelope::from_parts(schema, plan, Some(&relations)).unwrap();
        let request = CoordinatorDataMaterializationRequest {
            run_id: "run:test".to_string(),
            node_id: "node:model".to_string(),
            input_name: "X".to_string(),
            phase: "fit".to_string(),
            variant_id: None,
            fold_id: None,
            request_id: "req:test".to_string(),
            schema_fingerprint: envelope.schema_fingerprint.clone(),
            plan_fingerprint: envelope.plan_fingerprint.clone(),
            relation_fingerprint: envelope.relation_fingerprint.clone(),
            output_representation: envelope.plan.output_representation.clone(),
            source_ids: Vec::new(),
            require_relations: false,
        };
        request.validate().unwrap();
        (
            serde_json::to_vec(&envelope).unwrap(),
            serde_json::to_vec(&request).unwrap(),
        )
    }

    fn multisource_provider_fixture() -> (Vec<u8>, Vec<u8>) {
        use std::collections::BTreeMap;

        use dag_ml_data_core::{
            data_plan_fingerprint, CoordinatorDataMaterializationRequest,
            CoordinatorDataPlanEnvelope, CoordinatorRelation, CoordinatorRelationSet, DataPlan,
            DataPlanStep, DataPlanStepKind, FitScope,
        };

        let tabular = RepresentationId::new("tabular_numeric").unwrap();
        let plan = DataPlan {
            id: "nir-chem-tabular".to_string(),
            steps: vec![
                DataPlanStep {
                    kind: DataPlanStepKind::Materialize,
                    source_id: Some(SourceId::new("nir").unwrap()),
                    adapter_id: None,
                    input_representation: None,
                    output_representation: Some(tabular.clone()),
                    fit_scope: FitScope::Stateless,
                    requires_user_choice: false,
                    metadata: BTreeMap::new(),
                },
                DataPlanStep {
                    kind: DataPlanStepKind::Materialize,
                    source_id: Some(SourceId::new("chem").unwrap()),
                    adapter_id: None,
                    input_representation: None,
                    output_representation: Some(tabular.clone()),
                    fit_scope: FitScope::Stateless,
                    requires_user_choice: false,
                    metadata: BTreeMap::new(),
                },
                DataPlanStep {
                    kind: DataPlanStepKind::Align,
                    source_id: None,
                    adapter_id: None,
                    input_representation: Some(tabular.clone()),
                    output_representation: Some(tabular.clone()),
                    fit_scope: FitScope::Stateless,
                    requires_user_choice: false,
                    metadata: BTreeMap::new(),
                },
                DataPlanStep {
                    kind: DataPlanStepKind::Join,
                    source_id: None,
                    adapter_id: None,
                    input_representation: Some(tabular.clone()),
                    output_representation: Some(tabular.clone()),
                    fit_scope: FitScope::Stateless,
                    requires_user_choice: false,
                    metadata: BTreeMap::new(),
                },
            ],
            output_representation: tabular.clone(),
            issues: Vec::new(),
        };
        let plan_fingerprint = data_plan_fingerprint(&plan).unwrap();
        let schema_fingerprint = "a".repeat(64);
        let envelope = CoordinatorDataPlanEnvelope {
            schema_version: dag_ml_data_core::COORDINATOR_DATA_PLAN_ENVELOPE_SCHEMA_VERSION,
            schema_fingerprint: schema_fingerprint.clone(),
            plan_fingerprint: plan_fingerprint.clone(),
            relation_fingerprint: None,
            data_content_fingerprint: None,
            target_content_fingerprint: None,
            plan,
            coordinator_relations: Some(CoordinatorRelationSet {
                records: vec![
                    CoordinatorRelation {
                        observation_id: ObservationId::new("obs.S001.r1").unwrap(),
                        sample_id: SampleId::new("S001").unwrap(),
                        target_id: None,
                        group_id: None,
                        origin_sample_id: None,
                        source_id: Some(SourceId::new("nir").unwrap()),
                        is_augmented: false,
                        excluded: false,
                        metadata: BTreeMap::new(),
                        tags: Vec::new(),
                    },
                    CoordinatorRelation {
                        observation_id: ObservationId::new("obs.S001.r2").unwrap(),
                        sample_id: SampleId::new("S001").unwrap(),
                        target_id: None,
                        group_id: None,
                        origin_sample_id: None,
                        source_id: Some(SourceId::new("nir").unwrap()),
                        is_augmented: false,
                        excluded: false,
                        metadata: BTreeMap::new(),
                        tags: Vec::new(),
                    },
                    CoordinatorRelation {
                        observation_id: ObservationId::new("obs.S002.r1").unwrap(),
                        sample_id: SampleId::new("S002").unwrap(),
                        target_id: None,
                        group_id: None,
                        origin_sample_id: None,
                        source_id: Some(SourceId::new("nir").unwrap()),
                        is_augmented: false,
                        excluded: false,
                        metadata: BTreeMap::new(),
                        tags: Vec::new(),
                    },
                    CoordinatorRelation {
                        observation_id: ObservationId::new("chem.S001").unwrap(),
                        sample_id: SampleId::new("S001").unwrap(),
                        target_id: None,
                        group_id: None,
                        origin_sample_id: None,
                        source_id: Some(SourceId::new("chem").unwrap()),
                        is_augmented: false,
                        excluded: false,
                        metadata: BTreeMap::new(),
                        tags: Vec::new(),
                    },
                    CoordinatorRelation {
                        observation_id: ObservationId::new("chem.S002").unwrap(),
                        sample_id: SampleId::new("S002").unwrap(),
                        target_id: None,
                        group_id: None,
                        origin_sample_id: None,
                        source_id: Some(SourceId::new("chem").unwrap()),
                        is_augmented: false,
                        excluded: false,
                        metadata: BTreeMap::new(),
                        tags: Vec::new(),
                    },
                ],
            }),
            metadata: BTreeMap::new(),
        };
        envelope.validate().unwrap();
        let request = CoordinatorDataMaterializationRequest {
            run_id: "run:test".to_string(),
            node_id: "node:model".to_string(),
            input_name: "X".to_string(),
            phase: "fit".to_string(),
            variant_id: None,
            fold_id: None,
            request_id: "req:test".to_string(),
            schema_fingerprint,
            plan_fingerprint,
            relation_fingerprint: None,
            output_representation: tabular,
            source_ids: Vec::new(),
            require_relations: false,
        };
        request.validate().unwrap();
        (
            serde_json::to_vec(&envelope).unwrap(),
            serde_json::to_vec(&request).unwrap(),
        )
    }
}
