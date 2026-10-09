import i18n from "i18next";

import type { CampaignPlanPreview } from "./campaignPlanPreviewTypes";
import { formatCampaignSchemaConstraintLine } from "./campaignPlanPresentation";
import type {
  ExperimentLaunchCurrentSubmissionKind,
  ExperimentLaunchPayloadPlan,
  ExperimentLaunchStrictCampaignPayloadStatus,
} from "./experimentLaunchPayload";

export interface ExperimentLaunchBadgeLabel {
  id: string;
  label: string;
}

export type ExperimentLaunchPayloadBadgeVariant =
  | "secondary"
  | "outline"
  | "destructive"
  | "warning";

export interface ExperimentLaunchPayloadBadgeLabel extends ExperimentLaunchBadgeLabel {
  variant: ExperimentLaunchPayloadBadgeVariant;
}

export interface ExperimentLaunchPayloadManifestDetail {
  id: string;
  label: string;
  value: string;
  title?: string;
}

export interface ExperimentLaunchDatasetLabelSource {
  name?: string | null;
}

/** `countKey` is a pluralised key relative to `newExperiment` (e.g. `counts.dataset`). */
function formatExperimentLaunchCount(count: number, countKey: string): string {
  return i18n.t(`newExperiment.${countKey}`, { count });
}

function formatExperimentLaunchRunIdPreview(runIds: readonly string[]): Pick<
  ExperimentLaunchPayloadManifestDetail,
  "value" | "title"
> {
  if (runIds.length === 0) {
    return { value: i18n.t("common.none") };
  }

  const visibleRunIds = runIds.slice(0, 2);
  const hiddenCount = runIds.length - visibleRunIds.length;
  const value = hiddenCount > 0
    ? i18n.t("newExperiment.launch.runIds.more", { ids: visibleRunIds.join(", "), count: hiddenCount })
    : visibleRunIds.join(", ");

  return {
    value,
    title: runIds.join(", "),
  };
}

function formatExperimentLaunchPayloadReadinessDetail(
  launchPayloadPlan: ExperimentLaunchPayloadPlan,
): Pick<ExperimentLaunchPayloadManifestDetail, "value" | "title"> {
  const { payloadDiagnostics } = launchPayloadPlan;
  if (!payloadDiagnostics.nativePayloadRequired) {
    return { value: i18n.t("newExperiment.launch.readiness.local") };
  }

  if (payloadDiagnostics.canSubmitNativePayload) {
    return { value: i18n.t("newExperiment.launch.readiness.ready") };
  }

  return {
    value: i18n.t("newExperiment.launch.readiness.needsReview"),
    title: payloadDiagnostics.blockedReason ?? undefined,
  };
}

function formatExperimentLaunchSubmissionTargetDetail(
  launchPayloadPlan: ExperimentLaunchPayloadPlan,
  campaignPreview: CampaignPlanPreview,
): Pick<ExperimentLaunchPayloadManifestDetail, "value" | "title"> {
  const adapterStatus = formatExperimentLaunchAdapterStatusLine(campaignPreview);
  if (launchPayloadPlan.payloadDiagnostics.nativePayloadRequired) {
    return {
      value: `${campaignPreview.executionAdapter.label}`,
      title: adapterStatus,
    };
  }

  return {
    value: campaignPreview.executionAdapter.label,
    title: adapterStatus,
  };
}

function formatExperimentLaunchSchemaBindingDetail(
  campaignPreview: CampaignPlanPreview,
): ExperimentLaunchPayloadManifestDetail {
  return {
    id: "schema-binding",
    label: i18n.t("newExperiment.launch.details.schemaBinding"),
    value: [
      campaignPreview.schemaConstraint.label,
      campaignPreview.schemaConstraint.strictPairingStatusLabel,
    ].join(" · "),
    title: formatCampaignSchemaConstraintLine(campaignPreview),
  };
}

function formatExperimentLaunchRobustnessEvidencePublicationDetail(
  payloadDiagnostics: ExperimentLaunchPayloadPlan["payloadDiagnostics"],
): ExperimentLaunchPayloadManifestDetail | null {
  if (!payloadDiagnostics.robustnessEvidencePublicationRequested) return null;

  const keywordCount = payloadDiagnostics.robustnessEvidencePublicationKeywordIds?.length ?? 0;
  const effectCount = payloadDiagnostics.robustnessEvidencePublicationRequiredEffects?.length ?? 0;
  return {
    id: "robustness-evidence-publication",
    label: i18n.t("newExperiment.launch.details.robustness"),
    value: [
      i18n.t("newExperiment.launch.details.requested"),
      formatExperimentLaunchCount(keywordCount, "launch.counts.keyword"),
      formatExperimentLaunchCount(effectCount, "launch.counts.effect"),
    ].join(" · "),
    title: [
      i18n.t("newExperiment.launch.details.destination", {
        value: payloadDiagnostics.robustnessEvidencePublicationDestination
          ?? i18n.t("newExperiment.launch.details.destinationUnknown"),
      }),
      i18n.t("newExperiment.launch.details.conformal", {
        value: payloadDiagnostics.robustnessEvidencePublicationConformalArtifactPolicy
          ?? i18n.t("newExperiment.launch.details.conformalNotDeclared"),
      }),
    ].join(" · "),
  };
}

function formatExperimentLaunchCampaignCardinalityDetail(
  campaignPreview: CampaignPlanPreview,
): ExperimentLaunchPayloadManifestDetail {
  return {
    id: "campaign-cardinality",
    label: i18n.t("newExperiment.launch.details.plannedAnalyses"),
    value: [
      campaignPreview.summary.inputCardinalityLabel,
      campaignPreview.summary.runCountLabel,
    ].join(" · "),
    title: `${campaignPreview.runMatrixLabel}: ${campaignPreview.summary.matrixCoverageLabel}`,
  };
}

export function buildExperimentLaunchBadgeLabels(
  campaignPreview: CampaignPlanPreview,
): ExperimentLaunchBadgeLabel[] {
  return [
    { id: "backend", label: campaignPreview.executionBackendLabel },
    { id: "adapter", label: campaignPreview.executionAdapter.label },
    { id: "run-matrix", label: campaignPreview.runMatrixLabel },
  ];
}

export function formatExperimentLaunchAdapterStatusLine(
  campaignPreview: CampaignPlanPreview,
): string {
  return campaignPreview.executionAdapter.message;
}

function getExperimentLaunchStrictPayloadStatusLabel(
  status: ExperimentLaunchStrictCampaignPayloadStatus,
): string {
  if (status === "ready") return i18n.t("newExperiment.campaign.status.ready");
  if (status === "partial") return i18n.t("newExperiment.launch.payloadStatus.partial");
  if (status === "unavailable") return i18n.t("newExperiment.environment.status.unavailable");
  return i18n.t("newExperiment.adapter.localAnalysis");
}

function getExperimentLaunchCurrentSubmissionKindLabel(
  kind: ExperimentLaunchCurrentSubmissionKind,
): string {
  if (kind === "native_payload") return i18n.t("newExperiment.launch.payloadKind.nativePayload");
  return i18n.t("newExperiment.adapter.localAnalysis");
}

export function getExperimentLaunchPayloadBadgeVariant(
  status: ExperimentLaunchStrictCampaignPayloadStatus,
): ExperimentLaunchPayloadBadgeVariant {
  if (status === "ready") return "secondary";
  if (status === "partial") return "warning";
  if (status === "unavailable") return "destructive";
  return "outline";
}

export function buildExperimentLaunchPayloadBadgeLabels(
  launchPayloadPlan: ExperimentLaunchPayloadPlan,
): ExperimentLaunchPayloadBadgeLabel[] {
  return [
    {
      id: "current-submission",
      label: i18n.t("newExperiment.launch.badges.analysis", {
        value: getExperimentLaunchCurrentSubmissionKindLabel(launchPayloadPlan.currentSubmissionKind),
      }),
      variant: launchPayloadPlan.currentSubmissionKind === "native_payload" ? "secondary" : "outline",
    },
    {
      id: "strict-campaigns",
      label: i18n.t("newExperiment.launch.badges.preparation", {
        value: getExperimentLaunchStrictPayloadStatusLabel(launchPayloadPlan.strictCampaignPayloadStatus),
      }),
      variant: getExperimentLaunchPayloadBadgeVariant(launchPayloadPlan.strictCampaignPayloadStatus),
    },
  ];
}

export function buildExperimentLaunchPayloadManifestDetails(
  launchPayloadPlan: ExperimentLaunchPayloadPlan,
  campaignPreview: CampaignPlanPreview,
): ExperimentLaunchPayloadManifestDetail[] {
  const { payloadDiagnostics } = launchPayloadPlan;
  const sourceRunPreview = formatExperimentLaunchRunIdPreview(payloadDiagnostics.sourceRunIds);
  const skippedRunPreview = formatExperimentLaunchRunIdPreview(payloadDiagnostics.skippedRunIds);
  const readinessPreview = formatExperimentLaunchPayloadReadinessDetail(launchPayloadPlan);
  const submissionTargetPreview = formatExperimentLaunchSubmissionTargetDetail(
    launchPayloadPlan,
    campaignPreview,
  );
  const details: ExperimentLaunchPayloadManifestDetail[] = [
    {
      id: "legacy-inputs",
      label: i18n.t("newExperiment.launch.details.selectedInputs"),
      value: [
        formatExperimentLaunchCount(payloadDiagnostics.legacyDatasetCount, "counts.dataset"),
        formatExperimentLaunchCount(payloadDiagnostics.legacyPipelineCount, "counts.pipeline"),
      ].join(" · "),
    },
    {
      id: "native-payload",
      label: i18n.t("newExperiment.launch.details.preparation"),
      value: [
        formatExperimentLaunchCount(payloadDiagnostics.strictCampaignCount, "launch.counts.preparedAnalysis"),
        formatExperimentLaunchCount(payloadDiagnostics.skippedRunCount, "launch.counts.skippedRun"),
      ].join(" · "),
    },
    {
      id: "submission-target",
      label: i18n.t("newExperiment.launch.details.calculateWith"),
      ...submissionTargetPreview,
    },
    formatExperimentLaunchCampaignCardinalityDetail(campaignPreview),
    formatExperimentLaunchSchemaBindingDetail(campaignPreview),
    {
      id: "payload-readiness",
      label: i18n.t("newExperiment.launch.details.preparationStatus"),
      ...readinessPreview,
    },
    {
      id: "source-runs",
      label: i18n.t("newExperiment.launch.details.selectedAnalyses"),
      ...sourceRunPreview,
    },
  ];

  if (payloadDiagnostics.skippedRunIds.length > 0) {
    details.push({
      id: "skipped-runs",
      label: i18n.t("newExperiment.launch.details.skippedRuns"),
      ...skippedRunPreview,
    });
  }

  const robustnessEvidencePublicationDetail = formatExperimentLaunchRobustnessEvidencePublicationDetail(payloadDiagnostics);
  if (robustnessEvidencePublicationDetail) {
    details.push(robustnessEvidencePublicationDetail);
  }

  return details;
}

export function formatExperimentLaunchPayloadStatusLine(
  launchPayloadPlan: ExperimentLaunchPayloadPlan,
): string {
  return launchPayloadPlan.strictCampaignPayloadSummary;
}

export function formatExperimentLaunchPayloadActivationLine(
  launchPayloadPlan: ExperimentLaunchPayloadPlan,
): string {
  return launchPayloadPlan.strictCampaignPayloadActivation.message;
}

export function getExperimentLaunchDescription(
  experimentDescription: string,
): string | null {
  return experimentDescription || null;
}

export function getExperimentLaunchDatasetBadgeLabel(
  datasetId: string,
  datasetById: ReadonlyMap<string, ExperimentLaunchDatasetLabelSource>,
): string {
  return datasetById.get(datasetId)?.name || datasetId;
}
