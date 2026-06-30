/**
 * @vitest-environment jsdom
 */

import type { ReactNode } from 'react';
import { act, createRef } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SpectraRendererSurface } from '../SpectraRendererSurface';
import type { SpectraRechartsPlotProps } from '../SpectraRechartsPlot';
import type { SpectraWebGLBranchProps } from '../SpectraWebGLBranch';

vi.mock('../SpectraContextMenu', () => ({
  SpectraContextMenu: ({
    children,
    hoveredSample,
    sampleIds,
    yValues,
    folds,
    onExportSamples,
    onSelectSimilar,
  }: {
    children: ReactNode;
    hoveredSample: number | null;
    sampleIds?: string[];
    yValues?: number[];
    folds?: string[];
    onExportSamples?: (sampleIndices: number[]) => void;
    onSelectSimilar?: (sampleIdx: number, criterion: 'fold' | 'yRange' | 'outlier') => void;
  }) => (
    <section
      data-testid="context-menu"
      data-hovered={String(hoveredSample)}
      data-sample-count={String(sampleIds?.length ?? 0)}
      data-y-count={String(yValues?.length ?? 0)}
      data-fold-count={String(folds?.length ?? 0)}
    >
      <button type="button" data-testid="export-samples" onClick={() => onExportSamples?.([1, 2])} />
      <button type="button" data-testid="select-similar" onClick={() => onSelectSimilar?.(1, 'fold')} />
      {children}
    </section>
  ),
}));

vi.mock('../SpectraRechartsPlot', () => ({
  SpectraRechartsPlot: ({
    filteredData,
    onClick,
    onMouseDown,
    onMouseMove,
    onMouseLeave,
  }: {
    filteredData: unknown[];
    onClick: (event: unknown) => void;
    onMouseDown: (event: unknown) => void;
    onMouseMove: (event: unknown) => void;
    onMouseLeave: () => void;
  }) => (
    <div data-testid="recharts-plot" data-row-count={String(filteredData.length)}>
      <button type="button" data-testid="recharts-click" onClick={() => onClick({ activeLabel: 1000 })} />
      <button type="button" data-testid="recharts-mouse-down" onClick={() => onMouseDown({ activeLabel: 1000 })} />
      <button type="button" data-testid="recharts-mouse-move" onClick={() => onMouseMove({ activeLabel: 1002 })} />
      <button type="button" data-testid="recharts-mouse-leave" onClick={() => onMouseLeave()} />
    </div>
  ),
}));

vi.mock('../SpectraWebGLBranch', () => ({
  SpectraWebGLBranch: ({
    spectra,
    wavelengths,
    className,
  }: {
    spectra: number[][];
    wavelengths: number[];
    className?: string;
  }) => (
    <div
      data-testid="webgl-branch"
      data-spectra-count={String(spectra.length)}
      data-wavelength-count={String(wavelengths.length)}
      data-class-name={className}
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

const rechartsProps: SpectraRechartsPlotProps = {
  filteredData: [{ wavelength: 1000 }],
  highDifferenceRegions: [],
  rangeSelectionBounds: null,
  rectSelectionBounds: null,
  showGroupedAggregation: false,
  groupKeys: [],
  aggregationMode: 'none',
  viewMode: 'processed',
  showOriginal: false,
  showProcessed: true,
  showDifference: false,
  viewModeBoth: false,
  displayIndices: [0],
  selectedSamples: new Set<number>(),
  pinnedSamples: new Set<number>(),
  hoveredSample: null,
  hasSelection: false,
  isSelectedOnlyMode: false,
  colorConfig: {
    selectionOverride: false,
    highlightPinned: true,
    selectionColor: undefined,
    unselectedOpacity: 0.4,
  },
  getBaseLineColor: vi.fn(() => ({ color: 'blue', terminal: false, isOriginalBoth: false })),
  referenceLineCount: 0,
  enableHover: true,
  sampleIds: ['sample-a'],
  targetValues: [1],
  foldLabels: [0],
  wavelengthAxisName: 'Wavelength',
  wavelengthUnitSuffix: ' nm',
  onClick: vi.fn(),
  onMouseDown: vi.fn(),
  onMouseMove: vi.fn(),
  onMouseLeave: vi.fn(),
};

const webglProps: SpectraWebGLBranchProps = {
  spectra: [[1, 2]],
  wavelengths: [1000, 1002],
  className: 'absolute inset-0',
};

const defaultProps = {
  chartAreaRef: createRef<HTMLDivElement>(),
  contextMenuProps: {
    hoveredSample: 1,
    sampleIds: ['sample-a', 'sample-b'],
    yValues: [0.1, 0.2],
    folds: ['0', '1'],
    onExportSamples: vi.fn(),
    onSelectSimilar: vi.fn(),
  },
  onBackgroundClick: vi.fn(),
  onRechartsMouseUp: vi.fn(),
  onWheel: vi.fn(),
  onDoubleClick: vi.fn(),
  webglProps,
  rechartsProps,
};

afterEach(() => {
  vi.clearAllMocks();
  for (const container of mountedContainers) {
    container.remove();
  }
  mountedContainers = [];
});

describe('SpectraRendererSurface', () => {
  it('renders the WebGL branch and suppresses Recharts mouse-up routing', async () => {
    const { container, root } = await render(
      <SpectraRendererSurface
        {...defaultProps}
        chartAreaRef={createRef<HTMLDivElement>()}
        isWebGLMode
      />
    );

    expect(container.querySelector('[data-testid="context-menu"]')?.getAttribute('data-hovered')).toBe('1');
    expect(container.querySelector('[data-testid="context-menu"]')?.getAttribute('data-sample-count')).toBe('2');
    expect(container.querySelector('[data-testid="webgl-branch"]')?.getAttribute('data-spectra-count')).toBe('1');
    expect(container.querySelector('[data-testid="webgl-branch"]')?.getAttribute('data-class-name')).toBe('absolute inset-0');
    expect(container.querySelector('[data-testid="recharts-plot"]')).toBeNull();

    const surface = container.querySelector('.flex-1.min-h-0.relative') as HTMLDivElement;

    await act(async () => {
      surface.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      surface.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      surface.dispatchEvent(new WheelEvent('wheel', { bubbles: true }));
      surface.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      (container.querySelector('[data-testid="export-samples"]') as HTMLButtonElement).click();
      (container.querySelector('[data-testid="select-similar"]') as HTMLButtonElement).click();
    });

    expect(defaultProps.onBackgroundClick).toHaveBeenCalledTimes(1);
    expect(defaultProps.onRechartsMouseUp).not.toHaveBeenCalled();
    expect(defaultProps.onWheel).toHaveBeenCalledTimes(1);
    expect(defaultProps.onDoubleClick).toHaveBeenCalledTimes(1);
    expect(defaultProps.contextMenuProps.onExportSamples).toHaveBeenCalledWith([1, 2]);
    expect(defaultProps.contextMenuProps.onSelectSimilar).toHaveBeenCalledWith(1, 'fold');

    await act(async () => {
      root.unmount();
    });
  });

  it('renders the Recharts branch and forwards chart mouse events', async () => {
    const { container, root } = await render(
      <SpectraRendererSurface
        {...defaultProps}
        chartAreaRef={createRef<HTMLDivElement>()}
        isWebGLMode={false}
      />
    );

    expect(container.querySelector('[data-testid="webgl-branch"]')).toBeNull();
    expect(container.querySelector('[data-testid="recharts-plot"]')?.getAttribute('data-row-count')).toBe('1');

    const surface = container.querySelector('.flex-1.min-h-0.relative') as HTMLDivElement;

    await act(async () => {
      surface.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      (container.querySelector('[data-testid="recharts-click"]') as HTMLButtonElement).click();
      (container.querySelector('[data-testid="recharts-mouse-down"]') as HTMLButtonElement).click();
      (container.querySelector('[data-testid="recharts-mouse-move"]') as HTMLButtonElement).click();
      (container.querySelector('[data-testid="recharts-mouse-leave"]') as HTMLButtonElement).click();
    });

    expect(defaultProps.onRechartsMouseUp).toHaveBeenCalledTimes(1);
    expect(rechartsProps.onClick).toHaveBeenCalledWith({ activeLabel: 1000 });
    expect(rechartsProps.onMouseDown).toHaveBeenCalledWith({ activeLabel: 1000 });
    expect(rechartsProps.onMouseMove).toHaveBeenCalledWith({ activeLabel: 1002 });
    expect(rechartsProps.onMouseLeave).toHaveBeenCalledTimes(1);

    await act(async () => {
      root.unmount();
    });
  });
});
