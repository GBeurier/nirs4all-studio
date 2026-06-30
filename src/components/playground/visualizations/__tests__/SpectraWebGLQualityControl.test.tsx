/**
 * @vitest-environment jsdom
 */

import type { ReactNode } from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SpectraWebGLQualityControl } from '../SpectraWebGLQualityControl';

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

function getButton(label: string): HTMLButtonElement {
  const button = Array.from(document.body.querySelectorAll('button'))
    .find(candidate => candidate.textContent?.includes(label));
  expect(button).toBeTruthy();
  return button as HTMLButtonElement;
}

afterEach(() => {
  for (const container of mountedContainers) {
    container.remove();
  }
  mountedContainers = [];
});

describe('SpectraWebGLQualityControl', () => {
  it('renders quality status and wires menu actions', async () => {
    const onToggleQualityMenu = vi.fn();
    const onCloseQualityMenu = vi.fn();
    const onQualityChange = vi.fn();

    const { container, root } = await render(
      <SpectraWebGLQualityControl
        showQualityControls
        spectraCount={12}
        internalQuality="auto"
        effectiveQuality="medium"
        autoQuality="high"
        showQualityMenu={false}
        onToggleQualityMenu={onToggleQualityMenu}
        onCloseQualityMenu={onCloseQualityMenu}
        onQualityChange={onQualityChange}
      />
    );

    expect(container.textContent).toContain('12 spectra');
    expect(container.textContent).toContain('auto (medium)');

    await act(async () => {
      getButton('auto (medium)').click();
    });

    expect(onToggleQualityMenu).toHaveBeenCalledTimes(1);

    await act(async () => {
      root.render(
        <SpectraWebGLQualityControl
          showQualityControls
          spectraCount={12}
          internalQuality="auto"
          effectiveQuality="medium"
          autoQuality="high"
          showQualityMenu
          onToggleQualityMenu={onToggleQualityMenu}
          onCloseQualityMenu={onCloseQualityMenu}
          onQualityChange={onQualityChange}
        />
      );
    });

    expect(container.textContent).toContain('auto (high)');
    expect(container.textContent).toContain('low');
    expect(container.textContent).toContain('medium');
    expect(container.textContent).toContain('high');

    await act(async () => {
      getButton('low').click();
    });

    expect(onQualityChange).toHaveBeenCalledWith('low');

    const clickOutside = container.querySelector('.fixed');
    expect(clickOutside).toBeTruthy();

    await act(async () => {
      (clickOutside as HTMLElement).click();
    });

    expect(onCloseQualityMenu).toHaveBeenCalledTimes(1);

    await act(async () => {
      root.unmount();
    });
  });

  it('hides the quality control while preserving outside-click handling for an open menu', async () => {
    const onCloseQualityMenu = vi.fn();

    const { container, root } = await render(
      <SpectraWebGLQualityControl
        showQualityControls={false}
        spectraCount={12}
        internalQuality="high"
        effectiveQuality="high"
        autoQuality="high"
        showQualityMenu
        onToggleQualityMenu={vi.fn()}
        onCloseQualityMenu={onCloseQualityMenu}
        onQualityChange={vi.fn()}
      />
    );

    expect(container.textContent).not.toContain('12 spectra');

    const clickOutside = container.querySelector('.fixed');
    expect(clickOutside).toBeTruthy();

    await act(async () => {
      (clickOutside as HTMLElement).click();
    });

    expect(onCloseQualityMenu).toHaveBeenCalledTimes(1);

    await act(async () => {
      root.unmount();
    });
  });
});
