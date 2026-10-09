import "@/lib/__tests__/support/experimentI18n";
import { describe, expect, it } from "vitest";

import type { MissingOperatorIssue } from "@/lib/pipelineOperatorAvailability";
import type { ExperimentConfig } from "@/types/runs";
import {
  createClosedExperimentMissingNodesDialogState,
  createOpenExperimentMissingNodesDialogState,
  experimentLaunchMessages,
  formatExperimentLaunchFailureMessage,
  getExperimentLaunchFailureDetail,
  setExperimentMissingNodesDialogOpen,
} from "@/lib/experimentLaunchFlowState";

const launchConfig: ExperimentConfig = {
  name: "Campaign",
  dataset_ids: ["dataset"],
  pipeline_ids: ["pipeline"],
};

const missingIssues: MissingOperatorIssue[] = [
  {
    type: "missing_module",
    message: "Operator missing",
    details: {
      pipeline_id: "pipeline",
      step_id: "step",
    },
  },
];

describe("experimentLaunchFlowState", () => {
  it("keeps launch messages centralized", () => {
    expect(experimentLaunchMessages.success).toBe("Experiment started!");
    expect(experimentLaunchMessages.groupingBlocked).toBe("Check sample grouping before launching this experiment.");
    expect(experimentLaunchMessages.preflightUnavailable).toBe("Required analysis tools could not be checked.");
    expect(experimentLaunchMessages.preflightBlockedTitle).toBe("Cannot start experiment");
  });

  it("opens and closes missing-node confirmation state", () => {
    const closed = createClosedExperimentMissingNodesDialogState();
    expect(closed).toEqual({
      isOpen: false,
      launchConfig: null,
      missingIssues: [],
    });

    const open = createOpenExperimentMissingNodesDialogState(launchConfig, missingIssues);
    expect(open).toEqual({
      isOpen: true,
      launchConfig,
      missingIssues,
    });

    expect(setExperimentMissingNodesDialogOpen(open, false)).toEqual(closed);
    expect(setExperimentMissingNodesDialogOpen(open, true)).toEqual(open);
  });

  it("extracts launch failure detail from API errors and generic errors", () => {
    expect(getExperimentLaunchFailureDetail({ detail: "Backend rejected launch" })).toBe("Backend rejected launch");
    expect(getExperimentLaunchFailureDetail(new Error("Network failed"))).toBe("Network failed");
    expect(getExperimentLaunchFailureDetail({ detail: "   " })).toBe("Unknown error");
    expect(getExperimentLaunchFailureDetail(null)).toBe("Unknown error");
    expect(formatExperimentLaunchFailureMessage("Backend rejected launch")).toBe("Failed to start: Backend rejected launch");
  });
});
