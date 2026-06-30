import type { PlaygroundDataViewProjection } from '@/lib/playground/dataViewProjection';
import {
  hasPlaygroundFolds,
  hasPlaygroundPartition,
} from '@/lib/playground/canvasData';
import { hasSpectralRepetitionGroups } from '@/lib/playground/repetition';
import {
  getPlaygroundSampleIds,
  resolvePlaygroundSampleCount,
} from '@/lib/playground/sampleIdentity';
import type { PlaygroundResult } from '@/types/playground';
import type { SpectralData } from '@/types/spectral';

export interface CanvasToolbarDataState {
  hasPartition: boolean;
  hasFolds: boolean;
  showFoldsChart: boolean;
  hasRawRepetitions: boolean;
  hasRepetitions: boolean;
  totalSamples: number;
  sampleIds?: string[];
}

export function buildCanvasToolbarDataState({
  rawData,
  result,
  dataView,
}: {
  rawData: SpectralData | null;
  result: PlaygroundResult | null;
  dataView?: PlaygroundDataViewProjection | null;
}): CanvasToolbarDataState {
  const hasPartition = hasPlaygroundPartition(result);
  const hasFolds = hasPlaygroundFolds(result);
  const hasRawRepetitions = hasSpectralRepetitionGroups(rawData);
  const resolvedTotalSamples = resolvePlaygroundSampleCount({ rawData, result, dataView })
    ?? 0;

  return {
    hasPartition,
    hasFolds,
    showFoldsChart: hasFolds || hasPartition,
    hasRawRepetitions,
    hasRepetitions: Boolean(result?.repetitions?.has_repetitions) || hasRawRepetitions,
    totalSamples: resolvedTotalSamples,
    sampleIds: getPlaygroundSampleIds({
      rawData,
      result,
      dataView,
      expectedLength: resolvedTotalSamples || undefined,
    }),
  };
}
