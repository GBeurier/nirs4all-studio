//! Runtime loader for the official `libn4m` C ABI.
//!
//! This module exists for packaged consumers: they must select an exact native
//! library explicitly instead of inheriting a development linker search path.
//! The safe API in the parent module remains the single Rust surface.

use super::*;
use libloading::Library;
use std::{
    env, fs,
    path::{Path, PathBuf},
    sync::OnceLock,
};

const RUNTIME_UNAVAILABLE: i32 = 12;
static UNCONFIGURED_STATUS: &[u8] = b"libn4m dynamic runtime is not configured\0";

macro_rules! n4m_symbols {
    ($macro:ident) => {
        $macro! {
            n4m_check_abi_compatibility(major: u32, minor: u32) -> i32 => RUNTIME_UNAVAILABLE;
            n4m_status_to_string(status: i32) -> *const c_char => UNCONFIGURED_STATUS.as_ptr().cast();
            n4m_context_create(out: *mut *mut ContextRaw) -> i32 => RUNTIME_UNAVAILABLE;
            n4m_context_destroy(ctx: *mut ContextRaw) -> () => ();
            n4m_context_last_error(ctx: *const ContextRaw) -> *const c_char => std::ptr::null();
            n4m_config_create(out: *mut *mut ConfigRaw) -> i32 => RUNTIME_UNAVAILABLE;
            n4m_config_destroy(cfg: *mut ConfigRaw) -> () => ();
            n4m_config_set_n_components(cfg: *mut ConfigRaw, n: i32) -> i32 => RUNTIME_UNAVAILABLE;
            n4m_config_set_center_x(cfg: *mut ConfigRaw, enabled: i32) -> i32 => RUNTIME_UNAVAILABLE;
            n4m_config_set_scale_x(cfg: *mut ConfigRaw, enabled: i32) -> i32 => RUNTIME_UNAVAILABLE;
            n4m_config_set_center_y(cfg: *mut ConfigRaw, enabled: i32) -> i32 => RUNTIME_UNAVAILABLE;
            n4m_config_set_scale_y(cfg: *mut ConfigRaw, enabled: i32) -> i32 => RUNTIME_UNAVAILABLE;
            n4m_config_set_store_scores(cfg: *mut ConfigRaw, enabled: i32) -> i32 => RUNTIME_UNAVAILABLE;
            n4m_pipeline_create(out: *mut *mut PipelineRaw) -> i32 => RUNTIME_UNAVAILABLE;
            n4m_pipeline_destroy(pipeline: *mut PipelineRaw) -> () => ();
            n4m_pipeline_add_operator(pipeline: *mut PipelineRaw, kind: i32, params: *const f64, n_params: i32) -> i32 => RUNTIME_UNAVAILABLE;
            n4m_config_set_pipeline(cfg: *mut ConfigRaw, pipeline: *const PipelineRaw) -> i32 => RUNTIME_UNAVAILABLE;
            n4m_model_fit(ctx: *mut ContextRaw, cfg: *const ConfigRaw, x: *const MatrixView, y: *const MatrixView, out: *mut *mut ModelRaw) -> i32 => RUNTIME_UNAVAILABLE;
            n4m_model_import_linear_predictor(ctx: *mut ContextRaw, spec: *const LinearPredictorSpecRaw, out: *mut *mut ModelRaw) -> i32 => RUNTIME_UNAVAILABLE;
            n4m_model_destroy(model: *mut ModelRaw) -> () => ();
            n4m_model_predict(ctx: *mut ContextRaw, model: *const ModelRaw, x: *const MatrixView, out: *mut MatrixView) -> i32 => RUNTIME_UNAVAILABLE;
            n4m_model_predict_alloc(ctx: *mut ContextRaw, model: *const ModelRaw, x: *const MatrixView, out: *mut *mut ArrayRaw) -> i32 => RUNTIME_UNAVAILABLE;
            n4m_model_get_n_components(model: *const ModelRaw, out: *mut i32) -> i32 => RUNTIME_UNAVAILABLE;
            n4m_model_get_n_features(model: *const ModelRaw, out: *mut i32) -> i32 => RUNTIME_UNAVAILABLE;
            n4m_model_get_n_targets(model: *const ModelRaw, out: *mut i32) -> i32 => RUNTIME_UNAVAILABLE;
            n4m_model_export_size(model: *const ModelRaw, out: *mut usize) -> i32 => RUNTIME_UNAVAILABLE;
            n4m_model_export_to_buffer(model: *const ModelRaw, buffer: *mut c_void, len: usize, written: *mut usize) -> i32 => RUNTIME_UNAVAILABLE;
            n4m_model_import_from_buffer(ctx: *mut ContextRaw, buffer: *const c_void, len: usize, out: *mut *mut ModelRaw) -> i32 => RUNTIME_UNAVAILABLE;
            n4m_validation_plan_create(out: *mut *mut ValidationPlanRaw) -> i32 => RUNTIME_UNAVAILABLE;
            n4m_validation_plan_destroy(plan: *mut ValidationPlanRaw) -> () => ();
            n4m_validation_plan_set_n_samples(plan: *mut ValidationPlanRaw, n_samples: i64) -> i32 => RUNTIME_UNAVAILABLE;
            n4m_validation_plan_add_fold(plan: *mut ValidationPlanRaw, train_indices: *const i64, n_train: i64, test_indices: *const i64, n_test: i64) -> i32 => RUNTIME_UNAVAILABLE;
            n4m_validation_plan_get_n_samples(plan: *const ValidationPlanRaw, out_n_samples: *mut i64) -> i32 => RUNTIME_UNAVAILABLE;
            n4m_validation_plan_get_n_folds(plan: *const ValidationPlanRaw, out_n_folds: *mut i32) -> i32 => RUNTIME_UNAVAILABLE;
            n4m_serialization_inspect(buffer: *const c_void, len: usize, out_version: *mut u32, out_major: *mut u32, out_minor: *mut u32, out_patch: *mut u32) -> i32 => RUNTIME_UNAVAILABLE;
            n4m_serialization_inspect_model_v1(buffer: *const c_void, len: usize, out_info: *mut SerializedModelInfoV1Raw) -> i32 => RUNTIME_UNAVAILABLE;
            n4m_serialization_inspect_pipeline_v1(buffer: *const c_void, len: usize, out_info: *mut SerializedPipelineInfoV1Raw, out_info_size: usize) -> i32 => RUNTIME_UNAVAILABLE;
            n4m_search_space_create(out: *mut *mut SearchSpaceRaw) -> i32 => RUNTIME_UNAVAILABLE;
            n4m_search_space_destroy(space: *mut SearchSpaceRaw) -> () => ();
            n4m_search_space_add_int(space: *mut SearchSpaceRaw, name: *const c_char, low: i64, high: i64, step: i64, log: i32) -> i32 => RUNTIME_UNAVAILABLE;
            n4m_search_space_add_float(space: *mut SearchSpaceRaw, name: *const c_char, low: f64, high: f64, step: f64, log: i32) -> i32 => RUNTIME_UNAVAILABLE;
            n4m_search_space_add_categorical(space: *mut SearchSpaceRaw, name: *const c_char, kind: i32, values: *const c_void, n: i32) -> i32 => RUNTIME_UNAVAILABLE;
            n4m_search_space_add_ordinal(space: *mut SearchSpaceRaw, name: *const c_char, values: *const f64, n: i32) -> i32 => RUNTIME_UNAVAILABLE;
            n4m_search_space_add_sorted_tuple(space: *mut SearchSpaceRaw, name: *const c_char, length: i32, low: f64, high: f64, integer: i32) -> i32 => RUNTIME_UNAVAILABLE;
            n4m_search_space_add_constraint(space: *mut SearchSpaceRaw, kind: i32, params: *const *const c_char, labels: *const *const c_char, n: i32) -> i32 => RUNTIME_UNAVAILABLE;
            n4m_search_space_num_params(space: *const SearchSpaceRaw, out: *mut i32) -> i32 => RUNTIME_UNAVAILABLE;
            n4m_optimizer_options_init(opts: *mut OptimizerOptionsRaw) -> () => ();
            n4m_optimizer_create(ctx: *mut ContextRaw, space: *const SearchSpaceRaw, opts: *const OptimizerOptionsRaw, out: *mut *mut OptimizerRaw) -> i32 => RUNTIME_UNAVAILABLE;
            n4m_optimizer_destroy(opt: *mut OptimizerRaw) -> () => ();
            n4m_optimizer_enqueue(opt: *mut OptimizerRaw, names: *const *const c_char, values: *const f64, n: i32) -> i32 => RUNTIME_UNAVAILABLE;
            n4m_optimizer_ask(opt: *mut OptimizerRaw, out: *mut *mut TrialRaw) -> i32 => RUNTIME_UNAVAILABLE;
            n4m_optimizer_ask_batch(opt: *mut OptimizerRaw, n: i32, out: *mut *mut TrialRaw, count: *mut i32) -> i32 => RUNTIME_UNAVAILABLE;
            n4m_optimizer_tell(opt: *mut OptimizerRaw, id: i64, score: f64) -> i32 => RUNTIME_UNAVAILABLE;
            n4m_optimizer_tell_result(opt: *mut OptimizerRaw, id: i64, status: i32, score: f64, error: *const c_char) -> i32 => RUNTIME_UNAVAILABLE;
            n4m_optimizer_tell_intermediate(opt: *mut OptimizerRaw, id: i64, step: i32, score: f64, prune: *mut i32) -> i32 => RUNTIME_UNAVAILABLE;
            n4m_optimizer_best(opt: *const OptimizerRaw, trial: *mut *mut TrialRaw, score: *mut f64) -> i32 => RUNTIME_UNAVAILABLE;
            n4m_optimizer_get_trials(opt: *const OptimizerRaw, since: i64, out: *mut *mut MethodResultRaw) -> i32 => RUNTIME_UNAVAILABLE;
            n4m_optimizer_save(opt: *const OptimizerRaw, out: *mut *mut ArrayRaw) -> i32 => RUNTIME_UNAVAILABLE;
            n4m_optimizer_load(ctx: *mut ContextRaw, bytes: *const u8, len: u64, out: *mut *mut OptimizerRaw) -> i32 => RUNTIME_UNAVAILABLE;
            n4m_trial_get_id(trial: *const TrialRaw, out: *mut i64) -> i32 => RUNTIME_UNAVAILABLE;
            n4m_trial_get_int(trial: *const TrialRaw, name: *const c_char, out: *mut i64) -> i32 => RUNTIME_UNAVAILABLE;
            n4m_trial_get_float(trial: *const TrialRaw, name: *const c_char, out: *mut f64) -> i32 => RUNTIME_UNAVAILABLE;
            n4m_trial_get_category(trial: *const TrialRaw, name: *const c_char, index: *mut i32, label: *mut *const c_char) -> i32 => RUNTIME_UNAVAILABLE;
            n4m_trial_is_active(trial: *const TrialRaw, name: *const c_char, out: *mut i32) -> i32 => RUNTIME_UNAVAILABLE;
            n4m_trial_get_rung(trial: *const TrialRaw, out: *mut i32) -> i32 => RUNTIME_UNAVAILABLE;
            n4m_trial_get_status(trial: *const TrialRaw, out: *mut i32) -> i32 => RUNTIME_UNAVAILABLE;
            n4m_trial_get_duration(trial: *const TrialRaw, out: *mut f64) -> i32 => RUNTIME_UNAVAILABLE;
            n4m_array_view(array: *const ArrayRaw, out: *mut MatrixView) -> i32 => RUNTIME_UNAVAILABLE;
            n4m_array_free(array: *mut ArrayRaw) -> () => ();
            n4m_method_result_destroy(result: *mut MethodResultRaw) -> () => ();
            n4m_method_result_get_double_matrix(result: *const MethodResultRaw, name: *const c_char, data: *mut *const f64, rows: *mut i64, cols: *mut i64) -> i32 => RUNTIME_UNAVAILABLE;
            n4m_method_result_get_int_vector(result: *const MethodResultRaw, name: *const c_char, data: *mut *const i32, size: *mut i32) -> i32 => RUNTIME_UNAVAILABLE;
            n4m_method_result_get_int64_vector(result: *const MethodResultRaw, name: *const c_char, data: *mut *const i64, size: *mut i64) -> i32 => RUNTIME_UNAVAILABLE;
            n4m_method_result_get_scalar(result: *const MethodResultRaw, name: *const c_char, value: *mut f64) -> i32 => RUNTIME_UNAVAILABLE;
            n4m_estimators_ridge_fit(ctx: *mut ContextRaw, cfg: *const ConfigRaw, x: *const MatrixView, y: *const MatrixView, lambdas: *const f64, n_lambdas: i64, out_result: *mut *mut MethodResultRaw) -> i32 => RUNTIME_UNAVAILABLE;
            n4m_finetune_estimator(ctx: *mut ContextRaw, estimator: i32, x: *const MatrixView, y: *const MatrixView, plan: *const ValidationPlanRaw, space: *const SearchSpaceRaw, opts: *const OptimizerOptionsRaw, n_trials: i32, out_result: *mut *mut MethodResultRaw) -> i32 => RUNTIME_UNAVAILABLE;
        }
    };
}

macro_rules! define_api {
    ($( $name:ident($($arg:ident: $arg_ty:ty),*) -> $ret:ty => $fallback:expr; )*) => {
        struct NativeApi {
            path: PathBuf,
            _library: Library,
            $( $name: unsafe extern "C" fn($($arg_ty),*) -> $ret, )*
        }

        impl NativeApi {
            unsafe fn load(path: PathBuf) -> Result<Self, Error> {
                let library = unsafe { Library::new(&path) }
                    .map_err(|error| runtime_error(format!("could not open libn4m at {}: {error}", path.display())))?;
                Ok(Self {
                    path,
                    $( $name: *unsafe {
                        library.get::<unsafe extern "C" fn($($arg_ty),*) -> $ret>(
                            concat!(stringify!($name), "\0").as_bytes(),
                        )
                    }.map_err(|error| runtime_error(format!("libn4m is missing {}: {error}", stringify!($name))))?, )*
                    _library: library,
                })
            }
        }
    };
}
n4m_symbols!(define_api);

static NATIVE_API: OnceLock<NativeApi> = OnceLock::new();

fn runtime_error(message: impl Into<String>) -> Error {
    Error {
        kind: ErrorKind::AbiMismatch,
        status: RUNTIME_UNAVAILABLE,
        message: message.into(),
    }
}

fn canonical_library(path: impl AsRef<Path>) -> Result<PathBuf, Error> {
    let path = fs::canonicalize(path.as_ref())
        .map_err(|error| runtime_error(format!("libn4m path cannot be resolved: {error}")))?;
    if !path.is_file() {
        return Err(runtime_error(format!(
            "libn4m path must name a regular file, got {}",
            path.display()
        )));
    }
    Ok(path)
}

/// Select the exact `libn4m` shared-library file for this process.
///
/// This operation is intentionally one-shot: changing numerical/optimizer
/// implementations under live handles would invalidate the safe wrapper's
/// ownership guarantees.  A second call with the same canonical file is a
/// no-op; a different file is refused.
pub fn configure_library(path: impl AsRef<Path>) -> Result<(), Error> {
    let path = canonical_library(path)?;
    if let Some(api) = NATIVE_API.get() {
        return if api.path == path {
            Ok(())
        } else {
            Err(runtime_error(format!(
                "libn4m runtime is already configured from {}",
                api.path.display()
            )))
        };
    }
    let api = unsafe { NativeApi::load(path.clone()) }?;
    match NATIVE_API.set(api) {
        Ok(()) => Ok(()),
        Err(_) => {
            let configured = NATIVE_API.get().expect("OnceLock was initialized");
            if configured.path == path {
                Ok(())
            } else {
                Err(runtime_error(format!(
                    "libn4m runtime was configured concurrently from {}",
                    configured.path.display()
                )))
            }
        }
    }
}

pub(super) fn ensure_runtime() -> Result<(), Error> {
    if NATIVE_API.get().is_some() {
        return Ok(());
    }
    let path = env::var_os("N4M_LIBRARY_PATH").ok_or_else(|| {
        runtime_error(
            "libn4m dynamic runtime is not configured; call n4m::configure_library(path) or set N4M_LIBRARY_PATH",
        )
    })?;
    configure_library(PathBuf::from(path))
}

macro_rules! define_wrappers {
    ($( $name:ident($($arg:ident: $arg_ty:ty),*) -> $ret:ty => $fallback:expr; )*) => {
        $(
            #[allow(clippy::too_many_arguments)]
            pub(super) unsafe fn $name($($arg: $arg_ty),*) -> $ret {
                let Some(api) = NATIVE_API.get() else {
                    return $fallback;
                };
                unsafe { (api.$name)($($arg),*) }
            }
        )*
    };
}
n4m_symbols!(define_wrappers);
