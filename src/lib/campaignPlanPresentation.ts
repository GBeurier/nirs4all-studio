import i18n from "i18next";

import type { DatasetPipelineCompatibilityStatus } from "./campaignCompatibilityTypes";
import type {
  CampaignCapabilityCheck,
  CampaignCapabilityCheckStatus,
} from "./campaignCapabilityTypes";
import type { CampaignPreviewNoticeSeverity } from "./campaignNoticeTypes";
import type { CampaignPlanPreview } from "./campaignPlanPreviewTypes";

export type CampaignPreviewBadgeVariant = "secondary" | "outline" | "destructive";

export function getCampaignPlanPreviewTitle(): string {
  return i18n.t("newExperiment.campaign.preview.title");
}

/** Section titles of the campaign preview; getters resolve the active language at read time. */
export const campaignPlanSectionTitles = {
  get capabilities() { return i18n.t("newExperiment.campaign.sections.capabilities"); },
  get datasets() { return i18n.t("newExperiment.campaign.sections.datasets"); },
  get pipelines() { return i18n.t("newExperiment.campaign.sections.pipelines"); },
  get compatibility() { return i18n.t("newExperiment.campaign.sections.compatibility"); },
  get executionEnvironment() { return i18n.t("newExperiment.campaign.sections.executionEnvironment"); },
  get singlePairSplits() { return i18n.t("newExperiment.campaign.sections.singlePairSplits"); },
  get plannedRuns() { return i18n.t("newExperiment.campaign.sections.plannedRuns"); },
};

export const campaignPlanHiddenLabels = {
  get datasets() { return i18n.t("newExperiment.campaign.hidden.datasets"); },
  get pipelines() { return i18n.t("newExperiment.campaign.hidden.pipelines"); },
  get compatibility() { return i18n.t("newExperiment.campaign.hidden.compatibility"); },
  get singlePairSplits() { return i18n.t("newExperiment.campaign.hidden.singlePairSplits"); },
  get plannedRuns() { return i18n.t("newExperiment.campaign.hidden.plannedRuns"); },
};

export function getCampaignSinglePairSplitTagLabel(): string {
  return i18n.t("newExperiment.campaign.singlePairTag");
}

export interface CampaignSummaryField {
  id: string;
  label: string;
  value: string;
}

export interface CampaignCapabilityCardData {
  id: string;
  message: string;
  status: CampaignCapabilityCheckStatus;
  statusLabel: string;
  title: string;
}

type DatasetPreview = CampaignPlanPreview["datasetPreviews"][number];
type PipelinePreview = CampaignPlanPreview["pipelinePreviews"][number];
type CompatibilityPreview = CampaignPlanPreview["compatibilityPreviews"][number];
type RunPreview = CampaignPlanPreview["runPreviews"][number];
type SinglePairSplitCandidatePreview =
  CampaignPlanPreview["singlePairSplitPreview"]["candidatePreviews"][number];
type PairingModePreview = CampaignPlanPreview["pairingMode"];

function presentLabels(labels: Array<string | null>): string[] {
  return labels.filter((label): label is string => label != null);
}

export function buildCampaignSummaryFields(
  campaignPreview: CampaignPlanPreview,
): CampaignSummaryField[] {
  return [
    { id: "mode", label: i18n.t("newExperiment.campaign.summaryFields.mode"), value: campaignPreview.modeLabel },
    {
      id: "pairing",
      label: i18n.t("newExperiment.campaign.summaryFields.pairing"),
      value: formatCampaignPairingModeLine(campaignPreview.pairingMode),
    },
    { id: "backend", label: i18n.t("newExperiment.campaign.summaryFields.backend"), value: campaignPreview.executionBackendLabel },
    { id: "adapter", label: i18n.t("newExperiment.campaign.summaryFields.adapter"), value: campaignPreview.executionAdapter.statusLabel },
    { id: "inputs", label: i18n.t("newExperiment.campaign.summaryFields.inputs"), value: campaignPreview.summary.inputCardinalityLabel },
    { id: "runs", label: i18n.t("newExperiment.campaign.summaryFields.runs"), value: campaignPreview.summary.runCountLabel },
    { id: "matrix", label: i18n.t("newExperiment.campaign.summaryFields.matrix"), value: campaignPreview.summary.matrixCoverageLabel },
  ];
}

export function formatCampaignPairingModeLine(
  pairingMode: PairingModePreview,
): string {
  return i18n.t("newExperiment.campaign.detail.pairingLine", {
    label: pairingMode.label,
    strict: pairingMode.strictPairingLabel,
  });
}

export function formatCampaignExecutionAdapterLine(
  campaignPreview: CampaignPlanPreview,
): string {
  return `${campaignPreview.executionAdapter.label}: ${campaignPreview.executionAdapter.message}`;
}

export function formatCampaignSchemaConstraintLine(
  campaignPreview: CampaignPlanPreview,
): string {
  return campaignPreview.schemaConstraint.description;
}

export function buildCampaignCapabilityCardData(
  check: CampaignCapabilityCheck,
): CampaignCapabilityCardData {
  return {
    id: check.id,
    message: check.message,
    status: check.status,
    statusLabel: check.statusLabel,
    title: check.title,
  };
}

export function formatHiddenCampaignPreviewCount(
  hiddenCount: number,
  hiddenLabel: string,
): string | null {
  if (hiddenCount <= 0) return null;
  return i18n.t("newExperiment.campaign.hidden.format", { count: hiddenCount, label: hiddenLabel });
}

export function formatCampaignGroupByTag(splitGroupBy: string | null): string | null {
  if (!splitGroupBy) return null;
  return i18n.t("newExperiment.campaign.detail.groupBy", { value: splitGroupBy });
}

export function formatCampaignDatasetDetailLabels(
  datasetPreview: DatasetPreview,
): string[] {
  return presentLabels([
    datasetPreview.sampleCountLabel,
    datasetPreview.featureCountLabel,
    datasetPreview.sourceCountLabel,
    datasetPreview.sourceModeLabel,
    datasetPreview.representationCountLabel,
    i18n.t("newExperiment.campaign.detail.view", { value: datasetPreview.dataViewLabel }),
    i18n.t("newExperiment.campaign.detail.task", { value: datasetPreview.dataViewTaskLabel }),
    datasetPreview.targetCountLabel,
    i18n.t("newExperiment.campaign.detail.target", { value: datasetPreview.targetLabel }),
    datasetPreview.metadataColumnCountLabel,
    datasetPreview.repetitionLabel,
    datasetPreview.aggregationLabel,
    datasetPreview.aggregationSourceLabel,
  ]);
}

export function formatCampaignPipelineDetailLabels(
  pipelinePreview: PipelinePreview,
): string[] {
  return [
    pipelinePreview.stepCountLabel,
    pipelinePreview.stepSummaryLabel,
    ...pipelinePreview.complexityLabels,
  ];
}

export function formatCampaignRunDetailLabels(
  runPreview: RunPreview,
): string[] {
  return [
    ...runPreview.datasetDetailLabels,
    ...runPreview.pipelineDetailLabels,
  ];
}

export function formatCampaignSinglePairSplitCandidateDetailLabels(
  candidatePreview: SinglePairSplitCandidatePreview,
): string[] {
  return [
    candidatePreview.summaryLabel,
    i18n.t("newExperiment.campaign.detail.sourceRun", { value: candidatePreview.runId }),
  ];
}

export function formatCampaignPairLabel(datasetLabel: string, pipelineLabel: string): string {
  return `${datasetLabel} -> ${pipelineLabel}`;
}

export function formatCampaignCompatibilityDetailLabels(
  compatibilityPreview: CompatibilityPreview,
): string[] {
  return presentLabels([
    i18n.t("newExperiment.campaign.detail.view", { value: compatibilityPreview.dataViewLabel }),
    i18n.t("newExperiment.campaign.detail.task", { value: compatibilityPreview.dataViewTaskLabel }),
    compatibilityPreview.targetCountLabel,
    i18n.t("newExperiment.campaign.detail.target", { value: compatibilityPreview.targetLabel }),
    compatibilityPreview.sourceCountLabel,
    compatibilityPreview.sourceModeLabel,
    compatibilityPreview.datasetAggregationLabel,
    compatibilityPreview.datasetAggregationSourceLabel,
    compatibilityPreview.pipelineNodeCountLabel,
    compatibilityPreview.transformationSizeLabel,
    ...compatibilityPreview.pipelineComplexityLabels,
  ]);
}

export function getCampaignCompatibilityBadgeVariant(
  status: DatasetPipelineCompatibilityStatus,
): CampaignPreviewBadgeVariant {
  if (status === "blocking") return "destructive";
  if (status === "warning" || status === "not_evaluated") return "outline";
  return "secondary";
}

export function getCampaignCapabilityBadgeVariant(
  status: CampaignCapabilityCheckStatus,
): CampaignPreviewBadgeVariant {
  if (status === "blocking") return "destructive";
  if (status === "warning" || status === "not_evaluated") return "outline";
  return "secondary";
}

export function getCampaignNoticeBadgeVariant(
  severity: CampaignPreviewNoticeSeverity,
): CampaignPreviewBadgeVariant {
  return severity === "blocking" ? "destructive" : "outline";
}
