import type { ColorContext, GlobalColorConfig } from '@/lib/playground/colorConfig';
import { applySampling, type SamplingResult } from '@/lib/playground/sampling';
import type { DataSection, FoldsInfo } from '@/types/playground';
import {
  computeDerivative,
  filterWavelengths,
  type SamplingConfig,
  type SpectraDisplayMode,
  type SpectraViewMode,
  type WavelengthFocusConfig,
} from '@/lib/playground/spectraConfig';
export {
  chartYToSpectraValue,
  getSpectraRangeBounds,
  getSpectraRectBounds,
  selectSpectraRangeSamples,
  selectSpectraRectSamples,
} from '@/lib/playground/spectraChartSelection';
export type {
  SpectraRangeBounds,
  SpectraRectBounds,
} from '@/lib/playground/spectraChartSelection';

export interface SpectraMatrixView {
  spectra: number[][];
  wavelengths: number[];
}

export interface SpectraExportRow {
  wavelength: number;
  [sampleId: string]: number | string;
}

export interface SpectraDifferenceStats {
  meanAbsDiff: number;
  maxAbsDiff: number;
  rmse: number;
}

export interface SpectraDifferenceRegion {
  start: number;
  end: number;
}

export type SimilarSpectraCriterion = 'fold' | 'yRange' | 'outlier';

export const DEFAULT_MAX_FORCED_SELECTION = 50;

export interface BuildSpectraSamplingResultInput {
  totalSamples: number;
  sampling: SamplingConfig;
  displayMode: SpectraDisplayMode;
  selectedSamples: ReadonlySet<number>;
  spectra: number[][];
  yValues?: number[];
  maxForcedSelection?: number;
}

export interface BuildSpectraColorContextInput {
  colorContext?: ColorContext;
  yValues?: number[];
  folds?: FoldsInfo | null;
  metadata?: Record<string, unknown[]>;
  outlierSamples: Set<number>;
}

export interface SelectSimilarSpectraSamplesInput {
  sampleIndex: number;
  criterion: SimilarSpectraCriterion;
  folds?: Pick<FoldsInfo, 'fold_labels'> | null;
  yValues?: number[];
}

export function buildSpectraSamplingResult({
  totalSamples,
  sampling,
  displayMode,
  selectedSamples,
  spectra,
  yValues,
  maxForcedSelection = DEFAULT_MAX_FORCED_SELECTION,
}: BuildSpectraSamplingResultInput): SamplingResult {
  if (displayMode === 'selected_only' && selectedSamples.size > 0) {
    return {
      indices: Array.from(selectedSamples).filter(index => index < totalSamples),
      totalSamples,
      wasApplied: true,
      strategy: 'random',
    };
  }

  const baseSampling = applySampling(totalSamples, sampling, {
    yValues,
    spectra,
  });

  if (selectedSamples.size === 0) {
    return baseSampling;
  }

  const sampledSet = new Set(baseSampling.indices);
  const selectedIndices = Array.from(selectedSamples)
    .filter(index => index < totalSamples && !sampledSet.has(index))
    .slice(0, maxForcedSelection);

  if (selectedIndices.length === 0) {
    return baseSampling;
  }

  const mergedIndices = [...baseSampling.indices, ...selectedIndices].sort((left, right) => left - right);
  return {
    ...baseSampling,
    indices: mergedIndices,
  };
}

export function filterSpectraDisplayIndices(
  indices: number[],
  displayFilteredIndices?: Set<number>
): number[] {
  if (!displayFilteredIndices) {
    return indices;
  }
  return indices.filter(index => displayFilteredIndices.has(index));
}

export function getSpectraOutlierSamples(
  globalColorMode: GlobalColorConfig['mode'] | undefined,
  outlierIndices?: Set<number>
): Set<number> {
  if (globalColorMode !== 'outlier') {
    return new Set();
  }
  return outlierIndices ?? new Set();
}

export function buildSpectraColorContext({
  colorContext,
  yValues,
  folds,
  metadata,
  outlierSamples,
}: BuildSpectraColorContextInput): ColorContext {
  if (colorContext) {
    return colorContext;
  }

  const resolvedYValues = yValues ?? [];
  let trainIndices: Set<number> | undefined;
  let testIndices: Set<number> | undefined;

  if (folds?.folds && folds.folds.length === 1) {
    const firstFold = folds.folds[0];
    trainIndices = new Set<number>(firstFold.train_indices ?? []);
    testIndices = new Set<number>(firstFold.test_indices ?? []);
  }

  return {
    y: resolvedYValues,
    yMin: resolvedYValues.length > 0 ? Math.min(...resolvedYValues) : 0,
    yMax: resolvedYValues.length > 0 ? Math.max(...resolvedYValues) : 1,
    trainIndices,
    testIndices,
    foldLabels: folds?.fold_labels,
    foldKind: folds?.kind,
    foldCount: folds?.n_folds,
    metadata,
    outlierIndices: outlierSamples.size > 0 ? outlierSamples : undefined,
  };
}

export function selectSimilarSpectraSamples({
  sampleIndex,
  criterion,
  folds,
  yValues,
}: SelectSimilarSpectraSamplesInput): number[] {
  switch (criterion) {
    case 'fold': {
      const foldLabels = folds?.fold_labels;
      if (!foldLabels || foldLabels.length <= sampleIndex) {
        return [];
      }
      const targetFold = foldLabels[sampleIndex];
      return foldLabels
        .map((fold, index) => ({ fold, index }))
        .filter(({ fold }) => fold === targetFold)
        .map(({ index }) => index);
    }
    case 'yRange': {
      if (!yValues) {
        return [];
      }
      const targetY = yValues[sampleIndex];
      const tolerance = Math.abs(targetY) * 0.1;
      return yValues
        .map((value, index) => ({ value, index }))
        .filter(({ value }) => Math.abs(value - targetY) <= tolerance)
        .map(({ index }) => index);
    }
    case 'outlier': {
      if (!yValues) {
        return [];
      }
      const mean = yValues.reduce((sum, value) => sum + value, 0) / yValues.length;
      const std = Math.sqrt(yValues.reduce((sum, value) => sum + Math.pow(value - mean, 2), 0) / yValues.length);
      return yValues
        .map((value, index) => ({ value, index }))
        .filter(({ value }) => Math.abs(value - mean) > 2 * std)
        .map(({ index }) => index);
    }
  }
}

export function getSpectraBaseWavelengths(
  original: Pick<DataSection, 'wavelengths'>,
  processed: Pick<DataSection, 'wavelengths'>,
  viewMode: SpectraViewMode
): number[] {
  if (viewMode === 'original') {
    return original.wavelengths;
  }
  return processed.wavelengths.length > 0 ? processed.wavelengths : original.wavelengths;
}

export function getSpectraWavelengthRange(wavelengths: number[]): [number, number] {
  if (wavelengths.length === 0) {
    return [0, 1000];
  }
  return [wavelengths[0], wavelengths[wavelengths.length - 1]];
}

export function buildSpectraMatrixForView({
  original,
  processed,
  viewMode,
  showAbsoluteDifference,
}: {
  original: Pick<DataSection, 'spectra' | 'wavelengths'>;
  processed: Pick<DataSection, 'spectra' | 'wavelengths'>;
  viewMode: SpectraViewMode;
  showAbsoluteDifference: boolean;
}): SpectraMatrixView {
  switch (viewMode) {
    case 'original':
      return { spectra: original.spectra, wavelengths: original.wavelengths };
    case 'processed':
    case 'both':
      return { spectra: processed.spectra, wavelengths: processed.wavelengths };
    case 'difference': {
      if (processed.spectra.length !== original.spectra.length) {
        return { spectra: processed.spectra, wavelengths: processed.wavelengths };
      }
      const diffSpectra = processed.spectra.map((processedSpectrum, idx) => {
        const originalSpectrum = original.spectra[idx];
        if (!originalSpectrum || processedSpectrum.length !== originalSpectrum.length) {
          return processedSpectrum;
        }
        return processedSpectrum.map((value, valueIdx) => {
          const diff = value - originalSpectrum[valueIdx];
          return showAbsoluteDifference ? Math.abs(diff) : diff;
        });
      });
      return { spectra: diffSpectra, wavelengths: processed.wavelengths };
    }
  }
}

export function applySpectraWavelengthFocus(
  data: SpectraMatrixView,
  wavelengthFocus: WavelengthFocusConfig
): SpectraMatrixView {
  let { wavelengths, spectra } = data;

  if (wavelengthFocus.range || wavelengthFocus.edgeMask.enabled) {
    const filtered = filterWavelengths(wavelengths, spectra, wavelengthFocus);
    wavelengths = filtered.wavelengths;
    spectra = filtered.spectra;
  }

  if (wavelengthFocus.derivative > 0) {
    spectra = spectra.map((spectrum) =>
      computeDerivative(spectrum, wavelengths, wavelengthFocus.derivative as 1 | 2)
    );
  }

  return { wavelengths, spectra };
}

export function buildFocusedSpectraData({
  original,
  processed,
  viewMode,
  wavelengthFocus,
  showAbsoluteDifference,
}: {
  original: Pick<DataSection, 'spectra' | 'wavelengths'>;
  processed: Pick<DataSection, 'spectra' | 'wavelengths'>;
  viewMode: SpectraViewMode;
  wavelengthFocus: WavelengthFocusConfig;
  showAbsoluteDifference: boolean;
}): SpectraMatrixView {
  return applySpectraWavelengthFocus(
    buildSpectraMatrixForView({
      original,
      processed,
      viewMode,
      showAbsoluteDifference,
    }),
    wavelengthFocus
  );
}

export function buildSpectraDifferenceStats(
  originalSpectra: number[][],
  processedSpectra: number[][]
): SpectraDifferenceStats | null {
  if (processedSpectra.length !== originalSpectra.length) {
    return null;
  }

  let sumAbs = 0;
  let sumSq = 0;
  let maxAbs = 0;
  let count = 0;

  processedSpectra.forEach((processedSpectrum, sampleIdx) => {
    const originalSpectrum = originalSpectra[sampleIdx];
    if (!originalSpectrum || processedSpectrum.length !== originalSpectrum.length) {
      return;
    }

    processedSpectrum.forEach((value, valueIdx) => {
      const diff = value - originalSpectrum[valueIdx];
      const absDiff = Math.abs(diff);
      sumAbs += absDiff;
      sumSq += diff * diff;
      maxAbs = Math.max(maxAbs, absDiff);
      count++;
    });
  });

  if (count === 0) {
    return null;
  }

  return {
    meanAbsDiff: sumAbs / count,
    maxAbsDiff: maxAbs,
    rmse: Math.sqrt(sumSq / count),
  };
}

export function findHighSpectraDifferenceRegions({
  wavelengths,
  differenceSpectra,
  minRegionWavelengths = 3,
  thresholdStdMultiplier = 1.5,
}: {
  wavelengths: number[];
  differenceSpectra: number[][];
  minRegionWavelengths?: number;
  thresholdStdMultiplier?: number;
}): SpectraDifferenceRegion[] {
  if (wavelengths.length === 0 || differenceSpectra.length === 0) {
    return [];
  }

  const meanAbsPerWavelength = wavelengths.map((_, wavelengthIdx) => {
    let sum = 0;
    let count = 0;
    differenceSpectra.forEach(spectrum => {
      if (spectrum[wavelengthIdx] !== undefined) {
        sum += Math.abs(spectrum[wavelengthIdx]);
        count++;
      }
    });
    return count > 0 ? sum / count : 0;
  });

  const overallMean = meanAbsPerWavelength.reduce((sum, value) => sum + value, 0) / meanAbsPerWavelength.length;
  const overallStd = Math.sqrt(
    meanAbsPerWavelength.reduce((sum, value) => sum + Math.pow(value - overallMean, 2), 0) / meanAbsPerWavelength.length
  );
  const threshold = overallMean + thresholdStdMultiplier * overallStd;

  const regions: SpectraDifferenceRegion[] = [];
  let inRegion = false;
  let regionStart = 0;

  meanAbsPerWavelength.forEach((value, idx) => {
    if (value > threshold) {
      if (!inRegion) {
        inRegion = true;
        regionStart = idx;
      }
      return;
    }

    if (inRegion) {
      inRegion = false;
      if (idx - regionStart >= minRegionWavelengths) {
        regions.push({
          start: wavelengths[regionStart],
          end: wavelengths[idx - 1],
        });
      }
    }
  });

  if (inRegion && wavelengths.length - regionStart >= minRegionWavelengths) {
    regions.push({
      start: wavelengths[regionStart],
      end: wavelengths[wavelengths.length - 1],
    });
  }

  return regions;
}

export function buildSpectraYAxisDomain(
  spectra: number[][],
  paddingRatio = 0.05
): [number, number] {
  if (spectra.length === 0) return [0, 1];

  let min = Infinity;
  let max = -Infinity;
  for (const spectrum of spectra) {
    for (const value of spectrum) {
      if (!Number.isFinite(value)) continue;
      if (value < min) min = value;
      if (value > max) max = value;
    }
  }

  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return [0, 1];
  }

  const range = max - min;
  const padding = range > 0 ? range * paddingRatio : Math.max(Math.abs(min) * paddingRatio, paddingRatio);
  return [min - padding, max + padding];
}

export function zoomSpectraBrushDomain({
  wavelengthRange,
  brushDomain,
  mouseXNorm,
  deltaY,
}: {
  wavelengthRange: [number, number];
  brushDomain: [number, number] | null;
  mouseXNorm: number;
  deltaY: number;
}): [number, number] | null {
  const fullRange = wavelengthRange[1] - wavelengthRange[0];
  const currentDomain = brushDomain ?? wavelengthRange;
  const currentRange = currentDomain[1] - currentDomain[0];
  const clampedMouseX = Math.max(0, Math.min(1, mouseXNorm));
  const zoomFactor = deltaY > 0 ? 1.15 : 0.87;
  const newRange = Math.max(fullRange * 0.05, Math.min(fullRange, currentRange * zoomFactor));

  if (newRange >= fullRange * 0.99) {
    return null;
  }

  const mouseXData = currentDomain[0] + clampedMouseX * currentRange;
  const leftRatio = (mouseXData - currentDomain[0]) / currentRange;
  let newMin = mouseXData - leftRatio * newRange;
  let newMax = mouseXData + (1 - leftRatio) * newRange;

  if (newMin < wavelengthRange[0]) {
    newMin = wavelengthRange[0];
    newMax = wavelengthRange[0] + newRange;
  }
  if (newMax > wavelengthRange[1]) {
    newMax = wavelengthRange[1];
    newMin = wavelengthRange[1] - newRange;
  }

  return [newMin, newMax];
}

export function buildSpectraExportRows({
  wavelengths,
  spectra,
  sampleIndices,
  sampleIds,
}: {
  wavelengths: number[];
  spectra: number[][];
  sampleIndices: number[];
  sampleIds?: string[];
}): SpectraExportRow[] {
  return wavelengths.map((wavelength, wavelengthIndex) => {
    const row: SpectraExportRow = { wavelength };
    sampleIndices.forEach(sampleIndex => {
      const id = sampleIds?.[sampleIndex] ?? `sample_${sampleIndex}`;
      if (spectra[sampleIndex]) {
        row[id] = spectra[sampleIndex][wavelengthIndex];
      }
    });
    return row;
  });
}
