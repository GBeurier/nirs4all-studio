import { summarizeDatasetSchemaRef } from "./datasetSchema";
import type {
  BuildLegacyCampaignSpecInput,
  CampaignDatasetRef,
  CampaignPipelineRef,
  CampaignRunPlanEntry,
  CampaignSpec,
} from "./campaignSpecTypes";

export function buildLegacyCampaignRunMatrix(
  datasets: CampaignDatasetRef[],
  pipelines: CampaignPipelineRef[],
): CampaignRunPlanEntry[] {
  return datasets.flatMap((dataset, datasetIndex) =>
    pipelines.map((pipeline, pipelineIndex) => ({
      id: `${dataset.id}::${pipeline.id}`,
      datasetId: dataset.id,
      pipelineId: pipeline.id,
      datasetIndex,
      pipelineIndex,
      splitGroupBy: dataset.splitGroupBy,
    })),
  );
}

export function buildPairedCampaignRunMatrix(
  datasets: CampaignDatasetRef[],
  pipelines: CampaignPipelineRef[],
): CampaignRunPlanEntry[] {
  const pairCount = Math.min(datasets.length, pipelines.length);
  return Array.from({ length: pairCount }, (_, index) => {
    const dataset = datasets[index];
    const pipeline = pipelines[index];
    return {
      id: `${dataset.id}::${pipeline.id}`,
      datasetId: dataset.id,
      pipelineId: pipeline.id,
      datasetIndex: index,
      pipelineIndex: index,
      splitGroupBy: dataset.splitGroupBy,
    };
  });
}

export function buildCampaignDatasetRefs({
  selectedDatasetIds,
  datasetLabelsById = {},
  datasetSchemasById = {},
  datasetSchemaRefsById = {},
  selectedGroupingPayload,
}: Pick<
  BuildLegacyCampaignSpecInput,
  | "selectedDatasetIds"
  | "datasetLabelsById"
  | "datasetSchemasById"
  | "datasetSchemaRefsById"
  | "selectedGroupingPayload"
>): CampaignDatasetRef[] {
  return selectedDatasetIds.map((datasetId) => {
    const datasetLabel = datasetLabelsById[datasetId];
    const datasetSchemaRef = datasetSchemaRefsById[datasetId];
    const datasetSchema = datasetSchemasById[datasetId] ??
      (datasetSchemaRef ? summarizeDatasetSchemaRef(datasetSchemaRef) : undefined);
    return {
      id: datasetId,
      ...(datasetLabel || datasetSchemaRef?.datasetName ? { name: datasetLabel || datasetSchemaRef?.datasetName } : {}),
      ...(datasetSchema ? { schema: datasetSchema } : {}),
      ...(datasetSchemaRef ? { schemaRef: datasetSchemaRef } : {}),
      splitGroupBy: selectedGroupingPayload[datasetId] ?? null,
    };
  });
}

export function buildLegacyCampaignSpec({
  name,
  description,
  selectedPipelines,
  executionBackend = "local-python",
  ...datasetInput
}: BuildLegacyCampaignSpecInput): CampaignSpec {
  const datasets = buildCampaignDatasetRefs(datasetInput);
  return {
    name,
    description: description || undefined,
    mode: "legacy_cartesian",
    executionBackend,
    datasets,
    pipelines: selectedPipelines,
    runMatrix: buildLegacyCampaignRunMatrix(datasets, selectedPipelines),
  };
}

export function buildPairedCampaignSpec({
  name,
  description,
  selectedPipelines,
  executionBackend = "local-python",
  ...datasetInput
}: BuildLegacyCampaignSpecInput): CampaignSpec {
  const datasets = buildCampaignDatasetRefs(datasetInput);
  return {
    name,
    description: description || undefined,
    mode: "paired_by_index",
    executionBackend,
    datasets,
    pipelines: selectedPipelines,
    runMatrix: buildPairedCampaignRunMatrix(datasets, selectedPipelines),
  };
}
