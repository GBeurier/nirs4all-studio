# dag-ml-data Table Of Contents

Use this as a validation map before development starts.

| Area | File | Purpose | Validate |
|---|---|---|---|
| Entry point | `README.md` | Project scope, layout and quick start | The repo can be understood in under five minutes |
| Agent handoff | `AGENTS.md` | Rules for autonomous implementation work | A new agent knows boundaries and green gate |
| Architecture | `docs/ARCHITECTURE.md` | Data-layer modules and DAG-ML frontier | No execution graph responsibility leaks in |
| ABI | `docs/ABI.md` | Data provider ABI and ownership | Host buffers stay host-owned |
| Shared contract schemas | `docs/contracts/coordinator_data_plan_envelope.schema.json`, `docs/contracts/feature_fusion_selector.schema.json` | JSON Schemas for the coordinator data-plan envelope and feature fusion selector produced for `dag-ml` | Fixtures and bindings declare the same v1 wire shapes |
| Rationale | `docs/RATIONALE.md` | Split from DAG-ML and design tradeoffs | Data scope is independently defensible |
| MVP acceptance | `docs/MVP_ACCEPTANCE.md` | First data-contract target for UC6/UC11 | Data plans support stacking without owning OOF logic |
| Capability matrix | `docs/CAPABILITY_MATRIX.md` | Full nirs4all replacement data surface | Data contracts expose identity without owning OOF |
| OOF fixtures | `docs/OOF_FIXTURES.md` | Shared tiny campaign data contracts | DAG-ML can consume fixture identities without guessing |
| Roadmap | `docs/ROADMAP.md` | Sequenced delivery phases | Every phase has an observable definition of done |
| Status | `docs/STATUS.md` | Current scaffold state and next actions | No hidden implementation claims |
| Test plan | `docs/TEST_PLAN.md` | Schema, planner and ABI tests | Fingerprints and path solving are covered |
| Supported surface | `docs/SUPPORTED.md` | Release support matrix and public-signature policy | Production, conformance, experimental and backlog surfaces are separated |
| Aggregation interop | `docs/AGGREGATION_INTEROP.md` | Mapping between data-side reducers and coordinator aggregation policies | Cross-repo reducer drift is explicit |
| Performance probes | `docs/PERFORMANCE.md` | Private 0.2.0 performance sanity probes | Critical data-path regressions are measurable |
| Source design | `docs/design/source/ml_data_specification_v1.md` | Full ML_DATA contract | Used as implementation source of truth |
| Core crate | `crates/dag-ml-data-core` | Schema, representation and data-plan primitives | `cargo test -p dag-ml-data-core` passes |
| C ABI crate | `crates/dag-ml-data-capi` | FFI-safe helpers and `DataVTable` shape | Header mirrors Rust ABI structs |
| CLI crate | `crates/dag-ml-data-cli` | Local validation and fingerprinting | Example schema fingerprints |
| Python provider package | `crates/dag-ml-data-capi/bindings/python` | Installable stdlib-only ctypes provider shim (`dag_ml_data_provider`) | Python can materialize, view, read identity/features/targets/tensors and release handles |

## Validation Checklist

| Check | Command |
|---|---|
| Rust formatting | `cargo fmt --all --check` |
| Rust tests | `cargo test --workspace` |
| Lints | `cargo clippy --workspace --all-targets -- -D warnings` |
| Contract schema syntax | `python3 -m json.tool docs/contracts/coordinator_data_plan_envelope.schema.json >/dev/null && python3 -m json.tool docs/contracts/feature_fusion_selector.schema.json >/dev/null` |
| Shared contract drift | `DAG_ML_REPO=../dag-ml python3 scripts/validate_contracts.py` |
| Example schema | `cargo run -p dag-ml-data-cli -- fingerprint-schema examples/minimal_schema.json` |
| Python ABI smoke | `cargo build -p dag-ml-data-capi --lib && PYTHONPATH=crates/dag-ml-data-capi/bindings/python python3 examples/python/provider_smoke.py --envelope examples/fixtures/oof_campaign/coordinator_data_plan_envelope_nir.json --request examples/fixtures/oof_campaign/materialization_request_model_base_x.json` |
