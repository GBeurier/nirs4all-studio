/**
 * CanvasScatter — High-performance Canvas2D scatter plot for Inspector.
 *
 * Replaces Recharts ScatterChart when point count exceeds a threshold.
 * Uses a single <canvas> element with batched drawing for 10k+ points at 60fps.
 * Spatial grid for O(1) hover/click picking without GPU overhead.
 *
 * Features:
 * - Configurable reference lines (y=x for PredVsObs, y=0 for Residuals)
 * - Grid with auto-calculated tick marks
 * - Per-point coloring and opacity (chain-aware)
 * - Hover tooltip and click-to-select via spatial index
 * - Axis labels and stat annotations
 */

import { useRef, useEffect, useCallback, useMemo, useState, type MouseEvent } from 'react';
import { cn } from '@/lib/utils';

// ============= Types =============

export interface CanvasScatterPoint {
  x: number;
  y: number;
  color: string;
  opacity: number;
  radius: number;
  chainId: string;
  /** Arbitrary data for tooltip rendering */
  meta?: Record<string, unknown>;
}

export interface CanvasReferenceLine {
  type: 'y-equals-x' | 'horizontal' | 'vertical';
  value?: number;
  color: string;
  dash?: number[];
  width?: number;
  label?: string;
}

export interface CanvasAnnotation {
  text: string;
  position: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
}

export interface CanvasScatterProps {
  points: CanvasScatterPoint[];
  referenceLines?: CanvasReferenceLine[];
  annotations?: CanvasAnnotation[];
  xLabel?: string;
  yLabel?: string;
  /** Fixed axis bounds. Auto-calculated from data if not provided. */
  xDomain?: [number, number];
  yDomain?: [number, number];
  /** Point radius for all points (overridden by per-point radius if set) */
  pointRadius?: number;
  /** Show grid lines */
  showGrid?: boolean;
  /** Called when a point is clicked */
  onPointClick?: (point: CanvasScatterPoint, event: MouseEvent) => void;
  /** Called when hover state changes */
  onPointHover?: (point: CanvasScatterPoint | null) => void;
  /** Render a custom tooltip */
  renderTooltip?: (point: CanvasScatterPoint) => React.ReactNode;
  className?: string;
}

// ============= Axis Tick Calculation =============

function niceNum(value: number, round: boolean): number {
  const exp = Math.floor(Math.log10(value));
  const frac = value / Math.pow(10, exp);
  let nice: number;
  if (round) {
    if (frac < 1.5) nice = 1;
    else if (frac < 3) nice = 2;
    else if (frac < 7) nice = 5;
    else nice = 10;
  } else {
    if (frac <= 1) nice = 1;
    else if (frac <= 2) nice = 2;
    else if (frac <= 5) nice = 5;
    else nice = 10;
  }
  return nice * Math.pow(10, exp);
}

function calculateTicks(min: number, max: number, targetCount: number = 6): number[] {
  const range = niceNum(max - min, false);
  const step = niceNum(range / (targetCount - 1), true);
  const start = Math.floor(min / step) * step;
  const ticks: number[] = [];
  for (let t = start; t <= max + step * 0.5; t += step) {
    if (t >= min - step * 0.01) {
      ticks.push(parseFloat(t.toPrecision(10)));
    }
  }
  return ticks;
}

function formatTickValue(value: number): string {
  const abs = Math.abs(value);
  if (abs === 0) return '0';
  if (abs >= 1000) return value.toFixed(0);
  if (abs >= 1) return value.toPrecision(4);
  return value.toPrecision(3);
}

// ============= Spatial Index =============

interface SpatialGrid {
  cellSize: number;
  cells: Map<string, number[]>;
  offsetX: number;
  offsetY: number;
}

function buildSpatialGrid(
  screenPositions: Float64Array,
  count: number,
  cellSize: number = 10,
): SpatialGrid {
  const cells = new Map<string, number[]>();
  const grid: SpatialGrid = { cellSize, cells, offsetX: 0, offsetY: 0 };

  for (let i = 0; i < count; i++) {
    const sx = screenPositions[i * 2];
    const sy = screenPositions[i * 2 + 1];
    const cx = Math.floor(sx / cellSize);
    const cy = Math.floor(sy / cellSize);
    const key = `${cx},${cy}`;
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key)!.push(i);
  }

  return grid;
}

function findNearestPoint(
  grid: SpatialGrid,
  screenPositions: Float64Array,
  points: CanvasScatterPoint[],
  mx: number,
  my: number,
  maxDistance: number = 8,
): number | null {
  const cx = Math.floor(mx / grid.cellSize);
  const cy = Math.floor(my / grid.cellSize);
  const searchRadius = Math.ceil(maxDistance / grid.cellSize);

  let bestIdx: number | null = null;
  let bestDist = maxDistance * maxDistance;

  for (let dx = -searchRadius; dx <= searchRadius; dx++) {
    for (let dy = -searchRadius; dy <= searchRadius; dy++) {
      const key = `${cx + dx},${cy + dy}`;
      const indices = grid.cells.get(key);
      if (!indices) continue;

      for (const idx of indices) {
        const px = screenPositions[idx * 2];
        const py = screenPositions[idx * 2 + 1];
        const dist = (mx - px) * (mx - px) + (my - py) * (my - py);
        if (dist < bestDist) {
          bestDist = dist;
          bestIdx = idx;
        }
      }
    }
  }

  return bestIdx;
}

// ============= Drawing Helpers =============

const MARGIN = { top: 24, right: 20, bottom: 40, left: 56 };

function drawGrid(
  ctx: CanvasRenderingContext2D,
  xTicks: number[],
  yTicks: number[],
  plotW: number,
  plotH: number,
  xMin: number,
  xMax: number,
  yMin: number,
  yMax: number,
  dpr: number,
) {
  ctx.save();
  ctx.strokeStyle = 'rgba(128, 128, 128, 0.15)';
  ctx.lineWidth = dpr;

  const toScreenX = (v: number) => ((v - xMin) / (xMax - xMin)) * plotW;
  const toScreenY = (v: number) => plotH - ((v - yMin) / (yMax - yMin)) * plotH;

  for (const tick of xTicks) {
    const x = toScreenX(tick);
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, plotH);
    ctx.stroke();
  }

  for (const tick of yTicks) {
    const y = toScreenY(tick);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(plotW, y);
    ctx.stroke();
  }

  ctx.restore();
}

function drawAxes(
  ctx: CanvasRenderingContext2D,
  xTicks: number[],
  yTicks: number[],
  plotW: number,
  plotH: number,
  xMin: number,
  xMax: number,
  yMin: number,
  yMax: number,
  dpr: number,
  xLabel?: string,
  yLabel?: string,
) {
  ctx.save();
  const fontSize = 10 * dpr;
  ctx.font = `${fontSize}px sans-serif`;
  ctx.fillStyle = 'rgba(148, 163, 184, 0.8)'; // text-muted
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';

  const toScreenX = (v: number) => ((v - xMin) / (xMax - xMin)) * plotW;
  const toScreenY = (v: number) => plotH - ((v - yMin) / (yMax - yMin)) * plotH;

  // X axis ticks
  for (const tick of xTicks) {
    const x = toScreenX(tick);
    ctx.fillText(formatTickValue(tick), x, plotH + 4 * dpr);
  }

  // Y axis ticks
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (const tick of yTicks) {
    const y = toScreenY(tick);
    ctx.fillText(formatTickValue(tick), -6 * dpr, y);
  }

  // Axis labels
  if (xLabel) {
    const labelSize = 11 * dpr;
    ctx.font = `${labelSize}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(xLabel, plotW / 2, plotH + 22 * dpr);
  }

  if (yLabel) {
    const labelSize = 11 * dpr;
    ctx.font = `${labelSize}px sans-serif`;
    ctx.save();
    ctx.translate(-40 * dpr, plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(yLabel, 0, 0);
    ctx.restore();
  }

  ctx.restore();
}

function drawReferenceLines(
  ctx: CanvasRenderingContext2D,
  lines: CanvasReferenceLine[],
  plotW: number,
  plotH: number,
  xMin: number,
  xMax: number,
  yMin: number,
  yMax: number,
  dpr: number,
) {
  const toScreenX = (v: number) => ((v - xMin) / (xMax - xMin)) * plotW;
  const toScreenY = (v: number) => plotH - ((v - yMin) / (yMax - yMin)) * plotH;

  for (const line of lines) {
    ctx.save();
    ctx.strokeStyle = line.color;
    ctx.lineWidth = (line.width ?? 1) * dpr;
    if (line.dash) ctx.setLineDash(line.dash.map(d => d * dpr));

    ctx.beginPath();
    switch (line.type) {
      case 'y-equals-x': {
        const start = Math.max(xMin, yMin);
        const end = Math.min(xMax, yMax);
        ctx.moveTo(toScreenX(start), toScreenY(start));
        ctx.lineTo(toScreenX(end), toScreenY(end));
        break;
      }
      case 'horizontal': {
        const y = toScreenY(line.value ?? 0);
        ctx.moveTo(0, y);
        ctx.lineTo(plotW, y);
        break;
      }
      case 'vertical': {
        const x = toScreenX(line.value ?? 0);
        ctx.moveTo(x, 0);
        ctx.lineTo(x, plotH);
        break;
      }
    }
    ctx.stroke();
    ctx.restore();
  }
}

function drawPoints(
  ctx: CanvasRenderingContext2D,
  screenPositions: Float64Array,
  points: CanvasScatterPoint[],
  hoveredIdx: number | null,
  dpr: number,
) {
  // Batch by color+opacity for fewer state changes
  // First pass: non-hovered points
  for (let i = 0; i < points.length; i++) {
    if (i === hoveredIdx) continue;
    const p = points[i];
    const sx = screenPositions[i * 2];
    const sy = screenPositions[i * 2 + 1];
    const r = p.radius * dpr;

    ctx.globalAlpha = p.opacity;
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(sx, sy, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // Second pass: hovered point (drawn on top, larger)
  if (hoveredIdx !== null && hoveredIdx < points.length) {
    const p = points[hoveredIdx];
    const sx = screenPositions[hoveredIdx * 2];
    const sy = screenPositions[hoveredIdx * 2 + 1];
    const r = (p.radius + 2) * dpr;

    ctx.globalAlpha = 1;

    // Stroke ring
    ctx.strokeStyle = p.color;
    ctx.lineWidth = 2 * dpr;
    ctx.beginPath();
    ctx.arc(sx, sy, r + dpr, 0, Math.PI * 2);
    ctx.stroke();

    // Fill
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(sx, sy, r, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.globalAlpha = 1;
}

function drawAnnotations(
  ctx: CanvasRenderingContext2D,
  annotations: CanvasAnnotation[],
  plotW: number,
  _plotH: number,
  dpr: number,
) {
  const fontSize = 10 * dpr;
  ctx.font = `${fontSize}px sans-serif`;

  for (const ann of annotations) {
    let x: number, y: number;
    switch (ann.position) {
      case 'top-left':
        x = 4 * dpr;
        y = 4 * dpr;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        break;
      case 'top-right':
        x = plotW - 4 * dpr;
        y = 4 * dpr;
        ctx.textAlign = 'right';
        ctx.textBaseline = 'top';
        break;
      case 'bottom-left':
        x = 4 * dpr;
        y = _plotH - 4 * dpr;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'bottom';
        break;
      case 'bottom-right':
        x = plotW - 4 * dpr;
        y = _plotH - 4 * dpr;
        ctx.textAlign = 'right';
        ctx.textBaseline = 'bottom';
        break;
    }

    // Background
    const metrics = ctx.measureText(ann.text);
    const pad = 3 * dpr;
    const bgX = ctx.textAlign === 'right' ? x - metrics.width - pad : x - pad;
    const bgY = ctx.textBaseline === 'bottom' ? y - fontSize - pad : y - pad;

    ctx.fillStyle = 'rgba(var(--card), 0.85)';
    ctx.fillRect(bgX, bgY, metrics.width + pad * 2, fontSize + pad * 2);

    ctx.fillStyle = 'rgba(148, 163, 184, 0.9)';
    ctx.fillText(ann.text, x, y);
  }
}

// ============= Component =============

/** Point count threshold: above this, use Canvas2D instead of Recharts SVG */
export const CANVAS_SCATTER_THRESHOLD = 500;

export function CanvasScatter({
  points,
  referenceLines = [],
  annotations = [],
  xLabel,
  yLabel,
  xDomain,
  yDomain,
  pointRadius = 3,
  showGrid = true,
  onPointClick,
  onPointHover,
  renderTooltip,
  className,
}: CanvasScatterProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<SpatialGrid | null>(null);
  const screenPosRef = useRef<Float64Array>(new Float64Array(0));
  const rafRef = useRef<number>(0);
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null);

  // Calculate bounds
  const { xMin, xMax, yMin, yMax } = useMemo(() => {
    if (points.length === 0) return { xMin: 0, xMax: 1, yMin: 0, yMax: 1 };

    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    for (const p of points) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }

    const rangeX = maxX - minX || 1;
    const rangeY = maxY - minY || 1;
    const padX = rangeX * 0.05;
    const padY = rangeY * 0.05;

    return {
      xMin: xDomain?.[0] ?? (minX - padX),
      xMax: xDomain?.[1] ?? (maxX + padX),
      yMin: yDomain?.[0] ?? (minY - padY),
      yMax: yDomain?.[1] ?? (maxY + padY),
    };
  }, [points, xDomain, yDomain]);

  const xTicks = useMemo(() => calculateTicks(xMin, xMax), [xMin, xMax]);
  const yTicks = useMemo(() => calculateTicks(yMin, yMax), [yMin, yMax]);

  // Main render
  const render = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const rect = container.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio, 2);
    const w = Math.floor(rect.width * dpr);
    const h = Math.floor(rect.height * dpr);

    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }

    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;

    // Clear with background
    ctx.fillStyle = 'rgb(var(--card))';
    ctx.fillRect(0, 0, w, h);

    const mTop = MARGIN.top * dpr;
    const mRight = MARGIN.right * dpr;
    const mBottom = MARGIN.bottom * dpr;
    const mLeft = MARGIN.left * dpr;
    const plotW = w - mLeft - mRight;
    const plotH = h - mTop - mBottom;

    if (plotW <= 0 || plotH <= 0) return;

    // Transform to plot area
    ctx.save();
    ctx.translate(mLeft, mTop);

    // Plot border
    ctx.strokeStyle = 'rgba(128, 128, 128, 0.2)';
    ctx.lineWidth = dpr;
    ctx.strokeRect(0, 0, plotW, plotH);

    // Grid
    if (showGrid) {
      drawGrid(ctx, xTicks, yTicks, plotW, plotH, xMin, xMax, yMin, yMax, dpr);
    }

    // Reference lines
    if (referenceLines.length > 0) {
      drawReferenceLines(ctx, referenceLines, plotW, plotH, xMin, xMax, yMin, yMax, dpr);
    }

    // Compute screen positions
    const n = points.length;
    if (screenPosRef.current.length !== n * 2) {
      screenPosRef.current = new Float64Array(n * 2);
    }
    const screenPos = screenPosRef.current;
    const xScale = plotW / (xMax - xMin);
    const yScale = plotH / (yMax - yMin);

    for (let i = 0; i < n; i++) {
      screenPos[i * 2] = (points[i].x - xMin) * xScale;
      screenPos[i * 2 + 1] = plotH - (points[i].y - yMin) * yScale;
    }

    // Build spatial grid for picking (on every render since positions may change)
    gridRef.current = buildSpatialGrid(screenPos, n, 12 * dpr);

    // Clip to plot area for points
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, plotW, plotH);
    ctx.clip();

    // Draw points
    drawPoints(ctx, screenPos, points, hoveredIdx, dpr);

    ctx.restore(); // unclip

    // Annotations
    if (annotations.length > 0) {
      drawAnnotations(ctx, annotations, plotW, plotH, dpr);
    }

    // Axes (drawn outside clip)
    drawAxes(ctx, xTicks, yTicks, plotW, plotH, xMin, xMax, yMin, yMax, dpr, xLabel, yLabel);

    ctx.restore(); // untranslate
  }, [points, hoveredIdx, xMin, xMax, yMin, yMax, xTicks, yTicks, showGrid, referenceLines, annotations, xLabel, yLabel]);

  // Render loop: only re-render on state changes, not continuously
  useEffect(() => {
    render();
  }, [render]);

  // Also re-render on resize
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(render);
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [render]);

  // Mouse move → hover
  const handleMouseMove = useCallback((e: MouseEvent) => {
    const canvas = canvasRef.current;
    const grid = gridRef.current;
    if (!canvas || !grid) return;

    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio, 2);
    const mx = (e.clientX - rect.left) * dpr - MARGIN.left * dpr;
    const my = (e.clientY - rect.top) * dpr - MARGIN.top * dpr;

    const idx = findNearestPoint(grid, screenPosRef.current, points, mx, my, 8 * dpr);

    if (idx !== hoveredIdx) {
      setHoveredIdx(idx);
      if (idx !== null) {
        setTooltipPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
        onPointHover?.(points[idx]);
      } else {
        setTooltipPos(null);
        onPointHover?.(null);
      }
    } else if (idx !== null) {
      setTooltipPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    }
  }, [points, hoveredIdx, onPointHover]);

  const handleMouseLeave = useCallback(() => {
    setHoveredIdx(null);
    setTooltipPos(null);
    onPointHover?.(null);
  }, [onPointHover]);

  const handleClick = useCallback((e: MouseEvent) => {
    const canvas = canvasRef.current;
    const grid = gridRef.current;
    if (!canvas || !grid) return;

    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio, 2);
    const mx = (e.clientX - rect.left) * dpr - MARGIN.left * dpr;
    const my = (e.clientY - rect.top) * dpr - MARGIN.top * dpr;

    const idx = findNearestPoint(grid, screenPosRef.current, points, mx, my, 8 * dpr);
    if (idx !== null) {
      onPointClick?.(points[idx], e);
    }
  }, [points, onPointClick]);

  // Tooltip
  const hoveredPoint = hoveredIdx !== null ? points[hoveredIdx] : null;

  return (
    <div ref={containerRef} className={cn('relative w-full h-full', className)}>
      <canvas
        ref={canvasRef}
        className="w-full h-full"
        style={{ touchAction: 'none' }}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        onClick={handleClick}
      />

      {/* Tooltip */}
      {hoveredPoint && tooltipPos && renderTooltip && (
        <div
          className="absolute z-20 pointer-events-none"
          style={{
            left: Math.min(tooltipPos.x + 12, (containerRef.current?.clientWidth ?? 300) - 160),
            top: Math.max(tooltipPos.y - 60, 4),
          }}
        >
          {renderTooltip(hoveredPoint)}
        </div>
      )}
    </div>
  );
}
