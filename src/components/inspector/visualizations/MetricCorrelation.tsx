/**
 * MetricCorrelation — Heatmap of correlation between score metrics.
 *
 * Renders a custom SVG correlation matrix showing Pearson/Spearman
 * coefficients between score columns (cv_val, cv_test, cv_train, etc.).
 * Color palette: RdBu diverging (negative=red, positive=blue).
 */

import { useMemo, useState, useRef, useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import type { MetricCorrelationResponse } from '@/types/inspector';

interface MetricCorrelationProps {
  data: MetricCorrelationResponse | null | undefined;
  isLoading: boolean;
}

interface HoveredCell {
  metric_x: string;
  metric_y: string;
  coefficient: number | null;
  count: number;
  mouseX: number;
  mouseY: number;
}

// RdBu diverging palette: -1 (red) → 0 (white) → +1 (blue)
function getCorrelationColor(coef: number | null): string {
  if (coef == null) return '#1e293b';
  const c = Math.max(-1, Math.min(1, coef));

  if (c >= 0) {
    // White → Blue
    const t = c;
    const r = Math.round(255 * (1 - t * 0.85));
    const g = Math.round(255 * (1 - t * 0.65));
    const b = 255;
    return `rgb(${r}, ${g}, ${b})`;
  } else {
    // White → Red
    const t = -c;
    const r = 255;
    const g = Math.round(255 * (1 - t * 0.7));
    const b = Math.round(255 * (1 - t * 0.75));
    return `rgb(${r}, ${g}, ${b})`;
  }
}

function getTextColor(coef: number | null): string {
  if (coef == null) return '#64748b';
  return Math.abs(coef) > 0.6 ? '#ffffff' : '#1e293b';
}

// Readable metric labels
const METRIC_LABELS: Record<string, string> = {
  cv_val_score: 'CV Val',
  cv_test_score: 'CV Test',
  cv_train_score: 'CV Train',
  final_test_score: 'Final Test',
  final_train_score: 'Final Train',
};

function metricLabel(name: string): string {
  return METRIC_LABELS[name] ?? name;
}

export function MetricCorrelation({ data, isLoading }: MetricCorrelationProps) {
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

  // Build cell lookup
  const cellMap = useMemo(() => {
    if (!data?.cells) return new Map<string, typeof data.cells[0]>();
    const map = new Map<string, typeof data.cells[0]>();
    for (const cell of data.cells) {
      map.set(`${cell.metric_x}|${cell.metric_y}`, cell);
    }
    return map;
  }, [data]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        <Loader2 className="w-5 h-5 animate-spin mr-2" />
        <span className="text-sm">Loading correlation data...</span>
      </div>
    );
  }

  if (!data || data.cells.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        No correlation data available. Need at least 2 metrics with 3+ chains.
      </div>
    );
  }

  const { metrics, method } = data;
  const n = metrics.length;

  const marginLeft = 85;
  const marginRight = 15;
  const marginTop = 50;
  const marginBottom = 15;
  const plotW = dims.width - marginLeft - marginRight;
  const plotH = dims.height - marginTop - marginBottom;
  const cellW = n > 0 ? plotW / n : 0;
  const cellH = n > 0 ? plotH / n : 0;

  return (
    <div ref={containerRef} className="w-full h-full relative">
      <svg width={dims.width} height={dims.height} className="select-none">
        {/* Method label */}
        <text
          x={dims.width - marginRight}
          y={14}
          textAnchor="end"
          className="fill-muted-foreground"
          fontSize={9}
          opacity={0.7}
        >
          {method === 'spearman' ? 'Spearman' : 'Pearson'} correlation
        </text>

        <g transform={`translate(${marginLeft}, ${marginTop})`}>
          {/* Column headers */}
          {metrics.map((metric, i) => (
            <text
              key={`col-${i}`}
              x={i * cellW + cellW / 2}
              y={-8}
              textAnchor="end"
              dominantBaseline="auto"
              className="fill-muted-foreground"
              fontSize={10}
              transform={`rotate(-35, ${i * cellW + cellW / 2}, ${-8})`}
            >
              {metricLabel(metric)}
            </text>
          ))}

          {/* Row headers */}
          {metrics.map((metric, i) => (
            <text
              key={`row-${i}`}
              x={-6}
              y={i * cellH + cellH / 2}
              textAnchor="end"
              dominantBaseline="middle"
              className="fill-muted-foreground"
              fontSize={10}
            >
              {metricLabel(metric)}
            </text>
          ))}

          {/* Matrix cells — upper triangle + diagonal */}
          {metrics.map((metricX, xi) =>
            metrics.map((metricY, yi) => {
              const cell = cellMap.get(`${metricX}|${metricY}`);
              const coef = cell?.coefficient ?? null;
              const color = getCorrelationColor(coef);
              const textCol = getTextColor(coef);
              const isHov = hovered?.metric_x === metricX && hovered?.metric_y === metricY;
              const isDiagonal = xi === yi;

              // Show upper triangle fully, lower triangle with reduced opacity
              const isUpperTriangle = yi <= xi;

              return (
                <g key={`${xi}-${yi}`}>
                  <rect
                    x={xi * cellW + 1}
                    y={yi * cellH + 1}
                    width={Math.max(0, cellW - 2)}
                    height={Math.max(0, cellH - 2)}
                    fill={color}
                    opacity={isHov ? 1 : isUpperTriangle ? 0.9 : 0.5}
                    rx={2}
                    cursor="pointer"
                    stroke={isHov ? '#fff' : 'transparent'}
                    strokeWidth={isHov ? 2 : 0}
                    onMouseEnter={(e) => setHovered({
                      metric_x: metricX,
                      metric_y: metricY,
                      coefficient: coef,
                      count: cell?.count ?? 0,
                      mouseX: e.clientX,
                      mouseY: e.clientY,
                    })}
                    onMouseLeave={() => setHovered(null)}
                  />
                  {/* Coefficient value */}
                  {coef != null && cellW > 30 && cellH > 18 && (
                    <text
                      x={xi * cellW + cellW / 2}
                      y={yi * cellH + cellH / 2}
                      textAnchor="middle"
                      dominantBaseline="middle"
                      fill={textCol}
                      fontSize={Math.min(11, cellH * 0.35, cellW * 0.28)}
                      pointerEvents="none"
                      fontWeight={isDiagonal ? 600 : 400}
                    >
                      {isDiagonal ? '1.00' : coef.toFixed(2)}
                    </text>
                  )}
                </g>
              );
            })
          )}
        </g>

        {/* Color legend bar */}
        <defs>
          <linearGradient id="corr-gradient" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0%" stopColor="rgb(255, 77, 64)" />
            <stop offset="50%" stopColor="rgb(255, 255, 255)" />
            <stop offset="100%" stopColor="rgb(38, 90, 255)" />
          </linearGradient>
        </defs>
        <g transform={`translate(${marginLeft}, ${dims.height - 12})`}>
          <rect x={0} y={0} width={plotW} height={6} fill="url(#corr-gradient)" rx={2} />
          <text x={0} y={-2} className="fill-muted-foreground" fontSize={8} textAnchor="start">-1</text>
          <text x={plotW / 2} y={-2} className="fill-muted-foreground" fontSize={8} textAnchor="middle">0</text>
          <text x={plotW} y={-2} className="fill-muted-foreground" fontSize={8} textAnchor="end">+1</text>
        </g>
      </svg>

      {/* Tooltip */}
      {hovered && (
        <div
          className="fixed z-50 bg-popover text-popover-foreground text-xs p-2 rounded shadow-md border border-border pointer-events-none"
          style={{ left: hovered.mouseX + 12, top: hovered.mouseY - 40 }}
        >
          <div className="font-medium">
            {metricLabel(hovered.metric_x)} vs {metricLabel(hovered.metric_y)}
          </div>
          <div>
            Coefficient: {hovered.coefficient != null ? hovered.coefficient.toFixed(4) : 'N/A'}
          </div>
          <div>Chains: {hovered.count}</div>
        </div>
      )}
    </div>
  );
}
