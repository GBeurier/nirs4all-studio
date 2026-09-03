strict <- identical(Sys.getenv("NIRS4ALL_CORE_REQUIRE_METHODS_PARITY"), "1")
ledger_path <- Sys.getenv("NIRS4ALL_CORE_R_PARITY_LEDGER")
scenario_id <- Sys.getenv("NIRS4ALL_CORE_R_PARITY_SCENARIO_ID")
if (!nzchar(scenario_id)) {
  scenario_id <- "nirs4all-core-r-parity"
}

write_ledger <- function(payload) {
  if (!nzchar(ledger_path)) return(invisible(NULL))
  dir.create(dirname(ledger_path), recursive = TRUE, showWarnings = FALSE)
  writeLines(
    jsonlite::toJSON(payload, auto_unbox = TRUE, pretty = TRUE, digits = 17),
    ledger_path
  )
}

if (!requireNamespace("n4m", quietly = TRUE)) {
  if (strict) stop("n4m R binding is required for strict parity")
  message("Skipping R execution parity: n4m is not installed")
} else {
  n4m_path <- find.package("n4m")
  expected_r_lib <- Sys.getenv("NIRS4ALL_CORE_R_PARITY_LIB")
  if (strict && nzchar(expected_r_lib)) {
    expected_r_lib <- normalizePath(expected_r_lib, mustWork = TRUE)
    n4m_path <- normalizePath(n4m_path, mustWork = TRUE)
    if (!startsWith(n4m_path, expected_r_lib)) {
      stop(sprintf("strict parity loaded n4m from %s, expected it under %s",
                   n4m_path, expected_r_lib))
    }
  }
  n4m_abi <- n4m::n4m_abi_version()
  if (strict && (length(n4m_abi) < 1L || as.integer(n4m_abi[[1]]) < 2L)) {
    stop(sprintf("strict parity requires n4m ABI major >= 2, got %s",
                 paste(n4m_abi, collapse = ".")))
  }

  oracle_path <- Sys.getenv("NIRS4ALL_CORE_PARITY_ORACLE")
  if (!nzchar(oracle_path)) {
    oracle_path <- file.path("tests", "parity", "expected", "portable_python_oracle.json")
  }
  if (!file.exists(oracle_path)) {
    if (strict) stop(sprintf("Portable parity oracle not found: %s", oracle_path))
    message("Skipping R execution parity: oracle is not available")
  } else {
    fixture_root <- Sys.getenv("NIRS4ALL_CORE_PARITY_FIXTURES")
    if (!nzchar(fixture_root)) {
      fixture_root <- system.file("extdata", package = "nirs4all")
    }

    numeric_vec <- function(value) as.numeric(unlist(value, use.names = FALSE))
    integer_vec <- function(value) as.integer(unlist(value, use.names = FALSE))
    bool <- function(value) isTRUE(value)
    max_abs_diff <- function(actual, expected) {
      actual <- numeric_vec(actual)
      expected <- numeric_vec(expected)
      stopifnot(length(actual) == length(expected))
      if (length(actual) == 0L) return(0)
      max(abs(actual - expected))
    }
    finite_vec <- function(value) all(is.finite(numeric_vec(value)))
    expect_same_split <- function(actual, expected) {
      stopifnot(identical(actual$kind, expected$kind))
      stopifnot(identical(actual$trainIndices, integer_vec(expected$trainIndices)))
      stopifnot(identical(actual$testIndices, integer_vec(expected$testIndices)))
    }

    oracle <- jsonlite::fromJSON(oracle_path, simplifyVector = FALSE)
    dataset <- list(
      X = oracle$dataset$X,
      y = oracle$dataset$y,
      rows = oracle$dataset$rows,
      cols = oracle$dataset$cols
    )
    tol <- oracle$metadata$tolerances
    stopifnot(length(oracle$cases) >= 4L)

    case_ledgers <- list()
    global_target_delta <- 0
    global_prediction_delta <- 0
    global_rmse_delta <- 0
    global_variant_rmse_delta <- 0
    global_variant_prediction_delta <- 0
    global_prediction_rows <- 0L
    global_finite_predictions <- TRUE

    for (expected in oracle$cases) {
      fixture <- file.path(fixture_root, paste0(expected$name, ".json"))
      stopifnot(file.exists(fixture))
      actual <- nirs4all::nirs4all_run_portable_pipeline(fixture, dataset)

      expect_same_split(actual$split, expected$split)
      target_delta <- max_abs_diff(actual$targets, expected$targets)
      selected_prediction_delta <- max_abs_diff(
        actual$selected$predictions,
        expected$selected$predictions
      )
      selected_rmse_delta <- abs(actual$selected$rmse - expected$selected$rmse)
      variant_count_match <- identical(length(actual$variants), length(expected$variants))
      selected_n_components_match <- identical(
        actual$selected$n_components,
        as.integer(expected$selected$n_components)
      )
      stopifnot(target_delta <= tol$targets_abs)
      stopifnot(variant_count_match)
      variant_rmse_deltas <- c()
      variant_prediction_deltas <- c()
      for (i in seq_along(expected$variants)) {
        variant_rmse_delta <- abs(actual$variants[[i]]$rmse - expected$variants[[i]]$rmse)
        variant_prediction_delta <- max_abs_diff(
          actual$variants[[i]]$predictions,
          expected$variants[[i]]$predictions
        )
        variant_rmse_deltas <- c(variant_rmse_deltas, variant_rmse_delta)
        variant_prediction_deltas <- c(variant_prediction_deltas, variant_prediction_delta)
        stopifnot(identical(actual$variants[[i]]$n_components,
                            as.integer(expected$variants[[i]]$n_components)))
        stopifnot(variant_rmse_delta <= tol$rmse_abs)
        stopifnot(
          variant_prediction_delta <= tol$predictions_abs
        )
      }
      stopifnot(selected_n_components_match)
      stopifnot(selected_prediction_delta <= tol$predictions_abs)
      stopifnot(selected_rmse_delta <= tol$rmse_abs)

      variant_rmse_max <- if (length(variant_rmse_deltas) > 0L) max(variant_rmse_deltas) else 0
      variant_prediction_max <- if (length(variant_prediction_deltas) > 0L) max(variant_prediction_deltas) else 0
      selected_predictions <- numeric_vec(actual$selected$predictions)
      finite_predictions <- finite_vec(actual$selected$predictions) &&
        all(vapply(actual$variants, function(variant) finite_vec(variant$predictions), logical(1)))
      case_ledgers[[length(case_ledgers) + 1L]] <- list(
        name = expected$name,
        fixture = fixture,
        split_match = TRUE,
        variant_count_match = variant_count_match,
        selected_n_components_match = selected_n_components_match,
        prediction_rows = length(selected_predictions),
        finite_predictions = finite_predictions,
        target_max_abs_delta = target_delta,
        prediction_max_abs_delta = selected_prediction_delta,
        rmse_delta = selected_rmse_delta,
        variant_rmse_max_abs_delta = variant_rmse_max,
        variant_prediction_max_abs_delta = variant_prediction_max,
        selected = list(
          n_components = as.integer(actual$selected$n_components),
          rmse = actual$selected$rmse
        )
      )
      global_target_delta <- max(global_target_delta, target_delta)
      global_prediction_delta <- max(global_prediction_delta, selected_prediction_delta)
      global_rmse_delta <- max(global_rmse_delta, selected_rmse_delta)
      global_variant_rmse_delta <- max(global_variant_rmse_delta, variant_rmse_max)
      global_variant_prediction_delta <- max(global_variant_prediction_delta, variant_prediction_max)
      global_prediction_rows <- global_prediction_rows + length(selected_predictions)
      global_finite_predictions <- global_finite_predictions && finite_predictions
    }

    write_ledger(list(
      schema_version = "n4a.e2e.r_parity_ledger.v1",
      scenario_id = scenario_id,
      status = "passed",
      language = "r",
      oracle_reopened = TRUE,
      pipeline_reopened = TRUE,
      r_rerun_executed = TRUE,
      case_count = length(case_ledgers),
      finite_predictions = bool(global_finite_predictions),
      prediction_rows = global_prediction_rows,
      target_max_abs_delta = global_target_delta,
      target_tolerance = tol$targets_abs,
      prediction_max_abs_delta = global_prediction_delta,
      prediction_tolerance = tol$predictions_abs,
      rmse_delta = global_rmse_delta,
      rmse_tolerance = tol$rmse_abs,
      variant_rmse_max_abs_delta = global_variant_rmse_delta,
      variant_prediction_max_abs_delta = global_variant_prediction_delta,
      dataset = list(
        rows = as.integer(dataset$rows),
        cols = as.integer(dataset$cols)
      ),
      r = list(
        version = paste(R.version$major, R.version$minor, sep = "."),
        n4m_abi = n4m_abi
      ),
      cases = case_ledgers
    ))
  }
}
