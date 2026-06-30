import type { DataExportContent } from '@/lib/playground/export';
import {
  isPlaygroundSpectralProjection,
  type PlaygroundDataViewProjection,
} from '@/lib/playground/dataViewProjection';
import { getColumnarMetadata } from '@/lib/playground/repetition';
import {
  getAlignedArray,
  getAlignedColumnarMetadata,
  getPlaygroundSampleIds,
  resolvePlaygroundSampleCount,
} from '@/lib/playground/sampleIdentity';
import type { PlaygroundResult } from '@/types/playground';
import type { SpectralData } from '@/types/spectral';

export interface PlaygroundExportContentInput {
  rawData: SpectralData | null;
  result: PlaygroundResult | null;
  dataView?: PlaygroundDataViewProjection | null;
}

export function buildPlaygroundExportContent({
  rawData,
  result,
  dataView,
}: PlaygroundExportContentInput): DataExportContent {
  const canUseSpectra = isPlaygroundSpectralProjection(dataView);
  const spectra = canUseSpectra ? result?.processed?.spectra ?? rawData?.spectra : undefined;
  const sampleCount = resolvePlaygroundSampleCount({
    result,
    rawData,
    dataView,
    matrixSampleCount: spectra?.length,
  });
  const processedMetadata = getAlignedColumnarMetadata(result?.processed?.metadata, sampleCount);
  const rawMetadata = getAlignedColumnarMetadata(getColumnarMetadata(rawData?.metadata), sampleCount);

  return {
    spectra,
    wavelengths: canUseSpectra ? result?.processed?.wavelengths ?? rawData?.wavelengths : undefined,
    y: getAlignedArray(result?.processed?.y, sampleCount) ?? getAlignedArray(rawData?.y, sampleCount),
    sampleIds: canUseSpectra
      ? getPlaygroundSampleIds({ result, rawData, expectedLength: sampleCount })
      : undefined,
    metadata: processedMetadata ?? rawMetadata,
    pca: result?.pca?.coordinates,
    explainedVariance: result?.pca?.explained_variance_ratio,
    folds: result?.folds ?? undefined,
  };
}
