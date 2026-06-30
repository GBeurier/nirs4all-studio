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
import {
  buildCanvasScatterDomain,
  calculateCanvasScatterTicks,
  getCanvasScatterHoveredPoint,
} from '@/lib/inspector/canvasScatterData';
import type {
  CanvasAnnotation,
  CanvasReferenceLine,
  CanvasScatterPoint,
  CanvasScatterSpatialGrid,
} from '@/lib/inspector/canvasScatterData';
import { renderCanvasScatterScene } from './canvasScatterRenderer';
import { CanvasScatterTooltipLayer } from './CanvasScatterTooltipLayer';
import { useCanvasScatterInteraction, type CanvasScatterTooltipPosition } from './useCanvasScatterInteraction';

// ============= Types =============

export type { CanvasAnnotation, CanvasReferenceLine, CanvasScatterPoint };

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
  const gridRef = useRef<CanvasScatterSpatialGrid | null>(null);
  const screenPosRef = useRef<Float64Array>(new Float64Array(0));
  const rafRef = useRef<number>(0);
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const [tooltipPos, setTooltipPos] = useState<CanvasScatterTooltipPosition | null>(null);

  // Calculate bounds
  const { xMin, xMax, yMin, yMax } = useMemo(() => {
    return buildCanvasScatterDomain({ points, xDomain, yDomain });
  }, [points, xDomain, yDomain]);

  const xTicks = useMemo(() => calculateCanvasScatterTicks(xMin, xMax), [xMin, xMax]);
  const yTicks = useMemo(() => calculateCanvasScatterTicks(yMin, yMax), [yMin, yMax]);

  // Main render
  const render = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const result = renderCanvasScatterScene({
      canvas,
      container,
      points,
      referenceLines,
      annotations,
      xTicks,
      yTicks,
      domain: { xMin, xMax, yMin, yMax },
      xLabel,
      yLabel,
      showGrid,
      hoveredIdx,
      screenPositions: screenPosRef.current,
      devicePixelRatio: window.devicePixelRatio,
    });

    if (result.rendered) {
      screenPosRef.current = result.screenPositions;
      gridRef.current = result.spatialGrid;
    }
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

  const {
    handleMouseMove,
    handleMouseLeave,
    handleClick,
  } = useCanvasScatterInteraction({
    canvasRef,
    gridRef,
    screenPositionsRef: screenPosRef,
    points,
    hoveredIndex: hoveredIdx,
    setHoveredIndex: setHoveredIdx,
    setTooltipPosition: setTooltipPos,
    onPointClick,
    onPointHover,
  });

  // Tooltip
  const hoveredPoint = getCanvasScatterHoveredPoint(points, hoveredIdx);

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

      <CanvasScatterTooltipLayer
        point={hoveredPoint}
        position={tooltipPos}
        containerWidth={containerRef.current?.clientWidth ?? 300}
        renderTooltip={renderTooltip}
      />
    </div>
  );
}
