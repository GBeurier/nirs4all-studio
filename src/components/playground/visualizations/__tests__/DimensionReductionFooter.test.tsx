/**
 * @vitest-environment jsdom
 */

import type { ReactNode } from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';

import { DimensionReductionFooter } from '../DimensionReductionFooter';

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

describe('DimensionReductionFooter', () => {
  it('renders variance summary, selected count, and reference legend', async () => {
    const { container, root } = await render(
      <DimensionReductionFooter
        compact={false}
        showVarianceSummary
        xAxisLabel="PC1 (55.00%)"
        yAxisLabel="PC2 (20.00%)"
        selectedCount={3}
        hasReferenceData
        referenceLabel="Reference set"
      />
    );

    expect(container.textContent).toContain('Var: PC1 (55.00%), PC2 (20.00%)');
    expect(container.textContent).toContain('• 3 selected');
    expect(container.textContent).toContain('Reference set');
    expect(container.querySelector('[style*="polygon"]')).not.toBeNull();

    await act(async () => {
      root.unmount();
    });
  });

  it('renders nothing in compact mode', async () => {
    const { container, root } = await render(
      <DimensionReductionFooter
        compact
        showVarianceSummary
        xAxisLabel="PC1"
        yAxisLabel="PC2"
        selectedCount={1}
        hasReferenceData
        referenceLabel="Reference"
      />
    );

    expect(container.textContent).toBe('');

    await act(async () => {
      root.unmount();
    });
  });
});
