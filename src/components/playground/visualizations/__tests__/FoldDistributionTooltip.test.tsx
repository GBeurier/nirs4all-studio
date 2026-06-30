/**
 * @vitest-environment jsdom
 */

import type { ReactNode } from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FoldDistributionTooltip } from '../FoldDistributionTooltip';
import type { PartitionBarData } from '@/lib/playground/foldDistributionData';
import type { FoldsInfo } from '@/types/playground';

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

const trainBar: PartitionBarData = {
  index: 0,
  label: 'Train 1',
  partitionId: 'train-0',
  partitionType: 'train',
  foldIndex: 0,
  count: 3,
  indices: [0, 1, 2],
  yMean: 2,
  yStd: 0.5,
  segments: { meta_0: 2, other: 1 },
  segmentIndices: { meta_0: [0, 1], other: [2] },
};

const valBar: PartitionBarData = {
  index: 1,
  label: 'Val 1',
  partitionId: 'val-0',
  partitionType: 'val',
  foldIndex: 0,
  count: 2,
  indices: [3, 4],
  segments: { meta_0: 1, other: 1 },
  segmentIndices: { meta_0: [3], other: [4] },
};

const folds: FoldsInfo = {
  splitter_name: 'KFold',
  n_folds: 2,
  folds: [{
    fold_index: 0,
    train_count: 3,
    test_count: 2,
    train_indices: [0, 1, 2],
    test_indices: [3, 4],
    y_train_stats: { mean: 2, std: 0.5, min: 1, max: 3 },
    y_test_stats: { mean: 4, std: 0.25, min: 3.5, max: 4.5 },
  }],
};

afterEach(() => {
  for (const container of mountedContainers) {
    container.remove();
  }
  mountedContainers = [];
});

describe('FoldDistributionTooltip', () => {
  it('renders partition details, Y stats, and visible segment breakdown', async () => {
    const getPartitionSegmentColor = vi.fn(() => 'hsl(10, 60%, 50%)');
    const getSegmentLabel = vi.fn((segmentKey: string) => segmentKey === 'meta_0' ? 'Batch A' : 'Other');

    const { container, root } = await render(
      <FoldDistributionTooltip
        label="Train 1"
        entry={trainBar}
        partitionBars={[trainBar, valBar]}
        folds={folds}
        effectiveColorMode="metadata"
        partitionSegmentKeys={['meta_0', 'other']}
        getPartitionBarColor={() => 'hsl(120, 60%, 45%)'}
        getPartitionSegmentColor={getPartitionSegmentColor}
        getSegmentLabel={getSegmentLabel}
      />
    );

    expect(container.textContent).toContain('Train 1');
    expect(container.textContent).toContain('Type:Training');
    expect(container.textContent).toContain('Fold:1 of 2');
    expect(container.textContent).toContain('Samples:3 (60.0%)');
    expect(container.textContent).toContain('Y Statistics');
    expect(container.textContent).toContain('Mean:2.00');
    expect(container.textContent).toContain('Std:0.50');
    expect(container.textContent).toContain('Range:[1.00, 3.00]');
    expect(container.textContent).toContain('Distribution');
    expect(container.textContent).toContain('Batch A:2 (67%)');
    expect(container.textContent).toContain('Other:1 (33%)');
    expect(getPartitionSegmentColor).toHaveBeenCalledWith('meta_0', trainBar);

    await act(async () => {
      root.unmount();
    });
  });

  it('suppresses segment distribution for partition color mode', async () => {
    const { container, root } = await render(
      <FoldDistributionTooltip
        label="Train 1"
        entry={trainBar}
        partitionBars={[trainBar, valBar]}
        folds={folds}
        effectiveColorMode="partition"
        partitionSegmentKeys={['meta_0', 'other']}
        getPartitionBarColor={() => 'hsl(120, 60%, 45%)'}
        getPartitionSegmentColor={() => 'hsl(10, 60%, 50%)'}
        getSegmentLabel={(segmentKey) => segmentKey}
      />
    );

    expect(container.textContent).not.toContain('Distribution');

    await act(async () => {
      root.unmount();
    });
  });
});
