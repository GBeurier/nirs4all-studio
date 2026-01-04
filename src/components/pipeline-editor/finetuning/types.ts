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
 * Neural network model names that support train_params
 */
export const NEURAL_NETWORK_MODELS = [
  "Nicon",
  "MLPRegressor",
  "MLPClassifier",
  "DeepPLS",
  "TabPFN",
  "XGBoost",
  "LightGBM",
  "CatBoost",
];

/**
 * Check if a model is a neural network model
 */
export function isNeuralNetworkModel(modelName: string): boolean {
  return NEURAL_NETWORK_MODELS.some((m) =>
    modelName.toLowerCase().includes(m.toLowerCase())
  );
}
