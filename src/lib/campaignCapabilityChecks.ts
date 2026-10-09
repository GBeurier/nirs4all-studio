import i18n from "i18next";

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
  if (status === "passed") return i18n.t("newExperiment.campaign.status.passed");
  if (status === "warning") return i18n.t("newExperiment.campaign.status.warning");
  if (status === "blocking") return i18n.t("newExperiment.campaign.status.blocking");
  return i18n.t("newExperiment.campaign.status.notEvaluated");
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

function formatIssueCounts(summary: CampaignCompatibilityStatusSummary): string {
  return [
    summary.blockingCount > 0
      ? i18n.t("newExperiment.campaign.capability.issues.blocking", { count: summary.blockingCount })
      : null,
    summary.warningCount > 0
      ? i18n.t("newExperiment.campaign.capability.issues.warning", { count: summary.warningCount })
      : null,
    summary.notEvaluatedCount > 0
      ? i18n.t("newExperiment.campaign.capability.issues.notEvaluated", { count: summary.notEvaluatedCount })
      : null,
    summary.missingPreviewCount > 0
      ? i18n.t("newExperiment.campaign.capability.issues.missing", { count: summary.missingPreviewCount })
      : null,
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
      message: i18n.t("newExperiment.campaign.capability.reserved"),
    };
  }

  if (summary.evaluatedCount === 0) {
    return {
      status: "not_evaluated",
      message: i18n.t("newExperiment.campaign.capability.reserved"),
    };
  }

  if (summary.blockingCount > 0) {
    return {
      status: "blocking",
      message: i18n.t("newExperiment.campaign.capability.blocking", { count: summary.blockingCount }),
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
      message: i18n.t("newExperiment.campaign.capability.warning", {
        evaluated: summary.evaluatedCount,
        total: summary.runCount,
        issues: issueCounts,
      }),
    };
  }

  return {
    status: "passed",
    message: i18n.t("newExperiment.campaign.capability.passed", { total: summary.runCount }),
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
      message: i18n.t("newExperiment.campaign.capability.singlePair.select"),
    };
  }

  if (summary.datasetCount === 1 && summary.pipelineCount === 1 && summary.runCount === 1) {
    return {
      status: "passed",
      message: i18n.t("newExperiment.campaign.capability.singlePair.ok"),
    };
  }

  if (summary.runCount === 1) {
    return {
      status: "warning",
      message: i18n.t("newExperiment.campaign.capability.singlePair.oneRun", { cardinality: summary.inputCardinalityLabel }),
    };
  }

  return {
    status: "warning",
    message: i18n.t("newExperiment.campaign.capability.singlePair.manyRuns", {
      runs: summary.runCountLabel,
      cardinality: summary.inputCardinalityLabel,
    }),
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
      title: i18n.t("newExperiment.campaign.capability.titles.schemaBinding"),
      message: schemaBindingStatus.message,
    });
    const singlePairStatus = getCampaignSinglePairCapabilityStatus(summary);
    checks.push({
      id: "single-pair-campaign-shape",
      status: singlePairStatus.status,
      statusLabel: getCampaignCapabilityCheckStatusLabel(singlePairStatus.status),
      title: i18n.t("newExperiment.campaign.capability.titles.singlePair"),
      message: singlePairStatus.message,
    });
  }

  checks.push({
    id: "dataset-pipeline-schema",
    status: compatibilityStatus.status,
    statusLabel: getCampaignCapabilityCheckStatusLabel(compatibilityStatus.status),
    title: i18n.t("newExperiment.campaign.capability.titles.compatibility"),
    message: compatibilityStatus.message,
  });

  const backendCapability = getCampaignExecutionBackendCapabilityStatus(campaign, executionAdapter);

  checks.push({
    id: "execution-backend-capabilities",
    status: backendCapability.status,
    statusLabel: getCampaignCapabilityCheckStatusLabel(backendCapability.status),
    title: i18n.t("newExperiment.campaign.capability.titles.backend"),
    message: backendCapability.message,
  });

  return checks;
}
