/**
 * Augmentation Node Definitions Index
 */

import transforms from './transforms.json';

import type { NodeDefinition } from '../../types';

const allAugmentationNodes: NodeDefinition[] = [
  ...(transforms as NodeDefinition[]),
];

export default allAugmentationNodes;

export { transforms };
