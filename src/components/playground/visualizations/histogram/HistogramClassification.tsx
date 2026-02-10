/**
 * HistogramClassification - Bar chart for classification/ordinal targets.
 *
 * One bar per class instead of histogram bins.
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
} from 'recharts';
import {
  CHART_THEME,
  CHART_MARGINS,
  ANIMATION_CONFIG,
} from '../chartConfig';
import { getCategoricalColor } from '@/lib/playground/colorConfig';
import type { HistogramChartProps, ClassBarData, RechartsMouseEvent } from './types';

export default function HistogramClassification({
  config,
  yAxisLabel,
  selectionCtx,
  handleMouseLeave,
  handleBarSelection,
  lastMouseEventRef,
  globalColorConfig,
  classBarData,
  selectedClasses,
  hoveredClass,
}: HistogramChartProps) {
  const totalCount = useMemo(() =>
    classBarData.reduce((sum, d) => sum + d.count, 0),
  [classBarData]);

  const chartData = useMemo(() =>
    classBarData.map(bar => ({
      ...bar,
      displayCount: config.yAxisType === 'frequency'
        ? (bar.count / totalCount) * 100
        : bar.count,
    })),
  [classBarData, config.yAxisType, totalCount]);

  // Get class bar color
  const getClassBarColor = useCallback((entry: ClassBarData) => {
    if (globalColorConfig) {
      return getCategoricalColor(entry.classIndex, globalColorConfig.categoricalPalette);
    }
    return getCategoricalColor(entry.classIndex, 'default');
  }, [globalColorConfig]);

  // Handle click for classification chart
  const handleClassChartMouseUp = useCallback((state: RechartsMouseEvent) => {
    const e = lastMouseEventRef.current;

    // Check if click was on a bar
    const target = e?.target as SVGElement | null;
    const isBar = target?.classList?.contains('recharts-rectangle') ||
      target?.closest('.recharts-bar-rectangle') !== null;

    const payload = state?.activePayload;
    if (isBar && payload && payload.length > 0 && payload[0]?.payload) {
      const clickedData = payload[0].payload as unknown as ClassBarData;
      if (clickedData?.samples?.length) {
        handleBarSelection(clickedData.samples, e, selectionCtx);
        return;
      }
    }
    // No bar clicked - clear selection
    if (selectionCtx && selectionCtx.selectedSamples.size > 0) {
      selectionCtx.clear();
    }
  }, [selectionCtx, handleBarSelection, lastMouseEventRef]);

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart
        data={chartData}
        margin={CHART_MARGINS.histogram}
        onMouseUp={handleClassChartMouseUp}
        onMouseLeave={handleMouseLeave}
      >
        <CartesianGrid
          strokeDasharray={CHART_THEME.gridDasharray}
          stroke={CHART_THEME.gridStroke}
          opacity={CHART_THEME.gridOpacity}
        />
        <XAxis
          dataKey="classLabel"
          stroke={CHART_THEME.axisStroke}
          fontSize={CHART_THEME.axisFontSize}
          interval={0}
          tick={{ fontSize: 10 }}
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
            const data = payload[0]?.payload as ClassBarData & { displayCount: number };
            if (!data) return null;

            return (
              <div className="bg-card border border-border rounded-lg p-2 shadow-lg text-xs">
                <p className="font-medium">Class: {data.classLabel}</p>
                <p className="text-muted-foreground">
                  {yAxisLabel}: {data.displayCount.toFixed(config.yAxisType === 'count' ? 0 : 1)}
                  {config.yAxisType === 'count' && ` (${((data.count / totalCount) * 100).toFixed(1)}%)`}
                </p>
              </div>
            );
          }}
        />
        <Bar
          dataKey="displayCount"
          radius={[4, 4, 0, 0]}
          cursor="pointer"
          onMouseEnter={(data: { payload?: ClassBarData }) => {
            if (selectionCtx && data.payload?.samples?.length) {
              selectionCtx.setHovered(data.payload.samples[0]);
            }
          }}
          {...ANIMATION_CONFIG}
        >
          {chartData.map((entry, index) => {
            const isSelected = selectedClasses.has(entry.classIndex);
            const isHovered = hoveredClass === entry.classIndex;
            const fillColor = getClassBarColor(entry);
            return (
              <Cell
                key={`class-cell-${index}`}
                fill={fillColor}
                stroke={isSelected ? 'hsl(var(--foreground))' : isHovered ? 'hsl(var(--primary))' : 'none'}
                strokeWidth={isSelected ? 2.5 : isHovered ? 2 : 0}
              />
            );
          })}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
