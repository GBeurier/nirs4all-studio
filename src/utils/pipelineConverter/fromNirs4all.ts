/**
 * Pipeline Converter — Import (nirs4all → Editor Format)
 * =====================================================
 *
 * Converts nirs4all canonical pipeline steps into the webapp editor format.
 */

import type { PipelineStep as EditorPipelineStep, FinetuneParamConfig, FinetuneParamType } from "@/components/pipeline-editor/types";
import { generateStepId } from "@/components/pipeline-editor/types";
import { logger } from "@/lib/logger";
import {
  type Nirs4allStep,
  type Nirs4allPipeline,
  type Nirs4allClassStep,
  type Nirs4allModelStep,
  type Nirs4allYProcessingStep,
  type Nirs4allBranchStep,
  type Nirs4allMergeStep,
  type Nirs4allSampleAugmentationStep,
  type Nirs4allFeatureAugmentationStep,
  type Nirs4allSampleFilterStep,
  type Nirs4allConcatTransformStep,
  type Nirs4allGeneratorStep,
  type Nirs4allChartStep,
  type EditorParams,
  resolveClassPath,
  getClassNameFromPath,
  castParams,
} from "./shared";

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
  logger.warn("Unknown step type:", step);
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
      variation_scope: aug.variation_scope || "sample",
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
      variation_scope: aug.variation_scope as "sample" | "batch" | undefined,
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
