/**
 * @vitest-environment jsdom
 */

import type { ReactNode } from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SpectraReferenceAreas } from '../SpectraReferenceAreas';

vi.mock('recharts', () => ({
  ReferenceArea: (props: Record<string, unknown>) => (
    <div
      data-reference-area="true"
      data-x1={String(props.x1)}
      data-x2={String(props.x2)}
      data-y1={props.y1 === undefined ? '' : String(props.y1)}
      data-y2={props.y2 === undefined ? '' : String(props.y2)}
      data-fill={String(props.fill)}
      data-fill-opacity={String(props.fillOpacity)}
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

describe('SpectraReferenceAreas', () => {
  it('maps high-difference, range, and rectangle bounds to ReferenceArea props', async () => {
    const { container, root } = await render(
      <SpectraReferenceAreas
        highDifferenceRegions={[
          { start: 1100, end: 1200 },
          { start: 1450, end: 1480 },
        ]}
        rangeSelectionBounds={{ min: 1250, max: 1300 }}
        rectSelectionBounds={{ x1: 1350, x2: 1400, y1: 0.1, y2: 0.8 }}
      />
    );

    const areas = Array.from(container.querySelectorAll('[data-reference-area="true"]'));
    expect(areas).toHaveLength(4);
    expect(areas[0].getAttribute('data-x1')).toBe('1100');
    expect(areas[0].getAttribute('data-x2')).toBe('1200');
    expect(areas[0].getAttribute('data-fill')).toBe('hsl(30, 100%, 50%)');
    expect(areas[2].getAttribute('data-x1')).toBe('1250');
    expect(areas[2].getAttribute('data-fill-opacity')).toBe('0.15');
    expect(areas[3].getAttribute('data-y1')).toBe('0.1');
    expect(areas[3].getAttribute('data-y2')).toBe('0.8');
    expect(areas[3].getAttribute('data-stroke-dasharray')).toBe('4 2');

    await act(async () => {
      root.unmount();
    });
  });

  it('renders nothing when no bounds are active', async () => {
    const { container, root } = await render(
      <SpectraReferenceAreas
        highDifferenceRegions={[]}
        rangeSelectionBounds={null}
        rectSelectionBounds={null}
      />
    );

    expect(container.querySelector('[data-reference-area="true"]')).toBeNull();

    await act(async () => {
      root.unmount();
    });
  });
});
