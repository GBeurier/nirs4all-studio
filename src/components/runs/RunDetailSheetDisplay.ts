import type { TFunction } from "i18next";
import {
  getRuntimeResultEmptyMessage,
  getRuntimeResultStatusDisplay,
  isBusyRuntimeResultStatus,
  isRuntimeResultStatus,
  type RuntimeResultStatus,
} from "@/ui/runtime";
import { formatRunTokenLabel } from "@/lib/runs/format";
import type { RunExecutionBackend } from "@/types/runs";
import type { WorkspaceRunDetail } from "@/types/enriched-runs";

export type RunDetailTab = "overview" | "pipelines" | "logs" | "datasets";

export const DEFAULT_RUN_DETAIL_TAB: RunDetailTab = "overview";

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

export function getRunExecutionBackendDisplay(
  detail: Pick<WorkspaceRunDetail, "config"> | null | undefined,
  t: TFunction,
): RunExecutionBackendDisplay {
  const backend = getRunExecutionBackend(detail);

  return {
    backend,
    label: backend ? formatRunTokenLabel(backend, t) : t("runs.detail.backendNotRecorded"),
    isCluster: backend === "cluster",
  };
}

export function getRerunDisabledTitle(rerunReady: boolean | undefined, t: TFunction): string | undefined {
  return rerunReady === false ? t("runs.detail.relinkBeforeRerun") : undefined;
}

export function getEmptyDatasetsMessage(status: string, t: TFunction): string {
  return getRuntimeResultEmptyMessage(status, {
    queued: t("runs.detail.datasetsPending"),
    running: t("runs.detail.datasetsPending"),
    fallback: t("runs.detail.datasetsEmpty"),
  });
}
