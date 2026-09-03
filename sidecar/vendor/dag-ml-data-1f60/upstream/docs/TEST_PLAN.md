# Test Plan

## Unit Tests

| Area | First tests |
|---|---|
| Identifiers | invalid chars, empty ids, max length |
| Representations | missing sample axis, rank/axis mismatch, ragged rules |
| Schema | duplicate sample ids, duplicate sources, source validation |
| Fingerprint | source-order independence, schema hash, data-plan hash |
| Plans | unresolved choices, empty plans, declared output representation |
| Planner | fixture schema/model-input/adapters produce expected data plan |
| Alignment | stable `inner`, `left`, `outer` sample order, duplicate source/sample refusal, multi-source planner emits explicit `Align` before `Join` |
| Feature fusion | singleton-source broadcast over reference repetitions, deterministic synthetic outer rows, duplicate unnamespaced column refusal, incoherent presence-mask refusal, ambiguous repeated non-reference source refusal |
| Collation | rectangular feature blocks to row-major tensors, ragged row padding, truncation side rules, presence/value-validity masks, non-numeric feature refusal |
| Relations | duplicate observations, group consistency, augmentation origin validity |
| Coordinator envelope | explicit schema version, published envelope JSON Schema version, shared conformance-pack digests, unsupported schema version refusal, schema/plan/relation fingerprint validation |
| Handles | materialization request/envelope fingerprint match, opaque data/view handle traceability, requested source-id relation scoping |
| Views/features/targets | sample/source/augmentation filtering, requested sample-order preservation, repetition-preserving identity, observation-level feature alignment, feature-column filtering, feature representation mismatch refusal, sample-level target de-duplication |
| Feature buffers | typed numeric buffer projection, duplicate feature/observation/column refusal, row-major f64 matrix shape/mask validation, finite-value validation for valid entries, deterministic manifests and fingerprints, store-level duplicate feature-set refusal, core arena bind/project/release lifecycle, source/relation coverage bindings for materialized handles |
| ABI | null pointer handling, invalid JSON, valid fingerprint, coordinator identity plus numeric target/multi-target/feature/fused-feature Arrow exports, feature-collation JSON and `DagMlDataTensorF64` exports, in-memory typed feature-buffer creation, typed f64 feature-matrix provider construction, borrowed C f64 feature-matrix provider construction, provider feature-buffer manifest JSON, data-handle feature-buffer binding JSON, provider-backed feature fusion selector over `feature_arrow`, provider-backed feature-collation selector over typed buffers, stale parent handle refusal for feature/tensor exports, wrong-source/wrong-representation buffer refusal, in-memory provider vtable lifecycle, parent/child handle release, C header syntax, cross-header syntax with `dag_ml.h` in both include orders, linked C runtime, embedded Python ctypes smoke and reusable Python example smoke |
| Error taxonomy | Rust `DataError` descriptors for every variant, Python exception attributes, WASM descriptor payloads, C ABI structured validation payloads and CI coverage by `scripts/check_error_taxonomy.py` |

## Conformance Tests

Add after providers exist:

- handle arena refuses schema/plan/relation mismatch and missing required relations;
- provider views return identical identity, feature and target rows independent
  of handle order;
- provider-backed multi-source feature fusion matches the pure Rust fusion
  kernel for repeated reference rows, missing sources and outer joins;
- provider-backed feature collation matches the pure Rust collation kernel for
  single-source and fused feature blocks, in both JSON and `DagMlDataTensorF64`
  ABI-owned forms;
- production provider buffer arenas expose the same data-handle binding
  manifests as the in-memory conformance provider;
- Python and Rust providers return identical provider-vtable identity, feature
  and target Arrow tables;
- path solver returns same plan independent of adapter registration order;
- schema fingerprint rejects incompatible predict-time schemas.

## Shared Fixtures With `dag-ml`

The first shared fixture should be a minimal UC6 stacking dataset: two base
prediction sources, a meta-model input plan and a shuffled sample order that
forces identity-based alignment.

Current CLI smoke commands:

```bash
cargo run -p dag-ml-data-cli -- validate-envelope examples/fixtures/oof_campaign/coordinator_data_plan_envelope_nir.json
cargo run -p dag-ml-data-cli -- materialize-envelope --envelope examples/fixtures/oof_campaign/coordinator_data_plan_envelope_nir.json --request examples/fixtures/oof_campaign/materialization_request_model_base_x.json
python3 -m json.tool docs/contracts/coordinator_data_plan_envelope.schema.json >/dev/null
python3 -m json.tool docs/contracts/feature_fusion_selector.schema.json >/dev/null
python3 -m json.tool docs/contracts/conformance_pack.v1.json >/dev/null
python3 -m json.tool docs/contracts/parity_oracle.v1.json >/dev/null
DAG_ML_REPO=../dag-ml python3 scripts/validate_contracts.py
python3 scripts/validate_release_metadata.py
python3 scripts/check_deprecations.py
python3 scripts/check_public_docs.py
python3 scripts/release/check_publish_plan.py --dry-run
python3 scripts/validate_abi_snapshot.py
python3 -m pip install -r docs/requirements.txt
sphinx-build -W --keep-going -b html docs docs/_build/html
cargo audit --deny warnings
cargo +1.83.0 check --workspace --all-targets
python3 scripts/smoke_python_wheel_metadata.py target/wheels/dag_ml_data-*.whl
node scripts/smoke_wasm_tarball_metadata.mjs crates/dag-ml-data-wasm/pkg-web
```

`examples/fixtures/oof_campaign/coordinator_data_plan_envelope_nir.json` is the
shared `dag-ml` conformance fixture and must remain JSON-identical to the sibling
repo copy.
