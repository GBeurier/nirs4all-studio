# JavaScript/WASM Binding

npm package name: `nirs4all`

The canonical source repository is `nirs4all-core`; the npm publication uses
the bare `nirs4all` name as the JavaScript/WASM aggregate surface. Python alone
uses the `nirs4all-core` distribution name to avoid colliding with the full
modelling library.

This package is the runtime surface that `nirs4all-web` should consume. The web
application lives in `nirs4all-web`; this directory is for the reusable
JavaScript/WASM binding and package metadata.

The portable execution API delegates Kennard-Stone, SNV, Savitzky-Golay, and
PLS component sweeps to `@nirs4all/methods`:

- `runPortablePipeline(source, dataset)` parses the shared nirs4all JSON/YAML
  syntax, executes the portable subset, and returns parity-checkable split,
  target, variant, and selected-result fields plus a serialized selected PLS
  model.
- `predictPortablePipeline(result, dataset)` replays the recorded preprocessing
  chain and predicts with that serialized model through the same methods WASM
  backend.
- `replayMethodsArchiveV2(archiveBytes, dataset)` validates the bounded Archive
  V2 stored-ZIP, manifest, inventory digests, DAG-ML package, execution bundle,
  and N4MM binding in Rust, then imports and predicts the single multi-target
  model through the public `@nirs4all/methods` C ABI. The native file reader and
  WASM byte reader compile the same Core-owned `archive_v2.rs` validation source;
  there is no second binding-owned archive parser. The JavaScript layer only
  validates host arrays and handles marshalling/ownership; it contains no
  numerical fallback and never fits a replacement model.

The Archive V2 WASM replay intentionally covers the Phase 2 portable Methods
PLS final-refit contract only. Archives with preprocessing, multiple predictor
nodes, optimization checkpoints, conformal/robustness payloads, external or
host-only artifacts, undeclared inventory members, incompatible N4MM metadata,
or non-Methods dispatch are refused rather than silently approximated.

Build the Rust validator with `npm run build:native`. A qualification archive
and closed scenario can be replayed with:

```sh
npm run qualify:archive-v2 -- /path/to/archive.n4a /path/to/scenario.json
```

The qualification command asserts the ordered two-dimensional result from one
model import and one multi-target prediction, checks that no Methods fit symbol
was called, and proves tampered-digest and inventory refusals. The isolated
tarball gate separately proves refusal when the optional Methods peer is absent.

Savitzky-Golay defaults to `mode: "interp"` for full nirs4all parity and
preserves explicit methods-backed modes (`mirror`, `constant`, `nearest`,
`wrap`, `interp`) plus `cval` in the serialized preprocessing chain.

Custom app hosts can inspect `capabilityManifest()`, `controllerCapabilities`,
`runtimeSurfaces`, and `runtimeContracts` before rendering graph nodes or
selecting a runtime. The manifest schema is `nirs4all-core.capabilities.v1`; it
exposes the stable V1 controller IDs for Kennard-Stone, SNV, Savitzky-Golay,
PLS regression, and the portable methods pipeline, with parameter lists
matching the executable parser. `runtimeContracts` also makes explicit that
standalone serialized-model prediction is currently a WASM-only contract.

For a browser-only custom host, pair this package with `nirs4all-ui`: keep
runtime loading and portable execution in `nirs4all`, and consume shared React
components / view-model helpers / brand assets from `nirs4all-ui`. The
reference composition lives in the `nirs4all-web` browser app, whose contract
tests exercise `runPortablePipeline()` / `predictPortablePipeline()` together
with the shared UI package in a no-backend environment.
