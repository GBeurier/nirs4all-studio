import type { PreflightResult } from "@/api/runs";
import type { ExperimentConfig } from "@/types/runs";

import {
  resolvePreflightIssues,
  type MissingOperatorIssue,
} from "./pipelineOperatorAvailability";

export type ExperimentLaunchPreflightDecision =
  | { status: "ready"; launchConfig: ExperimentConfig }
  | { status: "blocked"; message: string }
  | {
      status: "confirm_pruned";
      launchConfig: ExperimentConfig;
      missingIssues: MissingOperatorIssue[];
    };

export interface ResolveExperimentLaunchPreflightDecisionInput {
  preflight: PreflightResult;
  launchConfig: ExperimentConfig;
  buildPrunedLaunchConfig: (missingIssues: MissingOperatorIssue[]) => ExperimentConfig;
}

function getPruneErrorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Cannot remove missing nodes from this launch.";
}

export function resolveExperimentLaunchPreflightDecision({
  preflight,
  launchConfig,
  buildPrunedLaunchConfig,
}: ResolveExperimentLaunchPreflightDecisionInput): ExperimentLaunchPreflightDecision {
  if (preflight.ready) {
    return { status: "ready", launchConfig };
  }

  const preflightResolution = resolvePreflightIssues(preflight);

  if (preflightResolution.status === "ready") {
    return { status: "ready", launchConfig };
  }

  if (preflightResolution.status === "blocking") {
    return {
      status: "blocked",
      message: preflightResolution.message,
    };
  }

  try {
    return {
      status: "confirm_pruned",
      launchConfig: buildPrunedLaunchConfig(preflightResolution.missingIssues),
      missingIssues: preflightResolution.missingIssues,
    };
  } catch (error) {
    return {
      status: "blocked",
      message: getPruneErrorMessage(error),
    };
  }
}
