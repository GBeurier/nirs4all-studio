import i18n from "i18next";

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
  if (source === "inline") return i18n.t("newExperiment.campaign.pipelineSource.currentEditor");
  if (source === "inline-pruned") return i18n.t("newExperiment.campaign.pipelineSource.prunedInline");
  return i18n.t("newExperiment.campaign.pipelineSource.saved");
}

export function buildCampaignPipelinePreviews(campaign: CampaignSpec): CampaignPipelinePreviewEntry[] {
  return campaign.pipelines.map((pipeline) => {
    const graphSummary = pipeline.graph ? summarizePipelineGraphSpec(pipeline.graph) : null;
    const complexity = pipeline.graph ? buildPipelineComplexityPreview(pipeline.graph) : null;
    const complexityLabels = complexity != null && [
      complexity.generatorCount,
      complexity.stepGeneratorCount,
      complexity.parameterSweepCount,
      complexity.finetuneNodeCount,
      complexity.refitNodeCount,
    ].some((count) => (count ?? 0) > 0)
      ? complexity.labels
      : [];
    return {
      id: pipeline.id,
      label: pipeline.name || pipeline.id,
      sourceLabel: getCampaignPipelineSourceLabel(pipeline.source),
      stepCountLabel: formatOptionalCampaignPreviewCount(pipeline.stepCount ?? graphSummary?.topLevelNodeCount, "step"),
      stepSummaryLabel: pipeline.stepSummary || graphSummary?.stepSummary || i18n.t("newExperiment.unknownCount.step"),
      complexityLabels,
    };
  });
}
