# CLAUDE.md

This file provides guidance to Claude Code when working in `nirs4all-core`.

## Role

`nirs4all-core` is a portability layer over the low-level nirs4all ecosystem. It
must expose the same upstream capabilities across Rust, Python, R,
MATLAB/Octave, and JavaScript/WASM without becoming a second implementation of
formats, datasets, ML orchestration, or numerical methods.

## Naming

- Repository: `nirs4all-core`
- Python distribution: `nirs4all-core`
- Python import packages: `nirs4all_core` (canonical) and `n4a` (additive
  brand facade)
- Non-Python packages/modules: `nirs4all`

The full Python `nirs4all` project remains separate until its core can be
replaced by this aggregate's Python binding intentionally.

## Architecture rules

1. Re-export upstream domains (`formats`, `io`, `datasets`, `methods`,
   `dag_ml`, `dag_ml_data`) from the top-level binding surface.
2. Never add a parser, estimator, numerical kernel, dataset catalog, or DAG
   compiler here.
3. Keep host-language APIs idiomatic: sklearn-compatible Python adapters, R
   formula/data-frame paths, MATLAB/Octave arrays and tables, typed npm APIs,
   and Rust traits/results.
4. Add parity fixtures before widening behavior. A change is not complete until
   native, binding, and full Python `nirs4all` outputs are compared where
   equivalent pipelines exist.

## Checks

```bash
make test
cargo test --workspace
PYTHONPATH=bindings/python/src python -m unittest discover -s bindings/python/tests
npm test --prefix bindings/wasm
mkdir -p dist/r && cd dist/r && R CMD build ../../bindings/r && cd ../.. && R CMD check --no-manual dist/r/nirs4all_*.tar.gz
octave --quiet --eval "run('bindings/matlab/tests/smoke.m')"
```

`make build` produces Python, npm, R, MATLAB/Octave, and Rust package
artifacts when the relevant toolchains are installed. R and Octave may be
available only in CI on some workstations.
