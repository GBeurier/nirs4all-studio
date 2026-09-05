% Please edit documentation in R/idiomatic.R
\name{nio_load}
\alias{nio_load}
\title{Materialize a native R input into an assembled structural summary.}
\usage{
nio_load(input, conventions = NULL, limits = NULL)
}
\arguments{
\item{input}{A path (character scalar), a vector of files (character vector),
or a config \code{list} / \code{n4io_spec}.}

\item{conventions}{Optional character vector of convention names, or
\code{NULL}.}
\item{limits}{Host resource budgets as a named list, \code{NULL} for defaults,
or \code{"unlimited"} for explicitly trusted inputs. See docs/API.md.}
}
\value{
The parsed assembled summary as a list.
}
\description{
Native-R wrapper over \code{\link[=n4io_load_summary]{n4io_load_summary()}}: \code{input} is JSON-encoded
internally and the assembled summary is parsed back into a plain R list.
}
\seealso{
\code{\link[=n4io_load_summary]{n4io_load_summary()}} for the raw JSON surface.
}
