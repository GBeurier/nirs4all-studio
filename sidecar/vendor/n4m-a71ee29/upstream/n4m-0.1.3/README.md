# n4m Rust binding

This is the official Rust binding for the stable `libn4m` C ABI. It is a thin
ownership/serialization layer: numerical fitting and optimizer logic stay in
`libn4m`. `Context`, `SearchSpace`, and `Optimizer` are `!Send + !Sync`; create
one `Context` per thread. `SearchSpace` maps all native typed axes and
constraints; `Optimizer` exposes native ask/ask-batch/tell/intermediate/best,
borrowed `Trial` accessors, and owning rich `TrialSnapshot` traces. Batch errors
retain every committed borrowed trial in `AskBatchError::Partial`.

`Config` + `Model::fit` call `n4m_model_fit` directly. `Model::predict_into`
uses caller-owned row-major storage (`n4m_model_predict`); `Model::predict`
uses core-owned storage (`n4m_model_predict_alloc`) and copies it before
calling `n4m_array_free`. `Model::export_n4mm`/`import_n4mm` own N4MM bytes, and
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

This crate is binding work only: it does not claim a Rust package release or
extend the public C++ ABI. It requires a prebuilt `libn4m`. The default
`linked` feature validates every Rust extern declaration against the installed
public headers at build time; it is the development and CI mode.

## License

The crate is dual-licensed as `CECILL-2.1 OR AGPL-3.0-or-later`, at your
option, in line with the
[repository licensing policy](https://github.com/GBeurier/nirs4all-methods/blob/main/LICENSING.md).
It packages the complete texts in
`LICENSES/CeCILL-2.1.txt` and `LICENSES/AGPL-3.0-or-later.txt`. This is
intentional: the repository-root `LICENSE` contains the AGPL text only and is
not presented as the CeCILL text. Verify the package file set with:

```sh
cargo package -p n4m --list --allow-dirty
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
let context = n4m::Context::new()?;
```

Alternatively set `N4M_LIBRARY_PATH` to that exact file before the first
`Context::new()`. The choice is process-wide and one-shot: reconfiguring to a
different library is rejected before any native handle can be mixed. A missing
or malformed runtime fails closed with an ABI error. This dynamic mode exposes
the same model and optimizer/HPO API; it is not a Python callback or a reduced
prediction-only binding.
