import type { PickingBuffer, ShaderProgram } from './types';
import {
  createPickingBuffer,
  destroyPickingBuffer,
  readPickedIndex,
  resizePickingBuffer,
} from './utils/picking';
import {
  createInteractionPickingPlan3D,
  createInteractionRectPickingPlan3D,
  generateGridGeometry3D,
  pickPixelToIndex,
  type PointBufferData3D,
  type Scatter3DRenderFrame,
  type SelectionStateData3D,
} from './utils/scatter3DData';

interface Scatter3DProgramSources {
  mainVertex: string;
  mainFragment: string;
  pickingVertex: string;
  pickingFragment: string;
  lineVertex: string;
  lineFragment: string;
}

interface Scatter3DPrograms {
  main: ShaderProgram;
  pick: ShaderProgram;
  line: ShaderProgram;
}

interface Scatter3DVertexArrays {
  main: WebGLVertexArrayObject | null;
  pick: WebGLVertexArrayObject | null;
  line: WebGLVertexArrayObject | null;
}

interface Scatter3DBuffers {
  position: WebGLBuffer;
  color: WebGLBuffer;
  size: WebGLBuffer;
  selected: WebGLBuffer;
  hovered: WebGLBuffer;
  pickColor: WebGLBuffer;
  linePosition: WebGLBuffer;
  lineColor: WebGLBuffer;
}

export interface Scatter3DWebGLResources {
  gl: WebGL2RenderingContext;
  programs: Scatter3DPrograms;
  vaos: Scatter3DVertexArrays;
  buffers: Scatter3DBuffers;
  pickBuffer: PickingBuffer;
  lineCount: number;
}

interface Scatter3DFrameRenderOptions {
  frame: Scatter3DRenderFrame;
  viewMatrix: Float32Array;
  pointCount: number;
  showGrid: boolean;
  showAxes: boolean;
  hasSelection: boolean;
}

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

function createScatter3DPrograms(
  gl: WebGL2RenderingContext,
  sources: Scatter3DProgramSources
): Scatter3DPrograms {
  return {
    main: createProgram(
      gl,
      sources.mainVertex,
      sources.mainFragment,
      ['a_position', 'a_color', 'a_size', 'a_selected', 'a_hovered'],
      ['u_projection', 'u_view', 'u_model', 'u_pointScale', 'u_resolution', 'u_hasSelection']
    ),
    pick: createProgram(
      gl,
      sources.pickingVertex,
      sources.pickingFragment,
      ['a_position', 'a_pickColor', 'a_size'],
      ['u_projection', 'u_view', 'u_model', 'u_pointScale']
    ),
    line: createProgram(
      gl,
      sources.lineVertex,
      sources.lineFragment,
      ['a_position', 'a_color'],
      ['u_projection', 'u_view', 'u_model']
    ),
  };
}

function createScatter3DVertexArrays(gl: WebGL2RenderingContext): Scatter3DVertexArrays {
  return {
    main: gl.createVertexArray(),
    pick: gl.createVertexArray(),
    line: gl.createVertexArray(),
  };
}

function createScatter3DBuffers(gl: WebGL2RenderingContext): Scatter3DBuffers {
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

function configureScatter3DVertexArrays(
  gl: WebGL2RenderingContext,
  programs: Scatter3DPrograms,
  vaos: Scatter3DVertexArrays,
  buffers: Scatter3DBuffers
): void {
  gl.bindVertexArray(vaos.main);

  gl.bindBuffer(gl.ARRAY_BUFFER, buffers.position);
  gl.enableVertexAttribArray(programs.main.attribs.a_position);
  gl.vertexAttribPointer(programs.main.attribs.a_position, 3, gl.FLOAT, false, 0, 0);

  gl.bindBuffer(gl.ARRAY_BUFFER, buffers.color);
  gl.enableVertexAttribArray(programs.main.attribs.a_color);
  gl.vertexAttribPointer(programs.main.attribs.a_color, 4, gl.FLOAT, false, 0, 0);

  gl.bindBuffer(gl.ARRAY_BUFFER, buffers.size);
  gl.enableVertexAttribArray(programs.main.attribs.a_size);
  gl.vertexAttribPointer(programs.main.attribs.a_size, 1, gl.FLOAT, false, 0, 0);

  gl.bindBuffer(gl.ARRAY_BUFFER, buffers.selected);
  gl.enableVertexAttribArray(programs.main.attribs.a_selected);
  gl.vertexAttribPointer(programs.main.attribs.a_selected, 1, gl.FLOAT, false, 0, 0);

  gl.bindBuffer(gl.ARRAY_BUFFER, buffers.hovered);
  gl.enableVertexAttribArray(programs.main.attribs.a_hovered);
  gl.vertexAttribPointer(programs.main.attribs.a_hovered, 1, gl.FLOAT, false, 0, 0);

  gl.bindVertexArray(vaos.pick);

  gl.bindBuffer(gl.ARRAY_BUFFER, buffers.position);
  gl.enableVertexAttribArray(programs.pick.attribs.a_position);
  gl.vertexAttribPointer(programs.pick.attribs.a_position, 3, gl.FLOAT, false, 0, 0);

  gl.bindBuffer(gl.ARRAY_BUFFER, buffers.pickColor);
  gl.enableVertexAttribArray(programs.pick.attribs.a_pickColor);
  gl.vertexAttribPointer(programs.pick.attribs.a_pickColor, 3, gl.FLOAT, false, 0, 0);

  gl.bindBuffer(gl.ARRAY_BUFFER, buffers.size);
  gl.enableVertexAttribArray(programs.pick.attribs.a_size);
  gl.vertexAttribPointer(programs.pick.attribs.a_size, 1, gl.FLOAT, false, 0, 0);

  gl.bindVertexArray(vaos.line);

  gl.bindBuffer(gl.ARRAY_BUFFER, buffers.linePosition);
  gl.enableVertexAttribArray(programs.line.attribs.a_position);
  gl.vertexAttribPointer(programs.line.attribs.a_position, 3, gl.FLOAT, false, 0, 0);

  gl.bindBuffer(gl.ARRAY_BUFFER, buffers.lineColor);
  gl.enableVertexAttribArray(programs.line.attribs.a_color);
  gl.vertexAttribPointer(programs.line.attribs.a_color, 4, gl.FLOAT, false, 0, 0);

  gl.bindVertexArray(null);
}

function uploadInitialGridGeometry3D(
  gl: WebGL2RenderingContext,
  buffers: Scatter3DBuffers
): number {
  const { positions, colors } = generateGridGeometry3D();

  gl.bindBuffer(gl.ARRAY_BUFFER, buffers.linePosition);
  gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);

  gl.bindBuffer(gl.ARRAY_BUFFER, buffers.lineColor);
  gl.bufferData(gl.ARRAY_BUFFER, colors, gl.STATIC_DRAW);

  return positions.length / 3;
}

export function createScatter3DWebGLResources(
  gl: WebGL2RenderingContext,
  canvas: HTMLCanvasElement,
  sources: Scatter3DProgramSources
): Scatter3DWebGLResources {
  const programs = createScatter3DPrograms(gl, sources);
  const vaos = createScatter3DVertexArrays(gl);
  const buffers = createScatter3DBuffers(gl);

  configureScatter3DVertexArrays(gl, programs, vaos, buffers);
  const lineCount = uploadInitialGridGeometry3D(gl, buffers);
  const pickBuffer = createPickingBuffer(gl, canvas.width, canvas.height);

  return {
    gl,
    programs,
    vaos,
    buffers,
    pickBuffer,
    lineCount,
  };
}

export function disposeScatter3DWebGLResources(resources: Scatter3DWebGLResources): void {
  const { gl, programs, vaos, buffers, pickBuffer } = resources;

  destroyPickingBuffer(gl, pickBuffer);

  if (vaos.main) gl.deleteVertexArray(vaos.main);
  if (vaos.pick) gl.deleteVertexArray(vaos.pick);
  if (vaos.line) gl.deleteVertexArray(vaos.line);

  Object.values(buffers).forEach((buffer) => gl.deleteBuffer(buffer));

  gl.deleteProgram(programs.main.program);
  gl.deleteProgram(programs.pick.program);
  gl.deleteProgram(programs.line.program);
}

export function uploadScatter3DPointBuffers(
  resources: Scatter3DWebGLResources,
  bufferData: PointBufferData3D
): void {
  const { gl, buffers } = resources;

  gl.bindBuffer(gl.ARRAY_BUFFER, buffers.position);
  gl.bufferData(gl.ARRAY_BUFFER, bufferData.positions, gl.STATIC_DRAW);

  gl.bindBuffer(gl.ARRAY_BUFFER, buffers.color);
  gl.bufferData(gl.ARRAY_BUFFER, bufferData.colors, gl.STATIC_DRAW);

  gl.bindBuffer(gl.ARRAY_BUFFER, buffers.size);
  gl.bufferData(gl.ARRAY_BUFFER, bufferData.sizes, gl.STATIC_DRAW);

  gl.bindBuffer(gl.ARRAY_BUFFER, buffers.pickColor);
  gl.bufferData(gl.ARRAY_BUFFER, bufferData.pickColors, gl.STATIC_DRAW);
}

export function uploadScatter3DSelectionBuffers(
  resources: Scatter3DWebGLResources,
  selectionData: SelectionStateData3D
): void {
  const { gl, buffers } = resources;

  gl.bindBuffer(gl.ARRAY_BUFFER, buffers.selected);
  gl.bufferData(gl.ARRAY_BUFFER, selectionData.selected, gl.DYNAMIC_DRAW);

  gl.bindBuffer(gl.ARRAY_BUFFER, buffers.hovered);
  gl.bufferData(gl.ARRAY_BUFFER, selectionData.hovered, gl.DYNAMIC_DRAW);
}

export function resizeScatter3DCanvasToFrame(
  canvas: HTMLCanvasElement,
  resources: Scatter3DWebGLResources,
  frame: Scatter3DRenderFrame
): void {
  if (canvas.width === frame.width && canvas.height === frame.height) return;

  canvas.width = frame.width;
  canvas.height = frame.height;
  resizePickingBuffer(resources.gl, resources.pickBuffer, frame.width, frame.height);
}

function renderScatter3DPickingPass(
  resources: Scatter3DWebGLResources,
  options: Scatter3DFrameRenderOptions
): void {
  const { gl, programs, vaos, pickBuffer } = resources;
  const { frame, viewMatrix, pointCount } = options;

  gl.bindFramebuffer(gl.FRAMEBUFFER, pickBuffer.framebuffer);
  gl.viewport(0, 0, frame.width, frame.height);
  gl.clearColor(0, 0, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.enable(gl.DEPTH_TEST);

  if (pointCount > 0) {
    gl.useProgram(programs.pick.program);
    gl.uniformMatrix4fv(programs.pick.uniforms.u_projection, false, frame.projectionMatrix);
    gl.uniformMatrix4fv(programs.pick.uniforms.u_view, false, viewMatrix);
    gl.uniformMatrix4fv(programs.pick.uniforms.u_model, false, frame.modelMatrix);
    gl.uniform1f(programs.pick.uniforms.u_pointScale, frame.dpr);

    gl.bindVertexArray(vaos.pick);
    gl.drawArrays(gl.POINTS, 0, pointCount);
  }
}

function renderScatter3DScenePass(
  resources: Scatter3DWebGLResources,
  options: Scatter3DFrameRenderOptions
): void {
  const { gl, programs, vaos, lineCount } = resources;
  const { frame, viewMatrix, pointCount, showGrid, showAxes, hasSelection } = options;

  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, frame.width, frame.height);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

  gl.enable(gl.DEPTH_TEST);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

  if (showGrid || showAxes) {
    gl.useProgram(programs.line.program);
    gl.uniformMatrix4fv(programs.line.uniforms.u_projection, false, frame.projectionMatrix);
    gl.uniformMatrix4fv(programs.line.uniforms.u_view, false, viewMatrix);
    gl.uniformMatrix4fv(programs.line.uniforms.u_model, false, frame.modelMatrix);

    gl.bindVertexArray(vaos.line);
    gl.drawArrays(gl.LINES, 0, lineCount);
  }

  if (pointCount > 0) {
    gl.useProgram(programs.main.program);
    gl.uniformMatrix4fv(programs.main.uniforms.u_projection, false, frame.projectionMatrix);
    gl.uniformMatrix4fv(programs.main.uniforms.u_view, false, viewMatrix);
    gl.uniformMatrix4fv(programs.main.uniforms.u_model, false, frame.modelMatrix);
    gl.uniform1f(programs.main.uniforms.u_pointScale, frame.dpr);
    gl.uniform2f(programs.main.uniforms.u_resolution, frame.width, frame.height);
    gl.uniform1f(programs.main.uniforms.u_hasSelection, hasSelection ? 1.0 : 0.0);

    gl.bindVertexArray(vaos.main);
    gl.drawArrays(gl.POINTS, 0, pointCount);
  }
}

export function renderScatter3DFrame(
  resources: Scatter3DWebGLResources,
  options: Scatter3DFrameRenderOptions
): void {
  const { gl } = resources;
  if (!resources.vaos.main || !resources.vaos.pick || !resources.vaos.line) return;

  renderScatter3DPickingPass(resources, options);
  renderScatter3DScenePass(resources, options);

  gl.bindVertexArray(null);
  gl.disable(gl.BLEND);
  gl.disable(gl.DEPTH_TEST);
}

export function readScatter3DPickedIndex(
  canvas: HTMLCanvasElement,
  resources: Scatter3DWebGLResources,
  clientX: number,
  clientY: number,
  devicePixelRatio: number
): number | null {
  const rect = canvas.getBoundingClientRect();
  const pickPlan = createInteractionPickingPlan3D(clientX, clientY, rect, devicePixelRatio);

  return readPickedIndex(resources.gl, resources.pickBuffer, pickPlan.x, pickPlan.y);
}

export function readScatter3DIndicesInScreenRect(
  canvas: HTMLCanvasElement,
  resources: Scatter3DWebGLResources,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  devicePixelRatio: number
): number[] {
  const pickingPlan = createInteractionRectPickingPlan3D(
    x1,
    y1,
    x2,
    y2,
    canvas.getBoundingClientRect(),
    devicePixelRatio
  );
  if (!pickingPlan) return [];

  const { gl, pickBuffer } = resources;
  const foundIndices = new Set<number>();

  gl.bindFramebuffer(gl.FRAMEBUFFER, pickBuffer.framebuffer);

  for (let sx = pickingPlan.startX; sx <= pickingPlan.endX; sx += pickingPlan.stepSize) {
    for (let sy = pickingPlan.startY; sy <= pickingPlan.endY; sy += pickingPlan.stepSize) {
      const pixel = new Uint8Array(4);
      gl.readPixels(sx, sy, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
      const index = pickPixelToIndex(pixel);
      if (index !== null) {
        foundIndices.add(index);
      }
    }
  }

  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return Array.from(foundIndices);
}
