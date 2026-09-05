# Python ABI Example

`provider_smoke.py` is an executable conformance smoke over the in-memory
provider — typed f64 feature matrices, provider-wide feature-buffer manifests,
data-handle-scoped feature-buffer bindings, observation-level features and
sample-level targets.

It imports the installable, standard-library-only `dag_ml_data_provider` ctypes
package, which lives in `../../crates/dag-ml-data-capi/bindings/python` (the
wrapper formerly inlined here as `dag_ml_data_provider.py` now lives there).

Run from the repository root. The package discovers the cdylib via
`DAG_ML_DATA_CAPI_LIB` or the Cargo target directory, so `--lib` is optional:

```bash
cargo build -p dag-ml-data-capi --lib
PYTHONPATH=crates/dag-ml-data-capi/bindings/python \
python3 examples/python/provider_smoke.py \
  --envelope examples/fixtures/oof_campaign/coordinator_data_plan_envelope_nir.json \
  --request examples/fixtures/oof_campaign/materialization_request_model_base_x.json
```

The package is the binding reference for materialization, view creation, identity
export, typed f64 feature-matrix provider construction, feature-buffer manifest
export, data-handle binding export, observation-level feature export,
sample-level target export, handle release and provider destruction.
