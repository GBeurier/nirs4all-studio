/**
 * SpectraChart - Refactored spectra visualization for backend data
 *
 * Features:
 * - Uses backend-computed data from ExecuteResponse
 * - Mean ± std band visualization
 * - Wavelength zoom brush
 * - Original/Processed toggle
 * - Sample selection and highlighting
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
  ReferenceArea,
  Tooltip,
} from 'recharts';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Eye, EyeOff, Layers, Download, BarChart3, Loader2 } from 'lucide-react';
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
  /** Currently selected sample */
  selectedSample?: number | null;
  /** Callback when sample is selected */
  onSelectSample?: (index: number) => void;
  /** Callback when the user triggers a chart interaction */
  onInteractionStart?: () => void;
  /** Max samples to display (for performance) */
  maxSamples?: number;
  /** Whether chart is in loading state */
  isLoading?: boolean;
}

type ViewMode = 'both' | 'original' | 'processed';
type StatisticsMode = 'none' | 'mean' | 'std' | 'range';
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
  selectedSample,
  onSelectSample,
  onInteractionStart,
  maxSamples = 50,
  isLoading = false,
}: SpectraChartProps) {
  const chartRef = useRef<HTMLDivElement>(null);

  // View state
  const [viewMode, setViewMode] = useState<ViewMode>('processed');
  const [displayMode, setDisplayMode] = useState<DisplayMode>('all');
  const [statisticsMode, setStatisticsMode] = useState<StatisticsMode>('none');
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

    const stats = viewMode === 'original' ? original.statistics : processed.statistics;
    const medianSeries = viewMode === 'original' ? medianValues.original : medianValues.processed;

    const shouldIncludeMean = displayMode === 'mean' || (displayMode === 'all' && statisticsMode !== 'none');
    const shouldIncludeStd = displayMode === 'mean' || (displayMode === 'all' && statisticsMode === 'std');
    const shouldIncludeP5P95 = displayMode === 'quantiles' || (displayMode === 'all' && statisticsMode === 'range');
    const shouldIncludeMedian = displayMode === 'median' || displayMode === 'quantiles';

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

      if (stats && shouldIncludeMean) {
        point.mean = stats.mean[wIdx];
      }

      if (stats && shouldIncludeStd) {
        point.stdUpper = stats.mean[wIdx] + stats.std[wIdx];
        point.stdLower = stats.mean[wIdx] - stats.std[wIdx];
        point.stdBand = point.stdUpper - point.stdLower;
      }

      if (stats && shouldIncludeP5P95) {
        point.p5 = stats.p5?.[wIdx] ?? stats.min[wIdx];
        point.p95 = stats.p95?.[wIdx] ?? stats.max[wIdx];
        point.pBand = point.p95 - point.p5;
      }

      if (shouldIncludeMedian && medianSeries && medianSeries.length > wIdx) {
        point.median = medianSeries[wIdx];
      }

      return point;
    });
  }, [wavelengths, displayIndices, viewMode, displayMode, statisticsMode, processed, original, medianValues]);

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

    const baseColor = getExtendedSampleColor(
      sampleIdx,
      yValues,
      foldLabels,
      colorConfig,
      selectedSample,
      undefined
    );

    // Desaturate original spectra slightly when showing both
    if (isOriginal && viewMode === 'both' && selectedSample !== sampleIdx) {
      return baseColor.replace(/50%\)/, '60%)').replace(/70%/, '50%');
    }
    return baseColor;
  }, [displayIndices, y, folds, colorConfig, selectedSample, viewMode]);

  // Handle click on chart
  const handleClick = useCallback((e: unknown) => {
    const event = e as { activePayload?: Array<{ dataKey: string }> };
    if (event?.activePayload?.[0]?.dataKey && onSelectSample) {
      const key = event.activePayload[0].dataKey as string;
      const match = key.match(/[po](\d+)/);
      if (match) {
        const displayIdx = parseInt(match[1], 10);
        const sampleIdx = displayIndices[displayIdx];
        onSelectSample(sampleIdx);
      }
    }
  }, [onSelectSample, displayIndices]);

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

  const cycleStatisticsMode = useCallback(() => {
    setStatisticsMode((prev) => {
      if (prev === 'none') return 'std';
      if (prev === 'std') return 'range';
      return 'none';
    });
    onInteractionStart?.();
  }, [onInteractionStart]);

  const totalSamples = processed.spectra.length || original.spectra.length;
  const showOriginal = displayMode === 'all' && (viewMode === 'both' || viewMode === 'original');
  const showProcessed = displayMode === 'all' && (viewMode === 'both' || viewMode === 'processed');

  const showMeanLine = displayMode === 'mean' || (displayMode === 'all' && statisticsMode !== 'none');
  const showStdBand = displayMode === 'mean' || (displayMode === 'all' && statisticsMode === 'std');
  const showP5P95Band = displayMode === 'quantiles' || (displayMode === 'all' && statisticsMode === 'range');
  const showMedianLine = displayMode === 'median' || displayMode === 'quantiles';

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

          {/* Statistics mode */}
          <Button
            variant={statisticsMode !== 'none' && displayMode === 'all' ? 'default' : 'ghost'}
            size="sm"
            className="h-7 px-2"
            title="Cycle statistics overlay (none → ±std → p5-p95)"
            onClick={cycleStatisticsMode}
            disabled={displayMode !== 'all'}
          >
            <BarChart3 className="w-3 h-3" />
          </Button>

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
      <div className="flex-1 min-h-0">
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
            {showP5P95Band && (
              <Area
                type="monotone"
                dataKey="p95"
                stroke="none"
                fill={STATISTICS_COLORS.p5p95}
                fillOpacity={CHART_THEME.statisticsBandOpacity}
                baseValue="dataMin"
                {...ANIMATION_CONFIG}
                tooltipType="none"
              />
            )}
            {showP5P95Band && (
              <Area
                type="monotone"
                dataKey="p5"
                stroke="none"
                fill="hsl(var(--card))"
                fillOpacity={1}
                baseValue="dataMin"
                {...ANIMATION_CONFIG}
                tooltipType="none"
              />
            )}

            {/* Statistics bands - std envelope */}
            {showStdBand && (
              <Area
                type="monotone"
                dataKey="stdUpper"
                stroke="none"
                fill={STATISTICS_COLORS.std}
                fillOpacity={CHART_THEME.statisticsBandOpacity}
                baseValue="dataMin"
                {...ANIMATION_CONFIG}
                tooltipType="none"
              />
            )}
            {showStdBand && (
              <Area
                type="monotone"
                dataKey="stdLower"
                stroke="none"
                fill="hsl(var(--card))"
                fillOpacity={1}
                baseValue="dataMin"
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

            {/* Original spectra (dashed) */}
            {showOriginal && displayIndices.map((_, displayIdx) => (
              <Line
                key={`orig-${displayIdx}`}
                type="monotone"
                dataKey={`o${displayIdx}`}
                stroke={getColor(displayIdx, true)}
                strokeWidth={
                  selectedSample === displayIndices[displayIdx]
                    ? CHART_THEME.selectedLineStrokeWidth
                    : CHART_THEME.lineStrokeWidth
                }
                strokeDasharray={viewMode === 'both' ? '4 2' : undefined}
                dot={false}
                {...ANIMATION_CONFIG}
              />
            ))}

            {/* Processed spectra (solid) */}
            {showProcessed && displayIndices.map((_, displayIdx) => (
              <Line
                key={`proc-${displayIdx}`}
                type="monotone"
                dataKey={`p${displayIdx}`}
                stroke={getColor(displayIdx, false)}
                strokeWidth={
                  selectedSample === displayIndices[displayIdx]
                    ? CHART_THEME.selectedLineStrokeWidth
                    : CHART_THEME.lineStrokeWidth
                }
                dot={false}
                {...ANIMATION_CONFIG}
              />
            ))}

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
