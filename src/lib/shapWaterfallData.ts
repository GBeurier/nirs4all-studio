import { compactNumber, type WaterfallContribution } from 'nirs4all-ui/viz';
import type { SampleExplanationResponse } from '@/types/shap';

/**
 * Project a sample explanation onto the shared waterfall contract. The backend
 * order (largest |SHAP| first, aggregated remainder last) is preserved so the
 * walk from the base value reaches the prediction.
 */
export function buildShapWaterfallContributions(
  data: Pick<SampleExplanationResponse, 'contributions'>,
): WaterfallContribution[] {
  return data.contributions.map((contribution) => ({
    label: contribution.feature_name,
    value: contribution.shap_value,
  }));
}

/**
 * Model outputs (base value, prediction, running totals) often differ by
 * thousandths around a large value: keep four decimals there and the compact
 * scientific format for small contributions.
 */
export function formatShapWaterfallValue(value: number): string {
  const magnitude = Math.abs(value);
  return Number.isFinite(value) && magnitude >= 1 && magnitude < 1e4 ? value.toFixed(4) : compactNumber(value);
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
