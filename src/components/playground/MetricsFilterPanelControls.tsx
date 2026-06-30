import { Beaker, ChevronDown, RotateCcw } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { METRIC_FILTER_PRESETS } from '@/lib/playground/metricFilterData';
import { cn } from '@/lib/utils';

interface MetricsUnavailableTriggerProps {
  compact: boolean;
  isLoading: boolean;
}

export function MetricsUnavailableTrigger({ compact, isLoading }: MetricsUnavailableTriggerProps) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className={cn(
              'text-xs gap-1.5 opacity-50 cursor-not-allowed',
              compact ? 'h-7 px-2' : 'h-8 px-3'
            )}
            disabled
          >
            <Beaker className="w-3 h-3" />
            Metrics
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p className="text-xs">
            {isLoading ? 'Loading metrics...' : 'No metrics available. Execute pipeline first.'}
          </p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

interface MetricsFilterTriggerProps {
  activeFilterCount: number;
  compact: boolean;
}

export function MetricsFilterTrigger({ activeFilterCount, compact }: MetricsFilterTriggerProps) {
  const hasActiveFilters = activeFilterCount > 0;

  return (
    <Button
      variant="outline"
      size="sm"
      className={cn(
        'text-xs gap-1.5',
        compact ? 'h-7 px-2' : 'h-8 px-3',
        hasActiveFilters && 'border-primary/50 bg-primary/5'
      )}
    >
      <Beaker className="w-3 h-3" />
      Metrics
      {hasActiveFilters && (
        <Badge variant="secondary" className="h-4 px-1 text-[9px]">
          {activeFilterCount}
        </Badge>
      )}
      <ChevronDown className="w-3 h-3 opacity-50" />
    </Button>
  );
}

interface MetricsFilterHeaderProps {
  filteredSampleCount: number;
  hasActiveFilters: boolean;
  onClearAll: () => void;
  totalSamples: number;
}

export function MetricsFilterHeader({
  filteredSampleCount,
  hasActiveFilters,
  onClearAll,
  totalSamples,
}: MetricsFilterHeaderProps) {
  return (
    <div className="flex items-center justify-between px-3 py-2 border-b shrink-0">
      <h4 className="text-sm font-semibold flex items-center gap-2">
        <Beaker className="w-4 h-4 text-primary" />
        Metric Filters
        {hasActiveFilters && (
          <Badge variant="outline" className="text-[10px]">
            {filteredSampleCount}/{totalSamples}
          </Badge>
        )}
      </h4>
      {hasActiveFilters && (
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-xs"
          onClick={onClearAll}
        >
          <RotateCcw className="w-3 h-3 mr-1" />
          Clear
        </Button>
      )}
    </div>
  );
}

interface MetricsPresetListProps {
  onApplyPreset: (presetId: string) => void;
}

export function MetricsPresetList({ onApplyPreset }: MetricsPresetListProps) {
  return (
    <div className="px-3 py-2 border-b shrink-0">
      <Label className="text-[10px] text-muted-foreground mb-1.5 block">Quick Presets</Label>
      <div className="flex flex-wrap gap-1">
        {METRIC_FILTER_PRESETS.map(preset => (
          <TooltipProvider key={preset.id} delayDuration={200}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-6 text-[10px] px-2"
                  onClick={() => onApplyPreset(preset.id)}
                >
                  {preset.name}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <p className="text-xs">{preset.description}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        ))}
      </div>
    </div>
  );
}

interface MetricsFilterFooterProps {
  filteredSampleCount: number;
  totalSamples: number;
}

export function MetricsFilterFooter({ filteredSampleCount, totalSamples }: MetricsFilterFooterProps) {
  return (
    <div className="px-3 py-2 border-t bg-muted/30 text-xs text-muted-foreground shrink-0">
      <div className="flex items-center justify-between">
        <span>
          Showing <strong className="text-foreground">{filteredSampleCount}</strong> of {totalSamples} samples
        </span>
        <span className="text-[10px]">
          ({Math.round((filteredSampleCount / totalSamples) * 100)}%)
        </span>
      </div>
    </div>
  );
}
