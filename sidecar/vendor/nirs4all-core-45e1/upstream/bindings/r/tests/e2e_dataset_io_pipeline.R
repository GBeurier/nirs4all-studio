args <- commandArgs(trailingOnly = TRUE)

arg_value <- function(flag) {
  idx <- match(flag, args)
  if (is.na(idx) || idx == length(args)) {
    return(NULL)
  }
  args[[idx + 1L]]
}

require_field <- function(value, name) {
  if (is.null(value)) {
    stop(sprintf("missing required field: %s", name), call. = FALSE)
  }
  value
}

require_non_empty <- function(value, name) {
  value <- require_field(value, name)
  if (!is.character(value) || length(value) != 1L || !nzchar(value)) {
    stop(sprintf("field must be a non-empty string: %s", name), call. = FALSE)
  }
  value
}

sha256_text <- function(value) {
  tool <- Sys.which("sha256sum")
  if (!nzchar(tool)) {
    return("not-computed-no-sha256sum")
  }
  path <- tempfile("n4a-sha256-")
  on.exit(unlink(path), add = TRUE)
  writeLines(value, path, useBytes = TRUE)
  strsplit(system2(tool, path, stdout = TRUE), " ", fixed = TRUE)[[1L]][[1L]]
}

write_package_selftest_payload <- function(out_dir) {
  pipeline_path <- system.file("extdata", "portable_methods_pipeline.json", package = "nirs4all")
  if (!nzchar(pipeline_path)) {
    pipeline_path <- file.path("inst", "extdata", "portable_methods_pipeline.json")
  }
  if (!file.exists(pipeline_path)) {
    stop(sprintf("pipeline fixture not found: %s", pipeline_path), call. = FALSE)
  }

  rows <- 40L
  cols <- 28L
  X <- lapply(seq_len(rows), function(row) {
    round(sin(seq_len(cols) / 5 + row / 7) + row / 20, 12)
  })
  y <- round(seq_len(rows) / 13 + cos(seq_len(rows) / 6), 12)
  dataset <- list(
    X = X,
    y = y,
    rows = rows,
    cols = cols,
    target = "package_selftest_y",
    feature_headers = as.character(seq_len(cols))
  )
  dataset_json <- jsonlite::toJSON(dataset, auto_unbox = TRUE, digits = NA)
  io_spec <- list(schema_version = "package-selftest", note = "R CMD check fallback; ecosystem E2E uses provider/datasets/io helper")
  package_summary <- list(
    schema_version = "package-selftest",
    partitions = list(train = list(n_samples = rows)),
    manifest = list(entries = list(
      list(role = "features", shape = list(rows, cols), content_hash = sha256_text(dataset_json)),
      list(role = "targets", shape = list(rows, 1L), content_hash = sha256_text(jsonlite::toJSON(y, auto_unbox = TRUE)))
    ))
  )
  payload <- list(
    schema_version = "n4a.e2e.r_dataset_io_pipeline/v2",
    status = "prepared",
    source = list(
      dataset_id = "package-selftest",
      dataset_title = "R package self-test fallback",
      dataset_tier = "local",
      source = "synthetic",
      pipeline = normalizePath(pipeline_path, mustWork = TRUE)
    ),
    provider_contract = list(
      provider = "package-selftest-fallback",
      backing = "none",
      io_bridge = "not used during R CMD check; ecosystem E2E requires the real helper path"
    ),
    io = list(
      assembled_block = "train",
      io_spec_sha256 = sha256_text(jsonlite::toJSON(io_spec, auto_unbox = TRUE)),
      package_manifest_root = package_summary$manifest$entries[[1L]]$content_hash,
      feature_payload_shape = list(rows, cols),
      target_payload_shape = list(rows, 1L),
      feature_payload_hash = package_summary$manifest$entries[[1L]]$content_hash,
      target_payload_hash = package_summary$manifest$entries[[2L]]$content_hash,
      audits = list()
    ),
    dataset = dataset,
    io_reshape = list(
      from = list(rows = rows, cols = cols, representation = "R package self-test matrix"),
      to = list(rows = rows, cols = cols, representation = "R list-of-row-vectors portable dataset"),
      row_indices = as.list(seq.int(0L, rows - 1L)),
      col_indices = as.list(seq.int(0L, cols - 1L)),
      selected_values_preserved = TRUE,
      dataset_sha256 = sha256_text(dataset_json)
    )
  )

  jsonlite::write_json(list(id = "package-selftest"), file.path(out_dir, "dataset-card.json"), auto_unbox = TRUE, pretty = TRUE)
  jsonlite::write_json(io_spec, file.path(out_dir, "io-spec.n4a.json"), auto_unbox = TRUE, pretty = TRUE)
  jsonlite::write_json(package_summary, file.path(out_dir, "dataset-package-summary.json"), auto_unbox = TRUE, pretty = TRUE)
  jsonlite::write_json(payload, file.path(out_dir, "reshaped-dataset.json"), auto_unbox = TRUE, pretty = TRUE)
}

out_dir <- arg_value("--out")
if (is.null(out_dir) || !nzchar(out_dir)) {
  out_dir <- file.path(tempdir(), "nirs4all-r-dataset-io-pipeline")
}
dir.create(out_dir, recursive = TRUE, showWarnings = FALSE)

python <- Sys.getenv("PYTHON", "python3.11")
helper <- file.path("scripts", "e2e", "prepare_r_dataset_io_pipeline.py")
if (file.exists(helper)) {
  status <- system2(
    python,
    c(helper, "--out", out_dir),
    stdout = "",
    stderr = ""
  )
  if (!identical(status, 0L)) {
    stop(sprintf("dataset/io prepare helper failed with status %s", status), call. = FALSE)
  }
} else {
  write_package_selftest_payload(out_dir)
}

prepared_path <- file.path(out_dir, "reshaped-dataset.json")
if (!file.exists(prepared_path)) {
  stop(sprintf("dataset/io prepare helper did not write %s", prepared_path), call. = FALSE)
}
prepared <- jsonlite::fromJSON(prepared_path, simplifyVector = FALSE)

stopifnot(identical(prepared$schema_version, "n4a.e2e.r_dataset_io_pipeline/v2"))
stopifnot(identical(prepared$status, "prepared"))
invisible(require_non_empty(prepared$source$dataset_id, "source.dataset_id"))
invisible(require_non_empty(prepared$source$source, "source.source"))
invisible(require_non_empty(prepared$source$pipeline, "source.pipeline"))
stopifnot(file.exists(prepared$source$pipeline))
invisible(require_non_empty(prepared$provider_contract$provider, "provider_contract.provider"))
invisible(require_non_empty(prepared$provider_contract$io_bridge, "provider_contract.io_bridge"))
invisible(require_non_empty(prepared$io$io_spec_sha256, "io.io_spec_sha256"))
invisible(require_non_empty(prepared$io_reshape$dataset_sha256, "io_reshape.dataset_sha256"))
stopifnot(isTRUE(prepared$io_reshape$selected_values_preserved))
stopifnot(length(prepared$dataset$X) == prepared$dataset$rows)
stopifnot(length(prepared$dataset$y) == prepared$dataset$rows)
stopifnot(length(prepared$dataset$X[[1L]]) == prepared$dataset$cols)
stopifnot(identical(as.integer(prepared$io_reshape$to$rows), as.integer(prepared$dataset$rows)))
stopifnot(identical(as.integer(prepared$io_reshape$to$cols), as.integer(prepared$dataset$cols)))
if (!is.null(prepared$io$feature_payload_shape)) {
  stopifnot(as.integer(prepared$io$feature_payload_shape[[1L]]) >= as.integer(prepared$dataset$rows))
  stopifnot(as.integer(prepared$io$feature_payload_shape[[2L]]) >= as.integer(prepared$dataset$cols))
}
if (!is.null(prepared$io$target_payload_shape)) {
  stopifnot(as.integer(prepared$io$target_payload_shape[[1L]]) >= as.integer(prepared$dataset$rows))
}
feature_values <- as.numeric(unlist(prepared$dataset$X, use.names = FALSE))
target_values <- as.numeric(unlist(prepared$dataset$y, use.names = FALSE))
stopifnot(length(feature_values) == prepared$dataset$rows * prepared$dataset$cols)
stopifnot(all(is.finite(feature_values)))
stopifnot(all(is.finite(target_values)))
stopifnot(length(prepared$io_reshape$row_indices) == prepared$dataset$rows)
stopifnot(length(prepared$io_reshape$col_indices) == prepared$dataset$cols)

session_payload <- list(
  schema_version = "n4a.e2e.r_session/v1",
  status = "prepared",
  r_version = as.character(getRversion()),
  platform = R.version$platform,
  attached = capture.output(sessionInfo()),
  prepared_dataset = normalizePath(prepared_path, mustWork = TRUE)
)
jsonlite::write_json(
  session_payload,
  file.path(out_dir, "r-session-info.json"),
  auto_unbox = TRUE,
  pretty = TRUE
)
