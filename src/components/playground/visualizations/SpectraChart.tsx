/**
 * SpectraChart - Refactored spectra visualization for backend data
 *
 * Features:
 * - Uses backend-computed data from ExecuteResponse
 * - Mean ± std band visualization
 * - Wavelength zoom brush
 * - Original/Processed toggle
 * - Sample selection and highlighting (Phase 1: SelectionContext integration)
 * - Cross-chart hover highlighting
 * - Chart export (PNG/CSV)
 * - Performance optimized (no animations, data sampling)
 */

import { useMemo, useRef, useState, useCallback } from 'react';
import {
  ComposedChart,
  Line,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  Brush,
  Tooltip,
} from 'recharts';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Layers, Download, Loader2 } from 'lucide-react';
import { exportChart } from '@/lib/chartExport';
import {
  CHART_THEME,
  STATISTICS_COLORS,
  CHART_MARGINS,
  ANIMATION_CONFIG,
  getExtendedSampleColor,
  formatWavelength,
  type ExtendedColorConfig,
} from './chartConfig';
import type { DataSection, SpectrumStats, FoldsInfo } from '@/types/playground';
import { useSelection } from '@/context/SelectionContext';

// ============= Types =============

interface HoveredLine {
  displayIdx: number;
  sampleIdx: number;
  isOriginal: boolean;
  value: number;
  color: string;
}

// ============= Types =============

interface SpectraChartProps {
  /** Original data section from backend */
  original: DataSection;
  /** Processed data section from backend */
  processed: DataSection;
  /** Optional Y values for coloring */
  y?: number[];
  /** Sample IDs for labels */
  sampleIds?: string[];
  /** Fold information for fold coloring */
  folds?: FoldsInfo;
  /** Color configuration */
  colorConfig?: ExtendedColorConfig;
  /** Currently selected sample (deprecated - use SelectionContext) */
  selectedSample?: number | null;
  /** Callback when sample is selected (deprecated - use SelectionContext) */
  onSelectSample?: (index: number) => void;
  /** Callback when the user triggers a chart interaction */
  onInteractionStart?: () => void;
  /** Max samples to display (for performance) */
  maxSamples?: number;
  /** Whether chart is in loading state */
  isLoading?: boolean;
  /** Enable SelectionContext integration for cross-chart highlighting */
  useSelectionContext?: boolean;
}

type ViewMode = 'both' | 'original' | 'processed';
type DisplayMode = 'all' | 'mean' | 'median' | 'quantiles';

function computeMedianPerWavelength(spectra: number[][]): number[] {
  if (!spectra || spectra.length === 0 || spectra[0]?.length === undefined) {
    return [];
  }

  const nWavelengths = spectra[0].length;
  const medians = new Array<number>(nWavelengths).fill(0);

  for (let w = 0; w < nWavelengths; w += 1) {
    const column: number[] = [];
    for (let s = 0; s < spectra.length; s += 1) {
      const value = spectra[s]?.[w];
      if (value !== undefined) {
        column.push(value);
      }
    }

    if (column.length === 0) {
      medians[w] = 0;
      continue;
    }

    column.sort((a, b) => a - b);
    const mid = Math.floor(column.length / 2);
    medians[w] = column.length % 2 === 0
      ? (column[mid - 1] + column[mid]) / 2
      : column[mid];
  }

  return medians;
}

// ============= Component =============

export function SpectraChart({
  original,
  processed,
  y,
  sampleIds,
  folds,
  colorConfig,
  selectedSample: externalSelectedSample,
  onSelectSample: externalOnSelectSample,
  onInteractionStart,
  maxSamples = 50,
  isLoading = false,
  useSelectionContext = true,
}: SpectraChartProps) {
  const chartRef = useRef<HTMLDivElement>(null);

  // SelectionContext integration for cross-chart highlighting
  const selectionCtx = useSelectionContext ? useSelection() : null;

  // Determine effective selection state - prefer context, fallback to props
  const selectedSamples = useSelectionContext && selectionCtx
    ? selectionCtx.selectedSamples
    : new Set<number>(externalSelectedSample !== null && externalSelectedSample !== undefined ? [externalSelectedSample] : []);

  const hoveredSample = selectionCtx?.hoveredSample ?? null;
  const pinnedSamples = selectionCtx?.pinnedSamples ?? new Set<number>();

  // View state
  const [viewMode, setViewMode] = useState<ViewMode>('processed');
  const [displayMode, setDisplayMode] = useState<DisplayMode>('all');
  const [brushDomain, setBrushDomain] = useState<[number, number] | null>(null);

  // Hover state: track mouse Y position and the closest line
  const [hoveredLine, setHoveredLine] = useState<HoveredLine | null>(null);
  const [hoverWavelength, setHoverWavelength] = useState<number | null>(null);

  const medianValues = useMemo(() => ({
    processed: processed.statistics?.median?.length
      ? processed.statistics.median
      : computeMedianPerWavelength(processed.spectra),
    original: original.statistics?.median?.length
      ? original.statistics.median
      : computeMedianPerWavelength(original.spectra),
  }), [processed.statistics?.median, processed.spectra, original.statistics?.median, original.spectra]);

  // Get wavelengths (match selected view)
  const wavelengths = useMemo(() => {
    if (viewMode === 'original') {
      return original.wavelengths;
    }

    // processed or both
    return processed.wavelengths.length > 0
      ? processed.wavelengths
      : original.wavelengths;
  }, [viewMode, processed.wavelengths, original.wavelengths]);

  // Determine which sample indices to show
  const displayIndices = useMemo(() => {
    const spectraCount = processed.spectra.length || original.spectra.length;
    if (spectraCount <= maxSamples) {
      return Array.from({ length: spectraCount }, (_, i) => i);
    }
    // Use sample_indices from backend if available, otherwise subsample
    if (processed.sample_indices && processed.sample_indices.length <= maxSamples) {
      return processed.sample_indices.slice(0, maxSamples);
    }
    // Uniform subsampling
    const step = Math.ceil(spectraCount / maxSamples);
    return Array.from({ length: Math.ceil(spectraCount / step) }, (_, i) => i * step)
      .filter(i => i < spectraCount);
  }, [processed, original, maxSamples]);

  // Build chart data
  const chartData = useMemo(() => {
    const showLines = displayMode === 'all';
    const showOriginalLines = showLines && (viewMode === 'both' || viewMode === 'original');
    const showProcessedLines = showLines && (viewMode === 'both' || viewMode === 'processed');

    // For 'both' mode, we need to show stats for both - use processed as primary, original as secondary
    const procStats = processed.statistics;
    const origStats = original.statistics;
    const stats = viewMode === 'original' ? origStats : procStats;
    const medianSeries = viewMode === 'original' ? medianValues.original : medianValues.processed;

    const shouldIncludeMean = displayMode === 'mean';
    const shouldIncludeStd = displayMode === 'mean';
    const shouldIncludeP5P95 = displayMode === 'quantiles';
    const shouldIncludeMedian = displayMode === 'median' || displayMode === 'quantiles';

    // In 'both' mode for aggregation views, include original stats too
    const showBothStats = viewMode === 'both' && displayMode !== 'all';

    return wavelengths.map((wavelength, wIdx) => {
      const point: Record<string, number> = { wavelength };

      if (showProcessedLines || showOriginalLines) {
        displayIndices.forEach((sIdx, displayIdx) => {
          if (showProcessedLines && processed.spectra[sIdx]) {
            point[`p${displayIdx}`] = processed.spectra[sIdx][wIdx];
          }
          if (showOriginalLines && original.spectra[sIdx]) {
            point[`o${displayIdx}`] = original.spectra[sIdx][wIdx];
          }
        });
      }

      // Processed/primary stats
      if (procStats && shouldIncludeMean) {
        point.mean = procStats.mean[wIdx];
      }

      if (procStats && shouldIncludeStd) {
        point.stdUpper = procStats.mean[wIdx] + procStats.std[wIdx];
        point.stdLower = procStats.mean[wIdx] - procStats.std[wIdx];
        // Range format for Recharts Area component
        (point as Record<string, unknown>).stdRange = [
          procStats.mean[wIdx] - procStats.std[wIdx],
          procStats.mean[wIdx] + procStats.std[wIdx],
        ];
      }

      if (procStats && shouldIncludeP5P95) {
        point.p5 = procStats.p5?.[wIdx] ?? procStats.min[wIdx];
        point.p95 = procStats.p95?.[wIdx] ?? procStats.max[wIdx];
        // Range format for Recharts Area component
        (point as Record<string, unknown>).pRange = [
          procStats.p5?.[wIdx] ?? procStats.min[wIdx],
          procStats.p95?.[wIdx] ?? procStats.max[wIdx],
        ];
      }

      if (shouldIncludeMedian && medianValues.processed && medianValues.processed.length > wIdx) {
        point.median = medianValues.processed[wIdx];
      }

      // Original stats for 'both' mode in aggregation views
      if (showBothStats && origStats) {
        if (shouldIncludeMean) {
          point.origMean = origStats.mean[wIdx];
        }
        if (shouldIncludeStd) {
          point.origStdUpper = origStats.mean[wIdx] + origStats.std[wIdx];
          point.origStdLower = origStats.mean[wIdx] - origStats.std[wIdx];
          // Range format for Recharts Area component
          (point as Record<string, unknown>).origStdRange = [
            origStats.mean[wIdx] - origStats.std[wIdx],
            origStats.mean[wIdx] + origStats.std[wIdx],
          ];
        }
        if (shouldIncludeP5P95) {
          point.origP5 = origStats.p5?.[wIdx] ?? origStats.min[wIdx];
          point.origP95 = origStats.p95?.[wIdx] ?? origStats.max[wIdx];
          // Range format for Recharts Area component
          (point as Record<string, unknown>).origPRange = [
            origStats.p5?.[wIdx] ?? origStats.min[wIdx],
            origStats.p95?.[wIdx] ?? origStats.max[wIdx],
          ];
        }
        if (shouldIncludeMedian && medianValues.original && medianValues.original.length > wIdx) {
          point.origMedian = medianValues.original[wIdx];
        }
      }

      // When viewMode is 'original', use original stats as primary
      if (viewMode === 'original' && origStats) {
        if (shouldIncludeMean) {
          point.mean = origStats.mean[wIdx];
        }
        if (shouldIncludeStd) {
          point.stdUpper = origStats.mean[wIdx] + origStats.std[wIdx];
          point.stdLower = origStats.mean[wIdx] - origStats.std[wIdx];
          point.stdBand = point.stdUpper - point.stdLower;
        }
        if (shouldIncludeP5P95) {
          point.p5 = origStats.p5?.[wIdx] ?? origStats.min[wIdx];
          point.p95 = origStats.p95?.[wIdx] ?? origStats.max[wIdx];
          point.pBand = point.p95 - point.p5;
        }
        if (shouldIncludeMedian && medianValues.original && medianValues.original.length > wIdx) {
          point.median = medianValues.original[wIdx];
        }
      }

      return point;
    });
  }, [wavelengths, displayIndices, viewMode, displayMode, processed, original, medianValues]);

  // Filter data by brush domain
  const filteredData = useMemo(() => {
    if (!brushDomain) return chartData;
    return chartData.filter(
      d => d.wavelength >= brushDomain[0] && d.wavelength <= brushDomain[1]
    );
  }, [chartData, brushDomain]);

  // Get color for a sample
  const getColor = useCallback((displayIdx: number, isOriginal: boolean) => {
    const sampleIdx = displayIndices[displayIdx];
    const yValues = y ?? [];
    const foldLabels = folds?.fold_labels;

    const isSelected = selectedSamples.has(sampleIdx);
    const isHovered = hoveredSample === sampleIdx;
    const isPinned = pinnedSamples.has(sampleIdx);
    const hasSelection = selectedSamples.size > 0;

    // Highlighted states
    if (isHovered) {
      return 'hsl(var(--primary))';
    }
    if (isSelected) {
      return 'hsl(var(--primary))';
    }
    if (isPinned) {
      return 'hsl(var(--accent-foreground))';
    }

    // Dim non-selected when there's a selection
    const effectiveSelection = hasSelection ? sampleIdx : undefined;

    const baseColor = getExtendedSampleColor(
      sampleIdx,
      yValues,
      foldLabels,
      colorConfig,
      effectiveSelection,
      undefined
    );

    // Dim non-selected samples
    if (hasSelection) {
      return `${baseColor}40`; // 25% opacity hex
    }

    // Desaturate original spectra slightly when showing both
    if (isOriginal && viewMode === 'both') {
      return baseColor.replace(/50%\)/, '60%)').replace(/70%/, '50%');
    }
    return baseColor;
  }, [displayIndices, y, folds, colorConfig, selectedSamples, hoveredSample, pinnedSamples, viewMode]);

  // Handle click on chart
  const handleClick = useCallback((e: unknown, event?: React.MouseEvent) => {
    const chartEvent = e as { activePayload?: Array<{ dataKey: string }> };
    if (!chartEvent?.activePayload?.[0]?.dataKey) {
      // Clicked on chart but not on a line - clear selection
      if (selectionCtx && selectionCtx.selectedSamples.size > 0) {
        selectionCtx.clear();
      }
      return;
    }

    const key = chartEvent.activePayload[0].dataKey as string;
    const match = key.match(/[po](\d+)/);
    if (!match) {
      // Clicked on non-spectrum element (e.g., mean line) - clear selection
      if (selectionCtx && selectionCtx.selectedSamples.size > 0) {
        selectionCtx.clear();
      }
      return;
    }

    const displayIdx = parseInt(match[1], 10);
    const sampleIdx = displayIndices[displayIdx];

    // Use SelectionContext if available
    if (selectionCtx) {
      // Determine selection mode based on modifiers
      const mouseEvent = event as MouseEvent | undefined;
      if (mouseEvent?.shiftKey) {
        selectionCtx.select([sampleIdx], 'add');
      } else if (mouseEvent?.ctrlKey || mouseEvent?.metaKey) {
        selectionCtx.toggle([sampleIdx]);
      } else {
        // If clicking on already selected sample (and it's the only one), deselect it
        if (selectedSamples.has(sampleIdx) && selectedSamples.size === 1) {
          selectionCtx.clear();
        } else {
          selectionCtx.select([sampleIdx], 'replace');
        }
      }
    } else if (externalOnSelectSample) {
      externalOnSelectSample(sampleIdx);
    }
  }, [selectionCtx, externalOnSelectSample, displayIndices, selectedSamples]);

  // Handle brush change
  const handleBrushChange = useCallback((domain: { startIndex?: number; endIndex?: number }) => {
    if (domain.startIndex !== undefined && domain.endIndex !== undefined) {
      const startWl = chartData[domain.startIndex]?.wavelength;
      const endWl = chartData[domain.endIndex]?.wavelength;
      if (startWl !== undefined && endWl !== undefined) {
        onInteractionStart?.();
        setBrushDomain([startWl, endWl]);
      }
    }
  }, [chartData, onInteractionStart]);

  // Handle mouse move to find closest line
  const handleMouseMove = useCallback((e: any) => {
    if (!e || !e.activePayload || e.activePayload.length === 0) {
      setHoveredLine(null);
      setHoverWavelength(null);
      return;
    }

    const wavelength = e.activeLabel as number;
    setHoverWavelength(wavelength ?? null);

    if (displayMode !== 'all') {
      setHoveredLine(null);
      return;
    }

    // Get Y coordinate from chart event
    const chartY = e.chartY;
    if (chartY === undefined) {
      setHoveredLine(null);
      return;
    }

    // Get the chart wrapper to calculate Y scale
    const chartWrapper = e.activeCoordinate;
    if (!chartWrapper) {
      setHoveredLine(null);
      return;
    }

    // Find the data point at this wavelength
    const dataPoint = chartData.find(d => d.wavelength === wavelength);
    if (!dataPoint) {
      setHoveredLine(null);
      return;
    }

    // Get all Y values from visible lines
    const candidates: { key: string; value: number; displayIdx: number; isOriginal: boolean }[] = [];

    const showOriginalLines = viewMode === 'both' || viewMode === 'original';
    const showProcessedLines = viewMode === 'both' || viewMode === 'processed';

    displayIndices.forEach((sIdx, displayIdx) => {
      if (showProcessedLines) {
        const key = `p${displayIdx}`;
        const val = dataPoint[key];
        if (val !== undefined) {
          candidates.push({ key, value: val, displayIdx, isOriginal: false });
        }
      }
      if (showOriginalLines) {
        const key = `o${displayIdx}`;
        const val = dataPoint[key];
        if (val !== undefined) {
          candidates.push({ key, value: val, displayIdx, isOriginal: true });
        }
      }
    });

    if (candidates.length === 0) {
      setHoveredLine(null);
      return;
    }

    // We need to convert mouse Y (pixel) to data Y to find closest line
    // Use the yAxisMap from the event if available, otherwise estimate from payload
    // Recharts provides activePayload with all values - we can compare pixel distance

    // Get Y axis domain from the data
    const allYValues = candidates.map(c => c.value);
    const yMin = Math.min(...allYValues);
    const yMax = Math.max(...allYValues);

    // Estimate the mouse Y value in data coordinates
    // chartY is in pixels from top of chart area
    // We need to invert it: top = yMax, bottom = yMin
    const chartHeight = e.height || 300; // fallback
    const yRange = yMax - yMin || 1;
    const mouseYValue = yMax - (chartY / chartHeight) * yRange;

    // Find the closest line to the mouse Y value
    let closest = candidates[0];
    let minDist = Math.abs(closest.value - mouseYValue);

    for (const c of candidates) {
      const dist = Math.abs(c.value - mouseYValue);
      if (dist < minDist) {
        minDist = dist;
        closest = c;
      }
    }

    const sampleIdx = displayIndices[closest.displayIdx];
    setHoveredLine({
      displayIdx: closest.displayIdx,
      sampleIdx,
      isOriginal: closest.isOriginal,
      value: closest.value,
      color: getColor(closest.displayIdx, closest.isOriginal),
    });
  }, [chartData, displayIndices, viewMode, getColor, displayMode]);

  // Handle mouse leave
  const handleMouseLeave = useCallback(() => {
    setHoveredLine(null);
    setHoverWavelength(null);
  }, []);

  // Handle click on chart background (not on a data element) to clear selection
  const handleChartBackgroundClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    // Only clear if clicking directly on the chart container or SVG background
    const target = e.target as HTMLElement;
    const tagName = target.tagName.toLowerCase();
    // Clear selection when clicking on svg, the background rect, or container divs
    if (tagName === 'svg' || (tagName === 'rect' && target.classList.contains('recharts-cartesian-grid-bg')) || target.classList.contains('recharts-surface') || target.classList.contains('recharts-wrapper')) {
      if (selectionCtx && selectionCtx.selectedSamples.size > 0) {
        selectionCtx.clear();
      }
    }
  }, [selectionCtx]);

  // Reset brush
  const handleResetBrush = useCallback(() => {
    setBrushDomain(null);
    onInteractionStart?.();
  }, [onInteractionStart]);

  // Export chart
  const handleExport = useCallback(() => {
    const exportData = wavelengths.map((wl, i) => {
      const row: Record<string, number | string> = { wavelength: wl };
      displayIndices.forEach((sIdx, displayIdx) => {
        const id = sampleIds?.[sIdx] ?? `sample_${sIdx}`;
        if (processed.spectra[sIdx]) {
          row[`${id}_processed`] = processed.spectra[sIdx][i];
        }
        if (original.spectra[sIdx]) {
          row[`${id}_original`] = original.spectra[sIdx][i];
        }
      });
      return row;
    });
    exportChart(chartRef.current, exportData, 'spectra');
  }, [wavelengths, displayIndices, sampleIds, processed, original]);

  const totalSamples = processed.spectra.length || original.spectra.length;
  const showOriginal = displayMode === 'all' && (viewMode === 'both' || viewMode === 'original');
  const showProcessed = displayMode === 'all' && (viewMode === 'both' || viewMode === 'processed');

  const showMeanLine = displayMode === 'mean';
  const showStdBand = displayMode === 'mean';
  const showP5P95Band = displayMode === 'quantiles';
  const showMedianLine = displayMode === 'median' || displayMode === 'quantiles';
  // Show original statistics when in 'both' mode for aggregation views
  const showOriginalStats = viewMode === 'both' && displayMode !== 'all';

  return (
    <div className="h-full flex flex-col relative" ref={chartRef}>
      {/* Header */}
      <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <Layers className="w-4 h-4 text-primary" />
          Spectra ({displayIndices.length}/{totalSamples})
        </h3>

        <div className="flex items-center gap-1.5">
          {/* View mode selector */}
          <Select
            value={viewMode}
            onValueChange={(v) => {
              onInteractionStart?.();
              setViewMode(v as ViewMode);
            }}
          >
            <SelectTrigger className="h-7 w-24 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="processed">Processed</SelectItem>
              <SelectItem value="original">Original</SelectItem>
              <SelectItem value="both">Both</SelectItem>
            </SelectContent>
          </Select>

          {/* Display selector */}
          <Select
            value={displayMode}
            onValueChange={(v) => {
              onInteractionStart?.();
              setDisplayMode(v as DisplayMode);
            }}
          >
            <SelectTrigger className="h-7 w-36 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All spectra</SelectItem>
              <SelectItem value="mean">Mean ± std</SelectItem>
              <SelectItem value="quantiles">Median + p5/p95</SelectItem>
              <SelectItem value="median">Median only</SelectItem>
            </SelectContent>
          </Select>

          {/* Reset zoom */}
          {brushDomain && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={handleResetBrush}
            >
              Reset
            </Button>
          )}

          {/* Export */}
          <Button variant="ghost" size="sm" className="h-7 px-2" onClick={handleExport}>
            <Download className="w-3 h-3" />
          </Button>
        </div>
      </div>

      {isLoading && (
        <div className="absolute inset-0 bg-background/70 backdrop-blur-[1px] flex items-center justify-center z-20 pointer-events-none">
          <Loader2 className="w-5 h-5 animate-spin text-primary" aria-hidden="true" />
          <span className="sr-only">Updating spectra</span>
        </div>
      )}

      {/* Chart */}
      <div className="flex-1 min-h-0" onClick={handleChartBackgroundClick}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={filteredData}
            margin={CHART_MARGINS.spectra}
            onClick={handleClick}
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeave}
          >
            <CartesianGrid
              strokeDasharray={CHART_THEME.gridDasharray}
              stroke={CHART_THEME.gridStroke}
              opacity={CHART_THEME.gridOpacity}
            />
            <XAxis
              dataKey="wavelength"
              stroke={CHART_THEME.axisStroke}
              fontSize={CHART_THEME.axisFontSize}
              tickFormatter={formatWavelength}
            />
            <YAxis
              stroke={CHART_THEME.axisStroke}
              fontSize={CHART_THEME.axisFontSize}
              tickFormatter={(v) => v.toFixed(2)}
              width={45}
            />

            {/* Brush for zooming */}
            <Brush
              dataKey="wavelength"
              height={15}
              stroke="hsl(var(--primary))"
              fill="hsl(var(--muted))"
              onChange={handleBrushChange}
              data={chartData}
            />

            {/* Statistics bands - p5/p95 envelope */}
            {/* Statistics bands - p5/p95 envelope using range area */}
            {showP5P95Band && (
              <Area
                type="monotone"
                dataKey="pRange"
                stroke="none"
                fill={STATISTICS_COLORS.p5p95}
                fillOpacity={CHART_THEME.statisticsBandOpacity}
                {...ANIMATION_CONFIG}
                tooltipType="none"
              />
            )}

            {/* Original p5/p95 envelope (for 'both' mode) */}
            {showOriginalStats && showP5P95Band && (
              <Area
                type="monotone"
                dataKey="origPRange"
                stroke="none"
                fill={STATISTICS_COLORS.original}
                fillOpacity={CHART_THEME.statisticsBandOpacity * 0.6}
                {...ANIMATION_CONFIG}
                tooltipType="none"
              />
            )}

            {/* Statistics bands - std envelope using range area */}
            {showStdBand && (
              <Area
                type="monotone"
                dataKey="stdRange"
                stroke="none"
                fill={STATISTICS_COLORS.std}
                fillOpacity={CHART_THEME.statisticsBandOpacity}
                {...ANIMATION_CONFIG}
                tooltipType="none"
              />
            )}

            {/* Original std envelope (for 'both' mode) */}
            {showOriginalStats && showStdBand && (
              <Area
                type="monotone"
                dataKey="origStdRange"
                stroke="none"
                fill={STATISTICS_COLORS.original}
                fillOpacity={CHART_THEME.statisticsBandOpacity * 0.6}
                {...ANIMATION_CONFIG}
                tooltipType="none"
              />
            )}

            {/* Mean line */}
            {showMeanLine && (
              <Line
                type="monotone"
                dataKey="mean"
                stroke={STATISTICS_COLORS.mean}
                strokeWidth={2}
                dot={false}
                {...ANIMATION_CONFIG}
              />
            )}

            {/* Original Mean line (dashed, for 'both' mode) */}
            {showOriginalStats && showMeanLine && (
              <Line
                type="monotone"
                dataKey="origMean"
                stroke={STATISTICS_COLORS.original}
                strokeWidth={2}
                strokeDasharray="4 2"
                dot={false}
                {...ANIMATION_CONFIG}
              />
            )}

            {/* Median line */}
            {showMedianLine && (
              <Line
                type="monotone"
                dataKey="median"
                stroke={STATISTICS_COLORS.median}
                strokeWidth={2}
                dot={false}
                {...ANIMATION_CONFIG}
              />
            )}

            {/* Original Median line (dashed, for 'both' mode) */}
            {showOriginalStats && showMedianLine && (
              <Line
                type="monotone"
                dataKey="origMedian"
                stroke={STATISTICS_COLORS.original}
                strokeWidth={2}
                strokeDasharray="4 2"
                dot={false}
                {...ANIMATION_CONFIG}
              />
            )}

            {/* Original spectra (dashed) */}
            {showOriginal && displayIndices.map((sampleIdx, displayIdx) => {
              const isSelected = selectedSamples.has(sampleIdx);
              const isHovered = hoveredSample === sampleIdx;
              const isPinned = pinnedSamples.has(sampleIdx);
              const highlighted = isSelected || isHovered || isPinned;

              return (
                <Line
                  key={`orig-${displayIdx}`}
                  type="monotone"
                  dataKey={`o${displayIdx}`}
                  stroke={getColor(displayIdx, true)}
                  strokeWidth={
                    highlighted
                      ? CHART_THEME.selectedLineStrokeWidth
                      : CHART_THEME.lineStrokeWidth
                  }
                  strokeDasharray={viewMode === 'both' ? '4 2' : undefined}
                  dot={false}
                  {...ANIMATION_CONFIG}
                />
              );
            })}

            {/* Processed spectra (solid) */}
            {showProcessed && displayIndices.map((sampleIdx, displayIdx) => {
              const isSelected = selectedSamples.has(sampleIdx);
              const isHovered = hoveredSample === sampleIdx;
              const isPinned = pinnedSamples.has(sampleIdx);
              const highlighted = isSelected || isHovered || isPinned;

              return (
                <Line
                  key={`proc-${displayIdx}`}
                  type="monotone"
                  dataKey={`p${displayIdx}`}
                  stroke={getColor(displayIdx, false)}
                  strokeWidth={
                    highlighted
                      ? CHART_THEME.selectedLineStrokeWidth
                      : CHART_THEME.lineStrokeWidth
                  }
                  dot={false}
                  {...ANIMATION_CONFIG}
                />
              );
            })}

            {/* Custom tooltip showing only the closest line */}
            <Tooltip
              content={(props: any) => {
                const wavelength = (props?.label ?? hoverWavelength) as number | undefined;
                if (wavelength === undefined || wavelength === null) return null;

                // Aggregated modes: show summary values.
                if (displayMode !== 'all') {
                  const payloadItem = (props?.payload ?? []).find((p: any) => p && p.value !== undefined);
                  const point: any = payloadItem?.payload;
                  if (!point) return null;

                  const rows: Array<{ label: string; value: number | undefined; color: string }> = [];
                  if (displayMode === 'mean') {
                    rows.push({ label: 'Mean', value: point.mean, color: STATISTICS_COLORS.mean });
                    rows.push({ label: 'Std', value: point.stdUpper !== undefined && point.stdLower !== undefined ? (point.stdUpper - point.mean) : undefined, color: STATISTICS_COLORS.std });
                  }
                  if (displayMode === 'median') {
                    rows.push({ label: 'Median', value: point.median, color: STATISTICS_COLORS.median });
                  }
                  if (displayMode === 'quantiles') {
                    rows.push({ label: 'Median', value: point.median, color: STATISTICS_COLORS.median });
                    rows.push({ label: 'p5', value: point.p5, color: STATISTICS_COLORS.p5p95 });
                    rows.push({ label: 'p95', value: point.p95, color: STATISTICS_COLORS.p5p95 });
                  }

                  return (
                    <div
                      className="p-2 shadow-md text-xs"
                      style={{
                        backgroundColor: CHART_THEME.tooltipBg,
                        border: `1px solid ${CHART_THEME.tooltipBorder}`,
                        borderRadius: CHART_THEME.tooltipBorderRadius,
                      }}
                    >
                      <p className="font-semibold mb-1">{`λ = ${wavelength} nm`}</p>
                      <div className="space-y-1">
                        {rows
                          .filter(r => r.value !== undefined)
                          .map((r) => (
                            <div key={r.label} className="flex items-center justify-between gap-3">
                              <span className="flex items-center gap-2 text-muted-foreground">
                                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: r.color }} />
                                {r.label}
                              </span>
                              <span className="font-mono">{Number(r.value).toFixed(4)}</span>
                            </div>
                          ))}
                      </div>
                    </div>
                  );
                }

                // All spectra mode: keep the “closest line” tooltip.
                if (!hoveredLine) return null;

                const id = sampleIds?.[hoveredLine.sampleIdx] ?? `Sample ${hoveredLine.sampleIdx + 1}`;
                const type = hoveredLine.isOriginal ? 'Orig' : 'Proc';

                return (
                  <div
                    className="p-2 shadow-md text-xs"
                    style={{
                      backgroundColor: CHART_THEME.tooltipBg,
                      border: `1px solid ${CHART_THEME.tooltipBorder}`,
                      borderRadius: CHART_THEME.tooltipBorderRadius,
                    }}
                  >
                    <p className="font-semibold mb-1">{`λ = ${wavelength} nm`}</p>
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: hoveredLine.color }} />
                      <span className="text-muted-foreground">{id} ({type}):</span>
                      <span className="font-mono">{hoveredLine.value.toFixed(4)}</span>
                    </div>
                  </div>
                );
              }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Legend */}
      <div className="flex items-center justify-between mt-2 text-[10px] text-muted-foreground">
        <div className="flex items-center gap-3">
          {showProcessed && (
            <span className="flex items-center gap-1">
              <span className="w-3 h-0.5 bg-primary" />
              Processed
            </span>
          )}
          {showOriginal && viewMode === 'both' && (
            <span className="flex items-center gap-1">
              <span className="w-3 h-0.5 border-t border-dashed border-primary" />
              Original
            </span>
          )}
          {showMeanLine && (
            <span className="flex items-center gap-1">
              <span className="w-3 h-0.5" style={{ backgroundColor: STATISTICS_COLORS.mean }} />
              Mean
            </span>
          )}
          {showStdBand && (
            <span className="flex items-center gap-1">
              <span className="w-3 h-2 opacity-30" style={{ backgroundColor: STATISTICS_COLORS.std }} />
              ±1 Std
            </span>
          )}
          {showP5P95Band && (
            <span className="flex items-center gap-1">
              <span className="w-3 h-2 opacity-30" style={{ backgroundColor: STATISTICS_COLORS.p5p95 }} />
              p5–p95
            </span>
          )}
          {showMedianLine && (
            <span className="flex items-center gap-1">
              <span className="w-3 h-0.5" style={{ backgroundColor: STATISTICS_COLORS.median }} />
              Median
            </span>
          )}
          {showOriginalStats && (
            <span className="flex items-center gap-1">
              <span className="w-3 h-0.5 border-t border-dashed" style={{ borderColor: STATISTICS_COLORS.original }} />
              Original
            </span>
          )}
          {selectedSamples.size > 0 && (
            <span className="text-primary font-medium">
              • {selectedSamples.size} selected
            </span>
          )}
        </div>
        {brushDomain && (
          <span>
            Zoom: {brushDomain[0].toFixed(0)} - {brushDomain[1].toFixed(0)} nm
          </span>
        )}
      </div>
    </div>
  );
}

export default SpectraChart;
