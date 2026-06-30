import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  AudioWaveform,
  BarChart3,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  FlaskConical,
  Shield,
  X,
  Zap,
  type LucideIcon,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  countActiveMetricFiltersByCategory,
  countMetricFilterPasses,
  getMetricDisplayName,
} from '@/lib/playground/metricFilterData';
import { cn } from '@/lib/utils';
import type { MetricFilter, MetricsResult, MetricStats } from '@/types/playground';

const METRIC_CATEGORIES: Record<string, { label: string; icon: LucideIcon; color: string }> = {
  amplitude: { label: 'Amplitude', icon: Activity, color: 'text-blue-500' },
  energy: { label: 'Energy', icon: Zap, color: 'text-yellow-500' },
  shape: { label: 'Shape', icon: AudioWaveform, color: 'text-green-500' },
  noise: { label: 'Noise', icon: BarChart3, color: 'text-orange-500' },
  quality: { label: 'Quality', icon: Shield, color: 'text-red-500' },
  chemometric: { label: 'Chemometric', icon: FlaskConical, color: 'text-purple-500' },
};

interface MiniHistogramProps {
  values: number[];
  stats: MetricStats;
  filter?: MetricFilter;
  height?: number;
}

function MiniHistogram({ values, stats, filter, height = 32 }: MiniHistogramProps) {
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
  const displayName = getMetricDisplayName(metricName);
  const hasFilter = filter !== undefined;

  const [sliderValue, setSliderValue] = useState<[number, number]>([
    filter?.min ?? stats.min,
    filter?.max ?? stats.max,
  ]);

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

  const passCount = useMemo(() => countMetricFilterPasses(values, filter), [values, filter]);

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

      <MiniHistogram values={values} stats={stats} filter={filter} height={24} />

      <Slider
        value={sliderValue}
        min={stats.min}
        max={stats.max}
        step={(stats.max - stats.min) / 100}
        onValueChange={handleSliderChange}
        onValueCommit={handleSliderCommit}
        className="w-full"
      />

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
  const activeCount = countActiveMetricFiltersByCategory(activeFilters, category);

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

interface MetricCategoryListProps {
  activeFilters: MetricFilter[];
  metricsByCategory: Record<string, string[]>;
  metricsData: MetricsResult;
  onFilterChange: (metric: string, filter: MetricFilter | undefined) => void;
}

export function MetricCategoryList({
  activeFilters,
  metricsByCategory,
  metricsData,
  onFilterChange,
}: MetricCategoryListProps) {
  return (
    <div className="flex-1 overflow-y-auto">
      {Object.entries(metricsByCategory).map(([category, categoryMetrics]) => (
        <MetricCategory
          key={category}
          category={category}
          metrics={categoryMetrics}
          metricsData={metricsData}
          activeFilters={activeFilters}
          onFilterChange={onFilterChange}
          defaultOpen={category === 'amplitude' || category === 'noise'}
        />
      ))}
    </div>
  );
}
