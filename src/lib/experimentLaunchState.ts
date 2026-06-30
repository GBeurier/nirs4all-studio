import type {
  CampaignPlanPreview,
} from "./campaignPlanPreviewTypes";
import type { CampaignPreviewNotice } from "./campaignNoticeTypes";
import type { CampaignExecutionBackend } from "./campaignSpecTypes";
import {
  getExperimentLaunchPayloadSubmissionBlockMessage,
  type ExperimentLaunchPayloadPlan,
} from "./experimentLaunchPayload";

export type ExperimentLaunchActionState =
  | "checking"
  | "launching"
  | "blocked"
  | "ready";

export interface ExperimentLaunchStateInput {
  campaignPreview: CampaignPlanPreview;
  isLaunching: boolean;
  isPreflighting: boolean;
  launchPayloadPlan?: ExperimentLaunchPayloadPlan;
}

export interface ExperimentLaunchState {
  actionState: ExperimentLaunchActionState;
  blockingNotices: CampaignPreviewNotice[];
  buttonLabel: string;
  isLaunchDisabled: boolean;
  showSpinner: boolean;
}

function buildExperimentLaunchPayloadBlockingNotice(
  launchPayloadPlan: ExperimentLaunchPayloadPlan | undefined,
): CampaignPreviewNotice | null {
  if (!launchPayloadPlan) return null;

  const message = getExperimentLaunchPayloadSubmissionBlockMessage(launchPayloadPlan);
  if (!message) return null;

  return {
    id: "native-payload-submission-blocked",
    severity: "blocking",
    title: "Native payload not ready",
    message,
  };
}

function getExperimentLaunchNativeReadyButtonLabel(
  executionBackend: CampaignExecutionBackend,
): string {
  if (executionBackend === "cluster") return "Submit to Cluster";
  if (executionBackend === "wasm-local") return "Run in WASM Local";
  return "Submit Native Payload";
}

function getExperimentLaunchReadyButtonLabel(
  campaignPreview: CampaignPlanPreview,
  launchPayloadPlan: ExperimentLaunchPayloadPlan | undefined,
): string {
  if (
    launchPayloadPlan?.payloadDiagnostics.nativePayloadRequired
    && launchPayloadPlan.payloadDiagnostics.canSubmitNativePayload
  ) {
    return getExperimentLaunchNativeReadyButtonLabel(campaignPreview.summary.executionBackend);
  }

  return "Launch Experiment";
}

export function getExperimentLaunchState({
  campaignPreview,
  isLaunching,
  isPreflighting,
  launchPayloadPlan,
}: ExperimentLaunchStateInput): ExperimentLaunchState {
  const payloadBlockingNotice = buildExperimentLaunchPayloadBlockingNotice(launchPayloadPlan);
  const blockingNotices = campaignPreview.notices.filter((notice) => notice.severity === "blocking");
  if (payloadBlockingNotice) {
    blockingNotices.push(payloadBlockingNotice);
  }

  if (isPreflighting) {
    return {
      actionState: "checking",
      blockingNotices,
      buttonLabel: "Checking...",
      isLaunchDisabled: true,
      showSpinner: true,
    };
  }

  if (isLaunching) {
    return {
      actionState: "launching",
      blockingNotices,
      buttonLabel: "Starting...",
      isLaunchDisabled: true,
      showSpinner: true,
    };
  }

  if (!campaignPreview.isRunnable) {
    return {
      actionState: "blocked",
      blockingNotices,
      buttonLabel: "Resolve Plan Issues",
      isLaunchDisabled: true,
      showSpinner: false,
    };
  }

  if (payloadBlockingNotice) {
    return {
      actionState: "blocked",
      blockingNotices,
      buttonLabel: "Resolve Payload Issues",
      isLaunchDisabled: true,
      showSpinner: false,
    };
  }

  return {
    actionState: "ready",
    blockingNotices,
    buttonLabel: getExperimentLaunchReadyButtonLabel(campaignPreview, launchPayloadPlan),
    isLaunchDisabled: false,
    showSpinner: false,
  };
}
