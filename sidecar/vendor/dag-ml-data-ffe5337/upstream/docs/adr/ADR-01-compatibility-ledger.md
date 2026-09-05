# ADR-01: Compatibility ledger semantics

**Status**: accepted (2026-05-28)
**Blocks**: workstream B (schema additions), workstream E (bridge), workstream F (parity validation)

## Context

The integration replaces nirs4all's `PipelineRunner` + `SpectroDataset` backend with `dag-ml` + `dag-ml-data`. "No regression" must be enforceable, not aspirational. Without a written ledger, every B/D/E task can succeed locally and still miss a public behavior — Codex's #1 pushback on roadmap v1.

## Decision

A `nirs4all/docs/compatibility.md` ledger is the single source of truth for what counts as parity. It enumerates every public API surface with one of the following states:

- **supported** — the bridge reproduces the behavior byte-identical (categorical) or within ADR-declared tolerance (numeric).
- **changed** — the behavior changes; an entry documents the diff, why, and the migration path.
- **deprecated** — kept working for two releases past G6; emits a deprecation warning carrying the target removal version per ADR-14.
- **refused-with-error** — explicitly unsupported; the bridge raises a typed error pointing at the migration ADR.
- **migration-path** — documented procedure to move a workspace / bundle / pipeline from legacy to dag-ml.

### Tolerance ledger

Numeric comparison tolerances are **per model class × per metric**:

| Model class | RMSE / MAE | R² | Notes |
|---|---|---|---|
| Linear (PLS, Ridge, OLS) | 1e-6 | 1e-6 | deterministic under fixed seed |
| Tree ensembles (RF, GBR) | 1e-3 | 1e-3 | seed-respecting but library-version-sensitive |
| Neural networks (NICON, custom TF/PT) | 1e-2 | 1e-2 | mini-batch shuffle + numerical reductions |

Bit-identical parity is **not a goal** (Codex hidden risk #4). Tolerance is set per (model class, metric) and pinned in the ledger.

### What counts as public API

- `nirs4all.run / predict / explain / retrain / session / generate` and their result objects (frozen since 0.9.0 per `nirs4all/CLAUDE.md`).
- The pipeline DSL keyword table in `nirs4all/CLAUDE.md`.
- Workspace SQLite/Parquet schemas, run manifest layout, `.n4a` bundle format.
- The `examples/reference/*.py` set — examples are API; a broken example is a user-visible regression (Codex hidden risk #5).
- The CLI subcommand surface (`nirs4all workspace | dataset | artifacts | config`).

## Consequences

- Every entry in `nirs4all/CLAUDE.md`'s keyword table needs a ledger row before workstream E (bridge) can ship.
- The parity oracle test set (`nirs4all/tests/integration/parity/`) is the executable arm of the ledger — keyword coverage is asserted in `test_parity_compiles.py`.
- The bridge raises a typed error referencing this ledger when called on a `refused-with-error` shape.
- The compatibility ledger is checked into nirs4all (not dag-ml) so it follows the consumer's release cycle.

## Open follow-ups

- Generate per-case "legacy-observed" parity manifests (Codex Phase-3 review actionable). A scripted run of every runnable parity case captures exact prediction count / variant count / fold-partition shape / best metric / score keys per case, committed alongside the ledger.
