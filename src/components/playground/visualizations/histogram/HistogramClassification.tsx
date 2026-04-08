/**
 * HistogramClassification - Classification/ordinal bar chart with full color-mode support.
 *
 * Uses one bar per class and preserves stacked coloring for partition, fold,
 * metadata, outlier, and selection modes.
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
} from 'recharts';
import {
  CHART_THEME,
  CHART_MARGINS,
  ANIMATION_CONFIG,
} from '../chartConfig';
import {
  getCategoricalColor,
  getContinuousColor,
  normalizeValue,
  detectMetadataType,
  PARTITION_COLORS,
  HIGHLIGHT_COLORS,
} from '@/lib/playground/colorConfig';
import { extractModifiers } from '@/lib/playground/selectionUtils';
import {
  computeStackedBarAction,
  executeSelectionAction,
} from '@/lib/playground/selectionHandlers';
import { findBarRect, isBarElement } from './utils';
import type { HistogramChartProps, ClassBarData, RechartsMouseEvent } from './types';

const UNSELECTED_FILL = 'hsl(var(--muted-foreground) / 0.4)';

interface StackSegment {
  key: string;
  label: string;
  color: string;
  getSamples: (bar: ClassBarData) => number[];
}

type ChartRow = ClassBarData & {
  displayCount: number;
  [key: string]: unknown;
};

function formatSegmentValue(
  count: number,
  total: number,
  yAxisType: HistogramChartProps["config"]["yAxisType"],
): string {
  if (yAxisType === 'count') {
    const percent = total > 0 ? ` (${((count / total) * 100).toFixed(1)}%)` : '';
    return `${count}${percent}`;
  }

  const percent = total > 0 ? (count / total) * 100 : 0;
  return `${percent.toFixed(1)}%`;
}

export default function HistogramClassification({
  config,
  yAxisLabel,
  selectionCtx,
  handleMouseLeave,
  handleBarSelection,
  lastMouseEventRef,
  globalColorConfig,
  colorContext,
  classBarData,
  selectedClasses,
  hoveredClass,
  selectedSamples,
  uniqueFolds,
  metadata,
  metadataCategories,
}: HistogramChartProps) {
  const totalCount = useMemo(
    () => classBarData.reduce((sum, bar) => sum + bar.count, 0),
    [classBarData],
  );

  const metadataKey = globalColorConfig?.metadataKey;
  const metadataValues = metadataKey && metadata?.[metadataKey] ? metadata[metadataKey] : null;
  const metadataType = useMemo(() => {
    if (!metadataValues) return null;
    return globalColorConfig?.metadataType ?? detectMetadataType(metadataValues);
  }, [globalColorConfig?.metadataType, metadataValues]);

  const stackSegments = useMemo<StackSegment[]>(() => {
    switch (globalColorConfig?.mode) {
      case 'partition':
        if (colorContext?.trainIndices && colorContext?.testIndices) {
          return [
            {
              key: 'train',
              label: 'Train',
              color: PARTITION_COLORS.train,
              getSamples: (bar) => bar.samples.filter((sampleIdx) => colorContext.trainIndices?.has(sampleIdx)),
            },
            {
              key: 'test',
              label: 'Test',
              color: PARTITION_COLORS.test,
              getSamples: (bar) => bar.samples.filter((sampleIdx) => colorContext.testIndices?.has(sampleIdx)),
            },
          ];
        }
        return [];

      case 'fold':
        return uniqueFolds.map((foldIdx) => ({
          key: `fold${foldIdx}`,
          label: `Fold ${foldIdx + 1}`,
          color: getCategoricalColor(foldIdx, globalColorConfig?.categoricalPalette ?? 'default'),
          getSamples: (bar) => bar.foldSamples?.[foldIdx] ?? [],
        }));

      case 'outlier':
        if ((colorContext?.outlierIndices?.size ?? 0) > 0) {
          return [
            {
              key: 'normal',
              label: 'Normal',
              color: UNSELECTED_FILL,
              getSamples: (bar) => bar.samples.filter((sampleIdx) => !colorContext.outlierIndices?.has(sampleIdx)),
            },
            {
              key: 'outlier',
              label: 'Outliers',
              color: HIGHLIGHT_COLORS.outlier,
              getSamples: (bar) => bar.samples.filter((sampleIdx) => colorContext.outlierIndices?.has(sampleIdx)),
            },
          ];
        }
        return [];

      case 'selection':
        return [
          {
            key: 'unselected',
            label: 'Unselected',
            color: UNSELECTED_FILL,
            getSamples: (bar) => bar.samples.filter((sampleIdx) => !selectedSamples.has(sampleIdx)),
          },
          {
            key: 'selected',
            label: 'Selected',
            color: HIGHLIGHT_COLORS.selected,
            getSamples: (bar) => bar.samples.filter((sampleIdx) => selectedSamples.has(sampleIdx)),
          },
        ];

      case 'metadata':
        if (metadataType === 'categorical' && metadataValues && metadataCategories.length > 0) {
          return metadataCategories.map((category, categoryIdx) => ({
            key: `cat${categoryIdx}`,
            label: category,
            color: getCategoricalColor(categoryIdx, globalColorConfig?.categoricalPalette ?? 'default'),
            getSamples: (bar) => bar.samples.filter((sampleIdx) => String(metadataValues[sampleIdx]) === category),
          }));
        }
        return [];

      default:
        return [];
    }
  }, [
    globalColorConfig?.mode,
    globalColorConfig?.categoricalPalette,
    colorContext,
    uniqueFolds,
    selectedSamples,
    metadataType,
    metadataValues,
    metadataCategories,
  ]);

  const chartData = useMemo<ChartRow[]>(() => {
    return classBarData.map((bar) => {
      const row: ChartRow = {
        ...bar,
        displayCount: config.yAxisType === 'frequency' && totalCount > 0
          ? (bar.count / totalCount) * 100
          : bar.count,
      };

      stackSegments.forEach((segment) => {
        const segmentSamples = segment.getSamples(bar);
        row[segment.key] = config.yAxisType === 'frequency' && totalCount > 0
          ? (segmentSamples.length / totalCount) * 100
          : segmentSamples.length;
        row[`${segment.key}Count`] = segmentSamples.length;
        row[`${segment.key}Samples`] = segmentSamples;
      });

      return row;
    });
  }, [classBarData, config.yAxisType, stackSegments, totalCount]);

  const getClassBarColor = useCallback((entry: ClassBarData) => {
    const mode = globalColorConfig?.mode ?? 'target';

    switch (mode) {
      case 'index': {
        const avgIndex = entry.samples.length > 0
          ? entry.samples.reduce((sum, sampleIdx) => sum + sampleIdx, 0) / entry.samples.length
          : 0;
        const totalSamples = colorContext?.totalSamples ?? Math.max(1, entry.samples.length);
        return getContinuousColor(
          avgIndex / Math.max(1, totalSamples - 1),
          globalColorConfig?.continuousPalette ?? 'blue_red',
        );
      }

      case 'metadata':
        if (metadataType === 'continuous' && metadataValues && entry.samples.length > 0) {
          const numericValues = metadataValues.filter((value) => typeof value === 'number') as number[];
          if (numericValues.length > 0) {
            const average = entry.samples.reduce((sum, sampleIdx) => {
              const value = metadataValues[sampleIdx];
              return sum + (typeof value === 'number' ? value : 0);
            }, 0) / entry.samples.length;

            return getContinuousColor(
              normalizeValue(average, Math.min(...numericValues), Math.max(...numericValues)),
              globalColorConfig?.continuousPalette ?? 'blue_red',
            );
          }
        }
        break;

      case 'partition': {
        const trainCount = entry.samples.filter((sampleIdx) => colorContext?.trainIndices?.has(sampleIdx)).length;
        const testCount = entry.samples.filter((sampleIdx) => colorContext?.testIndices?.has(sampleIdx)).length;
        if (trainCount > testCount) return PARTITION_COLORS.train;
        if (testCount > trainCount) return PARTITION_COLORS.test;
        break;
      }

      case 'fold': {
        let dominantFold = -1;
        let dominantCount = 0;
        Object.entries(entry.foldCounts ?? {}).forEach(([foldKey, count]) => {
          if (count > dominantCount) {
            dominantFold = Number(foldKey);
            dominantCount = count;
          }
        });
        if (dominantFold >= 0) {
          return getCategoricalColor(dominantFold, globalColorConfig?.categoricalPalette ?? 'default');
        }
        break;
      }

      case 'outlier': {
        const outlierCount = entry.samples.filter((sampleIdx) => colorContext?.outlierIndices?.has(sampleIdx)).length;
        return outlierCount > entry.samples.length / 2 ? HIGHLIGHT_COLORS.outlier : UNSELECTED_FILL;
      }

      case 'selection':
        return entry.samples.some((sampleIdx) => selectedSamples.has(sampleIdx))
          ? HIGHLIGHT_COLORS.selected
          : UNSELECTED_FILL;

      default:
        break;
    }

    return getCategoricalColor(
      entry.classIndex,
      globalColorConfig?.categoricalPalette ?? 'default',
    );
  }, [globalColorConfig, colorContext, metadataType, metadataValues, selectedSamples]);

  const handleClassChartMouseUp = useCallback((state: RechartsMouseEvent) => {
    const nativeEvent = lastMouseEventRef.current;
    const target = nativeEvent?.target as SVGElement | null;

    if (!isBarElement(target)) {
      if (selectionCtx && selectionCtx.selectedSamples.size > 0) {
        selectionCtx.clear();
      }
      return;
    }

    const activeIndex = state?.activeTooltipIndex;
    if (activeIndex === undefined || activeIndex < 0 || activeIndex >= chartData.length) {
      return;
    }

    const clickedBar = chartData[activeIndex];
    if (!clickedBar?.samples?.length) {
      return;
    }

    if (stackSegments.length > 0 && selectionCtx) {
      const clickedFill = findBarRect(nativeEvent, target)?.getAttribute('fill') || '';
      const segment = stackSegments.find((item) => item.color === clickedFill) ?? stackSegments[0];
      const segmentSamples = (clickedBar[`${segment.key}Samples`] as number[] | undefined) ?? [];
      const modifiers = nativeEvent ? extractModifiers(nativeEvent) : { shift: false, ctrl: false };
      const action = computeStackedBarAction(
        { barIndices: clickedBar.samples, segmentIndices: segmentSamples },
        selectionCtx.selectedSamples,
        modifiers,
      );
      executeSelectionAction(selectionCtx, action);
      return;
    }

    handleBarSelection(clickedBar.samples, nativeEvent, selectionCtx);
  }, [chartData, handleBarSelection, lastMouseEventRef, selectionCtx, stackSegments]);

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

            const data = payload[0]?.payload as ChartRow | undefined;
            if (!data) return null;

            return (
              <div className="bg-card border border-border rounded-lg p-2 shadow-lg text-xs">
                <p className="font-medium">Class: {data.classLabel}</p>
                {stackSegments.length > 0 ? (
                  stackSegments.map((segment) => {
                    const count = (data[`${segment.key}Count`] as number | undefined) ?? 0;
                    if (count === 0) return null;

                    return (
                      <p key={segment.key} className="flex items-center gap-1">
                        <span
                          className="w-2 h-2 rounded-sm"
                          style={{ backgroundColor: segment.color }}
                        />
                        {segment.label}: {formatSegmentValue(count, totalCount, config.yAxisType)}
                      </p>
                    );
                  })
                ) : (
                  <p className="text-muted-foreground">
                    {yAxisLabel}: {data.displayCount.toFixed(config.yAxisType === 'count' ? 0 : 1)}
                    {config.yAxisType === 'count' && totalCount > 0
                      ? ` (${((data.count / totalCount) * 100).toFixed(1)}%)`
                      : ''}
                  </p>
                )}
              </div>
            );
          }}
        />
        {stackSegments.length > 0 && (
          <Legend
            verticalAlign="top"
            height={24}
            iconSize={10}
            formatter={(value) => <span className="text-[10px]">{value}</span>}
          />
        )}

        {stackSegments.length > 0 ? (
          stackSegments.map((segment, segmentIdx) => (
            <Bar
              key={segment.key}
              dataKey={segment.key}
              name={segment.label}
              stackId="classification"
              fill={segment.color}
              radius={segmentIdx === stackSegments.length - 1 ? [4, 4, 0, 0] : undefined}
              cursor="pointer"
              onMouseEnter={(data: { payload?: ChartRow }) => {
                if (!selectionCtx) return;
                const segmentSamples = (data.payload?.[`${segment.key}Samples`] as number[] | undefined) ?? [];
                if (segmentSamples.length > 0) {
                  selectionCtx.setHovered(segmentSamples[0]);
                }
              }}
              {...ANIMATION_CONFIG}
            >
              {chartData.map((entry, index) => {
                const segmentSamples = (entry[`${segment.key}Samples`] as number[] | undefined) ?? [];
                const hasSelectedInSegment = segmentSamples.some((sampleIdx) => selectedSamples.has(sampleIdx));
                const isHovered = hoveredClass === entry.classIndex;

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
          ))
        ) : (
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
        )}
      </BarChart>
    </ResponsiveContainer>
  );
}
