#include <stdalign.h>
#include <stddef.h>

#include "n4m/n4m.h"
#include "n4m/optimization.h"

#ifndef N4M_RUST_ABI_MAJOR
#error "N4M_RUST_ABI_MAJOR must be provided by build.rs"
#endif

_Static_assert(N4M_ABI_VERSION_MAJOR == N4M_RUST_ABI_MAJOR,
               "Rust binding ABI major is stale relative to n4m_version.h");
_Static_assert(N4M_ABI_VERSION_MINOR == N4M_RUST_ABI_MINOR,
               "Rust binding ABI minor is stale relative to n4m_version.h");
_Static_assert(N4M_ABI_VERSION_PATCH == N4M_RUST_ABI_PATCH,
               "Rust binding ABI patch is stale relative to n4m_version.h");
_Static_assert(sizeof(n4m_matrix_view_t) == N4M_RUST_MATRIX_VIEW_SIZE,
               "Rust MatrixView size is stale relative to the C header");
_Static_assert(alignof(n4m_matrix_view_t) == N4M_RUST_MATRIX_VIEW_ALIGN,
               "Rust MatrixView alignment is stale relative to the C header");
_Static_assert(sizeof(n4m_optimizer_options_t) == N4M_RUST_OPTIMIZER_OPTIONS_SIZE,
               "Rust OptimizerOptions size is stale relative to the C header");

#define N4M_RUST_TYPE_IS(expression, expected_type) \
    _Generic((expression), expected_type: 1, default: 0)

_Static_assert(offsetof(n4m_matrix_view_t, data) == 0,
               "Rust MatrixView.data offset is stale relative to the C header");
_Static_assert(offsetof(n4m_matrix_view_t, rows) == 8,
               "Rust MatrixView.rows offset is stale relative to the C header");
_Static_assert(offsetof(n4m_matrix_view_t, cols) == 16,
               "Rust MatrixView.cols offset is stale relative to the C header");
_Static_assert(offsetof(n4m_matrix_view_t, row_stride) == 24,
               "Rust MatrixView.row_stride offset is stale relative to the C header");
_Static_assert(offsetof(n4m_matrix_view_t, col_stride) == 32,
               "Rust MatrixView.col_stride offset is stale relative to the C header");
_Static_assert(offsetof(n4m_matrix_view_t, dtype) == 40,
               "Rust MatrixView.dtype offset is stale relative to the C header");
_Static_assert(offsetof(n4m_matrix_view_t, reserved0) == 44,
               "Rust MatrixView.reserved0 offset is stale relative to the C header");
_Static_assert(N4M_RUST_TYPE_IS(((n4m_matrix_view_t*)0)->data, void*),
               "Rust MatrixView.data type is stale relative to the C header");
_Static_assert(N4M_RUST_TYPE_IS(((n4m_matrix_view_t*)0)->rows, int64_t),
               "Rust MatrixView.rows type is stale relative to the C header");
_Static_assert(N4M_RUST_TYPE_IS(((n4m_matrix_view_t*)0)->cols, int64_t),
               "Rust MatrixView.cols type is stale relative to the C header");
_Static_assert(N4M_RUST_TYPE_IS(((n4m_matrix_view_t*)0)->row_stride, int64_t),
               "Rust MatrixView.row_stride type is stale relative to the C header");
_Static_assert(N4M_RUST_TYPE_IS(((n4m_matrix_view_t*)0)->col_stride, int64_t),
               "Rust MatrixView.col_stride type is stale relative to the C header");
_Static_assert(N4M_RUST_TYPE_IS(((n4m_matrix_view_t*)0)->dtype, n4m_dtype_t),
               "Rust MatrixView.dtype type is stale relative to the C header");
_Static_assert(N4M_RUST_TYPE_IS(((n4m_matrix_view_t*)0)->reserved0, int32_t),
               "Rust MatrixView.reserved0 type is stale relative to the C header");

_Static_assert(offsetof(n4m_optimizer_options_t, struct_size) == 0,
               "Rust OptimizerOptions.struct_size offset is stale relative to the C header");
_Static_assert(offsetof(n4m_optimizer_options_t, sampler) == 8,
               "Rust OptimizerOptions.sampler offset is stale relative to the C header");
_Static_assert(offsetof(n4m_optimizer_options_t, seed) == 40,
               "Rust OptimizerOptions.seed offset is stale relative to the C header");
_Static_assert(offsetof(n4m_optimizer_options_t, reserved) == 64,
               "Rust OptimizerOptions.reserved offset is stale relative to the C header");

#define N4M_RUST_SIGNATURE_IS(function_name, expected_type) \
    _Generic(&(function_name), expected_type: 1, default: 0)

_Static_assert(N4M_RUST_SIGNATURE_IS(n4m_check_abi_compatibility,
                                     n4m_status_t (*)(uint32_t, uint32_t)),
               "n4m_check_abi_compatibility signature drifted");
_Static_assert(N4M_RUST_SIGNATURE_IS(n4m_status_to_string,
                                     const char* (*)(n4m_status_t)),
               "n4m_status_to_string signature drifted");
_Static_assert(N4M_RUST_SIGNATURE_IS(n4m_context_create,
                                     n4m_status_t (*)(n4m_context_t**)),
               "n4m_context_create signature drifted");
_Static_assert(N4M_RUST_SIGNATURE_IS(n4m_context_destroy, void (*)(n4m_context_t*)),
               "n4m_context_destroy signature drifted");
_Static_assert(N4M_RUST_SIGNATURE_IS(n4m_context_last_error,
                                     const char* (*)(const n4m_context_t*)),
               "n4m_context_last_error signature drifted");
_Static_assert(N4M_RUST_SIGNATURE_IS(n4m_model_export_size,
                                     n4m_status_t (*)(const n4m_model_t*, size_t*)),
               "n4m_model_export_size signature drifted");
_Static_assert(N4M_RUST_SIGNATURE_IS(n4m_model_destroy, void (*)(n4m_model_t*)),
               "n4m_model_destroy signature drifted");
_Static_assert(N4M_RUST_SIGNATURE_IS(n4m_model_export_to_buffer,
                                     n4m_status_t (*)(const n4m_model_t*, void*, size_t, size_t*)),
               "n4m_model_export_to_buffer signature drifted");
_Static_assert(N4M_RUST_SIGNATURE_IS(n4m_model_import_from_buffer,
                                     n4m_status_t (*)(n4m_context_t*, const void*, size_t, n4m_model_t**)),
               "n4m_model_import_from_buffer signature drifted");
_Static_assert(sizeof(n4m_linear_predictor_spec_t) == 32,
               "Rust LinearPredictorSpecRaw layout is stale relative to the C header");
_Static_assert(sizeof(n4m_serialized_model_info_v1_t) == 64,
               "Rust SerializedModelInfoV1Raw layout is stale relative to the C header");
_Static_assert(offsetof(n4m_serialized_model_info_v1_t, training_samples) == 32,
               "Rust SerializedModelInfoV1Raw.training_samples offset is stale");
_Static_assert(offsetof(n4m_serialized_model_info_v1_t, capabilities) == 56,
               "Rust SerializedModelInfoV1Raw.capabilities offset is stale");
_Static_assert(N4M_RUST_SIGNATURE_IS(n4m_model_import_linear_predictor,
                                     n4m_status_t (*)(n4m_context_t*,
                                                      const n4m_linear_predictor_spec_t*,
                                                      n4m_model_t**)),
               "n4m_model_import_linear_predictor signature drifted");
_Static_assert(N4M_RUST_SIGNATURE_IS(n4m_serialization_inspect,
                                     n4m_status_t (*)(const void*, size_t, uint32_t*, uint32_t*, uint32_t*, uint32_t*)),
               "n4m_serialization_inspect signature drifted");
_Static_assert(N4M_RUST_SIGNATURE_IS(n4m_serialization_inspect_model_v1,
                                     n4m_status_t (*)(const void*, size_t,
                                                      n4m_serialized_model_info_v1_t*)),
               "n4m_serialization_inspect_model_v1 signature drifted");
_Static_assert(N4M_RUST_SIGNATURE_IS(n4m_optimizer_save,
                                     n4m_status_t (*)(const n4m_optimizer_t*, n4m_array_t**)),
               "n4m_optimizer_save signature drifted");
_Static_assert(N4M_RUST_SIGNATURE_IS(n4m_optimizer_destroy, void (*)(n4m_optimizer_t*)),
               "n4m_optimizer_destroy signature drifted");
_Static_assert(N4M_RUST_SIGNATURE_IS(n4m_optimizer_load,
                                     n4m_status_t (*)(n4m_context_t*, const uint8_t*, uint64_t, n4m_optimizer_t**)),
               "n4m_optimizer_load signature drifted");
_Static_assert(N4M_RUST_SIGNATURE_IS(n4m_array_view,
                                     n4m_status_t (*)(const n4m_array_t*, n4m_matrix_view_t*)),
               "n4m_array_view signature drifted");
_Static_assert(N4M_RUST_SIGNATURE_IS(n4m_array_free, void (*)(n4m_array_t*)),
               "n4m_array_free signature drifted");
_Static_assert(N4M_RUST_SIGNATURE_IS(n4m_search_space_create,
                                     n4m_status_t (*)(n4m_search_space_t**)),
               "n4m_search_space_create signature drifted");
_Static_assert(N4M_RUST_SIGNATURE_IS(n4m_search_space_add_categorical,
                                     n4m_status_t (*)(n4m_search_space_t*, const char*, n4m_cat_type_t, const void*, int32_t)),
               "n4m_search_space_add_categorical signature drifted");
_Static_assert(N4M_RUST_SIGNATURE_IS(n4m_search_space_add_constraint,
                                     n4m_status_t (*)(n4m_search_space_t*, n4m_constraint_kind_t, const char* const*, const char* const*, int32_t)),
               "n4m_search_space_add_constraint signature drifted");
_Static_assert(N4M_RUST_SIGNATURE_IS(n4m_optimizer_create,
                                     n4m_status_t (*)(n4m_context_t*, const n4m_search_space_t*, const n4m_optimizer_options_t*, n4m_optimizer_t**)),
               "n4m_optimizer_create signature drifted");
_Static_assert(N4M_RUST_SIGNATURE_IS(n4m_optimizer_ask_batch,
                                     n4m_status_t (*)(n4m_optimizer_t*, int32_t, n4m_trial_t**, int32_t*)),
               "n4m_optimizer_ask_batch signature drifted");
_Static_assert(N4M_RUST_SIGNATURE_IS(n4m_optimizer_tell_result,
                                     n4m_status_t (*)(n4m_optimizer_t*, int64_t, n4m_trial_status_t, double, const char*)),
               "n4m_optimizer_tell_result signature drifted");
_Static_assert(N4M_RUST_SIGNATURE_IS(n4m_optimizer_tell_intermediate,
                                     n4m_status_t (*)(n4m_optimizer_t*, int64_t, int32_t, double, int32_t*)),
               "n4m_optimizer_tell_intermediate signature drifted");
_Static_assert(N4M_RUST_SIGNATURE_IS(n4m_optimizer_get_trials,
                                     n4m_status_t (*)(const n4m_optimizer_t*, int64_t, n4m_method_result_t**)),
               "n4m_optimizer_get_trials signature drifted");
_Static_assert(N4M_RUST_SIGNATURE_IS(n4m_trial_get_category,
                                     n4m_status_t (*)(const n4m_trial_t*, const char*, int32_t*, const char**)),
               "n4m_trial_get_category signature drifted");
_Static_assert(N4M_RUST_SIGNATURE_IS(n4m_method_result_get_double_matrix,
                                     n4m_status_t (*)(const n4m_method_result_t*, const char*, const double**, int64_t*, int64_t*)),
               "n4m_method_result_get_double_matrix signature drifted");
_Static_assert(N4M_RUST_SIGNATURE_IS(n4m_method_result_get_int_vector,
                                     n4m_status_t (*)(const n4m_method_result_t*, const char*, const int32_t**, int32_t*)),
               "n4m_method_result_get_int_vector signature drifted");
_Static_assert(N4M_RUST_SIGNATURE_IS(n4m_method_result_get_int64_vector,
                                     n4m_status_t (*)(const n4m_method_result_t*, const char*, const int64_t**, int64_t*)),
               "n4m_method_result_get_int64_vector signature drifted");

/* Keep one assertion for every Rust `extern` declaration. build.rs verifies
 * that this list is exhaustive before compiling the probe. */
_Static_assert(N4M_RUST_SIGNATURE_IS(n4m_config_create, n4m_status_t (*)(n4m_config_t**)), "n4m_config_create signature drifted");
_Static_assert(N4M_RUST_SIGNATURE_IS(n4m_config_destroy, void (*)(n4m_config_t*)), "n4m_config_destroy signature drifted");
_Static_assert(N4M_RUST_SIGNATURE_IS(n4m_config_set_n_components, n4m_status_t (*)(n4m_config_t*, int32_t)), "n4m_config_set_n_components signature drifted");
_Static_assert(N4M_RUST_SIGNATURE_IS(n4m_config_set_center_x, n4m_status_t (*)(n4m_config_t*, int32_t)), "n4m_config_set_center_x signature drifted");
_Static_assert(N4M_RUST_SIGNATURE_IS(n4m_config_set_scale_x, n4m_status_t (*)(n4m_config_t*, int32_t)), "n4m_config_set_scale_x signature drifted");
_Static_assert(N4M_RUST_SIGNATURE_IS(n4m_config_set_center_y, n4m_status_t (*)(n4m_config_t*, int32_t)), "n4m_config_set_center_y signature drifted");
_Static_assert(N4M_RUST_SIGNATURE_IS(n4m_config_set_scale_y, n4m_status_t (*)(n4m_config_t*, int32_t)), "n4m_config_set_scale_y signature drifted");
_Static_assert(N4M_RUST_SIGNATURE_IS(n4m_config_set_store_scores, n4m_status_t (*)(n4m_config_t*, int32_t)), "n4m_config_set_store_scores signature drifted");
_Static_assert(N4M_RUST_SIGNATURE_IS(n4m_model_fit, n4m_status_t (*)(n4m_context_t*, const n4m_config_t*, const n4m_matrix_view_t*, const n4m_matrix_view_t*, n4m_model_t**)), "n4m_model_fit signature drifted");
_Static_assert(N4M_RUST_SIGNATURE_IS(n4m_model_predict, n4m_status_t (*)(n4m_context_t*, const n4m_model_t*, const n4m_matrix_view_t*, n4m_matrix_view_t*)), "n4m_model_predict signature drifted");
_Static_assert(N4M_RUST_SIGNATURE_IS(n4m_model_predict_alloc, n4m_status_t (*)(n4m_context_t*, const n4m_model_t*, const n4m_matrix_view_t*, n4m_array_t**)), "n4m_model_predict_alloc signature drifted");
_Static_assert(N4M_RUST_SIGNATURE_IS(n4m_model_get_n_components, n4m_status_t (*)(const n4m_model_t*, int32_t*)), "n4m_model_get_n_components signature drifted");
_Static_assert(N4M_RUST_SIGNATURE_IS(n4m_model_get_n_features, n4m_status_t (*)(const n4m_model_t*, int32_t*)), "n4m_model_get_n_features signature drifted");
_Static_assert(N4M_RUST_SIGNATURE_IS(n4m_model_get_n_targets, n4m_status_t (*)(const n4m_model_t*, int32_t*)), "n4m_model_get_n_targets signature drifted");
_Static_assert(N4M_RUST_SIGNATURE_IS(n4m_method_result_destroy, void (*)(n4m_method_result_t*)), "n4m_method_result_destroy signature drifted");
_Static_assert(N4M_RUST_SIGNATURE_IS(n4m_method_result_get_scalar, n4m_status_t (*)(const n4m_method_result_t*, const char*, double*)), "n4m_method_result_get_scalar signature drifted");
_Static_assert(N4M_RUST_SIGNATURE_IS(n4m_estimators_ridge_fit, n4m_status_t (*)(n4m_context_t*, const n4m_config_t*, const n4m_matrix_view_t*, const n4m_matrix_view_t*, const double*, int64_t, n4m_method_result_t**)), "n4m_estimators_ridge_fit signature drifted");
_Static_assert(N4M_RUST_SIGNATURE_IS(n4m_optimizer_options_init, void (*)(n4m_optimizer_options_t*)), "n4m_optimizer_options_init signature drifted");
_Static_assert(N4M_RUST_SIGNATURE_IS(n4m_optimizer_enqueue, n4m_status_t (*)(n4m_optimizer_t*, const char* const*, const double*, int32_t)), "n4m_optimizer_enqueue signature drifted");
_Static_assert(N4M_RUST_SIGNATURE_IS(n4m_optimizer_ask, n4m_status_t (*)(n4m_optimizer_t*, n4m_trial_t**)), "n4m_optimizer_ask signature drifted");
_Static_assert(N4M_RUST_SIGNATURE_IS(n4m_optimizer_best, n4m_status_t (*)(const n4m_optimizer_t*, n4m_trial_t**, double*)), "n4m_optimizer_best signature drifted");
_Static_assert(N4M_RUST_SIGNATURE_IS(n4m_optimizer_tell, n4m_status_t (*)(n4m_optimizer_t*, int64_t, double)), "n4m_optimizer_tell signature drifted");
_Static_assert(N4M_RUST_SIGNATURE_IS(n4m_search_space_destroy, void (*)(n4m_search_space_t*)), "n4m_search_space_destroy signature drifted");
_Static_assert(N4M_RUST_SIGNATURE_IS(n4m_search_space_add_int, n4m_status_t (*)(n4m_search_space_t*, const char*, int64_t, int64_t, int64_t, int32_t)), "n4m_search_space_add_int signature drifted");
_Static_assert(N4M_RUST_SIGNATURE_IS(n4m_search_space_add_float, n4m_status_t (*)(n4m_search_space_t*, const char*, double, double, double, int32_t)), "n4m_search_space_add_float signature drifted");
_Static_assert(N4M_RUST_SIGNATURE_IS(n4m_search_space_add_ordinal, n4m_status_t (*)(n4m_search_space_t*, const char*, const double*, int32_t)), "n4m_search_space_add_ordinal signature drifted");
_Static_assert(N4M_RUST_SIGNATURE_IS(n4m_search_space_add_sorted_tuple, n4m_status_t (*)(n4m_search_space_t*, const char*, int32_t, double, double, int32_t)), "n4m_search_space_add_sorted_tuple signature drifted");
_Static_assert(N4M_RUST_SIGNATURE_IS(n4m_search_space_num_params, n4m_status_t (*)(const n4m_search_space_t*, int32_t*)), "n4m_search_space_num_params signature drifted");
_Static_assert(N4M_RUST_SIGNATURE_IS(n4m_trial_get_id, n4m_status_t (*)(const n4m_trial_t*, int64_t*)), "n4m_trial_get_id signature drifted");
_Static_assert(N4M_RUST_SIGNATURE_IS(n4m_trial_get_int, n4m_status_t (*)(const n4m_trial_t*, const char*, int64_t*)), "n4m_trial_get_int signature drifted");
_Static_assert(N4M_RUST_SIGNATURE_IS(n4m_trial_get_float, n4m_status_t (*)(const n4m_trial_t*, const char*, double*)), "n4m_trial_get_float signature drifted");
_Static_assert(N4M_RUST_SIGNATURE_IS(n4m_trial_is_active, n4m_status_t (*)(const n4m_trial_t*, const char*, int32_t*)), "n4m_trial_is_active signature drifted");
_Static_assert(N4M_RUST_SIGNATURE_IS(n4m_trial_get_rung, n4m_status_t (*)(const n4m_trial_t*, int32_t*)), "n4m_trial_get_rung signature drifted");
_Static_assert(N4M_RUST_SIGNATURE_IS(n4m_trial_get_status, n4m_status_t (*)(const n4m_trial_t*, n4m_trial_status_t*)), "n4m_trial_get_status signature drifted");
_Static_assert(N4M_RUST_SIGNATURE_IS(n4m_trial_get_duration, n4m_status_t (*)(const n4m_trial_t*, double*)), "n4m_trial_get_duration signature drifted");
_Static_assert(N4M_RUST_SIGNATURE_IS(n4m_validation_plan_create, n4m_status_t (*)(n4m_validation_plan_t**)), "n4m_validation_plan_create signature drifted");
_Static_assert(N4M_RUST_SIGNATURE_IS(n4m_validation_plan_destroy, void (*)(n4m_validation_plan_t*)), "n4m_validation_plan_destroy signature drifted");
_Static_assert(N4M_RUST_SIGNATURE_IS(n4m_validation_plan_set_n_samples, n4m_status_t (*)(n4m_validation_plan_t*, int64_t)), "n4m_validation_plan_set_n_samples signature drifted");
_Static_assert(N4M_RUST_SIGNATURE_IS(n4m_validation_plan_add_fold, n4m_status_t (*)(n4m_validation_plan_t*, const int64_t*, int64_t, const int64_t*, int64_t)), "n4m_validation_plan_add_fold signature drifted");
_Static_assert(N4M_RUST_SIGNATURE_IS(n4m_validation_plan_get_n_samples, n4m_status_t (*)(const n4m_validation_plan_t*, int64_t*)), "n4m_validation_plan_get_n_samples signature drifted");
_Static_assert(N4M_RUST_SIGNATURE_IS(n4m_validation_plan_get_n_folds, n4m_status_t (*)(const n4m_validation_plan_t*, int32_t*)), "n4m_validation_plan_get_n_folds signature drifted");
_Static_assert(N4M_RUST_SIGNATURE_IS(n4m_finetune_estimator, n4m_status_t (*)(n4m_context_t*, n4m_algorithm_t, const n4m_matrix_view_t*, const n4m_matrix_view_t*, const n4m_validation_plan_t*, const n4m_search_space_t*, const n4m_optimizer_options_t*, int32_t, n4m_method_result_t**)), "n4m_finetune_estimator signature drifted");
