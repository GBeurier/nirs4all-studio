import { buildCampaignCompatibilityPreviews } from "./campaignCompatibilityPreviews";
import { buildCampaignDatasetPreviews } from "./campaignDatasetPreviews";
import { buildCampaignExecutionAdapterPreview, getCampaignExecutionBackendLabel } from "./campaignExecutionPreview";
import { buildCampaignPreviewNotices } from "./campaignNotices";
import { buildCampaignPipelinePreviews } from "./campaignPipelinePreviews";
import { buildCampaignSchemaConstraintPreview } from "./campaignSchemaConstraints";
import { buildCampaignSinglePairSplitPreview } from "./campaignSinglePairSplitPreview";
import { getCampaignPairingModeReadModel, getCampaignPlanModeLabel, summarizeCampaignPlan } from "./campaignPlanSummary";
import { buildCampaignRunPreviewsFromInputs, getHiddenCampaignRunPreviewCount } from "./campaignRunPreviews";
import { buildCampaignCapabilityChecks } from "./campaignCapabilityChecks";
import type {
  BuildCampaignPlanPreviewOptions,
  CampaignPlanPreview,
} from "./campaignPlanPreviewTypes";
import type { CampaignSpec } from "./campaignSpecTypes";

export function buildCampaignPlanPreview(
  campaign: CampaignSpec,
  options: BuildCampaignPlanPreviewOptions = {},
): CampaignPlanPreview {
  const summary = summarizeCampaignPlan(campaign);
  const schemaConstraint = buildCampaignSchemaConstraintPreview(campaign, summary);
  const datasetPreviewLimit = Math.max(0, options.datasetPreviewLimit ?? 5);
  const pipelinePreviewLimit = Math.max(0, options.pipelinePreviewLimit ?? 5);
  const runPreviewLimit = Math.max(0, options.runPreviewLimit ?? 5);
  const compatibilityPreviewLimit = Math.max(0, options.compatibilityPreviewLimit ?? 5);
  const singlePairSplitPreviewLimit = Math.max(0, options.singlePairSplitPreviewLimit ?? 5);
  const allDatasetPreviews = buildCampaignDatasetPreviews(campaign);
  const datasetPreviews = allDatasetPreviews.slice(0, datasetPreviewLimit);
  const allPipelinePreviews = buildCampaignPipelinePreviews(campaign);
  const pipelinePreviews = allPipelinePreviews.slice(0, pipelinePreviewLimit);
  const allCompatibilityPreviews = buildCampaignCompatibilityPreviews(campaign);
  const compatibilityPreviews = allCompatibilityPreviews.slice(0, compatibilityPreviewLimit);
  const executionAdapter = buildCampaignExecutionAdapterPreview(campaign, {
    availableExecutionAdapters: options.availableExecutionAdapters,
    nativeBackendAvailability: options.nativeBackendAvailability,
  });
  const capabilityChecks = buildCampaignCapabilityChecks(
    campaign,
    summary,
    allCompatibilityPreviews,
    executionAdapter,
    schemaConstraint,
  );
  const runPreviews = buildCampaignRunPreviewsFromInputs({
    campaign,
    limit: runPreviewLimit,
    compatibilityPreviews: allCompatibilityPreviews,
    datasetPreviews: allDatasetPreviews,
    pipelinePreviews: allPipelinePreviews,
  });
  const singlePairSplitPreview = buildCampaignSinglePairSplitPreview(campaign, singlePairSplitPreviewLimit);
  const executionBackendLabel = getCampaignExecutionBackendLabel(campaign.executionBackend);
  const notices = buildCampaignPreviewNotices(campaign, summary, executionBackendLabel, schemaConstraint);

  return {
    summary,
    modeLabel: getCampaignPlanModeLabel(campaign.mode),
    pairingMode: getCampaignPairingModeReadModel(campaign),
    executionBackendLabel,
    executionAdapter,
    schemaConstraint,
    runMatrixLabel: `${summary.runCountLabel} in explicit run matrix`,
    datasetPreviews,
    pipelinePreviews,
    compatibilityPreviews,
    capabilityChecks,
    singlePairSplitPreview,
    runPreviews,
    hiddenDatasetPreviewCount: Math.max(0, allDatasetPreviews.length - datasetPreviews.length),
    hiddenPipelinePreviewCount: Math.max(0, allPipelinePreviews.length - pipelinePreviews.length),
    hiddenRunCount: getHiddenCampaignRunPreviewCount(summary.runCount, runPreviews.length),
    hiddenCompatibilityPreviewCount: Math.max(0, allCompatibilityPreviews.length - compatibilityPreviews.length),
    notices,
    isRunnable:
      notices.every((notice) => notice.severity !== "blocking") &&
      capabilityChecks.every((check) => check.status !== "blocking"),
  };
}
