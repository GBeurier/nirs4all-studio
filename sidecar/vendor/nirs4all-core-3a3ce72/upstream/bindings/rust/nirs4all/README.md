# nirs4all

Rust aggregate surface for `nirs4all-core`.

Published crate name: `nirs4all`

This crate publishes the low-level nirs4all aggregate domain registry from one
package:
`dag-ml`, `dag-ml-data`, `nirs4all-formats`, `nirs4all-io`,
`nirs4all-datasets`, and `nirs4all-methods`.

The complete six-domain surface is metadata/re-export policy. This crate does
not implement parsers, dataset loaders, DAG scheduling, or numerical methods,
and it only delegates runtime work where an upstream Rust crate or dynamic
runtime exists. Those capabilities remain owned by the upstream crates and
bindings.

For DAG-ML local criteria, use
`local_implementation_registry::<T>()`. It returns the upstream typed
`dag_ml::LocalImplementationRegistry<T>` so Rust callbacks stay process-local
while DAG-ML owns loss/metric descriptors and validation.

For the shared portable parity subset, call
`run_portable_pipeline_with_library()` with a `libn4m` path. The Rust binding
loads the C ABI dynamically and compares against the same full Python
`nirs4all` oracle as the Python, R, and JavaScript/WASM bindings.

`PortableSession::run_with_library()` can save and reload a bounded
native session export for that run. The export includes the normalized portable
definition and the selected native `N4MM` model; load it with an explicit
compatible `libn4m` path through `PortableSession::load_with_library()`, then
`predict()` replays only the declared SNV/Savitzky-Golay preprocessing and
native model prediction. It never falls back to Python or a host executor.

## Archive V1

`load_archive_v1()` and `write_archive_v1()` implement only the stored-ZIP,
native portable subset of the frozen DAG-ML archive/workspace V1 contract.
Compressed ZIP members, workspace snapshots, legacy migration, signatures, and
declared methods/host-sidecar payloads are deliberately rejected with typed
capability or format errors; this crate does not silently broaden the format.

## Archive V2 native replay and conformal presentation

`replay_methods_archive_v2()` combines an integrity-checked Archive V2 with a
typed current-cohort request and an explicit absolute `libn4m` path. Core
supplies validated package bytes; DAG-ML owns package validation, scheduling,
N4MM hydration and prediction.

For a calibrated scalar PREDICT replay,
`replay_methods_archive_v2_conformal_presentation_v1()` returns DAG-ML's
self-validating presentation, including the package, replay, calibration and
presentation fingerprints plus the exact sample order. Core does not
recalculate intervals, choose a target, load a Python host, or search sibling
checkouts for artifacts.

## License

`nirs4all` is dual-licensed under `CECILL-2.1 OR AGPL-3.0-or-later`, at your
option. The complete license texts shipped in this crate are
[`LICENSES/CECILL-2.1.txt`](LICENSES/CECILL-2.1.txt) and
[`LICENSES/AGPL-3.0-or-later.txt`](LICENSES/AGPL-3.0-or-later.txt).
