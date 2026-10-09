/**
 * @vitest-environment jsdom
 */

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useSpectraDecimation } from '../useSpectraDecimation';
import type { SpectraDecimationResult } from '../spectraWebGLGeometry';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  posted: Array<Record<string, unknown>> = [];
  terminated = false;

  constructor() {
    FakeWorker.instances.push(this);
  }

  postMessage(message: Record<string, unknown>) {
    this.posted.push(message);
  }

  terminate() {
    this.terminated = true;
  }

  reply(requestId: number, allPoints: Float32Array) {
    this.onmessage?.({ data: { type: 'decimated', requestId, allPoints, metadata: [] } } as MessageEvent);
  }
}

const spectra = [[0, 1, 2, 3, 4, 5], [5, 4, 3, 2, 1, 0]];
const wavelengths = [1000, 1010, 1020, 1030, 1040, 1050];
const visibleIndices = [0, 1];
const xViewRange: [number, number] = [1000, 1050];
const yRange: [number, number] = [0, 5];

let latest: SpectraDecimationResult | null = null;

function Probe() {
  latest = useSpectraDecimation({
    spectra, originalSpectra: null, wavelengths, visibleIndices, xViewRange, yRange, targetPoints: 100,
  });
  return null;
}

async function mount() {
  const root = createRoot(document.createElement('div'));
  await act(async () => { root.render(<Probe />); });
  return () => act(async () => root.unmount());
}

afterEach(() => {
  vi.unstubAllGlobals();
  FakeWorker.instances = [];
  latest = null;
});

describe('useSpectraDecimation', () => {
  it('decimates synchronously where Web Workers are unavailable', async () => {
    vi.stubGlobal('Worker', undefined);
    const unmount = await mount();
    expect(latest?.metadata.length).toBe(2);
    expect(latest?.allPoints.length).toBeGreaterThan(0);
    await unmount();
  });

  it('delegates to the worker and ignores superseded answers', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const unmount = await mount();
    const worker = FakeWorker.instances[0];

    expect(worker.posted.map((message) => message.type)).toEqual(['setData', 'decimate']);
    expect(latest?.allPoints.length).toBe(0);

    const requestId = worker.posted[1].requestId as number;
    await act(async () => { worker.reply(requestId - 1, new Float32Array([9, 9])); });
    expect(latest?.allPoints.length).toBe(0);

    await act(async () => { worker.reply(requestId, new Float32Array([1, 2, 3, 4])); });
    expect(Array.from(latest?.allPoints ?? [])).toEqual([1, 2, 3, 4]);

    await unmount();
    expect(worker.terminated).toBe(true);
  });

  it('falls back to synchronous decimation when the worker fails to load', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const unmount = await mount();
    await act(async () => { FakeWorker.instances[0].onerror?.(); });
    expect(latest?.metadata.length).toBe(2);
    expect(FakeWorker.instances[0].terminated).toBe(true);
    await unmount();
  });
});
