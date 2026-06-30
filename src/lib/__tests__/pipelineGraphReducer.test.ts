import { describe, expect, it } from "vitest";

import type { PipelineStep } from "@/components/pipeline-editor/types";
import {
  countPipelineStepsRecursive,
  findPipelineStepById,
  getPipelineStepsAtPath,
  pushPipelineGraphHistory,
  redoPipelineGraphHistory,
  removePipelineStepById,
  undoPipelineGraphHistory,
  updatePipelineStepsAtPath,
} from "../pipelineGraphReducer";

function step(overrides: Partial<PipelineStep> & Pick<PipelineStep, "id" | "name" | "type">): PipelineStep {
  return {
    params: {},
    ...overrides,
  };
}

function buildNestedSteps(): PipelineStep[] {
  return [
    step({ id: "pre", name: "SNV", type: "preprocessing" }),
    step({
      id: "brancher",
      name: "Branch",
      type: "flow",
      subType: "branch",
      branches: [
        [step({ id: "b0-model", name: "PLS", type: "model" })],
        [step({ id: "b1-pre", name: "MSC", type: "preprocessing" })],
      ],
    }),
    step({
      id: "augment",
      name: "Augment",
      type: "flow",
      subType: "sample_augmentation",
      children: [
        step({
          id: "child-filter",
          name: "Filter",
          type: "flow",
          subType: "sample_filter",
        }),
      ],
    }),
    step({
      id: "merge",
      name: "Merge",
      type: "flow",
      subType: "merge",
    }),
  ];
}

describe("pipelineGraphReducer", () => {
  it("resolves nested branch and children paths without exposing root identity", () => {
    const steps = buildNestedSteps();

    const rootSteps = getPipelineStepsAtPath(steps, []);

    expect(rootSteps).toEqual(steps);
    expect(rootSteps).not.toBe(steps);
    expect(getPipelineStepsAtPath(steps, ["brancher", "branch", "0"])).toEqual([
      expect.objectContaining({ id: "b0-model" }),
    ]);
    expect(getPipelineStepsAtPath(steps, ["augment", "children"])).toEqual([
      expect.objectContaining({ id: "child-filter" }),
    ]);
    expect(getPipelineStepsAtPath(steps, ["missing", "children"])).toEqual([]);
  });

  it("updates nested paths immutably and initializes empty flow children containers", () => {
    const steps = buildNestedSteps();
    const nextModel = step({ id: "b0-model-2", name: "Ridge", type: "model" });

    const withNestedModel = updatePipelineStepsAtPath(
      steps,
      ["brancher", "branch", "0"],
      (branchSteps) => [...branchSteps, nextModel],
    );

    expect(withNestedModel).not.toBe(steps);
    expect(getPipelineStepsAtPath(withNestedModel, ["brancher", "branch", "0"])).toEqual([
      expect.objectContaining({ id: "b0-model" }),
      nextModel,
    ]);
    expect(getPipelineStepsAtPath(steps, ["brancher", "branch", "0"])).toEqual([
      expect.objectContaining({ id: "b0-model" }),
    ]);

    const emptySequential = [
      step({
        id: "seq",
        name: "Sequence",
        type: "flow",
        subType: "sequential",
      }),
    ];
    const initialized = updatePipelineStepsAtPath(
      emptySequential,
      ["seq", "children"],
      () => [step({ id: "seq-child", name: "SNV", type: "preprocessing" })],
    );

    expect(initialized[0]?.children).toEqual([
      expect.objectContaining({ id: "seq-child" }),
    ]);
  });

  it("counts, finds, and removes root and nested steps", () => {
    const steps = buildNestedSteps();

    expect(countPipelineStepsRecursive(steps)).toMatchObject({
      branch: 1,
      merge: 1,
      model: 1,
      preprocessing: 2,
      sample_augmentation: 1,
      sample_filter: 1,
    });
    expect(findPipelineStepById(steps, "b1-pre")).toMatchObject({ name: "MSC" });
    expect(findPipelineStepById(steps, "child-filter")).toMatchObject({ subType: "sample_filter" });
    expect(findPipelineStepById(steps, "missing")).toBeNull();

    const withoutBranchStep = removePipelineStepById(steps, "b1-pre");
    expect(getPipelineStepsAtPath(withoutBranchStep, ["brancher", "branch", "1"])).toEqual([]);

    const withoutRootStep = removePipelineStepById(steps, "augment");
    expect(withoutRootStep.map((entry) => entry.id)).toEqual(["pre", "brancher", "merge"]);
  });

  it("pushes, truncates, undoes, and redoes graph history", () => {
    const a = [step({ id: "a", name: "A", type: "preprocessing" })];
    const b = [step({ id: "b", name: "B", type: "preprocessing" })];
    const c = [step({ id: "c", name: "C", type: "preprocessing" })];
    const d = [step({ id: "d", name: "D", type: "preprocessing" })];

    expect(pushPipelineGraphHistory({
      history: [a],
      historyIndex: 0,
      nextSteps: b,
      maxHistorySize: 3,
    })).toEqual({
      history: [a, b],
      historyIndex: 1,
    });

    expect(pushPipelineGraphHistory({
      history: [a, b, c],
      historyIndex: 1,
      nextSteps: d,
      maxHistorySize: 3,
    })).toEqual({
      history: [a, b, d],
      historyIndex: 2,
    });

    expect(pushPipelineGraphHistory({
      history: [a, b, c],
      historyIndex: 2,
      nextSteps: d,
      maxHistorySize: 3,
    })).toEqual({
      history: [b, c, d],
      historyIndex: 2,
    });

    expect(undoPipelineGraphHistory({ history: [a, b], historyIndex: 1 })).toEqual({
      history: [a, b],
      historyIndex: 0,
      steps: a,
    });
    expect(undoPipelineGraphHistory({ history: [a], historyIndex: 0 })).toBeNull();

    expect(redoPipelineGraphHistory({ history: [a, b], historyIndex: 0 })).toEqual({
      history: [a, b],
      historyIndex: 1,
      steps: b,
    });
    expect(redoPipelineGraphHistory({ history: [a, b], historyIndex: 1 })).toBeNull();
  });
});
