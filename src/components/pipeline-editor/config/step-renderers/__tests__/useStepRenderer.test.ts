/**
 * Step Renderer Utilities Tests
 *
 * Tests for the renderer utilities (getAvailableStepTypes, stepTypeUsesParameterProps).
 * Note: useStepRenderer is a React hook and requires component context to test.
 * Hook behavior is verified through the utility functions and integration tests.
 *
 * Updated for Phase 4 taxonomy consolidation (16 types -> 8 types + subTypes).
 */

import { describe, it, expect } from "vitest";
import {
  getAvailableStepTypes,
  stepTypeUsesParameterProps,
} from "../useStepRenderer";
import type { StepType } from "../../../types";

// ============================================================================
// Renderer Configuration Tests (via utility functions)
// ============================================================================

describe("renderer configuration", () => {
  // The 8 consolidated step types
  const allStepTypes: StepType[] = [
    "preprocessing",
    "splitting",
    "filter",
    "augmentation",
    "model",
    "y_processing",
    "flow",
    "utility",
  ];

  describe("step type coverage", () => {
    it("should have all expected step types registered", () => {
      const registeredTypes = getAvailableStepTypes();
      allStepTypes.forEach((type) => {
        expect(registeredTypes).toContain(type);
      });
    });

    it("should return exactly 8 step types", () => {
      const types = getAvailableStepTypes();
      expect(types.length).toBe(8);
    });
  });

  describe("parameter props configuration", () => {
    const typesWithParameterProps: StepType[] = [
      "preprocessing",
      "splitting",
      "filter",
      "augmentation",
      "model",
    ];

    const typesWithoutParameterProps: StepType[] = [
      "y_processing",
    ];

    typesWithParameterProps.forEach((type) => {
      it(`should configure ${type} to use parameter props`, () => {
        expect(stepTypeUsesParameterProps(type)).toBe(true);
      });
    });

    typesWithoutParameterProps.forEach((type) => {
      it(`should configure ${type} to not use parameter props`, () => {
        expect(stepTypeUsesParameterProps(type)).toBe(false);
      });
    });
  });

  describe("subType parameter props configuration", () => {
    it("should configure flow sub-types correctly via subType", () => {
      // branch, merge use parameter props
      expect(stepTypeUsesParameterProps("flow", "branch")).toBe(true);
      expect(stepTypeUsesParameterProps("flow", "merge")).toBe(true);

      // Generator and container sub-types do not use parameter props
      expect(stepTypeUsesParameterProps("flow", "generator")).toBe(false);
      expect(stepTypeUsesParameterProps("flow", "sample_augmentation")).toBe(false);
      expect(stepTypeUsesParameterProps("flow", "feature_augmentation")).toBe(false);
      expect(stepTypeUsesParameterProps("flow", "sample_filter")).toBe(false);
      expect(stepTypeUsesParameterProps("flow", "concat_transform")).toBe(false);
    });

    it("should configure utility sub-types correctly via subType", () => {
      expect(stepTypeUsesParameterProps("utility", "chart")).toBe(false);
      expect(stepTypeUsesParameterProps("utility", "comment")).toBe(false);
    });
  });
});

// ============================================================================
// getAvailableStepTypes Tests
// ============================================================================

describe("getAvailableStepTypes", () => {
  it("should return an array of step types", () => {
    const types = getAvailableStepTypes();
    expect(Array.isArray(types)).toBe(true);
    expect(types.length).toBeGreaterThan(0);
  });

  it("should include all core step types", () => {
    const types = getAvailableStepTypes();
    const expectedTypes: StepType[] = [
      "preprocessing",
      "splitting",
      "model",
      "flow",
      "utility",
    ];

    expectedTypes.forEach((expected) => {
      expect(types).toContain(expected);
    });
  });

  it("should include flow and utility as consolidated types", () => {
    const types = getAvailableStepTypes();
    expect(types).toContain("flow");
    expect(types).toContain("utility");
  });

  it("should return exactly 8 consolidated types", () => {
    const types = getAvailableStepTypes();
    expect(types.length).toBe(8);
  });
});

// ============================================================================
// stepTypeUsesParameterProps Tests
// ============================================================================

describe("stepTypeUsesParameterProps", () => {
  it("should return true for preprocessing", () => {
    expect(stepTypeUsesParameterProps("preprocessing")).toBe(true);
  });

  it("should return true for splitting", () => {
    expect(stepTypeUsesParameterProps("splitting")).toBe(true);
  });

  it("should return true for model", () => {
    expect(stepTypeUsesParameterProps("model")).toBe(true);
  });

  it("should return false for chart via subType", () => {
    expect(stepTypeUsesParameterProps("utility", "chart")).toBe(false);
  });

  it("should return false for comment via subType", () => {
    expect(stepTypeUsesParameterProps("utility", "comment")).toBe(false);
  });

  it("should return false for container sub-types", () => {
    expect(stepTypeUsesParameterProps("flow", "sample_augmentation")).toBe(false);
    expect(stepTypeUsesParameterProps("flow", "feature_augmentation")).toBe(false);
    expect(stepTypeUsesParameterProps("flow", "sample_filter")).toBe(false);
    expect(stepTypeUsesParameterProps("flow", "concat_transform")).toBe(false);
  });

  it("should return boolean for all step types", () => {
    const types = getAvailableStepTypes();
    types.forEach((type) => {
      const result = stepTypeUsesParameterProps(type);
      expect(typeof result).toBe("boolean");
    });
  });
});
