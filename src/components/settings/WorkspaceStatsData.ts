/**
 * Pure presentation helpers for workspace statistics.
 *
 * These projections keep store/API data shaping out of the React component so
 * future storage backends can change the source data without spreading derived
 * labels and cards through JSX.
 */

import { formatBytes } from "@/utils/formatters";
import type {
  CleanCacheResponse,
  SpaceUsageItem,
  WorkspaceStatsResponse,
} from "@/types/settings";

export interface WorkspaceSpaceUsageRow {
  key: string;
  name: string;
  fileCountLabel: string;
  sizeLabel: string;
  percentage: number;
  percentageLabel: string;
}

export interface WorkspaceStatCard {
  key: string;
  label: string;
  value: string;
  detail?: string;
  valueClassName: string;
}

export interface WorkspaceActionState {
  type: "clean" | "backup";
  message: string;
}

export type WorkspaceActionFeedbackTone = "success" | "error";
export type WorkspaceActionFeedbackIcon = "check" | "alert";

export interface WorkspaceActionFeedbackDescriptor {
  key: string;
  tone: WorkspaceActionFeedbackTone;
  icon: WorkspaceActionFeedbackIcon;
  message: string;
}

export interface WorkspaceActionFeedbackInput {
  lastAction: WorkspaceActionState | null;
  error: string | null;
}

export function getWorkspaceSpaceUsageRows(
  spaceUsage: SpaceUsageItem[],
): WorkspaceSpaceUsageRow[] {
  return spaceUsage
    .filter((item) => item.size_bytes > 0)
    .map((item) => ({
      key: item.name,
      name: item.name,
      fileCountLabel: `${item.file_count} files`,
      sizeLabel: formatBytes(item.size_bytes),
      percentage: item.percentage,
      percentageLabel: `${item.percentage}%`,
    }));
}

export function getWorkspaceCountCards(
  stats: WorkspaceStatsResponse,
): WorkspaceStatCard[] {
  return [
    {
      key: "runs",
      label: "Runs",
      value: String(stats.runs_count),
      valueClassName: "text-2xl font-bold",
    },
    {
      key: "datasets",
      label: "Datasets",
      value: String(stats.datasets_count),
      valueClassName: "text-2xl font-bold",
    },
    {
      key: "predictions",
      label: "Predictions",
      value: String(stats.predictions_count),
      valueClassName: "text-2xl font-bold",
    },
    {
      key: "models",
      label: "Models",
      value: String(stats.models_count),
      valueClassName: "text-2xl font-bold",
    },
  ];
}

export function getWorkspaceStorageSummaryCards(
  stats: WorkspaceStatsResponse,
): WorkspaceStatCard[] {
  return [
    {
      key: "total-size",
      label: "Total Size",
      value: formatBytes(stats.total_size_bytes),
      valueClassName: "text-2xl font-bold",
    },
    {
      key: "linked-datasets",
      label: "Globally Linked Datasets",
      value: String(stats.linked_datasets_count),
      detail: `(${formatBytes(stats.linked_datasets_external_size)} external)`,
      valueClassName: "text-2xl font-bold",
    },
    {
      key: "storage-mode",
      label: "Storage Mode",
      value: stats.storage_mode,
      valueClassName: "text-xl font-semibold capitalize",
    },
    {
      key: "database-parquet",
      label: "Database / Parquet",
      value: `${formatBytes(stats.duckdb_size_bytes)} / ${formatBytes(stats.parquet_arrays_size_bytes)}`,
      valueClassName: "text-sm font-medium",
    },
  ];
}

export function getCleanCacheSuccessMessage(result: CleanCacheResponse): string {
  return `Cleaned ${result.files_removed} files, freed ${formatBytes(result.bytes_freed)}`;
}

export function getWorkspaceActionFeedbackDescriptors({
  lastAction,
  error,
}: WorkspaceActionFeedbackInput): WorkspaceActionFeedbackDescriptor[] {
  const descriptors: WorkspaceActionFeedbackDescriptor[] = [];

  if (lastAction) {
    descriptors.push({
      key: `action-${lastAction.type}`,
      tone: "success",
      icon: "check",
      message: lastAction.message,
    });
  }

  if (error) {
    descriptors.push({
      key: "error",
      tone: "error",
      icon: "alert",
      message: error,
    });
  }

  return descriptors;
}
