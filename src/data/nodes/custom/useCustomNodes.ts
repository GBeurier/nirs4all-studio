/**
 * useCustomNodes - React hook for custom node management
 *
 * Provides reactive access to custom nodes with automatic
 * updates when nodes change. Supports both local (localStorage)
 * and workspace-level (backend) custom nodes.
 *
 * @example
 * const { customNodes, addNode, removeNode, isEnabled, syncWithWorkspace } = useCustomNodes();
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  CustomNodeStorage,
  type CustomNodeValidationResult,
  type CustomNodeSecurityConfig,
  type CustomNodesFile,
  type CustomNodeSource,
  generateCustomNodeId,
  createCustomNodeTemplate,
  createParameterTemplate,
} from './CustomNodeStorage';
import type { NodeDefinition, NodeType, ParameterDefinition } from '../types';

export interface UseCustomNodesReturn {
  // State
  customNodes: NodeDefinition[];
  localNodes: NodeDefinition[];
  workspaceNodes: NodeDefinition[];
  isEnabled: boolean;
  isLoading: boolean;
  isSyncing: boolean;
  error: string | null;

  // CRUD (local)
  addNode: (node: NodeDefinition) => { success: boolean; error?: string };
  updateNode: (nodeId: string, updates: Partial<NodeDefinition>) => { success: boolean; error?: string };
  removeNode: (nodeId: string) => boolean;
  getNode: (nodeId: string) => NodeDefinition | undefined;
  getNodeSource: (nodeId: string) => CustomNodeSource | null;
  clearAll: () => void;

  // Workspace operations
  syncWithWorkspace: () => Promise<{ success: boolean; error?: string }>;
  saveToWorkspace: (node: NodeDefinition) => Promise<boolean>;
  deleteFromWorkspace: (nodeId: string) => Promise<boolean>;
  promoteToWorkspace: (nodeId: string) => Promise<boolean>;
  lastSyncTime: Date | null;

  // Validation
  validateNode: (node: NodeDefinition) => CustomNodeValidationResult;
  validateClassPath: (classPath: string) => { valid: boolean; errors: string[] };

  // Import/Export
  exportNodes: () => string;
  importNodes: (json: string, mode?: 'merge' | 'replace') => {
    imported: number;
    skipped: number;
    errors: string[];
  };

  // Security
  securityConfig: CustomNodeSecurityConfig;
  updateSecurityConfig: (updates: Partial<CustomNodeSecurityConfig>) => void;
  allowedPackages: string[];
  addUserPackage: (packageName: string) => { success: boolean; error?: string };
  removeUserPackage: (packageName: string) => void;

  // Helpers
  generateId: (name: string) => string;
  createTemplate: (type: NodeType) => NodeDefinition;
  createParameterTemplate: () => ParameterDefinition;

  // Refresh
  refresh: () => void;
}

/**
 * Hook for managing custom nodes with reactive updates.
 */
export function useCustomNodes(): UseCustomNodesReturn {
  const [customNodes, setCustomNodes] = useState<NodeDefinition[]>([]);
  const [localNodes, setLocalNodes] = useState<NodeDefinition[]>([]);
  const [workspaceNodes, setWorkspaceNodes] = useState<NodeDefinition[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSyncTime, setLastSyncTime] = useState<Date | null>(null);
  const [securityConfig, setSecurityConfig] = useState<CustomNodeSecurityConfig>(() =>
    CustomNodeStorage.getInstance().getSecurityConfig()
  );

  // Load initial data and subscribe to changes
  useEffect(() => {
    const storage = CustomNodeStorage.getInstance();

    // Initial load
    setLocalNodes(storage.getLocalNodes());
    setWorkspaceNodes(storage.getWorkspaceNodes());
    setCustomNodes(storage.getAllMerged());
    setSecurityConfig(storage.getSecurityConfig());
    setLastSyncTime(storage.getLastSyncTime());
    setIsLoading(false);

    // Subscribe to changes
    const unsubscribe = storage.subscribe(() => {
      setLocalNodes(storage.getLocalNodes());
      setWorkspaceNodes(storage.getWorkspaceNodes());
      setCustomNodes(storage.getAllMerged());
      setSecurityConfig(storage.getSecurityConfig());
      setLastSyncTime(storage.getLastSyncTime());
    });

    return unsubscribe;
  }, []);

  // Refresh data
  const refresh = useCallback(() => {
    const storage = CustomNodeStorage.getInstance();
    setLocalNodes(storage.getLocalNodes());
    setWorkspaceNodes(storage.getWorkspaceNodes());
    setCustomNodes(storage.getAllMerged());
    setSecurityConfig(storage.getSecurityConfig());
    setLastSyncTime(storage.getLastSyncTime());
  }, []);

  // Add node
  const addNode = useCallback((node: NodeDefinition): { success: boolean; error?: string } => {
    try {
      const storage = CustomNodeStorage.getInstance();
      storage.add(node);
      setError(null);
      return { success: true };
    } catch (err) {
      const message = (err as Error).message;
      setError(message);
      return { success: false, error: message };
    }
  }, []);

  // Update node
  const updateNode = useCallback(
    (nodeId: string, updates: Partial<NodeDefinition>): { success: boolean; error?: string } => {
      try {
        const storage = CustomNodeStorage.getInstance();
        storage.update(nodeId, updates);
        setError(null);
        return { success: true };
      } catch (err) {
        const message = (err as Error).message;
        setError(message);
        return { success: false, error: message };
      }
    },
    []
  );

  // Remove node
  const removeNode = useCallback((nodeId: string): boolean => {
    const storage = CustomNodeStorage.getInstance();
    const result = storage.remove(nodeId);
    setError(null);
    return result;
  }, []);

  // Get node
  const getNode = useCallback((nodeId: string): NodeDefinition | undefined => {
    const storage = CustomNodeStorage.getInstance();
    return storage.get(nodeId);
  }, []);

  // Clear all
  const clearAll = useCallback(() => {
    const storage = CustomNodeStorage.getInstance();
    storage.clear();
    setError(null);
  }, []);

  // Validate node
  const validateNode = useCallback((node: NodeDefinition): CustomNodeValidationResult => {
    const storage = CustomNodeStorage.getInstance();
    return storage.validate(node);
  }, []);

  // Validate classPath
  const validateClassPath = useCallback(
    (classPath: string): { valid: boolean; errors: string[] } => {
      const storage = CustomNodeStorage.getInstance();
      return storage.validateClassPath(classPath);
    },
    []
  );

  // Export nodes
  const exportNodes = useCallback((): string => {
    const storage = CustomNodeStorage.getInstance();
    return storage.exportToString();
  }, []);

  // Import nodes
  const importNodes = useCallback(
    (json: string, mode: 'merge' | 'replace' = 'merge') => {
      const storage = CustomNodeStorage.getInstance();
      return storage.importFromString(json, mode);
    },
    []
  );

  // Update security config
  const updateSecurityConfigCallback = useCallback(
    (updates: Partial<CustomNodeSecurityConfig>) => {
      const storage = CustomNodeStorage.getInstance();
      storage.updateSecurityConfig(updates);
      setSecurityConfig(storage.getSecurityConfig());
    },
    []
  );

  // Get allowed packages
  const allowedPackages = useMemo(() => {
    const storage = CustomNodeStorage.getInstance();
    return storage.getAllowedPackages();
  }, [securityConfig]);

  // Add user package
  const addUserPackage = useCallback(
    (packageName: string): { success: boolean; error?: string } => {
      try {
        const storage = CustomNodeStorage.getInstance();
        storage.addUserPackage(packageName);
        setSecurityConfig(storage.getSecurityConfig());
        return { success: true };
      } catch (err) {
        return { success: false, error: (err as Error).message };
      }
    },
    []
  );

  // Remove user package
  const removeUserPackage = useCallback((packageName: string) => {
    const storage = CustomNodeStorage.getInstance();
    storage.removeUserPackage(packageName);
    setSecurityConfig(storage.getSecurityConfig());
  }, []);

  // Generate ID helper
  const generateId = useCallback((name: string): string => {
    return generateCustomNodeId(name);
  }, []);

  // Create template helper
  const createTemplate = useCallback((type: NodeType): NodeDefinition => {
    return createCustomNodeTemplate(type);
  }, []);

  // Get node source (local or workspace)
  const getNodeSource = useCallback((nodeId: string): CustomNodeSource | null => {
    const storage = CustomNodeStorage.getInstance();
    return storage.getNodeSource(nodeId);
  }, []);

  // Sync with workspace (backend)
  const syncWithWorkspace = useCallback(async (): Promise<{ success: boolean; error?: string }> => {
    setIsSyncing(true);
    setError(null);

    try {
      const storage = CustomNodeStorage.getInstance();
      const result = await storage.syncWithWorkspace();

      if (!result.success) {
        setError(result.error || 'Sync failed');
        return { success: false, error: result.error };
      }

      refresh();
      return { success: true };
    } catch (err) {
      const message = (err as Error).message;
      setError(message);
      return { success: false, error: message };
    } finally {
      setIsSyncing(false);
    }
  }, [refresh]);

  // Save node to workspace
  const saveToWorkspace = useCallback(async (node: NodeDefinition): Promise<boolean> => {
    try {
      const storage = CustomNodeStorage.getInstance();
      const success = await storage.saveToWorkspace(node);
      if (success) {
        refresh();
      }
      return success;
    } catch (err) {
      setError((err as Error).message);
      return false;
    }
  }, [refresh]);

  // Delete from workspace
  const deleteFromWorkspace = useCallback(async (nodeId: string): Promise<boolean> => {
    try {
      const storage = CustomNodeStorage.getInstance();
      const success = await storage.deleteFromWorkspace(nodeId);
      if (success) {
        refresh();
      }
      return success;
    } catch (err) {
      setError((err as Error).message);
      return false;
    }
  }, [refresh]);

  // Promote local node to workspace
  const promoteToWorkspace = useCallback(async (nodeId: string): Promise<boolean> => {
    try {
      const storage = CustomNodeStorage.getInstance();
      const success = await storage.promoteToWorkspace(nodeId);
      if (success) {
        refresh();
      }
      return success;
    } catch (err) {
      setError((err as Error).message);
      return false;
    }
  }, [refresh]);

  const isEnabled = securityConfig.allowCustomNodes;

  return {
    customNodes,
    localNodes,
    workspaceNodes,
    isEnabled,
    isLoading,
    isSyncing,
    error,
    addNode,
    updateNode,
    removeNode,
    getNode,
    getNodeSource,
    clearAll,
    syncWithWorkspace,
    saveToWorkspace,
    deleteFromWorkspace,
    promoteToWorkspace,
    lastSyncTime,
    validateNode,
    validateClassPath,
    exportNodes,
    importNodes,
    securityConfig,
    updateSecurityConfig: updateSecurityConfigCallback,
    allowedPackages,
    addUserPackage,
    removeUserPackage,
    generateId,
    createTemplate,
    createParameterTemplate,
    refresh,
  };
}

export type { CustomNodeValidationResult, CustomNodeSecurityConfig, CustomNodesFile, CustomNodeSource };
