<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/brand/horizontal-dark.svg">
    <img alt="nirs4all-core" src="assets/brand/horizontal.svg" width="440">
  </picture>
</p>

# nirs4all-core

`nirs4all-core` is the portable aggregate publication of the low-level
nirs4all stack. It aggregates:

- `dag-ml`
- `dag-ml-data`
- `nirs4all-formats`
- `nirs4all-io`
- `nirs4all-datasets`
- `nirs4all-methods`

It must not add independent numerical, parsing, or pipeline logic. The upstream
projects stay the source of truth; this repository provides the canonical
aggregate package surface, native bindings, release glue, and parity checks.
Outside Python, the published package names stay `nirs4all`, but those
artifacts are still this aggregate: target-language surfaces that consume the
shared upstream packages and `nirs4all-methods` instead of duplicating parsers,
IO, orchestration, or numerical kernels.

## Package names

| Target | External name | Import/module name |
| --- | --- | --- |
| Python | `nirs4all-core` | `nirs4all_core` |
| Rust | `nirs4all` | `nirs4all` |
| JavaScript/WASM | `nirs4all` | `nirs4all` |
| R | `nirs4all` | `library(nirs4all)` |
| MATLAB/Octave | `nirs4all` | `+nirs4all` namespace |

The Python distribution is `nirs4all-core`; it cannot use the bare `nirs4all`
name because the full Python `nirs4all` library owns it. Other language
bindings use `nirs4all`. The canonical Python import root is
`nirs4all_core`.

The Rust crate, npm package, R package, and MATLAB/Octave namespace named
`nirs4all` are therefore release identities for the same `nirs4all-core`
aggregate, not separate full implementations of the nirs4all stack in those
host languages.

The canonical source repository for all of these artifacts is
`GBeurier/nirs4all-core`. Registry/package names are ecosystem-specific:
Python publishes `nirs4all-core`, while Rust, JavaScript/WASM, R, and the
MATLAB/Octave namespace publish or ship under `nirs4all`.

That shared non-Python name is a packaging identity, not a claim that every
upstream domain has a runtime binding in every language. The full six-domain
aggregate is recorded as metadata and exposed through re-export/load hooks where
the host ecosystem has a real upstream package.

The Python aggregate also exposes the **additive, non-shadowing** brand facade
`n4a` (`import n4a`; see [`docs/NAMING.md`](docs/NAMING.md)). It re-exports
`nirs4all_core` verbatim and adds no behavior.

## Public surface

The aggregate registry tracks the same upstream domains everywhere:

- `formats`
- `io`
- `datasets`
- `methods`
- `dag_ml`
- `dag_ml_data`

Pipelines built by `nirs4all-core` are expected to compose those domains, not
reimplement them. For example, a binding should make it possible to reach the
formats and methods layers from the top-level `nirs4all` package when matching
upstream runtime bindings are installed. Domains without a host binding remain
metadata-only and must fail explicitly if requested as executable capabilities.

Current runtime coverage is intentionally uneven: JavaScript/WASM records npm
peer candidates for every domain; R reaches only the upstream R packages that
exist, including the `dagml` process-local loss/metric registry; MATLAB/Octave
has runtime candidates for DAG-ML local registries through `+dagml` and methods
through `+n4m`, while `dag_ml_data`, `formats`, `io`, and `datasets` remain
metadata-only.

External operator support must stay execution-gated. When an upstream executor
can plan or call an external operator, a binding may add an idiomatic host
adapter for that operator. Those adapters are future/gated work, not a current
availability claim. Until the execution path exists, bindings must report the
capability as unavailable instead of shipping a fake local implementation. See
[`docs/OPERATORS.md`](docs/OPERATORS.md).

## Pipeline definitions

The lightweight parser accepts the same definition envelope as the full Python
`nirs4all.pipeline.PipelineConfigs`: a direct list of steps, a mapping with
`pipeline`, a mapping with `steps`, a JSON/YAML path, or JSON/YAML text. The
current portable fixtures use the nirs4all examples syntax for Kennard-Stone,
SNV, Savitzky-Golay, and a PLS `n_components` sweep via `_range_`/`param`.
Python, Rust, JavaScript/WASM, R, and MATLAB/Octave expose this parser contract.
Savitzky-Golay keeps the full Python nirs4all default boundary behavior
(`mode: "interp"`) and also preserves explicit methods-backed SciPy modes
(`mirror`, `constant`, `nearest`, `wrap`, `interp`) plus `cval`.

JavaScript/WASM, Python, Rust, R, and MATLAB/Octave execute the initial portable
subset through `nirs4all-methods` and compare the same four JSON/YAML fixtures
against the full Python `nirs4all` oracle. The JavaScript/WASM binding
additionally returns a serialized PLS model and exposes
`predictPortablePipeline()` so browser clients can reuse the selected portable
pipeline without reimplementing the preprocessing or prediction path. The
MATLAB/Octave execution path delegates to the upstream `+n4m` MEX shims and
is strict-parity gated in CI. See [`docs/PARITY.md`](docs/PARITY.md).

## Repository layout

```text
bindings/
  python/      # Python distribution: nirs4all-core
  rust/        # Rust crate: nirs4all
  wasm/        # npm/WASM package: nirs4all
  r/           # R package skeleton: nirs4all
  matlab/      # MATLAB/Octave namespace and portable execution facade
compat/        # Upstream registry and compatibility metadata
docs/          # Architecture, binding, parity, and release contracts
tests/parity/  # Cross-runtime parity fixture plan
```

## Current status

This repository is now a buildable aggregate scaffold. It exposes the upstream
domain registry in each target language, builds package artifacts for Python,
npm, R, MATLAB/Octave, and Rust, and wires CI gates for those targets. Runtime
execution is limited to the upstream bindings that exist in each host; the
numerical and parsing behavior is still delegated to the upstream packages, and
`nirs4all-core` does not vendor or reimplement those engines.

## Local checks

```bash
make test-v1-surfaces
make test
cargo test --workspace
PYTHONPATH=bindings/python/src python -m unittest discover -s bindings/python/tests
npm test --prefix bindings/wasm
```

`make test-v1-surfaces` is the public V1 surface gate for Python, R, and
JavaScript/WASM. It runs the Python unittest suite, the WASM npm tests, and the
R surface/upstream/pipeline checks when `R` and `Rscript` are installed; local
workstations without them print a skip/risk message instead. `make test-r` is
the separate local `R CMD check --no-manual bindings/r` gate.

Strict Python-vs-full-`nirs4all` execution parity needs local
`nirs4all-methods` Python bindings and libn4m:

```bash
PYTHONPATH=bindings/python/src:/path/to/nirs4all-methods/bindings/python/src \
PLS4ALL_LIB_PATH=/path/to/libn4m.so \
NIRS4ALL_CORE_REQUIRE_METHODS_PARITY=1 \
python -m unittest bindings/python/tests/test_execution_parity.py -v
```

Strict Rust-vs-full-`nirs4all` execution parity needs a local libn4m build:

```bash
NIRS4ALL_METHODS_LIB=/path/to/libn4m.so \
LD_LIBRARY_PATH=/path/to/libn4m-directory \
NIRS4ALL_CORE_REQUIRE_METHODS_PARITY=1 \
cargo test -p nirs4all rust_binding_execution_matches_full_python_nirs4all_oracle -- --nocapture
```

Strict R-vs-full-`nirs4all` execution parity needs an installed `n4m` R binding
with the portable preprocessing and splitter surface:

```bash
make test-r-parity
```

Strict MATLAB/Octave-vs-full-`nirs4all` execution parity needs the
`nirs4all-methods` `+n4m` MEX shims on the Octave/MATLAB path:

```bash
make test-matlab-parity
```

`make build` produces the language artifacts when the required toolchains are
installed. R and MATLAB/Octave checks require local R/Octave installations; CI
also runs those gates.

## License

`nirs4all-core` is dual-licensed open-source — **`CECILL-2.1 OR AGPL-3.0-or-later`** (your choice) —
with an optional **commercial license** for closed-source / SaaS use. For any commercial use, contact
<nirs4all-admin@cirad.fr>. As an aggregate it re-exports sibling libraries that carry their own
licenses (the sibling crates currently use CECILL-2.1 OR AGPL-3.0-or-later).
See [`LICENSING.md`](LICENSING.md), [`LICENSES/`](LICENSES/), and [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).
