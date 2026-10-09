import type { TFunction } from 'i18next';
import type { HyperparameterTrend } from '@/lib/inspector/hyperparameterSensitivityData';

export interface HyperparameterAvailableParamTags {
  visibleParams: string[];
  overflowCount: number;
}

export function getHyperparameterEmptyDescription(reason: string | null | undefined, t: TFunction): string {
  return reason?.trim() || t('inspector.charts.empty.hyperparameter');
}

export function getHyperparameterScaleDescription(useLogX: boolean, logAllowed: boolean, t: TFunction): string {
  const base = useLogX ? t('inspector.charts.hyperparameter.logActive') : t('inspector.charts.hyperparameter.linearActive');
  if (logAllowed) return base;
  return `${base} ${t('inspector.charts.hyperparameter.logDisabled')}`;
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

export function getHyperparameterSelectionSummary(hasSelection: boolean, selectedCount: number, t: TFunction): string {
  return hasSelection ? t('inspector.counts.selected', { count: selectedCount }) : t('inspector.charts.noSelection');
}

export function formatHyperparameterTrendSlope(trend: HyperparameterTrend, t: TFunction): string {
  return t('inspector.charts.hyperparameter.slope', { value: trend.slope.toFixed(4) });
}

export function formatHyperparameterTrendCorrelation(trend: HyperparameterTrend): string {
  return `r ${trend.r.toFixed(3)}`;
}
