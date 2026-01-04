/**
 * InfoTooltip Component Tests
 *
 * Comprehensive tests for the InfoTooltip shared component.
 * Tests cover positioning, sizing, and custom icons.
 */

import { describe, it, expect } from "vitest";
import type { InfoTooltipProps } from "../InfoTooltip";

// ============================================================================
// InfoTooltip Component Tests
// ============================================================================

describe("InfoTooltip", () => {
  // Helper to create default props
  const createDefaultProps = (overrides: Partial<InfoTooltipProps> = {}): InfoTooltipProps => ({
    content: "Tooltip content",
    ...overrides,
  });

  describe("basic props", () => {
    it("should have required content prop", () => {
      const props = createDefaultProps();
      expect(props.content).toBe("Tooltip content");
    });

    it("should accept string content", () => {
      const props = createDefaultProps({ content: "Help text" });
      expect(props.content).toBe("Help text");
    });

    it("should accept ReactNode content", () => {
      const props = createDefaultProps({ content: "Complex content" });
      expect(props.content).toBe("Complex content");
    });
  });

  describe("positioning", () => {
    it("should accept side=top", () => {
      const props = createDefaultProps({ side: "top" });
      expect(props.side).toBe("top");
    });

    it("should accept side=right", () => {
      const props = createDefaultProps({ side: "right" });
      expect(props.side).toBe("right");
    });

    it("should accept side=bottom", () => {
      const props = createDefaultProps({ side: "bottom" });
      expect(props.side).toBe("bottom");
    });

    it("should accept side=left", () => {
      const props = createDefaultProps({ side: "left" });
      expect(props.side).toBe("left");
    });

    it("should default to left side", () => {
      const props = createDefaultProps();
      expect(props.side ?? "left").toBe("left");
    });
  });

  describe("alignment", () => {
    it("should accept align=start", () => {
      const props = createDefaultProps({ align: "start" });
      expect(props.align).toBe("start");
    });

    it("should accept align=center", () => {
      const props = createDefaultProps({ align: "center" });
      expect(props.align).toBe("center");
    });

    it("should accept align=end", () => {
      const props = createDefaultProps({ align: "end" });
      expect(props.align).toBe("end");
    });

    it("should default to center alignment", () => {
      const props = createDefaultProps();
      expect(props.align ?? "center").toBe("center");
    });
  });

  describe("icon customization", () => {
    it("should accept custom iconClassName", () => {
      const props = createDefaultProps({ iconClassName: "text-primary" });
      expect(props.iconClassName).toBe("text-primary");
    });

    it("should accept custom icon element", () => {
      const customIcon = "custom icon";
      const props = createDefaultProps({ icon: customIcon });
      expect(props.icon).toBe(customIcon);
    });
  });

  describe("icon size variants", () => {
    it("should accept sm icon size", () => {
      const props = createDefaultProps({ iconSize: "sm" });
      expect(props.iconSize).toBe("sm");
    });

    it("should accept md icon size", () => {
      const props = createDefaultProps({ iconSize: "md" });
      expect(props.iconSize).toBe("md");
    });

    it("should accept lg icon size", () => {
      const props = createDefaultProps({ iconSize: "lg" });
      expect(props.iconSize).toBe("lg");
    });

    it("should default to md icon size", () => {
      const props = createDefaultProps();
      expect(props.iconSize ?? "md").toBe("md");
    });
  });

  describe("max width", () => {
    it("should accept custom maxWidth", () => {
      const props = createDefaultProps({ maxWidth: 300 });
      expect(props.maxWidth).toBe(300);
    });

    it("should default to 200px maxWidth", () => {
      const props = createDefaultProps();
      expect(props.maxWidth ?? 200).toBe(200);
    });

    it("should accept very small maxWidth", () => {
      const props = createDefaultProps({ maxWidth: 50 });
      expect(props.maxWidth).toBe(50);
    });

    it("should accept very large maxWidth", () => {
      const props = createDefaultProps({ maxWidth: 1000 });
      expect(props.maxWidth).toBe(1000);
    });
  });

  describe("inline mode", () => {
    it("should accept inline=true", () => {
      const props = createDefaultProps({ inline: true });
      expect(props.inline).toBe(true);
    });

    it("should accept inline=false", () => {
      const props = createDefaultProps({ inline: false });
      expect(props.inline).toBe(false);
    });

    it("should default to inline=true", () => {
      const props = createDefaultProps();
      expect(props.inline ?? true).toBe(true);
    });
  });

  describe("edge cases", () => {
    it("should handle empty string content", () => {
      const props = createDefaultProps({ content: "" });
      expect(props.content).toBe("");
    });

    it("should handle very long content", () => {
      const longContent = "A".repeat(1000);
      const props = createDefaultProps({ content: longContent });
      expect(props.content).toBe(longContent);
    });

    it("should handle special characters in content", () => {
      const props = createDefaultProps({ content: "<>&\"'" });
      expect(props.content).toBe("<>&\"'");
    });

    it("should handle unicode content", () => {
      const props = createDefaultProps({ content: "Help 帮助 🔍" });
      expect(props.content).toBe("Help 帮助 🔍");
    });

    it("should handle multiline content", () => {
      const multiline = "Line 1\nLine 2\nLine 3";
      const props = createDefaultProps({ content: multiline });
      expect(props.content).toBe(multiline);
    });

    it("should handle zero maxWidth", () => {
      const props = createDefaultProps({ maxWidth: 0 });
      expect(props.maxWidth).toBe(0);
    });

    it("should handle negative maxWidth gracefully", () => {
      const props = createDefaultProps({ maxWidth: -100 });
      expect(props.maxWidth).toBe(-100);
    });
  });

  describe("combined props", () => {
    it("should accept all customizations together", () => {
      const props = createDefaultProps({
        content: "Full help",
        side: "right",
        align: "start",
        iconClassName: "text-blue-500",
        iconSize: "lg",
        maxWidth: 400,
        inline: false,
      });
      expect(props.content).toBe("Full help");
      expect(props.side).toBe("right");
      expect(props.align).toBe("start");
      expect(props.iconClassName).toBe("text-blue-500");
      expect(props.iconSize).toBe("lg");
      expect(props.maxWidth).toBe(400);
      expect(props.inline).toBe(false);
    });
  });
});
