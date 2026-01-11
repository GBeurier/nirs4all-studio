/**
 * ScatterRegl2D - Regl-based 2D scatter plot renderer
 *
 * Features:
 * - GPU-accelerated point rendering using regl's functional API
 * - GPU-based picking for hover/click detection
 * - SelectionContext integration
 * - Continuous and categorical coloring
 * - Cleaner code than raw WebGL with same performance
 */

import { useRef, useEffect, useCallback, useMemo, useState } from 'react';
import createRegl from 'regl';
import { cn } from '@/lib/utils';
import { useSelection } from '@/context/SelectionContext';
import type { ScatterRendererProps, DataBounds } from './types';
import {
  cssToRGBA,
  getContinuousColor,
  getCategoricalColor,
  indexToPickColor,
  pickColorToIndex,
  normalizeValue,
} from './utils/colorEncoding';

// ============= Types =============

interface PointUniforms {
  transform: Float32Array;
  pointScale: number;
  resolution: [number, number];
}

interface PointAttributes {
  position: Float32Array;
  color: Float32Array;
  size: Float32Array;
  selected: Float32Array;
  hovered: Float32Array;
}

interface PickAttributes {
  position: Float32Array;
  pickColor: Float32Array;
  size: Float32Array;
}

// ============= Helpers =============

function calculateBounds(points: [number, number][]): DataBounds {
  if (points.length === 0) {
    return { minX: -1, maxX: 1, minY: -1, maxY: 1 };
  }

  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;

  for (const [x, y] of points) {
    if (Number.isFinite(x) && Number.isFinite(y)) {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  }

  const padX = (maxX - minX) * 0.05 || 0.1;
  const padY = (maxY - minY) * 0.05 || 0.1;

  return {
    minX: minX - padX,
    maxX: maxX + padX,
    minY: minY - padY,
    maxY: maxY + padY,
  };
}

function mat3Ortho(
  left: number,
  right: number,
  bottom: number,
  top: number
): Float32Array {
  const w = right - left;
  const h = top - bottom;

  return new Float32Array([
    2 / w, 0, 0,
    0, 2 / h, 0,
    -(right + left) / w, -(top + bottom) / h, 1,
  ]);
}

// Calculate nice tick values for an axis
function calculateTicks(min: number, max: number, targetCount: number = 5): number[] {
  const range = max - min;
  if (range <= 0) return [min];

  const roughStep = range / targetCount;
  const magnitude = Math.pow(10, Math.floor(Math.log10(roughStep)));
  const normalized = roughStep / magnitude;

  let niceStep: number;
  if (normalized <= 1.5) niceStep = magnitude;
  else if (normalized <= 3) niceStep = 2 * magnitude;
  else if (normalized <= 7) niceStep = 5 * magnitude;
  else niceStep = 10 * magnitude;

  const ticks: number[] = [];
  const start = Math.ceil(min / niceStep) * niceStep;

  for (let t = start; t <= max + niceStep * 0.001; t += niceStep) {
    if (t >= min - niceStep * 0.001 && t <= max + niceStep * 0.001) {
      ticks.push(t);
    }
  }

  return ticks;
}

// Generate grid geometry (lines and colors)
function generateGridGeometry(
  bounds: DataBounds,
  showGrid: boolean,
  showAxes: boolean
): { positions: Float32Array; colors: Float32Array; count: number } {
  const positions: number[] = [];
  const colors: number[] = [];

  const gridColor = [0.5, 0.5, 0.5, 0.4];
  const axisColor = [0.4, 0.4, 0.4, 0.8];

  if (showGrid) {
    const xTicks = calculateTicks(bounds.minX, bounds.maxX);
    const yTicks = calculateTicks(bounds.minY, bounds.maxY);

    for (const x of xTicks) {
      positions.push(x, bounds.minY, x, bounds.maxY);
      colors.push(...gridColor, ...gridColor);
    }

    for (const y of yTicks) {
      positions.push(bounds.minX, y, bounds.maxX, y);
      colors.push(...gridColor, ...gridColor);
    }
  }

  if (showAxes) {
    const xAxisY = bounds.minY <= 0 && bounds.maxY >= 0 ? 0 : bounds.minY;
    positions.push(bounds.minX, xAxisY, bounds.maxX, xAxisY);
    colors.push(...axisColor, ...axisColor);

    const yAxisX = bounds.minX <= 0 && bounds.maxX >= 0 ? 0 : bounds.minX;
    positions.push(yAxisX, bounds.minY, yAxisX, bounds.maxY);
    colors.push(...axisColor, ...axisColor);
  }

  return {
    positions: new Float32Array(positions),
    colors: new Float32Array(colors),
    count: positions.length / 2,
  };
}

interface LineAttributes {
  position: Float32Array;
  color: Float32Array;
}

// ============= Component =============

export function ScatterRegl2D({
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
  const reglRef = useRef<createRegl.Regl | null>(null);
  const drawPointsRef = useRef<createRegl.DrawCommand | null>(null);
  const drawPickingRef = useRef<createRegl.DrawCommand | null>(null);
  const drawLinesRef = useRef<createRegl.DrawCommand | null>(null);
  const pickFboRef = useRef<createRegl.Framebuffer2D | null>(null);
  const pickFboSizeRef = useRef<{ width: number; height: number }>({ width: 1, height: 1 });
  const animationFrameRef = useRef<number>(0);
  const gridDataRef = useRef<{ positions: Float32Array; colors: Float32Array; count: number } | null>(null);

  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

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

  // Index mapping
  const indexMap = useMemo(() => {
    if (indices) return indices;
    return (points as [number, number][]).map((_, i) => i);
  }, [indices, points]);

  // Calculate data bounds - use customBounds if provided, otherwise calculate from data
  const bounds = useMemo(() => {
    if (customBounds) return customBounds;
    return calculateBounds(points as [number, number][]);
  }, [points, customBounds]);

  // Calculate colors for each point
  const pointColors = useMemo(() => {
    const result: [number, number, number, number][] = [];
    const pts = points as [number, number][];
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
      },
      extensions: ['ANGLE_instanced_arrays'],
    });

    reglRef.current = regl;

    // Create draw command for main rendering
    drawPointsRef.current = regl({
      vert: `
        precision highp float;
        attribute vec2 position;
        attribute vec4 color;
        attribute float size;
        attribute float selected;
        attribute float hovered;

        uniform mat3 transform;
        uniform float pointScale;

        varying vec4 vColor;
        varying float vSelected;
        varying float vHovered;

        void main() {
          vec3 pos = transform * vec3(position, 1.0);
          gl_Position = vec4(pos.xy, 0.0, 1.0);

          float sizeMult = 1.0 + selected * 0.6 + hovered * 0.4;
          gl_PointSize = size * pointScale * sizeMult;

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

          float alpha = 1.0 - smoothstep(0.42, 0.5, dist);
          vec4 color = vColor;

          if ((vSelected > 0.5 || vHovered > 0.5) && dist > 0.35) {
            color = vec4(0.1, 0.1, 0.1, 1.0);
          }

          gl_FragColor = vec4(color.rgb, color.a * alpha);
        }
      `,
      attributes: {
        position: regl.prop<PointAttributes, 'position'>('position'),
        color: regl.prop<PointAttributes, 'color'>('color'),
        size: regl.prop<PointAttributes, 'size'>('size'),
        selected: regl.prop<PointAttributes, 'selected'>('selected'),
        hovered: regl.prop<PointAttributes, 'hovered'>('hovered'),
      },
      uniforms: {
        transform: regl.prop<PointUniforms, 'transform'>('transform'),
        pointScale: regl.prop<PointUniforms, 'pointScale'>('pointScale'),
        resolution: regl.prop<PointUniforms, 'resolution'>('resolution'),
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
      depth: { enable: false },
    });

    // Create draw command for picking
    drawPickingRef.current = regl({
      vert: `
        precision highp float;
        attribute vec2 position;
        attribute vec3 pickColor;
        attribute float size;

        uniform mat3 transform;
        uniform float pointScale;

        varying vec3 vPickColor;

        void main() {
          vec3 pos = transform * vec3(position, 1.0);
          gl_Position = vec4(pos.xy, 0.0, 1.0);
          gl_PointSize = size * pointScale * 1.2;
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
        position: regl.prop<PickAttributes, 'position'>('position'),
        pickColor: regl.prop<PickAttributes, 'pickColor'>('pickColor'),
        size: regl.prop<PickAttributes, 'size'>('size'),
      },
      uniforms: {
        transform: regl.prop<PointUniforms, 'transform'>('transform'),
        pointScale: regl.prop<PointUniforms, 'pointScale'>('pointScale'),
      },
      count: regl.prop<{ count: number }, 'count'>('count'),
      primitive: 'points',
      depth: { enable: false },
    });

    // Create picking framebuffer
    pickFboRef.current = regl.framebuffer({
      width: canvas.width || 1,
      height: canvas.height || 1,
      colorType: 'uint8',
    });

    // Create draw command for grid lines
    drawLinesRef.current = regl({
      vert: `
        precision highp float;
        attribute vec2 position;
        attribute vec4 color;

        uniform mat3 transform;

        varying vec4 vColor;

        void main() {
          vec3 pos = transform * vec3(position, 1.0);
          gl_Position = vec4(pos.xy, 0.0, 1.0);
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
        position: regl.prop<LineAttributes, 'position'>('position'),
        color: regl.prop<LineAttributes, 'color'>('color'),
      },
      uniforms: {
        transform: regl.prop<PointUniforms, 'transform'>('transform'),
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
      depth: { enable: false },
    });

    // Cleanup
    return () => {
      cancelAnimationFrame(animationFrameRef.current);
      regl.destroy();
    };
  }, []);

  // Prepare buffer data
  const bufferData = useMemo(() => {
    const pts = points as [number, number][];
    const n = pts.length;

    const position = new Float32Array(n * 2);
    const color = new Float32Array(n * 4);
    const size = new Float32Array(n);
    const pickColor = new Float32Array(n * 3);

    for (let i = 0; i < n; i++) {
      position[i * 2] = pts[i][0];
      position[i * 2 + 1] = pts[i][1];

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
  }, [points, pointColors, pointSize, indexMap]);

  // Selection/hover data (changes frequently)
  const selectionData = useMemo(() => {
    const n = (points as [number, number][]).length;
    const selected = new Float32Array(n);
    const hovered = new Float32Array(n);

    for (let i = 0; i < n; i++) {
      const sampleIdx = indexMap[i];
      selected[i] = selectedSamples.has(sampleIdx) || pinnedSamples.has(sampleIdx) ? 1.0 : 0.0;
      hovered[i] = effectiveHovered === sampleIdx ? 1.0 : 0.0;
    }

    return { selected, hovered };
  }, [points, indexMap, selectedSamples, pinnedSamples, effectiveHovered]);

  // Grid data for lines
  const gridData = useMemo(() => {
    return generateGridGeometry(bounds, showGrid, showAxes);
  }, [bounds, showGrid, showAxes]);

  // Render function
  const render = useCallback(() => {
    const canvas = canvasRef.current;
    const regl = reglRef.current;
    const drawPoints = drawPointsRef.current;
    const drawPicking = drawPickingRef.current;
    const drawLines = drawLinesRef.current;
    const pickFbo = pickFboRef.current;

    if (!canvas || !regl || !drawPoints || !drawPicking || !drawLines || !pickFbo) return;
    if (bufferData.count === 0) return;

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

    // Calculate transform matrix
    let left = bounds.minX, right = bounds.maxX;
    let bottom = bounds.minY, top = bounds.maxY;

    if (preserveAspectRatio) {
      // Maintain aspect ratio (equal scaling on X and Y)
      const aspect = width / height;
      const dataW = bounds.maxX - bounds.minX;
      const dataH = bounds.maxY - bounds.minY;
      const dataAspect = dataW / dataH;

      if (dataAspect > aspect) {
        const newH = dataW / aspect;
        const pad = (newH - dataH) / 2;
        bottom -= pad;
        top += pad;
      } else {
        const newW = dataH * aspect;
        const pad = (newW - dataW) / 2;
        left -= pad;
        right += pad;
      }
    }
    // When preserveAspectRatio is false, data stretches to fill the container

    const transform = mat3Ortho(left, right, bottom, top);

    // Render to picking buffer
    regl({ framebuffer: pickFbo })(() => {
      regl.clear({ color: [0, 0, 0, 1] });
      drawPicking({
        position: bufferData.position,
        pickColor: bufferData.pickColor,
        size: bufferData.size,
        transform,
        pointScale: dpr,
        count: bufferData.count,
      });
    });

    // Render main scene
    regl.clear({ color: [0, 0, 0, 0] });

    // Draw grid/axes first (behind points)
    if (gridData.count > 0) {
      drawLines({
        position: gridData.positions,
        color: gridData.colors,
        transform,
        count: gridData.count,
      });
    }

    // Draw points
    drawPoints({
      position: bufferData.position,
      color: bufferData.color,
      size: bufferData.size,
      selected: selectionData.selected,
      hovered: selectionData.hovered,
      transform,
      pointScale: dpr,
      resolution: [width, height],
      count: bufferData.count,
    });
  }, [bufferData, selectionData, bounds, gridData, preserveAspectRatio]);

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

      {/* Axis labels */}
      {showAxes && (
        <>
          {xLabel && (
            <div className="absolute bottom-1 left-1/2 -translate-x-1/2 text-xs text-muted-foreground">
              {xLabel}
            </div>
          )}
          {yLabel && (
            <div className="absolute left-1 top-1/2 -translate-y-1/2 -rotate-90 origin-center text-xs text-muted-foreground">
              {yLabel}
            </div>
          )}
        </>
      )}

      {/* Loading overlay */}
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/50">
          <div className="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full" />
        </div>
      )}
    </div>
  );
}
