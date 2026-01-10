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
import { cn } from '@/lib/utils';
import { useSelection } from '@/context/SelectionContext';
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
import { mat3Ortho } from './utils/projectionMatrix';

// ============= Shaders =============

const VERTEX_SHADER = `#version 300 es
precision highp float;

uniform mat3 u_transform;
uniform float u_pointScale;
uniform vec2 u_resolution;

in vec2 a_position;
in vec4 a_color;
in float a_size;
in float a_selected;
in float a_hovered;

out vec4 v_color;
out float v_selected;
out float v_hovered;

void main() {
  vec3 pos = u_transform * vec3(a_position, 1.0);
  gl_Position = vec4(pos.xy, 0.0, 1.0);

  float sizeMultiplier = 1.0 + a_selected * 0.6 + a_hovered * 0.4;
  gl_PointSize = a_size * u_pointScale * sizeMultiplier;

  v_color = a_color;
  v_selected = a_selected;
  v_hovered = a_hovered;
}
`;

const FRAGMENT_SHADER = `#version 300 es
precision highp float;

in vec4 v_color;
in float v_selected;
in float v_hovered;

out vec4 fragColor;

void main() {
  vec2 coord = gl_PointCoord - 0.5;
  float dist = length(coord);

  if (dist > 0.5) discard;

  float alpha = 1.0 - smoothstep(0.42, 0.5, dist);
  vec4 color = v_color;

  // Dark stroke for selected/hovered (better visibility on light and dark backgrounds)
  if ((v_selected > 0.5 || v_hovered > 0.5) && dist > 0.35) {
    color = vec4(0.1, 0.1, 0.1, 1.0);
  }

  fragColor = vec4(color.rgb, color.a * alpha);
}
`;

// Picking shaders (render point IDs as colors)
const PICKING_VERTEX_SHADER = `#version 300 es
precision highp float;

uniform mat3 u_transform;
uniform float u_pointScale;

in vec2 a_position;
in vec3 a_pickColor;
in float a_size;

out vec3 v_pickColor;

void main() {
  vec3 pos = u_transform * vec3(a_position, 1.0);
  gl_Position = vec4(pos.xy, 0.0, 1.0);
  gl_PointSize = a_size * u_pointScale * 1.2; // Slightly larger for easier picking
  v_pickColor = a_pickColor;
}
`;

const PICKING_FRAGMENT_SHADER = `#version 300 es
precision highp float;

in vec3 v_pickColor;
out vec4 fragColor;

void main() {
  vec2 coord = gl_PointCoord - 0.5;
  if (length(coord) > 0.5) discard;
  fragColor = vec4(v_pickColor, 1.0);
}
`;

// Line shaders for grid and axes
const LINE_VERTEX_SHADER = `#version 300 es
precision highp float;

uniform mat3 u_transform;

in vec2 a_position;
in vec4 a_color;

out vec4 v_color;

void main() {
  vec3 pos = u_transform * vec3(a_position, 1.0);
  gl_Position = vec4(pos.xy, 0.0, 1.0);
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

  // Cleanup shaders (attached to program, can be deleted)
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

  // Add padding
  const padX = (maxX - minX) * 0.05 || 0.1;
  const padY = (maxY - minY) * 0.05 || 0.1;

  return {
    minX: minX - padX,
    maxX: maxX + padX,
    minY: minY - padY,
    maxY: maxY + padY,
  };
}

// Calculate nice tick values for an axis
function calculateTicks(min: number, max: number, targetCount: number = 5): number[] {
  const range = max - min;
  if (range <= 0) return [min];

  // Find a nice step size
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

  const gridColor = [0.5, 0.5, 0.5, 0.4]; // Gray with better visibility
  const axisColor = [0.4, 0.4, 0.4, 0.8]; // Darker gray for axes

  if (showGrid) {
    // Calculate tick positions
    const xTicks = calculateTicks(bounds.minX, bounds.maxX);
    const yTicks = calculateTicks(bounds.minY, bounds.maxY);

    // Vertical grid lines
    for (const x of xTicks) {
      positions.push(x, bounds.minY, x, bounds.maxY);
      colors.push(...gridColor, ...gridColor);
    }

    // Horizontal grid lines
    for (const y of yTicks) {
      positions.push(bounds.minX, y, bounds.maxX, y);
      colors.push(...gridColor, ...gridColor);
    }
  }

  if (showAxes) {
    // X axis (if 0 is in range or at boundaries)
    const xAxisY = bounds.minY <= 0 && bounds.maxY >= 0 ? 0 : bounds.minY;
    positions.push(bounds.minX, xAxisY, bounds.maxX, xAxisY);
    colors.push(...axisColor, ...axisColor);

    // Y axis (if 0 is in range or at boundaries)
    const yAxisX = bounds.minX <= 0 && bounds.maxX >= 0 ? 0 : bounds.minX;
    positions.push(yAxisX, bounds.minY, yAxisX, bounds.maxY);
    colors.push(...axisColor, ...axisColor);
  }

  return {
    positions: new Float32Array(positions),
    colors: new Float32Array(colors),
    count: positions.length / 2, // Each vertex has 2 components
  };
}

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
}: ScatterRendererProps & { clearOnBackgroundClick?: boolean }) {
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

  // Use context hovered if available, otherwise local state
  const effectiveHovered = useSelectionContext ? contextHovered : hoveredIndex;

  // Index mapping
  const indexMap = useMemo(() => {
    if (indices) return indices;
    return (points as [number, number][]).map((_, i) => i);
  }, [indices, points]);

  // Calculate data bounds
  const bounds = useMemo(() => calculateBounds(points as [number, number][]), [points]);

  // Calculate colors for each point
  const pointColors = useMemo(() => {
    const result: [number, number, number, number][] = [];
    const pts = points as [number, number][];

    // Get unique labels for categorical coloring
    const uniqueLabels = labels ? [...new Set(labels)] : [];

    // Get value range for continuous coloring
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
      const sampleIdx = indexMap[i];

      // Priority: explicit colors > values > labels > default
      if (colors?.[i]) {
        result.push(cssToRGBA(colors[i]));
      } else if (values && Number.isFinite(values[i])) {
        const t = normalizeValue(values[i], minVal, maxVal);
        result.push(getContinuousColor(t, 'blue_red'));
      } else if (labels?.[i]) {
        const labelIdx = uniqueLabels.indexOf(labels[i]);
        result.push(getCategoricalColor(labelIdx));
      } else {
        result.push([0.231, 0.510, 0.965, 1.0]); // Default blue
      }
    }

    return result;
  }, [points, colors, values, labels, indexMap]);

  // Initialize WebGL
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const gl = canvas.getContext('webgl2', {
      alpha: true,
      antialias: true,
      premultipliedAlpha: false,
    });
    if (!gl) {
      console.error('WebGL2 not supported');
      return;
    }

    glRef.current = gl;

    // Create main program
    mainProgramRef.current = createProgram(
      gl,
      VERTEX_SHADER,
      FRAGMENT_SHADER,
      ['a_position', 'a_color', 'a_size', 'a_selected', 'a_hovered'],
      ['u_transform', 'u_pointScale', 'u_resolution']
    );

    // Create picking program
    pickProgramRef.current = createProgram(
      gl,
      PICKING_VERTEX_SHADER,
      PICKING_FRAGMENT_SHADER,
      ['a_position', 'a_pickColor', 'a_size'],
      ['u_transform', 'u_pointScale']
    );

    // Create line program for grid/axes
    lineProgramRef.current = createProgram(
      gl,
      LINE_VERTEX_SHADER,
      LINE_FRAGMENT_SHADER,
      ['a_position', 'a_color'],
      ['u_transform']
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
    gl.vertexAttribPointer(mainProgram.attribs.a_position, 2, gl.FLOAT, false, 0, 0);

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
    gl.vertexAttribPointer(pickProgram.attribs.a_position, 2, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, pickColorBuffer);
    gl.enableVertexAttribArray(pickProgram.attribs.a_pickColor);
    gl.vertexAttribPointer(pickProgram.attribs.a_pickColor, 3, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, sizeBuffer);
    gl.enableVertexAttribArray(pickProgram.attribs.a_size);
    gl.vertexAttribPointer(pickProgram.attribs.a_size, 1, gl.FLOAT, false, 0, 0);

    // Setup line VAO for grid/axes
    gl.bindVertexArray(lineVao);

    const lineProgram = lineProgramRef.current;
    gl.bindBuffer(gl.ARRAY_BUFFER, linePositionBuffer);
    gl.enableVertexAttribArray(lineProgram.attribs.a_position);
    gl.vertexAttribPointer(lineProgram.attribs.a_position, 2, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, lineColorBuffer);
    gl.enableVertexAttribArray(lineProgram.attribs.a_color);
    gl.vertexAttribPointer(lineProgram.attribs.a_color, 4, gl.FLOAT, false, 0, 0);

    gl.bindVertexArray(null);

    // Create picking buffer
    pickBufferRef.current = createPickingBuffer(gl, canvas.width, canvas.height);

    // Cleanup
    return () => {
      cancelAnimationFrame(animationFrameRef.current);

      if (pickBufferRef.current && glRef.current) {
        destroyPickingBuffer(glRef.current, pickBufferRef.current);
      }

      if (glRef.current) {
        const g = glRef.current;
        if (vaoRef.current) g.deleteVertexArray(vaoRef.current);
        if (pickVaoRef.current) g.deleteVertexArray(pickVaoRef.current);
        if (lineVaoRef.current) g.deleteVertexArray(lineVaoRef.current);
        if (buffersRef.current) {
          g.deleteBuffer(buffersRef.current.position);
          g.deleteBuffer(buffersRef.current.color);
          g.deleteBuffer(buffersRef.current.size);
          g.deleteBuffer(buffersRef.current.selected);
          g.deleteBuffer(buffersRef.current.hovered);
          g.deleteBuffer(buffersRef.current.pickColor);
          g.deleteBuffer(buffersRef.current.linePosition);
          g.deleteBuffer(buffersRef.current.lineColor);
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

    const pts = points as [number, number][];
    const n = pts.length;

    // Position data
    const positions = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      positions[i * 2] = pts[i][0];
      positions[i * 2 + 1] = pts[i][1];
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
  }, [points, pointColors, pointSize, indexMap]);

  // Update grid data when bounds change
  useEffect(() => {
    const gl = glRef.current;
    const buffers = buffersRef.current;
    if (!gl || !buffers) return;

    const gridData = generateGridGeometry(bounds, showGrid, showAxes);
    gridDataRef.current = gridData;

    gl.bindBuffer(gl.ARRAY_BUFFER, buffers.linePosition);
    gl.bufferData(gl.ARRAY_BUFFER, gridData.positions, gl.STATIC_DRAW);

    gl.bindBuffer(gl.ARRAY_BUFFER, buffers.lineColor);
    gl.bufferData(gl.ARRAY_BUFFER, gridData.colors, gl.STATIC_DRAW);
  }, [bounds, showGrid, showAxes]);

  // Update selection/hover state
  useEffect(() => {
    const gl = glRef.current;
    const buffers = buffersRef.current;
    if (!gl || !buffers) return;

    const n = (points as [number, number][]).length;

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
    const gridData = gridDataRef.current;
    if (!canvas || !gl || !mainProgram || !pickProgram || !lineProgram || !vao || !pickVao || !lineVao || !pickBuffer) return;

    const pts = points as [number, number][];
    const n = pts.length;
    if (n === 0) return;

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
        // Data is wider, add padding to Y
        const newH = dataW / aspect;
        const pad = (newH - dataH) / 2;
        bottom -= pad;
        top += pad;
      } else {
        // Data is taller, add padding to X
        const newW = dataH * aspect;
        const pad = (newW - dataW) / 2;
        left -= pad;
        right += pad;
      }
    }
    // When preserveAspectRatio is false, data stretches to fill the container

    const transform = mat3Ortho(left, right, bottom, top);

    // Render picking buffer
    gl.bindFramebuffer(gl.FRAMEBUFFER, pickBuffer.framebuffer);
    gl.viewport(0, 0, width, height);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.useProgram(pickProgram.program);
    gl.uniformMatrix3fv(pickProgram.uniforms.u_transform, false, transform);
    gl.uniform1f(pickProgram.uniforms.u_pointScale, dpr);

    gl.bindVertexArray(pickVao);
    gl.drawArrays(gl.POINTS, 0, n);

    // Render main scene
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, width, height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    // Draw grid/axes first (behind points)
    if (gridData && gridData.count > 0) {
      gl.useProgram(lineProgram.program);
      gl.uniformMatrix3fv(lineProgram.uniforms.u_transform, false, transform);
      gl.bindVertexArray(lineVao);
      gl.drawArrays(gl.LINES, 0, gridData.count);
    }

    // Draw points
    gl.useProgram(mainProgram.program);
    gl.uniformMatrix3fv(mainProgram.uniforms.u_transform, false, transform);
    gl.uniform1f(mainProgram.uniforms.u_pointScale, dpr);
    gl.uniform2f(mainProgram.uniforms.u_resolution, width, height);

    gl.bindVertexArray(vao);
    gl.drawArrays(gl.POINTS, 0, n);

    gl.bindVertexArray(null);
    gl.disable(gl.BLEND);
  }, [points, bounds, showGrid, showAxes, preserveAspectRatio]);

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
