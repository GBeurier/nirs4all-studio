/**
 * @vitest-environment jsdom
 */

import type { ReactNode } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SpectraWebGLInteractionController } from '../SpectraWebGLInteractionController';
import type { SpectraWebGLHitTestLine } from '../spectraWebGLHitTesting';

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

function line(index: number, isOriginal = false): SpectraWebGLHitTestLine {
  return {
    index,
    isOriginal,
    points: new Float32Array([0.5, 0.5]),
    pointCount: 1,
  };
}

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

describe('SpectraWebGLInteractionController', () => {
  it('emits hover, click, and leave callbacks for the nearest processed line', async () => {
    const onHover = vi.fn();
    const onClick = vi.fn();

    await render(
      <SpectraWebGLInteractionController
        lines={[line(7)]}
        onHover={onHover}
        onClick={onClick}
      />
    );

    canvas.dispatchEvent(new MouseEvent('mousemove', {
      clientX: 52,
      clientY: 47,
      bubbles: true,
    }));

    expect(onHover).toHaveBeenCalledWith(7, expect.any(MouseEvent));

    canvas.dispatchEvent(new MouseEvent('click', {
      clientX: 52,
      clientY: 47,
      detail: 1,
      bubbles: true,
    }));

    expect(onClick).toHaveBeenCalledWith(7, expect.any(MouseEvent));

    canvas.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));

    expect(onHover).toHaveBeenLastCalledWith(null);
  });

  it('ignores original spectra lines during hit testing', async () => {
    const onHover = vi.fn();

    await render(
      <SpectraWebGLInteractionController
        lines={[line(9, true)]}
        onHover={onHover}
        onClick={vi.fn()}
      />
    );

    canvas.dispatchEvent(new MouseEvent('mousemove', {
      clientX: 52,
      clientY: 47,
      bubbles: true,
    }));

    expect(onHover).not.toHaveBeenCalled();
  });
});
