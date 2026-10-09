/**
 * Pure presentation helpers for workspace statistics.
 *
 * These projections keep store/API data shaping out of the React component so
 * future storage backends can change the source data without spreading derived
 * labels and cards through JSX.
 */

import type { TFunction } from "i18next";

import { formatBytes } from "@/utils/formatters";
import type {
  CleanCacheResponse,
  SpaceUsageItem,
  WorkspaceStatsResponse,
} from "@/types/settings";

export interface WorkspaceSpaceUsageRow {
  key: string;
  name: string;
  label: string;
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
  type: "clean" | "backup" | "conversion";
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

/** Localized label for a storage mode reported by the backend (unknown modes are shown as-is). */
export function getStorageModeLabel(mode: string, t: TFunction): string {
  switch (mode) {
    case "new":
      return t("settings.storageMode.new");
    case "migrated":
      return t("settings.storageMode.migrated");
    case "legacy":
      return t("settings.storageMode.legacy");
    case "mid_migration":
      return t("settings.storageMode.midMigration");
    case "unknown":
      return t("settings.storageMode.unknown");
    default:
      return mode;
  }
}

/** Localized label for a space-usage category name reported by the backend (unknown names are shown as-is). */
function getSpaceUsageLabel(name: string, t: TFunction): string {
  switch (name) {
    case "Runs":
      return t("settings.workspaceStats.usage.runs");
    case "Exports":
      return t("settings.workspaceStats.usage.exports");
    case "Templates":
      return t("settings.workspaceStats.usage.templates");
    case "Trained models":
      return t("settings.workspaceStats.usage.trainedModels");
    case "Prediction arrays":
      return t("settings.workspaceStats.usage.predictionArrays");
    case "Cache":
      return t("settings.workspaceStats.usage.cache");
    case "Temp":
      return t("settings.workspaceStats.usage.temp");
    default:
      return name;
  }
}

export function getWorkspaceSpaceUsageRows(
  spaceUsage: SpaceUsageItem[],
  t: TFunction,
): WorkspaceSpaceUsageRow[] {
  return spaceUsage
    .filter((item) => item.size_bytes > 0)
    .map((item) => ({
      key: item.name,
      name: item.name,
      label: getSpaceUsageLabel(item.name, t),
      fileCountLabel: t("settings.workspaceStats.fileCount", { count: item.file_count }),
      sizeLabel: formatBytes(item.size_bytes),
      percentage: item.percentage,
      percentageLabel: `${item.percentage}%`,
    }));
}

export function getWorkspaceCountCards(
  stats: WorkspaceStatsResponse,
  t: TFunction,
): WorkspaceStatCard[] {
  return [
    {
      key: "runs",
      label: t("settings.workspaceStats.cards.runs"),
      value: String(stats.runs_count),
      valueClassName: "text-2xl font-bold",
    },
    {
      key: "datasets",
      label: t("settings.workspaceStats.cards.datasets"),
      value: String(stats.datasets_count),
      valueClassName: "text-2xl font-bold",
    },
    {
      key: "predictions",
      label: t("settings.workspaceStats.cards.predictions"),
      value: String(stats.predictions_count),
      valueClassName: "text-2xl font-bold",
    },
    {
      key: "models",
      label: t("settings.workspaceStats.cards.modelExports"),
      value: String(stats.models_count),
      valueClassName: "text-2xl font-bold",
    },
  ];
}

export function getWorkspaceStorageSummaryCards(
  stats: WorkspaceStatsResponse,
  t: TFunction,
): WorkspaceStatCard[] {
  return [
    {
      key: "total-size",
      label: t("settings.workspaceStats.cards.totalSize"),
      value: formatBytes(stats.total_size_bytes),
      valueClassName: "text-2xl font-bold",
    },
    {
      key: "linked-datasets",
      label: t("settings.workspaceStats.cards.linkedDatasets"),
      value: String(stats.linked_datasets_count),
      detail: t("settings.workspaceStats.cards.externalSize", { size: formatBytes(stats.linked_datasets_external_size) }),
      valueClassName: "text-2xl font-bold",
    },
    {
      key: "storage-mode",
      label: t("settings.workspaceStats.cards.storageMode"),
      value: getStorageModeLabel(stats.storage_mode, t),
      valueClassName: "text-xl font-semibold first-letter:uppercase",
    },
    {
      key: "database-parquet",
      label: t("settings.workspaceStats.cards.databaseParquet"),
      value: `${formatBytes(stats.duckdb_size_bytes)} / ${formatBytes(stats.parquet_arrays_size_bytes)}`,
      valueClassName: "text-sm font-medium",
    },
  ];
}

export function getCleanCacheSuccessMessage(result: CleanCacheResponse, t: TFunction): string {
  return t("settings.workspaceStats.cleanSuccess", {
    count: result.files_removed,
    size: formatBytes(result.bytes_freed),
  });
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
