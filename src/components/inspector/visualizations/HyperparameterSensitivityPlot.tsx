import type { Dispatch, SetStateAction } from 'react';
import type { InspectorSelectionMode } from '@/context/useInspectorSelection';
import { formatHyperparameterXValue, type HyperparameterTrend } from '@/lib/inspector/hyperparameterSensitivityData';
import type { HyperparameterPoint } from '@/types/inspector';

export interface HyperparameterHoveredPoint {
  chain_id: string;
  param_value: number;
  score: number;
  model_class: string;
  mouseX: number;
  mouseY: number;
}

interface HyperparameterSensitivityPlotProps {
  width: number;
  height: number;
  chartTitle: string;
  scoreLabel: string;
  useLogX: boolean;
  marginLeft: number;
  marginTop: number;
  plotW: number;
  plotH: number;
  xDomain: [number, number];
  xTickValues: number[];
  yTickValues: number[];
  xValues: number[];
  yValues: number[];
  trend: HyperparameterTrend | null;
  points: HyperparameterPoint[];
  colorMap: Map<string, string>;
  hovered: HyperparameterHoveredPoint | null;
  setHovered: Dispatch<SetStateAction<HyperparameterHoveredPoint | null>>;
  hasSelection: boolean;
  selectedChains: ReadonlySet<string>;
  select: (chainIds: string[], mode?: InspectorSelectionMode) => void;
  scaleX: (value: number) => number;
  scaleY: (value: number) => number;
}

export function HyperparameterSensitivityPlot({
  width,
  height,
  chartTitle,
  scoreLabel,
  useLogX,
  marginLeft,
  marginTop,
  plotW,
  plotH,
  xDomain,
  xTickValues,
  yTickValues,
  xValues,
  yValues,
  trend,
  points,
  colorMap,
  hovered,
  setHovered,
  hasSelection,
  selectedChains,
  select,
  scaleX,
  scaleY,
}: HyperparameterSensitivityPlotProps) {
  return (
    <div className="min-h-0 flex-1 relative">
      <svg width={width} height={height} className="select-none">
        <text
          x={width / 2}
          y={height - 6}
          textAnchor="middle"
          className="fill-muted-foreground"
          fontSize={10}
        >
          {chartTitle}{useLogX ? ' (log10)' : ''}
        </text>

        <text
          x={16}
          y={height / 2}
          textAnchor="middle"
          className="fill-muted-foreground"
          fontSize={10}
          transform={`rotate(-90, 16, ${height / 2})`}
        >
          {scoreLabel}
        </text>

        <line x1={marginLeft} y1={marginTop} x2={marginLeft} y2={marginTop + plotH} stroke="currentColor" opacity={0.2} />
        <line x1={marginLeft} y1={marginTop + plotH} x2={marginLeft + plotW} y2={marginTop + plotH} stroke="currentColor" opacity={0.2} />

        {xTickValues.map((tick, index) => {
          const x = scaleX(tick);
          return (
            <g key={`xt-${index}`}>
              <line x1={x} y1={marginTop + plotH} x2={x} y2={marginTop + plotH + 4} stroke="currentColor" opacity={0.25} />
              <text x={x} y={marginTop + plotH + 16} textAnchor="middle" className="fill-muted-foreground" fontSize={9}>
                {formatHyperparameterXValue(tick, useLogX)}
              </text>
            </g>
          );
        })}

        {yTickValues.map((tick, index) => {
          const y = scaleY(tick);
          return (
            <g key={`yt-${index}`}>
              <line x1={marginLeft - 4} y1={y} x2={marginLeft} y2={y} stroke="currentColor" opacity={0.25} />
              <text x={marginLeft - 6} y={y + 3} textAnchor="end" className="fill-muted-foreground" fontSize={9}>
                {tick.toPrecision(3)}
              </text>
            </g>
          );
        })}

        {trend && (
          <line
            x1={scaleX(xDomain[0])}
            y1={scaleY(trend.slope * xDomain[0] + trend.intercept)}
            x2={scaleX(xDomain[1])}
            y2={scaleY(trend.slope * xDomain[1] + trend.intercept)}
            stroke="#0f172a"
            strokeDasharray="5 4"
            strokeWidth={1.5}
            opacity={0.5}
          />
        )}

        {points.map((point, index) => {
          const xValue = xValues[index];
          const yValue = yValues[index];
          const cx = scaleX(xValue);
          const cy = scaleY(yValue);
          const color = colorMap.get(point.model_class) ?? '#64748b';
          const isHov = hovered?.chain_id === point.chain_id;
          const isSelected = hasSelection && selectedChains.has(point.chain_id);
          const dimmed = hasSelection && !isSelected;
          return (
            <circle
              key={point.chain_id}
              cx={cx}
              cy={cy}
              r={isHov ? 5.5 : isSelected ? 5 : 3.5}
              fill={color}
              opacity={dimmed ? 0.2 : isHov ? 1 : 0.78}
              stroke={isSelected ? '#ffffff' : 'none'}
              strokeWidth={isSelected ? 1.5 : 0}
              cursor="pointer"
              onClick={(e) => {
                if (e.shiftKey) select([point.chain_id], 'add');
                else if (e.ctrlKey || e.metaKey) select([point.chain_id], 'toggle');
                else select([point.chain_id], 'replace');
              }}
              onMouseEnter={(e) => setHovered({
                chain_id: point.chain_id,
                param_value: point.param_value,
                score: point.score,
                model_class: point.model_class,
                mouseX: e.clientX,
                mouseY: e.clientY,
              })}
              onMouseLeave={() => setHovered(null)}
            />
          );
        })}
      </svg>

      {hovered && (
        <div
          className="fixed z-50 pointer-events-none rounded-md border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-lg"
          style={{ left: hovered.mouseX + 12, top: hovered.mouseY - 50 }}
        >
          <div className="font-medium">{hovered.model_class}</div>
          <div>{chartTitle}: {hovered.param_value.toPrecision(4)}</div>
          <div>{scoreLabel}: {hovered.score.toFixed(4)}</div>
        </div>
      )}
    </div>
  );
}
