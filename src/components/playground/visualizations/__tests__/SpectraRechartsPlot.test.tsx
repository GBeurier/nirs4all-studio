/**
 * @vitest-environment jsdom
 */

import type { ReactNode } from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SpectraRechartsPlot } from '../SpectraRechartsPlot';

vi.mock('recharts', () => {
  type MockProps = {
    children?: ReactNode;
    [key: string]: unknown;
  };

  const serialize = (value: unknown) => JSON.stringify(value);

  return {
    ResponsiveContainer: ({ children, width, height }: MockProps) => (
      <div data-testid="responsive-container" data-width={String(width)} data-height={String(height)}>
        {children}
      </div>
    ),
    ComposedChart: ({ children, data, margin, onClick, onMouseDown, onMouseMove, onMouseLeave }: MockProps) => (
      <div
        data-testid="composed-chart"
        data-count={Array.isArray(data) ? data.length : 0}
        data-margin={serialize(margin)}
      >
        <button type="button" data-testid="chart-click" onClick={() => (onClick as (event: unknown) => void)?.({ activeLabel: 1 })} />
        <button type="button" data-testid="chart-mouse-down" onClick={() => (onMouseDown as (event: unknown) => void)?.({ activeLabel: 1 })} />
        <button type="button" data-testid="chart-mouse-move" onClick={() => (onMouseMove as (event: unknown) => void)?.({ activeLabel: 2 })} />
        <button type="button" data-testid="chart-mouse-leave" onClick={() => (onMouseLeave as () => void)?.()} />
        {children}
      </div>
    ),
    CartesianGrid: (props: MockProps) => (
      <div data-testid="cartesian-grid" data-stroke={String(props.stroke)} data-opacity={String(props.opacity)} />
    ),
    XAxis: (props: MockProps) => (
      <div data-testid="x-axis" data-data-key={String(props.dataKey)}>
        {typeof props.tickFormatter === 'function' ? String(props.tickFormatter(1000)) : null}
      </div>
    ),
    YAxis: (props: MockProps) => (
      <div data-testid="y-axis" data-width={String(props.width)}>
        {typeof props.tickFormatter === 'function' ? String(props.tickFormatter(1.2345)) : null}
      </div>
    ),
    Tooltip: ({ content, cursor }: MockProps) => (
      <div data-testid="tooltip" data-cursor={cursor === false ? 'off' : 'on'}>
        {typeof content === 'function' ? content({ active: true, payload: [{ value: 1 }] }) : content as ReactNode}
      </div>
    ),
  };
});

vi.mock('../SpectraAggregation', () => ({
  getAggregationElements: vi.fn((mode: string, keyPrefix: string, showOriginal: boolean) => (
    <div
      data-testid="aggregation-elements"
      data-mode={mode}
      data-prefix={keyPrefix}
      data-show-original={String(showOriginal)}
    />
  )),
}));

vi.mock('../SpectraGroupedAggregationSeries', () => ({
  SpectraGroupedAggregationSeries: ({
    groupKeys,
    aggregationMode,
    categoricalPalette,
  }: {
    groupKeys: Array<string | number>;
    aggregationMode: string;
    categoricalPalette?: string;
  }) => (
    <div
      data-testid="grouped-aggregation"
      data-groups={groupKeys.join(',')}
      data-mode={aggregationMode}
      data-palette={categoricalPalette}
    />
  ),
}));

vi.mock('../SpectraReferenceAreas', () => ({
  SpectraReferenceAreas: ({
    highDifferenceRegions,
    rangeSelectionBounds,
    rectSelectionBounds,
  }: {
    highDifferenceRegions: unknown[];
    rangeSelectionBounds: unknown;
    rectSelectionBounds: unknown;
  }) => (
    <div
      data-testid="reference-areas"
      data-region-count={highDifferenceRegions.length}
      data-has-range={String(Boolean(rangeSelectionBounds))}
      data-has-rect={String(Boolean(rectSelectionBounds))}
    />
  ),
}));

vi.mock('../SpectraSampleLineSeries', () => ({
  SpectraSampleLineSeries: ({
    displayIndices,
    showOriginal,
    showProcessed,
    showDifference,
    viewModeBoth,
    selectedSamples,
    pinnedSamples,
    hoveredSample,
    hasSelection,
    isSelectedOnlyMode,
    colorConfig,
    referenceLineCount,
  }: {
    displayIndices: number[];
    showOriginal: boolean;
    showProcessed: boolean;
    showDifference: boolean;
    viewModeBoth: boolean;
    selectedSamples: ReadonlySet<number>;
    pinnedSamples: ReadonlySet<number>;
    hoveredSample: number | null;
    hasSelection: boolean;
    isSelectedOnlyMode: boolean;
    colorConfig: { unselectedOpacity: number };
    referenceLineCount: number;
  }) => (
    <div
      data-testid="sample-lines"
      data-display-indices={displayIndices.join(',')}
      data-show-original={String(showOriginal)}
      data-show-processed={String(showProcessed)}
      data-show-difference={String(showDifference)}
      data-view-mode-both={String(viewModeBoth)}
      data-selected-count={selectedSamples.size}
      data-pinned-count={pinnedSamples.size}
      data-hovered={String(hoveredSample)}
      data-has-selection={String(hasSelection)}
      data-selected-only={String(isSelectedOnlyMode)}
      data-opacity={String(colorConfig.unselectedOpacity)}
      data-reference-count={String(referenceLineCount)}
    />
  ),
}));

vi.mock('../SpectraSampleTooltip', () => ({
  SpectraSampleTooltip: ({
    enableHover,
    active,
    hoveredSample,
    displayIndices,
    wavelengthAxisName,
    wavelengthUnitSuffix,
  }: {
    enableHover: boolean;
    active?: boolean;
    hoveredSample: number | null;
    displayIndices: number[];
    wavelengthAxisName: string;
    wavelengthUnitSuffix: string;
  }) => (
    <div
      data-testid="sample-tooltip"
      data-enable-hover={String(enableHover)}
      data-active={String(active)}
      data-hovered={String(hoveredSample)}
      data-display-indices={displayIndices.join(',')}
      data-axis-name={wavelengthAxisName}
      data-unit={wavelengthUnitSuffix}
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

const baseProps = {
  filteredData: [{ wavelength: 1000, p0: 1 }, { wavelength: 1002, p0: 2 }],
  highDifferenceRegions: [{ start: 1000, end: 1002 }],
  rangeSelectionBounds: { min: 1000, max: 1002 },
  rectSelectionBounds: { x1: 1000, x2: 1002, y1: 0, y2: 1 },
  showGroupedAggregation: true,
  groupKeys: ['a', 'b'],
  aggregationMode: 'mean_std' as const,
  categoricalPalette: 'default' as const,
  viewMode: 'both' as const,
  showOriginal: true,
  showProcessed: true,
  showDifference: false,
  viewModeBoth: true,
  displayIndices: [0, 2],
  selectedSamples: new Set([2]),
  pinnedSamples: new Set([0]),
  hoveredSample: 2,
  hasSelection: true,
  isSelectedOnlyMode: false,
  colorConfig: {
    selectionOverride: false,
    highlightPinned: true,
    selectionColor: undefined,
    unselectedOpacity: 0.3,
  },
  getBaseLineColor: vi.fn(() => ({ color: 'blue', terminal: false, isOriginalBoth: false })),
  referenceLineCount: 1,
  enableHover: true,
  sampleIds: ['s0', 's1', 's2'],
  targetValues: [1, 2, 3],
  foldLabels: [0, 1, 1],
  wavelengthAxisName: 'Wavelength',
  wavelengthUnitSuffix: ' nm',
  onClick: vi.fn(),
  onMouseDown: vi.fn(),
  onMouseMove: vi.fn(),
  onMouseLeave: vi.fn(),
};

afterEach(() => {
  vi.clearAllMocks();
  for (const container of mountedContainers) {
    container.remove();
  }
  mountedContainers = [];
});

describe('SpectraRechartsPlot', () => {
  it('renders Recharts axes, reference areas, grouped aggregation, sample lines, tooltip, and event wiring', async () => {
    const { container, root } = await render(
      <SpectraRechartsPlot {...baseProps} />
    );

    expect(container.querySelector('[data-testid="composed-chart"]')?.getAttribute('data-count')).toBe('2');
    expect(container.querySelector('[data-testid="x-axis"]')?.textContent).toContain('1000');
    expect(container.querySelector('[data-testid="y-axis"]')?.textContent).toBe('1.23');
    expect(container.querySelector('[data-testid="reference-areas"]')?.getAttribute('data-region-count')).toBe('1');
    expect(container.querySelector('[data-testid="reference-areas"]')?.getAttribute('data-has-range')).toBe('true');
    expect(container.querySelector('[data-testid="grouped-aggregation"]')?.getAttribute('data-groups')).toBe('a,b');
    expect(container.querySelector('[data-testid="aggregation-elements"]')).toBeNull();

    const sampleLines = container.querySelector('[data-testid="sample-lines"]');
    expect(sampleLines?.getAttribute('data-display-indices')).toBe('0,2');
    expect(sampleLines?.getAttribute('data-show-original')).toBe('true');
    expect(sampleLines?.getAttribute('data-show-processed')).toBe('true');
    expect(sampleLines?.getAttribute('data-selected-count')).toBe('1');
    expect(sampleLines?.getAttribute('data-reference-count')).toBe('1');

    const tooltip = container.querySelector('[data-testid="tooltip"]');
    expect(tooltip?.getAttribute('data-cursor')).toBe('on');
    expect(container.querySelector('[data-testid="sample-tooltip"]')?.getAttribute('data-axis-name')).toBe('Wavelength');

    await act(async () => {
      (container.querySelector('[data-testid="chart-click"]') as HTMLButtonElement).click();
      (container.querySelector('[data-testid="chart-mouse-down"]') as HTMLButtonElement).click();
      (container.querySelector('[data-testid="chart-mouse-move"]') as HTMLButtonElement).click();
      (container.querySelector('[data-testid="chart-mouse-leave"]') as HTMLButtonElement).click();
    });

    expect(baseProps.onClick).toHaveBeenCalledWith({ activeLabel: 1 });
    expect(baseProps.onMouseDown).toHaveBeenCalledWith({ activeLabel: 1 });
    expect(baseProps.onMouseMove).toHaveBeenCalledWith({ activeLabel: 2 });
    expect(baseProps.onMouseLeave).toHaveBeenCalledTimes(1);

    await act(async () => {
      root.unmount();
    });
  });

  it('renders global aggregation elements when grouped aggregation is disabled', async () => {
    const { container, root } = await render(
      <SpectraRechartsPlot
        {...baseProps}
        showGroupedAggregation={false}
        aggregationMode="median_quantiles"
        viewMode="processed"
        viewModeBoth={false}
        enableHover={false}
      />
    );

    expect(container.querySelector('[data-testid="grouped-aggregation"]')).toBeNull();
    expect(container.querySelector('[data-testid="aggregation-elements"]')?.getAttribute('data-mode')).toBe('median_quantiles');
    expect(container.querySelector('[data-testid="aggregation-elements"]')?.getAttribute('data-show-original')).toBe('false');
    expect(container.querySelector('[data-testid="tooltip"]')?.getAttribute('data-cursor')).toBe('off');

    await act(async () => {
      root.unmount();
    });
  });
});
