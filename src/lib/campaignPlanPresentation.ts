import type { DatasetPipelineCompatibilityStatus } from "./campaignCompatibilityTypes";
import type {
  CampaignCapabilityCheck,
  CampaignCapabilityCheckStatus,
} from "./campaignCapabilityTypes";
import type { CampaignPreviewNoticeSeverity } from "./campaignNoticeTypes";
import type { CampaignPlanPreview } from "./campaignPlanPreviewTypes";

export type CampaignPreviewBadgeVariant = "secondary" | "outline" | "destructive";

export const campaignPlanPreviewTitle = "Campaign Plan Preview";

export const campaignPlanSectionTitles = {
  capabilities: "Readiness Checks",
  datasets: "Dataset Inputs",
  pipelines: "Pipeline Inputs",
  compatibility: "Compatibility Preview",
  executionEnvironment: "Execution Environment",
  singlePairSplits: "Single-Pair Split Preview",
  plannedRuns: "Planned Runs",
} as const;

export const campaignPlanHiddenLabels = {
  datasets: "more dataset inputs",
  pipelines: "more pipeline inputs",
  compatibility: "more compatibility previews",
  singlePairSplits: "more split candidates",
  plannedRuns: "more planned runs",
} as const;

export const campaignSinglePairSplitTagLabel = "strict one-pair";

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
    { id: "mode", label: "Mode", value: campaignPreview.modeLabel },
    {
      id: "pairing",
      label: "Pairing",
      value: formatCampaignPairingModeLine(campaignPreview.pairingMode),
    },
    { id: "backend", label: "Backend", value: campaignPreview.executionBackendLabel },
    { id: "adapter", label: "Adapter", value: campaignPreview.executionAdapter.statusLabel },
    { id: "inputs", label: "Inputs", value: campaignPreview.summary.inputCardinalityLabel },
    { id: "runs", label: "Runs", value: campaignPreview.summary.runCountLabel },
    { id: "matrix", label: "Matrix", value: campaignPreview.summary.matrixCoverageLabel },
  ];
}

export function formatCampaignPairingModeLine(
  pairingMode: PairingModePreview,
): string {
  return `${pairingMode.label} (${pairingMode.strictPairingLabel})`;
}

export function formatCampaignExecutionAdapterLine(
  campaignPreview: CampaignPlanPreview,
): string {
  return `${campaignPreview.executionAdapter.label}: ${campaignPreview.executionAdapter.message}`;
}

export function formatCampaignSchemaConstraintLine(
  campaignPreview: CampaignPlanPreview,
): string {
  return `${campaignPreview.schemaConstraint.label} (${campaignPreview.schemaConstraint.strictPairingStatusLabel}): ${campaignPreview.schemaConstraint.description} ${campaignPreview.schemaConstraint.strictModeRecommendation}`;
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
  return `+ ${hiddenCount} ${hiddenLabel}`;
}

export function formatCampaignGroupByTag(splitGroupBy: string | null): string | null {
  if (!splitGroupBy) return null;
  return `group_by: ${splitGroupBy}`;
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
    `view: ${datasetPreview.dataViewLabel}`,
    `task: ${datasetPreview.dataViewTaskLabel}`,
    datasetPreview.targetCountLabel,
    `target: ${datasetPreview.targetLabel}`,
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
    `source run: ${candidatePreview.runId}`,
  ];
}

export function formatCampaignPairLabel(datasetLabel: string, pipelineLabel: string): string {
  return `${datasetLabel} -> ${pipelineLabel}`;
}

export function formatCampaignCompatibilityDetailLabels(
  compatibilityPreview: CompatibilityPreview,
): string[] {
  return presentLabels([
    `view: ${compatibilityPreview.dataViewLabel}`,
    `task: ${compatibilityPreview.dataViewTaskLabel}`,
    compatibilityPreview.targetCountLabel,
    `target: ${compatibilityPreview.targetLabel}`,
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
