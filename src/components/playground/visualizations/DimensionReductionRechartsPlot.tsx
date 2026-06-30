import type { MouseEvent } from 'react';
import {
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from 'recharts';

import type { ColorContext, GlobalColorConfig } from '@/lib/playground/colorConfig';
import type {
  DimensionReductionDataPoint,
  DimensionReductionYRange,
} from '@/lib/playground/dimensionReductionData';
import {
  type DimensionReductionColorMode,
  getDimensionReductionRechartsCellStyle,
} from '@/lib/playground/dimensionReductionPresentation';
import {
  ANIMATION_CONFIG,
  CHART_MARGINS,
  CHART_THEME,
} from './chartConfig';
import {
  DimensionReductionRechartsTooltip,
  type DimensionReductionTooltipPayloadEntry,
} from './DimensionReductionTooltip';

interface DimensionReductionRechartsPlotProps {
  data: DimensionReductionDataPoint[];
  referenceData: DimensionReductionDataPoint[];
  xAxis: string;
  yAxis: string;
  xLabel: string;
  yLabel: string;
  pointBaseSize: number;
  showGrid: boolean;
  showCrosshairs: boolean;
  enableHover: boolean;
  globalColorConfig?: GlobalColorConfig;
  colorContext: ColorContext;
  colorMode: DimensionReductionColorMode;
  metadataKey?: string;
  yRange: DimensionReductionYRange;
  selectedSamples: Set<number>;
  pinnedSamples: Set<number>;
  hoveredSample: number | null;
  onPointClick: (data: unknown, index: number, event: MouseEvent) => void;
  onPointMouseEnter: (data: unknown) => void;
  onPointMouseLeave: () => void;
}

export function DimensionReductionRechartsPlot({
  data,
  referenceData,
  xAxis,
  yAxis,
  xLabel,
  yLabel,
  pointBaseSize,
  showGrid,
  showCrosshairs,
  enableHover,
  globalColorConfig,
  colorContext,
  colorMode,
  metadataKey,
  yRange,
  selectedSamples,
  pinnedSamples,
  hoveredSample,
  onPointClick,
  onPointMouseEnter,
  onPointMouseLeave,
}: DimensionReductionRechartsPlotProps) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <ScatterChart margin={CHART_MARGINS.pca}>
        {showGrid && (
          <CartesianGrid
            strokeDasharray={CHART_THEME.gridDasharray}
            stroke={CHART_THEME.gridStroke}
            opacity={CHART_THEME.gridOpacity}
          />
        )}

        <XAxis
          dataKey="x"
          type="number"
          stroke={CHART_THEME.axisStroke}
          fontSize={CHART_THEME.axisFontSize}
          name={xAxis}
          label={{
            value: xLabel,
            position: 'bottom',
            offset: -5,
            fontSize: CHART_THEME.axisLabelFontSize,
          }}
        />

        <YAxis
          dataKey="y"
          type="number"
          stroke={CHART_THEME.axisStroke}
          fontSize={CHART_THEME.axisFontSize}
          width={45}
          name={yAxis}
          label={{
            value: yLabel,
            angle: -90,
            position: 'insideLeft',
            fontSize: CHART_THEME.axisLabelFontSize,
          }}
        />

        <ZAxis range={[pointBaseSize, pointBaseSize]} />

        {showCrosshairs && (
          <>
            <ReferenceLine x={0} stroke="hsl(220, 10%, 50%)" strokeOpacity={0.5} />
            <ReferenceLine y={0} stroke="hsl(220, 10%, 50%)" strokeOpacity={0.5} />
          </>
        )}

        <Tooltip
          isAnimationActive={false}
          cursor={enableHover ? { stroke: 'hsl(var(--muted-foreground))', strokeWidth: 1, strokeDasharray: '4 2' } : false}
          contentStyle={{
            backgroundColor: CHART_THEME.tooltipBg,
            border: `1px solid ${CHART_THEME.tooltipBorder}`,
            borderRadius: CHART_THEME.tooltipBorderRadius,
            fontSize: CHART_THEME.tooltipFontSize,
          }}
          content={({ payload }) => (
            <DimensionReductionRechartsTooltip
              enableHover={enableHover}
              payload={payload as DimensionReductionTooltipPayloadEntry[] | undefined}
              xLabel={xLabel}
              yLabel={yLabel}
            />
          )}
        />

        <Scatter
          data={data}
          fill="#6366f1"
          onClick={onPointClick}
          onMouseEnter={onPointMouseEnter}
          onMouseLeave={onPointMouseLeave}
          cursor="pointer"
          {...ANIMATION_CONFIG}
        >
          {data.map((entry) => {
            const cellStyle = getDimensionReductionRechartsCellStyle({
              point: entry,
              globalColorConfig,
              colorContext,
              colorMode,
              metadataKey,
              yRange,
              selectedSamples,
              pinnedSamples,
              hoveredSample,
            });

            return (
              <Cell
                key={`cell-${entry.index}`}
                {...cellStyle}
              />
            );
          })}
        </Scatter>

        {referenceData.length > 0 && (
          <Scatter
            data={referenceData}
            fill={CHART_THEME.referenceLineColor}
            shape="diamond"
            {...ANIMATION_CONFIG}
          >
            {referenceData.map((entry) => (
              <Cell
                key={`ref-cell-${entry.index}`}
                fill={CHART_THEME.referenceLineColor}
                fillOpacity={CHART_THEME.referenceLineOpacity}
              />
            ))}
          </Scatter>
        )}
      </ScatterChart>
    </ResponsiveContainer>
  );
}
