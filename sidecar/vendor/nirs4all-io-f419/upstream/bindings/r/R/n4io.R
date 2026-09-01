# SPDX-License-Identifier: CeCILL-2.1 OR AGPL-3.0-or-later

#' Normalize an input into a canonical DatasetSpec (JSON string).
#'
#' @param input_json A JSON value: a spec object, a path string (e.g.
#'   \code{'"/data/run"'}), or a file-list array (e.g. \code{'["a.csv","b.csv"]'}).
#' @param conventions_json Optional JSON array of convention names, or NULL.
#' @return The canonical DatasetSpec as a JSON string.
#' @export
n4io_to_spec <- function(input_json, conventions_json = NULL) {
  .Call("r_n4io_to_spec", input_json, conventions_json)
}

#' Inspect a data input and return the scored DatasetPlan (JSON string).
#'
#' @param input_json A JSON path string or file-list array.
#' @param conventions_json Optional JSON array of convention names, or NULL.
#' @return The DatasetPlan as a JSON string.
#' @export
n4io_infer <- function(input_json, conventions_json = NULL) {
  .Call("r_n4io_infer", input_json, conventions_json)
}

#' Materialize an input and return the assembled structural summary (JSON string).
#'
#' @param input_json A JSON value: a spec object, a path string (e.g.
#'   \code{'"/data/run"'}), or a file-list array (e.g. \code{'["a.csv","b.csv"]'}).
#' @param conventions_json Optional JSON array of convention names, or NULL.
#' @return The assembled dataset summary as a JSON string.
#' @export
n4io_load_summary <- function(input_json, conventions_json = NULL) {
  .Call("r_n4io_load_summary", input_json, conventions_json)
}

#' Validate a DatasetSpec JSON string; raises an error if invalid.
#'
#' @param spec_json A DatasetSpec as a JSON string.
#' @return Invisibly NULL on success.
#' @export
n4io_validate <- function(spec_json) {
  invisible(.Call("r_n4io_validate", spec_json))
}

#' The C ABI version string.
#' @export
n4io_abi_version <- function() {
  .Call("r_n4io_abi_version")
}
