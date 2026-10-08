/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';

import { SpectraWebGLCamera } from '../SpectraWebGLCamera';

const fiber = vi.hoisted(() => ({
  camera: undefined as THREE.Camera | undefined,
  size: { width: 1080, height: 720 },
  invalidate: vi.fn(),
  useFrame: vi.fn(),
}));

vi.mock('@react-three/fiber', () => ({
  useThree: () => fiber,
  useFrame: fiber.useFrame,
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  fiber.camera = new THREE.OrthographicCamera();
  fiber.size = { width: 1080, height: 720 };
  vi.clearAllMocks();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
});

async function renderCamera() {
  await act(async () => { root.render(<SpectraWebGLCamera />); });
}

describe('SpectraWebGLCamera lifecycle', () => {
  it('sets the first projection and requests a frame without subscribing to idle frames', async () => {
    const camera = fiber.camera as THREE.OrthographicCamera;
    const updateProjection = vi.spyOn(camera, 'updateProjectionMatrix');
    await renderCamera();

    expect(camera.position.toArray()).toEqual([0.5, 0.5, 5]);
    expect([camera.left, camera.right, camera.bottom, camera.top]).toEqual([-0.06, 1.02, -0.12, 1.04]);
    expect([camera.near, camera.far]).toEqual([0.1, 100]);
    expect(updateProjection).toHaveBeenCalledTimes(1);
    expect(fiber.invalidate).toHaveBeenCalledTimes(1);
    expect(fiber.useFrame).not.toHaveBeenCalled();
  });

  it('updates resized viewports but leaves unchanged dimensions alone', async () => {
    const camera = fiber.camera as THREE.OrthographicCamera;
    const updateProjection = vi.spyOn(camera, 'updateProjectionMatrix');
    await renderCamera();
    const firstProjection = camera.projectionMatrix.clone();

    fiber.size = { width: 1080, height: 720 };
    await renderCamera();
    expect(updateProjection).toHaveBeenCalledTimes(1);
    expect(fiber.invalidate).toHaveBeenCalledTimes(1);

    fiber.size = { width: 720, height: 1440 };
    await renderCamera();
    expect(camera.bottom).toBeCloseTo(-0.62);
    expect(camera.top).toBeCloseTo(1.54);
    expect(camera.projectionMatrix.equals(firstProjection)).toBe(false);
    expect(updateProjection).toHaveBeenCalledTimes(2);
    expect(fiber.invalidate).toHaveBeenCalledTimes(2);

    fiber.size = { width: 1440, height: 1440 };
    await renderCamera();
    expect(updateProjection).toHaveBeenCalledTimes(3);
    expect(fiber.invalidate).toHaveBeenCalledTimes(3);
  });

  it('initializes a replacement camera even when the viewport is unchanged', async () => {
    await renderCamera();
    const replacement = new THREE.OrthographicCamera();
    const updateProjection = vi.spyOn(replacement, 'updateProjectionMatrix');
    fiber.camera = replacement;
    await renderCamera();

    expect(replacement.position.toArray()).toEqual([0.5, 0.5, 5]);
    expect(replacement.left).toBe(-0.06);
    expect(updateProjection).toHaveBeenCalledTimes(1);
    expect(fiber.invalidate).toHaveBeenCalledTimes(2);
  });

  it('leaves a nonorthographic camera unchanged', async () => {
    const camera = new THREE.PerspectiveCamera();
    const updateProjection = vi.spyOn(camera, 'updateProjectionMatrix');
    fiber.camera = camera;
    await renderCamera();

    expect(camera.position.toArray()).toEqual([0, 0, 0]);
    expect(updateProjection).not.toHaveBeenCalled();
    expect(fiber.invalidate).not.toHaveBeenCalled();
  });
});
