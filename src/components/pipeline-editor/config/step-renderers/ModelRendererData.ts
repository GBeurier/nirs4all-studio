/**
 * Pure view-state helpers for the model step renderer.
 *
 * Keep tab badges, tone classes, and parameter empty-state decisions outside
 * React so ModelRenderer can stay focused on state wiring and JSX composition.
 */

import type { PipelineParams, PipelineStep } from "../../types";

export const MODEL_TAB_TRIGGER_CLASS_NAME =
  "text-xs data-[state=active]:bg-muted data-[state=active]:shadow-none";

export const FINETUNING_TAB_TONE_CLASS_NAME =
  "text-purple-500 data-[state=active]:text-purple-600";

export const REFIT_TAB_TONE_CLASS_NAME =
  "text-emerald-500 data-[state=active]:text-emerald-600";

export interface ModelOptionState {
  isDeepLearning?: boolean;
}

export interface ModelParameterState {
  parameterCount: number;
  hasParameters: boolean;
  hasNumericParameters: boolean;
}

export interface ModelRendererViewState extends ModelParameterState {
  hasFinetuning: boolean;
  hasRefit: boolean;
  isDeepLearning: boolean;
  finetuningTabClassName: string;
  refitTabClassName: string;
  finetuningTrialBadgeLabel?: number;
  refitBadgeLabel?: "On";
  showQuickFinetuningCta: boolean;
}

export type ModelStepStateInput = Pick<
  PipelineStep,
  "finetuneConfig" | "params" | "refitConfig"
>;

export function hasFinetuning(step: Pick<PipelineStep, "finetuneConfig">): boolean {
  return Boolean(step.finetuneConfig?.enabled);
}

export function hasRefit(step: Pick<PipelineStep, "refitConfig">): boolean {
  return step.refitConfig?.enabled ?? true;
}

export function isDeepLearningModel(option?: ModelOptionState): boolean {
  return option?.isDeepLearning ?? false;
}

export function getModelParameterState(params: PipelineParams): ModelParameterState {
  const values = Object.values(params);
  const parameterCount = Object.keys(params).length;

  return {
    parameterCount,
    hasParameters: parameterCount > 0,
    hasNumericParameters: values.some((value) => typeof value === "number"),
  };
}

export function getFinetuningTabClassName(enabled: boolean): string {
  return enabled
    ? `${MODEL_TAB_TRIGGER_CLASS_NAME} ${FINETUNING_TAB_TONE_CLASS_NAME}`
    : MODEL_TAB_TRIGGER_CLASS_NAME;
}

export function getRefitTabClassName(enabled: boolean): string {
  return enabled
    ? `${MODEL_TAB_TRIGGER_CLASS_NAME} ${REFIT_TAB_TONE_CLASS_NAME}`
    : MODEL_TAB_TRIGGER_CLASS_NAME;
}

export function getFinetuningTrialBadgeLabel(
  step: Pick<PipelineStep, "finetuneConfig">,
): number | undefined {
  return hasFinetuning(step) ? step.finetuneConfig?.n_trials : undefined;
}

export function getRefitBadgeLabel(
  step: Pick<PipelineStep, "refitConfig">,
): "On" | undefined {
  return hasRefit(step) ? "On" : undefined;
}

export function shouldShowQuickFinetuningCta(
  parameterState: Pick<ModelParameterState, "hasNumericParameters">,
  finetuningEnabled: boolean,
): boolean {
  return !finetuningEnabled && parameterState.hasNumericParameters;
}

export function getModelRendererViewState(
  step: ModelStepStateInput,
  option?: ModelOptionState,
): ModelRendererViewState {
  const finetuningEnabled = hasFinetuning(step);
  const refitEnabled = hasRefit(step);
  const parameterState = getModelParameterState(step.params);

  return {
    ...parameterState,
    hasFinetuning: finetuningEnabled,
    hasRefit: refitEnabled,
    isDeepLearning: isDeepLearningModel(option),
    finetuningTabClassName: getFinetuningTabClassName(finetuningEnabled),
    refitTabClassName: getRefitTabClassName(refitEnabled),
    finetuningTrialBadgeLabel: getFinetuningTrialBadgeLabel(step),
    refitBadgeLabel: getRefitBadgeLabel(step),
    showQuickFinetuningCta: shouldShowQuickFinetuningCta(
      parameterState,
      finetuningEnabled,
    ),
  };
}
