/** @vitest-environment jsdom */
import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ScatterPureWebGL2D } from './ScatterPureWebGL2D';
import type { ScatterRendererProps, DataBounds } from './types';

const webgl = vi.hoisted(() => ({
  createScatter2DWebGLResources: vi.fn(),
  destroyScatter2DWebGLResources: vi.fn(),
  uploadPointBuffers2D: vi.fn(),
  uploadGridBuffers2D: vi.fn(),
  uploadSelectionBuffers2D: vi.fn(),
  renderScatter2DFrame: vi.fn(),
  readPointerPickedIndex2D: vi.fn(),
  applySelectionClickPlan2D: vi.fn(),
}));
const selection = vi.hoisted(() => ({
  selectedSamples: new Set<number>(), pinnedSamples: new Set<number>(),
  hoveredSample: null as number | null, setHovered: vi.fn(),
}));
vi.mock('./ScatterPureWebGL2D.webgl', () => webgl);
vi.mock('@/context/useSelection', () => ({
  useSelection: () => selection,
  useHoveredSample: () => selection.hoveredSample,
  useSetHoveredSample: () => selection.setHovered,
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLDivElement;
let frameId: number;
let frames: Map<number, FrameRequestCallback>;
let observers: Array<{ notify: () => void; observe: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }>;

const points: [number, number][] = [[0, 0], [1, 2]];
const indices = [10, 20];
type Props = ScatterRendererProps & { customBounds?: DataBounds };

async function render(props: Partial<Props> = {}, strict = false) {
  await act(async () => {
    const plot = <ScatterPureWebGL2D points={points} indices={indices} useSelectionContext={false} {...props} />;
    root.render(strict ? <StrictMode>{plot}</StrictMode> : plot);
  });
}

async function flushFrame() {
  await act(async () => {
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach(callback => callback(16));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  webgl.createScatter2DWebGLResources.mockImplementation(() => ({ gl: {}, buffers: {} }));
  webgl.uploadGridBuffers2D.mockReturnValue({ count: 4 });
  webgl.readPointerPickedIndex2D.mockReturnValue(20);
  selection.selectedSamples = new Set();
  selection.pinnedSamples = new Set();
  selection.hoveredSample = null;
  frameId = 0;
  frames = new Map();
  observers = [];
  vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
    frames.set(++frameId, callback);
    return frameId;
  }));
  vi.stubGlobal('cancelAnimationFrame', vi.fn((id: number) => frames.delete(id)));
  vi.stubGlobal('ResizeObserver', class {
    observe = vi.fn();
    disconnect = vi.fn();
    constructor(callback: () => void) {
      observers.push({ notify: callback, observe: this.observe, disconnect: this.disconnect });
    }
  });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
  vi.unstubAllGlobals();
});

describe('ScatterPureWebGL2D demand rendering', () => {
  it('draws one initial frame and stays idle when props and data are unchanged', async () => {
    await render();
    expect(frames.size).toBe(1);
    expect(requestAnimationFrame).toHaveBeenCalledTimes(1);
    await flushFrame();
    expect(webgl.renderScatter2DFrame).toHaveBeenCalledTimes(1);
    expect(frames.size).toBe(0);
    await render();
    await flushFrame();
    expect(webgl.renderScatter2DFrame).toHaveBeenCalledTimes(1);
    expect(requestAnimationFrame).toHaveBeenCalledTimes(1);
  });

  it('coalesces buffer and view changes using the latest committed points and bounds', async () => {
    await render();
    await flushFrame();
    await render({ pointSize: 12, showGrid: false });
    expect(frames.size).toBe(1);
    const nextPoints: [number, number][] = [[2, 3], [4, 5], [6, 7]];
    const customBounds = { minX: -10, maxX: 10, minY: -20, maxY: 20 };
    await render({ points: nextPoints, pointSize: 12, showGrid: false, showAxes: false,
      customBounds, preserveAspectRatio: true, selectedIndices: [20] });
    expect(requestAnimationFrame).toHaveBeenCalledTimes(2);
    await flushFrame();
    expect(webgl.renderScatter2DFrame).toHaveBeenLastCalledWith(
      container.querySelector('canvas'), expect.anything(), expect.objectContaining({
        pointCount: 3, bounds: customBounds, preserveAspectRatio: true, selectedSampleCount: 1,
      }),
    );
    expect(webgl.uploadPointBuffers2D.mock.lastCall?.[2]).toBe(nextPoints);
    expect(webgl.uploadPointBuffers2D.mock.lastCall?.[4]).toBe(12);
    expect(webgl.uploadGridBuffers2D.mock.lastCall?.slice(-2)).toEqual([false, false]);
    expect(frames.size).toBe(0);
  });

  it('redraws independent selection, pin and hover changes and preserves pointer picking', async () => {
    const onHover = vi.fn();
    const onClick = vi.fn();
    await render({ onHover, onClick });
    await flushFrame();
    await render({ onHover, onClick, selectedIndices: [10] });
    await flushFrame();
    await render({ onHover, onClick, selectedIndices: [10], pinnedIndices: [20] });
    await flushFrame();
    const canvas = container.querySelector('canvas')!;
    await act(async () => { canvas.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 8, clientY: 12 })); });
    expect(webgl.readPointerPickedIndex2D).toHaveBeenLastCalledWith(canvas, expect.anything(), 8, 12);
    expect(onHover).toHaveBeenLastCalledWith(20);
    expect(webgl.uploadSelectionBuffers2D.mock.lastCall?.slice(-3)).toEqual([new Set([10]), new Set([20]), 20]);
    await flushFrame();
    const click = new MouseEvent('click', { bubbles: true, clientX: 8, clientY: 12 });
    await act(async () => { canvas.dispatchEvent(click); });
    expect(onClick).toHaveBeenCalledWith(20, click);
    await act(async () => { canvas.dispatchEvent(new MouseEvent('mouseout', { bubbles: true })); });
    expect(onHover).toHaveBeenLastCalledWith(null);
    await flushFrame();
    expect(webgl.renderScatter2DFrame).toHaveBeenCalledTimes(5);
    expect(frames.size).toBe(0);
  });

  it('retains context hover and click selection plans without continuous frames', async () => {
    await render({ useSelectionContext: true });
    await flushFrame();
    const canvas = container.querySelector('canvas')!;
    await act(async () => { canvas.dispatchEvent(new MouseEvent('mousemove', { bubbles: true })); });
    expect(selection.setHovered).toHaveBeenCalledWith(20);
    selection.hoveredSample = 20;
    await render({ useSelectionContext: true });
    expect(frames.size).toBe(1);
    await flushFrame();
    await act(async () => { canvas.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true })); });
    expect(webgl.applySelectionClickPlan2D).toHaveBeenCalledWith(selection, { type: 'select', mode: 'add', index: 20 });
    expect(frames.size).toBe(0);
  });

  it('redraws canvas resize notifications once without rebuilding point buffers', async () => {
    await render();
    await flushFrame();
    expect(observers[0].observe).toHaveBeenCalledWith(container.querySelector('canvas'));
    await act(async () => {
      observers[0].notify();
      observers[0].notify();
      window.dispatchEvent(new Event('resize'));
    });
    expect(frames.size).toBe(1);
    expect(webgl.uploadPointBuffers2D).toHaveBeenCalledTimes(1);
    await flushFrame();
    expect(webgl.renderScatter2DFrame).toHaveBeenCalledTimes(2);
    expect(frames.size).toBe(0);
  });

  it('cancels pending frames and disconnects each observer on StrictMode cleanup', async () => {
    await render({}, true);
    expect(webgl.createScatter2DWebGLResources).toHaveBeenCalledTimes(2);
    expect(webgl.destroyScatter2DWebGLResources).toHaveBeenCalledTimes(1);
    expect(frames.size).toBe(1);
    await act(async () => { root.render(null); });
    expect(webgl.destroyScatter2DWebGLResources).toHaveBeenCalledTimes(2);
    expect(cancelAnimationFrame).toHaveBeenCalledTimes(2);
    expect(observers.every(observer => observer.disconnect.mock.calls.length === 1)).toBe(true);
    await act(async () => { window.dispatchEvent(new Event('resize')); });
    await flushFrame();
    expect(frames.size).toBe(0);
    expect(webgl.renderScatter2DFrame).not.toHaveBeenCalled();
  });
});
