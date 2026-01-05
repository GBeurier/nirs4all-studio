/**
 * Pipeline Converter
 * ==================
 *
 * Bidirectional conversion between nirs4all canonical pipeline format and
 * the webapp's editor format.
 *
 * nirs4all canonical format:
 * - Uses `{"class": "module.path.ClassName", "params": {...}}`
 * - Keywords: model, y_processing, branch, merge, sample_augmentation, etc.
 * - Generators: _or_, _range_, _log_range_, _grid_ at step level
 *
 * Editor format:
 * - Uses `{ id, type, name, params, branches, ... }`
 * - Type is separate field
 * - Name is display name (e.g., "SNV", "PLSRegression")
 */

import type { PipelineStep as EditorPipelineStep, StepType, FinetuneParamConfig, FinetuneParamType } from "@/components/pipeline-editor/types";
import type { PipelineStep as ApiPipelineStep } from "@/types/pipelines";
import { generateStepId } from "@/components/pipeline-editor/types";

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * nirs4all canonical step format (serialized).
 * This matches what PipelineConfigs outputs.
 */
export type Nirs4allStep =
  | string // Class path only, e.g., "sklearn.preprocessing._data.StandardScaler"
  | Nirs4allClassStep
  | Nirs4allModelStep
  | Nirs4allYProcessingStep
  | Nirs4allBranchStep
  | Nirs4allMergeStep
  | Nirs4allSampleAugmentationStep
  | Nirs4allFeatureAugmentationStep
  | Nirs4allSampleFilterStep
  | Nirs4allConcatTransformStep
  | Nirs4allGeneratorStep
  | Nirs4allChartStep;

export interface Nirs4allClassStep {
  class: string;
  params?: Record<string, unknown>;
}

export interface Nirs4allModelStep {
  model: string | Nirs4allClassStep | { function: string; params?: Record<string, unknown> };
  name?: string;
  finetune_params?: Record<string, unknown>;
  train_params?: Record<string, unknown>;
  // Generator keywords can appear at model level
  _range_?: [number, number, number];
  _log_range_?: [number, number, number];
  _grid_?: Record<string, unknown[]>;
  param?: string;
}

export interface Nirs4allYProcessingStep {
  y_processing: string | Nirs4allClassStep;
}

export interface Nirs4allBranchStep {
  branch: Record<string, Nirs4allStep[]> | Nirs4allStep[][];
}

export interface Nirs4allMergeStep {
  merge: string | {
    predictions?: Array<{
      branch: number;
      select: string | { top_k: number };
      metric?: string;
    }>;
    features?: number[];
    output_as?: string;
    on_missing?: string;
  };
}

export interface Nirs4allSampleAugmentationStep {
  sample_augmentation: {
    transformers: Array<string | Nirs4allClassStep>;
    count?: number;
    selection?: string;
    random_state?: number;
  };
}

export interface Nirs4allFeatureAugmentationStep {
  feature_augmentation: Nirs4allStep[] | {
    _or_?: Array<string | Nirs4allClassStep>;
    pick?: number | [number, number];
    count?: number;
  };
  action?: string;
}

export interface Nirs4allSampleFilterStep {
  sample_filter: {
    filters: Array<string | Nirs4allClassStep>;
    mode?: string;
    report?: boolean;
  };
}

export interface Nirs4allConcatTransformStep {
  concat_transform: Array<Nirs4allStep | Nirs4allStep[]>;
}

export interface Nirs4allGeneratorStep {
  _or_?: Nirs4allStep[];
  _range_?: [number, number, number];
  _log_range_?: [number, number, number];
  _grid_?: Record<string, unknown[]>;
  pick?: number | [number, number];
  arrange?: number | [number, number];
  then_pick?: number | [number, number];
  then_arrange?: number | [number, number];
  count?: number;
}

export interface Nirs4allChartStep {
  chart_2d?: Record<string, unknown> | true;
  chart_y?: Record<string, unknown> | true;
}

export interface Nirs4allPipeline {
  name?: string;
  description?: string;
  pipeline: Nirs4allStep[];
}

// ============================================================================
// Class Path Mappings
// ============================================================================

/**
 * Map class paths to display names and step types.
 * This handles the internal sklearn paths like sklearn.preprocessing._data.MinMaxScaler
 */
const CLASS_PATH_MAPPINGS: Record<string, { name: string; type: StepType }> = {
  // sklearn preprocessing
  "sklearn.preprocessing._data.MinMaxScaler": { name: "MinMaxScaler", type: "preprocessing" },
  "sklearn.preprocessing._data.StandardScaler": { name: "StandardScaler", type: "preprocessing" },
  "sklearn.preprocessing._data.RobustScaler": { name: "RobustScaler", type: "preprocessing" },
  "sklearn.preprocessing._data.MaxAbsScaler": { name: "MaxAbsScaler", type: "preprocessing" },
  "sklearn.preprocessing._data.Normalizer": { name: "Normalizer", type: "preprocessing" },
  "sklearn.preprocessing._polynomial.PolynomialFeatures": { name: "PolynomialFeatures", type: "preprocessing" },
  "sklearn.preprocessing._data.PowerTransformer": { name: "PowerTransformer", type: "preprocessing" },
  "sklearn.preprocessing._data.QuantileTransformer": { name: "QuantileTransformer", type: "preprocessing" },
  "sklearn.preprocessing.MinMaxScaler": { name: "MinMaxScaler", type: "preprocessing" },
  "sklearn.preprocessing.StandardScaler": { name: "StandardScaler", type: "preprocessing" },
  "sklearn.preprocessing.RobustScaler": { name: "RobustScaler", type: "preprocessing" },

  // sklearn decomposition
  "sklearn.decomposition._pca.PCA": { name: "PCA", type: "preprocessing" },
  "sklearn.decomposition._truncated_svd.TruncatedSVD": { name: "TruncatedSVD", type: "preprocessing" },
  "sklearn.decomposition.PCA": { name: "PCA", type: "preprocessing" },
  "sklearn.decomposition.TruncatedSVD": { name: "TruncatedSVD", type: "preprocessing" },

  // sklearn splitters
  "sklearn.model_selection._split.KFold": { name: "KFold", type: "splitting" },
  "sklearn.model_selection._split.ShuffleSplit": { name: "ShuffleSplit", type: "splitting" },
  "sklearn.model_selection._split.StratifiedKFold": { name: "StratifiedKFold", type: "splitting" },
  "sklearn.model_selection._split.GroupKFold": { name: "GroupKFold", type: "splitting" },
  "sklearn.model_selection._split.RepeatedKFold": { name: "RepeatedKFold", type: "splitting" },
  "sklearn.model_selection._split.LeaveOneOut": { name: "LeaveOneOut", type: "splitting" },
  "sklearn.model_selection.KFold": { name: "KFold", type: "splitting" },
  "sklearn.model_selection.ShuffleSplit": { name: "ShuffleSplit", type: "splitting" },

  // sklearn models
  "sklearn.cross_decomposition._pls.PLSRegression": { name: "PLSRegression", type: "model" },
  "sklearn.cross_decomposition.PLSRegression": { name: "PLSRegression", type: "model" },
  "sklearn.ensemble._forest.RandomForestRegressor": { name: "RandomForestRegressor", type: "model" },
  "sklearn.ensemble.RandomForestRegressor": { name: "RandomForestRegressor", type: "model" },
  "sklearn.ensemble._forest.RandomForestClassifier": { name: "RandomForestClassifier", type: "model" },
  "sklearn.ensemble._gb.GradientBoostingRegressor": { name: "GradientBoostingRegressor", type: "model" },
  "sklearn.ensemble.GradientBoostingRegressor": { name: "GradientBoostingRegressor", type: "model" },
  "sklearn.linear_model._ridge.Ridge": { name: "Ridge", type: "model" },
  "sklearn.linear_model.Ridge": { name: "Ridge", type: "model" },
  "sklearn.linear_model._coordinate_descent.Lasso": { name: "Lasso", type: "model" },
  "sklearn.linear_model.Lasso": { name: "Lasso", type: "model" },
  "sklearn.linear_model._coordinate_descent.ElasticNet": { name: "ElasticNet", type: "model" },
  "sklearn.linear_model.ElasticNet": { name: "ElasticNet", type: "model" },
  "sklearn.svm._classes.SVR": { name: "SVR", type: "model" },
  "sklearn.svm.SVR": { name: "SVR", type: "model" },

  // nirs4all transforms (both internal and public API paths)
  "nirs4all.operators.transforms.scalers.StandardNormalVariate": { name: "SNV", type: "preprocessing" },
  "nirs4all.operators.transforms.nirs.StandardNormalVariate": { name: "SNV", type: "preprocessing" },
  "nirs4all.operators.transforms.StandardNormalVariate": { name: "SNV", type: "preprocessing" },
  "nirs4all.operators.transforms.nirs.MultiplicativeScatterCorrection": { name: "MSC", type: "preprocessing" },
  "nirs4all.operators.transforms.MultiplicativeScatterCorrection": { name: "MSC", type: "preprocessing" },
  "nirs4all.operators.transforms.nirs.FirstDerivative": { name: "FirstDerivative", type: "preprocessing" },
  "nirs4all.operators.transforms.FirstDerivative": { name: "FirstDerivative", type: "preprocessing" },
  "nirs4all.operators.transforms.nirs.SecondDerivative": { name: "SecondDerivative", type: "preprocessing" },
  "nirs4all.operators.transforms.SecondDerivative": { name: "SecondDerivative", type: "preprocessing" },
  "nirs4all.operators.transforms.nirs.SavitzkyGolay": { name: "SavitzkyGolay", type: "preprocessing" },
  "nirs4all.operators.transforms.SavitzkyGolay": { name: "SavitzkyGolay", type: "preprocessing" },
  "nirs4all.operators.transforms.signal.Detrend": { name: "Detrend", type: "preprocessing" },
  "nirs4all.operators.transforms.Detrend": { name: "Detrend", type: "preprocessing" },
  "nirs4all.operators.transforms.signal.Gaussian": { name: "Gaussian", type: "preprocessing" },
  "nirs4all.operators.transforms.Gaussian": { name: "Gaussian", type: "preprocessing" },
  "nirs4all.operators.transforms.baseline.ASLSBaseline": { name: "ASLSBaseline", type: "preprocessing" },
  "nirs4all.operators.transforms.baseline.AirPLS": { name: "AirPLS", type: "preprocessing" },
  "nirs4all.operators.transforms.baseline.ArPLS": { name: "ArPLS", type: "preprocessing" },

  // nirs4all augmentation transforms (both internal paths and public API paths)
  "nirs4all.operators.augmentation.random.Rotate_Translate": { name: "Rotate_Translate", type: "augmentation" },
  "nirs4all.operators.transforms.Rotate_Translate": { name: "Rotate_Translate", type: "augmentation" },
  "nirs4all.operators.augmentation.spectral.GaussianAdditiveNoise": { name: "GaussianNoise", type: "augmentation" },
  "nirs4all.operators.transforms.GaussianAdditiveNoise": { name: "GaussianNoise", type: "augmentation" },
  "nirs4all.operators.augmentation.spectral.MultiplicativeNoise": { name: "MultiplicativeNoise", type: "augmentation" },
  "nirs4all.operators.transforms.MultiplicativeNoise": { name: "MultiplicativeNoise", type: "augmentation" },
  "nirs4all.operators.augmentation.spectral.LinearBaselineDrift": { name: "LinearBaselineDrift", type: "augmentation" },
  "nirs4all.operators.transforms.LinearBaselineDrift": { name: "LinearBaselineDrift", type: "augmentation" },
  "nirs4all.operators.augmentation.spectral.WavelengthShift": { name: "WavelengthShift", type: "augmentation" },
  "nirs4all.operators.transforms.WavelengthShift": { name: "WavelengthShift", type: "augmentation" },

  // nirs4all filters (both internal paths and public API paths)
  "nirs4all.operators.filters.y_outlier.YOutlierFilter": { name: "YOutlierFilter", type: "filter" },
  "nirs4all.operators.filters.YOutlierFilter": { name: "YOutlierFilter", type: "filter" },
  "nirs4all.operators.filters.spectral_quality.SpectralQualityFilter": { name: "SpectralQualityFilter", type: "filter" },
  "nirs4all.operators.filters.SpectralQualityFilter": { name: "SpectralQualityFilter", type: "filter" },

  // nirs4all splitters (both internal paths and public API paths)
  "nirs4all.operators.splitters.splitters.SPXYGFold": { name: "SPXYGFold", type: "splitting" },
  "nirs4all.operators.splitters.SPXYGFold": { name: "SPXYGFold", type: "splitting" },
  "nirs4all.operators.splitters.splitters.KennardStoneSplitter": { name: "KennardStone", type: "splitting" },
  "nirs4all.operators.splitters.KennardStoneSplitter": { name: "KennardStone", type: "splitting" },

  // nirs4all models (both internal paths and public API paths)
  "nirs4all.operators.models.meta.MetaModel": { name: "MetaModel", type: "model" },
  "nirs4all.operators.models.MetaModel": { name: "MetaModel", type: "model" },
  "nirs4all.operators.models.pls.OPLS": { name: "OPLS", type: "model" },
  "nirs4all.operators.models.OPLS": { name: "OPLS", type: "model" },
  "nirs4all.operators.models.pls.IKPLS": { name: "IKPLS", type: "model" },
  "nirs4all.operators.models.IKPLS": { name: "IKPLS", type: "model" },
  "nirs4all.operators.models.pls.LWPLS": { name: "LWPLS", type: "model" },
  "nirs4all.operators.models.LWPLS": { name: "LWPLS", type: "model" },
  "nirs4all.operators.models.tensorflow.nicon.customizable_nicon": { name: "nicon", type: "model" },
};

/**
 * Reverse mapping: display name + type → class path
 */
const NAME_TO_CLASS_PATH: Record<string, string> = {
  // sklearn preprocessing
  "preprocessing:MinMaxScaler": "sklearn.preprocessing.MinMaxScaler",
  "preprocessing:StandardScaler": "sklearn.preprocessing.StandardScaler",
  "preprocessing:RobustScaler": "sklearn.preprocessing.RobustScaler",
  "preprocessing:PCA": "sklearn.decomposition.PCA",
  "preprocessing:TruncatedSVD": "sklearn.decomposition.TruncatedSVD",

  // y_processing (same scalers but used for target)
  "y_processing:MinMaxScaler": "sklearn.preprocessing.MinMaxScaler",
  "y_processing:StandardScaler": "sklearn.preprocessing.StandardScaler",
  "y_processing:RobustScaler": "sklearn.preprocessing.RobustScaler",

  // sklearn splitters
  "splitting:KFold": "sklearn.model_selection.KFold",
  "splitting:ShuffleSplit": "sklearn.model_selection.ShuffleSplit",
  "splitting:StratifiedKFold": "sklearn.model_selection.StratifiedKFold",
  "splitting:GroupKFold": "sklearn.model_selection.GroupKFold",
  "splitting:LeaveOneOut": "sklearn.model_selection.LeaveOneOut",

  // sklearn models
  "model:PLSRegression": "sklearn.cross_decomposition.PLSRegression",
  "model:RandomForestRegressor": "sklearn.ensemble.RandomForestRegressor",
  "model:RandomForestClassifier": "sklearn.ensemble.RandomForestClassifier",
  "model:GradientBoostingRegressor": "sklearn.ensemble.GradientBoostingRegressor",
  "model:Ridge": "sklearn.linear_model.Ridge",
  "model:Lasso": "sklearn.linear_model.Lasso",
  "model:ElasticNet": "sklearn.linear_model.ElasticNet",
  "model:SVR": "sklearn.svm.SVR",

  // nirs4all transforms
  "preprocessing:SNV": "nirs4all.operators.transforms.StandardNormalVariate",
  "preprocessing:MSC": "nirs4all.operators.transforms.MultiplicativeScatterCorrection",
  "preprocessing:FirstDerivative": "nirs4all.operators.transforms.FirstDerivative",
  "preprocessing:SecondDerivative": "nirs4all.operators.transforms.SecondDerivative",
  "preprocessing:SavitzkyGolay": "nirs4all.operators.transforms.SavitzkyGolay",
  "preprocessing:Detrend": "nirs4all.operators.transforms.Detrend",
  "preprocessing:Gaussian": "nirs4all.operators.transforms.Gaussian",
  "preprocessing:ASLSBaseline": "nirs4all.operators.transforms.ASLSBaseline",

  // nirs4all splitters
  "splitting:SPXYGFold": "nirs4all.operators.splitters.SPXYGFold",
  "splitting:KennardStone": "nirs4all.operators.splitters.KennardStoneSplitter",
  "splitting:SPXY": "nirs4all.operators.splitters.SPXYSplitter",

  // nirs4all models
  "model:MetaModel": "nirs4all.operators.models.MetaModel",
  "model:OPLS": "nirs4all.operators.models.OPLS",
  "model:IKPLS": "nirs4all.operators.models.IKPLS",
  "model:LWPLS": "nirs4all.operators.models.LWPLS",
  "model:nicon": "nirs4all.operators.models.tensorflow.nicon.customizable_nicon",

  // Augmentation
  "augmentation:GaussianNoise": "nirs4all.operators.transforms.GaussianAdditiveNoise",
  "augmentation:MultiplicativeNoise": "nirs4all.operators.transforms.MultiplicativeNoise",
  "augmentation:WavelengthShift": "nirs4all.operators.transforms.WavelengthShift",
  "augmentation:LinearBaselineDrift": "nirs4all.operators.transforms.LinearBaselineDrift",

  // Filters
  "filter:YOutlierFilter": "nirs4all.operators.filters.YOutlierFilter",
  "filter:SpectralQualityFilter": "nirs4all.operators.filters.SpectralQualityFilter",
};

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Extract class name from full path.
 * e.g., "sklearn.preprocessing._data.MinMaxScaler" -> "MinMaxScaler"
 */
function getClassNameFromPath(classPath: string): string {
  const parts = classPath.split(".");
  return parts[parts.length - 1];
}

/**
 * Get step type and display name from a class path.
 */
function resolveClassPath(classPath: string): { name: string; type: StepType } {
  // Check direct mapping first
  if (CLASS_PATH_MAPPINGS[classPath]) {
    return CLASS_PATH_MAPPINGS[classPath];
  }

  // Try to infer from path
  const className = getClassNameFromPath(classPath);

  if (classPath.includes("model_selection") || classPath.includes("splitters")) {
    return { name: className, type: "splitting" };
  }
  if (classPath.includes("cross_decomposition") || classPath.includes("ensemble") ||
      classPath.includes("linear_model") || classPath.includes("svm") ||
      classPath.includes("models")) {
    return { name: className, type: "model" };
  }
  if (classPath.includes("preprocessing") || classPath.includes("decomposition") ||
      classPath.includes("transforms")) {
    return { name: className, type: "preprocessing" };
  }
  if (classPath.includes("augmentation")) {
    return { name: className, type: "augmentation" };
  }
  if (classPath.includes("filters")) {
    return { name: className, type: "filter" };
  }

  // Default to preprocessing
  return { name: className, type: "preprocessing" };
}

/**
 * Get class path from editor step info.
 */
function getClassPath(type: StepType, name: string): string {
  const key = `${type}:${name}`;
  if (NAME_TO_CLASS_PATH[key]) {
    return NAME_TO_CLASS_PATH[key];
  }

  // Fallback: try common prefixes
  if (type === "preprocessing") {
    return `sklearn.preprocessing.${name}`;
  }
  if (type === "splitting") {
    return `sklearn.model_selection.${name}`;
  }
  if (type === "model") {
    return `sklearn.cross_decomposition.${name}`;
  }

  return name;
}

/**
 * Cast params from unknown to editor params type.
 * This sanitizes the params object for the editor.
 */
type EditorParams = Record<string, string | number | boolean>;

function castParams(params: Record<string, unknown> | undefined): EditorParams {
  if (!params) return {};
  const result: EditorParams = {};
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      result[key] = value;
    } else if (Array.isArray(value)) {
      // Store arrays as JSON strings for now (editor can handle this)
      result[key] = JSON.stringify(value);
    } else if (value !== null && value !== undefined) {
      // Store complex objects as JSON strings
      result[key] = JSON.stringify(value);
    }
  }
  return result;
}

// ============================================================================
// Import: nirs4all → Editor Format
// ============================================================================

/**
 * Convert a nirs4all canonical pipeline to editor format.
 */
export function importFromNirs4all(pipeline: Nirs4allPipeline | Nirs4allStep[]): EditorPipelineStep[] {
  const steps = Array.isArray(pipeline) ? pipeline : pipeline.pipeline;
  return steps.map(step => convertStepToEditor(step));
}

/**
 * Convert a single nirs4all step to editor format.
 */
function convertStepToEditor(step: Nirs4allStep): EditorPipelineStep {
  // Handle string class path (no params)
  if (typeof step === "string") {
    // Check for special chart strings
    if (step === "chart_2d" || step === "chart_y") {
      return {
        id: generateStepId(),
        type: "chart",
        name: step,
        params: {},
        chartConfig: {
          chartType: step,
        },
      };
    }

    const { name, type } = resolveClassPath(step);
    return {
      id: generateStepId(),
      type,
      name,
      params: {},
      classPath: step,
    };
  }

  // Handle comment step (skip it / mark as comment type)
  if ("_comment" in step) {
    const text = (step as { _comment: string })._comment;
    return {
      id: generateStepId(),
      type: "comment",
      name: "Comment",
      params: { text },
    };
  }

  // Handle model step
  if ("model" in step) {
    return convertModelStepToEditor(step as Nirs4allModelStep);
  }

  // Handle y_processing step
  if ("y_processing" in step) {
    return convertYProcessingToEditor(step as Nirs4allYProcessingStep);
  }

  // Handle branch step
  if ("branch" in step) {
    return convertBranchToEditor(step as Nirs4allBranchStep);
  }

  // Handle merge step
  if ("merge" in step) {
    return convertMergeToEditor(step as Nirs4allMergeStep);
  }

  // Handle sample_augmentation
  if ("sample_augmentation" in step) {
    return convertSampleAugmentationToEditor(step as Nirs4allSampleAugmentationStep);
  }

  // Handle feature_augmentation
  if ("feature_augmentation" in step) {
    return convertFeatureAugmentationToEditor(step as Nirs4allFeatureAugmentationStep);
  }

  // Handle sample_filter
  if ("sample_filter" in step) {
    return convertSampleFilterToEditor(step as Nirs4allSampleFilterStep);
  }

  // Handle concat_transform
  if ("concat_transform" in step) {
    return convertConcatTransformToEditor(step as Nirs4allConcatTransformStep);
  }

  // Handle preprocessing keyword (explicit preprocessing)
  if ("preprocessing" in step) {
    const preprocessingValue = (step as { preprocessing: string | Nirs4allClassStep }).preprocessing;
    if (typeof preprocessingValue === "string") {
      const { name, type } = resolveClassPath(preprocessingValue);
      return { id: generateStepId(), type, name, params: {}, classPath: preprocessingValue };
    } else {
      const { name, type } = resolveClassPath(preprocessingValue.class);
      return { id: generateStepId(), type, name, params: castParams(preprocessingValue.params), classPath: preprocessingValue.class };
    }
  }

  // Handle chart steps (as dict with chart_2d or chart_y key)
  if ("chart_2d" in step || "chart_y" in step) {
    const chartType = "chart_2d" in step ? "chart_2d" : "chart_y";
    const chartValue = (step as Nirs4allChartStep)[chartType as keyof Nirs4allChartStep];
    let chartParams: EditorParams = {};
    if (chartValue !== undefined && chartValue !== true && typeof chartValue === "object") {
      chartParams = castParams(chartValue as Record<string, unknown>);
    }
    return {
      id: generateStepId(),
      type: "chart",
      name: chartType,
      params: chartParams,
      chartConfig: {
        chartType: chartType as "chart_2d" | "chart_y",
        ...chartParams,
      },
    };
  }

  // Handle _or_ generator at root level
  if ("_or_" in step) {
    return convertOrGeneratorToEditor(step as Nirs4allGeneratorStep);
  }

  // Handle class-based step
  if ("class" in step) {
    const classStep = step as Nirs4allClassStep;
    const { name, type } = resolveClassPath(classStep.class);
    return {
      id: generateStepId(),
      type,
      name,
      params: castParams(classStep.params),
      classPath: classStep.class,
    };
  }

  // Unknown step type - best effort, store raw data
  console.warn("Unknown step type:", step);
  return {
    id: generateStepId(),
    type: "preprocessing",
    name: "Unknown",
    params: {},
    rawNirs4all: step,
  };
}

function convertModelStepToEditor(step: Nirs4allModelStep): EditorPipelineStep {
  let name = "UnknownModel";
  let params: EditorParams = {};
  let functionPath: string | undefined;
  let classPath: string | undefined;

  if (typeof step.model === "string") {
    const resolved = resolveClassPath(step.model);
    name = resolved.name;
    classPath = step.model;
  } else if ("class" in step.model) {
    const resolved = resolveClassPath(step.model.class);
    name = resolved.name;
    params = castParams(step.model.params);
    classPath = step.model.class;
  } else if ("function" in step.model) {
    // Function-based models like nicon
    functionPath = step.model.function;
    name = getClassNameFromPath(step.model.function);
    params = castParams(step.model.params);
  }

  const editorStep: EditorPipelineStep = {
    id: generateStepId(),
    type: "model",
    name,
    params,
  };

  // Store class path for export
  if (classPath) {
    editorStep.classPath = classPath;
  }

  // Store function path for function-based operators
  if (functionPath) {
    editorStep.functionPath = functionPath;
  }

  // Store custom name if present
  if (step.name) {
    editorStep.customName = step.name;
  }

  // Store finetuning config
  if (step.finetune_params) {
    editorStep.finetuneConfig = {
      enabled: true,
      n_trials: step.finetune_params.n_trials as number || 50,
      approach: step.finetune_params.approach as "grouped" | "individual" | "single" | "cross" || "single",
      eval_mode: step.finetune_params.eval_mode as "best" | "mean" || "best",
      sample: step.finetune_params.sample as "grid" | "random" | "hyperband" | undefined,
      verbose: step.finetune_params.verbose as number | undefined,
      model_params: [],
    };
    // Convert model_params to editor format
    if (step.finetune_params.model_params) {
      const modelParams = step.finetune_params.model_params as Record<string, unknown>;
      for (const [paramName, paramConfig] of Object.entries(modelParams)) {
        // Handle array format (categorical choices): [50, 100, 150, 200]
        if (Array.isArray(paramConfig)) {
          editorStep.finetuneConfig.model_params.push({
            name: paramName,
            type: "categorical",
            choices: paramConfig as (string | number)[],
          });
        }
        // Handle object format: {type: "int", low: 1, high: 20}
        else if (typeof paramConfig === "object" && paramConfig !== null) {
          const config = paramConfig as Record<string, unknown>;
          // Handle log parameter for float
          const paramType = config.log === true ? "log_float" : (config.type as string || "int");
          editorStep.finetuneConfig.model_params.push({
            name: paramName,
            type: paramType as "int" | "float" | "categorical" | "log_float",
            low: config.low as number,
            high: config.high as number,
            step: config.step as number,
            choices: config.choices as (string | number)[],
          });
        }
      }
    }
    // Store train_params tuning for neural networks
    if (step.finetune_params.train_params) {
      const trainParamsRecord = step.finetune_params.train_params as Record<string, unknown>;
      const trainParamsArray: FinetuneParamConfig[] = [];
      for (const [name, config] of Object.entries(trainParamsRecord)) {
        if (Array.isArray(config)) {
          // Categorical
          trainParamsArray.push({
            name,
            type: "categorical",
            choices: config as (string | number)[],
          });
        } else if (typeof config === "object" && config !== null) {
          const paramConfig = config as { type?: string; low?: number; high?: number; step?: number; log?: boolean };
          trainParamsArray.push({
            name,
            type: (paramConfig.log ? "log_float" : paramConfig.type as FinetuneParamType) || "float",
            low: paramConfig.low as number,
            high: paramConfig.high as number,
            step: paramConfig.step as number,
          });
        }
      }
      editorStep.finetuneConfig.train_params = trainParamsArray;
    }
  }

  // Store training config (top-level train_params for DL models)
  if (step.train_params) {
    editorStep.trainingConfig = {
      epochs: step.train_params.epochs as number || 100,
      batch_size: step.train_params.batch_size as number || 32,
      learning_rate: step.train_params.learning_rate as number || 0.001,
      patience: step.train_params.patience as number,
      optimizer: step.train_params.optimizer as "adam" | "sgd" | "rmsprop" | "adamw" || "adam",
      verbose: step.train_params.verbose as number,
    };
  }

  // Store generator sweep info
  if (step._range_ || step._log_range_ || step._grid_) {
    editorStep.paramSweeps = {};
    if (step._range_ && step.param) {
      editorStep.paramSweeps[step.param] = {
        type: "range",
        from: step._range_[0],
        to: step._range_[1],
        step: step._range_[2],
      };
    }
    if (step._log_range_ && step.param) {
      editorStep.paramSweeps[step.param] = {
        type: "log_range",
        from: step._log_range_[0],
        to: step._log_range_[1],
        count: step._log_range_[2],
      };
    }
    if (step._grid_) {
      // Grid applies to multiple params
      for (const [paramName, values] of Object.entries(step._grid_)) {
        editorStep.paramSweeps[paramName] = {
          type: "or",
          choices: values as (string | number | boolean)[],
        };
      }
    }
  }

  return editorStep;
}

function convertYProcessingToEditor(step: Nirs4allYProcessingStep): EditorPipelineStep {
  const yProc = step.y_processing;

  if (typeof yProc === "string") {
    const { name } = resolveClassPath(yProc);
    return {
      id: generateStepId(),
      type: "y_processing",
      name,
      params: {},
    };
  }

  const { name } = resolveClassPath(yProc.class);
  return {
    id: generateStepId(),
    type: "y_processing",
    name,
    params: castParams(yProc.params),
  };
}

function convertBranchToEditor(step: Nirs4allBranchStep): EditorPipelineStep {
  const branches: EditorPipelineStep[][] = [];
  const branchMetadata: Array<{ name?: string; isCollapsed?: boolean }> = [];

  const branchData = step.branch;

  if (Array.isArray(branchData)) {
    // Indexed branches: [[step1, step2], [step3, step4]]
    for (const branchSteps of branchData) {
      branches.push(branchSteps.map(s => convertStepToEditor(s)));
      branchMetadata.push({});
    }
  } else {
    // Named branches: { branchName: [steps], ... }
    for (const [branchName, branchSteps] of Object.entries(branchData)) {
      branches.push(branchSteps.map(s => convertStepToEditor(s)));
      branchMetadata.push({ name: branchName });
    }
  }

  return {
    id: generateStepId(),
    type: "branch",
    name: "ParallelBranch",
    params: {},
    branches,
    branchMetadata,
  };
}

function convertMergeToEditor(step: Nirs4allMergeStep): EditorPipelineStep {
  const merge = step.merge;

  if (typeof merge === "string") {
    return {
      id: generateStepId(),
      type: "merge",
      name: merge === "predictions" ? "Stacking" : "Concatenate",
      params: { merge_type: merge },
      mergeConfig: {
        mode: merge,
      },
    };
  }

  // Complex merge with predictions, features, output_as
  return {
    id: generateStepId(),
    type: "merge",
    name: "Stacking",
    params: {},
    mergeConfig: {
      mode: "predictions",
      predictions: merge.predictions?.map(p => ({
        branch: p.branch,
        select: p.select as "best" | "all" | { top_k: number },
        metric: p.metric as "rmse" | "r2" | "mae" | undefined,
      })),
      features: merge.features,
      output_as: merge.output_as as "features" | "predictions" | undefined,
      on_missing: merge.on_missing as "warn" | "error" | "drop" | undefined,
    },
    // Legacy stacking config for backward compatibility
    stackingConfig: {
      enabled: true,
      metaModel: "",
      metaModelParams: {},
      sourceModels: [],
      coverageStrategy: "drop",
      useOriginalFeatures: !!merge.features?.length,
      passthrough: false,
    },
  };
}

function convertSampleAugmentationToEditor(step: Nirs4allSampleAugmentationStep): EditorPipelineStep {
  const aug = step.sample_augmentation;

  // Convert nested transformers to editor format
  const transformerConfigs = aug.transformers.map(t => {
    if (typeof t === "string") {
      const { name } = resolveClassPath(t);
      return {
        id: generateStepId(),
        name,
        classPath: t,
        params: {},
        enabled: true,
      };
    }
    const { name } = resolveClassPath(t.class);
    return {
      id: generateStepId(),
      name,
      classPath: t.class,
      params: t.params || {},
      enabled: true,
    };
  });

  // Convert transformers to children (editable PipelineSteps)
  const childSteps = aug.transformers.map(t => {
    const converted = convertStepToEditor(t as Nirs4allStep);
    return converted;
  });

  return {
    id: generateStepId(),
    type: "sample_augmentation",
    name: "SampleAugmentation",
    params: {
      count: aug.count || 1,
      selection: aug.selection || "random",
      random_state: aug.random_state ?? 42,
    },
    // Children for editable transformers list
    children: childSteps,
    // Legacy: Store transformers as nested branches for visualization
    branches: [aug.transformers.map(t => convertStepToEditor(t as Nirs4allStep))],
    // Structured config for UI editing (legacy, prefer children)
    sampleAugmentationConfig: {
      transformers: transformerConfigs,
      count: aug.count,
      selection: aug.selection as "random" | "all" | "sequential" | undefined,
      random_state: aug.random_state,
    },
  };
}

function convertFeatureAugmentationToEditor(step: Nirs4allFeatureAugmentationStep): EditorPipelineStep {
  const aug = step.feature_augmentation;

  if (Array.isArray(aug)) {
    // Direct list of transforms
    const transformerConfigs = aug.map(t => {
      if (typeof t === "string") {
        const { name } = resolveClassPath(t as string);
        return { id: generateStepId(), name, classPath: t as string, params: {}, enabled: true };
      }
      const classStep = t as Nirs4allClassStep;
      const { name } = resolveClassPath(classStep.class);
      return { id: generateStepId(), name, classPath: classStep.class, params: classStep.params || {}, enabled: true };
    });

    // Convert transforms to children
    const childSteps = aug.map(t => convertStepToEditor(t));

    return {
      id: generateStepId(),
      type: "feature_augmentation",
      name: "FeatureAugmentation",
      params: { action: step.action || "extend" },
      children: childSteps,
      branches: [aug.map(t => convertStepToEditor(t))],
      featureAugmentationConfig: {
        action: step.action as "extend" | "add" | "replace" | undefined,
        transforms: transformerConfigs,
      },
    };
  }

  // Generator syntax with _or_, pick, count
  const orOptions = aug._or_?.map((t: string | Nirs4allClassStep) => {
    if (typeof t === "string") {
      const { name } = resolveClassPath(t);
      return { id: generateStepId(), name, classPath: t, params: {}, enabled: true };
    }
    const { name } = resolveClassPath(t.class);
    return { id: generateStepId(), name, classPath: t.class, params: t.params || {}, enabled: true };
  }) || [];

  // Convert _or_ options to children
  const childSteps = aug._or_?.map((t: string | Nirs4allClassStep) =>
    convertStepToEditor(t as Nirs4allStep)
  ) || [];

  return {
    id: generateStepId(),
    type: "feature_augmentation",
    name: "FeatureAugmentation",
    params: {
      action: step.action || "extend",
      pick: aug.pick !== undefined ? (Array.isArray(aug.pick) ? JSON.stringify(aug.pick) : aug.pick) : "",
      count: aug.count || 0,
    },
    children: childSteps,
    branches: aug._or_?.map((t: string | Nirs4allClassStep) => [convertStepToEditor(t as Nirs4allStep)]) || [],
    generatorKind: "or",
    generatorOptions: {
      pick: aug.pick,
      count: aug.count,
    },
    featureAugmentationConfig: {
      action: step.action as "extend" | "add" | "replace" | undefined,
      orOptions,
      pick: aug.pick,
      count: aug.count,
    },
  };
}

function convertSampleFilterToEditor(step: Nirs4allSampleFilterStep): EditorPipelineStep {
  const filter = step.sample_filter;

  // Convert nested filters to editor format
  const filterConfigs = filter.filters.map(f => {
    if (typeof f === "string") {
      const { name } = resolveClassPath(f);
      return { id: generateStepId(), name, classPath: f, params: {}, enabled: true };
    }
    const { name } = resolveClassPath(f.class);
    return { id: generateStepId(), name, classPath: f.class, params: f.params || {}, enabled: true };
  });

  // Convert filters to children
  const childSteps = filter.filters.map(f => convertStepToEditor(f as Nirs4allStep));

  return {
    id: generateStepId(),
    type: "sample_filter",
    name: "SampleFilter",
    params: {
      mode: filter.mode || "any",
      report: filter.report ?? true,
    },
    children: childSteps,
    branches: [filter.filters.map(f => convertStepToEditor(f as Nirs4allStep))],
    sampleFilterConfig: {
      filters: filterConfigs,
      mode: filter.mode as "any" | "all" | "vote" | undefined,
      report: filter.report,
    },
  };
}

function convertConcatTransformToEditor(step: Nirs4allConcatTransformStep): EditorPipelineStep {
  const branches: EditorPipelineStep[][] = [];
  const branchConfigs: Array<Array<{ id: string; name: string; classPath?: string; params: Record<string, unknown>; enabled?: boolean }>> = [];
  const childSteps: EditorPipelineStep[] = [];

  for (const transform of step.concat_transform) {
    if (Array.isArray(transform)) {
      // Chained transforms
      branches.push(transform.map(t => convertStepToEditor(t)));
      branchConfigs.push(transform.map(t => {
        if (typeof t === "string") {
          const { name } = resolveClassPath(t);
          return { id: generateStepId(), name, classPath: t, params: {}, enabled: true };
        }
        const classStep = t as Nirs4allClassStep;
        const { name } = resolveClassPath(classStep.class);
        return { id: generateStepId(), name, classPath: classStep.class, params: classStep.params || {}, enabled: true };
      }));
      // Add all transforms from this branch to children
      transform.forEach(t => childSteps.push(convertStepToEditor(t)));
    } else {
      // Single transform
      branches.push([convertStepToEditor(transform)]);
      childSteps.push(convertStepToEditor(transform));
      if (typeof transform === "string") {
        const { name } = resolveClassPath(transform);
        branchConfigs.push([{ id: generateStepId(), name, classPath: transform, params: {}, enabled: true }]);
      } else {
        const classStep = transform as Nirs4allClassStep;
        const { name } = resolveClassPath(classStep.class);
        branchConfigs.push([{ id: generateStepId(), name, classPath: classStep.class, params: classStep.params || {}, enabled: true }]);
      }
    }
  }

  return {
    id: generateStepId(),
    type: "concat_transform",
    name: "ConcatTransform",
    params: {},
    children: childSteps,
    branches,
    concatTransformConfig: {
      branches: branchConfigs,
    },
  };
}

function convertOrGeneratorToEditor(step: Nirs4allGeneratorStep): EditorPipelineStep {
  const alternatives = step._or_ || [];

  return {
    id: generateStepId(),
    type: "generator",
    name: "Choose",
    params: {},
    branches: alternatives.map(alt => [convertStepToEditor(alt)]),
    generatorKind: "or",
    generatorOptions: {
      pick: step.pick,
      arrange: step.arrange,
      then_pick: step.then_pick,
      then_arrange: step.then_arrange,
      count: step.count,
    },
  };
}

// ============================================================================
// Export: Editor Format → nirs4all
// ============================================================================

/**
 * Convert editor steps to nirs4all canonical format.
 */
export function exportToNirs4all(steps: EditorPipelineStep[], options?: {
  name?: string;
  description?: string;
  includeWrapper?: boolean;
}): Nirs4allPipeline | Nirs4allStep[] {
  const nirs4allSteps = steps.map(step => convertEditorStepToNirs4all(step));

  if (options?.includeWrapper) {
    return {
      name: options.name || "pipeline",
      description: options.description || "",
      pipeline: nirs4allSteps,
    };
  }

  return nirs4allSteps;
}

/**
 * Convert a single editor step to nirs4all format.
 */
function convertEditorStepToNirs4all(step: EditorPipelineStep): Nirs4allStep {
  // Use stored classPath if available, otherwise compute
  const classPath = step.classPath || getClassPath(step.type, step.name);

  // Handle raw nirs4all storage (for unknown/complex steps)
  if (step.rawNirs4all) {
    return step.rawNirs4all as Nirs4allStep;
  }

  switch (step.type) {
    case "model":
      return convertEditorModelToNirs4all(step, classPath);

    case "y_processing":
      return convertEditorYProcessingToNirs4all(step, classPath);

    case "branch":
      return convertEditorBranchToNirs4all(step);

    case "merge":
      return convertEditorMergeToNirs4all(step);

    case "generator":
      return convertEditorGeneratorToNirs4all(step);

    case "augmentation":
      return convertEditorAugmentationToNirs4all(step);

    case "sample_augmentation":
      return convertEditorSampleAugmentationToNirs4all(step);

    case "feature_augmentation":
      return convertEditorFeatureAugmentationToNirs4all(step);

    case "sample_filter":
      return convertEditorSampleFilterToNirs4all(step);

    case "concat_transform":
      return convertEditorConcatTransformToNirs4all(step);

    case "chart":
      return convertEditorChartToNirs4all(step);

    case "comment":
      // Skip comments in export or return empty object
      return { _comment: step.params.text as string || "" } as unknown as Nirs4allStep;

    case "filter":
      return convertEditorFilterToNirs4all(step);

    default:
      // Standard preprocessing/splitting step
      return buildClassStep(classPath, step.params);
  }
}

function buildClassStep(classPath: string, params: Record<string, unknown>): Nirs4allStep {
  // Filter out internal/meta params that start with _
  const cleanParams: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params || {})) {
    if (!key.startsWith("_")) {
      cleanParams[key] = value;
    }
  }
  if (Object.keys(cleanParams).length === 0) {
    return classPath;
  }
  return { class: classPath, params: cleanParams };
}

function convertEditorModelToNirs4all(step: EditorPipelineStep, classPath: string): Nirs4allStep {
  // Handle function-based models (like nicon)
  let modelDef: Nirs4allClassStep | { function: string; params?: Record<string, unknown> };

  if (step.functionPath) {
    modelDef = { function: step.functionPath };
    if (step.params && Object.keys(step.params).length > 0) {
      (modelDef as { function: string; params?: Record<string, unknown> }).params = step.params;
    }
  } else {
    modelDef = { class: classPath };
    if (step.params && Object.keys(step.params).length > 0) {
      modelDef.params = step.params;
    }
  }

  const result: Nirs4allModelStep = {
    model: modelDef,
  };

  // Add custom name
  if (step.customName) {
    result.name = step.customName;
  }

  // Add finetuning
  if (step.finetuneConfig?.enabled) {
    const modelParams: Record<string, unknown> = {};
    for (const param of step.finetuneConfig.model_params) {
      if (param.type === "categorical" && param.choices) {
        // Categorical as array
        modelParams[param.name] = param.choices;
      } else {
        // Object format with type, low, high
        const paramConfig: Record<string, unknown> = { type: param.type };
        if (param.low !== undefined) paramConfig.low = param.low;
        if (param.high !== undefined) paramConfig.high = param.high;
        if (param.step !== undefined) paramConfig.step = param.step;
        if (param.type === "log_float") paramConfig.log = true;
        modelParams[param.name] = paramConfig;
      }
    }

    result.finetune_params = {
      n_trials: step.finetuneConfig.n_trials,
      approach: step.finetuneConfig.approach,
      eval_mode: step.finetuneConfig.eval_mode,
      model_params: modelParams,
    };

    // Add sample strategy
    if (step.finetuneConfig.sample) {
      result.finetune_params.sample = step.finetuneConfig.sample;
    }
    if (step.finetuneConfig.verbose !== undefined) {
      result.finetune_params.verbose = step.finetuneConfig.verbose;
    }

    // Add train_params tuning for neural networks
    if (step.finetuneConfig.train_params && step.finetuneConfig.train_params.length > 0) {
      const trainParamsRecord: Record<string, unknown> = {};
      for (const param of step.finetuneConfig.train_params) {
        if (param.type === "categorical" && param.choices) {
          trainParamsRecord[param.name] = param.choices;
        } else {
          const paramConfig: Record<string, unknown> = { type: param.type };
          if (param.low !== undefined) paramConfig.low = param.low;
          if (param.high !== undefined) paramConfig.high = param.high;
          if (param.step !== undefined) paramConfig.step = param.step;
          if (param.type === "log_float") paramConfig.log = true;
          trainParamsRecord[param.name] = paramConfig;
        }
      }
      result.finetune_params.train_params = trainParamsRecord;
    }
  }

  // Add training params (top-level for DL models)
  if (step.trainingConfig) {
    result.train_params = {
      epochs: step.trainingConfig.epochs,
      batch_size: step.trainingConfig.batch_size,
    };
    if (step.trainingConfig.verbose !== undefined) {
      result.train_params.verbose = step.trainingConfig.verbose;
    }
    if (step.trainingConfig.learning_rate !== undefined) {
      result.train_params.learning_rate = step.trainingConfig.learning_rate;
    }
    if (step.trainingConfig.patience !== undefined) {
      result.train_params.patience = step.trainingConfig.patience;
    }
  }

  // Add parameter sweeps
  if (step.paramSweeps) {
    for (const [paramName, sweep] of Object.entries(step.paramSweeps)) {
      if (sweep.type === "range") {
        result._range_ = [sweep.from || 0, sweep.to || 10, sweep.step || 1];
        result.param = paramName;
      } else if (sweep.type === "log_range") {
        result._log_range_ = [sweep.from || 0.001, sweep.to || 100, sweep.count || 10];
        result.param = paramName;
      } else if (sweep.type === "or" || sweep.type === "grid") {
        result._grid_ = result._grid_ || {};
        result._grid_[paramName] = sweep.choices as unknown[];
      }
    }
  }

  return result;
}

function convertEditorYProcessingToNirs4all(step: EditorPipelineStep, classPath: string): Nirs4allStep {
  const yProcessingDef = buildClassStep(classPath, step.params);

  return {
    y_processing: yProcessingDef as string | Nirs4allClassStep,
  };
}

function convertEditorBranchToNirs4all(step: EditorPipelineStep): Nirs4allStep {
  if (!step.branches || step.branches.length === 0) {
    return { branch: {} };
  }

  // Check if we have named branches
  const hasNames = step.branchMetadata?.some(m => m.name);

  if (hasNames) {
    // Named branches
    const namedBranches: Record<string, Nirs4allStep[]> = {};
    for (let i = 0; i < step.branches.length; i++) {
      const branchName = step.branchMetadata?.[i]?.name || `branch_${i}`;
      namedBranches[branchName] = step.branches[i].map(s => convertEditorStepToNirs4all(s));
    }
    return { branch: namedBranches };
  }

  // Indexed branches
  const indexedBranches: Nirs4allStep[][] = step.branches.map(branch =>
    branch.map(s => convertEditorStepToNirs4all(s))
  );

  return { branch: indexedBranches };
}

function convertEditorMergeToNirs4all(step: EditorPipelineStep): Nirs4allStep {
  // Use mergeConfig if available (structured config from import)
  if (step.mergeConfig) {
    const config = step.mergeConfig;

    // Simple mode merge
    if (config.mode && !config.predictions && !config.features) {
      return { merge: config.mode };
    }

    // Complex merge with predictions selection
    const mergeConfig: Record<string, unknown> = {};
    if (config.predictions) {
      mergeConfig.predictions = config.predictions;
    }
    if (config.features) {
      mergeConfig.features = config.features;
    }
    if (config.output_as) {
      mergeConfig.output_as = config.output_as;
    }
    if (config.on_missing) {
      mergeConfig.on_missing = config.on_missing;
    }
    return { merge: mergeConfig as Nirs4allMergeStep["merge"] };
  }

  // Fallback to legacy params
  const params = step.params as Record<string, unknown>;

  // Simple merge type
  if (params.merge_type && !params.predictions) {
    return { merge: params.merge_type as string };
  }

  // Complex merge with predictions selection
  return {
    merge: params as Nirs4allMergeStep["merge"],
  };
}

function convertEditorSampleAugmentationToNirs4all(step: EditorPipelineStep): Nirs4allStep {
  // Prefer children if available (new editable format)
  if (step.children && step.children.length > 0) {
    const transformers = step.children.map(child => convertEditorStepToNirs4all(child)) as Array<string | Nirs4allClassStep>;
    return {
      sample_augmentation: {
        transformers,
        count: (step.params.count as number) || step.sampleAugmentationConfig?.count || 1,
        selection: (step.params.selection as string) || step.sampleAugmentationConfig?.selection || "random",
        random_state: (step.params.random_state as number) ?? step.sampleAugmentationConfig?.random_state ?? 42,
      },
    };
  }

  // Use structured config if available (legacy)
  if (step.sampleAugmentationConfig) {
    const config = step.sampleAugmentationConfig;

    const transformers = config.transformers.map(t => {
      if (t.classPath) {
        if (Object.keys(t.params || {}).length > 0) {
          return { class: t.classPath, params: t.params };
        }
        return t.classPath;
      }
      // Fallback to name-based path
      return t.name;
    });

    return {
      sample_augmentation: {
        transformers,
        count: config.count || 1,
        selection: config.selection || "random",
        random_state: config.random_state ?? 42,
      },
    };
  }

  // Fallback: reconstruct from branches
  if (step.branches?.length) {
    return {
      sample_augmentation: {
        transformers: step.branches[0].map(s => convertEditorStepToNirs4all(s)) as Array<string | Nirs4allClassStep>,
        count: (step.params.count as number) || 1,
        selection: (step.params.selection as string) || "random",
        random_state: (step.params.random_state as number) ?? 42,
      },
    };
  }

  // Empty augmentation
  return {
    sample_augmentation: {
      transformers: [],
      count: 1,
      selection: "random",
    },
  };
}

function convertEditorFeatureAugmentationToNirs4all(step: EditorPipelineStep): Nirs4allStep {
  // Prefer children if available (new editable format)
  if (step.children && step.children.length > 0) {
    // Check if this is generator mode (with _or_) or direct list mode
    const isGeneratorMode = step.generatorKind === "or" || step.featureAugmentationConfig?.orOptions?.length;

    if (isGeneratorMode) {
      const orList = step.children.map(child => convertEditorStepToNirs4all(child));
      const augConfig: Record<string, unknown> = { _or_: orList };
      if (step.generatorOptions?.pick !== undefined) {
        augConfig.pick = step.generatorOptions.pick;
      }
      if (step.generatorOptions?.count !== undefined) {
        augConfig.count = step.generatorOptions.count;
      }
      const result: Record<string, unknown> = { feature_augmentation: augConfig };
      if (step.params.action) {
        result.action = step.params.action;
      }
      return result as Nirs4allStep;
    } else {
      // Direct list mode
      const transformList = step.children.map(child => convertEditorStepToNirs4all(child));
      const result: Record<string, unknown> = { feature_augmentation: transformList };
      if (step.params.action) {
        result.action = step.params.action;
      }
      return result as Nirs4allStep;
    }
  }

  // Use structured config if available (legacy)
  if (step.featureAugmentationConfig) {
    const config = step.featureAugmentationConfig;
    const result: Record<string, unknown> = {};

    // Generator mode with _or_
    if (config.orOptions && config.orOptions.length > 0) {
      const orList = config.orOptions.map(t => {
        if (t.classPath) {
          if (Object.keys(t.params || {}).length > 0) {
            return { class: t.classPath, params: t.params };
          }
          return t.classPath;
        }
        return t.name;
      });

      const augConfig: Record<string, unknown> = { _or_: orList };
      if (config.pick !== undefined) {
        augConfig.pick = config.pick;
      }
      if (config.count !== undefined) {
        augConfig.count = config.count;
      }

      result.feature_augmentation = augConfig;
    } else if (config.transforms && config.transforms.length > 0) {
      // Direct list mode
      const transformList = config.transforms.map(t => {
        if (t.classPath) {
          if (Object.keys(t.params || {}).length > 0) {
            return { class: t.classPath, params: t.params };
          }
          return t.classPath;
        }
        return t.name;
      });
      result.feature_augmentation = transformList;
    } else {
      result.feature_augmentation = [];
    }

    if (config.action) {
      result.action = config.action;
    }

    return result as Nirs4allStep;
  }

  // Fallback: reconstruct from branches/generator
  if (step.generatorKind === "or" && step.branches?.length) {
    const orList = step.branches.map(branch =>
      branch.length === 1 ? convertEditorStepToNirs4all(branch[0]) : branch.map(s => convertEditorStepToNirs4all(s))
    );

    const augConfig: Record<string, unknown> = { _or_: orList };
    if (step.generatorOptions?.pick !== undefined) {
      augConfig.pick = step.generatorOptions.pick;
    }
    if (step.generatorOptions?.count !== undefined) {
      augConfig.count = step.generatorOptions.count;
    }

    const result: Record<string, unknown> = { feature_augmentation: augConfig };
    if (step.params.action) {
      result.action = step.params.action;
    }
    return result as Nirs4allStep;
  }

  if (step.branches?.length) {
    const transformList = step.branches[0].map(s => convertEditorStepToNirs4all(s));
    const result: Record<string, unknown> = { feature_augmentation: transformList };
    if (step.params.action) {
      result.action = step.params.action;
    }
    return result as Nirs4allStep;
  }

  return { feature_augmentation: [] };
}

function convertEditorSampleFilterToNirs4all(step: EditorPipelineStep): Nirs4allStep {
  // Prefer children if available (new editable format)
  if (step.children && step.children.length > 0) {
    const filters = step.children.map(child => convertEditorStepToNirs4all(child)) as Array<string | Nirs4allClassStep>;
    return {
      sample_filter: {
        filters,
        mode: (step.params.mode as string) || step.sampleFilterConfig?.mode || "any",
        report: (step.params.report as boolean) ?? step.sampleFilterConfig?.report ?? true,
      },
    };
  }

  // Use structured config if available (legacy)
  if (step.sampleFilterConfig) {
    const config = step.sampleFilterConfig;

    const filters = config.filters.map(f => {
      if (f.classPath) {
        if (Object.keys(f.params || {}).length > 0) {
          return { class: f.classPath, params: f.params };
        }
        return f.classPath;
      }
      return f.name;
    }) as Array<string | Nirs4allClassStep>;

    return {
      sample_filter: {
        filters,
        mode: config.mode,
        report: config.report,
      },
    };
  }

  // Fallback: reconstruct from branches
  if (step.branches?.length) {
    return {
      sample_filter: {
        filters: step.branches[0].map(s => convertEditorStepToNirs4all(s)) as Array<string | Nirs4allClassStep>,
        mode: (step.params.mode as string) || "any",
        report: (step.params.report as boolean) ?? true,
      },
    };
  }

  return {
    sample_filter: {
      filters: [],
      mode: "any",
    },
  };
}

function convertEditorConcatTransformToNirs4all(step: EditorPipelineStep): Nirs4allStep {
  // Prefer children if available (new editable format)
  if (step.children && step.children.length > 0) {
    // For simple case, export children as individual transforms
    const transforms = step.children.map(child => convertEditorStepToNirs4all(child));
    return { concat_transform: transforms };
  }

  // Use structured config if available (legacy)
  if (step.concatTransformConfig) {
    const config = step.concatTransformConfig;

    const branches = config.branches.map(branch => {
      if (branch.length === 1) {
        // Single transform in branch
        const t = branch[0];
        if (t.classPath) {
          if (Object.keys(t.params || {}).length > 0) {
            return { class: t.classPath, params: t.params };
          }
          return t.classPath;
        }
        return t.name;
      }
      // Multiple transforms in chain
      return branch.map(t => {
        if (t.classPath) {
          if (Object.keys(t.params || {}).length > 0) {
            return { class: t.classPath, params: t.params };
          }
          return t.classPath;
        }
        return t.name;
      });
    });

    return { concat_transform: branches };
  }

  // Fallback: reconstruct from branches
  if (step.branches?.length) {
    const branches = step.branches.map(branch => {
      if (branch.length === 1) {
        return convertEditorStepToNirs4all(branch[0]);
      }
      return branch.map(s => convertEditorStepToNirs4all(s));
    });
    return { concat_transform: branches };
  }

  return { concat_transform: [] };
}

function convertEditorChartToNirs4all(step: EditorPipelineStep): Nirs4allStep {
  // Use structured config if available
  if (step.chartConfig) {
    const config = step.chartConfig;
    const chartKey = config.chartType || "chart_2d";

    const chartParams: Record<string, unknown> = {};
    if (config.include_excluded !== undefined) {
      chartParams.include_excluded = config.include_excluded;
    }
    if (config.highlight_excluded !== undefined) {
      chartParams.highlight_excluded = config.highlight_excluded;
    }
    // Copy any other params
    for (const [key, value] of Object.entries(config)) {
      if (!["chartType", "include_excluded", "highlight_excluded"].includes(key)) {
        chartParams[key] = value;
      }
    }

    if (Object.keys(chartParams).length > 0) {
      return { [chartKey]: chartParams };
    }
    return { [chartKey]: {} };
  }

  // Fallback from params
  const chartType = (step.params.chartType as string) || "chart_2d";
  const params: Record<string, unknown> = { ...step.params };
  delete params.chartType;

  if (Object.keys(params).length > 0) {
    return { [chartType]: params };
  }
  return { [chartType]: {} };
}

function convertEditorGeneratorToNirs4all(step: EditorPipelineStep): Nirs4allStep {
  if (!step.branches || step.branches.length === 0) {
    return { _or_: [] };
  }

  const alternatives = step.branches.map(branch =>
    branch.length === 1
      ? convertEditorStepToNirs4all(branch[0])
      : branch.map(s => convertEditorStepToNirs4all(s))
  );

  const result: Nirs4allGeneratorStep = {
    _or_: alternatives as Nirs4allStep[],
  };

  if (step.generatorOptions?.pick) {
    result.pick = step.generatorOptions.pick;
  }
  if (step.generatorOptions?.arrange) {
    result.arrange = step.generatorOptions.arrange;
  }
  if (step.generatorOptions?.then_pick) {
    result.then_pick = step.generatorOptions.then_pick;
  }
  if (step.generatorOptions?.then_arrange) {
    result.then_arrange = step.generatorOptions.then_arrange;
  }
  if (step.generatorOptions?.count) {
    result.count = step.generatorOptions.count;
  }

  return result;
}

function convertEditorAugmentationToNirs4all(step: EditorPipelineStep): Nirs4allStep {
  if (step.name === "SampleAugmentation" && step.branches?.length) {
    return {
      sample_augmentation: {
        transformers: step.branches[0].map(s => convertEditorStepToNirs4all(s)) as Array<string | Nirs4allClassStep>,
        count: step.params.count as number,
        selection: step.params.selection as string,
        random_state: step.params.random_state as number,
      },
    };
  }

  // Single augmentation transform
  const classPath = getClassPath(step.type, step.name);
  return buildClassStep(classPath, step.params);
}

function convertEditorFilterToNirs4all(step: EditorPipelineStep): Nirs4allStep {
  if (step.name === "SampleFilter" && step.branches?.length) {
    return {
      sample_filter: {
        filters: step.branches[0].map(s => convertEditorStepToNirs4all(s)) as Array<string | Nirs4allClassStep>,
        mode: step.params.mode as string,
        report: step.params.report as boolean,
      },
    };
  }

  // Single filter
  const classPath = getClassPath(step.type, step.name);
  return buildClassStep(classPath, step.params);
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Validate that a pipeline can be round-tripped without loss.
 */
export function validateRoundTrip(original: Nirs4allStep[] | Nirs4allPipeline): {
  valid: boolean;
  stepCountMatch: boolean;
  editorSteps: EditorPipelineStep[];
  exportedSteps: Nirs4allStep[];
  differences: string[];
} {
  const originalSteps = Array.isArray(original) ? original : original.pipeline;
  const editorSteps = importFromNirs4all(originalSteps);
  const exportedSteps = exportToNirs4all(editorSteps) as Nirs4allStep[];

  const differences: string[] = [];
  const stepCountMatch = originalSteps.length === exportedSteps.length;

  if (!stepCountMatch) {
    differences.push(`Step count mismatch: ${originalSteps.length} vs ${exportedSteps.length}`);
  }

  return {
    valid: differences.length === 0,
    stepCountMatch,
    editorSteps,
    exportedSteps,
    differences,
  };
}

/**
 * Load a pipeline from JSON or YAML string.
 */
export function parsePipelineString(content: string): Nirs4allPipeline {
  // Try JSON first
  try {
    return JSON.parse(content);
  } catch {
    // Not JSON - would need YAML parser
    throw new Error("Only JSON format is supported in the browser. Use the backend for YAML.");
  }
}

/**
 * Serialize a pipeline to JSON string.
 */
export function serializePipeline(
  pipeline: Nirs4allPipeline | Nirs4allStep[],
  indent = 2
): string {
  return JSON.stringify(pipeline, null, indent);
}
