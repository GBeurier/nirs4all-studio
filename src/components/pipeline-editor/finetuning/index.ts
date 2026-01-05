/**
 * Finetuning module exports
 *
 * Provides all finetuning-related components and utilities.
 *
 * Three types of training parameters:
 * 1. TrainParamsList - Training params to tune (ranges for Optuna)
 * 2. TrialTrainingConfig - Quick fixed params per trial (e.g., 50 epochs)
 * 3. BestModelTrainingConfig - Fixed final training params (e.g., 500 epochs)
 */

// Main components
export { FinetuneTab, defaultFinetuneConfig } from "./FinetuneTab";
export { FinetuneEnableToggle } from "./FinetuneEnableToggle";
export { FinetuneSearchConfig } from "./FinetuneSearchConfig";
export { FinetuneParamList } from "./FinetuneParamList";
export { FinetuneParamEditor } from "./FinetuneParamEditor";
export { TrainParamsList } from "./TrainParamsList";
export { TrialTrainingConfig } from "./TrialTrainingConfig";
export { BestModelTrainingConfig } from "./BestModelTrainingConfig";
export { FinetuningBadge } from "./FinetuningBadge";
export { QuickFinetuneButton } from "./QuickFinetuneButton";

// Presets and utilities
export {
  paramPresets,
  trainParamPresets,
  trialTrainParamPresets,
  staticTrainParamPresets,
  getPresetsForModel,
} from "./presets";

// Types and utilities
export {
  formatParamType,
  getParamTypeIcon,
  isNeuralNetworkModel,
  NEURAL_NETWORK_MODELS,
  type ParamPreset,
  type StaticParamPreset,
} from "./types";
