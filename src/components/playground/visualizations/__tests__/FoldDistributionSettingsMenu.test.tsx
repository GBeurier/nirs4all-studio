/**
 * @vitest-environment jsdom
 */

import type { ReactNode } from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FoldDistributionSettingsMenu } from '../FoldDistributionSettingsMenu';

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

function getMenuItem(label: string): HTMLElement {
  const item = Array.from(document.body.querySelectorAll('[role="menuitemcheckbox"]'))
    .find(candidate => candidate.textContent?.includes(label));
  expect(item).toBeTruthy();
  return item as HTMLElement;
}

async function openMenu(container: HTMLElement) {
  const trigger = container.querySelector('button');
  expect(trigger).toBeTruthy();

  await act(async () => {
    trigger?.dispatchEvent(new MouseEvent('pointerdown', {
      bubbles: true,
      button: 0,
      ctrlKey: false,
    }));
  });
}

afterEach(() => {
  for (const container of mountedContainers) {
    container.remove();
  }
  mountedContainers = [];
});

describe('FoldDistributionSettingsMenu', () => {
  it('renders display options and wires checkbox callbacks', async () => {
    const onShowLegendChange = vi.fn();
    const onShowYLegendChange = vi.fn();
    const onShowMeanLineChange = vi.fn();

    const { container, root } = await render(
      <FoldDistributionSettingsMenu
        showLegend
        showYLegend={false}
        showMeanLine={false}
        disableYLegend={false}
        disableMeanLine={false}
        onShowLegendChange={onShowLegendChange}
        onShowYLegendChange={onShowYLegendChange}
        onShowMeanLineChange={onShowMeanLineChange}
      />
    );

    await openMenu(container);

    expect(document.body.textContent).toContain('Display Options');
    expect(document.body.textContent).toContain('Show Color Legend');
    expect(document.body.textContent).toContain('Show Y Value Legend');
    expect(document.body.textContent).toContain('Show Global Mean (Y Dist.)');

    await act(async () => {
      getMenuItem('Show Color Legend').click();
    });

    await openMenu(container);
    await act(async () => {
      getMenuItem('Show Y Value Legend').click();
    });

    await openMenu(container);
    await act(async () => {
      getMenuItem('Show Global Mean (Y Dist.)').click();
    });

    expect(onShowLegendChange).toHaveBeenCalledWith(false);
    expect(onShowYLegendChange).toHaveBeenCalledWith(true);
    expect(onShowMeanLineChange).toHaveBeenCalledWith(true);

    await act(async () => {
      root.unmount();
    });
  });

  it('disables unavailable y-value and mean-line options', async () => {
    const { container, root } = await render(
      <FoldDistributionSettingsMenu
        showLegend
        showYLegend={false}
        showMeanLine={false}
        disableYLegend
        disableMeanLine
        onShowLegendChange={vi.fn()}
        onShowYLegendChange={vi.fn()}
        onShowMeanLineChange={vi.fn()}
      />
    );

    await openMenu(container);

    expect(getMenuItem('Show Y Value Legend').getAttribute('aria-disabled')).toBe('true');
    expect(getMenuItem('Show Global Mean (Y Dist.)').getAttribute('aria-disabled')).toBe('true');

    await act(async () => {
      root.unmount();
    });
  });
});
