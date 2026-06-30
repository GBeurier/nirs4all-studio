/**
 * @vitest-environment jsdom
 */

import type { ReactNode } from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MainCanvasDimensionReductionPanel } from '../MainCanvasDimensionReductionPanel';
import { DEFAULT_GLOBAL_COLOR_CONFIG, type ColorContext } from '@/lib/playground/colorConfig';
import type { CanvasChartRenderState } from '@/lib/playground/canvasLayout';
import type { DimensionReductionChartDataInput } from '@/lib/playground/chartInputs';

vi.mock('../ChartPanel', () => ({
  ChartPanel: ({
    children,
    chartType,
    isLoading,
    sampleCount,
    selectedCount,
    onMaximize,
    onHide,
  }: {
    children: ReactNode;
    chartType: string;
    isLoading?: boolean;
    sampleCount?: number;
    selectedCount?: number;
    onMaximize?: () => void;
    onHide?: () => void;
  }) => (
    <section
      data-chart-type={chartType}
      data-loading={String(isLoading)}
      data-sample-count={sampleCount}
      data-selected-count={selectedCount}
    >
      <button type="button" onClick={onMaximize}>max</button>
      <button type="button" onClick={onHide}>hide</button>
      {children}
    </section>
  ),
}));

vi.mock('../visualizations', () => ({
  ChartSkeleton: ({ type }: { type?: string }) => <div data-testid="skeleton">{type}</div>,
  DimensionReductionChart: ({
    y,
    sampleIds,
    isUMAPLoading,
    onRequestUMAP,
  }: {
    y: number[];
    sampleIds?: string[];
    isUMAPLoading?: boolean;
    onRequestUMAP?: () => void;
  }) => (
    <div data-testid="dimension-reduction" data-umap-loading={String(isUMAPLoading)}>
      <span>{`${y.join(',')}|${sampleIds?.join(',') ?? ''}`}</span>
      <button type="button" onClick={onRequestUMAP}>umap</button>
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

const baseInput = {
  pca: {
    coordinates: [[1, 2], [3, 4]],
    explained_variance: [0.7, 0.2],
  },
  y: [1, 2],
  folds: null,
  sampleIds: ['a', 'b'],
} as unknown as DimensionReductionChartDataInput;

const colorContext: ColorContext = {
  y: [1, 2],
  totalSamples: 2,
};

function renderPanel({
  renderState = baseRenderState,
  input = baseInput,
  stale = false,
  onRequestUMAP = vi.fn(),
  onMaximize = vi.fn(),
  onHide = vi.fn(),
}: {
  renderState?: CanvasChartRenderState;
  input?: DimensionReductionChartDataInput | null;
  stale?: boolean;
  onRequestUMAP?: () => void;
  onMaximize?: () => void;
  onHide?: () => void;
} = {}) {
  return render(
    <MainCanvasDimensionReductionPanel
      renderState={renderState}
      input={input}
      stale={stale}
      sampleCount={2}
      selectedCount={1}
      isUmapLoading
      colorConfig={DEFAULT_GLOBAL_COLOR_CONFIG}
      colorContext={colorContext}
      onRequestUMAP={onRequestUMAP}
      onMaximize={onMaximize}
      onMinimize={() => undefined}
      onRestore={() => undefined}
      onHide={onHide}
    />
  );
}

describe('MainCanvasDimensionReductionPanel', () => {
  it('renders nothing when render state disables the PCA chart', async () => {
    const { container, root } = await renderPanel({
      renderState: { ...baseRenderState, shouldRender: false },
    });

    expect(container.textContent).toBe('');

    await act(async () => {
      root.unmount();
    });
  });

  it('renders dimension reduction content and forwards panel/chart actions', async () => {
    const onRequestUMAP = vi.fn();
    const onMaximize = vi.fn();
    const onHide = vi.fn();
    const { container, root } = await renderPanel({
      stale: true,
      onRequestUMAP,
      onMaximize,
      onHide,
    });

    const panel = container.querySelector('section');
    expect(panel?.dataset.chartType).toBe('pca');
    expect(panel?.dataset.sampleCount).toBe('2');
    expect(panel?.dataset.selectedCount).toBe('1');
    expect(container.querySelector('[data-testid="dimension-reduction"]')?.textContent).toContain('1,2|a,b');
    expect(container.querySelector('[data-testid="dimension-reduction"]')?.getAttribute('data-umap-loading')).toBe('true');
    expect(container.querySelector('.opacity-70')).toBeTruthy();

    const buttons = Array.from(container.querySelectorAll('button'));
    await act(async () => {
      buttons[0].click();
      buttons[1].click();
      buttons[2].click();
    });

    expect(onMaximize).toHaveBeenCalledTimes(1);
    expect(onHide).toHaveBeenCalledTimes(1);
    expect(onRequestUMAP).toHaveBeenCalledTimes(1);

    await act(async () => {
      root.unmount();
    });
  });

  it('renders the PCA skeleton from render state', async () => {
    const { container, root } = await renderPanel({
      renderState: { ...baseRenderState, showSkeleton: true },
    });

    expect(container.querySelector('[data-testid="skeleton"]')?.textContent).toBe('pca');

    await act(async () => {
      root.unmount();
    });
  });

  it('renders the PCA skeleton when chart input is unavailable', async () => {
    const { container, root } = await renderPanel({ input: null });

    expect(container.querySelector('[data-testid="skeleton"]')?.textContent).toBe('pca');

    await act(async () => {
      root.unmount();
    });
  });
});
