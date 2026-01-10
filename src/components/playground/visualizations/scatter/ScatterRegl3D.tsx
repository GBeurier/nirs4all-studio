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
import { useSelection } from '@/context/SelectionContext';
import { RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { ScatterRendererProps, DataBounds } from './types';
import {
  cssToRGBA,
  getContinuousColor,
  getCategoricalColor,
  indexToPickColor,
  pickColorToIndex,
  normalizeValue,
} from './utils/colorEncoding';
import { mat4Perspective, mat4Identity } from './utils/projectionMatrix';
import { OrbitControls } from './utils/orbitControls';

// ============= Types =============

interface Point3DUniforms {
  projection: Float32Array;
  view: Float32Array;
  model: Float32Array;
  pointScale: number;
  resolution: [number, number];
}

interface Point3DAttributes {
  position: Float32Array;
  color: Float32Array;
  size: Float32Array;
  selected: Float32Array;
  hovered: Float32Array;
}

interface Pick3DAttributes {
  position: Float32Array;
  pickColor: Float32Array;
  size: Float32Array;
}

// ============= Helpers =============

function calculate3DBounds(points: [number, number, number][]): DataBounds & { minZ: number; maxZ: number } {
  if (points.length === 0) {
    return { minX: -1, maxX: 1, minY: -1, maxY: 1, minZ: -1, maxZ: 1 };
  }

  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;

  for (const [x, y, z] of points) {
    if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      minZ = Math.min(minZ, z);
      maxZ = Math.max(maxZ, z);
    }
  }

  return { minX, maxX, minY, maxY, minZ, maxZ };
}

function normalizePoint3D(
  x: number, y: number, z: number,
  bounds: DataBounds & { minZ: number; maxZ: number }
): [number, number, number] {
  const rangeX = bounds.maxX - bounds.minX || 1;
  const rangeY = bounds.maxY - bounds.minY || 1;
  const rangeZ = bounds.maxZ - bounds.minZ || 1;

  return [
    ((x - bounds.minX) / rangeX) * 2 - 1,
    ((y - bounds.minY) / rangeY) * 2 - 1,
    ((z - bounds.minZ) / rangeZ) * 2 - 1,
  ];
}

// Grid lines geometry
function generateGridGeometry(): { positions: number[]; colors: number[] } {
  const positions: number[] = [];
  const colors: number[] = [];
  const gridColor = [0.3, 0.3, 0.3, 0.5];
  const axisColors = {
    x: [1, 0.3, 0.3, 1],
    y: [0.3, 1, 0.3, 1],
    z: [0.3, 0.3, 1, 1],
  };

  const gridSize = 1;
  const gridStep = 0.5;
  for (let i = -gridSize; i <= gridSize; i += gridStep) {
    positions.push(-gridSize, -1, i, gridSize, -1, i);
    colors.push(...gridColor, ...gridColor);
    positions.push(i, -1, -gridSize, i, -1, gridSize);
    colors.push(...gridColor, ...gridColor);
  }

  positions.push(-1.2, -1, 0, 1.2, -1, 0);
  colors.push(...axisColors.x, ...axisColors.x);
  positions.push(0, -1.2, 0, 0, 1.2, 0);
  colors.push(...axisColors.y, ...axisColors.y);
  positions.push(0, -1, -1.2, 0, -1, 1.2);
  colors.push(...axisColors.z, ...axisColors.z);

  return { positions, colors };
}

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
  const gridDataRef = useRef<{ positions: number[]; colors: number[] } | null>(null);

  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [, forceUpdate] = useState({});

  // Selection context
  const selectionCtx = useSelection();
  const selectedSamples = useSelectionContext
    ? selectionCtx.selectedSamples
    : new Set(manualSelectedIndices ?? []);
  const pinnedSamples = useSelectionContext
    ? selectionCtx.pinnedSamples
    : new Set(manualPinnedIndices ?? []);
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

      // Convert screen coords to canvas coords
      const canvasX1 = Math.floor(Math.min(x1, x2) * dpr);
      const canvasY1 = Math.floor(Math.min(y1, y2) * dpr);
      const canvasX2 = Math.floor(Math.max(x1, x2) * dpr);
      const canvasY2 = Math.floor(Math.max(y1, y2) * dpr);

      const width = canvasX2 - canvasX1;
      const height = canvasY2 - canvasY1;
      if (width <= 0 || height <= 0) return [];

      // Read from picking buffer
      const canvasHeight = Math.floor(rect.height * dpr);
      const flippedY = canvasHeight - canvasY2; // WebGL Y is flipped

      // Sample the picking buffer at a grid of points
      const foundIndices = new Set<number>();
      const stepSize = Math.max(2, Math.floor(Math.min(width, height) / 50)); // Sample ~50 points per dimension

      for (let sx = canvasX1; sx <= canvasX2; sx += stepSize) {
        for (let sy = flippedY; sy <= flippedY + height; sy += stepSize) {
          const pixel = regl.read({
            framebuffer: pickFbo,
            x: sx,
            y: sy,
            width: 1,
            height: 1,
          });
          if (pixel[0] !== 0 || pixel[1] !== 0 || pixel[2] !== 0) {
            const index = (pixel[0] << 16) | (pixel[1] << 8) | pixel[2];
            if (index > 0) {
              foundIndices.add(index - 1); // pickColor uses index + 1
            }
          }
        }
      }

      return Array.from(foundIndices);
    }
  }), []);

  // Index mapping
  const indexMap = useMemo(() => {
    if (indices) return indices;
    return (points as [number, number, number][]).map((_, i) => i);
  }, [indices, points]);

  // Calculate data bounds
  const bounds = useMemo(() => calculate3DBounds(points as [number, number, number][]), [points]);

  // Calculate colors for each point
  const pointColors = useMemo(() => {
    const result: [number, number, number, number][] = [];
    const pts = points as [number, number, number][];
    const uniqueLabels = labels ? [...new Set(labels)] : [];

    let minVal = Infinity, maxVal = -Infinity;
    if (values) {
      for (const v of values) {
        if (Number.isFinite(v)) {
          minVal = Math.min(minVal, v);
          maxVal = Math.max(maxVal, v);
        }
      }
    }

    for (let i = 0; i < pts.length; i++) {
      if (colors?.[i]) {
        result.push(cssToRGBA(colors[i]));
      } else if (values && Number.isFinite(values[i])) {
        const t = normalizeValue(values[i], minVal, maxVal);
        result.push(getContinuousColor(t, 'blue_red'));
      } else if (labels?.[i]) {
        const labelIdx = uniqueLabels.indexOf(labels[i]);
        result.push(getCategoricalColor(labelIdx));
      } else {
        result.push([0.231, 0.510, 0.965, 1.0]);
      }
    }

    return result;
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
    gridDataRef.current = generateGridGeometry();

    // Create draw command for main rendering
    drawPointsRef.current = regl({
      vert: `
        precision highp float;
        attribute vec3 position;
        attribute vec4 color;
        attribute float size;
        attribute float selected;
        attribute float hovered;

        uniform mat4 projection;
        uniform mat4 view;
        uniform mat4 model;
        uniform float pointScale;

        varying vec4 vColor;
        varying float vSelected;
        varying float vHovered;

        void main() {
          vec4 viewPos = view * model * vec4(position, 1.0);
          gl_Position = projection * viewPos;

          float depthScale = 300.0 / max(-viewPos.z, 0.1);
          float sizeMult = 1.0 + selected * 0.6 + hovered * 0.4;
          gl_PointSize = size * pointScale * depthScale * sizeMult * 0.01;

          vColor = color;
          vSelected = selected;
          vHovered = hovered;
        }
      `,
      frag: `
        precision highp float;
        varying vec4 vColor;
        varying float vSelected;
        varying float vHovered;

        void main() {
          vec2 coord = gl_PointCoord - 0.5;
          float dist = length(coord);

          if (dist > 0.5) discard;

          float shade = 0.6 + 0.4 * (1.0 - dist * 2.0);
          float alpha = 1.0 - smoothstep(0.42, 0.5, dist);

          vec4 color = vec4(vColor.rgb * shade, vColor.a);

          if ((vSelected > 0.5 || vHovered > 0.5) && dist > 0.35) {
            color = vec4(0.1, 0.1, 0.1, 1.0);
          }

          gl_FragColor = vec4(color.rgb, color.a * alpha);
        }
      `,
      attributes: {
        position: regl.prop<Point3DAttributes, 'position'>('position'),
        color: regl.prop<Point3DAttributes, 'color'>('color'),
        size: regl.prop<Point3DAttributes, 'size'>('size'),
        selected: regl.prop<Point3DAttributes, 'selected'>('selected'),
        hovered: regl.prop<Point3DAttributes, 'hovered'>('hovered'),
      },
      uniforms: {
        projection: regl.prop<Point3DUniforms, 'projection'>('projection'),
        view: regl.prop<Point3DUniforms, 'view'>('view'),
        model: regl.prop<Point3DUniforms, 'model'>('model'),
        pointScale: regl.prop<Point3DUniforms, 'pointScale'>('pointScale'),
        resolution: regl.prop<Point3DUniforms, 'resolution'>('resolution'),
      },
      count: regl.prop<{ count: number }, 'count'>('count'),
      primitive: 'points',
      blend: {
        enable: true,
        func: {
          srcRGB: 'src alpha',
          dstRGB: 'one minus src alpha',
          srcAlpha: 'one',
          dstAlpha: 'one minus src alpha',
        },
      },
      depth: { enable: true },
    });

    // Create draw command for picking
    drawPickingRef.current = regl({
      vert: `
        precision highp float;
        attribute vec3 position;
        attribute vec3 pickColor;
        attribute float size;

        uniform mat4 projection;
        uniform mat4 view;
        uniform mat4 model;
        uniform float pointScale;

        varying vec3 vPickColor;

        void main() {
          vec4 viewPos = view * model * vec4(position, 1.0);
          gl_Position = projection * viewPos;

          float depthScale = 300.0 / max(-viewPos.z, 0.1);
          gl_PointSize = size * pointScale * depthScale * 0.012;

          vPickColor = pickColor;
        }
      `,
      frag: `
        precision highp float;
        varying vec3 vPickColor;

        void main() {
          vec2 coord = gl_PointCoord - 0.5;
          if (length(coord) > 0.5) discard;
          gl_FragColor = vec4(vPickColor, 1.0);
        }
      `,
      attributes: {
        position: regl.prop<Pick3DAttributes, 'position'>('position'),
        pickColor: regl.prop<Pick3DAttributes, 'pickColor'>('pickColor'),
        size: regl.prop<Pick3DAttributes, 'size'>('size'),
      },
      uniforms: {
        projection: regl.prop<Point3DUniforms, 'projection'>('projection'),
        view: regl.prop<Point3DUniforms, 'view'>('view'),
        model: regl.prop<Point3DUniforms, 'model'>('model'),
        pointScale: regl.prop<Point3DUniforms, 'pointScale'>('pointScale'),
      },
      count: regl.prop<{ count: number }, 'count'>('count'),
      primitive: 'points',
      depth: { enable: true },
    });

    // Create draw command for grid lines
    drawLinesRef.current = regl({
      vert: `
        precision highp float;
        attribute vec3 position;
        attribute vec4 color;

        uniform mat4 projection;
        uniform mat4 view;
        uniform mat4 model;

        varying vec4 vColor;

        void main() {
          gl_Position = projection * view * model * vec4(position, 1.0);
          vColor = color;
        }
      `,
      frag: `
        precision highp float;
        varying vec4 vColor;

        void main() {
          gl_FragColor = vColor;
        }
      `,
      attributes: {
        position: regl.prop<{ position: number[] }, 'position'>('position'),
        color: regl.prop<{ color: number[] }, 'color'>('color'),
      },
      uniforms: {
        projection: regl.prop<Point3DUniforms, 'projection'>('projection'),
        view: regl.prop<Point3DUniforms, 'view'>('view'),
        model: regl.prop<Point3DUniforms, 'model'>('model'),
      },
      count: regl.prop<{ count: number }, 'count'>('count'),
      primitive: 'lines',
      blend: {
        enable: true,
        func: {
          srcRGB: 'src alpha',
          dstRGB: 'one minus src alpha',
          srcAlpha: 'one',
          dstAlpha: 'one minus src alpha',
        },
      },
      depth: { enable: true },
    });

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
    const pts = points as [number, number, number][];
    const n = pts.length;

    const position = new Float32Array(n * 3);
    const color = new Float32Array(n * 4);
    const size = new Float32Array(n);
    const pickColor = new Float32Array(n * 3);

    for (let i = 0; i < n; i++) {
      const [nx, ny, nz] = normalizePoint3D(pts[i][0], pts[i][1], pts[i][2], bounds);
      position[i * 3] = nx;
      position[i * 3 + 1] = ny;
      position[i * 3 + 2] = nz;

      const c = pointColors[i];
      color[i * 4] = c[0];
      color[i * 4 + 1] = c[1];
      color[i * 4 + 2] = c[2];
      color[i * 4 + 3] = c[3];

      size[i] = pointSize;

      const [r, g, b] = indexToPickColor(indexMap[i]);
      pickColor[i * 3] = r;
      pickColor[i * 3 + 1] = g;
      pickColor[i * 3 + 2] = b;
    }

    return { position, color, size, pickColor, count: n };
  }, [points, pointColors, pointSize, indexMap, bounds]);

  // Selection/hover data
  const selectionData = useMemo(() => {
    const n = (points as [number, number, number][]).length;
    const selected = new Float32Array(n);
    const hovered = new Float32Array(n);

    for (let i = 0; i < n; i++) {
      const sampleIdx = indexMap[i];
      selected[i] = selectedSamples.has(sampleIdx) || pinnedSamples.has(sampleIdx) ? 1.0 : 0.0;
      hovered[i] = effectiveHovered === sampleIdx ? 1.0 : 0.0;
    }

    return { selected, hovered };
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
    const dpr = Math.min(window.devicePixelRatio, 2);
    const width = Math.floor(rect.width * dpr);
    const height = Math.floor(rect.height * dpr);

    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
      pickFbo.resize(width, height);
      pickFboSizeRef.current = { width, height };
    }

    const viewMatrix = orbitControls.update();
    const aspect = width / height;
    const projectionMatrix = mat4Perspective(Math.PI / 4, aspect, 0.1, 100);
    const modelMatrix = mat4Identity();

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
        count: gridData.positions.length / 3,
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
        count: bufferData.count,
      });
    }
  }, [bufferData, selectionData, showGrid, showAxes]);

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

    return pickColorToIndex(pixel[0], pixel[1], pixel[2]);
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
