/**
 * @vitest-environment jsdom
 */

import type { ReactNode } from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RepetitionsChartHeader } from '../RepetitionsChartHeader';

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

describe('RepetitionsChartHeader', () => {
  it('renders repetition controls and wires presentation actions', async () => {
    const onGridToggle = vi.fn();
    const onSortByChange = vi.fn();
    const onMetadataSortColumnChange = vi.fn();
    const onRendererTypeChange = vi.fn();
    const onEnableHoverChange = vi.fn();
    const onConfigureRepetitions = vi.fn();
    const onExport = vi.fn();

    const { container, root } = await render(
      <RepetitionsChartHeader
        hasRepetitions
        bioSampleCount={3}
        groupCount={5}
        isBusy
        showGrid
        onGridToggle={onGridToggle}
        sortBy="metadata_column"
        onSortByChange={onSortByChange}
        availableMetadataColumns={['batch', 'operator']}
        metadataSortColumn="batch"
        onMetadataSortColumnChange={onMetadataSortColumnChange}
        rendererType="webgl"
        onRendererTypeChange={onRendererTypeChange}
        enableHover
        onEnableHoverChange={onEnableHoverChange}
        zoomInfo={{ level: 40, visible: 2, total: 5 }}
        onConfigureRepetitions={onConfigureRepetitions}
        onExport={onExport}
      />
    );

    expect(container.textContent).toContain('Repetitions');
    expect(container.textContent).toContain('3 bio samples');
    expect(container.textContent).toContain('Computing...');
    expect(container.textContent).toContain('Metadata Column');
    expect(container.textContent).toContain('batch');
    expect(container.textContent).toContain('2/5');

    const buttons = Array.from(container.querySelectorAll('button'));
    expect(buttons).toHaveLength(7);

    await act(async () => {
      buttons[2].click();
      buttons[3].click();
      buttons[4].click();
      buttons[5].click();
      buttons[6].click();
    });

    expect(onRendererTypeChange).toHaveBeenNthCalledWith(1, 'recharts');
    expect(onRendererTypeChange).toHaveBeenNthCalledWith(2, 'webgl');
    expect(onEnableHoverChange).toHaveBeenCalledWith(false);
    expect(onConfigureRepetitions).toHaveBeenCalledTimes(1);
    expect(onExport).toHaveBeenCalledTimes(1);
    expect(onGridToggle).not.toHaveBeenCalled();
    expect(onSortByChange).not.toHaveBeenCalled();
    expect(onMetadataSortColumnChange).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
  });

  it('uses fallback grouping copy and hides metadata picker outside metadata sort', async () => {
    const { container, root } = await render(
      <RepetitionsChartHeader
        hasRepetitions={false}
        bioSampleCount={0}
        groupCount={4}
        isBusy={false}
        showGrid={false}
        onGridToggle={vi.fn()}
        sortBy="index"
        onSortByChange={vi.fn()}
        availableMetadataColumns={['batch']}
        metadataSortColumn="batch"
        onMetadataSortColumnChange={vi.fn()}
        rendererType="recharts"
        onRendererTypeChange={vi.fn()}
        enableHover={false}
        onEnableHoverChange={vi.fn()}
        zoomInfo={{ level: 100, visible: 4, total: 4 }}
        onExport={vi.fn()}
      />
    );

    expect(container.textContent).toContain('4 groups');
    expect(container.textContent).toContain('Original Index');
    expect(container.textContent).not.toContain('batch');

    await act(async () => {
      root.unmount();
    });
  });
});
