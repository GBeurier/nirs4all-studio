/**
 * Native Pipeline Format Converter
 * =================================
 *
 * Converts between the pipeline editor's internal format (EditorPipelineStep[])
 * and the nirs4all-native JSON format that maps directly to nirs4all.run(pipeline=[...]).
 *
 * The native format uses:
 * - Plain class name strings for parameterless operators: "StandardNormalVariate"
 * - {ClassName: {params}} for operators with params: {"SavitzkyGolay": {"window_length": 11}}
 * - Keyword wrappers: {"model": ...}, {"y_processing": ...}, {"branch": ...}, etc.
 * - Generator syntax: {"_or_": [...]}, {"_range_": [...]}, {"_cartesian_": [...]}
 *
 * This is distinct from the existing pipelineConverter.ts which uses full class paths
 * (e.g., "sklearn.preprocessing._data.MinMaxScaler"). The native format uses
 * short display names that nirs4all resolves at runtime via its controller registry.
 */

import type {
  PipelineStep as EditorPipelineStep,
  StepType,
} from "@/components/pipeline-editor/types";
import { generateStepId } from "@/components/pipeline-editor/types";

// ============================================================================
// Native Format Types
// ============================================================================

/** A single step in nirs4all-native format. */
export type NativePipelineStep =
  | string
  | Record<string, unknown>;

/** Full pipeline document with version wrapper. */
export interface NativePipelineDocument {
  version: "1.0";
  name?: string;
  description?: string;
  random_state?: number;
  steps: NativePipelineStep[];
}

// ============================================================================
// Parameter Normalization
// ============================================================================

/**
 * Recombine _min/_max suffix pairs into tuple parameters.
 * E.g., feature_range_min: 0, feature_range_max: 1 -> feature_range: [0, 1]
 * Also remove params that match defaults (empty objects after cleanup).
 */
function normalizeParams(
  params: Record<string, string | number | boolean> | undefined
): Record<string, unknown> | null {
  if (!params || Object.keys(params).length === 0) return null;

  const result: Record<string, unknown> = {};
  const processed = new Set<string>();

  // First pass: find _min/_max pairs
  const keys = Object.keys(params);
  for (const key of keys) {
    if (key.endsWith("_min")) {
      const base = key.slice(0, -4);
      const maxKey = base + "_max";
      if (maxKey in params) {
        const minVal = params[key];
        const maxVal = params[maxKey];
        if (minVal !== undefined && maxVal !== undefined) {
          result[base] = [minVal, maxVal];
        }
        processed.add(key);
        processed.add(maxKey);
      }
    }
  }

  // Second pass: copy remaining params
  for (const [key, value] of Object.entries(params)) {
    if (!processed.has(key)) {
      // Skip internal editor params
      if (key.startsWith("_")) continue;
      result[key] = value;
    }
  }

  return Object.keys(result).length > 0 ? result : null;
}

/**
 * Build a native operator reference: either a plain string or {Name: {params}}.
 */
function buildOperatorRef(name: string, params: Record<string, unknown> | null): NativePipelineStep {
  if (!params) return name;
  return { [name]: params };
}

// ============================================================================
// Editor -> Native Format
// ============================================================================

/**
 * Convert editor pipeline steps to nirs4all-native format.
 *
 * This produces the format that can be passed directly to nirs4all.run(pipeline=[...])
 * or saved as a JSON/YAML pipeline definition file.
 */
export function toNativeFormat(steps: EditorPipelineStep[]): NativePipelineStep[] {
  return steps
    .filter((step) => step.enabled !== false)
    .map((step) => convertStepToNative(step))
    .filter((step): step is NativePipelineStep => step !== null);
}

/**
 * Convert a single editor step to native format.
 */
function convertStepToNative(step: EditorPipelineStep): NativePipelineStep | null {
  // Handle raw nirs4all passthrough
  if (step.rawNirs4all) {
    return step.rawNirs4all as NativePipelineStep;
  }

  // Dispatch by type and subType
  if (step.type === "flow" && step.subType) {
    return convertFlowStepToNative(step);
  }

  if (step.type === "utility" && step.subType) {
    return convertUtilityStepToNative(step);
  }

  switch (step.type) {
    case "model":
      return convertModelToNative(step);
    case "y_processing":
      return convertYProcessingToNative(step);
    case "preprocessing":
    case "splitting":
      return convertSimpleStepToNative(step);
    case "augmentation":
      return convertAugmentationToNative(step);
    case "filter":
      return convertFilterToNative(step);
    default:
      return convertSimpleStepToNative(step);
  }
}

/**
 * Convert a simple preprocessing/splitting step.
 * Produces: "ClassName" or {"ClassName": {params}}
 */
function convertSimpleStepToNative(step: EditorPipelineStep): NativePipelineStep {
  const params = normalizeParams(step.params);

  // Handle step-level generator (e.g., _range_ on n_components)
  if (step.stepGenerator) {
    return buildStepGenerator(step);
  }

  // Handle parameter sweeps
  if (step.paramSweeps && Object.keys(step.paramSweeps).length > 0) {
    return buildParamSweepStep(step, params);
  }

  return buildOperatorRef(step.name, params);
}

/**
 * Convert a model step.
 * Produces: {"model": "ClassName"} or {"model": {"ClassName": {params}}}
 */
function convertModelToNative(step: EditorPipelineStep): NativePipelineStep {
  const params = normalizeParams(step.params);
  const modelRef = buildOperatorRef(step.name, params);

  const result: Record<string, unknown> = { model: modelRef };

  // Add custom name
  if (step.customName || step.stepMetadata?.customName) {
    result.name = step.customName || step.stepMetadata?.customName;
  }

  // Add training params for DL models
  if (step.trainingConfig) {
    const trainParams: Record<string, unknown> = {};
    if (step.trainingConfig.epochs) trainParams.epochs = step.trainingConfig.epochs;
    if (step.trainingConfig.batch_size) trainParams.batch_size = step.trainingConfig.batch_size;
    if (step.trainingConfig.learning_rate) trainParams.learning_rate = step.trainingConfig.learning_rate;
    if (step.trainingConfig.patience) trainParams.patience = step.trainingConfig.patience;
    if (step.trainingConfig.optimizer) trainParams.optimizer = step.trainingConfig.optimizer;
    if (step.trainingConfig.verbose !== undefined) trainParams.verbose = step.trainingConfig.verbose;
    if (Object.keys(trainParams).length > 0) {
      result.train_params = trainParams;
    }
  } else if (step.stepMetadata?.trainParams) {
    result.train_params = step.stepMetadata.trainParams;
  }

  // Add finetuning
  if (step.finetuneConfig?.enabled) {
    result.finetune_params = buildFinetuneParams(step.finetuneConfig);
  }

  // Add parameter sweeps at model level
  if (step.paramSweeps) {
    for (const [paramName, sweep] of Object.entries(step.paramSweeps)) {
      if (sweep.type === "range" && sweep.from !== undefined && sweep.to !== undefined) {
        result._range_ = [sweep.from, sweep.to, sweep.step ?? 1];
        result.param = paramName;
      } else if (sweep.type === "log_range" && sweep.from !== undefined && sweep.to !== undefined) {
        result._log_range_ = [sweep.from, sweep.to, sweep.count ?? 5];
        result.param = paramName;
      } else if ((sweep.type === "or" || sweep.type === "grid") && sweep.choices) {
        if (!result._grid_) result._grid_ = {};
        (result._grid_ as Record<string, unknown>)[paramName] = sweep.choices;
      }
    }
  }

  // If result only has "model" key, return minimal form
  if (Object.keys(result).length === 1) {
    return result;
  }

  return result;
}

/**
 * Convert a y_processing step.
 * Produces: {"y_processing": "ClassName"} or {"y_processing": {"ClassName": {params}}}
 */
function convertYProcessingToNative(step: EditorPipelineStep): NativePipelineStep {
  const params = normalizeParams(step.params);
  return { y_processing: buildOperatorRef(step.name, params) };
}

/**
 * Convert flow steps (branch, merge, sample_augmentation, etc.)
 */
function convertFlowStepToNative(step: EditorPipelineStep): NativePipelineStep | null {
  switch (step.subType) {
    case "branch":
      return convertBranchToNative(step);
    case "merge":
      return convertMergeToNative(step);
    case "sample_augmentation":
      return convertSampleAugmentationToNative(step);
    case "feature_augmentation":
      return convertFeatureAugmentationToNative(step);
    case "sample_filter":
      return convertSampleFilterToNative(step);
    case "concat_transform":
      return convertConcatTransformToNative(step);
    case "sequential":
      // Sequential containers inline their children
      if (step.children?.length) {
        // Return children as an inlined array (will be flattened into parent)
        return toNativeFormat(step.children) as unknown as NativePipelineStep;
      }
      return null;
    default:
      return convertSimpleStepToNative(step);
  }
}

/**
 * Convert utility steps (generators, charts, comments)
 */
function convertUtilityStepToNative(step: EditorPipelineStep): NativePipelineStep | null {
  switch (step.subType) {
    case "generator":
      return convertGeneratorToNative(step);
    case "chart":
      return convertChartToNative(step);
    case "comment":
      // Comments are not part of the native pipeline
      return null;
    default:
      return null;
  }
}

/**
 * Convert a branch step.
 * Produces: {"branch": [[...], [...]]}
 */
function convertBranchToNative(step: EditorPipelineStep): NativePipelineStep {
  if (!step.branches || step.branches.length === 0) {
    return { branch: [] };
  }

  // Check for named branches
  const hasNames = step.branchMetadata?.some((m) => m.name);
  if (hasNames) {
    const namedBranches: Record<string, NativePipelineStep[]> = {};
    for (let i = 0; i < step.branches.length; i++) {
      const branchName = step.branchMetadata?.[i]?.name || `branch_${i}`;
      namedBranches[branchName] = toNativeFormat(step.branches[i]);
    }
    return { branch: namedBranches };
  }

  return {
    branch: step.branches.map((branch) => toNativeFormat(branch)),
  };
}

/**
 * Convert a merge step.
 * Produces: {"merge": "predictions"} or {"merge": {...}}
 */
function convertMergeToNative(step: EditorPipelineStep): NativePipelineStep {
  if (step.mergeConfig) {
    const config = step.mergeConfig;
    if (config.mode && !config.predictions && !config.features) {
      return { merge: config.mode };
    }
    const mergeConfig: Record<string, unknown> = {};
    if (config.predictions) mergeConfig.predictions = config.predictions;
    if (config.features) mergeConfig.features = config.features;
    if (config.output_as) mergeConfig.output_as = config.output_as;
    if (config.on_missing) mergeConfig.on_missing = config.on_missing;
    return { merge: mergeConfig };
  }

  // Fallback to params
  const mergeType = step.params?.merge_type || "predictions";
  return { merge: mergeType };
}

/**
 * Convert a sample_augmentation step.
 * Produces: {"sample_augmentation": {"transformers": [...], "count": N}}
 */
function convertSampleAugmentationToNative(step: EditorPipelineStep): NativePipelineStep {
  // Prefer children (editable format)
  const transformers = step.children?.length
    ? step.children.map((child) => convertStepToNative(child)).filter(Boolean) as NativePipelineStep[]
    : step.sampleAugmentationConfig?.transformers?.map((t) => {
        const p = normalizeParams(t.params as Record<string, string | number | boolean>);
        return buildOperatorRef(t.name, p);
      }) || [];

  const config: Record<string, unknown> = { transformers };

  const count = step.params?.count || step.sampleAugmentationConfig?.count;
  if (count && count !== 1) config.count = count;

  const selection = step.params?.selection || step.sampleAugmentationConfig?.selection;
  if (selection && selection !== "random") config.selection = selection;

  const variationScope = step.params?.variation_scope || step.sampleAugmentationConfig?.variation_scope;
  if (variationScope && variationScope !== "sample") config.variation_scope = variationScope;

  const randomState = step.params?.random_state ?? step.sampleAugmentationConfig?.random_state;
  if (randomState !== undefined && randomState !== null) config.random_state = randomState;

  return { sample_augmentation: config };
}

/**
 * Convert a feature_augmentation step.
 */
function convertFeatureAugmentationToNative(step: EditorPipelineStep): NativePipelineStep {
  const isGeneratorMode = step.generatorKind === "or" || step.featureAugmentationConfig?.orOptions?.length;

  if (step.children?.length) {
    if (isGeneratorMode) {
      const orList = step.children.map((child) => convertStepToNative(child)).filter(Boolean);
      const augConfig: Record<string, unknown> = { _or_: orList };
      if (step.generatorOptions?.pick !== undefined) augConfig.pick = step.generatorOptions.pick;
      if (step.generatorOptions?.count !== undefined) augConfig.count = step.generatorOptions.count;
      const result: Record<string, unknown> = { feature_augmentation: augConfig };
      if (step.params?.action) result.action = step.params.action;
      return result;
    }

    const transformList = step.children.map((child) => convertStepToNative(child)).filter(Boolean);
    const result: Record<string, unknown> = { feature_augmentation: transformList };
    if (step.params?.action) result.action = step.params.action;
    return result;
  }

  return { feature_augmentation: [] };
}

/**
 * Convert a sample_filter step.
 * Produces: {"exclude": [...]} or {"tag": [...]}
 */
function convertSampleFilterToNative(step: EditorPipelineStep): NativePipelineStep {
  const filters = step.children?.length
    ? step.children.map((child) => convertStepToNative(child)).filter(Boolean) as NativePipelineStep[]
    : step.sampleFilterConfig?.filters?.map((f) => {
        const p = normalizeParams(f.params as Record<string, string | number | boolean>);
        return buildOperatorRef(f.name, p);
      }) || [];

  const mode = step.params?.mode || step.sampleFilterConfig?.mode || "any";

  // In nirs4all, sample_filter maps to "exclude" keyword by default
  const result: Record<string, unknown> = { exclude: filters.length === 1 ? filters[0] : filters };
  if (mode !== "any") result.mode = mode;

  return result;
}

/**
 * Convert a concat_transform step.
 */
function convertConcatTransformToNative(step: EditorPipelineStep): NativePipelineStep {
  if (step.children?.length) {
    return { concat_transform: step.children.map((child) => convertStepToNative(child)).filter(Boolean) };
  }
  if (step.branches?.length) {
    return {
      concat_transform: step.branches.map((branch) =>
        branch.length === 1 ? convertStepToNative(branch[0]) : toNativeFormat(branch)
      ),
    };
  }
  return { concat_transform: [] };
}

/**
 * Convert a generator step (_or_, _cartesian_).
 */
function convertGeneratorToNative(step: EditorPipelineStep): NativePipelineStep {
  if (step.generatorKind === "cartesian" && step.branches?.length) {
    // Cartesian: each branch is a "stage" with alternatives
    const stages = step.branches.map((stage) =>
      stage.map((s) => convertStepToNative(s)).filter(Boolean)
    );
    const result: Record<string, unknown> = { _cartesian_: stages };
    if (step.generatorOptions?.pick) result.pick = step.generatorOptions.pick;
    if (step.generatorOptions?.arrange) result.arrange = step.generatorOptions.arrange;
    if (step.generatorOptions?.count) result.count = step.generatorOptions.count;
    return result;
  }

  // Default: _or_ generator
  if (!step.branches || step.branches.length === 0) {
    return { _or_: [] };
  }

  const alternatives = step.branches.map((branch) =>
    branch.length === 1 ? convertStepToNative(branch[0]) : toNativeFormat(branch)
  );

  const result: Record<string, unknown> = { _or_: alternatives };
  if (step.generatorOptions?.pick) result.pick = step.generatorOptions.pick;
  if (step.generatorOptions?.arrange) result.arrange = step.generatorOptions.arrange;
  if (step.generatorOptions?.then_pick) result.then_pick = step.generatorOptions.then_pick;
  if (step.generatorOptions?.then_arrange) result.then_arrange = step.generatorOptions.then_arrange;
  if (step.generatorOptions?.count) result.count = step.generatorOptions.count;

  return result;
}

/**
 * Convert a chart step.
 */
function convertChartToNative(step: EditorPipelineStep): NativePipelineStep {
  const chartType = step.chartConfig?.chartType || step.name || "chart_2d";
  const params: Record<string, unknown> = {};

  if (step.chartConfig) {
    for (const [key, value] of Object.entries(step.chartConfig)) {
      if (key !== "chartType") params[key] = value;
    }
  }

  return { [chartType]: Object.keys(params).length > 0 ? params : {} };
}

/**
 * Convert a standalone augmentation operator (used inside containers).
 */
function convertAugmentationToNative(step: EditorPipelineStep): NativePipelineStep {
  const params = normalizeParams(step.params);
  return buildOperatorRef(step.name, params);
}

/**
 * Convert a standalone filter operator.
 */
function convertFilterToNative(step: EditorPipelineStep): NativePipelineStep {
  const params = normalizeParams(step.params);
  return buildOperatorRef(step.name, params);
}

/**
 * Build a step-level generator (stepGenerator field).
 */
function buildStepGenerator(step: EditorPipelineStep): NativePipelineStep {
  const gen = step.stepGenerator!;
  const result: Record<string, unknown> = {};

  if (gen.type === "_range_" && Array.isArray(gen.values)) {
    result._range_ = gen.values;
    if (gen.param) result.param = gen.param;
  } else if (gen.type === "_log_range_" && Array.isArray(gen.values)) {
    result._log_range_ = gen.values;
    if (gen.param) result.param = gen.param;
  } else if (gen.type === "_or_" && Array.isArray(gen.values)) {
    result._or_ = gen.values;
    if (gen.param) result.param = gen.param;
  } else if (gen.type === "_grid_") {
    result._grid_ = gen.values;
  }

  if (gen.pick) result.pick = gen.pick;
  if (gen.count) result.count = gen.count;

  return result;
}

/**
 * Build param sweep into native generator format.
 */
function buildParamSweepStep(
  step: EditorPipelineStep,
  baseParams: Record<string, unknown> | null
): NativePipelineStep {
  // For parameter sweeps, the step itself becomes a generator
  // with the param name attached
  const sweepEntries = Object.entries(step.paramSweeps || {});
  if (sweepEntries.length === 0) {
    return buildOperatorRef(step.name, baseParams);
  }

  // Simple case: single parameter sweep
  const [paramName, sweep] = sweepEntries[0];

  if (sweep.type === "range" && sweep.from !== undefined && sweep.to !== undefined) {
    return { _range_: [sweep.from, sweep.to, sweep.step ?? 1], param: paramName };
  }
  if (sweep.type === "log_range" && sweep.from !== undefined && sweep.to !== undefined) {
    return { _log_range_: [sweep.from, sweep.to, sweep.count ?? 5], param: paramName };
  }
  if ((sweep.type === "or" || sweep.type === "grid") && sweep.choices) {
    return { _or_: sweep.choices, param: paramName };
  }

  return buildOperatorRef(step.name, baseParams);
}

/**
 * Build finetuning params from editor config.
 */
function buildFinetuneParams(config: NonNullable<EditorPipelineStep["finetuneConfig"]>): Record<string, unknown> {
  const result: Record<string, unknown> = {
    n_trials: config.n_trials,
  };

  if (config.approach) result.approach = config.approach;
  if (config.eval_mode) result.eval_mode = config.eval_mode;
  if (config.timeout) result.timeout = config.timeout;
  if (config.sample) result.sample = config.sample;
  if (config.verbose !== undefined) result.verbose = config.verbose;

  // Convert model_params
  if (config.model_params?.length) {
    const modelParams: Record<string, unknown> = {};
    for (const param of config.model_params) {
      if (param.type === "categorical" && param.choices) {
        modelParams[param.name] = param.choices;
      } else {
        const paramConfig: Record<string, unknown> = { type: param.type };
        if (param.low !== undefined) paramConfig.low = param.low;
        if (param.high !== undefined) paramConfig.high = param.high;
        if (param.step !== undefined) paramConfig.step = param.step;
        if (param.type === "log_float") paramConfig.log = true;
        modelParams[param.name] = paramConfig;
      }
    }
    result.model_params = modelParams;
  }

  // Convert train_params
  if (config.train_params?.length) {
    const trainParams: Record<string, unknown> = {};
    for (const param of config.train_params) {
      if (param.type === "categorical" && param.choices) {
        trainParams[param.name] = param.choices;
      } else {
        const paramConfig: Record<string, unknown> = { type: param.type };
        if (param.low !== undefined) paramConfig.low = param.low;
        if (param.high !== undefined) paramConfig.high = param.high;
        if (param.step !== undefined) paramConfig.step = param.step;
        if (param.type === "log_float") paramConfig.log = true;
        trainParams[param.name] = paramConfig;
      }
    }
    result.train_params = trainParams;
  }

  if (config.trial_train_params) {
    result.trial_train_params = config.trial_train_params;
  }

  return result;
}

// ============================================================================
// Native Format -> Editor
// ============================================================================

/**
 * Convert nirs4all-native steps back to editor format (for import).
 */
export function fromNativeFormat(steps: NativePipelineStep[]): EditorPipelineStep[] {
  return steps.map((step) => convertNativeToEditor(step));
}

function convertNativeToEditor(step: NativePipelineStep): EditorPipelineStep {
  // String: simple class name
  if (typeof step === "string") {
    const type = inferStepType(step);
    return {
      id: generateStepId(),
      type,
      name: step,
      params: {},
    };
  }

  // Object: keyword-wrapped or class-with-params
  const keys = Object.keys(step);

  // model keyword
  if ("model" in step) {
    return convertNativeModelToEditor(step as Record<string, unknown>);
  }

  // y_processing keyword
  if ("y_processing" in step) {
    const yProc = (step as Record<string, unknown>).y_processing;
    const { name, params } = parseOperatorRef(yProc as string | Record<string, unknown>);
    return {
      id: generateStepId(),
      type: "y_processing",
      name,
      params: flattenParams(params),
    };
  }

  // branch keyword
  if ("branch" in step) {
    return convertNativeBranchToEditor(step as Record<string, unknown>);
  }

  // merge keyword
  if ("merge" in step) {
    const merge = (step as Record<string, unknown>).merge;
    if (typeof merge === "string") {
      return {
        id: generateStepId(),
        type: "flow",
        subType: "merge",
        name: merge === "predictions" ? "Stacking" : "Concatenate",
        params: { merge_type: merge },
        mergeConfig: { mode: merge },
      };
    }
    return {
      id: generateStepId(),
      type: "flow",
      subType: "merge",
      name: "Stacking",
      params: {},
      mergeConfig: merge as EditorPipelineStep["mergeConfig"],
    };
  }

  // exclude keyword
  if ("exclude" in step) {
    return convertNativeExcludeToEditor(step as Record<string, unknown>);
  }

  // tag keyword
  if ("tag" in step) {
    return convertNativeTagToEditor(step as Record<string, unknown>);
  }

  // sample_augmentation keyword
  if ("sample_augmentation" in step) {
    return convertNativeSampleAugToEditor(step as Record<string, unknown>);
  }

  // feature_augmentation keyword
  if ("feature_augmentation" in step) {
    return convertNativeFeatureAugToEditor(step as Record<string, unknown>);
  }

  // Generator keywords
  if ("_or_" in step) {
    return convertNativeOrToEditor(step as Record<string, unknown>);
  }
  if ("_range_" in step) {
    return convertNativeRangeToEditor(step as Record<string, unknown>, "_range_");
  }
  if ("_log_range_" in step) {
    return convertNativeRangeToEditor(step as Record<string, unknown>, "_log_range_");
  }
  if ("_cartesian_" in step) {
    return convertNativeCartesianToEditor(step as Record<string, unknown>);
  }
  if ("_grid_" in step) {
    return convertNativeGridToEditor(step as Record<string, unknown>);
  }

  // Chart keywords
  if ("chart_2d" in step || "chart_y" in step) {
    const chartType = "chart_2d" in step ? "chart_2d" : "chart_y";
    const chartParams = (step as Record<string, unknown>)[chartType];
    return {
      id: generateStepId(),
      type: "utility",
      subType: "chart",
      name: chartType,
      params: flattenParams(typeof chartParams === "object" && chartParams !== null ? chartParams as Record<string, unknown> : {}),
      chartConfig: { chartType: chartType as "chart_2d" | "chart_y" },
    };
  }

  // Default: single-key object is {ClassName: {params}}
  if (keys.length === 1) {
    const className = keys[0];
    const paramsObj = (step as Record<string, unknown>)[className];
    const type = inferStepType(className);
    return {
      id: generateStepId(),
      type,
      name: className,
      params: flattenParams(paramsObj as Record<string, unknown> || {}),
    };
  }

  // Unknown format - store raw
  return {
    id: generateStepId(),
    type: "preprocessing",
    name: "Unknown",
    params: {},
    rawNirs4all: step,
  };
}

function convertNativeModelToEditor(step: Record<string, unknown>): EditorPipelineStep {
  const modelRef = step.model;
  const { name, params } = parseOperatorRef(modelRef as string | Record<string, unknown>);

  const editorStep: EditorPipelineStep = {
    id: generateStepId(),
    type: "model",
    name,
    params: flattenParams(params),
  };

  if (step.name) editorStep.customName = step.name as string;

  if (step.train_params) {
    const tp = step.train_params as Record<string, unknown>;
    editorStep.trainingConfig = {
      epochs: (tp.epochs as number) || 100,
      batch_size: (tp.batch_size as number) || 32,
      learning_rate: tp.learning_rate as number,
      patience: tp.patience as number,
      optimizer: tp.optimizer as "adam" | "sgd" | "rmsprop" | "adamw",
      verbose: tp.verbose as number,
    };
  }

  if (step.finetune_params) {
    const fp = step.finetune_params as Record<string, unknown>;
    editorStep.finetuneConfig = {
      enabled: true,
      n_trials: (fp.n_trials as number) || 50,
      approach: (fp.approach as "grouped" | "individual" | "single" | "cross") || "single",
      eval_mode: (fp.eval_mode as "best" | "mean") || "best",
      sample: fp.sample as "grid" | "random" | "hyperband" | undefined,
      verbose: fp.verbose as number | undefined,
      model_params: [],
    };
    if (fp.model_params) {
      for (const [pName, pConfig] of Object.entries(fp.model_params as Record<string, unknown>)) {
        if (Array.isArray(pConfig)) {
          editorStep.finetuneConfig.model_params.push({ name: pName, type: "categorical", choices: pConfig as (string | number)[] });
        } else if (typeof pConfig === "object" && pConfig !== null) {
          const c = pConfig as Record<string, unknown>;
          editorStep.finetuneConfig.model_params.push({
            name: pName,
            type: (c.log ? "log_float" : (c.type as string) || "int") as "int" | "float" | "categorical" | "log_float",
            low: c.low as number,
            high: c.high as number,
            step: c.step as number,
          });
        }
      }
    }
  }

  // Handle sweeps at model level
  if (step._range_ && step.param) {
    const range = step._range_ as number[];
    editorStep.paramSweeps = {
      [step.param as string]: { type: "range", from: range[0], to: range[1], step: range[2] },
    };
  }
  if (step._log_range_ && step.param) {
    const range = step._log_range_ as number[];
    editorStep.paramSweeps = {
      [step.param as string]: { type: "log_range", from: range[0], to: range[1], count: range[2] },
    };
  }
  if (step._grid_) {
    editorStep.paramSweeps = {};
    for (const [pName, values] of Object.entries(step._grid_ as Record<string, unknown>)) {
      editorStep.paramSweeps[pName] = { type: "or", choices: values as (string | number | boolean)[] };
    }
  }

  return editorStep;
}

function convertNativeBranchToEditor(step: Record<string, unknown>): EditorPipelineStep {
  const branchData = step.branch;
  const branches: EditorPipelineStep[][] = [];
  const branchMetadata: Array<{ name?: string }> = [];

  if (Array.isArray(branchData)) {
    for (const branchSteps of branchData) {
      branches.push(fromNativeFormat(branchSteps as NativePipelineStep[]));
      branchMetadata.push({});
    }
  } else if (typeof branchData === "object" && branchData !== null) {
    for (const [branchName, branchSteps] of Object.entries(branchData as Record<string, unknown>)) {
      branches.push(fromNativeFormat(branchSteps as NativePipelineStep[]));
      branchMetadata.push({ name: branchName });
    }
  }

  return {
    id: generateStepId(),
    type: "flow",
    subType: "branch",
    name: "ParallelBranch",
    params: {},
    branches,
    branchMetadata,
  };
}

function convertNativeExcludeToEditor(step: Record<string, unknown>): EditorPipelineStep {
  const excludeVal = step.exclude;
  const filters = Array.isArray(excludeVal)
    ? (excludeVal as NativePipelineStep[]).map((f) => convertNativeToEditor(f))
    : [convertNativeToEditor(excludeVal as NativePipelineStep)];

  return {
    id: generateStepId(),
    type: "flow",
    subType: "sample_filter",
    name: "SampleFilter",
    params: { mode: (step.mode as string) || "any", report: true },
    children: filters,
  };
}

function convertNativeTagToEditor(step: Record<string, unknown>): EditorPipelineStep {
  const tagVal = step.tag;
  const filters = Array.isArray(tagVal)
    ? (tagVal as NativePipelineStep[]).map((f) => convertNativeToEditor(f))
    : [convertNativeToEditor(tagVal as NativePipelineStep)];

  return {
    id: generateStepId(),
    type: "flow",
    subType: "sample_filter",
    name: "SampleFilter",
    params: { mode: "tag", report: true },
    children: filters,
  };
}

function convertNativeSampleAugToEditor(step: Record<string, unknown>): EditorPipelineStep {
  const aug = step.sample_augmentation as Record<string, unknown>;
  const transformers = (aug.transformers as NativePipelineStep[]) || [];
  const children = transformers.map((t) => convertNativeToEditor(t));

  return {
    id: generateStepId(),
    type: "flow",
    subType: "sample_augmentation",
    name: "SampleAugmentation",
    params: {
      count: (aug.count as number) || 1,
      selection: (aug.selection as string) || "random",
      variation_scope: (aug.variation_scope as string) || "sample",
    },
    children,
    sampleAugmentationConfig: {
      transformers: children.map((c) => ({
        id: c.id,
        name: c.name,
        params: c.params || {},
        enabled: true,
      })),
      count: aug.count as number,
      selection: aug.selection as "random" | "all" | "sequential",
      random_state: aug.random_state as number,
      variation_scope: aug.variation_scope as "sample" | "batch",
    },
  };
}

function convertNativeFeatureAugToEditor(step: Record<string, unknown>): EditorPipelineStep {
  const aug = step.feature_augmentation;

  if (Array.isArray(aug)) {
    const children = (aug as NativePipelineStep[]).map((t) => convertNativeToEditor(t));
    return {
      id: generateStepId(),
      type: "flow",
      subType: "feature_augmentation",
      name: "FeatureAugmentation",
      params: { action: (step.action as string) || "extend" },
      children,
    };
  }

  // Generator syntax
  const augObj = aug as Record<string, unknown>;
  if (augObj._or_) {
    const children = (augObj._or_ as NativePipelineStep[]).map((t) => convertNativeToEditor(t));
    return {
      id: generateStepId(),
      type: "flow",
      subType: "feature_augmentation",
      name: "FeatureAugmentation",
      params: { action: (step.action as string) || "extend" },
      children,
      generatorKind: "or",
      generatorOptions: {
        pick: augObj.pick as number | [number, number],
        count: augObj.count as number,
      },
    };
  }

  return {
    id: generateStepId(),
    type: "flow",
    subType: "feature_augmentation",
    name: "FeatureAugmentation",
    params: { action: "extend" },
    children: [],
  };
}

function convertNativeOrToEditor(step: Record<string, unknown>): EditorPipelineStep {
  const alternatives = (step._or_ as unknown[]) || [];
  const branches = alternatives.map((alt) => {
    if (Array.isArray(alt)) {
      return fromNativeFormat(alt as NativePipelineStep[]);
    }
    return [convertNativeToEditor(alt as NativePipelineStep)];
  });

  return {
    id: generateStepId(),
    type: "utility",
    subType: "generator",
    name: "Choose",
    params: {},
    branches,
    generatorKind: "or",
    generatorOptions: {
      pick: step.pick as number | [number, number],
      arrange: step.arrange as number | [number, number],
      then_pick: step.then_pick as number | [number, number],
      then_arrange: step.then_arrange as number | [number, number],
      count: step.count as number,
    },
  };
}

function convertNativeRangeToEditor(step: Record<string, unknown>, keyword: "_range_" | "_log_range_"): EditorPipelineStep {
  const values = step[keyword] as number[];
  const paramName = step.param as string;

  return {
    id: generateStepId(),
    type: "utility",
    subType: "generator",
    name: "Choose",
    params: {},
    stepGenerator: {
      type: keyword,
      values,
      param: paramName,
      count: step.count as number,
    },
  };
}

function convertNativeCartesianToEditor(step: Record<string, unknown>): EditorPipelineStep {
  const stages = (step._cartesian_ as unknown[][]) || [];
  const branches = stages.map((stage) =>
    (stage as NativePipelineStep[]).map((s) => convertNativeToEditor(s))
  );

  return {
    id: generateStepId(),
    type: "utility",
    subType: "generator",
    name: "Cartesian",
    params: {},
    branches,
    generatorKind: "cartesian",
    generatorOptions: {
      pick: step.pick as number | [number, number],
      arrange: step.arrange as number | [number, number],
      count: step.count as number,
    },
  };
}

function convertNativeGridToEditor(step: Record<string, unknown>): EditorPipelineStep {
  const grid = step._grid_ as Record<string, unknown[]>;
  const paramSweeps: EditorPipelineStep["paramSweeps"] = {};

  for (const [paramName, values] of Object.entries(grid)) {
    paramSweeps[paramName] = {
      type: "or",
      choices: values as (string | number | boolean)[],
    };
  }

  return {
    id: generateStepId(),
    type: "utility",
    subType: "generator",
    name: "Grid",
    params: {},
    paramSweeps,
  };
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Parse an operator reference (string or {Name: {params}}).
 */
function parseOperatorRef(ref: string | Record<string, unknown>): { name: string; params: Record<string, unknown> } {
  if (typeof ref === "string") {
    return { name: ref, params: {} };
  }
  const keys = Object.keys(ref);
  if (keys.length === 1) {
    const name = keys[0];
    const params = ref[name];
    return { name, params: (typeof params === "object" && params !== null ? params : {}) as Record<string, unknown> };
  }
  return { name: "Unknown", params: {} };
}

/**
 * Flatten params to editor-compatible types.
 */
function flattenParams(params: Record<string, unknown>): Record<string, string | number | boolean> {
  const result: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      result[key] = value;
    } else if (Array.isArray(value) && value.length === 2 && typeof value[0] === "number" && typeof value[1] === "number") {
      // Tuple -> split into _min/_max for editor
      result[`${key}_min`] = value[0];
      result[`${key}_max`] = value[1];
    } else if (value !== null && value !== undefined) {
      result[key] = JSON.stringify(value);
    }
  }
  return result;
}

/**
 * Infer the step type from a class name.
 */
function inferStepType(className: string): StepType {
  // Known model names
  const modelNames = new Set([
    "PLSRegression", "PLSDA", "OPLS", "OPLSDA", "IKPLS", "SparsePLS", "LWPLS",
    "IntervalPLS", "RobustPLS", "SIMPLS", "DiPLS", "RecursivePLS",
    "KernelPLS", "KOPLS", "NLPLS", "FCKPLS",
    "Ridge", "Lasso", "ElasticNet", "SVR", "SVC",
    "RandomForestRegressor", "RandomForestClassifier",
    "XGBoost", "LightGBM", "GradientBoostingRegressor",
    "CNN1D", "MLP", "LSTM", "Transformer", "nicon",
    "MetaModel",
  ]);

  // Known splitter names
  const splitterNames = new Set([
    "KFold", "RepeatedKFold", "ShuffleSplit", "StratifiedKFold",
    "LeaveOneOut", "GroupKFold", "GroupShuffleSplit",
    "KennardStone", "SPXY", "SPXYGFold", "KMeansSplitter",
    "SPlitSplitter", "KBinsStratifiedSplitter", "BinnedStratifiedGroupKFold",
    "SystematicCircularSplitter",
  ]);

  // Known filter names
  const filterNames = new Set([
    "YOutlierFilter", "XOutlierFilter", "HotellingT2Filter",
    "SpectralQualityFilter", "SampleFilter",
  ]);

  // Known augmentation names
  const augmentationNames = new Set([
    "GaussianNoise", "GaussianAdditiveNoise", "MultiplicativeNoise",
    "SpikeNoise", "LinearBaselineDrift", "PolynomialBaselineDrift",
    "WavelengthShift", "WavelengthStretch", "BandMasking",
    "ChannelDropout", "Mixup", "Rotate_Translate",
  ]);

  if (modelNames.has(className)) return "model";
  if (splitterNames.has(className)) return "splitting";
  if (filterNames.has(className)) return "filter";
  if (augmentationNames.has(className)) return "augmentation";
  return "preprocessing";
}

// ============================================================================
// YAML Serialization
// ============================================================================

/**
 * Convert native pipeline steps to a human-readable YAML string.
 * Uses a lightweight custom serializer (no external YAML library needed).
 */
export function toYAML(steps: NativePipelineStep[]): string {
  const lines: string[] = [];
  lines.push("pipeline:");
  for (const step of steps) {
    serializeStepToYAML(step, lines, 1, true);
  }
  return lines.join("\n");
}

function serializeStepToYAML(
  value: unknown,
  lines: string[],
  indent: number,
  isListItem: boolean
): void {
  const prefix = "  ".repeat(indent);
  const listPrefix = isListItem ? "- " : "";
  const itemIndent = isListItem ? indent : indent;

  if (value === null || value === undefined) {
    lines.push(`${prefix}${listPrefix}null`);
    return;
  }

  if (typeof value === "string") {
    // Quote strings that need it
    if (needsQuoting(value)) {
      lines.push(`${prefix}${listPrefix}"${escapeYAMLString(value)}"`);
    } else {
      lines.push(`${prefix}${listPrefix}${value}`);
    }
    return;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    lines.push(`${prefix}${listPrefix}${value}`);
    return;
  }

  if (Array.isArray(value)) {
    // Check if this is a simple flat array (all primitives) -> inline
    if (value.every((v) => typeof v === "string" || typeof v === "number" || typeof v === "boolean")) {
      const inlineItems = value.map((v) =>
        typeof v === "string" ? (needsQuoting(v) ? `"${escapeYAMLString(v)}"` : v) : String(v)
      );
      lines.push(`${prefix}${listPrefix}[${inlineItems.join(", ")}]`);
      return;
    }

    // Complex array: each item on its own line
    if (isListItem) {
      // First item shares the line with the dash
      // But for arrays of arrays, we need to handle the nesting
      lines.push(`${prefix}${listPrefix}`);
      for (const item of value) {
        serializeStepToYAML(item, lines, itemIndent + 1, true);
      }
    } else {
      for (const item of value) {
        serializeStepToYAML(item, lines, indent, true);
      }
    }
    return;
  }

  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const entries = Object.entries(obj);

    if (entries.length === 0) {
      lines.push(`${prefix}${listPrefix}{}`);
      return;
    }

    // Check if it's a simple object (all primitive values) -> try compact
    const isSimpleObject = entries.every(
      ([, v]) =>
        typeof v === "string" ||
        typeof v === "number" ||
        typeof v === "boolean" ||
        v === null ||
        (Array.isArray(v) && v.every((i) => typeof i !== "object"))
    );

    // For {ClassName: {params}} pattern, use compact notation
    if (entries.length === 1 && isSimpleObject) {
      const [key, val] = entries[0];
      if (typeof val === "object" && val !== null && !Array.isArray(val)) {
        lines.push(`${prefix}${listPrefix}${key}:`);
        const subEntries = Object.entries(val as Record<string, unknown>);
        for (const [subKey, subVal] of subEntries) {
          serializeStepToYAML(subVal, lines, itemIndent + 1, false);
          // Fix: add key
          lines[lines.length - 1] = `${"  ".repeat(itemIndent + 1)}${subKey}: ${lines[lines.length - 1].trim()}`;
        }
        return;
      }
    }

    // First key shares line with the list prefix
    let first = true;
    for (const [key, val] of entries) {
      if (first && isListItem) {
        // Inline simple values
        if (typeof val === "string" || typeof val === "number" || typeof val === "boolean") {
          const formattedVal = typeof val === "string" && needsQuoting(val)
            ? `"${escapeYAMLString(val)}"`
            : String(val);
          lines.push(`${prefix}${listPrefix}${key}: ${formattedVal}`);
        } else if (Array.isArray(val) && val.every((v) => typeof v !== "object" || v === null)) {
          const inlineItems = val.map((v) =>
            typeof v === "string" ? (needsQuoting(v) ? `"${escapeYAMLString(v)}"` : v) : String(v)
          );
          lines.push(`${prefix}${listPrefix}${key}: [${inlineItems.join(", ")}]`);
        } else {
          lines.push(`${prefix}${listPrefix}${key}:`);
          serializeStepToYAML(val, lines, itemIndent + 1, false);
        }
        first = false;
      } else {
        const keyPrefix = "  ".repeat(first ? indent : itemIndent + (isListItem ? 1 : 0));
        if (typeof val === "string" || typeof val === "number" || typeof val === "boolean" || val === null) {
          const formattedVal = val === null
            ? "null"
            : typeof val === "string" && needsQuoting(val)
              ? `"${escapeYAMLString(val)}"`
              : String(val);
          lines.push(`${keyPrefix}${key}: ${formattedVal}`);
        } else if (Array.isArray(val) && val.every((v) => typeof v !== "object" || v === null)) {
          const inlineItems = val.map((v) =>
            typeof v === "string" ? (needsQuoting(v) ? `"${escapeYAMLString(v)}"` : v) : String(v)
          );
          lines.push(`${keyPrefix}${key}: [${inlineItems.join(", ")}]`);
        } else {
          lines.push(`${keyPrefix}${key}:`);
          if (Array.isArray(val)) {
            for (const item of val) {
              serializeStepToYAML(item, lines, itemIndent + (isListItem ? 2 : 1), true);
            }
          } else {
            serializeStepToYAML(val, lines, itemIndent + (isListItem ? 2 : 1), false);
          }
        }
        first = false;
      }
    }
  }
}

function needsQuoting(s: string): boolean {
  // Quote if it contains special YAML characters or looks like a number/boolean
  if (s === "") return true;
  if (s === "true" || s === "false" || s === "null" || s === "yes" || s === "no") return true;
  if (/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(s)) return true;
  if (/[:{}[\],&*?|>!%@`#'"]/.test(s)) return true;
  if (s.startsWith(" ") || s.endsWith(" ")) return true;
  return false;
}

function escapeYAMLString(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Convert editor steps to a full native pipeline JSON document.
 */
export function toNativePipelineJSON(
  steps: EditorPipelineStep[],
  options?: { name?: string; description?: string; randomState?: number }
): NativePipelineDocument {
  return {
    version: "1.0",
    ...(options?.name ? { name: options.name } : {}),
    ...(options?.description ? { description: options.description } : {}),
    ...(options?.randomState !== undefined ? { random_state: options.randomState } : {}),
    steps: toNativeFormat(steps),
  };
}

/**
 * Convert editor steps to a YAML string with version wrapper.
 */
export function toNativePipelineYAML(
  steps: EditorPipelineStep[],
  options?: { name?: string; description?: string; randomState?: number }
): string {
  const lines: string[] = [];
  lines.push("version: \"1.0\"");
  if (options?.name) lines.push(`name: "${escapeYAMLString(options.name)}"`);
  if (options?.description) lines.push(`description: "${escapeYAMLString(options.description)}"`);
  if (options?.randomState !== undefined) lines.push(`random_state: ${options.randomState}`);
  lines.push("");

  const nativeSteps = toNativeFormat(steps);
  const yamlBody = toYAML(nativeSteps);
  lines.push(yamlBody);

  return lines.join("\n");
}
