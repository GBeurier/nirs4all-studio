/**
 * @vitest-environment jsdom
 */

import type { ReactNode } from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DimensionReductionSettingsMenu } from '../DimensionReductionSettingsMenu';

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

function getMenuItem(label: string): HTMLElement {
  const item = Array.from(document.body.querySelectorAll('[role^="menuitem"]'))
    .find(candidate => candidate.textContent?.includes(label));
  expect(item).toBeTruthy();
  return item as HTMLElement;
}

afterEach(() => {
  for (const container of mountedContainers) {
    container.remove();
  }
  mountedContainers = [];
});

describe('DimensionReductionSettingsMenu', () => {
  it('renders settings sections and wires menu callbacks', async () => {
    const onPointSizeChange = vi.fn();
    const onShowGridChange = vi.fn();
    const onPreserveAspectRatioChange = vi.fn();
    const onColorModeChange = vi.fn();
    const onMetadataKeyChange = vi.fn();

    const { container, root } = await render(
      <DimensionReductionSettingsMenu
        pointSize="medium"
        showGrid
        preserveAspectRatio={false}
        colorMode="metadata"
        metadataKey="batch"
        showEqualAxisScale
        showLegacyColorOptions
        hasFolds
        metadataKeys={['batch', 'site']}
        onPointSizeChange={onPointSizeChange}
        onShowGridChange={onShowGridChange}
        onPreserveAspectRatioChange={onPreserveAspectRatioChange}
        onColorModeChange={onColorModeChange}
        onMetadataKeyChange={onMetadataKeyChange}
      />
    );

    await openMenu(container);

    expect(document.body.textContent).toContain('Point Size');
    expect(document.body.textContent).toContain('Color By');
    expect(document.body.textContent).toContain('Field');

    await act(async () => {
      getMenuItem('Large').click();
    });

    await openMenu(container);
    await act(async () => {
      getMenuItem('Show Grid').click();
    });

    await openMenu(container);
    await act(async () => {
      getMenuItem('Equal Axis Scale').click();
    });

    await openMenu(container);
    await act(async () => {
      getMenuItem('Fold').click();
    });

    await openMenu(container);
    await act(async () => {
      getMenuItem('site').click();
    });

    expect(onPointSizeChange).toHaveBeenCalledWith('large');
    expect(onShowGridChange).toHaveBeenCalledWith(false);
    expect(onPreserveAspectRatioChange).toHaveBeenCalledWith(true);
    expect(onColorModeChange).toHaveBeenCalledWith('fold');
    expect(onMetadataKeyChange).toHaveBeenCalledWith('site');

    await act(async () => {
      root.unmount();
    });
  });

  it('hides renderer-specific and legacy color options when unavailable', async () => {
    const { container, root } = await render(
      <DimensionReductionSettingsMenu
        pointSize="small"
        showGrid={false}
        preserveAspectRatio={false}
        colorMode="target"
        showEqualAxisScale={false}
        showLegacyColorOptions={false}
        hasFolds={false}
        metadataKeys={[]}
        onPointSizeChange={vi.fn()}
        onShowGridChange={vi.fn()}
        onPreserveAspectRatioChange={vi.fn()}
        onColorModeChange={vi.fn()}
        onMetadataKeyChange={vi.fn()}
      />
    );

    await openMenu(container);

    expect(document.body.textContent).not.toContain('Equal Axis Scale');
    expect(document.body.textContent).not.toContain('Color By');
    expect(document.body.textContent).not.toContain('Metadata');

    await act(async () => {
      root.unmount();
    });
  });
});
