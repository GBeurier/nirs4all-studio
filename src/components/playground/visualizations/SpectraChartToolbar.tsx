/**
 * SpectraChartToolbar - Toolbar for enhanced SpectraChart controls
 *
 * Phase 2 Implementation: Enhanced Spectra Chart
 *
 * Provides controls for:
 * - View mode selection (Processed/Original/Both/Difference)
 * - Display mode selection (All spectra, Mean±Std, Quantiles, etc.)
 * - Sampling strategy selection
 * - Sample count adjustment
 * - Wavelength focus controls
 * - Export options
 */

import { useState, useMemo, useCallback } from 'react';
import {
  Download,
  Eye,
  EyeOff,
  Layers,
  BarChart3,
  Settings2,
  ChevronDown,
  ZoomIn,
  Sigma,
  Shuffle,
  Target,
  RefreshCw,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Slider } from '@/components/ui/slider';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type {
  SpectraViewMode,
  AggregationMode,
  SamplingStrategy,
} from '@/lib/playground/spectraConfig';
import type { UseSpectraChartConfigResult } from '@/lib/playground/useSpectraChartConfig';
import type { SamplingResult } from '@/lib/playground/sampling';

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
}

// ============= Constants =============

const VIEW_MODE_OPTIONS: { value: SpectraViewMode; label: string; icon: React.ReactNode }[] = [
  { value: 'processed', label: 'Processed', icon: <Layers className="w-3 h-3" /> },
  { value: 'original', label: 'Original', icon: <Layers className="w-3 h-3 opacity-50" /> },
  { value: 'both', label: 'Both', icon: <Eye className="w-3 h-3" /> },
  { value: 'difference', label: 'Difference', icon: <Sigma className="w-3 h-3" /> },
];

const AGGREGATION_OPTIONS: { value: AggregationMode; label: string; description: string }[] = [
  { value: 'none', label: 'All Spectra', description: 'Show individual spectra lines' },
  { value: 'mean_std', label: 'Mean ± Std', description: 'Show mean with standard deviation band' },
  { value: 'median_quantiles', label: 'Median + p5/p95', description: 'Show median with quantile bands' },
  { value: 'minmax', label: 'Min/Max', description: 'Show min/max envelope' },
  { value: 'density', label: 'Density Map', description: 'Show 2D density heatmap' },
];

const SAMPLING_OPTIONS: { value: SamplingStrategy; label: string; description: string }[] = [
  { value: 'random', label: 'Random', description: 'Uniform random selection' },
  { value: 'stratified', label: 'Stratified', description: 'Preserve Y distribution' },
  { value: 'coverage', label: 'Coverage', description: 'Maximize feature space coverage' },
  { value: 'progressive', label: 'Progressive', description: 'Level-of-detail' },
];

const SAMPLE_COUNT_PRESETS = [25, 50, 100, 200, 500, 1000];

// ============= Sub-Components =============

interface ViewModeSelectorProps {
  value: SpectraViewMode;
  onChange: (value: SpectraViewMode) => void;
  onInteractionStart?: () => void;
  compact?: boolean;
}

function ViewModeSelector({ value, onChange, onInteractionStart, compact }: ViewModeSelectorProps) {
  return (
    <Select
      value={value}
      onValueChange={(v) => {
        onInteractionStart?.();
        onChange(v as SpectraViewMode);
      }}
    >
      <SelectTrigger className={cn('text-xs', compact ? 'h-7 w-24' : 'h-7 w-28')}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {VIEW_MODE_OPTIONS.map((opt) => (
          <SelectItem key={opt.value} value={opt.value}>
            <span className="flex items-center gap-1.5">
              {opt.icon}
              {opt.label}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

interface AggregationSelectorProps {
  value: AggregationMode;
  onChange: (value: AggregationMode) => void;
  onInteractionStart?: () => void;
  compact?: boolean;
}

function AggregationSelector({ value, onChange, onInteractionStart, compact }: AggregationSelectorProps) {
  return (
    <Select
      value={value}
      onValueChange={(v) => {
        onInteractionStart?.();
        onChange(v as AggregationMode);
      }}
    >
      <SelectTrigger className={cn('text-xs', compact ? 'h-7 w-32' : 'h-7 w-36')}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {AGGREGATION_OPTIONS.map((opt) => (
          <SelectItem key={opt.value} value={opt.value}>
            <span className="flex flex-col">
              <span>{opt.label}</span>
              {!compact && (
                <span className="text-[10px] text-muted-foreground">{opt.description}</span>
              )}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

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
}: SpectraChartToolbarProps) {
  const { config, setViewMode, setAggregationMode, setSamplingStrategy, setSampleCount } = configResult;

  // Show settings dropdown for less common options
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Compute sample count description
  const sampleDescription = useMemo(() => {
    if (samplingResult && samplingResult.wasApplied) {
      return `${displayedSamples}/${totalSamples}`;
    }
    return `${totalSamples}`;
  }, [samplingResult, displayedSamples, totalSamples]);

  return (
    <TooltipProvider>
      <div className={cn(
        'flex items-center justify-between gap-2 flex-wrap',
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
        <div className="flex items-center gap-1.5">
          {/* View mode selector */}
          <ViewModeSelector
            value={config.viewMode}
            onChange={setViewMode}
            onInteractionStart={onInteractionStart}
            compact={compact}
          />

          {/* Aggregation selector */}
          <AggregationSelector
            value={config.aggregation.mode}
            onChange={setAggregationMode}
            onInteractionStart={onInteractionStart}
            compact={compact}
          />

          {/* Sampling dropdown (when showing all spectra) */}
          {config.aggregation.mode === 'none' && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className={cn('text-xs gap-1', compact ? 'h-7 px-2' : 'h-7 px-2')}>
                  <Shuffle className="w-3 h-3" />
                  {compact ? displayedSamples : `${displayedSamples} samples`}
                  <ChevronDown className="w-3 h-3 opacity-50" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel className="text-xs">Sampling Strategy</DropdownMenuLabel>
                {SAMPLING_OPTIONS.map((opt) => (
                  <DropdownMenuItem
                    key={opt.value}
                    onClick={() => {
                      onInteractionStart?.();
                      setSamplingStrategy(opt.value);
                    }}
                    className={cn(config.sampling.strategy === opt.value && 'bg-accent')}
                  >
                    <div className="flex flex-col">
                      <span className="font-medium">{opt.label}</span>
                      <span className="text-[10px] text-muted-foreground">{opt.description}</span>
                    </div>
                  </DropdownMenuItem>
                ))}

                <DropdownMenuSeparator />
                <DropdownMenuLabel className="text-xs">Sample Count</DropdownMenuLabel>

                <div className="px-2 py-2">
                  <div className="flex gap-1 flex-wrap">
                    {SAMPLE_COUNT_PRESETS.map((count) => (
                      <Button
                        key={count}
                        variant={config.sampling.sampleCount === count ? 'secondary' : 'outline'}
                        size="sm"
                        className="h-6 text-[10px] px-2"
                        onClick={() => {
                          onInteractionStart?.();
                          setSampleCount(count);
                        }}
                        disabled={count > totalSamples}
                      >
                        {count}
                      </Button>
                    ))}
                  </div>
                </div>

                <DropdownMenuSeparator />
                <div className="px-2 py-2">
                  <div className="text-[10px] text-muted-foreground mb-1">Custom count</div>
                  <Slider
                    value={[config.sampling.sampleCount]}
                    min={10}
                    max={Math.min(1000, totalSamples)}
                    step={10}
                    onValueChange={([value]) => {
                      onInteractionStart?.();
                      setSampleCount(value);
                    }}
                    className="w-full"
                  />
                </div>
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {/* Reset zoom button */}
          {brushActive && onResetBrush && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className={cn('text-xs gap-1', compact ? 'h-7 px-2' : 'h-7 px-2')}
                  onClick={onResetBrush}
                >
                  <ZoomIn className="w-3 h-3" />
                  Reset
                </Button>
              </TooltipTrigger>
              <TooltipContent>Reset wavelength zoom</TooltipContent>
            </Tooltip>
          )}

          {/* Export button */}
          {onExport && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className={cn(compact ? 'h-7 px-2' : 'h-7 px-2')}
                  onClick={onExport}
                >
                  <Download className="w-3 h-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Export chart data</TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>
    </TooltipProvider>
  );
}

export default SpectraChartToolbar;
