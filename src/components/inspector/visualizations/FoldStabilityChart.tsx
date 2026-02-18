/**
 * FoldStabilityChart — Line chart of per-fold scores per chain/group.
 *
 * X-axis: fold index, Y-axis: score value.
 * One line per chain, colored by group. Hover highlights line.
 * Click line → select/toggle chain. Mean ± std band per group behind lines.
 * Custom SVG (pattern from CandlestickChart).
 */

import { useMemo, useState, useCallback, useRef, useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import { useInspectorSelection } from '@/context/InspectorSelectionContext';
import { useInspectorHover } from '@/context/InspectorSelectionContext';
import { INSPECTOR_GROUP_COLORS } from '@/types/inspector';
import type { FoldStabilityResponse, InspectorGroup } from '@/types/inspector';

interface FoldStabilityChartProps {
  data: FoldStabilityResponse | null | undefined;
  groups: InspectorGroup[];
  isLoading: boolean;
}

interface HoveredLine {
  chainId: string;
  modelClass: string;
  mouseX: number;
  mouseY: number;
}

interface ChainLine {
  chainId: string;
  modelClass: string;
  preprocessings: string | null;
  color: string;
  points: Array<{ foldIndex: number; score: number }>;
}

export function FoldStabilityChart({ data, groups, isLoading }: FoldStabilityChartProps) {
  const { select, selectedChains, hasSelection } = useInspectorSelection();
  const { hoveredChain, setHovered } = useInspectorHover();
  const containerRef = useRef<HTMLDivElement>(null);
  const [hoveredLine, setHoveredLine] = useState<HoveredLine | null>(null);
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

  // Build chain→color lookup
  const chainColorMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const group of groups) {
      for (const cid of group.chain_ids) map.set(cid, group.color);
    }
    return map;
  }, [groups]);

  // Build chain lines from data
  const { lines, yMin, yMax, foldCount } = useMemo(() => {
    if (!data?.entries?.length) return { lines: [], yMin: 0, yMax: 1, foldCount: 0 };

    // Group entries by chain_id
    const chainMap = new Map<string, ChainLine>();
    let min = Infinity;
    let max = -Infinity;

    for (const entry of data.entries) {
      let line = chainMap.get(entry.chain_id);
      if (!line) {
        const color = chainColorMap.get(entry.chain_id) ?? INSPECTOR_GROUP_COLORS[chainMap.size % INSPECTOR_GROUP_COLORS.length];
        line = {
          chainId: entry.chain_id,
          modelClass: entry.model_class,
          preprocessings: entry.preprocessings,
          color,
          points: [],
        };
        chainMap.set(entry.chain_id, line);
      }
      line.points.push({ foldIndex: entry.fold_index, score: entry.score });
      if (entry.score < min) min = entry.score;
      if (entry.score > max) max = entry.score;
    }

    // Sort points within each line
    for (const line of chainMap.values()) {
      line.points.sort((a, b) => a.foldIndex - b.foldIndex);
    }

    const range = max - min || 1;
    return {
      lines: Array.from(chainMap.values()),
      yMin: min - range * 0.05,
      yMax: max + range * 0.05,
      foldCount: data.fold_ids.length,
    };
  }, [data, chainColorMap]);

  // Compute mean ± std band per fold (across all visible chains)
  const meanBand = useMemo(() => {
    if (lines.length < 2) return null;
    const foldScores = new Map<number, number[]>();
    for (const line of lines) {
      for (const pt of line.points) {
        const arr = foldScores.get(pt.foldIndex) ?? [];
        arr.push(pt.score);
        foldScores.set(pt.foldIndex, arr);
      }
    }

    const band: Array<{ foldIndex: number; mean: number; upper: number; lower: number }> = [];
    for (const [fi, scores] of foldScores) {
      const n = scores.length;
      const mean = scores.reduce((a, b) => a + b, 0) / n;
      const variance = scores.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
      const std = Math.sqrt(variance);
      band.push({ foldIndex: fi, mean, upper: mean + std, lower: mean - std });
    }
    band.sort((a, b) => a.foldIndex - b.foldIndex);
    return band;
  }, [lines]);

  const handleLineClick = useCallback((chainId: string) => {
    select([chainId], 'toggle');
  }, [select]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        <Loader2 className="w-5 h-5 animate-spin mr-2" />
        <span className="text-sm">Loading fold stability data...</span>
      </div>
    );
  }

  if (lines.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        No fold stability data available. Select chains to visualize.
      </div>
    );
  }

  const marginLeft = 55;
  const marginRight = 15;
  const marginTop = 15;
  const marginBottom = 35;
  const plotW = dims.width - marginLeft - marginRight;
  const plotH = dims.height - marginTop - marginBottom;
  const yRange = yMax - yMin || 1;

  const scaleX = (foldIdx: number) => {
    const maxIdx = Math.max(foldCount - 1, 1);
    return marginLeft + (foldIdx / maxIdx) * plotW;
  };
  const scaleY = (v: number) => marginTop + plotH - ((v - yMin) / yRange) * plotH;

  // Y-axis ticks
  const yTickCount = 5;
  const yTicks: number[] = [];
  for (let i = 0; i <= yTickCount; i++) {
    yTicks.push(yMin + (yRange * i) / yTickCount);
  }

  // X-axis ticks (fold indices)
  const xTicks: number[] = [];
  for (let i = 0; i < foldCount; i++) xTicks.push(i);

  // SVG path for mean band polygon
  const bandPath = meanBand && meanBand.length > 1
    ? (() => {
        const upper = meanBand.map(b => `${scaleX(b.foldIndex)},${scaleY(b.upper)}`).join(' L ');
        const lower = [...meanBand].reverse().map(b => `${scaleX(b.foldIndex)},${scaleY(b.lower)}`).join(' L ');
        return `M ${upper} L ${lower} Z`;
      })()
    : null;

  // Mean line path
  const meanPath = meanBand && meanBand.length > 1
    ? 'M ' + meanBand.map(b => `${scaleX(b.foldIndex)},${scaleY(b.mean)}`).join(' L ')
    : null;

  // Effective hover: from tooltip hover or from context
  const effectiveHover = hoveredLine?.chainId ?? hoveredChain;

  return (
    <div ref={containerRef} className="w-full h-full relative">
      <svg width={dims.width} height={dims.height} className="select-none">
        {/* Y-axis grid */}
        {yTicks.map((tick, i) => (
          <g key={i}>
            <line
              x1={marginLeft}
              x2={dims.width - marginRight}
              y1={scaleY(tick)}
              y2={scaleY(tick)}
              stroke="#334155"
              strokeDasharray="3 3"
              opacity={0.4}
            />
            <text
              x={marginLeft - 6}
              y={scaleY(tick)}
              textAnchor="end"
              dominantBaseline="middle"
              className="fill-muted-foreground"
              fontSize={10}
            >
              {tick.toFixed(3)}
            </text>
          </g>
        ))}

        {/* X-axis labels */}
        {xTicks.map((fi) => (
          <text
            key={fi}
            x={scaleX(fi)}
            y={dims.height - marginBottom + 14}
            textAnchor="middle"
            className="fill-muted-foreground"
            fontSize={10}
          >
            F{fi + 1}
          </text>
        ))}

        {/* X-axis label */}
        <text
          x={marginLeft + plotW / 2}
          y={dims.height - 4}
          textAnchor="middle"
          className="fill-muted-foreground"
          fontSize={10}
        >
          Fold
        </text>

        {/* Mean ± std band */}
        {bandPath && (
          <path d={bandPath} fill="#94a3b8" fillOpacity={0.1} />
        )}
        {meanPath && (
          <path d={meanPath} fill="none" stroke="#94a3b8" strokeWidth={1.5} strokeDasharray="4 3" opacity={0.5} />
        )}

        {/* Chain lines */}
        {lines.map((line) => {
          if (line.points.length < 2) return null;

          const isChainSelected = hasSelection && selectedChains.has(line.chainId);
          const isChainHovered = effectiveHover === line.chainId;
          const dimmed = hasSelection && !isChainSelected;

          const pathD = 'M ' + line.points.map(pt => `${scaleX(pt.foldIndex)},${scaleY(pt.score)}`).join(' L ');

          return (
            <g key={line.chainId}>
              {/* Wider invisible hit area for hover/click */}
              <path
                d={pathD}
                fill="none"
                stroke="transparent"
                strokeWidth={12}
                cursor="pointer"
                onClick={() => handleLineClick(line.chainId)}
                onMouseEnter={(e) => {
                  setHoveredLine({ chainId: line.chainId, modelClass: line.modelClass, mouseX: e.clientX, mouseY: e.clientY });
                  setHovered(line.chainId);
                }}
                onMouseLeave={() => {
                  setHoveredLine(null);
                  setHovered(null);
                }}
              />

              {/* Visible line */}
              <path
                d={pathD}
                fill="none"
                stroke={line.color}
                strokeWidth={isChainHovered ? 2.5 : 1.5}
                opacity={dimmed ? 0.15 : isChainHovered ? 1 : 0.6}
                strokeLinejoin="round"
                pointerEvents="none"
              />

              {/* Dots at fold points */}
              {line.points.map((pt) => (
                <circle
                  key={pt.foldIndex}
                  cx={scaleX(pt.foldIndex)}
                  cy={scaleY(pt.score)}
                  r={isChainHovered ? 4 : 2.5}
                  fill={line.color}
                  fillOpacity={dimmed ? 0.15 : isChainHovered ? 1 : 0.6}
                  pointerEvents="none"
                />
              ))}
            </g>
          );
        })}
      </svg>

      {/* Tooltip */}
      {hoveredLine && (
        <div
          className="fixed z-50 bg-popover text-popover-foreground text-xs p-2 rounded shadow-md border border-border pointer-events-none"
          style={{ left: hoveredLine.mouseX + 12, top: hoveredLine.mouseY - 60 }}
        >
          <div className="font-medium">{hoveredLine.modelClass}</div>
          <div className="text-[10px] opacity-70 mb-1">{hoveredLine.chainId.slice(0, 12)}…</div>
          {lines.find(l => l.chainId === hoveredLine.chainId)?.points.map(pt => (
            <div key={pt.foldIndex}>F{pt.foldIndex + 1}: {pt.score.toFixed(4)}</div>
          ))}
        </div>
      )}
    </div>
  );
}
