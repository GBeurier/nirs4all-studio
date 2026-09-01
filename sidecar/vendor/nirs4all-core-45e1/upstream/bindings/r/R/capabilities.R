NIRS4ALL_RUNTIME_SURFACES <- c(
  "python",
  "r",
  "javascript_wasm",
  "rust",
  "matlab_octave"
)

parity_runtime <- function() {
  stats::setNames(
    rep("parity-validated", length(NIRS4ALL_RUNTIME_SURFACES)),
    NIRS4ALL_RUNTIME_SURFACES
  )
}

nirs4all_runtime_surfaces <- function() {
  NIRS4ALL_RUNTIME_SURFACES
}

nirs4all_runtime_contracts <- function() {
  list(
    list(
      surface = "python",
      pipeline_execution = "parity-validated",
      pipeline_entrypoint = "run_portable_pipeline",
      serialized_model_predict = FALSE,
      predict_entrypoint = NULL
    ),
    list(
      surface = "r",
      pipeline_execution = "parity-validated",
      pipeline_entrypoint = "nirs4all_run_portable_pipeline",
      serialized_model_predict = FALSE,
      predict_entrypoint = NULL
    ),
    list(
      surface = "javascript_wasm",
      pipeline_execution = "parity-validated",
      pipeline_entrypoint = "runPortablePipeline",
      serialized_model_predict = TRUE,
      predict_entrypoint = "predictPortablePipeline"
    ),
    list(
      surface = "rust",
      pipeline_execution = "parity-validated",
      pipeline_entrypoint = "run_portable_pipeline_with_library",
      serialized_model_predict = FALSE,
      predict_entrypoint = NULL
    ),
    list(
      surface = "matlab_octave",
      pipeline_execution = "parity-validated",
      pipeline_entrypoint = "runPortablePipeline",
      serialized_model_predict = FALSE,
      predict_entrypoint = NULL
    )
  )
}

nirs4all_required_keyword_registry_entries <- function() {
  c(
    "run.tuning",
    "run.tuning.engine",
    "run.tuning.space",
    "run.tuning.force_params",
    "run.tuning.score_data",
    "run.tuning.score_data.conformal_calibration",
    "predict.coverage",
    "predict.all_predictions",
    "robustness.scenarios.kind",
    "robustness.scenarios.severity",
    "robustness.scenarios.distribution",
    "robustness.X",
    "robustness.predictor",
    "robustness.predictor_bundle"
  )
}

nirs4all_artifact_contracts <- function() {
  metadata_levels <- stats::setNames(
    rep("metadata", length(NIRS4ALL_RUNTIME_SURFACES)),
    NIRS4ALL_RUNTIME_SURFACES
  )
  list(
    list(
      id = "conformal.calibrated_result",
      schema = "nirs4all.dagml.conformal_store.v1",
      producer = "full-python-nirs4all",
      consumer_level = metadata_levels,
      python_surface = "nirs4all.calibrate / nirs4all.predict_calibrated / nirs4all.load_calibrated_result",
      portable_claim = "not-exposed-in-nirs4all-core",
      optional_payload_fields = c(
        "conformal_guarantee_status",
        "calibration_replay_source",
        "tuning_calibration_source"
      ),
      required_registry_entries = character(0)
    ),
    list(
      id = "robustness.summary",
      schema = "https://nirs4all.org/schemas/robustness-summary/v1",
      producer = "full-python-nirs4all",
      consumer_level = metadata_levels,
      python_surface = "nirs4all.RobustnessReport.summary_artifact / nirs4all.robustness_summary_schema_json",
      portable_claim = "summary-json-contract-only",
      optional_payload_fields = c("conformal_guarantee_status", "spectral_replay"),
      required_registry_entries = character(0)
    ),
    list(
      id = "tuning.summary",
      schema = "https://nirs4all.org/schemas/tuning-summary/v1",
      producer = "full-python-nirs4all",
      consumer_level = metadata_levels,
      python_surface = "nirs4all.TuningResult.summary_artifact / nirs4all.tuning_summary_schema_json",
      portable_claim = "summary-json-contract-only",
      optional_payload_fields = c("sampler", "pruner", "seed", "persistence", "trials[*].diagnostics"),
      required_registry_entries = character(0)
    ),
    list(
      id = "tuning.ordered_search_space",
      schema = "https://nirs4all.org/schemas/tuning-ordered-search-space/v1",
      producer = "full-python-nirs4all",
      consumer_level = metadata_levels,
      python_surface = "nirs4all.inspect_tuning_space / nirs4all.NativeTuning.inspect_space / nirs4all.tuning_space_schema_json / nirs4all CLI tuning-space",
      portable_claim = "search-space-json-contract-only",
      optional_payload_fields = character(0),
      required_registry_entries = c("run.tuning.space", "run.tuning.force_params")
    ),
    list(
      id = "keyword.registry",
      schema = "nirs4all.keyword_registry.v1",
      producer = "full-python-nirs4all",
      consumer_level = metadata_levels,
      python_surface = "nirs4all.get_keyword_registry / nirs4all.keyword_registry_json / nirs4all.keyword_registry_schema_json / nirs4all.TUNING_OPTIMIZER_PERSISTENCE_KEYS / nirs4all.ROBUSTNESS_SCENARIO_KINDS / nirs4all.ROBUSTNESS_STOCHASTIC_SCENARIO_KINDS / nirs4all.ROBUSTNESS_SCENARIO_DISTRIBUTIONS / nirs4all.ROBUSTNESS_MODES / nirs4all.ROBUSTNESS_EXECUTABLE_MODES",
      portable_claim = "registry-json-contract-only",
      optional_payload_fields = character(0),
      published_constants = list(
        ROBUSTNESS_SCENARIO_DISTRIBUTIONS = c("normal", "uniform")
      ),
      required_registry_entries = nirs4all_required_keyword_registry_entries()
    )
  )
}

nirs4all_controller_capabilities <- function() {
  runtime <- parity_runtime()
  list(
    list(
      id = "split.kennard_stone",
      kind = "splitter",
      domain = "methods",
      label = "Kennard-Stone split",
      operator_classes = NIRS4ALL_KENNARD_STONE_CLASSES,
      ports = list(inputs = c("X"), outputs = c("train_indices", "test_indices")),
      parameters = c("test_size"),
      runtime = runtime,
      execution_path = "portable_pipeline"
    ),
    list(
      id = "preprocess.snv",
      kind = "transform",
      domain = "methods",
      label = "Standard normal variate",
      operator_classes = NIRS4ALL_SNV_CLASSES,
      ports = list(inputs = c("X"), outputs = c("X_transformed")),
      parameters = character(),
      runtime = runtime,
      execution_path = "portable_pipeline"
    ),
    list(
      id = "preprocess.savgol",
      kind = "transform",
      domain = "methods",
      label = "Savitzky-Golay",
      operator_classes = NIRS4ALL_SAVGOL_CLASSES,
      ports = list(inputs = c("X"), outputs = c("X_transformed")),
      parameters = c("window_length", "polyorder", "deriv", "mode", "cval"),
      runtime = runtime,
      execution_path = "portable_pipeline"
    ),
    list(
      id = "model.pls_regression",
      kind = "model",
      domain = "methods",
      label = "PLS regression",
      operator_classes = NIRS4ALL_PLS_CLASSES,
      ports = list(inputs = c("X", "y"), outputs = c("predictions", "model")),
      parameters = c("n_components", "_range_"),
      runtime = runtime,
      execution_path = "portable_pipeline"
    ),
    list(
      id = "pipeline.portable_methods",
      kind = "pipeline",
      domain = "methods",
      label = "Portable methods pipeline",
      operator_classes = character(),
      ports = list(
        inputs = c("pipeline", "dataset"),
        outputs = c("execution_result", "predictions", "model")
      ),
      parameters = character(),
      runtime = runtime,
      execution_path = "run_portable_pipeline",
      composes = c(
        "split.kennard_stone",
        "preprocess.snv",
        "preprocess.savgol",
        "model.pls_regression"
      )
    )
  )
}

nirs4all_capability_manifest <- function() {
  list(
    schema = "nirs4all-core.capabilities.v1",
    aggregate = "nirs4all-core",
    runtime_surfaces = nirs4all_runtime_surfaces(),
    runtime_contracts = nirs4all_runtime_contracts(),
    artifact_contracts = nirs4all_artifact_contracts(),
    portable_operator_classes = NIRS4ALL_PORTABLE_OPERATOR_CLASSES,
    controllers = nirs4all_controller_capabilities()
  )
}
