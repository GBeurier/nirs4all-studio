/**
 * StepActions Component Tests
 *
 * Tests for the shared action buttons component used by all step renderers.
 */

import { describe, it, expect, vi } from "vitest";
import type { StepActionsProps } from "../StepActions";

// ============================================================================
// StepActions Component Tests
// ============================================================================

describe("StepActions", () => {
  // Helper to create default props
  const createDefaultProps = (overrides: Partial<StepActionsProps> = {}): StepActionsProps => ({
    stepId: "step-123",
    onDuplicate: vi.fn(),
    onRemove: vi.fn(),
    ...overrides,
  });

  describe("basic props", () => {
    it("should have required props interface", () => {
      const props = createDefaultProps();
      expect(props.stepId).toBe("step-123");
      expect(typeof props.onDuplicate).toBe("function");
      expect(typeof props.onRemove).toBe("function");
    });

    it("should accept stepId string", () => {
      const props = createDefaultProps({ stepId: "custom-id-456" });
      expect(props.stepId).toBe("custom-id-456");
    });

    it("should accept optional className", () => {
      const props = createDefaultProps({ className: "custom-class" });
      expect(props.className).toBe("custom-class");
    });

    it("should default className to empty string", () => {
      const props = createDefaultProps();
      expect(props.className ?? "").toBe("");
    });
  });

  describe("callback props", () => {
    it("should accept onDuplicate callback", () => {
      const onDuplicate = vi.fn();
      const props = createDefaultProps({ onDuplicate });
      expect(props.onDuplicate).toBe(onDuplicate);
    });

    it("should accept onRemove callback", () => {
      const onRemove = vi.fn();
      const props = createDefaultProps({ onRemove });
      expect(props.onRemove).toBe(onRemove);
    });

    it("should call onDuplicate with stepId", () => {
      const onDuplicate = vi.fn();
      const props = createDefaultProps({
        stepId: "test-step",
        onDuplicate,
      });

      // Simulate click
      props.onDuplicate(props.stepId);
      expect(onDuplicate).toHaveBeenCalledWith("test-step");
    });

    it("should call onRemove with stepId", () => {
      const onRemove = vi.fn();
      const props = createDefaultProps({
        stepId: "test-step",
        onRemove,
      });

      // Simulate click
      props.onRemove(props.stepId);
      expect(onRemove).toHaveBeenCalledWith("test-step");
    });
  });

  describe("edge cases", () => {
    it("should handle empty stepId", () => {
      const props = createDefaultProps({ stepId: "" });
      expect(props.stepId).toBe("");
    });

    it("should handle stepId with special characters", () => {
      const props = createDefaultProps({ stepId: "step-with-special_chars.123" });
      expect(props.stepId).toBe("step-with-special_chars.123");
    });

    it("should handle very long stepId", () => {
      const longId = "step-" + "a".repeat(200);
      const props = createDefaultProps({ stepId: longId });
      expect(props.stepId).toBe(longId);
    });

    it("should handle multiple className values", () => {
      const props = createDefaultProps({ className: "class1 class2 class3" });
      expect(props.className).toBe("class1 class2 class3");
    });
  });

  describe("callback behavior", () => {
    it("should not call onRemove when onDuplicate is invoked", () => {
      const onDuplicate = vi.fn();
      const onRemove = vi.fn();
      const props = createDefaultProps({ onDuplicate, onRemove });

      props.onDuplicate(props.stepId);

      expect(onDuplicate).toHaveBeenCalledTimes(1);
      expect(onRemove).not.toHaveBeenCalled();
    });

    it("should not call onDuplicate when onRemove is invoked", () => {
      const onDuplicate = vi.fn();
      const onRemove = vi.fn();
      const props = createDefaultProps({ onDuplicate, onRemove });

      props.onRemove(props.stepId);

      expect(onRemove).toHaveBeenCalledTimes(1);
      expect(onDuplicate).not.toHaveBeenCalled();
    });
  });
});
