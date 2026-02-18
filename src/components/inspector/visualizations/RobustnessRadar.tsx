/**
 * RobustnessRadar — Spider/radar chart showing multi-criteria robustness.
 *
 * Renders a custom SVG radar chart with axes for CV stability, train-test gap,
 * absolute score, and fold coverage. Multiple chains can be overlaid.
 */

import { useMemo, useState, useRef, useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import { useInspectorSelection } from '@/context/InspectorSelectionContext';
import { useInspectorData } from '@/context/InspectorDataContext';
import { INSPECTOR_GROUP_COLORS } from '@/types/inspector';
import type { RobustnessResponse, RobustnessEntry } from '@/types/inspector';

interface RobustnessRadarProps {
  data: RobustnessResponse | null | undefined;
  isLoading: boolean;
}

interface HoveredEntry {
  entry: RobustnessEntry;
  mouseX: number;
  mouseY: number;
}

// Convert polar coordinates to SVG cartesian
function polarToCartesian(cx: number, cy: number, radius: number, angleDeg: number) {
  const angleRad = ((angleDeg - 90) * Math.PI) / 180;
  return {
    x: cx + radius * Math.cos(angleRad),
    y: cy + radius * Math.sin(angleRad),
  };
}

export function RobustnessRadar({ data, isLoading }: RobustnessRadarProps) {
  const { select } = useInspectorSelection();
  const { groups } = useInspectorData();
  const containerRef = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState<HoveredEntry | null>(null);
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

  // Build group color lookup
  const chainColorMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const group of groups) {
      for (const cid of group.chain_ids) {
        map.set(cid, group.color);
      }
    }
    return map;
  }, [groups]);

  const getChainColor = (chainId: string, idx: number) => {
    return chainColorMap.get(chainId) ?? INSPECTOR_GROUP_COLORS[idx % INSPECTOR_GROUP_COLORS.length];
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        <Loader2 className="w-5 h-5 animate-spin mr-2" />
        <span className="text-sm">Loading robustness data...</span>
      </div>
    );
  }

  if (!data || data.entries.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        No robustness data available. Select chains to analyze.
      </div>
    );
  }

  const { entries, axis_names } = data;
  const numAxes = axis_names.length;
  if (numAxes < 3) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        Not enough dimensions for radar chart.
      </div>
    );
  }

  const cx = dims.width / 2;
  const cy = dims.height / 2;
  const maxRadius = Math.min(dims.width, dims.height) / 2 - 50;
  const angleStep = 360 / numAxes;

  // Concentric grid rings (0.25, 0.5, 0.75, 1.0)
  const rings = [0.25, 0.5, 0.75, 1.0];

  // Axis labels from first entry
  const axisLabels = entries[0]?.axes.map(a => a.label) ?? axis_names;

  return (
    <div ref={containerRef} className="w-full h-full relative">
      <svg width={dims.width} height={dims.height} className="select-none">
        {/* Background grid rings */}
        {rings.map((ring, ri) => {
          const r = maxRadius * ring;
          const points = Array.from({ length: numAxes }, (_, i) => {
            const p = polarToCartesian(cx, cy, r, i * angleStep);
            return `${p.x},${p.y}`;
          }).join(' ');

          return (
            <g key={`ring-${ri}`}>
              <polygon
                points={points}
                fill="none"
                stroke="#334155"
                strokeWidth={0.5}
                opacity={0.3}
              />
              {/* Ring label */}
              <text
                x={cx + 4}
                y={cy - r + 3}
                className="fill-muted-foreground"
                fontSize={8}
                opacity={0.6}
              >
                {ring.toFixed(2)}
              </text>
            </g>
          );
        })}

        {/* Axis lines and labels */}
        {axisLabels.map((label, i) => {
          const angle = i * angleStep;
          const endPoint = polarToCartesian(cx, cy, maxRadius, angle);
          const labelPoint = polarToCartesian(cx, cy, maxRadius + 18, angle);

          // Determine text anchor based on position
          let textAnchor: 'start' | 'middle' | 'end' = 'middle';
          if (angle > 10 && angle < 170) textAnchor = 'start';
          else if (angle > 190 && angle < 350) textAnchor = 'end';

          return (
            <g key={`axis-${i}`}>
              <line
                x1={cx}
                y1={cy}
                x2={endPoint.x}
                y2={endPoint.y}
                stroke="#475569"
                strokeWidth={0.5}
                opacity={0.5}
              />
              <text
                x={labelPoint.x}
                y={labelPoint.y}
                textAnchor={textAnchor}
                dominantBaseline="middle"
                className="fill-muted-foreground"
                fontSize={10}
                fontWeight={500}
              >
                {label}
              </text>
            </g>
          );
        })}

        {/* Data polygons — one per entry (chain) */}
        {entries.map((entry, ei) => {
          const color = getChainColor(entry.chain_id, ei);
          const isHov = hovered?.entry.chain_id === entry.chain_id;

          const points = entry.axes.map((axis, ai) => {
            const r = maxRadius * Math.max(0, Math.min(1, axis.value));
            return polarToCartesian(cx, cy, r, ai * angleStep);
          });

          const polygonPoints = points.map(p => `${p.x},${p.y}`).join(' ');

          return (
            <g key={entry.chain_id}>
              {/* Filled area */}
              <polygon
                points={polygonPoints}
                fill={color}
                fillOpacity={isHov ? 0.35 : 0.15}
                stroke={color}
                strokeWidth={isHov ? 2.5 : 1.5}
                cursor="pointer"
                onClick={() => select([entry.chain_id], 'toggle')}
                onMouseEnter={(e) => setHovered({ entry, mouseX: e.clientX, mouseY: e.clientY })}
                onMouseLeave={() => setHovered(null)}
              />
              {/* Vertex dots */}
              {points.map((p, pi) => (
                <circle
                  key={pi}
                  cx={p.x}
                  cy={p.y}
                  r={isHov ? 4 : 3}
                  fill={color}
                  stroke="#fff"
                  strokeWidth={1}
                  pointerEvents="none"
                />
              ))}
            </g>
          );
        })}
      </svg>

      {/* Legend */}
      {entries.length > 1 && (
        <div className="absolute bottom-2 left-2 flex flex-wrap gap-2 max-w-[80%]">
          {entries.slice(0, 8).map((entry, ei) => {
            const color = getChainColor(entry.chain_id, ei);
            return (
              <div key={entry.chain_id} className="flex items-center gap-1 text-[10px] text-muted-foreground">
                <div className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: color }} />
                <span className="truncate max-w-[80px]">{entry.model_class}</span>
              </div>
            );
          })}
          {entries.length > 8 && (
            <span className="text-[10px] text-muted-foreground">+{entries.length - 8} more</span>
          )}
        </div>
      )}

      {/* Tooltip */}
      {hovered && (
        <div
          className="fixed z-50 bg-popover text-popover-foreground text-xs p-2 rounded shadow-md border border-border pointer-events-none"
          style={{ left: hovered.mouseX + 12, top: hovered.mouseY - 60 }}
        >
          <div className="font-medium">{hovered.entry.model_class}</div>
          {hovered.entry.preprocessings && (
            <div className="text-muted-foreground mb-1">{hovered.entry.preprocessings}</div>
          )}
          {hovered.entry.axes.map(axis => (
            <div key={axis.name}>
              {axis.label}: {axis.value.toFixed(2)} (raw: {axis.raw_value.toFixed(4)})
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
