/**
 * BranchComparisonChart — Horizontal bar chart with CI whiskers per branch.
 *
 * Each branch shows: mean score (bar) + 95% CI whiskers.
 * Click bar → select all chains in that branch.
 * Custom SVG rendering (pattern from CandlestickChart).
 */

import { useMemo, useState, useCallback, useRef, useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import { useInspectorSelection } from '@/context/InspectorSelectionContext';
import { INSPECTOR_GROUP_COLORS } from '@/types/inspector';
import type { BranchComparisonResponse, BranchComparisonEntry } from '@/types/inspector';

interface BranchComparisonChartProps {
  data: BranchComparisonResponse | null | undefined;
  isLoading: boolean;
}

interface HoveredBar {
  branch: BranchComparisonEntry;
  mouseX: number;
  mouseY: number;
}

export function BranchComparisonChart({ data, isLoading }: BranchComparisonChartProps) {
  const { select } = useInspectorSelection();
  const containerRef = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState<HoveredBar | null>(null);
  const [dims, setDims] = useState({ width: 600, height: 400 });

  useEffect(() => {
    if (!containerRef.current) return;
    const obs = new ResizeObserver(entries => {
      const entry = entries[0];
      if (entry) setDims({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, []);

  const { xMin, xMax, branches } = useMemo(() => {
    if (!data?.branches?.length) return { xMin: 0, xMax: 1, branches: [] };
    let min = Infinity;
    let max = -Infinity;
    for (const b of data.branches) {
      if (b.ci_lower < min) min = b.ci_lower;
      if (b.min < min) min = b.min;
      if (b.ci_upper > max) max = b.ci_upper;
      if (b.max > max) max = b.max;
    }
    const range = max - min || 1;
    return { xMin: min - range * 0.05, xMax: max + range * 0.05, branches: data.branches };
  }, [data]);

  const handleBarClick = useCallback((chainIds: string[]) => {
    if (chainIds.length > 0) select(chainIds, 'toggle');
  }, [select]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        <Loader2 className="w-5 h-5 animate-spin mr-2" />
        <span className="text-sm">Loading branch comparison data...</span>
      </div>
    );
  }

  if (branches.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        No branch comparison data available.
      </div>
    );
  }

  const marginLeft = 120;
  const marginRight = 20;
  const marginTop = 15;
  const marginBottom = 35;
  const plotW = dims.width - marginLeft - marginRight;
  const plotH = dims.height - marginTop - marginBottom;
  const xRange = xMax - xMin || 1;

  const scaleX = (v: number) => marginLeft + ((v - xMin) / xRange) * plotW;

  const barCount = branches.length;
  const barHeight = Math.min(plotH / barCount * 0.6, 28);
  const barSpacing = plotH / barCount;

  // X-axis ticks
  const tickCount = 5;
  const ticks: number[] = [];
  for (let i = 0; i <= tickCount; i++) {
    ticks.push(xMin + (xRange * i) / tickCount);
  }

  return (
    <div ref={containerRef} className="w-full h-full relative">
      <svg width={dims.width} height={dims.height} className="select-none">
        {/* X-axis grid lines and labels */}
        {ticks.map((tick, i) => (
          <g key={i}>
            <line
              x1={scaleX(tick)}
              x2={scaleX(tick)}
              y1={marginTop}
              y2={dims.height - marginBottom}
              stroke="#334155"
              strokeDasharray="3 3"
              opacity={0.4}
            />
            <text
              x={scaleX(tick)}
              y={dims.height - marginBottom + 14}
              textAnchor="middle"
              className="fill-muted-foreground"
              fontSize={10}
            >
              {tick.toFixed(3)}
            </text>
          </g>
        ))}

        {/* Score column label */}
        {data?.score_column && (
          <text
            x={marginLeft + plotW / 2}
            y={dims.height - 4}
            textAnchor="middle"
            className="fill-muted-foreground"
            fontSize={10}
          >
            {data.score_column}
          </text>
        )}

        {/* Bars */}
        {branches.map((branch, bi) => {
          const cy = marginTop + bi * barSpacing + barSpacing / 2;
          const color = INSPECTOR_GROUP_COLORS[bi % INSPECTOR_GROUP_COLORS.length];
          const isHovered = hovered?.branch.branch_path === branch.branch_path;

          const xMean = scaleX(branch.mean);
          const xCiLower = scaleX(branch.ci_lower);
          const xCiUpper = scaleX(branch.ci_upper);
          const xZero = scaleX(Math.max(xMin, 0));
          const barLeft = Math.min(xZero, xMean);
          const barRight = Math.max(xZero, xMean);

          return (
            <g key={branch.branch_path} cursor="pointer" onClick={() => handleBarClick(branch.chain_ids)}>
              {/* CI whisker line */}
              <line
                x1={xCiLower}
                x2={xCiUpper}
                y1={cy}
                y2={cy}
                stroke={color}
                strokeWidth={1.5}
                opacity={0.6}
              />

              {/* CI left cap */}
              <line
                x1={xCiLower}
                x2={xCiLower}
                y1={cy - barHeight * 0.3}
                y2={cy + barHeight * 0.3}
                stroke={color}
                strokeWidth={1.5}
              />

              {/* CI right cap */}
              <line
                x1={xCiUpper}
                x2={xCiUpper}
                y1={cy - barHeight * 0.3}
                y2={cy + barHeight * 0.3}
                stroke={color}
                strokeWidth={1.5}
              />

              {/* Mean bar */}
              <rect
                x={barLeft}
                y={cy - barHeight / 2}
                width={Math.max(barRight - barLeft, 2)}
                height={barHeight}
                fill={color}
                fillOpacity={isHovered ? 0.6 : 0.4}
                stroke={color}
                strokeWidth={isHovered ? 2 : 1}
                rx={2}
                onMouseEnter={(e) => setHovered({ branch, mouseX: e.clientX, mouseY: e.clientY })}
                onMouseLeave={() => setHovered(null)}
              />

              {/* Mean dot */}
              <circle
                cx={xMean}
                cy={cy}
                r={3.5}
                fill={color}
                stroke="white"
                strokeWidth={1}
              />

              {/* Branch label */}
              <text
                x={marginLeft - 6}
                y={cy}
                textAnchor="end"
                dominantBaseline="middle"
                className="fill-muted-foreground"
                fontSize={10}
              >
                {branch.label.length > 16 ? branch.label.slice(0, 14) + '…' : branch.label}
              </text>

              {/* Count badge */}
              <text
                x={Math.max(xMean, xCiUpper) + 8}
                y={cy}
                dominantBaseline="middle"
                className="fill-muted-foreground"
                fontSize={9}
                opacity={0.7}
              >
                n={branch.count}
              </text>
            </g>
          );
        })}
      </svg>

      {/* Tooltip */}
      {hovered && (
        <div
          className="fixed z-50 bg-popover text-popover-foreground text-xs p-2 rounded shadow-md border border-border pointer-events-none"
          style={{ left: hovered.mouseX + 12, top: hovered.mouseY - 80 }}
        >
          <div className="font-medium">{hovered.branch.label}</div>
          <div>Mean: {hovered.branch.mean.toFixed(4)}</div>
          <div>Std: {hovered.branch.std.toFixed(4)}</div>
          <div>CI: [{hovered.branch.ci_lower.toFixed(4)}, {hovered.branch.ci_upper.toFixed(4)}]</div>
          <div>Min: {hovered.branch.min.toFixed(4)}</div>
          <div>Max: {hovered.branch.max.toFixed(4)}</div>
          <div>Chains: {hovered.branch.count}</div>
        </div>
      )}
    </div>
  );
}
