# Changelog

All notable changes to `dag-ml-data` are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project aims
to adhere to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Coordinator-envelope and other wire-shape changes follow
[ADR-02](docs/adr/ADR-02-schema-evolution-sla.md); deprecations follow
[ADR-14](docs/adr/ADR-14-deprecation-policy.md).

## [Unreleased]

## [0.2.11] - 2026-09-05

### Fixed

- Bound `.n4d` count-derived allocations by the actual checksummed payload and
  return validation errors on overflow/allocation failure.
- Resolve named view membership without silently ignoring partition/fold
  selectors or unknown fields; preserve host-resolved sample IDs and whole
  materialized training/prediction views.
- Validate explicit plan references, representation continuity and target rank;
  preserve adapter ambiguity diagnostics for user resolution.
- Keep published fingerprints stable when downstream crates enable
  `serde_json/preserve_order`.
- Release synchronous Python provider input buffers after each call and report
  the loaded native extension's real version. Generated extension binaries are
  no longer tracked as source files.

## [0.2.10] - 2026-09-02

### Added

- Additive `CoordinatorDataPlanEnvelope` v2 contract for identity-attested,
  terminal PREDICT cohorts, mirrored and validated against `dag-ml` 0.3.23.
- Native execution of the closed `by_filter` branch predicate in the in-memory
  provider, including metadata and tag selectors.
- Binding-level WASM provider lifecycle smoke coverage.

### Changed

- Raised the Rust MSRV to 1.85 and updated the locked hashing/runtime toolchain.
- Upgraded the Python binding to PyO3 0.29.2, track its standalone Cargo lock,
  audit that lock in CI, and require locked wheel builds. This closes
  `RUSTSEC-2026-0176` and `RUSTSEC-2026-0177`, which the workspace-only audit
  could not see while the wheel crate was excluded.
- Published package identity now advances past the immutable `v0.2.9` source;
  post-0.2.9 contracts are no longer represented as the already-published
  0.2.9 artifact.

## [0.2.0] - 2026-06-15

### Added
- `docs/adr/` — the five Phase-0 ADRs where the data layer is the primary
  enforcement site (compatibility ledger, schema evolution SLA, repetition-CV
  invariant, signal-type ownership, aggregation reducers), mirrored
  byte-identical from `dag-ml`. See `docs/adr/README.md`.
- Governance: `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`,
  `.github/` issue/PR templates, `CODEOWNERS`, `dependabot.yml`,
  `examples/README.md` audience matrix.
- Additive nirs4all integration fields on the v1 data contracts:
  `RepresentationSpec.signal_type`, per-source `ShapeContract`,
  `MetadataSchema`, `GroupSpec`, `FoldSpec` and `AugmentationMetadata`.
  Existing v1 JSON remains readable when these optional fields are absent.
- Exhaustive partition-style `FoldSet` JSON validation in core plus Python,
  WASM and C ABI bindings, including checks against `SampleRelationTable`
  group/origin boundaries so integration code can reject repetition leakage
  before handoff to `dag-ml`.
- Canonical `FoldSet` fingerprints exposed in Rust, Python, WASM and C ABI so
  OOF partitions can participate in replay and lineage checks.
- Shared `FoldSet` fixture and contract validation keep the canonical
  fingerprint byte-identical with `dag-ml` for the common JSON shape.
- Shared parity-oracle handoff manifest pins the first nirs4all-lite parity
  cases, fixtures, Python/WASM gates and invariants for the future consumer
  compatibility ledger.
- Python/WASM `contract_manifest_json()` exposes the versioned integration
  surface, supported contract ids, exported helper names and shared fixture
  digests for host/browser compatibility checks.
- ADR-11 structured error descriptors now expose stable `category`, `code`,
  `severity`, remediation hints and context in Rust, Python exception
  attributes, WASM error payloads and C ABI validation error payloads.
- Python/WASM smoke coverage for a `nirs4all-lite` schema fixture containing
  signal type, shape, metadata, group and fold contracts, plus fold leakage
  rejection.
- Python package facade now exposes validated contract wrappers
  (`DatasetSchema`, `ModelInputSpec`, `AdapterRegistry`, `DataPlan`,
  `SampleRelationTable`, `FoldSet`, `CoordinatorDataPlanEnvelope`) and typed
  planning/envelope helpers on top of the stable JSON functions.
- Python wheel metadata smoke now validates built wheel name/version,
  `Requires-Python`, `CeCILL-2.1 OR AGPL-3.0-or-later` license file, `abi3` tag,
  native extension, stubs and `py.typed` before install smokes run.
- CI now gates Rust documentation with `RUSTDOCFLAGS="-D warnings" cargo doc`
  and runs a workspace package dry-run so publishability regressions fail
  before release.
- Sphinx/MyST documentation site scaffold (`docs/conf.py`, `docs/index.md`,
  `docs/installation.md`, `docs/requirements.txt`) now builds in CI with
  warnings denied, closing the ADR-09 local docs gate before hosted publishing.
- ADR-14 managed-debt lint (`scripts/check_deprecations.py`) now rejects
  unexplained production-path `TODO`/`FIXME` markers and unmanaged
  `#[deprecated]` attributes in CI.
- Public Rust doc coverage now has a ratcheted CI gate
  (`scripts/check_public_docs.py`), making the current docstring debt visible
  without claiming the final 95% target is complete.
- ADR-10 publish-plan check (`scripts/release/check_publish_plan.py`) validates
  workspace internal dependency pinning and runs `cargo publish --dry-run` for
  currently publishable root crates before release.
- CI now gates the declared Rust MSRV with `RUST_MSRV: "1.83.0"` and
  `cargo check --workspace --all-targets`.
- CI now gates Rust dependencies with pinned `cargo-audit` and
  `cargo audit --deny warnings`.
- Web-target WASM packages are packed with `wasm-pack pack` in CI after smoke
  loading, so npm tarball regressions are caught before release.
- WASM npm tarball dry-run metadata smoke validates package name/version,
  integrity, bundled-dependency absence and required published files for the
  browser package.
- WASM smokes now validate generated npm metadata (`package.json` name,
  version, JS entry, typings, packaged files and required TypeScript exports)
  against the Rust contract manifest.
- Release metadata validation now checks Cargo workspace inheritance, internal
  path-dependency versions, Python PEP 440 wheel version, `abi3-py311`, MSRV
  pins, MSRV-sensitive dependency pins, CI tool pins, required governance files
  and the Sphinx docs-site / managed-debt / publish-plan gates before release.
- Public C ABI header snapshot validation now locks `dag_ml_data.h` through a
  checked-in SHA-256 manifest so ABI changes are explicit in review.
- Multi-target materialization now has a core
  `CoordinatorMultiTargetBlock` plus
  `dagmldata_coordinator_multi_target_arrow_json`, exporting one nullable f64
  Arrow column per target id with per-target validity masks.

### Fixed
- Workspace path dependencies now carry explicit SemVer requirements, so
  `cargo package --workspace --allow-dirty --no-verify` succeeds for all Rust
  crates instead of failing at publish packaging time.

## [0.1.0-alpha.0] - 2026-05-29

Foundation scaffold. Executable Rust crates with:

### Added
- **Schema & axes** — `DatasetSchema`, `SourceDescriptor`, `RepresentationSpec`,
  `AxisSpec` (wavelength/wavenumber/time native), validation of rank↔axes and
  coordinates↔size.
- **Planning** — `ModelInputSpec`, `DataPlan`, deterministic `plan_model_input`
  BFS/Dijkstra path solver over the `AdapterRegistry` (source-order independent).
- **Alignment / fusion / collation** — `inner`/`left`/`outer` sample alignment,
  pure-Rust multi-source feature fusion (reference-source repetitions, singleton
  broadcast, namespacing), numeric late-collation tensor kernel with
  presence/value-validity masks.
- **Relations** — `SampleRelationTable` (observation/sample/target/group/origin
  ids) with duplicate/group/origin validation.
- **Coordinator** — `CoordinatorDataPlanEnvelope` v1 (versioned, fingerprinted)
  with materialization-request validation.
- **Handles & buffers** — `CoordinatorHandleArena` (opaque data/view handles),
  `NumericFeatureBufferArena` (manifest / bind / project / release),
  `NumericFeatureMatrixF64`, `.n4d` file-backed buffer store with SHA-256
  integrity, optional Arrow IPC buffer provider.
- **Fingerprints** — deterministic `schema_fingerprint`, `data_plan_fingerprint`,
  `sample_relation_fingerprint` (SHA-256, source-order independent).
- **C ABI** (`crates/dag-ml-data-capi`, `include/dag_ml_data.h`) — in-memory
  provider with the full `DagMlDataVTable` lifecycle (materialize / make_view /
  view_identity / target_arrow / feature_arrow / release / destroy), Arrow C
  Data ABI smoke, branch_view contract.
- **CLI** (`dag-ml-data-cli`) — `fingerprint-schema`, `validate-envelope`,
  `materialize-envelope`, `plan-model-input`.
- **Python** — stdlib-only ctypes wrapper (`examples/python/dag_ml_data_provider.py`)
  and reusable provider smoke.
- Shared JSON Schemas + `conformance_pack.v1.json`, kept JSON-identical with
  `dag-ml` and validated by `scripts/validate_contracts.py`.

### Not yet implemented (tracked for the nirs4all integration)
- Object-level Python APIs above the JSON-contract PyO3 bindings and ctypes
  provider smoke (roadmap workstream D).

[Unreleased]: https://github.com/GBeurier/dag-ml-data/compare/v0.2.11...HEAD
[0.2.11]: https://github.com/GBeurier/dag-ml-data/compare/v0.2.10...v0.2.11
[0.2.10]: https://github.com/GBeurier/dag-ml-data/compare/v0.2.9...v0.2.10
[0.2.0]: https://github.com/GBeurier/dag-ml-data/releases/tag/v0.2.0
[0.1.0-alpha.0]: https://github.com/GBeurier/dag-ml-data/releases/tag/v0.1.0-alpha.0
