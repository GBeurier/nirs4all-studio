import i18n from "i18next";

import type {
  CampaignDatasetRef,
  CampaignPipelineRef,
  CampaignRunPlanEntry,
  CampaignSpec,
} from "./campaignSpecTypes";
import {
  buildDatasetPipelineCompatibilityChecks,
  getDatasetPipelineCompatibilityPreviewStatus,
  getDatasetPipelineCompatibilityPreviewSummary,
  getDatasetPipelineCompatibilityStatusLabel,
} from "./campaignCompatibilityChecks";
import {
  formatCampaignDatasetSourceModeLabel,
  formatCampaignDatasetTaskTypeLabel,
  formatCampaignPreviewCount,
  formatOptionalCampaignPreviewCount,
  getCampaignDatasetDefaultDataView,
  getCampaignDatasetTargetCount,
} from "./campaignDatasetSchemaLabels";
import { buildCampaignTransformationEstimate } from "./campaignTransformationEstimates";
import {
  formatDatasetAggregationLabel,
  formatDatasetAggregationSourceLabel,
} from "./datasetSchemaAggregation";
import { buildPipelineComplexityPreview } from "./pipelineComplexityPreview";
import type { DatasetPipelineCompatibilityPreview } from "./campaignCompatibilityTypes";

function getDatasetLabel(dataset: CampaignDatasetRef | undefined, fallbackId: string): string {
  return dataset?.name || dataset?.schemaRef?.datasetName || fallbackId;
}

function getPipelineLabel(pipeline: CampaignPipelineRef | undefined, fallbackId: string): string {
  return pipeline?.name || fallbackId;
}

export function buildDatasetPipelineCompatibilityPreview({
  run,
  dataset,
  pipeline,
}: {
  run: CampaignRunPlanEntry;
  dataset?: CampaignDatasetRef;
  pipeline?: CampaignPipelineRef;
}): DatasetPipelineCompatibilityPreview {
  const schemaRef = dataset?.schemaRef;
  const graph = pipeline?.graph;
  const defaultDataView = getCampaignDatasetDefaultDataView(schemaRef);
  const checks = buildDatasetPipelineCompatibilityChecks({ dataset, pipeline, defaultDataView });
  const transformationEstimate = buildCampaignTransformationEstimate({
    schemaRef,
    dataView: defaultDataView,
    graph,
  });
  const pipelineComplexity = buildPipelineComplexityPreview(graph);
  const aggregation = schemaRef?.aggregation;

  const status = getDatasetPipelineCompatibilityPreviewStatus(checks);

  return {
    id: run.id,
    datasetId: run.datasetId,
    pipelineId: run.pipelineId,
    datasetLabel: getDatasetLabel(dataset, run.datasetId),
    pipelineLabel: getPipelineLabel(pipeline, run.pipelineId),
    status,
    statusLabel: getDatasetPipelineCompatibilityStatusLabel(status),
    summary: getDatasetPipelineCompatibilityPreviewSummary(status),
    dataViewLabel: defaultDataView?.label || i18n.t("newExperiment.campaign.unknownDataView"),
    dataViewTaskLabel: formatCampaignDatasetTaskTypeLabel(defaultDataView?.taskType ?? schemaRef?.taskType),
    targetLabel: schemaRef?.defaultTargetColumn || i18n.t("newExperiment.campaign.unknownTarget"),
    targetCountLabel: formatOptionalCampaignPreviewCount(getCampaignDatasetTargetCount(dataset?.schema, schemaRef), "target"),
    sourceCountLabel: formatOptionalCampaignPreviewCount(schemaRef?.sourceCount, "source"),
    sourceModeLabel: formatCampaignDatasetSourceModeLabel(schemaRef),
    datasetAggregationLabel: aggregation
      ? formatDatasetAggregationLabel(aggregation)
      : i18n.t("newExperiment.campaign.noAggregation"),
    datasetAggregationSourceLabel: aggregation ? formatDatasetAggregationSourceLabel(aggregation) : null,
    pipelineNodeCountLabel: graph
      ? formatCampaignPreviewCount(graph.stats.activeNodeCount, "activeNode")
      : i18n.t("newExperiment.unknownCount.activeNode"),
    transformationSizeLabel: transformationEstimate.label,
    pipelineComplexityLabels: pipelineComplexity.labels,
    checks,
  };
}

export function buildCampaignCompatibilityPreviews(
  campaign: CampaignSpec,
): DatasetPipelineCompatibilityPreview[] {
  const datasetById = new Map(campaign.datasets.map((dataset) => [dataset.id, dataset]));
  const pipelineById = new Map(campaign.pipelines.map((pipeline) => [pipeline.id, pipeline]));

  return campaign.runMatrix
    .filter((run) => {
      const dataset = datasetById.get(run.datasetId);
      const pipeline = pipelineById.get(run.pipelineId);
      return !dataset || !pipeline || Boolean(dataset.schemaRef || pipeline.graph);
    })
    .map((run) => buildDatasetPipelineCompatibilityPreview({
      run,
      dataset: datasetById.get(run.datasetId),
      pipeline: pipelineById.get(run.pipelineId),
    }));
}
