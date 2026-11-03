#include <stdalign.h>
#include <stddef.h>

#include "n4m/n4m.h"
#include "n4m/optimization.h"
#include "n4m/multimodal.h"

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
_Static_assert(sizeof(n4m_multimodal_source_spec_v1_t) == 128,
               "Rust multimodal source spec layout drifted");
_Static_assert(alignof(n4m_multimodal_source_spec_v1_t) == 8,
               "Rust multimodal source spec alignment drifted");
_Static_assert(offsetof(n4m_multimodal_source_spec_v1_t, shape) == 56,
               "Rust multimodal source shape offset drifted");
_Static_assert(offsetof(n4m_multimodal_source_spec_v1_t, weight) == 72,
               "Rust multimodal source weight offset drifted");
_Static_assert(offsetof(n4m_multimodal_source_spec_v1_t, numeric_column) == 112,
               "Rust multimodal numeric column offset drifted");
_Static_assert(sizeof(n4m_multimodal_recipe_v1_t) == 40,
               "Rust multimodal recipe layout drifted");
_Static_assert(offsetof(n4m_multimodal_recipe_v1_t, sources) == 8,
               "Rust multimodal recipe sources offset drifted");
_Static_assert(offsetof(n4m_multimodal_recipe_v1_t, alpha) == 16,
               "Rust multimodal recipe alpha offset drifted");
_Static_assert(sizeof(n4m_multimodal_source_view_v1_t) == 112,
               "Rust multimodal tensor layout drifted");
_Static_assert(alignof(n4m_multimodal_source_view_v1_t) == 8,
               "Rust multimodal tensor alignment drifted");
_Static_assert(offsetof(n4m_multimodal_source_view_v1_t, numeric_data) == 72,
               "Rust multimodal numeric data offset drifted");
_Static_assert(offsetof(n4m_multimodal_source_view_v1_t, categorical_utf8) == 88,
               "Rust multimodal UTF-8 data offset drifted");
_Static_assert(offsetof(n4m_multimodal_source_view_v1_t, categorical_offsets) == 104,
               "Rust multimodal UTF-8 offsets drifted");

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

_Static_assert(N4M_RUST_SIGNATURE_IS(n4m_multimodal_pipeline_create,
    n4m_status_t (*)(n4m_context_t*, const n4m_multimodal_recipe_v1_t*, n4m_multimodal_pipeline_t**)),
    "n4m_multimodal_pipeline_create signature drifted");
_Static_assert(N4M_RUST_SIGNATURE_IS(n4m_multimodal_pipeline_destroy,
    void (*)(n4m_multimodal_pipeline_t*)), "n4m_multimodal_pipeline_destroy signature drifted");
_Static_assert(N4M_RUST_SIGNATURE_IS(n4m_multimodal_pipeline_fit,
    n4m_status_t (*)(n4m_context_t*, n4m_multimodal_pipeline_t*, int32_t, const n4m_multimodal_source_view_v1_t*, const n4m_matrix_view_t*)),
    "n4m_multimodal_pipeline_fit signature drifted");
_Static_assert(N4M_RUST_SIGNATURE_IS(n4m_multimodal_pipeline_predict,
    n4m_status_t (*)(n4m_context_t*, const n4m_multimodal_pipeline_t*, int32_t, const n4m_multimodal_source_view_v1_t*, n4m_matrix_view_t*)),
    "n4m_multimodal_pipeline_predict signature drifted");
_Static_assert(N4M_RUST_SIGNATURE_IS(n4m_multimodal_pipeline_transform_cols,
    n4m_status_t (*)(const n4m_multimodal_pipeline_t*, int64_t*)), "n4m_multimodal_pipeline_transform_cols signature drifted");
_Static_assert(N4M_RUST_SIGNATURE_IS(n4m_multimodal_pipeline_transform,
    n4m_status_t (*)(n4m_context_t*, const n4m_multimodal_pipeline_t*, int32_t, const n4m_multimodal_source_view_v1_t*, n4m_matrix_view_t*)),
    "n4m_multimodal_pipeline_transform signature drifted");
_Static_assert(N4M_RUST_SIGNATURE_IS(n4m_multimodal_pipeline_export_size,
    n4m_status_t (*)(n4m_context_t*, const n4m_multimodal_pipeline_t*, size_t*)),
    "n4m_multimodal_pipeline_export_size signature drifted");
_Static_assert(N4M_RUST_SIGNATURE_IS(n4m_multimodal_pipeline_export_to_buffer,
    n4m_status_t (*)(n4m_context_t*, const n4m_multimodal_pipeline_t*, void*, size_t, size_t*)),
    "n4m_multimodal_pipeline_export_to_buffer signature drifted");
_Static_assert(N4M_RUST_SIGNATURE_IS(n4m_multimodal_pipeline_import_from_buffer,
    n4m_status_t (*)(n4m_context_t*, const n4m_multimodal_recipe_v1_t*, const void*, size_t, n4m_multimodal_pipeline_t**)),
    "n4m_multimodal_pipeline_import_from_buffer signature drifted");

_Static_assert(N4M_RUST_SIGNATURE_IS(n4m_get_abi_version_major, uint32_t (*)(void)),
               "n4m_get_abi_version_major signature drifted");
_Static_assert(N4M_RUST_SIGNATURE_IS(n4m_get_abi_version_minor, uint32_t (*)(void)),
               "n4m_get_abi_version_minor signature drifted");
_Static_assert(N4M_RUST_SIGNATURE_IS(n4m_get_abi_version_patch, uint32_t (*)(void)),
               "n4m_get_abi_version_patch signature drifted");
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
_Static_assert(sizeof(n4m_serialized_pipeline_info_v1_t) == 96,
               "Rust SerializedPipelineInfoV1Raw layout is stale relative to the C header");
_Static_assert(offsetof(n4m_serialized_model_info_v1_t, training_samples) == 32,
               "Rust SerializedModelInfoV1Raw.training_samples offset is stale");
_Static_assert(offsetof(n4m_serialized_model_info_v1_t, capabilities) == 56,
               "Rust SerializedModelInfoV1Raw.capabilities offset is stale");
_Static_assert(offsetof(n4m_serialized_pipeline_info_v1_t, savgol_delta) == 40,
               "Rust SerializedPipelineInfoV1Raw.savgol_delta offset is stale");
_Static_assert(offsetof(n4m_serialized_pipeline_info_v1_t, semantic_profile) == 36,
               "Rust SerializedPipelineInfoV1Raw.semantic_profile offset is stale");
_Static_assert(offsetof(n4m_serialized_pipeline_info_v1_t, snv_axis) == 60,
               "Rust SerializedPipelineInfoV1Raw.snv_axis offset is stale");
_Static_assert(offsetof(n4m_serialized_pipeline_info_v1_t, fingerprint) == 64,
               "Rust SerializedPipelineInfoV1Raw.fingerprint offset is stale");
_Static_assert(offsetof(n4m_serialized_pipeline_info_v1_t, savgol_cval) == 88,
               "Rust SerializedPipelineInfoV1Raw.savgol_cval offset is stale");
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
_Static_assert(N4M_RUST_SIGNATURE_IS(n4m_serialization_inspect_pipeline_v1,
                                     n4m_status_t (*)(const void*, size_t,
                                                      n4m_serialized_pipeline_info_v1_t*, size_t)),
               "n4m_serialization_inspect_pipeline_v1 signature drifted");
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
_Static_assert(N4M_RUST_SIGNATURE_IS(n4m_pipeline_create, n4m_status_t (*)(n4m_pipeline_t**)), "n4m_pipeline_create signature drifted");
_Static_assert(N4M_RUST_SIGNATURE_IS(n4m_pipeline_destroy, void (*)(n4m_pipeline_t*)), "n4m_pipeline_destroy signature drifted");
_Static_assert(N4M_RUST_SIGNATURE_IS(n4m_pipeline_add_operator, n4m_status_t (*)(n4m_pipeline_t*, n4m_operator_kind_t, const double*, int32_t)), "n4m_pipeline_add_operator signature drifted");
_Static_assert(N4M_RUST_SIGNATURE_IS(n4m_config_set_pipeline, n4m_status_t (*)(n4m_config_t*, const n4m_pipeline_t*)), "n4m_config_set_pipeline signature drifted");
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

/* Generic estimator roles (n4m/estimator.h, ABI 2.13). */
_Static_assert(sizeof(n4m_fit_inputs_v1_t) == 144, "Rust FitInputsV1Raw size is stale relative to the C header");
_Static_assert(offsetof(n4m_fit_inputs_v1_t, X) == 8, "Rust FitInputsV1Raw.x offset is stale relative to the C header");
_Static_assert(offsetof(n4m_fit_inputs_v1_t, block_sizes) == 88, "Rust FitInputsV1Raw.block_sizes offset is stale relative to the C header");
_Static_assert(offsetof(n4m_fit_inputs_v1_t, X_target) == 120, "Rust FitInputsV1Raw.x_target offset is stale relative to the C header");
_Static_assert(offsetof(n4m_fit_inputs_v1_t, n_fold_ids) == 136, "Rust FitInputsV1Raw.n_fold_ids offset is stale relative to the C header");
_Static_assert(sizeof(n4m_method_info_v1_t) == 88, "Rust MethodInfoV1Raw size is stale relative to the C header");
_Static_assert(offsetof(n4m_method_info_v1_t, capabilities) == 32, "Rust MethodInfoV1Raw.capabilities offset is stale relative to the C header");
_Static_assert(offsetof(n4m_method_info_v1_t, inputs) == 48, "Rust MethodInfoV1Raw.inputs offset is stale relative to the C header");
_Static_assert(N4M_FIT_INPUT_COUNT == 9, "Rust FIT_INPUT_COUNT is stale relative to the C header");
_Static_assert(sizeof(n4m_param_info_v1_t) == 64, "Rust ParamInfoV1Raw size is stale relative to the C header");
_Static_assert(offsetof(n4m_param_info_v1_t, recorded) == 56, "Rust ParamInfoV1Raw.recorded offset is stale relative to the C header");
_Static_assert(offsetof(n4m_param_info_v1_t, default_length) == 24, "Rust ParamInfoV1Raw.default_length offset is stale relative to the C header");
_Static_assert(offsetof(n4m_param_info_v1_t, choices) == 48, "Rust ParamInfoV1Raw.choices offset is stale relative to the C header");
_Static_assert(N4M_EXPORT_ALLOW_TRAINING_ROWS == 1u, "Rust EXPORT_ALLOW_TRAINING_ROWS is stale relative to the C header");
_Static_assert(N4M_ROLE_GENERIC == (1u << 7) && N4M_CAP_RETAINS_TRAINING_ROWS == (UINT64_C(1) << 9), "Rust role/capability masks are stale relative to the C header");
_Static_assert(N4M_RUST_SIGNATURE_IS(n4m_method_result_get_n_folds, n4m_status_t (*)(const n4m_method_result_t*, int32_t*)), "n4m_method_result_get_n_folds signature drifted");
_Static_assert(N4M_RUST_SIGNATURE_IS(n4m_method_result_get_fold, n4m_status_t (*)(const n4m_method_result_t*, int32_t, const int64_t**, int64_t*, const int64_t**, int64_t*)), "n4m_method_result_get_fold signature drifted");
_Static_assert(N4M_RUST_SIGNATURE_IS(n4m_method_result_entry_count, n4m_status_t (*)(const n4m_method_result_t*, int32_t*)), "n4m_method_result_entry_count signature drifted");
_Static_assert(N4M_RUST_SIGNATURE_IS(n4m_method_result_entry, n4m_status_t (*)(const n4m_method_result_t*, int32_t, const char**, int32_t*)), "n4m_method_result_entry signature drifted");
_Static_assert(N4M_RUST_SIGNATURE_IS(n4m_method_count, n4m_status_t (*)(int32_t*)), "n4m_method_count signature drifted");
_Static_assert(N4M_RUST_SIGNATURE_IS(n4m_method_manifest_json, n4m_status_t (*)(char*, size_t, size_t*)), "n4m_method_manifest_json signature drifted");
_Static_assert(N4M_RUST_SIGNATURE_IS(n4m_method_find, n4m_status_t (*)(const char*, int32_t*)), "n4m_method_find signature drifted");
_Static_assert(N4M_RUST_SIGNATURE_IS(n4m_method_info_v1, n4m_status_t (*)(int32_t, n4m_method_info_v1_t*)), "n4m_method_info_v1 signature drifted");
_Static_assert(N4M_RUST_SIGNATURE_IS(n4m_method_param_info_v1, n4m_status_t (*)(int32_t, int32_t, n4m_param_info_v1_t*)), "n4m_method_param_info_v1 signature drifted");
_Static_assert(N4M_RUST_SIGNATURE_IS(n4m_method_param_default_int, n4m_status_t (*)(int32_t, int32_t, int64_t*, int64_t, int64_t*)), "n4m_method_param_default_int signature drifted");
_Static_assert(N4M_RUST_SIGNATURE_IS(n4m_method_param_default_double, n4m_status_t (*)(int32_t, int32_t, double*, int64_t, int64_t*)), "n4m_method_param_default_double signature drifted");
_Static_assert(N4M_RUST_SIGNATURE_IS(n4m_params_create, n4m_status_t (*)(n4m_context_t*, int32_t, n4m_params_t**)), "n4m_params_create signature drifted");
_Static_assert(N4M_RUST_SIGNATURE_IS(n4m_params_destroy, void (*)(n4m_params_t*)), "n4m_params_destroy signature drifted");
_Static_assert(N4M_RUST_SIGNATURE_IS(n4m_params_set_int, n4m_status_t (*)(n4m_params_t*, const char*, int64_t)), "n4m_params_set_int signature drifted");
_Static_assert(N4M_RUST_SIGNATURE_IS(n4m_params_set_double, n4m_status_t (*)(n4m_params_t*, const char*, double)), "n4m_params_set_double signature drifted");
_Static_assert(N4M_RUST_SIGNATURE_IS(n4m_params_set_bool, n4m_status_t (*)(n4m_params_t*, const char*, int32_t)), "n4m_params_set_bool signature drifted");
_Static_assert(N4M_RUST_SIGNATURE_IS(n4m_params_set_enum, n4m_status_t (*)(n4m_params_t*, const char*, const char*)), "n4m_params_set_enum signature drifted");
_Static_assert(N4M_RUST_SIGNATURE_IS(n4m_params_set_int_array, n4m_status_t (*)(n4m_params_t*, const char*, const int64_t*, int64_t)), "n4m_params_set_int_array signature drifted");
_Static_assert(N4M_RUST_SIGNATURE_IS(n4m_params_set_double_array, n4m_status_t (*)(n4m_params_t*, const char*, const double*, int64_t)), "n4m_params_set_double_array signature drifted");
_Static_assert(N4M_RUST_SIGNATURE_IS(n4m_params_validate, n4m_status_t (*)(n4m_context_t*, const n4m_params_t*)), "n4m_params_validate signature drifted");
_Static_assert(N4M_RUST_SIGNATURE_IS(n4m_params_get_int, n4m_status_t (*)(const n4m_params_t*, const char*, int64_t*, int64_t, int64_t*)), "n4m_params_get_int signature drifted");
_Static_assert(N4M_RUST_SIGNATURE_IS(n4m_params_get_double, n4m_status_t (*)(const n4m_params_t*, const char*, double*, int64_t, int64_t*)), "n4m_params_get_double signature drifted");
_Static_assert(N4M_RUST_SIGNATURE_IS(n4m_estimator_create, n4m_status_t (*)(n4m_context_t*, const char*, const n4m_params_t*, n4m_estimator_t**)), "n4m_estimator_create signature drifted");
_Static_assert(N4M_RUST_SIGNATURE_IS(n4m_estimator_destroy, void (*)(n4m_estimator_t*)), "n4m_estimator_destroy signature drifted");
_Static_assert(N4M_RUST_SIGNATURE_IS(n4m_estimator_fit, n4m_status_t (*)(n4m_context_t*, n4m_estimator_t*, const n4m_fit_inputs_v1_t*)), "n4m_estimator_fit signature drifted");
_Static_assert(N4M_RUST_SIGNATURE_IS(n4m_estimator_is_fitted, n4m_status_t (*)(const n4m_estimator_t*, int32_t*)), "n4m_estimator_is_fitted signature drifted");
_Static_assert(N4M_RUST_SIGNATURE_IS(n4m_estimator_info, n4m_status_t (*)(const n4m_estimator_t*, int32_t*, uint64_t*)), "n4m_estimator_info signature drifted");
_Static_assert(N4M_RUST_SIGNATURE_IS(n4m_estimator_get_params, n4m_status_t (*)(n4m_context_t*, const n4m_estimator_t*, n4m_params_t**)), "n4m_estimator_get_params signature drifted");
_Static_assert(N4M_RUST_SIGNATURE_IS(n4m_estimator_n_features_in, n4m_status_t (*)(const n4m_estimator_t*, int64_t*)), "n4m_estimator_n_features_in signature drifted");
_Static_assert(N4M_RUST_SIGNATURE_IS(n4m_estimator_transform_cols, n4m_status_t (*)(const n4m_estimator_t*, int64_t*)), "n4m_estimator_transform_cols signature drifted");
_Static_assert(N4M_RUST_SIGNATURE_IS(n4m_estimator_contains_training_rows, n4m_status_t (*)(const n4m_estimator_t*, int32_t*)), "n4m_estimator_contains_training_rows signature drifted");
_Static_assert(N4M_RUST_SIGNATURE_IS(n4m_estimator_n_outputs, n4m_status_t (*)(const n4m_estimator_t*, int64_t*)), "n4m_estimator_n_outputs signature drifted");
_Static_assert(N4M_RUST_SIGNATURE_IS(n4m_estimator_transform, n4m_status_t (*)(n4m_context_t*, const n4m_estimator_t*, const n4m_matrix_view_t*, n4m_matrix_view_t*)), "n4m_estimator_transform signature drifted");
_Static_assert(N4M_RUST_SIGNATURE_IS(n4m_estimator_predict, n4m_status_t (*)(n4m_context_t*, const n4m_estimator_t*, const n4m_matrix_view_t*, n4m_matrix_view_t*)), "n4m_estimator_predict signature drifted");
_Static_assert(N4M_RUST_SIGNATURE_IS(n4m_estimator_decision_function, n4m_status_t (*)(n4m_context_t*, const n4m_estimator_t*, const n4m_matrix_view_t*, n4m_matrix_view_t*)), "n4m_estimator_decision_function signature drifted");
_Static_assert(N4M_RUST_SIGNATURE_IS(n4m_estimator_predict_proba, n4m_status_t (*)(n4m_context_t*, const n4m_estimator_t*, const n4m_matrix_view_t*, n4m_matrix_view_t*)), "n4m_estimator_predict_proba signature drifted");
_Static_assert(N4M_RUST_SIGNATURE_IS(n4m_estimator_predict_labels, n4m_status_t (*)(n4m_context_t*, const n4m_estimator_t*, const n4m_matrix_view_t*, int64_t*, int64_t)), "n4m_estimator_predict_labels signature drifted");
_Static_assert(N4M_RUST_SIGNATURE_IS(n4m_estimator_classes, n4m_status_t (*)(const n4m_estimator_t*, int64_t*, int64_t, int64_t*)), "n4m_estimator_classes signature drifted");
_Static_assert(N4M_RUST_SIGNATURE_IS(n4m_estimator_selected_indices, n4m_status_t (*)(const n4m_estimator_t*, int64_t*, int64_t, int64_t*)), "n4m_estimator_selected_indices signature drifted");
_Static_assert(N4M_RUST_SIGNATURE_IS(n4m_estimator_apply_mask, n4m_status_t (*)(n4m_context_t*, const n4m_estimator_t*, const n4m_matrix_view_t*, const n4m_matrix_view_t*, uint8_t*, int64_t)), "n4m_estimator_apply_mask signature drifted");
_Static_assert(N4M_RUST_SIGNATURE_IS(n4m_procedure_run, n4m_status_t (*)(n4m_context_t*, int32_t, const n4m_params_t*, const n4m_fit_inputs_v1_t*, n4m_method_result_t**)), "n4m_procedure_run signature drifted");
_Static_assert(N4M_RUST_SIGNATURE_IS(n4m_context_set_max_state_bytes, n4m_status_t (*)(n4m_context_t*, uint64_t)), "n4m_context_set_max_state_bytes signature drifted");
_Static_assert(N4M_RUST_SIGNATURE_IS(n4m_estimator_export_size, n4m_status_t (*)(n4m_context_t*, const n4m_estimator_t*, uint32_t, size_t*)), "n4m_estimator_export_size signature drifted");
_Static_assert(N4M_RUST_SIGNATURE_IS(n4m_estimator_export_to_buffer, n4m_status_t (*)(n4m_context_t*, const n4m_estimator_t*, uint32_t, void*, size_t, size_t*)), "n4m_estimator_export_to_buffer signature drifted");
_Static_assert(N4M_RUST_SIGNATURE_IS(n4m_estimator_import_from_buffer, n4m_status_t (*)(n4m_context_t*, const void*, size_t, n4m_estimator_t**)), "n4m_estimator_import_from_buffer signature drifted");

/* Role pipelines (n4m/estimator.h, ABI 2.14). */
_Static_assert(sizeof(n4m_role_pipeline_step_info_v1_t) == 48, "Rust RolePipelineStepInfoV1Raw size is stale relative to the C header");
_Static_assert(offsetof(n4m_role_pipeline_step_info_v1_t, role) == 16, "Rust RolePipelineStepInfoV1Raw.role offset is stale relative to the C header");
_Static_assert(offsetof(n4m_role_pipeline_step_info_v1_t, n_features_in) == 32, "Rust RolePipelineStepInfoV1Raw.n_features_in offset is stale relative to the C header");
_Static_assert(N4M_RUST_SIGNATURE_IS(n4m_role_pipeline_create, n4m_status_t (*)(n4m_context_t*, int32_t, const char* const*, const n4m_params_t* const*, n4m_role_pipeline_t**)), "n4m_role_pipeline_create signature drifted");
_Static_assert(N4M_RUST_SIGNATURE_IS(n4m_role_pipeline_destroy, void (*)(n4m_role_pipeline_t*)), "n4m_role_pipeline_destroy signature drifted");
_Static_assert(N4M_RUST_SIGNATURE_IS(n4m_role_pipeline_set_feature_names, n4m_status_t (*)(n4m_context_t*, n4m_role_pipeline_t*, const char* const*, int64_t)), "n4m_role_pipeline_set_feature_names signature drifted");
_Static_assert(N4M_RUST_SIGNATURE_IS(n4m_role_pipeline_fit, n4m_status_t (*)(n4m_context_t*, n4m_role_pipeline_t*, const n4m_fit_inputs_v1_t*)), "n4m_role_pipeline_fit signature drifted");
_Static_assert(N4M_RUST_SIGNATURE_IS(n4m_role_pipeline_import_states, n4m_status_t (*)(n4m_context_t*, n4m_role_pipeline_t*, int32_t, const void* const*, const size_t*)), "n4m_role_pipeline_import_states signature drifted");
_Static_assert(N4M_RUST_SIGNATURE_IS(n4m_role_pipeline_is_fitted, n4m_status_t (*)(const n4m_role_pipeline_t*, int32_t*)), "n4m_role_pipeline_is_fitted signature drifted");
_Static_assert(N4M_RUST_SIGNATURE_IS(n4m_role_pipeline_n_steps, n4m_status_t (*)(const n4m_role_pipeline_t*, int32_t*)), "n4m_role_pipeline_n_steps signature drifted");
_Static_assert(N4M_RUST_SIGNATURE_IS(n4m_role_pipeline_n_states, n4m_status_t (*)(const n4m_role_pipeline_t*, int32_t*)), "n4m_role_pipeline_n_states signature drifted");
_Static_assert(N4M_RUST_SIGNATURE_IS(n4m_role_pipeline_step_info_v1, n4m_status_t (*)(const n4m_role_pipeline_t*, int32_t, n4m_role_pipeline_step_info_v1_t*)), "n4m_role_pipeline_step_info_v1 signature drifted");
_Static_assert(N4M_RUST_SIGNATURE_IS(n4m_role_pipeline_n_features_in, n4m_status_t (*)(const n4m_role_pipeline_t*, int64_t*)), "n4m_role_pipeline_n_features_in signature drifted");
_Static_assert(N4M_RUST_SIGNATURE_IS(n4m_role_pipeline_n_feature_names, n4m_status_t (*)(const n4m_role_pipeline_t*, int64_t*)), "n4m_role_pipeline_n_feature_names signature drifted");
_Static_assert(N4M_RUST_SIGNATURE_IS(n4m_role_pipeline_feature_name, n4m_status_t (*)(const n4m_role_pipeline_t*, int64_t, const char**)), "n4m_role_pipeline_feature_name signature drifted");
_Static_assert(N4M_RUST_SIGNATURE_IS(n4m_role_pipeline_check_features, n4m_status_t (*)(n4m_context_t*, const n4m_role_pipeline_t*, int64_t, const char* const*)), "n4m_role_pipeline_check_features signature drifted");
_Static_assert(N4M_RUST_SIGNATURE_IS(n4m_role_pipeline_transform_cols, n4m_status_t (*)(const n4m_role_pipeline_t*, int64_t*)), "n4m_role_pipeline_transform_cols signature drifted");
_Static_assert(N4M_RUST_SIGNATURE_IS(n4m_role_pipeline_n_outputs, n4m_status_t (*)(const n4m_role_pipeline_t*, int64_t*)), "n4m_role_pipeline_n_outputs signature drifted");
_Static_assert(N4M_RUST_SIGNATURE_IS(n4m_role_pipeline_transform, n4m_status_t (*)(n4m_context_t*, const n4m_role_pipeline_t*, const n4m_matrix_view_t*, n4m_matrix_view_t*)), "n4m_role_pipeline_transform signature drifted");
_Static_assert(N4M_RUST_SIGNATURE_IS(n4m_role_pipeline_predict, n4m_status_t (*)(n4m_context_t*, const n4m_role_pipeline_t*, const n4m_matrix_view_t*, n4m_matrix_view_t*)), "n4m_role_pipeline_predict signature drifted");
_Static_assert(N4M_RUST_SIGNATURE_IS(n4m_role_pipeline_decision_function, n4m_status_t (*)(n4m_context_t*, const n4m_role_pipeline_t*, const n4m_matrix_view_t*, n4m_matrix_view_t*)), "n4m_role_pipeline_decision_function signature drifted");
_Static_assert(N4M_RUST_SIGNATURE_IS(n4m_role_pipeline_predict_proba, n4m_status_t (*)(n4m_context_t*, const n4m_role_pipeline_t*, const n4m_matrix_view_t*, n4m_matrix_view_t*)), "n4m_role_pipeline_predict_proba signature drifted");
_Static_assert(N4M_RUST_SIGNATURE_IS(n4m_role_pipeline_predict_labels, n4m_status_t (*)(n4m_context_t*, const n4m_role_pipeline_t*, const n4m_matrix_view_t*, int64_t*, int64_t)), "n4m_role_pipeline_predict_labels signature drifted");
_Static_assert(N4M_RUST_SIGNATURE_IS(n4m_role_pipeline_classes, n4m_status_t (*)(const n4m_role_pipeline_t*, int64_t*, int64_t, int64_t*)), "n4m_role_pipeline_classes signature drifted");
_Static_assert(N4M_RUST_SIGNATURE_IS(n4m_role_pipeline_export_state_size, n4m_status_t (*)(n4m_context_t*, const n4m_role_pipeline_t*, int32_t, uint32_t, size_t*)), "n4m_role_pipeline_export_state_size signature drifted");
_Static_assert(N4M_RUST_SIGNATURE_IS(n4m_role_pipeline_export_state_to_buffer, n4m_status_t (*)(n4m_context_t*, const n4m_role_pipeline_t*, int32_t, uint32_t, void*, size_t, size_t*)), "n4m_role_pipeline_export_state_to_buffer signature drifted");
