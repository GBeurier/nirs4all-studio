/**
 * HistogramBySelection - Stacked histogram by selected/unselected state.
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
  formatYValue,
} from '../chartConfig';
import { HIGHLIGHT_COLORS } from '@/lib/playground/colorConfig';
import { extractModifiers } from '@/lib/playground/selectionUtils';
import {
  computeStackedBarAction,
  executeSelectionAction,
} from '@/lib/playground/selectionHandlers';
import type { HistogramChartProps, RechartsMouseEvent } from './types';
import { RANGE_SELECTION_INITIAL } from './types';
import { findBarRect, isBarElement } from './utils';

export default function HistogramBySelection({
  histogramData,
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
}: HistogramChartProps) {
  // Transform data for selection stacking
  const stackedData = useMemo(() =>
    histogramData.map(bin => {
      const selectedSamplesInBin = bin.samples.filter(s => selectedSamples.has(s));
      const unselectedSamplesInBin = bin.samples.filter(s => !selectedSamples.has(s));
      return {
        binCenter: bin.binCenter,
        binStart: bin.binStart,
        binEnd: bin.binEnd,
        samples: bin.samples,
        label: bin.label,
        selected: getYValue(selectedSamplesInBin.length),
        unselected: getYValue(unselectedSamplesInBin.length),
        selectedCount: selectedSamplesInBin.length,
        unselectedCount: unselectedSamplesInBin.length,
        selectedSamples: selectedSamplesInBin,
        unselectedSamples: unselectedSamplesInBin,
      };
    }),
  [histogramData, getYValue, selectedSamples]);

  // Calculate range selection bounds
  const rangeSelectionBounds = rangeSelection.start !== null && rangeSelection.end !== null
    ? { min: Math.min(rangeSelection.start, rangeSelection.end), max: Math.max(rangeSelection.start, rangeSelection.end) }
    : null;

  // Unified mouseUp handler
  const handleStackedSelectionMouseUp = useCallback((state: RechartsMouseEvent) => {
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

    // 4. Detect which segment was clicked
    const barRect = findBarRect(e, target);
    const clickedFill = barRect?.getAttribute('fill') || '';

    // Determine segment based on fill color
    const isSelectedSegment = clickedFill === HIGHLIGHT_COLORS.selected;
    const segmentSamples = isSelectedSegment ? entry.selectedSamples : entry.unselectedSamples;

    // 5. Apply 3-click selection logic
    const modifiers = e ? extractModifiers(e) : { shift: false, ctrl: false };
    const action = computeStackedBarAction(
      { barIndices: entry.samples, segmentIndices: segmentSamples },
      selectionCtx.selectedSamples,
      modifiers
    );
    executeSelectionAction(selectionCtx, action);
  }, [stackedData, handleDragSelection, selectionCtx, lastMouseEventRef, setRangeSelection]);

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart
        data={stackedData}
        margin={CHART_MARGINS.histogram}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleStackedSelectionMouseUp}
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
                {data.selectedCount > 0 && (
                  <p className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-sm" style={{ backgroundColor: HIGHLIGHT_COLORS.selected }} />
                    Selected: {data.selectedCount}
                  </p>
                )}
                {data.unselectedCount > 0 && (
                  <p className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-sm" style={{ backgroundColor: 'hsl(var(--muted-foreground) / 0.4)' }} />
                    Unselected: {data.unselectedCount}
                  </p>
                )}
              </div>
            );
          }}
        />
        <Legend
          verticalAlign="top"
          height={24}
          iconSize={10}
        />
        <Bar
          dataKey="unselected"
          name="Unselected"
          stackId="selection"
          fill="hsl(var(--muted-foreground) / 0.4)"
          cursor="pointer"
          isAnimationActive={false}
        >
          {stackedData.map((entry, index) => {
            const hasSelectedInSegment = entry.unselectedSamples.some(s => selectedSamples.has(s));
            const isHovered = hoveredBin === index;
            return (
              <Cell
                key={`unselected-${index}`}
                fill="hsl(var(--muted-foreground) / 0.4)"
                stroke={hasSelectedInSegment ? 'hsl(var(--foreground))' : isHovered ? 'hsl(var(--primary))' : 'none'}
                strokeWidth={hasSelectedInSegment ? 2.5 : isHovered ? 2 : 0}
              />
            );
          })}
        </Bar>
        <Bar
          dataKey="selected"
          name="Selected"
          stackId="selection"
          fill={HIGHLIGHT_COLORS.selected}
          radius={[2, 2, 0, 0]}
          cursor="pointer"
          isAnimationActive={false}
        >
          {stackedData.map((entry, index) => {
            const hasSelectedInSegment = entry.selectedSamples.some(s => selectedSamples.has(s));
            const isHovered = hoveredBin === index;
            return (
              <Cell
                key={`selected-${index}`}
                fill={HIGHLIGHT_COLORS.selected}
                stroke={hasSelectedInSegment ? 'hsl(var(--foreground))' : isHovered ? 'hsl(var(--primary))' : 'none'}
                strokeWidth={hasSelectedInSegment ? 2.5 : isHovered ? 2 : 0}
              />
            );
          })}
        </Bar>
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
