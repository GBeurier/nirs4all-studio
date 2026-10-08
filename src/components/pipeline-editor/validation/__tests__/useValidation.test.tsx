/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PipelineStep } from '../../types';
import { useValidation } from '../useValidation';
import { createEmptyValidationResult } from '../types';

const mocks = vi.hoisted(() => ({ validate: vi.fn() }));
vi.mock('../engine', () => ({ validate: mocks.validate }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const steps: PipelineStep[] = [{ id: 'filter', name: 'SavitzkyGolay', type: 'preprocessing', enabled: true, params: { window_length: 5 } }];
const cleanups: Array<() => Promise<void>> = [];
async function mount(hook: () => ReturnType<typeof useValidation>) {
  const root = createRoot(document.createElement('div'));
  function Probe() { hook(); return null; }
  const render = () => act(async () => { root.render(<Probe />); });
  const unmount = async () => { await act(async () => root.unmount()); };
  cleanups.push(unmount);
  await render();
  return { render, unmount: async () => { cleanups.splice(cleanups.indexOf(unmount), 1); await unmount(); } };
}
beforeEach(() => { vi.useFakeTimers(); mocks.validate.mockReturnValue(createEmptyValidationResult()); });
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  mocks.validate.mockReset();
});

describe('scheduled pipeline validation', () => {
  it('validates an unchanged pipeline once on mount', async () => {
    await mount(() => useValidation(steps));
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(mocks.validate).toHaveBeenCalledTimes(1);
  });

  it('cancels obsolete idle work when the pipeline changes', async () => {
    const callbacks: Array<() => void> = [];
    const cancel = vi.fn();
    vi.stubGlobal('requestIdleCallback', vi.fn((callback: () => void) => { callbacks.push(callback); return callbacks.length; }));
    vi.stubGlobal('cancelIdleCallback', cancel);
    let currentSteps = steps;
    const view = await mount(() => useValidation(currentSteps));
    currentSteps = [{ ...steps[0], params: { window_length: 9 } }];
    await view.render();
    expect(cancel).toHaveBeenCalledWith(1);
    await act(async () => { callbacks[0](); await vi.advanceTimersByTimeAsync(300); callbacks[1](); });
    expect(mocks.validate).toHaveBeenCalledTimes(1);
    expect(mocks.validate.mock.calls[0][0][0].params.window_length).toBe(9);
  });

  it('cancels pending idle work and ignores late callbacks after unmount', async () => {
    let callback!: () => void;
    const cancel = vi.fn();
    vi.stubGlobal('requestIdleCallback', vi.fn((pending: () => void) => { callback = pending; return 1; }));
    vi.stubGlobal('cancelIdleCallback', cancel);
    const view = await mount(() => useValidation(steps));
    await view.unmount();
    callback();
    expect(cancel).toHaveBeenCalledWith(1);
    expect(mocks.validate).not.toHaveBeenCalled();
  });
});
