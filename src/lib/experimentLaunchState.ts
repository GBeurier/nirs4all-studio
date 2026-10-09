import i18n from "i18next";

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
    title: i18n.t("newExperiment.launch.notReadyNotice"),
    message,
  };
}

function getExperimentLaunchNativeReadyButtonLabel(
  executionBackend: CampaignExecutionBackend,
): string {
  if (executionBackend === "cluster") return i18n.t("newExperiment.launch.actions.launchOnCluster");
  if (executionBackend === "wasm-local") return i18n.t("newExperiment.launch.actions.runInBrowser");
  return i18n.t("newExperiment.launch.actions.launch");
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

  return i18n.t("newExperiment.launch.actions.launch");
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
      buttonLabel: i18n.t("newExperiment.launch.actions.checking"),
      isLaunchDisabled: true,
      showSpinner: true,
    };
  }

  if (isLaunching) {
    return {
      actionState: "launching",
      blockingNotices,
      buttonLabel: i18n.t("newExperiment.launch.actions.starting"),
      isLaunchDisabled: true,
      showSpinner: true,
    };
  }

  if (!campaignPreview.isRunnable) {
    return {
      actionState: "blocked",
      blockingNotices,
      buttonLabel: i18n.t("newExperiment.launch.actions.reviewSettings"),
      isLaunchDisabled: true,
      showSpinner: false,
    };
  }

  if (payloadBlockingNotice) {
    return {
      actionState: "blocked",
      blockingNotices,
      buttonLabel: i18n.t("newExperiment.launch.actions.reviewSettings"),
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
