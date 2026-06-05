/**
 * Pipeline Converter — Export (Editor Format → nirs4all)
 * =====================================================
 *
 * Converts the webapp editor format back into nirs4all canonical pipeline steps.
 */

import type { PipelineStep as EditorPipelineStep } from "@/components/pipeline-editor/types";
import {
  type Nirs4allStep,
  type Nirs4allPipeline,
  type Nirs4allClassStep,
  type Nirs4allModelStep,
  type Nirs4allMergeStep,
  type Nirs4allGeneratorStep,
  getClassPath,
} from "./shared";

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
        variation_scope: (step.params.variation_scope as string) || step.sampleAugmentationConfig?.variation_scope || "sample",
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
        variation_scope: config.variation_scope || "sample",
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
        variation_scope: (step.params.variation_scope as string) || "sample",
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
