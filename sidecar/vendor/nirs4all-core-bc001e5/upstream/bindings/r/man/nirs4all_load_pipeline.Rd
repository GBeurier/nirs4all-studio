\name{nirs4all_load_pipeline}
\alias{nirs4all_load_pipeline}
\alias{nirs4all_portable_class_names}
\title{Load a nirs4all JSON/YAML pipeline definition}
\usage{
nirs4all_load_pipeline(source)

nirs4all_portable_class_names(definition)
}
\arguments{
\item{source}{A direct step list, mapping with \code{pipeline} or \code{steps}, JSON/YAML path, or JSON/YAML text.}
\item{definition}{A parsed pipeline definition or step list.}
}
\value{
\code{nirs4all_load_pipeline()} returns a \code{nirs4all_pipeline_definition}
list. \code{nirs4all_portable_class_names()} returns class names in traversal
order.
}
\description{
Parses the same pipeline definition envelope as full Python
\code{nirs4all.pipeline.PipelineConfigs}, restricted to the current portable
operator subset. This validates syntax and operator declarations only; it does
not execute the pipeline.
}
