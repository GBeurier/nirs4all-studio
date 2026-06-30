import { useMemo } from 'react';

import {
  type ColorContext,
} from '@/lib/playground/colorConfig';
import {
  buildDimensionReductionColorContext,
} from '@/lib/playground/dimensionReductionPresentation';
import {
  buildDimensionReductionOptions,
  buildDimensionReductionPoints,
  buildDimensionReductionVarianceExplained,
  computeDimensionReductionYRange,
  filterDimensionReductionPoints,
  formatDimensionReductionAxisLabel,
  getDimensionReductionComponentsForVariance,
  getDimensionReductionUniqueFolds,
  type DimensionOption,
  type DimensionReductionAxes,
  type DimensionReductionDataPoint,
  type DimensionReductionMethod,
  type DimensionReductionYRange,
} from '@/lib/playground/dimensionReductionData';
import type {
  FoldsInfo,
  PCAResult,
  UMAPResult,
} from '@/types/playground';
import { formatPercentage } from './chartConfig';

interface DimensionReductionChartDataConfig {
  method: DimensionReductionMethod;
  xAxis: string;
  yAxis: string;
  zAxis: string;
}

interface UseDimensionReductionChartDataInput {
  config: DimensionReductionChartDataConfig;
  pca: PCAResult | null;
  umap?: UMAPResult | null;
  y?: number[];
  folds?: FoldsInfo | null;
  sampleIds?: string[];
  metadata?: Record<string, unknown[]>;
  externalColorContext?: ColorContext;
  selectedSamples: Set<number>;
  pinnedSamples: Set<number>;
  referencePca?: PCAResult | null;
  referenceLabel: string;
}

interface DimensionReductionAxisLabels {
  x: string;
  y: string;
  z: string;
}

export interface DimensionReductionChartDerivedData {
  activeResult: PCAResult | UMAPResult | null | undefined;
  hasUMAP: boolean;
  hasPCA: boolean;
  nComponents: number;
  dimensionOptions: DimensionOption[];
  varianceExplained: Record<string, number>;
  activeAxes: DimensionReductionAxes;
  axisLabels: DimensionReductionAxisLabels;
  chartData: DimensionReductionDataPoint[];
  filteredChartData: DimensionReductionDataPoint[];
  referenceChartData: DimensionReductionDataPoint[];
  uniqueFolds: number[];
  yRange: DimensionReductionYRange;
  computedColorContext: ColorContext;
  metadataKeys: string[];
}

export function useDimensionReductionChartData({
  config,
  pca,
  umap,
  y,
  folds,
  sampleIds,
  metadata,
  externalColorContext,
  selectedSamples,
  pinnedSamples,
  referencePca,
  referenceLabel,
}: UseDimensionReductionChartDataInput): DimensionReductionChartDerivedData {
  const activeResult = config.method === 'umap' ? umap : pca;
  const hasUMAP = !!umap && !umap.error && Array.isArray(umap.coordinates) && umap.coordinates.length > 0;
  const hasPCA = !!pca && !pca.error && Array.isArray(pca.coordinates) && pca.coordinates.length > 0;

  const componentsFor999Variance = useMemo(() => {
    return getDimensionReductionComponentsForVariance(pca);
  }, [pca]);

  const nComponents = config.method === 'pca'
    ? componentsFor999Variance
    : (umap?.n_components ?? 0);

  const dimensionOptions = useMemo(() => {
    return buildDimensionReductionOptions(config.method, nComponents);
  }, [config.method, nComponents]);

  const varianceExplained = useMemo(() => {
    return buildDimensionReductionVarianceExplained(config.method, pca?.explained_variance_ratio);
  }, [config.method, pca]);

  const activeAxes = useMemo(() => ({
    xAxis: config.xAxis,
    yAxis: config.yAxis,
    zAxis: config.zAxis,
  }), [config.xAxis, config.yAxis, config.zAxis]);

  const chartData = useMemo<DimensionReductionDataPoint[]>(() => {
    return buildDimensionReductionPoints({
      result: activeResult,
      axes: activeAxes,
      sampleIds,
      y,
      fallbackY: pca?.y,
      folds,
      fallbackFoldLabels: pca?.fold_labels,
      metadata,
    });
  }, [activeResult, activeAxes, sampleIds, y, pca, folds, metadata]);

  const filteredChartData = useMemo<DimensionReductionDataPoint[]>(() => {
    return filterDimensionReductionPoints(chartData, externalColorContext?.displayFilteredIndices);
  }, [chartData, externalColorContext]);

  const referenceChartData = useMemo<DimensionReductionDataPoint[]>(() => {
    return buildDimensionReductionPoints({
      result: referencePca,
      axes: activeAxes,
      nameForIndex: index => `${referenceLabel} ${index + 1}`,
    });
  }, [referencePca, activeAxes, referenceLabel]);

  const uniqueFolds = useMemo(() => {
    return getDimensionReductionUniqueFolds(folds);
  }, [folds]);

  const yRange = useMemo(() => {
    return computeDimensionReductionYRange(chartData);
  }, [chartData]);

  const computedColorContext = useMemo<ColorContext>(() => {
    return buildDimensionReductionColorContext({
      externalColorContext,
      y,
      yRange,
      folds,
      fallbackFoldLabels: pca?.fold_labels,
      metadata,
      selectedSamples,
      pinnedSamples,
    });
  }, [externalColorContext, y, yRange, folds, pca, metadata, selectedSamples, pinnedSamples]);

  const axisLabels = useMemo(() => ({
    x: formatDimensionReductionAxisLabel(config.xAxis, config.method, varianceExplained, formatPercentage),
    y: formatDimensionReductionAxisLabel(config.yAxis, config.method, varianceExplained, formatPercentage),
    z: formatDimensionReductionAxisLabel(config.zAxis, config.method, varianceExplained, formatPercentage),
  }), [config.method, config.xAxis, config.yAxis, config.zAxis, varianceExplained]);

  const metadataKeys = useMemo(() => {
    if (!metadata) return [];
    return Object.keys(metadata);
  }, [metadata]);

  return {
    activeResult,
    hasUMAP,
    hasPCA,
    nComponents,
    dimensionOptions,
    varianceExplained,
    activeAxes,
    axisLabels,
    chartData,
    filteredChartData,
    referenceChartData,
    uniqueFolds,
    yRange,
    computedColorContext,
    metadataKeys,
  };
}
