import type { NodeDefinition } from '../types';
import type { CustomNodeSource, TrackedNodeDefinition } from './CustomNodeStorage';

export function mergeLocalAndWorkspaceNodes(
  localNodes: ReadonlyMap<string, NodeDefinition>,
  workspaceNodes: ReadonlyMap<string, TrackedNodeDefinition>
): TrackedNodeDefinition[] {
  const merged = new Map<string, TrackedNodeDefinition>();

  for (const [id, node] of localNodes) {
    merged.set(id, { ...node, _storageSource: 'local' });
  }

  for (const [id, node] of workspaceNodes) {
    merged.set(id, node);
  }

  return Array.from(merged.values());
}

export function projectWorkspaceNodes(
  workspaceNodes: ReadonlyMap<string, TrackedNodeDefinition>
): NodeDefinition[] {
  return Array.from(workspaceNodes.values());
}

export function resolveNodeStorageSource(
  nodeId: string,
  localNodes: ReadonlyMap<string, NodeDefinition>,
  workspaceNodes: ReadonlyMap<string, TrackedNodeDefinition>
): CustomNodeSource | null {
  if (workspaceNodes.has(nodeId)) return 'workspace';
  if (localNodes.has(nodeId)) return 'local';
  return null;
}
