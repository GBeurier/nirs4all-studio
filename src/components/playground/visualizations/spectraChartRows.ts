import type { DataSection } from '@/types/playground';
import type {
  AggregationMode,
  SpectraDisplayMode,
  SpectraViewMode,
} from '@/lib/playground/spectraConfig';
import type { SpectraMatrixView } from '@/lib/playground/spectraChartData';
import {
  buildAggregationDataPoint,
  type AggregatedStats,
} from './SpectraAggregation';

export interface SpectraChartRowsInput {
  isWebGLMode: boolean;
  focusedData: SpectraMatrixView;
  focusedOriginalData: SpectraMatrixView;
  displayIndices: number[];
  aggregationMode: AggregationMode;
  showIndividualLines: boolean;
  viewMode: SpectraViewMode;
  displayMode: SpectraDisplayMode;
  aggregatedStats: AggregatedStats | null;
  originalAggregatedStats: AggregatedStats | null;
  groupedStats: Map<string | number, AggregatedStats> | null;
  referenceDataset?: Pick<DataSection, 'spectra'> | null;
}

export function buildSpectraChartRows({
  isWebGLMode,
  focusedData,
  focusedOriginalData,
  displayIndices,
  aggregationMode,
  showIndividualLines,
  viewMode,
  displayMode,
  aggregatedStats,
  originalAggregatedStats,
  groupedStats,
  referenceDataset,
}: SpectraChartRowsInput): Array<Record<string, unknown>> {
  if (isWebGLMode) {
    return [];
  }

  const { wavelengths, spectra } = focusedData;
  const showOriginalLines = showIndividualLines && (viewMode === 'both' || viewMode === 'original');
  const showProcessedLines = showIndividualLines && (viewMode === 'both' || viewMode === 'processed');

  return wavelengths.map((wavelength, wavelengthIndex) => {
    const point: Record<string, unknown> = { wavelength };

    if (showProcessedLines || viewMode === 'difference') {
      displayIndices.forEach((sampleIndex, displayIndex) => {
        if (spectra[sampleIndex]) {
          point[`p${displayIndex}`] = spectra[sampleIndex][wavelengthIndex];
        }
      });
    }

    if (showOriginalLines) {
      displayIndices.forEach((sampleIndex, displayIndex) => {
        const originalSpectrum = focusedOriginalData.spectra[sampleIndex];
        const originalValue = originalSpectrum?.[wavelengthIndex];
        if (originalValue !== undefined) {
          point[`o${displayIndex}`] = originalValue;
        }
      });
    }

    if (referenceDataset?.spectra && referenceDataset.spectra.length > 0) {
      const maxReferenceSamples = Math.min(referenceDataset.spectra.length, displayIndices.length);
      for (let referenceIndex = 0; referenceIndex < maxReferenceSamples; referenceIndex++) {
        const value = referenceDataset.spectra[referenceIndex]?.[wavelengthIndex];
        if (value !== undefined) {
          point[`r${referenceIndex}`] = value;
        }
      }
    }

    if (aggregatedStats && aggregationMode !== 'none' && displayMode !== 'grouped') {
      Object.assign(
        point,
        buildAggregationDataPoint(wavelength, wavelengthIndex, aggregatedStats, aggregationMode, '')
      );

      if (originalAggregatedStats && viewMode === 'both') {
        Object.assign(
          point,
          buildAggregationDataPoint(wavelength, wavelengthIndex, originalAggregatedStats, aggregationMode, 'orig')
        );
      }
    }

    if (groupedStats && displayMode === 'grouped') {
      groupedStats.forEach((stats, groupKey) => {
        const prefix = `grp_${groupKey}`;
        point[`${prefix}_mean`] = stats.mean[wavelengthIndex];
        point[`${prefix}_std_low`] = stats.mean[wavelengthIndex] - stats.std[wavelengthIndex];
        point[`${prefix}_std_high`] = stats.mean[wavelengthIndex] + stats.std[wavelengthIndex];
        if (stats.quantileLower) point[`${prefix}_q_low`] = stats.quantileLower[wavelengthIndex];
        if (stats.quantileUpper) point[`${prefix}_q_high`] = stats.quantileUpper[wavelengthIndex];
        if (stats.median) point[`${prefix}_median`] = stats.median[wavelengthIndex];
        point[`${prefix}_min`] = stats.min[wavelengthIndex];
        point[`${prefix}_max`] = stats.max[wavelengthIndex];
      });
    }

    return point;
  });
}
