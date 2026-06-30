import type { BinnedImportanceData } from '@/types/shap';

export const SHAP_SPECTRAL_MAX_DISPLAY_POINTS = 400;

export interface ShapSpectralChartPoint {
  wavelength: number;
  importance: number;
  absorbance: number;
}

export interface ShapSpectralHighlightRegion {
  start: number;
  end: number;
  normalized: number;
}

export interface ShapSpectralBinnedBarDatum {
  center: number;
  importance: number;
  label: string;
}

export function downsampleShapSpectralPoints<T>(items: T[], maxItems: number): T[] {
  if (items.length <= maxItems) return items;

  const step = (items.length - 1) / (maxItems - 1);
  const result: T[] = [];

  for (let index = 0; index < maxItems; index += 1) {
    result.push(items[Math.round(index * step)]);
  }

  return result;
}

export function buildShapSpectralChartData(
  wavelengths: number[],
  shapValues: number[],
  spectrumValues: number[],
  maxDisplayPoints = SHAP_SPECTRAL_MAX_DISPLAY_POINTS,
): ShapSpectralChartPoint[] {
  const full = wavelengths.map((wavelength, index) => ({
    wavelength,
    importance: shapValues[index] ?? 0,
    absorbance: spectrumValues[index] ?? 0,
  }));

  return downsampleShapSpectralPoints(full, maxDisplayPoints);
}

export function buildShapSpectralHighlightRegions(
  binnedImportance: BinnedImportanceData,
  wavelengths: number[],
  shapValues: number[],
): ShapSpectralHighlightRegion[] {
  const binnedRegions = normalizeHighlightRegions(
    binnedImportance.bin_ranges
      .map((range, index) => {
        const value = binnedImportance.bin_values[index];
        if (!range || !Number.isFinite(value)) return null;

        return {
          start: range[0],
          end: range[1],
          score: Math.abs(value),
        };
      })
      .filter((region): region is ScoredSpectralRegion => region !== null),
  );

  if (binnedRegions.length > 0) return binnedRegions;

  const fallbackRanges = binnedImportance.bin_ranges.length > 0
    ? binnedImportance.bin_ranges
    : buildFallbackBinRanges(wavelengths, binnedImportance.bin_size, binnedImportance.bin_stride);

  return buildHighlightRegionsFromCurve(wavelengths, shapValues, fallbackRanges);
}

export function buildShapSpectralBinnedBarData(
  binnedImportance: BinnedImportanceData,
): ShapSpectralBinnedBarDatum[] {
  return binnedImportance.bin_centers.map((center, index) => ({
    center,
    importance: binnedImportance.bin_values[index],
    label: `${binnedImportance.bin_ranges[index][0].toFixed(0)}-${binnedImportance.bin_ranges[index][1].toFixed(0)}`,
  }));
}

export function hasShapSpectralAbsorbance(spectrumValues: number[]): boolean {
  return spectrumValues.some((value) => value !== 0);
}

export function getShapSpectralImportanceColor(normalized: number): string {
  if (normalized > 0.8) return 'rgba(13, 148, 136, 0.7)';
  if (normalized > 0.6) return 'rgba(20, 184, 166, 0.5)';
  if (normalized > 0.4) return 'rgba(45, 212, 191, 0.35)';
  if (normalized > 0.2) return 'rgba(94, 234, 212, 0.25)';
  return 'rgba(153, 246, 228, 0.15)';
}

interface ScoredSpectralRegion {
  start: number;
  end: number;
  score: number;
}

function normalizeHighlightRegions(regions: ScoredSpectralRegion[]): ShapSpectralHighlightRegion[] {
  if (!regions.length) return [];

  const maxScore = Math.max(...regions.map((region) => region.score), 1e-9);

  return regions
    .map((region) => ({
      start: region.start,
      end: region.end,
      normalized: region.score / maxScore,
    }))
    .filter((region) => region.normalized > 0.2);
}

function buildFallbackBinRanges(
  wavelengths: number[],
  binSize: number,
  binStride: number,
): Array<[number, number]> {
  if (!wavelengths.length) return [];

  const resolvedBinSize = Math.max(1, Math.min(binSize || wavelengths.length, wavelengths.length));
  const resolvedBinStride = Math.max(1, binStride || resolvedBinSize);
  const ranges: Array<[number, number]> = [];

  for (let startIndex = 0; startIndex < wavelengths.length; startIndex += resolvedBinStride) {
    const endIndex = Math.min(startIndex + resolvedBinSize - 1, wavelengths.length - 1);
    ranges.push([wavelengths[startIndex], wavelengths[endIndex]]);
    if (endIndex === wavelengths.length - 1) break;
  }

  return ranges;
}

function buildHighlightRegionsFromCurve(
  wavelengths: number[],
  shapValues: number[],
  ranges: Array<[number, number]>,
): ShapSpectralHighlightRegion[] {
  const scoredRegions = ranges
    .map((range) => {
      let total = 0;
      let count = 0;

      for (let index = 0; index < wavelengths.length; index += 1) {
        const wavelength = wavelengths[index];
        if (wavelength < range[0] || wavelength > range[1]) continue;

        total += Math.abs(shapValues[index] ?? 0);
        count += 1;
      }

      if (count === 0) return null;

      return {
        start: range[0],
        end: range[1],
        score: total / count,
      };
    })
    .filter((region): region is ScoredSpectralRegion => region !== null && region.score > 0);

  return normalizeHighlightRegions(scoredRegions);
}
