/**
 * HistogramByMetadata - Stacked histogram by metadata category.
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

export default function HistogramByMetadata({
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
  globalColorConfig,
  metadata,
  metadataCategories,
}: HistogramChartProps) {
  const palette = globalColorConfig?.categoricalPalette ?? 'default';
  const metadataKey = globalColorConfig?.metadataKey;
  const metadataValues = metadataKey && metadata?.[metadataKey] ? metadata[metadataKey] : null;

  // Transform data for metadata category stacking
  const stackedData = useMemo(() => {
    if (!metadataValues) return [];
    return histogramData.map(bin => {
      const row: Record<string, unknown> = {
        binCenter: bin.binCenter,
        binStart: bin.binStart,
        binEnd: bin.binEnd,
        samples: bin.samples,
        label: bin.label,
      };
      metadataCategories.forEach((category, catIdx) => {
        const categorySamples = bin.samples.filter(sampleIdx => String(metadataValues[sampleIdx]) === category);
        row[`cat${catIdx}`] = getYValue(categorySamples.length);
        row[`cat${catIdx}Count`] = categorySamples.length;
        row[`cat${catIdx}Label`] = category;
        row[`cat${catIdx}Samples`] = categorySamples;
      });
      return row;
    });
  }, [histogramData, getYValue, metadataValues, metadataCategories]);

  // Calculate range selection bounds
  const rangeSelectionBounds = rangeSelection.start !== null && rangeSelection.end !== null
    ? { min: Math.min(rangeSelection.start, rangeSelection.end), max: Math.max(rangeSelection.start, rangeSelection.end) }
    : null;

  // Unified mouseUp handler
  const handleStackedMetadataMouseUp = useCallback((state: RechartsMouseEvent) => {
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

    // 4. Detect which category segment was clicked
    const barRect = findBarRect(e, target);
    const clickedFill = barRect?.getAttribute('fill') || '';

    // Find which category has this color
    let clickedCatIdx = 0;
    for (let catIdx = 0; catIdx < metadataCategories.length; catIdx++) {
      if (getCategoricalColor(catIdx, palette) === clickedFill) {
        clickedCatIdx = catIdx;
        break;
      }
    }

    const barSamples = entry.samples as number[];
    const segmentSamples = (entry[`cat${clickedCatIdx}Samples`] as number[] | undefined) ?? [];

    // 5. Apply 3-click selection logic
    const modifiers = e ? extractModifiers(e) : { shift: false, ctrl: false };
    const action = computeStackedBarAction(
      { barIndices: barSamples, segmentIndices: segmentSamples },
      selectionCtx.selectedSamples,
      modifiers
    );
    executeSelectionAction(selectionCtx, action);
  }, [stackedData, handleDragSelection, selectionCtx, lastMouseEventRef, setRangeSelection, metadataCategories, palette]);

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart
        data={stackedData}
        margin={CHART_MARGINS.histogram}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleStackedMetadataMouseUp}
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
                {metadataCategories.map((category, catIdx) => {
                  const count = data[`cat${catIdx}Count`] || 0;
                  if (count === 0) return null;
                  return (
                    <p key={catIdx} className="flex items-center gap-1">
                      <span
                        className="w-2 h-2 rounded-sm"
                        style={{ backgroundColor: getCategoricalColor(catIdx, palette) }}
                      />
                      {category}: {count}
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
          formatter={(value) => {
            const idx = parseInt(value.replace('cat', ''), 10);
            return <span className="text-[10px]">{metadataCategories[idx] ?? value}</span>;
          }}
        />
        {metadataCategories.map((category, catIdx) => (
          <Bar
            key={`cat-${catIdx}`}
            dataKey={`cat${catIdx}`}
            name={`cat${catIdx}`}
            stackId="metadata"
            fill={getCategoricalColor(catIdx, palette)}
            radius={catIdx === metadataCategories.length - 1 ? [2, 2, 0, 0] : undefined}
            cursor="pointer"
            {...ANIMATION_CONFIG}
          >
            {stackedData.map((entry, index) => {
              const segmentSamples = (entry[`cat${catIdx}Samples`] as number[] | undefined) ?? [];
              const hasSelectedInSegment = segmentSamples.some(s => selectedSamples.has(s));
              const isHovered = hoveredBin === index;
              return (
                <Cell
                  key={`cat-${catIdx}-${index}`}
                  fill={getCategoricalColor(catIdx, palette)}
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
