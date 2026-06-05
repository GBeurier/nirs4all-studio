/**
 * Pipeline Converter — Shared Types and Helpers
 * =============================================
 *
 * Type definitions, class-path mappings, and small helpers shared by the
 * import (nirs4all → editor) and export (editor → nirs4all) converters.
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

import type { StepType } from "@/components/pipeline-editor/types";

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
    variation_scope?: string;
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
export function getClassNameFromPath(classPath: string): string {
  const parts = classPath.split(".");
  return parts[parts.length - 1];
}

/**
 * Get step type and display name from a class path.
 */
export function resolveClassPath(classPath: string): { name: string; type: StepType } {
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
export function getClassPath(type: StepType, name: string): string {
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
export type EditorParams = Record<string, string | number | boolean>;

export function castParams(params: Record<string, unknown> | undefined): EditorParams {
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
