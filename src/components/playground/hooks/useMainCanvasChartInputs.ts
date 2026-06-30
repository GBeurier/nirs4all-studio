import { useMemo } from 'react';

import {
  buildEffectivePlaygroundFolds,
  buildPartitionIndexSets,
  buildPlaygroundTargetView,
  getColumnarPlaygroundMetadata,
  getMetadataColumnNames,
} from '@/lib/playground/canvasData';
import {
  buildDimensionReductionChartInput,
  buildEmbeddingOverlayInput,
  buildFoldDistributionChartInput,
  buildHistogramChartInput,
  buildPlaygroundChartInputReadModel,
  buildRepetitionsChartInput,
  buildSampleDetailsData,
  buildSpectraChartInput,
} from '@/lib/playground/chartInputs';
import { buildCanvasToolbarDataState } from '@/lib/playground/canvasToolbarState';
import { buildPlaygroundDataView } from '@/lib/playground/dataView';
import type { DatasetSchemaRef } from '@/lib/datasetSchema';
import type { PlaygroundResult } from '@/types/playground';
import type { SpectralData } from '@/types/spectral';

export interface UseMainCanvasChartInputsOptions {
  rawData: SpectralData | null;
  result: PlaygroundResult | null;
  deferredResult: PlaygroundResult | null;
  datasetSchemaRef?: DatasetSchemaRef | null;
  referencePca?: PlaygroundResult['pca'];
  referenceLabel?: string;
}

export function useMainCanvasChartInputs({
  rawData,
  result,
  deferredResult,
  datasetSchemaRef,
  referencePca,
  referenceLabel,
}: UseMainCanvasChartInputsOptions) {
  const dataView = useMemo(
    () => buildPlaygroundDataView(rawData, result, datasetSchemaRef),
    [datasetSchemaRef, rawData, result]
  );

  const toolbarDataState = useMemo(
    () => buildCanvasToolbarDataState({
      rawData,
      result,
      dataView: dataView.spectralProjection,
    }),
    [rawData, result, dataView.spectralProjection],
  );

  const chartInputReadModel = useMemo(
    () => buildPlaygroundChartInputReadModel({
      rawData,
      result,
      dataView: dataView.spectralProjection,
    }),
    [rawData, result, dataView.spectralProjection],
  );

  const deferredChartInputReadModel = useMemo(
    () => buildPlaygroundChartInputReadModel({
      rawData,
      result: deferredResult,
      dataView: dataView.spectralProjection,
    }),
    [rawData, deferredResult, dataView.spectralProjection],
  );

  const {
    yValues,
    yMin,
    yMax,
    targetType,
    classLabels,
    classLabelMap,
  } = useMemo(
    () => buildPlaygroundTargetView(rawData, result, dataView.spectralProjection),
    [rawData, result, dataView.spectralProjection],
  );

  const columnMetadata = useMemo(
    () => getColumnarPlaygroundMetadata(rawData, result),
    [rawData, result]
  );

  const metadataColumns = useMemo(() => {
    return getMetadataColumnNames(columnMetadata, dataView.spectralProjection);
  }, [columnMetadata, dataView.spectralProjection]);

  const effectiveFolds = useMemo(
    () => buildEffectivePlaygroundFolds(result, dataView.rawSampleCount, rawData?.y ?? []),
    [result, dataView.rawSampleCount, rawData?.y]
  );

  const { trainIndices, testIndices } = useMemo(
    () => buildPartitionIndexSets(result?.source_partitions, effectiveFolds),
    [result?.source_partitions, effectiveFolds]
  );

  const spectraChartInput = useMemo(() => buildSpectraChartInput({
    rawData,
    result,
    yValues,
    effectiveFolds,
    columnMetadata,
    metadataColumns,
    dataView: dataView.spectralProjection,
  }), [rawData, result, yValues, effectiveFolds, columnMetadata, metadataColumns, dataView.spectralProjection]);

  const sampleDetailsData = useMemo(
    () => buildSampleDetailsData(rawData, result, yValues, dataView.spectralProjection),
    [rawData, result, yValues, dataView.spectralProjection]
  );

  const histogramChartInput = useMemo(
    () => buildHistogramChartInput(yValues, effectiveFolds, columnMetadata, chartInputReadModel),
    [yValues, effectiveFolds, columnMetadata, chartInputReadModel]
  );

  const foldDistributionChartInput = useMemo(
    () => buildFoldDistributionChartInput(effectiveFolds, yValues, columnMetadata, chartInputReadModel),
    [effectiveFolds, yValues, columnMetadata, chartInputReadModel]
  );

  const dimensionReductionChartInput = useMemo(() => buildDimensionReductionChartInput({
    result: deferredResult,
    rawData,
    yValues,
    effectiveFolds,
    columnMetadata,
    referencePca,
    referenceLabel,
    dataView: dataView.spectralProjection,
    readModel: deferredChartInputReadModel,
  }), [
    deferredResult,
    rawData,
    yValues,
    effectiveFolds,
    columnMetadata,
    referencePca,
    referenceLabel,
    dataView.spectralProjection,
    deferredChartInputReadModel,
  ]);

  const totalSamples = toolbarDataState.totalSamples;

  const embeddingOverlayInput = useMemo(() => buildEmbeddingOverlayInput({
    result,
    yValues,
    trainIndices,
    testIndices,
    totalSamples,
    sampleIds: spectraChartInput?.sampleIds,
  }), [result, yValues, trainIndices, testIndices, totalSamples, spectraChartInput?.sampleIds]);

  const repetitionsChartInput = useMemo(() => buildRepetitionsChartInput({
    result: deferredResult,
    rawData,
    yValues,
    columnMetadata,
    metadataColumns,
    dataView: dataView.spectralProjection,
    readModel: deferredChartInputReadModel,
  }), [deferredResult, rawData, yValues, columnMetadata, metadataColumns, dataView.spectralProjection, deferredChartInputReadModel]);

  return {
    dataView,
    toolbarDataState,
    totalSamples,
    toolbarSampleIds: toolbarDataState.sampleIds,
    yValues,
    yMin,
    yMax,
    targetType,
    classLabels,
    classLabelMap,
    columnMetadata,
    metadataColumns,
    effectiveFolds,
    trainIndices,
    testIndices,
    spectraChartInput,
    sampleDetailsData,
    histogramChartInput,
    foldDistributionChartInput,
    dimensionReductionChartInput,
    embeddingOverlayInput,
    repetitionsChartInput,
  };
}
