import type { FinetuneParamConfig, PipelineStep as EditorPipelineStep } from "@/components/pipeline-editor/types";
import { generateStepId } from "@/components/pipeline-editor/stepFactory";
import { parseFinetuneParamConfig } from "./pipelineFinetuneParams";
import { getClassNameFromPath, resolveClassPath } from "./pipelineClassPathResolver";
import type {
  Nirs4allChartStep,
  Nirs4allClassStep,
  Nirs4allModelStep,
  Nirs4allSplitStep,
  Nirs4allStep,
  Nirs4allYProcessingStep,
} from "./nirs4allPipelineTypes";
import { castParamRecord } from "./pipelineValueUtils";

export type EditorParams = Record<string, unknown>;

export function castParams(params: Record<string, unknown> | undefined): EditorParams {
  return castParamRecord(params);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function extractInlineComponentParams(
  step: Record<string, unknown>,
  wrapperKeys: string[],
): EditorParams {
  const reservedKeys = new Set([
    ...wrapperKeys,
    "_comment",
    "_or_",
    "_range_",
    "_log_range_",
    "_grid_",
    "_cartesian_",
    "_zip_",
    "_chain_",
    "_sample_",
    "param",
  ]);

  const params: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(step)) {
    if (reservedKeys.has(key)) continue;
    params[key] = value;
  }
  return castParams(params);
}

export function convertClassPathToEditor(step: string): EditorPipelineStep {
  if (step === "chart_2d" || step === "chart_y") {
    return {
      id: generateStepId(),
      type: "utility",
      subType: "chart",
      name: step,
      params: {},
      chartConfig: {
        chartType: step,
      },
    };
  }

  const { name, type, classPath } = resolveClassPath(step);
  return {
    id: generateStepId(),
    type,
    name,
    params: {},
    classPath: classPath || step,
  };
}

export function convertCommentToEditor(text: string): EditorPipelineStep {
  return {
    id: generateStepId(),
    type: "utility",
    subType: "comment",
    name: "Comment",
    params: { text },
  };
}

export function convertModelStepToEditor(step: Nirs4allModelStep): EditorPipelineStep {
  let name = "UnknownModel";
  let params: EditorParams = {};
  let functionPath: string | undefined;
  let classPath: string | undefined;
  let framework: string | undefined;
  const modelValue = step.model;

  if (typeof modelValue === "string") {
    const resolved = resolveClassPath(modelValue);
    name = resolved.name;
    classPath = resolved.classPath || modelValue;
  } else if ("class" in modelValue) {
    const resolved = resolveClassPath(modelValue.class);
    name = resolved.name;
    params = castParams(modelValue.params);
    classPath = resolved.classPath || modelValue.class;
  } else if ("function" in modelValue) {
    functionPath = modelValue.function;
    name = getClassNameFromPath(modelValue.function);
    params = castParams(modelValue.params);
    framework = modelValue.framework;
    if (framework) {
      classPath = undefined;
    }
  }

  const editorStep: EditorPipelineStep = {
    id: generateStepId(),
    type: "model",
    name,
    params,
  };

  if (classPath) {
    editorStep.classPath = classPath;
  }

  if (functionPath) {
    editorStep.functionPath = functionPath;
    if (framework) {
      editorStep.framework = framework;
    }
  }

  if (step.name) {
    editorStep.customName = step.name;
  }

  if (step.finetune_params) {
    editorStep.finetuneConfig = {
      enabled: true,
      n_trials: step.finetune_params.n_trials as number || 50,
      approach: step.finetune_params.approach as "grouped" | "individual" | "single" | "cross" || "single",
      eval_mode: step.finetune_params.eval_mode as "best" | "mean" || "best",
      sample: step.finetune_params.sample as "grid" | "random" | "hyperband" | undefined,
      verbose: step.finetune_params.verbose as number | undefined,
      storage: optionalString(step.finetune_params.storage),
      study_name: optionalString(step.finetune_params.study_name),
      model_params: [],
    };

    if (step.finetune_params.model_params) {
      const modelParams = step.finetune_params.model_params as Record<string, unknown>;
      for (const [paramName, paramConfig] of Object.entries(modelParams)) {
        if (
          Array.isArray(paramConfig) ||
          (typeof paramConfig === "object" && paramConfig !== null)
        ) {
          editorStep.finetuneConfig.model_params.push(
            parseFinetuneParamConfig(paramName, paramConfig)
          );
        }
      }
    }

    if (step.finetune_params.train_params) {
      const trainParamsRecord = step.finetune_params.train_params as Record<string, unknown>;
      const trainParamsArray: FinetuneParamConfig[] = [];
      for (const [name, config] of Object.entries(trainParamsRecord)) {
        if (Array.isArray(config) || (typeof config === "object" && config !== null)) {
          trainParamsArray.push(parseFinetuneParamConfig(name, config));
        }
      }
      editorStep.finetuneConfig.train_params = trainParamsArray;
    }
  }

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

export function convertYProcessingToEditor(step: Nirs4allYProcessingStep): EditorPipelineStep {
  const yProc = step.y_processing;
  const inlineParams = extractInlineComponentParams(
    step as unknown as Record<string, unknown>,
    ["y_processing"],
  );

  if (typeof yProc === "string") {
    const { name, classPath } = resolveClassPath(yProc);
    return {
      id: generateStepId(),
      type: "y_processing",
      name,
      params: inlineParams,
      classPath: classPath || yProc,
    };
  }

  const { name, classPath } = resolveClassPath(yProc.class);
  return {
    id: generateStepId(),
    type: "y_processing",
    name,
    params: {
      ...castParams(yProc.params),
      ...inlineParams,
    },
    classPath: classPath || yProc.class,
  };
}

export function convertSplitToEditor(step: Nirs4allSplitStep): EditorPipelineStep {
  const inlineParams = extractInlineComponentParams(
    step as Record<string, unknown>,
    ["split"],
  );
  const splitValue = step.split;

  if (typeof splitValue === "string") {
    const { name, classPath } = resolveClassPath(splitValue);
    return {
      id: generateStepId(),
      type: "splitting",
      name,
      params: inlineParams,
      classPath: classPath || splitValue,
    };
  }

  const { name, classPath } = resolveClassPath(splitValue.class);
  return {
    id: generateStepId(),
    type: "splitting",
    name,
    params: {
      ...castParams(splitValue.params),
      ...inlineParams,
    },
    classPath: classPath || splitValue.class,
  };
}

export function convertPreprocessingToEditor(step: {
  preprocessing: string | Nirs4allClassStep;
} & Record<string, unknown>): EditorPipelineStep {
  const preprocessingValue = step.preprocessing;
  const inlineParams = extractInlineComponentParams(step, ["preprocessing"]);

  if (typeof preprocessingValue === "string") {
    const { name, type, classPath } = resolveClassPath(preprocessingValue);
    return {
      id: generateStepId(),
      type,
      name,
      params: inlineParams,
      classPath: classPath || preprocessingValue,
    };
  }

  const { name, type, classPath } = resolveClassPath(preprocessingValue.class);
  return {
    id: generateStepId(),
    type,
    name,
    params: {
      ...castParams(preprocessingValue.params),
      ...inlineParams,
    },
    classPath: classPath || preprocessingValue.class,
  };
}

export function convertChartToEditor(step: Nirs4allChartStep): EditorPipelineStep {
  const chartType = "chart_2d" in step ? "chart_2d" : "chart_y";
  const chartValue = step[chartType];
  let chartParams: EditorParams = {};
  if (chartValue !== undefined && chartValue !== true && typeof chartValue === "object") {
    chartParams = castParams(chartValue as Record<string, unknown>);
  }
  return {
    id: generateStepId(),
    type: "utility",
    subType: "chart",
    name: chartType,
    params: chartParams,
    chartConfig: {
      chartType,
      ...chartParams,
    },
  };
}

export function convertClassStepToEditor(step: Nirs4allClassStep): EditorPipelineStep {
  const { name, type, classPath } = resolveClassPath(step.class);
  return {
    id: generateStepId(),
    type,
    name,
    params: castParams(step.params),
    classPath: classPath || step.class,
  };
}

export function convertUnknownStepToEditor(step: Nirs4allStep): EditorPipelineStep {
  console.warn("Unknown step type:", step);
  return {
    id: generateStepId(),
    type: "preprocessing",
    name: "Unknown",
    params: {},
    rawNirs4all: step,
  };
}
