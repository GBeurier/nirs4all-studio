import { getCampaignRunCount } from "./campaignPlanSummary";
import { buildLegacyCampaignSpec } from "./campaignSpecBuilders";
import type {
  CampaignExecutionBackend,
  CampaignPipelineRef,
  CampaignSpec,
} from "./campaignSpecTypes";
import { buildCampaignPipelineRefFromSteps } from "./campaignPipelineAdapter";
import type { ExperimentDatasetOption } from "./experimentDatasetOptions";
import {
  CURRENT_EDITED_PIPELINE_ID,
  type SelectedPipelineConfig,
} from "./experimentPipelineSelection";

export interface BuildExperimentCampaignSpecInput {
  name: string;
  description?: string;
  selectedDatasetIds: string[];
  datasetById?: Map<string, Pick<ExperimentDatasetOption, "name" | "schemaRef">>;
  selectedPipelineConfigs: SelectedPipelineConfig[];
  selectedGroupingPayload: Record<string, string | null>;
  executionBackend?: CampaignExecutionBackend;
}

export function getPlannedRunCount(
  selectedDatasetIds: string[],
  selectedPipelineIds: string[],
): number {
  const campaign = buildLegacyCampaignSpec({
    name: "",
    selectedDatasetIds,
    selectedPipelines: selectedPipelineIds.map((pipelineId) => ({
      id: pipelineId,
      name: pipelineId,
      source: pipelineId === CURRENT_EDITED_PIPELINE_ID ? "inline" : "saved",
    })),
    selectedGroupingPayload: {},
  });

  return getCampaignRunCount(campaign);
}

export function getSelectedGroupingPayload(
  selectedDatasetIds: string[],
  splitGroupByByDataset: Record<string, string | null>,
): Record<string, string | null> {
  return Object.fromEntries(
    selectedDatasetIds.map((datasetId) => [
      datasetId,
      splitGroupByByDataset[datasetId] ?? null,
    ]),
  );
}

function toCampaignPipelineRef(pipeline: SelectedPipelineConfig): CampaignPipelineRef {
  return buildCampaignPipelineRefFromSteps({
    id: pipeline.id,
    name: pipeline.name,
    source: pipeline.id === CURRENT_EDITED_PIPELINE_ID ? "inline" : "saved",
    steps: pipeline.steps,
  });
}

export function buildExperimentCampaignSpec({
  name,
  description,
  selectedDatasetIds,
  datasetById,
  selectedPipelineConfigs,
  selectedGroupingPayload,
  executionBackend,
}: BuildExperimentCampaignSpecInput): CampaignSpec {
  return buildLegacyCampaignSpec({
    name,
    description,
    selectedDatasetIds,
    datasetLabelsById: Object.fromEntries(
      selectedDatasetIds.map((datasetId) => [datasetId, datasetById?.get(datasetId)?.name]),
    ),
    datasetSchemaRefsById: Object.fromEntries(
      selectedDatasetIds.map((datasetId) => [
        datasetId,
        datasetById?.get(datasetId)?.schemaRef,
      ]),
    ),
    selectedPipelines: selectedPipelineConfigs.map(toCampaignPipelineRef),
    selectedGroupingPayload,
    executionBackend,
  });
}
