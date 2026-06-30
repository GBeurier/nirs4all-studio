import { describe, expect, it } from "vitest";
import {
  NAMESPACE_PRIORITY,
  createCustomNodeTemplate,
  createParameterTemplate,
  generateCustomNodeId,
  isCustomNodeId,
  parseNamespace,
} from "../CustomNodeStorageIdentity";

describe("CustomNodeStorageIdentity", () => {
  describe("generateCustomNodeId", () => {
    it("slugifies names to snake_case under the default namespace", () => {
      expect(generateCustomNodeId("My Cool Operator")).toBe("custom.my_cool_operator");
    });

    it("respects the requested namespace", () => {
      expect(generateCustomNodeId("My Op", "workspace")).toBe("workspace.my_op");
    });

    it("collapses non-alphanumeric runs and trims edges", () => {
      expect(generateCustomNodeId("  --Foo!!Bar__  ")).toBe("custom.foo_bar");
    });

    it("falls back to 'unnamed' when nothing usable remains", () => {
      expect(generateCustomNodeId("!!!")).toBe("custom.unnamed");
    });
  });

  describe("parseNamespace", () => {
    it("extracts each supported namespace prefix", () => {
      expect(parseNamespace("custom.foo")).toBe("custom");
      expect(parseNamespace("user.foo")).toBe("user");
      expect(parseNamespace("workspace.foo")).toBe("workspace");
      expect(parseNamespace("admin.foo")).toBe("admin");
    });

    it("returns null for unknown or missing prefixes", () => {
      expect(parseNamespace("builtin.foo")).toBeNull();
      expect(parseNamespace("nodot")).toBeNull();
    });
  });

  describe("isCustomNodeId", () => {
    it("is true only for recognised namespaces", () => {
      expect(isCustomNodeId("custom.foo")).toBe(true);
      expect(isCustomNodeId("admin.foo")).toBe(true);
      expect(isCustomNodeId("builtin.foo")).toBe(false);
    });
  });

  describe("NAMESPACE_PRIORITY", () => {
    it("ranks admin above workspace above user/custom", () => {
      expect(NAMESPACE_PRIORITY.admin).toBeGreaterThan(NAMESPACE_PRIORITY.workspace);
      expect(NAMESPACE_PRIORITY.workspace).toBeGreaterThan(NAMESPACE_PRIORITY.user);
      expect(NAMESPACE_PRIORITY.user).toBe(NAMESPACE_PRIORITY.custom);
    });
  });

  describe("createCustomNodeTemplate", () => {
    it("produces a custom-sourced template with a namespaced id", () => {
      const template = createCustomNodeTemplate("preprocessing");
      expect(template.source).toBe("custom");
      expect(template.type).toBe("preprocessing");
      expect(template.parameters).toEqual([]);
      expect(parseNamespace(template.id)).toBe("custom");
    });

    it("honours a non-default namespace in the generated id", () => {
      const template = createCustomNodeTemplate("model", "workspace");
      expect(parseNamespace(template.id)).toBe("workspace");
    });
  });

  describe("createParameterTemplate", () => {
    it("returns a float parameter with sane defaults", () => {
      expect(createParameterTemplate()).toEqual({
        name: "param",
        type: "float",
        default: 0,
        description: "A parameter",
      });
    });
  });
});
