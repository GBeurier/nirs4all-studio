/**
 * HyperparameterSensitivity — Scatter plot of hyperparameter value vs score.
 *
 * Custom SVG with ResizeObserver. Points colored by model_class.
 * Hover tooltip shows chain details.
 */

import { useMemo, useState, useRef, useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import type { HyperparameterResponse } from '@/types/inspector';

interface HyperparameterSensitivityProps {
  data: HyperparameterResponse | null | undefined;
  isLoading: boolean;
}

interface HoveredPoint {
  chain_id: string;
  param_value: number;
  score: number;
  model_class: string;
  mouseX: number;
  mouseY: number;
}

const MODEL_COLORS = [
  '#0d9488', '#2563eb', '#d97706', '#e11d48', '#7c3aed',
  '#059669', '#ea580c', '#0284c7', '#db2777', '#65a30d',
];

export function HyperparameterSensitivity({ data, isLoading }: HyperparameterSensitivityProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState<HoveredPoint | null>(null);
  const [dims, setDims] = useState({ width: 500, height: 350 });

  useEffect(() => {
    if (!containerRef.current) return;
    const obs = new ResizeObserver(entries => {
      const entry = entries[0];
      if (entry) setDims({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, []);

  // Model color map
  const colorMap = useMemo(() => {
    if (!data?.points) return new Map<string, string>();
    const models = [...new Set(data.points.map(p => p.model_class))];
    return new Map(models.map((m, i) => [m, MODEL_COLORS[i % MODEL_COLORS.length]]));
  }, [data]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        <Loader2 className="w-5 h-5 animate-spin mr-2" />
        <span className="text-sm">Loading hyperparameter data...</span>
      </div>
    );
  }

  if (!data || data.points.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        No hyperparameter data available. Chains need best_params with numeric values.
      </div>
    );
  }

  const marginLeft = 60;
  const marginRight = 15;
  const marginTop = 20;
  const marginBottom = 40;
  const plotW = dims.width - marginLeft - marginRight;
  const plotH = dims.height - marginTop - marginBottom;

  const paramValues = data.points.map(p => p.param_value);
  const scores = data.points.map(p => p.score);
  const xMin = Math.min(...paramValues);
  const xMax = Math.max(...paramValues);
  const yMin = Math.min(...scores);
  const yMax = Math.max(...scores);
  const xRange = xMax - xMin || 1;
  const yRange = yMax - yMin || 1;

  const scaleX = (v: number) => marginLeft + ((v - xMin) / xRange) * plotW;
  const scaleY = (v: number) => marginTop + plotH - ((v - yMin) / yRange) * plotH;

  return (
    <div ref={containerRef} className="w-full h-full relative">
      <svg width={dims.width} height={dims.height} className="select-none">
        {/* Param name label */}
        <text
          x={dims.width / 2}
          y={dims.height - 4}
          textAnchor="middle"
          className="fill-muted-foreground"
          fontSize={10}
        >
          {data.param_name}
        </text>

        {/* Y-axis label */}
        <text
          x={14}
          y={dims.height / 2}
          textAnchor="middle"
          className="fill-muted-foreground"
          fontSize={10}
          transform={`rotate(-90, 14, ${dims.height / 2})`}
        >
          Score
        </text>

        {/* Axes */}
        <line x1={marginLeft} y1={marginTop} x2={marginLeft} y2={marginTop + plotH} stroke="currentColor" opacity={0.2} />
        <line x1={marginLeft} y1={marginTop + plotH} x2={marginLeft + plotW} y2={marginTop + plotH} stroke="currentColor" opacity={0.2} />

        {/* X ticks */}
        {[0, 0.25, 0.5, 0.75, 1].map(t => {
          const x = marginLeft + t * plotW;
          const val = xMin + t * xRange;
          return (
            <g key={`xt-${t}`}>
              <line x1={x} y1={marginTop + plotH} x2={x} y2={marginTop + plotH + 4} stroke="currentColor" opacity={0.3} />
              <text x={x} y={marginTop + plotH + 16} textAnchor="middle" className="fill-muted-foreground" fontSize={9}>
                {val.toPrecision(3)}
              </text>
            </g>
          );
        })}

        {/* Y ticks */}
        {[0, 0.25, 0.5, 0.75, 1].map(t => {
          const y = marginTop + plotH - t * plotH;
          const val = yMin + t * yRange;
          return (
            <g key={`yt-${t}`}>
              <line x1={marginLeft - 4} y1={y} x2={marginLeft} y2={y} stroke="currentColor" opacity={0.3} />
              <text x={marginLeft - 6} y={y + 3} textAnchor="end" className="fill-muted-foreground" fontSize={9}>
                {val.toFixed(3)}
              </text>
            </g>
          );
        })}

        {/* Data points */}
        {data.points.map((point, i) => {
          const cx = scaleX(point.param_value);
          const cy = scaleY(point.score);
          const color = colorMap.get(point.model_class) ?? '#64748b';
          const isHov = hovered?.chain_id === point.chain_id;
          return (
            <circle
              key={i}
              cx={cx}
              cy={cy}
              r={isHov ? 5 : 3.5}
              fill={color}
              opacity={isHov ? 1 : 0.7}
              stroke={isHov ? '#fff' : 'none'}
              strokeWidth={isHov ? 1.5 : 0}
              cursor="pointer"
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

        {/* Legend */}
        {[...colorMap.entries()].map(([model, color], i) => (
          <g key={model} transform={`translate(${marginLeft + 8}, ${marginTop + 8 + i * 14})`}>
            <circle cx={0} cy={0} r={3} fill={color} />
            <text x={7} y={3} className="fill-muted-foreground" fontSize={9}>{model}</text>
          </g>
        ))}
      </svg>

      {/* Tooltip */}
      {hovered && (
        <div
          className="fixed z-50 bg-popover text-popover-foreground text-xs p-2 rounded shadow-md border border-border pointer-events-none"
          style={{ left: hovered.mouseX + 12, top: hovered.mouseY - 40 }}
        >
          <div className="font-medium">{hovered.model_class}</div>
          <div>{data.param_name}: {hovered.param_value.toPrecision(4)}</div>
          <div>Score: {hovered.score.toFixed(4)}</div>
        </div>
      )}
    </div>
  );
}
