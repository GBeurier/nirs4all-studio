/**
 * CustomNodeStorageIdentity - Pure helpers for custom-node identity and templates.
 *
 * Owns the namespace vocabulary and the stateless functions that derive node IDs,
 * parse/classify namespaces, and build blank node/parameter templates. These are
 * intentionally free of any storage state so they can be reused by wizards and
 * editors without touching the singleton.
 *
 * Re-exported from CustomNodeStorage.ts to keep the public API stable.
 */

import type { NodeDefinition, NodeType, ParameterDefinition } from '../types';

/**
 * Allowed namespace prefixes for custom node IDs.
 */
export type CustomNodeNamespace = 'custom' | 'user' | 'workspace' | 'admin';

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
