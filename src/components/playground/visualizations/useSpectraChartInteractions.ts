import {
  useCallback,
  useMemo,
  useState,
  type Dispatch,
  type MouseEvent,
  type RefObject,
  type SetStateAction,
  type WheelEvent,
} from 'react';

import type { SelectionContextValue } from '@/context/useSelection';
import {
  chartYToSpectraValue,
  getSpectraRangeBounds,
  getSpectraRectBounds,
  selectSimilarSpectraSamples,
  selectSpectraRangeSamples,
  selectSpectraRectSamples,
  type SimilarSpectraCriterion,
  type SpectraRangeBounds,
  type SpectraRectBounds,
  zoomSpectraBrushDomain,
} from '@/lib/playground/spectraChartData';
import type { FoldsInfo } from '@/types/playground';
import { CHART_MARGINS } from './chartConfig';
import { useAltKeyPressed } from './SpectraChartAltKey';
import { shouldClearOnBackgroundClick } from '@/lib/playground/selectionUtils';

type SpectraBrushDomain = [number, number] | null;

interface SpectraFocusedData {
  wavelengths: number[];
  spectra: number[][];
}

interface SpectraChartEvent {
  activeLabel?: number;
  activePayload?: Array<{ dataKey: string }>;
  chartY?: number;
}

interface SpectraRangeSelection {
  startWavelength: number | null;
  endWavelength: number | null;
  isSelecting: boolean;
}

interface SpectraRectSelection {
  startX: number | null;
  startY: number | null;
  endX: number | null;
  endY: number | null;
  isSelecting: boolean;
}

export interface UseSpectraChartInteractionsInput {
  chartAreaRef: RefObject<HTMLDivElement | null>;
  selectionCtx: SelectionContextValue | null;
  isWebGLMode: boolean;
  wavelengthRange: [number, number];
  brushDomain: SpectraBrushDomain;
  setBrushDomain: Dispatch<SetStateAction<SpectraBrushDomain>>;
  focusedData: SpectraFocusedData;
  displayIndices: number[];
  yAxisDomain: [number, number];
  enableHover: boolean;
  folds?: FoldsInfo | null;
  y?: number[];
  onInteractionStart?: () => void;
  onBrushSelect?: (indices: number[]) => void;
}

export interface UseSpectraChartInteractionsResult {
  rangeSelectionBounds: SpectraRangeBounds | null;
  rectSelectionBounds: SpectraRectBounds | null;
  handleBackgroundClick: (event: MouseEvent) => void;
  handleClick: (event: unknown, mouseEvent?: MouseEvent) => void;
  handleWheel: (event: WheelEvent<HTMLDivElement>) => void;
  handleDoubleClick: () => void;
  handleRangeMouseDown: (event: unknown) => void;
  handleRangeMouseMove: (event: unknown) => void;
  handleMouseLeave: () => void;
  handleChartMouseUp: (event: MouseEvent<HTMLDivElement>) => void;
  handleResetBrush: () => void;
  handleSelectSimilar: (sampleIdx: number, criterion: SimilarSpectraCriterion) => void;
}

const EMPTY_RANGE_SELECTION: SpectraRangeSelection = {
  startWavelength: null,
  endWavelength: null,
  isSelecting: false,
};

const EMPTY_RECT_SELECTION: SpectraRectSelection = {
  startX: null,
  startY: null,
  endX: null,
  endY: null,
  isSelecting: false,
};

export function useSpectraChartInteractions({
  chartAreaRef,
  selectionCtx,
  isWebGLMode,
  wavelengthRange,
  brushDomain,
  setBrushDomain,
  focusedData,
  displayIndices,
  yAxisDomain,
  enableHover,
  folds,
  y,
  onInteractionStart,
  onBrushSelect,
}: UseSpectraChartInteractionsInput): UseSpectraChartInteractionsResult {
  const [rangeSelection, setRangeSelection] = useState<SpectraRangeSelection>(EMPTY_RANGE_SELECTION);
  const [rectSelection, setRectSelection] = useState<SpectraRectSelection>(EMPTY_RECT_SELECTION);
  const isAltKeyPressed = useAltKeyPressed();

  const handleBackgroundClick = useCallback((event: MouseEvent) => {
    if (!selectionCtx) return;

    if (shouldClearOnBackgroundClick(event, selectionCtx.selectionToolMode)) {
      selectionCtx.clear();
    }
  }, [selectionCtx]);

  const handleClick = useCallback((event: unknown, mouseEvent?: MouseEvent) => {
    const chartEvent = event as { activePayload?: Array<{ dataKey: string }> };

    if (!chartEvent?.activePayload?.[0]?.dataKey) {
      if (mouseEvent) {
        handleBackgroundClick(mouseEvent);
      }
      return;
    }

    const key = chartEvent.activePayload[0].dataKey as string;
    const match = key.match(/[po](\d+)/);
    if (!match) {
      if (mouseEvent) {
        handleBackgroundClick(mouseEvent);
      }
      return;
    }

    if (mouseEvent) {
      handleBackgroundClick(mouseEvent);
    }
  }, [handleBackgroundClick]);

  const handleWheel = useCallback((event: WheelEvent<HTMLDivElement>) => {
    if (isWebGLMode) return;

    event.preventDefault();

    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const mouseXNorm = (event.clientX - rect.left) / rect.width;
    const nextDomain = zoomSpectraBrushDomain({
      wavelengthRange,
      brushDomain,
      mouseXNorm,
      deltaY: event.deltaY,
    });

    if (!nextDomain) {
      setBrushDomain(null);
      return;
    }

    onInteractionStart?.();
    setBrushDomain(nextDomain);
  }, [isWebGLMode, wavelengthRange, brushDomain, setBrushDomain, onInteractionStart]);

  const handleDoubleClick = useCallback(() => {
    if (!isWebGLMode && brushDomain) {
      onInteractionStart?.();
      setBrushDomain(null);
    }
  }, [isWebGLMode, brushDomain, setBrushDomain, onInteractionStart]);

  const getChartYValue = useCallback((chartY: number) => {
    const containerHeight = chartAreaRef.current?.clientHeight ?? 250;
    return chartYToSpectraValue({
      chartY,
      containerHeight,
      marginTop: CHART_MARGINS.spectra.top,
      marginBottom: CHART_MARGINS.spectra.bottom,
      yAxisDomain,
    });
  }, [chartAreaRef, yAxisDomain]);

  const handleRectMouseDown = useCallback((chartEvent: SpectraChartEvent) => {
    if (!chartEvent?.activeLabel || chartEvent?.chartY === undefined) return;

    const wavelength = chartEvent.activeLabel;
    if (isNaN(wavelength)) return;

    const yValue = getChartYValue(chartEvent.chartY);
    setRectSelection({
      startX: wavelength,
      startY: yValue,
      endX: wavelength,
      endY: yValue,
      isSelecting: true,
    });
  }, [getChartYValue]);

  const handleRectMouseMove = useCallback((chartEvent: SpectraChartEvent) => {
    if (!rectSelection.isSelecting) return;
    if (!chartEvent?.activeLabel || chartEvent?.chartY === undefined) return;

    const wavelength = chartEvent.activeLabel;
    if (isNaN(wavelength)) return;

    const yValue = getChartYValue(chartEvent.chartY);
    setRectSelection(prev => ({
      ...prev,
      endX: wavelength,
      endY: yValue,
    }));
  }, [rectSelection.isSelecting, getChartYValue]);

  const handleRangeMouseDown = useCallback((event: unknown) => {
    const chartEvent = event as SpectraChartEvent;
    if (!chartEvent?.activeLabel) return;

    const wavelength = chartEvent.activeLabel;
    if (isNaN(wavelength)) return;

    if (isAltKeyPressed && chartEvent.chartY !== undefined) {
      handleRectMouseDown(chartEvent);
      return;
    }

    setRangeSelection({
      startWavelength: wavelength,
      endWavelength: wavelength,
      isSelecting: true,
    });
  }, [isAltKeyPressed, handleRectMouseDown]);

  const handleRangeMouseMove = useCallback((event: unknown) => {
    const chartEvent = event as SpectraChartEvent;

    if (enableHover && selectionCtx && chartEvent?.activePayload?.[0]?.dataKey) {
      const key = chartEvent.activePayload[0].dataKey as string;
      const match = key.match(/[po](\d+)/);
      if (match) {
        const displayIdx = parseInt(match[1], 10);
        const sampleIdx = displayIndices[displayIdx];
        if (sampleIdx !== undefined && selectionCtx.hoveredSample !== sampleIdx) {
          selectionCtx.setHovered(sampleIdx);
        }
      }
    } else if (!enableHover && selectionCtx && selectionCtx.hoveredSample !== null) {
      selectionCtx.setHovered(null);
    }

    if (rectSelection.isSelecting && chartEvent?.activeLabel && chartEvent.chartY !== undefined) {
      handleRectMouseMove(chartEvent);
      return;
    }

    if (!rangeSelection.isSelecting) return;
    if (!chartEvent?.activeLabel) return;

    const wavelength = chartEvent.activeLabel;
    if (!isNaN(wavelength)) {
      setRangeSelection(prev => ({ ...prev, endWavelength: wavelength }));
    }
  }, [
    enableHover,
    selectionCtx,
    displayIndices,
    rectSelection.isSelecting,
    handleRectMouseMove,
    rangeSelection.isSelecting,
  ]);

  const handleMouseLeave = useCallback(() => {
    if (selectionCtx) {
      selectionCtx.setHovered(null);
    }
  }, [selectionCtx]);

  const handleRangeMouseUp = useCallback((event: MouseEvent) => {
    if (
      !rangeSelection.isSelecting ||
      rangeSelection.startWavelength === null ||
      rangeSelection.endWavelength === null
    ) {
      setRangeSelection(EMPTY_RANGE_SELECTION);
      return;
    }

    const samplesToSelect = selectSpectraRangeSamples({
      wavelengths: focusedData.wavelengths,
      spectra: focusedData.spectra,
      startWavelength: rangeSelection.startWavelength,
      endWavelength: rangeSelection.endWavelength,
    });

    if (samplesToSelect.length > 0) {
      if (selectionCtx) {
        if (event.shiftKey) {
          selectionCtx.select(samplesToSelect, 'add');
        } else if (event.ctrlKey || event.metaKey) {
          selectionCtx.toggle(samplesToSelect);
        } else {
          selectionCtx.select(samplesToSelect, 'replace');
        }
      }
      onBrushSelect?.(samplesToSelect);
    }

    setRangeSelection(EMPTY_RANGE_SELECTION);
  }, [rangeSelection, focusedData, selectionCtx, onBrushSelect]);

  const handleRectMouseUp = useCallback((event: MouseEvent) => {
    if (!rectSelection.isSelecting || !rectSelection.startX || !rectSelection.endX) {
      setRectSelection(EMPTY_RECT_SELECTION);
      return;
    }

    const bounds = getSpectraRectBounds(rectSelection);
    const selectedIndices = bounds
      ? selectSpectraRectSamples({
          wavelengths: focusedData.wavelengths,
          spectra: focusedData.spectra,
          bounds,
          yAxisDomain,
        })
      : [];

    if (selectedIndices.length > 0 && selectionCtx) {
      if (event.shiftKey) {
        selectionCtx.select(selectedIndices, 'add');
      } else if (event.ctrlKey || event.metaKey) {
        selectionCtx.toggle(selectedIndices);
      } else {
        selectionCtx.select(selectedIndices, 'replace');
      }
      onBrushSelect?.(selectedIndices);
    }

    setRectSelection(EMPTY_RECT_SELECTION);
  }, [rectSelection, focusedData, yAxisDomain, selectionCtx, onBrushSelect]);

  const handleChartMouseUp = useCallback((event: MouseEvent<HTMLDivElement>) => {
    if (rectSelection.isSelecting) {
      handleRectMouseUp(event);
    } else {
      handleRangeMouseUp(event);
    }
  }, [rectSelection.isSelecting, handleRectMouseUp, handleRangeMouseUp]);

  const handleResetBrush = useCallback(() => {
    setBrushDomain(null);
    onInteractionStart?.();
  }, [setBrushDomain, onInteractionStart]);

  const handleSelectSimilar = useCallback((sampleIdx: number, criterion: SimilarSpectraCriterion) => {
    if (!selectionCtx) return;

    const similarSamples = selectSimilarSpectraSamples({
      sampleIndex: sampleIdx,
      criterion,
      folds,
      yValues: y,
    });

    if (similarSamples.length > 0) {
      selectionCtx.select(similarSamples, 'replace');
    }
  }, [selectionCtx, folds, y]);

  const rangeSelectionBounds = useMemo(() => {
    return getSpectraRangeBounds(rangeSelection);
  }, [rangeSelection]);

  const rectSelectionBounds = useMemo(() => {
    return getSpectraRectBounds(rectSelection);
  }, [rectSelection]);

  return {
    rangeSelectionBounds,
    rectSelectionBounds,
    handleBackgroundClick,
    handleClick,
    handleWheel,
    handleDoubleClick,
    handleRangeMouseDown,
    handleRangeMouseMove,
    handleMouseLeave,
    handleChartMouseUp,
    handleResetBrush,
    handleSelectSimilar,
  };
}
