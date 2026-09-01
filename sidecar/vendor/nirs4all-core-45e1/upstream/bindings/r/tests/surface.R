library(nirs4all)

expected_exports <- c(
  "dag_ml",
  "dag_ml_data",
  "datasets",
  "formats",
  "io",
  "methods",
  "nirs4all_artifact_contracts",
  "nirs4all_capability_manifest",
  "nirs4all_controller_capabilities",
  "nirs4all_load_pipeline",
  "nirs4all_local_implementation_registry",
  "nirs4all_parse_execution_plan",
  "nirs4all_portable_class_names",
  "nirs4all_require",
  "nirs4all_required_keyword_registry_entries",
  "nirs4all_runtime_contracts",
  "nirs4all_run_portable_pipeline",
  "nirs4all_runtime_surfaces",
  "nirs4all_upstreams"
)

namespace <- asNamespace("nirs4all")
stopifnot(identical(packageDescription("nirs4all")$Package, "nirs4all"))
stopifnot(identical(sort(getNamespaceExports("nirs4all")), sort(expected_exports)))

for (name in expected_exports) {
  stopifnot(exists(name, envir = namespace, inherits = FALSE))
}

stopifnot(identical(nirs4all::formats, get("formats", envir = namespace)))
stopifnot(identical(nirs4all::methods, get("methods", envir = namespace)))

manifest <- nirs4all::nirs4all_capability_manifest()
stopifnot(identical(manifest$schema, "nirs4all-core.capabilities.v1"))
contracts <- nirs4all::nirs4all_runtime_contracts()
stopifnot(identical(manifest$runtime_contracts, contracts))
artifact_contracts <- nirs4all::nirs4all_artifact_contracts()
stopifnot(identical(manifest$artifact_contracts, artifact_contracts))
stopifnot(identical(
  vapply(artifact_contracts, function(item) item$id, character(1)),
  c("conformal.calibrated_result", "robustness.summary", "tuning.summary", "tuning.ordered_search_space", "keyword.registry")
))
conformal_contract <- artifact_contracts[[which(vapply(artifact_contracts, function(item) item$id, character(1)) == "conformal.calibrated_result")]]
stopifnot(identical(
  conformal_contract$optional_payload_fields,
  c("conformal_guarantee_status", "calibration_replay_source", "tuning_calibration_source")
))
robustness_contract <- artifact_contracts[[which(vapply(artifact_contracts, function(item) item$id, character(1)) == "robustness.summary")]]
stopifnot(identical(robustness_contract$optional_payload_fields, c("conformal_guarantee_status", "spectral_replay")))
tuning_contract <- artifact_contracts[[which(vapply(artifact_contracts, function(item) item$id, character(1)) == "tuning.summary")]]
stopifnot(identical(tuning_contract$optional_payload_fields, c("sampler", "pruner", "seed", "persistence", "trials[*].diagnostics")))
ordered_tuning_contract <- artifact_contracts[[which(vapply(artifact_contracts, function(item) item$id, character(1)) == "tuning.ordered_search_space")]]
stopifnot(identical(ordered_tuning_contract$schema, "https://nirs4all.org/schemas/tuning-ordered-search-space/v1"))
stopifnot(identical(ordered_tuning_contract$portable_claim, "search-space-json-contract-only"))
stopifnot(identical(ordered_tuning_contract$required_registry_entries, c("run.tuning.space", "run.tuning.force_params")))
stopifnot(grepl("inspect_tuning_space", ordered_tuning_contract$python_surface, fixed = TRUE))
keyword_contract <- artifact_contracts[[which(vapply(artifact_contracts, function(item) item$id, character(1)) == "keyword.registry")]]
required_entries <- c(
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
stopifnot(identical(nirs4all::nirs4all_required_keyword_registry_entries(), required_entries))
stopifnot(identical(keyword_contract$required_registry_entries, required_entries))
stopifnot(grepl("TUNING_OPTIMIZER_PERSISTENCE_KEYS", keyword_contract$python_surface, fixed = TRUE))
stopifnot(grepl("ROBUSTNESS_SCENARIO_KINDS", keyword_contract$python_surface, fixed = TRUE))
stopifnot(grepl("ROBUSTNESS_SCENARIO_DISTRIBUTIONS", keyword_contract$python_surface, fixed = TRUE))
stopifnot(grepl("ROBUSTNESS_MODES", keyword_contract$python_surface, fixed = TRUE))
stopifnot(grepl("ROBUSTNESS_EXECUTABLE_MODES", keyword_contract$python_surface, fixed = TRUE))
stopifnot(identical(
  keyword_contract$published_constants$ROBUSTNESS_SCENARIO_DISTRIBUTIONS,
  c("normal", "uniform")
))
stopifnot(identical(
  vapply(contracts, function(item) item$surface, character(1)),
  c("python", "r", "javascript_wasm", "rust", "matlab_octave")
))
stopifnot(identical(
  vapply(contracts, function(item) isTRUE(item$serialized_model_predict), logical(1)),
  c(FALSE, FALSE, TRUE, FALSE, FALSE)
))
stopifnot(identical(
  nirs4all::nirs4all_runtime_surfaces(),
  c("python", "r", "javascript_wasm", "rust", "matlab_octave")
))
stopifnot(identical(
  vapply(manifest$controllers, function(item) item$id, character(1)),
  c(
    "split.kennard_stone",
    "preprocess.snv",
    "preprocess.savgol",
    "model.pls_regression",
    "pipeline.portable_methods"
  )
))
