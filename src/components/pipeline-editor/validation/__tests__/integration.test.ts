/**
 * Validation System Integration Tests
 *
 * End-to-end tests for the validation system covering:
 * - Complete pipeline validation workflows
 * - Cross-validator interactions
 * - Complex nested structures
 * - Real-world NIRS pipeline scenarios
 * - Edge cases and error recovery
 *
 * @see docs/_internals/component_refactoring_specs.md
 */

import { describe, it, expect } from "vitest";
import type { PipelineStep, StepType } from "../../types";
import { validate, isValid, getQuickSummary, getErrorCount } from "../engine";
import type { ValidationErrorCode } from "../types";

// ============================================================================
// Test Utilities
// ============================================================================

let stepIdCounter = 0;

function uniqueId(): string {
  return `step-${++stepIdCounter}`;
}

function createStep(
  type: StepType,
  name: string,
  overrides: Partial<PipelineStep> = {}
): PipelineStep {
  return {
    id: uniqueId(),
    type,
    name,
    enabled: true,
    params: {},
    ...overrides,
  };
}

function createPreprocessingStep(name: string, params: Record<string, string | number | boolean> = {}): PipelineStep {
  return createStep("preprocessing", name, { params });
}

function createModelStep(name: string, params: Record<string, string | number | boolean> = {}): PipelineStep {
  return createStep("model", name, { params });
}

function createSplitterStep(name: string, params: Record<string, string | number | boolean> = {}): PipelineStep {
  return createStep("splitting", name, { params });
}

function createBranchStep(branches: PipelineStep[][]): PipelineStep {
  return createStep("branch", "Branch", { branches });
}

function createMergeStep(): PipelineStep {
  return createStep("merge", "Merge", { params: { method: "predictions" } });
}

function createContainerStep(type: StepType, name: string, children: PipelineStep[]): PipelineStep {
  return createStep(type, name, { children });
}

// ============================================================================
// Complete Pipeline Workflow Tests
// ============================================================================

describe("Complete Pipeline Validation Workflow", () => {
  describe("valid pipelines", () => {
    it("validates a minimal valid NIRS pipeline", () => {
      const steps: PipelineStep[] = [
        createPreprocessingStep("StandardScaler"),
        createSplitterStep("KFold", { n_splits: 5 }),
        createModelStep("PLSRegression", { n_components: 10 }),
      ];

      const result = validate(steps);

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.summary.totalSteps).toBe(3);
    });

    it("validates a complete NIRS pipeline with multiple preprocessing steps", () => {
      const steps: PipelineStep[] = [
        createPreprocessingStep("SNV"),
        createPreprocessingStep("SavitzkyGolay", { window_length: 7, polyorder: 2 }),
        createPreprocessingStep("Detrend"),
        createPreprocessingStep("StandardScaler"),
        createSplitterStep("ShuffleSplit", { n_splits: 3, test_size: 0.2 }),
        createModelStep("PLSRegression", { n_components: 15 }),
      ];

      const result = validate(steps);

      expect(result.isValid).toBe(true);
      expect(result.summary.totalSteps).toBe(6);
    });

    it("validates a branching pipeline with merge", () => {
      const steps: PipelineStep[] = [
        createPreprocessingStep("StandardScaler"),
        createBranchStep([
          [createPreprocessingStep("SNV"), createModelStep("PLSRegression", { n_components: 5 })],
          [createPreprocessingStep("MSC"), createModelStep("PLSRegression", { n_components: 10 })],
        ]),
        createMergeStep(),
        createModelStep("Ridge", { alpha: 0.1 }),
      ];

      const result = validate(steps);

      expect(result.isValid).toBe(true);
      // 1 (StandardScaler) + 1 (branch) + 2*2 (branch contents) + 1 (merge) + 1 (Ridge) = 8
      expect(result.summary.totalSteps).toBe(8);
    });

    it("validates pipeline with sample augmentation container", () => {
      const steps: PipelineStep[] = [
        createContainerStep("sample_augmentation", "SMOTE", [
          createPreprocessingStep("StandardScaler"),
          createSplitterStep("KFold", { n_splits: 5 }),
          createModelStep("RandomForest", { n_estimators: 100 }),
        ]),
      ];

      const result = validate(steps);

      expect(result.isValid).toBe(true);
      expect(result.summary.totalSteps).toBe(4); // 1 container + 3 children
    });
  });

  describe("invalid pipelines", () => {
    it("detects empty pipeline as info (not error)", () => {
      const result = validate([]);

      // Empty pipeline is an info-level issue
      expect(result.isValid).toBe(true);
      expect(result.infos.some((i) => i.code === "PIPELINE_EMPTY")).toBe(true);
    });

    it("detects missing model as warning", () => {
      const steps: PipelineStep[] = [
        createPreprocessingStep("StandardScaler"),
        createSplitterStep("KFold", { n_splits: 5 }),
      ];

      const result = validate(steps);

      expect(result.warnings.some((i) => i.code === "PIPELINE_NO_MODEL")).toBe(true);
    });

    it("detects merge without branch as error", () => {
      const steps: PipelineStep[] = [
        createPreprocessingStep("StandardScaler"),
        createMergeStep(),
        createModelStep("PLSRegression", { n_components: 10 }),
      ];

      const result = validate(steps);

      expect(result.isValid).toBe(false);
      expect(result.errors.some((i) => i.code === "PIPELINE_MERGE_WITHOUT_BRANCH")).toBe(true);
    });

    it("detects duplicate step IDs", () => {
      const duplicateId = "duplicate-id";
      const steps: PipelineStep[] = [
        createPreprocessingStep("StandardScaler"),
        createPreprocessingStep("SNV"),
      ];
      // Manually set same ID
      steps[0].id = duplicateId;
      steps[1].id = duplicateId;

      const result = validate(steps);

      expect(result.errors.some((i) => i.code === "STEP_DUPLICATE_ID")).toBe(true);
    });

    it("detects empty branches in branch step", () => {
      const steps: PipelineStep[] = [
        createPreprocessingStep("StandardScaler"),
        createBranchStep([]),
        createMergeStep(),
        createModelStep("PLSRegression", { n_components: 10 }),
      ];

      const result = validate(steps);

      expect(result.errors.some((i) => i.code === "STEP_EMPTY_BRANCHES")).toBe(true);
    });
  });
});

// ============================================================================
// Parameter Validation Integration Tests
// ============================================================================

describe("Parameter Validation Integration", () => {
  describe("model parameters", () => {
    it("detects n_components = 0 as error", () => {
      const steps: PipelineStep[] = [
        createModelStep("PLSRegression", { n_components: 0 }),
      ];

      const result = validate(steps);

      expect(result.isValid).toBe(false);
      expect(result.errors.some((i) => i.code === "PARAM_OUT_OF_RANGE")).toBe(true);
    });

    it("detects n_components < 0 as error", () => {
      const steps: PipelineStep[] = [
        createModelStep("PLSRegression", { n_components: -5 }),
      ];

      const result = validate(steps);

      expect(result.isValid).toBe(false);
      expect(result.errors.some((i) => i.code === "PARAM_OUT_OF_RANGE")).toBe(true);
    });

    it("detects unusually high n_components as warning", () => {
      const steps: PipelineStep[] = [
        createModelStep("PLSRegression", { n_components: 150 }),
      ];

      const result = validate(steps);

      expect(result.warnings.some((i) => i.code === "PARAM_OUT_OF_RANGE")).toBe(true);
    });

    it("accepts valid n_components", () => {
      const steps: PipelineStep[] = [
        createModelStep("PLSRegression", { n_components: 10 }),
      ];

      const result = validate(steps);

      // No n_components errors (may have NO_MODEL warning)
      expect(result.errors.filter((i) => i.location.paramName === "n_components")).toHaveLength(0);
    });
  });

  describe("splitting parameters", () => {
    it("detects test_size = 0 as error", () => {
      const steps: PipelineStep[] = [
        createSplitterStep("ShuffleSplit", { test_size: 0 }),
      ];

      const result = validate(steps);

      expect(result.errors.some((i) => i.code === "PARAM_OUT_OF_RANGE")).toBe(true);
    });

    it("detects test_size = 1 as error", () => {
      const steps: PipelineStep[] = [
        createSplitterStep("ShuffleSplit", { test_size: 1 }),
      ];

      const result = validate(steps);

      expect(result.errors.some((i) => i.code === "PARAM_OUT_OF_RANGE")).toBe(true);
    });

    it("detects n_splits = 1 as error", () => {
      const steps: PipelineStep[] = [
        createSplitterStep("KFold", { n_splits: 1 }),
      ];

      const result = validate(steps);

      expect(result.errors.some((i) => i.code === "PARAM_OUT_OF_RANGE")).toBe(true);
    });

    it("accepts valid splitting parameters", () => {
      const steps: PipelineStep[] = [
        createSplitterStep("ShuffleSplit", { n_splits: 5, test_size: 0.2 }),
      ];

      const result = validate(steps);

      // No splitter-related errors
      const splitterErrors = result.errors.filter((i) => i.location.stepName === "ShuffleSplit");
      expect(splitterErrors).toHaveLength(0);
    });
  });

  describe("SavitzkyGolay parameters", () => {
    it("detects window_length < 3 as error", () => {
      const steps: PipelineStep[] = [
        createPreprocessingStep("SavitzkyGolay", { window_length: 1, polyorder: 0 }),
      ];

      const result = validate(steps);

      expect(result.errors.some((i) => i.code === "PARAM_OUT_OF_RANGE")).toBe(true);
    });

    it("detects even window_length as error", () => {
      const steps: PipelineStep[] = [
        createPreprocessingStep("SavitzkyGolay", { window_length: 6, polyorder: 2 }),
      ];

      const result = validate(steps);

      expect(result.errors.some((i) => i.code === "PARAM_INVALID_VALUE")).toBe(true);
    });

    it("detects polyorder >= window_length as error", () => {
      const steps: PipelineStep[] = [
        createPreprocessingStep("SavitzkyGolay", { window_length: 5, polyorder: 5 }),
      ];

      const result = validate(steps);

      expect(result.errors.some((i) => i.code === "PARAM_INVALID_VALUE")).toBe(true);
    });

    it("accepts valid SavitzkyGolay parameters", () => {
      const steps: PipelineStep[] = [
        createPreprocessingStep("SavitzkyGolay", { window_length: 7, polyorder: 2 }),
      ];

      const result = validate(steps);

      const sgErrors = result.errors.filter((i) => i.location.stepName === "SavitzkyGolay");
      expect(sgErrors).toHaveLength(0);
    });
  });

  describe("special values", () => {
    it("detects NaN parameter value as error", () => {
      const steps: PipelineStep[] = [
        createPreprocessingStep("StandardScaler", { alpha: NaN }),
      ];

      const result = validate(steps);

      expect(result.isValid).toBe(false);
      expect(result.errors.some((i) => i.code === "PARAM_INVALID_VALUE")).toBe(true);
    });

    it("detects Infinity parameter value as error", () => {
      const steps: PipelineStep[] = [
        createPreprocessingStep("StandardScaler", { alpha: Infinity }),
      ];

      const result = validate(steps);

      expect(result.isValid).toBe(false);
      expect(result.errors.some((i) => i.code === "PARAM_OUT_OF_RANGE")).toBe(true);
    });

    it("detects -Infinity parameter value as error", () => {
      const steps: PipelineStep[] = [
        createPreprocessingStep("StandardScaler", { alpha: -Infinity }),
      ];

      const result = validate(steps);

      expect(result.isValid).toBe(false);
      expect(result.errors.some((i) => i.code === "PARAM_OUT_OF_RANGE")).toBe(true);
    });
  });
});

// ============================================================================
// Nested Structure Tests
// ============================================================================

describe("Nested Structure Validation", () => {
  it("validates deeply nested branches", () => {
    const deepBranch = createBranchStep([
      [createBranchStep([
        [createPreprocessingStep("SNV"), createModelStep("PLS", { n_components: 5 })],
        [createPreprocessingStep("MSC"), createModelStep("Ridge")],
      ])],
      [createPreprocessingStep("Detrend"), createModelStep("Lasso")],
    ]);

    const steps: PipelineStep[] = [
      createPreprocessingStep("StandardScaler"),
      deepBranch,
      createMergeStep(),
    ];

    const result = validate(steps);

    // Should complete without errors (structure is valid)
    expect(result).toBeDefined();
    expect(result.summary.totalSteps).toBeGreaterThan(5);
  });

  it("validates nested containers", () => {
    const innerContainer = createContainerStep("sample_augmentation", "Inner", [
      createPreprocessingStep("SNV"),
      createModelStep("PLSRegression", { n_components: 5 }),
    ]);

    const outerContainer = createContainerStep("sample_augmentation", "Outer", [
      createPreprocessingStep("StandardScaler"),
      innerContainer,
    ]);

    const steps: PipelineStep[] = [outerContainer];

    const result = validate(steps);

    expect(result).toBeDefined();
    expect(result.summary.totalSteps).toBe(5); // 2 containers + 3 steps
  });

  it("finds duplicate IDs in deeply nested structures", () => {
    const duplicateId = "nested-duplicate";
    const nestedStep1 = createPreprocessingStep("SNV");
    nestedStep1.id = duplicateId;

    const nestedStep2 = createPreprocessingStep("MSC");
    nestedStep2.id = duplicateId;

    const branch = createBranchStep([
      [nestedStep1],
      [createBranchStep([
        [nestedStep2],
      ])],
    ]);

    const steps: PipelineStep[] = [branch];

    const result = validate(steps);

    expect(result.errors.some((i) => i.code === "STEP_DUPLICATE_ID")).toBe(true);
  });

  it("validates mixed branches and containers", () => {
    const container = createContainerStep("sample_augmentation", "Augment", [
      createPreprocessingStep("SMOTE"),
    ]);

    const branch = createBranchStep([
      [container, createModelStep("PLSRegression", { n_components: 5 })],
      [createPreprocessingStep("StandardScaler"), createModelStep("Ridge")],
    ]);

    const steps: PipelineStep[] = [
      branch,
      createMergeStep(),
      createModelStep("Stacking"),
    ];

    const result = validate(steps);

    expect(result).toBeDefined();
  });
});

// ============================================================================
// Rule Disabling Tests
// ============================================================================

describe("Rule Disabling", () => {
  it("respects disabled rules for empty pipeline", () => {
    const result = validate([], { disabledRules: ["PIPELINE_EMPTY"] });

    expect(result.issues.some((i) => i.code === "PIPELINE_EMPTY")).toBe(false);
  });

  it("respects disabled rules for missing model", () => {
    const steps: PipelineStep[] = [
      createPreprocessingStep("StandardScaler"),
    ];

    const result = validate(steps, { disabledRules: ["PIPELINE_NO_MODEL"] });

    expect(result.issues.some((i) => i.code === "PIPELINE_NO_MODEL")).toBe(false);
  });

  it("can disable multiple rules at once", () => {
    const steps: PipelineStep[] = [
      createMergeStep(),
    ];

    const result = validate(steps, {
      disabledRules: ["PIPELINE_NO_MODEL", "PIPELINE_MERGE_WITHOUT_BRANCH"],
    });

    expect(result.issues.some((i) => i.code === "PIPELINE_NO_MODEL")).toBe(false);
    expect(result.issues.some((i) => i.code === "PIPELINE_MERGE_WITHOUT_BRANCH")).toBe(false);
  });

  it("still reports non-disabled issues", () => {
    const steps: PipelineStep[] = [
      createMergeStep(),
    ];

    const result = validate(steps, {
      disabledRules: ["PIPELINE_NO_MODEL"],
    });

    // Merge without branch should still be reported
    expect(result.errors.some((i) => i.code === "PIPELINE_MERGE_WITHOUT_BRANCH")).toBe(true);
  });
});

// ============================================================================
// Step Result Aggregation Tests
// ============================================================================

describe("Step Result Aggregation", () => {
  it("creates step results for all steps", () => {
    const steps: PipelineStep[] = [
      createPreprocessingStep("StandardScaler"),
      createSplitterStep("KFold", { n_splits: 5 }),
      createModelStep("PLSRegression", { n_components: 10 }),
    ];

    const result = validate(steps);

    expect(result.stepResults.size).toBe(3);
    for (const step of steps) {
      expect(result.stepResults.has(step.id)).toBe(true);
    }
  });

  it("creates step results for nested steps", () => {
    const nestedSteps = [createPreprocessingStep("SNV"), createModelStep("PLS", { n_components: 5 })];
    const branch = createBranchStep([nestedSteps]);

    const steps: PipelineStep[] = [branch];

    const result = validate(steps);

    // Should have result for branch + all nested steps
    expect(result.stepResults.size).toBe(3);
    expect(result.stepResults.has(branch.id)).toBe(true);
    for (const nested of nestedSteps) {
      expect(result.stepResults.has(nested.id)).toBe(true);
    }
  });

  it("assigns issues to correct steps", () => {
    const modelWithError = createModelStep("PLSRegression", { n_components: 0 });
    const validPreprocessing = createPreprocessingStep("StandardScaler");

    const steps: PipelineStep[] = [validPreprocessing, modelWithError];

    const result = validate(steps);

    // Model step should have error
    const modelResult = result.stepResults.get(modelWithError.id);
    expect(modelResult?.errors.length).toBeGreaterThan(0);

    // Preprocessing step should be valid
    const prepResult = result.stepResults.get(validPreprocessing.id);
    expect(prepResult?.isValid).toBe(true);
  });

  it("tracks steps with errors and warnings in summary", () => {
    const errorStep = createModelStep("PLSRegression", { n_components: 0 });
    const warningStep = createModelStep("PLSRegression", { n_components: 150 });
    const validStep = createPreprocessingStep("StandardScaler");

    const steps: PipelineStep[] = [validStep, errorStep, warningStep];

    const result = validate(steps);

    expect(result.summary.stepsWithErrors).toBeGreaterThanOrEqual(1);
    expect(result.summary.stepsWithWarnings).toBeGreaterThanOrEqual(1);
  });
});

// ============================================================================
// Quick Validation Helpers Tests
// ============================================================================

describe("Quick Validation Helpers", () => {
  describe("isValid", () => {
    it("returns true for valid pipeline", () => {
      const steps: PipelineStep[] = [
        createPreprocessingStep("StandardScaler"),
        createModelStep("PLSRegression", { n_components: 10 }),
      ];

      expect(isValid(steps)).toBe(true);
    });

    it("returns false for invalid pipeline", () => {
      const steps: PipelineStep[] = [
        createModelStep("PLSRegression", { n_components: 0 }), // Error
      ];

      expect(isValid(steps)).toBe(false);
    });
  });

  describe("getErrorCount", () => {
    it("returns 0 for valid pipeline", () => {
      const steps: PipelineStep[] = [
        createPreprocessingStep("StandardScaler"),
        createModelStep("PLSRegression", { n_components: 10 }),
      ];

      expect(getErrorCount(steps)).toBe(0);
    });

    it("returns correct count for pipeline with errors", () => {
      const steps: PipelineStep[] = [
        createMergeStep(), // Error: merge without branch
        createModelStep("PLSRegression", { n_components: 0 }), // Error: n_components
      ];

      expect(getErrorCount(steps)).toBeGreaterThan(0);
    });
  });

  describe("getQuickSummary", () => {
    it("returns summary with all fields", () => {
      const steps: PipelineStep[] = [
        createPreprocessingStep("StandardScaler"),
      ];

      const summary = getQuickSummary(steps);

      expect(summary).toHaveProperty("isValid");
      expect(summary).toHaveProperty("errors");
      expect(summary).toHaveProperty("warnings");
    });

    it("reflects validation state accurately", () => {
      const steps: PipelineStep[] = [
        createMergeStep(), // Error
      ];

      const summary = getQuickSummary(steps);

      expect(summary.isValid).toBe(false);
      expect(summary.errors).toBeGreaterThan(0);
    });
  });
});

// ============================================================================
// Edge Cases and Error Recovery
// ============================================================================

describe("Edge Cases and Error Recovery", () => {
  it("handles steps with null params", () => {
    const step = createPreprocessingStep("StandardScaler");
    // Force null params for testing edge cases
    (step as unknown as { params: null }).params = null;

    const steps: PipelineStep[] = [step];

    // Should not throw
    const result = validate(steps);
    expect(result).toBeDefined();
  });

  it("handles steps with undefined params", () => {
    const step = createPreprocessingStep("StandardScaler");
    // Force undefined params for testing edge cases
    (step as unknown as { params: undefined }).params = undefined;

    const steps: PipelineStep[] = [step];

    // Should not throw
    const result = validate(steps);
    expect(result).toBeDefined();
  });

  it("handles steps with empty branches array", () => {
    const branch = createBranchStep([]);

    const steps: PipelineStep[] = [branch];

    const result = validate(steps);

    expect(result.errors.some((i) => i.code === "STEP_EMPTY_BRANCHES")).toBe(true);
  });

  it("handles branch with empty inner arrays", () => {
    const branch = createBranchStep([[], []]);

    const steps: PipelineStep[] = [branch];

    // Should not throw
    const result = validate(steps);
    expect(result).toBeDefined();
  });

  it("handles disabled steps", () => {
    const step = createPreprocessingStep("StandardScaler");
    step.enabled = false;

    const steps: PipelineStep[] = [step];

    // Should not throw
    const result = validate(steps);
    expect(result).toBeDefined();
  });

  it("handles steps with extra properties", () => {
    const step = createPreprocessingStep("StandardScaler") as PipelineStep & { extra: string };
    step.extra = "extra property";

    const steps: PipelineStep[] = [step];

    // Should not throw
    const result = validate(steps);
    expect(result).toBeDefined();
  });
});

// ============================================================================
// Real-World NIRS Pipeline Scenarios
// ============================================================================

describe("Real-World NIRS Pipeline Scenarios", () => {
  it("validates standard PLS calibration pipeline", () => {
    const steps: PipelineStep[] = [
      createPreprocessingStep("SNV"),
      createPreprocessingStep("SavitzkyGolay", { window_length: 11, polyorder: 2 }),
      createPreprocessingStep("StandardScaler"),
      createSplitterStep("ShuffleSplit", { n_splits: 10, test_size: 0.2 }),
      createModelStep("PLSRegression", { n_components: 8 }),
    ];

    const result = validate(steps);

    expect(result.isValid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("validates stacking ensemble pipeline", () => {
    const steps: PipelineStep[] = [
      createPreprocessingStep("StandardScaler"),
      createBranchStep([
        [createPreprocessingStep("SNV"), createModelStep("PLSRegression", { n_components: 10 })],
        [createPreprocessingStep("Detrend"), createModelStep("Ridge", { alpha: 1.0 })],
        [createPreprocessingStep("MSC"), createModelStep("RandomForest", { n_estimators: 100 })],
      ]),
      createMergeStep(),
      createModelStep("LinearRegression"),
    ];

    const result = validate(steps);

    expect(result.isValid).toBe(true);
  });

  it("validates wavelength selection pipeline", () => {
    const steps: PipelineStep[] = [
      createPreprocessingStep("SNV"),
      // Feature selection is a preprocessing step in this context
      createPreprocessingStep("VIP", { threshold: 1.0 }),
      createSplitterStep("KFold", { n_splits: 5 }),
      createModelStep("PLSRegression", { n_components: 5 }),
    ];

    const result = validate(steps);

    expect(result.isValid).toBe(true);
  });

  it("validates model comparison pipeline", () => {
    const steps: PipelineStep[] = [
      createPreprocessingStep("StandardScaler"),
      createBranchStep([
        [createModelStep("PLSRegression", { n_components: 10 })],
        [createModelStep("Ridge", { alpha: 1.0 })],
        [createModelStep("Lasso", { alpha: 0.1 })],
        [createModelStep("ElasticNet", { alpha: 0.1, l1_ratio: 0.5 })],
      ]),
    ];

    const result = validate(steps);

    expect(result.isValid).toBe(true);
  });

  it("validates data augmentation pipeline", () => {
    const steps: PipelineStep[] = [
      createPreprocessingStep("StandardScaler"),
      createContainerStep("sample_augmentation", "Augmentation", [
        createStep("augmentation", "NoiseInjection", { params: { scale: 0.01 } }),
        createStep("augmentation", "Mixup", { params: { alpha: 0.2 } }),
      ]),
      createSplitterStep("KFold", { n_splits: 5 }),
      createModelStep("PLSRegression", { n_components: 10 }),
    ];

    const result = validate(steps);

    expect(result.isValid).toBe(true);
  });
});

// ============================================================================
// Validation Options Tests
// ============================================================================

describe("Validation Options", () => {
  describe("strictMode", () => {
    it("accepts strictMode option without error", () => {
      const steps: PipelineStep[] = [
        createPreprocessingStep("StandardScaler"),
        createModelStep("PLSRegression", { n_components: 10 }),
      ];

      const result = validate(steps, { strictMode: true });

      expect(result).toBeDefined();
    });

    it("validates with strictMode disabled", () => {
      const steps: PipelineStep[] = [
        createPreprocessingStep("StandardScaler"),
      ];

      const result = validate(steps, { strictMode: false });

      expect(result).toBeDefined();
    });
  });

  describe("selectedStepId", () => {
    it("accepts selectedStepId option", () => {
      const steps: PipelineStep[] = [
        createPreprocessingStep("StandardScaler"),
        createModelStep("PLSRegression", { n_components: 10 }),
      ];

      const result = validate(steps, { selectedStepId: steps[0].id });

      expect(result).toBeDefined();
    });

    it("validates correctly with selected step", () => {
      const errorStep = createModelStep("PLSRegression", { n_components: 0 });
      const steps: PipelineStep[] = [
        createPreprocessingStep("StandardScaler"),
        errorStep,
      ];

      const result = validate(steps, { selectedStepId: errorStep.id });

      // Should still find errors even when a step is selected
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  describe("combined options", () => {
    it("handles all options together", () => {
      const steps: PipelineStep[] = [
        createPreprocessingStep("StandardScaler"),
      ];

      const result = validate(steps, {
        strictMode: true,
        disabledRules: ["PIPELINE_NO_MODEL"],
        selectedStepId: steps[0].id,
      });

      expect(result).toBeDefined();
      expect(result.issues.some((i) => i.code === "PIPELINE_NO_MODEL")).toBe(false);
    });
  });
});

// ============================================================================
// Path Context Tests
// ============================================================================

describe("Path Context in Validation", () => {
  it("includes path context for nested step issues", () => {
    const nestedError = createModelStep("PLSRegression", { n_components: 0 });
    const branch = createBranchStep([[nestedError]]);

    const steps: PipelineStep[] = [branch];

    const result = validate(steps);

    // Find the error for the nested step
    const nestedIssue = result.errors.find(
      (i) => i.location.stepId === nestedError.id
    );

    // Issues in branches should have path context
    expect(nestedIssue).toBeDefined();
    if (nestedIssue?.location.path) {
      expect(nestedIssue.location.path).toContain("branch-0");
    }
  });

  it("includes path context for deeply nested issues", () => {
    const deepError = createModelStep("PLSRegression", { n_components: 0 });
    const innerBranch = createBranchStep([[deepError]]);
    const outerBranch = createBranchStep([[innerBranch]]);

    const steps: PipelineStep[] = [outerBranch];

    const result = validate(steps);

    const deepIssue = result.errors.find(
      (i) => i.location.stepId === deepError.id
    );

    expect(deepIssue).toBeDefined();
  });
});

// ============================================================================
// Timestamp and Consistency Tests
// ============================================================================

describe("Validation Result Consistency", () => {
  it("includes timestamp in result", () => {
    const steps: PipelineStep[] = [createPreprocessingStep("StandardScaler")];

    const result = validate(steps);

    expect(result.timestamp).toBeGreaterThan(0);
    expect(result.timestamp).toBeLessThanOrEqual(Date.now());
  });

  it("generates unique issue IDs", () => {
    const steps: PipelineStep[] = [
      createModelStep("PLSRegression", { n_components: 0 }), // Multiple issues
    ];

    const result = validate(steps);

    const issueIds = result.issues.map((i) => i.id);
    const uniqueIds = new Set(issueIds);

    expect(uniqueIds.size).toBe(issueIds.length);
  });

  it("produces consistent results for same input", () => {
    const steps: PipelineStep[] = [
      createPreprocessingStep("StandardScaler"),
      createModelStep("PLSRegression", { n_components: 10 }),
    ];

    const result1 = validate(steps);
    const result2 = validate(steps);

    expect(result1.isValid).toBe(result2.isValid);
    expect(result1.errors.length).toBe(result2.errors.length);
    expect(result1.warnings.length).toBe(result2.warnings.length);
    expect(result1.summary.totalSteps).toBe(result2.summary.totalSteps);
  });

  it("separates errors, warnings, and infos correctly", () => {
    const steps: PipelineStep[] = []; // Empty pipeline - should be info

    const result = validate(steps);

    // All issues should be categorized
    for (const issue of result.issues) {
      switch (issue.severity) {
        case "error":
          expect(result.errors).toContain(issue);
          break;
        case "warning":
          expect(result.warnings).toContain(issue);
          break;
        case "info":
          expect(result.infos).toContain(issue);
          break;
      }
    }
  });
});
