# Supported Surface

This page is the 0.2.x RC support contract for `dag-ml-data` (current package
version: 0.2.11). It separates
production-facing data contracts from conformance providers and backlog work.
The 0.2.x surface includes the built-in scientific data-model catalogue helpers
(`builtin_data_models`, `builtin_representations`, `builtin_adapter_registry`,
`tabular_numeric_model_input_spec`) as new additive Rust, Python and WASM
exports; no existing public ABI, JSON schema, or function signature changed.

## Support Levels

| Level | Meaning |
|---|---|
| Supported | Included in the release scope and covered by CI gates. |
| Conformance | Stable enough for binding authors and integration tests, but not a complete production backend. |
| Experimental | Public shape may exist, but release notes must call out limitations. |
| Backlog | Not part of the release promise. |

## dag-ml-data Surface

| Area | Level | Notes |
|---|---|---|
| Dataset schema, ids, axes and representation contracts | Supported | Rust validation, JSON-compatible structs and deterministic fingerprints are gated. |
| Built-in scientific data-model catalogue | Supported | Canonical `RepresentationSpec` constructors cover `signal_1d`, `signal_with_processings`, `raman_signal`, `ftir_signal`, `tabular_numeric`, `tabular_mixed`, `feature_block_set`, `series_mv`, genotype markers, images, `cube_hwb`, masks, `sample_metadata`, rank-1/rank-2 targets, `mass_spectrum` and text tokens; adapter declarations are planner contracts only. |
| Model-input planning and adapter path solving | Supported | Explicit references and known target ranks are validated; unresolved rank/adapter choices remain visible plan issues. |
| Coordinator data-plan envelopes v1 and v2 | Supported | V1 remains readable; additive V2 binds the terminal PREDICT cohort. Shared schema/fixture drift is checked against `dag-ml`. |
| Sample relations and FoldSet boundary validation | Supported | Group/origin/repetition leakage checks are exposed through Rust, C ABI, Python and WASM helpers. |
| Numeric feature buffers and `.n4d` persistence | Supported | Manifest, fingerprint, bind/project/release and file tamper checks are tested. |
| N-D tensor transport | Supported | Borrowed tensor views are copied to provider-owned buffers and exported through view-filtered handles. |
| Fitted adapter refs/manifests/store | Supported | Portable URI/fingerprint validation and in-memory store ABI are covered. |
| In-memory provider vtable | Conformance | Full materialize/view/identity/target/feature lifecycle is tested; it is not a production storage backend. |
| Python `ctypes` provider package | Conformance | Useful binding template and smoke target; not a domain-specific provider backend. |
| WASM provider feature | Conformance | The opt-in `provider` feature is built and executed in Node CI over materialize/view/typed feature/collation/release. The published default npm artifact remains JSON-contract-only. |
| Arrow IPC feature-buffer reader | Conformance | Optional crate/feature path for IPC-backed numeric buffers. |
| `branch_view` modes `by_source`, `by_metadata`, `by_tag` | Supported | Executed natively by the in-memory provider. |
| `branch_view` mode `by_filter` | Supported, closed predicate | The provider executes only `{"metadata_equals": {…}, "tags_all": […]}` (at least one non-empty constraint); unknown, null, empty or mixed selector predicates fail as typed `data_contract_validation` before row projection. |
| IO bridge branch-view route | Supported integration route | `JsonInMemoryProvider → materialize → make_view(by_filter) → view_identity` filters supplied relation records verbatim; it never creates an effective fold assignment. |
| DataView partition/fold labels | Supported | Explicit sample IDs carry host-resolved membership. Without IDs, labels filter supplied relation metadata; full_train and already-bound predict select the whole handle. Unknown JSON fields are rejected. See [Architecture](ARCHITECTURE.md). |
| Production provider arenas beyond in-memory | Backlog | Host providers must implement native storage/filtering semantics. |
| nirs4all `SpectroDataset` connector | Backlog | Descoped to `nirs4all-io`; `dag-ml-data` remains NIRS-agnostic. |

## Cross-Repo Contract With dag-ml

The 0.2.x RC release train must keep these artifacts JSON-identical with `dag-ml`:

- `coordinator_data_plan_envelope.schema.json`;
- `feature_fusion_selector.schema.json`;
- `coordinator_branch_view.schema.json`;
- `fitted_adapter_ref.schema.json`;
- `conformance_pack.v1.json`;
- `parity_oracle.v1.json`;
- shared `FoldSet` fixture.

The public vtable ABI version shared with `dag-ml` must remain guarded so
`dag_ml_data.h` and `dag_ml.h` compile in both include orders.

## Public-Signature Policy

For the 0.2.x RC release window:

- no C ABI symbol, struct layout, JSON schema id/version, Rust public function,
  Python facade function, R package native surface or WASM export changes
  without an explicit contract entry and ABI/schema snapshot update;
- if such a change is accepted, downstream chains such as `nirs4all-core`,
  `nirs4all-web` and browser/Python smoke packages must be rebuilt before tag;
- documentation, CI jobs, tests and private benchmark helpers are allowed when
  they do not alter exported signatures.

## Post-0.2.x Backlog

1. Keep the documented mapping between `dag-ml` coordinator aggregation
   policies and data-side reducer vocabulary current (`robust_mean` /
   `exclude_outliers` remain data-side only unless a shared schema is added).
2. Wire signal-type expectations through paired `dag-ml` replay contracts before
   claiming coordinator-enforced signal-type predict checks.
3. Add persistent production host provider backends beyond the externally-fed in-memory integration route.
4. Keep the existing AddressSanitizer C ABI lane green through release.
5. Extend the current fingerprint performance probes to provider export paths.
