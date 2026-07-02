# `src/ui` — compatibility bridge to `nirs4all-ui`

This directory is now a thin compatibility bridge to the sibling
`../nirs4all-ui` package. Studio keeps the historical `@/ui/*` import paths for
incremental migration, but the implementation source for the shared score and
runtime foundations lives in the top-level package consumed by Studio and Web.

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

Consume a domain through its barrel, e.g. `import { canonicalMetricKey } from "@/ui/score"`.
The app-runtime score-map layer (`@/lib/scores`) builds on `@/ui/score`.
