# `src/ui` — compatibility bridge to `nirs4all-ui`

This directory is now a thin compatibility bridge to the `nirs4all-ui` package.
Studio installs the exact content-addressed `vendor/npm/nirs4all-ui-0.1.13.tgz`
release artifact and keeps the historical `@/ui/*` import paths for incremental
migration. The shared implementation source remains in the sibling
`../nirs4all-ui` repository used by Studio and Web.

## Contract

Everything under `src/ui/` must be:

- **Pure TypeScript** — no React, no JSX, no hooks.
- **IO-free** — no `fetch`/network, no `@/api`, no filesystem, no `window`/`document`.
- **App-state-free** — no context, router, or TanStack Query coupling.
- **Unit-testable in isolation**, with tests colocated as `*.test.ts`.

These constraints are what make the layer reusable by a second host (the WASM web
client) without dragging Studio's app shell along. App-coupled code (components,
hooks, routes, the FastAPI client) stays in `src/components`, `src/hooks`, `src/api`.

## How it grows

New shared UI/view-model work should land in `../nirs4all-ui` first. Studio-only
adapters that depend on API routes, app state, hooks, or workspace data stay
outside this bridge.

## Domains

| Domain   | Path          | What it owns |
|----------|---------------|--------------|
| `score`  | `nirs4all-ui/score`| Metric-key normalization, the static metric catalog + task-type selection rules, and direction-aware score parsing / comparison / formatting. |
| `runtime`| `nirs4all-ui/runtime`| Runtime/result status display tokens, busy-state predicates, progress projection, and status-aware empty-state copy. |
| `conformal`| `nirs4all-ui/conformal`| Validation and view-model projection for native nirs4all `CalibratedRunResult.to_dict()` payloads, guarantee status, calibration replay provenance and interval summaries. |
| `robustness`| `nirs4all-ui/robustness`| Validation and compact card view-models for nirs4all robustness `summary.json` artifacts, plus scenario vocabulary/form validation aligned with the Python keyword registry. |
| `keywordRegistry`| `nirs4all-ui/keywordRegistry`| Metadata-only validation, indexing, form-field projection, optimizer-persistence field grouping, and workspace prediction publication contract projection for the exported nirs4all keyword/effect registry. |
| `tuning`| `nirs4all-ui/tuning`| Validation and view-model projection for native nirs4all `TuningResult.to_dict()` payloads, lightweight `TuningResult.summary_artifact()` / `nirs4all.tuning.summary` cards, ordered `nirs4all.tuning.ordered_search_space` previews, safe optimizer-persistence flags, and trial rows. |

Consume a domain through its barrel, e.g. `import { canonicalMetricKey } from "@/ui/score"`.
The app-runtime score-map layer (`@/lib/scores`) builds on `@/ui/score`.
