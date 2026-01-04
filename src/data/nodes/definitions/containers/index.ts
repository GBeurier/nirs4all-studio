/**
 * Container Node Definitions Index
 */

import wrappers from './wrappers.json';

import type { NodeDefinition } from '../../types';

const allContainerNodes: NodeDefinition[] = [
  ...(wrappers as NodeDefinition[]),
];

export default allContainerNodes;

export { wrappers };
