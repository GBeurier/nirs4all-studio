import { useMemo, useCallback, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useInspectorSelection, useInspectorHover } from '@/context/useInspectorSelection';
import { useInspectorColor } from '@/context/useInspectorColor';
import {
  buildResidualCanvasPoints,
  buildResidualDots,
  buildResidualReferenceLines,
  createResidualXTickFormatter,
  createResidualYTickFormatter,
  getResidualSelectionMode,
  type ResidualDot,
} from '@/lib/inspector/residualsData';
import { buildResidualCanvasAnnotations } from '@/lib/inspector/predictionDiagnosticsPresentation';
import type { ScatterResponse } from '@/types/inspector';
import { CanvasScatter, CANVAS_SCATTER_THRESHOLD, type CanvasScatterPoint } from './CanvasScatter';
import { PredictionDiagnosticsEmptyState, PredictionDiagnosticsLoadingState } from './PredictionDiagnosticsState';
import { ResidualsRechartsPlot } from './ResidualsRechartsPlot';
import { ResidualsCanvasTooltip } from './ResidualsTooltip';

interface ResidualsChartProps {
  data: ScatterResponse | null | undefined;
  isLoading: boolean;
}

export function ResidualsChart({ data, isLoading }: ResidualsChartProps) {
  const { t } = useTranslation();
  const { select, selectedChains, hasSelection } = useInspectorSelection();
  const { hoveredChain, setHovered } = useInspectorHover();
  const { getChainColor, getChainOpacity } = useInspectorColor();

  const { dots, meanResidual, stdResidual } = useMemo(() => buildResidualDots(data), [data]);
  const useCanvasRenderer = dots.length > CANVAS_SCATTER_THRESHOLD;
  const xTickFormatter = useMemo(() => createResidualXTickFormatter(dots), [dots]);
  const yTickFormatter = useMemo(() => createResidualYTickFormatter(stdResidual), [stdResidual]);

  const canvasPoints = useMemo<CanvasScatterPoint[]>(() => {
    if (!useCanvasRenderer) return [];
    return buildResidualCanvasPoints({
      dots,
      getChainColor,
      getChainOpacity,
      hoveredChain,
      hasSelection,
      selectedChains,
    });
  }, [dots, useCanvasRenderer, getChainColor, getChainOpacity, hoveredChain, hasSelection, selectedChains]);

  const canvasRefLines = useMemo(() => buildResidualReferenceLines(stdResidual), [stdResidual]);
  const canvasAnnotations = useMemo(() => buildResidualCanvasAnnotations({
    meanResidual,
    stdResidual,
    pointCount: dots.length,
    t,
  }), [meanResidual, stdResidual, dots.length, t]);

  const handleCanvasPointClick = useCallback((point: CanvasScatterPoint, event: MouseEvent) => {
    select([point.chainId], getResidualSelectionMode(event));
  }, [select]);

  const handleCanvasPointHover = useCallback((point: CanvasScatterPoint | null) => {
    setHovered(point?.chainId ?? null);
  }, [setHovered]);

  const renderCanvasTooltip = useCallback((point: CanvasScatterPoint) => (
    <ResidualsCanvasTooltip point={point} stdResidual={stdResidual} />
  ), [stdResidual]);

  const handleDotClick = useCallback((dot: ResidualDot) => {
    select([dot.chainId], 'toggle');
  }, [select]);

  if (isLoading) {
    return <PredictionDiagnosticsLoadingState message={t('inspector.charts.loading.residuals')} />;
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
        xLabel={t('inspector.charts.axis.predicted')}
        yLabel={t('inspector.charts.axis.residual')}
        onPointClick={handleCanvasPointClick}
        onPointHover={handleCanvasPointHover}
        renderTooltip={renderCanvasTooltip}
      />
    );
  }

  return (
    <ResidualsRechartsPlot
      dots={dots}
      meanResidual={meanResidual}
      stdResidual={stdResidual}
      xTickFormatter={xTickFormatter}
      yTickFormatter={yTickFormatter}
      hasSelection={hasSelection}
      selectedChains={selectedChains}
      hoveredChain={hoveredChain}
      getChainColor={getChainColor}
      getChainOpacity={getChainOpacity}
      onDotClick={handleDotClick}
      onHoverChainChange={setHovered}
    />
  );
}
