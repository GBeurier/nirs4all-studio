# Phase 2 readiness gate (dag-ml-data target)

> Phase 2 (a Rust core emitting the `dag-ml-data` contract) was **gated** by the
> Appendix J readiness checklist of the redesign doc. This file records the
> **verified current status** of that gate (assessed against the live
> `dag-ml-data` and `dag-ml` repos). **As of 2026-05-28 both former blockers are
> resolved — the gate is GREEN.** The Rust bridge is now implemented in
> `crates/nirs4all-io-dagml`; the original Phase-2 plan is recorded in
> [`RUST_REWRITE_ROADMAP.md`](RUST_REWRITE_ROADMAP.md).

## Verdict: **GREEN — UNBLOCKED** (both former blockers resolved in `dag-ml-data`, 2026-05-28)

| # | Appendix J item | Status | Evidence |
|---|---|---|---|
| 1 | External construction path | 🟡 PARTIAL | No Python pkg; but all core structs are serde, a `dag-ml-data-cli` (`EnvelopePlan`/`Fingerprint*`/`ValidateEnvelope`) + C ABI exist. A **Rust-first** bridge (the planned form) has everything via the facade. Only an ergonomic Python builder is missing. |
| 2 | cm⁻¹ axis (`AxisKind::Wavenumber`) | 🟢 **RESOLVED** | `AxisKind` (`dag-ml-data-core/src/model.rs`) now has a first-class `Wavenumber` variant (`#[non_exhaustive]`, snake_case serde, round-trip tested); added in `dag-ml-data` commit `5063fb0`. cm⁻¹ maps directly — no interim convention needed. |
| 3 | Relation id mapping (`origin_id`↔`origin_sample_id`) | 🟢 GREEN | `coordinator_relations_from_sample_table` (`coordinator.rs:132-176`) resolves observation→sample; tested; dag-ml's `SampleRelation` is field-compatible; the shared `coordinator_data_plan_envelope.schema.json` is byte-identical across repos. |
| 4 | Fingerprints exposed | 🟢 GREEN | `schema_fingerprint`/`data_plan_fingerprint`/`sample_relation_fingerprint` all `pub` + facade-re-exported + CLI-reachable. |
| 5 | Array host path | 🟡 PARTIAL | `NumericFeatureMatrixF64` + typed C-ABI host path exist, but only an **in-memory test provider** ships (production arenas pending per dag-ml-data ROADMAP). Does not block a Rust-first schema/plan/relation emit. |
| 6 | `dag-ml validate-data-binding` reachable | 🟢 GREEN (caveat) | dag-ml CLI `ValidateDataBinding` consumes `ExternalDataPlanEnvelope` (drops the plan body). The bridge must emit dag-ml-data's `CoordinatorDataPlanEnvelope` and rely on the **shared JSON schema** compat (no shared Rust type). |
| 7 | Connector ownership | 🟢 **RESOLVED** | `dag-ml-data/docs/ADR-0001-nirs4all-connector-ownership.md` (**Accepted**, 2026-05-28) gives **`nirs4all-io`** ownership of the `SpectroDataset → CoordinatorDataPlanEnvelope` bridge; `dag-ml-data` ROADMAP Phase 4 is **descoped** to "accept io-emitted artifacts". |

## What flipped the gate GREEN (done by the dag-ml owners, 2026-05-28)

1. ✅ **`AxisKind::Wavenumber` added** to `dag-ml-data-core/src/model.rs` (first-class
   variant; serde/fingerprints unaffected). Commit `5063fb0`.
2. ✅ **Connector-ownership ADR recorded** (`ADR-0001`, Accepted): **`nirs4all-io` owns the
   SpectroDataset → `CoordinatorDataPlanEnvelope` bridge**; dag-ml-data ROADMAP Phase 4
   descoped to "accept io-emitted artifacts".

Everything else needed to *start* Phase 2 (construct → fingerprint → emit the
coordinator envelope → validate via `dag-ml-data-cli ValidateEnvelope` **and**
`dag-ml ... validate-data-binding`) already exists. The right acceptance test
(story 4.4) is a cross-CLI golden of `coordinator_data_plan_envelope.json`.

## Implemented bridge shape

The implemented EPIC-10 bridge maps an `AssembledDataset` to `DatasetSchema` +
`DataPlan` + `SampleRelationTable`, assembled into a `CoordinatorDataPlanEnvelope`
via `CoordinatorDataPlanEnvelope::from_parts`. It lives in `crates/nirs4all-io-dagml`
as `to_dag_ml_data(&AssembledDataset)` plus the `emit-dagml` binary. **io does not
emit `FoldSet`/`DataBinding`** — those stay in `dag-ml` (folds/campaigns are its
domain; the cross-CLI acceptance test wraps the envelope as an `ExternalDataPlanEnvelope`
behind a fixture `DataBinding`). The Python MVP remains `SpectroDataset` /
`AssembledDataset` / `DatasetPackage`; it does not expose a `dag-ml-data` `load`
target.
