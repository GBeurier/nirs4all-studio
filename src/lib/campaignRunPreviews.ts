import type {
  DatasetPipelineCompatibilityPreview,
} from "./campaignCompatibilityTypes";
import type {
  CampaignDatasetPreviewEntry,
  CampaignPipelinePreviewEntry,
  CampaignRunPreviewEntry,
} from "./campaignPlanPreviewTypes";
import type { CampaignSpec } from "./campaignSpecTypes";
import { buildCampaignDatasetPreviews } from "./campaignDatasetPreviews";
import { buildCampaignPipelinePreviews } from "./campaignPipelinePreviews";
import {
  formatCampaignDatasetDetailLabels,
  formatCampaignPipelineDetailLabels,
} from "./campaignPlanPresentation";

export interface BuildCampaignRunPreviewsInput {
  campaign: CampaignSpec;
  limit: number;
  compatibilityPreviews?: DatasetPipelineCompatibilityPreview[];
  datasetPreviews?: CampaignDatasetPreviewEntry[];
  pipelinePreviews?: CampaignPipelinePreviewEntry[];
}

export function buildCampaignRunPreviews(
  campaign: CampaignSpec,
  runPreviewLimit: number,
  compatibilityPreviews: DatasetPipelineCompatibilityPreview[] = [],
): CampaignRunPreviewEntry[] {
  return buildCampaignRunPreviewsFromInputs({
    campaign,
    limit: runPreviewLimit,
    compatibilityPreviews,
  });
}

export function buildCampaignRunPreviewsFromInputs({
  campaign,
  limit,
  compatibilityPreviews = [],
  datasetPreviews = buildCampaignDatasetPreviews(campaign),
  pipelinePreviews = buildCampaignPipelinePreviews(campaign),
}: BuildCampaignRunPreviewsInput): CampaignRunPreviewEntry[] {
  const datasetById = new Map(campaign.datasets.map((dataset) => [dataset.id, dataset]));
  const pipelineById = new Map(campaign.pipelines.map((pipeline) => [pipeline.id, pipeline]));
  const datasetPreviewById = new Map(datasetPreviews.map((dataset) => [dataset.id, dataset]));
  const pipelinePreviewById = new Map(pipelinePreviews.map((pipeline) => [pipeline.id, pipeline]));
  const compatibilityPreviewById = new Map(compatibilityPreviews.map((preview) => [preview.id, preview]));

  return campaign.runMatrix.slice(0, limit).map((run, index) => {
    const dataset = datasetById.get(run.datasetId);
    const pipeline = pipelineById.get(run.pipelineId);
    const datasetPreview = datasetPreviewById.get(run.datasetId);
    const pipelinePreview = pipelinePreviewById.get(run.pipelineId);
    const compatibilityPreview = compatibilityPreviewById.get(run.id);

    return {
      id: run.id,
      datasetId: run.datasetId,
      pipelineId: run.pipelineId,
      datasetLabel: dataset?.name || dataset?.id || run.datasetId,
      pipelineLabel: pipeline?.name ?? run.pipelineId,
      datasetDetailLabels: datasetPreview ? formatCampaignDatasetDetailLabels(datasetPreview) : [],
      pipelineDetailLabels: pipelinePreview ? formatCampaignPipelineDetailLabels(pipelinePreview) : [],
      compatibilityStatus: compatibilityPreview?.status ?? null,
      compatibilityStatusLabel: compatibilityPreview?.statusLabel ?? null,
      compatibilitySummary: compatibilityPreview?.summary ?? null,
      splitGroupBy: run.splitGroupBy,
      positionLabel: `Run ${index + 1}`,
    };
  });
}

export function getHiddenCampaignRunPreviewCount(
  runCount: number,
  previewCount: number,
): number {
  return Math.max(0, runCount - previewCount);
}
