import type {
  CampaignExecutionAdapterPreview,
} from "./campaignPlanPreviewTypes";
import type {
  CampaignPlanSummary,
  CampaignSpec,
} from "./campaignSpecTypes";
import type {
  CampaignCapabilityCheck,
  CampaignCapabilityCheckStatus,
} from "./campaignCapabilityTypes";
import type { DatasetPipelineCompatibilityPreview } from "./campaignCompatibilityTypes";
import type { CampaignSchemaConstraintPreview } from "./campaignSchemaConstraints";
import { getCampaignExecutionBackendCapabilityStatus } from "./campaignExecutionCapabilities";

export function getCampaignCapabilityCheckStatusLabel(status: CampaignCapabilityCheckStatus): string {
  if (status === "passed") return "Passed";
  if (status === "warning") return "Warning";
  if (status === "blocking") return "Blocking";
  return "Not evaluated";
}

export interface CampaignCompatibilityStatusSummary {
  runCount: number;
  previewCount: number;
  evaluatedCount: number;
  passedCount: number;
  warningCount: number;
  blockingCount: number;
  notEvaluatedCount: number;
  missingPreviewCount: number;
}

function formatPairPreviewCount(count: number): string {
  return `${count} dataset/pipeline pair preview${count === 1 ? "" : "s"}`;
}

function formatIssueCounts(summary: CampaignCompatibilityStatusSummary): string {
  return [
    summary.blockingCount > 0 ? `${summary.blockingCount} blocking` : null,
    summary.warningCount > 0 ? `${summary.warningCount} warning` : null,
    summary.notEvaluatedCount > 0 ? `${summary.notEvaluatedCount} not evaluated` : null,
    summary.missingPreviewCount > 0 ? `${summary.missingPreviewCount} missing` : null,
  ].filter((label): label is string => label != null).join(", ");
}

export function summarizeCampaignCompatibilityPreviewStatuses(
  compatibilityPreviews: DatasetPipelineCompatibilityPreview[],
  runCount: number,
): CampaignCompatibilityStatusSummary {
  const passedCount = compatibilityPreviews.filter((preview) => preview.status === "passed").length;
  const warningCount = compatibilityPreviews.filter((preview) => preview.status === "warning").length;
  const blockingCount = compatibilityPreviews.filter((preview) => preview.status === "blocking").length;
  const notEvaluatedCount = compatibilityPreviews.filter((preview) => preview.status === "not_evaluated").length;

  return {
    runCount,
    previewCount: compatibilityPreviews.length,
    evaluatedCount: passedCount + warningCount + blockingCount,
    passedCount,
    warningCount,
    blockingCount,
    notEvaluatedCount,
    missingPreviewCount: Math.max(0, runCount - compatibilityPreviews.length),
  };
}

export function getCampaignCompatibilityCapabilityStatus(
  compatibilityPreviews: DatasetPipelineCompatibilityPreview[],
  runCount: number,
): { status: CampaignCapabilityCheckStatus; message: string } {
  const summary = summarizeCampaignCompatibilityPreviewStatuses(compatibilityPreviews, runCount);

  if (summary.runCount === 0 || summary.previewCount === 0) {
    return {
      status: "not_evaluated",
      message: "Reserved for dataset-specific pipeline schema previews before launch.",
    };
  }

  if (summary.evaluatedCount === 0) {
    return {
      status: "not_evaluated",
      message: "Reserved for dataset-specific pipeline schema previews before launch.",
    };
  }

  if (summary.blockingCount > 0) {
    return {
      status: "blocking",
      message: `${formatPairPreviewCount(summary.blockingCount)} ${summary.blockingCount === 1 ? "needs" : "need"} campaign reference fixes before launch.`,
    };
  }

  if (
    summary.evaluatedCount < summary.runCount ||
    summary.warningCount > 0 ||
    summary.notEvaluatedCount > 0
  ) {
    const issueCounts = formatIssueCounts(summary);
    return {
      status: "warning",
      message: `${summary.evaluatedCount} of ${summary.runCount} dataset/pipeline pair previews are schema-evaluated (${issueCounts}); resolve these before stricter execution modes.`,
    };
  }

  return {
    status: "passed",
    message: `${summary.runCount} of ${summary.runCount} dataset/pipeline pair previews are schema-ready.`,
  };
}

export function getCampaignSchemaBindingCapabilityStatus(
  schemaConstraint: CampaignSchemaConstraintPreview,
): { status: CampaignCapabilityCheckStatus; message: string } {
  if (schemaConstraint.strictPairingStatus === "ready") {
    return {
      status: "passed",
      message: schemaConstraint.strictModeRecommendation,
    };
  }

  if (schemaConstraint.strictPairingStatus === "not_evaluated") {
    return {
      status: "not_evaluated",
      message: schemaConstraint.strictModeRecommendation,
    };
  }

  return {
    status: "warning",
    message: schemaConstraint.strictModeRecommendation,
  };
}

export function getCampaignSinglePairCapabilityStatus(
  summary: CampaignPlanSummary,
): { status: CampaignCapabilityCheckStatus; message: string } {
  if (summary.datasetCount === 0 || summary.pipelineCount === 0 || summary.runCount === 0) {
    return {
      status: "not_evaluated",
      message: "Select one dataset and one pipeline before single-pair campaign readiness can be evaluated.",
    };
  }

  if (summary.datasetCount === 1 && summary.pipelineCount === 1 && summary.runCount === 1) {
    return {
      status: "passed",
      message: "Campaign already targets one dataset, one pipeline, and one planned run.",
    };
  }

  if (summary.runCount === 1) {
    return {
      status: "warning",
      message: `1 run is planned, but selected inputs still span ${summary.inputCardinalityLabel}; strict one-pair modes should keep one dataset and one pipeline per campaign.`,
    };
  }

  return {
    status: "warning",
    message: `${summary.runCountLabel} are planned across ${summary.inputCardinalityLabel}; split campaign work into one dataset/pipeline pair per campaign for strict one-pair execution.`,
  };
}

export function buildCampaignCapabilityChecks(
  campaign: CampaignSpec,
  summary: CampaignPlanSummary,
  compatibilityPreviews: DatasetPipelineCompatibilityPreview[],
  executionAdapter?: CampaignExecutionAdapterPreview,
  schemaConstraint?: CampaignSchemaConstraintPreview,
): CampaignCapabilityCheck[] {
  if (summary.datasetCount === 0 || summary.pipelineCount === 0) return [];

  const compatibilityStatus = getCampaignCompatibilityCapabilityStatus(
    compatibilityPreviews,
    summary.runCount,
  );
  const checks: CampaignCapabilityCheck[] = [];

  if (schemaConstraint) {
    const schemaBindingStatus = getCampaignSchemaBindingCapabilityStatus(schemaConstraint);
    checks.push({
      id: "campaign-schema-binding",
      status: schemaBindingStatus.status,
      statusLabel: getCampaignCapabilityCheckStatusLabel(schemaBindingStatus.status),
      title: "Campaign schema binding",
      message: schemaBindingStatus.message,
    });
    const singlePairStatus = getCampaignSinglePairCapabilityStatus(summary);
    checks.push({
      id: "single-pair-campaign-shape",
      status: singlePairStatus.status,
      statusLabel: getCampaignCapabilityCheckStatusLabel(singlePairStatus.status),
      title: "Single-pair campaign shape",
      message: singlePairStatus.message,
    });
  }

  checks.push({
    id: "dataset-pipeline-schema",
    status: compatibilityStatus.status,
    statusLabel: getCampaignCapabilityCheckStatusLabel(compatibilityStatus.status),
    title: "Dataset/pipeline schema compatibility",
    message: compatibilityStatus.message,
  });

  const backendCapability = getCampaignExecutionBackendCapabilityStatus(campaign, executionAdapter);

  checks.push({
    id: "execution-backend-capabilities",
    status: backendCapability.status,
    statusLabel: getCampaignCapabilityCheckStatusLabel(backendCapability.status),
    title: "Execution backend capabilities",
    message: backendCapability.message,
  });

  return checks;
}
