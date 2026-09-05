# Future work — out-of-scope of the current Python MVP

> This file consolidates items that are **intentionally deferred** because they
> depend on something outside `nirs4all-io`'s perimeter (a host extension, an
> external library decision, or a Phase 2 deliverable that has its own gate).
> Nothing here is a blocker for the lib's current users; it is a forward log so
> nothing slips through the cracks when the relevant external pieces move.

## dag-ml-data bridge follow-ups

Status: **Rust Phase 2 complete.** The bridge lives in `crates/nirs4all-io-dagml`
(`to_dag_ml_data(&AssembledDataset)` + `emit-dagml`) and is validated by the
repository's maintainer-only Phase-2 gate and the public
[`IO_XLG_QUALIFICATION.md`](IO_XLG_QUALIFICATION.md) record. The Python MVP exposes
`SpectroDataset`, `AssembledDataset`, and `DatasetPackage`; it intentionally does
not expose a `dag-ml-data` `load` target.

Former blockers — both **resolved** by the `dag-ml-data` owners (2026-05-28):

1. ✅ **`AxisKind::Wavenumber`** added in `dag-ml-data-core/src/model.rs` (commit `5063fb0`).
2. ✅ **Connector-ownership ADR** (`ADR-0001`, Accepted) — `nirs4all-io` owns the
   `SpectroDataset → CoordinatorDataPlanEnvelope` bridge; `dag-ml-data` ROADMAP Phase 4 descoped.

Remaining non-MVP items are outside this Python package surface: ergonomic Python
builders for `dag-ml-data`, production array-host arenas in `dag-ml-data`, and
any future decision to expose the emit through language bindings.

## SpectroDataset extension on the nirs4all side (host-owned)

Three IR fields are carried but not materialized today because the target
SpectroDataset has no first-class slot for them. Extending the host's
`SpectroDataset` is **out of scope for `nirs4all-io`** -- the lib does not
modify nirs4all (see [`REPLUG.md`](REPLUG.md)).

| IR field | Today | Could be (host change) |
|---|---|---|
| `sample_index.observation_id` | parsed; stored as the row's natural index | `SpectroDataset.set_observation_ids()` for explicit per-row observation tags (independent of the sample-level group) |
| `sample_index.group_id` | parsed; can be smuggled in via `metadata` | `SpectroDataset.set_groups()` to drive leakage-aware CV without indirection through metadata |
| `role: weights` | surfaced as `__sample_weight__` metadata column | `SpectroDataset.set_sample_weights()` + automatic `fit(sample_weight=...)` plumbing in the pipeline |

For all three, the workaround today is to declare a regular metadata column
and read it explicitly in the pipeline.

## Inference calibration

`infer()` returns scores in `plan.scores`, currently **ordinal** (triage /
ranking). Brier/ECE calibration (story 3.6) requires a labelled
vendor/domain-split corpus that we do not have yet. The current uncalibrated
behaviour is explicit (Critique C5) and documented; nothing to do until a
corpus exists.

## Deferred polish

- **Stratified percentage split** at load time — intentionally rejected
  (`nirs4all-io` is a loader, not a splitter; see [`DATASET_CONFIGURATIONS.md §7`](DATASET_CONFIGURATIONS.md)).
  Stratification belongs in the pipeline's CV layer.
- **More vendor formats** beyond what `nirs4all-formats` ships -- driven by
  that library's roadmap, not this one.
