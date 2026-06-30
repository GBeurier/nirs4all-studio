import type {
  DataSection,
  FoldsInfo,
  MetricsResult,
  PCAResult,
  PlaygroundResult,
  RepetitionResult,
  UMAPResult,
} from '@/types/playground';
import type { ProcessedData, SampleMetadata, SpectralData } from '@/types/spectral';
import type { PipelineExecutionMetricObservation } from '@/lib/pipelineExecutionContract';
import { buildPlaygroundChartAvailabilityReadModel } from './chartAvailability';
import {
  resolvePlaygroundMetadataColumns,
  isPlaygroundSpectralProjection,
  type PlaygroundDataViewProjection,
} from './dataViewProjection';
import {
  getAlignedArray,
  getPlaygroundSampleIds,
  resolvePlaygroundSampleCount,
} from './sampleIdentity';

export interface SpectraChartDataInput {
  original: DataSection;
  processed: DataSection;
  y: number[];
  sampleIds?: string[];
  folds?: FoldsInfo | null;
  metadata?: Record<string, unknown[]>;
  metadataColumns?: string[];
}

export interface HistogramChartDataInput {
  y: number[];
  folds: FoldsInfo | null;
  metadata?: Record<string, unknown[]>;
  hasYValues: boolean;
}

export interface FoldDistributionChartDataInput {
  folds: FoldsInfo | null;
  y: number[];
  metadata?: Record<string, unknown[]>;
  hasFoldDistributionData?: boolean;
}

export interface DimensionReductionChartDataInput {
  pca: PCAResult;
  umap?: UMAPResult | null;
  y: number[];
  folds: FoldsInfo | null;
  sampleIds?: string[];
  metadata?: Record<string, unknown[]>;
  referencePca?: PCAResult | null;
  referenceLabel?: string;
}

export interface EmbeddingOverlayInput {
  embedding: number[][];
  partitions?: string[];
  targets: number[];
  sampleIds?: string[];
  embeddingMethod: 'pca';
}

export interface RepetitionsChartDataInput {
  repetitionData: RepetitionResult | null;
  spectraData?: number[][];
  y: number[];
  metadata?: Record<string, unknown[]>;
  metadataColumns?: string[];
  sampleIds?: string[];
  hasRepetitionData?: boolean;
}

export interface PlaygroundChartExportInput {
  spectra: number[][] | null;
  wavelengths: number[] | null;
  sampleIds?: string[];
  selectedSamples: Set<number>;
  pinnedSamples: Set<number>;
  outlierIndices?: Set<number>;
}

export interface PlaygroundChartInputReadModelContext {
  result: PlaygroundResult | null;
  rawData: SpectralData | null;
  dataView?: PlaygroundDataViewProjection | null;
  metrics?: MetricsResult | null;
  metricObservations?: readonly PipelineExecutionMetricObservation[] | null;
}

export interface PlaygroundChartMetricObservationCapability {
  hasFilterableMetrics: boolean;
  hasMetricObservations: boolean;
  metricKeys: string[];
}

export interface PlaygroundChartDataAvailability {
  hasSpectraData: boolean;
  hasHistogramData: boolean;
  hasDimensionReductionData: boolean;
  hasFoldDistributionData: boolean;
  hasRepetitionData: boolean;
}

export interface PlaygroundChartInputReadModel {
  dataAvailability: PlaygroundChartDataAvailability;
  metricObservationCapability: PlaygroundChartMetricObservationCapability;
}

export function buildPlaygroundChartInputReadModel(
  context: PlaygroundChartInputReadModelContext,
): PlaygroundChartInputReadModel {
  const availability = buildPlaygroundChartAvailabilityReadModel(context);

  return {
    dataAvailability: {
      hasSpectraData: availability.hasSpectralMatrix,
      hasHistogramData: availability.hasTargetValues,
      hasDimensionReductionData: availability.hasDimensionReduction,
      hasFoldDistributionData: availability.hasFoldDistribution,
      hasRepetitionData: availability.hasRepetitionResult,
    },
    metricObservationCapability: {
      hasFilterableMetrics: availability.hasFilterableMetrics,
      hasMetricObservations: availability.hasMetricObservations,
      metricKeys: availability.metricKeys,
    },
  };
}

function buildRawDataSection(rawData: SpectralData): DataSection {
  return {
    spectra: rawData.spectra,
    wavelengths: rawData.wavelengths,
    shape: [rawData.spectra.length, rawData.wavelengths.length],
    header_unit: rawData.wavelengthUnit,
  };
}

function columnarMetadataToRows(metadata: Record<string, unknown[]> | undefined): SampleMetadata[] | undefined {
  if (!metadata || Object.keys(metadata).length === 0) {
    return undefined;
  }

  const rowCount = Math.max(...Object.values(metadata).map((values) => values.length));
  return Array.from({ length: rowCount }, (_, rowIndex) => {
    const row: SampleMetadata = {};
    for (const [key, values] of Object.entries(metadata)) {
      const value = values[rowIndex];
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        row[key] = value;
      }
    }
    return row;
  });
}

function getAlignedMetadataRows(
  metadata: SampleMetadata[] | undefined,
  expectedLength?: number,
): SampleMetadata[] | undefined {
  return getAlignedArray(metadata, expectedLength);
}

export function buildSpectraChartInput({
  rawData,
  result,
  yValues,
  effectiveFolds,
  columnMetadata,
  metadataColumns,
  dataView,
}: {
  rawData: SpectralData | null;
  result: PlaygroundResult | null;
  yValues: number[];
  effectiveFolds: FoldsInfo | null;
  columnMetadata?: Record<string, unknown[]>;
  metadataColumns?: string[];
  dataView?: PlaygroundDataViewProjection | null;
}): SpectraChartDataInput | null {
  if (!isPlaygroundSpectralProjection(dataView)) {
    return null;
  }

  const resolvedMetadataColumns = resolvePlaygroundMetadataColumns(metadataColumns, dataView);
  const expectedSampleCount = resolvePlaygroundSampleCount({ result, rawData, dataView });

  if (result) {
    return {
      original: result.original,
      processed: result.processed,
      y: yValues,
      sampleIds: getPlaygroundSampleIds({ result, rawData, expectedLength: expectedSampleCount }),
      folds: effectiveFolds,
      metadata: columnMetadata,
      metadataColumns: resolvedMetadataColumns,
    };
  }

  if (!rawData) {
    return null;
  }

  const section = buildRawDataSection(rawData);
  return {
    original: section,
    processed: section,
    y: yValues,
    sampleIds: getAlignedArray(rawData.sampleIds, expectedSampleCount),
    folds: undefined,
    metadata: columnMetadata,
    metadataColumns: resolvedMetadataColumns,
  };
}

export function buildHistogramChartInput(
  yValues: number[],
  effectiveFolds: FoldsInfo | null,
  columnMetadata?: Record<string, unknown[]>,
  readModel?: PlaygroundChartInputReadModel | null,
): HistogramChartDataInput {
  return {
    y: yValues,
    folds: effectiveFolds,
    metadata: columnMetadata,
    hasYValues: readModel?.dataAvailability.hasHistogramData ?? yValues.length > 0,
  };
}

export function buildFoldDistributionChartInput(
  effectiveFolds: FoldsInfo | null,
  yValues: number[],
  columnMetadata?: Record<string, unknown[]>,
  readModel?: PlaygroundChartInputReadModel | null,
): FoldDistributionChartDataInput {
  const hasFoldDistributionData = readModel?.dataAvailability.hasFoldDistributionData;
  return {
    folds: hasFoldDistributionData === false ? null : effectiveFolds,
    y: yValues,
    metadata: columnMetadata,
    ...(hasFoldDistributionData != null ? { hasFoldDistributionData } : {}),
  };
}

export function buildDimensionReductionChartInput({
  result,
  rawData,
  yValues,
  effectiveFolds,
  columnMetadata,
  referencePca,
  referenceLabel,
  dataView,
  readModel,
}: {
  result: PlaygroundResult | null;
  rawData: SpectralData | null;
  yValues: number[];
  effectiveFolds: FoldsInfo | null;
  columnMetadata?: Record<string, unknown[]>;
  referencePca?: PCAResult | null;
  referenceLabel?: string;
  dataView?: PlaygroundDataViewProjection | null;
  readModel?: PlaygroundChartInputReadModel | null;
}): DimensionReductionChartDataInput | null {
  if (readModel?.dataAvailability.hasDimensionReductionData === false) {
    return null;
  }
  if (!result?.pca) {
    return null;
  }

  const expectedSampleCount = result.pca.coordinates.length
    || resolvePlaygroundSampleCount({ result, rawData, dataView });

  return {
    pca: result.pca,
    umap: result.umap,
    y: yValues,
    folds: effectiveFolds,
    sampleIds: getPlaygroundSampleIds({ result, rawData, expectedLength: expectedSampleCount }),
    metadata: columnMetadata,
    referencePca,
    referenceLabel,
  };
}

export function buildEmbeddingOverlayInput({
  result,
  yValues,
  trainIndices,
  testIndices,
  totalSamples,
  sampleIds,
}: {
  result: PlaygroundResult | null;
  yValues: number[];
  trainIndices?: Set<number>;
  testIndices?: Set<number>;
  totalSamples: number;
  sampleIds?: string[];
}): EmbeddingOverlayInput | null {
  if (!result?.pca) {
    return null;
  }

  return {
    embedding: result.pca.coordinates,
    partitions: trainIndices && testIndices
      ? Array.from({ length: totalSamples }, (_, i) => trainIndices.has(i) ? 'Train' : 'Test')
      : undefined,
    targets: yValues,
    sampleIds: getAlignedArray(sampleIds, result.pca.coordinates.length),
    embeddingMethod: 'pca',
  };
}

export function buildRepetitionsChartInput({
  result,
  rawData,
  yValues,
  columnMetadata,
  metadataColumns,
  dataView,
  readModel,
}: {
  result: PlaygroundResult | null;
  rawData: SpectralData | null;
  yValues: number[];
  columnMetadata?: Record<string, unknown[]>;
  metadataColumns?: string[];
  dataView?: PlaygroundDataViewProjection | null;
  readModel?: PlaygroundChartInputReadModel | null;
}): RepetitionsChartDataInput {
  const hasRepetitionData = readModel?.dataAvailability.hasRepetitionData;
  let spectraData: number[][] | undefined;
  if (hasRepetitionData !== false && isPlaygroundSpectralProjection(dataView)) {
    spectraData = result?.processed?.spectra ?? rawData?.spectra;
  }
  const expectedSampleCount = spectraData?.length
    ?? resolvePlaygroundSampleCount({ result, rawData, dataView });

  return {
    repetitionData: hasRepetitionData === false ? null : result?.repetitions ?? null,
    spectraData,
    y: yValues,
    metadata: columnMetadata,
    metadataColumns: resolvePlaygroundMetadataColumns(metadataColumns, dataView),
    sampleIds: getPlaygroundSampleIds({ result, rawData, expectedLength: expectedSampleCount }),
    ...(hasRepetitionData != null ? { hasRepetitionData } : {}),
  };
}

export function buildPlaygroundChartExportInput({
  rawData,
  result,
  selectedSamples,
  pinnedSamples,
  outlierIndices,
  dataView,
}: {
  rawData: SpectralData | null;
  result: PlaygroundResult | null;
  selectedSamples: Set<number>;
  pinnedSamples: Set<number>;
  outlierIndices?: number[];
  dataView?: PlaygroundDataViewProjection | null;
}): PlaygroundChartExportInput {
  const canExportSpectra = isPlaygroundSpectralProjection(dataView);
  const spectra = canExportSpectra ? result?.processed?.spectra ?? rawData?.spectra ?? null : null;
  const wavelengths = canExportSpectra ? result?.processed?.wavelengths ?? rawData?.wavelengths ?? null : null;
  const expectedSampleCount = spectra?.length ?? resolvePlaygroundSampleCount({ result, rawData, dataView });

  return {
    spectra,
    wavelengths,
    sampleIds: canExportSpectra
      ? getPlaygroundSampleIds({ result, rawData, expectedLength: expectedSampleCount })
      : undefined,
    selectedSamples,
    pinnedSamples,
    outlierIndices: outlierIndices ? new Set(outlierIndices) : undefined,
  };
}

export function buildSampleDetailsData(
  rawData: SpectralData | null,
  result: PlaygroundResult | null,
  yValues: number[],
  dataView?: PlaygroundDataViewProjection | null,
): ProcessedData | null {
  if (!rawData || !isPlaygroundSpectralProjection(dataView)) {
    return null;
  }
  const spectra = result?.processed?.spectra ?? rawData.spectra;
  const expectedSampleCount = spectra.length || resolvePlaygroundSampleCount({ result, rawData, dataView });
  const processedMetadataRows = columnarMetadataToRows(result?.processed?.metadata);
  const metadata = getAlignedMetadataRows(processedMetadataRows, expectedSampleCount)
    ?? getAlignedMetadataRows(rawData.metadata, expectedSampleCount);
  const originalSpectra = getAlignedArray(result?.original?.spectra, expectedSampleCount)
    ?? getAlignedArray(rawData.spectra, expectedSampleCount)
    ?? spectra;

  return {
    wavelengths: result?.processed?.wavelengths ?? rawData.wavelengths,
    spectra,
    y: yValues,
    sampleIds: getPlaygroundSampleIds({ result, rawData, expectedLength: expectedSampleCount }),
    metadata,
    originalSpectra,
    originalY: yValues,
  };
}
