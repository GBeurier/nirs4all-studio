/**
 * ScatterPureWebGL3D - Pure WebGL2 3D scatter plot renderer
 *
 * Features:
 * - GPU-accelerated 3D point rendering (10k+ points at 60fps)
 * - Orbit controls (rotate, zoom, pan)
 * - GPU-based picking for hover/click detection
 * - SelectionContext integration
 * - Depth-based point size attenuation
 * - Simple 3D shading for depth perception
 */

import { useRef, useEffect, useCallback, useMemo, useState, forwardRef, useImperativeHandle } from 'react';
import { cn } from '@/lib/utils';
import { useSelection } from '@/context/useSelection';
import { RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { ScatterRendererProps } from './types';
import { OrbitControls } from './utils/orbitControls';
import {
  buildPointBufferData3D,
  buildSelectionStateData3D,
  createSelectionClickPlan3D,
  prepareScatter3DRenderFrame,
  prepareScatter3DViewState,
  type Point3D,
} from './utils/scatter3DData';
import {
  createScatter3DWebGLResources,
  disposeScatter3DWebGLResources,
  readScatter3DIndicesInScreenRect,
  readScatter3DPickedIndex,
  renderScatter3DFrame,
  resizeScatter3DCanvasToFrame,
  type Scatter3DWebGLResources,
  uploadScatter3DPointBuffers,
  uploadScatter3DSelectionBuffers,
} from './ScatterPureWebGL3D.webgl';

// ============= Shaders =============

const VERTEX_SHADER_3D = `#version 300 es
precision highp float;

uniform mat4 u_projection;
uniform mat4 u_view;
uniform mat4 u_model;
uniform float u_pointScale;
uniform vec2 u_resolution;

in vec3 a_position;
in vec4 a_color;
in float a_size;
in float a_selected;
in float a_hovered;

out vec4 v_color;
out float v_selected;
out float v_hovered;
out float v_depth;

void main() {
  vec4 viewPos = u_view * u_model * vec4(a_position, 1.0);
  gl_Position = u_projection * viewPos;

  // Depth-based size attenuation
  float depthScale = 300.0 / max(-viewPos.z, 0.1);
  float sizeMultiplier = 1.0 + a_selected * 0.6 + a_hovered * 0.4;
  gl_PointSize = a_size * u_pointScale * depthScale * sizeMultiplier * 0.01;

  v_color = a_color;
  v_selected = a_selected;
  v_hovered = a_hovered;
  v_depth = -viewPos.z;
}
`;

const FRAGMENT_SHADER_3D = `#version 300 es
precision highp float;

uniform float u_hasSelection;

in vec4 v_color;
in float v_selected;
in float v_hovered;
in float v_depth;

out vec4 fragColor;

void main() {
  vec2 coord = gl_PointCoord - 0.5;
  float dist = length(coord);

  if (dist > 0.5) discard;

  // Simple spherical shading
  float shade = 0.6 + 0.4 * (1.0 - dist * 2.0);
  float alpha = 1.0 - smoothstep(0.42, 0.5, dist);

  vec4 color = vec4(v_color.rgb * shade, v_color.a);

  // Dark stroke for selected/hovered (better visibility on light and dark backgrounds)
  if ((v_selected > 0.5 || v_hovered > 0.5) && dist > 0.35) {
    color = vec4(0.1, 0.1, 0.1, 1.0);
  }

  // Dim non-selected points when there is an active selection
  if (u_hasSelection > 0.5 && v_selected < 0.5 && v_hovered < 0.5) {
    alpha *= 0.3;
  }

  fragColor = vec4(color.rgb, color.a * alpha);
}
`;

// Picking shaders
const PICKING_VERTEX_SHADER_3D = `#version 300 es
precision highp float;

uniform mat4 u_projection;
uniform mat4 u_view;
uniform mat4 u_model;
uniform float u_pointScale;

in vec3 a_position;
in vec3 a_pickColor;
in float a_size;

out vec3 v_pickColor;

void main() {
  vec4 viewPos = u_view * u_model * vec4(a_position, 1.0);
  gl_Position = u_projection * viewPos;

  float depthScale = 300.0 / max(-viewPos.z, 0.1);
  gl_PointSize = a_size * u_pointScale * depthScale * 0.012; // Slightly larger for picking

  v_pickColor = a_pickColor;
}
`;

const PICKING_FRAGMENT_SHADER_3D = `#version 300 es
precision highp float;

in vec3 v_pickColor;
out vec4 fragColor;

void main() {
  vec2 coord = gl_PointCoord - 0.5;
  if (length(coord) > 0.5) discard;
  fragColor = vec4(v_pickColor, 1.0);
}
`;

// Grid/axis shaders
const LINE_VERTEX_SHADER = `#version 300 es
precision highp float;

uniform mat4 u_projection;
uniform mat4 u_view;
uniform mat4 u_model;

in vec3 a_position;
in vec4 a_color;

out vec4 v_color;

void main() {
  gl_Position = u_projection * u_view * u_model * vec4(a_position, 1.0);
  v_color = a_color;
}
`;

const LINE_FRAGMENT_SHADER = `#version 300 es
precision highp float;

in vec4 v_color;
out vec4 fragColor;

void main() {
  fragColor = v_color;
}
`;

// ============= Component =============

export interface Scatter3DHandle {
  getPointsInScreenRect: (x1: number, y1: number, x2: number, y2: number) => number[];
}

export const ScatterPureWebGL3D = forwardRef<Scatter3DHandle, ScatterRendererProps & { clearOnBackgroundClick?: boolean }>(({
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
  const resourcesRef = useRef<Scatter3DWebGLResources | null>(null);
  const orbitControlsRef = useRef<OrbitControls | null>(null);
  const animationFrameRef = useRef<number>(0);

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
      const resources = resourcesRef.current;
      if (!canvas || !resources) return [];

      return readScatter3DIndicesInScreenRect(
        canvas,
        resources,
        x1,
        y1,
        x2,
        y2,
        window.devicePixelRatio
      );
    }
  }), []);

  const scatterViewState = useMemo(
    () => prepareScatter3DViewState({
      points: points as Point3D[],
      indices,
      colors,
      values,
      labels,
    }),
    [points, indices, colors, values, labels]
  );
  const { points: points3D, indexMap, bounds, pointColors } = scatterViewState;

  // Initialize WebGL
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const gl = canvas.getContext('webgl2', {
      alpha: true,
      antialias: true,
      premultipliedAlpha: false,
      depth: true,
    });
    if (!gl) {
      console.error('WebGL2 not supported');
      return;
    }

    resourcesRef.current = createScatter3DWebGLResources(gl, canvas, {
      mainVertex: VERTEX_SHADER_3D,
      mainFragment: FRAGMENT_SHADER_3D,
      pickingVertex: PICKING_VERTEX_SHADER_3D,
      pickingFragment: PICKING_FRAGMENT_SHADER_3D,
      lineVertex: LINE_VERTEX_SHADER,
      lineFragment: LINE_FRAGMENT_SHADER,
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
      orbitControlsRef.current = null;

      if (resourcesRef.current) {
        disposeScatter3DWebGLResources(resourcesRef.current);
        resourcesRef.current = null;
      }
    };
  }, []);

  // Update buffer data when points/colors change
  useEffect(() => {
    const resources = resourcesRef.current;
    if (!resources) return;

    const bufferData = buildPointBufferData3D(points3D, bounds, pointColors, pointSize, indexMap);
    uploadScatter3DPointBuffers(resources, bufferData);
  }, [points3D, pointColors, pointSize, indexMap, bounds]);

  // Update selection/hover state
  useEffect(() => {
    const resources = resourcesRef.current;
    if (!resources) return;

    const selectionData = buildSelectionStateData3D(
      points3D.length,
      indexMap,
      selectedSamples,
      pinnedSamples,
      effectiveHovered
    );

    uploadScatter3DSelectionBuffers(resources, selectionData);
  }, [points3D, indexMap, selectedSamples, pinnedSamples, effectiveHovered]);

  // Render function
  const render = useCallback(() => {
    const canvas = canvasRef.current;
    const resources = resourcesRef.current;
    const orbitControls = orbitControlsRef.current;

    if (!canvas || !resources || !orbitControls) return;

    const n = points3D.length;

    // Resize canvas if needed
    const rect = canvas.getBoundingClientRect();
    const frame = prepareScatter3DRenderFrame(rect, window.devicePixelRatio);
    resizeScatter3DCanvasToFrame(canvas, resources, frame);

    // Update orbit controls and get view matrix
    const viewMatrix = orbitControls.update();
    renderScatter3DFrame(resources, {
      frame,
      viewMatrix,
      pointCount: n,
      showGrid,
      showAxes,
      hasSelection: selectedSamples.size > 0,
    });
  }, [points3D, showGrid, showAxes, selectedSamples]);

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
      // Skip hover during drag
      if (e.buttons !== 0) return;

      const canvas = canvasRef.current;
      const resources = resourcesRef.current;
      if (!canvas || !resources) return;

      const index = readScatter3DPickedIndex(
        canvas,
        resources,
        e.clientX,
        e.clientY,
        window.devicePixelRatio
      );

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

      const index = readScatter3DPickedIndex(
        canvas,
        resources,
        e.clientX,
        e.clientY,
        window.devicePixelRatio
      );
      const selectionPlan = createSelectionClickPlan3D(index, selectedSamples, {
        shiftKey: e.shiftKey,
        toggleKey: e.ctrlKey || e.metaKey,
        clearOnBackgroundClick,
        useSelectionContext,
      });

      switch (selectionPlan.type) {
        case 'select':
          selectionCtx.select([selectionPlan.index], selectionPlan.mode);
          break;
        case 'toggle':
          selectionCtx.toggle([selectionPlan.index]);
          break;
        case 'clear':
          selectionCtx.clear();
          break;
        case 'none':
          break;
      }

      if (index !== null) {
        onClick?.(index, e.nativeEvent);
      }
    },
    [useSelectionContext, selectionCtx, selectedSamples, onClick, clearOnBackgroundClick]
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

ScatterPureWebGL3D.displayName = 'ScatterPureWebGL3D';
