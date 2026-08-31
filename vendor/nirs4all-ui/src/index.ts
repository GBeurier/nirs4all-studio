/**
 * nirs4all-ui public package surface.
 *
 * Pure TypeScript only: no React, no network/IO, no app state, and no backend
 * runtime execution. Hosts can use the namespace barrels from the root export
 * or import narrower domain barrels such as `nirs4all-ui/score`.
 */

export * as score from "./score/index.js";
export * as runtime from "./runtime/index.js";
export * as conformal from "./conformal/index.js";
export * as robustness from "./robustness/index.js";
export * as keywordRegistry from "./keywordRegistry/index.js";
export * as tuning from "./tuning/index.js";
export * as dataset from "./dataset/index.js";
export * as components from "./components/index.js";
export * as viz from "./viz/index.js";
export * as dag from "./dag/index.js";
export * as chains from "./chains/index.js";
export * as brand from "./brand/index.js";
export * as styles from "./styles/index.js";
export * as lab from "./lab/index.js";
export * as datasetBuilder from "./datasetBuilder/index.js";
