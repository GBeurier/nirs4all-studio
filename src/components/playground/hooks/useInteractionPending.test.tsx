/**
 * @vitest-environment jsdom
 */

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useInteractionPending, type UseInteractionPendingOptions } from './useInteractionPending';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

async function renderHook(
  initialOptions: UseInteractionPendingOptions
) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const result: { current: ReturnType<typeof useInteractionPending> | undefined } = { current: undefined };
  let options = initialOptions;

  function TestComponent() {
    result.current = useInteractionPending(options);
    return null;
  }

  const rerender = async (nextOptions: UseInteractionPendingOptions) => {
    options = nextOptions;
    await act(async () => {
      root.render(<TestComponent />);
    });
  };

  await rerender(initialOptions);

  return {
    result,
    rerender,
    unmount: async () => {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useInteractionPending', () => {
  it('keeps interaction pending briefly after explicit interactions', async () => {
    const mounted = await renderHook({ isFetching: false, isLoading: false });

    expect(mounted.result.current?.interactionPending).toBe(false);

    await act(async () => {
      mounted.result.current?.triggerInteractionPending();
    });
    expect(mounted.result.current?.interactionPending).toBe(true);

    await act(async () => {
      vi.advanceTimersByTime(399);
    });
    expect(mounted.result.current?.interactionPending).toBe(true);

    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(mounted.result.current?.interactionPending).toBe(false);

    await mounted.unmount();
  });

  it('stays pending while loading and clears after the settle delay', async () => {
    const mounted = await renderHook({ isFetching: true, isLoading: false });

    expect(mounted.result.current?.interactionPending).toBe(true);

    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(mounted.result.current?.interactionPending).toBe(true);

    await mounted.rerender({ isFetching: false, isLoading: false });
    expect(mounted.result.current?.interactionPending).toBe(true);

    await act(async () => {
      vi.advanceTimersByTime(149);
    });
    expect(mounted.result.current?.interactionPending).toBe(true);

    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(mounted.result.current?.interactionPending).toBe(false);

    await mounted.unmount();
  });
});
