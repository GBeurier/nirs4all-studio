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
import sklearnDiscriminant from './sklearn-discriminant.json';
import sklearnEnsemble from './sklearn-ensemble.json';
import sklearnGaussianProcess from './sklearn-gaussian-process.json';
import sklearnLinear from './sklearn-linear.json';
import sklearnMeta from './sklearn-meta.json';
import sklearnMisc from './sklearn-misc.json';
import sklearnNaiveBayes from './sklearn-naive-bayes.json';
import sklearnNeighbors from './sklearn-neighbors.json';
import sklearnNeural from './sklearn-neural.json';
import sklearnSvm from './sklearn-svm.json';
import sklearnTree from './sklearn-tree.json';

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
  ...(sklearnDiscriminant as NodeDefinition[]),
  ...(sklearnEnsemble as NodeDefinition[]),
  ...(sklearnGaussianProcess as NodeDefinition[]),
  ...(sklearnLinear as NodeDefinition[]),
  ...(sklearnMeta as NodeDefinition[]),
  ...(sklearnMisc as NodeDefinition[]),
  ...(sklearnNaiveBayes as NodeDefinition[]),
  ...(sklearnNeighbors as NodeDefinition[]),
  ...(sklearnNeural as NodeDefinition[]),
  ...(sklearnSvm as NodeDefinition[]),
  ...(sklearnTree as NodeDefinition[]),
];

export default allModelNodes;

// Named exports for selective imports
export {
  plsVariants, advancedPls, kernelPls, linear, svm, ensemble, deepLearning, meta,
  sklearnDiscriminant, sklearnEnsemble, sklearnGaussianProcess, sklearnLinear,
  sklearnMeta, sklearnMisc, sklearnNaiveBayes, sklearnNeighbors, sklearnNeural,
  sklearnSvm, sklearnTree,
};

// Helper to get deep learning models only
export const getDeepLearningModels = (): NodeDefinition[] =>
  allModelNodes.filter(node => node.isDeepLearning === true);

// Helper to get models by category
export const getModelsByCategory = (category: string): NodeDefinition[] =>
  allModelNodes.filter(node => node.category === category);
