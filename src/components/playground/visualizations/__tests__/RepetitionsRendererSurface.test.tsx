/**
 * @vitest-environment jsdom
 */

import type { ReactNode } from 'react';
import { createRef } from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RepetitionsRendererSurface } from '../RepetitionsRendererSurface';
import type { RepetitionsPlotDataPoint } from '@/lib/playground/repetitionsChartData';

vi.mock('@/components/playground/SelectionTools', () => ({
  SelectionContainer: ({
    children,
    mode,
    onSelectionComplete,
    onBackgroundClick,
    enabled,
    className,
  }: {
    children: ReactNode;
    mode: string;
    onSelectionComplete: (result: unknown, modifiers: { shift: boolean; ctrl: boolean }) => void;
    onBackgroundClick: (modifiers: { shift: boolean; ctrl: boolean }) => void;
    enabled: boolean;
    className: string;
  }) => (
    <section
      data-testid="selection-container"
      data-mode={mode}
      data-enabled={String(enabled)}
      data-class-name={className}
    >
      <button
        type="button"
        data-testid="complete-selection"
        onClick={() => onSelectionComplete({
          start: { x: 0, y: 0 },
          end: { x: 10, y: 10 },
          bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
        }, { shift: false, ctrl: false })}
      />
      <button
        type="button"
        data-testid="background-click"
        onClick={() => onBackgroundClick({ shift: false, ctrl: false })}
      />
      {children}
    </section>
  ),
}));

vi.mock('../ChartLoadingOverlay', () => ({
  ChartLoadingOverlay: ({ label }: { label: string }) => <div data-testid="loading-overlay">{label}</div>,
}));

vi.mock('../WebglIndicatorBadge', () => ({
  WebglIndicatorBadge: ({ position }: { position: string }) => <div data-testid="webgl-badge">{position}</div>,
}));

vi.mock('../RepetitionsWebglOverlays', () => ({
  RepetitionsWebglOverlays: ({ bioSampleCount }: { bioSampleCount: number }) => (
    <div data-testid="webgl-overlays">{bioSampleCount}</div>
  ),
}));

vi.mock('../RepetitionsRechartsPlot', () => ({
  RepetitionsRechartsPlot: ({
    plotData,
    onPointClick,
  }: {
    plotData: RepetitionsPlotDataPoint[];
    onPointClick: (point: RepetitionsPlotDataPoint, event: unknown) => void;
  }) => (
    <button
      type="button"
      data-testid="recharts-plot"
      data-count={plotData.length}
      onClick={event => onPointClick(plotData[0], event)}
    />
  ),
}));

vi.mock('../RepetitionsWebglPlot', () => ({
  RepetitionsWebglPlot: ({
    clearOnBackgroundClick,
    useSelectionContext,
  }: {
    clearOnBackgroundClick: boolean;
    useSelectionContext: boolean;
  }) => (
    <div
      data-testid="webgl-plot"
      data-clear-background={String(clearOnBackgroundClick)}
      data-use-selection={String(useSelectionContext)}
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

const plotData: RepetitionsPlotDataPoint[] = [
  {
    x: 0,
    groupIndex: 0,
    groupSize: 1,
    y: 1,
    bioSample: 'sample-a',
    repIndex: 0,
    sampleIndex: 10,
    sampleId: 'a-1',
    isOutlier: false,
    isSelected: false,
  },
];

const defaultProps = {
  chartRef: createRef<HTMLDivElement>(),
  selectionTool: 'click' as const,
  selectionEnabled: true,
  useSelectionContext: true,
  isPanning: false,
  isComputing: false,
  onRechartsSelectionComplete: vi.fn(),
  onWebglSelectionComplete: vi.fn(),
  onBackgroundClick: vi.fn(),
  onPanMouseDown: vi.fn(),
  onPanMouseMove: vi.fn(),
  onPanMouseUp: vi.fn(),
  onPanMouseLeave: vi.fn(),
  onDoubleClick: vi.fn(),
  onContextMenu: vi.fn(),
  webglBounds: { minX: -0.5, maxX: 0.5, minY: 0, maxY: 2 },
  scaleType: 'linear' as const,
  xTicks: [0],
  bioSampleCount: 1,
  showGrid: true,
  enableHover: true,
  quantileValues: [],
  formatXAxisTick: String,
  plotData,
  effectiveXDomain: [-0.5, 0.5] as [number, number],
  yDomain: [0, 2] as [number, number],
  getPointColor: vi.fn(() => 'red'),
  onPointClick: vi.fn(),
  webglData: {
    points: [[0, 1]] as [number, number][],
    indices: [10],
    colors: ['red'],
    values: [1],
  },
  clearWebglOnBackgroundClick: true,
};

afterEach(() => {
  vi.clearAllMocks();
  for (const container of mountedContainers) {
    container.remove();
  }
  mountedContainers = [];
});

describe('RepetitionsRendererSurface', () => {
  it('renders the WebGL branch and routes selection to WebGL handlers', async () => {
    const { container, root } = await render(
      <RepetitionsRendererSurface
        {...defaultProps}
        chartRef={createRef<HTMLDivElement>()}
        rendererType="webgl"
        selectionTool="box"
        isPanning
        isComputing
      />
    );

    expect(container.querySelector('[data-testid="selection-container"]')?.getAttribute('data-mode')).toBe('box');
    expect(container.querySelector('[data-testid="loading-overlay"]')?.textContent).toBe('Computing distances...');
    expect(container.querySelector('[data-testid="webgl-badge"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="webgl-overlays"]')?.textContent).toBe('1');
    expect(container.querySelector('[data-testid="webgl-plot"]')?.getAttribute('data-clear-background')).toBe('true');
    expect(container.querySelector('[data-testid="recharts-plot"]')).toBeNull();

    await act(async () => {
      (container.querySelector('[data-testid="complete-selection"]') as HTMLButtonElement).click();
      (container.querySelector('[data-testid="background-click"]') as HTMLButtonElement).click();
    });

    expect(defaultProps.onWebglSelectionComplete).toHaveBeenCalledTimes(1);
    expect(defaultProps.onRechartsSelectionComplete).not.toHaveBeenCalled();
    expect(defaultProps.onBackgroundClick).toHaveBeenCalledWith({ shift: false, ctrl: false });

    const interactiveSurface = container.querySelector('.h-full.relative') as HTMLDivElement;
    expect(interactiveSurface.style.cursor).toBe('grabbing');

    await act(async () => {
      interactiveSurface.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      interactiveSurface.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
      interactiveSurface.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      interactiveSurface.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
      interactiveSurface.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      interactiveSurface.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
    });

    expect(defaultProps.onPanMouseDown).toHaveBeenCalledTimes(1);
    expect(defaultProps.onPanMouseMove).toHaveBeenCalledTimes(1);
    expect(defaultProps.onPanMouseUp).toHaveBeenCalledTimes(1);
    expect(defaultProps.onPanMouseLeave).toHaveBeenCalledTimes(1);
    expect(defaultProps.onDoubleClick).toHaveBeenCalledTimes(1);
    expect(defaultProps.onContextMenu).toHaveBeenCalledTimes(1);

    await act(async () => {
      root.unmount();
    });
  });

  it('renders the Recharts branch and routes selection and point clicks to Recharts handlers', async () => {
    const { container, root } = await render(
      <RepetitionsRendererSurface
        {...defaultProps}
        chartRef={createRef<HTMLDivElement>()}
        rendererType="recharts"
        selectionTool="lasso"
      />
    );

    expect(container.querySelector('[data-testid="webgl-badge"]')).toBeNull();
    expect(container.querySelector('[data-testid="webgl-overlays"]')).toBeNull();
    expect(container.querySelector('[data-testid="webgl-plot"]')).toBeNull();
    expect(container.querySelector('[data-testid="recharts-plot"]')?.getAttribute('data-count')).toBe('1');
    expect((container.querySelector('.h-full.relative') as HTMLDivElement).style.cursor).toBe('crosshair');

    await act(async () => {
      (container.querySelector('[data-testid="complete-selection"]') as HTMLButtonElement).click();
      (container.querySelector('[data-testid="recharts-plot"]') as HTMLButtonElement).click();
    });

    expect(defaultProps.onRechartsSelectionComplete).toHaveBeenCalledTimes(1);
    expect(defaultProps.onWebglSelectionComplete).not.toHaveBeenCalled();
    expect(defaultProps.onPointClick).toHaveBeenCalledWith(plotData[0], expect.any(Object));

    await act(async () => {
      root.unmount();
    });
  });
});
