/**
 * MainCanvas - Visualization canvas for spectral data and analysis
 *
 * Phase 1 Refactoring: Component Modularization
 *
 * Features:
 * - Uses Phase 3 V2 chart components with enhanced features
 * - Loading skeletons during execution
 * - Fold distribution chart when splitter is present
 * - Extended color mode options (including fold coloring)
 * - Cross-chart sample highlighting via SelectionContext
 * - Step-by-step comparison mode
 * - Raw Data Mode: Works without any operators (Phase 1 deliverable)
 * - Partition filtering: Filter all charts by train/test/fold (Phase 3)
 * - Enhanced PCA with UMAP support and 3D view option
 * - Enhanced histogram with KDE, ridge plot, and multiple display modes
 * - Phase 6: WebGL rendering, export system, saved selections
 *
 * Performance Optimizations:
 * - useMemo for computed values (hasFolds, yValues, gridLayout)
 * - useCallback for event handlers
 * - Skeleton placeholders during loading
 * - Charts render only when visible (effectiveVisibleCharts)
 * - maxSamples prop limits rendered spectra lines
 * - Render mode optimization (auto/canvas/webgl) based on data size
 * - React.memo on sub-components
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
import type { ExtendedColorConfig } from './visualizations/chartConfig';
import { SampleDetails } from './SampleDetails';
import { PartitionSelector, type PartitionFilter, getPartitionIndices } from './PartitionSelector';
import type { MetricFilter } from './MetricsFilterPanel';
import type { OutlierMethod } from './OutlierSelector';
import type { DistanceMetric } from './SimilarityFilter';
import { EmbeddingSelector } from './EmbeddingSelector';
import { useSelection } from '@/context/SelectionContext';
import {
  useRenderOptimizer,
  type RenderMode,
} from '@/lib/playground/renderOptimizer';

// Phase 1: Extracted components
import { CanvasToolbar, type ChartType } from './CanvasToolbar';
import { ChartPanel, ChartLoadingOverlay, ChartErrorBoundary } from './ChartPanel';
import { usePlaygroundExport, type ChartRefs } from './hooks/usePlaygroundExport';

import type { PlaygroundResult, UnifiedOperator, MetricsResult, OutlierResult, SimilarityResult } from '@/types/playground';
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
  /** Callback when "Filter to Selection" is clicked - adds a sample index filter */
  onFilterToSelection?: (selectedIndices: number[]) => void;
  /** Whether UMAP computation is enabled */
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
 * This is a Phase 1 deliverable: Playground works without any pipeline operators
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
  computeUmap = false,
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
  renderMode: externalRenderMode,
  onRenderModeChange,
  datasetId,
  lastOutlierResult,
}: MainCanvasProps) {
  // Chart visibility state
  const [visibleCharts, setVisibleCharts] = useState<Set<ChartType>>(
    new Set(['spectra', 'histogram', 'pca'])
  );

  // Local sample selection (if not controlled)
  const [internalSelectedSample, setInternalSelectedSample] = useState<number | null>(null);
  const selectedSample = externalSelectedSample ?? internalSelectedSample;
  const setSelectedSample = externalOnSelectSample ?? setInternalSelectedSample;

  // Color configuration
  const [colorConfig, setColorConfig] = useState<ExtendedColorConfig>({ mode: 'target' });

  // Partition filtering (Phase 3) - applies to all charts
  const [partitionFilter, setPartitionFilter] = useState<PartitionFilter>('all');

  // Chart container refs for export (Phase 6)
  const spectraChartRef = useRef<HTMLDivElement>(null);
  const histogramChartRef = useRef<HTMLDivElement>(null);
  const pcaChartRef = useRef<HTMLDivElement>(null);
  const foldsChartRef = useRef<HTMLDivElement>(null);

  // Render mode optimization (Phase 6)
  const totalSamplesForRender = rawData?.spectra?.length ?? result?.processed?.spectra?.length ?? 0;
  const wavelengthCountForRender = rawData?.wavelengths?.length ?? result?.processed?.wavelengths?.length ?? 0;

  const { renderMode: effectiveMode, webglAvailable: isWebGL, setForceMode, forceMode } = useRenderOptimizer({
    nSamples: totalSamplesForRender,
    nWavelengths: wavelengthCountForRender,
    hasOverlay: false,
    has3DView: false,
  });

  // User-selected render mode (for the Select display) - null means 'auto'
  const displayRenderMode: RenderMode = forceMode ?? 'auto';

  // Handle render mode change
  const handleRenderModeChange = useCallback((mode: RenderMode) => {
    setForceMode(mode === 'auto' ? null : mode);
    onRenderModeChange?.(mode);
  }, [setForceMode, onRenderModeChange]);

  // Determine if we should show skeletons
  const showSkeletons = isLoading && !result;

  // Track user-triggered redraw intent so spinner starts on mousedown
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

  // Clear pending state once backend settles, but keep spinner during fetch
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

  // Show a spinner on charts when a redraw is happening but we still have data to show
  const chartRedrawing = ((isFetching || isLoading) && !!result && !showSkeletons) || interactionPending;

  // Check if pipeline has any operators (for Raw Data Mode)
  const hasOperators = operators.length > 0;
  const enabledOperatorCount = operators.filter(op => op.enabled).length;
  const isRawDataMode = !hasOperators || enabledOperatorCount === 0;

  // Get selection context for filter-to-selection functionality and exports
  const {
    selectedSamples,
    selectedCount,
    pinnedSamples: contextPinnedSamples,
    clear: clearSelection,
  } = useSelection();

  // Handle filter to selection
  const handleFilterToSelection = useCallback(() => {
    if (onFilterToSelection && selectedCount > 0) {
      const selectedIndices = Array.from(selectedSamples);
      onFilterToSelection(selectedIndices);
      // Clear selection after applying filter
      clearSelection();
    }
  }, [onFilterToSelection, selectedCount, selectedSamples, clearSelection]);

  // Check if we have folds
  const hasFolds = useMemo(() => {
    return result?.folds && result.folds.n_folds > 0;
  }, [result?.folds]);

  // Check if we have repetitions (Phase 4)
  const hasRepetitions = useMemo(() => {
    return result?.repetitions?.has_repetitions ?? false;
  }, [result?.repetitions]);

  // Toggle folds/repetitions visibility based on availability
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

  // Toggle chart visibility
  const toggleChart = useCallback((chart: ChartType) => {
    setVisibleCharts(prev => {
      const next = new Set(prev);
      if (next.has(chart)) {
        next.delete(chart);
      } else {
        next.add(chart);
      }
      return next;
    });
  }, []);

  // Handle sample selection
  const handleSelectSample = useCallback((index: number | null) => {
    setSelectedSample(index);
  }, [setSelectedSample]);

  // Close sample details
  const handleCloseSampleDetails = useCallback(() => {
    setSelectedSample(null);
  }, [setSelectedSample]);

  // Get Y values
  const yValues = useMemo(() => {
    if (result?.processed?.spectra && rawData?.y) {
      // Use raw Y since playground doesn't process Y
      return rawData.y;
    }
    return rawData?.y ?? [];
  }, [result, rawData]);

  // Total sample count
  const totalSamples = useMemo(() => {
    return rawData?.spectra?.length ?? result?.processed?.spectra?.length ?? 0;
  }, [rawData, result]);

  // Get partition-filtered indices (Phase 3)
  const filteredIndices = useMemo(() => {
    return getPartitionIndices(partitionFilter, result?.folds ?? null, totalSamples);
  }, [partitionFilter, result?.folds, totalSamples]);

  // Filter Y values based on partition
  const filteredYValues = useMemo(() => {
    if (partitionFilter === 'all') return yValues;
    return filteredIndices.map(i => yValues[i]).filter(v => v !== undefined);
  }, [partitionFilter, filteredIndices, yValues]);

  // Compute grid layout
  const visibleCount = effectiveVisibleCharts.size;
  const gridCols = visibleCount === 1
    ? 'grid-cols-1'
    : visibleCount === 2
      ? 'grid-cols-1 sm:grid-cols-2'
      : 'grid-cols-2';
  const gridRows = visibleCount <= 2 ? 'grid-rows-1' : visibleCount <= 4 ? 'grid-rows-2' : 'grid-rows-3';

  // Step comparison handlers
  const handleStepComparisonEnabledChange = useCallback((enabled: boolean) => {
    onStepComparisonEnabledChange?.(enabled);
    if (enabled && activeStep === 0 && enabledOperatorCount > 0) {
      onActiveStepChange?.(enabledOperatorCount);
    }
  }, [onStepComparisonEnabledChange, onActiveStepChange, activeStep, enabledOperatorCount]);

  const handleActiveStepChange = useCallback((step: number) => {
    onActiveStepChange?.(step);
  }, [onActiveStepChange]);

  // ============= Phase 1 Refactoring: Use extracted export hook =============

  // Chart refs for export
  const repetitionsChartRef = useRef<HTMLDivElement>(null);
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

  // Empty state - no data loaded
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
                <li>• Upload CSV file</li>
                <li>• Select from workspace</li>
                <li>• Use demo data</li>
              </ul>
            </div>
            <div className="bg-card rounded-lg border p-4 text-left">
              <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
                <span className="w-6 h-6 rounded bg-primary/10 flex items-center justify-center text-primary text-xs font-bold">2</span>
                Add Operators
              </h3>
              <ul className="text-xs text-muted-foreground space-y-1">
                <li>• Preprocessing (SNV, SG...)</li>
                <li>• Splitters (KFold, SPXY...)</li>
                <li>• Combine & reorder</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    );
  }

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

      {/* Raw Data Mode banner - Phase 1 feature */}
      {isRawDataMode && <RawDataModeBanner />}

      {/* Phase 1 Refactoring: Extracted Toolbar Component */}
      <CanvasToolbar
        visibleCharts={visibleCharts}
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
        metadata={rawData?.metadata}
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
        displayRenderMode={displayRenderMode}
        effectiveRenderMode={effectiveMode}
        isWebGLActive={isWebGL}
        onRenderModeChange={handleRenderModeChange}
        datasetId={datasetId}
        onExportChartPng={exportChartPng}
        onExportSpectraCsv={exportSpectraCsv}
        onExportSelectionsJson={exportSelectionsJson}
        onBatchExport={batchExportCharts}
        onInteractionStart={triggerInteractionPending}
      />

      {/* Charts grid */}
      <div
        className={cn('flex-1 p-3 overflow-auto grid gap-3', gridCols, gridRows)}
        role="region"
        aria-label="Data visualization charts"
      >
        {/* Spectra Chart */}
        {effectiveVisibleCharts.has('spectra') && (
          <div
            ref={spectraChartRef}
            className="bg-card rounded-lg border border-border p-3 min-h-[250px] relative"
            role="img"
            aria-label="Spectra chart showing original and processed spectral data"
          >
            <ChartLoadingOverlay visible={chartRedrawing} />
            {showSkeletons ? (
              <ChartSkeleton type="spectra" />
            ) : result ? (
              <ChartErrorBoundary chartType="Spectra">
                <SpectraChartV2
                  original={result.original}
                  processed={result.processed}
                  y={yValues}
                  sampleIds={rawData.sampleIds}
                  folds={result.folds}
                  onInteractionStart={triggerInteractionPending}
                  isLoading={chartRedrawing}
                  operators={operators}
                  metadata={rawData.metadata as Record<string, unknown[]> | undefined}
                  metadataColumns={rawData.metadata ? Object.keys(rawData.metadata) : undefined}
                  renderMode={effectiveMode}
                  outlierIndices={lastOutlierResult ? new Set(lastOutlierResult.outlier_indices) : undefined}
                />
              </ChartErrorBoundary>
            ) : rawData ? (
              // Raw data mode - show raw spectra without processing
              <ChartErrorBoundary chartType="Spectra">
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
                  onInteractionStart={triggerInteractionPending}
                  isLoading={chartRedrawing}
                  operators={operators}
                  metadata={rawData.metadata as Record<string, unknown[]> | undefined}
                  metadataColumns={rawData.metadata ? Object.keys(rawData.metadata) : undefined}
                  renderMode={effectiveMode}
                />
              </ChartErrorBoundary>
            ) : (
              <ChartSkeleton type="spectra" />
            )}

            {/* Phase 5: Embedding Selector Overlay - mini PCA/UMAP for quick selection */}
            {showEmbeddingOverlay && result?.pca && (
              <div className="absolute top-10 right-3 z-30">
                <EmbeddingSelector
                  embedding={result.pca.coordinates}
                  partitions={result.folds?.train_indices && result.folds?.test_indices
                    ? Array.from({ length: totalSamples }, (_, i) =>
                        result.folds?.train_indices?.includes(i) ? 'Train' : 'Test'
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
          </div>
        )}

        {/* Y Histogram - Using V2 with enhanced features */}
        {effectiveVisibleCharts.has('histogram') && (
          <div
            ref={histogramChartRef}
            className="bg-card rounded-lg border border-border p-3 min-h-[250px] relative"
            role="img"
            aria-label="Histogram of target Y values distribution"
          >
            <ChartLoadingOverlay visible={chartRedrawing} />
            {showSkeletons ? (
              <ChartSkeleton type="histogram" />
            ) : filteredYValues.length > 0 ? (
              <ChartErrorBoundary chartType="Histogram">
                <YHistogramV2
                  y={filteredYValues}
                  folds={result?.folds}
                  useSelectionContext
                />
              </ChartErrorBoundary>
            ) : (
              <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
                No Y values available
              </div>
            )}
          </div>
        )}

        {/* Fold Distribution - Using V2 with enhanced features */}
        {effectiveVisibleCharts.has('folds') && hasFolds && (
          <div
            ref={foldsChartRef}
            className="bg-card rounded-lg border border-border p-3 min-h-[250px] relative"
            role="img"
            aria-label="Cross-validation fold distribution chart"
          >
            <ChartLoadingOverlay visible={chartRedrawing} />
            {showSkeletons ? (
              <ChartSkeleton type="folds" />
            ) : (
              <ChartErrorBoundary chartType="Fold Distribution">
                <FoldDistributionChartV2
                  folds={result?.folds ?? null}
                  y={yValues}
                  useSelectionContext
                />
              </ChartErrorBoundary>
            )}
          </div>
        )}

        {/* PCA/UMAP Plot - Using DimensionReductionChart V2 with enhanced features */}
        {effectiveVisibleCharts.has('pca') && (
          <div
            ref={pcaChartRef}
            className="bg-card rounded-lg border border-border p-3 min-h-[250px] relative"
            role="img"
            aria-label="PCA/UMAP scatter plot showing dimensionality reduction"
          >
            <ChartLoadingOverlay visible={chartRedrawing} />
            {showSkeletons ? (
              <ChartSkeleton type="pca" />
            ) : result?.pca ? (
              <ChartErrorBoundary chartType="Dimension Reduction">
                <DimensionReductionChart
                  pca={result.pca}
                  umap={result.umap}
                  y={filteredYValues}
                  folds={result.folds}
                  sampleIds={rawData.sampleIds}
                  useSelectionContext
                  onRequestUMAP={onComputeUmapChange ? () => onComputeUmapChange(true) : undefined}
                  isUMAPLoading={isUmapLoading}
                />
              </ChartErrorBoundary>
            ) : (
              <ChartSkeleton type="pca" />
            )}
          </div>
        )}

        {/* Repetitions Chart - Phase 4: Strip plot showing intra-sample variability */}
        {effectiveVisibleCharts.has('repetitions') && hasRepetitions && (
          <div
            className="bg-card rounded-lg border border-border p-3 min-h-[250px] relative"
            role="img"
            aria-label="Repetitions variability chart showing intra-sample distances"
          >
            <ChartLoadingOverlay visible={chartRedrawing} />
            {showSkeletons ? (
              <ChartSkeleton type="histogram" />
            ) : result?.repetitions ? (
              <ChartErrorBoundary chartType="Repetitions">
                <RepetitionsChart
                  data={result.repetitions}
                  y={yValues}
                  useSelectionContext
                />
              </ChartErrorBoundary>
            ) : (
              <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
                No repetitions detected
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default MainCanvas;
