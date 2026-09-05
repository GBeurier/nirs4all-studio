# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Scope

`dag-ml-data` is a **Rust-first data contract and planning layer** for typed, sample-aligned, multi-source ML data. It is consumed by `dag-ml` and other ML engines.

**What this repo owns**: schemas, semantic axes, representations, immutable data views, sample relations, representation adapters, data plans, alignment/collation contracts, schema fingerprints, host-provider C ABI.

**What this repo MUST NOT own** (these belong to `dag-ml`): ML phases, graph scheduling, CV/fold construction, OOF policy decisions, model selection, model execution, and leakage policy decisions. It may validate externally supplied fold contracts against data-owned sample/group/origin identities, but it must not choose, generate or schedule folds. Do not add NIRS-specific assumptions to core types.

See `docs/RATIONALE.md` and `AGENTS.md` for the full boundary statement.

## Working Gate

Run before handing work back:

```bash
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
cargo run -p dag-ml-data-cli -- fingerprint-schema examples/minimal_schema.json
```

The CI workflow (`.github/workflows/ci.yml`) also runs `python3 scripts/validate_contracts.py` with `DAG_ML_REPO` pointing at a checked-out sibling `dag-ml` repo. To run the shared-contract check locally:

```bash
DAG_ML_REPO=../dag-ml python3 scripts/validate_contracts.py
```

## Running Single Tests

```bash
cargo test -p dag-ml-data-core <test_name>              # Single core unit test
cargo test -p dag-ml-data-capi --test c_header_smoke    # Native C header + linked C runtime smoke
cargo test -p dag-ml-data-capi --test python_ctypes_smoke  # Embedded Python ctypes smoke
```

The `c_header_smoke` test invokes `cc -fsyntax-only` and links a small C program against the Rust `cdylib`; it requires a working host C toolchain. `python_ctypes_smoke` requires `python3` on `PATH` and also runs `examples/python/provider_smoke.py` against the installable `dag_ml_data_provider` package (it sets `PYTHONPATH` + `DAG_ML_DATA_CAPI_LIB` for the run).

## CLI Smokes

```bash
cargo run -p dag-ml-data-cli -- fingerprint-schema examples/minimal_schema.json
cargo run -p dag-ml-data-cli -- validate-envelope examples/fixtures/oof_campaign/coordinator_data_plan_envelope_nir.json
cargo run -p dag-ml-data-cli -- materialize-envelope \
  --envelope examples/fixtures/oof_campaign/coordinator_data_plan_envelope_nir.json \
  --request  examples/fixtures/oof_campaign/materialization_request_model_base_x.json
```

Build the C ABI cdylib and run the Python provider smoke. The smoke imports the
installable `dag_ml_data_provider` package (under
`crates/dag-ml-data-capi/bindings/python`) and discovers the cdylib
automatically (env `DAG_ML_DATA_CAPI_LIB` or the Cargo target dir), so `--lib`
is optional:

```bash
cargo build -p dag-ml-data-capi --lib
PYTHONPATH=crates/dag-ml-data-capi/bindings/python \
python3 examples/python/provider_smoke.py \
  --envelope examples/fixtures/oof_campaign/coordinator_data_plan_envelope_nir.json \
  --request  examples/fixtures/oof_campaign/materialization_request_model_base_x.json
```

## Workspace Layout

```
crates/
  dag-ml-data-core/   # Pure-Rust serializable contracts and validation (all real logic lives here)
  dag-ml-data/        # Thin facade: `pub use dag_ml_data_core::*;`
  dag-ml-data-capi/   # C ABI helpers, header (include/dag_ml_data.h), DataVTable, FFI smokes
  dag-ml-data-cli/    # `fingerprint-schema`, `validate-envelope`, `materialize-envelope`, `plan-model-input`
  dag-ml-data-capi/bindings/python/  # installable stdlib-only ctypes provider shim (`dag_ml_data_provider`)
docs/                 # Architecture / ABI / Roadmap / Status / Test Plan / Capability Matrix / source spec
docs/contracts/       # JSON Schemas + conformance_pack.v1.json (shared with dag-ml, must stay JSON-identical)
docs/_private/        # ignored local design sources, plans, archives and audits
examples/fixtures/oof_campaign/   # Shared dag-ml conformance fixtures (envelope, requests, fusion selectors)
examples/python/      # reusable provider smoke (imports the dag_ml_data_provider package)
scripts/validate_contracts.py  # stdlib-only shared-contract drift checker against ../dag-ml
```

`Cargo.toml` is a workspace; crates share `version`, `edition = 2021`, `rust-version = 1.85`, and a small dependency set (`anyhow`, `clap`, `serde`, `serde_json`, `sha2`, `thiserror`, `pyo3`, `wasm-bindgen`). Add new deps to `[workspace.dependencies]` and reference them with `<dep>.workspace = true`.

## Core Crate Module Map

`crates/dag-ml-data-core/src/`:

| Module | Responsibility |
|---|---|
| `ids.rs` | Strongly-typed identifiers (`SourceId`, `SampleId`, `ObservationId`, ...) and validation rules |
| `model.rs` | `ModelInputSpec`: required representations, axes, aux inputs |
| `adapter.rs` | `AdapterRegistry`, `AdapterRegistrySpec`, deterministic registration |
| `plan.rs` | `DataPlan` (materialize → adapt* → align → join → collate) — unresolved data plans, no execution |
| `planner.rs` | `plan_model_input`: BFS/Dijkstra representation path solver over the adapter registry |
| `alignment.rs` | Sample alignment policies (`inner`, `left`, `outer`), planner-visible `Align` step |
| `fusion.rs` | Pure-Rust multi-source feature-fusion kernel (reference-source repetitions, singleton broadcast, namespacing) |
| `collation.rs` | Numeric late-collation kernel (row-major tensor, padding/truncation, presence/value-validity masks) |
| `relation.rs` | `SampleRelationTable`: observation/sample/target/group/origin ids + validation |
| `coordinator.rs` | `CoordinatorDataPlanEnvelope` (v1 wire shape), validation, materialization requests |
| `handle.rs` | `CoordinatorHandleArena`: opaque data/view handles, scoped relations, identity/target/feature alignment |
| `buffer.rs` | `NumericFeatureBuffer` / `NumericFeatureMatrixF64` / `NumericFeatureBufferStore` / `NumericFeatureBufferArena` (manifests, bindings, projection lifecycle) |
| `fingerprint.rs` | Deterministic `schema_fingerprint`, `data_plan_fingerprint`, `sample_relation_fingerprint` (SHA-256, source-order independent) |
| `error.rs` | `DataError`, `Result` |

All modules are re-exported flat via `lib.rs` (`pub use module::*;`). The `dag-ml-data` facade re-exports the same surface unchanged.

## Data Planning Flow

```
DatasetSchema + ModelInputSpec + policy
  -> resolve representation path (planner.rs over adapter.rs)
  -> DataPlan(materialize -> adapt* -> align -> join -> collate)
  -> coordinator envelope (versioned, fingerprinted)
  -> host provider materialize -> opaque data handle
  -> make_view -> view handle
  -> identity / target / feature / fused-feature / collated-tensor exports
```

The planner is deterministic and source-order-independent. Fingerprints (schema/plan/relations) are stable comparison keys for replay; they live in the coordinator envelope and are validated at materialize time.

## C ABI (`crates/dag-ml-data-capi`)

The header `include/dag_ml_data.h` is the source of truth for the FFI surface. Key entry points:

- `dagmldata_schema_fingerprint_json`, `dagmldata_coordinator_*_arrow_json` (identity, target, feature, fusion), `dagmldata_coordinator_feature_collation[_tensor_f64]_json` — narrow smoke helpers.
- `dagmldata_inmemory_provider_new[_with_features|_with_f64_features|_with_f64_feature_views]_json` — Rust-owned conformance provider with the full vtable lifecycle.
- `DagMlDataVTable` (materialize / make_view / view_identity / target_arrow / feature_arrow / release / destroy). `feature_arrow` accepts either a plain feature-set id or a JSON `{ feature_set_id, sources, alignment, policy? }` fusion selector.
- `DAG_ML_DATA_PROVIDER_VTABLE_ABI_VERSION` and `DAG_ML_DATA_TENSOR_F64_ABI_VERSION` macros — must stay in sync with the sibling `dag_ml.h`. The cross-header smoke includes both in both orders when `DAG_ML_REPO` is set.

**Ownership rules** (see `docs/ABI.md` for the full table):

- Host owns materialized data handles, view handles, fitted-adapter handles (released through `DagMlDataVTable.release`).
- Rust owns strings/tensors/Arrow arrays it returns through the ABI; release via `dagmldata_string_free` / `dagmldata_tensor_f64_free` / `dagmldata_arrow_array_free` / `dagmldata_arrow_schema_free`.
- Borrowed `DagMlDataFeatureMatrixF64View` inputs are copied during the constructor call; caller may free immediately after return.
- The preferred numeric input path is typed row-major `NumericFeatureMatrixF64` or borrowed C `DagMlDataFeatureMatrixF64View` — avoid the JSON value-transport path on hot numeric input.

## Shared Contracts With `dag-ml`

The repo publishes JSON Schemas and a conformance-pack manifest used by `dag-ml`. These files must stay **JSON-identical** to their sibling copies; `scripts/validate_contracts.py` enforces this in CI when a sibling `dag-ml` checkout is present.

| Artifact | Path |
|---|---|
| Coordinator envelope schema (v1) | `docs/contracts/coordinator_data_plan_envelope.schema.json` |
| Feature fusion selector schema | `docs/contracts/feature_fusion_selector.schema.json` |
| Conformance pack manifest | `docs/contracts/conformance_pack.v1.json` |
| Shared envelope fixture | `examples/fixtures/oof_campaign/coordinator_data_plan_envelope_nir.json` |
| Shared fusion selector fixture | `examples/fixtures/oof_campaign/feature_fusion_selector_nir_chem.json` |
| Shared C header | `crates/dag-ml-data-capi/include/dag_ml_data.h` |

The envelope wire shape is versioned (`CoordinatorDataPlanEnvelope` v1); unsupported versions are refused. Runtime validation also checks the stronger semantic contract: schema/plan/relation fingerprints, identity consistency, materialization-request compatibility.

## Conventions

- Use `Result<T, DataError>` (re-exported as `Result<T>`) for fallible APIs. `thiserror` 2.x style.
- Identifiers always go through their typed wrappers (`SourceId::new`, etc.); never accept raw strings on public APIs.
- Fingerprints must remain **stable under source-order changes** — never sort-dependent on input order.
- New host-provider features go behind the existing `DagMlDataVTable` shape; if a helper is conformance-only and not part of the stable vtable, name it `dagmldata_inmemory_provider_*` so the boundary is clear.
- Production buffer arenas should reuse `NumericFeatureBufferArena` (manifest / bind / project / release) rather than re-implementing the lifecycle in the C ABI layer.

## When Touching Coordinator Envelope, Vtable, or Schemas

These are cross-repo contracts. After any change:

1. Update the version macro / schema version if the wire shape changes.
2. Re-run `python3 scripts/validate_contracts.py` against the sibling `dag-ml` checkout — both repos must update together.
3. Update public `docs/SUPPORTED.md` and `CHANGELOG.md`; keep optional private status and plans under `docs/_private/current/`.
4. The C header (`crates/dag-ml-data-capi/include/dag_ml_data.h`) and `dag_ml.h` in the sibling repo must be includable in either order — the cross-header syntax smoke checks this.

## Documents To Read First (per AGENTS.md)

1. `docs/DEVELOPMENT.md` — validation map and private-record policy
2. `docs/RATIONALE.md` — why this is split from `dag-ml`
3. `docs/ARCHITECTURE.md` — layer responsibilities and the dag-ml frontier
4. `docs/ABI.md` — ownership model and vtable contract
5. `docs/contracts/README.md` — published shared contracts

`docs/SUPPORTED.md` describes release support. Private historical records, when
present, are indexed by `docs/_private/README.md`; verify their claims against
the source and tests before using them as implementation guidance.
