# Shared Contracts

This directory contains wire-contract artifacts shared with `dag-ml`.
`dag-ml-data` is the producer for the current coordinator data-plan envelope:
it describes schemas, relations, data plans and fingerprints without owning
folds, OOF prediction blocks, model selection or replay decisions.

## Coordinator Data Plan Envelope v1

Schema: `coordinator_data_plan_envelope.schema.json`

Canonical fixture: `examples/fixtures/oof_campaign/coordinator_data_plan_envelope_nir.json`

Conformance pack: `conformance_pack.v1.json`

Parity oracle handoff: `parity_oracle.v1.json`

Public C ABI snapshot: `abi_snapshot.v1.json`

Runtime type produced here: `CoordinatorDataPlanEnvelope`

Consumer type in `dag-ml`: `ExternalDataPlanEnvelope`

The envelope binds a data plan to stable schema, plan and relation
fingerprints. It may carry coordinator relation records for sample, target,
group, origin, source and augmentation identity. The JSON Schema documents the
portable shape of that envelope; Rust validation enforces the stronger semantic
rules owned by this crate, and `dag-ml` applies campaign-specific OOF/leakage
checks after consuming it.

Short-term policy: both repositories keep a JSON-identical conformance fixture
for this envelope plus a copy of the v1 schema, and test that the published
artifact declares the Rust-supported version. `scripts/validate_contracts.py`
compares the fixture and schema copies when `DAG_ML_REPO` points to a sibling
checkout, validates the shared conformance-pack digests, and CI checks out that
peer explicitly. When development moves into a monorepo, this file should
become a single generated or shared contract artifact used by both crates.

## Coordinator Data Plan Envelope v2

Schema: `coordinator_data_plan_envelope.v2.schema.json`

V2 is additive and closed at the envelope root. It preserves the V1 CV relation
authority and requires a separately fingerprinted `predict_cohort` for the
top-level `PREDICT` phase. `external_test` requires target-content identity and
is disjoint from the CV physical/origin closure; `inference` has no target
content. V1 writers remain V1 and a V1 document containing the V2 member is
refused by the runtime contract.

## Parity Oracle v1

Manifest: `parity_oracle.v1.json`

This is the producer-side handoff for the future `nirs4all` compatibility
ledger. It does not wire `nirs4all`; instead it names the parity cases,
fixtures, Python/WASM gates and invariants that the consumer ledger must bind
to public API rows before bridge work starts. `scripts/validate_contracts.py`
checks the manifest shape, verifies referenced `dag-ml`/`dag-ml-data` fixtures
when the sibling checkout is present, pins its digest in
`conformance_pack.v1.json`, and requires the manifest to stay byte-identical
across both repositories.

## Public C ABI Snapshot v1

Snapshot: `abi_snapshot.v1.json`

Header: `crates/dag-ml-data-capi/include/dag_ml_data.h`

`scripts/validate_abi_snapshot.py` checks the header SHA-256 against the
snapshot and runs in CI. Any C ABI header change must update this manifest in
the same review so downstream providers can see the ABI movement explicitly.
The current snapshot includes the multi-target Arrow helper
`dagmldata_coordinator_multi_target_arrow_json`, which preserves sample order
and exposes one nullable f64 column per target id.

## Coordinator Branch View v1

Schema: `coordinator_branch_view.schema.json`

Runtime type produced here: `CoordinatorBranchView` (the optional `branch_view`
field on `DataView`), mirroring `dag-ml`'s `BranchViewPlan` wire shape. The
schema covers `view_id`, `branch_id`, `mode`
(`separation`/`by_source`/`by_metadata`/`by_tag`/`by_filter`), `selector`
(union over `source_ids`/`metadata`/`tags`/`filter`), `allow_overlap` and
`metadata`. The in-memory arena executes `by_source`, `by_metadata` and
`by_tag` natively. `by_filter` remains schema-opaque for wire compatibility,
but native execution accepts only the closed object
`{"metadata_equals": {…}, "tags_all": […]}` (at least one constraint);
unknown, empty or null predicates are refused as typed validation errors before
row projection. Matched relations preserve supplied scientific identity and
metadata verbatim.
The conformance pack pins the normalized SHA-256 of this schema and
`scripts/validate_contracts.py` enforces it in both repos.

## Fitted Adapter Ref v1

Schema: `fitted_adapter_ref.schema.json`

Runtime type produced here: `FittedAdapterRef` (the adapter persistence
record returned by host adapters at refit time). The schema covers
`schema_version`, `adapter_id`, `adapter_version`, `params_fingerprint`,
optional `backend` (joblib/pickle/json/numpy/onnx/raw), portable `uri`,
`content_fingerprint`, `size_bytes`, `plugin`/`plugin_version`, and
arbitrary `metadata`. Two validation modes are exposed: inline
(`dagmldata_fitted_adapter_ref_validate_json(..., require_portable=0, ...)`)
and portable (`require_portable=1`), the latter requiring backend, safe
relative URI and content fingerprint. The same digest is pinned in both
repos' `conformance_pack.v1.json`.

## Feature Fusion Selector v1

Schema: `feature_fusion_selector.schema.json`

Canonical fixture: `examples/fixtures/oof_campaign/feature_fusion_selector_nir_chem.json`

Runtime shape consumed by the in-memory provider `feature_arrow` hook:
`{ schema_version, feature_set_id, sources, alignment, source_layout?, policy? }`,
where each source maps a `source_id` to a provider-owned `feature_set_id` and
optional column subset. The optional `source_layout` block is the by-source
fallback contract: it declares authoritative `source_order`, one block per
source with the per-source preprocessing output feature-set and representation,
and the feature-axis concat span (`column_start`/`column_count`) that must be
preserved. This selector keeps the vtable ABI stable while making multi-source
feature fusion explicit and conformance-testable.

## Data Provider C ABI v2

The shared provider surface is `DagMlDataVTable` guarded by
`DAG_ML_DATA_VTABLE_DEFINED` and versioned by
`DAG_ML_DATA_PROVIDER_VTABLE_ABI_VERSION == 2`. `scripts/validate_contracts.py`
and the C ABI tests verify that `dag_ml_data.h` and `dag_ml.h` can be included
together in either order when the sibling checkout is available.

## Representation Registry v1 (`B-014` / `DMD-001`)

Manifest: `representation_registry.v1.json`

Runtime type produced here: `RepresentationRegistry`
(`crates/dag-ml-data-core/src/representation_registry.rs`)

This is the **frozen, published catalogue of built-in representation IDs**.
`B-014` is a freeze/publish problem, not an invention problem: the stable
representation-ID vocabulary already lives in `builtin_models.rs` as `pub const`
strings, a `BuiltinDataModel` enum and its constructors. This artifact publishes
that existing vocabulary verbatim — **no new strings** — so cross-repo consumers
can reference the frozen IDs by string: `ControllerManifest.data_requirements`
ports (`L16`) and the `nirs4all-io` emit (`L7`) cite these IDs.

Each of the 26 entries carries the representation-ID string, its
`BuiltinDataModel` key, modality, an optional spectra+image MVP annotation and
the complete frozen `RepresentationSpec` (axes, rank, dtype, container). The
manifest is generated from the Rust source of truth and regenerated with:

```bash
cargo run -p dag-ml-data-cli -- representation-registry > docs/contracts/representation_registry.v1.json
```

The freeze is enforced in-repo by the
`representation_registry::tests::published_registry_matches_builtin_models`
drift test, which fails the moment a built-in representation changes without the
manifest being regenerated. The `mvp` block records the `B-014` spectra+image
MVP set: 12 IDs total — 8 `emitted` (already produced by the `nirs4all-io`
bridge, per `IO_spec.md` §5) and 4 image IDs (`gray_image`, `rgb_image`,
`mc_image`, `multispectral_image`) `landed_pending_emit` (landed in this crate;
`nirs4all-io` emission tracked by `IO-010`).

The registry is pinned in `conformance_pack.v1.json` and checked by
cross-repo `validate_contracts.py`; `dag-ml` consumes the same representation
IDs through `ModelInputSpec.accepted_representations`, while this crate keeps
the typed source of truth as `RepresentationId` / `TypeId`.
