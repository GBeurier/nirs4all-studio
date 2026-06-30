import type { MissingOperatorIssue } from "@/lib/pipelineOperatorAvailability";
import type { ExperimentConfig } from "@/types/runs";

export const EXPERIMENT_LAUNCH_SUCCESS_MESSAGE = "Experiment started!";
export const EXPERIMENT_LAUNCH_GROUPING_BLOCKED_MESSAGE = "Resolve runtime grouping errors before launching this experiment.";
export const EXPERIMENT_LAUNCH_PREFLIGHT_UNAVAILABLE_MESSAGE = "Preflight check unavailable — dependency verification was skipped";
export const EXPERIMENT_LAUNCH_PREFLIGHT_BLOCKED_TITLE = "Cannot start experiment";

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
  return "Unknown error";
}

export function formatExperimentLaunchFailureMessage(detail: string): string {
  return `Failed to start: ${detail}`;
}
