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

function formatInteger(value: number): string {
  return value.toLocaleString("en-US");
}

function formatUnitCount(value: number, singular: string): string {
  return `${formatInteger(value)} ${singular}${value === 1 ? "" : "s"}`;
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
      label: "Unknown transformation size",
    };
  }

  const estimatedCellCount = sampleCount * featureCount * activeNodeCount;

  const sourceSuffix = sourceCount !== null && sourceCount > 1
    ? `across ${formatUnitCount(sourceCount, "source")}`
    : null;
  const estimateSuffix = sourceSuffix
    ? `${sourceSuffix} (~${formatUnitCount(estimatedCellCount, "cell")})`
    : `(~${formatUnitCount(estimatedCellCount, "cell")})`;

  return {
    sampleCount,
    featureCount,
    sourceCount,
    activeNodeCount,
    estimatedCellCount,
    label: [
      "size:",
      formatUnitCount(sampleCount, "sample"),
      "x",
      formatUnitCount(featureCount, "feature"),
      "x",
      formatUnitCount(activeNodeCount, "active node"),
      estimateSuffix,
    ].join(" "),
  };
}
