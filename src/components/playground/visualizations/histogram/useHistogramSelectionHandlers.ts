import { useCallback, useEffect, useRef, useState } from 'react';
import type { SelectionContextValue } from '@/context/useSelection';
import {
  computeSelectionAction,
  computeStackedBarAction,
  executeSelectionAction,
} from '@/lib/playground/selectionHandlers';
import { extractModifiers } from '@/lib/playground/selectionUtils';
import type { BinData, RangeSelection, RechartsMouseEvent } from './types';
import { RANGE_SELECTION_INITIAL } from './types';

interface UseHistogramSelectionHandlersInput {
  histogramData: BinData[];
  selectionCtx: SelectionContextValue | null;
}

export function useHistogramSelectionHandlers({
  histogramData,
  selectionCtx,
}: UseHistogramSelectionHandlersInput) {
  const [rangeSelection, setRangeSelection] = useState<RangeSelection>(RANGE_SELECTION_INITIAL);
  const lastMouseEventRef = useRef<MouseEvent | null>(null);

  useEffect(() => {
    const handleNativeMouseUp = (e: MouseEvent) => {
      lastMouseEventRef.current = e;
    };
    const handleNativeMouseDown = (e: MouseEvent) => {
      void e;
    };
    window.addEventListener('mouseup', handleNativeMouseUp, { capture: true });
    window.addEventListener('mousedown', handleNativeMouseDown, { capture: true });
    return () => {
      window.removeEventListener('mouseup', handleNativeMouseUp, { capture: true });
      window.removeEventListener('mousedown', handleNativeMouseDown, { capture: true });
    };
  }, []);

  const handleMouseDown = useCallback((e: RechartsMouseEvent) => {
    if (!e?.activeLabel) return;
    const yValue = typeof e.activeLabel === 'number' ? e.activeLabel : parseFloat(e.activeLabel as string);
    if (!isNaN(yValue)) {
      setRangeSelection({ start: yValue, end: yValue, isSelecting: true });
    }
  }, []);

  const handleMouseMove = useCallback((e: RechartsMouseEvent) => {
    if (!rangeSelection.isSelecting || !e?.activeLabel) return;
    const yValue = typeof e.activeLabel === 'number' ? e.activeLabel : parseFloat(e.activeLabel as string);
    if (!isNaN(yValue)) {
      setRangeSelection(prev => ({ ...prev, end: yValue }));
    }
  }, [rangeSelection.isSelecting]);

  const handleMouseLeave = useCallback(() => {
    if (rangeSelection.isSelecting) {
      setRangeSelection(RANGE_SELECTION_INITIAL);
    }
    if (selectionCtx) {
      selectionCtx.setHovered(null);
    }
  }, [rangeSelection.isSelecting, selectionCtx]);

  const handleBarSelection = useCallback((
    samples: number[],
    e: MouseEvent | null,
    ctx: SelectionContextValue | null
  ) => {
    if (!ctx || samples.length === 0) return;

    const modifiers = e ? extractModifiers(e) : { shift: false, ctrl: false };
    const action = computeSelectionAction(
      { indices: samples },
      ctx.selectedSamples,
      modifiers
    );
    executeSelectionAction(ctx, action);
  }, []);

  const handleStackedBarSelection = useCallback((
    barSamples: number[],
    segmentSamples: number[],
    e: MouseEvent | null,
    ctx: SelectionContextValue | null
  ) => {
    if (!ctx || barSamples.length === 0) return;

    const modifiers = e ? extractModifiers(e) : { shift: false, ctrl: false };
    const effectiveSegment = segmentSamples.length > 0 ? segmentSamples : barSamples;

    const action = computeStackedBarAction(
      { barIndices: barSamples, segmentIndices: effectiveSegment },
      ctx.selectedSamples,
      modifiers
    );
    executeSelectionAction(ctx, action);
  }, []);

  const handleDragSelection = useCallback((e: MouseEvent | null): boolean => {
    if (!rangeSelection.isSelecting || rangeSelection.start === null || rangeSelection.end === null) {
      return false;
    }

    const minY = Math.min(rangeSelection.start, rangeSelection.end);
    const maxY = Math.max(rangeSelection.start, rangeSelection.end);

    const binWidth = histogramData.length > 0
      ? histogramData[0].binEnd - histogramData[0].binStart
      : 0;

    const isDragSelection = Math.abs(maxY - minY) > binWidth * 0.3;

    if (isDragSelection) {
      const samplesInRange: number[] = [];
      histogramData.forEach(bin => {
        if (bin.binEnd >= minY && bin.binStart <= maxY) {
          samplesInRange.push(...bin.samples);
        }
      });

      handleBarSelection(samplesInRange, e, selectionCtx);
      setRangeSelection(RANGE_SELECTION_INITIAL);
      return true;
    }

    return false;
  }, [rangeSelection, histogramData, selectionCtx, handleBarSelection]);

  return {
    lastMouseEventRef,
    rangeSelection,
    setRangeSelection,
    handleMouseDown,
    handleMouseMove,
    handleMouseLeave,
    handleDragSelection,
    handleBarSelection,
    handleStackedBarSelection,
  };
}
