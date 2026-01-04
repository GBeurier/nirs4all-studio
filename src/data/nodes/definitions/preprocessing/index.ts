/**
 * Preprocessing Node Definitions
 * Exports all preprocessing nodes from JSON files
 */

import nirsCore from './nirs-core.json';
import derivatives from './derivatives.json';
import smoothing from './smoothing.json';
import baseline from './baseline.json';
import wavelet from './wavelet.json';
import conversion from './conversion.json';
import featureSelection from './feature-selection.json';
import featureOps from './feature-ops.json';
import scaling from './scaling.json';
import type { NodeDefinition } from '../../types';

// Combine all preprocessing nodes
const preprocessingNodes: NodeDefinition[] = [
  ...(nirsCore as NodeDefinition[]),
  ...(derivatives as NodeDefinition[]),
  ...(smoothing as NodeDefinition[]),
  ...(baseline as NodeDefinition[]),
  ...(wavelet as NodeDefinition[]),
  ...(conversion as NodeDefinition[]),
  ...(featureSelection as NodeDefinition[]),
  ...(featureOps as NodeDefinition[]),
  ...(scaling as NodeDefinition[]),
];

export default preprocessingNodes;
export { preprocessingNodes };
