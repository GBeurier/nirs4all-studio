/**
 * CanvasToolbar - Extracted toolbar controls for MainCanvas
 *
 * Phase 1 Refactoring: Component Modularization
 *
 * Features:
 * - Chart visibility toggles
 * - Selection count and filter-to-selection button
 * - Partition filtering
 * - Advanced filtering (metrics, outliers, similarity)
 * - Step comparison slider
 * - Color mode selector
 * - Render mode selector
 * - Saved selections
 * - Export menu
 */

import { useCallback, memo } from 'react';
import {
  Eye,
  EyeOff,
  Loader2,
  Filter,
  Activity,
  Download,
  Image,
  FileText,
  Zap,
  Monitor,
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
import { StepComparisonSlider } from './StepComparisonSlider';
import { PartitionSelector, type PartitionFilter } from './PartitionSelector';
import { MetricsFilterPanel } from './MetricsFilterPanel';
import { OutlierSelector, type OutlierMethod } from './OutlierSelector';
import { SimilarityFilter, type DistanceMetric } from './SimilarityFilter';
import { SavedSelections } from './SavedSelections';
import { SelectionFilters } from './SelectionFilters';
import type { ExtendedColorConfig, ExtendedColorMode } from './visualizations/chartConfig';
import type { RenderMode } from '@/lib/playground/renderOptimizer';
import type { UnifiedOperator, MetricsResult, MetricFilter, OutlierResult, SimilarityResult, FoldsInfo } from '@/types/playground';

// ============= Types =============

export type ChartType = 'spectra' | 'histogram' | 'folds' | 'pca' | 'repetitions';

export interface ChartConfig {
  id: ChartType;
  label: string;
  requiresFolds?: boolean;
  requiresRepetitions?: boolean;
}

export const CHART_CONFIG: ChartConfig[] = [
  { id: 'spectra', label: 'Spectra' },
  { id: 'histogram', label: 'Y Hist' },
  { id: 'folds', label: 'Folds', requiresFolds: true },
  { id: 'pca', label: 'PCA' },
  { id: 'repetitions', label: 'Reps', requiresRepetitions: true },
];

export interface CanvasToolbarProps {
  // Chart visibility
  visibleCharts: Set<ChartType>;
  effectiveVisibleCharts: Set<ChartType>;
  onToggleChart: (chart: ChartType) => void;
  hasFolds: boolean;
  hasRepetitions: boolean;

  // Loading state
  isFetching: boolean;

  // Selection
  selectedCount: number;
  onFilterToSelection?: () => void;

  // Partition filter
  partitionFilter: PartitionFilter;
  onPartitionFilterChange: (filter: PartitionFilter) => void;
  folds: FoldsInfo | null;
  totalSamples: number;
  /** Metadata for selection filters */
  metadata?: Record<string, unknown[]>;

  // Advanced filtering (Phase 5)
  metrics?: MetricsResult | null;
  metricFilters?: MetricFilter[];
  onMetricFiltersChange?: (filters: MetricFilter[]) => void;
  onDetectOutliers?: (method: OutlierMethod, threshold: number) => Promise<OutlierResult>;
  onFindSimilar?: (referenceIdx: number, metric: DistanceMetric, threshold?: number, topK?: number) => Promise<SimilarityResult>;
  selectedSample?: number | null;
  sampleIds?: string[];

  // Step comparison
  hasOperators: boolean;
  operators: UnifiedOperator[];
  stepComparisonEnabled: boolean;
  onStepComparisonEnabledChange?: (enabled: boolean) => void;
  activeStep: number;
  onActiveStepChange?: (step: number) => void;
  enabledOperatorCount: number;

  // Color mode
  colorConfig: ExtendedColorConfig;
  onColorConfigChange: (config: ExtendedColorConfig) => void;

  // Render mode
  displayRenderMode: RenderMode;
  effectiveRenderMode: RenderMode;
  isWebGLActive: boolean;
  onRenderModeChange: (mode: RenderMode) => void;

  // Saved selections
  datasetId?: string;

  // Export handlers
  onExportChartPng: (chartType: ChartType) => Promise<void>;
  onExportSpectraCsv: () => Promise<void>;
  onExportSelectionsJson: () => Promise<void>;
  onBatchExport: () => Promise<void>;

  // Interaction
  onInteractionStart: () => void;
}

// ============= Sub-Components =============

interface ColorModeSelectorProps {
  colorConfig: ExtendedColorConfig;
  onChange: (config: ExtendedColorConfig) => void;
  hasFolds: boolean;
}

const ColorModeSelector = memo(function ColorModeSelector({
  colorConfig,
  onChange,
  hasFolds,
}: ColorModeSelectorProps) {
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
});

// ============= Main Component =============

export const CanvasToolbar = memo(function CanvasToolbar({
  visibleCharts,
  effectiveVisibleCharts,
  onToggleChart,
  hasFolds,
  hasRepetitions,
  isFetching,
  selectedCount,
  onFilterToSelection,
  partitionFilter,
  onPartitionFilterChange,
  folds,
  totalSamples,
  metadata,
  metrics,
  metricFilters = [],
  onMetricFiltersChange,
  onDetectOutliers,
  onFindSimilar,
  selectedSample,
  sampleIds,
  hasOperators,
  operators,
  stepComparisonEnabled,
  onStepComparisonEnabledChange,
  activeStep,
  onActiveStepChange,
  enabledOperatorCount,
  colorConfig,
  onColorConfigChange,
  displayRenderMode,
  effectiveRenderMode,
  isWebGLActive,
  onRenderModeChange,
  datasetId,
  onExportChartPng,
  onExportSpectraCsv,
  onExportSelectionsJson,
  onBatchExport,
  onInteractionStart,
}: CanvasToolbarProps) {
  // Handle step comparison enabled change
  const handleStepComparisonEnabledChange = useCallback((enabled: boolean) => {
    onStepComparisonEnabledChange?.(enabled);
    if (enabled && activeStep === 0 && enabledOperatorCount > 0) {
      onActiveStepChange?.(enabledOperatorCount);
    }
  }, [onStepComparisonEnabledChange, onActiveStepChange, activeStep, enabledOperatorCount]);

  const handleActiveStepChange = useCallback((step: number) => {
    onActiveStepChange?.(step);
  }, [onActiveStepChange]);

  const handleColorConfigChange = useCallback((config: ExtendedColorConfig) => {
    onInteractionStart();
    onColorConfigChange(config);
  }, [onInteractionStart, onColorConfigChange]);

  return (
    <div
      className="flex items-center justify-between gap-2 px-3 py-1.5 border-b border-border bg-card/50"
      role="toolbar"
      aria-label="Chart controls"
    >
      <div className="flex items-center gap-1.5" role="group" aria-label="Chart visibility toggles">
        <span className="text-[10px] text-muted-foreground mr-1">Show:</span>
        {CHART_CONFIG.map(({ id, label, requiresFolds, requiresRepetitions }) => {
          const isVisible = effectiveVisibleCharts.has(id);
          const isDisabled = (requiresFolds && !hasFolds) || (requiresRepetitions && !hasRepetitions);

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
              onMouseDown={onInteractionStart}
              onClick={() => !isDisabled && onToggleChart(id)}
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

        {/* Selection by metadata/fold filter */}
        <SelectionFilters
          folds={folds}
          metadata={metadata}
          sampleIds={sampleIds}
          totalSamples={totalSamples}
          compact
        />

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
                      onClick={onFilterToSelection}
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
              onChange={onPartitionFilterChange}
              folds={folds}
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
                  activeFilters={metricFilters ?? []}
                  onFiltersChange={onMetricFiltersChange}
                  totalSamples={totalSamples}
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
                  selectedSample={selectedSample ?? null}
                  sampleIds={sampleIds}
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
            onInteractionStart={onInteractionStart}
            isLoading={isFetching}
            compact
          />
        )}

        <span className="text-[10px] text-muted-foreground">Color:</span>
        <ColorModeSelector
          colorConfig={colorConfig}
          onChange={handleColorConfigChange}
          hasFolds={hasFolds}
        />

        {/* Phase 6: Render mode selector */}
        <Separator orientation="vertical" className="h-4" />
        <TooltipProvider delayDuration={200}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Select
                value={displayRenderMode}
                onValueChange={(value) => onRenderModeChange(value as RenderMode)}
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
                  ? `Auto-selects best renderer based on data size (using ${effectiveRenderMode})`
                  : displayRenderMode === 'webgl' || displayRenderMode === 'webgl_aggregated'
                    ? 'GPU-accelerated rendering for large datasets'
                    : 'Standard canvas rendering'}
                {isWebGLActive && effectiveRenderMode.startsWith('webgl') && ' (WebGL active)'}
              </p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>

        {/* Phase 6: Saved Selections */}
        <SavedSelections compact sampleIds={sampleIds} />

        {/* Phase 6: Export menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="h-6 px-2 text-[10px] gap-1">
              <Download className="w-3 h-3" />
              Export
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem onClick={() => onExportChartPng('spectra')}>
              <Image className="w-4 h-4 mr-2" />
              Spectra as PNG
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onExportChartPng('pca')}>
              <Image className="w-4 h-4 mr-2" />
              PCA Plot as PNG
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onExportChartPng('histogram')}>
              <Image className="w-4 h-4 mr-2" />
              Histogram as PNG
            </DropdownMenuItem>
            {hasFolds && (
              <DropdownMenuItem onClick={() => onExportChartPng('folds')}>
                <Image className="w-4 h-4 mr-2" />
                Folds as PNG
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onBatchExport}>
              <Image className="w-4 h-4 mr-2" />
              All Charts as PNG
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onExportSpectraCsv}>
              <FileText className="w-4 h-4 mr-2" />
              Spectra as CSV
            </DropdownMenuItem>
            {selectedCount > 0 && (
              <DropdownMenuItem onClick={onExportSelectionsJson}>
                <FileText className="w-4 h-4 mr-2" />
                Selection as JSON
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
});

export default CanvasToolbar;
