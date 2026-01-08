/**
 * DisplayFilters - Unified display filtering controls for Playground toolbar
 *
 * Phase 4: Display Filtering System
 *
 * Features:
 * - Outlier filter (All / Hide Outliers / Outliers Only)
 * - Selection filter (All / Selected Only / Unselected Only)
 * - Active filter badge
 * - Clear all filters button
 */

import { memo } from 'react';
import {
  AlertTriangle,
  MousePointer2,
  X,
  Filter,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import {
  useFilterOptional,
  type OutlierFilter,
  type SelectionFilter,
} from '@/context/FilterContext';

// ============= Types =============

export interface DisplayFiltersProps {
  /** Whether outliers have been detected */
  hasOutliers?: boolean;
  /** Number of outliers detected */
  outlierCount?: number;
  /** Number of selected samples */
  selectedCount?: number;
  /** Total samples */
  totalSamples?: number;
  /** Compact mode for smaller containers */
  compact?: boolean;
  /** Additional class name */
  className?: string;
}

// ============= Sub-Components =============

interface OutlierFilterSelectProps {
  value: OutlierFilter;
  onChange: (value: OutlierFilter) => void;
  hasOutliers: boolean;
  outlierCount: number;
  compact?: boolean;
}

const OutlierFilterSelect = memo(function OutlierFilterSelect({
  value,
  onChange,
  hasOutliers,
  outlierCount,
  compact,
}: OutlierFilterSelectProps) {
  const label = value === 'all' ? 'All' : value === 'hide' ? 'Hide' : 'Only';

  return (
    <div className="flex items-center gap-1">
      <AlertTriangle className="w-3 h-3 text-muted-foreground" />
      <Select
        value={value}
        onValueChange={(v) => onChange(v as OutlierFilter)}
        disabled={!hasOutliers}
      >
        <SelectTrigger
          className={cn(
            'text-xs border-none shadow-none bg-transparent hover:bg-muted/50 focus:ring-0',
            compact ? 'h-6 w-16 px-1' : 'h-7 w-20 px-2',
            !hasOutliers && 'opacity-50'
          )}
        >
          <SelectValue>{label}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">
            <div className="flex items-center justify-between w-full gap-2">
              <span>All</span>
            </div>
          </SelectItem>
          <SelectItem value="hide">
            <div className="flex items-center justify-between w-full gap-2">
              <span>Hide Outliers</span>
              {outlierCount > 0 && (
                <Badge variant="outline" className="h-4 px-1 text-[9px]">
                  -{outlierCount}
                </Badge>
              )}
            </div>
          </SelectItem>
          <SelectItem value="only">
            <div className="flex items-center justify-between w-full gap-2">
              <span>Outliers Only</span>
              {outlierCount > 0 && (
                <Badge variant="outline" className="h-4 px-1 text-[9px]">
                  {outlierCount}
                </Badge>
              )}
            </div>
          </SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
});

interface SelectionFilterSelectProps {
  value: SelectionFilter;
  onChange: (value: SelectionFilter) => void;
  selectedCount: number;
  totalSamples: number;
  compact?: boolean;
}

const SelectionFilterSelect = memo(function SelectionFilterSelect({
  value,
  onChange,
  selectedCount,
  totalSamples,
  compact,
}: SelectionFilterSelectProps) {
  const hasSelection = selectedCount > 0;
  const label = value === 'all' ? 'All' : value === 'selected' ? 'Selected' : 'Unselected';

  return (
    <div className="flex items-center gap-1">
      <MousePointer2 className="w-3 h-3 text-muted-foreground" />
      <Select
        value={value}
        onValueChange={(v) => onChange(v as SelectionFilter)}
        disabled={!hasSelection}
      >
        <SelectTrigger
          className={cn(
            'text-xs border-none shadow-none bg-transparent hover:bg-muted/50 focus:ring-0',
            compact ? 'h-6 w-20 px-1' : 'h-7 w-24 px-2',
            !hasSelection && 'opacity-50'
          )}
        >
          <SelectValue>{label}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">
            <div className="flex items-center justify-between w-full gap-2">
              <span>All Samples</span>
              <Badge variant="outline" className="h-4 px-1 text-[9px]">
                {totalSamples}
              </Badge>
            </div>
          </SelectItem>
          <SelectItem value="selected" disabled={!hasSelection}>
            <div className="flex items-center justify-between w-full gap-2">
              <span>Selected Only</span>
              <Badge variant="outline" className="h-4 px-1 text-[9px]">
                {selectedCount}
              </Badge>
            </div>
          </SelectItem>
          <SelectItem value="unselected" disabled={!hasSelection}>
            <div className="flex items-center justify-between w-full gap-2">
              <span>Unselected Only</span>
              <Badge variant="outline" className="h-4 px-1 text-[9px]">
                {totalSamples - selectedCount}
              </Badge>
            </div>
          </SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
});

// ============= Main Component =============

export const DisplayFilters = memo(function DisplayFilters({
  hasOutliers = false,
  outlierCount = 0,
  selectedCount = 0,
  totalSamples = 0,
  compact = false,
  className,
}: DisplayFiltersProps) {
  const filterContext = useFilterOptional();

  // If no filter context, don't render
  if (!filterContext) {
    return null;
  }

  const {
    outlier,
    selection,
    setOutlierFilter,
    setSelectionFilter,
    clearAllFilters,
    activeFilterCount,
    hasActiveFilters,
  } = filterContext;

  return (
    <div className={cn('flex items-center gap-2', className)}>
      {/* Filter icon with badge */}
      <div className="flex items-center gap-1">
        <Filter className="w-3 h-3 text-muted-foreground" />
        {!compact && (
          <span className="text-[10px] text-muted-foreground">Display:</span>
        )}
      </div>

      {/* Outlier filter */}
      <OutlierFilterSelect
        value={outlier}
        onChange={setOutlierFilter}
        hasOutliers={hasOutliers}
        outlierCount={outlierCount}
        compact={compact}
      />

      {/* Selection filter */}
      <SelectionFilterSelect
        value={selection}
        onChange={setSelectionFilter}
        selectedCount={selectedCount}
        totalSamples={totalSamples}
        compact={compact}
      />

      {/* Active filter badge and clear button */}
      {hasActiveFilters && (
        <div className="flex items-center gap-1 ml-1 pl-2 border-l border-border">
          <Badge
            variant="secondary"
            className="h-5 px-1.5 text-[10px] font-medium bg-primary/10 text-primary"
          >
            {activeFilterCount} filter{activeFilterCount !== 1 ? 's' : ''}
          </Badge>
          <TooltipProvider delayDuration={200}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-5 w-5 p-0"
                  onClick={clearAllFilters}
                >
                  <X className="w-3 h-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <p className="text-xs">Clear all filters</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      )}
    </div>
  );
});

export default DisplayFilters;
