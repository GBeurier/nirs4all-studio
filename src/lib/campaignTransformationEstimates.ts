import i18n from "i18next";

import type { DataViewRef, DatasetSchemaRef } from "./datasetSchema";
import type { PipelineGraphSpec } from "./pipelineGraphSpec";

export interface CampaignTransformationEstimate {
  sampleCount: number | null;
  featureCount: number | null;
  sourceCount: number | null;
  activeNodeCount: number | null;
  estimatedCellCount: number | null;
  label: string;
}

export interface CampaignTransformationEstimateInput {
  schemaRef?: Pick<DatasetSchemaRef, "sampleCount" | "featureCount" | "sourceCount"> | null;
  dataView?: Pick<DataViewRef, "sampleCount" | "featureCount" | "sourceCount"> | null;
  graph?: Pick<PipelineGraphSpec, "stats"> | null;
}

function normalizeCount(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function formatUnitCount(value: number, unit: "sample" | "feature" | "source" | "activeNode" | "cell"): string {
  return i18n.t(`newExperiment.campaign.transformation.units.${unit}`, { count: value });
}

export function buildCampaignTransformationEstimate({
  schemaRef,
  dataView,
  graph,
}: CampaignTransformationEstimateInput): CampaignTransformationEstimate {
  const sampleCount = normalizeCount(dataView?.sampleCount ?? schemaRef?.sampleCount);
  const featureCount = normalizeCount(dataView?.featureCount ?? schemaRef?.featureCount);
  const sourceCount = normalizeCount(dataView?.sourceCount ?? schemaRef?.sourceCount);
  const activeNodeCount = normalizeCount(graph?.stats.activeNodeCount);
  if (sampleCount === null || featureCount === null || activeNodeCount === null) {
    return {
      sampleCount,
      featureCount,
      sourceCount,
      activeNodeCount,
      estimatedCellCount: null,
      label: i18n.t("newExperiment.campaign.transformation.unknown"),
    };
  }

  const estimatedCellCount = sampleCount * featureCount * activeNodeCount;

  const cells = formatUnitCount(estimatedCellCount, "cell");
  const estimateSuffix = sourceCount !== null && sourceCount > 1
    ? i18n.t("newExperiment.campaign.transformation.acrossSources", {
      sources: formatUnitCount(sourceCount, "source"),
      cells,
    })
    : i18n.t("newExperiment.campaign.transformation.cellsOnly", { cells });

  return {
    sampleCount,
    featureCount,
    sourceCount,
    activeNodeCount,
    estimatedCellCount,
    label: i18n.t("newExperiment.campaign.transformation.label", {
      samples: formatUnitCount(sampleCount, "sample"),
      features: formatUnitCount(featureCount, "feature"),
      nodes: formatUnitCount(activeNodeCount, "activeNode"),
      suffix: estimateSuffix,
    }),
  };
}
