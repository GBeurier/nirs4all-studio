import { describe, expect, it, vi } from "vitest";

import type { PreflightResult } from "@/api/runs";
import type { ExperimentConfig } from "@/types/runs";

import { resolveExperimentLaunchPreflightDecision } from "../experimentLaunchPreflight";
import type { MissingOperatorIssue } from "../pipelineOperatorAvailability";

const launchConfig: ExperimentConfig = {
  name: "Experiment",
  dataset_ids: ["d1"],
  pipeline_ids: ["p1"],
  split_group_by_by_dataset: { d1: null },
};

const prunedLaunchConfig: ExperimentConfig = {
  ...launchConfig,
  pipeline_ids: [],
  inline_pipeline: {
    name: "PLS Pipeline",
    steps: [{ id: "model", name: "PLS" }],
  },
};

function missingOperatorIssue(overrides: Partial<MissingOperatorIssue> = {}): MissingOperatorIssue {
  return {
    type: "missing_module",
    message: "SNV unavailable",
    details: {
      pipeline_id: "p1",
      step_id: "pre",
    },
    ...overrides,
  };
}

describe("experimentLaunchPreflight", () => {
  it("keeps the initial launch config when preflight is ready", () => {
    const buildPrunedLaunchConfig = vi.fn();

    expect(resolveExperimentLaunchPreflightDecision({
      preflight: { ready: true, issues: [] },
      launchConfig,
      buildPrunedLaunchConfig,
    })).toEqual({
      status: "ready",
      launchConfig,
    });
    expect(buildPrunedLaunchConfig).not.toHaveBeenCalled();
  });

  it("blocks launches for non-prunable preflight issues", () => {
    const preflight: PreflightResult = {
      ready: false,
      issues: [
        {
          type: "invalid_pipeline",
          message: "Pipeline graph is invalid",
        },
      ],
    };

    expect(resolveExperimentLaunchPreflightDecision({
      preflight,
      launchConfig,
      buildPrunedLaunchConfig: vi.fn(),
    })).toEqual({
      status: "blocked",
      message: "Pipeline graph is invalid",
    });
  });

  it("requests confirmation with a pruned launch config for missing operators", () => {
    const issue = missingOperatorIssue();
    const buildPrunedLaunchConfig = vi.fn(() => prunedLaunchConfig);

    expect(resolveExperimentLaunchPreflightDecision({
      preflight: { ready: false, issues: [issue] },
      launchConfig,
      buildPrunedLaunchConfig,
    })).toEqual({
      status: "confirm_pruned",
      launchConfig: prunedLaunchConfig,
      missingIssues: [issue],
    });
    expect(buildPrunedLaunchConfig).toHaveBeenCalledWith([issue]);
  });

  it("blocks when missing-operator pruning would make a launch invalid", () => {
    const issue = missingOperatorIssue();

    expect(resolveExperimentLaunchPreflightDecision({
      preflight: { ready: false, issues: [issue] },
      launchConfig,
      buildPrunedLaunchConfig: () => {
        throw new Error("Pipeline would be empty");
      },
    })).toEqual({
      status: "blocked",
      message: "Pipeline would be empty",
    });
  });
});
