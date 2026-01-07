/**
 * SelectionStatsPanel - Statistics panel for selected samples
 *
 * Features:
 * - Shows mean, std, min, max of Y values for selected samples
 * - Compares selected vs all samples
 * - Shows sample count and percentage
 * - Collapsible for minimal footprint
 *
 * Phase 2 Implementation - Selection System Enhancement
 */

import { useMemo, useState, memo } from 'react';
import {
  ChevronDown,
  ChevronUp,
  BarChart2,
  TrendingUp,
  TrendingDown,
  Minus,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { useSelection } from '@/context/SelectionContext';
import { cn } from '@/lib/utils';
import { formatYValue } from './visualizations/chartConfig';

// ============= Types =============

interface SelectionStatsPanelProps {
  /** Y values for all samples */
  y: number[];
  /** Sample IDs */
  sampleIds?: string[];
  /** Total number of samples */
  totalSamples: number;
  /** Whether to show in compact mode */
  compact?: boolean;
  /** Additional class name */
  className?: string;
}

interface Stats {
  mean: number;
  std: number;
  min: number;
  max: number;
  count: number;
  median: number;
}

// ============= Helpers =============

function computeStats(values: number[]): Stats | null {
  if (values.length === 0) return null;

  const n = values.length;
  const sorted = [...values].sort((a, b) => a - b);
  const sum = values.reduce((a, b) => a + b, 0);
  const mean = sum / n;
  const variance = values.reduce((acc, v) => acc + Math.pow(v - mean, 2), 0) / n;
  const std = Math.sqrt(variance);
  const median = n % 2 === 0
    ? (sorted[n / 2 - 1] + sorted[n / 2]) / 2
    : sorted[Math.floor(n / 2)];

  return {
    mean,
    std,
    min: sorted[0],
    max: sorted[n - 1],
    count: n,
    median,
  };
}

// ============= Sub-Components =============

interface StatComparisonProps {
  label: string;
  selectedValue: number;
  allValue: number;
  precision?: number;
  showDiff?: boolean;
}

const StatComparison = memo(function StatComparison({
  label,
  selectedValue,
  allValue,
  precision = 2,
  showDiff = true,
}: StatComparisonProps) {
  const diff = selectedValue - allValue;
  const percentDiff = allValue !== 0 ? (diff / Math.abs(allValue)) * 100 : 0;
  const isHigher = diff > 0.001;
  const isLower = diff < -0.001;

  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-muted-foreground">{label}</span>
      <div className="flex items-center gap-1.5">
        <span className="font-mono font-medium">{formatYValue(selectedValue, precision)}</span>
        {showDiff && Math.abs(percentDiff) > 0.1 && (
          <Badge
            variant="secondary"
            className={cn(
              "h-4 px-1 text-[9px] gap-0.5",
              isHigher && "bg-green-500/10 text-green-600 dark:text-green-400",
              isLower && "bg-red-500/10 text-red-600 dark:text-red-400"
            )}
          >
            {isHigher ? <TrendingUp className="w-2.5 h-2.5" /> : isLower ? <TrendingDown className="w-2.5 h-2.5" /> : <Minus className="w-2.5 h-2.5" />}
            {Math.abs(percentDiff).toFixed(1)}%
          </Badge>
        )}
      </div>
    </div>
  );
});

// ============= Main Component =============

export const SelectionStatsPanel = memo(function SelectionStatsPanel({
  y,
  sampleIds,
  totalSamples,
  compact = false,
  className,
}: SelectionStatsPanelProps) {
  const { selectedSamples, pinnedSamples } = useSelection();
  const [isOpen, setIsOpen] = useState(true);

  // Compute stats for all samples
  const allStats = useMemo(() => computeStats(y), [y]);

  // Compute stats for selected samples
  const selectedStats = useMemo(() => {
    if (selectedSamples.size === 0) return null;
    const selectedY = Array.from(selectedSamples)
      .filter(idx => y[idx] !== undefined)
      .map(idx => y[idx]);
    return computeStats(selectedY);
  }, [selectedSamples, y]);

  // Compute stats for pinned samples
  const pinnedStats = useMemo(() => {
    if (pinnedSamples.size === 0) return null;
    const pinnedY = Array.from(pinnedSamples)
      .filter(idx => y[idx] !== undefined)
      .map(idx => y[idx]);
    return computeStats(pinnedY);
  }, [pinnedSamples, y]);

  // Don't render if no selection
  if (selectedSamples.size === 0 && pinnedSamples.size === 0) {
    return null;
  }

  const selectionPercentage = ((selectedSamples.size / totalSamples) * 100).toFixed(1);

  if (compact) {
    // Compact inline display
    return (
      <div className={cn("flex items-center gap-2 text-xs", className)}>
        <Badge variant="secondary" className="h-5 px-1.5">
          {selectedSamples.size} / {totalSamples} ({selectionPercentage}%)
        </Badge>
        {selectedStats && (
          <span className="text-muted-foreground">
            μ={formatYValue(selectedStats.mean, 2)}, σ={formatYValue(selectedStats.std, 2)}
          </span>
        )}
      </div>
    );
  }

  return (
    <Collapsible
      open={isOpen}
      onOpenChange={setIsOpen}
      className={cn(
        "bg-card border border-border rounded-lg overflow-hidden",
        className
      )}
    >
      <CollapsibleTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="w-full h-8 px-3 justify-between rounded-none hover:bg-muted"
        >
          <div className="flex items-center gap-2">
            <BarChart2 className="w-3.5 h-3.5 text-primary" />
            <span className="text-xs font-medium">Selection Statistics</span>
            <Badge variant="secondary" className="h-4 px-1 text-[10px]">
              {selectedSamples.size}
            </Badge>
          </div>
          {isOpen ? (
            <ChevronUp className="w-3.5 h-3.5" />
          ) : (
            <ChevronDown className="w-3.5 h-3.5" />
          )}
        </Button>
      </CollapsibleTrigger>

      <CollapsibleContent>
        <div className="p-3 space-y-3 border-t">
          {/* Selection count */}
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Samples</span>
            <div className="flex items-center gap-1.5">
              <span className="font-medium">
                {selectedSamples.size} of {totalSamples}
              </span>
              <Badge variant="outline" className="h-4 px-1 text-[9px]">
                {selectionPercentage}%
              </Badge>
            </div>
          </div>

          {/* Selected samples stats */}
          {selectedStats && allStats && (
            <>
              <div className="border-t pt-2">
                <div className="text-[10px] text-muted-foreground mb-1.5 uppercase tracking-wide">
                  Y Statistics (vs All)
                </div>
                <div className="space-y-1">
                  <StatComparison
                    label="Mean"
                    selectedValue={selectedStats.mean}
                    allValue={allStats.mean}
                  />
                  <StatComparison
                    label="Median"
                    selectedValue={selectedStats.median}
                    allValue={allStats.median}
                  />
                  <StatComparison
                    label="Std Dev"
                    selectedValue={selectedStats.std}
                    allValue={allStats.std}
                  />
                  <StatComparison
                    label="Min"
                    selectedValue={selectedStats.min}
                    allValue={allStats.min}
                    showDiff={false}
                  />
                  <StatComparison
                    label="Max"
                    selectedValue={selectedStats.max}
                    allValue={allStats.max}
                    showDiff={false}
                  />
                </div>
              </div>

              {/* Range display */}
              <div className="bg-muted/50 rounded p-2">
                <div className="text-[10px] text-muted-foreground mb-1">Y Range</div>
                <div className="flex items-center gap-2">
                  <div className="h-1.5 flex-1 bg-muted rounded-full overflow-hidden relative">
                    {/* Full range */}
                    <div className="absolute inset-0 bg-muted-foreground/20" />
                    {/* Selected range */}
                    <div
                      className="absolute h-full bg-primary rounded-full"
                      style={{
                        left: `${((selectedStats.min - allStats.min) / (allStats.max - allStats.min)) * 100}%`,
                        right: `${((allStats.max - selectedStats.max) / (allStats.max - allStats.min)) * 100}%`,
                      }}
                    />
                  </div>
                </div>
                <div className="flex justify-between text-[9px] text-muted-foreground mt-1">
                  <span>{formatYValue(allStats.min, 1)}</span>
                  <span>{formatYValue(allStats.max, 1)}</span>
                </div>
              </div>
            </>
          )}

          {/* Pinned samples stats */}
          {pinnedStats && pinnedSamples.size > 0 && (
            <div className="border-t pt-2">
              <div className="text-[10px] text-muted-foreground mb-1.5 uppercase tracking-wide flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-amber-500" />
                Pinned ({pinnedSamples.size})
              </div>
              <div className="text-xs">
                <span className="text-muted-foreground">Mean: </span>
                <span className="font-mono">{formatYValue(pinnedStats.mean, 2)}</span>
                <span className="text-muted-foreground ml-2">Std: </span>
                <span className="font-mono">{formatYValue(pinnedStats.std, 2)}</span>
              </div>
            </div>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
});

export default SelectionStatsPanel;
