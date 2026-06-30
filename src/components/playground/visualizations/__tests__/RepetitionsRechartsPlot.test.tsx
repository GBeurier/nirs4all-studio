/**
 * @vitest-environment jsdom
 */

import type { MouseEvent, ReactNode } from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RepetitionsRechartsPlot } from '../RepetitionsRechartsPlot';
import type { RepetitionsPlotDataPoint } from '@/lib/playground/repetitionsChartData';

vi.mock('recharts', () => {
  type MockProps = {
    children?: ReactNode;
    [key: string]: unknown;
  };

  const serialize = (value: unknown) => JSON.stringify(value);

  return {
    ResponsiveContainer: ({ children }: MockProps) => <div data-testid="responsive-container">{children}</div>,
    ScatterChart: ({ children, margin }: MockProps) => (
      <div data-testid="scatter-chart" data-margin={serialize(margin)}>{children}</div>
    ),
    CartesianGrid: (props: MockProps) => (
      <div data-testid="cartesian-grid" data-stroke={String(props.stroke)} data-opacity={String(props.opacity)} />
    ),
    XAxis: (props: MockProps) => (
      <div
        data-testid="x-axis"
        data-domain={serialize(props.domain)}
        data-ticks={serialize(props.ticks)}
      >
        {typeof props.tickFormatter === 'function' ? String(props.tickFormatter(0)) : null}
      </div>
    ),
    YAxis: (props: MockProps) => {
      const label = props.label as { value?: string } | undefined;
      return (
        <div data-testid="y-axis" data-domain={serialize(props.domain)}>
          {label?.value}
        </div>
      );
    },
    ZAxis: (props: MockProps) => <div data-testid="z-axis" data-range={serialize(props.range)} />,
    Tooltip: (props: MockProps) => (
      <div data-testid="tooltip" data-cursor={props.cursor === false ? 'off' : 'on'}>
        {props.content as ReactNode}
      </div>
    ),
    ReferenceLine: (props: MockProps) => {
      const label = props.label as { value?: string } | undefined;
      return (
        <div
          data-testid={`reference-line-${label?.value ?? 'unknown'}`}
          data-y={String(props.y)}
          data-stroke={String(props.stroke)}
        />
      );
    },
    Scatter: ({ children, data, onClick }: MockProps) => (
      <button
        type="button"
        data-testid="scatter"
        data-count={Array.isArray(data) ? data.length : 0}
        onClick={(event: MouseEvent<HTMLButtonElement>) => {
          const clickHandler = onClick as ((data: unknown, index: number, event: MouseEvent<HTMLButtonElement>) => void) | undefined;
          clickHandler?.(undefined, 1, event);
        }}
      >
        {children}
      </button>
    ),
    Cell: (props: MockProps) => (
      <span
        data-testid="cell"
        data-fill={String(props.fill)}
        data-stroke={String(props.stroke)}
        data-stroke-width={String(props.strokeWidth)}
        data-r={String(props.r)}
      />
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

const plotData: RepetitionsPlotDataPoint[] = [
  {
    x: 0,
    groupIndex: 0,
    groupSize: 2,
    y: 1,
    bioSample: 'sample-a',
    repIndex: 0,
    sampleIndex: 10,
    sampleId: 'a-1',
    isOutlier: false,
    isSelected: true,
  },
  {
    x: 1,
    groupIndex: 1,
    groupSize: 1,
    y: 4,
    bioSample: 'sample-b',
    repIndex: 0,
    sampleIndex: 20,
    sampleId: 'b-1',
    isOutlier: true,
    isSelected: false,
  },
];

afterEach(() => {
  for (const container of mountedContainers) {
    container.remove();
  }
  mountedContainers = [];
});

describe('RepetitionsRechartsPlot', () => {
  it('renders chart axes, quantile lines, point styles, and click wiring', async () => {
    const onPointClick = vi.fn();
    const { container, root } = await render(
      <RepetitionsRechartsPlot
        plotData={plotData}
        effectiveXDomain={[-0.5, 1.5]}
        xTicks={[0, 1]}
        yDomain={[0, 5]}
        scaleType="log"
        showGrid
        enableHover
        quantileValues={[{ quantile: 95, value: 3 }]}
        formatXAxisTick={value => `tick-${value}`}
        getPointColor={point => `color-${point.sampleIndex}`}
        onPointClick={onPointClick}
      />
    );

    expect(container.querySelector('[data-testid="cartesian-grid"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="x-axis"]')?.getAttribute('data-domain')).toBe('[-0.5,1.5]');
    expect(container.querySelector('[data-testid="x-axis"]')?.textContent).toBe('tick-0');
    expect(container.querySelector('[data-testid="y-axis"]')?.textContent).toBe('log(1 + Distance)');
    expect(container.querySelector('[data-testid="reference-line-P95"]')?.getAttribute('data-stroke')).toBe('hsl(0, 70%, 55%)');

    const cells = Array.from(container.querySelectorAll('[data-testid="cell"]'));
    expect(cells).toHaveLength(2);
    expect(cells[0].getAttribute('data-fill')).toBe('color-10');
    expect(cells[0].getAttribute('data-stroke')).toBe('hsl(var(--foreground))');
    expect(cells[0].getAttribute('data-r')).toBe('4');
    expect(cells[1].getAttribute('data-fill')).toBe('color-20');
    expect(cells[1].getAttribute('data-stroke')).toBe('hsl(var(--warning))');
    expect(cells[1].getAttribute('data-r')).toBe('3');

    await act(async () => {
      (container.querySelector('[data-testid="scatter"]') as HTMLButtonElement).click();
    });

    expect(onPointClick).toHaveBeenCalledWith(plotData[1], expect.any(Object));

    await act(async () => {
      root.unmount();
    });
  });

  it('hides optional renderer affordances when disabled', async () => {
    const { container, root } = await render(
      <RepetitionsRechartsPlot
        plotData={plotData}
        effectiveXDomain={[-0.5, 1.5]}
        xTicks={[0, 1]}
        yDomain={[0, 5]}
        scaleType="linear"
        showGrid={false}
        enableHover={false}
        quantileValues={[]}
        formatXAxisTick={String}
        getPointColor={() => 'color'}
        onPointClick={vi.fn()}
      />
    );

    expect(container.querySelector('[data-testid="cartesian-grid"]')).toBeNull();
    expect(container.querySelector('[data-testid="y-axis"]')?.textContent).toBe('Distance');
    expect(container.querySelector('[data-testid="tooltip"]')?.getAttribute('data-cursor')).toBe('off');
    expect(container.querySelector('[data-testid^="reference-line-"]')).toBeNull();

    await act(async () => {
      root.unmount();
    });
  });
});
