/**
 * @vitest-environment jsdom
 */

import type { ReactNode } from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SpectraWebGLBranch } from '../SpectraWebGLBranch';

vi.mock('../WebglIndicatorBadge', () => ({
  WebglIndicatorBadge: () => <div data-testid="webgl-badge" />,
}));

vi.mock('../SpectraWebGL', () => ({
  SpectraWebGL: (props: Record<string, unknown>) => (
    <div
      data-testid="spectra-webgl"
      data-x-label={String(props.xLabel)}
      data-spectra-count={Array.isArray(props.spectra) ? props.spectra.length : 0}
      data-original-count={Array.isArray(props.originalSpectra) ? props.originalSpectra.length : 0}
      data-wavelength-count={Array.isArray(props.wavelengths) ? props.wavelengths.length : 0}
      data-y-count={Array.isArray(props.y) ? props.y.length : 0}
      data-sample-id-count={Array.isArray(props.sampleIds) ? props.sampleIds.length : 0}
      data-fold-count={Array.isArray((props.folds as { fold_labels?: unknown[] } | undefined)?.fold_labels) ? (props.folds as { fold_labels: unknown[] }).fold_labels.length : 0}
      data-visible-indices={Array.isArray(props.visibleIndices) ? props.visibleIndices.join(',') : ''}
      data-sample-colors={Array.isArray(props.sampleColors) ? props.sampleColors.join(',') : ''}
      data-aggregated-mean-count={Array.isArray((props.aggregatedStats as { mean?: unknown[] } | undefined)?.mean) ? (props.aggregatedStats as { mean: unknown[] }).mean.length : 0}
      data-group-count={props.groupedStats instanceof Map ? props.groupedStats.size : 0}
      data-use-selection={String(props.useSelectionContext)}
      data-selected-color={String(props.selectedColor)}
      data-apply-selection={String(props.applySelectionColoring)}
      data-opacity={String(props.unselectedOpacity)}
      data-enable-hover={String(props.enableHover)}
      data-show-hover-tooltip={String(props.showHoverTooltip)}
      data-is-loading={String(props.isLoading)}
      data-class-name={String(props.className)}
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

const stats = {
  mean: [1, 2],
  median: [1.1, 2.1],
  min: [0.5, 1.5],
  max: [1.5, 2.5],
  std: [0.2, 0.3],
  quantileLower: [0.8, 1.8],
  quantileUpper: [1.2, 2.2],
};

afterEach(() => {
  vi.clearAllMocks();
  for (const container of mountedContainers) {
    container.remove();
  }
  mountedContainers = [];
});

describe('SpectraWebGLBranch', () => {
  it('renders the WebGL badge and forwards prepared renderer props', async () => {
    const { container, root } = await render(
      <SpectraWebGLBranch
        xLabel="Wavenumber (cm-1)"
        spectra={[[1, 2], [3, 4]]}
        originalSpectra={[[0.8, 1.8]]}
        wavelengths={[1000, 1002]}
        y={[0.1, 0.2]}
        sampleIds={['sample-a', 'sample-b']}
        folds={{ fold_labels: [0, 1] }}
        visibleIndices={[0, 1]}
        sampleColors={['#ff0000', '#0000ff']}
        aggregatedStats={stats}
        groupedStats={new Map([['train', stats]])}
        useSelectionContext
        selectedColor="#00ff00"
        applySelectionColoring={false}
        unselectedOpacity={0.25}
        enableHover
        showHoverTooltip
        isLoading
        className="absolute inset-0"
      />
    );

    expect(container.querySelector('[data-testid="webgl-badge"]')).toBeTruthy();

    const renderer = container.querySelector('[data-testid="spectra-webgl"]');
    expect(renderer?.getAttribute('data-x-label')).toBe('Wavenumber (cm-1)');
    expect(renderer?.getAttribute('data-spectra-count')).toBe('2');
    expect(renderer?.getAttribute('data-original-count')).toBe('1');
    expect(renderer?.getAttribute('data-wavelength-count')).toBe('2');
    expect(renderer?.getAttribute('data-y-count')).toBe('2');
    expect(renderer?.getAttribute('data-sample-id-count')).toBe('2');
    expect(renderer?.getAttribute('data-fold-count')).toBe('2');
    expect(renderer?.getAttribute('data-visible-indices')).toBe('0,1');
    expect(renderer?.getAttribute('data-sample-colors')).toBe('#ff0000,#0000ff');
    expect(renderer?.getAttribute('data-aggregated-mean-count')).toBe('2');
    expect(renderer?.getAttribute('data-group-count')).toBe('1');
    expect(renderer?.getAttribute('data-use-selection')).toBe('true');
    expect(renderer?.getAttribute('data-selected-color')).toBe('#00ff00');
    expect(renderer?.getAttribute('data-apply-selection')).toBe('false');
    expect(renderer?.getAttribute('data-opacity')).toBe('0.25');
    expect(renderer?.getAttribute('data-enable-hover')).toBe('true');
    expect(renderer?.getAttribute('data-show-hover-tooltip')).toBe('true');
    expect(renderer?.getAttribute('data-is-loading')).toBe('true');
    expect(renderer?.getAttribute('data-class-name')).toBe('absolute inset-0');

    await act(async () => {
      root.unmount();
    });
  });
});
