# Rust Binding

The Rust crate is named `nirs4all`. It composes the upstream Rust crates and
FFI-backed engines without moving their implementation into this repository.
The canonical source repository is `nirs4all-core`; the crate publishes under
the bare `nirs4all` name as the Rust aggregate surface. Python alone uses the
`nirs4all-core` distribution name to avoid colliding with the full modelling
library.

The portable KS/SNV/Savitzky-Golay/PLS subset is exposed through
`run_portable_pipeline_with_library()`, which loads a caller-supplied `libn4m`
and delegates split, preprocessing, and PLS calls to `nirs4all-methods`.
Savitzky-Golay defaults to `mode="interp"` for full nirs4all parity and
preserves explicit methods-backed modes plus `cval`.
