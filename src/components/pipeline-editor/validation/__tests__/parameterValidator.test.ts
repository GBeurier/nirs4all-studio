/**
 * Validation System Unit Tests
 *
 * Tests for parameter, step, and pipeline validation.
 * Covers edge cases and error code verification.
 */

import { describe, it, expect } from "vitest";
import type { PipelineStep, StepType } from "../../types";
import type { ParameterDefinition } from "@/data/nodes/types";
import type { ValidationLocation } from "../types";
import {
  validateParameter,
  createParameterIssue,
  isParameterValid,
} from "../parameterValidator";

// ============================================================================
// Test Fixtures
// ============================================================================

function createMockStep(overrides: Partial<PipelineStep> = {}): PipelineStep {
  return {
    id: "test-step-1",
    name: "TestStep",
    type: "preprocessing" as StepType,
    enabled: true,
    params: {},
    ...overrides,
  };
}

function createParamDef(
  overrides: Partial<ParameterDefinition> = {}
): ParameterDefinition {
  return {
    name: "test_param",
    type: "int",
    default: 10,
    required: false,
    description: "A test parameter",
    ...overrides,
  };
}

function createLocation(overrides: Partial<ValidationLocation> = {}): ValidationLocation {
  return {
    stepId: "test-step-1",
    stepName: "TestStep",
    stepType: "preprocessing",
    paramName: "test_param",
    ...overrides,
  };
}

// ============================================================================
// Parameter Validation Tests
// ============================================================================

describe("validateParameter", () => {
  describe("required parameters", () => {
    it("should return error for missing required parameter", () => {
      const step = createMockStep({ params: {} });
      const def = createParamDef({ name: "required_param", required: true });

      const issues = validateParameter("required_param", undefined, def, step);

      expect(issues.length).toBe(1);
      expect(issues[0].code).toBe("PARAM_REQUIRED");
      expect(issues[0].severity).toBe("error");
    });

    it("should not error for missing optional parameter", () => {
      const step = createMockStep({ params: {} });
      const def = createParamDef({ name: "optional_param", required: false });

      const issues = validateParameter("optional_param", undefined, def, step);

      expect(issues.length).toBe(0);
    });

    it("should not error for present required parameter", () => {
      const step = createMockStep({ params: { required_param: 5 } });
      const def = createParamDef({ name: "required_param", required: true });

      const issues = validateParameter("required_param", 5, def, step);

      expect(issues.length).toBe(0);
    });
  });

  describe("type validation", () => {
    it("should validate integer type", () => {
      const step = createMockStep({ params: { n_components: 10 } });
      const def = createParamDef({ name: "n_components", type: "int" });

      const issues = validateParameter("n_components", 10, def, step);
      expect(issues.length).toBe(0);
    });

    it("should error for float when int expected", () => {
      const step = createMockStep({ params: { n_components: 10.5 } });
      const def = createParamDef({ name: "n_components", type: "int" });

      const issues = validateParameter("n_components", 10.5, def, step);

      expect(issues.some((i) => i.code === "PARAM_TYPE_MISMATCH")).toBe(true);
    });

    it("should validate float type", () => {
      const step = createMockStep({ params: { alpha: 0.5 } });
      const def = createParamDef({ name: "alpha", type: "float" });

      const issues = validateParameter("alpha", 0.5, def, step);
      expect(issues.length).toBe(0);
    });

    it("should allow int for float type", () => {
      const step = createMockStep({ params: { alpha: 1 } });
      const def = createParamDef({ name: "alpha", type: "float" });

      const issues = validateParameter("alpha", 1, def, step);
      expect(issues.length).toBe(0);
    });

    it("should validate boolean type", () => {
      const step = createMockStep({ params: { normalize: true } });
      const def = createParamDef({ name: "normalize", type: "bool" });

      const issues = validateParameter("normalize", true, def, step);
      expect(issues.length).toBe(0);
    });

    it("should error for non-boolean when bool expected", () => {
      const step = createMockStep({ params: { normalize: "yes" } });
      const def = createParamDef({ name: "normalize", type: "bool" });

      const issues = validateParameter("normalize", "yes", def, step);
      expect(issues.some((i) => i.code === "PARAM_TYPE_MISMATCH")).toBe(true);
    });

    it("should validate string type", () => {
      const step = createMockStep({ params: { kernel: "rbf" } });
      const def = createParamDef({ name: "kernel", type: "string" });

      const issues = validateParameter("kernel", "rbf", def, step);
      expect(issues.length).toBe(0);
    });
  });

  describe("range validation", () => {
    it("should error for value below minimum", () => {
      const step = createMockStep({ params: { n_components: 0 } });
      const def = createParamDef({
        name: "n_components",
        type: "int",
        min: 1,
        max: 100,
      });

      const issues = validateParameter("n_components", 0, def, step);

      expect(issues.some((i) => i.code === "PARAM_OUT_OF_RANGE")).toBe(true);
    });

    it("should error for value above maximum", () => {
      const step = createMockStep({ params: { n_components: 150 } });
      const def = createParamDef({
        name: "n_components",
        type: "int",
        min: 1,
        max: 100,
      });

      const issues = validateParameter("n_components", 150, def, step);

      expect(issues.some((i) => i.code === "PARAM_OUT_OF_RANGE")).toBe(true);
    });

    it("should accept value at minimum boundary", () => {
      const step = createMockStep({ params: { n_components: 1 } });
      const def = createParamDef({
        name: "n_components",
        type: "int",
        min: 1,
        max: 100,
      });

      const issues = validateParameter("n_components", 1, def, step);
      expect(issues.length).toBe(0);
    });

    it("should accept value at maximum boundary", () => {
      const step = createMockStep({ params: { n_components: 100 } });
      const def = createParamDef({
        name: "n_components",
        type: "int",
        min: 1,
        max: 100,
      });

      const issues = validateParameter("n_components", 100, def, step);
      expect(issues.length).toBe(0);
    });
  });

  describe("choice validation", () => {
    it("should accept valid choice value", () => {
      const step = createMockStep({ params: { kernel: "rbf" } });
      const def = createParamDef({
        name: "kernel",
        type: "select",
        options: [
          { value: "linear", label: "Linear" },
          { value: "rbf", label: "RBF" },
          { value: "poly", label: "Polynomial" },
        ],
      });

      const issues = validateParameter("kernel", "rbf", def, step);
      expect(issues.length).toBe(0);
    });

    it("should error for invalid choice value", () => {
      const step = createMockStep({ params: { kernel: "invalid" } });
      const def = createParamDef({
        name: "kernel",
        type: "select",
        options: [
          { value: "linear", label: "Linear" },
          { value: "rbf", label: "RBF" },
          { value: "poly", label: "Polynomial" },
        ],
      });

      const issues = validateParameter("kernel", "invalid", def, step);

      expect(issues.some((i) => i.code === "PARAM_INVALID_VALUE")).toBe(true);
    });
  });
});

describe("isParameterValid", () => {
  it("should return true for valid parameter", () => {
    const step = createMockStep({ params: { n_components: 10 } });
    const def = createParamDef({
      name: "n_components",
      type: "int",
      min: 1,
      max: 100,
    });

    expect(isParameterValid("n_components", 10, def, step)).toBe(true);
  });

  it("should return false for invalid parameter", () => {
    const step = createMockStep({ params: { n_components: 0 } });
    const def = createParamDef({
      name: "n_components",
      type: "int",
      min: 1,
      max: 100,
    });

    expect(isParameterValid("n_components", 0, def, step)).toBe(false);
  });
});

describe("createParameterIssue", () => {
  it("should create issue with correct properties", () => {
    const location = createLocation();
    const issue = createParameterIssue(
      "PARAM_REQUIRED",
      "error",
      "Parameter is required",
      location
    );

    expect(issue.code).toBe("PARAM_REQUIRED");
    expect(issue.severity).toBe("error");
    expect(issue.message).toBe("Parameter is required");
    expect(issue.location.stepId).toBe("test-step-1");
    expect(issue.location.paramName).toBe("test_param");
    expect(issue.category).toBe("parameter");
  });

  it("should include suggestion when provided", () => {
    const location = createLocation();
    const issue = createParameterIssue(
      "PARAM_REQUIRED",
      "error",
      "Parameter is required",
      location,
      { suggestion: "Set a value for this parameter" }
    );

    expect(issue.suggestion).toBe("Set a value for this parameter");
  });
});
