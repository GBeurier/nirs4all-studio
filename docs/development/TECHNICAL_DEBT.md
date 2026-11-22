# Studio technical debt

Studio-local fixes that work around a missing owner capability. Each entry names
the owner fix that should replace the local code.

## TD-STUDIO-2026-11-22-01 — Metric direction tables duplicated in Studio

- **Where:** `sidecar/src/results_summary.rs` (`LOWER_IS_BETTER`, used by results
  summary top-N, run history and dataset scores) and the `nirs4all-ui`
  `isLowerBetter` table used by the renderer.
- **Problem:** the direction (lower/higher is better) of each metric is a local
  list instead of the DAG-ML metric registry. The Rust list previously had 8
  entries vs 15 in the UI, so `nrmse`, `nmse`, `nmae`, `max_error`,
  `median_ae`, `hamming_loss` and `log_loss` selected the worst CV chains as
  "top". The Rust list now mirrors the UI list; aliases are only lower-cased.
- **Owner fix:** expose metric direction (and aliases) from the DAG-ML metric
  definitions through Core, consume it in the sidecar and UI, then delete both
  local tables.

## TD-STUDIO-2026-11-22-02 — Hidden runs live in client storage

- **Where:** `src/hooks/useHiddenRuns.ts` (`hidden-workspace-runs` key).
- **Problem:** "Remove from history" hides a run only in this Studio install's
  local storage; the workspace data is untouched, so another install or a cleared
  profile shows the run again. There is no "show hidden runs" view yet.
- **Owner fix:** persist a per-workspace history visibility flag in the
  workspace run store (SDK/DAG run metadata) and filter it in the run listing.
