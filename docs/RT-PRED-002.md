# Renderer Archive V2 prediction adapter

RT-PRED-002 exposes the selected native prediction route to renderer code
without adding a second scientific implementation.

`predictPersistedArchiveV2Array()` in
`src/api/archiveV2Prediction.ts` accepts only:

- an already-linked Studio workspace id;
- a relative `.n4a` reference already persisted below that workspace's
  `exports/` directory, with its lowercase SHA-256;
- a bounded finite array, ordered sample ids, and ordered expected targets;
- the literal `core_rust_methods` engine with fallback disabled.

Electron preselects `POST /predict/archive-v2` only when the Rust sidecar
advertises `native_archive_v2_prediction=true`. The route does not require or
acquire the explicit CPython plugin host. Query or method drift is refused as a
native contract mismatch, and the client validates response identity, order,
shape, finiteness, fallback state, and workspace/archive provenance.
It reads at most 2 MiB of raw response bytes before JSON parsing, regardless of
whether `Content-Length` is present or truthful. The executor identity must be
the closed `nirs4all-core@0.3.28+libn4m-abi-2.5:<sha256>` form. Core accepts
historical N4MM v1 descriptors and content-bound N4MM v2 pipeline descriptors.
Studio always passes the caller's finite `X` matrix unchanged; Core alone
decides whether preprocessing is external or embedded and performs replay.

The spectral width limit is **8,192 features**, shared with native training and
archive catalogue validation. A prediction batch remains bounded to 128 samples,
1,000,000 cells and 32 MiB of encoded JSON; the response remains limited to
2 MiB. The expanded request budget accommodates ordinary decimal encodings of
the accepted matrices. The former 256-feature/64-KiB limits rejected models
that the same product could train. This is a compatibility correction, not a
change to archive identity, allowed fields, provenance or fallback policy.
Rust's shared limits live in `sidecar/src/matrix_limits.rs`; the renderer and
`studio_archive_v2_prediction_v1.json` mirror this contract. Regression tests
cover a real 300-feature train/catalogue/predict cycle and 8,192-feature request
and catalogue validation.

`npm run test:native-archive-v2` is the product gate for this path. It verifies
the attested 60,014-byte multitarget Archive V2 witness, verifies the exact
Methods library digest produced for the current target, and exercises the real
HTTP route through Core and libn4m. The gate runs on CI and on every installer,
standalone archive, and container release target; the in-memory test executor
cannot satisfy it.

This slice deliberately does not add file upload, dataset parsing, archive
discovery, fitting, or a FastAPI path. Those remain owned by their existing
boundaries.

## UI binding and readiness

The Predict page binds the persisted workspace/archive identity, raw input
matrix and ordered target names. It validates the persisted selection again
before submission and renders predictions and optional conformal intervals by
sample and target identity, including a readable table.

The page uses `native_prediction_ready` from the Rust readiness endpoint, not
the optional Python host's ML-ready flag. Electron and web clients poll this
capability independently; a lost connection disables it again. An unavailable
capability displays a configuration message, rather than an empty overlay.
`native_training_ready` is reported separately. Restoring an empty workspace
catalogue completes workspace startup; it does not imply that a workspace has
been selected or that all scientific operations are available.
