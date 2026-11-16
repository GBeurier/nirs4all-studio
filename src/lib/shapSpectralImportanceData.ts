import type { RegionValueKind, SpectralImportanceRegion } from 'nirs4all-ui/viz';
import type { BinnedImportanceData } from '@/types/shap';

/**
 * Signed aggregations (`sum`, `mean`) keep the direction of each SHAP value;
 * `*_abs` aggregations are magnitudes. Unknown values are treated as
 * magnitudes, matching the backend default (`mean_abs`).
 */
export function getShapBinValueKind(aggregation: string): RegionValueKind {
  return aggregation === 'sum' || aggregation === 'mean' ? 'signed' : 'magnitude';
}

/** Project backend bins onto the shared spectral region contract (order and values untouched). */
export function buildShapSpectralRegions(binnedImportance: BinnedImportanceData): SpectralImportanceRegion[] {
  return binnedImportance.bin_ranges.flatMap((range, index) => {
    if (!range) return [];
    const value = binnedImportance.bin_values[index];
    return [{ start: range[0], end: range[1], value: typeof value === 'number' ? value : Number.NaN }];
  });
}

export function hasShapSpectralAbsorbance(spectrumValues: number[]): boolean {
  return spectrumValues.some((value) => Number.isFinite(value) && value !== 0);
}
