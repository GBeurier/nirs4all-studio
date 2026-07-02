/**
 * nirs4all-ui public package surface.
 *
 * Pure TypeScript only: no React, no network/IO, no app state, and no backend
 * runtime execution. Hosts can use the namespace barrels from the root export
 * or import narrower domain barrels such as `nirs4all-ui/score`.
 */

export * as score from "./score/index.js";
export * as runtime from "./runtime/index.js";
export * as components from "./components/index.js";
