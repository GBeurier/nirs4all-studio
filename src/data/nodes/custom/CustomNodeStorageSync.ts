import type { NodeDefinition } from '../types';
import * as api from '@/api/customNodes';
import { createLogger } from '@/lib/logger';
import {
  convertApiNodeToWorkspaceNode,
  convertNodeToWorkspacePayload,
  convertWorkspaceSettingsToSecurityConfig,
} from './CustomNodeStoragePolicy';
import type { CustomNodeSecurityConfig, TrackedNodeDefinition } from './CustomNodeStorage';

const logger = createLogger('CustomNodeStorage');

export interface WorkspaceSyncResult {
  success: boolean;
  workspaceCount: number;
  localCount: number;
  securityConfig?: CustomNodeSecurityConfig;
  error?: string;
}

export async function fetchWorkspaceNodesIntoCache(
  workspaceNodes: Map<string, TrackedNodeDefinition>,
  localCount: number,
  defaultAllowedPackages: string[]
): Promise<WorkspaceSyncResult> {
  try {
    const response = await api.getCustomNodes();

    workspaceNodes.clear();

    for (const node of response.nodes) {
      const tracked: TrackedNodeDefinition = convertApiNodeToWorkspaceNode(
        node,
        new Date().toISOString()
      );
      workspaceNodes.set(node.id, tracked);
    }

    const result: WorkspaceSyncResult = {
      success: true,
      workspaceCount: workspaceNodes.size,
      localCount,
    };

    if (response.settings) {
      result.securityConfig = convertWorkspaceSettingsToSecurityConfig(
        response.settings,
        defaultAllowedPackages
      );
    }

    return result;
  } catch (err) {
    logger.error('Failed to sync with workspace:', err);
    return {
      success: false,
      workspaceCount: workspaceNodes.size,
      localCount,
      error: (err as Error).message,
    };
  }
}

export async function saveWorkspaceNode(
  node: NodeDefinition,
  workspaceNodes: Map<string, TrackedNodeDefinition>
): Promise<boolean> {
  try {
    const apiNode = convertNodeToWorkspacePayload(node);

    if (workspaceNodes.has(node.id)) {
      await api.updateCustomNode(node.id, apiNode);
    } else {
      await api.addCustomNode(apiNode);
    }

    const tracked: TrackedNodeDefinition = {
      ...node,
      _storageSource: 'workspace',
      _lastSynced: new Date().toISOString(),
    };
    workspaceNodes.set(node.id, tracked);

    return true;
  } catch (err) {
    logger.error('Failed to save node to workspace:', err);
    return false;
  }
}

export async function deleteWorkspaceNode(
  nodeId: string,
  workspaceNodes: Map<string, TrackedNodeDefinition>
): Promise<boolean> {
  try {
    await api.deleteCustomNode(nodeId);
    workspaceNodes.delete(nodeId);
    return true;
  } catch (err) {
    logger.error('Failed to delete node from workspace:', err);
    return false;
  }
}
