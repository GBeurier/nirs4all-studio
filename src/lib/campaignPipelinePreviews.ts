import { buildPipelineComplexityPreview } from "./pipelineComplexityPreview";
import { summarizePipelineGraphSpec } from "./pipelineGraphSpec";
import type {
  CampaignPipelinePreviewEntry,
} from "./campaignPlanPreviewTypes";
import type {
  CampaignPipelineSource,
  CampaignSpec,
} from "./campaignSpecTypes";
import {
  formatOptionalCampaignPreviewCount,
} from "./campaignDatasetSchemaLabels";

export function getCampaignPipelineSourceLabel(source: CampaignPipelineSource): string {
  if (source === "inline") return "Current editor";
  if (source === "inline-pruned") return "Pruned inline";
  return "Saved pipeline";
}

export function buildCampaignPipelinePreviews(campaign: CampaignSpec): CampaignPipelinePreviewEntry[] {
  return campaign.pipelines.map((pipeline) => {
    const graphSummary = pipeline.graph ? summarizePipelineGraphSpec(pipeline.graph) : null;
    const complexityLabels = pipeline.graph
      ? buildPipelineComplexityPreview(pipeline.graph).labels.filter((label) => (
        label !== "No refit, finetune, sweeps, or generators" &&
        label !== "Unknown pipeline complexity"
      ))
      : [];
    return {
      id: pipeline.id,
      label: pipeline.name || pipeline.id,
      sourceLabel: getCampaignPipelineSourceLabel(pipeline.source),
      stepCountLabel: formatOptionalCampaignPreviewCount(pipeline.stepCount ?? graphSummary?.topLevelNodeCount, "step"),
      stepSummaryLabel: pipeline.stepSummary || graphSummary?.stepSummary || "Unknown steps",
      complexityLabels,
    };
  });
}
