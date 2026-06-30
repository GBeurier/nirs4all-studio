import type { CampaignDatasetSchemaSummary } from "./campaignSpecTypes";
import { getDatasetDefaultDataView } from "./datasetSchemaAccessors";
import type {
  DataViewRef,
  DatasetSchemaRef,
} from "./datasetSchema";
import {
  formatDatasetSchemaTaskTypeLabel,
  formatDatasetSourceModeLabel,
} from "./datasetSchemaDisplay";

export function formatCampaignPreviewCount(
  count: number,
  singular: string,
  plural = `${singular}s`,
): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function formatOptionalCampaignPreviewCount(
  count: number | null | undefined,
  singular: string,
  plural = `${singular}s`,
): string {
  if (typeof count !== "number") return `Unknown ${plural}`;
  return formatCampaignPreviewCount(count, singular, plural);
}

export function getCampaignDatasetDefaultDataView(
  schemaRef: DatasetSchemaRef | undefined,
): DataViewRef | undefined {
  return getDatasetDefaultDataView(schemaRef) ?? undefined;
}

export function formatCampaignDatasetSourceModeLabel(
  schemaRef: DatasetSchemaRef | undefined,
): string {
  return formatDatasetSourceModeLabel(schemaRef?.isMultiSource);
}

export function formatCampaignDatasetTaskTypeLabel(
  taskType: Parameters<typeof formatDatasetSchemaTaskTypeLabel>[0],
): string {
  return formatDatasetSchemaTaskTypeLabel(taskType);
}

export function getCampaignDatasetTargetCount(
  schema: CampaignDatasetSchemaSummary | undefined,
  schemaRef: DatasetSchemaRef | undefined,
): number | null | undefined {
  if (schemaRef) return schemaRef.targetColumns.length;
  if (schema?.targetLabel) return 1;
  return undefined;
}
