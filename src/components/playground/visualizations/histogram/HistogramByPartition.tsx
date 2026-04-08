/**
 * HistogramByPartition - Stacked histogram by train/test partition.
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
  ANIMATION_CONFIG,
  CHART_MARGINS,
  CHART_THEME,
  formatYValue,
} from '../chartConfig';
import {
  getPartitionRoleColor,
  getPartitionRoleLabel,
  getPresentPartitionRoles,
  getSamplePartitionRole,
} from '@/lib/playground/colorConfig';
import { extractModifiers } from '@/lib/playground/selectionUtils';
import {
  computeStackedBarAction,
  executeSelectionAction,
} from '@/lib/playground/selectionHandlers';
import type { HistogramChartProps, RechartsMouseEvent } from './types';
import { RANGE_SELECTION_INITIAL } from './types';
import { findBarRect, isBarElement } from './utils';

export default function HistogramByPartition({
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
  colorContext,
}: HistogramChartProps) {
  const stackSegments = useMemo(() => (
    colorContext
      ? getPresentPartitionRoles(colorContext).map((role) => ({
          key: role,
          label: getPartitionRoleLabel(role),
          color: getPartitionRoleColor(role),
        }))
      : []
  ), [colorContext]);

  // Transform data for partition stacking
  const stackedData = useMemo(() =>
    histogramData.map(bin => {
      const trainSamples: number[] = [];
      const valSamples: number[] = [];
      const testSamples: number[] = [];

      bin.samples.forEach((sampleIdx) => {
        const role = colorContext ? getSamplePartitionRole(sampleIdx, colorContext) : 'unknown';
        if (role === 'train') {
          trainSamples.push(sampleIdx);
        } else if (role === 'val') {
          valSamples.push(sampleIdx);
        } else if (role === 'test') {
          testSamples.push(sampleIdx);
        }
      });

      return {
        binCenter: bin.binCenter,
        binStart: bin.binStart,
        binEnd: bin.binEnd,
        samples: bin.samples,
        label: bin.label,
        train: getYValue(trainSamples.length),
        val: getYValue(valSamples.length),
        test: getYValue(testSamples.length),
        trainCount: trainSamples.length,
        valCount: valSamples.length,
        testCount: testSamples.length,
        trainSamples,
        valSamples,
        testSamples,
      };
    }),
  [histogramData, getYValue, colorContext]);

  // Calculate range selection bounds
  const rangeSelectionBounds = rangeSelection.start !== null && rangeSelection.end !== null
    ? { min: Math.min(rangeSelection.start, rangeSelection.end), max: Math.max(rangeSelection.start, rangeSelection.end) }
    : null;

  // Unified mouseUp handler
  const handleStackedPartitionMouseUp = useCallback((state: RechartsMouseEvent) => {
    const e = lastMouseEventRef.current;

    // 1. Check drag selection first
    if (handleDragSelection(e)) {
      return;
    }
    setRangeSelection(RANGE_SELECTION_INITIAL);

    // 2. Check if click was on a bar
    const target = e?.target as SVGElement | null;

    if (!isBarElement(target)) {
      // Background click - clear selection
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

    const segment = stackSegments.find(item => item.color === clickedFill) ?? stackSegments[0];
    const segmentSamples = segment
      ? (entry[`${segment.key}Samples` as const] as number[] | undefined) ?? []
      : entry.samples;

    // 5. Apply 3-click selection logic
    const modifiers = e ? extractModifiers(e) : { shift: false, ctrl: false };
    const action = computeStackedBarAction(
      { barIndices: entry.samples, segmentIndices: segmentSamples },
      selectionCtx.selectedSamples,
      modifiers
    );
    executeSelectionAction(selectionCtx, action);
  }, [stackSegments, stackedData, handleDragSelection, selectionCtx, lastMouseEventRef, setRangeSelection]);

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart
        data={stackedData}
        margin={CHART_MARGINS.histogram}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleStackedPartitionMouseUp}
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
                {stackSegments.map((segment) => {
                  const count = (data[`${segment.key}Count`] as number | undefined) ?? 0;
                  if (count === 0) return null;
                  return (
                    <p key={segment.key} className="flex items-center gap-1">
                      <span className="w-2 h-2 rounded-sm" style={{ backgroundColor: segment.color }} />
                      {segment.label}: {count}
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
        />
        {stackSegments.map((segment, segmentIdx) => (
          <Bar
            key={segment.key}
            dataKey={segment.key}
            name={segment.label}
            stackId="partition"
            fill={segment.color}
            radius={segmentIdx === stackSegments.length - 1 ? [2, 2, 0, 0] : undefined}
            cursor="pointer"
            {...ANIMATION_CONFIG}
          >
            {stackedData.map((entry, index) => {
              const segmentSamples = (entry[`${segment.key}Samples` as const] as number[] | undefined) ?? [];
              const hasSelectedInSegment = segmentSamples.some(s => selectedSamples.has(s));
              const isHovered = hoveredBin === index;
              return (
                <Cell
                  key={`${segment.key}-${index}`}
                  fill={segment.color}
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
