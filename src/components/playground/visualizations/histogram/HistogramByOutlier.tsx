/**
 * HistogramByOutlier - Stacked histogram by outlier membership.
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
import { HIGHLIGHT_COLORS } from '@/lib/playground/colorConfig';
import { extractModifiers } from '@/lib/playground/selectionUtils';
import {
  computeStackedBarAction,
  executeSelectionAction,
} from '@/lib/playground/selectionHandlers';
import type { HistogramChartProps, RechartsMouseEvent } from './types';
import { RANGE_SELECTION_INITIAL } from './types';
import { findBarRect, isBarElement } from './utils';

const NORMAL_FILL = 'hsl(var(--muted-foreground) / 0.4)';

export default function HistogramByOutlier({
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
  colorContext,
}: HistogramChartProps) {
  const outlierIndices = colorContext?.outlierIndices;

  const stackedData = useMemo(() =>
    histogramData.map((bin) => {
      const outlierSamples = bin.samples.filter((sampleIndex) => outlierIndices?.has(sampleIndex));
      const normalSamples = bin.samples.filter((sampleIndex) => !outlierIndices?.has(sampleIndex));
      return {
        binCenter: bin.binCenter,
        binStart: bin.binStart,
        binEnd: bin.binEnd,
        samples: bin.samples,
        label: bin.label,
        normal: getYValue(normalSamples.length),
        outlier: getYValue(outlierSamples.length),
        normalCount: normalSamples.length,
        outlierCount: outlierSamples.length,
        normalSamples,
        outlierSamples,
      };
    }),
  [histogramData, getYValue, outlierIndices]);

  const rangeSelectionBounds = rangeSelection.start !== null && rangeSelection.end !== null
    ? { min: Math.min(rangeSelection.start, rangeSelection.end), max: Math.max(rangeSelection.start, rangeSelection.end) }
    : null;

  const handleStackedOutlierMouseUp = useCallback((state: RechartsMouseEvent) => {
    const e = lastMouseEventRef.current;

    if (handleDragSelection(e)) {
      return;
    }
    setRangeSelection(RANGE_SELECTION_INITIAL);

    const target = e?.target as SVGElement | null;

    if (!isBarElement(target)) {
      if (selectionCtx && selectionCtx.selectedSamples.size > 0) {
        selectionCtx.clear();
      }
      return;
    }

    const activeIndex = state?.activeTooltipIndex;
    if (activeIndex === undefined || activeIndex < 0 || activeIndex >= stackedData.length) {
      return;
    }
    const entry = stackedData[activeIndex];
    if (!entry || !selectionCtx) return;

    const barRect = findBarRect(e, target);
    const clickedFill = barRect?.getAttribute('fill') || '';
    const isOutlierSegment = clickedFill === HIGHLIGHT_COLORS.outlier;
    const segmentSamples = isOutlierSegment ? entry.outlierSamples : entry.normalSamples;

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
        onMouseUp={handleStackedOutlierMouseUp}
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
          tickFormatter={(value) => formatYValue(value, 1)}
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
                {data.normalCount > 0 && (
                  <p className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-sm" style={{ backgroundColor: NORMAL_FILL }} />
                    Normal: {data.normalCount}
                  </p>
                )}
                {data.outlierCount > 0 && (
                  <p className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-sm" style={{ backgroundColor: HIGHLIGHT_COLORS.outlier }} />
                    Outliers: {data.outlierCount}
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
          dataKey="normal"
          name="Normal"
          stackId="outlier"
          fill={NORMAL_FILL}
          cursor="pointer"
          {...ANIMATION_CONFIG}
        >
          {stackedData.map((entry, index) => {
            const hasSelectedInSegment = entry.normalSamples.some((sampleIndex: number) => selectedSamples.has(sampleIndex));
            const isHovered = hoveredBin === index;
            return (
              <Cell
                key={`normal-${index}`}
                fill={NORMAL_FILL}
                stroke={hasSelectedInSegment ? 'hsl(var(--foreground))' : isHovered ? 'hsl(var(--primary))' : 'none'}
                strokeWidth={hasSelectedInSegment ? 2.5 : isHovered ? 2 : 0}
              />
            );
          })}
        </Bar>
        <Bar
          dataKey="outlier"
          name="Outliers"
          stackId="outlier"
          fill={HIGHLIGHT_COLORS.outlier}
          radius={[2, 2, 0, 0]}
          cursor="pointer"
          {...ANIMATION_CONFIG}
        >
          {stackedData.map((entry, index) => {
            const hasSelectedInSegment = entry.outlierSamples.some((sampleIndex: number) => selectedSamples.has(sampleIndex));
            const isHovered = hoveredBin === index;
            return (
              <Cell
                key={`outlier-${index}`}
                fill={HIGHLIGHT_COLORS.outlier}
                stroke={hasSelectedInSegment ? 'hsl(var(--foreground))' : isHovered ? 'hsl(var(--primary))' : 'none'}
                strokeWidth={hasSelectedInSegment ? 2.5 : isHovered ? 2 : 0}
              />
            );
          })}
        </Bar>
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