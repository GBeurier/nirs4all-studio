# `src/ui` — internal `nirs4all-ui` foundation

This directory is the **internal `nirs4all-ui` package** (a seed, *not* a separate
repository — see DEC-UI-001 and `docs/agent_reports/A6_A6-studio-ui.md`). It is the
home for Studio's reusable, framework-agnostic **view-model / data-adapter layer**:
the pure logic that turns API/runtime shapes into display-ready view models.

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

The audit's recommendation is to extract **one coherent, already-pure domain at a
time**, leaving the app-runtime layer that builds on it in `src/lib`. The first
slice is `score/`.

## Domains

| Domain   | Path          | What it owns |
|----------|---------------|--------------|
| `score`  | `src/ui/score`| Metric-key normalization, the static metric catalog + task-type selection rules, and direction-aware score parsing / comparison / formatting. |
| `runtime`| `src/ui/runtime`| Runtime/result status display tokens, busy-state predicates, progress projection, and status-aware empty-state copy. |

Consume a domain through its barrel, e.g. `import { canonicalMetricKey } from "@/ui/score"`.
The app-runtime score-map layer (`@/lib/scores`) builds on `@/ui/score`.
