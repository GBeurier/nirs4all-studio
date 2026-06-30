import { describe, expect, it } from "vitest";

import type { MissingOperatorIssue } from "@/lib/pipelineOperatorAvailability";
import type { ExperimentConfig } from "@/types/runs";
import {
  createClosedExperimentMissingNodesDialogState,
  createOpenExperimentMissingNodesDialogState,
  EXPERIMENT_LAUNCH_PREFLIGHT_BLOCKED_TITLE,
  EXPERIMENT_LAUNCH_GROUPING_BLOCKED_MESSAGE,
  EXPERIMENT_LAUNCH_PREFLIGHT_UNAVAILABLE_MESSAGE,
  EXPERIMENT_LAUNCH_SUCCESS_MESSAGE,
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
    expect(EXPERIMENT_LAUNCH_SUCCESS_MESSAGE).toBe("Experiment started!");
    expect(EXPERIMENT_LAUNCH_GROUPING_BLOCKED_MESSAGE).toBe("Resolve runtime grouping errors before launching this experiment.");
    expect(EXPERIMENT_LAUNCH_PREFLIGHT_UNAVAILABLE_MESSAGE).toBe("Preflight check unavailable — dependency verification was skipped");
    expect(EXPERIMENT_LAUNCH_PREFLIGHT_BLOCKED_TITLE).toBe("Cannot start experiment");
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
