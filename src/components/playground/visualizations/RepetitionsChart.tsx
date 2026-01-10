/**
 * RepetitionsChart - Visualize intra-sample variability (Phase 7)
 *
 * Displays the variability between multiple measurements (repetitions) of the
 * same biological sample. Helps identify:
 * - Samples with high measurement variability
 * - Outlier repetitions
 * - Batch effects across repetitions
 *
 * Features:
 * - Strip plot: X = bio sample, Y = distance from reference
 * - Dynamic distance metric computation via API
 * - Configurable quantile reference lines
 * - Selection integration with other charts
 * - X-axis zoom with mouse wheel/pan
 * - Export functionality
 */

import { useMemo, useState, useCallback, useRef, useEffect } from 'react';
import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  Cell,
  Tooltip,
  ZAxis,
  ReferenceLine,
} from 'recharts';
import {
  Repeat,
  Download,
  Settings2,
  AlertTriangle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Tooltip as TooltipUI,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Badge } from '@/components/ui/badge';
import { exportDataAsCSV } from '@/lib/chartExport';
import {
  CHART_THEME,
  formatYValue,
} from './chartConfig';
import {
  type GlobalColorConfig,
  type ColorContext,
  getContinuousColor,
  getCategoricalColor,
  normalizeValue,
} from '@/lib/playground/colorConfig';
import { useSelection } from '@/context/SelectionContext';
import type { RepetitionResult } from '@/types/playground';
import type { UseSpectraChartConfigResult } from '@/lib/playground/useSpectraChartConfig';
import type { DiffQuantile } from '@/lib/playground/spectraConfig';
import { DiffModeControls } from './DiffModeControls';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import { computeRepetitionVariance } from '@/api/playground';

// ============= Types =============

interface RepetitionsChartProps {
  /** Repetition analysis data from backend */
  repetitionData: RepetitionResult | null | undefined;
  /** Raw spectra data for distance computation */
  spectraData?: number[][];
  /** Whether chart is in loading state */
  isLoading?: boolean;
  /** Enable SelectionContext integration */
  useSelectionContext?: boolean;
  /** Y values for target coloring */
  y?: number[];
  /** Compact mode */
  compact?: boolean;
  /** Callback to open repetition setup dialog */
  onConfigureRepetitions?: () => void;
  /** Global color configuration (unified system) */
  globalColorConfig?: GlobalColorConfig;
  /** Color context data for unified color system */
  colorContext?: ColorContext;
  /** Spectra chart config result for diff mode controls */
  configResult?: UseSpectraChartConfigResult;
  /** Whether reference dataset mode is active (affects dataset source visibility) */
  hasReferenceDataset?: boolean;
}

interface PlotDataPoint {
  /** X position (bio sample index) */
  x: number;
  /** Y position (distance) */
  y: number;
  /** Bio sample ID */
  bioSample: string;
  /** Rep index within bio sample */
  repIndex: number;
  /** Global sample index */
  sampleIndex: number;
  /** Sample ID string */
  sampleId: string;
  /** Target value for coloring */
  targetY?: number;
  /** Mean Y for the bio sample */
  yMean?: number;
  /** Is this an outlier? */
  isOutlier: boolean;
  /** Is this point selected? */
  isSelected: boolean;
}

interface ComputedDistances {
  distances: number[];
  quantiles: Record<number, number>;
  mean: number;
  max: number;
}

// ============= Color Helpers =============

function getTargetColor(
  y: number,
  yMin: number,
  yMax: number,
  palette?: GlobalColorConfig['continuousPalette']
): string {
  if (yMax === yMin) return 'hsl(180, 60%, 50%)';
  const t = normalizeValue(y, yMin, yMax);
  if (palette) {
    return getContinuousColor(t, palette);
  }
  const hue = 270 - t * 210;
  const saturation = 60 + t * 20;
  const lightness = 35 + t * 25;
  return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
}

function getDistanceColor(distance: number, maxDistance: number): string {
  if (maxDistance === 0) return 'hsl(120, 60%, 50%)';
  const t = Math.min(distance / maxDistance, 1);
  const hue = 120 - t * 120;
  return `hsl(${hue}, 70%, 50%)`;
}

function getBioSampleColor(
  index: number,
  palette?: GlobalColorConfig['categoricalPalette']
): string {
  if (palette) {
    return getCategoricalColor(index, palette);
  }
  const hue = (index * 137.508) % 360;
  return `hsl(${hue}, 60%, 50%)`;
}

// ============= Constants =============

const MIN_PIXELS_PER_SAMPLE = 5;
const QUANTILE_COLORS: Record<DiffQuantile, string> = {
  50: 'hsl(var(--muted-foreground))',
  75: 'hsl(180, 60%, 50%)',
  90: 'hsl(45, 90%, 50%)',
  95: 'hsl(0, 70%, 55%)',
};

// ============= Component =============

export function RepetitionsChart({
  repetitionData,
  spectraData,
  isLoading = false,
  useSelectionContext = true,
  y,
  compact = false,
  onConfigureRepetitions,
  globalColorConfig,
  colorContext,
  configResult,
  hasReferenceDataset = false,
}: RepetitionsChartProps) {
  const chartRef = useRef<HTMLDivElement>(null);
  const [showGrid, setShowGrid] = useState(true);
  const [computedDistances, setComputedDistances] = useState<ComputedDistances | null>(null);
  const [isComputing, setIsComputing] = useState(false);

  // Zoom state
  const [xDomain, setXDomain] = useState<[number, number] | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState<number | null>(null);

  // SelectionContext integration
  const selectionCtx = useSelectionContext ? useSelection() : null;
  const selectedSamples = selectionCtx?.selectedSamples ?? new Set<number>();

  // Check if we have valid repetition data
  const hasRepetitions = repetitionData?.has_repetitions && repetitionData?.data;

  // Get diff config from configResult
  const diffConfig = configResult?.config.diffConfig;
  const metric = diffConfig?.metric ?? 'euclidean';
  const scaleType = diffConfig?.scaleType ?? 'linear';
  const quantiles = diffConfig?.quantiles ?? [];
  const repetitionReference = diffConfig?.repetitionReference ?? 'group_mean';

  // Compute distances when metric or reference changes
  useEffect(() => {
    if (!hasRepetitions || !repetitionData?.data || !spectraData || spectraData.length === 0) {
      return;
    }

    const groupIds = repetitionData.data.map(d => d.bio_sample);

    // Only compute if we have valid data
    if (groupIds.length === 0 || spectraData.length !== groupIds.length) {
      return;
    }

    setIsComputing(true);

    computeRepetitionVariance({
      X: spectraData,
      group_ids: groupIds,
      reference: repetitionReference,
      metric: metric,
    })
      .then(response => {
        if (response.success) {
          setComputedDistances({
            distances: response.distances,
            quantiles: response.quantiles,
            mean: response.distances.reduce((a, b) => a + b, 0) / response.distances.length,
            max: Math.max(...response.distances),
          });
        }
      })
      .catch(err => {
        console.error('Failed to compute distances:', err);
      })
      .finally(() => {
        setIsComputing(false);
      });
  }, [hasRepetitions, repetitionData, spectraData, metric, repetitionReference]);

  // Transform data for plotting
  const { plotData, bioSampleOrder, yRange, statistics } = useMemo(() => {
    if (!hasRepetitions || !repetitionData?.data) {
      return {
        plotData: [] as PlotDataPoint[],
        bioSampleOrder: [] as string[],
        yRange: { min: 0, max: 1 },
        statistics: null,
      };
    }

    const data = repetitionData.data;

    // Get unique bio samples
    const bioSamplesSet = new Set(data.map(d => d.bio_sample));
    const bioSampleList = Array.from(bioSamplesSet).sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true })
    );

    // Create a map of bio sample to X index
    const bioSampleIndex = new Map<string, number>();
    bioSampleList.forEach((bs, i) => bioSampleIndex.set(bs, i));

    // Get Y range for coloring
    const allY = data.filter(d => d.y !== undefined).map(d => d.y!);
    const yMin = allY.length > 0 ? Math.min(...allY) : 0;
    const yMax = allY.length > 0 ? Math.max(...allY) : 1;

    // Use computed distances if available, otherwise fall back to repetitionData distances
    const distances = computedDistances?.distances ?? data.map(d => d.distance);
    const maxDist = computedDistances?.max ?? repetitionData.statistics?.max_distance ?? 1;
    const p95 = computedDistances?.quantiles?.[95] ?? repetitionData.statistics?.p95_distance ?? maxDist;

    // Transform to plot data
    const plotData: PlotDataPoint[] = data.map((d, i) => {
      const distance = distances[i] ?? d.distance;
      // Apply log scale if needed
      const displayDistance = scaleType === 'log' ? Math.log1p(distance) : distance;

      return {
        x: bioSampleIndex.get(d.bio_sample) ?? 0,
        y: displayDistance,
        bioSample: d.bio_sample,
        repIndex: d.rep_index,
        sampleIndex: d.sample_index,
        sampleId: d.sample_id,
        targetY: d.y,
        yMean: d.y_mean,
        isOutlier: distance > p95,
        isSelected: selectedSamples.has(d.sample_index),
      };
    });

    // Compute statistics for display
    const stats = computedDistances
      ? {
          mean_distance: computedDistances.mean,
          max_distance: computedDistances.max,
          p95_distance: computedDistances.quantiles[95] ?? computedDistances.max,
        }
      : repetitionData.statistics;

    return {
      plotData,
      bioSampleOrder: bioSampleList,
      yRange: { min: yMin, max: yMax },
      statistics: stats,
    };
  }, [repetitionData, selectedSamples, hasRepetitions, computedDistances, scaleType]);

  // Max distance for color scaling
  const maxDistance = statistics?.max_distance ?? 1;

  // Get point color
  const getPointColor = useCallback((point: PlotDataPoint): string => {
    const continuousPalette = globalColorConfig?.continuousPalette;
    const categoricalPalette = globalColorConfig?.categoricalPalette;

    if (globalColorConfig) {
      const mode = globalColorConfig.mode;
      switch (mode) {
        case 'target':
          if (point.targetY !== undefined) {
            return getTargetColor(point.targetY, yRange.min, yRange.max, continuousPalette);
          }
          return 'hsl(var(--muted-foreground))';
        case 'partition':
          if (colorContext?.trainIndices?.has(point.sampleIndex)) {
            return 'hsl(217, 70%, 50%)';
          }
          if (colorContext?.testIndices?.has(point.sampleIndex)) {
            return 'hsl(38, 92%, 50%)';
          }
          return 'hsl(var(--muted-foreground))';
        case 'fold':
          const foldLabel = colorContext?.foldLabels?.[point.sampleIndex];
          if (foldLabel !== undefined && foldLabel >= 0) {
            return getCategoricalColor(foldLabel, categoricalPalette);
          }
          return 'hsl(var(--muted-foreground))';
        case 'outlier':
          if (colorContext?.outlierIndices?.has(point.sampleIndex)) {
            return 'hsl(0, 70%, 55%)';
          }
          return 'hsl(var(--muted-foreground))';
        default:
          return 'hsl(var(--primary))';
      }
    }

    // Default: color by distance
    return getDistanceColor(point.y, scaleType === 'log' ? Math.log1p(maxDistance) : maxDistance);
  }, [yRange, maxDistance, globalColorConfig, colorContext, scaleType]);

  // Handle point click
  const handlePointClick = useCallback((point: PlotDataPoint, event?: React.MouseEvent) => {
    if (!selectionCtx) return;

    const indices = [point.sampleIndex];

    if (event?.shiftKey) {
      const bioSamplePoints = plotData.filter(p => p.bioSample === point.bioSample);
      selectionCtx.select(bioSamplePoints.map(p => p.sampleIndex), 'add');
    } else if (event?.ctrlKey || event?.metaKey) {
      selectionCtx.toggle(indices);
    } else {
      selectionCtx.select(indices, 'replace');
    }
  }, [selectionCtx, plotData]);

  // Handle background click
  const handleChartBackgroundClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (target.tagName === 'svg' || target.classList.contains('recharts-surface')) {
      if (selectionCtx && selectionCtx.selectedSamples.size > 0) {
        selectionCtx.clear();
      }
    }
  }, [selectionCtx]);

  // Handle mouse wheel for X-axis zoom
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();

    const numSamples = bioSampleOrder.length;
    if (numSamples === 0) return;

    const currentDomain = xDomain ?? [-0.5, numSamples - 0.5];
    const range = currentDomain[1] - currentDomain[0];
    const center = (currentDomain[0] + currentDomain[1]) / 2;

    // Zoom in or out
    const zoomFactor = e.deltaY > 0 ? 1.2 : 0.8;
    let newRange = range * zoomFactor;

    // Limit zoom based on min pixels per sample
    const chartWidth = chartRef.current?.clientWidth ?? 800;
    const minRange = (chartWidth / MIN_PIXELS_PER_SAMPLE) / numSamples * range;
    newRange = Math.max(newRange, 1); // At least 1 sample visible
    newRange = Math.min(newRange, numSamples); // Can't zoom out beyond all samples

    const newStart = Math.max(-0.5, center - newRange / 2);
    const newEnd = Math.min(numSamples - 0.5, center + newRange / 2);

    setXDomain([newStart, newEnd]);
  }, [xDomain, bioSampleOrder.length]);

  // Handle mouse down for pan
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button === 0) { // Left click
      setIsDragging(true);
      setDragStart(e.clientX);
    }
  }, []);

  // Handle mouse move for pan
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging || dragStart === null) return;

    const numSamples = bioSampleOrder.length;
    if (numSamples === 0) return;

    const chartWidth = chartRef.current?.clientWidth ?? 800;
    const currentDomain = xDomain ?? [-0.5, numSamples - 0.5];
    const range = currentDomain[1] - currentDomain[0];

    const deltaX = e.clientX - dragStart;
    const deltaSamples = -(deltaX / chartWidth) * range;

    let newStart = currentDomain[0] + deltaSamples;
    let newEnd = currentDomain[1] + deltaSamples;

    // Clamp to bounds
    if (newStart < -0.5) {
      newEnd -= (newStart + 0.5);
      newStart = -0.5;
    }
    if (newEnd > numSamples - 0.5) {
      newStart -= (newEnd - (numSamples - 0.5));
      newEnd = numSamples - 0.5;
    }

    setXDomain([Math.max(-0.5, newStart), Math.min(numSamples - 0.5, newEnd)]);
    setDragStart(e.clientX);
  }, [isDragging, dragStart, xDomain, bioSampleOrder.length]);

  // Handle mouse up
  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
    setDragStart(null);
  }, []);

  // Reset zoom on double click
  const handleDoubleClick = useCallback(() => {
    setXDomain(null);
  }, []);

  // Export handler
  const handleExport = useCallback(() => {
    if (!repetitionData?.data) return;

    const exportData = repetitionData.data.map((d, i) => ({
      bio_sample: d.bio_sample,
      rep_index: d.rep_index,
      sample_id: d.sample_id,
      sample_index: d.sample_index,
      distance: computedDistances?.distances[i] ?? d.distance,
      y: d.y ?? '',
      y_mean: d.y_mean ?? '',
    }));

    exportDataAsCSV(exportData, 'repetition_analysis');
  }, [repetitionData, computedDistances]);

  // Toggle grid
  const handleGridToggle = useCallback(() => {
    setShowGrid(prev => !prev);
  }, []);

  // Empty states
  if (!repetitionData) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
        <div className="text-center">
          <Repeat className="w-8 h-8 text-muted-foreground/50 mx-auto mb-2" />
          <p>Loading repetition data...</p>
        </div>
      </div>
    );
  }

  if (repetitionData.error) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
        <div className="text-center">
          <AlertTriangle className="w-8 h-8 text-amber-500/70 mx-auto mb-2" />
          <p className="text-amber-600">Repetition analysis error</p>
          <p className="text-xs mt-1 max-w-[200px]">{repetitionData.error}</p>
        </div>
      </div>
    );
  }

  if (!hasRepetitions) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
        <div className="text-center max-w-[250px]">
          <Repeat className="w-8 h-8 text-muted-foreground/50 mx-auto mb-2" />
          <p className="font-medium mb-1">No repetitions detected</p>
          <p className="text-xs">{repetitionData.message || 'Samples appear to be unique measurements.'}</p>
          {onConfigureRepetitions && (
            <Button
              variant="outline"
              size="sm"
              className="mt-3 text-xs"
              onClick={onConfigureRepetitions}
            >
              <Settings2 className="w-3 h-3 mr-1" />
              Configure Detection
            </Button>
          )}
        </div>
      </div>
    );
  }

  // Compute X domain
  const effectiveXDomain = xDomain ?? [-0.5, bioSampleOrder.length - 0.5];

  // Get quantile values for reference lines
  const quantileValues = useMemo(() => {
    const values: { quantile: DiffQuantile; value: number }[] = [];
    const source = computedDistances?.quantiles ?? {
      50: statistics?.mean_distance ?? 0,
      75: (statistics?.mean_distance ?? 0) * 1.5,
      90: (statistics?.p95_distance ?? 0) * 0.9,
      95: statistics?.p95_distance ?? 0,
    };

    for (const q of quantiles) {
      let value = source[q] ?? 0;
      if (scaleType === 'log') {
        value = Math.log1p(value);
      }
      values.push({ quantile: q, value });
    }
    return values;
  }, [quantiles, computedDistances, statistics, scaleType]);

  // Custom tooltip
  const CustomTooltip = ({ active, payload }: any) => {
    if (!active || !payload || payload.length === 0) return null;
    const point: PlotDataPoint | undefined = payload[0]?.payload;
    if (!point) return null;

    return (
      <div className="bg-card border border-border rounded-lg p-2 shadow-lg text-xs max-w-[200px]">
        <p className="font-medium mb-1 truncate">{point.bioSample}</p>
        <div className="space-y-0.5 text-muted-foreground">
          <p>Repetition: {point.repIndex + 1}</p>
          <p>Sample: {point.sampleId}</p>
          <p>Distance: {formatYValue(point.y)}</p>
          {point.targetY !== undefined && (
            <p>Y Value: {formatYValue(point.targetY)}</p>
          )}
          {point.isOutlier && (
            <p className="text-amber-600 font-medium">⚠ High variability</p>
          )}
        </div>
      </div>
    );
  };

  return (
    <div
      className="h-full flex flex-col"
      ref={chartRef}
      onClick={handleChartBackgroundClick}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <Repeat className="w-4 h-4 text-primary" />
          Repetitions
          <Badge variant="secondary" className="text-[10px] font-normal">
            {repetitionData.n_with_reps} bio samples
          </Badge>
          {(isComputing || isLoading) && (
            <span className="text-[10px] text-muted-foreground animate-pulse">Computing...</span>
          )}
        </h3>

        <div className="flex items-center gap-1.5">
          {/* Diff Mode Controls */}
          {configResult && (
            <>
              <DiffModeControls
                configResult={configResult}
                compact={compact}
                hasReferenceDataset={hasReferenceDataset}
                hasRepetitions={true}
                showGrid={showGrid}
                onGridToggle={handleGridToggle}
              />
              <Separator orientation="vertical" className="h-4 mx-0.5" />
            </>
          )}

          {/* Configure */}
          {onConfigureRepetitions && (
            <TooltipProvider delayDuration={200}>
              <TooltipUI>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2"
                    onClick={onConfigureRepetitions}
                  >
                    <Settings2 className="w-3 h-3" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  <p className="text-xs">Configure repetition detection</p>
                </TooltipContent>
              </TooltipUI>
            </TooltipProvider>
          )}

          {/* Export */}
          <TooltipProvider delayDuration={200}>
            <TooltipUI>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="sm" className="h-7 px-2" onClick={handleExport}>
                  <Download className="w-3 h-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <p className="text-xs">Export data</p>
              </TooltipContent>
            </TooltipUI>
          </TooltipProvider>
        </div>
      </div>

      {/* Chart */}
      <div
        className="flex-1 min-h-0 cursor-grab active:cursor-grabbing"
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onDoubleClick={handleDoubleClick}
      >
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 10, right: 20, bottom: 30, left: 45 }}>
            {showGrid && (
              <CartesianGrid
                strokeDasharray={CHART_THEME.gridDasharray}
                stroke={CHART_THEME.gridStroke}
                opacity={CHART_THEME.gridOpacity}
              />
            )}

            <XAxis
              type="number"
              dataKey="x"
              domain={effectiveXDomain}
              ticks={bioSampleOrder.map((_, i) => i).filter(i =>
                i >= Math.floor(effectiveXDomain[0]) && i <= Math.ceil(effectiveXDomain[1])
              )}
              tickFormatter={(value) => {
                const label = bioSampleOrder[value];
                return label?.length > 8 ? label.slice(0, 8) + '…' : label ?? '';
              }}
              stroke={CHART_THEME.axisStroke}
              fontSize={CHART_THEME.axisFontSize}
              interval={0}
              angle={-45}
              textAnchor="end"
              height={50}
              allowDataOverflow
            />

            <YAxis
              type="number"
              dataKey="y"
              stroke={CHART_THEME.axisStroke}
              fontSize={CHART_THEME.axisFontSize}
              width={40}
              scale={scaleType === 'log' ? 'linear' : 'linear'}
              label={{
                value: scaleType === 'log' ? 'log(1 + Distance)' : 'Distance',
                angle: -90,
                position: 'insideLeft',
                fontSize: CHART_THEME.axisLabelFontSize,
                offset: 5,
              }}
            />

            <ZAxis range={[40, 120]} />

            <Tooltip isAnimationActive={false} content={<CustomTooltip />} />

            {/* Quantile reference lines */}
            {quantileValues.map(({ quantile, value }) => (
              <ReferenceLine
                key={`quantile-${quantile}`}
                y={value}
                stroke={QUANTILE_COLORS[quantile]}
                strokeDasharray="3 3"
                strokeWidth={1}
                label={{
                  value: `P${quantile}`,
                  position: 'right',
                  fontSize: 9,
                  fill: QUANTILE_COLORS[quantile],
                }}
              />
            ))}

            {/* Scatter points */}
            <Scatter
              data={plotData}
              cursor="pointer"
              onClick={(data: any, index: number, event: React.MouseEvent) => {
                handlePointClick(plotData[index], event);
              }}
              isAnimationActive={false}
            >
              {plotData.map((point, index) => (
                <Cell
                  key={`cell-${index}`}
                  fill={getPointColor(point)}
                  stroke={
                    point.isSelected
                      ? 'hsl(var(--primary))'
                      : point.isOutlier
                        ? 'hsl(var(--warning))'
                        : 'transparent'
                  }
                  strokeWidth={point.isSelected ? 2 : point.isOutlier ? 1.5 : 0}
                  opacity={
                    selectedSamples.size === 0 || point.isSelected
                      ? 1
                      : 0.3
                  }
                  r={point.isSelected ? 6 : point.isOutlier ? 5 : 4}
                />
              ))}
            </Scatter>
          </ScatterChart>
        </ResponsiveContainer>
      </div>

      {/* Footer */}
      {!compact && (
        <div className="flex items-center justify-between mt-2 text-[10px] text-muted-foreground">
          <div className="flex items-center gap-3">
            <span>
              {repetitionData.total_repetitions} measurements from {repetitionData.n_with_reps} samples
            </span>
            {repetitionData.n_singletons && repetitionData.n_singletons > 0 && (
              <span>({repetitionData.n_singletons} singletons hidden)</span>
            )}
            <span className="text-muted-foreground/50">
              Scroll to zoom • Drag to pan • Double-click to reset
            </span>
          </div>

          <div className="flex items-center gap-3">
            {statistics && (
              <span>
                Mean: {formatYValue(scaleType === 'log' ? Math.log1p(statistics.mean_distance) : statistics.mean_distance)} |
                Max: {formatYValue(scaleType === 'log' ? Math.log1p(statistics.max_distance) : statistics.max_distance)}
              </span>
            )}

            {selectedSamples.size > 0 && (
              <span className="text-primary font-medium">
                {selectedSamples.size} selected
              </span>
            )}
          </div>
        </div>
      )}

      {/* High variability warning */}
      {repetitionData.high_variability_samples &&
       repetitionData.high_variability_samples.length > 0 &&
       !compact && (
        <div className="flex items-center gap-1.5 mt-1 text-[10px] text-amber-600">
          <AlertTriangle className="w-3 h-3" />
          <span>
            {repetitionData.high_variability_samples.length} sample(s) with high variability
            {repetitionData.high_variability_samples.length <= 3 && (
              <span className="text-muted-foreground ml-1">
                ({repetitionData.high_variability_samples.map(s => s.bio_sample).join(', ')})
              </span>
            )}
          </span>
        </div>
      )}
    </div>
  );
}

export default RepetitionsChart;
