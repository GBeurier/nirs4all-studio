/**
 * LearningCurve — Line chart with error bands showing train/val scores vs training size.
 *
 * Custom SVG with ResizeObserver.
 * Train line (teal) + validation line (blue) with ±std shaded polygons.
 */

import { useMemo, useState, useRef, useEffect } from 'react';
import { Loader2, Info } from 'lucide-react';
import type { LearningCurveResponse, LearningCurvePoint } from '@/types/inspector';

interface LearningCurveProps {
  data: LearningCurveResponse | null | undefined;
  isLoading: boolean;
}

interface HoveredPoint {
  point: LearningCurvePoint;
  mouseX: number;
  mouseY: number;
}

const TRAIN_COLOR = '#0d9488';
const VAL_COLOR = '#2563eb';

export function LearningCurve({ data, isLoading }: LearningCurveProps) {
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

  // Compute scales
  const { points, xMin, xMax, yMin, yMax, scaleX, scaleY } = useMemo(() => {
    if (!data?.points?.length) return { points: [], xMin: 0, xMax: 1, yMin: 0, yMax: 1, scaleX: () => 0, scaleY: () => 0 };

    const pts = data.points;
    const marginLeft = 60;
    const marginRight = 15;
    const marginTop = 20;
    const marginBottom = 40;
    const plotW = dims.width - marginLeft - marginRight;
    const plotH = dims.height - marginTop - marginBottom;

    const sizes = pts.map(p => p.train_size);
    const allScores: number[] = [];
    for (const p of pts) {
      if (p.train_mean != null) allScores.push(p.train_mean);
      if (p.val_mean != null) allScores.push(p.val_mean);
      if (p.train_mean != null && p.train_std != null) {
        allScores.push(p.train_mean + p.train_std);
        allScores.push(p.train_mean - p.train_std);
      }
      if (p.val_mean != null && p.val_std != null) {
        allScores.push(p.val_mean + p.val_std);
        allScores.push(p.val_mean - p.val_std);
      }
    }

    const xMn = Math.min(...sizes);
    const xMx = Math.max(...sizes);
    const yMn = allScores.length > 0 ? Math.min(...allScores) : 0;
    const yMx = allScores.length > 0 ? Math.max(...allScores) : 1;
    const xRng = xMx - xMn || 1;
    const yRng = yMx - yMn || 0.001;
    const yPad = yRng * 0.05;

    const sx = (v: number) => marginLeft + ((v - xMn) / xRng) * plotW;
    const sy = (v: number) => marginTop + plotH - ((v - (yMn - yPad)) / (yRng + 2 * yPad)) * plotH;

    return { points: pts, xMin: xMn, xMax: xMx, yMin: yMn - yPad, yMax: yMx + yPad, scaleX: sx, scaleY: sy };
  }, [data, dims]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        <Loader2 className="w-5 h-5 animate-spin mr-2" />
        <span className="text-sm">Loading learning curve...</span>
      </div>
    );
  }

  if (!data || points.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        No learning curve data available.
      </div>
    );
  }

  if (!data.has_multiple_sizes) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm gap-2">
        <Info className="w-4 h-4" />
        <span>All chains have the same training size. Learning curve needs varying sizes.</span>
      </div>
    );
  }

  const marginLeft = 60;
  const marginTop = 20;
  const marginBottom = 40;
  const plotW = dims.width - marginLeft - 15;
  const plotH = dims.height - marginTop - marginBottom;

  // Build band polygons (±std)
  const buildBand = (getMean: (p: LearningCurvePoint) => number | null, getStd: (p: LearningCurvePoint) => number | null) => {
    const validPts = points.filter(p => getMean(p) != null && getStd(p) != null);
    if (validPts.length < 2) return '';
    const upper = validPts.map(p => `${scaleX(p.train_size)},${scaleY(getMean(p)! + getStd(p)!)}`);
    const lower = [...validPts].reverse().map(p => `${scaleX(p.train_size)},${scaleY(getMean(p)! - getStd(p)!)}`);
    return [...upper, ...lower].join(' ');
  };

  const buildLine = (getMean: (p: LearningCurvePoint) => number | null) => {
    return points
      .filter(p => getMean(p) != null)
      .map(p => `${scaleX(p.train_size)},${scaleY(getMean(p)!)}`)
      .join(' ');
  };

  const trainBand = buildBand(p => p.train_mean, p => p.train_std);
  const valBand = buildBand(p => p.val_mean, p => p.val_std);
  const trainLine = buildLine(p => p.train_mean);
  const valLine = buildLine(p => p.val_mean);

  return (
    <div ref={containerRef} className="w-full h-full relative">
      <svg width={dims.width} height={dims.height} className="select-none">
        {/* X axis label */}
        <text
          x={dims.width / 2}
          y={dims.height - 4}
          textAnchor="middle"
          className="fill-muted-foreground"
          fontSize={10}
        >
          Training Size
        </text>

        {/* Y axis label */}
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
          const val = xMin + t * (xMax - xMin);
          return (
            <g key={`xt-${t}`}>
              <line x1={x} y1={marginTop + plotH} x2={x} y2={marginTop + plotH + 4} stroke="currentColor" opacity={0.3} />
              <text x={x} y={marginTop + plotH + 16} textAnchor="middle" className="fill-muted-foreground" fontSize={9}>
                {Math.round(val)}
              </text>
            </g>
          );
        })}

        {/* Y ticks */}
        {[0, 0.25, 0.5, 0.75, 1].map(t => {
          const y = marginTop + plotH - t * plotH;
          const val = yMin + t * (yMax - yMin);
          return (
            <g key={`yt-${t}`}>
              <line x1={marginLeft - 4} y1={y} x2={marginLeft} y2={y} stroke="currentColor" opacity={0.3} />
              <text x={marginLeft - 6} y={y + 3} textAnchor="end" className="fill-muted-foreground" fontSize={9}>
                {val.toFixed(3)}
              </text>
            </g>
          );
        })}

        {/* Train band */}
        {trainBand && (
          <polygon points={trainBand} fill={TRAIN_COLOR} opacity={0.12} />
        )}

        {/* Val band */}
        {valBand && (
          <polygon points={valBand} fill={VAL_COLOR} opacity={0.12} />
        )}

        {/* Train line */}
        {trainLine && (
          <polyline points={trainLine} fill="none" stroke={TRAIN_COLOR} strokeWidth={2} />
        )}

        {/* Val line */}
        {valLine && (
          <polyline points={valLine} fill="none" stroke={VAL_COLOR} strokeWidth={2} />
        )}

        {/* Train dots */}
        {points.filter(p => p.train_mean != null).map((p, i) => (
          <circle
            key={`tr-${i}`}
            cx={scaleX(p.train_size)}
            cy={scaleY(p.train_mean!)}
            r={3}
            fill={TRAIN_COLOR}
            cursor="pointer"
            onMouseEnter={(e) => setHovered({ point: p, mouseX: e.clientX, mouseY: e.clientY })}
            onMouseLeave={() => setHovered(null)}
          />
        ))}

        {/* Val dots */}
        {points.filter(p => p.val_mean != null).map((p, i) => (
          <circle
            key={`vl-${i}`}
            cx={scaleX(p.train_size)}
            cy={scaleY(p.val_mean!)}
            r={3}
            fill={VAL_COLOR}
            cursor="pointer"
            onMouseEnter={(e) => setHovered({ point: p, mouseX: e.clientX, mouseY: e.clientY })}
            onMouseLeave={() => setHovered(null)}
          />
        ))}

        {/* Legend */}
        <g transform={`translate(${marginLeft + 10}, ${marginTop + 8})`}>
          <line x1={0} y1={0} x2={14} y2={0} stroke={TRAIN_COLOR} strokeWidth={2} />
          <text x={18} y={3} className="fill-muted-foreground" fontSize={9}>Train</text>
          <line x1={55} y1={0} x2={69} y2={0} stroke={VAL_COLOR} strokeWidth={2} />
          <text x={73} y={3} className="fill-muted-foreground" fontSize={9}>Validation</text>
        </g>
      </svg>

      {/* Tooltip */}
      {hovered && (
        <div
          className="fixed z-50 bg-popover text-popover-foreground text-xs p-2 rounded shadow-md border border-border pointer-events-none"
          style={{ left: hovered.mouseX + 12, top: hovered.mouseY - 40 }}
        >
          <div className="font-medium">Size: {hovered.point.train_size}</div>
          {hovered.point.train_mean != null && (
            <div>Train: {hovered.point.train_mean.toFixed(4)}{hovered.point.train_std != null ? ` ± ${hovered.point.train_std.toFixed(4)}` : ''}</div>
          )}
          {hovered.point.val_mean != null && (
            <div>Val: {hovered.point.val_mean.toFixed(4)}{hovered.point.val_std != null ? ` ± ${hovered.point.val_std.toFixed(4)}` : ''}</div>
          )}
          <div>Chains: {hovered.point.count}</div>
        </div>
      )}
    </div>
  );
}
