/**
 * Filter Node Definitions Index
 */

import sampleFilters from './sample-filters.json';

import type { NodeDefinition } from '../../types';

const allFilterNodes: NodeDefinition[] = [
  ...(sampleFilters as NodeDefinition[]),
];

export default allFilterNodes;

export { sampleFilters };
