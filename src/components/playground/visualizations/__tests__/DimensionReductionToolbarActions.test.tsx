/**
 * @vitest-environment jsdom
 */

import type { ReactNode } from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DimensionReductionToolbarActions } from '../DimensionReductionToolbarActions';

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

describe('DimensionReductionToolbarActions', () => {
  it('wires 3D, hover, and export actions', async () => {
    const onToggleViewMode = vi.fn();
    const onToggleHover = vi.fn();
    const onExport = vi.fn();

    const { container, root } = await render(
      <DimensionReductionToolbarActions
        canToggle3d
        is3d={false}
        enableHover
        onToggleViewMode={onToggleViewMode}
        onToggleHover={onToggleHover}
        onExport={onExport}
      />
    );

    const buttons = Array.from(container.querySelectorAll('button'));
    expect(buttons).toHaveLength(3);

    await act(async () => {
      buttons[0].click();
      buttons[1].click();
      buttons[2].click();
    });

    expect(onToggleViewMode).toHaveBeenCalledTimes(1);
    expect(onToggleHover).toHaveBeenCalledTimes(1);
    expect(onExport).toHaveBeenCalledTimes(1);

    await act(async () => {
      root.unmount();
    });
  });

  it('omits the 3D action when there are not enough dimensions', async () => {
    const { container, root } = await render(
      <DimensionReductionToolbarActions
        canToggle3d={false}
        is3d={false}
        enableHover={false}
        onToggleViewMode={vi.fn()}
        onToggleHover={vi.fn()}
        onExport={vi.fn()}
      />
    );

    expect(container.querySelectorAll('button')).toHaveLength(2);

    await act(async () => {
      root.unmount();
    });
  });
});
