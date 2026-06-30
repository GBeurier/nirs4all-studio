import { memo } from 'react';
import { ArrowLeftRight, Eye, EyeOff, Filter, Layers, Loader2 } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import type { SpectraViewMode } from '@/lib/playground/spectraConfig';
import type { SubsetInfo } from '@/types/playground';
import type { ChartType } from '@/context/usePlaygroundView';
import { CHART_CONFIG } from './CanvasToolbarChartConfig';
import { RibbonGroup } from './CanvasToolbarRibbonGroup';

export interface ToggleableChartControl {
  id: ChartType;
  label: string;
  disabled: boolean;
  disabledReason: string | null;
}

export interface CanvasToolbarViewGroupProps {
  effectiveVisibleCharts: Set<ChartType>;
  onToggleChart: (chart: ChartType) => void;
  toggleableCharts?: readonly ToggleableChartControl[];
  showFoldsChart: boolean;
  hasRepetitions: boolean;
  isFetching: boolean;
  totalSamples: number;
  onInteractionStart: () => void;
  spectraViewMode?: SpectraViewMode;
  onSpectraViewModeChange?: (mode: SpectraViewMode) => void;
  showAbsoluteDifference?: boolean;
  onToggleAbsoluteDifference?: () => void;
  subsetMode?: 'all' | 'visible';
  onSubsetModeChange?: (mode: 'all' | 'visible') => void;
  subsetInfo?: SubsetInfo;
}

export const CanvasToolbarViewGroup = memo(function CanvasToolbarViewGroup({
  effectiveVisibleCharts,
  onToggleChart,
  toggleableCharts,
  showFoldsChart,
  hasRepetitions,
  isFetching,
  totalSamples,
  onInteractionStart,
  spectraViewMode,
  onSpectraViewModeChange,
  showAbsoluteDifference = false,
  onToggleAbsoluteDifference,
  subsetMode = 'all',
  onSubsetModeChange,
  subsetInfo,
}: CanvasToolbarViewGroupProps) {
  const chartControls = toggleableCharts ?? CHART_CONFIG.map(({ id, label, requiresFolds, requiresRepetitions }) => {
    const disabled = (requiresFolds && !showFoldsChart) || (requiresRepetitions && !hasRepetitions) || false;
    const disabledReason = disabled
      ? (requiresFolds
          ? 'Add a splitter operator (or load a dataset with a test partition) to see fold distribution'
          : 'No repetitions detected in dataset')
      : null;

    return { id, label, disabled, disabledReason };
  });

  return (
    <RibbonGroup label="View" icon={<Layers className="w-2.5 h-2.5" />}>
      {chartControls.map(({ id, label, disabled, disabledReason }, index) => {
        const isVisible = effectiveVisibleCharts.has(id);
        const tooltipText = disabled
          ? (disabledReason ?? 'Chart unavailable')
          : `${isVisible ? 'Hide' : 'Show'} ${label} chart (press ${index + 1})`;

        return (
          <TooltipProvider key={id} delayDuration={200}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant={isVisible ? 'secondary' : 'ghost'}
                  size="sm"
                  className={cn(
                    'h-5 text-[10px] gap-1 px-1.5',
                    !isVisible && 'opacity-50',
                    disabled && 'cursor-not-allowed opacity-30'
                  )}
                  onMouseDown={onInteractionStart}
                  onClick={() => !disabled && onToggleChart(id)}
                  disabled={disabled}
                >
                  {isVisible ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                  {label}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">{tooltipText}</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        );
      })}

      {onSpectraViewModeChange && (
        <>
          <Separator orientation="vertical" className="h-4 mx-1" />
          <TooltipProvider delayDuration={200}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant={spectraViewMode === 'difference' ? 'secondary' : 'ghost'}
                  size="sm"
                  className={cn(
                    'h-5 text-[10px] gap-1 px-1.5',
                    spectraViewMode === 'difference' && 'bg-orange-500/20 text-orange-600 dark:text-orange-400'
                  )}
                  onMouseDown={onInteractionStart}
                  onClick={() => onSpectraViewModeChange(spectraViewMode === 'difference' ? 'processed' : 'difference')}
                >
                  <ArrowLeftRight className="w-3 h-3" />
                  Diff
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                {spectraViewMode === 'difference'
                  ? 'Exit difference mode (show processed spectra)'
                  : 'Enter difference mode (show per-sample distances)'}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          {spectraViewMode === 'difference' && onToggleAbsoluteDifference && (
            <TooltipProvider delayDuration={200}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant={showAbsoluteDifference ? 'secondary' : 'ghost'}
                    size="sm"
                    className="h-5 text-[10px] px-1.5"
                    onClick={onToggleAbsoluteDifference}
                  >
                    {showAbsoluteDifference ? '|Δ|' : '±Δ'}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  {showAbsoluteDifference ? 'Show signed differences' : 'Show absolute differences'}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </>
      )}

      {onSubsetModeChange && totalSamples > 200 && (
        <>
          <Separator orientation="vertical" className="h-4 mx-1" />
          <TooltipProvider delayDuration={200}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant={subsetMode === 'visible' ? 'secondary' : 'ghost'}
                  size="sm"
                  className={cn(
                    'h-5 text-[10px] gap-1 px-1.5',
                    subsetMode === 'visible' && 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400'
                  )}
                  onMouseDown={onInteractionStart}
                  onClick={() => onSubsetModeChange(subsetMode === 'all' ? 'visible' : 'all')}
                >
                  <Filter className="w-3 h-3" />
                  {subsetMode === 'visible' ? 'Subset' : 'All'}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-xs">
                {subsetMode === 'visible' ? (
                  <div className="text-xs">
                    <p className="font-medium">Subset mode (faster)</p>
                    <p>Processing {subsetInfo?.displayed_samples ?? 200} of {subsetInfo?.total_samples ?? totalSamples} samples.</p>
                    <p className="text-muted-foreground mt-1">Click to process all samples. Fold distributions may not be representative in subset mode.</p>
                  </div>
                ) : (
                  <div className="text-xs">
                    <p className="font-medium">All samples mode</p>
                    <p>Processing all {totalSamples} samples.</p>
                    <p className="text-muted-foreground mt-1">Click to process a representative subset for faster rendering.</p>
                  </div>
                )}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          {subsetMode === 'visible' && subsetInfo && (
            <Badge variant="outline" className="h-4 px-1.5 text-[9px] font-normal text-emerald-600 dark:text-emerald-400 border-emerald-500/30">
              {subsetInfo.displayed_samples}/{subsetInfo.total_samples}
            </Badge>
          )}
        </>
      )}

      {isFetching && (
        <Loader2 className="w-3 h-3 animate-spin text-primary ml-1" />
      )}
    </RibbonGroup>
  );
});
