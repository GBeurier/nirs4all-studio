# Status

Current state: 0.2.x RC release surface for the data-contract and provider
conformance layer (current package version: 0.2.9).

The release scope is intentionally bounded: schema/planning contracts,
coordinator envelopes, relations/FoldSet validation, deterministic fingerprints,
numeric buffers, N-D tensor transport, fitted adapter refs, in-memory provider
conformance, C ABI helpers, Python/WASM JSON-contract bindings and cross-repo
`dag-ml` fixtures are shipped and gated. Production host providers beyond the
externally-fed in-memory integration route and the nirs4all connector remain
explicit post-0.2.x backlog.

Implemented:

- Rust workspace with core, facade, C ABI and CLI crates;
- identifier, axis, representation, source and schema types;
- data view, presence mask and data-plan structs;
- schema validation and deterministic fingerprinting;
- adapter registry and deterministic path solver;
- model-input data-plan planner with fixtures;
- sample alignment planner for `inner`, `left` and `outer` multi-source
  policies, plus planner-visible `Align` steps before multi-source joins;
- sample relation validation for groups, repetitions and augmentation origins;
- `FoldSet` validation against sample relation group/origin boundaries, exposed
  through Rust core, Python, WASM and C ABI JSON helpers;
- canonical `FoldSet` fingerprints for replay/lineage identity, exposed through
  Rust core, Python, WASM and C ABI JSON helpers;
- shared `FoldSet` fixture parity with `dag-ml`, checked by
  `scripts/validate_contracts.py` and smoke-tested through Python/WASM
  bindings;
- Python/WASM contract manifests for production/browser integrations to assert
  package version, supported contracts, exported helpers and shared fixture
  digests before running a pipeline;
- ADR-11 structured error descriptors in Rust core, Python exception
  attributes, WASM error payloads and C ABI validation error payloads, guarded
  by `scripts/check_error_taxonomy.py`;
- Python facade contract wrappers for host integrations to pass validated
  `DatasetSchema`, `ModelInputSpec`, `AdapterRegistry`, `DataPlan`,
  `SampleRelationTable`, `FoldSet` and `CoordinatorDataPlanEnvelope` values
  instead of raw JSON strings only;
- optional nirs4all integration schema fields:
  `RepresentationSpec.signal_type`, source `ShapeContract`, `MetadataSchema`,
  `GroupSpec`, `FoldSpec` and `AugmentationMetadata`, all additive for v1
  readers and covered by the `nirs4all-core` Python/WASM smoke fixture;
- sample relation fingerprints;
- coordinator data-plan envelope export with schema, plan and relation
  fingerprints;
- optional additive data and target content fingerprints on coordinator
  envelopes, validated by Rust and the shared JSON contract;
- explicit coordinator data-plan envelope schema version with unsupported
  version refusal;
- published JSON Schema artifact for coordinator data-plan envelopes, with a
  unit smoke that keeps its declared version aligned to the Rust contract;
- stdlib shared-contract validation script plus CI checkout of `dag-ml` so
  schema copies and coordinator fixtures cannot drift silently;
- CI documentation and packaging gates (`cargo doc` with rustdoc warnings
  denied, plus workspace `cargo package --no-verify`) for release readiness;
- Sphinx/MyST docs-site scaffold with a warnings-denied CI build and release
  metadata validation, so ADR-09 has a local build gate before hosted docs;
- ADR-14 managed-debt CI lint for production-path `TODO`/`FIXME` markers and
  Rust `#[deprecated]` attributes, with release metadata enforcing the gate;
- public Rust documentation coverage ratchet in CI, currently enforcing the
  measured baseline while leaving the 95% invariant-docstring target explicit
  for the hardening backlog;
- ADR-10 publish-plan CI check that validates internal Cargo dependency
  version pinning and dry-runs independently publishable root crates;
- CI MSRV gate with Rust 1.83.0 and `cargo check --workspace --all-targets`,
  matching the current PyO3 0.28.x floor;
- CI supply-chain audit gate with pinned `cargo-audit` and
  `cargo audit --deny warnings`;
- CI Python wheel metadata smoke for name/version, `Requires-Python`,
  `CeCILL-2.1 OR AGPL-3.0-or-later` license packaging, `abi3`, native
  extension, stubs and `py.typed`;
- CI WASM package tarball gate via `wasm-pack pack` for browser-target npm
  artifacts;
- CI npm tarball metadata gate via `npm pack --dry-run --json` for WASM
  package name/version, integrity, bundled-dependency absence and required
  published files;
- WASM smoke validation for generated npm package metadata, including package
  name, version, JS entry, typings, required emitted files and expected
  TypeScript exports;
- release metadata validator for Cargo workspace inheritance, internal crate
  version pins, Python PEP 440 package version, `abi3-py311`, MSRV/toolchain
  pins, MSRV-sensitive dependency pins, required governance files and the
  docs-site / managed-debt / publish-plan CI gates;
- public C ABI snapshot manifest for `dag_ml_data.h`, validated in CI so
  header changes cannot drift silently;
- shared parity-oracle handoff manifest for the first nirs4all-core parity
  cases, with fixture/gate references validated against `dag-ml`;
- shared conformance-pack manifest with canonical schema/fixture digests, C ABI
  requirements and required cross-repo checks, kept JSON-identical with
  `dag-ml`;
- conversion from `SampleRelationTable` to DAG-ML coordinator relation records;
- coordinator materialization request and handle-record contracts for validated
  data handles;
- in-memory coordinator handle arena that materializes envelopes into opaque
  handle records with run/node/phase/variant/fold/fingerprint traceability;
- materialized data handles scope coordinator relations to the request
  `source_ids`, so child views cannot expose observations from sources that
  were not materialized;
- identity-filtered view handles from `DataView`, preserving repeated
  observations while allowing sample/source/augmentation selection and honoring
  explicit requested sample order;
- sample-level target value alignment for view handles with deterministic
  de-duplication across repeated observations in view sample order;
- multi-target target alignment through `CoordinatorMultiTargetBlock` and
  `dagmldata_coordinator_multi_target_arrow_json`, preserving view sample order
  while emitting nullable per-target Arrow columns and validity masks;
- observation-level feature table alignment for view handles, preserving
  repeated observations, applying `DataView.columns` and keeping view sample
  order;
- executable observation-level feature fusion for aligned multi-source feature
  blocks, including namespaced columns, repetition-preserving reference rows,
  singleton-source broadcast, deterministic outer synthetic rows and explicit
  refusal of ambiguous repeated non-reference sources;
- feature exports now validate that the feature table representation matches
  the materialized data-plan output representation for the parent view handle;
- CLI `materialize-envelope` smoke command;
- Arrow C Data ABI structs, release helpers and coordinator identity-table
  export from validated envelopes;
- Arrow C Data numeric target-table export through materialized view handles;
- Arrow C Data numeric feature-table export through materialized view handles;
- Arrow C Data numeric feature-fusion export for aligned multi-source feature
  blocks;
- JSON and ABI-owned f64 numeric feature-collation exports for row-major tensor
  conformance;
- Rust-owned in-memory provider vtable with materialize, make-view,
  view-identity, target, feature, release and destroy callbacks;
- in-memory provider feature tables are converted once at provider creation
  into typed numeric buffers, so provider exports no longer re-parse JSON values
  on every `feature_arrow` call;
- typed numeric feature buffers now live in `dag-ml-data-core` as reusable
  column-major `NumericFeatureBuffer` contracts with projection tests, rather
  than being private C ABI fixture logic;
- typed row-major `NumericFeatureMatrixF64` input with optional validity masks
  converts directly to column-major buffers without per-cell
  `serde_json::Value` parsing on the numeric conformance path;
- typed numeric feature buffers are grouped behind a core
  `NumericFeatureBufferStore` with deterministic manifests, row/feature/value
  counts, estimated value bytes and stable buffer fingerprints;
- materialized data handles now receive deterministic `NumericFeatureBufferBinding`
  records for the feature buffers whose representation and observation coverage
  match that handle's scoped coordinator relations;
- the store and binding lifecycle now live behind the reusable core
  `NumericFeatureBufferArena`, so production providers can share the same
  manifest, bind, project and release contract instead of reimplementing it in
  the C ABI layer;
- provider `feature_arrow` accepts JSON fusion selectors and routes
  source-filtered provider-owned feature buffers through the core feature-fusion
  kernel;
- provider feature, fusion and collation exports validate that the selected
  buffer is bound to the parent data handle and requested source scope before
  exporting Arrow, JSON tensors or ABI-owned tensors;
- executable numeric late-collation kernel for feature blocks and ragged numeric
  rows, producing row-major tensor blocks with deterministic padding,
  truncation, presence masks and value-validity masks;
- provider-backed feature collation over in-memory provider typed buffers,
  including fusion selectors, returning deterministic JSON `NumericTensorBlock`
  or ABI-owned `DagMlDataTensorF64` output without changing the provider vtable
  layout;
- provider-owned feature-buffer manifests are exported as JSON through the C ABI
  for binding conformance and lifecycle validation;
- provider construction accepts typed f64 feature matrices through the C ABI as
  the preferred conformance path for numeric feature buffers;
- provider construction also accepts borrowed C `DagMlDataFeatureMatrixF64View`
  descriptors, copying them into Rust-owned feature buffers during the
  constructor call so bindings can avoid JSON numeric value transport;
- provider construction also accepts borrowed C
  `DagMlDataFeatureMatrixF64ColumnarView` descriptors with per-column f64
  slices and optional per-column validity bitmaps, mirroring production
  columnar layouts (Arrow IPC, Parquet, NumPy column ndarrays) and avoiding
  the row-major transpose copy paid by the row-major borrowed view path;
- coordinator and provider-backed feature collation now also return owned
  row-major `DagMlDataTensorF32` blocks beside the existing
  `DagMlDataTensorF64` exports. The collation kernel still operates in f64 to
  preserve canonical numeric semantics; values are cast to f32 at the ABI
  boundary and rejected with `ValidationError` if any padded value, finite
  input or padding fallback does not round-trip into a finite f32 (overflow
  to infinity, or non-finite input). The C ABI exposes
  `DAG_ML_DATA_TENSOR_F32_ABI_VERSION`, `dagmldata_tensor_f32_free` and the
  matching `coordinator`/`inmemory_provider` collation entry points;
- `DataView` now carries an optional `branch_view` field shaped as
  `CoordinatorBranchView` (`view_id`, `branch_id`, `mode`, `selector`,
  `allow_overlap`, `metadata`), mirroring `dag-ml`'s `BranchViewPlan` wire
  contract. `make_view` validates the mode↔selector field agreement and
  natively executes `by_source` branch views as an additional intersection
  over the existing source filter. `by_metadata` and `by_tag` match the
  relation metadata/tags carried in the envelope, and `by_filter` executes the
  closed `metadata_equals`/`tags_all` predicate. Empty, unknown or mixed
  predicates fail before row projection. `separation` mode passes through (the
  selector annotates branch identity and the host scheduler owns non-overlap);
- published `coordinator_branch_view.schema.json` for that contract, with
  matching `COORDINATOR_BRANCH_VIEW_SCHEMA_ID` Rust constant, the same digest
  pinned in both repos' `conformance_pack.v1.json` and
  `scripts/validate_contracts.py` validating the published schema artifact
  shape + mode enum coverage in both `dag-ml-data` and the sibling `dag-ml`
  checkout;
- file-backed persistence for `FittedAdapterManifest`:
  `FittedAdapterManifest::write_to_path` writes pretty-printed JSON to disk
  after running the same `validate`/`validate_portable` gate that
  `read_from_path` enforces on load. The `require_portable` flag is honored
  symmetrically so manifests can never be persisted in a state that would
  not load cleanly on the other side, giving hosts a real cross-process
  persistence path without taking on a serialization dependency in core;
- runtime fitted-adapter store: `RuntimeFittedAdapterStore` trait plus the
  in-memory `InMemoryFittedAdapterStore` that registers `FittedAdapterRef`
  records, allocates deterministic opaque u64 handles, and materializes them
  on request after validating the request's `adapter_id` and
  `params_fingerprint` against the registered ref. `register_manifest`
  accepts a `FittedAdapterManifest` for bulk registration; the store never
  reads, writes or deserializes adapter payloads — payload materialization
  stays host-side, behind the opaque handle, mirroring the dag-ml
  `RuntimeArtifactStore` lifecycle for model artifacts. The store is
  `Send + Sync` (backed by `std::sync::Mutex`), so the same handle can be
  shared across host threads through the C ABI without external locking;
  poisoned-mutex errors surface as validation failures rather than silent
  recoveries;
- C ABI for the in-memory fitted-adapter store:
  `DagMlDataFittedAdapterStoreHandle` opaque pointer with
  `dagmldata_inmemory_fitted_adapter_store_new` / `destroy` lifecycle,
  `register_json` / `materialize_json` for JSON round-trips through the
  Rust runtime store and `release` for adapter-id-keyed teardown. Errors
  carry an owned `DagMlDataString`. Allows non-Rust bindings to drive the
  full register/materialize/release cycle through the ABI without parsing
  JSON inside Rust;
- the in-memory provider can attach a fitted-adapter store through
  `dagmldata_inmemory_provider_attach_fitted_adapter_store`, after which
  host controllers running through the provider's vtable can materialize
  fitted adapters via
  `dagmldata_inmemory_provider_materialize_fitted_adapter_json`. The
  provider holds a `Mutex`-guarded borrowed pointer to the store (the
  caller keeps ownership), passing a null handle detaches without freeing.
  Closes the gap where the fitted-adapter contract layer had no
  scheduler-time consumer: the provider is now the consumer, the same way
  the artifact store on `dag-ml` is consumed by REFIT-phase controllers
  going through the runtime provider;
- published `fitted_adapter_ref.schema.json` for the data-side fitted adapter
  contract, with matching `FITTED_ADAPTER_REF_SCHEMA_ID` Rust constant, the
  same digest pinned in both repos' `conformance_pack.v1.json` and
  `scripts/validate_contracts.py` validating the published schema artifact in
  both repos. The C ABI exposes `dagmldata_fitted_adapter_ref_validate_json`
  and `dagmldata_fitted_adapter_manifest_validate_json`; both take a
  `require_portable` byte flag selecting between inline and portable
  validation modes and return `ValidationError` plus an error string on
  failure;
- fitted adapter serialization contract: `FittedAdapterRef`
  (`adapter_id`, `adapter_version`, `params_fingerprint`, optional
  `backend`/`uri`/`content_fingerprint`/`size_bytes`/`plugin`/`plugin_version`/
  `metadata`) plus `FittedAdapterBackend` (joblib/pickle/json/numpy/onnx/raw)
  and `FittedAdapterManifest` (versioned collection of refs). Validation has
  two modes: `validate()` accepts inline refs while `validate_portable()`
  requires backend + safe relative URI + content fingerprint, refusing
  absolute paths, Windows drive prefixes, URI schemes, colons in the first
  path segment and `..` traversal. The manifest enforces unique adapter ids
  and key-vs-ref consistency. This lets `dag-ml` replay restore stateful
  data-side adapters the same way `ArtifactRef` already covers fitted
  models, without serializing adapter binaries inside the core;
- data-handle-scoped feature-buffer bindings are exported as JSON through the C
  ABI and become invalid when the parent data handle is released;
- provider vtable release conformance, including parent data-handle release
  invalidating child view handles;
- C header and linked C runtime smokes for the provider vtable and Arrow
  signatures;
- `dag_ml_data.h` and `dag_ml.h` share a guarded data-provider vtable ABI
  version macro and are compiled together in both include orders when the
  sibling checkout is present;
- Python `ctypes` smoke for the same provider lifecycle;
- installable stdlib-only Python provider package (`dag_ml_data_provider`) in
  `crates/dag-ml-data-capi/bindings/python`, plus a reusable CLI smoke in
  `examples/python` that imports it;
- C ABI schema fingerprint entry point;
- example schema fixture;
- CI workflow;
- file-backed numeric feature buffer persistence: deterministic `.n4d` byte
  format (`N4DF` magic + LE u32 version/count + per-buffer typed
  column-major payload + SHA-256 trailer) implemented in
  `buffer_file_store.rs`. `serialize_columnar_store` / `deserialize_columnar_store`
  round-trip buffer fingerprints byte-identically across processes;
  `write_store_to_path` / `read_store_from_path` wrap the same logic with
  filesystem diagnostics. Rejects unknown magic, unsupported version,
  truncated payload, SHA-256 mismatch, malformed validity bytes;
- file-backed provider C ABI entry point
  `dagmldata_inmemory_provider_new_from_file` constructs the same
  `InMemoryProvider` from a `.n4d` file path. Lets hosts persist provider
  feature buffers across processes without re-ingesting the source data;
- `AxisKind::Wavenumber` added to `dag-ml-data-core/src/model.rs`. The
  axis kind serializes as `"wavenumber"` and is accepted by
  `RepresentationSpec::validate`. Unblocks IR and Raman spectroscopy
  representations without introducing NIRS-specific business logic;
- ADR-0001 publishes the official ownership of the
  `SpectroDataset → CoordinatorDataPlanEnvelope` bridge:
  **`nirs4all-io` owns the bridge**, `dag-ml-data` ROADMAP Phase 4 is
  descoped. Resolves the `nirs4all-io` PHASE2_GATE item 7 blocker;
- host-callback feature-buffer provider: new C ABI vtable
  `DagMlDataBufferFetcherVTable` (single `fetch_columnar` callback +
  destroy) plus `DagMlDataBufferFetchRequest` pair (`feature_set_id`,
  `content_fingerprint`) so hosts can fetch buffer bytes by id at
  construction time without packaging them as JSON or borrowed views.
  The constructor `dagmldata_inmemory_provider_new_with_buffer_fetcher`
  drives the fetcher for each declared request, copies returned views
  into Rust-owned buffers via the existing typed columnar path, and
  invokes the fetcher's `destroy` callback exactly once before
  returning (success or failure). ABI version macro
  `DAG_ML_DATA_BUFFER_FETCHER_ABI_VERSION = 1`;
- Apache Arrow IPC feature-buffer reader: new optional crate
  `dag-ml-data-arrow` exposes
  `read_buffers_from_ipc_stream`/`_file`/`_path` that consume Arrow IPC
  streams or files and resolve each `RecordBatch` to a
  `NumericFeatureMatrixF64Columnar`. The mapping requires schema metadata
  `dag_ml_data.feature_set_id` + `dag_ml_data.representation_id` and an
  `observation_id` Utf8 column; Float64 feature columns translate
  validity-aware to `Option<f64>` masks. The capi crate exposes
  `dagmldata_inmemory_provider_new_from_arrow_ipc` behind the
  `arrow-ipc` feature flag so core consumers don't pay the Arrow
  dependency by default;
- a dedicated `dag-ml-data-provider` crate factors the in-memory provider
  behind a `DagMlDataProvider` trait with a single `Mutex<ProviderArenas>`
  (linearizable materialize / make-view / release) and a shared
  `JsonInMemoryProvider` facade. Language shims consume the C ABI: a
  stdlib-only Python `ctypes` package (`dag_ml_data_provider`), a
  `dag-ml-data-wasm` binding, and a workspace-excluded extendr R package
  (`dagmldata`);
- borrowed N-D tensor transport: core `NdTensor*` (rank 1..=16, axis 0 = sample,
  keyed by `observation_id`) is materialized and bound under the provider lock.
  The C ABI accepts borrowed `DagMlDataBorrowedTensorView`s (strided input copied
  to canonical row-major) and returns view-filtered `DagMlDataOwnedTensor`s via
  `dagmldata_inmemory_provider_new_with_tensor_views` /
  `nd_tensor_manifest_json` / `nd_tensor_export_json` / `nd_tensor_free`, with
  `DAG_ML_DATA_BORROWED_TENSOR_VIEW_ABI_VERSION` and
  `DAG_ML_DATA_OWNED_TENSOR_ABI_VERSION` mirrored in the conformance pack;
- typed axis coordinate contract: `AxisSpec.coordinate: Option<CoordinateSpec>`
  (numeric / categorical / datetime dtype, `ordered`, explicit list or numeric
  regular grid) replaces the untyped `coordinates`, with full validation and
  `deny_unknown_fields`;
- discriminated, host-routable `DataError` variants (ADR-11 granularity):
  `FingerprintMismatch` (compatibility), `UnknownHandle` (runtime),
  `RelationBoundaryViolation` and `IncompatibleReducer` (data),
  `SignalTypeMismatch` (compatibility) — each with a stable numeric code, so a
  host can route a fingerprint/leakage/handle/signal failure instead of one
  opaque validation code;
- ADR-07 aggregation reducer contract (`aggregation.rs`): flat
  `deny_unknown_fields` `AggregationPolicy` (mean / weighted_mean / median / vote
  / robust_mean / exclude_outliers / custom) with per-reducer parameter and
  cross-parameter validation and `validate_for_task` (vote is classification
  only). Exposed over the C ABI as `dagmldata_aggregation_policy_validate_json`.
  No reducer math in core (the bridge owns it);
- ADR-06 signal-type validation: `SignalKind::as_str` +
  `require_signal_type_match(expected, actual, allow_unknown)` reusable contract
  helper (caller-decided `Unknown` policy: tolerated at train, refused at
  predict);
- CI hardening: an AddressSanitizer lane over the C-ABI `--lib` unsafe surface,
  the capi `arrow-ipc` feature compiled+tested, the WASM `provider` feature
  built, and the stdlib-only ctypes provider package pip-installed + smoked. The
  public-doc ratchet floor is raised to track the current coverage (33% floor,
  measured 33.7%).
- frozen, published built-in representation registry (`B-014` / `DMD-001`):
  `representation_registry()` derives a deterministic `RepresentationRegistry`
  from `BUILTIN_DATA_MODELS` (26 IDs, each with its frozen `RepresentationSpec`,
  `BuiltinDataModel` key, modality and an optional spectra+image MVP
  annotation), published as the `docs/contracts/representation_registry.v1.json`
  contract artifact and emitted by the CLI `representation-registry` command. A
  drift test (`published_registry_matches_builtin_models`) freezes the manifest
  against `builtin_models.rs`; no new representation vocabulary is introduced.
  The `mvp` block records the spectra+image MVP set (12 IDs: 8 `emitted` by the
  `nirs4all-io` bridge, 4 image IDs `landed_pending_emit` per `IO-010`).
  Cross-repo `conformance_pack.v1.json` / `validate_contracts.py` lockstep
  wiring with `dag-ml` is the next `DMD-001` slice.

Post-0.2.x backlog:

- production provider arenas for fused feature exports (the borrowed N-D tensor
  transport is now implemented; fused-feature exports remain in-memory-only);
- keep the documented ADR-07 aggregation mapping current; `robust_mean` /
  `exclude_outliers` remain data-side reducers unless a future shared
  `aggregation_reducer_policy.v1` schema is added;
- wire `require_signal_type_match` into materialize/predict — blocked on a paired
  `dag-ml` lineage/bundle change that carries the expected signal type (no
  speculative `expected_signal_type` request field added);
- nirs4all connector (descoped — owned by `nirs4all-io`, see ADR-0001).

Next recommended post-0.2.x task:

Write the honest host-adapter backlog in `dag-ml/docs/HOST_ADAPTER_BACKLOG.md`:
process-adapter JSONL pattern is the only stable wire protocol for
Python/R hosts, persistent pool infrastructure is already shipped, the
existing sklearn smoke covers ~70% of a production sklearn controller,
and SpectroChemPy/Orange-Spectroscopy are Python rather than R despite
the user grouping them as such.
