import {
  getRuntimeResultEmptyMessage,
  getRuntimeResultStatusDisplay,
  isBusyRuntimeResultStatus,
  isRuntimeResultStatus,
  type RuntimeResultStatus,
} from "@/ui/runtime";
import type { RunExecutionBackend } from "@/types/runs";
import type { WorkspaceRunDetail } from "@/types/enriched-runs";

export type RunDetailTab = "overview" | "pipelines" | "logs" | "datasets";

export const DEFAULT_RUN_DETAIL_TAB: RunDetailTab = "overview";

const RUN_EXECUTION_BACKEND_LABELS: Record<RunExecutionBackend, string> = {
  "local-python": "Local Python",
  cluster: "Cluster",
  "wasm-local": "Local WASM",
};

export interface RunExecutionBackendDisplay {
  backend: RunExecutionBackend | null;
  label: string;
  isCluster: boolean;
}

function isRunExecutionBackend(value: unknown): value is RunExecutionBackend {
  return value === "local-python" || value === "cluster" || value === "wasm-local";
}

export function resolveRunStatus(status: string | null | undefined): string {
  return status || "completed";
}

export function isKnownRunStatus(status: string): status is RuntimeResultStatus {
  return isRuntimeResultStatus(status);
}

export function getRunStatusConfig(status: string) {
  const display = getRuntimeResultStatusDisplay(status);
  return {
    label: display.label,
    color: display.colorClass,
    bg: display.bgClass,
    iconClass: display.iconClass,
  };
}

export function isBusyRunStatus(status: string): boolean {
  return isBusyRuntimeResultStatus(status);
}

export function getTotalLogCount(detail: WorkspaceRunDetail | null | undefined): number {
  return (detail?.log_summary ?? []).reduce((sum, entry) => sum + (entry.log_count || 0), 0);
}

export function getRunExecutionBackend(detail: Pick<WorkspaceRunDetail, "config"> | null | undefined): RunExecutionBackend | null {
  const backend = detail?.config?.execution_backend;
  return isRunExecutionBackend(backend) ? backend : null;
}

export function getRunExecutionBackendDisplay(detail: Pick<WorkspaceRunDetail, "config"> | null | undefined): RunExecutionBackendDisplay {
  const backend = getRunExecutionBackend(detail);

  return {
    backend,
    label: backend ? RUN_EXECUTION_BACKEND_LABELS[backend] : "Execution backend not recorded",
    isCluster: backend === "cluster",
  };
}

export function getRerunDisabledTitle(rerunReady: boolean | undefined): string | undefined {
  return rerunReady === false ? "Relink the missing datasets before rerunning this run." : undefined;
}

export function getEmptyDatasetsMessage(status: string): string {
  return getRuntimeResultEmptyMessage(status, {
    queued: "Fold-level dataset results will appear here as pipelines complete.",
    running: "Fold-level dataset results will appear here as pipelines complete.",
    fallback: "No dataset results are available for this run.",
  });
}
