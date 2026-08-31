/**
 * Robustness report summary foundation — public surface.
 *
 * Pure, dependency-free helpers for validating the `summary.json` artifact
 * emitted by nirs4all robustness reports and projecting it into compact card
 * view-models for Studio/Web hosts. Hosts own fetching, persistence, charts,
 * routing, and final visual severity policy.
 */

export * from "./summary.js";
export * from "./scenarios.js";
export * from "./modes.js";
