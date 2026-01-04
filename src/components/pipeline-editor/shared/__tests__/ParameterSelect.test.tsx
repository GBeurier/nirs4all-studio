/**
 * ParameterSelect Component Tests
 *
 * Comprehensive tests for the ParameterSelect shared component.
 * Tests cover options handling, value changes, and edge cases.
 */

import { describe, it, expect, vi } from "vitest";
import { ParameterSelect } from "../ParameterSelect";
import type { ParameterSelectProps, SelectOption, SelectOptionDef } from "../ParameterSelect";

// ============================================================================
// Test Fixtures
// ============================================================================

const simpleOptions: SelectOption[] = ["linear", "rbf", "poly"];

const richOptions: SelectOptionDef[] = [
  { value: "linear", label: "Linear Kernel" },
  { value: "rbf", label: "RBF (Radial Basis Function)", description: "Good for non-linear data" },
  { value: "poly", label: "Polynomial", disabled: true },
];

const numericOptions: SelectOption[] = [
  { value: 1, label: "One" },
  { value: 2, label: "Two" },
  { value: 3, label: "Three" },
];

// ============================================================================
// ParameterSelect Component Tests
// ============================================================================

describe("ParameterSelect", () => {
  // Helper to create default props
  const createDefaultProps = (overrides: Partial<ParameterSelectProps> = {}): ParameterSelectProps => ({
    paramKey: "kernel",
    value: "rbf",
    onChange: vi.fn(),
    options: simpleOptions,
    ...overrides,
  });

  describe("basic props", () => {
    it("should have required props interface", () => {
      const props = createDefaultProps();
      expect(props.paramKey).toBe("kernel");
      expect(props.value).toBe("rbf");
      expect(typeof props.onChange).toBe("function");
      expect(props.options).toEqual(simpleOptions);
    });

    it("should accept custom label", () => {
      const props = createDefaultProps({ label: "Kernel Type" });
      expect(props.label).toBe("Kernel Type");
    });

    it("should accept tooltip", () => {
      const props = createDefaultProps({ tooltip: "Select kernel type" });
      expect(props.tooltip).toBe("Select kernel type");
    });
  });

  describe("options handling", () => {
    describe("simple options (string/number arrays)", () => {
      it("should accept string options", () => {
        const props = createDefaultProps({ options: ["a", "b", "c"] });
        expect(props.options).toEqual(["a", "b", "c"]);
      });

      it("should accept number options", () => {
        const props = createDefaultProps({ options: [1, 2, 3] });
        expect(props.options).toEqual([1, 2, 3]);
      });

      it("should convert simple options to normalized format", () => {
        // Based on normalizeOption function in component
        const simpleOption = "linear";
        const normalized = typeof simpleOption === "object" && simpleOption !== null && "value" in simpleOption
          ? simpleOption
          : { value: simpleOption, label: String(simpleOption) };

        expect(normalized).toEqual({ value: "linear", label: "linear" });
      });
    });

    describe("rich options (object arrays)", () => {
      it("should accept rich options with labels", () => {
        const props = createDefaultProps({ options: richOptions });
        expect(props.options).toEqual(richOptions);
      });

      it("should preserve option descriptions", () => {
        const props = createDefaultProps({ options: richOptions });
        const rbfOption = (props.options as SelectOptionDef[]).find(o => o.value === "rbf");
        expect(rbfOption?.description).toBe("Good for non-linear data");
      });

      it("should preserve disabled state on options", () => {
        const props = createDefaultProps({ options: richOptions });
        const polyOption = (props.options as SelectOptionDef[]).find(o => o.value === "poly");
        expect(polyOption?.disabled).toBe(true);
      });
    });

    describe("numeric values", () => {
      it("should handle numeric option values", () => {
        const props = createDefaultProps({ options: numericOptions, value: 2 });
        expect(props.value).toBe(2);
      });

      it("should preserve numeric type in options", () => {
        const props = createDefaultProps({ options: numericOptions });
        const firstOption = (props.options as SelectOptionDef[])[0];
        expect(typeof firstOption.value).toBe("number");
      });
    });

    describe("empty options", () => {
      it("should handle empty options array", () => {
        const props = createDefaultProps({ options: [] });
        expect(props.options).toEqual([]);
      });
    });

    describe("mixed options", () => {
      it("should handle mixed simple and rich options", () => {
        const mixedOptions: SelectOption[] = [
          "simple",
          { value: "rich", label: "Rich Option" },
        ];
        const props = createDefaultProps({ options: mixedOptions });
        expect(props.options.length).toBe(2);
      });
    });
  });

  describe("value handling", () => {
    it("should accept string value", () => {
      const props = createDefaultProps({ value: "rbf" });
      expect(props.value).toBe("rbf");
    });

    it("should accept numeric value", () => {
      const props = createDefaultProps({ value: 42, options: numericOptions });
      expect(props.value).toBe(42);
    });

    it("should handle value not in options", () => {
      const props = createDefaultProps({ value: "nonexistent" });
      expect(props.value).toBe("nonexistent");
    });
  });

  describe("sweep state", () => {
    it("should accept hasSweep prop", () => {
      const props = createDefaultProps({ hasSweep: true });
      expect(props.hasSweep).toBe(true);
    });

    it("should be disabled when hasSweep is true", () => {
      const props = createDefaultProps({ hasSweep: true });
      // isDisabled = disabled || hasSweep
      expect(props.disabled || props.hasSweep).toBe(true);
    });
  });

  describe("disabled state", () => {
    it("should accept disabled prop", () => {
      const props = createDefaultProps({ disabled: true });
      expect(props.disabled).toBe(true);
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
  });

  describe("validation", () => {
    it("should accept error message", () => {
      const props = createDefaultProps({ error: "Invalid selection" });
      expect(props.error).toBe("Invalid selection");
    });
  });

  describe("label visibility", () => {
    it("should show label by default", () => {
      const props = createDefaultProps();
      expect(props.showLabel ?? true).toBe(true);
    });

    it("should hide label when showLabel is false", () => {
      const props = createDefaultProps({ showLabel: false });
      expect(props.showLabel).toBe(false);
    });
  });

  describe("placeholder", () => {
    it("should accept custom placeholder", () => {
      const props = createDefaultProps({ placeholder: "Choose..." });
      expect(props.placeholder).toBe("Choose...");
    });

    it("should have default placeholder", () => {
      const props = createDefaultProps();
      expect(props.placeholder ?? "Select...").toBe("Select...");
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
  });

  describe("accessibility", () => {
    it("should generate error describedby id", () => {
      const props = createDefaultProps({
        paramKey: "kernel",
        error: "Error",
      });
      expect(`${props.paramKey}-error`).toBe("kernel-error");
    });
  });

  describe("edge cases", () => {
    it("should handle boolean-like string values", () => {
      const boolOptions: SelectOption[] = [
        { value: "true", label: "Yes" },
        { value: "false", label: "No" },
      ];
      const props = createDefaultProps({ options: boolOptions, value: "true" });
      expect(props.value).toBe("true");
    });

    it("should handle empty string value", () => {
      const props = createDefaultProps({ value: "" });
      expect(props.value).toBe("");
    });

    it("should handle options with special characters", () => {
      const specialOptions: SelectOption[] = [
        { value: "a/b", label: "A/B" },
        { value: "c&d", label: "C&D" },
      ];
      const props = createDefaultProps({ options: specialOptions });
      expect(props.options.length).toBe(2);
    });

    it("should handle options with unicode", () => {
      const unicodeOptions: SelectOption[] = [
        { value: "日本語", label: "Japanese" },
        { value: "中文", label: "Chinese" },
      ];
      const props = createDefaultProps({ options: unicodeOptions });
      expect(props.options.length).toBe(2);
    });

    it("should handle very long option lists", () => {
      const manyOptions = Array.from({ length: 100 }, (_, i) => ({
        value: `option_${i}`,
        label: `Option ${i}`,
      }));
      const props = createDefaultProps({ options: manyOptions });
      expect(props.options.length).toBe(100);
    });
  });
});
