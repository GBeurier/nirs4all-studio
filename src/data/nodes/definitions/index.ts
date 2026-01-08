/**
 * Node Definitions Master Index
 *
 * Central export point for all node definitions across all categories.
 * This module aggregates nodes from all subdirectories and provides
 * utility functions for accessing nodes by type, category, or ID.
 */

// Import all node definition groups
import preprocessingNodes from './preprocessing';
import splittingNodes from './splitting';
import modelNodes from './models';
import yProcessingNodes from './y-processing';
import generatorNodes from './generators';
import branchingNodes from './branching';
import filterNodes from './filters';
import augmentationNodes from './augmentation';
import containerNodes from './containers';
import miscNodes from './misc';

import type { NodeDefinition, NodeType } from '../types';

// ============================================================================
// All Nodes Combined
// ============================================================================

/**
 * Complete list of all node definitions
 */
export const allNodes: NodeDefinition[] = [
  ...preprocessingNodes,
  ...splittingNodes,
  ...modelNodes,
  ...yProcessingNodes,
  ...generatorNodes,
  ...branchingNodes,
  ...filterNodes,
  ...augmentationNodes,
  ...containerNodes,
  ...miscNodes,
];

// ============================================================================
// Node Access Utilities
// ============================================================================

/**
 * Get a node by its unique ID
 */
export function getNodeById(id: string): NodeDefinition | undefined {
  return allNodes.find(node => node.id === id);
}

/**
 * Get a node by its name (case-insensitive)
 */
export function getNodeByName(name: string): NodeDefinition | undefined {
  const lowerName = name.toLowerCase();
  return allNodes.find(node => node.name.toLowerCase() === lowerName);
}

/**
 * Get a node by its classPath
 */
export function getNodeByClassPath(classPath: string): NodeDefinition | undefined {
  return allNodes.find(node =>
    node.classPath === classPath ||
    node.legacyClassPaths?.includes(classPath)
  );
}

/**
 * Get all nodes of a specific type
 */
export function getNodesByType(type: NodeType): NodeDefinition[] {
  return allNodes.filter(node => node.type === type);
}

/**
 * Get all nodes matching a category
 */
export function getNodesByCategory(category: string): NodeDefinition[] {
  return allNodes.filter(node => node.category === category);
}

/**
 * Get all nodes from a specific source (sklearn, nirs4all, etc.)
 */
export function getNodesBySource(source: string): NodeDefinition[] {
  return allNodes.filter(node => node.source === source);
}

/**
 * Get all nodes matching any of the given tags
 */
export function getNodesByTags(tags: string[]): NodeDefinition[] {
  const tagSet = new Set(tags.map(t => t.toLowerCase()));
  return allNodes.filter(node =>
    node.tags?.some(t => tagSet.has(t.toLowerCase()))
  );
}

/**
 * Search nodes by name, description, or tags
 */
export function searchNodes(query: string): NodeDefinition[] {
  const lowerQuery = query.toLowerCase();
  return allNodes.filter(node =>
    node.name.toLowerCase().includes(lowerQuery) ||
    node.description.toLowerCase().includes(lowerQuery) ||
    node.tags?.some(t => t.toLowerCase().includes(lowerQuery))
  );
}

/**
 * Get all deep learning models
 */
export function getDeepLearningNodes(): NodeDefinition[] {
  return allNodes.filter(node => node.isDeepLearning === true);
}

/**
 * Get all container nodes
 */
export function getContainerNodes(): NodeDefinition[] {
  return allNodes.filter(node => node.isContainer === true);
}

/**
 * Get all generator nodes
 */
export function getGeneratorNodes(): NodeDefinition[] {
  return allNodes.filter(node => node.isGenerator === true);
}

// ============================================================================
// Grouped Exports
// ============================================================================

/**
 * Nodes organized by type
 */
export const nodesByType: Record<NodeType, NodeDefinition[]> = {
  preprocessing: preprocessingNodes,
  splitting: splittingNodes,
  model: modelNodes,
  y_processing: yProcessingNodes,
  generator: generatorNodes,
  branch: getNodesByType('branch'),
  merge: getNodesByType('merge'),
  filter: filterNodes,
  augmentation: augmentationNodes,
  sample_augmentation: getNodesByType('sample_augmentation'),
  feature_augmentation: getNodesByType('feature_augmentation'),
  sample_filter: getNodesByType('sample_filter'),
  concat_transform: getNodesByType('concat_transform'),
  sequential: getNodesByType('sequential'),
  chart: getNodesByType('chart'),
  comment: getNodesByType('comment'),
};

// ============================================================================
// Re-exports
// ============================================================================

export {
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
};

// Re-export types
export type { NodeDefinition, NodeType } from '../types';
