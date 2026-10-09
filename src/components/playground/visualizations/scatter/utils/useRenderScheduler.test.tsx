/**
 * @vitest-environment jsdom
 */

import { act, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useRenderScheduler } from './useRenderScheduler';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

let frames: Map<number, FrameRequestCallback>;
let nextFrame: number;
let resizeCallbacks: Array<() => void>;
let scheduler: ReturnType<typeof useRenderScheduler> | null;
const draw = vi.fn();

function Probe() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  scheduler = useRenderScheduler(canvasRef);
  return <canvas ref={canvasRef} />;
}

function flushFrames() {
  const pending = [...frames.values()];
  frames.clear();
  pending.forEach((callback) => callback(16));
}

beforeEach(() => {
  frames = new Map();
  nextFrame = 0;
  resizeCallbacks = [];
  scheduler = null;
  draw.mockReset();
  vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
    frames.set(++nextFrame, callback);
    return nextFrame;
  }));
  vi.stubGlobal('cancelAnimationFrame', vi.fn((id: number) => frames.delete(id)));
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { resizeCallbacks.push(callback); }
    observe = vi.fn();
    disconnect = vi.fn();
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useRenderScheduler', () => {
  it('draws nothing until a frame is requested, then once per animation frame', async () => {
    const root = createRoot(document.createElement('div'));
    await act(async () => { root.render(<Probe />); });
    expect(frames.size).toBe(0);

    act(() => {
      scheduler?.setRender(draw);
      scheduler?.requestRender();
      scheduler?.requestRender();
    });
    expect(frames.size).toBe(1);

    act(flushFrames);
    expect(draw).toHaveBeenCalledTimes(1);

    // Idle: no further frames are scheduled.
    expect(frames.size).toBe(0);
    await act(async () => root.unmount());
  });

  it('requests a frame when the canvas is resized and cancels pending frames on unmount', async () => {
    const root = createRoot(document.createElement('div'));
    await act(async () => { root.render(<Probe />); });
    act(() => { scheduler?.setRender(draw); flushFrames(); });
    draw.mockClear();

    act(() => resizeCallbacks[0]());
    expect(frames.size).toBe(1);

    await act(async () => root.unmount());
    expect(frames.size).toBe(0);
    expect(draw).not.toHaveBeenCalled();
  });
});
