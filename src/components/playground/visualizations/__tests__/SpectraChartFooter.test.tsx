/**
 * @vitest-environment jsdom
 */

import type { ReactNode } from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';

import { SpectraChartFooter } from '../SpectraChartFooter';

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

afterEach(async () => {
  for (const container of mountedContainers) {
    container.remove();
  }
  mountedContainers = [];
});

describe('SpectraChartFooter', () => {
  it('renders legend, selection, difference stats, and zoom status', async () => {
    const { container, root } = await render(
      <SpectraChartFooter
        legendItems={[
          { label: 'Processed', color: 'red' },
          { label: 'Reference', color: 'blue', dashed: true },
          { label: 'Group', color: 'green', isArea: true },
        ]}
        selectedCount={3}
        differenceStats={{
          meanAbsDiff: 0.0012,
          maxAbsDiff: 0.034,
          rmse: 0.0056,
        }}
        brushDomain={[1000, 1200]}
        wavelengthUnitSuffix=" nm"
      />
    );

    expect(container.textContent).toContain('Processed');
    expect(container.textContent).toContain('Reference');
    expect(container.textContent).toContain('Group');
    expect(container.textContent).toContain('3 selected');
    expect(container.textContent).toContain('MAD: 1.20e-3');
    expect(container.textContent).toContain('Max: 3.40e-2');
    expect(container.textContent).toContain('RMSE: 5.60e-3');
    expect(container.textContent).toContain('Zoom: 1000 - 1200 nm');

    await act(async () => {
      root.unmount();
    });
  });
});
