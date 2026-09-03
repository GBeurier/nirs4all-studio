# Capability Matrix

This page reports, honestly, what each language binding of the nirs4all aggregate
(shipping as `nirs4all-core` in Python and `nirs4all` elsewhere) can actually
*do* — not what it advertises. The capability vocabulary is the ladder defined in
[`OPERATORS.md`](OPERATORS.md):

`metadata` → `plan` → `execute-local` → `execute-remote` → `parity-validated`.

The machine-readable source of truth is [`compat/capabilities.toml`](../compat/capabilities.toml).
Every claim below is enforced against the binding sources and parity gate files
by `bindings/python/tests/test_capability_matrix.py`, so the table cannot
over-claim: a binding may not say `execute-local` without a real run symbol, nor
`parity-validated` without a real parity gate.

## Custom app host manifest

Custom hosts (`nirs4all-web`, Studio, `nirs4all-ui` consumers, and bespoke
browser/desktop shells) can inspect the portable controller contract without
duplicating local rules:

- Python: `nirs4all_core.capability_manifest()`,
  `nirs4all_core.controller_capabilities()`,
  `nirs4all_core.runtime_surfaces()`,
  `nirs4all_core.runtime_contracts()`, and
  `nirs4all_core.artifact_contracts()`; the same surface is exported through
  the additive `n4a` facade.
- JavaScript/WASM: `capabilityManifest()`, `controllerCapabilities`, and
  `runtimeSurfaces` / `runtimeContracts` / `artifactContracts` from the
  `nirs4all` package.
- R: `nirs4all_capability_manifest()`,
  `nirs4all_controller_capabilities()`, `nirs4all_runtime_surfaces()`,
  `nirs4all_runtime_contracts()`, and `nirs4all_artifact_contracts()`.
- Rust: `capability_manifest()`, `CONTROLLER_CAPABILITIES`, and
  `RUNTIME_SURFACES` / `RUNTIME_CONTRACTS` / `ARTIFACT_CONTRACTS` from the
  `nirs4all` crate.
- MATLAB/Octave: `nirs4all.capabilityManifest()`,
  `nirs4all.controllerCapabilities()`, `nirs4all.runtimeSurfaces()`, and
  `nirs4all.runtimeContracts()` / `nirs4all.artifactContracts()`.

The manifest schema is `nirs4all-core.capabilities.v1`. Its controller IDs are
stable for the V1 portable subset:

| Controller | Kind | Runtime path | Public parameters |
| --- | --- | --- | --- |
| `split.kennard_stone` | splitter | `portable_pipeline` | `test_size` |
| `preprocess.snv` | transform | `portable_pipeline` | none |
| `preprocess.savgol` | transform | `portable_pipeline` | `window_length`, `polyorder`, `deriv`, `mode`, `cval` |
| `model.pls_regression` | model | `portable_pipeline` | `n_components`, `_range_` |
| `pipeline.portable_methods` | pipeline | `run_portable_pipeline` | none |

Those parameter lists intentionally match the executable parsers today; they are
not future placeholders. The Python gate compares the API against the TOML
ledger, verifies full operator coverage, and requires every runtime surface to
carry an explicit capability level.

The runtime contract also separates two promises that custom app hosts must not
merge accidentally:

| Runtime | Portable pipeline execution | Serialized selected-model prediction |
| --- | --- | --- |
| Python | `parity-validated` via `run_portable_pipeline()` | not exposed |
| R | `parity-validated` via `nirs4all_run_portable_pipeline()` | not exposed |
| JavaScript/WASM | `parity-validated` via `runPortablePipeline()` | `parity-validated` via `predictPortablePipeline()` |
| Rust | `parity-validated` via `run_portable_pipeline_with_library()` | not exposed |
| MATLAB/Octave | `parity-validated` via `nirs4all.runPortablePipeline()` | not exposed |

Only JavaScript/WASM currently exposes a standalone API that hydrates the
serialized selected model from a previous run and predicts on a later dataset.
The other bindings remain parity-validated for executing the portable pipeline,
but a host must rerun the pipeline or use a language-specific model object
there; it must not infer a cross-runtime replay-predict API from the controller
level alone.

## Portable operator subset

The aggregate itself executes exactly one operator subset — Kennard-Stone split,
SNV, Savitzky-Golay, and PLS regression — and it does so by **delegating all
numerics to the `methods` upstream** (`nirs4all-methods` / `libn4m` / `+n4m` /
`n4m`). It never re-implements a kernel. The same nine class aliases are
declared identically in all five bindings (proven by
`test_cross_language_surface.py`).

| Language | Level | Run entry point | Numerics reached via | Parity gate |
| --- | --- | --- | --- | --- |
| Python | `parity-validated` | `run_portable_pipeline()` | nirs4all-methods Python (`n4m`/`pls4all`) | `bindings/python/tests/test_execution_parity.py` |
| Rust | `parity-validated` | `run_portable_pipeline_with_library()` | caller-supplied `libn4m` (`NIRS4ALL_METHODS_LIB`) | `cargo test` `rust_binding_execution_matches_full_python_nirs4all_oracle` |
| JavaScript/WASM | `parity-validated` | `runPortablePipeline()` plus standalone `predictPortablePipeline()` | `@nirs4all/methods` | `bindings/wasm/tests/parity.test.js` |
| R | `parity-validated` | `nirs4all_run_portable_pipeline()` | nirs4all-methods R (`n4m`/`pls4all`) | `bindings/r/tests/parity.R` |
| MATLAB/Octave | `parity-validated` | `nirs4all.runPortablePipeline()` | `+n4m` MATLAB/Octave MEX shims | `bindings/matlab/tests/parity.m` |

"`parity-validated`" here is **conditional on the `methods` upstream being
present**. Without it, every binding degrades honestly:

- the parser/inspection surface (`load_pipeline_definition`,
  `portable_class_names`, `parse_execution_plan`) still works — this is the
  `plan` level;
- the run entry point raises a clear "capability unavailable" style error
  (e.g. R's "does not expose …", MATLAB's `nirs4all:MissingMethods`, the Rust
  loader error, the strict-parity skip guarded by
  `NIRS4ALL_CORE_REQUIRE_METHODS_PARITY`), never a silent local re-implementation.

The shared numeric oracle is
`tests/parity/expected/portable_python_oracle.json`, generated from the full
Python `nirs4all` library (see [`PARITY.md`](PARITY.md)).

## Upstream domains

The other upstream domains — `formats`, `io`, `datasets`, `dag_ml`,
`dag_ml_data` — are re-exported through **lazy import proxies/loaders only**. The
aggregate does not wrap or execute their operators, so its own capability over
them is `metadata`; the real execution capability is whatever the installed
upstream provides. This is recorded as `metadata` rather than dressed up as
aggregate execution.

This metadata is shared across package names, but runtime candidates are
language-specific. R declares `dagml` and MATLAB/Octave declares `+dagml` for
process-local loss/metric registries. Their remaining metadata-only rows must
not be read as npm/WASM package names or host-language runtime support.

| Domain | Aggregate level | Notes |
| --- | --- | --- |
| `formats` | `metadata` | lazy re-export; execution = upstream-provided |
| `io` | `metadata` | lazy re-export; execution = upstream-provided |
| `datasets` | `metadata` | optional/external; lazy re-export |
| `dag_ml` | `metadata` | lazy re-export plus host-local registry delegation |
| `dag_ml_data` | `metadata` | lazy re-export; execution = upstream-provided |

## Native tuning, conformal and robustness artifacts

The full Python `nirs4all` package now owns the first native conformal and
robustness artifact contracts, plus the lightweight native HPO/tuning summary
and ordered search-space contracts. `nirs4all-core` records those contracts in
[`compat/capabilities.toml`](../compat/capabilities.toml), but does not expose
them as executable aggregate features yet.

| Contract | Producer today | Binding level in nirs4all-core | Allowed consumer behavior |
| --- | --- | --- | --- |
| `conformal.calibrated_result` (`nirs4all.dagml.conformal_store.v1`) | full Python `nirs4all.calibrate()` / `predict_calibrated()` | `metadata` for Python, R, JavaScript/WASM, Rust, MATLAB/Octave | Transport or display optional `conformal_guarantee_status`, `calibration_replay_source`, and `tuning_calibration_source` provenance when present; do not reimplement conformal quantiles, interval application, refit, recalibration, calibration replay, or tuning provenance interpretation. |
| `robustness.summary` (`https://nirs4all.org/schemas/robustness-summary/v1`) | full Python `RobustnessReport.summary_artifact()` / `summary.json` | `metadata` for Python, R, JavaScript/WASM, Rust, MATLAB/Octave | Render or transport a validated summary card, including optional `conformal_guarantee_status` and `spectral_replay` provenance, when a host already receives the JSON; do not recompute robustness metrics, replay spectra or infer conformal guarantees from summary rows. |
| `tuning.summary` (`https://nirs4all.org/schemas/tuning-summary/v1`) | full Python `TuningResult.summary_artifact()` / `tuning-summary.json` | `metadata` for Python, R, JavaScript/WASM, Rust, MATLAB/Octave | Render or transport a validated HPO card, including optional optimizer metadata `sampler`, `pruner`, `seed`, safe `persistence` flags and compact scalar `trials[*].diagnostics`, when a host already receives the JSON; do not drive optimizers, replay trials, infer native tuning execution, or require raw optimizer storage URIs. |
| `tuning.ordered_search_space` (`https://nirs4all.org/schemas/tuning-ordered-search-space/v1`) | full Python `inspect_tuning_space()` / `NativeTuning.inspect_space()` / `nirs4all tuning-space` | `metadata` for Python, R, JavaScript/WASM, Rust, MATLAB/Octave | Validate, transport or render an ordered pre-execution search-space preview, including `run.tuning.space` paths and `run.tuning.force_params` subset checks; do not mutate pipelines, drive optimizers, reproduce Python TCV1 fingerprints locally or infer native tuning execution from the preview. |
| `keyword.registry` (`nirs4all.keyword_registry.v1`) | full Python `nirs4all.get_keyword_registry()` / `keyword_registry_json()` / `TUNING_OPTIMIZER_PERSISTENCE_KEYS` / `ROBUSTNESS_SCENARIO_KINDS` / `ROBUSTNESS_STOCHASTIC_SCENARIO_KINDS` / `ROBUSTNESS_SCENARIO_DISTRIBUTIONS` / `ROBUSTNESS_MODES` / `ROBUSTNESS_EXECUTABLE_MODES` | `metadata` for Python, R, JavaScript/WASM, Rust, MATLAB/Octave | Discover keywords, value schemas, UI hints, invalidation effects and grouped public discovery constants; read `published_constants.ROBUSTNESS_SCENARIO_DISTRIBUTIONS = ["normal", "uniform"]` for the currently published distribution values; preserve the manifest's `required_registry_entries` such as `run.tuning.space`, `run.tuning.force_params`, `predict.coverage`, robustness scenario fields, `robustness.X`, `robustness.predictor` and `robustness.predictor_bundle`; do not infer runtime execution capability from registry presence alone. |

This distinction is intentional. The aggregate cannot claim a conformal or
robustness binding, or a native HPO/tuning execution binding, until the upstream
fixtures, schemas, host-language API, and round-trip parity gates exist for that
binding. Until then, app hosts should
display these rows as unavailable or externally produced evidence, not as
native `nirs4all-core` execution capability.

`required_registry_entries` is a metadata compatibility floor for app hosts and
bindings that mirror the full Python keyword registry. It is not a schema copy
and it is not an execution claim. In particular, `run.tuning.space` must remain
the object/mapping form consumed by full Python `run(tuning=...)` and
`NativeTuning(space=...)`, and `run.tuning.force_params` must remain a public
decoded warm-start hint rather than an optimizer implemented by `nirs4all-core`.
`robustness.X`, `robustness.predictor`, and `robustness.predictor_bundle` are
likewise metadata keys for full Python `nirs4all.robustness()` explicit-X
frozen-predictor replay. nirs4all-core hosts may preserve or display the keys
but must not claim local spectral robustness execution or serialize a Python
predictor object across bindings.

`published_constants` is intentionally narrower: it pins concrete public
constant values that metadata-only bindings need for forms and validation
without importing full Python. The first published value is
`ROBUSTNESS_SCENARIO_DISTRIBUTIONS = ["normal", "uniform"]`, aligned with the
full Python robustness registry and the shared UI scenario helpers.

The ordered search-space contract is also metadata-only. It is useful before a
run to show canonical order, public patch paths and optional decoded
`force_params`, but final TCV1 fingerprints, canonicalization and optimizer
semantics remain owned by full Python `nirs4all`.

## Why this matters for the release

The RC stop condition is explicit: *do not fake unsupported execution in a
language binding; report capability levels honestly.* This matrix + the
enforcement test are that guarantee. If a future change adds, say, a browser
`execute-remote` path or a new operator, the ledger and its test must be updated
in lockstep, and the test will fail until the claim is backed by a real symbol
and gate.
