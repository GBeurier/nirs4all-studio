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
      label: "Selection incomplete",
      description: "Select the data and pipelines to analyse.",
      strictPairingStatus: "not_evaluated",
      strictPairingStatusLabel: "Pending inputs",
      strictModeRecommendation: "Select dataset and pipeline inputs before strict schema-bound readiness can be evaluated.",
      notice: null,
    };
  }

  if (campaign.mode === "paired_by_index") {
    return {
      kind: "paired_by_index",
      label: "Selected combinations",
      description: "Each dataset is matched with its selected pipeline.",
      strictPairingStatus: "ready",
      strictPairingStatusLabel: "Selected combinations",
      strictModeRecommendation: "Ready for strict schema-bound execution because each run is already an explicit dataset/pipeline pair.",
      notice: null,
    };
  }

  if (summary.datasetCount > 1 && summary.pipelineCount > 1) {
    return {
      kind: "cartesian_matrix",
      label: "All combinations",
      description: "Every selected pipeline is paired with every selected dataset.",
      strictPairingStatus: "needs_explicit_pairs",
      strictPairingStatusLabel: "All combinations",
      strictModeRecommendation: "Convert the cartesian matrix to explicit dataset/pipeline pair previews before strict schema-bound execution.",
      notice: {
        id: "legacy-cartesian-matrix",
        severity: "info",
        title: "All combinations",
        message: "Every selected pipeline will run on every selected dataset.",
      },
    };
  }

  if (summary.datasetCount === 1 && summary.pipelineCount > 1) {
    return {
      kind: "shared_dataset",
      label: "One dataset, several pipelines",
      description: "One dataset is paired with multiple pipelines.",
      strictPairingStatus: "needs_explicit_pairs",
      strictPairingStatusLabel: "Same dataset for each pipeline",
      strictModeRecommendation: "Keep the shared dataset shape only if each pipeline pairing has an explicit schema preview before strict schema-bound execution.",
      notice: {
        id: "shared-dataset-campaign",
        severity: "info",
        title: "Shared dataset campaign",
        message: "Each selected pipeline will analyse the same dataset.",
      },
    };
  }

  if (summary.datasetCount > 1 && summary.pipelineCount === 1) {
    return {
      kind: "shared_pipeline",
      label: "One pipeline, several datasets",
      description: "One pipeline is paired with multiple datasets.",
      strictPairingStatus: "needs_explicit_pairs",
      strictPairingStatusLabel: "Same pipeline for each dataset",
      strictModeRecommendation: "Keep the shared pipeline shape only if each dataset pairing has an explicit schema preview before strict schema-bound execution.",
      notice: {
        id: "shared-pipeline-campaign",
        severity: "info",
        title: "Shared pipeline campaign",
        message: "The selected pipeline will analyse each dataset.",
      },
    };
  }

  return {
    kind: "single_pair",
    label: "One dataset, one pipeline",
    description: "One pipeline will analyse one dataset.",
    strictPairingStatus: "ready",
    strictPairingStatusLabel: "One analysis",
    strictModeRecommendation: "Ready for strict schema-bound execution with one dataset and one pipeline.",
    notice: null,
  };
}
