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

function formatExperimentLaunchCount(
  count: number,
  singular: string,
  plural = `${singular}s`,
): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function formatExperimentLaunchRunIdPreview(runIds: readonly string[]): Pick<
  ExperimentLaunchPayloadManifestDetail,
  "value" | "title"
> {
  if (runIds.length === 0) {
    return { value: "None" };
  }

  const visibleRunIds = runIds.slice(0, 2);
  const hiddenCount = runIds.length - visibleRunIds.length;
  const value = hiddenCount > 0
    ? `${visibleRunIds.join(", ")} + ${hiddenCount} more`
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
    return { value: "Legacy config submission" };
  }

  if (payloadDiagnostics.canSubmitNativePayload) {
    return { value: "Ready for native submission" };
  }

  return {
    value: "Blocked for native submission",
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
      value: `${campaignPreview.executionBackendLabel} via ${campaignPreview.executionAdapter.label}`,
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
    label: "Schema binding",
    value: [
      campaignPreview.schemaConstraint.label,
      campaignPreview.schemaConstraint.strictPairingStatusLabel,
    ].join(" · "),
    title: formatCampaignSchemaConstraintLine(campaignPreview),
  };
}

function formatExperimentLaunchCampaignCardinalityDetail(
  campaignPreview: CampaignPlanPreview,
): ExperimentLaunchPayloadManifestDetail {
  return {
    id: "campaign-cardinality",
    label: "Campaign cardinality",
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
  return `${campaignPreview.executionAdapter.statusLabel}: ${campaignPreview.executionAdapter.message}`;
}

function getExperimentLaunchStrictPayloadStatusLabel(
  status: ExperimentLaunchStrictCampaignPayloadStatus,
): string {
  if (status === "ready") return "Ready";
  if (status === "partial") return "Partial";
  if (status === "unavailable") return "Unavailable";
  return "Legacy only";
}

function getExperimentLaunchCurrentSubmissionKindLabel(
  kind: ExperimentLaunchCurrentSubmissionKind,
): string {
  if (kind === "native_payload") return "Native payload";
  return "Legacy config";
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
      label: `Submission: ${getExperimentLaunchCurrentSubmissionKindLabel(launchPayloadPlan.currentSubmissionKind)}`,
      variant: launchPayloadPlan.currentSubmissionKind === "native_payload" ? "secondary" : "outline",
    },
    {
      id: "strict-campaigns",
      label: `Strict campaigns: ${getExperimentLaunchStrictPayloadStatusLabel(launchPayloadPlan.strictCampaignPayloadStatus)}`,
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
      label: "Legacy inputs",
      value: [
        formatExperimentLaunchCount(payloadDiagnostics.legacyDatasetCount, "dataset"),
        formatExperimentLaunchCount(payloadDiagnostics.legacyPipelineCount, "pipeline"),
      ].join(" · "),
    },
    {
      id: "native-payload",
      label: "Native payload",
      value: [
        formatExperimentLaunchCount(payloadDiagnostics.strictCampaignCount, "strict campaign"),
        formatExperimentLaunchCount(payloadDiagnostics.skippedRunCount, "skipped run"),
      ].join(" · "),
    },
    {
      id: "submission-target",
      label: "Submission target",
      ...submissionTargetPreview,
    },
    formatExperimentLaunchCampaignCardinalityDetail(campaignPreview),
    formatExperimentLaunchSchemaBindingDetail(campaignPreview),
    {
      id: "payload-schema",
      label: "Payload schema",
      value: payloadDiagnostics.nativePayloadVersion,
      title: "Native launch payload schema version",
    },
    {
      id: "payload-readiness",
      label: "Payload readiness",
      ...readinessPreview,
    },
    {
      id: "source-runs",
      label: "Source runs",
      ...sourceRunPreview,
    },
  ];

  if (payloadDiagnostics.skippedRunIds.length > 0) {
    details.push({
      id: "skipped-runs",
      label: "Skipped runs",
      ...skippedRunPreview,
    });
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
