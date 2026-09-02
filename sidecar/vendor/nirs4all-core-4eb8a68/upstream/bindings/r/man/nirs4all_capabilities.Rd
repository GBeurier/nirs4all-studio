\name{nirs4all_capability_manifest}
\alias{nirs4all_capability_manifest}
\alias{nirs4all_artifact_contracts}
\alias{nirs4all_controller_capabilities}
\alias{nirs4all_required_keyword_registry_entries}
\alias{nirs4all_runtime_contracts}
\alias{nirs4all_runtime_surfaces}
\title{Inspect nirs4all portable capability metadata}
\usage{
nirs4all_capability_manifest()
nirs4all_artifact_contracts()
nirs4all_controller_capabilities()
nirs4all_required_keyword_registry_entries()
nirs4all_runtime_contracts()
nirs4all_runtime_surfaces()
}
\value{
A list describing the V1 portable runtime surfaces, controller capability rows,
runtime execution/prediction contracts, artifact contracts, required keyword
registry entries, or the complete capability manifest.
}
\description{
Returns the inspect-only capability contract used by custom hosts. Execution
still delegates to the portable methods pipeline and nirs4all-methods bindings.
}
