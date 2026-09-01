# R Binding

R package name: `nirs4all`

The canonical source repository is `nirs4all-core`; the R publication uses the
bare `nirs4all` name as the R aggregate surface. Python alone uses the
`nirs4all-core` distribution name to avoid colliding with the full modelling
library.

The R package publishes the aggregate registry and delegates only to upstream R
bindings that exist and are installed. `nirs4all_local_implementation_registry()`
delegates to the upstream `dagml` package so R functions can be registered as
process-local losses or metrics. Future formula/data-frame controllers remain
gated on upstream DAG-ML execution paths.

The portable execution gate is available as
`nirs4all_run_portable_pipeline()`. It delegates Kennard-Stone, SNV,
Savitzky-Golay, and PLS to the installed `n4m` methods binding and is validated
against the same full Python `nirs4all` oracle as the Python and WASM bindings.
Savitzky-Golay defaults to `mode = "interp"` for full nirs4all parity and
preserves explicit methods-backed modes plus `cval`.

`nirs4all_runtime_contracts()` separates portable pipeline execution from
standalone serialized-model prediction. The R binding is parity-validated for
pipeline execution, but does not expose the WASM `predictPortablePipeline()`
replay contract yet.
