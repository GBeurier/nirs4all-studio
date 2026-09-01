# SPDX-License-Identifier: CeCILL-2.1 OR AGPL-3.0-or-later
# Smoke test for the R binding. Runs under `R CMD check` (and manually). It
# exercises the offline-built staticlib through the C-ABI JSON surface and the
# idiomatic nio_* layer WITHOUT needing the goldens corpus, so it is CRAN-safe
# (CRAN's farm has no corpus). When N4IO_CORPUS is set (local / CI), it ALSO
# runs the richer corpus-backed checks.
library(nirs4allio)

# --- corpus-free native checks (always run; the real CRAN path) --------------

# ABI version looks like semver — proves the staticlib loaded and resolves.
stopifnot(grepl("^[0-9]+\\.[0-9]+\\.[0-9]+", n4io_abi_version()))

# Build a tiny self-contained dataset (X / Y CSVs) in a temp dir and drive the
# native to_spec / infer / validate surface against it — no external corpus.
tmp <- file.path(tempdir(), "n4io_smoke")
dir.create(tmp, showWarnings = FALSE, recursive = TRUE)
writeLines(c("id,a,b,c", "s1,1,2,3", "s2,4,5,6"), file.path(tmp, "X.csv"))
writeLines(c("id,y", "s1,10", "s2,20"), file.path(tmp, "Y.csv"))
xcsv <- file.path(tmp, "X.csv")
ycsv <- file.path(tmp, "Y.csv")

# n4io_to_spec on a JSON file-list array -> a canonical spec with schema_version.
flist_json <- jsonlite::toJSON(c(xcsv, ycsv))
spec <- n4io_to_spec(flist_json)
stopifnot(is.character(spec), grepl('"schema_version"', spec, fixed = TRUE))
stopifnot(endsWith(spec, "\n"))

# The produced spec validates.
n4io_validate(spec)

# n4io_infer returns a plan with a resolved spec.
plan <- n4io_infer(flist_json)
stopifnot(grepl('"resolved_spec"', plan, fixed = TRUE))

# n4io_load_summary runs the materialize path and returns the assembled summary.
summary_json <- n4io_load_summary(flist_json)
stopifnot(grepl('"blocks"', summary_json, fixed = TRUE), endsWith(summary_json, "\n"))

# A bad spec is rejected (error).
bad <- tryCatch({
  n4io_validate('{"partitions": {"by": "random"}}')
  FALSE
}, error = function(e) TRUE)
stopifnot(bad)

# Idiomatic layer over the same staticlib: native file-list input -> typed plan.
fl_plan <- nio_infer(c(xcsv, ycsv))
stopifnot(inherits(fl_plan, "n4io_plan"))
df <- as.data.frame(fl_plan)
stopifnot(is.data.frame(df))
stopifnot(all(c("decision", "value", "score", "ambiguous") %in% names(df)))
stopifnot(grepl("n4io_plan", format(fl_plan), fixed = TRUE))

# the plan's resolved spec is an n4io_spec that validates.
rs <- nio_resolved_spec(fl_plan)
stopifnot(inherits(rs, "n4io_spec"))
stopifnot(isTRUE(nio_validate(rs)))

summary <- nio_load(c(xcsv, ycsv))
stopifnot(is.list(summary), length(summary$blocks) >= 1L)

# Public R surface parity guard: load_summary is bytes-free JSON, so specs must
# preserve the same loading controls used by the Python and WASM surfaces when
# callers marshal them through nio_*.
policy_spec <- as.list(nio_to_spec(c(xcsv, ycsv)))
policy_spec$params <- list(
  na = list(policy = "replace", fill = list(method = "value", fill_value = 0.0)),
  format = list(columns = c("a", "b"))
)
policy_spec$sources[[1]]$params <- list(
  na = list(policy = "replace", fill = list(method = "value", fill_value = 7.5)),
  format = list(columns = c("a", "b"))
)
policy_roundtrip <- nio_to_spec(policy_spec)
stopifnot(isTRUE(nio_validate(policy_roundtrip)))
policy_list <- as.list(policy_roundtrip)
stopifnot(policy_list$params$na$policy == "replace")
stopifnot(policy_list$sources[[1]]$params$na$fill$fill_value == 7.5)
stopifnot(identical(
  unlist(policy_list$sources[[1]]$params$format$columns, use.names = FALSE),
  c("a", "b")
))

# nio_validate signals an error on a bad spec (list input).
bad2 <- tryCatch({
  nio_validate(list(partitions = list(by = "random")))
  FALSE
}, error = function(e) TRUE)
stopifnot(bad2)

# --- corpus-backed checks (only when N4IO_CORPUS is set) ----------------------

corpus <- Sys.getenv("N4IO_CORPUS")
if (nzchar(corpus)) {
  as_json_path <- function(p) paste0('"', p, '"')

  # to_spec on the train_test directory -> a canonical spec.
  cspec <- n4io_to_spec(as_json_path(file.path(corpus, "train_test")))
  stopifnot(grepl('"schema_version"', cspec, fixed = TRUE))
  n4io_validate(cspec)

  cplan <- n4io_infer(as_json_path(file.path(corpus, "single_combined")))
  stopifnot(grepl('"resolved_spec"', cplan, fixed = TRUE))

  # idiomatic layer on a native R path.
  sp <- nio_to_spec(file.path(corpus, "train_test"))
  stopifnot(inherits(sp, "n4io_spec"), sp$schema_version == 1, length(sp$sources) >= 1)
  stopifnot(isTRUE(nio_validate(sp)))
  stopifnot(grepl("n4io_spec", format(sp), fixed = TRUE))

  pl <- nio_infer(file.path(corpus, "single_combined"))
  cdf <- as.data.frame(pl)
  stopifnot("structure" %in% cdf$decision, "task_type" %in% cdf$decision)
}

cat("R binding smoke OK\n")
