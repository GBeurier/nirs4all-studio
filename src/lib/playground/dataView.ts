import type { DataExportContent } from '@/lib/playground/export';
import type {
  DataViewRef,
  DatasetSchemaRef,
} from '@/lib/datasetSchema';
import type { PlaygroundResult } from '@/types/playground';
import type { SampleMetadata, SpectralData } from '@/types/spectral';
import {
  buildPlaygroundSpectralProjection,
  getDefaultDataView,
  type PlaygroundDataViewProjection,
} from './dataViewProjection';
import { buildLegacyPlaygroundDataViewInput } from './playgroundDataView';

export interface PlaygroundDataView {
  schemaRef: DatasetSchemaRef | null;
  defaultDataView: DataViewRef | null;
  spectralProjection: PlaygroundDataViewProjection;
  hasRawData: boolean;
  hasProcessedSpectra: boolean;
  rawSampleCount: number;
  processedSampleCount: number;
  sampleCount: number;
  rawFeatureCount: number;
  processedFeatureCount: number;
  featureCount: number;
  processedSpectraExport: DataExportContent | null;
}

function getMatchingArray<T>(values: T[] | undefined, expectedLength: number): T[] | undefined {
  return values && values.length === expectedLength ? values : undefined;
}

function metadataRowsToColumns(rows: SampleMetadata[] | undefined): Record<string, unknown[]> | undefined {
  if (!rows?.length) {
    return undefined;
  }

  const columns: Record<string, unknown[]> = {};
  for (const row of rows) {
    for (const [key, value] of Object.entries(row)) {
      columns[key] ??= [];
      columns[key].push(value);
    }
  }
  return Object.keys(columns).length > 0 ? columns : undefined;
}

function buildLegacyRawSchemaRef(rawData: SpectralData | null): DatasetSchemaRef | null {
  if (!rawData) {
    return null;
  }

  return buildLegacyPlaygroundDataViewInput({
    header_unit: rawData.wavelengthUnit,
    metadata: metadataRowsToColumns(rawData.metadata),
    sample_ids: rawData.sampleIds,
    wavelengths: rawData.wavelengths,
    x: rawData.spectra,
    y: rawData.y,
  }).schemaRef;
}

export function buildPlaygroundDataView(
  rawData: SpectralData | null,
  result: PlaygroundResult | null,
  schemaRef: DatasetSchemaRef | null = null
): PlaygroundDataView {
  const effectiveSchemaRef = schemaRef ?? buildLegacyRawSchemaRef(rawData);
  const processedSpectra = result?.processed?.spectra;
  const processedWavelengths = result?.processed?.wavelengths;
  const rawSampleCount = rawData?.spectra?.length ?? rawData?.y?.length ?? 0;
  const rawFeatureCount = rawData?.wavelengths?.length ?? rawData?.spectra?.[0]?.length ?? 0;
  const processedSampleCount = processedSpectra?.length ?? 0;
  const processedFeatureCount = processedWavelengths?.length ?? processedSpectra?.[0]?.length ?? 0;
  const hasProcessedSpectra = Boolean(processedSpectra?.length && processedWavelengths?.length);
  const sampleCount = processedSampleCount || rawSampleCount;
  const featureCount = processedFeatureCount || rawFeatureCount;
  const defaultDataView = getDefaultDataView(effectiveSchemaRef);

  const processedSpectraExport = hasProcessedSpectra && processedSpectra && processedWavelengths
    ? {
        spectra: processedSpectra,
        wavelengths: processedWavelengths,
        y: getMatchingArray(result?.processed?.y, processedSpectra.length)
          ?? getMatchingArray(rawData?.y, processedSpectra.length),
        sampleIds: getMatchingArray(result?.processed?.sample_ids, processedSpectra.length)
          ?? getMatchingArray(rawData?.sampleIds, processedSpectra.length),
      }
    : null;

  return {
    schemaRef: effectiveSchemaRef,
    defaultDataView,
    spectralProjection: buildPlaygroundSpectralProjection({
      schemaRef: effectiveSchemaRef,
      defaultDataView,
      sampleCount,
      featureCount,
    }),
    hasRawData: rawSampleCount > 0 || rawFeatureCount > 0,
    hasProcessedSpectra,
    rawSampleCount,
    processedSampleCount,
    sampleCount,
    rawFeatureCount,
    processedFeatureCount,
    featureCount,
    processedSpectraExport,
  };
}

export type {
  PlaygroundDataViewProjection,
  PlaygroundDataViewProjectionSource,
} from './dataViewProjection';
export {
  buildPlaygroundSpectralProjection,
  getDefaultDataView,
} from './dataViewProjection';
