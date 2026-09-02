# Binding Contract

## Shared requirements

Every binding must:

- publish the shared upstream-domain registry from the top-level package;
- expose runtime loaders only where a real upstream binding exists for that
  host language;
- translate host-native objects to upstream contracts for gated execution paths;
- parse the shared `nirs4all` JSON/YAML pipeline definition envelope before
  handing execution to upstream runtimes;
- preserve ownership and lifetime rules across FFI boundaries;
- report unavailable upstream components explicitly;
- report full-Python tuning, conformal and robustness artifacts as
  metadata-only until binding-specific APIs and parity fixtures exist;
- expose external operators through host-language idioms only when the upstream
  execution path can actually plan or call them;
- participate in parity checks before release.

For the portable Savitzky-Golay operator, every binding normalizes the same
methods-backed SciPy boundary-mode contract: `mirror=0`, `constant=1`,
`nearest=2`, `wrap=3`, and `interp=4`. The default remains `interp` to match
the full Python nirs4all operator; explicit `mode` and `cval` values must be
preserved in the execution plan and forwarded to the upstream binding.

Rust, JavaScript/WASM, R, and MATLAB/Octave publish as `nirs4all`. That shared
name is only the package/namespace identity. The full six-domain aggregate is
metadata plus re-export/load hooks; DAG-ML local loss/metric registries are
available in R and MATLAB/Octave. The Python/JavaScript facades require the
task-bound `bind_training_loss` method, R requires `invoke_training_loss`, and
MATLAB/Octave requires `invokeTrainingLoss` before treating the registry as an
executable local-loss surface. Those hosts do not have runtime bindings for every
`formats` / `io` / `datasets` domain row.
The canonical source repository for every binding remains `nirs4all-core`.
Python publishes as `nirs4all-core`; non-Python targets publish as `nirs4all`.

The tuning, conformal and robustness artifacts currently produced by the full
Python `nirs4all` package are explicitly not portable binding execution
features in this aggregate yet. Bindings may surface them only as metadata or
externally produced files:

- `conformal.calibrated_result` identifies a stored calibrated result produced
  by full Python `nirs4all`. Its manifest row exposes
  `optional_payload_fields = ["conformal_guarantee_status",
  "calibration_replay_source", "tuning_calibration_source"]`; bindings may
  transport or display the guarantee badge, calibration replay provenance, and
  tuning calibration provenance, but must not refit, recalibrate, apply
  intervals locally, replay calibration sources, or reinterpret tuning
  provenance;
- `robustness.summary` identifies the compact `summary.json` contract for
  robustness dashboards/cards. Its manifest row exposes
  `optional_payload_fields = ["conformal_guarantee_status", "spectral_replay"]`;
  bindings may transport or display the guarantee badge and spectral replay
  provenance metadata, but must not infer either from robustness rows or replay
  spectra locally;
- `tuning.summary` identifies the compact HPO summary contract for tuning
  dashboards/cards. Its manifest row exposes
  `optional_payload_fields = ["sampler", "pruner", "seed", "persistence",
  "trials[*].diagnostics"]`; bindings may display this optimizer metadata, safe
  persistence flags and compact scalar per-trial diagnostics when present, but
  must not infer optimizer execution capability from the summary or require raw
  optimizer storage URIs;
- `tuning.ordered_search_space` identifies the ordered pre-execution search
  space preview produced by full Python `inspect_tuning_space()`,
  `NativeTuning.inspect_space()` or the `nirs4all tuning-space` CLI. Its
  manifest row requires the registry entries `run.tuning.space` and
  `run.tuning.force_params`; bindings may validate, transport or render the
  ordered parameter paths and public decoded warm-start values, but must not
  mutate pipelines, drive optimizers, reproduce Python TCV1 fingerprints
  locally, or infer runtime HPO support from this metadata;
- `keyword.registry` identifies the exported keyword/effect/value-schema
  registry and grouped public discovery constants such as
  `TUNING_OPTIMIZER_PERSISTENCE_KEYS`, `ROBUSTNESS_SCENARIO_KINDS`,
  `ROBUSTNESS_SCENARIO_DISTRIBUTIONS`, `ROBUSTNESS_MODES` and
  `ROBUSTNESS_EXECUTABLE_MODES` used by docs, forms and hosts. Its manifest row
  exposes `published_constants = { ROBUSTNESS_SCENARIO_DISTRIBUTIONS =
  ["normal", "uniform"] }`, so bindings and hosts can discover the accepted
  robustness scenario distributions without parsing prose. It also exposes
  `required_registry_entries` for the minimum entries that binding hosts must
  preserve when mirroring the registry, including `run.tuning.space` as the
  mapping/object tuning-space keyword, `run.tuning.force_params`,
  `predict.coverage`, `predict.all_predictions`, robustness scenario fields,
  `robustness.X`, `robustness.predictor` and `robustness.predictor_bundle` for
  full Python explicit-X frozen-predictor spectral robustness replay.

Bindings must not implement their own split-conformal quantile, interval
application, robustness perturbation, coverage metric, worst-slice logic, HPO
trial replay, optimizer driver, search-space canonicalizer, or TCV1 fingerprint
generator to make those rows look executable, and must not infer execution
support from the keyword registry or ordered search-space contract alone.
Promotion from metadata to execution requires upstream fixtures plus
binding-specific parity gates.

## Python

- Distribution name: `nirs4all-core`.
- Import name: `nirs4all_core`.
- Additive import facade (LOCK-GOV, see [naming](NAMING.md)): `n4a` is the
  full brand-aligned aggregate facade (`import n4a`) over `nirs4all_core`.
  `nirs4all_core.__all__` advertises the complete aggregate contract, including
  execution helpers that delegate to upstream projects.
- `read_portable_predictor_package_v2(path)` validates Archive V2 in Rust and
  returns exact DAG-ML Package V2 bytes. It is not a Python ZIP parser, package
  decoder, artifact executor, or prediction API.
- `replay_methods_archive_v2(...)` and `replay_methods_archive_v3(...)` validate
  the archive in Rust, then delegate strict request/envelope semantics and a
  fresh N4MM runtime to DAG-ML. They accept numeric Methods inputs only: no
  callback, joblib sidecar, or supplemental Python controller can cross this
  portable boundary.
- `predict_methods_archive_v2_matrix(...)` is the closed X-only product path.
  Core derives the replay contracts, requires one finalized output binding and
  one external data requirement, validates sample/target order, and loads only
  a private snapshot of the caller's SHA-256-attested libn4m after ABI 2.2
  preflight. It exposes no fit/refit, callback or fallback control.
- Framework idioms: sklearn-style estimators, `fit`/`predict`/`transform`,
  NumPy arrays, pandas data frames, and clear optional extras.
- Future external operator adapters should look like normal sklearn-compatible
  transformers or estimators when they participate in Python execution.
- Do not shadow the full Python `nirs4all` package until the core replacement
  migration is intentional. The `n4a` / `nirs4all_core` facades are additive and
  intentionally do **not** define a top-level `nirs4all` Python module.
- Keep `release_topology_manifest()` green against the package metadata before
  changing distribution names, facade imports, or the core execution boundary.

## Rust

- Crate name: `nirs4all`.
- Use `Result`-returning APIs and typed wrappers around upstream crates.
- Future external operator adapters should use traits and typed builder APIs,
  with capabilities declared at compile time or through explicit runtime feature
  checks.
- With the public DAG-ML local-registry surface,
  `local_implementation_registry::<T>()` is a thin typed facade over the
  upstream DAG-ML `LocalImplementationRegistry<T>`. Rust callers own the
  concrete callback type `T`; DAG-ML owns the loss/metric descriptors,
  validation, exact resolution and attestation semantics.
- Keep FFI handles explicit; never hide ownership transfers.
- The portable KS/SNV/Savitzky-Golay/PLS subset executes through a caller-supplied
  `libn4m` path and is covered by the shared full-Python `nirs4all` oracle.

## JavaScript/WASM

- npm package name: `nirs4all`.
- Expose typed ESM APIs and browser-safe WASM loaders.
- Future external operator adapters should be ESM functions/classes over
  browser-safe values and `TypedArray` data, with async initialization where
  WASM is required.
- The portable KS/SNV/Savitzky-Golay/PLS subset executes with
  `runPortablePipeline()` and predicts from its serialized selected model with
  `predictPortablePipeline()`, both delegating to `@nirs4all/methods`.
- `runtimeContracts` is the authoritative custom-host signal for this extra
  serialized-model predict capability. Other bindings are parity-validated for
  pipeline execution but do not expose this standalone replay-predict API yet.
- `nirs4all-web` consumes this package; UI code does not live here.
- Current upstream package candidates prefer the target scoped names
  `@nirs4all/formats-wasm`, `@nirs4all/io-wasm`,
  `@nirs4all/datasets-wasm`, and `@nirs4all/methods`.
  `dag-ml-wasm` and `dag-ml-data-wasm` remain unscoped package candidates.

## R

- Package name: `nirs4all`.
- The current R surface records the shared domains and delegates the portable
  methods subset to `n4m` / `pls4all` when installed.
- Future R controllers/adapters should expose formula/data-frame paths and S3
  methods where that is the natural R interface.
- Keep native handles opaque and expose provenance in returned objects.
- Current R package candidates include `nirs4allformats`, `nirs4allio`,
  `nirs4alldatasets`, `dagmldata`, `dagml`, and `n4m` / `pls4all` for methods.
  `nirs4all_local_implementation_registry()` delegates to the native `dagml`
  process-local registry; its methods retain the upstream R API, including
  `size()`.

## MATLAB/Octave

- Namespace: `+nirs4all`.
- Prefer matrices/tables and explicit options structs.
- Future MATLAB/Octave controllers/adapters should use function handles or small
  handle classes with `fit`/`predict`/`transform`-style methods when execution
  support exists.
- Keep Octave compatibility in the public subset unless a function is marked
  MATLAB-only.
- The portable KS/SNV/Savitzky-Golay/PLS subset executes through
  `nirs4all.runPortablePipeline()` by delegating to the `nirs4all-methods`
  `+n4m` MEX shims. The aggregate binding still owns only parsing,
  orchestration, and result-shape translation.
- `nirs4all.upstreams()` keeps metadata rows for `dag_ml`, `dag_ml_data`,
  `formats`, `io`, and `datasets`. The `dag_ml` row resolves to `+dagml`, and
  `nirs4all.localImplementationRegistry()` returns the upstream process-local
  handle whose native MATLAB/Octave inspection method is `count()`.
  `dag_ml_data`, `formats`, `io`, and `datasets` remain metadata-only because
  they have no MATLAB/Octave runtime candidate.
