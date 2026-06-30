/**
 * ScatterRegl3DCommands - Regl draw-command construction for the 3D scatter renderer
 *
 * Owns the GLSL shaders and the regl draw-command lifecycle for ScatterRegl3D:
 * - main point rendering (depth-attenuated, selection/hover aware)
 * - GPU picking (encodes point index into the framebuffer color)
 * - grid/axes lines
 *
 * This module is pure regl wiring: it builds the commands from a regl instance and
 * exposes them plus the prop shapes each command expects. It performs no rendering
 * itself and holds no React/component state.
 */

import type createRegl from 'regl';

// ============= Command prop shapes =============

export interface Point3DUniforms {
  projection: Float32Array;
  view: Float32Array;
  model: Float32Array;
  pointScale: number;
  resolution: [number, number];
  hasSelection: number;
}

export interface Point3DAttributes {
  position: Float32Array;
  color: Float32Array;
  size: Float32Array;
  selected: Float32Array;
  hovered: Float32Array;
}

export interface Pick3DAttributes {
  position: Float32Array;
  pickColor: Float32Array;
  size: Float32Array;
}

export interface Line3DAttributes {
  position: Float32Array;
  color: Float32Array;
}

// ============= Draw commands =============

export interface Regl3DDrawCommands {
  /** Main point rendering, depth-attenuated and selection/hover aware. */
  drawPoints: createRegl.DrawCommand;
  /** GPU picking pass: encodes each point index into the framebuffer color. */
  drawPicking: createRegl.DrawCommand;
  /** Grid and axis line rendering. */
  drawLines: createRegl.DrawCommand;
}

/**
 * Build the three regl draw commands used by the 3D scatter renderer.
 *
 * @param regl - An initialized regl instance bound to the target canvas.
 * @returns The point, picking, and line draw commands.
 */
export function createRegl3DDrawCommands(regl: createRegl.Regl): Regl3DDrawCommands {
  // Main point rendering
  const drawPoints = regl({
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
        uniform float u_hasSelection;

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

          if (u_hasSelection > 0.5 && vSelected < 0.5 && vHovered < 0.5) {
            alpha *= 0.3;
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
      u_hasSelection: regl.prop<Point3DUniforms, 'hasSelection'>('hasSelection'),
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

  // GPU picking
  const drawPicking = regl({
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

  // Grid/axis lines
  const drawLines = regl({
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
      position: regl.prop<Line3DAttributes, 'position'>('position'),
      color: regl.prop<Line3DAttributes, 'color'>('color'),
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

  return { drawPoints, drawPicking, drawLines };
}
