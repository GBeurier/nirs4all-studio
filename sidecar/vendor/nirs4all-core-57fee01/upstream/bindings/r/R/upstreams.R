NIRS4ALL_UPSTREAMS <- list(
  dag_ml = list(candidates = c("dagml"), role = "Leakage-safe DAG/ML execution coordinator"),
  dag_ml_data = list(candidates = c("dagmldata"), role = "Sample-aligned data contracts for DAG/ML runtimes"),
  formats = list(candidates = c("nirs4allformats"), role = "Spectroscopy/NIRS vendor file readers"),
  io = list(candidates = c("nirs4allio"), role = "Dataset assembly bridge"),
  datasets = list(candidates = c("nirs4alldatasets"), role = "DOI-pinned NIRS dataset catalog"),
  methods = list(candidates = c("n4m", "pls4all"), role = "Portable C ABI PLS/NIRS numerical engine")
)

nirs4all_upstreams <- function() {
  data.frame(
    key = names(NIRS4ALL_UPSTREAMS),
    available = vapply(NIRS4ALL_UPSTREAMS, function(item) {
      any(vapply(item$candidates, requireNamespace, quietly = TRUE, FUN.VALUE = logical(1)))
    }, logical(1)),
    candidates = vapply(NIRS4ALL_UPSTREAMS, function(item) {
      paste(item$candidates, collapse = ",")
    }, character(1)),
    role = vapply(NIRS4ALL_UPSTREAMS, function(item) item$role, character(1)),
    row.names = NULL
  )
}

nirs4all_require <- function(name) {
  item <- NIRS4ALL_UPSTREAMS[[name]]
  if (is.null(item)) {
    stop(sprintf("Unknown nirs4all upstream: %s", name), call. = FALSE)
  }
  if (length(item$candidates) == 0L) {
    stop(sprintf("No R binding is currently declared for nirs4all upstream: %s", name), call. = FALSE)
  }
  for (candidate in item$candidates) {
    if (requireNamespace(candidate, quietly = TRUE)) {
      return(asNamespace(candidate))
    }
  }
  stop(
    sprintf(
      "nirs4all upstream '%s' is not installed. Tried: %s",
      name,
      paste(item$candidates, collapse = ", ")
    ),
    call. = FALSE
  )
}

formats <- function() nirs4all_require("formats")
io <- function() nirs4all_require("io")
datasets <- function() nirs4all_require("datasets")
methods <- function() nirs4all_require("methods")
dag_ml <- function() nirs4all_require("dag_ml")
dag_ml_data <- function() nirs4all_require("dag_ml_data")

nirs4all_local_implementation_registry <- function() {
  namespace <- dag_ml()
  factory <- get0(
    "dagml_local_implementation_registry",
    envir = namespace,
    inherits = FALSE
  )
  if (!is.function(factory)) {
    stop(
      "The installed dagml package does not expose dagml_local_implementation_registry; upgrade dagml.",
      call. = FALSE
    )
  }
  registry <- factory()
  required_methods <- c("register_loss", "register_metric", "invoke_training_loss")
  missing_methods <- required_methods[!vapply(required_methods, function(name) {
    is.function(registry[[name]])
  }, logical(1))]
  if (length(missing_methods) > 0L) {
    stop(
      sprintf(
        "The installed dagml package local registry does not expose %s; upgrade dagml.",
        paste(missing_methods, collapse = ", ")
      ),
      call. = FALSE
    )
  }
  registry
}
