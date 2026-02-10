/**
 * HistogramByFold - Stacked histogram by cross-validation fold.
 */

import React, { useMemo, useCallback } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  Cell,
  Tooltip,
  Legend,
  ReferenceArea,
} from 'recharts';
import {
  CHART_THEME,
  CHART_MARGINS,
  ANIMATION_CONFIG,
  formatYValue,
} from '../chartConfig';
import { getCategoricalColor } from '@/lib/playground/colorConfig';
import { extractModifiers } from '@/lib/playground/selectionUtils';
import {
  computeStackedBarAction,
  executeSelectionAction,
} from '@/lib/playground/selectionHandlers';
import type { HistogramChartProps, RechartsMouseEvent } from './types';
import { RANGE_SELECTION_INITIAL } from './types';
import { findBarRect, isBarElement } from './utils';

export default function HistogramByFold({
  histogramData,
  config,
  yAxisLabel,
  getYValue,
  selectedSamples,
  hoveredBin,
  selectionCtx,
  rangeSelection,
  setRangeSelection,
  handleMouseDown,
  handleMouseMove,
  handleMouseLeave,
  handleDragSelection,
  lastMouseEventRef,
  globalColorConfig,
  uniqueFolds,
}: HistogramChartProps) {
  const palette = globalColorConfig?.categoricalPalette ?? 'default';

  // Transform data for fold stacking
  const stackedData = useMemo(() =>
    histogramData.map(bin => {
      const row: Record<string, unknown> = {
        binCenter: bin.binCenter,
        binStart: bin.binStart,
        binEnd: bin.binEnd,
        samples: bin.samples,
        label: bin.label,
      };
      uniqueFolds.forEach(foldIdx => {
        row[`fold${foldIdx}`] = getYValue(bin.foldCounts?.[foldIdx] || 0);
        row[`fold${foldIdx}Samples`] = bin.foldSamples?.[foldIdx] || [];
      });
      return row;
    }),
  [histogramData, getYValue, uniqueFolds]);

  // Calculate range selection bounds
  const rangeSelectionBounds = rangeSelection.start !== null && rangeSelection.end !== null
    ? { min: Math.min(rangeSelection.start, rangeSelection.end), max: Math.max(rangeSelection.start, rangeSelection.end) }
    : null;

  // Unified mouseUp handler
  const handleStackedFoldMouseUp = useCallback((state: RechartsMouseEvent) => {
    const e = lastMouseEventRef.current;

    // 1. Check drag selection first
    if (handleDragSelection(e)) {
      return;
    }
    setRangeSelection(RANGE_SELECTION_INITIAL);

    // 2. Check if click was on a bar
    const target = e?.target as SVGElement | null;

    if (!isBarElement(target)) {
      if (selectionCtx && selectionCtx.selectedSamples.size > 0) {
        selectionCtx.clear();
      }
      return;
    }

    // 3. Get clicked bar data from Recharts state
    const activeIndex = state?.activeTooltipIndex;
    if (activeIndex === undefined || activeIndex < 0 || activeIndex >= stackedData.length) {
      return;
    }
    const entry = stackedData[activeIndex];
    if (!entry || !selectionCtx) return;

    // 4. Detect which fold segment was clicked
    const barRect = findBarRect(e, target);
    const clickedFill = barRect?.getAttribute('fill') || '';

    // Find which fold has this color
    let clickedFoldIdx = uniqueFolds[0];
    for (const foldIdx of uniqueFolds) {
      if (getCategoricalColor(foldIdx, palette) === clickedFill) {
        clickedFoldIdx = foldIdx;
        break;
      }
    }

    const barSamples = entry.samples as number[];
    const segmentSamples = (entry[`fold${clickedFoldIdx}Samples`] as number[] | undefined) ?? [];

    // 5. Apply 3-click selection logic
    const modifiers = e ? extractModifiers(e) : { shift: false, ctrl: false };
    const action = computeStackedBarAction(
      { barIndices: barSamples, segmentIndices: segmentSamples },
      selectionCtx.selectedSamples,
      modifiers
    );
    executeSelectionAction(selectionCtx, action);
  }, [stackedData, handleDragSelection, selectionCtx, lastMouseEventRef, setRangeSelection, uniqueFolds, palette]);

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart
        data={stackedData}
        margin={CHART_MARGINS.histogram}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleStackedFoldMouseUp}
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
            const data = payload[0]?.payload;
            if (!data) return null;

            return (
              <div className="bg-card border border-border rounded-lg p-2 shadow-lg text-xs">
                <p className="font-medium">{data.label}</p>
                {uniqueFolds.map(foldIdx => {
                  const count = data[`fold${foldIdx}`] || 0;
                  if (count === 0) return null;
                  return (
                    <p key={foldIdx} className="flex items-center gap-1">
                      <span
                        className="w-2 h-2 rounded-sm"
                        style={{ backgroundColor: getCategoricalColor(foldIdx, palette) }}
                      />
                      Fold {foldIdx + 1}: {typeof count === 'number' ? count.toFixed(config.yAxisType === 'count' ? 0 : 2) : count}
                    </p>
                  );
                })}
              </div>
            );
          }}
        />
        <Legend
          verticalAlign="top"
          height={24}
          iconSize={10}
          formatter={(value) => (
            <span className="text-[10px]">
              {value.replace('fold', 'Fold ').replace(/(\d+)/, (m: string) => String(Number(m) + 1))}
            </span>
          )}
        />
        {uniqueFolds.map(foldIdx => (
          <Bar
            key={`fold-${foldIdx}`}
            dataKey={`fold${foldIdx}`}
            name={`fold${foldIdx}`}
            stackId="folds"
            fill={getCategoricalColor(foldIdx, palette)}
            radius={foldIdx === uniqueFolds[uniqueFolds.length - 1] ? [2, 2, 0, 0] : undefined}
            cursor="pointer"
            {...ANIMATION_CONFIG}
          >
            {stackedData.map((entry, index) => {
              const segmentSamples = (entry[`fold${foldIdx}Samples`] as number[] | undefined) ?? [];
              const hasSelectedInSegment = segmentSamples.some(s => selectedSamples.has(s));
              const isHovered = hoveredBin === index;
              return (
                <Cell
                  key={`fold-${foldIdx}-${index}`}
                  fill={getCategoricalColor(foldIdx, palette)}
                  stroke={hasSelectedInSegment ? 'hsl(var(--foreground))' : isHovered ? 'hsl(var(--primary))' : 'none'}
                  strokeWidth={hasSelectedInSegment ? 2.5 : isHovered ? 2 : 0}
                />
              );
            })}
          </Bar>
        ))}
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
      </BarChart>
    </ResponsiveContainer>
  );
}
