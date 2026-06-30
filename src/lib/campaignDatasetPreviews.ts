import {
  formatDatasetAggregationLabel,
  formatDatasetAggregationSourceLabel,
} from "./datasetSchemaAggregation";
import { summarizeDatasetSchemaRef } from "./datasetSchema";
import type {
  CampaignDatasetPreviewEntry,
} from "./campaignPlanPreviewTypes";
import type { CampaignSpec } from "./campaignSpecTypes";
import {
  formatCampaignDatasetSourceModeLabel,
  formatCampaignDatasetTaskTypeLabel,
  formatOptionalCampaignPreviewCount,
  getCampaignDatasetDefaultDataView,
  getCampaignDatasetTargetCount,
} from "./campaignDatasetSchemaLabels";

export function buildCampaignDatasetPreviews(campaign: CampaignSpec): CampaignDatasetPreviewEntry[] {
  return campaign.datasets.map((dataset) => {
    const schema = dataset.schema ?? (dataset.schemaRef ? summarizeDatasetSchemaRef(dataset.schemaRef) : undefined);
    const defaultDataView = getCampaignDatasetDefaultDataView(dataset.schemaRef);
    const aggregation = dataset.schemaRef?.aggregation;
    return {
      id: dataset.id,
      label: dataset.name || dataset.schemaRef?.datasetName || dataset.id,
      sampleCountLabel: formatOptionalCampaignPreviewCount(schema?.sampleCount, "sample"),
      featureCountLabel: formatOptionalCampaignPreviewCount(schema?.featureCount, "feature"),
      sourceCountLabel: formatOptionalCampaignPreviewCount(dataset.schemaRef?.sourceCount, "source"),
      sourceModeLabel: formatCampaignDatasetSourceModeLabel(dataset.schemaRef),
      representationCountLabel: formatOptionalCampaignPreviewCount(dataset.schemaRef?.representations.length, "representation"),
      dataViewLabel: defaultDataView?.label || "Unknown data view",
      dataViewTaskLabel: formatCampaignDatasetTaskTypeLabel(defaultDataView?.taskType ?? dataset.schemaRef?.taskType),
      targetCountLabel: formatOptionalCampaignPreviewCount(getCampaignDatasetTargetCount(schema, dataset.schemaRef), "target"),
      targetLabel: schema?.targetLabel || "Unknown target",
      metadataColumnCountLabel: formatOptionalCampaignPreviewCount(schema?.metadataColumnCount, "metadata column"),
      repetitionLabel: schema?.repetitionColumn
        ? `repetition: ${schema.repetitionColumn}`
        : "No repetition column",
      aggregationLabel: aggregation
        ? formatDatasetAggregationLabel(aggregation)
        : "No aggregation configured",
      aggregationSourceLabel: aggregation ? formatDatasetAggregationSourceLabel(aggregation) : null,
      splitGroupBy: dataset.splitGroupBy,
    };
  });
}
