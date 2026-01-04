/**
 * Model Node Definitions Index
 *
 * Aggregates all model node definitions from JSON files.
 */

import plsVariants from './pls-variants.json';
import advancedPls from './advanced-pls.json';
import kernelPls from './kernel-pls.json';
import linear from './linear.json';
import svm from './svm.json';
import ensemble from './ensemble.json';
import deepLearning from './deep-learning.json';
import meta from './meta.json';

import type { NodeDefinition } from '../../types';

// Type assertion for JSON imports
const allModelNodes: NodeDefinition[] = [
  ...(plsVariants as NodeDefinition[]),
  ...(advancedPls as NodeDefinition[]),
  ...(kernelPls as NodeDefinition[]),
  ...(linear as NodeDefinition[]),
  ...(svm as NodeDefinition[]),
  ...(ensemble as NodeDefinition[]),
  ...(deepLearning as NodeDefinition[]),
  ...(meta as NodeDefinition[]),
];

export default allModelNodes;

// Named exports for selective imports
export { plsVariants, advancedPls, kernelPls, linear, svm, ensemble, deepLearning, meta };

// Helper to get deep learning models only
export const getDeepLearningModels = (): NodeDefinition[] =>
  allModelNodes.filter(node => node.isDeepLearning === true);

// Helper to get models by category
export const getModelsByCategory = (category: string): NodeDefinition[] =>
  allModelNodes.filter(node => node.category === category);
