/**
 * Step and Pipeline Validation Tests
 *
 * Tests for step structure and pipeline-level validation.
 */

import { describe, it, expect } from "vitest";
import type { PipelineStep, StepType } from "../../types";
import type { ValidationLocation } from "../types";
import {
  validateStep,
  createStepIssue,
  findDuplicateStepIds,
} from "../stepValidator";
import {
  validatePipeline,
  createPipelineIssue,
  countTotalSteps,
  getPipelineSummary,
} from "../pipelineValidator";
import type { ValidationContext } from "../types";

// ============================================================================
// Test Fixtures
// ============================================================================

function createMockStep(overrides: Partial<PipelineStep> = {}): PipelineStep {
  return {
    id: `step-${Math.random().toString(36).substr(2, 9)}`,
    name: "TestStep",
    type: "preprocessing" as StepType,
    enabled: true,
    params: {},
    ...overrides,
  };
}

function createLocation(overrides: Partial<ValidationLocation> = {}): ValidationLocation {
  return {
    stepId: "test-step-1",
    stepName: "TestStep",
    stepType: "preprocessing",
    ...overrides,
  };
}

function createContext(steps: PipelineStep[]): ValidationContext {
  return {
    steps,
    strictMode: false,
    disabledRules: [],
  };
}

// ============================================================================
// Step Validation Tests
// ============================================================================

describe("validateStep", () => {
  it("should validate a simple preprocessing step", () => {
    const step = createMockStep({ type: "preprocessing" });
    const context = createContext([step]);

    const issues = validateStep(step, context);

    expect(issues.length).toBe(0);
  });

  it("should validate container with children", () => {
    const childStep = createMockStep({ type: "preprocessing" });
    const step = createMockStep({
      type: "sample_augmentation",
      children: [childStep],
    });
    const context = createContext([step]);

    const issues = validateStep(step, context);

    // Should not have empty container error
    expect(issues.filter((i) => i.code === "STEP_EMPTY_CONTAINER").length).toBe(0);
  });

  it("should error on branch with empty branches array", () => {
    const step = createMockStep({
      type: "branch",
      branches: [],
    });
    const context = createContext([step]);

    const issues = validateStep(step, context);

    expect(issues.some((i) => i.code === "STEP_EMPTY_BRANCHES")).toBe(true);
  });

  it("should validate branch with non-empty branches", () => {
    const childStep = createMockStep({ type: "preprocessing" });
    const step = createMockStep({
      type: "branch",
      branches: [[childStep]],
    });
    const context = createContext([step]);

    const issues = validateStep(step, context);

    expect(issues.filter((i) => i.code === "STEP_EMPTY_BRANCHES").length).toBe(
      0
    );
  });
});

describe("findDuplicateStepIds", () => {
  it("should return empty array for unique IDs", () => {
    const steps: PipelineStep[] = [
      createMockStep({ id: "step-1" }),
      createMockStep({ id: "step-2" }),
      createMockStep({ id: "step-3" }),
    ];

    const issues = findDuplicateStepIds(steps);

    expect(issues.length).toBe(0);
  });

  it("should find duplicate IDs", () => {
    const steps: PipelineStep[] = [
      createMockStep({ id: "step-1" }),
      createMockStep({ id: "step-1" }), // Duplicate!
      createMockStep({ id: "step-2" }),
    ];

    const issues = findDuplicateStepIds(steps);

    expect(issues.some((i) => i.code === "STEP_DUPLICATE_ID")).toBe(true);
  });

  it("should find duplicates in nested branches", () => {
    const nestedStep = createMockStep({ id: "nested-1" });
    const branchStep = createMockStep({
      id: "branch-1",
      type: "branch",
      branches: [[nestedStep], [createMockStep({ id: "nested-1" })]],
    });
    const steps: PipelineStep[] = [branchStep];

    const issues = findDuplicateStepIds(steps);

    expect(issues.some((i) => i.code === "STEP_DUPLICATE_ID")).toBe(true);
  });
});

describe("createStepIssue", () => {
  it("should create issue with correct step location", () => {
    const location = createLocation({ stepId: "test-id", stepName: "TestName" });
    const issue = createStepIssue(
      "STEP_EMPTY_CONTAINER",
      "error",
      "Container is empty",
      location
    );

    expect(issue.code).toBe("STEP_EMPTY_CONTAINER");
    expect(issue.location.stepId).toBe("test-id");
    expect(issue.location.stepName).toBe("TestName");
    expect(issue.category).toBe("step");
  });
});

// ============================================================================
// Pipeline Validation Tests
// ============================================================================

describe("validatePipeline", () => {
  it("should warn on empty pipeline", () => {
    const context = createContext([]);

    const issues = validatePipeline(context);

    expect(issues.some((i) => i.code === "PIPELINE_EMPTY")).toBe(true);
  });

  it("should warn on missing model step", () => {
    const steps: PipelineStep[] = [
      createMockStep({ type: "preprocessing" }),
      createMockStep({ type: "splitting" }),
    ];
    const context = createContext(steps);

    const issues = validatePipeline(context);

    expect(issues.some((i) => i.code === "PIPELINE_NO_MODEL")).toBe(true);
  });

  it("should not warn when model step exists", () => {
    const steps: PipelineStep[] = [
      createMockStep({ type: "preprocessing" }),
      createMockStep({ type: "splitting" }),
      createMockStep({ type: "model" }),
    ];
    const context = createContext(steps);

    const issues = validatePipeline(context);

    expect(issues.filter((i) => i.code === "PIPELINE_NO_MODEL").length).toBe(0);
  });

  it("should not error when model comes after splitter", () => {
    const steps: PipelineStep[] = [
      createMockStep({
        type: "splitting",
        id: "splitter-1",
        name: "Splitter",
      }),
      createMockStep({ type: "model", id: "model-1", name: "Model" }),
    ];
    const context = createContext(steps);

    const issues = validatePipeline(context);

    expect(
      issues.filter((i) => i.code === "PIPELINE_MODEL_BEFORE_SPLITTER").length
    ).toBe(0);
  });

  it("should error on merge without branch", () => {
    const steps: PipelineStep[] = [
      createMockStep({ type: "preprocessing" }),
      createMockStep({ type: "merge", id: "merge-1", name: "Merge" }),
      createMockStep({ type: "model" }),
    ];
    const context = createContext(steps);

    const issues = validatePipeline(context);

    expect(issues.some((i) => i.code === "PIPELINE_MERGE_WITHOUT_BRANCH")).toBe(
      true
    );
  });

  it("should not error on merge with preceding branch", () => {
    const branchStep = createMockStep({
      type: "branch",
      id: "branch-1",
      branches: [[createMockStep()], [createMockStep()]],
    });
    const steps: PipelineStep[] = [
      branchStep,
      createMockStep({ type: "merge", id: "merge-1", name: "Merge" }),
      createMockStep({ type: "model" }),
    ];
    const context = createContext(steps);

    const issues = validatePipeline(context);

    expect(
      issues.filter((i) => i.code === "PIPELINE_MERGE_WITHOUT_BRANCH").length
    ).toBe(0);
  });
});

describe("countTotalSteps", () => {
  it("should count flat steps correctly", () => {
    const steps: PipelineStep[] = [
      createMockStep(),
      createMockStep(),
      createMockStep(),
    ];

    expect(countTotalSteps(steps)).toBe(3);
  });

  it("should count nested steps in containers", () => {
    const childSteps = [createMockStep(), createMockStep()];
    const containerStep = createMockStep({
      type: "sample_augmentation",
      children: childSteps,
    });
    const steps: PipelineStep[] = [containerStep, createMockStep()];

    // 1 container + 2 children + 1 regular = 4
    expect(countTotalSteps(steps)).toBe(4);
  });

  it("should count nested steps in branches", () => {
    const branchStep = createMockStep({
      type: "branch",
      branches: [
        [createMockStep(), createMockStep()],
        [createMockStep()],
      ],
    });
    const steps: PipelineStep[] = [branchStep];

    // 1 branch + 2 in branch 1 + 1 in branch 2 = 4
    expect(countTotalSteps(steps)).toBe(4);
  });
});

describe("getPipelineSummary", () => {
  it("should return correct summary for mixed pipeline", () => {
    const steps: PipelineStep[] = [
      createMockStep({ type: "preprocessing" }),
      createMockStep({ type: "preprocessing" }),
      createMockStep({ type: "splitting" }),
      createMockStep({ type: "model" }),
    ];

    const summary = getPipelineSummary(steps);

    expect(summary.totalSteps).toBe(4);
    expect(summary.hasModel).toBe(true);
    expect(summary.hasSplitter).toBe(true);
    expect(summary.hasBranch).toBe(false);
  });

  it("should detect branches", () => {
    const steps: PipelineStep[] = [
      createMockStep({
        type: "branch",
        branches: [[createMockStep()]],
      }),
    ];

    const summary = getPipelineSummary(steps);

    expect(summary.hasBranch).toBe(true);
  });

  it("should detect generators as branches", () => {
    const steps: PipelineStep[] = [
      createMockStep({ type: "generator", branches: [[createMockStep()]] }),
    ];

    const summary = getPipelineSummary(steps);

    // Generators are treated like branches
    expect(summary.hasBranch).toBe(true);
  });
});

describe("createPipelineIssue", () => {
  it("should create issue with pipeline category", () => {
    const issue = createPipelineIssue(
      "PIPELINE_EMPTY",
      "warning",
      "Pipeline has no steps"
    );

    expect(issue.code).toBe("PIPELINE_EMPTY");
    expect(issue.severity).toBe("warning");
    expect(issue.category).toBe("pipeline");
    expect(issue.location).toBeDefined();
  });
});
