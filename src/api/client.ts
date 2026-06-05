/**
 * API client barrel for nirs4all backend communication.
 *
 * The HTTP transport lives in `./http`; each domain's typed functions and
 * interfaces live in their own per-domain module. This barrel re-exports them
 * all so existing call sites that import from this barrel keep resolving.
 */

export * from "./http";
export * from "./workspace";
export * from "./datasets";
export * from "./pipelines";
export * from "./runs";
export * from "./customNodes";
export * from "./workspaceSettings";
export * from "./system";
export * from "./linkedWorkspaces";
export * from "./appSettings";
export * from "./updates";
export * from "./aggregatedPredictions";
