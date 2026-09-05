# Contributing to dag-ml-data

`dag-ml-data` is the Rust-first data-contract and planning layer for typed, sample-aligned, multi-source ML data. It owns schemas, semantic axes, representations, immutable data views, sample relations, representation adapters, data plans, alignment/collation contracts, schema fingerprints, and the host-provider C ABI. It does **not** own ML phases, CV/fold construction, OOF logic, model selection, model execution, or leakage enforcement — those belong to the sibling [`dag-ml`](https://github.com/GBeurier/dag-ml) repository.

Read [developer documentation](docs/DEVELOPMENT.md), [rationale](docs/RATIONALE.md), and [shared contracts](docs/contracts/README.md) before changing a contract. Private design history, when available locally, is indexed by `docs/_private/README.md`.

## Development environment

```bash
rustup toolchain install stable
rustup component add rustfmt clippy
# A working C toolchain (cc) and python3 are needed for the FFI smokes.
```

## The green gate

```bash
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
cargo run -p dag-ml-data-cli -- fingerprint-schema examples/minimal_schema.json
DAG_ML_REPO=../dag-ml python3 scripts/validate_contracts.py
```

Targeted iteration:

```bash
cargo test -p dag-ml-data-core <test_name>
cargo test -p dag-ml-data-capi --test c_header_smoke        # C header + linked runtime
cargo test -p dag-ml-data-capi --test python_ctypes_smoke   # embedded Python ctypes

# CLI smokes
cargo run -p dag-ml-data-cli -- validate-envelope examples/fixtures/oof_campaign/coordinator_data_plan_envelope_nir.json
cargo run -p dag-ml-data-cli -- materialize-envelope \
  --envelope examples/fixtures/oof_campaign/coordinator_data_plan_envelope_nir.json \
  --request  examples/fixtures/oof_campaign/materialization_request_model_base_x.json
```

## Repository layout

```
crates/
  dag-ml-data-core/   serializable contracts + validation (all real logic)
  dag-ml-data/        thin facade: pub use dag_ml_data_core::*;
  dag-ml-data-capi/   C ABI helpers, header (include/dag_ml_data.h), DataVTable, FFI smokes
  dag-ml-data-cli/    fingerprint-schema / validate-envelope / materialize-envelope / plan-model-input
docs/
  DEVELOPMENT.md / RATIONALE.md / ARCHITECTURE.md / ABI.md / SUPPORTED.md
  adr/                shared ADRs (01/02/05/06/07 — byte-identical with dag-ml; see adr/README.md)
  contracts/          JSON Schemas + conformance_pack.v1.json (shared with dag-ml — JSON-identical)
  _private/           ignored local design sources, plans, archives and audits
examples/
  minimal_schema.json
  fixtures/oof_campaign/   shared conformance fixtures (envelope, requests, fusion selectors)
  python/                  stdlib-only ctypes wrapper + provider smoke
```

## Core module map (`crates/dag-ml-data-core/src/`)

`ids` · `model` · `adapter` · `plan` · `planner` · `alignment` · `fusion` · `collation` · `relation` · `coordinator` · `handle` · `buffer` · `fingerprint` · `error`. All re-exported flat via `lib.rs`; the facade re-exports the same surface unchanged.

## Adding a representation / adapter

1. Define the `RepresentationSpec` (axes, container, dtype) and register the adapter in the `AdapterRegistry` with its input/output representations and cost.
2. The planner (`planner.rs`) solves representation paths via BFS/Dijkstra over the registry — keep registration deterministic and source-order-independent.
3. Add a fixture-driven test; fingerprints must stay stable under source reordering (`fingerprint.rs`).

## Changing the coordinator envelope / fusion selector / conformance pack / C header

These are **cross-repo contracts** shared with `dag-ml` and must stay **JSON-identical**. A change is a coordinated dual-PR operation:

1. Bump the version macro / schema version if the wire shape changes ([ADR-02](docs/adr/ADR-02-schema-evolution-sla.md): additive-first, then version bump + dual-read window).
2. Update the schema in `docs/contracts/`, the Rust type, the C header (`crates/dag-ml-data-capi/include/dag_ml_data.h`), and the conformance pack together.
3. Run `DAG_ML_REPO=../dag-ml python3 scripts/validate_contracts.py` — it fails on schema / fixture / header drift.
4. The C headers (`dag_ml_data.h` and the sibling `dag_ml.h`) must be includable in either order — the cross-header smoke checks this.
5. Update `docs/SUPPORTED.md` and `CHANGELOG.md`; open the paired `dag-ml` PR. Keep optional private status and plans under `docs/_private/current/`.

## Adding a new error variant

Errors follow the [ADR-11](https://github.com/GBeurier/dag-ml/blob/main/docs/adr/ADR-11-error-taxonomy.md) taxonomy shared with
`dag-ml`. A new `DataError` variant in `crates/dag-ml-data-core/src/error.rs` must
update (the `scripts/check_error_taxonomy.py` gate enforces these): `taxonomy_parts()`
`(category, code, severity)`; `remediation_hint()`; `context()` (identifiers/counts
only); and `numeric_taxonomy()` `(category_id, code_id)` — category_id must match
the shared ADR-11 ids (validation=0, data=2, compatibility=8, …) and code_id must be
unique within the category; never renumber a shipped pair. If the category is new to
the Python surface, add a `create_exception!` subclass (inheriting `DagMlDataError`),
map it in `data_error_type_for_category`, and export it in `python/dag_ml_data/`. The
C ABI emits the true descriptor automatically via `set_display_error` →
`descriptor_json()`; boundary/argument errors use `set_error_message`
(`validation/c_abi_argument`). Add Rust + Python binding tests.

## Conventions

- `Result<T, DataError>` (`Result<T>`) for fallible APIs; `thiserror` 2.x.
- Identifiers always go through their typed wrappers (`SourceId::new`, …); never raw strings on public APIs.
- Fingerprints must remain stable under source-order changes.
- Production buffer arenas reuse `NumericFeatureBufferArena` (manifest / bind / project / release) — do not re-implement the lifecycle in the C ABI layer.
- Conformance-only helpers (not part of the stable vtable) are named `dagmldata_inmemory_provider_*`.

## Pull-request rules

Same as `dag-ml`: green gate locally, paired PR + green `validate_contracts.py` for any shared-contract change, `CHANGELOG.md` entry, ADR for decision changes, removal version on every new `#[deprecated]` (ADR-14 in `dag-ml/docs/adr/ADR-14-deprecation-policy.md`), justified production-path `TODO`/`FIXME` markers enforced by `python3 scripts/check_deprecations.py`, and invariant-grade doc comment on every new public item.

If you changed `Cargo.toml`, also run `python3 scripts/release/check_publish_plan.py --dry-run`; it validates the ADR-10 release order and dry-runs the root crate that can be published before internal dependents.

## ADRs and releases

Shared decisions are mirrored in [`docs/adr/`](docs/adr/README.md) byte-identical with `dag-ml`. Releases follow the [ADR-10](https://github.com/GBeurier/dag-ml/blob/main/docs/adr/ADR-10-release-train.md) train: this repo publishes **first**, then `dag-ml` bumps its pin and publishes.
