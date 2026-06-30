import { buildCampaignPipelineRefFromSteps } from "./campaignPipelineAdapter";
import {
  buildLegacyCampaignSpec,
  getCampaignExecutionBackendLabel,
  summarizeCampaignPlan,
  type CampaignExecutionBackend,
  type CampaignPipelineSource,
  type CampaignSpec,
} from "./campaignPlan";

export interface BuildPipelineExecutionCampaignSpecInput {
  datasetId: string;
  datasetName?: string | null;
  executionBackend?: CampaignExecutionBackend;
  name: string;
  pipelineId: string;
  pipelineName: string;
  pipelineSource?: CampaignPipelineSource;
  selectedGroupBy?: string | null;
  steps?: unknown[];
}

export interface PipelineExecutionPlanPreview {
  backendLabel: string;
  inputCardinalityLabel: string;
  matrixCoverageLabel: string;
  pipelineSourceLabel: string;
  runCountLabel: string;
  splitGroupByLabel: string;
}

export function buildPipelineExecutionCampaignSpec({
  datasetId,
  datasetName,
  executionBackend = "local-python",
  name,
  pipelineId,
  pipelineName,
  pipelineSource,
  selectedGroupBy,
  steps,
}: BuildPipelineExecutionCampaignSpecInput): CampaignSpec | null {
  if (!datasetId) return null;

  const hasInlineSteps = steps !== undefined;
  const source = pipelineSource ?? (hasInlineSteps ? "inline" : "saved");
  const selectedPipelines = hasInlineSteps
    ? [
        buildCampaignPipelineRefFromSteps({
          id: pipelineId,
          name: pipelineName,
          source,
          steps,
        }),
      ]
    : [
        {
          id: pipelineId,
          name: pipelineName,
          source,
        },
      ];

  return buildLegacyCampaignSpec({
    name,
    selectedDatasetIds: [datasetId],
    datasetLabelsById: datasetName ? { [datasetId]: datasetName } : undefined,
    selectedPipelines,
    selectedGroupingPayload: { [datasetId]: selectedGroupBy ?? null },
    executionBackend,
  });
}

export function getPipelineExecutionSplitGroupBy(
  campaign: CampaignSpec | null | undefined,
): string | null {
  return campaign?.runMatrix[0]?.splitGroupBy ?? null;
}

export function buildPipelineExecutionPlanPreview(
  campaign: CampaignSpec | null | undefined,
): PipelineExecutionPlanPreview | null {
  if (!campaign) return null;

  const summary = summarizeCampaignPlan(campaign);
  const firstPipeline = campaign.pipelines[0];
  const firstSplitGroupBy = getPipelineExecutionSplitGroupBy(campaign);
  const pipelineSourceLabel = firstPipeline?.source === "inline-pruned"
    ? "Pruned inline pipeline"
    : firstPipeline?.source === "inline"
      ? "Inline pipeline"
      : "Saved pipeline";

  return {
    backendLabel: getCampaignExecutionBackendLabel(campaign.executionBackend),
    inputCardinalityLabel: summary.inputCardinalityLabel,
    matrixCoverageLabel: summary.matrixCoverageLabel,
    pipelineSourceLabel,
    runCountLabel: summary.runCountLabel,
    splitGroupByLabel: firstSplitGroupBy ? `grouped by ${firstSplitGroupBy}` : "no runtime grouping",
  };
}
