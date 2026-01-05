/**
 * Finetuning types and utilities
 *
 * Centralized type definitions and helper functions for finetuning components.
 */

import type { FinetuneParamType, FinetuneParamConfig } from "../types";
import { Hash, TrendingUp, Sparkles, List, type LucideIcon } from "lucide-react";

/**
 * Parameter preset for auto-configuration
 */
export interface ParamPreset {
  name: string;
  type: FinetuneParamType;
  low?: number;
  high?: number;
  step?: number;
  choices?: (string | number)[];
  description: string;
  forModels?: string[];
}

/**
 * Static training parameter preset (fixed values, not ranges)
 */
export interface StaticParamPreset {
  name: string;
  default: number;
  type: "number";
  description: string;
}

/**
 * Format parameter type for display
 */
export function formatParamType(type: FinetuneParamType): string {
  switch (type) {
    case "int":
      return "Integer";
    case "float":
      return "Float";
    case "log_float":
      return "Log Float";
    case "categorical":
      return "Categorical";
    default:
      return type;
  }
}

/**
 * Get icon for parameter type
 */
export function getParamTypeIcon(type: FinetuneParamType): LucideIcon {
  switch (type) {
    case "int":
      return Hash;
    case "float":
      return TrendingUp;
    case "log_float":
      return Sparkles;
    case "categorical":
      return List;
    default:
      return Hash;
  }
}

/**
 * Neural network model names that support train_params (Optuna tunable training parameters)
 */
export const NEURAL_NETWORK_MODELS = [
  "Nicon",
  "MLPRegressor",
  "MLPClassifier",
  "DeepPLS",
  "TabPFN",
];

/**
 * Boosting models that support training parameters like n_estimators, learning_rate
 */
export const BOOSTING_MODELS = [
  "XGBoost",
  "LightGBM",
  "CatBoost",
  "GradientBoosting",
  "HistGradientBoosting",
  "AdaBoost",
];

/**
 * All models that support training parameters
 */
export const MODELS_WITH_TRAIN_PARAMS = [
  ...NEURAL_NETWORK_MODELS,
  ...BOOSTING_MODELS,
];

/**
 * Check if a model is a neural network model (supports epochs, batch_size, etc.)
 */
export function isNeuralNetworkModel(modelName: string): boolean {
  return NEURAL_NETWORK_MODELS.some((m) =>
    modelName.toLowerCase().includes(m.toLowerCase())
  );
}

/**
 * Check if a model supports training parameters (any model with tunable training)
 */
export function hasTrainParams(modelName: string): boolean {
  return MODELS_WITH_TRAIN_PARAMS.some((m) =>
    modelName.toLowerCase().includes(m.toLowerCase())
  );
}
