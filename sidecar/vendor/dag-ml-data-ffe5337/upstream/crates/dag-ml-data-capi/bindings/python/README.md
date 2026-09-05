# dag-ml-data-provider (Python)

Stdlib-only `ctypes` shim for the `dag-ml-data` C ABI provider vtable. It is a
thin, modality-neutral wrapper over the Rust `dag-ml-data-capi` cdylib: it hands
JSON payloads and host buffers to Rust and decodes the Arrow / owned-struct
results. It contains no NIRS, ML, or scheduling logic — those live in
`dag-ml-data` / `dag-ml`.

This is the **provider** binding. The sibling `dag-ml-data` PyO3 package target
(`crates/dag-ml-data-py`) binds the JSON *contracts* and is unrelated.

## Locating the cdylib

The package does not bundle `dag_ml_data_capi` yet. The library is located, in
order:

1. an explicit `library_path=...` argument,
2. the `DAG_ML_DATA_CAPI_LIB` environment variable,
3. a package-local `dag_ml_data_provider/.libs/` directory (reserved for a future
   bundled wheel),
4. the Cargo target directory of a source checkout (honoring `CARGO_TARGET_DIR`,
   else `<workspace>/target/{debug,release}`).

Build the cdylib from a checkout with:

```bash
cargo build -p dag-ml-data-capi --lib
```

## Usage

```python
from dag_ml_data_provider import InMemoryProvider

with InMemoryProvider.from_files(
    "coordinator_data_plan_envelope.json",
    f64_feature_matrices=[...],
    # library_path=... optional; discovered automatically otherwise
) as provider:
    data_handle = provider.materialize_file("materialization_request.json")
    view_handle = provider.make_view(data_handle, {"sample_ids": [...]})
    features = provider.feature_values(view_handle, "x")
```

## Tests

```bash
pip install -e ".[test]"
cargo build -p dag-ml-data-capi --lib   # so the cdylib can be discovered
pytest
```

The package tests skip automatically if the cdylib cannot be located.
