args <- commandArgs(trailingOnly = TRUE)

arg_value <- function(flag) {
  idx <- match(flag, args)
  if (is.na(idx) || idx == length(args)) {
    return(NULL)
  }
  args[[idx + 1L]]
}

in_path <- arg_value("--in")
out_dir <- arg_value("--out")
strict <- identical(Sys.getenv("NIRS4ALL_CORE_REQUIRE_METHODS_PARITY"), "1")
if (is.null(out_dir) || !nzchar(out_dir)) {
  out_dir <- file.path(tempdir(), "nirs4all-r-run-save-pipeline")
}
if (is.null(in_path) || !nzchar(in_path)) {
  if (strict) {
    stop("missing --in argument", call. = FALSE)
  }
  message("Not running R pipeline save E2E: --in was not provided")
  quit(save = "no", status = 0, runLast = FALSE)
}
dir.create(out_dir, recursive = TRUE, showWarnings = FALSE)

`%||%` <- function(lhs, rhs) {
  if (is.null(lhs)) rhs else lhs
}

numeric_vec <- function(value) {
  as.numeric(unlist(value, use.names = FALSE))
}

integer_vec <- function(value) {
  as.integer(unlist(value, use.names = FALSE))
}

max_abs_diff <- function(actual, expected) {
  actual <- numeric_vec(actual)
  expected <- numeric_vec(expected)
  if (length(actual) != length(expected)) {
    stop(sprintf("numeric vector lengths differ: %d != %d", length(actual), length(expected)), call. = FALSE)
  }
  if (length(actual) == 0L) {
    return(0)
  }
  max(abs(actual - expected))
}

expect_close <- function(actual, expected, tolerance, label) {
  diff <- max_abs_diff(actual, expected)
  if (!is.finite(diff) || diff > tolerance) {
    stop(sprintf("%s differed by %0.12g > %0.12g", label, diff, tolerance), call. = FALSE)
  }
  invisible(diff)
}

expect_same_split <- function(actual, expected) {
  if (!identical(actual$kind, expected$kind)) {
    stop(sprintf("split kind differs: %s != %s", actual$kind, expected$kind), call. = FALSE)
  }
  if (!identical(integer_vec(actual$trainIndices), integer_vec(expected$trainIndices))) {
    stop("split trainIndices differ", call. = FALSE)
  }
  if (!identical(integer_vec(actual$testIndices), integer_vec(expected$testIndices))) {
    stop("split testIndices differ", call. = FALSE)
  }
}

expect_same_result <- function(actual, expected, tolerance, label) {
  stopifnot(identical(as.integer(actual$rows), as.integer(expected$rows)))
  stopifnot(identical(as.integer(actual$cols), as.integer(expected$cols)))
  expect_same_split(actual$split, expected$split)
  expect_close(actual$targets, expected$targets, tolerance, paste(label, "targets"))
  stopifnot(length(actual$variants) == length(expected$variants))
  for (idx in seq_along(expected$variants)) {
    stopifnot(identical(
      as.integer(actual$variants[[idx]]$n_components),
      as.integer(expected$variants[[idx]]$n_components)
    ))
    expect_close(actual$variants[[idx]]$rmse, expected$variants[[idx]]$rmse, tolerance, paste(label, "variant", idx, "rmse"))
    expect_close(
      actual$variants[[idx]]$predictions,
      expected$variants[[idx]]$predictions,
      tolerance,
      paste(label, "variant", idx, "predictions")
    )
  }
  stopifnot(identical(
    as.integer(actual$selected$n_components),
    as.integer(expected$selected$n_components)
  ))
  expect_close(actual$selected$rmse, expected$selected$rmse, tolerance, paste(label, "selected rmse"))
  expect_close(
    actual$selected$predictions,
    expected$selected$predictions,
    tolerance,
    paste(label, "selected predictions")
  )
}

result_numeric_deltas <- function(actual, expected) {
  variant_rmse_deltas <- c()
  variant_prediction_deltas <- c()
  for (idx in seq_along(expected$variants)) {
    variant_rmse_deltas <- c(variant_rmse_deltas, abs(actual$variants[[idx]]$rmse - expected$variants[[idx]]$rmse))
    variant_prediction_deltas <- c(
      variant_prediction_deltas,
      max_abs_diff(actual$variants[[idx]]$predictions, expected$variants[[idx]]$predictions)
    )
  }
  list(
    target_max_abs_delta = max_abs_diff(actual$targets, expected$targets),
    selected_prediction_max_abs_delta = max_abs_diff(actual$selected$predictions, expected$selected$predictions),
    selected_rmse_delta = abs(actual$selected$rmse - expected$selected$rmse),
    variant_rmse_max_abs_delta = if (length(variant_rmse_deltas) > 0L) max(variant_rmse_deltas) else 0,
    variant_prediction_max_abs_delta = if (length(variant_prediction_deltas) > 0L) max(variant_prediction_deltas) else 0
  )
}

candidate_path <- function(paths) {
  paths <- unique(paths[nzchar(paths)])
  for (path in paths) {
    if (file.exists(path)) {
      return(normalizePath(path, mustWork = TRUE))
    }
  }
  ""
}

local_lib <- normalizePath(".r-parity-lib", mustWork = FALSE)
if (dir.exists(local_lib)) {
  .libPaths(c(local_lib, .libPaths()))
}
if (!requireNamespace("nirs4all", quietly = TRUE)) {
  if (strict) {
    stop("nirs4all R package is not installed; run `make test-r-parity` first", call. = FALSE)
  }
  message("Not running R pipeline save E2E: nirs4all R package is not installed")
  quit(save = "no", status = 0, runLast = FALSE)
}
if (!requireNamespace("n4m", quietly = TRUE)) {
  if (strict) {
    stop("n4m R package is not installed; run `make test-r-parity` first", call. = FALSE)
  }
  message("Not running R pipeline save E2E: n4m R package is not installed")
  quit(save = "no", status = 0, runLast = FALSE)
}
n4m_abi <- n4m::n4m_abi_version()
if (length(n4m_abi) < 1L || as.integer(n4m_abi[[1L]]) < 2L) {
  stop(sprintf("n4m ABI major >= 2 required, got %s", paste(n4m_abi, collapse = ".")), call. = FALSE)
}

prepared <- jsonlite::fromJSON(in_path, simplifyVector = FALSE)
if (!identical(prepared$schema_version, "n4a.e2e.r_dataset_io_pipeline/v2")) {
  stop(sprintf("unsupported prepared dataset schema: %s", prepared$schema_version), call. = FALSE)
}
if (!isTRUE(prepared$io_reshape$selected_values_preserved)) {
  stop("prepared dataset did not preserve selected IO values", call. = FALSE)
}
if (is.null(prepared$io$io_spec_sha256) || is.null(prepared$io_reshape$dataset_sha256)) {
  stop("prepared dataset is missing IO/package provenance hashes", call. = FALSE)
}
pipeline_path <- prepared$source$pipeline
result <- nirs4all::nirs4all_run_portable_pipeline(pipeline_path, prepared$dataset)

pipeline <- nirs4all::nirs4all_load_pipeline(pipeline_path)
finite_predictions <- all(is.finite(as.numeric(unlist(result$selected$predictions, use.names = FALSE))))
finite_targets <- all(is.finite(as.numeric(unlist(result$targets, use.names = FALSE))))
if (!finite_predictions || !finite_targets) {
  stop("R pipeline produced non-finite predictions or targets", call. = FALSE)
}
workspace <- list(
  schema_version = "n4a.e2e.r_workspace/v1",
  status = "passed",
  engine = list(
    nirs4all_r = as.character(utils::packageVersion("nirs4all")),
    n4m = as.character(utils::packageVersion("n4m")),
    n4m_abi = paste(n4m_abi, collapse = ".")
  ),
  source = list(
    prepared_dataset = normalizePath(in_path, mustWork = TRUE),
    pipeline = normalizePath(pipeline_path, mustWork = TRUE),
    dataset_id = prepared$source$dataset_id,
    dataset_source = prepared$source$source,
    io_spec_sha256 = prepared$io$io_spec_sha256,
    dataset_sha256 = prepared$io_reshape$dataset_sha256
  ),
  io = prepared$io,
  io_reshape = prepared$io_reshape,
  result = result
)
pipeline_artifact <- c(
  list(
    schema_version = "n4a.e2e.r_pipeline/v1",
    status = "passed"
  ),
  unclass(pipeline)
)
predictions <- list(
  schema_version = "n4a.e2e.r_predictions/v1",
  status = "passed",
  selected_n_components = result$selected$n_components,
  targets = result$targets,
  predictions = result$selected$predictions,
  checks = list(
    finite_predictions = finite_predictions,
    finite_targets = finite_targets,
    variants = length(result$variants),
    dataset_rows = prepared$dataset$rows,
    dataset_cols = prepared$dataset$cols
  ),
  variants = lapply(result$variants, function(item) {
    list(n_components = item$n_components, rmse = item$rmse)
  })
)

workspace_path <- file.path(out_dir, "workspace.n4a.json")
pipeline_artifact_path <- file.path(out_dir, "pipeline.n4a.json")
predictions_path <- file.path(out_dir, "r-predictions.json")

jsonlite::write_json(workspace, workspace_path, auto_unbox = TRUE, pretty = TRUE, digits = NA)
jsonlite::write_json(pipeline_artifact, pipeline_artifact_path, auto_unbox = TRUE, pretty = TRUE, digits = NA)
jsonlite::write_json(predictions, predictions_path, auto_unbox = TRUE, pretty = TRUE, digits = NA)

reopened_workspace <- jsonlite::fromJSON(workspace_path, simplifyVector = FALSE)
reopened_pipeline <- nirs4all::nirs4all_load_pipeline(pipeline_artifact_path)
reopened_predictions <- jsonlite::fromJSON(predictions_path, simplifyVector = FALSE)
reopened_prepared <- jsonlite::fromJSON(reopened_workspace$source$prepared_dataset, simplifyVector = FALSE)
roundtrip_result <- nirs4all::nirs4all_run_portable_pipeline(pipeline_artifact_path, reopened_prepared$dataset)

stopifnot(identical(reopened_workspace$schema_version, "n4a.e2e.r_workspace/v1"))
stopifnot(identical(reopened_workspace$status, "passed"))
stopifnot(identical(reopened_pipeline$name, pipeline$name))
stopifnot(identical(reopened_pipeline$random_state, pipeline$random_state))
stopifnot(identical(reopened_predictions$schema_version, "n4a.e2e.r_predictions/v1"))
stopifnot(identical(reopened_predictions$status, "passed"))
stopifnot(identical(reopened_workspace$source$dataset_sha256, prepared$io_reshape$dataset_sha256))
stopifnot(identical(reopened_workspace$source$io_spec_sha256, prepared$io$io_spec_sha256))
expect_same_result(reopened_workspace$result, result, 1e-10, "workspace JSON")
expect_same_result(roundtrip_result, result, 1e-10, "pipeline JSON rerun")
expect_close(reopened_predictions$targets, result$targets, 1e-10, "predictions artifact targets")
expect_close(reopened_predictions$predictions, result$selected$predictions, 1e-10, "predictions artifact predictions")
stopifnot(identical(
  as.integer(reopened_predictions$selected_n_components),
  as.integer(result$selected$n_components)
))
roundtrip_tolerance <- 1e-10
workspace_numeric_deltas <- result_numeric_deltas(reopened_workspace$result, result)
pipeline_rerun_numeric_deltas <- result_numeric_deltas(roundtrip_result, result)
prediction_artifact_numeric_deltas <- list(
  target_max_abs_delta = max_abs_diff(reopened_predictions$targets, result$targets),
  selected_prediction_max_abs_delta = max_abs_diff(reopened_predictions$predictions, result$selected$predictions),
  selected_n_components_absolute_delta = abs(
    as.integer(reopened_predictions$selected_n_components) - as.integer(result$selected$n_components)
  )
)

oracle_path <- candidate_path(c(
  Sys.getenv("NIRS4ALL_CORE_PARITY_ORACLE"),
  file.path("tests", "parity", "expected", "portable_python_oracle.json"),
  file.path("..", "..", "tests", "parity", "expected", "portable_python_oracle.json")
))
oracle_check <- list(status = "not_available")
if (nzchar(oracle_path)) {
  oracle <- jsonlite::fromJSON(oracle_path, simplifyVector = FALSE)
  expected_cases <- Filter(function(item) identical(item$name, "portable_methods_pipeline"), oracle$cases)
  if (length(expected_cases) != 1L) {
    stop("portable_methods_pipeline case not found in Python oracle", call. = FALSE)
  }
  expected <- expected_cases[[1L]]
  oracle_dataset <- list(
    X = oracle$dataset$X,
    y = oracle$dataset$y,
    rows = oracle$dataset$rows,
    cols = oracle$dataset$cols
  )
  oracle_result <- nirs4all::nirs4all_run_portable_pipeline(pipeline_artifact_path, oracle_dataset)
  tol <- oracle$metadata$tolerances %||% list()
  expect_same_split(oracle_result$split, expected$split)
  expect_close(oracle_result$targets, expected$targets, tol$targets_abs %||% 1e-12, "Python oracle targets")
  stopifnot(length(oracle_result$variants) == length(expected$variants))
  for (idx in seq_along(expected$variants)) {
    stopifnot(identical(
      as.integer(oracle_result$variants[[idx]]$n_components),
      as.integer(expected$variants[[idx]]$n_components)
    ))
    expect_close(
      oracle_result$variants[[idx]]$rmse,
      expected$variants[[idx]]$rmse,
      tol$rmse_abs %||% 1e-6,
      paste("Python oracle variant", idx, "rmse")
    )
    expect_close(
      oracle_result$variants[[idx]]$predictions,
      expected$variants[[idx]]$predictions,
      tol$predictions_abs %||% 1e-5,
      paste("Python oracle variant", idx, "predictions")
    )
  }
  stopifnot(identical(
    as.integer(oracle_result$selected$n_components),
    as.integer(expected$selected$n_components)
  ))
  expect_close(
    oracle_result$selected$predictions,
    expected$selected$predictions,
    tol$predictions_abs %||% 1e-5,
    "Python oracle selected predictions"
  )
  oracle_check <- list(
    status = "passed",
    oracle = oracle_path,
    case = expected$name,
    dataset_rows = oracle$dataset$rows,
    dataset_cols = oracle$dataset$cols
  )
}

roundtrip_checks <- list(
  schema_version = "n4a.e2e.r_roundtrip_checks/v1",
  status = "passed",
  workspace_reopened = TRUE,
  pipeline_reopened = TRUE,
  predictions_reopened = TRUE,
  reproduced_split_targets_rmse_predictions = TRUE,
  numeric_roundtrip = list(
    tolerance = roundtrip_tolerance,
    count_tolerance = 0,
    workspace = workspace_numeric_deltas,
    pipeline_rerun = pipeline_rerun_numeric_deltas,
    predictions_artifact = prediction_artifact_numeric_deltas
  ),
  oracle = oracle_check
)
jsonlite::write_json(roundtrip_checks, file.path(out_dir, "roundtrip-checks.json"), auto_unbox = TRUE, pretty = TRUE, digits = NA)
