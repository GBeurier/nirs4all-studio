/**
 * @vitest-environment jsdom
 */

import type { ReactNode } from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SpectraSampleLineSeries } from '../SpectraSampleLineSeries';
import type { SpectraLineBaseColor } from '@/lib/playground/spectraLineColor';

vi.mock('recharts', () => ({
  Line: (props: Record<string, unknown>) => (
    <div
      data-series="line"
      data-key={String(props.dataKey)}
      data-stroke={String(props.stroke)}
      data-stroke-width={String(props.strokeWidth)}
      data-stroke-dasharray={props.strokeDasharray === undefined ? '' : String(props.strokeDasharray)}
      data-stroke-opacity={props.strokeOpacity === undefined ? '' : String(props.strokeOpacity)}
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

const getBaseLineColor = (sampleIndex: number, isOriginal: boolean): SpectraLineBaseColor => ({
  color: `hsl(${sampleIndex}, 70%, 50%)`,
  terminal: false,
  isOriginalBoth: isOriginal,
});

afterEach(() => {
  for (const container of mountedContainers) {
    container.remove();
  }
  mountedContainers = [];
});

describe('SpectraSampleLineSeries', () => {
  it('renders original, processed, and reference lines with stable data keys', async () => {
    const { container, root } = await render(
      <SpectraSampleLineSeries
        displayIndices={[4, 7]}
        showOriginal
        showProcessed
        showDifference={false}
        viewModeBoth
        selectedSamples={new Set([4])}
        pinnedSamples={new Set([7])}
        hoveredSample={null}
        hasSelection
        isSelectedOnlyMode={false}
        colorConfig={{
          selectionOverride: true,
          highlightPinned: true,
          selectionColor: '#00f',
          unselectedOpacity: 0.3,
        }}
        getBaseLineColor={getBaseLineColor}
        referenceLineCount={1}
      />
    );

    const lines = Array.from(container.querySelectorAll('[data-series="line"]'));
    expect(lines.map(line => line.getAttribute('data-key'))).toEqual(['o0', 'o1', 'p0', 'p1', 'r0']);
    expect(lines[0].getAttribute('data-stroke-dasharray')).toBe('4 2');
    expect(lines[1].getAttribute('data-stroke-dasharray')).toBe('4 2');
    expect(lines[0].getAttribute('data-stroke-width')).toBe('2.5');
    expect(lines[1].getAttribute('data-stroke-width')).toBe('2.5');
    expect(lines[4].getAttribute('data-stroke')).toBe('#9333ea');
    expect(lines[4].getAttribute('data-stroke-dasharray')).toBe('6 3');
    expect(lines[4].getAttribute('data-stroke-opacity')).toBe('0.7');

    await act(async () => {
      root.unmount();
    });
  });

  it('renders processed sample lines for difference mode even when processed view is hidden', async () => {
    const { container, root } = await render(
      <SpectraSampleLineSeries
        displayIndices={[2]}
        showOriginal={false}
        showProcessed={false}
        showDifference
        viewModeBoth={false}
        selectedSamples={new Set()}
        pinnedSamples={new Set()}
        hoveredSample={null}
        hasSelection={false}
        isSelectedOnlyMode={false}
        colorConfig={{
          selectionOverride: false,
          highlightPinned: false,
          selectionColor: undefined,
          unselectedOpacity: 0.4,
        }}
        getBaseLineColor={getBaseLineColor}
      />
    );

    const lines = Array.from(container.querySelectorAll('[data-series="line"]'));
    expect(lines).toHaveLength(1);
    expect(lines[0].getAttribute('data-key')).toBe('p0');
    expect(lines[0].getAttribute('data-stroke-width')).toBe('1');

    await act(async () => {
      root.unmount();
    });
  });
});
