/**
 * Generated Canonical Registry Loader
 *
 * Provides typed access to the auto-generated canonical-registry.json.
 * This file is produced by: python scripts/generate_registry.py
 *
 * The canonical registry auto-discovers ALL operators from the nirs4all
 * library and sklearn, with metadata from _webapp_meta class attributes
 * and UI overlays from ui-overlays.json.
 *
 * Usage:
 *   import { canonicalNodes, loadCanonicalNodes } from '@/data/nodes/generated';
 */

import type { NodeDefinition } from '../types';
import canonicalRegistryData from './canonical-registry.json';

/**
 * All nodes from the canonical registry (auto-generated).
 *
 * This includes nirs4all operators, sklearn models/transformers/splitters,
 * and y_processing scalers - all auto-discovered from the Python library.
 */
export const canonicalNodes: NodeDefinition[] = canonicalRegistryData as NodeDefinition[];

/**
 * Load canonical nodes, optionally filtering by source or type.
 */
export function loadCanonicalNodes(
  filter?: { source?: string; type?: string; advanced?: boolean }
): NodeDefinition[] {
  let nodes = canonicalNodes;

  if (filter?.source) {
    nodes = nodes.filter(n => n.source === filter.source);
  }
  if (filter?.type) {
    nodes = nodes.filter(n => n.type === filter.type);
  }
  if (filter?.advanced === false) {
    nodes = nodes.filter(n => !n.isAdvanced);
  }

  return nodes;
}

/**
 * Get a canonical node by ID.
 */
export function getCanonicalNodeById(id: string): NodeDefinition | undefined {
  return canonicalNodes.find(n => n.id === id);
}

/**
 * Get canonical node count by type.
 */
export function getCanonicalStats(): Record<string, number> {
  const stats: Record<string, number> = {};
  for (const node of canonicalNodes) {
    stats[node.type] = (stats[node.type] || 0) + 1;
  }
  return stats;
}
