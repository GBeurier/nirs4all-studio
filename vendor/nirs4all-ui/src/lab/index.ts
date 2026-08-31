/**
 * nirs4all-ui `lab` domain — the reusable foundation for quali-nirs4all.
 *
 * Pure view-model helpers (decision contract, sample lifecycle, data-health,
 * model report, worklist, budget↔coverage) + stateless presentational React
 * components that render them. Same package boundary as the rest of nirs4all-ui:
 * NO app state, routing, network/IO, browser globals, or ML/runtime execution.
 * Hosts own state + data + icons; this domain owns the shared lab display
 * contracts so the WASM app and a future Python-backed app never diverge.
 *
 * Consumed as `nirs4all-ui/lab` (see the package `exports` map).
 */

// --- pure view-model helpers ---
export * from "./locale.js";
export * from "./decision.js";
export * from "./sampleStatus.js";
export * from "./health.js";
export * from "./modelReport.js";
export * from "./worklist.js";
export * from "./budget.js";

// --- presentational components ---
export * from "./DecisionBadge.js";
export * from "./DecisionCard.js";
export * from "./SampleStatusBadge.js";
export * from "./HealthFindingRow.js";
export * from "./StepProgress.js";
export * from "./ModelReportCard.js";
export * from "./WorklistTable.js";
export * from "./TrafficLightLegend.js";
