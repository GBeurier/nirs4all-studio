/**
 * RepetitionsChart - Visualize intra-sample variability (Phase 7)
 *
 * Displays the variability between multiple measurements (repetitions) of the
 * same biological sample. Helps identify:
 * - Samples with high measurement variability
 * - Outlier repetitions
 * - Batch effects across repetitions
 *
 * Features:
 * - Strip plot: X = bio sample, Y = distance from reference
 * - Dynamic distance metric computation via API
 * - Configurable quantile reference lines
 * - Selection integration with other charts
 * - X-axis zoom with mouse wheel/pan
 * - Export functionality
 */

import { useMemo, useState, useCallback, useRef, useEffect } from 'react';
import {
  type GlobalColorConfig,
  type ColorContext,
} from '@/lib/playground/colorConfig';
import { useSelection } from '@/context/useSelection';
import type { RepetitionResult } from '@/types/playground';
import type { UseSpectraChartConfigResult } from '@/lib/playground/useSpectraChartConfig';
import type { DiffQuantile } from '@/lib/playground/spectraConfig';
import {
  buildRepetitionQuantileValues,
  buildRepetitionsPlotModel,
  buildRepetitionsWebglData,
  buildRepetitionsYDomain,
  type RepetitionsPlotDataPoint,
  type RepetitionsSortOption,
} from '@/lib/playground/repetitionsChartData';
import {
  buildRepetitionsColorContext,
  getRepetitionsPointColor,
} from '@/lib/playground/repetitionsChartPresentation';
import { RepetitionsChartFooter } from './RepetitionsChartFooter';
import { RepetitionsChartEmptyState } from './RepetitionsChartEmptyState';
import { RepetitionsChartHeader } from './RepetitionsChartHeader';
import { RepetitionsRendererSurface } from './RepetitionsRendererSurface';
import { useRepetitionsChartInteractions } from './useRepetitionsChartInteractions';
import { useRepetitionsDistances } from './useRepetitionsDistances';

// ============= Types =============

interface RepetitionsChartProps {
  /** Repetition analysis data from backend */
  repetitionData: RepetitionResult | null | undefined;
  /** Raw spectra data for distance computation */
  spectraData?: number[][];
  /** Whether chart is in loading state */
  isLoading?: boolean;
  /** Enable SelectionContext integration */
  useSelectionContext?: boolean;
  /** Y values for target coloring */
  y?: number[];
  /** Compact mode */
  compact?: boolean;
  /** Callback to open repetition setup dialog */
  onConfigureRepetitions?: () => void;
  /** Global color configuration (unified system) */
  globalColorConfig?: GlobalColorConfig;
  /** Color context data for unified color system */
  colorContext?: ColorContext;
  /** Spectra chart config result for diff mode controls */
  configResult?: UseSpectraChartConfigResult;
  /** Whether reference dataset mode is active (affects dataset source visibility) */
  hasReferenceDataset?: boolean;
  /** Metadata columns indexed by column name (per-sample arrays). */
  metadata?: Record<string, unknown[]>;
  /** Ordered list of available metadata column names. */
  metadataColumns?: string[];
  /** Sample identifiers for each row in spectraData. */
  sampleIds?: string[];
}

function formatBioSampleLabel(value: string, maxLength: number = 14): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 1)}…`;
}

// ============= Constants =============

const EMPTY_SELECTED_SAMPLES = new Set<number>();
const EMPTY_DIFF_QUANTILES: DiffQuantile[] = [];

// ============= Component =============

export function RepetitionsChart({
  repetitionData,
  spectraData,
  isLoading = false,
  useSelectionContext = true,
  y,
  compact = false,
  onConfigureRepetitions,
  globalColorConfig,
  colorContext,
  configResult,
  hasReferenceDataset = false,
  metadata,
  metadataColumns,
  sampleIds,
}: RepetitionsChartProps) {
  const chartRef = useRef<HTMLDivElement>(null);
  const [showGrid, setShowGrid] = useState(true);
  const [enableHover, setEnableHover] = useState(true);

  // Note: Left-click area selection is now handled by SelectionContainer

  // Sort state
  const [sortBy, setSortBy] = useState<RepetitionsSortOption>('index');
  // Column used when sortBy === 'metadata_column'
  const [metadataSortColumn, setMetadataSortColumn] = useState<string | null>(null);

  // Effective metadata column list (filter out columns without usable values).
  const availableMetadataColumns = useMemo(() => {
    if (metadataColumns && metadataColumns.length > 0) return metadataColumns;
    if (metadata) return Object.keys(metadata);
    return [];
  }, [metadataColumns, metadata]);

  // If user selected metadata_column sort but no column is set, auto-pick first.
  useEffect(() => {
    if (sortBy === 'metadata_column' && !metadataSortColumn && availableMetadataColumns.length > 0) {
      setMetadataSortColumn(availableMetadataColumns[0]);
    }
  }, [sortBy, metadataSortColumn, availableMetadataColumns]);

  // Renderer type (Recharts/WebGL)
  const [rendererType, setRendererType] = useState<'recharts' | 'webgl'>('webgl');

  // SelectionContext integration — useSelection is conditional on the prop intentionally:
  // the hook is guarded by a boolean that is stable across renders, not a runtime value.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const selectionCtx = useSelectionContext ? useSelection() : null;
  const selectedSamples = selectionCtx?.selectedSamples ?? EMPTY_SELECTED_SAMPLES;

  // Check if we have valid repetition data
  const hasRepetitions = Boolean(repetitionData?.has_repetitions && repetitionData?.data);

  // Get diff config from configResult
  const diffConfig = configResult?.config.diffConfig;
  const metric = diffConfig?.metric ?? 'euclidean';
  const scaleType = diffConfig?.scaleType ?? 'linear';
  const quantiles = diffConfig?.quantiles ?? EMPTY_DIFF_QUANTILES;
  const repetitionReference = diffConfig?.repetitionReference ?? 'group_mean';

  const { computedDistances, isComputing } = useRepetitionsDistances({
    hasRepetitions,
    repetitionData,
    spectraData,
    metric,
    repetitionReference,
  });

  // Get display filter from colorContext
  const displayFilteredIndices = colorContext?.displayFilteredIndices;

  // Transform data for plotting
  const { plotData, bioSampleOrder, statistics, shouldWarnCollapsedBioSamples } = useMemo(() => buildRepetitionsPlotModel({
    repetitionData,
    spectraData,
    y,
    computedDistances,
    scaleType,
    displayFilteredIndices,
    sortBy,
    metadataSortColumn,
    metadata,
    sampleIds,
    selectedSamples,
  }), [
    repetitionData,
    spectraData,
    y,
    computedDistances,
    scaleType,
    displayFilteredIndices,
    sortBy,
    metadataSortColumn,
    metadata,
    sampleIds,
    selectedSamples,
  ]);

  useEffect(() => {
    if (import.meta.env?.DEV && shouldWarnCollapsedBioSamples) {
      console.warn(
        '[RepetitionsChart] Repetition data reports', bioSampleOrder.length, 'distinct bio_samples for',
        plotData.length, 'points — check that dataset_repetition / bio_sample_column is correctly propagated.'
      );
    }
  }, [shouldWarnCollapsedBioSamples, bioSampleOrder.length, plotData.length]);

  // Compute Y domain with 15% padding (needed by event handlers)
  const yDomain = useMemo(() => buildRepetitionsYDomain(plotData), [plotData]);

  // Max distance for color scaling
  const maxDistance = statistics?.max_distance ?? 1;

  const resolvedColorContext = useMemo(
    () => buildRepetitionsColorContext({
      colorContext,
      y,
      plotDataLength: plotData.length,
      selectedSamples,
    }),
    [colorContext, y, plotData.length, selectedSamples]
  );

  // Get point color - handles all global color modes
  const getPointColor = useCallback((point: RepetitionsPlotDataPoint): string => {
    return getRepetitionsPointColor({
      point,
      globalColorConfig,
      colorContext: resolvedColorContext,
      scaleType,
      maxDistance,
    });
  }, [globalColorConfig, resolvedColorContext, scaleType, maxDistance]);

  // Pre-computed WebGL props for 2D renderers (ScatterPureWebGL2D, ScatterRegl2D)
  const webglProps = useMemo(
    () => buildRepetitionsWebglData(plotData, getPointColor),
    [plotData, getPointColor]
  );

  const {
    isPanning,
    webglBounds,
    zoomInfo,
    effectiveXDomain,
    xTicks,
    handlePointClick,
    handleBackgroundClick,
    handleSelectionComplete,
    handleSelectionCompleteWebGL,
    handleContextMenu,
    handlePanMouseDown,
    handlePanMouseMove,
    handlePanMouseUp,
    handlePanMouseLeave,
    handleDoubleClick,
    handleExport,
  } = useRepetitionsChartInteractions({
    chartRef,
    repetitionData,
    computedDistances,
    selectionCtx,
    selectedSamples,
    plotData,
    bioSampleCount: bioSampleOrder.length,
    yDomain,
  });

  // Toggle grid
  const handleGridToggle = useCallback(() => {
    setShowGrid(prev => !prev);
  }, []);

  // Get quantile values for reference lines (must be before early returns — React Hook)
  const quantileValues = useMemo(
    () => buildRepetitionQuantileValues({ quantiles, computedDistances, statistics, scaleType }),
    [quantiles, computedDistances, statistics, scaleType]
  );

  // Empty states
  if (!repetitionData && plotData.length === 0) {
    return <RepetitionsChartEmptyState kind="loading" />;
  }

  if (repetitionData?.error) {
    return <RepetitionsChartEmptyState kind="error" error={repetitionData.error} />;
  }

  // Only show the full "No repetitions" placeholder when there is also no
  // spectra / y data that could be rendered in the no-repetition fallback.
  if (!hasRepetitions && plotData.length === 0) {
    return (
      <RepetitionsChartEmptyState
        kind="no-repetitions"
        message={repetitionData?.message}
        onConfigureRepetitions={onConfigureRepetitions}
      />
    );
  }

  const formatXAxisTick = (value: number) => {
    const label = bioSampleOrder[Math.round(value)];
    return label ? formatBioSampleLabel(label) : String(value);
  };

  return (
    <div
      className="h-full flex flex-col"
    >
      <RepetitionsChartHeader
        hasRepetitions={hasRepetitions}
        bioSampleCount={repetitionData?.n_with_reps ?? 0}
        groupCount={bioSampleOrder.length}
        compact={compact}
        isBusy={isComputing || isLoading}
        configResult={configResult}
        hasReferenceDataset={hasReferenceDataset}
        showGrid={showGrid}
        onGridToggle={handleGridToggle}
        sortBy={sortBy}
        onSortByChange={setSortBy}
        availableMetadataColumns={availableMetadataColumns}
        metadataSortColumn={metadataSortColumn}
        onMetadataSortColumnChange={setMetadataSortColumn}
        rendererType={rendererType}
        onRendererTypeChange={setRendererType}
        enableHover={enableHover}
        onEnableHoverChange={setEnableHover}
        zoomInfo={zoomInfo}
        onConfigureRepetitions={onConfigureRepetitions}
        onExport={handleExport}
      />

      <RepetitionsRendererSurface
        chartRef={chartRef}
        rendererType={rendererType}
        selectionTool={selectionCtx?.selectionToolMode ?? 'click'}
        selectionEnabled={!!selectionCtx}
        useSelectionContext={useSelectionContext}
        isPanning={isPanning}
        isComputing={isComputing}
        onRechartsSelectionComplete={handleSelectionComplete}
        onWebglSelectionComplete={handleSelectionCompleteWebGL}
        onBackgroundClick={handleBackgroundClick}
        onPanMouseDown={handlePanMouseDown}
        onPanMouseMove={handlePanMouseMove}
        onPanMouseUp={handlePanMouseUp}
        onPanMouseLeave={handlePanMouseLeave}
        onDoubleClick={handleDoubleClick}
        onContextMenu={handleContextMenu}
        webglBounds={webglBounds}
        scaleType={scaleType}
        xTicks={xTicks}
        bioSampleCount={bioSampleOrder.length}
        showGrid={showGrid}
        enableHover={enableHover}
        quantileValues={quantileValues}
        formatXAxisTick={formatXAxisTick}
        plotData={plotData}
        effectiveXDomain={effectiveXDomain}
        yDomain={yDomain}
        getPointColor={getPointColor}
        onPointClick={handlePointClick}
        webglData={webglProps}
        clearWebglOnBackgroundClick={selectionCtx?.selectionToolMode === 'click'}
      />

      <RepetitionsChartFooter
        compact={compact}
        hasRepetitions={hasRepetitions}
        repetitionData={repetitionData}
        plotDataLength={plotData.length}
        sortBy={sortBy}
        metadataSortColumn={metadataSortColumn}
        groupCount={bioSampleOrder.length}
        scaleType={scaleType}
        statistics={statistics}
        selectedCount={selectedSamples.size}
        highVariabilitySamples={repetitionData?.high_variability_samples}
      />
    </div>
  );
}

export default RepetitionsChart;
