/**
 * Miscellaneous Node Definitions Index
 */

import utilities from './utilities.json';

import type { NodeDefinition } from '../../types';

const allMiscNodes: NodeDefinition[] = [
  ...(utilities as NodeDefinition[]),
];

export default allMiscNodes;

export { utilities };
