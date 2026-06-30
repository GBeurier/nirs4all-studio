import type { FinetuneConfig, PipelineParams } from "../types";
import { getPresetsForModel } from "./presets";

interface BuildQuickFinetuneConfigArgs {
  modelName: string;
  params: PipelineParams;
}

export function getNumericFinetuneParamNames(params: PipelineParams): string[] {
  return Object.keys(params).filter((name) => typeof params[name] === "number");
}

export function buildQuickFinetuneConfig({
  modelName,
  params,
}: BuildQuickFinetuneConfigArgs): FinetuneConfig | null {
  const availableParams = getNumericFinetuneParamNames(params);
  const modelParams = getPresetsForModel(modelName)
    .filter((preset) => availableParams.includes(preset.name))
    .slice(0, 2)
    .map((preset) => ({
      name: preset.name,
      type: preset.type,
      low: preset.low,
      high: preset.high,
      step: preset.step,
      choices: preset.choices,
    }));

  if (modelParams.length === 0) {
    return null;
  }

  return {
    enabled: true,
    n_trials: 50,
    approach: "grouped",
    eval_mode: "best",
    model_params: modelParams,
  };
}
