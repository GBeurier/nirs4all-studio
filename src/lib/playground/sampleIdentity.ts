import {
  getPlaygroundProjectionSampleCount,
  type PlaygroundDataViewProjection,
} from '@/lib/playground/dataViewProjection';
import type { PlaygroundResult } from '@/types/playground';
import type { SpectralData } from '@/types/spectral';

export interface PlaygroundSampleCountInput {
  result: PlaygroundResult | null;
  rawData: SpectralData | null;
  dataView?: PlaygroundDataViewProjection | null;
  matrixSampleCount?: number;
}

export interface PlaygroundSampleIdsInput extends PlaygroundSampleCountInput {
  expectedLength?: number;
}

export function getAlignedArray<T>(values: T[] | undefined, expectedLength?: number): T[] | undefined {
  if (!values?.length) {
    return undefined;
  }
  if (expectedLength === undefined || expectedLength <= 0) {
    return values;
  }
  return values.length === expectedLength ? values : undefined;
}

export function resolvePlaygroundSampleCount({
  result,
  rawData,
  dataView,
  matrixSampleCount,
}: PlaygroundSampleCountInput): number | undefined {
  if (matrixSampleCount && matrixSampleCount > 0) return matrixSampleCount;
  const projectionSampleCount = getPlaygroundProjectionSampleCount(dataView);
  if (projectionSampleCount !== undefined) return projectionSampleCount;
  if (result?.processed?.spectra?.length) return result.processed.spectra.length;
  if (result?.processed?.y?.length) return result.processed.y.length;
  if (rawData?.spectra?.length) return rawData.spectra.length;
  if (rawData?.y?.length) return rawData.y.length;
  return undefined;
}

export function getPlaygroundSampleIds({
  result,
  rawData,
  dataView,
  matrixSampleCount,
  expectedLength,
}: PlaygroundSampleIdsInput): string[] | undefined {
  const sampleCount = expectedLength ?? resolvePlaygroundSampleCount({
    result,
    rawData,
    dataView,
    matrixSampleCount,
  });

  return getAlignedArray(result?.processed?.sample_ids, sampleCount)
    ?? getAlignedArray(rawData?.sampleIds, sampleCount);
}

export function getAlignedColumnarMetadata(
  metadata: Record<string, unknown[]> | undefined,
  expectedLength?: number,
): Record<string, unknown[]> | undefined {
  if (!metadata) {
    return undefined;
  }

  const entries = Object.entries(metadata).filter(([, values]) => (
    expectedLength === undefined || expectedLength <= 0 || values.length === expectedLength
  ));
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}
