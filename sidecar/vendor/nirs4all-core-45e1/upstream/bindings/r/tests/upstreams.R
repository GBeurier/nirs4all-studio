library(nirs4all)

status <- nirs4all::nirs4all_upstreams()

stopifnot(identical(status$key, c("dag_ml", "dag_ml_data", "formats", "io", "datasets", "methods")))
stopifnot("candidates" %in% names(status))
stopifnot(grepl("n4m", status$candidates[status$key == "methods"], fixed = TRUE))
stopifnot(identical(status$candidates[status$key == "dag_ml"], "dagml"))

err <- tryCatch(nirs4all::nirs4all_require("missing"), error = identity)
stopifnot(inherits(err, "error"))

if (requireNamespace("dagml", quietly = TRUE)) {
  stopifnot(is.environment(nirs4all::dag_ml()))
  registry <- nirs4all::nirs4all_local_implementation_registry()
  stopifnot(inherits(registry, "dagml_local_implementation_registry"))
  stopifnot(is.function(registry$register_loss))
  stopifnot(is.function(registry$register_metric))
  stopifnot(is.function(registry$invoke_training_loss))
  stopifnot(registry$size() == 0L)
} else {
  err <- tryCatch(nirs4all::dag_ml(), error = identity)
  stopifnot(inherits(err, "error"))
  err <- tryCatch(
    nirs4all::nirs4all_local_implementation_registry(),
    error = identity
  )
  stopifnot(inherits(err, "error"))
}
