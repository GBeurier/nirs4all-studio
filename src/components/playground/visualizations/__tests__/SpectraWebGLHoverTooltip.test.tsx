/**
 * @vitest-environment jsdom
 */

import type { ReactNode } from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';

import { SpectraWebGLHoverTooltip } from '../SpectraWebGLHoverTooltip';

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

describe('SpectraWebGLHoverTooltip', () => {
  it('renders hovered sample details and flips near the right side', async () => {
    const { container, root } = await render(
      <SpectraWebGLHoverTooltip
        showHoverTooltip
        enableHover
        hoveredSampleIdx={1}
        mousePosition={{ x: 80, y: 40 }}
        containerWidth={100}
        sampleIds={['S-1', 'S-2']}
        y={[1.25, 2.5]}
        foldLabels={[0, 2]}
      />
    );

    expect(container.textContent).toContain('S-2');
    expect(container.textContent).toContain('Y: 2.500');
    expect(container.textContent).toContain('Fold: 3');

    const tooltip = container.querySelector('.z-30') as HTMLElement | null;
    expect(tooltip).toBeTruthy();
    expect(tooltip?.style.left).toBe('90px');
    expect(tooltip?.style.top).toBe('30px');
    expect(tooltip?.style.transform).toBe('translateX(-100%)');

    await act(async () => {
      root.unmount();
    });
  });

  it('suppresses unavailable tooltip states', async () => {
    const { container, root } = await render(
      <SpectraWebGLHoverTooltip
        showHoverTooltip={false}
        enableHover
        hoveredSampleIdx={0}
        mousePosition={{ x: 10, y: 10 }}
        containerWidth={100}
      />
    );

    expect(container.textContent).toBe('');

    await act(async () => {
      root.render(
        <SpectraWebGLHoverTooltip
          showHoverTooltip
          enableHover={false}
          hoveredSampleIdx={0}
          mousePosition={{ x: 10, y: 10 }}
          containerWidth={100}
        />
      );
    });

    expect(container.textContent).toBe('');

    await act(async () => {
      root.render(
        <SpectraWebGLHoverTooltip
          showHoverTooltip
          enableHover
          hoveredSampleIdx={null}
          mousePosition={{ x: 10, y: 10 }}
          containerWidth={100}
        />
      );
    });

    expect(container.textContent).toBe('');

    await act(async () => {
      root.unmount();
    });
  });
});
