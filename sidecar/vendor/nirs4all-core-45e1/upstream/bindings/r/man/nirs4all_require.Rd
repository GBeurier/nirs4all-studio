\name{nirs4all_require}
\alias{nirs4all_require}
\title{Load an upstream nirs4all binding}
\usage{
nirs4all_require(name)
}
\arguments{
\item{name}{Upstream key such as \code{"formats"} or \code{"methods"}.}
}
\value{
The loaded namespace for the first installed candidate package.
}
\description{
Loads an upstream binding by key or fails with a diagnostic listing the tried
candidate packages.
}
