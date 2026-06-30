import type { DiffQuantile } from '@/lib/playground/spectraConfig';

export interface ComputedRepetitionDistances {
  distances: number[];
  quantiles: Record<number, number>;
  mean: number;
  max: number;
}

export interface RepetitionsPlotStatistics {
  mean_distance?: number;
  max_distance?: number;
  std_distance?: number;
  p95_distance?: number;
}

export interface RepetitionQuantileValue {
  quantile: DiffQuantile;
  value: number;
}

export function normalizeComputedRepetitionDistances(
  distances: number[],
  quantiles: Record<number, number>
): ComputedRepetitionDistances | null {
  const validDistances = distances.map(distance => {
    if (!Number.isFinite(distance) || distance < 0) return 0;
    return distance;
  });

  const hasValidData = validDistances.some(distance => distance > 0);
  if (!hasValidData) {
    return null;
  }

  return {
    distances: validDistances,
    quantiles,
    mean: validDistances.reduce((sum, distance) => sum + distance, 0) / validDistances.length,
    max: Math.max(...validDistances.filter(distance => Number.isFinite(distance))),
  };
}

export function buildRepetitionQuantileValues({
  quantiles,
  computedDistances,
  statistics,
  scaleType,
}: {
  quantiles: readonly DiffQuantile[];
  computedDistances?: ComputedRepetitionDistances | null;
  statistics?: RepetitionsPlotStatistics | null;
  scaleType: 'linear' | 'log';
}): RepetitionQuantileValue[] {
  const values: RepetitionQuantileValue[] = [];
  const source = computedDistances?.quantiles ?? {
    50: statistics?.mean_distance ?? 0,
    75: (statistics?.mean_distance ?? 0) * 1.5,
    90: (statistics?.p95_distance ?? 0) * 0.9,
    95: statistics?.p95_distance ?? 0,
  };

  for (const quantile of quantiles) {
    let value = source[quantile] ?? 0;
    if (scaleType === 'log') {
      value = Math.log1p(value);
    }
    values.push({ quantile, value });
  }

  return values;
}
