/**
 * @vitest-environment jsdom
 */

import type { ReactNode } from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FoldDistributionCountChart } from '../FoldDistributionCountChart';
import type { PartitionBarData } from '@/lib/playground/foldDistributionData';
import type { FoldsInfo } from '@/types/playground';

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
    BarChart: ({ children, data, margin, layout, onMouseDown, onMouseMove, onMouseUp }: MockProps) => (
      <div
        data-testid="bar-chart"
        data-count={Array.isArray(data) ? data.length : 0}
        data-margin={serialize(margin)}
        data-layout={String(layout)}
      >
        <button
          type="button"
          data-testid="mouse-down"
          onClick={() => (onMouseDown as ((state: unknown) => void) | undefined)?.({ activeTooltipIndex: 1 })}
        />
        <button
          type="button"
          data-testid="mouse-move"
          onClick={() => (onMouseMove as ((state: unknown) => void) | undefined)?.({ activeTooltipIndex: 1 })}
        />
        <button
          type="button"
          data-testid="mouse-up"
          onClick={() => (onMouseUp as ((state: unknown) => void) | undefined)?.({ activeTooltipIndex: 1 })}
        />
        {children}
      </div>
    ),
    CartesianGrid: (props: MockProps) => (
      <div data-testid="cartesian-grid" data-stroke={String(props.stroke)} data-horizontal={String(props.horizontal)} />
    ),
    XAxis: (props: MockProps) => (
      <div data-testid="x-axis" data-domain={serialize(props.domain)} data-data-key={String(props.dataKey)} />
    ),
    YAxis: (props: MockProps) => (
      <div data-testid="y-axis" data-width={String(props.width)} data-stroke={String(props.stroke)} />
    ),
    Tooltip: ({ content }: MockProps) => (
      <div data-testid="tooltip">
        {typeof content === 'function' ? content({ payload: [{}], label: 'Train 1' }) : content as ReactNode}
      </div>
    ),
    Bar: ({ children, dataKey, name, stackId, cursor }: MockProps) => (
      <div
        data-testid="bar"
        data-data-key={String(dataKey)}
        data-name={String(name)}
        data-stack-id={String(stackId)}
        data-cursor={String(cursor)}
      >
        {children}
      </div>
    ),
    Cell: (props: MockProps) => (
      <span
        data-testid="cell"
        data-fill={String(props.fill)}
        data-stroke={String(props.stroke)}
        data-stroke-width={String(props.strokeWidth)}
      />
    ),
  };
});

vi.mock('../FoldDistributionTooltip', () => ({
  FoldDistributionTooltip: ({ label, entry }: { label: ReactNode; entry: PartitionBarData }) => (
    <div data-testid="fold-tooltip" data-entry-id={entry.partitionId}>
      {label}
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

const partitionBarData: PartitionBarData[] = [
  {
    index: 0,
    label: 'Train 1',
    partitionId: 'train-0',
    partitionType: 'train',
    foldIndex: 0,
    count: 2,
    indices: [0, 1],
    yMean: 1,
    yStd: 0.5,
    segments: { total: 2 },
    segmentIndices: { total: [0, 1] },
  },
  {
    index: 1,
    label: 'Val 1',
    partitionId: 'val-0',
    partitionType: 'val',
    foldIndex: 0,
    count: 1,
    indices: [2],
    yMean: 3,
    yStd: 0,
    segments: { total: 1 },
    segmentIndices: { total: [2] },
  },
];

const folds: FoldsInfo = {
  splitter_name: 'kfold',
  n_folds: 1,
  folds: [{
    fold_index: 0,
    train_count: 2,
    test_count: 1,
    train_indices: [0, 1],
    test_indices: [2],
  }],
};

afterEach(() => {
  vi.clearAllMocks();
  for (const container of mountedContainers) {
    container.remove();
  }
  mountedContainers = [];
});

describe('FoldDistributionCountChart', () => {
  it('renders partition bars, tooltip content, drag overlay, labels, and mouse handlers', async () => {
    const getPartitionBarColor = vi.fn((entry: PartitionBarData) => `partition-${entry.partitionId}`);
    const getPartitionSegmentColor = vi.fn(() => 'segment-color');
    const getSegmentLabel = vi.fn((segmentKey: string) => `label-${segmentKey}`);
    const onMouseDown = vi.fn();
    const onMouseMove = vi.fn();
    const onMouseUp = vi.fn();

    const { container, root } = await render(
      <FoldDistributionCountChart
        partitionBarData={partitionBarData}
        partitionSegmentKeys={['total']}
        selectedSamples={new Set([1])}
        clickedPartitionId="train-0"
        rangeOverlayBounds={{ left: '10%', right: '20%' }}
        folds={folds}
        effectiveColorMode="partition"
        getPartitionBarColor={getPartitionBarColor}
        getPartitionSegmentColor={getPartitionSegmentColor}
        getSegmentLabel={getSegmentLabel}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
      />
    );

    expect(container.querySelector('[data-testid="bar-chart"]')?.getAttribute('data-count')).toBe('2');
    expect(container.querySelector('[data-testid="x-axis"]')?.getAttribute('data-domain')).toBe('[-0.5,1.5]');
    expect(container.querySelector('[data-testid="bar"]')?.getAttribute('data-data-key')).toBe('segments.total');
    expect(container.querySelector('[data-testid="fold-tooltip"]')?.getAttribute('data-entry-id')).toBe('train-0');

    const cells = Array.from(container.querySelectorAll('[data-testid="cell"]'));
    expect(cells).toHaveLength(2);
    expect(cells[0].getAttribute('data-fill')).toBe('partition-train-0');
    expect(cells[0].getAttribute('data-stroke')).toBe('hsl(var(--foreground))');
    expect(cells[0].getAttribute('data-stroke-width')).toBe('2.5');
    expect(cells[1].getAttribute('data-fill')).toBe('partition-val-0');
    expect(cells[1].getAttribute('data-stroke')).toBe('none');

    const overlay = container.querySelector('.absolute.pointer-events-none') as HTMLDivElement;
    expect(overlay.style.left).toBe('10%');
    expect(overlay.style.right).toBe('20%');
    expect(container.textContent).toContain('Train 1');
    expect(container.textContent).toContain('Val 1');

    await act(async () => {
      (container.querySelector('[data-testid="mouse-down"]') as HTMLButtonElement).click();
      (container.querySelector('[data-testid="mouse-move"]') as HTMLButtonElement).click();
      (container.querySelector('[data-testid="mouse-up"]') as HTMLButtonElement).click();
    });

    expect(onMouseDown).toHaveBeenCalledWith({ activeTooltipIndex: 1 });
    expect(onMouseMove).toHaveBeenCalledWith({ activeTooltipIndex: 1 });
    expect(onMouseUp).toHaveBeenCalledWith({ activeTooltipIndex: 1 });

    await act(async () => {
      root.unmount();
    });
  });

  it('uses segment colors outside partition color mode', async () => {
    const { container, root } = await render(
      <FoldDistributionCountChart
        partitionBarData={partitionBarData}
        partitionSegmentKeys={['total']}
        selectedSamples={new Set()}
        clickedPartitionId={null}
        rangeOverlayBounds={null}
        folds={folds}
        effectiveColorMode="selection"
        getPartitionBarColor={() => 'partition-color'}
        getPartitionSegmentColor={(segmentKey, entry) => `${segmentKey}-${entry.partitionId}`}
        getSegmentLabel={segmentKey => segmentKey}
        onMouseDown={vi.fn()}
        onMouseMove={vi.fn()}
        onMouseUp={vi.fn()}
      />
    );

    const cells = Array.from(container.querySelectorAll('[data-testid="cell"]'));
    expect(cells[0].getAttribute('data-fill')).toBe('total-train-0');
    expect(cells[1].getAttribute('data-fill')).toBe('total-val-0');

    await act(async () => {
      root.unmount();
    });
  });
});
