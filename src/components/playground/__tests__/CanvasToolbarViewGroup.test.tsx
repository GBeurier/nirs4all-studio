/**
 * @vitest-environment jsdom
 */

import type { ReactNode } from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CanvasToolbarViewGroup } from '../CanvasToolbarViewGroup';
import type { ChartType } from '@/context/usePlaygroundView';

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

function getButton(container: HTMLElement, label: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll('button'))
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

describe('CanvasToolbarViewGroup', () => {
  it('renders chart visibility controls and disables unavailable charts', async () => {
    const onToggleChart = vi.fn();
    const onInteractionStart = vi.fn();
    const { container, root } = await render(
      <CanvasToolbarViewGroup
        effectiveVisibleCharts={new Set<ChartType>(['spectra', 'pca'])}
        onToggleChart={onToggleChart}
        showFoldsChart={false}
        hasRepetitions={false}
        isFetching={false}
        totalSamples={50}
        onInteractionStart={onInteractionStart}
      />
    );

    const spectraButton = getButton(container, 'Spectra');
    await act(async () => {
      spectraButton.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      spectraButton.click();
    });

    expect(onInteractionStart).toHaveBeenCalledTimes(1);
    expect(onToggleChart).toHaveBeenCalledWith('spectra');
    expect(getButton(container, 'Folds').disabled).toBe(true);
    expect(getButton(container, 'Reps').disabled).toBe(true);

    await act(async () => {
      root.unmount();
    });
  });

  it('wires spectra diff and subset toggles independently from chart visibility', async () => {
    const onToggleChart = vi.fn();
    const onInteractionStart = vi.fn();
    const onSpectraViewModeChange = vi.fn();
    const onSubsetModeChange = vi.fn();
    const { container, root } = await render(
      <CanvasToolbarViewGroup
        effectiveVisibleCharts={new Set<ChartType>(['spectra'])}
        onToggleChart={onToggleChart}
        showFoldsChart
        hasRepetitions
        isFetching
        totalSamples={500}
        onInteractionStart={onInteractionStart}
        spectraViewMode="processed"
        onSpectraViewModeChange={onSpectraViewModeChange}
        subsetMode="all"
        onSubsetModeChange={onSubsetModeChange}
        subsetInfo={{ subset_mode: 'visible', total_samples: 500, displayed_samples: 200 }}
      />
    );

    const diffButton = getButton(container, 'Diff');
    await act(async () => {
      diffButton.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      diffButton.click();
    });

    expect(onSpectraViewModeChange).toHaveBeenCalledWith('difference');
    expect(onInteractionStart).toHaveBeenCalledTimes(1);

    const subsetButton = getButton(container, 'All');
    await act(async () => {
      subsetButton.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      subsetButton.click();
    });

    expect(onSubsetModeChange).toHaveBeenCalledWith('visible');
    expect(onToggleChart).not.toHaveBeenCalled();
    expect(onInteractionStart).toHaveBeenCalledTimes(2);

    await act(async () => {
      root.unmount();
    });
  });

  it('uses registry-provided toggle disabled state when provided', async () => {
    const onToggleChart = vi.fn();
    const onInteractionStart = vi.fn();
    const { container, root } = await render(
      <CanvasToolbarViewGroup
        effectiveVisibleCharts={new Set<ChartType>(['spectra'])}
        onToggleChart={onToggleChart}
        toggleableCharts={[
          { id: 'spectra', label: 'Spectra', disabled: false, disabledReason: null },
          { id: 'pca', label: 'PCA', disabled: true, disabledReason: 'No projection available' },
        ]}
        showFoldsChart
        hasRepetitions
        isFetching={false}
        totalSamples={50}
        onInteractionStart={onInteractionStart}
      />
    );

    expect(getButton(container, 'PCA').disabled).toBe(true);

    await act(async () => {
      getButton(container, 'PCA').click();
    });

    expect(onToggleChart).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
  });
});
