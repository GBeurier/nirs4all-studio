import { useCallback, useMemo } from 'react';
import {
  type ColorContext,
  type GlobalColorConfig,
  getBaseColor as getUnifiedBaseColor,
  getCategoricalColor,
  getWebGLSampleColor,
} from '@/lib/playground/colorConfig';
import type { SpectraChartConfig } from '@/lib/playground/spectraConfig';
import {
  applySpectraWavelengthFocus,
  buildFocusedSpectraData,
  buildSpectraColorContext,
  buildSpectraDifferenceStats,
  buildSpectraSamplingResult,
  buildSpectraYAxisDomain,
  filterSpectraDisplayIndices,
  findHighSpectraDifferenceRegions,
  getSpectraBaseWavelengths,
  getSpectraOutlierSamples,
  getSpectraWavelengthRange,
} from '@/lib/playground/spectraChartData';
import {
  getSpectraLineBaseColor,
  type SpectraLineBaseColor,
} from '@/lib/playground/spectraLineColor';
import {
  buildSpectraChartViewState,
  shouldShowSpectraIndividualLines,
} from '@/lib/playground/spectraChartPresentation';
import type { DataSection, FoldsInfo } from '@/types/playground';
import {
  formatWavelengthUnit,
  getWavelengthAxisLabel,
  getWavelengthAxisName,
} from './chartConfig';
import {
  computeAggregatedStats,
  computeGroupedStats,
  type AggregatedStats,
} from './SpectraAggregation';
import { buildSpectraChartLegendItems } from './SpectraChartLegend';
import { buildSpectraChartRows } from './spectraChartRows';

export interface SpectraChartAxisInfo {
  wavelengthAxisName: string;
  wavelengthAxisLabel: string;
  wavelengthUnitSymbol: string;
  wavelengthUnitSuffix: string;
}

export interface BuildSpectraWebGLSampleColorsInput {
  isWebGLMode: boolean;
  displayIndices: number[];
  globalColorConfig?: GlobalColorConfig;
  colorContext: ColorContext;
  getBaseColor: (sampleIndex: number) => string;
}

export interface BuildSpectraRendererSampleColorsInput {
  displayMode: SpectraChartConfig['displayMode'];
  groupedStats: Map<string | number, AggregatedStats> | null;
  categoricalPalette?: GlobalColorConfig['categoricalPalette'];
  sampleColors?: string[];
}

export interface UseSpectraChartDerivedDataInput {
  original: DataSection;
  processed: DataSection;
  config: SpectraChartConfig;
  selectedSamples: ReadonlySet<number>;
  isWebGLMode: boolean;
  brushDomain: [number, number] | null;
  y?: number[];
  folds?: FoldsInfo | null;
  metadata?: Record<string, unknown[]>;
  colorContext?: ColorContext;
  globalColorConfig?: GlobalColorConfig;
  outlierIndices?: Set<number>;
  referenceDataset?: DataSection | null;
  referenceLabel: string;
  showAbsoluteDifference: boolean;
}

export function buildSpectraChartAxisInfo(
  original: Pick<DataSection, 'header_unit'>,
  processed: Pick<DataSection, 'header_unit'>
): SpectraChartAxisInfo {
  const headerUnit = processed.header_unit ?? original.header_unit;
  const wavelengthUnitSymbol = formatWavelengthUnit(headerUnit);

  return {
    wavelengthAxisName: getWavelengthAxisName(headerUnit),
    wavelengthAxisLabel: getWavelengthAxisLabel(headerUnit),
    wavelengthUnitSymbol,
    wavelengthUnitSuffix: wavelengthUnitSymbol ? ` ${wavelengthUnitSymbol}` : '',
  };
}

export function buildSpectraWebGLSampleColors({
  isWebGLMode,
  displayIndices,
  globalColorConfig,
  colorContext,
  getBaseColor,
}: BuildSpectraWebGLSampleColorsInput): string[] | undefined {
  if (!isWebGLMode) {
    return undefined;
  }

  const colors: string[] = [];
  for (const sampleIndex of displayIndices) {
    colors[sampleIndex] = globalColorConfig
      ? getWebGLSampleColor(sampleIndex, globalColorConfig, colorContext)
      : getBaseColor(sampleIndex);
  }
  return colors;
}

export function buildSpectraRendererSampleColors({
  displayMode,
  groupedStats,
  categoricalPalette = 'default',
  sampleColors,
}: BuildSpectraRendererSampleColorsInput): string[] | undefined {
  if (displayMode === 'grouped' && groupedStats) {
    return Array.from(groupedStats.keys()).map((_, index) =>
      getCategoricalColor(index, categoricalPalette)
    );
  }
  return sampleColors;
}

export function useSpectraChartDerivedData({
  original,
  processed,
  config,
  selectedSamples,
  isWebGLMode,
  brushDomain,
  y,
  folds,
  metadata,
  colorContext,
  globalColorConfig,
  outlierIndices,
  referenceDataset,
  referenceLabel,
  showAbsoluteDifference,
}: UseSpectraChartDerivedDataInput) {
  const baseWavelengths = useMemo(
    () => getSpectraBaseWavelengths(original, processed, config.viewMode),
    [config.viewMode, original, processed]
  );

  const axisInfo = useMemo(
    () => buildSpectraChartAxisInfo(original, processed),
    [original, processed]
  );

  const wavelengthRange: [number, number] = useMemo(
    () => getSpectraWavelengthRange(baseWavelengths),
    [baseWavelengths]
  );

  const focusedData = useMemo(() => buildFocusedSpectraData({
    original,
    processed,
    viewMode: config.viewMode,
    wavelengthFocus: config.wavelengthFocus,
    showAbsoluteDifference,
  }), [config.viewMode, config.wavelengthFocus, original, processed, showAbsoluteDifference]);

  const samplingResult = useMemo(() => buildSpectraSamplingResult({
    totalSamples: focusedData.spectra.length,
    sampling: config.sampling,
    displayMode: config.displayMode,
    selectedSamples,
    spectra: focusedData.spectra,
    yValues: y,
  }), [config.displayMode, config.sampling, focusedData.spectra, selectedSamples, y]);

  const displayIndices = useMemo(
    () => filterSpectraDisplayIndices(samplingResult.indices, colorContext?.displayFilteredIndices),
    [colorContext?.displayFilteredIndices, samplingResult.indices]
  );

  const aggregatedStats: AggregatedStats | null = useMemo(() => {
    if (config.aggregation.mode === 'none' && config.displayMode !== 'grouped') return null;
    return computeAggregatedStats(focusedData.spectra, config.aggregation.quantileRange);
  }, [config.aggregation.mode, config.aggregation.quantileRange, config.displayMode, focusedData.spectra]);

  const groupedStats: Map<string | number, AggregatedStats> | null = useMemo(() => {
    if (config.displayMode !== 'grouped' || !config.aggregation.groupBy || !metadata) return null;

    const groupLabels = metadata[config.aggregation.groupBy] as (string | number)[] | undefined;
    if (!groupLabels) return null;

    return computeGroupedStats(focusedData.spectra, groupLabels, config.aggregation.quantileRange);
  }, [config.aggregation.groupBy, config.aggregation.quantileRange, config.displayMode, focusedData.spectra, metadata]);

  const groupKeys = useMemo(() => {
    if (!groupedStats) return [];
    return Array.from(groupedStats.keys());
  }, [groupedStats]);

  const outlierSamples = useMemo(
    () => getSpectraOutlierSamples(globalColorConfig?.mode, outlierIndices),
    [globalColorConfig?.mode, outlierIndices]
  );

  const focusedOriginalData = useMemo(() => applySpectraWavelengthFocus(
    { spectra: original.spectra, wavelengths: original.wavelengths },
    config.wavelengthFocus
  ), [config.wavelengthFocus, original.spectra, original.wavelengths]);

  const originalAggregatedStats: AggregatedStats | null = useMemo(() => {
    if (config.aggregation.mode === 'none' || config.viewMode !== 'both') return null;
    return computeAggregatedStats(focusedOriginalData.spectra, config.aggregation.quantileRange);
  }, [config.aggregation.mode, config.aggregation.quantileRange, config.viewMode, focusedOriginalData.spectra]);

  const chartData = useMemo(() => {
    const showIndividualLines = shouldShowSpectraIndividualLines(
      config.aggregation.mode,
      config.aggregation.showIndividualLines,
    );
    return buildSpectraChartRows({
      isWebGLMode,
      focusedData,
      focusedOriginalData,
      displayIndices,
      aggregationMode: config.aggregation.mode,
      showIndividualLines,
      viewMode: config.viewMode,
      displayMode: config.displayMode,
      aggregatedStats,
      originalAggregatedStats,
      groupedStats,
      referenceDataset,
    });
  }, [
    aggregatedStats,
    config.aggregation.mode,
    config.aggregation.showIndividualLines,
    config.displayMode,
    config.viewMode,
    displayIndices,
    focusedData,
    focusedOriginalData,
    groupedStats,
    isWebGLMode,
    originalAggregatedStats,
    referenceDataset,
  ]);

  const filteredData = useMemo(() => {
    if (!brushDomain) return chartData;
    return chartData.filter(
      row => (row.wavelength as number) >= brushDomain[0] && (row.wavelength as number) <= brushDomain[1]
    );
  }, [brushDomain, chartData]);

  const computedColorContext = useMemo(() => buildSpectraColorContext({
    colorContext,
    yValues: y,
    folds,
    metadata,
    outlierSamples,
  }), [colorContext, folds, metadata, outlierSamples, y]);

  const getBaseColor = useCallback((sampleIndex: number) => {
    if (globalColorConfig) {
      return getUnifiedBaseColor(sampleIndex, globalColorConfig, computedColorContext);
    }
    return 'hsl(var(--muted-foreground))';
  }, [computedColorContext, globalColorConfig]);

  const viewModeBoth = config.viewMode === 'both';
  const getBaseLineColor = useCallback((sampleIndex: number, isOriginal: boolean): SpectraLineBaseColor => {
    const isOutlier = computedColorContext.outlierIndices?.has(sampleIndex) ?? false;
    return getSpectraLineBaseColor({
      isOutlier,
      globalColorMode: globalColorConfig?.mode,
      showOutlierOverlay: globalColorConfig?.showOutlierOverlay,
      baseColor: getBaseColor(sampleIndex),
      isOriginal,
      viewModeBoth,
    });
  }, [computedColorContext.outlierIndices, getBaseColor, globalColorConfig?.mode, globalColorConfig?.showOutlierOverlay, viewModeBoth]);

  const sampleColors = useMemo(() => buildSpectraWebGLSampleColors({
    isWebGLMode,
    displayIndices,
    globalColorConfig,
    colorContext: computedColorContext,
    getBaseColor,
  }), [computedColorContext, displayIndices, getBaseColor, globalColorConfig, isWebGLMode]);

  const webglSampleColors = useMemo(() => buildSpectraRendererSampleColors({
    displayMode: config.displayMode,
    groupedStats,
    categoricalPalette: globalColorConfig?.categoricalPalette,
    sampleColors,
  }), [config.displayMode, globalColorConfig?.categoricalPalette, groupedStats, sampleColors]);

  const yAxisDomain = useMemo((): [number, number] => {
    return buildSpectraYAxisDomain(focusedData.spectra);
  }, [focusedData.spectra]);

  const viewState = useMemo(() => buildSpectraChartViewState({
    aggregationMode: config.aggregation.mode,
    showAggregationIndividualLines: config.aggregation.showIndividualLines,
    viewMode: config.viewMode,
    displayMode: config.displayMode,
    hasGroupedStats: Boolean(groupedStats),
    groupKeyCount: groupKeys.length,
    selectedCount: selectedSamples.size,
  }), [
    config.aggregation.mode,
    config.aggregation.showIndividualLines,
    config.displayMode,
    config.viewMode,
    groupedStats,
    groupKeys.length,
    selectedSamples.size,
  ]);

  const differenceStats = useMemo(() => {
    if (config.viewMode !== 'difference') return null;
    return buildSpectraDifferenceStats(original.spectra, processed.spectra);
  }, [config.viewMode, original.spectra, processed.spectra]);

  const highDifferenceRegions = useMemo(() => {
    if (config.viewMode !== 'difference') return [];
    if (processed.spectra.length !== original.spectra.length) return [];
    return findHighSpectraDifferenceRegions({
      wavelengths: focusedData.wavelengths,
      differenceSpectra: focusedData.spectra,
    });
  }, [config.viewMode, focusedData.spectra, focusedData.wavelengths, original.spectra.length, processed.spectra.length]);

  const legendItems = useMemo(() => buildSpectraChartLegendItems({
    showGroupedAggregation: viewState.showGroupedAggregation,
    groupKeys,
    categoricalPalette: globalColorConfig?.categoricalPalette,
    aggregationMode: config.aggregation.mode,
    viewMode: config.viewMode,
    showProcessed: viewState.showProcessed,
    showOriginal: viewState.showOriginal,
    hasReferenceDataset: Boolean(referenceDataset?.spectra && referenceDataset.spectra.length > 0),
    referenceLabel,
  }), [
    config.aggregation.mode,
    config.viewMode,
    globalColorConfig?.categoricalPalette,
    groupKeys,
    referenceDataset,
    referenceLabel,
    viewState.showGroupedAggregation,
    viewState.showOriginal,
    viewState.showProcessed,
  ]);

  return {
    ...axisInfo,
    baseWavelengths,
    wavelengthRange,
    focusedData,
    samplingResult,
    displayIndices,
    displayedSamples: displayIndices.length,
    totalSamples: samplingResult.totalSamples,
    aggregatedStats,
    groupedStats,
    groupKeys,
    filteredData,
    getBaseLineColor,
    webglSampleColors,
    yAxisDomain,
    differenceStats,
    highDifferenceRegions,
    legendItems,
    ...viewState,
  };
}
