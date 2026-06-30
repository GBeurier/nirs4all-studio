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

import type {
  RepetitionQuantileValue,
  RepetitionsPlotDataPoint,
} from '@/lib/playground/repetitionsChartData';
import { CHART_THEME } from './chartConfig';
import { RepetitionsChartTooltip } from './RepetitionsChartTooltip';
import { REPETITION_QUANTILE_COLORS } from './repetitionsChartStyles';

interface RepetitionsRechartsPlotProps {
  plotData: RepetitionsPlotDataPoint[];
  effectiveXDomain: [number, number];
  xTicks: number[];
  yDomain: [number, number];
  scaleType: 'linear' | 'log';
  showGrid: boolean;
  enableHover: boolean;
  quantileValues: RepetitionQuantileValue[];
  formatXAxisTick: (value: number) => string;
  getPointColor: (point: RepetitionsPlotDataPoint) => string;
  onPointClick: (point: RepetitionsPlotDataPoint, event: MouseEvent) => void;
}

const POINT_RADIUS = { normal: 2, outlier: 3, selected: 4 };

export function RepetitionsRechartsPlot({
  plotData,
  effectiveXDomain,
  xTicks,
  yDomain,
  scaleType,
  showGrid,
  enableHover,
  quantileValues,
  formatXAxisTick,
  getPointColor,
  onPointClick,
}: RepetitionsRechartsPlotProps) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <ScatterChart margin={{ top: 10, right: 20, bottom: 30, left: 45 }}>
        {showGrid && (
          <CartesianGrid
            strokeDasharray={CHART_THEME.gridDasharray}
            stroke={CHART_THEME.gridStroke}
            opacity={CHART_THEME.gridOpacity}
          />
        )}

        <XAxis
          type="number"
          dataKey="x"
          domain={effectiveXDomain}
          ticks={xTicks}
          tickFormatter={formatXAxisTick}
          stroke={CHART_THEME.axisStroke}
          fontSize={CHART_THEME.axisFontSize}
          interval={0}
          height={40}
          allowDataOverflow
        />

        <YAxis
          type="number"
          dataKey="y"
          domain={yDomain}
          stroke={CHART_THEME.axisStroke}
          fontSize={CHART_THEME.axisFontSize}
          width={40}
          scale={scaleType === 'log' ? 'linear' : 'linear'}
          label={{
            value: scaleType === 'log' ? 'log(1 + Distance)' : 'Distance',
            angle: -90,
            position: 'insideLeft',
            fontSize: CHART_THEME.axisLabelFontSize,
            offset: 5,
          }}
        />

        <ZAxis range={[20, 60]} />

        <Tooltip
          isAnimationActive={false}
          cursor={enableHover ? { stroke: 'hsl(var(--muted-foreground))', strokeWidth: 1, strokeDasharray: '4 2' } : false}
          content={<RepetitionsChartTooltip enableHover={enableHover} />}
        />

        {quantileValues.map(({ quantile, value }) => (
          <ReferenceLine
            key={`quantile-${quantile}`}
            y={value}
            stroke={REPETITION_QUANTILE_COLORS[quantile]}
            strokeDasharray="3 3"
            strokeWidth={1}
            label={{
              value: `P${quantile}`,
              position: 'right',
              fontSize: 9,
              fill: REPETITION_QUANTILE_COLORS[quantile],
            }}
          />
        ))}

        <Scatter
          data={plotData}
          cursor="pointer"
          onClick={(_data: unknown, index: number, event: MouseEvent) => {
            const point = plotData[index];
            if (point) onPointClick(point, event);
          }}
          isAnimationActive={false}
        >
          {plotData.map((point, index) => (
            <Cell
              key={`cell-${index}`}
              fill={getPointColor(point)}
              stroke={
                point.isSelected
                  ? 'hsl(var(--foreground))'
                  : point.isOutlier
                    ? 'hsl(var(--warning))'
                    : 'none'
              }
              strokeWidth={point.isSelected ? 2 : point.isOutlier ? 1 : 0}
              r={point.isSelected ? POINT_RADIUS.selected : point.isOutlier ? POINT_RADIUS.outlier : POINT_RADIUS.normal}
            />
          ))}
        </Scatter>
      </ScatterChart>
    </ResponsiveContainer>
  );
}
