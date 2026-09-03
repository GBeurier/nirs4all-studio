//! Safe, thin bindings for the native `libn4m` optimizer ABI.
//!
//! The optimizer remains entirely in `libn4m`: this crate only owns handles,
//! pins borrowed trials to their optimizer, and copies native snapshots.

#![deny(unsafe_op_in_unsafe_fn)]

use std::{
    collections::BTreeMap,
    ffi::{c_char, c_void, CStr, CString},
    marker::PhantomData,
    mem,
    ptr::{self, NonNull},
    slice,
};

#[cfg(not(any(feature = "linked", feature = "dynamic")))]
compile_error!("n4m requires exactly one runtime feature: `linked` or `dynamic`");

const ABI_MAJOR: u32 = 2;
const ABI_MINOR: u32 = 5;
const OK: i32 = 0;
const NOT_FITTED: i32 = 6;
const DTYPE_I64: i32 = 4;
const CORRUPT_BUFFER: i32 = 14;
const VERSION_INCOMPATIBLE: i32 = 15;
/// Native N4MOPT checkpoints are capped at 64 MiB.  Keep this in lock-step
/// with the native decoder so Rust never accepts an envelope the ABI rejects.
const MAX_CHECKPOINT_BYTES: usize = 64 * 1024 * 1024;
const MAX_N4MM_BYTES: usize = 512 * 1024 * 1024;
const MAX_ARRAY_ELEMENTS: usize = MAX_N4MM_BYTES / mem::size_of::<f64>();
const MAX_TRACE_ELEMENTS: usize = 16 * 1024 * 1024;
/// Maximum pointer slots the safe batch wrapper will allocate for one native ask.
pub const MAX_ASK_BATCH: i32 = 1_048_576;
const N4MM_MAGIC: &[u8; 4] = b"N4MM";
const N4MM_HEADER_BYTES: usize = 20;
const N4MM_FORMAT_VERSION_V1: u32 = 1;
const N4MM_FORMAT_VERSION_V2: u32 = 2;
pub const SERIALIZED_MODEL_INFO_SCHEMA_V1: u32 = 1;
pub const SERIALIZED_MODEL_CAPABILITY_PREDICT: u64 = 1 << 0;
pub const SERIALIZED_MODEL_CAPABILITY_TRANSFORM: u64 = 1 << 1;
pub const SERIALIZED_MODEL_CAPABILITY_AFFINE: u64 = 1 << 2;
pub const SERIALIZED_MODEL_CAPABILITY_PIPELINE: u64 = 1 << 3;
const SERIALIZED_PIPELINE_INFO_SCHEMA_V1: u32 = 1;
const PIPELINE_SEMANTIC_PROFILE_NIRS4ALL_SNV_SAVGOL_V1: u32 = 1;
const PIPELINE_FINGERPRINT_NONE: u32 = 0;
const PIPELINE_FINGERPRINT_FNV1A64_V1: u32 = 1;
const N4MOPT_MAGIC: &[u8; 8] = b"N4MOPT\r\n";
const N4MOPT_HEADER_BYTES: usize = 32;
const N4MOPT_MIN_BYTES: usize = N4MOPT_HEADER_BYTES + 8;
const N4MOPT_FORMAT_VERSION: u32 = 1;

#[repr(C)]
struct ContextRaw {
    _private: [u8; 0],
}
#[repr(C)]
struct ConfigRaw {
    _private: [u8; 0],
}
#[repr(C)]
struct PipelineRaw {
    _private: [u8; 0],
}
#[repr(C)]
struct ModelRaw {
    _private: [u8; 0],
}
#[repr(C)]
struct OptimizerRaw {
    _private: [u8; 0],
}
#[repr(C)]
struct SearchSpaceRaw {
    _private: [u8; 0],
}
#[repr(C)]
struct ValidationPlanRaw {
    _private: [u8; 0],
}
#[repr(C)]
struct TrialRaw {
    _private: [u8; 0],
}
#[repr(C)]
struct ArrayRaw {
    _private: [u8; 0],
}
#[repr(C)]
struct MethodResultRaw {
    _private: [u8; 0],
}

#[repr(C)]
#[derive(Clone, Copy)]
struct MatrixView {
    data: *mut c_void,
    rows: i64,
    cols: i64,
    row_stride: i64,
    col_stride: i64,
    dtype: i32,
    reserved0: i32,
}
#[repr(C)]
struct LinearPredictorSpecRaw {
    source_training_samples: i64,
    n_features: i32,
    n_targets: i32,
    coefficients: *const f64,
    intercept: *const f64,
}
#[repr(C)]
#[derive(Clone, Copy, Default)]
struct SerializedModelInfoV1Raw {
    schema_version: u32,
    format_version: u32,
    writer_abi_major: u32,
    writer_abi_minor: u32,
    writer_abi_patch: u32,
    algorithm: i32,
    solver: i32,
    deflation: i32,
    training_samples: i64,
    n_features: i32,
    n_targets: i32,
    n_components: i32,
    reserved0: u32,
    capabilities: u64,
}
#[repr(C)]
#[derive(Clone, Copy, Default)]
struct SerializedPipelineInfoV1Raw {
    schema_version: u32,
    struct_size: u32,
    present: u32,
    operator_count: u32,
    operators: [i32; 2],
    savgol_window: i32,
    savgol_poly_degree: i32,
    savgol_derivative: i32,
    semantic_profile: u32,
    savgol_delta: f64,
    raw_n_features: i32,
    model_n_features: i32,
    fingerprint_algorithm: u32,
    snv_axis: i32,
    fingerprint: u64,
    snv_with_mean: u32,
    snv_with_std: u32,
    snv_ddof: i32,
    savgol_mode: i32,
    savgol_cval: f64,
}
#[repr(C)]
struct OptimizerOptionsRaw {
    struct_size: u64,
    sampler: i32,
    pruner: i32,
    direction: i32,
    eval_mode: i32,
    metric: i32,
    liar: i32,
    n_startup_trials: i32,
    seed: u64,
    timeout_seconds: f64,
    max_resource: i32,
    reduction_factor: i32,
    reserved: [u8; 56],
}
const _: () = assert!(mem::size_of::<MatrixView>() == 48);
const _: () = assert!(mem::align_of::<MatrixView>() == 8);
const _: () = assert!(mem::size_of::<LinearPredictorSpecRaw>() == 32);
const _: () = assert!(mem::size_of::<SerializedModelInfoV1Raw>() == 64);
const _: () = assert!(mem::size_of::<SerializedPipelineInfoV1Raw>() == 96);
const _: () = assert!(mem::offset_of!(SerializedModelInfoV1Raw, training_samples) == 32);
const _: () = assert!(mem::offset_of!(SerializedModelInfoV1Raw, capabilities) == 56);
const _: () = assert!(mem::offset_of!(SerializedPipelineInfoV1Raw, semantic_profile) == 36);
const _: () = assert!(mem::offset_of!(SerializedPipelineInfoV1Raw, savgol_delta) == 40);
const _: () = assert!(mem::offset_of!(SerializedPipelineInfoV1Raw, snv_axis) == 60);
const _: () = assert!(mem::offset_of!(SerializedPipelineInfoV1Raw, fingerprint) == 64);
const _: () = assert!(mem::offset_of!(SerializedPipelineInfoV1Raw, savgol_cval) == 88);
const _: () = assert!(mem::size_of::<OptimizerOptionsRaw>() == 120);
const _: () = assert!(mem::offset_of!(OptimizerOptionsRaw, seed) == 40);

#[cfg(all(feature = "linked", not(feature = "dynamic")))]
#[link(name = "n4m")]
extern "C" {
    fn n4m_check_abi_compatibility(major: u32, minor: u32) -> i32;
    fn n4m_status_to_string(status: i32) -> *const c_char;
    fn n4m_context_create(out: *mut *mut ContextRaw) -> i32;
    fn n4m_context_destroy(ctx: *mut ContextRaw);
    fn n4m_context_last_error(ctx: *const ContextRaw) -> *const c_char;
    fn n4m_config_create(out: *mut *mut ConfigRaw) -> i32;
    fn n4m_config_destroy(cfg: *mut ConfigRaw);
    fn n4m_config_set_n_components(cfg: *mut ConfigRaw, n: i32) -> i32;
    fn n4m_config_set_center_x(cfg: *mut ConfigRaw, enabled: i32) -> i32;
    fn n4m_config_set_scale_x(cfg: *mut ConfigRaw, enabled: i32) -> i32;
    fn n4m_config_set_center_y(cfg: *mut ConfigRaw, enabled: i32) -> i32;
    fn n4m_config_set_scale_y(cfg: *mut ConfigRaw, enabled: i32) -> i32;
    fn n4m_config_set_store_scores(cfg: *mut ConfigRaw, enabled: i32) -> i32;
    fn n4m_pipeline_create(out: *mut *mut PipelineRaw) -> i32;
    fn n4m_pipeline_destroy(pipeline: *mut PipelineRaw);
    fn n4m_pipeline_add_operator(
        pipeline: *mut PipelineRaw,
        kind: i32,
        params: *const f64,
        n_params: i32,
    ) -> i32;
    fn n4m_config_set_pipeline(cfg: *mut ConfigRaw, pipeline: *const PipelineRaw) -> i32;
    fn n4m_model_fit(
        ctx: *mut ContextRaw,
        cfg: *const ConfigRaw,
        x: *const MatrixView,
        y: *const MatrixView,
        out: *mut *mut ModelRaw,
    ) -> i32;
    fn n4m_model_import_linear_predictor(
        ctx: *mut ContextRaw,
        spec: *const LinearPredictorSpecRaw,
        out: *mut *mut ModelRaw,
    ) -> i32;
    fn n4m_model_destroy(model: *mut ModelRaw);
    fn n4m_model_predict(
        ctx: *mut ContextRaw,
        model: *const ModelRaw,
        x: *const MatrixView,
        out: *mut MatrixView,
    ) -> i32;
    fn n4m_model_predict_alloc(
        ctx: *mut ContextRaw,
        model: *const ModelRaw,
        x: *const MatrixView,
        out: *mut *mut ArrayRaw,
    ) -> i32;
    fn n4m_model_get_n_components(model: *const ModelRaw, out: *mut i32) -> i32;
    fn n4m_model_get_n_features(model: *const ModelRaw, out: *mut i32) -> i32;
    fn n4m_model_get_n_targets(model: *const ModelRaw, out: *mut i32) -> i32;
    fn n4m_model_export_size(model: *const ModelRaw, out: *mut usize) -> i32;
    fn n4m_model_export_to_buffer(
        model: *const ModelRaw,
        buffer: *mut c_void,
        len: usize,
        written: *mut usize,
    ) -> i32;
    fn n4m_model_import_from_buffer(
        ctx: *mut ContextRaw,
        buffer: *const c_void,
        len: usize,
        out: *mut *mut ModelRaw,
    ) -> i32;
    fn n4m_validation_plan_create(out: *mut *mut ValidationPlanRaw) -> i32;
    fn n4m_validation_plan_destroy(plan: *mut ValidationPlanRaw);
    fn n4m_validation_plan_set_n_samples(plan: *mut ValidationPlanRaw, n_samples: i64) -> i32;
    fn n4m_validation_plan_add_fold(
        plan: *mut ValidationPlanRaw,
        train_indices: *const i64,
        n_train: i64,
        test_indices: *const i64,
        n_test: i64,
    ) -> i32;
    fn n4m_validation_plan_get_n_samples(
        plan: *const ValidationPlanRaw,
        out_n_samples: *mut i64,
    ) -> i32;
    fn n4m_validation_plan_get_n_folds(
        plan: *const ValidationPlanRaw,
        out_n_folds: *mut i32,
    ) -> i32;
    fn n4m_serialization_inspect(
        buffer: *const c_void,
        len: usize,
        out_version: *mut u32,
        out_major: *mut u32,
        out_minor: *mut u32,
        out_patch: *mut u32,
    ) -> i32;
    fn n4m_serialization_inspect_model_v1(
        buffer: *const c_void,
        len: usize,
        out_info: *mut SerializedModelInfoV1Raw,
    ) -> i32;
    fn n4m_serialization_inspect_pipeline_v1(
        buffer: *const c_void,
        len: usize,
        out_info: *mut SerializedPipelineInfoV1Raw,
        out_info_size: usize,
    ) -> i32;
    fn n4m_search_space_create(out: *mut *mut SearchSpaceRaw) -> i32;
    fn n4m_search_space_destroy(space: *mut SearchSpaceRaw);
    fn n4m_search_space_add_int(
        space: *mut SearchSpaceRaw,
        name: *const c_char,
        low: i64,
        high: i64,
        step: i64,
        log: i32,
    ) -> i32;
    fn n4m_search_space_add_float(
        space: *mut SearchSpaceRaw,
        name: *const c_char,
        low: f64,
        high: f64,
        step: f64,
        log: i32,
    ) -> i32;
    fn n4m_search_space_add_categorical(
        space: *mut SearchSpaceRaw,
        name: *const c_char,
        kind: i32,
        values: *const c_void,
        n: i32,
    ) -> i32;
    fn n4m_search_space_add_ordinal(
        space: *mut SearchSpaceRaw,
        name: *const c_char,
        values: *const f64,
        n: i32,
    ) -> i32;
    fn n4m_search_space_add_sorted_tuple(
        space: *mut SearchSpaceRaw,
        name: *const c_char,
        length: i32,
        low: f64,
        high: f64,
        integer: i32,
    ) -> i32;
    fn n4m_search_space_add_constraint(
        space: *mut SearchSpaceRaw,
        kind: i32,
        params: *const *const c_char,
        labels: *const *const c_char,
        n: i32,
    ) -> i32;
    fn n4m_search_space_num_params(space: *const SearchSpaceRaw, out: *mut i32) -> i32;
    fn n4m_optimizer_options_init(opts: *mut OptimizerOptionsRaw);
    fn n4m_optimizer_create(
        ctx: *mut ContextRaw,
        space: *const SearchSpaceRaw,
        opts: *const OptimizerOptionsRaw,
        out: *mut *mut OptimizerRaw,
    ) -> i32;
    fn n4m_optimizer_destroy(opt: *mut OptimizerRaw);
    fn n4m_optimizer_enqueue(
        opt: *mut OptimizerRaw,
        names: *const *const c_char,
        values: *const f64,
        n: i32,
    ) -> i32;
    fn n4m_optimizer_ask(opt: *mut OptimizerRaw, out: *mut *mut TrialRaw) -> i32;
    fn n4m_optimizer_ask_batch(
        opt: *mut OptimizerRaw,
        n: i32,
        out: *mut *mut TrialRaw,
        count: *mut i32,
    ) -> i32;
    fn n4m_optimizer_tell(opt: *mut OptimizerRaw, id: i64, score: f64) -> i32;
    fn n4m_optimizer_tell_result(
        opt: *mut OptimizerRaw,
        id: i64,
        status: i32,
        score: f64,
        error: *const c_char,
    ) -> i32;
    fn n4m_optimizer_tell_intermediate(
        opt: *mut OptimizerRaw,
        id: i64,
        step: i32,
        score: f64,
        prune: *mut i32,
    ) -> i32;
    fn n4m_optimizer_best(
        opt: *const OptimizerRaw,
        trial: *mut *mut TrialRaw,
        score: *mut f64,
    ) -> i32;
    fn n4m_optimizer_get_trials(
        opt: *const OptimizerRaw,
        since: i64,
        out: *mut *mut MethodResultRaw,
    ) -> i32;
    fn n4m_optimizer_save(opt: *const OptimizerRaw, out: *mut *mut ArrayRaw) -> i32;
    fn n4m_optimizer_load(
        ctx: *mut ContextRaw,
        bytes: *const u8,
        len: u64,
        out: *mut *mut OptimizerRaw,
    ) -> i32;
    fn n4m_trial_get_id(trial: *const TrialRaw, out: *mut i64) -> i32;
    fn n4m_trial_get_int(trial: *const TrialRaw, name: *const c_char, out: *mut i64) -> i32;
    fn n4m_trial_get_float(trial: *const TrialRaw, name: *const c_char, out: *mut f64) -> i32;
    fn n4m_trial_get_category(
        trial: *const TrialRaw,
        name: *const c_char,
        index: *mut i32,
        label: *mut *const c_char,
    ) -> i32;
    fn n4m_trial_is_active(trial: *const TrialRaw, name: *const c_char, out: *mut i32) -> i32;
    fn n4m_trial_get_rung(trial: *const TrialRaw, out: *mut i32) -> i32;
    fn n4m_trial_get_status(trial: *const TrialRaw, out: *mut i32) -> i32;
    fn n4m_trial_get_duration(trial: *const TrialRaw, out: *mut f64) -> i32;
    fn n4m_array_view(array: *const ArrayRaw, out: *mut MatrixView) -> i32;
    fn n4m_array_free(array: *mut ArrayRaw);
    fn n4m_method_result_destroy(result: *mut MethodResultRaw);
    fn n4m_method_result_get_double_matrix(
        result: *const MethodResultRaw,
        name: *const c_char,
        data: *mut *const f64,
        rows: *mut i64,
        cols: *mut i64,
    ) -> i32;
    fn n4m_method_result_get_int_vector(
        result: *const MethodResultRaw,
        name: *const c_char,
        data: *mut *const i32,
        size: *mut i32,
    ) -> i32;
    fn n4m_method_result_get_int64_vector(
        result: *const MethodResultRaw,
        name: *const c_char,
        data: *mut *const i64,
        size: *mut i64,
    ) -> i32;
    fn n4m_method_result_get_scalar(
        result: *const MethodResultRaw,
        name: *const c_char,
        value: *mut f64,
    ) -> i32;
    fn n4m_estimators_ridge_fit(
        ctx: *mut ContextRaw,
        cfg: *const ConfigRaw,
        x: *const MatrixView,
        y: *const MatrixView,
        lambdas: *const f64,
        n_lambdas: i64,
        out_result: *mut *mut MethodResultRaw,
    ) -> i32;
    fn n4m_finetune_estimator(
        ctx: *mut ContextRaw,
        estimator: i32,
        x: *const MatrixView,
        y: *const MatrixView,
        plan: *const ValidationPlanRaw,
        space: *const SearchSpaceRaw,
        opts: *const OptimizerOptionsRaw,
        n_trials: i32,
        out_result: *mut *mut MethodResultRaw,
    ) -> i32;
}

#[cfg(feature = "dynamic")]
mod dynamic;
#[cfg(feature = "dynamic")]
pub use dynamic::configure_library;
#[cfg(feature = "dynamic")]
use dynamic::*;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ErrorKind {
    InvalidArgument,
    NullPointer,
    ShapeMismatch,
    DtypeMismatch,
    StrideInvalid,
    NotFitted,
    NumericalFailure,
    ConvergenceFailed,
    OutOfMemory,
    Unsupported,
    NotImplemented,
    AbiMismatch,
    Io,
    CorruptBuffer,
    VersionIncompatible,
    BackendUnavailable,
    Cancelled,
    Internal,
    Unknown,
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Error {
    pub kind: ErrorKind,
    pub status: i32,
    pub message: String,
}
impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "libn4m {:?} ({}): {}",
            self.kind, self.status, self.message
        )
    }
}
impl std::error::Error for Error {}
fn kind(s: i32) -> ErrorKind {
    match s {
        1 => ErrorKind::InvalidArgument,
        2 => ErrorKind::NullPointer,
        3 => ErrorKind::ShapeMismatch,
        4 => ErrorKind::DtypeMismatch,
        5 => ErrorKind::StrideInvalid,
        6 => ErrorKind::NotFitted,
        7 => ErrorKind::NumericalFailure,
        8 => ErrorKind::ConvergenceFailed,
        9 => ErrorKind::OutOfMemory,
        10 => ErrorKind::Unsupported,
        11 => ErrorKind::NotImplemented,
        12 => ErrorKind::AbiMismatch,
        13 => ErrorKind::Io,
        14 => ErrorKind::CorruptBuffer,
        15 => ErrorKind::VersionIncompatible,
        16 => ErrorKind::BackendUnavailable,
        17 => ErrorKind::Cancelled,
        255 => ErrorKind::Internal,
        _ => ErrorKind::Unknown,
    }
}
fn error(status: i32, ctx: Option<*const ContextRaw>) -> Error {
    let message = ctx
        .and_then(|p| unsafe {
            let x = n4m_context_last_error(p);
            (!x.is_null()).then(|| CStr::from_ptr(x).to_string_lossy().into_owned())
        })
        .filter(|x| !x.is_empty())
        .unwrap_or_else(|| unsafe {
            let x = n4m_status_to_string(status);
            if x.is_null() {
                "unknown status".into()
            } else {
                CStr::from_ptr(x).to_string_lossy().into_owned()
            }
        });
    Error {
        kind: kind(status),
        status,
        message,
    }
}
fn check(status: i32, ctx: Option<*const ContextRaw>) -> Result<(), Error> {
    if status == OK {
        Ok(())
    } else {
        Err(error(status, ctx))
    }
}
fn corrupt(message: impl Into<String>) -> Error {
    Error {
        kind: ErrorKind::CorruptBuffer,
        status: CORRUPT_BUFFER,
        message: message.into(),
    }
}
fn invalid(message: impl Into<String>) -> Error {
    Error {
        kind: ErrorKind::InvalidArgument,
        status: 1,
        message: message.into(),
    }
}
fn i32_from_scalar(value: f64, what: &str) -> Result<i32, Error> {
    if !value.is_finite()
        || value.fract() != 0.0
        || value < i32::MIN as f64
        || value > i32::MAX as f64
    {
        return Err(corrupt(format!("native {what} scalar is invalid")));
    }
    Ok(value as i32)
}
fn bool_from_scalar(value: f64, what: &str) -> Result<bool, Error> {
    match i32_from_scalar(value, what)? {
        0 => Ok(false),
        1 => Ok(true),
        _ => Err(corrupt(format!("native {what} flag is invalid"))),
    }
}
fn metric_from_scalar(value: f64) -> Result<Metric, Error> {
    status_enum(
        i32_from_scalar(value, "metric")?,
        Metric::from_raw,
        "metric",
    )
}
fn cstring(value: &str, what: &str) -> Result<CString, Error> {
    CString::new(value).map_err(|_| invalid(format!("{what} must not contain NUL")))
}
fn status_enum<T>(
    raw: i32,
    convert: impl FnOnce(i32) -> Option<T>,
    what: &str,
) -> Result<T, Error> {
    convert(raw).ok_or_else(|| corrupt(format!("native {what} enum is invalid: {raw}")))
}

macro_rules! c_enum { ($name:ident { $($variant:ident = $value:expr),+ $(,)? }) => { #[derive(Debug, Clone, Copy, PartialEq, Eq)] #[repr(i32)] pub enum $name { $($variant=$value),+ } impl $name { pub fn from_raw(v:i32)->Option<Self>{match v{$($value=>Some(Self::$variant),)+_=>None}} } }; }
c_enum!(ParameterKind { Int=0, Float=1, LogInt=2, LogFloat=3, Categorical=4, Ordinal=5, SortedTuple=6 });
c_enum!(CategoryType { Str=0, Int=1, Float=2, Bool=3 });
c_enum!(ConstraintKind { MutexGroup=0, Requires=1, Exclude=2, ConditionIn=3, ConditionNotIn=4 });
c_enum!(Sampler { Random=0, Sobol=1, Lhs=2, Ternary=3, Ga=4, Pso=5, Cmaes=6, Tpe=7, GpEi=8 });
c_enum!(Pruner { None=0, Median=1, Asha=2, Hyperband=3, Racing=4 });
c_enum!(Direction { Auto=0, Minimize=1, Maximize=2 });
c_enum!(EvalMode { Best=0, Mean=1, RobustBest=2 });
c_enum!(Metric { Rmse=0, Mse=1, Mae=2, R2=3, Accuracy=16, BalancedAccuracy=17, F1=18, Logloss=19 });
c_enum!(Liar { None=0, Min=1, Mean=2, Max=3 });
c_enum!(TrialStatus { Running=0, Completed=1, Pruned=2, Failed=3, Cancelled=4 });

#[derive(Debug, Clone, PartialEq)]
pub enum Category {
    Str(String),
    Int(i64),
    Float(f64),
    Bool(bool),
}
impl Category {
    fn kind(&self) -> CategoryType {
        match self {
            Self::Str(_) => CategoryType::Str,
            Self::Int(_) => CategoryType::Int,
            Self::Float(_) => CategoryType::Float,
            Self::Bool(_) => CategoryType::Bool,
        }
    }
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TrialError {
    pub code: String,
    pub message: String,
    pub retryable: bool,
}
impl TrialError {
    pub fn wire(&self) -> Result<CString, Error> {
        if !valid_error_code(&self.code) || self.message.is_empty() {
            return Err(invalid("trial error code/message is invalid"));
        }
        cstring(
            &format!(
                "n4m.error.v1|{}|{}|{}",
                self.code,
                if self.retryable { 1 } else { 0 },
                self.message
            ),
            "trial error",
        )
    }
}
fn valid_error_code(s: &str) -> bool {
    (2..=64).contains(&s.len())
        && s.as_bytes().first().is_some_and(u8::is_ascii_uppercase)
        && s.bytes()
            .all(|x| x == b'_' || x.is_ascii_uppercase() || x.is_ascii_digit())
}

#[derive(Debug, Clone)]
pub struct OptimizerOptions {
    pub sampler: Sampler,
    pub pruner: Pruner,
    pub direction: Direction,
    pub eval_mode: EvalMode,
    pub metric: Metric,
    pub liar: Liar,
    pub n_startup_trials: i32,
    pub seed: u64,
    pub timeout_seconds: f64,
    pub max_resource: i32,
    pub reduction_factor: i32,
}
impl Default for OptimizerOptions {
    fn default() -> Self {
        Self {
            sampler: Sampler::Random,
            pruner: Pruner::None,
            direction: Direction::Auto,
            eval_mode: EvalMode::Mean,
            metric: Metric::Rmse,
            liar: Liar::None,
            n_startup_trials: 10,
            seed: 0,
            timeout_seconds: 0.0,
            max_resource: 0,
            reduction_factor: 0,
        }
    }
}
impl OptimizerOptions {
    fn raw(&self) -> OptimizerOptionsRaw {
        let mut raw = mem::MaybeUninit::<OptimizerOptionsRaw>::uninit();
        unsafe { n4m_optimizer_options_init(raw.as_mut_ptr()) };
        let mut raw = unsafe { raw.assume_init() };
        raw.sampler = self.sampler as i32;
        raw.pruner = self.pruner as i32;
        raw.direction = self.direction as i32;
        raw.eval_mode = self.eval_mode as i32;
        raw.metric = self.metric as i32;
        raw.liar = self.liar as i32;
        raw.n_startup_trials = self.n_startup_trials;
        raw.seed = self.seed;
        raw.timeout_seconds = self.timeout_seconds;
        raw.max_resource = self.max_resource;
        raw.reduction_factor = self.reduction_factor;
        raw
    }
}

/// Native context. It is `!Send + !Sync`; use one context per host thread.
pub struct Context {
    raw: NonNull<ContextRaw>,
    _thread_bound: PhantomData<*mut ()>,
}
impl Context {
    pub fn new() -> Result<Self, Error> {
        #[cfg(feature = "dynamic")]
        dynamic::ensure_runtime()?;
        check(
            unsafe { n4m_check_abi_compatibility(ABI_MAJOR, ABI_MINOR) },
            None,
        )?;
        let mut raw = ptr::null_mut();
        check(unsafe { n4m_context_create(&mut raw) }, None)?;
        Ok(Self {
            raw: NonNull::new(raw).ok_or_else(|| error(255, None))?,
            _thread_bound: PhantomData,
        })
    }
    fn ptr(&self) -> *mut ContextRaw {
        self.raw.as_ptr()
    }
}
impl Drop for Context {
    fn drop(&mut self) {
        unsafe { n4m_context_destroy(self.ptr()) }
    }
}

/// Native estimator routes understood by [`finetune_estimator`]. The native
/// driver accepts only the documented generic regression subset and refuses
/// every other variant before a study is created.
#[repr(i32)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Estimator {
    PlsRegression = 0,
    PlsCanonical = 1,
    PlsSvd = 2,
    PlsDa = 3,
    Opls = 4,
    OplsDa = 5,
    SparsePls = 6,
    MbPls = 7,
    LwPls = 8,
    AomPls = 9,
    Pcr = 10,
}
impl Estimator {
    pub fn from_raw(value: i32) -> Option<Self> {
        match value {
            0 => Some(Self::PlsRegression),
            1 => Some(Self::PlsCanonical),
            2 => Some(Self::PlsSvd),
            3 => Some(Self::PlsDa),
            4 => Some(Self::Opls),
            5 => Some(Self::OplsDa),
            6 => Some(Self::SparsePls),
            7 => Some(Self::MbPls),
            8 => Some(Self::LwPls),
            9 => Some(Self::AomPls),
            10 => Some(Self::Pcr),
            _ => None,
        }
    }
}
fn estimator_from_scalar(value: f64) -> Result<Estimator, Error> {
    status_enum(
        i32_from_scalar(value, "estimator")?,
        Estimator::from_raw,
        "estimator",
    )
}

/// Caller-built native cross-validation fold plan. Input indices are copied by
/// libn4m and may be released immediately after [`Self::add_fold`].
pub struct ValidationPlan {
    raw: NonNull<ValidationPlanRaw>,
    _thread_bound: PhantomData<*mut ()>,
}
impl ValidationPlan {
    pub fn new() -> Result<Self, Error> {
        let mut raw = ptr::null_mut();
        check(unsafe { n4m_validation_plan_create(&mut raw) }, None)?;
        Ok(Self {
            raw: NonNull::new(raw).ok_or_else(|| error(255, None))?,
            _thread_bound: PhantomData,
        })
    }
    fn ptr(&self) -> *mut ValidationPlanRaw {
        self.raw.as_ptr()
    }
    pub fn set_n_samples(&mut self, n_samples: usize) -> Result<&mut Self, Error> {
        let n_samples = i64::try_from(n_samples)
            .map_err(|_| invalid("validation-plan sample count exceeds C ABI range"))?;
        check(
            unsafe { n4m_validation_plan_set_n_samples(self.ptr(), n_samples) },
            None,
        )?;
        Ok(self)
    }
    pub fn add_fold(
        &mut self,
        train_indices: &[i64],
        test_indices: &[i64],
    ) -> Result<&mut Self, Error> {
        if train_indices.is_empty() || test_indices.is_empty() {
            return Err(invalid(
                "validation-plan folds require train and test indices",
            ));
        }
        let n_train = i64::try_from(train_indices.len())
            .map_err(|_| invalid("validation-plan train fold exceeds C ABI range"))?;
        let n_test = i64::try_from(test_indices.len())
            .map_err(|_| invalid("validation-plan test fold exceeds C ABI range"))?;
        check(
            unsafe {
                n4m_validation_plan_add_fold(
                    self.ptr(),
                    train_indices.as_ptr(),
                    n_train,
                    test_indices.as_ptr(),
                    n_test,
                )
            },
            None,
        )?;
        Ok(self)
    }
    pub fn n_samples(&self) -> Result<usize, Error> {
        let mut n_samples = 0;
        check(
            unsafe { n4m_validation_plan_get_n_samples(self.ptr(), &mut n_samples) },
            None,
        )?;
        usize::try_from(n_samples).map_err(|_| corrupt("native validation-plan count is invalid"))
    }
    pub fn n_folds(&self) -> Result<usize, Error> {
        let mut n_folds = 0;
        check(
            unsafe { n4m_validation_plan_get_n_folds(self.ptr(), &mut n_folds) },
            None,
        )?;
        usize::try_from(n_folds)
            .map_err(|_| corrupt("native validation-plan fold count is invalid"))
    }
}
impl Drop for ValidationPlan {
    fn drop(&mut self) {
        unsafe { n4m_validation_plan_destroy(self.ptr()) }
    }
}

/// Owning native preprocessing pipeline accepted by [`Model::fit`].
///
/// Construction is intentionally limited to the serializable native slice.
/// The opaque handle is never exposed, and dropping this value releases it.
pub struct Pipeline {
    raw: NonNull<PipelineRaw>,
    _thread_bound: PhantomData<*mut ()>,
}
impl Pipeline {
    /// Build the exact `SNV -> Savitzky-Golay smooth` pipeline supported by
    /// native model fit and N4MM v2.
    ///
    /// The smooth operator canonically fixes derivative order to zero and
    /// delta to one. Native fit remains the authoritative validation point;
    /// these guards reject the same bounded integer domain before allocating
    /// a handle.
    pub fn snv_savgol(window: i32, poly_degree: i32) -> Result<Self, Error> {
        if !(3..=501).contains(&window) || window % 2 == 0 {
            return Err(invalid(
                "Savitzky-Golay window length must be an odd integer in [3, 501]",
            ));
        }
        if poly_degree < 0 || poly_degree >= window {
            return Err(invalid(
                "Savitzky-Golay polynomial degree must be non-negative and smaller than the window length",
            ));
        }

        let mut raw = ptr::null_mut();
        check(unsafe { n4m_pipeline_create(&mut raw) }, None)?;
        let pipeline = Self {
            raw: NonNull::new(raw).ok_or_else(|| error(255, None))?,
            _thread_bound: PhantomData,
        };
        check(
            unsafe { n4m_pipeline_add_operator(pipeline.ptr(), 4, ptr::null(), 0) },
            None,
        )?;
        let savgol = [f64::from(window), f64::from(poly_degree)];
        check(
            unsafe {
                n4m_pipeline_add_operator(pipeline.ptr(), 8, savgol.as_ptr(), savgol.len() as i32)
            },
            None,
        )?;
        Ok(pipeline)
    }

    fn ptr(&self) -> *mut PipelineRaw {
        self.raw.as_ptr()
    }
}
impl Drop for Pipeline {
    fn drop(&mut self) {
        unsafe { n4m_pipeline_destroy(self.ptr()) }
    }
}

/// Mutable native fit configuration. It uses libn4m's defaults until a setter
/// below is called; no fitting behaviour is implemented in Rust. An attached
/// pipeline remains owned by the configuration for every native fit call.
pub struct Config {
    raw: NonNull<ConfigRaw>,
    pipeline: Option<Pipeline>,
    _thread_bound: PhantomData<*mut ()>,
}
impl Config {
    pub fn new() -> Result<Self, Error> {
        let mut raw = ptr::null_mut();
        check(unsafe { n4m_config_create(&mut raw) }, None)?;
        Ok(Self {
            raw: NonNull::new(raw).ok_or_else(|| error(255, None))?,
            pipeline: None,
            _thread_bound: PhantomData,
        })
    }
    fn ptr(&self) -> *mut ConfigRaw {
        self.raw.as_ptr()
    }
    pub fn set_n_components(&mut self, n: i32) -> Result<&mut Self, Error> {
        check(unsafe { n4m_config_set_n_components(self.ptr(), n) }, None)?;
        Ok(self)
    }
    pub fn set_center_x(&mut self, enabled: bool) -> Result<&mut Self, Error> {
        check(
            unsafe { n4m_config_set_center_x(self.ptr(), i32::from(enabled)) },
            None,
        )?;
        Ok(self)
    }
    pub fn set_scale_x(&mut self, enabled: bool) -> Result<&mut Self, Error> {
        check(
            unsafe { n4m_config_set_scale_x(self.ptr(), i32::from(enabled)) },
            None,
        )?;
        Ok(self)
    }
    pub fn set_center_y(&mut self, enabled: bool) -> Result<&mut Self, Error> {
        check(
            unsafe { n4m_config_set_center_y(self.ptr(), i32::from(enabled)) },
            None,
        )?;
        Ok(self)
    }
    pub fn set_scale_y(&mut self, enabled: bool) -> Result<&mut Self, Error> {
        check(
            unsafe { n4m_config_set_scale_y(self.ptr(), i32::from(enabled)) },
            None,
        )?;
        Ok(self)
    }
    pub fn set_store_scores(&mut self, enabled: bool) -> Result<&mut Self, Error> {
        check(
            unsafe { n4m_config_set_store_scores(self.ptr(), i32::from(enabled)) },
            None,
        )?;
        Ok(self)
    }

    /// Attach an owning native pipeline. Replacing a pipeline releases the old
    /// handle only after the native configuration points at the replacement.
    pub fn set_pipeline(&mut self, pipeline: Pipeline) -> Result<&mut Self, Error> {
        check(
            unsafe { n4m_config_set_pipeline(self.ptr(), pipeline.ptr()) },
            None,
        )?;
        self.pipeline = Some(pipeline);
        Ok(self)
    }

    /// Construct and attach the supported `SNV -> Savitzky-Golay smooth`
    /// pipeline while retaining its handle for the lifetime of this config.
    pub fn set_snv_savgol_pipeline(
        &mut self,
        window: i32,
        poly_degree: i32,
    ) -> Result<&mut Self, Error> {
        self.set_pipeline(Pipeline::snv_savgol(window, poly_degree)?)
    }
}
impl Drop for Config {
    fn drop(&mut self) {
        unsafe { n4m_config_destroy(self.ptr()) }
    }
}

/// Borrowed row-major `f64` input accepted by the native matrix ABI.
#[derive(Debug, Clone, Copy)]
pub struct MatrixRef<'a> {
    data: &'a [f64],
    rows: usize,
    cols: usize,
}
impl<'a> MatrixRef<'a> {
    pub fn row_major(data: &'a [f64], rows: usize, cols: usize) -> Result<Self, Error> {
        let cells = rows
            .checked_mul(cols)
            .ok_or_else(|| invalid("matrix dimensions overflow"))?;
        if data.len() != cells {
            return Err(invalid(
                "row-major matrix data length does not match dimensions",
            ));
        }
        i64::try_from(rows).map_err(|_| invalid("matrix rows exceed C ABI range"))?;
        i64::try_from(cols).map_err(|_| invalid("matrix cols exceed C ABI range"))?;
        Ok(Self { data, rows, cols })
    }
    pub fn rows(self) -> usize {
        self.rows
    }
    pub fn cols(self) -> usize {
        self.cols
    }
    fn raw(self) -> MatrixView {
        MatrixView {
            data: self.data.as_ptr().cast_mut().cast(),
            rows: self.rows as i64,
            cols: self.cols as i64,
            row_stride: self.cols as i64,
            col_stride: 1,
            dtype: 1,
            reserved0: 0,
        }
    }
}

/// Owned row-major matrix copied out of a libn4m allocation.
#[derive(Debug, Clone, PartialEq)]
pub struct Matrix {
    pub data: Vec<f64>,
    pub rows: usize,
    pub cols: usize,
}
impl Matrix {
    pub fn as_ref(&self) -> MatrixRef<'_> {
        // Invariant is established by every constructor in this binding.
        MatrixRef::row_major(&self.data, self.rows, self.cols).expect("valid owned matrix")
    }
}

/// Opaque, mutable native search-space builder. The library copies every input.
pub struct SearchSpace {
    raw: NonNull<SearchSpaceRaw>,
    parameter_names: Vec<String>,
    _thread_bound: PhantomData<*mut ()>,
}
impl SearchSpace {
    pub fn new() -> Result<Self, Error> {
        let mut raw = ptr::null_mut();
        check(unsafe { n4m_search_space_create(&mut raw) }, None)?;
        Ok(Self {
            raw: NonNull::new(raw).ok_or_else(|| error(255, None))?,
            parameter_names: Vec::new(),
            _thread_bound: PhantomData,
        })
    }
    fn ptr(&self) -> *mut SearchSpaceRaw {
        self.raw.as_ptr()
    }
    pub fn add_int(
        &mut self,
        name: &str,
        low: i64,
        high: i64,
        step: i64,
        log: bool,
    ) -> Result<&mut Self, Error> {
        let n = cstring(name, "parameter name")?;
        check(
            unsafe {
                n4m_search_space_add_int(self.ptr(), n.as_ptr(), low, high, step, i32::from(log))
            },
            None,
        )?;
        self.parameter_names.push(name.to_owned());
        Ok(self)
    }
    pub fn add_float(
        &mut self,
        name: &str,
        low: f64,
        high: f64,
        step: f64,
        log: bool,
    ) -> Result<&mut Self, Error> {
        let n = cstring(name, "parameter name")?;
        check(
            unsafe {
                n4m_search_space_add_float(self.ptr(), n.as_ptr(), low, high, step, i32::from(log))
            },
            None,
        )?;
        self.parameter_names.push(name.to_owned());
        Ok(self)
    }
    pub fn add_categorical(&mut self, name: &str, values: &[Category]) -> Result<&mut Self, Error> {
        let n = cstring(name, "parameter name")?;
        let count =
            i32::try_from(values.len()).map_err(|_| invalid("too many categorical values"))?;
        let kind = values
            .first()
            .map(Category::kind)
            .ok_or_else(|| invalid("categorical values must not be empty"))?;
        if values.iter().any(|x| x.kind() != kind) {
            return Err(invalid("categorical values must have one type"));
        }
        let status = match kind {
            CategoryType::Str => {
                let strings: Result<Vec<_>, _> = values
                    .iter()
                    .map(|x| match x {
                        Category::Str(s) => cstring(s, "category"),
                        _ => unreachable!(),
                    })
                    .collect();
                let strings = strings?;
                let ptrs: Vec<_> = strings.iter().map(|x| x.as_ptr()).collect();
                unsafe {
                    n4m_search_space_add_categorical(
                        self.ptr(),
                        n.as_ptr(),
                        kind as i32,
                        ptrs.as_ptr().cast(),
                        count,
                    )
                }
            }
            CategoryType::Int => {
                let xs: Vec<i64> = values
                    .iter()
                    .map(|x| match x {
                        Category::Int(v) => *v,
                        _ => unreachable!(),
                    })
                    .collect();
                unsafe {
                    n4m_search_space_add_categorical(
                        self.ptr(),
                        n.as_ptr(),
                        kind as i32,
                        xs.as_ptr().cast(),
                        count,
                    )
                }
            }
            CategoryType::Float => {
                let xs: Vec<f64> = values
                    .iter()
                    .map(|x| match x {
                        Category::Float(v) => *v,
                        _ => unreachable!(),
                    })
                    .collect();
                unsafe {
                    n4m_search_space_add_categorical(
                        self.ptr(),
                        n.as_ptr(),
                        kind as i32,
                        xs.as_ptr().cast(),
                        count,
                    )
                }
            }
            CategoryType::Bool => {
                let xs: Vec<i32> = values
                    .iter()
                    .map(|x| match x {
                        Category::Bool(v) => i32::from(*v),
                        _ => unreachable!(),
                    })
                    .collect();
                unsafe {
                    n4m_search_space_add_categorical(
                        self.ptr(),
                        n.as_ptr(),
                        kind as i32,
                        xs.as_ptr().cast(),
                        count,
                    )
                }
            }
        };
        check(status, None)?;
        self.parameter_names.push(name.to_owned());
        Ok(self)
    }
    pub fn add_ordinal(&mut self, name: &str, values: &[f64]) -> Result<&mut Self, Error> {
        let n = cstring(name, "parameter name")?;
        let count = i32::try_from(values.len()).map_err(|_| invalid("too many ordinal values"))?;
        check(
            unsafe { n4m_search_space_add_ordinal(self.ptr(), n.as_ptr(), values.as_ptr(), count) },
            None,
        )?;
        self.parameter_names.push(name.to_owned());
        Ok(self)
    }
    pub fn add_sorted_tuple(
        &mut self,
        name: &str,
        length: i32,
        low: f64,
        high: f64,
        integer: bool,
    ) -> Result<&mut Self, Error> {
        let n = cstring(name, "parameter name")?;
        check(
            unsafe {
                n4m_search_space_add_sorted_tuple(
                    self.ptr(),
                    n.as_ptr(),
                    length,
                    low,
                    high,
                    i32::from(integer),
                )
            },
            None,
        )?;
        self.parameter_names
            .extend((0..length).map(|index| format!("{name}#{index}")));
        Ok(self)
    }
    pub fn add_constraint(
        &mut self,
        kind: ConstraintKind,
        params: &[&str],
        labels: &[Option<&str>],
    ) -> Result<&mut Self, Error> {
        if params.len() != labels.len() {
            return Err(invalid(
                "parameter and label references must have equal length",
            ));
        }
        let p: Result<Vec<_>, _> = params
            .iter()
            .map(|x| cstring(x, "parameter reference"))
            .collect();
        let p = p?;
        let l: Result<Vec<_>, _> = labels
            .iter()
            .map(|x| cstring(x.unwrap_or(""), "label reference"))
            .collect();
        let l = l?;
        let pp: Vec<_> = p.iter().map(|x| x.as_ptr()).collect();
        let lp: Vec<_> = l.iter().map(|x| x.as_ptr()).collect();
        let n =
            i32::try_from(params.len()).map_err(|_| invalid("too many constraint references"))?;
        check(
            unsafe {
                n4m_search_space_add_constraint(
                    self.ptr(),
                    kind as i32,
                    pp.as_ptr(),
                    lp.as_ptr(),
                    n,
                )
            },
            None,
        )?;
        Ok(self)
    }
    pub fn len(&self) -> Result<i32, Error> {
        let mut n = 0;
        check(
            unsafe { n4m_search_space_num_params(self.ptr(), &mut n) },
            None,
        )?;
        Ok(n)
    }
    pub fn is_empty(&self) -> Result<bool, Error> {
        Ok(self.len()? == 0)
    }

    fn parameter_names(&self) -> &[String] {
        &self.parameter_names
    }
}
impl Drop for SearchSpace {
    fn drop(&mut self) {
        unsafe { n4m_search_space_destroy(self.ptr()) }
    }
}

/// A trial borrowed from an [`Optimizer`]; it cannot outlive its owner.
#[derive(Debug)]
pub struct Trial<'a> {
    raw: NonNull<TrialRaw>,
    _optimizer: PhantomData<&'a Optimizer>,
}
impl<'a> Trial<'a> {
    fn new(raw: *mut TrialRaw) -> Result<Self, Error> {
        Ok(Self {
            raw: NonNull::new(raw).ok_or_else(|| error(255, None))?,
            _optimizer: PhantomData,
        })
    }
    fn ptr(&self) -> *const TrialRaw {
        self.raw.as_ptr()
    }
    pub fn id(&self) -> Result<i64, Error> {
        let mut v = 0;
        check(unsafe { n4m_trial_get_id(self.ptr(), &mut v) }, None)?;
        Ok(v)
    }
    pub fn int(&self, name: &str) -> Result<i64, Error> {
        let n = cstring(name, "parameter name")?;
        let mut v = 0;
        check(
            unsafe { n4m_trial_get_int(self.ptr(), n.as_ptr(), &mut v) },
            None,
        )?;
        Ok(v)
    }
    pub fn float(&self, name: &str) -> Result<f64, Error> {
        let n = cstring(name, "parameter name")?;
        let mut v = 0.;
        check(
            unsafe { n4m_trial_get_float(self.ptr(), n.as_ptr(), &mut v) },
            None,
        )?;
        Ok(v)
    }
    pub fn category(&self, name: &str) -> Result<(i32, String), Error> {
        let n = cstring(name, "parameter name")?;
        let (mut i, mut l) = (0, ptr::null());
        check(
            unsafe { n4m_trial_get_category(self.ptr(), n.as_ptr(), &mut i, &mut l) },
            None,
        )?;
        if l.is_null() {
            return Err(corrupt("native categorical label is null"));
        }
        Ok((i, unsafe {
            CStr::from_ptr(l).to_string_lossy().into_owned()
        }))
    }
    pub fn is_active(&self, name: &str) -> Result<bool, Error> {
        let n = cstring(name, "parameter name")?;
        let mut v = 0;
        check(
            unsafe { n4m_trial_is_active(self.ptr(), n.as_ptr(), &mut v) },
            None,
        )?;
        match v {
            0 => Ok(false),
            1 => Ok(true),
            _ => Err(corrupt("native activation bit is invalid")),
        }
    }
    pub fn rung(&self) -> Result<i32, Error> {
        let mut v = 0;
        check(unsafe { n4m_trial_get_rung(self.ptr(), &mut v) }, None)?;
        Ok(v)
    }
    pub fn status(&self) -> Result<TrialStatus, Error> {
        let mut v = 0;
        check(unsafe { n4m_trial_get_status(self.ptr(), &mut v) }, None)?;
        status_enum(v, TrialStatus::from_raw, "trial status")
    }
    pub fn duration(&self) -> Result<f64, Error> {
        let mut v = 0.;
        check(unsafe { n4m_trial_get_duration(self.ptr(), &mut v) }, None)?;
        Ok(v)
    }
}

#[derive(Debug)]
pub enum AskBatchError<'a> {
    Error(Error),
    Partial {
        error: Error,
        trials: Vec<Trial<'a>>,
    },
}
impl<'a> AskBatchError<'a> {
    pub fn error(&self) -> &Error {
        match self {
            Self::Error(e) | Self::Partial { error: e, .. } => e,
        }
    }
    pub fn partial_trials(&self) -> &[Trial<'a>] {
        match self {
            Self::Error(_) => &[],
            Self::Partial { trials, .. } => trials,
        }
    }
}
#[derive(Debug, Clone, PartialEq)]
pub struct Intermediate {
    pub sequence: i64,
    pub step: i32,
    pub score: f64,
    pub should_prune: bool,
}
#[derive(Debug, Clone, PartialEq)]
pub struct TrialParameter {
    pub value: f64,
    pub kind: ParameterKind,
    pub category_index: Option<i32>,
    pub category_label: Option<String>,
    pub category_type: Option<CategoryType>,
    pub integer: bool,
    pub active: bool,
}
#[derive(Debug, Clone, PartialEq)]
pub struct TrialSnapshot {
    pub id: i64,
    pub ask_sequence: i64,
    pub terminal_sequence: Option<i64>,
    pub parameters: BTreeMap<String, TrialParameter>,
    /// Native search-space declaration order. `parameters` remains keyed for
    /// lookup compatibility, but callers that need a rich replay must use this
    /// sequence rather than the map's lexical ordering.
    pub parameter_order: Vec<String>,
    pub status: TrialStatus,
    pub score: Option<f64>,
    pub rung: i32,
    pub duration: f64,
    pub intermediates: Vec<Intermediate>,
    pub error: Option<TrialError>,
}

#[derive(Debug)]
pub struct Optimizer {
    raw: NonNull<OptimizerRaw>,
    _thread_bound: PhantomData<*mut ()>,
}
impl Optimizer {
    pub fn new(
        ctx: &Context,
        space: &SearchSpace,
        options: &OptimizerOptions,
    ) -> Result<Self, Error> {
        let raw_opts = options.raw();
        let mut raw = ptr::null_mut();
        check(
            unsafe { n4m_optimizer_create(ctx.ptr(), space.ptr(), &raw_opts, &mut raw) },
            Some(ctx.ptr()),
        )?;
        Ok(Self {
            raw: NonNull::new(raw).ok_or_else(|| error(255, Some(ctx.ptr())))?,
            _thread_bound: PhantomData,
        })
    }
    fn ptr(&self) -> *mut OptimizerRaw {
        self.raw.as_ptr()
    }
    pub fn enqueue(&self, parameters: &[(&str, f64)]) -> Result<(), Error> {
        let names: Result<Vec<_>, _> = parameters
            .iter()
            .map(|(n, _)| cstring(n, "parameter name"))
            .collect();
        let names = names?;
        let pointers: Vec<_> = names.iter().map(|n| n.as_ptr()).collect();
        let values: Vec<_> = parameters.iter().map(|(_, v)| *v).collect();
        let n = i32::try_from(values.len()).map_err(|_| invalid("too many queued parameters"))?;
        check(
            unsafe { n4m_optimizer_enqueue(self.ptr(), pointers.as_ptr(), values.as_ptr(), n) },
            None,
        )
    }
    pub fn ask(&self) -> Result<Trial<'_>, Error> {
        let mut raw = ptr::null_mut();
        check(unsafe { n4m_optimizer_ask(self.ptr(), &mut raw) }, None)?;
        Trial::new(raw)
    }
    pub fn ask_batch(&self, n: i32) -> Result<Vec<Trial<'_>>, AskBatchError<'_>> {
        if n <= 0 {
            let mut count = 0;
            let s = unsafe { n4m_optimizer_ask_batch(self.ptr(), n, ptr::null_mut(), &mut count) };
            return if s == OK {
                Ok(Vec::new())
            } else {
                Err(AskBatchError::Error(error(s, None)))
            };
        }
        if n > MAX_ASK_BATCH {
            return Err(AskBatchError::Error(invalid(format!(
                "ask batch exceeds the safe allocation limit of {MAX_ASK_BATCH}"
            ))));
        }
        let mut raw = vec![ptr::null_mut(); n as usize];
        let mut count = 0;
        let s = unsafe { n4m_optimizer_ask_batch(self.ptr(), n, raw.as_mut_ptr(), &mut count) };
        let committed = usize::try_from(count)
            .ok()
            .filter(|x| *x <= raw.len())
            .ok_or_else(|| AskBatchError::Error(corrupt("native batch count is invalid")))?;
        let trials: Result<Vec<_>, _> = raw.into_iter().take(committed).map(Trial::new).collect();
        let trials = trials.map_err(AskBatchError::Error)?;
        if s == OK {
            Ok(trials)
        } else if trials.is_empty() {
            Err(AskBatchError::Error(error(s, None)))
        } else {
            Err(AskBatchError::Partial {
                error: error(s, None),
                trials,
            })
        }
    }
    pub fn tell(&self, id: i64, score: f64) -> Result<(), Error> {
        check(unsafe { n4m_optimizer_tell(self.ptr(), id, score) }, None)
    }
    pub fn tell_result(
        &self,
        id: i64,
        status: TrialStatus,
        score: f64,
        error_value: Option<&TrialError>,
    ) -> Result<(), Error> {
        let wire = match error_value {
            Some(x) => Some(x.wire()?),
            None => None,
        };
        check(
            unsafe {
                n4m_optimizer_tell_result(
                    self.ptr(),
                    id,
                    status as i32,
                    score,
                    wire.as_ref().map_or(ptr::null(), |x| x.as_ptr()),
                )
            },
            None,
        )
    }
    pub fn tell_intermediate(&self, id: i64, step: i32, score: f64) -> Result<bool, Error> {
        let mut prune = 0;
        check(
            unsafe { n4m_optimizer_tell_intermediate(self.ptr(), id, step, score, &mut prune) },
            None,
        )?;
        match prune {
            0 => Ok(false),
            1 => Ok(true),
            _ => Err(corrupt("native prune decision is invalid")),
        }
    }
    pub fn best(&self) -> Result<Option<(Trial<'_>, f64)>, Error> {
        let (mut raw, mut score) = (ptr::null_mut(), 0.);
        let s = unsafe { n4m_optimizer_best(self.ptr(), &mut raw, &mut score) };
        if s == NOT_FITTED {
            return Ok(None);
        };
        check(s, None)?;
        Ok(Some((Trial::new(raw)?, score)))
    }
    pub fn trials(&self, since_id: i64) -> Result<Vec<TrialSnapshot>, Error> {
        if since_id < 0 {
            return Err(invalid("since_id must be non-negative"));
        }
        let mut raw = ptr::null_mut();
        check(
            unsafe { n4m_optimizer_get_trials(self.ptr(), since_id, &mut raw) },
            None,
        )?;
        let raw = NonNull::new(raw).ok_or_else(|| error(255, None))?;
        struct Owner(NonNull<MethodResultRaw>);
        impl Drop for Owner {
            fn drop(&mut self) {
                unsafe { n4m_method_result_destroy(self.0.as_ptr()) }
            }
        }
        let owner = Owner(raw);
        decode_trials(owner.0.as_ptr(), since_id)
    }
    pub fn load_n4mopt(ctx: &Context, bytes: &[u8]) -> Result<Self, Error> {
        preflight_n4mopt(bytes)?;
        let len = u64::try_from(bytes.len()).map_err(|_| invalid("N4MOPT exceeds ABI length"))?;
        let mut raw = ptr::null_mut();
        check(
            unsafe { n4m_optimizer_load(ctx.ptr(), bytes.as_ptr(), len, &mut raw) },
            Some(ctx.ptr()),
        )?;
        Ok(Self {
            raw: NonNull::new(raw).ok_or_else(|| error(255, Some(ctx.ptr())))?,
            _thread_bound: PhantomData,
        })
    }
    pub fn save_n4mopt(&self) -> Result<Vec<u8>, Error> {
        let mut raw = ptr::null_mut();
        check(unsafe { n4m_optimizer_save(self.ptr(), &mut raw) }, None)?;
        let raw = NonNull::new(raw).ok_or_else(|| error(255, None))?;
        struct Owner(NonNull<ArrayRaw>);
        impl Drop for Owner {
            fn drop(&mut self) {
                unsafe { n4m_array_free(self.0.as_ptr()) }
            }
        }
        let owner = Owner(raw);
        let mut view = MatrixView {
            data: ptr::null_mut(),
            rows: 0,
            cols: 0,
            row_stride: 0,
            col_stride: 0,
            dtype: 0,
            reserved0: 0,
        };
        check(unsafe { n4m_array_view(owner.0.as_ptr(), &mut view) }, None)?;
        if view.dtype != DTYPE_I64
            || view.rows != 1
            || view.cols <= 0
            || view.col_stride != 1
            || view.data.is_null()
        {
            return Err(corrupt("native N4MOPT array shape is invalid"));
        }
        let words =
            usize::try_from(view.cols).map_err(|_| corrupt("native N4MOPT words are invalid"))?;
        let len = words
            .checked_mul(8)
            .filter(|n| *n <= MAX_CHECKPOINT_BYTES)
            .ok_or_else(|| corrupt("native N4MOPT exceeds binding checkpoint limit"))?;
        let out = unsafe { slice::from_raw_parts(view.data.cast::<u8>(), len) }.to_vec();
        preflight_n4mopt(&out)?;
        Ok(out)
    }
}
impl Drop for Optimizer {
    fn drop(&mut self) {
        unsafe { n4m_optimizer_destroy(self.ptr()) }
    }
}

/// Output from [`finetune_estimator`]. `trials` is an owning copy of the
/// native trace, while `best_parameters` holds the selected candidate.
#[derive(Debug, Clone, PartialEq)]
pub struct FinetuneResult {
    pub estimator: Estimator,
    pub metric: Metric,
    pub best_score: f64,
    pub best_parameters: BTreeMap<String, f64>,
    pub timed_out: bool,
    pub requested_trials: i32,
    pub trials: Vec<TrialSnapshot>,
}

/// Inputs for [`finetune_estimator`]. The search space and validation plan are
/// borrowed for the duration of the native selection call only.
pub struct FinetuneRequest<'a> {
    pub estimator: Estimator,
    pub x: MatrixRef<'a>,
    pub y: MatrixRef<'a>,
    pub plan: &'a ValidationPlan,
    pub space: &'a SearchSpace,
    pub options: &'a OptimizerOptions,
    pub n_trials: i32,
}

/// Select native estimator hyperparameters by running the supplied validation
/// plan. This is deliberately **selection-only**: it returns the best
/// candidate and trace, but does not fit or return a final model on all rows.
///
/// The native C ABI owns every numerical operation. It accepts only the
/// generic regression routes documented by `n4m_finetune_estimator`; unsupported
/// estimators, pruners, metrics, conditional axes, and invalid parameter
/// schemas are returned as native errors. Use [`Model::fit`] explicitly for a
/// final full-data refit after choosing parameters.
pub fn finetune_estimator(
    ctx: &Context,
    request: FinetuneRequest<'_>,
) -> Result<FinetuneResult, Error> {
    if request.x.rows != request.y.rows {
        return Err(invalid("X and Y must have the same number of rows"));
    }
    if request.n_trials <= 0 {
        return Err(invalid("finetune trial count must be positive"));
    }
    let (x_raw, y_raw) = (request.x.raw(), request.y.raw());
    let raw_options = request.options.raw();
    let mut raw = ptr::null_mut();
    check(
        unsafe {
            n4m_finetune_estimator(
                ctx.ptr(),
                request.estimator as i32,
                &x_raw,
                &y_raw,
                request.plan.ptr(),
                request.space.ptr(),
                &raw_options,
                request.n_trials,
                &mut raw,
            )
        },
        Some(ctx.ptr()),
    )?;
    let raw = NonNull::new(raw).ok_or_else(|| error(255, Some(ctx.ptr())))?;
    struct Owner(NonNull<MethodResultRaw>);
    impl Drop for Owner {
        fn drop(&mut self) {
            unsafe { n4m_method_result_destroy(self.0.as_ptr()) }
        }
    }
    let owner = Owner(raw);
    let best_score = scalar(owner.0.as_ptr(), "best_score")?;
    if !best_score.is_finite() {
        return Err(corrupt("native finetune score is invalid"));
    }
    let metric = metric_from_scalar(scalar(owner.0.as_ptr(), "metric")?)?;
    let returned_estimator = estimator_from_scalar(scalar(owner.0.as_ptr(), "estimator")?)?;
    if returned_estimator != request.estimator {
        return Err(corrupt(
            "native finetune estimator does not match the request",
        ));
    }
    let timed_out = bool_from_scalar(scalar(owner.0.as_ptr(), "timed_out")?, "timed_out")?;
    let requested_trials = i32_from_scalar(
        scalar(owner.0.as_ptr(), "requested_trials")?,
        "requested_trials",
    )?;
    if requested_trials != request.n_trials {
        return Err(corrupt(
            "native finetune trial count does not match the request",
        ));
    }
    let mut best_parameters = BTreeMap::new();
    for name in request.space.parameter_names() {
        let value = scalar(owner.0.as_ptr(), &format!("best.{name}"))?;
        if !value.is_finite() {
            return Err(corrupt("native finetune parameter is invalid"));
        }
        best_parameters.insert(name.clone(), value);
    }
    Ok(FinetuneResult {
        estimator: request.estimator,
        metric,
        best_score,
        best_parameters,
        timed_out,
        requested_trials,
        trials: decode_trials(owner.0.as_ptr(), 0)?,
    })
}

pub struct Model {
    raw: NonNull<ModelRaw>,
    _thread_bound: PhantomData<*mut ()>,
}
impl Model {
    /// Fit using the real `n4m_model_fit` C ABI. `x` and `y` must have equal
    /// row counts; detailed solver validation remains native.
    pub fn fit(
        ctx: &Context,
        cfg: &Config,
        x: MatrixRef<'_>,
        y: MatrixRef<'_>,
    ) -> Result<Self, Error> {
        if x.rows != y.rows {
            return Err(invalid("X and Y must have the same number of rows"));
        }
        let (x_raw, y_raw) = (x.raw(), y.raw());
        let mut raw = ptr::null_mut();
        check(
            unsafe { n4m_model_fit(ctx.ptr(), cfg.ptr(), &x_raw, &y_raw, &mut raw) },
            Some(ctx.ptr()),
        )?;
        Ok(Self {
            raw: NonNull::new(raw).ok_or_else(|| error(255, Some(ctx.ptr())))?,
            _thread_bound: PhantomData,
        })
    }

    /// Fit native ridge regression, then retain it as a portable, exact affine
    /// N4MM predictor.
    ///
    /// `libn4m` performs the fit through its public Ridge ABI.  The temporary
    /// method-result contains copied coefficients/intercepts only; the model
    /// returned here is the ABI-defined `IMPORTED_LINEAR_PREDICTOR`, whose
    /// equation is exactly `intercept + X @ coefficients` and which can be
    /// exported/imported as N4MM for stateless prediction.
    pub fn fit_ridge(
        ctx: &Context,
        cfg: &Config,
        x: MatrixRef<'_>,
        y: MatrixRef<'_>,
        lambda: f64,
    ) -> Result<Self, Error> {
        if x.rows != y.rows {
            return Err(invalid("X and Y must have the same number of rows"));
        }
        if !lambda.is_finite() || lambda < 0.0 {
            return Err(invalid("ridge lambda must be finite and non-negative"));
        }
        let (x_raw, y_raw) = (x.raw(), y.raw());
        let mut raw = ptr::null_mut();
        check(
            unsafe {
                n4m_estimators_ridge_fit(ctx.ptr(), cfg.ptr(), &x_raw, &y_raw, &lambda, 1, &mut raw)
            },
            Some(ctx.ptr()),
        )?;
        let raw = NonNull::new(raw).ok_or_else(|| error(255, Some(ctx.ptr())))?;
        struct Owner(NonNull<MethodResultRaw>);
        impl Drop for Owner {
            fn drop(&mut self) {
                unsafe { n4m_method_result_destroy(self.0.as_ptr()) }
            }
        }
        let owner = Owner(raw);
        let (coefficients, coefficient_rows, coefficient_cols) =
            doubles(owner.0.as_ptr(), "coefficients")?;
        let (intercept, intercept_rows, intercept_cols) = doubles(owner.0.as_ptr(), "intercept")?;
        let n_features = usize::try_from(coefficient_rows)
            .map_err(|_| corrupt("native ridge coefficient rows are invalid"))?;
        let n_targets = usize::try_from(coefficient_cols)
            .map_err(|_| corrupt("native ridge coefficient columns are invalid"))?;
        if n_features != x.cols
            || n_targets != y.cols
            || intercept_rows != 1
            || usize::try_from(intercept_cols).ok() != Some(n_targets)
            || !coefficients
                .iter()
                .chain(&intercept)
                .all(|value| value.is_finite())
        {
            return Err(corrupt("native ridge result shape or values are invalid"));
        }
        Self::import_linear_predictor(
            ctx,
            x.rows,
            n_features,
            n_targets,
            &coefficients,
            &intercept,
        )
    }

    /// Import a previously attested affine predictor without retraining.
    ///
    /// This creates an N4MM whose prediction equation is exactly
    /// `intercept + X @ coefficients`, with coefficients in row-major
    /// `(n_features, n_targets)` order.  The native model is deliberately
    /// PREDICT-only: no PLS latent-score decomposition is claimed or exposed.
    pub fn import_linear_predictor(
        ctx: &Context,
        source_training_samples: usize,
        n_features: usize,
        n_targets: usize,
        coefficients: &[f64],
        intercept: &[f64],
    ) -> Result<Self, Error> {
        if n_features == 0 || n_targets == 0 {
            return Err(invalid("linear predictor dimensions must be non-zero"));
        }
        let expected = n_features
            .checked_mul(n_targets)
            .ok_or_else(|| invalid("linear predictor coefficient dimensions overflow"))?;
        if coefficients.len() != expected || intercept.len() != n_targets {
            return Err(invalid(
                "linear predictor coefficient or intercept shape is invalid",
            ));
        }
        if !coefficients
            .iter()
            .chain(intercept)
            .all(|value| value.is_finite())
        {
            return Err(invalid(
                "linear predictor coefficients and intercept must be finite",
            ));
        }
        let spec = LinearPredictorSpecRaw {
            source_training_samples: i64::try_from(source_training_samples)
                .map_err(|_| invalid("source training sample count exceeds C ABI range"))?,
            n_features: i32::try_from(n_features)
                .map_err(|_| invalid("linear predictor feature count exceeds C ABI range"))?,
            n_targets: i32::try_from(n_targets)
                .map_err(|_| invalid("linear predictor target count exceeds C ABI range"))?,
            coefficients: coefficients.as_ptr(),
            intercept: intercept.as_ptr(),
        };
        let mut raw = ptr::null_mut();
        check(
            unsafe { n4m_model_import_linear_predictor(ctx.ptr(), &spec, &mut raw) },
            Some(ctx.ptr()),
        )?;
        Ok(Self {
            raw: NonNull::new(raw).ok_or_else(|| error(255, Some(ctx.ptr())))?,
            _thread_bound: PhantomData,
        })
    }
    pub fn n_features(&self) -> Result<usize, Error> {
        let mut value = 0;
        check(
            unsafe { n4m_model_get_n_features(self.raw.as_ptr(), &mut value) },
            None,
        )?;
        usize::try_from(value).map_err(|_| corrupt("native model feature count is invalid"))
    }
    pub fn n_targets(&self) -> Result<usize, Error> {
        let mut value = 0;
        check(
            unsafe { n4m_model_get_n_targets(self.raw.as_ptr(), &mut value) },
            None,
        )?;
        usize::try_from(value).map_err(|_| corrupt("native model target count is invalid"))
    }
    pub fn n_components(&self) -> Result<usize, Error> {
        let mut value = 0;
        check(
            unsafe { n4m_model_get_n_components(self.raw.as_ptr(), &mut value) },
            None,
        )?;
        usize::try_from(value).map_err(|_| corrupt("native model component count is invalid"))
    }
    /// Predict into caller-owned row-major storage via `n4m_model_predict`.
    pub fn predict_into(
        &self,
        ctx: &Context,
        x: MatrixRef<'_>,
        out: &mut [f64],
    ) -> Result<(), Error> {
        let targets = self.n_targets()?;
        let cells = x
            .rows
            .checked_mul(targets)
            .ok_or_else(|| invalid("prediction dimensions overflow"))?;
        if out.len() != cells {
            return Err(invalid(
                "prediction output length does not match X rows and model targets",
            ));
        }
        let x_raw = x.raw();
        let mut out_raw = MatrixView {
            data: out.as_mut_ptr().cast(),
            rows: i64::try_from(x.rows)
                .map_err(|_| invalid("prediction rows exceed C ABI range"))?,
            cols: i64::try_from(targets)
                .map_err(|_| invalid("prediction cols exceed C ABI range"))?,
            row_stride: i64::try_from(targets)
                .map_err(|_| invalid("prediction stride exceeds C ABI range"))?,
            col_stride: 1,
            dtype: 1,
            reserved0: 0,
        };
        check(
            unsafe { n4m_model_predict(ctx.ptr(), self.raw.as_ptr(), &x_raw, &mut out_raw) },
            Some(ctx.ptr()),
        )
    }
    /// Predict through the core-allocated ABI, then copy and free with
    /// `n4m_array_free` before returning Rust-owned data.
    pub fn predict(&self, ctx: &Context, x: MatrixRef<'_>) -> Result<Matrix, Error> {
        let x_raw = x.raw();
        let mut raw = ptr::null_mut();
        check(
            unsafe { n4m_model_predict_alloc(ctx.ptr(), self.raw.as_ptr(), &x_raw, &mut raw) },
            Some(ctx.ptr()),
        )?;
        let raw = NonNull::new(raw).ok_or_else(|| error(255, Some(ctx.ptr())))?;
        struct Owner(NonNull<ArrayRaw>);
        impl Drop for Owner {
            fn drop(&mut self) {
                unsafe { n4m_array_free(self.0.as_ptr()) }
            }
        }
        let owner = Owner(raw);
        copy_f64_array(owner.0.as_ptr())
    }
    pub fn import_n4mm(ctx: &Context, bytes: &[u8]) -> Result<Self, Error> {
        preflight_n4mm(bytes)?;
        let mut raw = ptr::null_mut();
        check(
            unsafe {
                n4m_model_import_from_buffer(
                    ctx.ptr(),
                    bytes.as_ptr().cast(),
                    bytes.len(),
                    &mut raw,
                )
            },
            Some(ctx.ptr()),
        )?;
        Ok(Self {
            raw: NonNull::new(raw).ok_or_else(|| error(255, Some(ctx.ptr())))?,
            _thread_bound: PhantomData,
        })
    }
    pub fn export_n4mm(&self) -> Result<Vec<u8>, Error> {
        let mut len = 0;
        check(
            unsafe { n4m_model_export_size(self.raw.as_ptr(), &mut len) },
            None,
        )?;
        if len == 0 || len > MAX_N4MM_BYTES {
            return Err(corrupt(
                "native N4MM length is invalid or exceeds binding limit",
            ));
        }
        let mut out = vec![0; len];
        let mut written = 0;
        check(
            unsafe {
                n4m_model_export_to_buffer(
                    self.raw.as_ptr(),
                    out.as_mut_ptr().cast(),
                    out.len(),
                    &mut written,
                )
            },
            None,
        )?;
        if written > out.len() {
            return Err(corrupt("native N4MM wrote beyond its allocation"));
        }
        out.truncate(written);
        preflight_n4mm(&out)?;
        Ok(out)
    }
}
impl Drop for Model {
    fn drop(&mut self) {
        unsafe { n4m_model_destroy(self.raw.as_ptr()) }
    }
}

fn copy_f64_array(array: *const ArrayRaw) -> Result<Matrix, Error> {
    let mut view = MatrixView {
        data: ptr::null_mut(),
        rows: 0,
        cols: 0,
        row_stride: 0,
        col_stride: 0,
        dtype: 0,
        reserved0: 0,
    };
    check(unsafe { n4m_array_view(array, &mut view) }, None)?;
    if view.dtype != 1 || view.rows < 0 || view.cols < 0 || view.col_stride != 1 {
        return Err(corrupt("native f64 array view is invalid"));
    }
    let (rows, cols) = (
        usize::try_from(view.rows).map_err(|_| corrupt("native array rows are invalid"))?,
        usize::try_from(view.cols).map_err(|_| corrupt("native array cols are invalid"))?,
    );
    let cells = rows
        .checked_mul(cols)
        .ok_or_else(|| corrupt("native array dimensions overflow"))?;
    if cells == 0 {
        return Ok(Matrix {
            data: Vec::new(),
            rows,
            cols,
        });
    }
    if view.data.is_null() || view.row_stride < view.cols {
        return Err(corrupt("native f64 array storage is invalid"));
    }
    let stride =
        usize::try_from(view.row_stride).map_err(|_| corrupt("native array stride is invalid"))?;
    let last = rows
        .checked_sub(1)
        .and_then(|row| row.checked_mul(stride))
        .and_then(|offset| offset.checked_add(cols))
        .ok_or_else(|| corrupt("native array span overflows"))?;
    if last > MAX_ARRAY_ELEMENTS {
        return Err(corrupt("native f64 array exceeds binding copy limit"));
    }
    let source = unsafe { slice::from_raw_parts(view.data.cast::<f64>(), last) };
    let mut data = Vec::with_capacity(cells);
    for row in 0..rows {
        let start = row * stride;
        data.extend_from_slice(&source[start..start + cols]);
    }
    Ok(Matrix { data, rows, cols })
}

/// Operator kind in the only N4MM v2 pipeline schema currently supported.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(i32)]
pub enum SerializedPipelineOperatorKind {
    Snv = 4,
    SavitzkyGolaySmooth = 8,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u32)]
pub enum PipelineFingerprintAlgorithm {
    Fnv1a64V1 = PIPELINE_FINGERPRINT_FNV1A64_V1,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u32)]
pub enum PipelineSemanticProfile {
    Nirs4allSnvSavgolV1 = PIPELINE_SEMANTIC_PROFILE_NIRS4ALL_SNV_SAVGOL_V1,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(i32)]
pub enum SerializedSavitzkyGolayMode {
    Interp = 4,
}

/// Canonical finite binary64 value returned by native serialization inspection.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CanonicalF64(u64);

impl CanonicalF64 {
    pub fn value(self) -> f64 {
        f64::from_bits(self.0)
    }

    pub fn to_bits(self) -> u64 {
        self.0
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SerializedPipelineInfo {
    pub schema_version: u32,
    pub operator_count: u32,
    pub operators: [SerializedPipelineOperatorKind; 2],
    pub savgol_window: i32,
    pub savgol_poly_degree: i32,
    pub savgol_derivative: i32,
    pub semantic_profile: PipelineSemanticProfile,
    pub savgol_delta: CanonicalF64,
    pub raw_n_features: i32,
    pub model_n_features: i32,
    pub fingerprint_algorithm: PipelineFingerprintAlgorithm,
    pub fingerprint: u64,
    pub snv_axis: i32,
    pub snv_with_mean: bool,
    pub snv_with_std: bool,
    pub snv_ddof: i32,
    pub savgol_mode: SerializedSavitzkyGolayMode,
    pub savgol_cval: CanonicalF64,
}

/// Metadata derived by libn4m from a fully validated N4MM v1 or v2 payload.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SerializedModelInfo {
    pub schema_version: u32,
    pub format_version: u32,
    pub writer_abi: (u32, u32, u32),
    pub algorithm: i32,
    pub solver: i32,
    pub deflation: i32,
    pub training_samples: i64,
    pub n_features: i32,
    pub n_targets: i32,
    pub n_components: i32,
    pub capabilities: u64,
    pub pipeline: Option<SerializedPipelineInfo>,
}

impl SerializedModelInfo {
    /// Whether prediction applies the serialized native preprocessing pipeline.
    pub fn has_pipeline(&self) -> bool {
        self.pipeline.is_some()
    }
}

fn inspect_serialized_pipeline(
    bytes: &[u8],
    format: u32,
    n_features: i32,
    capabilities: u64,
) -> Result<Option<SerializedPipelineInfo>, Error> {
    let mut raw = SerializedPipelineInfoV1Raw::default();
    check(
        unsafe {
            n4m_serialization_inspect_pipeline_v1(
                bytes.as_ptr().cast(),
                bytes.len(),
                &mut raw,
                mem::size_of::<SerializedPipelineInfoV1Raw>(),
            )
        },
        None,
    )?;
    if raw.schema_version != SERIALIZED_PIPELINE_INFO_SCHEMA_V1
        || raw.struct_size as usize != mem::size_of::<SerializedPipelineInfoV1Raw>()
    {
        return Err(corrupt("native N4MM pipeline inspection result is invalid"));
    }

    let capability_present = capabilities & SERIALIZED_MODEL_CAPABILITY_PIPELINE != 0;
    if format == N4MM_FORMAT_VERSION_V1 {
        if raw.present != 0
            || capability_present
            || raw.operator_count != 0
            || raw.operators != [0, 0]
            || raw.savgol_window != 0
            || raw.savgol_poly_degree != 0
            || raw.savgol_derivative != 0
            || raw.semantic_profile != 0
            || raw.savgol_delta.to_bits() != 0
            || raw.raw_n_features != 0
            || raw.model_n_features != 0
            || raw.fingerprint_algorithm != PIPELINE_FINGERPRINT_NONE
            || raw.snv_axis != 0
            || raw.fingerprint != 0
            || raw.snv_with_mean != 0
            || raw.snv_with_std != 0
            || raw.snv_ddof != 0
            || raw.savgol_mode != 0
            || raw.savgol_cval.to_bits() != 0
        {
            return Err(corrupt("native N4MM v1 unexpectedly reports a pipeline"));
        }
        return Ok(None);
    }

    if raw.present != 1
        || !capability_present
        || raw.operator_count != 2
        || raw.operators != [4, 8]
        || raw.savgol_window < 3
        || raw.savgol_window > 501
        || raw.savgol_window % 2 != 1
        || raw.savgol_poly_degree < 0
        || raw.savgol_poly_degree >= raw.savgol_window
        || raw.savgol_derivative != 0
        || raw.semantic_profile != PIPELINE_SEMANTIC_PROFILE_NIRS4ALL_SNV_SAVGOL_V1
        || raw.savgol_delta.to_bits() != 1.0f64.to_bits()
        || raw.raw_n_features != n_features
        || raw.model_n_features != n_features
        || raw.fingerprint_algorithm != PIPELINE_FINGERPRINT_FNV1A64_V1
        || raw.snv_axis != 1
        || raw.snv_with_mean != 1
        || raw.snv_with_std != 1
        || raw.snv_ddof != 0
        || raw.savgol_mode != SerializedSavitzkyGolayMode::Interp as i32
        || raw.savgol_cval.to_bits() != 0.0f64.to_bits()
    {
        return Err(corrupt(
            "native N4MM v2 pipeline inspection result is invalid",
        ));
    }

    Ok(Some(SerializedPipelineInfo {
        schema_version: raw.schema_version,
        operator_count: raw.operator_count,
        operators: [
            SerializedPipelineOperatorKind::Snv,
            SerializedPipelineOperatorKind::SavitzkyGolaySmooth,
        ],
        savgol_window: raw.savgol_window,
        savgol_poly_degree: raw.savgol_poly_degree,
        savgol_derivative: raw.savgol_derivative,
        semantic_profile: PipelineSemanticProfile::Nirs4allSnvSavgolV1,
        savgol_delta: CanonicalF64(raw.savgol_delta.to_bits()),
        raw_n_features: raw.raw_n_features,
        model_n_features: raw.model_n_features,
        fingerprint_algorithm: PipelineFingerprintAlgorithm::Fnv1a64V1,
        fingerprint: raw.fingerprint,
        snv_axis: raw.snv_axis,
        snv_with_mean: true,
        snv_with_std: true,
        snv_ddof: raw.snv_ddof,
        savgol_mode: SerializedSavitzkyGolayMode::Interp,
        savgol_cval: CanonicalF64(raw.savgol_cval.to_bits()),
    }))
}

/// Validate and inspect a complete fitted-model payload without importing it.
///
/// Capability bits and the optional typed pipeline descriptor come exclusively
/// from the two native authoritative inspectors; this binding does not infer or
/// augment either from host-side metadata.
pub fn inspect_n4mm(bytes: &[u8]) -> Result<SerializedModelInfo, Error> {
    if bytes.len() < N4MM_HEADER_BYTES || bytes.len() > MAX_N4MM_BYTES {
        return Err(corrupt("N4MM length is invalid"));
    }
    if !bytes.starts_with(N4MM_MAGIC) {
        return Err(corrupt("N4MM magic is invalid"));
    }
    let (mut format, mut abi_major, mut abi_minor, mut abi_patch) = (0, 0, 0, 0);
    check(
        unsafe {
            n4m_serialization_inspect(
                bytes.as_ptr().cast(),
                bytes.len(),
                &mut format,
                &mut abi_major,
                &mut abi_minor,
                &mut abi_patch,
            )
        },
        None,
    )?;
    if format != N4MM_FORMAT_VERSION_V1 && format != N4MM_FORMAT_VERSION_V2 {
        return Err(Error {
            kind: ErrorKind::VersionIncompatible,
            status: VERSION_INCOMPATIBLE,
            message: format!("unsupported N4MM format {format}"),
        });
    }
    let mut raw = SerializedModelInfoV1Raw::default();
    check(
        unsafe { n4m_serialization_inspect_model_v1(bytes.as_ptr().cast(), bytes.len(), &mut raw) },
        None,
    )?;
    if raw.schema_version != SERIALIZED_MODEL_INFO_SCHEMA_V1
        || raw.format_version != format
        || (
            raw.writer_abi_major,
            raw.writer_abi_minor,
            raw.writer_abi_patch,
        ) != (abi_major, abi_minor, abi_patch)
        || raw.reserved0 != 0
    {
        return Err(corrupt("native N4MM inspection result is invalid"));
    }
    let pipeline = inspect_serialized_pipeline(bytes, format, raw.n_features, raw.capabilities)?;
    Ok(SerializedModelInfo {
        schema_version: raw.schema_version,
        format_version: raw.format_version,
        writer_abi: (
            raw.writer_abi_major,
            raw.writer_abi_minor,
            raw.writer_abi_patch,
        ),
        algorithm: raw.algorithm,
        solver: raw.solver,
        deflation: raw.deflation,
        training_samples: raw.training_samples,
        n_features: raw.n_features,
        n_targets: raw.n_targets,
        n_components: raw.n_components,
        capabilities: raw.capabilities,
        pipeline,
    })
}

fn preflight_n4mm(bytes: &[u8]) -> Result<(), Error> {
    inspect_n4mm(bytes).map(|_| ())
}
fn u32le(bytes: &[u8]) -> u32 {
    u32::from_le_bytes(bytes.try_into().expect("checked"))
}
fn u64le(bytes: &[u8]) -> u64 {
    u64::from_le_bytes(bytes.try_into().expect("checked"))
}
fn preflight_n4mopt(bytes: &[u8]) -> Result<(), Error> {
    if bytes.len() < N4MOPT_MIN_BYTES || bytes.len() > MAX_CHECKPOINT_BYTES {
        return Err(corrupt("N4MOPT length is invalid"));
    }
    if !bytes.starts_with(N4MOPT_MAGIC) {
        return Err(corrupt("N4MOPT magic is invalid"));
    }
    if u32le(&bytes[8..12]) != N4MOPT_FORMAT_VERSION {
        return Err(Error {
            kind: ErrorKind::VersionIncompatible,
            status: VERSION_INCOMPATIBLE,
            message: "unsupported N4MOPT format".into(),
        });
    }
    if usize::try_from(u32le(&bytes[12..16])).ok() != Some(N4MOPT_HEADER_BYTES)
        || u64le(&bytes[16..24]) != bytes.len() as u64
        || bytes.len() % 8 != 0
        || u64le(&bytes[24..32]) > (bytes.len() - N4MOPT_MIN_BYTES) as u64
    {
        return Err(corrupt("N4MOPT envelope is invalid"));
    }
    Ok(())
}

fn ckey(s: &str) -> CString {
    CString::new(s).expect("constant key")
}
fn scalar(r: *const MethodResultRaw, name: &str) -> Result<f64, Error> {
    let n = ckey(name);
    let mut v = 0.;
    check(
        unsafe { n4m_method_result_get_scalar(r, n.as_ptr(), &mut v) },
        None,
    )?;
    Ok(v)
}
fn ints(r: *const MethodResultRaw, name: &str) -> Result<Vec<i32>, Error> {
    let n = ckey(name);
    let (mut p, mut len) = (ptr::null(), 0);
    check(
        unsafe { n4m_method_result_get_int_vector(r, n.as_ptr(), &mut p, &mut len) },
        None,
    )?;
    if len < 0 || len as usize > MAX_TRACE_ELEMENTS || (len > 0 && p.is_null()) {
        return Err(corrupt("native int vector is invalid"));
    }
    if len == 0 {
        return Ok(Vec::new());
    }
    Ok(unsafe { slice::from_raw_parts(p, len as usize) }.to_vec())
}
fn int64s(r: *const MethodResultRaw, name: &str) -> Result<Vec<i64>, Error> {
    let n = ckey(name);
    let (mut p, mut len) = (ptr::null(), 0);
    check(
        unsafe { n4m_method_result_get_int64_vector(r, n.as_ptr(), &mut p, &mut len) },
        None,
    )?;
    if len < 0 || len as usize > MAX_TRACE_ELEMENTS || (len > 0 && p.is_null()) {
        return Err(corrupt("native int64 vector is invalid"));
    }
    if len == 0 {
        return Ok(Vec::new());
    }
    Ok(unsafe { slice::from_raw_parts(p, len as usize) }.to_vec())
}
fn doubles(r: *const MethodResultRaw, name: &str) -> Result<(Vec<f64>, i64, i64), Error> {
    let n = ckey(name);
    let (mut p, mut rows, mut cols) = (ptr::null(), 0, 0);
    check(
        unsafe { n4m_method_result_get_double_matrix(r, n.as_ptr(), &mut p, &mut rows, &mut cols) },
        None,
    )?;
    let len = usize::try_from(rows)
        .ok()
        .and_then(|x| usize::try_from(cols).ok().and_then(|y| x.checked_mul(y)))
        .ok_or_else(|| corrupt("native matrix shape is invalid"))?;
    if len > MAX_TRACE_ELEMENTS || (len > 0 && p.is_null()) {
        return Err(corrupt("native matrix data is null"));
    }
    if len == 0 {
        return Ok((Vec::new(), rows, cols));
    }
    Ok((
        unsafe { slice::from_raw_parts(p, len) }.to_vec(),
        rows,
        cols,
    ))
}
fn utf8_records(
    bytes: Vec<i32>,
    offsets: Vec<i64>,
    count: usize,
    what: &str,
) -> Result<Vec<String>, Error> {
    if offsets.len() != count + 1
        || offsets.first() != Some(&0)
        || offsets.last().and_then(|x| usize::try_from(*x).ok()) != Some(bytes.len())
        || offsets.windows(2).any(|x| x[0] > x[1])
    {
        return Err(corrupt(format!("{what} offsets are invalid")));
    }
    let raw: Result<Vec<u8>, _> = bytes
        .into_iter()
        .map(|x| u8::try_from(x).map_err(|_| corrupt(format!("{what} byte is invalid"))))
        .collect();
    let raw = raw?;
    offsets
        .windows(2)
        .map(|x| {
            let a = usize::try_from(x[0]).map_err(|_| corrupt("negative offset"))?;
            let b = usize::try_from(x[1]).map_err(|_| corrupt("negative offset"))?;
            String::from_utf8(raw[a..b].to_vec())
                .map_err(|_| corrupt(format!("{what} is not UTF-8")))
        })
        .collect()
}
fn decode_trials(r: *const MethodResultRaw, since: i64) -> Result<Vec<TrialSnapshot>, Error> {
    if scalar(r, "trace_format_version")? != 1.0 {
        return Err(corrupt("unsupported trial trace version"));
    }
    let events = scalar(r, "n_events")?;
    if !events.is_finite()
        || events < 0.
        || events.fract() != 0.
        || events > MAX_TRACE_ELEMENTS as f64
    {
        return Err(corrupt("event count is invalid"));
    }
    let ids = int64s(r, "trial_ids_i64")?;
    if ids.windows(2).any(|x| x[0] >= x[1]) || ids.iter().any(|x| *x < since) {
        return Err(corrupt("trial ids are invalid"));
    }
    let n = ids.len();
    let asks = int64s(r, "trial_ask_sequence")?;
    let terminals = int64s(r, "trial_terminal_sequence")?;
    let (scores, sr, sc) = doubles(r, "trial_scores")?;
    let (statuses, ar, ac) = doubles(r, "trial_status")?;
    let (rungs, rr, rc) = doubles(r, "trial_rung")?;
    let (durations, dr, dc) = doubles(r, "trial_duration")?;
    if asks.len() != n
        || terminals.len() != n
        || [(sr, sc), (ar, ac), (rr, rc), (dr, dc)]
            .iter()
            .any(|x| *x != (1, n as i64))
    {
        return Err(corrupt("trial lifecycle widths are invalid"));
    }
    let (values, vr, p) = doubles(r, "trial_param_values")?;
    if vr != n as i64 {
        return Err(corrupt("parameter rows are invalid"));
    }
    let p = usize::try_from(p).map_err(|_| corrupt("parameter width is invalid"))?;
    let cells = n
        .checked_mul(p)
        .ok_or_else(|| corrupt("parameter cells overflow"))?;
    let indices = ints(r, "trial_param_category_index")?;
    let active = ints(r, "trial_param_active")?;
    let names = utf8_records(
        ints(r, "trial_param_name_utf8")?,
        int64s(r, "trial_param_name_offsets")?,
        p,
        "parameter name",
    )?;
    let kinds = ints(r, "trial_param_kind")?;
    let types = ints(r, "trial_param_category_type")?;
    let integer = ints(r, "trial_param_integer")?;
    let labels = utf8_records(
        ints(r, "trial_param_label_utf8")?,
        int64s(r, "trial_param_label_offsets")?,
        cells,
        "parameter label",
    )?;
    if values.len() != cells
        || indices.len() != cells
        || active.len() != cells
        || kinds.len() != p
        || types.len() != p
        || integer.len() != p
    {
        return Err(corrupt("parameter metadata widths are invalid"));
    }
    if names.windows(2).any(|pair| pair[0] == pair[1])
        || names
            .iter()
            .collect::<std::collections::BTreeSet<_>>()
            .len()
            != names.len()
    {
        return Err(corrupt("parameter names are not unique"));
    }
    let offsets = int64s(r, "trial_intermediate_offsets")?;
    let seqs = int64s(r, "trial_intermediate_sequence")?;
    let steps = ints(r, "trial_intermediate_steps")?;
    let (iscores, ir, ic) = doubles(r, "trial_intermediate_scores")?;
    let prunes = ints(r, "trial_intermediate_should_prune")?;
    if offsets.len() != n + 1
        || offsets.first() != Some(&0)
        || offsets.last().and_then(|x| usize::try_from(*x).ok()) != Some(steps.len())
        || seqs.len() != steps.len()
        || iscores.len() != steps.len()
        || prunes.len() != steps.len()
        || (ir, ic) != (1, steps.len() as i64)
    {
        return Err(corrupt("intermediate streams are invalid"));
    }
    let codes = utf8_records(
        ints(r, "trial_error_code_utf8")?,
        int64s(r, "trial_error_code_offsets")?,
        n,
        "error code",
    )?;
    let messages = utf8_records(
        ints(r, "trial_error_message_utf8")?,
        int64s(r, "trial_error_message_offsets")?,
        n,
        "error message",
    )?;
    let retry = ints(r, "trial_error_retryable")?;
    if retry.len() != n {
        return Err(corrupt("error retryable width is invalid"));
    }
    let mut used = std::collections::BTreeSet::new();
    let mut out = Vec::with_capacity(n);
    for i in 0..n {
        let status = status_enum(statuses[i] as i32, TrialStatus::from_raw, "trial status")?;
        if !statuses[i].is_finite()
            || statuses[i].fract() != 0.
            || !rungs[i].is_finite()
            || rungs[i] < 0.
            || rungs[i].fract() != 0.
            || !durations[i].is_finite()
            || durations[i] < 0.
        {
            return Err(corrupt("trial lifecycle value is invalid"));
        }
        let mut parameters = BTreeMap::new();
        let mut parameter_order = Vec::with_capacity(p);
        for j in 0..p {
            let cell = i * p + j;
            let kind = status_enum(kinds[j], ParameterKind::from_raw, "parameter kind")?;
            let ty = if types[j] < 0 {
                None
            } else {
                Some(status_enum(
                    types[j],
                    CategoryType::from_raw,
                    "category type",
                )?)
            };
            let category = if indices[cell] < 0 {
                None
            } else {
                Some(indices[cell])
            };
            if !values[cell].is_finite()
                || active[cell] < 0
                || active[cell] > 1
                || integer[j] < 0
                || integer[j] > 1
                || ((kind == ParameterKind::Categorical || kind == ParameterKind::Ordinal)
                    != category.is_some())
                || ((kind == ParameterKind::Categorical) != ty.is_some())
                || (integer[j] != 0 && values[cell].fract() != 0.0)
                || (ty == Some(CategoryType::Bool) && values[cell] != 0.0 && values[cell] != 1.0)
            {
                return Err(corrupt("trial parameter value is invalid"));
            }
            parameter_order.push(names[j].clone());
            parameters.insert(
                names[j].clone(),
                TrialParameter {
                    value: values[cell],
                    kind,
                    category_index: category,
                    category_label: category.map(|_| labels[cell].clone()),
                    category_type: ty,
                    integer: integer[j] != 0,
                    active: active[cell] != 0,
                },
            );
        }
        let a = usize::try_from(offsets[i]).map_err(|_| corrupt("negative intermediate offset"))?;
        let b =
            usize::try_from(offsets[i + 1]).map_err(|_| corrupt("negative intermediate offset"))?;
        if a > b || b > steps.len() {
            return Err(corrupt("intermediate offsets are invalid"));
        }
        let mut mids = Vec::new();
        for k in a..b {
            if !iscores[k].is_finite()
                || prunes[k] < 0
                || prunes[k] > 1
                || (k > a && (steps[k - 1] >= steps[k] || seqs[k - 1] >= seqs[k]))
            {
                return Err(corrupt("intermediate value is invalid"));
            }
            mids.push(Intermediate {
                sequence: seqs[k],
                step: steps[k],
                score: iscores[k],
                should_prune: prunes[k] != 0,
            });
        }
        let terminal = (terminals[i] >= 0).then_some(terminals[i]);
        if asks[i] < 0
            || terminal.is_some_and(|x| x <= asks[i])
            || mids.first().is_some_and(|x| x.sequence <= asks[i])
            || terminal.is_some_and(|x| mids.last().is_some_and(|y| x <= y.sequence))
            || ((status == TrialStatus::Running) != terminal.is_none())
        {
            return Err(corrupt("trial event order is invalid"));
        }
        let error_value = if codes[i].is_empty() && messages[i].is_empty() {
            None
        } else if valid_error_code(&codes[i])
            && !messages[i].is_empty()
            && (retry[i] == 0 || retry[i] == 1)
        {
            Some(TrialError {
                code: codes[i].clone(),
                message: messages[i].clone(),
                retryable: retry[i] != 0,
            })
        } else {
            return Err(corrupt("trial error is invalid"));
        };
        if matches!(status, TrialStatus::Failed | TrialStatus::Cancelled) != error_value.is_some() {
            return Err(corrupt("trial error/status mismatch"));
        }
        let score = if scores[i].is_nan() {
            None
        } else if status == TrialStatus::Completed && scores[i].is_finite() {
            Some(scores[i])
        } else {
            return Err(corrupt("trial score/status mismatch"));
        };
        let pruned = mids
            .iter()
            .enumerate()
            .filter_map(|(index, item)| item.should_prune.then_some(index))
            .collect::<Vec<_>>();
        if !pruned.is_empty()
            && (status != TrialStatus::Pruned || pruned != [mids.len().saturating_sub(1)])
        {
            return Err(corrupt("trial prune/status mismatch"));
        }
        let mut trace = vec![asks[i]];
        trace.extend(mids.iter().map(|x| x.sequence));
        if let Some(x) = terminal {
            trace.push(x)
        };
        if trace.iter().any(|x| !used.insert(*x)) {
            return Err(corrupt("duplicate trace event"));
        }
        out.push(TrialSnapshot {
            id: ids[i],
            ask_sequence: asks[i],
            terminal_sequence: terminal,
            parameters,
            parameter_order,
            status,
            score,
            rung: rungs[i] as i32,
            duration: durations[i],
            intermediates: mids,
            error: error_value,
        });
    }
    if used.len() != events as usize {
        return Err(corrupt("event count mismatch"));
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use static_assertions::assert_not_impl_any;
    assert_not_impl_any!(Context: Send, Sync);
    assert_not_impl_any!(Config: Send, Sync);
    assert_not_impl_any!(Pipeline: Send, Sync);
    assert_not_impl_any!(SearchSpace: Send, Sync);
    assert_not_impl_any!(Optimizer: Send, Sync);
    fn optimizer(ctx: &Context, sampler: Sampler) -> Optimizer {
        let mut s = SearchSpace::new().unwrap();
        s.add_int("components", 1, 4, 1, false)
            .unwrap()
            .add_categorical(
                "mode",
                &[Category::Str("a".into()), Category::Str("b".into())],
            )
            .unwrap();
        Optimizer::new(
            ctx,
            &s,
            &OptimizerOptions {
                seed: 7,
                sampler,
                ..Default::default()
            },
        )
        .unwrap()
    }
    #[test]
    fn native_ask_tell_trace_and_checkpoint() {
        let ctx = Context::new().unwrap();
        let o = optimizer(&ctx, Sampler::Random);
        let a = o.ask().unwrap();
        let id = a.id().unwrap();
        assert_eq!(a.status().unwrap(), TrialStatus::Running);
        assert!(!o.tell_intermediate(id, 0, 3.).unwrap());
        o.tell(id, 2.).unwrap();
        let (best, score) = o.best().unwrap().unwrap();
        assert_eq!(best.id().unwrap(), id);
        assert_eq!(score, 2.);
        let trace = o.trials(0).unwrap();
        assert_eq!(trace.len(), 1);
        assert_eq!(trace[0].id, id);
        assert_eq!(trace[0].intermediates.len(), 1);
        let cp = o.save_n4mopt().unwrap();
        let resumed = Optimizer::load_n4mopt(&ctx, &cp).unwrap();
        assert_eq!(resumed.trials(0).unwrap()[0].status, TrialStatus::Completed);
    }
    #[test]
    fn malformed_checkpoint_fails_before_load() {
        let ctx = Context::new().unwrap();
        let e = Optimizer::load_n4mopt(&ctx, b"N4MOPT\r\n").unwrap_err();
        assert_eq!(e.kind, ErrorKind::CorruptBuffer)
    }
    #[test]
    fn native_errors_and_batch_zero_are_preserved() {
        let ctx = Context::new().unwrap();
        let o = optimizer(&ctx, Sampler::Random);
        assert!(o.ask_batch(0).unwrap().is_empty());
        assert!(matches!(
            o.ask_batch(-1),
            Err(AskBatchError::Error(Error {
                kind: ErrorKind::InvalidArgument,
                ..
            }))
        ));
        let a = o.ask().unwrap();
        let e = o.tell(a.id().unwrap(), f64::NAN).unwrap_err();
        assert_eq!(e.kind, ErrorKind::InvalidArgument)
    }
    #[test]
    fn population_batch_returns_the_native_committed_prefix() {
        let ctx = Context::new().unwrap();
        let o = optimizer(&ctx, Sampler::Ga);
        let trials = o.ask_batch(17).unwrap();
        assert_eq!(trials.len(), 16);
        assert!(trials.iter().enumerate().all(|(index, trial)| {
            trial.id() == Ok(index as i64) && trial.status() == Ok(TrialStatus::Running)
        }));
    }
    #[test]
    fn caller_and_core_allocated_model_prediction_are_native_and_round_trip() {
        let ctx = Context::new().unwrap();
        let mut cfg = Config::new().unwrap();
        cfg.set_n_components(1).unwrap();
        let x = [0.0, 1.0, 1.0, 0.0, 1.0, 2.0, 2.0, 1.0, 2.0, 3.0, 3.0, 2.0];
        let y = [1.0, 2.0, 3.0, 4.0, 5.0, 6.0];
        let x = MatrixRef::row_major(&x, 6, 2).unwrap();
        let y = MatrixRef::row_major(&y, 6, 1).unwrap();
        let model = Model::fit(&ctx, &cfg, x, y).unwrap();
        assert_eq!(model.n_features().unwrap(), 2);
        assert_eq!(model.n_targets().unwrap(), 1);
        assert_eq!(model.n_components().unwrap(), 1);
        let core = model.predict(&ctx, x).unwrap();
        let mut caller = vec![0.0; core.data.len()];
        model.predict_into(&ctx, x, &mut caller).unwrap();
        assert_eq!(core.data, caller);
        let bytes = model.export_n4mm().unwrap();
        let info = inspect_n4mm(&bytes).unwrap();
        assert_eq!(info.schema_version, SERIALIZED_MODEL_INFO_SCHEMA_V1);
        assert_eq!(info.format_version, N4MM_FORMAT_VERSION_V1);
        assert!(!info.has_pipeline());
        assert_eq!(info.pipeline, None);
        assert_eq!(info.writer_abi, (ABI_MAJOR, ABI_MINOR, 0));
        assert_eq!(info.algorithm, 0);
        assert_eq!(info.solver, 0);
        assert_eq!(info.deflation, 0);
        assert_eq!(info.training_samples, 6);
        assert_eq!(
            (info.n_features, info.n_targets, info.n_components),
            (2, 1, 1)
        );
        assert_eq!(
            info.capabilities,
            SERIALIZED_MODEL_CAPABILITY_PREDICT | SERIALIZED_MODEL_CAPABILITY_TRANSFORM
        );
        let mut flipped = bytes.clone();
        flipped[80] ^= 1;
        assert_eq!(
            inspect_n4mm(&flipped).unwrap_err().kind,
            ErrorKind::CorruptBuffer
        );
        let restored = Model::import_n4mm(&ctx, &bytes).unwrap();
        assert_eq!(restored.predict(&ctx, x).unwrap(), core);
    }
    #[cfg(all(feature = "linked", not(feature = "dynamic")))]
    #[test]
    fn pipeline_v2_descriptor_import_and_prediction_round_trip() {
        let ctx = Context::new().unwrap();
        let mut cfg = Config::new().unwrap();
        cfg.set_n_components(1).unwrap();

        let mut pipeline = ptr::null_mut();
        check(unsafe { n4m_pipeline_create(&mut pipeline) }, None).unwrap();
        assert!(!pipeline.is_null());
        check(
            unsafe { n4m_pipeline_add_operator(pipeline, 4, ptr::null(), 0) },
            None,
        )
        .unwrap();
        let savgol = [5.0, 2.0];
        check(
            unsafe { n4m_pipeline_add_operator(pipeline, 8, savgol.as_ptr(), savgol.len() as i32) },
            None,
        )
        .unwrap();
        check(
            unsafe { n4m_config_set_pipeline(cfg.ptr(), pipeline) },
            None,
        )
        .unwrap();

        let mut values = Vec::new();
        for row in 1..=10 {
            for col in 1..=9 {
                let r = row as f64;
                let c = col as f64;
                values.push(
                    0.11 * r * c + 0.07 * r * r / (c + 1.0) + 0.013 * c * c * c + 0.003 * r * c * c,
                );
            }
        }
        let targets = (1..=10)
            .map(|row| {
                let r = row as f64;
                0.4 * r + 0.09 * r * r
            })
            .collect::<Vec<_>>();
        let x = MatrixRef::row_major(&values, 10, 9).unwrap();
        let y = MatrixRef::row_major(&targets, 10, 1).unwrap();
        let model = Model::fit(&ctx, &cfg, x, y).unwrap();
        unsafe { n4m_pipeline_destroy(pipeline) };

        let expected = model.predict(&ctx, x).unwrap();
        let bytes = model.export_n4mm().unwrap();
        let info = inspect_n4mm(&bytes).unwrap();
        assert_eq!(info.format_version, N4MM_FORMAT_VERSION_V2);
        assert!(info.has_pipeline());
        assert_eq!(
            info.capabilities,
            SERIALIZED_MODEL_CAPABILITY_PREDICT
                | SERIALIZED_MODEL_CAPABILITY_TRANSFORM
                | SERIALIZED_MODEL_CAPABILITY_PIPELINE
        );
        let restored = Model::import_n4mm(&ctx, &bytes).unwrap();
        assert_eq!(restored.predict(&ctx, x).unwrap(), expected);

        let mut tampered = bytes;
        let tamper_index = tampered.len() - 16;
        tampered[tamper_index] ^= 1;
        assert_eq!(
            inspect_n4mm(&tampered).unwrap_err().kind,
            ErrorKind::CorruptBuffer
        );
    }
    #[cfg(all(feature = "linked", not(feature = "dynamic")))]
    #[test]
    fn safe_pipeline_fit_inspect_predict_and_invalid_params() {
        let ctx = Context::new().unwrap();
        let mut cfg = Config::new().unwrap();
        cfg.set_n_components(1).unwrap();
        cfg.set_snv_savgol_pipeline(7, 2).unwrap();
        cfg.set_pipeline(Pipeline::snv_savgol(5, 2).unwrap())
            .unwrap();
        for (window, poly_degree) in [(4, 2), (1, 0), (5, -1), (5, 5)] {
            assert_eq!(
                Pipeline::snv_savgol(window, poly_degree)
                    .err()
                    .expect("invalid pipeline parameters must be rejected")
                    .kind,
                ErrorKind::InvalidArgument
            );
        }

        let values = (0..90)
            .map(|index| {
                let row = (index / 9 + 1) as f64;
                let col = (index % 9 + 1) as f64;
                row * col + 0.03 * row * row + 0.007 * col * col * col
            })
            .collect::<Vec<_>>();
        let targets = (1..=10)
            .map(|row| (row * row + row) as f64)
            .collect::<Vec<_>>();
        let x = MatrixRef::row_major(&values, 10, 9).unwrap();
        let y = MatrixRef::row_major(&targets, 10, 1).unwrap();
        let model = Model::fit(&ctx, &cfg, x, y).unwrap();

        let mut bytes = model.export_n4mm().unwrap();
        let info = inspect_n4mm(&bytes).unwrap();
        let pipeline = info.pipeline.expect("v2 pipeline descriptor");
        assert_eq!(pipeline.schema_version, 1);
        assert_eq!(pipeline.operator_count, 2);
        assert_eq!(
            pipeline.operators,
            [
                SerializedPipelineOperatorKind::Snv,
                SerializedPipelineOperatorKind::SavitzkyGolaySmooth,
            ]
        );
        assert_eq!(
            (pipeline.savgol_window, pipeline.savgol_poly_degree),
            (5, 2)
        );
        assert_eq!(pipeline.savgol_derivative, 0);
        assert_eq!(
            pipeline.semantic_profile,
            PipelineSemanticProfile::Nirs4allSnvSavgolV1
        );
        assert_eq!(pipeline.savgol_delta.value(), 1.0);
        assert_eq!((pipeline.raw_n_features, pipeline.model_n_features), (9, 9));
        assert_eq!(
            pipeline.fingerprint_algorithm,
            PipelineFingerprintAlgorithm::Fnv1a64V1
        );
        assert_eq!(pipeline.snv_axis, 1);
        assert!(pipeline.snv_with_mean);
        assert!(pipeline.snv_with_std);
        assert_eq!(pipeline.snv_ddof, 0);
        assert_eq!(pipeline.savgol_mode, SerializedSavitzkyGolayMode::Interp);
        assert_eq!(pipeline.savgol_cval.to_bits(), 0.0f64.to_bits());
        assert_eq!(pipeline.fingerprint, 0x4ec5_84c6_e32e_3416);
        let predictions = model.predict(&ctx, x).unwrap();
        assert_eq!((predictions.rows, predictions.cols), (10, 1));
        assert!(predictions.data.iter().all(|value| value.is_finite()));

        let tamper_index = bytes.len() - 16;
        bytes[tamper_index] ^= 1;
        assert_eq!(
            inspect_n4mm(&bytes).unwrap_err().kind,
            ErrorKind::CorruptBuffer
        );
    }
    #[test]
    fn imported_linear_predictor_is_exact_predict_only_and_n4mm_round_trips() {
        let ctx = Context::new().unwrap();
        let coefficients = [2.0, 0.5, -1.0, 3.0];
        let intercept = [1.5, -2.0];
        let model =
            Model::import_linear_predictor(&ctx, 17, 2, 2, &coefficients, &intercept).unwrap();
        assert_eq!(model.n_components().unwrap(), 0);
        let x = [1.0, 4.0, -2.0, 3.0];
        let x = MatrixRef::row_major(&x, 2, 2).unwrap();
        let predictions = model.predict(&ctx, x).unwrap();
        assert_eq!(predictions.data, vec![-0.5, 10.5, -5.5, 6.0]);
        let n4mm = model.export_n4mm().unwrap();
        let info = inspect_n4mm(&n4mm).unwrap();
        assert_eq!(info.algorithm, 11);
        assert_eq!(info.training_samples, 17);
        assert_eq!(
            (info.n_features, info.n_targets, info.n_components),
            (2, 2, 0)
        );
        assert_eq!(
            info.capabilities,
            SERIALIZED_MODEL_CAPABILITY_PREDICT | SERIALIZED_MODEL_CAPABILITY_AFFINE
        );
        let restored = Model::import_n4mm(&ctx, &n4mm).unwrap();
        assert_eq!(restored.predict(&ctx, x).unwrap(), predictions);
    }
    #[test]
    fn native_ridge_fit_exports_a_portable_affine_n4mm() {
        let ctx = Context::new().unwrap();
        let cfg = Config::new().unwrap();
        let values = [
            0.0, 0.0, // y = 1
            1.0, 0.0, // y = 3
            0.0, 1.0, // y = -2
            1.0, 1.0, // y = 0
            2.0, 1.0, // y = 2
            1.0, 2.0, // y = -3
        ];
        let targets = [1.0, 3.0, -2.0, 0.0, 2.0, -3.0];
        let x = MatrixRef::row_major(&values, 6, 2).unwrap();
        let y = MatrixRef::row_major(&targets, 6, 1).unwrap();
        let model = Model::fit_ridge(&ctx, &cfg, x, y, 0.0).unwrap();
        assert_eq!(model.n_components().unwrap(), 0);
        let predicted = model.predict(&ctx, x).unwrap();
        assert!(predicted
            .data
            .iter()
            .zip(targets)
            .all(|(actual, expected)| (actual - expected).abs() <= 1e-10));
        let bytes = model.export_n4mm().unwrap();
        let restored = Model::import_n4mm(&ctx, &bytes).unwrap();
        assert_eq!(restored.predict(&ctx, x).unwrap(), predicted);
    }
    #[test]
    fn native_finetune_is_selection_only_and_returns_a_copied_trace() {
        let ctx = Context::new().unwrap();
        let x = [0.0, 0.0, 1.0, 0.5, 2.0, 1.0, 3.0, 1.5, 4.0, 2.0, 5.0, 2.5];
        let y = [0.0, 1.0, 2.0, 3.0, 4.0, 5.0];
        let x = MatrixRef::row_major(&x, 6, 2).unwrap();
        let y = MatrixRef::row_major(&y, 6, 1).unwrap();
        let mut plan = ValidationPlan::new().unwrap();
        plan.set_n_samples(6)
            .unwrap()
            .add_fold(&[0, 1, 2], &[3, 4, 5])
            .unwrap()
            .add_fold(&[3, 4, 5], &[0, 1, 2])
            .unwrap();
        let mut space = SearchSpace::new().unwrap();
        space.add_int("n_components", 1, 2, 1, false).unwrap();
        let options = OptimizerOptions {
            seed: 11,
            ..Default::default()
        };
        let result = finetune_estimator(
            &ctx,
            FinetuneRequest {
                estimator: Estimator::PlsRegression,
                x,
                y,
                plan: &plan,
                space: &space,
                options: &options,
                n_trials: 3,
            },
        )
        .unwrap();
        assert_eq!(plan.n_samples().unwrap(), 6);
        assert_eq!(plan.n_folds().unwrap(), 2);
        assert_eq!(result.estimator, Estimator::PlsRegression);
        assert_eq!(result.metric, Metric::Rmse);
        assert_eq!(result.requested_trials, 3);
        assert!(result.best_score.is_finite());
        let n_components = result.best_parameters["n_components"];
        assert!(n_components == 1.0 || n_components == 2.0);
        assert!(!result.trials.is_empty());
        // The API intentionally returns selection metadata only; callers opt
        // into a full-data fit themselves with Model::fit.
    }
    #[test]
    fn native_partial_ask_batch_retains_the_committed_trial() {
        let ctx = Context::new().unwrap();
        let mut space = SearchSpace::new().unwrap();
        space
            .add_categorical(
                "a",
                &[Category::Str("off".into()), Category::Str("on".into())],
            )
            .unwrap()
            .add_categorical(
                "b",
                &[Category::Str("off".into()), Category::Str("on".into())],
            )
            .unwrap()
            .add_constraint(
                ConstraintKind::Exclude,
                &["a", "b"],
                &[Some("on"), Some("on")],
            )
            .unwrap();
        let o = Optimizer::new(
            &ctx,
            &space,
            &OptimizerOptions {
                seed: 3,
                ..Default::default()
            },
        )
        .unwrap();
        o.enqueue(&[("a", 0.0), ("b", 0.0)]).unwrap();
        o.enqueue(&[("a", 1.0), ("b", 1.0)]).unwrap();
        match o.ask_batch(4) {
            Err(AskBatchError::Partial { error, trials }) => {
                assert_eq!(error.kind, ErrorKind::InvalidArgument);
                assert_eq!(trials.len(), 1);
                assert_eq!(trials[0].id().unwrap(), 0);
                assert_eq!(trials[0].status().unwrap(), TrialStatus::Running);
                o.tell(trials[0].id().unwrap(), 0.0).unwrap();
            }
            other => panic!("expected native partial batch, got {other:?}"),
        }
    }
    #[test]
    fn snapshots_preserve_native_order_typed_axes_constraints_and_lifetime() {
        let ctx = Context::new().unwrap();
        let snapshots = {
            let mut space = SearchSpace::new().unwrap();
            space
                .add_int("integer", 1, 3, 1, false)
                .unwrap()
                .add_categorical(
                    "mode",
                    &[Category::Str("off".into()), Category::Str("on".into())],
                )
                .unwrap()
                .add_ordinal("ordinal", &[0.25, 0.75])
                .unwrap()
                .add_sorted_tuple("knots", 2, 0.0, 4.0, true)
                .unwrap()
                .add_int("child", 1, 2, 1, false)
                .unwrap()
                .add_constraint(
                    ConstraintKind::ConditionIn,
                    &["child", "mode"],
                    &[None, Some("on")],
                )
                .unwrap();
            let o = Optimizer::new(
                &ctx,
                &space,
                &OptimizerOptions {
                    seed: 49,
                    ..Default::default()
                },
            )
            .unwrap();
            for _ in 0..24 {
                let trial = o.ask().unwrap();
                o.tell(trial.id().unwrap(), 0.0).unwrap();
            }
            let all = o.trials(0).unwrap();
            let since = o.trials(7).unwrap();
            assert_eq!(
                since.iter().map(|x| x.id).collect::<Vec<_>>(),
                (7..24).collect::<Vec<_>>()
            );
            all
        };
        assert_eq!(snapshots.len(), 24);
        let first = &snapshots[0];
        assert_eq!(
            first.parameter_order,
            ["integer", "mode", "ordinal", "knots#0", "knots#1", "child"]
        );
        assert_eq!(first.parameters["mode"].kind, ParameterKind::Categorical);
        assert_eq!(first.parameters["ordinal"].kind, ParameterKind::Ordinal);
        assert_eq!(first.parameters["knots#0"].kind, ParameterKind::SortedTuple);
        assert!(first.parameters["knots#0"].integer);
        assert!(snapshots.iter().any(|x| x.parameters["child"].active));
        assert!(snapshots.iter().any(|x| !x.parameters["child"].active));
    }
    #[test]
    fn terminal_statuses_pruning_and_checkpoint_continuation_are_native() {
        let ctx = Context::new().unwrap();
        let mut space = SearchSpace::new().unwrap();
        space.add_int("k", 1, 10, 1, false).unwrap();
        let o = Optimizer::new(
            &ctx,
            &space,
            &OptimizerOptions {
                pruner: Pruner::Median,
                direction: Direction::Minimize,
                n_startup_trials: 2,
                seed: 51,
                ..Default::default()
            },
        )
        .unwrap();
        let failed = o.ask().unwrap().id().unwrap();
        o.tell_result(
            failed,
            TrialStatus::Failed,
            0.0,
            Some(&TrialError {
                code: "EVAL_ERROR".into(),
                message: "fixture failure".into(),
                retryable: false,
            }),
        )
        .unwrap();
        let cancelled = o.ask().unwrap().id().unwrap();
        o.tell_result(
            cancelled,
            TrialStatus::Cancelled,
            0.0,
            Some(&TrialError {
                code: "BUDGET_CANCELLED".into(),
                message: "budget exhausted".into(),
                retryable: true,
            }),
        )
        .unwrap();
        let a = o.ask().unwrap().id().unwrap();
        let b = o.ask().unwrap().id().unwrap();
        let c = o.ask().unwrap().id().unwrap();
        assert!(!o.tell_intermediate(a, 0, 1.0).unwrap());
        assert!(!o.tell_intermediate(b, 0, 2.0).unwrap());
        assert!(o.tell_intermediate(c, 0, 9.0).unwrap());
        let records = o.trials(0).unwrap();
        assert_eq!(records[0].status, TrialStatus::Failed);
        assert_eq!(records[1].status, TrialStatus::Cancelled);
        assert_eq!(records[4].status, TrialStatus::Pruned);
        let checkpoint = o.save_n4mopt().unwrap();
        let restored = Optimizer::load_n4mopt(&ctx, &checkpoint).unwrap();
        for _ in 0..4 {
            let left = o.ask().unwrap();
            let right = restored.ask().unwrap();
            assert_eq!(left.id().unwrap(), right.id().unwrap());
            assert_eq!(left.int("k").unwrap(), right.int("k").unwrap());
        }
    }
}
