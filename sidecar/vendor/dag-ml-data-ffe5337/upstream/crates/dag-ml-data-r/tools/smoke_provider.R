# Developer smoke for the dagmldata R provider bindings (run manually, not by
# R CMD check). Requires the package to be installed
# (`R CMD INSTALL crates/dag-ml-data-r`) and is run from a source checkout:
#   Rscript crates/dag-ml-data-r/tools/smoke_provider.R
# It locates the shared oof_campaign fixtures relative to this script.

library(dagmldata)

args <- commandArgs(trailingOnly = FALSE)
file_arg <- grep("^--file=", args, value = TRUE)
script_dir <- if (length(file_arg) == 1) {
  dirname(normalizePath(sub("^--file=", "", file_arg)))
} else {
  getwd()
}
workspace <- normalizePath(file.path(script_dir, "..", "..", ".."))
fixtures <- file.path(workspace, "examples", "fixtures", "oof_campaign")

read_text <- function(path) paste(readLines(path, warn = FALSE), collapse = "\n")

envelope <- read_text(file.path(fixtures, "coordinator_data_plan_envelope_nir.json"))
request <- read_text(file.path(fixtures, "materialization_request_model_base_x.json"))

f64_matrices <- paste0(
  '[{"feature_set_id":"x","representation_id":"tabular_numeric",',
  '"feature_names":["f0","f1"],',
  '"observation_ids":["obs.S001.base","obs.S001.rep1","obs.S001.aug0","obs.S002.base"],',
  '"values":[1.0,10.0,2.0,20.0,3.0,30.0,4.0,40.0]}]'
)

provider <- InMemoryProvider$new(envelope, "", "", f64_matrices)

data_handle <- provider$materialize(request)
stopifnot(identical(data_handle, "1"))

view_handle <- provider$make_view(
  data_handle,
  '{"sample_ids":["S002","S001"],"include_augmented":false}'
)

features_json <- provider$feature_block(view_handle, "x")
features <- jsonlite::fromJSON(features_json, simplifyVector = FALSE)
observations <- vapply(features$observation_ids, identity, character(1))
stopifnot(identical(
  observations,
  c("obs.S002.base", "obs.S001.base", "obs.S001.rep1")
))
stopifnot(identical(
  vapply(features$feature_names, identity, character(1)),
  c("f0", "f1")
))

# A non-decimal handle is rejected with the structured descriptor.
err <- tryCatch(provider$view_identity("not-a-handle"), error = function(e) conditionMessage(e))
stopifnot(grepl("not a u64", err))

cat("dagmldata R provider smoke OK\n")
