import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';

import type { SelectionContextValue } from '@/context/useSelection';
import type { PartitionBarData } from '@/lib/playground/foldDistributionData';
import {
  buildFoldDistributionStackedTarget,
  collectFoldDistributionRangeSamples,
  getFoldDistributionClickedPartitionId,
  getFoldDistributionRangeOverlayBounds,
  isFoldDistributionDrag,
  resolveFoldDistributionSegmentKey,
  type FoldDistributionRangeOverlayBounds,
} from '@/lib/playground/foldDistributionInteraction';
import {
  computeSelectionAction,
  computeStackedBarAction,
  executeSelectionAction,
} from '@/lib/playground/selectionHandlers';
import { extractModifiers } from '@/lib/playground/selectionUtils';

import type { FoldDistributionChartMouseState } from './FoldDistributionCountChart';

interface FoldDistributionRangeSelection {
  start: number | null;
  end: number | null;
  isSelecting: boolean;
}

interface UseFoldDistributionInteractionParams {
  selectionCtx: SelectionContextValue | null;
  selectedSamples: Set<number>;
  partitionBarData: PartitionBarData[];
  partitionSegmentKeys: string[];
  getPartitionSegmentColor: (segmentKey: string, entry: PartitionBarData) => string;
  onSelectFold: (foldIndex: number | null) => void;
}

interface UseFoldDistributionInteractionResult {
  clickedPartitionId: string | null;
  rangeOverlayBounds: FoldDistributionRangeOverlayBounds | null;
  handleChartBackgroundClick: (event: ReactMouseEvent<HTMLDivElement>) => void;
  handleChartMouseDown: (state: FoldDistributionChartMouseState) => void;
  handleChartMouseMove: (state: FoldDistributionChartMouseState) => void;
  handleChartMouseUp: (state: FoldDistributionChartMouseState) => void;
}

const EMPTY_RANGE_SELECTION: FoldDistributionRangeSelection = {
  start: null,
  end: null,
  isSelecting: false,
};

function getClickedBarFill(event: MouseEvent | null): string {
  const target = event?.target as SVGElement | null;
  if (!event || !target || typeof document === 'undefined') {
    return '';
  }

  const barRect = document.elementsFromPoint(event.clientX, event.clientY).find(element =>
    element.classList.contains('recharts-rectangle') &&
    !element.classList.contains('recharts-reference-area-rect')
  );

  return barRect?.getAttribute('fill') ?? '';
}

export function useFoldDistributionInteraction({
  selectionCtx,
  selectedSamples,
  partitionBarData,
  partitionSegmentKeys,
  getPartitionSegmentColor,
  onSelectFold,
}: UseFoldDistributionInteractionParams): UseFoldDistributionInteractionResult {
  const [clickedPartitionId, setClickedPartitionId] = useState<string | null>(null);
  const [rangeSelection, setRangeSelection] = useState<FoldDistributionRangeSelection>(EMPTY_RANGE_SELECTION);

  const lastMouseEventRef = useRef<MouseEvent | null>(null);
  const mouseDownEventRef = useRef<MouseEvent | null>(null);
  const justCompletedDragRef = useRef<boolean>(false);

  useEffect(() => {
    const handleNativeMouseUp = (event: MouseEvent) => {
      lastMouseEventRef.current = event;
    };
    const handleNativeMouseDown = (event: MouseEvent) => {
      mouseDownEventRef.current = event;
    };

    window.addEventListener('mouseup', handleNativeMouseUp, { capture: true });
    window.addEventListener('mousedown', handleNativeMouseDown, { capture: true });
    return () => {
      window.removeEventListener('mouseup', handleNativeMouseUp, { capture: true });
      window.removeEventListener('mousedown', handleNativeMouseDown, { capture: true });
    };
  }, []);

  useEffect(() => {
    if (!clickedPartitionId || partitionBarData.length === 0) {
      return;
    }

    const clickedPartition = partitionBarData.find(partition => partition.partitionId === clickedPartitionId);
    if (!clickedPartition) {
      return;
    }

    const selectionMatchesClickedPartition =
      selectedSamples.size === clickedPartition.indices.length &&
      clickedPartition.indices.every(index => selectedSamples.has(index));

    if (!selectionMatchesClickedPartition) {
      setClickedPartitionId(null);
    }
  }, [clickedPartitionId, partitionBarData, selectedSamples]);

  const handleChartBackgroundClick = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    if (justCompletedDragRef.current) {
      return;
    }

    const target = event.target as HTMLElement;
    if (target.tagName === 'svg' || target.classList.contains('recharts-surface')) {
      if (selectionCtx && selectionCtx.selectedSamples.size > 0) {
        selectionCtx.clear();
      }
      setClickedPartitionId(null);
      onSelectFold(null);
    }
  }, [onSelectFold, selectionCtx]);

  const isDrag = useCallback((event: MouseEvent | null): boolean => {
    return isFoldDistributionDrag(event, mouseDownEventRef.current);
  }, []);

  const handleBarSelection = useCallback((
    samples: number[],
    event: MouseEvent | null,
    ctx: SelectionContextValue | null,
  ) => {
    if (!ctx || samples.length === 0) return;

    const modifiers = event ? extractModifiers(event) : { shift: false, ctrl: false };
    const action = computeSelectionAction(
      { indices: samples },
      ctx.selectedSamples,
      modifiers,
    );
    executeSelectionAction(ctx, action);
  }, []);

  const handleDragSelection = useCallback((event: MouseEvent | null): boolean => {
    if (!event || !rangeSelection.isSelecting) return false;
    if (!isDrag(event)) return false;

    const { start, end } = rangeSelection;
    if (start === null || end === null) {
      setRangeSelection(EMPTY_RANGE_SELECTION);
      return false;
    }

    const samplesInRange = collectFoldDistributionRangeSamples(partitionBarData, start, end);
    handleBarSelection(samplesInRange, event, selectionCtx);
    setClickedPartitionId(null);

    justCompletedDragRef.current = true;
    setTimeout(() => {
      justCompletedDragRef.current = false;
    }, 100);

    setRangeSelection(EMPTY_RANGE_SELECTION);
    return true;
  }, [handleBarSelection, isDrag, partitionBarData, rangeSelection, selectionCtx]);

  const handleChartMouseDown = useCallback((state: FoldDistributionChartMouseState) => {
    if (state?.activeTooltipIndex !== undefined && state.activeTooltipIndex >= 0) {
      setRangeSelection({
        start: state.activeTooltipIndex,
        end: state.activeTooltipIndex,
        isSelecting: true,
      });
    }
  }, []);

  const handleChartMouseMove = useCallback((state: FoldDistributionChartMouseState) => {
    const activeTooltipIndex = state?.activeTooltipIndex;
    if (rangeSelection.isSelecting && activeTooltipIndex !== undefined && activeTooltipIndex >= 0) {
      setRangeSelection(prev => ({ ...prev, end: activeTooltipIndex }));
    }
  }, [rangeSelection.isSelecting]);

  const handleChartMouseUp = useCallback((state: FoldDistributionChartMouseState) => {
    const event = lastMouseEventRef.current;

    if (handleDragSelection(event)) {
      return;
    }
    setRangeSelection(EMPTY_RANGE_SELECTION);

    const activeIndex = state?.activeTooltipIndex;
    if (activeIndex === undefined || activeIndex < 0 || activeIndex >= partitionBarData.length) {
      if (selectionCtx && selectionCtx.selectedSamples.size > 0) {
        selectionCtx.clear();
      }
      setClickedPartitionId(null);
      return;
    }

    const entry = partitionBarData[activeIndex];
    if (!entry || !selectionCtx) return;

    const clickedSegmentKey = resolveFoldDistributionSegmentKey(
      partitionSegmentKeys,
      entry,
      getClickedBarFill(event),
      getPartitionSegmentColor,
    );
    const stackedTarget = buildFoldDistributionStackedTarget(entry, clickedSegmentKey);
    const modifiers = event ? extractModifiers(event) : { shift: false, ctrl: false };
    const action = computeStackedBarAction(
      stackedTarget,
      selectionCtx.selectedSamples,
      modifiers,
    );
    executeSelectionAction(selectionCtx, action);

    setClickedPartitionId(getFoldDistributionClickedPartitionId(action, modifiers, entry.partitionId));
  }, [getPartitionSegmentColor, handleDragSelection, partitionBarData, partitionSegmentKeys, selectionCtx]);

  const rangeOverlayBounds = useMemo(() => {
    if (!rangeSelection.isSelecting || rangeSelection.start === null || rangeSelection.end === null) {
      return null;
    }

    return getFoldDistributionRangeOverlayBounds(
      rangeSelection.start,
      rangeSelection.end,
      partitionBarData.length,
    );
  }, [partitionBarData.length, rangeSelection]);

  return {
    clickedPartitionId,
    rangeOverlayBounds,
    handleChartBackgroundClick,
    handleChartMouseDown,
    handleChartMouseMove,
    handleChartMouseUp,
  };
}
