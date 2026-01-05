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
    description: "Number of PLS components",
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
    description: "Regularization strength (log scale)",
    forModels: ["Ridge", "Lasso", "ElasticNet", "SparsePLS"],
  },
  {
    name: "l1_ratio",
    type: "float",
    low: 0,
    high: 1,
    description: "L1/L2 ratio for ElasticNet",
    forModels: ["ElasticNet"],
  },
  // SVM
  {
    name: "C",
    type: "log_float",
    low: 0.01,
    high: 100,
    description: "SVM regularization parameter",
    forModels: ["SVR", "SVC"],
  },
  {
    name: "epsilon",
    type: "log_float",
    low: 0.001,
    high: 1,
    description: "SVR epsilon",
    forModels: ["SVR"],
  },
  {
    name: "gamma",
    type: "log_float",
    low: 0.0001,
    high: 10,
    description: "RBF kernel gamma",
    forModels: ["SVR", "SVC", "KernelPLS"],
  },
  {
    name: "kernel",
    type: "categorical",
    choices: ["rbf", "linear", "poly"],
    description: "SVM kernel type",
    forModels: ["SVR", "SVC", "KernelPLS"],
  },
  // Ensemble
  {
    name: "n_estimators",
    type: "int",
    low: 50,
    high: 500,
    step: 50,
    description: "Number of trees in ensemble",
    forModels: ["RandomForestRegressor", "RandomForestClassifier", "XGBoost", "LightGBM"],
  },
  {
    name: "max_depth",
    type: "int",
    low: 3,
    high: 20,
    step: 1,
    description: "Maximum tree depth",
    forModels: ["RandomForestRegressor", "RandomForestClassifier", "XGBoost", "LightGBM"],
  },
  {
    name: "learning_rate",
    type: "log_float",
    low: 0.001,
    high: 0.3,
    description: "Gradient boosting learning rate",
    forModels: ["XGBoost", "LightGBM"],
  },
  // LWPLS
  {
    name: "n_neighbors",
    type: "int",
    low: 10,
    high: 100,
    step: 10,
    description: "Number of neighbors for local weighting",
    forModels: ["LWPLS"],
  },
  // IntervalPLS
  {
    name: "n_intervals",
    type: "int",
    low: 5,
    high: 50,
    step: 5,
    description: "Number of spectral intervals",
    forModels: ["IntervalPLS"],
  },
];

/**
 * Common training parameters for neural networks
 */
export const trainParamPresets: ParamPreset[] = [
  { name: "epochs", type: "int", low: 10, high: 500, step: 10, description: "Training epochs" },
  {
    name: "batch_size",
    type: "categorical",
    choices: [16, 32, 64, 128, 256],
    description: "Batch size",
  },
  { name: "learning_rate", type: "log_float", low: 0.0001, high: 0.1, description: "Learning rate" },
  { name: "patience", type: "int", low: 5, high: 50, step: 5, description: "Early stopping patience" },
  { name: "dropout", type: "float", low: 0.0, high: 0.5, step: 0.1, description: "Dropout rate" },
  { name: "weight_decay", type: "log_float", low: 0.00001, high: 0.01, description: "Weight decay" },
];

/**
 * Static training parameter presets for final/best model (higher values)
 */
export const staticTrainParamPresets: StaticParamPreset[] = [
  { name: "epochs", default: 500, type: "number", description: "Training epochs (full training)" },
  { name: "batch_size", default: 32, type: "number", description: "Batch size" },
  { name: "learning_rate", default: 0.001, type: "number", description: "Learning rate" },
  { name: "patience", default: 50, type: "number", description: "Early stopping patience" },
  { name: "verbose", default: 0, type: "number", description: "Verbosity level (0-2)" },
];

/**
 * Trial training parameter presets (quick training during search)
 * Lower values to speed up hyperparameter search
 */
export const trialTrainParamPresets: StaticParamPreset[] = [
  { name: "epochs", default: 50, type: "number", description: "Quick training epochs per trial" },
  { name: "batch_size", default: 64, type: "number", description: "Batch size for trials" },
  { name: "patience", default: 10, type: "number", description: "Early stopping patience" },
  { name: "verbose", default: 0, type: "number", description: "Verbosity level (0-2)" },
];

/**
 * Get relevant presets for a model
 */
export function getPresetsForModel(modelName: string): ParamPreset[] {
  return paramPresets.filter((p) => !p.forModels || p.forModels.includes(modelName));
}
