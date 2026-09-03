\name{nirs4all_local_implementation_registry}
\alias{nirs4all_local_implementation_registry}
\title{Create a DAG-ML local implementation registry}
\usage{
nirs4all_local_implementation_registry()
}
\value{
The process-local registry returned by
\code{dagml::dagml_local_implementation_registry()}.
}
\description{
Delegates registry construction to the installed \pkg{dagml} package. The
registry retains local R loss and metric functions without serializing them.
}
