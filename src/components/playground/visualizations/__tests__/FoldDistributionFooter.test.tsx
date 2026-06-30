/**
 * @vitest-environment jsdom
 */

import type { ReactNode } from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  FoldDistributionFooter,
  type FoldDistributionLegendPartition,
} from '../FoldDistributionFooter';

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

const partitions: FoldDistributionLegendPartition[] = [
  { partitionType: 'train', foldIndex: 0 },
  { partitionType: 'val', foldIndex: 0 },
  { partitionType: 'test', foldIndex: null },
];

function renderFooter(
  overrides: Partial<React.ComponentProps<typeof FoldDistributionFooter<FoldDistributionLegendPartition>>> = {}
) {
  return render(
    <FoldDistributionFooter
      compact={false}
      showLegend
      showYLegend={false}
      effectiveColorMode="partition"
      partitionBars={partitions}
      partitionSegmentKeys={[]}
      trainColor="hsl(120, 60%, 45%)"
      valColor="hsl(210, 70%, 50%)"
      heldOutTestColor="hsl(280, 65%, 55%)"
      selectedFold={1}
      selectedCount={4}
      isClassificationMode={false}
      classLabels={[]}
      hasYValues
      getPartitionSegmentColor={() => 'hsl(10, 60%, 50%)'}
      getSegmentLabel={(segmentKey) => segmentKey}
      {...overrides}
    />
  );
}

afterEach(() => {
  for (const container of mountedContainers) {
    container.remove();
  }
  mountedContainers = [];
});

describe('FoldDistributionFooter', () => {
  it('renders partition legend and selection summaries', async () => {
    const { container, root } = await renderFooter();

    expect(container.textContent).toContain('Train');
    expect(container.textContent).toContain('Val');
    expect(container.textContent).toContain('Test');
    expect(container.textContent).toContain('Fold 2 selected');
    expect(container.textContent).toContain('4 selected');

    await act(async () => {
      root.unmount();
    });
  });

  it('renders fold and dynamic segment legends', async () => {
    const getPartitionSegmentColor = vi.fn(() => 'hsl(10, 60%, 50%)');
    const getSegmentLabel = vi.fn((segmentKey: string) => `Label ${segmentKey}`);

    const { container, root } = await renderFooter({
      effectiveColorMode: 'metadata',
      partitionSegmentKeys: ['batch_a', 'batch_b'],
      getPartitionSegmentColor,
      getSegmentLabel,
    });

    expect(container.textContent).toContain('Label batch_a');
    expect(container.textContent).toContain('Label batch_b');
    expect(getPartitionSegmentColor).toHaveBeenCalledWith('batch_a', partitions[0]);

    await act(async () => {
      root.render(
        <FoldDistributionFooter
          compact={false}
          showLegend
          showYLegend={false}
          effectiveColorMode="fold"
          partitionBars={partitions}
          partitionSegmentKeys={[]}
          trainColor="hsl(120, 60%, 45%)"
          valColor="hsl(210, 70%, 50%)"
          heldOutTestColor="hsl(280, 65%, 55%)"
          selectedFold={null}
          selectedCount={0}
          isClassificationMode={false}
          classLabels={[]}
          hasYValues
          getPartitionSegmentColor={() => 'hsl(10, 60%, 50%)'}
          getSegmentLabel={(segmentKey) => segmentKey}
        />
      );
    });

    expect(container.textContent).toContain('Fold 1');
    expect(container.textContent).toContain('Test');

    await act(async () => {
      root.unmount();
    });
  });

  it('renders target legends and suppresses compact output', async () => {
    const { container, root } = await renderFooter({
      showYLegend: true,
      effectiveColorMode: 'target',
      isClassificationMode: true,
      classLabels: ['A', 'B'],
    });

    expect(container.textContent).toContain('Class:');
    expect(container.textContent).toContain('A');
    expect(container.textContent).toContain('B');

    await act(async () => {
      root.render(
        <FoldDistributionFooter
          compact={false}
          showLegend={false}
          showYLegend
          effectiveColorMode="target"
          partitionBars={partitions}
          partitionSegmentKeys={[]}
          trainColor="hsl(120, 60%, 45%)"
          valColor="hsl(210, 70%, 50%)"
          heldOutTestColor="hsl(280, 65%, 55%)"
          selectedFold={null}
          selectedCount={0}
          isClassificationMode={false}
          classLabels={[]}
          hasYValues
          getPartitionSegmentColor={() => 'hsl(10, 60%, 50%)'}
          getSegmentLabel={(segmentKey) => segmentKey}
        />
      );
    });

    expect(container.textContent).toContain('Y Value:');
    expect(container.textContent).toContain('Low');
    expect(container.textContent).toContain('High');

    await act(async () => {
      root.render(
        <FoldDistributionFooter
          compact
          showLegend
          showYLegend
          effectiveColorMode="target"
          partitionBars={partitions}
          partitionSegmentKeys={[]}
          trainColor="hsl(120, 60%, 45%)"
          valColor="hsl(210, 70%, 50%)"
          heldOutTestColor="hsl(280, 65%, 55%)"
          selectedFold={0}
          selectedCount={1}
          isClassificationMode={false}
          classLabels={[]}
          hasYValues
          getPartitionSegmentColor={() => 'hsl(10, 60%, 50%)'}
          getSegmentLabel={(segmentKey) => segmentKey}
        />
      );
    });

    expect(container.textContent).toBe('');

    await act(async () => {
      root.unmount();
    });
  });
});
