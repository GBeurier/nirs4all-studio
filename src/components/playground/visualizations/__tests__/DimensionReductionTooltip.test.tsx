/**
 * @vitest-environment jsdom
 */

import type { ReactNode } from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';

import {
  DimensionReductionFloatingTooltip,
  DimensionReductionRechartsTooltip,
  type DimensionReductionTooltipPoint,
} from '../DimensionReductionTooltip';

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

const point: DimensionReductionTooltipPoint = {
  name: 'sample-a',
  x: 1.2345,
  y: -2.3456,
  z: 3.4567,
  yValue: 9.8765,
  foldLabel: 1,
  metadata: {
    batch: 'A',
    operator: 'NIR-1',
    ignoredAfterLimit: 'hidden',
  },
};

afterEach(() => {
  for (const container of mountedContainers) {
    container.remove();
  }
  mountedContainers = [];
});

describe('DimensionReductionTooltip', () => {
  it('renders Recharts tooltip content for hovered 2D points', async () => {
    const { container, root } = await render(
      <DimensionReductionRechartsTooltip
        enableHover
        payload={[{ payload: point }]}
        xLabel="PC1 (55.00%)"
        yLabel="PC2 (20.00%)"
      />
    );

    expect(container.textContent).toContain('sample-a');
    expect(container.textContent).toContain('PC1 (55.00%): 1.234');
    expect(container.textContent).toContain('PC2 (20.00%): -2.346');
    expect(container.textContent).toContain('Y: 9.88');
    expect(container.textContent).toContain('Fold 2');
    expect(container.textContent).toContain('batch: A');
    expect(container.textContent).not.toContain('UMAP3');

    await act(async () => {
      root.unmount();
    });
  });

  it('renders floating 3D tooltip with mouse positioning', async () => {
    const { container, root } = await render(
      <DimensionReductionFloatingTooltip
        enableHover
        point={point}
        mousePosition={{ x: 80, y: 40 }}
        containerWidth={100}
        xLabel="UMAP1"
        yLabel="UMAP2"
        zLabel="UMAP3"
        showZ
      />
    );

    const tooltip = container.firstElementChild as HTMLElement | null;
    expect(container.textContent).toContain('UMAP3: 3.457');
    expect(tooltip?.style.left).toBe('92px');
    expect(tooltip?.style.top).toBe('52px');
    expect(tooltip?.style.transform).toBe('translateX(-100%)');

    await act(async () => {
      root.unmount();
    });
  });

  it('renders nothing when hover or payload state is inactive', async () => {
    const { container, root } = await render(
      <DimensionReductionRechartsTooltip
        enableHover={false}
        payload={[{ payload: point }]}
        xLabel="PC1"
        yLabel="PC2"
      />
    );

    expect(container.textContent).toBe('');

    await act(async () => {
      root.render(
        <DimensionReductionFloatingTooltip
          enableHover
          point={null}
          mousePosition={{ x: 10, y: 10 }}
          xLabel="PC1"
          yLabel="PC2"
        />
      );
    });

    expect(container.textContent).toBe('');

    await act(async () => {
      root.unmount();
    });
  });
});
