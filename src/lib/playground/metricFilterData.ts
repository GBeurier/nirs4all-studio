import type { MetricFilter, MetricsResult } from '@/types/playground';
import type { PlaygroundChartMetricObservationCapability } from '@/lib/playground/chartInputs';

export const METRIC_DISPLAY_NAMES: Record<string, string> = {
  global_min: 'Global Min',
  global_max: 'Global Max',
  dynamic_range: 'Dynamic Range',
  mean_intensity: 'Mean Intensity',
  l2_norm: 'L2 Norm',
  rms_energy: 'RMS Energy',
  auc: 'AUC',
  abs_auc: 'Absolute AUC',
  baseline_slope: 'Baseline Slope',
  baseline_offset: 'Baseline Offset',
  peak_count: 'Peak Count',
  peak_prominence_max: 'Max Peak Prominence',
  hf_variance: 'HF Variance',
  snr_estimate: 'SNR Estimate',
  smoothness: 'Smoothness',
  nan_count: 'NaN Count',
  inf_count: 'Inf Count',
  saturation_count: 'Saturation Count',
  zero_count: 'Zero Count',
  hotelling_t2: "Hotelling's T²",
  q_residual: 'Q-Residual',
  leverage: 'Leverage',
  distance_to_centroid: 'Distance to Center',
  lof_score: 'LOF Score',
};

export const METRIC_CATEGORY_BY_METRIC: Record<string, string> = {
  global_min: 'amplitude',
  global_max: 'amplitude',
  dynamic_range: 'amplitude',
  mean_intensity: 'amplitude',
  l2_norm: 'energy',
  rms_energy: 'energy',
  auc: 'energy',
  abs_auc: 'energy',
  baseline_slope: 'shape',
  baseline_offset: 'shape',
  peak_count: 'shape',
  peak_prominence_max: 'shape',
  hf_variance: 'noise',
  snr_estimate: 'noise',
  smoothness: 'noise',
  nan_count: 'quality',
  inf_count: 'quality',
  saturation_count: 'quality',
  zero_count: 'quality',
  hotelling_t2: 'chemometric',
  q_residual: 'chemometric',
  leverage: 'chemometric',
  distance_to_centroid: 'chemometric',
  lof_score: 'chemometric',
};

export interface MetricFilterPreset {
  id: string;
  name: string;
  description: string;
  getFilters: (metrics: MetricsResult) => MetricFilter[];
}

export const METRIC_FILTER_PRESETS: MetricFilterPreset[] = [
  {
    id: 'typical',
    name: 'Typical Samples',
    description: 'Keep samples within p5-p95 range for key metrics',
    getFilters: (metrics) => {
      const filters: MetricFilter[] = [];
      const keyMetrics = ['l2_norm', 'snr_estimate', 'hf_variance'];

      for (const metric of keyMetrics) {
        const stats = metrics.statistics[metric];
        if (stats) {
          filters.push({
            metric,
            min: stats.p5,
            max: stats.p95,
            invert: false,
          });
        }
      }
      return filters;
    },
  },
  {
    id: 'outliers',
    name: 'Outliers Only',
    description: 'Show samples outside p5-p95 range',
    getFilters: (metrics) => {
      const stats = metrics.statistics.distance_to_centroid || metrics.statistics.l2_norm;
      if (!stats) return [];
      return [{
        metric: metrics.statistics.distance_to_centroid ? 'distance_to_centroid' : 'l2_norm',
        min: stats.p95,
        max: undefined,
        invert: false,
      }];
    },
  },
  {
    id: 'high_quality',
    name: 'High Quality',
    description: 'High SNR, low noise, no missing values',
    getFilters: (metrics) => {
      const filters: MetricFilter[] = [];

      const snrStats = metrics.statistics.snr_estimate;
      if (snrStats) {
        filters.push({
          metric: 'snr_estimate',
          min: snrStats.p50,
          max: undefined,
          invert: false,
        });
      }

      const nanStats = metrics.statistics.nan_count;
      if (nanStats) {
        filters.push({
          metric: 'nan_count',
          min: undefined,
          max: 0,
          invert: false,
        });
      }

      return filters;
    },
  },
];

export function getMetricDisplayName(metric: string): string {
  return METRIC_DISPLAY_NAMES[metric] || metric;
}

export function getMetricCategory(metric: string): string {
  return METRIC_CATEGORY_BY_METRIC[metric] || 'other';
}

function resolveMetricCategoryKeys(
  metrics: MetricsResult | null | undefined,
  metricCapability?: PlaygroundChartMetricObservationCapability | null,
): string[] {
  const computedMetricKeys = metrics?.computed_metrics ?? [];
  if (!metricCapability?.hasMetricObservations) {
    return computedMetricKeys;
  }

  const metricKeys: string[] = [];
  const seenMetricKeys = new Set<string>();
  for (const metric of [...metricCapability.metricKeys, ...computedMetricKeys]) {
    if (seenMetricKeys.has(metric)) continue;
    seenMetricKeys.add(metric);
    metricKeys.push(metric);
  }
  return metricKeys;
}

export function groupMetricsByCategory(
  metrics: MetricsResult | null | undefined,
  metricCapability?: PlaygroundChartMetricObservationCapability | null,
): Record<string, string[]> {
  const metricKeys = resolveMetricCategoryKeys(metrics, metricCapability);
  if (metricKeys.length === 0) return {};

  const groups: Record<string, string[]> = {};
  for (const metric of metricKeys) {
    const category = getMetricCategory(metric);
    if (!groups[category]) groups[category] = [];
    groups[category].push(metric);
  }
  return groups;
}

export function countMetricFilterPasses(values: number[], filter?: MetricFilter): number {
  if (!filter) return values.length;

  let passCount = 0;
  for (const value of values) {
    const inRange =
      (filter.min === undefined || value >= filter.min) &&
      (filter.max === undefined || value <= filter.max);

    if (filter.invert ? !inRange : inRange) passCount++;
  }
  return passCount;
}

export function countFilteredMetricSamples(
  metrics: MetricsResult | null | undefined,
  activeFilters: MetricFilter[],
  totalSamples: number,
): number {
  if (!metrics?.values || activeFilters.length === 0) return totalSamples;

  const sampleCount = Object.values(metrics.values)[0]?.length ?? totalSamples;
  let passCount = 0;

  for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex++) {
    let passes = true;

    for (const filter of activeFilters) {
      const values = metrics.values[filter.metric];
      if (!values) continue;

      const value = values[sampleIndex];
      const inRange =
        (filter.min === undefined || value >= filter.min) &&
        (filter.max === undefined || value <= filter.max);

      if (filter.invert ? inRange : !inRange) {
        passes = false;
        break;
      }
    }

    if (passes) passCount++;
  }

  return passCount;
}

export function replaceMetricFilter(
  activeFilters: MetricFilter[],
  metric: string,
  filter: MetricFilter | undefined,
): MetricFilter[] {
  const nextFilters = activeFilters.filter((candidate) => candidate.metric !== metric);
  if (filter) nextFilters.push(filter);
  return nextFilters;
}

export function countActiveMetricFiltersByCategory(
  activeFilters: MetricFilter[],
  category: string,
): number {
  return activeFilters.filter((filter) => getMetricCategory(filter.metric) === category).length;
}

export function getMetricPresetFilters(
  presetId: string,
  metrics: MetricsResult | null | undefined,
): MetricFilter[] | null {
  if (!metrics) return null;
  const preset = METRIC_FILTER_PRESETS.find((candidate) => candidate.id === presetId);
  return preset ? preset.getFilters(metrics) : null;
}
