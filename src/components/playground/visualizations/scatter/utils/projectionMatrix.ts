/**
 * Matrix utilities for 2D and 3D projections
 * Uses column-major order (WebGL standard)
 */

/**
 * Create a 3x3 identity matrix
 */
export function mat3Identity(): Float32Array {
  return new Float32Array([
    1, 0, 0,
    0, 1, 0,
    0, 0, 1,
  ]);
}

/**
 * Create a 2D orthographic projection matrix (3x3)
 * Maps [left,right] x [bottom,top] to [-1,1] x [-1,1]
 */
export function mat3Ortho(
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

/**
 * Create a 4x4 identity matrix
 */
export function mat4Identity(): Float32Array {
  return new Float32Array([
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ]);
}

/**
 * Create a 4x4 perspective projection matrix
 */
export function mat4Perspective(
  fov: number,    // Field of view in radians
  aspect: number, // Width / Height
  near: number,
  far: number
): Float32Array {
  const f = 1 / Math.tan(fov / 2);
  const nf = 1 / (near - far);

  return new Float32Array([
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (far + near) * nf, -1,
    0, 0, 2 * far * near * nf, 0,
  ]);
}

/**
 * Create a 4x4 orthographic projection matrix
 */
export function mat4Ortho(
  left: number,
  right: number,
  bottom: number,
  top: number,
  near: number,
  far: number
): Float32Array {
  const w = right - left;
  const h = top - bottom;
  const d = far - near;

  return new Float32Array([
    2 / w, 0, 0, 0,
    0, 2 / h, 0, 0,
    0, 0, -2 / d, 0,
    -(right + left) / w, -(top + bottom) / h, -(far + near) / d, 1,
  ]);
}

/**
 * Create a 4x4 look-at view matrix
 */
export function mat4LookAt(
  eye: [number, number, number],
  target: [number, number, number],
  up: [number, number, number] = [0, 1, 0]
): Float32Array {
  const [ex, ey, ez] = eye;
  const [tx, ty, tz] = target;
  const [ux, uy, uz] = up;

  // Forward vector (z)
  let zx = ex - tx;
  let zy = ey - ty;
  let zz = ez - tz;
  let len = Math.sqrt(zx * zx + zy * zy + zz * zz);
  if (len > 0) { zx /= len; zy /= len; zz /= len; }

  // Right vector (x) = up × forward
  let xx = uy * zz - uz * zy;
  let xy = uz * zx - ux * zz;
  let xz = ux * zy - uy * zx;
  len = Math.sqrt(xx * xx + xy * xy + xz * xz);
  if (len > 0) { xx /= len; xy /= len; xz /= len; }

  // Up vector (y) = forward × right
  const yx = zy * xz - zz * xy;
  const yy = zz * xx - zx * xz;
  const yz = zx * xy - zy * xx;

  return new Float32Array([
    xx, yx, zx, 0,
    xy, yy, zy, 0,
    xz, yz, zz, 0,
    -(xx * ex + xy * ey + xz * ez),
    -(yx * ex + yy * ey + yz * ez),
    -(zx * ex + zy * ey + zz * ez),
    1,
  ]);
}

/**
 * Multiply two 4x4 matrices
 */
export function mat4Multiply(a: Float32Array, b: Float32Array): Float32Array {
  const result = new Float32Array(16);

  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) {
        sum += a[k * 4 + i] * b[j * 4 + k];
      }
      result[j * 4 + i] = sum;
    }
  }

  return result;
}

/**
 * Create a 4x4 translation matrix
 */
export function mat4Translate(x: number, y: number, z: number): Float32Array {
  return new Float32Array([
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    x, y, z, 1,
  ]);
}

/**
 * Create a 4x4 scale matrix
 */
export function mat4Scale(sx: number, sy: number, sz: number): Float32Array {
  return new Float32Array([
    sx, 0, 0, 0,
    0, sy, 0, 0,
    0, 0, sz, 0,
    0, 0, 0, 1,
  ]);
}
