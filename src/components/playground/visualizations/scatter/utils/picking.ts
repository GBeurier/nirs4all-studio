/**
 * GPU-based picking utilities for scatter plots
 * Renders points with unique ID colors to offscreen framebuffer
 */

import type { PickingBuffer } from '../types';
import { pickColorToIndex } from './colorEncoding';

/**
 * Create an offscreen framebuffer for picking
 */
export function createPickingBuffer(
  gl: WebGL2RenderingContext,
  width: number,
  height: number
): PickingBuffer {
  const framebuffer = gl.createFramebuffer();
  if (!framebuffer) throw new Error('Failed to create picking framebuffer');

  const texture = gl.createTexture();
  if (!texture) throw new Error('Failed to create picking texture');

  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA,
    width,
    height,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    null
  );
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  // Create depth buffer for 3D picking
  const depthBuffer = gl.createRenderbuffer();
  if (depthBuffer) {
    gl.bindRenderbuffer(gl.RENDERBUFFER, depthBuffer);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, width, height);
  }

  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(
    gl.FRAMEBUFFER,
    gl.COLOR_ATTACHMENT0,
    gl.TEXTURE_2D,
    texture,
    0
  );
  if (depthBuffer) {
    gl.framebufferRenderbuffer(
      gl.FRAMEBUFFER,
      gl.DEPTH_ATTACHMENT,
      gl.RENDERBUFFER,
      depthBuffer
    );
  }

  // Check completeness
  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  if (status !== gl.FRAMEBUFFER_COMPLETE) {
    console.warn('Picking framebuffer not complete:', status);
  }

  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.bindTexture(gl.TEXTURE_2D, null);
  if (depthBuffer) gl.bindRenderbuffer(gl.RENDERBUFFER, null);

  return {
    framebuffer,
    texture,
    depthBuffer: depthBuffer ?? undefined,
    width,
    height,
  };
}

/**
 * Resize picking buffer to match canvas size
 */
export function resizePickingBuffer(
  gl: WebGL2RenderingContext,
  buffer: PickingBuffer,
  width: number,
  height: number
): void {
  if (buffer.width === width && buffer.height === height) return;

  buffer.width = width;
  buffer.height = height;

  gl.bindTexture(gl.TEXTURE_2D, buffer.texture);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA,
    width,
    height,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    null
  );

  if (buffer.depthBuffer) {
    gl.bindRenderbuffer(gl.RENDERBUFFER, buffer.depthBuffer);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, width, height);
    gl.bindRenderbuffer(gl.RENDERBUFFER, null);
  }

  gl.bindTexture(gl.TEXTURE_2D, null);
}

/**
 * Read picked index at canvas coordinates
 * Returns null if no point at that location
 */
export function readPickedIndex(
  gl: WebGL2RenderingContext,
  buffer: PickingBuffer,
  x: number,
  y: number
): number | null {
  // Flip Y coordinate (WebGL origin is bottom-left)
  const flippedY = buffer.height - y - 1;

  // Clamp to valid range
  const clampedX = Math.max(0, Math.min(buffer.width - 1, Math.floor(x)));
  const clampedY = Math.max(0, Math.min(buffer.height - 1, Math.floor(flippedY)));

  gl.bindFramebuffer(gl.FRAMEBUFFER, buffer.framebuffer);

  const pixel = new Uint8Array(4);
  gl.readPixels(clampedX, clampedY, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);

  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  return pickColorToIndex(pixel[0], pixel[1], pixel[2]);
}

/**
 * Read multiple picked indices in a region (for box selection)
 * Returns Set of unique indices found in the region
 */
export function readPickedIndicesInRect(
  gl: WebGL2RenderingContext,
  buffer: PickingBuffer,
  x1: number,
  y1: number,
  x2: number,
  y2: number
): Set<number> {
  const minX = Math.max(0, Math.min(Math.floor(x1), Math.floor(x2)));
  const maxX = Math.min(buffer.width - 1, Math.max(Math.floor(x1), Math.floor(x2)));
  const minY = Math.max(0, Math.min(buffer.height - Math.floor(y1) - 1, buffer.height - Math.floor(y2) - 1));
  const maxY = Math.min(buffer.height - 1, Math.max(buffer.height - Math.floor(y1) - 1, buffer.height - Math.floor(y2) - 1));

  const width = maxX - minX + 1;
  const height = maxY - minY + 1;

  if (width <= 0 || height <= 0) return new Set();

  gl.bindFramebuffer(gl.FRAMEBUFFER, buffer.framebuffer);

  const pixels = new Uint8Array(width * height * 4);
  gl.readPixels(minX, minY, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  const indices = new Set<number>();
  for (let i = 0; i < pixels.length; i += 4) {
    const index = pickColorToIndex(pixels[i], pixels[i + 1], pixels[i + 2]);
    if (index !== null) {
      indices.add(index);
    }
  }

  return indices;
}

/**
 * Destroy picking buffer and release WebGL resources
 */
export function destroyPickingBuffer(
  gl: WebGL2RenderingContext,
  buffer: PickingBuffer
): void {
  gl.deleteFramebuffer(buffer.framebuffer);
  gl.deleteTexture(buffer.texture);
  if (buffer.depthBuffer) {
    gl.deleteRenderbuffer(buffer.depthBuffer);
  }
}
