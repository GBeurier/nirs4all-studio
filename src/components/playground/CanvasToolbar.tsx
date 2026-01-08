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

import { useCallback, memo, useMemo } from 'react';
import {
  Eye,
  EyeOff,
  Loader2,
  Filter,
  Activity,
  Download,
  Image,
  FileText,
  Palette,
} from 'lucide-react';
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
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { StepComparisonSlider } from './StepComparisonSlider';
import { PartitionSelector, type PartitionFilter } from './PartitionSelector';
import { MetricsFilterPanel } from './MetricsFilterPanel';
import { OutlierSelector, type OutlierMethod } from './OutlierSelector';
import { SimilarityFilter, type DistanceMetric } from './SimilarityFilter';
import { SavedSelections } from './SavedSelections';
import { SelectionFilters } from './SelectionFilters';
import { ReferenceModeControls } from './ReferenceModeControls';
import type { RenderMode } from '@/lib/playground/renderOptimizer';
import type { UnifiedOperator, MetricsResult, MetricFilter, OutlierResult, SimilarityResult, FoldsInfo } from '@/types/playground';
import {
  type GlobalColorConfig,
  type GlobalColorMode,
  type ContinuousPalette,
  type CategoricalPalette,
  type ColorContext,
  CATEGORICAL_PALETTES,
  getContinuousPaletteLabel,
  getCategoricalPaletteLabel,
  getColorModeLabel,
  getContinuousPaletteGradient,
  isContinuousMode,
  getEffectiveTargetType,
} from '@/lib/playground/colorConfig';
import { type TargetType, isCategoricalTarget } from '@/lib/playground/targetTypeDetection';
import { ColorLegend } from './ColorLegend';
import { DisplayFilters } from './DisplayFilters';
import { type ChartType } from '@/context/PlaygroundViewContext';

// Re-export ChartType for consumers
export type { ChartType };

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

  // Phase 6: Reference mode
  /** Current dataset ID for reference picker exclusion */
  currentDatasetId?: string;

  // Color mode
  colorConfig: GlobalColorConfig;
  onColorConfigChange: (config: GlobalColorConfig) => void;
  /** Whether outliers have been detected (enables outlier color mode) */
  hasOutliers?: boolean;
  /** Number of outliers detected */
  outlierCount?: number;
  /** Color context for legend display */
  colorContext?: ColorContext;

  // Render mode
  displayRenderMode: RenderMode;
  effectiveRenderMode: RenderMode;
  isWebGLActive: boolean;
  onRenderModeChange: (mode: RenderMode) => void;

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
  colorConfig: GlobalColorConfig;
  onChange: (config: GlobalColorConfig) => void;
  hasFolds: boolean;
  hasPartition: boolean;
  hasOutliers: boolean;
  metadataColumns: string[];
  /** Color context for Phase 5 target type info */
  colorContext?: ColorContext;
}

const ColorModeSelector = memo(function ColorModeSelector({
  colorConfig,
  onChange,
  hasFolds,
  hasPartition,
  hasOutliers,
  metadataColumns,
  colorContext,
}: ColorModeSelectorProps) {
  const hasMetadata = metadataColumns.length > 0;

  // Phase 5: Get effective target type considering override
  const detectedTargetType = colorContext?.targetType;
  const effectiveTargetType = getEffectiveTargetType(detectedTargetType, colorConfig.targetTypeOverride);
  const isClassificationMode = effectiveTargetType && isCategoricalTarget(effectiveTargetType);

  const showContinuousPalette = isContinuousMode(
    colorConfig.mode,
    colorConfig.metadataType,
    detectedTargetType,
    colorConfig.targetTypeOverride
  );

  // Palette preview colors
  const continuousPaletteOptions: ContinuousPalette[] = ['blue_red', 'viridis', 'plasma', 'inferno', 'coolwarm', 'spectral'];
  const categoricalPaletteOptions: CategoricalPalette[] = ['default', 'tableau10', 'set1', 'set2', 'paired'];

  return (
    <div className="flex items-center gap-1">
      {/* Mode selector with icon */}
      <Palette className="w-3 h-3 text-muted-foreground" />
      <Select
        value={colorConfig.mode}
        onValueChange={(mode) => onChange({
          ...colorConfig,
          mode: mode as GlobalColorMode,
          // Clear metadata key when switching away from metadata mode
          metadataKey: mode === 'metadata' ? colorConfig.metadataKey : undefined,
        })}
      >
        <SelectTrigger className="h-6 w-28 text-[10px]">
          <SelectValue>{getColorModeLabel(colorConfig.mode)}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="target">By Y Value</SelectItem>
          <SelectItem value="index">By Index</SelectItem>
          <SelectItem value="partition" disabled={!hasPartition}>By Partition</SelectItem>
          <SelectItem value="fold" disabled={!hasFolds}>By Fold</SelectItem>
          <SelectItem value="metadata" disabled={!hasMetadata}>By Metadata</SelectItem>
          <SelectItem value="selection">By Selection</SelectItem>
        </SelectContent>
      </Select>

      {/* Metadata column picker */}
      {colorConfig.mode === 'metadata' && hasMetadata && (
        <Select
          value={colorConfig.metadataKey || metadataColumns[0]}
          onValueChange={(key) => onChange({ ...colorConfig, metadataKey: key })}
        >
          <SelectTrigger className="h-6 w-24 text-[10px]">
            <SelectValue placeholder="Column..." />
          </SelectTrigger>
          <SelectContent>
            {metadataColumns.map(col => (
              <SelectItem key={col} value={col}>{col}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {/* Palette selector dropdown */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="h-6 w-6 p-0">
            <Palette className="w-3 h-3" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          {/* Phase 5: Target type override when in target mode */}
          {colorConfig.mode === 'target' && (
            <>
              <DropdownMenuLabel className="text-[10px] text-muted-foreground">
                Target Type
                {detectedTargetType && (
                  <span className="ml-1 text-muted-foreground/70">
                    (detected: {detectedTargetType})
                  </span>
                )}
              </DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={colorConfig.targetTypeOverride ?? 'auto'}
                onValueChange={(value) => onChange({
                  ...colorConfig,
                  targetTypeOverride: value as TargetType | 'auto',
                })}
              >
                <DropdownMenuRadioItem value="auto">
                  <span className="text-xs">Auto-detect</span>
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="regression">
                  <span className="text-xs">Force Regression (continuous)</span>
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="classification">
                  <span className="text-xs">Force Classification (categorical)</span>
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="ordinal">
                  <span className="text-xs">Force Ordinal (rating scale)</span>
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
              <DropdownMenuSeparator />
            </>
          )}

          {showContinuousPalette ? (
            <>
              <DropdownMenuLabel className="text-[10px] text-muted-foreground">
                Continuous Palette
              </DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={colorConfig.continuousPalette}
                onValueChange={(value) => onChange({ ...colorConfig, continuousPalette: value as ContinuousPalette })}
              >
                {continuousPaletteOptions.map(palette => (
                  <DropdownMenuRadioItem key={palette} value={palette} className="flex items-center gap-2">
                    <div
                      className="w-16 h-3 rounded-sm"
                      style={{ background: getContinuousPaletteGradient(palette) }}
                    />
                    <span className="text-xs">{getContinuousPaletteLabel(palette)}</span>
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </>
          ) : (
            <>
              <DropdownMenuLabel className="text-[10px] text-muted-foreground">
                Categorical Palette
              </DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={colorConfig.categoricalPalette}
                onValueChange={(value) => onChange({ ...colorConfig, categoricalPalette: value as CategoricalPalette })}
              >
                {categoricalPaletteOptions.map(palette => (
                  <DropdownMenuRadioItem key={palette} value={palette} className="flex items-center gap-2">
                    <div className="flex gap-0.5">
                      {CATEGORICAL_PALETTES[palette].slice(0, 5).map((color, i) => (
                        <div
                          key={i}
                          className="w-3 h-3 rounded-sm"
                          style={{ backgroundColor: color }}
                        />
                      ))}
                    </div>
                    <span className="text-xs">{getCategoricalPaletteLabel(palette)}</span>
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
});

// ============= Main Component =============

export const CanvasToolbar = memo(function CanvasToolbar({
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
  currentDatasetId,
  colorConfig,
  onColorConfigChange,
  hasOutliers = false,
  outlierCount = 0,
  colorContext,
  displayRenderMode,
  effectiveRenderMode,
  isWebGLActive,
  onRenderModeChange,
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

  const handleColorConfigChange = useCallback((config: GlobalColorConfig) => {
    onInteractionStart();
    onColorConfigChange(config);
  }, [onInteractionStart, onColorConfigChange]);

  // Extract metadata column names
  const metadataColumns = useMemo(() => {
    if (!metadata) return [];
    return Object.keys(metadata).filter(key => {
      const values = metadata[key];
      return Array.isArray(values) && values.length > 0;
    });
  }, [metadata]);

  // Determine if partition coloring is available (has folds with train/test split)
  const hasPartition = hasFolds;

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

        {/* Display Filters (Phase 4) */}
        <DisplayFilters
          hasOutliers={hasOutliers}
          outlierCount={outlierCount}
          selectedCount={selectedCount}
          totalSamples={totalSamples}
          compact
        />

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

        {/* Phase 6: Reference Mode Controls */}
        {hasOperators && (
          <>
            <Separator orientation="vertical" className="h-4" />
            <ReferenceModeControls
              stepComparisonEnabled={stepComparisonEnabled}
              onDisableStepComparison={() => onStepComparisonEnabledChange?.(false)}
              currentDatasetId={currentDatasetId}
              onInteractionStart={onInteractionStart}
              compact
            />
          </>
        )}

        {/* Step comparison slider (compact) - only show when there are operators and in step mode */}
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

        <ColorModeSelector
          colorConfig={colorConfig}
          onChange={handleColorConfigChange}
          hasFolds={hasFolds}
          hasPartition={hasPartition}
          hasOutliers={hasOutliers}
          metadataColumns={metadataColumns}
          colorContext={colorContext}
        />

        {/* Color Legend (inline) */}
        {colorContext && (
          <ColorLegend
            config={colorConfig}
            context={colorContext}
            collapsed={false}
            className="border-0 shadow-none bg-transparent min-w-0 max-w-none"
          />
        )}

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
