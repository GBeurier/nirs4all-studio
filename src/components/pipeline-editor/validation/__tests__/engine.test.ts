/**
 * Validation Engine Tests
 *
 * Tests for the core validation orchestrator.
 */

import { describe, it, expect } from "vitest";
import type { PipelineStep, StepType } from "../../types";
import { validate, isValid, getErrorCount, getQuickSummary, createValidationResult } from "../engine";
import { generateIssueId } from "../types";
import type { ValidationIssue } from "../types";

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

function createValidPipeline(): PipelineStep[] {
  return [
    createMockStep({
      id: "prep-1",
      type: "preprocessing",
      name: "StandardScaler",
    }),
    createMockStep({
      id: "split-1",
      type: "splitting",
      name: "KFold",
      params: { n_splits: 5 },
    }),
    createMockStep({
      id: "model-1",
      type: "model",
      name: "PLSRegression",
      params: { n_components: 10 },
    }),
  ];
}

// ============================================================================
// Validation Engine Tests
// ============================================================================

describe("validate", () => {
  it("should return valid result for valid pipeline", () => {
    const steps = createValidPipeline();

    const result = validate(steps);

    expect(result.isValid).toBe(true);
    expect(result.errors.length).toBe(0);
  });

  it("should return issues for empty pipeline", () => {
    const result = validate([]);

    // Empty pipeline is an info-level issue, not error - pipeline is still "valid"
    expect(result.isValid).toBe(true);
    expect(result.issues.some((i) => i.code === "PIPELINE_EMPTY")).toBe(true);
  });

  it("should return issues for pipeline without model", () => {
    const steps: PipelineStep[] = [
      createMockStep({ type: "preprocessing" }),
      createMockStep({ type: "splitting", params: { n_splits: 5 } }),
    ];

    const result = validate(steps);

    expect(result.issues.some((i) => i.code === "PIPELINE_NO_MODEL")).toBe(
      true
    );
  });

  it("should aggregate issues from all validators", () => {
    // Pipeline with multiple issues
    const steps: PipelineStep[] = [
      createMockStep({
        type: "model",
        id: "model-1",
        params: { n_components: 10 },
      }),
      createMockStep({
        type: "splitting",
        id: "split-1",
        params: { n_splits: 5 },
      }),
      createMockStep({
        type: "merge",
        id: "merge-1",
      }),
    ];

    const result = validate(steps);

    // Should have model_before_splitter and merge_without_branch issues
    expect(result.issues.length).toBeGreaterThan(1);
  });

  it("should generate step results map", () => {
    const steps = createValidPipeline();

    const result = validate(steps);

    expect(result.stepResults.size).toBe(3);
    result.stepResults.forEach((stepResult) => {
      expect(stepResult.stepId).toBeDefined();
      expect(stepResult.isValid).toBeDefined();
    });
  });

  it("should respect disabled rules", () => {
    const result = validate([], { disabledRules: ["PIPELINE_EMPTY"] });

    expect(result.issues.some((i) => i.code === "PIPELINE_EMPTY")).toBe(false);
  });

  it("should include correct summary counts", () => {
    const steps: PipelineStep[] = [
      createMockStep({ type: "preprocessing" }),
    ];

    const result = validate(steps);

    expect(result.summary.totalSteps).toBe(1);
    expect(typeof result.summary.errorCount).toBe("number");
    expect(typeof result.summary.warningCount).toBe("number");
    expect(typeof result.summary.infoCount).toBe("number");
  });
});

describe("isValid", () => {
  it("should return true for valid pipeline", () => {
    const steps = createValidPipeline();

    expect(isValid(steps)).toBe(true);
  });

  it("should return true for empty pipeline (info only, no errors)", () => {
    // Empty pipeline has info-level issue, which is not an error
    expect(isValid([])).toBe(true);
  });

  it("should return false when model before splitter (now returns warning)", () => {
    // Model before splitter is a warning, not an error
    const steps: PipelineStep[] = [
      createMockStep({ type: "model", params: { n_components: 10 } }),
      createMockStep({ type: "splitting", params: { n_splits: 5 } }),
    ];

    // This is actually valid because MODEL_BEFORE_SPLITTER is a warning
    expect(isValid(steps)).toBe(true);
  });
});

describe("getErrorCount", () => {
  it("should return 0 for valid pipeline", () => {
    const steps = createValidPipeline();

    expect(getErrorCount(steps)).toBe(0);
  });

  it("should count errors correctly", () => {
    // Create a pipeline that produces actual errors
    const steps: PipelineStep[] = [
      createMockStep({
        id: "merge-1",
        type: "merge",  // Merge without branch is an error
        name: "Merge",
      }),
    ];

    expect(getErrorCount(steps)).toBeGreaterThan(0);
  });
});

describe("getQuickSummary", () => {
  it("should return valid summary for valid pipeline", () => {
    const steps = createValidPipeline();

    const summary = getQuickSummary(steps);

    expect(summary.isValid).toBe(true);
    expect(summary.errors).toBe(0);
  });

  it("should return summary with warnings for model before splitter", () => {
    const steps: PipelineStep[] = [
      createMockStep({ type: "model", params: { n_components: 10 } }),
      createMockStep({ type: "splitting", params: { n_splits: 5 } }),
    ];

    const summary = getQuickSummary(steps);

    // MODEL_BEFORE_SPLITTER is a warning, not an error
    expect(summary.isValid).toBe(true);
    expect(summary.warnings).toBeGreaterThan(0);
  });
});

describe("createValidationResult", () => {
  it("should create result from issues list", () => {
    const issues: ValidationIssue[] = [
      {
        id: generateIssueId(),
        code: "PARAM_REQUIRED",
        severity: "error",
        category: "parameter",
        message: "Test error",
        location: {
          stepId: "step-1",
          stepName: "Test",
          stepType: "preprocessing",
          paramName: "param1",
        },
      },
      {
        id: generateIssueId(),
        code: "PIPELINE_NO_MODEL",
        severity: "warning",
        category: "pipeline",
        message: "Test warning",
        location: {},
      },
    ];

    const steps: PipelineStep[] = [
      {
        id: "step-1",
        type: "preprocessing",
        name: "Test",
        enabled: true,
        params: {},
      },
    ];

    const result = createValidationResult(issues, steps);

    expect(result.isValid).toBe(false); // Has errors
    expect(result.errors.length).toBe(1);
    expect(result.warnings.length).toBe(1);
    expect(result.summary.errorCount).toBe(1);
    expect(result.summary.warningCount).toBe(1);
  });
});

// ============================================================================
// Edge Cases
// ============================================================================

describe("edge cases", () => {
  it("should handle deeply nested branches", () => {
    const level3Step = createMockStep({ type: "preprocessing" });
    const level2Step = createMockStep({
      type: "branch",
      branches: [[level3Step]],
    });
    const level1Step = createMockStep({
      type: "branch",
      branches: [[level2Step]],
    });
    const steps: PipelineStep[] = [level1Step];

    // Should not throw
    const result = validate(steps);
    expect(result).toBeDefined();
  });

  it("should handle steps with null params", () => {
    const step = createMockStep({
      params: null as unknown as Record<string, unknown>,
    });

    // Should not throw
    const result = validate([step]);
    expect(result).toBeDefined();
  });

  it("should handle steps with undefined params", () => {
    const step = createMockStep({
      params: undefined as unknown as Record<string, unknown>,
    });

    // Should not throw
    const result = validate([step]);
    expect(result).toBeDefined();
  });

  it("should handle circular-like structure (same ID in multiple places)", () => {
    const sharedId = "shared-step-id";
    const step1 = createMockStep({ id: sharedId });
    const step2 = createMockStep({ id: sharedId });
    const steps: PipelineStep[] = [step1, step2];

    const result = validate(steps);

    // Should detect duplicate IDs
    expect(result.issues.some((i) => i.code === "STEP_DUPLICATE_ID")).toBe(
      true
    );
  });
});
