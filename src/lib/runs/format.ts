import type { TFunction } from "i18next";

const KNOWN_RUN_TOKEN_KEYS: Record<string, string> = {
  cluster: "cluster",
  duckdb: "duckdb",
  legacy: "legacy",
  "local-python": "localPython",
  native: "native",
  parquet: "parquet",
  "result-repository": "resultRepository",
  result_repository: "resultRepository",
  "wasm-local": "wasmLocal",
  "workspace-store": "workspaceStore",
  workspace_store: "workspaceStore",
  pending: "pending",
  queued: "queued",
  running: "running",
  completed: "completed",
  failed: "failed",
  cancelled: "cancelled",
  partial: "partial",
  orphaned: "orphaned",
  training: "training",
  evaluation: "evaluation",
  prediction: "prediction",
  automl: "automl",
  export: "export",
  analysis: "analysis",
  maintenance: "maintenance",
  update_download: "updateDownload",
  update_apply: "updateApply",
  venv_create: "venvCreate",
  venv_install: "venvInstall",
};

/** Human label of a backend / status / job-type token; unknown future tokens are humanised from their identifier. */
export function formatRunTokenLabel(value: string, t: TFunction): string {
  const token = value.trim();
  if (!token) {
    return value;
  }

  const knownKey = KNOWN_RUN_TOKEN_KEYS[token];
  if (knownKey) {
    return t(`runs.tokens.${knownKey}`);
  }

  const words = token.split(/[-_]+/).filter(Boolean);
  if (words.length === 0) {
    return value;
  }

  const label = words.join(" ").toLowerCase();
  return `${label.charAt(0).toUpperCase()}${label.slice(1)}`;
}

export function clampRunProgress(progress: number): number {
  if (!Number.isFinite(progress)) {
    return 0;
  }

  return Math.min(100, Math.max(0, progress));
}

export function formatRunProgress(progress: number): string {
  return `${Math.round(clampRunProgress(progress))}%`;
}

/** Whole seconds elapsed since an ISO start timestamp, or null when it is missing, unparsable or in the future. */
export function getElapsedSeconds(startedAt: string | undefined, nowMs: number): number | null {
  if (!startedAt) {
    return null;
  }

  const startedMs = Date.parse(startedAt);
  if (!Number.isFinite(startedMs)) {
    return null;
  }

  return Math.max(0, Math.floor((nowMs - startedMs) / 1000));
}

/** Clock-style duration: `mm:ss`, or `h:mm:ss` from one hour on. */
export function formatElapsedClock(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const pad = (value: number) => String(value).padStart(2, "0");

  return hours > 0
    ? `${hours}:${pad(minutes)}:${pad(seconds % 60)}`
    : `${pad(minutes)}:${pad(seconds % 60)}`;
}
