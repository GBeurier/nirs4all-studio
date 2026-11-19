import type { BinnedImportanceData, ShapResultsResponse } from '@/types/shap';

export interface ShapInitialBinningParams {
  binSize: number;
  binStride: number;
  aggregation: string;
}

export interface ShapResultsHeaderSummary {
  sampleCount: number;
  explainerType: string;
  /** Native (nirs4all-methods) engine; absent for the Python `shap` engine. */
  native: boolean;
  executionTimeLabel: string;
}

/** The sample breakdown decomposes a prediction additively; LIME and occlusion are not additive. */
export function isShapWaterfallAvailable(results: Pick<ShapResultsResponse, 'additive'>): boolean {
  return results.additive !== false;
}

export function getShapWaterfallSampleIndex(selectedSamples: number[]): number {
  return selectedSamples.length > 0 ? selectedSamples[0] : 0;
}

export function getShapWaterfallSelection(sampleIndex: number): number[] {
  return [sampleIndex];
}

export function toggleShapSelectedSample(selectedSamples: number[], sampleIndex: number): number[] {
  const next = new Set(selectedSamples);
  if (next.has(sampleIndex)) {
    next.delete(sampleIndex);
  } else {
    next.add(sampleIndex);
  }
  return Array.from(next).sort((left, right) => left - right);
}

export function getShapInitialBinningParams(
  results: Pick<ShapResultsResponse, 'binned_importance'>,
  binnedData: BinnedImportanceData | null,
): ShapInitialBinningParams {
  const activeBinnedData = binnedData ?? results.binned_importance;

  return {
    binSize: activeBinnedData.bin_size,
    binStride: activeBinnedData.bin_stride,
    aggregation: activeBinnedData.aggregation,
  };
}

export function getShapResultsHeaderSummary(
  results: Pick<ShapResultsResponse, 'n_samples' | 'explainer_type' | 'explainer_backend' | 'execution_time_ms'>,
): ShapResultsHeaderSummary {
  return {
    sampleCount: results.n_samples,
    explainerType: results.explainer_type,
    native: results.explainer_backend === 'methods',
    executionTimeLabel: `${results.execution_time_ms.toFixed(0)}ms`,
  };
}
