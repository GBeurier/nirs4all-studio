/**
 * YHistogram - Updated Y distribution histogram
 *
 * Features:
 * - Supports processed Y values (for future y_processing support)
 * - Uses shared chart config
 * - Sample selection and highlighting (Phase 1: SelectionContext integration)
 * - Cross-chart selection highlighting
 * - Export functionality
 * - Statistics display
 */

import { useMemo, useRef, useCallback } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  Cell,
  Tooltip,
} from 'recharts';
import { BarChart3, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { exportChart } from '@/lib/chartExport';
import {
  CHART_THEME,
  CHART_MARGINS,
  ANIMATION_CONFIG,
  formatYValue,
} from './chartConfig';
import { useSelection } from '@/context/SelectionContext';

// ============= Types =============

interface YHistogramProps {
  /** Y values to display */
  y: number[];
  /** Optional processed Y values (when y_processing is applied) */
  processedY?: number[];
  /** Number of bins */
  bins?: number;
  /** Currently selected sample (deprecated - use SelectionContext) */
  selectedSample?: number | null;
  /** Callback when sample is selected (deprecated - use SelectionContext) */
  onSelectSample?: (index: number) => void;
  /** Whether chart is in loading state */
  isLoading?: boolean;
  /** Enable SelectionContext integration for cross-chart highlighting */
  useSelectionContext?: boolean;
}

interface BinData {
  binStart: number;
  binEnd: number;
  binCenter: number;
  count: number;
  samples: number[];
}

interface YStats {
  mean: number;
  median: number;
  std: number;
  min: number;
  max: number;
  n: number;
}

// ============= Component =============

export function YHistogram({
  y,
  processedY,
  bins = 20,
  selectedSample: externalSelectedSample,
  onSelectSample: externalOnSelectSample,
  isLoading = false,
  useSelectionContext = true,
}: YHistogramProps) {
  const chartRef = useRef<HTMLDivElement>(null);

  // SelectionContext integration for cross-chart highlighting
  const selectionCtx = useSelectionContext ? useSelection() : null;

  // Determine effective selection state - prefer context, fallback to props
  const selectedSamples = useSelectionContext && selectionCtx
    ? selectionCtx.selectedSamples
    : new Set<number>(externalSelectedSample !== null && externalSelectedSample !== undefined ? [externalSelectedSample] : []);

  const hoveredSample = selectionCtx?.hoveredSample ?? null;

  // Use processed Y if available, otherwise original Y
  const displayY = processedY && processedY.length === y.length ? processedY : y;
  const isProcessed = processedY && processedY.length === y.length;

  // Compute histogram bins
  const { histogramData, sampleBins } = useMemo(() => {
    if (!displayY || displayY.length === 0) {
      return { histogramData: [], sampleBins: [] };
    }

    const values = displayY;
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min;
    const binWidth = range / bins || 1;

    const histogram: BinData[] = Array.from({ length: bins }, (_, i) => ({
      binStart: min + i * binWidth,
      binEnd: min + (i + 1) * binWidth,
      binCenter: min + (i + 0.5) * binWidth,
      count: 0,
      samples: [],
    }));

    const sampleToBin: number[] = [];

    values.forEach((v, idx) => {
      // Handle edge case where value equals max
      let binIndex = Math.floor((v - min) / binWidth);
      if (binIndex >= bins) binIndex = bins - 1;
      if (binIndex < 0) binIndex = 0;

      histogram[binIndex].count++;
      histogram[binIndex].samples.push(idx);
      sampleToBin[idx] = binIndex;
    });

    return { histogramData: histogram, sampleBins: sampleToBin };
  }, [displayY, bins]);

  // Compute statistics
  const stats = useMemo<YStats | null>(() => {
    if (!displayY || displayY.length === 0) return null;

    const values = displayY;
    const n = values.length;
    const sorted = [...values].sort((a, b) => a - b);
    const sum = values.reduce((a, b) => a + b, 0);
    const mean = sum / n;
    const median = n % 2 === 0
      ? (sorted[n / 2 - 1] + sorted[n / 2]) / 2
      : sorted[Math.floor(n / 2)];
    const variance = values.reduce((acc, v) => acc + Math.pow(v - mean, 2), 0) / n;
    const std = Math.sqrt(variance);

    return {
      mean,
      median,
      std,
      min: sorted[0],
      max: sorted[n - 1],
      n,
    };
  }, [displayY]);

  // Find which bins contain selected/hovered samples
  const selectedBins = useMemo(() => {
    const bins = new Set<number>();
    selectedSamples.forEach(idx => {
      if (sampleBins[idx] !== undefined) {
        bins.add(sampleBins[idx]);
      }
    });
    return bins;
  }, [selectedSamples, sampleBins]);

  const hoveredBin = hoveredSample !== null && sampleBins[hoveredSample] !== undefined
    ? sampleBins[hoveredSample]
    : null;

  // Handle bar click - select all samples in the bin
  const handleClick = useCallback((data: unknown, _index: number, event?: React.MouseEvent) => {
    const binData = data as BinData;
    if (!binData?.samples?.length) return;

    // Use SelectionContext if available
    if (selectionCtx) {
      // Determine selection mode based on modifiers
      if (event?.shiftKey) {
        selectionCtx.select(binData.samples, 'add');
      } else if (event?.ctrlKey || event?.metaKey) {
        selectionCtx.toggle(binData.samples);
      } else {
        selectionCtx.select(binData.samples, 'replace');
      }
    } else if (externalOnSelectSample) {
      // Legacy: select first sample in the bin
      externalOnSelectSample(binData.samples[0]);
    }
  }, [selectionCtx, externalOnSelectSample]);

  // Handle click on chart background (not on a bar) to clear selection
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

  // Export handler
  const handleExport = useCallback(() => {
    const exportData = histogramData.map(h => ({
      bin_center: h.binCenter,
      bin_start: h.binStart,
      bin_end: h.binEnd,
      count: h.count,
    }));
    exportChart(chartRef.current, exportData, 'y_histogram');
  }, [histogramData]);

  // Empty state
  if (!displayY || displayY.length === 0 || !stats) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
        <div className="text-center">
          <BarChart3 className="w-8 h-8 text-muted-foreground/50 mx-auto mb-2" />
          <p>No Y values available</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col" ref={chartRef}>
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-primary" />
          Y Distribution
          {isProcessed && (
            <span className="text-[10px] text-muted-foreground font-normal">(processed)</span>
          )}
        </h3>
        <Button variant="ghost" size="sm" className="h-7 px-2" onClick={handleExport}>
          <Download className="w-3 h-3" />
        </Button>
      </div>

      {/* Chart */}
      <div className="flex-1 min-h-0" onClick={handleChartBackgroundClick}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={histogramData} margin={CHART_MARGINS.histogram}>
            <CartesianGrid
              strokeDasharray={CHART_THEME.gridDasharray}
              stroke={CHART_THEME.gridStroke}
              opacity={CHART_THEME.gridOpacity}
            />
            <XAxis
              dataKey="binCenter"
              stroke={CHART_THEME.axisStroke}
              fontSize={CHART_THEME.axisFontSize}
              tickFormatter={(v) => formatYValue(v, 1)}
            />
            <YAxis
              stroke={CHART_THEME.axisStroke}
              fontSize={CHART_THEME.axisFontSize}
              width={30}
              allowDecimals={false}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: CHART_THEME.tooltipBg,
                border: `1px solid ${CHART_THEME.tooltipBorder}`,
                borderRadius: CHART_THEME.tooltipBorderRadius,
                fontSize: CHART_THEME.tooltipFontSize,
              }}
              content={({ payload }) => {
                if (!payload || payload.length === 0) return null;
                const data = payload[0]?.payload as BinData;
                if (!data) return null;

                return (
                  <div className="bg-card border border-border rounded-lg p-2 shadow-lg text-xs">
                    <p className="font-medium">
                      {formatYValue(data.binStart)} - {formatYValue(data.binEnd)}
                    </p>
                    <p className="text-muted-foreground">
                      Count: {data.count} ({((data.count / (stats?.n || 1)) * 100).toFixed(1)}%)
                    </p>
                  </div>
                );
              }}
            />
            <Bar
              dataKey="count"
              radius={[2, 2, 0, 0]}
              onClick={handleClick}
              cursor="pointer"
              {...ANIMATION_CONFIG}
            >
              {histogramData.map((entry, index) => {
                const isSelected = selectedBins.has(index);
                const isHovered = hoveredBin === index;
                const hasSelection = selectedSamples.size > 0;

                // Determine bar color
                let fillColor = 'hsl(var(--primary) / 0.6)';
                if (isHovered) {
                  fillColor = 'hsl(var(--primary))';
                } else if (isSelected) {
                  fillColor = 'hsl(var(--primary))';
                } else if (hasSelection) {
                  fillColor = 'hsl(var(--primary) / 0.2)';
                }

                return (
                  <Cell
                    key={`cell-${index}`}
                    fill={fillColor}
                    stroke={isSelected || isHovered ? 'hsl(var(--primary))' : 'none'}
                    strokeWidth={isSelected || isHovered ? 1 : 0}
                  />
                );
              })}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Statistics footer */}
      <div className="flex items-center justify-between mt-2">
        <div className="grid grid-cols-5 gap-1 text-[10px] flex-1">
          {[
            { label: 'Mean', value: stats.mean },
            { label: 'Med', value: stats.median },
            { label: 'Std', value: stats.std },
            { label: 'Min', value: stats.min },
            { label: 'Max', value: stats.max },
          ].map(({ label, value }) => (
            <div key={label} className="bg-muted rounded p-1 text-center">
              <div className="text-muted-foreground">{label}</div>
              <div className="font-mono font-medium">{formatYValue(value, 1)}</div>
            </div>
          ))}
        </div>
        {selectedSamples.size > 0 && (
          <div className="text-[10px] text-primary font-medium ml-2">
            {selectedSamples.size} sel.
          </div>
        )}
      </div>
    </div>
  );
}

export default YHistogram;
