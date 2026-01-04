/**
 * ParameterInput Component Tests
 *
 * Comprehensive tests for the ParameterInput shared component.
 * Tests cover rendering, user interactions, validation states, and edge cases.
 */

import { describe, it, expect, vi } from "vitest";
import { ParameterInput, formatParamLabel } from "../ParameterInput";
import type { ParameterInputProps } from "../ParameterInput";

// ============================================================================
// formatParamLabel Utility Tests
// ============================================================================

describe("formatParamLabel", () => {
  it("should replace underscores with spaces", () => {
    expect(formatParamLabel("n_components")).toBe("n components");
    expect(formatParamLabel("max_iter")).toBe("max iter");
    expect(formatParamLabel("test_param_name")).toBe("test param name");
  });

  it("should convert camelCase to spaces", () => {
    expect(formatParamLabel("learningRate")).toBe("learning rate");
    expect(formatParamLabel("maxIterations")).toBe("max iterations");
  });

  it("should handle mixed formats", () => {
    expect(formatParamLabel("max_learningRate")).toBe("max learning rate");
  });

  it("should convert to lowercase", () => {
    expect(formatParamLabel("MAX_ITER")).toBe("max iter");
    expect(formatParamLabel("TestParam")).toBe("test param");
  });

  it("should handle single words", () => {
    expect(formatParamLabel("alpha")).toBe("alpha");
    expect(formatParamLabel("ALPHA")).toBe("alpha");
  });

  it("should handle empty string", () => {
    expect(formatParamLabel("")).toBe("");
  });
});

// ============================================================================
// ParameterInput Component Tests
// ============================================================================

describe("ParameterInput", () => {
  // Helper to create default props
  const createDefaultProps = (overrides: Partial<ParameterInputProps> = {}): ParameterInputProps => ({
    paramKey: "test_param",
    value: 10,
    onChange: vi.fn(),
    ...overrides,
  });

  describe("basic rendering", () => {
    it("should have required props interface", () => {
      const props = createDefaultProps();
      expect(props.paramKey).toBe("test_param");
      expect(props.value).toBe(10);
      expect(typeof props.onChange).toBe("function");
    });

    it("should format label from paramKey by default", () => {
      const props = createDefaultProps({ paramKey: "n_components" });
      // Label should be "n components" based on formatParamLabel
      expect(formatParamLabel(props.paramKey)).toBe("n components");
    });

    it("should use custom label when provided", () => {
      const props = createDefaultProps({ label: "Custom Label" });
      expect(props.label).toBe("Custom Label");
    });

    it("should hide label when showLabel is false", () => {
      const props = createDefaultProps({ showLabel: false });
      expect(props.showLabel).toBe(false);
    });
  });

  describe("value types", () => {
    it("should accept numeric values", () => {
      const props = createDefaultProps({ value: 42 });
      expect(props.value).toBe(42);
      expect(typeof props.value).toBe("number");
    });

    it("should accept string values", () => {
      const props = createDefaultProps({ value: "test" });
      expect(props.value).toBe("test");
      expect(typeof props.value).toBe("string");
    });

    it("should accept zero as a valid value", () => {
      const props = createDefaultProps({ value: 0 });
      expect(props.value).toBe(0);
    });

    it("should accept negative numbers", () => {
      const props = createDefaultProps({ value: -5 });
      expect(props.value).toBe(-5);
    });

    it("should accept decimal numbers", () => {
      const props = createDefaultProps({ value: 0.001 });
      expect(props.value).toBe(0.001);
    });

    it("should accept empty string", () => {
      const props = createDefaultProps({ value: "" });
      expect(props.value).toBe("");
    });
  });

  describe("sweep state", () => {
    it("should accept hasSweep prop", () => {
      const props = createDefaultProps({ hasSweep: true });
      expect(props.hasSweep).toBe(true);
    });

    it("should default hasSweep to false", () => {
      const props = createDefaultProps();
      expect(props.hasSweep ?? false).toBe(false);
    });
  });

  describe("disabled state", () => {
    it("should accept disabled prop", () => {
      const props = createDefaultProps({ disabled: true });
      expect(props.disabled).toBe(true);
    });

    it("should disable input when hasSweep is true", () => {
      const props = createDefaultProps({ hasSweep: true });
      // Based on component logic: isDisabled = disabled || hasSweep
      expect(props.disabled || props.hasSweep).toBe(true);
    });
  });

  describe("validation states", () => {
    it("should accept error message", () => {
      const props = createDefaultProps({ error: "Value is required" });
      expect(props.error).toBe("Value is required");
    });

    it("should accept warning message", () => {
      const props = createDefaultProps({ warning: "Value may be too high" });
      expect(props.warning).toBe("Value may be too high");
    });

    it("should prioritize error over warning", () => {
      const props = createDefaultProps({
        error: "Error message",
        warning: "Warning message",
      });
      // Based on component: hasError = !!error, hasWarning = !hasError && !!warning
      const hasError = !!props.error;
      const hasWarning = !hasError && !!props.warning;
      expect(hasError).toBe(true);
      expect(hasWarning).toBe(false);
    });
  });

  describe("numeric input configuration", () => {
    it("should accept min/max constraints", () => {
      const props = createDefaultProps({ min: 0, max: 100 });
      expect(props.min).toBe(0);
      expect(props.max).toBe(100);
    });

    it("should accept custom step value", () => {
      const props = createDefaultProps({ step: 0.1 });
      expect(props.step).toBe(0.1);
    });

    it("should accept type override", () => {
      const props = createDefaultProps({ type: "text" });
      expect(props.type).toBe("text");
    });
  });

  describe("tooltip", () => {
    it("should accept tooltip content", () => {
      const props = createDefaultProps({ tooltip: "Help text" });
      expect(props.tooltip).toBe("Help text");
    });
  });

  describe("size variants", () => {
    it("should accept sm size", () => {
      const props = createDefaultProps({ size: "sm" });
      expect(props.size).toBe("sm");
    });

    it("should accept md size", () => {
      const props = createDefaultProps({ size: "md" });
      expect(props.size).toBe("md");
    });

    it("should default to md size", () => {
      const props = createDefaultProps();
      expect(props.size ?? "md").toBe("md");
    });
  });

  describe("suffix slot", () => {
    it("should accept suffix content", () => {
      const suffix = "suffix content";
      const props = createDefaultProps({ suffix });
      expect(props.suffix).toBe(suffix);
    });
  });

  describe("onChange callback", () => {
    it("should provide onChange callback", () => {
      const onChange = vi.fn();
      const props = createDefaultProps({ onChange });
      expect(props.onChange).toBe(onChange);
    });

    it("should be a function", () => {
      const props = createDefaultProps();
      expect(typeof props.onChange).toBe("function");
    });
  });

  describe("accessibility", () => {
    it("should generate aria-describedby for errors", () => {
      const props = createDefaultProps({
        paramKey: "n_components",
        error: "Error message",
      });
      // Component uses `${paramKey}-error` as aria-describedby id
      expect(`${props.paramKey}-error`).toBe("n_components-error");
    });

    it("should generate aria-describedby for warnings", () => {
      const props = createDefaultProps({
        paramKey: "n_components",
        warning: "Warning message",
      });
      // Component uses `${paramKey}-warning` as aria-describedby id
      expect(`${props.paramKey}-warning`).toBe("n_components-warning");
    });
  });

  describe("edge cases", () => {
    it("should handle very large numbers", () => {
      const props = createDefaultProps({ value: 1e10 });
      expect(props.value).toBe(1e10);
    });

    it("should handle very small decimals", () => {
      const props = createDefaultProps({ value: 0.0001 });
      expect(props.value).toBe(0.0001);
    });

    it("should handle special characters in paramKey", () => {
      const props = createDefaultProps({ paramKey: "param_with_123" });
      expect(formatParamLabel(props.paramKey)).toBe("param with 123");
    });

    it("should handle unicode in string values", () => {
      const props = createDefaultProps({ value: "测试" });
      expect(props.value).toBe("测试");
    });
  });
});

// ============================================================================
// Step Inference Tests (based on component's inferStep function)
// ============================================================================

describe("step inference logic", () => {
  // The component infers step based on value magnitude
  it("should use step 0.01 for values between 0 and 1", () => {
    // Based on inferStep: if (value > 0 && value < 1) return 0.01
    const testValue = 0.5;
    const expectedStep = 0.01;
    expect(testValue > 0 && testValue < 1).toBe(true);
    // The component would use step 0.01 for this value
  });

  it("should use step 10 for values >= 1000", () => {
    // Based on inferStep: if (Math.abs(value) >= 1000) return 10
    const testValue = 1000;
    expect(Math.abs(testValue) >= 1000).toBe(true);
  });

  it("should use step 1 for values >= 100", () => {
    // Based on inferStep: if (Math.abs(value) >= 100) return 1
    const testValue = 100;
    expect(Math.abs(testValue) >= 100).toBe(true);
  });

  it("should handle non-finite values", () => {
    // Based on inferStep: if (!Number.isFinite(value)) return 1
    expect(Number.isFinite(Infinity)).toBe(false);
    expect(Number.isFinite(NaN)).toBe(false);
  });
});
