/**
 * NodeRegistry Class
 *
 * Central registry for all node definitions. Provides fast lookup by ID,
 * name, classPath, and type. This is the core data structure used by
 * the NodeRegistryContext.
 *
 * Features:
 * - O(1) lookup by ID and classPath via Maps
 * - Type-organized collections for palette views
 * - Legacy classPath resolution for backwards compatibility
 * - Search functionality for node filtering
 *
 * @see docs/_internals/node_specifications.md
 * @see docs/_internals/implementation_roadmap.md Task 2.9
 */

import type { NodeDefinition, NodeType, ParameterDefinition, CategoryConfig } from './types';
import { getCategoryConfig, getAllCategories, getColorScheme } from './categories';

/**
 * Options for creating a NodeRegistry instance
 */
export interface NodeRegistryOptions {
  /** Whether to validate nodes on load */
  validateOnLoad?: boolean;
  /** Whether to log warnings for duplicate IDs */
  warnOnDuplicates?: boolean;
  /** Custom validation function */
  customValidator?: (node: NodeDefinition) => string[];
}

/**
 * Result of a registry validation
 */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * NodeRegistry - Central registry for node definitions
 */
export class NodeRegistry {
  /** Map of node ID to definition */
  private readonly nodesById: Map<string, NodeDefinition>;

  /** Map of classPath to node definition (including legacy paths) */
  private readonly nodesByClassPath: Map<string, NodeDefinition>;

  /** Map of node type to definitions */
  private readonly nodesByType: Map<NodeType, NodeDefinition[]>;

  /** Map of lowercase name to definition (for case-insensitive lookup) */
  private readonly nodesByName: Map<string, NodeDefinition>;

  /** Validation errors and warnings */
  private readonly validationResult: ValidationResult;

  /** Registry version */
  public readonly version: string = '2.0.0';

  /**
   * Create a new NodeRegistry
   */
  constructor(
    nodes: NodeDefinition[],
    private readonly options: NodeRegistryOptions = {}
  ) {
    this.nodesById = new Map();
    this.nodesByClassPath = new Map();
    this.nodesByType = new Map();
    this.nodesByName = new Map();
    this.validationResult = { valid: true, errors: [], warnings: [] };

    this.loadNodes(nodes);
  }

  /**
   * Load nodes into the registry
   */
  private loadNodes(nodes: NodeDefinition[]): void {
    const { warnOnDuplicates = true, validateOnLoad = false, customValidator } = this.options;

    for (const node of nodes) {
      // Validate if enabled
      if (validateOnLoad) {
        const errors = this.validateNode(node);
        if (customValidator) {
          errors.push(...customValidator(node));
        }
        if (errors.length > 0) {
          this.validationResult.valid = false;
          this.validationResult.errors.push(...errors.map(e => `[${node.id}] ${e}`));
          continue; // Skip invalid nodes
        }
      }

      // Check for duplicate IDs
      if (this.nodesById.has(node.id)) {
        if (warnOnDuplicates) {
          this.validationResult.warnings.push(`Duplicate node ID: ${node.id}`);
        }
        continue;
      }

      // Index by ID
      this.nodesById.set(node.id, node);

      // Index by classPath
      if (node.classPath) {
        this.nodesByClassPath.set(node.classPath, node);
      }

      // Index legacy classPaths
      if (node.legacyClassPaths) {
        for (const legacyPath of node.legacyClassPaths) {
          if (!this.nodesByClassPath.has(legacyPath)) {
            this.nodesByClassPath.set(legacyPath, node);
          }
        }
      }

      // Index by type
      const typeNodes = this.nodesByType.get(node.type) ?? [];
      typeNodes.push(node);
      this.nodesByType.set(node.type, typeNodes);

      // Index by lowercase name
      const lowerName = node.name.toLowerCase();
      if (!this.nodesByName.has(lowerName)) {
        this.nodesByName.set(lowerName, node);
      }
    }
  }

  /**
   * Validate a single node definition
   */
  private validateNode(node: NodeDefinition): string[] {
    const errors: string[] = [];

    if (!node.id || typeof node.id !== 'string') {
      errors.push('Missing or invalid id');
    } else if (!/^[a-z_]+\.[a-z0-9_]+$/.test(node.id)) {
      errors.push(`Invalid id format: ${node.id} (expected: type.snake_case)`);
    }

    if (!node.name || typeof node.name !== 'string') {
      errors.push('Missing or invalid name');
    }

    if (!node.type || typeof node.type !== 'string') {
      errors.push('Missing or invalid type');
    }

    if (!node.description || typeof node.description !== 'string') {
      errors.push('Missing or invalid description');
    }

    if (!Array.isArray(node.parameters)) {
      errors.push('Missing or invalid parameters array');
    } else {
      for (const param of node.parameters) {
        if (!param.name || !param.type) {
          errors.push(`Invalid parameter definition: ${JSON.stringify(param)}`);
        }
      }
    }

    return errors;
  }

  // ===========================================================================
  // Lookup Methods
  // ===========================================================================

  /**
   * Get a node by its unique ID
   */
  getById(id: string): NodeDefinition | undefined {
    return this.nodesById.get(id);
  }

  /**
   * Get a node by its name (case-insensitive)
   */
  getByName(name: string): NodeDefinition | undefined {
    return this.nodesByName.get(name.toLowerCase());
  }

  /**
   * Get a node by its classPath (supports legacy paths)
   */
  getByClassPath(classPath: string): NodeDefinition | undefined {
    return this.nodesByClassPath.get(classPath);
  }

  /**
   * Get all nodes of a specific type
   */
  getByType(type: NodeType): NodeDefinition[] {
    return this.nodesByType.get(type) ?? [];
  }

  /**
   * Get a node by type and name combination
   */
  getByTypeAndName(type: NodeType, name: string): NodeDefinition | undefined {
    const nodes = this.getByType(type);
    return nodes.find(n => n.name === name);
  }

  /**
   * Check if a node exists by ID
   */
  has(id: string): boolean {
    return this.nodesById.has(id);
  }

  /**
   * Check if a classPath is registered
   */
  hasClassPath(classPath: string): boolean {
    return this.nodesByClassPath.has(classPath);
  }

  // ===========================================================================
  // Query Methods
  // ===========================================================================

  /**
   * Get all registered node types
   */
  getTypes(): NodeType[] {
    return Array.from(this.nodesByType.keys());
  }

  /**
   * Get all nodes
   */
  getAll(): NodeDefinition[] {
    return Array.from(this.nodesById.values());
  }

  /**
   * Get total node count
   */
  get size(): number {
    return this.nodesById.size;
  }

  /**
   * Get nodes by category
   */
  getByCategory(category: string): NodeDefinition[] {
    return this.getAll().filter(node => node.category === category);
  }

  /**
   * Get nodes by source
   */
  getBySource(source: string): NodeDefinition[] {
    return this.getAll().filter(node => node.source === source);
  }

  /**
   * Get nodes matching any of the given tags
   */
  getByTags(tags: string[]): NodeDefinition[] {
    const tagSet = new Set(tags.map(t => t.toLowerCase()));
    return this.getAll().filter(node =>
      node.tags?.some(t => tagSet.has(t.toLowerCase()))
    );
  }

  /**
   * Search nodes by query string (name, description, tags)
   */
  search(query: string): NodeDefinition[] {
    if (!query.trim()) return this.getAll();

    const lowerQuery = query.toLowerCase();
    return this.getAll().filter(node =>
      node.name.toLowerCase().includes(lowerQuery) ||
      node.description.toLowerCase().includes(lowerQuery) ||
      node.tags?.some(t => t.toLowerCase().includes(lowerQuery)) ||
      node.category?.toLowerCase().includes(lowerQuery)
    );
  }

  /**
   * Get deep learning models only
   */
  getDeepLearningModels(): NodeDefinition[] {
    return this.getAll().filter(node => node.isDeepLearning === true);
  }

  /**
   * Get container nodes
   */
  getContainerNodes(): NodeDefinition[] {
    return this.getAll().filter(node => node.isContainer === true);
  }

  /**
   * Get generator nodes
   */
  getGeneratorNodes(): NodeDefinition[] {
    return this.getAll().filter(node => node.isGenerator === true);
  }

  // ===========================================================================
  // Class Path Resolution
  // ===========================================================================

  /**
   * Resolve a classPath from a node type and name
   */
  resolveClassPath(type: NodeType, name: string): string | undefined {
    const node = this.getByTypeAndName(type, name);
    return node?.classPath;
  }

  /**
   * Resolve a node name from a classPath
   */
  resolveNameFromClassPath(classPath: string): string | undefined {
    return this.getByClassPath(classPath)?.name;
  }

  /**
   * Build a classPath map for the pipeline converter
   * Returns Map<classPath, nodeName>
   */
  buildClassPathToNameMap(): Map<string, string> {
    const map = new Map<string, string>();

    for (const node of this.getAll()) {
      if (node.classPath) {
        map.set(node.classPath, node.name);
      }
      if (node.legacyClassPaths) {
        for (const legacyPath of node.legacyClassPaths) {
          map.set(legacyPath, node.name);
        }
      }
    }

    return map;
  }

  /**
   * Build a name to classPath map for the pipeline converter
   * Returns Map<nodeName, classPath>
   */
  buildNameToClassPathMap(): Map<string, string> {
    const map = new Map<string, string>();

    for (const node of this.getAll()) {
      if (node.classPath) {
        map.set(node.name, node.classPath);
      }
    }

    return map;
  }

  // ===========================================================================
  // Parameter Utilities
  // ===========================================================================

  /**
   * Get default parameters for a node
   */
  getDefaultParams(nodeId: string): Record<string, unknown> {
    const node = this.getById(nodeId);
    if (!node) return {};

    const defaults: Record<string, unknown> = {};
    for (const param of node.parameters) {
      if (param.default !== undefined) {
        defaults[param.name] = param.default;
      }
    }
    return defaults;
  }

  /**
   * Get parameter definition by name
   */
  getParameterDef(nodeId: string, paramName: string): ParameterDefinition | undefined {
    const node = this.getById(nodeId);
    return node?.parameters.find(p => p.name === paramName);
  }

  /**
   * Get sweepable parameters for a node
   */
  getSweepableParams(nodeId: string): ParameterDefinition[] {
    const node = this.getById(nodeId);
    return node?.parameters.filter(p => p.sweepable === true) ?? [];
  }

  /**
   * Get finetunable parameters for a node
   */
  getFinetunableParams(nodeId: string): ParameterDefinition[] {
    const node = this.getById(nodeId);
    return node?.parameters.filter(p => p.finetunable === true) ?? [];
  }

  // ===========================================================================
  // Category Integration
  // ===========================================================================

  /**
   * Get category configuration for a node type
   */
  getCategoryConfig(type: NodeType): CategoryConfig | undefined {
    return getCategoryConfig(type);
  }

  /**
   * Get all category configurations
   */
  getAllCategories(): CategoryConfig[] {
    return getAllCategories();
  }

  /**
   * Get color scheme for a node type
   */
  getColorScheme(type: NodeType): CategoryConfig['color'] | undefined {
    return getColorScheme(type);
  }

  // ===========================================================================
  // Validation
  // ===========================================================================

  /**
   * Get validation result from loading
   */
  getValidationResult(): ValidationResult {
    return { ...this.validationResult };
  }

  /**
   * Check if registry loaded without errors
   */
  isValid(): boolean {
    return this.validationResult.valid;
  }

  // ===========================================================================
  // Debugging
  // ===========================================================================

  /**
   * Get registry statistics
   */
  getStats(): {
    totalNodes: number;
    nodesByType: Record<string, number>;
    classPathCount: number;
  } {
    const nodesByType: Record<string, number> = {};
    for (const [type, nodes] of this.nodesByType) {
      nodesByType[type] = nodes.length;
    }

    return {
      totalNodes: this.size,
      nodesByType,
      classPathCount: this.nodesByClassPath.size,
    };
  }

  /**
   * Export all nodes as JSON (for debugging)
   */
  toJSON(): NodeDefinition[] {
    return this.getAll();
  }
}

// ===========================================================================
// Factory Functions
// ===========================================================================

/**
 * Create a NodeRegistry from the built-in node definitions
 */
export function createNodeRegistry(options?: NodeRegistryOptions): NodeRegistry {
  // Dynamic import to avoid circular dependencies
  const { allNodes } = require('./definitions');
  return new NodeRegistry(allNodes, options);
}

/**
 * Create an empty NodeRegistry for testing
 */
export function createEmptyRegistry(options?: NodeRegistryOptions): NodeRegistry {
  return new NodeRegistry([], options);
}

/**
 * Merge multiple registries into one
 */
export function mergeRegistries(
  registries: NodeRegistry[],
  options?: NodeRegistryOptions
): NodeRegistry {
  const allNodes = registries.flatMap(r => r.getAll());
  return new NodeRegistry(allNodes, options);
}
