/**
 * MainCanvas - Visualization canvas for spectral data and analysis
 *
 * Phase 2 Enhancement: Layout & View Management
 *
 * Features:
 * - Uses PlaygroundViewContext for centralized view state
 * - ChartPanel with header/footer for consistent UI
 * - Maximize/minimize/hide for individual views
 * - Smart grid layout adapting to visible chart count
 * - Smooth CSS transitions between states
 * - Loading skeletons during execution
 * - Cross-chart sample highlighting via SelectionContext
 * - Step-by-step comparison mode
 * - Raw Data Mode: Works without any pipeline operators
 * - Phase 6: WebGL rendering, export system, saved selections
 *
 * Performance Optimizations:
 * - useMemo for computed values
 * - useCallback for event handlers
 * - Skeleton placeholders during loading
 * - Charts render only when visible
 * - Render mode optimization (auto/canvas/webgl)
 */

import { useState, useMemo, useCallback, memo, useDeferredValue } from 'react';
import {
  type GlobalColorConfig,
  type ColorContext,
  DEFAULT_GLOBAL_COLOR_CONFIG,
} from '@/lib/playground/colorConfig';
import type { PartitionFilter } from '@/lib/playground/partitionFilters';
import type { OutlierMethod } from './OutlierSelector';
import type { DistanceMetric } from './SimilarityFilter';
import { useSelection } from '@/context/useSelection';
import type { ChartType } from '@/context/usePlaygroundView';
import { ALL_CHARTS } from '@/context/usePlaygroundView';
import { useFilterOptional } from '@/context/useFilter';
import { useReferenceDatasetOptional } from '@/context/useReferenceDataset';
import { useOutliers } from '@/context/useOutliers';
import {
  useRenderOptimizer,
  type RenderMode,
} from '@/lib/playground/renderOptimizer';
import {
  buildCanvasChartRenderStates,
  buildEffectiveChartLoading,
  buildEffectiveVisibleCharts,
  computeCanvasGridLayout,
  countVisibleNonMinimizedCharts,
  getMinimizedCanvasCharts,
} from '@/lib/playground/canvasLayout';
import {
  buildCanvasColorContext,
  buildCanvasDisplayFilteredIndices,
  buildCanvasFilterDataContext,
  mergeCanvasOutlierIndices,
  resolveCanvasFilteredIndices,
} from '@/lib/playground/canvasSampleScope';
import { isPlaygroundRawDataMode } from '@/lib/playground/operatorMode';

import { MainCanvasEmptyState } from './MainCanvasEmptyState';
import { MainCanvasRenderSections } from './MainCanvasRenderSections';
import { getToggleableCharts } from './ChartRegistry';
import type { ToggleableChartControl } from './CanvasToolbarViewGroup';
import { useInteractionPending } from './hooks/useInteractionPending';
import { useMainCanvasChartInputs } from './hooks/useMainCanvasChartInputs';
import { useMainCanvasExports } from './hooks/useMainCanvasExports';
import { useMainCanvasViewState } from './hooks/useMainCanvasViewState';
import { useStaggeredChartMount } from './hooks/useStaggeredChartMount';
import { useSpectraChartConfig } from '@/lib/playground/useSpectraChartConfig';
import type { SpectraViewMode } from '@/lib/playground/spectraConfig';

import type { PlaygroundResult, UnifiedOperator, MetricsResult, MetricFilter, OutlierResult, SimilarityResult, PerChartLoadingState, SubsetInfo } from '@/types/playground';
import type { SpectralData } from '@/types/spectral';
import type { DatasetSchemaRef } from '@/lib/datasetSchema';

// ============= Types =============

interface MainCanvasProps {
  /** Raw spectral data */
  rawData: SpectralData | null;
  /** Backend execution result */
  result: PlaygroundResult | null;
  /** Whether currently loading/processing */
  isLoading?: boolean;
  /** Whether data is being fetched */
  isFetching?: boolean;
  /** Selected sample index (for cross-chart highlighting) */
  selectedSample?: number | null;
  /** Callback when sample is selected */
  onSelectSample?: (index: number | null) => void;
  /** All pipeline operators used by charts that need pipeline context */
  operators?: UnifiedOperator[];
  /** Callback when "Filter to Selection" is clicked */
  onFilterToSelection?: (selectedIndices: number[]) => void;
  /** Whether UMAP computation is enabled (currently unused) */
  computeUmap?: boolean;
  /** Callback to enable/disable UMAP computation */
  onComputeUmapChange?: (enabled: boolean) => void;
  /** Whether UMAP is currently being computed */
  isUmapLoading?: boolean;
  /** Subset mode: 'all' or 'visible' (OPT-3) */
  subsetMode?: 'all' | 'visible';
  /** Callback when subset mode changes */
  onSubsetModeChange?: (mode: 'all' | 'visible') => void;
  // === Phase 5: Advanced Filtering & Metrics ===
  /** Computed metrics for current dataset */
  metrics?: MetricsResult | null;
  /** Callback to detect outliers via API */
  onDetectOutliers?: (method: OutlierMethod, threshold: number) => Promise<OutlierResult>;
  /** Callback to find similar samples via API */
  onFindSimilar?: (referenceIdx: number, metric: DistanceMetric, threshold?: number, topK?: number) => Promise<SimilarityResult>;
  /** Active metric filters */
  metricFilters?: MetricFilter[];
  /** Callback when metric filters change */
  onMetricFiltersChange?: (filters: MetricFilter[]) => void;
  /** Whether to show embedding selector overlay */
  showEmbeddingOverlay?: boolean;
  /** Callback to toggle embedding overlay */
  onToggleEmbeddingOverlay?: () => void;
  // === Phase 6: Render Mode & Export ===
  /** Forced render mode (auto, canvas, webgl) */
  renderMode?: RenderMode;
  /** Callback when render mode changes */
  onRenderModeChange?: (mode: RenderMode) => void;
  /** Dataset ID for saved selections */
  datasetId?: string;
  /** Optional dataset schema projection for future multimodal data-view compatibility */
  datasetSchemaRef?: DatasetSchemaRef | null;
  /** Last outlier detection result - from operators */
  lastOutlierResult?: OutlierResult | null;
  // === Chart Toggle Notification ===
  /** Called when a chart is toggled from the toolbar — lets the parent sync execute options (e.g. compute_repetitions) */
  onChartToggle?: (chart: ChartType) => void;
  // === Granular Chart Loading ===
  /** Per-chart loading states from change detection */
  chartLoadingStates?: PerChartLoadingState;
}

// ============= Main Component =============

export function MainCanvas({
  rawData,
  result,
  isLoading = false,
  isFetching = false,
  selectedSample: externalSelectedSample,
  onSelectSample: externalOnSelectSample,
  operators = [],
  onFilterToSelection,
  computeUmap: _computeUmap = false,
  onComputeUmapChange,
  isUmapLoading = false,
  subsetMode: _subsetMode = 'all',
  onSubsetModeChange,
  // Phase 5 props
  metrics,
  onDetectOutliers,
  onFindSimilar,
  metricFilters = [],
  onMetricFiltersChange,
  showEmbeddingOverlay = false,
  onToggleEmbeddingOverlay,
  // Phase 6 props
  renderMode: _externalRenderMode,
  onRenderModeChange,
  datasetSchemaRef,
  lastOutlierResult,
  // Chart toggle notification
  onChartToggle,
  // Granular chart loading
  chartLoadingStates,
}: MainCanvasProps) {
  const {
    visibleCharts,
    maximizedChart,
    toggleChart,
    getChartViewState,
    handleRestore,
    handleHide,
    chartActions,
  } = useMainCanvasViewState({ onChartToggle });

  // ============= Other State =============

  // Local sample selection (if not controlled)
  const [internalSelectedSample, setInternalSelectedSample] = useState<number | null>(null);
  const selectedSample = externalSelectedSample ?? internalSelectedSample;
  const setSelectedSample = externalOnSelectSample ?? setInternalSelectedSample;

  // Color configuration (unified global)
  const [colorConfig, setColorConfig] = useState<GlobalColorConfig>(DEFAULT_GLOBAL_COLOR_CONFIG);

  // Phase 7: Spectra chart configuration (lifted for global control)
  const spectraConfigResult = useSpectraChartConfig();
  const spectraViewMode = spectraConfigResult.config.viewMode;

  // Phase 7: Absolute difference mode state
  const [showAbsoluteDifference, setShowAbsoluteDifference] = useState(false);

  const handleSpectraViewModeChange = useCallback((mode: SpectraViewMode) => {
    spectraConfigResult.setViewMode(mode);
  }, [spectraConfigResult]);

  const handleToggleAbsoluteDifference = useCallback(() => {
    setShowAbsoluteDifference(prev => !prev);
  }, []);

  // Filter context (Phase 4) - centralized filtering
  const filterContext = useFilterOptional();

  // Phase 6: Reference dataset context
  const referenceCtx = useReferenceDatasetOptional();

  // Local fallback for partition filter (used when not in FilterProvider)
  const [localPartitionFilter, setLocalPartitionFilter] = useState<PartitionFilter>('all');

  // Use context if available, otherwise local state
  const partitionFilter = filterContext?.partition ?? localPartitionFilter;
  const setPartitionFilter = filterContext?.setPartitionFilter ?? setLocalPartitionFilter;

  // Deferred result for secondary charts (histogram, PCA, folds, repetitions)
  // This allows the spectra chart to render first while others are deferred
  const deferredResult = useDeferredValue(result);
  const isSecondaryChartsStale = deferredResult !== result;

  const {
    dataView,
    toolbarDataState,
    totalSamples,
    toolbarSampleIds,
    yValues,
    yMin,
    yMax,
    targetType,
    classLabels,
    classLabelMap,
    columnMetadata,
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
  } = useMainCanvasChartInputs({
    rawData,
    result,
    deferredResult,
    datasetSchemaRef,
    referencePca: referenceCtx?.referenceResult?.pca,
    referenceLabel: referenceCtx?.referenceInfo?.datasetName,
  });

  // Render mode optimization
  const totalSamplesForRender = dataView.rawSampleCount || dataView.processedSampleCount;
  const wavelengthCountForRender = dataView.rawFeatureCount || dataView.processedFeatureCount;

  const { renderMode: effectiveMode, setForceMode, forceMode } = useRenderOptimizer({
    nSamples: totalSamplesForRender,
    nWavelengths: wavelengthCountForRender,
    hasOverlay: false,
    has3DView: false,
  });

  const displayRenderMode: RenderMode = forceMode ?? 'auto';

  const handleRenderModeChange = useCallback((mode: RenderMode) => {
    setForceMode(mode === 'auto' ? null : mode);
    onRenderModeChange?.(mode);
  }, [setForceMode, onRenderModeChange]);

  const {
    hasPartition,
    hasFolds,
    showFoldsChart,
    hasRepetitions,
  } = toolbarDataState;

  const toggleableCharts = useMemo<readonly ToggleableChartControl[]>(() => {
    const chartIds = new Set<ChartType>(ALL_CHARTS);
    return getToggleableCharts({
      result: deferredResult,
      rawData,
      dataView: dataView.spectralProjection,
    })
      .filter((chart) => chartIds.has(chart.id as ChartType))
      .map((chart) => ({
        ...chart,
        id: chart.id as ChartType,
      }));
  }, [dataView.spectralProjection, deferredResult, rawData]);

  // Effective visible charts (filter out folds/repetitions if not available)
  const effectiveVisibleCharts = useMemo(() => {
    const visible = buildEffectiveVisibleCharts(visibleCharts, showFoldsChart);
    // Keep 'repetitions' visible even when no repetitions are detected, since
    // the chart now also renders samples in a "no repetition" fallback mode
    // (one point per sample, with optional metadata-column grouping). The user
    // toggles visibility explicitly from the sidebar.
    return visible;
  }, [visibleCharts, showFoldsChart]);

  // OPT-8: Staggered chart mounting to avoid rendering burst
  const hasData = !!(rawData || result);
  const { isChartMounted } = useStaggeredChartMount({
    hasData,
    visibleCharts: effectiveVisibleCharts,
  });

  // Skeleton display logic
  const showSkeletons = isLoading && !result;

  const { triggerInteractionPending } = useInteractionPending({
    isFetching,
    isLoading,
  });

  // Per-chart loading states: use granular states from useChangeDetection
  // The hook already handles all fetching/loading logic internally based on isFetching and hasResult
  const effectiveChartLoading = useMemo<PerChartLoadingState>(() => {
    return buildEffectiveChartLoading(chartLoadingStates, isUmapLoading);
  }, [chartLoadingStates, isUmapLoading]);

  const isRawDataMode = isPlaygroundRawDataMode(operators);

  // Get selection context
  // Note: hoveredSample is NOT extracted here - charts get it directly from SelectionContext
  // This prevents cascade re-renders when hover changes
  const {
    selectedSamples,
    selectedCount,
    pinnedSamples: contextPinnedSamples,
    pinnedCount,
    clear: clearSelection,
  } = useSelection();

  // Handle filter to selection
  const handleFilterToSelection = useCallback(() => {
    if (onFilterToSelection && selectedCount > 0) {
      const selectedIndices = Array.from(selectedSamples);
      onFilterToSelection(selectedIndices);
      clearSelection();
    }
  }, [onFilterToSelection, selectedCount, selectedSamples, clearSelection]);

  // Count visible (non-hidden, non-minimized) charts for layout
  const visibleNonMinimizedCount = useMemo(() => {
    return countVisibleNonMinimizedCharts(effectiveVisibleCharts, getChartViewState);
  }, [effectiveVisibleCharts, getChartViewState]);

  // Handle sample selection
  const handleCloseSampleDetails = useCallback(() => {
    setSelectedSample(null);
  }, [setSelectedSample]);

  const handleRequestUmap = useCallback(() => {
    onComputeUmapChange?.(true);
  }, [onComputeUmapChange]);

  // Merge outlier indices from explicit detection AND from OutliersContext (filter tag mode)
  const { allOutliers: contextOutliers } = useOutliers();
  const lastOutlierIndices = lastOutlierResult?.outlier_indices;
  const outlierIndicesSet = useMemo(() => {
    return mergeCanvasOutlierIndices(lastOutlierIndices, contextOutliers);
  }, [lastOutlierIndices, contextOutliers]);

  const spectraOutlierIndices = useMemo(() => {
    return lastOutlierIndices ? new Set(lastOutlierIndices) : undefined;
  }, [lastOutlierIndices]);

  // Get partition-filtered indices
  // Build filter data context for FilterContext
  const filterDataContext = useMemo(() => buildCanvasFilterDataContext({
    totalSamples,
    folds: effectiveFolds,
    outlierIndices: outlierIndicesSet,
    selectedSamples,
    metadata: columnMetadata,
  }), [totalSamples, effectiveFolds, outlierIndicesSet, selectedSamples, columnMetadata]);

  // Get filtered indices - use FilterContext if available, otherwise just partition filter
  const filteredIndices = useMemo(() => resolveCanvasFilteredIndices({
    filterContext,
    filterDataContext,
    partitionFilter,
    folds: effectiveFolds,
    totalSamples,
  }), [filterContext, filterDataContext, partitionFilter, effectiveFolds, totalSamples]);

  // Check if we need to filter display data
  const hasDisplayFilter = filterContext?.hasActiveFilters ?? false;
  const displayFilteredIndices = useMemo(
    () => buildCanvasDisplayFilteredIndices(filteredIndices, hasDisplayFilter),
    [filteredIndices, hasDisplayFilter]
  );

  // Compute color context
  // NOTE: hoveredSample is intentionally NOT included here to avoid cascade re-renders
  // Charts that need hover highlighting should get it from SelectionContext directly
  // NOTE: Expensive computations (yMin/yMax, trainIndices, testIndices, outlierIndices)
  // are memoized separately above to avoid recomputation on selection changes
  const colorContext = useMemo<ColorContext>(() => buildCanvasColorContext({
    yValues,
    yMin,
    yMax,
    trainIndices,
    testIndices,
    folds: effectiveFolds,
    metadata: columnMetadata,
    outlierIndices: outlierIndicesSet,
    totalSamples,
    selectedSamples,
    pinnedSamples: contextPinnedSamples,
    displayFilteredIndices,
    targetType,
    classLabels,
    classLabelMap,
  }), [yValues, yMin, yMax, trainIndices, testIndices, effectiveFolds, columnMetadata, outlierIndicesSet, totalSamples, selectedSamples, contextPinnedSamples, displayFilteredIndices, targetType, classLabels, classLabelMap]);

  // Compute grid layout
  const hasMaximized = maximizedChart !== null;
  const { gridCols, gridRows } = computeCanvasGridLayout(visibleNonMinimizedCount, hasMaximized);

  const {
    chartRefs,
    exportChartPng,
    exportSpectraCsv,
    exportSelectionsJson,
    batchExportCharts,
    exportCombinedReportPng,
  } = useMainCanvasExports({
    rawData,
    result,
    selectedSamples,
    pinnedSamples: contextPinnedSamples,
    outlierIndices: lastOutlierResult?.outlier_indices,
    visibleCharts: effectiveVisibleCharts,
    dataView: dataView.spectralProjection,
  });

  // ============= Render Helper =============

  const chartRenderStates = useMemo(() => {
    return buildCanvasChartRenderStates({
      visibleCharts: effectiveVisibleCharts,
      getChartViewState,
      hasMaximized,
      maximizedChart,
      chartLoading: effectiveChartLoading,
      showSkeletons,
      isChartMounted,
    });
  }, [
    effectiveVisibleCharts,
    getChartViewState,
    hasMaximized,
    maximizedChart,
    effectiveChartLoading,
    showSkeletons,
    isChartMounted,
  ]);

  const minimizedCharts = useMemo(
    () => getMinimizedCanvasCharts(effectiveVisibleCharts, getChartViewState),
    [effectiveVisibleCharts, getChartViewState]
  );

  // ============= Empty State =============

  if (!rawData) {
    return <MainCanvasEmptyState />;
  }

  // ============= Main Render =============

  return (
    <MainCanvasRenderSections
      sampleDetailsData={sampleDetailsData}
      selectedSample={selectedSample}
      onCloseSampleDetails={handleCloseSampleDetails}
      showRawDataModeBanner={isRawDataMode}
      toolbarProps={{
        effectiveVisibleCharts,
        onToggleChart: toggleChart,
        toggleableCharts,
        hasFolds: !!hasFolds,
        hasPartition,
        showFoldsChart,
        hasRepetitions,
        isFetching,
        selectedCount,
        onFilterToSelection: onFilterToSelection ? handleFilterToSelection : undefined,
        partitionFilter,
        onPartitionFilterChange: setPartitionFilter,
        folds: effectiveFolds,
        totalSamples,
        metadata: columnMetadata,
        metrics,
        metricObservations: result?.metricObservations ?? null,
        metricFilters,
        onMetricFiltersChange,
        onDetectOutliers,
        onFindSimilar,
        selectedSample,
        sampleIds: toolbarSampleIds,
        colorConfig,
        onColorConfigChange: setColorConfig,
        hasOutliers: !!lastOutlierResult && lastOutlierResult.outlier_indices.length > 0,
        colorContext,
        onInteractionStart: triggerInteractionPending,
        spectraViewMode,
        onSpectraViewModeChange: handleSpectraViewModeChange,
        showAbsoluteDifference,
        onToggleAbsoluteDifference: handleToggleAbsoluteDifference,
        subsetMode: _subsetMode,
        onSubsetModeChange,
        subsetInfo: result?.subsetInfo,
      }}
      chartGridProps={{
        gridCols,
        gridRows,
        chartRefs,
        chartRenderStates,
        spectraChartInput,
        embeddingOverlayInput,
        histogramChartInput,
        foldDistributionChartInput,
        dimensionReductionChartInput,
        repetitionsChartInput,
        totalSamples,
        histogramSampleCount: filteredIndices.length,
        selectedCount,
        pinnedCount,
        colorConfig,
        colorContext,
        onInteractionStart: triggerInteractionPending,
        operators,
        renderMode: effectiveMode,
        displayRenderMode,
        onRenderModeChange: handleRenderModeChange,
        spectraOutlierIndices,
        referenceDataset: referenceCtx?.referenceResult?.processed,
        referenceLabel: referenceCtx?.referenceInfo?.datasetName,
        spectraConfigResult,
        showAbsoluteDifference,
        showEmbeddingOverlay,
        onToggleEmbeddingOverlay,
        isSecondaryChartsStale,
        isUmapLoading,
        onRequestUMAP: onComputeUmapChange ? handleRequestUmap : undefined,
        chartActions,
        minimizedCharts,
        onRestore: handleRestore,
        onHide: handleHide,
      }}
    />
  );
}

export default memo(MainCanvas);
