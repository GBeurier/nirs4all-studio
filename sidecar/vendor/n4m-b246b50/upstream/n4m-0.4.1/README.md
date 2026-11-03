# n4m Rust binding

This is the official Rust binding for the stable `libn4m` C ABI. It is a thin
ownership/serialization layer: numerical fitting and optimizer logic stay in
`libn4m`. `Context`, `SearchSpace`, and `Optimizer` are `!Send + !Sync`; create
one `Context` per thread. `SearchSpace` maps all native typed axes and
constraints; `Optimizer` exposes native ask/ask-batch/tell/intermediate/best,
borrowed `Trial` accessors, and owning rich `TrialSnapshot` traces. Batch errors
retain every committed borrowed trial in `AskBatchError::Partial`.

`Pipeline::snv_savgol` and `Config::set_snv_savgol_pipeline` provide the safe,
owning Rust path for the bounded native SNV-to-Savitzky-Golay pipeline; the
opaque pipeline handle remains alive through every `Model::fit` call and is
released with its owner. `Config` + `Model::fit` call `n4m_model_fit` directly.
`Model::predict_into`
uses caller-owned row-major storage (`n4m_model_predict`); `Model::predict`
uses core-owned storage (`n4m_model_predict_alloc`) and copies it before
calling `n4m_array_free`. `Model::export_n4mm`/`import_n4mm` own N4MM bytes, and
`inspect_n4mm` accepts raw-model v1, bounded SNV/SG pipeline v2 and
component-resolution v3 payloads (including its explicit pipeline flag);
`SerializedModelInfo::pipeline` is a typed optional descriptor containing the
validated operator order, versioned row-wise SNV ddof-0 and SG-interp semantic
profile, canonical SG parameters, raw/model widths and stable FNV-1a-64 plan
fingerprint. `has_pipeline()` reflects that authoritative
descriptor rather than inferring a plan from host metadata.
`Optimizer::save_n4mopt`/`load_n4mopt` own N4MOPT bytes. Checkpoint envelopes
are preflighted to the native 64 MiB N4MOPT cap before the binding allocates a
copy; native loading remains the authoritative decoder. Optimizer snapshots are
copied from the native result, preserve native parameter declaration order in
`parameter_order`, and remain usable after the optimizer is dropped.

`ValidationPlan` plus `finetune_estimator` expose the native regression
selection driver. It selects the best candidate and returns an owning trace;
it is deliberately selection-only and never performs a final full-data model
refit. Call `Model::fit` explicitly after selecting parameters. The native API
rejects unsupported estimators, pruners, metrics, conditional axes, and search
space schemas rather than broadening this binding's scope.

## Generic estimator roles (ABI 2.13, 2.14)

`n4m::roles` exposes every catalog method through the generic C-ABI roles of
`n4m/estimator.h`, the same surface the Python, R and JS/WASM bindings use:

- `manifest_json()` returns the native manifest (roles, DAG-ML node kinds,
  capabilities, fit inputs, typed parameters); `methods()` / `method_info(id)`
  give the same data as typed `MethodInfo` / `ParamInfo`.
- `Params::new(&ctx, id)` plus typed setters (`set_int`, `set_double`,
  `set_bool`, `set_enum`, `set_*_array`, or `set(name, &ParamValue)`); unset
  parameters keep their native defaults.
- `FitInputs::new(x)` with optional `y`, `labels`, `sample_weight`, `groups`,
  `feature_groups`, `blocks`, `axis`, `x_target` and `fold_ids`. Matrices are
  `MatrixRef` views, row-major or strided (`MatrixRef::strided`, e.g.
  column-major) without a copy. Per-row inputs have exactly one entry per row
  of `x` and `y` one row per row of `x`; the core refuses any other length.
- `Estimator::new(&ctx, id, params)` then `fit`, and per role `transform`,
  `predict`, `decision_function`, `predict_proba`, `predict_labels`,
  `classes`, `selected_indices` and `apply_mask`. Role and input checks are
  native: an operation the method does not define fails with
  `ErrorKind::Unsupported`, and the error message carries the context text.
  A failed refit keeps the previous fitted state.
- `to_n4me(&ctx, allow_training_rows)` / `Estimator::from_n4me(&ctx, bytes)`
  exchange fitted states as N4ME bytes, readable by every n4m binding
  (`Context::set_max_state_bytes` bounds imports, 256 MiB by default). A state
  that embeds training rows (`contains_training_rows()`) exports only with
  `allow_training_rows = true`; import refuses parameters that contradict the
  state (`ParamInfo::recorded`).
- `run_procedure(&ctx, id, params, &inputs)` runs splitters (`folds()`),
  augmenters (`double_matrix("X")`) and generic procedures (`entries()` plus
  typed getters) once.

```rust
use n4m::{roles::{Estimator, FitInputs}, Context, MatrixRef};

let ctx = Context::new()?;
let (x, y) = (MatrixRef::row_major(&x, n, p)?, MatrixRef::row_major(&y, n, 1)?);
let mut pls = Estimator::new(&ctx, "models.pls.cppls", None)?;
pls.fit(&ctx, &FitInputs::new(x).y(y))?;
let state = pls.to_n4me(&ctx, false)?; // predicts identically in Python, R, WASM
```

## Role pipelines (ABI 2.14)

`n4m::roles::RolePipeline` is the native trained recipe of role steps (sample
filters, transformers / selectors, one regressor or classifier), shared with
Python `n4m.roles.RolePipeline`, R `n4m_role_pipeline()` and JS
`RolePipeline`. The recipe order, fit-input routing (multi-target `y` reaches
supervised transformers, filters subset every row input), the feature-name
check and the per-step N4ME states are native; `import_states` refuses states
that contradict the recipe (method, parameters, widths) and `export_states`
refuses training-row states unless `allow_training_rows` is set.

```rust
use n4m::{roles::{FitInputs, RolePipeline}, Context, MatrixRef};

let ctx = Context::new()?;
let mut pipe = RolePipeline::new(&ctx, &[
    ("preprocessing.scatter.snv", None),
    ("models.pls.cppls", None),
])?;
pipe.set_feature_names(&ctx, &names)?;
pipe.fit(&ctx, &FitInputs::new(MatrixRef::row_major(&x, n, p)?).y(y_view))?;
let pred = pipe.predict(&ctx, x_new, Some(&names))?; // refuses reordered columns
let states = pipe.export_states(&ctx, false)?;       // one N4ME per stateful step
```

`tests/estimator_roles.rs` replays the shared
`parity/fixtures/estimator_roles_n4me.json` fixture written by the Python
binding: every N4ME state predicts at 1e-12 and every Rust refit and procedure
run reproduces the Python outputs at 1e-9. `tests/estimator_roles_negative.rs`
replays `parity/fixtures/estimator_roles_negative.json`, the refusals shared
with the Python, R and JS/WASM suites.

## Complete multimodal predictor (ABI 2.16)

`n4m::MultimodalPipeline` owns one native early-fusion predictor, including its
population scaler, image/series PCA, learned UTF-8 categories, source weights
and Ridge. `multimodal::Recipe` contains four ordered `SourceSpec` declarations
(`nir`, `image`, `series`, `metadata`); shapes are fixed by the caller's schema,
not by the dimensions of the U07 test fixture. Each source carries its exact
canonical IO descriptor in `identity`. Native import checks the independent
expected recipe and schema against every learned state.

`SourceView::numeric`, `numeric_f32` and `strided` borrow tensors with the sample
axis first. `SourceView::mixed` borrows numeric column 0 and copies raw UTF-8 cells
for column 1; it never creates category codes. Native fit learns the vocabulary,
and prediction ignores unknown categories. Numeric spans are checked against
their Rust slices before pointers cross the ABI.

```rust
use n4m::MultimodalPipeline;

// ctx, recipe and views are provided from independently declared input schemas.
let mut model = MultimodalPipeline::new(&ctx, &recipe)?;
model.fit(&ctx, &views, y_view)?;
let features = model.transform(&ctx, &views)?; // actual weighted encodings
let state = model.export_state(&ctx)?;         // complete N4MF, at most 64 MiB
drop(model);
let replay = MultimodalPipeline::from_state(&ctx, &recipe, &state)?;
let prediction = replay.predict(&ctx, &new_views)?; // no fit
```

The first profile uses complete sources, one target, dense PCA without
whitening and a centered Ridge without an additional X scaling step. Fit is
transactional. Handles are `!Send + !Sync` and released by `Drop`. The binding
performs no numerical preprocessing or orchestration. Its native contract,
strides, train-only scaler statistics, unknown categories, complete state and
refusals are exercised in `tests/multimodal.rs`.

This crate is binding work only: crate version 0.1.4 tracks the additive ABI-2.5
inspection surface and is not an independent numerical-engine release. It
requires a prebuilt `libn4m`. The default
`linked` feature validates every Rust extern declaration against the installed
public headers at build time; it is the development and CI mode.

## Publication

The crates.io identity is [`n4m`](https://crates.io/crates/n4m), versioned
independently from the Methods engine. Maintainers publish only through
`.github/workflows/release-n4m-crate.yml` with an exact component tag matching
the manifest, for example `n4m-v0.1.4`. A manual workflow dispatch is always a
dry run: it builds `libn4m`, runs `cargo package --locked`, uploads the `.crate`
and file inventory as GitHub Actions artifacts, and records build provenance,
but it has no publication path.

The tag-triggered publish job uses the protected `crates-io` GitHub environment
and requires its `CARGO_REGISTRY_TOKEN` secret. A missing credential fails
explicitly. Do not publish this crate with a Methods-wide `v*` tag, and do not
reuse the archived `bindings/_archive/rust` proof of concept: it remains frozen
and is a different package history.

## License

The crate is dual-licensed as `CECILL-2.1 OR AGPL-3.0-or-later`, at your
option, in line with the
[repository licensing policy](https://github.com/GBeurier/nirs4all-methods/blob/main/LICENSING.md).
It packages the complete texts in
`LICENSES/CeCILL-2.1.txt` and `LICENSES/AGPL-3.0-or-later.txt`. This is
intentional: the repository-root `LICENSE` contains the AGPL text only and is
not presented as the CeCILL text. Verify the package file set with:

```sh
cargo package --locked -p n4m --list --allow-dirty
```

Build libn4m first, then run:

```sh
N4M_LIB_DIR="$PWD/build/dev-debug/cpp/src" \
N4M_RUNTIME_RPATH="$PWD/build/dev-debug/cpp/src" \
cargo test -p n4m
```

`N4M_LIB_DIR` is required and must contain the target shared-library artifact.
The build probe reads the public headers from `cpp/include` plus CMake's generated
`build/<preset>/generated`; installed layouts can set `N4M_INCLUDE_DIR` and
`N4M_GENERATED_INCLUDE_DIR` explicitly. The crate does not embed a default
absolute rpath. Set `N4M_RUNTIME_RPATH` only when the target platform needs an
explicit runtime-loader path (Linux/macOS); on Windows place `n4m.dll` beside the
executable or on `PATH`.

The CI sanitizer job uses the repository's `ci-{asan,ubsan,asan_ubsan}` native
presets. It builds the Rust test harness with `clang-16`, links the matching
clang sanitizer runtime, and verifies that runtime before tests run. Locally
those presets require `clang-16` and its sanitizer runtime; when that compiler
is unavailable, use the normal `dev-debug` command above rather than claiming a
sanitizer run.

## Packaged runtime loading

For a distributed host that already owns the exact native artifact, compile
without the default feature and enable `dynamic` instead. This mode does not
consult `N4M_LIB_DIR`, does not add an rpath, and never searches the current
directory. Before creating a `Context`, select the exact shared-library file:

```rust
n4m::configure_library("/absolute/path/to/libn4m.so.2")?;
let actual_abi = n4m::runtime_abi_version()?;
let context = n4m::Context::new()?;
```

Alternatively set `N4M_LIBRARY_PATH` to that exact file before the first
`Context::new()`. The choice is process-wide and one-shot: reconfiguring to a
different library is rejected before any native handle can be mixed. A missing
or malformed runtime fails closed with an ABI error. This dynamic mode exposes
the same model and optimizer/HPO API; it is not a Python callback or a reduced
prediction-only binding.
