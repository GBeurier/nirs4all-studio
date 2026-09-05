# Installation And Local Gates

## Prerequisites

- Rust stable plus the MSRV toolchain `1.85.0`.
- Python 3.11 or newer for validation scripts, Sphinx, Python binding smokes and
  the stdlib-only provider smoke.
- Node.js 20 or 22 plus `wasm-pack` for WASM package smokes.
- A sibling `../dag-ml` checkout for cross-repo contract checks.

## Core Validation

```bash
cargo fmt --all --check
cargo +1.85.0 check --workspace --all-targets
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
DAG_ML_REPO=../dag-ml python3 scripts/validate_contracts.py
python3 scripts/validate_release_metadata.py
python3 scripts/validate_abi_snapshot.py
```

## Documentation Site

```bash
python3 -m pip install -r docs/requirements.txt
sphinx-build -W --keep-going -b html docs docs/_build/html
```

## Python And WASM Packages

```bash
(cd crates/dag-ml-data-py && maturin build --locked --release --features extension-module --out ../../target/wheels)
python3 scripts/smoke_python_wheel_metadata.py target/wheels/dag_ml_data-*.whl

wasm-pack build crates/dag-ml-data-wasm --target web --out-dir crates/dag-ml-data-wasm/pkg-web --release
(cd crates/dag-ml-data-wasm && wasm-pack pack --pkg-dir pkg-web .)
node scripts/smoke_wasm_tarball_metadata.mjs crates/dag-ml-data-wasm/pkg-web
```
