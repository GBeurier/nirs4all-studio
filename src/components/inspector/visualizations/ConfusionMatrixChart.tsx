/**
 * ConfusionMatrixChart — Heatmap of confusion matrix for classification tasks.
 *
 * Renders a custom SVG grid with true labels (rows) vs predicted labels (columns).
 * Cells colored by count/normalized value. Supports click-to-select.
 * Only visible when task_type is classification.
 */

import { useMemo, useState, useRef, useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import type { ConfusionMatrixResponse, ConfusionMatrixCell } from '@/types/inspector';

interface ConfusionMatrixChartProps {
  data: ConfusionMatrixResponse | null | undefined;
  isLoading: boolean;
}

interface HoveredCell {
  true_label: string;
  pred_label: string;
  count: number;
  normalized: number | null;
  mouseX: number;
  mouseY: number;
}

// Blue palette for confusion matrix (lighter = lower, darker = higher)
const BLUES = [
  '#f0f9ff', '#dbeafe', '#bfdbfe', '#93c5fd', '#60a5fa',
  '#3b82f6', '#2563eb', '#1d4ed8', '#1e40af', '#1e3a8a',
];

function getBlueColor(value: number, maxValue: number): string {
  if (maxValue <= 0) return BLUES[0];
  const t = Math.min(value / maxValue, 1);
  const idx = Math.round(t * (BLUES.length - 1));
  return BLUES[idx];
}

function getTextColor(value: number, maxValue: number): string {
  if (maxValue <= 0) return '#1e293b';
  const t = value / maxValue;
  return t > 0.5 ? '#ffffff' : '#1e293b';
}

export function ConfusionMatrixChart({ data, isLoading }: ConfusionMatrixChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState<HoveredCell | null>(null);
  const [dims, setDims] = useState({ width: 500, height: 400 });

  useEffect(() => {
    if (!containerRef.current) return;
    const obs = new ResizeObserver(entries => {
      const entry = entries[0];
      if (entry) setDims({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, []);

  // Build cell lookup and compute max
  const { cellMap, maxCount, displayValues } = useMemo(() => {
    if (!data?.cells) return { cellMap: new Map<string, ConfusionMatrixCell>(), maxCount: 0, displayValues: false };
    const map = new Map<string, ConfusionMatrixCell>();
    let max = 0;
    const hasNormalized = data.normalize !== 'none';
    for (const cell of data.cells) {
      map.set(`${cell.true_label}|${cell.pred_label}`, cell);
      const val = hasNormalized && cell.normalized != null ? cell.normalized : cell.count;
      if (val > max) max = val;
    }
    return { cellMap: map, maxCount: max, displayValues: hasNormalized };
  }, [data]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        <Loader2 className="w-5 h-5 animate-spin mr-2" />
        <span className="text-sm">Loading confusion matrix...</span>
      </div>
    );
  }

  if (!data || data.cells.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        No confusion matrix data available. This panel requires classification tasks.
      </div>
    );
  }

  const { labels } = data;
  const n = labels.length;

  const marginLeft = 80;
  const marginRight = 15;
  const marginTop = 40;
  const marginBottom = 80;
  const plotW = dims.width - marginLeft - marginRight;
  const plotH = dims.height - marginTop - marginBottom;
  const cellW = n > 0 ? plotW / n : 0;
  const cellH = n > 0 ? plotH / n : 0;

  return (
    <div ref={containerRef} className="w-full h-full relative">
      <svg width={dims.width} height={dims.height} className="select-none">
        {/* Title labels */}
        <text
          x={marginLeft + plotW / 2}
          y={14}
          textAnchor="middle"
          className="fill-muted-foreground"
          fontSize={11}
          fontWeight={500}
        >
          Predicted
        </text>
        <text
          x={12}
          y={marginTop + plotH / 2}
          textAnchor="middle"
          className="fill-muted-foreground"
          fontSize={11}
          fontWeight={500}
          transform={`rotate(-90, 12, ${marginTop + plotH / 2})`}
        >
          Actual
        </text>

        <g transform={`translate(${marginLeft}, ${marginTop})`}>
          {/* Column headers (predicted labels) */}
          {labels.map((label, i) => (
            <text
              key={`col-${i}`}
              x={i * cellW + cellW / 2}
              y={-6}
              textAnchor="middle"
              dominantBaseline="auto"
              className="fill-muted-foreground"
              fontSize={10}
            >
              {label.length > 10 ? label.slice(0, 8) + '...' : label}
            </text>
          ))}

          {/* Row headers (true labels) */}
          {labels.map((label, i) => (
            <text
              key={`row-${i}`}
              x={-6}
              y={i * cellH + cellH / 2}
              textAnchor="end"
              dominantBaseline="middle"
              className="fill-muted-foreground"
              fontSize={10}
            >
              {label.length > 10 ? label.slice(0, 8) + '...' : label}
            </text>
          ))}

          {/* Matrix cells */}
          {labels.map((trueLabel, ri) =>
            labels.map((predLabel, ci) => {
              const cell = cellMap.get(`${trueLabel}|${predLabel}`);
              const count = cell?.count ?? 0;
              const normalized = cell?.normalized ?? null;
              const colorValue = displayValues && normalized != null ? normalized : count;
              const color = getBlueColor(colorValue, maxCount);
              const textCol = getTextColor(colorValue, maxCount);
              const isHov = hovered?.true_label === trueLabel && hovered?.pred_label === predLabel;
              const isDiagonal = ri === ci;

              return (
                <g key={`${ri}-${ci}`}>
                  <rect
                    x={ci * cellW + 1}
                    y={ri * cellH + 1}
                    width={Math.max(0, cellW - 2)}
                    height={Math.max(0, cellH - 2)}
                    fill={color}
                    opacity={isHov ? 1 : 0.9}
                    rx={2}
                    cursor="default"
                    stroke={isHov ? '#fff' : isDiagonal ? '#3b82f6' : 'transparent'}
                    strokeWidth={isHov ? 2 : isDiagonal ? 0.5 : 0}
                    onMouseEnter={(e) => setHovered({
                      true_label: trueLabel,
                      pred_label: predLabel,
                      count,
                      normalized,
                      mouseX: e.clientX,
                      mouseY: e.clientY,
                    })}
                    onMouseLeave={() => setHovered(null)}
                  />
                  {/* Value annotation */}
                  {cellW > 28 && cellH > 20 && (
                    <text
                      x={ci * cellW + cellW / 2}
                      y={ri * cellH + cellH / 2}
                      textAnchor="middle"
                      dominantBaseline="middle"
                      fill={textCol}
                      fontSize={Math.min(12, cellH * 0.35, cellW * 0.3)}
                      pointerEvents="none"
                      fontWeight={isDiagonal ? 600 : 400}
                    >
                      {displayValues && normalized != null
                        ? `${(normalized * 100).toFixed(1)}%`
                        : count}
                    </text>
                  )}
                </g>
              );
            })
          )}
        </g>
      </svg>

      {/* Tooltip */}
      {hovered && (
        <div
          className="fixed z-50 bg-popover text-popover-foreground text-xs p-2 rounded shadow-md border border-border pointer-events-none"
          style={{ left: hovered.mouseX + 12, top: hovered.mouseY - 50 }}
        >
          <div className="font-medium">Actual: {hovered.true_label}</div>
          <div>Predicted: {hovered.pred_label}</div>
          <div>Count: {hovered.count}</div>
          {hovered.normalized != null && (
            <div>Normalized: {(hovered.normalized * 100).toFixed(1)}%</div>
          )}
          <div className="text-muted-foreground mt-1">
            Total samples: {data.total_samples}
          </div>
        </div>
      )}
    </div>
  );
}
