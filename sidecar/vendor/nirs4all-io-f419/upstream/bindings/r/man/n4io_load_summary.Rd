% Please edit documentation in R/n4io.R
\name{n4io_load_summary}
\alias{n4io_load_summary}
\title{Materialize an input and return the assembled structural summary (JSON string).}
\usage{
n4io_load_summary(input_json, conventions_json = NULL)
}
\arguments{
\item{input_json}{A JSON value: a spec object, a path string (e.g.
\code{'"/data/run"'}), or a file-list array (e.g. \code{'["a.csv","b.csv"]'}).}

\item{conventions_json}{Optional JSON array of convention names, or NULL.}
}
\value{
The assembled dataset summary as a JSON string.
}
\description{
Materialize an input and return the assembled structural summary (JSON string).
}
