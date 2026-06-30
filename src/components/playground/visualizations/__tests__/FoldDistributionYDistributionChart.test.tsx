/**
 * @vitest-environment jsdom
 */

import type { ReactNode } from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FoldDistributionYDistributionChart } from '../FoldDistributionYDistributionChart';
import type { FoldDistributionYStatsData } from '@/lib/playground/foldDistributionData';

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
    ComposedChart: ({ children, data, margin }: MockProps) => (
      <div data-testid="composed-chart" data-count={Array.isArray(data) ? data.length : 0} data-margin={serialize(margin)}>
        {children}
      </div>
    ),
    CartesianGrid: (props: MockProps) => (
      <div data-testid="cartesian-grid" data-stroke={String(props.stroke)} data-opacity={String(props.opacity)} />
    ),
    XAxis: (props: MockProps) => (
      <div data-testid="x-axis" data-data-key={String(props.dataKey)} data-stroke={String(props.stroke)} />
    ),
    YAxis: (props: MockProps) => {
      const label = props.label as { value?: string } | undefined;
      return (
        <div data-testid="y-axis" data-width={String(props.width)}>
          {label?.value}
        </div>
      );
    },
    ReferenceLine: (props: MockProps) => {
      const label = props.label as { value?: string } | undefined;
      return (
        <div data-testid="reference-line" data-y={String(props.y)} data-label={label?.value} />
      );
    },
    Tooltip: ({ content }: MockProps) => (
      <div data-testid="tooltip">
        {typeof content === 'function' ? content({ payload: [{}], label: 'Fold 1' }) : content as ReactNode}
      </div>
    ),
    Legend: ({ formatter }: MockProps) => (
      <div data-testid="legend">
        {typeof formatter === 'function' ? (
          <>
            <span data-testid="legend-train">{formatter('trainMean')}</span>
            <span data-testid="legend-test">{formatter('testMean')}</span>
          </>
        ) : null}
      </div>
    ),
    Bar: ({ children, dataKey, fill, barSize }: MockProps) => (
      <div data-testid="bar" data-data-key={String(dataKey)} data-fill={String(fill)} data-bar-size={String(barSize)}>
        {children}
      </div>
    ),
    Cell: (props: MockProps) => (
      <span
        data-testid="cell"
        data-fill={String(props.fill)}
        data-opacity={String(props.opacity)}
      />
    ),
    ErrorBar: (props: MockProps) => (
      <span data-testid="error-bar" data-data-key={String(props.dataKey)} data-stroke={String(props.stroke)} />
    ),
  };
});

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

const yData: FoldDistributionYStatsData[] = [
  {
    fold: 'Fold 1',
    foldIndex: 0,
    trainMean: 2,
    trainStd: 0.5,
    trainMin: 1,
    trainMax: 3,
    testMean: 4,
    testStd: 1,
    testMin: 3,
    testMax: 5,
    trainLower: 0.5,
    trainUpper: 0.5,
    testLower: 1,
    testUpper: 1,
  },
  {
    fold: 'Fold 2',
    foldIndex: 1,
    trainMean: 3,
    trainStd: 0.25,
    trainMin: 2,
    trainMax: 4,
    testMean: 6,
    testStd: 2,
    testMin: 4,
    testMax: 8,
    trainLower: 0.25,
    trainUpper: 0.25,
    testLower: 2,
    testUpper: 2,
  },
];

afterEach(() => {
  for (const container of mountedContainers) {
    container.remove();
  }
  mountedContainers = [];
});

describe('FoldDistributionYDistributionChart', () => {
  it('renders mean line, legend, tooltip, bars, error bars, and selected-fold opacity', async () => {
    const { container, root } = await render(
      <FoldDistributionYDistributionChart
        yData={yData}
        showMeanLine
        showLegend
        globalYMean={3.5}
        selectedFold={1}
        trainColor="train-color"
        validationLabel="Val"
        validationColor="val-color"
      />
    );

    expect(container.querySelector('[data-testid="composed-chart"]')?.getAttribute('data-count')).toBe('2');
    expect(container.querySelector('[data-testid="y-axis"]')?.textContent).toBe('Y Value');
    expect(container.querySelector('[data-testid="reference-line"]')?.getAttribute('data-y')).toBe('3.5');
    expect(container.querySelector('[data-testid="reference-line"]')?.getAttribute('data-label')).toContain('3.50');
    expect(container.querySelector('[data-testid="legend-train"]')?.textContent).toBe('Train');
    expect(container.querySelector('[data-testid="legend-test"]')?.textContent).toBe('Val');
    expect(container.querySelector('[data-testid="tooltip"]')?.textContent).toContain('Mean: 2.00');
    expect(container.querySelector('[data-testid="tooltip"]')?.textContent).toContain('Range: [3.00, 5.00]');

    const bars = Array.from(container.querySelectorAll('[data-testid="bar"]'));
    expect(bars.map(bar => bar.getAttribute('data-data-key'))).toEqual(['trainMean', 'testMean']);
    expect(bars[0].getAttribute('data-fill')).toBe('train-color');
    expect(bars[1].getAttribute('data-fill')).toBe('val-color');

    const cells = Array.from(container.querySelectorAll('[data-testid="cell"]'));
    expect(cells.map(cell => cell.getAttribute('data-opacity'))).toEqual(['0.4', '1', '0.4', '1']);
    expect(cells.map(cell => cell.getAttribute('data-fill'))).toEqual([
      'train-color',
      'train-color',
      'val-color',
      'val-color',
    ]);

    const errorBars = Array.from(container.querySelectorAll('[data-testid="error-bar"]'));
    expect(errorBars.map(errorBar => errorBar.getAttribute('data-data-key'))).toEqual(['trainUpper', 'testUpper']);

    await act(async () => {
      root.unmount();
    });
  });

  it('renders the empty state when no Y statistics are available', async () => {
    const { container, root } = await render(
      <FoldDistributionYDistributionChart
        yData={[]}
        showMeanLine={false}
        showLegend={false}
        globalYMean={null}
        selectedFold={null}
        trainColor="train-color"
        validationLabel="Val"
        validationColor="val-color"
      />
    );

    expect(container.textContent).toContain('No Y statistics available');
    expect(container.querySelector('[data-testid="composed-chart"]')).toBeNull();

    await act(async () => {
      root.unmount();
    });
  });
});
