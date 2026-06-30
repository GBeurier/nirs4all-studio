/**
 * ScatterRegl3D - Regl-based 3D scatter plot renderer
 *
 * Features:
 * - GPU-accelerated 3D point rendering using regl's functional API
 * - Orbit controls (rotate, zoom, pan)
 * - GPU-based picking for hover/click detection
 * - SelectionContext integration
 * - Depth-based point size attenuation
 */

import { useRef, useEffect, useCallback, useMemo, useState, forwardRef, useImperativeHandle } from 'react';
import createRegl from 'regl';
import { cn } from '@/lib/utils';
import { useSelection } from '@/context/useSelection';
import { RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { ScatterRendererProps } from './types';
import {
  buildRegl3DPointBufferData,
  buildRegl3DSelectionData,
  calculateRegl3DBounds,
  calculateRegl3DViewportSize,
  computeRegl3DPointColors,
  createRegl3DCameraMatrices,
  createRegl3DIndexMap,
  createRegl3DRectPickingPlan,
  decodeRegl3DPickPixel,
  generateRegl3DGridGeometry,
  type Regl3DGridGeometry,
  type Regl3DPoint,
} from './utils/scatterRegl3DData';
import { OrbitControls } from './utils/orbitControls';
import { createRegl3DDrawCommands } from './ScatterRegl3DCommands';

// ============= Component =============

export interface Scatter3DHandle {
  getPointsInScreenRect: (x1: number, y1: number, x2: number, y2: number) => number[];
}

export const ScatterRegl3D = forwardRef<Scatter3DHandle, ScatterRendererProps & { clearOnBackgroundClick?: boolean }>(({
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
  zLabel,
  onClick,
  onHover,
  className,
  isLoading,
  clearOnBackgroundClick = true,
}, ref) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const reglRef = useRef<createRegl.Regl | null>(null);
  const drawPointsRef = useRef<createRegl.DrawCommand | null>(null);
  const drawPickingRef = useRef<createRegl.DrawCommand | null>(null);
  const drawLinesRef = useRef<createRegl.DrawCommand | null>(null);
  const pickFboRef = useRef<createRegl.Framebuffer2D | null>(null);
  const pickFboSizeRef = useRef<{ width: number; height: number }>({ width: 1, height: 1 });
  const orbitControlsRef = useRef<OrbitControls | null>(null);
  const animationFrameRef = useRef<number>(0);
  const gridDataRef = useRef<Regl3DGridGeometry | null>(null);

  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [, forceUpdate] = useState({});

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
  const effectiveHovered = useSelectionContext ? contextHovered : hoveredIndex;

  // Expose method for getting points within a screen rectangle (for box/lasso selection)
  useImperativeHandle(ref, () => ({
    getPointsInScreenRect: (x1: number, y1: number, x2: number, y2: number): number[] => {
      const canvas = canvasRef.current;
      const regl = reglRef.current;
      const pickFbo = pickFboRef.current;
      if (!canvas || !regl || !pickFbo) return [];

      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio, 2);
      const pickingPlan = createRegl3DRectPickingPlan(x1, y1, x2, y2, rect.height, dpr);
      if (!pickingPlan) return [];

      // Sample the picking buffer at a grid of points
      const foundIndices = new Set<number>();

      for (let sx = pickingPlan.startX; sx <= pickingPlan.endX; sx += pickingPlan.stepSize) {
        for (let sy = pickingPlan.startY; sy <= pickingPlan.endY; sy += pickingPlan.stepSize) {
          const pixel = regl.read({
            framebuffer: pickFbo,
            x: sx,
            y: sy,
            width: 1,
            height: 1,
          });
          const index = decodeRegl3DPickPixel(pixel);
          if (index !== null) {
            foundIndices.add(index);
          }
        }
      }

      return Array.from(foundIndices);
    }
  }), []);

  // Index mapping
  const indexMap = useMemo(() => {
    return createRegl3DIndexMap(points as Regl3DPoint[], indices);
  }, [indices, points]);

  // Calculate data bounds
  const bounds = useMemo(() => calculateRegl3DBounds(points as Regl3DPoint[]), [points]);

  // Calculate colors for each point
  const pointColors = useMemo(() => {
    return computeRegl3DPointColors(points as Regl3DPoint[], colors, values, labels);
  }, [points, colors, values, labels]);

  // Initialize Regl
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const regl = createRegl({
      canvas,
      attributes: {
        alpha: true,
        antialias: true,
        premultipliedAlpha: false,
        depth: true,
      },
      extensions: ['ANGLE_instanced_arrays'],
    });

    reglRef.current = regl;

    // Generate grid data
    gridDataRef.current = generateRegl3DGridGeometry();

    // Create draw commands (points, picking, grid lines)
    const commands = createRegl3DDrawCommands(regl);
    drawPointsRef.current = commands.drawPoints;
    drawPickingRef.current = commands.drawPicking;
    drawLinesRef.current = commands.drawLines;

    // Create picking framebuffer
    pickFboRef.current = regl.framebuffer({
      width: canvas.width || 1,
      height: canvas.height || 1,
      colorType: 'uint8',
      depth: true,
    });

    // Create orbit controls
    orbitControlsRef.current = new OrbitControls(canvas, {
      initialDistance: 5,
      initialTheta: Math.PI / 4,
      initialPhi: Math.PI / 3,
      onChange: () => forceUpdate({}),
    });

    // Cleanup
    return () => {
      cancelAnimationFrame(animationFrameRef.current);
      orbitControlsRef.current?.dispose();
      regl.destroy();
    };
  }, []);

  // Prepare buffer data
  const bufferData = useMemo(() => {
    return buildRegl3DPointBufferData(points as Regl3DPoint[], bounds, pointColors, pointSize, indexMap);
  }, [points, pointColors, pointSize, indexMap, bounds]);

  // Selection/hover data
  const selectionData = useMemo(() => {
    return buildRegl3DSelectionData(
      (points as Regl3DPoint[]).length,
      indexMap,
      selectedSamples,
      pinnedSamples,
      effectiveHovered
    );
  }, [points, indexMap, selectedSamples, pinnedSamples, effectiveHovered]);

  // Render function
  const render = useCallback(() => {
    const canvas = canvasRef.current;
    const regl = reglRef.current;
    const drawPoints = drawPointsRef.current;
    const drawPicking = drawPickingRef.current;
    const drawLines = drawLinesRef.current;
    const pickFbo = pickFboRef.current;
    const orbitControls = orbitControlsRef.current;
    const gridData = gridDataRef.current;

    if (!canvas || !regl || !drawPoints || !drawPicking || !drawLines || !pickFbo || !orbitControls || !gridData) return;

    // Resize canvas if needed
    const rect = canvas.getBoundingClientRect();
    const { width, height, dpr } = calculateRegl3DViewportSize(rect.width, rect.height, window.devicePixelRatio);

    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
      pickFbo.resize(width, height);
      pickFboSizeRef.current = { width, height };
    }

    const viewMatrix = orbitControls.update();
    const { projection: projectionMatrix, model: modelMatrix } = createRegl3DCameraMatrices(width, height);

    // Render to picking buffer
    regl({ framebuffer: pickFbo })(() => {
      regl.clear({ color: [0, 0, 0, 1], depth: 1 });
      if (bufferData.count > 0) {
        drawPicking({
          position: bufferData.position,
          pickColor: bufferData.pickColor,
          size: bufferData.size,
          projection: projectionMatrix,
          view: viewMatrix,
          model: modelMatrix,
          pointScale: dpr,
          count: bufferData.count,
        });
      }
    });

    // Render main scene
    regl.clear({ color: [0, 0, 0, 0], depth: 1 });

    // Draw grid/axes
    if (showGrid || showAxes) {
      drawLines({
        position: gridData.positions,
        color: gridData.colors,
        projection: projectionMatrix,
        view: viewMatrix,
        model: modelMatrix,
        count: gridData.count,
      });
    }

    // Draw points
    if (bufferData.count > 0) {
      drawPoints({
        position: bufferData.position,
        color: bufferData.color,
        size: bufferData.size,
        selected: selectionData.selected,
        hovered: selectionData.hovered,
        projection: projectionMatrix,
        view: viewMatrix,
        model: modelMatrix,
        pointScale: dpr,
        resolution: [width, height],
        hasSelection: selectedSamples.size > 0 ? 1.0 : 0.0,
        count: bufferData.count,
      });
    }
  }, [bufferData, selectionData, selectedSamples, showGrid, showAxes]);

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

  // Read picked index
  const readPickedIndex = useCallback((x: number, y: number): number | null => {
    const regl = reglRef.current;
    const pickFbo = pickFboRef.current;
    if (!regl || !pickFbo) return null;

    const { height } = pickFboSizeRef.current;
    const pixel = regl.read({
      framebuffer: pickFbo,
      x: Math.floor(x),
      y: height - Math.floor(y) - 1,
      width: 1,
      height: 1,
    });

    return decodeRegl3DPickPixel(pixel);
  }, []);

  // Mouse move handler for hover
  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (e.buttons !== 0) return;

      const canvas = canvasRef.current;
      if (!canvas) return;

      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio, 2);
      const x = (e.clientX - rect.left) * dpr;
      const y = (e.clientY - rect.top) * dpr;

      const index = readPickedIndex(x, y);

      if (index !== effectiveHovered) {
        if (useSelectionContext) {
          selectionCtx.setHovered(index);
        } else {
          setHoveredIndex(index);
        }
        onHover?.(index);
      }
    },
    [effectiveHovered, useSelectionContext, selectionCtx, onHover, readPickedIndex]
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
      if (!canvas) return;

      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio, 2);
      const x = (e.clientX - rect.left) * dpr;
      const y = (e.clientY - rect.top) * dpr;

      const index = readPickedIndex(x, y);

      if (index !== null) {
        if (useSelectionContext) {
          if (e.shiftKey) {
            selectionCtx.select([index], 'add');
          } else if (e.ctrlKey || e.metaKey) {
            selectionCtx.toggle([index]);
          } else {
            if (selectedSamples.has(index) && selectedSamples.size === 1) {
              selectionCtx.clear();
            } else {
              selectionCtx.select([index], 'replace');
            }
          }
        }
        onClick?.(index, e.nativeEvent);
      } else {
        // Clicked on background - clear selection (unless disabled for box/lasso selection mode)
        if (clearOnBackgroundClick && useSelectionContext && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
          selectionCtx.clear();
        }
      }
    },
    [useSelectionContext, selectionCtx, selectedSamples, onClick, readPickedIndex, clearOnBackgroundClick]
  );

  // Reset camera
  const handleReset = useCallback(() => {
    orbitControlsRef.current?.reset();
  }, []);

  return (
    <div className={cn('relative w-full h-full', className)}>
      <canvas
        ref={canvasRef}
        className="w-full h-full"
        style={{ touchAction: 'none' }}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        onClick={handleClick}
      />

      {/* Reset button */}
      <Button
        variant="ghost"
        size="sm"
        className="absolute top-2 right-2 h-7 w-7 p-0"
        onClick={handleReset}
        title="Reset camera"
      >
        <RotateCcw className="h-4 w-4" />
      </Button>

      {/* Axis labels - displayed at bottom */}
      {showAxes && (xLabel || yLabel || zLabel) && (
        <div className="absolute bottom-1 left-1/2 -translate-x-1/2 flex items-center gap-3 text-xs">
          {xLabel && (
            <span className="text-red-400">X: {xLabel}</span>
          )}
          {yLabel && (
            <span className="text-green-400">Y: {yLabel}</span>
          )}
          {zLabel && (
            <span className="text-blue-400">Z: {zLabel}</span>
          )}
        </div>
      )}

      {/* Loading overlay */}
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/50">
          <div className="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full" />
        </div>
      )}
    </div>
  );
});

ScatterRegl3D.displayName = 'ScatterRegl3D';
