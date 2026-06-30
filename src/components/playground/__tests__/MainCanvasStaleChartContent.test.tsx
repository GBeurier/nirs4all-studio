/**
 * @vitest-environment jsdom
 */

import type { ReactNode } from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';

import { MainCanvasStaleChartContent } from '../MainCanvasStaleChartContent';

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

describe('MainCanvasStaleChartContent', () => {
  it('keeps chart content full height while fresh', async () => {
    const { container, root } = await render(
      <MainCanvasStaleChartContent stale={false}>
        <span>Fresh chart</span>
      </MainCanvasStaleChartContent>
    );

    const wrapper = container.firstElementChild;
    expect(wrapper?.className).toBe('h-full');
    expect(container.textContent).toBe('Fresh chart');

    await act(async () => {
      root.unmount();
    });
  });

  it('applies the stale transition treatment when deferred chart data is stale', async () => {
    const { container, root } = await render(
      <MainCanvasStaleChartContent stale>
        <span>Stale chart</span>
      </MainCanvasStaleChartContent>
    );

    const wrapper = container.firstElementChild;
    expect(wrapper?.className).toContain('h-full');
    expect(wrapper?.className).toContain('opacity-70');
    expect(wrapper?.className).toContain('transition-opacity');

    await act(async () => {
      root.unmount();
    });
  });
});
