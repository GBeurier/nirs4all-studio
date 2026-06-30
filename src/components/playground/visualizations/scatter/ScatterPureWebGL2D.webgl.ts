/**
 * ScatterPureWebGL2D.webgl - WebGL2 plumbing for the 2D scatter renderer
 *
 * Holds the non-React layer extracted from ScatterPureWebGL2D.tsx:
 * shader sources, program/VAO/buffer construction, buffer uploads,
 * render passes, and GPU picking / selection-click interaction. The
 * React component owns only state, effects, and event wiring.
 */

import type { ShaderProgram, PickingBuffer, DataBounds } from './types';
import {
  buildPointBufferData2D,
  buildSelectionStateData2D,
  createInteractionPickingPlan2D,
  generateGridGeometry2D,
  prepareScatter2DRenderFrame,
  type GridGeometry2D,
  type Point2D,
  type Scatter2DRenderFrame,
  type SelectionClickPlan2D,
} from './utils/scatter2DData';
import {
  createPickingBuffer,
  resizePickingBuffer,
  readPickedIndex,
  destroyPickingBuffer,
} from './utils/picking';

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

uniform float u_hasSelection;

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

  // Dim non-selected points when there's a selection
  if (u_hasSelection > 0.5 && v_selected < 0.5 && v_hovered < 0.5) {
    alpha *= 0.3;
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

interface Scatter2DBuffers {
  position: WebGLBuffer;
  color: WebGLBuffer;
  size: WebGLBuffer;
  selected: WebGLBuffer;
  hovered: WebGLBuffer;
  pickColor: WebGLBuffer;
  linePosition: WebGLBuffer;
  lineColor: WebGLBuffer;
}

interface Scatter2DPrograms {
  main: ShaderProgram;
  pick: ShaderProgram;
  line: ShaderProgram;
}

interface Scatter2DVertexArrays {
  main: WebGLVertexArrayObject | null;
  pick: WebGLVertexArrayObject | null;
  line: WebGLVertexArrayObject | null;
}

export interface Scatter2DWebGLResources {
  gl: WebGL2RenderingContext;
  programs: Scatter2DPrograms;
  vaos: Scatter2DVertexArrays;
  buffers: Scatter2DBuffers;
  pickBuffer: PickingBuffer;
}

export interface Scatter2DRenderOptions {
  bounds: DataBounds;
  preserveAspectRatio: boolean;
  pointCount: number;
  selectedSampleCount: number;
  gridData: GridGeometry2D | null;
}

export interface SelectionActions2D {
  select: (indices: number[], mode: 'add' | 'replace') => void;
  toggle: (indices: number[]) => void;
  clear: () => void;
}

function createScatter2DPrograms(gl: WebGL2RenderingContext): Scatter2DPrograms {
  return {
    main: createProgram(
      gl,
      VERTEX_SHADER,
      FRAGMENT_SHADER,
      ['a_position', 'a_color', 'a_size', 'a_selected', 'a_hovered'],
      ['u_transform', 'u_pointScale', 'u_resolution', 'u_hasSelection']
    ),
    pick: createProgram(
      gl,
      PICKING_VERTEX_SHADER,
      PICKING_FRAGMENT_SHADER,
      ['a_position', 'a_pickColor', 'a_size'],
      ['u_transform', 'u_pointScale']
    ),
    line: createProgram(
      gl,
      LINE_VERTEX_SHADER,
      LINE_FRAGMENT_SHADER,
      ['a_position', 'a_color'],
      ['u_transform']
    ),
  };
}

function createScatter2DVertexArrayHandles(gl: WebGL2RenderingContext): Scatter2DVertexArrays {
  return {
    main: gl.createVertexArray(),
    pick: gl.createVertexArray(),
    line: gl.createVertexArray(),
  };
}

function createScatter2DBuffers(gl: WebGL2RenderingContext): Scatter2DBuffers {
  return {
    position: gl.createBuffer()!,
    color: gl.createBuffer()!,
    size: gl.createBuffer()!,
    selected: gl.createBuffer()!,
    hovered: gl.createBuffer()!,
    pickColor: gl.createBuffer()!,
    linePosition: gl.createBuffer()!,
    lineColor: gl.createBuffer()!,
  };
}

function configureMainVertexArray2D(
  gl: WebGL2RenderingContext,
  vao: WebGLVertexArrayObject | null,
  program: ShaderProgram,
  buffers: Scatter2DBuffers
): void {
  gl.bindVertexArray(vao);

  gl.bindBuffer(gl.ARRAY_BUFFER, buffers.position);
  gl.enableVertexAttribArray(program.attribs.a_position);
  gl.vertexAttribPointer(program.attribs.a_position, 2, gl.FLOAT, false, 0, 0);

  gl.bindBuffer(gl.ARRAY_BUFFER, buffers.color);
  gl.enableVertexAttribArray(program.attribs.a_color);
  gl.vertexAttribPointer(program.attribs.a_color, 4, gl.FLOAT, false, 0, 0);

  gl.bindBuffer(gl.ARRAY_BUFFER, buffers.size);
  gl.enableVertexAttribArray(program.attribs.a_size);
  gl.vertexAttribPointer(program.attribs.a_size, 1, gl.FLOAT, false, 0, 0);

  gl.bindBuffer(gl.ARRAY_BUFFER, buffers.selected);
  gl.enableVertexAttribArray(program.attribs.a_selected);
  gl.vertexAttribPointer(program.attribs.a_selected, 1, gl.FLOAT, false, 0, 0);

  gl.bindBuffer(gl.ARRAY_BUFFER, buffers.hovered);
  gl.enableVertexAttribArray(program.attribs.a_hovered);
  gl.vertexAttribPointer(program.attribs.a_hovered, 1, gl.FLOAT, false, 0, 0);
}

function configurePickingVertexArray2D(
  gl: WebGL2RenderingContext,
  vao: WebGLVertexArrayObject | null,
  program: ShaderProgram,
  buffers: Scatter2DBuffers
): void {
  gl.bindVertexArray(vao);

  gl.bindBuffer(gl.ARRAY_BUFFER, buffers.position);
  gl.enableVertexAttribArray(program.attribs.a_position);
  gl.vertexAttribPointer(program.attribs.a_position, 2, gl.FLOAT, false, 0, 0);

  gl.bindBuffer(gl.ARRAY_BUFFER, buffers.pickColor);
  gl.enableVertexAttribArray(program.attribs.a_pickColor);
  gl.vertexAttribPointer(program.attribs.a_pickColor, 3, gl.FLOAT, false, 0, 0);

  gl.bindBuffer(gl.ARRAY_BUFFER, buffers.size);
  gl.enableVertexAttribArray(program.attribs.a_size);
  gl.vertexAttribPointer(program.attribs.a_size, 1, gl.FLOAT, false, 0, 0);
}

function configureLineVertexArray2D(
  gl: WebGL2RenderingContext,
  vao: WebGLVertexArrayObject | null,
  program: ShaderProgram,
  buffers: Scatter2DBuffers
): void {
  gl.bindVertexArray(vao);

  gl.bindBuffer(gl.ARRAY_BUFFER, buffers.linePosition);
  gl.enableVertexAttribArray(program.attribs.a_position);
  gl.vertexAttribPointer(program.attribs.a_position, 2, gl.FLOAT, false, 0, 0);

  gl.bindBuffer(gl.ARRAY_BUFFER, buffers.lineColor);
  gl.enableVertexAttribArray(program.attribs.a_color);
  gl.vertexAttribPointer(program.attribs.a_color, 4, gl.FLOAT, false, 0, 0);
}

function configureScatter2DVertexArrays(
  gl: WebGL2RenderingContext,
  vaos: Scatter2DVertexArrays,
  programs: Scatter2DPrograms,
  buffers: Scatter2DBuffers
): void {
  configureMainVertexArray2D(gl, vaos.main, programs.main, buffers);
  configurePickingVertexArray2D(gl, vaos.pick, programs.pick, buffers);
  configureLineVertexArray2D(gl, vaos.line, programs.line, buffers);
  gl.bindVertexArray(null);
}

export function createScatter2DWebGLResources(
  canvas: HTMLCanvasElement
): Scatter2DWebGLResources | null {
  const gl = canvas.getContext('webgl2', {
    alpha: true,
    antialias: true,
    premultipliedAlpha: false,
  });
  if (!gl) {
    console.error('WebGL2 not supported');
    return null;
  }

  const programs = createScatter2DPrograms(gl);
  const vaos = createScatter2DVertexArrayHandles(gl);
  const buffers = createScatter2DBuffers(gl);

  configureScatter2DVertexArrays(gl, vaos, programs, buffers);

  return {
    gl,
    programs,
    vaos,
    buffers,
    pickBuffer: createPickingBuffer(gl, canvas.width, canvas.height),
  };
}

export function destroyScatter2DWebGLResources(resources: Scatter2DWebGLResources): void {
  const { gl, programs, vaos, buffers, pickBuffer } = resources;

  destroyPickingBuffer(gl, pickBuffer);

  if (vaos.main) gl.deleteVertexArray(vaos.main);
  if (vaos.pick) gl.deleteVertexArray(vaos.pick);
  if (vaos.line) gl.deleteVertexArray(vaos.line);

  gl.deleteBuffer(buffers.position);
  gl.deleteBuffer(buffers.color);
  gl.deleteBuffer(buffers.size);
  gl.deleteBuffer(buffers.selected);
  gl.deleteBuffer(buffers.hovered);
  gl.deleteBuffer(buffers.pickColor);
  gl.deleteBuffer(buffers.linePosition);
  gl.deleteBuffer(buffers.lineColor);

  gl.deleteProgram(programs.main.program);
  gl.deleteProgram(programs.pick.program);
  gl.deleteProgram(programs.line.program);
}

export function uploadPointBuffers2D(
  gl: WebGL2RenderingContext,
  buffers: Scatter2DBuffers,
  points: readonly Point2D[],
  pointColors: readonly [number, number, number, number][],
  pointSize: number,
  indexMap: readonly number[]
): void {
  const bufferData = buildPointBufferData2D(points, pointColors, pointSize, indexMap);

  gl.bindBuffer(gl.ARRAY_BUFFER, buffers.position);
  gl.bufferData(gl.ARRAY_BUFFER, bufferData.positions, gl.STATIC_DRAW);

  gl.bindBuffer(gl.ARRAY_BUFFER, buffers.color);
  gl.bufferData(gl.ARRAY_BUFFER, bufferData.colors, gl.STATIC_DRAW);

  gl.bindBuffer(gl.ARRAY_BUFFER, buffers.size);
  gl.bufferData(gl.ARRAY_BUFFER, bufferData.sizes, gl.STATIC_DRAW);

  gl.bindBuffer(gl.ARRAY_BUFFER, buffers.pickColor);
  gl.bufferData(gl.ARRAY_BUFFER, bufferData.pickColors, gl.STATIC_DRAW);
}

export function uploadGridBuffers2D(
  gl: WebGL2RenderingContext,
  buffers: Scatter2DBuffers,
  bounds: DataBounds,
  showGrid: boolean,
  showAxes: boolean
): GridGeometry2D {
  const gridData = generateGridGeometry2D(bounds, showGrid, showAxes);

  gl.bindBuffer(gl.ARRAY_BUFFER, buffers.linePosition);
  gl.bufferData(gl.ARRAY_BUFFER, gridData.positions, gl.STATIC_DRAW);

  gl.bindBuffer(gl.ARRAY_BUFFER, buffers.lineColor);
  gl.bufferData(gl.ARRAY_BUFFER, gridData.colors, gl.STATIC_DRAW);

  return gridData;
}

export function uploadSelectionBuffers2D(
  gl: WebGL2RenderingContext,
  buffers: Scatter2DBuffers,
  pointCount: number,
  indexMap: readonly number[],
  selectedSamples: ReadonlySet<number>,
  pinnedSamples: ReadonlySet<number>,
  hoveredSample: number | null
): void {
  const selectionData = buildSelectionStateData2D(
    pointCount,
    indexMap,
    selectedSamples,
    pinnedSamples,
    hoveredSample
  );

  gl.bindBuffer(gl.ARRAY_BUFFER, buffers.selected);
  gl.bufferData(gl.ARRAY_BUFFER, selectionData.selected, gl.DYNAMIC_DRAW);

  gl.bindBuffer(gl.ARRAY_BUFFER, buffers.hovered);
  gl.bufferData(gl.ARRAY_BUFFER, selectionData.hovered, gl.DYNAMIC_DRAW);
}

function prepareCanvasRenderFrame2D(
  canvas: HTMLCanvasElement,
  resources: Scatter2DWebGLResources,
  bounds: DataBounds,
  preserveAspectRatio: boolean
): Scatter2DRenderFrame {
  const rect = canvas.getBoundingClientRect();
  const frame = prepareScatter2DRenderFrame(
    bounds,
    rect,
    window.devicePixelRatio,
    preserveAspectRatio
  );

  if (canvas.width !== frame.width || canvas.height !== frame.height) {
    canvas.width = frame.width;
    canvas.height = frame.height;
    resizePickingBuffer(resources.gl, resources.pickBuffer, frame.width, frame.height);
  }

  return frame;
}

function drawPickingPass2D(
  resources: Scatter2DWebGLResources,
  frame: Scatter2DRenderFrame,
  pointCount: number
): void {
  const { gl, programs, vaos, pickBuffer } = resources;

  gl.bindFramebuffer(gl.FRAMEBUFFER, pickBuffer.framebuffer);
  gl.viewport(0, 0, frame.width, frame.height);
  gl.clearColor(0, 0, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);

  gl.useProgram(programs.pick.program);
  gl.uniformMatrix3fv(programs.pick.uniforms.u_transform, false, frame.transform);
  gl.uniform1f(programs.pick.uniforms.u_pointScale, frame.dpr);

  gl.bindVertexArray(vaos.pick);
  gl.drawArrays(gl.POINTS, 0, pointCount);
}

function drawMainPass2D(
  resources: Scatter2DWebGLResources,
  frame: Scatter2DRenderFrame,
  pointCount: number,
  gridData: GridGeometry2D | null,
  selectedSampleCount: number
): void {
  const { gl, programs, vaos } = resources;

  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, frame.width, frame.height);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);

  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

  if (gridData && gridData.count > 0) {
    gl.useProgram(programs.line.program);
    gl.uniformMatrix3fv(programs.line.uniforms.u_transform, false, frame.transform);
    gl.bindVertexArray(vaos.line);
    gl.drawArrays(gl.LINES, 0, gridData.count);
  }

  gl.useProgram(programs.main.program);
  gl.uniformMatrix3fv(programs.main.uniforms.u_transform, false, frame.transform);
  gl.uniform1f(programs.main.uniforms.u_pointScale, frame.dpr);
  gl.uniform2f(programs.main.uniforms.u_resolution, frame.width, frame.height);
  gl.uniform1f(programs.main.uniforms.u_hasSelection, selectedSampleCount > 0 ? 1.0 : 0.0);

  gl.bindVertexArray(vaos.main);
  gl.drawArrays(gl.POINTS, 0, pointCount);

  gl.bindVertexArray(null);
  gl.disable(gl.BLEND);
}

export function renderScatter2DFrame(
  canvas: HTMLCanvasElement,
  resources: Scatter2DWebGLResources,
  options: Scatter2DRenderOptions
): void {
  if (!resources.vaos.main || !resources.vaos.pick || !resources.vaos.line) return;
  if (options.pointCount === 0) return;

  const frame = prepareCanvasRenderFrame2D(
    canvas,
    resources,
    options.bounds,
    options.preserveAspectRatio
  );

  drawPickingPass2D(resources, frame, options.pointCount);
  drawMainPass2D(
    resources,
    frame,
    options.pointCount,
    options.gridData,
    options.selectedSampleCount
  );
}

export function readPointerPickedIndex2D(
  canvas: HTMLCanvasElement,
  resources: Scatter2DWebGLResources,
  clientX: number,
  clientY: number
): number | null {
  const rect = canvas.getBoundingClientRect();
  const pickPlan = createInteractionPickingPlan2D(
    clientX,
    clientY,
    rect,
    window.devicePixelRatio
  );

  return readPickedIndex(resources.gl, resources.pickBuffer, pickPlan.x, pickPlan.y);
}

export function applySelectionClickPlan2D(
  selection: SelectionActions2D,
  selectionPlan: SelectionClickPlan2D
): void {
  switch (selectionPlan.type) {
    case 'select':
      selection.select([selectionPlan.index], selectionPlan.mode);
      break;
    case 'toggle':
      selection.toggle([selectionPlan.index]);
      break;
    case 'clear':
      selection.clear();
      break;
    case 'none':
      break;
  }
}
