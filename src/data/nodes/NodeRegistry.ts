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
import { allNodes } from './definitions';
import {
  NodeRegistryIndex,
  type NodeRegistryStats,
  type NodeTierFilter,
} from './NodeRegistryIndex';

export {
  mergeNodeDefinitions,
  NodeRegistryIndex,
  type NodeCapability,
  type NodeRegistryStats,
  type NodeTierFilter,
} from './NodeRegistryIndex';

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
  /** Pure lookup/search/classPath index over validated definitions */
  private readonly index: NodeRegistryIndex;

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
    this.validationResult = { valid: true, errors: [], warnings: [] };

    this.index = new NodeRegistryIndex(this.prepareNodes(nodes));
  }

  /**
   * Validate and de-duplicate nodes before indexing.
   */
  private prepareNodes(nodes: NodeDefinition[]): NodeDefinition[] {
    const { warnOnDuplicates = true, validateOnLoad = false, customValidator } = this.options;
    const loadableNodes: NodeDefinition[] = [];
    const seenIds = new Set<string>();

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
      if (seenIds.has(node.id)) {
        if (warnOnDuplicates) {
          this.validationResult.warnings.push(`Duplicate node ID: ${node.id}`);
        }
        continue;
      }

      seenIds.add(node.id);
      loadableNodes.push(node);
    }

    return loadableNodes;
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
    return this.index.getById(id);
  }

  /**
   * Get a node by its name (case-insensitive)
   */
  getByName(name: string): NodeDefinition | undefined {
    return this.index.getByName(name);
  }

  /**
   * Get a node by its classPath (supports legacy paths)
   */
  getByClassPath(classPath: string): NodeDefinition | undefined {
    return this.index.getByClassPath(classPath);
  }

  /**
   * Get all nodes of a specific type
   */
  getByType(type: NodeType): NodeDefinition[] {
    return this.index.getByType(type);
  }

  /**
   * Get a node by type and name combination
   */
  getByTypeAndName(type: NodeType, name: string): NodeDefinition | undefined {
    return this.index.getByTypeAndName(type, name);
  }

  /**
   * Check if a node exists by ID
   */
  has(id: string): boolean {
    return this.index.has(id);
  }

  /**
   * Check if a classPath is registered
   */
  hasClassPath(classPath: string): boolean {
    return this.index.hasClassPath(classPath);
  }

  // ===========================================================================
  // Query Methods
  // ===========================================================================

  /**
   * Get all registered node types
   */
  getTypes(): NodeType[] {
    return this.index.getTypes();
  }

  /**
   * Get all nodes
   */
  getAll(): NodeDefinition[] {
    return this.index.getAll();
  }

  /**
   * Get total node count
   */
  get size(): number {
    return this.index.size;
  }

  /**
   * Get nodes by category
   */
  getByCategory(category: string): NodeDefinition[] {
    return this.index.getByCategory(category);
  }

  /**
   * Get nodes by source
   */
  getBySource(source: string): NodeDefinition[] {
    return this.index.getBySource(source);
  }

  /**
   * Get nodes matching any of the given tags
   */
  getByTags(tags: string[]): NodeDefinition[] {
    return this.index.getByTags(tags);
  }

  /**
   * Search nodes by query string (name, description, tags)
   */
  search(query: string): NodeDefinition[] {
    return this.index.search(query);
  }

  /**
   * Get nodes filtered by maximum tier level.
   *
   * - "core" returns only core-tier nodes
   * - "standard" returns core + standard (excludes advanced)
   * - "all" returns everything
   */
  getNodesByTier(maxTier: NodeTierFilter): NodeDefinition[] {
    return this.index.getNodesByTier(maxTier);
  }

  /**
   * Get nodes of a specific type, filtered by maximum tier level.
   */
  getByTypeAndTier(type: NodeType, maxTier: NodeTierFilter): NodeDefinition[] {
    return this.index.getByTypeAndTier(type, maxTier);
  }

  /**
   * Get deep learning models only
   */
  getDeepLearningModels(): NodeDefinition[] {
    return this.index.getByCapability('deepLearning');
  }

  /**
   * Get container nodes
   */
  getContainerNodes(): NodeDefinition[] {
    return this.index.getByCapability('container');
  }

  /**
   * Get generator nodes
   */
  getGeneratorNodes(): NodeDefinition[] {
    return this.index.getByCapability('generator');
  }

  // ===========================================================================
  // Class Path Resolution
  // ===========================================================================

  /**
   * Resolve a classPath from a node type and name
   */
  resolveClassPath(type: NodeType, name: string): string | undefined {
    return this.index.resolveClassPath(type, name);
  }

  /**
   * Resolve a node name from a classPath
   */
  resolveNameFromClassPath(classPath: string): string | undefined {
    return this.index.resolveNameFromClassPath(classPath);
  }

  /**
   * Build a classPath map for the pipeline converter
   * Returns Map<classPath, nodeName>
   */
  buildClassPathToNameMap(): Map<string, string> {
    return this.index.buildClassPathToNameMap();
  }

  /**
   * Build a name to classPath map for the pipeline converter
   * Returns Map<nodeName, classPath>
   */
  buildNameToClassPathMap(): Map<string, string> {
    return this.index.buildNameToClassPathMap();
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
  getStats(): NodeRegistryStats {
    return this.index.getStats();
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
