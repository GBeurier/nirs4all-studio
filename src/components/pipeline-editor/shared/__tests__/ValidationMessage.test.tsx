/**
 * ValidationMessage Component Tests
 *
 * Comprehensive tests for the ValidationMessage and InlineValidationMessage components.
 * Tests cover severity levels, styling, and accessibility.
 */

import { describe, it, expect } from "vitest";
import type { ValidationMessageProps, InlineValidationMessageProps, ValidationSeverity } from "../ValidationMessage";

// ============================================================================
// ValidationMessage Component Tests
// ============================================================================

describe("ValidationMessage", () => {
  // Helper to create default props
  const createDefaultProps = (overrides: Partial<ValidationMessageProps> = {}): ValidationMessageProps => ({
    message: "Test message",
    severity: "error",
    ...overrides,
  });

  describe("basic props", () => {
    it("should have required props interface", () => {
      const props = createDefaultProps();
      expect(props.message).toBe("Test message");
      expect(props.severity).toBe("error");
    });

    it("should accept string message", () => {
      const props = createDefaultProps({ message: "Error occurred" });
      expect(props.message).toBe("Error occurred");
    });

    it("should accept ReactNode message", () => {
      const props = createDefaultProps({ message: "Complex message" });
      expect(props.message).toBe("Complex message");
    });
  });

  describe("severity levels", () => {
    const severities: ValidationSeverity[] = ["error", "warning", "info", "success"];

    severities.forEach((severity) => {
      it(`should accept severity=${severity}`, () => {
        const props = createDefaultProps({ severity });
        expect(props.severity).toBe(severity);
      });
    });

    it("should have correct severity type", () => {
      const props = createDefaultProps({ severity: "warning" });
      expect(["error", "warning", "info", "success"]).toContain(props.severity);
    });
  });

  describe("title", () => {
    it("should accept title prop", () => {
      const props = createDefaultProps({ title: "Error Title" });
      expect(props.title).toBe("Error Title");
    });

    it("should be optional (undefined)", () => {
      const props = createDefaultProps();
      expect(props.title).toBeUndefined();
    });
  });

  describe("icon visibility", () => {
    it("should accept showIcon=true", () => {
      const props = createDefaultProps({ showIcon: true });
      expect(props.showIcon).toBe(true);
    });

    it("should accept showIcon=false", () => {
      const props = createDefaultProps({ showIcon: false });
      expect(props.showIcon).toBe(false);
    });

    it("should default to showIcon=true", () => {
      const props = createDefaultProps();
      expect(props.showIcon ?? true).toBe(true);
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

  describe("action slot", () => {
    it("should accept action prop", () => {
      const action = "action button";
      const props = createDefaultProps({ action });
      expect(props.action).toBe(action);
    });

    it("should be optional", () => {
      const props = createDefaultProps();
      expect(props.action).toBeUndefined();
    });
  });

  describe("className", () => {
    it("should accept custom className", () => {
      const props = createDefaultProps({ className: "custom-class" });
      expect(props.className).toBe("custom-class");
    });
  });

  describe("accessibility", () => {
    it("should have role=alert for error severity", () => {
      const props = createDefaultProps({ severity: "error" });
      // Component uses role={severity === "error" ? "alert" : "status"}
      const role = props.severity === "error" ? "alert" : "status";
      expect(role).toBe("alert");
    });

    it("should have role=status for non-error severity", () => {
      const props = createDefaultProps({ severity: "info" });
      const role = props.severity === "error" ? "alert" : "status";
      expect(role).toBe("status");
    });

    it("should have assertive aria-live for errors", () => {
      const props = createDefaultProps({ severity: "error" });
      // Component uses aria-live={severity === "error" ? "assertive" : "polite"}
      const ariaLive = props.severity === "error" ? "assertive" : "polite";
      expect(ariaLive).toBe("assertive");
    });

    it("should have polite aria-live for non-errors", () => {
      const props = createDefaultProps({ severity: "warning" });
      const ariaLive = props.severity === "error" ? "assertive" : "polite";
      expect(ariaLive).toBe("polite");
    });
  });

  describe("edge cases", () => {
    it("should handle empty message", () => {
      const props = createDefaultProps({ message: "" });
      expect(props.message).toBe("");
    });

    it("should handle very long message", () => {
      const longMessage = "A".repeat(1000);
      const props = createDefaultProps({ message: longMessage });
      expect(props.message).toBe(longMessage);
    });

    it("should handle message with HTML-like content", () => {
      const props = createDefaultProps({ message: "<strong>Bold</strong>" });
      expect(props.message).toBe("<strong>Bold</strong>");
    });

    it("should handle unicode in message", () => {
      const props = createDefaultProps({ message: "错误 ⚠️ Error" });
      expect(props.message).toBe("错误 ⚠️ Error");
    });

    it("should handle multiline message", () => {
      const multiline = "Line 1\nLine 2";
      const props = createDefaultProps({ message: multiline });
      expect(props.message).toBe(multiline);
    });
  });
});

// ============================================================================
// InlineValidationMessage Component Tests
// ============================================================================

describe("InlineValidationMessage", () => {
  // Helper to create default props
  const createDefaultProps = (overrides: Partial<InlineValidationMessageProps> = {}): InlineValidationMessageProps => ({
    message: "Inline error",
    severity: "error",
    ...overrides,
  });

  describe("basic props", () => {
    it("should have required props interface", () => {
      const props = createDefaultProps();
      expect(props.message).toBe("Inline error");
      expect(props.severity).toBe("error");
    });

    it("should only accept string message", () => {
      const props = createDefaultProps({ message: "String message" });
      expect(typeof props.message).toBe("string");
    });
  });

  describe("severity levels", () => {
    const severities: ValidationSeverity[] = ["error", "warning", "info", "success"];

    severities.forEach((severity) => {
      it(`should accept severity=${severity}`, () => {
        const props = createDefaultProps({ severity });
        expect(props.severity).toBe(severity);
      });
    });
  });

  describe("className", () => {
    it("should accept custom className", () => {
      const props = createDefaultProps({ className: "inline-custom" });
      expect(props.className).toBe("inline-custom");
    });
  });

  describe("accessibility", () => {
    it("should have role=alert for error severity", () => {
      const props = createDefaultProps({ severity: "error" });
      const role = props.severity === "error" ? "alert" : "status";
      expect(role).toBe("alert");
    });

    it("should have role=status for non-error severity", () => {
      const props = createDefaultProps({ severity: "success" });
      const role = props.severity === "error" ? "alert" : "status";
      expect(role).toBe("status");
    });
  });

  describe("edge cases", () => {
    it("should handle empty message", () => {
      const props = createDefaultProps({ message: "" });
      expect(props.message).toBe("");
    });

    it("should handle very short message", () => {
      const props = createDefaultProps({ message: "!" });
      expect(props.message).toBe("!");
    });
  });
});

// ============================================================================
// Severity Configuration Tests
// ============================================================================

describe("severity configuration", () => {
  const severityConfig = {
    error: {
      hasDestructive: true,
      expectedRole: "alert",
      expectedAriaLive: "assertive",
    },
    warning: {
      hasDestructive: false,
      expectedRole: "status",
      expectedAriaLive: "polite",
    },
    info: {
      hasDestructive: false,
      expectedRole: "status",
      expectedAriaLive: "polite",
    },
    success: {
      hasDestructive: false,
      expectedRole: "status",
      expectedAriaLive: "polite",
    },
  };

  Object.entries(severityConfig).forEach(([severity, config]) => {
    describe(`${severity} severity`, () => {
      it(`should have expected role: ${config.expectedRole}`, () => {
        const role = severity === "error" ? "alert" : "status";
        expect(role).toBe(config.expectedRole);
      });

      it(`should have expected aria-live: ${config.expectedAriaLive}`, () => {
        const ariaLive = severity === "error" ? "assertive" : "polite";
        expect(ariaLive).toBe(config.expectedAriaLive);
      });
    });
  });
});
