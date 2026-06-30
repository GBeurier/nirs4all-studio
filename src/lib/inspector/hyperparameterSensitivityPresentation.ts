import type { HyperparameterTrend } from '@/lib/inspector/hyperparameterSensitivityData';

export const HYPERPARAMETER_EMPTY_DESCRIPTION = 'Chains need numeric model parameters and scores to populate this scatter.';

export interface HyperparameterAvailableParamTags {
  visibleParams: string[];
  overflowCount: number;
}

export function getHyperparameterEmptyDescription(reason: string | null | undefined): string {
  return reason?.trim() || HYPERPARAMETER_EMPTY_DESCRIPTION;
}

export function getHyperparameterScaleDescription(useLogX: boolean, logAllowed: boolean): string {
  const base = useLogX ? 'Log scale is active.' : 'Linear scale is active.';
  if (logAllowed) return base;
  return `${base} Log scale is disabled because some values are not positive.`;
}

export function getHyperparameterAvailableParamTags(
  params: readonly string[] | null | undefined,
  limit = 8,
): HyperparameterAvailableParamTags {
  const allParams = params ?? [];
  return {
    visibleParams: allParams.slice(0, limit),
    overflowCount: Math.max(0, allParams.length - limit),
  };
}

export function getHyperparameterSelectionSummary(hasSelection: boolean, selectedCount: number): string {
  return hasSelection ? `${selectedCount} selected` : 'No selection';
}

export function formatHyperparameterTrendSlope(trend: HyperparameterTrend): string {
  return `slope ${trend.slope.toFixed(4)}`;
}

export function formatHyperparameterTrendCorrelation(trend: HyperparameterTrend): string {
  return `r ${trend.r.toFixed(3)}`;
}
