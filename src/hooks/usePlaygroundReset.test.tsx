/**
 * @vitest-environment jsdom
 */

import type { ReactNode } from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SelectionProvider } from '@/context/SelectionContext';
import { DEFAULT_GLOBAL_COLOR_CONFIG } from '@/lib/playground/colorConfig';
import { usePlaygroundReset } from './usePlaygroundReset';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

let mountedContainers: HTMLDivElement[] = [];

async function render(element: ReactNode) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  mountedContainers.push(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(element);
  });

  return { container, root };
}

afterEach(() => {
  for (const container of mountedContainers) {
    container.remove();
  }
  mountedContainers = [];
});

describe('usePlaygroundReset', () => {
  it('resets optional playground state without requiring filter or outlier providers', async () => {
    const onResetColorConfig = vi.fn();
    const onResetZoom = vi.fn();
    const onAfterReset = vi.fn();

    function TestComponent() {
      const { resetPlayground } = usePlaygroundReset({
        onResetColorConfig,
        onResetZoom,
        onAfterReset,
      });

      return (
        <button type="button" onClick={resetPlayground}>
          Reset
        </button>
      );
    }

    const { container, root } = await render(
      <SelectionProvider>
        <TestComponent />
      </SelectionProvider>
    );

    await act(async () => {
      container.querySelector('button')?.click();
    });

    expect(onResetColorConfig).toHaveBeenCalledWith(DEFAULT_GLOBAL_COLOR_CONFIG);
    expect(onResetZoom).toHaveBeenCalledTimes(1);
    expect(onAfterReset).toHaveBeenCalledTimes(1);

    await act(async () => {
      root.unmount();
    });
  });
});
