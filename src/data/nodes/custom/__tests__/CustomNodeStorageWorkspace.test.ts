import { describe, expect, it } from "vitest";
import type { NodeDefinition } from "../../types";
import type { TrackedNodeDefinition } from "../CustomNodeStorage";
import {
  mergeLocalAndWorkspaceNodes,
  projectWorkspaceNodes,
  resolveNodeStorageSource,
} from "../CustomNodeStorageWorkspace";

const createNode = (id: string, name: string): NodeDefinition => ({
  id,
  name,
  type: "preprocessing",
  description: `${name} description`,
  category: "Custom",
  source: "custom",
  classPath: "nirs4all.operators.Custom",
  parameters: [],
});

const createWorkspaceNode = (id: string, name: string): TrackedNodeDefinition => ({
  ...createNode(id, name),
  _storageSource: "workspace",
  _lastSynced: "2026-06-29T10:00:00.000Z",
});

describe("CustomNodeStorageWorkspace", () => {
  it("merges local and workspace nodes with workspace definitions taking priority", () => {
    const sharedLocal = createNode("custom.shared", "LocalShared");
    const localOnly = createNode("custom.local_only", "LocalOnly");
    const sharedWorkspace = createWorkspaceNode("custom.shared", "WorkspaceShared");
    const workspaceOnly = createWorkspaceNode("workspace.remote_only", "RemoteOnly");

    const merged = mergeLocalAndWorkspaceNodes(
      new Map([
        [sharedLocal.id, sharedLocal],
        [localOnly.id, localOnly],
      ]),
      new Map([
        [sharedWorkspace.id, sharedWorkspace],
        [workspaceOnly.id, workspaceOnly],
      ])
    );

    expect(merged.map(node => node.id)).toEqual([
      "custom.shared",
      "custom.local_only",
      "workspace.remote_only",
    ]);
    expect(merged[0]).toBe(sharedWorkspace);
    expect(merged[1]).toMatchObject({
      id: "custom.local_only",
      _storageSource: "local",
    });
    expect(localOnly).not.toHaveProperty("_storageSource");
  });

  it("projects workspace nodes without including local-only data", () => {
    const workspaceNode = createWorkspaceNode("workspace.remote", "Remote");
    const projected = projectWorkspaceNodes(new Map([[workspaceNode.id, workspaceNode]]));

    expect(projected).toEqual([workspaceNode]);
  });

  it("resolves workspace source before local source for duplicate IDs", () => {
    const localNodes = new Map([
      ["custom.shared", createNode("custom.shared", "LocalShared")],
      ["custom.local", createNode("custom.local", "Local")],
    ]);
    const workspaceNodes = new Map([
      ["custom.shared", createWorkspaceNode("custom.shared", "WorkspaceShared")],
    ]);

    expect(resolveNodeStorageSource("custom.shared", localNodes, workspaceNodes)).toBe("workspace");
    expect(resolveNodeStorageSource("custom.local", localNodes, workspaceNodes)).toBe("local");
    expect(resolveNodeStorageSource("custom.missing", localNodes, workspaceNodes)).toBeNull();
  });
});
