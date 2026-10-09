import i18n from "i18next";

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

/** Nouns with a pluralised count label (`newExperiment.counts.<noun>`). */
export type CampaignPreviewCountNoun =
  | "sample"
  | "feature"
  | "source"
  | "representation"
  | "target"
  | "metadataColumn"
  | "activeNode"
  | "step"
  | "refitNode";

/** Nouns that also have an "Unknown …" label (`newExperiment.unknownCount.<noun>`). */
export type CampaignPreviewOptionalCountNoun = Exclude<CampaignPreviewCountNoun, "refitNode">;

export function formatCampaignPreviewCount(count: number, noun: CampaignPreviewCountNoun): string {
  return i18n.t(`newExperiment.counts.${noun}`, { count });
}

export function formatOptionalCampaignPreviewCount(
  count: number | null | undefined,
  noun: CampaignPreviewOptionalCountNoun,
): string {
  if (typeof count !== "number") return i18n.t(`newExperiment.unknownCount.${noun}`);
  return formatCampaignPreviewCount(count, noun);
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
