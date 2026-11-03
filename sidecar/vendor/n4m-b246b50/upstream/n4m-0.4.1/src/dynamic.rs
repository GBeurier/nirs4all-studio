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
            n4m_get_abi_version_major() -> u32 => 0;
            n4m_get_abi_version_minor() -> u32 => 0;
            n4m_get_abi_version_patch() -> u32 => 0;
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
            n4m_method_result_get_n_folds(result: *const MethodResultRaw, out_n_folds: *mut i32) -> i32 => RUNTIME_UNAVAILABLE;
            n4m_method_result_get_fold(result: *const MethodResultRaw, fold: i32, out_train: *mut *const i64, out_n_train: *mut i64, out_test: *mut *const i64, out_n_test: *mut i64) -> i32 => RUNTIME_UNAVAILABLE;
            n4m_method_result_entry_count(result: *const MethodResultRaw, out_count: *mut i32) -> i32 => RUNTIME_UNAVAILABLE;
            n4m_method_result_entry(result: *const MethodResultRaw, index: i32, out_name: *mut *const c_char, out_kind: *mut i32) -> i32 => RUNTIME_UNAVAILABLE;
            n4m_method_count(out_count: *mut i32) -> i32 => RUNTIME_UNAVAILABLE;
            n4m_method_manifest_json(out: *mut c_char, capacity: usize, out_size: *mut usize) -> i32 => RUNTIME_UNAVAILABLE;
            n4m_method_find(method_id: *const c_char, out_index: *mut i32) -> i32 => RUNTIME_UNAVAILABLE;
            n4m_method_info_v1(index: i32, out: *mut MethodInfoV1Raw) -> i32 => RUNTIME_UNAVAILABLE;
            n4m_method_param_info_v1(index: i32, param: i32, out: *mut ParamInfoV1Raw) -> i32 => RUNTIME_UNAVAILABLE;
            n4m_method_param_default_int(index: i32, param: i32, out: *mut i64, capacity: i64, out_count: *mut i64) -> i32 => RUNTIME_UNAVAILABLE;
            n4m_method_param_default_double(index: i32, param: i32, out: *mut f64, capacity: i64, out_count: *mut i64) -> i32 => RUNTIME_UNAVAILABLE;
            n4m_params_create(ctx: *mut ContextRaw, method_index: i32, out: *mut *mut ParamsRaw) -> i32 => RUNTIME_UNAVAILABLE;
            n4m_params_destroy(params: *mut ParamsRaw) -> () => ();
            n4m_params_set_int(params: *mut ParamsRaw, name: *const c_char, value: i64) -> i32 => RUNTIME_UNAVAILABLE;
            n4m_params_set_double(params: *mut ParamsRaw, name: *const c_char, value: f64) -> i32 => RUNTIME_UNAVAILABLE;
            n4m_params_set_bool(params: *mut ParamsRaw, name: *const c_char, value: i32) -> i32 => RUNTIME_UNAVAILABLE;
            n4m_params_set_enum(params: *mut ParamsRaw, name: *const c_char, choice: *const c_char) -> i32 => RUNTIME_UNAVAILABLE;
            n4m_params_set_int_array(params: *mut ParamsRaw, name: *const c_char, values: *const i64, n: i64) -> i32 => RUNTIME_UNAVAILABLE;
            n4m_params_set_double_array(params: *mut ParamsRaw, name: *const c_char, values: *const f64, n: i64) -> i32 => RUNTIME_UNAVAILABLE;
            n4m_params_validate(ctx: *mut ContextRaw, params: *const ParamsRaw) -> i32 => RUNTIME_UNAVAILABLE;
            n4m_params_get_int(params: *const ParamsRaw, name: *const c_char, out: *mut i64, capacity: i64, out_count: *mut i64) -> i32 => RUNTIME_UNAVAILABLE;
            n4m_params_get_double(params: *const ParamsRaw, name: *const c_char, out: *mut f64, capacity: i64, out_count: *mut i64) -> i32 => RUNTIME_UNAVAILABLE;
            n4m_estimator_create(ctx: *mut ContextRaw, method_id: *const c_char, params: *const ParamsRaw, out: *mut *mut EstimatorRaw) -> i32 => RUNTIME_UNAVAILABLE;
            n4m_estimator_destroy(est: *mut EstimatorRaw) -> () => ();
            n4m_estimator_fit(ctx: *mut ContextRaw, est: *mut EstimatorRaw, inputs: *const FitInputsV1Raw) -> i32 => RUNTIME_UNAVAILABLE;
            n4m_estimator_is_fitted(est: *const EstimatorRaw, out: *mut i32) -> i32 => RUNTIME_UNAVAILABLE;
            n4m_estimator_contains_training_rows(est: *const EstimatorRaw, out: *mut i32) -> i32 => RUNTIME_UNAVAILABLE;
            n4m_estimator_info(est: *const EstimatorRaw, out_method_index: *mut i32, out_capabilities: *mut u64) -> i32 => RUNTIME_UNAVAILABLE;
            n4m_estimator_get_params(ctx: *mut ContextRaw, est: *const EstimatorRaw, out_copy: *mut *mut ParamsRaw) -> i32 => RUNTIME_UNAVAILABLE;
            n4m_estimator_n_features_in(est: *const EstimatorRaw, out: *mut i64) -> i32 => RUNTIME_UNAVAILABLE;
            n4m_estimator_transform_cols(est: *const EstimatorRaw, out: *mut i64) -> i32 => RUNTIME_UNAVAILABLE;
            n4m_estimator_n_outputs(est: *const EstimatorRaw, out: *mut i64) -> i32 => RUNTIME_UNAVAILABLE;
            n4m_estimator_transform(ctx: *mut ContextRaw, est: *const EstimatorRaw, x: *const MatrixView, out: *mut MatrixView) -> i32 => RUNTIME_UNAVAILABLE;
            n4m_estimator_predict(ctx: *mut ContextRaw, est: *const EstimatorRaw, x: *const MatrixView, out: *mut MatrixView) -> i32 => RUNTIME_UNAVAILABLE;
            n4m_estimator_decision_function(ctx: *mut ContextRaw, est: *const EstimatorRaw, x: *const MatrixView, out: *mut MatrixView) -> i32 => RUNTIME_UNAVAILABLE;
            n4m_estimator_predict_proba(ctx: *mut ContextRaw, est: *const EstimatorRaw, x: *const MatrixView, out: *mut MatrixView) -> i32 => RUNTIME_UNAVAILABLE;
            n4m_estimator_predict_labels(ctx: *mut ContextRaw, est: *const EstimatorRaw, x: *const MatrixView, out: *mut i64, n: i64) -> i32 => RUNTIME_UNAVAILABLE;
            n4m_estimator_classes(est: *const EstimatorRaw, out: *mut i64, capacity: i64, out_count: *mut i64) -> i32 => RUNTIME_UNAVAILABLE;
            n4m_estimator_selected_indices(est: *const EstimatorRaw, out: *mut i64, capacity: i64, out_count: *mut i64) -> i32 => RUNTIME_UNAVAILABLE;
            n4m_estimator_apply_mask(ctx: *mut ContextRaw, est: *const EstimatorRaw, x: *const MatrixView, y: *const MatrixView, mask: *mut u8, n: i64) -> i32 => RUNTIME_UNAVAILABLE;
            n4m_procedure_run(ctx: *mut ContextRaw, method_index: i32, params: *const ParamsRaw, inputs: *const FitInputsV1Raw, out: *mut *mut MethodResultRaw) -> i32 => RUNTIME_UNAVAILABLE;
            n4m_context_set_max_state_bytes(ctx: *mut ContextRaw, max_bytes: u64) -> i32 => RUNTIME_UNAVAILABLE;
            n4m_estimator_export_size(ctx: *mut ContextRaw, est: *const EstimatorRaw, flags: u32, out_size: *mut usize) -> i32 => RUNTIME_UNAVAILABLE;
            n4m_estimator_export_to_buffer(ctx: *mut ContextRaw, est: *const EstimatorRaw, flags: u32, buffer: *mut c_void, buffer_size: usize, out_written: *mut usize) -> i32 => RUNTIME_UNAVAILABLE;
            n4m_estimator_import_from_buffer(ctx: *mut ContextRaw, buffer: *const c_void, buffer_size: usize, out: *mut *mut EstimatorRaw) -> i32 => RUNTIME_UNAVAILABLE;
            n4m_role_pipeline_create(ctx: *mut ContextRaw, n_steps: i32, method_ids: *const *const c_char, params: *const *const ParamsRaw, out: *mut *mut RolePipelineRaw) -> i32 => RUNTIME_UNAVAILABLE;
            n4m_role_pipeline_destroy(pipeline: *mut RolePipelineRaw) -> () => ();
            n4m_role_pipeline_set_feature_names(ctx: *mut ContextRaw, pipeline: *mut RolePipelineRaw, names: *const *const c_char, n: i64) -> i32 => RUNTIME_UNAVAILABLE;
            n4m_role_pipeline_fit(ctx: *mut ContextRaw, pipeline: *mut RolePipelineRaw, inputs: *const FitInputsV1Raw) -> i32 => RUNTIME_UNAVAILABLE;
            n4m_role_pipeline_import_states(ctx: *mut ContextRaw, pipeline: *mut RolePipelineRaw, n_states: i32, states: *const *const c_void, state_sizes: *const usize) -> i32 => RUNTIME_UNAVAILABLE;
            n4m_role_pipeline_is_fitted(pipeline: *const RolePipelineRaw, out: *mut i32) -> i32 => RUNTIME_UNAVAILABLE;
            n4m_role_pipeline_n_steps(pipeline: *const RolePipelineRaw, out: *mut i32) -> i32 => RUNTIME_UNAVAILABLE;
            n4m_role_pipeline_n_states(pipeline: *const RolePipelineRaw, out: *mut i32) -> i32 => RUNTIME_UNAVAILABLE;
            n4m_role_pipeline_step_info_v1(pipeline: *const RolePipelineRaw, step: i32, out: *mut RolePipelineStepInfoV1Raw) -> i32 => RUNTIME_UNAVAILABLE;
            n4m_role_pipeline_n_features_in(pipeline: *const RolePipelineRaw, out: *mut i64) -> i32 => RUNTIME_UNAVAILABLE;
            n4m_role_pipeline_n_feature_names(pipeline: *const RolePipelineRaw, out: *mut i64) -> i32 => RUNTIME_UNAVAILABLE;
            n4m_role_pipeline_feature_name(pipeline: *const RolePipelineRaw, index: i64, out_borrowed: *mut *const c_char) -> i32 => RUNTIME_UNAVAILABLE;
            n4m_role_pipeline_check_features(ctx: *mut ContextRaw, pipeline: *const RolePipelineRaw, n_columns: i64, names: *const *const c_char) -> i32 => RUNTIME_UNAVAILABLE;
            n4m_role_pipeline_transform_cols(pipeline: *const RolePipelineRaw, out: *mut i64) -> i32 => RUNTIME_UNAVAILABLE;
            n4m_role_pipeline_n_outputs(pipeline: *const RolePipelineRaw, out: *mut i64) -> i32 => RUNTIME_UNAVAILABLE;
            n4m_role_pipeline_transform(ctx: *mut ContextRaw, pipeline: *const RolePipelineRaw, x: *const MatrixView, out: *mut MatrixView) -> i32 => RUNTIME_UNAVAILABLE;
            n4m_role_pipeline_predict(ctx: *mut ContextRaw, pipeline: *const RolePipelineRaw, x: *const MatrixView, out: *mut MatrixView) -> i32 => RUNTIME_UNAVAILABLE;
            n4m_role_pipeline_decision_function(ctx: *mut ContextRaw, pipeline: *const RolePipelineRaw, x: *const MatrixView, out: *mut MatrixView) -> i32 => RUNTIME_UNAVAILABLE;
            n4m_role_pipeline_predict_proba(ctx: *mut ContextRaw, pipeline: *const RolePipelineRaw, x: *const MatrixView, out: *mut MatrixView) -> i32 => RUNTIME_UNAVAILABLE;
            n4m_role_pipeline_predict_labels(ctx: *mut ContextRaw, pipeline: *const RolePipelineRaw, x: *const MatrixView, out: *mut i64, n: i64) -> i32 => RUNTIME_UNAVAILABLE;
            n4m_role_pipeline_classes(pipeline: *const RolePipelineRaw, out: *mut i64, capacity: i64, out_count: *mut i64) -> i32 => RUNTIME_UNAVAILABLE;
            n4m_role_pipeline_export_state_size(ctx: *mut ContextRaw, pipeline: *const RolePipelineRaw, state: i32, flags: u32, out_size: *mut usize) -> i32 => RUNTIME_UNAVAILABLE;
            n4m_role_pipeline_export_state_to_buffer(ctx: *mut ContextRaw, pipeline: *const RolePipelineRaw, state: i32, flags: u32, buffer: *mut c_void, buffer_size: usize, out_written: *mut usize) -> i32 => RUNTIME_UNAVAILABLE;
            n4m_multimodal_pipeline_create(ctx: *mut ContextRaw, recipe: *const multimodal::RecipeRaw, out: *mut *mut multimodal::PipelineRaw) -> i32 => RUNTIME_UNAVAILABLE;
            n4m_multimodal_pipeline_destroy(pipeline: *mut multimodal::PipelineRaw) -> () => ();
            n4m_multimodal_pipeline_fit(ctx: *mut ContextRaw, pipeline: *mut multimodal::PipelineRaw, n_sources: i32, sources: *const multimodal::SourceViewRaw, y: *const MatrixView) -> i32 => RUNTIME_UNAVAILABLE;
            n4m_multimodal_pipeline_predict(ctx: *mut ContextRaw, pipeline: *const multimodal::PipelineRaw, n_sources: i32, sources: *const multimodal::SourceViewRaw, out: *mut MatrixView) -> i32 => RUNTIME_UNAVAILABLE;
            n4m_multimodal_pipeline_transform_cols(pipeline: *const multimodal::PipelineRaw, out: *mut i64) -> i32 => RUNTIME_UNAVAILABLE;
            n4m_multimodal_pipeline_transform(ctx: *mut ContextRaw, pipeline: *const multimodal::PipelineRaw, n_sources: i32, sources: *const multimodal::SourceViewRaw, out: *mut MatrixView) -> i32 => RUNTIME_UNAVAILABLE;
            n4m_multimodal_pipeline_export_size(ctx: *mut ContextRaw, pipeline: *const multimodal::PipelineRaw, out: *mut usize) -> i32 => RUNTIME_UNAVAILABLE;
            n4m_multimodal_pipeline_export_to_buffer(ctx: *mut ContextRaw, pipeline: *const multimodal::PipelineRaw, buffer: *mut c_void, size: usize, written: *mut usize) -> i32 => RUNTIME_UNAVAILABLE;
            n4m_multimodal_pipeline_import_from_buffer(ctx: *mut ContextRaw, expected_recipe: *const multimodal::RecipeRaw, buffer: *const c_void, size: usize, out: *mut *mut multimodal::PipelineRaw) -> i32 => RUNTIME_UNAVAILABLE;
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
