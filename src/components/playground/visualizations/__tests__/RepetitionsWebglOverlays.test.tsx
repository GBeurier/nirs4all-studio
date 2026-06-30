/**
 * @vitest-environment jsdom
 */

import type { ReactNode } from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';

import { RepetitionsWebglOverlays } from '../RepetitionsWebglOverlays';
import type { RepetitionQuantileValue } from '@/lib/playground/repetitionsChartData';

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

describe('RepetitionsWebglOverlays', () => {
  it('renders linear axes, x labels, grid, and quantile markers', async () => {
    const quantileValues: RepetitionQuantileValue[] = [
      { quantile: 50, value: 0.5 },
      { quantile: 90, value: 0.9 },
    ];

    const { container, root } = await render(
      <RepetitionsWebglOverlays
        bounds={{ minX: -0.5, maxX: 3.5, minY: 0, maxY: 1 }}
        scaleType="linear"
        xTicks={[0, 2]}
        bioSampleCount={4}
        showGrid
        quantileValues={quantileValues}
        formatXAxisTick={(value) => `bio-${value}`}
      />
    );

    expect(container.textContent).toContain('Distance');
    expect(container.textContent).toContain('bio-0');
    expect(container.textContent).toContain('bio-2');
    expect(container.textContent).toContain('P50');
    expect(container.textContent).toContain('P90');
    expect(container.querySelectorAll('.border-dashed').length).toBeGreaterThan(0);

    await act(async () => {
      root.unmount();
    });
  });

  it('renders log axis copy without grid or quantile markers', async () => {
    const { container, root } = await render(
      <RepetitionsWebglOverlays
        bounds={{ minX: -0.5, maxX: 1.5, minY: 0, maxY: 2 }}
        scaleType="log"
        xTicks={[0]}
        bioSampleCount={2}
        showGrid={false}
        quantileValues={[]}
        formatXAxisTick={(value) => `sample-${value}`}
      />
    );

    expect(container.textContent).toContain('log(1 + Distance)');
    expect(container.textContent).toContain('sample-0');
    expect(container.textContent).not.toContain('P50');
    expect(container.querySelectorAll('.border-dashed')).toHaveLength(0);

    await act(async () => {
      root.unmount();
    });
  });
});
