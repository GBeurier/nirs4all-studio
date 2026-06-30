/**
 * @vitest-environment jsdom
 */

import type { ReactNode } from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MainCanvasMinimizedChartsBar } from '../MainCanvasMinimizedChartsBar';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { ChartType } from '@/context/usePlaygroundView';

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

describe('MainCanvasMinimizedChartsBar', () => {
  it('renders nothing when there are no minimized charts', async () => {
    const { container, root } = await render(
      <TooltipProvider>
      <MainCanvasMinimizedChartsBar
        minimizedCharts={[]}
        onRestore={() => undefined}
        onHide={() => undefined}
      />
      </TooltipProvider>
    );

    expect(container.textContent).toBe('');

    await act(async () => {
      root.unmount();
    });
  });

  it('renders minimized chart headers and wires chart-specific actions', async () => {
    const onRestore = vi.fn();
    const onHide = vi.fn();
    const minimizedCharts: ChartType[] = ['spectra', 'pca'];
    const { container, root } = await render(
      <TooltipProvider>
      <MainCanvasMinimizedChartsBar
        minimizedCharts={minimizedCharts}
        onRestore={onRestore}
        onHide={onHide}
      />
      </TooltipProvider>
    );

    expect(container.textContent).toContain('Spectra');
    expect(container.textContent).toContain('Dimension Reduction');

    const buttons = Array.from(container.querySelectorAll('button'));
    expect(buttons).toHaveLength(4);

    await act(async () => {
      buttons[0].click();
      buttons[3].click();
    });

    expect(onRestore).toHaveBeenCalledWith('spectra');
    expect(onHide).toHaveBeenCalledWith('pca');

    await act(async () => {
      root.unmount();
    });
  });
});
