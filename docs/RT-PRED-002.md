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
the closed `nirs4all-core@0.3.25+libn4m-abi-2.5:<sha256>` form. Core accepts
historical N4MM v1 descriptors and content-bound N4MM v2 pipeline descriptors.
Studio always passes the caller's finite `X` matrix unchanged; Core alone
decides whether preprocessing is external or embedded and performs replay.

`npm run test:native-archive-v2` is the product gate for this path. It verifies
the attested 60,014-byte multitarget Archive V2 witness, verifies the exact
Methods library digest produced for the current target, and exercises the real
HTTP route through Core and libn4m. The gate runs on CI and on every installer,
standalone archive, and container release target; the in-memory test executor
cannot satisfy it.

This slice deliberately does not add file upload, dataset parsing, archive
discovery, fitting, or a FastAPI path. Those remain owned by their existing
boundaries.

## Next UI binding

The selected renderer does not yet expose one unambiguous UI state containing
all four required values: linked workspace id, persisted Archive V2 ref and
digest, ordered input matrix, and expected targets. A later UI slice should
bind this adapter only after that persisted selection model is frozen. It
should render the returned matrix by `sample_ids` and `target_names` and must
not translate a file or dataset into arrays inside the renderer.
