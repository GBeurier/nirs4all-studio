/**
 * Shared Components Module Export Tests
 *
 * Tests to verify all shared components and types are properly exported.
 */

import { describe, it, expect } from "vitest";
import * as SharedComponents from "../index";

// ============================================================================
// Module Export Tests
// ============================================================================

describe("shared components module exports", () => {
  describe("ParameterInput exports", () => {
    it("should export ParameterInput component", () => {
      expect(SharedComponents.ParameterInput).toBeDefined();
      expect(typeof SharedComponents.ParameterInput).toBe("function");
    });

    it("should export formatParamLabel utility", () => {
      expect(SharedComponents.formatParamLabel).toBeDefined();
      expect(typeof SharedComponents.formatParamLabel).toBe("function");
    });
  });

  describe("ParameterSelect exports", () => {
    it("should export ParameterSelect component", () => {
      expect(SharedComponents.ParameterSelect).toBeDefined();
      expect(typeof SharedComponents.ParameterSelect).toBe("function");
    });
  });

  describe("ParameterSwitch exports", () => {
    it("should export ParameterSwitch component", () => {
      expect(SharedComponents.ParameterSwitch).toBeDefined();
      expect(typeof SharedComponents.ParameterSwitch).toBe("function");
    });
  });

  describe("CollapsibleSection exports", () => {
    it("should export CollapsibleSection component", () => {
      expect(SharedComponents.CollapsibleSection).toBeDefined();
      expect(typeof SharedComponents.CollapsibleSection).toBe("function");
    });
  });

  describe("InfoTooltip exports", () => {
    it("should export InfoTooltip component", () => {
      expect(SharedComponents.InfoTooltip).toBeDefined();
      expect(typeof SharedComponents.InfoTooltip).toBe("function");
    });
  });

  describe("ValidationMessage exports", () => {
    it("should export ValidationMessage component", () => {
      expect(SharedComponents.ValidationMessage).toBeDefined();
      expect(typeof SharedComponents.ValidationMessage).toBe("function");
    });

    it("should export InlineValidationMessage component", () => {
      expect(SharedComponents.InlineValidationMessage).toBeDefined();
      expect(typeof SharedComponents.InlineValidationMessage).toBe("function");
    });
  });

  describe("SharedComponentsDemo export", () => {
    it("should export SharedComponentsDemo component", () => {
      expect(SharedComponents.SharedComponentsDemo).toBeDefined();
      expect(typeof SharedComponents.SharedComponentsDemo).toBe("function");
    });
  });

  describe("utility functions", () => {
    it("formatParamLabel should correctly format parameter keys", () => {
      expect(SharedComponents.formatParamLabel("n_components")).toBe("n components");
      expect(SharedComponents.formatParamLabel("learningRate")).toBe("learning rate");
    });
  });
});

// ============================================================================
// Type Export Verification
// ============================================================================

describe("type exports (compile-time check)", () => {
  it("should have proper TypeScript types available", () => {
    // This test verifies the module structure is correct
    // TypeScript types are verified at compile time
    const exports = Object.keys(SharedComponents);

    // Components
    expect(exports).toContain("ParameterInput");
    expect(exports).toContain("ParameterSelect");
    expect(exports).toContain("ParameterSwitch");
    expect(exports).toContain("CollapsibleSection");
    expect(exports).toContain("InfoTooltip");
    expect(exports).toContain("ValidationMessage");
    expect(exports).toContain("InlineValidationMessage");

    // Utilities
    expect(exports).toContain("formatParamLabel");

    // Demo
    expect(exports).toContain("SharedComponentsDemo");
  });

  it("should have exactly the expected number of exports", () => {
    const exports = Object.keys(SharedComponents);
    // Components: 7 (ParameterInput, ParameterSelect, ParameterSwitch,
    //               CollapsibleSection, InfoTooltip, ValidationMessage, InlineValidationMessage)
    // Hooks: 1 (useParamInput)
    // Utilities: 2 (formatParamLabel, parameterInfo)
    // Demo: 1 (SharedComponentsDemo)
    // Total: 11
    expect(exports.length).toBe(11);
  });
});
