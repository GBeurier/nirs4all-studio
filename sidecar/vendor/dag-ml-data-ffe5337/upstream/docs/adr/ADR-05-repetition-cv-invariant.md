# ADR-05: Repetition-aware CV is a safety invariant (not a binding convenience)

**Status**: accepted (2026-05-28)
**Blocks**: workstream B (dag-ml-data validators), workstream E (bridge), workstream F (parity).

## Context

nirs4all groups multiple spectra per physical sample using `set_repetition(column)`. Cross-validators must keep all repetitions of a sample in the same fold — otherwise OOF predictions for sample X consume training predictions of sample X (leakage).

Roadmap v1 punted this to the binding ("Python constructs the folds"). Codex pushed back: **this is a safety invariant**. A binding bug that splits repetitions across folds silently corrupts OOF; dag-ml-data must validate.

## Decision

The invariant is enforced **inside dag-ml-data**, not at the binding boundary.

1. **`DatasetSchema` declares the repetition contract** — a `GroupSpec.kind = "repetition_group"` block names the column that groups observations and asserts uniqueness of `(group_id, sample_id)` pairs. (Workstream B task 7.)

2. **The data plan validator refuses fold sets that violate the contract**. After a fold split lands in `dag-ml-core`'s `FoldSet`, dag-ml-data's coordinator envelope validator joins the fold assignments against the repetition `GroupSpec` and refuses the materialization with `RepetitionLeakageError` if any group has its observations split across folds.

3. **Bindings construct folds; data layer audits them**. Splitter controllers (KennardStone, SPXY, KFold, …) live in the binding. They produce `FoldSet`s. The Rust runtime hands the `FoldSet` to dag-ml-data, which validates and either accepts or refuses. Refusal is a hard error (no warning) because leakage is silent in metrics.

4. **Augmentation origin inherits group membership** — augmented rows derived from sample X carry X's `group_id` and are constrained to X's fold (ADR-04 materialization records the lineage).

## Consequences

- `dag-ml-data` gains a `RepetitionLeakageValidator` in `relation.rs` that joins the `FoldSet` against `SampleRelationTable.repetition_group_id`.
- The bridge's controller-manifest exporter (workstream E task 3) declares each splitter's `respects_repetition` capability so the planner can pre-warn on incompatible combinations.
- The parity oracle's repetition cases (`rep_to_sources_basic`, `rep_to_pp_basic`, `aggregation_rep_*`) become the executable proof of this invariant.
- `dag-ml`'s `OofEdge` validation already refuses train predictions as meta-model training features. With ADR-05 enforced upstream, both layers refuse leakage independently — defense in depth.

## Risk

- A naïve splitter that ignores repetition will be **rejected at materialize time** rather than silently producing biased metrics. Users see a clear error pointing at the offending step. This is intentional.

## Open follow-ups

- The synthetic-builder fixture for parity cases needs a repetition column. The parser-fixture `aggregate_mean` (E04) already has one (`sample_id`); confirm column names on first end-to-end run.
