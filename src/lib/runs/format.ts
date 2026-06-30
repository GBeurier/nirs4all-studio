const KNOWN_RUN_TOKEN_LABELS: Record<string, string> = {
  cluster: "Cluster",
  duckdb: "DuckDB",
  legacy: "Legacy",
  "local-python": "Local Python",
  native: "Native",
  parquet: "Parquet",
  "result-repository": "Result repository",
  result_repository: "Result repository",
  "wasm-local": "WASM local",
  "workspace-store": "Workspace store",
  workspace_store: "Workspace store",
};

export function formatRunTokenLabel(value: string): string {
  const token = value.trim();
  if (!token) {
    return value;
  }

  const knownLabel = KNOWN_RUN_TOKEN_LABELS[token];
  if (knownLabel) {
    return knownLabel;
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
