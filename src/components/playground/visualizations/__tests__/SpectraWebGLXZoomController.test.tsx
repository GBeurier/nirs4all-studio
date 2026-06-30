/**
 * @vitest-environment jsdom
 */

import type { ReactNode } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SpectraWebGLXZoomController } from '../SpectraWebGLXZoomController';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const fiberMock = vi.hoisted(() => ({
  domElement: undefined as HTMLCanvasElement | undefined,
}));

vi.mock('@react-three/fiber', () => ({
  useThree: () => ({
    gl: {
      domElement: fiberMock.domElement,
    },
  }),
}));

let mountedRoots: Root[] = [];
let mountedContainers: HTMLDivElement[] = [];
let canvas: HTMLCanvasElement;

function setCanvasRect(element: HTMLCanvasElement) {
  element.getBoundingClientRect = () => ({
    left: 0,
    top: 0,
    right: 100,
    bottom: 100,
    width: 100,
    height: 100,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect);
}

async function render(element: ReactNode) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  mountedContainers.push(container);

  const root = createRoot(container);
  mountedRoots.push(root);

  await act(async () => {
    root.render(element);
  });
}

beforeEach(() => {
  canvas = document.createElement('canvas');
  setCanvasRect(canvas);
  document.body.appendChild(canvas);
  fiberMock.domElement = canvas;
});

afterEach(async () => {
  for (const root of mountedRoots) {
    await act(async () => {
      root.unmount();
    });
  }
  mountedRoots = [];

  for (const container of mountedContainers) {
    container.remove();
  }
  mountedContainers = [];

  canvas.remove();
  vi.clearAllMocks();
});

describe('SpectraWebGLXZoomController', () => {
  it('zooms around the wheel pointer and resets on double click', async () => {
    const onXViewRangeChange = vi.fn();

    await render(
      <SpectraWebGLXZoomController
        xRange={[1000, 1100]}
        onXViewRangeChange={onXViewRangeChange}
      />
    );

    const wheelEvent = new WheelEvent('wheel', {
      clientX: 50,
      deltaY: -100,
      bubbles: true,
      cancelable: true,
    });

    canvas.dispatchEvent(wheelEvent);

    expect(wheelEvent.defaultPrevented).toBe(true);
    expect(onXViewRangeChange).toHaveBeenCalledTimes(1);

    const zoomedRange = onXViewRangeChange.mock.calls[0][0] as [number, number];
    expect(zoomedRange[0]).toBeCloseTo(1006.5);
    expect(zoomedRange[1]).toBeCloseTo(1093.5);

    canvas.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));

    expect(onXViewRangeChange).toHaveBeenLastCalledWith([1000, 1100]);
  });

  it('tracks drag state on the canvas and clears the cursor on mouseup', async () => {
    await render(
      <SpectraWebGLXZoomController
        xRange={[1000, 1100]}
        onXViewRangeChange={vi.fn()}
      />
    );

    canvas.dispatchEvent(new MouseEvent('mousedown', {
      button: 0,
      clientX: 50,
      bubbles: true,
    }));

    expect(canvas.style.cursor).toBe('grabbing');

    window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));

    expect(canvas.style.cursor).toBe('default');
  });
});
