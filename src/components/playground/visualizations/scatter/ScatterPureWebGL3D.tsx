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
import { useSelection } from '@/context/SelectionContext';
import { RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { ScatterRendererProps, ShaderProgram, PickingBuffer, DataBounds } from './types';
import {
  cssToRGBA,
  getContinuousColor,
  getCategoricalColor,
  indexToPickColor,
  normalizeValue,
} from './utils/colorEncoding';
import {
  createPickingBuffer,
  resizePickingBuffer,
  readPickedIndex,
  destroyPickingBuffer,
} from './utils/picking';
import { mat4Perspective, mat4Identity } from './utils/projectionMatrix';
import { OrbitControls } from './utils/orbitControls';

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

// ============= Helpers =============

function createShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('Failed to create shader');

  gl.shaderSource(shader, source);
  gl.compileShader(shader);

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Shader compile error: ${info}`);
  }

  return shader;
}

function createProgram(
  gl: WebGL2RenderingContext,
  vertexSource: string,
  fragmentSource: string,
  attribNames: string[],
  uniformNames: string[]
): ShaderProgram {
  const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexSource);
  const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fragmentSource);

  const program = gl.createProgram();
  if (!program) throw new Error('Failed to create program');

  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const info = gl.getProgramInfoLog(program);
    throw new Error(`Program link error: ${info}`);
  }

  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);

  const attribs: Record<string, number> = {};
  for (const name of attribNames) {
    attribs[name] = gl.getAttribLocation(program, name);
  }

  const uniforms: Record<string, WebGLUniformLocation | null> = {};
  for (const name of uniformNames) {
    uniforms[name] = gl.getUniformLocation(program, name);
  }

  return { program, attribs, uniforms };
}

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

// Generate grid lines
function generateGridGeometry(): { positions: Float32Array; colors: Float32Array } {
  const positions: number[] = [];
  const colors: number[] = [];
  const gridColor = [0.3, 0.3, 0.3, 0.5];
  const axisColors = {
    x: [1, 0.3, 0.3, 1],
    y: [0.3, 1, 0.3, 1],
    z: [0.3, 0.3, 1, 1],
  };

  // Grid lines on XZ plane (y = -1)
  const gridSize = 1;
  const gridStep = 0.5;
  for (let i = -gridSize; i <= gridSize; i += gridStep) {
    // X lines
    positions.push(-gridSize, -1, i, gridSize, -1, i);
    colors.push(...gridColor, ...gridColor);
    // Z lines
    positions.push(i, -1, -gridSize, i, -1, gridSize);
    colors.push(...gridColor, ...gridColor);
  }

  // Axes
  // X axis (red)
  positions.push(-1.2, -1, 0, 1.2, -1, 0);
  colors.push(...axisColors.x, ...axisColors.x);
  // Y axis (green)
  positions.push(0, -1.2, 0, 0, 1.2, 0);
  colors.push(...axisColors.y, ...axisColors.y);
  // Z axis (blue)
  positions.push(0, -1, -1.2, 0, -1, 1.2);
  colors.push(...axisColors.z, ...axisColors.z);

  return {
    positions: new Float32Array(positions),
    colors: new Float32Array(colors),
  };
}

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
  const glRef = useRef<WebGL2RenderingContext | null>(null);
  const mainProgramRef = useRef<ShaderProgram | null>(null);
  const pickProgramRef = useRef<ShaderProgram | null>(null);
  const lineProgramRef = useRef<ShaderProgram | null>(null);
  const pickBufferRef = useRef<PickingBuffer | null>(null);
  const vaoRef = useRef<WebGLVertexArrayObject | null>(null);
  const pickVaoRef = useRef<WebGLVertexArrayObject | null>(null);
  const lineVaoRef = useRef<WebGLVertexArrayObject | null>(null);
  const buffersRef = useRef<{
    position: WebGLBuffer;
    color: WebGLBuffer;
    size: WebGLBuffer;
    selected: WebGLBuffer;
    hovered: WebGLBuffer;
    pickColor: WebGLBuffer;
    linePosition: WebGLBuffer;
    lineColor: WebGLBuffer;
  } | null>(null);
  const orbitControlsRef = useRef<OrbitControls | null>(null);
  const animationFrameRef = useRef<number>(0);
  const lineCountRef = useRef<number>(0);

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
      const gl = glRef.current;
      const pickBuffer = pickBufferRef.current;
      if (!canvas || !gl || !pickBuffer) return [];

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

      gl.bindFramebuffer(gl.FRAMEBUFFER, pickBuffer.framebuffer);

      for (let sx = canvasX1; sx <= canvasX2; sx += stepSize) {
        for (let sy = flippedY; sy <= flippedY + height; sy += stepSize) {
          const pixel = new Uint8Array(4);
          gl.readPixels(sx, sy, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
          if (pixel[0] !== 0 || pixel[1] !== 0 || pixel[2] !== 0) {
            const index = (pixel[0] << 16) | (pixel[1] << 8) | pixel[2];
            if (index > 0) {
              foundIndices.add(index - 1); // pickColor uses index + 1
            }
          }
        }
      }

      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
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

    glRef.current = gl;

    // Create programs
    mainProgramRef.current = createProgram(
      gl,
      VERTEX_SHADER_3D,
      FRAGMENT_SHADER_3D,
      ['a_position', 'a_color', 'a_size', 'a_selected', 'a_hovered'],
      ['u_projection', 'u_view', 'u_model', 'u_pointScale', 'u_resolution']
    );

    pickProgramRef.current = createProgram(
      gl,
      PICKING_VERTEX_SHADER_3D,
      PICKING_FRAGMENT_SHADER_3D,
      ['a_position', 'a_pickColor', 'a_size'],
      ['u_projection', 'u_view', 'u_model', 'u_pointScale']
    );

    lineProgramRef.current = createProgram(
      gl,
      LINE_VERTEX_SHADER,
      LINE_FRAGMENT_SHADER,
      ['a_position', 'a_color'],
      ['u_projection', 'u_view', 'u_model']
    );

    // Create VAOs and buffers
    const vao = gl.createVertexArray();
    const pickVao = gl.createVertexArray();
    const lineVao = gl.createVertexArray();
    vaoRef.current = vao;
    pickVaoRef.current = pickVao;
    lineVaoRef.current = lineVao;

    const positionBuffer = gl.createBuffer()!;
    const colorBuffer = gl.createBuffer()!;
    const sizeBuffer = gl.createBuffer()!;
    const selectedBuffer = gl.createBuffer()!;
    const hoveredBuffer = gl.createBuffer()!;
    const pickColorBuffer = gl.createBuffer()!;
    const linePositionBuffer = gl.createBuffer()!;
    const lineColorBuffer = gl.createBuffer()!;

    buffersRef.current = {
      position: positionBuffer,
      color: colorBuffer,
      size: sizeBuffer,
      selected: selectedBuffer,
      hovered: hoveredBuffer,
      pickColor: pickColorBuffer,
      linePosition: linePositionBuffer,
      lineColor: lineColorBuffer,
    };

    // Setup main VAO
    gl.bindVertexArray(vao);
    const mainProgram = mainProgramRef.current;

    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.enableVertexAttribArray(mainProgram.attribs.a_position);
    gl.vertexAttribPointer(mainProgram.attribs.a_position, 3, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, colorBuffer);
    gl.enableVertexAttribArray(mainProgram.attribs.a_color);
    gl.vertexAttribPointer(mainProgram.attribs.a_color, 4, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, sizeBuffer);
    gl.enableVertexAttribArray(mainProgram.attribs.a_size);
    gl.vertexAttribPointer(mainProgram.attribs.a_size, 1, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, selectedBuffer);
    gl.enableVertexAttribArray(mainProgram.attribs.a_selected);
    gl.vertexAttribPointer(mainProgram.attribs.a_selected, 1, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, hoveredBuffer);
    gl.enableVertexAttribArray(mainProgram.attribs.a_hovered);
    gl.vertexAttribPointer(mainProgram.attribs.a_hovered, 1, gl.FLOAT, false, 0, 0);

    // Setup picking VAO
    gl.bindVertexArray(pickVao);
    const pickProgram = pickProgramRef.current;

    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.enableVertexAttribArray(pickProgram.attribs.a_position);
    gl.vertexAttribPointer(pickProgram.attribs.a_position, 3, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, pickColorBuffer);
    gl.enableVertexAttribArray(pickProgram.attribs.a_pickColor);
    gl.vertexAttribPointer(pickProgram.attribs.a_pickColor, 3, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, sizeBuffer);
    gl.enableVertexAttribArray(pickProgram.attribs.a_size);
    gl.vertexAttribPointer(pickProgram.attribs.a_size, 1, gl.FLOAT, false, 0, 0);

    // Setup line VAO
    gl.bindVertexArray(lineVao);
    const lineProgram = lineProgramRef.current;

    gl.bindBuffer(gl.ARRAY_BUFFER, linePositionBuffer);
    gl.enableVertexAttribArray(lineProgram.attribs.a_position);
    gl.vertexAttribPointer(lineProgram.attribs.a_position, 3, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, lineColorBuffer);
    gl.enableVertexAttribArray(lineProgram.attribs.a_color);
    gl.vertexAttribPointer(lineProgram.attribs.a_color, 4, gl.FLOAT, false, 0, 0);

    gl.bindVertexArray(null);

    // Setup grid geometry
    const { positions: gridPositions, colors: gridColors } = generateGridGeometry();
    gl.bindBuffer(gl.ARRAY_BUFFER, linePositionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, gridPositions, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, lineColorBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, gridColors, gl.STATIC_DRAW);
    lineCountRef.current = gridPositions.length / 3;

    // Create picking buffer
    pickBufferRef.current = createPickingBuffer(gl, canvas.width, canvas.height);

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

      if (pickBufferRef.current && glRef.current) {
        destroyPickingBuffer(glRef.current, pickBufferRef.current);
      }

      if (glRef.current) {
        const g = glRef.current;
        if (vaoRef.current) g.deleteVertexArray(vaoRef.current);
        if (pickVaoRef.current) g.deleteVertexArray(pickVaoRef.current);
        if (lineVaoRef.current) g.deleteVertexArray(lineVaoRef.current);
        if (buffersRef.current) {
          Object.values(buffersRef.current).forEach((b) => g.deleteBuffer(b));
        }
        if (mainProgramRef.current) g.deleteProgram(mainProgramRef.current.program);
        if (pickProgramRef.current) g.deleteProgram(pickProgramRef.current.program);
        if (lineProgramRef.current) g.deleteProgram(lineProgramRef.current.program);
      }
    };
  }, []);

  // Update buffer data when points/colors change
  useEffect(() => {
    const gl = glRef.current;
    const buffers = buffersRef.current;
    if (!gl || !buffers) return;

    const pts = points as [number, number, number][];
    const n = pts.length;

    // Normalize and pack position data
    const positions = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const [nx, ny, nz] = normalizePoint3D(pts[i][0], pts[i][1], pts[i][2], bounds);
      positions[i * 3] = nx;
      positions[i * 3 + 1] = ny;
      positions[i * 3 + 2] = nz;
    }

    // Color data
    const colorData = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      const c = pointColors[i];
      colorData[i * 4] = c[0];
      colorData[i * 4 + 1] = c[1];
      colorData[i * 4 + 2] = c[2];
      colorData[i * 4 + 3] = c[3];
    }

    // Size data
    const sizes = new Float32Array(n);
    sizes.fill(pointSize);

    // Pick color data
    const pickColors = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const [r, g, b] = indexToPickColor(indexMap[i]);
      pickColors[i * 3] = r;
      pickColors[i * 3 + 1] = g;
      pickColors[i * 3 + 2] = b;
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, buffers.position);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);

    gl.bindBuffer(gl.ARRAY_BUFFER, buffers.color);
    gl.bufferData(gl.ARRAY_BUFFER, colorData, gl.STATIC_DRAW);

    gl.bindBuffer(gl.ARRAY_BUFFER, buffers.size);
    gl.bufferData(gl.ARRAY_BUFFER, sizes, gl.STATIC_DRAW);

    gl.bindBuffer(gl.ARRAY_BUFFER, buffers.pickColor);
    gl.bufferData(gl.ARRAY_BUFFER, pickColors, gl.STATIC_DRAW);
  }, [points, pointColors, pointSize, indexMap, bounds]);

  // Update selection/hover state
  useEffect(() => {
    const gl = glRef.current;
    const buffers = buffersRef.current;
    if (!gl || !buffers) return;

    const n = (points as [number, number, number][]).length;

    const selectedData = new Float32Array(n);
    const hoveredData = new Float32Array(n);

    for (let i = 0; i < n; i++) {
      const sampleIdx = indexMap[i];
      selectedData[i] = selectedSamples.has(sampleIdx) || pinnedSamples.has(sampleIdx) ? 1.0 : 0.0;
      hoveredData[i] = effectiveHovered === sampleIdx ? 1.0 : 0.0;
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, buffers.selected);
    gl.bufferData(gl.ARRAY_BUFFER, selectedData, gl.DYNAMIC_DRAW);

    gl.bindBuffer(gl.ARRAY_BUFFER, buffers.hovered);
    gl.bufferData(gl.ARRAY_BUFFER, hoveredData, gl.DYNAMIC_DRAW);
  }, [points, indexMap, selectedSamples, pinnedSamples, effectiveHovered]);

  // Render function
  const render = useCallback(() => {
    const canvas = canvasRef.current;
    const gl = glRef.current;
    const mainProgram = mainProgramRef.current;
    const pickProgram = pickProgramRef.current;
    const lineProgram = lineProgramRef.current;
    const vao = vaoRef.current;
    const pickVao = pickVaoRef.current;
    const lineVao = lineVaoRef.current;
    const pickBuffer = pickBufferRef.current;
    const orbitControls = orbitControlsRef.current;

    if (!canvas || !gl || !mainProgram || !pickProgram || !lineProgram || !vao || !pickVao || !lineVao || !pickBuffer || !orbitControls) return;

    const pts = points as [number, number, number][];
    const n = pts.length;

    // Resize canvas if needed
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio, 2);
    const width = Math.floor(rect.width * dpr);
    const height = Math.floor(rect.height * dpr);

    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
      resizePickingBuffer(gl, pickBuffer, width, height);
    }

    // Update orbit controls and get view matrix
    const viewMatrix = orbitControls.update();
    const aspect = width / height;
    const projectionMatrix = mat4Perspective(Math.PI / 4, aspect, 0.1, 100);
    const modelMatrix = mat4Identity();

    // Render picking buffer
    gl.bindFramebuffer(gl.FRAMEBUFFER, pickBuffer.framebuffer);
    gl.viewport(0, 0, width, height);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);

    if (n > 0) {
      gl.useProgram(pickProgram.program);
      gl.uniformMatrix4fv(pickProgram.uniforms.u_projection, false, projectionMatrix);
      gl.uniformMatrix4fv(pickProgram.uniforms.u_view, false, viewMatrix);
      gl.uniformMatrix4fv(pickProgram.uniforms.u_model, false, modelMatrix);
      gl.uniform1f(pickProgram.uniforms.u_pointScale, dpr);

      gl.bindVertexArray(pickVao);
      gl.drawArrays(gl.POINTS, 0, n);
    }

    // Render main scene
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, width, height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    // Render grid/axes
    if (showGrid || showAxes) {
      gl.useProgram(lineProgram.program);
      gl.uniformMatrix4fv(lineProgram.uniforms.u_projection, false, projectionMatrix);
      gl.uniformMatrix4fv(lineProgram.uniforms.u_view, false, viewMatrix);
      gl.uniformMatrix4fv(lineProgram.uniforms.u_model, false, modelMatrix);

      gl.bindVertexArray(lineVao);
      gl.drawArrays(gl.LINES, 0, lineCountRef.current);
    }

    // Render points
    if (n > 0) {
      gl.useProgram(mainProgram.program);
      gl.uniformMatrix4fv(mainProgram.uniforms.u_projection, false, projectionMatrix);
      gl.uniformMatrix4fv(mainProgram.uniforms.u_view, false, viewMatrix);
      gl.uniformMatrix4fv(mainProgram.uniforms.u_model, false, modelMatrix);
      gl.uniform1f(mainProgram.uniforms.u_pointScale, dpr);
      gl.uniform2f(mainProgram.uniforms.u_resolution, width, height);

      gl.bindVertexArray(vao);
      gl.drawArrays(gl.POINTS, 0, n);
    }

    gl.bindVertexArray(null);
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
  }, [points, showGrid, showAxes]);

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
      const gl = glRef.current;
      const pickBuffer = pickBufferRef.current;
      if (!canvas || !gl || !pickBuffer) return;

      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio, 2);
      const x = (e.clientX - rect.left) * dpr;
      const y = (e.clientY - rect.top) * dpr;

      const index = readPickedIndex(gl, pickBuffer, x, y);

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
      const gl = glRef.current;
      const pickBuffer = pickBufferRef.current;
      if (!canvas || !gl || !pickBuffer) return;

      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio, 2);
      const x = (e.clientX - rect.left) * dpr;
      const y = (e.clientY - rect.top) * dpr;

      const index = readPickedIndex(gl, pickBuffer, x, y);

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
