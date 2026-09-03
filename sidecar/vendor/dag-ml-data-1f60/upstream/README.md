<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/brand/horizontal-dark.svg">
    <img alt="dag-ml-data" src="assets/brand/horizontal.svg" width="440">
  </picture>
</p>

# dag-ml-data

Rust-first data contract and planning layer for typed, sample-aligned,
multi-source ML data.

`dag-ml-data` owns schemas, axes, representations, immutable data views,
sample relations, representation adapters, data plans, alignment/collation
contracts and schema fingerprints. It does not own ML phases, CV orchestration,
OOF joins or model execution; those belong to `dag-ml`.

> Status: 0.2.10 V1 RC release train. The schema/planning contracts, coordinator envelope,
> handle/view lifecycle, in-memory provider vtable, Arrow/tensor exports,
> Python `ctypes` conformance package and cross-repo `dag-ml` fixtures are
> executable and gated. Production support is intentionally scoped; see
> [`docs/SUPPORTED.md`](docs/SUPPORTED.md) before treating a provider backend or
> binding surface as release-supported.

## Repository Layout

```text
crates/
  dag-ml-data-core/   # schema, representation, view, relation and plan types
  dag-ml-data/        # Rust facade re-exporting stable core APIs
  dag-ml-data-capi/   # C ABI helpers and DataVTable contracts
  dag-ml-data-py/     # PyO3/maturin JSON-contract bindings for Python hosts
  dag-ml-data-wasm/   # wasm-bindgen JSON-contract bindings for browser hosts
  dag-ml-data-cli/    # local schema validation/fingerprint utility
docs/
  TOC.md              # validation-oriented table of contents
  ARCHITECTURE.md     # data-layer boundaries and flow
  ABI.md              # C ABI ownership model for host data providers
  RATIONALE.md        # why this is separate from dag-ml
  ROADMAP.md          # delivery phases and gates
  STATUS.md           # current state and next tasks
  SUPPORTED.md        # release support matrix and public-signature policy
  TEST_PLAN.md        # contract/conformance test strategy
  design/source/      # moved ML_DATA source specification
examples/
  minimal_schema.json
  python/             # stdlib-only ctypes wrapper and provider smoke
```

## Quick Start

```bash
cargo fmt --all --check
cargo +1.85.0 check --workspace --all-targets
cargo test --workspace
cargo test -p dag-ml-data-wasm
# dag-ml-data-py is excluded from the workspace (abi3-py311); test it standalone:
PYO3_PYTHON=python3.11 cargo test --manifest-path crates/dag-ml-data-py/Cargo.toml
python3 scripts/validate_release_metadata.py
python3 scripts/check_error_taxonomy.py
python3 scripts/check_deprecations.py
python3 scripts/check_public_docs.py
python3 scripts/release/check_publish_plan.py --dry-run
python3 scripts/validate_abi_snapshot.py
cargo audit --deny warnings
python3 -m pip install -r docs/requirements.txt
sphinx-build -W --keep-going -b html docs docs/_build/html
cargo run -p dag-ml-data-cli -- fingerprint-schema examples/minimal_schema.json
cargo run -p dag-ml-data-cli -- materialize-envelope --envelope examples/fixtures/oof_campaign/coordinator_data_plan_envelope_nir.json --request examples/fixtures/oof_campaign/materialization_request_model_base_x.json
cargo build -p dag-ml-data-capi --lib
PYTHONPATH=crates/dag-ml-data-capi/bindings/python python3 examples/python/provider_smoke.py --envelope examples/fixtures/oof_campaign/coordinator_data_plan_envelope_nir.json --request examples/fixtures/oof_campaign/materialization_request_model_base_x.json
(cd crates/dag-ml-data-py && maturin build --locked --release --features extension-module --out ../../target/wheels)
python3 scripts/smoke_python_wheel_metadata.py target/wheels/dag_ml_data-*.whl
python3 scripts/smoke_python_bindings.py       # after installing the built wheel
node_out_dir="$PWD/target/wasm/dag-ml-data-wasm"
wasm-pack build crates/dag-ml-data-wasm --target nodejs --out-dir "$node_out_dir" --release
node scripts/smoke_wasm_bindings.cjs "$node_out_dir"
web_out_dir="$PWD/crates/dag-ml-data-wasm/pkg-web"
rm -rf "$web_out_dir"
wasm-pack build crates/dag-ml-data-wasm --target web --out-dir "$web_out_dir" --release
node scripts/smoke_wasm_web_bindings.mjs "$web_out_dir"
(cd crates/dag-ml-data-wasm && wasm-pack pack --pkg-dir pkg-web .)
node scripts/smoke_wasm_tarball_metadata.mjs "$web_out_dir"
```

## 0.2.x RC Release Scope

The supported 0.2.x RC scope is a schema and planning core that can:

1. parse and validate canonical dataset schemas;
2. describe semantic axes and representations;
3. produce deterministic schema fingerprints;
4. represent unresolved data plans without executing ML;
5. expose fingerprinting and basic validation through the C ABI;
6. materialize validated coordinator envelopes into opaque handle records for
   DAG-ML controller tasks;
7. expose coordinator identity relations through a minimal Arrow C Data ABI
   smoke path;
8. create identity-filtered view handles, align sample-level target values
   across repeated observations and export multi-target Arrow tables with
   per-target validity masks;
9. exercise the provider vtable lifecycle for
   materialize/view/identity/target/feature operations;
10. provide a stdlib-only Python ABI smoke wrapper that external bindings can
    use as a starting conformance target.

## License

`dag-ml-data` is dual-licensed open-source — **`CeCILL-2.1 OR AGPL-3.0-or-later`** (your choice).
See [`LICENSING.md`](LICENSING.md), the full texts under [`LICENSES/`](LICENSES/), and third-party
attributions in [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).
