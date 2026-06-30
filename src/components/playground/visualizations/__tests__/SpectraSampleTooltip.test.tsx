/**
 * @vitest-environment jsdom
 */

import type { ReactNode } from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';

import { SpectraSampleTooltip } from '../SpectraSampleTooltip';

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

describe('SpectraSampleTooltip', () => {
  it('renders hovered sample details from Recharts payload', async () => {
    const { container, root } = await render(
      <SpectraSampleTooltip
        enableHover
        active
        payload={[{ payload: { wavelength: 1234.56, p0: 0.123456 } }]}
        hoveredSample={2}
        sampleIds={['s0', 's1', 'sample-c']}
        targetValues={[0, 1, 2.34567]}
        foldLabels={[0, 0, 1]}
        displayIndices={[2]}
        wavelengthAxisName="Wavenumber"
        wavelengthUnitSuffix=" cm-1"
      />
    );

    expect(container.textContent).toContain('sample-c');
    expect(container.textContent).toContain('Y: 2.346');
    expect(container.textContent).toContain('Fold: 2');
    expect(container.textContent).toContain('1234.6 cm-1');
    expect(container.textContent).toContain('A: 0.1235');

    await act(async () => {
      root.unmount();
    });
  });

  it('renders nothing when hover is disabled, inactive, or no sample is hovered', async () => {
    const { container, root } = await render(
      <SpectraSampleTooltip
        enableHover={false}
        active
        hoveredSample={2}
        displayIndices={[2]}
        wavelengthAxisName="Wavelength"
        wavelengthUnitSuffix=" nm"
      />
    );

    expect(container.textContent).toBe('');

    await act(async () => {
      root.render(
        <SpectraSampleTooltip
          enableHover
          active={false}
          hoveredSample={2}
          displayIndices={[2]}
          wavelengthAxisName="Wavelength"
          wavelengthUnitSuffix=" nm"
        />
      );
    });

    expect(container.textContent).toBe('');

    await act(async () => {
      root.render(
        <SpectraSampleTooltip
          enableHover
          active
          hoveredSample={null}
          displayIndices={[2]}
          wavelengthAxisName="Wavelength"
          wavelengthUnitSuffix=" nm"
        />
      );
    });

    expect(container.textContent).toBe('');

    await act(async () => {
      root.unmount();
    });
  });
});
