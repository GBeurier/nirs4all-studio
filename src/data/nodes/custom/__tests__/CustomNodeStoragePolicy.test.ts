import { describe, expect, it } from "vitest";
import type { CustomNodeSecurityConfig } from "../CustomNodeStorage";
import {
  CUSTOM_NODE_STORAGE_VERSION,
  convertApiNodeToWorkspaceNode,
  convertNodeToWorkspacePayload,
  createCustomNodesFile,
  decideCustomNodesMigration,
  isCustomNodesFile,
  resolveAllowedPackages,
  validateCustomNode,
} from "../CustomNodeStoragePolicy";
import type { NodeDefinition } from "../../types";

const baseConfig: CustomNodeSecurityConfig = {
  allowCustomNodes: true,
  allowedPackages: ["nirs4all", "sklearn"],
  requireApproval: false,
  allowUserPackages: true,
};

const baseNode: NodeDefinition = {
  id: "custom.my_operator",
  name: "MyOperator",
  type: "preprocessing",
  description: "A custom preprocessing operator",
  category: "Custom",
  source: "custom",
  classPath: "nirs4all.operators.MyOperator",
  parameters: [
    {
      name: "window_size",
      type: "int",
      min: 1,
      max: 10,
      default: 3,
    },
  ],
};

describe("CustomNodeStoragePolicy", () => {
  it("validates custom nodes with the same errors and warnings as storage", () => {
    expect(validateCustomNode(baseNode, baseConfig, baseConfig.allowedPackages)).toEqual({
      valid: true,
      errors: [],
      warnings: [],
    });

    const invalid = validateCustomNode(
      {
        ...baseNode,
        id: "builtin.bad-name",
        name: "",
        classPath: "unknown.Package",
        parameters: [
          {
            name: "BadName",
            type: "select",
          },
        ],
      },
      baseConfig,
      baseConfig.allowedPackages
    );

    expect(invalid.valid).toBe(false);
    expect(invalid.errors).toEqual([
      'Invalid ID format: "builtin.bad-name". Must be namespace.snake_case (e.g., custom.my_operator). Allowed namespaces: custom, user, workspace, admin',
      'Package "unknown" is not in the allowlist. Allowed packages: nirs4all, sklearn',
      "Name is required",
      "Parameter[0]: name must be snake_case (e.g., my_param)",
      "Parameter[0]: select type requires options",
    ]);
  });

  it("keeps allowlist resolution pure and policy-driven", () => {
    expect(resolveAllowedPackages(baseConfig, ["numpy", "nirs4all"])).toEqual([
      "nirs4all",
      "sklearn",
      "numpy",
    ]);

    expect(
      resolveAllowedPackages(
        {
          ...baseConfig,
          allowUserPackages: false,
        },
        ["numpy"]
      )
    ).toEqual(["nirs4all", "sklearn"]);

    expect(validateCustomNode(baseNode, { ...baseConfig, allowCustomNodes: false }, baseConfig.allowedPackages)).toEqual({
      valid: false,
      errors: ["Custom nodes are disabled"],
      warnings: [],
    });
  });

  it("serializes custom node files and reports migration decisions without mutating", () => {
    const file = createCustomNodesFile([baseNode]);

    expect(file).toEqual({
      version: CUSTOM_NODE_STORAGE_VERSION,
      nodes: [baseNode],
    });
    expect(isCustomNodesFile(file)).toBe(true);
    expect(isCustomNodesFile({ version: CUSTOM_NODE_STORAGE_VERSION, nodes: {} })).toBe(false);

    const migration = decideCustomNodesMigration(file, "0.9.0");

    expect(migration).toEqual({
      file,
      migrated: true,
      fromVersion: "0.9.0",
      toVersion: CUSTOM_NODE_STORAGE_VERSION,
    });
    expect(migration.file).toBe(file);
  });

  it("converts workspace API metadata and parameters at the boundary", () => {
    const workspaceNode = convertApiNodeToWorkspaceNode(
      {
        id: "workspace.remote_operator",
        label: "RemoteOperator",
        category: "Workspace",
        description: undefined,
        classPath: "nirs4all.remote.RemoteOperator",
        stepType: "model",
        icon: "box",
        parameters: [
          {
            name: "solver",
            type: "select",
            options: ["lbfgs", "saga"],
          },
        ],
      },
      "2026-06-29T10:00:00.000Z"
    );

    expect(workspaceNode).toMatchObject({
      id: "workspace.remote_operator",
      name: "RemoteOperator",
      type: "model",
      description: "",
      source: "custom",
      _storageSource: "workspace",
      _lastSynced: "2026-06-29T10:00:00.000Z",
    });
    expect(workspaceNode.parameters[0].options).toEqual([
      { value: "lbfgs", label: "lbfgs" },
      { value: "saga", label: "saga" },
    ]);

    expect(convertNodeToWorkspacePayload(baseNode)).toMatchObject({
      id: "custom.my_operator",
      label: "MyOperator",
      category: "Custom",
      classPath: "nirs4all.operators.MyOperator",
      stepType: "preprocessing",
      icon: undefined,
      color: undefined,
      parameters: [
        {
          name: "window_size",
          type: "int",
          min: 1,
          max: 10,
          default: 3,
        },
      ],
    });
  });
});
