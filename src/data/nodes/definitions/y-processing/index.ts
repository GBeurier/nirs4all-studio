/**
 * Y-Processing Node Definitions Index
 *
 * Aggregates all target scaling/transformation node definitions.
 */

import scalers from './scalers.json';

import type { NodeDefinition } from '../../types';

const allYProcessingNodes: NodeDefinition[] = [
  ...(scalers as NodeDefinition[]),
];

export default allYProcessingNodes;

export { scalers };
