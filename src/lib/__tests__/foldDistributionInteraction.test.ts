import { describe, expect, it } from 'vitest';

import {
  buildFoldDistributionStackedTarget,
  collectFoldDistributionRangeSamples,
  getFoldDistributionClickedPartitionId,
  getFoldDistributionRangeOverlayBounds,
  getFoldDistributionSegmentSelectionState,
  isFoldDistributionDrag,
  resolveFoldDistributionSegmentKey,
} from '@/lib/playground/foldDistributionInteraction';
import type { PartitionBarData } from '@/lib/playground/foldDistributionData';
import type { SelectionActionResult } from '@/lib/playground/selectionHandlers';

const trainBar: PartitionBarData = {
  index: 0,
  label: 'Train 1',
  partitionId: 'train-0',
  partitionType: 'train',
  foldIndex: 0,
  count: 3,
  indices: [0, 1, 2],
  segments: { total: 3, selected: 1, unselected: 2 },
  segmentIndices: { total: [0, 1, 2], selected: [1], unselected: [0, 2] },
};

const valBar: PartitionBarData = {
  index: 1,
  label: 'Val 1',
  partitionId: 'val-0',
  partitionType: 'val',
  foldIndex: 0,
  count: 2,
  indices: [3, 4],
  segments: { total: 2, selected: 1, unselected: 1 },
  segmentIndices: { total: [3, 4], selected: [3], unselected: [4] },
};

const testBar: PartitionBarData = {
  index: 2,
  label: 'Test',
  partitionId: 'test-holdout',
  partitionType: 'test',
  foldIndex: null,
  count: 1,
  indices: [5],
  segments: { total: 1, selected: 0, unselected: 1 },
  segmentIndices: { total: [5], selected: [], unselected: [5] },
};

describe('foldDistributionInteraction', () => {
  it('detects drag movement using the same threshold as the chart', () => {
    expect(isFoldDistributionDrag({ clientX: 13, clientY: 10 }, { clientX: 10, clientY: 10 })).toBe(false);
    expect(isFoldDistributionDrag({ clientX: 16, clientY: 10 }, { clientX: 10, clientY: 10 })).toBe(true);
    expect(isFoldDistributionDrag(null, { clientX: 10, clientY: 10 })).toBe(false);
  });

  it('collects range samples in either direction and clamps to available bars', () => {
    const bars = [trainBar, valBar, testBar];

    expect(collectFoldDistributionRangeSamples(bars, 0, 1)).toEqual([0, 1, 2, 3, 4]);
    expect(collectFoldDistributionRangeSamples(bars, 2, 1)).toEqual([3, 4, 5]);
    expect(collectFoldDistributionRangeSamples(bars, -5, 9)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('computes drag overlay bounds as percentages', () => {
    expect(getFoldDistributionRangeOverlayBounds(2, 0, 4)).toEqual({
      left: '0%',
      right: '25%',
    });
    expect(getFoldDistributionRangeOverlayBounds(1, 1, 4)).toEqual({
      left: '25%',
      right: '50%',
    });
    expect(getFoldDistributionRangeOverlayBounds(0, 1, 0)).toBeNull();
  });

  it('resolves clicked segment keys from the rendered fill with stable fallbacks', () => {
    const colorResolver = (segmentKey: string) => segmentKey === 'selected' ? 'red' : 'gray';

    expect(resolveFoldDistributionSegmentKey(['unselected', 'selected'], trainBar, 'red', colorResolver)).toBe('selected');
    expect(resolveFoldDistributionSegmentKey(['unselected', 'selected'], trainBar, 'unknown', colorResolver)).toBe('unselected');
    expect(resolveFoldDistributionSegmentKey([], trainBar, 'unknown', colorResolver)).toBe('total');
  });

  it('builds stacked-bar targets and clicked partition visual state', () => {
    expect(buildFoldDistributionStackedTarget(trainBar, 'selected')).toEqual({
      barIndices: [0, 1, 2],
      segmentIndices: [1],
    });
    expect(buildFoldDistributionStackedTarget(trainBar, 'missing')).toEqual({
      barIndices: [0, 1, 2],
      segmentIndices: [0, 1, 2],
    });

    const selectAction: SelectionActionResult = { action: 'select', indices: [0, 1, 2], mode: 'replace' };
    const clearAction: SelectionActionResult = { action: 'clear' };

    expect(getFoldDistributionClickedPartitionId(selectAction, { shift: false, ctrl: false }, 'train-0')).toBe('train-0');
    expect(getFoldDistributionClickedPartitionId(selectAction, { shift: true, ctrl: false }, 'train-0')).toBeNull();
    expect(getFoldDistributionClickedPartitionId(clearAction, { shift: false, ctrl: false }, 'train-0')).toBeNull();
  });

  it('derives segment stroke state for local and external selections', () => {
    expect(getFoldDistributionSegmentSelectionState(trainBar, 'selected', new Set([1]), 'train-0')).toEqual({
      hasSelectedSamplesInSegment: true,
      showStroke: true,
    });
    expect(getFoldDistributionSegmentSelectionState(trainBar, 'selected', new Set([1]), null)).toEqual({
      hasSelectedSamplesInSegment: true,
      showStroke: true,
    });
    expect(getFoldDistributionSegmentSelectionState(trainBar, 'selected', new Set([1]), 'val-0')).toEqual({
      hasSelectedSamplesInSegment: true,
      showStroke: false,
    });
    expect(getFoldDistributionSegmentSelectionState(trainBar, 'unselected', new Set([1]), 'train-0')).toEqual({
      hasSelectedSamplesInSegment: false,
      showStroke: false,
    });
  });
});
