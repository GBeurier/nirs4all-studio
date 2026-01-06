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

import type { NodeDefinition, NodeType, ParameterDefinition, ParameterType, CustomNodesFile } from '../types';
import * as api from '@/api/client';

// Re-export CustomNodesFile for consumers
export type { CustomNodesFile } from '../types';

// ============================================================================
// Types
// ============================================================================

/**
 * Allowed namespace prefixes for custom node IDs.
 */
export type CustomNodeNamespace = 'custom' | 'user' | 'workspace' | 'admin';

/**
 * Source of a custom node.
 */
export type CustomNodeSource = 'local' | 'workspace' | 'admin';

/**
 * Priority levels for namespace resolution.
 * Higher priority = wins on conflict.
 */
export const NAMESPACE_PRIORITY: Record<CustomNodeNamespace, number> = {
  admin: 100,
  workspace: 50,
  user: 25,
  custom: 25, // Same priority as user
};

/**
 * Priority levels for source resolution.
 * Higher priority = wins on conflict.
 */
export const SOURCE_PRIORITY: Record<CustomNodeSource, number> = {
  admin: 100,
  workspace: 50,
  local: 25,
};

/**
 * Default allowed packages for custom node classPath validation.
 */
export const DEFAULT_ALLOWED_PACKAGES = [
  'nirs4all',
  'sklearn',
  'scipy',
  'numpy',
  'pandas',
];

/**
 * Configuration for custom node security.
 */
export interface CustomNodeSecurityConfig {
  /** Master switch for custom nodes */
  allowCustomNodes: boolean;
  /** Allowed package prefixes for classPath */
  allowedPackages: string[];
  /** Require admin approval for custom nodes */
  requireApproval: boolean;
  /** Allow users to add packages to allowlist */
  allowUserPackages: boolean;
}

/**
 * Result of validating a custom node definition.
 */
export interface CustomNodeValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Storage event for custom node changes.
 */
export interface CustomNodeStorageEvent {
  type: 'add' | 'update' | 'remove' | 'clear' | 'import' | 'sync';
  nodeId?: string;
  timestamp: number;
}

/**
 * Extended node definition with source tracking.
 */
export interface TrackedNodeDefinition extends NodeDefinition {
  _storageSource?: CustomNodeSource;
  _lastSynced?: string;
}

// ============================================================================
// Storage Keys
// ============================================================================

const STORAGE_KEYS = {
  CUSTOM_NODES: 'nirs4all_custom_nodes',
  SECURITY_CONFIG: 'nirs4all_custom_nodes_security',
  USER_PACKAGES: 'nirs4all_custom_nodes_packages',
  VERSION: 'nirs4all_custom_nodes_version',
} as const;

const CURRENT_VERSION = '1.0.0';

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
    const errors: string[] = [];
    const warnings: string[] = [];

    // Check if custom nodes are allowed
    if (!this.securityConfig.allowCustomNodes) {
      errors.push('Custom nodes are disabled');
      return { valid: false, errors, warnings };
    }

    // Validate ID format
    const idValidation = this.validateNodeId(node.id);
    if (!idValidation.valid) {
      errors.push(...idValidation.errors);
    }

    // Validate classPath against allowlist
    if (node.classPath) {
      const classPathValidation = this.validateClassPath(node.classPath);
      if (!classPathValidation.valid) {
        errors.push(...classPathValidation.errors);
      }
    }

    // Validate required fields
    if (!node.name || node.name.trim().length === 0) {
      errors.push('Name is required');
    }

    if (!node.type) {
      errors.push('Type is required');
    }

    if (!node.description || node.description.trim().length === 0) {
      errors.push('Description is required');
    }

    if (!Array.isArray(node.parameters)) {
      errors.push('Parameters must be an array');
    } else {
      // Validate each parameter
      for (let i = 0; i < node.parameters.length; i++) {
        const param = node.parameters[i];
        const paramErrors = this.validateParameter(param, i);
        errors.push(...paramErrors);
      }
    }

    // Check for duplicate ID (allow update of existing)
    // Note: This only checks within custom nodes, not builtin
    // The registry handles overall conflict detection

    // Warnings for optional but recommended fields
    if (!node.category) {
      warnings.push('Consider adding a category for better organization');
    }

    if (!node.classPath) {
      warnings.push('No classPath specified - node will not be executable');
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Validate a node ID follows namespace rules.
   */
  validateNodeId(id: string): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!id || typeof id !== 'string') {
      errors.push('Node ID is required');
      return { valid: false, errors };
    }

    // Must follow format: namespace.name
    const idPattern = /^(custom|user|workspace|admin)\.[a-z][a-z0-9_]*$/;
    if (!idPattern.test(id)) {
      errors.push(
        `Invalid ID format: "${id}". Must be namespace.snake_case (e.g., custom.my_operator). ` +
        `Allowed namespaces: custom, user, workspace, admin`
      );
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Validate a classPath against the security allowlist.
   */
  validateClassPath(classPath: string): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!classPath || typeof classPath !== 'string') {
      return { valid: true, errors }; // Optional field
    }

    // Extract package root from classPath
    const packageRoot = classPath.split('.')[0];

    const allowedPackages = this.getAllowedPackages();
    const isAllowed = allowedPackages.some(pkg =>
      classPath.startsWith(pkg + '.') || classPath === pkg
    );

    if (!isAllowed) {
      errors.push(
        `Package "${packageRoot}" is not in the allowlist. ` +
        `Allowed packages: ${allowedPackages.join(', ')}`
      );
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Validate a parameter definition.
   */
  private validateParameter(param: ParameterDefinition, index: number): string[] {
    const errors: string[] = [];
    const prefix = `Parameter[${index}]`;

    if (!param.name || param.name.trim().length === 0) {
      errors.push(`${prefix}: name is required`);
    } else if (!/^[a-z][a-z0-9_]*$/.test(param.name)) {
      errors.push(`${prefix}: name must be snake_case (e.g., my_param)`);
    }

    if (!param.type) {
      errors.push(`${prefix}: type is required`);
    } else {
      const validTypes = ['int', 'float', 'bool', 'string', 'select', 'array', 'object'];
      if (!validTypes.includes(param.type)) {
        errors.push(`${prefix}: invalid type "${param.type}". Valid: ${validTypes.join(', ')}`);
      }
    }

    // Validate select options
    if (param.type === 'select' && (!param.options || param.options.length === 0)) {
      errors.push(`${prefix}: select type requires options`);
    }

    // Validate numeric constraints
    if (param.type === 'int' || param.type === 'float') {
      if (param.min !== undefined && param.max !== undefined && param.min > param.max) {
        errors.push(`${prefix}: min cannot be greater than max`);
      }
    }

    return errors;
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
    const userPackages = this.securityConfig.allowUserPackages
      ? this.loadUserPackages()
      : [];
    return [...new Set([...this.securityConfig.allowedPackages, ...userPackages])];
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
    return {
      version: CURRENT_VERSION,
      nodes: this.getAll(),
    };
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
    const errors: string[] = [];
    let imported = 0;
    let skipped = 0;

    // Validate file format
    if (!data.version || !Array.isArray(data.nodes)) {
      errors.push('Invalid file format');
      return { imported: 0, skipped: 0, errors };
    }

    if (mode === 'replace') {
      this.nodes.clear();
    }

    for (const node of data.nodes) {
      try {
        // Validate each node
        const validation = this.validate(node);
        if (!validation.valid) {
          errors.push(`${node.id || 'unknown'}: ${validation.errors.join(', ')}`);
          skipped++;
          continue;
        }

        // Check for existing in merge mode
        if (mode === 'merge' && this.nodes.has(node.id)) {
          // Skip duplicates in merge mode
          skipped++;
          continue;
        }

        this.nodes.set(node.id, { ...node, source: 'custom' });
        imported++;
      } catch (err) {
        errors.push(`${node.id || 'unknown'}: ${(err as Error).message}`);
        skipped++;
      }
    }

    if (imported > 0) {
      this.saveToStorage();
      this.emit({ type: 'import', timestamp: Date.now() });
    }

    return { imported, skipped, errors };
  }

  /**
   * Import custom nodes from a JSON string.
   */
  importFromString(jsonString: string, mode: 'merge' | 'replace' = 'merge'): {
    imported: number;
    skipped: number;
    errors: string[];
  } {
    try {
      const data = JSON.parse(jsonString) as CustomNodesFile;
      return this.import(data, mode);
    } catch {
      return { imported: 0, skipped: 0, errors: ['Invalid JSON format'] };
    }
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
      // Fetch workspace nodes from backend
      const response = await api.getCustomNodes();

      // Clear old workspace nodes
      this.workspaceNodes.clear();

      // Add workspace nodes with source tracking
      for (const node of response.nodes) {
        const tracked: TrackedNodeDefinition = {
          id: node.id,
          name: node.label,
          type: node.stepType as NodeType,
          description: node.description || '',
          parameters: this.convertApiParameters(node.parameters || []),
          source: 'custom',
          category: node.category,
          classPath: node.classPath,
          icon: node.icon,
          // Don't copy color directly - it's a string in API but ColorScheme in NodeDefinition
          _storageSource: 'workspace',
          _lastSynced: new Date().toISOString(),
        };
        this.workspaceNodes.set(node.id, tracked);
      }

      // Update security config from workspace settings if available
      if (response.settings) {
        this.securityConfig = {
          allowCustomNodes: response.settings.enabled,
          allowedPackages: response.settings.allowedPackages || DEFAULT_ALLOWED_PACKAGES,
          requireApproval: response.settings.requireApproval,
          allowUserPackages: response.settings.allowUserNodes,
        };
        this.saveSecurityConfig();
      }

      this.lastWorkspaceSync = new Date();
      this.emit({ type: 'sync', timestamp: Date.now() });

      return {
        success: true,
        workspaceCount: this.workspaceNodes.size,
        localCount: this.nodes.size,
      };
    } catch (err) {
      console.error('Failed to sync with workspace:', err);
      return {
        success: false,
        workspaceCount: this.workspaceNodes.size,
        localCount: this.nodes.size,
        error: (err as Error).message,
      };
    } finally {
      this.syncInProgress = false;
    }
  }

  /**
   * Convert API parameter format to internal format.
   */
  private convertApiParameters(params: api.CustomNodeParameter[]): ParameterDefinition[] {
    return params.map(p => ({
      name: p.name,
      type: p.type as ParameterType,
      default: p.default,
      required: p.required,
      description: p.description,
      min: p.min,
      max: p.max,
      step: p.step,
      // Convert string[] to SelectOption[]
      options: p.options?.map(opt => ({ value: opt, label: opt })),
    }));
  }

  /**
   * Convert internal parameter format to API format.
   */
  private convertToApiParameters(params: ParameterDefinition[]): api.CustomNodeParameter[] {
    return params.map(p => ({
      name: p.name,
      type: p.type as api.CustomNodeParameter['type'],
      default: p.default,
      required: p.required,
      description: p.description,
      min: p.min,
      max: p.max,
      step: p.step,
      // Convert SelectOption[] to string[]
      options: p.options?.map(opt => String(opt.value)),
    }));
  }

  /**
   * Get all custom nodes (merged from local and workspace).
   * Workspace nodes take priority over local nodes with same ID.
   */
  getAllMerged(): NodeDefinition[] {
    const merged = new Map<string, TrackedNodeDefinition>();

    // Add local nodes first (lower priority)
    for (const [id, node] of this.nodes) {
      merged.set(id, { ...node, _storageSource: 'local' });
    }

    // Add workspace nodes (higher priority, overwrites local)
    for (const [id, node] of this.workspaceNodes) {
      merged.set(id, node);
    }

    return Array.from(merged.values());
  }

  /**
   * Get only workspace-level nodes.
   */
  getWorkspaceNodes(): NodeDefinition[] {
    return Array.from(this.workspaceNodes.values());
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
    if (this.workspaceNodes.has(nodeId)) return 'workspace';
    if (this.nodes.has(nodeId)) return 'local';
    return null;
  }

  /**
   * Save a node to workspace (backend).
   */
  async saveToWorkspace(node: NodeDefinition): Promise<boolean> {
    try {
      const apiNode = {
        id: node.id,
        label: node.name,
        category: node.category || 'Custom',
        description: node.description,
        classPath: node.classPath || '',
        stepType: node.type,
        parameters: this.convertToApiParameters(node.parameters || []),
        icon: undefined,
        color: undefined,
      };

      if (this.workspaceNodes.has(node.id)) {
        await api.updateCustomNode(node.id, apiNode);
      } else {
        await api.addCustomNode(apiNode);
      }

      // Update local workspace cache
      const tracked: TrackedNodeDefinition = {
        ...node,
        _storageSource: 'workspace',
        _lastSynced: new Date().toISOString(),
      };
      this.workspaceNodes.set(node.id, tracked);

      this.emit({ type: 'sync', timestamp: Date.now() });
      return true;
    } catch (err) {
      console.error('Failed to save node to workspace:', err);
      return false;
    }
  }

  /**
   * Delete a node from workspace (backend).
   */
  async deleteFromWorkspace(nodeId: string): Promise<boolean> {
    try {
      await api.deleteCustomNode(nodeId);
      this.workspaceNodes.delete(nodeId);
      this.emit({ type: 'sync', timestamp: Date.now() });
      return true;
    } catch (err) {
      console.error('Failed to delete node from workspace:', err);
      return false;
    }
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
        console.error('CustomNodeStorage listener error:', err);
      }
    }
  }

  // ===========================================================================
  // Persistence
  // ===========================================================================

  private loadFromStorage(): void {
    try {
      const stored = localStorage.getItem(STORAGE_KEYS.CUSTOM_NODES);
      if (stored) {
        const data = JSON.parse(stored) as CustomNodesFile;
        // Migrate if needed
        this.migrateIfNeeded(data);
        // Load nodes
        for (const node of data.nodes) {
          this.nodes.set(node.id, node);
        }
      }
    } catch (err) {
      console.error('Failed to load custom nodes from storage:', err);
    }
  }

  private saveToStorage(): void {
    try {
      const data: CustomNodesFile = {
        version: CURRENT_VERSION,
        nodes: this.getAll(),
      };
      localStorage.setItem(STORAGE_KEYS.CUSTOM_NODES, JSON.stringify(data));
      localStorage.setItem(STORAGE_KEYS.VERSION, CURRENT_VERSION);
    } catch (err) {
      console.error('Failed to save custom nodes to storage:', err);
    }
  }

  private loadSecurityConfig(): CustomNodeSecurityConfig {
    try {
      const stored = localStorage.getItem(STORAGE_KEYS.SECURITY_CONFIG);
      if (stored) {
        return JSON.parse(stored);
      }
    } catch {
      // Use defaults
    }

    return {
      allowCustomNodes: true,
      allowedPackages: [...DEFAULT_ALLOWED_PACKAGES],
      requireApproval: false,
      allowUserPackages: true,
    };
  }

  private saveSecurityConfig(): void {
    try {
      localStorage.setItem(
        STORAGE_KEYS.SECURITY_CONFIG,
        JSON.stringify(this.securityConfig)
      );
    } catch (err) {
      console.error('Failed to save security config:', err);
    }
  }

  private loadUserPackages(): string[] {
    try {
      const stored = localStorage.getItem(STORAGE_KEYS.USER_PACKAGES);
      if (stored) {
        return JSON.parse(stored);
      }
    } catch {
      // Use empty array
    }
    return [];
  }

  private saveUserPackages(packages: string[]): void {
    try {
      localStorage.setItem(STORAGE_KEYS.USER_PACKAGES, JSON.stringify(packages));
    } catch (err) {
      console.error('Failed to save user packages:', err);
    }
  }

  private migrateIfNeeded(data: CustomNodesFile): void {
    const storedVersion = localStorage.getItem(STORAGE_KEYS.VERSION);
    if (storedVersion !== CURRENT_VERSION) {
      // Future: Add migration logic here
      console.log(`Migrating custom nodes from ${storedVersion} to ${CURRENT_VERSION}`);
    }
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Generate a unique custom node ID.
 */
export function generateCustomNodeId(
  name: string,
  namespace: CustomNodeNamespace = 'custom'
): string {
  // Convert name to snake_case
  const snakeName = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

  return `${namespace}.${snakeName || 'unnamed'}`;
}

/**
 * Parse namespace from a node ID.
 */
export function parseNamespace(nodeId: string): CustomNodeNamespace | null {
  const match = nodeId.match(/^(custom|user|workspace|admin)\./);
  return match ? (match[1] as CustomNodeNamespace) : null;
}

/**
 * Check if a node ID belongs to custom namespaces.
 */
export function isCustomNodeId(nodeId: string): boolean {
  return parseNamespace(nodeId) !== null;
}

/**
 * Create a default custom node template.
 */
export function createCustomNodeTemplate(
  type: NodeType,
  namespace: CustomNodeNamespace = 'custom'
): NodeDefinition {
  return {
    id: generateCustomNodeId('my_operator', namespace),
    name: 'MyOperator',
    type,
    classPath: '',
    description: 'A custom operator',
    category: 'Custom',
    source: 'custom',
    parameters: [],
  };
}

/**
 * Create a default parameter template.
 */
export function createParameterTemplate(): ParameterDefinition {
  return {
    name: 'param',
    type: 'float',
    default: 0,
    description: 'A parameter',
  };
}

// ============================================================================
// Exports
// ============================================================================

// DEFAULT_ALLOWED_PACKAGES is already exported at declaration
