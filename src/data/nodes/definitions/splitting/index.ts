/**
 * Splitting Node Definitions
 * Exports all splitting nodes from JSON files
 */

import nirsSplitters from './nirs-splitters.json';
import sklearnSplitters from './sklearn-splitters.json';
import type { NodeDefinition } from '../../types';

// Combine all splitting nodes
const splittingNodes: NodeDefinition[] = [
  ...(nirsSplitters as NodeDefinition[]),
  ...(sklearnSplitters as NodeDefinition[]),
];

export default splittingNodes;
export { splittingNodes };
