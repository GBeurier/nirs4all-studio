import i18n from "i18next";

import type { MissingOperatorIssue } from "@/lib/pipelineOperatorAvailability";
import type { ExperimentConfig } from "@/types/runs";

/** Launch toast copy; getters resolve the active language at read time. */
export const experimentLaunchMessages = {
  get success() { return i18n.t("newExperiment.launch.started"); },
  get groupingBlocked() { return i18n.t("newExperiment.launch.errors.groupingBlocked"); },
  get preflightUnavailable() { return i18n.t("newExperiment.launch.errors.preflightUnavailable"); },
  get preflightBlockedTitle() { return i18n.t("newExperiment.launch.errors.cannotStart"); },
};

export interface ExperimentMissingNodesDialogState {
  isOpen: boolean;
  launchConfig: ExperimentConfig | null;
  missingIssues: MissingOperatorIssue[];
}

export function createClosedExperimentMissingNodesDialogState(): ExperimentMissingNodesDialogState {
  return {
    isOpen: false,
    launchConfig: null,
    missingIssues: [],
  };
}

export function createOpenExperimentMissingNodesDialogState(
  launchConfig: ExperimentConfig,
  missingIssues: MissingOperatorIssue[],
): ExperimentMissingNodesDialogState {
  return {
    isOpen: true,
    launchConfig,
    missingIssues,
  };
}

export function setExperimentMissingNodesDialogOpen(
  state: ExperimentMissingNodesDialogState,
  isOpen: boolean,
): ExperimentMissingNodesDialogState {
  if (!isOpen) return createClosedExperimentMissingNodesDialogState();
  return { ...state, isOpen: true };
}

export function getExperimentLaunchFailureDetail(error: unknown): string {
  const apiDetail = (error as { detail?: unknown } | null)?.detail;
  if (typeof apiDetail === "string" && apiDetail.trim()) return apiDetail;
  if (error instanceof Error && error.message) return error.message;
  return i18n.t("newExperiment.launch.errors.unknown");
}

export function formatExperimentLaunchFailureMessage(detail: string): string {
  return i18n.t("newExperiment.launch.errors.failedToStart", { detail });
}
