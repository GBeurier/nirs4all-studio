/**
 * @vitest-environment jsdom
 */

import type { ReactNode } from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RepetitionsWebglPlot } from '../RepetitionsWebglPlot';
import type { RepetitionsWebglData } from '@/lib/playground/repetitionsChartData';

vi.mock('../scatter', () => ({
  ScatterPureWebGL2D: (props: Record<string, unknown>) => (
    <div
      data-testid="scatter-webgl"
      data-points={JSON.stringify(props.points)}
      data-indices={JSON.stringify(props.indices)}
      data-colors={JSON.stringify(props.colors)}
      data-values={JSON.stringify(props.values)}
      data-use-selection={String(props.useSelectionContext)}
      data-clear-background={String(props.clearOnBackgroundClick)}
      data-point-size={String(props.pointSize)}
      data-show-grid={String(props.showGrid)}
      data-show-axes={String(props.showAxes)}
      data-class-name={String(props.className)}
      data-bounds={JSON.stringify(props.customBounds)}
    />
  ),
}));

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

describe('RepetitionsWebglPlot', () => {
  it('mounts the WebGL scatter surface with repetition data and fixed renderer options', async () => {
    const data: RepetitionsWebglData = {
      points: [[0, 1], [2, 3]],
      indices: [10, 20],
      colors: ['red', 'blue'],
      values: [1, 2],
    };
    const bounds = { minX: -0.5, maxX: 1.5, minY: 0, maxY: 5 };

    const { container, root } = await render(
      <RepetitionsWebglPlot
        data={data}
        useSelectionContext
        clearOnBackgroundClick={false}
        customBounds={bounds}
      />
    );

    expect(container.firstElementChild?.getAttribute('class')).toBe('absolute left-10 right-0 top-0 bottom-6');

    const scatter = container.querySelector('[data-testid="scatter-webgl"]');
    expect(scatter?.getAttribute('data-points')).toBe(JSON.stringify(data.points));
    expect(scatter?.getAttribute('data-indices')).toBe(JSON.stringify(data.indices));
    expect(scatter?.getAttribute('data-colors')).toBe(JSON.stringify(data.colors));
    expect(scatter?.getAttribute('data-values')).toBe(JSON.stringify(data.values));
    expect(scatter?.getAttribute('data-use-selection')).toBe('true');
    expect(scatter?.getAttribute('data-clear-background')).toBe('false');
    expect(scatter?.getAttribute('data-point-size')).toBe('6');
    expect(scatter?.getAttribute('data-show-grid')).toBe('false');
    expect(scatter?.getAttribute('data-show-axes')).toBe('false');
    expect(scatter?.getAttribute('data-class-name')).toBe('h-full w-full');
    expect(scatter?.getAttribute('data-bounds')).toBe(JSON.stringify(bounds));

    await act(async () => {
      root.unmount();
    });
  });
});
