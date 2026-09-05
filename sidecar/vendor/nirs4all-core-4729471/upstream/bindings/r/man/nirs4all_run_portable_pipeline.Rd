\name{nirs4all_run_portable_pipeline}
\alias{nirs4all_run_portable_pipeline}
\alias{nirs4all_parse_execution_plan}
\title{Execute portable nirs4all pipeline fixtures}
\usage{
nirs4all_run_portable_pipeline(source, dataset)

nirs4all_parse_execution_plan(source)
}
\arguments{
\item{source}{A JSON/YAML path, JSON/YAML text, pipeline list, or normalized
pipeline definition accepted by \code{nirs4all_load_pipeline()}.}
\item{dataset}{List containing \code{X}, \code{y}, and optionally
\code{rows}/\code{cols} or \code{n_samples}/\code{n_features}. Flat
\code{X} is interpreted as row-major.}
}
\value{
\code{nirs4all_run_portable_pipeline()} returns a list with the same contract
as the Python and WASM bindings: \code{name}, \code{rows}, \code{cols},
\code{split}, \code{preprocessing}, \code{variants}, \code{selected}, and
\code{targets}. \code{nirs4all_parse_execution_plan()} returns the parsed
execution subset.
}
\description{
Executes the portable Kennard-Stone, SNV, Savitzky-Golay, and PLS subset by
delegating to the installed \code{n4m} methods R binding. The aggregate does
not implement numerical kernels itself.
}
