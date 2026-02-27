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
import sklearnClusterNeighbors from './sklearn-cluster-neighbors.json';
import sklearnDimensionality from './sklearn-dimensionality.json';
import sklearnEncoding from './sklearn-encoding.json';
import sklearnFeatureExtraction from './sklearn-feature-extraction.json';
import sklearnFeatureSelection from './sklearn-feature-selection.json';
import sklearnImputation from './sklearn-imputation.json';
import sklearnKernelProjection from './sklearn-kernel-projection.json';
import sklearnMisc from './sklearn-misc.json';
import sklearnScalers from './sklearn-scalers.json';
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
  ...(sklearnClusterNeighbors as NodeDefinition[]),
  ...(sklearnDimensionality as NodeDefinition[]),
  ...(sklearnEncoding as NodeDefinition[]),
  ...(sklearnFeatureExtraction as NodeDefinition[]),
  ...(sklearnFeatureSelection as NodeDefinition[]),
  ...(sklearnImputation as NodeDefinition[]),
  ...(sklearnKernelProjection as NodeDefinition[]),
  ...(sklearnMisc as NodeDefinition[]),
  ...(sklearnScalers as NodeDefinition[]),
];

export default preprocessingNodes;
export { preprocessingNodes };
