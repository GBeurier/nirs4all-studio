/**
 * Branching Node Definitions Index
 */

import branches from './branches.json';
import merge from './merge.json';

import type { NodeDefinition } from '../../types';

const allBranchingNodes: NodeDefinition[] = [
  ...(branches as NodeDefinition[]),
  ...(merge as NodeDefinition[]),
];

export default allBranchingNodes;

export { branches, merge };
