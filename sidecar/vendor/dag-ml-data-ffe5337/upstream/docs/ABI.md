# C ABI

The data ABI lets a host runtime keep buffers and fitted data adapters in its own
memory while exposing deterministic descriptors and identity tables to the core.

Validation failures written to `error_out` use the ADR-11 descriptor JSON shape:
`category`, `code`, `severity`, `message`, `remediation_hint` and `context`.
Null-pointer preflight errors still use the legacy human string because callers
usually branch on `DagMlDataStatusCode` before parsing a payload.

## Current Scaffold

`crates/dag-ml-data-capi/include/dag_ml_data.h` exposes:

- version, string-free and tensor-free helpers;
- `dagmldata_schema_fingerprint_json`;
- `dagmldata_aggregation_policy_validate_json`, which validates an ADR-07
  aggregation-policy payload (reducer name plus its parameters);
- Arrow C Data `ArrowArray` and `ArrowSchema` structs plus release helpers;
- `DagMlDataTensorF64`, an owned row-major f64 tensor descriptor with identity,
  shape, values, optional masks and feature names;
- `DAG_ML_DATA_TENSOR_F64_ABI_VERSION`, the C-visible ABI version expected in
  each f64 tensor descriptor;
- `DagMlDataTensorF32`, an owned row-major f32 tensor descriptor mirroring the
  f64 descriptor for bindings that consume f32 inputs natively (deep-learning
  frameworks, GPU pipelines);
- `DAG_ML_DATA_TENSOR_F32_ABI_VERSION`, the C-visible ABI version expected in
  each f32 tensor descriptor;
- `DagMlDataFeatureMatrixF64View`, a borrowed C view over one row-major f64
  feature matrix;
- `DagMlDataFeatureMatrixF64ColumnarView` plus `DagMlDataF64ColumnView`, a
  borrowed C view over one column-major f64 feature matrix with per-column
  validity bitmaps, mirroring Arrow/Parquet/NumPy columnar layouts;
- `dagmldata_coordinator_identity_arrow_json` for identity-table smoke tests
  from a validated coordinator envelope;
- `dagmldata_coordinator_target_arrow_json` for numeric target-table smoke tests
  from a validated envelope, materialization request, `DataView` and target
  table;
- `dagmldata_coordinator_multi_target_arrow_json` for multi-output target
  export from the same envelope/view contracts, with one nullable f64 column per
  target and a per-target validity bitmap;
- `dagmldata_coordinator_feature_arrow_json` for numeric observation-level
  feature-table smoke tests from the same coordinator/view contracts;
- `dagmldata_coordinator_feature_fusion_arrow_json` for numeric multi-source
  fused feature-table smoke tests over already materialized coordinator feature
  blocks;
- `dagmldata_coordinator_feature_collation_json` for JSON row-major tensor
  collation smoke tests over coordinator feature blocks;
- `dagmldata_coordinator_feature_collation_tensor_f64_json` for ABI-owned
  row-major f64 tensor export over coordinator feature blocks;
- `dagmldata_coordinator_feature_collation_tensor_f32_json` for ABI-owned
  row-major f32 tensor export over the same coordinator feature blocks, with
  rejection of values that do not round-trip into a finite f32;
- `dagmldata_inmemory_provider_new_json` for a Rust-owned provider vtable that
  materializes data handles, creates view handles, exports view identity, exports
  numeric targets and supports release/destroy callbacks;
- `dagmldata_inmemory_provider_new_with_features_json` for the same provider
  plus JSON feature tables used by binding conformance tests;
- `dagmldata_inmemory_provider_new_with_f64_features_json` for the same provider
  plus typed row-major f64 feature matrices with an optional validity mask;
- `dagmldata_inmemory_provider_new_with_f64_feature_views` for the same provider
  plus borrowed C `DagMlDataFeatureMatrixF64View` descriptors, avoiding JSON
  value transport for numeric feature matrices;
- `dagmldata_inmemory_provider_new_with_f64_feature_columns` for the same
  provider plus borrowed C `DagMlDataFeatureMatrixF64ColumnarView` descriptors
  with per-column f64 slices and optional per-column validity bitmaps,
  avoiding the row-major transpose copy on the production columnar ingestion
  path;
- `dagmldata_inmemory_provider_feature_buffer_manifest_json` for deterministic
  JSON manifests of provider-owned numeric feature buffers;
- `dagmldata_inmemory_provider_data_feature_buffer_manifest_json` for
  data-handle-scoped feature-buffer bindings;
- `dagmldata_inmemory_provider_feature_collation_json` for JSON row-major
  tensor collation from feature buffers owned by the in-memory provider;
- `dagmldata_inmemory_provider_feature_collation_tensor_f64_json` for ABI-owned
  row-major f64 tensor export from provider-owned feature buffers;
- `dagmldata_inmemory_provider_feature_collation_tensor_f32_json` for ABI-owned
  row-major f32 tensor export from the same provider-owned feature buffers,
  with the same finite-f32 rejection contract as the coordinator entry point;
- `DataView.branch_view` (a `CoordinatorBranchView` carrying `view_id`,
  `branch_id`, `mode`, `selector`, `allow_overlap` and `metadata`), letting
  hosts pass `dag-ml` `BranchViewPlan` records straight through the existing
  `make_view` selector JSON. The in-memory provider executes `by_source`,
  `by_metadata` and `by_tag` branch views natively and lets `separation` pass
  through. `by_filter` is deliberately a closed native predicate,
  `{"metadata_equals": {…}, "tags_all": […]}`: at least one constraint is
  required and unknown fields at every selector/predicate level are rejected
  as `ValidationError` before any row projection. Typed and JSON
  `view_identity` preserve the matched coordinator relations verbatim;
- `FittedAdapterRef` and `FittedAdapterManifest`, a JSON-serializable
  fitted-adapter persistence contract with `validate()` for inline refs and
  `validate_portable()` for refs carrying a backend + safe relative URI +
  content fingerprint (the same portability rules as `dag-ml`'s
  `ArtifactRef::validate_portable`). The manifest enforces unique adapter
  ids and key↔ref consistency;
- `dagmldata_fitted_adapter_ref_validate_json` and
  `dagmldata_fitted_adapter_manifest_validate_json` C ABI entry points that
  parse JSON, run the `validate()` or `validate_portable()` Rust check
  selected by the `require_portable` byte flag and return either `Ok` or
  `ValidationError` + an owned error string. The matching
  `fitted_adapter_ref.v1.schema.json` is published under `docs/contracts`
  and pinned in `conformance_pack.v1.json` for cross-repo digest equality;
- `DagMlDataFittedAdapterStoreHandle` opaque pointer plus
  `dagmldata_inmemory_fitted_adapter_store_new` / `destroy` /
  `register_json` / `materialize_json` / `release` entry points exposing
  the Rust `InMemoryFittedAdapterStore` to non-Rust bindings. Host callers
  receive a `u64` handle from register / materialize and own its release
  through `dagmldata_inmemory_fitted_adapter_store_release` (by adapter
  id) and the store-level `destroy` call;
- `DagMlDataVTable` with materialize/view/identity/target/feature/release hooks.
  The `feature_arrow` hook accepts either a plain feature-set id or a JSON
  feature-fusion selector. The vtable uses the shared
  `DAG_ML_DATA_PROVIDER_VTABLE_ABI_VERSION` macro and guarded
  `DagMlDataVTable` definition so `dag_ml_data.h` and `dag_ml.h` can be
  included together by bindings.

The coordinator envelope wire shape is versioned as
`CoordinatorDataPlanEnvelope` v1 and published at
`docs/contracts/coordinator_data_plan_envelope.schema.json`. Runtime validation
continues to check the stronger semantic contract: schema/data-plan/relation
fingerprints, identity consistency and materialization-request compatibility.

## Ownership Rules

| Object | Owner | Release path |
|---|---|---|
| Materialized data handle | Host | `DagMlDataVTable.release` |
| View handle | Host | `DagMlDataVTable.release` |
| Fitted adapter handle | Host | future fitted-adapter release hook |
| Rust error/fingerprint string | Rust allocation returned through ABI | `dagmldata_string_free` |
| Rust-owned f64 tensor descriptor and nested arrays | Rust allocation returned through ABI | `dagmldata_tensor_f64_free` |
| Rust-owned f32 tensor descriptor and nested arrays | Rust allocation returned through ABI | `dagmldata_tensor_f32_free` |
| Arrow arrays/schemas returned by Rust helpers | Rust allocation returned through ABI | `dagmldata_arrow_array_free`, `dagmldata_arrow_schema_free` |
| Arrow arrays produced by host vtables | Producer of the Arrow array | Arrow C Data Interface release callback |
| Rust-owned in-memory provider vtable | Rust allocation behind `user_data` | `DagMlDataVTable.destroy` or `dagmldata_inmemory_provider_destroy` |
| Borrowed `DagMlDataFeatureMatrixF64View` inputs | Caller | copied during constructor call; caller may release after return |
| Borrowed `DagMlDataFeatureMatrixF64ColumnarView` inputs (and nested `DagMlDataF64ColumnView` columns) | Caller | copied during constructor call; caller may release after return |

## Coordinator Identity Export

`dagmldata_coordinator_identity_arrow_json` is a narrow smoke helper, not the
final provider implementation. It validates a `CoordinatorDataPlanEnvelope` and
exports one Arrow struct row per coordinator relation with:

- `observation_id`, `sample_id`, `target_id`, `group_id`;
- `origin_sample_id`, `source_id`, `is_augmented`.

This is enough for ABI consumers to verify sample/repetition/group/augmentation
identity transfer before full buffer-backed provider lifecycles exist.

`dagmldata_coordinator_target_arrow_json` extends the smoke path to
sample-level targets. It materializes the envelope, creates a `DataView`, aligns
target values to the selected samples and emits `sample_id`, `target_id` and
numeric `value` columns. Repeated observations are intentionally de-duplicated
to one target value per sample.

`dagmldata_coordinator_multi_target_arrow_json` uses the same materialization
path for multi-output regression/classification targets. Its request carries
`target_tables` and its Arrow result emits `sample_id` plus one nullable f64
column per target id. Missing or explicit null values are represented by that
target column's validity bitmap rather than by dropping samples.

`dagmldata_coordinator_feature_arrow_json` is intentionally observation-level.
It materializes the same envelope/view, preserves repeated observations, applies
`DataView.columns`, and emits `observation_id`, `sample_id` plus one numeric
column per selected feature. This keeps the target aggregation rule separate
from feature row identity.

`dagmldata_coordinator_feature_fusion_arrow_json` exercises the pure Rust
feature-fusion kernel through the C ABI. It accepts a request shaped as
`{ feature_set_id, sources, alignment, source_layout?, policy? }`, where each
source contains a `source_id` and a `CoordinatorFeatureBlock`. When present,
`source_layout` is validated against those concrete blocks: source order,
per-source preprocessing output feature-set/representation, and contiguous
feature-axis concat spans must match. The exported Arrow table preserves
reference-source repeated observations, broadcasts singleton rows from secondary
sources, namespaces fused feature columns by default and refuses incoherent
presence masks or ambiguous repeated secondary sources.

`dagmldata_coordinator_feature_collation_json` exercises the pure Rust numeric
late-collation kernel through the C ABI. It accepts `{ feature_block, policy? }`
and returns a JSON `NumericTensorBlock` with observation/sample identity,
row-major shape and values, optional presence mask and optional value-validity
mask. It is a conformance helper, not a provider lifecycle.

`dagmldata_coordinator_feature_collation_tensor_f64_json` exports the same
result as an ABI-owned `DagMlDataTensorF64` instead of JSON. The tensor carries
`abi_version`, block/representation/container strings, observation ids, sample
ids, `shape`, contiguous row-major `values`, optional `presence_mask`, optional
`validity_mask` and optional `feature_names`. Masks are byte arrays with values
0 or 1. The caller must release the tensor with `dagmldata_tensor_f64_free`.

`dagmldata_coordinator_feature_collation_tensor_f32_json` mirrors that surface
with a `DagMlDataTensorF32` output. The kernel still runs in f64 to preserve
canonical numeric semantics; each value is cast to f32 at the ABI boundary and
the call returns `ValidationError` if any padded value, finite input or
padding fallback does not round-trip into a finite f32. The caller must
release the tensor with `dagmldata_tensor_f32_free`. The same f32 entry point
is available against provider-owned feature buffers through
`dagmldata_inmemory_provider_feature_collation_tensor_f32_json`.

`dagmldata_inmemory_provider_feature_collation_json` and
`dagmldata_inmemory_provider_feature_collation_tensor_f64_json` exercise the
same late-collation kernel against provider-owned typed numeric buffers. They
accept `{ feature_set_id, policy? }` for a single provider feature table or
`{ fusion, policy? }` where `fusion` is the provider feature-fusion selector.
The JSON export is a conformance/debug path; the `DagMlDataTensorF64` export is
the binding-oriented path. These helpers are specific to vtables created by
`dagmldata_inmemory_provider_new_with_features_json`; they do not change the
stable `DagMlDataVTable` layout.

`dagmldata_inmemory_provider_feature_buffer_manifest_json` returns an array of
`NumericFeatureBufferManifest` values for the provider-owned typed buffers. Each
manifest includes the feature-set id, representation id, feature and observation
ids, row/feature/value counts, estimated f64 storage bytes and a deterministic
buffer fingerprint. Bindings can use this before creating feature views or
tensors to verify that the provider loaded the expected data buffers.

`dagmldata_inmemory_provider_data_feature_buffer_manifest_json` returns
`NumericFeatureBufferBinding` values for one live materialized data handle. A
binding is created by the core `NumericFeatureBufferArena` during `materialize`
only when a provider buffer has the same output representation as the data
handle and covers the handle's scoped coordinator observations for one or more
source ids. The binding export refuses unknown or released data handles.

## In-Memory Provider VTable

The in-memory provider is the current ABI conformance target. It accepts one
validated coordinator envelope plus optional sample-level target tables and
observation-level feature tables, then implements:

- `materialize`: validates a coordinator materialization request and returns an
  opaque data handle whose coordinator relations are scoped to the requested
  `source_ids`;
- `make_view`: applies a `DataView` to a data handle and returns an opaque view
  handle;
- `view_identity`: returns the filtered relation table as Arrow C Data;
- `target_arrow`: returns sample-level numeric targets aligned to the view;
- `feature_arrow`: returns observation-level numeric features aligned to the
  view and filtered by `DataView.columns` when passed a plain feature-set id;
  when passed `{ feature_set_id, sources, alignment, source_layout?, policy? }`
  JSON, where each source is `{ source_id, feature_set_id, columns? }`, it fuses
  provider-owned source feature buffers through the core feature-fusion kernel;
- `release` and `destroy`: release handles and provider state.

The conformance provider can still receive small JSON fixture feature tables at
construction time, but the preferred numeric paths are typed row-major
`NumericFeatureMatrixF64` input with optional validity masks and direct borrowed
C `DagMlDataFeatureMatrixF64View` descriptors. The borrowed descriptors are
copied into Rust-owned buffers during construction; after the constructor
returns, callers may release their input arrays. All construction paths convert
once into column-major `NumericFeatureBuffer` values grouped by
`NumericFeatureBufferArena` in the provider state. At `materialize`, the arena
computes data-handle-scoped buffer bindings from the scoped coordinator
relations and materialized output representation. `feature_arrow` exports are
then view projections over bound buffers, not per-call JSON numeric parsing.
Borrowed JSON arguments are also consumed synchronously: bindings retain the
input only until the call returns, not for the lifetime of a handle. Provider
`release` disposes the requested handle; `destroy` disposes all provider state.
Fusion selectors reuse those typed buffers, filter each source by source
identity in the view, validate that each source buffer is bound to the parent
data handle through the arena, and then call the same pure Rust fusion kernel
used by the standalone ABI helper. Provider feature-collation selectors then
collate either a single feature table or the fused block into deterministic
row-major JSON or `DagMlDataTensorF64` tensors without reparsing feature values.
Full provider implementations will use the same vtable shape while keeping
production data buffers host-owned.

`tests/c_header_smoke.rs` has two C checks: a header syntax smoke with
`cc -fsyntax-only`, and a linked C program that loads the Rust `cdylib`, creates
the provider vtable, materializes a view, exports identity, target and feature
Arrow arrays, then releases all handles.
The syntax smoke also includes the sibling `dag_ml.h` in both include orders
when a `dag-ml` checkout is available, so shared data-provider vtable guards
cannot drift silently.

`tests/python_ctypes_smoke.rs` performs the same provider lifecycle from Python
using only `ctypes`. It also runs `examples/python/provider_smoke.py` against the
installable `dag_ml_data_provider` package
(`crates/dag-ml-data-capi/bindings/python`), a stdlib-only ctypes wrapper around
the provider vtable. The package is the binding-friendly conformance target for
materialize, view creation, identity export, target export, feature export,
release and destroy; it locates the cdylib via `library_path=` /
`DAG_ML_DATA_CAPI_LIB` / the Cargo target dir.

## ABI Roadmap

1. Freeze byte/string/status conventions.
2. Add C smoke test for schema fingerprinting.
3. Add path-solving and data-plan validation over canonical JSON.
4. Add native host provider conformance against the current
   identity/target/feature behavior.
5. Add ABI conformance for the core multi-source feature-fusion and numeric
   collation kernels.
6. Route in-memory provider `feature_arrow` fusion selectors through the same
   kernel.
7. Route in-memory provider feature-collation selectors through provider-owned
   typed buffers.
8. Expose provider-backed collation as `DagMlDataTensorF64` for bindings.
9. Expose provider-owned feature-buffer manifests for binding conformance.
10. Bind compatible feature buffers to live materialized data handles and
    validate those bindings before Arrow/tensor export.
11. Add typed f64 matrix provider construction, including borrowed C matrix
    views, avoiding per-cell JSON values on the numeric conformance path.
12. Replace in-memory typed fixture buffers with production feature-buffer
   lifecycles.
