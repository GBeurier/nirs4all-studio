/**
 * `nirs4all-ui` — internal foundation package (seed).
 *
 * The first home for Studio's reusable, framework-agnostic view-model layer.
 * Per the A6 audit (docs/agent_reports/A6_A6-studio-ui.md) and DEC-UI-001 this
 * starts as an internal Studio package (NOT a separate repo) and grows by
 * relocating already-pure adapters here, one coherent domain at a time.
 *
 * Contract for everything under `src/ui/`: pure TypeScript only — no React, no
 * network/IO, no app state (context/router/query), no `@/api` imports. These
 * modules must be unit-testable in isolation and safe to consume from any host
 * (Studio today; the WASM web client later).
 *
 * Domains:
 *   - `score`  metric vocabulary + score value helpers (first extracted slice)
 */

export * as score from "./score";
