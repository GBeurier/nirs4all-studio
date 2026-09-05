# ADR-07: Aggregation reducers in the contract

**Status**: accepted (2026-05-28)
**Blocks**: workstream B (canonical reducer set), workstream E (bridge controller manifest).

## Context

nirs4all aggregates predictions per sample (mean / median / vote / robust_mean / exclude_outliers) when the dataset has repeated measurements. Roadmap v1 considered approximating in the adapter; Codex pushed back: **canonical reducers belong in the contract**, not only in the adapter, otherwise the conformance pack is incomplete.

## Decision

Six canonical reducers live in the contract:

| Reducer | Semantics | NaN policy |
|---|---|---|
| `mean` | arithmetic mean of valid values | `skipna=true` |
| `weighted_mean` | mean weighted by per-row `weight` column (provider-supplied) | `skipna=true` |
| `median` | sample median | `skipna=true` |
| `vote` | majority vote (classification only); ties broken by sorted class id | undefined classes refused |
| `robust_mean` | trimmed mean: drop the top/bottom `trim_fraction` (default `0.1`) before averaging | `skipna=true` |
| `exclude_outliers` | drop rows where the per-row prediction is outside `Hotelling T²` confidence boundary at `threshold` (default `0.95`), then `mean` | `skipna=true` |

Each reducer is declared in `dag-ml-data-core::aggregation.rs` and the conformance pack (`docs/contracts/conformance_pack.v1.json`) — same enum surface in Rust, C ABI, and JSON. Bindings expose them by name; custom reducers go through a host-controller path with an explicit `custom_reducer_id` field so the bundle can still replay deterministically.

### Implementation notes

- Tolerance vs. legacy: `robust_mean` and `exclude_outliers` use the **same numerical implementation** as nirs4all's current implementation; the bridge ports the code, doesn't re-derive.
- `vote` works on classification predictions; the reducer is refused on regression with `IncompatibleReducer` (the bridge surfaces this at compile time).
- Per-sample aggregation respects the augmentation-origin invariant (ADR-04): augmented rows aggregate up to their origin sample, never to a different sample.

## Consequences

- `dag-ml-data`'s `AggregationPolicy` accepts the six canonical reducer names; anything else falls through to a host-controller call.
- `nirs4all`'s `RunResult.top(n)` ranking respects the configured reducer (e.g. classification with `vote` ranks by accuracy, not RMSE).
- The parity oracle's `aggregation_rep_*` cases pin the exact reducer behavior; the parity manifest records expected aggregated values.

## Risk

- `Hotelling T²` requires per-sample inverse covariance; numerically unstable on small samples. The reducer falls back to `robust_mean` with a logged warning when the covariance condition number exceeds `1e10`.
