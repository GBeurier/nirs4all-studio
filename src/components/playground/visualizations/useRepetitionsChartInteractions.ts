import { useCallback, useEffect, useMemo, useState, type MouseEvent, type RefObject } from 'react';

import type { SelectionResult } from '@/components/playground/selectionGeometry';
import type { SelectionContextValue } from '@/context/useSelection';
import { exportDataAsCSV } from '@/lib/chartExport';
import {
  buildRepetitionExportRows,
  buildRepetitionsDataBounds,
  buildRepetitionsXAxisViewport,
  buildRepetitionsZoomInfo,
  panRepetitionsXDomain,
  type ComputedRepetitionDistances,
  type RepetitionsPlotDataPoint,
  type RepetitionsXAxisViewport,
  type RepetitionsZoomInfo,
  zoomRepetitionsXDomain,
} from '@/lib/playground/repetitionsChartData';
import {
  selectRepetitionsRechartsPoints,
  selectRepetitionsWebglPoints,
} from '@/lib/playground/repetitionsChartInteraction';
import {
  computeAreaSelectionAction,
  computeSelectionAction,
  executeSelectionAction,
} from '@/lib/playground/selectionHandlers';
import type { RepetitionResult } from '@/types/playground';
import type { DataBounds } from './scatter';

const INITIAL_VISIBLE_SAMPLES = 20;

interface UseRepetitionsChartInteractionsInput {
  chartRef: RefObject<HTMLDivElement | null>;
  repetitionData: RepetitionResult | null | undefined;
  computedDistances: ComputedRepetitionDistances | null;
  selectionCtx: SelectionContextValue | null;
  selectedSamples: Set<number>;
  plotData: RepetitionsPlotDataPoint[];
  bioSampleCount: number;
  yDomain: [number, number];
}

interface UseRepetitionsChartInteractionsResult {
  isPanning: boolean;
  webglBounds: DataBounds;
  zoomInfo: RepetitionsZoomInfo;
  effectiveXDomain: RepetitionsXAxisViewport['effectiveXDomain'];
  xTicks: number[];
  handlePointClick: (point: RepetitionsPlotDataPoint, event?: MouseEvent) => void;
  handleBackgroundClick: (modifiers: { shift: boolean; ctrl: boolean }) => void;
  handleSelectionComplete: (result: SelectionResult, modifiers: { shift: boolean; ctrl: boolean }) => void;
  handleSelectionCompleteWebGL: (result: SelectionResult, modifiers: { shift: boolean; ctrl: boolean }) => void;
  handleContextMenu: (event: MouseEvent<HTMLDivElement>) => void;
  handlePanMouseDown: (event: MouseEvent<HTMLDivElement>) => void;
  handlePanMouseMove: (event: MouseEvent<HTMLDivElement>) => void;
  handlePanMouseUp: () => void;
  handlePanMouseLeave: () => void;
  handleDoubleClick: () => void;
  handleExport: () => void;
}

export function useRepetitionsChartInteractions({
  chartRef,
  repetitionData,
  computedDistances,
  selectionCtx,
  selectedSamples,
  plotData,
  bioSampleCount,
  yDomain,
}: UseRepetitionsChartInteractionsInput): UseRepetitionsChartInteractionsResult {
  const [xDomain, setXDomain] = useState<[number, number] | null>(null);
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState<number | null>(null);
  const [initialZoomSet, setInitialZoomSet] = useState(false);

  const webglBounds = useMemo(
    (): DataBounds => buildRepetitionsDataBounds(xDomain, bioSampleCount, yDomain),
    [xDomain, bioSampleCount, yDomain]
  );

  const zoomInfo = useMemo(
    () => buildRepetitionsZoomInfo(xDomain, bioSampleCount),
    [xDomain, bioSampleCount]
  );

  const { effectiveXDomain, xTicks } = useMemo(
    () => buildRepetitionsXAxisViewport(xDomain, bioSampleCount),
    [xDomain, bioSampleCount]
  );

  const handlePointClick = useCallback((point: RepetitionsPlotDataPoint, event?: MouseEvent) => {
    if (!selectionCtx) return;
    if (selectionCtx.selectionToolMode !== 'click') return;

    if (event?.shiftKey) {
      const bioSamplePoints = plotData.filter(candidate => candidate.bioSample === point.bioSample);
      selectionCtx.select(bioSamplePoints.map(candidate => candidate.sampleIndex), 'add');
      return;
    }

    const action = computeSelectionAction(
      { indices: [point.sampleIndex] },
      selectedSamples,
      { shift: false, ctrl: event?.ctrlKey || event?.metaKey || false }
    );
    executeSelectionAction(selectionCtx, action);
  }, [selectionCtx, plotData, selectedSamples]);

  const handleBackgroundClick = useCallback((modifiers: { shift: boolean; ctrl: boolean }) => {
    if (!selectionCtx) return;
    if (!modifiers.shift && !modifiers.ctrl) {
      selectionCtx.clear();
    }
  }, [selectionCtx]);

  const handleSelectionComplete = useCallback((result: SelectionResult, modifiers: { shift: boolean; ctrl: boolean }) => {
    if (!selectionCtx || plotData.length === 0 || !chartRef.current) return;

    const selectedIndices = selectRepetitionsRechartsPoints(
      chartRef.current,
      plotData,
      result,
    );
    if (selectedIndices.length === 0) return;

    const action = computeAreaSelectionAction(
      { indices: selectedIndices },
      selectedSamples,
      modifiers
    );
    executeSelectionAction(selectionCtx, action);
  }, [selectionCtx, plotData, chartRef, selectedSamples]);

  const handleSelectionCompleteWebGL = useCallback((result: SelectionResult, modifiers: { shift: boolean; ctrl: boolean }) => {
    if (!selectionCtx || plotData.length === 0 || !chartRef.current) return;

    const selectedIndices = selectRepetitionsWebglPoints(
      plotData,
      result,
      chartRef.current.getBoundingClientRect(),
      webglBounds,
    );
    if (selectedIndices.length === 0) return;

    const action = computeAreaSelectionAction(
      { indices: selectedIndices },
      selectedSamples,
      modifiers
    );
    executeSelectionAction(selectionCtx, action);
  }, [selectionCtx, plotData, chartRef, webglBounds, selectedSamples]);

  const handleContextMenu = useCallback((event: MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
  }, []);

  const handleWheel = useCallback((event: WheelEvent) => {
    event.preventDefault();
    const nextDomain = zoomRepetitionsXDomain({
      xDomain,
      groupCount: bioSampleCount,
      deltaY: event.deltaY,
    });
    if (nextDomain) setXDomain(nextDomain);
  }, [xDomain, bioSampleCount]);

  useEffect(() => {
    const element = chartRef.current;
    if (!element) return;

    element.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      element.removeEventListener('wheel', handleWheel);
    };
  }, [chartRef, handleWheel]);

  const handlePanMouseDown = useCallback((event: MouseEvent<HTMLDivElement>) => {
    if (event.button === 2) {
      event.preventDefault();
      setIsPanning(true);
      setPanStart(event.clientX);
    }
  }, []);

  const handlePanMouseMove = useCallback((event: MouseEvent<HTMLDivElement>) => {
    if (!isPanning || panStart === null) return;

    const chartWidth = chartRef.current?.clientWidth ?? 800;
    const deltaX = event.clientX - panStart;
    const nextDomain = panRepetitionsXDomain({
      xDomain,
      groupCount: bioSampleCount,
      chartWidth,
      deltaX,
    });
    if (nextDomain) setXDomain(nextDomain);
    setPanStart(event.clientX);
  }, [isPanning, panStart, chartRef, xDomain, bioSampleCount]);

  const handlePanMouseUp = useCallback(() => {
    if (isPanning) {
      setIsPanning(false);
      setPanStart(null);
    }
  }, [isPanning]);

  const handlePanMouseLeave = useCallback(() => {
    if (isPanning) {
      setIsPanning(false);
      setPanStart(null);
    }
  }, [isPanning]);

  const handleDoubleClick = useCallback(() => {
    setXDomain(null);
  }, []);

  const handleExport = useCallback(() => {
    const exportData = buildRepetitionExportRows(repetitionData, computedDistances);
    if (exportData.length === 0) return;
    exportDataAsCSV(exportData.map(row => ({ ...row })), 'repetition_analysis');
  }, [repetitionData, computedDistances]);

  useEffect(() => {
    if (!initialZoomSet && bioSampleCount > 0) {
      if (bioSampleCount > INITIAL_VISIBLE_SAMPLES) {
        setXDomain([-0.5, INITIAL_VISIBLE_SAMPLES - 0.5]);
      }
      setInitialZoomSet(true);
    }
  }, [bioSampleCount, initialZoomSet]);

  return {
    isPanning,
    webglBounds,
    zoomInfo,
    effectiveXDomain,
    xTicks,
    handlePointClick,
    handleBackgroundClick,
    handleSelectionComplete,
    handleSelectionCompleteWebGL,
    handleContextMenu,
    handlePanMouseDown,
    handlePanMouseMove,
    handlePanMouseUp,
    handlePanMouseLeave,
    handleDoubleClick,
    handleExport,
  };
}
