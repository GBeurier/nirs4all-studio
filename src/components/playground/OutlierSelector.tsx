/**
 * OutlierSelector - Interactive outlier detection and selection
 *
 * Phase 5 Implementation: Advanced Filtering & Metrics
 *
 * Features:
 * - Multiple detection methods (T², Q-residual, LOF, Distance)
 * - Threshold slider with distribution preview
 * - "Top K" mode to select K most extreme samples
 * - "Within threshold" mode to select typical samples
 * - Per-group outliers option (future)
 * - Integration with SelectionContext
 */

import { useState, useCallback, useMemo, useEffect } from 'react';
import {
  AlertTriangle,
  Target,
  ChevronDown,
  Loader2,
  Check,
  Info,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { useSelection } from '@/context/SelectionContext';
import type { MetricsResult, OutlierResult } from '@/types/playground';

// ============= Types =============

export type OutlierMethod = 'hotelling_t2' | 'q_residual' | 'lof' | 'distance';

export interface OutlierSelectorProps {
  /** Computed metrics from backend (for values preview) */
  metrics?: MetricsResult | null;
  /** Callback to detect outliers via API */
  onDetectOutliers: (method: OutlierMethod, threshold: number) => Promise<OutlierResult>;
  /** Whether to use SelectionContext for selection */
  useSelectionContext?: boolean;
  /** Callback when outliers are selected (if not using context) */
  onSelectOutliers?: (indices: number[]) => void;
  /** Callback to add filter to pipeline */
  onAddOutlierFilter?: (method: OutlierMethod, threshold: number) => void;
  /** Total sample count */
  totalSamples: number;
  /** Whether detection is in progress */
  isLoading?: boolean;
  /** Compact mode */
  compact?: boolean;
}

// ============= Constants =============

const METHODS: { value: OutlierMethod; label: string; description: string; requiresPCA: boolean }[] = [
  {
    value: 'hotelling_t2',
    label: "Hotelling's T²",
    description: 'Distance in PCA score space, weighted by variance',
    requiresPCA: true,
  },
  {
    value: 'q_residual',
    label: 'Q-Residual (SPE)',
    description: 'PCA reconstruction error',
    requiresPCA: true,
  },
  {
    value: 'lof',
    label: 'Local Outlier Factor',
    description: 'Density-based outlier detection',
    requiresPCA: false,
  },
  {
    value: 'distance',
    label: 'Distance to Centroid',
    description: 'Euclidean distance from data center',
    requiresPCA: false,
  },
];

// ============= Sub-Components =============

interface DistributionPreviewProps {
  values: number[] | undefined;
  threshold: number;
  invert: boolean;
  height?: number;
}

function DistributionPreview({ values, threshold, invert, height = 48 }: DistributionPreviewProps) {
  // All hooks before early return (Rules of Hooks).
  const stats = useMemo(() => {
    if (!values || values.length === 0) return { min: 0, max: 1, p95: 1 };
    const sorted = [...values].sort((a, b) => a - b);
    return {
      min: sorted[0],
      max: sorted[sorted.length - 1],
      p95: sorted[Math.floor(sorted.length * 0.95)],
    };
  }, [values]);

  // Compute histogram bins
  const bins = useMemo(() => {
    if (!values || values.length === 0) return [];
    const nBins = 30;
    const binWidth = (stats.max - stats.min) / nBins;
    const counts = new Array(nBins).fill(0);

    for (const v of values) {
      if (isNaN(v)) continue;
      const binIdx = Math.min(Math.floor((v - stats.min) / binWidth), nBins - 1);
      if (binIdx >= 0) counts[binIdx]++;
    }

    const maxCount = Math.max(...counts, 1);
    return counts.map((c, i) => ({
      x: stats.min + i * binWidth,
      width: binWidth,
      height: c / maxCount,
      count: c,
    }));
  }, [values, stats]);

  // Threshold position as percentage
  const thresholdPercent = useMemo(() => {
    if (stats.max === stats.min) return 95;
    // Convert from quantile (0-1) to value position
    const thresholdValue = stats.p95; // Approximation
    return Math.min(100, Math.max(0, ((thresholdValue - stats.min) / (stats.max - stats.min)) * 100));
  }, [stats, threshold]);

  if (!values || values.length === 0) {
    return (
      <div className="flex items-center justify-center text-xs text-muted-foreground" style={{ height }}>
        No data available
      </div>
    );
  }

  return (
    <div className="relative w-full" style={{ height }}>
      <svg width="100%" height="100%" className="overflow-visible">
        {bins.map((bin, i) => {
          const binEnd = bin.x + bin.width;
          // Approximate: threshold at position means bins beyond are outliers
          const isOutlier = (bin.x / stats.max) > threshold;
          const isFiltered = invert ? !isOutlier : isOutlier;

          return (
            <rect
              key={i}
              x={`${(i / bins.length) * 100}%`}
              y={`${(1 - bin.height) * 100}%`}
              width={`${(1 / bins.length) * 100}%`}
              height={`${bin.height * 100}%`}
              className={cn(
                'transition-colors',
                isFiltered ? 'fill-red-500/60' : 'fill-primary/40'
              )}
            />
          );
        })}

        {/* Threshold line */}
        <line
          x1={`${threshold * 100}%`}
          y1="0%"
          x2={`${threshold * 100}%`}
          y2="100%"
          className="stroke-primary stroke-2"
          strokeDasharray="4 2"
        />
      </svg>

      {/* Labels */}
      <div className="absolute bottom-0 left-0 right-0 flex justify-between text-[8px] text-muted-foreground font-mono mt-1">
        <span>Typical</span>
        <span className="text-red-500">Outliers</span>
      </div>
    </div>
  );
}

// ============= Main Component =============

export function OutlierSelector({
  metrics,
  onDetectOutliers,
  useSelectionContext = true,
  onSelectOutliers,
  onAddOutlierFilter,
  totalSamples,
  isLoading = false,
  compact = false,
}: OutlierSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [method, setMethod] = useState<OutlierMethod>('hotelling_t2');
  const [threshold, setThreshold] = useState(0.95);
  const [selectInliers, setSelectInliers] = useState(false);
  const [topKMode, setTopKMode] = useState(false);
  const [topK, setTopK] = useState(10);
  const [isDetecting, setIsDetecting] = useState(false);
  const [lastResult, setLastResult] = useState<OutlierResult | null>(null);

  // Selection context
  const { select } = useSelection();

  // Get preview values for the selected method
  const previewValues = useMemo(() => {
    if (!metrics?.values) return undefined;

    const metricMap: Record<OutlierMethod, string> = {
      hotelling_t2: 'hotelling_t2',
      q_residual: 'q_residual',
      lof: 'lof_score',
      distance: 'distance_to_centroid',
    };

    return metrics.values[metricMap[method]];
  }, [metrics, method]);

  // Handle detection
  const handleDetect = useCallback(async () => {
    setIsDetecting(true);
    try {
      const result = await onDetectOutliers(method, threshold);
      setLastResult(result);

      if (result.success) {
        // Select samples based on mode
        let indicesToSelect: number[];

        if (topKMode) {
          // Get top K outliers
          if (result.values && result.outlier_indices) {
            // Sort outlier indices by their metric value (descending)
            const outlierValues = result.outlier_indices.map(i => ({
              index: i,
              value: result.values![i],
            }));
            outlierValues.sort((a, b) => b.value - a.value);
            indicesToSelect = outlierValues.slice(0, topK).map(x => x.index);
          } else {
            indicesToSelect = result.outlier_indices.slice(0, topK);
          }
        } else if (selectInliers) {
          // Select inliers (typical samples)
          indicesToSelect = result.inlier_mask
            .map((isInlier, i) => isInlier ? i : -1)
            .filter(i => i >= 0);
        } else {
          // Select outliers
          indicesToSelect = result.outlier_indices;
        }

        // Apply selection
        if (useSelectionContext) {
          select(indicesToSelect);
        } else if (onSelectOutliers) {
          onSelectOutliers(indicesToSelect);
        }
      }
    } catch (error) {
      console.error('Outlier detection failed:', error);
    } finally {
      setIsDetecting(false);
    }
  }, [method, threshold, topKMode, topK, selectInliers, onDetectOutliers, useSelectionContext, select, onSelectOutliers]);

  // Handle adding filter to pipeline
  const handleAddFilter = useCallback(() => {
    if (onAddOutlierFilter) {
      onAddOutlierFilter(method, threshold);
      setIsOpen(false);
    }
  }, [method, threshold, onAddOutlierFilter]);

  const selectedMethod = METHODS.find(m => m.value === method);

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn(
            'text-xs gap-1.5',
            compact ? 'h-7 px-2' : 'h-8 px-3',
            lastResult?.n_outliers && lastResult.n_outliers > 0 && 'border-amber-500/50 bg-amber-500/5'
          )}
        >
          <AlertTriangle className="w-3 h-3" />
          Outliers
          {lastResult?.n_outliers !== undefined && lastResult.n_outliers > 0 && (
            <Badge variant="secondary" className="h-4 px-1 text-[9px]">
              {lastResult.n_outliers}
            </Badge>
          )}
          <ChevronDown className="w-3 h-3 opacity-50" />
        </Button>
      </PopoverTrigger>

      <PopoverContent align="end" className="w-80 p-0">
        {/* Header */}
        <div className="flex items-center justify-between px-3 py-2 border-b">
          <h4 className="text-sm font-semibold flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-500" />
            Outlier Detection
          </h4>
        </div>

        <div className="p-3 space-y-4">
          {/* Method selector */}
          <div>
            <Label className="text-xs text-muted-foreground mb-1.5 block">Detection Method</Label>
            <Select value={method} onValueChange={(v) => setMethod(v as OutlierMethod)}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {METHODS.map(m => (
                  <SelectItem key={m.value} value={m.value}>
                    <div className="flex flex-col">
                      <span>{m.label}</span>
                      <span className="text-[10px] text-muted-foreground">{m.description}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {selectedMethod?.requiresPCA && (
              <p className="text-[10px] text-muted-foreground mt-1 flex items-center gap-1">
                <Info className="w-3 h-3" />
                Uses PCA projection for detection
              </p>
            )}
          </div>

          {/* Distribution preview */}
          <div>
            <Label className="text-xs text-muted-foreground mb-1.5 block">Value Distribution</Label>
            <div className="bg-muted/30 rounded p-2">
              <DistributionPreview
                values={previewValues}
                threshold={threshold}
                invert={selectInliers}
              />
            </div>
          </div>

          {/* Threshold slider */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <Label className="text-xs text-muted-foreground">
                Confidence Threshold
              </Label>
              <span className="text-xs font-mono text-primary">
                {(threshold * 100).toFixed(0)}%
              </span>
            </div>
            <Slider
              value={[threshold]}
              min={0.5}
              max={0.99}
              step={0.01}
              onValueChange={([v]) => setThreshold(v)}
              className="w-full"
            />
            <div className="flex justify-between text-[9px] text-muted-foreground mt-1">
              <span>More outliers</span>
              <span>Fewer outliers</span>
            </div>
          </div>

          {/* Mode toggles */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs">Select inliers (typical samples)</Label>
              <Switch
                checked={selectInliers}
                onCheckedChange={setSelectInliers}
                className="scale-75"
              />
            </div>

            <div className="flex items-center justify-between">
              <Label className="text-xs">Top K most extreme</Label>
              <div className="flex items-center gap-2">
                <Switch
                  checked={topKMode}
                  onCheckedChange={setTopKMode}
                  className="scale-75"
                />
                {topKMode && (
                  <Input
                    type="number"
                    value={topK}
                    onChange={(e) => setTopK(Math.max(1, parseInt(e.target.value) || 1))}
                    className="h-6 w-14 text-xs"
                    min={1}
                    max={totalSamples}
                  />
                )}
              </div>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex gap-2">
            <Button
              variant="default"
              size="sm"
              className="flex-1 h-8 text-xs"
              onClick={handleDetect}
              disabled={isDetecting || isLoading}
            >
              {isDetecting ? (
                <>
                  <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                  Detecting...
                </>
              ) : (
                <>
                  <Target className="w-3 h-3 mr-1" />
                  Select {selectInliers ? 'Inliers' : 'Outliers'}
                </>
              )}
            </Button>

            {onAddOutlierFilter && (
              <TooltipProvider delayDuration={200}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 text-xs px-2"
                      onClick={handleAddFilter}
                    >
                      + Filter
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    <p className="text-xs">Add as filter operator to pipeline</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
          </div>

          {/* Results */}
          {lastResult && lastResult.success && (
            <div className="bg-muted/30 rounded p-2 text-xs">
              <div className="flex items-center gap-2">
                <Check className="w-3 h-3 text-green-500" />
                <span>
                  Found <strong>{lastResult.n_outliers}</strong> outliers,{' '}
                  <strong>{lastResult.n_inliers}</strong> inliers
                </span>
              </div>
              <div className="text-[10px] text-muted-foreground mt-1">
                Threshold: {lastResult.threshold?.toPrecision(4)}
              </div>
            </div>
          )}

          {lastResult && lastResult.error && (
            <div className="bg-red-500/10 rounded p-2 text-xs text-red-500 flex items-center gap-2">
              <AlertTriangle className="w-3 h-3" />
              {lastResult.error}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export default OutlierSelector;
