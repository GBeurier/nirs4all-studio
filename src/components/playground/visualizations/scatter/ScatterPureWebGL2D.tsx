/**
 * ScatterPureWebGL2D - Pure WebGL2 2D scatter plot renderer
 *
 * Features:
 * - GPU-accelerated point rendering (10k+ points at 60fps)
 * - GPU-based picking for hover/click detection
 * - SelectionContext integration
 * - Continuous and categorical coloring
 * - Antialiased circular points with selection highlighting
 */

import { useRef, useEffect, useCallback, useMemo, useState } from 'react';
import { useSelection } from '@/context/useSelection';
import type { ScatterRendererProps, DataBounds } from './types';
import { ScatterPureWebGL2DShell } from './ScatterPureWebGL2DShell';
import {
  createSelectionClickPlan2D,
  prepareScatter2DViewState,
  type GridGeometry2D,
  type Point2D,
} from './utils/scatter2DData';
import {
  createScatter2DWebGLResources,
  destroyScatter2DWebGLResources,
  uploadPointBuffers2D,
  uploadGridBuffers2D,
  uploadSelectionBuffers2D,
  renderScatter2DFrame,
  readPointerPickedIndex2D,
  applySelectionClickPlan2D,
  type Scatter2DWebGLResources,
} from './ScatterPureWebGL2D.webgl';

// ============= Component =============

export function ScatterPureWebGL2D({
  points,
  indices,
  colors,
  values,
  labels,
  useSelectionContext = true,
  selectedIndices: manualSelectedIndices,
  pinnedIndices: manualPinnedIndices,
  selectedColor = 'hsl(var(--primary))',
  pinnedColor = 'hsl(45, 90%, 50%)',
  hoveredColor = 'hsl(var(--primary))',
  pointSize = 8,
  selectedSizeMultiplier = 1.5,
  showGrid = true,
  showAxes = true,
  xLabel,
  yLabel,
  onClick,
  onHover,
  className,
  isLoading,
  clearOnBackgroundClick = true,
  preserveAspectRatio = false,
  customBounds,
}: ScatterRendererProps & { clearOnBackgroundClick?: boolean; customBounds?: DataBounds }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const resourcesRef = useRef<Scatter2DWebGLResources | null>(null);
  const animationFrameRef = useRef<number>(0);
  const gridDataRef = useRef<GridGeometry2D | null>(null);

  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  // Selection context
  const selectionCtx = useSelection();
  const manualSelectedSamples = useMemo(
    () => new Set(manualSelectedIndices ?? []),
    [manualSelectedIndices]
  );
  const manualPinnedSamples = useMemo(
    () => new Set(manualPinnedIndices ?? []),
    [manualPinnedIndices]
  );
  const selectedSamples = useSelectionContext
    ? selectionCtx.selectedSamples
    : manualSelectedSamples;
  const pinnedSamples = useSelectionContext
    ? selectionCtx.pinnedSamples
    : manualPinnedSamples;
  const contextHovered = useSelectionContext ? selectionCtx.hoveredSample : null;

  // Use context hovered if available, otherwise local state
  const effectiveHovered = useSelectionContext ? contextHovered : hoveredIndex;

  const scatterViewState = useMemo(
    () => prepareScatter2DViewState({
      points: points as Point2D[],
      indices,
      colors,
      values,
      labels,
      customBounds,
    }),
    [points, indices, colors, values, labels, customBounds]
  );
  const { points: points2D, indexMap, bounds, pointColors } = scatterViewState;

  // Initialize WebGL
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const resources = createScatter2DWebGLResources(canvas);
    if (!resources) return;
    resourcesRef.current = resources;

    // Cleanup
    return () => {
      cancelAnimationFrame(animationFrameRef.current);
      destroyScatter2DWebGLResources(resources);
      if (resourcesRef.current === resources) {
        resourcesRef.current = null;
      }
    };
  }, []);

  // Update buffer data when points/colors change
  useEffect(() => {
    const resources = resourcesRef.current;
    if (!resources) return;

    uploadPointBuffers2D(
      resources.gl,
      resources.buffers,
      points2D,
      pointColors,
      pointSize,
      indexMap
    );
  }, [points2D, pointColors, pointSize, indexMap]);

  // Update grid data when bounds change
  useEffect(() => {
    const resources = resourcesRef.current;
    if (!resources) return;

    gridDataRef.current = uploadGridBuffers2D(
      resources.gl,
      resources.buffers,
      bounds,
      showGrid,
      showAxes
    );
  }, [bounds, showGrid, showAxes]);

  // Update selection/hover state
  useEffect(() => {
    const resources = resourcesRef.current;
    if (!resources) return;

    uploadSelectionBuffers2D(
      resources.gl,
      resources.buffers,
      points2D.length,
      indexMap,
      selectedSamples,
      pinnedSamples,
      effectiveHovered
    );
  }, [points2D, indexMap, selectedSamples, pinnedSamples, effectiveHovered]);

  // Render function
  const render = useCallback(() => {
    const canvas = canvasRef.current;
    const resources = resourcesRef.current;
    if (!canvas || !resources) return;

    renderScatter2DFrame(canvas, resources, {
      bounds,
      preserveAspectRatio,
      pointCount: points2D.length,
      selectedSampleCount: selectedSamples.size,
      gridData: gridDataRef.current,
    });
  }, [points2D, bounds, preserveAspectRatio, selectedSamples]);

  // Animation loop
  useEffect(() => {
    let running = true;

    const loop = () => {
      if (!running) return;
      render();
      animationFrameRef.current = requestAnimationFrame(loop);
    };

    loop();

    return () => {
      running = false;
      cancelAnimationFrame(animationFrameRef.current);
    };
  }, [render]);

  // Mouse move handler for hover
  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      const resources = resourcesRef.current;
      if (!canvas || !resources) return;

      const index = readPointerPickedIndex2D(canvas, resources, e.clientX, e.clientY);

      if (index !== effectiveHovered) {
        if (useSelectionContext) {
          selectionCtx.setHovered(index);
        } else {
          setHoveredIndex(index);
        }
        onHover?.(index);
      }
    },
    [effectiveHovered, useSelectionContext, selectionCtx, onHover]
  );

  // Mouse leave handler
  const handleMouseLeave = useCallback(() => {
    if (useSelectionContext) {
      selectionCtx.setHovered(null);
    } else {
      setHoveredIndex(null);
    }
    onHover?.(null);
  }, [useSelectionContext, selectionCtx, onHover]);

  // Click handler
  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      const resources = resourcesRef.current;
      if (!canvas || !resources) return;

      const index = readPointerPickedIndex2D(canvas, resources, e.clientX, e.clientY);
      const selectionPlan = createSelectionClickPlan2D(index, selectedSamples, {
        shiftKey: e.shiftKey,
        toggleKey: e.ctrlKey || e.metaKey,
        clearOnBackgroundClick,
        useSelectionContext,
      });

      applySelectionClickPlan2D(selectionCtx, selectionPlan);

      if (index !== null) {
        onClick?.(index, e.nativeEvent);
      }
    },
    [useSelectionContext, selectionCtx, selectedSamples, onClick, clearOnBackgroundClick]
  );

  return (
    <ScatterPureWebGL2DShell
      canvasRef={canvasRef}
      className={className}
      showAxes={showAxes}
      xLabel={xLabel}
      yLabel={yLabel}
      isLoading={isLoading}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      onClick={handleClick}
    />
  );
}
