/**
 * CustomNodeStorage - Persistent storage for user-defined custom nodes
 *
 * Implements localStorage-based persistence with:
 * - Namespace validation (custom.*, user.*, workspace.*, admin.*)
 * - Security allowlist checking for classPath validation
 * - Import/export functionality
 * - Version tracking for migrations
 * - Workspace-level sync via backend API
 *
 * @see docs/_internals/node_specifications.md Section 6
 * @see docs/_internals/implementation_roadmap.md Phase 5
 */

import type { NodeDefinition, NodeType, CustomNodesFile } from '../types';
import { createLogger } from "@/lib/logger";
import {
  applyCustomNodesImport,
  parseCustomNodesFile,
} from './CustomNodeStorageImport';
import {
  deleteWorkspaceNode,
  fetchWorkspaceNodesIntoCache,
  saveWorkspaceNode,
} from './CustomNodeStorageSync';
import {
  mergeLocalAndWorkspaceNodes,
  projectWorkspaceNodes,
  resolveNodeStorageSource,
} from './CustomNodeStorageWorkspace';
import {
  CUSTOM_NODE_STORAGE_VERSION,
  createCustomNodesFile,
  createDefaultSecurityConfig,
  decideCustomNodesMigration,
  resolveAllowedPackages,
  validateCustomClassPath,
  validateCustomNode,
  validateCustomNodeId,
} from './CustomNodeStoragePolicy';
import {
  readSecurityConfig,
  readStoredCustomNodes,
  readStoredVersion,
  readUserPackages,
  writeSecurityConfig,
  writeStoredCustomNodes,
  writeUserPackages,
} from './CustomNodeStorageLocal';
import {
  DEFAULT_ALLOWED_PACKAGES,
  type CustomNodeSource,
  type CustomNodeSecurityConfig,
  type CustomNodeValidationResult,
  type CustomNodeStorageEvent,
  type TrackedNodeDefinition,
} from './CustomNodeStorageTypes';

const logger = createLogger("CustomNodeStorage");

// Re-export CustomNodesFile for consumers
export type { CustomNodesFile } from '../types';

// Re-export node identity & template helpers (extracted to CustomNodeStorageIdentity).
export {
  NAMESPACE_PRIORITY,
  generateCustomNodeId,
  parseNamespace,
  isCustomNodeId,
  createCustomNodeTemplate,
  createParameterTemplate,
} from './CustomNodeStorageIdentity';
export type { CustomNodeNamespace } from './CustomNodeStorageIdentity';

// ============================================================================
// Types & constants (extracted to CustomNodeStorageTypes; re-exported here)
// ============================================================================

export {
  SOURCE_PRIORITY,
  DEFAULT_ALLOWED_PACKAGES,
} from './CustomNodeStorageTypes';
export type {
  CustomNodeSource,
  CustomNodeSecurityConfig,
  CustomNodeValidationResult,
  CustomNodeStorageEvent,
  TrackedNodeDefinition,
} from './CustomNodeStorageTypes';

// ============================================================================
// Storage Keys
// ============================================================================

const CURRENT_VERSION = CUSTOM_NODE_STORAGE_VERSION;

// ============================================================================
// CustomNodeStorage Class
// ============================================================================

/**
 * CustomNodeStorage - Manages persistent storage of custom node definitions.
 *
 * @example
 * const storage = CustomNodeStorage.getInstance();
 * storage.add(myCustomNode);
 * const customNodes = storage.getAll();
 */
export class CustomNodeStorage {
  private static instance: CustomNodeStorage | null = null;

  private nodes: Map<string, NodeDefinition>;
  private securityConfig: CustomNodeSecurityConfig;
  private listeners: Set<(event: CustomNodeStorageEvent) => void>;

  private constructor() {
    this.nodes = new Map();
    this.listeners = new Set();
    this.securityConfig = this.loadSecurityConfig();
    this.loadFromStorage();
  }

  /**
   * Get the singleton instance.
   */
  static getInstance(): CustomNodeStorage {
    if (!CustomNodeStorage.instance) {
      CustomNodeStorage.instance = new CustomNodeStorage();
    }
    return CustomNodeStorage.instance;
  }

  /**
   * Reset the singleton (for testing).
   */
  static resetInstance(): void {
    CustomNodeStorage.instance = null;
  }

  // ===========================================================================
  // CRUD Operations
  // ===========================================================================

  /**
   * Add a custom node.
   * @throws Error if node is invalid
   */
  add(node: NodeDefinition): void {
    const validation = this.validate(node);
    if (!validation.valid) {
      throw new Error(`Invalid custom node: ${validation.errors.join(', ')}`);
    }

    // Ensure source is 'custom'
    const customNode: NodeDefinition = {
      ...node,
      source: 'custom',
    };

    this.nodes.set(customNode.id, customNode);
    this.saveToStorage();
    this.emit({ type: 'add', nodeId: customNode.id, timestamp: Date.now() });
  }

  /**
   * Update an existing custom node.
   * @throws Error if node doesn't exist or is invalid
   */
  update(nodeId: string, updates: Partial<NodeDefinition>): void {
    const existing = this.nodes.get(nodeId);
    if (!existing) {
      throw new Error(`Custom node not found: ${nodeId}`);
    }

    const updated: NodeDefinition = {
      ...existing,
      ...updates,
      id: nodeId, // Prevent ID change
      source: 'custom', // Ensure source stays custom
    };

    const validation = this.validate(updated);
    if (!validation.valid) {
      throw new Error(`Invalid custom node: ${validation.errors.join(', ')}`);
    }

    this.nodes.set(nodeId, updated);
    this.saveToStorage();
    this.emit({ type: 'update', nodeId, timestamp: Date.now() });
  }

  /**
   * Remove a custom node by ID.
   */
  remove(nodeId: string): boolean {
    const existed = this.nodes.delete(nodeId);
    if (existed) {
      this.saveToStorage();
      this.emit({ type: 'remove', nodeId, timestamp: Date.now() });
    }
    return existed;
  }

  /**
   * Get a custom node by ID.
   */
  get(nodeId: string): NodeDefinition | undefined {
    return this.nodes.get(nodeId);
  }

  /**
   * Get all custom nodes.
   */
  getAll(): NodeDefinition[] {
    return Array.from(this.nodes.values());
  }

  /**
   * Get custom nodes by type.
   */
  getByType(type: NodeType): NodeDefinition[] {
    return this.getAll().filter(node => node.type === type);
  }

  /**
   * Check if a custom node exists.
   */
  has(nodeId: string): boolean {
    return this.nodes.has(nodeId);
  }

  /**
   * Get the count of custom nodes.
   */
  get size(): number {
    return this.nodes.size;
  }

  /**
   * Clear all custom nodes.
   */
  clear(): void {
    this.nodes.clear();
    this.saveToStorage();
    this.emit({ type: 'clear', timestamp: Date.now() });
  }

  // ===========================================================================
  // Validation
  // ===========================================================================

  /**
   * Validate a custom node definition.
   */
  validate(node: NodeDefinition): CustomNodeValidationResult {
    return validateCustomNode(node, this.securityConfig, this.getAllowedPackages());
  }

  /**
   * Validate a node ID follows namespace rules.
   */
  validateNodeId(id: string): { valid: boolean; errors: string[] } {
    return validateCustomNodeId(id);
  }

  /**
   * Validate a classPath against the security allowlist.
   */
  validateClassPath(classPath: string): { valid: boolean; errors: string[] } {
    return validateCustomClassPath(classPath, this.getAllowedPackages());
  }

  // ===========================================================================
  // Security Configuration
  // ===========================================================================

  /**
   * Get the current security configuration.
   */
  getSecurityConfig(): CustomNodeSecurityConfig {
    return { ...this.securityConfig };
  }

  /**
   * Update the security configuration.
   */
  updateSecurityConfig(updates: Partial<CustomNodeSecurityConfig>): void {
    this.securityConfig = {
      ...this.securityConfig,
      ...updates,
    };
    this.saveSecurityConfig();
  }

  /**
   * Get all allowed packages (default + user-defined).
   */
  getAllowedPackages(): string[] {
    return resolveAllowedPackages(this.securityConfig, this.loadUserPackages());
  }

  /**
   * Add a user-defined package to the allowlist.
   */
  addUserPackage(packageName: string): void {
    if (!this.securityConfig.allowUserPackages) {
      throw new Error('User packages are not allowed by admin policy');
    }

    const packages = this.loadUserPackages();
    if (!packages.includes(packageName)) {
      packages.push(packageName);
      this.saveUserPackages(packages);
    }
  }

  /**
   * Remove a user-defined package from the allowlist.
   */
  removeUserPackage(packageName: string): void {
    const packages = this.loadUserPackages().filter(p => p !== packageName);
    this.saveUserPackages(packages);
  }

  /**
   * Get user-defined packages.
   */
  getUserPackages(): string[] {
    return this.loadUserPackages();
  }

  // ===========================================================================
  // Import/Export
  // ===========================================================================

  /**
   * Export custom nodes to JSON format.
   */
  export(): CustomNodesFile {
    return createCustomNodesFile(this.getAll(), CURRENT_VERSION);
  }

  /**
   * Export custom nodes as a downloadable JSON string.
   */
  exportToString(): string {
    return JSON.stringify(this.export(), null, 2);
  }

  /**
   * Import custom nodes from JSON format.
   * @param mode 'merge' adds to existing, 'replace' clears first
   */
  import(data: CustomNodesFile, mode: 'merge' | 'replace' = 'merge'): {
    imported: number;
    skipped: number;
    errors: string[];
  } {
    const result = applyCustomNodesImport(
      this.nodes,
      data,
      (node) => this.validate(node),
      mode
    );

    if (result.imported > 0) {
      this.saveToStorage();
      this.emit({ type: 'import', timestamp: Date.now() });
    }

    return result;
  }

  /**
   * Import custom nodes from a JSON string.
   */
  importFromString(jsonString: string, mode: 'merge' | 'replace' = 'merge'): {
    imported: number;
    skipped: number;
    errors: string[];
  } {
    const parsed = parseCustomNodesFile(jsonString);
    if (!parsed.success) {
      return { imported: 0, skipped: 0, errors: ['Invalid JSON format'] };
    }
    return this.import(parsed.data, mode);
  }

  // ===========================================================================
  // Workspace Sync
  // ===========================================================================

  /** Track workspace nodes separately */
  private workspaceNodes: Map<string, TrackedNodeDefinition> = new Map();

  /** Track sync state */
  private lastWorkspaceSync: Date | null = null;
  private syncInProgress = false;

  /**
   * Sync with workspace-level custom nodes from the backend.
   * This merges workspace nodes with local nodes, with workspace taking priority.
   */
  async syncWithWorkspace(): Promise<{
    success: boolean;
    workspaceCount: number;
    localCount: number;
    error?: string;
  }> {
    if (this.syncInProgress) {
      return {
        success: false,
        workspaceCount: 0,
        localCount: this.nodes.size,
        error: 'Sync already in progress',
      };
    }

    this.syncInProgress = true;

    try {
      const result = await fetchWorkspaceNodesIntoCache(
        this.workspaceNodes,
        this.nodes.size,
        DEFAULT_ALLOWED_PACKAGES
      );

      if (result.securityConfig) {
        this.securityConfig = result.securityConfig;
        this.saveSecurityConfig();
      }

      if (result.success) {
        this.lastWorkspaceSync = new Date();
        this.emit({ type: 'sync', timestamp: Date.now() });
      }

      const syncResult = {
        success: result.success,
        workspaceCount: result.workspaceCount,
        localCount: result.localCount,
      };
      return result.error ? { ...syncResult, error: result.error } : syncResult;
    } finally {
      this.syncInProgress = false;
    }
  }

  /**
   * Get all custom nodes (merged from local and workspace).
   * Workspace nodes take priority over local nodes with same ID.
   */
  getAllMerged(): NodeDefinition[] {
    return mergeLocalAndWorkspaceNodes(this.nodes, this.workspaceNodes);
  }

  /**
   * Get only workspace-level nodes.
   */
  getWorkspaceNodes(): NodeDefinition[] {
    return projectWorkspaceNodes(this.workspaceNodes);
  }

  /**
   * Get only local (browser-stored) nodes.
   */
  getLocalNodes(): NodeDefinition[] {
    return this.getAll();
  }

  /**
   * Check if a node is from workspace or local.
   */
  getNodeSource(nodeId: string): CustomNodeSource | null {
    return resolveNodeStorageSource(nodeId, this.nodes, this.workspaceNodes);
  }

  /**
   * Save a node to workspace (backend).
   */
  async saveToWorkspace(node: NodeDefinition): Promise<boolean> {
    const success = await saveWorkspaceNode(node, this.workspaceNodes);
    if (success) {
      this.emit({ type: 'sync', timestamp: Date.now() });
    }
    return success;
  }

  /**
   * Delete a node from workspace (backend).
   */
  async deleteFromWorkspace(nodeId: string): Promise<boolean> {
    const success = await deleteWorkspaceNode(nodeId, this.workspaceNodes);
    if (success) {
      this.emit({ type: 'sync', timestamp: Date.now() });
    }
    return success;
  }

  /**
   * Promote a local node to workspace (saves to backend).
   */
  async promoteToWorkspace(nodeId: string): Promise<boolean> {
    const node = this.nodes.get(nodeId);
    if (!node) return false;

    const success = await this.saveToWorkspace(node);
    if (success) {
      // Optionally remove from local storage
      this.nodes.delete(nodeId);
      this.saveToStorage();
    }
    return success;
  }

  /**
   * Get last workspace sync time.
   */
  getLastSyncTime(): Date | null {
    return this.lastWorkspaceSync;
  }

  /**
   * Check if sync is in progress.
   */
  isSyncing(): boolean {
    return this.syncInProgress;
  }

  // ===========================================================================
  // Event Listeners
  // ===========================================================================

  /**
   * Subscribe to storage events.
   */
  subscribe(listener: (event: CustomNodeStorageEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: CustomNodeStorageEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (err) {
        logger.error('Listener error:', err);
      }
    }
  }

  // ===========================================================================
  // Persistence
  // ===========================================================================

  private loadFromStorage(): void {
    const data = readStoredCustomNodes();
    if (!data) {
      return;
    }
    const migratedData = this.migrateIfNeeded(data);
    for (const node of migratedData.nodes) {
      this.nodes.set(node.id, node);
    }
  }

  private saveToStorage(): void {
    writeStoredCustomNodes(this.getAll(), CURRENT_VERSION);
  }

  private loadSecurityConfig(): CustomNodeSecurityConfig {
    return readSecurityConfig(createDefaultSecurityConfig(DEFAULT_ALLOWED_PACKAGES));
  }

  private saveSecurityConfig(): void {
    writeSecurityConfig(this.securityConfig);
  }

  private loadUserPackages(): string[] {
    return readUserPackages();
  }

  private saveUserPackages(packages: string[]): void {
    writeUserPackages(packages);
  }

  private migrateIfNeeded(data: CustomNodesFile): CustomNodesFile {
    const storedVersion = readStoredVersion();
    const migration = decideCustomNodesMigration(data, storedVersion, CURRENT_VERSION);

    if (migration.migrated) {
      logger.info(`Migrating custom nodes from ${migration.fromVersion} to ${migration.toVersion}`);
    }

    return migration.file;
  }
}
