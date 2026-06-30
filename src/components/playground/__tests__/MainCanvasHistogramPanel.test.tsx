/**
 * @vitest-environment jsdom
 */

import type { ReactNode } from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MainCanvasHistogramPanel } from '../MainCanvasHistogramPanel';
import { DEFAULT_GLOBAL_COLOR_CONFIG, type ColorContext } from '@/lib/playground/colorConfig';
import type { CanvasChartRenderState } from '@/lib/playground/canvasLayout';
import type { HistogramChartDataInput } from '@/lib/playground/chartInputs';

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
  YHistogram: ({ y }: { y: number[] }) => <div data-testid="histogram">{y.join(',')}</div>,
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

const baseInput: HistogramChartDataInput = {
  y: [1, 2, 3],
  folds: null,
  hasYValues: true,
};

const colorContext: ColorContext = {
  y: [1, 2, 3],
  totalSamples: 3,
};

function renderPanel({
  renderState = baseRenderState,
  input = baseInput,
  stale = false,
  onMaximize = vi.fn(),
  onHide = vi.fn(),
}: {
  renderState?: CanvasChartRenderState;
  input?: HistogramChartDataInput;
  stale?: boolean;
  onMaximize?: () => void;
  onHide?: () => void;
} = {}) {
  return render(
    <MainCanvasHistogramPanel
      renderState={renderState}
      input={input}
      stale={stale}
      sampleCount={2}
      selectedCount={1}
      colorConfig={DEFAULT_GLOBAL_COLOR_CONFIG}
      colorContext={colorContext}
      onMaximize={onMaximize}
      onMinimize={() => undefined}
      onRestore={() => undefined}
      onHide={onHide}
    />
  );
}

describe('MainCanvasHistogramPanel', () => {
  it('renders nothing when render state disables the histogram', async () => {
    const { container, root } = await renderPanel({
      renderState: { ...baseRenderState, shouldRender: false },
    });

    expect(container.textContent).toBe('');

    await act(async () => {
      root.unmount();
    });
  });

  it('renders the histogram inside the chart panel and forwards panel actions', async () => {
    const onMaximize = vi.fn();
    const onHide = vi.fn();
    const { container, root } = await renderPanel({ stale: true, onMaximize, onHide });

    const panel = container.querySelector('section');
    expect(panel?.dataset.chartType).toBe('histogram');
    expect(panel?.dataset.sampleCount).toBe('2');
    expect(panel?.dataset.selectedCount).toBe('1');
    expect(container.querySelector('[data-testid="histogram"]')?.textContent).toBe('1,2,3');
    expect(container.querySelector('.opacity-70')).toBeTruthy();

    const buttons = Array.from(container.querySelectorAll('button'));
    await act(async () => {
      buttons[0].click();
      buttons[1].click();
    });

    expect(onMaximize).toHaveBeenCalledTimes(1);
    expect(onHide).toHaveBeenCalledTimes(1);

    await act(async () => {
      root.unmount();
    });
  });

  it('renders skeleton and no-target states from histogram render inputs', async () => {
    const skeleton = await renderPanel({
      renderState: { ...baseRenderState, showSkeleton: true },
    });
    expect(skeleton.container.querySelector('[data-testid="skeleton"]')?.textContent).toBe('histogram');
    await act(async () => {
      skeleton.root.unmount();
    });

    const empty = await renderPanel({
      input: { ...baseInput, y: [], hasYValues: false },
    });
    expect(empty.container.textContent).toContain('No Y values available');
    await act(async () => {
      empty.root.unmount();
    });
  });
});
