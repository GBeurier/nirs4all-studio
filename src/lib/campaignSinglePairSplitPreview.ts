import i18n from "i18next";

import type {
  CampaignSinglePairSplitCandidatePreview,
  CampaignSinglePairSplitPreview,
  CampaignSinglePairSplitSpec,
  CampaignSinglePairSplitSpecResult,
} from "./campaignPlanPreviewTypes";
import type {
  CampaignDatasetRef,
  CampaignPipelineRef,
  CampaignRunPlanEntry,
  CampaignSpec,
} from "./campaignSpecTypes";

function getDatasetRef(campaign: CampaignSpec, datasetId: string): CampaignDatasetRef | null {
  return campaign.datasets.find((candidate) => candidate.id === datasetId) ?? null;
}

function getPipelineRef(campaign: CampaignSpec, pipelineId: string): CampaignPipelineRef | null {
  return campaign.pipelines.find((candidate) => candidate.id === pipelineId) ?? null;
}

function getDatasetLabel(campaign: CampaignSpec, datasetId: string): string {
  const dataset = getDatasetRef(campaign, datasetId);
  return dataset?.name || dataset?.schemaRef?.datasetName || datasetId;
}

function getPipelineLabel(campaign: CampaignSpec, pipelineId: string): string {
  const pipeline = getPipelineRef(campaign, pipelineId);
  return pipeline?.name || pipelineId;
}

function buildSinglePairSplitId(runId: string): string {
  return `single-pair:${runId}`;
}

function buildSuggestedCampaignName(
  campaignName: string,
  datasetLabel: string,
  pipelineLabel: string,
): string {
  return `${campaignName} / ${datasetLabel} -> ${pipelineLabel}`;
}

function buildSplitCandidatePreview(
  campaign: CampaignSpec,
  runIndex: number,
): CampaignSinglePairSplitCandidatePreview {
  const run = campaign.runMatrix[runIndex];
  const datasetLabel = getDatasetLabel(campaign, run.datasetId);
  const pipelineLabel = getPipelineLabel(campaign, run.pipelineId);

  return {
    id: buildSinglePairSplitId(run.id),
    runId: run.id,
    datasetId: run.datasetId,
    pipelineId: run.pipelineId,
    datasetLabel,
    pipelineLabel,
    suggestedCampaignName: buildSuggestedCampaignName(campaign.name, datasetLabel, pipelineLabel),
    summaryLabel: i18n.t("newExperiment.campaign.split.candidateSummary"),
    splitGroupBy: run.splitGroupBy,
    positionLabel: i18n.t("newExperiment.campaign.split.position", { n: runIndex + 1 }),
  };
}

function buildSinglePairRunPlanEntry(run: CampaignRunPlanEntry): CampaignRunPlanEntry {
  return {
    id: run.id,
    datasetId: run.datasetId,
    pipelineId: run.pipelineId,
    datasetIndex: 0,
    pipelineIndex: 0,
    splitGroupBy: run.splitGroupBy,
  };
}

function buildSinglePairSplitSpec(
  campaign: CampaignSpec,
  run: CampaignRunPlanEntry,
): CampaignSinglePairSplitSpec | null {
  const dataset = getDatasetRef(campaign, run.datasetId);
  const pipeline = getPipelineRef(campaign, run.pipelineId);

  if (!dataset || !pipeline) return null;

  const datasetLabel = dataset.name || dataset.schemaRef?.datasetName || dataset.id;
  const pipelineLabel = pipeline.name || pipeline.id;
  const strictDataset: CampaignDatasetRef = {
    ...dataset,
    splitGroupBy: run.splitGroupBy,
  };
  const strictPipeline: CampaignPipelineRef = { ...pipeline };

  return {
    id: buildSinglePairSplitId(run.id),
    sourceRunId: run.id,
    sourceDatasetId: run.datasetId,
    sourcePipelineId: run.pipelineId,
    campaign: {
      name: buildSuggestedCampaignName(campaign.name, datasetLabel, pipelineLabel),
      ...(campaign.description ? { description: campaign.description } : {}),
      mode: "paired_by_index",
      executionBackend: campaign.executionBackend,
      datasets: [strictDataset],
      pipelines: [strictPipeline],
      runMatrix: [buildSinglePairRunPlanEntry(run)],
    },
  };
}

export function buildCampaignSinglePairSplitPreview(
  campaign: CampaignSpec,
  candidateLimit: number,
): CampaignSinglePairSplitPreview {
  if (campaign.datasets.length === 0 || campaign.pipelines.length === 0 || campaign.runMatrix.length === 0) {
    return {
      status: "not_evaluated",
      statusLabel: i18n.t("newExperiment.campaign.split.pending.status"),
      summary: i18n.t("newExperiment.campaign.split.pending.summary"),
      candidatePreviews: [],
      hiddenCandidateCount: 0,
    };
  }

  if (campaign.datasets.length === 1 && campaign.pipelines.length === 1 && campaign.runMatrix.length === 1) {
    return {
      status: "already_single_pair",
      statusLabel: i18n.t("newExperiment.campaign.split.single.status"),
      summary: i18n.t("newExperiment.campaign.split.single.summary"),
      candidatePreviews: [],
      hiddenCandidateCount: 0,
    };
  }

  const safeLimit = Math.max(0, candidateLimit);
  const candidatePreviews = campaign.runMatrix
    .slice(0, safeLimit)
    .map((_, index) => buildSplitCandidatePreview(campaign, index));

  return {
    status: "split_recommended",
    statusLabel: i18n.t("newExperiment.campaign.split.recommended.status"),
    summary: i18n.t("newExperiment.campaign.split.recommended.summary", { count: campaign.runMatrix.length }),
    candidatePreviews,
    hiddenCandidateCount: Math.max(0, campaign.runMatrix.length - candidatePreviews.length),
  };
}

export function buildCampaignSinglePairSplitSpecs(
  campaign: CampaignSpec,
): CampaignSinglePairSplitSpecResult {
  const splitSpecs: CampaignSinglePairSplitSpec[] = [];
  const skippedRunIds: string[] = [];

  for (const run of campaign.runMatrix) {
    const splitSpec = buildSinglePairSplitSpec(campaign, run);
    if (splitSpec) {
      splitSpecs.push(splitSpec);
    } else {
      skippedRunIds.push(run.id);
    }
  }

  return {
    splitSpecs,
    skippedRunIds,
  };
}
