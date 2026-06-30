import { useEffect, useState } from 'react';

import { computeRepetitionVariance } from '@/api/playground';
import type { DiffDistanceMetric, RepetitionReference } from '@/lib/playground/spectraConfig';
import {
  normalizeComputedRepetitionDistances,
  type ComputedRepetitionDistances,
} from '@/lib/playground/repetitionsChartData';
import type { RepetitionResult } from '@/types/playground';

interface UseRepetitionsDistancesInput {
  hasRepetitions: boolean;
  repetitionData: RepetitionResult | null | undefined;
  spectraData?: number[][];
  metric: DiffDistanceMetric;
  repetitionReference: RepetitionReference;
}

interface UseRepetitionsDistancesResult {
  computedDistances: ComputedRepetitionDistances | null;
  isComputing: boolean;
}

export function useRepetitionsDistances({
  hasRepetitions,
  repetitionData,
  spectraData,
  metric,
  repetitionReference,
}: UseRepetitionsDistancesInput): UseRepetitionsDistancesResult {
  const [computedDistances, setComputedDistances] = useState<ComputedRepetitionDistances | null>(null);
  const [isComputing, setIsComputing] = useState(false);

  useEffect(() => {
    if (!hasRepetitions || !repetitionData?.data || !spectraData || spectraData.length === 0) {
      return;
    }

    const groupIds = repetitionData.data.map(point => point.bio_sample);

    if (groupIds.length === 0 || spectraData.length !== groupIds.length) {
      return;
    }

    setIsComputing(true);

    computeRepetitionVariance({
      X: spectraData,
      group_ids: groupIds,
      reference: repetitionReference,
      metric,
    })
      .then(response => {
        if (response.success) {
          const normalizedDistances = normalizeComputedRepetitionDistances(response.distances, response.quantiles);
          if (normalizedDistances) {
            setComputedDistances(normalizedDistances);
          } else {
            console.warn('Metric computation returned invalid distances, using fallback');
            setComputedDistances(null);
          }
        }
      })
      .catch(error => {
        console.error('Failed to compute distances:', error);
        setComputedDistances(null);
      })
      .finally(() => {
        setIsComputing(false);
      });
  }, [hasRepetitions, repetitionData, spectraData, metric, repetitionReference]);

  return {
    computedDistances,
    isComputing,
  };
}
