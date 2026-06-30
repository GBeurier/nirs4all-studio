import type { FeatureContribution, SampleExplanationResponse } from '@/types/shap';

export interface ShapWaterfallBarData {
  name: string;
  start: number;
  end: number;
  value: number;
  isPositive: boolean;
  isBase: boolean;
  isFinal: boolean;
}

export interface ShapWaterfallBarStyle {
  fill: string;
  fillOpacity: number;
}

export function sortShapWaterfallContributions(
  contributions: FeatureContribution[],
): FeatureContribution[] {
  return [...contributions].sort((left, right) => {
    if (left.shap_value >= 0 && right.shap_value < 0) return -1;
    if (left.shap_value < 0 && right.shap_value >= 0) return 1;
    return Math.abs(right.shap_value) - Math.abs(left.shap_value);
  });
}

export function buildShapWaterfallBars(
  data: Pick<SampleExplanationResponse, 'base_value' | 'predicted_value' | 'contributions'>,
): ShapWaterfallBarData[] {
  const bars: ShapWaterfallBarData[] = [{
    name: 'Base Value',
    start: 0,
    end: data.base_value,
    value: data.base_value,
    isPositive: true,
    isBase: true,
    isFinal: false,
  }];

  let cumulative = data.base_value;
  sortShapWaterfallContributions(data.contributions).forEach((contribution) => {
    const start = cumulative;
    const end = cumulative + contribution.shap_value;
    bars.push({
      name: contribution.feature_name,
      start,
      end,
      value: contribution.shap_value,
      isPositive: contribution.shap_value >= 0,
      isBase: false,
      isFinal: false,
    });
    cumulative = end;
  });

  bars.push({
    name: 'Prediction',
    start: 0,
    end: data.predicted_value,
    value: data.predicted_value,
    isPositive: true,
    isBase: false,
    isFinal: true,
  });

  return bars;
}

export function getShapWaterfallPreviousSample(sampleIndex: number): number | null {
  return sampleIndex > 0 ? sampleIndex - 1 : null;
}

export function getShapWaterfallNextSample(sampleIndex: number, totalSamples: number): number | null {
  return sampleIndex < totalSamples - 1 ? sampleIndex + 1 : null;
}

export function parseShapWaterfallSampleInput(value: string, totalSamples: number): number | null {
  const parsed = parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed < 0 || parsed >= totalSamples) return null;
  return parsed;
}

export function getShapWaterfallBarStyle(bar: Pick<ShapWaterfallBarData, 'isBase' | 'isFinal' | 'isPositive'>): ShapWaterfallBarStyle {
  if (bar.isBase) {
    return {
      fill: 'hsl(var(--muted-foreground))',
      fillOpacity: 0.8,
    };
  }

  if (bar.isFinal) {
    return {
      fill: 'hsl(var(--primary))',
      fillOpacity: 0.8,
    };
  }

  return {
    fill: bar.isPositive ? '#22c55e' : '#ef4444',
    fillOpacity: 0.7,
  };
}
