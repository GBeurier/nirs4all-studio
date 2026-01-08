/**
 * SpectraAggregation - Aggregated spectra rendering utilities
 *
 * Phase 2 Implementation: Enhanced Spectra Chart
 *
 * Provides components and utilities for rendering aggregated
 * spectral statistics (mean±std, median+quantiles, min/max, density).
 */

import { useMemo, type ReactElement } from 'react';
import { Area, Line } from 'recharts';
import { DEFAULT_QUANTILE_BANDS, type AggregationMode, type AggregationConfig, type QuantileBand } from '@/lib/playground/spectraConfig';
import { STATISTICS_COLORS, CHART_THEME, ANIMATION_CONFIG } from './chartConfig';

// ============= Types =============

/**
 * Computed quantile band data
 */
export interface ComputedQuantileBand {
  /** Lower quantile values per wavelength */
  lower: number[];
  /** Upper quantile values per wavelength */
  upper: number[];
  /** Original band configuration */
  config: QuantileBand;
}

/**
 * Aggregated statistics for a set of spectra
 */
export interface AggregatedStats {
  /** Per-wavelength mean */
  mean: number[];
  /** Per-wavelength standard deviation */
  std: number[];
  /** Per-wavelength median */
  median: number[];
  /** Per-wavelength min */
  min: number[];
  /** Per-wavelength max */
  max: number[];
  /** Lower quantile (e.g., p5) - deprecated, use quantileBands */
  quantileLower: number[];
  /** Upper quantile (e.g., p95) - deprecated, use quantileBands */
  quantileUpper: number[];
  /** Multiple quantile bands with computed values */
  quantileBands?: ComputedQuantileBand[];
  /** Sample count */
  n: number;
}

/**
 * Props for aggregation chart elements
 */
export interface AggregationElementsProps {
  /** Aggregation mode */
  mode: AggregationMode;
  /** Whether to show original stats (for 'both' view mode) */
  showOriginal?: boolean;
  /** Key prefix for React keys */
  keyPrefix?: string;
}

// ============= Computation Functions =============

/**
 * Compute per-wavelength statistics from spectra
 */
export function computeAggregatedStats(
  spectra: number[][],
  quantileRange: [number, number] = [0.05, 0.95],
  quantileBands: QuantileBand[] = DEFAULT_QUANTILE_BANDS
): AggregatedStats {
  if (!spectra || spectra.length === 0 || !spectra[0]) {
    return {
      mean: [],
      std: [],
      median: [],
      min: [],
      max: [],
      quantileLower: [],
      quantileUpper: [],
      quantileBands: [],
      n: 0,
    };
  }

  const n = spectra.length;
  const nWavelengths = spectra[0].length;

  const mean = new Array<number>(nWavelengths).fill(0);
  const std = new Array<number>(nWavelengths).fill(0);
  const median = new Array<number>(nWavelengths).fill(0);
  const min = new Array<number>(nWavelengths).fill(Infinity);
  const max = new Array<number>(nWavelengths).fill(-Infinity);
  const quantileLower = new Array<number>(nWavelengths).fill(0);
  const quantileUpper = new Array<number>(nWavelengths).fill(0);

  // Initialize computed quantile bands
  const computedBands: ComputedQuantileBand[] = quantileBands.map(band => ({
    lower: new Array<number>(nWavelengths).fill(0),
    upper: new Array<number>(nWavelengths).fill(0),
    config: band,
  }));

  // For each wavelength, compute statistics
  for (let w = 0; w < nWavelengths; w++) {
    const column: number[] = [];

    for (let s = 0; s < n; s++) {
      const value = spectra[s]?.[w];
      if (value !== undefined && !isNaN(value)) {
        column.push(value);
        min[w] = Math.min(min[w], value);
        max[w] = Math.max(max[w], value);
      }
    }

    if (column.length === 0) {
      min[w] = 0;
      max[w] = 0;
      continue;
    }

    // Mean
    const sum = column.reduce((a, b) => a + b, 0);
    mean[w] = sum / column.length;

    // Std
    const squaredDiffs = column.map(v => (v - mean[w]) ** 2);
    std[w] = Math.sqrt(squaredDiffs.reduce((a, b) => a + b, 0) / column.length);

    // Sort for median and quantiles
    column.sort((a, b) => a - b);

    // Median
    const mid = Math.floor(column.length / 2);
    median[w] = column.length % 2 === 0
      ? (column[mid - 1] + column[mid]) / 2
      : column[mid];

    // Legacy quantiles (for backward compatibility)
    const lowerIdx = Math.floor(column.length * quantileRange[0]);
    const upperIdx = Math.floor(column.length * quantileRange[1]);
    quantileLower[w] = column[lowerIdx] ?? min[w];
    quantileUpper[w] = column[upperIdx] ?? max[w];

    // Compute all quantile bands
    for (const band of computedBands) {
      const bandLowerIdx = Math.floor(column.length * band.config.lower);
      const bandUpperIdx = Math.floor(column.length * band.config.upper);
      band.lower[w] = column[bandLowerIdx] ?? min[w];
      band.upper[w] = column[bandUpperIdx] ?? max[w];
    }
  }

  return {
    mean,
    std,
    median,
    min,
    max,
    quantileLower,
    quantileUpper,
    quantileBands: computedBands,
    n,
  };
}

/**
 * Compute grouped statistics by metadata value
 */
export function computeGroupedStats(
  spectra: number[][],
  groupLabels: (string | number)[],
  quantileRange: [number, number] = [0.05, 0.95]
): Map<string | number, AggregatedStats> {
  const groups = new Map<string | number, number[][]>();

  // Group spectra by label
  spectra.forEach((spectrum, idx) => {
    const label = groupLabels[idx];
    if (label === undefined) return;

    if (!groups.has(label)) {
      groups.set(label, []);
    }
    groups.get(label)!.push(spectrum);
  });

  // Compute stats for each group
  const result = new Map<string | number, AggregatedStats>();
  groups.forEach((groupSpectra, label) => {
    result.set(label, computeAggregatedStats(groupSpectra, quantileRange));
  });

  return result;
}

/**
 * Build chart data point with aggregation fields
 */
export function buildAggregationDataPoint(
  wavelength: number,
  wIdx: number,
  stats: AggregatedStats,
  mode: AggregationMode,
  prefix: string = ''
): Record<string, unknown> {
  const point: Record<string, unknown> = { wavelength };
  const p = prefix;

  switch (mode) {
    case 'mean_std':
      point[`${p}mean`] = stats.mean[wIdx];
      point[`${p}stdRange`] = [
        stats.mean[wIdx] - stats.std[wIdx],
        stats.mean[wIdx] + stats.std[wIdx],
      ];
      break;

    case 'median_quantiles':
      point[`${p}median`] = stats.median[wIdx];
      // Legacy single quantile range
      point[`${p}quantileRange`] = [
        stats.quantileLower[wIdx],
        stats.quantileUpper[wIdx],
      ];
      // Multiple quantile bands
      if (stats.quantileBands) {
        stats.quantileBands.forEach((band, bandIdx) => {
          point[`${p}qBand${bandIdx}`] = [
            band.lower[wIdx],
            band.upper[wIdx],
          ];
        });
      }
      break;

    case 'minmax':
      point[`${p}minmaxRange`] = [stats.min[wIdx], stats.max[wIdx]];
      // Also include mean for reference
      point[`${p}mean`] = stats.mean[wIdx];
      break;

    case 'density':
      // For density map, include all values as a distribution
      point[`${p}mean`] = stats.mean[wIdx];
      point[`${p}std`] = stats.std[wIdx];
      break;

    default:
      break;
  }

  return point;
}

// ============= Recharts Components =============

/**
 * Get Recharts elements for the specified aggregation mode
 *
 * Returns an array of Area and Line components to render
 */
export function getAggregationElements(
  mode: AggregationMode,
  prefix: string = '',
  showOriginal: boolean = false,
  quantileBandCount: number = DEFAULT_QUANTILE_BANDS.length,
): ReactElement[] {
  const elements: ReactElement[] = [];
  const p = prefix;
  const origP = 'orig';

  switch (mode) {
    case 'mean_std':
      // Std band
      elements.push(
        <Area
          key={`${p}stdBand`}
          type="monotone"
          dataKey={`${p}stdRange`}
          stroke="none"
          fill={STATISTICS_COLORS.std}
          fillOpacity={CHART_THEME.statisticsBandOpacity}
          {...ANIMATION_CONFIG}
          tooltipType="none"
        />
      );
      // Mean line
      elements.push(
        <Line
          key={`${p}meanLine`}
          type="monotone"
          dataKey={`${p}mean`}
          stroke={STATISTICS_COLORS.mean}
          strokeWidth={2}
          dot={false}
          {...ANIMATION_CONFIG}
        />
      );

      // Original stats if showing both
      if (showOriginal) {
        elements.push(
          <Area
            key={`${origP}stdBand`}
            type="monotone"
            dataKey={`${origP}StdRange`}
            stroke="none"
            fill={STATISTICS_COLORS.original}
            fillOpacity={CHART_THEME.statisticsBandOpacity * 0.6}
            {...ANIMATION_CONFIG}
            tooltipType="none"
          />
        );
        elements.push(
          <Line
            key={`${origP}meanLine`}
            type="monotone"
            dataKey={`${origP}Mean`}
            stroke={STATISTICS_COLORS.original}
            strokeWidth={2}
            strokeDasharray="4 2"
            dot={false}
            {...ANIMATION_CONFIG}
          />
        );
      }
      break;

    case 'median_quantiles':
      // Render multiple quantile bands with graduated opacity (outer bands first)
      for (let bandIdx = 0; bandIdx < quantileBandCount; bandIdx++) {
        const bandConfig = DEFAULT_QUANTILE_BANDS[bandIdx];
        if (bandConfig) {
          elements.push(
            <Area
              key={`${p}qBand${bandIdx}`}
              type="monotone"
              dataKey={`${p}qBand${bandIdx}`}
              stroke="none"
              fill={STATISTICS_COLORS.p5p95}
              fillOpacity={bandConfig.opacity}
              {...ANIMATION_CONFIG}
              tooltipType="none"
            />
          );
        }
      }
      // Median line
      elements.push(
        <Line
          key={`${p}medianLine`}
          type="monotone"
          dataKey={`${p}median`}
          stroke={STATISTICS_COLORS.median}
          strokeWidth={2}
          dot={false}
          {...ANIMATION_CONFIG}
        />
      );

      if (showOriginal) {
        // Render original quantile bands
        for (let bandIdx = 0; bandIdx < quantileBandCount; bandIdx++) {
          const bandConfig = DEFAULT_QUANTILE_BANDS[bandIdx];
          if (bandConfig) {
            elements.push(
              <Area
                key={`${origP}qBand${bandIdx}`}
                type="monotone"
                dataKey={`${origP}qBand${bandIdx}`}
                stroke="none"
                fill={STATISTICS_COLORS.original}
                fillOpacity={bandConfig.opacity * 0.6}
                {...ANIMATION_CONFIG}
                tooltipType="none"
              />
            );
          }
        }
        elements.push(
          <Line
            key={`${origP}medianLine`}
            type="monotone"
            dataKey={`${origP}Median`}
            stroke={STATISTICS_COLORS.original}
            strokeWidth={2}
            strokeDasharray="4 2"
            dot={false}
            {...ANIMATION_CONFIG}
          />
        );
      }
      break;

    case 'minmax':
      // Min/max envelope
      elements.push(
        <Area
          key={`${p}minmaxBand`}
          type="monotone"
          dataKey={`${p}minmaxRange`}
          stroke="none"
          fill={STATISTICS_COLORS.minMax}
          fillOpacity={CHART_THEME.statisticsBandOpacity * 0.5}
          {...ANIMATION_CONFIG}
          tooltipType="none"
        />
      );
      // Mean line for reference
      elements.push(
        <Line
          key={`${p}meanLine`}
          type="monotone"
          dataKey={`${p}mean`}
          stroke={STATISTICS_COLORS.mean}
          strokeWidth={2}
          dot={false}
          {...ANIMATION_CONFIG}
        />
      );
      break;

    case 'density':
      // Density mode uses a different rendering approach (handled separately)
      // For now, show mean + std band as fallback
      elements.push(
        <Area
          key={`${p}densityBand`}
          type="monotone"
          dataKey={`${p}stdRange`}
          stroke="none"
          fill={STATISTICS_COLORS.std}
          fillOpacity={CHART_THEME.statisticsBandOpacity * 1.5}
          {...ANIMATION_CONFIG}
          tooltipType="none"
        />
      );
      elements.push(
        <Line
          key={`${p}densityMean`}
          type="monotone"
          dataKey={`${p}mean`}
          stroke={STATISTICS_COLORS.mean}
          strokeWidth={2}
          dot={false}
          {...ANIMATION_CONFIG}
        />
      );
      break;

    default:
      break;
  }

  return elements;
}

// ============= Legend Items =============

/**
 * Get legend items for aggregation mode
 */
export function getAggregationLegendItems(
  mode: AggregationMode,
  showOriginal: boolean = false,
  quantileBands: QuantileBand[] = DEFAULT_QUANTILE_BANDS
): Array<{ label: string; color: string; dashed?: boolean; isArea?: boolean }> {
  const items: Array<{ label: string; color: string; dashed?: boolean; isArea?: boolean }> = [];

  switch (mode) {
    case 'mean_std':
      items.push({ label: 'Mean', color: STATISTICS_COLORS.mean });
      items.push({ label: '±1 Std', color: STATISTICS_COLORS.std, isArea: true });
      break;

    case 'median_quantiles':
      items.push({ label: 'Median', color: STATISTICS_COLORS.median });
      // Show legend for multiple quantile bands
      if (quantileBands.length > 0) {
        const labels = quantileBands.map(b =>
          `p${Math.round(b.lower * 100)}–p${Math.round(b.upper * 100)}`
        ).join(', ');
        items.push({ label: labels, color: STATISTICS_COLORS.p5p95, isArea: true });
      } else {
        items.push({ label: 'p5–p95', color: STATISTICS_COLORS.p5p95, isArea: true });
      }
      break;

    case 'minmax':
      items.push({ label: 'Mean', color: STATISTICS_COLORS.mean });
      items.push({ label: 'Min/Max', color: STATISTICS_COLORS.minMax, isArea: true });
      break;

    case 'density':
      items.push({ label: 'Mean', color: STATISTICS_COLORS.mean });
      items.push({ label: 'Density', color: STATISTICS_COLORS.std, isArea: true });
      break;

    default:
      break;
  }

  if (showOriginal) {
    items.push({ label: 'Original', color: STATISTICS_COLORS.original, dashed: true });
  }

  return items;
}

// ============= Hooks =============

/**
 * Hook to compute and memoize aggregated stats
 */
export function useAggregatedStats(
  spectra: number[][] | undefined,
  enabled: boolean = true,
  quantileRange: [number, number] = [0.05, 0.95]
): AggregatedStats | null {
  return useMemo(() => {
    if (!enabled || !spectra || spectra.length === 0) {
      return null;
    }
    return computeAggregatedStats(spectra, quantileRange);
  }, [spectra, enabled, quantileRange[0], quantileRange[1]]);
}

/**
 * Hook to compute grouped stats with memoization
 */
export function useGroupedStats(
  spectra: number[][] | undefined,
  groupLabels: (string | number)[] | undefined,
  enabled: boolean = true,
  quantileRange: [number, number] = [0.05, 0.95]
): Map<string | number, AggregatedStats> | null {
  return useMemo(() => {
    if (!enabled || !spectra || !groupLabels || spectra.length === 0) {
      return null;
    }
    return computeGroupedStats(spectra, groupLabels, quantileRange);
  }, [spectra, groupLabels, enabled, quantileRange[0], quantileRange[1]]);
}

export default {
  computeAggregatedStats,
  computeGroupedStats,
  buildAggregationDataPoint,
  getAggregationElements,
  getAggregationLegendItems,
  useAggregatedStats,
  useGroupedStats,
};
