import type { CampaignCapabilityCheck } from "./campaignCapabilityTypes";
import type { DatasetPipelineCompatibilityPreview } from "./campaignCompatibilityTypes";
import type { CampaignPreviewNotice } from "./campaignNoticeTypes";
import type { CampaignSchemaConstraintPreview } from "./campaignSchemaConstraints";
import type { CampaignPairingModeReadModel } from "./campaignPlanSummary";
import type { CampaignPlanSummary, CampaignSpec } from "./campaignSpecTypes";
import type { ExperimentExecutionAdapter } from "./experimentExecutionAdapter";
import type { NewExperimentNativeBackendAvailability } from "./experimentExecutionEnvironment";

export type CampaignSinglePairSplitStatus =
  | "not_evaluated"
  | "already_single_pair"
  | "split_recommended";

export interface CampaignSinglePairSplitCandidatePreview {
  id: string;
  runId: string;
  datasetId: string;
  pipelineId: string;
  datasetLabel: string;
  pipelineLabel: string;
  suggestedCampaignName: string;
  summaryLabel: string;
  splitGroupBy: string | null;
  positionLabel: string;
}

export interface CampaignSinglePairSplitPreview {
  status: CampaignSinglePairSplitStatus;
  statusLabel: string;
  summary: string;
  candidatePreviews: CampaignSinglePairSplitCandidatePreview[];
  hiddenCandidateCount: number;
}

export interface CampaignSinglePairSplitSpec {
  id: string;
  sourceRunId: string;
  sourceDatasetId: string;
  sourcePipelineId: string;
  campaign: CampaignSpec;
}

export interface CampaignSinglePairSplitSpecResult {
  splitSpecs: CampaignSinglePairSplitSpec[];
  skippedRunIds: string[];
}

export interface CampaignRunPreviewEntry {
  id: string;
  datasetId: string;
  pipelineId: string;
  datasetLabel: string;
  pipelineLabel: string;
  datasetDetailLabels: string[];
  pipelineDetailLabels: string[];
  compatibilityStatus: DatasetPipelineCompatibilityPreview["status"] | null;
  compatibilityStatusLabel: string | null;
  compatibilitySummary: string | null;
  splitGroupBy: string | null;
  positionLabel: string;
}

export interface CampaignDatasetPreviewEntry {
  id: string;
  label: string;
  sampleCountLabel: string;
  featureCountLabel: string;
  sourceCountLabel: string;
  sourceModeLabel: string;
  representationCountLabel: string;
  dataViewLabel: string;
  dataViewTaskLabel: string;
  targetCountLabel: string;
  targetLabel: string;
  metadataColumnCountLabel: string;
  repetitionLabel: string;
  aggregationLabel: string;
  aggregationSourceLabel: string | null;
  splitGroupBy: string | null;
}

export interface CampaignPipelinePreviewEntry {
  id: string;
  label: string;
  sourceLabel: string;
  stepCountLabel: string;
  stepSummaryLabel: string;
  complexityLabels: string[];
}

export interface CampaignExecutionAdapterPreview {
  id: string;
  label: string;
  statusLabel: string;
  message: string;
}

export interface CampaignPlanPreview {
  summary: CampaignPlanSummary;
  modeLabel: string;
  pairingMode: CampaignPairingModeReadModel;
  executionBackendLabel: string;
  executionAdapter: CampaignExecutionAdapterPreview;
  schemaConstraint: CampaignSchemaConstraintPreview;
  runMatrixLabel: string;
  datasetPreviews: CampaignDatasetPreviewEntry[];
  pipelinePreviews: CampaignPipelinePreviewEntry[];
  compatibilityPreviews: DatasetPipelineCompatibilityPreview[];
  capabilityChecks: CampaignCapabilityCheck[];
  singlePairSplitPreview: CampaignSinglePairSplitPreview;
  runPreviews: CampaignRunPreviewEntry[];
  hiddenDatasetPreviewCount: number;
  hiddenPipelinePreviewCount: number;
  hiddenRunCount: number;
  hiddenCompatibilityPreviewCount: number;
  notices: CampaignPreviewNotice[];
  isRunnable: boolean;
}

export interface BuildCampaignPlanPreviewOptions {
  datasetPreviewLimit?: number;
  pipelinePreviewLimit?: number;
  runPreviewLimit?: number;
  compatibilityPreviewLimit?: number;
  singlePairSplitPreviewLimit?: number;
  availableExecutionAdapters?: readonly ExperimentExecutionAdapter[];
  nativeBackendAvailability?: readonly NewExperimentNativeBackendAvailability[];
}
