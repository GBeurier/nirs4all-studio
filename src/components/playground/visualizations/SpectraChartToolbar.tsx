/**
 * SpectraChartToolbar - Toolbar for SpectraChart with quick access controls
 *
 * Phase 3 Implementation: Enhanced UI
 *
 * Controls:
 * - Title and sample count
 * - View mode toggle (icon dropdown)
 * - Display mode toggle (icon dropdown)
 * - Sampling controls (icon dropdown)
 * - Render mode toggle (Canvas/WebGL)
 * - Settings popup button (Focus & Filter)
 * - Export button
 */

import { useMemo, useCallback } from 'react';
import {
  Download,
  Layers,
  RefreshCw,
  ZoomIn,
  Eye,
  LayoutGrid,
  Shuffle,
  Zap,
  Monitor,
  MousePointer2,
  Palette,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { Badge } from '@/components/ui/badge';
import { Slider } from '@/components/ui/slider';
import { cn } from '@/lib/utils';
import { SpectraSettingsPopup } from './SpectraSettingsPopup';
import type { UseSpectraChartConfigResult } from '@/lib/playground/useSpectraChartConfig';
import type { SamplingResult } from '@/lib/playground/sampling';
import type { UnifiedOperator } from '@/types/playground';
import type { RenderMode } from '@/lib/playground/renderOptimizer';
import type {
  SpectraViewMode,
  SpectraDisplayMode,
  SamplingStrategy,
} from '@/lib/playground/spectraConfig';

// ============= Types =============

export interface SpectraChartToolbarProps {
  /** Config hook result */
  configResult: UseSpectraChartConfigResult;
  /** Current sampling result */
  samplingResult?: SamplingResult;
  /** Total number of samples in dataset */
  totalSamples: number;
  /** Displayed sample count */
  displayedSamples: number;
  /** Whether data is loading */
  isLoading?: boolean;
  /** Whether brush zoom is active */
  brushActive?: boolean;
  /** Reset brush callback */
  onResetBrush?: () => void;
  /** Export callback */
  onExport?: () => void;
  /** Callback when any setting changes (for triggering redraw) */
  onInteractionStart?: () => void;
  /** Compact mode for smaller containers */
  compact?: boolean;
  /** Available operators for reference step selection */
  operators?: UnifiedOperator[];
  /** Available metadata columns for coloring */
  metadataColumns?: string[];
  /** Wavelength range for focus controls */
  wavelengthRange?: [number, number];
  /** Wavelength count for settings */
  wavelengthCount?: number;
  /** Current render mode (user selection for UI display) */
  renderMode?: RenderMode;
  /** Effective render mode (actual mode being used for rendering) */
  effectiveRenderMode?: RenderMode;
  /** Callback when render mode changes */
  onRenderModeChange?: (mode: RenderMode) => void;
}

// ============= Constants =============

const VIEW_MODE_OPTIONS: { value: SpectraViewMode; label: string }[] = [
  { value: 'processed', label: 'Processed' },
  { value: 'original', label: 'Original' },
  { value: 'both', label: 'Both' },
  { value: 'difference', label: 'Difference' },
];

const DISPLAY_MODE_OPTIONS: { value: SpectraDisplayMode; label: string }[] = [
  { value: 'individual', label: 'Individual' },
  { value: 'selected_only', label: 'Selected Only' },
  { value: 'aggregated', label: 'Aggregated' },
  { value: 'grouped', label: 'Grouped' },
];

const SAMPLING_STRATEGY_OPTIONS: { value: SamplingStrategy; label: string }[] = [
  { value: 'random', label: 'Random' },
  { value: 'stratified', label: 'Stratified' },
  { value: 'coverage', label: 'Coverage' },
  { value: 'progressive', label: 'Progressive' },
];

const SAMPLE_COUNT_PRESETS = [25, 50, 100, 200, 500];

/** Selection color presets - high visibility colors that work with various palettes */
const SELECTION_COLOR_PRESETS = [
  { value: undefined, label: 'Default (Cyan)', color: 'hsl(180, 85%, 45%)' },
  { value: 'hsl(0, 85%, 55%)', label: 'Red', color: 'hsl(0, 85%, 55%)' },
  { value: 'hsl(280, 75%, 55%)', label: 'Purple', color: 'hsl(280, 75%, 55%)' },
  { value: 'hsl(120, 70%, 45%)', label: 'Green', color: 'hsl(120, 70%, 45%)' },
  { value: 'hsl(45, 95%, 55%)', label: 'Gold', color: 'hsl(45, 95%, 55%)' },
  { value: 'hsl(320, 80%, 55%)', label: 'Magenta', color: 'hsl(320, 80%, 55%)' },
  { value: '#ffffff', label: 'White', color: '#ffffff' },
  { value: '#000000', label: 'Black', color: '#000000' },
];

// ============= Main Component =============

export function SpectraChartToolbar({
  configResult,
  samplingResult,
  totalSamples,
  displayedSamples,
  isLoading,
  brushActive,
  onResetBrush,
  onExport,
  onInteractionStart,
  compact = false,
  operators,
  metadataColumns,
  wavelengthRange,
  wavelengthCount,
  renderMode = 'auto',
  effectiveRenderMode,
  onRenderModeChange,
}: SpectraChartToolbarProps) {
  const { config } = configResult;

  // Compute sample count description
  const sampleDescription = useMemo(() => {
    if (samplingResult && samplingResult.wasApplied) {
      return `${displayedSamples}/${totalSamples}`;
    }
    return `${totalSamples}`;
  }, [samplingResult, displayedSamples, totalSamples]);

  // Count modified settings for badge (focus/filter only now)
  const modifiedCount = useMemo(() => {
    let count = 0;
    if (config.wavelengthFocus.range) count++;
    if (config.wavelengthFocus.derivative > 0) count++;
    if (config.wavelengthFocus.edgeMask.enabled) count++;
    if (config.filters.partition !== 'all') count++;
    if (config.filters.targetRange) count++;
    return count;
  }, [config]);

  // Handle view mode change
  const handleViewModeChange = useCallback((mode: string) => {
    onInteractionStart?.();
    configResult.setViewMode(mode as SpectraViewMode);
  }, [configResult, onInteractionStart]);

  // Handle display mode change
  const handleDisplayModeChange = useCallback((mode: string) => {
    onInteractionStart?.();
    configResult.setDisplayMode(mode as SpectraDisplayMode);

    // Reset aggregation mode for individual/selected_only to ensure clean display
    if (mode === 'individual' || mode === 'selected_only') {
      configResult.setAggregationMode('none');
    }
    // For aggregated mode, ensure aggregation mode is set
    else if (mode === 'aggregated' && config.aggregation.mode === 'none') {
      configResult.setAggregationMode('mean_std');
    }
    // For grouped mode, set default groupBy if not already set and metadata columns are available
    else if (mode === 'grouped') {
      if (!config.aggregation.groupBy && metadataColumns && metadataColumns.length > 0) {
        configResult.setGroupBy(metadataColumns[0]);
      }
      if (config.aggregation.mode === 'none') {
        configResult.setAggregationMode('mean_std');
      }
    }
  }, [configResult, config.aggregation.mode, config.aggregation.groupBy, metadataColumns, onInteractionStart]);

  // Handle sampling strategy change
  const handleSamplingStrategyChange = useCallback((strategy: string) => {
    onInteractionStart?.();
    configResult.setSamplingStrategy(strategy as SamplingStrategy);
  }, [configResult, onInteractionStart]);

  // Handle sample count change
  const handleSampleCountChange = useCallback((value: number[]) => {
    onInteractionStart?.();
    configResult.setSampleCount(value[0]);
  }, [configResult, onInteractionStart]);

  // Handle selection color change
  const handleSelectionColorChange = useCallback((color: string) => {
    onInteractionStart?.();
    // 'default' value means undefined (use default cyan)
    configResult.setSelectionColor(color === 'default' ? undefined : color);
  }, [configResult, onInteractionStart]);

  // Get current selection color for display
  const currentSelectionColor = config.colorConfig.selectionColor ?? 'hsl(180, 85%, 45%)';

  // Get view mode label
  const viewModeLabel = VIEW_MODE_OPTIONS.find(o => o.value === config.viewMode)?.label ?? 'Processed';
  const displayModeLabel = DISPLAY_MODE_OPTIONS.find(o => o.value === config.displayMode)?.label ?? 'Individual';

  return (
    <TooltipProvider delayDuration={300}>
      <div className={cn(
        'flex items-center justify-between gap-2',
        compact ? 'mb-1.5' : 'mb-2'
      )}>
        {/* Left side - Title and sample count */}
        <div className="flex items-center gap-2">
          <h3 className={cn(
            'font-semibold text-foreground flex items-center gap-2',
            compact ? 'text-xs' : 'text-sm'
          )}>
            <Layers className={cn('text-primary', compact ? 'w-3 h-3' : 'w-4 h-4')} />
            Spectra
          </h3>
          <Badge variant="outline" className={cn('font-mono', compact ? 'text-[9px] h-4 px-1' : 'text-[10px] h-5 px-1.5')}>
            {sampleDescription}
          </Badge>
          {isLoading && (
            <RefreshCw className={cn('animate-spin text-primary', compact ? 'w-3 h-3' : 'w-3.5 h-3.5')} />
          )}
        </div>

        {/* Right side - Controls */}
        <div className="flex items-center gap-1">
          {/* Reset zoom button (only when active) */}
          {brushActive && onResetBrush && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs gap-1"
                  onClick={onResetBrush}
                >
                  <ZoomIn className="w-3 h-3" />
                  Reset
                </Button>
              </TooltipTrigger>
              <TooltipContent>Reset wavelength zoom</TooltipContent>
            </Tooltip>
          )}

          {/* View Mode dropdown */}
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant={config.viewMode !== 'processed' ? 'secondary' : 'ghost'}
                    size="sm"
                    className="h-7 w-7 p-0"
                  >
                    <Eye className="w-3.5 h-3.5" />
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent>View: {viewModeLabel}</TooltipContent>
            </Tooltip>
            <DropdownMenuContent side="bottom" align="start" className="w-36">
              <DropdownMenuLabel className="text-[10px] text-muted-foreground">View Mode</DropdownMenuLabel>
              <DropdownMenuRadioGroup value={config.viewMode} onValueChange={handleViewModeChange}>
                {VIEW_MODE_OPTIONS.map(opt => (
                  <DropdownMenuRadioItem key={opt.value} value={opt.value} className="text-xs">
                    {opt.label}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Display Mode dropdown */}
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant={config.displayMode !== 'individual' ? 'secondary' : 'ghost'}
                    size="sm"
                    className="h-7 w-7 p-0"
                  >
                    <LayoutGrid className="w-3.5 h-3.5" />
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent>Display: {displayModeLabel}</TooltipContent>
            </Tooltip>
            <DropdownMenuContent side="bottom" align="start" className="w-36">
              <DropdownMenuLabel className="text-[10px] text-muted-foreground">Display Mode</DropdownMenuLabel>
              <DropdownMenuRadioGroup value={config.displayMode} onValueChange={handleDisplayModeChange}>
                {DISPLAY_MODE_OPTIONS.map(opt => (
                  <DropdownMenuRadioItem key={opt.value} value={opt.value} className="text-xs">
                    {opt.label}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Selection Color dropdown - always visible for changing selection highlight color */}
          <DropdownMenu>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant={config.colorConfig.selectionColor ? 'secondary' : 'ghost'}
                      size="sm"
                      className="h-7 w-7 p-0"
                    >
                      <Palette className="w-3.5 h-3.5" style={{ color: currentSelectionColor }} />
                    </Button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent>Selection color</TooltipContent>
              </Tooltip>
              <DropdownMenuContent side="bottom" align="start" className="w-40">
                <DropdownMenuLabel className="text-[10px] text-muted-foreground">Selection Color</DropdownMenuLabel>
                <DropdownMenuRadioGroup
                  value={config.colorConfig.selectionColor ?? 'default'}
                  onValueChange={handleSelectionColorChange}
                >
                  {SELECTION_COLOR_PRESETS.map(opt => (
                    <DropdownMenuRadioItem
                      key={opt.label}
                      value={opt.value ?? 'default'}
                      className="text-xs flex items-center gap-2"
                    >
                      <span
                        className="w-3 h-3 rounded-full border border-border flex-shrink-0"
                        style={{ backgroundColor: opt.color }}
                      />
                      {opt.label}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>

          {/* Sampling dropdown */}
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant={config.sampling.sampleCount !== totalSamples ? 'secondary' : 'ghost'}
                    size="sm"
                    className="h-7 w-7 p-0"
                  >
                    <Shuffle className="w-3.5 h-3.5" />
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent>Sampling: {config.sampling.sampleCount}/{totalSamples}</TooltipContent>
            </Tooltip>
            <DropdownMenuContent side="bottom" align="start" className="w-48 p-3">
              <DropdownMenuLabel className="text-[10px] text-muted-foreground px-0">Strategy</DropdownMenuLabel>
              <DropdownMenuRadioGroup value={config.sampling.strategy} onValueChange={handleSamplingStrategyChange}>
                {SAMPLING_STRATEGY_OPTIONS.map(opt => (
                  <DropdownMenuRadioItem key={opt.value} value={opt.value} className="text-xs">
                    {opt.label}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-[10px] text-muted-foreground px-0 flex justify-between">
                <span>Count</span>
                <span className="font-mono">{config.sampling.sampleCount}/{totalSamples}</span>
              </DropdownMenuLabel>
              <div className="flex gap-1 flex-wrap mb-2 mt-1">
                {SAMPLE_COUNT_PRESETS.filter(c => c <= totalSamples).map(count => (
                  <Button
                    key={count}
                    variant={config.sampling.sampleCount === count ? 'secondary' : 'ghost'}
                    size="sm"
                    className="h-5 text-[9px] px-1.5"
                    onClick={() => {
                      onInteractionStart?.();
                      configResult.setSampleCount(count);
                    }}
                  >
                    {count}
                  </Button>
                ))}
                <Button
                  variant={config.sampling.sampleCount === totalSamples ? 'secondary' : 'ghost'}
                  size="sm"
                  className="h-5 text-[9px] px-1.5"
                  onClick={() => {
                    onInteractionStart?.();
                    configResult.setSampleCount(totalSamples);
                  }}
                >
                  All
                </Button>
              </div>
              <Slider
                value={[config.sampling.sampleCount]}
                min={10}
                max={totalSamples}
                step={10}
                onValueChange={handleSampleCountChange}
                className="w-full"
              />
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Hover toggle */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={config.enableHover ? 'secondary' : 'ghost'}
                size="sm"
                className="h-7 w-7 p-0"
                onClick={() => configResult.toggleHover()}
              >
                <MousePointer2 className={cn("w-3.5 h-3.5", config.enableHover && "text-primary")} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{config.enableHover ? 'Hover enabled' : 'Hover disabled'}</TooltipContent>
          </Tooltip>

          {/* Render Mode toggle (Canvas/WebGL) - two checkable icons */}
          {onRenderModeChange && (
            <div className="flex items-center border rounded-md">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant={effectiveRenderMode === 'canvas' || renderMode === 'canvas' ? 'secondary' : 'ghost'}
                    size="sm"
                    className="h-7 w-7 p-0 rounded-r-none border-r"
                    onClick={() => onRenderModeChange('canvas')}
                  >
                    <Monitor className="w-3.5 h-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Canvas renderer</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant={effectiveRenderMode === 'webgl' || renderMode === 'webgl' ? 'secondary' : 'ghost'}
                    size="sm"
                    className="h-7 w-7 p-0 rounded-l-none"
                    onClick={() => onRenderModeChange('webgl')}
                  >
                    <Zap className={cn("w-3.5 h-3.5", (effectiveRenderMode === 'webgl' || renderMode === 'webgl') && "text-yellow-500")} />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>WebGL renderer (GPU accelerated)</TooltipContent>
              </Tooltip>
            </div>
          )}

          {/* Settings button (Focus & Filter) - uses standalone mode with built-in trigger */}
          <SpectraSettingsPopup
            configResult={configResult}
            operators={operators}
            metadataColumns={metadataColumns}
            wavelengthRange={wavelengthRange ?? [0, 1000]}
            wavelengthCount={wavelengthCount ?? 100}
            totalSamples={totalSamples}
            onInteractionStart={onInteractionStart}
            compact={compact}
          />

          {/* Export button */}
          {onExport && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0"
                  onClick={onExport}
                >
                  <Download className="w-3.5 h-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Export chart</TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>
    </TooltipProvider>
  );
}

export default SpectraChartToolbar;
