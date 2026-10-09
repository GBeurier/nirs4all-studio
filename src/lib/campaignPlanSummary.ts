import i18n from "i18next";

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

function formatCount(key: string, count: number): string {
  return i18n.t(`newExperiment.counts.${key}`, { count });
}

export function summarizeCampaignPlan(campaign: CampaignSpec): CampaignPlanSummary {
  const runCount = getCampaignRunCount(campaign);
  const datasetCount = campaign.datasets.length;
  const pipelineCount = campaign.pipelines.length;
  const matrixCapacity = datasetCount * pipelineCount;
  const datasetCountLabel = formatCount("dataset", campaign.datasets.length);
  const pipelineCountLabel = formatCount("pipeline", campaign.pipelines.length);
  const runCountLabel = formatCount("run", runCount);
  const matrixCapacityLabel = formatCount("possiblePair", matrixCapacity);

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
    inputCardinalityLabel: i18n.t("newExperiment.campaign.summary.inputCardinality", {
      datasets: datasetCountLabel,
      pipelines: pipelineCountLabel,
    }),
    matrixCapacityLabel,
    matrixCoverageLabel: i18n.t("newExperiment.campaign.summary.matrixCoverage", {
      runs: runCountLabel,
      pairs: matrixCapacityLabel,
    }),
    launchSummary: i18n.t("newExperiment.campaign.summary.launch", {
      runs: runCountLabel,
      datasets: datasetCountLabel,
      pipelines: pipelineCountLabel,
    }),
  };
}

export function getCampaignPlanModeLabel(mode: CampaignPlanMode): string {
  if (mode === "legacy_cartesian") return i18n.t("newExperiment.campaign.mode.allCombinations");
  if (mode === "paired_by_index") return i18n.t("newExperiment.campaign.mode.selectedCombinations");
  return mode;
}

const campaignPairingModeReadModels: Record<
  CampaignPairingModeKind,
  { labelKey: string; strictLabelKey: string; isStrictPairingReady: boolean }
> = {
  incomplete: {
    labelKey: "incomplete.label",
    strictLabelKey: "incomplete.strict",
    isStrictPairingReady: false,
  },
  single_pair: {
    labelKey: "singlePair.label",
    strictLabelKey: "singlePair.strict",
    isStrictPairingReady: true,
  },
  strict_pairs: {
    labelKey: "strictPairs.label",
    strictLabelKey: "strictPairs.strict",
    isStrictPairingReady: true,
  },
  cartesian_matrix: {
    labelKey: "cartesian.label",
    strictLabelKey: "cartesian.strict",
    isStrictPairingReady: false,
  },
  explicit_matrix: {
    labelKey: "explicit.label",
    strictLabelKey: "explicit.strict",
    isStrictPairingReady: false,
  },
};

const campaignStrictOnePairReadinessReadModels: Record<
  CampaignPairingModeKind,
  { status: CampaignStrictOnePairReadinessStatus; labelKey: string; isReady: boolean }
> = {
  incomplete: { status: "not_ready", labelKey: "incomplete", isReady: false },
  single_pair: { status: "ready", labelKey: "singlePair", isReady: true },
  strict_pairs: { status: "not_ready", labelKey: "strictPairs", isReady: false },
  cartesian_matrix: { status: "not_ready", labelKey: "cartesian", isReady: false },
  explicit_matrix: { status: "not_ready", labelKey: "explicit", isReady: false },
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
  const { labelKey, strictLabelKey, isStrictPairingReady } = campaignPairingModeReadModels[kind];
  return {
    kind,
    label: i18n.t(`newExperiment.campaign.pairing.${labelKey}`),
    strictPairingLabel: i18n.t(`newExperiment.campaign.pairing.${strictLabelKey}`),
    isStrictPairingReady,
  };
}

export function getCampaignStrictOnePairReadinessReadModel(
  pairingMode: CampaignPairingModeReadModel,
): CampaignStrictOnePairReadinessReadModel {
  const { status, labelKey, isReady } = campaignStrictOnePairReadinessReadModels[pairingMode.kind];
  return {
    status,
    label: i18n.t(`newExperiment.campaign.pairing.readiness.${labelKey}`),
    isReady,
  };
}
