import { useMemo, useCallback, type MouseEvent } from 'react';
import { useInspectorSelection, useInspectorHover } from '@/context/useInspectorSelection';
import {
  buildPredVsObsCanvasPoints,
  buildPredVsObsCanvasReferenceLines,
  buildPredVsObsChainColorMap,
  buildPredVsObsDots,
  computePredVsObsMetrics,
  createPredVsObsTickFormatter,
  getPredVsObsSelectionMode,
  type PredVsObsDot,
} from '@/lib/inspector/predVsObsData';
import { buildPredVsObsCanvasAnnotations } from '@/lib/inspector/predictionDiagnosticsPresentation';
import type { ScatterResponse, InspectorGroup } from '@/types/inspector';
import { CanvasScatter, CANVAS_SCATTER_THRESHOLD, type CanvasScatterPoint } from './CanvasScatter';
import { PredVsObsCanvasTooltip } from './PredVsObsTooltip';
import { PredVsObsRechartsPlot } from './PredVsObsRechartsPlot';
import { PredictionDiagnosticsEmptyState, PredictionDiagnosticsLoadingState } from './PredictionDiagnosticsState';

interface PredVsObsChartProps {
  data: ScatterResponse | null | undefined;
  groups: InspectorGroup[];
  isLoading: boolean;
}

export function PredVsObsChart({ data, groups, isLoading }: PredVsObsChartProps) {
  const { select, selectedChains, hasSelection } = useInspectorSelection();
  const { hoveredChain, setHovered } = useInspectorHover();

  const chainColorMap = useMemo(() => buildPredVsObsChainColorMap(groups), [groups]);
  const { dots, minVal, maxVal } = useMemo(() => {
    return buildPredVsObsDots(data, chainColorMap);
  }, [data, chainColorMap]);
  const metrics = useMemo(() => computePredVsObsMetrics(dots), [dots]);
  const useCanvasRenderer = dots.length > CANVAS_SCATTER_THRESHOLD;
  const tickFormatter = useMemo(() => createPredVsObsTickFormatter(minVal, maxVal), [minVal, maxVal]);

  const canvasPoints = useMemo<CanvasScatterPoint[]>(() => {
    if (!useCanvasRenderer) return [];
    return buildPredVsObsCanvasPoints({
      dots,
      hasSelection,
      selectedChains,
      hoveredChain,
    });
  }, [dots, useCanvasRenderer, hasSelection, selectedChains, hoveredChain]);

  const canvasRefLines = useMemo(() => buildPredVsObsCanvasReferenceLines(), []);
  const canvasAnnotations = useMemo(() => {
    return buildPredVsObsCanvasAnnotations(metrics, dots.length);
  }, [metrics, dots.length]);

  const handleCanvasPointClick = useCallback((point: CanvasScatterPoint, event: MouseEvent) => {
    select([point.chainId], getPredVsObsSelectionMode(event));
  }, [select]);

  const handleCanvasPointHover = useCallback((point: CanvasScatterPoint | null) => {
    setHovered(point?.chainId ?? null);
  }, [setHovered]);

  const renderCanvasTooltip = useCallback((point: CanvasScatterPoint) => (
    <PredVsObsCanvasTooltip point={point} />
  ), []);

  const handleDotClick = useCallback((dot: PredVsObsDot) => {
    select([dot.chainId], 'toggle');
  }, [select]);

  if (isLoading) {
    return <PredictionDiagnosticsLoadingState message="Loading scatter data..." />;
  }

  if (dots.length === 0) {
    return <PredictionDiagnosticsEmptyState />;
  }

  if (useCanvasRenderer) {
    return (
      <CanvasScatter
        points={canvasPoints}
        referenceLines={canvasRefLines}
        annotations={canvasAnnotations}
        xLabel="Observed"
        yLabel="Predicted"
        xDomain={[minVal, maxVal]}
        yDomain={[minVal, maxVal]}
        onPointClick={handleCanvasPointClick}
        onPointHover={handleCanvasPointHover}
        renderTooltip={renderCanvasTooltip}
      />
    );
  }

  return (
    <PredVsObsRechartsPlot
      dots={dots}
      minVal={minVal}
      maxVal={maxVal}
      metrics={metrics}
      tickFormatter={tickFormatter}
      hasSelection={hasSelection}
      selectedChains={selectedChains}
      hoveredChain={hoveredChain}
      onDotClick={handleDotClick}
      onHoverChainChange={setHovered}
    />
  );
}
