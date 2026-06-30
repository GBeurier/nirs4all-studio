/**
 * ScatterWebGL - High-performance WebGL 2D scatter plot renderer
 *
 * Uses Three.js/react-three-fiber for GPU-accelerated point rendering:
 * - Instanced rendering for 10k+ points at 60fps
 * - Point picking via raycasting
 * - Lasso selection support in screen space
 * - Smooth zoom/pan animations
 *
 * Phase 6: Performance & Polish
 *
 * This module owns the public props, selection-context orchestration, container
 * refs/state/effects, and callback wiring. Pure color/data helpers live in
 * `./ScatterWebGL.helpers`; render-only scene/overlay pieces live in
 * `./ScatterWebGL.scene`.
 */

import { useRef, useMemo, useCallback, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { cn } from '@/lib/utils';
import { useSelection } from '@/context/useSelection';
import { detectDeviceCapabilities } from '@/lib/playground/renderOptimizer';
import type { ScatterWebGLProps } from './ScatterWebGL.types';
import { buildPointData, computeRanges, computeValueRange } from './ScatterWebGL.helpers';
import { ScatterScene, WebGLNotSupported } from './ScatterWebGL.scene';

export type { ScatterWebGLProps } from './ScatterWebGL.types';

export function ScatterWebGL({
  points,
  values,
  labels,
  indices,
  xLabel = 'X',
  yLabel = 'Y',
  pointSize = 6,
  selectedPointSize = 10,
  baseColor = '#3b82f6',
  selectedColor = '#f59e0b',
  pinnedColor = '#ef4444',
  useSelectionContext = true,
  selectedIndices: manualSelectedIndices,
  pinnedIndices: manualPinnedIndices,
  onClick,
  className,
  showGrid = true,
  aspectRatio = 1,
  isLoading = false,
}: ScatterWebGLProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [zoom, setZoom] = useState(1);

  // Selection context - get full context for hover/click dispatching
  const selectionCtx = useSelection();
  const {
    selectedSamples: contextSelectedSamples,
    pinnedSamples: contextPinnedSamples,
    setHovered,
  } = selectionCtx;

  const selectedIndicesSet = useMemo(() => {
    if (useSelectionContext) return contextSelectedSamples;
    return new Set(manualSelectedIndices ?? []);
  }, [useSelectionContext, contextSelectedSamples, manualSelectedIndices]);

  const pinnedIndicesSet = useMemo(() => {
    if (useSelectionContext) return contextPinnedSamples;
    return new Set(manualPinnedIndices ?? []);
  }, [useSelectionContext, contextPinnedSamples, manualPinnedIndices]);

  // Check WebGL support
  const capabilities = useMemo(() => detectDeviceCapabilities(), []);

  // Calculate ranges (filtering out NaN/Infinity values)
  const { xRange, yRange } = useMemo(() => computeRanges(points), [points]);

  // Value range for coloring (filter out NaN/Infinity)
  const { valueMin, valueMax } = useMemo(() => computeValueRange(values), [values]);

  // Label set for categorical coloring
  const labelSet = useMemo(() => new Set(labels ?? []), [labels]);

  // Prepare point data (filter out invalid points)
  const pointData = useMemo(
    () =>
      buildPointData({
        points,
        indices,
        values,
        labels,
        selectedIndicesSet,
        pinnedIndicesSet,
        baseColor,
        selectedColor,
        pinnedColor,
        pointSize,
        selectedPointSize,
        xRange,
        yRange,
        valueMin,
        valueMax,
        labelSet,
      }),
    [
      points,
      indices,
      values,
      labels,
      selectedIndicesSet,
      pinnedIndicesSet,
      baseColor,
      selectedColor,
      pinnedColor,
      pointSize,
      selectedPointSize,
      xRange,
      yRange,
      valueMin,
      valueMax,
      labelSet,
    ]
  );

  // Handle hover
  const handleHover = useCallback(
    (index: number | null) => {
      setHoveredIndex(index);
      if (useSelectionContext) {
        setHovered(index);
      }
    },
    [useSelectionContext, setHovered]
  );

  // Handle click - dispatch to SelectionContext
  const handleClick = useCallback(
    (index: number, event: MouseEvent) => {
      if (useSelectionContext) {
        if (event.shiftKey) {
          selectionCtx.select([index], 'add');
        } else if (event.ctrlKey || event.metaKey) {
          selectionCtx.toggle([index]);
        } else {
          // Toggle selection if clicking the same sample
          if (selectionCtx.selectedSamples.has(index) && selectionCtx.selectedSamples.size === 1) {
            selectionCtx.clear();
          } else {
            selectionCtx.select([index], 'replace');
          }
        }
      }
      onClick?.(index, event);
    },
    [useSelectionContext, selectionCtx, onClick]
  );

  if (!capabilities.webglSupported) {
    return (
      <div ref={containerRef} className={cn('relative w-full h-full', className)}>
        <WebGLNotSupported />
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={cn('relative w-full h-full', className)}
      style={{ aspectRatio: aspectRatio.toString() }}
    >
      {isLoading && (
        <div className="absolute inset-0 bg-background/50 flex items-center justify-center z-10">
          <div className="animate-spin w-6 h-6 border-2 border-primary border-t-transparent rounded-full" />
        </div>
      )}

      <Canvas
        gl={{ antialias: true, alpha: true }}
        dpr={Math.min(window.devicePixelRatio, 2)}
        style={{ background: 'transparent' }}
      >
        <ScatterScene
          pointData={pointData}
          xRange={xRange}
          yRange={yRange}
          xLabel={xLabel}
          yLabel={yLabel}
          showGrid={showGrid}
          onClick={handleClick}
          onHover={handleHover}
          onZoomChange={setZoom}
        />
      </Canvas>

      {/* Tooltip */}
      {hoveredIndex !== null && (
        <div className="absolute top-2 right-2 bg-background/95 border rounded px-2 py-1 text-xs shadow-lg">
          <div className="font-medium">Sample {hoveredIndex}</div>
          {values && values[hoveredIndex] !== undefined && (
            <div className="text-muted-foreground">
              Value: {values[hoveredIndex].toFixed(3)}
            </div>
          )}
          {labels && labels[hoveredIndex] && (
            <div className="text-muted-foreground">{labels[hoveredIndex]}</div>
          )}
        </div>
      )}

      {/* Zoom indicator */}
      {zoom !== 1 && (
        <div className="absolute bottom-2 right-2 text-[10px] text-muted-foreground bg-background/80 px-2 py-0.5 rounded">
          {(zoom * 100).toFixed(0)}%
        </div>
      )}

      {/* Controls hint */}
      <div className="absolute bottom-2 left-2 text-[10px] text-muted-foreground">
        Scroll to zoom • Drag to pan • Click to select
      </div>
    </div>
  );
}

export default ScatterWebGL;
