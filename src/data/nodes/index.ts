/**
 * Node Data Module - Main Entry Point
 *
 * This module provides the node registry system for the pipeline editor.
 * It exports:
 * - NodeRegistry class for managing node definitions
 * - Types for node and parameter definitions
 * - Category configurations
 * - All node definitions
 *
 * @example
 * import { createNodeRegistry, NodeType } from '@/data/nodes';
 *
 * const registry = createNodeRegistry();
 * const preprocessingNodes = registry.getByType('preprocessing');
 * const plsNode = registry.getByName('PLSRegression');
 */

// Core types
export * from './types';

// NodeRegistry class and factories
export {
  NodeRegistry,
  createNodeRegistry,
  createEmptyRegistry,
  mergeRegistries,
  type NodeRegistryOptions,
  type ValidationResult,
} from './NodeRegistry';

// Custom node storage and hooks
export {
  CustomNodeStorage,
  useCustomNodes,
  generateCustomNodeId,
  parseNamespace,
  isCustomNodeId,
  createCustomNodeTemplate,
  createParameterTemplate,
  NAMESPACE_PRIORITY,
  DEFAULT_ALLOWED_PACKAGES,
  type CustomNodeNamespace,
  type CustomNodeSecurityConfig,
  type CustomNodeValidationResult,
  type CustomNodeStorageEvent,
  type UseCustomNodesReturn,
} from './custom';

// Category system
export {
  getCategoryConfig,
  getAllCategories,
  getColorScheme,
  getCategoryLabel,
  getSubcategories,
} from './categories';

// Node definitions (re-exported from definitions/index.ts)
export {
  allNodes,
  getNodeById,
  getNodeByName,
  getNodeByClassPath,
  getNodesByType,
  getNodesByCategory,
  getNodesBySource,
  getNodesByTags,
  searchNodes,
  getDeepLearningNodes,
  getContainerNodes,
  getGeneratorNodes,
  nodesByType,
  // Category exports
  preprocessingNodes,
  splittingNodes,
  modelNodes,
  yProcessingNodes,
  generatorNodes,
  branchingNodes,
  filterNodes,
  augmentationNodes,
  containerNodes,
  miscNodes,
} from './definitions';
