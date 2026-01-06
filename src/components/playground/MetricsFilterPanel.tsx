/**
 * MetricsFilterPanel - Filter samples by spectral metric values
 *
 * Phase 5 Implementation: Advanced Filtering & Metrics
 *
 * Features:
 * - Range slider per metric with histogram preview
 * - Combine multiple metric filters
 * - Preset filters (e.g., "Typical Samples", "Outliers Only")
 * - Real-time filtering feedback
 * - Grouped by metric category
 */

import { useState, useCallback, useMemo, useEffect } from 'react';
import {
  BarChart3,
  ChevronDown,
  ChevronRight,
  X,
  RotateCcw,
  AlertTriangle,
  CheckCircle2,
  Beaker,
  Activity,
  Zap,
  AudioWaveform,
  Shield,
  FlaskConical,
  type LucideIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
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
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import type { MetricsResult, MetricFilter, MetricStats } from '@/types/playground';

// ============= Types =============

export interface MetricsFilterPanelProps {
  /** Computed metrics from backend */
  metrics?: MetricsResult | null;
  /** Current active filters */
  activeFilters: MetricFilter[];
  /** Callback when filters change */
  onFiltersChange: (filters: MetricFilter[]) => void;
  /** Total samples before filtering */
  totalSamples: number;
  /** Callback to get filtered sample indices */
  onGetFilteredIndices?: () => number[];
  /** Whether metrics are being loaded */
  isLoading?: boolean;
  /** Compact mode for toolbar */
  compact?: boolean;
}

// ============= Constants =============

const METRIC_CATEGORIES: Record<string, { label: string; icon: LucideIcon; color: string }> = {
  amplitude: { label: 'Amplitude', icon: Activity, color: 'text-blue-500' },
  energy: { label: 'Energy', icon: Zap, color: 'text-yellow-500' },
  shape: { label: 'Shape', icon: AudioWaveform, color: 'text-green-500' },
  noise: { label: 'Noise', icon: BarChart3, color: 'text-orange-500' },
  quality: { label: 'Quality', icon: Shield, color: 'text-red-500' },
  chemometric: { label: 'Chemometric', icon: FlaskConical, color: 'text-purple-500' },
};

const METRIC_DISPLAY_NAMES: Record<string, string> = {
  global_min: 'Global Min',
  global_max: 'Global Max',
  dynamic_range: 'Dynamic Range',
  mean_intensity: 'Mean Intensity',
  l2_norm: 'L2 Norm',
  rms_energy: 'RMS Energy',
  auc: 'AUC',
  abs_auc: 'Absolute AUC',
  baseline_slope: 'Baseline Slope',
  baseline_offset: 'Baseline Offset',
  peak_count: 'Peak Count',
  peak_prominence_max: 'Max Peak Prominence',
  hf_variance: 'HF Variance',
  snr_estimate: 'SNR Estimate',
  smoothness: 'Smoothness',
  nan_count: 'NaN Count',
  inf_count: 'Inf Count',
  saturation_count: 'Saturation Count',
  zero_count: 'Zero Count',
  hotelling_t2: "Hotelling's T²",
  q_residual: 'Q-Residual',
  leverage: 'Leverage',
  distance_to_centroid: 'Distance to Center',
  lof_score: 'LOF Score',
};

const METRIC_CATEGORIES_MAP: Record<string, string> = {
  global_min: 'amplitude',
  global_max: 'amplitude',
  dynamic_range: 'amplitude',
  mean_intensity: 'amplitude',
  l2_norm: 'energy',
  rms_energy: 'energy',
  auc: 'energy',
  abs_auc: 'energy',
  baseline_slope: 'shape',
  baseline_offset: 'shape',
  peak_count: 'shape',
  peak_prominence_max: 'shape',
  hf_variance: 'noise',
  snr_estimate: 'noise',
  smoothness: 'noise',
  nan_count: 'quality',
  inf_count: 'quality',
  saturation_count: 'quality',
  zero_count: 'quality',
  hotelling_t2: 'chemometric',
  q_residual: 'chemometric',
  leverage: 'chemometric',
  distance_to_centroid: 'chemometric',
  lof_score: 'chemometric',
};

// Preset filter configurations
const PRESET_FILTERS: { id: string; name: string; description: string; getFilters: (metrics: MetricsResult) => MetricFilter[] }[] = [
  {
    id: 'typical',
    name: 'Typical Samples',
    description: 'Keep samples within p5-p95 range for key metrics',
    getFilters: (metrics) => {
      const filters: MetricFilter[] = [];
      const keyMetrics = ['l2_norm', 'snr_estimate', 'hf_variance'];

      for (const metric of keyMetrics) {
        const stats = metrics.statistics[metric];
        if (stats) {
          filters.push({
            metric,
            min: stats.p5,
            max: stats.p95,
            invert: false,
          });
        }
      }
      return filters;
    },
  },
  {
    id: 'outliers',
    name: 'Outliers Only',
    description: 'Show samples outside p5-p95 range',
    getFilters: (metrics) => {
      const stats = metrics.statistics['distance_to_centroid'] || metrics.statistics['l2_norm'];
      if (!stats) return [];
      return [{
        metric: metrics.statistics['distance_to_centroid'] ? 'distance_to_centroid' : 'l2_norm',
        min: stats.p95,
        max: undefined,
        invert: false,
      }];
    },
  },
  {
    id: 'high_quality',
    name: 'High Quality',
    description: 'High SNR, low noise, no missing values',
    getFilters: (metrics) => {
      const filters: MetricFilter[] = [];

      const snrStats = metrics.statistics['snr_estimate'];
      if (snrStats) {
        filters.push({
          metric: 'snr_estimate',
          min: snrStats.p50,
          max: undefined,
          invert: false,
        });
      }

      const nanStats = metrics.statistics['nan_count'];
      if (nanStats) {
        filters.push({
          metric: 'nan_count',
          min: undefined,
          max: 0,
          invert: false,
        });
      }

      return filters;
    },
  },
];

// ============= Sub-Components =============

interface MiniHistogramProps {
  values: number[];
  stats: MetricStats;
  filter?: MetricFilter;
  height?: number;
}

function MiniHistogram({ values, stats, filter, height = 32 }: MiniHistogramProps) {
  // Compute histogram bins
  const bins = useMemo(() => {
    const nBins = 20;
    const binWidth = (stats.max - stats.min) / nBins;
    const counts = new Array(nBins).fill(0);

    for (const v of values) {
      if (isNaN(v) || v < stats.min || v > stats.max) continue;
      const binIdx = Math.min(Math.floor((v - stats.min) / binWidth), nBins - 1);
      counts[binIdx]++;
    }

    const maxCount = Math.max(...counts, 1);
    return counts.map((c, i) => ({
      x: stats.min + i * binWidth,
      width: binWidth,
      height: c / maxCount,
      count: c,
    }));
  }, [values, stats]);

  // Determine which bins are filtered
  const isFiltered = useCallback((binStart: number, binEnd: number) => {
    if (!filter) return false;

    const inRange =
      (filter.min === undefined || binEnd >= filter.min) &&
      (filter.max === undefined || binStart <= filter.max);

    return filter.invert ? inRange : !inRange;
  }, [filter]);

  return (
    <div className="relative w-full" style={{ height }}>
      <svg width="100%" height="100%" className="overflow-visible">
        {bins.map((bin, i) => {
          const filtered = isFiltered(bin.x, bin.x + bin.width);
          return (
            <rect
              key={i}
              x={`${(i / bins.length) * 100}%`}
              y={`${(1 - bin.height) * 100}%`}
              width={`${(1 / bins.length) * 100}%`}
              height={`${bin.height * 100}%`}
              className={cn(
                'transition-colors',
                filtered ? 'fill-muted-foreground/20' : 'fill-primary/60'
              )}
            />
          );
        })}

        {/* Filter range indicators */}
        {filter?.min !== undefined && (
          <line
            x1={`${((filter.min - stats.min) / (stats.max - stats.min)) * 100}%`}
            y1="0%"
            x2={`${((filter.min - stats.min) / (stats.max - stats.min)) * 100}%`}
            y2="100%"
            className="stroke-primary stroke-2"
          />
        )}
        {filter?.max !== undefined && (
          <line
            x1={`${((filter.max - stats.min) / (stats.max - stats.min)) * 100}%`}
            y1="0%"
            x2={`${((filter.max - stats.min) / (stats.max - stats.min)) * 100}%`}
            y2="100%"
            className="stroke-primary stroke-2"
          />
        )}
      </svg>
    </div>
  );
}

interface MetricFilterRowProps {
  metricName: string;
  values: number[];
  stats: MetricStats;
  filter?: MetricFilter;
  onChange: (filter: MetricFilter | undefined) => void;
}

function MetricFilterRow({ metricName, values, stats, filter, onChange }: MetricFilterRowProps) {
  const displayName = METRIC_DISPLAY_NAMES[metricName] || metricName;
  const hasFilter = filter !== undefined;

  // Local state for slider values
  const [sliderValue, setSliderValue] = useState<[number, number]>([
    filter?.min ?? stats.min,
    filter?.max ?? stats.max,
  ]);

  // Update local state when filter changes
  useEffect(() => {
    setSliderValue([
      filter?.min ?? stats.min,
      filter?.max ?? stats.max,
    ]);
  }, [filter, stats]);

  const handleSliderChange = useCallback((value: number[]) => {
    const [min, max] = value as [number, number];
    setSliderValue([min, max]);
  }, []);

  const handleSliderCommit = useCallback((value: number[]) => {
    const [min, max] = value as [number, number];

    // Check if values are at extremes (no actual filter)
    const isMinExtreme = Math.abs(min - stats.min) < (stats.max - stats.min) * 0.01;
    const isMaxExtreme = Math.abs(max - stats.max) < (stats.max - stats.min) * 0.01;

    if (isMinExtreme && isMaxExtreme) {
      onChange(undefined);
    } else {
      onChange({
        metric: metricName,
        min: isMinExtreme ? undefined : min,
        max: isMaxExtreme ? undefined : max,
        invert: filter?.invert ?? false,
      });
    }
  }, [metricName, stats, filter, onChange]);

  const handleRemove = useCallback(() => {
    onChange(undefined);
  }, [onChange]);

  const handleInvertToggle = useCallback(() => {
    if (filter) {
      onChange({ ...filter, invert: !filter.invert });
    }
  }, [filter, onChange]);

  // Count samples that would pass filter
  const passCount = useMemo(() => {
    if (!filter) return values.length;

    let count = 0;
    for (const v of values) {
      const inRange =
        (filter.min === undefined || v >= filter.min) &&
        (filter.max === undefined || v <= filter.max);

      if (filter.invert ? !inRange : inRange) count++;
    }
    return count;
  }, [values, filter]);

  return (
    <div className="space-y-1.5 p-2 rounded-md hover:bg-muted/50 transition-colors">
      <div className="flex items-center justify-between">
        <Label className="text-xs font-medium">{displayName}</Label>
        <div className="flex items-center gap-1">
          {hasFilter && (
            <>
              <Badge variant="outline" className="text-[9px] h-4 px-1">
                {passCount}/{values.length}
              </Badge>
              <TooltipProvider delayDuration={200}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-5 w-5 p-0"
                      onClick={handleInvertToggle}
                    >
                      {filter?.invert ? (
                        <AlertTriangle className="w-3 h-3 text-amber-500" />
                      ) : (
                        <CheckCircle2 className="w-3 h-3 text-green-500" />
                      )}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="left">
                    <p className="text-xs">
                      {filter?.invert ? 'Selecting outliers (outside range)' : 'Selecting typical (inside range)'}
                    </p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
              <Button
                variant="ghost"
                size="sm"
                className="h-5 w-5 p-0"
                onClick={handleRemove}
              >
                <X className="w-3 h-3" />
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Mini histogram */}
      <MiniHistogram values={values} stats={stats} filter={filter} height={24} />

      {/* Range slider */}
      <Slider
        value={sliderValue}
        min={stats.min}
        max={stats.max}
        step={(stats.max - stats.min) / 100}
        onValueChange={handleSliderChange}
        onValueCommit={handleSliderCommit}
        className="w-full"
      />

      {/* Range labels */}
      <div className="flex justify-between text-[9px] text-muted-foreground font-mono">
        <span>{stats.min.toPrecision(3)}</span>
        <span className="text-primary">
          {sliderValue[0].toPrecision(3)} - {sliderValue[1].toPrecision(3)}
        </span>
        <span>{stats.max.toPrecision(3)}</span>
      </div>
    </div>
  );
}

interface MetricCategoryProps {
  category: string;
  metrics: string[];
  metricsData: MetricsResult;
  activeFilters: MetricFilter[];
  onFilterChange: (metric: string, filter: MetricFilter | undefined) => void;
  defaultOpen?: boolean;
}

function MetricCategory({
  category,
  metrics,
  metricsData,
  activeFilters,
  onFilterChange,
  defaultOpen = false,
}: MetricCategoryProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const defaultCategoryInfo = { label: category, icon: BarChart3 as LucideIcon, color: 'text-muted-foreground' };
  const categoryInfo = METRIC_CATEGORIES[category] ?? defaultCategoryInfo;
  const Icon = categoryInfo.icon;

  // Count active filters in this category
  const activeCount = activeFilters.filter(f => METRIC_CATEGORIES_MAP[f.metric] === category).length;

  return (
    <div className="border-b last:border-b-0">
      <button
        className="flex items-center justify-between w-full p-2 hover:bg-muted/50 transition-colors"
        onClick={() => setIsOpen(!isOpen)}
      >
        <div className="flex items-center gap-2">
          <Icon className={cn('w-4 h-4', categoryInfo.color)} />
          <span className="text-sm font-medium">{categoryInfo.label}</span>
          {activeCount > 0 && (
            <Badge variant="secondary" className="h-4 px-1 text-[9px]">
              {activeCount}
            </Badge>
          )}
        </div>
        {isOpen ? (
          <ChevronDown className="w-4 h-4 text-muted-foreground" />
        ) : (
          <ChevronRight className="w-4 h-4 text-muted-foreground" />
        )}
      </button>

      {isOpen && (
        <div className="px-2 pb-2 space-y-1">
          {metrics.map(metric => {
            const values = metricsData.values[metric];
            const stats = metricsData.statistics[metric];
            const filter = activeFilters.find(f => f.metric === metric);

            if (!values || !stats) return null;

            return (
              <MetricFilterRow
                key={metric}
                metricName={metric}
                values={values}
                stats={stats}
                filter={filter}
                onChange={(f) => onFilterChange(metric, f)}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

// ============= Main Component =============

export function MetricsFilterPanel({
  metrics,
  activeFilters,
  onFiltersChange,
  totalSamples,
  isLoading = false,
  compact = false,
}: MetricsFilterPanelProps) {
  const [isOpen, setIsOpen] = useState(false);

  // Group metrics by category
  const metricsByCategory = useMemo(() => {
    if (!metrics?.computed_metrics) return {};

    const groups: Record<string, string[]> = {};
    for (const metric of metrics.computed_metrics) {
      const category = METRIC_CATEGORIES_MAP[metric] || 'other';
      if (!groups[category]) groups[category] = [];
      groups[category].push(metric);
    }
    return groups;
  }, [metrics]);

  // Count filtered samples
  const filteredSampleCount = useMemo(() => {
    if (!metrics?.values || activeFilters.length === 0) return totalSamples;

    // Get the first metric's values to determine sample count
    const sampleCount = Object.values(metrics.values)[0]?.length ?? totalSamples;

    // Apply all filters
    let passCount = 0;
    for (let i = 0; i < sampleCount; i++) {
      let passes = true;

      for (const filter of activeFilters) {
        const values = metrics.values[filter.metric];
        if (!values) continue;

        const value = values[i];
        const inRange =
          (filter.min === undefined || value >= filter.min) &&
          (filter.max === undefined || value <= filter.max);

        if (filter.invert ? inRange : !inRange) {
          passes = false;
          break;
        }
      }

      if (passes) passCount++;
    }

    return passCount;
  }, [metrics, activeFilters, totalSamples]);

  // Handle filter change for a single metric
  const handleFilterChange = useCallback((metric: string, filter: MetricFilter | undefined) => {
    const newFilters = activeFilters.filter(f => f.metric !== metric);
    if (filter) {
      newFilters.push(filter);
    }
    onFiltersChange(newFilters);
  }, [activeFilters, onFiltersChange]);

  // Handle preset application
  const handleApplyPreset = useCallback((presetId: string) => {
    if (!metrics) return;

    const preset = PRESET_FILTERS.find(p => p.id === presetId);
    if (preset) {
      const newFilters = preset.getFilters(metrics);
      onFiltersChange(newFilters);
    }
  }, [metrics, onFiltersChange]);

  // Clear all filters
  const handleClearAll = useCallback(() => {
    onFiltersChange([]);
  }, [onFiltersChange]);

  const hasActiveFilters = activeFilters.length > 0;

  // Disabled state when no metrics
  if (!metrics || !metrics.computed_metrics || metrics.computed_metrics.length === 0) {
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

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
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
              {activeFilters.length}
            </Badge>
          )}
          <ChevronDown className="w-3 h-3 opacity-50" />
        </Button>
      </PopoverTrigger>

      <PopoverContent align="end" className="w-80 p-0 max-h-[70vh] flex flex-col">
        {/* Header */}
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
              onClick={handleClearAll}
            >
              <RotateCcw className="w-3 h-3 mr-1" />
              Clear
            </Button>
          )}
        </div>

        {/* Presets */}
        <div className="px-3 py-2 border-b shrink-0">
          <Label className="text-[10px] text-muted-foreground mb-1.5 block">Quick Presets</Label>
          <div className="flex flex-wrap gap-1">
            {PRESET_FILTERS.map(preset => (
              <TooltipProvider key={preset.id} delayDuration={200}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-6 text-[10px] px-2"
                      onClick={() => handleApplyPreset(preset.id)}
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

        {/* Metric categories */}
        <div className="flex-1 overflow-y-auto">
          {Object.entries(metricsByCategory).map(([category, categoryMetrics]) => (
            <MetricCategory
              key={category}
              category={category}
              metrics={categoryMetrics}
              metricsData={metrics}
              activeFilters={activeFilters}
              onFilterChange={handleFilterChange}
              defaultOpen={category === 'amplitude' || category === 'noise'}
            />
          ))}
        </div>

        {/* Footer with sample count */}
        {hasActiveFilters && (
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
        )}
      </PopoverContent>
    </Popover>
  );
}

export default MetricsFilterPanel;
