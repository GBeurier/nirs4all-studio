/**
 * useShapePropagation - Hook for calculating data shape through pipeline
 *
 * Phase 4 Implementation: Pipeline Integration
 * @see docs/ROADMAP_DATASETS_WORKSPACE.md
 *
 * Features:
 * - T4.5: Shape propagation calculator
 * - T4.6: Display shape changes in pipeline tree
 * - T4.7: Warn when step params exceed data dimensions
 *
 * This hook calculates how data shape changes as it flows through the
 * pipeline, enabling dimension-aware validation and visualization.
 */

import { useMemo, useCallback } from "react";
import type { PipelineStep } from "../components/pipeline-editor/types";
import type { DataShape, BoundDataset } from "../components/pipeline-editor/DatasetBinding";

/**
 * Shape at a specific point in the pipeline
 */
export interface ShapeAtStep {
  stepId: string;
  inputShape: DataShape;
  outputShape: DataShape;
  warnings: ShapeWarning[];
}

/**
 * Warning about a dimension issue
 */
export interface ShapeWarning {
  type: "param_exceeds_dimension" | "shape_mismatch" | "unknown_transform";
  stepId: string;
  stepName: string;
  message: string;
  paramName?: string;
  paramValue?: number;
  maxValue?: number;
  severity: "warning" | "error";
}

/**
 * Shape propagation result
 */
export interface ShapePropagationResult {
  /** Shape at each step (keyed by step ID) */
  shapes: Map<string, ShapeAtStep>;
  /** All warnings across the pipeline */
  warnings: ShapeWarning[];
  /** Final output shape */
  outputShape: DataShape;
  /** Whether propagation was successful */
  isValid: boolean;
}

/**
 * Operator shape effects - how different operators affect data shape
 *
 * This maps operator names to functions that calculate output shape
 * given input shape and parameters.
 */
type ShapeTransform = (
  input: DataShape,
  params: Record<string, unknown>
) => DataShape;

const SHAPE_TRANSFORMS: Record<string, ShapeTransform> = {
  // Preprocessing that preserves shape
  StandardNormalVariate: (input) => input,
  SNV: (input) => input,
  MultiplicativeScatterCorrection: (input) => input,
  MSC: (input) => input,
  StandardScaler: (input) => input,
  MinMaxScaler: (input) => input,
  RobustScaler: (input) => input,
  Normalize: (input) => input,
  LogTransform: (input) => input,
  Detrend: (input) => input,
  Baseline: (input) => input,
  ASLSBaseline: (input) => input,
  AirPLS: (input) => input,
  ArPLS: (input) => input,
  SNIP: (input) => input,
  ReflectanceToAbsorbance: (input) => input,
  ToAbsorbance: (input) => input,
  FromAbsorbance: (input) => input,

  // Gaussian smoothing - preserves shape
  Gaussian: (input) => input,

  // Savitzky-Golay - may reduce features at edges depending on mode
  SavitzkyGolay: (input, params) => {
    const windowLength = (params.window_length as number) || 11;
    const mode = params.mode as string || "interp";
    // In default mode, shape is preserved. In 'valid' mode, features reduce
    if (mode === "valid") {
      return {
        ...input,
        features: Math.max(1, input.features - windowLength + 1),
      };
    }
    return input;
  },

  // Derivatives - typically preserve shape (with padding)
  FirstDerivative: (input, params) => {
    const windowLength = (params.window_length as number) || 11;
    const mode = params.mode as string || "interp";
    if (mode === "valid") {
      return {
        ...input,
        features: Math.max(1, input.features - windowLength + 1),
      };
    }
    return input;
  },
  SecondDerivative: (input, params) => {
    const windowLength = (params.window_length as number) || 11;
    const mode = params.mode as string || "interp";
    if (mode === "valid") {
      return {
        ...input,
        features: Math.max(1, input.features - windowLength + 1),
      };
    }
    return input;
  },

  // Wavelets - can change feature count
  Wavelet: (input, params) => {
    const level = (params.level as number) || 1;
    // Wavelet decomposition roughly halves features per level for approximation
    // This is a simplification - actual depends on wavelet type
    return {
      ...input,
      features: Math.ceil(input.features / Math.pow(2, level)),
    };
  },
  Haar: (input, params) => {
    const level = (params.level as number) || 1;
    return {
      ...input,
      features: Math.ceil(input.features / Math.pow(2, level)),
    };
  },

  // Cropping - reduces features
  CropTransformer: (input, params) => {
    const start = (params.start as number) || 0;
    const end = (params.end as number) || input.features;
    return {
      ...input,
      features: Math.max(1, end - start),
    };
  },

  // Resampling - changes features to target count
  ResampleTransformer: (input, params) => {
    const targetFeatures = (params.n_features as number) || (params.target_points as number);
    return {
      ...input,
      features: targetFeatures || input.features,
    };
  },
  Resampler: (input, params) => {
    const targetFeatures = (params.n_features as number) || (params.target_points as number);
    return {
      ...input,
      features: targetFeatures || input.features,
    };
  },

  // PLS models - reduce to n_components
  PLSRegression: (input, params) => {
    const nComponents = (params.n_components as number) || 10;
    return {
      ...input,
      features: Math.min(nComponents, input.features, input.samples),
    };
  },
  IKPLS: (input, params) => {
    const nComponents = (params.n_components as number) || 10;
    return {
      ...input,
      features: Math.min(nComponents, input.features, input.samples),
    };
  },
  OPLS: (input, params) => {
    const nComponents = (params.n_components as number) || 10;
    return {
      ...input,
      features: Math.min(nComponents, input.features, input.samples),
    };
  },
  LWPLS: (input, params) => {
    const nComponents = (params.n_components as number) || 10;
    return {
      ...input,
      features: Math.min(nComponents, input.features, input.samples),
    };
  },

  // PCA - reduce to n_components
  PCA: (input, params) => {
    const nComponents = (params.n_components as number) || input.features;
    return {
      ...input,
      features: Math.min(nComponents, input.features, input.samples),
    };
  },

  // Splitters - may change sample count (for test split)
  KFold: (input) => input, // Doesn't change overall shape
  StratifiedKFold: (input) => input,
  ShuffleSplit: (input) => input,
  KennardStoneSplitter: (input) => input,
  SPXYSplitter: (input) => input,
  SPXYGFold: (input) => input,

  // Feature selection - reduces features based on selection
  VIP: (input, params) => {
    // VIP typically keeps features above threshold, estimate 50% reduction
    const threshold = (params.threshold as number) || 1.0;
    // This is an estimate - actual depends on data
    const estimatedKeep = threshold > 1 ? 0.3 : threshold > 0.5 ? 0.5 : 0.7;
    return {
      ...input,
      features: Math.max(1, Math.floor(input.features * estimatedKeep)),
    };
  },
  CARS: (input, params) => {
    const nComponents = (params.n_components as number) || 10;
    // CARS selects features, output is typically much smaller
    return {
      ...input,
      features: Math.min(nComponents * 5, input.features), // Rough estimate
    };
  },
};

/**
 * Parameters that represent dimensions and should be checked
 */
const DIMENSION_PARAMS: Record<string, { maxSource: "features" | "samples" }> = {
  n_components: { maxSource: "features" },
  n_splits: { maxSource: "samples" },
  window_length: { maxSource: "features" },
  start: { maxSource: "features" },
  end: { maxSource: "features" },
  n_features: { maxSource: "features" },
  target_points: { maxSource: "features" },
  n_estimators: { maxSource: "samples" }, // Not strictly a dimension, but useful
  max_depth: { maxSource: "samples" },
};

/**
 * Calculate output shape for a step
 */
function calculateStepShape(
  step: PipelineStep,
  inputShape: DataShape
): { outputShape: DataShape; warnings: ShapeWarning[] } {
  const warnings: ShapeWarning[] = [];
  const transform = SHAPE_TRANSFORMS[step.name];

  // Check dimension parameters
  const params = step.params || {};
  for (const [paramName, config] of Object.entries(DIMENSION_PARAMS)) {
    const paramValue = params[paramName] as number | undefined;
    if (paramValue !== undefined && typeof paramValue === "number") {
      const maxValue = inputShape[config.maxSource];
      if (paramValue > maxValue) {
        warnings.push({
          type: "param_exceeds_dimension",
          stepId: step.id,
          stepName: step.name,
          message: `Parameter '${paramName}' (${paramValue}) exceeds ${config.maxSource} (${maxValue})`,
          paramName,
          paramValue,
          maxValue,
          severity: paramName === "n_components" ? "error" : "warning",
        });
      }
    }
  }

  // Calculate output shape
  let outputShape: DataShape;
  if (transform) {
    outputShape = transform(inputShape, params);
  } else {
    // Unknown transform - assume shape preserved, add warning
    outputShape = { ...inputShape };
    if (step.type === "preprocessing" || step.type === "model") {
      warnings.push({
        type: "unknown_transform",
        stepId: step.id,
        stepName: step.name,
        message: `Unknown operator '${step.name}' - shape change cannot be predicted`,
        severity: "warning",
      });
    }
  }

  return { outputShape, warnings };
}

/**
 * Propagate shapes through a list of steps
 */
function propagateShapes(
  steps: PipelineStep[],
  initialShape: DataShape
): ShapePropagationResult {
  const shapes = new Map<string, ShapeAtStep>();
  const allWarnings: ShapeWarning[] = [];
  let currentShape = initialShape;
  let isValid = true;

  for (const step of steps) {
    const inputShape = { ...currentShape };
    const { outputShape, warnings } = calculateStepShape(step, inputShape);

    shapes.set(step.id, {
      stepId: step.id,
      inputShape,
      outputShape,
      warnings,
    });

    allWarnings.push(...warnings);

    // Check for errors
    if (warnings.some((w) => w.severity === "error")) {
      isValid = false;
    }

    currentShape = outputShape;

    // Handle branches - propagate through each branch
    if (step.branches && step.branches.length > 0) {
      for (const branch of step.branches) {
        const branchResult = propagateShapes(branch, inputShape);
        // Merge branch shapes into main shapes
        branchResult.shapes.forEach((v, k) => shapes.set(k, v));
        allWarnings.push(...branchResult.warnings);
        if (!branchResult.isValid) {
          isValid = false;
        }
      }
    }

    // Handle children (for container steps)
    if (step.children && step.children.length > 0) {
      const childResult = propagateShapes(step.children, inputShape);
      childResult.shapes.forEach((v, k) => shapes.set(k, v));
      allWarnings.push(...childResult.warnings);
      if (!childResult.isValid) {
        isValid = false;
      }
    }
  }

  return {
    shapes,
    warnings: allWarnings,
    outputShape: currentShape,
    isValid,
  };
}

/**
 * Hook options
 */
export interface UseShapePropagationOptions {
  /** Pipeline steps */
  steps: PipelineStep[];
  /** Bound dataset (null if none) */
  boundDataset: BoundDataset | null;
}

/**
 * Hook to calculate shape propagation through a pipeline
 */
export function useShapePropagation({
  steps,
  boundDataset,
}: UseShapePropagationOptions): ShapePropagationResult | null {
  return useMemo(() => {
    if (!boundDataset) {
      return null;
    }

    return propagateShapes(steps, boundDataset.shape);
  }, [steps, boundDataset]);
}

/**
 * Get shape at a specific step
 */
export function useShapeAtStep(
  stepId: string,
  propagation: ShapePropagationResult | null
): ShapeAtStep | null {
  return useMemo(() => {
    if (!propagation) return null;
    return propagation.shapes.get(stepId) || null;
  }, [propagation, stepId]);
}

/**
 * Get warnings for a specific step
 */
export function useStepWarnings(
  stepId: string,
  propagation: ShapePropagationResult | null
): ShapeWarning[] {
  return useMemo(() => {
    if (!propagation) return [];
    const shapeAtStep = propagation.shapes.get(stepId);
    return shapeAtStep?.warnings || [];
  }, [propagation, stepId]);
}

/**
 * Check if a parameter value is valid for current shape
 */
export function validateDimensionParam(
  paramName: string,
  paramValue: number,
  shape: DataShape
): { isValid: boolean; maxValue: number } | null {
  const config = DIMENSION_PARAMS[paramName];
  if (!config) return null;

  const maxValue = shape[config.maxSource];
  return {
    isValid: paramValue <= maxValue,
    maxValue,
  };
}
