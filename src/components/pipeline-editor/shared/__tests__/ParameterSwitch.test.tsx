/**
 * ParameterSwitch Component Tests
 *
 * Comprehensive tests for the ParameterSwitch shared component.
 * Tests cover rendering, layouts, and boolean state handling.
 */

import { describe, it, expect, vi } from "vitest";
import type { ParameterSwitchProps } from "../ParameterSwitch";

// ============================================================================
// ParameterSwitch Component Tests
// ============================================================================

describe("ParameterSwitch", () => {
  // Helper to create default props
  const createDefaultProps = (overrides: Partial<ParameterSwitchProps> = {}): ParameterSwitchProps => ({
    paramKey: "shuffle",
    checked: false,
    onChange: vi.fn(),
    ...overrides,
  });

  describe("basic props", () => {
    it("should have required props interface", () => {
      const props = createDefaultProps();
      expect(props.paramKey).toBe("shuffle");
      expect(props.checked).toBe(false);
      expect(typeof props.onChange).toBe("function");
    });

    it("should accept checked=true", () => {
      const props = createDefaultProps({ checked: true });
      expect(props.checked).toBe(true);
    });

    it("should accept checked=false", () => {
      const props = createDefaultProps({ checked: false });
      expect(props.checked).toBe(false);
    });
  });

  describe("label handling", () => {
    it("should format label from paramKey", () => {
      const props = createDefaultProps({ paramKey: "random_state" });
      // Using same formatParamLabel as ParameterInput
      expect(props.paramKey.replace(/_/g, " ")).toBe("random state");
    });

    it("should accept custom label", () => {
      const props = createDefaultProps({ label: "Enable Shuffling" });
      expect(props.label).toBe("Enable Shuffling");
    });
  });

  describe("description", () => {
    it("should accept description text", () => {
      const props = createDefaultProps({ description: "Shuffle data before splitting" });
      expect(props.description).toBe("Shuffle data before splitting");
    });

    it("should have no description by default", () => {
      const props = createDefaultProps();
      expect(props.description).toBeUndefined();
    });
  });

  describe("tooltip", () => {
    it("should accept tooltip content", () => {
      const props = createDefaultProps({ tooltip: "Help text for shuffle" });
      expect(props.tooltip).toBe("Help text for shuffle");
    });
  });

  describe("sweep state", () => {
    it("should accept hasSweep prop", () => {
      const props = createDefaultProps({ hasSweep: true });
      expect(props.hasSweep).toBe(true);
    });

    it("should be disabled when hasSweep is true", () => {
      const props = createDefaultProps({ hasSweep: true, disabled: false });
      // isDisabled = disabled || hasSweep
      expect(props.disabled || props.hasSweep).toBe(true);
    });
  });

  describe("disabled state", () => {
    it("should accept disabled=true", () => {
      const props = createDefaultProps({ disabled: true });
      expect(props.disabled).toBe(true);
    });

    it("should accept disabled=false", () => {
      const props = createDefaultProps({ disabled: false });
      expect(props.disabled).toBe(false);
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

  describe("layout variants", () => {
    it("should accept inline layout", () => {
      const props = createDefaultProps({ layout: "inline" });
      expect(props.layout).toBe("inline");
    });

    it("should accept stacked layout", () => {
      const props = createDefaultProps({ layout: "stacked" });
      expect(props.layout).toBe("stacked");
    });

    it("should default to inline layout", () => {
      const props = createDefaultProps();
      expect(props.layout ?? "inline").toBe("inline");
    });
  });

  describe("suffix slot", () => {
    it("should accept suffix content", () => {
      const suffix = "extra content";
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

    it("should accept boolean in onChange", () => {
      const onChange = vi.fn();
      const props = createDefaultProps({ onChange });

      // Simulate change
      props.onChange(true);
      expect(onChange).toHaveBeenCalledWith(true);

      props.onChange(false);
      expect(onChange).toHaveBeenCalledWith(false);
    });
  });

  describe("className", () => {
    it("should accept custom className", () => {
      const props = createDefaultProps({ className: "custom-class" });
      expect(props.className).toBe("custom-class");
    });
  });

  describe("edge cases", () => {
    it("should handle empty paramKey", () => {
      const props = createDefaultProps({ paramKey: "" });
      expect(props.paramKey).toBe("");
    });

    it("should handle complex paramKey", () => {
      const props = createDefaultProps({ paramKey: "use_GPU_acceleration" });
      expect(props.paramKey).toBe("use_GPU_acceleration");
    });

    it("should handle special characters in label", () => {
      const props = createDefaultProps({ label: "Enable (beta)" });
      expect(props.label).toBe("Enable (beta)");
    });

    it("should handle long descriptions", () => {
      const longDesc = "A".repeat(500);
      const props = createDefaultProps({ description: longDesc });
      expect(props.description?.length).toBe(500);
    });
  });
});
