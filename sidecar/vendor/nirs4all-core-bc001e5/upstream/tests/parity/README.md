# Parity Fixtures

This directory holds cross-runtime parity fixtures for `nirs4all-core`.

The `portable_*.json` / `portable_*.yaml` pairs use the same `pipeline:`
envelope as the full Python `nirs4all` `examples/pipeline_samples` syntax.
The initial shared cases are:

- SNV + PLS;
- Savitzky-Golay + PLS;
- Kennard-Stone + SNV + PLS;
- Kennard-Stone + SNV + Savitzky-Golay + PLS `n_components` sweep via
  `_range_` / `param`.

`expected/portable_python_oracle.json` is generated from the full Python
`nirs4all` library and is the source of truth for the WASM execution parity
test in `bindings/wasm/tests/parity.test.js` and the optional strict Python,
Rust, and R binding execution parity tests in
`bindings/python/tests/test_execution_parity.py`,
`bindings/rust/nirs4all/src/lib.rs`, and `bindings/r/tests/parity.R`.

Regenerate it with:

```bash
PYTHONPATH=/home/delete/nirs4all/nirs4all \
  /home/delete/nirs4all/nirs4all/.venv/bin/python \
  scripts/parity/generate_python_oracle.py
```

Then run:

```bash
make check-wasm-methods-artifact \
  NIRS4ALL_METHODS_ROOT=/path/to/nirs4all-methods
NIRS4ALL_METHODS_JS_DIST=/path/to/nirs4all-methods/bindings/js/dist \
NIRS4ALL_CORE_REQUIRE_METHODS_PARITY=1 \
npm test --prefix bindings/wasm
NIRS4ALL_METHODS_LIB=/path/to/libn4m.so \
LD_LIBRARY_PATH=/path/to/libn4m-directory \
NIRS4ALL_CORE_REQUIRE_METHODS_PARITY=1 \
cargo test -p nirs4all rust_binding_execution_matches_full_python_nirs4all_oracle -- --nocapture
PYTHONPATH=bindings/python/src:/path/to/nirs4all-methods/bindings/python/src \
N4M_LIB_PATH=/path/to/libn4m.so \
NIRS4ALL_CORE_REQUIRE_METHODS_PARITY=1 \
python -m unittest bindings/python/tests/test_execution_parity.py -v
NIRS4ALL_CORE_PARITY_ORACLE=$PWD/tests/parity/expected/portable_python_oracle.json \
NIRS4ALL_CORE_PARITY_FIXTURES=$PWD/bindings/r/inst/extdata \
NIRS4ALL_CORE_REQUIRE_METHODS_PARITY=1 \
Rscript bindings/r/tests/parity.R
```

Each fixture should include:

- input data or a DOI/catalog reference;
- a pipeline descriptor;
- expected outputs and tolerances;
- upstream version metadata;
- the full Python `nirs4all` comparison result when the pipeline is equivalent.

Do not add generated private datasets or draft-paper material here.
