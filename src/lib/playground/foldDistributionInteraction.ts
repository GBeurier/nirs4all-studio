import type { ClickModifiers, SelectionActionResult, StackedBarTarget } from '@/lib/playground/selectionHandlers';
import type { PartitionBarData } from '@/lib/playground/foldDistributionData';

export interface FoldDistributionPointer {
  clientX: number;
  clientY: number;
}

export interface FoldDistributionRangeOverlayBounds {
  left: string;
  right: string;
}

export function isFoldDistributionDrag(
  endEvent: FoldDistributionPointer | null,
  startEvent: FoldDistributionPointer | null,
  thresholdPx = 5,
): boolean {
  if (!endEvent || !startEvent) return false;

  const dx = Math.abs(endEvent.clientX - startEvent.clientX);
  const dy = Math.abs(endEvent.clientY - startEvent.clientY);
  return dx > thresholdPx || dy > thresholdPx;
}

export function collectFoldDistributionRangeSamples(
  partitionBars: Pick<PartitionBarData, 'indices'>[],
  startIndex: number,
  endIndex: number,
): number[] {
  if (partitionBars.length === 0) return [];

  const minIndex = Math.max(0, Math.min(startIndex, endIndex));
  const maxIndex = Math.min(partitionBars.length - 1, Math.max(startIndex, endIndex));

  return partitionBars
    .slice(minIndex, maxIndex + 1)
    .flatMap(entry => entry.indices);
}

export function getFoldDistributionRangeOverlayBounds(
  startIndex: number,
  endIndex: number,
  totalBars: number,
): FoldDistributionRangeOverlayBounds | null {
  if (totalBars <= 0) return null;

  const minIndex = Math.max(0, Math.min(startIndex, endIndex));
  const maxIndex = Math.min(totalBars - 1, Math.max(startIndex, endIndex));

  return {
    left: `${(minIndex / totalBars) * 100}%`,
    right: `${((totalBars - 1 - maxIndex) / totalBars) * 100}%`,
  };
}

export function resolveFoldDistributionSegmentKey(
  segmentKeys: string[],
  entry: PartitionBarData,
  clickedFill: string,
  getPartitionSegmentColor: (segmentKey: string, entry: PartitionBarData) => string,
): string {
  return segmentKeys.find(segmentKey => getPartitionSegmentColor(segmentKey, entry) === clickedFill)
    ?? segmentKeys[0]
    ?? 'total';
}

export function buildFoldDistributionStackedTarget(
  entry: Pick<PartitionBarData, 'indices' | 'segmentIndices'>,
  segmentKey: string,
): StackedBarTarget {
  const barIndices = entry.indices;
  return {
    barIndices,
    segmentIndices: entry.segmentIndices[segmentKey] ?? barIndices,
  };
}

export function getFoldDistributionClickedPartitionId(
  action: SelectionActionResult,
  modifiers: ClickModifiers,
  partitionId: string,
): string | null {
  if (action.action === 'clear') {
    return null;
  }
  if (modifiers.shift || modifiers.ctrl) {
    return null;
  }
  return partitionId;
}

export function getFoldDistributionSegmentSelectionState(
  entry: Pick<PartitionBarData, 'partitionId' | 'segmentIndices'>,
  segmentKey: string,
  selectedSamples: Set<number>,
  clickedPartitionId: string | null,
): { hasSelectedSamplesInSegment: boolean; showStroke: boolean } {
  const segmentSamples = entry.segmentIndices[segmentKey] ?? [];
  const hasSelectedSamplesInSegment = selectedSamples.size > 0 && segmentSamples.some(sampleIndex => selectedSamples.has(sampleIndex));
  const isThisPartitionClicked = clickedPartitionId === entry.partitionId;
  const selectionFromOtherChart = selectedSamples.size > 0 && clickedPartitionId === null;

  return {
    hasSelectedSamplesInSegment,
    showStroke: hasSelectedSamplesInSegment && (isThisPartitionClicked || selectionFromOtherChart),
  };
}
