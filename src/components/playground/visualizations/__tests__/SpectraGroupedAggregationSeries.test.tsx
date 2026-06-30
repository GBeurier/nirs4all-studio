/**
 * @vitest-environment jsdom
 */

import type { ReactNode } from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SpectraGroupedAggregationSeries } from '../SpectraGroupedAggregationSeries';

vi.mock('recharts', () => ({
  Area: (props: Record<string, unknown>) => (
    <div
      data-series="area"
      data-key={String(props.dataKey)}
      data-fill={String(props.fill)}
      data-opacity={String(props.fillOpacity)}
    />
  ),
  Line: (props: Record<string, unknown>) => (
    <div
      data-series="line"
      data-key={String(props.dataKey)}
      data-stroke={String(props.stroke)}
      data-stroke-width={String(props.strokeWidth)}
      data-stroke-dasharray={props.strokeDasharray === undefined ? '' : String(props.strokeDasharray)}
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

describe('SpectraGroupedAggregationSeries', () => {
  it('renders grouped mean/std area and mean line with stable data keys', async () => {
    const { container, root } = await render(
      <SpectraGroupedAggregationSeries
        groupKeys={['batch-a', 'batch-b']}
        aggregationMode="mean_std"
        categoricalPalette="tableau10"
      />
    );

    const areas = Array.from(container.querySelectorAll('[data-series="area"]'));
    const lines = Array.from(container.querySelectorAll('[data-series="line"]'));
    expect(areas.map(area => area.getAttribute('data-key'))).toEqual([
      'grp_batch-a_std_high',
      'grp_batch-b_std_high',
    ]);
    expect(lines.map(line => line.getAttribute('data-key'))).toEqual([
      'grp_batch-a_mean',
      'grp_batch-b_mean',
    ]);
    expect(lines[0].getAttribute('data-stroke-width')).toBe('2');

    await act(async () => {
      root.unmount();
    });
  });

  it('renders the min-max envelope and no elements for disabled aggregation', async () => {
    const { container, root } = await render(
      <SpectraGroupedAggregationSeries
        groupKeys={['site-1']}
        aggregationMode="minmax"
      />
    );

    const areas = Array.from(container.querySelectorAll('[data-series="area"]'));
    const lines = Array.from(container.querySelectorAll('[data-series="line"]'));
    expect(areas.map(area => area.getAttribute('data-key'))).toEqual(['grp_site-1_max']);
    expect(lines.map(line => line.getAttribute('data-key'))).toEqual([
      'grp_site-1_min',
      'grp_site-1_max',
      'grp_site-1_mean',
    ]);
    expect(lines[0].getAttribute('data-stroke-dasharray')).toBe('2 2');

    await act(async () => {
      root.render(
        <SpectraGroupedAggregationSeries
          groupKeys={['site-1']}
          aggregationMode="none"
        />
      );
    });

    expect(container.querySelector('[data-series]')).toBeNull();

    await act(async () => {
      root.unmount();
    });
  });
});
