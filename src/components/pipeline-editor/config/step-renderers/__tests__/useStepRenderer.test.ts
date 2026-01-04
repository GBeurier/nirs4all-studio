/**
 * Step Renderer Utilities Tests
 *
 * Tests for the renderer utilities (getAvailableStepTypes, stepTypeUsesParameterProps).
 * Note: useStepRenderer is a React hook and requires component context to test.
 * Hook behavior is verified through the utility functions and integration tests.
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
  // All step types that should be supported
  const allStepTypes: StepType[] = [
    "preprocessing",
    "splitting",
    "filter",
    "augmentation",
    "model",
    "merge",
    "y_processing",
    "chart",
    "comment",
    "sample_augmentation",
    "feature_augmentation",
    "sample_filter",
    "concat_transform",
    "generator",
    "branch",
  ];

  describe("step type coverage", () => {
    it("should have all expected step types registered", () => {
      const registeredTypes = getAvailableStepTypes();
      allStepTypes.forEach((type) => {
        expect(registeredTypes).toContain(type);
      });
    });

    it("should return at least 14 step types", () => {
      const types = getAvailableStepTypes();
      expect(types.length).toBeGreaterThanOrEqual(14);
    });
  });

  describe("parameter props configuration", () => {
    const typesWithParameterProps: StepType[] = [
      "preprocessing",
      "splitting",
      "filter",
      "augmentation",
      "model",
      "merge",
      "generator",
      "branch",
    ];

    const typesWithoutParameterProps: StepType[] = [
      "y_processing",
      "chart",
      "comment",
      "sample_augmentation",
      "feature_augmentation",
      "sample_filter",
      "concat_transform",
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

  it("should include all expected step types", () => {
    const types = getAvailableStepTypes();
    const expectedTypes: StepType[] = [
      "preprocessing",
      "splitting",
      "model",
      "merge",
    ];

    expectedTypes.forEach((expected) => {
      expect(types).toContain(expected);
    });
  });

  it("should include container types", () => {
    const types = getAvailableStepTypes();
    const containerTypes: StepType[] = [
      "sample_augmentation",
      "feature_augmentation",
      "sample_filter",
      "concat_transform",
    ];

    containerTypes.forEach((type) => {
      expect(types).toContain(type);
    });
  });

  it("should return all registered types", () => {
    const types = getAvailableStepTypes();
    // Should have at least 14 types based on the registry
    expect(types.length).toBeGreaterThanOrEqual(14);
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

  it("should return false for chart", () => {
    expect(stepTypeUsesParameterProps("chart")).toBe(false);
  });

  it("should return false for comment", () => {
    expect(stepTypeUsesParameterProps("comment")).toBe(false);
  });

  it("should return false for container types", () => {
    expect(stepTypeUsesParameterProps("sample_augmentation")).toBe(false);
    expect(stepTypeUsesParameterProps("feature_augmentation")).toBe(false);
    expect(stepTypeUsesParameterProps("sample_filter")).toBe(false);
    expect(stepTypeUsesParameterProps("concat_transform")).toBe(false);
  });

  it("should return boolean for all step types", () => {
    const types = getAvailableStepTypes();
    types.forEach((type) => {
      const result = stepTypeUsesParameterProps(type);
      expect(typeof result).toBe("boolean");
    });
  });
});
