import type { PipelineStep as EditorPipelineStep } from "@/components/pipeline-editor/types";
import { serializeNamedFinetuneParams } from "./pipelineFinetuneParams";
import { getDefaultParamsForStep, resolveRequiredClassPath } from "./pipelineClassPathResolver";
import type {
  Nirs4allClassStep,
  Nirs4allModelStep,
  Nirs4allStep,
} from "./nirs4allPipelineTypes";
import { castParamRecord } from "./pipelineValueUtils";

type EditorToNirs4allStepConverter = (step: EditorPipelineStep) => Nirs4allStep;

export function getExportableStepParams(step: EditorPipelineStep): Record<string, unknown> {
  const params = castParamRecord(step.params);
  const hydratedDefaultParams = new Set(
    Array.isArray(step.hydratedDefaultParams)
      ? step.hydratedDefaultParams.filter(
          (key): key is string => typeof key === "string" && key.length > 0
        )
      : []
  );

  if (hydratedDefaultParams.size === 0) {
    return params;
  }

  const defaults = getDefaultParamsForStep(step);
  if (Object.keys(defaults).length === 0) {
    return params;
  }

  const filteredParams: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params)) {
    if (hydratedDefaultParams.has(key) && defaults[key] === value) {
      continue;
    }
    filteredParams[key] = value;
  }
  return filteredParams;
}

export function buildClassStep(step: EditorPipelineStep, classPath: string): Nirs4allStep {
  const params = getExportableStepParams(step);
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

export function convertEditorModelToNirs4all(
  step: EditorPipelineStep,
  classPath: string
): Nirs4allStep {
  let modelDef: Nirs4allClassStep | { function: string; params?: Record<string, unknown> };
  const exportableParams = getExportableStepParams(step);

  if (step.functionPath) {
    modelDef = { function: step.functionPath };
    if (Object.keys(exportableParams).length > 0) {
      (modelDef as { function: string; params?: Record<string, unknown> }).params = exportableParams;
    }
    if (step.framework) {
      (modelDef as { function: string; params?: Record<string, unknown>; framework?: string }).framework = step.framework;
    }
  } else {
    modelDef = { class: classPath };
    if (Object.keys(exportableParams).length > 0) {
      modelDef.params = exportableParams;
    }
  }

  const result: Nirs4allModelStep = {
    model: modelDef,
  };

  if (step.customName) {
    result.name = step.customName;
  }

  if (step.finetuneConfig?.enabled) {
    const modelParams = serializeNamedFinetuneParams(step.finetuneConfig.model_params);

    result.finetune_params = {
      n_trials: step.finetuneConfig.n_trials,
      approach: step.finetuneConfig.approach,
      eval_mode: step.finetuneConfig.eval_mode,
      model_params: modelParams,
    };

    if (step.finetuneConfig.sample) {
      result.finetune_params.sample = step.finetuneConfig.sample;
    }
    if (step.finetuneConfig.verbose !== undefined) {
      result.finetune_params.verbose = step.finetuneConfig.verbose;
    }

    if (step.finetuneConfig.train_params && step.finetuneConfig.train_params.length > 0) {
      const trainParamsRecord = serializeNamedFinetuneParams(
        step.finetuneConfig.train_params
      );
      result.finetune_params.train_params = trainParamsRecord;
    }
  }

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

export function convertEditorYProcessingToNirs4all(
  step: EditorPipelineStep,
  classPath: string
): Nirs4allStep {
  const yProcessingDef = buildClassStep(step, classPath);

  return {
    y_processing: yProcessingDef as string | Nirs4allClassStep,
  };
}

export function convertEditorChartToNirs4all(step: EditorPipelineStep): Nirs4allStep {
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

  const chartType = (step.params.chartType as string) || "chart_2d";
  const params: Record<string, unknown> = { ...step.params };
  delete params.chartType;

  if (Object.keys(params).length > 0) {
    return { [chartType]: params };
  }
  return { [chartType]: {} };
}

export function convertEditorAugmentationToNirs4all(
  step: EditorPipelineStep,
  convertEditorStepToNirs4all: EditorToNirs4allStepConverter
): Nirs4allStep {
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

  const classPath = resolveRequiredClassPath(step);
  return buildClassStep(step, classPath);
}

export function convertEditorFilterToNirs4all(
  step: EditorPipelineStep,
  convertEditorStepToNirs4all: EditorToNirs4allStepConverter
): Nirs4allStep {
  if (step.name === "SampleFilter" && step.branches?.length) {
    return {
      sample_filter: {
        filters: step.branches[0].map(s => convertEditorStepToNirs4all(s)) as Array<string | Nirs4allClassStep>,
        mode: step.params.mode as string,
        report: step.params.report as boolean,
      },
    };
  }

  const classPath = resolveRequiredClassPath(step);
  return buildClassStep(step, classPath);
}
