/**
 * Finetuning parameter presets
 *
 * Common parameter presets for different model types.
 */

import type { ParamPreset, StaticParamPreset } from "./types";

/**
 * Common parameter presets for different models
 */
export const paramPresets: ParamPreset[] = [
  // PLS parameters
  {
    name: "n_components",
    type: "int",
    low: 1,
    high: 30,
    step: 1,
    descriptionKey: "pipelineEditor.finetune.preset.nComponents",
    forModels: [
      "PLSRegression",
      "PLSDA",
      "OPLS",
      "OPLSDA",
      "IKPLS",
      "SparsePLS",
      "LWPLS",
      "IntervalPLS",
    ],
  },
  // Regularization
  {
    name: "alpha",
    type: "log_float",
    low: 0.0001,
    high: 100,
    descriptionKey: "pipelineEditor.finetune.preset.alpha",
    forModels: ["Ridge", "Lasso", "ElasticNet", "SparsePLS"],
  },
  {
    name: "l1_ratio",
    type: "float",
    low: 0,
    high: 1,
    descriptionKey: "pipelineEditor.finetune.preset.l1Ratio",
    forModels: ["ElasticNet"],
  },
  // SVM
  {
    name: "C",
    type: "log_float",
    low: 0.01,
    high: 100,
    descriptionKey: "pipelineEditor.finetune.preset.svmC",
    forModels: ["SVR", "SVC"],
  },
  {
    name: "epsilon",
    type: "log_float",
    low: 0.001,
    high: 1,
    descriptionKey: "pipelineEditor.finetune.preset.epsilon",
    forModels: ["SVR"],
  },
  {
    name: "gamma",
    type: "log_float",
    low: 0.0001,
    high: 10,
    descriptionKey: "pipelineEditor.finetune.preset.gamma",
    forModels: ["SVR", "SVC", "KernelPLS"],
  },
  {
    name: "kernel",
    type: "categorical",
    choices: ["rbf", "linear", "poly"],
    descriptionKey: "pipelineEditor.finetune.preset.kernel",
    forModels: ["SVR", "SVC", "KernelPLS"],
  },
  // Ensemble
  {
    name: "n_estimators",
    type: "int",
    low: 50,
    high: 500,
    step: 50,
    descriptionKey: "pipelineEditor.finetune.preset.nEstimators",
    forModels: ["RandomForestRegressor", "RandomForestClassifier", "XGBoost", "LightGBM"],
  },
  {
    name: "max_depth",
    type: "int",
    low: 3,
    high: 20,
    step: 1,
    descriptionKey: "pipelineEditor.finetune.preset.maxDepth",
    forModels: ["RandomForestRegressor", "RandomForestClassifier", "XGBoost", "LightGBM"],
  },
  {
    name: "learning_rate",
    type: "log_float",
    low: 0.001,
    high: 0.3,
    descriptionKey: "pipelineEditor.finetune.preset.boostingLearningRate",
    forModels: ["XGBoost", "LightGBM"],
  },
  // LWPLS
  {
    name: "n_neighbors",
    type: "int",
    low: 10,
    high: 100,
    step: 10,
    descriptionKey: "pipelineEditor.finetune.preset.nNeighbors",
    forModels: ["LWPLS"],
  },
  // IntervalPLS
  {
    name: "n_intervals",
    type: "int",
    low: 5,
    high: 50,
    step: 5,
    descriptionKey: "pipelineEditor.finetune.preset.nIntervals",
    forModels: ["IntervalPLS"],
  },
];

/**
 * Common training parameters for neural networks
 */
export const trainParamPresets: ParamPreset[] = [
  { name: "epochs", type: "int", low: 10, high: 500, step: 10, descriptionKey: "pipelineEditor.finetune.preset.epochs" },
  {
    name: "batch_size",
    type: "categorical",
    choices: [16, 32, 64, 128, 256],
    descriptionKey: "pipelineEditor.finetune.preset.batchSize",
  },
  { name: "learning_rate", type: "log_float", low: 0.0001, high: 0.1, descriptionKey: "pipelineEditor.finetune.preset.learningRate" },
  { name: "patience", type: "int", low: 5, high: 50, step: 5, descriptionKey: "pipelineEditor.finetune.preset.patience" },
  { name: "dropout", type: "float", low: 0.0, high: 0.5, step: 0.1, descriptionKey: "pipelineEditor.finetune.preset.dropout" },
  { name: "weight_decay", type: "log_float", low: 0.00001, high: 0.01, descriptionKey: "pipelineEditor.finetune.preset.weightDecay" },
];

/**
 * Static training parameter presets for final/best model (higher values)
 */
export const staticTrainParamPresets: StaticParamPreset[] = [
  { name: "epochs", default: 500, type: "number", descriptionKey: "pipelineEditor.finetune.preset.epochsFull" },
  { name: "batch_size", default: 32, type: "number", descriptionKey: "pipelineEditor.finetune.preset.batchSize" },
  { name: "learning_rate", default: 0.001, type: "number", descriptionKey: "pipelineEditor.finetune.preset.learningRate" },
  { name: "patience", default: 50, type: "number", descriptionKey: "pipelineEditor.finetune.preset.patience" },
  { name: "verbose", default: 0, type: "number", descriptionKey: "pipelineEditor.finetune.preset.verbosity" },
];

/**
 * Trial training parameter presets (quick training during search)
 * Lower values to speed up hyperparameter search
 */
export const trialTrainParamPresets: StaticParamPreset[] = [
  { name: "epochs", default: 50, type: "number", descriptionKey: "pipelineEditor.finetune.preset.epochsTrial" },
  { name: "batch_size", default: 64, type: "number", descriptionKey: "pipelineEditor.finetune.preset.batchSizeTrial" },
  { name: "patience", default: 10, type: "number", descriptionKey: "pipelineEditor.finetune.preset.patience" },
  { name: "verbose", default: 0, type: "number", descriptionKey: "pipelineEditor.finetune.preset.verbosity" },
];

/**
 * Get relevant presets for a model
 */
export function getPresetsForModel(modelName: string): ParamPreset[] {
  return paramPresets.filter((p) => !p.forModels || p.forModels.includes(modelName));
}
