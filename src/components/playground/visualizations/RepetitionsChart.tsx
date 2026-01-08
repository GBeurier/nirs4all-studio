/**
 * RepetitionsChart - Visualize intra-sample variability (Phase 4)
 *
 * Displays the variability between multiple measurements (repetitions) of the
 * same biological sample. Helps identify:
 * - Samples with high measurement variability
 * - Outlier repetitions
 * - Batch effects across repetitions
 *
 * Features:
 * - Strip plot: X = bio sample, Y = distance from reference
 * - Connects points from same biological sample
 * - Color by target value, metadata, or distance metric
 * - Distance metric selector (PCA, UMAP, Euclidean, Mahalanobis)
 * - Selection integration with other charts
 * - Tooltip with sample details
 * - Export functionality
 */

import { useMemo, useState, useCallback, useRef } from 'react';
import {
  ComposedChart,
  ScatterChart,
  Scatter,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  Cell,
  Tooltip,
  ZAxis,
  Legend,
  ReferenceLine,
} from 'recharts';
import {
  Repeat,
  Download,
  Settings2,
  ChevronDown,
  AlertTriangle,
  Info,
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
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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
  CHART_MARGINS,
  ANIMATION_CONFIG,
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
import type { RepetitionResult, RepetitionDataPoint } from '@/types/playground';
import { cn } from '@/lib/utils';

// ============= Types =============

export type RepetitionColorMode = 'target' | 'distance' | 'bio_sample' | 'rep_index';
export type DistanceMetric = 'pca' | 'umap' | 'euclidean' | 'mahalanobis';

interface RepetitionsChartProps {
  /** Repetition analysis data from backend */
  repetitionData: RepetitionResult | null | undefined;
  /** Current distance metric used */
  distanceMetric?: DistanceMetric;
  /** Callback when distance metric changes */
  onDistanceMetricChange?: (metric: DistanceMetric) => void;
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
}

interface ChartConfig {
  colorMode: RepetitionColorMode;
  showConnectors: boolean;
  showP95Line: boolean;
  showMeanLine: boolean;
  showSingletons: boolean;
  sortBy: 'alphabetical' | 'mean_distance' | 'target';
  highlightOutliers: boolean;
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

// ============= Default Configuration =============

const DEFAULT_CONFIG: ChartConfig = {
  colorMode: 'target',
  showConnectors: true,
  showP95Line: true,
  showMeanLine: true,
  showSingletons: false,
  sortBy: 'alphabetical',
  highlightOutliers: true,
};

// ============= Color Helpers =============

/**
 * Get color based on target Y value (viridis-like)
 */
function getTargetColor(
  y: number,
  yMin: number,
  yMax: number,
  palette?: GlobalColorConfig['continuousPalette']
): string {
  if (yMax === yMin) return 'hsl(180, 60%, 50%)';
  const t = normalizeValue(y, yMin, yMax);

  // Use unified palette if provided
  if (palette) {
    return getContinuousColor(t, palette);
  }

  // Default: Viridis-inspired: purple -> blue -> green -> yellow
  const hue = 270 - t * 210; // 270 (purple) -> 60 (yellow)
  const saturation = 60 + t * 20;
  const lightness = 35 + t * 25;
  return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
}

/**
 * Get color based on distance (green -> yellow -> red)
 */
function getDistanceColor(distance: number, maxDistance: number): string {
  if (maxDistance === 0) return 'hsl(120, 60%, 50%)'; // Green
  const t = Math.min(distance / maxDistance, 1);
  // Green -> Yellow -> Red
  const hue = 120 - t * 120;
  return `hsl(${hue}, 70%, 50%)`;
}

/**
 * Get color for bio sample (categorical)
 */
function getBioSampleColor(
  index: number,
  palette?: GlobalColorConfig['categoricalPalette']
): string {
  if (palette) {
    return getCategoricalColor(index, palette);
  }
  // Default: Golden angle for good distribution
  const hue = (index * 137.508) % 360;
  return `hsl(${hue}, 60%, 50%)`;
}

// ============= Component =============

export function RepetitionsChart({
  repetitionData,
  distanceMetric = 'pca',
  onDistanceMetricChange,
  isLoading = false,
  useSelectionContext = true,
  y,
  compact = false,
  onConfigureRepetitions,
  globalColorConfig,
  colorContext,
}: RepetitionsChartProps) {
  const chartRef = useRef<HTMLDivElement>(null);
  const [config, setConfig] = useState<ChartConfig>(DEFAULT_CONFIG);
  const [hoveredBioSample, setHoveredBioSample] = useState<string | null>(null);

  // SelectionContext integration
  const selectionCtx = useSelectionContext ? useSelection() : null;
  const selectedSamples = selectionCtx?.selectedSamples ?? new Set<number>();

  // Check if we have valid repetition data
  const hasRepetitions = repetitionData?.has_repetitions && repetitionData?.data;

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

    // Get unique bio samples and sort them
    const bioSamplesSet = new Set(data.map(d => d.bio_sample));
    let bioSampleList = Array.from(bioSamplesSet);

    // Sort based on config
    switch (config.sortBy) {
      case 'mean_distance': {
        // Sort by mean distance (descending - highest variability first)
        const meanDistances = new Map<string, number>();
        for (const bioSample of bioSampleList) {
          const points = data.filter(d => d.bio_sample === bioSample);
          const mean = points.reduce((sum, p) => sum + p.distance, 0) / points.length;
          meanDistances.set(bioSample, mean);
        }
        bioSampleList.sort((a, b) => (meanDistances.get(b) ?? 0) - (meanDistances.get(a) ?? 0));
        break;
      }
      case 'target': {
        // Sort by mean target value
        const meanTargets = new Map<string, number>();
        for (const bioSample of bioSampleList) {
          const points = data.filter(d => d.bio_sample === bioSample);
          const validY = points.filter(p => p.y !== undefined).map(p => p.y!);
          if (validY.length > 0) {
            meanTargets.set(bioSample, validY.reduce((a, b) => a + b, 0) / validY.length);
          }
        }
        bioSampleList.sort((a, b) => (meanTargets.get(a) ?? 0) - (meanTargets.get(b) ?? 0));
        break;
      }
      case 'alphabetical':
      default:
        bioSampleList.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    }

    // Create a map of bio sample to X index
    const bioSampleIndex = new Map<string, number>();
    bioSampleList.forEach((bs, i) => bioSampleIndex.set(bs, i));

    // Get Y range for coloring
    const allY = data.filter(d => d.y !== undefined).map(d => d.y!);
    const yMin = allY.length > 0 ? Math.min(...allY) : 0;
    const yMax = allY.length > 0 ? Math.max(...allY) : 1;

    // P95 threshold for outliers
    const p95 = repetitionData.statistics?.p95_distance ?? 0;

    // Transform to plot data
    const plotData: PlotDataPoint[] = data.map(d => ({
      x: bioSampleIndex.get(d.bio_sample) ?? 0,
      y: d.distance,
      bioSample: d.bio_sample,
      repIndex: d.rep_index,
      sampleIndex: d.sample_index,
      sampleId: d.sample_id,
      targetY: d.y,
      yMean: d.y_mean,
      isOutlier: d.distance > p95,
      isSelected: selectedSamples.has(d.sample_index),
    }));

    return {
      plotData,
      bioSampleOrder: bioSampleList,
      yRange: { min: yMin, max: yMax },
      statistics: repetitionData.statistics,
    };
  }, [repetitionData, config.sortBy, selectedSamples, hasRepetitions]);

  // Max distance for color scaling
  const maxDistance = statistics?.max_distance ?? 1;

  // Get point color based on color mode
  const getPointColor = useCallback((point: PlotDataPoint): string => {
    const continuousPalette = globalColorConfig?.continuousPalette;
    const categoricalPalette = globalColorConfig?.categoricalPalette;

    // Use global color config mode when provided
    if (globalColorConfig) {
      const mode = globalColorConfig.mode;

      switch (mode) {
        case 'target':
          if (point.targetY !== undefined) {
            return getTargetColor(point.targetY, yRange.min, yRange.max, continuousPalette);
          }
          return 'hsl(var(--muted-foreground))';

        case 'partition':
          // Color by train/test
          if (colorContext?.trainIndices?.has(point.sampleIndex)) {
            return 'hsl(217, 70%, 50%)'; // Blue for train
          }
          if (colorContext?.testIndices?.has(point.sampleIndex)) {
            return 'hsl(38, 92%, 50%)'; // Orange for test
          }
          return 'hsl(var(--muted-foreground))';

        case 'fold':
          // Color by fold label
          const foldLabel = colorContext?.foldLabels?.[point.sampleIndex];
          if (foldLabel !== undefined && foldLabel >= 0) {
            return getCategoricalColor(foldLabel, categoricalPalette);
          }
          return 'hsl(var(--muted-foreground))';

        case 'metadata':
          // Color by metadata column
          if (colorContext?.metadata && globalColorConfig.metadataKey) {
            const values = colorContext.metadata[globalColorConfig.metadataKey];
            const value = values?.[point.sampleIndex];
            if (value !== undefined && value !== null) {
              const uniqueValues = [...new Set(values.filter(v => v !== null && v !== undefined))];
              const idx = uniqueValues.indexOf(value);
              return getCategoricalColor(idx >= 0 ? idx : 0, categoricalPalette);
            }
          }
          return 'hsl(var(--muted-foreground))';

        case 'selection':
          // Selected = primary, unselected = grey
          return 'hsl(var(--muted-foreground))'; // Base color, selection handled by rendering

        case 'outlier':
          // Outlier = red, non-outlier = grey
          if (colorContext?.outlierIndices?.has(point.sampleIndex)) {
            return 'hsl(0, 70%, 55%)'; // Red for outliers
          }
          return 'hsl(var(--muted-foreground))';

        default:
          return 'hsl(var(--primary))';
      }
    }

    // Legacy behavior using internal config.colorMode
    switch (config.colorMode) {
      case 'target':
        if (point.targetY !== undefined) {
          return getTargetColor(point.targetY, yRange.min, yRange.max, continuousPalette);
        }
        return 'hsl(var(--muted-foreground))';

      case 'distance':
        return getDistanceColor(point.y, maxDistance);

      case 'bio_sample':
        return getBioSampleColor(point.x, categoricalPalette);

      case 'rep_index':
        if (categoricalPalette) {
          return getCategoricalColor(point.repIndex, categoricalPalette);
        }
        const hue = point.repIndex * 60; // Different hue per rep
        return `hsl(${hue}, 60%, 50%)`;

      default:
        return 'hsl(var(--primary))';
    }
  }, [config.colorMode, yRange, maxDistance, globalColorConfig, colorContext]);

  // Handle point click
  const handlePointClick = useCallback((point: PlotDataPoint, event?: React.MouseEvent) => {
    if (!selectionCtx) return;

    const indices = [point.sampleIndex];

    if (event?.shiftKey) {
      // Add all reps of this bio sample
      const bioSamplePoints = plotData.filter(p => p.bioSample === point.bioSample);
      selectionCtx.select(bioSamplePoints.map(p => p.sampleIndex), 'add');
    } else if (event?.ctrlKey || event?.metaKey) {
      selectionCtx.toggle(indices);
    } else {
      selectionCtx.select(indices, 'replace');
    }
  }, [selectionCtx, plotData]);

  // Handle bio sample group click (select all reps)
  const handleBioSampleClick = useCallback((bioSample: string, event?: React.MouseEvent) => {
    if (!selectionCtx) return;

    const indices = plotData
      .filter(p => p.bioSample === bioSample)
      .map(p => p.sampleIndex);

    if (event?.shiftKey) {
      selectionCtx.select(indices, 'add');
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

  // Update config
  const updateConfig = useCallback((updates: Partial<ChartConfig>) => {
    setConfig(prev => ({ ...prev, ...updates }));
  }, []);

  // Export handler
  const handleExport = useCallback(() => {
    if (!repetitionData?.data) return;

    const exportData = repetitionData.data.map(d => ({
      bio_sample: d.bio_sample,
      rep_index: d.rep_index,
      sample_id: d.sample_id,
      sample_index: d.sample_index,
      distance: d.distance,
      y: d.y ?? '',
      y_mean: d.y_mean ?? '',
    }));

    exportDataAsCSV(exportData, 'repetition_analysis');
  }, [repetitionData]);

  // Empty state: No repetition data
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

  // Empty state: Error in computation
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

  // Empty state: No repetitions detected
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

  // Render settings dropdown
  const renderSettingsDropdown = () => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="h-7 px-2">
          <Settings2 className="w-3 h-3" />
          <ChevronDown className="w-3 h-3 ml-1" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuLabel>Display Options</DropdownMenuLabel>
        <DropdownMenuSeparator />

        <DropdownMenuCheckboxItem
          checked={config.showConnectors}
          onCheckedChange={(checked) => updateConfig({ showConnectors: checked })}
        >
          Connect repetitions
        </DropdownMenuCheckboxItem>

        <DropdownMenuCheckboxItem
          checked={config.showP95Line}
          onCheckedChange={(checked) => updateConfig({ showP95Line: checked })}
        >
          Show P95 threshold
        </DropdownMenuCheckboxItem>

        <DropdownMenuCheckboxItem
          checked={config.showMeanLine}
          onCheckedChange={(checked) => updateConfig({ showMeanLine: checked })}
        >
          Show mean distance
        </DropdownMenuCheckboxItem>

        <DropdownMenuCheckboxItem
          checked={config.highlightOutliers}
          onCheckedChange={(checked) => updateConfig({ highlightOutliers: checked })}
        >
          Highlight outliers
        </DropdownMenuCheckboxItem>

        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs text-muted-foreground">Sort By</DropdownMenuLabel>

        <DropdownMenuCheckboxItem
          checked={config.sortBy === 'alphabetical'}
          onCheckedChange={() => updateConfig({ sortBy: 'alphabetical' })}
        >
          Name
        </DropdownMenuCheckboxItem>

        <DropdownMenuCheckboxItem
          checked={config.sortBy === 'mean_distance'}
          onCheckedChange={() => updateConfig({ sortBy: 'mean_distance' })}
        >
          Variability (highest first)
        </DropdownMenuCheckboxItem>

        <DropdownMenuCheckboxItem
          checked={config.sortBy === 'target'}
          onCheckedChange={() => updateConfig({ sortBy: 'target' })}
        >
          Target value
        </DropdownMenuCheckboxItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  // Custom tooltip
  const CustomTooltip = ({ active, payload }: any) => {
    if (!active || !payload || payload.length === 0) return null;
    const point: PlotDataPoint = payload[0].payload;

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
    <div className="h-full flex flex-col" ref={chartRef} onClick={handleChartBackgroundClick}>
      {/* Header */}
      <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <Repeat className="w-4 h-4 text-primary" />
          Repetitions
          <Badge variant="secondary" className="text-[10px] font-normal">
            {repetitionData.n_with_reps} bio samples
          </Badge>
        </h3>

        <div className="flex items-center gap-1.5">
          {/* Distance metric selector */}
          {onDistanceMetricChange && (
            <Select
              value={distanceMetric}
              onValueChange={(v) => onDistanceMetricChange(v as DistanceMetric)}
            >
              <SelectTrigger className="h-7 w-28 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="pca">PCA Distance</SelectItem>
                <SelectItem value="umap">UMAP Distance</SelectItem>
                <SelectItem value="euclidean">Euclidean</SelectItem>
                <SelectItem value="mahalanobis">Mahalanobis</SelectItem>
              </SelectContent>
            </Select>
          )}

          {/* Color mode selector - only show when no global config provided */}
          {!globalColorConfig && (
            <Select
              value={config.colorMode}
              onValueChange={(v) => updateConfig({ colorMode: v as RepetitionColorMode })}
            >
              <SelectTrigger className="h-7 w-24 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="target">By Y</SelectItem>
                <SelectItem value="distance">By Distance</SelectItem>
                <SelectItem value="bio_sample">By Sample</SelectItem>
                <SelectItem value="rep_index">By Rep #</SelectItem>
              </SelectContent>
            </Select>
          )}

          {/* Settings */}
          {renderSettingsDropdown()}

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
      <div className="flex-1 min-h-0">
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 10, right: 20, bottom: 30, left: 45 }}>
            <CartesianGrid
              strokeDasharray={CHART_THEME.gridDasharray}
              stroke={CHART_THEME.gridStroke}
              opacity={CHART_THEME.gridOpacity}
            />

            <XAxis
              type="number"
              dataKey="x"
              domain={[-0.5, bioSampleOrder.length - 0.5]}
              ticks={bioSampleOrder.map((_, i) => i)}
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
            />

            <YAxis
              type="number"
              dataKey="y"
              stroke={CHART_THEME.axisStroke}
              fontSize={CHART_THEME.axisFontSize}
              width={40}
              label={{
                value: 'Distance',
                angle: -90,
                position: 'insideLeft',
                fontSize: CHART_THEME.axisLabelFontSize,
                offset: 5,
              }}
            />

            <ZAxis range={[40, 120]} />

            <Tooltip content={<CustomTooltip />} />

            {/* Reference lines */}
            {config.showMeanLine && statistics && (
              <ReferenceLine
                y={statistics.mean_distance}
                stroke="hsl(var(--muted-foreground))"
                strokeDasharray="5 5"
                strokeWidth={1}
                label={{
                  value: `μ = ${formatYValue(statistics.mean_distance)}`,
                  position: 'right',
                  fontSize: 9,
                  fill: 'hsl(var(--muted-foreground))',
                }}
              />
            )}

            {config.showP95Line && statistics && (
              <ReferenceLine
                y={statistics.p95_distance}
                stroke="hsl(var(--warning))"
                strokeDasharray="3 3"
                strokeWidth={1}
                label={{
                  value: `P95`,
                  position: 'right',
                  fontSize: 9,
                  fill: 'hsl(var(--warning))',
                }}
              />
            )}

            {/* Scatter points */}
            <Scatter
              data={plotData}
              cursor="pointer"
              onClick={(data: any, index: number, event: React.MouseEvent) => {
                handlePointClick(plotData[index], event);
              }}
              {...ANIMATION_CONFIG}
            >
              {plotData.map((point, index) => (
                <Cell
                  key={`cell-${index}`}
                  fill={getPointColor(point)}
                  stroke={
                    point.isSelected
                      ? 'hsl(var(--primary))'
                      : point.isOutlier && config.highlightOutliers
                        ? 'hsl(var(--warning))'
                        : 'transparent'
                  }
                  strokeWidth={point.isSelected ? 2 : point.isOutlier && config.highlightOutliers ? 1.5 : 0}
                  opacity={
                    selectedSamples.size === 0 ||
                    point.isSelected ||
                    (hoveredBioSample && point.bioSample === hoveredBioSample)
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
          </div>

          <div className="flex items-center gap-3">
            {statistics && (
              <span>
                Mean dist: {formatYValue(statistics.mean_distance)} |
                Max: {formatYValue(statistics.max_distance)}
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
