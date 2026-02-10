/**
 * HistogramSimple - Simple (non-stacked) histogram with KDE and reference lines.
 *
 * Uses ComposedChart to support both bars and KDE line overlay.
 */

import React, { useMemo, useCallback } from 'react';
import {
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  Cell,
  Tooltip,
  ReferenceLine,
  ComposedChart,
  Line,
  Bar,
  ReferenceArea,
} from 'recharts';
import {
  CHART_THEME,
  CHART_MARGINS,
  ANIMATION_CONFIG,
  formatYValue,
} from '../chartConfig';
import type { HistogramChartProps, BinData, RechartsMouseEvent } from './types';
import { RANGE_SELECTION_INITIAL } from './types';

export default function HistogramSimple({
  histogramData,
  stats,
  config,
  yAxisLabel,
  getYValue,
  kdeData,
  selectedBins,
  hoveredBin,
  selectionCtx,
  rangeSelection,
  setRangeSelection,
  handleMouseDown,
  handleMouseMove,
  handleMouseLeave,
  handleDragSelection,
  handleBarSelection,
  lastMouseEventRef,
  getBarColor,
}: HistogramChartProps & { getBarColor: (entry: BinData, index: number) => string }) {
  const chartData = useMemo(() =>
    histogramData.map(bin => ({
      ...bin,
      displayCount: getYValue(bin.count),
    })),
  [histogramData, getYValue]);

  // Merge KDE data - find nearest KDE point for each bin center
  const mergedData = useMemo(() =>
    chartData.map((bin) => {
      let nearestKde: { x: number; density: number } | undefined;
      let minDist = Infinity;
      for (const kp of kdeData) {
        const dist = Math.abs(kp.x - bin.binCenter);
        if (dist < minDist) {
          minDist = dist;
          nearestKde = kp;
        }
      }
      const kdeValue = nearestKde ? getYValue(nearestKde.density) : undefined;
      return {
        ...bin,
        kde: kdeValue,
      };
    }),
  [chartData, kdeData, getYValue]);

  // Calculate range selection bounds for ReferenceArea
  const rangeSelectionBounds = rangeSelection.start !== null && rangeSelection.end !== null
    ? { min: Math.min(rangeSelection.start, rangeSelection.end), max: Math.max(rangeSelection.start, rangeSelection.end) }
    : null;

  // Handle click/mouseup interactions on simple (non-stacked) charts
  const handleMouseUp = useCallback((state: RechartsMouseEvent) => {
    const e = lastMouseEventRef.current;

    // Check if this was a drag selection
    if (handleDragSelection(e)) {
      return;
    }

    // Reset range selection state
    setRangeSelection(RANGE_SELECTION_INITIAL);

    // Check if click was on a bar
    const target = e?.target as SVGElement | null;
    const isBar = target?.classList?.contains('recharts-rectangle') ||
      target?.closest('.recharts-bar-rectangle') !== null;

    // Get clicked bar data from Recharts state
    const payload = state?.activePayload;

    if (isBar && payload && payload.length > 0 && payload[0]?.payload) {
      const clickedData = payload[0].payload as BinData;
      if (clickedData?.samples?.length) {
        handleBarSelection(clickedData.samples, e, selectionCtx);
      }
    }
  }, [handleDragSelection, selectionCtx, handleBarSelection, lastMouseEventRef, setRangeSelection]);

  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart
        data={mergedData}
        margin={CHART_MARGINS.histogram}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
      >
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
          width={35}
          allowDecimals={config.yAxisType !== 'count'}
          label={{
            value: yAxisLabel,
            angle: -90,
            position: 'insideLeft',
            fontSize: 9,
          }}
        />
        <Tooltip
          isAnimationActive={false}
          contentStyle={{
            backgroundColor: CHART_THEME.tooltipBg,
            border: `1px solid ${CHART_THEME.tooltipBorder}`,
            borderRadius: CHART_THEME.tooltipBorderRadius,
            fontSize: CHART_THEME.tooltipFontSize,
          }}
          content={({ payload }) => {
            if (!payload || payload.length === 0) return null;
            const data = payload[0]?.payload as BinData & { displayCount: number };
            if (!data) return null;

            return (
              <div className="bg-card border border-border rounded-lg p-2 shadow-lg text-xs">
                <p className="font-medium">{data.label}</p>
                <p className="text-muted-foreground">
                  {yAxisLabel}: {data.displayCount.toFixed(config.yAxisType === 'count' ? 0 : 2)}
                  {config.yAxisType === 'count' && ` (${((data.count / stats.n) * 100).toFixed(1)}%)`}
                </p>
              </div>
            );
          }}
        />

        {/* ±1σ bands */}
        {config.showStdBands && stats && (
          <>
            <ReferenceLine
              x={stats.mean - stats.std}
              stroke="hsl(var(--muted-foreground))"
              strokeDasharray="3 3"
              strokeOpacity={0.5}
            />
            <ReferenceLine
              x={stats.mean + stats.std}
              stroke="hsl(var(--muted-foreground))"
              strokeDasharray="3 3"
              strokeOpacity={0.5}
            />
          </>
        )}

        {/* Range selection overlay */}
        {rangeSelectionBounds && (
          <ReferenceArea
            x1={rangeSelectionBounds.min}
            x2={rangeSelectionBounds.max}
            fill="hsl(var(--primary))"
            fillOpacity={0.15}
            stroke="hsl(var(--primary))"
            strokeOpacity={0.5}
            strokeWidth={1}
            strokeDasharray="4 2"
          />
        )}

        {/* Mean reference line */}
        {config.showMean && stats && (
          <ReferenceLine
            x={stats.mean}
            stroke="hsl(217, 70%, 50%)"
            strokeWidth={2}
            label={{
              value: 'μ',
              position: 'top',
              fontSize: 10,
              fill: 'hsl(217, 70%, 50%)',
            }}
          />
        )}

        {/* Median reference line */}
        {config.showMedian && stats && (
          <ReferenceLine
            x={stats.median}
            stroke="hsl(142, 70%, 45%)"
            strokeWidth={2}
            strokeDasharray="5 5"
            label={{
              value: 'Med',
              position: 'top',
              fontSize: 10,
              fill: 'hsl(142, 70%, 45%)',
            }}
          />
        )}

        {/* Histogram bars */}
        <Bar
          dataKey="displayCount"
          radius={[2, 2, 0, 0]}
          cursor="pointer"
          {...ANIMATION_CONFIG}
        >
          {mergedData.map((entry, index) => {
            const isSelected = selectedBins.has(index);
            const isHovered = hoveredBin === index;
            const fillColor = getBarColor(entry, index);
            return (
              <Cell
                key={`cell-${index}`}
                fill={fillColor}
                stroke={isSelected ? 'hsl(var(--foreground))' : isHovered ? 'hsl(var(--primary))' : 'none'}
                strokeWidth={isSelected ? 2.5 : isHovered ? 2 : 0}
              />
            );
          })}
        </Bar>

        {/* KDE overlay */}
        {config.showKDE && (
          <Line
            dataKey="kde"
            type="monotone"
            stroke="hsl(280, 65%, 55%)"
            strokeWidth={2}
            dot={false}
            connectNulls
            {...ANIMATION_CONFIG}
          />
        )}
      </ComposedChart>
    </ResponsiveContainer>
  );
}
