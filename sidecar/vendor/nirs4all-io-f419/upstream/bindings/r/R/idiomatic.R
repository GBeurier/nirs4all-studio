# SPDX-License-Identifier: CeCILL-2.1 OR AGPL-3.0-or-later

# Idiomatic R layer over the low-level n4io_* JSON surface.
#
# The C ABI is JSON-string in / JSON-string out (see n4io.R). This file adds a
# native-R surface: callers pass a path, a vector of files, or a config list and
# get back a typed S3 object (`n4io_plan` / `n4io_spec`) with print/format and
# as.data.frame / as.list methods. JSON <-> R conversion is done with jsonlite;
# the low-level n4io_* functions remain exported for the JSON contract.

# Null-coalescing helper used throughout this file.
`%||%` <- function(a, b) if (is.null(a)) b else a

# --- native input -> the JSON value the C ABI expects --------------------------

# The canonical JSON string carried by a typed object (stored as the `.json`
# attribute by .nio_parse), or NULL for anything else.
.nio_json <- function(x) attr(x, ".json", exact = TRUE)

# Encode a native R input (a path scalar, a character vector of files, or a
# config list/spec) into the single JSON value n4io_to_spec / n4io_infer accept:
# a quoted string (path), a JSON array (file list), or a JSON object (spec).
.nio_input_json <- function(input) {
  if (inherits(input, "n4io_spec")) {
    return(.nio_json(input) %||% jsonlite::toJSON(unclass(input), auto_unbox = TRUE, null = "null"))
  }
  if (is.character(input)) {
    if (length(input) == 1L) {
      return(jsonlite::toJSON(input, auto_unbox = TRUE))
    }
    return(jsonlite::toJSON(input, auto_unbox = FALSE))
  }
  if (is.list(input)) {
    return(jsonlite::toJSON(input, auto_unbox = TRUE, null = "null"))
  }
  stop("input must be a path (character scalar), a file list (character vector), or a config list", call. = FALSE)
}

# Encode conventions (a character vector or NULL) into the JSON array argument.
.nio_conventions_json <- function(conventions) {
  if (is.null(conventions)) {
    return(NULL)
  }
  if (!is.character(conventions)) {
    stop("conventions must be a character vector or NULL", call. = FALSE)
  }
  jsonlite::toJSON(conventions, auto_unbox = FALSE)
}

# Parse a JSON string returned by the ABI into an R list, preserving the
# original string so it can be re-marshalled byte-for-byte across the ABI.
.nio_parse <- function(json) {
  parsed <- jsonlite::fromJSON(json, simplifyVector = FALSE)
  attr(parsed, ".json") <- json
  parsed
}

# --- idiomatic entry points ----------------------------------------------------

#' Infer a scored dataset plan from a native R input.
#'
#' Native-R wrapper over [n4io_infer()]: \code{input} is JSON-encoded internally
#' (with jsonlite) and the scored \code{DatasetPlan} is parsed back into a typed
#' \code{n4io_plan} object.
#'
#' @param input A path (character scalar), a vector of files (character vector),
#'   or a config \code{list}.
#' @param conventions Optional character vector of convention names, or
#'   \code{NULL} for the binding default.
#' @return An object of class \code{n4io_plan}: the parsed plan (recommendations,
#'   scored decisions, \code{resolved_spec}, \code{overall_score}). Use
#'   \code{\link{as.data.frame.n4io_plan}} for the scored decisions as a
#'   data.frame and \code{\link{nio_resolved_spec}} for the editable spec.
#' @seealso [n4io_infer()] for the raw JSON surface.
#' @examples
#' \dontrun{
#' plan <- nio_infer("/data/run")
#' print(plan)
#' as.data.frame(plan)          # one row per scored decision
#' spec <- nio_resolved_spec(plan)
#' }
#' @export
nio_infer <- function(input, conventions = NULL) {
  json <- n4io_infer(.nio_input_json(input), .nio_conventions_json(conventions))
  structure(.nio_parse(json), class = "n4io_plan")
}

#' Normalize a native R input into a canonical DatasetSpec.
#'
#' Native-R wrapper over [n4io_to_spec()]: \code{input} is JSON-encoded
#' internally and the canonical \code{DatasetSpec} is parsed back into a typed
#' \code{n4io_spec} object that round-trips byte-for-byte across the ABI.
#'
#' @param input A path (character scalar), a vector of files (character vector),
#'   or a config \code{list}.
#' @param conventions Optional character vector of convention names, or
#'   \code{NULL}.
#' @return An object of class \code{n4io_spec}: the parsed canonical spec. Pass
#'   it directly to [nio_validate()] or [nio_infer()].
#' @seealso [n4io_to_spec()] for the raw JSON surface.
#' @examples
#' \dontrun{
#' spec <- nio_to_spec("/data/run")
#' print(spec)
#' nio_validate(spec)
#' }
#' @export
nio_to_spec <- function(input, conventions = NULL) {
  json <- n4io_to_spec(.nio_input_json(input), .nio_conventions_json(conventions))
  structure(.nio_parse(json), class = "n4io_spec")
}

#' Materialize a native R input into an assembled structural summary.
#'
#' Native-R wrapper over [n4io_load_summary()]: \code{input} is JSON-encoded
#' internally and the assembled summary is parsed back into a plain R list.
#'
#' @param input A path (character scalar), a vector of files (character vector),
#'   or a config \code{list} / \code{n4io_spec}.
#' @param conventions Optional character vector of convention names, or
#'   \code{NULL}.
#' @return The parsed assembled summary as a list.
#' @seealso [n4io_load_summary()] for the raw JSON surface.
#' @export
nio_load <- function(input, conventions = NULL) {
  json <- n4io_load_summary(.nio_input_json(input), .nio_conventions_json(conventions))
  .nio_parse(json)
}

#' Validate a DatasetSpec.
#'
#' Native-R wrapper over [n4io_validate()] that accepts an \code{n4io_spec}, a
#' plain \code{list}, or a JSON string. Returns invisibly \code{TRUE} on success
#' and signals an informative error otherwise.
#'
#' @param spec An \code{n4io_spec}, a \code{list}, or a JSON string.
#' @return Invisibly \code{TRUE} on success; otherwise an error is signalled.
#' @seealso [n4io_validate()] for the raw JSON surface.
#' @examples
#' \dontrun{
#' spec <- nio_to_spec("/data/run")
#' nio_validate(spec)
#' }
#' @export
nio_validate <- function(spec) {
  json <- if (inherits(spec, "n4io_spec")) {
    .nio_json(spec) %||% jsonlite::toJSON(unclass(spec), auto_unbox = TRUE, null = "null")
  } else if (is.character(spec) && length(spec) == 1L) {
    spec
  } else if (is.list(spec)) {
    jsonlite::toJSON(spec, auto_unbox = TRUE, null = "null")
  } else {
    stop("spec must be an n4io_spec, a list, or a JSON string", call. = FALSE)
  }
  n4io_validate(json)
  invisible(TRUE)
}

#' The resolved (editable) DatasetSpec carried inside a plan.
#'
#' @param plan An \code{n4io_plan} from [nio_infer()].
#' @return An \code{n4io_spec} object built from \code{plan$resolved_spec}.
#' @export
nio_resolved_spec <- function(plan) {
  if (!inherits(plan, "n4io_plan")) {
    stop("plan must be an n4io_plan from nio_infer()", call. = FALSE)
  }
  spec_list <- plan$resolved_spec
  json <- jsonlite::toJSON(spec_list, auto_unbox = TRUE, null = "null")
  structure(.nio_parse(json), class = "n4io_spec")
}

# --- S3 methods ----------------------------------------------------------------

# Is `x` a scored decision object `{value, score, evidence, alternatives, ambiguous}`?
.nio_is_decision <- function(x) {
  is.list(x) && all(c("value", "score", "ambiguous") %in% names(x))
}

# The scored decisions of a plan, as a list of (kind, decision) pairs.
.nio_plan_decisions <- function(plan) {
  keep <- vapply(plan, .nio_is_decision, logical(1))
  plan[keep]
}

#' Scored decisions of a plan as a data.frame.
#'
#' One row per scored decision (structure, signal type, task type, ...), with the
#' chosen \code{value}, the confidence \code{score}, whether it is
#' \code{ambiguous}, and the count of \code{alternatives}.
#'
#' @param x An \code{n4io_plan}.
#' @param ... Ignored.
#' @return A data.frame with columns \code{decision}, \code{value},
#'   \code{score}, \code{ambiguous}, \code{n_alternatives}.
#' @exportS3Method as.data.frame n4io_plan
as.data.frame.n4io_plan <- function(x, ...) {
  decisions <- .nio_plan_decisions(x)
  if (length(decisions) == 0L) {
    return(data.frame(
      decision = character(0), value = character(0), score = numeric(0),
      ambiguous = logical(0), n_alternatives = integer(0),
      stringsAsFactors = FALSE
    ))
  }
  data.frame(
    decision = names(decisions),
    value = vapply(decisions, function(d) as.character(d$value %||% NA), character(1)),
    score = vapply(decisions, function(d) as.numeric(d$score %||% NA), numeric(1)),
    ambiguous = vapply(decisions, function(d) isTRUE(d$ambiguous), logical(1)),
    n_alternatives = vapply(decisions, function(d) length(d$alternatives), integer(1)),
    row.names = NULL,
    stringsAsFactors = FALSE
  )
}

#' @exportS3Method as.list n4io_plan
as.list.n4io_plan <- function(x, ...) {
  attr(x, ".json") <- NULL
  unclass(x)
}

#' @exportS3Method as.list n4io_spec
as.list.n4io_spec <- function(x, ...) {
  attr(x, ".json") <- NULL
  unclass(x)
}

#' @exportS3Method format n4io_plan
format.n4io_plan <- function(x, ...) {
  df <- as.data.frame(x)
  lines <- c(
    sprintf("<n4io_plan> overall_score=%s", format(x$overall_score %||% NA)),
    if (nrow(df) > 0L) {
      apply(df, 1L, function(r) {
        sprintf(
          "  %-12s %-18s score=%-5s%s",
          r[["decision"]], r[["value"]], r[["score"]],
          if (isTRUE(as.logical(r[["ambiguous"]]))) " (ambiguous)" else ""
        )
      })
    },
    {
      recs <- x$recommendations
      if (length(recs) > 0L) c("recommendations:", paste0("  - ", unlist(recs)))
    },
    {
      warns <- x$warnings
      if (length(warns) > 0L) c("warnings:", paste0("  - ", unlist(warns)))
    }
  )
  paste(lines, collapse = "\n")
}

#' @exportS3Method print n4io_plan
print.n4io_plan <- function(x, ...) {
  cat(format(x), "\n", sep = "")
  invisible(x)
}

#' @exportS3Method format n4io_spec
format.n4io_spec <- function(x, ...) {
  sources <- x$sources %||% list()
  lines <- c(
    sprintf(
      "<n4io_spec> name=%s schema_version=%s sources=%d",
      x$name %||% "<unnamed>", x$schema_version %||% NA, length(sources)
    ),
    vapply(sources, function(s) {
      sprintf(
        "  %-10s role=%-9s partition=%-8s input=%s",
        s$id %||% "?", s$role %||% "?", s$partition %||% "-", s$input %||% "?"
      )
    }, character(1))
  )
  paste(lines, collapse = "\n")
}

#' @exportS3Method print n4io_spec
print.n4io_spec <- function(x, ...) {
  cat(format(x), "\n", sep = "")
  invisible(x)
}
