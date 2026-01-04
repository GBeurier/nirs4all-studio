/**
 * Custom Node E2E Tests
 *
 * End-to-end tests for the custom node workflow covering:
 * - Node creation and validation
 * - Storage persistence (CRUD operations)
 * - Import/export functionality
 * - Security configuration and package allowlists
 * - Namespace validation and ID generation
 *
 * These tests simulate the complete user workflow for creating,
 * editing, and managing custom nodes.
 *
 * @see docs/_internals/node_specifications.md Section 6
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  CustomNodeStorage,
  generateCustomNodeId,
  parseNamespace,
  isCustomNodeId,
  createCustomNodeTemplate,
  createParameterTemplate,
  DEFAULT_ALLOWED_PACKAGES,
} from "@/data/nodes/custom";
import type { NodeDefinition, NodeType, ParameterDefinition } from "@/data/nodes/types";

// ============================================================================
// Mock localStorage
// ============================================================================

const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
    clear: vi.fn(() => {
      store = {};
    }),
  };
})();

Object.defineProperty(globalThis, "localStorage", { value: localStorageMock });

// ============================================================================
// Test Utilities
// ============================================================================

function createTestNode(overrides: Partial<NodeDefinition> = {}): NodeDefinition {
  return {
    id: generateCustomNodeId("test_operator"),
    name: "TestOperator",
    type: "preprocessing" as NodeType,
    classPath: "nirs4all.operators.TestOperator",
    description: "A test custom operator",
    category: "Custom",
    source: "custom",
    parameters: [],
    ...overrides,
  };
}

function createTestParameter(overrides: Partial<ParameterDefinition> = {}): ParameterDefinition {
  return {
    name: "test_param",
    type: "float",
    default: 1.0,
    description: "A test parameter",
    ...overrides,
  };
}

// ============================================================================
// Custom Node Creation Workflow Tests
// ============================================================================

describe("Custom Node Creation Workflow", () => {
  beforeEach(() => {
    localStorageMock.clear();
    CustomNodeStorage.resetInstance();
  });

  afterEach(() => {
    CustomNodeStorage.resetInstance();
  });

  describe("creating a new custom node", () => {
    it("creates a valid preprocessing node", () => {
      const storage = CustomNodeStorage.getInstance();
      const node = createTestNode({
        name: "SNVCustom",
        type: "preprocessing",
        classPath: "nirs4all.operators.transforms.SNVCustom",
        description: "Custom SNV implementation",
      });

      storage.add(node);

      expect(storage.has(node.id)).toBe(true);
      expect(storage.get(node.id)?.name).toBe("SNVCustom");
      expect(storage.size).toBe(1);
    });

    it("creates a valid model node", () => {
      const storage = CustomNodeStorage.getInstance();
      const node = createTestNode({
        id: generateCustomNodeId("custom_pls"),
        name: "CustomPLS",
        type: "model",
        classPath: "nirs4all.operators.models.CustomPLS",
        description: "Custom PLS regression model",
        parameters: [
          createTestParameter({
            name: "n_components",
            type: "int",
            default: 10,
            min: 1,
            max: 100,
          }),
        ],
      });

      storage.add(node);

      expect(storage.has(node.id)).toBe(true);
      expect(storage.get(node.id)?.type).toBe("model");
      expect(storage.get(node.id)?.parameters).toHaveLength(1);
    });

    it("creates a node with multiple parameters", () => {
      const storage = CustomNodeStorage.getInstance();
      const node = createTestNode({
        id: generateCustomNodeId("multi_param_operator"),
        name: "MultiParamOperator",
        parameters: [
          createTestParameter({ name: "alpha", type: "float", default: 0.5 }),
          createTestParameter({ name: "iterations", type: "int", default: 100 }),
          createTestParameter({ name: "normalize", type: "bool", default: true }),
          createTestParameter({ name: "kernel", type: "select", default: "rbf", options: [{ value: "rbf", label: "RBF" }, { value: "linear", label: "Linear" }] }),
        ],
      });

      storage.add(node);

      const retrieved = storage.get(node.id);
      expect(retrieved?.parameters).toHaveLength(4);
      expect(retrieved?.parameters[0].name).toBe("alpha");
      expect(retrieved?.parameters[1].type).toBe("int");
      expect(retrieved?.parameters[2].default).toBe(true);
      expect(retrieved?.parameters[3].options).toHaveLength(2);
    });

    it("throws error for node without name", () => {
      const storage = CustomNodeStorage.getInstance();
      const node = createTestNode({ name: "" });

      expect(() => storage.add(node)).toThrow("Name is required");
    });

    it("throws error for node without description", () => {
      const storage = CustomNodeStorage.getInstance();
      const node = createTestNode({ description: "" });

      expect(() => storage.add(node)).toThrow("Description is required");
    });

    it("throws error for invalid node ID format", () => {
      const storage = CustomNodeStorage.getInstance();
      const node = createTestNode({ id: "invalid-id-format" });

      expect(() => storage.add(node)).toThrow("Invalid ID format");
    });
  });

  describe("updating an existing custom node", () => {
    it("updates node name", () => {
      const storage = CustomNodeStorage.getInstance();
      const node = createTestNode();
      storage.add(node);

      storage.update(node.id, { name: "UpdatedOperator" });

      expect(storage.get(node.id)?.name).toBe("UpdatedOperator");
    });

    it("updates node parameters", () => {
      const storage = CustomNodeStorage.getInstance();
      const node = createTestNode();
      storage.add(node);

      const newParams = [createTestParameter({ name: "new_param", type: "int", default: 5 })];
      storage.update(node.id, { parameters: newParams });

      expect(storage.get(node.id)?.parameters).toHaveLength(1);
      expect(storage.get(node.id)?.parameters[0].name).toBe("new_param");
    });

    it("preserves node ID on update", () => {
      const storage = CustomNodeStorage.getInstance();
      const node = createTestNode();
      storage.add(node);
      const originalId = node.id;

      storage.update(node.id, { id: generateCustomNodeId("different_id") });

      // ID should not change
      expect(storage.has(originalId)).toBe(true);
    });

    it("throws error for non-existent node", () => {
      const storage = CustomNodeStorage.getInstance();

      expect(() => storage.update("custom.nonexistent", { name: "New" })).toThrow(
        "Custom node not found"
      );
    });
  });

  describe("deleting a custom node", () => {
    it("removes existing node", () => {
      const storage = CustomNodeStorage.getInstance();
      const node = createTestNode();
      storage.add(node);

      const removed = storage.remove(node.id);

      expect(removed).toBe(true);
      expect(storage.has(node.id)).toBe(false);
      expect(storage.size).toBe(0);
    });

    it("returns false for non-existent node", () => {
      const storage = CustomNodeStorage.getInstance();

      const removed = storage.remove("custom.nonexistent");

      expect(removed).toBe(false);
    });
  });
});

// ============================================================================
// Validation Tests
// ============================================================================

describe("Custom Node Validation", () => {
  beforeEach(() => {
    localStorageMock.clear();
    CustomNodeStorage.resetInstance();
  });

  afterEach(() => {
    CustomNodeStorage.resetInstance();
  });

  describe("node ID validation", () => {
    it("accepts valid custom namespace", () => {
      const storage = CustomNodeStorage.getInstance();
      const result = storage.validateNodeId("custom.my_operator");

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("accepts valid user namespace", () => {
      const storage = CustomNodeStorage.getInstance();
      const result = storage.validateNodeId("user.my_operator");

      expect(result.valid).toBe(true);
    });

    it("accepts valid workspace namespace", () => {
      const storage = CustomNodeStorage.getInstance();
      const result = storage.validateNodeId("workspace.shared_operator");

      expect(result.valid).toBe(true);
    });

    it("accepts valid admin namespace", () => {
      const storage = CustomNodeStorage.getInstance();
      const result = storage.validateNodeId("admin.approved_operator");

      expect(result.valid).toBe(true);
    });

    it("rejects invalid namespace", () => {
      const storage = CustomNodeStorage.getInstance();
      const result = storage.validateNodeId("invalid.my_operator");

      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain("Invalid ID format");
    });

    it("rejects ID without namespace", () => {
      const storage = CustomNodeStorage.getInstance();
      const result = storage.validateNodeId("my_operator");

      expect(result.valid).toBe(false);
    });

    it("rejects ID with uppercase letters", () => {
      const storage = CustomNodeStorage.getInstance();
      const result = storage.validateNodeId("custom.MyOperator");

      expect(result.valid).toBe(false);
    });

    it("rejects empty ID", () => {
      const storage = CustomNodeStorage.getInstance();
      const result = storage.validateNodeId("");

      expect(result.valid).toBe(false);
    });
  });

  describe("classPath validation", () => {
    it("accepts nirs4all package", () => {
      const storage = CustomNodeStorage.getInstance();
      const result = storage.validateClassPath("nirs4all.operators.MyOperator");

      expect(result.valid).toBe(true);
    });

    it("accepts sklearn package", () => {
      const storage = CustomNodeStorage.getInstance();
      const result = storage.validateClassPath("sklearn.preprocessing.StandardScaler");

      expect(result.valid).toBe(true);
    });

    it("accepts scipy package", () => {
      const storage = CustomNodeStorage.getInstance();
      const result = storage.validateClassPath("scipy.signal.savgol_filter");

      expect(result.valid).toBe(true);
    });

    it("accepts numpy package", () => {
      const storage = CustomNodeStorage.getInstance();
      const result = storage.validateClassPath("numpy.linalg.svd");

      expect(result.valid).toBe(true);
    });

    it("accepts pandas package", () => {
      const storage = CustomNodeStorage.getInstance();
      const result = storage.validateClassPath("pandas.DataFrame");

      expect(result.valid).toBe(true);
    });

    it("rejects disallowed package", () => {
      const storage = CustomNodeStorage.getInstance();
      const result = storage.validateClassPath("os.system");

      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain("not in the allowlist");
    });

    it("rejects subprocess package", () => {
      const storage = CustomNodeStorage.getInstance();
      const result = storage.validateClassPath("subprocess.run");

      expect(result.valid).toBe(false);
    });

    it("accepts empty classPath (optional)", () => {
      const storage = CustomNodeStorage.getInstance();
      const result = storage.validateClassPath("");

      expect(result.valid).toBe(true);
    });
  });

  describe("parameter validation", () => {
    it("validates parameter with valid name", () => {
      const storage = CustomNodeStorage.getInstance();
      const node = createTestNode({
        parameters: [createTestParameter({ name: "valid_param" })],
      });
      const result = storage.validate(node);

      expect(result.valid).toBe(true);
    });

    it("rejects parameter with invalid name (uppercase)", () => {
      const storage = CustomNodeStorage.getInstance();
      const node = createTestNode({
        parameters: [createTestParameter({ name: "InvalidParam" })],
      });
      const result = storage.validate(node);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes("snake_case"))).toBe(true);
    });

    it("rejects parameter without name", () => {
      const storage = CustomNodeStorage.getInstance();
      const node = createTestNode({
        parameters: [createTestParameter({ name: "" })],
      });
      const result = storage.validate(node);

      expect(result.valid).toBe(false);
    });

    it("rejects select parameter without options", () => {
      const storage = CustomNodeStorage.getInstance();
      const node = createTestNode({
        parameters: [createTestParameter({ type: "select", options: [] })],
      });
      const result = storage.validate(node);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes("requires options"))).toBe(true);
    });

    it("rejects numeric parameter with min > max", () => {
      const storage = CustomNodeStorage.getInstance();
      const node = createTestNode({
        parameters: [createTestParameter({ type: "int", min: 100, max: 10 })],
      });
      const result = storage.validate(node);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes("min cannot be greater than max"))).toBe(true);
    });
  });

  describe("full node validation", () => {
    it("validates a complete valid node", () => {
      const storage = CustomNodeStorage.getInstance();
      const node = createTestNode({
        id: generateCustomNodeId("complete_operator"),
        name: "CompleteOperator",
        type: "preprocessing",
        classPath: "nirs4all.operators.CompleteOperator",
        description: "A complete operator with all fields",
        category: "Custom",
        parameters: [
          createTestParameter({ name: "alpha", type: "float", default: 0.5, min: 0, max: 1 }),
          createTestParameter({ name: "n_iter", type: "int", default: 100, min: 1, max: 1000 }),
        ],
      });
      const result = storage.validate(node);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("returns warnings for missing category", () => {
      const storage = CustomNodeStorage.getInstance();
      const node = createTestNode({ category: undefined });
      const result = storage.validate(node);

      // Should still be valid but with warnings
      expect(result.valid).toBe(true);
      expect(result.warnings.some(w => w.includes("category"))).toBe(true);
    });

    it("returns warnings for missing classPath", () => {
      const storage = CustomNodeStorage.getInstance();
      const node = createTestNode({ classPath: undefined });
      const result = storage.validate(node);

      expect(result.valid).toBe(true);
      expect(result.warnings.some(w => w.includes("classPath"))).toBe(true);
    });
  });
});

// ============================================================================
// Import/Export Tests
// ============================================================================

describe("Custom Node Import/Export", () => {
  beforeEach(() => {
    localStorageMock.clear();
    CustomNodeStorage.resetInstance();
  });

  afterEach(() => {
    CustomNodeStorage.resetInstance();
  });

  describe("export functionality", () => {
    it("exports empty storage", () => {
      const storage = CustomNodeStorage.getInstance();
      const exported = storage.export();

      expect(exported.version).toBeDefined();
      expect(exported.nodes).toHaveLength(0);
    });

    it("exports all nodes", () => {
      const storage = CustomNodeStorage.getInstance();
      storage.add(createTestNode({ id: generateCustomNodeId("node1") }));
      storage.add(createTestNode({ id: generateCustomNodeId("node2") }));
      storage.add(createTestNode({ id: generateCustomNodeId("node3") }));

      const exported = storage.export();

      expect(exported.nodes).toHaveLength(3);
    });

    it("exports to JSON string", () => {
      const storage = CustomNodeStorage.getInstance();
      storage.add(createTestNode());

      const jsonString = storage.exportToString();

      expect(typeof jsonString).toBe("string");
      expect(() => JSON.parse(jsonString)).not.toThrow();
    });
  });

  describe("import functionality", () => {
    it("imports nodes in merge mode", () => {
      const storage = CustomNodeStorage.getInstance();
      storage.add(createTestNode({ id: generateCustomNodeId("existing") }));

      const importData = {
        version: "1.0.0",
        nodes: [createTestNode({ id: generateCustomNodeId("imported") })],
      };

      const result = storage.import(importData, "merge");

      expect(result.imported).toBe(1);
      expect(storage.size).toBe(2);
    });

    it("imports nodes in replace mode", () => {
      const storage = CustomNodeStorage.getInstance();
      storage.add(createTestNode({ id: generateCustomNodeId("existing") }));

      const importData = {
        version: "1.0.0",
        nodes: [createTestNode({ id: generateCustomNodeId("imported") })],
      };

      const result = storage.import(importData, "replace");

      expect(result.imported).toBe(1);
      expect(storage.size).toBe(1);
      expect(storage.has("custom.existing")).toBe(false);
      expect(storage.has("custom.imported")).toBe(true);
    });

    it("skips duplicate nodes in merge mode", () => {
      const storage = CustomNodeStorage.getInstance();
      const existingNode = createTestNode({ id: generateCustomNodeId("existing") });
      storage.add(existingNode);

      const importData = {
        version: "1.0.0",
        nodes: [createTestNode({ id: generateCustomNodeId("existing") })],
      };

      const result = storage.import(importData, "merge");

      expect(result.imported).toBe(0);
      expect(result.skipped).toBe(1);
      expect(storage.size).toBe(1);
    });

    it("reports errors for invalid nodes", () => {
      const storage = CustomNodeStorage.getInstance();

      const importData = {
        version: "1.0.0",
        nodes: [createTestNode({ id: "invalid-id", name: "" })],
      };

      const result = storage.import(importData, "merge");

      expect(result.imported).toBe(0);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it("imports from JSON string", () => {
      const storage = CustomNodeStorage.getInstance();
      const jsonString = JSON.stringify({
        version: "1.0.0",
        nodes: [createTestNode({ id: generateCustomNodeId("json_import") })],
      });

      const result = storage.importFromString(jsonString);

      expect(result.imported).toBe(1);
      expect(storage.has("custom.json_import")).toBe(true);
    });

    it("handles invalid JSON gracefully", () => {
      const storage = CustomNodeStorage.getInstance();

      const result = storage.importFromString("not valid json");

      expect(result.imported).toBe(0);
      expect(result.errors).toContain("Invalid JSON format");
    });
  });

  describe("round-trip export/import", () => {
    it("preserves all node data through export/import", () => {
      const storage = CustomNodeStorage.getInstance();
      const originalNode = createTestNode({
        id: generateCustomNodeId("roundtrip"),
        name: "RoundTripOperator",
        type: "model",
        classPath: "nirs4all.operators.RoundTrip",
        description: "Testing round-trip",
        category: "Test",
        parameters: [
          createTestParameter({ name: "alpha", type: "float", default: 0.5, min: 0, max: 1 }),
        ],
      });
      storage.add(originalNode);

      // Export
      const exported = storage.exportToString();

      // Clear and reimport
      storage.clear();
      expect(storage.size).toBe(0);

      storage.importFromString(exported);

      // Verify
      const reimported = storage.get("custom.roundtrip");
      expect(reimported?.name).toBe("RoundTripOperator");
      expect(reimported?.type).toBe("model");
      expect(reimported?.classPath).toBe("nirs4all.operators.RoundTrip");
      expect(reimported?.parameters).toHaveLength(1);
      expect(reimported?.parameters[0].name).toBe("alpha");
    });
  });
});

// ============================================================================
// Security Configuration Tests
// ============================================================================

describe("Security Configuration", () => {
  beforeEach(() => {
    localStorageMock.clear();
    CustomNodeStorage.resetInstance();
  });

  afterEach(() => {
    CustomNodeStorage.resetInstance();
  });

  describe("security config management", () => {
    it("returns default security config", () => {
      const storage = CustomNodeStorage.getInstance();
      const config = storage.getSecurityConfig();

      expect(config.allowCustomNodes).toBe(true);
      expect(config.allowedPackages).toContain("nirs4all");
      expect(config.requireApproval).toBe(false);
      expect(config.allowUserPackages).toBe(true);
    });

    it("updates security config", () => {
      const storage = CustomNodeStorage.getInstance();

      storage.updateSecurityConfig({ requireApproval: true });

      expect(storage.getSecurityConfig().requireApproval).toBe(true);
    });

    it("prevents node creation when custom nodes disabled", () => {
      const storage = CustomNodeStorage.getInstance();
      storage.updateSecurityConfig({ allowCustomNodes: false });

      const node = createTestNode();
      const result = storage.validate(node);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain("Custom nodes are disabled");
    });
  });

  describe("user package management", () => {
    it("adds user package to allowlist", () => {
      const storage = CustomNodeStorage.getInstance();

      storage.addUserPackage("mypackage");

      expect(storage.getAllowedPackages()).toContain("mypackage");
    });

    it("removes user package from allowlist", () => {
      const storage = CustomNodeStorage.getInstance();
      storage.addUserPackage("mypackage");

      storage.removeUserPackage("mypackage");

      expect(storage.getAllowedPackages()).not.toContain("mypackage");
    });

    it("validates classPath against user packages", () => {
      const storage = CustomNodeStorage.getInstance();
      storage.addUserPackage("mypackage");

      const result = storage.validateClassPath("mypackage.MyOperator");

      expect(result.valid).toBe(true);
    });

    it("prevents user packages when disabled", () => {
      const storage = CustomNodeStorage.getInstance();
      storage.updateSecurityConfig({ allowUserPackages: false });

      expect(() => storage.addUserPackage("mypackage")).toThrow(
        "User packages are not allowed"
      );
    });
  });
});

// ============================================================================
// Utility Function Tests
// ============================================================================

describe("Utility Functions", () => {
  describe("generateCustomNodeId", () => {
    it("generates valid ID from name", () => {
      const id = generateCustomNodeId("My Operator");

      expect(id).toBe("custom.my_operator");
    });

    it("handles camelCase", () => {
      const id = generateCustomNodeId("MyCustomOperator");

      expect(id).toBe("custom.mycustomoperator");
    });

    it("handles special characters", () => {
      const id = generateCustomNodeId("My-Special_Operator!");

      expect(id).toBe("custom.my_special_operator");
    });

    it("uses specified namespace", () => {
      const id = generateCustomNodeId("MyOperator", "workspace");

      expect(id).toBe("workspace.myoperator");
    });

    it("handles empty name", () => {
      const id = generateCustomNodeId("");

      expect(id).toBe("custom.unnamed");
    });
  });

  describe("parseNamespace", () => {
    it("parses custom namespace", () => {
      expect(parseNamespace("custom.my_op")).toBe("custom");
    });

    it("parses user namespace", () => {
      expect(parseNamespace("user.my_op")).toBe("user");
    });

    it("parses workspace namespace", () => {
      expect(parseNamespace("workspace.my_op")).toBe("workspace");
    });

    it("parses admin namespace", () => {
      expect(parseNamespace("admin.my_op")).toBe("admin");
    });

    it("returns null for invalid namespace", () => {
      expect(parseNamespace("invalid.my_op")).toBeNull();
    });

    it("returns null for builtin ID", () => {
      expect(parseNamespace("PLSRegression")).toBeNull();
    });
  });

  describe("isCustomNodeId", () => {
    it("returns true for custom namespace", () => {
      expect(isCustomNodeId("custom.my_op")).toBe(true);
    });

    it("returns true for user namespace", () => {
      expect(isCustomNodeId("user.my_op")).toBe(true);
    });

    it("returns false for builtin ID", () => {
      expect(isCustomNodeId("PLSRegression")).toBe(false);
    });

    it("returns false for invalid namespace", () => {
      expect(isCustomNodeId("invalid.my_op")).toBe(false);
    });
  });

  describe("createCustomNodeTemplate", () => {
    it("creates preprocessing template", () => {
      const template = createCustomNodeTemplate("preprocessing");

      expect(template.type).toBe("preprocessing");
      expect(template.source).toBe("custom");
      expect(template.id).toMatch(/^custom\./);
    });

    it("creates model template", () => {
      const template = createCustomNodeTemplate("model");

      expect(template.type).toBe("model");
    });

    it("uses specified namespace", () => {
      const template = createCustomNodeTemplate("preprocessing", "workspace");

      expect(template.id).toMatch(/^workspace\./);
    });
  });

  describe("createParameterTemplate", () => {
    it("creates default parameter template", () => {
      const template = createParameterTemplate();

      expect(template.name).toBe("param");
      expect(template.type).toBe("float");
      expect(template.default).toBe(0);
    });
  });

  describe("DEFAULT_ALLOWED_PACKAGES", () => {
    it("includes required packages", () => {
      expect(DEFAULT_ALLOWED_PACKAGES).toContain("nirs4all");
      expect(DEFAULT_ALLOWED_PACKAGES).toContain("sklearn");
      expect(DEFAULT_ALLOWED_PACKAGES).toContain("scipy");
      expect(DEFAULT_ALLOWED_PACKAGES).toContain("numpy");
      expect(DEFAULT_ALLOWED_PACKAGES).toContain("pandas");
    });
  });
});

// ============================================================================
// Event Subscription Tests
// ============================================================================

describe("Event Subscriptions", () => {
  beforeEach(() => {
    localStorageMock.clear();
    CustomNodeStorage.resetInstance();
  });

  afterEach(() => {
    CustomNodeStorage.resetInstance();
  });

  it("emits add event", () => {
    const storage = CustomNodeStorage.getInstance();
    const events: string[] = [];
    storage.subscribe((e) => events.push(e.type));

    storage.add(createTestNode());

    expect(events).toContain("add");
  });

  it("emits update event", () => {
    const storage = CustomNodeStorage.getInstance();
    const node = createTestNode();
    storage.add(node);

    const events: string[] = [];
    storage.subscribe((e) => events.push(e.type));

    storage.update(node.id, { name: "Updated" });

    expect(events).toContain("update");
  });

  it("emits remove event", () => {
    const storage = CustomNodeStorage.getInstance();
    const node = createTestNode();
    storage.add(node);

    const events: string[] = [];
    storage.subscribe((e) => events.push(e.type));

    storage.remove(node.id);

    expect(events).toContain("remove");
  });

  it("emits clear event", () => {
    const storage = CustomNodeStorage.getInstance();
    storage.add(createTestNode());

    const events: string[] = [];
    storage.subscribe((e) => events.push(e.type));

    storage.clear();

    expect(events).toContain("clear");
  });

  it("emits import event", () => {
    const storage = CustomNodeStorage.getInstance();
    const events: string[] = [];
    storage.subscribe((e) => events.push(e.type));

    storage.import({
      version: "1.0.0",
      nodes: [createTestNode({ id: generateCustomNodeId("imported") })],
    });

    expect(events).toContain("import");
  });

  it("unsubscribes correctly", () => {
    const storage = CustomNodeStorage.getInstance();
    const events: string[] = [];
    const unsubscribe = storage.subscribe((e) => events.push(e.type));

    unsubscribe();
    storage.add(createTestNode());

    expect(events).toHaveLength(0);
  });
});

// ============================================================================
// Query Operations Tests
// ============================================================================

describe("Query Operations", () => {
  beforeEach(() => {
    localStorageMock.clear();
    CustomNodeStorage.resetInstance();
  });

  afterEach(() => {
    CustomNodeStorage.resetInstance();
  });

  it("gets all nodes", () => {
    const storage = CustomNodeStorage.getInstance();
    storage.add(createTestNode({ id: generateCustomNodeId("node1") }));
    storage.add(createTestNode({ id: generateCustomNodeId("node2") }));

    const all = storage.getAll();

    expect(all).toHaveLength(2);
  });

  it("gets nodes by type", () => {
    const storage = CustomNodeStorage.getInstance();
    storage.add(createTestNode({ id: generateCustomNodeId("prep1"), type: "preprocessing" }));
    storage.add(createTestNode({ id: generateCustomNodeId("model1"), type: "model" }));
    storage.add(createTestNode({ id: generateCustomNodeId("prep2"), type: "preprocessing" }));

    const prepNodes = storage.getByType("preprocessing");
    const modelNodes = storage.getByType("model");

    expect(prepNodes).toHaveLength(2);
    expect(modelNodes).toHaveLength(1);
  });

  it("reports correct size", () => {
    const storage = CustomNodeStorage.getInstance();

    expect(storage.size).toBe(0);

    storage.add(createTestNode({ id: generateCustomNodeId("node1") }));
    expect(storage.size).toBe(1);

    storage.add(createTestNode({ id: generateCustomNodeId("node2") }));
    expect(storage.size).toBe(2);

    storage.remove("custom.node1");
    expect(storage.size).toBe(1);
  });
});
