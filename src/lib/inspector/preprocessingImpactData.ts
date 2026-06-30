import type { PreprocessingImpactResponse } from '@/types/inspector';

export interface PreprocessingImpactBarData {
  name: string;
  impact: number;
  meanWith: number;
  meanWithout: number;
  countWith: number;
  countWithout: number;
}

export const PREPROCESSING_IMPACT_POSITIVE_COLOR = '#059669';
export const PREPROCESSING_IMPACT_NEGATIVE_COLOR = '#e11d48';

export function buildPreprocessingImpactBars(
  data: PreprocessingImpactResponse | null | undefined,
): PreprocessingImpactBarData[] {
  return (data?.entries ?? []).map((entry) => ({
    name: entry.step_name,
    impact: entry.impact ?? 0,
    meanWith: entry.mean_with ?? 0,
    meanWithout: entry.mean_without ?? 0,
    countWith: entry.count_with,
    countWithout: entry.count_without,
  }));
}

export function getPreprocessingImpactBarColor(impact: number): string {
  return impact >= 0
    ? PREPROCESSING_IMPACT_POSITIVE_COLOR
    : PREPROCESSING_IMPACT_NEGATIVE_COLOR;
}

export function formatSignedPreprocessingImpact(impact: number): string {
  return `${impact >= 0 ? '+' : ''}${impact.toFixed(4)}`;
}
