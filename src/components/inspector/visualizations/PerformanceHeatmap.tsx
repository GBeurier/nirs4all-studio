/**
 * PerformanceHeatmap — Color-coded grid of score at intersection of two variables.
 *
 * Renders a custom SVG heatmap within ResponsiveContainer.
 * Cells colored by score value using continuous palette.
 */

import { useMemo, useState, useCallback, useRef } from 'react';
import { Loader2 } from 'lucide-react';
import { useInspectorSelection } from '@/context/InspectorSelectionContext';
import { useInspectorColor } from '@/context/InspectorColorContext';
import { CONTINUOUS_PALETTES } from '@/lib/playground/colorConfig';
import type { HeatmapResponse, HeatmapCell } from '@/types/inspector';

interface PerformanceHeatmapProps {
  data: HeatmapResponse | null | undefined;
  isLoading: boolean;
}

interface HoveredCell {
  x_label: string;
  y_label: string;
  value: number | null;
  count: number;
  mouseX: number;
  mouseY: number;
}

export function PerformanceHeatmap({ data, isLoading }: PerformanceHeatmapProps) {
  const { select } = useInspectorSelection();
  const { config } = useInspectorColor();
  const containerRef = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState<HoveredCell | null>(null);

  // Build cell lookup
  const cellMap = useMemo(() => {
    if (!data?.cells) return new Map<string, HeatmapCell>();
    const map = new Map<string, HeatmapCell>();
    for (const cell of data.cells) {
      map.set(`${cell.x_label}|${cell.y_label}`, cell);
    }
    return map;
  }, [data]);

  const getCellColor = useCallback((value: number | null): string => {
    if (value == null || data?.min_value == null || data?.max_value == null) return '#1e293b';
    const range = data.max_value - data.min_value;
    const t = range > 0 ? (value - data.min_value) / range : 0.5;
    const paletteFn = CONTINUOUS_PALETTES[config.continuousPalette];
    return paletteFn ? paletteFn(t) : '#1e293b';
  }, [data, config.continuousPalette]);

  const handleCellClick = useCallback((chainIds: string[]) => {
    if (chainIds.length > 0) select(chainIds, 'toggle');
  }, [select]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        <Loader2 className="w-5 h-5 animate-spin mr-2" />
        <span className="text-sm">Loading heatmap data...</span>
      </div>
    );
  }

  if (!data || data.cells.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        No heatmap data available.
      </div>
    );
  }

  const { x_labels, y_labels } = data;
  const labelMarginLeft = 100;
  const labelMarginBottom = 60;
  const headerHeight = 20;

  return (
    <div ref={containerRef} className="w-full h-full relative overflow-hidden">
      <svg width="100%" height="100%" className="select-none">
        {/* Render grid */}
        {(() => {
          // Compute dimensions dynamically
          const svgW = containerRef.current?.clientWidth ?? 600;
          const svgH = containerRef.current?.clientHeight ?? 400;
          const gridW = svgW - labelMarginLeft - 10;
          const gridH = svgH - labelMarginBottom - headerHeight;
          const cellW = x_labels.length > 0 ? gridW / x_labels.length : 0;
          const cellH = y_labels.length > 0 ? gridH / y_labels.length : 0;

          return (
            <g transform={`translate(${labelMarginLeft}, ${headerHeight})`}>
              {/* Y-axis labels */}
              {y_labels.map((yLabel, yi) => (
                <text
                  key={`y-${yi}`}
                  x={-4}
                  y={yi * cellH + cellH / 2}
                  textAnchor="end"
                  dominantBaseline="middle"
                  className="fill-muted-foreground"
                  fontSize={10}
                >
                  {yLabel.length > 14 ? yLabel.slice(0, 12) + '…' : yLabel}
                </text>
              ))}

              {/* X-axis labels */}
              {x_labels.map((xLabel, xi) => (
                <text
                  key={`x-${xi}`}
                  x={xi * cellW + cellW / 2}
                  y={gridH + 12}
                  textAnchor="end"
                  dominantBaseline="hanging"
                  className="fill-muted-foreground"
                  fontSize={10}
                  transform={`rotate(-45, ${xi * cellW + cellW / 2}, ${gridH + 12})`}
                >
                  {xLabel.length > 14 ? xLabel.slice(0, 12) + '…' : xLabel}
                </text>
              ))}

              {/* Cells */}
              {x_labels.map((xLabel, xi) =>
                y_labels.map((yLabel, yi) => {
                  const cell = cellMap.get(`${xLabel}|${yLabel}`);
                  const value = cell?.value ?? null;
                  const color = getCellColor(value);
                  const isHovered = hovered?.x_label === xLabel && hovered?.y_label === yLabel;

                  return (
                    <g key={`${xi}-${yi}`}>
                      <rect
                        x={xi * cellW + 0.5}
                        y={yi * cellH + 0.5}
                        width={Math.max(0, cellW - 1)}
                        height={Math.max(0, cellH - 1)}
                        fill={color}
                        opacity={isHovered ? 1 : 0.85}
                        rx={2}
                        cursor="pointer"
                        stroke={isHovered ? '#fff' : 'transparent'}
                        strokeWidth={isHovered ? 2 : 0}
                        onClick={() => cell && handleCellClick(cell.chain_ids)}
                        onMouseEnter={(e) => setHovered({
                          x_label: xLabel,
                          y_label: yLabel,
                          value,
                          count: cell?.count ?? 0,
                          mouseX: e.clientX,
                          mouseY: e.clientY,
                        })}
                        onMouseLeave={() => setHovered(null)}
                      />
                      {/* Value annotation */}
                      {value !== null && cellW > 30 && cellH > 16 && (
                        <text
                          x={xi * cellW + cellW / 2}
                          y={yi * cellH + cellH / 2}
                          textAnchor="middle"
                          dominantBaseline="middle"
                          fill="#fff"
                          fontSize={Math.min(10, cellH * 0.5)}
                          pointerEvents="none"
                          fontWeight={500}
                        >
                          {value.toFixed(3)}
                        </text>
                      )}
                    </g>
                  );
                })
              )}
            </g>
          );
        })()}
      </svg>

      {/* Tooltip */}
      {hovered && (
        <div
          className="fixed z-50 bg-popover text-popover-foreground text-xs p-2 rounded shadow-md border border-border pointer-events-none"
          style={{ left: hovered.mouseX + 12, top: hovered.mouseY - 40 }}
        >
          <div className="font-medium">{data.x_variable}: {hovered.x_label}</div>
          <div>{data.y_variable}: {hovered.y_label}</div>
          <div>Score: {hovered.value !== null ? hovered.value.toFixed(4) : 'N/A'}</div>
          <div>Chains: {hovered.count}</div>
        </div>
      )}
    </div>
  );
}
