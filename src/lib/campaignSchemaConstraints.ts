import i18n from "i18next";

import type {
  CampaignPlanSummary,
  CampaignSpec,
} from "./campaignSpecTypes";
import type { CampaignPreviewNotice } from "./campaignNoticeTypes";

export type CampaignSchemaConstraintKind =
  | "cartesian_matrix"
  | "shared_dataset"
  | "shared_pipeline"
  | "paired_by_index"
  | "single_pair"
  | "incomplete";

export type CampaignStrictPairingStatus =
  | "ready"
  | "needs_explicit_pairs"
  | "not_evaluated";

export interface CampaignSchemaConstraintPreview {
  kind: CampaignSchemaConstraintKind;
  label: string;
  description: string;
  strictPairingStatus: CampaignStrictPairingStatus;
  strictPairingStatusLabel: string;
  strictModeRecommendation: string;
  notice: CampaignPreviewNotice | null;
}

export function buildCampaignSchemaConstraintPreview(
  campaign: CampaignSpec,
  summary: CampaignPlanSummary,
): CampaignSchemaConstraintPreview {
  if (summary.datasetCount === 0 || summary.pipelineCount === 0) {
    return {
      kind: "incomplete",
      label: i18n.t("newExperiment.campaign.constraint.incomplete.label"),
      description: i18n.t("newExperiment.campaign.constraint.incomplete.description"),
      strictPairingStatus: "not_evaluated",
      strictPairingStatusLabel: i18n.t("newExperiment.campaign.constraint.incomplete.status"),
      strictModeRecommendation: i18n.t("newExperiment.campaign.constraint.incomplete.recommendation"),
      notice: null,
    };
  }

  if (campaign.mode === "paired_by_index") {
    return {
      kind: "paired_by_index",
      label: i18n.t("newExperiment.campaign.constraint.paired.label"),
      description: i18n.t("newExperiment.campaign.constraint.paired.description"),
      strictPairingStatus: "ready",
      strictPairingStatusLabel: i18n.t("newExperiment.campaign.constraint.paired.status"),
      strictModeRecommendation: i18n.t("newExperiment.campaign.constraint.paired.recommendation"),
      notice: null,
    };
  }

  if (summary.datasetCount > 1 && summary.pipelineCount > 1) {
    return {
      kind: "cartesian_matrix",
      label: i18n.t("newExperiment.campaign.constraint.cartesian.label"),
      description: i18n.t("newExperiment.campaign.constraint.cartesian.description"),
      strictPairingStatus: "needs_explicit_pairs",
      strictPairingStatusLabel: i18n.t("newExperiment.campaign.constraint.cartesian.status"),
      strictModeRecommendation: i18n.t("newExperiment.campaign.constraint.cartesian.recommendation"),
      notice: {
        id: "legacy-cartesian-matrix",
        severity: "info",
        title: i18n.t("newExperiment.campaign.constraint.cartesian.noticeTitle"),
        message: i18n.t("newExperiment.campaign.constraint.cartesian.noticeMessage"),
      },
    };
  }

  if (summary.datasetCount === 1 && summary.pipelineCount > 1) {
    return {
      kind: "shared_dataset",
      label: i18n.t("newExperiment.campaign.constraint.sharedDataset.label"),
      description: i18n.t("newExperiment.campaign.constraint.sharedDataset.description"),
      strictPairingStatus: "needs_explicit_pairs",
      strictPairingStatusLabel: i18n.t("newExperiment.campaign.constraint.sharedDataset.status"),
      strictModeRecommendation: i18n.t("newExperiment.campaign.constraint.sharedDataset.recommendation"),
      notice: {
        id: "shared-dataset-campaign",
        severity: "info",
        title: i18n.t("newExperiment.campaign.constraint.sharedDataset.noticeTitle"),
        message: i18n.t("newExperiment.campaign.constraint.sharedDataset.noticeMessage"),
      },
    };
  }

  if (summary.datasetCount > 1 && summary.pipelineCount === 1) {
    return {
      kind: "shared_pipeline",
      label: i18n.t("newExperiment.campaign.constraint.sharedPipeline.label"),
      description: i18n.t("newExperiment.campaign.constraint.sharedPipeline.description"),
      strictPairingStatus: "needs_explicit_pairs",
      strictPairingStatusLabel: i18n.t("newExperiment.campaign.constraint.sharedPipeline.status"),
      strictModeRecommendation: i18n.t("newExperiment.campaign.constraint.sharedPipeline.recommendation"),
      notice: {
        id: "shared-pipeline-campaign",
        severity: "info",
        title: i18n.t("newExperiment.campaign.constraint.sharedPipeline.noticeTitle"),
        message: i18n.t("newExperiment.campaign.constraint.sharedPipeline.noticeMessage"),
      },
    };
  }

  return {
    kind: "single_pair",
    label: i18n.t("newExperiment.campaign.constraint.singlePair.label"),
    description: i18n.t("newExperiment.campaign.constraint.singlePair.description"),
    strictPairingStatus: "ready",
    strictPairingStatusLabel: i18n.t("newExperiment.campaign.constraint.singlePair.status"),
    strictModeRecommendation: i18n.t("newExperiment.campaign.constraint.singlePair.recommendation"),
    notice: null,
  };
}
