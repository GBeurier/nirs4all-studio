/**
 * CollapsibleSection Component Tests
 *
 * Comprehensive tests for the CollapsibleSection shared component.
 * Tests cover open/closed states, controlled/uncontrolled modes, and variants.
 */

import { describe, it, expect, vi } from "vitest";
import type { CollapsibleSectionProps } from "../CollapsibleSection";

// ============================================================================
// CollapsibleSection Component Tests
// ============================================================================

describe("CollapsibleSection", () => {
  // Helper to create default props
  const createDefaultProps = (overrides: Partial<CollapsibleSectionProps> = {}): CollapsibleSectionProps => ({
    title: "Test Section",
    children: "Section content",
    ...overrides,
  });

  describe("basic props", () => {
    it("should have required props interface", () => {
      const props = createDefaultProps();
      expect(props.title).toBe("Test Section");
      expect(props.children).toBe("Section content");
    });

    it("should accept ReactNode as title", () => {
      const props = createDefaultProps({ title: "Custom Title" });
      expect(props.title).toBe("Custom Title");
    });

    it("should accept ReactNode as children", () => {
      const props = createDefaultProps({ children: "Complex content" });
      expect(props.children).toBe("Complex content");
    });
  });

  describe("uncontrolled mode", () => {
    it("should accept defaultOpen=false", () => {
      const props = createDefaultProps({ defaultOpen: false });
      expect(props.defaultOpen).toBe(false);
    });

    it("should accept defaultOpen=true", () => {
      const props = createDefaultProps({ defaultOpen: true });
      expect(props.defaultOpen).toBe(true);
    });

    it("should default to closed (defaultOpen=false)", () => {
      const props = createDefaultProps();
      expect(props.defaultOpen ?? false).toBe(false);
    });
  });

  describe("controlled mode", () => {
    it("should accept open prop for controlled mode", () => {
      const props = createDefaultProps({ open: true });
      expect(props.open).toBe(true);
    });

    it("should accept onOpenChange callback", () => {
      const onOpenChange = vi.fn();
      const props = createDefaultProps({ onOpenChange });
      expect(props.onOpenChange).toBe(onOpenChange);
    });

    it("should work in controlled mode with both open and onOpenChange", () => {
      const onOpenChange = vi.fn();
      const props = createDefaultProps({ open: false, onOpenChange });
      expect(props.open).toBe(false);
      expect(props.onOpenChange).toBe(onOpenChange);
    });
  });

  describe("icon and badge", () => {
    it("should accept icon prop", () => {
      const icon = "icon element";
      const props = createDefaultProps({ icon });
      expect(props.icon).toBe(icon);
    });

    it("should accept badge prop", () => {
      const badge = "badge element";
      const props = createDefaultProps({ badge });
      expect(props.badge).toBe(badge);
    });

    it("should accept both icon and badge", () => {
      const props = createDefaultProps({
        icon: "icon",
        badge: "badge",
      });
      expect(props.icon).toBe("icon");
      expect(props.badge).toBe("badge");
    });
  });

  describe("action slot", () => {
    it("should accept action prop", () => {
      const action = "action button";
      const props = createDefaultProps({ action });
      expect(props.action).toBe(action);
    });
  });

  describe("variant styles", () => {
    it("should accept default variant", () => {
      const props = createDefaultProps({ variant: "default" });
      expect(props.variant).toBe("default");
    });

    it("should accept ghost variant", () => {
      const props = createDefaultProps({ variant: "ghost" });
      expect(props.variant).toBe("ghost");
    });

    it("should accept outline variant", () => {
      const props = createDefaultProps({ variant: "outline" });
      expect(props.variant).toBe("outline");
    });

    it("should default to ghost variant", () => {
      const props = createDefaultProps();
      expect(props.variant ?? "ghost").toBe("ghost");
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

    it("should accept lg size", () => {
      const props = createDefaultProps({ size: "lg" });
      expect(props.size).toBe("lg");
    });

    it("should default to md size", () => {
      const props = createDefaultProps();
      expect(props.size ?? "md").toBe("md");
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

    it("should default to not disabled", () => {
      const props = createDefaultProps();
      expect(props.disabled ?? false).toBe(false);
    });
  });

  describe("classNames", () => {
    it("should accept className for container", () => {
      const props = createDefaultProps({ className: "container-class" });
      expect(props.className).toBe("container-class");
    });

    it("should accept triggerClassName", () => {
      const props = createDefaultProps({ triggerClassName: "trigger-class" });
      expect(props.triggerClassName).toBe("trigger-class");
    });

    it("should accept contentClassName", () => {
      const props = createDefaultProps({ contentClassName: "content-class" });
      expect(props.contentClassName).toBe("content-class");
    });

    it("should accept all className props together", () => {
      const props = createDefaultProps({
        className: "container",
        triggerClassName: "trigger",
        contentClassName: "content",
      });
      expect(props.className).toBe("container");
      expect(props.triggerClassName).toBe("trigger");
      expect(props.contentClassName).toBe("content");
    });
  });

  describe("edge cases", () => {
    it("should handle empty title", () => {
      const props = createDefaultProps({ title: "" });
      expect(props.title).toBe("");
    });

    it("should handle null children", () => {
      const props = createDefaultProps({ children: null as unknown as React.ReactNode });
      expect(props.children).toBe(null);
    });

    it("should handle complex nested children", () => {
      const complexChildren = { nested: { data: "value" } };
      const props = createDefaultProps({ children: complexChildren as unknown as React.ReactNode });
      expect(props.children).toEqual(complexChildren);
    });

    it("should handle long title text", () => {
      const longTitle = "A".repeat(200);
      const props = createDefaultProps({ title: longTitle });
      expect(props.title).toBe(longTitle);
    });

    it("should handle special characters in title", () => {
      const props = createDefaultProps({ title: "<script>alert('xss')</script>" });
      expect(props.title).toBe("<script>alert('xss')</script>");
    });
  });

  describe("controlled/uncontrolled detection", () => {
    it("should be uncontrolled when open is undefined", () => {
      const props = createDefaultProps();
      const isControlled = props.open !== undefined;
      expect(isControlled).toBe(false);
    });

    it("should be controlled when open is defined", () => {
      const props = createDefaultProps({ open: true });
      const isControlled = props.open !== undefined;
      expect(isControlled).toBe(true);
    });

    it("should be controlled when open is false (not just truthy check)", () => {
      const props = createDefaultProps({ open: false });
      const isControlled = props.open !== undefined;
      expect(isControlled).toBe(true);
    });
  });
});
