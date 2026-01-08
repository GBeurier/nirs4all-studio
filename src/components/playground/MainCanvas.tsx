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

import { useState, useMemo, useCallback, useRef, useEffect, memo } from 'react';
import { FlaskConical, Info } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  SpectraChartV2,
  YHistogramV2,
  DimensionReductionChart,
  FoldDistributionChartV2,
  RepetitionsChart,
  ChartSkeleton,
} from './visualizations';
import {
  type GlobalColorConfig,
  type ColorContext,
  DEFAULT_GLOBAL_COLOR_CONFIG,
} from '@/lib/playground/colorConfig';
import {
  detectTargetType,
  createClassLabelMap,
  type TargetType,
} from '@/lib/playground/targetTypeDetection';
import { SampleDetails } from './SampleDetails';
import { type PartitionFilter, getPartitionIndices } from './PartitionSelector';
import type { OutlierMethod } from './OutlierSelector';
import type { DistanceMetric } from './SimilarityFilter';
import { EmbeddingSelector } from './EmbeddingSelector';
import { useSelection } from '@/context/SelectionContext';
import {
  usePlaygroundViewOptional,
  type ChartType,
  type ViewState,
} from '@/context/PlaygroundViewContext';
import {
  useFilterOptional,
  type FilterDataContext,
} from '@/context/FilterContext';
import {
  useRenderOptimizer,
  type RenderMode,
} from '@/lib/playground/renderOptimizer';

import { CanvasToolbar } from './CanvasToolbar';
import { ChartPanel } from './ChartPanel';
import { usePlaygroundExport, type ChartRefs } from './hooks/usePlaygroundExport';

import type { PlaygroundResult, UnifiedOperator, MetricsResult, MetricFilter, OutlierResult, SimilarityResult } from '@/types/playground';
import type { SpectralData } from '@/types/spectral';

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
  /** All pipeline operators (for step comparison) */
  operators?: UnifiedOperator[];
  /** Step comparison mode enabled */
  stepComparisonEnabled?: boolean;
  /** Callback when step comparison enabled state changes */
  onStepComparisonEnabledChange?: (enabled: boolean) => void;
  /** Current active step in comparison mode */
  activeStep?: number;
  /** Callback when active step changes */
  onActiveStepChange?: (step: number) => void;
  /** Callback when "Filter to Selection" is clicked */
  onFilterToSelection?: (selectedIndices: number[]) => void;
  /** Whether UMAP computation is enabled (currently unused) */
  computeUmap?: boolean;
  /** Callback to enable/disable UMAP computation */
  onComputeUmapChange?: (enabled: boolean) => void;
  /** Whether UMAP is currently being computed */
  isUmapLoading?: boolean;
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
  /** Last outlier detection result - from operators */
  lastOutlierResult?: OutlierResult | null;
}

// ============= Sub-Components =============

/**
 * Raw Data Mode banner - shown when no operators are in the pipeline
 */
const RawDataModeBanner = memo(function RawDataModeBanner() {
  return (
    <div className="flex items-center gap-2 px-3 py-2 bg-blue-500/10 border-b border-blue-500/20">
      <Info className="w-4 h-4 text-blue-500 shrink-0" />
      <span className="text-xs text-blue-700 dark:text-blue-300">
        <strong>Raw Data Mode:</strong> Viewing original data without preprocessing.
        Add operators from the palette to transform your spectra.
      </span>
    </div>
  );
});

// ============= Grid Layout Utilities =============

/**
 * Compute smart grid layout classes based on visible chart count and layout mode
 * Handles special cases like 3 views (2x2 with spanning)
 */
function computeGridLayout(visibleCount: number, hasMaximized: boolean): { gridCols: string; gridRows: string } {
  // When maximized, single cell takes all space
  if (hasMaximized) {
    return { gridCols: 'grid-cols-1', gridRows: 'grid-rows-1' };
  }

  switch (visibleCount) {
    case 1:
      return { gridCols: 'grid-cols-1', gridRows: 'grid-rows-1' };
    case 2:
      return { gridCols: 'grid-cols-1 sm:grid-cols-2', gridRows: 'grid-rows-1' };
    case 3:
      // 2x2 grid with one spanning (handled via CSS in the first/last child)
      return { gridCols: 'grid-cols-2', gridRows: 'grid-rows-2' };
    case 4:
      return { gridCols: 'grid-cols-2', gridRows: 'grid-rows-2' };
    case 5:
    default:
      return { gridCols: 'grid-cols-2', gridRows: 'grid-rows-3' };
  }
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
  stepComparisonEnabled = false,
  onStepComparisonEnabledChange,
  activeStep = 0,
  onActiveStepChange,
  onFilterToSelection,
  computeUmap: _computeUmap = false,
  onComputeUmapChange,
  isUmapLoading = false,
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
  datasetId: _datasetId,
  lastOutlierResult,
}: MainCanvasProps) {
  // ============= View Context (Phase 2) =============
  // Use optional hook - falls back to local state if not within provider
  const viewContext = usePlaygroundViewOptional();

  // Local fallback state for chart visibility (used when not in provider)
  const [localVisibleCharts, setLocalVisibleCharts] = useState<Set<ChartType>>(
    new Set(['spectra', 'histogram', 'pca'])
  );
  const [localMaximizedChart, setLocalMaximizedChart] = useState<ChartType | null>(null);
  const [localMinimizedCharts, setLocalMinimizedCharts] = useState<Set<ChartType>>(new Set());

  // Determine which state to use
  const visibleCharts = viewContext?.visibleCharts ?? localVisibleCharts;
  const maximizedChart = viewContext?.maximizedChart ?? localMaximizedChart;

  // Toggle chart visibility
  const toggleChart = useCallback((chart: ChartType) => {
    if (viewContext) {
      viewContext.toggleChart(chart);
    } else {
      setLocalVisibleCharts(prev => {
        const next = new Set(prev);
        if (next.has(chart)) {
          next.delete(chart);
        } else {
          next.add(chart);
        }
        return next;
      });
    }
  }, [viewContext]);

  // Get chart view state
  const getChartViewState = useCallback((chart: ChartType): ViewState => {
    if (viewContext) {
      return viewContext.chartStates[chart];
    }
    if (!localVisibleCharts.has(chart)) return 'hidden';
    if (localMaximizedChart === chart) return 'maximized';
    if (localMinimizedCharts.has(chart)) return 'minimized';
    return 'visible';
  }, [viewContext, localVisibleCharts, localMaximizedChart, localMinimizedCharts]);

  // Maximize chart handler
  const handleMaximize = useCallback((chart: ChartType) => {
    if (viewContext) {
      viewContext.maximizeChart(chart);
    } else {
      setLocalMaximizedChart(chart);
    }
  }, [viewContext]);

  // Minimize chart handler
  const handleMinimize = useCallback((chart: ChartType) => {
    if (viewContext) {
      viewContext.minimizeChart(chart);
    } else {
      setLocalMinimizedCharts(prev => new Set([...prev, chart]));
    }
  }, [viewContext]);

  // Restore chart handler
  const handleRestore = useCallback((chart: ChartType) => {
    if (viewContext) {
      viewContext.restoreChart(chart);
    } else {
      if (localMaximizedChart === chart) {
        setLocalMaximizedChart(null);
      }
      setLocalMinimizedCharts(prev => {
        const next = new Set(prev);
        next.delete(chart);
        return next;
      });
    }
  }, [viewContext, localMaximizedChart]);

  // Hide chart handler
  const handleHide = useCallback((chart: ChartType) => {
    toggleChart(chart);
  }, [toggleChart]);

  // ============= Other State =============

  // Local sample selection (if not controlled)
  const [internalSelectedSample, setInternalSelectedSample] = useState<number | null>(null);
  const selectedSample = externalSelectedSample ?? internalSelectedSample;
  const setSelectedSample = externalOnSelectSample ?? setInternalSelectedSample;

  // Color configuration (unified global)
  const [colorConfig, setColorConfig] = useState<GlobalColorConfig>(DEFAULT_GLOBAL_COLOR_CONFIG);

  // Filter context (Phase 4) - centralized filtering
  const filterContext = useFilterOptional();

  // Local fallback for partition filter (used when not in FilterProvider)
  const [localPartitionFilter, setLocalPartitionFilter] = useState<PartitionFilter>('all');

  // Use context if available, otherwise local state
  const partitionFilter = filterContext?.partition ?? localPartitionFilter;
  const setPartitionFilter = filterContext?.setPartitionFilter ?? setLocalPartitionFilter;

  // Chart container refs for export
  const spectraChartRef = useRef<HTMLDivElement>(null);
  const histogramChartRef = useRef<HTMLDivElement>(null);
  const pcaChartRef = useRef<HTMLDivElement>(null);
  const foldsChartRef = useRef<HTMLDivElement>(null);
  const repetitionsChartRef = useRef<HTMLDivElement>(null);

  // Render mode optimization
  const totalSamplesForRender = rawData?.spectra?.length ?? result?.processed?.spectra?.length ?? 0;
  const wavelengthCountForRender = rawData?.wavelengths?.length ?? result?.processed?.wavelengths?.length ?? 0;

  const { renderMode: effectiveMode, webglAvailable: isWebGL, setForceMode, forceMode } = useRenderOptimizer({
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

  // Skeleton display logic
  const showSkeletons = isLoading && !result;

  // Track interaction pending state for loading overlay
  const [interactionPending, setInteractionPending] = useState(false);
  const interactionTimeoutRef = useRef<number | null>(null);

  const triggerInteractionPending = useCallback(() => {
    if (interactionTimeoutRef.current) {
      clearTimeout(interactionTimeoutRef.current);
    }
    setInteractionPending(true);
    interactionTimeoutRef.current = window.setTimeout(() => setInteractionPending(false), 1200);
  }, []);

  useEffect(() => () => {
    if (interactionTimeoutRef.current) {
      clearTimeout(interactionTimeoutRef.current);
    }
  }, []);

  useEffect(() => {
    if (isFetching || isLoading) {
      setInteractionPending(true);
      if (interactionTimeoutRef.current) {
        clearTimeout(interactionTimeoutRef.current);
      }
      return;
    }
    interactionTimeoutRef.current = window.setTimeout(() => setInteractionPending(false), 150);
  }, [isFetching, isLoading]);

  const chartRedrawing = ((isFetching || isLoading) && !!result && !showSkeletons) || interactionPending;

  // Check if pipeline has any operators
  const hasOperators = operators.length > 0;
  const enabledOperatorCount = operators.filter(op => op.enabled).length;
  const isRawDataMode = !hasOperators || enabledOperatorCount === 0;

  // Get selection context
  const {
    selectedSamples,
    selectedCount,
    pinnedSamples: contextPinnedSamples,
    pinnedCount,
    hoveredSample: contextHoveredSample,
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

  // Check if we have folds
  const hasFolds = useMemo(() => {
    return result?.folds && result.folds.n_folds > 0;
  }, [result?.folds]);

  // Check if we have repetitions
  const hasRepetitions = useMemo(() => {
    return result?.repetitions?.has_repetitions ?? false;
  }, [result?.repetitions]);

  // Effective visible charts (filter out folds/repetitions if not available)
  const effectiveVisibleCharts = useMemo(() => {
    const visible = new Set(visibleCharts);
    if (!hasFolds && visible.has('folds')) {
      visible.delete('folds');
    }
    if (!hasRepetitions && visible.has('repetitions')) {
      visible.delete('repetitions');
    }
    return visible;
  }, [visibleCharts, hasFolds, hasRepetitions]);

  // Count visible (non-hidden, non-minimized) charts for layout
  const visibleNonMinimizedCount = useMemo(() => {
    let count = 0;
    for (const chart of effectiveVisibleCharts) {
      const state = getChartViewState(chart);
      if (state === 'visible' || state === 'maximized') {
        count++;
      }
    }
    return count;
  }, [effectiveVisibleCharts, getChartViewState]);

  // Handle sample selection
  const handleCloseSampleDetails = useCallback(() => {
    setSelectedSample(null);
  }, [setSelectedSample]);

  // Get Y values
  const yValues = useMemo(() => {
    if (result?.processed?.spectra && rawData?.y) {
      return rawData.y;
    }
    return rawData?.y ?? [];
  }, [result, rawData]);

  // Convert metadata format
  const columnMetadata = useMemo((): Record<string, unknown[]> | undefined => {
    if (!rawData?.metadata || !Array.isArray(rawData.metadata) || rawData.metadata.length === 0) {
      return undefined;
    }
    const keys = new Set<string>();
    rawData.metadata.forEach(item => {
      if (item && typeof item === 'object') {
        Object.keys(item).forEach(key => keys.add(key));
      }
    });
    const result: Record<string, unknown[]> = {};
    keys.forEach(key => {
      result[key] = rawData.metadata!.map(item => item?.[key] ?? null);
    });
    return Object.keys(result).length > 0 ? result : undefined;
  }, [rawData?.metadata]);

  const metadataColumns = useMemo(() => {
    return columnMetadata ? Object.keys(columnMetadata) : undefined;
  }, [columnMetadata]);

  // Total sample count
  const totalSamples = useMemo(() => {
    return rawData?.spectra?.length ?? result?.processed?.spectra?.length ?? 0;
  }, [rawData, result]);

  // Get partition-filtered indices
  // Build filter data context for FilterContext
  const filterDataContext = useMemo<FilterDataContext>(() => ({
    totalSamples,
    folds: result?.folds ?? null,
    outlierIndices: lastOutlierResult ? new Set(lastOutlierResult.outlier_indices) : new Set(),
    selectedSamples,
    metadata: columnMetadata ?? null,
  }), [totalSamples, result?.folds, lastOutlierResult, selectedSamples, columnMetadata]);

  // Get filtered indices - use FilterContext if available, otherwise just partition filter
  const filteredIndices = useMemo(() => {
    if (filterContext) {
      return filterContext.getFilteredIndices(filterDataContext);
    }
    // Fallback to partition filter only
    return getPartitionIndices(partitionFilter, result?.folds ?? null, totalSamples);
  }, [filterContext, filterDataContext, partitionFilter, result?.folds, totalSamples]);

  // Create a Set of filtered indices for efficient lookup
  const filteredIndicesSet = useMemo(() => new Set(filteredIndices), [filteredIndices]);

  // Check if we need to filter display data
  const hasDisplayFilter = filterContext?.hasActiveFilters ?? false;

  // Phase 5: Detect target type (regression vs classification)
  const targetTypeResult = useMemo(() => {
    if (!yValues || yValues.length === 0) return null;
    return detectTargetType(yValues);
  }, [yValues]);

  const targetType: TargetType | undefined = targetTypeResult?.type;
  const classLabels: string[] | undefined = targetTypeResult?.classLabels;
  const classLabelMap = useMemo(() => {
    if (!classLabels) return undefined;
    return createClassLabelMap(classLabels);
  }, [classLabels]);

  // Compute color context
  const colorContext = useMemo<ColorContext>(() => {
    let trainIndices: Set<number> | undefined;
    let testIndices: Set<number> | undefined;

    if (result?.folds?.folds && result.folds.folds.length > 0) {
      trainIndices = new Set<number>();
      testIndices = new Set<number>();

      for (const fold of result.folds.folds) {
        if (fold.train_indices) {
          fold.train_indices.forEach(i => trainIndices!.add(i));
        }
        if (fold.test_indices) {
          fold.test_indices.forEach(i => testIndices!.add(i));
        }
      }
    }

    const outlierIndices = lastOutlierResult
      ? new Set(lastOutlierResult.outlier_indices)
      : undefined;

    const yMin = yValues.length > 0 ? Math.min(...yValues) : 0;
    const yMax = yValues.length > 0 ? Math.max(...yValues) : 1;

    return {
      y: yValues,
      yMin,
      yMax,
      trainIndices,
      testIndices,
      foldLabels: result?.folds?.fold_labels,
      metadata: columnMetadata,
      outlierIndices,
      totalSamples,
      selectedSamples,
      pinnedSamples: contextPinnedSamples,
      hoveredSample: contextHoveredSample,
      displayFilteredIndices: hasDisplayFilter ? filteredIndicesSet : undefined,
      // Phase 5: Classification support
      targetType,
      classLabels,
      classLabelMap,
    };
  }, [yValues, result?.folds, lastOutlierResult, columnMetadata, totalSamples, selectedSamples, contextPinnedSamples, contextHoveredSample, hasDisplayFilter, filteredIndicesSet, targetType, classLabels, classLabelMap]);

  // Compute grid layout
  const hasMaximized = maximizedChart !== null;
  const { gridCols, gridRows } = computeGridLayout(visibleNonMinimizedCount, hasMaximized);

  // Step comparison handlers
  const handleActiveStepChange = useCallback((step: number) => {
    onActiveStepChange?.(step);
  }, [onActiveStepChange]);

  // Chart refs for export
  const chartRefs: ChartRefs = useMemo(() => ({
    spectra: spectraChartRef,
    histogram: histogramChartRef,
    pca: pcaChartRef,
    folds: foldsChartRef,
    repetitions: repetitionsChartRef,
  }), []);

  // Export data
  const exportData = useMemo(() => ({
    spectra: result?.processed?.spectra ?? rawData?.spectra ?? null,
    wavelengths: result?.processed?.wavelengths ?? rawData?.wavelengths ?? null,
    sampleIds: rawData?.sampleIds,
    selectedSamples,
    pinnedSamples: contextPinnedSamples,
  }), [result, rawData, selectedSamples, contextPinnedSamples]);

  // Use extracted export hook
  const {
    exportChartPng,
    exportSpectraCsv,
    exportSelectionsJson,
    batchExportCharts,
  } = usePlaygroundExport({
    chartRefs,
    exportData,
    visibleCharts: effectiveVisibleCharts,
  });

  // ============= Render Helper =============

  // Helper to check if a chart should be rendered in the grid
  const shouldRenderChart = useCallback((chart: ChartType): boolean => {
    if (!effectiveVisibleCharts.has(chart)) return false;
    const state = getChartViewState(chart);
    if (state === 'hidden') return false;
    // When maximized, only render the maximized chart
    if (hasMaximized && maximizedChart !== chart) return false;
    return true;
  }, [effectiveVisibleCharts, getChartViewState, hasMaximized, maximizedChart]);

  // ============= Empty State =============

  if (!rawData) {
    return (
      <div className="flex-1 flex items-center justify-center bg-background">
        <div className="text-center max-w-lg px-6">
          <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center mx-auto mb-6 shadow-lg">
            <FlaskConical className="w-10 h-10 text-primary" />
          </div>
          <h2 className="text-2xl font-bold text-foreground mb-2">
            NIR Preprocessing Playground
          </h2>
          <p className="text-muted-foreground mb-6 text-base">
            Explore and experiment with preprocessing transformations on your spectral data in real-time.
          </p>

          <div className="grid grid-cols-2 gap-4 mb-6">
            <div className="bg-card rounded-lg border p-4 text-left">
              <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
                <span className="w-6 h-6 rounded bg-blue-500/10 flex items-center justify-center text-blue-500 text-xs font-bold">1</span>
                Load Data
              </h3>
              <ul className="text-xs text-muted-foreground space-y-1">
                <li>Upload CSV file</li>
                <li>Select from workspace</li>
                <li>Use demo data</li>
              </ul>
            </div>
            <div className="bg-card rounded-lg border p-4 text-left">
              <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
                <span className="w-6 h-6 rounded bg-primary/10 flex items-center justify-center text-primary text-xs font-bold">2</span>
                Add Operators
              </h3>
              <ul className="text-xs text-muted-foreground space-y-1">
                <li>Preprocessing (SNV, SG...)</li>
                <li>Splitters (KFold, SPXY...)</li>
                <li>Combine & reorder</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ============= Main Render =============

  return (
    <div className="flex-1 flex flex-col bg-background overflow-hidden relative">
      {/* Sample details panel */}
      {selectedSample !== null && rawData && (
        <SampleDetails
          data={{
            wavelengths: result?.processed?.wavelengths ?? rawData.wavelengths,
            spectra: result?.processed?.spectra ?? rawData.spectra,
            y: yValues,
            sampleIds: rawData.sampleIds,
            metadata: rawData.metadata,
            originalSpectra: result?.original?.spectra ?? rawData.spectra,
            originalY: yValues,
          }}
          sampleIndex={selectedSample}
          onClose={handleCloseSampleDetails}
        />
      )}

      {/* Raw Data Mode banner */}
      {isRawDataMode && <RawDataModeBanner />}

      {/* Toolbar */}
      <CanvasToolbar
        effectiveVisibleCharts={effectiveVisibleCharts}
        onToggleChart={toggleChart}
        hasFolds={!!hasFolds}
        hasRepetitions={hasRepetitions}
        isFetching={isFetching}
        selectedCount={selectedCount}
        onFilterToSelection={onFilterToSelection ? handleFilterToSelection : undefined}
        partitionFilter={partitionFilter}
        onPartitionFilterChange={setPartitionFilter}
        folds={result?.folds ?? null}
        totalSamples={totalSamples}
        metadata={columnMetadata}
        metrics={metrics}
        metricFilters={metricFilters}
        onMetricFiltersChange={onMetricFiltersChange}
        onDetectOutliers={onDetectOutliers}
        onFindSimilar={onFindSimilar}
        selectedSample={selectedSample}
        sampleIds={rawData?.sampleIds}
        hasOperators={hasOperators}
        operators={operators}
        stepComparisonEnabled={stepComparisonEnabled}
        onStepComparisonEnabledChange={onStepComparisonEnabledChange}
        activeStep={activeStep}
        onActiveStepChange={handleActiveStepChange}
        enabledOperatorCount={enabledOperatorCount}
        colorConfig={colorConfig}
        onColorConfigChange={setColorConfig}
        hasOutliers={!!lastOutlierResult && lastOutlierResult.outlier_indices.length > 0}
        outlierCount={lastOutlierResult?.outlier_indices.length ?? 0}
        colorContext={colorContext}
        displayRenderMode={displayRenderMode}
        effectiveRenderMode={effectiveMode}
        isWebGLActive={isWebGL}
        onRenderModeChange={handleRenderModeChange}
        onExportChartPng={exportChartPng}
        onExportSpectraCsv={exportSpectraCsv}
        onExportSelectionsJson={exportSelectionsJson}
        onBatchExport={batchExportCharts}
        onInteractionStart={triggerInteractionPending}
      />

      {/* Charts grid */}
      <div
        className={cn(
          'flex-1 p-3 overflow-auto grid gap-3',
          'transition-all duration-200 ease-in-out',
          gridCols,
          gridRows
        )}
        role="region"
        aria-label="Data visualization charts"
      >
        {/* Spectra Chart */}
        {shouldRenderChart('spectra') && (
          <ChartPanel
            ref={spectraChartRef}
            chartType="spectra"
            viewState={getChartViewState('spectra')}
            isMaximized={maximizedChart === 'spectra'}
            isLoading={chartRedrawing}
            onMaximize={() => handleMaximize('spectra')}
            onMinimize={() => handleMinimize('spectra')}
            onRestore={() => handleRestore('spectra')}
            onHide={() => handleHide('spectra')}
            sampleCount={totalSamples}
            selectedCount={selectedCount}
            pinnedCount={pinnedCount}
            className=""
          >
            {showSkeletons ? (
              <ChartSkeleton type="spectra" />
            ) : result ? (
              <SpectraChartV2
                original={result.original}
                processed={result.processed}
                y={yValues}
                sampleIds={rawData.sampleIds}
                folds={result.folds}
                globalColorConfig={colorConfig}
                colorContext={colorContext}
                onInteractionStart={triggerInteractionPending}
                isLoading={chartRedrawing}
                operators={operators}
                metadata={columnMetadata}
                metadataColumns={metadataColumns}
                renderMode={effectiveMode}
                displayRenderMode={displayRenderMode}
                onRenderModeChange={handleRenderModeChange}
                outlierIndices={lastOutlierResult ? new Set(lastOutlierResult.outlier_indices) : undefined}
              />
            ) : rawData ? (
              <SpectraChartV2
                original={{
                  spectra: rawData.spectra,
                  wavelengths: rawData.wavelengths,
                  shape: [rawData.spectra.length, rawData.wavelengths.length],
                }}
                processed={{
                  spectra: rawData.spectra,
                  wavelengths: rawData.wavelengths,
                  shape: [rawData.spectra.length, rawData.wavelengths.length],
                }}
                y={yValues}
                sampleIds={rawData.sampleIds}
                folds={undefined}
                globalColorConfig={colorConfig}
                colorContext={colorContext}
                onInteractionStart={triggerInteractionPending}
                isLoading={chartRedrawing}
                operators={operators}
                metadata={columnMetadata}
                metadataColumns={metadataColumns}
                renderMode={effectiveMode}
                displayRenderMode={displayRenderMode}
                onRenderModeChange={handleRenderModeChange}
              />
            ) : (
              <ChartSkeleton type="spectra" />
            )}
          </ChartPanel>
        )}

        {/* Embedding Selector Overlay (shown over spectra) */}
        {showEmbeddingOverlay && result?.pca && (
          <div className="absolute top-24 right-6 z-30">
            <EmbeddingSelector
              embedding={result.pca.coordinates}
              partitions={colorContext.trainIndices && colorContext.testIndices
                ? Array.from({ length: totalSamples }, (_, i) =>
                    colorContext.trainIndices?.has(i) ? 'Train' : 'Test'
                  )
                : undefined}
              targets={yValues}
              sampleIds={rawData?.sampleIds}
              embeddingMethod="pca"
              expanded={false}
              onToggleExpanded={onToggleEmbeddingOverlay}
              useSelectionContext
              visible={showEmbeddingOverlay}
            />
          </div>
        )}

        {/* Y Histogram */}
        {shouldRenderChart('histogram') && (
          <ChartPanel
            ref={histogramChartRef}
            chartType="histogram"
            viewState={getChartViewState('histogram')}
            isMaximized={maximizedChart === 'histogram'}
            isLoading={chartRedrawing}
            onMaximize={() => handleMaximize('histogram')}
            onMinimize={() => handleMinimize('histogram')}
            onRestore={() => handleRestore('histogram')}
            onHide={() => handleHide('histogram')}
            sampleCount={filteredIndices.length}
            selectedCount={selectedCount}
          >
            {showSkeletons ? (
              <ChartSkeleton type="histogram" />
            ) : yValues.length > 0 ? (
              <YHistogramV2
                y={yValues}
                folds={result?.folds}
                metadata={columnMetadata}
                useSelectionContext
                globalColorConfig={colorConfig}
                colorContext={colorContext}
              />
            ) : (
              <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
                No Y values available
              </div>
            )}
          </ChartPanel>
        )}

        {/* Fold Distribution */}
        {shouldRenderChart('folds') && hasFolds && (
          <ChartPanel
            ref={foldsChartRef}
            chartType="folds"
            viewState={getChartViewState('folds')}
            isMaximized={maximizedChart === 'folds'}
            isLoading={chartRedrawing}
            onMaximize={() => handleMaximize('folds')}
            onMinimize={() => handleMinimize('folds')}
            onRestore={() => handleRestore('folds')}
            onHide={() => handleHide('folds')}
            sampleCount={totalSamples}
          >
            {showSkeletons ? (
              <ChartSkeleton type="folds" />
            ) : (
              <FoldDistributionChartV2
                folds={result?.folds ?? null}
                y={yValues}
                metadata={columnMetadata}
                useSelectionContext
                globalColorConfig={colorConfig}
                colorContext={colorContext}
              />
            )}
          </ChartPanel>
        )}

        {/* PCA/UMAP Plot */}
        {shouldRenderChart('pca') && (
          <ChartPanel
            ref={pcaChartRef}
            chartType="pca"
            viewState={getChartViewState('pca')}
            isMaximized={maximizedChart === 'pca'}
            isLoading={chartRedrawing}
            onMaximize={() => handleMaximize('pca')}
            onMinimize={() => handleMinimize('pca')}
            onRestore={() => handleRestore('pca')}
            onHide={() => handleHide('pca')}
            sampleCount={totalSamples}
            selectedCount={selectedCount}
          >
            {showSkeletons ? (
              <ChartSkeleton type="pca" />
            ) : result?.pca ? (
              <DimensionReductionChart
                pca={result.pca}
                umap={result.umap}
                y={yValues}
                folds={result.folds}
                sampleIds={rawData.sampleIds}
                metadata={columnMetadata}
                useSelectionContext
                onRequestUMAP={onComputeUmapChange ? () => onComputeUmapChange(true) : undefined}
                isUMAPLoading={isUmapLoading}
                globalColorConfig={colorConfig}
                colorContext={colorContext}
              />
            ) : (
              <ChartSkeleton type="pca" />
            )}
          </ChartPanel>
        )}

        {/* Repetitions Chart */}
        {shouldRenderChart('repetitions') && hasRepetitions && (
          <ChartPanel
            ref={repetitionsChartRef}
            chartType="repetitions"
            viewState={getChartViewState('repetitions')}
            isMaximized={maximizedChart === 'repetitions'}
            isLoading={chartRedrawing}
            onMaximize={() => handleMaximize('repetitions')}
            onMinimize={() => handleMinimize('repetitions')}
            onRestore={() => handleRestore('repetitions')}
            onHide={() => handleHide('repetitions')}
            sampleCount={totalSamples}
          >
            {showSkeletons ? (
              <ChartSkeleton type="histogram" />
            ) : result?.repetitions ? (
              <RepetitionsChart
                repetitionData={result.repetitions}
                y={yValues}
                useSelectionContext
                globalColorConfig={colorConfig}
                colorContext={colorContext}
              />
            ) : (
              <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
                No repetitions detected
              </div>
            )}
          </ChartPanel>
        )}

        {/* Minimized charts bar */}
        {Array.from(effectiveVisibleCharts).filter(chart => getChartViewState(chart) === 'minimized').length > 0 && (
          <div className="col-span-full flex gap-2 flex-wrap">
            {Array.from(effectiveVisibleCharts)
              .filter(chart => getChartViewState(chart) === 'minimized')
              .map(chart => (
                <ChartPanel
                  key={chart}
                  chartType={chart}
                  viewState="minimized"
                  isMaximized={false}
                  onRestore={() => handleRestore(chart)}
                  onHide={() => handleHide(chart)}
                  className="w-auto min-w-[200px]"
                >
                  {/* No content - header only */}
                  <div />
                </ChartPanel>
              ))}
          </div>
        )}
      </div>

    </div>
  );
}

export default MainCanvas;
