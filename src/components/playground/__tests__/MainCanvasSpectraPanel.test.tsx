/**
 * @vitest-environment jsdom
 */

import type { ReactNode } from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MainCanvasSpectraPanel } from '../MainCanvasSpectraPanel';
import { DEFAULT_GLOBAL_COLOR_CONFIG, type ColorContext } from '@/lib/playground/colorConfig';
import type { CanvasChartRenderState } from '@/lib/playground/canvasLayout';
import type { SpectraChartDataInput } from '@/lib/playground/chartInputs';
import type { RenderMode } from '@/lib/playground/renderOptimizer';
import type { UseSpectraChartConfigResult } from '@/lib/playground/useSpectraChartConfig';

vi.mock('../ChartPanel', () => ({
  ChartPanel: ({
    children,
    chartType,
    isLoading,
    sampleCount,
    selectedCount,
    pinnedCount,
    onMaximize,
    onHide,
  }: {
    children: ReactNode;
    chartType: string;
    isLoading?: boolean;
    sampleCount?: number;
    selectedCount?: number;
    pinnedCount?: number;
    onMaximize?: () => void;
    onHide?: () => void;
  }) => (
    <section
      data-chart-type={chartType}
      data-loading={String(isLoading)}
      data-sample-count={sampleCount}
      data-selected-count={selectedCount}
      data-pinned-count={pinnedCount}
    >
      <button type="button" onClick={onMaximize}>max</button>
      <button type="button" onClick={onHide}>hide</button>
      {children}
    </section>
  ),
}));

vi.mock('../visualizations', () => ({
  ChartSkeleton: ({ type }: { type?: string }) => <div data-testid="skeleton">{type}</div>,
  SpectraChart: ({
    y,
    sampleIds,
    isLoading,
    renderMode,
    displayRenderMode,
    outlierIndices,
    referenceLabel,
    showAbsoluteDifference,
    onInteractionStart,
    onRenderModeChange,
  }: {
    y?: number[];
    sampleIds?: string[];
    isLoading?: boolean;
    renderMode?: RenderMode;
    displayRenderMode?: RenderMode;
    outlierIndices?: Set<number>;
    referenceLabel?: string;
    showAbsoluteDifference?: boolean;
    onInteractionStart?: () => void;
    onRenderModeChange?: (mode: RenderMode) => void;
  }) => (
    <div
      data-testid="spectra"
      data-loading={String(isLoading)}
      data-render-mode={renderMode}
      data-display-render-mode={displayRenderMode}
      data-outlier-count={outlierIndices?.size ?? 0}
      data-reference-label={referenceLabel}
      data-absolute={String(showAbsoluteDifference)}
    >
      <span>{`${y?.join(',') ?? ''}|${sampleIds?.join(',') ?? ''}`}</span>
      <button type="button" onClick={onInteractionStart}>interact</button>
      <button type="button" onClick={() => onRenderModeChange?.('webgl')}>webgl</button>
    </div>
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

afterEach(() => {
  for (const container of mountedContainers) {
    container.remove();
  }
  mountedContainers = [];
});

const baseRenderState: CanvasChartRenderState = {
  shouldRender: true,
  viewState: 'visible',
  isMaximized: false,
  isLoading: false,
  showSkeleton: false,
};

const dataSection = {
  spectra: [[1, 2], [3, 4]],
  wavelengths: [900, 901],
  shape: [2, 2],
  header_unit: 'nm',
};

const baseInput = {
  original: dataSection,
  processed: dataSection,
  y: [1, 2],
  sampleIds: ['a', 'b'],
  folds: null,
} as unknown as SpectraChartDataInput;

const colorContext: ColorContext = {
  y: [1, 2],
  totalSamples: 2,
};

function renderPanel({
  renderState = baseRenderState,
  input = baseInput,
  onInteractionStart = vi.fn(),
  onRenderModeChange = vi.fn(),
  onMaximize = vi.fn(),
  onHide = vi.fn(),
}: {
  renderState?: CanvasChartRenderState;
  input?: SpectraChartDataInput | null;
  onInteractionStart?: () => void;
  onRenderModeChange?: (mode: RenderMode) => void;
  onMaximize?: () => void;
  onHide?: () => void;
} = {}) {
  return render(
    <MainCanvasSpectraPanel
      renderState={renderState}
      input={input}
      sampleCount={2}
      selectedCount={1}
      pinnedCount={1}
      colorConfig={DEFAULT_GLOBAL_COLOR_CONFIG}
      colorContext={colorContext}
      onInteractionStart={onInteractionStart}
      operators={[]}
      renderMode="canvas"
      displayRenderMode="auto"
      onRenderModeChange={onRenderModeChange}
      outlierIndices={new Set([1])}
      referenceDataset={dataSection}
      referenceLabel="Reference"
      configResult={{} as UseSpectraChartConfigResult}
      showAbsoluteDifference
      onMaximize={onMaximize}
      onMinimize={() => undefined}
      onRestore={() => undefined}
      onHide={onHide}
    />
  );
}

describe('MainCanvasSpectraPanel', () => {
  it('renders nothing when render state disables the spectra chart', async () => {
    const { container, root } = await renderPanel({
      renderState: { ...baseRenderState, shouldRender: false },
    });

    expect(container.textContent).toBe('');

    await act(async () => {
      root.unmount();
    });
  });

  it('renders spectra content and forwards panel/chart actions', async () => {
    const onInteractionStart = vi.fn();
    const onRenderModeChange = vi.fn();
    const onMaximize = vi.fn();
    const onHide = vi.fn();
    const { container, root } = await renderPanel({
      renderState: { ...baseRenderState, isLoading: true },
      onInteractionStart,
      onRenderModeChange,
      onMaximize,
      onHide,
    });

    const panel = container.querySelector('section');
    expect(panel?.dataset.chartType).toBe('spectra');
    expect(panel?.dataset.sampleCount).toBe('2');
    expect(panel?.dataset.selectedCount).toBe('1');
    expect(panel?.dataset.pinnedCount).toBe('1');

    const chart = container.querySelector('[data-testid="spectra"]');
    expect(chart?.textContent).toContain('1,2|a,b');
    expect(chart?.getAttribute('data-loading')).toBe('true');
    expect(chart?.getAttribute('data-render-mode')).toBe('canvas');
    expect(chart?.getAttribute('data-display-render-mode')).toBe('auto');
    expect(chart?.getAttribute('data-outlier-count')).toBe('1');
    expect(chart?.getAttribute('data-reference-label')).toBe('Reference');
    expect(chart?.getAttribute('data-absolute')).toBe('true');

    const buttons = Array.from(container.querySelectorAll('button'));
    await act(async () => {
      buttons[0].click();
      buttons[1].click();
      buttons[2].click();
      buttons[3].click();
    });

    expect(onMaximize).toHaveBeenCalledTimes(1);
    expect(onHide).toHaveBeenCalledTimes(1);
    expect(onInteractionStart).toHaveBeenCalledTimes(1);
    expect(onRenderModeChange).toHaveBeenCalledWith('webgl');

    await act(async () => {
      root.unmount();
    });
  });

  it('renders the spectra skeleton from render state', async () => {
    const { container, root } = await renderPanel({
      renderState: { ...baseRenderState, showSkeleton: true },
    });

    expect(container.querySelector('[data-testid="skeleton"]')?.textContent).toBe('spectra');

    await act(async () => {
      root.unmount();
    });
  });

  it('renders the spectra skeleton when chart input is unavailable', async () => {
    const { container, root } = await renderPanel({ input: null });

    expect(container.querySelector('[data-testid="skeleton"]')?.textContent).toBe('spectra');

    await act(async () => {
      root.unmount();
    });
  });
});
