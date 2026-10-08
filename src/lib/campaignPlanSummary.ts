import type {
  CampaignPlanMode,
  CampaignPlanSummary,
  CampaignSpec,
} from "./campaignSpecTypes";

export type CampaignPairingModeKind =
  | "incomplete"
  | "single_pair"
  | "strict_pairs"
  | "cartesian_matrix"
  | "explicit_matrix";

export interface CampaignPairingModeReadModel {
  kind: CampaignPairingModeKind;
  label: string;
  strictPairingLabel: string;
  isStrictPairingReady: boolean;
}

export type CampaignStrictOnePairReadinessStatus = "ready" | "not_ready";

export interface CampaignStrictOnePairReadinessReadModel {
  status: CampaignStrictOnePairReadinessStatus;
  label: string;
  isReady: boolean;
}

export function getCampaignRunCount(campaign: CampaignSpec): number {
  return campaign.runMatrix.length;
}

function formatCount(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function summarizeCampaignPlan(campaign: CampaignSpec): CampaignPlanSummary {
  const runCount = getCampaignRunCount(campaign);
  const datasetCount = campaign.datasets.length;
  const pipelineCount = campaign.pipelines.length;
  const matrixCapacity = datasetCount * pipelineCount;
  const datasetCountLabel = formatCount(campaign.datasets.length, "dataset");
  const pipelineCountLabel = formatCount(campaign.pipelines.length, "pipeline");
  const runCountLabel = formatCount(runCount, "run");
  const matrixCapacityLabel = formatCount(matrixCapacity, "possible pair");

  return {
    mode: campaign.mode,
    executionBackend: campaign.executionBackend,
    datasetCount,
    pipelineCount,
    runCount,
    matrixCapacity,
    datasetCountLabel,
    pipelineCountLabel,
    runCountLabel,
    inputCardinalityLabel: `${datasetCountLabel} x ${pipelineCountLabel}`,
    matrixCapacityLabel,
    matrixCoverageLabel: `${runCountLabel} planned from ${matrixCapacityLabel}`,
    launchSummary: `${runCountLabel} across ${datasetCountLabel} and ${pipelineCountLabel}`,
  };
}

export function getCampaignPlanModeLabel(mode: CampaignPlanMode): string {
  if (mode === "legacy_cartesian") return "All combinations";
  if (mode === "paired_by_index") return "Selected combinations";
  return mode;
}

const campaignPairingModeReadModels: Record<CampaignPairingModeKind, CampaignPairingModeReadModel> = {
  incomplete: {
    kind: "incomplete",
    label: "Pending pairing",
    strictPairingLabel: "Pending inputs",
    isStrictPairingReady: false,
  },
  single_pair: {
    kind: "single_pair",
    label: "One dataset / one pipeline",
    strictPairingLabel: "One analysis ready",
    isStrictPairingReady: true,
  },
  strict_pairs: {
    kind: "strict_pairs",
    label: "Explicit dataset/pipeline pairs",
    strictPairingLabel: "Selected analyses ready",
    isStrictPairingReady: true,
  },
  cartesian_matrix: {
    kind: "cartesian_matrix",
    label: "All dataset/pipeline pairs",
    strictPairingLabel: "All combinations",
    isStrictPairingReady: false,
  },
  explicit_matrix: {
    kind: "explicit_matrix",
    label: "Selected analyses",
    strictPairingLabel: "Review each combination",
    isStrictPairingReady: false,
  },
};

const campaignStrictOnePairReadinessReadModels: Record<
  CampaignPairingModeKind,
  CampaignStrictOnePairReadinessReadModel
> = {
  incomplete: {
    status: "not_ready",
    label: "Pending inputs",
    isReady: false,
  },
  single_pair: {
    status: "ready",
    label: "One analysis ready",
    isReady: true,
  },
  strict_pairs: {
    status: "not_ready",
    label: "Several selected analyses",
    isReady: false,
  },
  cartesian_matrix: {
    status: "not_ready",
    label: "All combinations",
    isReady: false,
  },
  explicit_matrix: {
    status: "not_ready",
    label: "Select one combination",
    isReady: false,
  },
};

function getCampaignPairingModeKind(
  campaign: CampaignSpec,
  summary: CampaignPlanSummary,
): CampaignPairingModeKind {
  if (summary.datasetCount === 0 || summary.pipelineCount === 0 || summary.runCount === 0) {
    return "incomplete";
  }
  if (summary.datasetCount === 1 && summary.pipelineCount === 1 && summary.runCount === 1) {
    return "single_pair";
  }
  if (campaign.mode === "paired_by_index") {
    return "strict_pairs";
  }
  if (summary.runCount === summary.matrixCapacity) {
    return "cartesian_matrix";
  }
  return "explicit_matrix";
}

export function getCampaignPairingModeReadModel(
  campaign: CampaignSpec,
): CampaignPairingModeReadModel {
  const kind = getCampaignPairingModeKind(campaign, summarizeCampaignPlan(campaign));
  return { ...campaignPairingModeReadModels[kind] };
}

export function getCampaignStrictOnePairReadinessReadModel(
  pairingMode: CampaignPairingModeReadModel,
): CampaignStrictOnePairReadinessReadModel {
  return { ...campaignStrictOnePairReadinessReadModels[pairingMode.kind] };
}
