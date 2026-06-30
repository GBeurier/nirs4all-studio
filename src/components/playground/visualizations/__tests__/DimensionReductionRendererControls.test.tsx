/**
 * @vitest-environment jsdom
 */

import type { ReactNode } from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DimensionReductionRendererControls } from '../DimensionReductionRendererControls';

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

describe('DimensionReductionRendererControls', () => {
  it('wires renderer selection buttons', async () => {
    const onRendererTypeChange = vi.fn();
    const { container, root } = await render(
      <DimensionReductionRendererControls
        rendererType="webgl"
        onRendererTypeChange={onRendererTypeChange}
      />
    );

    const buttons = Array.from(container.querySelectorAll('button'));
    expect(buttons).toHaveLength(3);

    await act(async () => {
      buttons[0].click();
      buttons[1].click();
      buttons[2].click();
    });

    expect(onRendererTypeChange).toHaveBeenNthCalledWith(1, 'recharts');
    expect(onRendererTypeChange).toHaveBeenNthCalledWith(2, 'webgl');
    expect(onRendererTypeChange).toHaveBeenNthCalledWith(3, 'regl');

    await act(async () => {
      root.unmount();
    });
  });
});
