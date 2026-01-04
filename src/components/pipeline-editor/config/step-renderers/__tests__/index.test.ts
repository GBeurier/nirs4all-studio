/**
 * Step Renderers Module Export Tests
 *
 * Tests to verify all step renderers and utilities are properly exported.
 */

import { describe, it, expect } from "vitest";
import * as StepRenderers from "../index";

// ============================================================================
// Module Export Tests
// ============================================================================

describe("step-renderers module exports", () => {
  describe("hook exports", () => {
    it("should export useStepRenderer hook", () => {
      expect(StepRenderers.useStepRenderer).toBeDefined();
      expect(typeof StepRenderers.useStepRenderer).toBe("function");
    });

    it("should export getAvailableStepTypes utility", () => {
      expect(StepRenderers.getAvailableStepTypes).toBeDefined();
      expect(typeof StepRenderers.getAvailableStepTypes).toBe("function");
    });

    it("should export stepTypeUsesParameterProps utility", () => {
      expect(StepRenderers.stepTypeUsesParameterProps).toBeDefined();
      expect(typeof StepRenderers.stepTypeUsesParameterProps).toBe("function");
    });
  });

  describe("component exports", () => {
    it("should export StepActions component", () => {
      expect(StepRenderers.StepActions).toBeDefined();
      expect(typeof StepRenderers.StepActions).toBe("function");
    });

    it("should export DefaultRenderer component", () => {
      expect(StepRenderers.DefaultRenderer).toBeDefined();
      expect(typeof StepRenderers.DefaultRenderer).toBe("function");
    });

    it("should export ModelRenderer component", () => {
      expect(StepRenderers.ModelRenderer).toBeDefined();
      expect(typeof StepRenderers.ModelRenderer).toBe("function");
    });

    it("should export MergeRenderer component", () => {
      expect(StepRenderers.MergeRenderer).toBeDefined();
      expect(typeof StepRenderers.MergeRenderer).toBe("function");
    });

    it("should export YProcessingRenderer component", () => {
      expect(StepRenderers.YProcessingRenderer).toBeDefined();
      expect(typeof StepRenderers.YProcessingRenderer).toBe("function");
    });

    it("should export ChartRenderer component", () => {
      expect(StepRenderers.ChartRenderer).toBeDefined();
      expect(typeof StepRenderers.ChartRenderer).toBe("function");
    });

    it("should export CommentRenderer component", () => {
      expect(StepRenderers.CommentRenderer).toBeDefined();
      expect(typeof StepRenderers.CommentRenderer).toBe("function");
    });
  });

  describe("container renderer exports", () => {
    it("should export SampleAugmentationRenderer component", () => {
      expect(StepRenderers.SampleAugmentationRenderer).toBeDefined();
      expect(typeof StepRenderers.SampleAugmentationRenderer).toBe("function");
    });

    it("should export FeatureAugmentationRenderer component", () => {
      expect(StepRenderers.FeatureAugmentationRenderer).toBeDefined();
      expect(typeof StepRenderers.FeatureAugmentationRenderer).toBe("function");
    });

    it("should export SampleFilterRenderer component", () => {
      expect(StepRenderers.SampleFilterRenderer).toBeDefined();
      expect(typeof StepRenderers.SampleFilterRenderer).toBe("function");
    });

    it("should export ConcatTransformRenderer component", () => {
      expect(StepRenderers.ConcatTransformRenderer).toBeDefined();
      expect(typeof StepRenderers.ConcatTransformRenderer).toBe("function");
    });
  });

  describe("export completeness", () => {
    it("should export all required components", () => {
      const requiredExports = [
        // Hooks & utilities
        "useStepRenderer",
        "getAvailableStepTypes",
        "stepTypeUsesParameterProps",
        // Shared components
        "StepActions",
        // Renderers
        "DefaultRenderer",
        "ModelRenderer",
        "MergeRenderer",
        "YProcessingRenderer",
        "ChartRenderer",
        "CommentRenderer",
        // Container renderers
        "SampleAugmentationRenderer",
        "FeatureAugmentationRenderer",
        "SampleFilterRenderer",
        "ConcatTransformRenderer",
      ];

      const exports = Object.keys(StepRenderers);
      requiredExports.forEach((name) => {
        expect(exports).toContain(name);
      });
    });
  });
});

// ============================================================================
// Utility Function Tests
// ============================================================================

describe("utility functions integration", () => {
  it("getAvailableStepTypes should return consistent results with stepTypeUsesParameterProps", () => {
    const types = StepRenderers.getAvailableStepTypes();

    types.forEach((type) => {
      const usesProps = StepRenderers.stepTypeUsesParameterProps(type);
      expect(typeof usesProps).toBe("boolean");
    });
  });
});
