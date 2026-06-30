/**
 * @vitest-environment jsdom
 */

import type { ReactNode } from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';

import { RepetitionsChartTooltip } from '../RepetitionsChartTooltip';
import type { RepetitionsPlotDataPoint } from '@/lib/playground/repetitionsChartData';

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

const point: RepetitionsPlotDataPoint = {
  x: 0,
  groupIndex: 0,
  groupSize: 2,
  y: 0.12345,
  bioSample: 'bio-sample-a',
  repIndex: 1,
  sampleIndex: 4,
  sampleId: 'sample-004',
  targetY: 9.8765,
  yMean: 0.1,
  isOutlier: true,
  isSelected: false,
};

afterEach(() => {
  for (const container of mountedContainers) {
    container.remove();
  }
  mountedContainers = [];
});

describe('RepetitionsChartTooltip', () => {
  it('renders hovered repetition details', async () => {
    const { container, root } = await render(
      <RepetitionsChartTooltip
        enableHover
        active
        payload={[{ payload: point }]}
      />
    );

    expect(container.textContent).toContain('bio-sample-a');
    expect(container.textContent).toContain('Repetition: 2');
    expect(container.textContent).toContain('Sample: sample-004');
    expect(container.textContent).toContain('Distance: 0.12');
    expect(container.textContent).toContain('Y Value: 9.88');
    expect(container.textContent).toContain('High variability');

    await act(async () => {
      root.unmount();
    });
  });

  it('renders nothing when hover is disabled or payload is missing', async () => {
    const { container, root } = await render(
      <RepetitionsChartTooltip
        enableHover={false}
        active
        payload={[{ payload: point }]}
      />
    );

    expect(container.textContent).toBe('');

    await act(async () => {
      root.render(
        <RepetitionsChartTooltip
          enableHover
          active={false}
          payload={[{ payload: point }]}
        />
      );
    });

    expect(container.textContent).toBe('');

    await act(async () => {
      root.render(
        <RepetitionsChartTooltip
          enableHover
          active
          payload={[]}
        />
      );
    });

    expect(container.textContent).toBe('');

    await act(async () => {
      root.unmount();
    });
  });
});
