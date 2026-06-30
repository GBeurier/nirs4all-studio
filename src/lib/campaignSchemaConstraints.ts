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
      label: "Incomplete binding",
      description: "Select dataset and pipeline inputs before schema binding can be evaluated.",
      strictPairingStatus: "not_evaluated",
      strictPairingStatusLabel: "Pending inputs",
      strictModeRecommendation: "Select dataset and pipeline inputs before strict schema-bound readiness can be evaluated.",
      notice: null,
    };
  }

  if (campaign.mode === "paired_by_index") {
    return {
      kind: "paired_by_index",
      label: "Paired bindings",
      description: "Datasets and pipelines are already represented as explicit index pairs.",
      strictPairingStatus: "ready",
      strictPairingStatusLabel: "Explicit pairs",
      strictModeRecommendation: "Ready for strict schema-bound execution because each run is already an explicit dataset/pipeline pair.",
      notice: null,
    };
  }

  if (summary.datasetCount > 1 && summary.pipelineCount > 1) {
    return {
      kind: "cartesian_matrix",
      label: "Cartesian matrix binding",
      description: "Every selected pipeline is paired with every selected dataset.",
      strictPairingStatus: "needs_explicit_pairs",
      strictPairingStatusLabel: "Implicit all-pairs",
      strictModeRecommendation: "Convert the cartesian matrix to explicit dataset/pipeline pair previews before strict schema-bound execution.",
      notice: {
        id: "legacy-cartesian-matrix",
        severity: "info",
        title: "Cartesian campaign",
        message: "Every selected pipeline will run on every selected dataset. Future campaign modes can replace this with previewed pairings.",
      },
    };
  }

  if (summary.datasetCount === 1 && summary.pipelineCount > 1) {
    return {
      kind: "shared_dataset",
      label: "Shared dataset binding",
      description: "One dataset is paired with multiple pipelines.",
      strictPairingStatus: "needs_explicit_pairs",
      strictPairingStatusLabel: "Implicit shared dataset",
      strictModeRecommendation: "Keep the shared dataset shape only if each pipeline pairing has an explicit schema preview before strict schema-bound execution.",
      notice: {
        id: "shared-dataset-campaign",
        severity: "info",
        title: "Shared dataset campaign",
        message: "One dataset will be reused across multiple pipelines. Future schema-bound campaign modes should keep these pair previews explicit.",
      },
    };
  }

  if (summary.datasetCount > 1 && summary.pipelineCount === 1) {
    return {
      kind: "shared_pipeline",
      label: "Shared pipeline binding",
      description: "One pipeline is paired with multiple datasets.",
      strictPairingStatus: "needs_explicit_pairs",
      strictPairingStatusLabel: "Implicit shared pipeline",
      strictModeRecommendation: "Keep the shared pipeline shape only if each dataset pairing has an explicit schema preview before strict schema-bound execution.",
      notice: {
        id: "shared-pipeline-campaign",
        severity: "info",
        title: "Shared pipeline campaign",
        message: "One pipeline will be reused across multiple datasets. Future schema-bound campaign modes should keep these pair previews explicit.",
      },
    };
  }

  return {
    kind: "single_pair",
    label: "Single dataset/pipeline binding",
    description: "One dataset is paired with one pipeline, the simplest schema-bound campaign shape.",
    strictPairingStatus: "ready",
    strictPairingStatusLabel: "Single explicit pair",
    strictModeRecommendation: "Ready for strict schema-bound execution with one dataset and one pipeline.",
    notice: null,
  };
}
