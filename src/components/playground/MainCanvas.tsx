/**
 * MainCanvas - Visualization canvas for spectral data and analysis
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
 */

import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import {
  FlaskConical, Eye, EyeOff, Loader2, Info, Filter, Activity,
  Download, Image, FileText, Zap, Monitor,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import {
  SpectraChart,
  YHistogramV2,
  DimensionReductionChart,
  FoldDistributionChartV2,
  RepetitionsChart,
  ChartSkeleton,
  ChartErrorBoundary,
  type ExtendedColorMode,
  type ExtendedColorConfig,
} from './visualizations';
import { SampleDetails } from './SampleDetails';
import { StepComparisonSlider } from './StepComparisonSlider';
import { PartitionSelector, type PartitionFilter, getPartitionIndices } from './PartitionSelector';
import { MetricsFilterPanel, type MetricFilter } from './MetricsFilterPanel';
import { OutlierSelector, type OutlierMethod } from './OutlierSelector';
import { SimilarityFilter, type DistanceMetric } from './SimilarityFilter';
import { EmbeddingSelector } from './EmbeddingSelector';
import { SavedSelections } from './SavedSelections';
import { useSelection } from '@/context/SelectionContext';
import {
  useRenderOptimizer,
  type RenderMode,
} from '@/lib/playground/renderOptimizer';
import {
  exportToPng,
  exportToSvg,
  exportSpectraToCsv,
  exportSelectionsToJson,
  exportToJson,
  batchExport,
} from '@/lib/playground/export';
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
}

type ChartType = 'spectra' | 'histogram' | 'folds' | 'pca' | 'repetitions';

interface ChartConfig {
  id: ChartType;
  label: string;
  requiresFolds?: boolean;
  requiresRepetitions?: boolean;
}

const CHART_CONFIG: ChartConfig[] = [
  { id: 'spectra', label: 'Spectra' },
  { id: 'histogram', label: 'Y Hist' },
  { id: 'folds', label: 'Folds', requiresFolds: true },
  { id: 'pca', label: 'PCA' },
  { id: 'repetitions', label: 'Reps', requiresRepetitions: true },
];

// ============= Sub-Components =============

interface ColorModeSelectorProps {
  colorConfig: ExtendedColorConfig;
  onChange: (config: ExtendedColorConfig) => void;
  hasFolds: boolean;
}

function ColorModeSelector({ colorConfig, onChange, hasFolds }: ColorModeSelectorProps) {
  return (
    <Select
      value={colorConfig.mode}
      onValueChange={(mode) => onChange({ ...colorConfig, mode: mode as ExtendedColorMode })}
    >
      <SelectTrigger className="h-6 w-24 text-[10px]">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="target">By Y Value</SelectItem>
        {hasFolds && <SelectItem value="fold">By Fold</SelectItem>}
        <SelectItem value="dataset">By Dataset</SelectItem>
      </SelectContent>
    </Select>
  );
}

function ChartLoadingOverlay({ visible }: { visible: boolean }) {
  if (!visible) return null;

  return (
    <div className="absolute inset-0 bg-background/60 backdrop-blur-[1px] flex items-center justify-center z-20 pointer-events-none">
      <Loader2 className="w-5 h-5 animate-spin text-primary" aria-hidden="true" />
      <span className="sr-only">Updating chart</span>
    </div>
  );
}

/**
 * Raw Data Mode banner - shown when no operators are in the pipeline
 * This is a Phase 1 deliverable: Playground works without any pipeline operators
 */
function RawDataModeBanner() {
  return (
    <div className="flex items-center gap-2 px-3 py-2 bg-blue-500/10 border-b border-blue-500/20">
      <Info className="w-4 h-4 text-blue-500 shrink-0" />
      <span className="text-xs text-blue-700 dark:text-blue-300">
        <strong>Raw Data Mode:</strong> Viewing original data without preprocessing.
        Add operators from the palette to transform your spectra.
      </span>
    </div>
  );
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

  // ============= Phase 6: Export Handlers =============

  // Export visible chart to PNG
  const handleExportChartPng = useCallback(async (chartType: ChartType) => {
    const refMap: Record<ChartType, React.RefObject<HTMLDivElement>> = {
      spectra: spectraChartRef,
      histogram: histogramChartRef,
      pca: pcaChartRef,
      folds: foldsChartRef,
      repetitions: { current: null }, // Not yet implemented
    };

    const ref = refMap[chartType];
    if (!ref?.current) {
      toast.error('Chart not available');
      return;
    }

    try {
      await exportToPng(ref.current, `${chartType}-chart`);
      toast.success('Chart exported', { description: `${chartType}.png saved` });
    } catch (error) {
      toast.error('Export failed', { description: (error as Error).message });
    }
  }, []);

  // Export spectra data to CSV
  const handleExportSpectraCsv = useCallback(async () => {
    const spectra = result?.processed?.spectra ?? rawData?.spectra;
    const wavelengths = result?.processed?.wavelengths ?? rawData?.wavelengths;

    if (!spectra || !wavelengths) {
      toast.error('No spectra data to export');
      return;
    }

    try {
      await exportSpectraToCsv(spectra, wavelengths, rawData?.sampleIds, 'processed-spectra');
      toast.success('Data exported', {
        description: `${spectra.length} samples × ${wavelengths.length} wavelengths saved to CSV`,
      });
    } catch (error) {
      toast.error('Export failed', { description: (error as Error).message });
    }
  }, [result, rawData]);

  // Export current selection to JSON
  const handleExportSelectionsJson = useCallback(async () => {
    const selections = Array.from(selectedSamples);
    const pinned = Array.from(contextPinnedSamples);

    try {
      await exportSelectionsToJson(selections, pinned, 'playground-selections');
      toast.success('Selections exported', {
        description: `${selections.length} selected, ${pinned.length} pinned samples saved`,
      });
    } catch (error) {
      toast.error('Export failed', { description: (error as Error).message });
    }
  }, [selectedSamples, contextPinnedSamples]);

  // Batch export all charts
  const handleBatchExport = useCallback(async () => {
    const charts: Array<{ element: HTMLElement; filename: string }> = [];

    if (spectraChartRef.current && effectiveVisibleCharts.has('spectra')) {
      charts.push({ element: spectraChartRef.current, filename: 'spectra-chart' });
    }
    if (histogramChartRef.current && effectiveVisibleCharts.has('histogram')) {
      charts.push({ element: histogramChartRef.current, filename: 'histogram-chart' });
    }
    if (pcaChartRef.current && effectiveVisibleCharts.has('pca')) {
      charts.push({ element: pcaChartRef.current, filename: 'pca-chart' });
    }
    if (foldsChartRef.current && effectiveVisibleCharts.has('folds')) {
      charts.push({ element: foldsChartRef.current, filename: 'folds-chart' });
    }

    if (charts.length === 0) {
      toast.error('No charts to export');
      return;
    }

    try {
      const results = await batchExport(charts, 'png');
      const successCount = results.filter(r => r.success).length;
      toast.success('Batch export complete', {
        description: `${successCount}/${charts.length} charts exported`,
      });
    } catch (error) {
      toast.error('Batch export failed', { description: (error as Error).message });
    }
  }, [effectiveVisibleCharts]);

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

      {/* Toolbar */}
      <div
        className="flex items-center justify-between gap-2 px-3 py-1.5 border-b border-border bg-card/50"
        role="toolbar"
        aria-label="Chart controls"
      >
        <div className="flex items-center gap-1.5" role="group" aria-label="Chart visibility toggles">
          <span className="text-[10px] text-muted-foreground mr-1">Show:</span>
          {CHART_CONFIG.map(({ id, label, requiresFolds }) => {
            const isVisible = effectiveVisibleCharts.has(id);
            const isDisabled = requiresFolds && !hasFolds;

            return (
              <Button
                key={id}
                variant={isVisible ? 'secondary' : 'ghost'}
                size="sm"
                className={cn(
                  'h-6 text-[10px] gap-1 px-2',
                  !isVisible && 'opacity-50',
                  isDisabled && 'cursor-not-allowed opacity-30'
                )}
                onMouseDown={triggerInteractionPending}
                onClick={() => !isDisabled && toggleChart(id)}
                disabled={isDisabled}
                title={isDisabled ? 'Add a splitter to see folds' : undefined}
              >
                {isVisible ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                {label}
              </Button>
            );
          })}

          {/* Loading indicator */}
          {isFetching && (
            <Loader2 className="w-3 h-3 animate-spin text-primary ml-2" />
          )}

          {/* Selection count and filter button */}
          {selectedCount > 0 && (
            <div className="flex items-center gap-1.5 ml-2 pl-2 border-l border-border">
              <Badge variant="secondary" className="h-5 px-1.5 text-[10px] font-medium">
                {selectedCount} selected
              </Badge>
              {onFilterToSelection && (
                <TooltipProvider delayDuration={200}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="secondary"
                        size="sm"
                        className="h-6 text-[10px] gap-1 px-2 bg-red-500/10 hover:bg-red-500/20 text-red-600 dark:text-red-400"
                        onClick={handleFilterToSelection}
                      >
                        <Filter className="w-3 h-3" />
                        Filter to Selection
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" className="max-w-xs">
                      <p className="text-xs">
                        Add a filter that keeps only the {selectedCount} selected sample{selectedCount !== 1 ? 's' : ''}.
                        Other samples will be removed from the pipeline.
                      </p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center gap-3">
          {/* Partition filter (Phase 3) */}
          {hasFolds && (
            <>
              <span className="text-[10px] text-muted-foreground">View:</span>
              <PartitionSelector
                value={partitionFilter}
                onChange={setPartitionFilter}
                folds={result?.folds ?? null}
                totalSamples={totalSamples}
                compact
              />
            </>
          )}

          {/* Phase 5: Advanced Filtering & Metrics */}
          {(metrics || onDetectOutliers || onFindSimilar) && (
            <>
              <Separator orientation="vertical" className="h-4" />
              <div className="flex items-center gap-1.5">
                <Activity className="w-3 h-3 text-muted-foreground" />
                <span className="text-[10px] text-muted-foreground">Filter:</span>

                {/* Metrics Filter Panel */}
                {metrics && onMetricFiltersChange && (
                  <MetricsFilterPanel
                    metrics={metrics}
                    activeFilters={metricFilters}
                    onChange={onMetricFiltersChange}
                    compact
                  />
                )}

                {/* Outlier Selector */}
                {onDetectOutliers && (
                  <OutlierSelector
                    onDetectOutliers={onDetectOutliers}
                    totalSamples={totalSamples}
                    useSelectionContext
                    compact
                  />
                )}

                {/* Similarity Filter */}
                {onFindSimilar && (
                  <SimilarityFilter
                    onFindSimilar={onFindSimilar}
                    selectedSample={selectedSample}
                    sampleIds={rawData?.sampleIds}
                    useSelectionContext
                    totalSamples={totalSamples}
                    compact
                  />
                )}
              </div>
            </>
          )}

          {/* Step comparison slider (compact) - only show when there are operators */}
          {hasOperators && onStepComparisonEnabledChange && (
            <StepComparisonSlider
              operators={operators}
              currentStep={activeStep}
              onStepChange={handleActiveStepChange}
              enabled={stepComparisonEnabled}
              onEnabledChange={handleStepComparisonEnabledChange}
              onInteractionStart={triggerInteractionPending}
              isLoading={isFetching}
              compact
            />
          )}

          <span className="text-[10px] text-muted-foreground">Color:</span>
          <ColorModeSelector
            colorConfig={colorConfig}
            onChange={(config) => {
              triggerInteractionPending();
              setColorConfig(config);
            }}
            hasFolds={!!hasFolds}
          />

          {/* Phase 6: Render mode selector */}
          <Separator orientation="vertical" className="h-4" />
          <TooltipProvider delayDuration={200}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Select
                  value={displayRenderMode}
                  onValueChange={(value) => handleRenderModeChange(value as RenderMode)}
                >
                  <SelectTrigger className="h-6 w-20 text-[10px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">
                      <div className="flex items-center gap-1.5">
                        <Zap className="w-3 h-3" />
                        Auto
                      </div>
                    </SelectItem>
                    <SelectItem value="canvas">
                      <div className="flex items-center gap-1.5">
                        <Monitor className="w-3 h-3" />
                        Canvas
                      </div>
                    </SelectItem>
                    <SelectItem value="webgl">
                      <div className="flex items-center gap-1.5">
                        <Zap className="w-3 h-3 text-yellow-500" />
                        WebGL
                      </div>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <p className="text-xs">
                  {displayRenderMode === 'auto'
                    ? `Auto-selects best renderer based on data size (using ${effectiveMode})`
                    : displayRenderMode === 'webgl' || displayRenderMode === 'webgl_aggregated'
                      ? 'GPU-accelerated rendering for large datasets'
                      : 'Standard canvas rendering'}
                  {isWebGL && effectiveMode.startsWith('webgl') && ' (WebGL active)'}
                </p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>

          {/* Phase 6: Saved Selections */}
          <SavedSelections compact datasetId={datasetId ?? 'playground'} />

          {/* Phase 6: Export menu */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-6 px-2 text-[10px] gap-1">
                <Download className="w-3 h-3" />
                Export
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem onClick={() => handleExportChartPng('spectra')}>
                <Image className="w-4 h-4 mr-2" />
                Spectra as PNG
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleExportChartPng('pca')}>
                <Image className="w-4 h-4 mr-2" />
                PCA Plot as PNG
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleExportChartPng('histogram')}>
                <Image className="w-4 h-4 mr-2" />
                Histogram as PNG
              </DropdownMenuItem>
              {hasFolds && (
                <DropdownMenuItem onClick={() => handleExportChartPng('folds')}>
                  <Image className="w-4 h-4 mr-2" />
                  Folds as PNG
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleBatchExport}>
                <Image className="w-4 h-4 mr-2" />
                All Charts as PNG
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleExportSpectraCsv}>
                <FileText className="w-4 h-4 mr-2" />
                Spectra as CSV
              </DropdownMenuItem>
              {selectedCount > 0 && (
                <DropdownMenuItem onClick={handleExportSelectionsJson}>
                  <FileText className="w-4 h-4 mr-2" />
                  Selection as JSON
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

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
                <SpectraChart
                  original={result.original}
                  processed={result.processed}
                  y={yValues}
                  sampleIds={rawData.sampleIds}
                  folds={result.folds}
                  colorConfig={colorConfig}
                  selectedSample={selectedSample}
                  onSelectSample={handleSelectSample}
                  onInteractionStart={triggerInteractionPending}
                  maxSamples={50}
                  isLoading={chartRedrawing}
                  renderMode={effectiveMode}
                />
              </ChartErrorBoundary>
            ) : rawData ? (
              // Raw data mode - show raw spectra without processing
              <ChartErrorBoundary chartType="Spectra">
                <SpectraChart
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
                  colorConfig={colorConfig}
                  selectedSample={selectedSample}
                  onSelectSample={handleSelectSample}
                  onInteractionStart={triggerInteractionPending}
                  maxSamples={50}
                  isLoading={chartRedrawing}
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
